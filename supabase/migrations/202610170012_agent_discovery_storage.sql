-- Keep local-agent discovery results separate from dashboard discovery.
alter table public.agent_runs drop constraint if exists agent_runs_trigger_type_check;
alter table public.agent_runs
  add constraint agent_runs_trigger_type_check
  check (trigger_type in ('scheduled', 'manual', 'recovery', 'agent_session', 'agent_discovery'));

create table public.agent_discovered_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  careers_url text,
  source_name text not null,
  source_id text,
  canonical_url text,
  dedupe_key text not null,
  title text not null,
  location text,
  description text,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, dedupe_key)
);
create index agent_discovered_jobs_owner_seen_idx on public.agent_discovered_jobs(user_id, last_seen_at desc);

create table public.agent_job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_job_id uuid not null,
  job_profile_id uuid not null,
  match_score numeric(5,2) not null check (match_score between 0 and 100),
  decision public.evaluation_decision not null,
  explanation text not null default '',
  missing_requirements text[] not null default '{}',
  evaluated_at timestamptz not null default now(),
  unique (user_id, agent_job_id, job_profile_id),
  foreign key (agent_job_id, user_id) references public.agent_discovered_jobs(id, user_id) on delete cascade,
  foreign key (job_profile_id, user_id) references public.job_profiles(id, user_id) on delete cascade
);
create index agent_job_matches_owner_score_idx on public.agent_job_matches(user_id, match_score desc, evaluated_at desc);

create table public.agent_run_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  company_name text not null,
  search_query text,
  careers_url text,
  source_name text,
  status text not null check (status in ('SEARCHING', 'FETCHING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  postings_retrieved integer not null default 0 check (postings_retrieved >= 0),
  role_matches integer not null default 0 check (role_matches >= 0),
  jobs_saved integer not null default 0 check (jobs_saved >= 0),
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (run_id, user_id) references public.agent_runs(id, user_id) on delete cascade
);
create index agent_run_companies_owner_run_idx on public.agent_run_companies(user_id, run_id, started_at);

alter table public.agent_discovered_jobs enable row level security;
alter table public.agent_job_matches enable row level security;
alter table public.agent_run_companies enable row level security;

revoke all on public.agent_discovered_jobs, public.agent_job_matches, public.agent_run_companies from anon;
grant select on public.agent_discovered_jobs, public.agent_job_matches, public.agent_run_companies to authenticated;
grant all on public.agent_discovered_jobs, public.agent_job_matches, public.agent_run_companies to service_role;

create policy "Agent discovered jobs owner read" on public.agent_discovered_jobs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Agent job matches owner read" on public.agent_job_matches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Agent company run owner read" on public.agent_run_companies for select to authenticated
  using ((select auth.uid()) = user_id);
