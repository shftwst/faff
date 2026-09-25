// FAFF-762 — `faff worktree-prune`: net-new real-git/real-fs coverage (no prior test file
// anywhere in the repo exercised this against an actual dangling admin dir). Impure macOS
// lane exercise §3 row 3 — git-porcelain parsing + selective `rmSync` over a genuinely
// dangling `.git/worktrees/<id>` entry, proving the scoped-removal contract (FAFF-126):
// only the declared-own dangling entry is removed; a live worktree's admin dir is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { seedRepo } from "../helpers/seed-repo.mjs";
import { runCli } from "../helpers/run-cli.mjs";

// FAFF-1119 — governed-record helpers for the worktree-prune declare/observe bracket.
// A run dir whose basename is the run-id the effects chain genesis derives from.
function mkRunDir(root, runId) {
  const rd = join(root, ".faff", "runs", runId);
  mkdirSync(rd, { recursive: true });
  return rd;
}

// Admit a governed run to Commissaire: appends a schema:3 admission record to the run's
// declared-effects.jsonl, so hasGovernanceContext(runDir) reads true.
function admit(root, rd, runId) {
  const r = runCli(["commissaire", "contract", "admit", "--run-dir", rd, "--producer", runId,
    "--contract-revision", "r1", "--scope", "merge,branch-delete,pr-create,push,label-write,file-write"], { cwd: root });
  assert.equal(r.code, 0, `admit failed: ${r.stderr}`);
  return rd;
}

// Read the schema:2 effect records of one kind_of_entry from a run's declared-effects.jsonl.
function readEffectRecords(rd) {
  const p = join(rd, "declared-effects.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function readBytes(rd) {
  const p = join(rd, "declared-effects.jsonl");
  return existsSync(p) ? readFileSync(p) : null;
}

test("worktree-prune --branch removes only the dangling own admin dir; a live worktree is untouched", () => {
  const { root, worktreePath, danglingAdminPath, teardown } = seedRepo({
    branches: ["feat-live"],
    worktree: { branch: "feat-live" },
    danglingWorktree: { name: "gone" },
  });
  try {
    assert.ok(danglingAdminPath, "seedRepo must resolve the dangling admin-dir id");
    assert.ok(existsSync(danglingAdminPath), "the dangling admin dir exists before pruning");
    assert.ok(existsSync(worktreePath), "the live worktree checkout exists");

    const { stdout, code } = runCli(["worktree-prune", "--branch", "gone", "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);

    assert.equal(result.pruned.length, 1, "exactly the one own-dangling entry is pruned");
    assert.ok(!existsSync(danglingAdminPath), "the dangling own admin dir must be removed");
    // The live worktree's own admin dir must survive — worktree-prune never runs a
    // repo-wide `git worktree prune`, only the declared-own dangling entries.
    assert.ok(existsSync(worktreePath), "the live worktree checkout must remain untouched");
  } finally {
    teardown();
  }
});

test("worktree-prune --dry-run reports the dangling entry without removing it", () => {
  const { root, danglingAdminPath, teardown } = seedRepo({ danglingWorktree: { name: "gone-dry" } });
  try {
    assert.ok(danglingAdminPath, "seedRepo must resolve the dangling admin-dir id");
    assert.ok(existsSync(danglingAdminPath));
    const { stdout, code } = runCli(["worktree-prune", "--branch", "gone-dry", "--dry-run", "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.dry_run, true);
    assert.ok(result.would_prune.some((p) => p.includes("gone-dry")), "dry-run must name the entry it would prune");
    assert.ok(existsSync(danglingAdminPath), "dry-run must NOT actually remove the admin dir");
  } finally {
    teardown();
  }
});

test("worktree-prune with no ownership declared prunes nothing (fail-safe default)", () => {
  const { root, danglingAdminPath, teardown } = seedRepo({ danglingWorktree: { name: "unclaimed" } });
  try {
    assert.ok(danglingAdminPath, "seedRepo must resolve the dangling admin-dir id");
    const { stdout, code } = runCli(["worktree-prune", "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.declared_ownership, false);
    assert.deepEqual(result.pruned, []);
    assert.ok(existsSync(danglingAdminPath), "with no ownership declared, the dangling admin dir must survive");
  } finally {
    teardown();
  }
});

// === FAFF-1119: governed branch-delete records around the prune =============

test("worktree-prune --run-dir on a governed run writes a schema:2 branch-delete declare/observe pair covering each removed path", () => {
  const { root, danglingAdminPath, teardown } = seedRepo({ danglingWorktree: { name: "faff-9999" } });
  try {
    const rd = admit(root, mkRunDir(root, "RUN-WTP-1"), "RUN-WTP-1");
    assert.ok(existsSync(danglingAdminPath), "the dangling own admin dir exists before pruning");

    const { stdout, code } = runCli(["worktree-prune", "--issue", "faff-9999", "--run-dir", rd, "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.pruned.length, 1, "exactly the one own-dangling entry is pruned");
    assert.ok(!existsSync(danglingAdminPath), "the dangling own admin dir must be removed");

    const s2 = readEffectRecords(rd).filter((e) => e.schema === 2 && e.step === "worktree-prune");
    const declares = s2.filter((e) => e.kind_of_entry === "declare");
    const observes = s2.filter((e) => e.kind_of_entry === "observe");
    assert.equal(declares.length, 1, "one branch-delete declare at step worktree-prune");
    assert.equal(observes.length, 1, "one branch-delete observe at step worktree-prune");
    for (const e of [...declares, ...observes]) {
      assert.equal(e.effect.kind, "branch-delete", "record kind is branch-delete");
      assert.equal(e.issue, "faff-9999");
      assert.ok(String(e.effect.target).includes("faff-9999"), `record target covers the removed path (got ${e.effect.target})`);
    }

    // computeEscapes must report the sanctioned prune as covered (declare precedes observe).
    const check = runCli(["effects", "check", "--run-dir", rd, "--issue", "faff-9999", "--json"], { cwd: root });
    assert.equal(check.code, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).any_escape, false, "a declared+observed prune is not an escape");
  } finally {
    teardown();
  }
});

test("worktree-prune on an UNGOVERNED run (no schema:3 context) writes no records", () => {
  const { root, danglingAdminPath, teardown } = seedRepo({ danglingWorktree: { name: "faff-8888" } });
  try {
    const rd = mkRunDir(root, "RUN-WTP-2"); // NOT admitted → ungoverned
    const before = readBytes(rd);
    const { code } = runCli(["worktree-prune", "--issue", "faff-8888", "--run-dir", rd, "--json"], { cwd: root });
    assert.equal(code, 0);
    assert.ok(!existsSync(danglingAdminPath), "the prune still ran (dangling dir removed)");
    assert.deepEqual(readBytes(rd), before, "declared-effects.jsonl is byte-for-byte unchanged on an ungoverned run");
    assert.equal(readEffectRecords(rd).length, 0, "no records written on an ungoverned run");
  } finally {
    teardown();
  }
});

test("worktree-prune --dry-run on a governed run writes no records", () => {
  const { root, danglingAdminPath, teardown } = seedRepo({ danglingWorktree: { name: "faff-7777" } });
  try {
    const rd = admit(root, mkRunDir(root, "RUN-WTP-3"), "RUN-WTP-3");
    const before = readBytes(rd);
    const { code } = runCli(["worktree-prune", "--issue", "faff-7777", "--run-dir", rd, "--dry-run", "--json"], { cwd: root });
    assert.equal(code, 0);
    assert.ok(existsSync(danglingAdminPath), "dry-run removes nothing");
    assert.deepEqual(readBytes(rd), before, "dry-run writes no records (byte-for-byte unchanged)");
  } finally {
    teardown();
  }
});

test("worktree-prune without --run-dir writes no records even on a governed run", () => {
  const { root, teardown } = seedRepo({ danglingWorktree: { name: "faff-6666" } });
  try {
    const rd = admit(root, mkRunDir(root, "RUN-WTP-4"), "RUN-WTP-4");
    const before = readBytes(rd);
    const { code } = runCli(["worktree-prune", "--issue", "faff-6666", "--json"], { cwd: root });
    assert.equal(code, 0);
    assert.deepEqual(readBytes(rd), before, "no --run-dir → no records (byte-for-byte unchanged)");
  } finally {
    teardown();
  }
});

test("worktree-prune with a zero-removal outcome writes no records (governed, nothing prunable)", () => {
  // No dangling worktree seeded → nothing to prune → zero removal.
  const { root, teardown } = seedRepo({});
  try {
    const rd = admit(root, mkRunDir(root, "RUN-WTP-5"), "RUN-WTP-5");
    const before = readBytes(rd);
    const { code } = runCli(["worktree-prune", "--issue", "faff-5555", "--run-dir", rd, "--json"], { cwd: root });
    assert.equal(code, 0);
    assert.deepEqual(readBytes(rd), before, "zero removal → no records (byte-for-byte unchanged)");
  } finally {
    teardown();
  }
});

test("a declare/observe append failure does not gate the prune (record-only)", () => {
  const { root, danglingAdminPath, teardown } = seedRepo({ danglingWorktree: { name: "faff-4444" } });
  let rd;
  try {
    rd = admit(root, mkRunDir(root, "RUN-WTP-6"), "RUN-WTP-6");
    // Make the run dir read-only so the ledger lock file cannot be created → append throws.
    chmodSync(rd, 0o555);
    const { stdout, code } = runCli(["worktree-prune", "--issue", "faff-4444", "--run-dir", rd, "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.pruned.length, 1, "the prune still completes despite the append failure");
    assert.ok(!existsSync(danglingAdminPath), "the dangling admin dir is removed regardless of the record");
  } finally {
    if (rd) { try { chmodSync(rd, 0o755); } catch { /* best-effort */ } }
    teardown();
  }
});
