import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { createQuote, decideQuote, ensureAcceptToken, jobDurationMinutes, markQuoteSent, replaceQuoteLines } from "../src/domain/quotes";
import { activeHold, getJob, HOLD_DAYS, holdJobSlot, JobHoldError, listBusyWindows, releaseJobHold, scheduleJob } from "../src/domain/jobs";
import { BookingError, holdJobByLink, jobSlotPageData } from "../src/domain/booking";
import { reviewForTask } from "../src/domain/approvals";
import { confirmJobBookingImpl, getJobBookingImpl, releaseJobBookingImpl } from "../src/steps/impl";
import { jobBooking } from "../src/workflows";
import type { Actor } from "../src/domain/shared/actor";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const now = sydneyLocalToDate("2026-10-18T07:00")!; // a Sunday: the first offer is Monday
const MON_8 = sydneyLocalToDate("2026-10-19T08:00")!;
const testMode = { [TEST_MODE_CONTEXT_KEY]: true } as never;
const opts = (technicianIds = ["u_a"]) => ({ now, technicianIds });
const hour = (n: number) => 3_600_000 * n;

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await appDb.$disconnect();
});

/** An accepted quote with a job waiting for a day; returns the customer's link token. */
async function acceptedJob(labourHours = 3, name = "Pat Smith") {
  const client = await createClient({ type: "PERSON", name, email: `${name.split(" ")[0]!.toLowerCase()}@example.com`, preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(client.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const quote = await createQuote({ clientId: client.id, siteId: site.id, title: "Switchboard upgrade" }, priya);
  await replaceQuoteLines(quote.id, [{ description: "Electrician", quantity: labourHours, unit: "hour", unitPriceCents: 11000 }, { description: "Materials", quantity: 1, unit: "each", unitPriceCents: 50000 }], priya);
  await markQuoteSent(quote.id, priya);
  const token = (await ensureAcceptToken(quote.id))!;
  const { job } = await decideQuote(quote.id, "APPROVED", "Accepted", priya);
  return { client, quote, job: job!, token };
}

describe("how long a job takes", () => {
  it("is the quote's labour hours, kept to a working day, and three hours when it has none", () => {
    expect(jobDurationMinutes([{ unit: "hour", quantity: 4 }, { unit: "each", quantity: 6 }])).toBe(240);
    expect(jobDurationMinutes([{ unit: "hour", quantity: 1.5 }, { unit: "hour", quantity: 2 }])).toBe(210);
    expect(jobDurationMinutes([{ unit: "hour", quantity: 20 }])).toBe(480);
    expect(jobDurationMinutes([{ unit: "hour", quantity: 0.25 }])).toBe(60);
    expect(jobDurationMinutes([{ unit: "each", quantity: 6 }])).toBe(180);
  });
});

describe("holding the customer's day", () => {
  const slot = { userId: "u_a", start: MON_8, end: new Date(MON_8.getTime() + hour(3)) };
  it("holds the time on the job and blocks that technician's calendar", async () => {
    const { job } = await acceptedJob();
    const { job: held, fresh } = await holdJobSlot(job.id, slot, priya, "Test Tech");
    expect(fresh).toBe(true);
    expect(held.status).toBe("UNSCHEDULED");
    expect(activeHold(held)).toMatchObject({ userId: "u_a", start: MON_8 });
    const busy = await listBusyWindows(new Date(MON_8.getTime() - hour(1)), new Date(MON_8.getTime() + hour(6)));
    expect(busy).toEqual([{ userId: "u_a", start: MON_8, end: slot.end }]);
  });
  it("moves the hold when the customer picks again, and only the first pick is fresh", async () => {
    const { job } = await acceptedJob();
    await holdJobSlot(job.id, slot, priya, "Test Tech");
    const later = { userId: "u_a", start: new Date(MON_8.getTime() + hour(24)), end: new Date(MON_8.getTime() + hour(27)) };
    const again = await holdJobSlot(job.id, later, priya, "Test Tech");
    expect(again.fresh).toBe(false);
    expect(activeHold(again.job)!.start).toEqual(later.start);
  });
  it("lets a hold lapse after a few days", async () => {
    const { job } = await acceptedJob();
    await holdJobSlot(job.id, slot, priya, "Test Tech");
    await appDb.job.update({ where: { id: job.id }, data: { requestedAt: new Date(Date.now() - (HOLD_DAYS + 1) * 86_400_000) } });
    expect(activeHold((await getJob(job.id))!)).toBeNull();
    expect(await listBusyWindows(new Date(MON_8.getTime() - hour(1)), new Date(MON_8.getTime() + hour(6)))).toEqual([]);
  });
  it("refuses a time another job or hold already has", async () => {
    const a = await acceptedJob(3, "Pat Smith");
    const b = await acceptedJob(3, "Sam Lee");
    await holdJobSlot(a.job.id, slot, priya, "Test Tech");
    await expect(holdJobSlot(b.job.id, { ...slot, start: new Date(MON_8.getTime() + hour(1)) }, priya, "Test Tech")).rejects.toBeInstanceOf(JobHoldError);
    await scheduleJob(a.job.id, { assignedUserId: "u_a", start: MON_8, end: slot.end }, priya, "Test Tech");
    await expect(holdJobSlot(b.job.id, slot, priya, "Test Tech")).rejects.toBeInstanceOf(JobHoldError);
  });
  it("is cleared when the office schedules the job itself", async () => {
    const { job } = await acceptedJob();
    await holdJobSlot(job.id, slot, priya, "Test Tech");
    const other = new Date(MON_8.getTime() + hour(48));
    const scheduled = await scheduleJob(job.id, { assignedUserId: "u_a", start: other, end: new Date(other.getTime() + hour(3)) }, priya, "Test Tech");
    expect(scheduled).toMatchObject({ status: "SCHEDULED", requestedStart: null, requestedUserId: null });
  });
  it("can be released", async () => {
    const { job } = await acceptedJob();
    await holdJobSlot(job.id, slot, priya, "Test Tech");
    expect(activeHold(await releaseJobHold(job.id, priya))).toBeNull();
  });
});

describe("the customer's day-picking page", () => {
  it("offers free days sized to the job, then shows the held day", async () => {
    const { token } = await acceptedJob(4);
    const before = (await jobSlotPageData(token, opts()))!;
    expect(before.state).toBe("pick");
    expect(before.durationMinutes).toBe(240);
    expect(before.days[0]!.day).toBe("2026-10-19");
    const latestStart = Math.max(...before.days[0]!.slots.map((s) => s.start.getTime()));
    expect(latestStart).toBe(sydneyLocalToDate("2026-10-19T12:00")!.getTime()); // a 4 hour job must start by noon to finish by 4pm
    await holdJobByLink(token, MON_8.toISOString(), opts());
    const after = (await jobSlotPageData(token, opts()))!;
    expect(after.state).toBe("held");
    expect(after.when).toContain("8:00 am");
  });
  it("takes a held day off the next customer's calendar", async () => {
    const a = await acceptedJob(3, "Pat Smith");
    const b = await acceptedJob(3, "Sam Lee");
    await holdJobByLink(a.token, MON_8.toISOString(), opts());
    const page = (await jobSlotPageData(b.token, opts()))!;
    const offered = page.days.flatMap((d) => d.slots).map((s) => s.start.getTime());
    expect(offered).not.toContain(MON_8.getTime());
    await expect(holdJobByLink(b.token, MON_8.toISOString(), opts())).rejects.toBeInstanceOf(BookingError);
  });
  it("only works for an accepted quote, and shows the confirmed time once booked", async () => {
    expect(await jobSlotPageData("not-a-real-token-at-all", opts())).toBeNull();
    const { token, job } = await acceptedJob();
    await scheduleJob(job.id, { assignedUserId: "u_a", start: MON_8, end: new Date(MON_8.getTime() + hour(3)) }, priya, "Test Tech");
    expect(await jobSlotPageData(token, opts())).toMatchObject({ state: "booked" });
    await expect(holdJobByLink(token, MON_8.toISOString(), opts())).rejects.toThrow(/already has a confirmed time/);
  });
});

describe("the booking steps", () => {
  it("reads the job and the time asked for", async () => {
    const { token, job } = await acceptedJob();
    await holdJobByLink(token, MON_8.toISOString(), opts());
    const out = (await getJobBookingImpl({ params: { jobId: job.id } }, {} as never)) as Record<string, unknown>;
    expect(out).toMatchObject({ jobNumber: job.number, clientFirstName: "Pat", hasHold: true, addressText: "12 Wattle Cres, Newtown NSW 2042" });
    expect(out.requestedText).toContain("8:00 am");
    expect(String(out.acceptUrl)).toContain(`/accept/${token}`);
  });
  it("confirming schedules the job for the held time and clears the hold", async () => {
    const { token, job } = await acceptedJob();
    await holdJobByLink(token, MON_8.toISOString(), opts());
    const out = (await confirmJobBookingImpl({ params: { jobId: job.id } }, {} as never)) as { confirmed: boolean };
    expect(out.confirmed).toBe(true);
    const saved = (await getJob(job.id))!;
    expect(saved).toMatchObject({ status: "SCHEDULED", assignedUserId: "u_a", requestedStart: null });
    expect(saved.scheduledStart).toEqual(MON_8);
  });
  it("says why, instead of failing, when there is no held time to confirm", async () => {
    const { job } = await acceptedJob();
    expect(await confirmJobBookingImpl({ params: { jobId: job.id } }, {} as never)).toMatchObject({ confirmed: false, reason: expect.stringMatching(/no held time/) });
  });
  it("releasing frees the time", async () => {
    const { token, job } = await acceptedJob();
    await holdJobByLink(token, MON_8.toISOString(), opts());
    await releaseJobBookingImpl({ params: { jobId: job.id } }, {} as never);
    expect(activeHold((await getJob(job.id))!)).toBeNull();
  });
  it("changes nothing in a test run", async () => {
    const { token, job } = await acceptedJob();
    await holdJobByLink(token, MON_8.toISOString(), opts());
    expect(await confirmJobBookingImpl({ params: { jobId: job.id } }, testMode)).toMatchObject({ confirmed: true, simulated: true });
    expect(await releaseJobBookingImpl({ params: { jobId: job.id } }, testMode)).toMatchObject({ released: true, simulated: true });
    expect(activeHold((await getJob(job.id))!)).not.toBeNull();
  });
});

describe("what the office approves", () => {
  const task = (jobId: string) => ({ input: { reviewsNodeId: "confirm" }, instance: { context: { trigger: { jobId } }, definition: { graph: jobBooking, publishedGraph: null } } });
  it("shows the job, the day the customer chose and who would go", async () => {
    const { token, job } = await acceptedJob();
    await holdJobByLink(token, MON_8.toISOString(), opts());
    const review = await reviewForTask(task(job.id));
    expect(review).toMatchObject({ kind: "booking", jobNumber: job.number, clientName: "Pat Smith", address: "12 Wattle Cres, Newtown NSW 2042", problem: null });
    expect((review as { requestedText: string }).requestedText).toContain("8:00 am");
  });
  it("warns when the time is no longer held", async () => {
    const { job } = await acceptedJob();
    expect(await reviewForTask(task(job.id))).toMatchObject({ kind: "booking", problem: expect.stringMatching(/no longer held/) });
  });
});
