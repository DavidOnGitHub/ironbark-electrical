import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "../src/db/app";
import { addNote, addSite, createClient, findPossibleDuplicates, listClients, listTags, setClientArchived, updateClient } from "../src/domain/clients";
import { changeStatus, countByStatus, createClientFromRequest, createRequest, duplicateHintsForRequest, getRequest, InvalidTransitionError, linkClient, listRequests } from "../src/domain/requests";
import { listClientTimeline, listEntityTimeline } from "../src/domain/activity";
import type { Actor } from "../src/domain/shared/actor";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const flow: Actor = { type: "WORKFLOW", label: "Enquiry to reply", workflowInstanceId: "wf_1" };

beforeEach(async () => {
  await appDb.$executeRawUnsafe('TRUNCATE TABLE "ActivityEvent","Request","Site","Client" RESTART IDENTITY CASCADE');
});
afterAll(async () => {
  await appDb.$disconnect();
});

const SITE = { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" };

describe("clients", () => {
  it("creates a client with match keys and a timeline entry", async () => {
    const c = await createClient({ type: "PERSON", name: "Pat Smith", email: "Pat@Example.com", phone: "+61 412 345 678", preferredContact: "EMAIL", tags: ["repeat"] }, priya);
    expect(c.emailNorm).toBe("pat@example.com");
    expect(c.phoneNorm).toBe("0412345678");
    const timeline = await listClientTimeline(c.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "CREATED", actorType: "USER", actorUserId: "u_priya", actorLabel: "Priya Nair" });
  });

  it("rejects bad input", async () => {
    await expect(createClient({ type: "PERSON", name: " ", preferredContact: "EMAIL", tags: [] }, priya)).rejects.toThrow(/Name is required/);
    await expect(createClient({ type: "PERSON", name: "X", email: "not-an-email", preferredContact: "EMAIL", tags: [] }, priya)).rejects.toThrow(/valid email/);
  });

  it("finds duplicates by email or phone in any format, ignoring archived clients and the client itself", async () => {
    const a = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", phone: "0412 345 678", preferredContact: "EMAIL", tags: [] }, priya);
    const b = await createClient({ type: "PERSON", name: "Old Pat", email: "old@example.com", phone: "0499 111 222", preferredContact: "EMAIL", tags: [] }, priya);
    await setClientArchived(b.id, true, priya);
    expect((await findPossibleDuplicates({ email: "PAT@example.com" })).map((m) => m.client.id)).toEqual([a.id]);
    expect((await findPossibleDuplicates({ phone: "+61412345678" })).map((m) => m.reasons)).toEqual([["phone"]]);
    expect(await findPossibleDuplicates({ phone: "0499 111 222" })).toEqual([]); // archived
    expect(await findPossibleDuplicates({ email: "pat@example.com" }, a.id)).toEqual([]);
    expect(await findPossibleDuplicates({})).toEqual([]);
  });

  it("searches name, email, phone digits and site address; filters by tag; hides archived", async () => {
    const a = await createClient({ type: "PERSON", name: "Olivia Nguyen", email: "olivia@example.net", phone: "0411 222 333", preferredContact: "EMAIL", tags: ["repeat", "vip"] }, priya);
    await addSite(a.id, SITE, priya);
    const b = await createClient({ type: "COMPANY", name: "Blue Gum Cafe", email: "office@bluegum.example", phone: "0298 765 432", preferredContact: "PHONE", tags: ["commercial"] }, priya);
    const c = await createClient({ type: "PERSON", name: "Archived Person", preferredContact: "EMAIL", tags: [] }, priya);
    await setClientArchived(c.id, true, priya);
    const ids = async (f: Parameters<typeof listClients>[0]) => (await listClients(f)).map((x) => x.id).sort();
    expect(await ids({})).toEqual([a.id, b.id].sort());
    expect(await ids({ q: "olivia" })).toEqual([a.id]);
    expect(await ids({ q: "BLUE GUM" })).toEqual([b.id]);
    expect(await ids({ q: "0411 222" })).toEqual([a.id]);
    expect(await ids({ q: "newtown" })).toEqual([a.id]);
    expect(await ids({ q: "wattle" })).toEqual([a.id]);
    expect(await ids({ tag: "commercial" })).toEqual([b.id]);
    expect(await ids({ includeArchived: true })).toEqual([a.id, b.id, c.id].sort());
    expect(await listTags()).toEqual(["commercial", "repeat", "vip"]);
  });

  it("validates sites and records site and note activity", async () => {
    const a = await createClient({ type: "PERSON", name: "Pat", preferredContact: "EMAIL", tags: [] }, priya);
    await expect(addSite(a.id, { ...SITE, postcode: "20" }, priya)).rejects.toThrow(/4 digits/);
    await addSite(a.id, SITE, priya);
    await addNote(a.id, "Call before arriving", priya);
    await updateClient(a.id, { type: "PERSON", name: "Pat Smith", preferredContact: "EMAIL", tags: [] }, priya);
    const kinds = (await listClientTimeline(a.id)).map((e) => e.kind).sort();
    expect(kinds).toEqual(["CREATED", "CREATED", "NOTE", "UPDATED"]);
    await expect(addNote(a.id, "   ", priya)).rejects.toThrow(/Write something/);
  });
});

describe("requests", () => {
  it("creates a request, moves it through the pipeline, and records every step", async () => {
    const client = await createClient({ type: "PERSON", name: "Pat", preferredContact: "EMAIL", tags: [] }, priya);
    const r = await createRequest({ summary: "Safety switch keeps tripping", category: "FAULT_REPAIR", urgency: "URGENT", clientId: client.id }, priya);
    expect(r.status).toBe("NEW");
    await changeStatus(r.id, "CONTACTED", {}, priya);
    await changeStatus(r.id, "QUOTED", {}, priya);
    const won = await changeStatus(r.id, "WON", {}, priya);
    expect(won.status).toBe("WON");
    const kinds = (await listEntityTimeline("request", r.id)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "STATUS_CHANGED")).toHaveLength(3);
    expect((await listClientTimeline(client.id)).length).toBe(1 + 1 + 3); // client created, request created, 3 moves
  });

  it("refuses invalid moves and keeps the status", async () => {
    const r = await createRequest({ summary: "Install fans" }, priya);
    await expect(changeStatus(r.id, "WON", {}, priya)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await getRequest(r.id))?.status).toBe("NEW");
  });

  it("stores the lost reason, and clears it when reopened", async () => {
    const r = await createRequest({ summary: "Quote to rewire" }, priya);
    const lost = await changeStatus(r.id, "LOST", { lostReason: "Price too high" }, priya);
    expect(lost.lostReason).toBe("Price too high");
    const reopened = await changeStatus(r.id, "NEW", {}, priya);
    expect(reopened.lostReason).toBeNull();
  });

  it("lists open requests and counts by status", async () => {
    const a = await createRequest({ summary: "A", urgency: "ROUTINE" }, priya);
    await createRequest({ summary: "B", urgency: "EMERGENCY" }, priya);
    const c = await createRequest({ summary: "C" }, priya);
    await changeStatus(c.id, "LOST", {}, priya);
    expect((await listRequests({ openOnly: true })).map((r) => r.summary)).toEqual(["B", "A"]); // emergencies first
    const counts = await countByStatus();
    expect(counts).toMatchObject({ NEW: 2, LOST: 1, WON: 0 });
    await changeStatus(a.id, "CONTACTED", {}, priya);
    expect((await listRequests({ status: "CONTACTED" })).map((r) => r.summary)).toEqual(["A"]);
  });

  it("hints at an existing client for an unlinked enquirer, and can link or create one", async () => {
    const existing = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
    const r = await createRequest({ summary: "Power point dead", contactName: "P Smith", contactEmail: "PAT@EXAMPLE.COM", source: "EMAIL" }, flow);
    const hints = await duplicateHintsForRequest(r);
    expect(hints.map((h) => h.client.id)).toEqual([existing.id]);
    await linkClient(r.id, existing.id, null, priya);
    expect(await duplicateHintsForRequest((await getRequest(r.id))!)).toEqual([]);

    const r2 = await createRequest({ summary: "Install EV charger", contactName: "Lee Wong", contactPhone: "0422 333 444" }, priya);
    const created = await createClientFromRequest(r2.id, priya);
    expect(created.name).toBe("Lee Wong");
    expect((await getRequest(r2.id))?.clientId).toBe(created.id);
    await expect(createClientFromRequest(r2.id, priya)).rejects.toThrow(/already linked/);
  });

  it("attributes workflow actions to the workflow", async () => {
    const r = await createRequest({ summary: "From an email", source: "EMAIL", rawEmailRef: "msg_1" }, flow);
    const [event] = await listEntityTimeline("request", r.id);
    expect(event).toMatchObject({ actorType: "WORKFLOW", actorLabel: "Enquiry to reply", workflowInstanceId: "wf_1", actorUserId: null });
  });
});
