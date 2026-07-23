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
import { createHash } from "node:crypto";
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

// --- FAFF-568 fix pass: anchor discovery derivation + containment (CLI-side) ----
// `--derive-anchor-dirs` is the Action's discovery core: prefix-strip at ANY
// anchors-path depth, reject ".." traversal, realpath-contain, skip deleted dirs.

test("FAFF-568: --derive-anchor-dirs handles 1/2/3-segment anchors-paths and rejects '..' traversal", () => {
  const root = tmpRunDir("faff568-derive-");
  try {
    for (const p of ["anchors", ".faff/anchors", ".faff/sub/anchors"]) {
      mkdirSync(path.join(root, p, "run-1", "FAFF-1"), { recursive: true });
    }
    const cases = [
      ["anchors", "anchors/run-1/FAFF-1/events.jsonl", "anchors/run-1/FAFF-1"],
      [".faff/anchors", ".faff/anchors/run-1/FAFF-1/chain-head.json", ".faff/anchors/run-1/FAFF-1"],
      [".faff/sub/anchors", ".faff/sub/anchors/run-1/FAFF-1/events.jsonl", ".faff/sub/anchors/run-1/FAFF-1"],
    ];
    for (const [anchorsPath, changed, want] of cases) {
      const r = runCli(["governance-check", "--derive-anchor-dirs", anchorsPath], { cwd: root, input: changed + "\n" });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), want, `anchors-path ${anchorsPath}`);
    }
    // ".." traversal: dropped with a loud stderr warning, never a derived dir.
    const trav = runCli(["governance-check", "--derive-anchor-dirs", ".faff/anchors"],
      { cwd: root, input: ".faff/anchors/../../evil/x/events.jsonl\n" });
    assert.equal(trav.code, 0);
    assert.equal(trav.stdout.trim(), "", "no dir derived from a traversal path");
    assert.match(trav.stderr, /dropped.*traversal/, "the drop is warned, never silent");
    // A dir the PR deleted is skipped without a warning (not carried anymore).
    const gone = runCli(["governance-check", "--derive-anchor-dirs", ".faff/anchors"],
      { cwd: root, input: ".faff/anchors/run-gone/FAFF-9/events.jsonl\n" });
    assert.equal(gone.code, 0);
    assert.equal(gone.stdout.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-568: --anchors-root rejects an --anchor-dir that resolves outside it (exit 2, fail-loud)", () => {
  const root = tmpRunDir("faff568-root-");
  try {
    mkdirSync(path.join(root, "anchors", "run-1", "FAFF-1"), { recursive: true });
    mkdirSync(path.join(root, "outside"), { recursive: true });
    const ok = runCli(["governance-check", "--anchor-dir", path.join(root, "anchors", "run-1", "FAFF-1"), "--anchors-root", path.join(root, "anchors")]);
    assert.equal(ok.code, 0, ok.stderr);
    const bad = runCli(["governance-check", "--anchor-dir", path.join(root, "outside"), "--anchors-root", path.join(root, "anchors")]);
    assert.equal(bad.code, 2, `expected containment exit 2; stdout=${bad.stdout} stderr=${bad.stderr}`);
    assert.match(bad.stderr, /outside the anchors root/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-568 fix pass: witness gating + legacy-policy warn through the CLI -----

function buildChainDir(dir, runId, payloads) {
  const sha256 = (b) => createHash("sha256").update(b).digest("hex");
  let prevBytes = null;
  const lines = payloads.map((p, i) => {
    const prev = prevBytes === null ? sha256(Buffer.from(runId, "utf8")) : sha256(prevBytes);
    const line = JSON.stringify({ schema: 2, run_id: runId, seq: i, ts: "t", prev, ...p });
    prevBytes = Buffer.from(line, "utf8");
    return line;
  });
  writeFileSync(path.join(dir, "events.jsonl"), lines.join("\n") + "\n");
  return lines;
}

test("FAFF-568: a spoofed legacy downgrade on an anchored chain fails governance-check with a witness-mismatch integrity reason", () => {
  const anchor = tmpRunDir("faff568-witness-");
  try {
    const lines = buildChainDir(anchor, "run-w", [
      { phase: "run", type: "run-start" },
      { phase: "build", type: "build-start", issue: "FAFF-1" },
    ]);
    // Anchor-time witness (CLI-shape: head_sha256 / line_count / schema_floor).
    const sha256 = (b) => createHash("sha256").update(b).digest("hex");
    writeFileSync(path.join(anchor, "chain-head.json"), JSON.stringify({
      run_id: "run-w", issue: "FAFF-1", head_seq: 1,
      head_sha256: sha256(Buffer.from(lines[lines.length - 1], "utf8")),
      line_count: lines.length, schema_floor: 2,
    }, null, 2) + "\n");
    const before = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(before.code, 0, before.stderr);
    // The spoof: strip every prev + downgrade schema.
    writeFileSync(path.join(anchor, "events.jsonl"),
      lines.map((l) => { const { prev, ...rest } = JSON.parse(l); return JSON.stringify({ ...rest, schema: 1 }); }).join("\n") + "\n");
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `expected integrity fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.runs[0].legs.integrity.status, "witness-mismatch");
    assert.ok(verdict.reasons.some((x) => /integrity/.test(x) && /witness/.test(x)), JSON.stringify(verdict.reasons));
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

test("FAFF-568: legacy-policy warn passes a legacy anchor WITH a loud stderr note (never silently identical to pass)", () => {
  const anchor = tmpRunDir("faff568-warn-");
  try {
    appendFileSync(path.join(anchor, "events.jsonl"),
      JSON.stringify({ schema: 1, run_id: "run-l", seq: 0, ts: "t", phase: "run", type: "run-start" }) + "\n");
    const quiet = runCli(["governance-check", "--anchor-dir", anchor, "--legacy-policy", "pass"]);
    assert.equal(quiet.code, 0);
    assert.doesNotMatch(quiet.stderr, /warn/, "pass stays quiet");
    const warned = runCli(["governance-check", "--anchor-dir", anchor, "--legacy-policy", "warn"]);
    assert.equal(warned.code, 0, warned.stderr);
    assert.match(warned.stderr, /integrity — legacy schema-1 log .*warn/, "warn emits the note");
    const failed = runCli(["governance-check", "--anchor-dir", anchor, "--legacy-policy", "fail"]);
    assert.equal(failed.code, 1, "fail gates");
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});
