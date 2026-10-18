"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Activity, Bell, BriefcaseBusiness, Building2,
  CalendarDays, ChevronDown, Command, Compass, FileText, Gift, Globe2,
  LayoutDashboard, LoaderCircle, LogOut, Moon, ScanSearch, Search, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Sun, Users, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CompanyTargetInput } from "@/components/company-target-input";

type Page = "Dashboard" | "Discover Jobs" | "Applications" | "Companies" | "Job Profiles" | "Agent Activity" | "Settings";
type Theme = "light" | "dark";
export type DashboardPayload = {
  userId: string;
  fullName: string | null;
  email: string;
  profile: { experienceYears: number | null; skills: string[]; targetRoles: string[]; homeCountry: string | null; preferredCities: string[]; globalCountries: string[]; dreamCompanies: string[]; sponsorshipRequired: boolean };
  stats: { jobs: number; qualified: number; submitted: number; review: number; interviews: number; offers: number };
  countries: { name: string; count: number }[];
  matches: { jobId: string; title: string; place: string; company: string; score: number }[];
  applications: { id: string; company: string; role: string; location: string; status: string; date: string | null }[];
  jobProfiles: { id: string; name: string; category: string; enabled: boolean; filters: Record<string, unknown> }[];
  catalogCompanies: { name: string; normalizedName: string }[];
  discoveredJobs: { id: string; title: string; company: string; location: string; country: string | null; url: string | null; source: string; discoveredAt: string; match: { profile: string; score: number; decision: string; explanation: string } | null }[];
  companies: { id: string | null; name: string; careersUrl: string | null; logoUrl: string | null; sourcePlatform: string | null; profiles: string[]; catalogued: boolean }[];
  agent: {
    desiredEnabled: boolean;
    runtimeStatus: string;
    heartbeat: string | null;
    online: boolean;
    runs: { id: string; status: string; startedAt: string | null; completedAt: string | null; triggerType: string; recoveryDetails: string | null; errorSummary: string | null }[];
    events: { id: string; type: string; message: string; occurredAt: string }[];
  };
};

const navigation: { name: Page; icon: typeof LayoutDashboard }[] = [
  { name: "Dashboard", icon: LayoutDashboard }, { name: "Discover Jobs", icon: ScanSearch },
  { name: "Applications", icon: BriefcaseBusiness }, { name: "Companies", icon: Building2 },
  { name: "Job Profiles", icon: SlidersHorizontal }, { name: "Agent Activity", icon: Activity },
  { name: "Settings", icon: Settings },
];

function Brand({ onClick }: { onClick: () => void }) { return <button type="button" className="brand" onClick={onClick} aria-label="RolePilot home"><span className="brand-mark"><Command size={17} /></span><span>RolePilot</span></button>; }

function Sidebar({ active, onChange, email, fullName }: { active: Page; onChange: (page: Page) => void; email: string; fullName: string | null }) {
  const router = useRouter();
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return <aside className="sidebar"><Brand onClick={() => onChange("Dashboard")} />
    <div className="workspace"><span className="workspace-avatar">{email.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><b>Personal workspace</b><small>Private job search</small></span><ChevronDown size={14} /></div>
    <div className="sidebar-label">Workspace</div><nav className="sidebar-nav" aria-label="Workspace navigation">{navigation.slice(0, 5).map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${active === name ? "active" : ""}`} onClick={() => onChange(name)}><Icon size={16} /><span>{name}</span>{name === "Discover Jobs" && <i className="nav-count">·</i>}</button>)}</nav>
    <div className="sidebar-label system-label">System</div><nav className="sidebar-nav" aria-label="System navigation">{navigation.slice(5).map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${active === name ? "active" : ""}`} onClick={() => onChange(name)}><Icon size={16} /><span>{name}</span></button>)}</nav>
    <div className="sidebar-spacer" /><div className="sidebar-user"><span className="user-avatar">{(fullName?.slice(0, 1) || email.slice(0, 1)).toUpperCase()}</span><span><b>{fullName || email}</b><small>{email}</small></span><button className="sign-out" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></div>
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

function AgentToggle({ data, compact = false }: { data: DashboardPayload; compact?: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(data.agent.desiredEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setEnabled(data.agent.desiredEnabled), [data.agent.desiredEnabled]);

  async function changeDesiredState(next: boolean, confirmed = false) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/agent/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desiredEnabled: next, confirmStop: confirmed }),
      });
      const result = await response.json() as { error?: string; confirmationRequired?: boolean };
      if (response.status === 409 && result.confirmationRequired && !confirmed) {
        const accepted = window.confirm("The agent reports a running task. Ask it to stop after its current safe checkpoint?");
        if (accepted) await changeDesiredState(next, true);
        else setBusy(false);
        return;
      }
      if (!response.ok) throw new Error(result.error || "Could not update agent settings.");
      setEnabled(next);
      setMessage(next ? "Enabled · waiting for local process" : "Disabled · no new work will start");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update agent settings.");
      setEnabled(data.agent.desiredEnabled);
    } finally { setBusy(false); }
  }

  return <div className={`agent-control-inline ${compact ? "compact" : ""}`}>
    <div><b>{enabled ? "Agent enabled" : "Agent disabled"}</b><small>{data.agent.online ? "Local process online" : "Local process offline"}</small></div>
    <button type="button" role="switch" aria-checked={enabled} aria-label="Enable local agent" className={`agent-switch ${enabled ? "is-on" : ""}`} disabled={busy} onClick={() => void changeDesiredState(!enabled)}><span /></button>
    {message && <small className="agent-toggle-message" role="status">{message}</small>}
  </div>;
}

function ApplicationActivity({ applications }: { applications: DashboardPayload["applications"] }) {
  if (!applications.length) return <p className="panel-empty activity-empty">Application updates will appear here when you add records.</p>;
  return <div className="activity-feed">{applications.slice(0, 5).map((application) => <div className="activity-item" key={application.id}>
    <span className={`activity-marker ${application.status.toLocaleLowerCase()}`}><BriefcaseBusiness size={13} /></span>
    <div><b>{application.company}</b><p>{application.role}</p></div>
    <div className="activity-meta"><span className={`activity-status ${application.status.toLocaleLowerCase()}`}>{application.status.replaceAll("_", " ")}</span><time>{application.date ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(application.date)) : "Date not set"}</time></div>
  </div>)}</div>;
}

function SearchFunnel({ stats }: { stats: DashboardPayload["stats"] }) {
  const max = Math.max(stats.jobs, 1);
  const stages = [{ name: "Discovered", value: stats.jobs }, { name: "Qualified", value: stats.qualified }, { name: "Pending review", value: stats.review }, { name: "Submitted", value: stats.submitted }, { name: "Interviews", value: stats.interviews }, { name: "Offers", value: stats.offers }];
  return <article className="panel funnel-panel"><div className="panel-heading"><div><h2>Search funnel</h2><p>Progress across your saved job records</p></div></div><div className="funnel-list">{stages.map((stage) => <div className="funnel-row" key={stage.name}><span>{stage.name}</span><div className="funnel-track"><i style={{ width: `${Math.max(stage.value / max * 100, stage.value ? 3 : 0)}%` }} /></div><b>{stage.value.toLocaleString()}</b></div>)}</div></article>;
}

function Dashboard({ data }: { data: DashboardPayload }) {
  const welcome = data.fullName ? `Welcome back, ${data.fullName}` : "Your search performance";
  const maxCountry = Math.max(1, ...data.countries.map((country) => country.count));
  const agentState = !data.agent.desiredEnabled ? "Disabled" : data.agent.online ? "Enabled · idle" : "Enabled · local agent offline or overdue";
  const enabledProfiles = data.jobProfiles.filter((profile) => profile.enabled).length;
  return <div className="dashboard-home">
    <section className="dashboard-welcome"><div><div className="eyebrow">PERSONAL SEARCH ANALYTICS</div><h1>{welcome}</h1><p>Your opportunities, application progress, and local agent status.</p></div><div className="dashboard-welcome-meta"><span className="dashboard-data-badge"><ShieldCheck size={14} /> Account data</span><div><b>{enabledProfiles}</b><span>Active {enabledProfiles === 1 ? "profile" : "profiles"}</span></div></div></section>
    <section className="metric-grid" aria-label="Search summary metrics"><Metric label="Jobs discovered" value={data.stats.jobs} delta="Stored job records" icon={Compass} /><Metric label="Qualified" value={data.stats.qualified} delta="Saved evaluations" icon={Sparkles} /><Metric label="Applications" value={data.stats.submitted} delta="Submitted" icon={FileText} /><Metric label="Interviews" value={data.stats.interviews} delta="In progress" icon={Users} calm /><Metric label="Offers" value={data.stats.offers} delta="Recorded" icon={Gift} calm /></section>
    <section className="analytics-grid"><article className="panel activity-panel"><div className="panel-heading"><div><h2>Application activity</h2><p>Your latest saved application updates</p></div><Activity size={16} /></div><ApplicationActivity applications={data.applications} /></article><SearchFunnel stats={data.stats} /></section>
    <section className="detail-grid">
      <article className="panel geography-panel"><div className="panel-heading"><div><h2>Geographic coverage</h2><p>Stored jobs by country</p></div><Globe2 size={16} /></div>{data.countries.length ? <div className="country-list">{data.countries.map((country) => <div className="country-row" key={country.name}><span>{country.name}</span><div className={`country-track ${country.name === "India" ? "home" : ""}`}><i style={{ width: `${country.count / maxCountry * 100}%` }} /></div><b>{country.count.toLocaleString()}</b></div>)}</div> : <p className="panel-empty">Country breakdown appears when discovered jobs are stored.</p>}</article>
      <article className="panel matches-panel"><div className="panel-heading"><div><h2>Best-fit opportunities</h2><p>Your highest-scored saved evaluations</p></div></div>{data.matches.length ? <div className="match-list">{data.matches.map((job) => <div className="match-row" key={job.jobId}><span className="company-avatar">{job.company.slice(0, 1).toUpperCase()}</span><div className="match-copy"><b>{job.title}</b><small>{job.company} · {job.place}</small></div><span className="fit-score">{job.score}%</span></div>)}</div> : <p className="panel-empty">No evaluations yet. Qualified matches will appear here after discovery and review.</p>}</article>
      <article className="panel run-panel"><div className="panel-heading"><div><h2>Local agent health</h2><p>Heartbeat and lifecycle reported by your computer</p></div><span className={`ready-pill ${data.agent.online ? "connected" : "offline"}`}><i />{data.agent.online ? "Online" : "Offline"}</span></div><div className="agent-status-line">{agentState}</div><AgentToggle data={data} compact /><div className="run-line"><span>Last heartbeat</span><b>{data.agent.heartbeat ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.agent.heartbeat)) : "Never"}</b></div><div className="run-line"><span>Latest process session</span><b>{data.agent.runs[0]?.status ?? "No session recorded"}</b></div></article>
    </section>
    <section className="panel applications-panel"><div className="panel-heading"><div><h2>Recent applications</h2><p>Latest saved application records</p></div></div>{data.applications.length ? <div className="table-wrap"><table><thead><tr><th>COMPANY</th><th>ROLE</th><th>LOCATION</th><th>STATUS</th><th>APPLIED</th></tr></thead><tbody>{data.applications.map((application) => <tr key={application.id}><td><b>{application.company}</b></td><td>{application.role}</td><td>{application.location}</td><td><span className="status-tag"><i />{application.status.replaceAll("_", " ")}</span></td><td>{application.date ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(application.date)) : "—"}</td></tr>)}</tbody></table></div> : <p className="panel-empty">No application records yet. Nothing is submitted automatically.</p>}</section>
  </div>;
}

const asList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const textValue = (value: unknown) => typeof value === "string" ? value : "";
const boolValue = (value: unknown) => typeof value === "boolean" ? value : null;

function JobProfiles({ data }: { data: DashboardPayload }) {
  const supabase = createClient();
  const [profiles, setProfiles] = useState(data.jobProfiles);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<DashboardPayload["jobProfiles"][number] | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);

  function setEnabled(id: string, enabled: boolean) {
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, enabled } : profile));
  }

  async function addProfile() {
    setBusy("new"); setMessage("");
    const { data: created, error } = await supabase.from("job_profiles").insert({
      user_id: data.userId, name: "New search profile", category: "custom", enabled: true,
      filters: { countries: [], preferred_cities: [], target_roles: [], skills: [], minimum_experience: null, sponsorship_required: null, relocation_preference: null, minimum_compensation: null, compensation_currency: null, target_companies: [], excluded_companies: [] },
    }).select("id, name, category, enabled, filters").single();
    if (error) setMessage(error.message);
    else if (created) {
      const newProfile = { ...created, filters: (created.filters ?? {}) as Record<string, unknown> };
      setProfiles((current) => [...current, newProfile]);
      setEditSnapshot(newProfile);
      setEditingId(newProfile.id);
    }
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
    const { error } = await supabase.from("job_profiles").update({ name, category, filters, enabled: current.enabled }).eq("id", id);
    if (error) setMessage(error.message);
    else {
      setProfiles((items) => items.map((profile) => profile.id === id ? { ...profile, name, category, filters, enabled: current.enabled } : profile));
      setEditingId(null);
      setEditSnapshot(null);
    }
    setBusy(null);
  }

  function cancelEdit(profileId: string) {
    if (editSnapshot?.id === profileId) setProfiles((current) => current.map((profile) => profile.id === profileId ? editSnapshot : profile));
    setEditingId(null);
    setEditSnapshot(null);
    setMessage("");
  }

  useEffect(() => {
    if (!editingId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && busy !== editingId) {
        if (editSnapshot?.id === editingId) setProfiles((current) => current.map((profile) => profile.id === editingId ? editSnapshot : profile));
        setEditingId(null); setEditSnapshot(null); setMessage("");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingId, busy, editSnapshot]);

  async function deleteProfile(id: string) {
    if (!window.confirm("Delete this job profile? Existing applications and evaluations may prevent deletion.")) return;
    setBusy(id); setMessage("");
    const { error } = await supabase.from("job_profiles").delete().eq("id", id);
    if (error) setMessage(error.message);
    else {
      setProfiles((items) => items.filter((profile) => profile.id !== id));
      if (editingId === id) { setEditingId(null); setEditSnapshot(null); }
    }
    setBusy(null);
  }

  function renderProfileEditor(profile: DashboardPayload["jobProfiles"][number]) {
    const filters = profile.filters;
    const sponsorship = boolValue(filters.sponsorship_required);
    const relocation = boolValue(filters.relocation_preference);
    const sectionHeading = (number: string, title: string, description: string) => <div className="profile-editor-section-heading"><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div></div>;
    return <div className="profile-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== profile.id) cancelEdit(profile.id); }}>
      <section className="profile-drawer" role="dialog" aria-modal="true" aria-labelledby="profile-drawer-title">
        <form key={profile.id} className="profile-editor-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void saveProfile(profile.id, new FormData(event.currentTarget)); }}>
          <header className="profile-drawer-header"><div><span className="eyebrow">EDIT SEARCH PROFILE</span><h2 id="profile-drawer-title">{profile.name}</h2><p>Changes apply to future discovery and evaluation.</p></div><button type="button" className="profile-drawer-close" onClick={() => cancelEdit(profile.id)} disabled={busy === profile.id} aria-label="Close editor"><X size={18} /></button></header>
          <div className="profile-drawer-body">
            <label className="profile-enabled profile-enabled-editor"><input type="checkbox" checked={profile.enabled} onChange={(event) => setEnabled(profile.id, event.target.checked)} disabled={busy === profile.id} /> Enable this search profile</label>
            <section className="profile-editor-section">{sectionHeading("01", "Profile details", "Name and category shown in your profile selector.")}
              <label className="profile-field">Profile name<input name="name" defaultValue={profile.name} required disabled={busy === profile.id} /></label>
              <label className="profile-field">Profile type<select name="category" defaultValue={profile.category} disabled={busy === profile.id}><option value="india_product">India product companies</option><option value="global_sponsored">Global visa-sponsored</option><option value="custom">Custom</option></select></label>
            </section>
            <section className="profile-editor-section">{sectionHeading("02", "Roles & skills", "Set the terms used to score each job against this profile.")}
              <label className="profile-field">Target roles <small>Separate multiple roles with commas.</small><input name="target_roles" defaultValue={asList(filters.target_roles).join(", ")} placeholder="e.g. Backend Engineer, Technical Lead" disabled={busy === profile.id} /></label>
              <label className="profile-field">Skills <small>Separate skills with commas.</small><textarea name="skills" rows={3} defaultValue={asList(filters.skills).join(", ")} placeholder="e.g. TypeScript, AWS, PostgreSQL" disabled={busy === profile.id} /></label>
              <label className="profile-field">Additional interests <small>Optional keywords that help refine matching.</small><input name="additional_interests" defaultValue={asList(filters.additional_interests).join(", ")} placeholder="e.g. platform engineering, observability" disabled={busy === profile.id} /></label>
              <label className="profile-field">Minimum experience (years)<input name="minimum_experience" type="number" min="0" step="0.5" defaultValue={typeof filters.minimum_experience === "number" ? filters.minimum_experience : ""} placeholder="Not specified" disabled={busy === profile.id} /></label>
            </section>
            <section className="profile-editor-section">{sectionHeading("03", "Location", "Choose countries and cities to focus the search.")}
              <label className="profile-field">Countries, comma separated<input name="countries" defaultValue={asList(filters.countries).join(", ")} disabled={busy === profile.id} /></label>
              <label className="profile-field">Preferred cities, comma separated<input name="preferred_cities" defaultValue={asList(filters.preferred_cities).join(", ")} placeholder="Not specified" disabled={busy === profile.id} /></label>
              <label className="profile-field">Relocation preference<select name="relocation_preference" defaultValue={relocation === null ? "unknown" : String(relocation)} disabled={busy === profile.id}><option value="unknown">Not specified</option><option value="true">Open to relocation</option><option value="false">Not open to relocation</option></select></label>
            </section>
            <section className="profile-editor-section">{sectionHeading("04", "Compensation & sponsorship", "Optional filters for salary and visa requirements.")}
              <div className="profile-fields-two"><label className="profile-field">Minimum compensation<input name="minimum_compensation" type="number" min="0" step="1000" defaultValue={typeof filters.minimum_compensation === "number" ? filters.minimum_compensation : ""} placeholder="Not specified" disabled={busy === profile.id} /></label><label className="profile-field">Maximum compensation<input name="maximum_compensation" type="number" min="0" step="1000" defaultValue={typeof filters.maximum_compensation === "number" ? filters.maximum_compensation : ""} placeholder="Not specified" disabled={busy === profile.id} /></label></div>
              <div className="profile-fields-two"><label className="profile-field">Compensation currency<input name="compensation_currency" defaultValue={textValue(filters.compensation_currency)} placeholder="Not specified" disabled={busy === profile.id} /></label><label className="profile-field">Visa sponsorship<select name="sponsorship_required" defaultValue={sponsorship === null ? "unknown" : String(sponsorship)} disabled={busy === profile.id}><option value="unknown">Not specified</option><option value="true">Required</option><option value="false">Not required</option></select></label></div>
            </section>
            <section className="profile-editor-section">{sectionHeading("05", "Companies", "Prioritize organizations or leave this open to search broadly.")}
              <CompanyTargetInput companies={data.catalogCompanies} defaultValue={asList(filters.target_companies).join(", ")} disabled={busy === profile.id} fieldHint="Choose catalog matches or enter company names separated by commas." />
              <label className="profile-field">Excluded companies <small>Optional · separate company names with commas.</small><input name="excluded_companies" defaultValue={asList(filters.excluded_companies).join(", ")} placeholder="None" disabled={busy === profile.id} /></label>
            </section>
          </div>
          <footer className="profile-drawer-footer"><button type="button" className="profile-cancel" onClick={() => cancelEdit(profile.id)} disabled={busy === profile.id}>Cancel</button><button className="auth-submit profile-save" type="submit" disabled={busy === profile.id}>{busy === profile.id ? <><LoaderCircle className="spin" size={15} /> Saving…</> : "Save changes"}</button></footer>
        </form>
      </section>
    </div>;
  }

  const editingProfile = profiles.find((profile) => profile.id === editingId) ?? null;
  return <section className="profiles-page">
    <div className="profiles-heading"><div><div className="eyebrow">PERSONAL SEARCH CONFIGURATION</div><h1>Job Profiles</h1><p>Manage the searches that guide future job discovery.</p></div><button className="profile-add" onClick={addProfile} disabled={busy !== null || editingId !== null}>+ Add profile</button></div>
    <div className="profiles-guidance"><ShieldCheck size={16} /><span><b>Keep your searches focused.</b> Each profile can target a different role, location, or company set.</span></div>
    {message && <p className="profile-error" role="alert">{message}</p>}
    {!profiles.length && <article className="panel profile-empty"><h2>No saved profiles yet</h2><p>Use “Add profile” to create a custom search profile.</p></article>}
    <div className="profiles-grid">{profiles.map((profile) => {
      const filters = profile.filters;
      const roles = asList(filters.target_roles);
      const skills = asList(filters.skills);
      const locations = [...asList(filters.countries), ...asList(filters.preferred_cities)];
      const companies = asList(filters.target_companies);
      const category = profile.category === "india_product" ? "India product" : profile.category === "global_sponsored" ? "Global sponsored" : "Custom profile";
      const expanded = expandedProfileId === profile.id;
      return <article key={profile.id} className="panel profile-summary-card">
        <div className="profile-summary-head"><span className={`profile-kind ${profile.category}`}>{category}</span><div className="profile-summary-actions"><span className={`profile-state ${profile.enabled ? "enabled" : "disabled"}`}><i />{profile.enabled ? "Enabled" : "Paused"}</span><button className="profile-edit" type="button" onClick={() => { setEditSnapshot(profile); setEditingId(profile.id); setMessage(""); }}>Edit profile</button><button className="profile-delete" type="button" onClick={() => deleteProfile(profile.id)} disabled={busy === profile.id}>Delete</button></div></div>
        <h2>{profile.name}</h2>
        <div className="profile-summary-lines"><div><span>Roles</span><p>{roles.length ? roles.join(" · ") : "No roles set"}</p></div><div><span>Locations</span><p>{locations.length ? locations.join(" · ") : "Any location"}</p></div><div><span>Companies</span><p>{companies.length ? companies.join(" · ") : "No company filter"}</p></div></div>
        <div className="profile-summary-bottom"><div className="profile-summary-skills">{skills.length ? skills.slice(0, 5).map((skill) => <span key={skill}>{skill}</span>) : <span className="profile-no-skills">No skills added</span>}{skills.length > 5 && <span>+{skills.length - 5}</span>}</div><button type="button" className="profile-details-toggle" aria-expanded={expanded} onClick={() => setExpandedProfileId(expanded ? null : profile.id)}>{expanded ? "Hide details" : "More criteria"}<ChevronDown size={14} /></button></div>
        {expanded && <div className="profile-extra-details"><span><b>Additional interests</b>{asList(filters.additional_interests).join(", ") || "None"}</span><span><b>Experience</b>{typeof filters.minimum_experience === "number" ? `${filters.minimum_experience}+ years` : "Any"}</span><span><b>Compensation</b>{[filters.minimum_compensation, filters.maximum_compensation].some((value) => typeof value === "number") ? `${textValue(filters.compensation_currency) || "Amount"} ${typeof filters.minimum_compensation === "number" ? filters.minimum_compensation.toLocaleString() : "Any"}–${typeof filters.maximum_compensation === "number" ? filters.maximum_compensation.toLocaleString() : "Any"}` : "Not specified"}</span><span><b>Sponsorship</b>{boolValue(filters.sponsorship_required) === null ? "Not specified" : filters.sponsorship_required ? "Required" : "Not required"}</span><span><b>Relocation</b>{boolValue(filters.relocation_preference) === null ? "Not specified" : filters.relocation_preference ? "Open" : "Not open"}</span><span><b>Excluded companies</b>{asList(filters.excluded_companies).join(", ") || "None"}</span></div>}
      </article>;
    })}</div>
    {editingProfile && renderProfileEditor(editingProfile)}
  </section>;
}

function DiscoverJobs({ data }: { data: DashboardPayload }) {
  const router = useRouter();
  const profiles = data.jobProfiles.filter((profile) => profile.enabled);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ profile: string; checked: number; sourcesWithPostings: number; fetched: number; matched: number; saved: number } | null>(null);
  const [problem, setProblem] = useState("");
  const [progress, setProgress] = useState<{ name: string; status: "pending" | "checking" | "complete" | "error"; fetched?: number; matched?: number; saved?: number; error?: string }[]>([]);
  const [progressTotal, setProgressTotal] = useState(0);
  const [jobQuery, setJobQuery] = useState("");
  const [jobFilter, setJobFilter] = useState<"all" | "matched" | "review">("all");
  const matchedJobCount = data.discoveredJobs.filter((job) => job.match && job.match.decision !== "rejected").length;
  const reviewJobCount = data.discoveredJobs.filter((job) => job.match?.decision === "pending_review").length;
  const visibleJobs = data.discoveredJobs.filter((job) => {
    const matchesFilter = jobFilter === "all" || (jobFilter === "matched" ? Boolean(job.match && job.match.decision !== "rejected") : job.match?.decision === "pending_review");
    const searchable = [job.title, job.company, job.location, job.country, job.source, job.match?.profile, job.match?.explanation].filter(Boolean).join(" ").toLocaleLowerCase();
    return matchesFilter && searchable.includes(jobQuery.trim().toLocaleLowerCase());
  });

  async function discover() {
    setBusy(true); setSummary(null); setProblem(""); setProgress([]); setProgressTotal(0);
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
          setSummary({ profile: event.profile ?? "Discovery", checked: event.checked ?? 0, sourcesWithPostings: event.sourcesWithPostings ?? 0, fetched: event.fetched ?? 0, matched: event.matched ?? 0, saved: event.saved ?? 0 });
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

  const latestScan = summary && (() => {
    const finishedSources = progress.filter((company) => company.status === "complete" || company.status === "error");
    const foundSources = finishedSources.filter((company) => company.status === "complete" && (company.fetched ?? 0) > 0);
    const matchedSources = finishedSources.filter((company) => company.status === "complete" && (company.matched ?? 0) > 0);
    const errorSources = finishedSources.filter((company) => company.status === "error");
    const rows = (companies: typeof progress, detail = false) => companies.length ? companies.map((company) => <div className={`discovery-result-row ${company.status}`} key={company.name}>
      <span className="discovery-result-company">{company.name}</span>
      <span className="discovery-result-detail">{detail && company.status === "error" ? company.error : company.status === "error" ? "Source error" : `${company.fetched ?? 0} postings · ${company.matched ?? 0} matches${(company.saved ?? 0) > 0 ? ` · ${company.saved} new` : ""}`}</span>
    </div>) : <p className="discovery-result-empty">None for this scan.</p>;
    return <article className="panel discovery-summary" aria-label="Discovery results">
      <div className="discovery-summary-heading" role="status" aria-live="polite"><div><span className="eyebrow">LATEST SCAN</span><h2>{summary.profile}</h2></div><span className="discovery-complete-pill"><i /> Complete</span></div>
      <div className="discovery-summary-metrics">
        <div><b>{summary.checked}</b><span>Companies scanned</span></div>
        <div><b>{summary.sourcesWithPostings}</b><span>Companies with postings</span></div>
        <div><b>{summary.fetched}</b><span>Postings fetched</span></div>
        <div><b>{summary.matched}</b><span>Profile matches</span></div>
        <div><b>{summary.saved}</b><span>New jobs</span></div>
      </div>
      <div className="discovery-result-groups">
        <details className="discovery-result-group" open><summary><span>Found</span><small>Companies returning postings</small><b>{summary.sourcesWithPostings}</b></summary><div className="discovery-result-list">{rows(foundSources)}</div></details>
        <details className="discovery-result-group"><summary><span>Matched</span><small>Companies with profile matches</small><b>{matchedSources.length}</b></summary><div className="discovery-result-list">{rows(matchedSources)}</div></details>
        <details className={`discovery-result-group${errorSources.length ? " has-errors" : ""}`}><summary><span>Errors</span><small>Sources needing attention</small><b>{errorSources.length}</b></summary><div className="discovery-result-list">{rows(errorSources, true)}</div></details>
        <details className="discovery-result-group"><summary><span>Details</span><small>All company source results</small><b>{finishedSources.length}</b></summary><div className="discovery-result-list">{rows(finishedSources, true)}</div></details>
      </div>
    </article>;
  })();

  return <section className="discover-page">
    <div className="page-intro discovery-page-heading"><div><div className="eyebrow">AUTOMATED CAREERS-PAGE MONITOR</div><h1>Discover Jobs</h1><p>Find public openings from your selected companies and see how they fit your profile.</p></div><details className="panel discovery-help discovery-help-top"><summary><span><b>How it works</b></span><ChevronDown size={15} /></summary><div><p>RolePilot resolves target organizations from the backend company catalog, then detects Greenhouse, Lever, Ashby, and SmartRecruiters public job boards or reads standard JobPosting data. Listings are deduplicated and keep the original posting link.</p><p>Some companies use custom systems or block automated reading; those need a dedicated connector before RolePilot can import their listings. Confirm sponsorship and experience fit on the employer’s posting.</p></div></details></div>
    <article className="panel discovery-controls"><div className="discovery-control-copy"><span className="eyebrow">ON-DEMAND SCAN</span><h2>Check your company sources</h2><p>Choose an enabled profile to scan its companies now. Discovery runs daily after deployment.</p></div><div className="discover-actions"><label><span>Job profile</span><select aria-label="Job profile" value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={busy || profiles.length === 0}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button className="profile-add" onClick={discover} disabled={busy || !profileId}>{busy ? <><LoaderCircle className="discovery-spinner" size={15} /> Scanning…</> : <><ScanSearch size={15} /> Check now</>}</button></div>
      {!profiles.length && <p className="panel-empty">Enable a job profile with target companies first.</p>}
      {problem && <p className="profile-error" role="alert">{problem}</p>}
      {busy && progress.length > 0 && <div className="discovery-progress" role="status" aria-live="polite">
        <div className="discovery-progress-heading"><span><LoaderCircle className="discovery-spinner" size={15} /> Scanning company sources</span><b>{progress.filter((company) => company.status === "complete" || company.status === "error").length} / {progressTotal}</b></div>
        <div className="discovery-progress-track"><i style={{ width: `${progressTotal ? progress.filter((company) => company.status === "complete" || company.status === "error").length / progressTotal * 100 : 0}%` }} /></div>
        <div className="discovery-company-list">{progress.map((company) => <div className={`discovery-company-row ${company.status}`} key={company.name}>
          <span className="discovery-company-indicator">{company.status === "checking" ? <LoaderCircle className="discovery-spinner" size={14} /> : company.status === "complete" ? "✓" : company.status === "error" ? "!" : "·"}</span>
          <span className="discovery-company-name">{company.name}</span>
          <span className="discovery-company-result">{company.status === "checking" ? "Checking…" : company.status === "error" ? "Source unavailable" : company.status === "complete" ? `${company.fetched ?? 0} postings · ${company.matched ?? 0} matches` : "Waiting"}</span>
        </div>)}</div>
      </div>}
    </article>
    {latestScan}
    <section className="discovered-jobs-section"><div className="discover-results-heading"><div><span className="eyebrow">YOUR OPPORTUNITIES</span><h2>Recently discovered</h2><p>Latest public postings saved from your company sources.</p></div><span className="discovered-count">{visibleJobs.length} of {data.discoveredJobs.length} jobs</span></div>
      {data.discoveredJobs.length > 0 && <div className="discovered-toolbar"><label className="discovered-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search discovered jobs" placeholder="Search roles, companies, or locations" value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} /></label><div className="discovered-filters" role="group" aria-label="Filter discovered jobs"><button type="button" className={jobFilter === "all" ? "active" : ""} onClick={() => setJobFilter("all")}>All <span>{data.discoveredJobs.length}</span></button><button type="button" className={jobFilter === "matched" ? "active" : ""} onClick={() => setJobFilter("matched")}>Profile matches <span>{matchedJobCount}</span></button><button type="button" className={jobFilter === "review" ? "active" : ""} onClick={() => setJobFilter("review")}>Review needed <span>{reviewJobCount}</span></button></div></div>}
      {!data.discoveredJobs.length ? <article className="panel profile-empty"><h2>No discovered jobs yet</h2><p>Run a scan now or wait for the scheduled daily scan. New public postings will appear here.</p></article> : visibleJobs.length ? <div className="discovered-list">{visibleJobs.map((job) => <article className="panel discovered-card" key={job.id}><div className="discovered-card-top"><span className="discovered-source-label">{job.source}</span><time>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(job.discoveredAt))}</time></div><h3>{job.title}</h3><p className="discovered-company-line"><b>{job.company}</b><span>·</span>{job.location}</p><div className="discovered-card-bottom"><span>{job.country ?? "Country not identified"} · Visa sponsorship unverified</span>{job.url ? <a href={job.url} target="_blank" rel="noreferrer">View original posting ↗</a> : <span>Original link unavailable</span>}</div></article>)}</div> : <article className="panel discovered-empty-filter"><h3>No jobs match these filters</h3><p>Adjust your search or switch to all jobs.</p><button type="button" onClick={() => { setJobQuery(""); setJobFilter("all"); }}>Clear filters</button></article>}
    </section>
  </section>;
}

function CompanyLogo({ company }: { company: DashboardPayload["companies"][number] }) {
  const [failed, setFailed] = useState(false);
  return company.logoUrl && !failed
    ? <Image className="company-logo" src={company.logoUrl} alt={`${company.name} logo`} width={36} height={36} unoptimized onError={() => setFailed(true)} />
    : <span className="company-avatar">{company.name.slice(0, 1).toLocaleUpperCase()}</span>;
}

function CompanyCatalogForm({ initialName, onCancel, onAdded }: { initialName: string; onCancel: () => void; onAdded: (message: string) => void }) {
  const [name, setName] = useState(initialName);
  const [websiteDomain, setWebsiteDomain] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name" | "websiteDomain" | "careersUrl", string>>>({});
  const [busy, setBusy] = useState(false);

  function validateField(field: "name" | "websiteDomain" | "careersUrl", values = { name, websiteDomain, careersUrl }) {
    if (field === "name") {
      const value = values.name.trim();
      return value.length < 2 || value.length > 100 || !/[\p{L}\p{N}]/u.test(value) ? "Enter a company name between 2 and 100 characters." : !/[a-z0-9]/i.test(value) ? "Include at least one English letter or number so the company can be matched in the catalog." : "";
    }
    if (field === "websiteDomain") {
      const value = values.websiteDomain.trim().toLowerCase();
      const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
      return value.length > 260 || !domainPattern.test(value) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(value) ? "Enter the public base domain only, such as acme.com. Leave out https:// and any path." : "";
    }
    if (!values.careersUrl.trim()) return "Enter the full URL of the company’s careers page.";
    if (values.careersUrl.length > 2048) return "The careers page URL is too long.";
    const domain = values.websiteDomain.trim().toLowerCase();
    const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
    if (!domainPattern.test(domain)) return "Enter a valid company domain first.";
    try {
      const url = new URL(values.careersUrl.trim());
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      const publicHost = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);
      const sameCompany = host === domain || host.endsWith(`.${domain}`);
      const hiringPlatform = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com", "jobs.eu.ashbyhq.com", "careers.smartrecruiters.com", "jobs.smartrecruiters.com"]).has(host) || host.endsWith(".myworkdayjobs.com");
      if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !publicHost || (!sameCompany && !hiringPlatform)) return "Use an HTTPS careers URL on the company domain or a supported hiring platform.";
      return "";
    } catch {
      return "Enter a valid HTTPS careers page URL.";
    }
  }

  function updateField(field: "name" | "websiteDomain" | "careersUrl", value: string) {
    const values = { name, websiteDomain, careersUrl, [field]: value };
    if (field === "name") setName(value);
    if (field === "websiteDomain") setWebsiteDomain(value);
    if (field === "careersUrl") setCareersUrl(value);
    setFieldErrors((current) => {
      const next = { ...current };
      if (current[field]) next[field] = validateField(field, values);
      if (field === "websiteDomain" && current.careersUrl) next.careersUrl = validateField("careersUrl", values);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = { name, websiteDomain, careersUrl };
    const validation = { name: validateField("name", values), websiteDomain: validateField("websiteDomain", values), careersUrl: validateField("careersUrl", values) };
    setFieldErrors(validation);
    if (Object.values(validation).some(Boolean)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/company-catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, websiteDomain, careersUrl }) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not add this company.");
      onAdded(result.message ?? "Company added to the shared catalog.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this company.");
    } finally {
      setBusy(false);
    }
  }

  return <article className="panel company-submission-panel"><div className="company-submission-heading"><div><span className="eyebrow">SHARED COMPANY CATALOG</span><h2>Add company</h2><p>Add an official careers source so this company can be matched and scanned for every user.</p></div></div>
    <form className="company-submission-form" noValidate onSubmit={(event) => void submit(event)}>
      <label className="company-name-field">Company name<input required minLength={2} maxLength={100} value={name} onBlur={() => setFieldErrors((current) => ({ ...current, name: validateField("name") }))} onChange={(event) => updateField("name", event.target.value)} placeholder="e.g. Acme Technologies" disabled={busy} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "company-name-error" : undefined} />{fieldErrors.name && <small className="company-field-error" id="company-name-error">{fieldErrors.name}</small>}</label>
      <label>Official website domain<small>Base domain only. Don’t include a path or <code>https://</code>.</small><input required value={websiteDomain} onBlur={() => setFieldErrors((current) => ({ ...current, websiteDomain: validateField("websiteDomain") }))} onChange={(event) => updateField("websiteDomain", event.target.value)} placeholder="acme.com" disabled={busy} aria-invalid={Boolean(fieldErrors.websiteDomain)} aria-describedby={fieldErrors.websiteDomain ? "company-domain-error" : undefined} />{fieldErrors.websiteDomain && <small className="company-field-error" id="company-domain-error">{fieldErrors.websiteDomain}</small>}</label>
      <label>Official careers page URL<small>Use the company’s public jobs page over HTTPS.</small><input required type="url" value={careersUrl} onBlur={() => setFieldErrors((current) => ({ ...current, careersUrl: validateField("careersUrl") }))} onChange={(event) => updateField("careersUrl", event.target.value)} placeholder="https://careers.acme.com/jobs" disabled={busy} aria-invalid={Boolean(fieldErrors.careersUrl)} aria-describedby={fieldErrors.careersUrl ? "company-careers-error" : undefined} />{fieldErrors.careersUrl && <small className="company-field-error" id="company-careers-error">{fieldErrors.careersUrl}</small>}</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="company-submission-actions"><small>Careers URL must use the company’s domain or a supported hiring platform, such as Greenhouse, Lever, Ashby, SmartRecruiters, or Workday.</small><div><button type="button" className="profile-cancel" onClick={onCancel} disabled={busy}>Cancel</button><button className="profile-save" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="discovery-spinner" size={14} /> Adding…</> : "Add to catalog"}</button></div></div>
    </form>
  </article>;
}

function CompanyDirectory({ data }: { data: DashboardPayload }) {
  const router = useRouter();
  const [addingName, setAddingName] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "ready" | "setup">("all");
  const readyCount = data.companies.filter((company) => company.catalogued).length;
  const setupCount = data.companies.length - readyCount;
  const visibleCompanies = data.companies.filter((company) => {
    const matchesStatus = sourceFilter === "all" || (sourceFilter === "ready" ? company.catalogued : !company.catalogued);
    const searchable = [company.name, company.careersUrl, company.sourcePlatform, ...company.profiles].filter(Boolean).join(" ").toLocaleLowerCase();
    return matchesStatus && searchable.includes(query.trim().toLocaleLowerCase());
  });
  return <section className="companies-page">
    <div className="page-intro company-page-heading"><div><div className="eyebrow">PROFILE-DRIVEN COMPANY CATALOG</div><h1>Companies</h1><p>Manage career sources for companies in your job profiles.</p></div><div className="company-page-heading-actions"><span className="company-count-pill">{data.companies.length} {data.companies.length === 1 ? "company" : "companies"}</span><button className="profile-save company-add-button" type="button" onClick={() => { setNotice(""); setAddingName(""); }}>+ Add company</button></div></div>
    {notice && <p className="company-catalog-notice" role="status">{notice}</p>}
    {addingName !== null && <CompanyCatalogForm key={addingName} initialName={addingName} onCancel={() => setAddingName(null)} onAdded={(message) => { setNotice(message); setAddingName(null); router.refresh(); }} />}
    {data.companies.length > 0 && <div className="company-toolbar"><label className="company-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies, sources, or profiles" aria-label="Search companies" /></label><div className="company-filters" role="group" aria-label="Filter companies by source status"><button type="button" className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>All <span>{data.companies.length}</span></button><button type="button" className={sourceFilter === "ready" ? "active" : ""} onClick={() => setSourceFilter("ready")}>Ready <span>{readyCount}</span></button><button type="button" className={sourceFilter === "setup" ? "active" : ""} onClick={() => setSourceFilter("setup")}>Needs setup <span>{setupCount}</span></button></div></div>}
    <div className="company-directory">{visibleCompanies.map((company) => <article className="panel company-card" key={company.name}>
      <div className="company-card-heading"><div className="company-card-identity"><CompanyLogo company={company} /><div className="company-card-title"><h2>{company.name}</h2><small>{company.profiles.length ? `Used in ${company.profiles.length} ${company.profiles.length === 1 ? "job profile" : "job profiles"}` : "Not tied to a job profile"}</small></div></div><span className={`company-source-state ${company.catalogued ? "ready" : "pending"}`}><i />{company.catalogued ? "Ready" : "Needs setup"}</span></div>
      <div className="company-card-source"><span className="company-card-source-icon"><Globe2 size={15} /></span><div><small>Career source</small><b>{company.sourcePlatform === "auto" ? "Auto-detected" : company.sourcePlatform ?? "Not configured"}</b><span>{company.careersUrl ? company.careersUrl.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./, "") ?? company.careersUrl : "Add a public careers page to enable discovery"}</span></div></div>
      <div className="company-card-actions">{company.careersUrl && <a className="careers-link" href={company.careersUrl} target="_blank" rel="noopener noreferrer">Open careers page <span aria-hidden="true">↗</span></a>}{!company.catalogued && <button className="company-register-button" type="button" onClick={() => { setNotice(""); setAddingName(company.name); }}>Add career source</button>}</div>
    </article>)}</div>
    {!data.companies.length && <article className="panel company-empty-state"><span className="company-empty-icon"><Building2 size={19} /></span><h2>No companies in your profiles yet</h2><p>Add target companies in Job Profiles and they’ll appear here with their career-source status.</p></article>}
    {data.companies.length > 0 && !visibleCompanies.length && <article className="panel company-empty-state"><span className="company-empty-icon"><Search size={18} /></span><h2>No matching companies</h2><p>Try a different name or change the source-status filter.</p><button type="button" onClick={() => { setQuery(""); setSourceFilter("all"); }}>Clear search and filters</button></article>}
  </section>;
}

function AgentActivity({ data }: { data: DashboardPayload }) {
  const status = data.agent.desiredEnabled ? (data.agent.online ? "Enabled · local process online" : "Enabled · waiting for local process") : (data.agent.online ? "Disabled · local process monitoring" : "Disabled · local process offline");
  return <section className="agent-page">
    <div className="agent-page-heading"><div><div className="eyebrow">LOCAL EXECUTION CONTROL</div><h1>Agent Activity</h1><p>Manage the local runner and review the latest lifecycle signals.</p></div><span className={`ready-pill ${data.agent.online ? "connected" : "offline"}`}><i />{data.agent.online ? "Process online" : "Process offline"}</span></div>
    <article className="panel agent-console">
      <div className="agent-console-main"><div className="agent-console-title"><span className={`agent-orb ${data.agent.online ? "online" : ""}`}><Activity size={18} /></span><div><span className="eyebrow">AGENT CONTROL</span><h2>{status}</h2><p>{data.agent.desiredEnabled ? "The local process is allowed to begin future work." : "No new work will start while the desired state is disabled."}</p></div></div><AgentToggle data={data} /></div>
      <div className="agent-stat-row"><div><small>Desired state</small><b>{data.agent.desiredEnabled ? "Enabled" : "Disabled"}</b></div><div><small>Runtime</small><b>{data.agent.online ? "Online" : data.agent.desiredEnabled ? "Overdue / offline" : "Offline"}</b></div><div><small>Last heartbeat</small><b>{data.agent.heartbeat ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.agent.heartbeat)) : "No heartbeat"}</b></div><div><small>Current phase</small><b>Lifecycle only</b></div></div>
      <div className="agent-phase-note"><ShieldCheck size={15} /><span>This phase only monitors the local process. Job discovery and application actions are not connected to this runner.</span></div>
    </article>
    <article className="panel agent-timeline"><div className="agent-section-heading"><div><h2>Recent activity</h2><p>Process sessions, status changes, and recovery events</p></div><span>{data.agent.events.length + data.agent.runs.length} records</span></div>
      {data.agent.events.length || data.agent.runs.length ? <div className="agent-timeline-list">
        {data.agent.events.map((event) => <div className="agent-timeline-item" key={`event-${event.id}`}><span className="timeline-marker" /><div className="timeline-copy"><b>{event.type.replaceAll("_", " ")}</b><p>{event.message}</p><small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</small></div></div>)}
        {data.agent.runs.map((run) => <div className="agent-timeline-item" key={`run-${run.id}`}><span className={`timeline-marker ${run.status.toLowerCase()}`} /><div className="timeline-copy"><b>Process session · {run.status.replaceAll("_", " ")}</b><p>{run.recoveryDetails || run.errorSummary || "Local agent process session."}</p><small>{run.startedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.startedAt)) : "Start time unavailable"}</small></div></div>)}
      </div> : <div className="agent-empty-state"><span className="agent-orb"><Activity size={18} /></span><b>No activity recorded yet</b><p>Start the local agent process to report a heartbeat and create its first session.</p></div>}
    </article>
  </section>;
}

export default function RolePilotDashboard({ data }: { data: DashboardPayload }) {
  const [active, setActive] = useState<Page>("Dashboard");
  const [theme, setTheme] = useState<Theme>("light");
  const router = useRouter();
  useEffect(() => {
    const saved = window.localStorage.getItem("rolepilot-theme");
    const initial: Theme = saved === "dark" ? "dark" : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);
  useEffect(() => {
    if (active !== "Dashboard" && active !== "Agent Activity") return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("rolepilot-theme", next);
  }
  return <div className="app-shell"><Sidebar active={active} onChange={setActive} email={data.email} fullName={data.fullName} /><main className="main"><Header page={active} theme={theme} onToggleTheme={toggleTheme} /><div className="page-content">{active === "Dashboard" ? <Dashboard data={data} /> : active === "Job Profiles" ? <JobProfiles data={data} /> : active === "Discover Jobs" ? <DiscoverJobs data={data} /> : active === "Companies" ? <CompanyDirectory data={data} /> : active === "Agent Activity" ? <AgentActivity data={data} /> : <section className="empty-page"><div className="empty-icon"><LayoutDashboard size={22} /></div><h1>{active}</h1><p>This section is ready for its next integration step.</p><span>No sample records are being presented as live data.</span></section>}<footer>© 2026 RolePilot <span>Your personal job-search analytics.</span></footer></div></main></div>;
}
