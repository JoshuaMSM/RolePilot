# RolePilot

RolePilot is a private, personal job-search workspace built as a portfolio project. It uses Supabase Auth and Postgres for account-backed data. The local Python agent remains a later phase; this dashboard never submits applications automatically.

## Current setup

- Supabase email/password sign-up and sign-in with server-verified sessions.
- A Postgres migration for profiles, job profiles, companies, jobs, evaluations, resume metadata, applications, audit events, and local-agent run records.
- Row-level security and owner policies on every application table. Resume files use a private bucket with owner-folder policies.
- The analytics dashboard reads real records through the signed-in user's session. Empty data displays as zero or an empty state; query errors are surfaced instead of filled with sample metrics.
- Companies is driven by a backend company catalog: it displays only names referenced by job profiles, along with catalog logos and official careers links. Add a new catalog record in the backend when you start targeting a new company.
- Discover Jobs checks catalogued company sources daily after deployment and detects public Greenhouse, Lever, Ashby, and SmartRecruiters feeds, linked ATS boards, or standard `JobPosting` structured data. Listings are deduplicated and never submitted as applications. A **Check now** action is also available while signed in. Some custom JavaScript career sites need a source-specific adapter.
- Imported listings receive explainable profile evaluations using role, skills, location, experience, and sponsorship evidence. The current match agent is a deterministic rules engine (`rolepilot-rules-v1`), not an LLM; it stores decision reasons and flags unknown sponsorship or location for review.
- Arctic Light is the default theme; the Obsidian Violet dark theme can be toggled from the dashboard.

## Connect a Supabase project

1. Create a personal Supabase project. The Free plan currently includes 500 MB of database storage and 1 GB of file storage; free projects may pause after a week of inactivity, and automatic backups are not included. See [Supabase pricing](https://supabase.com/pricing).
2. Open the project's SQL Editor and run migrations [`202610110001_initial_schema.sql`](supabase/migrations/202610110001_initial_schema.sql) through [`202610110005_workday_company_sources.sql`](supabase/migrations/202610110005_workday_company_sources.sql) in order. They create the schema, seed job profiles and the backend company catalog, then configure the Walmart and PayPal Workday sources.
3. Copy `.env.example` to `frontend/.env.local` and fill in the Project URL and Publishable key from the Supabase project's API settings. The app works locally with these public values and RLS. Never expose a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable.
4. In Supabase Authentication URL settings, add `http://localhost:3000/auth/callback` as a redirect URL for local development.
5. Start the app and create your personal account:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

   Open http://localhost:3000 and choose **Create an account**. If email confirmation is enabled, follow the link from Supabase before signing in.

The SQL migration is written for a fresh project. If you already ran an earlier version, inspect its migration history before reapplying. Supabase credentials and the cloud database are not included in this repository, so the application is not considered connected until you configure them and sign in successfully.

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
- Phase 3: local Python agent lifecycle, scheduler, run ledger, and recovery.
- Phase 4: permitted source discovery and normalization.
- Phase 5: local AI evaluation and deterministic policy checks.
- Phase 6: application preparation and review-before-apply workflow.
- Phase 7: security, recovery, deployment, and operations hardening.
