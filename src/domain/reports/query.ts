import { appDb } from "../../db/app";
import { addDaysKey, dayKey, startOfDay, weekStartKey } from "../../lib/tz";
import { formatMoney } from "../../lib/money";
import { staffLabelMap } from "../shared/staff";

/**
 * A read-only reporting query for the assistant: count and total one kind of record over a date range, grouped
 * by day, week, month or a field, and optionally against the period just before. Only the listed datasets,
 * date fields and groupings exist - nothing the model sends reaches the database as a query of its own.
 */
export const DATASETS = {
  enquiries: { dateFields: ["receivedAt", "createdAt"], groups: ["status", "category", "urgency", "source"], money: null },
  quotes: { dateFields: ["sentAt", "decidedAt", "createdAt"], groups: ["status", "client"], money: "total of the quotes (incl GST)" },
  invoices: { dateFields: ["issuedAt", "paidAt", "dueAt", "createdAt"], groups: ["status", "client"], money: "total of the invoices (incl GST); void invoices are left out" },
  payments: { dateFields: ["paidAt"], groups: ["method", "kind"], money: "money received" },
  jobs: { dateFields: ["completedAt", "scheduledStart", "createdAt"], groups: ["status", "technician", "client"], money: "quoted value (ex GST)" },
  siteVisits: { dateFields: ["scheduledStart", "completedAt"], groups: ["status", "technician"], money: null },
} as const;
export type Dataset = keyof typeof DATASETS;

export const PERIODS = ["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "last7Days", "last30Days", "last90Days", "thisYear"] as const;
export type PeriodName = (typeof PERIODS)[number];
export const TIME_GROUPS = ["day", "week", "month"] as const;

export interface Period {
  from: string;
  /** Inclusive Sydney day. */
  to: string;
}

const daysBetweenKeys = (a: string, b: string) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);

/** A named period as Sydney calendar days. Weeks run Monday to Sunday; "this" periods run to their natural end. */
export function resolvePeriod(name: PeriodName, now: Date = new Date()): Period {
  const today = dayKey(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDaysKey(monthStart, -1);
  switch (name) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDaysKey(today, -1), to: addDaysKey(today, -1) };
    case "thisWeek": return { from: weekStartKey(today), to: addDaysKey(weekStartKey(today), 6) };
    case "lastWeek": return { from: addDaysKey(weekStartKey(today), -7), to: addDaysKey(weekStartKey(today), -1) };
    case "thisMonth": return { from: monthStart, to: addDaysKey(`${nextMonthKey(today)}-01`, -1) };
    case "lastMonth": return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
    case "last7Days": return { from: addDaysKey(today, -6), to: today };
    case "last30Days": return { from: addDaysKey(today, -29), to: today };
    case "last90Days": return { from: addDaysKey(today, -89), to: today };
    case "thisYear": return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

function nextMonthKey(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The same number of days immediately before `period` (or the whole previous month / week when that is what it is). */
export function previousPeriod(period: Period): Period {
  const len = daysBetweenKeys(period.from, period.to) + 1;
  if (period.from.endsWith("-01") && addDaysKey(period.to, 1).endsWith("-01")) {
    const prevEnd = addDaysKey(period.from, -1);
    return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
  }
  return { from: addDaysKey(period.from, -len), to: addDaysKey(period.from, -1) };
}

export interface Row {
  at: Date;
  amountCents: number;
  /** Values for each field this dataset can be grouped by. */
  fields: Record<string, string>;
}

export interface Group {
  key: string;
  count: number;
  totalCents: number;
}

/** The bucket a row falls in: a Sydney day, week (its Monday) or month, or the row's own field value. */
export function bucketOf(row: Row, groupBy: string): string {
  if (groupBy === "day") return dayKey(row.at);
  if (groupBy === "week") return weekStartKey(dayKey(row.at));
  if (groupBy === "month") return dayKey(row.at).slice(0, 7);
  return row.fields[groupBy] ?? "Unknown";
}

export function aggregate(rows: Row[], groupBy?: string): { count: number; totalCents: number; groups: Group[] } {
  const groups = new Map<string, Group>();
  let totalCents = 0;
  for (const r of rows) {
    totalCents += r.amountCents;
    if (!groupBy) continue;
    const key = bucketOf(r, groupBy);
    const g = groups.get(key) ?? { key, count: 0, totalCents: 0 };
    g.count++;
    g.totalCents += r.amountCents;
    groups.set(key, g);
  }
  const list = [...groups.values()];
  const timeBased = (TIME_GROUPS as readonly string[]).includes(groupBy ?? "");
  list.sort(timeBased ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.totalCents - a.totalCents || b.count - a.count);
  return { count: rows.length, totalCents, groups: list };
}

const ROW_CAP = 5000;

/** The row's value for the date field it was selected by (the query's range already excludes nulls). */
const dateOf = (row: object, field: string): Date => (row as Record<string, unknown>)[field] as Date;

async function fetchRows(dataset: Dataset, dateField: string, period: Period): Promise<Row[]> {
  const range = { gte: startOfDay(period.from), lt: startOfDay(addDaysKey(period.to, 1)) };
  const names = await staffLabelMap();
  const who = (id: string | null | undefined) => (id ? (names.get(id) ?? "Unknown") : "Unassigned");
  const take = ROW_CAP;
  switch (dataset) {
    case "enquiries": {
      const rows = await appDb.request.findMany({ where: { [dateField]: range }, take, select: { receivedAt: true, createdAt: true, status: true, category: true, urgency: true, source: true } });
      return rows.map((r) => ({ at: dateOf(r, dateField), amountCents: 0, fields: { status: r.status, category: r.category, urgency: r.urgency, source: r.source } }));
    }
    case "quotes": {
      const rows = await appDb.quote.findMany({ where: { [dateField]: range }, take, select: { sentAt: true, decidedAt: true, createdAt: true, status: true, totalCents: true, client: { select: { name: true } } } });
      return rows.map((r) => ({ at: dateOf(r, dateField), amountCents: r.totalCents, fields: { status: r.status, client: r.client.name } }));
    }
    case "invoices": {
      const rows = await appDb.invoice.findMany({ where: { [dateField]: range, status: { not: "VOID" } }, take, select: { issuedAt: true, paidAt: true, dueAt: true, createdAt: true, status: true, totalCents: true, client: { select: { name: true } } } });
      return rows.map((r) => ({ at: dateOf(r, dateField), amountCents: r.totalCents, fields: { status: r.status, client: r.client.name } }));
    }
    case "payments": {
      const rows = await appDb.payment.findMany({ where: { paidAt: range }, take, select: { paidAt: true, amountCents: true, method: true, kind: true } });
      return rows.map((r) => ({ at: r.paidAt, amountCents: r.amountCents, fields: { method: r.method, kind: r.kind } }));
    }
    case "jobs": {
      const rows = await appDb.job.findMany({ where: { [dateField]: range }, take, select: { completedAt: true, scheduledStart: true, createdAt: true, status: true, quotedSubtotalCents: true, assignedUserId: true, client: { select: { name: true } } } });
      return rows.map((r) => ({ at: dateOf(r, dateField), amountCents: r.quotedSubtotalCents, fields: { status: r.status, technician: who(r.assignedUserId), client: r.client.name } }));
    }
    case "siteVisits": {
      const rows = await appDb.siteVisit.findMany({ where: { [dateField]: range, status: { not: "CANCELLED" } }, take, select: { scheduledStart: true, completedAt: true, status: true, assignedUserId: true } });
      return rows.map((r) => ({ at: dateOf(r, dateField), amountCents: 0, fields: { status: r.status, technician: who(r.assignedUserId) } }));
    }
  }
}

export interface ReportQuery {
  dataset: Dataset;
  dateField?: string;
  period?: PeriodName;
  from?: string;
  to?: string;
  groupBy?: string;
  compareWithPrevious?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const shape = (a: ReturnType<typeof aggregate>, hasMoney: boolean) => ({
  count: a.count,
  ...(hasMoney ? { total: formatMoney(a.totalCents) } : {}),
  groups: a.groups.slice(0, 50).map((g) => ({ key: g.key, count: g.count, ...(hasMoney ? { total: formatMoney(g.totalCents) } : {}) })),
});

const change = (now: number, before: number) => (before === 0 ? (now === 0 ? "no change" : "new (nothing in the earlier period)") : `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%`);

export async function runReport(q: ReportQuery, now: Date = new Date()) {
  const def = DATASETS[q.dataset];
  if (!def) throw new Error(`Unknown dataset "${q.dataset}". Use one of: ${Object.keys(DATASETS).join(", ")}.`);
  const dateField = q.dateField ?? def.dateFields[0];
  if (!(def.dateFields as readonly string[]).includes(dateField)) throw new Error(`${q.dataset} can be dated by: ${def.dateFields.join(", ")}.`);
  if (q.groupBy && !(TIME_GROUPS as readonly string[]).includes(q.groupBy) && !(def.groups as readonly string[]).includes(q.groupBy)) {
    throw new Error(`${q.dataset} can be grouped by: ${[...TIME_GROUPS, ...def.groups].join(", ")}.`);
  }
  let period: Period;
  if (q.from || q.to) {
    if (!q.from || !q.to || !DAY.test(q.from) || !DAY.test(q.to) || q.to < q.from) throw new Error("Give both from and to as YYYY-MM-DD, with to on or after from.");
    if (daysBetweenKeys(q.from, q.to) > 800) throw new Error("That range is longer than about two years.");
    period = { from: q.from, to: q.to };
  } else {
    period = resolvePeriod(q.period ?? "last30Days", now);
  }
  const hasMoney = def.money !== null;
  const current = aggregate(await fetchRows(q.dataset, dateField, period), q.groupBy);
  const today = dayKey(now);
  const out: Record<string, unknown> = {
    today,
    dataset: q.dataset,
    datedBy: dateField,
    ...(hasMoney ? { totalMeans: def.money } : {}),
    period,
    ...(period.to > today ? { note: `The period runs to ${period.to}, so days after ${today} have nothing yet.` } : {}),
    ...shape(current, hasMoney),
  };
  if (q.compareWithPrevious) {
    const prev = previousPeriod(period);
    const before = aggregate(await fetchRows(q.dataset, dateField, prev), q.groupBy);
    out.previous = { period: prev, ...shape(before, hasMoney) };
    out.change = { count: change(current.count, before.count), ...(hasMoney ? { total: change(current.totalCents, before.totalCents) } : {}) };
  }
  if (current.count >= ROW_CAP) out.warning = `Only the first ${ROW_CAP} records were counted.`;
  return out;
}
