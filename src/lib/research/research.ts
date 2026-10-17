import { z } from "zod";
import { callStructured } from "@/lib/ai/client";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Organization } from "@/lib/types";
import { fetchSite, type FetchedPage } from "./fetch-site";

const PROMPT_VERSION = "research-v1";

const sourced = <T extends z.ZodType>(value: T) =>
  z.object({
    value,
    quote: z.string().describe("Exact text copied from the page that supports the value"),
    source_url: z.string().describe("URL of the page the quote was copied from"),
  });

const ResearchSchema = z.object({
  org_type: sourced(z.enum(["solo_agent", "team", "independent_brokerage", "franchise_office", "other"])).nullable(),
  city: sourced(z.string()).nullable(),
  state: sourced(z.string().describe("Two-letter US state code")).nullable(),
  brokerage: sourced(z.string().describe("Brokerage the team/agent is affiliated with")).nullable(),
  roster: z
    .object({
      source_url: z.string(),
      appears_complete: z.boolean().describe("True only if the page presents itself as the full team roster"),
      people: z.array(
        z.object({
          name: z.string(),
          role: z.string().nullable(),
          is_licensed_agent: z.boolean().nullable().describe("null if the page doesn't make it clear"),
        }),
      ),
    })
    .nullable(),
  contacts: z.array(
    z.object({
      name: z.string().nullable(),
      role: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      quote: z.string(),
      source_url: z.string(),
    }),
  ),
  services: z.array(sourced(z.string())),
  operational_signals: z
    .array(sourced(z.string()))
    .describe("Observable signals of operational complexity: admin/TC staff, multiple offices, listing volume, etc."),
  summary: z.string().describe("Two or three neutral sentences describing the business, using only what the pages say"),
});

type Research = z.infer<typeof ResearchSchema>;

const SYSTEM = `You extract facts about a business from the text of its own website.
Rules:
- Only report what the pages state. Every value needs a quote copied exactly from the page text and the URL of that page.
- If something isn't stated, return null or an empty list. Never guess emails, team size, software they use, or business details.
- Do not infer pain points or opinions.`;

function squash(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pages match regardless of trailing slash, scheme, "www." or query string. */
function findPage(pages: FetchedPage[], url: string): FetchedPage | null {
  const key = (u: string) => {
    try {
      const parsed = new URL(u);
      return parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "");
    } catch {
      return u;
    }
  };
  return pages.find((p) => key(p.url) === key(url)) ?? null;
}

/** A quote counts as verified only if it appears verbatim (modulo whitespace/case) on the cited page. */
function quoteOnPage(pages: FetchedPage[], url: string, quote: string): boolean {
  const q = squash(quote);
  if (q.length < 3) return false;
  const page = findPage(pages, url);
  return page ? squash(page.text).includes(q) : false;
}

function pagesPrompt(org: Organization, pages: FetchedPage[]) {
  const body = pages
    .map((p) => `<page url="${p.url}">\n${p.text}\n</page>`)
    .join("\n\n");
  return `Business on record: ${org.name}${org.city ? ` (${org.city}, ${org.state ?? ""})` : ""}
Website: ${org.website}

${body}

Extract the facts and call submit_research.`;
}

interface FactRow {
  workspace_id: string;
  organization_id: string;
  field: string;
  value: unknown;
  quote: string | null;
  source_url: string | null;
  source_type: "website";
  extracted_by: "ai" | "rule";
  is_verified: boolean;
}

export async function researchOrganization(db: SupabaseClient, orgId: string) {
  const { data: org, error } = await db.from("organizations").select("*").eq("id", orgId).single<Organization>();
  if (error) throw error;
  if (!org.website) {
    await markResearched(db, org, "No website on record; nothing to research.");
    return;
  }

  const site = await fetchSite(org.website);
  if (site.error || site.pages.length === 0) {
    await markResearched(db, org, `Website research skipped: ${site.error ?? "no pages loaded"}`);
    return;
  }

  const { data: research } = await callStructured({
    step: "research",
    system: SYSTEM,
    prompt: pagesPrompt(org, site.pages),
    resultTool: { name: "submit_research", description: "Submit the facts extracted from the website pages." },
    schema: ResearchSchema,
    effort: "low",
  });

  // Re-research replaces earlier website facts (email facts stay tied to their contacts).
  await db.from("facts").delete().eq("organization_id", org.id).eq("source_type", "website").neq("field", "email");

  const facts: FactRow[] = [];
  const base = { workspace_id: org.workspace_id, organization_id: org.id, source_type: "website" as const };
  const addSourced = (field: string, item: { value: unknown; quote: string; source_url: string } | null) => {
    if (item && quoteOnPage(site.pages, item.source_url, item.quote)) {
      facts.push({ ...base, field, value: item.value, quote: item.quote, source_url: item.source_url, extracted_by: "ai", is_verified: true });
    }
  };

  addSourced("org_type", research.org_type);
  addSourced("city", research.city);
  addSourced("state", research.state);
  addSourced("brokerage", research.brokerage);
  research.services.forEach((s) => addSourced("service", s));
  research.operational_signals.forEach((s) => addSourced("operational_signal", s));
  facts.push({ ...base, field: "summary", value: research.summary, quote: null, source_url: org.website, extracted_by: "ai", is_verified: false });

  const teamSize = rosterTeamSize(research, site.pages);
  if (teamSize) {
    facts.push({
      ...base,
      field: "team_size",
      value: teamSize.count,
      quote: `${teamSize.count} agents listed: ${teamSize.names.slice(0, 25).join(", ")}`,
      source_url: teamSize.url,
      extracted_by: "rule",
      is_verified: teamSize.complete,
    });
  }

  const { data: inserted, error: factsError } = await db.from("facts").insert(facts).select("id, field, value, is_verified");
  if (factsError) throw factsError;

  await saveContacts(db, org, research, site.pages);

  const factId = (field: string) => inserted?.find((f) => f.field === field && f.is_verified)?.id ?? null;
  const verifiedValue = (field: string) => inserted?.find((f) => f.field === field && f.is_verified)?.value as string | undefined;

  const update: Record<string, unknown> = { researched_at: new Date().toISOString() };
  if (org.org_type === "unknown" && verifiedValue("org_type")) update.org_type = verifiedValue("org_type");
  if (!org.city && verifiedValue("city")) update.city = verifiedValue("city");
  if (!org.state && verifiedValue("state")) update.state = String(verifiedValue("state")).toUpperCase().slice(0, 2);
  if (factId("team_size")) {
    update.team_size = teamSize!.count;
    update.team_size_fact_id = factId("team_size");
  }
  if (!org.phone_e164) {
    const phone = site.pages.flatMap((p) => p.phones).map(normalizePhone).find(Boolean);
    if (phone) update.phone_e164 = phone;
  }
  const brokerageName = verifiedValue("brokerage");
  if (brokerageName && !org.brokerage_id) {
    const { data: brokerage } = await db
      .from("brokerages")
      .upsert({ workspace_id: org.workspace_id, name: brokerageName }, { onConflict: "workspace_id,name" })
      .select("id")
      .single();
    if (brokerage) update.brokerage_id = brokerage.id;
  }
  await db.from("organizations").update(update).eq("id", org.id);

  await advanceAfterResearch(db, org, `Researched ${site.pages.length} page(s); ${facts.length} fact(s) recorded (${PROMPT_VERSION}).`);
}

function rosterTeamSize(research: Research, pages: FetchedPage[]) {
  const roster = research.roster;
  if (!roster) return null;
  const page = findPage(pages, roster.source_url);
  if (!page) return null;
  const text = squash(page.text);
  const agents = roster.people.filter((p) => p.is_licensed_agent !== false && text.includes(squash(p.name)));
  if (agents.length === 0) return null;
  return {
    count: agents.length,
    names: agents.map((a) => a.name),
    url: roster.source_url,
    complete: roster.appears_complete && agents.length === roster.people.filter((p) => p.is_licensed_agent !== false).length,
  };
}

async function saveContacts(db: SupabaseClient, org: Organization, research: Research, pages: FetchedPage[]) {
  // Emails count only if they literally appear on the cited page.
  const onPage = new Map<string, string>();
  for (const page of pages) for (const e of page.emails) if (!onPage.has(e)) onPage.set(e, page.url);

  const candidates = new Map<string, { name: string | null; role: string | null; phone: string | null; url: string; byAi: boolean }>();
  for (const c of research.contacts) {
    const email = normalizeEmail(c.email);
    if (email && onPage.has(email)) {
      candidates.set(email, { name: c.name, role: c.role, phone: normalizePhone(c.phone), url: onPage.get(email)!, byAi: true });
    }
  }
  for (const [email, url] of onPage) {
    if (!candidates.has(email) && normalizeEmail(email)) {
      candidates.set(email, { name: null, role: null, phone: null, url, byAi: false });
    }
  }

  const { count: existingPrimary } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .eq("is_primary", true);
  let needPrimary = !existingPrimary;

  for (const [email, c] of candidates) {
    const { data: existing } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", org.workspace_id)
      .eq("email", email)
      .maybeSingle();
    if (existing) continue;

    const { data: contact, error } = await db
      .from("contacts")
      .insert({
        workspace_id: org.workspace_id,
        organization_id: org.id,
        full_name: c.name,
        role: c.role,
        email,
        email_status: "source_listed",
        phone_e164: c.phone,
        is_primary: needPrimary,
      })
      .select("id")
      .single();
    if (error) throw error;
    needPrimary = false;

    const { data: fact } = await db
      .from("facts")
      .insert({
        workspace_id: org.workspace_id,
        organization_id: org.id,
        contact_id: contact.id,
        field: "email",
        value: email,
        quote: email,
        source_url: c.url,
        source_type: "website",
        extracted_by: c.byAi ? "ai" : "rule",
        is_verified: true,
      })
      .select("id")
      .single();
    if (fact) await db.from("contacts").update({ email_fact_id: fact.id }).eq("id", contact.id);
  }
}

async function markResearched(db: SupabaseClient, org: Organization, note: string) {
  await db.from("organizations").update({ researched_at: new Date().toISOString() }).eq("id", org.id);
  await advanceAfterResearch(db, org, note);
}

/** Move discovered entries to researched, log it, and queue qualification. */
async function advanceAfterResearch(db: SupabaseClient, org: Organization, note: string) {
  await db
    .from("pipeline_entries")
    .update({ stage: "researched", stage_changed_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("stage", "discovered");
  await db.from("activities").insert({ workspace_id: org.workspace_id, organization_id: org.id, type: "system", summary: note });

  const { data: entries } = await db.from("pipeline_entries").select("id").eq("organization_id", org.id);
  if (entries?.length) {
    await db.from("jobs").insert(
      entries.map((e) => ({ workspace_id: org.workspace_id, type: "qualify", payload: { pipeline_entry_id: e.id } })),
    );
  }
}
