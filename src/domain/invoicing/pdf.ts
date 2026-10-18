/**
 * The invoice as a PDF - what the customer gets attached to the invoice email and what the office can download.
 * Plain A4, standard fonts only (no font files to ship). Takes the invoice as the invoicing module returns it.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney } from "../../lib/money";
import { bankDetails, type BankDetails } from "../../lib/bank";

export interface InvoicePdfInput {
  number: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  creditCents: number;
  balanceCents: number;
  notes: string | null;
  client: { name: string };
  job: { number: string; title: string; site: { line1: string; line2: string | null; suburb: string; state: string; postcode: string } | null };
  lines: { description: string; quantity: unknown; unit: string; unitPriceCents: number; lineTotalCents: number }[];
}

export interface InvoicePdfOptions {
  business?: { name: string; phone: string; abn: string };
  bank?: BankDetails;
}

const BUSINESS = { name: "Ironbark Electrical", phone: "(02) 5550 0142", abn: "ABN 12 345 678 901" };
const A4 = { w: 595.28, h: 841.89 };
const M = 48;
const INK = rgb(0.17, 0.14, 0.13);
const MUTED = rgb(0.42, 0.4, 0.38);
const HIVIS = rgb(0.965, 0.722, 0);
const RULE = rgb(0.85, 0.83, 0.8);

export const invoicePdfFilename = (number: string) => `Invoice ${number}.pdf`;

/** Standard PDF fonts only cover Latin-1 and a few punctuation marks; anything else would make drawing fail. */
const safe = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7e -ÿ–—‘’“”•€]/g, "?");

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney" }) : "-");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split(/ {2,}/).join(" ").split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildInvoicePdf(inv: InvoicePdfInput, opts: InvoicePdfOptions = {}): Promise<Uint8Array> {
  const business = opts.business ?? BUSINESS;
  const bank = opts.bank ?? bankDetails();
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.number}`);
  doc.setAuthor(business.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h;
  const text = (t: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: number } = {}) => {
    const size = o.size ?? 10;
    const f = o.font ?? font;
    const s = safe(t);
    const px = o.right !== undefined ? o.right - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: px, y: yy, size, font: f, color: o.color ?? INK });
  };

  const header = () => {
    page.drawRectangle({ x: 0, y: A4.h - 70, width: A4.w, height: 70, color: INK });
    page.drawRectangle({ x: 0, y: A4.h - 74, width: A4.w, height: 4, color: HIVIS });
    text(business.name, M, A4.h - 44, { size: 20, font: bold, color: rgb(1, 1, 1) });
    text("TAX INVOICE", 0, A4.h - 44, { size: 14, font: bold, color: HIVIS, right: A4.w - M });
    y = A4.h - 110;
  };
  header();

  // Invoice details (left) and bill-to (right)
  const meta: [string, string][] = [["Invoice", inv.number], ["Issued", date(inv.issuedAt)], ["Due", date(inv.dueAt)], ["Job", inv.job.number]];
  let my = y;
  for (const [k, v] of meta) {
    text(k, M, my, { size: 9, color: MUTED });
    text(v, M + 60, my, { font: bold });
    my -= 16;
  }
  const site = inv.job.site ? [inv.job.site.line1, inv.job.site.line2, `${inv.job.site.suburb} ${inv.job.site.state} ${inv.job.site.postcode}`].filter((x): x is string => !!x) : [];
  let by = y;
  text("BILL TO", 300, by, { size: 9, color: MUTED });
  text(inv.client.name, 300, (by -= 16), { font: bold, size: 11 });
  for (const l of site) text(l, 300, (by -= 14));
  y = Math.min(my, by) - 18;

  text(inv.job.title, M, y, { font: bold, size: 12 });
  y -= 24;

  // Lines table
  const col = { desc: M, qty: 340, unit: 420, total: A4.w - M };
  const tableHead = () => {
    page.drawRectangle({ x: M - 6, y: y - 5, width: A4.w - 2 * M + 12, height: 20, color: rgb(0.95, 0.94, 0.92) });
    text("Description", col.desc, y, { size: 9, font: bold });
    text("Qty", 0, y, { size: 9, font: bold, right: col.qty + 40 });
    text("Unit price", 0, y, { size: 9, font: bold, right: col.unit + 60 });
    text("Amount", 0, y, { size: 9, font: bold, right: col.total });
    y -= 22;
  };
  tableHead();
  for (const l of inv.lines) {
    const desc = wrap(l.description, font, 10, 270);
    if (y - desc.length * 13 < 220) {
      page = doc.addPage([A4.w, A4.h]);
      header();
      tableHead();
    }
    const top = y;
    for (const d of desc) {
      text(d, col.desc, y);
      y -= 13;
    }
    const qty = `${Number(l.quantity)} ${l.unit}`;
    text(qty, 0, top, { right: col.qty + 40 });
    text(formatMoney(l.unitPriceCents), 0, top, { right: col.unit + 60 });
    text(formatMoney(l.lineTotalCents), 0, top, { right: col.total });
    page.drawLine({ start: { x: M - 6, y: y + 4 }, end: { x: A4.w - M + 6, y: y + 4 }, thickness: 0.5, color: RULE });
    y -= 8;
  }

  // Totals
  if (y < 250) {
    page = doc.addPage([A4.w, A4.h]);
    header();
  }
  y -= 6;
  const totalRow = (label: string, value: string, strong = false) => {
    text(label, 0, y, { font: strong ? bold : font, size: strong ? 12 : 10, right: col.unit + 60 });
    text(value, 0, y, { font: strong ? bold : font, size: strong ? 12 : 10, right: col.total });
    y -= strong ? 20 : 15;
  };
  totalRow("Subtotal (ex GST)", formatMoney(inv.subtotalCents));
  totalRow("GST (10%)", formatMoney(inv.gstCents));
  totalRow("Total (incl GST)", formatMoney(inv.totalCents));
  if (inv.creditCents > 0) totalRow("Deposit already paid", `-${formatMoney(inv.creditCents)}`);
  totalRow("Amount due", formatMoney(inv.balanceCents), true);

  // Payment details
  y -= 14;
  const boxH = 86;
  page.drawRectangle({ x: M - 6, y: y - boxH + 14, width: A4.w - 2 * M + 12, height: boxH, borderColor: HIVIS, borderWidth: 1.5, color: rgb(1, 0.98, 0.9) });
  text("Pay by direct bank transfer", M + 4, y, { font: bold, size: 11 });
  const pay: [string, string][] = [["Account name", bank.accountName], ["BSB", bank.bsb], ["Account number", bank.accountNumber], ["Reference", inv.number]];
  let py = y - 18;
  for (const [k, v] of pay) {
    text(k, M + 4, py, { size: 9, color: MUTED });
    text(v, M + 100, py, { font: bold });
    py -= 14;
  }
  y -= boxH + 4;

  if (inv.notes?.trim()) {
    for (const l of wrap(inv.notes, font, 9, A4.w - 2 * M)) {
      text(l, M, y, { size: 9, color: MUTED });
      y -= 12;
    }
  }
  const last = doc.getPages().at(-1)!;
  last.drawText(safe(`${business.name}  -  ${business.abn}  -  ${business.phone}  -  Thank you for your business.`), { x: M, y: 30, size: 8, font, color: MUTED });
  return doc.save();
}
