// FAFF-820 — `faff bundle-recover`: the read-only Phase-0 recovery verb for a fresh
// executor with no local `.faff/runs/<run-id>/`. Discovers the most recent CLEAN bundle
// for an issue across runs, verifies it through the unforked FAFF-819 ladder
// (`verifyBundleIdentity`/`classifyBundle`), reconstructs exactly three targets, and
// computes a read-only resume-or-park preview via the unforked resume cores. Exercised
// via the real CLI seam (mirrors bundle.test.mjs/reconcile-recover.test.mjs) plus direct
// require of the pure cores. Per ADR 0002 (assert at the CLI/module seam).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const {
  selectMostRecent, idempotencyDecision, foldEscapesIntoPlan, refusedDisposition,
  discoverLocalCandidates, bundleRecover, bundleRecoverExitCode,
} = require("../plugin/skills/faff/bin/lib/bundle-recover.js");
const { publishBundle, localBundleStore, gitRemoteBundleStore } = require("../plugin/skills/faff/bin/lib/bundle.js");
const { mintIssueAnchor } = require("../plugin/skills/faff/bin/lib/events.js");

// --- --selftest (the pure-core table + a full local-store round trip) ---
test("bundle-recover --selftest: pure cores + the local-store discover/verify/reconstruct/preview round trip pass", () => {
  const { code, stdout } = runCli(["bundle-recover", "--selftest"]);
  assert.equal(code, 0, stdout);
});

test("contract recovery-disposition --selftest: the fixture table passes", () => {
  const { code } = runCli(["contract", "recovery-disposition", "--selftest"]);
  assert.equal(code, 0);
});

// --- CLI arg validation (fail-loud before any store call) ---
test("bundle-recover: missing --issue -> exit 2", () => {
  const { code, stderr } = runCli(["bundle-recover"]);
  assert.equal(code, 2);
  assert.match(stderr, /--issue is required/);
});

test("bundle-recover: an invalid --issue id -> exit 2", () => {
  const { code, stderr } = runCli(["bundle-recover", "--issue", "not an id!"]);
  assert.equal(code, 2);
  assert.match(stderr, /not a valid issue id/);
});

// --- pure cores, exercised directly (module-seam repeat of what --selftest covers in-process) ---
test("selectMostRecent: an empty candidate list is not ambiguous and chooses nothing", () => {
  const r = selectMostRecent([]);
  assert.equal(r.ambiguous, false);
  assert.equal(r.chosen, null);
});

test("selectMostRecent: two distinct CLEAN candidates with identical ts and identical run_id sort-prefix refuse ambiguous", () => {
  const a = { run_id: "run-20260101-000000-aaa", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const b = { run_id: "run-20260101-000000-bbb", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const r = selectMostRecent([{ identity: a, ts: "2026-01-01T00:00:00.000Z" }, { identity: b, ts: "2026-01-01T00:00:00.000Z" }]);
  assert.equal(r.ambiguous, true);
  assert.equal(r.chosen, null);
});

test("selectMostRecent: a later last_safe_boundary.ts always wins regardless of run_id ordering", () => {
  const older = { run_id: "run-20260105-000000-z", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const newer = { run_id: "run-20260101-000000-a", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const r = selectMostRecent([{ identity: older, ts: "2026-01-05T00:00:00.000Z" }, { identity: newer, ts: "2026-01-09T00:00:00.000Z" }]);
  assert.equal(r.ambiguous, false);
  assert.equal(r.chosen.identity.run_id, newer.run_id);
});

test("idempotencyDecision: absent/match/conflict", () => {
  assert.equal(idempotencyDecision(null, Buffer.from("a")), "absent");
  assert.equal(idempotencyDecision(Buffer.from("a"), Buffer.from("a")), "match");
  assert.equal(idempotencyDecision(Buffer.from("a"), Buffer.from("b")), "conflict");
});

test("foldEscapesIntoPlan: an escaped issue is removed from skip/continue/redispatch and parked", () => {
  const plan = { skip: ["A"], continue_review: ["B"], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true };
  const folded = foldEscapesIntoPlan(plan, [{ issue: "A", step: "build", escaped: [{ kind: "git-push", target: "x" }] }]);
  assert.ok(!folded.skip.includes("A"));
  assert.ok(folded.park.some((p) => p.issue === "A" && p.divergence.class === "escaped-side-effect"));
  assert.ok(folded.continue_review.includes("B"), "an unaffected issue is untouched");
});

test("refusedDisposition: always carries a null run_dir and a null resume_preview", () => {
  const d = refusedDisposition({ bundle_verdict: "MISSING", bundle_identity: null, run_id: "", boundary_kind: "issue-merge-floor", reason: "x", candidates_considered: 0 });
  assert.equal(d.disposition, "refused");
  assert.equal(d.run_dir, null);
  assert.equal(d.resume_preview, null);
});

test("bundleRecoverExitCode: reconstructed/noop-already-present -> 0, refused -> 1", () => {
  assert.equal(bundleRecoverExitCode("reconstructed"), 0);
  assert.equal(bundleRecoverExitCode("noop-already-present"), 0);
  assert.equal(bundleRecoverExitCode("refused"), 1);
});

// ---------------------------------------------------------------------------
// End-to-end CLI round trip against a real local-store fixture (same-box scenario).
// ---------------------------------------------------------------------------
function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-cli-t-"));
  const run_id = "run-fixture-000000-recover";
  const runDir = path.join(root, ".faff", "runs", run_id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ run_id, admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } }));
  writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
  const anchorDest = path.join(root, ".faff", "anchors", run_id, "FAFF-1");
  const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
  assert.equal(mint.ok, true, "fixture: anchor mint must succeed");
  const store = localBundleStore(root);
  const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root, store, boundarySeq: 0 });
  assert.equal(pub.ok, true, "fixture: bundle publish must succeed");
  return { root, run_id, runDir };
}

test("bundle-recover (local store, same box): reconstructs a run directory that never existed on this root", () => {
  const { root, run_id } = fixtureRoot();
  const freshRoot = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-fresh-t-"));
  try {
    // Copy the published local-store bundle tree to a SEPARATE fresh root (simulating a
    // different box reading the same store) — freshRoot has no .faff/runs at all.
    mkdirSync(path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    cpSync(path.join(root, ".faff", "bundles"), path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    assert.ok(!existsSync(path.join(freshRoot, ".faff", "runs", run_id)));

    const r = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--json"], { cwd: freshRoot });
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.disposition, "reconstructed");
    assert.equal(body.bundle_verdict, "CLEAN");
    assert.equal(body.run_id, run_id);
    assert.equal(body.dry_run, false, "a real (non-dry-run) reconstruction reads dry_run:false at the contract layer, distinguishable from a --dry-run preview");
    assert.ok(existsSync(path.join(freshRoot, ".faff", "runs", run_id, "run-ledger.json")));
    assert.ok(existsSync(path.join(freshRoot, ".faff", "anchors", run_id, "FAFF-1", "events.jsonl")));

    // Repeated recovery is idempotent.
    const r2 = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--json"], { cwd: freshRoot });
    assert.equal(r2.code, 0);
    assert.equal(JSON.parse(r2.stdout).disposition, "noop-already-present");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(freshRoot, { recursive: true, force: true });
  }
});

test("bundle-recover: no bundle at all for the issue -> refused/MISSING, exit 1", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-missing-t-"));
  try {
    const r = runCli(["bundle-recover", "--issue", "NO-SUCH-ISSUE", "--root", root, "--json"], { cwd: root });
    assert.equal(r.code, 1);
    const body = JSON.parse(r.stdout);
    assert.equal(body.disposition, "refused");
    assert.equal(body.bundle_verdict, "MISSING");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle-recover --dry-run: reports reconstructed but writes nothing to the real root", () => {
  const { root, run_id } = fixtureRoot();
  const freshRoot = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-dry-t-"));
  try {
    mkdirSync(path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    cpSync(path.join(root, ".faff", "bundles"), path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    const r = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--dry-run", "--json"], { cwd: freshRoot });
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.disposition, "reconstructed");
    assert.equal(body.dry_run, true);
    assert.ok(!existsSync(path.join(freshRoot, ".faff", "runs", run_id)), "dry-run must never write the real root");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(freshRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The killed-executor fixture (spec §5/§7): a run driven to an issue-merge-floor
// boundary for FAFF-1 with a SECOND issue (FAFF-2) admitted and left in flight, never
// anchored. Publishes to a scratch bare git-remote, removes ALL local run/anchor state,
// and recovers against a genuinely fresh root that only knows the git remote.
// ---------------------------------------------------------------------------
function killedExecutorFixture() {
  const gitTmp = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-killed-"));
  const bareRemote = path.join(gitTmp, "remote.git");
  const workRoot = path.join(gitTmp, "work");
  mkdirSync(workRoot, { recursive: true });
  spawnSync("git", ["init", "--bare", "-q", bareRemote]);
  spawnSync("git", ["-C", workRoot, "init", "-q"]);
  spawnSync("git", ["-C", workRoot, "config", "user.email", "faff-selftest@example.com"]);
  spawnSync("git", ["-C", workRoot, "config", "user.name", "faff-selftest"]);
  spawnSync("git", ["-C", workRoot, "remote", "add", "origin", bareRemote]);

  const run_id = "run-20260101-120000-killed";
  const runDir = path.join(workRoot, ".faff", "runs", run_id);
  mkdirSync(runDir, { recursive: true });
  // FAFF-1 reached its issue-merge-floor boundary (shipped, no merge-record.json carried by
  // the bundle); FAFF-2 is admitted but the run died before it was ever anchored or checkpointed.
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({
    run_id, admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped" },
    owner: { epoch: 0, status: "running", last_heartbeat: "2020-01-01T00:00:00.000Z" },
  }));
  writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T12:00:00.000Z","phase":"run","type":"run-start"}\n`);
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
  // FAFF-2 gets NO directory, NO build-progress.json, NO merge-record.json — pure in-flight loss.

  const anchorDest = path.join(workRoot, ".faff", "anchors", run_id, "FAFF-1");
  const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
  assert.equal(mint.ok, true, "killed-executor fixture: anchor mint must succeed");

  const store = gitRemoteBundleStore(workRoot, "origin");
  const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: workRoot, store, boundarySeq: 0 });
  assert.equal(pub.ok, true, `killed-executor fixture: bundle publish must succeed (got ${JSON.stringify(pub)})`);

  return { gitTmp, bareRemote, run_id };
}

function ghSpySetup() {
  const spyDir = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-ghspy-"));
  const logPath = path.join(spyDir, "gh-invocations.log");
  const script = `#!/bin/sh\necho "gh invoked: $*" >> "${logPath}"\nexit 1\n`;
  const ghPath = path.join(spyDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  // Prepend the spy dir so `gh` resolves to it FIRST — git/node still resolve via the rest
  // of the real PATH (the spy dir carries no git/node binary of its own).
  const env = { ...process.env, PATH: `${spyDir}:${process.env.PATH}` };
  return { spyDir, logPath, env, cleanup: () => rmSync(spyDir, { recursive: true, force: true }) };
}

test("killed-executor fixture: recovers off a fresh root via the git-remote store; the un-anchored in-flight issue never appears as skip/continue; a second recovery is idempotent; no gh process is ever invoked", () => {
  const { gitTmp, bareRemote, run_id } = killedExecutorFixture();
  const spy = ghSpySetup();
  try {
    // A GENUINELY fresh root: no .faff/runs, no .faff/anchors, no .faff/bundles — only a git
    // remote pointing at the same bare repo the executor published to before it died.
    const freshRoot = path.join(gitTmp, "fresh");
    mkdirSync(freshRoot, { recursive: true });
    spawnSync("git", ["-C", freshRoot, "init", "-q"]);
    spawnSync("git", ["-C", freshRoot, "remote", "add", "origin", bareRemote]);
    writeFileSync(path.join(freshRoot, ".faffrc.yaml"), "bundle_store: git-remote\n");

    const r = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--json"], { cwd: freshRoot, env: spy.env });
    assert.equal(r.code, 0, `bundle-recover must reconstruct cleanly (stderr: ${r.stderr})`);
    const body = JSON.parse(r.stdout);
    assert.equal(body.disposition, "reconstructed");
    assert.equal(body.bundle_verdict, "CLEAN");
    assert.equal(body.run_id, run_id);
    assert.ok(existsSync(path.join(freshRoot, ".faff", "runs", run_id, "run-ledger.json")));

    // The un-anchored, in-flight FAFF-2 must never read as skip or continue — only
    // redispatch (coarse rebuild) or park are safe outcomes for unprovable partial work.
    const plan = body.resume_preview;
    assert.ok(plan, "a reconstructed disposition always carries a resume_preview");
    assert.ok(!plan.skip.includes("FAFF-2"));
    assert.ok(!plan.continue_review.includes("FAFF-2"));
    assert.ok(!plan.continue_from_push.includes("FAFF-2"));
    assert.ok(plan.redispatch.includes("FAFF-2"), `FAFF-2 (un-anchored, in-flight) must redispatch, got plan=${JSON.stringify(plan)}`);

    // The shipped FAFF-1 (no merge-record.json carried by the bundle) must park, never skip.
    assert.ok(!plan.skip.includes("FAFF-1"));
    assert.ok(plan.park.some((p) => p.issue === "FAFF-1"), "FAFF-1 (shipped, unprovable merge) must park");

    // A second recovery against the SAME fresh root is idempotent.
    const r2 = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--json"], { cwd: freshRoot, env: spy.env });
    assert.equal(r2.code, 0);
    assert.equal(JSON.parse(r2.stdout).disposition, "noop-already-present");

    // The no-forge-call invariant: across BOTH recoveries, gh was never invoked. This is the
    // spawn-spy oracle (DoD: "a gh-less PATH, or a spawn spy that asserts no gh process is
    // started") — a real gh at the front of PATH would have logged every invocation.
    assert.ok(!existsSync(spy.logPath), "no gh process was ever started by bundle-recover");
  } finally {
    rmSync(gitTmp, { recursive: true, force: true });
    spy.cleanup();
  }
});

test("killed-executor fixture: local discoverLocalCandidates finds nothing for a git-remote-only publish (store isolation sanity check)", () => {
  // Belt-and-braces: a git-remote bundle is not visible to a LOCAL scan of the SAME root
  // (no .faff/bundles/ was ever written locally by a git-remote publish) — proves the two
  // occupants are genuinely isolated, not a shared fallback.
  const { gitTmp } = killedExecutorFixture();
  try {
    const found = discoverLocalCandidates(path.join(gitTmp, "work"), "FAFF-1");
    assert.equal(found.length, 0);
  } finally {
    rmSync(gitTmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// FAFF-845 (Option A) — landing-progress.json rides the anchor (events.js's optionalFloorFiles)
// and is copied back up into <run-dir>/<issue>/ by reconstructProjection, so the existing
// `faff landing-progress read` reader works unchanged after a Phase-0 recovery.
// ---------------------------------------------------------------------------
test("bundle-recover: landing-progress.json rides the anchor and is copied up into <run-dir>/<issue>/ after recovery; faff landing-progress read returns it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-landing-t-"));
  const freshRoot = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-landing-fresh-t-"));
  try {
    const run_id = "run-fixture-000000-landing";
    const runDir = path.join(root, ".faff", "runs", run_id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ run_id, admitted: ["FAFF-1"], outcomes: {}, owner: { epoch: 0, status: "running", last_heartbeat: "2020-01-01T00:00:00.000Z" } }));
    writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
    mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
    writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
    // A landing-progress checkpoint recorded during the original run's landing loop (FAFF-846).
    const landingRecord = {
      issue: "FAFF-1", fix_cycles: 1, last_head_sha: "abc123",
      history: [{ cycle: 1, kind: "conflict", failing_checks: [], tried: ["rebase"], at: "2026-01-01T00:00:00.000Z" }],
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(path.join(runDir, "FAFF-1", "landing-progress.json"), JSON.stringify(landingRecord));

    const anchorDest = path.join(root, ".faff", "anchors", run_id, "FAFF-1");
    const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
    assert.equal(mint.ok, true);
    assert.ok(existsSync(path.join(anchorDest, "landing-progress.json")), "the anchor carries landing-progress.json (events.js optionalFloorFiles)");

    const store = localBundleStore(root);
    const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root, store, boundarySeq: 0 });
    assert.equal(pub.ok, true);

    mkdirSync(path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    cpSync(path.join(root, ".faff", "bundles"), path.join(freshRoot, ".faff", "bundles"), { recursive: true });

    const r = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--json"], { cwd: freshRoot });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).disposition, "reconstructed");

    // Restored into the anchor dir...
    assert.ok(existsSync(path.join(freshRoot, ".faff", "anchors", run_id, "FAFF-1", "landing-progress.json")));
    // ...AND copied up into <run-dir>/<issue>/ (Option A, owned by FAFF-845).
    const landedPath = path.join(freshRoot, ".faff", "runs", run_id, "FAFF-1", "landing-progress.json");
    assert.ok(existsSync(landedPath));
    assert.deepEqual(JSON.parse(readFileSync(landedPath, "utf8")), landingRecord);

    // `faff landing-progress read <run-dir> <issue>` returns the record unchanged.
    const read = runCli(["landing-progress", "read", path.join(freshRoot, ".faff", "runs", run_id), "FAFF-1"], { cwd: freshRoot });
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), landingRecord);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(freshRoot, { recursive: true, force: true });
  }
});

test("bundle-recover: reconstructProjection stays additive when the bundle carries no landing-progress.json — no <run-dir>/<issue>/ directory is created", () => {
  const { root, run_id } = fixtureRoot(); // the shared fixture never writes a landing-progress.json
  const freshRoot = mkdtempSync(path.join(tmpdir(), "faff-bundle-recover-noland-fresh-t-"));
  try {
    mkdirSync(path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    cpSync(path.join(root, ".faff", "bundles"), path.join(freshRoot, ".faff", "bundles"), { recursive: true });

    const r = runCli(["bundle-recover", "--issue", "FAFF-1", "--root", freshRoot, "--json"], { cwd: freshRoot });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).disposition, "reconstructed");

    // The original three targets are present, exactly as before FAFF-845...
    assert.ok(existsSync(path.join(freshRoot, ".faff", "runs", run_id, "run-ledger.json")));
    assert.ok(existsSync(path.join(freshRoot, ".faff", "anchors", run_id, "FAFF-1", "events.jsonl")));
    assert.ok(existsSync(path.join(freshRoot, ".faff", "runs", run_id, "events.jsonl")));
    // ...and nothing extra: no <run-dir>/<issue>/ directory at all, since there was no
    // landing-progress.json in the anchor to copy up (the additive guard never fires).
    assert.ok(!existsSync(path.join(freshRoot, ".faff", "runs", run_id, "FAFF-1")), "no <run-dir>/<issue>/ directory is created when the bundle carries no landing-progress.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(freshRoot, { recursive: true, force: true });
  }
});
