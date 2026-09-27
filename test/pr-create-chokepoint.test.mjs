// FAFF-1118 — the pr-create chokepoint + the branch-delete coattail close.
// Covers: the pr-create EFFECT_KIND (first-class, not other-coerced); resolvePrCreateGrant's
// three-valued fail-closed resolution (ungoverned → not-applicable; governed-uncovered →
// absent-or-invalid; governed-covered → valid-grant); the andGrants truth table; and the
// `faff pr-create` CLI seam (dispatch registration, git-only no-op, governed-uncovered refusal
// that opens NOTHING). The impure `gh pr create` success path is the spec's integration smoke
// test, not here — parity with merge-gate.test.mjs's pure-only posture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");
const MG = await import("../plugin/skills/faff/bin/lib/merge-gate.js");

// run the CLI in `cwd`; `input` is fed to stdin. returns { code, out, err }
function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), "faff1118-")); }

// a run dir that IS a valid effects run dir (basename is the run-id the chain genesis derives from)
function mkRunDir(root, runId) {
  const rd = join(root, ".faff", "runs", runId);
  mkdirSync(rd, { recursive: true });
  return rd;
}

// admit a governed run to Commissaire with `scope`; returns the run dir. The producer id is the
// run-id (the graft convention); the admission itself appends a schema:3 record so the run reads
// as governed (hasGovernanceContext true) even before any verdict.
function admit(root, runId, scope) {
  const rd = mkRunDir(root, runId);
  const r = run(root, ["commissaire", "contract", "admit", "--run-dir", rd, "--producer", runId, "--contract-revision", "r1", "--scope", scope]);
  assert.equal(r.code, 0, `admit failed: ${r.err}`);
  return rd;
}

// declare + authorize a covering pr-create grant for `base` on an admitted run.
function grantPrCreate(root, rd, issue, base) {
  const producer = basename(rd);
  let r = run(root, ["commissaire", "effect", "declare", "--run-dir", rd, "--producer", producer, "--issue", issue, "--step", "pr-create"], JSON.stringify([{ kind: "pr-create", target: base }]));
  assert.equal(r.code, 0, `declare failed: ${r.err}`);
  r = run(root, ["commissaire", "effect", "authorize", "--run-dir", rd, "--producer", producer, "--issue", issue, "--step", "pr-create"], JSON.stringify({ effect: { kind: "pr-create", target: base } }));
  assert.equal(r.code, 0, `authorize failed: ${r.err}`);
  const v = JSON.parse(r.out);
  assert.equal(v.verdict, "grant", "authorize did not grant on the covered pr-create path");
}

// --- effects: pr-create is a first-class EFFECT_KIND -----------------------

test("effects declare accepts a {kind:pr-create} descriptor (first-class, not other-coerced)", () => {
  const root = tmp();
  try {
    const rd = mkRunDir(root, "RUN-EFF-1");
    const r = run(root, ["effects", "declare", "--run-dir", rd, "--issue", "FAFF-1", "--step", "pr-create"], JSON.stringify({ kind: "pr-create", target: "main", reversible: true }));
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).effect.kind, "pr-create");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("effects declare rejects an unknown kind (exit 1)", () => {
  const root = tmp();
  try {
    const rd = mkRunDir(root, "RUN-EFF-2");
    const r = run(root, ["effects", "declare", "--run-dir", rd, "--issue", "FAFF-1", "--step", "pr-create"], JSON.stringify({ kind: "no-such-kind", target: "main" }));
    assert.equal(r.code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- resolvePrCreateGrant: the three-valued fail-closed resolution ---------

test("resolvePrCreateGrant: an ungoverned run (no schema:3) → not-applicable", () => {
  const root = tmp();
  try {
    const rd = mkRunDir(root, "RUN-UNGOV");
    assert.equal(MG.resolvePrCreateGrant(rd, "FAFF-1", "main"), "not-applicable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolvePrCreateGrant: a governed run (admit ran) with NO pr-create verdict → absent-or-invalid", () => {
  const root = tmp();
  try {
    const rd = admit(root, "RUN-GOV-NOVERDICT", "merge,branch-delete,pr-create");
    assert.equal(MG.resolvePrCreateGrant(rd, "FAFF-1", "main"), "absent-or-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolvePrCreateGrant: a governed run with a valid covering pr-create grant → valid-grant", () => {
  const root = tmp();
  try {
    const rd = admit(root, "RUN-GOV-COVERED", "merge,branch-delete,pr-create");
    grantPrCreate(root, rd, "FAFF-1", "main");
    assert.equal(MG.resolvePrCreateGrant(rd, "FAFF-1", "main"), "valid-grant");
    // the covered create suppresses its schema:2 trail (single schema:3 lineage)
    assert.equal(MG.prCreateCoveredBySchema3Grant(rd, "FAFF-1", "main"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolveBranchDeleteGrant: a branch-delete verdict at step=merge is selected by kind (never shadowing merge)", () => {
  const root = tmp();
  try {
    const rd = admit(root, "RUN-GOV-BD", "merge,branch-delete");
    const producer = basename(rd);
    // declare BOTH effects at step=merge, then authorize both — two step=merge verdicts.
    let r = run(root, ["commissaire", "effect", "declare", "--run-dir", rd, "--producer", producer, "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }, { kind: "branch-delete", target: "feature-x" }]));
    assert.equal(r.code, 0, r.err);
    r = run(root, ["commissaire", "effect", "authorize", "--run-dir", rd, "--producer", producer, "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assert.equal(r.code, 0, r.err);
    r = run(root, ["commissaire", "effect", "authorize", "--run-dir", rd, "--producer", producer, "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "branch-delete", target: "feature-x" } }));
    assert.equal(r.code, 0, r.err);
    // both are selected by kind — the branch-delete verdict does not shadow the merge verdict.
    assert.equal(MG.resolveCommissaireDecisionGrant(rd, "FAFF-1", "main"), "valid-grant");
    assert.equal(MG.resolveBranchDeleteGrant(rd, "FAFF-1", "feature-x"), "valid-grant");
    // andGrants over both → valid-grant (a covered --delete-branch merge).
    assert.equal(MG.andGrants(MG.resolveCommissaireDecisionGrant(rd, "FAFF-1", "main"), MG.resolveBranchDeleteGrant(rd, "FAFF-1", "feature-x")), "valid-grant");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("coattail: a valid merge grant but NO branch-delete grant → andGrants absent-or-invalid (merge refused before it lands)", () => {
  const root = tmp();
  try {
    const rd = admit(root, "RUN-GOV-NOBD", "merge,branch-delete");
    const producer = basename(rd);
    // declare + authorize the MERGE only — no branch-delete grant.
    let r = run(root, ["commissaire", "effect", "declare", "--run-dir", rd, "--producer", producer, "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    assert.equal(r.code, 0, r.err);
    r = run(root, ["commissaire", "effect", "authorize", "--run-dir", rd, "--producer", producer, "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assert.equal(r.code, 0, r.err);
    assert.equal(MG.resolveCommissaireDecisionGrant(rd, "FAFF-1", "main"), "valid-grant");
    assert.equal(MG.resolveBranchDeleteGrant(rd, "FAFF-1", "feature-x"), "absent-or-invalid");
    assert.equal(MG.andGrants("valid-grant", "absent-or-invalid"), "absent-or-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- andGrants: the fail-closed monoid truth table -------------------------

test("andGrants: the full truth table (absent dominates; valid iff all valid; not-applicable iff all n/a)", () => {
  assert.equal(MG.andGrants("valid-grant", "valid-grant"), "valid-grant");
  assert.equal(MG.andGrants("valid-grant", "absent-or-invalid"), "absent-or-invalid");
  assert.equal(MG.andGrants("absent-or-invalid", "not-applicable"), "absent-or-invalid");
  assert.equal(MG.andGrants("not-applicable", "not-applicable"), "not-applicable");
  // a non-uniform valid+not-applicable mix has no absent leg and is neither all-valid nor
  // all-n/a → fails closed to absent-or-invalid (the spec's decided reading).
  assert.equal(MG.andGrants("valid-grant", "not-applicable"), "absent-or-invalid");
  // the single-input non-delete-merge shapes are byte-for-byte the FAFF-1034 field.
  assert.equal(MG.andGrants("valid-grant"), "valid-grant");
  assert.equal(MG.andGrants("not-applicable"), "not-applicable");
});

// --- faff pr-create CLI seam ----------------------------------------------

// stand up a real git repo in `cwd`; `withRemote` adds a dummy origin so gitRemoteEmpty is false.
function gitRepo(withRemote) {
  const dir = tmp();
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  if (withRemote) git("remote", "add", "origin", "https://example.invalid/x/y.git");
  return dir;
}

test("pr-create: the command is registered in the dispatch (an unknown-verb error is NOT emitted)", () => {
  const repo = gitRepo(false);
  try {
    // git-only repo → the command runs and no-ops exit 0; a missing dispatch entry would exit 2
    // naming an unknown command. We assert the git-only no-op path instead (see next test).
    const rd = mkRunDir(repo, "RUN-CLI-REG");
    const r = run(repo, ["pr-create", "--run-dir", rd, "--issue", "FAFF-1", "--base", "main", "--body-file", "/dev/null", "--json"]);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.err, /unknown command|not a faff/i);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("pr-create: git-only (no remote) → no-op exit 0, opens nothing", () => {
  const repo = gitRepo(false);
  try {
    const rd = mkRunDir(repo, "RUN-CLI-GITONLY");
    const r = run(repo, ["pr-create", "--run-dir", rd, "--issue", "FAFF-1", "--base", "main", "--body-file", "/dev/null", "--json"]);
    assert.equal(r.code, 0);
    const res = JSON.parse(r.out);
    assert.equal(res.verdict, "no-op");
    assert.equal(res.opened, false);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("pr-create: governed run with NO covering pr-create grant + a remote → refuse exit 1, opens nothing", () => {
  const repo = gitRepo(true);
  try {
    const rd = admit(repo, "RUN-CLI-REFUSE", "merge,branch-delete,pr-create");
    const r = run(repo, ["pr-create", "--run-dir", rd, "--issue", "FAFF-1", "--base", "main", "--body-file", "/dev/null", "--json"]);
    assert.equal(r.code, 1);
    const res = JSON.parse(r.out);
    assert.equal(res.verdict, "refuse");
    assert.equal(res.opened, false);
    assert.match(res.blockers.join(" "), /pr-create decision absent or invalid/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// --- FAFF-1130: --title is required (never a silent title-less headless gh call) -----------------

// run the CLI with an augmented PATH so a stub `gh` shadows the real one (only reached on the
// not-applicable/valid-grant path — the grant + git-only guards return before the gh spawn).
function runWithPath(cwd, args, binDir) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

test("pr-create: ungoverned run + a remote but NO --title → fail-loud exit 2, opens nothing, remedy names --title", () => {
  const repo = gitRepo(true);
  try {
    // ungoverned (no admit) so the grant resolves not-applicable and the title guard is reached;
    // it returns BEFORE the gh spawn, so no PR is opened and no gh stub is needed.
    const rd = mkRunDir(repo, "RUN-CLI-NOTITLE");
    const r = run(repo, ["pr-create", "--run-dir", rd, "--issue", "FAFF-1", "--base", "main", "--body-file", "/dev/null", "--json"]);
    assert.equal(r.code, 2);
    const res = JSON.parse(r.out);
    assert.equal(res.verdict, "refuse");
    assert.equal(res.opened, false);
    assert.match(res.blockers.join(" "), /--title is required/);
    // NOT a bare gh usage failure — the message names the remedy, not gh's own usage text.
    assert.doesNotMatch(res.blockers.join(" "), /gh pr create failed/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("pr-create: ungoverned run + a remote WITH --title → forwards --title to the gh args unchanged", () => {
  const repo = gitRepo(true);
  const binDir = tmp();
  try {
    // stub gh: record argv, print a fake PR url, exit 0 — so the create path runs without a real PR.
    const argsLog = join(binDir, "gh-args.txt");
    const stub = join(binDir, "gh");
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsLog)}\necho "https://example.invalid/x/y/pull/1"\n`);
    chmodSync(stub, 0o755);
    const rd = mkRunDir(repo, "RUN-CLI-TITLE");
    const r = runWithPath(repo, ["pr-create", "--run-dir", rd, "--issue", "FAFF-1", "--base", "main", "--body-file", "/dev/null", "--title", "fix(FAFF-1): a build title", "--json"], binDir);
    assert.equal(r.code, 0, r.err);
    const res = JSON.parse(r.out);
    assert.equal(res.verdict, "opened");
    assert.equal(res.opened, true);
    // the stub recorded the exact argv gh received: pr create --body-file <f> --title <t>.
    const recorded = readFileSync(argsLog, "utf8").split("\n");
    const ti = recorded.indexOf("--title");
    assert.notEqual(ti, -1, "gh was not passed --title");
    assert.equal(recorded[ti + 1], "fix(FAFF-1): a build title", "the title was not forwarded unchanged");
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(binDir, { recursive: true, force: true }); }
});
