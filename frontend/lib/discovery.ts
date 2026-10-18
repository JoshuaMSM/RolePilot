import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type NormalizedPosting = {
  id: string;
  title: string;
  url: string | null;
  location: string | null;
  description: string | null;
  postedAt: string | null;
};

function stripHtml(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim().slice(0, 20000) : null;
}

function countryFromLocation(location: string | null) {
  const known = ["India", "Germany", "Switzerland", "Singapore", "Australia", "Ireland"];
  return known.find((country) => location?.toLocaleLowerCase().includes(country.toLocaleLowerCase())) ?? null;
}

function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized.startsWith("2") || normalized.startsWith("3");
  }
  return false;
}

function locationText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(locationText).filter((part): part is string => Boolean(part)).join(" / ") || null;
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const address = object.address && typeof object.address === "object" ? object.address as Record<string, unknown> : object;
  return [address.addressLocality, address.addressRegion, address.addressCountry]
    .flatMap((part) => typeof part === "string" ? [part] : part && typeof part === "object" && "name" in part ? [String((part as { name: unknown }).name)] : [])
    .filter(Boolean).join(", ") || null;
}

function collectJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  const own = types.some((type) => type === "JobPosting") ? [object] : [];
  return [...own, ...collectJsonLd(object["@graph"]), ...collectJsonLd(object.itemListElement), ...collectJsonLd(object.item)];
}

async function safeFetch(url: string, init: { method?: "GET" | "POST"; body?: string; accept?: string } = {}) {
  let target = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (target.protocol !== "https:" || target.username || target.password || target.port) throw new Error("Careers URLs must use public HTTPS without custom ports.");
    const host = target.hostname.toLowerCase();
    if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Private network careers URLs are not allowed.");
    const resolved = await lookup(host, { all: true });
    if (!resolved.length || resolved.some((address) => !isPublicAddress(address.address))) throw new Error("Careers URL must resolve to public internet addresses.");
    const response = await fetch(target, { method: init.method ?? "GET", body: init.body, headers: { Accept: init.accept ?? "application/json,text/html;q=0.9,*/*;q=0.8", ...(init.body ? { "Content-Type": "application/json" } : {}), "User-Agent": "RolePilotJobDiscovery/1.0 (+public careers listing reader)" }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Source returned HTTP ${response.status} without a redirect target.`);
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) throw new Error(`Careers source returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > 5_000_000) throw new Error("Careers source response is larger than 5 MB.");
    return { response, body, target };
  }
  throw new Error("Careers source redirected too many times.");
}

function normalizeJsonLd(html: string, baseUrl: string): NormalizedPosting[] {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const results: NormalizedPosting[] = [];
  for (const match of scripts) {
    try {
      const data = JSON.parse(match[1]);
      for (const item of collectJsonLd(data)) {
        const title = typeof item.title === "string" ? item.title.trim() : "";
        if (!title) continue;
        const rawUrl = typeof item.url === "string" ? item.url : typeof item.sameAs === "string" ? item.sameAs : null;
        let url: string | null = null;
        try { url = rawUrl ? new URL(rawUrl, baseUrl).toString() : null; } catch { /* Ignore malformed posting URL. */ }
        const location = locationText(item.jobLocation) ?? locationText(item.jobLocationType);
        const date = typeof item.datePosted === "string" ? item.datePosted : null;
        results.push({ id: url ?? `${title}:${location ?? ""}`, title, url, location, description: stripHtml(item.description), postedAt: date });
      }
    } catch { /* Ignore malformed structured-data blocks. */ }
  }
  return results;
}

async function fetchJson(url: string) {
  const { body } = await safeFetch(url);
  return JSON.parse(body) as unknown;
}

async function discoverWorkdayJobs(page: URL): Promise<{ source: string; jobs: NormalizedPosting[] }> {
  // Workday's public CXS endpoint backs the public listings and does not require
  // an account. The tenant and site come from the official myworkdayjobs URL.
  const tenant = page.hostname.split(".")[0].replace(/\.wd\d+$/i, "");
  const site = page.pathname.split("/").filter(Boolean).find((part) => !/^\w{2}-\w{2}$/i.test(part));
  if (!tenant || !site) throw new Error("Workday careers URL needs a tenant and site, for example company.wd5.myworkdayjobs.com/en-US/company.");
  const endpoint = new URL(`/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`, `${page.protocol}//${page.host}`);
  const { body } = await safeFetch(endpoint.toString(), { method: "POST", body: JSON.stringify({ appliedFacets: {}, limit: 100, offset: 0, searchText: "" }) });
  const data = JSON.parse(body) as { jobPostings?: { title?: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[]; jobReqId?: string }[] };
  const jobs = (data.jobPostings ?? []).flatMap((job) => {
    const title = job.title?.trim();
    if (!title) return [];
    const url = job.externalPath ? new URL(job.externalPath, `${page.protocol}//${page.host}`).toString() : null;
    return [{ id: job.jobReqId ?? job.externalPath ?? `${title}:${job.locationsText ?? ""}`, title, url, location: job.locationsText ?? null, description: job.bulletFields?.join(" · ") ?? null, postedAt: job.postedOn ?? null }];
  });
  return { source: "workday", jobs };
}

function smartRecruitersPostingUrl(job: { id: string; name: string; postingUrl?: string; ref?: string }, companySlug: string) {
  if (job.postingUrl?.startsWith("https://jobs.smartrecruiters.com/")) return job.postingUrl;
  try {
    const reference = new URL(job.ref ?? "");
    if (reference.protocol === "https:" && reference.hostname === "jobs.smartrecruiters.com") return reference.toString();
  } catch { /* Ignore API and malformed refs; construct the public job page below. */ }
  const titleSlug = job.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(companySlug)}/${encodeURIComponent(job.id)}-${titleSlug}`;
}

export async function discoverCompanyJobs(careersUrl: string): Promise<{ source: string; jobs: NormalizedPosting[] }> {
  const page = new URL(careersUrl);
  const host = page.hostname.toLowerCase();
  const pathParts = page.pathname.split("/").filter(Boolean);
  if (host.endsWith(".myworkdayjobs.com")) return discoverWorkdayJobs(page);
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const token = pathParts[0];
    if (!token) throw new Error("Greenhouse careers URL needs a board slug, for example boards.greenhouse.io/company.");
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`) as { jobs?: { id: number; title: string; absolute_url?: string; updated_at?: string; location?: { name?: string }; content?: string }[] };
    return { source: "greenhouse", jobs: (data.jobs ?? []).map((job) => ({ id: String(job.id), title: job.title, url: job.absolute_url ?? null, location: job.location?.name ?? null, description: stripHtml(job.content), postedAt: job.updated_at ?? null })) };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const slug = pathParts[0];
    if (!slug) throw new Error("Lever careers URL needs a company slug.");
    const region = host === "jobs.eu.lever.co" ? "eu" : "";
    const data = await fetchJson(`https://api.${region ? "eu." : ""}lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`) as { id: string; text: string; hostedUrl?: string; categories?: { location?: string }; descriptionPlain?: string; createdAt?: number }[];
    return { source: "lever", jobs: (Array.isArray(data) ? data : []).map((job) => ({ id: job.id, title: job.text, url: job.hostedUrl ?? null, location: job.categories?.location ?? null, description: stripHtml(job.descriptionPlain), postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null })) };
  }
  if (host === "jobs.ashbyhq.com" || host === "jobs.eu.ashbyhq.com") {
    const slug = pathParts[0];
    if (!slug) throw new Error("Ashby careers URL needs a job-board slug.");
    const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`) as { jobs?: { id: string; title: string; jobUrl?: string; location?: string; descriptionHtml?: string; publishedAt?: string }[] };
    return { source: "ashby", jobs: (data.jobs ?? []).map((job) => ({ id: job.id, title: job.title, url: job.jobUrl ?? null, location: job.location ?? null, description: stripHtml(job.descriptionHtml), postedAt: job.publishedAt ?? null })) };
  }
  if (host === "careers.smartrecruiters.com" || host === "jobs.smartrecruiters.com") {
    const slug = pathParts[0];
    if (!slug) throw new Error("SmartRecruiters careers URL needs a company slug.");
    const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`) as { content?: { id: string; name: string; ref?: string; postingUrl?: string; location?: { city?: string; region?: string; country?: string }; releasedDate?: string; jobAd?: { sections?: { jobDescription?: { text?: string } } } }[] };
    return { source: "smartrecruiters", jobs: (data.content ?? []).map((job) => ({ id: job.id, title: job.name, url: smartRecruitersPostingUrl(job, slug), location: [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ") || null, description: stripHtml(job.jobAd?.sections?.jobDescription?.text), postedAt: job.releasedDate ?? null })) };
  }
  const { body, target } = await safeFetch(careersUrl);
  if (target.hostname !== page.hostname) return discoverCompanyJobs(target.toString());
  const jobs = normalizeJsonLd(body, target.toString());
  if (!jobs.length) {
    const atsLinks = [...body.matchAll(/href=["']([^"']*(?:boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs(?:\.eu)?\.lever\.co|jobs(?:\.eu)?\.ashbyhq\.com|careers\.smartrecruiters\.com|jobs\.smartrecruiters\.com)[^"']*)["']/gi)]
      .map((match) => match[1].replace(/&amp;/g, "&"));
    for (const link of atsLinks) {
      try { return await discoverCompanyJobs(new URL(link, target).toString()); } catch { /* Try the next public ATS link. */ }
    }
    throw new Error("No public job feed, ATS link, or JobPosting structured data found. This careers page needs a dedicated connector.");
  }
  return { source: "jsonld", jobs };
}

export function normalizeCompany(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function matchesTargetRole(title: string, roles: string[]) {
  if (!roles.length) return true;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\/_-]+/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\bback end\b/g, "backend");
  const normalizedTitle = normalize(title);
  return roles.some((role) => {
    const core = normalize(role).replace(/\b(senior|junior|staff|principal|mid level|midlevel)\b/g, " ").replace(/\s+/g, " ").trim();
    const variants = [core];
    if (core.includes("software engineer")) variants.push(core.replace("software engineer", "software developer"), core.replace("software engineer", "software development engineer"));
    if (core.includes("technical lead")) variants.push(core.replace("technical lead", "tech lead"));
    return variants.some((variant) => variant && normalizedTitle.includes(variant));
  });
}

export function matchesProfile(job: NormalizedPosting, filters: Record<string, unknown>) {
  const roles = Array.isArray(filters.target_roles) ? filters.target_roles.filter((value): value is string => typeof value === "string") : [];
  const countries = Array.isArray(filters.countries) ? filters.countries.filter((value): value is string => typeof value === "string") : [];
  const cities = Array.isArray(filters.preferred_cities) ? filters.preferred_cities.filter((value): value is string => typeof value === "string") : [];
  if (!matchesTargetRole(job.title, roles)) return false;
  const location = (job.location ?? "").toLocaleLowerCase();
  const country = countryFromLocation(job.location);
  if (country && countries.length && !countries.some((value) => value.toLocaleLowerCase() === country.toLocaleLowerCase())) return false;
  if (cities.length && location && !cities.some((city) => location.includes(city.toLocaleLowerCase()))) return false;
  return true;
}
