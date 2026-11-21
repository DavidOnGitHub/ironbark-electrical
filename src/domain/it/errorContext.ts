/**
 * Error triage step 1 (PLAN-it-assistant.md, Phase 3): what the classifier and the fix request get besides the error
 * itself. How often it happens now (from the 5-minute buckets), whether it started with the release that is running,
 * what the assistant shipped shortly before it first appeared, and the code around the failing lines at the release
 * that raised it. Everything here is gathered best-effort: a missing token or a failed fetch leaves that part out and
 * never blocks triage.
 *
 * Code and change titles are untrusted data (a change title is typed by a person; the code is the app's own but may
 * quote anything). They go to the model inside the classifier's data block, never as instructions.
 */
import { appDb } from "../../db/app";

export interface CodeExcerpt {
  file: string;
  line: number;
  /** The lines around `line`, each prefixed with its number; the failing line is marked with ">". */
  excerpt: string;
}

export interface ErrorContext {
  /** How often it happens, in one sentence. */
  pattern: string;
  /** How it lines up with releases, or null when releases are unknown. */
  release: string | null;
  /** Changes the assistant made live in the two days before it first appeared, newest first. */
  recentChanges: string[];
  code: CodeExcerpt[];
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** How far before an error's first sighting a change still counts as "shortly before". */
export const CHANGE_WINDOW_MS = 2 * DAY;
const MAX_FRAMES = 2;
const EXCERPT_RADIUS = 10;
const MAX_LINE = 200;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (sha: string) => sha.slice(0, 7);
function ago(ms: number): string {
  if (ms < HOUR) return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
  if (ms < 2 * DAY) return plural(Math.round(ms / HOUR), "hour");
  return plural(Math.round(ms / DAY), "day");
}

/**
 * The app's own files and lines in a stack, first frames first, as paths from the repo root (src/... or app/...).
 * Absolute paths are made relative to the folder the app runs from (on Render /opt/render/project/src, which itself
 * ends in "src"); bundler paths like webpack-internal:///(rsc)/./app/... keep the part after "./". Dependencies and
 * Next.js internals are skipped.
 */
export function appFrames(stack: string | null | undefined, max = MAX_FRAMES, root: string = process.cwd()): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  const base = root.replace(/\/+$/, "") + "/";
  for (const raw of (stack ?? "").split("\n").slice(1)) {
    if (/node_modules|node:internal|\(node:|next\/dist/.test(raw)) continue;
    const loc = raw.match(/([^\s(]+?\.(?:ts|tsx|js|mjs)):(\d+)(?::\d+)?\)?\s*$/);
    if (!loc) continue;
    let path = loc[1]!.replace(/^file:\/\//, "");
    if (path.startsWith(base)) path = path.slice(base.length);
    else {
      const rel = path.match(/(?:^|\/\.\/|\/)((?:src|app)\/.+)$/);
      if (!rel) continue;
      path = rel[1]!;
    }
    if (!/^(?:src|app)\//.test(path) || path.split("/").includes("..")) continue;
    const line = Number(loc[2]);
    if (!out.some((f) => f.file === path && f.line === line)) out.push({ file: path, line });
    if (out.length >= max) break;
  }
  return out;
}

/** "12 times in the last hour and 40 in the last day; first seen 3 days ago." from the 5-minute buckets. */
export function describePattern(input: { buckets: { startsAt: Date; count: number }[]; total: number; firstSeenAt: Date; lastSeenAt: Date; now: Date }): string {
  const { buckets, total, firstSeenAt, lastSeenAt, now } = input;
  const since = (ms: number) => buckets.filter((b) => now.getTime() - b.startsAt.getTime() < ms).reduce((n, b) => n + b.count, 0);
  const hour = since(HOUR);
  const day = since(DAY);
  const first = `first seen ${ago(now.getTime() - firstSeenAt.getTime())} ago`;
  if (total <= 1) return `It has happened once (${first}).`;
  if (day === 0) return `${plural(total, "time")} in all, none in the last day (${first}, last ${ago(now.getTime() - lastSeenAt.getTime())} ago).`;
  const busy = buckets.filter((b) => now.getTime() - b.startsAt.getTime() < DAY).length;
  const shape = busy === 1 ? "all within a few minutes" : `spread over ${plural(busy, "5-minute stretch", "5-minute stretches")}`;
  return `${plural(hour, "time")} in the last hour and ${day} in the last day, ${shape}; ${plural(total, "time")} in all, ${first}.`;
}

/** Whether it started with the release now running: a strong sign the last change caused it. */
export function describeRelease(firstRelease: string | null, lastRelease: string | null, running: string | null): string | null {
  if (!firstRelease && !lastRelease) return null;
  const first = firstRelease ? short(firstRelease) : null;
  if (running && firstRelease === running) return `It first appeared in the release now running (${first}): it is new since the last change.`;
  if (running && first && lastRelease === running) return `It first appeared in an earlier release (${first}) and still happens in the one now running (${short(running)}).`;
  if (first && lastRelease && lastRelease !== firstRelease) return `It first appeared in release ${first} and was last seen in ${short(lastRelease)}.`;
  return first ? `It appeared in release ${first}.` : null;
}

/** Numbered lines around `line`, the failing one marked; long lines cut. */
export function excerptAround(text: string, line: number, radius = EXCERPT_RADIUS): string {
  const lines = text.split("\n");
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const width = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    const body = (lines[n - 1] ?? "").slice(0, MAX_LINE);
    out.push(`${n === line ? ">" : " "}${String(n).padStart(width)} | ${body}`);
  }
  return out.join("\n");
}

type Env = Record<string, string | undefined>;

/** The file at a commit, from GitHub (the same repo and token as the security scans). Null when unavailable. */
async function fileAt(path: string, ref: string, env: Env, f: typeof fetch): Promise<string | null> {
  const repo = env.IT_SCAN_REPO?.trim();
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{7,40}$/i.test(ref)) return null;
  const url = `https://api.github.com/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  const res = await f(url, {
    headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", ...(env.IT_SCAN_DISPATCH_TOKEN ? { authorization: `Bearer ${env.IT_SCAN_DISPATCH_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return (await res.text()).slice(0, 400_000);
}

export interface GatherOptions {
  now?: Date;
  env?: Env;
  fetchImpl?: typeof fetch;
  /** The folder the app runs from, to turn stack paths into repo paths. */
  root?: string;
}

/** Everything step 1 adds for one stored error. Never throws. */
export async function gatherErrorContext(errorId: string, opts: GatherOptions = {}): Promise<ErrorContext | null> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  try {
    const row = await appDb.errorEvent.findUnique({ where: { id: errorId } });
    if (!row) return null;
    const [buckets, changes] = await Promise.all([
      appDb.errorBucket.findMany({ where: { errorId, startsAt: { gte: new Date(now.getTime() - DAY) } }, select: { startsAt: true, count: true } }),
      appDb.itRequest.findMany({
        where: { liveAt: { gte: new Date(row.firstSeenAt.getTime() - CHANGE_WINDOW_MS), lte: row.firstSeenAt } },
        orderBy: { liveAt: "desc" },
        take: 5,
        select: { number: true, title: true, liveAt: true },
      }),
    ]);
    const ref = row.lastRelease ?? row.firstRelease;
    const code: CodeExcerpt[] = [];
    if (ref) {
      for (const frame of appFrames(row.stack, MAX_FRAMES, opts.root)) {
        try {
          const text = await fileAt(frame.file, ref, env, opts.fetchImpl ?? fetch);
          if (text) code.push({ ...frame, excerpt: excerptAround(text, frame.line) });
        } catch {
          // best-effort: leave this frame out
        }
      }
    }
    return {
      pattern: describePattern({ buckets, total: row.count, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, now }),
      release: describeRelease(row.firstRelease, row.lastRelease, env.RENDER_GIT_COMMIT ?? null),
      recentChanges: changes.map((c) => `${c.number}: ${c.title.slice(0, 120)} (live ${ago(row.firstSeenAt.getTime() - c.liveAt!.getTime())} before it first appeared)`),
      code,
    };
  } catch (err) {
    console.warn("[it] gathering error context failed", err);
    return null;
  }
}
