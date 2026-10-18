from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any


def normalized(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def role_matches(title: str, target_roles: list[str]) -> bool:
    posting_title = normalized(title)
    if not posting_title or not target_roles:
        return False

    aliases = {
        "software engineer": ("software developer", "software development engineer"),
        "backend engineer": ("back end engineer", "server side engineer"),
        "technical lead": ("tech lead",),
        "site reliability engineer": ("sre",),
        "quality assurance engineer": ("qa engineer",),
        "full stack engineer": ("fullstack engineer", "full stack developer"),
    }
    for target in target_roles:
        role = normalized(target)
        if not role:
            continue
        options = (role, *aliases.get(role, ()))
        if any(option in posting_title for option in options):
            return True

        role_tokens = set(role.split())
        title_tokens = set(posting_title.split())
        overlap = len(role_tokens & title_tokens) / max(1, len(role_tokens))
        if overlap >= 0.72 and SequenceMatcher(None, role, posting_title).ratio() >= 0.68:
            return True
    return False


def _contains_phrase(text: str, phrase: str) -> bool:
    phrase = normalized(phrase)
    if not phrase:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])", text) is not None


def evaluate_posting(posting: dict[str, Any], filters: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """Return an explainable 0-100 fit score for one profile and posting."""
    title = str(posting.get("title") or "")
    location = str(posting.get("location") or "")
    description = str(posting.get("description") or "")
    searchable = normalized(f"{title} {description}")

    roles = [str(value) for value in (filters.get("target_roles") or profile.get("target_roles") or []) if isinstance(value, str)]
    skills = [str(value) for value in (filters.get("skills") or profile.get("primary_skills") or []) if isinstance(value, str)]
    countries = [str(value) for value in (filters.get("countries") or [profile.get("home_country"), *(profile.get("global_countries") or [])]) if isinstance(value, str)]
    cities = [str(value) for value in (filters.get("preferred_cities") or profile.get("preferred_cities") or []) if isinstance(value, str)]
    experience = filters.get("minimum_experience")
    if not isinstance(experience, (int, float)):
        experience = profile.get("experience_years")

    role_match = role_matches(title, roles)
    matched_skills = [skill for skill in skills if _contains_phrase(searchable, skill)]
    skill_score = round(30 * len(matched_skills) / len(skills)) if skills else 15

    location_text = normalized(location)
    matching_country = next((country for country in countries if normalized(country) in location_text), None)
    matching_city = next((city for city in cities if normalized(city) in location_text), None)
    location_unknown = not location_text or not countries and not cities
    location_score = 10 if matching_country or matching_city else 5 if location_unknown else 0

    experience_match = re.search(r"(?:minimum|min)?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of\s+(?:relevant\s+)?experience)?", searchable)
    required_years = float(experience_match.group(1)) if experience_match else None
    experience_unknown = experience is None or required_years is None
    experience_score = 8 if experience_unknown else 15 if float(experience) >= required_years else 0

    needs_sponsorship = bool(filters.get("sponsorship_required", profile.get("sponsorship_required", False)))
    sponsor_yes = any(phrase in searchable for phrase in ("visa sponsorship available", "sponsorship available", "visa sponsorship provided", "will sponsor visa"))
    sponsor_no = any(phrase in searchable for phrase in ("no visa sponsorship", "unable to sponsor", "cannot sponsor", "will not sponsor"))
    sponsorship_unknown = needs_sponsorship and not sponsor_yes and not sponsor_no
    sponsorship_score = 10 if not needs_sponsorship or sponsor_yes else 0 if sponsor_no else 5

    score = round((35 if role_match else 0) + skill_score + location_score + experience_score + sponsorship_score)
    missing = [f"Profile skill not found: {skill}" for skill in skills if skill not in matched_skills][:10]
    if location_unknown:
        missing.append("Location needs review")
    elif not matching_country and not matching_city:
        missing.append("Posting location does not match preferred countries or cities")
    if required_years is not None and experience is not None and float(experience) < required_years:
        missing.append(f"Posting asks for {required_years:g}+ years; profile has {float(experience):g}")
    if sponsorship_unknown:
        missing.append("Visa sponsorship is not stated")
    elif needs_sponsorship and sponsor_no:
        missing.append("Posting says visa sponsorship is unavailable")

    decision = "QUALIFIED" if score >= 75 else "PENDING_REVIEW" if score >= 45 else "REJECTED"
    explanation = (
        f"Title {'matches' if role_match else 'does not match'} a target role; "
        f"{len(matched_skills)}/{len(skills)} profile skills found; "
        f"{'location matches' if matching_country or matching_city else 'location needs review' if location_unknown else 'location does not match'}; "
        f"{'experience requirement is unknown' if experience_unknown else 'experience fits' if float(experience) >= required_years else 'experience is below the stated requirement'}; "
        f"{'sponsorship is not required' if not needs_sponsorship else 'sponsorship is available' if sponsor_yes else 'sponsorship is unavailable' if sponsor_no else 'sponsorship is not stated'}."
    )
    return {
        "score": max(0, min(100, score)),
        "decision": decision,
        "explanation": explanation,
        "missing_requirements": missing,
    }
