#!/usr/bin/env node
// build.mjs: FAFF-906 spec-review case. Mirrors eval/review-bench/build-requests.mjs exactly (same
// assembly: context files fenced, then `DIFF UNDER REVIEW:\n\n<spec text>`; faffter-dark-spec-review
// supplies the spec itself as `--diff`, per its SKILL.md). Reuses the kit's own lens briefs at
// ../../../lenses/ rather than duplicating a third copy (those are guarded byte-identical to their
// canonical `plugin/skills/faffter-dark-spec-review/refute-*.md` sources by
// test/review-bench-lens-parity.test.mjs; a copy in this case dir would sit outside that guard).
//
// Source material: `spec/faff-906.md` is the committed FAFF-906 spec from the build worktree
// (records/specs/2026-08-25-FAFF-906-harden-claimstorecore-clock-skew-staleness-toctou-reclaim-design.md).
// `context/` holds the four files the spec's own "Reference context" table names (bundle.js, runcheck.js,
// claim-verdict.js, lights-out.js), at their PRE-implementation content (origin/main, before the FAFF-906
// commits). Spec review runs before the code change lands, so that is what a real refuter pass would
// have been shown. This is a RECONSTRUCTION: no raw request JSON from the actual spec-review run was
// preserved (see cases/faff-906/README.md).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LENSES_DIR = join(ROOT, "..", "..", "..", "lenses");

const SPEC_FILE = "faff-906.md";
const LENSES = [
  { lens: "architectural", brief: "refute-architectural.md" },
  { lens: "infosec", brief: "refute-infosec.md" },
  { lens: "methodology", brief: "refute-methodology.md" },
  { lens: "QA", brief: "refute-qa.md" },
];

const specText = readFileSync(join(ROOT, "spec", SPEC_FILE), "utf8");

const contextDir = join(ROOT, "context");
const files = readdirSync(contextDir).sort();
let user = "";
const contextPaths = [];
for (const f of files) {
  const path = f.replaceAll("__", "/");
  contextPaths.push(path);
  user += `<file path="${path}">\n${readFileSync(join(contextDir, f), "utf8")}\n</file>\n\n`;
}
user += `DIFF UNDER REVIEW:\n\n${specText}`;

for (const { lens, brief } of LENSES) {
  const system = readFileSync(join(LENSES_DIR, brief), "utf8");
  const outName = lens.toLowerCase();
  const payload = {
    lens,
    system,
    user,
    context_paths: contextPaths,
    meta: {
      case: "FAFF-906",
      spec: SPEC_FILE,
      brief,
      system_bytes: Buffer.byteLength(system),
      user_bytes: Buffer.byteLength(user),
      approx_prompt_tokens: Math.round((Buffer.byteLength(system) + Buffer.byteLength(user)) / 4),
    },
  };
  writeFileSync(join(ROOT, "requests", `${outName}.json`), JSON.stringify(payload, null, 2) + "\n");
  console.log(`requests/${outName}.json  system=${payload.meta.system_bytes}b user=${payload.meta.user_bytes}b ~${payload.meta.approx_prompt_tokens} tok`);
}
console.log(`\nDone. ${LENSES.length} request payloads written to requests/ for FAFF-906 spec ${SPEC_FILE}.`);
