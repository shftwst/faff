// FAFF-564 — the tamper-evident hash chain over events.jsonl (schema 2), with ledger
// mutations folded in. Every record's `prev` is the SHA-256 of the previous physical
// line's raw bytes (genesis: of the UTF-8 run_id), computed inside the FAFF-574 locked
// critical section; every run-ledger.json write through atomicWriteLedger appends a
// chained `ledger-write` event whose data.ledger_sha256 is the post-write ledger bytes,
// always CLI-computed. These tests prove the chain rule end-to-end: tamper detection
// location, torn-line continuity, the oversized-previous-line backward extension, the
// ledger fold (hash + warn-never-throw failure path), the `events append` note-command
// hash injection, mixed-schema legality, and the spec's integration smoke test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendRecordUnderLock, tailReadState, TAIL_WINDOW_BYTES } from "../plugin/skills/faff/bin/lib/events.js";
import { atomicWriteLedger } from "../plugin/skills/faff/bin/lib/heartbeat.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(cwd, args, input, env) {
  const opts = { cwd, encoding: "utf8", input: input ?? "" };
  if (env) opts.env = { HOME: process.env.HOME, PATH: process.env.PATH, ...env };
  try {
    const out = execFileSync("node", [CLI, ...args], opts);
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function mkRoot(prefix, runId = "RUN-H") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, log: join(runDir, "events.jsonl"), ledger: join(runDir, "run-ledger.json") };
}

// Split a log into physical-line byte buffers (the foreign-implementer view: split on
// newlines, keep a torn trailing segment as its own line).
function physicalLines(log) {
  const raw = readFileSync(log);
  const out = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0a) { out.push(raw.subarray(start, i)); start = i + 1; }
  }
  if (start < raw.length) out.push(raw.subarray(start));
  return out;
}

// Re-hash line-by-line from genesis; returns the 1-based index of the FIRST schema-2
// record whose prev does not match, or null when the whole chain verifies.
function firstChainMismatch(log, runId) {
  let expected = sha256(Buffer.from(runId, "utf8"));
  const bufs = physicalLines(log);
  for (let i = 0; i < bufs.length; i++) {
    let rec = null;
    try { rec = JSON.parse(bufs[i].toString("utf8")); } catch { /* torn/legacy — still a link */ }
    if (rec && rec.schema === 2 && rec.prev !== expected) return i + 1;
    expected = sha256(bufs[i]);
  }
  return null;
}

function records(log) {
  return readFileSync(log, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

const mkMinter = (runId, type = "budget-checkpoint") =>
  (seq, _prev, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "run", type });

// --- Unit: mid-line tamper is caught at the first following record -----------
test("mid-line tamper: modifying one middle line's bytes → the record AFTER it is the first whose prev no longer matches", () => {
  const { root, runDir, log } = mkRoot("chain-tamper-");
  try {
    for (let i = 0; i < 5; i++) appendRecordUnderLock(runDir, mkMinter("RUN-H"));
    assert.equal(firstChainMismatch(log, "RUN-H"), null, "untampered chain verifies from genesis");
    // Tamper with line 3 in place (same byte length — a pure content edit).
    const lines = readFileSync(log, "utf8").split("\n");
    lines[2] = lines[2].replace('"phase":"run"', '"phase":"XXX"');
    writeFileSync(log, lines.join("\n"));
    assert.equal(firstChainMismatch(log, "RUN-H"), 4, "the record after the modified line is the first mismatch");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Unit: oversized previous line → backward extension, no counting fallback -
test("previous line larger than the tail window: prev still hashes the exact full bytes (backward chunk extension)", () => {
  const { root, runDir, log } = mkRoot("chain-bigline-");
  try {
    appendRecordUnderLock(runDir, mkMinter("RUN-H"));
    // A giant record whose line alone exceeds the tail window.
    const pad = "x".repeat(TAIL_WINDOW_BYTES + 2048);
    appendRecordUnderLock(runDir, (seq, _prev, prevHash) => ({ schema: 2, run_id: "RUN-H", seq, ts: "t", prev: prevHash, phase: "run", type: "budget-checkpoint", data: { pad } }));
    assert.ok(statSync(log).size > TAIL_WINDOW_BYTES, "fixture: the last line exceeds the window");
    const giantLineBytes = physicalLines(log)[1];
    // The under-lock state read extends backwards to the preceding newline.
    const st = tailReadState(log);
    assert.equal(st.prevLineBuf.length, giantLineBytes.length, "the full oversized line is read");
    // And the next append's prev is the hash of those exact bytes.
    const rec = appendRecordUnderLock(runDir, mkMinter("RUN-H"));
    assert.equal(rec.prev, sha256(giantLineBytes), "prev hashes the oversized previous line's exact bytes");
    assert.equal(firstChainMismatch(log, "RUN-H"), null, "the whole chain still verifies");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Unit: the ledger fold at atomicWriteLedger ------------------------------
test("atomicWriteLedger appends a chained ledger-write event whose ledger_sha256 is the SHA-256 of the on-disk run-ledger.json bytes", () => {
  const { root, runDir, log, ledger } = mkRoot("chain-fold-");
  try {
    atomicWriteLedger(runDir, { run_id: "RUN-H", admitted: [] });
    const recs = records(log);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].type, "ledger-write");
    assert.equal(recs[0].phase, "run");
    assert.equal(recs[0].run_id, "RUN-H", "run_id from ledger.run_id");
    assert.equal(recs[0].schema, 2);
    assert.equal(recs[0].data.ledger_sha256, sha256(readFileSync(ledger)), "hash of the exact bytes just written");
    assert.equal(firstChainMismatch(log, "RUN-H"), null, "the ledger-write is an ordinary chain link");
    // Fallback: a ledger with no run_id uses the run-dir basename.
    atomicWriteLedger(runDir, { admitted: [] });
    const recs2 = records(log);
    assert.equal(recs2[1].run_id, "RUN-H", "run_id falls back to the run-dir basename");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("atomicWriteLedger: a failing ledger-write append (events lock held) WARNS on stderr and never throws — the ledger write stands", () => {
  const { root, runDir, log, ledger } = mkRoot("chain-fold-fail-");
  try {
    // Hold the events lock so the fold's append exhausts its budget.
    writeFileSync(log + ".lock", JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    const errLines = [];
    const orig = process.stderr.write;
    process.stderr.write = (s) => { errLines.push(String(s)); return true; };
    try {
      assert.doesNotThrow(() => atomicWriteLedger(runDir, { run_id: "RUN-H", admitted: ["A-1"] }), "the fold failure never throws");
    } finally { process.stderr.write = orig; }
    assert.ok(errLines.some((l) => /ledger-write event append failed/.test(l)), "loud stderr warning");
    assert.deepEqual(JSON.parse(readFileSync(ledger, "utf8")).admitted, ["A-1"], "the ledger write is NOT rolled back");
    assert.ok(!existsSync(log), "no event was appended while the lock was held");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- CLI: the prose-layer note command ---------------------------------------
test("events append type ledger-write: data.ledger_sha256 is CLI-computed from the on-disk ledger, overwriting any caller-supplied value", () => {
  const { root, ledger, log } = mkRoot("chain-note-", "RUN-N");
  try {
    writeFileSync(ledger, JSON.stringify({ run_id: "RUN-N", outcomes: { "A-1": "shipped" } }, null, 2) + "\n");
    // Caller supplies a bogus hash — the CLI must overwrite it.
    const r = run(root, ["events", "append", "--run", "RUN-N", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "ledger-write", data: { ledger_sha256: "f".repeat(64) } }));
    assert.equal(r.code, 0, r.err);
    const recs = records(log);
    assert.equal(recs[0].data.ledger_sha256, sha256(readFileSync(ledger)), "hash computed from disk");
    assert.notEqual(recs[0].data.ledger_sha256, "f".repeat(64), "caller-supplied value overwritten");
    // The bare note command (no data at all) validates clean pre-injection and works.
    const r2 = run(root, ["events", "append", "--run", "RUN-N", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "ledger-write" }));
    assert.equal(r2.code, 0, r2.err);
    assert.equal(records(log)[1].data.ledger_sha256, sha256(readFileSync(ledger)));
    assert.equal(firstChainMismatch(log, "RUN-N"), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("events append type ledger-write with NO on-disk ledger → exit 3, nothing appended (never a fabricated hash)", () => {
  const { root, log } = mkRoot("chain-note-noledger-", "RUN-N");
  try {
    const r = run(root, ["events", "append", "--run", "RUN-N", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "ledger-write" }));
    assert.equal(r.code, 3);
    assert.match(r.err, /run-ledger\.json missing/);
    assert.ok(!existsSync(log), "nothing appended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Mixed-schema transition --------------------------------------------------
test("mixed-schema log: the first schema-2 record hashes the preceding schema-1 line like any other link; validate accepts both per-record", () => {
  const { root, runDir, log } = mkRoot("chain-mixed-", "RUN-M");
  try {
    // A legacy schema-1 prefix (written by a pre-564 CLI mid-deploy).
    const legacy = [
      JSON.stringify({ schema: 1, run_id: "RUN-M", seq: 0, ts: "t", phase: "run", type: "run-start" }),
      JSON.stringify({ schema: 1, run_id: "RUN-M", seq: 1, ts: "t", phase: "run", type: "budget-checkpoint" }),
    ];
    writeFileSync(log, legacy.join("\n") + "\n");
    const rec = appendRecordUnderLock(runDir, mkMinter("RUN-M"));
    assert.equal(rec.seq, 2, "seq continues the legacy stream");
    assert.equal(rec.prev, sha256(Buffer.from(legacy[1], "utf8")), "the first schema-2 record's prev hashes the preceding schema-1 line");
    const v = run(root, ["events", "validate", "--file", log]);
    assert.equal(v.code, 0, `mixed log stays shape-valid: ${v.err}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy regression: a pure schema-1 log with no prev fields still passes events validate unchanged", () => {
  const { root, log } = mkRoot("chain-legacy-", "RUN-L");
  try {
    writeFileSync(log, [
      JSON.stringify({ schema: 1, run_id: "RUN-L", seq: 0, ts: "t", phase: "run", type: "run-start" }),
      JSON.stringify({ schema: 1, run_id: "RUN-L", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "A-1", data: { outcome: "shipped" } }),
    ].join("\n") + "\n");
    const v = run(root, ["events", "validate", "--file", log]);
    assert.equal(v.code, 0, v.err);
    assert.doesNotMatch(v.out, /schema 1/, "the success message no longer hardcodes a schema");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validate: a schema-1 record CARRYING prev is a violation (legacy records are unchained)", () => {
  const { root, log } = mkRoot("chain-s1prev-", "RUN-L");
  try {
    writeFileSync(log, JSON.stringify({ schema: 1, run_id: "RUN-L", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "run-start" }) + "\n");
    const v = run(root, ["events", "validate", "--file", log]);
    assert.equal(v.code, 1);
    assert.match(v.err, /schema 1 must not carry prev/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- The spec's integration smoke test ----------------------------------------
test("integration smoke: 5 CLI appends + a --tokens ledger write + a hand-edit note → all schema 2, chain re-hashes from SHA-256(run_id), final ledger-write hash equals SHA-256(run-ledger.json)", () => {
  const { root, runDir, log, ledger } = mkRoot("chain-smoke-", "RUN-S");
  try {
    // Initialise a run dir; append 5 events via `faff events append`.
    for (let i = 0; i < 5; i++) {
      const r = run(root, ["events", "append", "--run", "RUN-S", "--ts", "t"],
        JSON.stringify({ phase: "run", type: "budget-checkpoint" }));
      assert.equal(r.code, 0, r.err);
    }
    // Write the ledger via a --tokens append (no transcript here — the estimate path
    // advances no checkpoint — so seed a ledger and use a real transcript-free tagged
    // append via the fold instead: write the ledger through atomicWriteLedger, the
    // same chokepoint the --tokens checkpoint advance uses).
    atomicWriteLedger(runDir, { run_id: "RUN-S", admitted: [], outcomes: {} });
    // Hand-edit run-ledger.json (the prose-layer direct edit) …
    const edited = JSON.parse(readFileSync(ledger, "utf8"));
    edited.outcomes["A-1"] = "shipped";
    writeFileSync(ledger, JSON.stringify(edited, null, 2) + "\n");
    // … and append the ledger-write note event per the beep-boop note rule.
    const note = run(root, ["events", "append", "--run", "RUN-S", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "ledger-write" }));
    assert.equal(note.code, 0, note.err);

    // Then: every line has schema 2 …
    const recs = records(log);
    assert.equal(recs.length, 7); // 5 + the fold's ledger-write + the note
    for (const r of recs) assert.equal(r.schema, 2);
    // … re-hashing line-by-line from SHA-256(run_id) matches every prev …
    assert.equal(firstChainMismatch(log, "RUN-S"), null);
    // … and the final ledger-write's ledger_sha256 equals SHA-256 of run-ledger.json.
    const last = recs[recs.length - 1];
    assert.equal(last.type, "ledger-write");
    assert.equal(last.data.ledger_sha256, sha256(readFileSync(ledger)));
    // The fold's earlier ledger-write hashed the PRE-edit bytes — history captured.
    assert.notEqual(recs[5].data.ledger_sha256, last.data.ledger_sha256);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Real --tokens ordering: ledger-write precedes the tagged payload ---------
test("--tokens path: the checkpoint's ledger-write is emitted BEFORE the tagged payload event, both ordinary chain links", () => {
  const { root, runDir, log } = mkRoot("chain-tokens-order-", "RUN-T");
  try {
    // A real transcript so the checkpoint advances (mirrors events.test.mjs's helper).
    const sid = "sess-chain";
    const enc = String(root).replace(/\//g, "-");
    const projdir = join(root, "cfg", "projects", enc);
    mkdirSync(projdir, { recursive: true });
    writeFileSync(join(projdir, `${sid}.jsonl`),
      JSON.stringify({ type: "assistant", sessionId: sid, message: { usage: { input_tokens: 10, output_tokens: 2 } } }) + "\n");
    writeFileSync(join(runDir, "run-ledger.json"),
      JSON.stringify({ run_id: "RUN-T", budget: { tokens_at_start_by_class: { input: 0, output: 0, cache_write: 0, cache_read: 0 } } }) + "\n");
    const r = run(root, ["events", "append", "--run", "RUN-T", "--root", root, "--tokens"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: join(root, "cfg"), CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const recs = records(log);
    assert.deepEqual(recs.map((x) => x.type), ["ledger-write", "prep-done"], "checkpoint ledger-write first, tagged payload second");
    assert.equal(firstChainMismatch(log, "RUN-T"), null, "both are ordinary chain links");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
