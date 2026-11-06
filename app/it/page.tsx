import Link from "next/link";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { listItRequestsAction } from "../../src/actions/it";
import { IT_TABS, IT_TAB_OF_KIND, type ItTab } from "../../src/domain/it/status";
import { PageHeader } from "../../src/ui/fields";
import { ItHistory } from "../../src/ui/ItHistory";

export const dynamic = "force-dynamic";

const TAB_LABEL: Record<ItTab, string> = { features: "Feature requests", fixes: "Bug fixes", security: "Security scans" };
const TAB_ABOUT: Record<ItTab, string> = {
  features: "Changes the team asked the IT assistant for, from idea to live.",
  fixes: "Errors the assistant found or was told about, and the fixes it made - including a change that failed to deploy.",
  security: "What the security scans found and what was done about it.",
};
const EMPTY: Record<ItTab, string> = {
  features: "No feature requests yet. Ask the IT assistant (the button at the bottom right) for a change.",
  fixes: "No bug fixes yet. When an error is found, or a change fails to deploy, the fix appears here.",
  security: "No scan results yet. Scheduled security scans are not switched on for this app; when they are, each finding and its fix will be listed here.",
};

export default async function ItPage({ searchParams }: { searchParams: Promise<{ tab?: string; open?: string }> }) {
  await requireBusinessPage(Access.IT_ASK);
  const params = await searchParams;
  const tab = (IT_TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as ItTab) : "features";
  const all = await listItRequestsAction(200);
  const byTab = (t: ItTab) => all.filter((r) => IT_TAB_OF_KIND[r.kind] === t);
  const rows = byTab(tab);
  const needsYou = all.filter((r) => r.waiting).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="IT" subtitle={TAB_ABOUT[tab]} />
      {needsYou ? <p className="rounded-md border border-foreground/10 bg-muted px-3 py-2 text-sm">{needsYou === 1 ? "1 request needs you." : `${needsYou} requests need you.`}</p> : null}
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="IT history">
        {IT_TABS.map((t) => (
          <Link key={t} href={`/it?tab=${t}`} aria-current={t === tab ? "page" : undefined} className={`rounded-md border px-3 py-1 ${t === tab ? "bg-muted font-medium" : "hover:bg-muted"}`}>
            {TAB_LABEL[t]} <span className="text-muted-foreground">{byTab(t).length}</span>
          </Link>
        ))}
      </nav>
      <ItHistory key={tab} requests={rows} empty={EMPTY[tab]} initialOpenId={rows.some((r) => r.id === params.open) ? params.open! : null} />
    </div>
  );
}
