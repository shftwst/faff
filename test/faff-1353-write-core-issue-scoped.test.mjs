// FAFF-1353: the events.jsonl write core refuses an issue-scoped event whose issue is empty. The
// rule is the one `eventViolations` applies (issueScopedViolations), run on every minted record
// whether or not a payload check applies, against a profile resolved once, before the lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs, { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(REPO, "plugin", "skills", "faff");
const BIN = join(PLUGIN, "bin", "faff");
const lib = (name) => require(`../plugin/skills/faff/bin/lib/${name}.js`);
const { appendEventRecord, emitGenesisRunStart, eventViolations, issueScopedViolations } = lib("events");
const { cmdCorrectiveAuthor } = lib("corrective");
const { DELIVERY_PROFILE, SECOND_PROFILE } = lib("governance-profile");

const run = (bin, args, opts = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", ...opts, input: opts.input ?? "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const faff = (args, opts) => run(BIN, args, opts);
const lines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const bytes = (p) => (existsSync(p) ? readFileSync(p) : Buffer.alloc(0));
const ISSUE_SCOPED_LINE = "type 'decision-capture' is issue-scoped but missing required field 'issue'";

function mintRun(t, prefix = "faff-1353-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = faff(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root]);
  assert.equal(r.code, 0, r.err);
  const runDir = r.out.trim();
  return { root, runDir, runId: runDir.split("/").pop(), events: join(runDir, "events.jsonl"), lock: join(runDir, "events.jsonl.lock") };
}

function overrideFile(t, profile, name = "profile.json") {
  const dir = mkdtempSync(join(tmpdir(), "faff-1353-profile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  writeFileSync(file, typeof profile === "string" ? profile : JSON.stringify(profile));
  return file;
}

function withOverride(file, fn) {
  const saved = process.env.FAFF_GOVERNANCE_PROFILE;
  process.env.FAFF_GOVERNANCE_PROFILE = file;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.FAFF_GOVERNANCE_PROFILE; else process.env.FAFF_GOVERNANCE_PROFILE = saved;
  }
}

// Records every read of `file` and whether `lockPath` existed at that moment.
function probeReads(file, lockPath, fn) {
  const original = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function patched(p, ...rest) {
    if (p === file) reads.push({ lockHeld: fs.existsSync(lockPath) });
    return original.call(this, p, ...rest);
  };
  try { return { result: fn(), reads }; } finally { fs.readFileSync = original; }
}

function pluginCopy(edit) {
  const dir = mkdtempSync(join(tmpdir(), "faff-plugin-copy-"));
  const copy = join(dir, "faff");
  cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
  edit(join(copy, "contracts", "evidence-v0.3", "schema"));
  return { dir, copy, bin: join(copy, "bin", "faff") };
}
const editJson = (p, fn) => { const doc = JSON.parse(readFileSync(p, "utf8")); fn(doc); writeFileSync(p, JSON.stringify(doc, null, 2)); };
const eventMapping = (doc) => doc.discriminator.mapping["2"].discriminator.mapping;
const requireProbeKey = (type) => (schemaDir) => editJson(join(schemaDir, "run-event.schema.json"), (doc) => {
  const data = eventMapping(doc)[type].properties.data;
  data.required = [...(data.required || []), "probe_required"];
});

const VALID_CAPTURE = {
  kernel: "next", kernel_version: "1", normalised_inputs: {}, verdict: "graft", coverage: "replayable", missing_inputs: [],
  correlation_id: "run/FAFF-1/next/1", causation: { seq: 0, sha256: "0".repeat(64) },
};
const capture = (issue, data = VALID_CAPTURE) => ({ phase: "run", type: "decision-capture", issue, data });
const assertRefused = (ctx, call, expectViolation = ISSUE_SCOPED_LINE) => {
  const before = bytes(ctx.events);
  assert.throws(call, (e) => {
    assert.equal(e.code, "EVENT_SCHEMA");
    assert.ok(e.violations.includes(expectViolation), e.violations.join("; "));
    return true;
  });
  assert.ok(bytes(ctx.events).equals(before), "events.jsonl is byte-identical");
};

// --- the defect is closed ------------------------------------------------------------------

test("default profile: a decision-capture append with issue '' is refused and writes nothing", (t) => {
  const ctx = mintRun(t);
  assertRefused(ctx, () => appendEventRecord(ctx.runDir, ctx.runId, capture("")));
});

test("default profile: a decision-capture append with no issue key is refused and writes nothing", (t) => {
  const ctx = mintRun(t);
  assertRefused(ctx, () => appendEventRecord(ctx.runDir, ctx.runId, capture(undefined)));
});

test("profile override declaring the type issue-scoped: the append is refused and writes nothing", (t) => {
  const ctx = mintRun(t);
  const file = overrideFile(t, DELIVERY_PROFILE);
  assertRefused(ctx, () => withOverride(file, () => appendEventRecord(ctx.runDir, ctx.runId, capture(""))));
});

test("unavailable schema bundle: the append is still refused and writes nothing", (t) => {
  const ctx = mintRun(t);
  const copy = pluginCopy((schemaDir) => rmSync(join(schemaDir, "run-event.schema.json")));
  t.after(() => rmSync(copy.dir, { recursive: true, force: true }));
  const copied = require(join(copy.copy, "bin", "lib", "events.js"));
  assertRefused(ctx, () => copied.appendEventRecord(ctx.runDir, ctx.runId, capture("")));
  assert.ok(!existsSync(join(ctx.runDir, "evidence-schema-unavailable.json")));
});

test("a record failing both halves raises one EVENT_SCHEMA listing the issue violation first, as plain strings", (t) => {
  const ctx = mintRun(t);
  const before = bytes(ctx.events);
  assert.throws(() => appendEventRecord(ctx.runDir, ctx.runId, capture("", {})), (e) => {
    assert.equal(e.code, "EVENT_SCHEMA");
    assert.ok(e.message.startsWith("decision-capture event refused by the v0.3 run-event schema: "), e.message);
    assert.equal(e.violations[0], ISSUE_SCOPED_LINE);
    assert.ok(e.violations.length > 1, e.violations.join("; "));
    assert.ok(e.violations.every((v) => typeof v === "string"));
    return true;
  });
  assert.ok(bytes(ctx.events).equals(before));
});

// --- one implementation --------------------------------------------------------------------

test("issueScopedViolations is the rule eventViolations applies, between the type check and the outcome check", () => {
  assert.deepEqual(issueScopedViolations({ type: "decision-capture", issue: "" }, DELIVERY_PROFILE), [ISSUE_SCOPED_LINE]);
  assert.deepEqual(issueScopedViolations({ type: "decision-capture", issue: "FAFF-1" }, DELIVERY_PROFILE), []);
  assert.deepEqual(issueScopedViolations({ type: "run-start" }, DELIVERY_PROFILE), []);
  assert.deepEqual(issueScopedViolations({ type: "issue-outcome", issue: null }, DELIVERY_PROFILE).length, 1);
  const v = eventViolations({ phase: "nope", type: "issue-outcome", data: { outcome: "bogus" } }, false, DELIVERY_PROFILE);
  assert.match(v[0], /^phase 'nope' not in Phase/);
  assert.match(v[1], /^type 'issue-outcome' is issue-scoped but missing required field 'issue'$/);
  assert.match(v[2], /^issue-outcome\.data\.outcome 'bogus' not in ledger outcome vocabulary/);
});

test("whitespace-only issue is not treated as missing", () => {
  assert.deepEqual(issueScopedViolations({ type: "decision-capture", issue: " " }, DELIVERY_PROFILE), []);
});

// --- structural writes under a disjoint dialect --------------------------------------------

test("disjoint override: emitGenesisRunStart still appends its run-start", (t) => {
  const root = mkdtempSync(join(tmpdir(), "faff-1353-genesis-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20260101-000000-genesis");
  mkdirSync(runDir, { recursive: true });
  const file = overrideFile(t, SECOND_PROFILE);
  withOverride(file, () => emitGenesisRunStart(runDir));
  assert.deepEqual(lines(join(runDir, "events.jsonl")).map((r) => r.type), ["run-start"]);
});

test("disjoint override: the core accepts a ledger-write with no ledger_sha256 because it never runs envelope mode", (t) => {
  const ctx = mintRun(t);
  const file = overrideFile(t, SECOND_PROFILE);
  withOverride(file, () => appendEventRecord(ctx.runDir, ctx.runId, { phase: "run", type: "ledger-write" }));
  assert.equal(lines(ctx.events).at(-1).type, "ledger-write");
});

test("disjoint override: a refused init-interactive against a live L4 run still appends its sentry-trip", (t) => {
  const live = mintRun(t, "faff-1353-live-");
  const ledgerPath = join(live.runDir, "run-ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  writeFileSync(ledgerPath, JSON.stringify({ ...ledger, level: "L4", owner: { ...(ledger.owner || {}), status: "running" } }));
  const file = overrideFile(t, SECOND_PROFILE);
  const r = faff(["run-ledger", "init-interactive", "--issue", "FAFF-2", "--root", live.root], {
    env: { ...process.env, FAFF_RUN_DIR: live.runDir, FAFF_GOVERNANCE_PROFILE: file },
  });
  assert.equal(r.code, 3, r.err);
  assert.equal(lines(live.events).at(-1).type, "sentry-trip");
  assert.ok(!r.err.includes("EVENT_SCHEMA"));
});

// --- profile resolution --------------------------------------------------------------------

test("appendEventRecord under an override reads the override once, with no lock held", (t) => {
  const ctx = mintRun(t);
  const file = overrideFile(t, DELIVERY_PROFILE);
  const { reads } = probeReads(file, ctx.lock, () => withOverride(file, () =>
    appendEventRecord(ctx.runDir, ctx.runId, { phase: "build", type: "build-start", issue: "FAFF-1" })));
  assert.equal(reads.length, 1);
  assert.equal(reads[0].lockHeld, false);
  assert.equal(lines(ctx.events).at(-1).type, "build-start");
});

test("faff corrective author under an override reads it twice, never with the lock held, and appends the event", (t) => {
  const ctx = mintRun(t);
  const file = overrideFile(t, DELIVERY_PROFILE);
  const out = [];
  const originalLog = console.log;
  const { result, reads } = probeReads(file, ctx.lock, () => withOverride(file, () => {
    console.log = (...a) => out.push(a.join(" "));
    try {
      return cmdCorrectiveAuthor(["--op", "park-with-cause", "--cites-signal", "scope-drift", "--issue", "FAFF-1", "--cause", "probe", "--run-dir", ctx.runDir, "--root", ctx.root, "--json"]);
    } finally { console.log = originalLog; }
  }));
  assert.equal(result, 0);
  assert.equal(JSON.parse(out.at(-1)).event_appended, true);
  assert.deepEqual(reads.map((r) => r.lockHeld), [false, false]);
  assert.equal(lines(ctx.events).at(-1).type, "corrective-authored");
});

test("an unreadable or malformed override makes appendEventRecord throw GovernanceProfileError and write nothing", (t) => {
  const ctx = mintRun(t);
  const before = bytes(ctx.events);
  const malformed = overrideFile(t, "{not json");
  for (const file of [join(tmpdir(), "faff-1353-does-not-exist.json"), malformed]) {
    assert.throws(() => withOverride(file, () => appendEventRecord(ctx.runDir, ctx.runId, { phase: "build", type: "build-start", issue: "FAFF-1" })),
      (e) => e.name === "GovernanceProfileError" || e.constructor.name === "GovernanceProfileError");
  }
  assert.ok(bytes(ctx.events).equals(before));
});

test("faff corrective author under a SECOND_PROFILE-shaped override writes its artifact but appends no event", (t) => {
  const ctx = mintRun(t);
  const file = overrideFile(t, SECOND_PROFILE);
  const before = bytes(ctx.events);
  const r = faff(["corrective", "author", "--op", "park-with-cause", "--cites-signal", "scope-drift", "--issue", "FAFF-1", "--cause", "probe", "--run-dir", ctx.runDir, "--root", ctx.root, "--json"],
    { env: { ...process.env, FAFF_GOVERNANCE_PROFILE: file } });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out.trim().split("\n").at(-1));
  assert.equal(out.written, true);
  assert.equal(out.event_appended, false);
  assert.ok(existsSync(out.path));
  assert.ok(bytes(ctx.events).equals(before));
});

// --- CLI pre-check -------------------------------------------------------------------------

test("faff events append of an issue-scoped type with no issue exits 1 and creates no events.jsonl", (t) => {
  const root = mkdtempSync(join(tmpdir(), "faff-1353-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-X");
  mkdirSync(runDir, { recursive: true });
  const r = faff(["events", "append", "--run", "run-X", "--root", root], { input: JSON.stringify({ phase: "build", type: "build-start" }) });
  assert.equal(r.code, 1);
  assert.match(r.err, /type 'build-start' is issue-scoped but missing required field 'issue'/);
  assert.equal(existsSync(join(runDir, "events.jsonl")), false);
});

// --- the other two issue-scoped writers keep their refusal handling ------------------------

test("record-outcome: a core refusal leaves the ledger written, exits 0 and adds no issue-outcome row", (t) => {
  const ctx = mintRun(t);
  const copy = pluginCopy(requireProbeKey("issue-outcome"));
  t.after(() => rmSync(copy.dir, { recursive: true, force: true }));
  const r = run(copy.bin, ["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "shipped", "--run-dir", ctx.runDir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err.trim(), /the ledger IS written$/);
  assert.equal(JSON.parse(readFileSync(join(ctx.runDir, "run-ledger.json"), "utf8")).outcomes["FAFF-1"] !== undefined, true);
  assert.ok(!lines(ctx.events).some((e) => e.type === "issue-outcome"));
});

test("evidence write review-verdict --terminal-only: a core refusal exits 2, writes no verdict and leaves events.jsonl untouched", (t) => {
  const root = mkdtempSync(join(tmpdir(), "faff-1353-terminal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20991231-000000-graft-ISSUE-1");
  mkdirSync(runDir, { recursive: true });
  emitGenesisRunStart(runDir);
  const events = join(runDir, "events.jsonl");
  const before = bytes(events);
  const copy = pluginCopy(requireProbeKey("evidence-terminal-only"));
  t.after(() => rmSync(copy.dir, { recursive: true, force: true }));
  const r = run(copy.bin, ["evidence", "write", "review-verdict", "--terminal-only", "--run-dir", runDir, "--issue", "ISSUE-1"],
    { input: JSON.stringify({ signal: "pass", findings: [] }), cwd: root });
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /cannot append the evidence-terminal-only event; nothing written/);
  assert.ok(!existsSync(join(runDir, "ISSUE-1", "review-verdict.json")));
  assert.ok(bytes(events).equals(before));
});
