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
