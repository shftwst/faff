// FAFF-1051 — declare the diff kind so the context trim stops truncating prose inputs.
//
// The anchored trim (FAFF-915) only means anything when --diff is a real unified diff. Three callers
// pass a markdown document instead (spec-review's lenses, faff-prep's spec-judge), and the anchored
// path answers by keeping the first 12 lines of every file above 2KB — truncation, not relevance. This
// suite pins: (1) the unified path is byte-identical to the pre-change function (the committed
// trim-baseline goldens); (2) the new prose path's budget-driven head retention; (3) the CLI surface
// (--diff-kind, --context-prose-ceiling-bytes) and its notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  trimContextFiles, tightenToTarget, headReduceBundle, headFit, parseDiffTouched, elisionMarker,
  assembleUserMessage, parseArgs, main, EXIT,
  TRIM_HEAD_LADDER, TRIM_WINDOW_LADDER, DEFAULT_PROSE_HEAD_FLOOR, DEFAULT_PROSE_CEILING_BYTES,
  PROSE_BRIEF_RESERVE_BYTES, DEFAULT_TRIM_HEAD_LINES, DEFAULT_MIN_FILE_TRIM_BYTES,
  DEFAULT_BRIEF_RESERVE_TOKENS, DEFAULT_BYTES_PER_TOKEN,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(__dirname, "fixtures", "trim-baseline");
const readGolden = (name) => JSON.parse(readFileSync(join(BASELINE_DIR, name), "utf8"));

async function runMain(argv, runReviewFn) {
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  let out = "", err = "";
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  let code;
  try { code = await main(argv, { runReviewFn }); }
  finally { process.stdout.write = outW; process.stderr.write = errW; }
  return { code, out, err };
}

// ============================================================================================
// Golden reproduction — the unified path is byte-identical to the pre-change function.
// ============================================================================================

test("FAFF-1051 golden: trimContextFiles on a real addition diff reproduces the committed baseline", () => {
  const g = readGolden("unified-addition.json");
  const contextFiles = g.inputPaths.map((p, i) => ({ path: p, text: undefined })); // placeholder, rebuilt below
  // Rebuild the exact fixture inline (kept in sync with regenerate.mjs's additionFixture) rather than
  // re-deriving it from the golden's own (already-trimmed) contextFiles.
  const touched = Array.from({ length: 400 }, (_, i) => `touched ${i + 1}`).join("\n");
  const unrelatedBig = Array.from({ length: 400 }, (_, i) => `unrelated ${String(i + 1).padStart(3, "0")}`).join("\n");
  const unrelatedSmall = "small file\nunder the per-file floor\n";
  const input = [
    { path: "touched.js", text: touched },
    { path: "unrelated_big.js", text: unrelatedBig },
    { path: "unrelated_small.js", text: unrelatedSmall },
  ];
  const { contextFiles: out, report } = trimContextFiles({ contextFiles: input, diff: g.diff, thresholdBytes: 1000 });
  assert.deepEqual(out, g.contextFiles, "unified addition-diff output must reproduce the pre-change golden byte for byte");
  assert.equal(report.trimmed, g.trimmed);
  assert.equal(report.bytesBefore, g.bytesBefore);
  assert.equal(report.bytesAfter, g.bytesAfter);
});

test("FAFF-1051 golden: trimContextFiles on a deletion-only diff reproduces the committed baseline", () => {
  const g = readGolden("unified-deletion-only.json");
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
  const input = [
    { path: "helpers.js", text: bodyLines.join("\n") },
    { path: "unrelated_small.js", text: "small file\nunder the per-file floor\n" },
  ];
  const { contextFiles: out, report } = trimContextFiles({ contextFiles: input, diff: g.diff, thresholdBytes: 1000 });
  assert.deepEqual(out, g.contextFiles, "unified deletion-only diff output must reproduce the pre-change golden byte for byte");
  assert.equal(report.bytesAfter, g.bytesAfter);
  // this is the case the anchor-yield-gate direction (rejected in the spec's §6) would have broken:
  // a deletion-only diff still anchors through its removed lines' identifiers.
  const helpers = out.find((f) => f.path === "helpers.js").text;
  assert.ok(helpers.includes("deadHelperXyz"), "the removed-line identifier still anchors its definition");
  assert.ok(helpers.includes("legacyThingAbc"), "both removed-line identifiers anchor, not just one");
});

test("FAFF-1051 golden: tightenToTarget on a unified bundle reproduces the committed baseline", () => {
  const g = readGolden("tighten-unified.json");
  const lines = 6000, anchors = 40;
  const body = [];
  for (let i = 0; i < lines; i++) body.push(`const fn${i} = ${i}; // ${"p".repeat(24)}`);
  const step = Math.floor(lines / anchors);
  const hunks = ["--- a/dense.js", "+++ b/dense.js"];
  for (let k = 0; k < anchors; k++) {
    const ln = k * step;
    hunks.push(`@@ -${ln + 1},1 +${ln + 1},2 @@`, `+  use(fn${ln});`);
  }
  const contextFiles = [{ path: "dense.js", text: body.join("\n") }];
  const r = tightenToTarget({ contextFiles, diff: hunks.join("\n") + "\n", targetBytes: 15000 });
  assert.deepEqual(r.contextFiles, g.contextFiles, "reproduces the pre-change golden's contextFiles");
  assert.equal(r.prefix, g.prefix, "reproduces the pre-change golden's assembled prefix byte for byte");
  assert.equal(r.bytes, g.bytes);
  assert.equal(r.contextBytes, g.contextBytes);
  assert.equal(r.window, g.window);
  assert.equal(r.fitted, g.fitted);
  // additive fields only — the anchored regime is unchanged
  assert.equal(r.mode, "anchored");
  assert.equal(r.headLines, DEFAULT_TRIM_HEAD_LINES, "the anchored regime never tightens headLines onto a rung");
});

test("FAFF-1051 golden provenance: each golden's generated_from names a real ancestor commit of HEAD", () => {
  // Adversarial-review finding (FAFF-1051): "byte-identical to the pre-change function" is otherwise
  // unverifiable from the diff alone — a reviewer can't tell a golden generated from the merge-base
  // module apart from one generated from the post-change module (a self-fulfilling pass). This makes
  // the provenance claim mechanically checkable rather than a matter of trust.
  for (const name of ["unified-addition.json", "unified-deletion-only.json", "tighten-unified.json"]) {
    const g = readGolden(name);
    assert.ok(g.generated_from && /^[0-9a-f]{7,40}$/.test(g.generated_from), `${name}: generated_from must be a commit sha`);
    // Throws (non-zero exit) if the named sha is not an ancestor of HEAD — assert.doesNotThrow makes the
    // failure mode explicit rather than an uncaught child_process error.
    assert.doesNotThrow(
      () => execFileSync("git", ["merge-base", "--is-ancestor", g.generated_from, "HEAD"], { cwd: join(__dirname, "..") }),
      `${name}: generated_from (${g.generated_from}) must be an ancestor of HEAD`,
    );
  }
});

// ============================================================================================
// parseDiffTouched.hunks — additive, zero for prose, correct for real diffs.
// ============================================================================================

test("FAFF-1051: parseDiffTouched.hunks counts hunk headers — 0 for markdown, 1 for a single-hunk diff", () => {
  const prose = "# A spec\n\nNo diff hunks here, just prose about `@@` being special in diffs.";
  assert.equal(parseDiffTouched(prose).hunks, 0);
  const realDiff = ["--- a/x.js", "+++ b/x.js", "@@ -1,1 +1,2 @@", " keep", "+added"].join("\n");
  assert.equal(parseDiffTouched(realDiff).hunks, 1);
  const twoHunks = ["+++ b/x.js", "@@ -1,1 +1,2 @@", " keep", "+added", "@@ -10,1 +11,2 @@", " keep2", "+added2"].join("\n");
  assert.equal(parseDiffTouched(twoHunks).hunks, 2);
});

// ============================================================================================
// headReduceBundle / headFit — pure prose-path building blocks.
// ============================================================================================

test("FAFF-1051: headReduceBundle leaves a small file untouched and head-reduces a longer one with exactly one marker", () => {
  const small = "line1\nline2\n";
  const big = Array.from({ length: 500 }, (_, i) => `row ${i}`).join("\n");
  const out = headReduceBundle(
    [{ path: "small.md", text: small }, { path: "big.md", text: big }],
    100,
    { minFileBytes: DEFAULT_MIN_FILE_TRIM_BYTES },
  );
  assert.equal(out.find((f) => f.path === "small.md").text, small, "below minFileBytes → untouched, no marker");
  const bigOut = out.find((f) => f.path === "big.md").text.split("\n");
  assert.equal(bigOut.length, 101, "100 head lines + exactly one elision marker");
  assert.equal(bigOut[100], elisionMarker(400));
});

test("FAFF-1051: headFit returns the first ladder rung that fits the budget", () => {
  const contextFiles = [{ path: "a.md", text: Array.from({ length: 2000 }, (_, i) => `line ${i} filler text here`).join("\n") }];
  const bytesOf = (s) => Buffer.byteLength(s, "utf8");
  const full = bytesOf(contextFiles[0].text);
  const fit = headFit({ contextFiles, budgetBytes: Math.floor(full * 0.5), opts: { minFileBytes: DEFAULT_MIN_FILE_TRIM_BYTES } });
  assert.equal(fit.fitted, true);
  assert.ok(TRIM_HEAD_LADDER.includes(fit.headLines));
  assert.ok(fit.bytes <= Math.floor(full * 0.5));
});

test("FAFF-1051: headFit adopts the floor rung outright when no rung fits, never a tracked minimum", () => {
  const contextFiles = [{ path: "a.md", text: Array.from({ length: 5000 }, (_, i) => `line ${i} filler text here`).join("\n") }];
  const fit = headFit({ contextFiles, budgetBytes: 1, opts: { minFileBytes: DEFAULT_MIN_FILE_TRIM_BYTES } });
  assert.equal(fit.fitted, false);
  assert.equal(fit.headLines, DEFAULT_PROSE_HEAD_FLOOR, "adopts the floor rung by name");
});

// ============================================================================================
// trimContextFiles — the prose kind's new reasons.
// ============================================================================================

function proseBundle(totalBytes) {
  // One file, sized so bytesBefore lands close to totalBytes.
  const lineLen = 30;
  const lines = Math.ceil(totalBytes / lineLen);
  return [{ path: "spec.md", text: Array.from({ length: lines }, (_, i) => `spec line ${i} padding`).join("\n") }];
}

test("FAFF-1051: prose kind under the context budget is a byte-identical no-op (reason no-relevance-model)", () => {
  const contextFiles = proseBundle(1000);
  const diff = "# a spec\nno hunks here";
  const { contextFiles: out, report } = trimContextFiles({ contextFiles, diff, thresholdBytes: 100, diffKind: "prose" });
  assert.equal(report.reason, "no-relevance-model");
  assert.equal(report.trimmed, false);
  assert.equal(report.kind, "prose");
  assert.equal(report.hunks, 0);
  assert.equal(out, contextFiles, "identity — the exact input array is returned");
  assert.equal(report.bytesAfter, report.bytesBefore);
  assert.equal(report.headLines, null);
  assert.equal(report.contextBudgetBytes, DEFAULT_PROSE_CEILING_BYTES - Buffer.byteLength(diff, "utf8") - PROSE_BRIEF_RESERVE_BYTES);
});

test("FAFF-1051: prose kind above the budget with a fitting rung returns reason head-fit", () => {
  const contextFiles = proseBundle(50000);
  const diff = "# a spec\nno hunks here";
  const proseCeilingBytes = 20000;   // small ceiling forces the head-fit path with a small fixture
  const { report } = trimContextFiles({ contextFiles, diff, thresholdBytes: 100, diffKind: "prose", proseCeilingBytes });
  assert.equal(report.reason, "head-fit");
  assert.equal(report.trimmed, true);
  assert.ok(TRIM_HEAD_LADDER.includes(report.headLines));
  assert.ok(report.bytesAfter <= report.contextBudgetBytes, "bytesAfter must be at or below the context budget");
});

test("FAFF-1051: prose kind that no rung fits returns reason head-fit-floored, never below the floor", () => {
  const contextFiles = proseBundle(500000);
  const diff = "# a spec\nno hunks here";
  const proseCeilingBytes = 1000;   // an impossibly tight ceiling — no rung can fit
  const { contextFiles: out, report } = trimContextFiles({ contextFiles, diff, thresholdBytes: 100, diffKind: "prose", proseCeilingBytes });
  assert.equal(report.reason, "head-fit-floored");
  assert.equal(report.headLines, DEFAULT_PROSE_HEAD_FLOOR);
  const lineCount = out[0].text.split("\n").length;
  assert.ok(lineCount <= DEFAULT_PROSE_HEAD_FLOOR + 1, "no file reduced below the floor (+1 for the marker)");
});

test("FAFF-1051: a --diff document alone larger than the prose ceiling yields a non-positive budget and floors, never throws", () => {
  // A context file large enough to be ABOVE minFileBytes (so head reduction genuinely shrinks it,
  // reaching head-fit-floored) yet small next to the oversized diff.
  const contextFiles = proseBundle(10000);
  const diff = "x".repeat(700000);   // bigger than DEFAULT_PROSE_CEILING_BYTES on its own
  const { report } = trimContextFiles({ contextFiles, diff, thresholdBytes: 100, diffKind: "prose" });
  assert.ok(report.contextBudgetBytes < 0, "the diff alone exceeds the ceiling — non-positive budget");
  assert.equal(report.reason, "head-fit-floored");
});

test("FAFF-1051: prose kind whose files are all below minFileBytes declines rather than reporting a false trim", () => {
  const contextFiles = [{ path: "tiny.md", text: "x".repeat(100) }];
  const diff = "# spec\n" + "y".repeat(600000);   // huge diff drives the budget deep negative
  const { contextFiles: out, report } = trimContextFiles({ contextFiles, diff, thresholdBytes: 1, diffKind: "prose" });
  // the single tiny file is below minFileBytes on every rung, so no rung beats bytesBefore
  assert.equal(report.reason, "head-fit-declined");
  assert.equal(report.trimmed, false);
  assert.equal(out, contextFiles, "identity — untrimmed context kept");
});

test("FAFF-1051: --context-trim-bytes 0 disables the trim under BOTH kinds, including a prose bundle over the ceiling", () => {
  const contextFiles = proseBundle(700000);
  const diff = "# spec\nno hunks";
  const unified = trimContextFiles({ contextFiles, diff, thresholdBytes: 0 });
  assert.equal(unified.report.reason, "disabled");
  assert.equal(unified.report.contextBudgetBytes, null, "unified kind never carries a context budget");
  const prose = trimContextFiles({ contextFiles, diff, thresholdBytes: 0, diffKind: "prose" });
  assert.equal(prose.report.reason, "disabled");
  assert.equal(prose.contextFiles, contextFiles, "disabled wins even far over the ceiling");
  assert.equal(
    prose.report.contextBudgetBytes,
    DEFAULT_PROSE_CEILING_BYTES - Buffer.byteLength(diff, "utf8") - PROSE_BRIEF_RESERVE_BYTES,
    "prose kind still carries a context budget even on the disabled short-circuit",
  );
});

test("FAFF-1051: trimmed is true iff reason is trimmed, head-fit, or head-fit-floored — no other meaning", () => {
  const cases = [
    { thresholdBytes: 10_000_000, diffKind: "unified", wantReason: "under-threshold", wantTrimmed: false },
    { thresholdBytes: 0, diffKind: "unified", wantReason: "disabled", wantTrimmed: false },
  ];
  for (const c of cases) {
    const { report } = trimContextFiles({ contextFiles: [{ path: "a.js", text: "x".repeat(100) }], diff: "d", thresholdBytes: c.thresholdBytes, diffKind: c.diffKind });
    assert.equal(report.reason, c.wantReason);
    assert.equal(report.trimmed, c.wantTrimmed);
  }
});

test("FAFF-1051: headLines is non-null iff reason is head-fit or head-fit-floored", () => {
  const proseNoop = trimContextFiles({ contextFiles: proseBundle(100), diff: "d", thresholdBytes: 1, diffKind: "prose" });
  assert.equal(proseNoop.report.headLines, null, "no-relevance-model carries no headLines");
  const unifiedTrimmed = trimContextFiles({
    contextFiles: [
      { path: "touched.js", text: Array.from({ length: 400 }, (_, i) => `touched ${i + 1}`).join("\n") },
      { path: "big.js", text: Array.from({ length: 400 }, (_, i) => `unrelated ${i}`).join("\n") },
    ],
    diff: "--- a/touched.js\n+++ b/touched.js\n@@ -200,1 +200,2 @@\n keep\n+added",
    thresholdBytes: 100,
  });
  assert.equal(unifiedTrimmed.report.reason, "trimmed");
  assert.equal(unifiedTrimmed.report.headLines, null, "the unified 'trimmed' reason also carries no headLines");
});

// ============================================================================================
// tightenToTarget — the prose kind's head-only regime.
// ============================================================================================

test("FAFF-1051: tightenToTarget under diffKind prose runs mode head-only with a null window", () => {
  const contextFiles = [{ path: "spec.md", text: Array.from({ length: 3000 }, (_, i) => `spec line ${i} filler text`).join("\n") }];
  const diff = "# a prose diff\nno hunks";
  const untrimmed = Buffer.byteLength(assembleUserMessage({ contextFiles, diff }), "utf8");
  const r = tightenToTarget({ contextFiles, diff, targetBytes: Math.floor(untrimmed * 0.2), diffKind: "prose" });
  assert.equal(r.mode, "head-only");
  assert.equal(r.window, null, "no anchor window was applied in this regime — reporting one would be a lie");
  assert.ok(TRIM_HEAD_LADDER.includes(r.headLines));
  assert.ok(r.bytes < untrimmed, "a prefix strictly smaller than the untrimmed assembly for a target below it");
});

test("FAFF-1051: tightenToTarget under diffKind prose with an unreachable target returns fitted:false at the floor, never throws", () => {
  const contextFiles = [{ path: "spec.md", text: Array.from({ length: 3000 }, (_, i) => `spec line ${i} filler text`).join("\n") }];
  const diff = "# a prose diff\nno hunks";
  const r = tightenToTarget({ contextFiles, diff, targetBytes: 1, diffKind: "prose" });
  assert.equal(r.fitted, false);
  assert.equal(r.headLines, DEFAULT_PROSE_HEAD_FLOOR, "never a head below the floor");
  assert.equal(r.mode, "head-only");
});

// ============================================================================================
// TRIM_HEAD_LADDER — shape invariants asserted directly.
// ============================================================================================

test("FAFF-1051: TRIM_HEAD_LADDER is frozen, strictly descending, matches TRIM_WINDOW_LADDER's length, and ends at the floor", () => {
  assert.ok(Object.isFrozen(TRIM_HEAD_LADDER));
  assert.equal(TRIM_HEAD_LADDER.length, TRIM_WINDOW_LADDER.length);
  for (let i = 1; i < TRIM_HEAD_LADDER.length; i++) {
    assert.ok(TRIM_HEAD_LADDER[i] < TRIM_HEAD_LADDER[i - 1], "strictly descending");
  }
  assert.equal(TRIM_HEAD_LADDER[TRIM_HEAD_LADDER.length - 1], DEFAULT_PROSE_HEAD_FLOOR);
  assert.ok(DEFAULT_PROSE_HEAD_FLOOR > DEFAULT_TRIM_HEAD_LINES, "the prose ladder never reaches the 12-line unified truncation");
});

test("FAFF-1051: DEFAULT_PROSE_CEILING_BYTES and PROSE_BRIEF_RESERVE_BYTES are the documented constants", () => {
  assert.equal(DEFAULT_PROSE_CEILING_BYTES, 589824);
  assert.equal(PROSE_BRIEF_RESERVE_BYTES, Math.round(DEFAULT_BRIEF_RESERVE_TOKENS * DEFAULT_BYTES_PER_TOKEN));
});

// ============================================================================================
// trimOneFile call-site count — a decidable source scan, not a judgement about what a loop is for.
// ============================================================================================

test("FAFF-1051: trimOneFile is invoked from exactly two call sites in review-call.mjs", () => {
  const src = readFileSync(join(__dirname, "..", "plugin", "skills", "faffter-dark-adversarial-review", "review-call.mjs"), "utf8");
  const matches = src.match(/trimOneFile\(/g) || [];
  // one declaration site ("export function trimOneFile(") + exactly two call sites (trimContextFiles'
  // unified branch, headReduceBundle) = 3 total occurrences of the substring "trimOneFile(".
  assert.equal(matches.length, 3, "declaration + exactly two call sites");
});

// ============================================================================================
// CLI surface — parseArgs, main()'s validation, and the operator-facing notes.
// ============================================================================================

test("FAFF-1051: parseArgs collects --diff-kind and --context-prose-ceiling-bytes", () => {
  const a = parseArgs(["--diff-kind", "prose", "--context-prose-ceiling-bytes", "12345"]);
  assert.equal(a.diffKind, "prose");
  assert.equal(a.proseCeilingBytes, 12345);
  const b = parseArgs([]);
  assert.equal(b.diffKind, undefined, "absent → undefined → main() applies the unified default");
});

test("FAFF-1051: main() rejects an unrecognised --diff-kind with EXIT.USAGE, never a throw", async () => {
  const d = mkdtempSync(join(tmpdir(), "faff1051-"));
  const sys = join(d, "s.md"), diff = join(d, "d.diff");
  writeFileSync(sys, "brief");
  writeFileSync(diff, "some diff text");
  const r = await runMain(["--host", "h", "--model", "m", "--system", sys, "--diff", diff, "--diff-kind", "bogus"], async () => ({ status: "ok", content: "### observation: none" }));
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.err, /--diff-kind/);
});

test("FAFF-1051: main() with --diff-kind prose and an under-budget context writes the intact note, not the FAFF-915 note", async () => {
  const d = mkdtempSync(join(tmpdir(), "faff1051-"));
  const sys = join(d, "s.md"), diff = join(d, "d.diff"), ctx = join(d, "spec.md");
  writeFileSync(sys, "brief");
  writeFileSync(diff, "# a spec\nno hunks here, just prose");
  writeFileSync(ctx, "small context file, well under any threshold");
  const r = await runMain(
    ["--host", "h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctx, "--diff-kind", "prose", "--context-trim-bytes", "1"],
    async () => ({ status: "ok", content: "### observation: none" }),
  );
  assert.equal(r.code, EXIT.OK);
  assert.match(r.err, /FAFF-1051 --diff-kind prose: no diff-relevance model applies/);
  assert.ok(!r.err.includes("FAFF-915 context trim"), "the unified-path note must not fire under the prose kind");
});

test("FAFF-1051: main() with --diff-kind prose and a tight --context-prose-ceiling-bytes writes the head-fit note", async () => {
  const d = mkdtempSync(join(tmpdir(), "faff1051-"));
  const sys = join(d, "s.md"), diff = join(d, "d.diff"), ctx = join(d, "spec.md");
  writeFileSync(sys, "brief");
  writeFileSync(diff, "# a spec\nno hunks here");
  writeFileSync(ctx, Array.from({ length: 3000 }, (_, i) => `spec context line ${i} with some padding text`).join("\n"));
  const r = await runMain(
    ["--host", "h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctx, "--diff-kind", "prose",
      "--context-trim-bytes", "1", "--context-prose-ceiling-bytes", "20000"],
    async () => ({ status: "ok", content: "### observation: none" }),
  );
  assert.equal(r.code, EXIT.OK);
  assert.match(r.err, /FAFF-1051 --diff-kind prose: \d+ → \d+ context bytes, head-reduced to at most \d+ lines/);
});

test("FAFF-1051: main() with a zero-hunk --diff and no --diff-kind writes both the FAFF-915 note and the zero-hunk advisory", async () => {
  const d = mkdtempSync(join(tmpdir(), "faff1051-"));
  const sys = join(d, "s.md"), diff = join(d, "d.diff"), ctx = join(d, "big.js");
  writeFileSync(sys, "brief");
  writeFileSync(diff, "not actually a diff, no hunks at all");
  writeFileSync(ctx, Array.from({ length: 2000 }, (_, i) => `const x${i} = ${i};`).join("\n"));
  const r = await runMain(
    ["--host", "h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctx, "--context-trim-bytes", "1"],
    async () => ({ status: "ok", content: "### observation: none" }),
  );
  assert.equal(r.code, EXIT.OK);
  assert.match(r.err, /FAFF-915 context trim/);
  assert.match(r.err, /FAFF-1051 the --diff parsed as 0 unified-diff hunks/);
});

test("FAFF-1051: main() with a real unified diff and no --diff-kind writes only the FAFF-915 note, unchanged", async () => {
  const d = mkdtempSync(join(tmpdir(), "faff1051-"));
  const sys = join(d, "s.md"), diff = join(d, "d.diff"), ctx = join(d, "big.js");
  writeFileSync(sys, "brief");
  const body = Array.from({ length: 2000 }, (_, i) => `const x${i} = ${i};`).join("\n");
  writeFileSync(ctx, body);
  writeFileSync(diff, "--- a/big.js\n+++ b/big.js\n@@ -10,1 +10,2 @@\n keep\n+const added = 1;\n");
  const r = await runMain(
    ["--host", "h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctx, "--context-trim-bytes", "1"],
    async () => ({ status: "ok", content: "### observation: none" }),
  );
  assert.equal(r.code, EXIT.OK);
  assert.match(r.err, /FAFF-915 context trim/);
  assert.ok(!r.err.includes("FAFF-1051"), "a real unified diff never gets the zero-hunk advisory");
});

// ============================================================================================
// Integration smoke test — from the spec's own procedure.
// ============================================================================================

test("FAFF-1051 smoke: --diff-kind prose under the ceiling supplies both context files intact, no elision", async () => {
  const d = mkdtempSync(join(tmpdir(), "faff1051-smoke-"));
  const sys = join(d, "s.md"), diff = join(d, "d.md"), ctxA = join(d, "a.md"), ctxB = join(d, "b.md");
  writeFileSync(sys, "brief");
  writeFileSync(diff, "# A markdown spec\nNo \"@@\" lines here.");
  const fileA = Array.from({ length: 1200 }, (_, i) => `alpha context line ${i}`).join("\n") + "\nLAST LINE OF A\n";
  const fileB = Array.from({ length: 1200 }, (_, i) => `beta context line ${i}`).join("\n") + "\nLAST LINE OF B\n";
  writeFileSync(ctxA, fileA);
  writeFileSync(ctxB, fileB);
  let capturedPrefix = null;
  const r = await runMain(
    ["--host", "h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctxA, "--context", ctxB, "--diff-kind", "prose"],
    // FAFF-903 swaps the wire roles so the cacheable context/diff block is the "system" field and the
    // per-lens brief is "user" — captured.system is where the assembled prefix actually lands.
    async ({ system: capturedSystem }) => { capturedPrefix = capturedSystem; return { status: "ok", content: "### observation: none" }; },
  );
  assert.equal(r.code, EXIT.OK);
  assert.ok(capturedPrefix.includes("LAST LINE OF A"), "file A supplied intact");
  assert.ok(capturedPrefix.includes("LAST LINE OF B"), "file B supplied intact");
  assert.ok(!capturedPrefix.includes("elided"), "nothing was elided under the ceiling");
  assert.match(r.err, /FAFF-1051 --diff-kind prose: no diff-relevance model applies/);
  assert.ok(!r.err.includes("FAFF-915 context trim"));
});

// ============================================================================================
// Purity — the trimmed context stays a pure function of (contextFiles, diff, kind, options).
// ============================================================================================

test("FAFF-1051: trimContextFiles is pure under the prose kind too — identical inputs, identical output", () => {
  const contextFiles = proseBundle(60000);
  const diff = "# a spec\nno hunks";
  const a = trimContextFiles({ contextFiles, diff, thresholdBytes: 1, diffKind: "prose", proseCeilingBytes: 20000 });
  const b = trimContextFiles({ contextFiles, diff, thresholdBytes: 1, diffKind: "prose", proseCeilingBytes: 20000 });
  assert.deepEqual(a.contextFiles, b.contextFiles);
  assert.deepEqual(a.report, b.report);
});
