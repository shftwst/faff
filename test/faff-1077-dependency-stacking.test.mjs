// FAFF-1077 — branch-stacking: keep a dependent chain moving while its dependency's PR awaits
// review. Covers the deterministic seams of the feature: the config knob default, the additive
// decideFloor `dependency_gate` leg (including the byte-identical-when-absent property), the
// forge-merge shared module, the merge-gate interlock's pure decision core + stack-anchor read,
// the faff-stacked control label, and setup-worktree.sh's base-override — including the tip-SHA
// race scenario (the worktree must base off the EXACT pinned SHA, never a re-resolved live branch).
// Mirrors the repo's CLI-boundary + pure-import conventions (run-cli helper, real git temp repos).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const setupWorktreeSh = resolve(here, "..", "plugin", "skills", "faff-graft", "setup-worktree.sh");
const libDir = resolve(here, "..", "plugin", "skills", "faff", "bin", "lib");

const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const gitOut = (cwd, ...args) => { const r = git(cwd, ...args); return r.status === 0 ? (r.stdout || "").trim() : null; };

// --- the config knob (DEFAULTS entry, graft.* namespace) ---

test("config: graft.dependency_wait defaults to off (byte-identical park behaviour)", () => {
  const r = runCli(["config", "get", "graft.dependency_wait"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "off");
});

// --- the additive decideFloor dependency_gate leg ---

test("decideFloor: dependency_gate is additive — not-applicable/absent/satisfied never block, blocked refuses", async () => {
  const { decideFloor, FLOOR_DEPENDENCY_GATES } = await import(join(libDir, "contract-defs.js"));
  assert.deepEqual(FLOOR_DEPENDENCY_GATES, ["not-applicable", "satisfied", "blocked"]);
  const base = { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "needs-human" };
  assert.equal(decideFloor({ ...base }).verdict, "merge-ok");
  assert.equal(decideFloor({ ...base, dependency_gate: "not-applicable" }).verdict, "merge-ok");
  assert.equal(decideFloor({ ...base, dependency_gate: "satisfied" }).verdict, "merge-ok");
  const blocked = decideFloor({ ...base, dependency_gate: "blocked" });
  assert.equal(blocked.verdict, "refuse");
  assert.match(blocked.blockers.join(" "), /stacked dependency PR not yet merged/);
});

test("decideFloor: dependency_gate not-applicable returns byte-identical output to the field absent", async () => {
  const { decideFloor } = await import(join(libDir, "contract-defs.js"));
  // Sweep a representative cross-section of floor inputs; for each, the field-absent verdict/blockers
  // MUST equal the not-applicable verdict/blockers exactly (the non-negotiable default-off property).
  const grid = [
    { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" },
    { ac_complete: false, review_verdict: "missing", ci_state: "ci-red", head_sha_matches: false, level: "L3", holdout: "not-applicable" },
    { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec", integrity: "asserted" },
    { ac_complete: true, review_verdict: "fail", ci_state: "no-ci-coverage", head_sha_matches: true, level: "L2", holdout: "not-applicable", decision_grant: "valid-grant" },
  ];
  for (const f of grid) {
    const absent = decideFloor({ ...f });
    const na = decideFloor({ ...f, dependency_gate: "not-applicable" });
    assert.equal(JSON.stringify(na), JSON.stringify(absent), `mismatch for ${JSON.stringify(f)}`);
  }
});

test("contract integrity-floor: dependency_gate fixtures (absent no-op, satisfied ok, blocked refuse, bad fail-loud)", () => {
  const run = (extraction) => runCli(["contract", "integrity-floor"], { input: JSON.stringify(extraction) });
  const base = { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" };
  assert.equal(run({ ...base }).code, 0);
  assert.equal(run({ ...base, dependency_gate: "satisfied" }).code, 0);
  assert.equal(run({ ...base, dependency_gate: "blocked" }).code, 1);
  assert.equal(run({ ...base, dependency_gate: "maybe" }).code, 2); // out-of-enum → fail loud
});

// --- the shared forge-merge module ---

test("forge-merge: observeForgeMerge returns { pr_merged, merged_head_sha, state } and is fail-closed on no pr", async () => {
  const { observeForgeMerge } = await import(join(libDir, "forge-merge.js"));
  const r = observeForgeMerge({ pr: null });
  assert.deepEqual(r, { pr_merged: false, merged_head_sha: null, state: null });
  const r2 = observeForgeMerge(null);
  assert.deepEqual(r2, { pr_merged: false, merged_head_sha: null, state: null });
});

// --- the merge-gate interlock's pure core (born-verifiable park outcomes) ---

test("classifyDependencyGate: the born-verifiable dependency dispositions", async () => {
  const { classifyDependencyGate } = await import(join(libDir, "merge-gate.js"));
  const open = classifyDependencyGate("FAFF-B", 7, "OPEN", null);
  assert.equal(open.gate, "blocked");
  assert.equal(open.park, null); // stays pr-open, never a park

  const merged = classifyDependencyGate("FAFF-B", 7, "MERGED", "ok");
  assert.equal(merged.gate, "satisfied");
  assert.equal(merged.park, null);

  const conflict = classifyDependencyGate("FAFF-B", 7, "MERGED", "conflict");
  assert.equal(conflict.gate, "blocked");
  assert.ok(conflict.park && conflict.park.reconsider === "human");
  assert.match(conflict.park.cause, /conflict/);

  const closed = classifyDependencyGate("FAFF-B", 7, "CLOSED", null);
  assert.equal(closed.gate, "blocked");
  assert.ok(closed.park && closed.park.reconsider === "human");
  assert.match(closed.park.cause, /base is dead/);

  const transient = classifyDependencyGate("FAFF-B", 7, null, null);
  assert.equal(transient.gate, "blocked");
  assert.equal(transient.park, null); // a forge blip never parks
  assert.match(transient.note, /forge blip/);
});

test("readStackAnchor: absent anchor is not-applicable (byte-identical), present resolves, malformed is flagged", async () => {
  const { readStackAnchor } = await import(join(libDir, "merge-gate.js"));
  const repo = mkTmp("faff-1077-anchor-");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.t");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "seed\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  const runId = "run-x";
  const issue = "FAFF-D";

  // absent → present:false (the interlock returns not-applicable, byte-identical to today)
  const headBefore = gitOut(repo, "rev-parse", "HEAD");
  assert.deepEqual(readStackAnchor(repo, `/tmp/${runId}`, issue, headBefore), { present: false });

  // commit a well-formed anchor and read it at that head sha
  const anchorDir = join(repo, ".faff", "anchors", runId, issue);
  mkdirSync(anchorDir, { recursive: true });
  writeFileSync(join(anchorDir, "stack-parent.json"), JSON.stringify({ dependent: issue, parent_issue: "FAFF-B", parent_pr: 7, parent_branch: "faff-b", parent_tip_sha: "abc123", stacked_at: "2026-09-22T00:00:00Z" }) + "\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "anchor");
  const head = gitOut(repo, "rev-parse", "HEAD");
  const ok = readStackAnchor(repo, `/base/${runId}`, issue, head);
  assert.equal(ok.present, true);
  assert.equal(ok.anchor.parent_pr, 7);
  assert.equal(ok.anchor.parent_branch, "faff-b");

  // malformed (missing parent_branch) → flagged malformed (the caller fails loud)
  writeFileSync(join(anchorDir, "stack-parent.json"), JSON.stringify({ dependent: issue, parent_issue: "FAFF-B", parent_pr: 7 }) + "\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "bad-anchor");
  const badHead = gitOut(repo, "rev-parse", "HEAD");
  assert.deepEqual(readStackAnchor(repo, `/base/${runId}`, issue, badHead), { present: true, malformed: true });
});

// --- the faff-stacked control label ---

test("labels: faff-stacked is a machine-writable control label (no tracker_owned)", () => {
  const r = runCli(["labels"]); // labels prints the JSON manifest by default (no flag)
  assert.equal(r.code, 0, r.stderr);
  const labels = JSON.parse(r.stdout);
  const stacked = labels.find((l) => l.role === "stacked");
  assert.ok(stacked, "expected a control label with role 'stacked'");
  assert.equal(stacked.name, "faff-stacked");
  assert.ok(!stacked.tracker_owned, "faff-stacked must be machine-writable (no tracker_owned)");
});

// --- setup-worktree.sh base-override + the tip-SHA race scenario ---

function scaffoldRepoWithRemote() {
  const dir = mkTmp("faff-1077-repo-");
  const bare = mkTmp("faff-1077-remote-");
  git(mkTmp("faff-1077-bareinit-"), "init", "-q", "--bare", bare);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");
  return { dir, bare };
}

function runSetupWorktree({ name, cwd, baseRef, wtRoot }) {
  const env = { ...process.env, SKIP_NPM_PACKAGES_INSTALL: "1", FAFF_WORKTREE_ROOT: wtRoot };
  if (baseRef !== undefined) env.FAFF_WORKTREE_BASE_REF = baseRef;
  return spawnSync("bash", [setupWorktreeSh, name, cwd], { encoding: "utf8", env });
}

test("setup-worktree: FAFF_WORKTREE_BASE_REF bases the worktree off the EXACT pinned SHA (tip-SHA race)", () => {
  const { dir } = scaffoldRepoWithRemote();
  // Build a dependency branch B with a commit, push it, and PIN its tip SHA.
  git(dir, "checkout", "-q", "-b", "faff-b");
  writeFileSync(join(dir, "b.txt"), "b1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "B commit 1");
  git(dir, "push", "-q", "origin", "faff-b");
  const pinnedSha = gitOut(dir, "rev-parse", "HEAD");

  // THE RACE: B's branch advances AFTER the pin (a new commit lands + is pushed) before the
  // dependent's worktree is provisioned. A correct implementation branches off the pinned SHA,
  // never the live tip — so the dependent never picks up B's later, unreviewed commit.
  writeFileSync(join(dir, "b.txt"), "b2\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "B commit 2 (post-pin)");
  git(dir, "push", "-q", "origin", "faff-b");
  const advancedTip = gitOut(dir, "rev-parse", "HEAD");
  assert.notEqual(pinnedSha, advancedTip);
  git(dir, "checkout", "-q", "main");

  const wtRoot = mkTmp("faff-1077-wt-");
  const r = runSetupWorktree({ name: "faff-d", cwd: dir, baseRef: pinnedSha, wtRoot });
  assert.equal(r.status, 0, r.stderr);
  const wtPath = (r.stdout || "").trim().split("\n").pop();
  const wtHead = gitOut(wtPath, "rev-parse", "HEAD");
  assert.equal(wtHead, pinnedSha, "worktree must base off the pinned SHA, not the advanced live tip");
  assert.notEqual(wtHead, advancedTip);
});

test("setup-worktree: an unresolvable FAFF_WORKTREE_BASE_REF fails loud (never falls back to HEAD)", () => {
  const { dir } = scaffoldRepoWithRemote();
  const wtRoot = mkTmp("faff-1077-wt-bad-");
  const r = runSetupWorktree({ name: "faff-bad", cwd: dir, baseRef: "0000000000000000000000000000000000000000", wtRoot });
  assert.notEqual(r.status, 0, "a base ref that does not resolve must fail loud");
});

test("setup-worktree: with FAFF_WORKTREE_BASE_REF unset, today's origin-default base path is unchanged", () => {
  const { dir } = scaffoldRepoWithRemote();
  const originMain = gitOut(dir, "rev-parse", "origin/main");
  const wtRoot = mkTmp("faff-1077-wt-default-");
  const r = runSetupWorktree({ name: "faff-plain", cwd: dir, baseRef: undefined, wtRoot });
  assert.equal(r.status, 0, r.stderr);
  const wtPath = (r.stdout || "").trim().split("\n").pop();
  assert.equal(gitOut(wtPath, "rev-parse", "HEAD"), originMain);
});
