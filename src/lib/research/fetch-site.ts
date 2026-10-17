/**
 * Polite fetching of a prospect's own public website: respects robots.txt,
 * identifies itself, fetches a handful of pages, and returns plain text.
 */

const USER_AGENT = "ProspectResearchBot/1.0 (+business research; contact via site owner)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES = 5;
const MAX_CHARS_PER_PAGE = 15_000;

const INTERESTING_LINK = /(team|agent|about|contact|our-?people|staff|meet|who-we-are|realtor|join)/i;

export interface FetchedPage {
  url: string;
  text: string;
  emails: string[];
  phones: string[];
}

async function fetchText(url: string): Promise<{ status: number; body: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("text/plain")) {
      return { status: res.status, body: "", finalUrl: res.url };
    }
    return { status: res.status, body: await res.text(), finalUrl: res.url };
  } catch {
    return null;
  }
}

/** Minimal robots.txt check for the "*" group. Unreachable robots.txt = allowed. */
export async function robotsAllows(origin: string, path: string): Promise<boolean> {
  const res = await fetchText(`${origin}/robots.txt`);
  if (!res || res.status >= 400 || !res.body) return true;

  let applies = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const raw of res.body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    const k = key.toLowerCase();
    if (k === "user-agent") applies = value.trim() === "*" || /prospectresearchbot/i.test(value);
    else if (applies && k === "disallow" && value) disallow.push(value.trim());
    else if (applies && k === "allow" && value) allow.push(value.trim());
  }
  const longest = (rules: string[]) =>
    Math.max(-1, ...rules.filter((r) => path.startsWith(r.replace(/\*.*$/, ""))).map((r) => r.length));
  return longest(allow) >= longest(disallow);
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

function extractContacts(html: string, text: string) {
  const mailtos = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]));
  const emails = new Set(
    [...mailtos, ...(text.match(EMAIL_IN_TEXT) ?? [])]
      .map((e) => e.toLowerCase())
      .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !e.includes("example.com") && !e.includes("sentry")),
  );
  const tels = [...html.matchAll(/href=["']tel:([^"']+)/gi)].map((m) => m[1]);
  const phones = new Set([...tels, ...(text.match(PHONE_IN_TEXT) ?? [])]);
  return { emails: [...emails], phones: [...phones] };
}

function pickLinks(html: string, base: URL): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(m[1], base);
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      const label = htmlToText(m[2]);
      if (INTERESTING_LINK.test(url.pathname) || INTERESTING_LINK.test(label)) {
        url.hash = "";
        url.search = "";
        links.add(url.toString());
      }
    } catch {
      // ignore malformed hrefs
    }
  }
  return [...links];
}

export interface SiteFetchResult {
  pages: FetchedPage[];
  blockedByRobots: boolean;
  error: string | null;
}

export async function fetchSite(website: string): Promise<SiteFetchResult> {
  let start: URL;
  try {
    start = new URL(website);
  } catch {
    return { pages: [], blockedByRobots: false, error: "Invalid website URL" };
  }
  if (!(await robotsAllows(start.origin, start.pathname || "/"))) {
    return { pages: [], blockedByRobots: true, error: "robots.txt disallows fetching this site" };
  }

  const home = await fetchText(start.toString());
  if (!home || home.status >= 400 || !home.body) {
    return { pages: [], blockedByRobots: false, error: `Could not load ${start} (${home?.status ?? "network error"})` };
  }

  const pages: FetchedPage[] = [];
  const addPage = (url: string, html: string) => {
    const text = htmlToText(html);
    pages.push({ url, text: text.slice(0, MAX_CHARS_PER_PAGE), ...extractContacts(html, text) });
  };
  addPage(home.finalUrl, home.body);

  const finalBase = new URL(home.finalUrl);
  const seen = new Set([home.finalUrl]);
  for (const link of pickLinks(home.body, finalBase)) {
    if (pages.length >= MAX_PAGES) break;
    if (seen.has(link)) continue;
    seen.add(link);
    const url = new URL(link);
    if (!(await robotsAllows(url.origin, url.pathname))) continue;
    const page = await fetchText(link);
    if (page && page.status < 400 && page.body) addPage(page.finalUrl, page.body);
  }
  return { pages, blockedByRobots: false, error: null };
}
