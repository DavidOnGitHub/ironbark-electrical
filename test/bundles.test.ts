import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { bundleLines, createBundle, createPriceItem, listBundles, setBundleActive, setPriceItemActive, updateBundle, updatePriceItem } from "../src/domain/pricing";
import { truncateAll } from "./helpers";
import type { Actor } from "../src/domain/shared/actor";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
beforeEach(truncateAll);
afterAll(() => appDb.$disconnect());

async function items() {
  const a = await createPriceItem({ kind: "STANDARD_JOB", name: "Switchboard upgrade (basic)", unit: "each", priceCents: 90000 }, priya);
  const b = await createPriceItem({ kind: "MATERIAL", name: "Safety switch RCBO", unit: "each", priceCents: 6500 }, priya);
  return { a, b };
}

describe("price bundles", () => {
  it("creates a bundle whose lines take the items' current prices, in order", async () => {
    const { a, b } = await items();
    await createBundle({ name: "Switchboard package", description: "board and switches", items: [{ priceItemId: a.id, quantity: 1 }, { priceItemId: b.id, quantity: 6 }] }, priya);
    const [bundle] = await listBundles();
    expect(bundleLines(bundle!)).toEqual([
      { priceItemId: a.id, description: "Switchboard upgrade (basic)", quantity: 1, unit: "each", unitPriceCents: 90000 },
      { priceItemId: b.id, description: "Safety switch RCBO", quantity: 6, unit: "each", unitPriceCents: 6500 },
    ]);
    // a price change shows up the next time the bundle is used - the bundle holds no price of its own
    await updatePriceItem(b.id, { kind: "MATERIAL", name: "Safety switch RCBO", unit: "each", priceCents: 7000 }, priya);
    expect(bundleLines((await listBundles())[0]!)[1]!.unitPriceCents).toBe(7000);
  });
  it("skips retired items, and rejects empty bundles and duplicate names", async () => {
    const { a, b } = await items();
    await createBundle({ name: "Pack", items: [{ priceItemId: a.id, quantity: 1 }, { priceItemId: b.id, quantity: 2 }] }, priya);
    await setPriceItemActive(b.id, false, priya);
    expect(bundleLines((await listBundles())[0]!)).toHaveLength(1);
    await expect(createBundle({ name: "Pack", items: [{ priceItemId: a.id, quantity: 1 }] }, priya)).rejects.toThrow("already a bundle");
    await expect(createBundle({ name: "Empty", items: [] }, priya)).rejects.toThrow("at least one item");
    await expect(createBundle({ name: "Zero", items: [{ priceItemId: a.id, quantity: 0 }] }, priya)).rejects.toThrow("more than zero");
  });
  it("edits items and name in place, and retires and reactivates", async () => {
    const { a, b } = await items();
    const made = await createBundle({ name: "Pack", items: [{ priceItemId: a.id, quantity: 1 }] }, priya);
    await updateBundle(made.id, { name: "Pack v2", items: [{ priceItemId: b.id, quantity: 3 }] }, priya);
    const [bundle] = await listBundles();
    expect(bundle!.name).toBe("Pack v2");
    expect(bundle!.items.map((i) => [i.priceItemId, Number(i.quantity)])).toEqual([[b.id, 3]]);
    await setBundleActive(made.id, false, priya);
    expect(await listBundles({ activeOnly: true })).toHaveLength(0);
    await setBundleActive(made.id, true, priya);
    expect(await listBundles({ activeOnly: true })).toHaveLength(1);
  });
});
