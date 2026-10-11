import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { discoverCompanyJobs, matchesProfile, normalizeCompany } from "@/lib/discovery";
import { evaluatePosting } from "@/lib/profile-matcher";

export const runtime = "nodejs";
export const maxDuration = 60;

type Profile = { id: string; user_id: string; name: string; enabled: boolean; filters: Record<string, unknown> };
type Company = { id: string; user_id: string; name: string; normalized_name: string; website_url: string | null };

async function runDiscovery() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Scheduled discovery needs NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profiles, error: profileError } = await supabase.from("job_profiles").select("id, user_id, name, enabled, filters").eq("enabled", true) as { data: Profile[] | null; error: { message: string } | null };
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  const { data: companies, error: companyError } = await supabase.from("companies").select("id, user_id, name, normalized_name, website_url") as { data: Company[] | null; error: { message: string } | null };
  if (companyError) return NextResponse.json({ error: companyError.message }, { status: 500 });
  const { data: catalog, error: catalogError } = await supabase.from("company_catalog").select("name, normalized_name, careers_url") as { data: { name: string; normalized_name: string; careers_url: string }[] | null; error: { message: string } | null };
  if (catalogError) return NextResponse.json({ error: catalogError.message }, { status: 500 });

  const enabledProfiles = profiles ?? [];
  let companyRows = companies ?? [];
  const catalogByName = new Map((catalog ?? []).map((company) => [company.normalized_name, company]));
  let checked = 0;
  let fetched = 0;
  let matched = 0;
  let saved = 0;
  let sourcesWithPostings = 0;
  const errors: string[] = [];
  const targetByOwner = new Map<string, Set<string>>();
  for (const profile of enabledProfiles) {
    const targets = Array.isArray(profile.filters?.target_companies) ? profile.filters.target_companies.filter((value): value is string => typeof value === "string").map(normalizeCompany) : [];
    const excluded = Array.isArray(profile.filters?.excluded_companies) ? profile.filters.excluded_companies.filter((value): value is string => typeof value === "string").map(normalizeCompany) : [];
    const allowed = new Set(targets.filter((name) => !excluded.includes(name)));
    const ownerTargets = targetByOwner.get(profile.user_id) ?? new Set<string>();
    allowed.forEach((name) => ownerTargets.add(name));
    targetByOwner.set(profile.user_id, ownerTargets);
  }

  const companyKeys = new Set(companyRows.map((company) => `${company.user_id}:${company.normalized_name}`));
  const missingCompanies: { user_id: string; name: string; normalized_name: string; website_url: string }[] = [];
  for (const [userId, names] of targetByOwner) for (const normalizedName of names) {
    const known = catalogByName.get(normalizedName);
    if (known && !companyKeys.has(`${userId}:${normalizedName}`)) missingCompanies.push({ user_id: userId, name: known.name, normalized_name: normalizedName, website_url: known.careers_url });
  }
  if (missingCompanies.length) {
    const { error } = await supabase.from("companies").upsert(missingCompanies, { onConflict: "user_id,normalized_name", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: refreshedCompanies, error: refreshError } = await supabase.from("companies").select("id, user_id, name, normalized_name, website_url");
    if (refreshError) return NextResponse.json({ error: refreshError.message }, { status: 500 });
    companyRows = refreshedCompanies ?? [];
  }

  for (const company of companyRows) {
    const careersUrl = catalogByName.get(company.normalized_name)?.careers_url ?? company.website_url ?? null;
    if (!careersUrl || !targetByOwner.get(company.user_id)?.has(company.normalized_name)) continue;
    const matchingProfiles = enabledProfiles.filter((profile) => {
      if (profile.user_id !== company.user_id) return false;
      const targets = Array.isArray(profile.filters?.target_companies) ? profile.filters.target_companies.filter((value): value is string => typeof value === "string").map(normalizeCompany) : [];
      const excluded = Array.isArray(profile.filters?.excluded_companies) ? profile.filters.excluded_companies.filter((value): value is string => typeof value === "string").map(normalizeCompany) : [];
      return targets.includes(company.normalized_name) && !excluded.includes(company.normalized_name);
    });
    if (!matchingProfiles.length) continue;
    checked += 1;
    try {
      const { source, jobs } = await discoverCompanyJobs(careersUrl);
      if (jobs.length) sourcesWithPostings += 1;
      fetched += jobs.length;
      for (const profile of matchingProfiles) {
        const candidates = jobs.filter((job) => matchesProfile(job, profile.filters));
        const rows = candidates.map((job) => ({
          user_id: company.user_id,
          company_id: company.id,
          source_name: source,
          source_id: job.id,
          canonical_url: job.url,
          dedupe_key: `${source}:${company.normalized_name}:${job.id}`.slice(0, 250),
          title: job.title.trim(),
          location: job.location,
          city: null,
          country: ["India", "Germany", "Switzerland", "Singapore", "Australia", "Ireland"].find((country) => job.location?.toLocaleLowerCase().includes(country.toLocaleLowerCase())) ?? null,
          visa_sponsorship: "unknown",
          description: job.description,
          posted_at: job.postedAt,
        }));
        matched += rows.length;
        if (!rows.length) continue;
        const { data, error } = await supabase.from("jobs").upsert(rows, { onConflict: "user_id,dedupe_key" }).select("id, title, location, description, canonical_url");
        if (error) errors.push(`${company.name} (${profile.name}): ${error.message}`);
        else {
          saved += data?.length ?? 0;
          const evaluations = (data ?? []).flatMap((job) => {
            const posting = candidates.find((candidate) => candidate.title.trim() === job.title && candidate.location === job.location && candidate.url === job.canonical_url);
            if (!posting) return [];
            const evaluation = evaluatePosting(posting, profile.filters);
            return [{ user_id: company.user_id, job_id: job.id, job_profile_id: profile.id, match_score: evaluation.score, decision: evaluation.decision, explanation: evaluation.explanation, missing_requirements: evaluation.missingRequirements, model_provider: evaluation.modelProvider }];
          });
          if (evaluations.length) {
            const { error: evaluationError } = await supabase.from("job_evaluations").upsert(evaluations, { onConflict: "user_id,job_id,job_profile_id" });
            if (evaluationError) errors.push(`${company.name} (${profile.name}): imported jobs but profile evaluation failed (${evaluationError.message}).`);
          }
        }
      }
    } catch (error) {
      errors.push(`${company.name}: ${error instanceof Error ? error.message : "source request failed."}`);
    }
  }

  return NextResponse.json({ checked, sourcesWithPostings, fetched, matched, saved, errors });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return runDiscovery();
}
