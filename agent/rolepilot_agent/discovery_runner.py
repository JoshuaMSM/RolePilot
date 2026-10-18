from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable

from supabase import Client

from rolepilot_agent.matching import evaluate_posting, role_matches
from rolepilot_agent.sources import BraveBrowserSearch, CareersSearchUnavailable, Posting, discover_postings, resolve_careers_page


logger = logging.getLogger("rolepilot-agent")


def _normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _timestamp(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None


def _target_values(profile: dict[str, Any]) -> list[str]:
    filters = profile.get("filters") if isinstance(profile.get("filters"), dict) else {}
    values = filters.get("target_companies")
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(value.strip() for value in values if isinstance(value, str) and value.strip()))


def _target_roles(profile: dict[str, Any], user_profile: dict[str, Any]) -> list[str]:
    filters = profile.get("filters") if isinstance(profile.get("filters"), dict) else {}
    roles = filters.get("target_roles") or user_profile.get("target_roles") or []
    return [value.strip() for value in roles if isinstance(value, str) and value.strip()] if isinstance(roles, list) else []


def _emit(client: Client, user_id: str, run_id: str, instance_id: str, event_type: str, message: str, details: dict[str, Any] | None = None) -> None:
    client.table("agent_events").insert({
        "user_id": user_id,
        "run_id": run_id,
        "event_type": event_type,
        "message": message,
        "details": {"source": "local-agent-discovery", "agent_instance_id": instance_id, **(details or {})},
    }).execute()


def _current_toggle(client: Client, user_id: str) -> bool:
    result = client.table("agent_settings").select("desired_enabled").eq("user_id", user_id).execute()
    return bool(result.data and result.data[0].get("desired_enabled"))


def _posting_key(company_name: str, source: str, posting: Posting) -> str:
    identity = posting.id or posting.url or f"{posting.title}|{posting.location or ''}"
    return hashlib.sha256(f"{_normalized(company_name)}|{source}|{identity}".encode("utf-8")).hexdigest()


def _profiles_for_company(profiles: list[dict[str, Any]], normalized_name: str) -> list[dict[str, Any]]:
    return [profile for profile in profiles if normalized_name in {_normalized(name) for name in _target_values(profile)}]


def _save_and_rank(
    client: Client,
    user_id: str,
    company_name: str,
    careers_url: str | None,
    source: str,
    postings: list[Posting],
    profiles: list[dict[str, Any]],
    user_profile: dict[str, Any],
) -> tuple[int, int, int]:
    matching = _profiles_for_company(profiles, _normalized(company_name))
    profile_postings: list[tuple[dict[str, Any], Posting]] = []
    posting_by_key: dict[str, Posting] = {}
    for profile in matching:
        roles = _target_roles(profile, user_profile)
        for posting in postings:
            if role_matches(posting.title, roles):
                key = _posting_key(company_name, source, posting)
                posting_by_key[key] = posting
                profile_postings.append((profile, posting))

    if not posting_by_key:
        return len(postings), 0, 0

    rows = [{
        "user_id": user_id,
        "company_name": company_name,
        "careers_url": careers_url,
        "source_name": source,
        "source_id": posting.id[:500] if posting.id else None,
        "canonical_url": posting.url,
        "dedupe_key": key,
        "title": posting.title[:500],
        "location": posting.location[:1000] if posting.location else None,
        "description": posting.description,
        "posted_at": _timestamp(posting.posted_at),
    } for key, posting in posting_by_key.items()]
    saved_result = client.table("agent_discovered_jobs").upsert(rows, on_conflict="user_id,dedupe_key").select("id, dedupe_key").execute()
    job_ids = {str(row["dedupe_key"]): str(row["id"]) for row in (saved_result.data or [])}

    match_rows: list[dict[str, Any]] = []
    for profile, posting in profile_postings:
        key = _posting_key(company_name, source, posting)
        job_id = job_ids.get(key)
        if not job_id:
            continue
        filters = profile.get("filters") if isinstance(profile.get("filters"), dict) else {}
        evaluation = evaluate_posting(posting.__dict__, filters, user_profile)
        match_rows.append({
            "user_id": user_id,
            "agent_job_id": job_id,
            "job_profile_id": profile["id"],
            "match_score": evaluation["score"],
            "decision": evaluation["decision"],
            "explanation": evaluation["explanation"],
            "missing_requirements": evaluation["missing_requirements"],
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        })
    if match_rows:
        client.table("agent_job_matches").upsert(match_rows, on_conflict="user_id,agent_job_id,job_profile_id").execute()
    return len(postings), len(profile_postings), len(posting_by_key)


def run_user_discovery(
    client: Client,
    user_id: str,
    display_name: str,
    instance_id: str,
    sequence: int,
    search: BraveBrowserSearch,
    refresh_leases: Callable[[], None],
    should_stop: Callable[[], bool],
) -> dict[str, int | str]:
    """Complete one user's company discovery and ranking before returning."""
    user_result = client.table("profiles").select("*").eq("id", user_id).execute()
    if not user_result.data:
        raise RuntimeError("User profile is missing.")
    user_profile = user_result.data[0]
    profile_result = (client.table("job_profiles").select("id, name, filters")
                      .eq("user_id", user_id).eq("enabled", True).execute())
    profiles = profile_result.data or []
    targets: dict[str, str] = {}
    for profile in profiles:
        for company in _target_values(profile):
            targets.setdefault(_normalized(company), company)

    created = client.table("agent_runs").insert({
        "user_id": user_id,
        "idempotency_key": f"agent-discovery:{instance_id}:{sequence}",
        "trigger_type": "agent_discovery",
        "status": "RUNNING",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    if not created.data:
        raise RuntimeError("Could not create a discovery run ledger record.")
    run_id = str(created.data[0]["id"])
    _emit(client, user_id, run_id, instance_id, "discovery_started", f"Sequential discovery started for {display_name}.", {"enabled_profiles": len(profiles), "companies": len(targets)})
    logger.info("Starting sequential discovery for %s: %d enabled profile%s, %d target compan%s.", display_name, len(profiles), "s" if len(profiles) != 1 else "", len(targets), "ies" if len(targets) != 1 else "y")

    if not targets:
        client.table("agent_runs").update({"status": "SKIPPED", "completed_at": datetime.now(timezone.utc).isoformat(), "error_summary": "No target companies are configured on enabled job profiles."}).eq("id", run_id).eq("user_id", user_id).execute()
        _emit(client, user_id, run_id, instance_id, "discovery_skipped", "No target companies are configured on enabled job profiles.")
        return {"run_id": run_id, "companies": 0, "postings": 0, "matched": 0, "saved": 0, "errors": 0}

    catalog_result = client.table("company_catalog").select("name, normalized_name, website_domain, careers_url").execute()
    catalog = {str(row["normalized_name"]): row for row in (catalog_result.data or [])}
    company_names = sorted(targets.values(), key=str.casefold)
    company_rows = client.table("agent_run_companies").insert([{
        "user_id": user_id,
        "run_id": run_id,
        "company_name": name,
        "search_query": f"{name} careers",
        "status": "SKIPPED",
        "error_summary": "Waiting for this user's sequential discovery turn.",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    } for name in company_names]).execute()
    company_run_rows = {str(row["company_name"]): str(row["id"]) for row in (company_rows.data or [])}

    totals = {"companies": 0, "completed": 0, "postings": 0, "matched": 0, "saved": 0, "errors": 0, "catalog_fallbacks": 0}
    stop_reason: str | None = None
    web_search_blocked = False
    for company_name in company_names:
        company_run_id = company_run_rows.get(company_name)
        if should_stop():
            stop_reason = "Local agent shutdown requested at a company checkpoint."
        if stop_reason or not _current_toggle(client, user_id):
            stop_reason = stop_reason or "User disabled the agent during sequential discovery; remaining companies were skipped."
            if company_run_id:
                client.table("agent_run_companies").update({"error_summary": stop_reason}).eq("id", company_run_id).eq("user_id", user_id).execute()
            continue

        normalized_name = _normalized(company_name)
        known = catalog.get(normalized_name, {})
        careers_url: str | None = None
        source_name: str | None = None
        if company_run_id:
            client.table("agent_run_companies").update({"status": "SEARCHING", "started_at": datetime.now(timezone.utc).isoformat(), "completed_at": None, "error_summary": None}).eq("id", company_run_id).eq("user_id", user_id).execute()
        totals["companies"] += 1
        try:
            refresh_leases()
            catalog_fallback = False
            if web_search_blocked:
                if not known.get("careers_url"):
                    raise CareersSearchUnavailable("Brave Search is blocked for this run and the company has no catalog careers URL.", blocked=True)
                careers_url = resolve_careers_page(company_name, [], known.get("website_domain"), known.get("careers_url"))
                catalog_fallback = True
            else:
                try:
                    search_results = search.search_careers(company_name, user_profile.get("home_country"))
                    careers_url = resolve_careers_page(company_name, search_results, known.get("website_domain"), known.get("careers_url"))
                except CareersSearchUnavailable as search_error:
                    if search_error.blocked:
                        web_search_blocked = True
                    if not known.get("careers_url"):
                        raise
                    careers_url = resolve_careers_page(company_name, [], known.get("website_domain"), known.get("careers_url"))
                    catalog_fallback = True
                    logger.warning("Brave Search did not return usable results for %s (%s); using its configured catalog careers URL.", company_name, search_error)
                    _emit(client, user_id, run_id, instance_id, "company_search_catalog_fallback", f"Brave Search did not return usable results; used the shared catalog careers URL for {company_name}.", {
                        "company": company_name, "careers_url": careers_url, "search_error": str(search_error)[:500],
                        "search_blocked": search_error.blocked,
                    })
            if catalog_fallback:
                totals["catalog_fallbacks"] += 1
            persisted_careers_url = careers_url
            if company_run_id:
                client.table("agent_run_companies").update({"status": "FETCHING", "careers_url": persisted_careers_url}).eq("id", company_run_id).eq("user_id", user_id).execute()
            refresh_leases()
            source_name, postings = discover_postings(careers_url)
            retrieved, role_matches_count, saved_count = _save_and_rank(client, user_id, company_name, persisted_careers_url, source_name, postings, profiles, user_profile)
            totals["completed"] += 1
            totals["postings"] += retrieved
            totals["matched"] += role_matches_count
            totals["saved"] += saved_count
            if company_run_id:
                client.table("agent_run_companies").update({
                    "status": "COMPLETED", "source_name": source_name,
                    "postings_retrieved": retrieved, "role_matches": role_matches_count,
                    "jobs_saved": saved_count, "error_summary": None,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", company_run_id).eq("user_id", user_id).execute()
            _emit(client, user_id, run_id, instance_id, "company_discovery_completed", f"{company_name}: retrieved {retrieved} postings, title-matched {role_matches_count} profile/posting pairs, and saved {saved_count} unique jobs.", {
                "company": company_name, "careers_url": careers_url, "source": source_name, "catalog_fallback": catalog_fallback,
                "postings_retrieved": retrieved, "role_matches": role_matches_count, "jobs_saved": saved_count,
            })
            logger.info("%s: %d postings, %d title matches, %d unique saved; moving to next company.", company_name, retrieved, role_matches_count, saved_count)
        except Exception as error:
            totals["errors"] += 1
            summary = f"{type(error).__name__}: {error}"[:1000]
            if company_run_id:
                client.table("agent_run_companies").update({"status": "FAILED", "careers_url": careers_url, "source_name": source_name, "error_summary": summary, "completed_at": datetime.now(timezone.utc).isoformat()}).eq("id", company_run_id).eq("user_id", user_id).execute()
            _emit(client, user_id, run_id, instance_id, "company_discovery_failed", f"Could not discover {company_name}: {summary}", {"company": company_name, "careers_url": careers_url})
            if isinstance(error, CareersSearchUnavailable) and error.blocked:
                web_search_blocked = True
            if isinstance(error, CareersSearchUnavailable) and not careers_url and error.blocked:
                logger.error("Careers web search was blocked for %s at %s; using catalog fallbacks for the remaining queue: %s", display_name, company_name, error)
            elif isinstance(error, CareersSearchUnavailable) and not careers_url:
                logger.warning("Careers web search returned no usable results for %s at %s; will retry Brave Search for the next company: %s", display_name, company_name, error)
            elif isinstance(error, CareersSearchUnavailable):
                logger.error("Careers search or catalog fallback failed for %s at %s: %s", display_name, company_name, error)
            else:
                logger.exception("Discovery failed for %s at company %s; continuing this user's queue.", display_name, company_name)
        finally:
            refresh_leases()

    complete_status = "FAILED" if totals["errors"] and totals["completed"] == 0 else "SUCCEEDED"
    if stop_reason and totals["completed"] == 0 and totals["errors"] == 0:
        complete_status = "SKIPPED"
    summary = f"Sequential discovery attempted {totals['companies']} companies ({totals['completed']} completed); fetched {totals['postings']} postings; title-matched {totals['matched']} profile/posting pairs; saved {totals['saved']} unique jobs; used catalog fallback for {totals['catalog_fallbacks']} companies; {totals['errors']} company errors."
    client.table("agent_runs").update({
        "status": complete_status,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "jobs_discovered": totals["saved"],
        "jobs_evaluated": totals["matched"],
        "error_summary": summary if totals["errors"] or stop_reason else None,
    }).eq("id", run_id).eq("user_id", user_id).execute()
    _emit(client, user_id, run_id, instance_id, "discovery_finished", summary, {**totals, "status": complete_status, "stopped_early": bool(stop_reason)})
    logger.info("Finished sequential discovery for %s: %s", display_name, summary)
    return {"run_id": run_id, **totals, "status": complete_status}
