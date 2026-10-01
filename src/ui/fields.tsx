import { useId, type ReactNode } from "react";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { Label } from "@kabosh-digital/m-street-kit/ui/label";
import { Textarea } from "@kabosh-digital/m-street-kit/ui/textarea";
import { cn } from "@kabosh-digital/m-street-kit/format";

export function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  placeholder,
  hint,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const id = `${name}-${useId()}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={defaultValue ?? ""} required={required} placeholder={placeholder} className="bg-card" />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  rows = 3,
  placeholder,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const id = `${name}-${useId()}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} name={name} rows={rows} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="bg-card" />
    </div>
  );
}

/** A native <select>: it posts with the form (the kit's Radix select does not). */
export function SelectField({
  label,
  name,
  options,
  defaultValue,
  className,
  required,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  className?: string;
  required?: boolean;
}) {
  const id = `${name}-${useId()}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
