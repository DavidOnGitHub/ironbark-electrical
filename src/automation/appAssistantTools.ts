/**
 * Ironbark Electrical's own tools for the app-level assistant (the floating
 * chat - see @kabosh-digital/m-street-kit's PLAN-app-assistant.md Phase C).
 * Registered via KitConfig.appAssistantTools in instrumentation.ts, alongside
 * the kit's own built-in tools (definitions/instances/tasks/connectors).
 *
 * Every handler calls this business's own domain module functions (never
 * appDb directly) - the same functions the pages use - and maps their result
 * to a lean shape so the model sees the figures it needs without the full
 * Prisma row (internal ids, audit columns, etc.). The assistant is only ever
 * offered to ADMIN/EDITOR sessions (Policy.APP_ASSISTANT in m-street-kit), so
 * no extra role-scoping happens here - those two roles already see every
 * record in these domains on the regular pages (see instrumentation.ts's nav
 * roles), with one exception: pricing is "Owner and Office only" by the
 * pricing module's own doc comment, which matches that same ADMIN/EDITOR gate.
 */
import { listClients, getClient } from "../domain/clients";
import { listRequests, getRequest, countByStatus as requestCountsByStatus } from "../domain/requests";
import { listQuotes, getQuote, openQuoteStats } from "../domain/quotes";
import { listInvoices, getInvoice, receivablesSummary } from "../domain/invoicing";
import { listJobs, getJob, countJobsByStatus } from "../domain/jobs";
import { listPriceItems, listBundles } from "../domain/pricing";
import { formatMoney } from "../lib/money";
import type { AppAssistantTool } from "@kabosh-digital/m-street-kit/lib/appAssistant";

const STRING = { type: "string" } as const;
const NUMBER_LIMIT = { type: "integer", minimum: 1, maximum: 100, description: "Max rows to return." } as const;
const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

export const ironbarkAppAssistantTools: AppAssistantTool[] = [
  {
    name: "listClients",
    description: "Lists customers (clients), optionally searching by name/email/phone/address or filtering by tag.",
    paramsSchema: {
      type: "object",
      properties: { q: { ...STRING, description: "Search text." }, tag: STRING, limit: NUMBER_LIMIT },
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = await listClients({
        q: typeof args.q === "string" ? args.q : undefined,
        tag: typeof args.tag === "string" ? args.tag : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        email: c.email,
        phone: c.phone,
        tags: c.tags,
        sites: c.sites.map((s) => s.suburb),
        openRequestsCount: c._count.requests,
      }));
    },
  },
  {
    name: "getClient",
    description: "Gets one customer's full detail: contact info, sites, and recent enquiries.",
    paramsSchema: { type: "object", properties: { clientId: STRING }, required: ["clientId"], additionalProperties: false },
    handler: async (args) => {
      if (typeof args.clientId !== "string" || !args.clientId) throw new Error("clientId is required");
      const c = await getClient(args.clientId);
      if (!c) return `No client found with id "${args.clientId}".`;
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        email: c.email,
        phone: c.phone,
        tags: c.tags,
        notes: c.notes,
        sites: c.sites.map((s) => ({ id: s.id, label: s.label, suburb: s.suburb, line1: s.line1 })),
        recentRequests: c.requests.map((r) => ({ id: r.id, summary: r.summary, status: r.status, receivedAt: r.receivedAt })),
      };
    },
  },
  {
    name: "listRequests",
    description: "Lists customer enquiries (requests), optionally filtered by status or limited to still-open ones.",
    paramsSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["NEW", "CONTACTED", "SITE_VISIT_BOOKED", "QUOTED", "WON", "LOST"] },
        openOnly: { type: "boolean", description: "Exclude WON and LOST." },
        limit: NUMBER_LIMIT,
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = await listRequests({
        status: typeof args.status === "string" ? (args.status as never) : undefined,
        openOnly: args.openOnly === true,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return rows.map((r) => ({
        id: r.id,
        summary: r.summary,
        status: r.status,
        urgency: r.urgency,
        category: r.category,
        clientName: r.client?.name ?? r.contactName,
        suburb: r.site?.suburb,
        receivedAt: r.receivedAt,
      }));
    },
  },
  {
    name: "getRequest",
    description: "Gets one customer enquiry's full detail.",
    paramsSchema: { type: "object", properties: { requestId: STRING }, required: ["requestId"], additionalProperties: false },
    handler: async (args) => {
      if (typeof args.requestId !== "string" || !args.requestId) throw new Error("requestId is required");
      const r = await getRequest(args.requestId);
      if (!r) return `No request found with id "${args.requestId}".`;
      return {
        id: r.id,
        summary: r.summary,
        description: r.description,
        status: r.status,
        urgency: r.urgency,
        category: r.category,
        clientName: r.client?.name ?? r.contactName,
        contactEmail: r.contactEmail ?? r.client?.email,
        contactPhone: r.contactPhone ?? r.client?.phone,
        suburb: r.site?.suburb,
        lostReason: r.lostReason,
        receivedAt: r.receivedAt,
      };
    },
  },
  {
    name: "requestCountsByStatus",
    description: "Counts customer enquiries by status (NEW, CONTACTED, SITE_VISIT_BOOKED, QUOTED, WON, LOST).",
    paramsSchema: EMPTY_SCHEMA,
    handler: async () => requestCountsByStatus(),
  },
  {
    name: "listQuotes",
    description: "Lists quotes, optionally filtered by status or customer.",
    paramsSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["DRAFT", "SENT", "APPROVED", "DECLINED", "EXPIRED"] },
        clientId: STRING,
        limit: NUMBER_LIMIT,
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = await listQuotes({
        status: typeof args.status === "string" ? (args.status as never) : undefined,
        clientId: typeof args.clientId === "string" ? args.clientId : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return rows.map((q) => ({
        id: q.id,
        number: q.number,
        title: q.title,
        status: q.effectiveStatus,
        totalText: formatMoney(q.totalCents),
        clientName: q.client.name,
        validUntil: q.validUntil,
      }));
    },
  },
  {
    name: "getQuote",
    description: "Gets one quote's full detail, including its lines.",
    paramsSchema: { type: "object", properties: { quoteId: STRING }, required: ["quoteId"], additionalProperties: false },
    handler: async (args) => {
      if (typeof args.quoteId !== "string" || !args.quoteId) throw new Error("quoteId is required");
      const q = await getQuote(args.quoteId);
      if (!q) return `No quote found with id "${args.quoteId}".`;
      return {
        id: q.id,
        number: q.number,
        title: q.title,
        status: q.effectiveStatus,
        totalText: formatMoney(q.totalCents),
        clientName: q.client.name,
        validUntil: q.validUntil,
        lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceText: formatMoney(l.unitPriceCents) })),
      };
    },
  },
  {
    name: "openQuoteStats",
    description: "How many quotes are currently sent-and-still-valid, and their combined value.",
    paramsSchema: EMPTY_SCHEMA,
    handler: async () => {
      const r = await openQuoteStats();
      return { count: r.count, totalText: formatMoney(r.totalCents) };
    },
  },
  {
    name: "listInvoices",
    description: "Lists invoices, optionally filtered by status (DRAFT, SENT, PARTIALLY_PAID, PAID, VOID, OVERDUE) or customer.",
    paramsSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "VOID", "OVERDUE"] },
        clientId: STRING,
        limit: NUMBER_LIMIT,
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = await listInvoices({
        status: typeof args.status === "string" ? (args.status as never) : undefined,
        clientId: typeof args.clientId === "string" ? args.clientId : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return rows.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.effectiveStatus,
        balanceText: formatMoney(i.balanceCents),
        daysOverdue: i.daysOverdue,
        clientName: i.client.name,
        dueAt: i.dueAt,
      }));
    },
  },
  {
    name: "getInvoice",
    description: "Gets one invoice's full detail, including its lines and payments.",
    paramsSchema: { type: "object", properties: { invoiceId: STRING }, required: ["invoiceId"], additionalProperties: false },
    handler: async (args) => {
      if (typeof args.invoiceId !== "string" || !args.invoiceId) throw new Error("invoiceId is required");
      const i = await getInvoice(args.invoiceId);
      if (!i) return `No invoice found with id "${args.invoiceId}".`;
      return {
        id: i.id,
        number: i.number,
        status: i.effectiveStatus,
        totalText: formatMoney(i.totalCents),
        balanceText: formatMoney(i.balanceCents),
        daysOverdue: i.daysOverdue,
        clientName: i.client.name,
        dueAt: i.dueAt,
        lines: i.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceText: formatMoney(l.unitPriceCents) })),
        payments: i.payments.map((p) => ({ amountText: formatMoney(p.amountCents), paidAt: p.paidAt })),
      };
    },
  },
  {
    name: "receivablesSummary",
    description: "Money position: total outstanding, total overdue (with each overdue invoice's chase stage), and what came in this month.",
    paramsSchema: EMPTY_SCHEMA,
    handler: async () => {
      const r = await receivablesSummary();
      return {
        outstandingText: formatMoney(r.outstandingCents),
        outstandingCount: r.outstandingCount,
        overdueText: formatMoney(r.overdueCents),
        overdue: r.overdue.map((o) => ({ number: o.number, clientName: o.clientName, balanceText: formatMoney(o.balanceCents), daysOverdue: o.daysOverdue, chase: o.chase })),
        receivedThisMonthText: formatMoney(r.receivedThisMonthCents),
      };
    },
  },
  {
    name: "listJobs",
    description: "Lists jobs, optionally filtered by status or limited to active ones (not yet completed/invoiced/paid).",
    paramsSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["UNSCHEDULED", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "INVOICED", "PAID"] },
        activeOnly: { type: "boolean" },
        clientId: STRING,
        limit: NUMBER_LIMIT,
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = await listJobs({
        status: typeof args.status === "string" ? (args.status as never) : undefined,
        activeOnly: args.activeOnly === true,
        clientId: typeof args.clientId === "string" ? args.clientId : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return rows.map((j) => ({
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        clientName: j.client.name,
        suburb: j.site?.suburb,
        scheduledStart: j.scheduledStart,
        scheduledEnd: j.scheduledEnd,
      }));
    },
  },
  {
    name: "getJob",
    description: "Gets one job's full detail.",
    paramsSchema: { type: "object", properties: { jobId: STRING }, required: ["jobId"], additionalProperties: false },
    handler: async (args) => {
      if (typeof args.jobId !== "string" || !args.jobId) throw new Error("jobId is required");
      const j = await getJob(args.jobId);
      if (!j) return `No job found with id "${args.jobId}".`;
      return {
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        clientName: j.client.name,
        suburb: j.site?.suburb,
        scheduledStart: j.scheduledStart,
        scheduledEnd: j.scheduledEnd,
        latestInvoice: j.invoices[0] ? { number: j.invoices[0].number, status: j.invoices[0].status } : null,
        notes: j.notes.map((n) => ({ text: n.text, createdAt: n.createdAt })),
      };
    },
  },
  {
    name: "jobCountsByStatus",
    description: "Counts jobs by status (UNSCHEDULED, SCHEDULED, IN_PROGRESS, ON_HOLD, COMPLETED, INVOICED, PAID).",
    paramsSchema: EMPTY_SCHEMA,
    handler: async () => countJobsByStatus(),
  },
  {
    name: "listPriceItems",
    description: "Lists the price list (labour, call-outs, standard jobs, materials).",
    paramsSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["LABOUR", "CALL_OUT", "STANDARD_JOB", "MATERIAL"] },
        activeOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = await listPriceItems({
        kind: typeof args.kind === "string" ? (args.kind as never) : undefined,
        activeOnly: args.activeOnly === true,
      });
      return rows.map((p) => ({ id: p.id, kind: p.kind, name: p.name, unit: p.unit, priceText: formatMoney(p.priceCents), active: p.active }));
    },
  },
  {
    name: "listBundles",
    description: "Lists price-list bundles (several price items grouped as one quick-add option), with their lines.",
    paramsSchema: { type: "object", properties: { activeOnly: { type: "boolean" } }, additionalProperties: false },
    handler: async (args) => {
      const rows = await listBundles({ activeOnly: args.activeOnly === true });
      return rows.map((b) => ({
        id: b.id,
        name: b.name,
        active: b.active,
        lines: b.items.map((i) => ({ name: i.priceItem.name, quantity: i.quantity })),
      }));
    },
  },
];
