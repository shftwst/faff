#!/usr/bin/env node
// build-requests.mjs — assemble the 4 transport-agnostic lens request payloads from the lens briefs,
// the spec, and the context files. Faithful to faff review-call.mjs `assembleUserMessage`: each context
// file is fenced as <file path="..."> ahead of the spec, which is presented as the DIFF under review.
// Output: requests/<lens>.json = { lens, system, user, context_paths, meta }.
// Zero dependencies (node built-ins only). Re-run after editing lenses/, spec/, or context/.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Context files in the exact order faff sent them for this spec's review. Bench filenames flatten the
// original repo path with `__` for `/`; the fence uses the reconstructed original path (what the
// reviewer actually saw), so the benchmark prompt is byte-identical to the real review.
const CONTEXT_ORDER = [
  "api__main.go",
  "api__internal__httpapi__healthz.go",
  "api__internal__migrations__migrations.go",
  "api__internal__migrations__000001_baseline.up.sql",
  "db__init__10-roles.sh",
  "api__internal__config__config.go",
  "api__internal__db__migrate.go",
  "api__internal__db__connect.go",
];
const origPath = (flat) => flat.replaceAll("__", "/");

const SPEC_FILE = "gk-20260819-weudrt.md";
const LENSES = [
  { lens: "architectural", brief: "refute-architectural.md" },
  { lens: "infosec", brief: "refute-infosec.md" },
  { lens: "methodology", brief: "refute-methodology.md" },
  { lens: "QA", brief: "refute-qa.md" },
];

const specText = readFileSync(join(ROOT, "spec", SPEC_FILE), "utf8");
const contextFiles = CONTEXT_ORDER.map((flat) => ({
  path: origPath(flat),
  text: readFileSync(join(ROOT, "context", flat), "utf8"),
}));

// review-call.mjs assembleUserMessage: context files fenced, then the diff.
let user = "";
for (const f of contextFiles) user += `<file path="${f.path}">\n${f.text}\n</file>\n\n`;
user += `DIFF UNDER REVIEW:\n\n${specText}`;

const contextPaths = contextFiles.map((f) => f.path);
for (const { lens, brief } of LENSES) {
  const system = readFileSync(join(ROOT, "lenses", brief), "utf8");
  const outName = lens.toLowerCase();
  const payload = {
    lens,
    system,
    user,
    context_paths: contextPaths,
    meta: {
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
console.log(`\nDone. ${LENSES.length} request payloads written to requests/ for spec ${SPEC_FILE}.`);
