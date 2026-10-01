import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { createRequest } from "../src/domain/requests";
import { createQuote, decideQuote, markQuoteSent, replaceQuoteLines } from "../src/domain/quotes";
import { addJobNote, approveVariation, changeJobStatus, getJob, listJobsReadyToInvoice, scheduleJob } from "../src/domain/jobs";
import {
  createInvoiceFromJob,
  depositStatus,
  getInvoice,
  invoicesCsv,
  issueInvoice,
  listInvoices,
  receivablesSummary,
  recordDeposit,
  recordPayment,
  replaceInvoiceLines,
  voidInvoice,
} from "../src/domain/invoicing";
import { listEntityTimeline } from "../src/domain/activity";
import type { Actor } from "../src/domain/shared/actor";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const jordan: Actor = { type: "USER", userId: "u_jordan", label: "Jordan Lee" };

beforeEach(truncateAll);
afterAll(async () => {
  await appDb.$disconnect();
});

/** A job taken all the way to Completed, from a quote of the given lines. */
async function completedJob(lines: { description?: string; quantity?: number; unitPriceCents: number }[] = [{ unitPriceCents: 100000 }], name = "Pat Smith") {
  const client = await createClient({ type: "PERSON", name, preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(client.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const request = await createRequest({ summary: "Job", clientId: client.id, siteId: site.id }, priya);
  const q = await createQuote({ clientId: client.id, siteId: site.id, requestId: request.id, title: "The work" }, priya);
  await replaceQuoteLines(q.id, lines.map((l, i) => ({ description: l.description ?? `Line ${i + 1}`, quantity: l.quantity ?? 1, unitPriceCents: l.unitPriceCents })), priya);
  await markQuoteSent(q.id, priya);
  const { job } = await decideQuote(q.id, "APPROVED", undefined, priya);
  await scheduleJob(job!.id, { assignedUserId: "u_jordan", start: sydneyLocalToDate("2026-10-05T09:00")!, end: sydneyLocalToDate("2026-10-05T12:00")! }, priya, "Jordan Lee");
  await changeJobStatus(job!.id, "IN_PROGRESS", priya);
  await changeJobStatus(job!.id, "COMPLETED", priya);
  return { client, job: job!, quoteId: q.id };
}

describe("drafting an invoice", () => {
  it("builds it from the quote lines and the APPROVED variations only, with GST once", async () => {
    const { job } = await completedJob([{ description: "Downlights", quantity: 2, unitPriceCents: 25000 }, { description: "Call-out", unitPriceCents: 9500 }]);
    const v1 = await addJobNote(job.id, { text: "Extra circuit", kind: "VARIATION", extraCents: 18000 }, jordan);
    await addJobNote(job.id, { text: "Skipped extra", kind: "VARIATION", extraCents: 99900 }, jordan); // never approved
    await approveVariation(v1.id, true, priya);
    const inv = await createInvoiceFromJob(job.id, priya);
    expect(inv).toMatchObject({ number: "INV-3001", status: "DRAFT", subtotalCents: 77500, gstCents: 7750, totalCents: 85250, creditCents: 0 });
    const full = await getInvoice(inv.id);
    expect(full?.lines.map((l) => [l.source, l.description, l.lineTotalCents])).toEqual([["QUOTE", "Downlights", 50000], ["QUOTE", "Call-out", 9500], ["VARIATION", "Variation: Extra circuit", 18000]]);
    expect(full).toMatchObject({ balanceCents: 85250, effectiveStatus: "DRAFT", paidCents: 0 });
    expect((await getJob(job.id))?.status).toBe("COMPLETED"); // not billed until issued
    expect((await listEntityTimeline("invoice", inv.id)).map((e) => e.kind)).toEqual(["CREATED"]);
  });

  it("only a completed job, and only once", async () => {
    const { job } = await completedJob();
    await createInvoiceFromJob(job.id, priya);
    await expect(createInvoiceFromJob(job.id, priya)).rejects.toThrow(/already has an invoice/);
    const client = await createClient({ type: "PERSON", name: "Other", preferredContact: "EMAIL", tags: [] }, priya);
    const q = await createQuote({ clientId: client.id, title: "T" }, priya);
    await replaceQuoteLines(q.id, [{ description: "x", quantity: 1, unitPriceCents: 1000 }], priya);
    await markQuoteSent(q.id, priya);
    const { job: open } = await decideQuote(q.id, "APPROVED", undefined, priya);
    await expect(createInvoiceFromJob(open!.id, priya)).rejects.toThrow(/Only a completed job/);
  });

  it("lists completed jobs that are waiting for an invoice", async () => {
    const { job } = await completedJob();
    expect((await listJobsReadyToInvoice()).map((j) => j.id)).toEqual([job.id]);
    await createInvoiceFromJob(job.id, priya);
    expect(await listJobsReadyToInvoice()).toEqual([]);
  });
});

describe("deposits", () => {
  it("credits the deposit received against the invoice total, and refuses amounts beyond what the quote asked for", async () => {
    const { job } = await completedJob([{ unitPriceCents: 200000 }]); // total 2,200.00 -> 30% deposit 660.00
    expect(await depositStatus(job.id)).toEqual({ requiredCents: 66000, receivedCents: 0, outstandingCents: 66000 });
    await expect(recordDeposit(job.id, { amountCents: 70000, method: "BANK" }, priya)).rejects.toThrow(/only .* still due/);
    await recordDeposit(job.id, { amountCents: 30000, method: "BANK", reference: "EFT 1" }, priya);
    await recordDeposit(job.id, { amountCents: 36000, method: "CARD" }, priya);
    expect(await depositStatus(job.id)).toMatchObject({ receivedCents: 66000, outstandingCents: 0 });
    const inv = await createInvoiceFromJob(job.id, priya);
    expect(inv).toMatchObject({ totalCents: 220000, creditCents: 66000 });
    expect((await getInvoice(inv.id))?.balanceCents).toBe(154000);
    await expect(recordDeposit(job.id, { amountCents: 100, method: "BANK" }, priya)).rejects.toThrow(/already invoiced/);
  });

  it("a job whose quote needed no deposit cannot take one", async () => {
    const { job } = await completedJob([{ unitPriceCents: 50000 }]);
    await expect(recordDeposit(job.id, { amountCents: 100, method: "CASH" }, priya)).rejects.toThrow(/did not require a deposit/);
    expect(await depositStatus(job.id)).toBeNull();
  });

  it("voiding releases the deposit so the next invoice credits it again", async () => {
    const { job } = await completedJob([{ unitPriceCents: 200000 }]);
    await recordDeposit(job.id, { amountCents: 66000, method: "BANK" }, priya);
    const first = await createInvoiceFromJob(job.id, priya);
    await voidInvoice(first.id, "Wrong lines", priya);
    expect((await getInvoice(first.id))?.status).toBe("VOID");
    // a voided invoice frees the job for a fresh draft, keeping the old one on record
    const second = await createInvoiceFromJob(job.id, priya);
    expect(second.creditCents).toBe(66000);
    expect(second.number).not.toBe(first.number);
    expect(await appDb.invoice.count({ where: { jobId: job.id } })).toBe(2);
    await expect(createInvoiceFromJob(job.id, priya)).rejects.toThrow(/already has an invoice/);
  });
});

describe("review, issue and payment", () => {
  it("edits a draft (totals recalculate, deposit credit kept), locks it once issued, and starts the 7-day terms", async () => {
    const { job } = await completedJob([{ unitPriceCents: 200000 }]);
    await recordDeposit(job.id, { amountCents: 66000, method: "BANK" }, priya);
    const inv = await createInvoiceFromJob(job.id, priya);
    const edited = await replaceInvoiceLines(inv.id, [{ description: "Switchboard", quantity: 1, unitPriceCents: 190000, source: "QUOTE" }], "Discount agreed", priya);
    expect(edited).toMatchObject({ subtotalCents: 190000, gstCents: 19000, totalCents: 209000, creditCents: 66000, notes: "Discount agreed" });
    await expect(replaceInvoiceLines(inv.id, [], undefined, priya)).rejects.toThrow(/at least one line/);
    const issued = await issueInvoice(inv.id, priya);
    expect(issued.status).toBe("SENT");
    expect(issued.dueAt!.getTime() - issued.issuedAt!.getTime()).toBe(7 * 86_400_000);
    expect((await getJob(job.id))?.status).toBe("INVOICED");
    await expect(replaceInvoiceLines(inv.id, [{ description: "x", quantity: 1, unitPriceCents: 1, source: "MANUAL" }], undefined, priya)).rejects.toThrow(/Only a draft/);
    await expect(issueInvoice(inv.id, priya)).rejects.toThrow(/Only a draft/);
  });

  it("takes part payments, refuses overpayment, and closes the invoice and the job when paid in full", async () => {
    const { job } = await completedJob([{ unitPriceCents: 100000 }]); // total 1,100.00
    const inv = await issuedInvoice(job.id);
    await expect(recordPayment(inv.id, { amountCents: 1000, method: "BANK" }, priya)).resolves.toMatchObject({ status: "PARTIALLY_PAID" });
    expect(await getInvoice(inv.id)).toMatchObject({ paidCents: 1000, balanceCents: 109000 });
    await expect(recordPayment(inv.id, { amountCents: 200000, method: "BANK" }, priya)).rejects.toThrow(/more than the .* still owing/);
    await expect(recordPayment(inv.id, { amountCents: 0, method: "BANK" }, priya)).rejects.toThrow(/Enter the amount/);
    const paid = await recordPayment(inv.id, { amountCents: 109000, method: "CARD", reference: "Visa 4242" }, priya);
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).toBeTruthy();
    expect((await getJob(job.id))?.status).toBe("PAID");
    await expect(recordPayment(inv.id, { amountCents: 100, method: "CASH" }, priya)).rejects.toThrow(/cannot take a payment/);
    expect((await listEntityTimeline("invoice", inv.id)).map((e) => e.kind)).toEqual(expect.arrayContaining(["CREATED", "ISSUED", "PAYMENT", "PAID"]));
  });

  it("a draft takes no payment", async () => {
    const { job } = await completedJob();
    const inv = await createInvoiceFromJob(job.id, priya);
    await expect(recordPayment(inv.id, { amountCents: 100, method: "CASH" }, priya)).rejects.toThrow(/cannot take a payment/);
  });

  it("an invoice already covered by the deposit is paid the moment it is issued", async () => {
    const { job } = await completedJob([{ unitPriceCents: 200000 }]);
    await recordDeposit(job.id, { amountCents: 66000, method: "BANK" }, priya);
    const inv = await createInvoiceFromJob(job.id, priya);
    await replaceInvoiceLines(inv.id, [{ description: "Reduced scope", quantity: 1, unitPriceCents: 5000, source: "MANUAL" }], undefined, priya);
    const issued = await issueInvoice(inv.id, priya);
    expect(issued.status).toBe("PAID");
    expect((await getJob(job.id))?.status).toBe("PAID");
  });

  it("voids a draft or an unpaid sent invoice, not one with payments", async () => {
    const { job } = await completedJob();
    const inv = await issuedInvoice(job.id);
    await recordPayment(inv.id, { amountCents: 1000, method: "CASH" }, priya);
    await expect(voidInvoice(inv.id, "Mistake", priya)).rejects.toThrow(/payments on it/);
    const { job: job2 } = await completedJob(undefined, "Second Client");
    const inv2 = await issuedInvoice(job2.id);
    await expect(voidInvoice(inv2.id, " ", priya)).rejects.toThrow(/why/);
    await voidInvoice(inv2.id, "Raised in error", priya);
    expect((await getJob(job2.id))?.status).toBe("COMPLETED");
    expect((await listJobsReadyToInvoice()).map((j) => j.id)).toContain(job2.id); // back in the queue
    expect((await getJob(job2.id))?.invoices).toEqual([]); // the voided one is not the job's current invoice
    await expect(recordPayment(inv2.id, { amountCents: 100, method: "CASH" }, priya)).rejects.toThrow(/cannot take a payment/);
  });
});

async function issuedInvoice(jobId: string) {
  const inv = await createInvoiceFromJob(jobId, priya);
  return issueInvoice(inv.id, priya);
}

describe("overdue and the money position", () => {
  it("reads an issued invoice past its due date as overdue and places it on the chasing cadence", async () => {
    const { job } = await completedJob([{ unitPriceCents: 100000 }]);
    const inv = await issuedInvoice(job.id);
    await appDb.invoice.update({ where: { id: inv.id }, data: { issuedAt: new Date(Date.now() - 22 * 86_400_000), dueAt: new Date(Date.now() - 15 * 86_400_000) } });
    const f = await getInvoice(inv.id);
    expect(f).toMatchObject({ effectiveStatus: "OVERDUE", daysOverdue: 15 });
    expect(f?.chase).toEqual({ stage: 14, action: "Send a formal payment notice" });
    expect((await listInvoices({ status: "OVERDUE" })).map((i) => i.id)).toEqual([inv.id]);
    expect(await listInvoices({ status: "SENT" })).toEqual([]);
  });

  it("summarises what is owed, what is overdue, and what came in this month", async () => {
    const { job: a } = await completedJob([{ unitPriceCents: 100000 }], "A");
    const { job: b } = await completedJob([{ unitPriceCents: 50000 }], "B");
    const ia = await issuedInvoice(a.id);
    const ib = await issuedInvoice(b.id);
    await appDb.invoice.update({ where: { id: ia.id }, data: { dueAt: new Date(Date.now() - 3 * 86_400_000) } });
    await recordPayment(ib.id, { amountCents: 20000, method: "BANK" }, priya);
    const s = await receivablesSummary();
    expect(s.outstandingCount).toBe(2);
    expect(s.outstandingCents).toBe(110000 + 55000 - 20000);
    expect(s.overdueCents).toBe(110000);
    expect(s.overdue).toHaveLength(1);
    expect(s.overdue[0]).toMatchObject({ number: ia.number, clientName: "A", daysOverdue: 3, chase: { stage: 1 } });
    expect(s.receivedThisMonthCents).toBe(20000);
  });
});

describe("export", () => {
  it("writes invoices and payments as CSV with quoting for commas", async () => {
    const { job } = await completedJob([{ unitPriceCents: 100000 }], "Smith, Pat & Co");
    const inv = await issuedInvoice(job.id);
    await recordPayment(inv.id, { amountCents: 5000, method: "BANK", reference: "EFT, ref 7" }, priya);
    const csv = await invoicesCsv();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Invoice,Client,Job,Status,Issued,Due,Subtotal,GST,Total,Deposit credit,Paid,Balance");
    expect(lines[1]).toContain('"Smith, Pat & Co"');
    expect(lines[1]).toContain("1100.00");
    expect(csv).toContain('"EFT, ref 7"');
    expect(csv).toContain("Payments");
  });
});
