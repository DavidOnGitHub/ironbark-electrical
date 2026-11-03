/**
 * Demo data for Ironbark Electrical: a believable small-business book of
 * clients, sites and enquiries, generated from a fixed seed so every reset gives
 * the same story. All names, numbers and addresses are fictional.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { prisma, UserRole } from "@kabosh-digital/workflow-schema";
import { appDb } from "../src/db/app";
import { normalizeEmail, normalizePhone } from "../src/domain/clients/normalize";

// The default is public (it is in this repo): set DEMO_PASSWORD when seeding any deployment reachable from the internet.
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Ironbark-demo-1";

export const DEMO_USERS = [
  { email: "owner@ironbark.test", name: "Sam Walker", roles: [UserRole.ADMIN] },
  { email: "office@ironbark.test", name: "Priya Nair", roles: [UserRole.EDITOR] },
  { email: "jordan@ironbark.test", name: "Jordan Lee", roles: [UserRole.OPERATOR] },
  { email: "mia@ironbark.test", name: "Mia Chen", roles: [UserRole.OPERATOR] },
  { email: "books@ironbark.test", name: "Dana Ortiz", roles: [UserRole.VIEWER] },
];

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

/** Same scrypt format the console verifies. Re-running resets the demo accounts' passwords. */
export async function seedUsers() {
  const ids: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, roles: u.roles, passwordHash: hashPassword(DEMO_PASSWORD) },
      create: { email: u.email, name: u.name, roles: u.roles, passwordHash: hashPassword(DEMO_PASSWORD), provider: "credentials" },
    });
    ids[u.email] = user.id;
  }
  return ids;
}

// Deterministic pseudo-random numbers (mulberry32).
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

const FIRST = ["Olivia", "Liam", "Charlotte", "Noah", "Amelia", "Oliver", "Isla", "William", "Mia", "Jack", "Ava", "Henry", "Grace", "Lucas", "Chloe", "Ethan", "Zoe", "Mason", "Ruby", "Leo", "Sophie", "Harry", "Matilda", "Archie", "Evie", "Max", "Ella", "Thomas", "Lily", "Hugo", "Hannah", "Samuel", "Priscilla", "Wei", "Aarav", "Fatima", "Dmitri", "Kofi", "Sienna", "Tane"];
const LAST = ["Nguyen", "Smith", "Patel", "Jones", "Williams", "Brown", "Kaur", "Wilson", "Taylor", "Anderson", "Thompson", "Martin", "Singh", "Walker", "Harris", "Lee", "Ryan", "Kelly", "Papadopoulos", "Rossi", "Hughes", "Murphy", "Campbell", "Mitchell", "Sharma", "O'Brien", "Zhang", "Costa", "Fraser", "Dawson"];
const COMPANIES = ["Parramatta Physio Group", "Harbourview Strata Management", "Blue Gum Cafe", "Westside Auto Repairs", "Corner Bakehouse", "Marrickville Print Co", "Northern Beaches Dental", "Oakleaf Property Management", "Sunrise Childcare Centre", "Kingsford Fitness Studio"];
const SUBURBS: [string, string][] = [["Parramatta", "2150"], ["Bondi", "2026"], ["Newtown", "2042"], ["Chatswood", "2067"], ["Penrith", "2750"], ["Manly", "2095"], ["Randwick", "2031"], ["Marrickville", "2204"], ["Blacktown", "2148"], ["Cronulla", "2230"], ["Lane Cove", "2066"], ["Hornsby", "2077"], ["Strathfield", "2135"], ["Bankstown", "2200"], ["Liverpool", "2170"]];
const STREETS = ["Elizabeth St", "Station Rd", "Park Ave", "Victoria St", "George St", "Church St", "Wattle Cres", "Banksia Dr", "Oxford St", "Ocean Pde", "Railway Pde", "King St", "Beach Rd", "Bridge St"];
const ACCESS = ["Dog in the yard - call on arrival", "Key in lockbox, code from office", "Side gate, ring bell", "Tenant home weekdays after 4pm", "Concierge at front desk, sign in", "Steep driveway, park on street", "Access via rear laneway"];
const BOARD = ["Garage, ceramic fuses, no RCD", "Hallway cupboard, 6 circuits, RCD fitted", "Outside meter box, older rewireable fuses", "Garage, recent switchboard, spare ways available", "Laundry cupboard, no safety switch on lighting"];

const FAULT = ["Power points in kitchen not working", "Safety switch keeps tripping", "Lights flickering in lounge room", "No power to the garage", "Oven trips the breaker when turned on", "Dimmer buzzing in dining room", "Bathroom exhaust fan stopped working", "Hot water system has no power"];
const INSTALL = ["Install 6 LED downlights in living room", "EV charger install in garage", "Install 3 ceiling fans", "Smoke alarms to code before sale", "Outdoor sensor lights on side path", "TV and data points in new study", "Extra power points in home office", "Pool pump circuit and isolator"];
const QUOTE = ["Quote to rewire 1960s house", "Quote for switchboard upgrade with safety switches", "Quote to connect solar battery", "Quote for LED upgrade across shop"];

interface Seeded {
  clients: number;
  sites: number;
  requests: number;
  events: number;
}

const DAY = 86_400_000;

export async function seedBusiness(userIds: Record<string, string>, now = new Date()): Promise<Seeded> {
  const rand = rng(20261001);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const owner = userIds["owner@ironbark.test"]!;
  const office = userIds["office@ironbark.test"]!;
  const ownerStaff = [office, office, office, owner];
  const ago = (days: number, hour = 9) => new Date(now.getTime() - days * DAY + (hour - 12) * 3_600_000);

  // --- clients and sites
  const people = 50;
  const clientRows: { id: string; name: string; email: string | null; phone: string | null; siteIds: string[]; created: Date }[] = [];
  let siteCount = 0;
  let eventCount = 0;
  for (let i = 0; i < people + COMPANIES.length; i++) {
    const isCompany = i >= people;
    const first = pick(FIRST);
    const last = pick(LAST);
    const name = isCompany ? COMPANIES[i - people]! : `${first} ${last}`;
    const email = isCompany ? `office@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example` : `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + (i % 7 === 0 ? "@example.com" : "@example.net");
    const phone = `04${String(Math.floor(rand() * 90_000_000 + 10_000_000))}`.replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3");
    const tags = [...new Set([isCompany ? "commercial" : pick(["", "", "repeat", "referral"]), i % 9 === 0 ? "landlord" : "", i % 13 === 0 ? "vip" : "", isCompany && i % 2 ? "strata" : ""].filter(Boolean))];
    const created = ago(60 + Math.floor(rand() * 400));
    const client = await appDb.client.create({
      data: {
        type: isCompany ? "COMPANY" : "PERSON",
        name,
        email,
        phone,
        emailNorm: normalizeEmail(email),
        phoneNorm: normalizePhone(phone),
        preferredContact: rand() < 0.35 ? "PHONE" : "EMAIL",
        tags,
        notes: i % 11 === 0 ? "Pays promptly. Prefers morning appointments." : null,
        createdAt: created,
        archivedAt: i === 3 ? ago(20) : null,
      },
    });
    const siteIds: string[] = [];
    const siteN = isCompany ? 1 : rand() < 0.2 ? 2 : 1;
    for (let s = 0; s < siteN; s++) {
      const [suburb, postcode] = pick(SUBURBS);
      const site = await appDb.site.create({
        data: {
          clientId: client.id,
          label: siteN > 1 ? (s === 0 ? "Home" : "Rental") : isCompany ? "Premises" : null,
          line1: `${Math.floor(rand() * 180) + 1} ${pick(STREETS)}`,
          suburb,
          state: "NSW",
          postcode,
          accessNotes: pick(ACCESS),
          switchboardNotes: pick(BOARD),
          createdAt: created,
        },
      });
      siteIds.push(site.id);
      siteCount++;
    }
    clientRows.push({ id: client.id, name, email, phone, siteIds, created });
    await appDb.activityEvent.create({
      data: { actorType: "USER", actorUserId: office, actorLabel: "Priya Nair", clientId: client.id, entityType: "client", entityId: client.id, kind: "CREATED", summary: `Client created: ${name}`, at: created },
    });
    eventCount++;
    if (i % 5 === 0) {
      await appDb.activityEvent.create({
        data: { actorType: "USER", actorUserId: owner, actorLabel: "Sam Walker", clientId: client.id, entityType: "client", entityId: client.id, kind: "NOTE", summary: "Note added", body: pick(["Long-standing customer, always refers friends.", "Wants a quote before any work is booked.", "Landlord - tenant is the contact for access.", "Asked to be emailed, not phoned."]), at: new Date(created.getTime() + 3 * DAY) },
      });
      eventCount++;
    }
  }

  // --- requests: older ones closed, recent ones open in every state
  type Plan = { daysAgo: number; hour: number; status: "NEW" | "CONTACTED" | "SITE_VISIT_BOOKED" | "QUOTED" | "WON" | "LOST"; urgency?: "URGENT" | "EMERGENCY"; summary?: string; linked: boolean; known?: boolean; category: "FAULT_REPAIR" | "NEW_INSTALL" | "QUOTE_REQUEST" };
  const plans: Plan[] = [
    { daysAgo: 0, hour: 8, status: "NEW", urgency: "EMERGENCY", summary: "Burning smell from switchboard", linked: false, category: "FAULT_REPAIR" },
    { daysAgo: 0, hour: 7, status: "NEW", linked: false, category: "FAULT_REPAIR" },
    { daysAgo: 1, hour: 15, status: "NEW", linked: false, known: true, category: "NEW_INSTALL" },
    { daysAgo: 1, hour: 11, status: "NEW", urgency: "URGENT", linked: false, category: "FAULT_REPAIR" },
    { daysAgo: 2, hour: 16, status: "NEW", linked: false, category: "QUOTE_REQUEST" },
    { daysAgo: 3, hour: 10, status: "CONTACTED", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 3, hour: 13, status: "CONTACTED", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 4, hour: 9, status: "SITE_VISIT_BOOKED", linked: true, category: "QUOTE_REQUEST" },
    { daysAgo: 5, hour: 14, status: "SITE_VISIT_BOOKED", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 6, hour: 10, status: "QUOTED", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 7, hour: 12, status: "QUOTED", linked: true, category: "QUOTE_REQUEST" },
    { daysAgo: 8, hour: 9, status: "QUOTED", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 9, hour: 15, status: "QUOTED", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 11, hour: 11, status: "CONTACTED", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 13, hour: 8, status: "WON", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 15, hour: 14, status: "WON", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 17, hour: 10, status: "WON", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 19, hour: 9, status: "LOST", linked: true, category: "QUOTE_REQUEST" },
    { daysAgo: 21, hour: 13, status: "WON", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 24, hour: 16, status: "WON", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 26, hour: 11, status: "LOST", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 29, hour: 9, status: "WON", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 31, hour: 15, status: "WON", linked: true, category: "QUOTE_REQUEST" },
    { daysAgo: 34, hour: 10, status: "WON", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 37, hour: 12, status: "LOST", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 40, hour: 9, status: "WON", linked: true, category: "NEW_INSTALL" },
    { daysAgo: 44, hour: 14, status: "WON", linked: true, category: "FAULT_REPAIR" },
    { daysAgo: 48, hour: 10, status: "WON", linked: true, category: "NEW_INSTALL" },
  ];
  const LOST_REASONS = ["Chose another electrician", "Price too high", "Decided not to proceed", "No response after quote"];
  const NEXT: Record<string, string[]> = { CONTACTED: ["CONTACTED"], SITE_VISIT_BOOKED: ["CONTACTED", "SITE_VISIT_BOOKED"], QUOTED: ["CONTACTED", "QUOTED"], WON: ["CONTACTED", "QUOTED", "WON"], LOST: ["CONTACTED", "QUOTED", "LOST"] };
  let requestCount = 0;
  let unlinkedKnownIdx = 0;
  for (const plan of plans) {
    const received = ago(plan.daysAgo, plan.hour);
    const text = plan.summary ?? pick(plan.category === "FAULT_REPAIR" ? FAULT : plan.category === "NEW_INSTALL" ? INSTALL : QUOTE);
    const client = pick(clientRows.slice(0, people));
    let contact: { name: string; email: string; phone: string } | null = null;
    if (!plan.linked) {
      // An enquirer not yet in the system; "known" ones match an existing client's email so the duplicate hint shows.
      if (plan.known) {
        const match = clientRows[5 + unlinkedKnownIdx++]!;
        contact = { name: match.name, email: match.email!.toUpperCase(), phone: match.phone! };
      } else {
        const f = pick(FIRST);
        const l = pick(LAST);
        contact = { name: `${f} ${l}`, email: `${f}.${l}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.org", phone: `04${Math.floor(rand() * 90_000_000 + 10_000_000)}` };
      }
    }
    const site = plan.linked ? client.siteIds[0]! : null;
    const closed = plan.status === "WON" || plan.status === "LOST";
    const changed = closed ? new Date(received.getTime() + (2 + Math.floor(rand() * 5)) * DAY) : plan.status === "NEW" ? received : new Date(received.getTime() + 1 * DAY);
    const req = await appDb.request.create({
      data: {
        clientId: plan.linked ? client.id : null,
        siteId: site,
        source: plan.linked ? pick(["EMAIL", "PHONE", "EMAIL"] as const) : "EMAIL",
        receivedAt: received,
        category: plan.category,
        urgency: plan.urgency ?? "ROUTINE",
        status: plan.status,
        statusChangedAt: changed,
        ownerUserId: plan.status === "NEW" ? null : pick(ownerStaff),
        contactName: contact?.name ?? null,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
        summary: text,
        description: plan.urgency === "EMERGENCY" ? "Customer reports a burning smell and a warm switchboard door. Advised to turn off the main switch and call back." : `${text}. Customer is home most afternoons.`,
        lostReason: plan.status === "LOST" ? pick(LOST_REASONS) : null,
        createdAt: received,
      },
    });
    requestCount++;
    await appDb.activityEvent.create({
      data: { actorType: plan.linked ? "USER" : "SYSTEM", actorLabel: plan.linked ? "Priya Nair" : "Inbox", actorUserId: plan.linked ? office : null, clientId: req.clientId, entityType: "request", entityId: req.id, kind: "CREATED", summary: `Request received: ${text}`, at: received },
    });
    eventCount++;
    let step = 1;
    for (const to of NEXT[plan.status] ?? []) {
      await appDb.activityEvent.create({
        data: { actorType: "USER", actorUserId: office, actorLabel: "Priya Nair", clientId: req.clientId, entityType: "request", entityId: req.id, kind: "STATUS_CHANGED", summary: `${text}: status -> ${to.replace(/_/g, " ").toLowerCase()}`, body: to === "LOST" ? req.lostReason : null, at: new Date(received.getTime() + step * 0.4 * DAY) },
      });
      eventCount++;
      step++;
    }
  }
  return { clients: clientRows.length, sites: siteCount, requests: requestCount, events: eventCount };
}
