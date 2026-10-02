/**
 * Turns an email template (subject + light markup) and its variables into a branded HTML email with a
 * plain-text twin. Pure, so it runs in the worker, on the server and live in the editor's preview.
 *
 * Markup, deliberately small: blank line = new paragraph; "- " lines = bullet list; **bold**; *italic*;
 * [text](https://link). A paragraph that is only a link becomes a button. Placeholders look like {{name}}.
 * Everything a variable or template author types is HTML-escaped, so no value can inject markup.
 */

export type Variables = Record<string, string | number | null | undefined>;
export interface Brand {
  name: string;
  phone?: string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Names used as {{placeholders}}, in order of first appearance. */
export function findPlaceholders(...texts: string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(PLACEHOLDER)) seen.add(m[1]!);
  return [...seen];
}

/** Fills placeholders. A variable that is absent is reported and left visible as {{name}}; an empty string
 * is a real value (an optional part of the email that does not apply this time). */
export function substitute(text: string, vars: Variables): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) {
      missing.add(name);
      return `{{${name}}}`;
    }
    return String(v);
  });
  return { text: out, missing: [...missing] };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;

function inline(raw: string): string {
  let h = escapeHtml(raw);
  h = h.replace(LINK, (_, t: string, url: string) => `<a href="${url}" style="color:#2c5e43;text-decoration:underline">${t}</a>`);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return h;
}

const P = 'style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1f1a17"';

function blocksToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*-\s+/.test(l))) {
        const items = lines.map((l) => `<li style="margin:0 0 6px">${inline(l.replace(/^\s*-\s+/, ""))}</li>`).join("");
        return `<ul style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.55;color:#1f1a17">${items}</ul>`;
      }
      const only = block.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (only) {
        return `<p style="margin:8px 0 20px"><a href="${only[2]}" style="display:inline-block;background:#f6b800;color:#1f1a17;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:4px">${escapeHtml(only[1]!)}</a></p>`;
      }
      return `<p ${P}>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("\n");
}

function toPlainText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(LINK, (_, t: string, url: string) => (t.trim() === url ? url : `${t} (${url})`))
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .trim();
}

function layout(innerHtml: string, brand: Brand, subject: string): string {
  const footer = [brand.name, brand.phone].filter((x): x is string => !!x).map(escapeHtml).join(" &middot; ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#ecefe9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ecefe9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:Helvetica,Arial,sans-serif">
<tr><td style="background:#2b2420;padding:18px 28px;border-bottom:4px solid #f6b800;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px">${escapeHtml(brand.name)}</td></tr>
<tr><td style="padding:28px 28px 12px">
${innerHtml}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #d8dad2;font-size:13px;line-height:1.5;color:#5a564f">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** Placeholders that had no value. Sending must stop when this is not empty. */
  missing: string[];
}

export function renderEmail(template: { subject: string; body: string }, vars: Variables, brand: Brand): RenderedEmail {
  const s = substitute(template.subject, vars);
  const b = substitute(template.body, vars);
  const subject = s.text.replace(/\s*\n\s*/g, " ").trim();
  return {
    subject,
    text: toPlainText(b.text) + (brand.phone ? `\n\n--\n${brand.name}\n${brand.phone}` : `\n\n--\n${brand.name}`),
    html: layout(blocksToHtml(b.text), brand, subject),
    missing: [...new Set([...s.missing, ...b.missing])],
  };
}

/** Lower-case slug for a template key: "Quote reminder!" -> "quote_reminder". */
export function slugKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}
