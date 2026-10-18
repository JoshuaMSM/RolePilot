-- Local agent lifecycle support. The agent authenticates as the owner so RLS
-- remains active; the lease function prevents two local processes from owning
-- the same account at once.
alter table public.agent_settings
  add column if not exists agent_instance_id uuid,
  add column if not exists lease_expires_at timestamptz;

alter table public.agent_runs drop constraint if exists agent_runs_trigger_type_check;
alter table public.agent_runs
  add constraint agent_runs_trigger_type_check
  check (trigger_type in ('scheduled', 'manual', 'recovery', 'agent_session'));

create or replace function public.claim_agent_lease(p_instance_id uuid, p_lease_seconds integer default 45)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed boolean;
begin
  update public.agent_settings
     set agent_instance_id = p_instance_id,
         lease_expires_at = now() + make_interval(secs => greatest(15, least(p_lease_seconds, 120))),
         last_heartbeat_at = now(),
         runtime_status = case when desired_enabled then 'ENABLED'::public.agent_runtime_status else 'DISABLED'::public.agent_runtime_status end
   where user_id = (select auth.uid())
     and (agent_instance_id is null or agent_instance_id = p_instance_id or lease_expires_at < now());
  claimed := found;
  return claimed;
end;
$$;

create or replace function public.release_agent_lease(p_instance_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  released boolean;
begin
  update public.agent_settings
     set agent_instance_id = null,
         lease_expires_at = now(),
         last_heartbeat_at = now(),
         runtime_status = case when desired_enabled then 'ENABLED'::public.agent_runtime_status else 'DISABLED'::public.agent_runtime_status end
   where user_id = (select auth.uid()) and agent_instance_id = p_instance_id;
  released := found;
  return released;
end;
$$;

revoke all on function public.claim_agent_lease(uuid, integer) from public, anon;
revoke all on function public.release_agent_lease(uuid) from public, anon;
grant execute on function public.claim_agent_lease(uuid, integer) to authenticated;
grant execute on function public.release_agent_lease(uuid) to authenticated;
