import { centsToInput } from "../lib/money";
import { Field, SelectField } from "./fields";

export const KIND_OPTIONS = [
  { value: "LABOUR", label: "Labour" },
  { value: "CALL_OUT", label: "Call-out fee" },
  { value: "STANDARD_JOB", label: "Standard job" },
  { value: "MATERIAL", label: "Material" },
];
export const KIND_LABEL: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label]));

type Item = { id?: string; kind?: string; name?: string; description?: string | null; unit?: string; costCents?: number | null; markupPct?: number | null; priceCents?: number };

export function PriceItemFields({ item }: { item?: Item }) {
  return (
    <>
      {item?.id ? <input type="hidden" name="priceItemId" value={item.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Kind" name="kind" options={KIND_OPTIONS} defaultValue={item?.kind ?? "LABOUR"} />
        <Field label="Name" name="name" defaultValue={item?.name} required className="sm:col-span-2" />
        <Field label="Unit" name="unit" defaultValue={item?.unit ?? "each"} placeholder="hour, each, job, m" />
        <Field label="Price ex GST ($)" name="price" defaultValue={item ? centsToInput(item.priceCents) : ""} hint="Unit price. Materials with a cost and markup are priced from those." />
        <Field label="Description" name="description" defaultValue={item?.description} />
        <Field label="Material cost ($)" name="cost" defaultValue={item ? centsToInput(item.costCents) : ""} />
        <Field label="Markup (%)" name="markupPct" defaultValue={item?.markupPct != null ? String(item.markupPct) : ""} />
      </div>
    </>
  );
}
