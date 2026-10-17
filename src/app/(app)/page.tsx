import Link from "next/link";
import { Card, PageHeader, StageBadge, TierBadge, formatDate, inputClass, Button } from "@/components/ui";
import type { PipelineStage } from "@/lib/types";
import { getProducts, requireSession } from "@/lib/workspace";

const QUALIFIED_OR_LATER: PipelineStage[] = [
  "qualified", "contact_ready", "drafted", "approved", "in_sequence", "replied", "interested",
  "demo_booked", "trial", "customer", "nurture", "not_interested", "unsubscribed", "bounced",
];
const POSITIVE: PipelineStage[] = ["interested", "demo_booked", "trial", "customer"];
const DEMO: PipelineStage[] = ["demo_booked", "trial", "customer"];
const TRIAL: PipelineStage[] = ["trial", "customer"];

interface EntryRow {
  id: string;
  stage: PipelineStage;
  score: number | null;
  fit_tier: string | null;
  created_at: string;
  next_follow_up_at: string | null;
  organizations: { id: string; name: string; city: string | null; county: string | null; state: string | null };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; county?: string; product?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireSession();
  const products = await getProducts(ctx);
  const product = products.find((p) => p.id === params.product) ?? products[0];

  let query = ctx.supabase
    .from("pipeline_entries")
    .select("id, stage, score, fit_tier, created_at, next_follow_up_at, organizations!inner(id, name, city, county, state)")
    .eq("product_id", product.id)
    .limit(10000);
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) query = query.lte("created_at", `${params.to}T23:59:59`);
  if (params.county) query = query.eq("organizations.county", params.county);
  const { data } = await query;
  const entries = (data ?? []) as unknown as EntryRow[];

  const msgQuery = (status: string) =>
    ctx.supabase.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("status", status);
  const [{ count: drafts }, { count: sent }, { count: replies }, { data: dupes }, { data: counties }] = await Promise.all([
    msgQuery("draft"),
    ctx.supabase.from("messages").select("id", { count: "exact", head: true }).not("sent_at", "is", null),
    ctx.supabase.from("message_events").select("id", { count: "exact", head: true }).eq("type", "reply"),
    ctx.supabase.rpc("possible_duplicates", { ws: ctx.workspaceId }),
    ctx.supabase.from("organizations").select("county").not("county", "is", null).limit(5000),
  ]);

  const count = (stages: PipelineStage[]) => entries.filter((e) => stages.includes(e.stage)).length;
  const tiles = [
    { label: "Prospects discovered", value: entries.length },
    { label: "Qualified", value: count(QUALIFIED_OR_LATER) },
    { label: "Drafts awaiting approval", value: drafts ?? 0, phase: 2 },
    { label: "Emails sent", value: sent ?? 0, phase: 3 },
    { label: "Replies", value: replies ?? 0, phase: 3 },
    { label: "Positive replies", value: count(POSITIVE), phase: 3 },
    { label: "Demos booked", value: count(DEMO) },
    { label: "Trials started", value: count(TRIAL) },
    { label: "Paying customers", value: count(["customer"]) },
  ];

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const followUps = entries
    .filter((e) => e.next_follow_up_at && new Date(e.next_follow_up_at) <= endOfToday)
    .sort((a, b) => a.next_follow_up_at!.localeCompare(b.next_follow_up_at!));
  const topQualified = entries
    .filter((e) => e.stage === "qualified")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  const byMarket = new Map<string, { total: number; qualified: number; scoreSum: number; scored: number }>();
  for (const e of entries) {
    const key = e.organizations.county ? `${e.organizations.county} County` : e.organizations.city ?? "Unknown";
    const m = byMarket.get(key) ?? { total: 0, qualified: 0, scoreSum: 0, scored: 0 };
    m.total++;
    if (QUALIFIED_OR_LATER.includes(e.stage)) m.qualified++;
    if (e.score != null) {
      m.scoreSum += e.score;
      m.scored++;
    }
    byMarket.set(key, m);
  }
  const countyOptions = [...new Set((counties ?? []).map((c) => c.county as string))].sort();

  return (
    <>
      <PageHeader title="Dashboard">
        <form className="flex flex-wrap items-center gap-2 text-sm">
          {products.length > 1 && (
            <select name="product" defaultValue={product.id} className={inputClass}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <input type="date" name="from" defaultValue={params.from} className={inputClass} aria-label="From" />
          <input type="date" name="to" defaultValue={params.to} className={inputClass} aria-label="To" />
          <select name="county" defaultValue={params.county ?? ""} className={inputClass}>
            <option value="">All markets</option>
            {countyOptions.map((c) => (
              <option key={c} value={c}>{c} County</option>
            ))}
          </select>
          <Button variant="secondary">Apply</Button>
        </form>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-slate-600">{t.label}</div>
            {t.phase && t.value === 0 && <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Phase {t.phase}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top qualified prospects">
          {topQualified.length === 0 ? (
            <p className="text-sm text-slate-500">
              None yet. <Link href="/discover" className="text-sky-700 underline">Find prospects</Link> or{" "}
              <Link href="/import" className="text-sky-700 underline">import a CSV</Link>.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {topQualified.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-1.5">
                      <Link href={`/prospects/${e.organizations.id}`} className="font-medium hover:underline">{e.organizations.name}</Link>
                    </td>
                    <td className="text-slate-600">{e.organizations.city ?? "—"}</td>
                    <td className="text-right"><TierBadge tier={e.fit_tier} score={e.score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Follow-ups due today">
          {followUps.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing due.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {followUps.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-1.5">
                      <Link href={`/prospects/${e.organizations.id}`} className="font-medium hover:underline">{e.organizations.name}</Link>
                    </td>
                    <td><StageBadge stage={e.stage} /></td>
                    <td className="text-right text-slate-600">{formatDate(e.next_follow_up_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="By market">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">Market</th><th className="text-right">Prospects</th><th className="text-right">Qualified</th><th className="text-right">Avg score</th></tr>
            </thead>
            <tbody>
              {[...byMarket.entries()].sort((a, b) => b[1].total - a[1].total).map(([market, m]) => (
                <tr key={market} className="border-t border-slate-100">
                  <td className="py-1.5">{market}</td>
                  <td className="text-right tabular-nums">{m.total}</td>
                  <td className="text-right tabular-nums">{m.qualified}</td>
                  <td className="text-right tabular-nums">{m.scored ? Math.round(m.scoreSum / m.scored) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Needs review">
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/duplicates" className="hover:underline">{dupes?.length ?? 0} possible duplicate pair(s)</Link>
            </li>
            <li>
              <Link href="/prospects?stage=researched" className="hover:underline">
                {count(["researched"])} researched, waiting for a score
              </Link>
            </li>
            <li>
              <Link href="/prospects?stage=discovered" className="hover:underline">
                {count(["discovered"])} discovered, waiting for research
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
