import type { SupabaseClient } from "@supabase/supabase-js";
import { runDiscovery } from "@/lib/discovery/discover";
import { qualifyPipelineEntry } from "@/lib/qualify/qualify";
import { researchOrganization } from "@/lib/research/research";

interface Job {
  id: string;
  type: "discover" | "research" | "qualify";
  payload: Record<string, string>;
  attempts: number;
  max_attempts: number;
}

async function runJob(db: SupabaseClient, job: Job) {
  switch (job.type) {
    case "discover":
      return runDiscovery(db, job.payload.discovery_run_id);
    case "research":
      return researchOrganization(db, job.payload.organization_id);
    case "qualify":
      return qualifyPipelineEntry(db, job.payload.pipeline_entry_id);
  }
}

/**
 * Process queued jobs until the time budget runs out. Jobs run a few at a time;
 * failures are retried with backoff up to max_attempts.
 */
export async function processJobs(db: SupabaseClient, { budgetMs = 240_000, concurrency = 3 } = {}) {
  const started = Date.now();
  const summary = { done: 0, failed: 0 };

  while (Date.now() - started < budgetMs) {
    const { data: jobs, error } = await db.rpc("claim_jobs", { n: concurrency });
    if (error) throw error;
    if (!jobs?.length) break;

    await Promise.all(
      (jobs as Job[]).map(async (job) => {
        try {
          await runJob(db, job);
          await db.from("jobs").update({ status: "done", finished_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
          summary.done++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const giveUp = job.attempts >= job.max_attempts;
          await db
            .from("jobs")
            .update({
              status: giveUp ? "failed" : "queued",
              last_error: message.slice(0, 2000),
              run_after: new Date(Date.now() + 2 ** job.attempts * 60_000).toISOString(),
              finished_at: giveUp ? new Date().toISOString() : null,
            })
            .eq("id", job.id);
          summary.failed++;
        }
      }),
    );
  }
  return summary;
}
