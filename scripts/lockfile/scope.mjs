// Usage: git diff --name-only <base>...HEAD | node scripts/lockfile/scope.mjs
// Decides whether the lockfile Action may run on a pull request: only when the change is limited to dependency manifests
// and the spec the assistant writes. Anything else (a registry setting in .npmrc, a script, a workflow) means a person
// should look, and the Action does nothing. Exits 0 when the change is in scope, 1 (listing the files) when it is not.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOWED = [/^package\.json$/, /^pnpm-workspace\.yaml$/, /^pnpm-lock\.yaml$/, /^specs\/[^/]+\.md$/];

/** The files in a change that a dependency fix has no business touching. */
export function outOfScope(files) {
  return files.map((f) => f.trim()).filter(Boolean).filter((f) => !ALLOWED.some((re) => re.test(f)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readFileSync(0, "utf8").split("\n");
  const bad = outOfScope(files);
  if (files.every((f) => !f.trim())) {
    console.log("No changed files found; nothing to do.");
    process.exit(1);
  }
  if (bad.length > 0) {
    console.log(`Outside a dependency change: ${bad.join(", ")}`);
    process.exit(1);
  }
  console.log("In scope.");
}
