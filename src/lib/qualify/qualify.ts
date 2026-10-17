import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callStructured } from "@/lib/ai/client";
import type { CriterionResult, Fact, Organization, Product } from "@/lib/types";

const PROMPT_VERSION = "qualify-v1";
const QUALIFIED_THRESHOLD = 60;

const QualifySchema = z.object({
  criteria: z.array(
    z.object({
      key: z.string(),
      score: z.number().describe("0 to 1"),
      basis: z.enum(["verified", "inferred", "unknown"]),
      evidence_fact_ids: z.array(z.string()),
      note: z.string().describe("One sentence explaining the score, citing evidence"),
    }),
  ),
  hypotheses: z
    .array(z.string())
    .describe("Possible workflow pain points, phrased as unverified hypotheses. Never stated as fact."),
  explanation: z.string().describe("Two or three sentences summarizing fit"),
  disqualify_reason: z
    .string()
    .nullable()
    .describe("Set only if the business is clearly outside the target profile (e.g. not residential real estate sales)"),
});

const SYSTEM = `You score how well a business fits a product's ideal customer profile, using a fixed rubric.
Rules:
- Score each rubric criterion from 0 to 1 using only the facts given. Cite fact IDs as evidence.
- basis = "verified" when the score rests on facts marked verified; "inferred" when it rests on reasonable inference from facts; "unknown" when there isn't enough information. For unknown, score 0.5.
- Never assume what software or CRM a business uses.
- Pain points you suspect go in hypotheses, worded as possibilities, not facts.`;

export function tierFor(score: number): "A" | "B" | "C" | "D" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function factsBlock(org: Organization, facts: Fact[]) {
  const header = [
    `Name: ${org.name}`,
    `Type on record: ${org.org_type}`,
    `Location: ${[org.city, org.county, org.state].filter(Boolean).join(", ") || "unknown"}`,
    `Website: ${org.website ?? "none"}`,
    `Team size on record: ${org.team_size ?? "unknown"}`,
  ].join("\n");
  const lines = facts.map(
    (f) =>
      `- [${f.id}] ${f.field}: ${JSON.stringify(f.value)} (${f.is_verified ? "verified" : "unverified"}; source: ${f.source_url ?? f.source_type}${f.quote ? `; quote: "${f.quote.slice(0, 200)}"` : ""})`,
  );
  return `${header}\n\nFacts:\n${lines.join("\n") || "(none)"}`;
}

export async function qualifyPipelineEntry(db: SupabaseClient, pipelineEntryId: string) {
  const { data: entry, error } = await db
    .from("pipeline_entries")
    .select("id, workspace_id, organization_id, product_id, stage")
    .eq("id", pipelineEntryId)
    .single();
  if (error) throw error;

  const [{ data: org }, { data: product }, { data: facts }, { count: emailCount }] = await Promise.all([
    db.from("organizations").select("*").eq("id", entry.organization_id).single<Organization>(),
    db.from("products").select("*").eq("id", entry.product_id).single<Product>(),
    db.from("facts").select("*").eq("organization_id", entry.organization_id).order("retrieved_at"),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", entry.organization_id)
      .in("email_status", ["source_listed", "deliverable"]),
  ]);
  if (!org || !product) throw new Error("Organization or product not found");

  const rubric = product.qualification_rubric;
  const prompt = `Product: ${product.name}
${product.description}

Ideal customer profile: ${product.icp.summary}
Include: ${product.icp.include.join("; ")}
Exclude: ${product.icp.exclude.join("; ")}

Rubric:
${rubric.map((c) => `- ${c.key} (${c.label}, weight ${c.weight}): ${c.guidance}`).join("\n")}

Business:
${factsBlock(org, (facts ?? []) as Fact[])}
Published business emails on record: ${emailCount ?? 0}

Score every rubric criterion and call submit_qualification.`;

  const { data: result, model } = await callStructured({
    step: "qualify",
    system: SYSTEM,
    prompt,
    resultTool: { name: "submit_qualification", description: "Submit the rubric scores for this business." },
    schema: QualifySchema,
    effort: "medium",
  });

  // The weighted score is computed here, not by the model, so it is reproducible.
  const validFactIds = new Set((facts ?? []).map((f) => f.id as string));
  const criteria: CriterionResult[] = rubric.map((c) => {
    const r = result.criteria.find((x) => x.key === c.key);
    return {
      key: c.key,
      label: c.label,
      weight: c.weight,
      score: r ? Math.min(1, Math.max(0, r.score)) : 0.5,
      basis: r?.basis ?? "unknown",
      evidence_fact_ids: (r?.evidence_fact_ids ?? []).filter((id) => validFactIds.has(id)),
      note: r?.note ?? "Not scored by the model; treated as unknown.",
    };
  });
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  const score = Math.round((criteria.reduce((s, c) => s + c.weight * c.score, 0) / totalWeight) * 100);
  const tier = tierFor(score);

  await db.from("qualification_runs").insert({
    workspace_id: entry.workspace_id,
    pipeline_entry_id: entry.id,
    score,
    fit_tier: tier,
    criteria,
    explanation: result.explanation,
    hypotheses: result.hypotheses,
    model,
    prompt_version: PROMPT_VERSION,
  });

  const update: Record<string, unknown> = { score, fit_tier: tier };
  // Only move entries that haven't progressed past qualification.
  if (["discovered", "researched", "qualified", "disqualified"].includes(entry.stage)) {
    const qualified = !result.disqualify_reason && score >= QUALIFIED_THRESHOLD;
    const stage = qualified ? "qualified" : "disqualified";
    if (stage !== entry.stage) {
      update.stage = stage;
      update.stage_changed_at = new Date().toISOString();
    }
    update.disqualified_reason = qualified
      ? null
      : (result.disqualify_reason ?? `Score ${score} is below ${QUALIFIED_THRESHOLD}`);
  }
  await db.from("pipeline_entries").update(update).eq("id", entry.id);
  await db.from("activities").insert({
    workspace_id: entry.workspace_id,
    organization_id: entry.organization_id,
    type: "system",
    summary: `Qualified for ${product.name}: score ${score} (tier ${tier}).`,
  });
}
