#!/usr/bin/env node
// build-requests-code.mjs — assemble the single code-review (graft) request payload from the review lens,
// the git diff, and the context files. Faithful to faff faffter-dark-adversarial-review: one review lens
// as --system, every touched file fenced as context, the git diff as the DIFF under review.
// Output: requests/code-review.json = { lens, system, user, meta }. Zero dependencies.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

const system = readFileSync(join(ROOT, "lens", "review-lens.md"), "utf8");
const diff = readFileSync(join(ROOT, "diff", "skeleton.diff"), "utf8");

// context = every code file the diff touches (bench filenames flatten repo paths with `__` for `/`)
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
    diff: "skeleton.diff", brief: "review-lens.md",
    system_bytes: Buffer.byteLength(system), user_bytes: Buffer.byteLength(user),
    diff_bytes: Buffer.byteLength(diff),
    approx_prompt_tokens: Math.round((Buffer.byteLength(system) + Buffer.byteLength(user)) / 4),
  },
};
writeFileSync(join(ROOT, "requests", "code-review.json"), JSON.stringify(payload, null, 2) + "\n");
console.log(`requests/code-review.json  system=${payload.meta.system_bytes}b diff=${payload.meta.diff_bytes}b user=${payload.meta.user_bytes}b ~${payload.meta.approx_prompt_tokens} tok  (${contextPaths.length} context files)`);
