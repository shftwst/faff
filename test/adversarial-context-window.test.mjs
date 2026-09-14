// FAFF-1039 — per-backend context-window preflight for adversarial review.
//
// The chain is tried strongest-first, but the advance-past-a-backend decision used to be REACTIVE
// (an HTTP 400 for an over-window payload), so the strongest reviewer was silently unavailable for
// exactly the diffs most worth reviewing. These tests pin the proactive replacement: size the shared
// prefix to the primary's window before dispatch, guard each backend deterministically, and make
// every primary skip loud. Zero live model calls — runReviewFn is injected throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estimateTokens, fitsWindow, trimTargetBytes, normaliseContextWindow,
  tightenToTarget, primarySkipRecord, assembleUserMessage, runReviewChain, main, trimContextFiles, stillOverWindow,
  rawTrimBudgetBytes, trimTargetClamped,
  PRIMARY_SKIP_SIGNAL, DEFAULT_BYTES_PER_TOKEN, DEFAULT_WINDOW_SAFETY, parseArgs,
  DEFAULT_BRIEF_RESERVE_TOKENS, MIN_TRIM_TARGET_BYTES, TRIM_WINDOW_LADDER, EXIT,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";
import { stderrPrimarySkipped } from "../plugin/skills/faffter-dark-adversarial-review/fan-out.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { assembleAdversarialBackends } = require("../plugin/skills/faff/bin/lib/adversarial-backends.js");

const B = (s) => Buffer.byteLength(s, "utf8");

// ---- pure functions -----------------------------------------------------------------------------

test("estimateTokens never returns fewer than utf8Bytes / bytesPerToken (the MUST invariant)", () => {
  for (const s of ["", "a", "hello world", "λ-calculus ✓", "x".repeat(10000), "日本語".repeat(500)]) {
    assert.ok(estimateTokens(s) >= B(s) / DEFAULT_BYTES_PER_TOKEN, `under-estimated for ${s.slice(0, 12)}`);
  }
  // multi-byte characters count as BYTES, not code points — an under-count here is the silent-400 bug
  assert.ok(estimateTokens("日") >= 1);
  assert.equal(estimateTokens("abc", 3.0), 1);
  assert.equal(estimateTokens("abcd", 3.0), 2, "ceil, never floor");
});

test("estimateTokens coerces a non-positive/garbage divisor to the default rather than dividing by zero", () => {
  const s = "x".repeat(300);
  for (const bad of [0, -1, "abc", null, undefined, NaN]) {
    assert.equal(estimateTokens(s, bad), estimateTokens(s, DEFAULT_BYTES_PER_TOKEN));
  }
});

test("fitsWindow: an absent window is unbounded (the opt-in guarantee)", () => {
  for (const absent of [null, undefined, 0, -5, "abc", ""]) {
    assert.equal(fitsWindow(999999999, absent), true, `window ${absent} must read as unbounded`);
  }
});

test("fitsWindow: the boundary is floor(window * safety), inclusive", () => {
  // HARDCODED on purpose. Deriving `usable` from DEFAULT_WINDOW_SAFETY makes the test move with the
  // constant, so a safety fraction of 1.0 would pass unnoticed and the headroom would silently vanish.
  assert.equal(DEFAULT_WINDOW_SAFETY, 0.9, "the guard's headroom is 10%; changing it is a deliberate act");
  assert.equal(fitsWindow(899, 1000), true);
  assert.equal(fitsWindow(900, 1000), true, "exactly on the boundary fits");
  assert.equal(fitsWindow(901, 1000), false, "past floor(1000 * 0.9) does not");
});

test("trimTargetBytes depends only on (contextWindow, diff) — never on any lens brief", () => {
  const diff = "d".repeat(500);
  const a = trimTargetBytes(131072, diff);
  const b = trimTargetBytes(131072, diff);
  assert.equal(a, b, "pure");
  // The signature admits no brief at all, which is what makes the trimmed prefix per-lens-invariant.
  // (Function.length stops at the first defaulted parameter, so assert the BEHAVIOUR, not the arity.)
  assert.equal(trimTargetBytes(131072, diff, "a very long lens brief".repeat(500)), a,
    "a third brief-shaped argument must be ignored — consuming it would break FAFF-903 cross-lens identity");
  // and it genuinely subtracts the diff and the FIXED reserve
  const expected = Math.floor(131072 * DEFAULT_WINDOW_SAFETY * DEFAULT_BYTES_PER_TOKEN)
    - B(diff) - Math.floor(DEFAULT_BRIEF_RESERVE_TOKENS * DEFAULT_BYTES_PER_TOKEN);
  assert.equal(a, expected);
});

test("trimTargetBytes: absent window → null; a tiny window floors at MIN_TRIM_TARGET_BYTES, never <= 0", () => {
  assert.equal(trimTargetBytes(null, "d"), null);
  assert.equal(trimTargetBytes(0, "d"), null);
  // a window so small the reserve alone overruns it must not yield a negative target
  assert.equal(MIN_TRIM_TARGET_BYTES, 1024, "hardcoded: deriving it from the constant hides a change to it");
  assert.equal(trimTargetBytes(1, "d".repeat(100000)), 1024);
});

test("normaliseContextWindow: positive integer, else null (a malformed knob is inert, never an error)", () => {
  assert.equal(normaliseContextWindow(131072), 131072);
  assert.equal(normaliseContextWindow("131072"), 131072, "string from YAML/JSON config");
  assert.equal(normaliseContextWindow(8192.9), 8192, "floored, not rejected");
  for (const bad of [0, -1, -131072, "abc", "", null, undefined, NaN, Infinity, {}, []]) {
    assert.equal(normaliseContextWindow(bad), null, `${JSON.stringify(bad)} must read as absent`);
  }
});

test("DEFAULT_BRIEF_RESERVE_TOKENS is >= the largest --system brief (the check the spec left open)", () => {
  const dir = join(import.meta.dirname, "..", "plugin", "skills", "faffter-dark-spec-review");
  const briefs = readdirSync(dir).filter((f) => /^refute-.*\.md$/.test(f));
  assert.ok(briefs.length >= 4, "all four refuter briefs must be present to decide this");
  let largest = 0, largestName = "";
  for (const f of briefs) {
    const tok = estimateTokens(readFileSync(join(dir, f), "utf8"));
    if (tok > largest) { largest = tok; largestName = f; }
  }
  assert.ok(DEFAULT_BRIEF_RESERVE_TOKENS >= largest,
    `reserve ${DEFAULT_BRIEF_RESERVE_TOKENS} must cover the largest brief (${largestName} at ~${largest} tok). `
    + "If a brief grew, raise the constant and update its inlined measurement table.");
});

test("PRIMARY_SKIP_SIGNAL is a fixed, line-anchorable sentinel distinct from any prose", () => {
  assert.equal(typeof PRIMARY_SKIP_SIGNAL, "string");
  assert.ok(PRIMARY_SKIP_SIGNAL.length > 0);
  assert.ok(!/\s/.test(PRIMARY_SKIP_SIGNAL), "no whitespace — it must survive a .trim() equality check");
});

// ---- config threading: all three field gates -----------------------------------------------------

test("context_window survives the REFS path — the gate normalizeBackend owns", () => {
  // This is the decisive one: the refs path resolves through backends.js's normalizeBackend, which
  // copies FIELD BY FIELD. A field added to BACKEND_RECORD_KEYS but not assigned there is silently
  // dropped (the FAFF-914/FAFF-918 precedent recorded at backends.js:176).
  const cfg = {
    backends: { big: { provider: "openai", model: "m", host: "https://a/v1", api_key_env: "K", context_window: 131072 } },
    adversarial: { refs: ["big"] },
  };
  const { chain, error } = assembleAdversarialBackends(cfg);
  assert.equal(error, undefined);
  assert.equal(chain[0].context_window, 131072, "dropped on the refs path ⇒ the guard silently no-ops");
});

test("context_window survives the native-array and legacy-scalar paths too", () => {
  const native = assembleAdversarialBackends({
    adversarial: { backends: [{ provider: "openai", model: "m", host: "https://a/v1", context_window: 8192 }] },
  });
  assert.equal(native.chain[0].context_window, 8192);

  const legacy = assembleAdversarialBackends({
    adversarial: { provider: "openai", model: "m", host: "https://a/v1", context_window: 8192 },
  });
  assert.equal(legacy.chain[0].context_window, 8192);
});

test("a malformed context_window is normalised away on the refs path, and inert on every path", () => {
  for (const bad of [-5, 0, "abc"]) {
    const { chain } = assembleAdversarialBackends({
      backends: { big: { provider: "openai", model: "m", host: "https://a/v1", context_window: bad } },
      adversarial: { refs: ["big"] },
    });
    assert.equal(chain[0].context_window, undefined, `${bad} must normalise to absent`);
  }
  // The native/legacy paths carry the authored value through to the mapper, which normalises it there
  // — so the OBSERVABLE behaviour (unbounded) is identical on every path.
  const { chain } = assembleAdversarialBackends({
    adversarial: { provider: "openai", model: "m", host: "https://a/v1", context_window: -5 },
  });
  assert.equal(normaliseContextWindow(chain[0].context_window), null, "normalised at the consumer boundary");
});

// ---- the per-backend guard ------------------------------------------------------------------------

function chainOf(...windows) {
  return windows.map((w, i) => ({ provider: "openai", model: `m${i}`, host: "https://h/v1", contextWindow: w }));
}

test("a backend whose declared window the payload does not fit is advanced past BEFORE any network call", async () => {
  const called = [];
  const res = await runReviewChain(chainOf(10, null), {
    system: "x".repeat(9000),   // ~3000 tok, far over a 10-token window
    user: "brief",
    runReviewFn: async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; },
    log: () => {},
  });
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(called, ["m1"], "the over-window primary must never be dispatched");
  assert.equal(res.winnerIndex, 1);
});

test("the guard never fires for a backend declaring no window (the opt-in guarantee)", async () => {
  const called = [];
  const res = await runReviewChain(chainOf(null, null), {
    system: "x".repeat(500000), user: "brief",
    runReviewFn: async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; },
    log: () => {},
  });
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(called, ["m0"], "an un-annotated backend is dispatched however large the payload");
  assert.equal(res.primarySkipped, null);
});

test("the guard applies to NON-primary chain elements too, not only chain[0]", async () => {
  const called = [];
  const res = await runReviewChain(chainOf(null, 10, null), {
    system: "x".repeat(9000), user: "brief",
    runReviewFn: async ({ model }) => {
      called.push(model);
      // the unbounded primary fails transiently, so the chain must reach the windowed fallback
      if (model === "m0") return { status: "unreachable" };
      return { status: "ok", content: "### observation: no findings" };
    },
    log: () => {},
  });
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(called, ["m0", "m2"], "m1 is guard-skipped without a call; m2 serves");
});

test("the guard logs an over-window advance naming the estimate and the usable window", async () => {
  const lines = [];
  await runReviewChain(chainOf(10, null), {
    system: "x".repeat(9000), user: "brief",
    runReviewFn: async () => ({ status: "ok", content: "### observation: no findings" }),
    log: (m) => lines.push(m),
  });
  const note = lines.find((l) => l.includes("over-window"));
  assert.ok(note, "an over-window advance must be logged");
  assert.match(note, /est \d+ tok > \d+ usable window/);
  assert.match(note, /→ advancing/);
});

// ---- primary-skip surfacing ------------------------------------------------------------------------

test("primarySkipRecord: null when the primary served, populated when it did not", () => {
  const chain = chainOf(null, null);
  assert.equal(primarySkipRecord(chain, 0, "whatever"), null, "chain[0] served ⇒ no skip record");
  assert.equal(primarySkipRecord(chain, 1, null), null, "no reason ⇒ no record (never a fabricated one)");
  assert.deepEqual(primarySkipRecord(chain, 1, "over-window (est 9 tok > 9 usable window)"), {
    primary: "openai/m0", servedIndex: 1, reason: "over-window (est 9 tok > 9 usable window)",
  });
});

test("a served-by-fallback result carries the skip reason, for a guard-skip AND a fault-advance", async () => {
  const guard = await runReviewChain(chainOf(10, null), {
    system: "x".repeat(9000), user: "brief",
    runReviewFn: async () => ({ status: "ok", content: "### observation: no findings" }),
    log: () => {},
  });
  assert.match(guard.primarySkipped.reason, /over-window/);
  assert.equal(guard.primarySkipped.servedIndex, 1);

  const fault = await runReviewChain(chainOf(null, null), {
    system: "s", user: "brief",
    runReviewFn: async ({ model }) => (model === "m0" ? { status: "unreachable" } : { status: "ok", content: "### observation: no findings" }),
    log: () => {},
  });
  assert.ok(fault.primarySkipped, "a fault-advance past the primary is a primary skip too");
  assert.equal(fault.primarySkipped.servedIndex, 1);
  assert.ok(fault.primarySkipped.reason.length > 0);
});

test("fan-out recognises PRIMARY_SKIP_SIGNAL by line-anchored equality, never a substring", () => {
  assert.equal(stderrPrimarySkipped(`noise\n${PRIMARY_SKIP_SIGNAL}\nmore`), true);
  assert.equal(stderrPrimarySkipped(`  ${PRIMARY_SKIP_SIGNAL}  `), true, "trimmed equality");
  assert.equal(stderrPrimarySkipped(""), false);
  assert.equal(stderrPrimarySkipped(null), false);
  // the forgery case: a finding body echoing the sentence inline must NOT trip it
  assert.equal(stderrPrimarySkipped(`refuted: "see ${PRIMARY_SKIP_SIGNAL} here" — nope`), false);
});

// ---- end-to-end through main() ---------------------------------------------------------------------

// An ANCHOR-DENSE fixture. The plain filler fixture below is almost entirely non-anchored, so the
// default FAFF-915 trim already collapses it to ~1.5KB and there is nothing left to tighten. Here the
// diff references identifiers spread through the file, so window=24 legitimately retains a large
// payload and the descending ladder has real reduction to find — the actual FAFF-1027 shape.
function denseFixture({ lines = 6000, anchors = 40 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "cw-dense-"));
  const sys = join(d, "brief.md");
  const diff = join(d, "d.diff");
  const ctx = join(d, "dense.js");
  writeFileSync(sys, "REVIEW LENS BRIEF\n");
  const body = [];
  for (let i = 0; i < lines; i++) body.push(`const fn${i} = ${i}; // ${"p".repeat(24)}`);
  writeFileSync(ctx, body.join("\n"));
  const step = Math.floor(lines / anchors);
  const hunks = ["--- a/dense.js", "+++ b/dense.js"];
  for (let k = 0; k < anchors; k++) {
    const ln = k * step;
    hunks.push(`@@ -${ln + 1},1 +${ln + 1},2 @@`, `+  use(fn${ln});`);
  }
  writeFileSync(diff, hunks.join("\n") + "\n");
  return { dir: d, sys, diff, ctx };
}

function fixture({ contextBytes, diffBytes = 200 }) {
  const d = mkdtempSync(join(tmpdir(), "cw-"));
  const sys = join(d, "brief.md");
  const diff = join(d, "d.diff");
  const ctx = join(d, "big.js");
  writeFileSync(sys, "REVIEW LENS BRIEF\n");
  // a diff that touches one region of big.js, so the trim has real anchors to keep
  writeFileSync(diff, `--- a/big.js\n+++ b/big.js\n@@ -10,3 +10,4 @@\n+const added = ${"z".repeat(Math.max(1, diffBytes))};\n`);
  const lines = [];
  for (let i = 0; i < Math.ceil(contextBytes / 40); i++) lines.push(`const filler${i} = ${i}; // ${"p".repeat(20)}`);
  writeFileSync(ctx, lines.join("\n"));
  return { dir: d, sys, diff, ctx };
}

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

test("with NO backend declaring a window, the assembled prefix is byte-identical to the no-window baseline", async () => {
  const f = fixture({ contextBytes: 200000 });
  const bf = join(f.dir, "b.json");
  const seen = [];
  const capture = async ({ system }) => { seen.push(system); return { status: "ok", content: "### observation: no findings" }; };

  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "m", host: "https://h/v1" }]));
  const baseline = await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx], capture);
  assert.equal(baseline.code, EXIT.OK);

  // same inputs, an explicitly malformed window (must behave byte-identically to absent)
  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "m", host: "https://h/v1", context_window: -5 }]));
  const malformed = await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx], capture);
  assert.equal(malformed.code, EXIT.OK);

  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], "a malformed window must produce byte-identical bytes to an absent one");
  assert.ok(!baseline.err.includes("FAFF-1039 window-targeted trim"), "no window ⇒ the trim never fires");
  assert.ok(!malformed.err.includes("FAFF-1039 window-targeted trim"));
});

test("an over-window primary triggers the window-targeted trim and is then served BY THE PRIMARY", async () => {
  // Fixture A: over the primary's usable window after the DEFAULT trim, but reducible below it by
  // tightening — so the ticket's whole point (the primary stays available) is what gets asserted.
  const f = denseFixture();
  const bf = join(f.dir, "b.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "openai", model: "primary", host: "https://h/v1", context_window: 15000 },
    { provider: "openai", model: "fallback", host: "https://h2/v1" },
  ]));
  const called = [];
  const r = await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx],
    async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; });

  assert.equal(r.code, EXIT.OK);
  assert.match(r.err, /FAFF-1039 window-targeted trim/, "the trim must fire and say so");
  assert.deepEqual(called, ["primary"], "after tightening, the PRIMARY serves — the whole point of the ticket");
  assert.ok(!r.err.includes(PRIMARY_SKIP_SIGNAL), "no skip signal when the primary served");
  assert.ok(!r.out.includes("NOTE: primary reviewer"), "no stdout notice when the primary served");
});

test("a primary that cannot fit even at the tightest rung is skipped loudly, on stderr AND stdout", async () => {
  // Fixture B: a window so small no rung of the ladder can reach it.
  const f = denseFixture();
  const bf = join(f.dir, "b.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "openai", model: "tiny", host: "https://h/v1", context_window: 50 },
    { provider: "openai", model: "fallback", host: "https://h2/v1" },
  ]));
  const called = [];
  const r = await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx],
    async ({ model }) => { called.push(model); return { status: "ok", content: "### critical: something\nbody\n" }; });

  assert.equal(r.code, EXIT.OK);
  assert.deepEqual(called, ["fallback"], "the tiny primary is guard-skipped without a call");
  assert.ok(r.err.split("\n").some((l) => l.trim() === PRIMARY_SKIP_SIGNAL), "the sentinel on its own stderr line");
  assert.match(r.err, /over-window/);
  assert.match(r.out, /NOTE: primary reviewer openai\/tiny was skipped; served by chain\[1\] — over-window/);
  // the notice must sit with the findings, after the harness-authored attribution header
  const lines = r.out.split("\n");
  const hdr = lines.findIndex((l) => /^## Adversarial findings/.test(l));
  const note = lines.findIndex((l) => l.startsWith("NOTE: primary reviewer"));
  assert.ok(hdr >= 0 && note > hdr, "the notice follows the attribution header");
});

test("the trimmed shared prefix is byte-identical across four different lens briefs (FAFF-903 invariance)", async () => {
  const f = denseFixture();
  const bf = join(f.dir, "b.json");
  // An unbounded fallback is required, not incidental: the per-backend GUARD includes the lens brief,
  // so a deliberately huge brief can push that one lens past the primary's window while the others fit.
  // That is correct behaviour, and it makes the test stronger: the prefix must be byte-identical even
  // when different lenses take different paths through the chain, because the guard decides skips and
  // never re-trims. With a single backend that lens would simply exhaust and never dispatch.
  writeFileSync(bf, JSON.stringify([
    { provider: "openai", model: "primary", host: "https://h/v1", context_window: 15000 },
    { provider: "openai", model: "fallback", host: "https://h2/v1" },
  ]));

  const prefixes = [];
  const servedBy = [];
  // The briefs must span WIDELY. A narrow spread (tens to a few thousand bytes) can leave every lens
  // landing on the same ladder rung, so a trim target that wrongly consumed the brief would still
  // produce identical prefixes and the test would pass while the invariant was broken. 11 B vs 14 KB
  // straddles a rung boundary, so a brief-consuming target genuinely diverges here.
  for (const brief of ["arch brief", "x".repeat(14005), "QA", "methodology " + "y".repeat(1500)]) {
    const sysFile = join(f.dir, `b-${prefixes.length}.md`);
    writeFileSync(sysFile, brief);
    await runMain(["--backends-json", bf, "--system", sysFile, "--diff", f.diff, "--context", f.ctx],
      async ({ system, model }) => { prefixes.push(system); servedBy.push(model); return { status: "ok", content: "### observation: no findings" }; });
  }
  assert.equal(prefixes.length, 4);
  for (let i = 1; i < 4; i++) {
    assert.equal(prefixes[i], prefixes[0],
      "the shared prefix must not vary with the lens brief — a per-lens prefix kills the FAFF-903 cache");
  }
  // The other half of the same principle, and the one behaviour nothing else pins: the per-backend
  // GUARD does include this lens's brief, so a per-lens SKIP decision may differ even though the prefix
  // may not. The 14 KB brief is sized to push exactly that one lens past the primary's window.
  assert.equal(servedBy[1], "fallback",
    "the huge-brief lens must be guard-skipped off the primary — the guard counts the brief");
  for (const i of [0, 2, 3]) {
    assert.equal(servedBy[i], "primary", `lens ${i} fits and must be served by the primary`);
  }
});

// ---- the tightening search --------------------------------------------------------------------------

test("tightenToTarget returns the first ladder rung that fits, and reports which", () => {
  const contextFiles = [{ path: "big.js", text: Array.from({ length: 4000 }, (_, i) => `const x${i} = ${i};`).join("\n") }];
  const diff = "--- a/big.js\n+++ b/big.js\n@@ -10,3 +10,4 @@\n+const x10 = 10;\n";
  const big = B(assembleUserMessage({ contextFiles, diff }));

  const loose = tightenToTarget({ contextFiles, diff, targetBytes: big });
  assert.equal(loose.fitted, true);
  assert.equal(loose.window, TRIM_WINDOW_LADDER[0], "an already-fitting target takes the first rung");

  const tight = tightenToTarget({ contextFiles, diff, targetBytes: 2000 });
  assert.ok(tight.bytes <= big, "a tighter target yields a smaller prefix");
  assert.ok(TRIM_WINDOW_LADDER.includes(tight.window));
});

test("tightenToTarget with an unreachable target returns the tightest rung and fitted:false, never throws", () => {
  const contextFiles = [{ path: "big.js", text: Array.from({ length: 4000 }, (_, i) => `const x${i} = ${i};`).join("\n") }];
  const diff = "--- a/big.js\n+++ b/big.js\n@@ -10,3 +10,4 @@\n+const x10 = 10;\n";
  const r = tightenToTarget({ contextFiles, diff, targetBytes: 1 });
  assert.equal(r.fitted, false, "honest about not reaching the target");
  assert.equal(r.window, TRIM_WINDOW_LADDER[TRIM_WINDOW_LADDER.length - 1], "the tightest rung was tried");
  assert.ok(r.prefix.includes("DIFF UNDER REVIEW"), "the diff is always retained in full");
});

test("the ladder is strictly descending, so each rung keeps no more than the one before", () => {
  for (let i = 1; i < TRIM_WINDOW_LADDER.length; i++) {
    assert.ok(TRIM_WINDOW_LADDER[i] < TRIM_WINDOW_LADDER[i - 1],
      "a non-descending ladder would make the search non-terminating in the reduction sense");
  }
  assert.ok(TRIM_WINDOW_LADDER[TRIM_WINDOW_LADDER.length - 1] >= 1,
    "never 0: the tightest rung still keeps a line either side of each anchor, never a diff-only view");
});

test("a payload that fits NO backend's window runs the chain to its existing exhaustion terminal, skip surfaced", async () => {
  // DONE: "A payload that cannot fit any window runs the chain to its existing exhaustion/needs-human
  // terminal (exit 2 unchanged), with the primary-skip surfaced on stderr and in the terminal
  // diagnostic." Nothing serves here, so there is no stdout to carry the human notice — the sentinel
  // and the reason must still reach stderr.
  const called = [];
  const res = await runReviewChain(chainOf(10, 10), {
    system: "x".repeat(9000), user: "brief",
    runReviewFn: async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; },
    log: () => {},
  });
  assert.deepEqual(called, [], "no backend is dispatched — every one is guard-skipped pre-network");
  assert.equal(res.exit, EXIT.USAGE, "the existing exit-2 exhaustion terminal, unchanged");
  assert.ok(res.primarySkipped, "the primary skip is still recorded for the needs-human diagnostic");
  assert.equal(res.primarySkipped.servedIndex, -1, "-1 marks 'nothing served' rather than a served index");
  assert.match(res.primarySkipped.reason, /over-window/);
});

test("an exhausted all-over-window chain surfaces the sentinel on stderr through main()", async () => {
  const f = denseFixture();
  const bf = join(f.dir, "b.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "openai", model: "tiny1", host: "https://h/v1", context_window: 50 },
    { provider: "openai", model: "tiny2", host: "https://h2/v1", context_window: 50 },
  ]));
  const called = [];
  const r = await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx],
    async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; });

  assert.deepEqual(called, [], "zero network calls — both backends guard-skipped");
  assert.equal(r.code, EXIT.USAGE, "exit 2, the unchanged needs-human-class terminal");
  assert.ok(r.err.split("\n").some((l) => l.trim() === PRIMARY_SKIP_SIGNAL),
    "the sentinel reaches stderr even though nothing served and there is no stdout to carry a notice");
  assert.match(r.err, /primary reviewer openai\/tiny1 was skipped/);
});

// ---- regressions the first review round found -------------------------------------------------

// A file with identifier anchors but NO diff-touched lines: trimOneFile head-reduces it while its kept
// fraction exceeds retainedCeiling, and a TIGHTER window can drop the fraction below the ceiling, so
// the file stops being head-reduced and GROWS. This is why the ladder is not monotonic.
function nonMonotonicFixture() {
  const text = Array.from({ length: 400 }, (_, i) => `const anchor${i} = ${i}; // ${"q".repeat(30)}`).join("\n");
  const idents = Array.from({ length: 40 }, (_, k) => `+  use(anchor${k * 10});`).join("\n");
  return {
    contextFiles: [{ path: "other.js", text }],
    diff: `--- a/touched.js\n+++ b/touched.js\n@@ -1,1 +1,41 @@\n${idents}\n`,
  };
}

test("the ladder is NOT monotonic in bytes — a tighter window can enlarge a head-reduced file", () => {
  // Pins the premise the two fixes below rest on. If trimOneFile ever becomes monotonic this test
  // fails loudly, and the min-tracking/clamp become belt-and-braces rather than load-bearing.
  const { contextFiles, diff } = nonMonotonicFixture();
  const sizes = TRIM_WINDOW_LADDER.map((window) => {
    const { contextFiles: t } = trimContextFiles({ contextFiles, diff, thresholdBytes: 1, window });
    return B(assembleUserMessage({ contextFiles: t, diff }));
  });
  assert.ok(sizes.some((b, i) => i > 0 && b > sizes[i - 1]),
    `expected at least one rung to grow; got ${sizes.join(", ")}`);
});

test("tightenToTarget returns the SMALLEST prefix across rungs, never merely the last rung tried", () => {
  const { contextFiles, diff } = nonMonotonicFixture();
  const sizes = TRIM_WINDOW_LADDER.map((window) => {
    const { contextFiles: t } = trimContextFiles({ contextFiles, diff, thresholdBytes: 1, window });
    return B(assembleUserMessage({ contextFiles: t, diff }));
  });
  const smallest = Math.min(...sizes);
  const last = sizes[sizes.length - 1];
  assert.ok(smallest < last, "fixture must actually discriminate min-vs-last");

  const r = tightenToTarget({ contextFiles, diff, targetBytes: 1 }); // unreachable ⇒ fitted:false path
  assert.equal(r.fitted, false);
  assert.equal(r.bytes, smallest,
    "returning the last rung here would hand the chain a payload larger than the best one found");
});

test("the window-targeted trim NEVER enlarges the prefix end-to-end through main()", async () => {
  // The end-to-end shape of the same bug: one diff-touched file plus one identifier-anchored file with
  // no touched lines. Without the clamp in main this grew the payload several-fold while reporting it
  // as a "window-targeted trim".
  const d = mkdtempSync(join(tmpdir(), "cw-grow-"));
  const sys = join(d, "brief.md"); writeFileSync(sys, "BRIEF\n");
  const touched = join(d, "touched.js");
  const other = join(d, "other.js");
  writeFileSync(touched, Array.from({ length: 60 }, (_, i) => `const t${i} = ${i};`).join("\n"));
  writeFileSync(other, Array.from({ length: 400 }, (_, i) => `const anchor${i} = ${i}; // ${"q".repeat(30)}`).join("\n"));
  const idents = Array.from({ length: 40 }, (_, k) => `+  use(anchor${k * 10});`).join("\n");
  const diff = join(d, "d.diff");
  writeFileSync(diff, `--- a/touched.js\n+++ b/touched.js\n@@ -1,1 +1,41 @@\n${idents}\n`);
  const bf = join(d, "b.json");

  const seen = [];
  const capture = async ({ system }) => { seen.push(system); return { status: "ok", content: "### observation: no findings" }; };

  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "m", host: "https://h/v1" }]));
  await runMain(["--backends-json", bf, "--system", sys, "--diff", diff, "--context", touched, "--context", other], capture);

  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "m", host: "https://h/v1", context_window: 2000 }]));
  const windowed = await runMain(["--backends-json", bf, "--system", sys, "--diff", diff, "--context", touched, "--context", other], capture);

  assert.equal(seen.length, 2);
  assert.ok(B(seen[1]) <= B(seen[0]),
    `declaring a context_window must never ENLARGE the payload: ${B(seen[0])} B → ${B(seen[1])} B`);
  if (B(seen[1]) === B(seen[0])) {
    assert.match(windowed.err, /KEEPING the untightened prefix/,
      "when no rung shrinks it, the note must say so rather than claim a tightening");
  }
});

test("a primary skip survives the DEADLINE exhaustion paths, not only the served and exhausted returns", async () => {
  // "Loud surfacing, always on" has to hold on every terminal path. Three deadline returns used to drop
  // the record, so a guard-skipped primary followed by a budget exhaustion went out silently.
  //
  // Reaching a DEADLINE return specifically takes care: a chain that merely runs out of backends exits
  // through the chain-exhausted return, which always carried the record, so such a test would pass
  // whether or not the fix is present. Here backend 1 burns the whole budget, so the TOP-OF-LOOP
  // deadline gate fires on iteration 2 and we exit through the deadline return under test.
  let now = 0;
  const res = await runReviewChain(chainOf(10, null, null), {
    system: "x".repeat(9000), user: "brief",
    totalDeadlineMs: 1000,
    nowFn: () => now,
    runReviewFn: async () => { now += 5000; return { status: "unreachable" }; },
    log: () => {},
  });
  assert.equal(res.deadlineExceeded, true, "must exit through a DEADLINE return, not chain-exhaustion");
  assert.ok(res.primarySkipped, "the guard-skipped primary must still be reported on a deadline exit");
  assert.match(res.primarySkipped.reason, /over-window/);
  assert.equal(res.primarySkipped.servedIndex, -1);
});

test("trimTargetBytes and tightenToTarget are independent of the lens brief, asserted directly", () => {
  // The per-lens-invariance test drives main() and can be fooled by a narrow brief spread, so assert the
  // invariant at its source too: neither function accepts or consults a brief.
  const { contextFiles, diff } = nonMonotonicFixture();
  const target = trimTargetBytes(30000, diff);
  const a = tightenToTarget({ contextFiles, diff, targetBytes: target });
  const b = tightenToTarget({ contextFiles, diff, targetBytes: target });
  assert.equal(a.prefix, b.prefix, "pure in its declared inputs");
  assert.equal(a.bytes, b.bytes);
  // an injected assembler proves the seam is live, and that the search reads nothing but its inputs
  let calls = 0;
  const injected = tightenToTarget({
    contextFiles, diff, targetBytes: target,
    assembleFn: ({ contextFiles: cf, diff: df }) => { calls++; return assembleUserMessage({ contextFiles: cf, diff: df }); },
  });
  assert.ok(calls > 0, "assembleFn is genuinely used, not a dead parameter");
  assert.equal(injected.prefix, a.prefix);
});

test("an over-window skip counts as a CONFIG fault in terminal precedence, not an availability one", () => {
  // The no-silent-weakening rule: a config fault anywhere in a fully-failed chain surfaces needs-human,
  // while a chain of purely availability failures is pass+skip. A declared window too small for your
  // diffs is actionable config, so it belongs on the config side. This pins the resulting exit-class
  // shift, which is the stricter direction and deliberate.
  const unreachable = async () => ({ status: "unreachable" });
  return Promise.all([
    runReviewChain(chainOf(null, null), { system: "s", user: "b", runReviewFn: unreachable, log: () => {} }),
    runReviewChain(chainOf(10, null), { system: "x".repeat(9000), user: "b", runReviewFn: unreachable, log: () => {} }),
  ]).then(([availabilityOnly, withGuardSkip]) => {
    assert.equal(availabilityOnly.exit, EXIT.UNREACHABLE, "purely availability failures stay pass+skip (5)");
    assert.equal(withGuardSkip.exit, EXIT.USAGE, "an over-window skip escalates the terminal to needs-human (2)");
  });
});

// ---- regressions the second review round found -------------------------------------------------

test("trimTargetBytes is a CONTEXT budget, so the diff is charged exactly once", () => {
  // The budget subtracts the diff because the diff is not reducible; the search must therefore compare
  // it against CONTEXT bytes. Comparing it against the assembled prefix (which contains the diff) would
  // charge the diff twice and undershoot by exactly its size, over-trimming every diff-heavy review.
  const w = 15000;
  const usableBytes = Math.floor(w * DEFAULT_WINDOW_SAFETY * DEFAULT_BYTES_PER_TOKEN);
  const reserveBytes = Math.floor(DEFAULT_BRIEF_RESERVE_TOKENS * DEFAULT_BYTES_PER_TOKEN);
  for (const diffBytes of [0, 5000, 20000]) {
    const diff = "d".repeat(diffBytes);
    assert.equal(trimTargetBytes(w, diff), Math.max(MIN_TRIM_TARGET_BYTES, usableBytes - diffBytes - reserveBytes));
  }
});

test("a fitting context is NOT dragged to the tightest rung by a large diff", () => {
  // The double-charge showed up here: with the diff counted twice the search never returned early and
  // always walked to window=1, over-trimming context the window had room for.
  // To DISCRIMINATE the two readings the target is set to exactly the context bytes the first rung
  // produces. Correct reading: fits at rung 0. Double-charge reading: context + diff > target, so the
  // search walks the whole ladder. A loosely-sized target fits under both and proves nothing.
  const contextFiles = [{ path: "c.js", text: Array.from({ length: 300 }, (_, i) => `const v${i} = ${i}; // ${"z".repeat(20)}`).join("\n") }];
  const diff = `--- a/c.js\n+++ b/c.js\n@@ -5,1 +5,2 @@\n+  use(v5);\n${"+// padding\n".repeat(400)}`;
  const { contextFiles: firstRung } = trimContextFiles({ contextFiles, diff, thresholdBytes: 1, window: TRIM_WINDOW_LADDER[0] });
  // Everything-but-the-diff, the same spelling tightenToTarget uses: prefix minus diff, so the per-file
  // wrappers and the DIFF UNDER REVIEW header are charged here exactly as they are there.
  const firstRungContextBytes = B(assembleUserMessage({ contextFiles: firstRung, diff })) - B(diff);
  assert.ok(B(diff) > 0, "the diff must be non-empty or the two readings coincide");

  const r = tightenToTarget({ contextFiles, diff, targetBytes: firstRungContextBytes });
  assert.equal(r.fitted, true, "a context sized exactly to its budget must fit");
  assert.equal(r.window, TRIM_WINDOW_LADDER[0], "at the FIRST rung — walking further means the diff was charged twice");
  assert.equal(r.contextBytes, firstRungContextBytes, "the fit is decided on context bytes, matching the budget");
});

test("the main() never-enlarge clamp is load-bearing: every rung can exceed the untrimmed original", async () => {
  // The default trim is gated on 48KB and is an identity no-op below it, so main may hold the RAW
  // assembly, while the ladder always trims. On a file whose lines are shorter than an elision marker
  // every rung pays more in markers than it saves, so even the smallest rung is larger. Min-tracking
  // cannot save this; only the clamp can.
  const d = mkdtempSync(join(tmpdir(), "cw-clamp-"));
  const sys = join(d, "brief.md"); writeFileSync(sys, "BRIEF\n");
  const ctx = join(d, "sparse.js");
  const lines = [];
  for (let i = 0; i < 1000; i++) lines.push(i % 50 === 0 ? `const marker${i} = ${i};` : "");
  writeFileSync(ctx, lines.join("\n"));
  const idents = Array.from({ length: 20 }, (_, k) => `+  use(marker${k * 50});`).join("\n");
  const diff = join(d, "d.diff");
  writeFileSync(diff, `--- a/sparse.js\n+++ b/sparse.js\n@@ -1,1 +1,21 @@\n${idents}\n`);
  const bf = join(d, "b.json");
  const seen = [];
  const capture = async ({ system }) => { seen.push(system); return { status: "ok", content: "### observation: no findings" }; };

  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "m", host: "https://h/v1" }]));
  await runMain(["--backends-json", bf, "--system", sys, "--diff", diff, "--context", ctx], capture);
  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "m", host: "https://h/v1", context_window: 2000 }]));
  const r = await runMain(["--backends-json", bf, "--system", sys, "--diff", diff, "--context", ctx], capture);

  assert.equal(seen.length, 2);
  assert.equal(B(seen[1]), B(seen[0]), "the untightened prefix must be kept verbatim when no rung shrinks it");
  assert.match(r.err, /KEEPING the untightened prefix/,
    "and the note must say so, rather than reporting a tightening that made things worse");
});

test("every DEADLINE return carries the primary-skip record, not just the top-of-loop gate", async () => {
  // Three distinct deadline returns exist. A test that exits via chain-exhaustion passes whether or not
  // they carry the record, so each is reached deliberately here.

  // Each sub-case asserts `deadlineExceeded` FIRST. Without that guard a chain that merely SERVES passes
  // the primarySkipped assertion vacuously, which is exactly how an earlier version of this test slipped
  // through while two of the three deadline returns were still unpinned.

  // (a) last-backend slice exhaustion. Needs REAL timers: the slice race is a genuine setTimeout, so a
  // mocked clock cannot fire it and the backend simply serves.
  const lastSlice = await runReviewChain(chainOf(10, null), {
    system: "x".repeat(9000), user: "brief", totalDeadlineMs: 30,
    runReviewFn: async () => { await new Promise((r) => setTimeout(r, 120)); return { status: "ok", content: "### observation: no findings" }; },
    log: () => {},
  });
  assert.equal(lastSlice.deadlineExceeded, true, "(a) must exit via the last-backend slice return");
  assert.ok(lastSlice.primarySkipped, "(a) last-backend slice exhaustion must carry it");
  assert.match(lastSlice.primarySkipped.reason, /over-window/);

  // (b) slice underflow. sliceMs is floor(remaining / backendsLeft), so underflow needs
  // remaining < backendsLeft: a THREE-element chain, not two, or floor(1/1) is 1 and it dispatches.
  const underflow = await runReviewChain(chainOf(10, null, null), {
    system: "x".repeat(9000), user: "brief", totalDeadlineMs: 1, nowFn: () => 0,
    runReviewFn: async () => ({ status: "ok", content: "### observation: no findings" }),
    log: () => {},
  });
  assert.equal(underflow.deadlineExceeded, true, "(b) must exit via the slice-underflow return");
  assert.ok(underflow.primarySkipped, "(b) slice underflow must carry it");
  assert.match(underflow.primarySkipped.reason, /over-window/);

  // (c) top-of-loop total-budget gate
  let n2 = 0;
  const topOfLoop = await runReviewChain(chainOf(10, null, null), {
    system: "x".repeat(9000), user: "brief", totalDeadlineMs: 1000, nowFn: () => n2,
    runReviewFn: async () => { n2 += 5000; return { status: "unreachable" }; },
    log: () => {},
  });
  assert.equal(topOfLoop.deadlineExceeded, true, "(c) must exit via the top-of-loop gate");
  assert.ok(topOfLoop.primarySkipped, "(c) top-of-loop gate must carry it");
});

test("the recorded skip reason is the classified one, across every fault class a primary can hit", async () => {
  // The DONE item names these explicitly ("the existing classified advance reason (400/auth/empty/deadline)").
  // Only the over-window and generic-fault sites were pinned; the rest could be deleted with a green suite.
  const ok = { status: "ok", content: "### observation: no findings" };

  const invalid = await runReviewChain([{ provider: "openai", model: "", host: "" }, ...chainOf(null)], {
    system: "s", user: "b", runReviewFn: async () => ok, log: () => {},
  });
  assert.match(invalid.primarySkipped.reason, /invalid \(missing model\/host\)/);

  const auth = await runReviewChain([{ provider: "openai", model: "m", host: "h", apiKeyMissing: true, apiKeyEnv: "NOPE" }, ...chainOf(null)], {
    system: "s", user: "b", runReviewFn: async () => ok, log: () => {},
  });
  assert.match(auth.primarySkipped.reason, /unset-key \(env 'NOPE'\)/);

  const garbled = await runReviewChain(chainOf(null, null), {
    system: "s", user: "b", log: () => {},
    runReviewFn: async ({ model }) => (model === "m0" ? { status: "ok", content: "not findings shaped at all" } : ok),
  });
  assert.ok(garbled.primarySkipped, "a shape-rejected primary is still a primary skip");
  assert.ok(garbled.primarySkipped.reason.length > 0);

  const emptyContract = await runReviewChain(chainOf(null, null), {
    system: "s", user: "b", expectContract: true, log: () => {},
    runReviewFn: async ({ model }) => (model === "m0" ? { status: "ok", content: "   " } : { status: "ok", content: "{\"verdict\":\"x\"}" }),
  });
  assert.match(emptyContract.primarySkipped.reason, /empty \(contract mode: empty content\)/);

  // Real timers here: the slice race is a genuine setTimeout, so a mocked clock cannot fire it. A
  // never-resolving promise would leak the event loop, so the slow backend resolves, just too late.
  const slice = await runReviewChain(chainOf(null, null, null), {
    system: "s", user: "b", totalDeadlineMs: 30, log: () => {},
    runReviewFn: async ({ model }) => {
      if (model === "m0") { await new Promise((r) => setTimeout(r, 60)); return ok; }
      return ok;
    },
  });
  assert.ok(slice.primarySkipped, "a slice-exhausted primary is still a primary skip");
  assert.match(slice.primarySkipped.reason, /slice .* exhausted/);
});

test("the --context-window flag parses and drives the guard on the legacy single-backend path", async () => {
  const a = parseArgs(["--host", "https://h/v1", "--model", "m", "--system", "s", "--diff", "d", "--context-window", "12345"]);
  assert.equal(a.contextWindow, "12345", "parsed off argv");

  const f = denseFixture();
  const called = [];
  const r = await runMain(
    ["--host", "https://h/v1", "--model", "solo", "--provider", "openai", "--system", f.sys, "--diff", f.diff, "--context", f.ctx, "--context-window", "50"],
    async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; });
  assert.deepEqual(called, [], "the flag alone is enough to guard-skip the only backend, pre-network");
  assert.ok(r.err.split("\n").some((l) => l.trim() === PRIMARY_SKIP_SIGNAL));
  assert.equal(r.code, EXIT.USAGE);
});

// ---- regressions the third review round found ---------------------------------------------------

test("contextBytes charges the per-file framing, not just the raw text", () => {
  // A bare sum of f.text omits assembleUserMessage's `<file path=…>` wrappers and the
  // `DIFF UNDER REVIEW:` header — about 25 bytes plus the path per file, which on a many-file payload
  // exceeds the slack the brief reserve leaves. Deriving it as prefix-minus-diff charges them exactly,
  // and cannot drift if the framing ever changes.
  const contextFiles = [
    { path: "some/quite/long/path/alpha.js", text: "a".repeat(500) },
    { path: "some/quite/long/path/beta.js", text: "b".repeat(500) },
  ];
  const diff = "--- a/alpha.js\n+++ b/alpha.js\n@@ -1,1 +1,2 @@\n+x\n";
  const r = tightenToTarget({ contextFiles, diff, targetBytes: null });
  const rawTextSum = r.contextFiles.reduce((a, f) => a + B(f.text), 0);

  assert.equal(r.contextBytes, r.bytes - B(diff), "exact by construction: prefix minus diff");
  assert.ok(r.contextBytes > rawTextSum, "and strictly more than the bare text sum, because framing is charged");
  // the omission a bare sum would make, stated concretely
  const framing = contextFiles.reduce((a, f) => a + 25 + B(f.path), 0) + 20;
  assert.equal(r.contextBytes - rawTextSum, framing, `framing is ${framing} B for this payload`);
});

test("the window-targeted trim note never contradicts its own fit verdict", async () => {
  // The note reported PREFIX bytes against a CONTEXT-byte target, so it could print numbers denying a
  // fit it had just made — in the one diagnostic this feature exists to make honest.
  const f = denseFixture();
  const bf = join(f.dir, "b.json");
  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "primary", host: "https://h/v1", context_window: 15000 }]));
  const r = await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx],
    async () => ({ status: "ok", content: "### observation: no findings" }));

  const line = r.err.split("\n").find((l) => l.includes("window-targeted trim"));
  assert.ok(line, "the trim must fire on this fixture");
  const m = line.match(/\((\d+) B vs (\d+) B target(?:, clamped to floor)?\)/);
  assert.ok(m, `the note must carry a bytes-vs-target clause: ${line}`);
  const [, got, target] = m;
  const claimedStillOver = line.includes("STILL OVER");
  if (!claimedStillOver) {
    assert.ok(Number(got) <= Number(target),
      `a note reporting a fit must print bytes within the target: ${got} B vs ${target} B`);
  }
  // The stronger contract: the suffix must track the WINDOW exactly, in both directions. The note
  // prints both numbers, so the biconditional is checkable from the line itself.
  const est = Number(line.match(/now est (\d+) tok/)[1]);
  const usable = Number(line.match(/usable (\d+)/)[1]);
  assert.equal(claimedStillOver, est > usable,
    `the STILL-OVER suffix must appear exactly when est exceeds usable: est ${est}, usable ${usable}, suffix ${claimedStillOver}`);
});

// ---- regressions the fourth review round's adversarial pass found -------------------------------

test("the STILL-OVER suffix keys off the WINDOW, never off whether the byte target was hit", () => {
  // `tightenToTarget`'s `fitted` means "hit the byte target". When a large diff drives the budget below
  // MIN_TRIM_TARGET_BYTES the target clamps to that floor, so hitting it no longer implies fitting the
  // window, and a note keyed off `fitted` reports a fit on a payload still well over. Pinning the
  // decision directly rather than through a fixture: the clamped case is awkward to provoke end-to-end,
  // and an inline conditional is exactly what made the distinction invisible in the first place.
  const usable = 3600;
  assert.equal(stillOverWindow(1000, 2000, usable), false, "comfortably under");
  assert.equal(stillOverWindow(1600, 2000, usable), false, "exactly on the boundary is not over");
  assert.equal(stillOverWindow(1601, 2000, usable), true, "one token over is over");
  // the reviewer's reproduction: target clamped to the floor and therefore "hit", yet 30% over the window
  assert.equal(stillOverWindow(2699, 2000, usable), true,
    "a clamped-and-hit target must still report STILL OVER when the window is exceeded");
  // the reserve is part of the claim, never dropped
  assert.equal(stillOverWindow(3599, 0, usable), false);
  assert.equal(stillOverWindow(3599, 2, usable), true, "the brief reserve counts toward the window");
});

// ---- regressions the fifth review round found ---------------------------------------------------

test("trimTargetClamped and trimTargetBytes share one spelling of the arithmetic", () => {
  // Re-deriving the budget at the call site is how the note and the target silently desynchronise.
  const diff = "d".repeat(40000);
  assert.equal(trimTargetBytes(4000, diff), MIN_TRIM_TARGET_BYTES, "a huge diff floors the target");
  assert.equal(trimTargetClamped(4000, diff), true, "and reports itself as clamped");
  assert.ok(rawTrimBudgetBytes(4000, diff) < MIN_TRIM_TARGET_BYTES, "because the raw budget is below the floor");

  assert.equal(trimTargetClamped(131072, "d".repeat(100)), false, "a roomy window is not clamped");
  assert.equal(trimTargetBytes(131072, "d".repeat(100)), rawTrimBudgetBytes(131072, "d".repeat(100)),
    "and the target is then the raw budget, unfloored");
  assert.equal(trimTargetClamped(null, diff), false, "no window ⇒ nothing to clamp");
  assert.equal(rawTrimBudgetBytes(null, diff), null);
});

test("main() reports STILL OVER and 'clamped to floor' when the target was floored but the window is not met", async () => {
  // The CALL SITE, not the arithmetic. Round 4's bug was reintroducible verbatim with every test green,
  // because the unit test pinned `stillOverWindow` while nothing pinned that main() actually used it.
  // Shape: a diff large enough to floor the budget, plus a context the ladder CAN shrink, so `fitted`
  // becomes true against the floored target while the payload still exceeds the usable window.
  const d = mkdtempSync(join(tmpdir(), "cw-clamped-"));
  const sys = join(d, "brief.md"); writeFileSync(sys, "B\n");
  const ctx = join(d, "c.js");
  writeFileSync(ctx, Array.from({ length: 1200 }, (_, i) => `const v${i} = ${i}; // ${"z".repeat(40)}`).join("\n"));
  const hunks = ["--- a/c.js", "+++ b/c.js", "@@ -3,1 +3,2 @@", "+  use(v2);"];
  for (let k = 0; k < 400; k++) hunks.push(`+// pad ${"w".repeat(24)}`);
  const diff = join(d, "d.diff");
  writeFileSync(diff, hunks.join("\n") + "\n");
  const diffText = hunks.join("\n") + "\n";
  assert.equal(trimTargetClamped(4000, diffText), true, "fixture precondition: the budget must be floored");

  const bf = join(d, "b.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "openai", model: "p", host: "https://h/v1", context_window: 4000 },
    { provider: "openai", model: "fb", host: "https://h2/v1" },
  ]));
  const r = await runMain(["--backends-json", bf, "--system", sys, "--diff", diff, "--context", ctx],
    async () => ({ status: "ok", content: "### observation: no findings" }));

  const line = r.err.split("\n").find((l) => l.includes("window-targeted trim"));
  assert.ok(line, `the trim must fire on this fixture: ${r.err}`);
  assert.match(line, /clamped to floor/, "the note must disclose that the target is a floor, not a window budget");
  assert.match(line, /STILL OVER the usable window/,
    "and must not report a fit merely because a FLOORED target was hit — that was the round-4 bug");
});

test("the window-targeted trim starts from the RAW context, never the already-trimmed set", async () => {
  // Passing the default-trimmed `contextFiles` instead of `contextFilesRaw` double-trims: harmless when
  // the 48KB gate did not fire (the two are identical), but on a large context it silently produces a
  // different payload. denseFixture is ~240KB raw, so the gate DOES fire and the two diverge.
  const f = denseFixture();
  const bf = join(f.dir, "b.json");
  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "primary", host: "https://h/v1", context_window: 15000 }]));
  let sent = null;
  await runMain(["--backends-json", bf, "--system", f.sys, "--diff", f.diff, "--context", f.ctx],
    async ({ system }) => { sent = system; return { status: "ok", content: "### observation: no findings" }; });

  const raw = [{ path: f.ctx, text: readFileSync(f.ctx, "utf8") }];
  const diffText = readFileSync(f.diff, "utf8");
  const expected = tightenToTarget({ contextFiles: raw, diff: diffText, targetBytes: trimTargetBytes(15000, diffText) });
  assert.equal(sent, expected.prefix, "the sent prefix must be the ladder's output over the RAW context");
});

test("the per-backend guard uses the USABLE window, not the raw declared one", async () => {
  // A payload between floor(W * 0.9) and W must be skipped: that headroom is the whole point of the
  // safety fraction, and comparing against the raw window silently spends it.
  const chain = [{ provider: "openai", model: "tight", host: "https://h/v1", contextWindow: 1000 },
                 { provider: "openai", model: "fb", host: "https://h2/v1" }];
  // ~950 tokens: inside the raw 1000 window, outside the 900 usable one.
  const called = [];
  const res = await runReviewChain(chain, {
    system: "x".repeat(2850), user: "",
    runReviewFn: async ({ model }) => { called.push(model); return { status: "ok", content: "### observation: no findings" }; },
    log: () => {},
  });
  assert.ok(estimateTokens("x".repeat(2850)) > 900 && estimateTokens("x".repeat(2850)) <= 1000,
    "fixture precondition: the payload must sit between usable and raw");
  assert.deepEqual(called, ["fb"], "the tight backend must be skipped on the USABLE window");
  assert.equal(res.exit, EXIT.OK);
});

test("tightenToTarget tracks the minimum on PREFIX bytes, as its comment says", () => {
  // Tracking the min on contextBytes instead survives every other test, because the diff is constant
  // across rungs and the two orderings coincide. Assert the returned field explicitly so the comment
  // and the code cannot drift apart unnoticed.
  const { contextFiles, diff } = nonMonotonicFixture();
  const r = tightenToTarget({ contextFiles, diff, targetBytes: 1 });
  assert.equal(r.fitted, false);
  assert.equal(r.bytes, B(r.prefix), "`bytes` is the assembled PREFIX size, which is what gets sent");
  assert.equal(r.contextBytes, r.bytes - B(diff), "`contextBytes` is prefix minus diff, what the budget covers");
  // NOTE: tracking the min on contextBytes instead of bytes is an EQUIVALENT mutation, not a gap. The
  // diff is constant across rungs, so bytes and contextBytes differ by a constant and the argmin is
  // identical. Recorded so nobody spends effort trying to kill an unkillable mutant.
});

test("`fitted` is not a safe proxy for fitting the window, in EITHER regime", () => {
  // The justification for stillOverWindow existing separately, demonstrated rather than asserted.
  //
  // I first believed the two coincided whenever the target was unclamped, on the algebra
  //   fitted ⇒ prefixBytes <= usableBytes - reserveBytes ⇒ est + reserve <= usable.
  // That is wrong: estimateTokens CEILINGS, so the division loses up to a token and a maximally-fitted
  // payload can land a token over. This test is what caught it. So `fitted` is unsafe in both regimes:
  // by a rounding edge when unclamped, and structurally when clamped (a floored target bears no
  // relation to the window at all).
  const over = (w, diffBytes) => {
    const diff = "d".repeat(diffBytes);
    const target = trimTargetBytes(w, diff);
    const est = Math.ceil((target + diffBytes) / DEFAULT_BYTES_PER_TOKEN);   // a maximally-fitted payload
    return stillOverWindow(est, DEFAULT_BRIEF_RESERVE_TOKENS, Math.floor(w * DEFAULT_WINDOW_SAFETY));
  };

  // unclamped, yet fitted-and-over by the ceiling
  assert.equal(trimTargetClamped(65536, ""), false, "precondition: unclamped");
  assert.equal(over(65536, 0), true, "a maximally-fitted payload can still exceed the window by rounding");

  // clamped: the target is a floor, so hitting it says nothing about the window at all
  const bigDiff = 40000;
  assert.equal(trimTargetClamped(4000, "d".repeat(bigDiff)), true, "precondition: clamped");
  assert.equal(over(4000, bigDiff), true, "and here it is over by a wide margin, not a rounding edge");

  // the honest direction: a comfortably-sized payload is correctly reported as fitting
  assert.equal(stillOverWindow(100, DEFAULT_BRIEF_RESERVE_TOKENS, Math.floor(131072 * DEFAULT_WINDOW_SAFETY)), false);
});
