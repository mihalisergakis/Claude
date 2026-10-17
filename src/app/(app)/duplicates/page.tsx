import Link from "next/link";
import { Button, Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/workspace";
import { deleteProspect } from "../actions";

interface Pair {
  a_id: string;
  a_name: string;
  b_id: string;
  b_name: string;
  city: string | null;
  similarity: number;
}

export default async function DuplicatesPage() {
  const ctx = await requireSession();
  const { data } = await ctx.supabase.rpc("possible_duplicates", { ws: ctx.workspaceId });
  const pairs = (data ?? []) as Pair[];

  return (
    <>
      <PageHeader title="Possible duplicates" />
      <Card>
        <p className="mb-3 text-sm text-slate-600">
          Same website domains and emails are merged automatically on import. These pairs have similar names in the same city
          and need a human decision. Delete the one you don’t want; its facts and contacts go with it.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">Prospect A</th><th>Prospect B</th><th>City</th><th className="text-right">Similarity</th></tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={`${p.a_id}-${p.b_id}`} className="border-t border-slate-100">
                {[{ id: p.a_id, name: p.a_name }, { id: p.b_id, name: p.b_name }].map((o) => (
                  <td key={o.id} className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/prospects/${o.id}`} className="hover:underline">{o.name}</Link>
                      <form action={deleteProspect}>
                        <input type="hidden" name="organization_id" value={o.id} />
                        <Button variant="danger" className="px-1.5 py-0.5 text-xs">Delete</Button>
                      </form>
                    </div>
                  </td>
                ))}
                <td>{p.city ?? "—"}</td>
                <td className="text-right tabular-nums">{Math.round(p.similarity * 100)}%</td>
              </tr>
            ))}
            {pairs.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-500">No likely duplicates.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
