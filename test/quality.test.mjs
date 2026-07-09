// FAFF-418 — `faff quality`: per-run quality/outcome telemetry (the mirror of economics).
// A PURE, read-only reporting subcommand (parity with economics / budget check /
// runcheck): no tracker/network/LLM, touches no producer. It composes the run-ledger
// terminal outcomes (authoritative) + the events.jsonl issue-outcome events' FAFF-418
// gate/rework tags into a QualityReport. Drives the real entrypoint end-to-end over
// filesystem fixtures (mirrors economics.test.mjs), plus the event-schema extension.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}, input) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    input,
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

function fixture({ ledger, events }) {
  const root = mkdtempSync(join(tmpdir(), "faff-quality-"));
  const runDir = join(root, ".faff", "runs", "run-test");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  if (events != null) {
    writeFileSync(join(runDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return { root, runDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const ev = (issue, seq, data) => ({ schema: 1, run_id: "run-test", seq, ts: "t", phase: "build", type: "issue-outcome", issue, data });

test("quality --selftest passes", () => {
  const r = run(["quality", "--selftest"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /quality --selftest: PASS/);
});

test("quality --json: ledger+events derives park/rework/gate distribution", () => {
  const f = fixture({
    ledger: { run_id: "run-test", outcomes: { "FAFF-1": "shipped", "FAFF-2": "shipped", "FAFF-3": "parked", "FAFF-4": "routed-out" } },
    events: [
      ev("FAFF-1", 0, { outcome: "shipped", rework_turns: 0 }),
      ev("FAFF-2", 1, { outcome: "shipped", rework_turns: 2 }),
      ev("FAFF-3", 2, { outcome: "parked", gate: "adversarial", rework_turns: 1 }),
    ],
  });
  try {
    const r = run(["quality", "--run-dir", f.runDir, "--json"]);
    assert.equal(r.code, 0, r.err);
    const q = JSON.parse(r.out);
    assert.equal(q.source, "ledger+events");
    assert.equal(q.shipped_count, 2);
    // routed-out excluded from attempts (parity with economics).
    assert.equal(q.attempt_count, 3);
    assert.equal(q.parked_count, 1);
    assert.equal(q.park_rate, Number((1 / 3).toFixed(4)));
    assert.equal(q.rework.total_turns, 3);
    assert.equal(q.rework.reworked_attempts, 2);
    assert.deepEqual(q.gate_catch, [{ gate: "adversarial", count: 1 }]);
    const pi3 = q.per_issue.find((p) => p.issue === "FAFF-3");
    assert.equal(pi3.gate, "adversarial");
    assert.equal(pi3.rework_turns, 1);
  } finally { f.cleanup(); }
});

test("quality: ledger-only run degrades cleanly (no events.jsonl)", () => {
  const f = fixture({ ledger: { run_id: "run-test", outcomes: { "FAFF-1": "shipped", "FAFF-2": "parked" } } });
  try {
    const r = run(["quality", "--run-dir", f.runDir, "--json"]);
    assert.equal(r.code, 0, r.err);
    const q = JSON.parse(r.out);
    assert.equal(q.source, "ledger");
    assert.deepEqual(q.gate_catch, []);
    assert.equal(q.rework.total_turns, null);
    assert.equal(q.rework.rework_rate, null);
    // outcome buckets + attempt_count still render off the ledger.
    assert.equal(q.attempt_count, 2);
    assert.equal(q.park_rate, 0.5);
  } finally { f.cleanup(); }
});

test("quality: table render names the run + park_rate", () => {
  const f = fixture({ ledger: { run_id: "run-test", outcomes: { "FAFF-1": "shipped" } } });
  try {
    const r = run(["quality", "--run-dir", f.runDir]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /# quality run-test/);
    assert.match(r.out, /park_rate=/);
  } finally { f.cleanup(); }
});

test("quality: no resolvable run dir exits 2", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-quality-empty-"));
  try {
    // --root at an empty tree ⇒ latestRunDir finds nothing ⇒ exit 2.
    const r = run(["quality", "--root", root], { FAFF_RUN_DIR: "" });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /no run dir/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Event-schema extension (FAFF-418 gate / rework_turns tags) ---

test("events append: accepts valid gate + rework_turns on issue-outcome", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-ev-"));
  mkdirSync(join(root, ".faff", "runs", "r"), { recursive: true });
  try {
    const r = run(["events", "append", "--run", "r", "--root", root],
      {}, JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "parked", gate: "holdout", rework_turns: 3 } }));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /"gate":"holdout"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("events append: rejects off-vocab gate and negative rework_turns", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-ev-"));
  mkdirSync(join(root, ".faff", "runs", "r"), { recursive: true });
  try {
    const bad = run(["events", "append", "--run", "r", "--root", root],
      {}, JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "parked", gate: "linting" } }));
    assert.equal(bad.code, 1, "off-vocab gate must be rejected");
    assert.match(bad.err, /data\.gate/);
    const neg = run(["events", "append", "--run", "r", "--root", root],
      {}, JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped", rework_turns: -1 } }));
    assert.equal(neg.code, 1, "negative rework_turns must be rejected");
    assert.match(neg.err, /rework_turns/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
