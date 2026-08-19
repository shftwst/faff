// FAFF-819 — `faff bundle`: publish + fail-closed independent verify of a Phase-0 recovery
// bundle. Exercised end-to-end via the real CLI seam (publish -> verify against a fixture run
// dir + anchor, local occupant) plus the in-process --selftest tables (pure cores, local-store
// round trip, and a scratch-bare-repo git-remote round trip). Per ADR 0002 (assert at the
// CLI/module seam, never narrative text).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const {
  canonicalJSON, classifyBundle, deriveSupersededBy, validateIdentityForHandle, bundleExitCode,
  localBundleStore, publishBundle, buildBundle, requiredMembersFor, REQUIRED_MEMBERS_B1,
} = require("../plugin/skills/faff/bin/lib/bundle.js");
const { mintIssueAnchor } = require("../plugin/skills/faff/bin/lib/events.js");
const { sha256 } = require("../plugin/skills/faff/bin/lib/integrity-digest.js");
const { CONTRACTS } = require("../plugin/skills/faff/bin/lib/contract-defs.js");
const { HERE } = require("../plugin/skills/faff/bin/lib/shared-infra.js");

// --- --selftest tables (no network beyond a local scratch bare repo) ---
test("bundle --selftest: pure cores + local-store round trip + scratch-bare-repo git-remote round trip pass", () => {
  const { code, stdout } = runCli(["bundle", "--selftest"]);
  assert.equal(code, 0, stdout);
});

test("contract bundle-verdict --selftest: the fixture table passes", () => {
  const { code } = runCli(["contract", "bundle-verdict", "--selftest"]);
  assert.equal(code, 0);
});

// --- CLI arg validation (fail-loud before any store call) ---
test("bundle publish: missing required flags -> exit 2", () => {
  const { code, stderr } = runCli(["bundle", "publish"]);
  assert.equal(code, 2);
  assert.match(stderr, /--run-dir, --boundary-kind, and --boundary-key are all required/);
});

test("bundle verify: missing required flags -> exit 2", () => {
  const { code, stderr } = runCli(["bundle", "verify"]);
  assert.equal(code, 2);
  assert.match(stderr, /--run-id, --run-segment-id, --boundary-kind, and --boundary-key are all required/);
});

test("bundle: an unknown action -> exit 2", () => {
  const { code, stderr } = runCli(["bundle", "recover"]);
  assert.equal(code, 2);
  assert.match(stderr, /expected one of publish \| verify/);
});

// --- pure cores, exercised directly (the CONSTRAINT-level assertions --selftest already covers
// in-process; repeated here at the module seam per ADR 0002) ---
test("canonicalJSON: sorted keys at every depth, no insignificant whitespace", () => {
  assert.equal(canonicalJSON({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');
});

test("deriveSupersededBy: a later per-issue boundary supersedes an earlier one in the same segment", () => {
  const id = { run_id: "r", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const later = deriveSupersededBy(id, [
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 },
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-2", boundary_seq: 1 },
  ]);
  assert.equal(later.boundary_key, "FAFF-2");
});

test("validateIdentityForHandle: a run_id with a '..' segment is refused before any handle interpolation", () => {
  const violations = validateIdentityForHandle({ run_id: "../etc", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 });
  assert.ok(violations.length > 0);
});

test("classifyBundle: exit-code mapping — CLEAN=0, the four determinate non-clean=1, VERIFICATION_UNAVAILABLE=2", () => {
  assert.equal(bundleExitCode("CLEAN"), 0);
  for (const v of ["STALE", "MISSING", "MALFORMED", "TAMPERED"]) assert.equal(bundleExitCode(v), 1);
  assert.equal(bundleExitCode("VERIFICATION_UNAVAILABLE"), 2);
});

// --- end-to-end CLI round trip: publish then verify against a real fixture run dir + anchor ---
function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-cli-t-"));
  const run_id = "run-fixture-000000-bundle";
  const runDir = path.join(root, ".faff", "runs", run_id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } }));
  writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
  const anchorDest = path.join(root, ".faff", "anchors", run_id, "FAFF-1");
  const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
  assert.equal(mint.ok, true, "fixture: anchor mint must succeed");
  return { root, run_id, runDir };
}

// --- FAFF-845: contract_fingerprint + the b1/b2 version gate -------------------------------
// A fixture root whose ledger carries caller-supplied posture fields (dial_profile/floor/
// corrective_authority/prd_creative_licence), with a minted FAFF-1 anchor — buildBundle refuses
// to run before an anchor exists, so every buildBundle-level test needs one.
function fixtureRootWithLedger(ledgerOverrides) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-fp-t-"));
  const run_id = "run-fixture-000000-fp";
  const runDir = path.join(root, ".faff", "runs", run_id);
  mkdirSync(runDir, { recursive: true });
  const ledger = { admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" }, ...ledgerOverrides };
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
  const anchorDest = path.join(root, ".faff", "anchors", run_id, "FAFF-1");
  const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
  assert.equal(mint.ok, true, "fixture: anchor mint must succeed");
  return { root, run_id, runDir };
}

// FAFF-876 — a run-anchor tree shaped exactly like `anchor-run`'s own output: `summary.md` plus
// one subdir per admitted issue, directly under `.faff/anchors/<run_id>/` (no `run-close/`
// wrapper — that's the bug this fix removes). Two admitted issues, so the round-trip test can
// assert the WHOLE run-anchor tree rides into the `anchors` member, not just one issue's slice.
function fixtureRunCloseRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-runclose-t-"));
  const run_id = "run-fixture-000000-runclose";
  const runDir = path.join(root, ".faff", "runs", run_id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped", "FAFF-2": "shipped" }, owner: { epoch: 0, status: "done" } }));
  writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  const anchorRoot = path.join(root, ".faff", "anchors", run_id);
  for (const issue of ["FAFF-1", "FAFF-2"]) {
    mkdirSync(path.join(runDir, issue), { recursive: true });
    const mint = mintIssueAnchor(runDir, issue, path.join(anchorRoot, issue));
    assert.equal(mint.ok, true, `fixture: anchor mint must succeed for ${issue}`);
  }
  // mirrors anchor-run's own best-effort summary.md copy (events.js cmdEvents "anchor-run")
  mkdirSync(anchorRoot, { recursive: true });
  writeFileSync(path.join(anchorRoot, "summary.md"), "# run summary\n");
  return { root, run_id, runDir, anchorRoot };
}

// Remints the outer manifest tail (memberRefs + bundle_manifest_digest) over a caller-supplied
// memberBytes map, exactly like buildBundle's own tail — used to construct a self-consistent
// synthetic bundle (b1, or a deliberately doctored b2) for classifyBundle's pure-core tests.
function remintManifest(memberBytes, identity, version) {
  const members = {};
  for (const [name, bytes] of Object.entries(memberBytes)) members[name] = { sha256: sha256(bytes), bytes_len: bytes.length };
  const bundle_manifest_digest = sha256(Buffer.from(canonicalJSON(members), "utf8"));
  return { version, identity, members, bundle_manifest_digest };
}

// Builds the `read` shape classifyBundle expects, straight from a memberBytes map + its remint
// manifest — no store, no I/O. Mirrors what verifyBundleIdentity assembles from a real store read.
function readFromBuilt(memberBytes, manifest) {
  const members = {};
  for (const [name, bytes] of Object.entries(memberBytes)) members[name] = { status: "ok", bytes };
  return {
    identity: manifest.identity, headStatus: "ok", headDigest: manifest.bundle_manifest_digest,
    manifestMemberRefs: manifest.members, version: manifest.version, members, laterBoundaries: [],
  };
}

test("contract_fingerprint: shape matches the record and digest === sha256(canonicalJSON(inputs))", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    assert.equal(fp.inputs.version, "cf1");
    assert.ok("posture" in fp.inputs);
    assert.ok("contract_schema_versions" in fp.inputs);
    assert.equal(fp.digest, sha256(Buffer.from(canonicalJSON(fp.inputs), "utf8")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("contract_fingerprint: the digest changes when a single posture field flips", () => {
  const base = {
    dial_profile: { appetite: "full", convergence: "forced", slots: { review: "noon" }, gates: "default" },
    floor: { no_execute: true, worktree_isolation: true, autonomous_contract: true },
    corrective_authority: "available", prd_creative_licence: "broad",
  };
  const f1 = fixtureRootWithLedger(base);
  const f2 = fixtureRootWithLedger({ ...base, corrective_authority: "channel-D-only" });
  try {
    const id1 = { run_id: f1.run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const id2 = { run_id: f2.run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const fp1 = JSON.parse(buildBundle(f1.runDir, id1, f1.root).memberBytes.contract_fingerprint.toString("utf8"));
    const fp2 = JSON.parse(buildBundle(f2.runDir, id2, f2.root).memberBytes.contract_fingerprint.toString("utf8"));
    assert.notEqual(fp1.digest, fp2.digest);
  } finally {
    rmSync(f1.root, { recursive: true, force: true });
    rmSync(f2.root, { recursive: true, force: true });
  }
});

test("contract_fingerprint: byte-identical across a re-publish of the same already-minted anchor (determinism)", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({
    dial_profile: { appetite: "full" }, floor: { no_execute: true }, corrective_authority: "available", prd_creative_licence: "tight",
  });
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built1 = buildBundle(runDir, identity, root);
    const built2 = buildBundle(runDir, identity, root);
    assert.ok(built1.memberBytes.contract_fingerprint.equals(built2.memberBytes.contract_fingerprint), "contract_fingerprint bytes are byte-identical across two builds of the same anchor");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("contract_fingerprint: inputs.posture equals the posture read off the bundle's own ledger_snapshot member (never a second run-ledger.json read)", () => {
  const posture = { dial_profile: { a: 1 }, floor: { b: 2 }, corrective_authority: "available", prd_creative_licence: "tight" };
  const { root, run_id, runDir } = fixtureRootWithLedger(posture);
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    const ledgerObj = JSON.parse(built.memberBytes.ledger_snapshot.toString("utf8"));
    const wantPosture = {
      dial_profile: ledgerObj.dial_profile ?? null, floor: ledgerObj.floor ?? null,
      corrective_authority: ledgerObj.corrective_authority ?? null, prd_creative_licence: ledgerObj.prd_creative_licence ?? null,
    };
    assert.equal(canonicalJSON(fp.inputs.posture), canonicalJSON(wantPosture));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("contract_fingerprint: a ledger missing every posture field folds each to null and never throws", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({}); // no dial_profile/floor/corrective_authority/prd_creative_licence
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    let built;
    assert.doesNotThrow(() => { built = buildBundle(runDir, identity, root); });
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    assert.deepEqual(fp.inputs.posture, { dial_profile: null, floor: null, corrective_authority: null, prd_creative_licence: null });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("contract_schema_versions: one entry per CONTRACTS name in sorted order; a missing schema file stores null, never throws", () => {
  const names = Object.keys(CONTRACTS).sort();
  const missingName = names[0];
  const missingPath = path.resolve(HERE, "..", "contracts", `${missingName}.schema.json`);
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  const fsMod = require("node:fs");
  const original = fsMod.readFileSync;
  // Simulate ONE missing/unreadable schema file without touching real files on disk — patches
  // the shared "node:fs" module object bundle.js's own `const fs = require("node:fs")` resolves
  // to, intercepting only the one targeted schema path and delegating everything else verbatim.
  fsMod.readFileSync = function (p, ...args) {
    if (p === missingPath) { const e = new Error("ENOENT (simulated missing schema)"); e.code = "ENOENT"; throw e; }
    return original.call(fsMod, p, ...args);
  };
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    const gotNames = Object.keys(fp.inputs.contract_schema_versions);
    assert.deepEqual(gotNames, names, "one entry per CONTRACTS name, sorted");
    assert.equal(fp.inputs.contract_schema_versions[missingName], null, "the missing schema file stores null, not a throw");
    for (const n of names) {
      if (n === missingName) continue;
      assert.match(fp.inputs.contract_schema_versions[n], /^[0-9a-f]{64}$/, `${n} is a sha256 hex digest`);
    }
  } finally {
    fsMod.readFileSync = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifyBundle: a b1 bundle (6 members, no contract_fingerprint) still verifies CLEAN under the b2-aware ladder", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const b1MemberBytes = {};
    for (const name of REQUIRED_MEMBERS_B1) b1MemberBytes[name] = built.memberBytes[name];
    const b1Manifest = remintManifest(b1MemberBytes, built.manifest.identity, "b1");
    const store = localBundleStore(root);
    const put = store.put(b1Manifest.identity, b1MemberBytes, b1Manifest);
    assert.equal(put.ok, true);
    const { verifyBundleIdentity } = require("../plugin/skills/faff/bin/lib/bundle.js");
    const verdict = verifyBundleIdentity(b1Manifest.identity, { root, store });
    assert.equal(verdict.verdict, "CLEAN", `a b1 bundle must still verify CLEAN (got ${verdict.verdict}/${verdict.cause})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-865: classifyBundle's verify-path anchor-file materialisation guards every
// anchors.files key against path escape (".."-segment or absolute) BEFORE any file is
// written, mirroring bundle-recover.js's reconstructProjection containment posture. ---

// Doctors a freshly-built bundle's anchors member by adding one extra `files` key, then
// remints the manifest tail over the mutated memberBytes so digests stay self-consistent —
// the "only the path is hostile" fixture the ticket's smoke test describes.
function bundleWithExtraAnchorKey(runDir, root, identity, extraKey) {
  const built = buildBundle(runDir, identity, root);
  const anchorsObj = JSON.parse(built.memberBytes.anchors.toString("utf8"));
  anchorsObj.files[extraKey] = Buffer.from("x").toString("base64");
  const memberBytes = { ...built.memberBytes, anchors: Buffer.from(JSON.stringify(anchorsObj), "utf8") };
  const manifest = remintManifest(memberBytes, built.manifest.identity, built.manifest.version);
  return readFromBuilt(memberBytes, manifest);
}

test("classifyBundle: an anchors.files key that escapes via '..' -> MALFORMED, cause anchors-unsafe-path, no file written outside the intended temp dir", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  const fsMod = require("node:fs");
  const originalMkdtempSync = fsMod.mkdtempSync;
  let tempDirCreated = false;
  // The guard must reject before withTempDir ever runs — assert no scratch dir is even
  // created, the strongest form of "nothing was written outside the intended dir".
  fsMod.mkdtempSync = function (...args) { tempDirCreated = true; return originalMkdtempSync.apply(fsMod, args); };
  // Behaviour-level backstop, independent of the mkdtempSync interception above (which only
  // proves the guard fired IF bundle.js's fs binding is the one patched): list the OS tmp root
  // before and after for any "faff-bundle-verify-*" entry (withTempDir's own dir prefix,
  // bundle.js:247) — a real scratch dir surviving cleanup would show up here even if the spy
  // silently stopped intercepting.
  const tmpRoot = tmpdir();
  const before = new Set(fsMod.readdirSync(tmpRoot));
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const read = bundleWithExtraAnchorKey(runDir, root, identity, "../escape");
    const verdict = classifyBundle(read);
    assert.equal(verdict.verdict, "MALFORMED");
    assert.equal(verdict.cause, "anchors-unsafe-path");
    assert.equal(tempDirCreated, false, "the materialisation temp dir must never be created once an unsafe key is found");
    const after = fsMod.readdirSync(tmpRoot).filter((name) => name.startsWith("faff-bundle-verify-") && !before.has(name));
    assert.deepEqual(after, [], "no faff-bundle-verify-* scratch dir may exist on disk after an unsafe key is rejected");
  } finally {
    fsMod.mkdtempSync = originalMkdtempSync;
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifyBundle: an anchors.files absolute key -> MALFORMED, cause anchors-unsafe-path, no file written at the absolute path", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  const absTarget = path.join(tmpdir(), "faff-865-pwned-" + process.pid);
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const read = bundleWithExtraAnchorKey(runDir, root, identity, absTarget);
    const verdict = classifyBundle(read);
    assert.equal(verdict.verdict, "MALFORMED");
    assert.equal(verdict.cause, "anchors-unsafe-path");
    assert.equal(require("node:fs").existsSync(absTarget), false, "nothing may be written at the absolute path");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("classifyBundle: a well-formed bundle with only flat known anchor filenames stays CLEAN — no regression", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const read = readFromBuilt(built.memberBytes, built.manifest);
    const verdict = classifyBundle(read);
    assert.equal(verdict.verdict, "CLEAN", `an untampered fixture bundle must still verify CLEAN (got ${verdict.verdict}/${verdict.cause})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle publish + verify (b2, real CLI): a bundle missing contract_fingerprint -> MISSING naming it, exit 1", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, pub.stderr);
    const manifestPath = path.join(root, ".faff", "bundles", run_id, "seg-0", "FAFF-1", "manifest.json");
    const onDiskManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(onDiskManifest.version, "b2", "a new publish stamps b2");
    const memberPath = path.join(root, ".faff", "bundles", run_id, "seg-0", "FAFF-1", "contract_fingerprint.bin");
    rmSync(memberPath);
    const ver = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 1);
    const body = JSON.parse(ver.stdout);
    assert.equal(body.verdict, "MISSING");
    assert.equal(body.cause, "contract_fingerprint");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("classifyBundle: a contract_fingerprint whose digest disagrees with sha256(canonicalJSON(inputs)) -> TAMPERED naming it", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({ corrective_authority: "available" });
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    fp.digest = "0".repeat(64); // self-inconsistent: no longer sha256(canonicalJSON(fp.inputs))
    const doctoredBytes = Buffer.from(canonicalJSON(fp), "utf8");
    const memberBytes = { ...built.memberBytes, contract_fingerprint: doctoredBytes };
    // Remint the OUTER manifest fresh over the doctored bytes, so the outer digest/per-member sha256
    // checks all pass — isolating the additive INNER self-consistency check as the only thing that fires.
    const manifest = remintManifest(memberBytes, built.manifest.identity, "b2");
    const verdict = classifyBundle(readFromBuilt(memberBytes, manifest));
    assert.equal(verdict.verdict, "TAMPERED");
    assert.equal(verdict.cause, "contract_fingerprint");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("classifyBundle: a contract_fingerprint whose posture disagrees with the bundle's own ledger_snapshot -> TAMPERED naming it", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({ corrective_authority: "available" });
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    // Self-consistent lie: the doctored posture disagrees with ledger_snapshot, but fp.digest is
    // recomputed to match the doctored inputs, so the self-digest check alone cannot catch this —
    // only the cross-check against the independently-verified ledger_snapshot member can.
    fp.inputs.posture = { ...fp.inputs.posture, corrective_authority: "channel-D-only" };
    fp.digest = sha256(Buffer.from(canonicalJSON(fp.inputs), "utf8"));
    const doctoredBytes = Buffer.from(canonicalJSON(fp), "utf8");
    const memberBytes = { ...built.memberBytes, contract_fingerprint: doctoredBytes };
    const manifest = remintManifest(memberBytes, built.manifest.identity, "b2");
    const verdict = classifyBundle(readFromBuilt(memberBytes, manifest));
    assert.equal(verdict.verdict, "TAMPERED");
    assert.equal(verdict.cause, "contract_fingerprint");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("classifyBundle: a CLEAN b2 bundle stays CLEAN even when contract_schema_versions differs from the verifying box's local contracts/ files (never re-derived)", () => {
  const { root, run_id, runDir } = fixtureRootWithLedger({});
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const fp = JSON.parse(built.memberBytes.contract_fingerprint.toString("utf8"));
    fp.inputs.contract_schema_versions = { ...fp.inputs.contract_schema_versions, "totally-fake-contract-name": "0".repeat(64) };
    fp.digest = sha256(Buffer.from(canonicalJSON(fp.inputs), "utf8"));
    const doctoredBytes = Buffer.from(canonicalJSON(fp), "utf8");
    const memberBytes = { ...built.memberBytes, contract_fingerprint: doctoredBytes };
    const manifest = remintManifest(memberBytes, built.manifest.identity, "b2");
    const verdict = classifyBundle(readFromBuilt(memberBytes, manifest));
    assert.equal(verdict.verdict, "CLEAN", `a divergent-but-self-consistent schema map must never be re-derived locally (got ${verdict.verdict}/${verdict.cause})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("requiredMembersFor: b1 -> the shipped 6, b2 -> those 6 plus contract_fingerprint, absent/unknown -> the b1 set", () => {
  assert.deepEqual(requiredMembersFor("b1"), REQUIRED_MEMBERS_B1);
  assert.deepEqual(requiredMembersFor("b2"), [...REQUIRED_MEMBERS_B1, "contract_fingerprint"]);
  assert.deepEqual(requiredMembersFor(undefined), REQUIRED_MEMBERS_B1);
  assert.deepEqual(requiredMembersFor("bogus"), REQUIRED_MEMBERS_B1);
});

test("bundle publish (local occupant, default) then bundle verify -> CLEAN, exit 0", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, pub.stderr);
    const pubBody = JSON.parse(pub.stdout);
    assert.equal(pubBody.published, true);
    assert.equal(pubBody.identity.run_id, run_id);
    assert.equal(pubBody.identity.run_segment_id, 0, "run_segment_id is derived from the ledger's owner.epoch");

    const ver = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 0, ver.stderr);
    const verBody = JSON.parse(ver.stdout);
    assert.equal(verBody.verdict, "CLEAN");
    assert.equal(verBody.conformant, true);
    assert.equal(verBody.superseded_by, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle publish: a re-publish at the same identity is an idempotent no-op (never a rewrite)", () => {
  const { root, runDir } = fixtureRoot();
  try {
    const pub1 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub1.code, 0, pub1.stderr);
    const pub2 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub2.code, 0, pub2.stderr);
    assert.equal(JSON.parse(pub2.stdout).idempotent, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle verify: an identity with no published bundle -> MISSING, exit 1", () => {
  const { root } = fixtureRoot();
  try {
    const ver = runCli(["bundle", "verify", "--run-id", "run-nonexistent", "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-9", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 1);
    assert.equal(JSON.parse(ver.stdout).verdict, "MISSING");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle verify: a bundle whose manifest.json is corrupted on disk -> MALFORMED, exit 1", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, pub.stderr);
    const manifestPath = path.join(root, ".faff", "bundles", run_id, "seg-0", "FAFF-1", "manifest.json");
    writeFileSync(manifestPath, "{not valid json");
    const ver = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 1);
    assert.equal(JSON.parse(ver.stdout).verdict, "MALFORMED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle publish: boundary_seq auto-increments across issues in the same run/segment via the real CLI (no --boundary-seq flag exists), and staleness fires correctly", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub1 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub1.code, 0, pub1.stderr);
    assert.equal(JSON.parse(pub1.stdout).identity.boundary_seq, 0, "the first bundle in a fresh segment gets boundary_seq 0");

    // A second issue, same run/segment: mint its own anchor, then publish.
    mkdirSync(path.join(runDir, "FAFF-2"), { recursive: true });
    const anchorDest2 = path.join(root, ".faff", "anchors", run_id, "FAFF-2");
    mintIssueAnchor(runDir, "FAFF-2", anchorDest2);
    const pub2 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-2", "--root", root, "--json"], { cwd: root });
    assert.equal(pub2.code, 0, pub2.stderr);
    assert.equal(JSON.parse(pub2.stdout).identity.boundary_seq, 1, "the second bundle in the same segment auto-increments to boundary_seq 1 (the bug this regression-tests: it must NOT default to 0 again)");

    // The earlier (FAFF-1) boundary must now read STALE, superseded by FAFF-2.
    const ver1 = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver1.code, 1);
    const ver1Body = JSON.parse(ver1.stdout);
    assert.equal(ver1Body.verdict, "STALE");
    assert.equal(ver1Body.superseded_by.boundary_key, "FAFF-2");

    // FAFF-2 itself is the latest boundary and stays CLEAN.
    const ver2 = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-2", "--root", root, "--json"], { cwd: root });
    assert.equal(ver2.code, 0, ver2.stderr);
    assert.equal(JSON.parse(ver2.stdout).verdict, "CLEAN");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validateIdentityForHandle: a leading '-' in run_id or boundary_key is refused (git-argv defence in depth)", () => {
  const base = { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  assert.ok(validateIdentityForHandle({ ...base, run_id: "-run-1" }).length > 0);
  assert.ok(validateIdentityForHandle({ ...base, boundary_key: "--boundary" }).length > 0);
  assert.equal(validateIdentityForHandle(base).length, 0, "an ordinary token is unaffected");
});

test("localBundleStore.put: a losing racer on the same identity never throws or silently overwrites — it resolves via the same idempotent/conflict rule as a sequential re-publish", () => {
  const { root, runDir } = fixtureRoot();
  try {
    const store = localBundleStore(root);
    // Publish once for real, to get a genuine manifest+digest.
    const first = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root, store });
    assert.equal(first.ok, true);

    // Simulate the losing side of a put/put race directly at the store seam: the target dir
    // already exists (as `first` just created it above) by the time this call's own would-be
    // rename would run. `put`'s pre-check (fs.existsSync) already routes this through the same
    // `localExistingBundleResult` classification the post-rename-failure recovery path also
    // uses — so this exercises the identical decision a genuine racer resolves through.
    const raceMatching = store.put(first.identity, {}, { bundle_manifest_digest: first.manifest.bundle_manifest_digest });
    assert.equal(raceMatching.ok, true);
    assert.equal(raceMatching.idempotent, true, "a matching-digest racer resolves idempotent, never throws");

    const raceConflict = store.put(first.identity, {}, { bundle_manifest_digest: "0".repeat(64) });
    assert.equal(raceConflict.ok, false);
    assert.equal(raceConflict.reason, "identity-conflict", "a mismatched-digest racer resolves identity-conflict, never throws or overwrites");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle publish (git-remote occupant configured against an unreachable remote): store_unavailable via the real CLI, exit 0, run continues", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-gitcli-t-"));
  try {
    const run_id = "run-fixture-gitcli-000000";
    const runDir = path.join(root, ".faff", "runs", run_id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: {}, owner: { epoch: 0, status: "running" } }));
    writeFileSync(path.join(runDir, "events.jsonl"), "");
    mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
    const anchorDest = path.join(root, ".faff", "anchors", run_id, "FAFF-1");
    mintIssueAnchor(runDir, "FAFF-1", anchorDest);

    // A real git repo whose only remote is unreachable — the CLI resolves the top-level
    // bundle_store key via `.faffrc.yaml`, so write one selecting git-remote, and init git with a bogus origin.
    writeFileSync(path.join(root, ".faffrc.yaml"), "bundle_store: git-remote\n");
    const { spawnSync } = require("node:child_process");
    spawnSync("git", ["-C", root, "init", "-q"]);
    spawnSync("git", ["-C", root, "remote", "add", "origin", path.join(root, "nonexistent-remote.git")]);

    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, `store_unavailable must never fail the run (got exit ${pub.code}, stderr: ${pub.stderr})`);
    const body = JSON.parse(pub.stdout);
    assert.equal(body.published, false);
    assert.equal(body.reason, "store_unavailable");

    const events = require("node:fs").readFileSync(path.join(runDir, "events.jsonl"), "utf8");
    assert.match(events, /"bundle-store-unavailable"/, "the store_unavailable run event was recorded");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("classifyBundle: a required member reported missing by the store -> MISSING, naming the member", () => {
  const identity = { run_id: "r", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const result = classifyBundle({ identity, headStatus: "ok", headDigest: "x", members: { ledger_snapshot: { status: "missing" } } });
  assert.equal(result.verdict, "MISSING");
  assert.equal(result.cause, "ledger_snapshot");
});

// --- FAFF-876: run-close reads the run-anchor ROOT directly (readAnchorDir gains boundary_kind) ---
// Regression coverage for the bug: `anchor-run` mints `.faff/anchors/<rid>/` (summary.md + one
// subdir per admitted issue); `bundle publish --boundary-kind run-close` used to look for a
// `<rid>/run-close/` subdirectory that is never created, so it always found an empty anchor and
// threw "no anchor found". readAnchorDir now special-cases boundary_kind === "run-close" to
// resolve the run-anchor root itself — no anchor-run change, no wrapper directory (Option B).

test("bundle publish (real CLI): boundary_kind run-close succeeds against the anchor anchor-run actually writes — the bug this regression-tests (FAFF-876)", () => {
  // The spec's §2 OUT OF SCOPE excludes "the bundle-verify / classify path" on the premise that
  // verify is unaffected by where readAnchorDir looks — that premise turned out to be wrong:
  // classifyBundle's tamper check (and bundle-recover.js's reconstructProjection) both assumed a
  // flat root-level events.jsonl under the anchor dir, true for issue-merge-floor's <rid>/<issue>/
  // but not for the run-anchor root's per-issue subdirs. Left alone this would have TAMPERED every
  // run-close verify AND broken an EXISTING bundle-recover.test.mjs case (--run-id reaching a
  // run-close boundary) — a genuine regression, not new scope, so both call sites were repaired
  // to locate the first per-issue events.jsonl copy instead of assuming a flat one. Covered here
  // end to end: publish, then verify CLEAN.
  const { root, run_id, runDir } = fixtureRunCloseRoot();
  try {
    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "run-close", "--boundary-key", "run-close", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, pub.stderr);
    const pubBody = JSON.parse(pub.stdout);
    assert.equal(pubBody.published, true);
    assert.equal(pubBody.identity.run_id, run_id);
    assert.equal(pubBody.identity.boundary_kind, "run-close");
    assert.equal(pubBody.identity.boundary_key, "run-close");

    const ver = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "run-close", "--boundary-key", "run-close", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 0, ver.stderr);
    const verBody = JSON.parse(ver.stdout);
    assert.equal(verBody.verdict, "CLEAN");
    assert.equal(verBody.conformant, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildBundle: boundary_kind run-close resolves the run-anchor ROOT directly — anchors.files includes summary.md + every admitted issue's anchor files, no run-close/ wrapper (FAFF-876)", () => {
  const { root, run_id, runDir } = fixtureRunCloseRoot();
  try {
    const identity = { run_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 };
    let built;
    assert.doesNotThrow(() => { built = buildBundle(runDir, identity, root); });
    const anchors = JSON.parse(built.memberBytes.anchors.toString("utf8"));
    assert.ok("summary.md" in anchors.files, "the run-level summary.md rides into the anchors member");
    assert.ok("FAFF-1/events.jsonl" in anchors.files, "FAFF-1's anchor files are included");
    assert.ok("FAFF-1/chain-head.json" in anchors.files);
    assert.ok("FAFF-2/events.jsonl" in anchors.files, "FAFF-2's anchor files are included — the WHOLE run-anchor tree, not one issue's slice");
    assert.equal(anchors.dir.split(path.sep).join("/"), `.faff/anchors/${run_id}`, "resolves the run-anchor root directly — no run-close/ wrapper subdirectory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildBundle: boundary_kind run-close with no run-level chain-head.json falls back to the anchor dir's own mtime for last_safe_boundary.ts — the accepted fallback, never a throw (FAFF-876)", () => {
  const { root, run_id, runDir, anchorRoot } = fixtureRunCloseRoot();
  try {
    assert.equal(require("node:fs").existsSync(path.join(anchorRoot, "chain-head.json")), false, "fixture sanity: no run-level chain-head.json exists (those are per-issue only)");
    const identity = { run_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 };
    let built;
    assert.doesNotThrow(() => { built = buildBundle(runDir, identity, root); });
    const lastSafeBoundary = JSON.parse(built.memberBytes.last_safe_boundary.toString("utf8"));
    assert.ok(lastSafeBoundary.ts, "ts is populated from the anchor dir's own mtime fallback, not a swallowed throw");
    assert.equal(lastSafeBoundary.boundary_kind, "run-close");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildBundle: boundary_kind run-close before anchor-run has minted anything still throws the existing 'no anchor found' error (FAFF-876 — the real pre-mint case stays fail-loud)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-runclose-premint-t-"));
  try {
    const run_id = "run-fixture-000000-premint";
    const runDir = path.join(root, ".faff", "runs", run_id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: {}, owner: { epoch: 0, status: "running" } }));
    writeFileSync(path.join(runDir, "events.jsonl"), "");
    // No .faff/anchors/<run_id>/ tree at all — anchor-run never ran.
    const identity = { run_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 };
    assert.throws(() => buildBundle(runDir, identity, root), /no anchor found/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildBundle: issue-merge-floor resolution is byte-identical to before this fix — regression guard (FAFF-876)", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const identity = { run_id, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
    const built = buildBundle(runDir, identity, root);
    const anchors = JSON.parse(built.memberBytes.anchors.toString("utf8"));
    assert.equal(anchors.dir.split(path.sep).join("/"), `.faff/anchors/${run_id}/FAFF-1`, "issue-merge-floor still resolves <rid>/<issue>/, unchanged by the run-close branch");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildBundle (run-close): a symlink planted under the run-anchor root makes readAnchorDir throw loud, naming the entry — never silently skipped, never in the anchors files map (FAFF-876)", () => {
  const { root, run_id, runDir, anchorRoot } = fixtureRunCloseRoot();
  try {
    const outsideTarget = path.join(root, "outside-secret.txt");
    writeFileSync(outsideTarget, "top secret\n");
    symlinkSync(outsideTarget, path.join(anchorRoot, "evil-link"));
    const identity = { run_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 };
    assert.throws(() => buildBundle(runDir, identity, root), /unsafe anchor entry: evil-link/, "readAnchorDir throws, naming the symlink entry");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildBundle (run-close): a '..'-traversal-crafted rel-path entry under the run-anchor root makes readAnchorDir throw loud, naming the entry — a SEPARATE negative case from the symlink one (FAFF-876)", (t) => {
  // A real filesystem never returns a dirent literally named ".." from readdirSync (the OS
  // reserves it as the parent-directory reference — mkdir(".. ") is impossible), so this
  // exercises the isSafeAnchorRelPath guard the same way the untrusted verify-side path already
  // does: inject the unsafe name at the exact seam readAnchorDir's walk() consumes. `fs` is the
  // same "node:fs" singleton bundle.js itself requires, so mocking it here reaches the walk.
  const { root, run_id, runDir, anchorRoot } = fixtureRunCloseRoot();
  const fs = require("node:fs");
  try {
    const realReaddirSync = fs.readdirSync;
    t.mock.method(fs, "readdirSync", (d, ...rest) => {
      const names = realReaddirSync.call(fs, d, ...rest);
      if (path.resolve(String(d)) === path.resolve(anchorRoot)) return [...names, ".."];
      return names;
    });
    const identity = { run_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 };
    assert.throws(() => buildBundle(runDir, identity, root), /unsafe anchor entry: \.\./, "readAnchorDir throws, naming the unsafe '..' entry");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
