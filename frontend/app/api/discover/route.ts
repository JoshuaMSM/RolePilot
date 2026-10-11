import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverCompanyJobs, matchesProfile, normalizeCompany } from "@/lib/discovery";
import { evaluatePosting } from "@/lib/profile-matcher";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin discovery requests are not allowed." }, { status: 403 });
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = typeof auth?.claims?.sub === "string" ? auth.claims.sub : null;
  if (authError || !userId) return NextResponse.json({ error: "Sign in to discover jobs." }, { status: 401 });
  let body: { profileId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Choose a job profile first." }, { status: 400 }); }
  if (typeof body.profileId !== "string") return NextResponse.json({ error: "Choose a job profile first." }, { status: 400 });

  const { data: profile, error: profileError } = await supabase.from("job_profiles").select("id, name, enabled, filters").eq("id", body.profileId).eq("user_id", userId).maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!profile) return NextResponse.json({ error: "That profile was not found in your account." }, { status: 404 });
  if (!profile.enabled) return NextResponse.json({ error: "Enable this profile before discovering jobs." }, { status: 400 });
  const filters = (profile.filters ?? {}) as Record<string, unknown>;
  const targets = Array.isArray(filters.target_companies) ? filters.target_companies.filter((value): value is string => typeof value === "string").map(normalizeCompany) : [];
  const excluded = Array.isArray(filters.excluded_companies) ? filters.excluded_companies.filter((value): value is string => typeof value === "string").map(normalizeCompany) : [];
  const { data: catalog, error: catalogError } = await supabase.from("company_catalog").select("name, normalized_name, careers_url");
  if (catalogError) return NextResponse.json({ error: catalogError.message }, { status: 500 });
  const catalogByName = new Map((catalog ?? []).map((company) => [company.normalized_name, company]));
  const { data: currentCompanies, error: companiesError } = await supabase.from("companies").select("id, name, normalized_name, website_url").eq("user_id", userId);
  if (companiesError) return NextResponse.json({ error: companiesError.message }, { status: 500 });
  const currentByName = new Map((currentCompanies ?? []).map((company) => [company.normalized_name, company]));
  const missingRows = targets.flatMap((key) => {
    if (excluded.includes(key) || currentByName.has(key)) return [];
    const known = catalogByName.get(key);
    return known ? [{ user_id: userId, name: known.name, normalized_name: key, website_url: known.careers_url }] : [];
  });
  if (missingRows.length) {
    const { error } = await supabase.from("companies").upsert(missingRows, { onConflict: "user_id,normalized_name", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: refreshedCompanies, error: refreshError } = await supabase.from("companies").select("id, name, normalized_name, website_url").eq("user_id", userId);
  if (refreshError) return NextResponse.json({ error: refreshError.message }, { status: 500 });
  const sources = (refreshedCompanies ?? []).flatMap((company) => {
    if (!targets.includes(company.normalized_name) || excluded.includes(company.normalized_name)) return [];
    const careersUrl = catalogByName.get(company.normalized_name)?.careers_url ?? company.website_url ?? null;
    return careersUrl ? [{ ...company, website_url: careersUrl }] : [];
  });
  if (!sources.length) return NextResponse.json({ error: "Add a target company and save its official HTTPS careers URL in Companies first." }, { status: 400 });

  const scanSources = sources.slice(0, 50);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let fetched = 0;
      let matched = 0;
      let saved = 0;
      let sourcesWithPostings = 0;
      const sourceErrors: string[] = [];
      send({ type: "start", profile: profile.name, companies: scanSources.map((company) => company.name), total: scanSources.length });
      for (const company of scanSources) {
        send({ type: "company", name: company.name, status: "checking" });
        let companyFetched = 0;
        let companyMatched = 0;
        let companySaved = 0;
        let errorMessage: string | null = null;
        try {
          const { source, jobs } = await discoverCompanyJobs(company.website_url!);
          if (jobs.length) sourcesWithPostings += 1;
          fetched += jobs.length;
          companyFetched = jobs.length;
          const candidates = jobs.filter((job) => matchesProfile(job, filters));
          const rows = candidates.map((job) => ({
            user_id: userId, company_id: company.id, source_name: source, source_id: job.id, canonical_url: job.url,
            dedupe_key: `${source}:${company.normalized_name}:${job.id}`.slice(0, 250), title: job.title.trim(), location: job.location,
            city: null, country: ["India", "Germany", "Switzerland", "Singapore", "Australia", "Ireland"].find((country) => job.location?.toLocaleLowerCase().includes(country.toLocaleLowerCase())) ?? null,
            visa_sponsorship: "unknown", description: job.description, posted_at: job.postedAt,
          }));
          matched += rows.length;
          companyMatched = rows.length;
          if (rows.length) {
            const { data, error } = await supabase.from("jobs").upsert(rows, { onConflict: "user_id,dedupe_key" }).select("id, title, location, description, canonical_url");
            if (error) throw new Error(error.message);
            saved += data?.length ?? 0;
            companySaved = data?.length ?? 0;
            const evaluations = (data ?? []).map((job) => {
              const posting = candidates.find((candidate) => candidate.title.trim() === job.title && candidate.location === job.location && candidate.url === job.canonical_url);
              if (!posting) return null;
              const evaluation = evaluatePosting(posting, filters);
              return { user_id: userId, job_id: job.id, job_profile_id: profile.id, match_score: evaluation.score, decision: evaluation.decision, explanation: evaluation.explanation, missing_requirements: evaluation.missingRequirements, model_provider: evaluation.modelProvider };
            }).filter((evaluation): evaluation is NonNullable<typeof evaluation> => evaluation !== null);
            if (evaluations.length) {
              const { error: evaluationError } = await supabase.from("job_evaluations").upsert(evaluations, { onConflict: "user_id,job_id,job_profile_id" });
              if (evaluationError) throw new Error(`Imported jobs, but profile evaluation failed (${evaluationError.message}).`);
            }
          }
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : "Source request failed.";
          sourceErrors.push(`${company.name}: ${errorMessage}`);
        }
        send({ type: "company", name: company.name, status: errorMessage ? "error" : "complete", fetched: companyFetched, matched: companyMatched, saved: companySaved, error: errorMessage });
      }
      send({ type: "complete", profile: profile.name, checked: scanSources.length, sourcesWithPostings, fetched, matched, saved, sourceErrors });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
