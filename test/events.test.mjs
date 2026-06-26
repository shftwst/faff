// FAFF-35 (slice 1) — structured run-event log: the `faff events` CLI.
// append: 0 ok / 1 invalid / 2 malformed / 3 run-dir-missing. validate: 0 valid /
// 1 line-numbered violations / 2 unreadable. read: 0 / 3 no events. seq (current
// line count) is the authoritative monotonic order; ts is best-effort annotation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// run the CLI in `cwd`; `input` is fed to stdin. returns { code, out, err }
function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
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

// --- selftest -------------------------------------------------------------

test("events --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["events", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- append: envelope + seq -----------------------------------------------

test("append: first event → seq 0, schema 1, run_id, ts, payload; exit 0", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["events", "append", "--run", "run-X", "--ts", "2026-01-01T00:00:00Z"],
      JSON.stringify({ phase: "run", type: "run-start" }));
    assert.equal(r.code, 0);
    const ev = lines(dir, "run-X");
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0], { schema: 1, run_id: "run-X", seq: 0, ts: "2026-01-01T00:00:00Z", phase: "run", type: "run-start" });
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
