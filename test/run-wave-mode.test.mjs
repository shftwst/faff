import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function setup(t, level, enabled) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-wave-mode-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const run = path.join(dir, ".faff", "runs", "run-test");
  mkdirSync(run, {recursive: true});
  const ledger = path.join(run, "run-ledger.json");
  writeFileSync(ledger, JSON.stringify({schema_version: "0.3", run_id: "run-test", level, no_progress_waves: 3}));
  if (enabled !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), "convergence:\n  enabled: " + enabled + "\n");
  const call = (flags = [], opts = {}) => runCli(["run", "wave-mode", "--run-dir", run, "--root", dir, ...flags], opts);
  return {run, ledger, call};
}

test("wave mode preserves CLI precedence and the git-only termination floor", t => {
  for (const [level, configured, flags, fold, consult] of [
    ["L3", undefined, [], true, true], ["L3", false, [], false, false],
    ["L3", false, ["--converge"], true, true], ["L3", true, ["--no-converge"], false, false],
    ["L3", false, ["--git-only"], false, true], ["L2", true, ["--git-only", "--no-converge"], false, true],
    ["L1", true, ["--git-only"], true, true], ["L4", false, ["--no-converge"], true, true],
    ["L4", false, ["--git-only", "--no-converge"], true, true],
  ]) {
    const { run, ledger, call } = setup(t, level, configured);
    const before = readFileSync(ledger);
    const result = call(flags);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {fold, consult});
    assert.deepEqual(readFileSync(ledger), before);
    assert.deepEqual(readdirSync(run).sort(), ["run-ledger.json", "wave-mode.json"]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(run, "wave-mode.json"))), {run_id: "run-test", fold, consult});
    if (consult) {
      const gate = runCli(["run-done", "--json", "--queue-empty", "--ledger-clean", "--prd-coverage", '{"satisfied":false}']);
      assert.equal(gate.code, 0, gate.stderr);
      assert.equal(JSON.parse(gate.stdout).verdict, "escalate");
    }
  }
});

test("explicit run wins over ambient context; errors cannot downgrade a run", t => {
  const l3 = setup(t, "L3", false);
  const l4 = setup(t, "L4", false);
  const result = l3.call([], {env: {...process.env, FAFF_RUN_DIR: l4.run}});
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {fold:false, consult:false});
  assert.equal(l4.call(["--converge","--no-converge"]).code, 2);
  writeFileSync(l4.ledger, "not JSON");
  const malformed = l4.call();
  assert.equal(malformed.code, 2);
  assert.equal(malformed.stdout, "");
  rmSync(l4.ledger);
  assert.equal(l4.call().code, 2);
  assert.equal(setup(t,"unknown",true).call().code, 2);
});
