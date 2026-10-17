import { Card, PageHeader, formatDate } from "@/components/ui";
import { requireSession } from "@/lib/workspace";

export default async function JobsPage() {
  const ctx = await requireSession();
  const { data: jobs } = await ctx.supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <PageHeader title="Background jobs" />
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">Created</th><th>Type</th><th>Status</th><th>Attempts</th><th>Error</th></tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j) => (
              <tr key={j.id} className="border-t border-slate-100 align-top">
                <td className="py-1.5">{formatDate(j.created_at)}</td>
                <td>{j.type}</td>
                <td className={j.status === "failed" ? "text-red-700" : ""}>{j.status}</td>
                <td className="tabular-nums">{j.attempts}/{j.max_attempts}</td>
                <td className="max-w-md text-xs text-slate-600">{j.last_error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
