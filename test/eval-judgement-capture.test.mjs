// FAFF-320 — durable per-rep raw-judgement capture. Deterministic, mock-driver only (no frontier
// calls, no `claude -p`). Asserts the JudgementRecord schema, the three completion branches, the
// RAW_CAP bound, the I/O-free opt-out, and the advisory-only invariant (capture never moves a result).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runEvals, capRaw, buildJudgementRecord, mintRunId, appendJudgement, RAW_CAP,
} from "../eval/run-evals.mjs";

// A mock driver env (the same shape eval-grader.test.mjs uses): a well-formed faff-eval:judgement block.
const envOf = (id, payload) => ({ rawText: '```faff-eval:judgement\n' + JSON.stringify({ case_id: id, ...payload }) + '\n```', tokens: 3 });
const dupeCase = { id: "d", kind: "dupe", oracle: { closed_set: ["A", "B"] } };
// A path under a run-id dir (runCase derives run_id = basename(dirname(path)), matching mintCapturePath).
function capturePath(runId = "20260713-120000") {
  return join(mkdtempSync(join(tmpdir(), "faff320-")), runId, "judgements.jsonl");
}
const linesOf = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// --- SCENARIO 1: one parseable JSONL line per completed rep, carrying case_id/kind/rep/oracle ---
test("capture: exactly one JudgementRecord line per completed rep, each parseable", async () => {
  const path = capturePath();
  const driver = async () => envOf("d", { classifications: { dupe: ["A", "B"] } });
  await runEvals({ cases: [dupeCase], driver, baseReps: 3, maxReps: 3, judgementsPath: path });
  const recs = linesOf(path);
  assert.equal(recs.length, 3, "one line per rep");
  recs.forEach((r, i) => {
    assert.equal(r.case_id, "d");
    assert.equal(r.kind, "dupe");
    assert.equal(r.rep, i);
    assert.deepEqual(r.oracle, { closed_set: ["A", "B"] });
    assert.equal(r.run_id, "20260713-120000"); // derived from the capture dir name
    assert.ok(typeof r.ts === "string" && r.ts.length > 0);
  });
});

// --- schema: a graded (happy-path) record carries the full field set ---
test("capture: a graded rep records status=graded + envelope/graded/score/signature", async () => {
  const path = capturePath();
  const driver = async () => envOf("d", { classifications: { dupe: ["A", "B"] } });
  await runEvals({ cases: [dupeCase], driver, baseReps: 1, maxReps: 1, judgementsPath: path });
  const [r] = linesOf(path);
  for (const k of ["run_id", "ts", "case_id", "kind", "rep", "status", "raw_text", "raw_truncated", "envelope", "graded", "score", "signature", "oracle"]) {
    assert.ok(k in r, `record has ${k}`);
  }
  assert.equal(r.status, "graded");
  assert.equal(r.graded, "PASS");
  assert.equal(r.score, 1);
  assert.ok(r.envelope && r.envelope.classifications, "envelope is the parsed judgement");
  assert.equal(r.raw_truncated, false);
  assert.ok(typeof r.signature === "string");
});

// --- SCENARIO 2: an envelope-parse-failure rep — status errored, envelope null, bounded raw_text ---
test("capture: an envelope-parse-failure rep records status=errored, envelope=null, the bounded failing raw_text", async () => {
  const path = capturePath();
  const broken = async () => ({ rawText: "the model forgot the block", tokens: 0 });
  await runEvals({ cases: [dupeCase], driver: broken, baseReps: 2, maxReps: 2, judgementsPath: path });
  const recs = linesOf(path);
  assert.equal(recs.length, 2);
  for (const r of recs) {
    assert.equal(r.status, "errored");
    assert.equal(r.envelope, null);
    assert.equal(r.graded, "ERRORED");
    assert.equal(r.score, null);
    assert.equal(r.signature, null);
    assert.equal(r.raw_text, "the model forgot the block"); // the failing output IS retained (bounded)
  }
});

// --- DONE edge: a driver-error rep — raw_text null, envelope null, graded ERRORED ---
test("capture: a driver-error rep records raw_text=null, envelope=null, graded=ERRORED", async () => {
  const path = capturePath();
  const throws = async () => { throw new Error("boom"); };
  await runEvals({ cases: [dupeCase], driver: throws, baseReps: 2, maxReps: 2, judgementsPath: path });
  const recs = linesOf(path);
  assert.equal(recs.length, 2);
  for (const r of recs) {
    assert.equal(r.status, "errored");
    assert.equal(r.raw_text, null);
    assert.equal(r.raw_truncated, false);
    assert.equal(r.envelope, null);
    assert.equal(r.graded, "ERRORED");
    assert.equal(r.score, null);
    assert.equal(r.signature, null);
  }
});

// --- SCENARIO 3: the mock-driver test path (no capture path) writes NOTHING ---
test("capture: no judgementsPath ⇒ no file created, no filesystem write (the I/O-free test path)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff320-none-"));
  const path = join(dir, "run", "judgements.jsonl");
  const driver = async () => envOf("d", { classifications: { dupe: ["A", "B"] } });
  await runEvals({ cases: [dupeCase], driver, baseReps: 3, maxReps: 3 }); // judgementsPath omitted → null
  assert.equal(existsSync(path), false, "capture file must not exist");
  assert.deepEqual(readdirSync(dir), [], "no dirs/files created under the tmp root");
});

// --- assertion: raw_text never exceeds RAW_CAP bytes; raw_truncated true exactly when capped ---
test("capture: raw_text is capped to RAW_CAP bytes with raw_truncated set exactly when capping occurs", async () => {
  // capRaw unit: at/under the cap is untouched; over the cap is truncated to <= RAW_CAP bytes.
  assert.deepEqual(capRaw(null), { raw_text: null, raw_truncated: false });
  assert.deepEqual(capRaw("abc"), { raw_text: "abc", raw_truncated: false });
  const exact = "x".repeat(RAW_CAP);
  assert.deepEqual(capRaw(exact), { raw_text: exact, raw_truncated: false });
  const over = capRaw("y".repeat(RAW_CAP + 5000));
  assert.equal(over.raw_truncated, true);
  assert.ok(Buffer.byteLength(over.raw_text, "utf8") <= RAW_CAP);

  // integration: a runaway model dump is captured truncated, never full-length.
  const path = capturePath();
  const huge = "z".repeat(RAW_CAP + 10000);
  const dumper = async () => ({ rawText: huge, tokens: 0 }); // not a valid envelope → errored branch retains raw_text
  await runEvals({ cases: [dupeCase], driver: dumper, baseReps: 1, maxReps: 1, judgementsPath: path });
  const [r] = linesOf(path);
  assert.equal(r.raw_truncated, true);
  assert.ok(Buffer.byteLength(r.raw_text, "utf8") <= RAW_CAP, "raw_text never exceeds RAW_CAP bytes");
});

// --- advisory-only invariant: capture must not move any result (per_kind byte-identical on vs off) ---
test("capture: advisory-only — the run summary is byte-identical with capture on vs off", async () => {
  const driver = async (c, i) => envOf("d", { classifications: { dupe: i % 2 ? ["A"] : ["A", "B"] } }); // wobbly, deterministic
  const path = capturePath();
  const withCap = await runEvals({ cases: [dupeCase], driver, baseReps: 2, maxReps: 6, judgementsPath: path });
  const without = await runEvals({ cases: [dupeCase], driver, baseReps: 2, maxReps: 6 });
  assert.equal(JSON.stringify(withCap), JSON.stringify(without), "capture changes no gate/oracle/per_kind outcome");
});

// --- run-id shape: YYYYMMDD-HHMMSS (lexical sort == chronological) ---
test("capture: mintRunId is YYYYMMDD-HHMMSS", () => {
  const id = mintRunId(new Date(2026, 6, 13, 9, 4, 5)); // month is 0-based → July
  assert.equal(id, "20260713-090405");
  assert.match(mintRunId(), /^\d{8}-\d{6}$/);
});

// --- buildJudgementRecord is a pure builder; appendJudgement is a no-op on a null path ---
test("capture: appendJudgement(null, …) is a no-op (opt-out guard)", () => {
  assert.doesNotThrow(() => appendJudgement(null, buildJudgementRecord(dupeCase, 0, "rid", { status: "graded" })));
});
