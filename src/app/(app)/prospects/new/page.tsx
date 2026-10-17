import { Button, Card, PageHeader, inputClass } from "@/components/ui";
import { getProducts, requireSession } from "@/lib/workspace";
import { addProspect } from "../../actions";

const FIELDS = [
  { name: "name", label: "Business or team name", required: true },
  { name: "website", label: "Website" },
  { name: "contact_name", label: "Contact name" },
  { name: "email", label: "Business email" },
  { name: "phone", label: "Phone" },
  { name: "city", label: "City" },
  { name: "county", label: "County" },
  { name: "state", label: "State", defaultValue: "UT" },
];

export default async function NewProspectPage() {
  const ctx = await requireSession();
  const [product] = await getProducts(ctx);
  return (
    <>
      <PageHeader title="Add prospect" />
      <Card className="max-w-xl">
        <form action={addProspect} className="space-y-3 text-sm">
          <input type="hidden" name="product_id" value={product.id} />
          {FIELDS.map((f) => (
            <label key={f.name} className="block">
              <span className="text-xs text-slate-500">{f.label}</span>
              <input name={f.name} required={f.required} defaultValue={f.defaultValue} className={`${inputClass} w-full`} />
            </label>
          ))}
          <label className="block">
            <span className="text-xs text-slate-500">Notes</span>
            <textarea name="notes" rows={3} className={`${inputClass} w-full`} />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="email_has_source" className="mt-1" />
            <span>This email was given to me directly or is published by the business (otherwise it stays unsourced until research finds it on their site).</span>
          </label>
          <Button>Add and research</Button>
        </form>
      </Card>
    </>
  );
}
