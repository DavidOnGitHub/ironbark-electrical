"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { userActor } from "../domain/shared/actor";
import { createBundle, createPriceItem, setBundleActive, setPriceItemActive, updateBundle, updatePriceItem, type BundleInput, type PriceItemInput } from "../domain/pricing";
import { parseMoney } from "../lib/money";
import { errorMessage, text, type ActionState } from "./shared";

function priceFields(formData: FormData): PriceItemInput {
  const kind = (text(formData, "kind") ?? "LABOUR") as PriceItemInput["kind"];
  const cost = parseMoney(text(formData, "cost"));
  const markup = text(formData, "markupPct")?.trim();
  const price = parseMoney(text(formData, "price"));
  const derived = kind === "MATERIAL" && cost !== null && markup !== undefined && markup !== "";
  return {
    kind,
    name: text(formData, "name") ?? "",
    description: text(formData, "description"),
    unit: text(formData, "unit") || "each",
    priceCents: derived ? undefined : (price ?? undefined),
    costCents: kind === "MATERIAL" && cost !== null ? cost : undefined,
    markupPct: derived ? Number(markup) : undefined,
  };
}

export async function savePriceItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.PRICING);
  const id = text(formData, "priceItemId");
  try {
    if (id) await updatePriceItem(id, priceFields(formData), userActor(user));
    else await createPriceItem(priceFields(formData), userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/pricing");
  return { error: null, ok: true };
}

export async function togglePriceItemAction(formData: FormData): Promise<void> {
  const user = await requireRole(Access.PRICING);
  const id = text(formData, "priceItemId");
  if (!id) return;
  await setPriceItemActive(id, text(formData, "active") === "yes", userActor(user));
  revalidatePath("/pricing");
}

export async function saveBundleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(Access.PRICING);
  const id = text(formData, "bundleId");
  try {
    const items = JSON.parse(text(formData, "items") ?? "[]") as BundleInput["items"];
    const input: BundleInput = { name: text(formData, "name") ?? "", description: text(formData, "description"), items };
    if (id) await updateBundle(id, input, userActor(user));
    else await createBundle(input, userActor(user));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/pricing");
  return { error: null, ok: true };
}

export async function toggleBundleAction(formData: FormData): Promise<void> {
  const user = await requireRole(Access.PRICING);
  const id = text(formData, "bundleId");
  if (!id) return;
  await setBundleActive(id, text(formData, "active") === "yes", userActor(user));
  revalidatePath("/pricing");
}
