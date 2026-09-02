// FAFF-35 (slice 1) — structured run-event log: the `faff events` CLI.
// append: 0 ok / 1 invalid / 2 malformed / 3 run-dir-missing. validate: 0 valid /
// 1 line-numbered violations / 2 unreadable. read: 0 / 3 no events. seq (current
// line count) is the authoritative monotonic order; ts is best-effort annotation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// run the CLI in `cwd`; `input` is fed to stdin. returns { code, out, err }.
// When `env` is supplied, run from a CLEAN base (HOME/PATH + overrides) so an
// inherited $CLAUDE_CODE_SESSION_ID can't leak into the token-measurement path;
// omitting `env` keeps the original inherit-everything behaviour (unchanged).
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

function tmp() { return mkdtempSync(join(tmpdir(), "faff35-")); }
function mkRun(dir, runId) { mkdirSync(join(dir, ".faff", "runs", runId), { recursive: true }); }
function logPath(dir, runId) { return join(dir, ".faff", "runs", runId, "events.jsonl"); }
function lines(dir, runId) {
  return readFileSync(logPath(dir, runId), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

// FAFF-408 token-tag helpers ------------------------------------------------
// Write a transcript project dir under a fake $CLAUDE_CONFIG_DIR for `cwd`, each
// record stamped with `sid` as its owning sessionId (the FAFF-229 attribution key).
// Mirrors budget.test.mjs's withTranscripts. Returns the CLAUDE_CONFIG_DIR to pass.
function withTranscripts(root, cwd, sid, files) {
  const enc = String(cwd).replace(/\//g, "-");
  const projdir = join(root, "cfg", "projects", enc);
  mkdirSync(projdir, { recursive: true });
  for (const [name, usages] of Object.entries(files)) {
    const recs = usages.map((u) => JSON.stringify({ type: "assistant", sessionId: sid, message: { usage: u } }));
    writeFileSync(join(projdir, name), recs.join("\n"));
  }
  return join(root, "cfg");
}
function ledgerPath(dir, runId) { return join(dir, ".faff", "runs", runId, "run-ledger.json"); }
function writeLedger(dir, runId, ledger) { writeFileSync(ledgerPath(dir, runId), JSON.stringify(ledger)); }
function readLedger(dir, runId) { return JSON.parse(readFileSync(ledgerPath(dir, runId), "utf8")); }

// --- selftest -------------------------------------------------------------

test("events --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["events", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- append: envelope + seq -----------------------------------------------

test("append: first event → seq 0, schema 2, run_id, ts, genesis prev; exit 0 (FAFF-564)", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X", "--ts", "2026-01-01T00:00:00Z"],
      JSON.stringify({ phase: "run", type: "run-start" }));
    assert.equal(r.code, 0);
    const ev = lines(dir, "run-X");
    assert.equal(ev.length, 1);
    const genesis = createHash("sha256").update("run-X", "utf8").digest("hex");
    assert.deepEqual(ev[0], { schema: 2, run_id: "run-X", seq: 0, ts: "2026-01-01T00:00:00Z", prev: genesis, phase: "run", type: "run-start" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: seq is the current line count, gap-free across appends", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    for (let i = 0; i < 4; i++) {
      run(dir, ["events", "append", "--run", "run-X", "--ts", "t"], JSON.stringify({ phase: "run", type: "budget-checkpoint" }));
    }
    assert.deepEqual(lines(dir, "run-X").map((e) => e.seq), [0, 1, 2, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: issue-scoped issue-outcome carries issue + data.outcome", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-35", data: { outcome: "shipped" } }));
    assert.equal(r.code, 0);
    const ev = lines(dir, "run-X")[0];
    assert.equal(ev.issue, "FAFF-35");
    assert.deepEqual(ev.data, { outcome: "shipped" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: FAFF-352 sentry-checkpoint is run-scoped (no issue required) and carries the sentry payload verbatim under data", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const payload = { run_dir: "/some/run", verdicts: [{ signal: "budget-breach", severity: "trip", evidence: {} }], intervention: "abort", tripped: true, thresholds: {} };
    const r = run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "sentry-checkpoint", data: payload }));
    assert.equal(r.code, 0);
    const ev = lines(dir, "run-X")[0];
    assert.equal(ev.issue, undefined, "sentry-checkpoint is run-scoped — no issue field");
    assert.deepEqual(ev.data, payload, "data carries the sentry check payload verbatim");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: FAFF-354 containment-check is issue-scoped (issue = mandate) and carries the contain record verbatim under data", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const payload = { mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "contained", exit: 0 };
    const r = run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "containment-check", issue: "FAFF-1", data: payload }));
    assert.equal(r.code, 0);
    const ev = lines(dir, "run-X")[0];
    assert.equal(ev.issue, "FAFF-1");
    assert.deepEqual(ev.data, payload);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: FAFF-354 containment-check missing issue → exit 1 (issue-scoped)", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "run", type: "containment-check", data: { mandate: "FAFF-1", parent: null, root: true, ancestry_raw: null, verdict: "outward", exit: 3 } }));
    assert.equal(r.code, 1);
    assert.equal(existsSync(logPath(dir, "run-X")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- append: validation failures (nothing appended) -----------------------

test("append: issue-scoped type missing issue → exit 1, nothing appended", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X"], JSON.stringify({ phase: "build", type: "build-start" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /issue/);
    assert.equal(existsSync(logPath(dir, "run-X")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: unknown type → exit 1", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X"], JSON.stringify({ phase: "run", type: "frobnicate" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /not in EventType/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: unknown phase → exit 1", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X"], JSON.stringify({ phase: "nope", type: "run-start" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /not in Phase/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: issue-outcome with outcome outside the ledger vocab → exit 1", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X"],
      JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "bogus" } }));
    assert.equal(r.code, 1);
    assert.match(r.err, /ledger outcome vocabulary/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: malformed JSON payload → exit 2", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X"], "{not json");
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: missing run dir → exit 3, no dir/file created", () => {
  const dir = tmp(); // no run dir
  try {
    const r = run(dir, ["events", "append", "--run", "run-Y"], JSON.stringify({ phase: "run", type: "run-start" }));
    assert.equal(r.code, 3);
    assert.equal(existsSync(join(dir, ".faff", "runs", "run-Y")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: run path exists as a file (not a dir) → exit 3, no crash", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".faff", "runs"), { recursive: true });
  writeFileSync(join(dir, ".faff", "runs", "run-F"), "i am a file, not a dir");
  try {
    const r = run(dir, ["events", "append", "--run", "run-F"], JSON.stringify({ phase: "run", type: "run-start" }));
    assert.equal(r.code, 3);
    assert.match(r.err, /run dir missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: --run is required → exit 2", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["events", "append"], JSON.stringify({ phase: "run", type: "run-start" })).code, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- validate -------------------------------------------------------------

test("validate: a well-formed log → exit 0", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["events", "append", "--run", "run-X", "--ts", "t"], JSON.stringify({ phase: "run", type: "run-start" }));
    run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-35", data: { outcome: "shipped" } }));
    assert.equal(run(dir, ["events", "validate", "--file", logPath(dir, "run-X")]).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: FAFF-354 accepts a well-formed containment-check record", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["events", "append", "--run", "run-X", "--ts", "t"], JSON.stringify({
      phase: "run", type: "containment-check", issue: "FAFF-1",
      data: { mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "contained", exit: 0 },
    }));
    assert.equal(run(dir, ["events", "validate", "--file", logPath(dir, "run-X")]).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: FAFF-354 rejects a containment-check record missing the required issue field", () => {
  const dir = tmp();
  const f = join(dir, "log.jsonl");
  writeFileSync(f, JSON.stringify({
    schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "containment-check",
    data: { mandate: "FAFF-1", parent: null, root: true, ancestry_raw: null, verdict: "outward", exit: 3 },
  }) + "\n");
  try {
    const r = run(dir, ["events", "validate", "--file", f]);
    assert.equal(r.code, 1);
    assert.match(r.err, /issue-scoped but missing required field 'issue'/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: an unknown type on line 2 → exit 1, line-numbered", () => {
  const dir = tmp();
  const f = join(dir, "log.jsonl");
  writeFileSync(f, [
    JSON.stringify({ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }),
    JSON.stringify({ schema: 1, run_id: "r", seq: 1, ts: "t", phase: "run", type: "frobnicate" }),
  ].join("\n") + "\n");
  try {
    const r = run(dir, ["events", "validate", "--file", f]);
    assert.equal(r.code, 1);
    assert.match(r.err, /line 2: type .* not in EventType/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: malformed line → exit 1, line-numbered", () => {
  const dir = tmp();
  const f = join(dir, "log.jsonl");
  writeFileSync(f, JSON.stringify({ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }) + "\n{garbage\n");
  try {
    const r = run(dir, ["events", "validate", "--file", f]);
    assert.equal(r.code, 1);
    assert.match(r.err, /line 2: malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: non-contiguous seq → advisory violation (exit 1)", () => {
  const dir = tmp();
  const f = join(dir, "log.jsonl");
  writeFileSync(f, [
    JSON.stringify({ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }),
    JSON.stringify({ schema: 1, run_id: "r", seq: 2, ts: "t", phase: "run", type: "run-end" }),
  ].join("\n") + "\n");
  try {
    const r = run(dir, ["events", "validate", "--file", f]);
    assert.equal(r.code, 1);
    assert.match(r.err, /non-contiguous seq/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- read -----------------------------------------------------------------

test("read: filters by --type and returns matching events as JSON", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["events", "append", "--run", "run-X", "--ts", "t"], JSON.stringify({ phase: "run", type: "run-start" }));
    run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-35", data: { outcome: "shipped" } }));
    const r = run(dir, ["events", "read", "--run", "run-X", "--type", "issue-outcome", "--json"]);
    assert.equal(r.code, 0);
    const arr = JSON.parse(r.out);
    assert.equal(arr.length, 1);
    assert.equal(arr[0].type, "issue-outcome");
    assert.equal(arr[0].issue, "FAFF-35");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("read: absent log → exit 3 (no events), not an error", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try { assert.equal(run(dir, ["events", "read", "--run", "run-X"]).code, 3); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- determinism of ordering ----------------------------------------------

test("ordering is by seq, independent of ts (out-of-order ts keeps ascending seq)", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["events", "append", "--run", "run-X", "--ts", "2026-12-31T00:00:00Z"], JSON.stringify({ phase: "run", type: "run-start" }));
    run(dir, ["events", "append", "--run", "run-X", "--ts", "2026-01-01T00:00:00Z"], JSON.stringify({ phase: "run", type: "run-end" }));
    const ev = lines(dir, "run-X");
    assert.deepEqual(ev.map((e) => e.seq), [0, 1]); // append order, regardless of ts going backwards
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- FAFF-408: token-tag (--tokens) ---------------------------------------

const ZERO_BY_CLASS = { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 };

test("append --tokens: four-class delta from transcript; checkpoint advances", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const sid = "sess-1";
    const cfg = withTranscripts(dir, dir, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 }],
    });
    const preLedger = { run_id: "R", owner: { started_at: "2020-01-01T00:00:00Z" }, budget: { tokens_at_start_by_class: { ...ZERO_BY_CLASS } } };
    writeLedger(dir, "R", preLedger);
    const preBytes = readFileSync(ledgerPath(dir, "R"));
    const r = run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const ev = lines(dir, "R");
    // FAFF-564: a tagged append emits TWO chain links — the checkpoint advance's
    // ledger-write (via the atomicWriteLedger fold), then the tagged payload event.
    assert.equal(ev.length, 2);
    assert.equal(ev[0].type, "ledger-write", "the checkpoint's ledger-write precedes the tagged payload event");
    assert.deepEqual(ev[1].data.tokens, { input: 100, output: 20, cache_write_5m: 0, cache_write_1h: 5, cache_read: 0 });
    assert.equal(ev[1].data.tokens_source, "transcript");
    // checkpoint advanced to the fresh cumulative
    assert.deepEqual(readLedger(dir, "R").budget.tokens_at_last_event, { input: 100, output: 20, cache_write_5m: 0, cache_write_1h: 5, cache_read: 0 });
    // the ledger-write's hash is the post-write on-disk ledger bytes
    assert.equal(ev[0].data.ledger_sha256, createHash("sha256").update(readFileSync(ledgerPath(dir, "R"))).digest("hex"));
    // FAFF-679: Class A of the gateway's mid-bracket write rule — --tokens is a
    // ledger-mutating command, so it surfaces the before/after digest pair too. The
    // before-hash is what a custody-holding caller's baseline should have matched
    // BEFORE this write took the lock; the after-hash equals the ledger-write note's
    // hash (both derive from the same atomicWriteLedger call).
    assert.equal(ev[1].data.ledger_sha256_before, createHash("sha256").update(preBytes).digest("hex"));
    assert.equal(ev[1].data.ledger_sha256_after, ev[0].data.ledger_sha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append --tokens twice: second delta is baselined against the first (checkpoint advance)", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const sid = "sess-2";
    // first: cumulative {100,20,5,0}
    let cfg = withTranscripts(dir, dir, sid, {
      [`${sid}.jsonl`]: [{ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 }],
    });
    writeLedger(dir, "R", { run_id: "R", owner: { started_at: "2020-01-01T00:00:00Z" }, budget: { tokens_at_start_by_class: { ...ZERO_BY_CLASS } } });
    run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    // transcript grows to cumulative {150,30,5,0}
    cfg = withTranscripts(dir, dir, sid, {
      [`${sid}.jsonl`]: [
        { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 },
        { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      ],
    });
    run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "build", type: "issue-outcome", issue: "X-1", data: { outcome: "shipped" } }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    // FAFF-564: each tagged append emits [ledger-write, payload] — 4 links total.
    const ev = lines(dir, "R");
    assert.deepEqual(ev.map((e) => e.type), ["ledger-write", "prep-done", "ledger-write", "issue-outcome"]);
    assert.deepEqual(ev[3].data.tokens, { input: 50, output: 10, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 });
    assert.equal(ev[3].data.outcome, "shipped"); // pre-existing data preserved
    assert.deepEqual(readLedger(dir, "R").budget.tokens_at_last_event, { input: 150, output: 30, cache_write_5m: 0, cache_write_1h: 5, cache_read: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append --tokens with NO transcript → null delta, estimate source, checkpoint NOT advanced", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    writeLedger(dir, "R", { run_id: "R", budget: { tokens_at_last_event: { input: 7, output: 0, cache_write: 0, cache_read: 0 } } });
    // env with a CLAUDE_CONFIG_DIR but NO CLAUDE_CODE_SESSION_ID → measure returns estimate
    const r = run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "run", type: "run-end" }),
      { CLAUDE_CONFIG_DIR: join(dir, "cfg") });
    assert.equal(r.code, 0, r.err);
    const ev = lines(dir, "R");
    assert.equal(ev.length, 1); // the event is still written (degradation-safe, never skipped)
    assert.equal(ev[0].data.tokens, null);
    assert.equal(ev[0].data.tokens_source, "estimate");
    // NOT advanced — the prior checkpoint is untouched
    assert.deepEqual(readLedger(dir, "R").budget.tokens_at_last_event, { input: 7, output: 0, cache_write: 0, cache_read: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append --tokens with a transcript but NO ledger → degrades to estimate (no fabricated delta), event still writes", () => {
  const dir = tmp(); mkRun(dir, "R"); // run dir exists, but no run-ledger.json
  try {
    const sid = "sess-noledger";
    const cfg = withTranscripts(dir, dir, sid, { [`${sid}.jsonl`]: [{ input_tokens: 100, output_tokens: 20 }] });
    const r = run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const ev = lines(dir, "R");
    assert.equal(ev.length, 1);
    // no durable checkpoint could be maintained ⇒ honest estimate, never an un-advanced
    // transcript delta (which would double-count the window on the next append)
    assert.equal(ev[0].data.tokens, null);
    assert.equal(ev[0].data.tokens_source, "estimate");
    assert.equal(existsSync(ledgerPath(dir, "R")), false); // never fabricates a ledger
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append WITHOUT --tokens: no data.tokens, ledger untouched (byte-identical path)", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const sid = "sess-3";
    const cfg = withTranscripts(dir, dir, sid, { [`${sid}.jsonl`]: [{ input_tokens: 999, output_tokens: 1 }] });
    const ledger = { run_id: "R", budget: { tokens_at_last_event: { input: 1, output: 2, cache_write: 3, cache_read: 4 } } };
    writeLedger(dir, "R", ledger);
    const r = run(dir, ["events", "append", "--run", "R", "--root", dir],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const ev = lines(dir, "R");
    assert.ok(!("data" in ev[0]), "no data field injected without --tokens");
    assert.deepEqual(readLedger(dir, "R"), ledger); // ledger byte-identical (no read/write)
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append: a malformed data.tokens payload is rejected (exit 1)", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const r = run(dir, ["events", "append", "--run", "R"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1", data: { tokens: { input: -1, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }));
    assert.equal(r.code, 1);
    assert.match(r.err, /data\.tokens\.input/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("non-leak: a tagged event line carries no prompt/response payload, only the 4 classes", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const sid = "sess-4";
    const cfg = withTranscripts(dir, dir, sid, { [`${sid}.jsonl`]: [{ input_tokens: 10, output_tokens: 2 }] });
    writeLedger(dir, "R", { run_id: "R", budget: { tokens_at_start_by_class: { ...ZERO_BY_CLASS } } });
    run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    // FAFF-564: the tagged payload event is the LAST line (the checkpoint's
    // ledger-write precedes it).
    const rawLines = readFileSync(logPath(dir, "R"), "utf8").split("\n").filter((l) => l.trim() !== "");
    const tok = JSON.parse(rawLines[rawLines.length - 1]).data.tokens;
    assert.deepEqual(Object.keys(tok).sort(), ["cache_read", "cache_write_1h", "cache_write_5m", "input", "output"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parity: the --tokens delta sum equals budget check's total on the same transcript", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const sid = "sess-5";
    const usage = { input_tokens: 123, output_tokens: 45, cache_creation_input_tokens: 6, cache_read_input_tokens: 7 };
    const cfg = withTranscripts(dir, dir, sid, { [`${sid}.jsonl`]: [usage] });
    writeLedger(dir, "R", { run_id: "R", owner: { started_at: "2020-01-01T00:00:00Z" }, budget: { tokens_at_start: 0, tokens_at_start_by_class: { ...ZERO_BY_CLASS } } });
    run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens"],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    // FAFF-564: the tagged payload is preceded by its checkpoint's ledger-write link.
    const delta = lines(dir, "R")[1].data.tokens;
    const deltaSum = delta.input + delta.output + delta.cache_write_5m + delta.cache_write_1h + delta.cache_read;
    const b = run(dir, ["budget", "check", "--run-dir", join(dir, ".faff", "runs", "R"), "--root", dir], undefined,
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const budgetTokens = JSON.parse(b.out).spent.tokens;
    assert.equal(deltaSum, budgetTokens); // one attribution gate → by-class sum == scalar total
    assert.equal(deltaSum, 181);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===========================================================================
// FAFF-488 — S5: `--session-id` selects which session's transcript `--tokens`
// measures (overriding $CLAUDE_CODE_SESSION_ID in the effective env only) and
// NEVER leaks into the emitted event — `data` stays exactly the four classes,
// no session id / extra field anywhere in the written line.
// ===========================================================================
test("S5 (FAFF-488): --session-id (no ambient CLAUDE_CODE_SESSION_ID) selects the transcript for --tokens without leaking; events validate confirms exactly the four classes", () => {
  const dir = tmp(); mkRun(dir, "R");
  try {
    const sid = "sess-s5-selector-only";
    const cfg = withTranscripts(dir, dir, sid, { [`${sid}.jsonl`]: [{ input_tokens: 10, output_tokens: 2 }] });
    writeLedger(dir, "R", { run_id: "R", budget: { tokens_at_start_by_class: { ...ZERO_BY_CLASS } } });
    // No ambient CLAUDE_CODE_SESSION_ID anywhere in this env — only --session-id.
    const r = run(dir, ["events", "append", "--run", "R", "--root", dir, "--tokens", "--session-id", sid],
      JSON.stringify({ phase: "prep", type: "prep-done", issue: "X-1" }),
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    // FAFF-564: [ledger-write, payload] — the tagged payload is the second link.
    const ev = lines(dir, "R");
    assert.equal(ev[1].data.tokens_source, "transcript");
    assert.deepEqual(ev[1].data.tokens, { input: 10, output: 2, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 });

    // faff events validate confirms the well-formed shape.
    const v = run(dir, ["events", "validate", "--file", logPath(dir, "R")]);
    assert.equal(v.code, 0, v.err);

    // Non-leak: the --session-id VALUE itself must never appear anywhere in the
    // emitted line (it is a selector, never a payload) and data.tokens carries
    // exactly the four classes — nothing else.
    const raw = readFileSync(logPath(dir, "R"), "utf8");
    assert.ok(!raw.includes(sid), "the --session-id value must never appear in the emitted event line");
    assert.deepEqual(Object.keys(ev[1].data.tokens).sort(), ["cache_read", "cache_write_1h", "cache_write_5m", "input", "output"]);
    // FAFF-679: the before/after ledger digest pair is additive, expected data — not a leak.
    assert.deepEqual(Object.keys(ev[1].data).sort(), ["ledger_sha256_after", "ledger_sha256_before", "tokens", "tokens_source"],
      "data carries tokens + tokens_source + the FAFF-679 ledger digest pair — no session id, no other extra field");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
