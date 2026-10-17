import { PageHeader } from "@/components/ui";
import { getProducts, requireSession } from "@/lib/workspace";
import { ImportWizard } from "./wizard";

export default async function ImportPage() {
  const ctx = await requireSession();
  const [product] = await getProducts(ctx);
  const { data: imports } = await ctx.supabase.from("imports").select("*").order("created_at", { ascending: false }).limit(10);
  return (
    <>
      <PageHeader title="Import CSV" />
      <ImportWizard productId={product.id} recent={imports ?? []} />
    </>
  );
}
