// FAFF-225 — `faff lights-out`: the L4 lights-out entry point / runner.
// Exercises the real entrypoint via runCli (shebang dispatch, arg parsing, exit codes,
// the minted ledger + persisted banner + run-start event) and the in-process pure
// preflight table via --selftest. Per ADR 0002 — assert the deterministic seam
// (token / exit / parsed JSON / on-disk artefact), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

// A throwaway repo root with a .git marker so findRoot anchors there, and a forced
// container signal so container-check resolves `contained` regardless of the host.
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-lo-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}
const CONTAINED = { ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1" };

// --selftest drives the pure preflight core in-process (proceed/refuse table, armed
// derivation, banner 1:1). Deterministic — no env/fs dependency.
test("lights-out --selftest: the preflight table passes (exit 0)", () => {
  const { stdout, code } = runCli(["lights-out", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /lights-out --selftest: ok/);
});

// Bare host (container-check not_confirmed) → refuse, no run minted, exit 1. The
// container guardrail is `absent` and the refusal names it (the cage is the
// container's job — faff detects and refuses, never self-grants).
test("lights-out: bare host (no container signal) refuses, mints nothing", () => {
  const root = tmpRoot();
  const noContainer = { ...process.env };
  delete noContainer.KUBERNETES_SERVICE_HOST;
  delete noContainer.container;
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: noContainer });
  // container-check may still resolve contained from a real host marker; only assert
  // the refuse contract when the probe genuinely yielded not_confirmed.
  const out = JSON.parse(stdout);
  if (out.container !== "contained") {
    assert.equal(code, 1, stdout);
    assert.equal(out.proceed, false);
    assert.equal(out.armed.container, "absent");
    assert.ok(out.refusals.some((r) => r.gate === "guardrail:container"));
    assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run dir minted on refusal");
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// No budget ceiling → refuse (no unbounded lights-out run), even fully contained.
test("lights-out: no budget ceiling refuses", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  assert.ok(out.refusals.some((r) => r.gate === "budget-ceiling"));
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted");
  fs.rmSync(root, { recursive: true, force: true });
});

// A configured-but-unreachable review slot refuses (unreachable == absent), rather
// than starting with the second-opinion gate silently skipped.
test("lights-out: unreachable review slot refuses (never pass+skip)", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--slot-unreachable", "review", "--json"],
    { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.ok(out.refusals.some((r) => r.gate === "review-slot"));
  fs.rmSync(root, { recursive: true, force: true });
});

// A down spec_review slot (its CLI contract live) → degraded armed-state + refuse.
test("lights-out: down spec_review slot → degraded + refuse", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--slot-unreachable", "spec_review", "--json"],
    { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.armed.spec_review, "degraded");
  assert.ok(out.refusals.some((r) => r.gate === "spec_review-slot"));
  fs.rmSync(root, { recursive: true, force: true });
});

// --check: would-proceed but mints NOTHING (a side-effect-free preflight probe).
test("lights-out --check: passes preflight without minting a run", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--check", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.equal(out.checked, true);
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "--check mints nothing");
  fs.rmSync(root, { recursive: true, force: true });
});

// Proceed path: mint a strict-defaults L4 run-ledger (armed:Map<Guardrail,State>),
// persist the banner derivable 1:1 from armed, and emit a run-start event.
test("lights-out: proceed mints an L4 run-ledger + banner + run-start event", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--json"],
    { env: { ...CONTAINED, FAFF_SESSION_ID: "test-lo" } });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.proceed, true);
  assert.equal(out.level, "L4");
  assert.equal(out.container, "contained");
  // all 8 guardrails live, armed covers exactly the 8.
  assert.equal(Object.keys(out.armed).length, 8);
  assert.ok(Object.values(out.armed).every((s) => s === "live"));

  const ledgerPath = path.join(out.run_dir, "run-ledger.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(ledger.level, "L4");
  assert.deepEqual(ledger.armed, out.armed);
  assert.equal(ledger.owner.status, "running");
  assert.equal(ledger.owner.session_id, "test-lo");
  assert.deepEqual(ledger.admitted, []);
  assert.deepEqual(ledger.outcomes, {});
  assert.equal(ledger.budget_ceiling.max_attempts, 5);
  // banner persisted (not just printed) and derivable 1:1 from armed.
  assert.equal(ledger.banner, out.banner);
  for (const id of Object.keys(out.armed)) assert.ok(ledger.banner.includes(id), `banner names ${id}`);

  // run-start event emitted onto the observability timeline.
  const events = fs.readFileSync(path.join(out.run_dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run-start");
  assert.equal(events[0].phase, "run");
  assert.equal(events[0].run_id, out.run_id);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-305 — banner honesty: the proceed path reports each guardrail's enforcement
// state (reachable vs enforced), distinct from armed reachability. `holdout` is
// reachable-but-not-enforced (no orchestrator invokes it), so it must NOT count as
// enforced and the status line must say so — while `proceed` is unchanged (banner
// honesty only, never gated on enforcement).
test("lights-out: proceed reports enforced map (7/8) + ledger carries it", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: CONTAINED });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.proceed, true); // enforcement does not gate — identical to pre-change
  // enforced map: exactly the 8 ids, holdout false, the other 7 true.
  assert.equal(Object.keys(out.enforced).length, 8);
  assert.equal(out.enforced.holdout, false);
  assert.equal(Object.entries(out.enforced).filter(([id, v]) => id !== "holdout" && v === true).length, 7);
  assert.equal(Object.values(out.enforced).filter((v) => v === true).length, 7);
  // status line states 7/8 enforced and names holdout as reachable-but-not-enforced.
  assert.match(out.banner, /ARMED — 7\/8 enforced; 1 reachable-but-not-enforced: holdout/);
  // no guardrail line shows a bare "live" without an enforcement token.
  const guardrailLines = out.banner.split("\n").filter((l) => /^ {4}[●◐○] /.test(l));
  assert.equal(guardrailLines.length, 8);
  assert.ok(guardrailLines.every((l) => /\b(enforced|reachable-only)\b/.test(l)), "every line has an enforcement token");
  assert.ok(guardrailLines.some((l) => /\bholdout\b/.test(l) && /reachable:live/.test(l) && /reachable-only/.test(l)));
  // ledger persists enforced alongside armed, matching the JSON.
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.enforced, out.enforced);
  assert.equal(ledger.banner, out.banner);
  fs.rmSync(root, { recursive: true, force: true });
});

// Integration smoke: the minted ledger + events are consumed cleanly by the very
// contracts the runner composes — events validate, runcheck (clean), budget check
// (honours the recorded envelope). "If this connects, the plumbing is wired."
test("lights-out: minted run is consumed cleanly by events/runcheck/budget", () => {
  const root = tmpRoot();
  const mint = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: CONTAINED });
  const { run_dir } = JSON.parse(mint.stdout);

  const ev = runCli(["events", "validate", "--file", path.join(run_dir, "events.jsonl")]);
  assert.equal(ev.code, 0, ev.stdout + ev.stderr);

  const rc = runCli(["runcheck", run_dir]);
  assert.equal(rc.code, 0, rc.stdout + rc.stderr);
  assert.match(rc.stdout, /clean/);

  const bc = runCli(["budget", "check", "--run-dir", run_dir, "--json"]);
  assert.equal(bc.code, 0, bc.stdout + bc.stderr);
  const state = JSON.parse(bc.stdout);
  assert.equal(state.outcome, "none"); // a fresh run has breached nothing
  fs.rmSync(root, { recursive: true, force: true });
});
