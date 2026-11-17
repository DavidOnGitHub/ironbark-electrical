import Link from "next/link";
import { Access } from "../../../src/access";
import { requireBusinessPage } from "../../../src/guard";
import { AUDIT_ACTORS, AUDIT_FILTERS, AUDIT_FILTER_LABEL, isAuditActor, isAuditFilter, listAudit, IT_TAB_OF_KIND } from "../../../src/domain/it";
import { PageHeader } from "../../../src/ui/fields";

export const dynamic = "force-dynamic";

const ACTOR_LABEL = { any: "Anyone", people: "People", assistant: "The assistant" } as const;
const when = (d: Date) => d.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string; who?: string; before?: string }> }) {
  await requireBusinessPage(Access.IT_AUDIT);
  const params = await searchParams;
  const filter = isAuditFilter(params.type) ? params.type : "all";
  const actor = isAuditActor(params.who) ? params.who : "any";
  const page = await listAudit({ filter, actor, before: params.before });
  const href = (over: { type?: string; who?: string; before?: string | null }) => {
    const q = new URLSearchParams();
    const type = over.type ?? filter;
    const who = over.who ?? actor;
    if (type !== "all") q.set("type", type);
    if (who !== "any") q.set("who", who);
    if (over.before) q.set("before", over.before);
    const s = q.toString();
    return `/it/audit${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="IT audit log" subtitle="Everything the IT assistant did and everything people decided about it, newest first." />
      <p className="text-sm"><Link href="/it" className="underline">Back to IT</Link></p>
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filter by what it was about">
        {AUDIT_FILTERS.map((f) => (
          <Link key={f} href={href({ type: f })} aria-current={f === filter ? "page" : undefined} className={`rounded-md border px-3 py-1 ${f === filter ? "bg-muted font-medium" : "hover:bg-muted"}`}>
            {AUDIT_FILTER_LABEL[f]}
          </Link>
        ))}
      </nav>
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filter by who did it">
        {AUDIT_ACTORS.map((a) => (
          <Link key={a} href={href({ who: a })} aria-current={a === actor ? "page" : undefined} className={`rounded-md border px-3 py-1 ${a === actor ? "bg-muted font-medium" : "hover:bg-muted"}`}>
            {ACTOR_LABEL[a]}
          </Link>
        ))}
      </nav>
      {page.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="audit-empty">Nothing recorded for this filter yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-foreground/10 rounded-xl border border-foreground/10" data-testid="audit-log">
          {page.lines.map((l) => (
            <li key={l.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
              <p>
                {l.request ? (
                  <Link href={`/it?tab=${IT_TAB_OF_KIND[l.request.kind]}&open=${encodeURIComponent(l.request.id)}`} className="mr-1.5 text-xs underline">{l.request.number}</Link>
                ) : null}
                {l.summary}
              </p>
              {l.detail ? <p className="whitespace-pre-line text-xs text-muted-foreground">{l.detail}</p> : null}
              <p className="text-xs text-muted-foreground">
                {l.actor}{l.actorType === "USER" ? " (person)" : ""} - {when(l.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
      {page.next ? <p className="text-sm"><Link href={href({ before: page.next })} className="underline">Older entries</Link></p> : null}
    </div>
  );
}
