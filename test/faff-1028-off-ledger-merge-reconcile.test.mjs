// FAFF-1028 — close the off-ledger protected-effect blind spot in `effects check`.
//
// `faff effects check` (effects.js) is a pure COMPARISON detector over the declared-effects
// ledger: it cannot see a protected merge performed entirely off the governed path (no declare,
// no observe), and an empty/missing ledger reads as CLEAN. This ticket adds the impure
// observation-side backstop `faff effects reconcile-merges`, which reads this run's landed
// merges directly from git ground truth (the protected branch's first-parent history since a
// `base_sha` recorded at run mint) and diffs them against this run's declared/observed merge
// effects — surfacing an off-ledger landing as `uncovered`/`any_escape:true` instead of clean.
//
// This suite exercises the REAL CLI entrypoint end to end (shebang dispatch, exit codes, parsed
// JSON — per ADR 0002, assert the deterministic seam, never prose), covering the spec's own
// scenarios: the incident shape (an unattributable off-ledger direct-git merge), an attributable
// off-ledger merge, coverage via attribution/target/wildcard, the legacy-exempt vs genuine-fault
// upgrade migration, and the base_sha/mint-marker wiring at the `run-ledger init-interactive`
// mint site (the one mint path this sandbox can drive end to end — `faff lights-out`'s L4 mint
// refuses admission on every real invocation here for reasons unrelated to this ticket, per
// test/lights-out.test.mjs's own header comment; that mint's identical wiring is covered by a
// source-presence assertion below instead).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const tmpDirs = [];
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
test.after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

// A throwaway git repo with a `main` branch, seeded with one commit — the fixture every scenario
// below builds on. Returns the repo dir; callers commit further via `git(...)`.
function gitRepo() {
  const dir = mkTmp("faff-1028-repo-");
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "f.txt"), "0\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed");
  return { dir, git };
}

test("effects reconcile-merges --selftest passes via the real CLI", () => {
  const r = runCli(["effects", "reconcile-merges", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});

test("effects --selftest is unaffected (the pure computeEscapes core stays untouched)", () => {
  const r = runCli(["effects", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("reconcile-merges requires exactly one of --run / --run-dir", () => {
  const none = runCli(["effects", "reconcile-merges"]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /one of --run.*--run-dir/);

  const { dir } = gitRepo();
  mkdirSync(join(dir, ".faff", "runs", "r1"), { recursive: true });
  const both = runCli(["effects", "reconcile-merges", "--run", "r1", "--run-dir", join(dir, ".faff/runs/r1")], { cwd: dir });
  assert.equal(both.code, 2);
  assert.match(both.stderr, /not both/);
});

test("--describe names the honesty condition — detection, never prevention, and the accepted limits", () => {
  const r = runCli(["effects", "reconcile-merges", "--describe"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /DETECTION/);
  assert.match(r.stdout, /never prevention/);
  assert.match(r.stdout, /Limit A/);
  assert.match(r.stdout, /Limit B/);
});

test("the incident shape: an unattributable off-ledger direct-git merge is uncovered with issue:null", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-a");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: base, base_sha_required: true }));

  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "direct-git merge, no issue key, no declare");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.reconciled, true);
  assert.equal(out.any_escape, true);
  assert.equal(out.uncovered.length, 1);
  assert.equal(out.uncovered[0].issue, null);
  assert.match(out.uncovered[0].target, /^commit:/);
});

test("an ATTRIBUTABLE off-ledger merge names its issue; declaring it covers it (attribution match)", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-b");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-500"], base_sha: base, base_sha_required: true }));

  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-500): off-ledger merge naming its own issue");

  let r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  let out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, true);
  assert.equal(out.uncovered[0].issue, "FAFF-500");

  appendFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: "FAFF-500", step: "build", effect: { kind: "merge", target: "pr:1" } }) + "\n",
  );
  r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false, "declaring the issue's merge covers it via attribution match, regardless of the declared target string");
  assert.equal(out.uncovered.length, 0);
});

test("a governed multi-commit landing is ONE covered segment — N-1 non-tip commits never surface as separate escapes", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-c");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-777"], base_sha: base, base_sha_required: true }));
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: "FAFF-777", step: "build", effect: { kind: "merge", target: "pr:9" } }) + "\n",
  );

  for (const step of ["one", "two", "three"]) {
    writeFileSync(join(dir, "f.txt"), `${step}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `feat(FAFF-777): rebase-landed step ${step}`);
  }

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false);
  assert.equal(out.uncovered.length, 0, "all three first-parent commits coalesce into one attributed, covered segment");
});

test("a commit on a feature branch that never landed on the protected branch is not a landing at all", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-featbranch");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true }));

  // A linked worktree for the feature commit — `main` in the primary `dir` is never checked out
  // away from and back, so this only exercises "a commit exists on another branch", not any
  // checkout-round-trip side effect of the test harness itself.
  const featWt = mkTmp("faff-1028-featwt-");
  execFileSync("git", ["worktree", "add", "-q", "-b", "faff-1-feature", featWt], { cwd: dir, encoding: "utf8" });
  writeFileSync(join(featWt, "f.txt"), "on-a-feature-branch\n");
  execFileSync("git", ["add", "-A"], { cwd: featWt, encoding: "utf8" });
  execFileSync("git", ["commit", "-q", "-m", "feat(FAFF-1): work in progress, not yet landed"], { cwd: featWt, encoding: "utf8" });
  execFileSync("git", ["worktree", "remove", "--force", featWt], { cwd: dir, encoding: "utf8" });

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false, "the feature-branch commit is not on main's first-parent line, so it is not a landing");
  assert.equal(out.uncovered.length, 0);
});

test("an ordinary technical token never false-extracts as a fake issue id once this run has an admitted tracker family", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-falsepositive");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true }));

  // "utf-8" and "iso-8601" both match the bare generic issue-id shape (alpha prefix + hyphen +
  // digits) — they must NOT be mistaken for a foreign issue key and silently excluded as "some
  // other run's business". A wrongly-excluded off-ledger landing is exactly the fail-open this
  // ticket exists to close.
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: bump dependency to utf-8 and iso-8601 support");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, true, "the landing must still surface — 'utf-8'/'iso-8601' are not real issue ids");
  assert.equal(out.uncovered.length, 1);
  assert.equal(out.uncovered[0].issue, null, "no fake issue id extracted — this is the genuinely-unattributable case");
});

test("a concurrent run's own off-ledger landing is attributed to it and excluded — never this run's escape, never folded into unattributable", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDirA = join(dir, ".faff", "runs", "run-1028-A");
  mkdirSync(runDirA, { recursive: true });
  // Run A admits FAFF-1 only — it never heard of FAFF-999.
  writeFileSync(join(runDirA, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true }));

  // A key-less landing (the genuine unattributable case) ...
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "direct-git, no issue key");
  // ... and a DIFFERENT run's own off-ledger merge, naming an issue run A never admitted.
  writeFileSync(join(dir, "f.txt"), "2\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-999): run B's own off-ledger merge");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDirA, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, true, "the genuinely key-less landing still trips this run's escape");
  assert.equal(out.uncovered.length, 1, "FAFF-999's landing is excluded — it belongs to a concurrent run, not folded into this run's report");
  assert.equal(out.uncovered[0].issue, null);
});

test("target cross-match: a declared pr:<N> covers a commit-only landing via a squash-style subject", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-d");
  mkdirSync(runDir, { recursive: true });
  // issue:null on purpose (no issue key in the subject) — only the target cross-match can cover it.
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: base, base_sha_required: true }));
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: null, step: "build", effect: { kind: "merge", target: "pr:42" } }) + "\n",
  );

  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "unrelated squash subject (#42)");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false, "the commit subject's (#42) resolves pr:42, cross-matching the declared pr:42");
});

test("a wildcard declaration covers any landing", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-e");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: base, base_sha_required: true }));
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: null, step: "build", effect: { kind: "merge", target: "*" } }) + "\n",
  );
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "no issue key, no pr number either");
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false);
});

test("empty ledger, no landings (base==head) stays clean — the pure empty-ledger case is unchanged", () => {
  const { dir, git } = gitRepo();
  const head = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-f");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: head, base_sha_required: true }));
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false);
  assert.equal(out.uncovered.length, 0);
});

test("a pre-feature (legacy) run — no mint marker at all — is legacy_exempt, never a fault", () => {
  const { dir } = gitRepo();
  const runDir = join(dir, ".faff", "runs", "run-1028-legacy");
  mkdirSync(runDir, { recursive: true });
  // No base_sha, no base_sha_required — exactly what a run minted before this feature carries.
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"] }));
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.legacy_exempt, true);
  assert.equal(out.reconciled, true);
  assert.equal(out.any_escape, false);
});

test("a post-feature run with the mint marker but NO base_sha is a genuine, non-clean fault", () => {
  const { dir } = gitRepo();
  const runDir = join(dir, ".faff", "runs", "run-1028-fault");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha_required: true }));
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.reconciled, false);
  assert.match(out.fault, /base anchor/);
  assert.equal(out.any_escape, false, "a fault never itself sets any_escape true — the checkpoint treats reconciled:false as non-clean separately");
});

test("--issue narrows attribution and the ledger read to a single issue", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-g");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1", "FAFF-2"], base_sha: base, base_sha_required: true }));

  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-1): off-ledger");
  writeFileSync(join(dir, "f.txt"), "2\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-2): off-ledger too");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--issue", "FAFF-1", "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.uncovered.length, 1);
  assert.equal(out.uncovered[0].issue, "FAFF-1");
});

test("--issue mode still honours a CROSS-issue target-match cover — the coverage rule's target branch is issue-agnostic by design", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-crossissue");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1", "FAFF-2"], base_sha: base, base_sha_required: true }));
  // FAFF-2 declared pr:77 — FAFF-1's own landing happens to resolve to the SAME pr number (an
  // edge case, but the coverage rule's target-match branch does not require issue equality).
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: "FAFF-2", step: "build", effect: { kind: "merge", target: "pr:77" } }) + "\n",
  );
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-1): squash landing (#77)");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--issue", "FAFF-1", "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false, "narrowing to --issue FAFF-1 must not defeat a target-match cover from a DIFFERENT issue's declaration — the coverage rule's own target branch is issue-agnostic");
});

test("with NO admitted issues at all, nothing can be confidently classified as foreign — every segment surfaces (fail-safe)", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-noadmitted");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: base, base_sha_required: true }));
  // With an EMPTY admitted set, attributeCommit falls back to the unbounded generic shape and
  // extracts "UTF-8" as a fake issue id. It must be surfaced, never silently excluded as
  // "some other run's business" — with nothing admitted, nothing can be confidently foreign.
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: bump to utf-8 encoding");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, true, "the landing must surface even though a fake issue id was extracted from an empty admitted set");
  assert.equal(out.uncovered.length, 1);
});

test("a non-canonically-cased declared issue still covers via attribution match (case-insensitive on both operands)", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-declarecase");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true }));
  // The declared entry's own `issue` field is lowercase — attributeCommit always extracts
  // uppercase, so this only covers if the comparison is case-insensitive on BOTH sides.
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: "faff-1", step: "build", effect: { kind: "merge", target: "pr:1" } }) + "\n",
  );
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-1): off-ledger");
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false, "a lowercase-cased declared issue must still cover via attribution match");
});

test("--run (not --run-dir) resolves via the same shared, worktree-aware run-dir resolver every effects subcommand uses", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  mkdirSync(join(dir, ".faff", "runs", "run-1028-viarun"), { recursive: true });
  writeFileSync(join(dir, ".faff", "runs", "run-1028-viarun", "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: base, base_sha_required: true }));
  const r = runCli(["effects", "reconcile-merges", "--run", "run-1028-viarun", "--json"], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.reconciled, true);
  assert.equal(out.any_escape, false);
});

test("--issue mode still surfaces a genuinely-unattributable landing — the incident's own shape is never dropped by the narrowing flag", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-issue-null");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true }));

  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "direct-git, no issue key");

  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--issue", "FAFF-1", "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.uncovered.length, 1, "a per-issue caller cannot itself tell whether the key-less landing was theirs, so it must still surface");
  assert.equal(out.uncovered[0].issue, null);
});

test("a base_sha that is not an ancestor of the protected branch HEAD (stale anchor) is a non-clean fault, never a flood of false escapes", () => {
  const { dir, git } = gitRepo();
  const runDir = join(dir, ".faff", "runs", "run-1028-nonancestor");
  mkdirSync(runDir, { recursive: true });
  // A base_sha from a totally disjoint history (an orphan branch) can never be an ancestor of main.
  git("checkout", "-q", "--orphan", "unrelated-history");
  writeFileSync(join(dir, "other.txt"), "unrelated\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: unrelated root commit");
  const disjointSha = git("rev-parse", "HEAD").trim();
  git("checkout", "-q", "main");

  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: disjointSha, base_sha_required: true }));
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.reconciled, false);
  assert.match(out.fault, /ancestor/);
  assert.equal(out.any_escape, false, "a stale/rewritten anchor is a named fault, never a flood of false uncovered escapes");
});

test("run-ledger init-interactive stamps base_sha + the post-feature mint marker (the real CLI mint path)", () => {
  const { dir } = gitRepo();
  const mint = runCli(["run-ledger", "init-interactive", "--issue", "FAFF-1028-MINT", "--json"], { cwd: dir });
  assert.equal(mint.code, 0, mint.stderr);
  const { run_dir } = JSON.parse(mint.stdout);
  const ledger = JSON.parse(readFileSync(join(run_dir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.base_sha_required, true);
  assert.equal(typeof ledger.base_sha, "string");
  assert.match(ledger.base_sha, /^[0-9a-f]{40}$/, "base_sha resolves to the protected branch's real HEAD sha");
});

test("run-ledger --selftest covers base_sha/mint-marker shape assertions", () => {
  const r = runCli(["run-ledger", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
  assert.match(r.stdout, /mint marker/);
});

// `faff lights-out`'s L4 mint refuses admission on every real invocation in this sandbox (no
// fakeable pid-1 container declaration — see test/lights-out.test.mjs's own header comment), so
// its `mintLightsOut` ledger object cannot be exercised end to end here. A source-presence
// assertion is the pragmatic regression guard: the L4 mint must stamp the SAME marker key and
// resolve base_sha via the SAME single-sourced run-ledger.js helper as the L2/L3 mints (never an
// independently-retyped literal that could silently drift).
test("lights-out.js's L4 mint wires the same base_sha + mint-marker fields as the L2/L3 mints", () => {
  const src = readFileSync(new URL("../plugin/skills/faff/bin/lib/lights-out.js", import.meta.url), "utf8");
  assert.match(src, /require\("\.\/run-ledger"\)/, "lights-out.js resolves the marker/helper from run-ledger.js's single source, never a re-typed literal");
  assert.match(src, /resolveMintBaseSha/);
  assert.match(src, /MINT_MARKER_KEY/);
  assert.match(src, /base_sha: mintBaseSha/);
});

test("faff validate-adapters passes (the faff-beep-boop checkpoint-wiring prose stays within its line-cap ratchet)", () => {
  const r = runCli(["validate-adapters"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
});

test("faff lint-cli-doc passes (docs/guide/cli.md documents the new reconcile-merges subcommand)", () => {
  const r = runCli(["lint-cli-doc"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
});

test("an observe-only declaration independently covers a landing (declare and observe both count)", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-observe");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-321"], base_sha: base, base_sha_required: true }));
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, kind_of_entry: "observe", issue: "FAFF-321", step: "build", effect: { kind: "merge", target: "pr:3" } }) + "\n",
  );
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-321): merge-gate's own mechanical observe, no declare");
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.any_escape, false, "an observe-only entry covers via attribution match, exactly like a declare-only entry");
});

test("the reconcile is read-only — it mutates no ledger, run artifact, or git state", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-readonly");
  mkdirSync(runDir, { recursive: true });
  const ledgerContent = JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true });
  writeFileSync(join(runDir, "run-ledger.json"), ledgerContent);
  writeFileSync(join(dir, "f.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(FAFF-1): off-ledger");

  const gitStatusBefore = git("status", "--porcelain");
  const headBefore = git("rev-parse", "HEAD").trim();
  runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });

  assert.equal(readFileSync(join(runDir, "run-ledger.json"), "utf8"), ledgerContent, "run-ledger.json is byte-identical after the reconcile");
  assert.equal(git("status", "--porcelain"), gitStatusBefore, "git status is unchanged — no commit, no stage, no working-tree write");
  assert.equal(git("rev-parse", "HEAD").trim(), headBefore, "HEAD is unchanged");
});

test("a broken/tampered declared-effects.jsonl chain is a genuine, non-clean fault", () => {
  const { dir, git } = gitRepo();
  const base = git("rev-parse", "HEAD").trim();
  const runDir = join(dir, ".faff", "runs", "run-1028-tampered");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], base_sha: base, base_sha_required: true }));
  // A `prev` that doesn't hash to anything real — the FAFF-621 chain-verifier's "broken" case.
  writeFileSync(
    join(runDir, "declared-effects.jsonl"),
    JSON.stringify({ schema: 2, run_id: "run-1028-tampered", seq: 0, ts: "2026-01-01T00:00:00.000Z", kind_of_entry: "declare", issue: "FAFF-1", step: "build", effect: { kind: "merge", target: "pr:1" }, prev: "0".repeat(64) }) + "\n",
  );
  const r = runCli(["effects", "reconcile-merges", "--run-dir", runDir, "--json"], { cwd: dir });
  const out = JSON.parse(r.stdout);
  assert.equal(out.reconciled, false);
  assert.match(out.fault, /chain/);
  assert.equal(out.any_escape, false, "a chain fault never itself sets any_escape — the checkpoint treats reconciled:false as non-clean separately");
});
