// FAFF-1051 — declare the diff kind so the context trim stops truncating prose inputs.
//
// The anchored trim (FAFF-915) only means anything when --diff is a real unified diff. Three callers
// pass a markdown document instead (spec-review's lenses, faff-prep's spec-judge), and the anchored
// path answers by keeping the first 12 lines of every file above 2KB — truncation, not relevance. This
// suite pins: (1) the unified path is byte-identical to the pre-change function (the committed
// trim-baseline goldens); (2) the CLI surface (--diff-kind) and its unified-path notes.
//
// FAFF-1058 made the "prose" kind a true pass-through, removing the head-fit/ceiling machinery this file
// once tested (headReduceBundle, headFit, TRIM_HEAD_LADDER, the prose constants); those blocks are gone;
// the prose behaviour is now covered by test/faff-1058-controllable-trimming.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  trimContextFiles, tightenToTarget, parseDiffTouched,
  parseArgs, main, EXIT, DEFAULT_TRIM_HEAD_LINES,
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

test("FAFF-1051/FAFF-1065 golden provenance: each golden's generated_from names a real ancestor commit of HEAD", () => {
  // Adversarial-review finding (FAFF-1051): "byte-identical to the pre-change function" is otherwise
  // unverifiable from the diff alone — a reviewer can't tell a golden generated from the merge-base
  // module apart from one generated from the post-change module (a self-fulfilling pass). This makes
  // the provenance claim mechanically checkable rather than a matter of trust. FAFF-1065 extends the
  // same check to the FAFF-1058 default-code-review-payload golden, closing the same gap there.
  //
  // CI's default actions/checkout is a SHALLOW clone (fetch-depth 1, no `fetch-depth: 0` anywhere in
  // validate.yml), so the merge-base commit object this repo's own history genuinely contains is simply
  // absent locally there — `git merge-base --is-ancestor` fails "Not a valid commit name" for a reason
  // that has nothing to do with whether the claim is true. Check the object's local presence first
  // (`git cat-file -e`) and only assert ancestry when it resolves; a shallow environment still gets the
  // shape check below, just not the stronger ancestry proof a full checkout (this sandbox, a developer
  // machine) can make.
  const repoRoot = join(__dirname, "..");
  const hasLocalObject = (sha) => {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  };
  for (const name of ["unified-addition.json", "unified-deletion-only.json", "tighten-unified.json", "default-code-review-payload.json"]) {
    const g = readGolden(name);
    assert.ok(g.generated_from && /^[0-9a-f]{7,40}$/.test(g.generated_from), `${name}: generated_from must be a commit sha`);
    if (!hasLocalObject(g.generated_from)) continue;   // shallow clone — cannot prove ancestry here
    // Throws (non-zero exit) if the named sha is not an ancestor of HEAD — assert.doesNotThrow makes the
    // failure mode explicit rather than an uncaught child_process error.
    assert.doesNotThrow(
      () => execFileSync("git", ["merge-base", "--is-ancestor", g.generated_from, "HEAD"], { cwd: repoRoot }),
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
// trimContextFiles: reason/flag semantics on the surviving unified + disabled paths.
// ============================================================================================

test("FAFF-1051: trimmed is true only for the unified 'trimmed' reason, never for disabled/under-threshold", () => {
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

// ============================================================================================
// trimOneFile call-site count — a decidable source scan, not a judgement about what a loop is for.
// ============================================================================================

test("FAFF-1051/FAFF-1058: trimOneFile is invoked from exactly one call site in review-call.mjs", () => {
  const src = readFileSync(join(__dirname, "..", "plugin", "skills", "faffter-dark-adversarial-review", "review-call.mjs"), "utf8");
  const matches = src.match(/trimOneFile\(/g) || [];
  // one declaration site ("export function trimOneFile(") + exactly one call site (trimContextFiles'
  // unified branch) = 2 total occurrences. FAFF-1058 removed the headReduceBundle call site with the
  // prose head-fit machinery.
  assert.equal(matches.length, 2, "declaration + exactly one call site");
});

// ============================================================================================
// CLI surface — parseArgs, main()'s validation, and the operator-facing notes.
// ============================================================================================

test("FAFF-1051: parseArgs collects --diff-kind", () => {
  const a = parseArgs(["--diff-kind", "prose"]);
  assert.equal(a.diffKind, "prose");
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
