import { Field, SelectField, TextAreaField } from "./fields";

export const CATEGORY_OPTIONS = [
  { value: "FAULT_REPAIR", label: "Fault / repair" },
  { value: "NEW_INSTALL", label: "New install" },
  { value: "QUOTE_REQUEST", label: "Quote request" },
  { value: "OTHER", label: "Other" },
];
export const URGENCY_OPTIONS = [
  { value: "ROUTINE", label: "Routine" },
  { value: "URGENT", label: "Urgent" },
  { value: "EMERGENCY", label: "Emergency" },
];
export const SOURCE_OPTIONS = [
  { value: "PHONE", label: "Phone call" },
  { value: "MANUAL", label: "Walk-in / other" },
  { value: "EMAIL", label: "Email" },
  { value: "WEB", label: "Web" },
];

export function RequestFields({ clients }: { clients: { id: string; name: string }[] }) {
  return (
    <>
      <Field label="Summary" name="summary" required placeholder="No power to kitchen circuit" />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Category" name="category" options={CATEGORY_OPTIONS} defaultValue="FAULT_REPAIR" />
        <SelectField label="Urgency" name="urgency" options={URGENCY_OPTIONS} defaultValue="ROUTINE" />
        <SelectField label="Came in by" name="source" options={SOURCE_OPTIONS} defaultValue="PHONE" />
      </div>
      <TextAreaField label="Details" name="description" rows={4} placeholder="What the customer said, address, when they are home..." />
      <SelectField
        label="Existing client"
        name="clientId"
        options={[{ value: "", label: "- not a client yet (use contact details below) -" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        defaultValue=""
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Contact name" name="contactName" />
        <Field label="Contact email" name="contactEmail" type="email" />
        <Field label="Contact phone" name="contactPhone" />
      </div>
    </>
  );
}
