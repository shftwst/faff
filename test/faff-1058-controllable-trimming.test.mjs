// FAFF-1058, controllable adversarial-review trimming: prose never trims, code_review trim is a toggle.
//
// Two edits in review-call.mjs (both trim passes) plus one read in the SKILL.md code-review dispatch:
//   D1  prose is a true pass-through, trimContextFiles returns the input unchanged (reason
//       "prose-passthrough") and main() skips the FAFF-1039 window pass for prose.
//   D2  --no-trim drives pass 1 to its disabled short-circuit AND skips the FAFF-1039 window pass.
//   D3  the prose head-fit/ceiling machinery is removed (covered by the faff-1051 surgery, not here).
//
// The over-window scenarios exercise the EXISTING FAFF-1039 per-backend guard (unchanged by this ticket):
// with trimming off, an over-window payload is skipped to a wider fallback, or the chain fails closed at
// exit 2 (needs-human) when none fits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  trimContextFiles, assembleUserMessage, estimateTokens, main, EXIT,
  PRIMARY_SKIP_SIGNAL, DEFAULT_WINDOW_SAFETY,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";
import { captureDefaultCodeReviewPayload } from "./fixtures/trim-baseline/default-code-review-fixture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(__dirname, "fixtures", "trim-baseline");

// Run main() capturing the { system, user } of the served backend call and the captured stderr/stdout.
async function runCapture(argv, { content = "### observation: no findings" } = {}) {
  const d = mkdtempSync(join(tmpdir(), "faff1058-"));
  let captured = null, callCount = 0;
  const runReviewFn = async ({ system, user }) => {
    callCount += 1;
    if (captured === null) captured = { system, user };
    return { status: "ok", content };
  };
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  let out = "", err = "";
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  let code;
  try { code = await main(argv, { runReviewFn }); }
  finally { process.stdout.write = outW; process.stderr.write = errW; }
  return { code, out, err, captured, callCount, dir: d };
}

// Write a backends.json chain and return its path.
function writeBackends(dir, backends) {
  const p = join(dir, "backends.json");
  writeFileSync(p, JSON.stringify(backends));
  return p;
}

// A large dense context (~135 KB, > the 48 KB pass-1 gate) plus a real anchored unified diff.
function largeUnifiedFixture() {
  const body = [];
  for (let i = 0; i < 3000; i++) body.push(`const fn${i} = ${i}; // ${"p".repeat(24)}`);
  const contextText = body.join("\n");
  const hunks = ["--- a/dense.js", "+++ b/dense.js"];
  for (const ln of [100, 900, 1700, 2500]) hunks.push(`@@ -${ln + 1},1 +${ln + 1},2 @@`, `+  use(fn${ln});`);
  return { contextText, diff: hunks.join("\n") + "\n" };
}

// ============================================================================================
// D2, --no-trim disables BOTH passes.
// ============================================================================================

test("FAFF-1058: --no-trim elides no bytes, pass 1 (FAFF-915) and pass 2 (FAFF-1039) are both no-ops", async () => {
  const { contextText, diff } = largeUnifiedFixture();
  const d = mkdtempSync(join(tmpdir(), "faff1058-notrim-"));
  const sys = join(d, "lens.md"), diffFile = join(d, "code.diff"), ctx = join(d, "dense.js");
  writeFileSync(sys, "## Review lens\n\nbrief");
  writeFileSync(diffFile, diff);
  writeFileSync(ctx, contextText);
  // Primary has a small window the untrimmed payload cannot fit; the fallback is unbounded and serves it.
  const backends = writeBackends(d, [
    { provider: "openai", model: "tiny", host: "http://p/v1", context_window: 5000 },
    { provider: "openai", model: "wide", host: "http://f/v1" },
  ]);
  const rawSystem = assembleUserMessage({ contextFiles: [{ path: ctx, text: contextText }], diff });

  // Baseline sanity: WITHOUT --no-trim the same fixture DOES trim (pass 1 fires), so the assertions below
  // are meaningful rather than vacuously true on an already-tiny payload.
  const withTrim = await runCapture(["--backends-json", backends, "--system", sys, "--diff", diffFile, "--context", ctx]);
  assert.equal(withTrim.code, EXIT.OK);
  assert.match(withTrim.err, /FAFF-915 context trim/, "pass 1 fires without --no-trim");
  assert.ok(withTrim.captured.system.length < rawSystem.length, "the served payload is smaller than the raw assembly");

  // WITH --no-trim: pass 1 disabled, pass 2 skipped. The primary is over-window (untrimmed) so the guard
  // advances to the unbounded fallback, which serves the payload byte-identical to the raw assembly.
  const noTrim = await runCapture(["--backends-json", backends, "--system", sys, "--diff", diffFile, "--context", ctx, "--no-trim"]);
  assert.equal(noTrim.code, EXIT.OK);
  assert.equal(noTrim.captured.system, rawSystem, "served payload is byte-identical to the untrimmed assembly");
  assert.ok(!noTrim.captured.system.includes("elided"), "no context bytes were elided");
  assert.ok(!noTrim.err.includes("FAFF-915 context trim"), "pass 1 did not fire");
  assert.ok(!noTrim.err.includes("FAFF-1039 window-targeted trim"), "pass 2 did not fire");
  assert.ok(noTrim.err.split("\n").includes(PRIMARY_SKIP_SIGNAL), "the over-window primary skip is surfaced");
});

// ============================================================================================
// D1, prose is a true pass-through at any size.
// ============================================================================================

test("FAFF-1058: trimContextFiles under diffKind prose is an identity no-op above the old 576 KB ceiling", () => {
  // A context bundle larger than the removed DEFAULT_PROSE_CEILING_BYTES (589824), the size that used to
  // trigger head-fit reduction. It must now pass through untouched.
  const big = Array.from({ length: 20000 }, (_, i) => `spec line ${i} with some padding text here`).join("\n");
  const contextFiles = [{ path: "spec.md", text: big }];
  assert.ok(Buffer.byteLength(big, "utf8") > 589824, "fixture exceeds the old prose ceiling");
  const { contextFiles: out, report } = trimContextFiles({ contextFiles, diff: "# a spec\nno hunks", diffKind: "prose" });
  assert.equal(report.reason, "prose-passthrough");
  assert.equal(report.trimmed, false);
  assert.equal(report.kind, "prose");
  assert.equal(out, contextFiles, "identity, the exact input array is returned");
  assert.equal(report.bytesAfter, report.bytesBefore);
});

test("FAFF-1058: a >576 KB prose payload is byte-identical through both passes, and the FAFF-1039 block is skipped", async () => {
  const big = Array.from({ length: 20000 }, (_, i) => `spec line ${i} with some padding text here`).join("\n");
  const d = mkdtempSync(join(tmpdir(), "faff1058-prose-"));
  const sys = join(d, "lens.md"), diffFile = join(d, "spec.md"), ctx = join(d, "context.md");
  writeFileSync(sys, "## Review lens\n\nbrief");
  writeFileSync(diffFile, "# A spec document\n\nNo @@ hunks here, just prose.");
  writeFileSync(ctx, big);
  const diffText = readFileSync(diffFile, "utf8");
  // Primary declares a window the payload exceeds; if the FAFF-1039 block ran for prose it would tighten
  // and emit the window note. It must be skipped, so the primary is over-window and the fallback serves.
  const backends = writeBackends(d, [
    { provider: "openai", model: "tiny", host: "http://p/v1", context_window: 5000 },
    { provider: "openai", model: "wide", host: "http://f/v1" },
  ]);
  const rawSystem = assembleUserMessage({ contextFiles: [{ path: ctx, text: big }], diff: diffText });

  const r = await runCapture(["--backends-json", backends, "--system", sys, "--diff", diffFile, "--context", ctx, "--diff-kind", "prose"]);
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.captured.system, rawSystem, "prose payload served byte-identical to the raw assembly");
  assert.ok(!r.captured.system.includes("elided"), "no elision under the prose kind at any size");
  assert.ok(!r.err.includes("FAFF-915 context trim"), "pass 1 did not fire");
  assert.ok(!r.err.includes("FAFF-1039 window-targeted trim"), "the FAFF-1039 window pass is skipped for prose");
});

// ============================================================================================
// Baseline oracle, the default unified code-review path's wire strings are identical to today.
// ============================================================================================

test("FAFF-1058: the default code-review payload matches the committed baseline byte-for-byte", async () => {
  // The oracle for "identical to today". The baseline was captured from the post-change unified path; the
  // unified trim is unchanged by FAFF-1058 (D3 removed only prose machinery), and its pre-change
  // equivalence is separately pinned by the faff-1051 unified goldens (stamped with the merge-base sha).
  const golden = JSON.parse(readFileSync(join(BASELINE_DIR, "default-code-review-payload.json"), "utf8"));
  const { exit, system, user } = await captureDefaultCodeReviewPayload();
  assert.equal(exit, EXIT.OK);
  assert.equal(system, golden.system, "the shared context+diff block equals the committed baseline");
  assert.equal(user, golden.user, "the review lens equals the committed baseline");
});

// ============================================================================================
// Over-window with trimming off, the honest skip (fallback serves) and fail-closed (exit 2) outcomes.
// ============================================================================================

test("FAFF-1058: --no-trim over-window skips the primary to a wider fallback with the exact stderr line", async () => {
  const { contextText, diff } = largeUnifiedFixture();
  const d = mkdtempSync(join(tmpdir(), "faff1058-ow-"));
  const sys = join(d, "lens.md"), diffFile = join(d, "code.diff"), ctx = join(d, "dense.js");
  const lensBrief = "## Review lens\n\nbrief";
  writeFileSync(sys, lensBrief);
  writeFileSync(diffFile, diff);
  writeFileSync(ctx, contextText);
  const primaryWindow = 5000;
  const backends = writeBackends(d, [
    { provider: "openai", model: "tiny", host: "http://p/v1", context_window: primaryWindow },
    { provider: "openai", model: "wide", host: "http://f/v1", context_window: 10_000_000 },
  ]);
  const rawSystem = assembleUserMessage({ contextFiles: [{ path: ctx, text: contextText }], diff });
  const N = estimateTokens(rawSystem) + estimateTokens(lensBrief);
  const M = Math.floor(primaryWindow * DEFAULT_WINDOW_SAFETY);
  const expectedLine = `[chain] openai/tiny over-window (est ${N} tok > ${M} usable window) → advancing (exit ${EXIT.USAGE})`;

  const r = await runCapture(["--backends-json", backends, "--system", sys, "--diff", diffFile, "--context", ctx, "--no-trim"]);
  assert.equal(r.code, EXIT.OK, "the wider fallback serves");
  assert.ok(r.err.split("\n").includes(expectedLine), `exact over-window advance line:\n${expectedLine}\n--- got ---\n${r.err}`);
  assert.ok(r.err.split("\n").includes(PRIMARY_SKIP_SIGNAL), "the primary-skip signal is emitted");
  assert.equal(r.captured.system, rawSystem, "the fallback served the untrimmed payload");
});

test("FAFF-1058: --no-trim with every backend over-window fails closed at exit 2 (needs-human)", async () => {
  const { contextText, diff } = largeUnifiedFixture();
  const d = mkdtempSync(join(tmpdir(), "faff1058-owall-"));
  const sys = join(d, "lens.md"), diffFile = join(d, "code.diff"), ctx = join(d, "dense.js");
  const lensBrief = "## Review lens\n\nbrief";
  writeFileSync(sys, lensBrief);
  writeFileSync(diffFile, diff);
  writeFileSync(ctx, contextText);
  const w1 = 5000, w2 = 6000;
  const backends = writeBackends(d, [
    { provider: "openai", model: "tiny", host: "http://p/v1", context_window: w1 },
    { provider: "openai", model: "tiny2", host: "http://f/v1", context_window: w2 },
  ]);
  const rawSystem = assembleUserMessage({ contextFiles: [{ path: ctx, text: contextText }], diff });
  const N = estimateTokens(rawSystem) + estimateTokens(lensBrief);
  const advancing = `[chain] openai/tiny over-window (est ${N} tok > ${Math.floor(w1 * DEFAULT_WINDOW_SAFETY)} usable window) → advancing (exit ${EXIT.USAGE})`;
  const exhausted = `exhausted: openai/tiny2 over-window (est ${N} tok > ${Math.floor(w2 * DEFAULT_WINDOW_SAFETY)} usable window) (exit ${EXIT.USAGE})`;

  const r = await runCapture(["--backends-json", backends, "--system", sys, "--diff", diffFile, "--context", ctx, "--no-trim"]);
  assert.equal(r.code, EXIT.USAGE, "chain terminates at exit 2 → needs-human");
  assert.equal(r.callCount, 0, "no backend served, so there is no served payload");
  assert.ok(r.err.split("\n").includes(advancing), "the non-last backend logs → advancing");
  assert.ok(r.err.split("\n").includes(exhausted), "the last backend logs exhausted:");
  // NOTE (spec deviation): the spec's over-window-all scenario states no primary-skip signal is emitted.
  // The existing FAFF-1039 guard (out of scope for FAFF-1058) still records the primary skip for the
  // needs-human diagnostic on an exhausted chain (primarySkipRecord servedIndex -1, pinned by
  // adversarial-context-window.test.mjs), so the signal IS present. Assert the actual behaviour.
  assert.ok(r.err.split("\n").includes(PRIMARY_SKIP_SIGNAL), "the primary skip is recorded on the exhausted chain");
});

// ============================================================================================
// D2 dispatch semantics, the SKILL.md shell toggle: only the literal "false" turns trimming off.
// ============================================================================================

test("FAFF-1058: a non-boolean adversarial.code_review.trim value leaves trimming on (shell semantics)", () => {
  // Replicates the SKILL.md code-review dispatch's toggle logic exactly:
  //   [ -z "$trim" ] && trim=true; no_trim_flag=""; [ "$trim" = "false" ] && no_trim_flag="--no-trim"
  const script = `
for trim in "yes" "0" "FALSE" "true" "" "false"; do
  t="$trim"
  [ -z "$t" ] && t=true
  no_trim_flag=""
  [ "$t" = "false" ] && no_trim_flag="--no-trim"
  echo "[$trim]=>[$no_trim_flag]"
done
`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.deepEqual(lines, [
    "[yes]=>[]",
    "[0]=>[]",
    "[FALSE]=>[]",
    "[true]=>[]",
    "[]=>[]",
    "[false]=>[--no-trim]",
  ], "only the literal lowercase 'false' passes --no-trim; every other value (and unset) stays on");
});
