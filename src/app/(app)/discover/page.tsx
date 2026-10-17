import { Button, Card, PageHeader, formatDate, inputClass } from "@/components/ui";
import { getProducts, requireSession } from "@/lib/workspace";
import { startDiscovery } from "../actions";

const COUNTIES = ["Salt Lake", "Utah", "Davis", "Weber", "Washington", "Cache", "Summit", "Tooele", "Iron", "Box Elder", "Wasatch"];
const TYPES = [
  { value: "team", label: "Real estate teams" },
  { value: "independent_brokerage", label: "Independent brokerages" },
  { value: "solo_agent", label: "Independent agents" },
];

export default async function DiscoverPage() {
  const ctx = await requireSession();
  const [product] = await getProducts(ctx);
  const { data: runs } = await ctx.supabase.from("discovery_runs").select("*").order("created_at", { ascending: false }).limit(20);

  return (
    <>
      <PageHeader title="Find prospects" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="New search" className="lg:col-span-1">
          <form action={startDiscovery} className="space-y-3 text-sm">
            <input type="hidden" name="product_id" value={product.id} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-slate-500">State</span>
                <input name="state" defaultValue="UT" className={`${inputClass} w-full`} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">County</span>
                <input name="county" list="counties" placeholder="Any" className={`${inputClass} w-full`} />
                <datalist id="counties">{COUNTIES.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-slate-500">City (optional)</span>
              <input name="city" placeholder="e.g. Layton" className={`${inputClass} w-full`} />
            </label>
            <fieldset>
              <legend className="text-xs text-slate-500">Business types</legend>
              {TYPES.map((t) => (
                <label key={t.value} className="mr-3 inline-flex items-center gap-1">
                  <input type="checkbox" name="org_types" value={t.value} defaultChecked={t.value !== "solo_agent"} /> {t.label}
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className="text-xs text-slate-500">How many (max 50)</span>
              <input name="limit" type="number" min={1} max={50} defaultValue={15} className={`${inputClass} w-24`} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Extra instructions (optional)</span>
              <textarea name="notes" rows={2} placeholder="e.g. focus on teams that mention new construction" className={`${inputClass} w-full`} />
            </label>
            <Button>Start search</Button>
            <p className="text-xs text-slate-500">
              Searches the web for businesses’ own websites (portals like Zillow and social sites are excluded), skips ones
              you already have, then researches and scores each new one. Nothing is sent. Rough cost: $0.02 per search plus
              research and scoring per prospect.
            </p>
          </form>
        </Card>

        <Card title="Recent searches" className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">When</th><th>Market</th><th>Status</th><th className="text-right">Found</th><th className="text-right">New</th><th className="text-right">Skipped</th></tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="py-1.5">{formatDate(r.created_at)}</td>
                  <td>{[r.criteria.city, r.criteria.county && `${r.criteria.county} Co.`, r.criteria.state].filter(Boolean).join(", ")}</td>
                  <td>
                    {r.status}
                    {r.error && <div className="text-xs text-red-700">{r.error}</div>}
                  </td>
                  <td className="text-right tabular-nums">{r.candidates_found}</td>
                  <td className="text-right tabular-nums">
                    <a href={`/prospects?source=discovery:${r.id}`} className="hover:underline">{r.candidates_created}</a>
                  </td>
                  <td className="text-right tabular-nums">{r.candidates_skipped}</td>
                </tr>
              ))}
              {(runs ?? []).length === 0 && <tr><td colSpan={6} className="py-3 text-slate-500">No searches yet.</td></tr>}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">Searches run in the background (every 5 minutes, or press “Run now” in the header).</p>
        </Card>
      </div>
    </>
  );
}
