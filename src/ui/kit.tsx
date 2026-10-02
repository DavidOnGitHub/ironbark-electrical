import Link from "next/link";
import type { ReactNode } from "react";

/** Building blocks of the Ironbark theme (design-previews/ironbark): KPI tiles with a coloured top rule,
 * panels with a titled header, and the row layout shared by every list. */

export type Tone = "neutral" | "warn" | "bad" | "info";
const RULE: Record<Tone, string> = {
  neutral: "border-t-border-strong",
  warn: "border-t-hivis",
  bad: "border-t-status-bad",
  info: "border-t-status-info",
};
const SUB: Record<Tone, string> = { neutral: "text-muted-foreground", warn: "font-semibold text-status-warn", bad: "font-semibold text-status-bad", info: "text-muted-foreground" };

/** "$21,846.30" with the cents set smaller, so the whole dollars read first. */
export function Money({ cents, className }: { cents: number; className?: string }) {
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return (
    <span className={className}>
      {cents < 0 ? "-" : ""}${Number(whole).toLocaleString("en-AU")}
      <span className="text-[0.62em]">.{frac}</span>
    </span>
  );
}

export function Kpi({ href, label, value, sub, tone = "neutral" }: { href?: string; label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const body = (
    <div className={`flex h-full flex-col gap-1.5 rounded-md border border-t-4 bg-card px-5 pt-4 pb-4 shadow-[0_1px_0_rgba(31,26,23,.08)] ${RULE[tone]} ${href ? "hover:border-input" : ""}`}>
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <span className="font-heading text-[2.5rem] leading-none font-bold tabular-nums">{value}</span>
      {sub ? <span className={`text-[0.84rem] ${SUB[tone]}`}>{sub}</span> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-md">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Panel({ title, count, more, children }: { title: string; count?: number; more?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border bg-card shadow-[0_1px_0_rgba(31,26,23,.08)]">
      <div className="flex items-center gap-2.5 border-b px-4.5 py-3.5">
        <h2 className="text-xl font-bold">{title}</h2>
        {count != null ? <span className="rounded-full border bg-muted px-2 text-[0.8rem] font-bold text-muted-foreground tabular-nums">{count}</span> : null}
        {more ? (
          <Link href={more.href} className="ml-auto text-sm font-semibold text-link underline-offset-2 hover:underline">
            {more.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Rows({ children, empty }: { children: ReactNode[]; empty?: string }) {
  if (children.length === 0) return <p className="px-4.5 py-6 text-sm text-muted-foreground">{empty ?? "Nothing here."}</p>;
  return <ul className="divide-y">{children.map((c, i) => <li key={i}>{c}</li>)}</ul>;
}

/** One list row: optional lead (time, icon), title + meta on the left, side content on the right. Links when `href` is given. */
export function Row({ href, lead, title, meta, side }: { href?: string; lead?: ReactNode; title: ReactNode; meta?: ReactNode; side?: ReactNode }) {
  const inner = (
    <>
      {lead}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{title}</p>
        {meta ? <p className="truncate text-[0.84rem] text-muted-foreground">{meta}</p> : null}
      </div>
      {side ? <div className="flex shrink-0 items-center gap-2.5 text-right">{side}</div> : null}
    </>
  );
  const cls = "flex min-h-[60px] items-center gap-3.5 px-4.5 py-3";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-muted`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** How long ago, e.g. "2 h"; waits over a day read bold in the warning colour. */
export function Age({ hours }: { hours: number }) {
  const text = hours < 1 ? "<1 h" : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
  return <span className={`min-w-11 text-right text-[0.84rem] ${hours > 24 ? "font-bold text-status-warn" : "text-muted-foreground"}`}>{text}{hours > 24 ? <span className="sr-only"> - longer than a day</span> : null}</span>;
}
