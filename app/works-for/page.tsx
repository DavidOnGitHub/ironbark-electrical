import Link from "next/link";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { INDUSTRIES, MODULES, SAME_EVERYWHERE, findIndustry } from "../../src/content/industries";
import { PageHeader } from "../../src/ui/fields";
import { Panel } from "../../src/ui/kit";

export const dynamic = "force-dynamic";

export default async function WorksForPage({ searchParams }: { searchParams: Promise<{ i?: string }> }) {
  await requireBusinessPage(Access.DASHBOARD);
  const current = findIndustry((await searchParams).i);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Works for..." subtitle="This demo is a trade contractor. The same platform fits other businesses - here is how each part maps across." />

      <nav aria-label="Industries" className="flex flex-wrap gap-2 text-sm">
        <Link href="/works-for" aria-current={current ? undefined : "page"} className={`rounded border px-3 py-1.5 font-semibold ${current ? "hover:bg-muted" : "bg-muted"}`}>
          Overview
        </Link>
        {INDUSTRIES.map((i) => (
          <Link key={i.id} href={`/works-for?i=${i.id}`} aria-current={current?.id === i.id ? "page" : undefined} className={`rounded border px-3 py-1.5 font-semibold ${current?.id === i.id ? "bg-muted" : "hover:bg-muted"}`}>
            {i.name.split(" (")[0]}
          </Link>
        ))}
      </nav>

      {current ? (
        <>
          <p className="max-w-3xl text-base">{current.pitch}</p>
          <Panel title={`${current.name}: what each part becomes`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="mapping">
                <thead>
                  <tr className="border-b bg-muted text-left text-[0.8rem] font-semibold text-muted-foreground">
                    <th scope="col" className="px-4.5 py-2.5">In this demo</th>
                    <th scope="col" className="px-4.5 py-2.5">For {current.name.split(" (")[0].toLowerCase()}</th>
                    <th scope="col" className="px-4.5 py-2.5">How it works</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m} className="border-b last:border-0 align-top">
                      <th scope="row" className="px-4.5 py-3 text-left font-semibold">{m}</th>
                      <td className="px-4.5 py-3 font-medium">{current.mapping[m].theirs}</td>
                      <td className="px-4.5 py-3 text-muted-foreground">{current.mapping[m].note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="grid gap-5 md:grid-cols-2">
            <Panel title="First automation we would build">
              <p className="px-4.5 py-4">{current.firstAutomation}</p>
            </Panel>
            <Panel title="What we would tailor">
              <ul className="list-disc px-4.5 py-4 pl-9 text-sm">
                {current.customise.map((c) => (
                  <li key={c} className="py-0.5">{c}</li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      ) : (
        <>
          <Panel title="The same in every business">
            <ul className="list-disc px-4.5 py-4 pl-9 text-sm">
              {SAME_EVERYWHERE.map((s) => (
                <li key={s} className="py-0.5">{s}</li>
              ))}
            </ul>
          </Panel>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((i) => (
              <Link key={i.id} href={`/works-for?i=${i.id}`} className="flex flex-col gap-2 rounded-md border border-t-4 border-t-hivis bg-card p-5 hover:border-input">
                <h2 className="text-xl font-bold">{i.name}</h2>
                <p className="text-sm text-muted-foreground">{i.pitch}</p>
                <p className="mt-auto pt-2 text-sm"><span className="font-semibold">First automation:</span> {i.firstAutomation}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
