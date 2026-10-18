"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown, FileUp, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { CompanyTargetInput } from "@/components/company-target-input";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [targetRoles, setTargetRoles] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [skills, setSkills] = useState("");
  const [homeCountry, setHomeCountry] = useState("");
  const [preferredCities, setPreferredCities] = useState("");
  const [targetCountries, setTargetCountries] = useState("");
  const [dreamCompanies, setDreamCompanies] = useState("");
  const [catalogCompanies, setCatalogCompanies] = useState<{ name: string; normalizedName: string }[]>([]);
  const [catalogStatus, setCatalogStatus] = useState("");
  const [sponsorshipRequired, setSponsorshipRequired] = useState("false");
  const [resumeReady, setResumeReady] = useState(false);
  const [resumeFileName, setResumeFileName] = useState("");
  const [resumeStatus, setResumeStatus] = useState("");
  const [extractingResume, setExtractingResume] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [openSections, setOpenSections] = useState({ profile: false, preferences: true, account: false });
  const [visitedSections, setVisitedSections] = useState({ profile: false, preferences: true, account: false });
  const profileComplete = Boolean(fullName.trim() && experienceYears && homeCountry.trim() && skills.trim());
  const targetRoleTokens = [...new Set([...targetRoles.split(",").map((role) => role.trim()).filter(Boolean), roleDraft.trim()].filter(Boolean))];
  const searchPreferencesComplete = targetRoleTokens.length > 0;
  const accountComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8;
  const sectionStatus = (key: keyof typeof openSections, complete: boolean) => openSections[key] ? "Editing" : complete ? "Complete" : visitedSections[key] ? "Needs info" : "Next";
  const updateSectionState = (key: keyof typeof openSections, isOpen: boolean) => {
    setOpenSections((current) => ({ ...current, [key]: isOpen }));
    if (isOpen) setVisitedSections((current) => ({ ...current, [key]: true }));
  };
  const updateRoleDraft = (value: string) => {
    const pieces = value.split(",");
    if (pieces.length === 1) {
      setRoleDraft(value);
      return;
    }
    const existing = targetRoles.split(",").map((role) => role.trim()).filter(Boolean);
    const additions = pieces.slice(0, -1).map((role) => role.trim()).filter(Boolean);
    setTargetRoles([...new Set([...existing, ...additions])].join(", "));
    setRoleDraft(pieces[pieces.length - 1].trimStart());
  };
  const commitRoleDraft = () => {
    const role = roleDraft.trim();
    if (!role) return;
    const existing = targetRoles.split(",").map((item) => item.trim()).filter(Boolean);
    if (!existing.some((item) => item.toLocaleLowerCase() === role.toLocaleLowerCase())) setTargetRoles([...existing, role].join(", "));
    setRoleDraft("");
  };

  useEffect(() => {
    const supabase = createClient();
    void supabase.from("company_catalog").select("name, normalized_name").order("name").then(({ data, error: catalogError }) => {
      if (catalogError) setCatalogStatus("Company suggestions could not load. The company names you enter cannot be checked yet.");
      else setCatalogCompanies((data ?? []).map((company) => ({ name: company.name, normalizedName: company.normalized_name })));
    });
  }, []);

  async function extractResume(file: File | undefined, input: HTMLInputElement) {
    setResumeReady(false);
    setResumeStatus("");
    setResumeFileName("");
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setResumeStatus("Choose a PDF resume.");
      input.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setResumeStatus("This PDF is larger than 10 MB. Choose a smaller file.");
      input.value = "";
      return;
    }

    setExtractingResume(true);
    setResumeStatus("Reading resume locally…");
    try {
      // Load PDF.js as a static browser asset. Bundling pdfjs-dist through
      // Next/Webpack can fail at runtime with "Object.defineProperty called on
      // non-object"; the PDF data itself stays in this browser either way.
      const pdfjsAssetPath = "/vendor/pdfjs/pdf.min.mjs";
      const pdfjs = await import(/* webpackIgnore: true */ pdfjsAssetPath) as typeof import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      const pdf = await loadingTask.promise;
      let text = "";
      try {
        if (pdf.numPages > 20) throw new Error("This PDF has more than 20 pages. Choose a shorter resume.");
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push(content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join(""));
        }
        text = pages.join("\n").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      } finally {
        await loadingTask.destroy();
      }
      if (text.length < 40) throw new Error("We couldn’t read text from this PDF. Try a text-based PDF instead of a scanned image.");

      const lines = text.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean);
      const inferredName = lines.slice(0, 5).find((line) => line.length >= 3 && line.length <= 60 && /^[A-Za-z][A-Za-z .'-]+$/.test(line) && !/resume|curriculum vitae/i.test(line));
      if (inferredName) setFullName((current) => current || inferredName);

      const yearsMatch = text.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*years?(?:\s+of)?\s+(?:professional\s+)?experience/i)
        ?? text.match(/experience\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*years?/i);
      if (yearsMatch?.[1]) setExperienceYears((current) => current || yearsMatch[1]);

      const knownSkills = ["Java", "Kotlin", "Python", "JavaScript", "TypeScript", "C++", "C#", "Go", "Spring Boot", "Node.js", "React", "Next.js", "REST APIs", "Microservices", "AWS", "Azure", "GCP", "PostgreSQL", "MySQL", "MongoDB", "Kafka", "Redis", "Docker", "Kubernetes", "Terraform", "CI/CD", "Prometheus", "Grafana", "Machine Learning", "Generative AI"];
      const inferredSkills = knownSkills.filter((skill) => text.toLowerCase().includes(skill.toLowerCase()));
      if (inferredSkills.length) setSkills((current) => current || inferredSkills.join(", "));

      const experienceHeading = /^(?:professional\s+)?(?:work\s+)?experience(?:\s+and\s+employment)?$|^employment\s+history$/i;
      const nextSectionHeading = /^(?:education|certifications?|projects?|technical\s+skills|skills|awards|publications|volunteering|interests)\b/i;
      const roleSignal = /\b(engineer|engineering|developer|programmer|manager|team lead|tech lead|lead|architect|analyst|scientist|product owner|product manager|designer|consultant|specialist|administrator|director|qa|quality assurance|tester|researcher|recruiter|account executive|scrum master)\b/i;
      const datedTail = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*(?:[-–—]|to)?\s*(?:present|current|now|\w+\s+\d{4})?\b|\b(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:present|current|now|(?:19|20)\d{2})\b/ig;
      const experienceStart = lines.findIndex((line) => experienceHeading.test(line.replace(/[:：]$/, "").trim()));
      const experienceLines = experienceStart >= 0
        ? lines.slice(experienceStart + 1).slice(0, lines.slice(experienceStart + 1).findIndex((line) => nextSectionHeading.test(line)) < 0 ? undefined : lines.slice(experienceStart + 1).findIndex((line) => nextSectionHeading.test(line)))
        : lines;
      const labeledRoleText = text.match(/\b(?:role(?:\s+and\s+project\s+name)?|position|job\s+title)\s*:\s*([^\n|•]{4,180})/i)?.[1];
      const labeledRole = labeledRoleText?.split(",")
        .map((part) => part.trim().replace(/^[-*·\s]+|[-*·\s]+$/g, ""))
        .find((part) => part.length >= 4 && part.length <= 90 && roleSignal.test(part));
      const inferredRoles = [...new Set(experienceLines.flatMap((line) => {
        if (!roleSignal.test(line) || line.length > 130 || /@|https?:\/\//i.test(line)) return [];
        const candidates = line.split(/[|•]|\s+[–—]\s+|\s+-\s+/).flatMap((part) => part.split(",")).map((part) => part
          .replace(/^\s*(?:role(?:\s+and\s+project\s+name)?|position|job\s+title)\s*:\s*/i, "")
          .split(/\s+[–—]\s+/)[0]
          .replace(/^[-*·\s]+|[-*·\s]+$/g, "")
          .replace(datedTail, "")
          .replace(/,\s*(?:focused|speciali[sz]ing|responsible|supporting|including|covering|with experience in|working on)\b.*$/i, "")
          .replace(/[,:;\s–—-]+$/g, "")
          .trim());
        const title = candidates.find((part) => part.length >= 4 && part.length <= 90 && part.split(/\s+/).length <= 9 && roleSignal.test(part) && !/\b\d+\s*years?\b/i.test(part));
        return title ? [title] : [];
      }))].slice(0, 8);
      const roleSuggestions = [...new Set([labeledRole, ...inferredRoles].filter((role): role is string => Boolean(role)))].slice(0, 8);
      if (roleSuggestions.length) setTargetRoles(roleSuggestions.join(", "));

      setResumeReady(true);
      setResumeFileName(file.name);
      setResumeStatus("Profile details are ready to review.");
      input.value = "";
    } catch (caught) {
      setResumeStatus(caught instanceof Error ? caught.message : "Could not read this PDF. Try another file.");
      input.value = "";
    } finally {
      setExtractingResume(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "sign-in") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        router.replace("/");
        router.refresh();
      } else {
        if (!resumeReady) throw new Error("Choose and process a PDF resume before creating your account.");
        if (targetRoleTokens.length === 0) throw new Error("Add at least one target role before creating your account.");
        const { data: canRegister, error: availabilityError } = await supabase.rpc("rolepilot_registration_available");
        if (availabilityError) throw availabilityError;
        if (!canRegister) throw new Error("RolePilot is currently limited to five accounts, and all account slots are in use.");
        const toList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              full_name: fullName.trim(),
              experience_years: Number(experienceYears),
              target_roles: [...new Set([...toList(targetRoles), roleDraft.trim()].filter(Boolean))],
              primary_skills: toList(skills),
              home_country: homeCountry.trim(),
              preferred_cities: toList(preferredCities),
              global_countries: toList(targetCountries),
              dream_companies: toList(dreamCompanies),
              sponsorship_required: sponsorshipRequired === "true",
            },
          },
        });
        if (authError) {
          if (authError.message.includes("ROLEPILOT_ACCOUNT_LIMIT_REACHED") || authError.message.toLowerCase().includes("database error saving new user")) {
            throw new Error("Registration could not be completed. The last account slot may have been taken while you were signing up; if the limit is not full, check the Supabase onboarding migration.");
          }
          throw authError;
        }
        if (!data.session) setMessage("Check your email for the confirmation link, then return here to sign in.");
        else { router.replace("/"); router.refresh(); }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete sign-in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-screen"><section className="auth-card">
    <div className="auth-brand"><span className="auth-logo">R</span>RolePilot</div>
    <div className="auth-kicker"><ShieldCheck size={14} /> {mode === "sign-in" ? "PRIVATE PERSONAL WORKSPACE" : "SINGLE-PAGE SIGNUP"}</div>
    <h1>{mode === "sign-in" ? "Welcome back" : "Create your job-search profile"}</h1>
    <p className="auth-copy">{mode === "sign-in" ? "Sign in to your private job-search dashboard." : "Review each section in one place. Open only what you need to change."}</p>
    {!isSupabaseConfigured() ? <div className="auth-alert"><b>Supabase setup is needed.</b><br />Add the project URL and publishable key to <code>frontend/.env.local</code> after creating your Supabase project.</div> : <form className={`auth-form${mode === "sign-up" ? " signup-form" : ""}`} onSubmit={submit} onInvalidCapture={(event) => {
      const section = (event.target as HTMLElement).closest("details");
      if (section) section.open = true;
    }}>
      {mode === "sign-up" && <>
        <div className={`resume-upload-block${resumeReady ? " is-ready" : ""}`}>
          <div><span className="resume-upload-label">{resumeReady ? "Resume processed locally" : "Start with your resume"}</span><small>{resumeReady && resumeFileName ? `${resumeFileName} · Details extracted locally; PDF not uploaded or saved.` : "We’ll prefill your profile. The PDF stays in this browser and is never uploaded or saved."}</small></div>
          <input id="resume-pdf" className="resume-file-input" type="file" accept="application/pdf,.pdf" disabled={extractingResume} onChange={(event) => void extractResume(event.currentTarget.files?.[0], event.currentTarget)} />
          <label className={`resume-picker${resumeReady ? " is-ready" : ""}`} htmlFor="resume-pdf">
            {resumeReady ? <CheckCircle2 size={16} /> : <FileUp size={16} />}
            <span>{resumeReady ? "Change PDF" : "Choose PDF"}</span>
          </label>
        </div>
        {resumeStatus && <p className={`resume-status ${resumeReady || extractingResume ? "form-message" : "form-error"}`} role={extractingResume || resumeReady ? "status" : "alert"}>{resumeStatus}</p>}

        <details className="signup-section" onToggle={(event) => updateSectionState("profile", event.currentTarget.open)}>
          <summary><span className="section-heading"><b>Personal profile</b><small>{fullName || "Add your name"} · {experienceYears ? `${experienceYears} years experience` : "Experience"} · {homeCountry || "Home country"}</small></span><span className={`section-state ${sectionStatus("profile", profileComplete).toLowerCase().replace(/\s+/g, "-")}`}>{sectionStatus("profile", profileComplete)}</span><ChevronDown className="section-chevron" size={17} /></summary>
          <div className="section-fields">
            <label>Full name<input type="text" autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" /></label>
            <div className="signup-fields-two">
              <label>Experience (years)<input type="number" min="0" max="60" step="0.5" required value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} placeholder="e.g. 6" /></label>
              <label>Home country<input type="text" required value={homeCountry} onChange={(event) => setHomeCountry(event.target.value)} placeholder="e.g. India" /></label>
            </div>
            <label>Core skills <small>Separate skills with commas</small><input type="text" required value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="e.g. Java, AWS, PostgreSQL" /></label>
          </div>
        </details>

        <details className="signup-section" open onToggle={(event) => updateSectionState("preferences", event.currentTarget.open)}>
          <summary><span className="section-heading"><b>Search preferences</b><small>Roles, locations, companies and sponsorship</small></span><span className={`section-state ${sectionStatus("preferences", searchPreferencesComplete).toLowerCase().replace(/\s+/g, "-")}`}>{sectionStatus("preferences", searchPreferencesComplete)}</span><ChevronDown className="section-chevron" size={17} /></summary>
          <div className="section-fields">
            <label className="role-chip-field">Target roles <small>Required · Suggested from your resume. Add one or more roles.</small>
              <div className="role-chip-control">
                {targetRoles.split(",").map((role) => role.trim()).filter(Boolean).map((role) => <span className="role-chip" key={role.toLocaleLowerCase()}>{role}<button type="button" aria-label={`Remove ${role}`} onClick={() => setTargetRoles(targetRoles.split(",").map((item) => item.trim()).filter((item) => item && item.toLocaleLowerCase() !== role.toLocaleLowerCase()).join(", "))}>×</button></span>)}
                <input type="text" aria-label="Add target role" aria-required="true" required={targetRoles.split(",").filter((role) => role.trim()).length === 0} value={roleDraft} onChange={(event) => updateRoleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commitRoleDraft(); } if (event.key === "Backspace" && !roleDraft && targetRoles.trim()) setTargetRoles(targetRoles.split(",").map((role) => role.trim()).filter(Boolean).slice(0, -1).join(", ")); }} onBlur={commitRoleDraft} placeholder="Type a role and press Enter" />
              </div>
            </label>
            <CompanyTargetInput name="dream_companies" label="Dream companies" fieldHint="Optional · separate with commas" companies={catalogCompanies} value={dreamCompanies} onValueChange={setDreamCompanies} disabled={loading} catalogMessage={catalogStatus} />
            <div className="signup-location-fields">
              <label>Countries <small>Optional · separate with commas</small><input type="text" value={targetCountries} onChange={(event) => setTargetCountries(event.target.value)} placeholder="e.g. India, Singapore" /></label>
              <label>Preferred cities <small>Optional · separate with commas</small><input type="text" value={preferredCities} onChange={(event) => setPreferredCities(event.target.value)} placeholder="e.g. Bengaluru, Chennai" /></label>
            </div>
            <div className="sponsorship-row"><span>Visa sponsorship needed?</span><div className="sponsorship-choice" role="group" aria-label="Visa sponsorship needed?">
              <button type="button" aria-pressed={sponsorshipRequired === "false"} className={sponsorshipRequired === "false" ? "selected" : ""} onClick={() => setSponsorshipRequired("false")}>No</button>
              <button type="button" aria-pressed={sponsorshipRequired === "true"} className={sponsorshipRequired === "true" ? "selected" : ""} onClick={() => setSponsorshipRequired("true")}>Yes</button>
            </div></div>
          </div>
        </details>

        <details className="signup-section" onToggle={(event) => updateSectionState("account", event.currentTarget.open)}>
          <summary><span className="section-heading"><b>Account security</b><small>Email and password</small></span><span className={`section-state ${sectionStatus("account", accountComplete).toLowerCase().replace(/\s+/g, "-")}`}>{sectionStatus("account", accountComplete)}</span><ChevronDown className="section-chevron" size={17} /></summary>
          <div className="section-fields">
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label>Password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
          </div>
        </details>
      </>}
      {mode === "sign-in" && <>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></label>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status">{message}</p>}
      {mode === "sign-up" ? <div className="signup-form-footer"><span>Profile fields can be edited later.</span><button className="auth-submit" type="submit" disabled={loading || extractingResume || !resumeReady}>{loading || extractingResume ? <LoaderCircle className="spin" size={16} /> : null}Create account<ArrowRight size={15} /></button></div> : <button className="auth-submit" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : null}Sign in<ArrowRight size={15} /></button>}
    </form>}
    {isSupabaseConfigured() && <button className="auth-mode" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); setMessage(""); }}>{mode === "sign-in" ? "New to RolePilot? Create an account" : "Already have an account? Sign in"}</button>}
    <div className="auth-foot">Your job-search data is protected by your account’s row-level access rules.</div>
  </section></main>;
}
