/** Price list module - the public API. Owner and Office only; technicians never see prices. */
import { z } from "zod";
import { appDb } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { materialPriceCents } from "../quotes/calc";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const PriceItemInputSchema = z
  .object({
    kind: z.enum(["LABOUR", "CALL_OUT", "STANDARD_JOB", "MATERIAL"]),
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.preprocess(blank, z.string().trim().max(500).optional()),
    unit: z.string().trim().min(1).max(20).default("each"),
    /** Unit price ex GST, cents. Ignored for materials with a cost and markup (derived). */
    priceCents: z.number().int().min(0).max(100_000_00).optional(),
    costCents: z.number().int().min(0).max(100_000_00).optional(),
    markupPct: z.number().int().min(0).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const derived = v.kind === "MATERIAL" && v.costCents !== undefined && v.markupPct !== undefined;
    if (!derived && v.priceCents === undefined) ctx.addIssue({ code: "custom", message: "A price is required", path: ["priceCents"] });
  });
export type PriceItemInput = z.input<typeof PriceItemInputSchema>;

function resolvePrice(v: z.output<typeof PriceItemInputSchema>) {
  const derived = v.kind === "MATERIAL" && v.costCents !== undefined && v.markupPct !== undefined;
  return {
    priceCents: derived ? materialPriceCents(v.costCents!, v.markupPct!) : v.priceCents!,
    costCents: v.kind === "MATERIAL" ? (v.costCents ?? null) : null,
    markupPct: v.kind === "MATERIAL" ? (v.markupPct ?? null) : null,
  };
}

export async function listPriceItems(filter: { kind?: "LABOUR" | "CALL_OUT" | "STANDARD_JOB" | "MATERIAL"; activeOnly?: boolean } = {}) {
  return appDb.priceItem.findMany({
    where: { ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.activeOnly ? { active: true } : {}) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

export async function createPriceItem(input: PriceItemInput, actor: Actor) {
  const v = PriceItemInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const item = await tx.priceItem.create({ data: { kind: v.kind, name: v.name, description: v.description ?? null, unit: v.unit, ...resolvePrice(v) } });
    await recordActivity(tx, { actor, entityType: "pricing", entityId: item.id, kind: "CREATED", summary: `Price list item added: ${item.name}` });
    return item;
  });
}

export async function updatePriceItem(id: string, input: PriceItemInput, actor: Actor) {
  const v = PriceItemInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const item = await tx.priceItem.update({ where: { id }, data: { kind: v.kind, name: v.name, description: v.description ?? null, unit: v.unit, ...resolvePrice(v) } });
    await recordActivity(tx, { actor, entityType: "pricing", entityId: id, kind: "UPDATED", summary: `Price list item updated: ${item.name}` });
    return item;
  });
}

export async function setPriceItemActive(id: string, active: boolean, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const item = await tx.priceItem.update({ where: { id }, data: { active } });
    await recordActivity(tx, { actor, entityType: "pricing", entityId: id, kind: "UPDATED", summary: `${item.name} ${active ? "reactivated" : "retired"}` });
    return item;
  });
}

// --- Bundles: several price-list items added to a quote in one click ---------------------------------------------

export const BundleInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.preprocess(blank, z.string().trim().max(500).optional()),
  items: z
    .array(z.object({ priceItemId: z.string().min(1), quantity: z.number().positive("Quantities must be more than zero").max(10_000) }))
    .min(1, "Add at least one item to the bundle"),
});
export type BundleInput = z.input<typeof BundleInputSchema>;

const bundleInclude = { items: { orderBy: { sortOrder: "asc" as const }, include: { priceItem: true } } };

export async function listBundles(filter: { activeOnly?: boolean } = {}) {
  return appDb.priceBundle.findMany({ where: filter.activeOnly ? { active: true } : {}, orderBy: { name: "asc" }, include: bundleInclude });
}

export type BundleWithItems = Awaited<ReturnType<typeof listBundles>>[number];

export async function createBundle(input: BundleInput, actor: Actor) {
  const v = BundleInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    if (await tx.priceBundle.findUnique({ where: { name: v.name } })) throw new Error(`There is already a bundle called "${v.name}".`);
    const bundle = await tx.priceBundle.create({
      data: { name: v.name, description: v.description ?? null, items: { create: v.items.map((it, i) => ({ priceItemId: it.priceItemId, quantity: it.quantity, sortOrder: i })) } },
    });
    await recordActivity(tx, { actor, entityType: "pricing", entityId: bundle.id, kind: "CREATED", summary: `Bundle added: ${bundle.name}` });
    return bundle;
  });
}

export async function updateBundle(id: string, input: BundleInput, actor: Actor) {
  const v = BundleInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const clash = await tx.priceBundle.findUnique({ where: { name: v.name } });
    if (clash && clash.id !== id) throw new Error(`There is already a bundle called "${v.name}".`);
    await tx.priceBundleItem.deleteMany({ where: { bundleId: id } });
    const bundle = await tx.priceBundle.update({
      where: { id },
      data: { name: v.name, description: v.description ?? null, items: { create: v.items.map((it, i) => ({ priceItemId: it.priceItemId, quantity: it.quantity, sortOrder: i })) } },
    });
    await recordActivity(tx, { actor, entityType: "pricing", entityId: id, kind: "UPDATED", summary: `Bundle updated: ${bundle.name}` });
    return bundle;
  });
}

export async function setBundleActive(id: string, active: boolean, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const bundle = await tx.priceBundle.update({ where: { id }, data: { active } });
    await recordActivity(tx, { actor, entityType: "pricing", entityId: id, kind: "UPDATED", summary: `Bundle ${bundle.name} ${active ? "reactivated" : "retired"}` });
    return bundle;
  });
}

/** The quote lines a bundle adds: each item's current name, unit and price, at the bundle's quantity. Retired items are skipped. */
export function bundleLines(bundle: BundleWithItems) {
  return bundle.items
    .filter((it) => it.priceItem.active)
    .map((it) => ({ priceItemId: it.priceItemId, description: it.priceItem.name, quantity: Number(it.quantity), unit: it.priceItem.unit, unitPriceCents: it.priceItem.priceCents }));
}
