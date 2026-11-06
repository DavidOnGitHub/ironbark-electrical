"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ItRequestDetail } from "./ItRequestDetail";
import type { ItRequestView } from "../actions/it";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** One list of IT requests. A row opens in place, so a request is worked (answered, approved, accepted) right here. */
export function ItHistory({ requests, empty, initialOpenId }: { requests: ItRequestView[]; empty: string; initialOpenId: string | null }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);

  if (requests.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;

  return (
    <ul className="flex flex-col gap-2" data-testid="it-history">
      {requests.map((r) => {
        const open = openId === r.id;
        return (
          <li key={r.id} className="rounded-xl border border-foreground/10">
            <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : r.id)} className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-left">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="block text-xs text-muted-foreground">{r.number} - {r.requestedBy} - {when(r.createdAt)}</span>
              </span>
              <span className="flex flex-col items-end gap-0.5 text-right">
                <span className={`text-sm ${r.failed ? "text-destructive" : ""}`}>{r.statusLabel}</span>
                {r.waiting ? <span className="text-xs font-medium underline">{r.waiting}</span> : null}
              </span>
            </button>
            {open ? (
              <div className="border-t border-foreground/10 p-3">
                <ItRequestDetail id={r.id} onBack={() => setOpenId(null)} onChanged={() => router.refresh()} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
