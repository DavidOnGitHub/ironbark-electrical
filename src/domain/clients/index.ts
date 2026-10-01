/**
 * Clients module - the public API. Other modules and the app call these
 * functions only; nothing outside this folder queries the Client/Site tables.
 */
import { z } from "zod";
import { appDb, type Prisma } from "../../db/app";
import { recordActivity } from "../activity";
import type { Actor } from "../shared/actor";
import { duplicateReasons, matchKey, type DuplicateReason } from "./normalize";

export { duplicateReasons } from "./normalize";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = z.preprocess(blank, z.string().trim().max(2000).optional());

export const ClientInputSchema = z.object({
  type: z.enum(["PERSON", "COMPANY"]).default("PERSON"),
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.preprocess(blank, z.string().trim().email("Enter a valid email").max(200).optional()),
  phone: z.preprocess(blank, z.string().trim().max(40).optional()),
  preferredContact: z.enum(["EMAIL", "PHONE"]).default("EMAIL"),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  notes: optionalText,
});
export type ClientInput = z.infer<typeof ClientInputSchema>;

export const SiteInputSchema = z.object({
  label: z.preprocess(blank, z.string().trim().max(80).optional()),
  line1: z.string().trim().min(1, "Street address is required").max(200),
  line2: z.preprocess(blank, z.string().trim().max(200).optional()),
  suburb: z.string().trim().min(1, "Suburb is required").max(100),
  state: z.string().trim().min(2).max(3).default("NSW"),
  postcode: z.string().trim().regex(/^\d{4}$/, "Postcode is 4 digits"),
  accessNotes: optionalText,
  switchboardNotes: optionalText,
});
export type SiteInput = z.infer<typeof SiteInputSchema>;

/** Splits "tag one, tag two" into trimmed unique tags. */
export function parseTags(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export async function createClient(input: ClientInput, actor: Actor) {
  const data = ClientInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: { ...data, ...matchKey(data), email: data.email ?? null, phone: data.phone ?? null, notes: data.notes ?? null },
    });
    await recordActivity(tx, {
      actor,
      entityType: "client",
      entityId: client.id,
      clientId: client.id,
      kind: "CREATED",
      summary: `Client created: ${client.name}`,
    });
    return client;
  });
}

export async function updateClient(id: string, input: ClientInput, actor: Actor) {
  const data = ClientInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const client = await tx.client.update({
      where: { id },
      data: { ...data, ...matchKey(data), email: data.email ?? null, phone: data.phone ?? null, notes: data.notes ?? null },
    });
    await recordActivity(tx, { actor, entityType: "client", entityId: id, clientId: id, kind: "UPDATED", summary: "Client details updated" });
    return client;
  });
}

export async function setClientArchived(id: string, archived: boolean, actor: Actor) {
  return appDb.$transaction(async (tx) => {
    const client = await tx.client.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await recordActivity(tx, {
      actor,
      entityType: "client",
      entityId: id,
      clientId: id,
      kind: "ARCHIVED",
      summary: archived ? "Client archived" : "Client restored",
    });
    return client;
  });
}

export interface ClientListFilter {
  q?: string;
  tag?: string;
  includeArchived?: boolean;
  limit?: number;
}

/** Search matches name, email, phone digits and any site address, case-insensitively. */
export async function listClients(filter: ClientListFilter = {}) {
  const q = filter.q?.trim();
  const phoneQuery = q ? q.replace(/\D/g, "") : "";
  const where: Prisma.ClientWhereInput = {
    ...(filter.includeArchived ? {} : { archivedAt: null }),
    ...(filter.tag ? { tags: { has: filter.tag.toLowerCase() } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            ...(phoneQuery.length >= 3 ? [{ phoneNorm: { contains: phoneQuery.replace(/^0/, "") } }] : []),
            { sites: { some: { OR: [{ line1: { contains: q, mode: "insensitive" } }, { suburb: { contains: q, mode: "insensitive" } }] } } },
          ],
        }
      : {}),
  };
  return appDb.client.findMany({
    where,
    orderBy: { name: "asc" },
    take: filter.limit ?? 100,
    include: { sites: { select: { id: true, suburb: true }, take: 3 }, _count: { select: { requests: true } } },
  });
}

export async function getClient(id: string) {
  return appDb.client.findUnique({
    where: { id },
    include: {
      sites: { orderBy: { createdAt: "asc" } },
      requests: { orderBy: { receivedAt: "desc" }, take: 20 },
    },
  });
}

export async function listTags(): Promise<string[]> {
  const rows = await appDb.client.findMany({ where: { archivedAt: null }, select: { tags: true } });
  return [...new Set(rows.flatMap((r) => r.tags))].sort();
}

export interface DuplicateMatch {
  client: { id: string; name: string; email: string | null; phone: string | null };
  reasons: DuplicateReason[];
}

/** Existing clients that look like the same person (same email or phone). */
export async function findPossibleDuplicates(
  input: { email?: string | null; phone?: string | null },
  excludeClientId?: string,
): Promise<DuplicateMatch[]> {
  const key = matchKey(input);
  const or: Prisma.ClientWhereInput[] = [];
  if (key.emailNorm) or.push({ emailNorm: key.emailNorm });
  if (key.phoneNorm) or.push({ phoneNorm: key.phoneNorm });
  if (or.length === 0) return [];
  const rows = await appDb.client.findMany({
    where: { OR: or, archivedAt: null, ...(excludeClientId ? { id: { not: excludeClientId } } : {}) },
    select: { id: true, name: true, email: true, phone: true, emailNorm: true, phoneNorm: true },
    take: 5,
  });
  return rows
    .map((row) => ({
      client: { id: row.id, name: row.name, email: row.email, phone: row.phone },
      reasons: duplicateReasons(key, { emailNorm: row.emailNorm, phoneNorm: row.phoneNorm }),
    }))
    .filter((m) => m.reasons.length > 0);
}

export async function addSite(clientId: string, input: SiteInput, actor: Actor) {
  const data = SiteInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: {
        clientId,
        label: data.label ?? null,
        line1: data.line1,
        line2: data.line2 ?? null,
        suburb: data.suburb,
        state: data.state,
        postcode: data.postcode,
        accessNotes: data.accessNotes ?? null,
        switchboardNotes: data.switchboardNotes ?? null,
      },
    });
    await recordActivity(tx, {
      actor,
      entityType: "site",
      entityId: site.id,
      clientId,
      kind: "CREATED",
      summary: `Site added: ${data.line1}, ${data.suburb}`,
    });
    return site;
  });
}

export async function updateSite(siteId: string, input: SiteInput, actor: Actor) {
  const data = SiteInputSchema.parse(input);
  return appDb.$transaction(async (tx) => {
    const site = await tx.site.update({
      where: { id: siteId },
      data: {
        label: data.label ?? null,
        line1: data.line1,
        line2: data.line2 ?? null,
        suburb: data.suburb,
        state: data.state,
        postcode: data.postcode,
        accessNotes: data.accessNotes ?? null,
        switchboardNotes: data.switchboardNotes ?? null,
      },
    });
    await recordActivity(tx, { actor, entityType: "site", entityId: siteId, clientId: site.clientId, kind: "UPDATED", summary: `Site updated: ${data.line1}, ${data.suburb}` });
    return site;
  });
}

export async function addNote(clientId: string, body: string, actor: Actor) {
  const text = z.string().trim().min(1, "Write something first").max(4000).parse(body);
  return recordActivity(appDb, { actor, entityType: "client", entityId: clientId, clientId, kind: "NOTE", summary: "Note added", body: text });
}

export function formatSite(site: { line1: string; line2: string | null; suburb: string; state: string; postcode: string }): string {
  return [site.line1, site.line2, `${site.suburb} ${site.state} ${site.postcode}`].filter(Boolean).join(", ");
}
