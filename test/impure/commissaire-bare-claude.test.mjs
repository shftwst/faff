// FAFF-360 — the CI-provable harness for the bare Claude Code Commissaire consumer.
//
// Real git / real filesystem / real subprocess: scaffolds a fresh no-remote SUT with no
// SuperDomestique skills installed, provisions a driver checkout at the pinned revision, and drives
// the shipped commissaire + faff binaries through the whole governed workflow. Runs on both the
// Linux `validate` lane and the macOS `validate-macos` lane by location alone (test/impure/*), no
// workflow edit. Every governance classification is asserted from the CLI's own output; the harness
// re-implements no ledger, signature, HMAC, reconciliation, sealing, or runcheck logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..");
const SCAFFOLDER = path.join(REPO_ROOT, "verification", "external-verification", "scaffold-commissaire-bare-claude.sh");
const SRC_DIR = path.join(REPO_ROOT, "verification", "external-verification", "commissaire-bare-claude");
const EXPECTED = "fd1e9788a44860ee8804bdb775e33fb5dfd3f057";
const DRIFT = "3910417c4086e76c0e68e29cee84fa5f9c3ea71d"; // fd1e9788^ — a different, CLI-complete, present SHA

const cleanups = [];
process.on("exit", () => {
  for (const c of cleanups.reverse()) {
    try {
      c();
    } catch {
      /* best-effort */
    }
  }
});

function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}
function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Provision a driver checkout at `sha`. In a shallow CI clone the commit is absent, so fetch it by
// SHA first (GitHub advertises reachable SHAs). A throwaway worktree gives a clean checkout at that
// exact revision with the full CLI + lib tree.
const driverCache = new Map();
function provisionDriver(sha) {
  if (driverCache.has(sha)) return driverCache.get(sha);
  const have = git(REPO_ROOT, "cat-file", "-e", `${sha}^{commit}`);
  if (have.status !== 0) {
    const fetched = git(REPO_ROOT, "fetch", "--depth", "1", "origin", sha);
    if (fetched.status !== 0) {
      const fetched2 = git(REPO_ROOT, "fetch", "origin", sha);
      if (fetched2.status !== 0) throw new Error(`cannot materialise driver revision ${sha}: ${fetched.stderr}${fetched2.stderr}`);
    }
  }
  // The harness preflight requires the FAFF-828 facade commit to be an ancestor of the driver
  // revision (a lineage sanity check). A shallow CI checkout lacks that deep history, so the driver
  // worktree it shares objects with cannot resolve the ancestor and preflight dies. Unshallow once
  // when the ancestor object is absent, giving the worktree the full lineage the check verifies;
  // git refuses --unshallow on a complete repo, so gate it on the repo actually being shallow.
  const FAFF828 = "881f4a2555aa919947ec7e52a15b093478ed8110";
  if (git(REPO_ROOT, "cat-file", "-e", `${FAFF828}^{commit}`).status !== 0) {
    const shallow = (git(REPO_ROOT, "rev-parse", "--is-shallow-repository").stdout || "").trim() === "true";
    if (shallow) git(REPO_ROOT, "fetch", "--unshallow", "origin");
    if (git(REPO_ROOT, "cat-file", "-e", `${FAFF828}^{commit}`).status !== 0) git(REPO_ROOT, "fetch", "origin", FAFF828);
  }
  const dir = mkdtemp("cbc-driver-");
  fs.rmSync(dir, { recursive: true, force: true });
  const add = git(REPO_ROOT, "worktree", "add", "--detach", dir, sha);
  if (add.status !== 0) throw new Error(`git worktree add ${sha} failed: ${add.stderr}`);
  cleanups.push(() => {
    git(REPO_ROOT, "worktree", "remove", "--force", dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  driverCache.set(sha, dir);
  return dir;
}

function scaffold(commissaireRoot) {
  const sut = mkdtemp("cbc-sut-");
  fs.rmSync(sut, { recursive: true, force: true });
  const r = spawnSync("bash", [SCAFFOLDER], {
    encoding: "utf8",
    env: { ...process.env, SUT_ROOT: sut, COMMISSAIRE_ROOT: commissaireRoot },
  });
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stderr}${r.stdout}`);
  cleanups.push(() => fs.rmSync(sut, { recursive: true, force: true }));
  return sut;
}

function runPhase(sut, args, { driver, rev, extraEnv = {} } = {}) {
  const env = { ...process.env, ...extraEnv };
  if (driver) env.COMMISSAIRE_ROOT = driver;
  if (rev) env.COMMISSAIRE_REVISION = rev;
  return spawnSync("node", [path.join(sut, "scripts", "verify-commissaire.mjs"), ...args], { cwd: sut, encoding: "utf8", env });
}
function runWrapper(sut, stdinObj) {
  return spawnSync("node", [path.join(sut, "scripts", "commissaire-stop-hook.mjs")], {
    cwd: sut,
    input: typeof stdinObj === "string" ? stdinObj : JSON.stringify(stdinObj),
    encoding: "utf8",
  });
}
function pointer(sut) {
  return JSON.parse(fs.readFileSync(path.join(sut, ".faff", "active-run.json"), "utf8"));
}
function liveRunDir(sut) {
  return path.resolve(sut, pointer(sut).run_dir);
}
function hookLines(sut) {
  const f = path.join(sut, ".faff", "hook-observations.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// A completed run (prepare -> block firing -> complete) but NOT yet verified. Returns { sut, D, runId }.
function completedSut() {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  const p = runPhase(sut, ["prepare"], { driver, rev: EXPECTED });
  assert.strictEqual(p.status, 0, `prepare: ${p.stderr}`);
  const D = liveRunDir(sut);
  const runId = pointer(sut).run_id;
  const w1 = runWrapper(sut, { hook_event_name: "Stop" });
  assert.strictEqual(w1.status, 0);
  const c = runPhase(sut, ["complete"], { driver, rev: EXPECTED });
  assert.strictEqual(c.status, 0, `complete: ${c.stderr}`);
  return { sut, D, runId, driver };
}

// The shared full fixture: a completed + verified run into a known capture dir. Built once.
let SHARED = null;
function sharedFixture() {
  if (SHARED) return SHARED;
  const { sut, D, runId, driver } = completedSut();
  const w2 = runWrapper(sut, { hook_event_name: "Stop" });
  assert.strictEqual(w2.status, 0);
  const capture = mkdtemp("cbc-cap-");
  fs.rmSync(capture, { recursive: true, force: true });
  cleanups.push(() => fs.rmSync(capture, { recursive: true, force: true }));
  const v = runPhase(sut, ["verify", "--capture", capture], { driver, rev: EXPECTED });
  assert.strictEqual(v.status, 0, `verify: ${v.stderr}`);
  SHARED = { sut, D, runId, driver, capture };
  return SHARED;
}
function readResult(capture) {
  return JSON.parse(fs.readFileSync(path.join(capture, "demo-result.json"), "utf8"));
}

// ==================================================================================================

test("Full ci: end-to-end pinned run exits 0 with the integration-smoke shape", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  const r = runPhase(sut, ["ci"], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 0, `ci: ${r.stderr}`);
  assert.ok(r.stdout && r.stdout.trim().length > 0, `ci exit ${r.status} (signal=${r.signal}) but empty stdout; stderr=[${(r.stderr || "").slice(0, 600)}]`);
  const d = JSON.parse(r.stdout);
  const o = d.observations;
  assert.strictEqual(d.counts_pinned, true);
  assert.strictEqual(d.source, "ci-fixture");
  assert.strictEqual(o.first_stop_hook, "block");
  assert.strictEqual(o.second_stop_hook, "allow");
  assert.strictEqual(o.no_evidence_refusal.reason, "no-evidence");
  assert.strictEqual(o.predeclaration_decision.verdict, "deny");
  assert.strictEqual(o.covered_decision.verdict, "grant");
  assert.strictEqual(o.terminal_verdict.seq, 7);
  assert.deepStrictEqual(o.live_audit_verify.producer_claims, { verified: 4, unverifiable_without_secret: 0, failed: 0 });
  assert.strictEqual(o.live_audit_verify.commissaire_decisions.verified, 3);
  assert.strictEqual(o.replay_audit_verify.producer_claims.unverifiable_without_secret, 4);
  assert.strictEqual(o.replay_audit_verify.commissaire_decisions.verified, 4);
  assert.strictEqual(o.sealed_bundle.bundle_manifest_digest, o.exported_bundle.bundle_manifest_digest);
  assert.strictEqual(o.replay_bundle_verify.verdict, "CLEAN");
  assert.strictEqual(o.replay_script.exit, 0);
  assert.strictEqual(o.terminal_runcheck.clean, true);
  assert.strictEqual(d.forgery_rejection.ed25519_sig.reason, "commissaire-sig-invalid");
  assert.strictEqual(d.forgery_rejection.producer_hmac.reason, "producer-auth-mismatch");
  assert.ok(d.curation.clean === true && d.curation.secret_forms_checked >= 3);
  // nothing published to results/
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, "verification", "external-verification", "results", `${d.run_id}`)));
});

test("Member digests: every members[].path re-hashes to its recorded sha256", () => {
  const { capture } = sharedFixture();
  const d = readResult(capture);
  assert.ok(d.members.length > 0);
  for (const m of d.members) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(capture, m.path))).digest("hex");
    assert.strictEqual(actual, m.sha256, `digest mismatch at ${m.path}`);
  }
});

test("Tamper: a value-region byte flip in ledger_snapshot.bin yields TAMPERED (not MALFORMED)", () => {
  const { capture, driver, runId } = sharedFixture();
  const d = readResult(capture);
  const seg = d.bundle_identity.run_segment_id;
  const scratch = mkdtemp("cbc-tamper-");
  cleanups.push(() => fs.rmSync(scratch, { recursive: true, force: true }));
  // copy the capture
  spawnSync("cp", ["-R", capture + "/.", scratch]);
  const binPath = path.join(scratch, ".faff", "bundles", runId, `seg-${seg}`, "run-close", "ledger_snapshot.bin");
  const parsed = JSON.parse(fs.readFileSync(binPath, "utf8"));
  // mutate a string value so the member still parses as JSON but its digest changes.
  parsed.__tamper = "x".repeat(8);
  fs.writeFileSync(binPath, JSON.stringify(parsed));
  const faff = path.join(driver, "plugin", "skills", "faff", "bin", "faff");
  const r = spawnSync(faff, ["bundle", "verify", "--root", scratch, "--run-id", runId, "--run-segment-id", String(seg), "--boundary-kind", "run-close", "--boundary-key", "run-close", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 1);
  const v = JSON.parse(r.stdout);
  assert.strictEqual(v.verdict, "TAMPERED");
});

test("Replay script: sh replay.sh from the capture with cwd inside the driver exits 0", () => {
  const { capture, driver } = sharedFixture();
  const r = spawnSync("sh", [path.join(capture, "replay.sh")], { cwd: driver, encoding: "utf8", env: { ...process.env, COMMISSAIRE_ROOT: driver } });
  assert.strictEqual(r.status, 0, `${r.stderr}${r.stdout}`);
});

test("Replay no root: sh replay.sh with COMMISSAIRE_ROOT unset exits 2", () => {
  const { capture } = sharedFixture();
  const env = { ...process.env };
  delete env.COMMISSAIRE_ROOT;
  const r = spawnSync("sh", [path.join(capture, "replay.sh")], { encoding: "utf8", env });
  assert.strictEqual(r.status, 2);
});

test("Curate clean: curate <capture> --run-dir D exits 0 with secret_forms_checked >= 3", () => {
  const { capture, D, sut } = sharedFixture();
  const r = runPhase(sut, ["curate", capture, "--run-dir", D]);
  assert.strictEqual(r.status, 0, `${r.stderr}`);
  const rep = JSON.parse(r.stdout);
  assert.strictEqual(rep.clean, true);
  assert.ok(rep.secret_forms_checked >= 3);
});

test("Curate contaminated: four seeded contaminants each named, exit 1", () => {
  const { capture, D, sut } = sharedFixture();
  const dirty = mkdtemp("cbc-dirty-");
  cleanups.push(() => fs.rmSync(dirty, { recursive: true, force: true }));
  spawnSync("cp", ["-R", capture + "/.", dirty]);
  // (a) live governor.json under another name
  fs.copyFileSync(path.join(D, "commissaire", "governor", "governor.json"), path.join(dirty, "notes.json"));
  // (b) a JSON file with an absolute path embedded mid-string
  fs.writeFileSync(path.join(dirty, "badpath.json"), JSON.stringify({ note: "leaked /home/attacker/secret.txt here" }));
  // (c) a .bin file carrying master_secret bytes mid-file
  const gov = JSON.parse(fs.readFileSync(path.join(D, "commissaire", "governor", "governor.json"), "utf8"));
  fs.writeFileSync(path.join(dirty, "badbytes.bin"), `prefix ${gov.master_secret} suffix`);
  // (d) a file named transcript.jsonl
  fs.writeFileSync(path.join(dirty, "transcript.jsonl"), "{}\n");
  const r = runPhase(sut, ["curate", dirty, "--run-dir", D]);
  assert.strictEqual(r.status, 1);
  for (const name of ["notes.json", "badpath.json", "badbytes.bin", "transcript.jsonl"]) {
    assert.match(r.stderr, new RegExp(name.replace(".", "\\.")), `expected ${name} named in findings:\n${r.stderr}`);
  }
});

test("Curate no run-dir: no --run-dir and no live pointer exits 3 with clean:null", () => {
  const { capture, sut } = sharedFixture();
  // the shared SUT's pointer was removed by verify, so no live run dir resolves.
  const r = runPhase(sut, ["curate", capture]);
  assert.strictEqual(r.status, 3);
  const rep = JSON.parse(r.stdout);
  assert.strictEqual(rep.clean, null);
  assert.strictEqual(rep.scan, "skipped-no-run-dir");
});

test("Curate late members: demo-result.json with a path + a secret both caught with --run-dir D", () => {
  const { D, sut } = sharedFixture();
  const late = mkdtemp("cbc-late-");
  cleanups.push(() => fs.rmSync(late, { recursive: true, force: true }));
  const gov = JSON.parse(fs.readFileSync(path.join(D, "commissaire", "governor", "governor.json"), "utf8"));
  fs.writeFileSync(path.join(late, "demo-result.json"), JSON.stringify({ leak: "/Users/x/secret", secret: gov.master_secret }));
  const r = runPhase(sut, ["curate", late, "--run-dir", D]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /absolute-path demo-result\.json/);
  assert.match(r.stderr, /secret-bytes demo-result\.json/);
});

test("Forgery FR-1: a flipped seq-7 commissaire_sig is rejected from public material; untouched capture still CLEAN", () => {
  const { capture, driver, runId } = sharedFixture();
  const commissaire = path.join(driver, "plugin", "skills", "faff", "bin", "commissaire");
  const scratch = mkdtemp("cbc-fr1-");
  cleanups.push(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const anchor = path.join(capture, ".faff", "anchors", runId, "DEMO-1");
  spawnSync("cp", ["-R", anchor, path.join(scratch, "anchor")]);
  const de = path.join(scratch, "anchor", "declared-effects.jsonl");
  const arr = fs.readFileSync(de, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rec = arr.find((r) => r.seq === 7);
  const c = rec.commissaire_sig[5];
  rec.commissaire_sig = rec.commissaire_sig.slice(0, 5) + (c === "A" ? "B" : "A") + rec.commissaire_sig.slice(6);
  fs.writeFileSync(de, arr.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r = spawnSync(commissaire, ["audit", "verify", "--run-dir", path.join(scratch, "anchor"), "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.notStrictEqual(j.result, "pass");
  const rec7 = j.records.find((x) => x.seq === 7);
  assert.strictEqual(rec7.classification, "failed");
  assert.strictEqual(rec7.reason, "commissaire-sig-invalid");
  // untouched capture still replays CLEAN
  const replay = spawnSync("sh", [path.join(capture, "replay.sh")], { cwd: driver, encoding: "utf8", env: { ...process.env, COMMISSAIRE_ROOT: driver } });
  assert.strictEqual(replay.status, 0);
});

test("Forgery FR-2: a flipped seq-6 producer_hmac is rejected with the secret present", () => {
  const { D, driver, capture } = sharedFixture();
  const commissaire = path.join(driver, "plugin", "skills", "faff", "bin", "commissaire");
  const scratch = mkdtemp("cbc-fr2-");
  cleanups.push(() => fs.rmSync(scratch, { recursive: true, force: true }));
  spawnSync("cp", ["-R", D, path.join(scratch, "rundir")]);
  const de = path.join(scratch, "rundir", "declared-effects.jsonl");
  const arr = fs.readFileSync(de, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rec = arr.find((r) => r.seq === 6);
  const c = rec.producer_hmac[3];
  rec.producer_hmac = rec.producer_hmac.slice(0, 3) + (c === "a" ? "b" : "a") + rec.producer_hmac.slice(4);
  fs.writeFileSync(de, arr.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r = spawnSync(commissaire, ["audit", "verify", "--run-dir", path.join(scratch, "rundir"), "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 1);
  const j = JSON.parse(r.stdout);
  const rec6 = j.records.find((x) => x.seq === 6);
  assert.strictEqual(rec6.classification, "failed");
  assert.strictEqual(rec6.reason, "producer-auth-mismatch");
  const replay = spawnSync("sh", [path.join(capture, "replay.sh")], { cwd: driver, encoding: "utf8", env: { ...process.env, COMMISSAIRE_ROOT: driver } });
  assert.strictEqual(replay.status, 0);
});

test("Label fixture: bare Stop stdin yields source ci-fixture with no provenance", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  runWrapper(sut, { hook_event_name: "Stop" });
  const last = hookLines(sut).at(-1);
  assert.strictEqual(last.source, "ci-fixture");
  assert.strictEqual(last.provenance, undefined);
});

test("Label observed: full Stop shape yields claude-code-observed with a hashed session, no raw values", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const runId = pointer(sut).run_id;
  const transcript = mkdtemp("cbc-tr-");
  cleanups.push(() => fs.rmSync(transcript, { recursive: true, force: true }));
  const tPath = path.join(transcript, "t.jsonl");
  fs.writeFileSync(tPath, "{}\n");
  const sessionId = "session-abc-123";
  const line = runWrapperGetLine(sut, { hook_event_name: "Stop", session_id: sessionId, transcript_path: tPath, cwd: sut, stop_hook_active: false });
  assert.strictEqual(line.source, "claude-code-observed");
  assert.strictEqual(line.provenance.transcript_existed, true);
  assert.strictEqual(line.provenance.cwd_matched, true);
  assert.strictEqual(line.provenance.session_id_sha256, crypto.createHash("sha256").update(runId + sessionId).digest("hex"));
  const raw = JSON.stringify(line);
  assert.ok(!raw.includes(sessionId), "raw session_id must not be retained");
  assert.ok(!raw.includes(tPath), "raw transcript_path must not be retained");
});
function runWrapperGetLine(sut, stdinObj) {
  runWrapper(sut, stdinObj);
  return hookLines(sut).at(-1);
}

test("Label missing transcript: a nonexistent transcript_path falls back to ci-fixture", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const line = runWrapperGetLine(sut, { hook_event_name: "Stop", session_id: "s", transcript_path: path.join(sut, "does-not-exist"), cwd: sut, stop_hook_active: true });
  assert.strictEqual(line.source, "ci-fixture");
});

test("Source not caller-supplied: a stdin source field is ignored, deriving ci-fixture", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const line = runWrapperGetLine(sut, { hook_event_name: "Stop", source: "claude-code-observed" });
  assert.strictEqual(line.source, "ci-fixture");
});

test("Session mismatch: two claude-code-observed observations with different hashes fail verify", () => {
  const { sut, runId, driver } = completedSut();
  const store = path.join(sut, ".faff", "hook-observations.jsonl");
  const mk = (ordinal, result, hash) => ({ schema: 2, ordinal, hook_event_name: "Stop", input_shape_validated: true, source: "claude-code-observed", provenance: { session_id_sha256: hash, transcript_existed: true, cwd_matched: true }, run_id: runId, result });
  fs.writeFileSync(store, [mk(1, "block", "a".repeat(64)), mk(2, "allow", "b".repeat(64))].map((o) => JSON.stringify(o)).join("\n") + "\n");
  const r = runPhase(sut, ["verify", "--capture", freshCap()], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /session/);
});

test("Mixed source: one observed + one ci-fixture fails verify", () => {
  const { sut, runId, driver } = completedSut();
  const store = path.join(sut, ".faff", "hook-observations.jsonl");
  const l1 = { schema: 2, ordinal: 1, hook_event_name: "Stop", input_shape_validated: true, source: "claude-code-observed", provenance: { session_id_sha256: "a".repeat(64), transcript_existed: true, cwd_matched: true }, run_id: runId, result: "block" };
  const l2 = { schema: 2, ordinal: 2, hook_event_name: "Stop", input_shape_validated: true, source: "ci-fixture", run_id: runId, result: "allow" };
  fs.writeFileSync(store, [l1, l2].map((o) => JSON.stringify(o)).join("\n") + "\n");
  const r = runPhase(sut, ["verify", "--capture", freshCap()], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 1);
});

test("Observation order: a reversed allow-then-block pair fails verify", () => {
  const { sut, runId, driver } = completedSut();
  const store = path.join(sut, ".faff", "hook-observations.jsonl");
  const mk = (ordinal, result) => ({ schema: 2, ordinal, hook_event_name: "Stop", input_shape_validated: true, source: "ci-fixture", run_id: runId, result });
  fs.writeFileSync(store, [mk(1, "allow"), mk(2, "block")].map((o) => JSON.stringify(o)).join("\n") + "\n");
  const r = runPhase(sut, ["verify", "--capture", freshCap()], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 1);
});
function freshCap() {
  const c = mkdtemp("cbc-vc-");
  fs.rmSync(c, { recursive: true, force: true });
  cleanups.push(() => fs.rmSync(c, { recursive: true, force: true }));
  return c;
}

for (const [label, mutate, reason] of [
  ["Pointer absolute", (p) => ({ ...p, run_dir: "/abs/run" }), "pointer-run_dir-absolute"],
  ["Pointer traversal", (p) => ({ ...p, run_dir: ".faff/../x/" + p.run_id }), "pointer-run_dir-traversal"],
  ["Pointer run_id", (p) => ({ ...p, run_dir: ".faff/runs/different-name" }), "pointer-basename-ne-run_id"],
]) {
  test(`${label}: the Stop wrapper blocks (exit 0) without reading the run dir`, () => {
    const driver = provisionDriver(EXPECTED);
    const sut = scaffold(driver);
    assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
    const p = pointer(sut);
    fs.writeFileSync(path.join(sut, ".faff", "active-run.json"), JSON.stringify(mutate(p)));
    const r = runWrapper(sut, { hook_event_name: "Stop" });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.decision, "block");
    assert.strictEqual(out.reason, reason);
  });
}

test("Malformed stdin: non-JSON stdin blocks with exit 0", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const r = runWrapper(sut, "not json at all");
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).decision, "block");
});

test("FAFF_BIN missing: an unresolvable FAFF_BIN blocks naming faff-bin-unresolvable", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const hook = path.join(sut, "scripts", "commissaire-stop-hook.mjs");
  const src = fs.readFileSync(hook, "utf8").replace(/const FAFF_BIN = "[^"]*";/, `const FAFF_BIN = "${path.join(sut, "no-such-faff")}";`);
  fs.writeFileSync(hook, src);
  const r = runWrapper(sut, { hook_event_name: "Stop" });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).reason, "faff-bin-unresolvable");
});

test("Runcheck spawn failure: a FAFF_BIN that exits non-zero without a decision JSON blocks naming runcheck-spawn-failed", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const stub = path.join(sut, "stub-faff");
  fs.writeFileSync(stub, "#!/bin/sh\nexit 3\n");
  fs.chmodSync(stub, 0o755);
  const hook = path.join(sut, "scripts", "commissaire-stop-hook.mjs");
  const src = fs.readFileSync(hook, "utf8").replace(/const FAFF_BIN = "[^"]*";/, `const FAFF_BIN = "${stub}";`);
  fs.writeFileSync(hook, src);
  const r = runWrapper(sut, { hook_event_name: "Stop" });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).reason, "runcheck-spawn-failed");
});

test("Runcheck malformed exit-0: a FAFF_BIN that exits 0 with non-JSON stdout blocks naming runcheck-malformed-output", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  const stub = path.join(sut, "stub-faff");
  fs.writeFileSync(stub, "#!/bin/sh\necho 'garbled not json'\nexit 0\n");
  fs.chmodSync(stub, 0o755);
  const hook = path.join(sut, "scripts", "commissaire-stop-hook.mjs");
  const src = fs.readFileSync(hook, "utf8").replace(/const FAFF_BIN = "[^"]*";/, `const FAFF_BIN = "${stub}";`);
  fs.writeFileSync(hook, src);
  const r = runWrapper(sut, { hook_event_name: "Stop" });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).reason, "runcheck-malformed-output");
});

test("Denied file pre-created: protected-output.txt present before complete exits 1", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  runWrapper(sut, { hook_event_name: "Stop" });
  fs.writeFileSync(path.join(sut, "protected-output.txt"), "premature\n");
  const r = runPhase(sut, ["complete"], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 1);
});

test("Complete without block: zero prior hook observations exits 1", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  // no wrapper firing at all
  const r = runPhase(sut, ["complete"], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 1);
});

test("Stale hook store: a stale ordinal-1 block line before prepare is truncated; full ci still exits 0", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  const store = path.join(sut, ".faff", "hook-observations.jsonl");
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify({ schema: 2, ordinal: 1, hook_event_name: "Stop", input_shape_validated: true, source: "ci-fixture", run_id: "run-STALE", result: "block" }) + "\n");
  const r = runPhase(sut, ["ci"], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 0, `ci: ${r.stderr}`);
});

test("Seal not-fresh: a stubbed idempotent seal makes complete exit 1", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  assert.strictEqual(runPhase(sut, ["prepare"], { driver, rev: EXPECTED }).status, 0);
  runWrapper(sut, { hook_event_name: "Stop" });
  const override = JSON.stringify({ sealed: true, idempotent: true, identity: { boundary_kind: "run-close" }, bundle_manifest_digest: "x" });
  const r = runPhase(sut, ["complete"], { driver, rev: EXPECTED, extraEnv: { FAFF360_TEST_SEAL_OVERRIDE: override } });
  assert.strictEqual(r.status, 1);
});

test("Non-empty capture: verify --capture at a non-empty directory exits 2", () => {
  const { sut, driver } = completedSut();
  runWrapper(sut, { hook_event_name: "Stop" });
  const cap = mkdtemp("cbc-nonempty-");
  fs.writeFileSync(path.join(cap, "occupied"), "x");
  cleanups.push(() => fs.rmSync(cap, { recursive: true, force: true }));
  const r = runPhase(sut, ["verify", "--capture", cap], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 2);
});

test("Tracked run dir: a staged .faff path makes preflight exit 2", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  fs.mkdirSync(path.join(sut, ".faff"), { recursive: true });
  fs.writeFileSync(path.join(sut, ".faff", "x"), "x");
  git(sut, "add", "-f", ".faff/x");
  const r = runPhase(sut, ["prepare"], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 2);
});

test("Configured remote: a configured git remote makes preflight exit 2", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  git(sut, "remote", "add", "origin", "https://example.invalid/repo.git");
  const r = runPhase(sut, ["prepare"], { driver, rev: EXPECTED });
  assert.strictEqual(r.status, 2);
});

test("Governor override refused: COMMISSAIRE_GOVERNOR_DIR makes preflight exit 2", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  const r = runPhase(sut, ["prepare"], { driver, rev: EXPECTED, extraEnv: { COMMISSAIRE_GOVERNOR_DIR: "/tmp/x" } });
  assert.strictEqual(r.status, 2);
});

test("Revision pin: a different-but-present SHA with no drift flag exits 2 naming both SHAs", () => {
  const drift = provisionDriver(DRIFT);
  const sut = scaffold(drift);
  const r = runPhase(sut, ["prepare"], { driver: drift, rev: DRIFT });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, new RegExp(DRIFT));
  assert.match(r.stderr, new RegExp(EXPECTED));
});

test("Revision drift accept: ALLOW_REVISION_DRIFT=1 + a different SHA continues and stamps counts_pinned:false", () => {
  const drift = provisionDriver(DRIFT);
  const sut = scaffold(drift);
  const r = runPhase(sut, ["ci"], { driver: drift, rev: DRIFT, extraEnv: { ALLOW_REVISION_DRIFT: "1" } });
  assert.strictEqual(r.status, 0, `drift ci: ${r.stderr}`);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.counts_pinned, false);
});

test("Revision drift shape: the shape-assertion function passes over a fabricated non-8 record list", async () => {
  const mod = await import(pathToFileURL(path.join(SRC_DIR, "verify-commissaire.mjs")).href);
  const records = [
    { seq: 0, kind_of_entry: "admission" },
    { seq: 1, kind_of_entry: "effect-decision-request" },
    { seq: 2, kind_of_entry: "effect-decision-verdict", payload: { verdict: "deny" } },
    { seq: 3, kind_of_entry: "declare" },
    { seq: 4, kind_of_entry: "effect-decision-request" },
    { seq: 5, kind_of_entry: "effect-decision-verdict", payload: { verdict: "grant" } },
    { seq: 6, kind_of_entry: "observe" },
    { seq: 7, kind_of_entry: "observe" },
    { seq: 8, kind_of_entry: "observe" },
    { seq: 9, kind_of_entry: "accepted_under_contract" },
  ];
  const live = { producer_claims: { verified: 6, unverifiable_without_secret: 0, failed: 0 }, commissaire_decisions: { verified: 3, failed: 0 } };
  const replay = { producer_claims: { verified: 0, unverifiable_without_secret: 6, failed: 0 }, commissaire_decisions: { verified: 4, failed: 0 } };
  assert.deepStrictEqual(mod.driftShapeFindings(records, live, replay), []);
  // a broken shape (admission not first) is caught
  const broken = mod.driftShapeFindings([{ seq: 0, kind_of_entry: "declare" }, ...records.slice(1)], live, replay);
  assert.ok(broken.includes("admission-not-first"));
});

test("README claims: the generated capture README carries every required sentence and no forbidden phrase", () => {
  const { capture } = sharedFixture();
  const readme = fs.readFileSync(path.join(capture, "README.md"), "utf8");
  for (const required of [
    "present only after the grant",
    "gates only on zero evidence",
    "forgeable derived label",
    "FAFF-1015",
    "FAFF-1016",
    "FAFF-1017",
    "FAFF-829",
    EXPECTED,
  ]) {
    assert.ok(readme.includes(required), `README missing required: ${required}`);
  }
  for (const forbidden of [
    "hostile same-UID isolation",
    "cryptographic proof of Claude identity",
    "universal effect prevention",
    "merge enforcement",
    "offline producer authentication",
    "Commissaire-minted anchor",
  ]) {
    assert.ok(!readme.includes(forbidden), `README contains forbidden phrase: ${forbidden}`);
  }
});

test("Gitignore content: the scaffolded SUT .gitignore is exactly the two lines and never scripts/", () => {
  const driver = provisionDriver(EXPECTED);
  const sut = scaffold(driver);
  const gi = fs.readFileSync(path.join(sut, ".gitignore"), "utf8");
  const lines = gi.split("\n").filter((l) => l.length > 0);
  assert.deepStrictEqual(lines, [".faff/", "protected-output.txt"]);
  assert.ok(!gi.includes("scripts/"));
});

test("Replay resolves relative: replay.sh resolves both binaries COMMISSAIRE_ROOT-relative, never via PATH", () => {
  const replay = fs.readFileSync(path.join(SRC_DIR, "replay.sh"), "utf8");
  assert.ok(replay.includes('$COMMISSAIRE_ROOT/plugin/skills/faff/bin/commissaire'));
  assert.ok(replay.includes('$COMMISSAIRE_ROOT/plugin/skills/faff/bin/faff'));
  // no bare `commissaire`/`faff` invoked as a command (first token of a line)
  for (const line of replay.split("\n")) {
    assert.ok(!/^\s*(commissaire|faff)\s/.test(line), `bare PATH invocation: ${line}`);
  }
});

test("External README marker: the config-free second-consumer row is present", () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, "verification", "external-verification", "README.md"), "utf8");
  assert.ok(readme.includes("commissaire-bare-claude (config-free second consumer)"));
});
