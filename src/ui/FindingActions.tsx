"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissFindingAction, reopenFindingAction } from "../actions/security";

type Mode = "ACCEPTED_RISK" | "FALSE_POSITIVE";
const COPY: Record<Mode, { button: string; ask: string; confirm: string; required: boolean }> = {
  ACCEPTED_RISK: { button: "Accept the risk", ask: "Why is this acceptable?", confirm: "Accept the risk", required: true },
  FALSE_POSITIVE: { button: "False positive", ask: "What makes it a false alarm? (optional)", confirm: "Mark as false positive", required: false },
};

/** Owner and Office: decide a finding is not worth fixing. This calls off a fix that is under way, and frees the line for the next one. */
export function FindingActions({ id, hasFix }: { id: string; hasFix: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await dismissFindingAction(id, mode!, reason);
      if (r.error) setError(r.error);
      else {
        setMode(null);
        router.refresh();
      }
    });

  if (!mode) {
    return (
      <span className="flex flex-wrap gap-2">
        {(Object.keys(COPY) as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted">
            {COPY[m].button}
          </button>
        ))}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">
        {COPY[mode].ask}
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground" />
      </label>
      {hasFix ? <span className="text-xs text-muted-foreground">The fix that is under way will be called off.</span> : null}
      <span className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending || (COPY[mode].required && reason.trim().length < 3)} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
          {pending ? "Saving..." : COPY[mode].confirm}
        </button>
        <button type="button" onClick={() => setMode(null)} disabled={pending} className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:underline">
          Cancel
        </button>
      </span>
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

export function ReopenButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await reopenFindingAction(id);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
        className="self-start rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Reopening..." : "Reopen"}
      </button>
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
