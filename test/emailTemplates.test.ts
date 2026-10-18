/* eslint-disable @typescript-eslint/no-explicit-any -- step outputs are dynamic JSON in these tests */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runStep, TEST_MODE_CONTEXT_KEY } from "@kabosh-digital/workflow-temporal/testing";
import { appDb } from "../src/db/app";
import { registerIronbark } from "../src/steps/register";
import { createTemplate, deleteTemplate, DEFAULT_TEMPLATES, ensureDefaultTemplates, getTemplateByKey, listTemplates, renderTemplate, TemplateError, updateTemplate } from "../src/domain/emailTemplates";
import { addSite, createClient } from "../src/domain/clients";
import { createQuote, markQuoteSent, replaceQuoteLines } from "../src/domain/quotes";
import { truncateAll } from "./helpers";
import type { Actor } from "../src/domain/shared/actor";
import { buildMime, encodeHeader } from "../src/integrations/gmailSend";

const priya: Actor = { type: "USER", userId: "u_priya", label: "Priya Nair" };
const testMode = { [TEST_MODE_CONTEXT_KEY]: true };
const send = (config: Record<string, unknown>, context: Record<string, unknown> = testMode) => runStep("sendTemplatedEmail", config, context) as Promise<Record<string, any>>;
const ref = (path: string) => ({ $ref: path });

beforeAll(() => registerIronbark());
beforeEach(async () => {
  await truncateAll();
  await ensureDefaultTemplates();
});
afterAll(() => appDb.$disconnect());

describe("email templates", () => {
  it("seeds the defaults once and never overwrites an edited one", async () => {
    expect((await listTemplates()).length).toBe(DEFAULT_TEMPLATES.length);
    const t = (await getTemplateByKey("quote_send"))!;
    await updateTemplate(t.id, { name: "Quote", subject: "My subject {{number}}", body: "Custom {{number}}" });
    expect(await ensureDefaultTemplates()).toBe(0);
    expect((await getTemplateByKey("quote_send"))!.subject).toBe("My subject {{number}}");
  });
  it("creates with a tidy unique key, learns the variables, and keeps the key when edited", async () => {
    const a = await createTemplate({ name: "Thank you!", subject: "Thanks {{name}}", body: "Hi {{name}}, about {{job}}" });
    const b = await createTemplate({ name: "Thank you!", subject: "x", body: "y" });
    expect(a.key).toBe("thank_you");
    expect(b.key).toBe("thank_you_2");
    expect(a.variables).toEqual(["name", "job"]);
    const edited = await updateTemplate(a.id, { name: "Renamed", subject: "Hi {{who}}", body: "Body" });
    expect(edited.key).toBe("thank_you");
    expect(edited.variables).toEqual(["who"]);
  });
  it("rejects empty fields", async () => {
    await expect(createTemplate({ name: "", subject: "s", body: "b" })).rejects.toThrow("name");
    await expect(createTemplate({ name: "n", subject: " ", body: "b" })).rejects.toThrow("subject");
    await expect(createTemplate({ name: "n", subject: "s", body: " " })).rejects.toThrow("message");
  });
  it("refuses to delete a template a workflow uses, and deletes an unused one", async () => {
    const { prisma } = await import("@kabosh-digital/workflow-schema");
    const unused = await createTemplate({ name: "Unused", subject: "s", body: "b" });
    await deleteTemplate(unused.id);
    expect(await getTemplateByKey("unused")).toBeNull();
    const used = (await getTemplateByKey("review_request"))!;
    await prisma.workflowDefinition.upsert({
      where: { id: "def_test_templates" },
      create: { id: "def_test_templates", name: "Test flow", status: "DRAFT", version: 1, graph: { nodes: [{ stepKey: "sendTemplatedEmail", config: { template: "review_request" } }] } },
      update: {},
    });
    await expect(deleteTemplate(used.id)).rejects.toThrow(TemplateError);
    await expect(deleteTemplate(used.id)).rejects.toThrow("Test flow");
    await prisma.workflowDefinition.delete({ where: { id: "def_test_templates" } });
  });
});

describe("the templated email step", () => {
  it("renders the template and, in a test run, sends nothing", async () => {
    const out = await send({ template: "quote_reminder", params: { to: "pat@example.com", variables: { clientFirstName: "Pat", title: "Lights", number: "Q-1", totalText: "$100.00", validUntil: "1/1/2027", acceptUrl: "https://x.test/accept/abc" } } });
    expect(out).toEqual({ sent: true, to: "pat@example.com", subject: "Following up on quote Q-1" });
  });
  it("adds the quote's accept link itself when an older run did not map it", async () => {
    const c = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
    const q = await createQuote({ clientId: c.id, title: "Lights" }, priya);
    await replaceQuoteLines(q.id, [{ description: "Work", quantity: 1, unitPriceCents: 100000 }], priya);
    await markQuoteSent(q.id, priya);
    const vars = { clientFirstName: "Pat", title: "Lights", number: "Q-1", lines: "-", totalText: "$1", depositNote: "", validUntil: "1/1/2027" };
    const out = await send({ template: "quote_send", params: { to: "pat@example.com", variables: vars } }, { ...testMode, trigger: { quoteId: q.id } });
    expect(out.sent).toBe(true);
    // without a quote in the run there is nothing to fill in, so the gap is still reported
    await expect(send({ template: "quote_send", params: { to: "pat@example.com", variables: vars } })).rejects.toThrow(/\{\{acceptUrl\}\}/);
  });
  it("stops with a clear message when a variable has no value, even in a test run", async () => {
    await expect(send({ template: "quote_reminder", params: { to: "pat@example.com", variables: { clientFirstName: "Pat" } } })).rejects.toThrow(/needs .*\{\{title\}\}/);
  });
  it("fails clearly for an unknown template and for no template", async () => {
    await expect(send({ template: "nope", params: { to: "a@b.c", variables: {} } })).rejects.toThrow('"nope" does not exist');
    await expect(send({ params: { to: "a@b.c" } })).rejects.toThrow(/template/); // the step's own schema refuses a config with no template
  });
  it("outside a test run it needs a connected Gmail account", async () => {
    await expect(send({ template: "enquiry_reply", params: { to: "a@b.c", variables: { subject: "Hi", message: "Hello", bookingUrl: "https://example.com/book/abc" } } }, {})).rejects.toThrow(/connect a Gmail account/);
  });
  it("getQuote supplies every variable the quote templates need", async () => {
    const c = await createClient({ type: "PERSON", name: "Pat Smith", email: "pat@example.com", preferredContact: "EMAIL", tags: [] }, priya);
    const site = await addSite(c.id, { line1: "12 Wattle Cres", suburb: "Newtown", state: "NSW", postcode: "2042" }, priya);
    const q = await createQuote({ clientId: c.id, siteId: site.id, title: "Switchboard upgrade" }, priya);
    await replaceQuoteLines(q.id, [{ description: "Work", quantity: 1, unitPriceCents: 200000 }], priya);
    await markQuoteSent(q.id, priya);
    process.env.EMAIL_ALLOWLIST = "*";
    const loaded = (await runStep("getQuote", { params: { quoteId: q.id } }, {})) as Record<string, any>;
    expect(loaded.clientFirstName).toBe("Pat");
    const mail = await renderTemplate("quote_send", { clientFirstName: loaded.clientFirstName, title: loaded.title, number: loaded.number, lines: loaded.lines, totalText: loaded.totalText, depositNote: loaded.depositNote, validUntil: loaded.validUntil, acceptUrl: loaded.acceptUrl });
    expect(mail.html).toContain(loaded.acceptUrl);
    expect(mail.subject).toContain(loaded.number);
    expect(mail.text).toContain("Work (1 each)");
    expect(mail.html).toContain("<li");
    // the same variables mapped by the workflow's own refs also work
    const viaRefs = await send({ template: "quote_send", params: { to: "pat@example.com", variables: { clientFirstName: ref("load.clientFirstName"), title: ref("load.title"), number: ref("load.number"), lines: ref("load.lines"), totalText: ref("load.totalText"), depositNote: ref("load.depositNote"), validUntil: ref("load.validUntil"), acceptUrl: ref("load.acceptUrl") } } }, { ...testMode, load: loaded });
    expect(viaRefs.sent).toBe(true);
    delete process.env.EMAIL_ALLOWLIST;
  });
});

describe("the Gmail message", () => {
  it("is multipart with a plain-text and an HTML part, and encodes a non-ASCII subject", () => {
    const mime = buildMime({ to: "a@b.c", subject: "Quote – café", text: "plain", html: "<p>html</p>", inReplyTo: "<id@mail>", boundary: "BND" });
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="BND"');
    expect(mime).toContain("In-Reply-To: <id@mail>");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime.trim().endsWith("--BND--")).toBe(true);
    expect(Buffer.from(mime.split("text/html")[1]!.split("\r\n\r\n")[1]!.split("\r\n--")[0]!.replace(/\r\n/g, ""), "base64").toString()).toBe("<p>html</p>");
  });
  it("leaves an ASCII subject alone and flattens line breaks", () => {
    expect(encodeHeader("Hello world")).toBe("Hello world");
    expect(encodeHeader("a\r\nBcc: x@y.z")).toBe("a Bcc: x@y.z");
  });
});
