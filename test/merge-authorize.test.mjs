// FAFF-1426 — `faff merge authorize|observe`: the merge-step Commissaire grants written from the run's
// own facts (level from the committed anchor, attendance from verificationUnattended at that level,
// holdout through readHoldout), never from caller flags.
//
// Every case drives the real CLI against a real governed run: a temp git repo, `faff run-ledger
// init-interactive`, `faff commissaire contract admit`, and an anchor committed on a feature branch.
// The PR path answers `gh` from the FAFF-1212 stub on PATH.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { installStubGh } from "./helpers/stub-gh.mjs";
import * as MG from "../plugin/skills/faff/bin/lib/merge-gate.js";

const ISSUE = "FAFF-1";
const cleanups = [];
after(() => { for (const fn of cleanups) { try { fn(); } catch {} } });

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

// A governed (unless admit:false) run in a temp repo, with the feature branch checked out and its head
// carrying a committed anchor at `anchorLevel` (no anchor when null).
function fixture({ anchorLevel = "L2", ledgerLevel = null, faffrc = null, admit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff1426-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README"), "x\n");
  if (faffrc) writeFileSync(join(root, ".faffrc.yaml"), faffrc);
  git(root, "add", "README");
  git(root, "commit", "-q", "-m", "init");
  const minted = runCli(["run-ledger", "init-interactive", "--issue", ISSUE], { cwd: root });
  assert.equal(minted.code, 0, minted.stderr);
  const runDir = minted.stdout.trim();
  if (admit) {
    const a = runCli(["commissaire", "contract", "admit", "--run-dir", runDir, "--producer", basename(runDir), "--contract-revision", "faff-runner-v1", "--scope", "merge,branch-delete,pr-create,push"], { cwd: root });
    assert.equal(a.code, 0, a.stderr);
  }
  if (ledgerLevel) {
    const p = join(runDir, "run-ledger.json");
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), level: ledgerLevel }));
  }
  git(root, "checkout", "-q", "-b", "feature");
  const headSha = commitAnchor(root, runDir, anchorLevel);
  return { root, runDir, headSha };
}

function commitAnchor(root, runDir, level) {
  if (level === null) {
    writeFileSync(join(root, "work.txt"), String(Date.now()));
    git(root, "add", "work.txt");
  } else {
    const rel = join(".faff", "anchors", basename(runDir), ISSUE, "run-ledger.json");
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify({ run_id: basename(runDir), level }));
    git(root, "add", "-f", rel);
  }
  git(root, "commit", "-q", "-m", `anchor ${level}`);
  return git(root, "rev-parse", "HEAD");
}

function stub(fx, prView = {}, extra = {}) {
  const g = installStubGh({ prView: { headRefOid: fx.headSha, headRefName: "feature", baseRefName: "main", state: "OPEN", url: "https://github.com/owner/repo/pull/1", ...prView }, ...extra });
  cleanups.push(g.cleanup);
  return g;
}

const ledgerLines = (runDir) => {
  const p = join(runDir, "declared-effects.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const ofKind = (runDir, kind) => ledgerLines(runDir).filter((e) => e.schema === 3 && e.kind_of_entry === kind && e.step === "merge");

const authorize = (fx, g, extra = []) => runCli(["merge", "authorize", "--run-dir", fx.runDir, "--issue", ISSUE, "--pr", "1", "--json", ...extra], { cwd: fx.root, env: g.env });
const authorizeLocal = (fx, extra = []) => runCli(["merge", "authorize", "--run-dir", fx.runDir, "--issue", ISSUE, "--local", "--json", ...extra], { cwd: fx.root });
const out = (r) => JSON.parse(r.stdout.trim());

// A holdout record readHoldout reads as `blocked` (aggregate needs-human, fresh against the checkpoint).
function writeHoldout(runDir, { aggregate = "needs-human", stale = false } = {}) {
  const dir = join(runDir, ISSUE);
  mkdirSync(dir, { recursive: true });
  const at = new Date(Date.now() + (stale ? 3600_000 : -3600_000)).toISOString();
  writeFileSync(join(dir, "build-progress.json"), JSON.stringify({ updated_at: at, build: { pushed_at: at } }));
  writeFileSync(join(dir, "holdout.json"), JSON.stringify({ aggregate, code_blind: true, criteria: [] }));
}

// --- grants ---------------------------------------------------------------------------------------

test("a governed L2 run is granted from its own facts: attended, the anchor level, and the readHoldout value", () => {
  const fx = fixture();
  const g = stub(fx);
  const r = authorize(fx, g);
  assert.equal(r.code, 0, r.stderr);
  const o = out(r);
  assert.equal(o.governed, true);
  assert.deepEqual(o.inputs, { level: "L2", attended: true, holdout: "missing", base: "main", head: "feature" });
  assert.deepEqual(o.effects.map((e) => [e.kind, e.target, e.verdict]), [["merge", "main", "grant"]]);
  assert.equal(o.written, true);
  assert.equal(ofKind(fx.runDir, "declare").length, 1);
});

test("--delete-branch writes two grants, merge on the base and branch-delete on the head", () => {
  const fx = fixture();
  const r = authorize(fx, stub(fx), ["--delete-branch"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(out(r).effects.map((e) => [e.kind, e.target, e.verdict]), [["merge", "main", "grant"], ["branch-delete", "feature", "grant"]]);
  assert.equal(ofKind(fx.runDir, "effect-decision-verdict").length, 2);
});

test("attendance is derived, not fixed: an L3 run whose config declares it unattended records attended false", () => {
  const fx = fixture({ anchorLevel: "L3", faffrc: "autonomous:\n  unattended: true\n" });
  const r = authorize(fx, stub(fx));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(out(r).inputs.attended, false);
  assert.equal(out(r).inputs.level, "L3");
});

test("attendance is computed at the anchor level: an L4-anchored head on an L3 ledger records attended false", () => {
  const fx = fixture({ anchorLevel: "L4", ledgerLevel: "L3" });
  const r = authorize(fx, stub(fx));
  assert.equal(r.code, 1);
  assert.equal(out(r).inputs.level, "L4");
  assert.equal(out(r).inputs.attended, false);
});

// --- the holdout leg at L4 ---------------------------------------------------------------------------

test("L4 with holdout.json aggregate needs-human: denied, exit 1, no grant written", () => {
  const fx = fixture({ anchorLevel: "L4" });
  writeHoldout(fx.runDir);
  const r = authorize(fx, stub(fx));
  assert.equal(r.code, 1);
  const o = out(r);
  assert.equal(o.inputs.holdout, "blocked");
  assert.deepEqual(o.effects.map((e) => [e.verdict, e.reason]), [["deny", "level-requires-holdout-meets-spec"]]);
  assert.ok(ofKind(fx.runDir, "effect-decision-verdict").every((v) => v.payload.verdict !== "grant"));
  assert.match(r.stderr, /denied: merge main \(level-requires-holdout-meets-spec\)/);
});

test("L4 with a stale holdout.json reads blocked and is denied", () => {
  const fx = fixture({ anchorLevel: "L4" });
  writeHoldout(fx.runDir, { aggregate: "meets-spec", stale: true });
  const r = authorize(fx, stub(fx));
  assert.equal(r.code, 1);
  assert.equal(out(r).inputs.holdout, "blocked");
});

test("L4 with no holdout.json reads missing and is denied", () => {
  const fx = fixture({ anchorLevel: "L4" });
  const r = authorize(fx, stub(fx));
  assert.equal(r.code, 1);
  assert.equal(out(r).inputs.holdout, "missing");
  assert.equal(out(r).effects[0].verdict, "deny");
});

test("no caller supplies a policy input: --holdout and --level fail at the argv parser and write nothing", () => {
  const fx = fixture({ anchorLevel: "L4" });
  const g = stub(fx);
  for (const flag of [["--holdout", "meets-spec"], ["--level", "L2"], ["--attended"]]) {
    const r = authorize(fx, g, flag);
    assert.equal(r.code, 2, `${flag[0]} should be rejected`);
  }
  assert.equal(ofKind(fx.runDir, "declare").length, 0);
});

// --- idempotence ------------------------------------------------------------------------------------

test("a re-run with matching inputs writes nothing and reports written false", () => {
  const fx = fixture();
  const g = stub(fx);
  assert.equal(authorize(fx, g).code, 0);
  const before = ledgerLines(fx.runDir).length;
  const r = authorize(fx, g);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(out(r).written, false);
  assert.equal(out(r).effects[0].reason, "already-granted");
  assert.equal(ledgerLines(fx.runDir).length, before);
});

test("a fresh grant is written when the anchor level differs from the existing grant's recorded level", () => {
  const fx = fixture();
  assert.equal(authorize(fx, stub(fx)).code, 0);
  const newHead = commitAnchor(fx.root, fx.runDir, "L3");
  const r = authorize(fx, stub(fx, { headRefOid: newHead }));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(out(r).written, true);
  const verdicts = ofKind(fx.runDir, "effect-decision-verdict");
  assert.deepEqual(verdicts.map((v) => v.payload.level), ["L2", "L3"]);
  assert.equal(ofKind(fx.runDir, "declare").length, 1, "the existing declaration still covers the effect");
});

test("with a valid branch-delete grant but no merge grant, only the merge effect is declared and authorised", () => {
  const fx = fixture();
  const producer = basename(fx.runDir);
  const facade = (verb, input, extra = []) => runCli(["commissaire", "effect", verb, "--run-dir", fx.runDir, "--producer", producer, "--unit-id", ISSUE, "--step", "merge", ...extra], { cwd: fx.root, input: JSON.stringify(input) });
  assert.equal(facade("declare", [{ kind: "branch-delete", target: "feature", reversible: true }]).code, 0);
  assert.equal(facade("authorize", { effect: { kind: "branch-delete", target: "feature" }, level: "L2", attended: true, holdout: "missing" }, ["--level", "L2"]).code, 0);
  const r = authorize(fx, stub(fx), ["--delete-branch"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(out(r).effects.map((e) => [e.kind, e.reason]), [["merge", "all-legs-pass"], ["branch-delete", "already-granted"]]);
  assert.deepEqual(ofKind(fx.runDir, "declare").map((d) => d.effect.kind), ["branch-delete", "merge"]);
  assert.deepEqual(ofKind(fx.runDir, "effect-decision-request").map((d) => d.payload.effect.kind), ["branch-delete", "merge"]);
});

test("the coverage check reads the trust file from the PR's own repository, not the checkout's", () => {
  const fx = fixture();
  git(fx.root, "remote", "add", "origin", "https://github.com/fork/elsewhere.git");
  const g = stub(fx, {}, { repo: "fork/elsewhere" });
  assert.equal(authorize(fx, g).code, 0);
  const r = authorize(fx, g);
  assert.equal(out(r).written, false, "the existing grant is found");
  const reads = g.trustReads().map((a) => a.join(" "));
  assert.ok(reads.length > 0 && reads.every((a) => a.includes("repos/owner/repo/")), JSON.stringify(reads));
});

// The section 4.2 prerequisites, pinned: the resolver detail carries verdict_seq, and the verdict at
// that seq carries the three inputs the idempotence check compares.
test("the resolver detail carries verdict_seq and the verdict record carries level, attended and holdout", () => {
  const fx = fixture();
  assert.equal(authorize(fx, stub(fx)).code, 0);
  const ctx = MG.makeTrustContext({ transport: "local", repo_dir: fx.root, base_ref: "main" });
  const check = MG.resolveCommissaireDecisionGrantDetail(fx.runDir, ISSUE, "main", ctx);
  assert.equal(check.state, "valid-grant");
  assert.equal(typeof check.detail.verdict_seq, "number");
  const verdict = ledgerLines(fx.runDir).find((e) => e.seq === check.detail.verdict_seq);
  assert.equal(verdict.kind_of_entry, "effect-decision-verdict");
  assert.deepEqual([verdict.payload.level, verdict.payload.attended, verdict.payload.holdout], ["L2", true, "missing"]);
});

// --- refusals ---------------------------------------------------------------------------------------

test("an ungoverned run writes nothing and exits 0 with governed false", () => {
  const fx = fixture({ admit: false });
  const before = ledgerLines(fx.runDir).length;
  const r = authorize(fx, stub(fx));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(out(r), { governed: false, inputs: null, effects: [], written: false });
  assert.equal(ledgerLines(fx.runDir).length, before);
});

test("an already-merged PR exits 1 with already-merged and writes nothing", () => {
  const fx = fixture();
  const before = ledgerLines(fx.runDir).length;
  const r = authorize(fx, stub(fx, { state: "MERGED" }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already-merged/);
  assert.equal(ledgerLines(fx.runDir).length, before);
});

test("an unresolvable anchor exits 2, writes nothing, and does not fall back to the ledger level", () => {
  const fx = fixture({ anchorLevel: null });
  const before = ledgerLines(fx.runDir).length;
  const r = authorizeLocal(fx);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no trusted committed anchor level/);
  assert.equal(ledgerLines(fx.runDir).length, before);
});

// --- the git-only form ------------------------------------------------------------------------------

test("--local grants the merge against the base merge-gate --local resolves, with no gh call", () => {
  const fx = fixture();
  const g = stub(fx);
  const r = runCli(["merge", "authorize", "--run-dir", fx.runDir, "--issue", ISSUE, "--local", "--json"], { cwd: fx.root, env: g.env });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(out(r).inputs, { level: "L2", attended: true, holdout: "missing", base: "main", head: null });
  assert.deepEqual(g.calls(), []);
  const gate = runCli(["merge-gate", "--local", "--issue", ISSUE, "--run-dir", fx.runDir, "--check-only", "--json"], { cwd: fx.root });
  assert.doesNotMatch(gate.stdout, /Commissaire merge grant refused/, gate.stdout + gate.stderr);
});

test("--local on a branch already in the base exits 1 with already-merged and writes nothing", () => {
  const fx = fixture();
  git(fx.root, "checkout", "-q", "main");
  git(fx.root, "merge", "-q", "--ff-only", "feature");
  git(fx.root, "checkout", "-q", "feature");
  const before = ledgerLines(fx.runDir).length;
  const r = authorizeLocal(fx);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already-merged/);
  assert.equal(ledgerLines(fx.runDir).length, before);
});

// --- end to end with merge-gate ---------------------------------------------------------------------

test("after authorize, merge-gate --check-only reports no Commissaire grant blocker", () => {
  const fx = fixture();
  const g = stub(fx);
  const gate = (args) => runCli(["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", fx.runDir, "--check-only", "--json", "--squash", ...args], { cwd: fx.root, env: g.env });
  const before = JSON.parse(gate(["--merge-args", "--delete-branch"]).stdout.trim());
  assert.ok(before.blockers.some((b) => /no-verdict-for-step/.test(b)), JSON.stringify(before.blockers));
  assert.equal(authorize(fx, g, ["--delete-branch"]).code, 0);
  const after = JSON.parse(gate(["--merge-args", "--delete-branch"]).stdout.trim());
  assert.ok(!after.blockers.some((b) => /Commissaire|no-verdict-for-step/.test(b)), JSON.stringify(after.blockers));
});

// --- observe ----------------------------------------------------------------------------------------

test("observe refuses without merge-record.json and writes nothing", () => {
  const fx = fixture();
  const g = stub(fx);
  assert.equal(authorize(fx, g).code, 0);
  const before = ledgerLines(fx.runDir).length;
  const r = runCli(["merge", "observe", "--run-dir", fx.runDir, "--issue", ISSUE, "--pr", "1"], { cwd: fx.root, env: g.env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no merge record/);
  assert.equal(ledgerLines(fx.runDir).length, before);
});

test("observe with a merge record writes one observe per effect, once", () => {
  const fx = fixture();
  const g = stub(fx, { state: "MERGED" });
  const live = stub(fx);
  assert.equal(authorize(fx, live, ["--delete-branch"]).code, 0);
  mkdirSync(join(fx.runDir, ISSUE), { recursive: true });
  writeFileSync(join(fx.runDir, ISSUE, "merge-record.json"), JSON.stringify({ pr: "1", head_sha: fx.headSha }));
  const observe = () => runCli(["merge", "observe", "--run-dir", fx.runDir, "--issue", ISSUE, "--pr", "1", "--delete-branch", "--json"], { cwd: fx.root, env: g.env });
  const r = observe();
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(ofKind(fx.runDir, "observe").map((o) => [o.effect.kind, o.effect.target]), [["merge", "main"], ["branch-delete", "feature"]]);
  assert.equal(out(observe()).written, false);
  assert.equal(ofKind(fx.runDir, "observe").length, 2);
});

// --- surface ----------------------------------------------------------------------------------------

test("usage: an unknown subcommand, a missing --pr/--local choice and --delete-branch with --local exit 2", () => {
  const fx = fixture();
  assert.equal(runCli(["merge", "frobnicate", "--run-dir", fx.runDir, "--issue", ISSUE, "--pr", "1"], { cwd: fx.root }).code, 2);
  assert.equal(runCli(["merge", "authorize", "--run-dir", fx.runDir, "--issue", ISSUE], { cwd: fx.root }).code, 2);
  assert.equal(runCli(["merge", "authorize", "--run-dir", fx.runDir, "--issue", ISSUE, "--local", "--delete-branch"], { cwd: fx.root }).code, 2);
});
