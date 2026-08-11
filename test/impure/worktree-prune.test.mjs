// FAFF-762 — `faff worktree-prune`: net-new real-git/real-fs coverage (no prior test file
// anywhere in the repo exercised this against an actual dangling admin dir). Impure macOS
// lane exercise §3 row 3 — git-porcelain parsing + selective `rmSync` over a genuinely
// dangling `.git/worktrees/<id>` entry, proving the scoped-removal contract (FAFF-126):
// only the declared-own dangling entry is removed; a live worktree's admin dir is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { seedRepo } from "../helpers/seed-repo.mjs";
import { runCli } from "../helpers/run-cli.mjs";

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
