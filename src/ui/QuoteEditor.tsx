"use client";

import { useState } from "react";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { computeTotals, lineTotalCents, DEPOSIT_PCT, GST_RATE_PCT } from "../domain/quotes/calc";
import { formatMoney, parseMoney, centsToInput } from "../lib/money";
import type { ActionState } from "../actions/shared";
import { ActionForm } from "./ActionForm";

export interface EditorLine {
  priceItemId?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
}

export interface EditorPriceItem {
  id: string;
  name: string;
  kind: string;
  unit: string;
  priceCents: number;
}

type Row = { key: number; priceItemId: string | null; description: string; quantity: string; unit: string; price: string };

const KIND_LABEL: Record<string, string> = { LABOUR: "Labour", CALL_OUT: "Call-out", STANDARD_JOB: "Standard jobs", MATERIAL: "Materials" };

function toRows(lines: EditorLine[]): Row[] {
  return lines.map((l, i) => ({ key: i, priceItemId: l.priceItemId ?? null, description: l.description, quantity: String(l.quantity), unit: l.unit, price: centsToInput(l.unitPriceCents) }));
}

/** The draft quote's line editor: pick from the price list or type a line, and watch
 * the totals (GST, deposit rule) update as you go. The same calc.ts the server uses. */
export function QuoteEditor({
  quoteId,
  initialLines,
  priceItems,
  action,
}: {
  quoteId: string;
  initialLines: EditorLine[];
  priceItems: EditorPriceItem[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initialLines));
  const [nextKey, setNextKey] = useState(initialLines.length);
  const [pick, setPick] = useState("");

  const parsed = rows.map((r) => ({ qty: Number(r.quantity), cents: parseMoney(r.price) }));
  const valid = rows.map((r, i) => r.description.trim() !== "" && Number.isFinite(parsed[i]!.qty) && parsed[i]!.qty > 0 && parsed[i]!.cents !== null);
  const totals = computeTotals(rows.map((_, i) => ({ quantity: valid[i] ? parsed[i]!.qty : 0, unitPriceCents: valid[i] ? parsed[i]!.cents! : 0 })));
  const payload = JSON.stringify(
    rows.map((r, i) => ({ priceItemId: r.priceItemId ?? undefined, description: r.description, quantity: parsed[i]!.qty, unit: r.unit || "each", unitPriceCents: parsed[i]!.cents ?? 0 })),
  );

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (row: Omit<Row, "key">) => {
    setRows((rs) => [...rs, { ...row, key: nextKey }]);
    setNextKey((k) => k + 1);
  };
  const kinds = [...new Set(priceItems.map((p) => p.kind))];

  return (
    <ActionForm action={action} submitLabel="Save lines" successMessage="Saved." className="gap-4">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="lines" value={payload} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="pick-item">Add from the price list</label>
          <select id="pick-item" value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm">
            <option value="">Choose an item...</option>
            {kinds.map((k) => (
              <optgroup key={k} label={KIND_LABEL[k] ?? k}>
                {priceItems.filter((p) => p.kind === k).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {formatMoney(p.priceCents)} / {p.unit}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!pick}
          onClick={() => {
            const item = priceItems.find((p) => p.id === pick);
            if (!item) return;
            addRow({ priceItemId: item.id, description: item.name, quantity: "1", unit: item.unit, price: centsToInput(item.priceCents) });
            setPick("");
          }}
        >
          Add line
        </Button>
        <Button type="button" variant="outline" onClick={() => addRow({ priceItemId: null, description: "", quantity: "1", unit: "each", price: "" })}>
          Add custom line
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="w-20 px-3 py-2 font-semibold">Qty</th>
              <th className="w-20 px-3 py-2 font-semibold">Unit</th>
              <th className="w-28 px-3 py-2 font-semibold">Unit price $</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">Line total</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No lines yet - add one from the price list or type your own.</td>
              </tr>
            ) : null}
            {rows.map((r, i) => (
              <tr key={r.key} className="border-b align-top last:border-0">
                <td className="px-3 py-2"><Input aria-label="Description" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className="bg-card" /></td>
                <td className="px-3 py-2"><Input aria-label="Quantity" inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className="bg-card" /></td>
                <td className="px-3 py-2"><Input aria-label="Unit" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className="bg-card" /></td>
                <td className="px-3 py-2"><Input aria-label="Unit price" inputMode="decimal" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} className="bg-card" /></td>
                <td className="px-3 py-2 text-right tabular-nums">{valid[i] ? formatMoney(lineTotalCents(parsed[i]!.qty, parsed[i]!.cents!)) : "-"}</td>
                <td className="px-3 py-2 text-right">
                  <Button type="button" variant="ghost" size="sm" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>x</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" data-testid="totals">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{formatMoney(totals.subtotalCents)}</dd>
        <dt className="text-muted-foreground">GST ({GST_RATE_PCT}%)</dt>
        <dd className="text-right tabular-nums">{formatMoney(totals.gstCents)}</dd>
        <dt className="font-semibold">Total incl GST</dt>
        <dd className="text-right font-semibold tabular-nums">{formatMoney(totals.totalCents)}</dd>
        {totals.depositRequired ? (
          <>
            <dt className="text-amber-700 dark:text-amber-400">Deposit ({DEPOSIT_PCT}%)</dt>
            <dd className="text-right tabular-nums text-amber-700 dark:text-amber-400">{formatMoney(totals.depositCents)}</dd>
          </>
        ) : null}
      </dl>
      {valid.some((v) => !v) && rows.length > 0 ? <p className="text-xs text-muted-foreground">Lines missing a description, a quantity or a price are left out of the totals until completed.</p> : null}
    </ActionForm>
  );
}
