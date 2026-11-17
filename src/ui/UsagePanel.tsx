const usd = (n: number) => `$${n.toFixed(2)}`;
const KIND_LABEL = { FEATURE: "Change requests", ERROR: "Bug fixes", FINDING: "Security fixes" } as const;

export interface UsageMonth {
  label: string;
  spent: number;
  requests: number;
  byKind: { kind: keyof typeof KIND_LABEL; spent: number; requests: number }[];
}

/** What the IT assistant's builder work has cost this month and the months before, against the budget when there is one. */
export function UsagePanel({ months, budget, pause }: { months: UsageMonth[]; budget: number | null; pause: string | null }) {
  const [now, ...before] = months;
  if (!now) return null;
  const pct = budget ? Math.min(100, Math.round((now.spent / budget) * 100)) : null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-3" data-testid="it-usage">
      <h2 className="text-sm font-semibold">Usage this month</h2>
      <p className="text-sm">
        {usd(now.spent)} {budget ? `of ${usd(budget)}` : "spent"} on {now.requests === 1 ? "1 request" : `${now.requests} requests`}.
      </p>
      {pct !== null ? (
        <div className="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
          <div className={`h-full ${pct >= 100 ? "bg-destructive" : "bg-foreground/60"}`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No budget is set. The Owner can set one with IT_MONTHLY_BUDGET_USD.</p>
      )}
      {pause ? <p role="status" className="text-xs text-destructive">{pause}</p> : null}
      <ul className="text-xs text-muted-foreground">
        {now.byKind.map((k) => (
          <li key={k.kind}>
            {KIND_LABEL[k.kind]}: {usd(k.spent)} ({k.requests})
          </li>
        ))}
      </ul>
      {before.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Earlier: {before.map((m) => `${m.label} ${usd(m.spent)}`).join(", ")}. Counts the builder&apos;s work only, not the AI review or triage.
        </p>
      ) : null}
    </section>
  );
}
