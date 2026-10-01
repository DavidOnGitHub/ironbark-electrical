import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { createClient, addSite } from "../src/domain/clients";
import { createRequest, changeStatus as changeRequestStatus, getRequest } from "../src/domain/requests";
import { createPriceItem, listPriceItems, setPriceItemActive, updatePriceItem } from "../src/domain/pricing";
import { createQuote, decideQuote, extendQuoteValidity, getQuote, listQuotes, markQuoteSent, openQuoteStats, QuoteDecisionError, replaceQuoteLines } from "../src/domain/quotes";
import {
  addJobNote,
  approveVariation,
  changeJobStatus,
  countJobsByStatus,
  getJob,
  getJobForTechnician,
  JobAccessError,
  listJobsForTechnician,
  scheduleJob,
  ScheduleConflictError,
  unscheduleJob,
  weekSchedule,
} from "../src/domain/jobs";
import { listClientTimeline } from "../src/domain/activity";
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

async function setup() {
  const client = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(client.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const request = await createRequest({ summary: "Install 6 downlights", category: "NEW_INSTALL", clientId: client.id, siteId: site.id }, priya);
  return { client, site, request };
}

async function sentQuote(requestId: string | undefined, clientId: string, siteId: string, lines: { unitPriceCents: number; quantity?: number }[] = [{ unitPriceCents: 100000 }]) {
  const q = await createQuote({ clientId, siteId, requestId, title: "Downlights" }, priya);
  await replaceQuoteLines(q.id, lines.map((l, i) => ({ description: `Line ${i + 1}`, quantity: l.quantity ?? 1, unitPriceCents: l.unitPriceCents })), priya);
  await markQuoteSent(q.id, priya);
  return q.id;
}

describe("price list", () => {
  it("derives a material's price from cost and markup, and keeps other kinds as entered", async () => {
    const m = await createPriceItem({ kind: "MATERIAL", name: "LED downlight 10W", unit: "each", costCents: 1000, markupPct: 40 }, priya);
    expect(m).toMatchObject({ costCents: 1000, markupPct: 40, priceCents: 1400 });
    const l = await createPriceItem({ kind: "LABOUR", name: "Electrician", unit: "hour", priceCents: 11000 }, priya);
    expect(l).toMatchObject({ priceCents: 11000, costCents: null, markupPct: null });
    const updated = await updatePriceItem(m.id, { kind: "MATERIAL", name: "LED downlight 10W", unit: "each", costCents: 1000, markupPct: 50 }, priya);
    expect(updated.priceCents).toBe(1500);
  });
  it("requires a price and a name", async () => {
    await expect(createPriceItem({ kind: "LABOUR", name: "x", unit: "hour" }, priya)).rejects.toThrow(/price is required/i);
    await expect(createPriceItem({ kind: "LABOUR", name: " ", unit: "hour", priceCents: 100 }, priya)).rejects.toThrow(/Name is required/);
  });
  it("retired items drop out of the active list", async () => {
    const a = await createPriceItem({ kind: "LABOUR", name: "A", unit: "hour", priceCents: 100 }, priya);
    await createPriceItem({ kind: "LABOUR", name: "B", unit: "hour", priceCents: 100 }, priya);
    await setPriceItemActive(a.id, false, priya);
    expect((await listPriceItems({ activeOnly: true })).map((i) => i.name)).toEqual(["B"]);
    expect(await listPriceItems()).toHaveLength(2);
  });
});

describe("quotes", () => {
  it("numbers quotes in sequence and computes totals, GST and the deposit rule", async () => {
    const { client, site } = await setup();
    const q1 = await createQuote({ clientId: client.id, siteId: site.id, title: "A" }, priya);
    const q2 = await createQuote({ clientId: client.id, title: "B" }, priya);
    expect([q1.number, q2.number]).toEqual(["Q-1001", "Q-1002"]);
    const small = await replaceQuoteLines(q1.id, [{ description: "Call-out", quantity: 1, unitPriceCents: 9500 }, { description: "Labour", quantity: 2.5, unitPriceCents: 11000 }], priya);
    expect(small).toMatchObject({ subtotalCents: 37000, gstCents: 3700, totalCents: 40700, depositRequired: false, depositCents: 0 });
    const big = await replaceQuoteLines(q2.id, [{ description: "Switchboard upgrade", quantity: 1, unitPriceCents: 200000 }], priya);
    expect(big).toMatchObject({ totalCents: 220000, depositRequired: true, depositPct: 30, depositCents: 66000 });
    const loaded = await getQuote(q1.id);
    expect(loaded?.lines.map((l) => [l.description, Number(l.quantity), l.lineTotalCents])).toEqual([["Call-out", 1, 9500], ["Labour", 2.5, 27500]]);
  });

  it("validates lines and refuses to send an empty quote", async () => {
    const { client } = await setup();
    const q = await createQuote({ clientId: client.id, title: "Empty" }, priya);
    await expect(replaceQuoteLines(q.id, [{ description: " ", quantity: 1, unitPriceCents: 100 }], priya)).rejects.toThrow(/description/);
    await expect(replaceQuoteLines(q.id, [{ description: "x", quantity: 0, unitPriceCents: 100 }], priya)).rejects.toThrow(/more than zero/);
    await expect(markQuoteSent(q.id, priya)).rejects.toThrow(/at least one priced line/);
  });

  it("sending moves the enquiry to Quoted and locks the quote for editing", async () => {
    const { client, site, request } = await setup();
    const id = await sentQuote(request.id, client.id, site.id);
    expect((await getRequest(request.id))?.status).toBe("QUOTED");
    const q = await getQuote(id);
    expect(q?.status).toBe("SENT");
    expect(q?.validUntil.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    await expect(replaceQuoteLines(id, [{ description: "x", quantity: 1, unitPriceCents: 1 }], priya)).rejects.toThrow(/Only a draft/);
    await expect(markQuoteSent(id, priya)).rejects.toThrow(/Only a draft/);
  });

  it("approving creates the job in the same step, marks the enquiry Won and records everything", async () => {
    const { client, site, request } = await setup();
    const id = await sentQuote(request.id, client.id, site.id, [{ unitPriceCents: 150000 }]);
    const { quote, job } = await decideQuote(id, "APPROVED", "Reply by email", priya);
    expect(quote.status).toBe("APPROVED");
    expect(job).toMatchObject({ number: "J-2001", status: "UNSCHEDULED", quotedSubtotalCents: 150000, clientId: client.id, siteId: site.id, quoteId: id });
    expect((await getRequest(request.id))?.status).toBe("WON");
    const kinds = (await listClientTimeline(client.id)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["CREATED", "SENT", "APPROVED"]));
    await expect(decideQuote(id, "APPROVED", undefined, priya)).rejects.toBeInstanceOf(QuoteDecisionError);
  });

  it("declining creates no job", async () => {
    const { client, site, request } = await setup();
    const id = await sentQuote(request.id, client.id, site.id);
    const { quote, job } = await decideQuote(id, "DECLINED", "Too expensive", priya);
    expect(quote).toMatchObject({ status: "DECLINED", decisionNote: "Too expensive" });
    expect(job).toBeNull();
    expect(await appDb.job.count()).toBe(0);
    expect((await getRequest(request.id))?.status).toBe("QUOTED");
  });

  it("an expired quote cannot be decided until its validity is extended", async () => {
    const { client, site } = await setup();
    const id = await sentQuote(undefined, client.id, site.id);
    await appDb.quote.update({ where: { id }, data: { validUntil: new Date(Date.now() - 86_400_000) } });
    expect((await getQuote(id))?.effectiveStatus).toBe("EXPIRED");
    expect((await listQuotes({ status: "EXPIRED" })).map((q) => q.id)).toEqual([id]);
    expect(await listQuotes({ status: "SENT" })).toEqual([]);
    await expect(decideQuote(id, "APPROVED", undefined, priya)).rejects.toThrow(/expired/);
    await extendQuoteValidity(id, 7, priya);
    expect((await getQuote(id))?.effectiveStatus).toBe("SENT");
    expect((await decideQuote(id, "APPROVED", undefined, priya)).job?.number).toBe("J-2001");
  });

  it("does not break approval when the enquiry cannot move to Won", async () => {
    const { client, site, request } = await setup();
    await changeRequestStatus(request.id, "LOST", { lostReason: "x" }, priya);
    const q = await createQuote({ clientId: client.id, siteId: site.id, requestId: request.id, title: "Late" }, priya);
    await replaceQuoteLines(q.id, [{ description: "x", quantity: 1, unitPriceCents: 5000 }], priya);
    await markQuoteSent(q.id, priya);
    expect((await decideQuote(q.id, "APPROVED", undefined, priya)).quote.status).toBe("APPROVED");
    expect((await getRequest(request.id))?.status).toBe("LOST");
  });

  it("reports open quote totals for the dashboard", async () => {
    const { client, site } = await setup();
    await sentQuote(undefined, client.id, site.id, [{ unitPriceCents: 10000 }]);
    await sentQuote(undefined, client.id, site.id, [{ unitPriceCents: 20000 }]);
    expect(await openQuoteStats()).toEqual({ count: 2, totalCents: 33000 });
  });
});

async function approvedJob() {
  const { client, site, request } = await setup();
  const id = await sentQuote(request.id, client.id, site.id, [{ unitPriceCents: 80000 }]);
  const { job } = await decideQuote(id, "APPROVED", undefined, priya);
  return { client, site, job: job! };
}

describe("jobs", () => {
  it("schedules a job to a technician and warns about overlaps unless allowed", async () => {
    const { job } = await approvedJob();
    const s = await scheduleJob(job.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T12:00") }, priya, "Jordan Lee");
    expect(s).toMatchObject({ status: "SCHEDULED", assignedUserId: "u_jordan" });

    const { job: second } = await approvedJob();
    const clash = { assignedUserId: "u_jordan", start: at("2026-10-05T11:00"), end: at("2026-10-05T13:00") };
    await expect(scheduleJob(second.id, clash, priya, "Jordan Lee")).rejects.toBeInstanceOf(ScheduleConflictError);
    await expect(scheduleJob(second.id, { ...clash, assignedUserId: "u_mia" }, priya, "Mia Chen")).resolves.toBeTruthy(); // another technician is free
    await expect(scheduleJob(second.id, { ...clash, allowConflict: true, assignedUserId: "u_jordan" }, priya, "Jordan Lee")).resolves.toBeTruthy();
    await expect(scheduleJob(second.id, { assignedUserId: "u_jordan", start: at("2026-10-05T13:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee")).rejects.toThrow(/end must be after/);
    // back-to-back is not a clash
    const { job: third } = await approvedJob();
    await expect(scheduleJob(third.id, { assignedUserId: "u_jordan", start: at("2026-10-05T12:00"), end: at("2026-10-05T14:00") }, priya, "Jordan Lee")).rejects.toBeInstanceOf(ScheduleConflictError); // overlaps second's 11-13 booking
    await expect(scheduleJob(third.id, { assignedUserId: "u_jordan", start: at("2026-10-05T13:00"), end: at("2026-10-05T15:00") }, priya, "Jordan Lee")).resolves.toBeTruthy();
  });

  it("follows the status flow and refuses invalid moves", async () => {
    const { job } = await approvedJob();
    await expect(changeJobStatus(job.id, "COMPLETED", priya)).rejects.toThrow(/cannot move/);
    await scheduleJob(job.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee");
    await changeJobStatus(job.id, "IN_PROGRESS", priya);
    const done = await changeJobStatus(job.id, "COMPLETED", priya);
    expect(done.startedAt).toBeTruthy();
    expect(done.completedAt).toBeTruthy();
    await expect(changeJobStatus(job.id, "IN_PROGRESS", priya)).rejects.toThrow(/cannot move/);
    await expect(unscheduleJob(job.id, priya)).rejects.toThrow(/Only a scheduled job/);
  });

  it("unscheduling clears the slot and the technician", async () => {
    const { job } = await approvedJob();
    await scheduleJob(job.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee");
    const u = await unscheduleJob(job.id, priya);
    expect(u).toMatchObject({ status: "UNSCHEDULED", assignedUserId: null, scheduledStart: null });
  });

  it("scopes technicians to their own jobs and to field moves", async () => {
    const { job } = await approvedJob();
    await scheduleJob(job.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee");
    expect(await getJobForTechnician("u_mia", job.id)).toBeNull();
    expect((await getJobForTechnician("u_jordan", job.id))?.number).toBe(job.number);
    await expect(changeJobStatus(job.id, "IN_PROGRESS", { type: "USER", userId: "u_mia", label: "Mia" }, { technicianUserId: "u_mia" })).rejects.toBeInstanceOf(JobAccessError);
    await expect(addJobNote(job.id, { text: "hi" }, { type: "USER", userId: "u_mia", label: "Mia" }, { technicianUserId: "u_mia" })).rejects.toBeInstanceOf(JobAccessError);
    await changeJobStatus(job.id, "IN_PROGRESS", jordan, { technicianUserId: "u_jordan" });
    await expect(changeJobStatus(job.id, "INVOICED", jordan, { technicianUserId: "u_jordan" })).rejects.toThrow(/cannot move/);
  });

  it("never exposes prices to a technician", async () => {
    const { job } = await approvedJob();
    await scheduleJob(job.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee");
    const view = await getJobForTechnician("u_jordan", job.id);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/Cents|quote|total|price/i);
    expect(view?.site?.accessNotes).toBeNull(); // no notes seeded; the field is present for the technician
    const list = await listJobsForTechnician("u_jordan", "2026-10-05", 7);
    expect(JSON.stringify(list)).not.toMatch(/Cents|quote|total|price/i);
  });

  it("lists a technician's week plus anything in progress, and the week schedule with the unscheduled queue", async () => {
    const { job: a } = await approvedJob();
    const { job: b } = await approvedJob();
    await approvedJob(); // stays unscheduled
    await scheduleJob(a.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee");
    await scheduleJob(b.id, { assignedUserId: "u_jordan", start: at("2026-10-20T09:00"), end: at("2026-10-20T11:00") }, priya, "Jordan Lee");
    expect((await listJobsForTechnician("u_jordan", "2026-10-05", 7)).map((j) => j.number)).toEqual([a.number]);
    await changeJobStatus(b.id, "IN_PROGRESS", priya); // in progress shows regardless of date
    expect((await listJobsForTechnician("u_jordan", "2026-10-05", 7)).map((j) => j.number).sort()).toEqual([a.number, b.number].sort());
    const week = await weekSchedule("2026-10-05");
    expect(week.scheduled.map((j) => j.number)).toEqual([a.number]);
    expect(week.unscheduled).toHaveLength(1);
    expect(await countJobsByStatus()).toMatchObject({ UNSCHEDULED: 1, SCHEDULED: 1, IN_PROGRESS: 1 });
  });

  it("records notes and variations, and only approved variations are marked so", async () => {
    const { job } = await approvedJob();
    await scheduleJob(job.id, { assignedUserId: "u_jordan", start: at("2026-10-05T09:00"), end: at("2026-10-05T11:00") }, priya, "Jordan Lee");
    await addJobNote(job.id, { text: "Old wiring behind the wall" }, jordan, { technicianUserId: "u_jordan" });
    await expect(addJobNote(job.id, { text: "Extra circuit", kind: "VARIATION" }, jordan, { technicianUserId: "u_jordan" })).rejects.toThrow(/extra amount/);
    const v = await addJobNote(job.id, { text: "Extra circuit", kind: "VARIATION", extraCents: 18000 }, jordan, { technicianUserId: "u_jordan" });
    expect(v).toMatchObject({ kind: "VARIATION", extraCents: 18000, approved: false });
    const approved = await approveVariation(v.id, true, priya);
    expect(approved).toMatchObject({ approved: true, approvedByUserId: "u_priya" });
    await expect(approveVariation((await getJob(job.id))!.notes.find((n) => n.kind === "NOTE")!.id, true, priya)).rejects.toThrow(/Only a variation/);
  });
});
