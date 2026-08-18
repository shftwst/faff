// FAFF-864 — `faff effects declare/observe/check` accept `--run-dir <dir>` as an
// alternative to `--run`, so a human landing a build-complete PR can declare into the
// SAME committed anchor dir `faff merge-gate --run-dir .faff/anchors/<run>` reads and
// writes its observe — one shared ledger, coverage holds. Exercises the real CLI (per
// ADR 0002), modelling the FAFF-591 sibling test's setup shape.
//
// The load-bearing case is the FRESH CHECKOUT: `.faff/anchors/<run>/` is committed and
// present, `.faff/runs/<run>/` does NOT exist (it is gitignored), so the pre-FAFF-864
// `--run` declare would exit 3 "run dir missing" before the merge ran.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A repo checked out at a PR head: the committed anchor `.faff/anchors/<run>/` is present,
// but `.faff/runs/<run>/` (gitignored) is absent — the fresh-checkout shape.
function setup(run) {
  const root = mkdtempSync(path.join(tmpdir(), "faff864-eff-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  const anchorDir = path.join(root, ".faff", "anchors", run);
  mkdirSync(anchorDir, { recursive: true });
  return { root, anchorDir, rel: path.join(".faff", "anchors", run) };
}

const MERGE_PR7 = JSON.stringify({ kind: "merge", target: "pr:7" });

test("fresh checkout: declare→observe→check via --run-dir against the committed anchor, no live run dir (FAFF-864)", () => {
  const { root, anchorDir, rel } = setup("run-A");
  try {
    assert.equal(existsSync(path.join(root, ".faff", "runs")), false, "precondition: no live run dir on a fresh checkout");

    const d = runCli(["effects", "declare", "--run-dir", rel, "--issue", "FAFF-864", "--step", "merge", "--ts", "t"], { cwd: root, input: MERGE_PR7 });
    assert.equal(d.code, 0, d.stderr);
    const ledger = path.join(anchorDir, "declared-effects.jsonl");
    assert.ok(existsSync(ledger), "declare lands in the anchor dir's ledger");
    const rec0 = JSON.parse(readFileSync(ledger, "utf8").trim().split("\n")[0]);
    assert.equal(rec0.run_id, "run-A", "run_id derives from the anchor dir basename");
    assert.equal(rec0.seq, 0);
    assert.equal(rec0.kind_of_entry, "declare");

    const o = runCli(["effects", "observe", "--run-dir", rel, "--issue", "FAFF-864", "--step", "merge", "--ts", "t"], { cwd: root, input: MERGE_PR7 });
    assert.equal(o.code, 0, o.stderr);
    const lines = readFileSync(ledger, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "declare seq0 + observe seq1 in ONE ledger");
    assert.equal(JSON.parse(lines[1]).seq, 1);

    // the merge is covered by the declaration — no escaped side-effect
    const c = runCli(["effects", "check", "--run-dir", rel, "--issue", "FAFF-864", "--json"], { cwd: root });
    assert.equal(c.code, 0, c.stderr);
    assert.equal(JSON.parse(c.stdout).any_escape, false, "declare covers the observed merge → no escape");

    // and the chain verifies (verify already accepts --run-dir)
    const v = runCli(["effects", "verify", "--run-dir", rel], { cwd: root });
    assert.equal(v.code, 0, v.stderr);
    assert.match(v.stdout, /verified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--run and --run-dir together is a caller error (exit 2, writes nothing) (FAFF-864)", () => {
  const { root, rel, anchorDir } = setup("run-B");
  try {
    const r = runCli(["effects", "declare", "--run", "run-B", "--run-dir", rel, "--issue", "FAFF-864", "--step", "merge"], { cwd: root, input: MERGE_PR7 });
    assert.equal(r.code, 2, "both --run and --run-dir → exit 2");
    assert.match(r.stderr, /not both/);
    assert.equal(existsSync(path.join(anchorDir, "declared-effects.jsonl")), false, "nothing written on the caller error");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("neither --run nor --run-dir is a caller error (exit 2) (FAFF-864)", () => {
  const { root } = setup("run-C");
  try {
    const d = runCli(["effects", "declare", "--issue", "FAFF-864", "--step", "merge"], { cwd: root, input: MERGE_PR7 });
    assert.equal(d.code, 2, "declare with neither → exit 2");
    assert.match(d.stderr, /one of --run <id> or --run-dir <dir>/);
    const c = runCli(["effects", "check", "--json"], { cwd: root });
    assert.equal(c.code, 2, "check with neither → exit 2");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a trailing-slash --run-dir resolves to the same run_id as the no-slash form (FAFF-864)", () => {
  const { root, rel, anchorDir } = setup("run-D");
  try {
    const r = runCli(["effects", "declare", "--run-dir", rel + path.sep, "--issue", "FAFF-864", "--step", "merge", "--ts", "t"], { cwd: root, input: MERGE_PR7 });
    assert.equal(r.code, 0, r.stderr);
    const rec = JSON.parse(readFileSync(path.join(anchorDir, "declared-effects.jsonl"), "utf8").trim().split("\n")[0]);
    assert.equal(rec.run_id, "run-D", "path.basename strips the trailing slash → identical run_id");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("check --run-dir against an existing dir with no ledger yet reads clean (FAFF-864)", () => {
  const { root, rel } = setup("run-E");
  try {
    const c = runCli(["effects", "check", "--run-dir", rel, "--issue", "FAFF-864", "--json"], { cwd: root });
    assert.equal(c.code, 0, "no ledger yet is a clean state, not exit 3");
    assert.equal(JSON.parse(c.stdout).any_escape, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a missing --run-dir target fails loud (exit 3), never a create-if-missing (FAFF-864)", () => {
  const { root } = setup("run-F");
  try {
    const missing = path.join(".faff", "anchors", "run-does-not-exist");
    const d = runCli(["effects", "declare", "--run-dir", missing, "--issue", "FAFF-864", "--step", "merge"], { cwd: root, input: MERGE_PR7 });
    assert.equal(d.code, 3, "a mistyped/absent anchor exits 3");
    assert.match(d.stderr, /run dir missing/);
    assert.equal(existsSync(path.join(root, missing)), false, "the dir was NOT created");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("existing --run callers are unregressed: declare/check via --run against a live run dir (FAFF-864 no-regression)", () => {
  const { root } = setup("run-G");
  try {
    mkdirSync(path.join(root, ".faff", "runs", "run-G"), { recursive: true });
    const d = runCli(["effects", "declare", "--run", "run-G", "--issue", "FAFF-864", "--step", "merge", "--ts", "t"], { cwd: root, input: MERGE_PR7 });
    assert.equal(d.code, 0, d.stderr);
    assert.ok(existsSync(path.join(root, ".faff", "runs", "run-G", "declared-effects.jsonl")), "--run still resolves to .faff/runs/<run>");
    const c = runCli(["effects", "check", "--run", "run-G", "--json"], { cwd: root });
    assert.equal(c.code, 0, c.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
