# RolePilot

RolePilot is a private, personal job-search workspace built as a portfolio project. It uses Supabase Auth and Postgres for account-backed data. The local Python agent remains a later phase; this dashboard never submits applications automatically.

## Current setup

- Supabase email/password sign-up and sign-in with server-verified sessions.
- Multi-user onboarding collects each new user's name, experience, roles, skills, location preferences, and sponsorship requirement. New accounts get a search profile seeded from their own answers, and the dashboard shows those details after sign-in.
- Registration is limited to five accounts total, including the project owner. The database serializes signup checks so concurrent registrations cannot exceed the limit.
- New users can select a PDF resume for in-browser text extraction. RolePilot does not upload or save the file; extracted profile suggestions are editable, and search preferences such as dream companies, countries, and sponsorship are entered manually.
- Postgres migrations for profiles, job profiles, companies, jobs, evaluations, resume metadata, applications, audit events, and local-agent run records and leases.
- Row-level security and owner policies on every application table. Resume files use a private bucket with owner-folder policies.
- The analytics dashboard reads real records through the signed-in user's session. Empty data displays as zero or an empty state; query errors are surfaced instead of filled with sample metrics.
- Companies is driven by a backend company catalog: it displays only names referenced by job profiles, along with catalog logos and official careers links. Add a new catalog record in the backend when you start targeting a new company.
- Discover Jobs checks catalogued company sources daily after deployment and detects public Greenhouse, Lever, Ashby, and SmartRecruiters feeds, linked ATS boards, or standard `JobPosting` structured data. Listings are deduplicated and never submitted as applications. A **Check now** action is also available while signed in. Some custom JavaScript career sites need a source-specific adapter.
- Imported listings receive explainable profile evaluations using role, skills, location, experience, and sponsorship evidence. The current match agent is a deterministic rules engine (`rolepilot-rules-v1`), not an LLM; it stores decision reasons and flags unknown sponsorship or location for review.
- Arctic Light is the default theme; the Obsidian Violet dark theme can be toggled from the dashboard.

## Connect a Supabase project

1. Create a personal Supabase project. The Free plan currently includes 500 MB of database storage and 1 GB of file storage; free projects may pause after a week of inactivity, and automatic backups are not included. See [Supabase pricing](https://supabase.com/pricing).
2. Open the project's SQL Editor and run migrations [`202610110001_initial_schema.sql`](supabase/migrations/202610110001_initial_schema.sql) through [`202610170012_agent_discovery_storage.sql`](supabase/migrations/202610170012_agent_discovery_storage.sql) in order. They create the schema, seed the backend company catalog, configure career sources, add local-agent lease functions, configure account-specific signup profiles, enforce the five-account limit, and add separate storage for local-agent discovery.
3. Copy `.env.example` to `frontend/.env.local` and fill in the Project URL and Publishable key from the Supabase project's API settings. The app works locally with these public values and RLS. Never expose a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable.
4. In Supabase Authentication URL settings, add `http://localhost:3000/auth/callback` as a redirect URL for local development.
5. Start the app and create your personal account:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

   Open http://localhost:3000 and choose **Create an account**. If email confirmation is enabled, follow the link from Supabase before signing in.

The SQL migrations are written for a fresh project. If you already ran earlier versions, apply only migrations that are not already applied; do not rerun the initial schema. For an existing RolePilot Supabase project, apply any migrations that have not already been run. In particular, apply `202610120007_multi_user_onboarding.sql` for the five-account signup limit, `202610170011_multi_user_agent_lifecycle.sql` for local multi-user agent leases, and `202610170012_agent_discovery_storage.sql` for isolated agent discovery results. Existing accounts and their data are preserved. Unconfirmed signups count toward the five-account cap. Supabase credentials and the cloud database are not included in this repository.

### Run the local agent lifecycle process

The Python process in `agent/` polls all `agent_settings` rows, checks each user's ON/OFF setting, maintains an independent lease and runtime status for each account, and writes a separate run session and event audit for each account. For each enabled user, it opens a separate visible Brave Browser window, searches ordinary Brave Search results for `company careers`, verifies a plausible official careers result, opens that page, reads supported public ATS feeds or JobPosting structured data, filters postings by target roles, and ranks them against that user's profile. It finishes one user's queue before starting the next. Careers URLs, ATS postings, and profile matches are stored in agent-specific tables and do not call or modify the dashboard's Discover Jobs flow. If Brave Search shows a CAPTCHA, rate limit, or access-block page, the agent records the failure and uses the shared company catalog only as a fallback; it never solves or bypasses verification. It does not submit applications. The five-account signup limit bounds the accounts it can coordinate.

```sh
cd agent
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Fill `agent/.env` with the Supabase project URL and the project's secret/service-role key. Keep this key only in the ignored local `agent/.env`; it grants access across users and must never be added to frontend environment variables, committed, or shared. The local agent opens Brave Browser at `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` by default with a dedicated RolePilot browser profile; set `BRAVE_BROWSER_EXECUTABLE` only if Brave is installed elsewhere. This keeps your existing Brave windows and profile separate. The local search window is visible, and the agent stops that search if it encounters a CAPTCHA, rate limit, or block. No search API key or Google OAuth setup is needed. Install the browser automation dependency and start the runner with:

```sh
python -m rolepilot_agent.main
```

Each user's **Agent Activity** toggle is checked independently. At agent startup, and when a user toggles ON, the agent processes that user's enabled profiles and companies sequentially, records per-company counts/errors, then moves to the next enabled user. Turning a user's agent OFF prevents that user's discovery; the process continues polling for new accounts and toggle changes. Agent results use `agent_discovered_jobs`, `agent_job_matches`, and `agent_run_companies`, separate from dashboard discovery tables. Ctrl+C stops all owned sessions cleanly. A machine shutdown or crash is detected through stale heartbeats and the next process startup marks unfinished sessions interrupted. Recurring discovery schedules and missed-run recovery are a later phase.

### Configure job discovery

Add target organizations to a **Job Profile**. The Companies view reflects those profile names and gets the official source URL and logo from `company_catalog`; it does not ask you to paste URLs. For a new company, add its career URL and logo/domain details to `company_catalog` with a follow-up SQL migration. The resolver detects supported public feeds from those backend URLs. Some employers use unsupported custom career systems and will be reported as source errors until a connector is added. Confirm location, experience fit, and visa sponsorship on the original posting.

### Enable the daily automatic scan on Vercel

The repository includes a Vercel Cron in `frontend/vercel.json` that calls `/api/cron/discover` daily at 08:00 India Standard Time. Set the Vercel project Root Directory to `frontend`, then add these server-side environment variables for Production (and Preview if desired):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — use the Supabase server-only service-role/secret key. Do not prefix it with `NEXT_PUBLIC_`.
- `CRON_SECRET` — a long random secret also configured in Vercel.

Vercel Cron is not available while the app is only running on your laptop. Local development can use **Check now** with your normal signed-in session. Scheduled runs need the server-only Supabase key because they run without a browser session; that key remains on the server and bypasses RLS, so keep it only in deployment secrets.

## Local checks

From `frontend/`, run:

```sh
npm run lint
npm run typecheck
npm run build
```

## Roadmap

- Phase 1: responsive analytics dashboard and theme switch.
- Phase 2: Supabase authentication, schema, RLS, and real dashboard queries (implemented; requires your project credentials and migration to run).
- Phase 3: local Python agent lifecycle, per-user sequential discovery runs, run ledger, and recovery (initial lifecycle and discovery are implemented; recurring schedules remain).
- Phase 4: public source discovery and normalization (visible Brave Browser search, supported ATS feeds, JobPosting structured data, and source normalization are implemented; source coverage will grow).
- Phase 5: profile ranking and deterministic policy checks (initial explainable rules are implemented; local AI evaluation remains future work).
- Phase 6: application preparation and review-before-apply workflow.
- Phase 7: security, recovery, deployment, and operations hardening.
