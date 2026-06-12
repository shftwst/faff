// FAFF-90 — Seeded-repo substrate: self-test.
//
// Exercises seedRepo through the REAL `faff state` read seam (the system under test):
// seed a fixed git/.faff tree, run `faff state <issue> --root <root>`, assert the
// deterministic JSON. Zero-dep: node:test + node:assert + the run-cli helper. Per ADR 0002.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { runCli } from "./helpers/run-cli.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";

const state = (issue, root) => {
  const { stdout, code } = runCli(["state", issue, "--root", root]);
  assert.equal(code, 0, `faff state exited non-zero: ${stdout}`);
  return JSON.parse(stdout);
};

// ── Integration smoke test (spec §smoke "plumbing connected end-to-end") ────────
test("smoke: real git + .faff seeding read back through faff state, deterministically", () => {
  const mkspec = () => ({
    defaultBranch: "main",
    commits: [{ message: "init", files: { "README.md": "x" } }],
    branches: ["feat/FAFF-90-seed"],
    worktree: { branch: "feat/FAFF-90-seed" },
    specs: [{ issue: "FAFF-90", location: "committed", body: "# spec\nconfidence: medium\n" }],
    runs: [
      {
        runId: "2026-01-02-test",
        ledger: { run_id: "2026-01-02-test", admitted: ["FAFF-90"], outcomes: { "FAFF-90": "shipped" } },
        parks: {},
      },
    ],
  });

  const repo = seedRepo(mkspec());
  after(repo.teardown);
  const s = state("FAFF-90", repo.root);
  assert.equal(s.issue, "FAFF-90");
  assert.equal(s.spec, "medium");
  assert.ok(s.branch && s.branch.toLowerCase().includes("faff-90"), `branch: ${s.branch}`);
  assert.ok(s.worktree && s.worktree.includes(repo.root), `worktree: ${s.worktree}`);
  assert.equal(s.ledger_outcome, "shipped");
  assert.equal(s.parked, false);

  // Determinism: a second identical seed yields the same faff state, modulo the temp-root prefix.
  const repo2 = seedRepo(mkspec());
  after(repo2.teardown);
  const s2 = state("FAFF-90", repo2.root);
  const norm = (obj, root) => JSON.stringify(obj).split(root).join("<ROOT>");
  assert.equal(norm(s, repo.root), norm(s2, repo2.root));
});

// ── Return shape ───────────────────────────────────────────────────────────────
test("seedRepo returns { root (absolute), worktreePath, teardown }", () => {
  const repo = seedRepo({ commits: [{ message: "c", files: { "a.txt": "a" } }] });
  after(repo.teardown);
  assert.equal(typeof repo.root, "string");
  assert.ok(repo.root.startsWith("/") || /^[A-Za-z]:[\\/]/.test(repo.root), "root is absolute");
  assert.equal(repo.worktreePath, null); // no worktree requested
  assert.equal(typeof repo.teardown, "function");
});

// ── .faff-only (non-git) tree ──────────────────────────────────────────────────
test("a .faff-only tree (git:false) is seedable; branch/worktree resolve to null", () => {
  const repo = seedRepo({
    git: false,
    runs: [{ runId: "2026-01-01-r", ledger: { run_id: "2026-01-01-r", admitted: ["FAFF-90"], outcomes: { "FAFF-90": "shipped" } } }],
  });
  after(repo.teardown);
  assert.ok(!existsSync(`${repo.root}/.git`), "no .git in a non-git tree");
  const s = state("FAFF-90", repo.root);
  assert.equal(s.branch, null);
  assert.equal(s.worktree, null);
  assert.equal(s.ledger_outcome, "shipped"); // .faff still read without git
});

// ── Spec discovery (committed + git-only) ──────────────────────────────────────
test("committed spec with confidence:medium surfaces as spec: 'medium'", () => {
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    specs: [{ issue: "FAFF-90", location: "committed", body: "# spec\nconfidence: medium\n" }],
  });
  after(repo.teardown);
  assert.equal(state("FAFF-90", repo.root).spec, "medium");
});

test("git-only spec at .faff/specs/<issue>.md is discovered (and not committed)", () => {
  const repo = seedRepo({
    git: false,
    specs: [{ issue: "FAFF-90", location: "git-only", body: "# spec\nconfidence: low\n" }],
  });
  after(repo.teardown);
  assert.ok(existsSync(`${repo.root}/.faff/specs/faff-90.md`), "git-only spec written lowercased");
  assert.equal(state("FAFF-90", repo.root).spec, "low");
});

// ── Ledger + park (newest run wins) ────────────────────────────────────────────
test("run-ledger outcome surfaces; the newest (lexically-greatest run-id) run wins", () => {
  const repo = seedRepo({
    git: false,
    runs: [
      { runId: "2026-01-01-old", ledger: { run_id: "2026-01-01-old", admitted: ["FAFF-90"], outcomes: { "FAFF-90": "parked" } } },
      { runId: "2026-01-02-new", ledger: { run_id: "2026-01-02-new", admitted: ["FAFF-90"], outcomes: { "FAFF-90": "shipped" } } },
    ],
  });
  after(repo.teardown);
  const s = state("FAFF-90", repo.root);
  assert.equal(s.ledger_outcome, "shipped");
  assert.equal(s.ledger_run, "2026-01-02-new");
});

test("a seeded park.md surfaces as parked: true; newest run wins", () => {
  const repo = seedRepo({
    git: false,
    runs: [
      { runId: "2026-01-01-old", ledger: { run_id: "2026-01-01-old", admitted: [], outcomes: {} } },
      { runId: "2026-01-02-new", ledger: { run_id: "2026-01-02-new", admitted: ["FAFF-90"], outcomes: {} }, parks: { "FAFF-90": "blocked on X" } },
    ],
  });
  after(repo.teardown);
  assert.equal(state("FAFF-90", repo.root).parked, true);
});

test("ledger extra keys are passed through verbatim (tolerated)", () => {
  const repo = seedRepo({
    git: false,
    runs: [{ runId: "2026-01-01-r", ledger: { run_id: "2026-01-01-r", admitted: ["FAFF-90"], outcomes: { "FAFF-90": "shipped" }, discovered_scope_filed: 3 } }],
  });
  after(repo.teardown);
  assert.equal(state("FAFF-90", repo.root).ledger_outcome, "shipped");
});

// ── Determinism env + fail-loud ────────────────────────────────────────────────
test("a git failure during provisioning throws (seeder does NOT swallow)", () => {
  // worktree on a branch that was never created → `git worktree add` fails.
  assert.throws(() => seedRepo({ worktree: { branch: "does-not-exist" } }), /seed-repo git/);
});

// ── Teardown ───────────────────────────────────────────────────────────────────
test("teardown removes the temp dir (and worktree) and is idempotent", () => {
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    branches: ["feat/FAFF-90-wt"],
    worktree: { branch: "feat/FAFF-90-wt" },
  });
  assert.ok(existsSync(repo.root));
  assert.ok(existsSync(repo.worktreePath));
  repo.teardown();
  assert.ok(!existsSync(repo.root), "root removed");
  assert.doesNotThrow(() => repo.teardown(), "second teardown is a no-op");
});
