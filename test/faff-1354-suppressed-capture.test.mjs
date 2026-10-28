// FAFF-1354: a suppressed decision capture names the event type, kernel and rule that refused it.
// The write core names its rules on the EVENT_SCHEMA error; decision-capture reports them in a
// line-safe, bounded reason and in extra fields on the degraded-capture note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const { appendEventRecord } = require("../plugin/skills/faff/bin/lib/events.js");
const { lineSafe, reportAppendFailure } = require("../plugin/skills/faff/bin/lib/decision-capture.js");

const PAYLOAD = JSON.stringify({ normalised_inputs: {}, selected_action: "graft" });
const ISSUE_LINE = "type 'decision-capture' is issue-scoped but missing required field 'issue'";
const PREFIX = "faff decision-capture record: degraded capture — ";

function faff(cwd, args, { input = "", env = {} } = {}) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_EXTRA_CA_CERTS;
  delete childEnv.FAFF_DECISION_ISSUE;
  delete childEnv.FAFF_DECISION_CORRELATION_ID;
  delete childEnv.FAFF_RUN_DIR;
  Object.assign(childEnv, env);
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", input, env: childEnv });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function scratch(t, { capture = "on" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-1354-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  mkdirSync(join(root, ".faff", "runs", "run-1"), { recursive: true });
  writeFileSync(join(root, ".faff", "config.yaml"), `capture:\n  decision_kernel: ${capture}\n`);
  const g = faff(root, ["events", "append", "--run", "run-1", "--ts", "2026-01-01T00:00:00Z"], { input: '{"phase":"run","type":"run-start"}' });
  assert.equal(g.code, 0, g.err);
  const runDir = join(root, ".faff", "runs", "run-1");
  return {
    root,
    runDir,
    events: join(runDir, "events.jsonl"),
    notes: () => {
      const p = join(root, ".faff", "logs", "decision-capture.jsonl");
      return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    },
  };
}

const captureLines = (err) => err.split("\n").filter((l) => l.startsWith("faff decision-capture"));
const bytes = (s) => Buffer.byteLength(s, "utf8");

// ---- write core names its rules -------------------------------------------------------------

test("EVENT_SCHEMA carries rules: issue-scoped, payload-schema, and both", (t) => {
  const { runDir } = scratch(t);
  const refuse = (record) => {
    try { appendEventRecord(runDir, "run-1", record); } catch (e) { return e; }
    assert.fail("expected EVENT_SCHEMA");
  };
  const validData = { kernel: "next", kernel_version: "1", normalised_inputs: {}, selected_action: "graft", coverage: "uncovered", missing_inputs: [], causation: { seq: 1, sha256: "a".repeat(64) } };
  const emptyIssue = refuse({ phase: "run", type: "decision-capture", issue: "", data: validData });
  assert.equal(emptyIssue.code, "EVENT_SCHEMA");
  assert.deepEqual(emptyIssue.rules, ["issue-scoped"]);
  assert.deepEqual(emptyIssue.violations, [ISSUE_LINE]);
  assert.equal(emptyIssue.message, `decision-capture event refused by the v0.3 run-event schema: ${ISSUE_LINE}`);

  const refusedMessage = (e) => `decision-capture event refused by the v0.3 run-event schema: ${e.violations.join("; ")}`;
  const badPayload = refuse({ phase: "run", type: "decision-capture", issue: "FAFF-1", data: {} });
  assert.equal(badPayload.code, "EVENT_SCHEMA");
  assert.deepEqual(badPayload.rules, ["payload-schema"]);
  assert.ok(badPayload.violations.length > 0);
  assert.equal(badPayload.message, refusedMessage(badPayload));

  const both = refuse({ phase: "run", type: "decision-capture", issue: "", data: {} });
  assert.equal(both.code, "EVENT_SCHEMA");
  assert.deepEqual(both.rules, ["issue-scoped", "payload-schema"]);
  assert.deepEqual(both.violations, [ISSUE_LINE, ...badPayload.violations]);
  assert.equal(both.message, refusedMessage(both));
});

test("faff events append of an empty-issue decision-capture still exits 1, one '- violation' line each", (t) => {
  const { root } = scratch(t);
  const r = faff(root, ["events", "append", "--run", "run-1"], { input: '{"phase":"run","type":"decision-capture","issue":""}' });
  assert.equal(r.code, 1);
  // The empty payload fails the issue-scoped rule once and the payload schema eight times (spec §3):
  // stderr is exactly one distinct "- <violation>" line per violation and nothing else.
  const lines = r.err.split("\n").filter((l) => l !== "");
  assert.ok(lines.every((l) => l.startsWith("- ")), r.err);
  assert.equal(lines.length, 9);
  assert.equal(new Set(lines).size, lines.length);
  assert.equal(lines[0], `- ${ISSUE_LINE}`);
});

// ---- lineSafe -------------------------------------------------------------------------------

test("lineSafe collapses control runs, trims, and bounds to 1024 UTF-8 bytes", () => {
  assert.equal(lineSafe("a\nb\tc"), "a b c");
  assert.equal(lineSafe("a b"), "a b");
  assert.equal(lineSafe("a\u0085b"), "a b");
  assert.equal(lineSafe("a\r\n\r\nb"), "a b");
  assert.equal(lineSafe("  x  "), "x");
  const exact = "a".repeat(1024);
  assert.equal(lineSafe(exact), exact);
  const long = lineSafe("a".repeat(2000));
  assert.equal(bytes(long), 1024);
  assert.equal(long, "a".repeat(1010) + "...[truncated]");
  const accented = lineSafe("é".repeat(600));
  assert.ok(bytes(accented) <= 1024);
  assert.ok(!accented.includes("�"));
  assert.ok(accented.endsWith("...[truncated]"));
});

// ---- reportAppendFailure --------------------------------------------------------------------

test("reportAppendFailure: a non-schema failure keeps the generic reason and adds no event_type", (t) => {
  const { root, notes } = scratch(t);
  assert.equal(reportAppendFailure(root, "run-1", { code: "EVENTS_LOCKED", message: "m" }, "decision-capture", "next"), 0);
  const [note] = notes();
  assert.equal(note.reason, "journal append failed: m");
  assert.ok(!("event_type" in note));
});

test("reportAppendFailure: EVENT_SCHEMA without rules reads 'run-event schema' with rules []", (t) => {
  const { root, notes } = scratch(t);
  reportAppendFailure(root, "run-1", { code: "EVENT_SCHEMA", message: "x", violations: ["v1", "v2"] }, "decision-capture-action", "k");
  const [note] = notes();
  assert.equal(note.reason, "capture suppressed: decision-capture-action event for kernel k refused by the run-event schema: v1; v2");
  assert.deepEqual(note.rules, []);
  assert.equal(note.event_type, "decision-capture-action");
});

test("reportAppendFailure: both rules fire", (t) => {
  const { root, notes } = scratch(t);
  reportAppendFailure(root, "run-1", { code: "EVENT_SCHEMA", violations: ["a", "b"], rules: ["issue-scoped", "payload-schema"] }, "decision-capture", "k");
  assert.match(notes()[0].reason, /refused by the issue-scoped and payload-schema rules: a; b$/);
});

test("reportAppendFailure: a rule name the phrase has not seen is still named, never read as run-event schema", (t) => {
  const { root, notes } = scratch(t);
  reportAppendFailure(root, "run-1", { code: "EVENT_SCHEMA", violations: ["a"], rules: ["issue-scoped", "new-rule"] }, "decision-capture", "k");
  const note = notes()[0];
  assert.match(note.reason, /refused by the issue-scoped and new-rule rules: a$/);
  assert.deepEqual(note.rules, ["issue-scoped", "new-rule"]);
});

// ---- integration: the CLI -------------------------------------------------------------------

const NEXT = ["next", "--status", "todo", "--spec", "high"];
const REASON_NEXT = `capture suppressed: decision-capture event for kernel next refused by the issue-scoped rule: ${ISSUE_LINE}`;

test("faff next with no issue: exit 0, stdout unchanged, one capture line, note names the rule, events untouched", (t) => {
  const on = scratch(t);
  const off = scratch(t, { capture: "off" });
  const before = readFileSync(on.events);
  const env = (s) => ({ FAFF_RUN_DIR: s.runDir, FAFF_DECISION_CORRELATION_ID: "run-1/x/next/1" });
  const r = faff(on.root, NEXT, { env: env(on) });
  const base = faff(off.root, NEXT, { env: env(off) });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, base.out);
  assert.equal(base.err, "");
  assert.deepEqual(off.notes(), []);
  const lines = captureLines(r.err);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith(REASON_NEXT));
  const note = on.notes().at(-1);
  assert.deepEqual(Object.keys(note), ["ts", "run", "note", "reason", "event_type", "kernel", "rules"]);
  assert.equal(note.note, "degraded-capture");
  assert.equal(note.run, "run-1");
  assert.equal(note.event_type, "decision-capture");
  assert.equal(note.kernel, "next");
  assert.deepEqual(note.rules, ["issue-scoped"]);
  assert.equal(note.reason, REASON_NEXT);
  assert.ok(readFileSync(on.events).equals(before));
  assert.match(r.out, /"next":"graft"/);
  assert.equal(faff(on.root, ["events", "validate", "--file", ".faff/runs/run-1/events.jsonl"]).code, 0);
  assert.equal(faff(on.root, ["events", "verify", "--run-dir", ".faff/runs/run-1"]).code, 0);
});

test("faff next with neither correlation id nor issue: empty-correlation note, then the suppression note", (t) => {
  const s = scratch(t);
  const r = faff(s.root, NEXT, { env: { FAFF_RUN_DIR: s.runDir } });
  assert.equal(r.code, 0, r.err);
  const lines = captureLines(r.err);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("empty correlation_id"));
  assert.ok(lines[1].includes("capture suppressed: decision-capture event for kernel next"));
  const notes = s.notes();
  assert.equal(notes.length, 2);
  assert.ok(!("event_type" in notes[0]));
  assert.equal(notes[1].event_type, "decision-capture");
});

test("record with a 2000-byte kernel: reason and kernel are bounded and the stderr text equals the note", (t) => {
  const s = scratch(t);
  const r = faff(s.root, ["decision-capture", "record", "--run", "run-1", "--issue", "", "--kernel", "k".repeat(2000)], { input: PAYLOAD });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
  const note = s.notes().at(-1);
  assert.ok(bytes(note.reason) <= 1024);
  assert.ok(note.reason.includes(ISSUE_LINE));
  assert.ok(!note.reason.endsWith("...[truncated]"));
  assert.ok(bytes(note.kernel) <= 256);
  assert.equal(note.kernel, "k".repeat(242) + "...[truncated]");
  assert.ok(note.reason.includes(`for kernel ${note.kernel} refused by the issue-scoped rule`));
  const [line] = captureLines(r.err);
  assert.equal(line.slice(PREFIX.length), note.reason);
});

test("record with a line feed inside --kernel: one stderr line, kernel collapsed", (t) => {
  const s = scratch(t);
  const r = faff(s.root, ["decision-capture", "record", "--run", "run-1", "--issue", "", "--kernel", "bad\nkernel"], { input: PAYLOAD });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
  const lines = captureLines(r.err);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("for kernel bad kernel refused by the issue-scoped rule"));
  assert.ok(!r.err.split("\n").some((l) => l.startsWith("kernel refused by")));
  const note = s.notes().at(-1);
  assert.equal(note.kernel, "bad kernel");
  assert.ok(!/\n/.test(note.reason));
});

test("record and action each report the suppression with their own event type", (t) => {
  const s = scratch(t);
  const rec = faff(s.root, ["decision-capture", "record", "--run", "run-1", "--issue", "", "--kernel", "next"], { input: PAYLOAD });
  assert.equal(rec.code, 0, rec.err);
  const act = faff(s.root, ["decision-capture", "action", "--run", "run-1", "--issue", "", "--kernel", "next", "--action", "graft"]);
  assert.equal(act.code, 0, act.err);
  const [a, b] = s.notes().filter((n) => n.event_type);
  assert.equal(a.event_type, "decision-capture");
  assert.equal(b.event_type, "decision-capture-action");
  assert.deepEqual(b.rules, ["issue-scoped"]);
});

test("action with a 2000-byte kernel: the issue-scoped violation survives and the kernel is bounded", (t) => {
  const s = scratch(t);
  const r = faff(s.root, ["decision-capture", "action", "--run", "run-1", "--issue", "", "--kernel", "k".repeat(2000), "--action", "graft"]);
  assert.equal(r.code, 0, r.err);
  const note = s.notes().at(-1);
  assert.equal(note.event_type, "decision-capture-action");
  assert.ok(note.reason.includes("type 'decision-capture-action' is issue-scoped but missing required field 'issue'"));
  assert.ok(bytes(note.kernel) <= 256);
  assert.ok(note.kernel.endsWith("...[truncated]"));
});

test("record with a 256-byte kernel keeps it whole; 300 x e-acute is cut on a code point", (t) => {
  const s = scratch(t);
  const exact = "k".repeat(256);
  const a = faff(s.root, ["decision-capture", "record", "--run", "run-1", "--issue", "", "--kernel", exact], { input: PAYLOAD });
  assert.equal(a.code, 0, a.err);
  const noteA = s.notes().at(-1);
  assert.equal(noteA.kernel, exact);
  assert.ok(noteA.reason.includes(`for kernel ${exact} refused by`));
  assert.ok(noteA.reason.includes(ISSUE_LINE));
  const b = faff(s.root, ["decision-capture", "record", "--run", "run-1", "--issue", "", "--kernel", "\u00e9".repeat(300)], { input: PAYLOAD });
  assert.equal(b.code, 0, b.err);
  const noteB = s.notes().at(-1);
  assert.ok(bytes(noteB.kernel) <= 256);
  assert.ok(noteB.kernel.endsWith("...[truncated]"));
  assert.ok(!noteB.kernel.includes("\uFFFD"));
  assert.ok(noteB.reason.includes(ISSUE_LINE));
});

test("lineSafe with an explicit maxBytes bounds on a code point and keeps the marker inside the budget", () => {
  const exact = "a".repeat(256);
  assert.equal(lineSafe(exact, 256), exact);
  const cut = lineSafe("a".repeat(257), 256);
  assert.equal(bytes(cut), 256);
  assert.equal(cut, "a".repeat(242) + "...[truncated]");
  const accented = lineSafe("\u00e9".repeat(300), 256);
  assert.ok(bytes(accented) <= 256);
  assert.ok(accented.endsWith("...[truncated]"));
  assert.ok(!accented.includes("\uFFFD"));
  assert.equal(lineSafe("a".repeat(2000)).length, 1024);
});

test("violation budget: the largest set a capture can meet fits beside a 256-byte kernel", (t) => {
  for (const type of ["decision-capture", "decision-capture-action"]) {
    const { root, runDir, notes } = scratch(t);
    let err;
    try { appendEventRecord(runDir, "run-1", { phase: "run", type, issue: "" }); } catch (e) { err = e; }
    assert.ok(err && err.code === "EVENT_SCHEMA", type);
    assert.ok(err.violations.length > 0);
    assert.ok(bytes(err.violations.join("; ")) <= 652, `${type} violations take ${bytes(err.violations.join("; "))} bytes`);
    reportAppendFailure(root, "run-1", { code: "EVENT_SCHEMA", violations: err.violations, rules: ["issue-scoped", "payload-schema"] }, type, "k".repeat(2000));
    const note = notes().at(-1);
    for (const v of err.violations) assert.ok(note.reason.includes(v), `${type}: ${v}`);
    assert.ok(!note.reason.endsWith("...[truncated]"), type);
  }
});

test("lineSafe collapses bidirectional format controls to one space", () => {
  for (const mid of ["\u202E", "\u2066\u2069", "\u202A\u202B", "\u200E", "\u200F", "\u061C"]) {
    assert.equal(lineSafe(`a${mid}b`), "a b");
  }
});

test("record with a bidirectional control inside --kernel: collapsed in the note and on stderr", (t) => {
  const s = scratch(t);
  const r = faff(s.root, ["decision-capture", "record", "--run", "run-1", "--issue", "", "--kernel", "bad\u200Fkernel"], { input: PAYLOAD });
  assert.equal(r.code, 0, r.err);
  assert.equal(s.notes().at(-1).kernel, "bad kernel");
  assert.ok(!/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(r.err));
});

const KERNELS = [
  ["next", NEXT],
  ["project-next", ["project-next", "--current", "started", "--kind", "project", "--total", "3", "--active", "1", "--done", "1"]],
  ["claim-verdict", ["claim-verdict", "--claimed-at", "2026-01-01T00:00:00Z", "--now", "2026-01-05T00:00:00Z", "--ttl-hours", "24"]],
  ["eligible", ["eligible", "--label", "faff-automate", "--tracker", "present"]],
  ["park-verdict", ["park-verdict", "--status", "in-progress", "--draft-pr", "absent", "--park-comment", "build", "--human-takeover", "false"]],
];

for (const [kernel, args] of KERNELS) {
  test(`${kernel}: FAFF_DECISION_ISSUE unset, capture on, exits and prints as with capture off`, (t) => {
    const on = scratch(t);
    const off = scratch(t, { capture: "off" });
    const env = (s) => ({ FAFF_RUN_DIR: s.runDir, FAFF_DECISION_CORRELATION_ID: `run-1/x/${kernel}/1` });
    const a = faff(on.root, args, { env: env(on) });
    const b = faff(off.root, args, { env: env(off) });
    assert.equal(a.code, b.code, a.err);
    assert.equal(a.out, b.out);
    assert.equal(b.err, "");
    assert.deepEqual(off.notes(), []);
    const lines = captureLines(a.err);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(`capture suppressed: decision-capture event for kernel ${kernel} refused by the issue-scoped rule`));
  });
}
