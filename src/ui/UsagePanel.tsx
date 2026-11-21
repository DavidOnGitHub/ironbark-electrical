const usd = (n: number) => `$${n.toFixed(2)}`;
const credits = (n: number) => `${n} ${n === 1 ? "credit" : "credits"}`;
const KIND_LABEL = { ERROR: "Bug fixes", FINDING: "Security fixes" } as const;

export interface UsageMonth {
  label: string;
  /** Credits charged for change requests. */
  credits: number;
  /** Spent on error and security fixes. */
  fixSpent: number;
  fixRequests: number;
  byKind: { kind: "FEATURE" | "ERROR" | "FINDING"; spent: number; requests: number }[];
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full ${pct >= 100 ? "bg-destructive" : "bg-foreground/60"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const percent = (used: number, of: number) => (of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 100);

/**
 * The month's two budgets: credits for change requests (what the business pays, from its allowance), and dollars for
 * error and security fixes. With the months before.
 */
export function UsagePanel({ months, allowance, fixBudget, creditStop, fixStop }: { months: UsageMonth[]; allowance: number | null; fixBudget: number | null; creditStop: string | null; fixStop: string | null }) {
  const [now, ...before] = months;
  if (!now) return null;
  const fixes = now.byKind.filter((k) => k.kind !== "FEATURE");
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-foreground/10 p-3" data-testid="it-usage">
      <h2 className="text-sm font-semibold">Usage this month</h2>

      <div className="flex flex-col gap-1" data-testid="it-usage-credits">
        <h3 className="text-sm font-medium">Change requests</h3>
        <p className="text-sm">{allowance === null ? `${credits(now.credits)} used. There is no monthly limit.` : `${credits(now.credits)} used of ${allowance}.`}</p>
        {allowance !== null ? <Bar pct={percent(now.credits, allowance)} label="Credits used" /> : null}
        {creditStop ? <p role="status" className="text-xs text-destructive">{creditStop}</p> : null}
        <p className="text-xs text-muted-foreground">Each change is priced when its plan is ready, and paid for when the plan is approved. A credit is about $10.</p>
      </div>

      <div className="flex flex-col gap-1" data-testid="it-usage-fixes">
        <h3 className="text-sm font-medium">Error and security fixes</h3>
        <p className="text-sm">
          {usd(now.fixSpent)} {fixBudget ? `of ${usd(fixBudget)}` : "spent"} on {now.fixRequests === 1 ? "1 fix" : `${now.fixRequests} fixes`}.
        </p>
        {fixBudget ? <Bar pct={percent(now.fixSpent, fixBudget)} label="Fix budget used" /> : <p className="text-xs text-muted-foreground">No budget is set. The Owner can set one with IT_FIX_MONTHLY_BUDGET_USD.</p>}
        {fixStop ? <p role="status" className="text-xs text-destructive">{fixStop}</p> : null}
        <ul className="text-xs text-muted-foreground">
          {fixes.map((k) => (
            <li key={k.kind}>
              {KIND_LABEL[k.kind as keyof typeof KIND_LABEL]}: {usd(k.spent)} ({k.requests})
            </li>
          ))}
        </ul>
      </div>

      {before.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Earlier: {before.map((m) => `${m.label} ${credits(m.credits)} and ${usd(m.fixSpent)} on fixes`).join("; ")}. Fixes count the builder&apos;s work only, not the AI review or triage.
        </p>
      ) : null}
    </section>
  );
}
