// FAFF-106 — escaped-side-effect detection: the `faff effects` CLI.
// declare/observe: 0 ok / 1 bad descriptor / 2 malformed-or-missing-flag / 3 run-dir-missing.
// check: 0 (always; a missing ledger file is a CLEAN state, NOT exit 3) — emits
// {escapes:[EscapeSignal], any_escape}. A parallel declared-effects.jsonl, never an
// events.jsonl schema bump. Pure: no tracker/network, writes only under the run dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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

function tmp() { return mkdtempSync(join(tmpdir(), "faff106-")); }
function mkRun(dir, runId) { mkdirSync(join(dir, ".faff", "runs", runId), { recursive: true }); }
function ledgerPath(dir, runId) { return join(dir, ".faff", "runs", runId, "declared-effects.jsonl"); }
function lines(dir, runId) {
  return readFileSync(ledgerPath(dir, runId), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

const MERGE_MAIN = JSON.stringify({ kind: "merge", target: "main" });
const REGPUB = JSON.stringify({ kind: "registry-publish", target: "pkg@1.2.0" });

// --- selftest -------------------------------------------------------------

test("effects --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["effects", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- declare/observe: envelope + seq --------------------------------------

test("declare: first entry → schema-2/run_id/seq 0/ts + kind_of_entry/issue/step/effect + genesis prev; exit 0", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], MERGE_MAIN);
    assert.equal(r.code, 0);
    const e = lines(dir, "run-X");
    assert.equal(e.length, 1);
    // FAFF-621: records are schema-2 and carry a `prev`; record 0's prev is genesis = sha256(run_id).
    const genesis = createHash("sha256").update(Buffer.from("run-X", "utf8")).digest("hex");
    assert.deepEqual(e[0], {
      schema: 2, run_id: "run-X", seq: 0, ts: "t", kind_of_entry: "declare",
      issue: "FAFF-200", step: "build", effect: { kind: "merge", target: "main", reversible: true }, prev: genesis,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("seq is the current line count, gap-free across declare+observe", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"], MERGE_MAIN);
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"], MERGE_MAIN);
    assert.deepEqual(lines(dir, "run-X").map((e) => e.seq), [0, 1]);
    assert.deepEqual(lines(dir, "run-X").map((e) => e.kind_of_entry), ["declare", "observe"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: an array of descriptors appends one line each, contiguous seq", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const payload = JSON.stringify([{ kind: "merge", target: "main" }, { kind: "label-write", target: "FAFF-1" }]);
    const r = run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"], payload);
    assert.equal(r.code, 0);
    assert.deepEqual(lines(dir, "run-X").map((e) => e.seq), [0, 1]);
    assert.deepEqual(lines(dir, "run-X").map((e) => e.effect.kind), ["merge", "label-write"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: explicit reversible:false is preserved", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "ship", "--ts", "t"],
      JSON.stringify({ kind: "db-migration", target: "users", reversible: false }));
    assert.equal(lines(dir, "run-X")[0].effect.reversible, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- declare/observe: validation failures (nothing appended) --------------

test("declare: unknown kind → exit 1, nothing appended", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build"],
      JSON.stringify({ kind: "frobnicate", target: "x" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /not in EffectKind/);
    assert.equal(existsSync(ledgerPath(dir, "run-X")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: missing target → exit 1", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build"],
      JSON.stringify({ kind: "merge" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /target/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: a bad descriptor in an array writes NOTHING (all-or-nothing)", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const payload = JSON.stringify([{ kind: "merge", target: "main" }, { kind: "bogus", target: "x" }]);
    const r = run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build"], payload);
    assert.equal(r.code, 1);
    assert.equal(existsSync(ledgerPath(dir, "run-X")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: malformed JSON payload → exit 2", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try { assert.equal(run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build"], "{not json").code, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: missing --run → exit 2", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["effects", "declare", "--issue", "FAFF-1", "--step", "build"], MERGE_MAIN).code, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: missing --issue / --step → exit 2", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    assert.equal(run(dir, ["effects", "declare", "--run", "run-X", "--step", "build"], MERGE_MAIN).code, 2);
    assert.equal(run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1"], MERGE_MAIN).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: missing run dir → exit 3, no dir/file created", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["effects", "declare", "--run", "run-Y", "--issue", "FAFF-1", "--step", "build"], MERGE_MAIN);
    assert.equal(r.code, 3);
    assert.equal(existsSync(join(dir, ".faff", "runs", "run-Y")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("declare: run path is a file (not a dir) → exit 3, no crash", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".faff", "runs"), { recursive: true });
  writeFileSync(join(dir, ".faff", "runs", "run-F"), "i am a file");
  try {
    const r = run(dir, ["effects", "declare", "--run", "run-F", "--issue", "FAFF-1", "--step", "build"], MERGE_MAIN);
    assert.equal(r.code, 3);
    assert.match(r.err, /run dir missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- check: the escape computation ----------------------------------------

test("SCENARIO 1: declared merge/main + observed merge/main → any_escape:false", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], MERGE_MAIN);
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], MERGE_MAIN);
    const r = run(dir, ["effects", "check", "--run", "run-X", "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.any_escape, false);
    assert.equal(j.escapes.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SCENARIO 2: declared merge/main, observed registry-publish → escaped-side-effect", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], MERGE_MAIN);
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], REGPUB);
    const r = run(dir, ["effects", "check", "--run", "run-X", "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.any_escape, true);
    assert.equal(j.escapes.length, 1);
    assert.equal(j.escapes[0].signal, "escaped-side-effect");
    assert.equal(j.escapes[0].issue, "FAFF-200");
    assert.equal(j.escapes[0].step, "build");
    assert.equal(j.escapes[0].escaped.length, 1);
    assert.equal(j.escapes[0].escaped[0].kind, "registry-publish");
    assert.equal(j.escapes[0].event_seq, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SCENARIO 3: missing ledger file → {escapes:[],any_escape:false}, exit 0 (NOT exit 3)", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    const r = run(dir, ["effects", "check", "--run", "run-X", "--json"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { escapes: [], any_escape: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: no declarations + an observed effect ⇒ that effect escapes", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-1", "--step", "ship", "--ts", "t"],
      JSON.stringify({ kind: "deploy", target: "prod" }));
    assert.equal(JSON.parse(run(dir, ["effects", "check", "--run", "run-X", "--json"]).out).any_escape, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: declarations + no observations ⇒ no escape", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "ship", "--ts", "t"],
      JSON.stringify({ kind: "deploy", target: "prod" }));
    assert.equal(JSON.parse(run(dir, ["effects", "check", "--run", "run-X", "--json"]).out).any_escape, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: a `*` declaration covers any target of that kind", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"],
      JSON.stringify({ kind: "file-write", target: "*" }));
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"],
      JSON.stringify({ kind: "file-write", target: "/tmp/x" }));
    assert.equal(JSON.parse(run(dir, ["effects", "check", "--run", "run-X", "--json"]).out).any_escape, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: a declaration in a different step does not cover the observation", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"], MERGE_MAIN);
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-1", "--step", "ship", "--ts", "t"], MERGE_MAIN);
    assert.equal(JSON.parse(run(dir, ["effects", "check", "--run", "run-X", "--json"]).out).any_escape, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: --issue narrows scope to one issue's entries", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-A", "--step", "build", "--ts", "t"],
      JSON.stringify({ kind: "deploy", target: "prod" }));
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-B", "--step", "build", "--ts", "t"],
      JSON.stringify({ kind: "deploy", target: "prod" }));
    const j = JSON.parse(run(dir, ["effects", "check", "--run", "run-X", "--issue", "FAFF-A", "--json"]).out);
    assert.equal(j.escapes.length, 1);
    assert.equal(j.escapes[0].issue, "FAFF-A");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: missing --run → exit 2", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["effects", "check", "--json"]).code, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- purity: writes only under the run dir --------------------------------

test("effects writes only the declared-effects.jsonl under the run dir (no other artifacts)", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"], MERGE_MAIN);
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-1", "--step", "build", "--ts", "t"], REGPUB);
    run(dir, ["effects", "check", "--run", "run-X", "--json"]);
    assert.deepEqual(readdirSync(join(dir, ".faff", "runs", "run-X")), ["declared-effects.jsonl"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- integration: the escape→Sentry bridge (no Sentry change) -------------
// The orchestrator, on any_escape, writes the observation to the event log carrying
// data.forbidden_side_effect:true; `faff sentry check` trips that on its event-scan path
// and the v1 intervention is `abort`. This proves the bridge end-to-end with zero change
// to Sentry — the existing signals.forbidden_side_effect seam.
test("INTEGRATION: any_escape → an event with forbidden_side_effect → sentry intervention abort", () => {
  const dir = tmp(); mkRun(dir, "run-X");
  try {
    // minimal running run-ledger so sentry has a live run to read
    writeFileSync(join(dir, ".faff", "runs", "run-X", "run-ledger.json"),
      JSON.stringify({ run_id: "run-X", owner: { status: "running", last_heartbeat: new Date().toISOString() } }));

    run(dir, ["effects", "declare", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], MERGE_MAIN);
    run(dir, ["effects", "observe", "--run", "run-X", "--issue", "FAFF-200", "--step", "build", "--ts", "t"], REGPUB);
    const esc = JSON.parse(run(dir, ["effects", "check", "--run", "run-X", "--json"]).out);
    assert.equal(esc.any_escape, true);

    // bridge: the chokepoint writes the observation to the event log with the flag set
    const ev = run(dir, ["events", "append", "--run", "run-X", "--ts", "t"],
      JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-200", data: { outcome: "shipped", forbidden_side_effect: true } }));
    assert.equal(ev.code, 0);

    const s = run(dir, ["sentry", "check", "--run-dir", join(dir, ".faff", "runs", "run-X"), "--json"]);
    assert.equal(s.code, 0);
    const sj = JSON.parse(s.out);
    assert.equal(sj.intervention, "abort");
    assert.ok(sj.verdicts.some((v) => v.signal === "forbidden-side-effect-attempt" && v.severity === "trip"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
