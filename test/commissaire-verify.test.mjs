// FAFF-1178 — verify Commissaire grants against the key the seq-0 admission names. Covers the
// section-8 criteria: key binding to the admission (both custodies), the adversarial pk.json swap,
// demotion and copied-admission refusals, signed chain positions, the expected run id (input, anchor
// path, --run-id), `audit verify`'s trust flags and new fields, and the remote read with `gh` stubbed.
// Ledgers are hand-built with real Ed25519 keys, so no governor process is needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync, chmodSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import { mintGovernorKeypair, signDecision, buildEnvelope } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import { sha256Hex } from "../plugin/skills/faff/bin/lib/events.js";
import { verifyGrant, resolveAdmittedKey } from "../plugin/skills/faff/bin/lib/commissaire-verify.js";
import { verifyAuthLeg } from "../plugin/skills/faff/bin/lib/commissaire.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib");
const FIXTURE_ROOT = join(HERE, "fixtures", "commissaire", "secret-free-replay");
const LEDGER = "declared-effects.jsonl";
const MERGE = { kind: "merge", target: "main" };

const seenReasons = new Set();

// --- builders ---------------------------------------------------------------------------------

const sha = (s) => sha256Hex(Buffer.from(s, "utf8"));

function sealed(runId, seq, prev, kind, unit, step, payload, sk) {
  const rec = buildEnvelope(runId, seq, prev, "commissaire", "P1", "r1", { kind_of_entry: kind, unit_id: unit, step, payload });
  rec.commissaire_sig = signDecision(rec, sk);
  return rec;
}

// A hand-built governed run: one admission at seq 0, then whatever the test appends.
function mkRun({ runId = "RUN-V1", kp = mintGovernorKeypair(), custody = "governor", dirName = runId } = {}) {
  const root = mkdtempSync(join(tmpdir(), "com-verify-"));
  const runDir = join(root, dirName);
  mkdirSync(join(runDir, "commissaire", "producer"), { recursive: true });
  const lines = [];
  const run = {
    root, runDir, runId, kp, lines,
    prevHash: () => (lines.length === 0 ? sha(runId) : sha(lines[lines.length - 1])),
    add(kind, unit, step, payload, o = {}) {
      const rec = sealed(o.runId ?? runId, o.seq ?? lines.length, o.prev ?? run.prevHash(), kind, unit, step, payload, o.sk ?? kp.sk);
      lines.push(JSON.stringify(rec));
      return rec;
    },
    grant(o = {}) { return run.add("effect-decision-verdict", "FAFF-1", "merge", { verdict: o.verdict ?? "grant", effect: o.effect ?? MERGE }, o); },
    flush(tail = "") { writeFileSync(join(runDir, LEDGER), lines.map((l) => `${l}\n`).join("") + tail); },
    writePk(key = kp) { writeFileSync(join(runDir, "commissaire", "producer", "pk.json"), JSON.stringify({ pk: key.pk, pk_fingerprint: key.pk_fingerprint })); },
    rm() { rmSync(root, { recursive: true, force: true }); },
  };
  run.admission = run.add("admission", "-", "admit", {
    producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"], pk_fingerprint: kp.pk_fingerprint,
    admitted_at: "2026-01-01T00:00:00Z", ...(custody === "governor" ? { custody: "governor" } : {}),
  });
  run.writePk();
  return run;
}

const grantedRun = (opts) => { const run = mkRun(opts); run.grant(); run.flush(); return run; };

const trustFile = (fps, { present = true, requirePinned = false, source = "remote-base" } = {}) => ({
  read: { ok: true, value: { present, source, config: present ? { schema: 1, governorKeyFingerprints: fps, requirePinnedGovernor: requirePinned, pinChangeApprovers: [] } : null } },
});
const trustError = () => ({ read: { ok: false, error: { code: "trust-file-invalid", stage: "Parse", line: 1, reason: "bad", message: "trust-file-invalid: line 1: bad" } } });
const NOT_READ = { not_read: true };

function verify(run, trust, extra = {}) {
  const res = verifyGrant({ run_dir: run.runDir, unit_id: "FAFF-1", step: "merge", effect: MERGE, trust, ...extra });
  seenReasons.add(res.reason);
  return res;
}

// --- CLI helpers ------------------------------------------------------------------------------

const audit = (args, opts = {}) => runCli(["commissaire", "audit", "verify", ...args], opts);
const json = (r) => JSON.parse(r.stdout.trim());

// A temp git repo whose `main` carries .commissaire/trust.toml pinning the given fingerprints.
function trustRepo(fps, extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "com-verify-repo-"));
  const git = (...a) => { const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, ".commissaire"));
  writeFileSync(join(dir, ".commissaire", "trust.toml"), `schema = 1\ngovernor_key_fingerprints = [${fps.map((f) => `"${f}"`).join(", ")}]\n${extra}`);
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "trust");
  return dir;
}

// A stub `gh` on PATH. `mode`: "present" serves the trust file, "absent" is a provable 404, "down" is a 500.
function stubGh(toml, mode) {
  const dir = mkdtempSync(join(tmpdir(), "com-verify-gh-"));
  const log = join(dir, "calls.log");
  const body = JSON.stringify({ content: Buffer.from(toml, "utf8").toString("base64"), encoding: "base64" });
  const script = `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *" -i "*)
    case "${mode}" in down) printf 'HTTP/2.0 500 Server Error\\n\\n'; exit 1 ;; esac
    case "$*" in
      *contents.commissaire*|*.commissaire/trust.toml*) printf 'HTTP/2.0 404 Not Found\\n\\n'; exit 1 ;;
      *) printf 'HTTP/2.0 200 OK\\n\\n'; exit 0 ;;
    esac ;;
esac
case "${mode}" in
  present) printf '%s' '${body}'; exit 0 ;;
  absent) exit 1 ;;
  *) printf 'HTTP/2.0 500 Server Error\\n\\n'; exit 1 ;;
esac
`;
  writeFileSync(join(dir, "gh"), script);
  chmodSync(join(dir, "gh"), 0o755);
  return { dir, log, env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` }, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

// --- classification and the happy path --------------------------------------------------------

test("a genuine grant from a pinned governor is a valid-grant classified pinned", () => {
  const run = grantedRun();
  try {
    const res = verify(run, trustFile([run.kp.pk_fingerprint]));
    assert.deepEqual(
      { outcome: res.outcome, reason: res.reason, custody: res.custody, classification: res.classification, signer: res.signer_fingerprint, seq: res.verdict_seq, source: res.trust_source },
      { outcome: "valid-grant", reason: "valid-grant", custody: "governor", classification: "pinned", signer: run.kp.pk_fingerprint, seq: 1, source: "remote-base" },
    );
  } finally { run.rm(); }
});

test("classification: unlisted, absent file and not-read are unpinned; in-process custody is in-process; all still valid-grant", () => {
  const governor = grantedRun();
  const inProcess = grantedRun({ custody: "in-process" });
  try {
    const other = "f".repeat(64);
    for (const [label, trust, source] of [
      ["unlisted fingerprint", trustFile([other]), "remote-base"],
      ["trust file absent", trustFile([], { present: false }), "remote-base"],
      ["trust not read", NOT_READ, "not-read"],
    ]) {
      const res = verify(governor, trust);
      assert.equal(res.outcome, "valid-grant", label);
      assert.equal(res.classification, "unpinned", label);
      assert.equal(res.trust_source, source, label);
    }
    // a pin never upgrades in-process custody
    const res = verify(inProcess, trustFile([inProcess.kp.pk_fingerprint]));
    assert.deepEqual({ outcome: res.outcome, custody: res.custody, classification: res.classification }, { outcome: "valid-grant", custody: "in-process", classification: "in-process" });
  } finally { governor.rm(); inProcess.rm(); }
});

test("a trust-file read error on a governed run is trust-file-invalid under both custodies, with null classification and the bound key kept", () => {
  for (const custody of ["governor", "in-process"]) {
    const run = grantedRun({ custody });
    try {
      const res = verify(run, trustError());
      assert.equal(res.outcome, "absent-or-invalid");
      assert.equal(res.reason, "trust-file-invalid", custody);
      assert.equal(res.classification, null);
      const key = resolveAdmittedKey(run.runDir, trustError());
      assert.equal(key.failure, "trust-file-invalid");
      assert.equal(key.pk, run.kp.pk, "the bound key is kept so per-record results match in-process behaviour");
      assert.equal(key.signer_fingerprint, run.kp.pk_fingerprint);
      assert.equal(key.classification, null);
    } finally { run.rm(); }
  }
});

test("require_pinned_governor is reported and changes no outcome", () => {
  const run = grantedRun();
  try {
    const strict = verify(run, trustFile(["a".repeat(64)], { requirePinned: true }));
    assert.equal(strict.outcome, "valid-grant");
    assert.equal(strict.classification, "unpinned");
    assert.equal(resolveAdmittedKey(run.runDir, trustFile([], { requirePinned: true })).require_pinned_governor, true);
    assert.equal(resolveAdmittedKey(run.runDir, trustFile([], { requirePinned: false })).require_pinned_governor, false);
    assert.equal(resolveAdmittedKey(run.runDir, NOT_READ).require_pinned_governor, false);
  } finally { run.rm(); }
});

test("classification and signer_fingerprint are null whenever no key is bound", () => {
  const run = grantedRun();
  try {
    rmSync(join(run.runDir, "commissaire", "producer", "pk.json"));
    const key = resolveAdmittedKey(run.runDir, trustFile([run.kp.pk_fingerprint]));
    assert.deepEqual({ pk: key.pk, signer: key.signer_fingerprint, classification: key.classification, failure: key.failure }, { pk: null, signer: null, classification: null, failure: "governor-key-not-admitted" });
  } finally { run.rm(); }
});

// --- key binding to the admission ---------------------------------------------------------------

test("adversarial: a runner-minted pk.json plus a self-signed merge grant is refused governor-key-not-admitted", () => {
  const run = grantedRun();
  const attacker = mintGovernorKeypair();
  const repo = trustRepo([run.kp.pk_fingerprint]);
  try {
    run.writePk(attacker);
    run.add("effect-decision-verdict", "FAFF-1", "merge", { verdict: "grant", effect: MERGE }, { sk: attacker.sk });
    run.flush();

    const res = verify(run, trustFile([run.kp.pk_fingerprint]));
    assert.equal(res.outcome, "absent-or-invalid");
    assert.equal(res.reason, "governor-key-not-admitted");
    assert.equal(res.classification, null);
    assert.equal(res.signer_fingerprint, null);

    const r = audit(["--run-dir", run.runDir, "--base", "main", "--trust-transport", "local"], { cwd: repo });
    assert.equal(r.code, 1, r.stderr);
    const out = json(r);
    assert.equal(out.result, "fail");
    assert.ok(out.ledger_failures.some((f) => f.reason === "governor-key-not-admitted"), JSON.stringify(out.ledger_failures));
    const forged = out.records[out.records.length - 1];
    assert.equal(forged.classification, "failed");
    assert.equal(forged.key_classification, null);
    assert.equal(out.signer_fingerprint, null);
    assert.equal(out.pk_fingerprint, attacker.pk_fingerprint, "pk_fingerprint stays the unauthenticated pk.json value");
  } finally { run.rm(); rmSync(repo, { recursive: true, force: true }); }
});

test("governor key binding: a missing pk.json, a mismatched fingerprint and a bad admission signature give governor-key-not-admitted; in-process gives key-not-admitted", () => {
  for (const custody of ["governor", "in-process"]) {
    const expected = custody === "governor" ? "governor-key-not-admitted" : "key-not-admitted";
    const missing = grantedRun({ custody });
    const mismatched = grantedRun({ custody });
    const badSig = grantedRun({ custody });
    try {
      rmSync(join(missing.runDir, "commissaire", "producer", "pk.json"));
      mismatched.writePk(mintGovernorKeypair());
      // admission names kp's fingerprint but was signed by another key: kp.pk verifies nothing
      const forger = mintGovernorKeypair();
      const forged = JSON.parse(badSig.lines[0]);
      forged.commissaire_sig = signDecision(forged, forger.sk);
      badSig.lines[0] = JSON.stringify(forged);
      badSig.lines[1] = JSON.stringify({ ...JSON.parse(badSig.lines[1]), prev: sha(badSig.lines[0]) });
      badSig.flush();
      for (const run of [missing, mismatched, badSig]) {
        assert.equal(verify(run, NOT_READ).reason, expected, `${custody} ${run.runDir}`);
      }
    } finally { missing.rm(); mismatched.rm(); badSig.rm(); }
  }
});

test("in-process custody keeps the governor.json precedence and the FAFF-978 tamper cross-check", () => {
  const run = grantedRun({ custody: "in-process" });
  try {
    const gov = { pk: run.kp.pk, pk_fingerprint: run.kp.pk_fingerprint, master_secret: "s" };
    mkdirSync(join(run.runDir, "commissaire", "governor"), { recursive: true });
    writeFileSync(join(run.runDir, "commissaire", "governor", "governor.json"), JSON.stringify(gov));
    assert.equal(resolveAdmittedKey(run.runDir, NOT_READ).failure, null, "governor.json and pk.json agree");
    run.writePk(mintGovernorKeypair());
    const tampered = resolveAdmittedKey(run.runDir, NOT_READ);
    assert.equal(tampered.failure, "pk-fingerprint-tampered");
    assert.equal(tampered.pk, run.kp.pk, "the admitted governor.json key is kept");
    assert.equal(verify(run, NOT_READ).reason, "pk-fingerprint-tampered");
  } finally { run.rm(); }
});

test("demotion: deleting the governor admission and re-chaining gives admission-missing, never an in-process valid-grant", () => {
  const run = mkRun();
  const attacker = mintGovernorKeypair();
  try {
    run.lines.length = 0;
    run.writePk(attacker);
    run.add("effect-decision-verdict", "FAFF-1", "merge", { verdict: "grant", effect: MERGE }, { sk: attacker.sk, seq: 0 });
    run.flush();
    const res = verify(run, trustFile([run.kp.pk_fingerprint]));
    assert.equal(res.outcome, "absent-or-invalid");
    assert.equal(res.reason, "admission-missing");
    assert.notEqual(res.custody, "in-process");
    assert.equal(res.classification, null);
  } finally { run.rm(); }
});

test("a governed run with a missing, emptied or garbled ledger is admission-missing, never not-applicable; a mid-file non-record is ledger-malformed", () => {
  const run = grantedRun();
  try {
    const ledger = join(run.runDir, LEDGER);
    rmSync(ledger);
    assert.equal(verify(run, NOT_READ).reason, "admission-missing", "missing ledger");
    writeFileSync(ledger, "");
    assert.equal(verify(run, NOT_READ).reason, "admission-missing", "emptied ledger");
    writeFileSync(ledger, "not json at all");
    assert.equal(verify(run, NOT_READ).reason, "admission-missing", "a single garbled torn line");
    writeFileSync(ledger, `garbage\n${run.lines.join("\n")}\n`);
    assert.equal(verify(run, NOT_READ).reason, "ledger-malformed", "a mid-file non-record");
    run.flush();
    appendFileSync(ledger, "{broken\n"); // a garbled line followed by nothing is still mid-file once newline-terminated
    appendFileSync(ledger, `${run.lines[1]}\n`);
    assert.equal(verify(run, NOT_READ).reason, "ledger-malformed");
    // the demotion path also removes the ledger and keeps governor.json: the unauthenticated label never changes the outcome
    rmSync(ledger);
    mkdirSync(join(run.runDir, "commissaire", "governor"), { recursive: true });
    writeFileSync(join(run.runDir, "commissaire", "governor", "governor.json"), JSON.stringify({ pk: run.kp.pk, pk_fingerprint: run.kp.pk_fingerprint }));
    assert.equal(verify(run, NOT_READ).reason, "admission-missing");
  } finally { run.rm(); }
});

test("a run with no governance material is not-applicable, whatever the trust input", () => {
  const root = mkdtempSync(join(tmpdir(), "com-verify-ungov-"));
  const runDir = join(root, "RUN-U");
  mkdirSync(runDir);
  try {
    for (const trust of [NOT_READ, trustError()]) {
      const res = verifyGrant({ run_dir: runDir, unit_id: "FAFF-1", step: "merge", effect: MERGE, trust });
      seenReasons.add(res.reason);
      assert.deepEqual({ outcome: res.outcome, reason: res.reason, custody: res.custody, classification: res.classification }, { outcome: "not-applicable", reason: "not-governed", custody: null, classification: null });
    }
    assert.equal(resolveAdmittedKey(runDir, NOT_READ).failure, null);
    const missing = verifyGrant({ run_dir: join(root, "nope"), unit_id: "FAFF-1", step: "merge", effect: MERGE, trust: NOT_READ });
    assert.equal(missing.outcome, "not-applicable", "an unreadable run directory does not throw");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a seq-0 record that is not a Commissaire admission, or an admission at the wrong seq, is admission-missing and never falls back to pk.json", () => {
  const run = mkRun();
  try {
    run.lines.length = 0;
    run.add("effect-decision-verdict", "FAFF-1", "merge", { verdict: "grant", effect: MERGE });
    run.flush();
    assert.equal(verify(run, NOT_READ).reason, "admission-missing");
    run.lines.length = 0;
    run.add("admission", "-", "admit", { producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"], pk_fingerprint: run.kp.pk_fingerprint, custody: "governor" }, { seq: 1 });
    run.grant({ seq: 1 });
    run.flush();
    assert.equal(verify(run, NOT_READ).reason, "admission-missing");
  } finally { run.rm(); }
});

// --- run binding ----------------------------------------------------------------------------------

test("copied admission: a genuine pinned admission from another run is run-id-mismatch with null classification, never pinned", () => {
  const source = mkRun({ runId: "RUN-A" });
  const target = mkRun({ runId: "RUN-B", kp: source.kp });
  const repo = trustRepo([source.kp.pk_fingerprint]);
  try {
    target.lines.length = 0;
    target.lines.push(source.lines[0]); // the genuine admission, signed for RUN-A
    target.add("effect-decision-verdict", "FAFF-1", "merge", { verdict: "grant", effect: MERGE }); // governor-signed, but for RUN-B
    target.flush();
    const trust = trustFile([source.kp.pk_fingerprint]);
    const key = resolveAdmittedKey(target.runDir, trust);
    assert.equal(key.failure, "run-id-mismatch");
    assert.equal(key.classification, null);
    assert.equal(key.pk, null);
    const res = verify(target, trust);
    assert.deepEqual({ outcome: res.outcome, reason: res.reason, classification: res.classification }, { outcome: "absent-or-invalid", reason: "run-id-mismatch", classification: null });

    const r = audit(["--run-dir", target.runDir, "--base", "main", "--trust-transport", "local"], { cwd: repo });
    assert.equal(r.code, 1);
    assert.ok(json(r).ledger_failures.some((f) => f.reason === "run-id-mismatch"));
  } finally { source.rm(); target.rm(); rmSync(repo, { recursive: true, force: true }); }
});

test("line 0's prev is bound to the expected run id, not the record's own run_id", () => {
  const run = mkRun();
  try {
    run.lines.length = 0;
    run.add("admission", "-", "admit", { producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"], pk_fingerprint: run.kp.pk_fingerprint, custody: "governor" }, { prev: sha("RUN-OTHER") });
    run.grant();
    run.flush();
    assert.equal(resolveAdmittedKey(run.runDir, NOT_READ).failure, "admission-position-invalid");
    assert.equal(verify(run, NOT_READ).reason, "admission-position-invalid");
  } finally { run.rm(); }
});

test("a later record naming another run is run-id-mismatch", () => {
  const run = mkRun();
  try {
    run.grant({ runId: "RUN-ELSEWHERE" });
    run.flush();
    assert.equal(verify(run, NOT_READ).reason, "run-id-mismatch");
  } finally { run.rm(); }
});

test("the expected run id defaults to the directory basename and can be named by the caller", () => {
  const run = mkRun({ runId: "RUN-NAMED", dirName: "somewhere-else" });
  try {
    run.grant();
    run.flush();
    assert.equal(resolveAdmittedKey(run.runDir, NOT_READ).failure, "run-id-mismatch", "basename differs from the records' run_id");
    assert.equal(verify(run, NOT_READ).reason, "run-id-mismatch");
    assert.equal(resolveAdmittedKey(run.runDir, NOT_READ, undefined, undefined, "RUN-NAMED").failure, null);
    const res = verify(run, NOT_READ, { run_id: "RUN-NAMED" });
    assert.equal(res.outcome, "valid-grant");
    assert.equal(verify(run, NOT_READ, { run_id: "RUN-WRONG" }).reason, "run-id-mismatch");
  } finally { run.rm(); }
});

// --- signed chain position -------------------------------------------------------------------------

test("an orphaned grant appended after losing its position is chain-position-invalid", () => {
  const run = mkRun();
  try {
    run.add("producer-note", "FAFF-1", "merge", { n: 1 }); // seq 1
    const orphanPrev = run.prevHash();
    run.add("producer-note", "FAFF-1", "merge", { won: true }); // another record wins seq 2
    run.grant({ seq: 2, prev: orphanPrev }); // the governor's real grant for seq 2, appended late as line 3
    run.flush();
    const res = verify(run, NOT_READ);
    assert.equal(res.outcome, "absent-or-invalid");
    assert.equal(res.reason, "chain-position-invalid");
  } finally { run.rm(); }
});

test("a verdict whose seq differs from its line index, or that sits on two physical lines, is chain-position-invalid", () => {
  const skewed = mkRun();
  const duplicated = mkRun();
  try {
    skewed.grant({ seq: 5 });
    skewed.flush();
    assert.equal(verify(skewed, NOT_READ).reason, "chain-position-invalid");

    duplicated.grant();
    duplicated.lines.push(duplicated.lines[1]);
    duplicated.flush();
    assert.equal(verify(duplicated, NOT_READ).reason, "chain-position-invalid");
  } finally { skewed.rm(); duplicated.rm(); }
});

test("first_break.line boundary: a grant before a broken line or a torn tail passes; a break at or before the grant's own line refuses", () => {
  const beforeBreak = mkRun();
  const torn = mkRun();
  const atGrant = mkRun();
  const afterBreak = mkRun();
  try {
    beforeBreak.grant();
    beforeBreak.add("producer-note", "FAFF-1", "merge", {}, { prev: "0".repeat(64) }); // line 3 breaks; the grant is line 2
    beforeBreak.flush();
    assert.equal(verify(beforeBreak, NOT_READ).outcome, "valid-grant", "break on the line immediately after the grant");

    torn.grant();
    torn.flush('{"schema":3,"run_id":"RUN-V1","seq":');
    assert.equal(verify(torn, NOT_READ).outcome, "valid-grant", "torn final line");

    atGrant.grant({ prev: "0".repeat(64) }); // the grant is line 2 and is the broken line (first_break.line === 2)
    atGrant.flush();
    assert.equal(verify(atGrant, NOT_READ).reason, "chain-position-invalid");

    afterBreak.add("producer-note", "FAFF-1", "merge", {}, { prev: "1".repeat(64) }); // line 2 breaks
    afterBreak.grant(); // line 3, correctly chained to line 2 but after the break
    afterBreak.flush();
    assert.equal(verify(afterBreak, NOT_READ).reason, "chain-position-invalid");
  } finally { beforeBreak.rm(); torn.rm(); atGrant.rm(); afterBreak.rm(); }
});

// --- verdict selection and the effect ----------------------------------------------------------------

test("with a grant followed by a deny for the same unit, step and kind, the latest wins and refuses decision-not-a-grant", () => {
  const run = mkRun();
  try {
    run.grant();
    run.grant({ verdict: "deny" });
    run.flush();
    const res = verify(run, NOT_READ);
    assert.deepEqual({ outcome: res.outcome, reason: res.reason, seq: res.verdict_seq }, { outcome: "absent-or-invalid", reason: "decision-not-a-grant", seq: 2 });
  } finally { run.rm(); }
});

test("no-verdict-for-step and no-verdict-for-kind name the missing verdict on a governed run", () => {
  const empty = mkRun();
  const other = mkRun();
  try {
    empty.flush();
    assert.equal(verify(empty, NOT_READ).reason, "no-verdict-for-step");
    other.grant({ effect: { kind: "pr-create", target: "main" } });
    other.flush();
    assert.equal(verify(other, NOT_READ).reason, "no-verdict-for-kind");
  } finally { empty.rm(); other.rm(); }
});

test("a null or empty effect.target is effect-target-missing, checked first; the grant is never compared with its own target", () => {
  const run = grantedRun();
  const root = mkdtempSync(join(tmpdir(), "com-verify-empty-"));
  try {
    for (const target of ["", null, undefined]) {
      const res = verifyGrant({ run_dir: run.runDir, unit_id: "FAFF-1", step: "merge", effect: { kind: "merge", target }, trust: NOT_READ });
      seenReasons.add(res.reason);
      assert.deepEqual({ outcome: res.outcome, reason: res.reason }, { outcome: "absent-or-invalid", reason: "effect-target-missing" });
    }
    const ungoverned = verifyGrant({ run_dir: root, unit_id: "FAFF-1", step: "merge", effect: { kind: "merge", target: "" }, trust: NOT_READ });
    assert.equal(ungoverned.reason, "effect-target-missing", "checked before applicability");
    const res = verifyGrant({ run_dir: run.runDir, unit_id: "FAFF-1", step: "merge", effect: { kind: "merge", target: "release" }, trust: NOT_READ });
    seenReasons.add(res.reason);
    assert.equal(res.reason, "grant-does-not-cover-effect");
  } finally { run.rm(); rmSync(root, { recursive: true, force: true }); }
});

test("reasons only ever come from GrantReason, and grant-not-pinned is never returned", () => {
  const allowed = new Set([
    "valid-grant", "not-governed", "no-verdict-for-step", "no-verdict-for-kind", "chain-position-invalid", "effect-target-missing",
    "ledger-malformed", "admission-missing", "admission-position-invalid", "run-id-mismatch", "governor-key-not-admitted", "key-not-admitted",
    "pk-fingerprint-tampered", "trust-file-invalid",
    "not-a-commissaire-decision", "decision-signature-invalid", "decision-not-a-grant", "grant-does-not-cover-effect", "pk-unreadable",
  ]);
  assert.ok(seenReasons.size >= 12, `the suite exercised ${seenReasons.size} distinct reasons`);
  for (const reason of seenReasons) assert.ok(allowed.has(reason), `unexpected reason ${reason}`);
  assert.ok(!seenReasons.has("grant-not-pinned"));
});

// --- verifyAuthLeg ------------------------------------------------------------------------------------

test("verifyAuthLeg uses the admitted key: a swapped pk.json fails the auth leg under governor custody and returns the KeyResolution", () => {
  const run = grantedRun();
  try {
    assert.equal(verifyAuthLeg(run.runDir).pass, true);
    assert.equal(verifyAuthLeg(run.runDir).key.custody, "governor");
    const attacker = mintGovernorKeypair();
    run.writePk(attacker);
    run.add("effect-decision-verdict", "FAFF-1", "merge", { verdict: "grant", effect: MERGE }, { sk: attacker.sk });
    run.flush();
    const auth = verifyAuthLeg(run.runDir);
    assert.equal(auth.pass, false);
    assert.ok(auth.failures.some((f) => f.seq === null && f.reason === "governor-key-not-admitted"));
    assert.ok(auth.failures.some((f) => f.seq !== null && f.reason === "commissaire-sig-invalid"), "no key is trusted, so every Commissaire record fails");
    assert.equal(auth.key.pk, null);
  } finally { run.rm(); }
});

// --- audit verify: the frozen fixture, run id derivation, validation, trust reads ---------------------

test("secret-free-replay fixture: with RUN-SMOKE the result, counts and exit code are unchanged and only additive fields appear", () => {
  const r = audit(["--run-dir", FIXTURE_ROOT, "--run-id", "RUN-SMOKE"]);
  assert.equal(r.code, 0, r.stderr);
  const out = json(r);
  assert.equal(out.version, 1);
  assert.equal(out.result, "pass");
  assert.equal(out.producer_claims.failed, 0);
  assert.equal(out.producer_claims.verified, 0);
  assert.ok(out.producer_claims.unverifiable_without_secret > 0);
  assert.deepEqual(Object.keys(out.commissaire_decisions).sort(), ["failed", "verified"]);
  assert.equal(out.commissaire_decisions.failed, 0);
  assert.deepEqual(out.ledger_failures, []);
  assert.equal(out.custody, "in-process");
  assert.equal(out.signer_fingerprint, out.pk_fingerprint, "bound and unauthenticated values agree on an honest run");
  assert.deepEqual(out.trust, { source: "not-read", present: null, require_pinned_governor: false });
  for (const rec of out.records) {
    if (rec.author === "commissaire") assert.equal(rec.key_classification, "in-process", `seq ${rec.seq}`);
    else assert.equal("key_classification" in rec, false, "producer records carry no key_classification");
  }
  // without the run id the records are bound to the directory name, so the same bytes are refused
  const bare = audit(["--run-dir", FIXTURE_ROOT]);
  assert.equal(bare.code, 1);
  assert.ok(json(bare).ledger_failures.some((f) => f.reason === "run-id-mismatch"));
});

test("audit verify derives the expected run id from an anchor path, and --run-id overrides it", () => {
  const run = grantedRun();
  const anchor = join(run.root, ".faff", "anchors", run.runId, "FAFF-1");
  const plain = join(run.root, "elsewhere", "copy");
  try {
    for (const dest of [anchor, plain]) {
      mkdirSync(join(dest, "commissaire", "producer"), { recursive: true });
      cpSync(join(run.runDir, LEDGER), join(dest, LEDGER));
      cpSync(join(run.runDir, "commissaire", "producer", "pk.json"), join(dest, "commissaire", "producer", "pk.json"));
    }
    const fromAnchor = audit(["--run-dir", anchor]);
    assert.equal(fromAnchor.code, 0, fromAnchor.stderr + fromAnchor.stdout);
    assert.equal(json(fromAnchor).custody, "governor");
    assert.equal(audit(["--run-dir", anchor, "--run-id", "RUN-WRONG"]).code, 1, "--run-id wins over the anchor segment");
    assert.equal(audit(["--run-dir", plain]).code, 1, "a plain directory is bound to its basename");
    assert.equal(audit(["--run-dir", plain, "--run-id", run.runId]).code, 0);
  } finally { run.rm(); }
});

test("audit verify rejects a malformed --run-id, --repo, --base or --trust-transport with exit 2 and runs no gh or git read", () => {
  const run = grantedRun();
  const gh = stubGh("", "down");
  try {
    const cases = [
      ["--run-id", ["-x", "a/b", "a b", "", ".hidden", "a;b"]],
      ["--repo", ["a", "a/b/c", "../x/y", "o/..", "o/a..b", "o/a b", "o/a?b", ""]],
      ["--base", ["-x", "a..b", "a?b", "a#b", "a&b", "a%b", "a b", "", "a\nb"]],
      ["--trust-transport", ["ssh", ""]],
    ];
    for (const [flag, values] of cases) {
      for (const value of values) {
        const extra = flag === "--repo" ? ["--base", "main"] : flag === "--trust-transport" ? ["--base", "main", "--repo", "o/n"] : flag === "--base" ? ["--repo", "o/n"] : flag === "--run-id" ? ["--base", "main", "--repo", "o/n"] : [];
        const r = audit(["--run-dir", run.runDir, flag, value, ...extra], { env: gh.env });
        assert.equal(r.code, 2, `${flag} ${JSON.stringify(value)} -> ${r.code} ${r.stderr}`);
        assert.equal(r.stdout, "", "nothing is written to stdout on a setup error");
      }
    }
    assert.equal(gh.calls(), "", "validation precedes every read");
  } finally { run.rm(); rmSync(gh.dir, { recursive: true, force: true }); }
});

test("audit verify with --base on the default remote transport and no --repo exits 2, never a trust-file-invalid result", () => {
  const run = grantedRun();
  try {
    const r = audit(["--run-dir", run.runDir, "--base", "main"]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /--repo/);
  } finally { run.rm(); }
});

test("audit verify remote read: --base main --trust-transport remote --repo classifies against the stubbed gh trust file", () => {
  const run = grantedRun();
  const toml = `schema = 1\ngovernor_key_fingerprints = ["${run.kp.pk_fingerprint}"]\nrequire_pinned_governor = true\n`;
  const present = stubGh(toml, "present");
  const absent = stubGh("", "absent");
  const down = stubGh("", "down");
  const unlisted = stubGh(`schema = 1\ngovernor_key_fingerprints = ["${"e".repeat(64)}"]\n`, "present");
  const flags = ["--run-dir", run.runDir, "--base", "main", "--trust-transport", "remote", "--repo", "owner/name"];
  try {
    const pinned = audit(flags, { env: present.env });
    assert.equal(pinned.code, 0, pinned.stderr + pinned.stdout);
    const p = json(pinned);
    assert.deepEqual(p.trust, { source: "remote-base", present: true, require_pinned_governor: true });
    assert.equal(p.custody, "governor");
    assert.equal(p.signer_fingerprint, run.kp.pk_fingerprint);
    assert.ok(p.records.filter((x) => x.author === "commissaire").every((x) => x.key_classification === "pinned"));
    assert.match(present.calls(), /repos\/owner\/name\/contents\/\.commissaire\/trust\.toml\?ref=main/);

    // the default transport is remote
    const dflt = audit(["--run-dir", run.runDir, "--base", "main", "--repo", "owner/name"], { env: present.env });
    assert.equal(json(dflt).trust.source, "remote-base");

    const notListed = json(audit(flags, { env: unlisted.env }));
    assert.equal(notListed.trust.present, true);
    assert.ok(notListed.records.filter((x) => x.author === "commissaire").every((x) => x.key_classification === "unpinned"));

    const none = audit(flags, { env: absent.env });
    assert.equal(none.code, 0, none.stderr);
    assert.deepEqual(json(none).trust, { source: "remote-base", present: false, require_pinned_governor: false });
    assert.ok(json(none).records.filter((x) => x.author === "commissaire").every((x) => x.key_classification === "unpinned"));

    const broken = audit(flags, { env: down.env });
    assert.equal(broken.code, 1, "an unreadable trust file fails closed");
    const b = json(broken);
    const invalid = b.ledger_failures.find((f) => f.reason === "trust-file-invalid");
    assert.ok(invalid, "trust-file-invalid is reported");
    assert.match(invalid.detail, /could not read trust file from remote-base/, "the read error message is carried");
    assert.equal(b.trust.source, "remote-base", "the attempted source is reported, not not-read");
    assert.equal(b.trust.present, null, "a failed read reports present as null");
    assert.ok(b.records.filter((x) => x.author === "commissaire").every((x) => x.key_classification === null));
  } finally { run.rm(); for (const g of [present, absent, down, unlisted]) rmSync(g.dir, { recursive: true, force: true }); }
});

test("audit verify local transport reads the base ref with git show and reports local-ref", () => {
  const run = grantedRun();
  const repo = trustRepo([run.kp.pk_fingerprint]);
  try {
    const r = audit(["--run-dir", run.runDir, "--base", "main", "--trust-transport", "local"], { cwd: repo });
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.deepEqual(out.trust, { source: "local-ref", present: true, require_pinned_governor: false });
    assert.ok(out.records.filter((x) => x.author === "commissaire").every((x) => x.key_classification === "pinned"));
    const noBase = json(audit(["--run-dir", run.runDir], { cwd: repo }));
    assert.deepEqual(noBase.trust, { source: "not-read", present: null, require_pinned_governor: false });
    assert.ok(noBase.records.filter((x) => x.author === "commissaire").every((x) => x.key_classification === "unpinned"));
  } finally { run.rm(); rmSync(repo, { recursive: true, force: true }); }
});

test("audit verify treats a run with only pk.json as governed and refuses a damaged ledger instead of exit 2", () => {
  const run = grantedRun();
  try {
    rmSync(join(run.runDir, LEDGER));
    const r = audit(["--run-dir", run.runDir]);
    assert.equal(r.code, 1, r.stderr);
    assert.ok(json(r).ledger_failures.some((f) => f.reason === "admission-missing"));
  } finally { run.rm(); }
});

// --- documentation and shape -----------------------------------------------------------------------

test("the module is tagged region:governance, exports both functions, and the help text states the reading rules", () => {
  const source = readFileSync(join(LIB, "commissaire-verify.ts"), "utf8");
  assert.match(source.split("\n").slice(0, 3).join("\n"), /region:governance — commissaire-verify — FAFF-1178/);
  assert.match(source, /"remote-base" with classification "pinned"/);
  assert.match(source, /pk_fingerprint read from pk\.json is unauthenticated/);
  assert.equal(typeof verifyGrant, "function");
  assert.equal(typeof resolveAdmittedKey, "function");
  const usage = runCli(["commissaire"]);
  assert.match(usage.stderr, /--trust-transport remote\|local/);
  assert.match(usage.stderr, /"remote-base" with key_classification "pinned"/);
  assert.match(usage.stderr, /pk_fingerprint is read from pk\.json and is unauthenticated/);
});
