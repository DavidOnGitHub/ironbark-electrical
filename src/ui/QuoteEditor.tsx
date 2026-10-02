"use client";

import { useState, useTransition } from "react";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { computeTotals, lineTotalCents, DEPOSIT_PCT, GST_RATE_PCT } from "../domain/quotes/calc";
import { formatMoney, parseMoney, centsToInput } from "../lib/money";
import type { ActionState } from "../actions/shared";
import type { SuggestResult, Suggestion } from "../domain/quotes/suggest";
import { ActionForm } from "./ActionForm";

export interface EditorLine {
  priceItemId?: string | null;
  /** Where an invoice line came from (QUOTE, VARIATION, MANUAL) - carried through unchanged. */
  source?: string;
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

export interface EditorBundle {
  id: string;
  name: string;
  lines: EditorLine[];
}

type Row = { key: number; source: string; priceItemId: string | null; description: string; quantity: string; unit: string; price: string };

const KIND_LABEL: Record<string, string> = { LABOUR: "Labour", CALL_OUT: "Call-out", STANDARD_JOB: "Standard jobs", MATERIAL: "Materials" };

function toRows(lines: EditorLine[]): Row[] {
  return lines.map((l, i) => ({ key: i, source: l.source ?? "MANUAL", priceItemId: l.priceItemId ?? null, description: l.description, quantity: String(l.quantity), unit: l.unit, price: centsToInput(l.unitPriceCents) }));
}

/** The draft quote's line editor: pick from the price list or type a line, and watch
 * the totals (GST, deposit rule) update as you go. The same calc.ts the server uses. */
export function QuoteEditor({
  quoteId,
  initialLines,
  priceItems,
  bundles = [],
  enquiryText,
  suggest,
  action,
  idName = "quoteId",
  saveLabel = "Save lines",
}: {
  quoteId: string;
  /** The hidden field that tells the action which record this is. */
  idName?: string;
  saveLabel?: string;
  initialLines: EditorLine[];
  priceItems: EditorPriceItem[];
  /** Bundles of price-list items that can be added in one click. */
  bundles?: EditorBundle[];
  /** The enquiry's wording, offered as the starting point for "Suggest lines". */
  enquiryText?: string;
  /** Proposes price-list lines for a description; the person reviews them before they are added. */
  suggest?: (description: string) => Promise<SuggestResult>;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initialLines));
  const [nextKey, setNextKey] = useState(initialLines.length);
  const [pick, setPick] = useState("");
  const [pickBundle, setPickBundle] = useState("");
  const [describe, setDescribe] = useState(enquiryText ?? "");
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [suggesting, startSuggest] = useTransition();

  const parsed = rows.map((r) => ({ qty: Number(r.quantity), cents: parseMoney(r.price) }));
  const valid = rows.map((r, i) => r.description.trim() !== "" && Number.isFinite(parsed[i]!.qty) && parsed[i]!.qty > 0 && parsed[i]!.cents !== null);
  const totals = computeTotals(rows.map((_, i) => ({ quantity: valid[i] ? parsed[i]!.qty : 0, unitPriceCents: valid[i] ? parsed[i]!.cents! : 0 })));
  const payload = JSON.stringify(
    rows.map((r, i) => ({ source: r.source, priceItemId: r.priceItemId ?? undefined, description: r.description, quantity: parsed[i]!.qty, unit: r.unit || "each", unitPriceCents: parsed[i]!.cents ?? 0 })),
  );

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (row: Omit<Row, "key">) => {
    setRows((rs) => [...rs, { ...row, key: nextKey }]);
    setNextKey((k) => k + 1);
  };
  const kinds = [...new Set(priceItems.map((p) => p.kind))];
  const addLines = (lines: EditorLine[]) => {
    setRows((rs) => [...rs, ...lines.map((l, i) => ({ key: nextKey + i, source: "MANUAL", priceItemId: l.priceItemId ?? null, description: l.description, quantity: String(l.quantity), unit: l.unit, price: centsToInput(l.unitPriceCents) }))]);
    setNextKey((k) => k + lines.length);
  };
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const runSuggest = () =>
    startSuggest(async () => {
      setSuggestError(null);
      try {
        const r = await suggest!(describe);
        setResult(r);
        setChosen(new Set(r.suggestions.map((x) => `${x.kind}:${x.id}`)));
      } catch {
        setResult(null);
        setSuggestError("Suggestions are not available right now. Add lines by hand, or reload the page and try again.");
      }
    });
  const addChosen = () => {
    if (!result) return;
    addLines(result.suggestions.filter((x: Suggestion) => chosen.has(`${x.kind}:${x.id}`)).flatMap((x) => x.lines));
    setResult(null);
  };

  return (
    <ActionForm action={action} submitLabel={saveLabel} successMessage="Saved." className="gap-4">
      <input type="hidden" name={idName} value={quoteId} />
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
            addRow({ source: "MANUAL", priceItemId: item.id, description: item.name, quantity: "1", unit: item.unit, price: centsToInput(item.priceCents) });
            setPick("");
          }}
        >
          Add line
        </Button>
        <Button type="button" variant="outline" onClick={() => addRow({ source: "MANUAL", priceItemId: null, description: "", quantity: "1", unit: "each", price: "" })}>
          Add custom line
        </Button>
      </div>

      {bundles.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="pick-bundle">Add a bundle (several lines at once)</label>
            <select id="pick-bundle" value={pickBundle} onChange={(e) => setPickBundle(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm">
              <option value="">Choose a bundle...</option>
              {bundles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} - {b.lines.length} lines, {formatMoney(b.lines.reduce((t, l) => t + lineTotalCents(l.quantity, l.unitPriceCents), 0))}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!pickBundle}
            onClick={() => {
              const b = bundles.find((x) => x.id === pickBundle);
              if (!b) return;
              addLines(b.lines);
              setPickBundle("");
            }}
          >
            Add bundle
          </Button>
        </div>
      ) : null}

      {suggest ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3" data-testid="suggest-panel">
          <label className="text-sm font-medium" htmlFor="describe-work">Suggest lines from the enquiry</label>
          <textarea id="describe-work" value={describe} onChange={(e) => setDescribe(e.target.value)} rows={3} placeholder="Describe the work, or paste the customer's email..." className="w-full rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm" />
          <div>
            <Button type="button" variant="outline" disabled={suggesting || describe.trim() === ""} onClick={runSuggest}>
              {suggesting ? "Looking at the price list..." : "Suggest lines"}
            </Button>
          </div>
          {suggestError ? <p role="alert" className="text-sm text-destructive">{suggestError}</p> : null}
          {result ? (
            <div className="flex flex-col gap-2 text-sm" data-testid="suggestions">
              <p className="text-xs text-muted-foreground">
                {result.source === "ai" ? "Suggested by AI from your price list." : "Matched against your price list by keyword."} Tick the ones you want, then click &ldquo;Add selected lines&rdquo; - nothing is added until you do. {result.note ?? ""}
              </p>
              {result.suggestions.length === 0 ? <p className="text-muted-foreground">Nothing in the price list matched. Add lines by hand.</p> : null}
              {result.suggestions.map((x) => {
                const key = `${x.kind}:${x.id}`;
                return (
                  <label key={key} className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={chosen.has(key)}
                      onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(key); else n.delete(key); return n; })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{x.kind === "bundle" ? `Bundle: ${x.name}` : `${x.quantity} x ${x.name}`}</span>
                      <span className="block text-xs text-muted-foreground">{x.reason}</span>
                      {x.kind === "bundle" ? <span className="block text-xs text-muted-foreground">{x.lines.map((l) => `${l.quantity} x ${l.description}`).join(", ")}</span> : null}
                    </span>
                    <span className="tabular-nums">{formatMoney(x.totalCents)}</span>
                  </label>
                );
              })}
              {result.suggestions.length > 0 ? (
                <div className="flex gap-2">
                  <Button type="button" disabled={chosen.size === 0} onClick={addChosen}>Add selected lines</Button>
                  <Button type="button" variant="ghost" onClick={() => setResult(null)}>Dismiss</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

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
