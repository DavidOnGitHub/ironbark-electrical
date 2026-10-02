"use client";

import { useState } from "react";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { Label } from "@kabosh-digital/m-street-kit/ui/label";
import { formatMoney } from "../lib/money";
import { lineTotalCents } from "../domain/quotes/calc";
import { saveBundleAction } from "../actions/pricing";
import { ActionForm } from "./ActionForm";

export interface BundlePriceItem {
  id: string;
  name: string;
  unit: string;
  priceCents: number;
}

type Row = { key: number; priceItemId: string; quantity: string };

/** Create or edit a bundle: a named set of price-list items with quantities. A bundle has no price of its own -
 * each line takes the item's price when it is added to a quote. */
export function BundleEditor({
  bundle,
  priceItems,
}: {
  bundle?: { id: string; name: string; description: string; items: { priceItemId: string; quantity: number }[] };
  priceItems: BundlePriceItem[];
}) {
  const [name, setName] = useState(bundle?.name ?? "");
  const [description, setDescription] = useState(bundle?.description ?? "");
  const [rows, setRows] = useState<Row[]>(() => (bundle?.items ?? []).map((it, i) => ({ key: i, priceItemId: it.priceItemId, quantity: String(it.quantity) })));
  const [nextKey, setNextKey] = useState(bundle?.items.length ?? 0);
  const byId = new Map(priceItems.map((p) => [p.id, p]));
  const total = rows.reduce((t, r) => {
    const p = byId.get(r.priceItemId);
    const q = Number(r.quantity);
    return p && Number.isFinite(q) && q > 0 ? t + lineTotalCents(q, p.priceCents) : t;
  }, 0);
  const payload = JSON.stringify(rows.filter((r) => r.priceItemId).map((r) => ({ priceItemId: r.priceItemId, quantity: Number(r.quantity) })));
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <ActionForm action={saveBundleAction} submitLabel={bundle ? "Save bundle" : "Add bundle"} successMessage="Saved." variant="outline" resetOnSuccess={!bundle}>
      {bundle ? <input type="hidden" name="bundleId" value={bundle.id} /> : null}
      <input type="hidden" name="items" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`b-name-${bundle?.id ?? "new"}`}>Name</Label>
          <Input id={`b-name-${bundle?.id ?? "new"}`} name="name" value={name} onChange={(e) => setName(e.target.value)} required className="bg-card" placeholder="Switchboard upgrade package" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`b-desc-${bundle?.id ?? "new"}`}>What it covers</Label>
          <Input id={`b-desc-${bundle?.id ?? "new"}`} name="description" value={description} onChange={(e) => setDescription(e.target.value)} className="bg-card" placeholder="Used to match enquiries, e.g. board, safety switches, labour" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const p = byId.get(r.priceItemId);
          return (
            <div key={r.key} className="flex flex-wrap items-center gap-2">
              <select aria-label="Item" value={r.priceItemId} onChange={(e) => update(r.key, { priceItemId: e.target.value })} className="h-8 min-w-60 flex-1 rounded-lg border border-input bg-card px-2.5 text-sm">
                <option value="">Choose an item...</option>
                {priceItems.map((it) => (
                  <option key={it.id} value={it.id}>{it.name} - {formatMoney(it.priceCents)} / {it.unit}</option>
                ))}
              </select>
              <Input aria-label="Quantity" inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className="w-24 bg-card" />
              <span className="w-16 text-xs text-muted-foreground">{p?.unit ?? ""}</span>
              <Button type="button" variant="ghost" size="sm" aria-label="Remove item" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>x</Button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => { setRows((rs) => [...rs, { key: nextKey, priceItemId: "", quantity: "1" }]); setNextKey((k) => k + 1); }}>Add an item</Button>
          <span className="text-sm text-muted-foreground">Worth {formatMoney(total)} ex GST at today&rsquo;s prices</span>
        </div>
      </div>
    </ActionForm>
  );
}
