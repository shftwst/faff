// FAFF-762 — `faff state`: net-new impure coverage — this subcommand has NO `--selftest`
// branch anywhere in the repo, so it was entirely untested on macOS (and, until now, under
// this exact fixture shape on any OS). Impure macOS lane exercise §3 row 4 — readdir/stat/
// readFile plus two real `git` spawns (resolveGit) against a seeded tree with a committed
// spec, a matching branch, and a run ledger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedRepo } from "../helpers/seed-repo.mjs";
import { runCli } from "../helpers/run-cli.mjs";

test("faff state <issue> --json reports populated spec/git/ledger fields from a real seeded tree", () => {
  const { root, teardown } = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x\n" } }],
    branches: ["faff-9999-widget"],
    specs: [{ issue: "FAFF-9999", location: "committed", body: "confidence: high\n" }],
    runs: [{ runId: "run-1", ledger: { run_id: "run-1", outcomes: { "FAFF-9999": "shipped" } } }],
  });
  try {
    const { stdout, code } = runCli(["state", "FAFF-9999", "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const record = JSON.parse(stdout);
    assert.equal(record.issue, "FAFF-9999");
    assert.equal(record.spec, "high", "the committed spec's confidence line must be parsed");
    assert.ok(record.spec_source && record.spec_source.includes("FAFF-9999"), "spec_source must point at the committed spec file");
    assert.equal(record.branch, "faff-9999-widget", "the matching local branch must be found");
    assert.equal(record.parked, false);
    assert.equal(record.ledger_outcome, "shipped", "the run-ledger outcome for this issue must be resolved");
    assert.equal(record.ledger_run, "run-1");
    // tracker-only fields are always the literal "unknown" from this local-only read model.
    assert.equal(record.status, "unknown");
    assert.equal(record.eligible, "unknown");
    assert.equal(record.blocked, "unknown");
  } finally {
    teardown();
  }
});

test("faff state <issue> --json reports spec: none and branch: null when nothing matches", () => {
  const { root, teardown } = seedRepo({ commits: [{ message: "init", files: { "README.md": "x\n" } }] });
  try {
    const { stdout, code } = runCli(["state", "FAFF-0000", "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const record = JSON.parse(stdout);
    assert.equal(record.spec, "none");
    assert.equal(record.branch, null);
    assert.equal(record.worktree, null);
    assert.equal(record.parked, false);
    assert.equal(record.ledger_outcome, null);
  } finally {
    teardown();
  }
});

test("faff state with a missing <issue> positional exits 2", () => {
  const { root, teardown } = seedRepo({ commits: [{ message: "init", files: { "README.md": "x\n" } }] });
  try {
    const { code, stderr } = runCli(["state"], { cwd: root });
    assert.equal(code, 2);
    assert.match(stderr, /issue/i);
  } finally {
    teardown();
  }
});
