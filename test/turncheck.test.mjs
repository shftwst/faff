// FAFF-854 — `faff turncheck`: the STATE-based Stop-hook backstop that makes "a headless
// turn ends only on a terminal outcome" mechanical. The fifth Stop-hook family member,
// the enumeration-based inflightcheck's complement. These tests drive the REAL entrypoint
// against fixture roots so the IMPURE shell — run-dir resolution, the heartbeat overlay,
// and above all the owner-SCOPE resolution of `hasOpenInflight` — is pinned end-to-end.
// The pure decision table is covered by `turncheck --selftest`; the pure table CANNOT
// verify that cmdTurncheck resolves the owner scope correctly (it takes hasOpenInflight as
// a boolean), so the scope-resolution cases below are the born-verifiable mitigation of the
// spec's own "wrong owner scope → double-block" failure mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// spawnSync so we capture BOTH streams: turncheck BLOCKS via a stdout decision payload and
// (foreign not-held) WARNS via a non-blocking stderr line. FAFF_RUN_DIR / FAFF_SESSION_ID
// default to "" so the test process's own env never leaks ownership; each case sets them.
function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// Build a fixture: <root>/.faff/runs/<rid>/run-ledger.json with the given owner/queue.
// Returns { root, runDir, rid }.
function fixture({ status = "running", admitted = [], outcomes = {}, hbAgoSecs = 10 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "turncheck-"));
  const rid = "run-fixture";
  const runDir = join(root, ".faff", "runs", rid);
  mkdirSync(runDir, { recursive: true });
  const hb = new Date(Date.now() - hbAgoSecs * 1000).toISOString();
  const ledger = {
    run_id: rid, level: "L2", admitted, outcomes,
    owner: { status, session_id: rid, pid: 1, started_at: hb, last_heartbeat: hb },
  };
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  return { root, runDir, rid };
}

// This-owner env: FAFF_RUN_DIR is the fixture run dir, so runIsOwned matches AND the
// inflight owner-scope is slug(FAFF_RUN_DIR).
const ownerEnv = (runDir) => ({ FAFF_RUN_DIR: runDir, FAFF_SESSION_ID: "run-fixture" });

function hook(runDir, root, env, extra = []) {
  return run(["turncheck", runDir, "--hook", "--root", root, ...extra], env);
}

test("owned + running + empty queue + NO markers → blocks (the mid-prep-death residual)", () => {
  const { root, runDir } = fixture();
  const r = hook(runDir, root, ownerEnv(runDir));
  assert.equal(r.code, 0, "block rides the payload, exit stays 0");
  const payload = JSON.parse(r.out.trim());
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, /non-terminal turn-end/i);
});

test("owned + running + an OPEN inflight marker under THIS owner's scope → SILENT (defers to inflightcheck; scope MATCH)", () => {
  const { root, runDir } = fixture();
  const env = ownerEnv(runDir);
  // Open a marker under the SAME owner-scope (same FAFF_RUN_DIR) turncheck will resolve.
  assert.equal(run(["inflightcheck", "--open", "--key", "FAFF-854", "--root", root], env).code, 0);
  const r = hook(runDir, root, env);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "", "an open marker for THIS owner defers to inflightcheck — no turncheck block (no double-block)");
});

test("owned + running + only a STALE corpse marker under THIS owner's scope → STILL blocks (order-independent; inflightcheck sweeps a corpse, so turncheck must not defer to it)", () => {
  const { root, runDir } = fixture();
  const env = ownerEnv(runDir);
  assert.equal(run(["inflightcheck", "--open", "--key", "FAFF-854", "--root", root], env).code, 0);
  // Backdate the marker well past the sweep TTL — it is a corpse inflightcheck would sweep, not block.
  const base = join(root, ".faff", "inflight");
  let marker = null;
  for (const scope of readdirSync(base)) { const p = join(base, scope, "FAFF-854.json"); if (existsSync(p)) marker = p; }
  assert.ok(marker, "marker written");
  const m = JSON.parse(readFileSync(marker, "utf8"));
  m.opened_at = new Date(Date.now() - 100000 * 1000).toISOString();
  writeFileSync(marker, JSON.stringify(m));
  const r = hook(runDir, root, env);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.out.trim());
  assert.equal(payload.decision, "block", "a stale corpse marker is not a live in-flight dispatch — turncheck owns the residual regardless of hook order");
});

test("owned + running + a marker under a DIFFERENT (foreign) scope only → STILL blocks (foreign markers excluded from hasOpenInflight; scope resolution)", () => {
  const { root, runDir } = fixture();
  // Open a marker under a FOREIGN owner-scope (a different FAFF_RUN_DIR), then audit as the real owner.
  assert.equal(run(["inflightcheck", "--open", "--key", "OTHER-1", "--root", root], { FAFF_RUN_DIR: "/some/other/run" }).code, 0);
  const r = hook(runDir, root, ownerEnv(runDir));
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.out.trim());
  assert.equal(payload.decision, "block", "a foreign-scope marker is NOT this owner's open dispatch — turncheck still blocks the residual");
});

test("owned + owner.status done → silent (terminal owner, nothing to guard)", () => {
  const { root, runDir } = fixture({ status: "done", admitted: ["A"], outcomes: { A: "shipped" } });
  const r = hook(runDir, root, ownerEnv(runDir));
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "", "a closed run does not block");
});

test("owned + running + DIRTY queue (undispatched admitted) → silent (runcheck owns this; no double-block)", () => {
  const { root, runDir } = fixture({ admitted: ["A"], outcomes: {} });
  const r = hook(runDir, root, ownerEnv(runDir));
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "", "a dirty queue is runcheck's job — turncheck defers");
});

test("FOREIGN session (env does not own the run) + running + stale heartbeat → WARN, never a hard block", () => {
  const { root, runDir } = fixture({ hbAgoSecs: 100000 });
  // No FAFF_RUN_DIR match and no FAFF_SESSION_ID match → foreign; stale heartbeat → not held.
  const r = hook(runDir, root, {});
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "", "a foreign session is never hard-blocked");
  assert.match(r.err, /\[warn\]/, "a foreign abandoned run is surfaced as a non-blocking warn");
});

test("--selftest passes (the pure decision table)", () => {
  const r = run(["turncheck", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});
