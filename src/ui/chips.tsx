import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { cn } from "@kabosh-digital/m-street-kit/format";
import type { RequestStatus, Urgency } from "iron-spark-client";
import { REQUEST_STATUS_LABEL } from "../domain/requests/status";

const STATUS_STYLE: Record<RequestStatus, string> = {
  NEW: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  CONTACTED: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  SITE_VISIT_BOOKED: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  QUOTED: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  WON: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
  LOST: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

export function RequestStatusChip({ status }: { status: RequestStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_STYLE[status])}>
      {REQUEST_STATUS_LABEL[status]}
    </Badge>
  );
}

const URGENCY_STYLE: Record<Urgency, string> = {
  ROUTINE: "",
  URGENT: "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  EMERGENCY: "border-red-400 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  if (urgency === "ROUTINE") return null;
  return (
    <Badge variant="outline" className={cn("font-semibold uppercase", URGENCY_STYLE[urgency])}>
      {urgency === "EMERGENCY" ? "Emergency" : "Urgent"}
    </Badge>
  );
}

export const CATEGORY_LABEL: Record<string, string> = {
  NEW_INSTALL: "New install",
  FAULT_REPAIR: "Fault / repair",
  QUOTE_REQUEST: "Quote request",
  OTHER: "Other",
};

export const SOURCE_LABEL: Record<string, string> = { EMAIL: "Email", PHONE: "Phone", MANUAL: "Manual", WEB: "Web" };
