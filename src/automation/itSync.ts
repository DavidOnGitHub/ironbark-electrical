import { defaultClient, syncOpenItRequests, type AiBuilderClient } from "../domain/it";

/**
 * Keeps IT requests in step with the assistant's sessions: every minute, in the worker. Polling needs no webhook and
 * no extra service; it moves to the platform's schedule trigger once there is one. The timer never keeps the process alive.
 */
export function startItSync(everyMs = 60_000, client: AiBuilderClient | null = defaultClient()): void {
  if (!client) {
    console.log("[it] AI Builder is not configured (AI_BUILDER_URL, AI_BUILDER_TOKEN): IT requests are not synced");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncOpenItRequests(client);
      if (r.changed) console.log(`[it] ${r.changed} of ${r.checked} request(s) changed`);
    } catch (err) {
      console.error("[it] sync failed", err);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, everyMs).unref();
}
