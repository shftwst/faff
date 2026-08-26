#!/usr/bin/env node
// build-requests-bracketed.mjs — assemble the "bracketed shared-prefix" spec-review payloads: the
// FAFF-903 cacheable shared context+spec block, PLUS a short stable priming line ahead of it and a
// closing output-format directive after the lens brief, so the instruction is unmistakable at both
// ends of the prompt while the whole `system` field stays one stable, cacheable, byte-identical prefix
// across all four lenses. Shares its context/spec assembly with build-requests.mjs (same CONTEXT_ORDER,
// same SPEC_FILE, same fencing) so the shared block here is byte-identical to `requests-shared-prefix/`'s
// `system` field, just with the priming line prepended.
// Output: requests-bracketed/<lens>.json = { lens, system, user, context_paths, meta }.
// Zero dependencies (node built-ins only). Re-run after editing lenses/, spec/, or context/.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Same context order and spec as build-requests.mjs / requests-shared-prefix — kept in lockstep
// deliberately so the shared block is identical across all three variants; only the bracketing differs.
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

// The priming line: short, stable, and VERBATIM-identical across all four lenses — it is part of the
// cacheable system prefix, so it must never vary per lens. Do not lens-substitute inside this string.
const PRIMING_LINE =
  "You are an adversarial code/spec reviewer. The large block below is shared CONTEXT (files + the " +
  "artifact under review). Your specific review lens and the REQUIRED output format ( ### <severity>: " +
  "<title> lines ) are given in the user message that follows the context — read the context, then " +
  "follow those instructions exactly and output findings only.";

const specText = readFileSync(join(ROOT, "spec", SPEC_FILE), "utf8");
const contextFiles = CONTEXT_ORDER.map((flat) => ({
  path: origPath(flat),
  text: readFileSync(join(ROOT, "context", flat), "utf8"),
}));

// assembleUserMessage-equivalent shared block: context files fenced, then the spec as the diff under
// review. Byte-identical to requests-shared-prefix/<lens>.json's `system` field.
let sharedBlock = "";
for (const f of contextFiles) sharedBlock += `<file path="${f.path}">\n${f.text}\n</file>\n\n`;
sharedBlock += `DIFF UNDER REVIEW:\n\n${specText}`;

const system = `${PRIMING_LINE}\n\n${sharedBlock}`;
const contextPaths = contextFiles.map((f) => f.path);

const payloads = [];
for (const { lens, brief } of LENSES) {
  const briefText = readFileSync(join(ROOT, "lenses", brief), "utf8");
  const directive =
    `Now output your findings for the ${lens} lens as ### <severity>: <title> blocks (severity ∈ ` +
    `blocker|major|minor|observation) exactly per the format above. If you find nothing, output the ` +
    `lens's "No ${lens} objection." line. Do not restate or summarize the context; begin your findings ` +
    `immediately.`;
  const user = `${briefText}\n\n${directive}`;
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
      variant: "bracketed shared-prefix (priming line + context+spec as prefix, lens brief + closing directive last)",
    },
  };
  writeFileSync(join(ROOT, "requests-bracketed", `${outName}.json`), JSON.stringify(payload, null, 2) + "\n");
  payloads.push(payload);
  console.log(
    `requests-bracketed/${outName}.json  system=${payload.meta.system_bytes}b user=${payload.meta.user_bytes}b ~${payload.meta.approx_prompt_tokens} tok`,
  );
}

// Caching invariant check: the whole `system` field (priming line + shared block) must be byte-identical
// across all four lenses, since only `user` (the lens brief + closing directive) may vary.
const systems = new Set(payloads.map((p) => p.system));
if (systems.size === 1) {
  console.log(`\nOK: system is byte-identical across all ${payloads.length} lenses (cacheable prefix intact).`);
} else {
  console.error(`\nFAIL: system differs across lenses (${systems.size} distinct values) — caching invariant broken.`);
  process.exitCode = 1;
}

console.log(`Done. ${LENSES.length} bracketed request payloads written to requests-bracketed/ for spec ${SPEC_FILE}.`);
