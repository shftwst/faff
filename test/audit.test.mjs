// FAFF-289 — the `faff audit <run-id>` subcommand: a read-only run-reconstruction
// forensics view that joins events.jsonl + run-ledger.json + provenance/<ISSUE>.json
// into one who/what/why reconstruction of a completed run. Pure, deterministic,
// degrade-don't-crash; coherence is reported, never gated (a readable run exits 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "audit", ...args], { cwd, encoding: "utf8" });

// A temp repo root with a run dir under .faff/runs/<run-id>/, optional events/ledger,
// and optional provenance markers under .faff/provenance/.
function tmpRun({ runId = "r1", events = null, ledger = null, provenance = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-audit-it-"));
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  if (events != null) {
    writeFileSync(join(runDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  if (ledger != null) writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  if (Object.keys(provenance).length) {
    const pdir = join(root, ".faff", "provenance");
    mkdirSync(pdir, { recursive: true });
    for (const [issue, body] of Object.entries(provenance)) writeFileSync(join(pdir, `${issue}.json`), JSON.stringify(body));
  }
  return { root, runId };
}

const ev = (seq, ts, phase, type, issue, data) => {
  const r = { schema: 1, run_id: "r1", seq, ts, phase, type };
  if (issue !== undefined) r.issue = issue;
  if (data !== undefined) r.data = data;
  return r;
};

test("--selftest passes", () => {
  const r = spawnSync(process.execPath, [BIN, "audit", "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESULT: audit --selftest ok/);
});

test("smoke: clean completed run → full reconstruction, coherence clean, exit 0", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "2026-06-29T03:00:00Z", "run", "run-start"),
      ev(1, "2026-06-29T03:01:00Z", "build", "issue-admitted", "FAFF-1"),
      ev(2, "2026-06-29T03:02:00Z", "build", "issue-outcome", "FAFF-1", { outcome: "shipped" }),
      ev(3, "2026-06-29T03:05:00Z", "run", "run-end"),
    ],
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, discovered_scope_filed: 0,
      budget: { envelope: { ceilings: {} }, tokens_at_start: 100 } },
    provenance: { "FAFF-1": { schema: 2, issue: "FAFF-1", intake: { via: "jot", ts: "t" }, initiated: "autonomous" } },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.lifecycle.complete, true);
  assert.equal(o.lifecycle.duration_secs, 300);
  assert.ok(o.lifecycle.duration_secs > 0);
  assert.equal(o.issues[0].issue, "FAFF-1");
  assert.equal(o.issues[0].provenance.via, "jot");
  assert.equal(o.issues[0].provenance.initiated, "autonomous");
  assert.equal(o.issues[0].outcome, "shipped");
  assert.equal(o.coherence.clean, true);
  assert.equal(o.discovered_scope_filed, 0);
});

test("undispatched: admitted issue with no outcome → coherence.undispatched, clean false, exit 0", () => {
  const { root, runId } = tmpRun({
    ledger: { run_id: "r1", admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped" } },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.coherence.undispatched, ["FAFF-2"]);
  assert.equal(o.coherence.clean, false);
});

test("missing ledger: events present, no run-ledger.json → reconstruct, list ledger missing, exit 0", () => {
  const { root, runId } = tmpRun({
    events: [ev(0, "t", "build", "build-start", "FAFF-9")],
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.coherence.missing_substrates, ["ledger"]);
  assert.equal(o.issues[0].issue, "FAFF-9");
});

test("missing run dir: no directory under .faff/runs/ → stderr + exit 3", () => {
  const { root } = tmpRun({});
  const r = run(["nope", "--root", root]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no run dir for nope/);
});

test("both core files missing: empty run dir → exit 3", () => {
  const { root, runId } = tmpRun({}); // run dir created, no events/ledger
  const r = run([runId, "--root", root]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no events or ledger/);
});

test("events↔ledger mismatch: last issue-outcome event disagrees with ledger", () => {
  const { root, runId } = tmpRun({
    events: [ev(0, "t", "build", "issue-outcome", "FAFF-1", { outcome: "shipped" })],
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "parked" } },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.mismatches.length, 1);
  assert.deepEqual(o.coherence.mismatches[0], { issue: "FAFF-1", ledger_outcome: "parked", event_outcome: "shipped" });
});

test("--issue filter: narrows issues, keeps run summary", () => {
  const { root, runId } = tmpRun({
    ledger: { run_id: "r1", admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped", "FAFF-2": "parked" } },
  });
  const r = run([runId, "--issue", "FAFF-2", "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.issues.length, 1);
  assert.equal(o.issues[0].issue, "FAFF-2");
  assert.equal(o.filtered_to, "FAFF-2");
  assert.ok(o.coherence); // run-level summary still present
});

test("--issue not in run → exit 3", () => {
  const { root, runId } = tmpRun({
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } },
  });
  const r = run([runId, "--issue", "FAFF-99", "--root", root]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no admitted or evented issue FAFF-99/);
});

test("no run-id → exit 2", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /<run-id> required/);
});

test("absent provenance → {absent:true}, not an error", () => {
  const { root, runId } = tmpRun({
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.issues[0].provenance.absent, true);
});

test("FAFF-352: no sentry-checkpoint events → supervision.checkpoints empty, last_intervention null, text renders '0 checkpoint(s)' / '—'", () => {
  const { root, runId } = tmpRun({
    events: [ev(0, "2026-06-29T03:00:00Z", "run", "run-start"), ev(1, "2026-06-29T03:05:00Z", "run", "run-end")],
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } },
  });
  const rj = run([runId, "--json", "--root", root]);
  assert.equal(rj.status, 0, rj.stderr);
  const o = JSON.parse(rj.stdout);
  assert.deepEqual(o.supervision.checkpoints, []);
  assert.equal(o.supervision.last_intervention, null);

  const rt = run([runId, "--root", root]);
  assert.equal(rt.status, 0, rt.stderr);
  assert.match(rt.stdout, /supervision: 0 checkpoint\(s\)\s+·\s+last intervention: —/);
});

test("FAFF-352: N sentry-checkpoint events → supervision.checkpoints in seq order, last_intervention is the LAST one's", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t0", "run", "sentry-checkpoint", undefined, { run_dir: "/r", verdicts: [], intervention: "continue", tripped: false, thresholds: {} }),
      ev(1, "t1", "build", "issue-outcome", "FAFF-1", { outcome: "shipped" }),
      ev(2, "t2", "run", "sentry-checkpoint", undefined, { run_dir: "/r", verdicts: [{ signal: "budget-breach", severity: "trip", evidence: {} }], intervention: "abort", tripped: true, thresholds: {} }),
    ],
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } },
  });
  const rj = run([runId, "--json", "--root", root]);
  assert.equal(rj.status, 0, rj.stderr);
  const o = JSON.parse(rj.stdout);
  assert.equal(o.supervision.checkpoints.length, 2);
  assert.deepEqual(o.supervision.checkpoints.map((c) => c.seq), [0, 2]);
  assert.equal(o.supervision.last_intervention, "abort");
  // sentry-checkpoint is run-scoped — it never appears under any issue's own events list.
  assert.deepEqual(o.issues[0].events.map((e) => e.type), ["issue-outcome"]);

  const rt = run([runId, "--root", root]);
  assert.equal(rt.status, 0, rt.stderr);
  assert.match(rt.stdout, /supervision: 2 checkpoint\(s\)\s+·\s+last intervention: abort/);
});

test("default text output is skimmable (lists, not run-on prose)", () => {
  const { root, runId } = tmpRun({
    events: [ev(0, "2026-06-29T03:00:00Z", "run", "run-start"), ev(1, "2026-06-29T03:05:00Z", "run", "run-end")],
    ledger: { run_id: "r1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } },
  });
  const r = run([runId, "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^run r1/m);
  assert.match(r.stdout, /coherence:/);
  assert.match(r.stdout, /issues \(1\):/);
});

// ===========================================================================
// FAFF-354 — recompute-and-compare over recorded `containment-check` events
// (from `faff contain --record`), plus the `unrecorded_creates` finding. Both
// are DETECTIVE, never preventive — see the trust-boundary note on `contain`.
// ===========================================================================

test("FAFF-354: a clean recorded containment-check (recompute agrees) keeps coherence clean", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t", "run", "containment-check", "FAFF-1", {
        mandate: "FAFF-1", parent: "FAFF-2", root: false,
        ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "contained", exit: 0,
      }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {}, discovered_scope_filed: 0 },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.coherence.containment_mismatches, []);
  assert.equal(o.coherence.unrecorded_creates, false);
  assert.equal(o.coherence.clean, true);
});

test("FAFF-354: a tampered recorded verdict (disagrees with recompute) → containment_mismatches, clean false", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(3, "t", "run", "containment-check", "FAFF-1", {
        mandate: "FAFF-1", parent: "FAFF-2", root: false,
        ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "outward", exit: 3,
      }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {} },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.containment_mismatches.length, 1);
  assert.deepEqual(o.coherence.containment_mismatches[0], { seq: 3, issue: "FAFF-1", recorded: "outward", recomputed: "contained" });
  assert.equal(o.coherence.clean, false);

  const rt = run([runId, "--root", root]);
  assert.match(rt.stdout, /containment mismatches: seq 3 \(recorded outward vs recomputed contained\)/);
});

test("FAFF-354: an unparseable recorded ancestry_raw recomputes 'unreproducible'", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t", "run", "containment-check", "FAFF-1", {
        mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: "not json", verdict: "contained", exit: 0,
      }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {} },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.containment_mismatches.length, 1);
  assert.equal(o.coherence.containment_mismatches[0].recomputed, "unreproducible");
  assert.equal(o.coherence.clean, false);
});

test("FAFF-354: discovered_scope_filed > 0 with zero containment-check events → unrecorded_creates true, clean false", () => {
  const { root, runId } = tmpRun({
    ledger: { run_id: "r1", admitted: [], outcomes: {}, discovered_scope_filed: 2 },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.unrecorded_creates, true);
  assert.equal(o.coherence.clean, false);

  const rt = run([runId, "--root", root]);
  assert.match(rt.stdout, /unrecorded creates: ledger filed 2 discovered-scope ticket\(s\), no containment-check events/);
});

test("FAFF-354: discovered_scope_filed > 0 WITH containment-check events present → unrecorded_creates false", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t", "run", "containment-check", "FAFF-9", {
        mandate: "FAFF-9", parent: "FAFF-9", root: false, ancestry_raw: null, verdict: "contained", exit: 0,
      }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {}, discovered_scope_filed: 1 },
  });
  const r = run([runId, "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.unrecorded_creates, false);
});

// ===========================================================================
// FAFF-700 — dispatch_observability end-to-end: real child-transcript substrate
// (a CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/ directory the actual `cmdAudit`
// wrapper reads), not just the pure core (covered by --selftest above). Proves
// the wiring — transcriptBaseDir/childOwningSession/meta.json read — actually
// lands in coherence.dispatch_observability, end to end through the CLI.
// ===========================================================================

function encodedProjectDir(cwd) { return String(cwd).replace(/[/.]/g, "-"); }

// Writes a child agent-*.jsonl (one record carrying sessionId) + sibling
// agent-*.meta.json (carrying `description`) into the transcript base dir the
// real transcriptBaseDir(cwd, env) resolver would compute for `cwd`.
function writeChildTranscript(configDir, cwd, name, sid, description) {
  const base = join(configDir, "projects", encodedProjectDir(cwd));
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, `${name}.jsonl`), JSON.stringify({ sessionId: sid }) + "\n");
  writeFileSync(join(base, `${name}.meta.json`), JSON.stringify({ description }));
  return base;
}

test("FAFF-700: no agent-dispatch events → dispatch_observability status absent, text renders 'dispatch: absent'", () => {
  const { root, runId } = tmpRun({
    events: [ev(0, "t", "run", "run-start")],
    ledger: { run_id: "r1", admitted: [], outcomes: {} },
  });
  const rj = run([runId, "--json", "--root", root]);
  assert.equal(rj.status, 0, rj.stderr);
  const o = JSON.parse(rj.stdout);
  assert.equal(o.coherence.dispatch_observability.status, "absent");
  assert.equal(o.coherence.clean, true);

  const rt = run([runId, "--root", root]);
  assert.match(rt.stdout, /dispatch: absent/);
});

test("FAFF-700: reader cluster of 2, both children stamped and owned by this session → verified", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t", "run", "agent-dispatch", undefined, { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 2 }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {} },
  });
  const configDir = mkdtempSync(join(tmpdir(), "faff-audit-cfg-"));
  const sid = "sess-abc";
  writeChildTranscript(configDir, root, "agent-1", sid, "Read the source, subagent-cluster:R1");
  writeChildTranscript(configDir, root, "agent-2", sid, "Read the tests, subagent-cluster:R1");
  const r = spawnSync(process.execPath, [BIN, "audit", runId, "--json", "--root", root], {
    encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_SESSION_ID: sid },
  });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.dispatch_observability.status, "verified");
  assert.equal(o.coherence.dispatch_observability.substrate_reachable, true);
  assert.equal(o.coherence.dispatch_observability.clusters[0].observed, 2);
});

test("FAFF-700: a child owned by a DIFFERENT session is excluded (undercount, never overcount)", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t", "run", "agent-dispatch", undefined, { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 2 }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {} },
  });
  const configDir = mkdtempSync(join(tmpdir(), "faff-audit-cfg-"));
  const sid = "sess-mine";
  writeChildTranscript(configDir, root, "agent-1", sid, "subagent-cluster:R1");
  writeChildTranscript(configDir, root, "agent-2", "sess-someone-else", "subagent-cluster:R1"); // foreign session
  const r = spawnSync(process.execPath, [BIN, "audit", runId, "--json", "--root", root], {
    encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_SESSION_ID: sid },
  });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.dispatch_observability.clusters[0].observed, 1);
  assert.equal(o.coherence.dispatch_observability.clusters[0].status, "mismatch");
});

test("FAFF-700: no CLAUDE_CODE_SESSION_ID → substrate unreachable, unverifiable-substrate", () => {
  const { root, runId } = tmpRun({
    events: [
      ev(0, "t", "run", "agent-dispatch", undefined, { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 1 }),
    ],
    ledger: { run_id: "r1", admitted: [], outcomes: {} },
  });
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync(process.execPath, [BIN, "audit", runId, "--json", "--root", root], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.coherence.dispatch_observability.status, "unverifiable-substrate");
  assert.equal(o.coherence.dispatch_observability.substrate_reachable, false);
});
