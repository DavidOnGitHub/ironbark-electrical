import type { ItFeedLine } from "../actions/it";

const DOT: Record<ItFeedLine["tone"], string> = {
  ok: "bg-green-600",
  bad: "bg-destructive",
  wait: "bg-amber-500",
  info: "bg-foreground/40",
};

const stamp = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** An error's story, top to bottom: detected, fix started, test added, PR, CI, preview, approval, merged, confirmed fixed. */
export function ItFeed({ lines }: { lines: ItFeedLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Activity" data-testid="it-feed">
      <h3 className="text-sm font-medium">What happened</h3>
      <ol className="flex flex-col">
        {lines.map((l, i) => (
          <li key={`${i}-${l.text}`} className="flex gap-3">
            <span className="flex flex-col items-center" aria-hidden>
              <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[l.tone]}${l.at ? "" : " animate-pulse"}`} />
              {i < lines.length - 1 ? <span className="w-px flex-1 bg-foreground/15" /> : null}
            </span>
            <div className="min-w-0 pb-3">
              <p className="text-sm">
                {l.request ? <span className="mr-1.5 text-xs text-muted-foreground">{l.request}</span> : null}
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noreferrer" className="underline">{l.text} &#8599;</a>
                ) : (
                  l.text
                )}
              </p>
              {l.detail ? <p className="break-words text-xs text-muted-foreground">{l.detail}</p> : null}
              {l.at ? <p className="text-xs text-muted-foreground">{stamp(l.at)}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
