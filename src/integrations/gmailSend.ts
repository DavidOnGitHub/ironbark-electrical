/**
 * Sends an HTML email (with a plain-text twin) through the connected Gmail account. The platform's own send step
 * is plain-text only, so branded emails go through here. Replies are threaded into the original conversation.
 * Runs in the worker only (it needs the connector's decrypted token).
 */
import { resolveConnector } from "@kabosh-digital/workflow-temporal/connectors";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Non-ASCII header text becomes RFC 2047 encoded words; line breaks are flattened (a header cannot hold one). */
export function encodeHeader(value: string): string {
  const flat = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(flat)) return flat;
  const words: string[] = [];
  let current = "";
  for (const ch of flat) {
    if (Buffer.byteLength(current + ch, "utf8") > 45) {
      words.push(current);
      current = "";
    }
    current += ch;
  }
  if (current) words.push(current);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");

export function buildMime(o: { to: string; subject: string; text: string; html: string; inReplyTo?: string; boundary?: string }): string {
  const boundary = o.boundary ?? `ib_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const head = [
    `To: ${o.to.replace(/[\r\n]+/g, " ")}`,
    `Subject: ${encodeHeader(o.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),
  ].join("\r\n");
  const part = (type: string, body: string) => `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}\r\n`;
  return `${head}\r\n\r\n${part("text/plain", o.text)}${part("text/html", o.html)}--${boundary}--\r\n`;
}

async function gmail(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const res = await fetch(`${GMAIL}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`gmail ${path} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return res.json() as Promise<{ id?: string; threadId?: string; payload?: { headers?: { name: string; value: string }[] } }>;
}

export async function sendHtmlEmail(connectorId: string, o: { to: string; subject: string; text: string; html: string; replyToMessageId?: string }): Promise<string> {
  if (!o.to.trim()) throw new Error("sendTemplatedEmail: the recipient is empty - nothing to send to");
  const connector = await resolveConnector(connectorId);
  const token = connector.secrets.accessToken;
  if (typeof token !== "string" || !token) throw new Error(`gmail: connector "${connector.name}" has no access token - reconnect it`);

  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  if (o.replyToMessageId) {
    const original = await gmail(token, "GET", `/messages/${encodeURIComponent(o.replyToMessageId)}?format=metadata&metadataHeaders=Message-ID`);
    threadId = original.threadId;
    inReplyTo = original.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value;
  }
  const raw = Buffer.from(buildMime({ to: o.to, subject: o.subject, text: o.text, html: o.html, inReplyTo }), "utf8").toString("base64url");
  const sent = await gmail(token, "POST", "/messages/send", { raw, ...(threadId ? { threadId } : {}) });
  return sent.id ?? "";
}
