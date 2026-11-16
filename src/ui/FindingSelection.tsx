"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissSelectedAction, fixSelectedAction } from "../actions/security";
import { isClearNoise, type FindingGroup, type FixKind, type TriageView } from "../domain/it";

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "text-red-700 dark:text-red-400",
  HIGH: "text-red-700 dark:text-red-400",
  MEDIUM: "text-amber-700 dark:text-amber-400",
  LOW: "text-muted-foreground",
  INFO: "text-muted-foreground",
};
const FIX_TONE: Record<FixKind, string> = {
  merged: "text-status-ok",
  inProgress: "text-muted-foreground",
  pending: "text-muted-foreground",
  failed: "text-red-700 dark:text-red-400",
  closed: "text-muted-foreground",
  manual: "text-amber-700 dark:text-amber-400",
};
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const VERDICT_TEXT: Record<string, string> = { real: "AI: real", noise: "AI: probably noise", duplicate: "AI: duplicate", unsure: "AI: not sure" };
const VERDICT_TONE: Record<string, string> = { real: "text-red-700 dark:text-red-400", noise: "text-muted-foreground", duplicate: "text-muted-foreground", unsure: "text-amber-700 dark:text-amber-400" };

/** One line saying what the AI made of a finding, with its reason. Nothing when it has not looked. */
function Verdict({ t }: { t: TriageView | null }) {
  if (!t) return null;
  return (
    <p className="text-xs" data-testid="triage-verdict">
      <span className={`font-medium ${VERDICT_TONE[t.verdict]}`}>{VERDICT_TEXT[t.verdict]} ({t.confidence})</span>
      <span className="text-muted-foreground"> - {t.reason}{t.verdict === "duplicate" && t.duplicateOf ? ` Repeats: ${t.duplicateOf}.` : ""}</span>
    </p>
  );
}

/** What the AI said about a whole row: the verdict when every problem in it agrees, else the worst one for a person to look at. */
const rowTriage = (g: FindingGroup): TriageView | null => {
  const all = g.findings.map((f) => f.triage);
  if (all.some((t) => !t)) return null;
  const order = ["real", "unsure", "duplicate", "noise"];
  return [...(all as TriageView[])].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))[0]!;
};

/**
 * The open findings, one row per package, each with a tick box. Owner and Office choose what to do with the ticked ones:
 * have them all fixed in one change, or accept them without fixing (one reason covers them all).
 */
export function FindingSelection({ groups, canAct }: { groups: FindingGroup[]; canAct: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<"ACCEPTED_RISK" | "FALSE_POSITIVE" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const selectable = useMemo(() => groups.filter((g) => g.selectable), [groups]);
  const chosen = groups.filter((g) => picked.has(g.key));
  const fixable = chosen.filter((g) => g.fixable);
  const noiseGroups = selectable.filter((g) => g.findings.every((f) => isClearNoise(f.triage)));
  const realGroups = selectable.filter((g) => g.findings.some((f) => f.triage?.verdict === "real"));
  const allPicked = selectable.length > 0 && selectable.every((g) => picked.has(g.key));
  const idsOf = (gs: FindingGroup[]) => gs.flatMap((g) => g.findings.map((f) => f.id));

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const finish = (r: { error: string | null; note?: string }, after?: () => void) => {
    if (r.error) return setError(r.error);
    setPicked(new Set());
    setAccepting(null);
    setReason("");
    setNote(r.note ?? null);
    after?.();
    router.refresh();
  };
  const fix = () =>
    start(async () => {
      setError(null);
      setNote(null);
      finish(await fixSelectedAction(idsOf(fixable)));
    });
  const accept = () =>
    start(async () => {
      setError(null);
      setNote(null);
      finish(await dismissSelectedAction(idsOf(chosen), accepting!, reason));
    });

  return (
    <div className="flex flex-col gap-3" data-testid="security-groups">
      {canAct && selectable.length > 0 ? (
        <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border border-foreground/10 bg-background p-2" data-testid="security-selection-bar">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.map((g) => g.key)))} disabled={pending} />
              Select all ({selectable.length})
            </label>
            <span className="text-xs text-muted-foreground">{chosen.length === 0 ? "Tick the findings to deal with." : `${chosen.length} selected`}</span>
            {realGroups.length > 0 || noiseGroups.length > 0 ? (
              <span className="flex flex-wrap gap-2" data-testid="triage-select">
                {realGroups.length > 0 ? (
                  <button type="button" onClick={() => setPicked(new Set(realGroups.map((g) => g.key)))} disabled={pending} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
                    Select AI-judged real ({realGroups.length})
                  </button>
                ) : null}
                {noiseGroups.length > 0 ? (
                  <button type="button" onClick={() => setPicked(new Set(noiseGroups.map((g) => g.key)))} disabled={pending} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
                    Select AI-judged noise ({noiseGroups.length})
                  </button>
                ) : null}
              </span>
            ) : null}
            <span className="flex flex-wrap gap-2">
              <button type="button" onClick={fix} disabled={pending || fixable.length === 0} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
                {pending && !accepting ? "Starting..." : `Fix selected${fixable.length ? ` (${fixable.length})` : ""}`}
              </button>
              <button type="button" onClick={() => setAccepting("ACCEPTED_RISK")} disabled={pending || chosen.length === 0} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
                Accept without fixing
              </button>
              <button type="button" onClick={() => setAccepting("FALSE_POSITIVE")} disabled={pending || chosen.length === 0} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
                False positive
              </button>
            </span>
          </div>
          {accepting ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                {accepting === "ACCEPTED_RISK" ? "Why is this acceptable? One reason covers all the selected findings." : "What makes these a false alarm? (optional)"}
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <span className="flex gap-2">
                <button type="button" onClick={accept} disabled={pending || (accepting === "ACCEPTED_RISK" && reason.trim().length < 3)} className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50">
                  {pending ? "Saving..." : accepting === "ACCEPTED_RISK" ? `Accept the risk (${chosen.length})` : `Mark as false positive (${chosen.length})`}
                </button>
                <button type="button" onClick={() => setAccepting(null)} disabled={pending} className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:underline">
                  Cancel
                </button>
              </span>
            </div>
          ) : null}
          {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
        </div>
      ) : null}
      {note ? <p role="status" className="rounded-md border border-foreground/10 bg-muted px-3 py-2 text-sm">{note}</p> : null}
      <ul className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g.key} className="flex gap-2 rounded-lg border border-foreground/10 p-2 text-sm">
            {canAct ? (
              <input type="checkbox" aria-label={`Select ${g.title}`} className="mt-1" checked={picked.has(g.key)} onChange={() => toggle(g.key)} disabled={!g.selectable || pending} />
            ) : null}
            <div className="min-w-0 flex-1">
              <p>
                <span className={`font-medium ${SEVERITY_TONE[g.severity]}`}>{label(g.severity)}</span> - <span className="font-medium">{g.title}</span>
                {g.findings.length > 1 ? <span className="text-muted-foreground"> ({g.findings.length} problems)</span> : null}
              </p>
              <Verdict t={rowTriage(g)} />
              <p className={`mt-1 text-xs ${FIX_TONE[g.fix.kind]}`} data-testid="security-fix-state">
                {g.fix.text}
                {g.fix.requestId ? (
                  <>
                    {" "}
                    <a href={`/it?tab=security&open=${encodeURIComponent(g.fix.requestId)}`} className="underline">Open {g.fix.requestNumber}</a>
                  </>
                ) : null}
                {g.fix.prUrl ? (
                  <>
                    {" "}
                    <a href={g.fix.prUrl} target="_blank" rel="noreferrer" className="underline">View the change &#8599;</a>
                  </>
                ) : null}
              </p>
              <details className="mt-1" open={g.findings.length === 1}>
                <summary className="cursor-pointer text-xs text-muted-foreground">{g.findings.length === 1 ? "Details" : `The ${g.findings.length} problems`}</summary>
                <ul className="mt-1 flex flex-col gap-2">
                  {g.findings.map((f) => (
                    <li key={f.id}>
                      <p>
                        <span className={`font-medium ${SEVERITY_TONE[f.severity]}`}>{label(f.severity)}</span> - {f.message}
                      </p>
                      {g.findings.length > 1 ? <Verdict t={f.triage} /> : null}
                      <p className="text-xs text-muted-foreground">
                        {f.tool}{f.file ? ` - ${f.file}` : ""}{f.fixedIn ? ` - fixed in ${f.fixedIn}` : ""} - seen {f.seenCount} {f.seenCount === 1 ? "time" : "times"}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
