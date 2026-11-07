/**
 * Plain-language wording for people who are not technical. Nothing here may show code: no file names, error text,
 * test names or links to the code. Pure, so each rule is easy to test.
 */
import type { ErrorClass } from "./classify";
import { protectedReason } from "./guardrails";

const PAGES: Array<[RegExp, string]> = [
  [/^\/quotes\/new/, "The new quote page"],
  [/^\/quotes\/\[id\]/, "A quote page"],
  [/^\/quotes/, "The Quotes list"],
  [/^\/jobs\/\[id\]/, "A job page"],
  [/^\/jobs/, "The Jobs list"],
  [/^\/invoices\/\[id\]/, "An invoice page"],
  [/^\/invoices/, "The Invoices list"],
  [/^\/clients\/\[id\]/, "A client page"],
  [/^\/clients/, "The Clients list"],
  [/^\/requests/, "The Requests page"],
  [/^\/schedule/, "The Schedule"],
  [/^\/my-day/, "The My day page"],
  [/^\/reports/, "The Reports page"],
  [/^\/pricing/, "The Price list"],
  [/^\/email-templates/, "The Email templates page"],
  [/^\/it/, "The IT page"],
  [/^\/accept\//, "The quote acceptance page"],
  [/^\/book\//, "The booking page"],
  [/^\/pay\//, "The payment page"],
  [/^\/definitions|^\/workflows|^\/connectors/, "The automations pages"],
  [/^\/$/, "The dashboard"],
];

/** Where it happened, as a person would name it ("The Quotes list"). Falls back to a general phrase. */
export function pageLabel(route: string | null | undefined): string {
  if (!route) return "Part of the app";
  const hit = PAGES.find(([re]) => re.test(route));
  if (hit) return hit[1];
  return route.startsWith("/api/") ? "A background part of the app" : "A page in the app";
}

/** A short clause for where an error happened, including background work that is not a page. */
export function whereLabel(route: string | null | undefined, source: string | null | undefined): string {
  if (source === "worker" || source === "workflow" || source === "step") return "A background task";
  return pageLabel(route);
}

export const CLASS_PLAIN: Record<ErrorClass, string> = {
  code_bug: "a bug in the app",
  external_outage: "a service the app relies on had a problem",
  bad_data: "unexpected information in the records",
  user_error: "an invalid entry or action",
  workflow_config: "the workflow is not set up quite right",
};

/** The areas a developer must review, named for people ("Sign-in and permissions"), never as file paths. */
export function protectedAreas(files: readonly string[]): string[] {
  return [...new Set(files.map((f) => protectedReason(f)))].sort();
}

/**
 * Whether a piece of the assistant's own text is fit to show as it is. Anything that mentions files, code, branches
 * or similar is rejected, and the caller falls back to a generic sentence instead.
 */
export function looksPlain(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 12 || t.length > 600) return false;
  if (/[`{}<>=]|https?:\/\//.test(t)) return false;
  if (/\b[\w-]+\.(?:tsx?|jsx?|mjs|json|prisma|ya?ml|md|sql|css)\b/i.test(t)) return false;
  if (/[\w-]+\/[\w-]+/.test(t)) return false;
  if (/[a-z][A-Z][a-z]/.test(t)) return false;
  if (/\b(null|undefined|typeerror|referenceerror|exception|stack ?trace|function|component|props?|endpoint|api|migration|diff|commit|branch|merge|pull request|pr|ci|regex|query|schema|prisma|typescript|react|next\.?js|variable|parameter|argument|returns?|throws?|import|export|async|await)\b/i.test(t)) return false;
  return true;
}

/** The first sentence or two of a text, cut at a sentence end where it can be. */
export function firstSentences(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 3).trimEnd()}...`;
}

export const times = (n: number) => (n === 1 ? "once" : `${n} times`);
