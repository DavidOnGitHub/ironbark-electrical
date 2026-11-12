"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanNowAction } from "../actions/security";

/** Starts a security scan. The results are not instant (the scan takes a few minutes), so say so and offer a refresh. */
export function ScanNowButton() {
  const router = useRouter();
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setNote(null);
      const r = await scanNowAction();
      setNote(r.error ? { tone: "bad", text: r.error } : { tone: "ok", text: "Scan started. It takes a few minutes; refresh this page to see the results." });
      if (r.error) router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={run} disabled={pending} className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50">
        {pending ? "Starting..." : "Scan now"}
      </button>
      {note ? (
        <p role={note.tone === "bad" ? "alert" : "status"} className={`max-w-xs text-right text-xs ${note.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
