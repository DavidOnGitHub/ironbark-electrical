import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { addSite, createClient } from "../src/domain/clients";
import { createQuote, decideQuote, markQuoteSent, replaceQuoteLines } from "../src/domain/quotes";
import { changeJobStatus, scheduleJob } from "../src/domain/jobs";
import { buildInvoicePdf, getInvoice, invoicePdfFilename, issueInvoice, recordPayment, replaceInvoiceLines } from "../src/domain/invoicing";
import { bankDetails, bankTransferBlock } from "../src/lib/bank";
import { buildMime } from "../src/integrations/gmailSend";
import { buildReview } from "../src/domain/approvals/review";
import { approvalOutput, editableFor } from "../src/domain/approvals/edit";
import { draftInvoiceImpl, getInvoiceImpl } from "../src/steps/impl";
import { invoiceChase } from "../src/workflows";
import type { Actor } from "../src/domain/shared/actor";
import { sydneyLocalToDate } from "../src/lib/tz";
import { truncateAll } from "./helpers";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const testMode = { [TEST_MODE_CONTEXT_KEY]: true } as never;
let savedAutomations: string | undefined;

beforeAll(() => {
  // Never start a real follow-up run from a test.
  savedAutomations = process.env.AUTOMATIONS;
  process.env.AUTOMATIONS = "off";
});
beforeEach(truncateAll);
afterAll(async () => {
  if (savedAutomations === undefined) delete process.env.AUTOMATIONS;
  else process.env.AUTOMATIONS = savedAutomations;
  await truncateAll();
  await appDb.$disconnect();
});

/** A finished job (quote accepted, scheduled, worked, completed). */
async function completedJob() {
  const client = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
  const site = await addSite(client.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
  const quote = await createQuote({ clientId: client.id, siteId: site.id, title: "Switchboard upgrade" }, priya);
  await replaceQuoteLines(quote.id, [{ description: "Electrician", quantity: 3, unit: "hour", unitPriceCents: 11000 }, { description: "RCD safety switch", quantity: 2, unit: "each", unitPriceCents: 9500 }], priya);
  await markQuoteSent(quote.id, priya);
  const { job } = await decideQuote(quote.id, "APPROVED", "ok", priya);
  const start = sydneyLocalToDate("2026-10-20T08:00")!;
  await scheduleJob(job!.id, { assignedUserId: "u_jordan", start, end: new Date(start.getTime() + 3 * 3_600_000) }, priya, "Jordan");
  await changeJobStatus(job!.id, "IN_PROGRESS", priya);
  await changeJobStatus(job!.id, "COMPLETED", priya);
  return { client, quote, job: job! };
}

/** The text operators of every page, with the compressed content streams inflated; pdf-lib writes strings as hex. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const out: string[] = [raw.toString("latin1")];
  let from = 0;
  for (;;) {
    const start = raw.indexOf("stream", from, "latin1");
    if (start < 0) break;
    const bodyStart = raw[start + 6] === 0x0d ? start + 8 : start + 7;
    const end = raw.indexOf("endstream", bodyStart, "latin1");
    if (end < 0) break;
    try {
      out.push(inflateSync(raw.subarray(bodyStart, end)).toString("latin1"));
    } catch {
      /* not a compressed stream */
    }
    from = end + 9;
  }
  return out.join("\n").toUpperCase();
}
const hex = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

describe("the invoice PDF", () => {
  it("is a real PDF with the figures and the bank transfer details", async () => {
    const { job } = await completedJob();
    const created = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { invoiceId: string; number: string };
    const invoice = (await getInvoice(created.invoiceId))!;
    const bytes = await buildInvoicePdf(invoice);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const text = pdfText(bytes);
    for (const needle of [invoice.number, bankDetails().bsb, bankDetails().accountNumber, "direct bank transfer", "TAX INVOICE"]) expect(text, needle).toContain(hex(needle));
    expect(invoicePdfFilename(invoice.number)).toBe(`Invoice ${invoice.number}.pdf`);
  });
  it("runs onto more pages for a long invoice, and survives characters a PDF font cannot draw", async () => {
    const { job } = await completedJob();
    const created = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { invoiceId: string };
    await replaceInvoiceLines(created.invoiceId, Array.from({ length: 45 }, (_, i) => ({ description: `Line ${i + 1} - cable run through the roof space with a very long description that has to wrap onto a second line ✓ Ω`, quantity: 1, unit: "each", unitPriceCents: 1000 })), "Notes with ✓ symbols", priya);
    const bytes = await buildInvoicePdf((await getInvoice(created.invoiceId))!);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});

describe("attaching it to the email", () => {
  const base = { to: "pat@example.com", subject: "Invoice INV-3011", text: "Hi Pat", html: "<p>Hi Pat</p>", boundary: "bnd" };
  it("wraps the message and the file in a mixed email", () => {
    const data = new Uint8Array([37, 80, 68, 70, 45, 49]);
    const mime = buildMime({ ...base, attachments: [{ filename: "Invoice INV-3011.pdf", mimeType: "application/pdf", data }] });
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="bnd_mixed"');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="bnd"');
    expect(mime).toContain('Content-Disposition: attachment; filename="Invoice INV-3011.pdf"');
    expect(mime).toContain(Buffer.from(data).toString("base64"));
    expect(mime.trimEnd().endsWith("--bnd_mixed--")).toBe(true);
    expect(mime.indexOf("--bnd--")).toBeLessThan(mime.indexOf("Content-Disposition"));
  });
  it("is unchanged without an attachment", () => {
    const mime = buildMime(base);
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="bnd"');
    expect(mime).not.toContain("multipart/mixed");
  });
  it("keeps a file name from breaking the headers", () => {
    const mime = buildMime({ ...base, attachments: [{ filename: 'bad"name\r\nX-Evil: 1.pdf', mimeType: "application/pdf", data: new Uint8Array([1]) }] });
    expect(mime).not.toMatch(/\r\nX-Evil:/);
  });
  it("tells the office the PDF is attached when they approve the invoice email", async () => {
    const send = invoiceChase.nodes.find((n) => n.id === "send_invoice")!;
    const render = async (key: string) => ({ subject: key, html: "", text: "", missing: [] as string[] });
    const review = await buildReview([send as never], "send_invoice", { trigger: { invoiceId: "i1" }, load_invoice: { clientEmail: "pat@example.com" } }, render);
    expect(review).toMatchObject({ kind: "email", attachments: ["The invoice as a PDF"] });
  });
});

describe("how to pay", () => {
  it("lists the account and uses the invoice number as the reference", () => {
    const block = bankTransferBlock("INV-3011", { accountName: "Ironbark Electrical Pty Ltd", bsb: "123-456", accountNumber: "1234 5678" });
    expect(block).toContain("BSB: 123-456");
    expect(block).toContain("Reference: INV-3011");
  });
  it("is in the invoice email's pay block, with or without a card link", async () => {
    const { job } = await completedJob();
    const created = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { invoiceId: string; number: string };
    const out = (await getInvoiceImpl({ params: { invoiceId: created.invoiceId } }, {} as never)) as { payBlock: string };
    expect(out.payBlock).toContain("Pay by direct bank transfer");
    expect(out.payBlock).toContain(`Reference: ${created.number}`);
  });
});

describe("drafting and sending the invoice", () => {
  it("drafts from the quote for a completed job, once", async () => {
    const { job } = await completedJob();
    const out = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { created: boolean; invoiceId: string; totalText: string };
    expect(out.created).toBe(true);
    expect((await getInvoice(out.invoiceId))!.status).toBe("DRAFT");
    expect(await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)).toMatchObject({ created: false, reason: expect.stringMatching(/already has an invoice/) });
  });
  it("says why, instead of failing, for a job that is not finished", async () => {
    const { job } = await completedJob();
    await appDb.job.update({ where: { id: job.id }, data: { status: "IN_PROGRESS" } });
    expect(await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)).toMatchObject({ created: false, reason: expect.stringMatching(/completed job/) });
  });
  it("issues a draft, once, and the job becomes invoiced", async () => {
    const { job } = await completedJob();
    const { invoiceId } = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { invoiceId: string };
    await issueInvoice(invoiceId, priya);
    const issued = (await getInvoice(invoiceId))!;
    expect(issued.status).toBe("SENT");
    expect(issued.dueAt).toBeInstanceOf(Date);
    expect((await appDb.job.findUnique({ where: { id: job.id } }))!.status).toBe("INVOICED");
    await expect(issueInvoice(invoiceId, priya)).rejects.toThrow(/Only a draft/);
  });
  it("changes nothing in a test run", async () => {
    const { job } = await completedJob();
    expect(await draftInvoiceImpl({ params: { jobId: job.id } }, testMode)).toMatchObject({ created: true, simulated: true });
    expect(await appDb.invoice.count()).toBe(0);
  });
  it("is marked paid by a bank transfer for the whole balance", async () => {
    const { job } = await completedJob();
    const { invoiceId } = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { invoiceId: string };
    await issueInvoice(invoiceId, priya);
    const open = (await getInvoice(invoiceId))!;
    const paid = await recordPayment(invoiceId, { amountCents: open.balanceCents, method: "BANK", reference: "Direct bank transfer" }, priya);
    expect(paid.status).toBe("PAID");
  });
});

describe("approving the invoice email", () => {
  const approve = invoiceChase.nodes.find((n) => n.id === "approve_send")!;
  const context = { trigger: { invoiceId: "i1" }, load_invoice: { emailAddress: "pat@example.com", introText: "Thank you for having us out." } };
  it("offers the intro as the editable message, and uses the edited text once approved", () => {
    expect(editableFor(approve.config, invoiceChase.nodes as never, context as never)).toMatchObject({ variable: "message", text: "Thank you for having us out." });
    const edited = { ...context, approve_send: { message: "Thanks Pat - invoice attached." } };
    expect(editableFor(approve.config, invoiceChase.nodes as never, edited as never)?.text).toBe("Thanks Pat - invoice attached.");
    expect(approvalOutput(approve.config, "approve", " Thanks Pat ")).toEqual({ ok: true, output: { approved: true, message: "Thanks Pat" } });
  });
  it("closes with nothing sent when rejected", () => {
    expect(approvalOutput(approve.config, "reject", undefined)).toEqual({ ok: true, output: { approved: false } });
  });
  it("puts the message into the invoice email, ahead of the amount and how to pay", async () => {
    const { job } = await completedJob();
    const { invoiceId } = (await draftInvoiceImpl({ params: { jobId: job.id } }, {} as never)) as { invoiceId: string };
    const out = (await getInvoiceImpl({ params: { invoiceId } }, {} as never)) as { introText: string };
    expect(out.introText).toContain("the PDF is attached");
    const send = invoiceChase.nodes.find((n) => n.id === "send_invoice_approved")!;
    const render = (await import("../src/domain/emailTemplates")).renderTemplate;
    await (await import("../src/domain/emailTemplates")).ensureDefaultTemplates();
    const review = await buildReview([send as never], "send_invoice_approved", { trigger: { invoiceId }, approve_send: { message: "Custom words here." }, load_invoice: { emailAddress: "pat@example.com", clientFirstName: "Pat", number: "INV-1", balanceText: "$1", dueNote: "", payBlock: "pay", jobTitle: "Job", introText: out.introText } }, render);
    expect(review).toMatchObject({ kind: "email" });
    expect((review as { text: string }).text).toContain("Custom words here.");
  });
});
