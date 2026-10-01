/**
 * Phase 3 demo data: deposits received, and invoices at every stage for the jobs
 * seedQuotesAndJobs left in Completed / Invoiced / Paid. Runs after it.
 */
import { appDb } from "../src/db/app";
import { invoiceTotals } from "../src/domain/invoicing/calc";
import { addDays, lineTotalCents } from "../src/domain/quotes/calc";

export async function seedInvoicing(userIds: Record<string, string>, now = new Date()) {
  const office = userIds["office@ironbark.test"]!;
  const counts = { invoices: 0, payments: 0, events: 0 };
  let invoiceNo = 3000;
  const DAY = 86_400_000;

  const event = async (at: Date, clientId: string, entityType: "invoice" | "job", entityId: string, kind: string, summary: string) => {
    await appDb.activityEvent.create({ data: { actorType: "USER", actorUserId: office, actorLabel: "Priya Nair", clientId, entityType, entityId, kind, summary, at } });
    counts.events++;
  };

  const jobs = await appDb.job.findMany({
    orderBy: { createdAt: "asc" },
    include: { quote: { include: { lines: { orderBy: { position: "asc" } } } }, notes: true },
  });

  // --- deposits: received once the quote was accepted, except for jobs that have not started
  let outstandingLeft = 1; // one upcoming job still owes its deposit, to show the "due" state
  for (const job of jobs) {
    if (!job.quote?.depositRequired || !job.quote.decidedAt) continue;
    if (job.status === "UNSCHEDULED") continue;
    if (job.status === "SCHEDULED" && outstandingLeft > 0) {
      outstandingLeft--;
      continue;
    }
    const received = new Date(job.quote.decidedAt.getTime() + 0.5 * DAY);
    await appDb.payment.create({ data: { kind: "DEPOSIT", jobId: job.id, method: "BANK", amountCents: job.quote.depositCents, paidAt: received, reference: `EFT ${job.quote.number}`, recordedByUserId: office, createdAt: received } });
    counts.payments++;
    await event(received, job.clientId, "job", job.id, "DEPOSIT", `${job.number}: deposit of $${(job.quote.depositCents / 100).toFixed(2)} received`);
  }

  // --- invoices for finished work
  let invoicedIdx = 0;
  let completedIdx = 0;
  for (const job of jobs) {
    if (!job.quote || !["COMPLETED", "INVOICED", "PAID"].includes(job.status)) continue;
    if (job.status === "COMPLETED") {
      completedIdx++;
      if (completedIdx !== 1) continue; // the second completed job stays "ready to invoice"
    }
    const completed = job.completedAt ?? new Date(now.getTime() - 3 * DAY);
    const lines: { source: string; description: string; quantity: number; unit: string; unitPriceCents: number }[] = [
      ...job.quote.lines.map((l) => ({ source: "QUOTE", description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: l.unitPriceCents })),
    ];
    // a couple of finished jobs had an approved variation
    if (job.status === "PAID" && job.number.endsWith("2") || job.number.endsWith("7")) {
      const extra = 14500;
      await appDb.jobNote.create({ data: { jobId: job.id, authorUserId: job.assignedUserId ?? office, authorLabel: "Jordan Lee", kind: "VARIATION", text: "Extra power point in the study", extraCents: extra, approved: true, approvedByUserId: office, createdAt: completed } });
      lines.push({ source: "VARIATION", description: "Variation: Extra power point in the study", quantity: 1, unit: "each", unitPriceCents: extra });
    }
    const deposits = await appDb.payment.findMany({ where: { jobId: job.id, kind: "DEPOSIT", invoiceId: null } });
    const totals = invoiceTotals(lines, deposits.reduce((s, d) => s + d.amountCents, 0));
    const issuedAt = job.status === "COMPLETED" ? null : new Date(completed.getTime() + 1 * DAY);
    const dueAt = issuedAt ? addDays(issuedAt, 7) : null;
    invoiceNo++;
    let status: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" = job.status === "COMPLETED" ? "DRAFT" : job.status === "INVOICED" ? "SENT" : "PAID";
    const partial = job.status === "INVOICED" && ++invoicedIdx === 2;
    if (partial) status = "PARTIALLY_PAID";
    const balance = Math.max(0, totals.totalCents - totals.creditCents);
    const paidAt = status === "PAID" ? new Date(issuedAt!.getTime() + (2 + (invoiceNo % 4)) * DAY) : null;
    const invoice = await appDb.invoice.create({
      data: {
        number: `INV-${invoiceNo}`,
        jobId: job.id,
        clientId: job.clientId,
        siteId: job.siteId,
        status,
        issuedAt,
        dueAt,
        paidAt,
        ...totals,
        notes: null,
        createdByUserId: office,
        createdAt: new Date(completed.getTime() + 0.2 * DAY),
        lines: { create: lines.map((l, i) => ({ position: i, ...l, lineTotalCents: lineTotalCents(l.quantity, l.unitPriceCents) })) },
      },
    });
    counts.invoices++;
    if (deposits.length > 0) await appDb.payment.updateMany({ where: { id: { in: deposits.map((d) => d.id) } }, data: { invoiceId: invoice.id } });
    await event(invoice.createdAt, job.clientId, "invoice", invoice.id, "CREATED", `Invoice ${invoice.number} drafted for ${job.number}`);
    if (issuedAt) await event(issuedAt, job.clientId, "invoice", invoice.id, "ISSUED", `Invoice ${invoice.number} issued, due ${dueAt!.toLocaleDateString("en-AU")}`);
    if (status === "PAID" && balance > 0) {
      // paid in two payments for variety on every other invoice
      const first = invoiceNo % 2 === 0 ? Math.round(balance * 0.6) : balance;
      const parts = first === balance ? [balance] : [first, balance - first];
      for (let i = 0; i < parts.length; i++) {
        const at = new Date(paidAt!.getTime() - (parts.length - 1 - i) * 2 * DAY);
        await appDb.payment.create({ data: { kind: "INVOICE", invoiceId: invoice.id, jobId: job.id, method: i === 0 && invoiceNo % 3 === 0 ? "CARD" : "BANK", amountCents: parts[i]!, paidAt: at, reference: i === 0 ? `EFT ${invoice.number}` : null, recordedByUserId: office, createdAt: at } });
        counts.payments++;
      }
      await event(paidAt!, job.clientId, "invoice", invoice.id, "PAID", `Invoice ${invoice.number} paid in full`);
    }
    if (partial && balance > 0) {
      const part = Math.round(balance * 0.4);
      const at = new Date(issuedAt!.getTime() + 3 * DAY);
      await appDb.payment.create({ data: { kind: "INVOICE", invoiceId: invoice.id, jobId: job.id, method: "BANK", amountCents: part, paidAt: at, reference: `EFT ${invoice.number}`, recordedByUserId: office, createdAt: at } });
      counts.payments++;
      await event(at, job.clientId, "invoice", invoice.id, "PAYMENT", `Payment of $${(part / 100).toFixed(2)} received on ${invoice.number}`);
    }
  }
  await appDb.sequence.upsert({ where: { key: "invoice" }, create: { key: "invoice", value: invoiceNo }, update: { value: invoiceNo } });
  return counts;
}
