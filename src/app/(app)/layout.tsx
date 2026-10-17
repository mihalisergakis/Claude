import { Button, NavLink } from "@/components/ui";
import { requireSession } from "@/lib/workspace";
import { runJobsNow, signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const [{ count: queued }, { count: failed }] = await Promise.all([
    ctx.supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
    ctx.supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2">
          <span className="mr-4 font-semibold">Prospecting</span>
          <nav className="flex flex-wrap gap-1">
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/prospects">Prospects</NavLink>
            <NavLink href="/discover">Find prospects</NavLink>
            <NavLink href="/import">Import CSV</NavLink>
            <NavLink href="/duplicates">Duplicates</NavLink>
            <NavLink href="/jobs">Jobs</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            <span>
              {queued ?? 0} job(s) queued{failed ? <span className="text-red-700"> · {failed} failed</span> : null}
            </span>
            <form action={runJobsNow}>
              <Button variant="secondary" disabled={!queued}>Run now</Button>
            </form>
            <form action={signOut}>
              <Button variant="secondary">Sign out</Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
