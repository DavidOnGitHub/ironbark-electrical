import { cn } from "@kabosh-digital/m-street-kit/format";
import type { RequestStatus, Urgency } from "ironbark-electrical-client";
import { REQUEST_STATUS_LABEL } from "../domain/requests/status";

type Tone = "ok" | "warn" | "bad" | "info" | "prog" | "neutral";

/** Six meanings, each a dot plus words (colour is never the only signal). */
const TONE: Record<Tone, string> = {
  ok: "bg-status-ok-soft text-status-ok",
  warn: "bg-status-warn-soft text-status-warn",
  bad: "bg-status-bad-soft text-status-bad",
  info: "bg-status-info-soft text-status-info",
  prog: "bg-status-prog-soft text-status-prog",
  neutral: "bg-status-neutral-soft text-status-neutral",
};

function Chip({ tone, className, children }: { tone: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2.5 text-[0.78rem] font-semibold whitespace-nowrap before:size-[7px] before:shrink-0 before:rounded-full before:bg-current", TONE[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_STYLE: Record<RequestStatus, Tone> = {
  NEW: "info",
  CONTACTED: "neutral",
  SITE_VISIT_BOOKED: "prog",
  QUOTED: "warn",
  WON: "ok",
  LOST: "bad",
};

export function RequestStatusChip({ status }: { status: RequestStatus }) {
  return (
    <Chip tone={STATUS_STYLE[status] as Tone}>
      {REQUEST_STATUS_LABEL[status]}
    </Chip>
  );
}

const URGENCY_STYLE: Record<Urgency, Tone | ""> = {
  ROUTINE: "",
  URGENT: "warn",
  EMERGENCY: "bad",
};

export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  if (urgency === "ROUTINE") return null;
  return (
    <Chip tone={URGENCY_STYLE[urgency] as Tone}>
      {urgency === "EMERGENCY" ? "Emergency" : "Urgent"}
    </Chip>
  );
}

export const CATEGORY_LABEL: Record<string, string> = {
  NEW_INSTALL: "New install",
  FAULT_REPAIR: "Fault / repair",
  QUOTE_REQUEST: "Quote request",
  OTHER: "Other",
};

export const SOURCE_LABEL: Record<string, string> = { EMAIL: "Email", PHONE: "Phone", MANUAL: "Manual", WEB: "Web" };

import { QUOTE_STATUS_LABEL, type QuoteStatusValue } from "../domain/quotes/calc";
import { JOB_STATUS_LABEL, type JobStatusValue } from "../domain/jobs/status";

const QUOTE_STYLE: Record<QuoteStatusValue, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  APPROVED: "ok",
  DECLINED: "bad",
  EXPIRED: "warn",
};

export function QuoteStatusChip({ status }: { status: QuoteStatusValue }) {
  return (
    <Chip tone={QUOTE_STYLE[status] as Tone}>
      {QUOTE_STATUS_LABEL[status]}
    </Chip>
  );
}

const JOB_STYLE: Record<JobStatusValue, Tone> = {
  UNSCHEDULED: "warn",
  SCHEDULED: "info",
  IN_PROGRESS: "prog",
  ON_HOLD: "neutral",
  COMPLETED: "ok",
  INVOICED: "info",
  PAID: "ok",
};

export function JobStatusChip({ status }: { status: JobStatusValue }) {
  return (
    <Chip tone={JOB_STYLE[status] as Tone}>
      {JOB_STATUS_LABEL[status]}
    </Chip>
  );
}

import { INVOICE_STATUS_LABEL, type EffectiveInvoiceStatus } from "../domain/invoicing/calc";

const INVOICE_STYLE: Record<EffectiveInvoiceStatus, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  PARTIALLY_PAID: "prog",
  PAID: "ok",
  VOID: "neutral",
  OVERDUE: "bad",
};

export function InvoiceStatusChip({ status }: { status: EffectiveInvoiceStatus }) {
  return (
    <Chip tone={INVOICE_STYLE[status] as Tone}>
      {INVOICE_STATUS_LABEL[status]}
    </Chip>
  );
}

/** Job numbers look like cable labels: hi-vis with dark text. */
export function JobTag({ number }: { number: string }) {
  return <span className="inline-block rounded-sm bg-hivis px-1.5 py-px font-heading text-[0.9em] leading-snug font-bold tracking-wide whitespace-nowrap text-hivis-foreground">{number}</span>;
}
