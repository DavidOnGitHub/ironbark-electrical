"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetDemoBugsAction, setDemoBugAction } from "../actions/demo";

export interface DemoBugRow {
  id: string;
  title: string;
  page: string;
  effect: string;
  on: boolean;
}

/**
 * Staging demo only: switches on one known bug so the IT assistant's detect-and-fix loop can be shown live. A fix
 * removes its bug from the code for good, so there is a small pool: switch on one that has not been fixed yet.
 */
export function DemoBreakSwitch({ bugs }: { bugs: DemoBugRow[] }) {
  const router = useRouter();
  const [state, setState] = useState(bugs);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const flip = (bug: DemoBugRow) =>
    start(async () => {
      setError(null);
      const r = await setDemoBugAction(bug.id, !bug.on);
      if (r.error) setError(r.error);
      else {
        setState((rows) => rows.map((b) => (b.id === bug.id ? { ...b, on: r.enabled === true } : b)));
        router.refresh();
      }
    });

  const reset = () =>
    start(async () => {
      setError(null);
      const r = await resetDemoBugsAction();
      if (r.error) setError(r.error);
      else {
        setState((rows) => rows.map((b) => ({ ...b, on: false })));
        router.refresh();
      }
    });

  const anyOn = state.some((b) => b.on);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-foreground/20 p-3" data-testid="demo-break">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Demo: break something on purpose</h2>
          <p className="text-xs text-muted-foreground">
            Switches on one known bug so you can watch the assistant find and fix it. Once the assistant has fixed a bug it is gone for good: pick one that has not been fixed yet. Only exists on staging.
          </p>
        </div>
        {anyOn ? (
          <button type="button" onClick={reset} disabled={pending} className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50">
            Switch all bugs off
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2">
        {state.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2" data-testid={`demo-bug-${b.id}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium">{b.title}</p>
              <p className="text-xs text-muted-foreground">{b.on ? `ON. ${b.effect} The assistant should notice, write a test that fails, and fix it.` : b.effect}</p>
            </div>
            <div className="flex items-center gap-2">
              {b.on ? <Link href={b.page} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">Open</Link> : null}
              <button type="button" onClick={() => flip(b)} disabled={pending} className={`rounded-md border px-3 py-1 text-sm ${b.on ? "" : "border-destructive text-destructive"} hover:bg-muted disabled:opacity-50`}>
                {pending ? "..." : b.on ? "Switch off" : "Break this"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
