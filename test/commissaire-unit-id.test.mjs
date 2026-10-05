// FAFF-1167 — the schema:3 envelope unit key moves from `issue` to `unit_id`.
//
// New records carry `unit_id`; frozen `issue`-keyed records stay readable through the compatibility
// read in effects.js (unitIdOf / matchesUnit / carriesBothUnitKeys); a record carrying BOTH keys is
// rejected by every reader; the CLI takes `--unit-id` with `--issue` as a one-release alias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import { deriveKey, signRecord, signDecision } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import {
  LEDGER_CFG, appendProducerRecords, appendCommissaireRecord, buildEnvelope, evaluateDecisionRequest,
  governorFileOf, governorDirOf, producerFileOf, producerDirOf,
} from "../plugin/skills/faff/bin/lib/commissaire.js";
import { resolveCommissaireDecisionGrant, warnUncoveredMergeObserves } from "../plugin/skills/faff/bin/lib/merge-gate.js";
import { computeEscapes, unitIdOf, matchesUnit, carriesBothUnitKeys } from "../plugin/skills/faff/bin/lib/effects.js";
import { appendRecordsUnderLock } from "../plugin/skills/faff/bin/lib/events.js";
import { accountHumanMerge } from "../plugin/skills/faff/bin/lib/audit.js";
import { readDeclaredMergeEffects as reconcileDeclaredMerges, segmentCovered } from "../plugin/skills/faff/bin/lib/effects-reconcile.js";
import { foldEscapesIntoPlan } from "../plugin/skills/faff/bin/lib/bundle-recover.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, "fixtures", "commissaire", "secret-free-replay");
const MERGE = { kind: "merge", target: "main" };

function mkRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "RUN-UNIT");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}
const records = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const runCom = (args, input) => runCli(["commissaire", ...args], { input });
const json = (r) => JSON.parse(r.stdout.trim());

function admit(runDir) {
  assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
}
function declare(runDir, unit) {
  assert.equal(runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", unit, "--step", "merge"], JSON.stringify([MERGE])).code, 0);
}
// Plant a record exactly as a key holder could: chained under the ledger lock and signed.
function plant(runDir, body, sign) {
  appendRecordsUnderLock(runDir, LEDGER_CFG, 1, (_i, seq, _prev, prevHash) => {
    const rec = { schema: 3, run_id: "RUN-UNIT", seq, ts: "2026-10-05T00:00:00.000Z", producer_id: "P1", contract_revision: "r1", ...body, prev: prevHash };
    sign(rec);
    return rec;
  });
}
const producerKey = (runDir) => Buffer.from(JSON.parse(readFileSync(producerFileOf(producerDirOf(runDir), "P1"), "utf8")).key_hex, "hex");
const governor = (runDir) => JSON.parse(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8"));
const signAsProducer = (runDir) => (rec) => { rec.author = "producer"; rec.producer_hmac = signRecord(rec, producerKey(runDir)); };
const signAsCommissaire = (runDir) => (rec) => { rec.author = "commissaire"; rec.commissaire_sig = signDecision(rec, governor(runDir).sk); };

function treeDigest(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(dir.length)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

// --- the accessor -----------------------------------------------------------------------

test("unitIdOf resolves exactly one string unit key; dual-key, missing, non-string and empty units resolve to null", () => {
  assert.equal(unitIdOf({ unit_id: "U1" }), "U1");
  assert.equal(unitIdOf({ issue: "U1" }), "U1");
  assert.equal(unitIdOf({ issue: "U1", unit_id: "U1" }), null, "dual-key with equal values is rejected");
  assert.equal(unitIdOf({ issue: "A", unit_id: "B" }), null, "dual-key with different values is rejected");
  assert.equal(unitIdOf({}), null);
  assert.equal(unitIdOf({ unit_id: 5 }), null, "no number-to-string coercion");
  assert.equal(unitIdOf({ issue: true }), null, "no boolean-to-string coercion");
  assert.equal(unitIdOf({ unit_id: "" }), null);
  assert.equal(unitIdOf(null), null);
  assert.equal(carriesBothUnitKeys({ issue: "A", unit_id: "B" }), true);
  assert.equal(carriesBothUnitKeys({ issue: "A", unit_id: undefined }), false, "an undefined value is not a present key (JSON meaning)");
});

test("matchesUnit never matches an unresolved side (the round-1 undefined == undefined path is closed)", () => {
  assert.equal(matchesUnit({}, undefined), false);
  assert.equal(matchesUnit({ issue: "A", unit_id: "B" }, undefined), false);
  assert.equal(matchesUnit({ issue: "A", unit_id: "B" }, "A"), false);
  assert.equal(matchesUnit({ unit_id: 5 }, "5"), false);
  assert.equal(matchesUnit({ unit_id: "U" }, "U"), true);
  assert.equal(matchesUnit({ issue: "U" }, "U"), true);
});

// --- the writer -------------------------------------------------------------------------

test("writer: new records carry unit_id, never issue; schema stays 3 and step is unchanged", () => {
  const { root, runDir, ledger } = mkRun("unit-writer-");
  try {
    admit(runDir);
    declare(runDir, "FAFF-1");
    assert.equal(runCom(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: MERGE })).code, 0);
    assert.equal(runCom(["effect", "observe", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], JSON.stringify([MERGE])).code, 0);
    const conc = runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "FAFF-1"]);
    assert.equal(json(conc).verdict, "accepted_under_contract");
    const recs = records(ledger);
    assert.equal(recs.length, 6);
    for (const r of recs) {
      assert.equal(r.schema, 3);
      assert.ok(!Object.prototype.hasOwnProperty.call(r, "issue"), `seq ${r.seq} carries no issue key`);
      assert.equal(typeof r.unit_id, "string");
    }
    assert.equal(recs[0].unit_id, "-", "the admission carries unit_id \"-\"");
    assert.deepEqual(recs.map((r) => r.step), ["admit", "merge", "merge", "merge", "merge", "conclude"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writer: a body carrying issue, both keys, or no string unit_id throws before the ledger is touched", () => {
  const { root, runDir, ledger } = mkRun("unit-writer-reject-");
  try {
    admit(runDir);
    const before = readFileSync(ledger);
    const key = producerKey(runDir);
    for (const body of [
      { kind_of_entry: "declare", issue: "FAFF-1", step: "merge", effect: MERGE },
      { kind_of_entry: "declare", issue: "FAFF-1", unit_id: "FAFF-1", step: "merge", effect: MERGE },
      { kind_of_entry: "declare", step: "merge", effect: MERGE },
      { kind_of_entry: "declare", unit_id: 7, step: "merge", effect: MERGE },
    ]) {
      assert.throws(() => appendProducerRecords(runDir, key, "P1", "r1", [body], "t"), TypeError);
      assert.throws(() => appendCommissaireRecord(runDir, governor(runDir).sk, "P1", "r1", body, "t"), TypeError);
      assert.throws(() => buildEnvelope("RUN-UNIT", 1, "p", "producer", "P1", "r1", body, "t"), TypeError);
    }
    assert.ok(readFileSync(ledger).equals(before), "no rejected body reached the ledger");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- frozen records ---------------------------------------------------------------------

test("frozen fixture: the issue-keyed verdict resolves valid-grant, conclude finds FAFF-1's records, and no byte changes", () => {
  const before = treeDigest(FIXTURE_ROOT);
  const root = mkdtempSync(join(tmpdir(), "unit-frozen-"));
  try {
    const copy = join(root, "secret-free-replay");
    cpSync(FIXTURE_ROOT, copy, { recursive: true });
    assert.equal(resolveCommissaireDecisionGrant(copy, "FAFF-1", "main"), "valid-grant", "the compatibility read resolves the frozen grant");
    const c1 = runCom(["verdict", "conclude", "--run-dir", copy, "--unit-id", "FAFF-1"]);
    assert.equal(c1.code, 0);
    assert.equal(json(c1).verdict, "refused");
    assert.equal(json(c1).reason, "producer-not-admitted", "the unit filter found FAFF-1's records (no-evidence would mean none)");
    assert.equal(json(c1).issue, "FAFF-1");
    assert.equal(json(c1).unit_id, "FAFF-1");
    const c2 = runCom(["verdict", "conclude", "--run-dir", copy, "--unit-id", "FAFF-2"]);
    assert.equal(json(c2).reason, "no-evidence");
    assert.deepEqual(treeDigest(copy), before, "the scratch copy is byte-identical after the reads");
    const v = runCom(["audit", "verify", "--run-dir", FIXTURE_ROOT, "--json"]);
    assert.equal(v.code, 0);
    assert.equal(json(v).result, "pass");
  } finally { rmSync(root, { recursive: true, force: true }); }
  assert.deepEqual(treeDigest(FIXTURE_ROOT), before, "the committed fixture is byte-identical");
});

// --- dual-key rejection (the planted negatives) ------------------------------------------

test("planted dual-key declare: authorize denies invalid-unit-key, reconcile reports rejected-unit-key, conclude refuses, audit verify passes", () => {
  const { root, runDir } = mkRun("unit-dual-cli-");
  try {
    admit(runDir);
    declare(runDir, "U");
    plant(runDir, { kind_of_entry: "declare", issue: "A", unit_id: "B", step: "merge", effect: MERGE }, signAsProducer(runDir));
    const auth = runCom(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", "U", "--step", "merge"], JSON.stringify({ effect: MERGE }));
    assert.equal(auth.code, 0);
    assert.equal(json(auth).verdict, "deny");
    assert.equal(json(auth).reason, "invalid-unit-key");
    const rec = json(runCom(["effect", "reconcile", "--run-dir", runDir, "--unit-id", "U"]));
    assert.equal(rec.any_escape, true);
    const rejected = rec.escapes.filter((e) => e.signal === "rejected-unit-key");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].issue, null);
    assert.equal(rejected[0].unit_id, null);
    assert.deepEqual(rejected[0].escaped, [MERGE]);
    const conc = json(runCom(["verdict", "conclude", "--run-dir", runDir, "--unit-id", "U"]));
    assert.equal(conc.verdict, "refused");
    assert.equal(conc.reason, "unreconciled-escape");
    const v = runCom(["audit", "verify", "--run-dir", runDir, "--json"]);
    assert.equal(v.code, 0, "the planted record is authentic, so the auth leg passes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pure core: a signed dual-key request is denied invalid-unit-key, ahead of the scope leg", () => {
  const admission = { status: "admitted", admitted_scope: ["merge"], contract_revision: "r1" };
  const key = deriveKey("m", "P1", "r1");
  const req = (kind) => {
    const r = { schema: 3, author: "producer", producer_id: "P1", contract_revision: "r1", seq: 1,
      kind_of_entry: "effect-decision-request", issue: "A", unit_id: "B", step: "merge", payload: { effect: { kind, target: "main", reversible: true } } };
    r.producer_hmac = signRecord(r, key);
    return r;
  };
  const dualDeclare = { kind_of_entry: "declare", issue: "A", unit_id: "B", step: "merge", effect: MERGE, seq: 0 };
  assert.deepEqual(evaluateDecisionRequest(admission, req("merge"), key, [dualDeclare]), { verdict: "deny", reason: "invalid-unit-key" });
  assert.equal(evaluateDecisionRequest(admission, req("deploy"), key, []).reason, "invalid-unit-key", "the unit leg runs before the scope leg");
});

test("grant resolver: a governor-signed dual-key verdict never resolves a grant", () => {
  const { root, runDir } = mkRun("unit-dual-grant-");
  try {
    admit(runDir);
    const verdict = (unitKeys) => ({ kind_of_entry: "effect-decision-verdict", ...unitKeys, step: "merge", payload: { verdict: "grant", reason: "all-legs-pass", effect: MERGE } });
    plant(runDir, verdict({ issue: "X", unit_id: "U" }), signAsCommissaire(runDir));
    assert.equal(resolveCommissaireDecisionGrant(runDir, "U", "main"), "absent-or-invalid");
    assert.equal(resolveCommissaireDecisionGrant(runDir, "X", "main"), "absent-or-invalid");
    plant(runDir, verdict({ unit_id: "V" }), signAsCommissaire(runDir));
    assert.equal(resolveCommissaireDecisionGrant(runDir, "V", "main"), "valid-grant", "positive control: the same verdict keyed on unit_id alone grants");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("computeEscapes: each dual-key record is its own rejected-unit-key escape; a no-unit record is not", () => {
  const r = computeEscapes([
    { kind_of_entry: "declare", issue: "A", unit_id: "B", step: "merge", seq: 1, effect: MERGE },
    { kind_of_entry: "observe", issue: "A", unit_id: "B", step: "merge", seq: 2, effect: MERGE },
    { kind_of_entry: "observe", step: "merge", seq: 3, effect: { kind: "push", target: "x" } },
  ], null);
  const rejected = r.escapes.filter((e) => e.signal === "rejected-unit-key");
  assert.equal(rejected.length, 2, "the dual-key declare covers nothing and both surface separately");
  assert.deepEqual(rejected.map((e) => e.seq), [1, 2]);
  for (const e of rejected) { assert.equal(e.issue, null); assert.deepEqual(e.escaped, [MERGE]); }
  const plain = r.escapes.filter((e) => e.signal === "escaped-side-effect");
  assert.equal(plain.length, 1, "the no-unit observe keeps today's escaped-side-effect shape");
  assert.equal(plain[0].issue, null);

  const filtered = computeEscapes([
    { kind_of_entry: "observe", issue: "A", unit_id: "B", step: "merge", seq: 1, effect: MERGE },
    { kind_of_entry: "observe", step: "merge", seq: 2, effect: MERGE },
  ], "FAFF-X");
  assert.deepEqual(filtered.escapes.map((e) => e.signal), ["rejected-unit-key"],
    "under a unit filter a dual-key record still surfaces, and a no-unit record matches no filter");
});

test("computeEscapes: a no-unit declare never covers an observe whose unit is the string \"null\"", () => {
  const r = computeEscapes([
    { kind_of_entry: "declare", step: "merge", seq: 1, effect: MERGE },
    { kind_of_entry: "observe", unit_id: "null", step: "merge", seq: 2, effect: MERGE },
  ], null);
  assert.equal(r.escapes.length, 1);
  assert.equal(r.escapes[0].issue, "null");
});

test("bundle-recover: a rejected-unit-key escape parks as an issue:null entry, never a silent resume", () => {
  const { escapes } = computeEscapes([{ kind_of_entry: "observe", issue: "A", unit_id: "B", step: "merge", seq: 4, effect: MERGE }], null);
  const plan = foldEscapesIntoPlan({ continue_from_push: ["A", "B"], park: [] }, escapes);
  assert.equal(plan.park.length, 1);
  assert.equal(plan.park[0].issue, null);
  assert.deepEqual(plan.continue_from_push, ["A", "B"], "no named unit is pulled, because the record names none");
});

// --- every reader resolves unit_id and the legacy issue key -------------------------------

test("mixed ledger: a schema:3 unit_id declare covers a schema:2 issue observe for the same unit and step", () => {
  const r = computeEscapes([
    { schema: 3, kind_of_entry: "declare", unit_id: "FAFF-7", step: "merge", effect: MERGE },
    { schema: 2, kind_of_entry: "observe", issue: "FAFF-7", step: "merge", effect: MERGE },
  ], "FAFF-7");
  assert.equal(r.any_escape, false);
});

test("evaluateDecisionRequest: coverage and freshness resolve unit_id and legacy issue entries", () => {
  const admission = { status: "admitted", admitted_scope: ["merge"], contract_revision: "r1" };
  const key = deriveKey("m", "P1", "r1");
  const req = (extra) => {
    const r = { schema: 3, author: "producer", producer_id: "P1", contract_revision: "r1", seq: 9,
      kind_of_entry: "effect-decision-request", unit_id: "FAFF-1", step: "merge", payload: { effect: MERGE, ...extra } };
    r.producer_hmac = signRecord(r, key);
    return r;
  };
  for (const unitKey of ["unit_id", "issue"]) {
    const decl = { kind_of_entry: "declare", [unitKey]: "FAFF-1", step: "merge", effect: MERGE, seq: 0 };
    const obs = { kind_of_entry: "observe", [unitKey]: "FAFF-1", step: "merge", effect: MERGE, seq: 5 };
    assert.equal(evaluateDecisionRequest(admission, req(), key, [decl]).verdict, "grant", `${unitKey} declare covers`);
    assert.equal(evaluateDecisionRequest(admission, req({ evidence_seq: 0 }), key, [decl, obs]).reason, "stale-evidence", `${unitKey} observe drives freshness`);
  }
});

test("merge-gate readDeclaredMergeEffects (via the observe warning) finds a unit_id declare and ignores a dual-key one", () => {
  const { root, runDir } = mkRun("unit-mg-");
  const errs = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  try {
    admit(runDir);
    declare(runDir, "FAFF-3");
    process.stderr.write = (s) => { errs.push(String(s)); return true; };
    warnUncoveredMergeObserves(runDir, "FAFF-3", [MERGE]);
    plant(runDir, { kind_of_entry: "declare", issue: "FAFF-4", unit_id: "FAFF-4", step: "merge", effect: MERGE }, signAsProducer(runDir));
    warnUncoveredMergeObserves(runDir, "FAFF-4", [MERGE]);
  } finally {
    process.stderr.write = realWrite;
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(errs.length, 1, "only the dual-key unit warns");
});

test("accountHumanMerge: a unit_id merge declaration counts; a dual-key one does not", () => {
  const override = { reason: "operator merge", pr: 12 };
  const merged = { merged: true };
  const ok = accountHumanMerge("FAFF-5", override, merged, [
    { kind_of_entry: "declare", unit_id: "FAFF-5", step: "merge", effect: { kind: "merge", target: "pr:12" } },
    { kind_of_entry: "observe", unit_id: "FAFF-5", step: "merge", effect: { kind: "merge", target: "pr:12" } },
  ]);
  assert.equal(ok.declare_present, true);
  assert.equal(ok.landing_covered, true);
  const dual = accountHumanMerge("FAFF-5", override, merged, [
    { kind_of_entry: "declare", issue: "FAFF-5", unit_id: "FAFF-5", step: "merge", effect: { kind: "merge", target: "pr:12" } },
    { kind_of_entry: "observe", unit_id: "FAFF-5", step: "merge", effect: { kind: "merge", target: "pr:12" } },
  ]);
  assert.equal(dual.declare_present, false);
  assert.equal(dual.landing_covered, false);
});

test("effects-reconcile: unit_id declarations attribute a segment; dual-key declarations cover nothing", () => {
  const { root, runDir, ledger } = mkRun("unit-er-");
  try {
    writeFileSync(ledger, [
      { kind_of_entry: "declare", unit_id: "FAFF-6", step: "merge", effect: { kind: "merge", target: "pr:6" } },
      { kind_of_entry: "declare", issue: "FAFF-8", step: "merge", effect: { kind: "merge", target: "pr:8" } },
      { kind_of_entry: "declare", issue: "FAFF-9", unit_id: "FAFF-9", step: "merge", effect: { kind: "merge", target: "*" } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const declared = reconcileDeclaredMerges(runDir);
    assert.deepEqual(declared, [{ issue: "FAFF-6", target: "pr:6" }, { issue: "FAFF-8", target: "pr:8" }]);
    const seg = (issue, sha) => ({ issue, commits: [], tip: { sha, subject: "x" } });
    assert.equal(segmentCovered(seg("FAFF-6", "s6"), ["FAFF-6"], declared, new Set(["commit:s6"])), true);
    assert.equal(segmentCovered(seg("FAFF-9", "s9"), ["FAFF-9"], declared, new Set(["commit:s9"])), false, "the dual-key wildcard covers nothing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- the CLI alias ----------------------------------------------------------------------

test("--issue is a one-release alias of --unit-id on declare, conclude and anchor, with one deprecation line", () => {
  const { root, runDir, ledger } = mkRun("unit-alias-");
  try {
    admit(runDir);
    const d = runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([MERGE]));
    assert.equal(d.code, 0);
    assert.equal(d.stderr.match(/--issue is deprecated/g).length, 1);
    assert.equal(records(ledger).at(-1).unit_id, "FAFF-1");
    const c = runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1"]);
    assert.equal(c.code, 0);
    assert.match(c.stderr, /--issue is deprecated/);
    assert.equal(json(c).unit_id, "FAFF-1");
    assert.equal(json(c).issue, "FAFF-1");
    writeFileSync(join(runDir, "events.jsonl"), JSON.stringify({ schema: 1, run_id: "RUN-UNIT", seq: 0, ts: "2026-10-05T00:00:00.000Z", phase: "run", type: "run-start" }) + "\n");
    const a = runCom(["audit", "anchor", "--run-dir", runDir, "--issue", "FAFF-1", "--dest", join(root, "anchor")]);
    assert.equal(a.code, 0, a.stderr);
    assert.match(a.stderr, /--issue is deprecated/);
    assert.equal(json(a).issue, "FAFF-1");
    assert.equal(json(a).unit_id, "FAFF-1");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--issue together with --unit-id is a usage error, with equal or different values, and writes nothing", () => {
  const { root, runDir, ledger } = mkRun("unit-both-");
  try {
    admit(runDir);
    const before = readFileSync(ledger);
    for (const other of ["FAFF-1", "FAFF-2"]) {
      const r = runCom(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--issue", other, "--step", "merge"], JSON.stringify([MERGE]));
      assert.equal(r.code, 2);
      assert.match(r.stderr, /pass --unit-id only/);
    }
    assert.ok(readFileSync(ledger).equals(before));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
