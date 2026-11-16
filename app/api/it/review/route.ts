import { after } from "next/server";
import { runAiReview, runAiTriage, verifyScanSignature } from "../../../../src/domain/it";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A review reads dozens of files and waits on a model, so it can take a few minutes. */
export const maxDuration = 300;

/**
 * The monthly workflow asks for the AI security review here. Signed like the scan report (same secret and scheme), so only
 * the workflow can start one. It waits for the review, so a failure shows in the workflow log; the body is {"runId": "..."}
 * and only names the run. See src/domain/it/aiReview.ts.
 */
export async function POST(request: Request) {
  const secret = process.env.IT_SCAN_SECRET;
  if (!secret) return Response.json({ error: "Security scan intake is not configured." }, { status: 503 });
  const body = await request.text();
  const checked = verifyScanSignature({ secret, timestamp: request.headers.get("x-scan-timestamp"), signature: request.headers.get("x-scan-signature"), body });
  if (!checked.ok) return Response.json({ error: checked.reason }, { status: 401 });
  let runId: string | undefined;
  try {
    const parsed = JSON.parse(body || "{}") as { runId?: unknown };
    if (typeof parsed.runId === "string") runId = parsed.runId;
  } catch {
    return Response.json({ error: "Bad payload." }, { status: 400 });
  }
  const result = await runAiReview(process.env, { runId });
  if (!result.ok) return Response.json({ error: result.reason }, { status: result.status });
  if (result.ingest.created + result.ingest.reopened > 0) after(() => runAiTriage().catch((err) => console.error("AI triage failed", err)));
  return Response.json({ reviewed: true, commit: result.commit, compared: result.compared, filesRead: result.filesRead, findings: result.findings, ...result.ingest });
}
