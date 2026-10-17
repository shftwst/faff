// FAFF-1260: every writer of events.jsonl and declared-effects.jsonl checks each record against the
// v0.3 payload schemas inside its append lock. A refused record writes nothing; an unavailable
// schema bundle degrades the write to the line validators and leaves a run-dir marker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedFloor } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(REPO, "plugin", "skills", "faff");
const BIN = join(PLUGIN, "bin", "faff");
const lib = (name) => require(`../plugin/skills/faff/bin/lib/${name}.js`);
const { appendEventRecord, emitGenesisRunStart, mintIssueAnchor } = lib("events");
const { EFFECT_KINDS, appendEffectEntries } = lib("effects");
const { appendCommissaireRecord } = lib("commissaire");
const { validateAgainstSchema } = lib("contract-engine");
const RUN_EVENT = JSON.parse(readFileSync(join(REPO, "verification/evidence/v0.3/schema/run-event.schema.json"), "utf8"));
const DECLARED_EFFECT = JSON.parse(readFileSync(join(REPO, "verification/evidence/v0.3/schema/declared-effect.schema.json"), "utf8"));
const MARKER = "evidence-schema-unavailable.json";

const run = (bin, args, opts = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", ...opts, input: opts.input ?? "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const faff = (args, opts) => run(BIN, args, opts);
const lines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const bytes = (p) => (existsSync(p) ? readFileSync(p) : Buffer.alloc(0));

function mintRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const r = faff(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root]);
  assert.equal(r.code, 0, r.err);
  const runDir = r.out.trim();
  return { root, runDir, runId: runDir.split("/").pop(), events: join(runDir, "events.jsonl") };
}
const append = (ctx, payload, opts = {}) => run(opts.bin || BIN, ["events", "append", "--run", ctx.runId, "--root", ctx.root, ...(opts.flags || [])], { input: JSON.stringify(payload), env: opts.env });

// A copy of the plugin whose bundled schemas a test may edit or remove.
function pluginCopy(edit) {
  const dir = mkdtempSync(join(tmpdir(), "faff-plugin-copy-"));
  const copy = join(dir, "faff");
  cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
  const schemaDir = join(copy, "contracts", "evidence-v0.3", "schema");
  edit(schemaDir);
  return { dir, bin: join(copy, "bin", "faff") };
}
const editJson = (p, fn) => { const doc = JSON.parse(readFileSync(p, "utf8")); fn(doc); writeFileSync(p, JSON.stringify(doc, null, 2)); };
const eventMapping = (doc) => doc.discriminator.mapping["2"].discriminator.mapping;

// --- Scenarios ----------------------------------------------------------------------------

test("scenario: faff events append drops an unknown agent data key, names it without its value, and the chain still verifies", () => {
  const ctx = mintRun("faff-1260-drop-");
  try {
    const r = append(ctx, { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped", rework_turns: 0, mood: "great" } });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /dropped data key\(s\) \{mood\} not in the issue-outcome schema/);
    assert.doesNotMatch(r.err, /great/);
    assert.deepEqual(lines(ctx.events).at(-1).data, { outcome: "shipped", rework_turns: 0, dropped_keys: ["mood"] });
    assert.equal(faff(["events", "verify", "--run-dir", ctx.runDir]).code, 0);
  } finally { rmSync(ctx.root, { recursive: true, force: true }); }
});

test("scenario: an events core caller minting a mistyped runner-identity throws EVENT_SCHEMA, writes nothing and never prints the value", () => {
  const ctx = mintRun("faff-1260-core-");
  try {
    const before = bytes(ctx.events);
    const data = { github_login: 7, github_login_source: "unresolved", credential_source: "ambient", credential_unresolved: false, verified: false };
    assert.throws(() => appendEventRecord(ctx.runDir, ctx.runId, { phase: "run", type: "runner-identity", data }), (e) => {
      assert.equal(e.code, "EVENT_SCHEMA");
      assert.ok(e.violations.some((v) => v.startsWith("data.github_login")), e.violations.join("; "));
      assert.ok(!e.violations.join(" ").includes("7"), "the violation names the field, never the value");
      return true;
    });
    assert.ok(bytes(ctx.events).equals(before));
  } finally { rmSync(ctx.root, { recursive: true, force: true }); }
});

function admittedRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "run-20260101-000000-writers");
  mkdirSync(runDir, { recursive: true });
  assert.equal(faff(["commissaire", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}
const requestDecision = (runDir, body) => faff(["commissaire", "request-decision", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { input: JSON.stringify(body) });

test("scenario: a request whose caller passes a malformed effect is chained and judged exactly as before, and both records pass the composed schema", () => {
  const { root, runDir, ledger } = admittedRun("faff-1260-request-");
  try {
    // An extra descriptor key is not a leg-4 failure on main: undeclared, it is denied effect-not-declared.
    const extra = requestDecision(runDir, { effect: { kind: "merge", target: "main", colour: "red" } });
    assert.equal(extra.code, 0, extra.err);
    assert.deepEqual(JSON.parse(extra.out), { ...JSON.parse(extra.out), verdict: "deny", reason: "effect-not-declared" });
    const badType = requestDecision(runDir, { effect: { kind: "merge", target: 5 } });
    assert.equal(badType.code, 0, badType.err);
    assert.equal(JSON.parse(badType.out).reason, "invalid-effect-descriptor");
    const records = lines(ledger).slice(1);
    assert.deepEqual(records.map((r) => r.kind_of_entry), ["effect-decision-request", "effect-decision-verdict", "effect-decision-request", "effect-decision-verdict"]);
    assert.equal(records[0].payload.effect.colour, "red", "the raw descriptor is chained as given");
    for (const rec of records) assert.deepEqual(validateAgainstSchema(rec, DECLARED_EFFECT), [], JSON.stringify(rec));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario: an in-process admission with an extra payload key aborts, names payload.colour and leaves the ledger byte-identical", () => {
  const { root, runDir, ledger } = admittedRun("faff-1260-admission-");
  try {
    const before = bytes(ledger);
    const gov = JSON.parse(readFileSync(join(runDir, "commissaire", "governor", "governor.json"), "utf8"));
    const body = { kind_of_entry: "admission", unit_id: "-", step: "admit", payload: { producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"], pk_fingerprint: gov.pk_fingerprint, admitted_at: "t", colour: "red" } };
    assert.throws(() => appendCommissaireRecord(runDir, gov.sk, "P1", "r1", body), (e) => e.code === "RECORD_SCHEMA" && e.violations.some((v) => v.includes('"colour"') && v.startsWith("payload")));
    assert.ok(bytes(ledger).equals(before));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("commissaire verbs: a producer record the schema refuses exits 2 naming the violation and writes nothing", () => {
  const { root, runDir, ledger } = admittedRun("faff-1260-verb-");
  try {
    const before = bytes(ledger);
    const r = requestDecision(runDir, { effect: { kind: "merge", target: "main" }, level: 5 });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /payload\.level/);
    assert.ok(bytes(ledger).equals(before));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- faff events append -------------------------------------------------------------------

test("events append: exit codes for type errors, missing keys, extras, bounds, nested keys and the reserved dropped_keys", () => {
  const ctx = mintRun("faff-1260-append-");
  try {
    const refused = (payload, pattern) => {
      const before = bytes(ctx.events);
      const r = append(ctx, payload);
      assert.equal(r.code, 1, `${JSON.stringify(payload)}: ${r.out}${r.err}`);
      if (pattern) assert.match(r.err, pattern);
      assert.ok(bytes(ctx.events).equals(before));
    };
    refused({ phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped", rework_turns: "two" } });
    refused({ phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { rework_turns: 1 } });
    refused({ phase: "build", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d", cluster_id: "c", cluster_size: 1, prompt: "x" } });
    refused({ phase: "build", type: "bundle-store-unavailable", data: { boundary_kind: "issue-merge-floor" } }, /missing required property "boundary_key"/);
    refused({ phase: "build", type: "build-start", issue: "FAFF-1", data: { sequential: "yes" } }, /data\.sequential/);
    refused({ phase: "run", type: "budget-checkpoint", data: { spent: { attempts: 1, wall: 2 } } }, /data\.spent: additional property "wall"/);
    refused({ phase: "prep", type: "prep-start", issue: "FAFF-1", data: { dropped_keys: [] } }, /reserved/);
    refused({ phase: "prep", type: "prep-start", issue: "FAFF-1", data: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])) }, /at most 16/);
    refused({ phase: "prep", type: "prep-start", issue: "FAFF-1", data: { "bad key!": 1 } });
    const missingDir = append({ ...ctx, runId: "run-does-not-exist" }, { phase: "run", type: "run-end" });
    assert.equal(missingDir.code, 3);
  } finally { rmSync(ctx.root, { recursive: true, force: true }); }
});

test("events append: absent data and empty data on an optional-data type append without dropped_keys", () => {
  const ctx = mintRun("faff-1260-empty-");
  try {
    for (const payload of [{ phase: "prep", type: "prep-start", issue: "FAFF-1" }, { phase: "prep", type: "prep-start", issue: "FAFF-1", data: {} }]) {
      const r = append(ctx, payload);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.err, "");
      const rec = lines(ctx.events).at(-1);
      assert.ok(!rec.data || !("dropped_keys" in rec.data));
    }
  } finally { rmSync(ctx.root, { recursive: true, force: true }); }
});

test("events append: under a second governance profile there is no drop and no payload check", () => {
  const ctx = mintRun("faff-1260-profile-");
  try {
    const profile = join(ctx.root, "second.json");
    writeFileSync(profile, JSON.stringify({
      terminal_states: ["done", "open"], event_phases: ["job"], event_types: ["job-start", "job-end"],
      issue_scoped_types: ["job-start"], outcome_required_types: ["job-end"], ledger_outcomes: ["done", "open"],
      sentry: {
        thresholds: { thrash_n: 5, failure_k: 5, stall_window_secs: 600, run_elapsed_ceiling_secs: 7200, estimate_metering_exposure_secs: 300 },
        thrash: { start_type: "job-start", ship_type: "job-end", ship_outcome: "done" },
        failure: { park_type: "job-end", outcome_type: "job-end", errored_outcome: "open" },
        progress: { forward_types: ["job-start"] },
      },
    }));
    const r = append(ctx, { phase: "job", type: "job-start", issue: "J-1", data: { anything: 1 } }, { env: { ...process.env, FAFF_GOVERNANCE_PROFILE: profile } });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(lines(ctx.events).at(-1).data, { anything: 1 });
  } finally { rmSync(ctx.root, { recursive: true, force: true }); }
});

test("events append: with run-event.schema.json missing the write degrades, marks the run dir once, and the marker is never anchored", () => {
  const ctx = mintRun("faff-1260-degraded-");
  const copy = pluginCopy((schemaDir) => rmSync(join(schemaDir, "run-event.schema.json")));
  try {
    const first = append(ctx, { phase: "prep", type: "prep-start", issue: "FAFF-1" }, { bin: copy.bin });
    assert.equal(first.code, 0, first.err);
    assert.match(first.err, /schema-unavailable schema\/run-event\.schema\.json/);
    assert.equal(lines(ctx.events).at(-1).type, "prep-start");
    const marker = JSON.parse(readFileSync(join(ctx.runDir, MARKER), "utf8"));
    assert.deepEqual(Object.keys(marker).sort(), ["first_at", "path", "writer"]);
    assert.equal(marker.writer, "events");
    const second = append(ctx, { phase: "build", type: "build-start", issue: "FAFF-1" }, { bin: copy.bin });
    assert.equal(second.code, 0, second.err);
    assert.deepEqual(JSON.parse(readFileSync(join(ctx.runDir, MARKER), "utf8")), marker, "the marker is written once");
    const notAType = append(ctx, { phase: "run", type: "no-such-type" }, { bin: copy.bin });
    assert.equal(notAType.code, 1, "eventViolations still runs");
    seedFloor(ctx.runDir, "FAFF-1");
    const dest = join(ctx.root, "anchor");
    assert.equal(faff(["events", "anchor", "--run-dir", ctx.runDir, "--issue", "FAFF-1", "--dest", dest]).code, 0);
    assert.ok(!readdirSync(dest, { recursive: true }).some((f) => String(f).includes(MARKER)));
  } finally { rmSync(ctx.root, { recursive: true, force: true }); rmSync(copy.dir, { recursive: true, force: true }); }
});

test("events append: an event type with no mapping in a loaded schema is refused", () => {
  const ctx = mintRun("faff-1260-unmapped-");
  const copy = pluginCopy((schemaDir) => editJson(join(schemaDir, "run-event.schema.json"), (doc) => { delete eventMapping(doc)["run-end"]; }));
  try {
    const r = append(ctx, { phase: "run", type: "run-end", data: { shipped: 1 } }, { bin: copy.bin });
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /not in mapping/);
  } finally { rmSync(ctx.root, { recursive: true, force: true }); rmSync(copy.dir, { recursive: true, force: true }); }
});

test("commissaire: with declared-effect.schema.json missing an admission degrades and marks the run dir", () => {
  const copy = pluginCopy((schemaDir) => rmSync(join(schemaDir, "declared-effect.schema.json")));
  const root = mkdtempSync(join(tmpdir(), "faff-1260-com-degraded-"));
  try {
    const runDir = join(root, ".faff", "runs", "run-x");
    mkdirSync(runDir, { recursive: true });
    const r = run(copy.bin, ["commissaire", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /schema-unavailable schema\/declared-effect\.schema\.json/);
    assert.equal(JSON.parse(readFileSync(join(runDir, MARKER), "utf8")).writer, "commissaire");
    assert.equal(lines(join(runDir, "declared-effects.jsonl")).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(copy.dir, { recursive: true, force: true }); }
});

// --- appendEffectEntries ------------------------------------------------------------------

test("appendEffectEntries refuses an extra descriptor key and a kind with no schema, writing nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-1260-effects-"));
  try {
    const ledger = join(root, "declared-effects.jsonl");
    const extra = appendEffectEntries(root, "declare", "FAFF-1", "merge", [{ kind: "merge", target: "main", colour: "red" }]);
    assert.ok(extra.violations && extra.violations[0].violations.some((v) => v.includes('"colour"')), JSON.stringify(extra));
    EFFECT_KINDS.add("teleport");
    try {
      const unschemaed = appendEffectEntries(root, "declare", "FAFF-1", "merge", [{ kind: "teleport", target: "x" }]);
      assert.ok(unschemaed.violations && unschemaed.violations[0].violations.some((v) => v.includes("not in mapping")), JSON.stringify(unschemaed));
    } finally { EFFECT_KINDS.delete("teleport"); }
    assert.ok(!existsSync(ledger));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- best-effort callers log a refusal ----------------------------------------------------

test("bundle publish: a refused bundle-store-unavailable event writes the violation to stderr and the run continues", () => {
  const copy = pluginCopy((schemaDir) => editJson(join(schemaDir, "run-event.schema.json"), (doc) => {
    const data = eventMapping(doc)["bundle-store-unavailable"].properties.data;
    delete data.properties.detail;
    data.required = data.required.filter((k) => k !== "detail");
  }));
  const root = mkdtempSync(join(tmpdir(), "faff-1260-bundle-"));
  try {
    const runId = "run-20260101-000000-bundle";
    const runDir = join(root, ".faff", "runs", runId);
    mkdirSync(join(runDir, "FAFF-1"), { recursive: true });
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: {}, owner: { epoch: 0, status: "running" } }));
    emitGenesisRunStart(runDir);
    assert.equal(mintIssueAnchor(runDir, "FAFF-1", join(root, ".faff", "anchors", runId, "FAFF-1")).ok, true);
    writeFileSync(join(root, ".faffrc.yaml"), "bundle_store: git-remote\n");
    spawnSync("git", ["-C", root, "init", "-q"]);
    spawnSync("git", ["-C", root, "remote", "add", "origin", join(root, "nonexistent-remote.git")]);
    const before = bytes(join(runDir, "events.jsonl"));
    const r = run(copy.bin, ["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /bundle-store-unavailable event not recorded.*additional property "detail"/);
    assert.ok(bytes(join(runDir, "events.jsonl")).equals(before));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(copy.dir, { recursive: true, force: true }); }
});

async function waitUntil(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return predicate();
}

test("sentry-poller: a refused abort-tick event is logged as event-schema-refused and no event is written", async () => {
  const copy = pluginCopy((schemaDir) => editJson(join(schemaDir, "run-event.schema.json"), (doc) => {
    for (const type of ["sentry-checkpoint", "sentry-trip"]) delete eventMapping(doc)[type].properties.data.properties.verdicts;
  }));
  const root = mkdtempSync(join(tmpdir(), "faff-1260-poller-"));
  try {
    const runDir = join(root, ".faff", "runs", "RUN-POLL");
    mkdirSync(runDir, { recursive: true });
    const window = Number(faff(["config", "get", "sentry.stall_window_secs"]).out.trim()) || 900;
    const stale = new Date(Date.now() - (window + 200) * 1000).toISOString();
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: stale, last_heartbeat: stale } }));
    const started = JSON.parse(run(copy.bin, ["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);
    const log = () => (existsSync(join(runDir, "sentry-poller.log")) ? readFileSync(join(runDir, "sentry-poller.log"), "utf8") : "");
    assert.ok(await waitUntil(() => log().includes("abort-actioned") && (log().match(/event-schema-refused/g) || []).length >= 2), log());
    assert.match(log(), /event-schema-refused \{"type":"sentry-checkpoint","violations":\[/);
    assert.ok(!lines(join(runDir, "events.jsonl")).some((e) => e.type === "sentry-checkpoint" || e.type === "sentry-trip"));
    run(copy.bin, ["sentry-poller", "stop", "--run-dir", runDir]);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(copy.dir, { recursive: true, force: true }); }
});

// --- governor-signed records --------------------------------------------------------------

const FAKE_GOVERNOR = `
const net = require("node:net");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const pa = require(${JSON.stringify(join(PLUGIN, "bin", "lib", "producer-auth.js"))});
const [sock, mode, logFile] = process.argv.slice(2);
const kp = pa.mintGovernorKeypair();
const signed = (runId, seq, prev, body) => {
  const rec = pa.buildEnvelope(runId, seq, prev, "commissaire", "P1", "r1", body);
  rec.commissaire_sig = pa.signDecision(rec, kp.sk);
  return rec;
};
const reply = (req) => {
  fs.appendFileSync(logFile, req.op + "\\n");
  if (req.op === "admit") {
    const payload = { producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"], pk_fingerprint: kp.pk_fingerprint, admitted_at: "2026-01-01T00:00:00Z", custody: "governor" };
    if (mode === "bad-admit") payload.colour = "red";
    const genesis = createHash("sha256").update(req.run_id, "utf8").digest("hex");
    const admission_record = signed(req.run_id, 0, genesis, { kind_of_entry: "admission", unit_id: "-", step: "admit", payload });
    return { ok: true, custody: "governor", producer_id: "P1", k_producer_hex: "ab".repeat(32), pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, admitted_scope: ["merge"], admission_record };
  }
  if (req.op === "authorize") {
    const payload = { request_seq: req.request_seq, verdict: "grant", reason: "all-legs-pass", effect: req.effect };
    if (mode === "bad-verdict") payload.colour = "red";
    return { ok: true, verdict_record: signed(req.run_id, req.at.seq, req.at.prev, { kind_of_entry: "effect-decision-verdict", unit_id: req.unit_id, step: req.step, payload }) };
  }
  if (req.op === "conclude") {
    const payload = { producer_id: "P1", contract_revision: "r1", evidence_seq_range: [0, 1, 2], escapes_checked: true };
    return { ok: true, record: signed(req.run_id, req.at.seq, req.at.prev, { kind_of_entry: "conformed_to_contract", unit_id: req.unit_id, step: "conclude", payload }) };
  }
  return { ok: false, reason: "unknown-op" };
};
net.createServer((c) => {
  let buf = "";
  c.on("data", (d) => { buf += d; const nl = buf.indexOf("\\n"); if (nl >= 0) c.end(JSON.stringify(reply(JSON.parse(buf.slice(0, nl)))) + "\\n"); });
}).listen(sock, () => process.stdout.write("listening\\n"));
`;

async function withFakeGovernor(mode, fn) {
  const dir = mkdtempSync(join(tmpdir(), "faff-1260-gov-"));
  const script = join(dir, "governor.cjs");
  const sock = join(dir, "gov.sock");
  const log = join(dir, "asks.log");
  writeFileSync(script, FAKE_GOVERNOR);
  const child = spawn(process.execPath, [script, sock, mode, log], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("fake governor did not start")), 8000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(to); resolve(); } });
    });
    const runDir = join(dir, ".faff", "runs", "run-20260101-000000-governed");
    mkdirSync(runDir, { recursive: true });
    const env = { ...process.env, COMMISSAIRE_GOVERNOR: sock };
    const asks = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
    await fn({ runDir, env, asks });
  } finally {
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
}
const SKIP_GOVERNOR = process.platform === "win32" ? "needs a unix socket" : false;
const com = (runDir, env, args, input) => faff(["commissaire", ...args, "--run-dir", runDir], { env, input: input === undefined ? "" : JSON.stringify(input) });

test("governor: an admission record the schema refuses exits 2 and writes neither producer files nor a ledger line", { skip: SKIP_GOVERNOR }, async () => {
  await withFakeGovernor("bad-admit", async ({ runDir, env }) => {
    const r = com(runDir, env, ["admit", "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /payload: additional property "colour"/);
    assert.ok(!existsSync(join(runDir, "commissaire")), "no producer files");
    assert.ok(!existsSync(join(runDir, "declared-effects.jsonl")), "no ledger line");
  });
});

test("governor: a verdict record the schema refuses parks governor-record-unverified without retrying, and a conclusion holding three seqs does too", { skip: SKIP_GOVERNOR }, async () => {
  await withFakeGovernor("bad-verdict", async ({ runDir, env, asks }) => {
    assert.equal(com(runDir, env, ["admit", "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    const ledger = join(runDir, "declared-effects.jsonl");
    const r = com(runDir, env, ["request-decision", "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], { effect: { kind: "merge", target: "main" } });
    assert.equal(r.code, 2, r.out + r.err);
    assert.equal(JSON.parse(r.out).reason, "governor-record-unverified");
    assert.match(r.err, /payload: additional property "colour"/);
    assert.deepEqual(asks(), ["admit", "authorize"], "asked once, never retried as a lost race");
    assert.deepEqual(lines(ledger).map((e) => e.kind_of_entry), ["admission", "effect-decision-request"]);
    const c = com(runDir, env, ["verdict", "conclude", "--unit-id", "FAFF-1"]);
    assert.equal(c.code, 2, c.out + c.err);
    assert.equal(JSON.parse(c.out).reason, "governor-record-unverified");
    assert.match(c.err, /payload\.evidence_seq_range: expected at most 2 items, got 3/);
    assert.deepEqual(lines(ledger).map((e) => e.kind_of_entry), ["admission", "effect-decision-request"]);
  });
});

test("governor: with declared-effect.schema.json missing a three-seq conclusion is not length-checked (the degrade path returns before any range check)", { skip: SKIP_GOVERNOR }, async () => {
  await withFakeGovernor("bad-verdict", async ({ runDir, env }) => {
    const copy = pluginCopy((schemaDir) => rmSync(join(schemaDir, "declared-effect.schema.json")));
    try {
      const run2 = (args) => run(copy.bin, ["commissaire", ...args, "--run-dir", runDir], { env, input: "" });
      assert.equal(run2(["admit", "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
      const rd = run(copy.bin, ["commissaire", "request-decision", "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge", "--run-dir", runDir], { env, input: JSON.stringify({ effect: { kind: "merge", target: "main" } }) });
      assert.equal(rd.code, 0, rd.out + rd.err);
      const c = run2(["verdict", "conclude", "--unit-id", "FAFF-1"]);
      assert.equal(c.code, 0, c.out + c.err);
      assert.ok(!/evidence_seq_range/.test(c.err), "no writer-side range check ran");
      assert.equal(JSON.parse(readFileSync(join(runDir, MARKER), "utf8")).writer, "commissaire");
      const lastKind = lines(join(runDir, "declared-effects.jsonl")).at(-1).kind_of_entry;
      assert.equal(lastKind, "conformed_to_contract");
    } finally { rmSync(copy.dir, { recursive: true, force: true }); }
  });
});
