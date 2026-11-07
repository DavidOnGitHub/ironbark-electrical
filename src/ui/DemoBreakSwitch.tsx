"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setDemoBreakAction } from "../actions/demo";

/** Staging demo only: switches on one known bug so the IT assistant's detect-and-fix loop can be shown live. */
export function DemoBreakSwitch({ initiallyOn }: { initiallyOn: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initiallyOn);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const flip = () =>
    start(async () => {
      setError(null);
      const r = await setDemoBreakAction(!on);
      if (r.error) setError(r.error);
      else {
        setOn(r.enabled === true);
        router.refresh();
      }
    });

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-dashed border-foreground/20 p-3" data-testid="demo-break">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Demo: break something on purpose</h2>
          <p className="text-xs text-muted-foreground">
            {on
              ? "The bug is ON. Open the Quotes list: it fails while any quote has been sent and is waiting for an answer. The assistant should notice, write a test that fails, and fix it."
              : "Switches on one known bug in the Quotes list so you can watch the assistant find and fix it. Only exists on staging."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {on ? <Link href="/quotes" className="rounded-md border px-3 py-1 text-sm hover:bg-muted">Open Quotes</Link> : null}
          <button type="button" onClick={flip} disabled={pending} className={`rounded-md border px-3 py-1 text-sm ${on ? "" : "border-destructive text-destructive"} hover:bg-muted disabled:opacity-50`}>
            {pending ? "..." : on ? "Switch the bug off" : "Break something"}
          </button>
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
