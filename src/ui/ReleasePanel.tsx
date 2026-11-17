"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { releaseAction } from "../actions/security";

/** What is on staging but not yet in production, and the Owner's button that releases it. */
export function ReleasePanel({ ahead, changes, prUrl, autoMerge, canRelease }: { ahead: number; changes: string[]; prUrl: string | null; autoMerge: boolean; canRelease: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const release = () =>
    start(async () => {
      setError(null);
      setNote(null);
      try {
        const r = await releaseAction();
        if (r.error) setError(r.error);
        else {
          setNote(r.state === "merged" ? "Released." : "Approved. It goes to production by itself as soon as its checks pass.");
          router.refresh();
        }
      } catch {
        setError("Could not start the release. Reload the page and try again.");
      }
    });

  const waitingOnChecks = Boolean(prUrl) && autoMerge;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-3" data-testid="it-release">
      <h2 className="text-sm font-semibold">Release to production</h2>
      <p className="text-xs text-muted-foreground">
        {waitingOnChecks ? "Approved. It goes to production by itself as soon as its checks pass." : `${ahead === 1 ? "1 change is" : `${ahead} changes are`} on staging and not in production yet.`}
      </p>
      {changes.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {canRelease && !waitingOnChecks ? (
          <button type="button" onClick={release} disabled={pending} className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50">
            {pending ? "Releasing..." : "Release to production"}
          </button>
        ) : null}
        {!canRelease ? <span className="text-xs text-muted-foreground">Only the Owner can release.</span> : null}
        {prUrl ? <a href={prUrl} target="_blank" rel="noreferrer" className="text-xs underline">See it on GitHub</a> : null}
        {note ? <span role="status" className="text-xs text-muted-foreground">{note}</span> : null}
        {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
      </div>
    </section>
  );
}
