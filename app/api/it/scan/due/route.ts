import { scanDue, verifyScanSignature } from "../../../../../src/domain/it";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scan workflow wakes up every day and asks here whether a scan is due. Signed like the report itself (an empty
 * body), so only the workflow can ask. Reads only.
 */
export async function POST(request: Request) {
  const secret = process.env.IT_SCAN_SECRET;
  if (!secret) return Response.json({ error: "Security scan intake is not configured." }, { status: 503 });
  const body = await request.text();
  const checked = verifyScanSignature({ secret, timestamp: request.headers.get("x-scan-timestamp"), signature: request.headers.get("x-scan-signature"), body });
  if (!checked.ok) return Response.json({ error: checked.reason }, { status: 401 });
  return Response.json(await scanDue());
}
