/**
 * Phase 2 demo data: the price list, quotes in every state and jobs across their
 * lifecycle, laid out relative to "now" so the schedule always has this week's work.
 * Runs after seedBusiness (it attaches quotes to the seeded enquiries).
 */
import { appDb } from "../src/db/app";
import { computeTotals, lineTotalCents, materialPriceCents, addDays } from "../src/domain/quotes/calc";
import { addDaysKey, dayKey, startOfDay, sydneyLocalToDate } from "../src/lib/tz";

type Kind = "LABOUR" | "CALL_OUT" | "STANDARD_JOB" | "MATERIAL";
const PRICE_LIST: { kind: Kind; name: string; unit: string; price?: number; cost?: number; markup?: number; description?: string }[] = [
  { kind: "LABOUR", name: "Electrician", unit: "hour", price: 11000, description: "Licensed electrician, standard hours" },
  { kind: "LABOUR", name: "Apprentice", unit: "hour", price: 6500 },
  { kind: "LABOUR", name: "After-hours electrician", unit: "hour", price: 18000, description: "Evenings, weekends and public holidays" },
  { kind: "CALL_OUT", name: "Standard call-out", unit: "each", price: 9500, description: "Travel and first 15 minutes" },
  { kind: "CALL_OUT", name: "Emergency call-out", unit: "each", price: 19000 },
  { kind: "STANDARD_JOB", name: "Power point install (single)", unit: "each", price: 18500 },
  { kind: "STANDARD_JOB", name: "Light fitting swap", unit: "each", price: 12000 },
  { kind: "STANDARD_JOB", name: "Smoke alarm replacement", unit: "each", price: 14500 },
  { kind: "STANDARD_JOB", name: "Safety switch (RCD) install", unit: "each", price: 32000 },
  { kind: "STANDARD_JOB", name: "Ceiling fan install", unit: "each", price: 24000 },
  { kind: "STANDARD_JOB", name: "EV charger install (7kW, supply extra)", unit: "each", price: 95000 },
  { kind: "STANDARD_JOB", name: "Switchboard upgrade (basic)", unit: "each", price: 240000 },
  { kind: "MATERIAL", name: "LED downlight 10W", unit: "each", cost: 900, markup: 45 },
  { kind: "MATERIAL", name: "Double power point", unit: "each", cost: 650, markup: 60 },
  { kind: "MATERIAL", name: "Safety switch RCBO", unit: "each", cost: 7800, markup: 40 },
  { kind: "MATERIAL", name: "Smoke alarm 240V interconnect", unit: "each", cost: 3800, markup: 50 },
  { kind: "MATERIAL", name: "TPS cable 2.5mm", unit: "m", cost: 180, markup: 55 },
  { kind: "MATERIAL", name: "Ceiling fan kit", unit: "each", cost: 11800, markup: 45 },
  { kind: "MATERIAL", name: "Conduit 20mm", unit: "m", cost: 220, markup: 50 },
  { kind: "MATERIAL", name: "Weatherproof power point", unit: "each", cost: 1400, markup: 55 },
];

export async function seedPriceList() {
  const byName = new Map<string, { id: string; name: string; unit: string; priceCents: number }>();
  for (const p of PRICE_LIST) {
    const priceCents = p.price ?? materialPriceCents(p.cost!, p.markup!);
    const row = await appDb.priceItem.create({
      data: { kind: p.kind, name: p.name, unit: p.unit, description: p.description ?? null, priceCents, costCents: p.cost ?? null, markupPct: p.markup ?? null },
    });
    byName.set(p.name, { id: row.id, name: row.name, unit: row.unit, priceCents });
  }
  await seedBundles(byName);
  return byName;
}

/** Bundles: the common jobs as one click on a quote. Descriptions use the words customers use, so "Suggest lines" can match them. */
export const BUNDLES: { name: string; description: string; items: { item: string; qty: number }[] }[] = [
  { name: "Downlight package (6 LEDs)", description: "LED downlights supplied and fitted, with cable and call-out", items: [{ item: "Standard call-out", qty: 1 }, { item: "Electrician", qty: 3 }, { item: "LED downlight 10W", qty: 6 }, { item: "TPS cable 2.5mm", qty: 14 }] },
  { name: "Ceiling fan package (3 fans)", description: "Ceiling fans supplied and installed", items: [{ item: "Ceiling fan install", qty: 3 }, { item: "Ceiling fan kit", qty: 3 }, { item: "TPS cable 2.5mm", qty: 9 }] },
  { name: "EV charger package", description: "EV charger installation with conduit and a weatherproof power point", items: [{ item: "EV charger install (7kW, supply extra)", qty: 1 }, { item: "Conduit 20mm", qty: 8 }, { item: "Electrician", qty: 1.5 }, { item: "Weatherproof power point", qty: 1 }] },
  { name: "Switchboard upgrade package", description: "Switchboard upgrade with new safety switches (RCBO), old ceramic fuses replaced", items: [{ item: "Switchboard upgrade (basic)", qty: 1 }, { item: "Safety switch RCBO", qty: 6 }, { item: "Apprentice", qty: 4 }] },
  { name: "Smoke alarm compliance (5 alarms)", description: "Smoke alarms replaced and interconnected to current standard", items: [{ item: "Smoke alarm replacement", qty: 5 }, { item: "Smoke alarm 240V interconnect", qty: 5 }] },
  { name: "Fault finding visit", description: "Fault finding and repair: tripping safety switch, power point or light not working", items: [{ item: "Standard call-out", qty: 1 }, { item: "Electrician", qty: 1.5 }, { item: "Double power point", qty: 1 }] },
  { name: "Extra power points (4 double)", description: "Extra double power points added to a room", items: [{ item: "Power point install (single)", qty: 4 }, { item: "Double power point", qty: 4 }, { item: "Electrician", qty: 1 }] },
];

export async function seedBundles(byName: Map<string, { id: string }>) {
  for (const b of BUNDLES) {
    await appDb.priceBundle.create({
      data: { name: b.name, description: b.description, items: { create: b.items.map((it, i) => ({ priceItemId: byName.get(it.item)!.id, quantity: it.qty, sortOrder: i })) } },
    });
  }
}

type Items = Awaited<ReturnType<typeof seedPriceList>>;
type LineSpec = { item: string; qty: number };
const PACKAGES: Record<string, LineSpec[]> = {
  downlights: [{ item: "Standard call-out", qty: 1 }, { item: "Electrician", qty: 3 }, { item: "LED downlight 10W", qty: 6 }, { item: "TPS cable 2.5mm", qty: 14 }],
  evCharger: [{ item: "EV charger install (7kW, supply extra)", qty: 1 }, { item: "Conduit 20mm", qty: 8 }, { item: "Electrician", qty: 1.5 }, { item: "Weatherproof power point", qty: 1 }],
  switchboard: [{ item: "Switchboard upgrade (basic)", qty: 1 }, { item: "Safety switch RCBO", qty: 6 }, { item: "Apprentice", qty: 4 }],
  fault: [{ item: "Standard call-out", qty: 1 }, { item: "Electrician", qty: 1.5 }, { item: "Double power point", qty: 1 }],
  fans: [{ item: "Ceiling fan install", qty: 3 }, { item: "Ceiling fan kit", qty: 3 }, { item: "TPS cable 2.5mm", qty: 9 }],
  smoke: [{ item: "Smoke alarm replacement", qty: 5 }, { item: "Smoke alarm 240V interconnect", qty: 5 }],
  gpo: [{ item: "Power point install (single)", qty: 4 }, { item: "Double power point", qty: 4 }, { item: "Electrician", qty: 1 }],
};
const TITLE: Record<string, string> = {
  downlights: "Install 6 LED downlights",
  evCharger: "EV charger installation",
  switchboard: "Switchboard upgrade with safety switches",
  fault: "Fault finding and repair",
  fans: "Install 3 ceiling fans",
  smoke: "Smoke alarms to current standard",
  gpo: "Extra power points",
};
const PKG_KEYS = Object.keys(PACKAGES);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedQuotesAndJobs(userIds: Record<string, string>, items: Items, now = new Date()) {
  const rand = rng(77123);
  const owner = userIds["owner@ironbark.test"]!;
  const office = userIds["office@ironbark.test"]!;
  const techs = [userIds["jordan@ironbark.test"]!, userIds["mia@ironbark.test"]!];
  const techLabel = new Map([[techs[0]!, "Jordan Lee"], [techs[1]!, "Mia Chen"]]);
  const DAY = 86_400_000;
  const ago = (days: number, hour = 9) => new Date(now.getTime() - days * DAY + (hour - 12) * 3_600_000);
  let quoteNo = 1000;
  let jobNo = 2000;
  const counts = { quotes: 0, jobs: 0, events: 0 };

  const event = async (data: { at: Date; actorLabel: string; actorUserId: string | null; clientId: string; entityType: string; entityId: string; kind: string; summary: string; body?: string | null }) => {
    await appDb.activityEvent.create({ data: { actorType: "USER", ...data, body: data.body ?? null } });
    counts.events++;
  };

  async function makeQuote(opts: {
    clientId: string;
    siteId: string | null;
    requestId: string | null;
    pkg: string;
    status: "DRAFT" | "SENT" | "APPROVED" | "DECLINED";
    createdDaysAgo: number;
    sentDaysAgo?: number;
    decidedDaysAgo?: number;
    note?: string;
    emptyDraft?: boolean;
  }) {
    const specs = opts.emptyDraft ? [] : PACKAGES[opts.pkg]!;
    const lines = specs.map((s, i) => {
      const it = items.get(s.item)!;
      return { position: i, priceItemId: it.id, description: it.name, quantity: s.qty, unit: it.unit, unitPriceCents: it.priceCents, lineTotalCents: lineTotalCents(s.qty, it.priceCents) };
    });
    const totals = computeTotals(lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents })));
    const created = ago(opts.createdDaysAgo);
    const sentAt = opts.status === "DRAFT" ? null : ago(opts.sentDaysAgo ?? opts.createdDaysAgo - 0.1, 10);
    const validUntil = sentAt ? addDays(sentAt, 14) : addDays(created, 14);
    quoteNo++;
    const number = `Q-${quoteNo}`;
    const quote = await appDb.quote.create({
      data: {
        number,
        clientId: opts.clientId,
        siteId: opts.siteId,
        requestId: opts.requestId,
        status: opts.status,
        title: TITLE[opts.pkg]!,
        notes: opts.emptyDraft ? null : "Price includes all labour and materials listed. Excludes plastering or painting after cable runs. Work to AS/NZS 3000.",
        validUntil,
        ...totals,
        sentAt,
        decidedAt: opts.decidedDaysAgo != null ? ago(opts.decidedDaysAgo, 15) : null,
        decisionNote: opts.note ?? null,
        createdByUserId: office,
        createdAt: created,
        lines: { create: lines },
      },
    });
    counts.quotes++;
    await event({ at: created, actorLabel: "Priya Nair", actorUserId: office, clientId: opts.clientId, entityType: "quote", entityId: quote.id, kind: "CREATED", summary: `Quote ${number} drafted: ${quote.title}` });
    if (sentAt) await event({ at: sentAt, actorLabel: "Priya Nair", actorUserId: office, clientId: opts.clientId, entityType: "quote", entityId: quote.id, kind: "SENT", summary: `Quote ${number} sent` });
    if (opts.status === "APPROVED" || opts.status === "DECLINED") {
      await event({ at: ago(opts.decidedDaysAgo ?? 1, 15), actorLabel: "Priya Nair", actorUserId: office, clientId: opts.clientId, entityType: "quote", entityId: quote.id, kind: opts.status, summary: `Quote ${number} ${opts.status === "APPROVED" ? "approved" : "declined"} by the customer`, body: opts.note ?? null });
    }
    return quote;
  }

  async function makeJob(opts: {
    quote: { id: string; clientId: string; siteId: string | null; title: string; notes: string | null; subtotalCents: number };
    status: "UNSCHEDULED" | "SCHEDULED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "INVOICED" | "PAID";
    createdDaysAgo: number;
    tech?: string;
    startAt?: Date;
    hours?: number;
    notes?: { text: string; kind?: "NOTE" | "VARIATION"; extra?: number; approved?: boolean }[];
  }) {
    jobNo++;
    const number = `J-${jobNo}`;
    const end = opts.startAt && opts.hours ? new Date(opts.startAt.getTime() + opts.hours * 3_600_000) : null;
    const done = ["COMPLETED", "INVOICED", "PAID"].includes(opts.status);
    const job = await appDb.job.create({
      data: {
        number,
        clientId: opts.quote.clientId,
        siteId: opts.quote.siteId,
        quoteId: opts.quote.id,
        title: opts.quote.title,
        scope: opts.quote.notes,
        status: opts.status,
        assignedUserId: opts.tech ?? null,
        scheduledStart: opts.startAt ?? null,
        scheduledEnd: end,
        startedAt: opts.status === "UNSCHEDULED" || opts.status === "SCHEDULED" ? null : (opts.startAt ?? null),
        completedAt: done ? end : null,
        quotedSubtotalCents: opts.quote.subtotalCents,
        createdAt: ago(opts.createdDaysAgo),
      },
    });
    counts.jobs++;
    const label = opts.tech ? techLabel.get(opts.tech)! : "";
    await event({ at: ago(opts.createdDaysAgo), actorLabel: "Priya Nair", actorUserId: office, clientId: job.clientId, entityType: "job", entityId: job.id, kind: "CREATED", summary: `Job ${number} created from the approved quote: ${job.title}` });
    if (opts.tech && opts.startAt) await event({ at: ago(opts.createdDaysAgo - 0.2), actorLabel: "Priya Nair", actorUserId: office, clientId: job.clientId, entityType: "job", entityId: job.id, kind: "SCHEDULED", summary: `${number} scheduled for ${label}` });
    if (opts.status !== "UNSCHEDULED" && opts.status !== "SCHEDULED" && opts.startAt) await event({ at: opts.startAt, actorLabel: label, actorUserId: opts.tech ?? null, clientId: job.clientId, entityType: "job", entityId: job.id, kind: "STATUS_CHANGED", summary: `${number}: ${opts.status === "COMPLETED" || opts.status === "INVOICED" || opts.status === "PAID" ? "In progress -> Completed" : opts.status === "ON_HOLD" ? "In progress -> On hold" : "Scheduled -> In progress"}` });
    for (const n of opts.notes ?? []) {
      await appDb.jobNote.create({
        data: { jobId: job.id, authorUserId: opts.tech ?? office, authorLabel: label || "Priya Nair", kind: n.kind ?? "NOTE", text: n.text, extraCents: n.extra ?? null, approved: n.approved ?? false, approvedByUserId: n.approved ? office : null, createdAt: opts.startAt ?? now },
      });
      await event({ at: opts.startAt ?? now, actorLabel: label || "Priya Nair", actorUserId: opts.tech ?? office, clientId: job.clientId, entityType: "job", entityId: job.id, kind: n.kind === "VARIATION" ? "VARIATION" : "NOTE", summary: n.kind === "VARIATION" ? `${number}: variation raised` : `${number}: note added`, body: n.text });
    }
    return job;
  }

  // --- quotes for the seeded enquiries, by their status
  const requests = await appDb.request.findMany({ where: { clientId: { not: null } }, orderBy: { receivedAt: "asc" } });
  const today = dayKey(now);
  const slot = (dayOffset: number, hour: number) => sydneyLocalToDate(`${addDaysKey(today, dayOffset)}T${String(hour).padStart(2, "0")}:00`)!;
  let pkgIdx = 0;
  const nextPkg = () => PKG_KEYS[pkgIdx++ % PKG_KEYS.length]!;
  let drafts = 0;
  for (const r of requests) {
    const base = { clientId: r.clientId!, siteId: r.siteId, requestId: r.id };
    const ageDays = (now.getTime() - r.receivedAt.getTime()) / DAY;
    if (r.status === "QUOTED") {
      await makeQuote({ ...base, pkg: nextPkg(), status: "SENT", createdDaysAgo: ageDays - 0.5, sentDaysAgo: Math.max(0.2, ageDays - 1) });
    } else if (r.status === "CONTACTED" || r.status === "SITE_VISIT_BOOKED") {
      if (drafts < 3) {
        drafts++;
        await makeQuote({ ...base, pkg: nextPkg(), status: "DRAFT", createdDaysAgo: Math.max(0.2, ageDays - 1), emptyDraft: drafts === 3 });
      }
    } else if (r.status === "LOST") {
      await makeQuote({ ...base, pkg: nextPkg(), status: "DECLINED", createdDaysAgo: ageDays - 0.5, sentDaysAgo: ageDays - 1, decidedDaysAgo: Math.max(0.2, ageDays - 4), note: r.lostReason ?? "Went with another electrician" });
    } else if (r.status === "WON") {
      const q = await makeQuote({ ...base, pkg: nextPkg(), status: "APPROVED", createdDaysAgo: ageDays - 0.5, sentDaysAgo: ageDays - 1, decidedDaysAgo: Math.max(0.3, ageDays - 3), note: "Approved by email reply" });
      // Older won work is finished (paid, or waiting on payment); the invoicing phase attaches invoices to these.
      const doneAgo = Math.max(1, ageDays - 5);
      const tech = techs[Math.floor(rand() * 2)]!;
      const status = ageDays > 24 ? "PAID" : ageDays > 15 ? "INVOICED" : "COMPLETED";
      await makeJob({ quote: q, status, createdDaysAgo: Math.max(0.5, ageDays - 3), tech, startAt: new Date(ago(doneAgo, 8).getTime()), hours: 3 + Math.floor(rand() * 3), notes: rand() < 0.4 ? [{ text: "Job complete. Switchboard labelled. Customer happy.", approved: false }] : [] });
    }
  }

  // --- an old sent quote that has gone past its validity (reads as Expired)
  const staleClient = (await appDb.client.findMany({ take: 1, skip: 20, include: { sites: true } }))[0]!;
  const staleReq = await appDb.request.create({
    data: { clientId: staleClient.id, siteId: staleClient.sites[0]?.id ?? null, source: "EMAIL", receivedAt: ago(24), category: "QUOTE_REQUEST", status: "QUOTED", statusChangedAt: ago(22), ownerUserId: office, summary: "Quote to rewire kitchen and laundry", description: "Kitchen and laundry renovation, wants circuits upgraded.", createdAt: ago(24) },
  });
  await event({ at: ago(24), actorLabel: "Priya Nair", actorUserId: office, clientId: staleClient.id, entityType: "request", entityId: staleReq.id, kind: "CREATED", summary: `Request received: ${staleReq.summary}` });
  await makeQuote({ clientId: staleClient.id, siteId: staleReq.siteId, requestId: staleReq.id, pkg: "gpo", status: "SENT", createdDaysAgo: 22, sentDaysAgo: 21 });

  // --- this week's work: approved quotes with jobs at every stage, so the schedule and the field view are alive
  const fresh = await appDb.client.findMany({ take: 8, skip: 30, include: { sites: true }, orderBy: { name: "asc" } });
  const plan: { pkg: string; status: "UNSCHEDULED" | "SCHEDULED" | "IN_PROGRESS" | "ON_HOLD"; tech?: number; day?: number; hour?: number; hours?: number; notes?: { text: string; kind?: "NOTE" | "VARIATION"; extra?: number; approved?: boolean }[] }[] = [
    { pkg: "downlights", status: "IN_PROGRESS", tech: 0, day: 0, hour: 8, hours: 4, notes: [{ text: "Roof space tight - using the hatch in the hallway." }, { text: "Two extra downlights requested in the hall", kind: "VARIATION", extra: 21000, approved: false }] },
    { pkg: "smoke", status: "SCHEDULED", tech: 1, day: 0, hour: 13, hours: 2 },
    { pkg: "fault", status: "SCHEDULED", tech: 0, day: 1, hour: 9, hours: 2 },
    { pkg: "evCharger", status: "SCHEDULED", tech: 1, day: 1, hour: 8, hours: 5 },
    { pkg: "fans", status: "SCHEDULED", tech: 0, day: 2, hour: 8, hours: 5 },
    { pkg: "switchboard", status: "SCHEDULED", tech: 1, day: 3, hour: 8, hours: 8 },
    { pkg: "gpo", status: "ON_HOLD", tech: 1, day: -1, hour: 9, hours: 3, notes: [{ text: "Waiting on the customer to clear the wall of furniture." }] },
    { pkg: "downlights", status: "UNSCHEDULED" },
    { pkg: "fault", status: "UNSCHEDULED" },
  ];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i]!;
    const client = fresh[i % fresh.length]!;
    const site = client.sites[0] ?? null;
    const createdDaysAgo = 1 + (i % 4);
    const req = await appDb.request.create({
      data: { clientId: client.id, siteId: site?.id ?? null, source: "EMAIL", receivedAt: ago(createdDaysAgo + 4), category: "NEW_INSTALL", status: "WON", statusChangedAt: ago(createdDaysAgo), ownerUserId: office, summary: TITLE[p.pkg]!, createdAt: ago(createdDaysAgo + 4) },
    });
    await event({ at: ago(createdDaysAgo + 4), actorLabel: "Priya Nair", actorUserId: office, clientId: client.id, entityType: "request", entityId: req.id, kind: "CREATED", summary: `Request received: ${req.summary}` });
    const q = await makeQuote({ clientId: client.id, siteId: site?.id ?? null, requestId: req.id, pkg: p.pkg, status: "APPROVED", createdDaysAgo: createdDaysAgo + 3, sentDaysAgo: createdDaysAgo + 2, decidedDaysAgo: createdDaysAgo, note: "Approved by email reply" });
    await makeJob({
      quote: q,
      status: p.status,
      createdDaysAgo,
      tech: p.tech !== undefined ? techs[p.tech] : undefined,
      startAt: p.day !== undefined ? slot(p.day, p.hour ?? 8) : undefined,
      hours: p.hours,
      notes: p.notes,
    });
  }

  await appDb.sequence.upsert({ where: { key: "quote" }, create: { key: "quote", value: quoteNo }, update: { value: quoteNo } });
  await appDb.sequence.upsert({ where: { key: "job" }, create: { key: "job", value: jobNo }, update: { value: jobNo } });
  void owner;
  void startOfDay;
  return counts;
}
