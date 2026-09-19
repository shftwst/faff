#!/usr/bin/env node
// FAFF-1051 — regenerate the trim-baseline goldens from a given review-call.mjs copy.
//
// Usage: node regenerate.mjs <path-to-review-call.mjs>
//
// The goldens pin "byte-identical to the pre-change function" for the unified path — the property this
// ticket's DONE list asserts but cannot check against a live oracle, because the pre-change function is
// gone once the module is edited. Run this ONCE, before editing review-call.mjs, against
// `git show <merge-base>:plugin/skills/faffter-dark-adversarial-review/review-call.mjs`. The post-change
// module is then asserted to reproduce these bytes exactly (test/faff-1051-diff-kind.test.mjs).
//
// Deliberately dependency-free and deterministic: every fixture below is fixed text, no randomness, no
// clock, no filesystem state beyond what this script itself writes.
//
// Guarded behind the entrypoint check (mirrors build-lens-requests.mjs / parse-refutation.mjs) AND a
// no-args no-op: this file lives under test/, so `node --test`'s default recursive discovery SPAWNS
// every .mjs file it finds there as its own `node <file>` child process — indistinguishable from a
// direct, argument-less invocation, so the entrypoint check alone cannot tell the two apart. A file
// with no `node:test` registrations that exits 0 is silently treated as "ran clean, nothing to report"
// (the same shape test/hermetic-env.mjs already relies on); exiting non-zero on a missing argv[2] would
// instead register the whole file as ONE failed test. So a bare `node regenerate.mjs` — argument-less,
// exactly node --test's spawn shape — prints the usage line and exits 0 (a no-op, not an error); only a
// genuinely bad argument (an unreadable/unparseable module path) is left to throw and exit non-zero.

import { writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- fixture builders (fixed content, no randomness) ---------------------------------------------

function additionFixture() {
  // A real unified diff touching touched.js at lines 200-201, alongside two no-anchor files — mirrors
  // the existing FAFF-915 test fixture shape so the two suites exercise the same regime.
  const touchedLines = Array.from({ length: 400 }, (_, i) => `touched ${i + 1}`);
  const touched = touchedLines.join("\n");
  const unrelatedBig = Array.from({ length: 400 }, (_, i) => `unrelated ${String(i + 1).padStart(3, "0")}`).join("\n");
  const unrelatedSmall = "small file\nunder the per-file floor\n";
  const diff = [
    "--- a/touched.js",
    "+++ b/touched.js",
    "@@ -199,2 +199,2 @@",
    "-touched 199",
    "-touched 200",
    "+touched 199",
    "+touched 200 changed",
  ].join("\n");
  const contextFiles = [
    { path: "touched.js", text: touched },
    { path: "unrelated_big.js", text: unrelatedBig },
    { path: "unrelated_small.js", text: unrelatedSmall },
  ];
  return { contextFiles, diff };
}

function deletionOnlyFixture() {
  // A deletion-only unified diff whose removed lines name identifiers (deadHelperXyz, legacyThingAbc) —
  // the case the suite has no fixture for today (spec §"Which of the ticket's three directions?", the
  // anchor-yield gate's rejected-direction measurement). The context file defines both helpers, spread
  // far enough apart that a window-based trim genuinely has to anchor two separate regions.
  const bodyLines = [];
  for (let i = 0; i < 50; i++) bodyLines.push(`// filler ${i}`);
  bodyLines.push("function deadHelperXyz() {");
  bodyLines.push("  return legacyThingAbc();");
  bodyLines.push("}");
  for (let i = 0; i < 300; i++) bodyLines.push(`const pad${i} = ${i}; // ${"p".repeat(24)}`);
  bodyLines.push("function legacyThingAbc() {");
  bodyLines.push("  return 42;");
  bodyLines.push("}");
  for (let i = 0; i < 50; i++) bodyLines.push(`// tail filler ${i}`);
  const helpers = bodyLines.join("\n");
  const unrelatedSmall = "small file\nunder the per-file floor\n";
  const diff = [
    "--- a/helpers.js",
    "+++ b/helpers.js",
    "@@ -500,3 +500,0 @@",
    "-function deadHelperXyz() {",
    "-  return legacyThingAbc();",
    "-}",
  ].join("\n");
  const contextFiles = [
    { path: "helpers.js", text: helpers },
    { path: "unrelated_small.js", text: unrelatedSmall },
  ];
  return { contextFiles, diff };
}

function tightenUnifiedFixture() {
  // An anchor-dense fixture (mirrors test/adversarial-context-window.test.mjs's denseFixture): the diff
  // references identifiers spread through the file, so the descending window ladder has real reduction
  // to find at more than one rung.
  const lines = 6000, anchors = 40;
  const body = [];
  for (let i = 0; i < lines; i++) body.push(`const fn${i} = ${i}; // ${"p".repeat(24)}`);
  const step = Math.floor(lines / anchors);
  const hunks = ["--- a/dense.js", "+++ b/dense.js"];
  for (let k = 0; k < anchors; k++) {
    const ln = k * step;
    hunks.push(`@@ -${ln + 1},1 +${ln + 1},2 @@`, `+  use(fn${ln});`);
  }
  return { contextFiles: [{ path: "dense.js", text: body.join("\n") }], diff: hunks.join("\n") + "\n" };
}

// ---- run each case through the given module and record its byte-relevant outputs -----------------

function runTrimCase(mod, name) {
  const { contextFiles, diff } = name === "addition" ? additionFixture() : deletionOnlyFixture();
  const { contextFiles: out, report } = mod.trimContextFiles({ contextFiles, diff, thresholdBytes: 1000 });
  return {
    diff,
    inputPaths: contextFiles.map((f) => f.path),
    contextFiles: out,
    trimmed: report.trimmed,
    bytesBefore: report.bytesBefore,
    bytesAfter: report.bytesAfter,
  };
}

function runTightenCase(mod) {
  const { contextFiles, diff } = tightenUnifiedFixture();
  // A target well below the untrimmed size AND below what the loosest rung reaches, so the ladder has
  // to descend more than one rung before it fits — the case the monotonicity/minimum-tracking guarantee
  // actually exercises, not the trivial first-rung-fits case.
  const targetBytes = 15000;
  const r = mod.tightenToTarget({ contextFiles, diff, targetBytes });
  return {
    diff,
    inputPaths: contextFiles.map((f) => f.path),
    contextFiles: r.contextFiles,
    prefix: r.prefix,
    bytes: r.bytes,
    contextBytes: r.contextBytes,
    window: r.window,
    fitted: r.fitted,
  };
}

async function main(argv) {
  const modulePath = argv[2];
  if (!modulePath) {
    // A no-op, not an error — see the file-header note on why this can't exit non-zero.
    process.stderr.write("usage: node regenerate.mjs <path-to-review-call.mjs> [<source-commit-sha>]\n");
    return 0;
  }
  // Optional provenance stamp (adversarial review, FAFF-1051): the pre-change-module claim these goldens
  // exist to check is otherwise untestable from the diff alone — a reviewer can't tell whether a golden
  // was really generated from the merge-base module or from the post-change one (a self-fulfilling
  // "byte-identical" test). This script stays git-free (deterministic, dependency-free per the file
  // header), so the caller passes the commit sha it read the module from; the companion test asserts it
  // names a real ancestor of HEAD via `git merge-base --is-ancestor`.
  const generatedFrom = argv[3] || null;
  const mod = await import(pathToFileURL(resolve(modulePath)).href);
  const goldens = {
    "unified-addition": { generated_from: generatedFrom, ...runTrimCase(mod, "addition") },
    "unified-deletion-only": { generated_from: generatedFrom, ...runTrimCase(mod, "deletionOnly") },
    "tighten-unified": { generated_from: generatedFrom, ...runTightenCase(mod) },
  };
  for (const [name, golden] of Object.entries(goldens)) {
    writeFileSync(join(__dirname, `${name}.json`), JSON.stringify(golden, null, 2) + "\n");
    process.stdout.write(`wrote ${name}.json\n`);
  }
  return 0;
}

// Run as CLI only when invoked directly (not when imported by `node --test`'s recursive discovery) —
// mirrors build-lens-requests.mjs / parse-refutation.mjs: canonicalise argv[1] through realpathSync so
// a symlinked install path matches.
export function entrypoint_href(argv1) {
  if (!argv1) return null;
  try {
    return pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return pathToFileURL(argv1).href;
  }
}

if (import.meta.url === entrypoint_href(process.argv[1])) {
  main(process.argv).then((code) => process.exit(code));
}
