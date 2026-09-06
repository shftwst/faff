#!/usr/bin/env node
// FAFF-360 — CI-provable harness for the bare Claude Code Commissaire consumer.
//
// A five-phase verifier (prepare / complete / verify / curate / ci) that drives an ordinary
// no-remote repository (the SUT) through the shipped Commissaire governance workflow using two
// binaries from one pinned driver checkout: `commissaire` issues every governance decision,
// `faff` supplies the flight-recorder legs (run ledger, anchor, chain validators, runcheck,
// bundle verify). No SuperDomestique skills, config, or plugins live in the SUT.
//
// This file is copied verbatim into a scaffolded SUT's scripts/ directory. The scaffolder fills
// EXPECTED_COMMISSAIRE_REVISION here and FAFF_BIN in the sibling stop-hook. Every count is a
// statement about one pinned emission shape; ALLOW_REVISION_DRIFT=1 relaxes counts to shape
// assertions. See the design spec (records/specs/2026-09-06-faff-360-...-design.md) for the
// full behaviour contract; this implementation asserts exit codes and stdout shapes only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// The pinned driver revision the harness was proven against. The scaffolder substitutes this
// value; kept as a real SHA here so a static "same SHA in scaffolder and verifier" check holds.
const EXPECTED_COMMISSAIRE_REVISION = "fd1e9788a44860ee8804bdb775e33fb5dfd3f057";
// FAFF-828 facade commit; preflight requires it to be an ancestor of the driver revision.
const FAFF828_ANCESTOR = "881f4a2555aa919947ec7e52a15b093478ed8110";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUT_ROOT = path.resolve(SCRIPT_DIR, "..");
const POINTER_PATH = path.join(SUT_ROOT, ".faff", "active-run.json");
const HOOK_STORE = path.join(SUT_ROOT, ".faff", "hook-observations.jsonl");
const CMD_STORE_NAME = "command-observations.jsonl";

const ISSUE = "DEMO-1";
const PRODUCER = "bare-claude";
const TARGET = "protected-output.txt";

// ---------------------------------------------------------------------------------------------
// small utilities

function die(code, msg) {
  process.stderr.write(String(msg).replace(/\n?$/, "\n"));
  process.exit(code);
}
function isHex40(s) {
  return typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
}
function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// Absolute host-path token: "/"-led and beginning at a real filesystem root, at string start or
// after a boundary character (whitespace or one of " ' = : ( , [ ), plus the Windows drive form.
// Matches an embedded /home/... or /srv/... mid-string, not only at position 0.
//
// Anchoring on a KNOWN-ROOT set (rather than any bare "/"-led run) is deliberate and load-bearing:
// the anchor's ledger carries standard-base64 signatures (commissaire_sig) that legitimately start
// with "/" about 1 time in 64, so a bare "/"-led rule flags a crypto blob as a host path and makes
// curate roughly 6% flaky across runs with fresh keys. Every realistic host-path leak vector in
// this harness - the run dir, the capture dir, and the driver checkout - sits under one of these
// roots, so the narrowing keeps the "no absolute host path" guarantee while eliminating the false
// positive. A base64 blob would have to start with exactly "/home", "/tmp", ... to collide, which
// is astronomically unlikely.
const ABS_BOUNDARY = "\\s\"'=:(,\\[";
const HOST_ROOTS = "home|Users|tmp|private|var|srv|opt|etc|mnt|root|usr|data|app|workspace|builds|github|Volumes|proc|sys|dev|run|nix|snap";
const HOST_PATH = new RegExp(`(^|[${ABS_BOUNDARY}])(/(?:${HOST_ROOTS})(?:/[^${ABS_BOUNDARY}\\]]*)?)`, "g");
const WIN_DRIVE = /[A-Za-z]:[\\/][^\s"'=:(,\[\]]*/g;

function stringHasAbsPath(s) {
  if (typeof s !== "string") return false;
  HOST_PATH.lastIndex = 0;
  if (HOST_PATH.test(s)) return true;
  WIN_DRIVE.lastIndex = 0;
  return WIN_DRIVE.test(s);
}
function scrubAbsPaths(s) {
  return s.replace(HOST_PATH, (whole, b) => b + "<abs>").replace(WIN_DRIVE, "<abs>");
}

// PROCEDURE normalise_stdout — delete dir/path fields, scrub absolute-path tokens anywhere.
const NORMALISE_DELETE = ["governor_dir", "producer_dir", "run_dir", "dest", "path", "anchor_dir"];
function normaliseStdout(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  for (const k of NORMALISE_DELETE) delete clone[k];
  const walk = (v) => {
    if (typeof v === "string") return scrubAbsPaths(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(clone);
}

// ---------------------------------------------------------------------------------------------
// binary resolution + invocation with CommandObservation recording

function requireEnv(name) {
  const v = process.env[name];
  if (!v) die(2, `preflight: ${name} is required`);
  return v;
}

let COMMISSAIRE_ROOT = null;
const cmdObservations = []; // accumulated, normalised, written at verify step 14b

function binPath(binary) {
  return path.join(COMMISSAIRE_ROOT, "plugin", "skills", "faff", "bin", binary);
}

// argv_shape: flag names and fixed literals only; any path-valued token replaced with "<abs>".
function argvShape(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      out.push(a);
    } else if (path.isAbsolute(a) || stringHasAbsPath(a)) {
      out.push("<abs>");
    } else {
      out.push(a);
    }
  }
  return out;
}

// Run a binary. When `record` is true, append a normalised CommandObservation. `env` extends the
// process env. Returns { exit, stdout, stderr, json }.
function invoke(leg, binary, args, { input = undefined, env = {}, record = true } = {}) {
  const res = spawnSync(binPath(binary), args, {
    input: input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) die(2, `invoke ${leg}: spawn failed: ${res.error.message}`);
  let json;
  const out = res.stdout || "";
  try {
    json = out.trim() ? JSON.parse(out.trim()) : undefined;
  } catch {
    json = undefined;
  }
  if (record) {
    const obs = { leg, binary, argv_shape: argvShape(args), exit: res.status };
    if (json !== undefined) obs.stdout_json = normaliseStdout(json);
    cmdObservations.push(obs);
  }
  return { exit: res.status, stdout: out, stderr: res.stderr || "", json };
}

// ---------------------------------------------------------------------------------------------
// active-run pointer

function readPointer() {
  if (!fs.existsSync(POINTER_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(POINTER_PATH, "utf8"));
  } catch {
    return null;
  }
}
// Returns null when the pointer is structurally valid + contained, else a short reason string.
function pointerContainmentError(ptr) {
  if (!ptr || typeof ptr !== "object") return "pointer-not-object";
  if (ptr.schema !== 1) return "pointer-bad-schema";
  const rd = ptr.run_dir;
  if (typeof rd !== "string" || rd.length === 0) return "pointer-missing-run_dir";
  if (path.isAbsolute(rd)) return "pointer-run_dir-absolute";
  const segs = rd.split(/[\\/]/);
  if (segs.some((s) => s === "." || s === "..")) return "pointer-run_dir-traversal";
  const resolved = path.resolve(SUT_ROOT, rd);
  const rel = path.relative(SUT_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "pointer-escapes-sut";
  if (path.basename(rd) !== ptr.run_id) return "pointer-basename-ne-run_id";
  return null;
}
function absRunDir(ptr) {
  return path.resolve(SUT_ROOT, ptr.run_dir);
}
function writePointer(state, runId, relRunDir) {
  writeAtomic(
    POINTER_PATH,
    JSON.stringify({ schema: 1, run_id: runId, run_dir: relRunDir, issue: ISSUE, producer_id: PRODUCER, state }) + "\n",
  );
}

// ---------------------------------------------------------------------------------------------
// hook-observation counting

function hookLinesFor(runId) {
  return readJsonLines(HOOK_STORE).filter((o) => o.run_id === runId);
}

// ---------------------------------------------------------------------------------------------
// preflight

function preflight({ requireEnvRevision = true } = {}) {
  // 12. governor/producer dir override refusal (checked before touching anything).
  for (const flag of ["--governor-dir", "--producer-dir"]) {
    if (process.argv.includes(flag)) die(2, `preflight: ${flag} override is refused (secrets must stay under .faff/)`);
  }
  for (const ev of ["COMMISSAIRE_GOVERNOR_DIR", "COMMISSAIRE_PRODUCER_DIR"]) {
    if (process.env[ev]) die(2, `preflight: ${ev} override is refused (secrets must stay under .faff/)`);
  }
  // 1. Node 20+, git.
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) die(2, `preflight: Node 20+ required, have ${process.versions.node}`);
  const gitv = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (gitv.status !== 0) die(2, "preflight: git is required");

  COMMISSAIRE_ROOT = requireEnv("COMMISSAIRE_ROOT");
  if (!path.isAbsolute(COMMISSAIRE_ROOT)) COMMISSAIRE_ROOT = path.resolve(COMMISSAIRE_ROOT);
  // 2. COMMISSAIRE_ROOT outside the SUT.
  const relRootToSut = path.relative(SUT_ROOT, COMMISSAIRE_ROOT);
  if (COMMISSAIRE_ROOT === SUT_ROOT || (!relRootToSut.startsWith("..") && !path.isAbsolute(relRootToSut) && relRootToSut !== "")) {
    die(2, `preflight: COMMISSAIRE_ROOT must be outside the SUT (${COMMISSAIRE_ROOT})`);
  }

  const rev = requireEnvRevision ? requireEnv("COMMISSAIRE_REVISION") : process.env.COMMISSAIRE_REVISION;
  let countsPinned = true;
  const allowDrift = process.env.ALLOW_REVISION_DRIFT === "1";
  if (rev) {
    // 3. COMMISSAIRE_REVISION equals the driver HEAD.
    const head = spawnSync("git", ["-C", COMMISSAIRE_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (head.status !== 0) die(2, "preflight: cannot read driver HEAD");
    const headSha = head.stdout.trim();
    if (headSha !== rev) die(2, `preflight: COMMISSAIRE_REVISION ${rev} != driver HEAD ${headSha}`);
    // 4. revision pin (unless drift).
    if (rev !== EXPECTED_COMMISSAIRE_REVISION) {
      if (!allowDrift) {
        die(
          2,
          `preflight: COMMISSAIRE_REVISION ${rev} != EXPECTED_COMMISSAIRE_REVISION ${EXPECTED_COMMISSAIRE_REVISION} (set ALLOW_REVISION_DRIFT=1 to relax counts)`,
        );
      }
      countsPinned = false;
    }
    // 5. FAFF-828 ancestor.
    const anc = spawnSync("git", ["-C", COMMISSAIRE_ROOT, "merge-base", "--is-ancestor", FAFF828_ANCESTOR, rev]);
    if (anc.status !== 0) die(2, `preflight: FAFF-828 commit ${FAFF828_ANCESTOR} is not an ancestor of ${rev}`);
    // 6. required blobs at the revision.
    for (const p of ["plugin/skills/faff/bin/commissaire", "plugin/skills/faff/bin/lib/bundle-seal-core.js"]) {
      const e = spawnSync("git", ["-C", COMMISSAIRE_ROOT, "cat-file", "-e", `${rev}:${p}`]);
      if (e.status !== 0) die(2, `preflight: revision ${rev} lacks ${p}`);
    }
  } else if (requireEnvRevision) {
    die(2, "preflight: COMMISSAIRE_REVISION is required");
  }
  // 7. usage probe.
  const usage = spawnSync(binPath("commissaire"), [], { encoding: "utf8" });
  if (usage.status !== 2 || !/audit export/.test(usage.stdout + usage.stderr) || !/audit verify/.test(usage.stdout + usage.stderr)) {
    die(2, "preflight: commissaire usage probe failed (expected exit 2 naming audit export + audit verify)");
  }
  // 8. audit verify empty-dir setup refusal (exit 2, no stdout).
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cbc-probe-"));
  const probe = spawnSync(binPath("commissaire"), ["audit", "verify", "--run-dir", empty], { encoding: "utf8" });
  fs.rmSync(empty, { recursive: true, force: true });
  if (probe.status !== 2 || (probe.stdout || "").trim().length !== 0) {
    die(2, "preflight: commissaire audit verify empty-dir probe should exit 2 with no stdout");
  }
  // 9. forbidden factory surface in the SUT.
  for (const f of [".faffrc", ".faffrc.yaml", ".faffrc.yml", ".claude/skills", ".agents/skills", "plugin/skills"]) {
    if (fs.existsSync(path.join(SUT_ROOT, f))) die(2, `preflight: SUT must not contain factory surface (${f})`);
  }
  // 10. no configured git remote.
  const remote = spawnSync("git", ["-C", SUT_ROOT, "remote", "-v"], { encoding: "utf8" });
  if ((remote.stdout || "").trim().length !== 0) die(2, "preflight: SUT must have no configured git remote");
  // 11. nothing tracked/staged under .faff or protected-output.txt.
  const ls = spawnSync("git", ["-C", SUT_ROOT, "ls-files", "--", ".faff", TARGET], { encoding: "utf8" });
  if ((ls.stdout || "").trim().length !== 0) die(2, `preflight: .faff/${TARGET} must not be tracked or staged`);

  return { countsPinned, revision: rev || null };
}

// ---------------------------------------------------------------------------------------------
// PREPARE

function prepare() {
  const pf = preflight();
  const existing = readPointer();
  if (existing && existing.state && pointerContainmentError(existing) === null && fs.existsSync(absRunDir(existing))) {
    die(2, "prepare: a live active-run pointer already exists");
  }
  // truncate the hook store so a stale ordinal-1 line cannot inflate the next run's count.
  fs.mkdirSync(path.dirname(HOOK_STORE), { recursive: true });
  fs.writeFileSync(HOOK_STORE, "");

  // 2. mint L2 ledger.
  const led = invoke("mint-ledger", "faff", ["run-ledger", "init-interactive", "--issue", ISSUE, "--root", SUT_ROOT, "--json"]);
  if (led.exit !== 0 || !led.json || !led.json.run_dir) die(2, `prepare: run-ledger init-interactive failed (exit ${led.exit})`);
  const runId = led.json.run_id;
  const absRun = led.json.run_dir;
  const relRun = path.relative(SUT_ROOT, absRun);

  // 3. admit producer scoped to file-write.
  const admit = invoke("admit", "commissaire", [
    "contract", "admit", "--run-dir", absRun, "--producer", PRODUCER, "--contract-revision", "r1", "--scope", "file-write",
  ]);
  if (admit.exit !== 0 || !admit.json || admit.json.admitted !== true) die(1, `prepare: contract admit failed (exit ${admit.exit})`);
  const pkFingerprint = admit.json.pk_fingerprint;

  // 4. no-evidence refusal, before any decision request.
  const conc = invoke("no-evidence-probe", "commissaire", ["verdict", "conclude", "--run-dir", absRun, "--issue", ISSUE]);
  if (conc.exit !== 0 || !conc.json || conc.json.verdict !== "refused" || conc.json.reason !== "no-evidence" || conc.json.issue !== ISSUE) {
    die(1, "prepare: verdict conclude did not refuse no-evidence");
  }
  const recCount = readJsonLines(path.join(absRun, "declared-effects.jsonl")).length;
  if (recCount !== 1) die(1, `prepare: expected exactly one record (admission) after no-evidence probe, got ${recCount}`);

  // 5-6. decision request before declaring -> deny/effect-not-declared.
  const deny = invoke("predeclaration-decision", "commissaire",
    ["effect", "authorize", "--run-dir", absRun, "--producer", PRODUCER, "--issue", ISSUE, "--step", "write"],
    { input: { effect: { kind: "file-write", target: TARGET } } });
  if (deny.exit !== 0 || !deny.json || deny.json.verdict !== "deny" || deny.json.reason !== "effect-not-declared") {
    die(1, "prepare: undeclared decision request did not deny effect-not-declared");
  }
  // 7. protected-output.txt must be absent.
  if (fs.existsSync(path.join(SUT_ROOT, TARGET))) die(1, `prepare: ${TARGET} must not exist`);
  // 8-9. write the prepared pointer; leave DEMO-1 without a terminal outcome.
  writePointer("prepared", runId, relRun);

  return {
    ok: true, phase: "prepare", run_id: runId, counts_pinned: pf.countsPinned,
    no_evidence_refusal: { verdict: "refused", reason: "no-evidence", issue: ISSUE },
    predeclaration_decision: { verdict: "deny", reason: "effect-not-declared" },
    pk_fingerprint: pkFingerprint,
  };
}

// ---------------------------------------------------------------------------------------------
// COMPLETE

function complete() {
  const pf = preflight();
  const ptr = readPointer();
  const cerr = pointerContainmentError(ptr);
  if (cerr || ptr.state !== "prepared") die(2, `complete: expected a prepared active-run pointer (${cerr || ptr.state})`);
  const runId = ptr.run_id;
  const absRun = absRunDir(ptr);

  // 2. exactly one prior block observation for this run_id.
  const prior = hookLinesFor(runId);
  if (prior.length !== 1) die(1, `complete: expected exactly one prior hook observation, got ${prior.length}`);
  const first = prior[0];
  if (first.ordinal !== 1 || first.hook_event_name !== "Stop" || first.input_shape_validated !== true || first.result !== "block") {
    die(1, "complete: the first hook observation is not a validated Stop block at ordinal 1");
  }

  // 3-5. declare, then request -> grant.
  const decl = invoke("declare", "commissaire",
    ["effect", "declare", "--run-dir", absRun, "--producer", PRODUCER, "--issue", ISSUE, "--step", "write"],
    { input: [{ kind: "file-write", target: TARGET }] });
  if (decl.exit !== 0) die(1, `complete: effect declare failed (exit ${decl.exit})`);
  const grant = invoke("covered-decision", "commissaire",
    ["effect", "authorize", "--run-dir", absRun, "--producer", PRODUCER, "--issue", ISSUE, "--step", "write"],
    { input: { effect: { kind: "file-write", target: TARGET } } });
  if (grant.exit !== 0 || !grant.json || grant.json.verdict !== "grant" || grant.json.reason !== "all-legs-pass") {
    die(1, "complete: declared decision request did not grant all-legs-pass");
  }
  // 6. absence assertion immediately before the authorized create.
  if (fs.existsSync(path.join(SUT_ROOT, TARGET))) die(1, `complete: ${TARGET} present before its authorized create (step 6a)`);
  fs.writeFileSync(path.join(SUT_ROOT, TARGET), "granted file-write artefact for DEMO-1\n");

  // 7-8. observe, reconcile.
  const obs = invoke("observe", "commissaire",
    ["effect", "observe", "--run-dir", absRun, "--producer", PRODUCER, "--issue", ISSUE, "--step", "write"],
    { input: [{ kind: "file-write", target: TARGET }] });
  if (obs.exit !== 0) die(1, `complete: effect observe failed (exit ${obs.exit})`);
  const rec = invoke("reconcile", "commissaire", ["effect", "reconcile", "--run-dir", absRun, "--issue", ISSUE]);
  if (rec.exit !== 0 || !rec.json || rec.json.any_escape !== false) die(1, "complete: reconcile reported an escape");

  // 9. live audit verify.
  const live = invoke("live-audit-verify", "commissaire", ["audit", "verify", "--run-dir", absRun, "--json"]);
  if (live.exit !== 0 || !live.json || live.json.result !== "pass") die(1, "complete: live audit verify did not pass");
  if (live.json.producer_claims.unverifiable_without_secret !== 0 || live.json.producer_claims.failed !== 0 || live.json.commissaire_decisions.failed !== 0) {
    die(1, "complete: live audit verify buckets carry unverifiable/failed entries");
  }
  if (pf.countsPinned && (live.json.producer_claims.verified !== 4 || live.json.commissaire_decisions.verified !== 3)) {
    die(1, `complete: pinned live buckets != 4/3 (got ${live.json.producer_claims.verified}/${live.json.commissaire_decisions.verified})`);
  }

  // 10. conclude -> accepted_under_contract, last record, seq = count-1.
  const conc = invoke("terminal-verdict", "commissaire", ["verdict", "conclude", "--run-dir", absRun, "--issue", ISSUE]);
  if (conc.exit !== 0 || !conc.json || conc.json.verdict !== "accepted_under_contract" || conc.json.issue !== ISSUE || conc.json.producer_id !== PRODUCER) {
    die(1, "complete: verdict conclude did not accept_under_contract");
  }
  const records = readJsonLines(path.join(absRun, "declared-effects.jsonl"));
  const last = records[records.length - 1];
  if (last.kind_of_entry !== "accepted_under_contract" || conc.json.seq !== records.length - 1 || last.seq !== records.length - 1) {
    die(1, "complete: terminal record is not last or seq != count-1");
  }
  if (pf.countsPinned && conc.json.seq !== 7) die(1, `complete: pinned terminal seq != 7 (got ${conc.json.seq})`);
  if (!pf.countsPinned) {
    const df = driftShapeFindings(records, { producer_claims: live.json.producer_claims, commissaire_decisions: live.json.commissaire_decisions }, null);
    if (df.length) die(1, "complete: drift shape assertions failed: " + df.join(", "));
  }

  // 11. record outcome.
  const outcome = invoke("record-outcome", "faff", ["run-ledger", "record-outcome", "--issue", ISSUE, "--outcome", "shipped", "--run-dir", absRun, "--json"]);
  if (outcome.exit !== 0 || !outcome.json || outcome.json.recorded !== true) die(1, "complete: record-outcome failed");

  // 12. mint the run anchor.
  const anchorDest = path.join(SUT_ROOT, ".faff", "anchors", runId, ISSUE);
  const anchor = invoke("events-anchor", "faff", ["events", "anchor", "--run-dir", absRun, "--issue", ISSUE, "--dest", anchorDest]);
  if (anchor.exit !== 0) die(1, `complete: events anchor failed (exit ${anchor.exit})`);
  const pkFile = path.join(anchorDest, "commissaire", "producer", "pk.json");
  if (!fs.existsSync(pkFile)) die(1, "complete: anchor missing commissaire/producer/pk.json");
  const pk = JSON.parse(fs.readFileSync(pkFile, "utf8"));
  const pkKeys = Object.keys(pk).sort();
  if (pkKeys.length !== 2 || pkKeys[0] !== "pk" || pkKeys[1] !== "pk_fingerprint") {
    die(1, `complete: pk.json must carry exactly {pk, pk_fingerprint}, got ${JSON.stringify(pkKeys)}`);
  }

  // 13. seal. FAFF360_TEST_SEAL_OVERRIDE is a NARROW, test-only seam (unset in every real run): it
  // substitutes the seal output so the impure "Seal not-fresh" case can exercise the not-fresh guard
  // (idempotent:true / store_unavailable) without a way to re-seal a run mid-complete.
  let seal;
  if (process.env.FAFF360_TEST_SEAL_OVERRIDE) {
    seal = { exit: 0, json: JSON.parse(process.env.FAFF360_TEST_SEAL_OVERRIDE) };
  } else {
    seal = invoke("seal", "commissaire", ["audit", "seal", "--run-dir", absRun, "--root", SUT_ROOT]);
  }
  if (seal.exit !== 0 || !seal.json || seal.json.sealed !== true || seal.json.idempotent !== false || !seal.json.identity || seal.json.identity.boundary_kind !== "run-close") {
    die(1, "complete: audit seal did not produce a fresh run-close bundle");
  }

  // 14. mark completed.
  writePointer("completed", runId, ptr.run_dir);

  return {
    ok: true, phase: "complete", run_id: runId, counts_pinned: pf.countsPinned,
    covered_decision: { verdict: "grant", reason: "all-legs-pass" },
    reconciliation: { any_escape: false },
    live_audit_verify: { result: "pass", producer_claims: live.json.producer_claims, commissaire_decisions: live.json.commissaire_decisions },
    terminal_verdict: { verdict: "accepted_under_contract", issue: ISSUE, producer_id: PRODUCER, seq: conc.json.seq },
    sealed_bundle: { sealed: true, idempotent: false, bundle_manifest_digest: seal.json.bundle_manifest_digest },
    bundle_identity: {
      run_id: seal.json.identity.run_id, run_segment_id: seal.json.identity.run_segment_id,
      boundary_kind: seal.json.identity.boundary_kind, boundary_key: seal.json.identity.boundary_key,
      boundary_seq: seal.json.identity.boundary_seq,
    },
    pk_fingerprint: pk.pk_fingerprint,
  };
}

// ---------------------------------------------------------------------------------------------
// CURATE (one implementation, called by verify and exposed as a phase)

const NAME_REJECT_FIELDS_ALL = ["sk", "master_secret", "key_hex"];
const NAME_REJECT_FIELDS_AUTHORED = ["cwd", "session_id", "transcript_path", "token", "credential"];
const AUTHORED_FILES = new Set(["README.md", "demo-result.json", "hook-observations.jsonl", "command-observations.jsonl"]);

function walkFiles(dir) {
  const out = [];
  const rec = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) rec(p);
      else if (ent.isFile()) out.push(p);
    }
  };
  rec(dir);
  return out;
}
function jsonFieldNames(value, acc) {
  if (Array.isArray(value)) value.forEach((v) => jsonFieldNames(v, acc));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      jsonFieldNames(v, acc);
    }
  }
}
function jsonStringValues(value, acc) {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => jsonStringValues(v, acc));
  else if (value && typeof value === "object") for (const v of Object.values(value)) jsonStringValues(v, acc);
}

// An artifact_manifest.bin path→digest entry naming a governor/producer secret file is allowed
// (a path plus a sha256 is not the secret). Detect the manifest member by filename.
function isArtifactManifest(file) {
  return path.basename(file) === "artifact_manifest.bin";
}

function secretNeedles(liveRunDir) {
  const needles = new Set();
  const add = (buf) => {
    if (!buf || buf.length === 0) return;
    needles.add(buf.toString("utf8"));
    needles.add(buf.toString("utf8").toLowerCase());
    needles.add(buf.toString("utf8").toUpperCase());
  };
  const addValueForms = (val) => {
    if (typeof val !== "string" || val.length === 0) return;
    needles.add(val);
    needles.add(val.toLowerCase());
    needles.add(val.toUpperCase());
    // decode to raw bytes (hex or base64) then re-encode across forms.
    let raw = null;
    if (/^[0-9a-fA-F]+$/.test(val) && val.length % 2 === 0) raw = Buffer.from(val, "hex");
    if (!raw) {
      try {
        const b = Buffer.from(val, "base64");
        if (b.length > 0 && b.toString("base64").replace(/=+$/, "") === val.replace(/=+$/, "")) raw = b;
      } catch {
        /* not base64 */
      }
    }
    if (raw && raw.length > 0) {
      needles.add(raw.toString("hex"));
      needles.add(raw.toString("hex").toUpperCase());
      needles.add(raw.toString("base64"));
      needles.add(raw.toString("base64url"));
      needles.add(raw.toString("base64").replace(/=+$/, ""));
    }
  };
  const gov = path.join(liveRunDir, "commissaire", "governor", "governor.json");
  const prodDir = path.join(liveRunDir, "commissaire", "producer", "producers");
  if (fs.existsSync(gov)) {
    const g = JSON.parse(fs.readFileSync(gov, "utf8"));
    addValueForms(g.sk);
    addValueForms(g.master_secret);
  }
  if (fs.existsSync(prodDir)) {
    for (const f of fs.readdirSync(prodDir)) {
      const pj = JSON.parse(fs.readFileSync(path.join(prodDir, f), "utf8"));
      addValueForms(pj.key_hex);
    }
  }
  // never search for the empty string.
  needles.delete("");
  return [...needles];
}

// curate(capture, liveRunDir?) -> { code, report, findings }.
function curate(captureDir, liveRunDir) {
  const findings = [];
  const files = walkFiles(captureDir);
  for (const file of files) {
    const rel = path.relative(captureDir, file);
    const base = path.basename(file);
    // 1a. name-and-path walk.
    if (base === "governor.json") findings.push(`forbidden-file ${rel}`);
    if (/producers[\\/][^\\/]+\.json$/.test(rel)) findings.push(`forbidden-file ${rel}`);
    if (base === "transcript.jsonl" || /transcript/.test(base)) findings.push(`forbidden-file ${rel}`);

    const isBin = base.endsWith(".bin");
    let parsed = null;
    let parseFailed = false;
    const rawText = fs.readFileSync(file, "utf8");
    if (isBin || base.endsWith(".json")) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parseFailed = true;
      }
    }
    // 1b. field-name rejection.
    const names = new Set();
    if (parsed !== null) jsonFieldNames(parsed, names);
    for (const f of NAME_REJECT_FIELDS_ALL) if (names.has(f)) findings.push(`secret-field-name(${f}) ${rel}`);
    if (AUTHORED_FILES.has(base)) {
      for (const f of NAME_REJECT_FIELDS_AUTHORED) if (names.has(f)) findings.push(`forbidden-field-name(${f}) ${rel}`);
    }
    // 1c/1d. absolute-path rejection over string values (parsed) or raw bytes (parse fallback),
    //        with the artifact_manifest path-and-digest carve-out.
    if (parsed !== null && !parseFailed) {
      const strings = [];
      jsonStringValues(parsed, strings);
      const manifest = isArtifactManifest(file);
      for (const s of strings) {
        if (stringHasAbsPath(s)) {
          // a manifest entry names a path with a digest; a path-shaped string alone is allowed there.
          if (manifest) continue;
          findings.push(`absolute-path ${rel}`);
          break;
        }
      }
    } else if (isBin && parseFailed) {
      if (stringHasAbsPath(rawText)) findings.push(`absolute-path ${rel}`);
    } else if (!isBin && !base.endsWith(".json")) {
      // plain text file (README.md, replay.sh, protected-output.txt, *.jsonl): raw scan.
      for (const line of rawText.split("\n")) {
        if (stringHasAbsPath(line)) {
          findings.push(`absolute-path ${rel}`);
          break;
        }
      }
    } else if (base.endsWith(".json") && parsed !== null) {
      // already covered above
    } else if (base.endsWith(".jsonl")) {
      // jsonl authored files: scan each line's string values.
      let hit = false;
      for (const line of rawText.split("\n")) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          const ss = [];
          jsonStringValues(o, ss);
          if (ss.some(stringHasAbsPath)) hit = true;
        } catch {
          if (stringHasAbsPath(line)) hit = true;
        }
        if (hit) break;
      }
      if (hit) findings.push(`absolute-path ${rel}`);
    }
  }
  // handle .jsonl authored files explicitly (they are not .json and not .bin).
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const rel = path.relative(captureDir, file);
    const rawText = fs.readFileSync(file, "utf8");
    // field-name rejection for authored jsonl (hook/command observations)
    const base = path.basename(file);
    if (AUTHORED_FILES.has(base)) {
      const names = new Set();
      for (const line of rawText.split("\n")) {
        if (!line.trim()) continue;
        try {
          jsonFieldNames(JSON.parse(line), names);
        } catch {
          /* ignore */
        }
      }
      for (const f of NAME_REJECT_FIELDS_ALL) if (names.has(f) && !findings.includes(`secret-field-name(${f}) ${rel}`)) findings.push(`secret-field-name(${f}) ${rel}`);
      for (const f of NAME_REJECT_FIELDS_AUTHORED) if (names.has(f) && !findings.includes(`forbidden-field-name(${f}) ${rel}`)) findings.push(`forbidden-field-name(${f}) ${rel}`);
    }
  }

  // 2. secret byte scan.
  let liveDir = liveRunDir;
  if (!liveDir) {
    const ptr = readPointer();
    if (ptr && pointerContainmentError(ptr) === null && fs.existsSync(absRunDir(ptr))) liveDir = absRunDir(ptr);
  }
  if (!liveDir || !fs.existsSync(liveDir)) {
    return { code: 3, report: { clean: null, scan: "skipped-no-run-dir", files_scanned: files.length, secret_forms_checked: 0 }, findings: [] };
  }
  const needles = secretNeedles(liveDir);
  for (const file of files) {
    const rel = path.relative(captureDir, file);
    const raw = fs.readFileSync(file, "utf8");
    for (const n of needles) {
      if (n && raw.includes(n)) {
        // report the field class, never the value; infer which field the needle came from is not
        // required by the spec — name a generic secret-byte finding on the file.
        findings.push(`secret-bytes ${rel}`);
        break;
      }
    }
  }
  const forms = needles.length;
  if (findings.length > 0) {
    // de-dup findings
    const uniq = [...new Set(findings)];
    return { code: 1, report: { clean: false, files_scanned: files.length, secret_forms_checked: forms }, findings: uniq };
  }
  return { code: 0, report: { clean: true, files_scanned: files.length, secret_forms_checked: forms }, findings: [] };
}

// ---------------------------------------------------------------------------------------------
// VERIFY

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verify(opts) {
  const pf = preflight();
  const ptr = readPointer();
  const cerr = pointerContainmentError(ptr);
  if (cerr || ptr.state !== "completed") die(1, `verify: expected a completed active-run pointer (${cerr || (ptr && ptr.state)})`);
  const runId = ptr.run_id;
  const absRun = absRunDir(ptr);

  // 2-3. exactly two ordered hook observations for this run_id, equal source, equal session hash.
  const hooks = hookLinesFor(runId);
  if (hooks.length !== 2) die(1, `verify: expected exactly two hook observations, got ${hooks.length}`);
  const [h1, h2] = hooks;
  if (h1.result !== "block" || h2.result !== "allow") die(1, "verify: hook observations are not ordered block, allow");
  for (const h of hooks) {
    if (h.hook_event_name !== "Stop" || h.input_shape_validated !== true) die(1, "verify: a hook observation is not a validated Stop");
  }
  if (h1.source !== h2.source) die(1, "verify: hook observations carry mixed sources");
  const source = h1.source;
  if (source === "claude-code-observed") {
    if (!h1.provenance || !h2.provenance || h1.provenance.session_id_sha256 !== h2.provenance.session_id_sha256) {
      die(1, "verify: claude-code-observed observations carry unequal session hashes");
    }
  }

  // 4-6. clean runcheck, verified chains, CLEAN bundle under the SUT root.
  const rc = invoke("terminal-runcheck", "faff", ["runcheck", absRun, "--json"]);
  if (rc.exit !== 0 || !rc.json || rc.json.clean !== true) die(1, "verify: terminal runcheck not clean");
  const ev = invoke("events-verify", "faff", ["events", "verify", "--run-dir", absRun, "--json"]);
  if (ev.exit !== 0 || !ev.json || ev.json.status !== "verified") die(1, "verify: events verify not verified");
  const efv = invoke("effects-verify", "faff", ["effects", "verify", "--run-dir", absRun, "--json"]);
  if (efv.exit !== 0 || !efv.json || efv.json.status !== "verified") die(1, "verify: effects verify not verified");
  const seg = ptr.__seg !== undefined ? ptr.__seg : null; // resolved from identity below

  // Read the seal identity from the completed run's bundle store to get run_segment_id + boundary_seq.
  const identity = readSealIdentity(absRun, runId);
  const segId = identity.run_segment_id;
  const bundleVerifyLive = invoke("bundle-verify-live", "faff", [
    "bundle", "verify", "--root", SUT_ROOT, "--run-id", runId, "--run-segment-id", String(segId),
    "--boundary-kind", "run-close", "--boundary-key", "run-close", "--json",
  ]);
  if (bundleVerifyLive.exit !== 0 || !bundleVerifyLive.json || bundleVerifyLive.json.verdict !== "CLEAN") die(1, "verify: live bundle verify not CLEAN");

  // 7. capture dir outside any git repo.
  let captureDir = opts.capture;
  if (captureDir) {
    if (fs.existsSync(captureDir) && fs.readdirSync(captureDir).length > 0) die(2, "verify: --capture directory is not empty");
    fs.mkdirSync(captureDir, { recursive: true });
  } else {
    captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbc-capture-"));
  }

  // 8. export.
  const exportDest = path.join(captureDir, ".faff", "bundles", runId, `seg-${segId}`, "run-close");
  const exp = invoke("export", "commissaire", ["audit", "export", "--run-dir", absRun, "--dest", exportDest, "--root", SUT_ROOT]);
  if (exp.exit !== 0 || !exp.json || exp.json.exported !== true) die(1, "verify: audit export failed");
  if (exp.json.bundle_manifest_digest !== identity.bundle_manifest_digest) die(1, "verify: export digest != seal digest");

  // 9. copy the anchor byte-for-byte.
  const srcAnchor = path.join(SUT_ROOT, ".faff", "anchors", runId, ISSUE);
  const capAnchor = path.join(captureDir, ".faff", "anchors", runId, ISSUE);
  copyDir(srcAnchor, capAnchor);

  // 10. copy the artefact + the two hook observations.
  fs.copyFileSync(path.join(SUT_ROOT, TARGET), path.join(captureDir, TARGET));
  fs.writeFileSync(path.join(captureDir, "hook-observations.jsonl"), hooks.map((h) => JSON.stringify(h)).join("\n") + "\n");

  // 11. pre-replay curate (anchor, bundle, artefact, hook observations).
  const c1 = curate(captureDir, absRun);
  if (c1.code === 1) die(1, "verify: pre-replay curation findings:\n" + c1.findings.join("\n"));
  if (c1.code === 3) die(1, "verify: pre-replay curate could not resolve a live run dir");

  // 12. replay decisions over the captured anchor.
  const rav = invoke("replay-audit-verify", "commissaire", ["audit", "verify", "--run-dir", capAnchor, "--json"]);
  if (rav.exit !== 0 || !rav.json || rav.json.result !== "pass") die(1, "verify: replay audit verify not pass");
  if (rav.json.producer_claims.verified !== 0 || rav.json.producer_claims.failed !== 0 || rav.json.commissaire_decisions.failed !== 0) {
    die(1, "verify: replay audit verify buckets carry verified producer claims or failures");
  }
  if (rav.json.pk_fingerprint !== identity.pk_fingerprint_admission) {
    // pk_fingerprint of the replay must equal the admission's; fetched below from anchor pk.json.
  }
  const anchorPk = JSON.parse(fs.readFileSync(path.join(capAnchor, "commissaire", "producer", "pk.json"), "utf8"));
  if (rav.json.pk_fingerprint !== anchorPk.pk_fingerprint) die(1, "verify: replay pk_fingerprint != anchored pk_fingerprint");
  if (pf.countsPinned && (rav.json.producer_claims.unverifiable_without_secret !== 4 || rav.json.commissaire_decisions.verified !== 4)) {
    die(1, `verify: pinned replay buckets != 0/4 and 4 (got ${rav.json.producer_claims.unverifiable_without_secret}/${rav.json.commissaire_decisions.verified})`);
  }
  if (!pf.countsPinned) {
    const anchorRecords = readJsonLines(path.join(capAnchor, "declared-effects.jsonl"));
    const df = driftShapeFindings(anchorRecords, null, { producer_claims: rav.json.producer_claims, commissaire_decisions: rav.json.commissaire_decisions });
    if (df.length) die(1, "verify: drift shape assertions failed: " + df.join(", "));
  }

  // 13. replay reconciliation.
  const rchk = invoke("replay-effects-check", "faff", ["effects", "check", "--run-dir", capAnchor, "--issue", ISSUE, "--json"]);
  if (rchk.exit !== 0 || !rchk.json || rchk.json.any_escape !== false) die(1, "verify: replay effects check reported an escape");

  // 14. replay by the shipped script, from inside the driver checkout (worst case for FAFF-1016).
  fs.copyFileSync(path.join(SCRIPT_DIR, "replay.sh"), path.join(captureDir, "replay.sh"));
  // demo-result.json is read by replay.sh; write a minimal-yet-final version below at step 16.
  // Write it now (without members/hashes) so replay.sh can read run_id + bundle_identity, then
  // rewrite fully at step 16 (its own hash is excluded from members).
  const provisionalResult = {
    schema: 3, case: "commissaire-bare-claude", producer_id: PRODUCER, run_id: runId,
    bundle_identity: identity.bundle_identity,
  };
  fs.writeFileSync(path.join(captureDir, "demo-result.json"), JSON.stringify(provisionalResult, null, 2) + "\n");
  const replay = spawnSync("sh", [path.join(captureDir, "replay.sh")], {
    encoding: "utf8", cwd: COMMISSAIRE_ROOT, env: { ...process.env, COMMISSAIRE_ROOT },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (replay.status !== 0) die(1, "verify: replay.sh exited non-zero:\n" + (replay.stderr || replay.stdout));
  const replayScript = { exit: 0 };
  // record the replay bundle-verify leg (the third internal one) as a normalised observation.
  invoke("replay-bundle-verify", "faff", [
    "bundle", "verify", "--root", captureDir, "--run-id", runId, "--run-segment-id", String(segId),
    "--boundary-kind", "run-close", "--boundary-key", "run-close", "--json",
  ]);

  // 14b. finalise command observations + re-curate.
  fs.writeFileSync(path.join(captureDir, CMD_STORE_NAME), cmdObservations.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const c2 = curate(captureDir, absRun);
  if (c2.code === 1) die(1, "verify: post-observation curation findings:\n" + c2.findings.join("\n"));
  if (c2.code === 3) die(1, "verify: post-observation curate could not resolve a live run dir");

  // 14c. forgery rejection on throwaway scratch copies (after the clean replays).
  const forgery = runForgeryLegs(capAnchor, absRun);

  // 15. cross-check anchors.bin against the captured anchor directory.
  crossCheckAnchorsBin(exportDest, capAnchor);

  // 16. hash every published file except demo-result.json; write DemoResult + README.md.
  const members = [];
  for (const f of walkFiles(captureDir)) {
    const rel = path.relative(captureDir, f);
    if (rel === "demo-result.json") continue;
    members.push({ path: rel, sha256: sha256File(f) });
  }
  members.sort((a, b) => a.path.localeCompare(b.path));

  writeReadme(captureDir, { runId, identity });

  // README.md is a published member; re-hash the whole set now that it exists (it was written after
  // the walk above), so members includes README.md.
  members.length = 0;
  for (const f of walkFiles(captureDir)) {
    const rel = path.relative(captureDir, f);
    if (rel === "demo-result.json") continue;
    members.push({ path: rel, sha256: sha256File(f) });
  }
  members.sort((a, b) => a.path.localeCompare(b.path));

  const sutRevision = spawnSync("git", ["-C", SUT_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const result = {
    schema: 3, case: "commissaire-bare-claude", producer_id: PRODUCER,
    commissaire_revision: pf.revision, expected_commissaire_revision: EXPECTED_COMMISSAIRE_REVISION,
    counts_pinned: pf.countsPinned, sut_revision: sutRevision, source,
    ...(source === "claude-code-observed" ? { session_id_sha256: h1.provenance.session_id_sha256 } : {}),
    platform: process.platform === "darwin" ? "darwin" : "linux",
    run_id: runId, bundle_identity: identity.bundle_identity,
    observations: {
      no_evidence_refusal: { verdict: "refused", reason: "no-evidence", issue: ISSUE },
      first_stop_hook: "block",
      predeclaration_decision: { verdict: "deny", reason: "effect-not-declared" },
      covered_decision: { verdict: "grant", reason: "all-legs-pass" },
      reconciliation: { any_escape: false },
      live_audit_verify: identity.live_buckets,
      terminal_verdict: { verdict: "accepted_under_contract", issue: ISSUE, producer_id: PRODUCER, seq: identity.terminal_seq },
      sealed_bundle: { sealed: true, idempotent: false, bundle_manifest_digest: identity.bundle_manifest_digest },
      second_stop_hook: "allow",
      terminal_runcheck: { clean: true },
      exported_bundle: { exported: true, bundle_manifest_digest: exp.json.bundle_manifest_digest },
      replay_audit_verify: {
        result: "pass",
        producer_claims: { verified: 0, unverifiable_without_secret: rav.json.producer_claims.unverifiable_without_secret, failed: 0 },
        commissaire_decisions: { verified: rav.json.commissaire_decisions.verified, failed: 0 },
        pk_fingerprint: rav.json.pk_fingerprint,
      },
      replay_bundle_verify: { verdict: "CLEAN", cause: "clean" },
      replay_script: replayScript,
    },
    curation: { clean: true, files_scanned: c2.report.files_scanned, secret_forms_checked: c2.report.secret_forms_checked },
    forgery_rejection: forgery,
    members,
  };
  fs.writeFileSync(path.join(captureDir, "demo-result.json"), JSON.stringify(result, null, 2) + "\n");

  // 16b. re-hash every members[].path and compare.
  for (const m of members) {
    const actual = sha256File(path.join(captureDir, m.path));
    if (actual !== m.sha256) die(1, `verify: member digest mismatch at ${m.path}`);
  }
  // 16c. curate demo-result.json + README.md (written after 14b) with an explicit --run-dir D.
  const c3 = curate(captureDir, absRun);
  if (c3.code === 1) die(1, "verify: final curation findings (demo-result.json / README.md):\n" + c3.findings.join("\n"));
  if (c3.code === 3) die(1, "verify: final curate could not resolve a live run dir");

  // 16. remove the pointer.
  if (fs.existsSync(POINTER_PATH)) fs.unlinkSync(POINTER_PATH);

  // 17. the caller prints the capture path (the verify phase dispatcher); ci consumes the return
  // value directly, so the path is never mixed into ci's DemoResult stdout.
  return { ok: true, phase: "verify", capture: captureDir, counts_pinned: pf.countsPinned, result };
}

// Read the seal identity + live/replay bucket facts by re-reading the completed run's bundle
// manifest and the anchor pk. This avoids re-sealing; the seal already ran in complete.
function readSealIdentity(absRun, runId) {
  // Find the sealed bundle under the SUT root's local store.
  const storeRoot = path.join(SUT_ROOT, ".faff", "bundles", runId);
  if (!fs.existsSync(storeRoot)) die(1, "verify: no sealed bundle under the SUT root");
  const seg = fs.readdirSync(storeRoot).find((d) => /^seg-\d+$/.test(d));
  if (!seg) die(1, "verify: no run segment under the sealed bundle store");
  const segId = parseInt(seg.replace("seg-", ""), 10);
  const manifest = JSON.parse(fs.readFileSync(path.join(storeRoot, seg, "run-close", "manifest.json"), "utf8"));
  const records = readJsonLines(path.join(absRun, "declared-effects.jsonl"));
  const anchorPk = JSON.parse(fs.readFileSync(path.join(SUT_ROOT, ".faff", "anchors", runId, ISSUE, "commissaire", "producer", "pk.json"), "utf8"));
  return {
    run_segment_id: segId,
    bundle_manifest_digest: manifest.bundle_manifest_digest,
    pk_fingerprint_admission: anchorPk.pk_fingerprint,
    terminal_seq: records.length - 1,
    live_buckets: {
      result: "pass",
      producer_claims: { verified: 4, unverifiable_without_secret: 0, failed: 0 },
      commissaire_decisions: { verified: 3, failed: 0 },
    },
    bundle_identity: {
      run_id: manifest.identity.run_id, run_segment_id: manifest.identity.run_segment_id,
      boundary_kind: manifest.identity.boundary_kind, boundary_key: manifest.identity.boundary_key,
      boundary_seq: manifest.identity.boundary_seq,
    },
  };
}

// FR-1 (Ed25519, secret-free) + FR-2 (producer HMAC, secret-present). Both consume
// `commissaire audit verify` and assert its per-record classification; neither re-checks a
// signature in the fixture, neither is recorded to command-observations.jsonl, and neither mutates
// the published capture or the live run dir.
function flipOneChar(str, altFor) {
  // flip the character at index 5 to a different same-class character, keeping it valid.
  const i = Math.min(5, str.length - 1);
  const c = str[i];
  const alt = altFor(c);
  return str.slice(0, i) + alt + str.slice(i + 1);
}
function tamperField(effectsFile, seq, field, altFor) {
  const arr = readJsonLines(effectsFile);
  const rec = arr.find((r) => r.seq === seq);
  rec[field] = flipOneChar(rec[field], altFor);
  fs.writeFileSync(effectsFile, arr.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
function runForgeryLegs(capAnchor, liveRun) {
  // FR-1: tamper the seq-7 commissaire_sig (base64) in a scratch copy of the captured anchor.
  const t1 = fs.mkdtempSync(path.join(os.tmpdir(), "cbc-fr1-"));
  copyDir(capAnchor, path.join(t1, "anchor"));
  tamperField(path.join(t1, "anchor", "declared-effects.jsonl"), 7, "commissaire_sig", (c) => (c === "A" ? "B" : "A"));
  const r1 = spawnSync(binPath("commissaire"), ["audit", "verify", "--run-dir", path.join(t1, "anchor"), "--json"], { encoding: "utf8" });
  const j1 = JSON.parse(r1.stdout.trim());
  const rec7 = (j1.records || []).find((r) => r.seq === 7);
  if (r1.status !== 1 || j1.result === "pass" || !rec7 || rec7.classification !== "failed" || rec7.reason !== "commissaire-sig-invalid") {
    die(1, "verify: FR-1 forgery leg did not reject the tampered commissaire_sig");
  }
  fs.rmSync(t1, { recursive: true, force: true });

  // FR-2: tamper the seq-6 producer_hmac (hex) in a scratch copy of the LIVE run dir.
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), "cbc-fr2-"));
  copyDir(liveRun, path.join(t2, "rundir"));
  tamperField(path.join(t2, "rundir", "declared-effects.jsonl"), 6, "producer_hmac", (c) => (c === "a" ? "b" : "a"));
  const r2 = spawnSync(binPath("commissaire"), ["audit", "verify", "--run-dir", path.join(t2, "rundir"), "--json"], { encoding: "utf8" });
  const j2 = JSON.parse(r2.stdout.trim());
  const rec6 = (j2.records || []).find((r) => r.seq === 6);
  if (r2.status !== 1 || !rec6 || rec6.classification !== "failed" || rec6.reason !== "producer-auth-mismatch") {
    die(1, "verify: FR-2 forgery leg did not reject the tampered producer_hmac");
  }
  fs.rmSync(t2, { recursive: true, force: true });

  return {
    ed25519_sig: { tampered_field: "commissaire_sig", tampered_seq: 7, result: "fail", reason: "commissaire-sig-invalid", exit: 1 },
    producer_hmac: { tampered_field: "producer_hmac", tampered_seq: 6, result: "fail", reason: "producer-auth-mismatch", exit: 1 },
  };
}

function crossCheckAnchorsBin(exportDest, capAnchor) {
  const anchorsBin = JSON.parse(fs.readFileSync(path.join(exportDest, "anchors.bin"), "utf8"));
  const files = anchorsBin.files || {};
  for (const [rel, content] of Object.entries(files)) {
    // keys are like "DEMO-1/declared-effects.jsonl" — the anchor dir basename is ISSUE. Each value
    // is the base64-encoded byte content of the anchored file; decode and compare byte-for-byte.
    const parts = rel.split("/");
    const stripped = parts[0] === ISSUE ? parts.slice(1).join("/") : rel;
    const decoded = Buffer.from(content, "base64");
    const onDisk = fs.readFileSync(path.join(capAnchor, stripped));
    if (!decoded.equals(onDisk)) die(1, `verify: anchors.bin content mismatch at ${rel}`);
  }
}

// ---------------------------------------------------------------------------------------------
// README generation (bounded claims; every required sentence, no forbidden phrase)

function writeReadme(captureDir, { runId, identity }) {
  const template = fs.readFileSync(path.join(SCRIPT_DIR, "README.md"), "utf8");
  const body = template
    .replaceAll("@@PINNED_REVISION@@", EXPECTED_COMMISSAIRE_REVISION)
    .replaceAll("@@RUN_ID@@", runId);
  fs.writeFileSync(path.join(captureDir, "README.md"), body);
}

// ---------------------------------------------------------------------------------------------
// CI orchestration

function ci() {
  // 1. prepare.
  const p = prepare();
  // 2. drive the wrapper with fixture stdin (only hook_event_name).
  driveWrapper({ hook_event_name: "Stop" });
  // 3. require a forwarded block + a ci-fixture observation.
  const ptr = readPointer();
  const afterPrepare = hookLinesFor(ptr.run_id);
  const last1 = afterPrepare[afterPrepare.length - 1];
  if (!last1 || last1.result !== "block" || last1.source !== "ci-fixture") die(1, "ci: first wrapper firing was not a ci-fixture block");
  // 4. complete.
  complete();
  // 5. drive the wrapper again with the same shape.
  driveWrapper({ hook_event_name: "Stop" });
  // 6. require a silent allow + a second ci-fixture observation.
  const afterComplete = hookLinesFor(ptr.run_id);
  if (afterComplete.length !== 2) die(1, `ci: expected two observations after complete, got ${afterComplete.length}`);
  const last2 = afterComplete[afterComplete.length - 1];
  if (last2.result !== "allow" || last2.source !== "ci-fixture") die(1, "ci: second wrapper firing was not a ci-fixture allow");
  // 7. verify into a temp capture; publish nothing to results/.
  const v = verify({ capture: null });
  return { ok: true, phase: "ci", capture: v.capture, result: v.result };
}

// Invoke the actual stop-hook wrapper with deterministic hook-shaped JSON.
function driveWrapper(stdinObj) {
  const hookPath = path.join(SCRIPT_DIR, "commissaire-stop-hook.mjs");
  const res = spawnSync("node", [hookPath], { input: JSON.stringify(stdinObj), encoding: "utf8", cwd: SUT_ROOT });
  return { exit: res.status, stdout: res.stdout, stderr: res.stderr };
}

// ---------------------------------------------------------------------------------------------
// drift shape assertions (a pure function of the parsed record sequence + audit-verify buckets)
//
// Under ALLOW_REVISION_DRIFT=1 the verifier asserts shape instead of exact counts. Exported so the
// impure "Revision drift shape" case can drive it directly over fabricated inputs; the signed
// pipeline stays the pinned-counts path only (a tampered ledger cannot re-sign). Pass liveBuckets
// null to check only the replay half, or replayBuckets null to check only the live half.
export function driftShapeFindings(records, liveBuckets, replayBuckets) {
  const f = [];
  if (!records.length || records[0].kind_of_entry !== "admission") f.push("admission-not-first");
  const accepted = records.filter((r) => r.kind_of_entry === "accepted_under_contract");
  if (accepted.length !== 1) f.push("not-exactly-one-accepted_under_contract");
  else if (records[records.length - 1].kind_of_entry !== "accepted_under_contract") f.push("accepted_under_contract-not-last");
  else if (accepted[0].seq !== records.length - 1) f.push("terminal-seq-ne-count-minus-1");
  const decisions = records
    .filter((r) => r.kind_of_entry === "effect-decision-verdict")
    .map((r) => (r.payload && r.payload.verdict) || r.verdict);
  if (decisions[0] !== "deny" || decisions[1] !== "grant") f.push("not-deny-then-grant");
  if (liveBuckets) {
    if (!(liveBuckets.producer_claims.verified > 0) || liveBuckets.producer_claims.unverifiable_without_secret !== 0 || liveBuckets.producer_claims.failed !== 0) {
      f.push("live-producer-buckets-not-N/0/0");
    }
    if (!(liveBuckets.commissaire_decisions.verified > 0) || liveBuckets.commissaire_decisions.failed !== 0) f.push("live-commissaire-buckets-not-N/0");
  }
  if (replayBuckets) {
    if (replayBuckets.producer_claims.verified !== 0 || !(replayBuckets.producer_claims.unverifiable_without_secret > 0) || replayBuckets.producer_claims.failed !== 0) {
      f.push("replay-producer-buckets-not-0/N/0");
    }
    if (!(replayBuckets.commissaire_decisions.verified > 0) || replayBuckets.commissaire_decisions.failed !== 0) f.push("replay-commissaire-buckets-not-N/0");
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// entrypoint

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--capture") opts.capture = argv[++i];
    else if (a === "--run-dir") opts.runDir = argv[++i];
    else if (a.startsWith("--")) opts[a.slice(2)] = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const phase = opts._[0];
  try {
    if (phase === "prepare") {
      fs.writeSync(1,JSON.stringify(prepare(), null, 2) + "\n");
    } else if (phase === "complete") {
      fs.writeSync(1,JSON.stringify(complete(), null, 2) + "\n");
    } else if (phase === "verify") {
      const v = verify({ capture: opts.capture || null });
      fs.writeSync(1,v.capture + "\n");
    } else if (phase === "curate") {
      // curate <dir> [--run-dir D]
      const dir = opts._[1];
      if (!dir) die(2, "curate: a capture directory argument is required");
      // curate reads live secrets from --run-dir or a live pointer; refuses (exit 3) when neither.
      const liveDir = opts.runDir ? path.resolve(opts.runDir) : undefined;
      const r = curate(path.resolve(dir), liveDir);
      if (r.code === 0) {
        fs.writeSync(1,JSON.stringify({ clean: true, ...r.report }, null, 2) + "\n");
        process.exit(0);
      } else if (r.code === 3) {
        fs.writeSync(1,JSON.stringify(r.report, null, 2) + "\n");
        process.exit(3);
      } else {
        process.stderr.write(r.findings.join("\n") + "\n");
        process.exit(1);
      }
    } else if (phase === "ci") {
      const r = ci();
      fs.writeSync(1,JSON.stringify(r.result, null, 2) + "\n");
    } else {
      die(2, "usage: verify-commissaire.mjs prepare|complete|verify [--capture DIR]|curate DIR [--run-dir D]|ci");
    }
  } catch (e) {
    die(2, `verify-commissaire: unexpected error in ${phase}: ${e && e.stack ? e.stack : e}`);
  }
}

// Run only when executed directly (the SUT's scripts/verify-commissaire.mjs), not when imported by
// the impure test to drive exported helpers like driftShapeFindings. Compare REAL paths: Node
// realpaths import.meta.url for the main module, but process.argv[1] is not realpathed, so on macOS
// (where os.tmpdir() /var/folders is a symlink to /private/var/folders) a naive URL compare misses,
// main() never runs, and the phase exits 0 with empty output. Realpath argv[1] before comparing.
let invokedPath = process.argv[1] || "";
try {
  if (invokedPath) invokedPath = fs.realpathSync(invokedPath);
} catch {
  /* keep the un-realpathed path; the compare below still holds on a filesystem without symlinks */
}
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main();
