/**
 * Booking module - the public API for what the customer does themselves from the emailed "pick a time" link:
 * see the times that are really free, choose one, and have the site visit booked. The customer has no account;
 * the secret in the link is the only credential, and it only ever reaches that one enquiry. Code, not AI,
 * decides what is free, and the booking is checked again at the moment of choosing.
 */
import { prisma } from "@kabosh-digital/workflow-schema";
import { addSite, createClient, SiteInputSchema, type SiteInput } from "../clients";
import { ensureBookingToken, fillRequestContact, getRequestByBookingToken, linkClient } from "../requests";
import { appBaseUrl } from "../quotes";
import { bookSiteVisit, listVisitsForRequest, SiteVisitConflictError } from "../siteVisits";
import { freeSlots, groupByDay, VISIT_MINUTES, type Slot } from "../availability";
import { getQuoteByToken, jobDurationMinutes } from "../quotes";
import { activeHold, getJobByQuote, holdJobSlot, JobHoldError } from "../jobs";
import { formatSite } from "../clients";
import { dayKey, formatDayTime, formatTime } from "../../lib/tz";
import type { Actor } from "../shared/actor";

export const bookingUrlFor = (token: string, env?: Record<string, string | undefined>) => `${appBaseUrl(env)}/book/${token}`;

/** The link to put in the enquiry reply; creates the token on first use. */
export async function bookingUrlForRequest(requestId: string): Promise<string> {
  return bookingUrlFor(await ensureBookingToken(requestId));
}

const customer: Actor = { type: "SYSTEM", label: "Customer (booking link)" };

export class BookingError extends Error {}

export interface BookingOptions {
  now?: Date;
  technicianIds?: string[];
}

/** Everything the booking page shows; null for an unknown link. */
export async function bookingPageData(token: string, opts: BookingOptions = {}) {
  const request = await getRequestByBookingToken(token);
  if (!request) return null;
  const open = ["NEW", "CONTACTED", "SITE_VISIT_BOOKED"].includes(request.status);
  const booked = (await listVisitsForRequest(request.id)).find((v) => v.status === "SCHEDULED") ?? null;
  const days = open ? groupByDay(await freeSlots({ now: opts.now, technicianIds: opts.technicianIds }), dayKey) : [];
  // The page asks for an address only when there is no site to send the electrician to.
  const knownSite = request.site ?? (request.client?.sites.length === 1 ? request.client.sites[0]! : null);
  return {
    request,
    open,
    booked,
    days,
    knownSite,
    needsAddress: !knownSite,
    needsPhone: !request.contactPhone && !request.client?.phone,
    needsName: !request.contactName && !request.client?.name,
    knownAddress: knownSite ? formatSite(knownSite) : null,
  };
}

export interface BookByLinkInput {
  /** ISO start of the chosen slot. */
  start: string;
  name?: string;
  phone?: string;
  address?: Partial<Record<keyof SiteInput, string>>;
}

/** Books the chosen time. Returns the visit and the technician's name. */
export async function bookByLink(token: string, input: BookByLinkInput, opts: BookingOptions = {}) {
  const data = await bookingPageData(token, opts);
  if (!data) throw new BookingError("This link is not valid. Please use the link in your latest email from us.");
  if (!data.open) throw new BookingError("We have already prepared your quote, so a site visit is no longer needed. Reply to our email if you would still like one.");
  const start = new Date(input.start);
  const slot: Slot | undefined = data.days.flatMap((d) => d.slots).find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new BookingError("Sorry, that time has just been taken. Please choose another.");

  const request = data.request;
  let site = data.knownSite;
  let address: SiteInput | null = null;
  if (!site) {
    const parsed = SiteInputSchema.safeParse({ ...input.address, state: input.address?.state || "NSW" });
    if (!parsed.success) throw new BookingError(parsed.error.issues[0]?.message ?? "Please enter the address we should visit.");
    address = parsed.data;
  }
  if (data.needsPhone && !input.phone?.trim()) throw new BookingError("Please add a phone number the electrician can call.");

  // Make sure the enquiry has a client and a site to send the electrician to.
  await fillRequestContact(request.id, { contactName: input.name?.trim() || undefined, contactPhone: input.phone?.trim() || undefined }, customer);
  let clientId = request.clientId;
  if (!clientId) {
    const client = await createClient(
      { type: "PERSON", name: input.name?.trim() || request.contactName?.trim() || request.contactEmail || "New client", email: request.contactEmail ?? undefined, phone: input.phone?.trim() || request.contactPhone || undefined, preferredContact: request.contactEmail ? "EMAIL" : "PHONE", tags: [] },
      customer,
    );
    clientId = client.id;
  }
  if (address) site = await addSite(clientId, address, customer);
  if (clientId !== request.clientId || site?.id !== request.siteId) await linkClient(request.id, clientId, site?.id ?? null, customer);

  const tech = await prisma.user.findUnique({ where: { id: slot.userId }, select: { name: true, email: true } });
  const techLabel = tech?.name?.trim() || tech?.email || "our electrician";
  try {
    const visit = await bookSiteVisit(request.id, { assignedUserId: slot.userId, start: slot.start, end: new Date(slot.start.getTime() + VISIT_MINUTES * 60_000) }, customer, techLabel);
    return { visit, techLabel };
  } catch (err) {
    if (err instanceof SiteVisitConflictError) throw new BookingError("Sorry, that time has just been taken. Please choose another.");
    throw err;
  }
}

// ---- Choosing the day for the job, after accepting the quote ----

async function techName(userId: string | null | undefined): Promise<string> {
  if (!userId) return "our electrician";
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || "our electrician";
}

/** What the customer sees after accepting a quote: pick a day for the work, wait for the office to confirm the one they picked, or see the confirmed time.
 * Null when the link is not an accepted quote with a job. */
export async function jobSlotPageData(token: string, opts: BookingOptions = {}) {
  const quote = await getQuoteByToken(token);
  if (!quote || quote.effectiveStatus !== "APPROVED") return null;
  const job = await getJobByQuote(quote.id);
  if (!job) return null;
  const address = job.site ? formatSite(job.site) : null;
  if (job.status !== "UNSCHEDULED") {
    return { state: "booked" as const, job, address, hold: null, days: [], durationMinutes: 0, when: job.scheduledStart && job.scheduledEnd ? `${formatDayTime(job.scheduledStart)} - ${formatTime(job.scheduledEnd)}` : null, technician: await techName(job.assignedUserId) };
  }
  const durationMinutes = jobDurationMinutes(quote.lines);
  const days = groupByDay(await freeSlots({ now: opts.now, technicianIds: opts.technicianIds, durationMinutes }), dayKey);
  const hold = activeHold(job, opts.now);
  return {
    state: hold ? ("held" as const) : ("pick" as const),
    job,
    address,
    hold,
    days,
    durationMinutes,
    when: hold ? `${formatDayTime(hold.start)} - ${formatTime(hold.end)}` : null,
    technician: hold ? await techName(hold.userId) : null,
  };
}

/** Holds the day the customer picked for their job; the office is asked to approve it. `fresh` says whether this is the first pick. */
export async function holdJobByLink(token: string, startIso: string, opts: BookingOptions = {}) {
  const data = await jobSlotPageData(token, opts);
  if (!data) throw new BookingError("This link is not valid. Please use the link in your latest email from us.");
  if (data.state === "booked") throw new BookingError("Your job already has a confirmed time. Reply to our email if you need to change it.");
  const start = new Date(startIso);
  const slot = data.days.flatMap((d) => d.slots).find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new BookingError("Sorry, that time has just been taken. Please choose another.");
  try {
    return await holdJobSlot(data.job.id, { userId: slot.userId, start: slot.start, end: new Date(slot.start.getTime() + data.durationMinutes * 60_000) }, customer, await techName(slot.userId));
  } catch (err) {
    if (err instanceof JobHoldError) throw new BookingError(err.message);
    throw err;
  }
}
