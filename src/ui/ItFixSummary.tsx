import type { FixSummary } from "../domain/it/fixSummary";

const MARK = { ok: "text-green-700", bad: "text-destructive", wait: "text-amber-600" } as const;
const GLYPH = { ok: "✓", bad: "!", wait: "…" } as const;

/** The fix in plain words: what went wrong, what happens now, and proof. No code, no file names, no links to the code. */
export function ItFixSummary({ summary }: { summary: FixSummary }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-foreground/10 p-3" aria-label="What changed" data-testid="it-fix-summary">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Before</h3>
          <p className="text-sm">{summary.before}</p>
        </div>
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Now</h3>
          <p className="text-sm">{summary.after ?? "The assistant is still working on it."}</p>
        </div>
      </div>
      {summary.checks.length > 0 || summary.counts || summary.previewUrl ? (
        <ul className="flex flex-col gap-1 border-t border-foreground/10 pt-2 text-sm">
          {summary.checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span aria-hidden className={`w-4 text-center font-semibold ${MARK[c.state]}`}>{GLYPH[c.state]}</span>
              {c.label}
            </li>
          ))}
          {summary.counts ? <li className="text-muted-foreground">{summary.counts}</li> : null}
          {summary.previewUrl ? (
            <li>
              <a href={summary.previewUrl} target="_blank" rel="noreferrer" className="underline">Try it in the preview &#8599;</a>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
