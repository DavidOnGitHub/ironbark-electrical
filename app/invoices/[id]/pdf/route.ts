import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../../../../src/access";
import { buildInvoicePdf, getInvoice, invoicePdfFilename } from "../../../../src/domain/invoicing";

export const dynamic = "force-dynamic";

/** The invoice as a PDF - the same file the customer gets attached to their email. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(Access.INVOICES_READ);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await ctx.params;
  const invoice = await getInvoice(id);
  if (!invoice) return new Response("Not found", { status: 404 });
  const pdf = await buildInvoicePdf(invoice);
  return new Response(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${invoicePdfFilename(invoice.number)}"` },
  });
}
