from __future__ import annotations

import logging
import os
import signal
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

from rolepilot_agent.discovery_runner import run_user_discovery
from rolepilot_agent.sources import BraveBrowserSearch


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("rolepilot-agent")
STOP = False


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}. Copy agent/.env.example to agent/.env and configure it.")
    return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def request_stop(_signum: int, _frame: Any) -> None:
    global STOP
    STOP = True


def event(client: Client, user_id: str, event_type: str, message: str, run_id: str | None, instance_id: str) -> None:
    client.table("agent_events").insert({
        "user_id": user_id,
        "run_id": run_id,
        "event_type": event_type,
        "message": message,
        "details": {"source": "local-agent", "agent_instance_id": instance_id},
    }).execute()


def recover_interrupted_sessions(client: Client, user_id: str, instance_id: str) -> None:
    result = (client.table("agent_runs").select("id")
              .eq("user_id", user_id).eq("trigger_type", "agent_session")
              .eq("status", "RUNNING").execute())
    for row in result.data or []:
        run_id = row["id"]
        client.table("agent_runs").update({
            "status": "INTERRUPTED",
            "completed_at": utc_now(),
            "recovery_details": "The previous local agent process ended without recording a clean shutdown.",
        }).eq("id", run_id).eq("user_id", user_id).eq("status", "RUNNING").execute()
        event(client, user_id, "session_recovered", "Marked an unfinished local agent session as interrupted.", run_id, instance_id)


def claim_lease(client: Client, user_id: str, instance_id: str, lease_seconds: int) -> bool:
    result = client.rpc("claim_agent_lease_for_user", {
        "p_user_id": user_id,
        "p_instance_id": instance_id,
        "p_lease_seconds": lease_seconds,
    }).execute()
    return bool(result.data)


def release_lease(client: Client, user_id: str, instance_id: str, failed: bool = False) -> None:
    client.rpc("release_agent_lease_for_user", {
        "p_user_id": user_id,
        "p_instance_id": instance_id,
        "p_failed": failed,
    }).execute()


def begin_user_session(client: Client, user_id: str, display_name: str, instance_id: str, lease_seconds: int) -> dict[str, Any] | None:
    if not claim_lease(client, user_id, instance_id, lease_seconds):
        logger.warning("Another local agent holds the lease for %s (%s); will retry.", display_name, user_id[:8])
        return None

    recover_interrupted_sessions(client, user_id, instance_id)
    created = client.table("agent_runs").insert({
        "user_id": user_id,
        "idempotency_key": f"agent-session:{instance_id}",
        "trigger_type": "agent_session",
        "status": "RUNNING",
        "started_at": utc_now(),
    }).execute()
    run_id = created.data[0]["id"] if created.data else None
    event(client, user_id, "agent_online", "The local RolePilot agent process is online for this account.", run_id, instance_id)
    logger.info("Lifecycle session started for %s (%s).", display_name, user_id[:8])
    return {"run_id": run_id, "desired_enabled": None, "last_heartbeat": 0.0, "display_name": display_name}


def record_user_error(client: Client, user_id: str, instance_id: str, state: dict[str, Any], error: Exception) -> None:
    run_id = state.get("run_id")
    summary = f"Local agent error ({type(error).__name__}); see local process output."
    if run_id:
        client.table("agent_runs").update({"status": "FAILED", "completed_at": utc_now(), "error_summary": summary}).eq("id", run_id).eq("user_id", user_id).eq("status", "RUNNING").execute()
    event(client, user_id, "agent_error", "The local agent could not update this account's lifecycle state. Review local process output.", run_id, instance_id)
    try:
        release_lease(client, user_id, instance_id, failed=True)
    except Exception:
        logger.exception("Could not release the lease for user %s after an error.", user_id)


def record_discovery_failure(client: Client, user_id: str, display_name: str, instance_id: str, sequence: int, error: Exception) -> None:
    idempotency_key = f"agent-discovery:{instance_id}:{sequence}"
    lookup = client.table("agent_runs").select("id,status").eq("user_id", user_id).eq("idempotency_key", idempotency_key).execute()
    run_id = lookup.data[0]["id"] if lookup.data else None
    if not run_id:
        created = client.table("agent_runs").insert({
            "user_id": user_id,
            "idempotency_key": idempotency_key,
            "trigger_type": "agent_discovery",
            "status": "FAILED",
            "started_at": utc_now(),
            "completed_at": utc_now(),
            "error_summary": f"{type(error).__name__}: {error}"[:1000],
        }).execute()
        run_id = created.data[0]["id"] if created.data else None
    else:
        client.table("agent_runs").update({
            "status": "FAILED", "completed_at": utc_now(),
            "error_summary": f"{type(error).__name__}: {error}"[:1000],
        }).eq("id", run_id).eq("user_id", user_id).execute()
    event(client, user_id, "discovery_failed", f"Agent discovery failed for {display_name}: {type(error).__name__}.", run_id, instance_id)


def run() -> None:
    global STOP
    url = required_env("SUPABASE_URL")
    service_key = required_env("SUPABASE_SERVICE_ROLE_KEY")
    brave_executable = os.getenv("BRAVE_BROWSER_EXECUTABLE", "").strip() or None
    poll_seconds = env_int("POLL_INTERVAL_SECONDS", 5, 2, 60)
    heartbeat_seconds = env_int("HEARTBEAT_INTERVAL_SECONDS", 15, 5, 60)
    lease_seconds = env_int("AGENT_LEASE_SECONDS", 120, 15, 120)

    client = create_client(url, service_key)
    instance_id = str(uuid.uuid4())
    sessions: dict[str, dict[str, Any]] = {}
    clean_shutdown = False
    last_logged_users: tuple[str, ...] | None = None
    search: BraveBrowserSearch | None = None
    logger.info("Connected with local coordinator credentials. Monitoring agent settings for registered users.")

    try:
        while not STOP:
            result = client.table("agent_settings").select("user_id, desired_enabled").execute()
            users = result.data or []
            user_ids = [str(row["user_id"]) for row in users]
            profiles = client.table("profiles").select("id, full_name").in_("id", user_ids).execute() if user_ids else None
            names_by_user = {
                str(profile["id"]): str(profile.get("full_name") or "").strip()
                for profile in (profiles.data if profiles else [])
            }
            for row in users:
                user_id = str(row["user_id"])
                row["display_name"] = names_by_user.get(user_id) or f"User {user_id[:8]}"
            known_users = {str(row["user_id"]) for row in users}
            current_users = tuple(f"{row['display_name']} ({'ON' if row['desired_enabled'] else 'OFF'})" for row in users)
            if current_users != last_logged_users:
                logger.info("Monitoring %d registered user%s: %s", len(users), "s" if len(users) != 1 else "", ", ".join(current_users) or "none")
                last_logged_users = current_users

            # Drop local state for accounts removed while the process was running.
            for user_id in set(sessions) - known_users:
                sessions.pop(user_id, None)

            users.sort(key=lambda row: str(row["display_name"]).casefold())
            for row in users:
                user_id = str(row["user_id"])
                display_name = str(row["display_name"])
                state = sessions.get(user_id)
                if state is None:
                    try:
                        state = begin_user_session(client, user_id, display_name, instance_id, lease_seconds)
                        if state is None:
                            continue
                        sessions[user_id] = state
                    except Exception as error:
                        logger.exception("Could not start lifecycle session for %s (%s).", display_name, user_id[:8])
                        continue

                try:
                    desired_enabled = bool(row["desired_enabled"])
                    if desired_enabled != state["desired_enabled"]:
                        state["desired_enabled"] = desired_enabled
                        status = "ENABLED" if desired_enabled else "DISABLED"
                        client.table("agent_settings").update({"runtime_status": status}).eq("user_id", user_id).eq("agent_instance_id", instance_id).execute()
                        message = "Agent enabled; lifecycle monitoring is active." if desired_enabled else "Agent disabled; no work will start."
                        event(client, user_id, "agent_enabled" if desired_enabled else "agent_disabled", message, state["run_id"], instance_id)
                        logger.info("%s (%s): %s", display_name, user_id[:8], message)
                        if desired_enabled:
                            state["discovery_sequence"] = int(state.get("discovery_sequence", 0)) + 1
                        else:
                            state["discovery_cycle_started"] = False

                    if desired_enabled and not state.get("discovery_cycle_started"):
                        state["discovery_cycle_started"] = True
                        def refresh_leases() -> None:
                            now = time.monotonic()
                            for active_user_id, active_state in list(sessions.items()):
                                if now - active_state["last_heartbeat"] >= heartbeat_seconds:
                                    if not claim_lease(client, active_user_id, instance_id, lease_seconds):
                                        raise RuntimeError(f"Agent lease was lost for {active_state.get('display_name', active_user_id)} during sequential discovery.")
                                    active_state["last_heartbeat"] = now

                        sequence = int(state["discovery_sequence"])
                        try:
                            if search is None:
                                search = BraveBrowserSearch(brave_executable)
                                logger.info("Visible local Brave Search is ready for ordinary careers-page link searches.")
                            run_user_discovery(
                                client, user_id, display_name, instance_id, sequence, search,
                                refresh_leases, lambda: STOP,
                            )
                        except Exception as error:
                            logger.exception("Discovery run failed for %s (%s).", display_name, user_id[:8])
                            record_discovery_failure(client, user_id, display_name, instance_id, sequence, error)

                    now = time.monotonic()
                    if now - state["last_heartbeat"] >= heartbeat_seconds:
                        if not claim_lease(client, user_id, instance_id, lease_seconds):
                            raise RuntimeError(f"Agent lease was lost for {display_name}; stopping this user's session to prevent concurrent processes.")
                        state["last_heartbeat"] = now
                except Exception as error:
                    logger.exception("Lifecycle update failed for %s (%s).", display_name, user_id[:8])
                    record_user_error(client, user_id, instance_id, state, error)
                    sessions.pop(user_id, None)

            if len(users) > 5:
                logger.error("Found %d agent settings rows; expected the database account limit of five.", len(users))
            time.sleep(poll_seconds)
        clean_shutdown = True
    except Exception:
        # A coordinator query failure is process-wide; retain user-level sessions for recovery on next startup.
        logger.exception("Could not read agent settings for registered users.")
        raise
    finally:
        for user_id, state in list(sessions.items()):
            run_id = state.get("run_id")
            try:
                if clean_shutdown:
                    if run_id:
                        client.table("agent_runs").update({"status": "SUCCEEDED", "completed_at": utc_now()}).eq("id", run_id).eq("user_id", user_id).eq("status", "RUNNING").execute()
                    event(client, user_id, "agent_offline", "The local RolePilot agent process stopped cleanly for this account.", run_id, instance_id)
                    release_lease(client, user_id, instance_id)
                else:
                    error = RuntimeError("The local coordinator stopped unexpectedly.")
                    record_user_error(client, user_id, instance_id, state, error)
            except Exception:
                logger.exception("Could not close lifecycle session for user %s cleanly.", user_id)
        if search:
            try:
                search.close()
            except Exception:
                logger.exception("Could not close the local Brave search window cleanly.")
        logger.info("Stopped cleanly.")


def main() -> None:
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    try:
        run()
    except KeyboardInterrupt:
        logger.info("Stop requested.")
    except Exception as exc:
        logger.exception("Local agent stopped after an error.")
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
