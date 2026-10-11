"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Activity, Bell, BriefcaseBusiness, Building2,
  CalendarDays, ChevronDown, Command, Compass, FileText, Gift, Globe2,
  LayoutDashboard, LoaderCircle, LogOut, MoreHorizontal, Moon, ScanSearch, Search, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Sun, Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Page = "Dashboard" | "Discover Jobs" | "Applications" | "Companies" | "Job Profiles" | "Agent Activity" | "Settings";
type Theme = "light" | "dark";
export type DashboardPayload = {
  userId: string;
  fullName: string | null;
  email: string;
  stats: { jobs: number; qualified: number; submitted: number; review: number; interviews: number; offers: number };
  countries: { name: string; count: number }[];
  matches: { jobId: string; title: string; place: string; company: string; score: number }[];
  applications: { id: string; company: string; role: string; location: string; status: string; date: string | null }[];
  jobProfiles: { id: string; name: string; category: string; enabled: boolean; filters: Record<string, unknown> }[];
  discoveredJobs: { id: string; title: string; company: string; location: string; country: string | null; url: string | null; source: string; discoveredAt: string; match: { profile: string; score: number; decision: string; explanation: string } | null }[];
  companies: { id: string | null; name: string; careersUrl: string | null; logoUrl: string | null; sourcePlatform: string | null; profiles: string[]; catalogued: boolean }[];
  agent: { desiredEnabled: boolean; runtimeStatus: string; heartbeat: string | null; lastRun: string | null; lastRunStatus: string | null };
};

const navigation: { name: Page; icon: typeof LayoutDashboard }[] = [
  { name: "Dashboard", icon: LayoutDashboard }, { name: "Discover Jobs", icon: ScanSearch },
  { name: "Applications", icon: BriefcaseBusiness }, { name: "Companies", icon: Building2 },
  { name: "Job Profiles", icon: SlidersHorizontal }, { name: "Agent Activity", icon: Activity },
  { name: "Settings", icon: Settings },
];

function Brand() { return <div className="brand"><span className="brand-mark"><Command size={17} /></span><span>RolePilot</span></div>; }

function Sidebar({ active, onChange, email }: { active: Page; onChange: (page: Page) => void; email: string }) {
  const router = useRouter();
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return <aside className="sidebar"><Brand />
    <div className="workspace"><span className="workspace-avatar">{email.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><b>Personal workspace</b><small>Private job search</small></span><ChevronDown size={14} /></div>
    <div className="sidebar-label">Workspace</div><nav className="sidebar-nav" aria-label="Workspace navigation">{navigation.slice(0, 5).map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${active === name ? "active" : ""}`} onClick={() => onChange(name)}><Icon size={16} /><span>{name}</span>{name === "Discover Jobs" && <i className="nav-count">·</i>}</button>)}</nav>
    <div className="sidebar-label system-label">System</div><nav className="sidebar-nav" aria-label="System navigation">{navigation.slice(5).map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${active === name ? "active" : ""}`} onClick={() => onChange(name)}><Icon size={16} /><span>{name}</span></button>)}</nav>
    <div className="sidebar-spacer" /><div className="sidebar-user"><span className="user-avatar">{email.slice(0, 1).toUpperCase()}</span><span><b>{email}</b><small>Authenticated account</small></span><button className="sign-out" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></div>
  </aside>;
}

function Header({ page, theme, onToggleTheme }: { page: Page; theme: Theme; onToggleTheme: () => void }) {
  const dark = theme === "dark";
  const now = new Date();
  const period = new Intl.DateTimeFormat("en", { month: "long", timeZone: "Asia/Kolkata" }).format(now);
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(now);
  return <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{page === "Dashboard" ? "Analytics overview" : page}</b></div>
    <div className="top-actions"><span className="prototype-pill"><i /> Live account</span><span className="period-picker"><CalendarDays size={14} /> {period} 1 – 31, {year} <ChevronDown size={13} /></span>
      <button className="theme-toggle" onClick={onToggleTheme} aria-label={dark ? "Switch to Arctic light theme" : "Switch to Obsidian violet dark theme"} title={dark ? "Switch to Arctic light" : "Switch to Obsidian violet"}>{dark ? <Sun size={15} /> : <Moon size={15} />}<span>{dark ? "Light" : "Dark"}</span></button>
      <button className="icon-button" aria-label="Search"><Search size={16} /></button><button className="icon-button notification" aria-label="Notifications"><Bell size={16} /><i /></button>
    </div>
  </header>;
}

function Metric({ label, value, delta, icon: Icon, calm = false }: { label: string; value: number; delta: string; icon: typeof Compass; calm?: boolean }) {
  return <article className="metric-card"><div className="metric-heading"><span>{label}</span><Icon size={16} /></div><strong>{value.toLocaleString()}</strong><div className={`metric-change ${calm ? "calm" : ""}`}>{delta}</div></article>;
}

function TrendChart({ applications }: { applications: DashboardPayload["applications"] }) {
  const now = new Date();
  const recentDates = applications.map((application) => application.date ? new Date(application.date) : null).filter((date): date is Date => Boolean(date && !Number.isNaN(date.getTime())));
  const count = recentDates.filter((date) => now.getTime() - date.getTime() <= 30 * 24 * 60 * 60 * 1000).length;
  const noActivity = applications.length === 0;
  return <div className="trend-chart" role="img" aria-label={`Application activity for the last 30 days. ${count} application records in recent results.`}>
    <div className="chart-y-labels"><span>{Math.max(count, 4)}</span><span>{Math.max(count, 4) * .75}</span><span>{Math.max(count, 4) * .5}</span><span>{Math.max(count, 4) * .25}</span><span>0</span></div>
    <div className="chart-plot"><div className="chart-empty">{noActivity ? "Your application trend will appear after you add application records." : `${count} recent application${count === 1 ? "" : "s"} in the current results.`}</div><div className="chart-x-labels"><span>30 days ago</span><span>21 days</span><span>14 days</span><span>7 days</span><span>Today</span></div></div>
  </div>;
}

function SearchFunnel({ stats }: { stats: DashboardPayload["stats"] }) {
  const max = Math.max(stats.jobs, 1);
  const stages = [{ name: "Discovered", value: stats.jobs }, { name: "Qualified", value: stats.qualified }, { name: "Pending review", value: stats.review }, { name: "Submitted", value: stats.submitted }, { name: "Interviews", value: stats.interviews }, { name: "Offers", value: stats.offers }];
  return <article className="panel funnel-panel"><div className="panel-heading"><div><h2>Search funnel</h2><p>Current records in your workspace</p></div><MoreHorizontal size={17} /></div><div className="funnel-list">{stages.map((stage) => <div className="funnel-row" key={stage.name}><span>{stage.name}</span><div className="funnel-track"><i style={{ width: `${Math.max(stage.value / max * 100, stage.value ? 3 : 0)}%` }} /></div><b>{stage.value.toLocaleString()}</b></div>)}</div></article>;
}

function Dashboard({ data }: { data: DashboardPayload }) {
  const welcome = data.fullName ? `Welcome back, ${data.fullName}` : "Your search performance";
  const maxCountry = Math.max(1, ...data.countries.map((country) => country.count));
  const agentState = !data.agent.desiredEnabled ? "Disabled" : data.agent.heartbeat ? data.agent.runtimeStatus : "Enabled · waiting for local agent";
  return <>
    <section className="page-intro"><div><div className="eyebrow">PERSONAL SEARCH ANALYTICS</div><h1>{welcome}</h1><p>Your opportunities, applications, and local agent status.</p></div><div className="profile-chips"><span><i className="india-dot" /> India product</span><span><i className="global-dot" /> Global sponsorship</span></div></section>
    <div className="live-note"><ShieldCheck size={14} /><span>Connected to your account · Counts below come from your database.</span></div>
    <section className="metric-grid" aria-label="Search summary metrics"><Metric label="Jobs discovered" value={data.stats.jobs} delta="Stored job records" icon={Compass} /><Metric label="Qualified" value={data.stats.qualified} delta="Saved evaluations" icon={Sparkles} /><Metric label="Applications" value={data.stats.submitted} delta="Submitted" icon={FileText} /><Metric label="Interviews" value={data.stats.interviews} delta="In progress" icon={Users} calm /><Metric label="Offers" value={data.stats.offers} delta="Recorded" icon={Gift} calm /></section>
    <section className="analytics-grid"><article className="panel trend-panel"><div className="panel-heading"><div><h2>Application activity</h2><p>Based on saved application records</p></div><span className="chart-legend"><i /> Applications</span></div><TrendChart applications={data.applications} /></article><SearchFunnel stats={data.stats} /></section>
    <section className="detail-grid">
      <article className="panel geography-panel"><div className="panel-heading"><div><h2>Geographic coverage</h2><p>Stored jobs by country</p></div><Globe2 size={16} /></div>{data.countries.length ? <div className="country-list">{data.countries.map((country) => <div className="country-row" key={country.name}><span>{country.name}</span><div className={`country-track ${country.name === "India" ? "home" : ""}`}><i style={{ width: `${country.count / maxCountry * 100}%` }} /></div><b>{country.count.toLocaleString()}</b></div>)}</div> : <p className="panel-empty">Country breakdown appears when discovered jobs are stored.</p>}</article>
      <article className="panel matches-panel"><div className="panel-heading"><div><h2>Best-fit opportunities</h2><p>Your highest-scored saved evaluations</p></div></div>{data.matches.length ? <div className="match-list">{data.matches.map((job) => <div className="match-row" key={job.jobId}><span className="company-avatar">{job.company.slice(0, 1).toUpperCase()}</span><div className="match-copy"><b>{job.title}</b><small>{job.company} · {job.place}</small></div><span className="fit-score">{job.score}%</span></div>)}</div> : <p className="panel-empty">No evaluations yet. Qualified matches will appear here after discovery and review.</p>}</article>
      <article className="panel run-panel"><div className="panel-heading"><div><h2>Agent run health</h2><p>Reported by your local agent</p></div><span className={`ready-pill ${data.agent.heartbeat ? "connected" : "offline"}`}><i />{data.agent.heartbeat ? "Connected" : "Offline"}</span></div><div className="agent-status-line">{agentState}</div><div className="run-line"><span>Last successful run</span><b>{data.agent.lastRun ?? "No completed run"}</b></div>{data.agent.lastRunStatus && <div className="run-line"><span>Latest run status</span><b>{data.agent.lastRunStatus}</b></div>}</article>
    </section>
    <section className="panel applications-panel"><div className="panel-heading"><div><h2>Recent applications</h2><p>Latest saved application records</p></div></div>{data.applications.length ? <div className="table-wrap"><table><thead><tr><th>COMPANY</th><th>ROLE</th><th>LOCATION</th><th>STATUS</th><th>APPLIED</th></tr></thead><tbody>{data.applications.map((application) => <tr key={application.id}><td><b>{application.company}</b></td><td>{application.role}</td><td>{application.location}</td><td><span className="status-tag"><i />{application.status.replaceAll("_", " ")}</span></td><td>{application.date ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(application.date)) : "—"}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No application records yet. Nothing is submitted automatically.</p>}</section>
  </>;
}

const asList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const textValue = (value: unknown) => typeof value === "string" ? value : "";
const boolValue = (value: unknown) => typeof value === "boolean" ? value : null;

function JobProfiles({ data }: { data: DashboardPayload }) {
  const supabase = createClient();
  const [profiles, setProfiles] = useState(data.jobProfiles);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function setEnabled(id: string, enabled: boolean) {
    setBusy(id); setMessage("");
    const { error } = await supabase.from("job_profiles").update({ enabled }).eq("id", id);
    if (error) setMessage(error.message);
    else setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, enabled } : profile));
    setBusy(null);
  }

  async function addProfile() {
    setBusy("new"); setMessage("");
    const { data: created, error } = await supabase.from("job_profiles").insert({
      user_id: data.userId, name: "New search profile", category: "custom", enabled: true,
      filters: { countries: [], preferred_cities: [], target_roles: [], skills: [], minimum_experience: null, sponsorship_required: null, relocation_preference: null, minimum_compensation: null, compensation_currency: null, target_companies: [], excluded_companies: [] },
    }).select("id, name, category, enabled, filters").single();
    if (error) setMessage(error.message);
    else if (created) setProfiles((current) => [...current, { ...created, filters: (created.filters ?? {}) as Record<string, unknown> }]);
    setBusy(null);
  }

  async function saveProfile(id: string, formData: FormData) {
    const current = profiles.find((profile) => profile.id === id);
    if (!current) return;
    setBusy(id); setMessage("");
    const read = (key: string) => String(formData.get(key) ?? "");
    const list = (key: string) => read(key).split(",").map((part) => part.trim()).filter(Boolean);
    const number = (key: string) => read(key).trim() === "" ? null : Number(read(key));
    const sponsorship = read("sponsorship_required");
    const relocation = read("relocation_preference");
    const filters: Record<string, unknown> = {
      ...current.filters,
      countries: list("countries"), preferred_cities: list("preferred_cities"), target_roles: list("target_roles"), skills: list("skills"),
      additional_interests: list("additional_interests"),
      minimum_experience: number("minimum_experience"),
      sponsorship_required: sponsorship === "unknown" ? null : sponsorship === "true",
      relocation_preference: relocation === "unknown" ? null : relocation === "true",
      minimum_compensation: number("minimum_compensation"), maximum_compensation: number("maximum_compensation"), compensation_currency: read("compensation_currency") || null,
      target_companies: list("target_companies"), excluded_companies: list("excluded_companies"),
    };
    const name = read("name").trim() || "Untitled profile";
    const category = read("category");
    const { error } = await supabase.from("job_profiles").update({ name, category, filters }).eq("id", id);
    if (error) setMessage(error.message);
    else setProfiles((items) => items.map((profile) => profile.id === id ? { ...profile, name, category, filters } : profile));
    setBusy(null);
  }

  async function deleteProfile(id: string) {
    if (!window.confirm("Delete this job profile? Existing applications and evaluations may prevent deletion.")) return;
    setBusy(id); setMessage("");
    const { error } = await supabase.from("job_profiles").delete().eq("id", id);
    if (error) setMessage(error.message);
    else setProfiles((items) => items.filter((profile) => profile.id !== id));
    setBusy(null);
  }

  return <section className="profiles-page">
    <div className="profiles-heading"><div><div className="eyebrow">PERSONAL SEARCH CONFIGURATION</div><h1>Job Profiles</h1><p>Search criteria are editable and only affect future discovery and evaluation.</p></div><button className="profile-add" onClick={addProfile} disabled={busy !== null}>+ Add profile</button></div>
    <div className="profiles-guidance"><ShieldCheck size={16} /><span><b>Built from your project brief.</b> Your listed 7+ years, roles, skills and target countries seed the two starter profiles. Locations, pay, exclusions and relocation remain editable or unspecified where the brief did not provide values.</span></div>
    {message && <p className="profile-error" role="alert">{message}</p>}
    {!profiles.length && <article className="panel profile-empty"><h2>No saved profiles yet</h2><p>Use “Add profile” to create a custom search profile. Run the new starter-profile migration to seed the India and Global profiles for this account.</p></article>}
    <div className="profiles-grid">{profiles.map((profile) => {
      const filters = profile.filters;
      const sponsorship = boolValue(filters.sponsorship_required);
      const relocation = boolValue(filters.relocation_preference);
      return <form key={profile.id} className="panel profile-card" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void saveProfile(profile.id, new FormData(event.currentTarget)); }}>
        <div className="profile-card-head"><span className={`profile-kind ${profile.category}`}>{profile.category === "india_product" ? "India product" : profile.category === "global_sponsored" ? "Global sponsored" : "Custom profile"}</span><label className="profile-enabled"><input type="checkbox" checked={profile.enabled} onChange={(event) => setEnabled(profile.id, event.target.checked)} disabled={busy === profile.id} /> Enabled</label></div>
        <label className="profile-field">Profile name<input name="name" defaultValue={profile.name} required /></label>
        <label className="profile-field">Profile type<select name="category" defaultValue={profile.category}><option value="india_product">India product companies</option><option value="global_sponsored">Global visa-sponsored</option><option value="custom">Custom</option></select></label>
        <div className="profile-fields-two">
          <label className="profile-field">Countries, comma separated<input name="countries" defaultValue={asList(filters.countries).join(", ")} /></label>
          <label className="profile-field">Preferred cities, comma separated<input name="preferred_cities" defaultValue={asList(filters.preferred_cities).join(", ")} placeholder="Not specified" /></label>
        </div>
        <label className="profile-field">Target roles, comma separated<input name="target_roles" defaultValue={asList(filters.target_roles).join(", ")} /></label>
        <label className="profile-field">Skills, comma separated<textarea name="skills" rows={3} defaultValue={asList(filters.skills).join(", ")} /></label>
        <label className="profile-field">Additional interests, comma separated<input name="additional_interests" defaultValue={asList(filters.additional_interests).join(", ")} /></label>
        <div className="profile-fields-two">
          <label className="profile-field">Minimum experience (years)<input name="minimum_experience" type="number" min="0" step="0.5" defaultValue={typeof filters.minimum_experience === "number" ? filters.minimum_experience : ""} placeholder="Not specified" /></label>
          <label className="profile-field">Minimum compensation<input name="minimum_compensation" type="number" min="0" step="1000" defaultValue={typeof filters.minimum_compensation === "number" ? filters.minimum_compensation : ""} placeholder="Not specified" /></label>
        </div>
        <label className="profile-field">Maximum compensation<input name="maximum_compensation" type="number" min="0" step="1000" defaultValue={typeof filters.maximum_compensation === "number" ? filters.maximum_compensation : ""} placeholder="Not specified" /></label>
        <div className="profile-fields-two">
          <label className="profile-field">Compensation currency<input name="compensation_currency" defaultValue={textValue(filters.compensation_currency)} placeholder="Not specified" /></label>
          <label className="profile-field">Visa sponsorship<select name="sponsorship_required" defaultValue={sponsorship === null ? "unknown" : String(sponsorship)}><option value="unknown">Not specified</option><option value="true">Required</option><option value="false">Not required</option></select></label>
        </div>
        <div className="profile-fields-two">
          <label className="profile-field">Relocation preference<select name="relocation_preference" defaultValue={relocation === null ? "unknown" : String(relocation)}><option value="unknown">Not specified</option><option value="true">Open to relocation</option><option value="false">Not open to relocation</option></select></label>
          <label className="profile-field">Target companies, comma separated<input name="target_companies" defaultValue={asList(filters.target_companies).join(", ")} placeholder="Add company names, e.g. Amazon, Flipkart" /></label>
        </div>
        <label className="profile-field">Excluded companies, comma separated<input name="excluded_companies" defaultValue={asList(filters.excluded_companies).join(", ")} placeholder="None" /></label>
        <div className="profile-card-actions"><button className="auth-submit profile-save" type="submit" disabled={busy === profile.id}>{busy === profile.id ? "Saving…" : "Save profile"}</button><button className="profile-delete" type="button" onClick={() => deleteProfile(profile.id)} disabled={busy === profile.id}>Delete</button></div>
      </form>;
    })}</div>
  </section>;
}

function DiscoverJobs({ data }: { data: DashboardPayload }) {
  const router = useRouter();
  const profiles = data.jobProfiles.filter((profile) => profile.enabled);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [progress, setProgress] = useState<{ name: string; status: "pending" | "checking" | "complete" | "error"; fetched?: number; matched?: number; saved?: number; error?: string }[]>([]);
  const [progressTotal, setProgressTotal] = useState(0);

  async function discover() {
    setBusy(true); setMessage(""); setProblem(""); setProgress([]); setProgressTotal(0);
    try {
      const response = await fetch("/api/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId }) });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || "Could not discover jobs.");
      }
      if (!response.body) throw new Error("Discovery progress stream was unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      function handleEvent(event: { type?: string; profile?: string; companies?: string[]; total?: number; name?: string; status?: "checking" | "complete" | "error"; fetched?: number; matched?: number; saved?: number; error?: string; checked?: number; sourcesWithPostings?: number; sourceErrors?: string[] }) {
        if (event.type === "start") {
          const names = event.companies ?? [];
          setProgressTotal(event.total ?? names.length);
          setProgress(names.map((name) => ({ name, status: "pending" as const })));
        } else if (event.type === "company" && event.name && event.status) {
          const name = event.name;
          const status = event.status;
          setProgress((current) => current.map((company) => company.name === name ? { ...company, status, fetched: event.fetched, matched: event.matched, saved: event.saved, error: event.error } : company));
        } else if (event.type === "complete") {
          finished = true;
          setMessage(`${event.profile}: queried ${event.checked ?? 0} company sources; ${event.sourcesWithPostings ?? 0} returned postings (${event.fetched ?? 0} total); ${event.matched ?? 0} matched your profile; added ${event.saved ?? 0} new job${event.saved === 1 ? "" : "s"}.`);
          if (event.sourceErrors?.length) setProblem(event.sourceErrors.join(" "));
        } else if (event.type === "error") throw new Error(event.error || "Discovery failed.");
      }
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer));
      if (!finished) throw new Error("Discovery ended before the result summary arrived.");
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not discover jobs.");
    } finally { setBusy(false); }
  }

  return <section className="discover-page">
    <div className="page-intro"><div><div className="eyebrow">AUTOMATED CAREERS-PAGE MONITOR</div><h1>Discover Jobs</h1><p>RolePilot checks backend-catalogued careers sources daily for new public listings. No applications are submitted.</p></div></div>
    <article className="panel discovery-controls"><div><h2>Check a profile now</h2><p>The scheduled scan runs daily after deployment. Use this for an immediate scan while configuring your sources.</p></div><div className="discover-actions"><select aria-label="Job profile" value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={busy || profiles.length === 0}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button className="profile-add" onClick={discover} disabled={busy || !profileId}>{busy ? "Checking careers pages…" : "Check now"}</button></div>
      {!profiles.length && <p className="panel-empty">Enable a job profile with target companies first.</p>}
      {message && <p className="discover-success" role="status">{message}</p>}{problem && <p className="profile-error" role="alert">{problem}</p>}
      {busy && progress.length > 0 && <div className="discovery-progress" role="status" aria-live="polite">
        <div className="discovery-progress-heading"><span><LoaderCircle className="discovery-spinner" size={15} /> Checking companies</span><b>{progress.filter((company) => company.status === "complete" || company.status === "error").length} / {progressTotal}</b></div>
        <div className="discovery-progress-track"><i style={{ width: `${progressTotal ? progress.filter((company) => company.status === "complete" || company.status === "error").length / progressTotal * 100 : 0}%` }} /></div>
        <div className="discovery-company-list">{progress.map((company) => <div className={`discovery-company-row ${company.status}`} key={company.name}>
          <span className="discovery-company-indicator">{company.status === "checking" ? <LoaderCircle className="discovery-spinner" size={14} /> : company.status === "complete" ? "✓" : company.status === "error" ? "!" : "·"}</span>
          <span className="discovery-company-name">{company.name}</span>
          <span className="discovery-company-result">{company.status === "checking" ? "Checking…" : company.status === "error" ? "Source unavailable" : company.status === "complete" ? `${company.fetched ?? 0} postings · ${company.matched ?? 0} matches` : "Waiting"}</span>
        </div>)}</div>
      </div>}
    </article>
    <article className="panel discovery-help"><h2>How automatic discovery works</h2><p>RolePilot resolves target organizations from the backend company catalog, then detects Greenhouse, Lever, Ashby, and SmartRecruiters public job boards or reads standard JobPosting data. Listings are deduplicated and keep the original posting link.</p><p>Some companies use custom systems or block automated reading; those need a dedicated connector before RolePilot can import their listings. Confirm sponsorship and experience fit on the employer’s posting.</p></article>
    <div className="discover-results-heading"><div><h2>Recently discovered</h2><p>Latest saved public postings</p></div><span>{data.discoveredJobs.length} shown</span></div>
    {!data.discoveredJobs.length ? <article className="panel profile-empty"><h2>No discovered jobs yet</h2><p>Company sources are resolved from the backend catalog. Run a scan now or wait for the scheduled daily scan.</p></article> : <div className="discovered-list">{data.discoveredJobs.map((job) => <article className="panel discovered-card" key={job.id}><div className="discovered-card-top"><span className="profile-kind">{job.source}</span><time>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(job.discoveredAt))}</time></div><h3>{job.title}</h3><p>{job.company} · {job.location}</p>{job.match && <div className="job-match-summary"><span className={`match-decision ${job.match.decision.toLowerCase()}`}>{job.match.decision.replaceAll("_", " ")} · {job.match.score}%</span><small>{job.match.profile}: {job.match.explanation}</small></div>}<div className="discovered-card-bottom"><span>{job.country ?? "Country not identified"} · Visa sponsorship unverified</span>{job.url ? <a href={job.url} target="_blank" rel="noreferrer">View original posting ↗</a> : <span>Original link unavailable</span>}</div></article>)}</div>}
  </section>;
}

function CompanyLogo({ company }: { company: DashboardPayload["companies"][number] }) {
  const [failed, setFailed] = useState(false);
  return company.logoUrl && !failed
    ? <Image className="company-logo" src={company.logoUrl} alt={`${company.name} logo`} width={36} height={36} unoptimized onError={() => setFailed(true)} />
    : <span className="company-avatar">{company.name.slice(0, 1).toLocaleUpperCase()}</span>;
}

function CompanyDirectory({ data }: { data: DashboardPayload }) {
  return <section className="companies-page">
    <div className="page-intro"><div><div className="eyebrow">PROFILE-DRIVEN COMPANY CATALOG</div><h1>Companies</h1><p>Only organizations in your job profiles appear here. Careers sources and logos are managed in RolePilot’s backend catalog.</p></div></div>
    <div className="company-directory">{data.companies.map((company) => <article className="panel company-card" key={company.name}>
      <div className="company-card-heading"><CompanyLogo company={company} /><div><h2>{company.name}</h2><small>{company.profiles.join(" · ")}</small></div><span className={`company-source-state ${company.catalogued ? "ready" : "pending"}`}><i />{company.catalogued ? "Career page registered" : "Needs source mapping"}</span></div>
      <div className="company-source-details"><span>Connector</span><b>{company.sourcePlatform === "auto" ? "Auto-detected" : company.sourcePlatform ?? "Career page resolver"}</b></div>
      {company.careersUrl && <a className="careers-link" href={company.careersUrl} target="_blank" rel="noopener noreferrer">Open official careers page ↗</a>}
    </article>)}</div>
    {!data.companies.length && <article className="panel profile-empty"><h2>No companies in profiles</h2><p>Add target companies in Job Profiles to see their catalog entries here.</p></article>}
  </section>;
}

export default function RolePilotDashboard({ data }: { data: DashboardPayload }) {
  const [active, setActive] = useState<Page>("Dashboard");
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = window.localStorage.getItem("rolepilot-theme");
    const initial: Theme = saved === "dark" ? "dark" : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);
  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("rolepilot-theme", next);
  }
  return <div className="app-shell"><Sidebar active={active} onChange={setActive} email={data.email} /><main className="main"><Header page={active} theme={theme} onToggleTheme={toggleTheme} /><div className="page-content">{active === "Dashboard" ? <Dashboard data={data} /> : active === "Job Profiles" ? <JobProfiles data={data} /> : active === "Discover Jobs" ? <DiscoverJobs data={data} /> : active === "Companies" ? <CompanyDirectory data={data} /> : <section className="empty-page"><div className="empty-icon"><LayoutDashboard size={22} /></div><h1>{active}</h1><p>This section is ready for its next integration step.</p><span>No sample records are being presented as live data.</span></section>}<footer>© 2026 RolePilot <span>Your personal job-search analytics.</span></footer></div></main></div>;
}
