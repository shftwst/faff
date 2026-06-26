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
  } finally { f.cleanup(); }
});
