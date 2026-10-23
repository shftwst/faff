// FAFF-1212 — merge-gate, pr-create and branch-delete call Commissaire's grant verification.
//
// In-process tests drive checkLeg / the leg wrappers against hand-built governed runs (real Ed25519
// keys, FAFF-1178's verifyGrant). CLI tests drive `faff merge-gate` and `faff pr-create` through a
// stub `gh` on PATH that logs every argv, so the trust-file read count, the rules read and the
// `gh pr create` arguments are asserted at the seam, never inferred.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";
import { installStubGh } from "./helpers/stub-gh.mjs";
import { mkGovernedRun, grantedRun, swapInRunnerKey, trustToml, LEDGER } from "./helpers/governed-run.mjs";
import { trustRepo, localTrustCtx } from "./helpers/trust-context.mjs";
import { readMergeGateSources } from "./helpers/merge-gate-modules.mjs";
import * as MG from "../plugin/skills/faff/bin/lib/merge-gate.js";
import * as commissaire from "../plugin/skills/faff/bin/lib/commissaire.js";

const requireCjs = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib");
const ISSUE = "FAFF-1";
const REPO = "owner/repo";

const cleanups = [];
const track = (fn) => { cleanups.push(fn); };
after(() => { for (const fn of cleanups) { try { fn(); } catch {} } });

const tmpDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); track(() => rmSync(d, { recursive: true, force: true })); return d; };
const governed = (opts) => { const r = grantedRun(opts); track(() => r.rm()); return r; };
const stubGh = (cfg) => { const g = installStubGh(cfg); track(g.cleanup); return g; };

function trustedMainRepo(toml) {
  const dir = trustRepo("main");
  track(() => rmSync(dir, { recursive: true, force: true }));
  if (toml !== undefined) {
    mkdirSync(join(dir, ".commissaire"), { recursive: true });
    writeFileSync(join(dir, ".commissaire", "trust.toml"), toml);
    for (const a of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "trust"]]) spawnSync("git", ["-C", dir, ...a]);
  }
  return dir;
}

// A git repo with a remote, so pr-create does not take the git-only no-op.
function remoteRepo() {
  const dir = tmpDir("faff1212-remote-");
  spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  spawnSync("git", ["-C", dir, "remote", "add", "origin", "https://example.invalid/x/y.git"]);
  return dir;
}

const mergeGate = (run, gh, extra = [], { cwd, repoFlag = true } = {}) =>
  runCli(["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", run.runDir, "--level", "L3", ...(repoFlag ? ["--repo", REPO] : []), "--json", "--squash", ...extra],
    { env: gh.env, cwd: cwd ?? run.root });
const execute = ["--execute"];
const withDelete = ["--merge-args", "--delete-branch"];
const prCreate = (run, gh, cwd, extra = []) =>
  runCli(["pr-create", "--run-dir", run.runDir, "--issue", ISSUE, "--base", "main", "--body-file", "/dev/null", "--title", "t", "--json", ...extra], { env: gh.env, cwd });
const parse = (r) => JSON.parse(r.stdout.trim());
const GOVERNED_PIN = (run) => ({ mode: "present", toml: trustToml([run.kp.pk_fingerprint]) });

// --- source-level Done items ----------------------------------------------------------------------

// FAFF-1391: merge-gate.js is a facade, so the check reads every merge-gate module; the grant legs
// that require commissaire-verify live in merge-gate-effects.js.
test("the merge-gate modules no longer require ./commissaire and read nothing under commissaire/producer or governor", () => {
  const sources = readMergeGateSources(LIB);
  for (const [file, src] of Object.entries(sources)) {
    assert.doesNotMatch(src, /require\(["']\.\/commissaire["']\)/, file);
    assert.doesNotMatch(src, /["']producer["']|["']governor["']|pk\.json|governor\.json/, file);
  }
  assert.match(sources["merge-gate-effects.js"], /require\("\.\/commissaire-verify"\)/);
});

test("readChokepointKeyRecord is retired from commissaire's exports and source", () => {
  assert.equal("readChokepointKeyRecord" in commissaire, false);
  assert.doesNotMatch(readFileSync(join(LIB, "commissaire.ts"), "utf8"), /readChokepointKeyRecord/);
  assert.doesNotMatch(readFileSync(join(LIB, "commissaire.js"), "utf8"), /readChokepointKeyRecord/);
});

test("faff regions check passes", () => {
  const r = runCli(["regions", "check"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test("hasPullRequestRule is pure; extractRequiredChecks reads no protection from a bare pull_request rule", () => {
  assert.equal(MG.hasPullRequestRule([{ type: "deletion" }, { type: "pull_request" }]), true);
  assert.equal(MG.hasPullRequestRule([{ type: "deletion" }]), false);
  assert.equal(MG.hasPullRequestRule(null), false);
  assert.equal(MG.hasPullRequestRule([]), false);
  assert.deepEqual(MG.extractRequiredChecks([{ type: "pull_request" }]), { protected: false, required_checks: [], code_owner_review: false });
});

test("merge-gate --selftest covers hasPullRequestRule", () => {
  const r = runCli(["merge-gate", "--selftest"]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /ok\s+hasPullRequestRule: a pull_request rule/);
});

// --- wrappers: three-state returns, detail variants, ungoverned runs -------------------------------

test("wrappers return the three-state string and the Detail variants return a LegCheck with the full detail", () => {
  const run = governed({ custody: "in-process" });
  const repo = trustedMainRepo();
  const ctx = () => localTrustCtx(repo);
  assert.equal(MG.resolveCommissaireDecisionGrant(run.runDir, ISSUE, "main", ctx()), "valid-grant");
  assert.equal(MG.resolvePrCreateGrant(run.runDir, ISSUE, "main", ctx()), "valid-grant");
  assert.equal(MG.resolveBranchDeleteGrant(run.runDir, ISSUE, "feature", ctx()), "valid-grant");
  const check = MG.resolveCommissaireDecisionGrantDetail(run.runDir, ISSUE, "main", ctx());
  assert.equal(check.state, "valid-grant");
  assert.deepEqual(Object.keys(check.detail).sort(), ["base_ref", "classification", "custody", "evidence", "evidence_basis", "leg", "outcome", "reason", "repo_slug", "signer_fingerprint", "trust_source", "verdict_seq"]);
  assert.equal(check.detail.leg, "merge");
  assert.equal(MG.resolvePrCreateGrantDetail(run.runDir, ISSUE, "main", ctx()).detail.leg, "pr-create");
  assert.equal(MG.resolveBranchDeleteGrantDetail(run.runDir, ISSUE, "feature", ctx()).detail.leg, "branch-delete");
});

test("ungoverned run: not-applicable with a null detail, with or without a trust context, and no trust read", () => {
  const root = tmpDir("faff1212-ungov-");
  const runDir = join(root, "RUN-UNGOV");
  mkdirSync(runDir, { recursive: true });
  const calls = [];
  const deps = { resolveAdmittedKey: () => ({ custody: null, failure: null, pk: null }), verifyGrant: () => { calls.push("verify"); throw new Error("never called"); } };
  for (const ctx of [undefined, null, localTrustCtx(root)]) {
    assert.deepEqual(MG.checkLeg(runDir, ISSUE, "merge", "main", ctx, deps), { state: "not-applicable", detail: null });
  }
  assert.equal(MG.resolveCommissaireDecisionGrant(runDir, ISSUE, "main"), "not-applicable");
  assert.deepEqual(calls, []);
});

test("a governed leg called without a trust context refuses with trust-context-missing and reads nothing", () => {
  const run = governed();
  const calls = [];
  const deps = { resolveAdmittedKey: (...a) => commissaireVerifyReal().resolveAdmittedKey(...a), verifyGrant: (i) => { calls.push(i); return commissaireVerifyReal().verifyGrant(i); } };
  const check = MG.checkLeg(run.runDir, ISSUE, "merge", "main", undefined, deps);
  assert.equal(check.state, "absent-or-invalid");
  assert.equal(check.detail.reason, "trust-context-missing");
  assert.equal(check.detail.trust_source, "not-read");
  assert.equal(check.detail.base_ref, null);
  assert.deepEqual(calls, []);
});

function commissaireVerifyReal() { return requireCjs("../plugin/skills/faff/bin/lib/commissaire-verify.js"); }

test("faff-side reasons fill custody and signer from the probe, and classification and verdict_seq are always null", () => {
  const run = governed();
  const repo = trustedMainRepo();
  const bad = MG.checkLeg(run.runDir, ISSUE, "merge", "main", { ...localTrustCtx(repo), base_ref: "has space" });
  assert.equal(bad.detail.reason, "base-ref-invalid");
  assert.equal(bad.detail.custody, "governor");
  assert.equal(bad.detail.signer_fingerprint, run.kp.pk_fingerprint, "the probe bound the admitted key");
  assert.equal(bad.detail.classification, null);
  assert.equal(bad.detail.verdict_seq, null);
  assert.equal(bad.detail.trust_source, "not-read");
  assert.equal(bad.detail.base_ref, "has space");
});

test("a merge grant is checked against the PR's base branch, never its own declared target", () => {
  const run = mkGovernedRun({ custody: "in-process" });
  track(() => run.rm());
  run.grant("merge", "merge", "develop");
  run.flush();
  const repo = trustedMainRepo();
  assert.equal(MG.resolveCommissaireDecisionGrant(run.runDir, ISSUE, "develop", localTrustCtx(repo)), "valid-grant");
  const against = MG.resolveCommissaireDecisionGrantDetail(run.runDir, ISSUE, "main", localTrustCtx(repo));
  assert.equal(against.state, "absent-or-invalid");
  assert.equal(against.detail.reason, "grant-does-not-cover-effect");
  assert.equal(MG.mergeCoveredBySchema3Grant(run.runDir, ISSUE, "main", localTrustCtx(repo)), false, "the suppression check returns false too");
  assert.equal(MG.mergeCoveredBySchema3Grant(run.runDir, ISSUE, "develop", localTrustCtx(repo)), true);
  const noTarget = MG.resolveCommissaireDecisionGrantDetail(run.runDir, ISSUE, null, localTrustCtx(repo));
  assert.equal(noTarget.detail.reason, "effect-target-missing", "a missing target refuses; it never falls back to the grant's own");
  assert.equal(MG.resolveCommissaireDecisionGrantDetail(run.runDir, ISSUE, "", localTrustCtx(repo)).state, "absent-or-invalid");
});

test("a pinned governor grant passes all three legs, classified pinned (local ref: never evidence, no rules call)", () => {
  const run = governed();
  const repo = trustedMainRepo(trustToml([run.kp.pk_fingerprint]));
  for (const [leg, target] of [["merge", "main"], ["branch-delete", "feature"], ["pr-create", "main"]]) {
    const check = MG.checkLeg(run.runDir, ISSUE, leg, target, localTrustCtx(repo));
    assert.equal(check.state, "valid-grant", leg);
    assert.equal(check.detail.classification, "pinned");
    assert.equal(check.detail.custody, "governor");
    assert.equal(check.detail.trust_source, "local-ref");
    assert.equal(check.detail.repo_slug, null);
    assert.equal(check.detail.evidence, false);
    assert.equal(check.detail.evidence_basis, "not-remote-base");
  }
});

test("adversarial: a swapped producer/pk.json with self-signed grants is refused on all three legs, with no signer reported", () => {
  const run = governed();
  const repo = trustedMainRepo(trustToml([run.kp.pk_fingerprint]));
  swapInRunnerKey(run);
  for (const [leg, target] of [["merge", "main"], ["branch-delete", "feature"], ["pr-create", "main"]]) {
    const check = MG.checkLeg(run.runDir, ISSUE, leg, target, localTrustCtx(repo));
    assert.equal(check.state, "absent-or-invalid", leg);
    assert.equal(check.detail.reason, "governor-key-not-admitted", leg);
    assert.equal(check.detail.signer_fingerprint, null, "never a value read from pk.json alone");
    assert.equal(check.detail.evidence, false);
  }
});

test("in-process custody passes with no trust file and reports in-process custody and classification", () => {
  const run = governed({ custody: "in-process" });
  const repo = trustedMainRepo();
  const check = MG.checkLeg(run.runDir, ISSUE, "merge", "main", localTrustCtx(repo));
  assert.equal(check.state, "valid-grant");
  assert.equal(check.detail.custody, "in-process");
  assert.equal(check.detail.classification, "in-process");
  assert.equal(check.detail.evidence, false);
  assert.equal(check.detail.evidence_basis, "not-pinned");
});

// --- trust_source "not-read" exactly when the leg refused before the read ------------------------

test("not-read is reported for every refusal before the trust read, and a read-attempted entry reports its transport", () => {
  const repo = trustedMainRepo();
  const sentinelRoot = tmpDir("faff1212-sentinel-");
  const sentinelRun = join(sentinelRoot, "RUN-S");
  mkdirSync(join(sentinelRun, "commissaire"), { recursive: true });
  writeFileSync(join(sentinelRun, "commissaire", "governance-required.json"), JSON.stringify({ governance_required: true }));
  const sentinel = MG.checkLeg(sentinelRun, ISSUE, "merge", "main", localTrustCtx(repo));
  assert.equal(sentinel.detail.reason, "governance-required-sentinel");
  assert.equal(sentinel.detail.trust_source, "not-read");
  assert.equal(sentinel.detail.custody, null);

  const garbled = governed({ custody: "in-process" });
  writeFileSync(join(garbled.runDir, LEDGER), readFileSync(join(garbled.runDir, LEDGER), "utf8") + "not a record\n" + JSON.stringify({ x: 1 }) + "\n");
  for (const [leg, target] of [["merge", "main"], ["branch-delete", "feature"], ["pr-create", "main"]]) {
    const check = MG.checkLeg(garbled.runDir, ISSUE, leg, target, localTrustCtx(repo));
    assert.equal(check.state, "absent-or-invalid", leg);
    assert.notEqual(check.state, "not-applicable");
    assert.match(check.detail.reason, /^ledger-malformed$|^admission-|^chain-position-invalid$/, leg);
  }

  const run = governed({ custody: "in-process" });
  const invalidRef = MG.checkLeg(run.runDir, ISSUE, "merge", "main", { ...localTrustCtx(repo), base_ref: "a..b" });
  assert.equal(invalidRef.detail.reason, "base-ref-invalid");
  assert.equal(invalidRef.detail.trust_source, "not-read");
  for (const slug of ["", "no-slash", "bad owner/name", "a/b/../c"]) {
    const ctx = MG.makeTrustContext({ transport: "remote", repo_dir: repo, repo_slug: slug, base_ref: "main" });
    const c = MG.checkLeg(run.runDir, ISSUE, "merge", "main", ctx);
    assert.equal(c.detail.reason, "repo-slug-unresolved", JSON.stringify(slug));
    assert.equal(c.detail.trust_source, "not-read");
    assert.equal(c.detail.repo_slug, null);
  }
  const probeCrash = MG.checkLeg(run.runDir, ISSUE, "merge", "main", localTrustCtx(repo), { resolveAdmittedKey: () => { throw new TypeError("secret ledger bytes"); }, verifyGrant: () => { throw new Error("unreachable"); } });
  assert.equal(probeCrash.detail.reason, "verify-error");
  assert.equal(probeCrash.detail.trust_source, "not-read");

  const read = MG.checkLeg(run.runDir, ISSUE, "merge", "main", localTrustCtx(repo));
  assert.equal(read.detail.trust_source, "local-ref");
});

test("a failed trust read still reports the attempted source and refuses with trust-file-invalid", () => {
  const run = governed({ custody: "in-process" });
  const repo = trustedMainRepo("this is not toml = = =\n");
  const check = MG.checkLeg(run.runDir, ISSUE, "merge", "main", localTrustCtx(repo));
  assert.equal(check.state, "absent-or-invalid");
  assert.equal(check.detail.reason, "trust-file-invalid");
  assert.equal(check.detail.trust_source, "local-ref");
});

test("governance material deleted between the probe and the verify call refuses with governance-changed-during-check", () => {
  const run = governed();
  const repo = trustedMainRepo();
  const real = commissaireVerifyReal();
  const deps = { resolveAdmittedKey: real.resolveAdmittedKey, verifyGrant: (i) => ({ ...real.verifyGrant(i), outcome: "not-applicable", reason: "not-governed" }) };
  const check = MG.checkLeg(run.runDir, ISSUE, "merge", "main", localTrustCtx(repo), deps);
  assert.equal(check.state, "absent-or-invalid");
  assert.equal(check.detail.reason, "governance-changed-during-check");
  assert.equal(check.detail.custody, "governor");
  assert.equal(check.detail.trust_source, "local-ref", "the read was attempted before the verify call");
  assert.equal(check.detail.classification, null);
});

test("a throwing verifyGrant refuses with verify-error and stderr carries the exception name, never its message", () => {
  const run = governed();
  const repo = trustedMainRepo();
  const real = commissaireVerifyReal();
  const deps = { resolveAdmittedKey: real.resolveAdmittedKey, verifyGrant: () => { throw new RangeError("LEDGER-BYTES-SECRET"); } };
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  let check;
  try { check = MG.checkLeg(run.runDir, ISSUE, "branch-delete", "feature", localTrustCtx(repo), deps); } finally { process.stderr.write = original; }
  assert.equal(check.state, "absent-or-invalid");
  assert.equal(check.detail.reason, "verify-error");
  const stderr = written.join("");
  assert.match(stderr, /branch-delete/);
  assert.match(stderr, /RangeError/);
  assert.doesNotMatch(stderr, /SECRET/);
});

test("a trust read that throws refuses with verify-error and reports the attempted source, not not-read", () => {
  const run = governed();
  const repo = trustedMainRepo();
  const trustModule = requireCjs("../plugin/skills/faff/bin/lib/commissaire-trust.js");
  const original = trustModule.readTrustFile;
  const stderr = process.stderr.write;
  trustModule.readTrustFile = () => { throw new Error("spawn failed"); };
  process.stderr.write = () => true;
  let check;
  try { check = MG.checkLeg(run.runDir, ISSUE, "branch-delete", "feature", localTrustCtx(repo)); }
  finally { trustModule.readTrustFile = original; process.stderr.write = stderr; }
  assert.equal(check.state, "absent-or-invalid");
  assert.equal(check.detail.reason, "verify-error");
  assert.equal(check.detail.trust_source, "local-ref");
});

test("the trust read happens once per context across legs, whether they pass or refuse", () => {
  const run = governed({ custody: "in-process" });
  const repo = trustedMainRepo();
  const real = commissaireVerifyReal();
  let reads = 0;
  const ctx = localTrustCtx(repo);
  const deps = { resolveAdmittedKey: real.resolveAdmittedKey, verifyGrant: (i) => { if ("read" in i.trust) reads++; return real.verifyGrant(i); } };
  MG.checkLeg(run.runDir, ISSUE, "merge", "main", ctx, deps);
  MG.checkLeg(run.runDir, ISSUE, "branch-delete", "other", ctx, deps);
  assert.equal(reads, 2, "verifyGrant receives the read each time");
  assert.ok(ctx.trustMemo, "the read is memoised on the context");
  const first = ctx.trustMemo;
  MG.checkLeg(run.runDir, ISSUE, "pr-create", "main", ctx, deps);
  assert.equal(ctx.trustMemo, first, "the memoised read is reused, not redone");
});

// --- CLI: merge-gate PR path -----------------------------------------------------------------------

test("CLI merge-gate: a pinned governor grant passes the merge leg and reports a full remote-base entry with evidence", () => {
  const run = governed();
  const gh = stubGh({ trust: GOVERNED_PIN(run), rules: "pr" });
  const r = mergeGate(run, gh, ["--check-only"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.commissaire_grants.length, 1);
  assert.deepEqual(
    { ...out.commissaire_grants[0], evidence_basis: undefined },
    { leg: "merge", outcome: "valid-grant", reason: "valid-grant", custody: "governor", classification: "pinned", signer_fingerprint: run.kp.pk_fingerprint, verdict_seq: 1, trust_source: "remote-base", base_ref: "main", repo_slug: "owner/repo", evidence: true, evidence_basis: undefined },
  );
  assert.equal(gh.trustReads().length, 1);
  assert.equal(gh.rulesReads().length, 1);
  assert.ok(gh.trustReads()[0].join(" ").includes("repos/owner/repo/contents/.commissaire/trust.toml?ref=main"));
});

test("CLI merge-gate --delete-branch: two entries (merge then branch-delete), one trust read, one rules read", () => {
  const run = governed();
  const gh = stubGh({ trust: GOVERNED_PIN(run), rules: "pr" });
  const r = mergeGate(run, gh, [...execute, ...withDelete]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.merged, true);
  assert.deepEqual(out.commissaire_grants.map((e) => [e.leg, e.outcome]), [["merge", "valid-grant"], ["branch-delete", "valid-grant"]]);
  assert.equal(gh.trustReads().length, 1, "one trust read across both legs and both suppression checks");
  assert.equal(gh.rulesReads().length, 1, "the rules call is shared by the legs");
  assert.ok(gh.merged());
});

test("CLI merge-gate: the in-process run with no trust file passes and reports in-process custody", () => {
  const run = governed({ custody: "in-process" });
  const gh = stubGh({ trust: { mode: "absent" } });
  const r = mergeGate(run, gh, [...execute, ...withDelete]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.commissaire_grants.length, 2);
  for (const e of out.commissaire_grants) {
    assert.equal(e.outcome, "valid-grant");
    assert.equal(e.custody, "in-process");
    assert.equal(e.classification, "in-process");
    assert.equal(e.trust_source, "remote-base");
    assert.equal(e.evidence, false);
  }
  assert.equal(gh.rulesReads().length, 0, "an in-process entry makes no rules call");
});

test("CLI merge-gate: evidence follows the base branch's pull_request rule and fails toward false", () => {
  const cases = [
    ["pr", true, /pull request/],
    ["none", false, /^no-pull-request-rule$/],
    ["fail", false, /^protection-unreadable: /],
    ["garbage", false, /^protection-unreadable: unparseable/],
  ];
  for (const [rules, evidence, basis] of cases) {
    const run = governed();
    const gh = stubGh({ trust: GOVERNED_PIN(run), rules });
    const r = mergeGate(run, gh, ["--check-only"]);
    assert.equal(r.code, 0, `${rules}: ${r.stdout}${r.stderr}`);
    const out = parse(r);
    assert.equal(out.verdict, "merge-ok", "the rules call never changes the decision");
    assert.deepEqual(out.blockers, []);
    assert.equal(out.commissaire_grants[0].evidence, evidence, rules);
    assert.match(out.commissaire_grants[0].evidence_basis, basis, rules);
    assert.equal(out.commissaire_grants[0].outcome, "valid-grant");
  }
});

test("CLI merge-gate: an unpinned entry makes no rules call and reports evidence false", () => {
  const run = governed();
  const gh = stubGh({ trust: { mode: "present", toml: trustToml(["f".repeat(64)]) } });
  const r = mergeGate(run, gh, ["--check-only"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const e = parse(r).commissaire_grants[0];
  assert.equal(e.classification, "unpinned");
  assert.equal(e.evidence, false);
  assert.equal(e.evidence_basis, "not-pinned");
  assert.equal(gh.rulesReads().length, 0);
});

test("CLI adversarial: a swapped pk.json refuses merge and branch-delete with governor-key-not-admitted and the blocker line", () => {
  const run = governed();
  swapInRunnerKey(run);
  const gh = stubGh({ trust: GOVERNED_PIN(run), rules: "pr" });
  const r = mergeGate(run, gh, [...execute, ...withDelete]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.merged, false);
  assert.equal(gh.merged(), false, "nothing merged");
  assert.deepEqual(out.commissaire_grants.map((e) => [e.leg, e.reason, e.signer_fingerprint]), [["merge", "governor-key-not-admitted", null], ["branch-delete", "governor-key-not-admitted", null]]);
  assert.ok(out.blockers.includes("Commissaire merge grant refused: governor-key-not-admitted"));
  assert.ok(out.blockers.includes("Commissaire branch-delete grant refused: governor-key-not-admitted"));
  assert.equal(out.blockers.length > 2, true, "decideFloor's own blocker stays");
  assert.equal(gh.rulesReads().length, 0);
});

test("CLI merge-gate: a remote trust read that fails refuses with trust-file-invalid and the blocker line", () => {
  const run = governed();
  const gh = stubGh({ trust: { mode: "down" } });
  const r = mergeGate(run, gh, ["--check-only"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.commissaire_grants[0].reason, "trust-file-invalid");
  assert.equal(out.commissaire_grants[0].trust_source, "remote-base");
  assert.ok(out.blockers.includes("Commissaire merge grant refused: trust-file-invalid"));
  assert.equal(gh.trustReads().length, 1, "refusing legs still read once");
});

test("CLI merge-gate: a merge grant for another branch than the PR base is refused", () => {
  const run = mkGovernedRun({ custody: "in-process" });
  track(() => run.rm());
  run.grant("merge", "merge", "develop");
  run.flush();
  run.seedFloor();
  const gh = stubGh({ trust: { mode: "absent" } });
  const r = mergeGate(run, gh, ["--check-only"]);
  assert.equal(r.code, 1);
  const out = parse(r);
  assert.equal(out.commissaire_grants[0].reason, "grant-does-not-cover-effect");
  assert.ok(out.blockers.includes("Commissaire merge grant refused: grant-does-not-cover-effect"));
});

test("CLI merge-gate: a base branch outside the ref pattern refuses base-ref-invalid with no trust read; ungoverned behaves as today", () => {
  const run = governed();
  const prView = { headRefOid: "deadbeefcafe1234567890abcdef1234567890ab", headRefName: "feature", baseRefName: "release 1.0", state: "OPEN", url: "https://github.com/owner/repo/pull/1" };
  const gh = stubGh({ trust: GOVERNED_PIN(run), prView });
  const r = mergeGate(run, gh, ["--check-only"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const e = parse(r).commissaire_grants[0];
  assert.equal(e.reason, "base-ref-invalid");
  assert.equal(e.trust_source, "not-read");
  assert.equal(gh.anyTrustCall().length, 0);

  const ungov = mkGovernedRunDirUngoverned();
  const gh2 = stubGh({ prView });
  const r2 = mergeGate(ungov, gh2, ["--check-only"]);
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.equal("commissaire_grants" in parse(r2), false);
});

function mkGovernedRunDirUngoverned() {
  const root = tmpDir("faff1212-ungov-run-");
  const runDir = join(root, "RUN-U1");
  mkdirSync(join(runDir, ISSUE), { recursive: true });
  writeFileSync(join(runDir, ISSUE, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(join(runDir, ISSUE, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
  return { root, runDir };
}

test("CLI merge-gate: an ungoverned run makes no trust-file or rules call and omits commissaire_grants", () => {
  const ungov = mkGovernedRunDirUngoverned();
  const gh = stubGh();
  const r = mergeGate(ungov, gh, [...execute, ...withDelete]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal("commissaire_grants" in parse(r), false);
  assert.equal(gh.anyTrustCall().length, 0);
  assert.equal(gh.rulesReads().length, 0);
  assert.ok(gh.merged());
  assert.ok(gh.calls().some((a) => a[0] === "pr" && a[1] === "view" && a.join(" ").includes("baseRefName")), "gh pr view requests baseRefName");
});

test("CLI merge-gate: a PR response missing baseRefName (or headRefName under --delete-branch) exits 2 when governed, behaves as today when ungoverned", () => {
  const sha = "deadbeefcafe1234567890abcdef1234567890ab";
  const noBase = { headRefOid: sha, headRefName: "feature", state: "OPEN", url: "https://github.com/owner/repo/pull/1" };
  const noHead = { headRefOid: sha, baseRefName: "main", state: "OPEN", url: "https://github.com/owner/repo/pull/1" };
  const neither = { headRefOid: sha, state: "OPEN", url: "https://github.com/owner/repo/pull/1" };

  const run = governed();
  const r1 = mergeGate(run, stubGh({ prView: noBase }), ["--check-only"]);
  assert.equal(r1.code, 2);
  assert.match(r1.stderr, /cannot establish PR identity for #1/);
  assert.match(r1.stderr, /baseRefName/);
  const r2 = mergeGate(run, stubGh({ prView: noHead }), ["--check-only", ...withDelete]);
  assert.equal(r2.code, 2);
  assert.match(r2.stderr, /headRefName/);
  const r2b = mergeGate(run, stubGh({ prView: noHead, trust: GOVERNED_PIN(run) }), ["--check-only"]);
  assert.equal(r2b.code, 0, "headRefName is only needed under --delete-branch");

  const ungov = mkGovernedRunDirUngoverned();
  const r3 = mergeGate(ungov, stubGh({ prView: neither }), ["--check-only", ...withDelete]);
  assert.equal(r3.code, 0, r3.stdout + r3.stderr);
  assert.equal("commissaire_grants" in parse(r3), false);
});

test("CLI merge-gate: the trust file is read from the repository in the PR url, not the separately resolved slug", () => {
  const run = governed();
  const prView = { headRefOid: "deadbeefcafe1234567890abcdef1234567890ab", headRefName: "feature", baseRefName: "main", state: "OPEN", url: "https://github.com/parent/repo/pull/1" };
  const gh = stubGh({ repo: "fork-owner/repo", prView, trust: GOVERNED_PIN(run), rules: "pr" });
  const r = mergeGate(run, gh, [...execute, ...withDelete], { repoFlag: false });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.deepEqual(out.commissaire_grants.map((e) => e.repo_slug), ["parent/repo", "parent/repo"]);
  const reads = gh.trustReads().map((a) => a.join(" "));
  assert.equal(reads.length, 1);
  assert.ok(reads[0].includes("repos/parent/repo/contents/.commissaire/trust.toml"));
  assert.ok(gh.rulesReads()[0].join(" ").includes("repos/parent/repo/rules/branches/main"));
  assert.equal(gh.calls().filter((a) => a[0] === "repo" && a[1] === "view").length, 1, "the one repo view is merge-gate's own; the trust slug adds none");
});

test("CLI merge-gate: an unparseable PR url or a slug failing the --repo pattern refuses repo-slug-unresolved on a governed run", () => {
  for (const url of ["https://example.test/pr/1", "https://github.com/bad owner/repo/pull/1", "https://github.com/a/b/../pull/1"]) {
    const run = governed();
    const prView = { headRefOid: "deadbeefcafe1234567890abcdef1234567890ab", headRefName: "feature", baseRefName: "main", state: "OPEN", url };
    const gh = stubGh({ prView, trust: GOVERNED_PIN(run) });
    const r = mergeGate(run, gh, ["--check-only"]);
    assert.equal(r.code, 1, `${url}: ${r.stdout}${r.stderr}`);
    const e = parse(r).commissaire_grants[0];
    assert.equal(e.reason, "repo-slug-unresolved", url);
    assert.equal(e.trust_source, "not-read");
    assert.equal(gh.anyTrustCall().length, 0);
  }
});

test("CLI merge-gate: a governed run with the sentinel and no governance material refuses governance-required-sentinel", () => {
  const ungov = mkGovernedRunDirUngoverned();
  mkdirSync(join(ungov.runDir, "commissaire"), { recursive: true });
  writeFileSync(join(ungov.runDir, "commissaire", "governance-required.json"), JSON.stringify({ governance_required: true }));
  const gh = stubGh();
  const r = mergeGate(ungov, gh, ["--check-only"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.commissaire_grants[0].reason, "governance-required-sentinel");
  assert.equal(out.commissaire_grants[0].trust_source, "not-read");
  assert.equal(gh.anyTrustCall().length, 0);
});

test("CLI merge-gate: a granted governed merge still suppresses its schema:2 trail when gh fails after the merge", () => {
  const run = governed({ custody: "in-process" });
  const gh = stubGh({ trust: { mode: "absent" }, failAfterMerge: true });
  const r = mergeGate(run, gh, [...execute, ...withDelete]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(parse(r).merged, true);
  const records = readFileSync(join(run.runDir, LEDGER), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(records.every((rec) => rec.schema === 3), "no schema:2 declare/observe was appended");
  assert.equal(gh.trustReads().length, 1);
  assert.equal(parse(r).commissaire_grants.length, 2, "suppression checks add no entries");
});

// --- CLI: pr-create --------------------------------------------------------------------------------

test("CLI pr-create: the in-process run with no trust file opens the PR with --base and --repo forwarded", () => {
  const run = governed({ custody: "in-process" });
  const gh = stubGh({ trust: { mode: "absent" } });
  const cwd = remoteRepo();
  const r = prCreate(run, gh, cwd);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.verdict, "opened");
  assert.equal(out.commissaire_grants.length, 1);
  assert.deepEqual(
    { leg: out.commissaire_grants[0].leg, outcome: out.commissaire_grants[0].outcome, custody: out.commissaire_grants[0].custody, classification: out.commissaire_grants[0].classification, trust_source: out.commissaire_grants[0].trust_source, base_ref: out.commissaire_grants[0].base_ref, repo_slug: out.commissaire_grants[0].repo_slug },
    { leg: "pr-create", outcome: "valid-grant", custody: "in-process", classification: "in-process", trust_source: "remote-base", base_ref: "main", repo_slug: "owner/repo" },
  );
  const create = gh.calls().find((a) => a[0] === "pr" && a[1] === "create");
  assert.deepEqual(create, ["pr", "create", "--body-file", "/dev/null", "--title", "t", "--base", "main", "--repo", "owner/repo"]);
  assert.equal(gh.calls().filter((a) => a[0] === "repo" && a[1] === "view").length, 1, "ghRepoSlug runs once");
  assert.equal(gh.trustReads().length, 1);
});

test("CLI pr-create: a pinned governor grant passes and the PR opens", () => {
  const run = governed();
  const gh = stubGh({ trust: GOVERNED_PIN(run), rules: "pr" });
  const r = prCreate(run, gh, remoteRepo());
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const e = parse(r).commissaire_grants[0];
  assert.equal(e.classification, "pinned");
  assert.equal(e.evidence, true);
});

test("CLI pr-create adversarial: a swapped pk.json opens nothing, with the blocker line ahead of the existing sentence", () => {
  const run = governed();
  swapInRunnerKey(run);
  const gh = stubGh({ trust: GOVERNED_PIN(run) });
  const r = prCreate(run, gh, remoteRepo());
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.opened, false);
  assert.equal(out.commissaire_grants[0].reason, "governor-key-not-admitted");
  assert.equal(out.blockers[0], "Commissaire pr-create grant refused: governor-key-not-admitted");
  assert.match(out.blockers[1], /^Commissaire pr-create decision absent or invalid/);
  assert.equal(gh.calls().some((a) => a[0] === "pr" && a[1] === "create"), false);
});

test("CLI pr-create: a governed leg with no resolvable repo slug refuses repo-slug-unresolved and opens nothing", () => {
  const run = governed({ custody: "in-process" });
  const gh = stubGh({ repoViewFails: true });
  const r = prCreate(run, gh, remoteRepo());
  assert.equal(r.code, 1);
  assert.equal(parse(r).commissaire_grants[0].reason, "repo-slug-unresolved");
  assert.equal(gh.anyTrustCall().length, 0);
  assert.equal(gh.calls().filter((a) => a[0] === "repo" && a[1] === "view").length, 1);
});

test("CLI pr-create: an ungoverned run's gh pr create arguments are unchanged and no trust or repo call is made", () => {
  const ungov = mkGovernedRunDirUngoverned();
  const gh = stubGh();
  const r = prCreate(ungov, gh, remoteRepo());
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.verdict, "opened");
  assert.equal("commissaire_grants" in out, false);
  assert.deepEqual(gh.calls().find((a) => a[0] === "pr" && a[1] === "create"), ["pr", "create", "--body-file", "/dev/null", "--title", "t"]);
  assert.equal(gh.anyTrustCall().length, 0);
  assert.equal(gh.calls().filter((a) => a[0] === "repo").length, 0);
});

test("CLI pr-create: a pr-create base outside the ref pattern refuses base-ref-invalid with no read", () => {
  const run = governed({ custody: "in-process" });
  const gh = stubGh();
  const r = runCli(["pr-create", "--run-dir", run.runDir, "--issue", ISSUE, "--base", "release 1.0", "--body-file", "/dev/null", "--title", "t", "--json"], { env: gh.env, cwd: remoteRepo() });
  assert.equal(r.code, 1);
  assert.equal(parse(r).commissaire_grants[0].reason, "base-ref-invalid");
  assert.equal(gh.anyTrustCall().length, 0);
});

// --- CLI: merge-gate --local -----------------------------------------------------------------------

function localRepo() {
  const dir = tmpDir("faff1212-local-repo-");
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  g("add", "-A");
  g("commit", "-qm", "base");
  g("checkout", "-qb", "feature");
  writeFileSync(join(dir, "feature.txt"), "x");
  g("add", "-A");
  g("commit", "-qm", "feature work");
  return { dir, g };
}

test("CLI merge-gate --local: reads .commissaire/trust.toml from the local base ref, reports local-ref, and adds no branch-delete entry", () => {
  const run = mkGovernedRun({ custody: "in-process", runId: "RUN-LOCAL1" });
  track(() => run.rm());
  run.grant("merge", "merge", "main");
  run.flush();
  run.seedFloor();
  const { dir, g } = localRepo();
  const abs = join(dir, ".faff", "anchors", "RUN-LOCAL1", ISSUE, "run-ledger.json");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify({ run_id: "RUN-LOCAL1", level: "L3" }));
  g("add", "-A");
  g("commit", "-qm", "anchor");
  const r = runCli(["merge-gate", "--local", "--issue", ISSUE, "--run-dir", run.runDir, "--level", "L3", "--json", "--execute", "--merge-args", "--delete-branch"], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = parse(r);
  assert.equal(out.merged, true);
  assert.equal(out.commissaire_grants.length, 1, "no branch-delete leg on the git-only path");
  assert.equal(out.commissaire_grants[0].leg, "merge");
  assert.equal(out.commissaire_grants[0].trust_source, "local-ref");
  assert.equal(out.commissaire_grants[0].base_ref, "main");
  assert.equal(out.commissaire_grants[0].repo_slug, null);
  assert.equal(out.commissaire_grants[0].evidence, false);
  assert.equal(g("rev-parse", "--verify", "-q", "refs/heads/feature").status, 0, "the branch is not deleted");
});

test("CLI merge-gate --local: a governed run without a merge grant is refused with the blocker line", () => {
  const run = mkGovernedRun({ custody: "in-process", runId: "RUN-LOCAL2" });
  track(() => run.rm());
  run.flush();
  run.seedFloor();
  const { dir, g } = localRepo();
  const abs = join(dir, ".faff", "anchors", "RUN-LOCAL2", ISSUE, "run-ledger.json");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify({ run_id: "RUN-LOCAL2", level: "L3" }));
  g("add", "-A");
  g("commit", "-qm", "anchor");
  const r = runCli(["merge-gate", "--local", "--issue", ISSUE, "--run-dir", run.runDir, "--level", "L3", "--json", "--check-only"], { cwd: dir });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.ok(parse(r).blockers.includes("Commissaire merge grant refused: no-verdict-for-step"));
});
