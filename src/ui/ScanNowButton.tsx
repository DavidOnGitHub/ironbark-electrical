"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanNowAction } from "../actions/security";

const POLL_MS = 10_000;

/**
 * Starts a security scan and shows what it is doing. The scan takes a few minutes, so while one runs (started here, from
 * GitHub, or by the schedule) the button says so, links to the run, and the page refreshes itself until it is over and
 * the new results are there.
 */
export function ScanNowButton({ running, since, runUrl }: { running: boolean; since: string | null; runUrl: string | null }) {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = running || started;

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, router]);

  const run = () =>
    start(async () => {
      setError(null);
      try {
        const r = await scanNowAction();
        if (r.error) setError(r.error);
        else {
          setStarted(true);
          router.refresh();
        }
      } catch {
        setError("Could not start the scan. Reload the page and try again.");
      }
    });

  // Until the server reports the run, a scan just started here counts as running. That bridge is short: GitHub takes a few
  // seconds to list the run, and after that the server's answer is what keeps the button busy.
  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => setStarted(false), 45_000);
    return () => clearTimeout(timer);
  }, [started]);

  const since_ = since ? new Date(since).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={run} disabled={pending || busy} className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-60">
        {pending ? "Starting..." : busy ? "Scan running..." : "Scan now"}
      </button>
      {busy ? (
        <p role="status" className="max-w-xs text-right text-xs text-muted-foreground" data-testid="scan-running">
          {since_ ? `Started ${since_}. ` : "Just started. "}It takes a few minutes; this page updates when it is done.
          {runUrl ? (
            <>
              {" "}
              <a href={runUrl} target="_blank" rel="noreferrer" className="underline">
                Watch the run
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="max-w-xs rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
