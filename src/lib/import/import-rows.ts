import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeWebsite } from "@/lib/normalize";
import type { ImportRow } from "./fields";

export type { ImportRow } from "./fields";

export interface ImportOptions {
  workspaceId: string;
  productId: string;
  fileName: string;
  importId: string;
  /** The user attests these emails came from a legitimate source (e.g. given to them directly). */
  emailsHaveSource: boolean;
  queueResearch: boolean;
}

export interface ImportResult {
  created: number;
  merged: number;
  flagged: { row: number; reason: string }[];
}

const clean = (v: string | undefined) => (v ?? "").trim() || null;

/**
 * Import rows with deduplication: an existing organization with the same
 * domain, or a contact with the same email, is merged into rather than duplicated.
 * Merges only fill empty fields; they never overwrite existing data.
 */
export async function importRows(db: SupabaseClient, rows: ImportRow[], opts: ImportOptions, rowOffset = 0): Promise<ImportResult> {
  const result: ImportResult = { created: 0, merged: 0, flagged: [] };
  const source = `csv:${opts.fileName}`;

  for (const [i, row] of rows.entries()) {
    const rowNumber = rowOffset + i + 2; // +1 header, +1 one-based
    const name = clean(row.name);
    const website = normalizeWebsite(row.website);
    const domain = normalizeDomain(row.website);
    const email = normalizeEmail(row.email);
    if (!name && !website) {
      result.flagged.push({ row: rowNumber, reason: "No business name or website" });
      continue;
    }
    if (row.email && !email) result.flagged.push({ row: rowNumber, reason: `Invalid email "${row.email}" ignored` });

    // Find an existing organization by domain, then by contact email.
    let orgId: string | null = null;
    let isNew = false;
    if (domain) {
      const { data } = await db.from("organizations").select("id").eq("workspace_id", opts.workspaceId).eq("domain", domain).maybeSingle();
      orgId = data?.id ?? null;
    }
    if (!orgId && email) {
      const { data } = await db.from("contacts").select("organization_id").eq("workspace_id", opts.workspaceId).eq("email", email).maybeSingle();
      orgId = data?.organization_id ?? null;
    }

    const fields = {
      website,
      domain,
      phone_e164: normalizePhone(row.phone),
      city: clean(row.city),
      county: clean(row.county)?.replace(/\s+county$/i, "") ?? null,
      state: clean(row.state)?.toUpperCase().slice(0, 2) ?? null,
    };

    if (orgId) {
      const { data: existing } = await db.from("organizations").select("*").eq("id", orgId).single();
      const fill: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if (v && !existing[k]) fill[k] = v;
      if (row.notes) fill.notes = [existing.notes, clean(row.notes)].filter(Boolean).join("\n");
      if (Object.keys(fill).length) await db.from("organizations").update(fill).eq("id", orgId);
      result.merged++;
    } else {
      const { data: org, error } = await db
        .from("organizations")
        .insert({
          workspace_id: opts.workspaceId,
          name: name ?? domain!,
          ...fields,
          lead_source: source,
          notes: clean(row.notes) ?? "",
        })
        .select("id")
        .single();
      if (error) {
        result.flagged.push({ row: rowNumber, reason: error.message });
        continue;
      }
      orgId = org.id as string;
      isNew = true;
      result.created++;
    }

    await db
      .from("pipeline_entries")
      .upsert({ workspace_id: opts.workspaceId, organization_id: orgId, product_id: opts.productId }, { onConflict: "organization_id,product_id", ignoreDuplicates: true });

    // CSV values are recorded as unverified facts with the file as their source.
    const facts: Record<string, unknown>[] = [];
    const fact = (field: string, value: unknown) =>
      facts.push({
        workspace_id: opts.workspaceId,
        organization_id: orgId,
        field,
        value,
        source_url: null,
        quote: `${source}, row ${rowNumber}`,
        source_type: "csv",
        extracted_by: "import",
        is_verified: false,
      });
    if (clean(row.brokerage)) fact("brokerage", clean(row.brokerage));
    const teamSize = Number.parseInt(row.team_size ?? "", 10);
    if (Number.isFinite(teamSize) && teamSize > 0) fact("team_size", teamSize);
    if (facts.length) await db.from("facts").insert(facts);

    if (email) {
      const { data: existingContact } = await db
        .from("contacts")
        .select("id")
        .eq("workspace_id", opts.workspaceId)
        .eq("email", email)
        .maybeSingle();
      if (!existingContact) {
        const { count } = await db.from("contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
        await db.from("contacts").insert({
          workspace_id: opts.workspaceId,
          organization_id: orgId,
          full_name: clean(row.contact_name),
          role: clean(row.contact_role),
          email,
          // Without an attested source, the email stays "unknown" until research finds it published.
          email_status: opts.emailsHaveSource ? "source_listed" : "unknown",
          phone_e164: normalizePhone(row.phone),
          is_primary: !count,
        });
      }
    }

    // Only new prospects are queued; existing ones keep their research (re-run it from the prospect page).
    if (opts.queueResearch && isNew) {
      await db.from("jobs").insert({ workspace_id: opts.workspaceId, type: "research", payload: { organization_id: orgId } });
    }
  }

  return result;
}
