import { redirect } from "next/navigation";
import { Database, KeyRound, ShieldCheck } from "lucide-react";
import RolePilotDashboard, { type DashboardPayload } from "@/components/rolepilot-dashboard";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function SetupGuide() {
  return <main className="setup-screen"><section className="setup-card">
    <div className="auth-brand"><span className="auth-logo"><Database size={18} /></span>RolePilot</div>
    <div className="auth-kicker"><ShieldCheck size={14} /> PRIVATE SUPABASE WORKSPACE</div>
    <h1>Connect your database</h1>
    <p className="auth-copy">The live dashboard is ready. Connect a Supabase project to create your account and load your own records.</p>
    <ol className="setup-steps">
      <li><b>Create a Supabase project</b><span>Use the free tier for this personal portfolio project.</span></li>
      <li><b>Apply the database migrations</b><span>In Supabase SQL Editor, run migrations <code>202610110001</code> through <code>202610110005</code> in order, including the company catalog and Workday source updates.</span></li>
      <li><b>Add your public connection values</b><span>Copy <code>.env.example</code> to <code>frontend/.env.local</code>, then fill in the Project URL and Publishable key.</span></li>
      <li><b>Restart the app and create your account</b><span>Run <code>npm run dev</code> from <code>frontend</code>, then sign up on the login screen.</span></li>
    </ol>
    <div className="auth-alert"><KeyRound size={15} /><span>Use only the publishable key in this frontend. Never put your Supabase secret or service role key in a <code>NEXT_PUBLIC_</code> variable.</span></div>
  </section></main>;
}

function DashboardError({ message }: { message: string }) {
  return <main className="setup-screen"><section className="setup-card">
    <div className="auth-brand"><span className="auth-logo"><Database size={18} /></span>RolePilot</div>
    <h1>Database setup needs attention</h1>
    <p className="auth-copy">RolePilot could not load your records. It won’t substitute sample metrics for live data.</p>
    <div className="auth-alert"><span>{message}</span></div>
    <p className="setup-hint">Check that the migration has been applied and that your environment values point to the same Supabase project. See the setup steps in the project README.</p>
  </section></main>;
}

export default async function Home() {
  if (!isSupabaseConfigured()) return <SetupGuide />;

  const supabase = await createClient();
  const authResult = await supabase.auth.getClaims();
  const claims = authResult.data?.claims;
  const authError = authResult.error;
  if (authError || !claims) redirect("/login");

  const userId = String(claims.sub);
  const [profileResult, jobsResult, qualifiedResult, appsResult, countriesResult, matchesResult, applicationsResult, settingsResult, runsResult] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.from("jobs").select("id", { count: "exact", head: true }),
    supabase.from("job_evaluations").select("id", { count: "exact", head: true }).eq("decision", "QUALIFIED"),
    supabase.from("applications").select("id, status", { count: "exact" }),
    supabase.from("jobs").select("country"),
    supabase.from("job_evaluations").select("match_score, jobs(title, city, country, companies(name))").eq("decision", "QUALIFIED").order("match_score", { ascending: false }).limit(4),
    supabase.from("applications").select("id, status, applied_at, updated_at, jobs(title, city, country, companies(name))").order("updated_at", { ascending: false }).limit(6),
    supabase.from("agent_settings").select("desired_enabled, runtime_status, last_heartbeat_at").eq("user_id", userId).maybeSingle(),
    supabase.from("agent_runs").select("status, completed_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const [jobProfilesResult, discoveredJobsResult, companiesResult, catalogResult] = await Promise.all([
    supabase.from("job_profiles").select("id, name, category, enabled, filters, created_at, updated_at").order("created_at", { ascending: true }),
    supabase.from("jobs").select("id, title, location, country, canonical_url, source_name, discovered_at, companies(name), job_evaluations(job_profile_id, match_score, decision, explanation)").order("discovered_at", { ascending: false }).limit(50),
    supabase.from("companies").select("id, name, website_url").order("name", { ascending: true }),
    supabase.from("company_catalog").select("name, normalized_name, careers_url, logo_url, source_platform"),
  ]);

  const firstError = [profileResult, jobsResult, qualifiedResult, appsResult, countriesResult, matchesResult, applicationsResult, settingsResult, runsResult, jobProfilesResult, discoveredJobsResult, companiesResult, catalogResult].find((result) => result.error)?.error;
  if (firstError) return <DashboardError message={firstError.message} />;

  const appRows = appsResult.data ?? [];
  const statusCount = (status: string) => appRows.filter((application) => application.status === status).length;
  const countryCounts = new Map<string, number>();
  for (const row of countriesResult.data ?? []) {
    const country = row.country?.trim();
    if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
  }
  const countryRows = [...countryCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  const matches: DashboardPayload["matches"] = (matchesResult.data ?? []).flatMap((row) => {
    const job = row.jobs as unknown as { title: string; city: string | null; country: string | null; companies: { name: string } | null } | null;
    if (!job) return [];
    return [{ jobId: `${job.title}-${job.city ?? ""}-${job.country ?? ""}`, title: job.title, place: [job.city, job.country].filter(Boolean).join(", ") || "Location not specified", company: job.companies?.name ?? "Company not specified", score: Math.round(Number(row.match_score)) }];
  });
  const applications: DashboardPayload["applications"] = (applicationsResult.data ?? []).map((row) => {
    const job = row.jobs as unknown as { title: string; city: string | null; country: string | null; companies: { name: string } | null } | null;
    return { id: row.id, company: job?.companies?.name ?? "Company not specified", role: job?.title ?? "Job record unavailable", location: [job?.city, job?.country].filter(Boolean).join(", ") || "—", status: row.status, date: row.applied_at ?? row.updated_at };
  });
  const companyCatalog = new Map((catalogResult.data ?? []).map((company) => [company.normalized_name, company]));
  const savedCompanyByKey = new Map((companiesResult.data ?? []).map((company) => [company.name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), company]));
  const profileCompanies = new Map<string, { name: string; profiles: string[] }>();
  for (const profile of jobProfilesResult.data ?? []) {
    const filters = (profile.filters ?? {}) as Record<string, unknown>;
    const names = Array.isArray(filters.target_companies) ? filters.target_companies.filter((name): name is string => typeof name === "string") : [];
    for (const name of names) {
      const key = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const current = profileCompanies.get(key) ?? { name, profiles: [] };
      current.profiles.push(profile.name);
      profileCompanies.set(key, current);
    }
  }
  const heartbeat = settingsResult.data?.last_heartbeat_at ?? null;
  const payload: DashboardPayload = {
    userId,
    fullName: profileResult.data?.full_name ?? null,
    email: typeof claims.email === "string" ? claims.email : "Personal account",
    stats: { jobs: jobsResult.count ?? 0, qualified: qualifiedResult.count ?? 0, submitted: statusCount("SUBMITTED"), review: statusCount("PENDING_REVIEW"), interviews: statusCount("INTERVIEW"), offers: statusCount("OFFER") },
    countries: countryRows,
    matches,
    applications,
    jobProfiles: (jobProfilesResult.data ?? []).map((profile) => ({ ...profile, filters: (profile.filters ?? {}) as Record<string, unknown> })),
    discoveredJobs: (discoveredJobsResult.data ?? []).map((job) => {
      const company = job.companies as unknown as { name: string } | null;
      const evaluations = job.job_evaluations as unknown as { job_profile_id: string; match_score: number; decision: string; explanation: string }[] | null;
      const best = evaluations ? [...evaluations].sort((a, b) => Number(b.match_score) - Number(a.match_score))[0] : undefined;
      const profile = best ? (jobProfilesResult.data ?? []).find((item) => item.id === best.job_profile_id) : null;
      return { id: job.id, title: job.title, company: company?.name ?? "Company", location: job.location ?? "Location not listed", country: job.country, url: job.canonical_url, source: job.source_name, discoveredAt: job.discovered_at, match: best ? { profile: profile?.name ?? "Job profile", score: Math.round(Number(best.match_score)), decision: best.decision, explanation: best.explanation } : null };
    }),
    companies: [...profileCompanies.entries()].map(([key, target]) => {
      const catalog = companyCatalog.get(key);
      const saved = savedCompanyByKey.get(key);
      return { id: saved?.id ?? null, name: catalog?.name ?? target.name, careersUrl: saved?.website_url ?? catalog?.careers_url ?? null, logoUrl: catalog?.logo_url ?? null, sourcePlatform: catalog?.source_platform ?? null, profiles: target.profiles, catalogued: Boolean(catalog) };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    agent: { desiredEnabled: settingsResult.data?.desired_enabled ?? false, runtimeStatus: settingsResult.data?.runtime_status ?? "UNKNOWN", heartbeat, lastRun: runsResult.data?.completed_at ?? null, lastRunStatus: runsResult.data?.status ?? null },
  };
  return <RolePilotDashboard data={payload} />;
}
