import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { changeStatus, createRequest, getRequest } from "../src/domain/requests";
import { createQuote } from "../src/domain/quotes";
import {
  bookSiteVisit,
  cancelSiteVisit,
  completeSiteVisit,
  latestCompletedVisit,
  listVisitsForRequest,
  listVisitsForTechnician,
  SiteVisitAccessError,
  SiteVisitConflictError,
  weekVisits,
} from "../src/domain/siteVisits";
import { listEntityTimeline } from "../src/domain/activity";
import type { Actor } from "../src/domain/shared/actor";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const jordan: Actor = { type: "USER", userId: "u_jordan", label: "Jordan Lee" };
const at = (local: string) => sydneyLocalToDate(local)!;

beforeEach(truncateAll);
afterAll(async () => {
  await appDb.$disconnect();
});

async function setup(linked = true) {
  const client = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(client.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const request = await createRequest({ summary: "Rewire the kitchen", category: "QUOTE_REQUEST", ...(linked ? { clientId: client.id, siteId: site.id } : {}) }, priya);
  return { client, site, request };
}

const slot = { assignedUserId: "u_jordan", start: at("2026-10-20T09:00"), end: at("2026-10-20T10:00") };

describe("booking a site visit", () => {
  it("books the visit, moves the enquiry to Site visit booked and writes the history", async () => {
    const { request } = await setup();
    const visit = await bookSiteVisit(request.id, slot, priya, "Jordan Lee");
    expect(visit.status).toBe("SCHEDULED");
    expect((await getRequest(request.id))!.status).toBe("SITE_VISIT_BOOKED");
    const history = await listEntityTimeline("request", request.id);
    expect(history.some((e) => e.summary.startsWith("Site visit booked for"))).toBe(true);
  });
  it("moves the booked visit instead of adding a second one", async () => {
    const { request } = await setup();
    const first = await bookSiteVisit(request.id, slot, priya, "Jordan Lee");
    const moved = await bookSiteVisit(request.id, { ...slot, start: at("2026-10-21T13:00"), end: at("2026-10-21T14:00") }, priya, "Jordan Lee");
    expect(moved.id).toBe(first.id);
    expect(await listVisitsForRequest(request.id)).toHaveLength(1);
  });
  it("needs a linked client", async () => {
    const { request } = await setup(false);
    await expect(bookSiteVisit(request.id, slot, priya, "Jordan Lee")).rejects.toThrow(/Link this enquiry/);
  });
  it("is refused once the enquiry has been quoted", async () => {
    const { client, request } = await setup();
    await changeStatus(request.id, "QUOTED", {}, priya);
    await expect(bookSiteVisit(request.id, slot, priya, "Jordan Lee")).rejects.toThrow(/not been quoted/);
    expect(client.id).toBeTruthy();
  });
  it("warns when the technician is already booked, and books over it only when told to", async () => {
    const a = await setup();
    const b = await setup();
    await bookSiteVisit(a.request.id, slot, priya, "Jordan Lee");
    await expect(bookSiteVisit(b.request.id, { ...slot, start: at("2026-10-20T09:30"), end: at("2026-10-20T10:30") }, priya, "Jordan Lee")).rejects.toBeInstanceOf(SiteVisitConflictError);
    const forced = await bookSiteVisit(b.request.id, { ...slot, start: at("2026-10-20T09:30"), end: at("2026-10-20T10:30"), allowConflict: true }, priya, "Jordan Lee");
    expect(forced.status).toBe("SCHEDULED");
  });
  it("rejects a visit longer than a working day", async () => {
    const { request } = await setup();
    await expect(bookSiteVisit(request.id, { ...slot, end: at("2026-10-20T19:00") }, priya, "Jordan Lee")).rejects.toThrow(/8 hours/);
  });
});

describe("finishing and cancelling", () => {
  it("records the findings, which the quote can start from", async () => {
    const { request } = await setup();
    const visit = await bookSiteVisit(request.id, slot, priya, "Jordan Lee");
    await completeSiteVisit(visit.id, "  Old fuse board, 3 circuits to add  ", jordan, { technicianUserId: "u_jordan" });
    const done = await latestCompletedVisit(request.id);
    expect(done?.findings).toBe("Old fuse board, 3 circuits to add");
    expect(done?.completedAt).toBeInstanceOf(Date);
  });
  it("needs findings, and only the booked technician can record them", async () => {
    const { request } = await setup();
    const visit = await bookSiteVisit(request.id, slot, priya, "Jordan Lee");
    await expect(completeSiteVisit(visit.id, "   ", priya)).rejects.toThrow();
    await expect(completeSiteVisit(visit.id, "Looks fine", { type: "USER", userId: "u_mia", label: "Mia" }, { technicianUserId: "u_mia" })).rejects.toBeInstanceOf(SiteVisitAccessError);
    await completeSiteVisit(visit.id, "Looks fine", priya); // the office may record on their behalf
    await expect(completeSiteVisit(visit.id, "Again", priya)).rejects.toThrow(/cannot be completed/);
  });
  it("puts the enquiry back to Contacted when the only visit is cancelled", async () => {
    const { request } = await setup();
    const visit = await bookSiteVisit(request.id, slot, priya, "Jordan Lee");
    await cancelSiteVisit(visit.id, priya);
    expect((await getRequest(request.id))!.status).toBe("CONTACTED");
    await expect(cancelSiteVisit(visit.id, priya)).rejects.toThrow(/cannot be cancelled/);
  });
  it("leaves the quote path open: a quote can follow the visit", async () => {
    const { client, request } = await setup();
    const visit = await bookSiteVisit(request.id, slot, priya, "Jordan Lee");
    await completeSiteVisit(visit.id, "Needs a new board", priya);
    const quote = await createQuote({ clientId: client.id, requestId: request.id, title: "Rewire the kitchen" }, priya);
    expect(quote.requestId).toBe(request.id);
  });
});

describe("who sees what", () => {
  it("shows a technician only their own visits, and the week to the office", async () => {
    const a = await setup();
    const b = await setup();
    await bookSiteVisit(a.request.id, slot, priya, "Jordan Lee");
    await bookSiteVisit(b.request.id, { assignedUserId: "u_mia", start: at("2026-10-20T11:00"), end: at("2026-10-20T12:00") }, priya, "Mia Chen");
    const mine = await listVisitsForTechnician("u_jordan", "2026-10-19", 7);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.request.client?.name).toBe("Pat Smith");
    expect(await weekVisits("2026-10-19")).toHaveLength(2);
    expect(await listVisitsForTechnician("u_jordan", "2026-10-26", 7)).toHaveLength(0);
  });
});
