from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, quote_plus, urljoin, urlsplit

import httpx


class CareersSearchUnavailable(RuntimeError):
    """The web search provider did not return a usable results page."""

    def __init__(self, message: str, *, blocked: bool = False) -> None:
        super().__init__(message)
        self.blocked = blocked


@dataclass
class Posting:
    id: str
    title: str
    url: str | None
    location: str | None
    description: str | None
    posted_at: str | None


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str


ATS_HOSTS = {
    "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.eu.lever.co",
    "jobs.ashbyhq.com", "jobs.eu.ashbyhq.com", "careers.smartrecruiters.com", "jobs.smartrecruiters.com",
}
EXCLUDED_SEARCH_HOSTS = {
    "google.com", "www.google.com", "youtube.com", "linkedin.com", "www.linkedin.com",
    "facebook.com", "www.facebook.com", "instagram.com", "wikipedia.org", "www.wikipedia.org",
    "brave.com", "www.brave.com", "search.brave.com",
}
USER_AGENT = "RolePilotLocalAgent/1.0 (public careers listings; contact: local user)"


def clean_text(value: Any, limit: int = 20000) -> str | None:
    if not isinstance(value, str):
        return None
    value = html.unescape(re.sub(r"<[^>]*>", " ", value))
    value = re.sub(r"\s+", " ", value).strip()
    return value[:limit] or None


def _public_https_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Careers links must use public HTTPS.")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Private and local careers links are not allowed.")
    try:
        addresses = [ipaddress.ip_address(hostname)]
    except ValueError:
        try:
            addresses = [ipaddress.ip_address(row[4][0]) for row in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)]
        except OSError as error:
            raise ValueError("Careers hostname could not be resolved.") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Careers link does not resolve to a public internet address.")
    return value


def _fetch(url: str, method: str = "GET", body: dict[str, Any] | None = None) -> tuple[str, str]:
    target = url
    with httpx.Client(timeout=15, follow_redirects=False, headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/html;q=0.9,*/*;q=0.8"}) as client:
        for _ in range(4):
            _public_https_url(target)
            response = client.request(method, target, json=body)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise RuntimeError(f"Source returned HTTP {response.status_code} without a redirect location.")
                target = urljoin(target, location)
                continue
            response.raise_for_status()
            if len(response.content) > 5_000_000:
                raise RuntimeError("Careers source response exceeded 5 MB.")
            return target, response.text
    raise RuntimeError("Careers source redirected too many times.")


def _location(value: Any) -> str | None:
    if isinstance(value, str):
        return clean_text(value, 500)
    if isinstance(value, list):
        return " / ".join(part for part in (_location(item) for item in value) if part) or None
    if isinstance(value, dict):
        address = value.get("address") if isinstance(value.get("address"), dict) else value
        parts = [address.get(key) for key in ("addressLocality", "addressRegion", "addressCountry")]
        return ", ".join(str(part.get("name") if isinstance(part, dict) else part) for part in parts if part) or None
    return None


def _jsonld_postings(document: str, base_url: str) -> list[Posting]:
    results: list[Posting] = []

    def walk(item: Any) -> None:
        if isinstance(item, list):
            for part in item:
                walk(part)
            return
        if not isinstance(item, dict):
            return
        types = item.get("@type", [])
        if isinstance(types, str):
            types = [types]
        if "JobPosting" in types:
            title = clean_text(item.get("title"), 500)
            if title:
                raw_url = item.get("url") or item.get("sameAs")
                posting_url = urljoin(base_url, raw_url) if isinstance(raw_url, str) else None
                results.append(Posting(
                    id=posting_url or f"{title}:{_location(item.get('jobLocation')) or ''}",
                    title=title,
                    url=posting_url,
                    location=_location(item.get("jobLocation") or item.get("jobLocationType")),
                    description=clean_text(item.get("description")),
                    posted_at=item.get("datePosted") if isinstance(item.get("datePosted"), str) else None,
                ))
        for key in ("@graph", "itemListElement", "item"):
            if key in item:
                walk(item[key])

    for block in re.findall(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", document, flags=re.I | re.S):
        try:
            walk(json.loads(html.unescape(block)))
        except (json.JSONDecodeError, TypeError):
            continue
    return results


def _json(url: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    _, document = _fetch(url, method, body)
    try:
        return json.loads(document)
    except json.JSONDecodeError as error:
        raise RuntimeError("Career source returned invalid JSON.") from error


def _smartrecruiters_url(company: str, job_id: str, title: str, posting_url: str | None, ref: str | None) -> str:
    for candidate in (posting_url, ref):
        if candidate:
            parsed = urlsplit(candidate)
            if parsed.scheme == "https" and parsed.hostname == "jobs.smartrecruiters.com":
                return candidate
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return f"https://jobs.smartrecruiters.com/{quote(company, safe='')}/{quote(job_id, safe='')}-{slug}"


def discover_postings(careers_url: str, _depth: int = 0) -> tuple[str, list[Posting]]:
    """Read supported public ATS feeds or JobPosting JSON-LD from a careers page."""
    if _depth > 2:
        raise RuntimeError("Careers page linked through too many source pages.")
    safe_url = _public_https_url(careers_url)
    parsed = urlsplit(safe_url)
    host = (parsed.hostname or "").lower()
    parts = [part for part in parsed.path.split("/") if part]

    if host in {"boards.greenhouse.io", "job-boards.greenhouse.io"}:
        if not parts:
            raise RuntimeError("Greenhouse careers URL is missing its board name.")
        data = _json(f"https://boards-api.greenhouse.io/v1/boards/{quote(parts[0], safe='')}/jobs?content=true")
        jobs = data.get("jobs", []) if isinstance(data, dict) else []
        return "greenhouse", [Posting(str(row.get("id")), str(row.get("title") or ""), row.get("absolute_url"), (row.get("location") or {}).get("name"), clean_text(row.get("content")), row.get("updated_at")) for row in jobs if isinstance(row, dict) and row.get("title")]

    if host in {"jobs.lever.co", "jobs.eu.lever.co"}:
        if not parts:
            raise RuntimeError("Lever careers URL is missing its company slug.")
        region = "eu." if host == "jobs.eu.lever.co" else ""
        data = _json(f"https://api.{region}lever.co/v0/postings/{quote(parts[0], safe='')}?mode=json")
        return "lever", [Posting(str(row.get("id")), str(row.get("text") or ""), row.get("hostedUrl"), (row.get("categories") or {}).get("location"), clean_text(row.get("descriptionPlain")), datetime.fromtimestamp(row["createdAt"] / 1000, timezone.utc).isoformat() if row.get("createdAt") else None) for row in data if isinstance(row, dict) and row.get("text")]

    if host in {"jobs.ashbyhq.com", "jobs.eu.ashbyhq.com"}:
        if not parts:
            raise RuntimeError("Ashby careers URL is missing its job-board name.")
        data = _json(f"https://api.ashbyhq.com/posting-api/job-board/{quote(parts[0], safe='')}?includeCompensation=false")
        jobs = data.get("jobs", []) if isinstance(data, dict) else []
        return "ashby", [Posting(str(row.get("id") or row.get("jobUrl")), str(row.get("title") or ""), row.get("jobUrl"), row.get("location"), clean_text(row.get("descriptionHtml")), row.get("publishedAt")) for row in jobs if isinstance(row, dict) and row.get("title")]

    if host in {"careers.smartrecruiters.com", "jobs.smartrecruiters.com"}:
        if not parts:
            raise RuntimeError("SmartRecruiters careers URL is missing its company slug.")
        data = _json(f"https://api.smartrecruiters.com/v1/companies/{quote(parts[0], safe='')}/postings?limit=100")
        jobs = data.get("content", []) if isinstance(data, dict) else []
        postings = []
        for row in jobs:
            if not isinstance(row, dict) or not row.get("name"):
                continue
            location = row.get("location") or {}
            postings.append(Posting(
                str(row.get("id")), str(row["name"]),
                _smartrecruiters_url(parts[0], str(row.get("id")), str(row["name"]), row.get("postingUrl"), row.get("ref")),
                ", ".join(str(location[key]) for key in ("city", "region", "country") if location.get(key)) or None,
                clean_text((((row.get("jobAd") or {}).get("sections") or {}).get("jobDescription") or {}).get("text")),
                row.get("releasedDate"),
            ))
        return "smartrecruiters", postings

    if host.endswith(".myworkdayjobs.com"):
        tenant = host.split(".")[0]
        site = next((part for part in parts if not re.fullmatch(r"\w{2}-\w{2}", part)), None)
        if not site:
            raise RuntimeError("Workday careers URL is missing its site name.")
        endpoint = f"https://{host}/wday/cxs/{quote(tenant, safe='')}/{quote(site, safe='')}/jobs"
        data = _json(endpoint, "POST", {"appliedFacets": {}, "limit": 100, "offset": 0, "searchText": ""})
        jobs = data.get("jobPostings", []) if isinstance(data, dict) else []
        postings = []
        for row in jobs:
            if not isinstance(row, dict) or not row.get("title"):
                continue
            external_path = row.get("externalPath")
            postings.append(Posting(str(row.get("jobReqId") or external_path), str(row["title"]), urljoin(f"https://{host}", external_path) if external_path else None, row.get("locationsText"), clean_text(" · ".join(row.get("bulletFields", []))), row.get("postedOn")))
        return "workday", postings

    final_url, document = _fetch(safe_url)
    postings = _jsonld_postings(document, final_url)
    if postings:
        return "jsonld", postings

    links = re.findall(r"href=[\"']([^\"']+)[\"']", document, flags=re.I)
    for link in links:
        candidate = urljoin(final_url, html.unescape(link))
        candidate_host = (urlsplit(candidate).hostname or "").lower()
        if candidate_host in ATS_HOSTS:
            try:
                return discover_postings(candidate, _depth + 1)
            except (httpx.HTTPError, RuntimeError, ValueError):
                continue
    raise RuntimeError("No supported public job feed or JobPosting structured data was found.")


def _validated_search_url(value: str) -> str | None:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    host = parsed.hostname.lower().removeprefix("www.")
    if host in EXCLUDED_SEARCH_HOSTS or any(host == domain or host.endswith(f".{domain}") for domain in EXCLUDED_SEARCH_HOSTS):
        return None
    try:
        _public_https_url(value)
    except ValueError:
        return None
    return value


class BraveBrowserSearch:
    """Search the ordinary Brave Search results in a visible local Brave window."""

    DEFAULT_EXECUTABLE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

    def __init__(self, executable_path: str | None = None) -> None:
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as error:
            raise RuntimeError("Install the local browser dependency with `python -m pip install -r requirements.txt`.") from error

        executable = Path(executable_path or self.DEFAULT_EXECUTABLE).expanduser()
        if not executable.is_file():
            raise RuntimeError(f"Brave Browser executable not found at {executable}; set BRAVE_BROWSER_EXECUTABLE in agent/.env.")
        self._playwright_error = PlaywrightError
        self._timeout_error = PlaywrightTimeoutError
        self._playwright = sync_playwright().start()
        profile_path = Path.home() / "Library" / "Application Support" / "RolePilot" / "BraveSearchProfile"
        try:
            self._context = self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_path),
                executable_path=str(executable),
                headless=False,
                locale="en-IN",
                viewport={"width": 1440, "height": 1000},
            )
        except Exception as error:
            self._playwright.stop()
            raise RuntimeError(f"Could not start a separate visible Brave search window: {error}") from error
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()

    def search_careers(self, company_name: str, country: str | None = None) -> list[SearchResult]:
        query = f"{company_name} careers" + (f" {country}" if country else "")
        url = f"https://search.brave.com/search?q={quote_plus(query)}&source=desktop"
        try:
            response = self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
            if response and response.status >= 400:
                raise CareersSearchUnavailable(
                    f"Brave Search returned HTTP {response.status}.",
                    blocked=response.status in {403, 429, 503},
                )
            body = self._page.locator("body").inner_text(timeout=10000).lower()
        except CareersSearchUnavailable:
            raise
        except (self._playwright_error, self._timeout_error) as error:
            raise CareersSearchUnavailable(f"Brave Search page did not load ({type(error).__name__}).") from error

        challenge_terms = (
            "captcha", "verify you are human", "unusual traffic", "automated requests",
            "too many requests", "rate limit exceeded", "temporarily blocked", "http 429", "error 429",
        )
        if any(term in body for term in challenge_terms):
            raise CareersSearchUnavailable(
                "Brave Search displayed a verification, rate-limit, or access-block page; no challenge was attempted.",
                blocked=True,
            )

        try:
            # Capture the rendered anchors in one browser-side read. Brave Search
            # updates its result modules while the page hydrates, so walking a
            # live locator by index can wait on elements that disappear mid-loop.
            anchor_rows = self._page.locator("a[href]").evaluate_all(
                """anchors => anchors.slice(0, 150).map(anchor => ({
                    href: anchor.href || '',
                    text: (anchor.innerText || '').trim()
                }))"""
            )
        except (self._playwright_error, self._timeout_error) as error:
            raise CareersSearchUnavailable("Brave Search result links changed before they could be read.") from error

        results: list[SearchResult] = []
        for row in anchor_rows:
            if not isinstance(row, dict):
                continue
            candidate = row.get("href") or ""
            text = clean_text(row.get("text"), 1500) or ""
            if not candidate or not text:
                continue
            host = (urlsplit(candidate).hostname or "").lower()
            if host == "brave.com" or host.endswith(".brave.com"):
                continue
            resolved = _validated_search_url(candidate)
            if not resolved:
                continue
            title = text.split("\n", 1)[0].strip()
            snippet = text[len(title):].strip()
            results.append(SearchResult(title, resolved, snippet))
        if not results:
            raise CareersSearchUnavailable("Brave Search returned no usable public result links for this careers query.")
        return results

    def close(self) -> None:
        try:
            self._context.close()
        finally:
            self._playwright.stop()


def resolve_careers_page(
    company_name: str,
    results: list[SearchResult],
    trusted_domain: str | None = None,
    catalog_careers_url: str | None = None,
) -> str:
    """Choose a career URL only when the result is plausibly tied to the company."""
    brand_tokens = [token for token in re.findall(r"[a-z0-9]+", company_name.lower()) if token not in {"inc", "llc", "ltd", "limited", "technologies", "technology", "company", "global", "india", "the"}]
    expected = (trusted_domain or "").lower().strip().removeprefix("https://").removeprefix("http://").removeprefix("www.").split("/")[0]
    ranked: list[tuple[int, str]] = []
    for result in results:
        url = _validated_search_url(result.url)
        if not url:
            continue
        host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
        official_domain = bool(expected and (host == expected or host.endswith(f".{expected}")))
        searchable = f"{result.title} {result.snippet} {host}".lower()
        brand_hits = sum(1 for token in brand_tokens if token in searchable)
        is_ats = host in ATS_HOSTS
        career_signal = any(term in f"{result.title} {result.snippet} {url}".lower() for term in ("career", "job", "opening", "opportunit"))
        identity_match = official_domain or (is_ats and brand_hits >= 1) or (not expected and brand_hits >= max(1, min(2, len(brand_tokens))))
        if not identity_match or not career_signal:
            continue
        score = (100 if official_domain else 0) + min(brand_hits, 4) * 10 + (5 if is_ats else 0)
        ranked.append((score, url))
    if ranked:
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked[0][1]
    if catalog_careers_url:
        return _public_https_url(catalog_careers_url)
    raise RuntimeError("Search results did not provide a careers URL that could be verified against the company name or catalog domain.")
