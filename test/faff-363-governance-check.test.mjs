// FAFF-363 — governance-check's INTEGRATION SMOKE TEST (spec §8's required "Integration
// smoke test"). Drives the real `faff governance-check` CLI child process (not the
// in-process pure cores `governance-check --selftest` already covers) against a fixture
// run dir built from real ledger + events + floor artifacts on disk — the same substrate
// a `.github/actions/governance-check` composite Action step would hand it.
//
//   1. Build a clean fixture run dir: a complete ledger (admitted issue has a terminal
//      outcome), a clean budget-checkpoint event, and valid ac-checklist/review-verdict
//      floor artifacts for the target issue.
//   2. `governance-check --json` on that fixture asserts pass (exit 0, JSON verdict).
//   3. Corrupt the ledger (drop the admitted issue's outcome — the FAFF-205 "admitted but
//      never dispatched" shape) → asserts exit 1, naming a completeness reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function tmpRunDir(prefix) { return mkdtempSync(path.join(tmpdir(), prefix)); }

function writeLedger(runDir, ledger) {
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
}

function writeFloorArtifacts(runDir, issue) {
  const dir = path.join(runDir, issue);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(path.join(dir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
}

function appendEvent(runDir, event) {
  appendFileSync(path.join(runDir, "events.jsonl"), JSON.stringify(event) + "\n");
}

const ISSUE = "FAFF-363";

test("FAFF-363 integration smoke: a complete fixture run dir passes governance-check --json", () => {
  const runDir = tmpRunDir("faff363-govcheck-pass-");
  try {
    writeLedger(runDir, {
      run_id: "run-faff363-pass",
      admitted: [ISSUE],
      outcomes: { [ISSUE]: "shipped" },
      owner: { status: "done", last_heartbeat: new Date().toISOString() },
    });
    appendEvent(runDir, {
      schema: 1, run_id: "run-faff363-pass", seq: 0, ts: new Date().toISOString(),
      phase: "run", type: "budget-checkpoint",
      data: { spent: { attempts: 1, tokens: 1000 }, tokens_source: "transcript", breached: [], outcome: "none" },
    });
    writeFloorArtifacts(runDir, ISSUE);

    const r = runCli(["governance-check", "--run-dir", runDir, "--issue", ISSUE, "--json"]);
    assert.equal(r.code, 0, `expected pass; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.pass, true);
    assert.equal(verdict.runs.length, 1);
    assert.equal(verdict.runs[0].legs.completeness.pass, true);
    assert.equal(verdict.runs[0].legs.budget.pass, true);
    assert.equal(verdict.runs[0].legs.merge_floor.pass, true);
    assert.deepEqual(verdict.reasons, []);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("FAFF-363 integration smoke: corrupting the ledger (dropping the outcome) fails with a completeness reason", () => {
  const runDir = tmpRunDir("faff363-govcheck-corrupt-");
  try {
    writeLedger(runDir, {
      run_id: "run-faff363-corrupt",
      admitted: [ISSUE],
      outcomes: { [ISSUE]: "shipped" },
      owner: { status: "done", last_heartbeat: new Date().toISOString() },
    });
    appendEvent(runDir, {
      schema: 1, run_id: "run-faff363-corrupt", seq: 0, ts: new Date().toISOString(),
      phase: "run", type: "budget-checkpoint",
      data: { spent: { attempts: 1, tokens: 1000 }, tokens_source: "transcript", breached: [], outcome: "none" },
    });
    writeFloorArtifacts(runDir, ISSUE);

    // Sanity: the uncorrupted fixture passes first (isolates the corruption's effect).
    const before = runCli(["governance-check", "--run-dir", runDir, "--issue", ISSUE]);
    assert.equal(before.code, 0, `fixture should pass before corruption; stderr=${before.stderr}`);

    // Corrupt the ledger — drop the admitted issue's outcome (an admitted-but-never-
    // dispatched shape: exactly the completeness leg's undispatched case).
    writeLedger(runDir, {
      run_id: "run-faff363-corrupt",
      admitted: [ISSUE],
      outcomes: {},
      owner: { status: "done", last_heartbeat: new Date().toISOString() },
    });

    const r = runCli(["governance-check", "--run-dir", runDir, "--issue", ISSUE, "--json"]);
    assert.equal(r.code, 1, `expected fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.pass, false);
    assert.equal(verdict.runs[0].legs.completeness.pass, false);
    assert.deepEqual(verdict.runs[0].legs.completeness.undispatched, [ISSUE]);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes("completeness") && reason.includes(ISSUE)),
      `expected a completeness reason naming ${ISSUE}; got ${JSON.stringify(verdict.reasons)}`,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("FAFF-363: a malformed run-ledger.json is fail-loud exit 2, never folded into a leg failure", () => {
  const runDir = tmpRunDir("faff363-govcheck-malformed-");
  try {
    writeFileSync(path.join(runDir, "run-ledger.json"), "{ this is not valid json");
    const r = runCli(["governance-check", "--run-dir", runDir]);
    assert.equal(r.code, 2, `expected usage/malformed exit 2; stdout=${r.stdout} stderr=${r.stderr}`);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
