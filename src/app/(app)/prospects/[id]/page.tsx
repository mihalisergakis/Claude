import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, PageHeader, SourceLink, StageBadge, TierBadge, formatDate, inputClass } from "@/components/ui";
import { PIPELINE_STAGES, type CriterionResult, type Fact, type Organization, type PipelineStage } from "@/lib/types";
import { requireSession } from "@/lib/workspace";
import { addNote, deleteProspect, queueQualify, queueResearch, updatePipeline } from "../../actions";

const BASIS_STYLE = {
  verified: "bg-emerald-100 text-emerald-800",
  inferred: "bg-amber-100 text-amber-800",
  unknown: "bg-slate-100 text-slate-600",
};

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession();

  const { data: org } = await ctx.supabase.from("organizations").select("*, brokerages(name)").eq("id", id).maybeSingle();
  if (!org) notFound();
  const o = org as Organization & { brokerages: { name: string } | null };

  const [{ data: entries }, { data: facts }, { data: contacts }, { data: activities }, { data: jobs }] = await Promise.all([
    ctx.supabase.from("pipeline_entries").select("*, products(name)").eq("organization_id", id),
    ctx.supabase.from("facts").select("*").eq("organization_id", id).order("field"),
    ctx.supabase.from("contacts").select("*").eq("organization_id", id).order("is_primary", { ascending: false }),
    ctx.supabase.from("activities").select("*").eq("organization_id", id).order("occurred_at", { ascending: false }).limit(50),
    ctx.supabase.from("jobs").select("type, status, last_error").in("status", ["queued", "running", "failed"]).contains("payload", { organization_id: id }),
  ]);
  const entry = entries?.[0];
  const { data: run } = entry
    ? await ctx.supabase.from("qualification_runs").select("*").eq("pipeline_entry_id", entry.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const factList = (facts ?? []) as Fact[];
  const summary = factList.find((f) => f.field === "summary");
  const shownFacts = factList.filter((f) => f.field !== "summary");
  const factById = new Map(factList.map((f) => [f.id, f]));
  const criteria = (run?.criteria ?? []) as CriterionResult[];
  const pendingJobs = jobs ?? [];

  return (
    <>
      <PageHeader title={o.name}>
        <form action={queueResearch.bind(null, o.id)}><Button variant="secondary">Re-run research</Button></form>
        {entry && <form action={queueQualify.bind(null, o.id, entry.id)}><Button variant="secondary">Re-score</Button></form>}
        <form action={deleteProspect}>
          <input type="hidden" name="organization_id" value={o.id} />
          <Button variant="danger">Delete</Button>
        </form>
      </PageHeader>

      {pendingJobs.length > 0 && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {pendingJobs.map((j, i) => (
            <div key={i}>{j.type} job {j.status}{j.last_error ? `: ${j.last_error}` : ""}</div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Business">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-slate-500">Website</dt><dd><SourceLink url={o.website} /></dd>
              <dt className="text-slate-500">Location</dt><dd>{[o.city, o.county && `${o.county} County`, o.state].filter(Boolean).join(", ") || "—"}</dd>
              <dt className="text-slate-500">Type</dt><dd>{o.org_type.replace(/_/g, " ")}</dd>
              <dt className="text-slate-500">Team size</dt><dd>{o.team_size ?? "Not verified"}</dd>
              <dt className="text-slate-500">Brokerage</dt><dd>{o.brokerages?.name ?? "—"}</dd>
              <dt className="text-slate-500">Phone</dt><dd>{o.phone_e164 ?? "—"}</dd>
              <dt className="text-slate-500">Lead source</dt><dd>{o.lead_source}</dd>
              <dt className="text-slate-500">Researched</dt><dd>{formatDate(o.researched_at)}</dd>
            </dl>
            {summary && <p className="mt-3 text-sm text-slate-700">{String(summary.value)}</p>}
          </Card>

          <Card title="Qualification">
            {!run ? (
              <p className="text-sm text-slate-500">Not scored yet.</p>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <TierBadge tier={run.fit_tier} score={run.score} />
                  <span className="text-xs text-slate-500">{run.model} · {run.prompt_version} · {formatDate(run.created_at)}</span>
                </div>
                <p className="mb-3 text-sm">{run.explanation}</p>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr><th className="py-1">Criterion</th><th>Weight</th><th>Score</th><th>Basis</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {criteria.map((c) => (
                      <tr key={c.key} className="border-t border-slate-100 align-top">
                        <td className="py-1.5 pr-2">{c.label}</td>
                        <td className="tabular-nums">{c.weight}</td>
                        <td className="tabular-nums">{Math.round(c.score * 100)}%</td>
                        <td><span className={`rounded px-1.5 py-0.5 text-xs ${BASIS_STYLE[c.basis]}`}>{c.basis}</span></td>
                        <td className="text-slate-700">
                          {c.note}
                          {c.evidence_fact_ids.length > 0 && (
                            <div className="text-xs text-slate-500">
                              Evidence: {c.evidence_fact_ids.map((fid) => factById.get(fid)?.field ?? "removed fact").join(", ")}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(run.hypotheses as string[]).length > 0 && (
                  <div className="mt-3 rounded bg-amber-50 p-3 text-sm">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Unverified hypotheses</div>
                    <ul className="list-disc pl-5 text-amber-900">
                      {(run.hypotheses as string[]).map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Card>

          <Card title={`Facts (${shownFacts.length})`}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">Field</th><th>Value</th><th>Source</th><th>Retrieved</th></tr>
              </thead>
              <tbody>
                {shownFacts.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-2 text-slate-600">{f.field.replace(/_/g, " ")}</td>
                    <td className="pr-2">
                      {typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value)}
                      {f.quote && <div className="text-xs italic text-slate-500">“{f.quote.slice(0, 240)}”</div>}
                    </td>
                    <td className="pr-2 text-xs">
                      <SourceLink url={f.source_url} label={f.source_url ? undefined : f.source_type} />
                      <div className={f.is_verified ? "text-emerald-700" : "text-slate-500"}>{f.is_verified ? "verified on source" : `unverified (${f.source_type})`}</div>
                    </td>
                    <td className="text-xs text-slate-500">{formatDate(f.retrieved_at)}</td>
                  </tr>
                ))}
                {shownFacts.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-500">No facts yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-4">
          {entry && (
            <Card title={`Pipeline · ${entry.products?.name ?? ""}`}>
              <div className="mb-2"><StageBadge stage={entry.stage as PipelineStage} /></div>
              {entry.disqualified_reason && <p className="mb-2 text-xs text-slate-600">{entry.disqualified_reason}</p>}
              <form action={updatePipeline} className="space-y-2 text-sm">
                <input type="hidden" name="organization_id" value={o.id} />
                <input type="hidden" name="pipeline_entry_id" value={entry.id} />
                <label className="block">
                  <span className="text-xs text-slate-500">Stage</span>
                  <select name="stage" defaultValue={entry.stage} className={`${inputClass} w-full`}>
                    {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Next follow-up</span>
                  <input type="date" name="next_follow_up_at" defaultValue={entry.next_follow_up_at?.slice(0, 10) ?? ""} className={`${inputClass} w-full`} />
                </label>
                <div className="text-xs text-slate-500">Last contacted: {formatDate(entry.last_contacted_at)}</div>
                <Button>Save</Button>
              </form>
            </Card>
          )}

          <Card title="Contacts">
            {(contacts ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No published business contact found.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(contacts ?? []).map((c) => (
                  <li key={c.id}>
                    <div className="font-medium">{c.full_name ?? "Unnamed"}{c.is_primary && <span className="ml-1 text-xs text-slate-500">(primary)</span>}</div>
                    {c.role && <div className="text-xs text-slate-500">{c.role}</div>}
                    {c.email && (
                      <div className="text-xs">
                        {c.email} · <span className={c.email_status === "unknown" ? "text-amber-700" : "text-emerald-700"}>{c.email_status.replace(/_/g, " ")}</span>
                        {c.email_fact_id && factById.get(c.email_fact_id) && (
                          <> · <SourceLink url={factById.get(c.email_fact_id)!.source_url} label="source" /></>
                        )}
                      </div>
                    )}
                    {c.phone_e164 && <div className="text-xs">{c.phone_e164}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Activity">
            <form action={addNote} className="mb-3 flex gap-2">
              <input type="hidden" name="organization_id" value={o.id} />
              <input name="note" placeholder="Add a note" className={`${inputClass} flex-1`} />
              <Button variant="secondary">Add</Button>
            </form>
            <ul className="space-y-2 text-sm">
              {(activities ?? []).map((a) => (
                <li key={a.id} className="border-t border-slate-100 pt-2">
                  <div className="text-xs text-slate-500">{a.type.replace(/_/g, " ")} · {formatDate(a.occurred_at)}</div>
                  <div>{a.summary}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Link href="/prospects" className="block text-sm text-slate-600 hover:underline">← All prospects</Link>
        </div>
      </div>
    </>
  );
}
