import { Field, SelectField, TextAreaField } from "./fields";

type ClientDefaults = {
  type?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  preferredContact?: string;
  tags?: string[];
  notes?: string | null;
};

/** The client form's inputs, shared by "new" and "edit". */
export function ClientFields({ client }: { client?: ClientDefaults }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={client?.name} required />
        <SelectField
          label="Type"
          name="type"
          defaultValue={client?.type ?? "PERSON"}
          options={[{ value: "PERSON", label: "Person" }, { value: "COMPANY", label: "Company" }]}
        />
        <Field label="Email" name="email" type="email" defaultValue={client?.email} />
        <Field label="Phone" name="phone" defaultValue={client?.phone} placeholder="0412 345 678" />
        <SelectField
          label="Prefers"
          name="preferredContact"
          defaultValue={client?.preferredContact ?? "EMAIL"}
          options={[{ value: "EMAIL", label: "Email" }, { value: "PHONE", label: "Phone" }]}
        />
        <Field label="Tags" name="tags" defaultValue={client?.tags?.join(", ")} placeholder="repeat, strata" hint="Comma separated" />
      </div>
      <TextAreaField label="Notes" name="notes" defaultValue={client?.notes} />
    </>
  );
}

export function SiteFields({ site }: { site?: { label?: string | null; line1?: string; line2?: string | null; suburb?: string; state?: string; postcode?: string; accessNotes?: string | null; switchboardNotes?: string | null } }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" name="label" defaultValue={site?.label} placeholder="Home, Unit 4, Shopfront" />
        <Field label="Street address" name="line1" defaultValue={site?.line1} required />
        <Field label="Address line 2" name="line2" defaultValue={site?.line2} />
        <Field label="Suburb" name="suburb" defaultValue={site?.suburb} required />
        <Field label="State" name="state" defaultValue={site?.state ?? "NSW"} />
        <Field label="Postcode" name="postcode" defaultValue={site?.postcode} required />
      </div>
      <TextAreaField label="Access notes" name="accessNotes" defaultValue={site?.accessNotes} rows={2} placeholder="Dog in yard, key under mat, call on arrival" />
      <TextAreaField label="Switchboard notes" name="switchboardNotes" defaultValue={site?.switchboardNotes} rows={2} placeholder="Garage, old ceramic fuses, no RCD" />
    </>
  );
}
