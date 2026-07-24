// FAFF-36 — `faff budget check`: run cost / compute budgeting. Generalises
// beep-boop's --until/--max into one BudgetEnvelope across four dimensions
// (until·max_attempts·tokens·cost) with three at-ceiling outcomes
// (stop|narrow|escalate). PURE — zero tracker/network calls (parity with
// eligible/next/intakecheck): tokens summed from the $CLAUDE_CODE_SESSION_ID
// transcript + child agent-*.jsonl in the run window, baselined at run start;
// estimate fallback when no transcript. Drives the real entrypoint end-to-end
// (like contain.test.mjs / intakecheck.test.mjs) over filesystem fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readGovernanceConfig, computeBudgetState, envelopeFrom } from "../plugin/skills/faff/bin/lib/budget.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    // Start from a clean env so an inherited CLAUDE_CODE_SESSION_ID can't leak in.
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// Build a throwaway repo + run-dir fixture. Returns { root, runDir, cleanup }.
function fixture({ rc, ledger }) {
  const root = mkdtempSync(join(tmpdir(), "faff-budget-"));
  const runDir = join(root, ".faff", "runs", "run-test");
  mkdirSync(runDir, { recursive: true });
  if (rc != null) writeFileSync(join(root, ".faffrc.yaml"), rc);
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  return { root, runDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Write a transcript project dir under a fake $CLAUDE_CONFIG_DIR for the given cwd.
// Each file's value is either an array of usage objects (records stamped with the
// run `sid` as their top-level sessionId — the common case), or an object
// { sessionId, usage } to stamp a different owning session (or sessionId:null to
// emit no sessionId field at all — the unattributable/legacy case). FAFF-229: the
// sessionId stamp is what budget attribution now keys off, so the helper must set it.
function withTranscripts(root, cwd, sid, files) {
  const enc = String(cwd).replace(/\//g, "-");
  const projdir = join(root, "cfg", "projects", enc);
  mkdirSync(projdir, { recursive: true });
  for (const [name, spec] of Object.entries(files)) {
    const usages = Array.isArray(spec) ? spec : spec.usage;
    const owner = Array.isArray(spec) ? sid : spec.sessionId; // null ⇒ omit sessionId
    const lines = usages.map((u) => {
      const rec = { type: "assistant", message: { usage: u } };
      if (owner != null) rec.sessionId = owner;
      return JSON.stringify(rec);
    });
    writeFileSync(join(projdir, name), lines.join("\n"));
  }
  return join(root, "cfg");
}

const baseLedger = (over = {}) => ({
  run_id: "run-test", admitted: ["X-1"], outcomes: { "X-1": "shipped" },
  owner: { status: "running", started_at: "2026-06-23T15:00:00Z" },
  ...over,
});

test("budget --selftest passes (the envelope/until/state/attempts table)", () => {
  const r = run(["budget", "--selftest"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RESULT: PASS/);
});

test("usage: a non-check subcommand exits 2", () => {
  const r = run(["budget", "wat"]);
  assert.equal(r.code, 2);
});

test("INTEGRATION SMOKE: max_attempts=1, one dispatched → breached={max_attempts}, outcome=stop", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n  at_ceiling: stop\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.deepEqual(s.breached, ["max_attempts"]);
    assert.equal(s.outcome, "stop");
    assert.equal(s.spent.attempts, 1);
  } finally { f.cleanup(); }
});

test("--max flag overrides config and lifts the ceiling (no breach)", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--max", "5"]);
    const s = JSON.parse(r.out);
    assert.deepEqual(s.breached, []);
    assert.equal(s.outcome, "none");
  } finally { f.cleanup(); }
});

test("no transcript → estimate fallback, tokens_source=estimate, labelled figure", () => {
  const f = fixture({ rc: "budget:\n  tokens: 100000\n", ledger: baseLedger() });
  try {
    // No CLAUDE_CODE_SESSION_ID in env → estimate path.
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.equal(typeof s.spent.tokens, "number");
  } finally { f.cleanup(); }
});

test("transcript path: orchestrator + child agent files summed, baselined at run start, source=transcript", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 50000\n  at_ceiling: escalate\n",
    ledger: baseLedger({ budget: { tokens_at_start: 1500 } }),
  });
  try {
    const sid = "sess-abc";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { input_tokens: 1000, output_tokens: 500 },
        { input_tokens: 2000, output_tokens: 1000 },
      ],
      "agent-graft.jsonl": [{ input_tokens: 50000, output_tokens: 10000 }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    // total 64500 - baseline 1500 = 63000 → breaches 50000 → escalate
    assert.equal(s.spent.tokens, 63000);
    assert.deepEqual(s.breached, ["tokens"]);
    assert.equal(s.outcome, "escalate");
  } finally { f.cleanup(); }
});

test("child agent files OUTSIDE the run window are not counted (mtime < run start)", () => {
  // run start is far in the future of file mtimes (files written now), so a run
  // started in 2099 excludes the just-written agent file from the window.
  const f = fixture({
    rc: "budget:\n  tokens: 1\n",
    ledger: baseLedger({ owner: { status: "running", started_at: "2099-01-01T00:00:00Z" }, budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-future";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 10, output_tokens: 5 }],
      "agent-old.jsonl": [{ input_tokens: 999999, output_tokens: 0 }], // mtime now < 2099 start → excluded
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    // only the orchestrator session file (15 tokens) counts; the child is windowed out.
    assert.equal(s.spent.tokens, 15);
  } finally { f.cleanup(); }
});

// FAFF-229: child attribution is by owning sessionId, not bare mtime.

test("FAFF-229: same-session child (this run's sessionId) IS included", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-mine";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 100, output_tokens: 0 }],          // sessionId=sid (orchestrator)
      "agent-mine.jsonl": [{ input_tokens: 5000, output_tokens: 0 }],       // sessionId=sid → counted
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 5100); // orchestrator 100 + same-session child 5000
  } finally { f.cleanup(); }
});

test("FAFF-229: foreign-session child with in-window mtime is EXCLUDED (over-count bug fixed)", () => {
  // The foreign child is written now (mtime AFTER the 2026-06-23 run start), so the
  // mtime pre-filter alone would sweep it in — the attribution gate must keep it out.
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-mine";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 100, output_tokens: 0 }],               // this run
      "agent-mine.jsonl": [{ input_tokens: 5000, output_tokens: 0 }],            // sessionId=sid → counted
      "agent-foreign.jsonl": { sessionId: "sess-other", usage: [{ input_tokens: 7777777, output_tokens: 0 }] }, // foreign → excluded
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 5100); // foreign child's 7,777,777 is NOT swept in
  } finally { f.cleanup(); }
});

test("FAFF-229: in-window child with NO sessionId is EXCLUDED and does not crash (undercount)", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-mine";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 100, output_tokens: 0 }],
      "agent-nosession.jsonl": { sessionId: null, usage: [{ input_tokens: 4242, output_tokens: 0 }] }, // unattributable → excluded
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err); // no crash
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 100); // only the orchestrator file; unattributable child excluded
  } finally { f.cleanup(); }
});

test("PURE: runs fully offline (no network env) and reads no tracker", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n", ledger: baseLedger() });
  try {
    // env-i style: only HOME + PATH; no proxy, no tokens, no MCP — must still succeed.
    const r = spawnSync("node", [CLI, "budget", "check", "--run-dir", f.runDir, "--root", f.root], {
      encoding: "utf8", env: { HOME: process.env.HOME, PATH: process.env.PATH },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /"breached":\["max_attempts"\]/);
  } finally { f.cleanup(); }
});

test("cost dimension: an unconfigured price_per_mtok computes cost from the map and can breach", () => {
  const f = fixture({
    rc: "budget:\n  cost: 0.2\n  at_ceiling: stop\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-cost";
    // claude-opus-4-8: input $5/MTok. 50,000 input tokens → $0.25 ≥ $0.2.
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 50000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.ok(Math.abs(s.spent.cost - 0.25) < 1e-9, `spent.cost=${s.spent.cost}`);
    assert.deepEqual(s.breached, ["cost"]);
  } finally { f.cleanup(); }
});

test("FAFF-446: budget.price_per_mtok in FRESH config is REMOVED — ignored (cost still prices from the map), named in a warning, never a hard exit", () => {
  const f = fixture({
    rc: "budget:\n  cost: 4\n  price_per_mtok: 100\n  at_ceiling: stop\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-cost-removed";
    // claude-opus-4-8: input $5/MTok. 50,000 input tokens → $0.25 (map-priced) — NOT
    // 50000 × 100/1e6 = $5, the figure the removed flat scalar would have produced
    // (and which would have breached the $4 ceiling; the map-priced figure does not).
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 50000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.ok(Math.abs(s.spent.cost - 0.25) < 1e-9, `map-priced, not the removed flat scalar: spent.cost=${s.spent.cost}`);
    assert.deepEqual(s.breached, [], "the removed scalar's $5 figure would have breached $4 — the map-priced $0.25 must not");
    assert.ok(Array.isArray(s.warnings) && s.warnings.some((w) => /removed/.test(w) && /price_per_mtok_by_model/.test(w) && /100/.test(w)),
      `expected a removed-knob warning naming the ignored value: ${JSON.stringify(s.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-446: budget.price_per_mtok: 0 (explicit no-op) never fires the removed-knob warning", () => {
  const f = fixture({
    rc: "budget:\n  cost: 4\n  price_per_mtok: 0\n  at_ceiling: stop\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-cost-zero";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 1000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.ok(!(Array.isArray(s.warnings) && s.warnings.some((w) => /removed/.test(w))),
      `price_per_mtok:0 must not trigger the removed-knob warning: ${JSON.stringify(s.warnings)}`);
  } finally { f.cleanup(); }
});

test("unset dimensions are unbounded → never breach (empty budget block)", () => {
  const f = fixture({ rc: "appetite: high\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    const s = JSON.parse(r.out);
    assert.deepEqual(s.breached, []);
    assert.equal(s.outcome, "none");
    assert.ok(!("warnings" in s), "no warnings key on a clean envelope — byte-identical to before FAFF-364");
  } finally { f.cleanup(); }
});

// FAFF-364 — a malformed budget.until degrades to a WARNING, never a hard exit: a
// non-zero exit here would fail-OPEN the whole budget signal for
// sentryReadBudget/run-done --budget (which degrade any non-zero child to the
// unbreached default), masking a real live tokens/cost breach.
test("FAFF-364: malformed budget.until → exit 0, warnings names the raw value, breached excludes until", () => {
  const f = fixture({ rc: "budget:\n  until: \"25:00\"\n  max_attempts: 5\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.ok(Array.isArray(s.warnings) && s.warnings.length === 1, "warnings carries exactly one entry");
    assert.match(s.warnings[0], /25:00/);
    assert.match(s.warnings[0], /until ceiling ignored/);
    assert.ok(!s.breached.includes("until"), "breached never contains until for a malformed value");
    assert.match(r.err, /faff budget check: budget\.until '25:00' is not a valid HH:MM/, "mirrors to stderr, prefixed");
  } finally { f.cleanup(); }
});

// FAFF-364 — a malformed --until flag (overriding a clean config value) is classified
// identically to a malformed config value — the flag-over-config precedence is
// unchanged, only the WINNING raw value is validated.
test("FAFF-364: malformed --until flag warns; a well-formed config value it overrides is not consulted", () => {
  const f = fixture({ rc: "budget:\n  until: \"06:00\"\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--until", "not-a-time"]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.match(s.warnings[0], /not-a-time/);
    assert.ok(!s.breached.includes("until"));
  } finally { f.cleanup(); }
});

// FAFF-364 — a well-formed --until flag proceeds clean: no warnings key at all.
test("FAFF-364: well-formed --until flag → clean, no warnings key", () => {
  const f = fixture({ rc: "budget:\n  until: \"25:00\"\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--until", "06:00"]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.ok(!("warnings" in s), "the flag's clean value wins; no warning surfaces");
  } finally { f.cleanup(); }
});

// FAFF-364 — a legacy ledger-recorded envelope carrying malformed until garbage
// (minted before this validation existed) surfaces until_invalid on READ too, via
// envelopeFromLedger.
test("FAFF-364: a ledger recording a legacy malformed until surfaces the warning on read", () => {
  const f = fixture({
    rc: "",
    ledger: baseLedger({ budget: { envelope: { ceilings: { until: "garbage", max_attempts: null, tokens: null, cost: null }, at_ceiling: "stop", price_per_mtok: 0 } } }),
  });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.match(s.warnings[0], /garbage/);
    assert.ok(!s.breached.includes("until"));
  } finally { f.cleanup(); }
});

// FAFF-364 (adversarial-review follow-up) — a ledger recording `until_invalid`
// DIRECTLY (ceilings.until already null, not raw garbage) round-trips the warning
// too, rather than silently dropping a recorded invalidity that re-derivation from
// a null ceilings.until can't reconstruct on its own.
test("FAFF-364: a ledger recording until_invalid directly (ceilings.until already null) round-trips the warning", () => {
  const f = fixture({
    rc: "",
    ledger: baseLedger({
      budget: {
        envelope: {
          ceilings: { until: null, max_attempts: null, tokens: null, cost: null },
          until_invalid: "recorded-garbage",
          at_ceiling: "stop",
          price_per_mtok: 0,
        },
      },
    }),
  });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.match(s.warnings[0], /recorded-garbage/);
    assert.ok(!s.breached.includes("until"));
  } finally { f.cleanup(); }
});

// FAFF-364 — a --until flag override still wins even when the ledger recorded an
// until_invalid: the flag's own resolution is authoritative, the recorded
// until_invalid must NOT leak through when a fresh flag is in play.
test("FAFF-364: a --until flag overriding a ledger with a recorded until_invalid is authoritative (no leak-through)", () => {
  const f = fixture({
    rc: "",
    ledger: baseLedger({
      budget: {
        envelope: {
          ceilings: { until: null, max_attempts: null, tokens: null, cost: null },
          until_invalid: "recorded-garbage",
          at_ceiling: "stop",
          price_per_mtok: 0,
        },
      },
    }),
  });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--until", "06:00"]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.ok(!("warnings" in s), "the flag's clean value wins; the ledger's recorded until_invalid must not leak through");
  } finally { f.cleanup(); }
});

// FAFF-302: hermetic, explicit-flag-only clock seam (--now-ms / --now), the twin of
// the FAFF-301 sentry seam. baseLedger's `started_at` is a fixed absolute instant
// (2026-06-23T15:00:00Z) evaluated against `Date.now()`, so before the seam the
// time-derived fields (spent.elapsed_ms) drifted with the time of day the suite ran
// at — the same flake class FAFF-301 removed from sentry. Pinning `now` makes them
// deterministic at any wall-clock time.

const BUDGET_START_MS = Date.parse("2026-06-23T15:00:00Z"); // baseLedger.owner.started_at
const HOUR = 3_600_000;

test("FAFF-302: verdict + time-derived fields are invariant across pinned late-day clocks (+6h / +21h) and repeat runs", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n  at_ceiling: stop\n", ledger: baseLedger() });
  try {
    // Each pinned clock is a separate `now`; the VERDICT (breached/outcome) must be
    // identical at every time of day, and each field deterministic on repeat runs.
    for (const offset of [6 * HOUR, 21 * HOUR]) {
      const now = String(BUDGET_START_MS + offset);
      const first = JSON.parse(run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", now]).out);
      // Verdict is clock-independent (config-and-ledger driven).
      assert.deepEqual(first.breached, ["max_attempts"], `breached invariant at +${offset / HOUR}h`);
      assert.equal(first.outcome, "stop", `outcome invariant at +${offset / HOUR}h`);
      // The time-derived field is pinned exactly to the injected clock (elapsed = offset).
      assert.equal(first.spent.elapsed_ms, offset, `elapsed_ms pinned at +${offset / HOUR}h`);
      // Repeat run at the SAME pinned clock is byte-identical — no time-of-day drift.
      const second = JSON.parse(run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", now]).out);
      assert.deepEqual(second, first, `repeat run identical at +${offset / HOUR}h`);
    }
  } finally { f.cleanup(); }
});

test("FAFF-302: --now-ms > --now precedence; --now ISO also pins the clock", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n", ledger: baseLedger() });
  try {
    const iso = "2026-06-23T21:00:00Z"; // +6h from start
    const byIso = JSON.parse(run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now", iso]).out);
    assert.equal(byIso.spent.elapsed_ms, 6 * HOUR);
    // --now-ms takes precedence over a conflicting --now.
    const ms = String(BUDGET_START_MS + 21 * HOUR);
    const both = JSON.parse(run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", ms, "--now", iso]).out);
    assert.equal(both.spent.elapsed_ms, 21 * HOUR);
  } finally { f.cleanup(); }
});

test("FAFF-302: an unparseable injected clock exits 2 with a stderr reason (never a silent Date.now() fall-through)", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n", ledger: baseLedger() });
  try {
    const bad = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", "nope"]);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /--now-ms 'nope' is not a finite/);
    const badIso = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now", "not-a-date"]);
    assert.equal(badIso.code, 2);
    assert.match(badIso.err, /--now 'not-a-date' is not a parseable/);
  } finally { f.cleanup(); }
});

// FAFF-425 — the run's own inability to read its ledger is a loud, distinct
// "indeterminate" fault (exit 3), never silently coerced into the all-clear
// outcome:"none" reading a swallowed exception used to produce.

test("FAFF-425: own-fault — a present-but-corrupt ledger at the resolved run dir → exit 3, indeterminate JSON naming the ledger path", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n", ledger: baseLedger() });
  try {
    writeFileSync(join(f.runDir, "run-ledger.json"), "{ not json");
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 3, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.outcome, "indeterminate");
    assert.equal(s.indeterminate, true);
    assert.match(s.reason, /ledger unreadable/);
    assert.match(s.reason, /run-ledger\.json/);
    assert.deepEqual(s.spent, { elapsed_ms: null, attempts: 0, tokens: 0, cost: null });
    assert.equal(s.tokens_source, null);
    assert.deepEqual(s.breached, []);
  } finally { f.cleanup(); }
});

test("FAFF-425: own-fault — an explicit --run-dir naming an absent ledger → exit 3, indeterminate, NEVER falls back to latestRunDir", () => {
  const f = fixture({ rc: "budget:\n  max_attempts: 1\n", ledger: baseLedger() });
  try {
    // A real, healthy run exists as `latest` — proving the resolver does not
    // quietly fall back to it when the EXPLICIT --run-dir's ledger is missing.
    const missing = join(f.root, ".faff", "runs", "does-not-exist");
    const r = run(["budget", "check", "--run-dir", missing, "--root", f.root]);
    assert.equal(r.code, 3, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.outcome, "indeterminate");
    assert.equal(s.indeterminate, true);
    assert.match(s.reason, /explicit run named but its ledger is absent/);
    assert.match(s.reason, /does-not-exist/);
  } finally { f.cleanup(); }
});

test("FAFF-425: legitimately empty — no run at all under the root → exit 0, all-clear, byte-identical outcome:none (not a fault)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-budget-empty-"));
  try {
    const r = run(["budget", "check", "--root", root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.outcome, "none");
    assert.ok(!("indeterminate" in s), "empty is not a fault — no indeterminate key");
    assert.ok(!("reason" in s), "empty is not a fault — no reason key");
    assert.deepEqual(s.breached, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-302: production default unchanged — no clock flag uses real Date.now() (elapsed_ms tracks the wall clock)", () => {
  // started_at is ~now, so real elapsed is a small non-negative number near 0 — the
  // unpinned production path is untouched by the seam.
  const f = fixture({ rc: "budget:\n  max_attempts: 5\n", ledger: baseLedger({ owner: { status: "running", started_at: new Date().toISOString() } }) });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    const s = JSON.parse(r.out);
    assert.equal(typeof s.spent.elapsed_ms, "number");
    assert.ok(s.spent.elapsed_ms >= 0 && s.spent.elapsed_ms < 60_000, `real-clock elapsed_ms in range: ${s.spent.elapsed_ms}`);
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-427: the ADR-0048 per-model x per-class price map wired into
// `budget.cost`. `withModelTranscripts` mirrors `withTranscripts` above but
// stamps a `message.model` on each usage record — the map-pricing rule prices
// per model, so these fixtures need a model id, unlike the class-only fixtures.
// ===========================================================================
function withModelTranscripts(root, cwd, sid, files) {
  const enc = String(cwd).replace(/\//g, "-");
  const projdir = join(root, "cfg", "projects", enc);
  mkdirSync(projdir, { recursive: true });
  for (const [name, entries] of Object.entries(files)) {
    // entries: [{ model, usage }] — sessionId defaults to `sid` (the owned case).
    const lines = entries.map((e) => JSON.stringify({
      sessionId: sid, message: { model: e.model, usage: e.usage },
    }));
    writeFileSync(join(projdir, name), lines.join("\n"));
  }
  return join(root, "cfg");
}

test("FAFF-427: budget.cost with NO price_per_mtok configured (map pricing default) breaches at the map-priced blended dollar figure", () => {
  // Scenario 1 from the spec: budget.cost set, price_per_mtok NOT set.
  const f = fixture({
    rc: "budget:\n  cost: 0.01\n  at_ceiling: stop\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-map-cost";
    // claude-opus-4-8: cache_read $0.5/MTok. 50,000 cache_read tokens → $0.025 ≥ $0.01.
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { cache_read_input_tokens: 50000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.deepEqual(s.breached, ["cost"]);
    assert.ok(Math.abs(s.spent.cost - 0.025) < 1e-9, `spent.cost=${s.spent.cost}`);
  } finally { f.cleanup(); }
});

test("FAFF-446: a LEGACY ledger already recording pricing:'flat' keeps its byte-for-byte flat-scalar cost — an in-flight run's ceiling never silently changes mid-run", () => {
  // Simulates a ledger minted by the pre-FAFF-446 binary (pricing:"flat" recorded
  // at mint time, from a `.faffrc.yaml` that then set price_per_mtok:100). The LIVE
  // config below has since had price_per_mtok removed (unset) — proving the
  // ledger's own recorded pricing governs, not the live config.
  const f = fixture({
    rc: "budget:\n  cost: 4\n  at_ceiling: stop\n",
    ledger: baseLedger({
      budget: {
        tokens_at_start: 0,
        envelope: {
          ceilings: { until: null, max_attempts: null, tokens: null, cost: 4 },
          at_ceiling: "stop", price_per_mtok: 100, pricing: "flat",
        },
      },
    }),
  });
  try {
    const sid = "sess-legacy-flat";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 50000 } }], // 50k × 100/Mtok = $5, NOT the map's $0.25
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.spent.cost, 5, "the ledger's own recorded flat pricing governs, byte-for-byte, regardless of the live config");
    assert.deepEqual(s.breached, ["cost"]);
    assert.ok(Array.isArray(s.warnings) && s.warnings.some((w) => /deprecated/.test(w) && /price_per_mtok_by_model/.test(w)),
      `expected the legacy flat-pricing deprecation warning: ${JSON.stringify(s.warnings)}`);
    assert.ok(!s.warnings.some((w) => /removed \(FAFF-446\)/.test(w)),
      `the live config no longer sets price_per_mtok, so the removed-knob warning must not fire: ${JSON.stringify(s.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-446: lights-out --check refuses when budget.price_per_mtok is still configured (mint-time hard-refuse — no fail-open risk)", () => {
  const f = fixture({
    rc: "budget:\n  cost: 4\n  price_per_mtok: 100\n  at_ceiling: stop\n",
    ledger: baseLedger(),
  });
  try {
    const r = run(["lights-out", "--check", "--root", f.root, "--json"]);
    const out = JSON.parse(r.out);
    assert.equal(out.proceed, false);
    assert.ok(out.refusals.some((x) => x.gate === "budget-price-per-mtok-removed" && /100/.test(x.detail)),
      `expected a budget-price-per-mtok-removed refusal naming the raw value: ${JSON.stringify(out.refusals)}`);
  } finally { f.cleanup(); }
});

test("FAFF-427: a model absent from the resolved map prices at the costliest known per-class rate and is named in a warning", () => {
  const f = fixture({
    rc: "budget:\n  cost: 0.000001\n  at_ceiling: escalate\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-unpriced";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "some-unknown-model-xyz", usage: { input_tokens: 1000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    // priced at the conservative (costliest) row — input $10/Mtok (claude-fable-5) — never $0.
    assert.ok(Math.abs(s.spent.cost - (1000 / 1e6) * 10) < 1e-9, `spent.cost=${s.spent.cost}`);
    assert.deepEqual(s.breached, ["cost"]);
    assert.ok(s.warnings.some((w) => /unpriced/.test(w) && /some-unknown-model-xyz/.test(w)),
      `expected an unpriced-model warning naming it: ${JSON.stringify(s.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-427: estimate-only (no transcript) + map pricing + a configured cost ceiling → cost null, loud warning (never a silent flat-scalar estimate)", () => {
  const f = fixture({ rc: "budget:\n  cost: 1\n", ledger: baseLedger({ budget: { tokens_at_start: 0 } }) });
  try {
    // No CLAUDE_CODE_SESSION_ID → estimate path, no per-model data.
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.equal(s.spent.cost, null);
    assert.deepEqual(s.breached, [], "a null cost can never breach");
    assert.ok(s.warnings.some((w) => /not meterable from estimates/.test(w)), JSON.stringify(s.warnings));
  } finally { f.cleanup(); }
});

test("FAFF-427: NO cost ceiling configured → map pricing computes cost silently, zero warnings (an unconfigured dimension stays quiet)", () => {
  const f = fixture({ rc: "budget:\n  tokens: 999999999\n", ledger: baseLedger({ budget: { tokens_at_start: 0 } }) });
  try {
    const sid = "sess-quiet";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "some-other-unknown-model", usage: { input_tokens: 1000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.ok(!("warnings" in s), `no budget.cost configured — must stay silent even with an unpriced model: ${JSON.stringify(s)}`);
  } finally { f.cleanup(); }
});

test("FAFF-427: a fresh per-model baseline (tokens_at_start_by_model_class) subtracts cleanly, no pro-rata warning", () => {
  const f = fixture({
    rc: "budget:\n  cost: 0.01\n",
    ledger: baseLedger({
      budget: {
        tokens_at_start: 20000,
        tokens_at_start_by_model_class: { "claude-opus-4-8": { input: 0, output: 0, cache_write: 0, cache_read: 20000 } },
      },
    }),
  });
  try {
    const sid = "sess-baseline";
    // Whole-session cache_read = 70000; baseline 20000 → this-run delta 50000 → $0.025.
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { cache_read_input_tokens: 70000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.ok(Math.abs(s.spent.cost - 0.025) < 1e-9, `spent.cost=${s.spent.cost}`);
    assert.ok(!s.warnings || !s.warnings.some((w) => /pro-rated/.test(w)), "a real baseline must not trigger the pro-rata warning");
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-558 — the `tokens_at_start` scalar baseline MUST survive a mid-run
// transcript compaction. An L4 mint only ever writes the PER-MODEL baseline
// (`tokens_at_start_by_model_class`); the scalar `budget.tokens` ceiling read
// used to default that scalar to 0 whenever it was absent, so a compacted
// whole-session transcript summed unbaselined and could false-trip a real
// ceiling. The fix derives the scalar from the per-model map unconditionally.
// ===========================================================================

test("FAFF-558: per-model baseline present, scalar ABSENT, whole-session sum crosses the ceiling but the derived this-run delta does not → breached:[] (no false trip)", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 60000\n  at_ceiling: escalate\n",
    ledger: baseLedger({
      // Only the per-model map is present — no scalar tokens_at_start at all,
      // exactly the shape an L4 mint writes. Baseline totals 390000.
      budget: { tokens_at_start_by_model_class: { "claude-opus-4-8": { input: 0, output: 0, cache_write: 0, cache_read: 390000 } } },
    }),
  });
  try {
    const sid = "sess-compacted";
    // Simulates a compacted whole-session transcript: 400000 tokens total, FAR
    // above the 60000 ceiling — but the this-run delta (400000-390000=10000) is
    // comfortably under it.
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { cache_read_input_tokens: 400000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 10000, `this-run delta should derive from the per-model baseline, got ${s.spent.tokens}`);
    assert.deepEqual(s.breached, [], "the derived scalar baseline must be subtracted — no false breached:[\"tokens\"]");
  } finally { f.cleanup(); }
});

test("FAFF-558: an explicit scalar tokens_at_start (no per-model map) is honoured verbatim — byte-for-byte today's behaviour", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 100000\n  at_ceiling: escalate\n",
    ledger: baseLedger({ budget: { tokens_at_start: 100 } }),
  });
  try {
    const sid = "sess-scalar-only";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 50000, output_tokens: 0 }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.spent.tokens, 49900, "50000 - explicit scalar 100 = 49900");
  } finally { f.cleanup(); }
});

test("FAFF-558: NEITHER tokens_at_start nor tokens_at_start_by_model_class present → baseline 0, spend equals the whole-session sum (byte-for-byte today)", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 100000\n  at_ceiling: escalate\n",
    ledger: baseLedger(), // no budget block at all
  });
  try {
    const sid = "sess-no-baseline";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 12345, output_tokens: 0 }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.spent.tokens, 12345);
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-558 — `faff budget baseline`: the deterministic write-once subcommand
// that replaces the fragile prose baseline hand-write. Fresh write populates
// both fields; a second invocation after the transcript GREW is a strict
// no-op (the compaction-safety guard); no transcript degrades honestly;
// an unresolvable run-dir is a usage error.
// ===========================================================================

test("FAFF-558: `budget wat` (unknown non-check, non-baseline sub) still exits 2 — the new branch only intercepts `baseline`", () => {
  const r = run(["budget", "wat"]);
  assert.equal(r.code, 2);
});

test("FAFF-558: `budget baseline` fresh write populates BOTH tokens_at_start_by_model_class and tokens_at_start; exit 0, reason:fresh", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    const sid = "sess-baseline-fresh";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 5000, cache_read_input_tokens: 2000 } }],
    });
    const r = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.baseline_written, true);
    assert.equal(out.reason, "fresh");
    assert.equal(out.tokens_at_start, 7000);

    // FAFF-552: the baseline TRIPLE — measure_session_id is persisted alongside.
    assert.equal(out.measure_session_id, sid);

    const persisted = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(persisted.budget.tokens_at_start, 7000);
    assert.deepEqual(persisted.budget.tokens_at_start_by_model_class, { "claude-opus-4-8": { input: 5000, output: 0, cache_write: 0, cache_read: 2000 } });
    assert.equal(persisted.budget.measure_session_id, sid, "FAFF-552: the effective measuring session must be persisted");
  } finally { f.cleanup(); }
});

test("FAFF-558: `budget baseline` is WRITE-ONCE — a second invocation after the transcript GREW does not re-snapshot (the compaction-safety guard)", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    const sid = "sess-baseline-once";
    let cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 1000 } }],
    });
    const r1 = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r1.code, 0, r1.err);
    const out1 = JSON.parse(r1.out);
    assert.equal(out1.baseline_written, true);
    assert.equal(out1.tokens_at_start, 1000);

    // The transcript GREW (simulating continued spend / a compaction event).
    cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 999999999 } }],
    });
    const r2 = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r2.code, 0, r2.err);
    const out2 = JSON.parse(r2.out);
    assert.equal(out2.baseline_written, false);
    assert.equal(out2.reason, "already-set");

    const persisted = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(persisted.budget.tokens_at_start, 1000, "the baseline must be UNCHANGED — no re-snapshot against the enlarged transcript");
  } finally { f.cleanup(); }
});

test("FAFF-552: `budget baseline` with no resolvable transcript records the (null) session + a zero baseline (reason:estimate-degraded), exit 0, never a crash", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    // No CLAUDE_CODE_SESSION_ID / transcript directory at all.
    const r = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    // FAFF-552: the field must be PRESENT even when the baseline can't be measured
    // yet, so a later `check` prefers the persisted session over a drifted ambient.
    assert.equal(out.baseline_written, true);
    assert.equal(out.reason, "estimate-degraded");
    assert.equal(out.measure_session_id, null);

    const persisted = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(persisted.budget.measure_session_id, null, "the owning session is recorded (null ⇒ no flag/ambient)");
    assert.deepEqual(persisted.budget.tokens_at_start_by_model_class, {}, "a zero per-model baseline is written");
    assert.equal(persisted.budget.tokens_at_start, 0, "a zero scalar baseline is written");
  } finally { f.cleanup(); }
});

test("FAFF-552: `budget baseline` estimate-degraded with a --session-id records that owning session (write-once on it thereafter)", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    // A real owning session is known at run start but its transcript isn't yet
    // resolvable — the beep-boop path always passes --session-id, so the session
    // must be pinned even here.
    const r = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", "sess-known-owner"]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.baseline_written, true);
    assert.equal(out.reason, "estimate-degraded");
    assert.equal(out.measure_session_id, "sess-known-owner");

    const persisted = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(persisted.budget.measure_session_id, "sess-known-owner");

    // Write-once: a second call is a strict no-op keyed on the persisted session.
    const r2 = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", "sess-known-owner"]);
    assert.equal(r2.code, 0, r2.err);
    assert.equal(JSON.parse(r2.out).reason, "already-set");
  } finally { f.cleanup(); }
});

test("FAFF-558: `budget baseline` with an unresolvable run-dir exits 2 (usage error)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-budget-nobaseline-"));
  try {
    const r = run(["budget", "baseline", "--run-dir", join(root, ".faff", "runs", "does-not-exist"), "--root", root]);
    assert.equal(r.code, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-558: `budget baseline` is deterministic — same transcript state + same owner.started_at → identical baseline across repeated fresh writes", () => {
  const measurements = [];
  for (let i = 0; i < 2; i++) {
    const f = fixture({ rc: null, ledger: baseLedger() });
    try {
      const sid = "sess-baseline-determinism";
      const cfg = withModelTranscripts(f.root, f.root, sid, {
        [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 3000, output_tokens: 700 } }],
      });
      const r = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid],
        { CLAUDE_CONFIG_DIR: cfg });
      assert.equal(r.code, 0, r.err);
      measurements.push(JSON.parse(r.out));
    } finally { f.cleanup(); }
  }
  assert.deepEqual(measurements[0], measurements[1]);
});

// ===========================================================================
// FAFF-552 — `budget baseline` persists the run's OWNING measuring session
// (measure_session_id), the field an L3/prose-minted run previously never
// recorded, so `check`'s owning-session precedence has something to prefer over
// a drifted ambient session after a mid-run compaction. Write-once now keys on
// measure_session_id (the field a stray re-invocation must never reset).
// ===========================================================================

test("FAFF-552: `budget baseline` with NO --session-id captures measure_session_id from the ambient CLAUDE_CODE_SESSION_ID", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    const sid = "sess-ambient-owner";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 4000 } }],
    });
    // No --session-id flag — the ambient session is the effective owning session.
    const r = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.baseline_written, true);
    assert.equal(out.measure_session_id, sid);
    assert.equal(out.tokens_at_start, 4000);

    const persisted = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(persisted.budget.measure_session_id, sid, "the ambient session must be persisted as the owning session");
    assert.equal(persisted.budget.tokens_at_start, 4000);
  } finally { f.cleanup(); }
});

test("FAFF-552: `budget baseline` is write-once on measure_session_id — a ledger already carrying it (even with NO per-model map) is a strict no-op", () => {
  // A ledger that recorded its owning session but no per-model baseline (e.g. a
  // prior estimate-degraded snapshot) must never be re-snapshotted against a
  // now-resolvable, larger transcript — that would re-introduce the over-count.
  const f = fixture({ rc: null, ledger: baseLedger({ budget: { measure_session_id: "sess-owner" } }) });
  try {
    const sid = "sess-owner";
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { input_tokens: 999999999 } }],
    });
    const r = run(["budget", "baseline", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).reason, "already-set");

    const persisted = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(persisted.budget.measure_session_id, "sess-owner");
    assert.equal(persisted.budget.tokens_at_start, undefined, "no baseline may be written over an already-pinned session");
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-428 — the L4 spend governor must be MEASURABLE, not merely configured.
// Mid-run honesty: at L4 (`ledger.level === "L4"`), an estimate-only token figure
// appends an L4-metering-degrade warning — via the existing warnings[] mechanism,
// NEVER the exit code (sentryReadBudget / run-done --budget fail-open on any
// non-zero exit, so a new exit path here would MASK a real breach).
// ===========================================================================

test("FAFF-428: L4 ledger + estimate-only tokens → warnings names the metering degrade, exit 0 unchanged", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 100000\n",
    ledger: baseLedger({ level: "L4" }),
  });
  try {
    // No CLAUDE_CODE_SESSION_ID in env → estimate path (mirrors the existing
    // "no transcript → estimate fallback" test, plus the L4 ledger level).
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.ok(Array.isArray(s.warnings) && s.warnings.some((w) => /L4 budget metering degraded/.test(w)), JSON.stringify(s.warnings));
    assert.ok(s.warnings.some((w) => /under-report/.test(w)));
    assert.match(r.err, /faff budget check: L4 budget metering degraded/, "mirrors to stderr, prefixed");
  } finally { f.cleanup(); }
});

test("FAFF-428: a non-L4 ledger (or no level at all) with estimate-only tokens carries NO metering warning (L1-L3 unchanged)", () => {
  // No `level` field at all — the common case for every ledger prior to this change
  // and every L1-L3 run today.
  const f = fixture({ rc: "budget:\n  tokens: 100000\n", ledger: baseLedger() });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.ok(!("warnings" in s), "no level field at all → byte-identical to before FAFF-428");
  } finally { f.cleanup(); }

  const f2 = fixture({
    rc: "budget:\n  tokens: 100000\n",
    ledger: baseLedger({ level: "L3" }),
  });
  try {
    const r2 = run(["budget", "check", "--run-dir", f2.runDir, "--root", f2.root]);
    const s2 = JSON.parse(r2.out);
    assert.equal(s2.tokens_source, "estimate");
    assert.ok(!("warnings" in s2), "level:L3 with an estimate-only figure carries no L4-specific warning");
  } finally { f2.cleanup(); }
});

test("FAFF-428: an L4 ledger with a MEASURABLE transcript carries no metering warning", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 100000\n",
    ledger: baseLedger({ level: "L4", budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-l4-measurable";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 10, output_tokens: 5 }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.ok(!("warnings" in s), "a measurable L4 run carries no metering-degrade warning");
  } finally { f.cleanup(); }
});

test("FAFF-428: the L4 metering warning COEXISTS with the FAFF-364 until-invalid warning (append-based assembly)", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 100000\n  until: \"25:00\"\n",
    ledger: baseLedger({ level: "L4" }),
  });
  try {
    // No transcript → estimate; AND a malformed until → both warnings must coexist
    // in one array (the append-based assembly this change requires).
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.ok(Array.isArray(s.warnings) && s.warnings.length === 2, JSON.stringify(s.warnings));
    assert.ok(s.warnings.some((w) => /25:00/), "the until-invalid warning is present");
    assert.ok(s.warnings.some((w) => /L4 budget metering degraded/), "the L4 metering warning is present");
  } finally { f.cleanup(); }
});

test("FAFF-427: a pre-change ledger (no per-model baseline) pro-rates the per-model deltas and warns", () => {
  const f = fixture({
    rc: "budget:\n  cost: 0.000001\n",
    ledger: baseLedger({ budget: { tokens_at_start: 50000 } }), // scalar baseline present, NO tokens_at_start_by_model_class
  });
  try {
    const sid = "sess-prorata";
    // whole-session cache_read = 100000; scalar this-run delta = 100000-50000 = 50000 → scale 0.5.
    const cfg = withModelTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ model: "claude-opus-4-8", usage: { cache_read_input_tokens: 100000 } }],
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    // pro-rated delta = 100000 * 0.5 = 50000 cache_read tokens @ $0.5/Mtok = $0.025.
    assert.ok(Math.abs(s.spent.cost - 0.025) < 1e-9, `spent.cost=${s.spent.cost}`);
    assert.ok(s.warnings.some((w) => /pro-rated/.test(w)), JSON.stringify(s.warnings));
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-488 — `--session-id` overlays $CLAUDE_CODE_SESSION_ID in the EFFECTIVE
// env handed to the measure functions (never process.env itself, never written
// into any event/ledger field). Absent ⇒ byte-for-byte the ambient-env path
// above (S4). The key missing coverage: a run whose process cwd is NOT the
// pinned root (the linked-worktree hazard) and whose ambient env carries no
// session id — the exact shape a headless orchestrator turn can hit.
// ===========================================================================

test("S1 (FAFF-488): --session-id resolves the transcript from a mismatched process cwd with no ambient session id; the SAME setup WITHOUT the flag genuinely degrades to estimate", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  // A directory standing in for "a linked worktree" — deliberately NOT f.root, and
  // never passed as --root; the process cwd here must not matter once --root is
  // explicit, but it stands in for the cwd-drift hazard the spec names.
  const worktree = mkdtempSync(join(tmpdir(), "faff-budget-worktree-"));
  try {
    const sid = "sess-cwd-mismatch";
    // The transcript lives under the MAIN checkout's (f.root) project dir.
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 1000, output_tokens: 200 }],
    });
    const spawnEnv = { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg };

    // Sanity / regression proof: WITHOUT --session-id, root is already correct
    // (--root is explicit) but no ambient CLAUDE_CODE_SESSION_ID exists anywhere
    // in this env → the session file can't be selected → estimate. This is the
    // exact degrade this change fixes; asserting it here proves the fixture is
    // load-bearing, not a fake green.
    const before = spawnSync("node", [CLI, "budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { encoding: "utf8", cwd: worktree, env: spawnEnv });
    const beforeState = JSON.parse(before.stdout);
    assert.equal(beforeState.tokens_source, "estimate",
      "without --session-id, no ambient sid resolves the session file → estimate (the pre-fix degrade)");

    // WITH --session-id: the same fixture now resolves to the transcript.
    const after = spawnSync("node", [CLI, "budget", "check", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid],
      { encoding: "utf8", cwd: worktree, env: spawnEnv });
    assert.equal(after.status, 0, after.stderr);
    const afterState = JSON.parse(after.stdout);
    assert.equal(afterState.tokens_source, "transcript");
    assert.equal(typeof afterState.spent.tokens, "number");
    assert.ok(afterState.spent.tokens > 0);
    assert.ok(!("warnings" in afterState), "no estimate-degrade warning once resolved via --session-id");

    // The four-class breakdown backing that scalar total is genuinely available
    // on the pinned path too (--by class, via economics, same root+session).
    const econ = spawnSync("node", [CLI, "economics", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid, "--by", "class", "--json"],
      { encoding: "utf8", cwd: worktree, env: spawnEnv });
    assert.equal(econ.status, 0, econ.stderr);
    const econJson = JSON.parse(econ.stdout);
    assert.equal(econJson.breakdown.source, "transcript");
    assert.deepEqual(econJson.breakdown.rows.map((r) => r.key).sort(), ["cache_read", "cache_write", "input", "output"]);
    for (const row of econJson.breakdown.rows) {
      assert.ok(Number.isInteger(row.total) && row.total >= 0, `row ${row.key} total=${row.total}`);
    }
  } finally { f.cleanup(); rmSync(worktree, { recursive: true, force: true }); }
});

test("S3 (FAFF-488): --session-id naming a session with NO transcript file at all still degrades honestly to estimate + the FAFF-428 warning, exit unchanged", () => {
  const f = fixture({ rc: "budget:\n  tokens: 100000\n", ledger: baseLedger({ level: "L4" }) });
  try {
    const sid = "sess-genuinely-absent";
    // No project dir / transcript is written for this session at all.
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.ok(Array.isArray(s.warnings) && s.warnings.some((w) => /L4 budget metering degraded/.test(w)), JSON.stringify(s.warnings));
  } finally { f.cleanup(); }
});

test("S4 (FAFF-488): no --session-id (and no --root beyond the pre-existing flag) → byte-for-byte the pre-change ambient-env resolution", () => {
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-bytefb";
    const cfg = withTranscripts(f.root, f.root, sid, { [`${sid}.jsonl`]: [{ input_tokens: 42, output_tokens: 7 }] });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root], { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 49);
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-560 — budget.measure_session_id: the persisted "owning" measuring
// session (written by lights-out mint) is preferred over a drifted ambient
// CLAUDE_CODE_SESSION_ID in `budget check`, with precedence
// --session-id flag > persisted measure_session_id > ambient. Each of the
// three legs gets its own transcript so a wrong resolution is observable as
// a wrong token total, not just a wrong tokens_source.
// ===========================================================================

test("FAFF-560 AC1: owning session (persisted) != ambient session → attributes to the owning (persisted) session, not ambient", () => {
  const owningSid = "sess-owning";
  const ambientSid = "sess-ambient";
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0, measure_session_id: owningSid } }),
  });
  try {
    const cfg = withTranscripts(f.root, f.root, owningSid, {
      [`${owningSid}.jsonl`]: [{ input_tokens: 100, output_tokens: 20 }], // owning: 120 tokens
      [`${ambientSid}.jsonl`]: [{ input_tokens: 9000, output_tokens: 900 }], // ambient: 9900 tokens (must NOT be selected)
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: ambientSid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 120, "must meter the persisted owning session's transcript, not the ambient one");
  } finally { f.cleanup(); }
});

test("FAFF-560 AC2: --session-id flag beats a persisted measure_session_id (FAFF-488 explicit-override contract preserved)", () => {
  const flagSid = "sess-flag";
  const persistedSid = "sess-persisted";
  const ambientSid = "sess-ambient2";
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0, measure_session_id: persistedSid } }),
  });
  try {
    const cfg = withTranscripts(f.root, f.root, flagSid, {
      [`${flagSid}.jsonl`]: [{ input_tokens: 10, output_tokens: 5 }], // flag: 15 tokens
      [`${persistedSid}.jsonl`]: [{ input_tokens: 2000, output_tokens: 200 }], // persisted: 2200 (must NOT be selected)
      [`${ambientSid}.jsonl`]: [{ input_tokens: 9000, output_tokens: 900 }], // ambient: 9900 (must NOT be selected)
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--session-id", flagSid],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: ambientSid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 15, "explicit --session-id flag must win over the persisted measure_session_id");
  } finally { f.cleanup(); }
});

test("FAFF-560: a resumed run (FAFF-527 budget.sessions present) prefers the open span's OWN session_id over a stale persisted mint measure_session_id", () => {
  // The mint-time persisted session ("sess-original-mint") is now STALE — a resume has
  // happened since, opening a new span whose baseline was measured against ITS OWN
  // session id ("sess-resumed"). If effectiveEnv picked the stale persisted value
  // instead, measureTokensByModelClass would read the WRONG transcript — mismatched
  // against the open span's baseline, corrupting the current-span subtraction.
  const originalMintSid = "sess-original-mint";
  const resumedSid = "sess-resumed";
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({
      owner: { status: "running", started_at: "2026-06-23T15:00:00Z", session_id: resumedSid },
      budget: {
        measure_session_id: originalMintSid, // stale — from the ORIGINAL mint, never updated on resume
        sessions: [
          { session_id: originalMintSid, baseline_by_model_class: {}, closed_delta_by_model_class: { "m1": { input: 100, output: 0, cache_write: 0, cache_read: 0 } }, closed_at: "t1", close_source: "transcript" },
          { session_id: resumedSid, baseline_by_model_class: {}, closed_delta_by_model_class: null, closed_at: null, close_source: null },
        ],
      },
    }),
  });
  try {
    // A THIRD, distinct drifted-ambient session — deliberately NOT the open span's own
    // sid and NOT the persisted mint sid. Adversarial-review finding: a prior version of
    // this test set ambient == the open span's sid, so a buggy fall-through to ambient
    // would have passed anyway. Pinning --root only (never relying on ambient) and
    // driving CLAUDE_CODE_SESSION_ID to this unrelated third value proves the resolution
    // genuinely selects the open span's OWN session_id, not merely "whatever ambient is."
    const driftedAmbientSid = "sess-drifted-ambient-unrelated";
    const cfg = withTranscripts(f.root, f.root, resumedSid, {
      [`${resumedSid}.jsonl`]: [{ input_tokens: 20, output_tokens: 5 }], // resumed (open-span) session's own current delta: 25
      [`${originalMintSid}.jsonl`]: [{ input_tokens: 9000, output_tokens: 900 }], // must NOT be read (stale persisted)
      [`${driftedAmbientSid}.jsonl`]: [{ input_tokens: 500000, output_tokens: 50000 }], // must NOT be read (drifted ambient)
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: driftedAmbientSid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    // closed span (100) + current-span delta measured against the OPEN SPAN's own
    // transcript (25, baseline 0) = 125 — proven distinct from both the stale persisted
    // mint session and a drifted third ambient, either of which would yield a wildly
    // different (and wrong) total if selected instead.
    assert.equal(s.spent.tokens, 125, "must meter the open span's own session, not the stale persisted mint session or a drifted ambient");
  } finally { f.cleanup(); }
});

test("FAFF-560: --session-id flag beats the FAFF-527 open span's own session_id too (flag is always the top of precedence)", () => {
  const flagSid = "sess-explicit-flag";
  const openSpanSid = "sess-open-span";
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    ledger: baseLedger({
      owner: { status: "running", started_at: "2026-06-23T15:00:00Z", session_id: openSpanSid },
      budget: {
        sessions: [
          { session_id: openSpanSid, baseline_by_model_class: {}, closed_delta_by_model_class: null, closed_at: null, close_source: null },
        ],
      },
    }),
  });
  try {
    const cfg = withTranscripts(f.root, f.root, flagSid, {
      [`${flagSid}.jsonl`]: [{ input_tokens: 8, output_tokens: 2 }], // flag: 10 tokens
      [`${openSpanSid}.jsonl`]: [{ input_tokens: 4000, output_tokens: 400 }], // must NOT be read
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--session-id", flagSid],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: openSpanSid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 10, "explicit --session-id flag must win over the open span's own session_id");
  } finally { f.cleanup(); }
});

test("FAFF-560 AC3: no persisted measure_session_id in the ledger → byte-for-byte the ambient path (no regression to single-session runs)", () => {
  const sid = "sess-no-persisted";
  const f = fixture({
    rc: "budget:\n  tokens: 999999999\n",
    // budget.measure_session_id is absent — owning == ambient, the pre-change shape.
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const cfg = withTranscripts(f.root, f.root, sid, { [`${sid}.jsonl`]: [{ input_tokens: 42, output_tokens: 7 }] });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root], { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "transcript");
    assert.equal(s.spent.tokens, 49, "absent measure_session_id must fall through to ambient, byte-for-byte");
  } finally { f.cleanup(); }
});

test("FAFF-627: readGovernanceConfig THROWS legacy-config-name (no longer process.exit(2)) — importer survives", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-budget-legacy-"));
  try {
    // Legacy-named config file (not .faffrc.yaml) at the fixture root.
    writeFileSync(join(root, ".faffrc"), "budget:\n  tokens: 1\n");
    assert.throws(
      () => readGovernanceConfig(root),
      (e) => e && e.message === "legacy-config-name" && Array.isArray(e.legacy) && e.legacy.includes(".faffrc"),
      "readGovernanceConfig must throw legacy-config-name (carrying e.legacy) rather than killing the process"
    );
    // Reaching here proves the importing test process survived the call — the
    // whole point of FAFF-627 (was process.exit(2), which would have killed
    // this very test runner before this assertion ever ran).
    assert.ok(true, "importing process is still alive after the throw");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-627: `faff budget check` on a legacy-named config still exits 2 with the loud message (CLI surface unchanged)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-budget-legacy-cli-"));
  const runDir = join(root, ".faff", "runs", "run-test");
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(root, ".faffrc"), "budget:\n  tokens: 1\n");
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(baseLedger()));
    const r = run(["budget", "check", "--run-dir", runDir, "--root", root]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /legacy config filename/, "the detailed governance stderr message must still fire");
    assert.match(r.err, /faff budget: cannot proceed — legacy config filename/, "the dispatch-boundary command-level line must fire too");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ===========================================================================
// FAFF-594 — window-mode budget: a GLOBAL 5h rolling token-draw ceiling with
// a new at_ceiling disposition (park-until-window-reset). Deterministic,
// fake-clock (--now-ms) tests only — no real wall-clock waits anywhere.
// ===========================================================================

test("FAFF-594: envelopeFrom resolves a well-formed budget.window; absent/malformed → null (inert)", () => {
  const e1 = envelopeFrom({ budget: { window: { hours: 5, tokens: 500000 } } }, {});
  assert.deepEqual(e1.window, { hours: 5, tokens: 500000 });
  const e2 = envelopeFrom({ budget: {} }, {});
  assert.equal(e2.window, null, "no budget.window at all → null");
  const e3 = envelopeFrom({ budget: { window: { hours: 5 } } }, {}); // missing tokens
  assert.equal(e3.window, null, "malformed (missing tokens) → null, never a crash");
  const e4 = envelopeFrom({ budget: { window: { hours: 0, tokens: 100 } } }, {}); // hours<=0
  assert.equal(e4.window, null, "non-positive hours → null");
  // Dollar/attempts/until ceilings stay byte-for-byte unchanged when budget.window is absent.
  const e5 = envelopeFrom({ budget: { tokens: 100, max_attempts: 3 } }, {});
  assert.equal(e5.window, null);
  assert.equal(e5.ceilings.tokens, 100);
  assert.equal(e5.ceilings.max_attempts, 3);
});

test("FAFF-594: AT_CEILING_OUTCOMES accepts park-until-window-reset; unknown at_ceiling still coerces to stop", () => {
  const e1 = envelopeFrom({ budget: { at_ceiling: "park-until-window-reset" } }, {});
  assert.equal(e1.at_ceiling, "park-until-window-reset");
  const e2 = envelopeFrom({ budget: { at_ceiling: "bogus" } }, {});
  assert.equal(e2.at_ceiling, "stop", "unknown value still coerces to the safe default");
});

test("FAFF-594 unit: computeBudgetState — window draw AT/OVER ceiling + at_ceiling park-until-window-reset → outcome + correct resume_at", () => {
  const env = envelopeFrom({ budget: { window: { hours: 5, tokens: 1000 }, at_ceiling: "park-until-window-reset" } }, {});
  const resetEpoch = Date.now() + 3 * 3600 * 1000;
  const s = computeBudgetState(env, {
    now_epoch: Date.now(), attempts: 0, tokens: 0,
    window_tokens: 1000, window_reset_epoch: resetEpoch,
  }, "transcript");
  assert.deepEqual(s.breached, ["window"]);
  assert.equal(s.outcome, "park-until-window-reset");
  assert.equal(s.resume_at, new Date(resetEpoch).toISOString(), "resume_at equals the injected reset_epoch as ISO-8601");

  // Over ceiling (not just at) also breaches.
  const sOver = computeBudgetState(env, {
    now_epoch: Date.now(), attempts: 0, tokens: 0,
    window_tokens: 5000, window_reset_epoch: resetEpoch,
  }, "transcript");
  assert.deepEqual(sOver.breached, ["window"]);
  assert.equal(sOver.outcome, "park-until-window-reset");
});

test("FAFF-594 unit: computeBudgetState — window draw UNDER ceiling → not breached, no resume_at", () => {
  const env = envelopeFrom({ budget: { window: { hours: 5, tokens: 1000 }, at_ceiling: "park-until-window-reset" } }, {});
  const s = computeBudgetState(env, {
    now_epoch: Date.now(), attempts: 0, tokens: 0,
    window_tokens: 500, window_reset_epoch: Date.now() + 3600 * 1000,
  }, "transcript");
  assert.deepEqual(s.breached, []);
  assert.equal(s.outcome, "none");
  assert.equal(s.resume_at, null);
});

test("FAFF-594 unit: no window configured (env.window null) → window dimension never breaches regardless of window_tokens", () => {
  const env = envelopeFrom({ budget: { tokens: 999999999 } }, {}); // no budget.window
  const s = computeBudgetState(env, {
    now_epoch: Date.now(), attempts: 0, tokens: 0,
    window_tokens: 999999999, window_reset_epoch: Date.now() + 1000,
  }, "transcript");
  assert.deepEqual(s.breached, [], "window_tokens is ignored entirely when env.window is null");
});

test("FAFF-594 unit: a resume_at is populated ONLY on the park-until-window-reset outcome, never on stop/escalate/none", () => {
  const envStop = envelopeFrom({ budget: { window: { hours: 5, tokens: 10 }, at_ceiling: "stop" } }, {});
  const s = computeBudgetState(envStop, {
    now_epoch: Date.now(), attempts: 0, tokens: 0,
    window_tokens: 50, window_reset_epoch: Date.now() + 1000,
  }, "transcript");
  assert.equal(s.outcome, "stop");
  assert.equal(s.resume_at, null, "a stop outcome (even from the window dimension) carries no resume_at");
});

test("FAFF-594 CLI integration: first budget-check invocation with no prior ledger.budget.window opens a window anchored at injected now", () => {
  const f = fixture({
    rc: "budget:\n  window:\n    hours: 5\n    tokens: 500000\n  at_ceiling: park-until-window-reset\n",
    ledger: baseLedger(),
  });
  try {
    const sid = "sess-w1";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 1000, output_tokens: 500 }],
    });
    const now = String(Date.parse("2026-07-24T12:00:00Z"));
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", now],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.deepEqual(s.breached, [], "1500 tokens is well under the 500000 window ceiling");
    const ledgerAfter = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.ok(ledgerAfter.budget && ledgerAfter.budget.window, "window state persisted to the ledger");
    assert.equal(ledgerAfter.budget.window.anchor_epoch, Number(now), "anchored at the injected now — the first-draw instant");
    assert.equal(ledgerAfter.budget.window.reset_epoch, Number(now) + 5 * 3600 * 1000, "reset_epoch = anchor + 5h");
    assert.equal(ledgerAfter.budget.window.tokens_at_anchor, 1500);
  } finally { f.cleanup(); }
});

test("FAFF-594 CLI integration: a window breach with at_ceiling park-until-window-reset returns outcome + resume_at and does not falsely breach dollar/attempts", () => {
  const f = fixture({
    rc: "budget:\n  window:\n    hours: 5\n    tokens: 1000\n  at_ceiling: park-until-window-reset\n",
    ledger: baseLedger({ budget: { window: { anchor_epoch: 1000000, reset_epoch: 1000000 + 5 * 3600 * 1000, tokens_at_anchor: 0 } } }),
  });
  try {
    const sid = "sess-w2";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 900, output_tokens: 200 }], // 1100 total, over the 1000 window ceiling
    });
    const now = String(1000000 + 1000); // still well inside the open window
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", now],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.deepEqual(s.breached, ["window"]);
    assert.equal(s.outcome, "park-until-window-reset");
    assert.equal(s.resume_at, new Date(1000000 + 5 * 3600 * 1000).toISOString());
  } finally { f.cleanup(); }
});

test("FAFF-594 CLI integration: an expired window (now >= reset_epoch) re-opens FRESH on the next draw, discarding the expired baseline", () => {
  const oldAnchor = 1000000;
  const oldReset = oldAnchor + 5 * 3600 * 1000;
  const f = fixture({
    rc: "budget:\n  window:\n    hours: 5\n    tokens: 1000\n  at_ceiling: park-until-window-reset\n",
    ledger: baseLedger({ budget: { window: { anchor_epoch: oldAnchor, reset_epoch: oldReset, tokens_at_anchor: 0 } } }),
  });
  try {
    const sid = "sess-w3";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 900, output_tokens: 200 }], // 1100 whole-session — would have breached the OLD window
    });
    const nowPastReset = String(oldReset + 1000); // just past the old window's reset
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", nowPastReset],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    // A fresh window anchors AT this draw (tokens_at_anchor = 1100), so draw-within-the-new-window = 0 → not breached.
    assert.deepEqual(s.breached, [], "the fresh window is not blocked by the expired one's exhausted ceiling");
    const ledgerAfter = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(ledgerAfter.budget.window.anchor_epoch, Number(nowPastReset), "re-anchored at the new draw's instant");
    assert.notEqual(ledgerAfter.budget.window.reset_epoch, oldReset, "the expired window's reset_epoch is discarded");
    assert.equal(ledgerAfter.budget.window.tokens_at_anchor, 1100, "baselined at the fresh anchor's whole-session total");
  } finally { f.cleanup(); }
});

test("FAFF-594 CLI integration: no draw observed yet (whole-session total 0) does not open a window", () => {
  const f = fixture({
    rc: "budget:\n  window:\n    hours: 5\n    tokens: 1000\n  at_ceiling: park-until-window-reset\n",
    ledger: baseLedger(),
  });
  try {
    const sid = "sess-w4";
    const cfg = withTranscripts(f.root, f.root, sid, { [`${sid}.jsonl`]: [] }); // transcript exists, zero usage records
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", "1000000"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const ledgerAfter = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(ledgerAfter.budget, undefined, "no window state written when there has been no draw yet");
  } finally { f.cleanup(); }
});

test("FAFF-594 CLI integration: dollar-mode / attempts / until dimensions are unaffected by a configured budget.window (byte-for-byte)", () => {
  const f = fixture({
    rc: "budget:\n  max_attempts: 1\n  window:\n    hours: 5\n    tokens: 999999999\n  at_ceiling: stop\n",
    ledger: baseLedger(),
  });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.deepEqual(s.breached, ["max_attempts"], "the pre-existing max_attempts breach is untouched by the window dimension being configured");
    assert.equal(s.outcome, "stop");
  } finally { f.cleanup(); }
});

test("FAFF-594 CLI integration: runcheck does not flag an admitted issue with the new parked-window terminal outcome as dangling", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-runcheck-window-"));
  const runDir = join(root, ".faff", "runs", "run-test");
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({
      run_id: "run-test", admitted: ["FAFF-X"], outcomes: { "FAFF-X": "parked-window" },
      owner: { status: "running", started_at: "2026-06-23T15:00:00Z" },
    }));
    const r = run(["runcheck", runDir]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /clean: every admitted issue reached a terminal outcome\./, "parked-window is a recognised terminal state — not flagged dangling");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-594: estimate-fallback mode (no transcript) opens a window on first observed draw, just like the transcript path", () => {
  const f = fixture({
    rc: "budget:\n  window:\n    hours: 5\n    tokens: 100000\n  at_ceiling: park-until-window-reset\n",
    ledger: baseLedger({ admitted: ["A"], outcomes: { A: "shipped" } }), // 1 attempt * 200000 default est = 200000
  });
  try {
    // No CLAUDE_CODE_SESSION_ID / no transcript → estimate path.
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", "5000000"]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.deepEqual(s.breached, [], "the window just opened this invocation — no draw has accumulated within it yet, regardless of the estimate's magnitude");
    const ledgerAfter = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(ledgerAfter.budget.window.tokens_at_anchor, 200000, "anchored at the estimate figure this invocation observed");
  } finally { f.cleanup(); }
});

test("FAFF-594: estimate-fallback mode still checks the window ceiling on a SECOND draw within the same window — not silently inert like a transcript-only feature would be", () => {
  const f = fixture({
    rc: "budget:\n  window:\n    hours: 5\n    tokens: 100000\n  at_ceiling: park-until-window-reset\n",
    // A window already anchored at 1 attempt's estimate (200000); a 2nd attempt lands, pushing the
    // estimate to 400000 — 200000 of NEW draw within the still-open window, over the 100000 ceiling.
    ledger: baseLedger({
      admitted: ["A", "B"], outcomes: { A: "shipped", B: "shipped" },
      budget: { window: { anchor_epoch: 1000000, reset_epoch: 1000000 + 5 * 3600 * 1000, tokens_at_anchor: 200000 } },
    }),
  });
  try {
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root, "--now-ms", "1001000"]);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.tokens_source, "estimate");
    assert.deepEqual(s.breached, ["window"], "the window ceiling still resolves from the estimate figure, not silently inert on the no-transcript path");
    assert.equal(s.outcome, "park-until-window-reset");
  } finally { f.cleanup(); }
});
