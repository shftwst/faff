// FAFF-248/259 — `faff project-next`: the container (project | parent-issue)
// state-coherence + DoD-gated-Done transition predicate. PURE — zero tracker/network
// calls (parity with eligible/next/contain). The /faff-tidy orchestrator-lane sweep
// maps a container's live status category + child-issue rollup into flags; the
// CLI returns the forward-only transition. Drives the real entrypoint, like
// contain.test.mjs / intakecheck.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}
// Convenience: build a project-next invocation from a rollup.
function pn({ current, kind, total, active, done, hasDod, dodMet }) {
  const a = ["project-next", "--current", current, "--total", String(total), "--active", String(active), "--done", String(done), "--json"];
  if (kind) a.push("--kind", kind);
  if (hasDod) a.push("--has-dod");
  if (dodMet) a.push("--dod-met");
  return run(...a);
}
function verdict(r) { assert.equal(r.code, 0, r.err); return JSON.parse(r.out); }

const RANK = { planned: 0, started: 1, completed: 2 };

test("project-next --selftest passes (transition + malformed + monotonicity table)", () => {
  const r = run("project-next", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

// --- project → In Progress (first child starts) ---

test("planned project with a first active child advances to started", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 3, active: 1, done: 0 }));
  assert.deepEqual(v, { kind: "project", current: "planned", desired: "started", action: "advance", reason: "first child started" });
});

test("planned project with some-done-not-all advances to started (work underway)", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 3, active: 0, done: 1 }));
  assert.equal(v.action, "advance");
  assert.equal(v.desired, "started");
});

// --- parent issue → In Progress (any child in progress) ---

test("planned parent ISSUE with an active child advances to started", () => {
  const v = verdict(pn({ current: "planned", kind: "issue", total: 2, active: 1, done: 0 }));
  assert.deepEqual(v, { kind: "issue", current: "planned", desired: "started", action: "advance", reason: "first child started" });
});

// --- project → Done (all children done, NO DoD) ---

test("started project with ALL children done and NO DoD advances to completed", () => {
  const v = verdict(pn({ current: "started", kind: "project", total: 2, active: 0, done: 2 }));
  assert.deepEqual(v, { kind: "project", current: "started", desired: "completed", action: "advance", reason: "all children done — state-coherence (no DoD)" });
});

test("planned project that jumped straight to all-children-done (no DoD) advances to completed", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 2, active: 0, done: 2 }));
  assert.equal(v.action, "advance");
  assert.equal(v.desired, "completed");
});

// --- project → Done (all children done, HAS DoD — the FAFF-259 release-gate half) ---

test("REGRESSION (no-DoD): started project with ALL children done and NO DoD still advances unchanged", () => {
  const v = verdict(pn({ current: "started", kind: "project", total: 2, active: 0, done: 2 }));
  assert.deepEqual(v, { kind: "project", current: "started", desired: "completed", action: "advance", reason: "all children done — state-coherence (no DoD)" });
});

test("started project with ALL children done, has-dod, and the release gate UNMET is held open (exact reason pinned)", () => {
  const v = verdict(pn({ current: "started", kind: "project", total: 2, active: 0, done: 2, hasDod: true }));
  assert.deepEqual(v, { kind: "project", current: "started", desired: "started", action: "noop", reason: "all-children-done: release gate not passed — held open (DoD authoritative)" });
});

test("planned project with ALL children done, has-dod, and the release gate UNMET is held open", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 2, active: 0, done: 2, hasDod: true }));
  assert.equal(v.action, "noop");
  assert.equal(v.desired, "planned");
  assert.match(v.reason, /held open \(DoD authoritative\)/);
});

test("started project with ALL children done, has-dod, and the release gate MET advances to completed (exact reason pinned)", () => {
  const v = verdict(pn({ current: "started", kind: "project", total: 2, active: 0, done: 2, hasDod: true, dodMet: true }));
  assert.deepEqual(v, { kind: "project", current: "started", desired: "completed", action: "advance", reason: "all children done and release gate passed (DoD-gated Done)" });
});

test("planned project with ALL children done, has-dod, and the release gate MET advances straight to completed", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 2, active: 0, done: 2, hasDod: true, dodMet: true }));
  assert.equal(v.action, "advance");
  assert.equal(v.desired, "completed");
  assert.match(v.reason, /DoD-gated Done/);
});

test("MALFORMED: --dod-met without --has-dod is a usage error (exit 2), never silently ignored", () => {
  const r = pn({ current: "started", kind: "project", total: 2, active: 0, done: 2, dodMet: true });
  assert.equal(r.code, 2);
  assert.match(r.err, /--dod-met requires --has-dod/);
});

test("parent ISSUE with ALL children done does NOT auto-Done (parent-issue Done out of scope)", () => {
  const v = verdict(pn({ current: "started", kind: "issue", total: 2, active: 0, done: 2 }));
  assert.equal(v.action, "noop");
  assert.match(v.reason, /out of scope/);
});

// --- idempotency / no-op cases ---

test("already-started project is an idempotent noop (re-running the sweep is safe)", () => {
  const v = verdict(pn({ current: "started", kind: "project", total: 3, active: 2, done: 0 }));
  assert.equal(v.action, "noop");
});

test("empty container (no children) is a noop — nothing to derive", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 0, active: 0, done: 0 }));
  assert.equal(v.action, "noop");
  assert.match(v.reason, /no children/);
});

test("planned project with no started signal yet is a noop", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 3, active: 0, done: 0 }));
  assert.equal(v.action, "noop");
});

// --- monotonicity / no-backward guarantee ---

test("a completed container is never auto-reverted (terminal), even with a new backlog child", () => {
  const v = verdict(pn({ current: "completed", kind: "project", total: 3, active: 1, done: 0 }));
  assert.equal(v.action, "noop");
  assert.match(v.reason, /terminal/);
});

test("a cancelled container is never auto-reverted (terminal)", () => {
  const v = verdict(pn({ current: "cancelled", kind: "project", total: 3, active: 1, done: 0 }));
  assert.equal(v.action, "noop");
  assert.match(v.reason, /terminal/);
});

test("MONOTONICITY: no advance over the input grid ever ranks desired <= current (never backward), dodMet in {false,true}", () => {
  let advances = 0;
  for (const current of ["planned", "started", "completed", "cancelled"]) {
    for (const kind of ["project", "issue"]) {
      for (const [total, active, done] of [[0,0,0],[1,0,0],[1,1,0],[2,1,0],[2,0,2],[3,0,1],[3,1,2],[1,0,1],[4,2,1],[5,1,4]]) {
        for (const hasDod of [false, true]) {
          for (const dodMet of [false, true]) {
            const r = pn({ current, kind, total, active, done, hasDod, dodMet });
            if (r.code !== 0) continue; // malformed rollup (incl. dodMet-without-hasDod) → usage exit, not a transition
            const v = JSON.parse(r.out);
            if (v.action === "advance") {
              advances++;
              assert.ok(RANK[v.desired] > RANK[v.current], `backward/equal advance: ${JSON.stringify(v)}`);
            }
          }
        }
      }
    }
  }
  assert.ok(advances > 0, "grid should exercise at least one advance");
});

// --- purity + usage ---

test("the command is PURE — a real verdict computes offline with no tracker/network", () => {
  const v = verdict(pn({ current: "planned", kind: "project", total: 1, active: 1, done: 0 }));
  assert.equal(v.action, "advance");
});

test("defaults --kind to project when omitted", () => {
  const r = run("project-next", "--current", "planned", "--total", "2", "--active", "1", "--done", "0", "--json");
  const v = verdict(r);
  assert.equal(v.kind, "project");
});

test("a malformed rollup (active+done > total) is a usage error, no verdict (exit 2)", () => {
  const r = run("project-next", "--current", "started", "--total", "1", "--active", "2", "--done", "0");
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot exceed/);
});

test("an unknown --current category is a usage error (exit 2)", () => {
  const r = run("project-next", "--current", "nope", "--total", "1", "--active", "0", "--done", "0");
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown --current/);
});

test("an unknown --kind is a usage error (exit 2)", () => {
  const r = run("project-next", "--current", "planned", "--kind", "epic", "--total", "1", "--active", "0", "--done", "0");
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown --kind/);
});

test("a negative count is a usage error (exit 2)", () => {
  const r = run("project-next", "--current", "planned", "--total", "-1", "--active", "0", "--done", "0");
  assert.equal(r.code, 2);
  assert.match(r.err, /non-negative integer/);
});
