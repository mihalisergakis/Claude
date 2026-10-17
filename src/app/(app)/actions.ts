"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DiscoveryCriteria } from "@/lib/discovery/discover";
import { importRows, type ImportResult, type ImportRow } from "@/lib/import/import-rows";
import { processJobs } from "@/lib/jobs/runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";
import { requireSession } from "@/lib/workspace";

/** Run queued jobs now instead of waiting for the next cron tick (useful locally). */
export async function runJobsNow() {
  await requireSession();
  await processJobs(createAdminClient(), { budgetMs: 50_000 });
  revalidatePath("/", "layout");
}

export async function startDiscovery(formData: FormData) {
  const ctx = await requireSession();
  const productId = String(formData.get("product_id"));
  const limit = Math.min(50, Math.max(1, Number(formData.get("limit")) || 10));
  const criteria: DiscoveryCriteria = {
    state: String(formData.get("state") || "UT").toUpperCase().slice(0, 2),
    county: String(formData.get("county") || "").trim() || undefined,
    city: String(formData.get("city") || "").trim() || undefined,
    org_types: formData.getAll("org_types").map(String),
    limit,
    notes: String(formData.get("notes") || "").trim() || undefined,
  };
  if (criteria.org_types.length === 0) criteria.org_types = ["team", "independent_brokerage"];

  const { data: run, error } = await ctx.supabase
    .from("discovery_runs")
    .insert({ workspace_id: ctx.workspaceId, product_id: productId, criteria, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) throw error;
  const { error: jobError } = await ctx.supabase.from("jobs").insert({
    workspace_id: ctx.workspaceId,
    type: "discover",
    payload: { discovery_run_id: run.id },
    max_attempts: 1, // a failed search shouldn't silently re-spend
  });
  if (jobError) throw jobError;
  revalidatePath("/discover");
}

export async function createImport(fileName: string, columnMapping: Record<string, string>, rowsTotal: number) {
  const ctx = await requireSession();
  const { data, error } = await ctx.supabase
    .from("imports")
    .insert({ workspace_id: ctx.workspaceId, file_name: fileName, column_mapping: columnMapping, rows_total: rowsTotal, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function importChunk(input: {
  importId: string;
  productId: string;
  fileName: string;
  rows: ImportRow[];
  rowOffset: number;
  emailsHaveSource: boolean;
  queueResearch: boolean;
}): Promise<ImportResult> {
  const ctx = await requireSession();
  const result = await importRows(
    ctx.supabase,
    input.rows.slice(0, 500),
    {
      workspaceId: ctx.workspaceId,
      productId: input.productId,
      fileName: input.fileName,
      importId: input.importId,
      emailsHaveSource: input.emailsHaveSource,
      queueResearch: input.queueResearch,
    },
    input.rowOffset,
  );

  const { data: current } = await ctx.supabase.from("imports").select("rows_created, rows_merged, rows_flagged").eq("id", input.importId).single();
  if (current) {
    await ctx.supabase
      .from("imports")
      .update({
        rows_created: current.rows_created + result.created,
        rows_merged: current.rows_merged + result.merged,
        rows_flagged: current.rows_flagged + result.flagged.length,
      })
      .eq("id", input.importId);
  }
  return result;
}

export async function addProspect(formData: FormData) {
  const ctx = await requireSession();
  const productId = String(formData.get("product_id"));
  const row: ImportRow = {};
  for (const key of ["name", "website", "email", "contact_name", "phone", "city", "county", "state", "notes"] as const) {
    const v = formData.get(key);
    if (v) row[key] = String(v);
  }
  await importRows(ctx.supabase, [row], {
    workspaceId: ctx.workspaceId,
    productId,
    fileName: "manual entry",
    importId: "",
    emailsHaveSource: formData.get("email_has_source") === "on",
    queueResearch: true,
  });
  revalidatePath("/prospects");
  redirect("/prospects");
}

export async function queueResearch(organizationId: string) {
  const ctx = await requireSession();
  await ctx.supabase.from("jobs").insert({ workspace_id: ctx.workspaceId, type: "research", payload: { organization_id: organizationId } });
  revalidatePath(`/prospects/${organizationId}`);
}

export async function queueQualify(organizationId: string, pipelineEntryId: string) {
  const ctx = await requireSession();
  await ctx.supabase.from("jobs").insert({ workspace_id: ctx.workspaceId, type: "qualify", payload: { pipeline_entry_id: pipelineEntryId } });
  revalidatePath(`/prospects/${organizationId}`);
}

export async function updatePipeline(formData: FormData) {
  const ctx = await requireSession();
  const organizationId = String(formData.get("organization_id"));
  const entryId = String(formData.get("pipeline_entry_id"));
  const stage = String(formData.get("stage")) as PipelineStage;
  const followUp = String(formData.get("next_follow_up_at") || "");
  if (!PIPELINE_STAGES.includes(stage)) throw new Error("Invalid stage");

  const { data: entry } = await ctx.supabase.from("pipeline_entries").select("stage").eq("id", entryId).single();
  const update: Record<string, unknown> = { next_follow_up_at: followUp ? new Date(followUp).toISOString() : null };
  if (entry && entry.stage !== stage) {
    update.stage = stage;
    update.stage_changed_at = new Date().toISOString();
    await ctx.supabase.from("activities").insert({
      workspace_id: ctx.workspaceId,
      organization_id: organizationId,
      type: "stage_change",
      summary: `Stage changed from ${entry.stage} to ${stage}`,
      user_id: ctx.userId,
    });
  }
  await ctx.supabase.from("pipeline_entries").update(update).eq("id", entryId);
  if (stage === "do_not_contact") {
    const { data: contacts } = await ctx.supabase.from("contacts").select("email").eq("organization_id", organizationId).not("email", "is", null);
    if (contacts?.length) {
      await ctx.supabase.from("suppressions").upsert(
        contacts.map((c) => ({ workspace_id: ctx.workspaceId, email: c.email, reason: "do_not_contact", source: "manual stage change" })),
        { onConflict: "workspace_id,email", ignoreDuplicates: true },
      );
    }
  }
  revalidatePath(`/prospects/${organizationId}`);
}

export async function addNote(formData: FormData) {
  const ctx = await requireSession();
  const organizationId = String(formData.get("organization_id"));
  const note = String(formData.get("note") || "").trim();
  if (!note) return;
  await ctx.supabase.from("activities").insert({
    workspace_id: ctx.workspaceId,
    organization_id: organizationId,
    type: "note",
    summary: note,
    user_id: ctx.userId,
  });
  revalidatePath(`/prospects/${organizationId}`);
}

export async function deleteProspect(formData: FormData) {
  const ctx = await requireSession();
  await ctx.supabase.from("organizations").delete().eq("id", String(formData.get("organization_id")));
  revalidatePath("/prospects");
  revalidatePath("/duplicates");
}

export async function signOut() {
  const ctx = await requireSession();
  await ctx.supabase.auth.signOut();
  redirect("/login");
}
