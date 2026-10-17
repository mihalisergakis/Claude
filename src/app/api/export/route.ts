import Papa from "papaparse";
import type { NextRequest } from "next/server";
import { getProducts, requireSession } from "@/lib/workspace";

interface Row {
  name: string;
  website: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  org_type: string;
  team_size: number | null;
  phone_e164: string | null;
  lead_source: string;
  notes: string;
  created_at: string;
  pipeline_entries: { stage: string; score: number | null; fit_tier: string | null; next_follow_up_at: string | null; last_contacted_at: string | null }[];
  contacts: { full_name: string | null; email: string | null; email_status: string; is_primary: boolean }[];
}

export async function GET(request: NextRequest) {
  const ctx = await requireSession();
  const [product] = await getProducts(ctx);
  const f = Object.fromEntries(request.nextUrl.searchParams);

  let query = ctx.supabase
    .from("organizations")
    .select(
      "name, website, city, county, state, org_type, team_size, phone_e164, lead_source, notes, created_at, pipeline_entries!inner(stage, score, fit_tier, next_follow_up_at, last_contacted_at), contacts(full_name, email, email_status, is_primary)",
    )
    .eq("pipeline_entries.product_id", product.id)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (f.q) query = query.or(`name.ilike.%${f.q.replace(/[,()]/g, " ")}%,domain.ilike.%${f.q.replace(/[,()]/g, " ")}%`);
  if (f.stage) query = query.eq("pipeline_entries.stage", f.stage);
  if (f.tier) query = query.eq("pipeline_entries.fit_tier", f.tier);
  if (f.county) query = query.ilike("county", f.county);
  if (f.city) query = query.ilike("city", f.city);
  if (f.type) query = query.eq("org_type", f.type);
  if (f.source) query = query.eq("lead_source", f.source);
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  const csv = Papa.unparse(
    ((data ?? []) as unknown as Row[]).map((r) => {
      const entry = r.pipeline_entries[0];
      const contact = r.contacts.find((c) => c.is_primary) ?? r.contacts[0];
      return {
        name: r.name,
        website: r.website ?? "",
        city: r.city ?? "",
        county: r.county ?? "",
        state: r.state ?? "",
        type: r.org_type,
        team_size: r.team_size ?? "",
        phone: r.phone_e164 ?? "",
        contact_name: contact?.full_name ?? "",
        email: contact?.email ?? "",
        email_status: contact?.email_status ?? "",
        stage: entry?.stage ?? "",
        score: entry?.score ?? "",
        tier: entry?.fit_tier ?? "",
        next_follow_up: entry?.next_follow_up_at?.slice(0, 10) ?? "",
        last_contacted: entry?.last_contacted_at?.slice(0, 10) ?? "",
        lead_source: r.lead_source,
        notes: r.notes,
        added: r.created_at.slice(0, 10),
      };
    }),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospects-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
