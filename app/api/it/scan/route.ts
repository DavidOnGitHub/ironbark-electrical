import { ingestScan, triageScan, verifyScanSignature } from "../../../../src/domain/it";
import { ZodError } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scheduled security scans (GitHub Actions) post their normalised report here. Not behind sign-in - the HMAC
 * signature is the proof. A scan id is accepted once, so a replayed request changes nothing.
 */
export async function POST(request: Request) {
  const secret = process.env.IT_SCAN_SECRET;
  if (!secret) return Response.json({ error: "Security scan intake is not configured." }, { status: 503 });
  const body = await request.text();
  const checked = verifyScanSignature({ secret, timestamp: request.headers.get("x-scan-timestamp"), signature: request.headers.get("x-scan-signature"), body });
  if (!checked.ok) return Response.json({ error: checked.reason }, { status: 401 });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "Bad payload." }, { status: 400 });
  }
  try {
    const result = await ingestScan(json);
    // Fixes for the worst new findings. A failure here must not make the scanner retry a report that was stored.
    const triage = result.duplicate ? null : await triageScan((json as { scanId: string }).scanId).catch(() => null);
    return Response.json({ received: true, ...result, triage });
  } catch (err) {
    if (err instanceof ZodError) return Response.json({ error: "Invalid report.", issues: err.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
    throw err;
  }
}
