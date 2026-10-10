// FAFF-1179 — the runner-side Commissaire governor client: the switch and its branches, record
// verification, the append-with-retry driver, and the end-to-end governed flow against a real
// FAFF-1177 governor over a local Unix socket (plus the unreachable-governor park paths, which need
// only an absent/stopped socket). Ungoverned runs stay in-process and carry no custody field.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  parseEndpoint, resolveGovernor, runStartGovernorDecision, verifyAdmitReply, appendGovernorRecordWithRetry,
} from "../plugin/skills/faff/bin/lib/commissaire-governor-client.js";
import {
  mintGovernorKeypair, signDecision, signRecord, deriveKey, buildEnvelope, verifyDecision,
} from "../plugin/skills/faff/bin/lib/producer-auth.js";
import { sha256Hex } from "../plugin/skills/faff/bin/lib/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin");
const COMMISSAIRE = join(BIN, "commissaire");
const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.COMMISSAIRE_GOVERNOR; // never let an ambient switch leak into a test

function runCom(args, { input, env } = {}) {
  const r = spawnSync(process.execPath, [COMMISSAIRE, ...args], { encoding: "utf8", input: input ?? "", env: { ...CLEAN_ENV, ...(env || {}) } });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}
const ledgerOf = (runDir) => readFileSync(join(runDir, "declared-effects.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const walkFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(join(d, e.name)) : [join(d, e.name)]));

function startGovernor(keyDir, sock) {
  const child = spawn(process.execPath, [COMMISSAIRE, "governor", "start", "--key-dir", keyDir, "--socket", sock], { stdio: ["ignore", "pipe", "pipe"], env: CLEAN_ENV });
  const ready = new Promise((resolve, reject) => {
    let out = "";
    const to = setTimeout(() => reject(new Error(`governor did not start: ${out}`)), 8000);
    child.stdout.on("data", (c) => { out += c; if (out.includes('"listening"')) { clearTimeout(to); resolve(); } });
    child.on("error", (e) => { clearTimeout(to); reject(e); });
  });
  return { child, ready };
}
const stopGovernor = (g) => { try { g.child.kill("SIGTERM"); } catch { /* best-effort */ } };

// --- The switch: parse + resolve + the run-start branch ------------------------------------

test("parseEndpoint discriminates unix / tcp / .sock / fault by shape", () => {
  assert.deepEqual(parseEndpoint("/var/run/gov.sock"), { kind: "unix", socket_path: "/var/run/gov.sock" });
  assert.deepEqual(parseEndpoint("./gov.sock"), { kind: "unix", socket_path: "./gov.sock" });
  assert.deepEqual(parseEndpoint("governor"), { kind: "unix", socket_path: "governor" });          // no colon → path
  assert.deepEqual(parseEndpoint("/tmp/a/b"), { kind: "unix", socket_path: "/tmp/a/b" });            // path, no port
  assert.deepEqual(parseEndpoint("fly.example:8080"), { kind: "tcp", host: "fly.example", port: 8080 });
  assert.deepEqual(parseEndpoint("a:1234.sock"), { kind: "unix", socket_path: "a:1234.sock" });       // a .sock suffix always wins
  assert.deepEqual(parseEndpoint("/var/run/x:123"), { kind: "unix", socket_path: "/var/run/x:123" }); // path with colon → unix
  for (const bad of ["host:0", "host:70000", "host:notaport"]) {
    assert.throws(() => parseEndpoint(bad), (e) => e.governorConfigFault === true, `"${bad}" is a config fault`);
  }
});

test("resolveGovernor: env over rc, empty env disables, unset + no rc is in-process", () => {
  const root = mkdtempSync(join(tmpdir(), "gov-resolve-"));
  try {
    assert.deepEqual(resolveGovernor(root, {}), { configured: false });                               // no env, no rc
    assert.deepEqual(resolveGovernor(root, { COMMISSAIRE_GOVERNOR: "" }), { configured: false });      // explicit disable
    assert.deepEqual(resolveGovernor(root, { COMMISSAIRE_GOVERNOR: "/s.sock" }), { configured: true, endpoint: { kind: "unix", socket_path: "/s.sock" } });
    assert.throws(() => resolveGovernor(root, { COMMISSAIRE_GOVERNOR: "h:bad" }), (e) => e.governorConfigFault === true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runStartGovernorDecision: a not-configured run is ungoverned, a configured run names its endpoint", () => {
  const root = mkdtempSync(join(tmpdir(), "gov-runstart-"));
  try {
    assert.deepEqual(runStartGovernorDecision(root, { COMMISSAIRE_GOVERNOR: "" }), { governed: false });
    assert.deepEqual(runStartGovernorDecision(root, {}), { governed: false });
    assert.deepEqual(runStartGovernorDecision(root, { COMMISSAIRE_GOVERNOR: "box:9000" }), { governed: true, endpoint: { kind: "tcp", host: "box", port: 9000 } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Record verification (forged / substituted records are refused) ------------------------

function genuineAdmitReply(runId = "RUN-X") {
  const kp = mintGovernorKeypair();
  const rec = buildEnvelope(runId, 0, sha256Hex(Buffer.from(runId, "utf8")), "commissaire", "P1", "r1", {
    kind_of_entry: "admission", unit_id: "-", step: "admit",
    payload: { producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"], pk_fingerprint: kp.pk_fingerprint, admitted_at: "2026-01-01T00:00:00Z", custody: "governor" },
  });
  rec.commissaire_sig = signDecision(rec, kp.sk);
  return { kp, reply: { ok: true, custody: "governor", producer_id: "P1", k_producer_hex: "ab", pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, admitted_scope: ["merge"], admission_record: rec } };
}

test("verifyAdmitReply accepts a genuine reply and refuses a tampered record, a fingerprint mismatch, and a producer-HMAC'd fake", () => {
  const { kp, reply } = genuineAdmitReply();
  assert.ok(verifyAdmitReply(reply));
  assert.ok(!verifyAdmitReply({ ...reply, admission_record: { ...reply.admission_record, seq: 1 } }), "a tampered covered field breaks the signature");
  assert.ok(!verifyAdmitReply({ ...reply, pk_fingerprint: "deadbeef" }), "a pk_fingerprint mismatch is refused");
  const key = deriveKey("not-the-master", "P1", "r1");
  const forged = { ...reply.admission_record };
  delete forged.commissaire_sig;
  forged.commissaire_sig = signRecord(forged, key); // a producer HMAC presented as a commissaire sig
  assert.ok(!verifyAdmitReply({ ...reply, admission_record: forged }), "a producer-HMAC'd fake does not verify as a decision");
});

// --- The append-with-retry driver ----------------------------------------------------------

const REC = { seq: 3, prev: "p" };

test("driver: a verified ok reply appends and returns the record", () => {
  let appended = 0;
  const r = appendGovernorRecordWithRetry({
    ask: () => ({ ok: true, record: REC }),
    verify: () => true,
    appendVerbatim: (rec) => { appended++; return rec; },
  });
  assert.deepEqual(r, { ok: true, record: REC });
  assert.equal(appended, 1);
});

test("driver: a lost race (null append) retries up to three further attempts, then parks governor-lost-race", () => {
  let calls = 0;
  const r = appendGovernorRecordWithRetry({
    ask: () => ({ ok: true, record: REC }),
    verify: () => true,
    appendVerbatim: () => { calls++; return null; }, // always a race
  });
  assert.deepEqual(r, { park: "governor-lost-race" });
  assert.equal(calls, 4, "the initial attempt plus three retries");
});

test("driver: a race that clears on the second attempt appends and succeeds", () => {
  let calls = 0;
  const r = appendGovernorRecordWithRetry({
    ask: () => ({ ok: true, record: REC }),
    verify: () => true,
    appendVerbatim: (rec) => { calls++; return calls === 1 ? null : rec; },
  });
  assert.deepEqual(r, { ok: true, record: REC });
  assert.equal(calls, 2);
});

test("driver: a position-mismatch refusal is a lost race; ledger-not-extending-head and producer-not-admitted park immediately", () => {
  let asks = 0;
  const posMismatch = appendGovernorRecordWithRetry({
    ask: () => { asks++; return { refused: { reason: "position-mismatch" } }; },
    verify: () => true, appendVerbatim: (rec) => rec,
  });
  assert.deepEqual(posMismatch, { park: "governor-lost-race" });
  assert.equal(asks, 4, "a position-mismatch is retried to the cap");
  assert.deepEqual(appendGovernorRecordWithRetry({ ask: () => ({ refused: { reason: "ledger-not-extending-head" } }), verify: () => true, appendVerbatim: (r) => r }), { park: "ledger-not-extending-head" });
  assert.deepEqual(appendGovernorRecordWithRetry({ ask: () => ({ refused: { reason: "producer-not-admitted" } }), verify: () => true, appendVerbatim: (r) => r }), { park: "governor-admission-lost" });
});

test("driver: a verification failure parks governor-record-unverified and appends nothing", () => {
  let appended = 0;
  const r = appendGovernorRecordWithRetry({
    ask: () => ({ ok: true, record: REC }),
    verify: () => false,
    appendVerbatim: () => { appended++; return REC; },
  });
  assert.deepEqual(r, { park: "governor-record-unverified" });
  assert.equal(appended, 0);
});

test("driver: unreachable surfaces unreachable; an idempotent reply is verified, then returned without appending or retrying", () => {
  let appended = 0;
  assert.deepEqual(appendGovernorRecordWithRetry({ ask: () => ({ unreachable: true, detail: "x" }), verify: () => true, appendVerbatim: () => { appended++; return REC; } }), { unreachable: true });
  const idem = appendGovernorRecordWithRetry({ ask: () => ({ idempotent: true, record: REC }), verify: () => true, appendVerbatim: () => { appended++; return REC; } });
  assert.deepEqual(idem, { idempotent: true, record: REC });
  // an idempotent reply still runs the Ed25519 verify seam — a failure parks, never reports a seq
  assert.deepEqual(appendGovernorRecordWithRetry({ ask: () => ({ idempotent: true, record: REC }), verify: () => false, appendVerbatim: () => { appended++; return REC; } }), { park: "governor-record-unverified" });
  assert.equal(appended, 0, "idempotent and unreachable never append");
});

test("driver: a non-race governor refusal is surfaced, not retried", () => {
  let asks = 0;
  const r = appendGovernorRecordWithRetry({ ask: () => { asks++; return { refused: { reason: "assurance-floor" } }; }, verify: () => true, appendVerbatim: (x) => x });
  assert.deepEqual(r, { refused: { reason: "assurance-floor" } });
  assert.equal(asks, 1);
});

// --- Ungoverned: in-process, no custody field, byte-shape unchanged -------------------------

test("ungoverned: an explicit-disabled run is in-process — governor.json present, admission carries no custody, chain verifies", () => {
  const root = mkdtempSync(join(tmpdir(), "gov-ungoverned-"));
  const runDir = join(root, ".faff", "runs", "RUN-UNGOV");
  mkdirSync(runDir, { recursive: true });
  try {
    const env = { COMMISSAIRE_GOVERNOR: "" }; // explicit disable → in-process regardless of any rc
    assert.equal(runCom(["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"], { env }).code, 0);
    assert.ok(existsSync(join(runDir, "commissaire", "governor", "governor.json")), "in-process keeps governor.json");
    const admission = ledgerOf(runDir)[0];
    assert.equal(admission.kind_of_entry, "admission");
    assert.ok(!("custody" in (admission.payload || {})), "an in-process admission record carries no custody field");
    const av = runCom(["audit", "verify", "--run-dir", runDir], { env });
    assert.equal(av.code, 0, av.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Governed end-to-end against a real governor --------------------------------------------

test("governed: admit→authorize→conclude asks the governor, verifies every record, holds no secret, labels custody governor", async () => {
  const root = mkdtempSync(join(tmpdir(), "gov-governed-"));
  const keyDir = join(root, "keys");
  const sock = join(root, "gov.sock");
  const runDir = join(root, ".faff", "runs", "RUN-GOV");
  mkdirSync(runDir, { recursive: true });
  const g = startGovernor(keyDir, sock);
  try {
    await g.ready;
    const env = { COMMISSAIRE_GOVERNOR: sock };

    const admit = runCom(["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"], { env });
    assert.equal(admit.code, 0, admit.stderr);
    assert.equal(JSON.parse(admit.stdout.trim()).custody, "governor");

    const governorDir = join(runDir, "commissaire", "governor");
    const producerDir = join(runDir, "commissaire", "producer");
    const pkPath = join(producerDir, "pk.json");
    const prodPath = join(producerDir, "producers", "P1.json");
    assert.ok(!existsSync(join(governorDir, "governor.json")), "a governor run writes NO governor.json");
    assert.equal(statSync(pkPath).mode & 0o777, 0o600, "pk.json is owner-only");
    assert.equal(statSync(prodPath).mode & 0o777, 0o600, "the producer file is owner-only");
    assert.equal(statSync(producerDir).mode & 0o777, 0o700, "the producer dir is 0700");

    const prod = JSON.parse(readFileSync(prodPath, "utf8"));
    assert.ok(prod.key_hex, "the producer file holds key_hex (K_producer)");
    assert.ok(!prod.sk && !prod.master_secret, "the producer file holds NO sk / master");
    const pk = JSON.parse(readFileSync(pkPath, "utf8"));

    const admission = ledgerOf(runDir)[0];
    assert.equal(admission.payload.custody, "governor", "the admission record carries payload.custody governor");
    assert.ok(verifyDecision(admission, pk.pk), "the admission record verifies under the governor pk");

    // secret-free: nothing under the run dir holds an sk / master / root secret.
    for (const f of walkFiles(join(runDir, "commissaire"))) {
      assert.doesNotMatch(readFileSync(f, "utf8"), /"sk"|master_secret|root_secret/, `${f} must carry no secret`);
    }
    assert.equal(JSON.parse(runCom(["contract", "status", "--run-dir", runDir], { env }).stdout.trim()).custody, "governor");

    assert.equal(runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { env, input: JSON.stringify([{ kind: "merge", target: "main" }]) }).code, 0);
    const auth = runCom(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { env, input: JSON.stringify({ effect: { kind: "merge", target: "main" } }) });
    assert.equal(auth.code, 0, auth.stderr);
    assert.equal(JSON.parse(auth.stdout.trim()).verdict, "grant");
    const verdict = ledgerOf(runDir).find((r) => r.kind_of_entry === "effect-decision-verdict");
    assert.ok(verifyDecision(verdict, pk.pk), "the governor-signed verdict verifies under pk");

    assert.equal(runCom(["effect", "observe", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { env, input: JSON.stringify([{ kind: "merge", target: "main" }]) }).code, 0);
    const conc = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"], { env });
    assert.equal(conc.code, 0, conc.stderr);
    const conclusion = ledgerOf(runDir).find((r) => r.kind_of_entry === "conformed_to_contract");
    assert.ok(conclusion && verifyDecision(conclusion, pk.pk), "the conclusion verifies under pk");
    assert.ok(!("custody" in (conclusion.payload || {})), "the conclusion carries no custody field");

    // idempotent re-conclude: the existing seq, no second append.
    const before = ledgerOf(runDir).length;
    const conc2 = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"], { env });
    assert.equal(conc2.code, 0, conc2.stderr);
    assert.equal(JSON.parse(conc2.stdout.trim()).idempotent, true);
    assert.equal(ledgerOf(runDir).length, before, "an idempotent conclude appends nothing");

    // audit verify passes with the producer records unverifiable_without_secret (no master on the runner).
    const av = runCom(["audit", "verify", "--run-dir", runDir, "--json"], { env });
    assert.equal(av.code, 0, av.stderr);
  } finally { stopGovernor(g); rmSync(root, { recursive: true, force: true }); }
});

test("governed conclude fails closed on an admission/key fingerprint mismatch, even with no observed protected effect (parity with in-process)", async () => {
  const root = mkdtempSync(join(tmpdir(), "gov-fpmismatch-"));
  const keyDir = join(root, "keys");
  const sock = join(root, "gov.sock");
  const runDir = join(root, ".faff", "runs", "RUN-FP");
  mkdirSync(runDir, { recursive: true });
  const g = startGovernor(keyDir, sock);
  try {
    await g.ready;
    const env = { COMMISSAIRE_GOVERNOR: sock };
    assert.equal(runCom(["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"], { env }).code, 0);
    assert.equal(runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { env, input: JSON.stringify([{ kind: "merge", target: "main" }]) }).code, 0);
    // Tamper the producer file's recorded fingerprint so it no longer matches the governor public key.
    const prodPath = join(runDir, "commissaire", "producer", "producers", "P1.json");
    const prod = JSON.parse(readFileSync(prodPath, "utf8"));
    prod.pk_fingerprint = "deadbeef".repeat(8);
    writeFileSync(prodPath, JSON.stringify(prod));
    const conc = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"], { env });
    const out = JSON.parse(conc.stdout.trim());
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "pk-fingerprint-mismatch");
    assert.ok(!ledgerOf(runDir).some((r) => r.kind_of_entry === "conformed_to_contract"), "no conclusion is signed on a fingerprint mismatch");
  } finally { stopGovernor(g); rmSync(root, { recursive: true, force: true }); }
});

test("unreachable at admit: a configured governor that cannot be reached exits non-zero and names the governor; nothing is persisted", () => {
  const root = mkdtempSync(join(tmpdir(), "gov-admit-unreach-"));
  const runDir = join(root, ".faff", "runs", "RUN-UNREACH");
  mkdirSync(runDir, { recursive: true });
  try {
    const absent = join(root, "nope.sock");
    const admit = runCom(["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"], { env: { COMMISSAIRE_GOVERNOR: absent } });
    assert.notEqual(admit.code, 0, "an unreachable governor fails admit");
    assert.match(admit.stdout + admit.stderr, /governor_unreachable|unreachable/);
    assert.ok(admit.stdout.includes(absent) || admit.stderr.includes(absent), "the governor endpoint is named");
    assert.ok(!existsSync(join(runDir, "commissaire", "producer", "pk.json")), "nothing is persisted on an unreachable admit");
    assert.ok(!existsSync(join(runDir, "declared-effects.jsonl")), "no ledger line is written on an unreachable admit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unreachable at authorize and conclude parks with the named reason; no verdict/conclusion is signed in-process", async () => {
  const root = mkdtempSync(join(tmpdir(), "gov-rpc-unreach-"));
  const keyDir = join(root, "keys");
  const sock = join(root, "gov.sock");
  const runDir = join(root, ".faff", "runs", "RUN-PARK");
  mkdirSync(runDir, { recursive: true });
  const g = startGovernor(keyDir, sock);
  try {
    await g.ready;
    const env = { COMMISSAIRE_GOVERNOR: sock };
    assert.equal(runCom(["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"], { env }).code, 0);
    assert.equal(runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { env, input: JSON.stringify([{ kind: "merge", target: "main" }]) }).code, 0);

    stopGovernor(g);
    await delay(400); // let the socket close/unlink

    const auth = runCom(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { env, input: JSON.stringify({ effect: { kind: "merge", target: "main" } }) });
    assert.notEqual(auth.code, 0, "an unreachable governor parks authorize");
    assert.equal(JSON.parse(auth.stdout.trim()).reason, "governor-unreachable-at-authorize");
    const led = ledgerOf(runDir);
    assert.ok(led.some((r) => r.kind_of_entry === "effect-decision-request"), "the request record was appended");
    assert.ok(!led.some((r) => r.kind_of_entry === "effect-decision-verdict"), "no verdict was written");

    const conc = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"], { env });
    assert.notEqual(conc.code, 0, "an unreachable governor parks conclude");
    assert.equal(JSON.parse(conc.stdout.trim()).reason, "governor-unreachable-at-conclude");
    assert.ok(!ledgerOf(runDir).some((r) => r.kind_of_entry === "conformed_to_contract"), "no conclusion was signed in-process");
  } finally { stopGovernor(g); rmSync(root, { recursive: true, force: true }); }
});
