import Link from "next/link";
import { Button, PageHeader, StageBadge, TierBadge, formatDate, inputClass } from "@/components/ui";
import { ORG_TYPES, PIPELINE_STAGES, type PipelineStage } from "@/lib/types";
import { getProducts, requireSession } from "@/lib/workspace";

const PAGE_SIZE = 50;

export interface ProspectFilters {
  q?: string;
  stage?: string;
  tier?: string;
  county?: string;
  city?: string;
  type?: string;
  has_email?: string;
  source?: string;
  page?: string;
}

interface Row {
  id: string;
  name: string;
  website: string | null;
  city: string | null;
  county: string | null;
  org_type: string;
  team_size: number | null;
  lead_source: string;
  created_at: string;
  pipeline_entries: { id: string; stage: PipelineStage; score: number | null; fit_tier: string | null; next_follow_up_at: string | null }[];
  contacts: { email: string | null; email_status: string }[];
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<ProspectFilters> }) {
  const f = await searchParams;
  const ctx = await requireSession();
  const [product] = await getProducts(ctx);
  const page = Math.max(1, Number(f.page) || 1);

  let query = ctx.supabase
    .from("organizations")
    .select(
      `id, name, website, city, county, org_type, team_size, lead_source, created_at, pipeline_entries!inner(id, stage, score, fit_tier, next_follow_up_at), contacts${f.has_email === "1" ? "!inner" : ""}(email, email_status)`,
      { count: "exact" },
    )
    .eq("pipeline_entries.product_id", product.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (f.q) query = query.or(`name.ilike.%${f.q.replace(/[,()]/g, " ")}%,domain.ilike.%${f.q.replace(/[,()]/g, " ")}%`);
  if (f.stage) query = query.eq("pipeline_entries.stage", f.stage);
  if (f.tier) query = query.eq("pipeline_entries.fit_tier", f.tier);
  if (f.county) query = query.ilike("county", f.county);
  if (f.city) query = query.ilike("city", f.city);
  if (f.type) query = query.eq("org_type", f.type);
  if (f.source) query = query.eq("lead_source", f.source);
  if (f.has_email === "1") query = query.in("contacts.email_status", ["source_listed", "deliverable"]);
  const { data, count, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];

  const exportParams = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "page") as [string, string][]);
  const pageLink = (p: number) => {
    const sp = new URLSearchParams(exportParams);
    sp.set("page", String(p));
    return `/prospects?${sp}`;
  };

  return (
    <>
      <PageHeader title={`Prospects (${count ?? 0})`}>
        <Link href="/prospects/new"><Button variant="secondary">Add manually</Button></Link>
        <a href={`/api/export?${exportParams}`}><Button variant="secondary">Export CSV</Button></a>
      </PageHeader>

      <form className="mb-4 flex flex-wrap gap-2 text-sm">
        <input name="q" placeholder="Search name or domain" defaultValue={f.q} className={inputClass} />
        <select name="stage" defaultValue={f.stage ?? ""} className={inputClass}>
          <option value="">Any stage</option>
          {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select name="tier" defaultValue={f.tier ?? ""} className={inputClass}>
          <option value="">Any tier</option>
          {["A", "B", "C", "D"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <select name="type" defaultValue={f.type ?? ""} className={inputClass}>
          <option value="">Any type</option>
          {ORG_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <input name="county" placeholder="County" defaultValue={f.county} className={`${inputClass} w-28`} />
        <input name="city" placeholder="City" defaultValue={f.city} className={`${inputClass} w-28`} />
        <label className="flex items-center gap-1">
          <input type="checkbox" name="has_email" value="1" defaultChecked={f.has_email === "1"} /> Has sourced email
        </label>
        <Button variant="secondary">Filter</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Team</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Fit</th>
              <th className="px-3 py-2">Follow-up</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const entry = r.pipeline_entries[0];
              const email = r.contacts.find((c) => c.email);
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/prospects/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    {r.website && <div className="text-xs text-slate-500">{r.website.replace(/^https?:\/\//, "")}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{[r.city, r.county && `${r.county} Co.`].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{r.org_type.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.team_size ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {email ? <span title={email.email_status}>{email.email}{email.email_status === "unknown" && " (unsourced)"}</span> : "—"}
                  </td>
                  <td className="px-3 py-2"><StageBadge stage={entry.stage} /></td>
                  <td className="px-3 py-2"><TierBadge tier={entry.fit_tier} score={entry.score} /></td>
                  <td className="px-3 py-2 text-xs text-slate-600">{formatDate(entry.next_follow_up_at)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.lead_source.split(":")[0]}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No prospects match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(count ?? 0) > PAGE_SIZE && (
        <div className="mt-3 flex gap-2 text-sm">
          {page > 1 && <Link href={pageLink(page - 1)} className="hover:underline">← Previous</Link>}
          <span className="text-slate-500">Page {page} of {Math.ceil((count ?? 0) / PAGE_SIZE)}</span>
          {page * PAGE_SIZE < (count ?? 0) && <Link href={pageLink(page + 1)} className="hover:underline">Next →</Link>}
        </div>
      )}
    </>
  );
}
