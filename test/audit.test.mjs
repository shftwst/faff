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
