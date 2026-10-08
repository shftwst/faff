// FAFF-1221: Commissaire's conclude record kind is renamed `accepted_under_contract` ->
// `conformed_to_contract`.
//
// New records carry the current kind; records already written keep the legacy kind and stay
// verifiable and idempotent through the compatibility read in effects.js (conclusionKindOf). Only
// an authenticated Commissaire conclusion counts as "already concluded". The frozen v0.2 facade
// examples are copied into scratch directories and never written to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import { verifyDecision, mintGovernorKeypair } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import {
  KIND_AUTHOR, appendProducerRecords, governorFileOf, governorDirOf, producerFileOf, producerDirOf, pkFileOf,
} from "../plugin/skills/faff/bin/lib/commissaire.js";
import { CONCLUSION_KIND, LEGACY_CONCLUSION_KIND, conclusionKindOf } from "../plugin/skills/faff/bin/lib/effects.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const V02_EXAMPLES = join(HERE, "..", "verification", "commissaire-facade", "v0.2", "schema", "examples");
const V01_EXAMPLES = join(HERE, "..", "verification", "commissaire-facade", "v0.1", "schema", "examples");
const MERGE = { kind: "merge", target: "main" };

const MEANING = "every protected effect was declared, granted and observed, with no escapes";
const EXPLANATION = "conformed_to_contract: the run kept to its contract; every protected effect was declared, granted and observed, with no escapes. It does not mean the work was accepted.";

const runCom = (args, input) => runCli(["commissaire", ...args], { input });
const json = (r) => JSON.parse(r.stdout.trim());
const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const lines = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "");
const records = (p) => lines(p).map((l) => JSON.parse(l));
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

function legacyRunDir() {
  const dir = mkdtempSync(join(tmpdir(), "conclusion-kind-legacy-"));
  copyFileSync(join(V02_EXAMPLES, "source-run.declared-effects.jsonl"), join(dir, "declared-effects.jsonl"));
  mkdirSync(join(dir, "commissaire", "producer"), { recursive: true });
  copyFileSync(join(V02_EXAMPLES, "producer-pk.example.json"), join(dir, "commissaire", "producer", "pk.json"));
  return dir;
}

// A governed run dir with nothing declared yet (admit + scope merge). The per-step helpers below
// drive declare / authorize / observe so each scenario shapes its own chain of custody.
function governedBase() {
  const root = mkdtempSync(join(tmpdir(), "conclusion-kind-governed-"));
  const runDir = join(root, ".faff", "runs", "RUN-KIND");
  mkdirSync(runDir, { recursive: true });
  assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}
const declareEffects = (runDir, unit, effects) =>
  assert.equal(runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", unit, "--step", "merge"], JSON.stringify(effects)).code, 0);
const observeEffects = (runDir, unit, effects) =>
  assert.equal(runCom(["effect", "observe", "--run-dir", runDir, "--producer", "P1", "--unit-id", unit, "--step", "merge"], JSON.stringify(effects)).code, 0);
const authorizeEffect = (runDir, unit, effect, extraFlags = []) =>
  runCom(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", unit, "--step", "merge", ...extraFlags], JSON.stringify({ effect }));

// FAFF-1225: the canonical clean run now mints a merge grant BETWEEN declare and observe, so it
// keeps concluding cleanly under the grant-coverage rule (declared, granted, then observed).
function governedCleanRun(unit) {
  const { root, runDir, ledger } = governedBase();
  declareEffects(runDir, unit, [MERGE]);
  const auth = authorizeEffect(runDir, unit, MERGE);
  assert.equal(auth.code, 0, auth.stderr);
  assert.equal(json(auth).verdict, "grant", auth.stdout);
  observeEffects(runDir, unit, [MERGE]);
  return { root, runDir, ledger };
}

test("1. audit verify passes over the frozen v0.2 ledger and reports the legacy conclusion as verified", () => {
  const dir = legacyRunDir();
  try {
    const v = runCom(["audit", "verify", "--run-dir", dir, "--json"]);
    assert.equal(v.code, 0, v.stderr);
    const out = json(v);
    assert.equal(out.result, "pass");
    assert.deepEqual({ verified: out.commissaire_decisions.verified, failed: out.commissaire_decisions.failed }, { verified: 4, failed: 0 });
    assert.equal(out.producer_claims.unverifiable_without_secret, 4);
    const conclusion = out.records.find((r) => r.seq === 7);
    assert.equal(conclusion.kind_of_entry, LEGACY_CONCLUSION_KIND);
    assert.equal(conclusion.classification, "verified");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("2. re-concluding the frozen v0.2 ledger is idempotent, reports the stored legacy kind, and appends nothing", () => {
  const dir = legacyRunDir();
  const ledger = join(dir, "declared-effects.jsonl");
  const before = sha256File(ledger);
  try {
    for (let i = 0; i < 2; i += 1) {
      const r = runCom(["verdict", "conclude", "--run-dir", dir, "--unit-id", "DEMO-1"]);
      assert.equal(r.code, 0, r.stderr);
      const out = json(r);
      assert.equal(out.verdict, CONCLUSION_KIND);
      assert.equal(out.kind_of_entry, LEGACY_CONCLUSION_KIND);
      assert.equal(out.idempotent, true);
      assert.equal(out.seq, 7);
    }
    assert.equal(sha256File(ledger), before, "the ledger is byte-identical");
    assert.equal(lines(ledger).length, 8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("3. an issue-keyed v0.1 legacy conclusion re-concludes idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "conclusion-kind-v01-"));
  const ledger = join(dir, "declared-effects.jsonl");
  try {
    writeFileSync(ledger, JSON.stringify(JSON.parse(readFileSync(join(V01_EXAMPLES, "accepted-under-contract.example.json"), "utf8"))) + "\n");
    mkdirSync(join(dir, "commissaire", "producer"), { recursive: true });
    copyFileSync(join(V01_EXAMPLES, "producer-pk.example.json"), join(dir, "commissaire", "producer", "pk.json"));
    const before = sha256File(ledger);
    const r = runCom(["verdict", "conclude", "--run-dir", dir, "--unit-id", "FAFF-1138"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.equal(out.idempotent, true);
    assert.equal(out.kind_of_entry, LEGACY_CONCLUSION_KIND);
    assert.equal(out.seq, 23);
    assert.equal(sha256File(ledger), before);
    assert.equal(lines(ledger).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("4. KIND_AUTHOR lists the current kind only, and the constants carry the two names", () => {
  assert.equal(CONCLUSION_KIND, "conformed_to_contract");
  assert.equal(LEGACY_CONCLUSION_KIND, "accepted_under_contract");
  assert.equal(KIND_AUTHOR[CONCLUSION_KIND], "commissaire");
  assert.equal(Object.prototype.hasOwnProperty.call(KIND_AUTHOR, LEGACY_CONCLUSION_KIND), false);
});

test("5. conclusionKindOf returns each name for itself and null for anything else", () => {
  assert.equal(conclusionKindOf({ kind_of_entry: CONCLUSION_KIND }), CONCLUSION_KIND);
  assert.equal(conclusionKindOf({ kind_of_entry: LEGACY_CONCLUSION_KIND }), LEGACY_CONCLUSION_KIND);
  for (const record of [{ kind_of_entry: "declare" }, { kind_of_entry: "" }, { kind_of_entry: 5 }, {}, null, []]) {
    assert.equal(conclusionKindOf(record), null, JSON.stringify(record));
  }
});

test("6. --help explains conformed_to_contract once, in plain words", () => {
  const r = runCli(["commissaire", "--help"]);
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(countOf(output, EXPLANATION), 1);
  assert.equal(countOf(output, MEANING), 1);
});

test("7a. a producer-authored conclusion record of either kind does not count as concluded", () => {
  for (const kind of [CONCLUSION_KIND, LEGACY_CONCLUSION_KIND]) {
    const { root, runDir, ledger } = governedCleanRun("FAFF-1");
    try {
      const producerKey = Buffer.from(JSON.parse(readFileSync(producerFileOf(producerDirOf(runDir), "P1"), "utf8")).key_hex, "hex");
      appendProducerRecords(runDir, producerKey, "P1", "r1", [{ kind_of_entry: kind, unit_id: "FAFF-1", step: "conclude", payload: {} }], "2026-10-08T00:00:00.000Z");
      const planted = records(ledger).at(-1);
      assert.equal(planted.author, "producer");
      assert.equal(conclusionKindOf(planted), kind);
      const countBefore = lines(ledger).length;

      const r = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
      assert.equal(r.code, 0, r.stderr);
      const out = json(r);
      assert.notEqual(out.idempotent, true, `a producer ${kind} record is not a conclusion`);
      assert.equal(out.verdict, CONCLUSION_KIND);
      assert.equal(out.kind_of_entry, CONCLUSION_KIND);

      const after = records(ledger);
      assert.equal(after.length, countBefore + 1, "exactly one new record");
      const written = after.at(-1);
      assert.equal(written.author, "commissaire");
      assert.equal(written.kind_of_entry, CONCLUSION_KIND);
      assert.equal(written.seq, out.seq);
      const pk = JSON.parse(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8")).pk;
      assert.equal(verifyDecision(written, pk), true, "the new record's commissaire_sig verifies");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("7b. a legacy conclusion with one character of its signature altered does not count as concluded", () => {
  const dir = legacyRunDir();
  const ledger = join(dir, "declared-effects.jsonl");
  try {
    const all = records(ledger);
    const legacy = all.find((r) => r.seq === 7);
    legacy.commissaire_sig = (legacy.commissaire_sig[0] === "A" ? "B" : "A") + legacy.commissaire_sig.slice(1);
    writeFileSync(ledger, all.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const before = sha256File(ledger);

    const r = runCom(["verdict", "conclude", "--run-dir", dir, "--unit-id", "DEMO-1"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.notEqual(out.idempotent, true);
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "producer-not-admitted", "conclude ran its ordinary checks");
    assert.equal(sha256File(ledger), before, "nothing was appended");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("7c. a producer-dir pk.json that disagrees with the governor never makes re-conclude append a second conclusion", () => {
  const { root, runDir, ledger } = governedCleanRun("FAFF-1");
  try {
    const first = json(runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]));
    assert.equal(first.verdict, CONCLUSION_KIND);
    const other = mintGovernorKeypair();
    writeFileSync(pkFileOf(producerDirOf(runDir)), JSON.stringify({ pk: other.pk, pk_fingerprint: other.pk_fingerprint }));
    const countBefore = lines(ledger).length;

    const second = json(runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]));
    assert.equal(second.idempotent, true, "the governor key still authenticates the existing conclusion");
    assert.equal(second.seq, first.seq);
    assert.equal(lines(ledger).length, countBefore, "nothing was appended");
    assert.equal(records(ledger).filter((r) => conclusionKindOf(r) !== null).length, 1);

    const audit = runCom(["audit", "verify", "--run-dir", runDir, "--json"]);
    assert.equal(audit.code, 1, "audit verify still reports the tampered pk.json");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FAFF-1225: conclude refuses unless every observed protected effect has a signed covering grant.
test("8a. a governed run that declared, was granted, and observed a merge concludes cleanly", () => {
  const { root, runDir } = governedCleanRun("FAFF-1");
  try {
    const r = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.equal(out.verdict, CONCLUSION_KIND);
    assert.equal(out.kind_of_entry, CONCLUSION_KIND);
    const audit = runCom(["audit", "verify", "--run-dir", runDir, "--json"]);
    assert.equal(audit.code, 0, audit.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("8b. an observed protected merge that was never granted refuses ungranted-protected-effect / no-grant", () => {
  const { root, runDir, ledger } = governedBase();
  try {
    declareEffects(runDir, "FAFF-1", [MERGE]);
    observeEffects(runDir, "FAFF-1", [MERGE]);
    const before = sha256File(ledger);
    const r = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "ungranted-protected-effect");
    assert.equal(out.uncovered[0].sub_reason, "no-grant");
    assert.equal(out.uncovered[0].effect.kind, "merge");
    assert.equal(sha256File(ledger), before, "nothing was appended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("8c. a denied grant with the merge observed anyway refuses ungranted-protected-effect / denied", () => {
  const { root, runDir, ledger } = governedBase();
  try {
    declareEffects(runDir, "FAFF-1", [MERGE]);
    // --level L1 with no attendance denies at the level policy, so the signed verdict is a deny.
    const auth = authorizeEffect(runDir, "FAFF-1", MERGE, ["--level", "L1"]);
    assert.equal(auth.code, 0, auth.stderr);
    assert.equal(json(auth).verdict, "deny", auth.stdout);
    observeEffects(runDir, "FAFF-1", [MERGE]);
    const before = sha256File(ledger);
    const r = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "ungranted-protected-effect");
    assert.equal(out.uncovered[0].sub_reason, "denied");
    assert.equal(sha256File(ledger), before, "nothing was appended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("8d. a grant for a different descriptor refuses ungranted-protected-effect / descriptor-mismatch", () => {
  const { root, runDir, ledger } = governedBase();
  const OTHER = { kind: "merge", target: "other" };
  try {
    // Both targets are declared (so observing "main" is not an escape), but only "other" is granted.
    declareEffects(runDir, "FAFF-1", [MERGE, OTHER]);
    const auth = authorizeEffect(runDir, "FAFF-1", OTHER);
    assert.equal(auth.code, 0, auth.stderr);
    assert.equal(json(auth).verdict, "grant", auth.stdout);
    observeEffects(runDir, "FAFF-1", [MERGE]);
    const before = sha256File(ledger);
    const r = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "ungranted-protected-effect");
    assert.equal(out.uncovered[0].sub_reason, "descriptor-mismatch");
    assert.equal(sha256File(ledger), before, "nothing was appended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("8e. a grant minted after the effect (ask-forgiveness) refuses ungranted-protected-effect / grant-after-effect", () => {
  const { root, runDir, ledger } = governedBase();
  try {
    declareEffects(runDir, "FAFF-1", [MERGE]);
    observeEffects(runDir, "FAFF-1", [MERGE]);
    // The grant is minted AFTER the observation — later in the chain, so it does not cover it.
    const auth = authorizeEffect(runDir, "FAFF-1", MERGE);
    assert.equal(auth.code, 0, auth.stderr);
    assert.equal(json(auth).verdict, "grant", auth.stdout);
    const before = sha256File(ledger);
    const r = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
    assert.equal(r.code, 0, r.stderr);
    const out = json(r);
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "ungranted-protected-effect");
    assert.equal(out.uncovered[0].sub_reason, "grant-after-effect");
    assert.equal(sha256File(ledger), before, "nothing was appended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
