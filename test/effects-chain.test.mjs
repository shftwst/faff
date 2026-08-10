// FAFF-621 — the tamper-evident hash chain over declared-effects.jsonl (schema 2), the
// second append-only ledger, mirroring the FAFF-564 events chain. Every record's `prev` is
// the SHA-256 of the previous physical line's raw bytes (genesis: of the UTF-8 run_id),
// minted inside the FAFF-574 locked append core — now the BATCH core, so the N descriptors
// of one declare/observe land as N contiguous chained records under one lock. These tests
// prove the chain rule end-to-end on the effects ledger: genesis + per-line prev, tamper →
// `broken` (via `faff effects verify` AND the governance-check integrity leg), absent-is-a-
// no-op, legacy/mixed classification, the anchor byte-copy + effects-chain-head.json witness,
// and the spec's integration smoke test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEffectEntries } from "../plugin/skills/faff/bin/lib/effects.js";
import { verifyEffectsChain } from "../plugin/skills/faff/bin/lib/events.js";
import { evaluateIntegrityLeg } from "../plugin/skills/faff/bin/lib/governance-check.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function mkRoot(prefix, runId = "RUN-E") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}

const physicalLines = (p) => {
  const raw = readFileSync(p); const out = []; let start = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] === 0x0a) { out.push(raw.subarray(start, i)); start = i + 1; }
  if (start < raw.length) out.push(raw.subarray(start));
  return out;
};
const records = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

// --- Scenario (holdout): genesis + per-line prev over one 3-descriptor batch ---
test("a 3-descriptor declare mints seqs 0,1,2; record 0 prev = sha256(run_id); each later prev = sha256 of the previous physical line", () => {
  const { runDir, ledger } = mkRoot("effects-genesis-");
  try {
    const r = appendEffectEntries(runDir, "declare", "FAFF-621", "build",
      [{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }, { kind: "file-write", target: "c" }], "t");
    assert.equal(r.written.length, 3);
    assert.deepEqual(r.written.map((x) => x.seq), [0, 1, 2], "contiguous seqs 0..2");
    for (const x of r.written) assert.equal(x.schema, 2, "every record is schema 2");
    const lines = physicalLines(ledger);
    assert.equal(r.written[0].prev, sha256(Buffer.from("RUN-E", "utf8")), "record 0's prev is genesis sha256(run_id)");
    assert.equal(r.written[1].prev, sha256(lines[0]), "record 1's prev is sha256 of physical line 0");
    assert.equal(r.written[2].prev, sha256(lines[1]), "record 2's prev is sha256 of physical line 1");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// --- Scenario: valid chain verifies; absent ledger verifies (nothing to verify) ---
test("faff effects verify: a valid schema-2 chain → verified, exit 0; an absent ledger also → verified, exit 0", () => {
  const { root, runDir } = mkRoot("effects-verify-ok-");
  try {
    // Absent ledger first.
    const absent = run(root, ["effects", "verify", "--run", "RUN-E", "--json"]);
    assert.equal(absent.code, 0, absent.err);
    assert.equal(JSON.parse(absent.out).status, "verified");
    // Now declare + observe → a present chain, still verified.
    run(root, ["effects", "declare", "--run", "RUN-E", "--issue", "FAFF-1", "--step", "build", "--ts", "t"],
      JSON.stringify([{ kind: "merge", target: "main" }, { kind: "deploy", target: "prod" }]));
    run(root, ["effects", "observe", "--run", "RUN-E", "--issue", "FAFF-1", "--step", "build", "--ts", "t"],
      JSON.stringify({ kind: "merge", target: "main" }));
    assert.equal(records(join(runDir, "declared-effects.jsonl")).length, 3);
    const ok = run(root, ["effects", "verify", "--run", "RUN-E", "--json"]);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(JSON.parse(ok.out).status, "verified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: a mid-record byte tamper → broken at the following line, gates -----
test("tamper: editing one byte of a middle record → effects verify `broken` (first-break line) AND the governance integrity leg fails", () => {
  const { root, runDir, ledger } = mkRoot("effects-tamper-");
  try {
    appendEffectEntries(runDir, "declare", "FAFF-1", "build",
      [{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }, { kind: "email", target: "c" }], "t");
    // Clean first.
    assert.equal(verifyEffectsChain(runDir, {}).status, "verified");
    assert.equal(evaluateIntegrityLeg(runDir, "pass").pass, true, "clean chain → integrity leg passes");
    // Tamper line 2 in place (same byte length — a pure content edit of the target).
    const lines = readFileSync(ledger, "utf8").split("\n");
    lines[1] = lines[1].replace('"target":"b"', '"target":"X"');
    writeFileSync(ledger, lines.join("\n"));
    const v = run(root, ["effects", "verify", "--run", "RUN-E", "--json"]);
    assert.equal(v.code, 1, "a broken effects chain exits 1");
    const parsed = JSON.parse(v.out);
    assert.equal(parsed.status, "broken");
    assert.equal(parsed.first_break.line, 3, "the record AFTER the edited line is the first mismatch");
    // And it GATES: the governance-check integrity leg fails the run.
    const leg = evaluateIntegrityLeg(runDir, "pass");
    assert.equal(leg.pass, false, "a broken declared-effects.jsonl fails the integrity leg");
    assert.match(leg.detail, /declared-effects\.jsonl/, "the failing detail names the effects ledger");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: a DELETED middle record breaks the chain too ----------------------
test("tamper: deleting a middle record → the chain is broken (a deletion shifts the physical lines the next prev hashes)", () => {
  const { root, runDir, ledger } = mkRoot("effects-delete-");
  try {
    appendEffectEntries(runDir, "declare", "FAFF-1", "build",
      [{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }, { kind: "email", target: "c" }], "t");
    const lines = records(ledger);
    // Drop the middle record.
    writeFileSync(ledger, [JSON.stringify(lines[0]), JSON.stringify(lines[2])].join("\n") + "\n");
    const v = run(root, ["effects", "verify", "--run", "RUN-E", "--json"]);
    assert.equal(v.code, 1, "a record deletion is detected byte-for-byte");
    assert.equal(JSON.parse(v.out).status, "broken");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: legacy schema-1 + mixed classification (mirrors events) -----------
test("legacy schema-1 effects ledger classifies legacy-unverifiable; a mixed log classifies mixed, gated only under --legacy-policy fail", () => {
  const { root, runDir, ledger } = mkRoot("effects-legacy-");
  try {
    // A pure schema-1 (pre-621) effects ledger.
    writeFileSync(ledger, [
      JSON.stringify({ schema: 1, run_id: "RUN-E", seq: 0, ts: "t", kind_of_entry: "declare", issue: "FAFF-1", step: "build", effect: { kind: "merge", target: "main", reversible: true } }),
      JSON.stringify({ schema: 1, run_id: "RUN-E", seq: 1, ts: "t", kind_of_entry: "observe", issue: "FAFF-1", step: "build", effect: { kind: "merge", target: "main", reversible: true } }),
    ].join("\n") + "\n");
    assert.equal(run(root, ["effects", "verify", "--run", "RUN-E", "--json"]).code, 0, "legacy passes under the default policy");
    assert.equal(JSON.parse(run(root, ["effects", "verify", "--run", "RUN-E", "--json"]).out).status, "legacy-unverifiable");
    assert.equal(run(root, ["effects", "verify", "--run", "RUN-E", "--legacy-policy", "fail"]).code, 1, "legacy fails under legacy-policy fail");
    // Now append a schema-2 record (a pre-621 ledger a 621 CLI continues) → mixed.
    appendEffectEntries(runDir, "declare", "FAFF-1", "ship", [{ kind: "deploy", target: "prod" }], "t");
    const m = run(root, ["effects", "verify", "--run", "RUN-E", "--json"]);
    assert.equal(m.code, 0, "mixed passes under the default policy");
    assert.equal(JSON.parse(m.out).status, "mixed");
    assert.equal(run(root, ["effects", "verify", "--run", "RUN-E", "--legacy-policy", "fail"]).code, 1, "mixed fails under legacy-policy fail");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: anchor byte-copies the ledger + writes the witness; witness-absent gates ---
test("faff events anchor: an anchored run carrying declared-effects.jsonl gets a byte-identical copy + effects-chain-head.json; deleting the witness fails closed as an anchor", () => {
  const { root, runDir } = mkRoot("effects-anchor-", "RUN-A");
  try {
    // Both ledgers present (anchor requires events.jsonl; effects is the new addition).
    run(root, ["events", "append", "--run", "RUN-A", "--ts", "t"], JSON.stringify({ phase: "run", type: "run-start" }));
    appendEffectEntries(runDir, "declare", "FAFF-1", "build", [{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }], "t");
    const dest = join(root, "anchor");
    const a = run(root, ["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-1", "--dest", dest]);
    assert.equal(a.code, 0, a.err);
    // Byte-identical copy + a witness.
    assert.deepEqual(readFileSync(join(dest, "declared-effects.jsonl")), readFileSync(join(runDir, "declared-effects.jsonl")), "declared-effects.jsonl byte-copied");
    assert.ok(existsSync(join(dest, "effects-chain-head.json")), "effects-chain-head.json written");
    // The anchor passes the integrity leg (both chains verify, both witnesses present).
    assert.equal(evaluateIntegrityLeg(dest, "pass", { requireWitness: true }).pass, true, "honest anchor passes");
    // Delete ONLY the effects witness → witness-absent fail-closed as an anchor.
    rmSync(join(dest, "effects-chain-head.json"));
    const leg = evaluateIntegrityLeg(dest, "pass", { requireWitness: true });
    assert.equal(leg.pass, false, "a present effects ledger with no effects-chain-head.json fails closed");
    assert.equal(leg.status, "witness-absent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("anchor: a run with NO declared-effects.jsonl copies no effects ledger and writes no effects witness — the effects leg is a clean no-op", () => {
  const { root, runDir } = mkRoot("effects-anchor-absent-", "RUN-A2");
  try {
    run(root, ["events", "append", "--run", "RUN-A2", "--ts", "t"], JSON.stringify({ phase: "run", type: "run-start" }));
    const dest = join(root, "anchor");
    assert.equal(run(root, ["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-1", "--dest", dest]).code, 0);
    assert.ok(!existsSync(join(dest, "declared-effects.jsonl")), "no effects ledger copied");
    assert.ok(!existsSync(join(dest, "effects-chain-head.json")), "no effects witness written");
    assert.equal(evaluateIntegrityLeg(dest, "pass", { requireWitness: true }).pass, true, "an absent effects ledger never trips witness-absent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- The spec's integration smoke test -------------------------------------------
test("integration smoke: 3 declares + 2 observes → 5 schema-2 lines seq 0..4, verify ok, byte-flip → broken@line, anchor carries ledger+witness, delete witness → witness-absent", () => {
  const { root, runDir, ledger } = mkRoot("effects-smoke-", "RUN-SM");
  try {
    run(root, ["events", "append", "--run", "RUN-SM", "--ts", "t"], JSON.stringify({ phase: "run", type: "run-start" }));
    run(root, ["effects", "declare", "--run", "RUN-SM", "--issue", "FAFF-1", "--step", "build", "--ts", "t"],
      JSON.stringify([{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }, { kind: "email", target: "c" }]));
    run(root, ["effects", "observe", "--run", "RUN-SM", "--issue", "FAFF-1", "--step", "build", "--ts", "t"],
      JSON.stringify([{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }]));
    const recs = records(ledger);
    assert.equal(recs.length, 5, "5 schema-2 lines");
    assert.deepEqual(recs.map((r) => r.seq), [0, 1, 2, 3, 4], "seqs 0..4");
    for (const r of recs) assert.equal(r.schema, 2);
    assert.equal(run(root, ["effects", "verify", "--run", "RUN-SM"]).code, 0, "verified, exit 0");
    // Flip one byte in line 3.
    const lines = readFileSync(ledger, "utf8").split("\n");
    lines[2] = lines[2].replace('"target":"c"', '"target":"Z"');
    writeFileSync(ledger, lines.join("\n"));
    const broken = run(root, ["effects", "verify", "--run", "RUN-SM", "--json"]);
    assert.equal(broken.code, 1, "broken, exit 1");
    assert.equal(JSON.parse(broken.out).first_break.line, 4);
    // Restore + anchor.
    lines[2] = lines[2].replace('"target":"Z"', '"target":"c"');
    writeFileSync(ledger, lines.join("\n"));
    const dest = join(root, "anchor");
    assert.equal(run(root, ["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-1", "--dest", dest]).code, 0);
    assert.ok(existsSync(join(dest, "declared-effects.jsonl")) && existsSync(join(dest, "effects-chain-head.json")));
    assert.equal(evaluateIntegrityLeg(dest, "pass", { requireWitness: true }).pass, true);
    rmSync(join(dest, "effects-chain-head.json"));
    assert.equal(evaluateIntegrityLeg(dest, "pass", { requireWitness: true }).status, "witness-absent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
