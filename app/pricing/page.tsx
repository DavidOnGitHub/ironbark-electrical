import { Badge } from "@kabosh-digital/m-street-kit/ui/badge";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { Access } from "../../src/access";
import { requireBusinessPage } from "../../src/guard";
import { bundleLines, listBundles, listPriceItems } from "../../src/domain/pricing";
import { savePriceItemAction, toggleBundleAction, togglePriceItemAction } from "../../src/actions/pricing";
import { BundleEditor } from "../../src/ui/BundleEditor";
import { formatMoney } from "../../src/lib/money";
import { ActionForm } from "../../src/ui/ActionForm";
import { PageHeader } from "../../src/ui/fields";
import { KIND_OPTIONS, PriceItemFields } from "../../src/ui/PriceItemFields";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  await requireBusinessPage(Access.PRICING);
  const [items, bundles] = await Promise.all([listPriceItems(), listBundles()]);
  const pickable = items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, unit: i.unit, priceCents: i.priceCents }));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Price list" subtitle="Labour rates, call-out fee, standard jobs and materials. Prices are per unit, excluding GST." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add an item</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={savePriceItemAction} submitLabel="Add to price list" successMessage="Added." resetOnSuccess>
            <PriceItemFields />
          </ActionForm>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2" data-testid="bundles">
        <h2 className="text-sm font-semibold">
          Bundles <span className="text-muted-foreground">({bundles.length})</span>
        </h2>
        <p className="text-xs text-muted-foreground">A bundle adds several price-list items to a quote in one click, at today&rsquo;s prices. Describe what it covers - the quote&rsquo;s &ldquo;Suggest lines&rdquo; uses that to match enquiries.</p>
        <Card className="p-0">
          <ul className="divide-y">
            {bundles.length === 0 ? <li className="px-4 py-4 text-sm text-muted-foreground">None yet.</li> : null}
            {bundles.map((b) => {
              const lines = bundleLines(b);
              return (
                <li key={b.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer font-medium">
                        {b.name} {!b.active ? <Badge variant="secondary" className="ml-1">retired</Badge> : null}
                        <span className="ml-2 font-normal text-muted-foreground">{lines.length} lines, {formatMoney(lines.reduce((t, l) => t + Math.round(l.quantity * l.unitPriceCents), 0))} ex GST</span>
                      </summary>
                      {b.description ? <p className="mt-1 text-xs text-muted-foreground">{b.description}</p> : null}
                      <div className="mt-3 max-w-3xl">
                        <BundleEditor bundle={{ id: b.id, name: b.name, description: b.description ?? "", items: b.items.map((it) => ({ priceItemId: it.priceItemId, quantity: Number(it.quantity) })) }} priceItems={pickable} />
                      </div>
                    </details>
                    <form action={toggleBundleAction}>
                      <input type="hidden" name="bundleId" value={b.id} />
                      <input type="hidden" name="active" value={b.active ? "no" : "yes"} />
                      <Button type="submit" variant="ghost" size="sm">{b.active ? "Retire" : "Reactivate"}</Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">New bundle</summary>
          <div className="mt-3 max-w-3xl">
            <BundleEditor priceItems={pickable} />
          </div>
        </details>
      </div>
      {KIND_OPTIONS.map((kind) => {
        const rows = items.filter((i) => i.kind === kind.value);
        return (
          <div key={kind.value} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">
              {kind.label} <span className="text-muted-foreground">({rows.length})</span>
            </h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold">Unit</th>
                    <th className="px-4 py-2 text-right font-semibold">Cost</th>
                    <th className="px-4 py-2 text-right font-semibold">Markup</th>
                    <th className="px-4 py-2 text-right font-semibold">Price</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-muted-foreground">None yet.</td>
                    </tr>
                  ) : null}
                  {rows.map((i) => (
                    <tr key={i.id} className="border-b align-top last:border-0">
                      <td className="px-4 py-2.5">
                        <details>
                          <summary className="cursor-pointer font-medium">
                            {i.name} {!i.active ? <Badge variant="secondary" className="ml-1">retired</Badge> : null}
                          </summary>
                          {i.description ? <p className="mt-1 text-xs text-muted-foreground">{i.description}</p> : null}
                          <div className="mt-3 max-w-2xl">
                            <ActionForm action={savePriceItemAction} submitLabel="Save" successMessage="Saved." variant="outline">
                              <PriceItemFields item={i} />
                            </ActionForm>
                          </div>
                        </details>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{i.unit}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{i.costCents != null ? formatMoney(i.costCents) : "-"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{i.markupPct != null ? `${i.markupPct}%` : "-"}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(i.priceCents)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <form action={togglePriceItemAction}>
                          <input type="hidden" name="priceItemId" value={i.id} />
                          <input type="hidden" name="active" value={i.active ? "no" : "yes"} />
                          <Button type="submit" variant="ghost" size="sm">{i.active ? "Retire" : "Reactivate"}</Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
