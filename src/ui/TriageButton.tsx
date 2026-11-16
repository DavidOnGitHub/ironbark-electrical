"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triageFindingsAction } from "../actions/security";

/**
 * Asks the AI for its opinion of the findings nobody has judged yet. It also happens by itself after each scan; this is
 * for the ones already there. It waits for the answer (a minute or two), then the list shows the verdicts.
 */
export function TriageButton({ waiting }: { waiting: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      setNote(null);
      try {
        const r = await triageFindingsAction();
        if (r.error) setError(r.error);
        else {
          setNote(r.judged ? `The AI looked at ${r.judged} ${r.judged === 1 ? "finding" : "findings"}.` : "Nothing new to look at.");
          router.refresh();
        }
      } catch {
        setError("Could not ask the AI. Reload the page and try again.");
      }
    });

  return (
    <div className="flex flex-col items-start gap-1" data-testid="triage-ai">
      <button type="button" onClick={run} disabled={pending} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
        {pending ? "Asking the AI..." : `Triage with AI (${waiting} waiting)`}
      </button>
      {note ? <span role="status" className="text-xs text-muted-foreground">{note}</span> : null}
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
