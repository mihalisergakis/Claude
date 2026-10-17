import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callStructured } from "@/lib/ai/client";
import { normalizeDomain, normalizeWebsite } from "@/lib/normalize";
import type { Product } from "@/lib/types";

export interface DiscoveryCriteria {
  state: string;
  county?: string;
  city?: string;
  org_types: string[];
  limit: number;
  notes?: string;
}

// Portals and social sites: we want each business's own website, and these
// sites' terms don't allow harvesting their profiles.
const BLOCKED_DOMAINS = [
  "zillow.com",
  "realtor.com",
  "homes.com",
  "redfin.com",
  "trulia.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "utahrealestate.com",
  "homelight.com",
  "fastexpert.com",
];

const CandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      website: z.string().describe("The business's own website (homepage URL)"),
      city: z.string().nullable(),
      state: z.string().nullable(),
      evidence_url: z.string().describe("Search result URL showing this business"),
      evidence: z.string().describe("Short text from the search result describing the business"),
    }),
  ),
});

const SYSTEM = `You find small businesses that match a description, using web search.
Rules:
- Return only businesses whose own website you saw in search results. Never invent a business or URL.
- Return the business's own homepage, not a portal, directory, or social profile.
- Skip businesses whose domain is in the provided "already known" list.
- Skip large franchise offices unless asked for them.
- Prefer variety: different neighborhoods and cities within the market.`;

export async function runDiscovery(db: SupabaseClient, discoveryRunId: string) {
  const { data: run, error } = await db.from("discovery_runs").select("*").eq("id", discoveryRunId).single();
  if (error) throw error;
  await db.from("discovery_runs").update({ status: "running" }).eq("id", run.id);

  try {
    const criteria = run.criteria as DiscoveryCriteria;
    const { data: product } = await db.from("products").select("*").eq("id", run.product_id).single<Product>();
    if (!product) throw new Error("Product not found");

    const { data: known } = await db
      .from("organizations")
      .select("domain")
      .eq("workspace_id", run.workspace_id)
      .eq("state", criteria.state)
      .not("domain", "is", null)
      .limit(300);
    const knownDomains = new Set((known ?? []).map((k) => k.domain as string));

    const market = [criteria.city, criteria.county ? `${criteria.county} County` : null, criteria.state]
      .filter(Boolean)
      .join(", ");
    const prompt = `Find up to ${criteria.limit} businesses of this kind: ${product.discovery.business_label}.
Market: ${market}
Business types wanted: ${criteria.org_types.join(", ")}
Ideal customer profile: ${product.icp.summary}
Search phrases that may help: ${product.discovery.search_hints.join("; ")}
${criteria.notes ? `Extra instructions: ${criteria.notes}` : ""}

Already known (skip these domains): ${[...knownDomains].slice(0, 300).join(", ") || "none"}

Search, then call submit_candidates with what you found.`;

    const { data } = await callStructured({
      step: "discovery",
      system: SYSTEM,
      prompt,
      resultTool: { name: "submit_candidates", description: "Submit the businesses found." },
      schema: CandidatesSchema,
      serverTools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: Math.min(10, Math.max(3, Math.ceil(criteria.limit / 3))),
          blocked_domains: BLOCKED_DOMAINS,
          user_location: { type: "approximate", region: criteria.state === "UT" ? "Utah" : criteria.state, city: criteria.city ?? null, country: "US" },
        },
      ],
      effort: "medium",
      maxTokens: 32000,
    });

    let created = 0;
    let skipped = 0;
    for (const c of data.candidates.slice(0, criteria.limit)) {
      const website = normalizeWebsite(c.website);
      const domain = normalizeDomain(c.website);
      if (!website || !domain || knownDomains.has(domain) || BLOCKED_DOMAINS.some((b) => domain.endsWith(b))) {
        skipped++;
        continue;
      }
      knownDomains.add(domain);

      const { data: org, error: orgError } = await db
        .from("organizations")
        .insert({
          workspace_id: run.workspace_id,
          name: c.name,
          website,
          domain,
          city: c.city ?? criteria.city ?? null,
          county: criteria.county ?? null,
          state: (c.state ?? criteria.state).toUpperCase().slice(0, 2),
          lead_source: `discovery:${run.id}`,
        })
        .select("id")
        .single();
      if (orgError) {
        skipped++; // most likely a domain that already exists
        continue;
      }
      created++;

      await db.from("facts").insert({
        workspace_id: run.workspace_id,
        organization_id: org.id,
        field: "discovered_via",
        value: { query_market: market, evidence: c.evidence },
        quote: c.evidence,
        source_url: c.evidence_url,
        source_type: "search_result",
        extracted_by: "ai",
        is_verified: false,
      });
      await db.from("pipeline_entries").insert({ workspace_id: run.workspace_id, organization_id: org.id, product_id: product.id });
      await db.from("jobs").insert({ workspace_id: run.workspace_id, type: "research", payload: { organization_id: org.id } });
    }

    await db
      .from("discovery_runs")
      .update({
        status: "done",
        candidates_found: data.candidates.length,
        candidates_created: created,
        candidates_skipped: skipped,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  } catch (err) {
    await db
      .from("discovery_runs")
      .update({ status: "failed", error: err instanceof Error ? err.message : String(err), finished_at: new Date().toISOString() })
      .eq("id", run.id);
    throw err;
  }
}
