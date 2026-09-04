// FAFF-994 — the durable, interrogatable spec-review judgement trail. Writer (`faff
// judge-trail mint`), reader core (`faff judge-history`), and `faff audit`'s durable
// second source, over a dedicated `refs/faff/judge-trail/<run_id>` custom git ref.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { sha256Text } = require("../plugin/skills/faff/bin/lib/spec-judge-casefile.js");
const jt = require("../plugin/skills/faff/bin/lib/judge-trail.js");

function initRepo(root) {
  spawnSync("git", ["-C", root, "init", "-q"]);
  spawnSync("git", ["-C", root, "config", "user.email", "faff-selftest@example.com"]);
  spawnSync("git", ["-C", root, "config", "user.name", "faff-selftest"]);
}

// Seed <root>/.faff/runs/<run_id>/<issue>/spec-review/{round-1.json,judge/{ledger,ruling-p-01,admit-result}.json}
// plus an on-disk spec file at <root>/.faff/runs/<run_id>/<issue>/spec-draft.md — the full
// judge-invoked fixture shape.
function seedFullFixture(root, runId, issue, { admit = true } = {}) {
  const runDir = join(root, ".faff", "runs", runId);
  const issueDir = join(runDir, issue);
  const specReviewDir = join(issueDir, "spec-review");
  const judgeDir = join(specReviewDir, "judge");
  mkdirSync(judgeDir, { recursive: true });
  writeFileSync(join(issueDir, "spec-draft.md"), "# Spec\n\nhello world\n");
  writeFileSync(join(specReviewDir, "round-1.json"), JSON.stringify({
    verdict: "reject-approach",
    objections: [
      { lens: "infosec", severity: "major", claim: "leak", evidence: "see config.txt", predicted_consequence: "exfiltration", spec_anchor: "the-guard" },
      { lens: "QA", severity: "minor", claim: "untested boundary", evidence: "", predicted_consequence: null, spec_anchor: "the-guard-decision" },
    ],
  }));
  writeFileSync(join(judgeDir, "ledger.json"), JSON.stringify({
    order: ["p-01", "p-02"],
    entries: {
      "p-01": { proposition_id: "p-01", lens: "infosec", severity: "major", blocking: true, contested_source: true, pre_ruling_spec_sha: "deadbeef", pre_ruling_spec_content: "old spec text", resolution: "resolved" },
      "p-02": { proposition_id: "p-02", lens: "QA", severity: "minor", blocking: false, contested_source: false, pre_ruling_spec_sha: "deadbeef", pre_ruling_spec_content: "old spec text", resolution: "resolved" },
    },
    run_id: runId,
    window_start: 1,
  }));
  writeFileSync(join(judgeDir, "ruling-p-01.json"), JSON.stringify({
    proposition_id: "p-01", outcome: "AFFIRM_SPEC", rationale: "the spec already covers this",
    correction: null, synthesis_sources: [], prd_gap_citation: "", lens: "infosec", severity: "major", conformant: true, violations: [],
  }));
  writeFileSync(join(judgeDir, "ruling-p-02.json"), JSON.stringify({
    proposition_id: "p-02", outcome: "AFFIRM_SPEC", rationale: "minor, no correction needed",
    correction: null, synthesis_sources: [], prd_gap_citation: "", lens: "QA", severity: "minor", conformant: true, violations: [],
  }));
  const admitResult = {
    admit, level: "L3", resolved: ["p-01", "p-02"], unresolved: admit ? [] : ["p-01"], parked: [],
    prd_boundary: [], minor_corrections_applied: [], minor_corrections_unapplied: [], floor_veto: admit ? [] : ["blocker"],
  };
  writeFileSync(join(judgeDir, "admit-result.json"), JSON.stringify(admitResult));
  return { runDir, issueDir, specReviewDir, judgeDir, admitResult };
}

test("mint: a run dir with no spec-review material anywhere is a clean no-op, exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-noop-"));
  try {
    initRepo(root);
    const runId = "run-empty-000000";
    const runDir = join(root, ".faff", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const r = runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.minted, false);
    assert.match(body.message, /nothing to mint/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mint -> judge-history (local store): manifest carries schema_version/issue/run_id/built_spec_sha/paths/outcome/lenses/witness_sha; witness verifies; contested_source carried through, not dropped; opens no PR/branch", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-happy-"));
  try {
    initRepo(root);
    const runId = "run-happy-000001";
    const { runDir } = seedFullFixture(root, runId, "FAFF-1", { admit: true });

    const mint = runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]);
    assert.equal(mint.code, 0, mint.stderr);
    const mintBody = JSON.parse(mint.stdout);
    assert.equal(mintBody.minted, true);
    assert.deepEqual(mintBody.issues, ["FAFF-1"]);
    assert.equal(mintBody.ref, `refs/faff/judge-trail/${runId}`);

    // no branch/PR surface — a custom ref, never refs/heads/*
    const heads = spawnSync("git", ["-C", root, "for-each-ref", "refs/heads/"], { encoding: "utf8" });
    assert.equal((heads.stdout || "").trim(), "", "mint creates no branch — opens no PR");

    const hist = runCli(["judge-history", "--run", runId, "--root", root, "--json"]);
    assert.equal(hist.code, 0, hist.stderr);
    const records = JSON.parse(hist.stdout);
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec.issue, "FAFF-1");
    assert.equal(rec.outcome, "admit");
    assert.equal(rec.tamper_suspect, false);
    assert.deepEqual([...rec.lenses].sort(), ["QA", "infosec"]);

    const m = rec.manifest;
    assert.equal(m.schema_version, 1);
    assert.equal(m.issue, "FAFF-1");
    assert.equal(m.run_id, runId);
    assert.equal(m.spec_blob, "spec.txt");
    assert.equal(m.objections, "objections.json");
    assert.equal(m.rulings, "rulings.json");
    assert.equal(m.admit_result, "admit-result.json");
    assert.equal(m.built_spec_sha, sha256Text("# Spec\n\nhello world\n"), "built_spec_sha == sha256Text(spec_text), the exact spec.txt bytes just fetched below");
    const manifestCore = { ...m };
    delete manifestCore.witness_sha;
    assert.equal(m.witness_sha, jt.witnessSha(manifestCore), "witness_sha == sha256(canonicalJSON(manifest_core))");

    // Fetch the raw tree via git plumbing (no checkout) and confirm byte-identical verbatim content.
    const sha = spawnSync("git", ["-C", root, "for-each-ref", "refs/faff/judge-trail/", "--format=%(objectname)"], { encoding: "utf8" }).stdout.trim();
    const objectionsRaw = spawnSync("git", ["-C", root, "show", `${sha}:FAFF-1/objections.json`], { encoding: "utf8" }).stdout;
    const objections = JSON.parse(objectionsRaw);
    assert.equal(objections.length, 2);
    assert.equal(objections[0].claim, "leak");
    assert.equal(objections[0].evidence, "see config.txt");
    assert.equal(objections[0].predicted_consequence, "exfiltration");
    assert.equal(objections[0].spec_anchor, "the-guard");
    assert.equal(objections[0].contested_source, true, "down-weighted objection is stored, not dropped");
    assert.equal(objections[1].contested_source, false);

    const admitRaw = spawnSync("git", ["-C", root, "show", `${sha}:FAFF-1/admit-result.json`], { encoding: "utf8" }).stdout;
    assert.equal(JSON.parse(admitRaw).admit, true);

    const rulingsRaw = spawnSync("git", ["-C", root, "show", `${sha}:FAFF-1/rulings.json`], { encoding: "utf8" }).stdout;
    const rulings = JSON.parse(rulingsRaw);
    assert.equal(rulings.length, 2);
    assert.equal(rulings[0].proposition_id, "p-01");
    assert.equal(rulings[0].outcome, "AFFIRM_SPEC");

    const specRaw = spawnSync("git", ["-C", root, "show", `${sha}:FAFF-1/spec.txt`], { encoding: "utf8" }).stdout;
    assert.match(specRaw, /hello world/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mint survives run-dir cleanup: the ref is readable via judge-history after the run dir the mint was built from is deleted", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-survives-"));
  try {
    initRepo(root);
    const runId = "run-survives-cleanup-000009";
    const { runDir } = seedFullFixture(root, runId, "FAFF-7", { admit: true });
    const mint = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(mint.minted, true);

    // The run-dir scratch material is swept (the exact lifecycle event the trail exists to
    // survive) — the ref lives under .git, decoupled from the run-dir it was built from.
    rmSync(join(root, ".faff", "runs"), { recursive: true, force: true });

    const hist = runCli(["judge-history", "--run", runId, "--root", root, "--json"]);
    assert.equal(hist.code, 0, hist.stderr);
    const records = JSON.parse(hist.stdout);
    assert.equal(records.length, 1);
    assert.equal(records[0].issue, "FAFF-7");
    assert.equal(records[0].tamper_suspect, false, "the minted content is intact independent of the swept run dir");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mint is write-once: a second mint for the same run_id leaves a single ref (clean logged no-op), never a force-update", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-writeonce-"));
  try {
    initRepo(root);
    const runId = "run-writeonce-000002";
    const { runDir } = seedFullFixture(root, runId, "FAFF-1");
    const first = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(first.minted, true);
    const shaAfterFirst = spawnSync("git", ["-C", root, "for-each-ref", "refs/faff/judge-trail/", "--format=%(objectname)"], { encoding: "utf8" }).stdout.trim();

    const second = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(second.minted, false, "a second mint for the same run_id is a clean no-op");
    assert.equal(second.ok, true);
    const shaAfterSecond = spawnSync("git", ["-C", root, "for-each-ref", "refs/faff/judge-trail/", "--format=%(objectname)"], { encoding: "utf8" }).stdout.trim();
    assert.equal(shaAfterSecond, shaAfterFirst, "the ref head is unchanged — never a force-update");

    // exactly one ref for this run_id
    const all = spawnSync("git", ["-C", root, "for-each-ref", "refs/faff/judge-trail/"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
    assert.equal(all.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("judge-history: a witness_sha mismatch is retained and flagged tamper_suspect, never dropped and never exit-nonzero", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-tamper-"));
  try {
    initRepo(root);
    const runId = "run-tamper-000003";
    const { runDir } = seedFullFixture(root, runId, "FAFF-1");
    const mint = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(mint.minted, true);

    const ref = `refs/faff/judge-trail/${runId}`;
    const origSha = spawnSync("git", ["-C", root, "for-each-ref", ref, "--format=%(objectname)"], { encoding: "utf8" }).stdout.trim();

    // Rebuild the FAFF-1 tree with a mutated manifest.json (a hand-edited outcome, witness_sha
    // left untouched) layered over the original blobs for every other path — simulates a
    // tampered store without needing to reconstruct the whole tree by hand. Nested paths
    // (e.g. "FAFF-1/manifest.json") can't go through `git mktree` (it refuses any entry name
    // containing a slash) — use the same temp-index + update-index --cacheinfo + write-tree
    // idiom judge-trail.js's own mint uses to materialise real subtrees.
    const origManifestRaw = spawnSync("git", ["-C", root, "show", `${origSha}:FAFF-1/manifest.json`], { encoding: "utf8" }).stdout;
    const tamperedManifest = JSON.parse(origManifestRaw);
    tamperedManifest.outcome = "park"; // mutate the core WITHOUT recomputing witness_sha
    const newManifestBlob = spawnSync("git", ["-C", root, "hash-object", "-w", "--stdin"], { input: JSON.stringify(tamperedManifest), encoding: "utf8" }).stdout.trim();

    const lsTree = spawnSync("git", ["-C", root, "ls-tree", "-r", origSha], { encoding: "utf8" }).stdout.trim().split("\n");
    const tmpIndex = join(root, ".git", "tamper-fixture-index");
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    for (const line of lsTree) {
      const [meta, filePath] = line.split("\t");
      const [mode, , origBlobSha] = meta.split(" ");
      const blobSha = filePath === "FAFF-1/manifest.json" ? newManifestBlob : origBlobSha;
      const upd = spawnSync("git", ["-C", root, "update-index", "--add", "--cacheinfo", `${mode},${blobSha},${filePath}`], { env, encoding: "utf8" });
      assert.equal(upd.status, 0, `update-index failed for ${filePath}: ${upd.stderr}`);
    }
    const newTree = spawnSync("git", ["-C", root, "write-tree"], { env, encoding: "utf8" }).stdout.trim();
    const newCommit = spawnSync("git", ["-C", root, "commit-tree", newTree, "-m", "tampered (test fixture)"], { encoding: "utf8" }).stdout.trim();
    const forceUpdate = spawnSync("git", ["-C", root, "update-ref", ref, newCommit]);
    assert.equal(forceUpdate.status, 0);

    const hist = runCli(["judge-history", "--run", runId, "--root", root, "--json"]);
    assert.equal(hist.code, 0, "a tamper-suspect record is surfaced, not an error exit");
    const records = JSON.parse(hist.stdout);
    assert.equal(records.length, 1, "the record is RETAINED, never dropped");
    assert.equal(records[0].tamper_suspect, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("judge-history: no judge-trail refs at all -> empty set under --json, exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-none-"));
  try {
    initRepo(root);
    const r = runCli(["judge-history", "--json", "--root", root]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mint: a run that never invoked the judge (only refuter rounds, no judge/ dir) mints admit_result:null, outcome:'no-judge'", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-nojudge-"));
  try {
    initRepo(root);
    const runId = "run-nojudge-000004";
    const runDir = join(root, ".faff", "runs", runId);
    const specReviewDir = join(runDir, "FAFF-2", "spec-review");
    mkdirSync(specReviewDir, { recursive: true });
    writeFileSync(join(specReviewDir, "round-1.json"), JSON.stringify({
      verdict: "reject-approach",
      objections: [{ lens: "architectural", severity: "blocker", claim: "wrong shape", evidence: "x", predicted_consequence: "y", spec_anchor: "z" }],
    }));

    const mint = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(mint.minted, true);

    const records = JSON.parse(runCli(["judge-history", "--run", runId, "--root", root, "--json"]).stdout);
    assert.equal(records.length, 1);
    assert.equal(records[0].outcome, "no-judge");
    assert.equal(records[0].manifest.admit_result, null, "admit_result is null when the judge never ran");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("judge-history: --lens and --outcome filter; --issue filters to one issue", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-filters-"));
  try {
    initRepo(root);
    const runId = "run-filters-000005";
    seedFullFixture(root, runId, "FAFF-3", { admit: true });
    seedFullFixture(root, runId, "FAFF-4", { admit: false });
    const runDir = join(root, ".faff", "runs", runId);
    const mint = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(mint.minted, true);
    assert.deepEqual([...mint.issues].sort(), ["FAFF-3", "FAFF-4"]);

    const admitOnly = JSON.parse(runCli(["judge-history", "--run", runId, "--outcome", "admit", "--root", root, "--json"]).stdout);
    assert.deepEqual(admitOnly.map((r) => r.issue), ["FAFF-3"]);

    const parkOnly = JSON.parse(runCli(["judge-history", "--run", runId, "--outcome", "park", "--root", root, "--json"]).stdout);
    assert.deepEqual(parkOnly.map((r) => r.issue), ["FAFF-4"]);

    const infosecLens = JSON.parse(runCli(["judge-history", "--run", runId, "--lens", "infosec", "--root", root, "--json"]).stdout);
    assert.equal(infosecLens.length, 2, "both issues carry an infosec objection");

    const oneIssue = JSON.parse(runCli(["judge-history", "--issue", "FAFF-3", "--root", root, "--json"]).stdout);
    assert.deepEqual(oneIssue.map((r) => r.issue), ["FAFF-3"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mint (git-remote store): pushes a write-once orphan commit to origin, no PR/branch; judge-history reads it via ls-remote/fetch/show (no checkout); a second mint against the remote is a clean no-op", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-judge-trail-gitremote-"));
  try {
    const bareRemote = join(scratch, "remote.git");
    const workRoot = join(scratch, "work");
    mkdirSync(workRoot, { recursive: true });
    spawnSync("git", ["init", "--bare", "-q", bareRemote]);
    initRepo(workRoot);
    spawnSync("git", ["-C", workRoot, "remote", "add", "origin", bareRemote]);
    writeFileSync(join(workRoot, ".faffrc.yaml"), "bundle_store: git-remote\n");

    const runId = "run-gitremote-000006";
    const { runDir } = seedFullFixture(workRoot, runId, "FAFF-5", { admit: true });

    const mint = runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", workRoot, "--json"], { cwd: workRoot });
    assert.equal(mint.code, 0, mint.stderr);
    const mintBody = JSON.parse(mint.stdout);
    assert.equal(mintBody.minted, true);

    // No branch surface on the remote either.
    const remoteHeads = spawnSync("git", ["ls-remote", bareRemote, "refs/heads/*"], { encoding: "utf8" }).stdout.trim();
    assert.equal(remoteHeads, "", "git-remote mint creates no branch on the remote — no PR/CI surface");
    const remoteRef = spawnSync("git", ["ls-remote", bareRemote, `refs/faff/judge-trail/${runId}`], { encoding: "utf8" }).stdout.trim();
    assert.notEqual(remoteRef, "", "the ref was pushed to the remote");

    // Read back from a FRESH clone-free directory (checkout-free: init + remote add only).
    const freshRoot = join(scratch, "fresh");
    mkdirSync(freshRoot, { recursive: true });
    spawnSync("git", ["-C", freshRoot, "init", "-q"]);
    spawnSync("git", ["-C", freshRoot, "remote", "add", "origin", bareRemote]);
    writeFileSync(join(freshRoot, ".faffrc.yaml"), "bundle_store: git-remote\n");
    const hist = runCli(["judge-history", "--run", runId, "--root", freshRoot, "--json"], { cwd: freshRoot });
    assert.equal(hist.code, 0, hist.stderr);
    const records = JSON.parse(hist.stdout);
    assert.equal(records.length, 1);
    assert.equal(records[0].issue, "FAFF-5");
    assert.equal(records[0].tamper_suspect, false);

    // A second mint (non-force push) against the already-populated remote is a clean no-op.
    const second = runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", workRoot, "--json"], { cwd: workRoot });
    assert.equal(second.code, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).minted, false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("faff audit <run-id>: the durable judge-trail SECOND source is folded in via self-spawn, preserving tamper_suspect; regions check still passes (no governance->factory require edge)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-audit-"));
  try {
    initRepo(root);
    const runId = "run-audit-000007";
    const { runDir } = seedFullFixture(root, runId, "FAFF-6", { admit: true });
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: runId, admitted: ["FAFF-6"], outcomes: { "FAFF-6": "parked" } }));
    writeFileSync(join(runDir, "events.jsonl"), JSON.stringify({ schema: 1, run_id: runId, seq: 0, ts: "2026-09-04T00:00:00Z", phase: "run", type: "run-start" }) + "\n");

    const mint = JSON.parse(runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]).stdout);
    assert.equal(mint.minted, true);

    const audit = runCli(["audit", runId, "--root", root, "--json"]);
    assert.equal(audit.code, 0, audit.stderr);
    const recon = JSON.parse(audit.stdout);
    assert.ok(recon.durable_judge_trail, "audit reconstruction carries a durable_judge_trail field");
    assert.equal(recon.durable_judge_trail.available, true);
    assert.equal(recon.durable_judge_trail.records.length, 1);
    assert.equal(recon.durable_judge_trail.records[0].issue, "FAFF-6");
    assert.equal(recon.durable_judge_trail.records[0].tamper_suspect, false);

    // The single-run reconstruction still renders normally alongside the second source.
    assert.equal(recon.run_id, runId);
    assert.ok(Array.isArray(recon.issues) && recon.issues.some((i) => i.issue === "FAFF-6"));

    // The region-boundary invariant this build's single highest-risk mistake would break:
    // audit.js (governance) must never require() judge-trail.js (factory) — only a
    // spawnSync self-spawn. `faff regions check` is the mechanical assertion of that.
    const regions = runCli(["regions", "check"]);
    assert.equal(regions.code, 0, `faff regions check must pass (stdout: ${regions.stdout}, stderr: ${regions.stderr})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("faff audit: when no judge-trail ref exists for the run, the durable second source is absent (never fails audit; single-run reconstruction renders alone)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-trail-audit-absent-"));
  try {
    initRepo(root);
    const runId = "run-audit-absent-000008";
    const runDir = join(root, ".faff", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: runId, admitted: [], outcomes: {} }));
    writeFileSync(join(runDir, "events.jsonl"), "");

    const audit = runCli(["audit", runId, "--root", root, "--json"]);
    assert.equal(audit.code, 0, audit.stderr);
    const recon = JSON.parse(audit.stdout);
    assert.equal(recon.durable_judge_trail.available, true, "an empty ref enumeration is available:true with zero records, not an error");
    assert.deepEqual(recon.durable_judge_trail.records, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
