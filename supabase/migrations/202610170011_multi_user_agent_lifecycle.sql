-- Allow the locally run coordinator to claim and release a separate lease for
-- each account. The service-role-only functions keep these cross-user writes
-- out of the regular authenticated API surface.
create or replace function public.claim_agent_lease_for_user(
  p_user_id uuid,
  p_instance_id uuid,
  p_lease_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role is required to claim a cross-user agent lease';
  end if;

  update public.agent_settings as settings
     set agent_instance_id = p_instance_id,
         lease_expires_at = now() + make_interval(secs => greatest(15, least(p_lease_seconds, 120))),
         last_heartbeat_at = now(),
         runtime_status = case when settings.desired_enabled
           then 'ENABLED'::public.agent_runtime_status
           else 'DISABLED'::public.agent_runtime_status
         end
   where settings.user_id = p_user_id
     and (settings.agent_instance_id is null
       or settings.agent_instance_id = p_instance_id
       or settings.lease_expires_at < now());
  claimed := found;
  return claimed;
end;
$$;

create or replace function public.release_agent_lease_for_user(
  p_user_id uuid,
  p_instance_id uuid,
  p_failed boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role is required to release a cross-user agent lease';
  end if;

  update public.agent_settings as settings
     set agent_instance_id = null,
         lease_expires_at = now(),
         last_heartbeat_at = now(),
         runtime_status = case when p_failed then 'ERROR'::public.agent_runtime_status
           when settings.desired_enabled
           then 'ENABLED'::public.agent_runtime_status
           else 'DISABLED'::public.agent_runtime_status
         end
   where settings.user_id = p_user_id
     and settings.agent_instance_id = p_instance_id;
  released := found;
  return released;
end;
$$;

revoke all on function public.claim_agent_lease_for_user(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_agent_lease_for_user(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_agent_lease_for_user(uuid, uuid, integer) to service_role;
grant execute on function public.release_agent_lease_for_user(uuid, uuid, boolean) to service_role;
