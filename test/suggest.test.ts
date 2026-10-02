import { describe, expect, it } from "vitest";
import { parseAiSuggestions, suggestByKeywords, suggestLines, type CatalogBundle, type CatalogItem } from "../src/domain/quotes/suggest";

const item = (id: string, name: string, kind: string, priceCents: number, unit = "each", description?: string): CatalogItem => ({ id, name, kind, priceCents, unit, description });
const items: CatalogItem[] = [
  item("callout", "Standard call-out", "CALL_OUT", 9500),
  item("callout_e", "Emergency call-out", "CALL_OUT", 19000),
  item("elec", "Electrician", "LABOUR", 11000, "hour"),
  item("fan", "Ceiling fan install", "STANDARD_JOB", 24000),
  item("fankit", "Ceiling fan kit", "MATERIAL", 18000),
  item("ev", "EV charger install (7kW, supply extra)", "STANDARD_JOB", 95000),
  item("smoke", "Smoke alarm replacement", "STANDARD_JOB", 14500),
  item("led", "LED downlight 10W", "MATERIAL", 2400),
  item("tps", "TPS cable 2.5mm", "MATERIAL", 420, "m"),
];
const line = (it: CatalogItem, quantity: number) => ({ priceItemId: it.id, description: it.name, quantity, unit: it.unit, unitPriceCents: it.priceCents });
const bundles: CatalogBundle[] = [
  { id: "b_down", name: "Downlight package (6 LEDs)", description: "LED downlights supplied and fitted, with cable and call-out", lines: [line(items[1]!, 1), line(items[7]!, 6), line(items[8]!, 14)] },
];

describe("suggesting quote lines by keyword", () => {
  it("matches a standard job and reads the quantity written before it", () => {
    const s = suggestByKeywords("Hi, we would like three ceiling fans installed in the bedrooms", items, bundles);
    const fan = s.find((x) => x.id === "fan")!;
    expect(fan).toBeTruthy();
    expect(fan.quantity).toBe(3);
    expect(fan.lines[0]).toMatchObject({ priceItemId: "fan", unitPriceCents: 24000, quantity: 3 });
    expect(fan.totalCents).toBe(72000);
  });
  it("prefers a bundle over its separate items", () => {
    const s = suggestByKeywords("Can you quote on installing 6 LED downlights in our lounge room?", items, bundles);
    expect(s[0]).toMatchObject({ kind: "bundle", id: "b_down" });
    expect(s.some((x) => x.kind === "item" && x.id === "led")).toBe(false);
  });
  it("one clear word is enough: a real enquiry for six downlights finds the downlight package", () => {
    const s = suggestByKeywords("David Dai is requesting a quote to supply and install six downlights in the lounge room. Hi, Can you quote for six downlights in our lounge room? Thanks, David", items, bundles);
    expect(s[0]).toMatchObject({ kind: "bundle", id: "b_down" });
  });
  it("does not match on a bundle's description alone", () => {
    expect(suggestByKeywords("We need a call-out and a cable run", items, bundles).some((x) => x.id === "b_down")).toBe(false);
  });
  it("suggests the call-out fee for a fault, and the emergency one when it sounds dangerous", () => {
    expect(suggestByKeywords("The oven keeps tripping the safety switch", items, [])[0]).toMatchObject({ id: "callout" });
    expect(suggestByKeywords("Burning smell from the switchboard, sparks too", items, [])[0]).toMatchObject({ id: "callout_e" });
  });
  it("suggests nothing it cannot match, and never labour on its own", () => {
    expect(suggestByKeywords("Thinking about a holiday next year", items, bundles)).toEqual([]);
    expect(suggestByKeywords("We need an electrician please", items, bundles)).toEqual([]);
  });
  it("copes with plurals and number words", () => {
    const s = suggestByKeywords("replace five smoke alarms", items, []);
    expect(s[0]).toMatchObject({ id: "smoke", quantity: 5 });
  });
});

describe("suggesting with AI", () => {
  const raw = '```json\n{"suggestions":[{"type":"bundle","id":"b_down","quantity":9,"reason":"Six downlights"},{"type":"item","id":"ghost","quantity":1},{"type":"item","id":"fan","quantity":-2},{"type":"item","id":"fankit","quantity":2,"reason":"Fan kits"},{"type":"item","id":"fankit","quantity":4}]}\n```';
  it("keeps only real price-list entries, fixes bad quantities, and never repeats one", () => {
    const s = parseAiSuggestions(raw, items, bundles);
    expect(s.map((x) => `${x.kind}:${x.id}:${x.quantity}`)).toEqual(["bundle:b_down:1", "item:fan:1", "item:fankit:2"]);
    expect(s[0]!.reason).toBe("Six downlights");
  });
  it("uses the AI when a key is given, taking prices from the price list not the model", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"suggestions":[{"type":"item","id":"fan","quantity":2,"reason":"two fans","price":1}]}' }] }))) as unknown as typeof fetch;
    const r = await suggestLines("two fans", items, bundles, { apiKey: "k", fetchImpl });
    expect(r.source).toBe("ai");
    expect(r.suggestions[0]).toMatchObject({ id: "fan", quantity: 2, totalCents: 48000 });
  });
  it("falls back to keywords, and says so, when the AI fails", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const r = await suggestLines("three ceiling fans", items, bundles, { apiKey: "k", fetchImpl });
    expect(r.source).toBe("keywords");
    expect(r.note).toContain("keyword");
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
  it("uses keywords without a key, and asks for a description when there is none", async () => {
    expect((await suggestLines("three ceiling fans", items, bundles)).source).toBe("keywords");
    expect((await suggestLines("   ", items, bundles)).note).toBe("Describe the work first.");
  });
});
