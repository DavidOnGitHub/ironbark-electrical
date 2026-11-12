import { advanceFixQueue, checkItDeploys, checkRevertGuard, createRenderHost, defaultClient, renderConfigFromEnv, syncOpenItRequests, type AiBuilderClient } from "../domain/it";

/**
 * Keeps IT requests in step with the assistant's sessions: every minute, in the worker. Polling needs no webhook and
 * no extra service; it moves to the platform's schedule trigger once there is one. The timer never keeps the process alive.
 */
export function startItSync(everyMs = 60_000, client: AiBuilderClient | null = defaultClient()): void {
  if (!client) {
    console.log("[it] AI Builder is not configured (AI_BUILDER_URL, AI_BUILDER_TOKEN): IT requests are not synced");
    return;
  }
  // Merged changes are followed to the host until they are live; without a host key that part is off.
  const render = renderConfigFromEnv();
  const host = render ? createRenderHost(render) : null;
  if (!render) console.log("[it] RENDER_API_KEY / IT_DEPLOY_SERVICES are not set: merged changes are not followed to their deploy");
  const autoFix = process.env.IT_DEPLOY_AUTOFIX !== "off";
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncOpenItRequests(client);
      if (r.changed) console.log(`[it] ${r.changed} of ${r.checked} request(s) changed`);
      const q = await advanceFixQueue(client);
      if (q.errors || q.findings) console.log(`[it] queue: opened ${q.errors} error fix(es) and ${q.findings} security fix(es)`);
      const g = await checkRevertGuard(client);
      if (g.spikes) console.log(`[it] revert guard: ${g.spikes} change(s) followed by more errors, ${g.reverts} revert(s) prepared`);
      if (host && render) {
        const d = await checkItDeploys(host, render, client, { autoFix });
        if (d.live || d.failed) console.log(`[it] deploys: ${d.live} live, ${d.failed} failed`);
      }
    } catch (err) {
      console.error("[it] sync failed", err);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, everyMs).unref();
}
