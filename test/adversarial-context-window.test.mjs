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
  tightenToTarget, primarySkipRecord, assembleUserMessage, runReviewChain, main,
  PRIMARY_SKIP_SIGNAL, DEFAULT_BYTES_PER_TOKEN, DEFAULT_WINDOW_SAFETY,
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
  const w = 1000;
  const usable = Math.floor(w * DEFAULT_WINDOW_SAFETY); // 900
  assert.equal(fitsWindow(usable - 1, w), true);
  assert.equal(fitsWindow(usable, w), true, "exactly on the boundary fits");
  assert.equal(fitsWindow(usable + 1, w), false);
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
  assert.equal(trimTargetBytes(1, "d".repeat(100000)), MIN_TRIM_TARGET_BYTES);
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
  writeFileSync(bf, JSON.stringify([{ provider: "openai", model: "primary", host: "https://h/v1", context_window: 15000 }]));

  const prefixes = [];
  for (const brief of ["architectural lens brief", "infosec lens brief " + "x".repeat(4000), "QA", "methodology " + "y".repeat(1500)]) {
    const sysFile = join(f.dir, `b-${prefixes.length}.md`);
    writeFileSync(sysFile, brief);
    await runMain(["--backends-json", bf, "--system", sysFile, "--diff", f.diff, "--context", f.ctx],
      async ({ system }) => { prefixes.push(system); return { status: "ok", content: "### observation: no findings" }; });
  }
  assert.equal(prefixes.length, 4);
  for (let i = 1; i < 4; i++) {
    assert.equal(prefixes[i], prefixes[0],
      "the shared prefix must not vary with the lens brief — a per-lens prefix kills the FAFF-903 cache");
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
