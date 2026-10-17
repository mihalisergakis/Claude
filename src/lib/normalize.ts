/** Lowercase host without "www.", or null if the input isn't a usable URL/host. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Canonical https URL for a website, or null. */
export function normalizeWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    if (!url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL_RE.test(s) ? s : null;
}

/** US numbers to E.164; anything else is returned null rather than guessed. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Free email providers: an address here doesn't identify a business domain. */
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "msn.com",
  "live.com",
  "me.com",
  "comcast.net",
  "protonmail.com",
]);
