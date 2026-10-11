create extension if not exists pgcrypto;

create type public.application_status as enum (
  'DISCOVERED', 'QUALIFIED', 'REJECTED', 'PENDING_REVIEW', 'APPROVED',
  'PREPARING', 'SUBMITTED', 'SUBMISSION_UNKNOWN', 'WAITING', 'INTERVIEW',
  'REJECTED_BY_EMPLOYER', 'OFFER', 'WITHDRAWN', 'FAILED'
);

create type public.evaluation_decision as enum ('QUALIFIED', 'REJECTED', 'PENDING_REVIEW');
create type public.agent_runtime_status as enum ('UNKNOWN', 'ENABLED', 'DISABLED', 'RUNNING', 'PAUSED', 'ERROR');
create type public.agent_run_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'INTERRUPTED', 'RECONCILIATION_REQUIRED');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  experience_years numeric(4,1) check (experience_years is null or experience_years >= 0),
  primary_skills text[] not null default '{}',
  additional_interests text[] not null default '{}',
  target_roles text[] not null default '{}',
  home_country text not null default 'India',
  preferred_cities text[] not null default '{}',
  global_countries text[] not null default '{Germany,Switzerland,Singapore,Australia,Ireland}',
  sponsorship_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'custom' check (category in ('india_product', 'global_sponsored', 'custom')),
  enabled boolean not null default true,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  website_url text,
  industry text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, normalized_name)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  source_name text not null,
  source_id text,
  canonical_url text,
  dedupe_key text not null,
  title text not null,
  location text,
  city text,
  country text,
  employment_type text,
  experience_min numeric(4,1),
  experience_max numeric(4,1),
  salary_min numeric(12,2),
  salary_max numeric(12,2),
  salary_currency text,
  visa_sponsorship text check (visa_sponsorship in ('required', 'available', 'not_available', 'unknown') or visa_sponsorship is null),
  description text,
  posted_at timestamptz,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, dedupe_key),
  foreign key (company_id, user_id) references public.companies(id, user_id)
);

create unique index jobs_owner_source_id_unique on public.jobs(user_id, source_name, source_id) where source_id is not null;
create unique index jobs_owner_canonical_url_unique on public.jobs(user_id, canonical_url) where canonical_url is not null;
create index jobs_owner_country_created_idx on public.jobs(user_id, country, discovered_at desc);
create index jobs_owner_discovered_idx on public.jobs(user_id, discovered_at desc);

create table public.job_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  job_profile_id uuid not null,
  match_score numeric(5,2) not null check (match_score between 0 and 100),
  decision public.evaluation_decision not null,
  explanation text not null default '',
  missing_requirements text[] not null default '{}',
  model_provider text,
  evaluated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, job_id, job_profile_id),
  foreign key (job_id, user_id) references public.jobs(id, user_id) on delete cascade,
  foreign key (job_profile_id, user_id) references public.job_profiles(id, user_id) on delete cascade
);
create index evaluations_owner_decision_idx on public.job_evaluations(user_id, decision, evaluated_at desc);

create table public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  storage_path text not null,
  content_type text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, storage_path)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  job_profile_id uuid not null,
  resume_version_id uuid,
  status public.application_status not null default 'DISCOVERED',
  applied_at timestamptz,
  last_verified_at timestamptz,
  submission_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, job_id, job_profile_id),
  foreign key (job_id, user_id) references public.jobs(id, user_id) on delete cascade,
  foreign key (job_profile_id, user_id) references public.job_profiles(id, user_id) on delete cascade,
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id)
);
create index applications_owner_status_idx on public.applications(user_id, status, updated_at desc);
create index applications_owner_applied_idx on public.applications(user_id, applied_at desc);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  from_status public.application_status,
  to_status public.application_status not null,
  note text,
  occurred_at timestamptz not null default now(),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade
);
create index application_events_owner_application_idx on public.application_events(user_id, application_id, occurred_at desc);

create table public.agent_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  desired_enabled boolean not null default false,
  runtime_status public.agent_runtime_status not null default 'UNKNOWN',
  timezone text not null default 'Asia/Kolkata',
  morning_schedule time not null default '08:00',
  evening_schedule time not null default '20:00',
  missed_run_policy text not null default 'latest_only' check (missed_run_policy in ('latest_only', 'skip_all')),
  last_heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  trigger_type text not null check (trigger_type in ('scheduled', 'manual', 'recovery')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status public.agent_run_status not null default 'QUEUED',
  jobs_discovered integer not null default 0 check (jobs_discovered >= 0),
  jobs_evaluated integer not null default 0 check (jobs_evaluated >= 0),
  applications_prepared integer not null default 0 check (applications_prepared >= 0),
  applications_submitted integer not null default 0 check (applications_submitted >= 0),
  error_summary text,
  recovery_details text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (id, user_id)
);
create index agent_runs_owner_started_idx on public.agent_runs(user_id, started_at desc);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid,
  event_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (run_id, user_id) references public.agent_runs(id, user_id)
);
create index agent_events_owner_occurred_idx on public.agent_events(user_id, occurred_at desc);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger job_profiles_set_updated_at before update on public.job_profiles for each row execute function public.set_updated_at();
create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications for each row execute function public.set_updated_at();
create trigger agent_settings_set_updated_at before update on public.agent_settings for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name) values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.agent_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.job_profiles enable row level security;
alter table public.companies enable row level security;
alter table public.jobs enable row level security;
alter table public.job_evaluations enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;
alter table public.agent_settings enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_events enable row level security;
alter table public.resume_versions enable row level security;

revoke all on public.profiles, public.job_profiles, public.companies, public.jobs,
  public.job_evaluations, public.applications, public.application_events,
  public.agent_settings, public.agent_runs, public.agent_events, public.resume_versions
from anon;

grant select, insert, update, delete on public.profiles, public.job_profiles, public.companies,
  public.jobs, public.job_evaluations, public.applications, public.application_events,
  public.agent_settings, public.agent_runs, public.agent_events, public.resume_versions
to authenticated;

create policy "Profile owner access" on public.profiles for all to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Job profile owner access" on public.job_profiles for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Company owner access" on public.companies for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Job owner access" on public.jobs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Evaluation owner access" on public.job_evaluations for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Application owner access" on public.applications for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Application event owner access" on public.application_events for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Agent settings owner access" on public.agent_settings for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Agent run owner access" on public.agent_runs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Agent event owner access" on public.agent_events for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Resume version owner access" on public.resume_versions for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-resumes', 'private-resumes', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "Resume owner can read files" on storage.objects for select to authenticated
using (bucket_id = 'private-resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Resume owner can upload files" on storage.objects for insert to authenticated
with check (bucket_id = 'private-resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Resume owner can update files" on storage.objects for update to authenticated
using (bucket_id = 'private-resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'private-resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Resume owner can delete files" on storage.objects for delete to authenticated
using (bucket_id = 'private-resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
