// FAFF-1435 — the economics and budget-check extractions. `faff economics --json` and `faff budget
// check --json` must print exactly what `economicsForRun()` and `budgetCheckForRun()` return, so
// `faff run summary` (which calls the functions in-process) can never disagree with the CLIs.
// Two fixture runs: one whose ledger carries a closed session span, one with no transcript at all.
// No selftest case exercised the moved composition code, so none moved here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildRun, cli } from "./fixtures/run-summary/build.mjs";

const require = createRequire(import.meta.url);
const { economicsForRun } = require("../plugin/skills/faff/bin/lib/economics.js");
const { budgetCheckForRun } = require("../plugin/skills/faff/bin/lib/budget.js");
const { unmeteredFleetEngines } = require("../plugin/skills/faff/bin/lib/backends.js");

const HOME = mkdtempSync(join(tmpdir(), "faff-econ-home-"));
const NOW_MS = 1767232800000;

// The same env the CLI child gets from cli(): HOME pinned, the run and session variables removed.
function sanitisedEnv() {
  const env = { ...process.env, HOME };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_SESSION_ID"]) delete env[k];
  return env;
}

function closedSpanRun() {
  const fx = buildRun({ admitted: ["A"], outcomes: { A: "shipped" } });
  const p = join(fx.runDir, "run-ledger.json");
  const l = JSON.parse(readFileSync(p, "utf8"));
  l.budget = {
    measure_session_id: "sess-2",
    sessions: [
      { session_id: "sess-1", closed_delta_by_model_class: { "claude-x": { input: 1000, output: 500, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 } }, close_source: "transcript" },
      { session_id: "sess-2", baseline_by_model_class: {} },
    ],
  };
  writeFileSync(p, JSON.stringify(l, null, 2));
  return fx;
}

for (const [name, make] of [["closed span", closedSpanRun], ["no transcript", () => buildRun({ admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" } })]]) {
  test(`economics: the CLI prints economicsForRun() (${name})`, () => {
    const fx = make();
    const r = cli(fx.root, ["economics", "--run-dir", fx.runDir, "--json", "--root", fx.root], { env: { HOME } });
    assert.equal(r.code, 0, r.err);
    const env = sanitisedEnv();
    assert.deepEqual(JSON.parse(r.out), economicsForRun(fx.runDir, { root: fx.root, env }));
  });

  test(`budget check: the CLI prints budgetCheckForRun() (${name})`, () => {
    const fx = make();
    const r = cli(fx.root, ["budget", "check", "--run-dir", fx.runDir, "--json", "--root", fx.root, "--now-ms", String(NOW_MS)], { env: { HOME } });
    assert.equal(r.code, 0, r.err);
    const env = sanitisedEnv();
    const state = budgetCheckForRun(fx.runDir, { root: fx.root, env, nowMs: NOW_MS, resolveUnmetered: unmeteredFleetEngines });
    assert.deepEqual(JSON.parse(r.out), state);
  });
}

test("budgetCheckForRun is read-only by default: it never writes the ledger", () => {
  const fx = buildRun({ admitted: ["A"], outcomes: { A: "shipped" } });
  const p = join(fx.runDir, "run-ledger.json");
  writeFileSync(join(fx.root, ".faffrc.yaml"), "budget:\n  window:\n    hours: 5\n    tokens: 100000000\n");
  const before = readFileSync(p, "utf8");
  budgetCheckForRun(fx.runDir, { root: fx.root, env: { HOME }, nowMs: NOW_MS });
  assert.equal(readFileSync(p, "utf8"), before);
});
