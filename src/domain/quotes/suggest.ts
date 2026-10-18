/**
 * Suggests quote lines from an enquiry. The price list is the only source of items and prices: matching is by keyword
 * (always available) or by an AI that may only choose price-list entries and quantities - it cannot invent a line or a
 * price. The office reviews every suggestion before anything is added.
 */

export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  kind: string;
  unit: string;
  priceCents: number;
}
export interface SuggestedLine {
  priceItemId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
}
export interface CatalogBundle {
  id: string;
  name: string;
  description?: string | null;
  lines: SuggestedLine[];
}
export interface Suggestion {
  kind: "item" | "bundle";
  id: string;
  name: string;
  quantity: number;
  reason: string;
  lines: SuggestedLine[];
  totalCents: number;
}
export interface SuggestResult {
  source: "ai" | "keywords";
  suggestions: Suggestion[];
  /** Shown to the person, e.g. when the AI could not be used. */
  note?: string;
}

// Words that say nothing about the job. Stored as typed and as stemmed, because text is compared after stemming ("package" -> "packag").
const STOP = new Set(
  "a an the and or of to for in on at with from by as is are be was it its this that these those can could would should will please need needs want wants like our my we i you your us me quote quotes quoting price pricing cost how much about some any can supply fit fitting install installed installation installing replace replacement new basic extra each per kit hour hours standard job jobs work works package bundle also just really very there their house home room place suppli fitt".split(" ")
    .flatMap((w) => [w, stem(w)]),
);
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const FAULT = /\b(trip|trips|tripping|tripped|fault|faulty|not working|stopped working|no power|power cut|blown|flicker|flickering|buzz|buzzing|sparks?|burning|burnt|smell|dead|broken|repair)\b/i;
const URGENT = /\b(burning|burnt|sparks?|smoke|smoking|shock|emergency|urgent|dangerous|fire)\b/i;

function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Every word, lower-cased and stemmed; number words become digits ("six" -> "6"). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (NUMBER_WORDS[w] !== undefined ? String(NUMBER_WORDS[w]) : stem(w)));
}
const isNumber = (w: string) => /^\d+(\.\d+)?$/.test(w);
const contentWords = (text: string) => words(text).filter((w) => !STOP.has(w) && !isNumber(w) && w.length > 1);

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const sum = (lines: SuggestedLine[]) => lines.reduce((t, l) => t + Math.round(l.quantity * l.unitPriceCents), 0);

function itemSuggestion(item: CatalogItem, quantity: number, reason: string): Suggestion {
  const lines = [{ priceItemId: item.id, description: item.name, quantity, unit: item.unit, unitPriceCents: item.priceCents }];
  return { kind: "item", id: item.id, name: item.name, quantity, reason, lines, totalCents: sum(lines) };
}
function bundleSuggestion(b: CatalogBundle, reason: string): Suggestion {
  return { kind: "bundle", id: b.id, name: b.name, quantity: 1, reason, lines: b.lines, totalCents: sum(b.lines) };
}

/** The number written just before a matched word ("6 LED downlights" -> 6), looking back up to three words. */
function quantityNear(all: string[], matched: Set<string>): number {
  for (let p = 0; p < all.length; p++) {
    if (!matched.has(all[p]!)) continue;
    for (let k = 1; k <= 3 && p - k >= 0; k++) {
      const w = all[p - k]!;
      if (isNumber(w)) {
        const n = Number(w);
        if (n > 0 && n <= 500) return n;
      }
    }
  }
  return 1;
}

export function suggestByKeywords(text: string, items: CatalogItem[], bundles: CatalogBundle[]): Suggestion[] {
  const all = words(text);
  const inText = new Set(all.filter((w) => !STOP.has(w) && !isNumber(w)));
  const scored: { s: Suggestion; score: number }[] = [];

  // A match on the entry's NAME is what counts; its description only adds support (and a long description must not
  // drown a clear match: "six downlights" is enough for the downlight package).
  const consider = (name: string, description: string | null | undefined, make: (matched: string[], all: string[]) => Suggestion, boost = 0) => {
    const nameWords = [...new Set(contentWords(name))];
    if (nameWords.length === 0) return;
    const nameHits = nameWords.filter((w) => inText.has(w));
    if (nameHits.length === 0 || !nameHits.some((w) => w.length >= 4)) return;
    const ratio = nameHits.length / nameWords.length;
    if (ratio < 0.5) return;
    const descHits = [...new Set(contentWords(description ?? ""))].filter((w) => inText.has(w) && !nameHits.includes(w));
    scored.push({ s: make([...nameHits, ...descHits], all), score: ratio + 0.1 * (nameHits.length + descHits.length) + boost });
  };

  for (const b of bundles) consider(b.name, b.description, (m) => bundleSuggestion(b, `Matched ${m.map((w) => `"${w}"`).join(", ")} in the enquiry`), 1); // a matching bundle beats the separate items it contains
  for (const it of items.filter((i) => i.kind === "STANDARD_JOB" || i.kind === "MATERIAL")) {
    consider(it.name, it.description, (m) => itemSuggestion(it, quantityNear(all, new Set(m)), `Matched ${m.map((w) => `"${w}"`).join(", ")} in the enquiry`));
  }

  // A fault or repair needs someone out: suggest the call-out fee (the emergency one when it sounds dangerous).
  if (FAULT.test(text)) {
    const callouts = items.filter((i) => i.kind === "CALL_OUT");
    const pick = (URGENT.test(text) ? callouts.find((c) => /emergency|after/i.test(c.name)) : undefined) ?? callouts.find((c) => /standard/i.test(c.name)) ?? callouts[0];
    if (pick) scored.push({ s: itemSuggestion(pick, 1, "The enquiry describes a fault or repair, which needs a call-out"), score: 0.5 });
  }

  scored.sort((a, b) => b.score - a.score);
  const out: Suggestion[] = [];
  const covered = new Set<string>();
  for (const { s } of scored) {
    if (s.kind === "item" && covered.has(s.id)) continue; // already part of a suggested bundle
    out.push(s);
    if (s.kind === "bundle") for (const l of s.lines) covered.add(l.priceItemId);
  }
  // an item that turned up before its bundle was chosen: drop it now
  return out.filter((s, i) => s.kind === "bundle" || !out.some((o, j) => j !== i && o.kind === "bundle" && o.lines.some((l) => l.priceItemId === s.id))).slice(0, 6);
}

// --- AI ---------------------------------------------------------------------------------------------------------

export interface AiOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const SYSTEM = `You help an Australian electrical contractor draft a quote. You are given the customer's enquiry and the contractor's price list (items and bundles, each with an id). Choose which price-list entries the quote needs and how many of each. Only use ids from the list. Prefer a bundle over its separate items. Do not invent items or prices. Reply with JSON only, no other text: {"suggestions":[{"type":"item"|"bundle","id":"<id>","quantity":<number>,"reason":"<one short sentence>"}]}. Leave out anything the enquiry does not call for. A quantity is how many units the customer needs (bundles are always 1).`;

export function buildCatalogPrompt(text: string, items: CatalogItem[], bundles: CatalogBundle[]): string {
  const itemLines = items.map((i) => `ITEM ${i.id} | ${i.kind} | ${i.name} | per ${i.unit} | ${money(i.priceCents)}`);
  const bundleLines = bundles.map((b) => `BUNDLE ${b.id} | ${b.name} | includes: ${b.lines.map((l) => `${l.quantity} x ${l.description}`).join("; ")}`);
  return `Enquiry:\n"""\n${text.slice(0, 4000)}\n"""\n\nPrice list:\n${[...bundleLines, ...itemLines].join("\n")}`;
}

/** Turns the model's JSON into suggestions, keeping only real price-list entries and sane quantities. */
export function parseAiSuggestions(raw: string, items: CatalogItem[], bundles: CatalogBundle[]): Suggestion[] {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const data = JSON.parse(json) as { suggestions?: { type?: string; id?: string; quantity?: number; reason?: string }[] };
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const s of data.suggestions ?? []) {
    if (!s || typeof s.id !== "string" || seen.has(s.id)) continue;
    const reason = typeof s.reason === "string" && s.reason.trim() ? s.reason.trim().slice(0, 200) : "Suggested from the enquiry";
    if (s.type === "bundle") {
      const b = bundles.find((x) => x.id === s.id);
      if (b) out.push(bundleSuggestion(b, reason));
    } else {
      const it = items.find((x) => x.id === s.id);
      const q = Number(s.quantity);
      if (it) out.push(itemSuggestion(it, Number.isFinite(q) && q > 0 && q <= 500 ? q : 1, reason));
    }
    seen.add(s.id);
  }
  return out.slice(0, 8);
}

export async function suggestWithAi(text: string, items: CatalogItem[], bundles: CatalogBundle[], opts: AiOptions): Promise<Suggestion[]> {
  const res = await (opts.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: opts.model ?? "claude-haiku-4-5", max_tokens: 1000, system: SYSTEM, messages: [{ role: "user", content: buildCatalogPrompt(text, items, bundles) }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The AI service answered ${res.status}`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const textOut = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return parseAiSuggestions(textOut, items, bundles);
}

/** The lines a quote starts with when the suggestions are taken as they come: bundles and items flattened, and the same
 * price-list entry appearing twice added together rather than repeated. */
export function linesFromSuggestions(suggestions: Suggestion[]): SuggestedLine[] {
  const merged = new Map<string, SuggestedLine>();
  for (const line of suggestions.flatMap((s) => s.lines)) {
    const seen = merged.get(line.priceItemId);
    merged.set(line.priceItemId, seen ? { ...seen, quantity: seen.quantity + line.quantity } : { ...line });
  }
  return [...merged.values()];
}

export async function suggestLines(text: string, items: CatalogItem[], bundles: CatalogBundle[], ai?: AiOptions): Promise<SuggestResult> {
  const trimmed = text.trim();
  if (!trimmed) return { source: "keywords", suggestions: [], note: "Describe the work first." };
  if (ai?.apiKey) {
    try {
      const suggestions = await suggestWithAi(trimmed, items, bundles, ai);
      return { source: "ai", suggestions };
    } catch {
      return { source: "keywords", suggestions: suggestByKeywords(trimmed, items, bundles), note: "The AI could not be reached, so these were matched by keyword instead." };
    }
  }
  return { source: "keywords", suggestions: suggestByKeywords(trimmed, items, bundles) };
}
