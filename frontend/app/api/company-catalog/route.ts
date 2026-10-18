import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = above;
    }
  }
  return row[right.length];
}

function isPublicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const validLabels = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host);
  return validLabels && !isIP(host) && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);
}

function validateWebsiteDomain(value: unknown) {
  if (typeof value !== "string" || value.length > 260) return null;
  const input = value.trim().toLowerCase();
  if (!input || input.includes("/") || input.includes(":") || input.includes("?") || input.includes("#") || /\s/.test(input)) return null;
  try {
    const url = new URL(`https://${input}`);
    if (url.hostname !== input || url.pathname !== "/" || url.search || url.hash || !isPublicHostname(url.hostname)) return null;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input)) return null;
    return input;
  } catch {
    return null;
  }
}

const hiringPlatforms = new Set([
  "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.eu.lever.co",
  "jobs.ashbyhq.com", "jobs.eu.ashbyhq.com", "careers.smartrecruiters.com", "jobs.smartrecruiters.com",
]);

function validateCareersUrl(value: unknown, companyDomain: string) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !isPublicHostname(host)) return null;
    const relatedDomain = host === companyDomain || host.endsWith(`.${companyDomain}`);
    const knownPlatform = hiringPlatforms.has(host) || host.endsWith(".myworkdayjobs.com");
    if (!relatedDomain && !knownPlatform) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin company submissions are not allowed." }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 12_000) return NextResponse.json({ error: "Company details are too large." }, { status: 413 });

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || typeof auth?.claims?.sub !== "string") return NextResponse.json({ error: "Sign in to add a company." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Enter company name, website domain, and careers page." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 100 || !/[\p{L}\p{N}]/u.test(name)) return NextResponse.json({ error: "Company name must be 2–100 characters." }, { status: 400 });
  const websiteDomain = validateWebsiteDomain(body.websiteDomain);
  if (!websiteDomain) return NextResponse.json({ error: "Enter a public website domain such as example.com, without a path." }, { status: 400 });
  const careersUrl = validateCareersUrl(body.careersUrl, websiteDomain);
  if (!careersUrl) return NextResponse.json({ error: "Use an HTTPS careers page on the company domain or a supported hiring platform." }, { status: 400 });

  const normalizedName = normalizeName(name);
  if (!normalizedName) return NextResponse.json({ error: "Company name must contain English letters or numbers." }, { status: 400 });
  const { data: catalog, error: catalogError } = await supabase.from("company_catalog").select("name, normalized_name");
  if (catalogError) {
    console.error("[company-catalog] Catalog lookup failed", { code: catalogError.code, message: catalogError.message });
    return NextResponse.json({ error: "Could not check the company catalog. Try again.", ...(process.env.NODE_ENV === "development" ? { diagnostic: catalogError.message, code: catalogError.code } : {}) }, { status: 500 });
  }
  const closeMatch = (catalog ?? []).map((company) => ({
    name: company.name,
    normalized: company.normalized_name,
    distance: editDistance(normalizedName, company.normalized_name),
  })).filter((company) => company.normalized !== normalizedName)
    .sort((a, b) => a.distance - b.distance)[0];
  if (closeMatch && closeMatch.distance <= Math.max(2, Math.floor(Math.max(normalizedName.length, closeMatch.normalized.length) * 0.25))) {
    return NextResponse.json({ error: `This looks close to “${closeMatch.name}”. Select the existing catalog company instead of adding a duplicate.` }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("add_company_catalog_entry", {
    p_name: name,
    p_website_domain: websiteDomain,
    p_careers_url: careersUrl,
  });
  if (error) {
    console.error("[company-catalog] Insert RPC failed", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    if (error.code === "PGRST202" || error.code === "42883") return NextResponse.json({ error: "Company catalog setup is incomplete. Apply Supabase migration 202610170009_company_catalog_insert_rpc.sql, then try again." }, { status: 503 });
    const status = error.code === "42501" ? 401 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not add this company. Try again." : error.message, ...(process.env.NODE_ENV === "development" ? { diagnostic: error.message, code: error.code, details: error.details, hint: error.hint } : {}) }, { status });
  }
  const company = Array.isArray(data) ? data[0] : data;
  if (!company) return NextResponse.json({ error: "The company could not be added." }, { status: 500 });
  const created = company.created === true;
  return NextResponse.json({ company: { name: company.name }, created, message: created ? "Company added to the shared catalog." : "This company is already in the shared catalog." }, { status: created ? 201 : 200 });
}
