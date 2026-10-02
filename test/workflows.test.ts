import { describe, expect, it } from "vitest";
import { validateGraph, type WorkflowDefinitionGraph } from "@kabosh-digital/workflow-types";
import { getStepCatalog } from "@kabosh-digital/workflow-temporal/catalog";
import { invoiceChase, ironSparkWorkflows, quoteChase, reviewRequest, enquiryToReply, wireConnectors } from "../src/workflows";
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
  it("review request: asks after a day, nudges 3 days after that", () => {
    expect(cumulativeDays(reviewRequest, "send_review")).toBe(1);
    expect(cumulativeDays(reviewRequest, "send_reminder", ["decision_replied"])).toBe(4);
  });
});

describe("safety rules", () => {
  it("nothing but the acknowledgement is sent without a person approving it (enquiry workflow)", () => {
    const sends = enquiryToReply.nodes.filter((n) => n.stepKey === "sendEmail").map((n) => n.id);
    expect(sends.sort()).toEqual(["acknowledge", "send_reply"]);
    // the proposed reply is only reachable through the approval decision
    const into = enquiryToReply.edges.filter((e) => e.toNodeId === "send_reply");
    expect(into).toHaveLength(1);
    expect(into[0]!.fromNodeId).toBe("decision_approved");
    expect(into[0]!.condition).toMatchObject({ field: "approve_reply.approved", op: "eq", value: true });
  });
  it("the enquiry workflow only writes back to senders on the allowlist", () => {
    const to = enquiryToReply.edges.filter((e) => e.toNodeId === "acknowledge");
    expect(to).toHaveLength(1);
    expect(to[0]).toMatchObject({ fromNodeId: "decision_can_email", condition: { field: "log_enquiry.canEmail", op: "eq", value: true } });
    expect(enquiryToReply.edges.find((e) => e.fromNodeId === "decision_can_email" && !e.condition)!.toNodeId).toBe("log_not_emailed");
  });
  it("the inbox trigger is narrowed to the plus-alias, never the whole mailbox", () => {
    const wired = wireConnectors(enquiryToReply, { emailConnectorId: "conn_gmail", gmailAccount: "david8959@gmail.com" });
    const trigger = wired.nodes.find((n) => n.type === "TRIGGER")!;
    expect(trigger.config.query).toBe("in:inbox -from:me to:david8959+ironspark@gmail.com");
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
      const first = g.nodes.find((n) => n.stepKey === "sendEmail")!;
      expect(first.onFailureNodeId).toBeTruthy();
      expect(g.nodes.find((n) => n.id === first.onFailureNodeId)!.type).toBe("HUMAN_TASK");
    }
  });
  it("wiring the Gmail connector fills in every Gmail node and nothing else", () => {
    const wired = wireConnectors(invoiceChase, { emailConnectorId: "conn_gmail" });
    for (const n of wired.nodes) {
      const wantsEmail = n.stepKey === "sendEmail" || n.stepKey === "emailRead" || n.stepKey === "emailInbound";
      expect(n.config.connectorId, n.id).toBe(wantsEmail ? "conn_gmail" : undefined);
    }
    expect(wireConnectors(invoiceChase, {})).toBe(invoiceChase);
  });
});
