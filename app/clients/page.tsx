import Link from "next/link";
import { hasAnyRole } from "@kabosh-digital/m-street-kit/auth";
import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card } from "@kabosh-digital/m-street-kit/ui/card";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { listClients, listTags } from "../../src/domain/clients";
import { PageHeader } from "../../src/ui/fields";

export const dynamic = "force-dynamic";

export default async function ClientsPage(props: { searchParams: Promise<{ q?: string; tag?: string; archived?: string }> }) {
  const user = await requireBusinessPage(Access.CLIENTS_READ);
  const { q, tag, archived } = await props.searchParams;
  const [clients, tags] = await Promise.all([listClients({ q, tag, includeArchived: archived === "1" }), listTags()]);
  const canWrite = hasAnyRole(user.roles, Access.CLIENTS_WRITE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} ${clients.length === 1 ? "client" : "clients"}${q ? ` matching "${q}"` : ""}${tag ? ` tagged ${tag}` : ""}`}
        actions={canWrite ? <Button asChild><Link href="/clients/new">New client</Link></Button> : null}
      />
      <form className="flex flex-wrap items-center gap-2" action="/clients">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search name, email, phone or address" className="max-w-sm bg-card" />
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        <Button type="submit" variant="outline">Search</Button>
        {(q || tag) ? <Button asChild variant="ghost"><Link href="/clients">Clear</Link></Button> : null}
      </form>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-sm">
          {tags.map((t) => (
            <Link key={t} href={`/clients?tag=${encodeURIComponent(t)}`}>
              <Badge variant={tag === t ? "default" : "outline"}>{t}</Badge>
            </Link>
          ))}
        </div>
      ) : null}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Contact</th>
              <th className="px-4 py-2.5 font-semibold">Sites</th>
              <th className="px-4 py-2.5 font-semibold">Tags</th>
              <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No clients found.</td>
              </tr>
            ) : null}
            {clients.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  {c.archivedAt ? <Badge variant="secondary" className="ml-2">archived</Badge> : null}
                  <p className="text-xs text-muted-foreground">{c.type === "COMPANY" ? "Company" : "Person"}</p>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  <p>{c.email ?? "-"}</p>
                  <p className="text-muted-foreground">{c.phone ?? "-"}</p>
                </td>
                <td className="px-4 py-2.5 text-xs">{[...new Set(c.sites.map((s) => s.suburb))].join(", ") || "-"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <Badge key={t} variant="outline">{t}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c._count.requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
