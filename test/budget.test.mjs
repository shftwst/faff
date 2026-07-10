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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

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

test("cost dimension: price>0 computes cost=tokens×price and can breach", () => {
  const f = fixture({
    rc: "budget:\n  cost: 4\n  price_per_mtok: 100\n  at_ceiling: stop\n",
    ledger: baseLedger({ budget: { tokens_at_start: 0 } }),
  });
  try {
    const sid = "sess-cost";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 50000, output_tokens: 0 }], // 50k tok × 100/Mtok = $5 ≥ $4
    });
    const r = run(["budget", "check", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const s = JSON.parse(r.out);
    assert.equal(s.spent.cost, 5);
    assert.deepEqual(s.breached, ["cost"]);
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
