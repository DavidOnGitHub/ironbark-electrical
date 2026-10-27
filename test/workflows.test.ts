import { describe, expect, it } from "vitest";
import { validateGraph, type WorkflowDefinitionGraph } from "@kabosh-digital/workflow-types";
import { getStepCatalog } from "@kabosh-digital/workflow-temporal/catalog";
import { invoiceChase, ironSparkWorkflows, quoteChase, reviewRequest, enquiryToReply, visitToQuote, jobBooking, jobToInvoice, wireConnectors } from "../src/workflows";
import { ironSparkStepDefs } from "../src/steps/defs";
import { DAYS } from "../src/workflows/build";

const BUILT_IN = new Set(getStepCatalog().map((s) => s.key));
const OURS = new Map(ironSparkStepDefs.map((d) => [d.key, d]));

describe.each(ironSparkWorkflows.map((g) => [g.name, g] as const))("workflow: %s", (_name, graph) => {
  it("passes the platform's structural validation", () => {
    expect(validateGraph(graph)).toEqual([]);
  });

  it("only uses steps that exist (built in, or one of Ironbark Electrical's)", () => {
    for (const n of graph.nodes.filter((n) => n.type === "ACTION")) {
      expect(BUILT_IN.has(n.stepKey) || OURS.has(n.stepKey), `${n.id} uses ${n.stepKey}`).toBe(true);
    }
  });

  it("every Ironbark Electrical step node has a config its own schema accepts", () => {
    for (const n of graph.nodes.filter((n) => n.type === "ACTION" && OURS.has(n.stepKey))) {
      const parsed = OURS.get(n.stepKey)!.configSchema.safeParse(n.config);
      expect(parsed.success, `${n.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it("every $ref points at the trigger or a node that exists", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const refs: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const r = v as Record<string, unknown>;
        if (typeof r.$ref === "string") refs.push(r.$ref);
        else Object.values(r).forEach(walk);
      }
    };
    graph.nodes.forEach((n) => walk(n.config));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(ids.has(r.split(".")[0]!) || r.startsWith("trigger"), r).toBe(true);
    for (const e of graph.edges) if (e.condition) expect(ids.has(e.condition.field.split(".")[0]!), e.condition.field).toBe(true);
  });

  it("is a draft with the platform's id convention", () => {
    expect(graph.status).toBe("DRAFT");
    expect(graph.id).toMatch(/^def_ironspark_/);
  });
});

/** Sum of the DELAY nodes on the straight-through path of the chase workflow, in days. */
function cumulativeDays(graph: WorkflowDefinitionGraph, until: string, fallbackAt: string[] = []): number {
  let total = 0;
  let id = graph.nodes.find((n) => n.type === "TRIGGER")!.id;
  for (let guard = 0; guard < 100; guard++) {
    const node = graph.nodes.find((n) => n.id === id)!;
    if (node.type === "DELAY") total += (node.config.seconds as number) / DAYS;
    if (id === until) return total;
    const edges = graph.edges.filter((e) => e.fromNodeId === id);
    // follow the "still waiting / unpaid" (conditional) branch where there is one
    const pick = fallbackAt.includes(id) ? edges.find((e) => !e.condition) : (edges.find((e) => e.condition) ?? edges[0]);
    id = pick!.toNodeId;
  }
  throw new Error("path not found");
}

describe("the chasing cadences follow the requirements", () => {
  it("invoice chase: terms are 7 days, so the steps land on day 1, 7, 14 and 30 overdue", () => {
    const dueDay = 7; // payment terms
    expect(cumulativeDays(invoiceChase, "reminder") - dueDay).toBe(1);
    expect(cumulativeDays(invoiceChase, "call_task") - dueDay).toBe(7);
    expect(cumulativeDays(invoiceChase, "notice") - dueDay).toBe(14);
    expect(cumulativeDays(invoiceChase, "owner_escalation") - dueDay).toBe(30);
  });
  it("quote chase: a reminder after 1 day, the owner after 3 more", () => {
    expect(cumulativeDays(quoteChase, "reminder")).toBe(1);
    expect(cumulativeDays(quoteChase, "owner_call")).toBe(4);
  });
  it("review request: thanks and asks straight away, nudges 3 days after that", () => {
    expect(cumulativeDays(reviewRequest, "send_review")).toBe(0);
    expect(cumulativeDays(reviewRequest, "send_reminder", ["decision_replied"])).toBe(3);
  });
});

describe("safety rules", () => {
  it("the enquiry workflow sends one email, and only after a person approves it", () => {
    const sends = enquiryToReply.nodes.filter((n) => n.stepKey === "sendTemplatedEmail").map((n) => n.id);
    expect(sends).toEqual(["send_reply"]);
    // the proposed reply is only reachable through the approval decision
    const into = enquiryToReply.edges.filter((e) => e.toNodeId === "send_reply");
    expect(into).toHaveLength(1);
    expect(into[0]!.fromNodeId).toBe("decision_approved");
    expect(into[0]!.condition).toMatchObject({ field: "approve_reply.approved", op: "eq", value: true });
  });
  it("a quote drafted from a site visit is only sent after a person approves it", () => {
    const sends = visitToQuote.nodes.filter((n) => n.stepKey === "sendQuote").map((n) => n.id);
    expect(sends).toEqual(["send_quote"]);
    const into = visitToQuote.edges.filter((e) => e.toNodeId === "send_quote");
    expect(into).toHaveLength(1);
    expect(into[0]!.fromNodeId).toBe("decision_approved");
    expect(into[0]!.condition).toMatchObject({ field: "approve_quote.approved", op: "eq", value: true });
    expect(visitToQuote.edges.filter((e) => e.toNodeId === "approve_quote").map((e) => e.fromNodeId)).toEqual(["decision_drafted"]);
  });
  it("a job is only put in the calendar after a person approves the customer's day, and a declined day is freed", () => {
    const into = jobBooking.edges.filter((e) => e.toNodeId === "confirm");
    expect(into).toHaveLength(1);
    expect(into[0]!.fromNodeId).toBe("decision_approved");
    expect(into[0]!.condition).toMatchObject({ field: "approve_booking.approved", op: "eq", value: true });
    const toRelease = jobBooking.edges.filter((e) => e.toNodeId === "release");
    expect(toRelease).toHaveLength(1);
    expect(toRelease[0]!.condition).toBeUndefined(); // the only other way out of the decision
    expect(jobBooking.edges.filter((e) => e.toNodeId === "approve_booking").map((e) => e.fromNodeId)).toEqual(["load"]);
  });
  it("a drafted invoice is left for the office to issue (no task), and the customer email carries the PDF", () => {
    expect(jobToInvoice.nodes.filter((n) => n.type === "HUMAN_TASK")).toEqual([]);
    const email = invoiceChase.nodes.find((n) => n.id === "send_invoice")!;
    expect(((email.config as { params: { attachInvoiceId?: unknown } }).params).attachInvoiceId).toEqual({ $ref: "trigger.invoiceId" });
  });
  it("emailing an issued invoice has one approval task: approve, edit the message first, or reject to close it", () => {
    const approve = invoiceChase.nodes.find((n) => n.id === "approve_send")!;
    expect(approve.config).toMatchObject({ approval: true, reviewsNodeId: "send_invoice_approved", editsVariable: "message" });
    const out = invoiceChase.edges.filter((e) => e.fromNodeId === "decision_send_approved");
    expect(out.find((e) => e.condition)!.toNodeId).toBe("send_invoice_approved");
    // Rejecting closes the task: it goes to a note, not to a second "send by hand" task.
    expect(out.find((e) => !e.condition)!.toNodeId).toBe("note_rejected");
    const sent = invoiceChase.nodes.find((n) => n.id === "send_invoice_approved")!;
    expect(((sent.config as { params: { variables: Record<string, unknown> } }).params).variables.message).toEqual({ $ref: "approve_send.message" });
  });
  it("every enquiry, whoever sent it, reaches the approval task; emergencies are phoned first", () => {
    expect(enquiryToReply.edges.filter((e) => e.fromNodeId === "log_enquiry").map((e) => e.toNodeId)).toEqual(["decision_emergency"]);
    expect(enquiryToReply.edges.find((e) => e.fromNodeId === "decision_emergency" && !e.condition)!.toNodeId).toBe("approve_reply");
    expect(enquiryToReply.edges.find((e) => e.fromNodeId === "decision_emergency" && e.condition)!.toNodeId).toBe("emergency_task");
    expect(enquiryToReply.edges.find((e) => e.fromNodeId === "emergency_task")!.toNodeId).toBe("approve_reply");
  });
  it("the inbox trigger is narrowed to the plus-alias, never the whole mailbox", () => {
    const wired = wireConnectors(enquiryToReply, { emailConnectorId: "conn_gmail", gmailAccount: "david8959@gmail.com" });
    const trigger = wired.nodes.find((n) => n.type === "TRIGGER")!;
    expect(trigger.config.query).toBe("in:inbox -from:me to:david8959+ironbark@gmail.com");
    expect(trigger.config.connectorId).toBe("conn_gmail");
    // without the account the query is left as shipped (still wired to the connector)
    expect(wireConnectors(enquiryToReply, { emailConnectorId: "c" }).nodes.find((n) => n.type === "TRIGGER")!.config.query).toBe(enquiryToReply.nodes.find((n) => n.type === "TRIGGER")!.config.query);
  });
  it("an emergency enquiry alerts the owner before the reply is approved", () => {
    const toEmergency = enquiryToReply.edges.find((e) => e.toNodeId === "emergency_task")!;
    expect(toEmergency.condition).toMatchObject({ field: "log_enquiry.isEmergency", value: true });
    expect(enquiryToReply.edges.find((e) => e.fromNodeId === "emergency_task")!.toNodeId).toBe("approve_reply");
  });
  it("email failures fall back to a person, never to silence", () => {
    for (const g of [quoteChase, invoiceChase]) {
      const first = g.nodes.find((n) => n.stepKey === "sendTemplatedEmail")!;
      expect(first.onFailureNodeId).toBeTruthy();
      expect(g.nodes.find((n) => n.id === first.onFailureNodeId)!.type).toBe("HUMAN_TASK");
    }
  });
  it("quote emails to an address that is not on the allowlist wait for a person's approval, then send themselves", () => {
    const edge = (from: string, to: string) => quoteChase.edges.find((e) => e.fromNodeId === from && e.toNodeId === to);
    // the first email: automatic only when allowed; otherwise the approval task, whose approval is what sends it
    expect(edge("decision_email", "send_quote")!.condition).toMatchObject({ field: "load_quote.hasEmail", value: true });
    expect(edge("decision_email", "approve_send")!.condition).toMatchObject({ field: "load_quote.hasEmailAddress", value: true });
    expect(quoteChase.edges.filter((e) => e.toNodeId === "send_quote_approved").map((e) => e.fromNodeId)).toEqual(["decision_send_approved"]);
    expect(edge("decision_send_approved", "send_quote_approved")!.condition).toMatchObject({ field: "approve_send.approved", value: true });
    expect(edge("decision_send_approved", "send_by_hand")!.condition).toBeUndefined(); // rejected: a person sends it
    // the reminder follows the same rule
    expect(edge("decision_remind_email", "reminder")!.condition).toMatchObject({ field: "check_1.hasEmail", value: true });
    expect(edge("decision_remind_email", "approve_reminder")!.condition).toMatchObject({ field: "check_1.hasEmailAddress", value: true });
    expect(quoteChase.edges.filter((e) => e.toNodeId === "reminder_approved").map((e) => e.fromNodeId)).toEqual(["decision_reminder_approved"]);
    // the approval tasks show the email they approve
    for (const [task, step] of [["approve_send", "send_quote_approved"], ["approve_reminder", "reminder_approved"]] as const) {
      expect(quoteChase.nodes.find((n) => n.id === task)!.config).toMatchObject({ approval: true, reviewsNodeId: step });
    }
    // the only way to the automatic nodes is through the allowlist decision
    expect(quoteChase.edges.filter((e) => e.toNodeId === "send_quote").map((e) => e.fromNodeId)).toEqual(["decision_email"]);
    expect(quoteChase.edges.filter((e) => e.toNodeId === "reminder").map((e) => e.fromNodeId)).toEqual(["decision_remind_email"]);
  });
  it("wiring the Gmail connector fills in every Gmail node and nothing else", () => {
    const wired = wireConnectors(invoiceChase, { emailConnectorId: "conn_gmail" });
    for (const n of wired.nodes) {
      const wantsEmail = n.stepKey === "sendTemplatedEmail" || n.stepKey === "emailRead" || n.stepKey === "emailInbound";
      expect(n.config.connectorId, n.id).toBe(wantsEmail ? "conn_gmail" : undefined);
    }
    expect(wireConnectors(invoiceChase, {})).toBe(invoiceChase);
  });
});
