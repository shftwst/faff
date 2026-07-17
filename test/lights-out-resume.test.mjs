// FAFF-527 — L4 run re-entry (`faff lights-out --resume <run-id>`).
// Asserts the deterministic seams (ADR 0002): the pure re-entry cores (classification,
// reconstruction, ledger-apply, budget session-accumulation, the owner-epoch write fence,
// the run-resume event registration) directly, and the CLI arg/refusal behaviour via
// runCli. The proceed/mint-write path is unreachable in this host (the re-fired preflight
// refuses without a container attestation — exactly as the mint path does, see
// lights-out.test.mjs), so — mirroring that file — the write-path cores are asserted as
// exported pure functions, and the CLI is asserted at its exit-code + no-write seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  classifyReEnterable, reconstructResumePlan, applyResumeToLedger, runResumeEvent, renderResumeBanner,
} from "../plugin/skills/faff/bin/lib/resume.js";
import { eventViolations } from "../plugin/skills/faff/bin/lib/events.js";
import { DELIVERY_PROFILE } from "../plugin/skills/faff/bin/lib/governance-profile.js";
import { ownerEpochFenceStale, atomicWriteLedgerFenced } from "../plugin/skills/faff/bin/lib/heartbeat.js";
import { closeSpanDeltaByModel, closedSessionsSpend, currentOpenSpan, byModelClassTotal } from "../plugin/skills/faff/bin/lib/budget.js";

// ---------------------------------------------------------------------------
// Re-enterable-state classification (spec §3 ENUM).
// ---------------------------------------------------------------------------
test("classify: aborted-resumable, escalated, dead-running are re-enterable; live/done/refuse", () => {
  assert.equal(classifyReEnterable({ owner: { status: "aborted-resumable" } }, {}).state, "aborted-resumable");
  assert.equal(classifyReEnterable({ abort: { status: "aborted-resumable" }, owner: { status: "running" } }, { held: true }).state, "aborted-resumable");
  assert.equal(classifyReEnterable({ stop_reason: "budget-escalated(tokens)", owner: { status: "running" } }, { held: true }).state, "escalated");
  assert.equal(classifyReEnterable({ stop_reason: "product-incomplete" }, {}).state, "escalated");

  const dead = classifyReEnterable({ owner: { status: "running" } }, { held: false });
  assert.equal(dead.state, "dead-running");
  assert.equal(dead.reEnterable, true);

  const live = classifyReEnterable({ owner: { status: "running" } }, { held: true });
  assert.equal(live.state, "live-running");
  assert.equal(live.reEnterable, false);

  const done = classifyReEnterable({ owner: { status: "done" }, admitted: ["A"], outcomes: { A: "shipped" } }, {});
  assert.equal(done.state, "done-clean");
  assert.equal(done.reEnterable, false);
});

// ---------------------------------------------------------------------------
// Reconstruction — the AC's skip-shipped / no-double-merge / redispatch core.
// ---------------------------------------------------------------------------
test("reconstruct: 3-of-5 shipped skip, remainder redispatch, no merge on skipped (AC 1)", () => {
  const led = { admitted: ["A", "B", "C", "D", "E"], outcomes: { A: "shipped", B: "shipped", C: "shipped" } };
  const ev = {
    A: { reconcile: null }, B: { reconcile: null }, C: { reconcile: null }, // all proven merged
    D: {}, E: {}, // admitted, no checkpoint
  };
  const plan = reconstructResumePlan(led, ev);
  assert.deepEqual(plan.skip.sort(), ["A", "B", "C"]);
  assert.deepEqual(plan.redispatch.sort(), ["D", "E"]);
  assert.equal(plan.park.length, 0);
  // the skipped issues are excluded from every dispatch bucket → never re-merged
  for (const skipped of plan.skip) {
    assert.ok(!plan.redispatch.includes(skipped) && !plan.continue_from_push.includes(skipped) && !plan.continue_review.includes(skipped));
  }
});

test("reconstruct: a phantom-merge / claimed-unmerged shipped issue PARKS, run resumes for the rest (AC no-double-merge)", () => {
  const led = { admitted: ["A", "B", "C"], outcomes: { A: "shipped", B: "shipped", C: "shipped" } };
  const ev = {
    A: { reconcile: null }, // proven → skip
    B: { recorded: { pr: 1, head_sha: "abc", merged: true }, observed: { pr_merged: true, merged_head_sha: "def" } }, // phantom
    C: { recorded: null, observed: { pr_merged: false } }, // claimed-shipped-unmerged
  };
  const plan = reconstructResumePlan(led, ev);
  assert.deepEqual(plan.skip, ["A"]);
  assert.ok(plan.park.some((p) => p.issue === "B" && p.divergence.class === "phantom-merge"));
  assert.ok(plan.park.some((p) => p.issue === "C" && p.divergence.class === "claimed-shipped-unmerged"));
  // parked-divergent issues are excluded from dispatch (never re-merged/rebuilt)
  for (const p of plan.park) assert.ok(!plan.redispatch.includes(p.issue) && !plan.skip.includes(p.issue));
});

test("reconstruct: continue-boundaries — review store / pushed branch / branch-missing park", () => {
  const led = { admitted: ["R", "P", "M", "T"], outcomes: { T: "parked" } };
  const plan = reconstructResumePlan(led, {
    R: { resumeStore: true },
    P: { buildComplete: true, branchExists: true },
    M: { buildComplete: true, branchExists: false },
  });
  assert.deepEqual(plan.continue_review, ["R"]);
  assert.deepEqual(plan.continue_from_push, ["P"]);
  assert.ok(plan.park.some((p) => p.issue === "M" && p.divergence.class === "recorded-branch-missing"));
  assert.ok(plan.terminal.includes("T")); // terminal-non-shipped kept, never resurrected
  assert.equal(plan.drain_remainder, true);
});

// ---------------------------------------------------------------------------
// Ledger-apply — additive, epoch-fenced, abort-cleared (AC aborted-resumable continuation).
// ---------------------------------------------------------------------------
test("applyResumeToLedger: additive re-entry, epoch++, abort→history, stop_reason cleared, pure input", () => {
  const before = {
    run_id: "R", admitted: ["A"], outcomes: { A: "shipped" },
    owner: { status: "aborted-resumable", session_id: "old", epoch: 0, started_at: "t0" },
    abort: { status: "aborted-resumable", signal: "sentry-abort", wip_commit: "cafe" },
    stop_reason: "sentry-abort",
    budget: { envelope: { ceilings: {} } },
  };
  const snapshot = JSON.stringify(before);
  const plan = reconstructResumePlan(before, { A: { reconcile: null } });
  const { ledger: after, epoch } = applyResumeToLedger(before, {
    nowIso: "t1", sessionId: "new", pid: 9, priorState: "aborted-resumable", plan,
  });
  assert.equal(JSON.stringify(before), snapshot, "input ledger not mutated");
  assert.equal(epoch, 1);
  assert.equal(after.owner.epoch, 1);
  assert.equal(after.owner.session_id, "new");
  assert.equal(after.owner.status, "running");
  assert.equal(after.owner_history.length, 1);
  assert.equal(after.owner_history[0].session_id, "old");
  assert.equal(after.abort, undefined);
  assert.equal(after.abort_history.length, 1);
  assert.equal(after.abort_history[0].wip_commit, "cafe");
  assert.equal(after.stop_reason, undefined);
  assert.equal(after.resume.length, 1);
  assert.equal(after.resume[0].prior_state, "aborted-resumable");
  assert.deepEqual(after.resume[0].plan_summary.skipped_shipped, ["A"]);
  assert.equal(after.run_id, "R"); // same run_id — continued, not copied
});

test("applyResumeToLedger: pre-527 ledger (no epoch) → epoch 1; repeated resume 1→2 append-only", () => {
  const plan = reconstructResumePlan({ admitted: [] }, {});
  const { ledger: r1, epoch: e1 } = applyResumeToLedger({ run_id: "R", owner: { status: "running", session_id: "s" }, admitted: [], outcomes: {} }, { nowIso: "t1", sessionId: "a", pid: 1, priorState: "dead-running", plan });
  assert.equal(e1, 1);
  const { ledger: r2, epoch: e2 } = applyResumeToLedger(r1, { nowIso: "t2", sessionId: "b", pid: 2, priorState: "dead-running", plan });
  assert.equal(e2, 2);
  assert.equal(r2.owner_history.length, 2);
  assert.equal(r2.resume.length, 2);
});

// ---------------------------------------------------------------------------
// Owner-epoch write fence (takeover safety).
// ---------------------------------------------------------------------------
test("ownerEpochFenceStale: mismatched epoch/session yields; matching / unfenced never stale", () => {
  assert.equal(ownerEpochFenceStale({ epoch: 1, session_id: "new" }, { epoch: 0, session_id: "old" }), true);
  assert.equal(ownerEpochFenceStale({ epoch: 0, session_id: "x" }, { epoch: 0, session_id: "y" }), true); // same epoch, diff session
  assert.equal(ownerEpochFenceStale({ epoch: 0, session_id: "x" }, { epoch: 0, session_id: "x" }), false);
  assert.equal(ownerEpochFenceStale({}, undefined), false); // unfenced caller never stale
  assert.equal(ownerEpochFenceStale({ epoch: 0 }, { epoch: 0 }), false); // pre-527 (no epoch) default-0
});

test("atomicWriteLedgerFenced: a stale writer YIELDS (no write, no crash); a clean writer writes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-527-fence-"));
  // seed the on-disk ledger owned by epoch 1 (a newer resume took over)
  fs.writeFileSync(path.join(dir, "run-ledger.json"), JSON.stringify({ run_id: "R", owner: { epoch: 1, session_id: "new" } }, null, 2) + "\n");
  const stale = atomicWriteLedgerFenced(dir, { run_id: "R", owner: { epoch: 0, session_id: "old" }, clobbered: true }, { epoch: 0, session_id: "old" });
  assert.equal(stale.yielded, true);
  assert.equal(stale.written, false);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "run-ledger.json"), "utf8"));
  assert.equal(onDisk.clobbered, undefined, "stale writer did not clobber the resumed ledger");
  assert.equal(onDisk.owner.epoch, 1);
  // the owning writer (epoch 1) writes cleanly
  const ok = atomicWriteLedgerFenced(dir, { run_id: "R", owner: { epoch: 1, session_id: "new" }, updated: true }, { epoch: 1, session_id: "new" });
  assert.equal(ok.written, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "run-ledger.json"), "utf8")).updated, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Budget session-accumulation (shape (a)) — never undercount (AC escalation re-entry).
// ---------------------------------------------------------------------------
test("budget sessions: closed-span delta + open-span baseline, spend = Σ closed + current", () => {
  const baseline = { m1: { input: 100, output: 0, cache_write: 0, cache_read: 0 } };
  const measured = new Map([["m1", { input: 350, output: 0, cache_write: 0, cache_read: 0 }]]);
  const closed = closeSpanDeltaByModel(baseline, measured);
  assert.equal(closed.m1.input, 250); // 350 − 100

  const sessions = [
    { session_id: "s0", baseline_by_model_class: baseline, closed_delta_by_model_class: closed, closed_at: "t1", close_source: "transcript" },
    { session_id: "s1", baseline_by_model_class: { m1: { input: 350, output: 0, cache_write: 0, cache_read: 0 } }, closed_delta_by_model_class: null, closed_at: null, close_source: null },
  ];
  assert.equal(closedSessionsSpend(sessions).total, 250); // only the closed span
  assert.equal(currentOpenSpan(sessions).session_id, "s1"); // last null-delta span
  assert.equal(byModelClassTotal(sessions[1].baseline_by_model_class), 350); // open-span baseline total
});

test("budget check: a sessions-bearing ledger reports Σ closed deltas + current-span delta (never zero-closed)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-527-budget-"));
  const runDir = path.join(dir, ".faff", "runs", "run-b");
  fs.mkdirSync(runDir, { recursive: true });
  // A closed span of 1,000,000 tokens; current open span baseline == its own measure ⇒ current delta 0.
  // The estimate path (no transcript in this hermetic dir) still adds the closed 1,000,000 on top.
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({
    run_id: "run-b", level: "L4", admitted: ["A"], outcomes: { A: "shipped" },
    owner: { status: "running", session_id: "s1", epoch: 1, started_at: "2026-07-17T00:00:00Z" },
    budget: {
      envelope: { ceilings: { tokens: 5000000 }, pricing: "map" },
      sessions: [
        { session_id: "s0", baseline_by_model_class: {}, closed_delta_by_model_class: { "claude-sonnet-4-6": { input: 1000000, output: 0, cache_write: 0, cache_read: 0 } }, closed_at: "t1", close_source: "transcript" },
        { session_id: "s1", baseline_by_model_class: {}, closed_delta_by_model_class: null, closed_at: null, close_source: null },
      ],
    },
  }, null, 2) + "\n");
  const r = runCli(["budget", "check", "--run-dir", runDir, "--json"], { cwd: dir, env: { ...process.env, CLAUDE_CODE_SESSION_ID: "s1" } });
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.ok(out.spent.tokens >= 1000000, `closed span spend carried forward (got ${out.spent.tokens})`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Event registration + shape (spec §3, DoD).
// ---------------------------------------------------------------------------
test("run-resume event: registered in DELIVERY_PROFILE.event_types and validates via eventViolations", () => {
  assert.ok(DELIVERY_PROFILE.event_types.includes("run-resume"));
  const evt = runResumeEvent("R", 7, "2026-07-17T00:00:00Z", "dead-running", { epoch: 1, skip: ["A"], redispatch: ["B"] });
  assert.equal(evt.seq, 7); // continues the seq stream
  assert.equal(evt.type, "run-resume");
  assert.deepEqual(evt.skipped_shipped, ["A"]);
  assert.deepEqual(evt.rebuilt_coarse, ["B"]);
  assert.deepEqual(eventViolations(evt, true), [], "valid schema-1 run-resume event");
  // not registered ⇒ would be rejected (proves the registration is load-bearing)
  assert.ok(eventViolations({ ...evt, type: "run-resume-nope" }, true).length > 0);
});

test("renderResumeBanner: names epoch, coarse-rebuild warning, and surfaces (never applies) wip_commit", () => {
  const plan = reconstructResumePlan({ admitted: ["G"], outcomes: {} }, { G: {} });
  const banner = renderResumeBanner("run-x", "aborted-resumable", 1, plan, "deadbee");
  assert.match(banner, /RE-ENTRY — run-x/);
  assert.match(banner, /epoch 1/);
  assert.match(banner, /coarse rebuild/);
  assert.match(banner, /deadbee/);
  assert.match(banner, /never auto-applied/);
});

// ---------------------------------------------------------------------------
// CLI arg + refusal seam (the proceed/mint-write path is preflight-refused in this host).
// ---------------------------------------------------------------------------
test("CLI: --resume + --id is exit 2; a missing run is exit 2; --check writes nothing", () => {
  assert.equal(runCli(["lights-out", "--resume", "run-a", "--id", "run-b", "--json"]).code, 2);
  assert.equal(runCli(["lights-out", "--resume", "no-such-run", "--json"]).code, 2);

  // a done-clean run refuses at classification (exit 2), ledger untouched
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-527-cli-"));
  const runDir = path.join(dir, ".faff", "runs", "run-done");
  fs.mkdirSync(runDir, { recursive: true });
  const ledgerPath = path.join(runDir, "run-ledger.json");
  fs.writeFileSync(ledgerPath, JSON.stringify({ run_id: "run-done", level: "L4", admitted: ["A"], outcomes: { A: "shipped" }, owner: { status: "done", session_id: "s" } }, null, 2) + "\n");
  const before = fs.readFileSync(ledgerPath, "utf8");
  const doneRes = runCli(["lights-out", "--resume", "run-done", "--json", "--root", dir]);
  assert.equal(doneRes.code, 2);
  assert.match(JSON.parse(doneRes.stdout.trim().split("\n").pop()).error, /not in a re-enterable state/);
  assert.equal(fs.readFileSync(ledgerPath, "utf8"), before, "refused resume left the ledger byte-identical");
  fs.rmSync(dir, { recursive: true, force: true });
});
