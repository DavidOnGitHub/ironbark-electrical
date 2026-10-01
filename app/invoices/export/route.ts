import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../../../src/access";
import { invoicesCsv } from "../../../src/domain/invoicing";

export const dynamic = "force-dynamic";

/** Invoices and payments as a CSV file, for the bookkeeper. */
export async function GET() {
  try {
    await requireRole(Access.INVOICES_READ);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const csv = await invoicesCsv();
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ironbark-invoices-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
