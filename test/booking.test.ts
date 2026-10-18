import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, UserRole } from "@kabosh-digital/workflow-schema";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { changeStatus, createRequest, getRequest } from "../src/domain/requests";
import { BookingError, bookByLink, bookingPageData, bookingUrlForRequest } from "../src/domain/booking";
import { listVisitsForRequest } from "../src/domain/siteVisits";
import type { Actor } from "../src/domain/shared/actor";
import { sydneyLocalToDate } from "../src/lib/tz";
import { buildReview } from "../src/domain/approvals/review";
import { ensureDefaultTemplates, renderTemplate } from "../src/domain/emailTemplates";
import { enquiryToReply } from "../src/workflows/enquiryToReply";
import { createEnquiryImpl } from "../src/steps/impl";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const now = sydneyLocalToDate("2026-10-18T07:00")!; // a Sunday: the first offer is Monday
const MON_9 = sydneyLocalToDate("2026-10-19T09:00")!;
const address = { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" };

let techs: string[] = [];
const created: string[] = [];

beforeAll(async () => {
  const stamp = Date.now();
  for (const name of ["Test Tech A", "Test Tech B"]) {
    const u = await prisma.user.create({ data: { email: `booking-${stamp}-${name.slice(-1)}@test.invalid`, name, roles: [UserRole.OPERATOR] } });
    created.push(u.id);
  }
  techs = [...created];
});
beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await appDb.$disconnect();
});

const opts = (technicianIds = techs) => ({ now, technicianIds });
async function newcomer(email = "pat@example.com") {
  const request = await createRequest({ summary: "Quote for a rewire", category: "QUOTE_REQUEST", source: "EMAIL", contactName: "Pat Smith", contactEmail: email }, { type: "WORKFLOW", label: "Enquiry to reply" });
  const url = await bookingUrlForRequest(request.id);
  return { request, token: url.split("/book/")[1]! };
}

describe("the pick-a-time link", () => {
  it("is the same link every time, and does not work for a guess", async () => {
    const { request, token } = await newcomer();
    expect(await bookingUrlForRequest(request.id)).toContain(`/book/${token}`);
    expect(await bookingPageData("not-a-real-token-at-all", opts())).toBeNull();
    expect(await bookingPageData("short", opts())).toBeNull();
  });
  it("offers only free times, asks for an address and phone when it has none", async () => {
    const { token } = await newcomer();
    const page = (await bookingPageData(token, opts()))!;
    expect(page.open).toBe(true);
    expect(page.needsAddress).toBe(true);
    expect(page.needsPhone).toBe(true);
    expect(page.days[0]!.day).toBe("2026-10-19");
    expect(page.days.flatMap((d) => d.slots).length).toBeGreaterThan(20);
  });
  it("books the visit, creates the client and site, and moves the enquiry on", async () => {
    const { request, token } = await newcomer();
    const { visit, techLabel } = await bookByLink(token, { start: MON_9.toISOString(), phone: "0412 345 678", address }, opts());
    expect(visit.scheduledStart).toEqual(MON_9);
    expect(visit.assignedUserId).toBe(techs[0]);
    expect(techLabel).toBe("Test Tech A");
    const after = (await getRequest(request.id))!;
    expect(after.status).toBe("SITE_VISIT_BOOKED");
    expect(after.client?.name).toBe("Pat Smith");
    expect(after.site?.suburb).toBe("Newtown");
    expect(after.contactPhone).toBe("0412 345 678");
  });
  it("needs an address for a new customer, and a phone number", async () => {
    const { token } = await newcomer();
    await expect(bookByLink(token, { start: MON_9.toISOString(), phone: "0412 345 678" }, opts())).rejects.toThrow();
    await expect(bookByLink(token, { start: MON_9.toISOString(), address }, opts())).rejects.toThrow(/phone/i);
  });
  it("does not ask a known customer with one site for anything", async () => {
    const client = await createClient({ type: "PERSON", name: "Sam Lee", email: "sam@example.com", phone: "0400 111 222", preferredContact: "EMAIL", tags: [] }, priya);
    const site = await addSite(client.id, address, priya);
    const request = await createRequest({ summary: "Fit a ceiling fan", source: "EMAIL", clientId: client.id, contactEmail: "sam@example.com" }, priya);
    const token = (await bookingUrlForRequest(request.id)).split("/book/")[1]!;
    const page = (await bookingPageData(token, opts()))!;
    expect(page).toMatchObject({ needsAddress: false, needsPhone: false });
    const { visit } = await bookByLink(token, { start: MON_9.toISOString() }, opts());
    expect(visit.status).toBe("SCHEDULED");
    expect((await getRequest(request.id))!.siteId).toBe(site.id);
  });
  it("uses the second technician for the same time, then says it is taken", async () => {
    const first = await newcomer("one@example.com");
    const second = await newcomer("two@example.com");
    const third = await newcomer("three@example.com");
    await bookByLink(first.token, { start: MON_9.toISOString(), phone: "0411", address }, opts());
    const b = await bookByLink(second.token, { start: MON_9.toISOString(), phone: "0422", address }, opts());
    expect(b.visit.assignedUserId).toBe(techs[1]);
    await expect(bookByLink(third.token, { start: MON_9.toISOString(), phone: "0433", address }, opts())).rejects.toBeInstanceOf(BookingError);
  });
  it("no longer offers a booked time to the next customer when there is one technician", async () => {
    const first = await newcomer("one@example.com");
    const second = await newcomer("two@example.com");
    await bookByLink(first.token, { start: MON_9.toISOString(), phone: "0411", address }, opts([techs[0]!]));
    const page = (await bookingPageData(second.token, opts([techs[0]!])))!;
    const offered = page.days.flatMap((d) => d.slots).map((s) => s.start.getTime());
    expect(offered).not.toContain(MON_9.getTime());
    expect(offered).not.toContain(MON_9.getTime() + 3_600_000); // the travel buffer
    await expect(bookByLink(second.token, { start: MON_9.toISOString(), phone: "0422", address }, opts([techs[0]!]))).rejects.toThrow(/taken/);
  });
  it("lets the customer move their visit from the same link", async () => {
    const { request, token } = await newcomer();
    await bookByLink(token, { start: MON_9.toISOString(), phone: "0412", address }, opts());
    const later = sydneyLocalToDate("2026-10-20T13:00")!;
    await bookByLink(token, { start: later.toISOString() }, opts());
    const visits = await listVisitsForRequest(request.id);
    expect(visits).toHaveLength(1);
    expect(visits[0]!.scheduledStart).toEqual(later);
    expect((await bookingPageData(token, opts()))!.booked?.scheduledStart).toEqual(later);
  });
  it("closes once the enquiry has been quoted", async () => {
    const { request, token } = await newcomer();
    await changeStatus(request.id, "QUOTED", {}, priya);
    expect((await bookingPageData(token, opts()))!.open).toBe(false);
    await expect(bookByLink(token, { start: MON_9.toISOString(), phone: "0412", address }, opts())).rejects.toBeInstanceOf(BookingError);
  });
});

describe("the enquiry reply", () => {
  it("carries the link: the step creates it and the office sees it in the approval", async () => {
    await ensureDefaultTemplates();
    const out = (await createEnquiryImpl({ params: { from: "Pat Smith <pat@example.com>", summary: "Quote for a rewire", category: "QUOTE_REQUEST", urgency: "ROUTINE" } }, { trigger: {} } as never)) as { requestId: string; bookingUrl: string };
    expect(out.bookingUrl).toMatch(/\/book\/[\w-]{20,}$/);
    expect(await bookingUrlForRequest(out.requestId)).toBe(out.bookingUrl);
    const context = { trigger: { from: "Pat Smith <pat@example.com>", subject: "Rewire", message_id: "m1" }, triage: { replyDraft: "Hi Pat,\n\nWe can come and have a look." }, log_enquiry: out };
    const graph = enquiryToReply as unknown as { nodes: { id: string; label?: string; stepKey?: string; config?: Record<string, unknown> }[] };
    const review = await buildReview(graph.nodes, "send_reply", context, renderTemplate);
    expect(review).toMatchObject({ kind: "email", to: "Pat Smith <pat@example.com>" });
    expect((review as { text: string }).text).toContain(out.bookingUrl);
    expect((review as { text: string }).text).toContain("Kind regards");
  });
});
