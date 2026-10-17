import Link from "next/link";
import type { PipelineStage } from "@/lib/types";

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button {...props} className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export const inputClass = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

const STAGE_COLORS: Partial<Record<PipelineStage, string>> = {
  discovered: "bg-slate-100 text-slate-700",
  researched: "bg-sky-100 text-sky-800",
  qualified: "bg-emerald-100 text-emerald-800",
  disqualified: "bg-zinc-200 text-zinc-600",
  interested: "bg-violet-100 text-violet-800",
  demo_booked: "bg-violet-100 text-violet-800",
  trial: "bg-amber-100 text-amber-800",
  customer: "bg-emerald-600 text-white",
  unsubscribed: "bg-red-100 text-red-800",
  do_not_contact: "bg-red-100 text-red-800",
  bounced: "bg-red-100 text-red-800",
};

export function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-700"}`}>
      {stage.replace(/_/g, " ")}
    </span>
  );
}

export function TierBadge({ tier, score }: { tier: string | null; score: number | null }) {
  if (!tier) return <span className="text-xs text-slate-400">—</span>;
  const color = { A: "bg-emerald-600", B: "bg-emerald-400", C: "bg-amber-400", D: "bg-slate-400" }[tier] ?? "bg-slate-400";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-block rounded px-1.5 py-0.5 font-semibold text-white ${color}`}>{tier}</span>
      <span className="tabular-nums text-slate-600">{score}</span>
    </span>
  );
}

export function SourceLink({ url, label }: { url: string | null; label?: string }) {
  if (!url) return <span className="text-slate-400">{label ?? "no URL"}</span>;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "") + new URL(url).pathname.replace(/\/$/, "");
  } catch {}
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-sky-300 hover:decoration-sky-700">
      {label ?? host}
    </a>
  );
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
      {children}
    </Link>
  );
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
