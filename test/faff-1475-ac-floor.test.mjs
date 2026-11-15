// FAFF-1475 slice 2: an unattended merge skips a pending human-only AC, decided in one place
// (`readAcFloor`) and read by merge-gate, `merge-gate --local`, the already-merged reconcile and the
// governance-check anchor leg. The unattended fact and the human-only ids come only from the anchored
// human-only-acs.json (checked against its stamp); nothing else can produce a skip.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { mintScopeAnchor, mkScopeRun } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const floor = require("../plugin/skills/faff/bin/lib/merge-gate-floor.js");
const gov = require("../plugin/skills/faff/bin/lib/governance-check.js");

const ISSUE = "FAFF-9";
const AC1 = "faff-9#ac-1";
const AC2 = "faff-9#ac-2";
const AC3 = "faff-9#ac-3";

const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

// --- fixtures -----------------------------------------------------------------------------------

const passedRow = (id) => ({ ac: `criterion ${id}`, verified: "test passes", passed: true, ac_id: id, verifications: [{ kind: "test", locator: "t.mjs::it" }] });
const humanRow = (id) => ({ ac: `criterion ${id}`, verified: "Needs human verification: external fact", passed: false, ac_id: id, verifications: [{ kind: "human" }] });
const checklist = (criteria) => ({ schema_version: 1, all_verified: criteria.every((c) => c.passed === true), criteria });
const DEFAULT_CHECKLIST = () => checklist([passedRow(AC1), humanRow(AC2)]);

const humanOnlyBytes = ({ level = "L3", unattended = true, ids = [AC2], issue = ISSUE } = {}) =>
  Buffer.from(JSON.stringify({ schema_version: 1, issue, level, unattended, human_only: ids }, null, 2) + "\n");
const stampLine = (sha, issue = ISSUE) => JSON.stringify({ type: "human-only-acs-stamp", issue, data: { issue, sha256: sha } }) + "\n";

function seedRunDir(runDir, doc = DEFAULT_CHECKLIST()) {
  mkdirSync(join(runDir, ISSUE), { recursive: true });
  writeFileSync(join(runDir, ISSUE, "ac-checklist.json"), JSON.stringify(doc));
  writeFileSync(join(runDir, ISSUE, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
}

// A no-remote repo with a `feature` branch one commit ahead of `main`.
function scaffoldRepo({ config = null } = {}) {
  const dir = mkTmp("faff-1475-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  if (config) writeFileSync(join(dir, ".faffrc.yaml"), config);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "checkout", "-qb", "feature");
  writeFileSync(join(dir, "feature.txt"), "x");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "feature work");
  return dir;
}

// Commit the anchor for the run onto the feature branch and return the new head sha. `file` is the
// human-only-acs.json bytes (null for none), `stamp` is the sha256 the stamp event carries ("auto" hashes
// `file`, null writes no stamp event).
function commitAnchor(repo, runDir, { level = "L3", file = humanOnlyBytes(), stamp = "auto" } = {}) {
  const dir = join(repo, ".faff", "anchors", basename(runDir), ISSUE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({ run_id: basename(runDir), level }));
  if (file !== null) writeFileSync(join(dir, "human-only-acs.json"), file);
  const sha = stamp === "auto" ? (file === null ? null : sha256(file)) : stamp;
  writeFileSync(join(dir, "events.jsonl"), sha === null ? "" : stampLine(sha));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "commit anchor");
  return git(repo, "rev-parse", "feature").stdout.trim();
}

const localArgs = (runDir, level, extra = []) =>
  ["merge-gate", "--local", "--issue", ISSUE, "--run-dir", runDir, "--level", level, "--json", ...extra];

// --- the rule ------------------------------------------------------------------------------------

describe("readAcFloor", () => {
  const humanOnly = (over = {}) => ({ unattended: true, ids: [AC2], ...over });
  const run = (doc, ho) => {
    const runDir = mkTmp("faff-1475-ac-");
    seedRunDir(runDir, doc);
    return floor.readAcFloor(runDir, ISSUE, ho);
  };

  test("a complete checklist passes with nothing called out, with or without a human-only set", () => {
    const doc = checklist([passedRow(AC1)]);
    assert.deepEqual(run(doc, null), { complete: true, called_out: [] });
    assert.deepEqual(run(doc, humanOnly()), { complete: true, called_out: [] });
  });

  test("an unattended pending human-only criterion with another passed criterion is skipped and listed", () => {
    assert.deepEqual(run(DEFAULT_CHECKLIST(), humanOnly()), { complete: true, called_out: [AC2] });
  });

  test("several pending human-only criteria are all listed, in checklist order", () => {
    const doc = checklist([passedRow(AC1), humanRow(AC3), humanRow(AC2)]);
    assert.deepEqual(run(doc, humanOnly({ ids: [AC2, AC3] })), { complete: true, called_out: [AC3, AC2] });
  });

  test("no human-only set, an attended set, or an unreadable checklist blocks as today", () => {
    assert.deepEqual(run(DEFAULT_CHECKLIST(), null), { complete: false, called_out: [] });
    assert.deepEqual(run(DEFAULT_CHECKLIST(), humanOnly({ unattended: false })), { complete: false, called_out: [] });
    const runDir = mkTmp("faff-1475-ac-missing-");
    assert.deepEqual(floor.readAcFloor(runDir, ISSUE, humanOnly()), { complete: false, called_out: [] });
    mkdirSync(join(runDir, ISSUE), { recursive: true });
    writeFileSync(join(runDir, ISSUE, "ac-checklist.json"), "{ not json");
    assert.deepEqual(floor.readAcFloor(runDir, ISSUE, humanOnly()), { complete: false, called_out: [] });
  });

  test("a pending criterion outside the human-only ids keeps the blocker", () => {
    assert.equal(run(DEFAULT_CHECKLIST(), humanOnly({ ids: [AC3] })).complete, false);
    const doc = checklist([passedRow(AC1), humanRow(AC2), humanRow(AC3)]);
    assert.equal(run(doc, humanOnly()).complete, false, "one skippable and one not");
  });

  test("a pending criterion without an ac_id keeps the blocker", () => {
    const row = { ...humanRow(AC2) };
    delete row.ac_id;
    assert.equal(run(checklist([passedRow(AC1), row]), humanOnly()).complete, false);
  });

  test("a pending criterion with a non-human or empty verification keeps the blocker", () => {
    const test_ = { ...humanRow(AC2), verifications: [{ kind: "test", locator: "t.mjs::it" }] };
    const mixed = { ...humanRow(AC2), verifications: [{ kind: "human" }, { kind: "command", locator: "true" }] };
    const empty = { ...humanRow(AC2), verifications: [] };
    const absent = { ...humanRow(AC2) };
    delete absent.verifications;
    for (const row of [test_, mixed, empty, absent]) assert.equal(run(checklist([passedRow(AC1), row]), humanOnly()).complete, false);
  });

  test("a checklist with no passed criterion keeps the blocker", () => {
    assert.equal(run(checklist([humanRow(AC2)]), humanOnly()).complete, false);
  });

  test("an aggregate that disagrees with the rows is not skipped", () => {
    const doc = { ...DEFAULT_CHECKLIST(), all_verified: true };
    assert.equal(run(doc, humanOnly()).complete, false);
    const noCriteria = { schema_version: 1, all_verified: false };
    assert.equal(run(noCriteria, humanOnly()).complete, false);
    assert.equal(run({ schema_version: 1, all_verified: false, criteria: [] }, humanOnly()).complete, false);
  });

  test("the checklist itself is never edited", () => {
    const runDir = mkTmp("faff-1475-ac-ro-");
    seedRunDir(runDir);
    const before = readFileSync(join(runDir, ISSUE, "ac-checklist.json"));
    floor.readAcFloor(runDir, ISSUE, humanOnly());
    assert.ok(readFileSync(join(runDir, ISSUE, "ac-checklist.json")).equals(before));
  });
});

// --- merge-gate --local --------------------------------------------------------------------------

describe("merge-gate --local", () => {
  function setup({ anchor = {}, doc = DEFAULT_CHECKLIST(), config = null } = {}) {
    const repo = scaffoldRepo({ config });
    const runDir = mkTmp("faff-1475-run-");
    seedRunDir(runDir, doc);
    const head = commitAnchor(repo, runDir, anchor);
    return { repo, runDir, head };
  }
  const merge = (s, level = "L3", extra = ["--execute"]) => runCli(localArgs(s.runDir, level, extra), { cwd: s.repo });

  test("an anchored unattended file with a matching stamp lets the merge through and records the call-out", () => {
    const s = setup();
    const r = merge(s);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "merge-ok");
    assert.deepEqual(out.ac_called_out, [AC2]);
    const record = JSON.parse(readFileSync(join(s.runDir, ISSUE, "merge-record.json"), "utf8"));
    assert.deepEqual(record.ac_called_out, [AC2]);
    assert.equal(git(s.repo, "rev-parse", "main").stdout.trim(), s.head);
  });

  test("a clean merge records no ac_called_out and reports an empty list", () => {
    const s = setup({ doc: checklist([passedRow(AC1)]), anchor: { file: null } });
    const r = merge(s);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(JSON.parse(r.stdout).ac_called_out, []);
    assert.ok(!("ac_called_out" in JSON.parse(readFileSync(join(s.runDir, ISSUE, "merge-record.json"), "utf8"))));
  });

  test("at L4 the AC blocker is absent and the call-out is listed", () => {
    const s = setup({ anchor: { level: "L4", file: humanOnlyBytes({ level: "L4", unattended: true }) } });
    const r = merge(s, "L4", ["--check-only"]);
    const out = JSON.parse(r.stdout);
    assert.ok(!out.blockers.some((b) => /ACs not all verified/.test(b)), JSON.stringify(out.blockers));
    assert.deepEqual(out.ac_called_out, [AC2]);
  });

  test("a file that says attended (L2, unattended false) blocks with the AC blocker", () => {
    const s = setup({ anchor: { level: "L2", file: humanOnlyBytes({ level: "L2", unattended: false }) } });
    const r = merge(s, "L2");
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.match(out.blockers.join(" "), /ACs not all verified/);
    assert.deepEqual(out.ac_called_out, []);
  });

  test("an L3 file minted without the unattended declaration blocks", () => {
    const s = setup({ anchor: { file: humanOnlyBytes({ level: "L3", unattended: false }) } });
    const r = merge(s);
    assert.equal(r.code, 1);
    assert.match(JSON.parse(r.stdout).blockers.join(" "), /ACs not all verified/);
  });

  test("the floor never reads the unattended fact from config: a declared repo with an attended file still blocks", () => {
    const s = setup({ config: "autonomous:\n  unattended: true\n", anchor: { file: humanOnlyBytes({ level: "L3", unattended: false }) } });
    const r = merge(s);
    assert.equal(r.code, 1);
    assert.match(JSON.parse(r.stdout).blockers.join(" "), /ACs not all verified/);
  });

  test("an anchored level that disagrees with the file blocks", () => {
    const s = setup({ anchor: { level: "L2", file: humanOnlyBytes({ level: "L4", unattended: true }) } });
    const r = merge(s, "L2");
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.match(out.blockers.join(" "), /ACs not all verified/);
    assert.deepEqual(out.ac_called_out, []);
  });

  test("a file edited after mint, so it no longer matches its stamp, blocks", () => {
    const original = humanOnlyBytes({ ids: [AC2] });
    const edited = humanOnlyBytes({ ids: [AC2, AC3] });
    const doc = checklist([passedRow(AC1), humanRow(AC3)]);
    const s = setup({ doc, anchor: { file: edited, stamp: sha256(original) } });
    const r = merge(s);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.match(out.blockers.join(" "), /ACs not all verified/);
    assert.deepEqual(out.ac_called_out, []);
  });

  test("a file with no stamp event blocks", () => {
    const s = setup({ anchor: { stamp: null } });
    const r = merge(s);
    assert.equal(r.code, 1);
    assert.match(JSON.parse(r.stdout).blockers.join(" "), /ACs not all verified/);
  });

  test("no file in the anchor blocks as today", () => {
    const s = setup({ anchor: { file: null } });
    const r = merge(s);
    assert.equal(r.code, 1);
    assert.match(JSON.parse(r.stdout).blockers.join(" "), /ACs not all verified/);
  });

  test("a pending machine-checkable criterion that is not human-only blocks", () => {
    const doc = checklist([passedRow(AC1), humanRow(AC2), { ...humanRow(AC3), verifications: [{ kind: "test", locator: "t.mjs::it" }] }]);
    const s = setup({ doc });
    const r = merge(s);
    assert.equal(r.code, 1);
    assert.match(JSON.parse(r.stdout).blockers.join(" "), /ACs not all verified/);
  });

  test("a stamp whose digest covers a trailing-newline-less rewrite of the file does not match", () => {
    const file = humanOnlyBytes();
    const trimmed = Buffer.from(file.toString("utf8").trimEnd());
    const s = setup({ anchor: { file: trimmed, stamp: sha256(file) } });
    const r = merge(s);
    assert.equal(r.code, 1);
    assert.match(JSON.parse(r.stdout).blockers.join(" "), /ACs not all verified/);
  });
});

// --- the already-merged reconcile ---------------------------------------------------------------

describe("already-merged reconcile", () => {
  function reconcile(runDir, humanOnly) {
    let result;
    const emit = (r, code) => { result = { ...r, code }; return code; };
    floor.alreadyMergedReconcile(emit, runDir, ISSUE, 7, "abc123", "L3", { state: "unasserted-ok", display: "unasserted" }, humanOnly);
    return result;
  }

  test("a skip is reported, and written to the merge record", () => {
    const runDir = mkTmp("faff-1475-rec-");
    seedRunDir(runDir);
    const r = reconcile(runDir, { unattended: true, ids: [AC2] });
    assert.equal(r.verdict, "merge-ok");
    assert.deepEqual(r.ac_called_out, [AC2]);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, ISSUE, "merge-record.json"), "utf8")).ac_called_out, [AC2]);
  });

  test("without a human-only set it refuses with the AC blocker and writes nothing", () => {
    const runDir = mkTmp("faff-1475-rec-none-");
    seedRunDir(runDir);
    const r = reconcile(runDir, null);
    assert.equal(r.verdict, "refuse");
    assert.match(r.blockers.join(" "), /ACs not all verified/);
    assert.deepEqual(r.ac_called_out, []);
    assert.ok(!existsSync(join(runDir, ISSUE, "merge-record.json")));
  });

  test("a file whose level disagrees with the anchored ledger is read as no skip", () => {
    const repo = scaffoldRepo();
    const runDir = mkTmp("faff-1475-rec-lvl-");
    seedRunDir(runDir);
    const head = commitAnchor(repo, runDir, { level: "L2", file: humanOnlyBytes({ level: "L4", unattended: true }) });
    const humanOnly = floor.readAnchoredHumanOnly(repo, null, runDir, ISSUE, head, "L2");
    assert.equal(humanOnly, null);
    const r = reconcile(runDir, humanOnly);
    assert.equal(r.verdict, "refuse");
    assert.deepEqual(r.ac_called_out, []);
  });

  test("a clean anchor reads back the set it was stamped with", () => {
    const repo = scaffoldRepo();
    const runDir = mkTmp("faff-1475-rec-ok-");
    seedRunDir(runDir);
    const head = commitAnchor(repo, runDir);
    assert.deepEqual(floor.readAnchoredHumanOnly(repo, null, runDir, ISSUE, head, "L3"), { unattended: true, ids: [AC2] });
  });
});

// --- merge-gate on a PR (stubbed gh, real git) -------------------------------------------------

const STUB_GH = `#!/usr/bin/env bash
case "$1" in
  repo) [ "$2" = "view" ] && { printf '{"nameWithOwner":"owner/repo"}'; exit 0; } ;;
  pr)
    case "$2" in
      view)   printf '{"headRefOid":"%s","headRefName":"feature","state":"OPEN","url":"https://example.test/pr/1","baseRefName":"main"}' "$STUB_SHA"; exit 0 ;;
      checks) printf '[]'; exit 0 ;;
    esac ;;
  api)
    case "$*" in
      *check-runs*) printf '[{"status":"completed","conclusion":"success"}]'; exit 0 ;;
      *status*)     printf '{"state":"success","count":1}'; exit 0 ;;
    esac ;;
esac
printf 'stub gh: unhandled: %s\\n' "$*" >&2
exit 3
`;

describe("merge-gate on a PR", () => {
  function prRun(s, level = "L3") {
    const stubDir = mkTmp("faff-1475-gh-");
    writeFileSync(join(stubDir, "gh"), STUB_GH);
    chmodSync(join(stubDir, "gh"), 0o755);
    const env = { PATH: `${stubDir}:${process.env.PATH}`, STUB_SHA: s.head };
    return runCli(["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", s.runDir, "--level", level, "--json", "--check-only"], { cwd: s.repo, env });
  }

  function setup(anchor = {}) {
    const repo = scaffoldRepo();
    const runDir = mkTmp("faff-1475-prrun-");
    seedRunDir(runDir);
    return { repo, runDir, head: commitAnchor(repo, runDir, anchor) };
  }

  test("an anchored unattended file at the PR head removes the AC blocker and lists the call-out", () => {
    const out = JSON.parse(prRun(setup()).stdout);
    assert.ok(!out.blockers.some((b) => /ACs not all verified/.test(b)), JSON.stringify(out.blockers));
    assert.deepEqual(out.ac_called_out, [AC2]);
  });

  test("an attended file at the PR head blocks with the AC blocker", () => {
    const out = JSON.parse(prRun(setup({ file: humanOnlyBytes({ unattended: false }) })).stdout);
    assert.match(out.blockers.join(" "), /ACs not all verified/);
    assert.deepEqual(out.ac_called_out, []);
  });

  test("a file edited after its stamp blocks at the PR head", () => {
    const out = JSON.parse(prRun(setup({ file: humanOnlyBytes({ ids: [AC2, AC3] }), stamp: sha256(humanOnlyBytes()) })).stdout);
    assert.match(out.blockers.join(" "), /ACs not all verified/);
  });
});

// --- governance-check ----------------------------------------------------------------------------

describe("governance-check", () => {
  // A real per-issue anchor minted from a run dir whose checklist has one pending human criterion and
  // whose human-only-acs.json (and stamp) came from the real writer.
  function anchor(t, { doc = { level: "L3", unattended: true }, writeFile = true } = {}) {
    const root = mkTmp("faff-1475-gov-");
    const { runDir, runName } = mkScopeRun(root, { admitted: [ISSUE] });
    writeFileSync(join(runDir, ISSUE, "ac-checklist.json"), JSON.stringify(DEFAULT_CHECKLIST()));
    if (writeFile) {
      const w = runCli(["evidence", "write", "human-only-acs", "--run-dir", runDir, "--issue", ISSUE], { cwd: root, input: JSON.stringify({ issue: ISSUE, human_only: [AC2], ...doc }) });
      assert.equal(w.code, 0, w.stderr);
    }
    const dest = mintScopeAnchor(runDir, runName, ISSUE, join(root, "anchors"));
    return { root, runDir, dest };
  }

  test("the anchor leg passes by skip, with no unattended flag, and lists the call-out", (t) => {
    const a = anchor(t);
    const r = gov.evaluateAnchorDir(a.dest, "pass", "L3");
    assert.equal(r.legs.merge_floor.pass, true, JSON.stringify(r.legs.merge_floor));
    assert.deepEqual(r.legs.merge_floor.issues[0].ac_called_out, [AC2]);
  });

  test("the text output names the called-out ids", (t) => {
    const a = anchor(t);
    const r = runCli(["governance-check", "--anchor-dir", a.dest], { cwd: a.root });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /human-only ACs called out: faff-9#ac-2/);
  });

  test("a file minted without the unattended fact fails the leg with the governance wording", (t) => {
    const a = anchor(t, { doc: { level: "L3", unattended: false } });
    const r = gov.evaluateAnchorDir(a.dest, "pass", "L3");
    assert.equal(r.legs.merge_floor.pass, false);
    assert.match(r.legs.merge_floor.issues[0].reasons.join(" "), /ac-checklist\.json missing\/incomplete/);
    assert.deepEqual(r.legs.merge_floor.issues[0].ac_called_out, []);
  });

  test("with the file deleted from the anchor the leg fails with its own reason", (t) => {
    const a = anchor(t);
    rmSync(join(a.dest, "human-only-acs.json"));
    const r = gov.evaluateAnchorDir(a.dest, "pass", "L3");
    assert.equal(r.legs.merge_floor.pass, false);
    assert.match(r.legs.merge_floor.issues[0].reasons.join(" "), /ac-checklist\.json missing\/incomplete/);
    assert.ok(!/ACs not all verified/.test(r.legs.merge_floor.issues[0].reasons.join(" ")));
  });

  test("a file edited after its stamp fails the leg", (t) => {
    const a = anchor(t);
    const edited = JSON.parse(readFileSync(join(a.dest, "human-only-acs.json"), "utf8"));
    edited.human_only.push(AC3);
    writeFileSync(join(a.dest, "human-only-acs.json"), JSON.stringify(edited, null, 2) + "\n");
    assert.equal(gov.evaluateAnchorDir(a.dest, "pass", "L3").legs.merge_floor.pass, false);
  });

  test("the live run-dir leg passes no human-only set and blocks as today", (t) => {
    const a = anchor(t);
    const leg = gov.evaluateMergeFloorLeg(a.runDir, ISSUE, "L3");
    assert.equal(leg.pass, false);
    assert.deepEqual(leg.ac_called_out, []);
  });

  test("merge-gate and governance-check agree on an L3 run declared unattended at mint", (t) => {
    const a = anchor(t);
    const govPass = gov.evaluateAnchorDir(a.dest, "pass", "L3").legs.merge_floor;
    const repo = scaffoldRepo();
    const runDir = mkTmp("faff-1475-agree-");
    seedRunDir(runDir);
    commitAnchor(repo, runDir);
    const r = runCli(localArgs(runDir, "L3", ["--check-only"]), { cwd: repo });
    const out = JSON.parse(r.stdout);
    assert.equal(govPass.pass, true);
    assert.ok(!out.blockers.some((b) => /ACs not all verified/.test(b)));
    assert.deepEqual(out.ac_called_out, govPass.issues[0].ac_called_out);
  });

  test("merge-gate and governance-check agree on an L3 run not declared unattended at mint", (t) => {
    const a = anchor(t, { doc: { level: "L3", unattended: false } });
    const govLeg = gov.evaluateAnchorDir(a.dest, "pass", "L3").legs.merge_floor;
    const repo = scaffoldRepo();
    const runDir = mkTmp("faff-1475-agree-no-");
    seedRunDir(runDir);
    commitAnchor(repo, runDir, { file: humanOnlyBytes({ unattended: false }) });
    const out = JSON.parse(runCli(localArgs(runDir, "L3", ["--check-only"]), { cwd: repo }).stdout);
    assert.equal(govLeg.pass, false);
    assert.match(out.blockers.join(" "), /ACs not all verified/);
  });
});
