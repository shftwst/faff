#!/usr/bin/env node
// build.mjs: FAFF-906 code-review case. Mirrors eval/review-bench/code-review/build-requests-code.mjs
// exactly (same assembly: context files fenced, then `DIFF UNDER REVIEW:\n\n<diff>`), pointed at this
// case's own lens/diff/context instead of the kit's skeleton fixture.
//
// Source material for FAFF-906 ("Harden claimStoreCore: clock-skew-safe staleness and TOCTOU-closed
// reclaim"): `diff/faff-906.diff` is `git diff origin/main...HEAD` from the FAFF-906 build worktree
// (branch faff-906-harden-the-shared-claim-store-stalenessreclaim-primitive, tip 63ac4af8), the exact
// diff faff-graft's Phase 2 adversarial review sends per faffter-dark-adversarial-review/SKILL.md ("The
// full diff: git diff main...HEAD"). `context/` holds the CURRENT (post-change) full content of every
// file that diff touches, per the same skill's "--context = every file the diff touches". This is a
// RECONSTRUCTION, not a captured wire payload: the raw request JSON review-call.mjs actually sent was not
// preserved anywhere in the worktree or run artefacts (see cases/faff-906/README.md).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

const system = readFileSync(join(ROOT, "lens", "review-lens.md"), "utf8");
const diff = readFileSync(join(ROOT, "diff", "faff-906.diff"), "utf8");

// context = every file the diff touches (bench filenames flatten repo paths with `__` for `/`)
const contextDir = join(ROOT, "context");
const files = readdirSync(contextDir).sort();
let user = "";
const contextPaths = [];
for (const f of files) {
  const path = f.replaceAll("__", "/");
  contextPaths.push(path);
  user += `<file path="${path}">\n${readFileSync(join(contextDir, f), "utf8")}\n</file>\n\n`;
}
user += `DIFF UNDER REVIEW:\n\n${diff}`;

const payload = {
  lens: "code-review",
  system, user, context_paths: contextPaths,
  meta: {
    case: "FAFF-906", diff: "faff-906.diff", brief: "review-lens.md",
    system_bytes: Buffer.byteLength(system), user_bytes: Buffer.byteLength(user),
    diff_bytes: Buffer.byteLength(diff),
    approx_prompt_tokens: Math.round((Buffer.byteLength(system) + Buffer.byteLength(user)) / 4),
  },
};
writeFileSync(join(ROOT, "requests", "code-review.json"), JSON.stringify(payload, null, 2) + "\n");
console.log(`requests/code-review.json  system=${payload.meta.system_bytes}b diff=${payload.meta.diff_bytes}b user=${payload.meta.user_bytes}b ~${payload.meta.approx_prompt_tokens} tok  (${contextPaths.length} context files)`);
