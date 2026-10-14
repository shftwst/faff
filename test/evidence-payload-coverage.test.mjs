// FAFF-1260: the v0.3 payload schemas. One closed schema per event type, effect kind and
// Commissaire record kind; the composed log schemas stay in step with them; the code writers' own
// records pass; and the evidence schema-3 schemas agree with the Commissaire facade v0.3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(REPO, "verification", "evidence", "v0.3", "schema");
const FACADE = join(REPO, "verification", "commissaire-facade", "v0.3", "schema");
const COMPOSE = join(REPO, "scripts", "evidence-v0.3-compose.mjs");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const lib = (name) => require(`../plugin/skills/faff/bin/lib/${name}.js`);
const { DELIVERY_PROFILE } = lib("governance-profile");
const { DISPATCH_ALLOWED_DATA_KEYS, appendEventRecord, appendRecordUnderLock, emitGenesisRunStart, eventViolations } = lib("events");
const { CONCLUSION_KIND, EFFECT_KINDS, LEGACY_CONCLUSION_KIND, declaredEffectViolations } = lib("effects");
const { KIND_AUTHOR } = lib("commissaire");
const { validateAgainstSchema } = lib("contract-engine");
const sentry = lib("sentry");
const { resolveRunnerIdentity, recordRunnerIdentity } = lib("merge-gate");
const { runResumeEvent } = lib("resume");
const { runClaimAbandonedEvent } = lib("resumecheck");
const { parkReconsideredRecord } = lib("park-reconsider");
const { mutateLedgerUnderLock } = lib("heartbeat");
const { foldCorrectiveConstraints } = lib("corrective");
const { gitRemoteBundleStore, publishBundle } = lib("bundle");
const { mintIssueAnchor } = lib("events");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const names = (dir) => readdirSync(join(SCHEMA, dir)).filter((f) => f.endsWith(".schema.json")).map((f) => f.slice(0, -".schema.json".length)).sort();
const runEvent = () => readJson(join(SCHEMA, "run-event.schema.json"));
const declaredEffect = () => readJson(join(SCHEMA, "declared-effect.schema.json"));
const lines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const cli = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

// --- coverage -------------------------------------------------------------------------

test("payload coverage: one schema file per event type, effect kind and Commissaire record kind", () => {
  assert.deepEqual(names("events"), [...DELIVERY_PROFILE.event_types].sort());
  assert.deepEqual(names("effects"), [...EFFECT_KINDS].sort());
  assert.deepEqual(names("commissaire"), [...Object.keys(KIND_AUTHOR), LEGACY_CONCLUSION_KIND].sort());
  assert.equal(names("events").length, 27);
  assert.equal(names("effects").length, 16);
  assert.equal(names("commissaire").length, 8);
});

test("payload coverage: each Commissaire schema's author is the one KIND_AUTHOR gives its kind", () => {
  for (const kind of names("commissaire")) {
    const author = KIND_AUTHOR[kind === LEGACY_CONCLUSION_KIND ? CONCLUSION_KIND : kind];
    assert.deepEqual(readJson(join(SCHEMA, "commissaire", `${kind}.schema.json`)).properties.author.enum, [author], kind);
  }
});

test("payload coverage: evidence-terminal-only is an issue-scoped event type whose data requires issue and writer", () => {
  assert.ok(DELIVERY_PROFILE.event_types.includes("evidence-terminal-only"));
  assert.ok(DELIVERY_PROFILE.issue_scoped_types.includes("evidence-terminal-only"));
  const s = readJson(join(SCHEMA, "events", "evidence-terminal-only.schema.json"));
  assert.ok(s.required.includes("data") && s.required.includes("issue"));
  assert.deepEqual(s.properties.data.required, ["issue", "writer"]);
  const rec = { schema: 2, run_id: "r", seq: 1, ts: "t", prev: "a".repeat(64), phase: "build", type: "evidence-terminal-only", issue: "FAFF-1", data: { issue: "FAFF-1", writer: "faff evidence write review-verdict --terminal-only" } };
  assert.deepEqual(validateAgainstSchema(rec, runEvent()), []);
  assert.ok(validateAgainstSchema({ ...rec, data: { ...rec.data, issue: "" } }, runEvent()).length > 0, "an empty issue fails");
});

test("payload coverage: agent-dispatch and runner-identity data hold exactly the events.js allow-lists", () => {
  const byType = runEvent().discriminator.mapping["2"].discriminator.mapping;
  assert.deepEqual(Object.keys(byType["agent-dispatch"].properties.data.properties).sort(), [...DISPATCH_ALLOWED_DATA_KEYS].sort());
  const { RUNNER_IDENTITY_CREDENTIAL_SOURCES } = lib("events");
  assert.deepEqual(Object.keys(byType["runner-identity"].properties.data.properties).sort(),
    ["credential_source", "credential_unresolved", "github_login", "github_login_source", "verified"]);
  const evidence = [
    resolveRunnerIdentity({ configuredLogin: null }, { identitySource: "ambient", credentialUnresolved: true }),
    resolveRunnerIdentity({ configuredLogin: "octocat" }, { identitySource: "ambient", credentialUnresolved: false }),
    resolveRunnerIdentity({ configuredLogin: null }, { identitySource: "runner-credential", credentialUnresolved: false }, { status: "authed", login: "octocat" }),
    resolveRunnerIdentity({ configuredLogin: "app[bot]" }, { identitySource: "runner-credential", credentialUnresolved: false }, { status: "auth-failed", login: null }),
    resolveRunnerIdentity({ configuredLogin: null }, { identitySource: "runner-credential", credentialUnresolved: false }, { status: "indeterminate", login: null }),
  ];
  assert.deepEqual(new Set(evidence.map((e) => e.credential_source)), RUNNER_IDENTITY_CREDENTIAL_SOURCES);
  assert.ok(evidence.some((e) => e.github_login === null), "the unresolved-login case is covered");
  for (const data of evidence) {
    const rec = { schema: 2, run_id: "r", seq: 1, ts: "t", prev: "a".repeat(64), phase: "run", type: "runner-identity", data };
    assert.deepEqual(validateAgainstSchema(rec, runEvent()), [], JSON.stringify(data));
  }
});

// --- composition ------------------------------------------------------------------------

test("compose: the committed composed schemas and bundled copy are a fresh composition", () => {
  const r = spawnSync(process.execPath, [COMPOSE, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("compose: hand-editing a composed schema makes --check exit 1 naming the file", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-compose-"));
  try {
    for (const rel of ["scripts/evidence-v0.3-compose.mjs", "verification/evidence/v0.3", "plugin/skills/faff/contracts/evidence-v0.3", "plugin/skills/faff/bin"]) {
      cpSync(join(REPO, rel), join(root, rel), { recursive: true });
    }
    const composed = join(root, "verification/evidence/v0.3/schema/run-event.schema.json");
    const doc = readJson(composed);
    doc.discriminator.mapping["2"].discriminator.mapping.park.properties.data.properties.mood = { type: "string" };
    writeFileSync(composed, JSON.stringify(doc, null, 2) + "\n");
    const r = spawnSync(process.execPath, [join(root, "scripts/evidence-v0.3-compose.mjs"), "--check"], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /verification\/evidence\/v0\.3\/schema\/run-event\.schema\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- sentry verdicts --------------------------------------------------------------------

test("sentry: the verdict signal mapping is exactly SIGNAL_TRIP_INTERVENTION, and one built verdict per signal passes both sentry event schemas", () => {
  const byType = runEvent().discriminator.mapping["2"].discriminator.mapping;
  for (const type of ["sentry-checkpoint", "sentry-trip"]) {
    assert.deepEqual(Object.keys(byType[type].properties.data.properties.verdicts.items.discriminator.mapping).sort(), Object.keys(sentry.SIGNAL_TRIP_INTERVENTION).sort(), type);
  }
  const th = DELIVERY_PROFILE.sentry.thresholds;
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const ago = (secs) => new Date(now - secs * 1000).toISOString();
  const running = (hbSecs, startSecs) => ({ owner: { status: "running", last_heartbeat: ago(hbSecs), started_at: ago(startSecs) } });
  const repeat = (n, ev) => Array.from({ length: n }, (_, i) => ({ ...ev, seq: i + 1 }));
  const verdicts = [
    sentry.evalBudgetBreach({ breached: ["tokens"], outcome: "stop" }),
    sentry.evalWallClock(running(th.stall_window_secs + 60, th.stall_window_secs + 60), now, th, "heartbeat-file"),
    sentry.evalHeartbeatProgressMismatch(running(10, th.stall_window_secs + 60), [], now, th),
    sentry.evalThrash(repeat(th.thrash_n, { type: "build-start", issue: "FAFF-1" }), th),
    sentry.evalRepeatedFailure(repeat(th.failure_k, { type: "park", issue: "FAFF-1", data: { reason: "same" } }), th),
    sentry.evalBudgetMeteringDegraded(running(10, th.estimate_metering_exposure_secs + 60), { tokens_source: "estimate" }, now, th),
    sentry.evalScopeDrift({ ledger: { level: "L4", discovered_scope_filed: 1, prd_root_container: null }, events: [] }),
    sentry.evalForbiddenSideEffect({ forbidden_side_effect: true, events: [] }),
    ...sentry.evalMemberStall([{ issue: "FAFF-2", last_build_start_ts: ago(th.stall_window_secs + 60) }], {}, now, th),
  ];
  assert.ok(verdicts.every(Boolean), "every predicate tripped");
  assert.deepEqual([...new Set(verdicts.map((v) => v.signal))].sort(), Object.keys(sentry.SIGNAL_TRIP_INTERVENTION).sort());
  const { verdicts: folded, intervention, tripped } = sentry.evaluateDerailment({ events: [], ledger: {}, now_ms: now }, th);
  const base = { schema: 2, run_id: "r", seq: 1, ts: "t", prev: "a".repeat(64), phase: "run" };
  for (const data of [{ verdicts, intervention: "abort", tripped: true, thresholds: th }, { verdicts: folded, intervention, tripped }]) {
    assert.deepEqual(validateAgainstSchema({ ...base, type: "sentry-checkpoint", data }, runEvent()), []);
    assert.deepEqual(validateAgainstSchema({ ...base, type: "sentry-trip", data: { verdicts: data.verdicts, intervention: data.intervention } }, runEvent()), []);
  }
});

// --- the code writers' own records -------------------------------------------------------

function freshRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runId = "run-20260101-000000-coverage";
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return { root, runId, runDir };
}

function assertLogsConform(runDir) {
  const events = lines(join(runDir, "events.jsonl"));
  const effects = lines(join(runDir, "declared-effects.jsonl"));
  for (const rec of events) {
    assert.deepEqual(eventViolations(rec, true), [], JSON.stringify(rec));
    assert.deepEqual(validateAgainstSchema(rec, runEvent()), [], JSON.stringify(rec));
  }
  for (const rec of effects) {
    assert.deepEqual(declaredEffectViolations(rec), [], JSON.stringify(rec));
    assert.deepEqual(validateAgainstSchema(rec, declaredEffect()), [], JSON.stringify(rec));
  }
  return { events, effects };
}

test("code writers: the records every events.jsonl code writer mints pass the composed run-event schema", () => {
  const { root, runId, runDir } = freshRun("faff-payload-writers-");
  try {
    emitGenesisRunStart(runDir, { level: "L3" });
    mutateLedgerUnderLock(runDir, () => ({ run_id: runId, admitted: ["FAFF-1"], outcomes: {}, owner: { status: "running" } }));
    recordRunnerIdentity(runDir, { env: {} });
    appendRecordUnderLock(runDir, (seq, _p, prevHash) => runResumeEvent(runId, seq, "2026-01-01T00:00:00.000Z", "aborted-resumable", { epoch: 2, skip: ["FAFF-1"], redispatch: [] }, prevHash));
    appendRecordUnderLock(runDir, (seq, _p, prevHash) => runClaimAbandonedEvent(runId, seq, "2026-01-01T00:00:00.000Z", 2, prevHash));
    const reconsidered = parkReconsideredRecord("FAFF-1", { cause_class: "awaiting-input", cited_input: { ref: "spec", fingerprint: "f1" } }, "resume-reconsider", true, null, "f1", "f2");
    appendEventRecord(runDir, runId, { phase: "run", type: reconsidered.type, data: reconsidered.data });
    const inputs = [{ op: "forbid-surface", issue: "FAFF-1", payload: { surfaces: ["docs/"] }, cites: { signal: "scope-drift", event_seq: 1, evidence: "" }, authored_at: "t" }];
    const { mandate, constraints, applied } = foldCorrectiveConstraints(inputs);
    appendEventRecord(runDir, runId, { phase: "run", type: "corrective-consumed", issue: "FAFF-1", data: { disposition: "trusted", basis: "asserted", mandate, constraints, applied, rejected: [{ file: "0001-FAFF-1.json", reasons: ["x"] }], parks: 0 } });
    assert.equal(cli(["corrective", "author", "--run-dir", runDir, "--issue", "FAFF-1", "--op", "forbid-surface", "--surface", "docs/", "--cites-signal", "scope-drift", "--root", root]).code, 0);
    const contained = cli(["contain", "FAFF-1", "--parent", "FAFF-2", "--ancestry", JSON.stringify([{ id: "FAFF-2", parentId: "FAFF-1" }]), "--record", runId], { cwd: root });
    assert.equal(contained.code, 0, contained.err);
    const intake = cli(["self-intake", "FAFF-1", "--target", '{"team":null,"repo":"acme/app"}', "--record", runId], { cwd: root });
    assert.ok([0, 3].includes(intake.code), intake.err);
    writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n");
    const dc = cli(["decision-capture", "record", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--root", root], { input: JSON.stringify({ normalised_inputs: { status: "todo" }, selected_action: "graft" }) });
    assert.equal(dc.code, 0, dc.err);
    const { events } = assertLogsConform(runDir);
    const types = new Set(events.map((e) => e.type));
    for (const type of ["run-start", "ledger-write", "runner-identity", "run-resume", "run-claim-abandoned", "park-reconsidered", "corrective-consumed", "corrective-authored", "containment-check", "self-intake-check", "decision-capture"]) {
      assert.ok(types.has(type), `a ${type} record was minted`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("code writers: bundle publish against an unreachable store records a conforming bundle-store-unavailable event", () => {
  const { root, runId, runDir } = freshRun("faff-payload-bundle-");
  try {
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: {}, owner: { epoch: 0, status: "running" } }));
    emitGenesisRunStart(runDir);
    mkdirSync(join(runDir, "FAFF-1"), { recursive: true });
    assert.equal(mintIssueAnchor(runDir, "FAFF-1", join(root, ".faff", "anchors", runId, "FAFF-1")).ok, true);
    spawnSync("git", ["-C", root, "init", "-q"]);
    spawnSync("git", ["-C", root, "remote", "add", "origin", join(root, "nonexistent-remote.git")]);
    const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root, store: gitRemoteBundleStore(root, "origin"), boundarySeq: 0 });
    assert.equal(pub.reason, "store_unavailable");
    const { events } = assertLogsConform(runDir);
    assert.ok(events.some((e) => e.type === "bundle-store-unavailable"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("code writers: an in-process governed run's admission, claims, request, verdict and conclusion pass the composed declared-effect schema", () => {
  const { root, runDir } = freshRun("faff-payload-commissaire-");
  try {
    const com = (args, input) => cli(["commissaire", ...args, "--run-dir", runDir], { input: input === undefined ? "" : JSON.stringify(input) });
    assert.equal(com(["admit", "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(com(["declare", "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], [{ kind: "merge", target: "main" }]).code, 0);
    const rd = com(["request-decision", "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge", "--level", "L3"], { effect: { kind: "merge", target: "main" }, attended: false });
    assert.equal(rd.code, 0, rd.err);
    assert.equal(com(["observe", "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], [{ kind: "merge", target: "main" }]).code, 0);
    const concluded = com(["verdict", "conclude", "--unit-id", "FAFF-1"]);
    assert.equal(concluded.code, 0, concluded.err);
    const { effects } = assertLogsConform(runDir);
    assert.deepEqual(effects.map((e) => e.kind_of_entry), ["admission", "declare", "effect-decision-request", "effect-decision-verdict", "observe", CONCLUSION_KIND]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- agreement with the Commissaire facade v0.3 -------------------------------------------

// The facade v0.3 admission schema omits payload.custody, which governor.ts writes on every
// governor-custody admission. The published facade directory is immutable, so the disagreement is
// named here until a later facade version describes it; this list must stay exact.
const KNOWN_FACADE_GAPS = new Set(["admission: payload.custody"]);
const FACADE_RECORD_SCHEMA = {
  admission: "admission", declare: "effect-claim", observe: "effect-claim",
  "effect-decision-request": "effect-decision-request", "effect-decision-verdict": "effect-decision-verdict",
  [CONCLUSION_KIND]: "conformed-to-contract",
};
const typeSet = (node) => (node && node.type !== undefined ? [].concat(node.type).filter((t) => t !== "null").sort().join("|") : null);
const UNIT_KEYS = new Set(["unit_id", "issue"]);

function propertyGaps(kind, facadeProps, evidenceProps, at) {
  const gaps = [];
  for (const key of new Set([...Object.keys(facadeProps), ...Object.keys(evidenceProps)])) {
    if (at === "" && UNIT_KEYS.has(key)) continue;
    const where = `${kind}: ${at}${key}`;
    const f = facadeProps[key];
    const e = evidenceProps[key];
    if (!f || !e) { gaps.push(where); continue; }
    const openEffect = key === "effect" && at === "payload.";
    if (openEffect) continue;
    const ft = typeSet(f);
    const et = typeSet(e);
    if (ft !== null && et !== null && ft !== et) gaps.push(`${where} (${ft} vs ${et})`);
  }
  return gaps;
}

test("facade agreement: every facade v0.3 record kind has an evidence mapping with the same author and the same properties and types", () => {
  const evidenceKinds = declaredEffect().discriminator.mapping["3"].discriminator.mapping;
  const facadeKinds = readJson(join(FACADE, "facade-envelope.schema.json")).properties.kind_of_entry.enum;
  const gaps = [];
  for (const kind of facadeKinds) {
    const evidence = evidenceKinds[kind];
    assert.ok(evidence, `${kind} has an evidence mapping`);
    const facadeFile = FACADE_RECORD_SCHEMA[kind];
    if (!facadeFile) {
      assert.deepEqual(evidence.properties.author.enum, [KIND_AUTHOR[kind]], kind);
      continue;
    }
    const facade = readJson(join(FACADE, `${facadeFile}.schema.json`));
    assert.deepEqual(evidence.properties.author.enum, facade.properties.author.enum, `${kind} author`);
    gaps.push(...propertyGaps(kind, facade.properties, evidence.properties, ""));
    if (facade.properties.payload) gaps.push(...propertyGaps(kind, facade.properties.payload.properties, evidence.properties.payload.properties, "payload."));
    if (facade.properties.effect) {
      for (const [effectKind, mapped] of Object.entries(evidence.properties.effect.discriminator.mapping)) {
        gaps.push(...propertyGaps(`${kind}/${effectKind}`, facade.properties.effect.properties, mapped.properties, "effect."));
      }
    }
  }
  assert.deepEqual(gaps.sort(), [...KNOWN_FACADE_GAPS].sort());
});

test("facade agreement: every facade v0.3 example record and source-run line passes the composed declared-effect schema", () => {
  const examples = join(FACADE, "examples");
  const records = readdirSync(examples).filter((f) => f.endsWith(".example.json")).map((f) => ({ f, rec: readJson(join(examples, f)) })).filter(({ rec }) => rec && rec.schema === 3 && rec.kind_of_entry);
  assert.ok(records.length >= 5);
  const source = lines(join(examples, "source-run.declared-effects.jsonl")).map((rec, i) => ({ f: `source-run line ${i + 1}`, rec }));
  assert.ok(source.length > 0);
  for (const { f, rec } of [...records, ...source]) assert.deepEqual(validateAgainstSchema(rec, declaredEffect()), [], f);
});
