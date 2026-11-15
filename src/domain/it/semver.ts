/** Just enough version handling to pick the highest of several patched versions. Mirrors scripts/security/normalize.mjs. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const parts = (v: string) => v.split("-")[0]!.split(".").map(Number);

export const isVersion = (v: unknown): v is string => typeof v === "string" && VERSION.test(v);

/** Compares two x.y.z versions (a pre-release tag counts as lower than the same release). */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  const [pa, pb] = [a.includes("-"), b.includes("-")];
  return pa === pb ? 0 : pa ? -1 : 1;
}

/** The highest of the plain versions given, or null when there is none. */
export function highestVersion(versions: (string | null | undefined)[]): string | null {
  const ok = versions.filter(isVersion).sort(compareVersions);
  return ok.length ? ok[ok.length - 1]! : null;
}
