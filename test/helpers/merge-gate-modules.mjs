// FAFF-1391: merge-gate.js is a facade over sibling modules. A source-level guard that once read
// merge-gate.js reads every module of the merge locus instead, so moving code between them cannot
// take it out of the guard's sight.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MERGE_GATE_MODULES = [
  "merge-gate.js",
  "merge-gate-classify.js",
  "merge-gate-effects.js",
  "merge-gate-floor.js",
  "merge-gate-gh.js",
  "merge-gate-local.js",
  "merge-gate-pr-create.js",
  "merge-gate-selftest.js",
  "merge-gate-stack.js",
];

// { file: source } for every merge-gate module. Throws when the files on disk differ from the list,
// so a new module cannot escape a guard and a removed one cannot leave it reading nothing.
export function readMergeGateSources(lib) {
  const onDisk = readdirSync(lib).filter((f) => /^merge-gate(-[a-z0-9-]+)?\.js$/.test(f)).sort();
  const listed = [...MERGE_GATE_MODULES].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(listed)) {
    throw new Error(`merge-gate modules on disk ${JSON.stringify(onDisk)} differ from MERGE_GATE_MODULES ${JSON.stringify(listed)}`);
  }
  return Object.fromEntries(MERGE_GATE_MODULES.map((f) => [f, readFileSync(join(lib, f), "utf8")]));
}
