// FAFF-397 — `faff reconcile` CLI surface: the blocking run-end ground-truth gate.
// Exercises the deterministic seam (exit codes / --selftest table / stdin parsing / arg
// validation) of the new pure reconcile verb. Per ADR 0002 (pure core + thin CLI wrapper,
// no network/filesystem — parity with merge-gate's --selftest-only pure-core tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";

test("reconcile --selftest: the pure core + validate table passes", () => {
  const { code } = runCli(["reconcile", "--selftest"]);
  assert.equal(code, 0);
});

test("reconcile: missing --run-dir → exit 2", () => {
  const { code, stderr } = runCli(["reconcile", "--level", "L3"], { input: "{}" });
  assert.equal(code, 2);
  assert.match(stderr, /--run-dir is required/);
});

test("reconcile: missing --level → exit 2", () => {
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x"], { input: "{}" });
  assert.equal(code, 2);
  assert.match(stderr, /--level is required/);
});

test("reconcile: bad --level → exit 2", () => {
  // FAFF-576: bad --level is now caught by the shared argv parser as a bad-enum naming the
  // accepted set (sharper than the old "--level is required" catch-all); exit 2 is unchanged.
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L9"], { input: "{}" });
  assert.equal(code, 2);
  assert.match(stderr, /bad-enum|not in L1\|L2\|L3\|L4/);
});

test("reconcile: malformed JSON on stdin → exit 2 (fail-loud, never a silent pass)", () => {
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L3"], { input: "not json" });
  assert.equal(code, 2);
  assert.match(stderr, /not valid JSON/);
});

test("reconcile: non-object stdin → exit 2 malformed ReconcileInput", () => {
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L3"], { input: "[1,2,3]" });
  assert.equal(code, 2);
  assert.match(stderr, /malformed ReconcileInput/);
});

test("reconcile: a shipped entry with no `issue` → exit 2 (no degenerate issue:undefined divergence)", () => {
  const input = JSON.stringify({ shipped: [{ recorded: null, observed: { pr_merged: false } }] });
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4"], { input });
  assert.equal(code, 2);
  assert.match(stderr, /shipped\[0\] must be an object with a non-empty string "issue"/);
});

test("reconcile: a shipped entry MISSING `recorded` is the fail-closed path, not rejected → exit 1 divergence", () => {
  const input = JSON.stringify({ shipped: [{ issue: "FAFF-A", observed: { pr_merged: false, merged_head_sha: null } }] });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).divergences[0].class, "claimed-shipped-unmerged");
});

test("reconcile: a stdin `level` contradicting --level → exit 2 fail-loud (no silent fail-open)", () => {
  const input = JSON.stringify({ level: "L3", shipped: [] });
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4"], { input });
  assert.equal(code, 2);
  assert.match(stderr, /contradicts --level/);
});

test("reconcile: a stdin `level` AGREEING with --level → accepted", () => {
  const input = JSON.stringify({ level: "L4", shipped: [], sibling_baseline: { captured: true, entry_count: 0 } });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).consistent, true);
});

// FAFF-680: an empty input is no longer vacuously consistent — the sibling half's absence is
// indistinguishable from an empty sibling set unless the caller attests capture. Only the
// attested-empty shape is a genuine clean pass; bare `{}` reads as "the check did not run".
test("reconcile: empty input, NO sibling_baseline attestation → sibling-check-unproven divergence, exit 1, needs-human at L4", () => {
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input: "{}" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.consistent, false);
  assert.equal(result.disposition, "needs-human");
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].class, "sibling-check-unproven");
  assert.equal(result.divergences[0].issue, null);
});

test("reconcile: empty input WITH sibling_baseline attestation → consistent, exit 0, disposition pass", () => {
  const input = JSON.stringify({ sibling_baseline: { captured: true, entry_count: 0 } });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.consistent, true);
  assert.equal(result.disposition, "pass");
  assert.deepEqual(result.divergences, []);
});

test("reconcile: shipped with no merge-record → claimed-shipped-unmerged divergence, exit 1, needs-human at L4", () => {
  const input = JSON.stringify({
    shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.consistent, false);
  assert.equal(result.disposition, "needs-human");
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].class, "claimed-shipped-unmerged");
  assert.equal(result.divergences[0].issue, "FAFF-A");
});

test("reconcile: shipped head-sha mismatch → phantom-merge divergence with a rollback proposal", () => {
  const input = JSON.stringify({
    shipped: [{
      issue: "FAFF-A",
      recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" },
      observed: { pr_merged: true, merged_head_sha: "def456" },
    }],
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.divergences[0].class, "phantom-merge");
  assert.match(result.divergences[0].rollback_proposal, /git revert def456/);
});

test("reconcile: shipped matches recorded+observed → consistent, exit 0", () => {
  const input = JSON.stringify({
    shipped: [{
      issue: "FAFF-A",
      recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" },
      observed: { pr_merged: true, merged_head_sha: "abc123" },
    }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).consistent, true);
});

test("reconcile: non-admitted sibling flips terminal → unowned-sibling-mutation divergence", () => {
  const input = JSON.stringify({
    siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }],
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.divergences[0].class, "unowned-sibling-mutation");
  assert.equal(result.divergences[0].issue, "FAFF-B");
});

test("reconcile: sibling admitted later (chain-unlock) is excluded even if terminal", () => {
  const input = JSON.stringify({
    siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: true }],
    sibling_baseline: { captured: true, entry_count: 1 },
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).consistent, true);
});

test("reconcile: a divergence at L3 (not lights-out) → disposition warn, not needs-human", () => {
  const input = JSON.stringify({
    shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }],
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L3", "--json"], { input });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).disposition, "warn");
});

test("reconcile: non-json output mode still prints the divergences + the faff-contract:run-reconcile block", () => {
  const input = JSON.stringify({
    shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }],
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4"], { input });
  assert.equal(code, 1);
  assert.match(stdout, /consistent=false disposition=needs-human/);
  assert.match(stdout, /claimed-shipped-unmerged/);
  assert.match(stdout, /```faff-contract:run-reconcile/);
});

// --- integration smoke test (spec §8 DONE): the FULL fixture round-trip a run-dir would carry ---
test("integration smoke test: matching merge-record.json + observed head sha → consistent; a flipped sha → phantom-merge", () => {
  const baseShipped = {
    issue: "FAFF-A",
    recorded: { pr: 1, head_sha: "X", merged: true, merged_at: "2026-07-11T00:00:00Z" },
  };
  const consistentInput = JSON.stringify({
    shipped: [{ ...baseShipped, observed: { pr_merged: true, merged_head_sha: "X" } }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code: okCode, stdout: okOut } = runCli(["reconcile", "--run-dir", "/tmp/fixture-run", "--level", "L4", "--json"], { input: consistentInput });
  assert.equal(okCode, 0);
  assert.equal(JSON.parse(okOut).consistent, true);

  const flippedInput = JSON.stringify({
    shipped: [{ ...baseShipped, observed: { pr_merged: true, merged_head_sha: "Y" } }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code: badCode, stdout: badOut } = runCli(["reconcile", "--run-dir", "/tmp/fixture-run", "--level", "L4", "--json"], { input: flippedInput });
  assert.equal(badCode, 1);
  const badResult = JSON.parse(badOut);
  assert.equal(badResult.divergences.length, 1);
  assert.equal(badResult.divergences[0].class, "phantom-merge");
  assert.equal(badResult.disposition, "needs-human");
});

// --- FAFF-571: superseded (premise-supersession terminal outcome) — the spec §8 smoke test ---
test("FAFF-571 smoke test: superseded with valid evidence + observed delivery → consistent, pass", () => {
  const input = JSON.stringify({
    superseded: [{
      issue: "FAFF-551",
      recorded: {
        issue: "FAFF-551", superseded_by: ["FAFF-556", "FAFF-557", "FAFF-559"],
        delivered_surface: "x", closed_at: "2026-07-20T07:04:39Z", run_id: "r",
      },
      observed: { all_delivered: true },
    }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.consistent, true);
  assert.equal(result.disposition, "pass");
});

test("FAFF-571 smoke test: superseded with recorded:null → superseded-unproven divergence, needs-human at L4", () => {
  const input = JSON.stringify({
    superseded: [{ issue: "FAFF-551", recorded: null }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.consistent, false);
  assert.equal(result.disposition, "needs-human");
  assert.equal(result.divergences[0].class, "superseded-unproven");
  assert.equal(result.divergences[0].issue, "FAFF-551");
});

// --- FAFF-680: the sibling_baseline attestation itself ---
test("reconcile: sibling_baseline captured:true with a populated siblings[] and one flipped terminal → exactly one unowned-sibling-mutation, no sibling-check-unproven", () => {
  const input = JSON.stringify({
    siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }],
    sibling_baseline: { captured: true, entry_count: 1 },
  });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].class, "unowned-sibling-mutation");
});

test("reconcile: sibling_baseline.captured as the string \"true\" → not-captured (strict boolean only)", () => {
  const input = JSON.stringify({ sibling_baseline: { captured: "true", entry_count: 0 } });
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4", "--json"], { input });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).divergences[0].class, "sibling-check-unproven");
});

test("reconcile: sibling_baseline captured:true with entry_count below siblings.length → exit 2 malformed input", () => {
  const input = JSON.stringify({
    siblings: [{ issue: "FAFF-A" }, { issue: "FAFF-B" }],
    sibling_baseline: { captured: true, entry_count: 0 },
  });
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4"], { input });
  assert.equal(code, 2);
  assert.match(stderr, /sibling_baseline\.entry_count/);
});

test("reconcile: sibling_baseline captured:true with a negative entry_count → exit 2 malformed input", () => {
  const input = JSON.stringify({ sibling_baseline: { captured: true, entry_count: -1 } });
  const { code, stderr } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L4"], { input });
  assert.equal(code, 2);
  assert.match(stderr, /sibling_baseline\.entry_count/);
});

test("reconcile: non-json output renders the run-level sibling-check-unproven line as 'run:', not literal 'null'", () => {
  const { code, stdout } = runCli(["reconcile", "--run-dir", "/tmp/x", "--level", "L3"], { input: "{}" });
  assert.equal(code, 1);
  assert.match(stdout, /✗ \[sibling-check-unproven\] run:/);
});
