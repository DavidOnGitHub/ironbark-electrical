"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reopenFindingAction } from "../actions/security";

/** Owner and Office: undo a dismissal. */
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
