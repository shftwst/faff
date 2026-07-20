// FAFF-362 — governance profiles: terminal states, event types, and sentry
// thresholds become a declared vocabulary table (`DELIVERY_PROFILE`,
// governance-profile.js). CLI-level end-to-end coverage for the `faff profiles`
// subcommand plus the loud, no-silent-fallback override behaviour. The pure-core
// dialect-independence proof (SECOND_PROFILE driving auditLedger/eventViolations/
// evalThrash directly) lives in `faff profiles --selftest` (governance-profile.js);
// this file exercises the CLI surface, mirroring profile.test.mjs / regions.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// run the CLI in `cwd` with an optional env override merged over the current
// process env (mirrors sentry.test.mjs's `run` helper).
function run(cwd, args, env) {
  const opts = { cwd, encoding: "utf8" };
  if (env) opts.env = { ...process.env, ...env };
  try {
    const out = execFileSync("node", [CLI, ...args], opts);
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), "faff362-")); }

test("profiles --selftest passes (drives all three engines under DELIVERY_PROFILE + SECOND_PROFILE)", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["profiles", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- list --------------------------------------------------------------

test("profiles list: no override -> prints DELIVERY_PROFILE (today's exact vocabulary)", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profiles", "list", "--json"]);
    assert.equal(r.code, 0);
    const p = JSON.parse(r.out);
    assert.deepEqual(p.terminal_states, ["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget", "superseded"]);
    assert.deepEqual(p.ledger_outcomes, ["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget", "claimed-by-peer", "superseded"]);
    assert.deepEqual(p.outcome_required_types, ["issue-outcome"]);
    assert.equal(p.sentry.thresholds.thrash_n, 3);
    assert.equal(p.sentry.thresholds.stall_window_secs, 900);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- validate ------------------------------------------------------------

test("profiles validate: no override -> the active (delivery) profile is shape-valid, exit 0", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profiles", "validate"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /OK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("profiles validate --file: a well-formed second-dialect profile is shape-valid, exit 0", () => {
  const dir = tmp();
  const f = join(dir, "second.json");
  const second = {
    terminal_states: ["done", "open"],
    event_phases: ["job"],
    event_types: ["job-start", "job-end"],
    issue_scoped_types: ["job-start"],
    outcome_required_types: ["job-end"],
    ledger_outcomes: ["done", "open"],
    sentry: {
      thresholds: { thrash_n: 5, failure_k: 5, stall_window_secs: 600, run_elapsed_ceiling_secs: 7200, estimate_metering_exposure_secs: 300 },
      thrash: { start_type: "job-start", ship_type: "job-end", ship_outcome: "done" },
      failure: { park_type: "job-end", outcome_type: "job-end", errored_outcome: "open" },
    },
  };
  writeFileSync(f, JSON.stringify(second));
  try {
    const r = run(dir, ["profiles", "validate", "--file", f]);
    assert.equal(r.code, 0, r.err);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("profiles validate --file: an object-of-objects at a scalar leaf is rejected, naming the offending leaf, exit 1", () => {
  const dir = tmp();
  const f = join(dir, "bad.json");
  const bad = {
    terminal_states: ["a"], event_phases: ["p"], event_types: ["t"],
    issue_scoped_types: [], outcome_required_types: [], ledger_outcomes: ["a"],
    sentry: {
      thresholds: { thrash_n: { nested: "policy" }, failure_k: 1, stall_window_secs: 1, run_elapsed_ceiling_secs: 1, estimate_metering_exposure_secs: 1 },
      thrash: { start_type: "t", ship_type: "t", ship_outcome: "a" },
      failure: { park_type: "t", outcome_type: "t", errored_outcome: "a" },
    },
  };
  writeFileSync(f, JSON.stringify(bad));
  try {
    const r = run(dir, ["profiles", "validate", "--file", f]);
    assert.equal(r.code, 1);
    assert.match(r.err, /sentry\.thresholds\.thrash_n/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("profiles validate --file: an array-of-non-strings is rejected, exit 1", () => {
  const dir = tmp();
  const f = join(dir, "bad2.json");
  writeFileSync(f, JSON.stringify({ terminal_states: [{ not: "a string" }] }));
  try {
    const r = run(dir, ["profiles", "validate", "--file", f]);
    assert.equal(r.code, 1);
    assert.match(r.err, /terminal_states/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("profiles validate --file: malformed JSON -> exit 2", () => {
  const dir = tmp();
  const f = join(dir, "malformed.json");
  writeFileSync(f, "{not json");
  try {
    const r = run(dir, ["profiles", "validate", "--file", f]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("profiles validate --file: unreadable path -> exit 2", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profiles", "validate", "--file", join(dir, "does-not-exist.json")]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- $FAFF_GOVERNANCE_PROFILE override: no silent fallback ---------------

test("override: a well-formed second-dialect profile activates cleanly (list reflects it)", () => {
  const dir = tmp();
  const f = join(dir, "second.json");
  const second = {
    terminal_states: ["done", "open", "dropped"],
    event_phases: ["job"],
    event_types: ["job-start", "job-end"],
    issue_scoped_types: ["job-start"],
    outcome_required_types: ["job-end"],
    ledger_outcomes: ["done", "open", "dropped"],
    sentry: {
      thresholds: { thrash_n: 5, failure_k: 5, stall_window_secs: 600, run_elapsed_ceiling_secs: 7200, estimate_metering_exposure_secs: 300 },
      thrash: { start_type: "job-start", ship_type: "job-end", ship_outcome: "done" },
      failure: { park_type: "job-end", outcome_type: "job-end", errored_outcome: "open" },
    },
  };
  writeFileSync(f, JSON.stringify(second));
  try {
    const r = run(dir, ["profiles", "list", "--json"], { FAFF_GOVERNANCE_PROFILE: f });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out).terminal_states, ["done", "open", "dropped"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("override: a missing $FAFF_GOVERNANCE_PROFILE file -> loud exit 2, no silent fallback to delivery", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profiles", "list"], { FAFF_GOVERNANCE_PROFILE: join(dir, "does-not-exist.json") });
    assert.equal(r.code, 2);
    assert.match(r.err, /\$FAFF_GOVERNANCE_PROFILE override/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("override: a shape-invalid $FAFF_GOVERNANCE_PROFILE file -> loud exit 2, names the violations, no silent fallback", () => {
  const dir = tmp();
  const f = join(dir, "bad.json");
  writeFileSync(f, JSON.stringify({ some: "garbage" }));
  try {
    const r = run(dir, ["profiles", "list"], { FAFF_GOVERNANCE_PROFILE: f });
    assert.equal(r.code, 2);
    assert.match(r.err, /shape validation/);
    assert.match(r.err, /missing required key: terminal_states/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("override: applies uniformly to a DIFFERENT governance command (events validate), not just `profiles`", () => {
  const dir = tmp();
  const f = join(dir, "second.json");
  const second = {
    terminal_states: ["done"], event_phases: ["job"], event_types: ["job-start"],
    issue_scoped_types: ["job-start"], outcome_required_types: [], ledger_outcomes: ["done"],
    sentry: {
      thresholds: { thrash_n: 5, failure_k: 5, stall_window_secs: 600, run_elapsed_ceiling_secs: 7200, estimate_metering_exposure_secs: 300 },
      thrash: { start_type: "job-start", ship_type: "job-start", ship_outcome: "done" },
      failure: { park_type: "job-start", outcome_type: "job-start", errored_outcome: "done" },
    },
  };
  writeFileSync(f, JSON.stringify(second));
  try {
    // A delivery-vocabulary event (phase "run", type "run-start") is REJECTED under
    // the second dialect — proving `faff events validate` actually reads the override,
    // not just `faff profiles` (the same activeProfile() plumbing every engine shares).
    const line = JSON.stringify({ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" });
    const inFile = join(dir, "line.jsonl");
    writeFileSync(inFile, line + "\n");
    const r = run(dir, ["events", "validate", "--file", inFile], { FAFF_GOVERNANCE_PROFILE: f });
    assert.equal(r.code, 1);
    assert.match(r.err, /not in Phase/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("override: an unreadable $FAFF_GOVERNANCE_PROFILE file causes ANY governance command to exit non-zero loudly (never silent success)", () => {
  const dir = tmp();
  const inFile = join(dir, "line.jsonl");
  writeFileSync(inFile, JSON.stringify({ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }) + "\n");
  try {
    const r = run(dir, ["events", "validate", "--file", inFile], { FAFF_GOVERNANCE_PROFILE: join(dir, "does-not-exist.json") });
    assert.notEqual(r.code, 0);
    assert.match(r.err, /\$FAFF_GOVERNANCE_PROFILE override/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- regions wiring: `profiles` is registered like every other governance member ---

test("regions list --json includes `profiles` mapped to governance", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["regions", "list", "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).profiles, "governance");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
