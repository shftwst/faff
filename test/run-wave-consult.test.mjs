import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const key = "gk-20261120-abc123";
const tracker = ["--queue", '{"queue_empty":true,"all_parked":false}'];
const clear = { breached: [], outcome: "none" };
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-wave-consult-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, ".faff", "runs", "run-test");
  mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, "run-ledger.json");
  writeFileSync(ledger, JSON.stringify({ level: "L3", no_progress_waves: 4, outcomes: { [key]: "parked" } }));
  const call = (args, budget = clear) => runCli(["run", "wave-consult", "--root", root, "--run-dir", dir,
    "--wave", "4", "--budget", JSON.stringify(budget), ...args], {cwd:root});
  const result = (args, budget) => {
    const r = call(args, budget);
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return {root, dir, ledger, call, result};
}
test("tracker facts preserve the floor and the methodology ladder, without writing the stall counter", t => {
  const {ledger, result} = setup(t);
  const start = readFileSync(ledger);
  assert.equal(result([...tracker, "--no-prd"]).reason, "drained");
  const policy = ["--policy", '{"ladder":[{"test":"clean-complete","verdict":"continue"}]}'];
  assert.equal(result([...tracker, "--no-prd", ...policy]).verdict, "continue");
  assert.equal(result([...tracker, "--coverage", '{"satisfied":false}', ...policy]).reason, "product-incomplete");
  assert.equal(result([...tracker, "--coverage", '{"satisfied":false}'], {outcome:"escalate",breached:["tokens"]}).reason, "budget-escalated(tokens)");
  assert.equal(result([...tracker, "--no-prd", "--non-convergence"]).reason, "non-convergence");
  assert.deepEqual(readFileSync(ledger), start);
  writeFileSync(ledger, '{"admitted":["pending"]}');
  assert.equal(result([...tracker, "--no-prd"]).reason, "undispatched-ledger");
});
test("git-only inputs use the run outcomes and checklist and distinguish missing coverage from out-of-scope", t => {
  const {root, ledger, result} = setup(t);
  const specs = path.join(root, ".faff", "specs");
  mkdirSync(specs);
  writeFileSync(path.join(specs, key + ".md"), "spec");
  const check = ["--git-only", "--prd", "check list.md"];
  assert.deepEqual(result(check).warnings, ["coverage-unavailable"]);
  const file = path.join(root, "check list.md");
  writeFileSync(file, "- [ ] incomplete\n");
  assert.equal(result(check).reason, "product-incomplete");
  writeFileSync(file, "- [x] done\n");
  assert.equal(result(check).reason, "all-parked");
  assert.deepEqual(result(["--git-only", "--no-prd"]).warnings, []);
  writeFileSync(ledger, "{");
  const bad = result(["--git-only", "--no-prd"]);
  assert.equal(bad.reason, "work-remaining");
  assert.deepEqual(bad.warnings, ["queue-unavailable","ledger-unavailable"]);
});
test("a consult emits a compact receipt; only a later action actually taken joins the chosen wave", t => {
  const {root, dir, result} = setup(t);
  writeFileSync(path.join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n");
  const start = runCli(["events", "append", "--run", "run-test", "--root", root], {cwd:root, input:'{"phase":"run","type":"run-start"}'});
  assert.equal(start.code, 0, start.stderr);
  const decision = result(["--git-only", "--no-prd"]);
  assert.deepEqual(Object.keys(decision).sort(), ["correlation_id","reason","verdict","warnings"]);
  assert.equal(decision.correlation_id, "run-test/__run__/run-done/4");
  const events = () => readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events().slice(1).map(e => [e.type,e.data.kernel]), [["decision-capture","queue-state"],["decision-capture","run-done"]]);
  const r = runCli(["decision-capture","action","--run",dir,"--root",root,"--issue","__run__","--kernel","run-done",
    "--correlates",decision.correlation_id,"--action",decision.verdict], {cwd:root});
  assert.equal(r.code, 0, r.stderr);
  const action = events().at(-1);
  assert.equal(action.type, "decision-capture-action");
  assert.ok(JSON.stringify(action.data).includes(decision.correlation_id));
});
test("rejects mixed modes, fabricated queue facts, invalid checkpoint and ambiguous PRD inputs", t => {
  const {call, result} = setup(t);
  for (const bad of [[...tracker,"--git-only","--no-prd"],[...tracker,"--prd","x"],["--git-only","--coverage","{}"],
    [...tracker,"--no-prd","--coverage","{}"],["--queue",'{"queue_empty":true}',"--no-prd"],
    [...tracker,"--coverage",'{"satisfied":1}'], [...tracker, "--no-prd","--wave","0"]]) {
    const r = call(bad); assert.equal(r.code, 2, JSON.stringify(bad)); assert.equal(r.stdout, "");
  }
  assert.equal(call([...tracker, "--no-prd"], {outcome:"",breached:[]}).code, 2);
  assert.deepEqual(result([...tracker, "--no-prd"], null).warnings, ["budget-unavailable"]);
});

test("the admitted-work consult applies the configured backstop once per wave", t => {
  const {root, dir, ledger, result, call} = setup(t);
  mkdirSync(path.join(root, ".faff"), {recursive:true});
  writeFileSync(path.join(root, ".faff", "config.yaml"), "convergence:\n  max_waves: 3\n");
  const prior = {schema_version:1, run_id:"run-test", no_progress_waves:2, discovered_scope_filed:7};
  writeFileSync(ledger, JSON.stringify(prior));
  const dry = [...tracker, "--no-prd", "--admitted-work", "no"];
  const atCap = result(dry);
  assert.equal(atCap.reason, "non-convergence");
  assert.equal(atCap.progress.no_progress_waves, 3);
  assert.ok(atCap.progress.ledger_sha256_after);
  const saved = readFileSync(ledger);
  assert.equal(result(dry).progress.ledger_sha256_after, null);
  assert.equal(call([...tracker, "--no-prd", "--admitted-work", "yes"]).code, 2);
  assert.deepEqual(readFileSync(ledger), saved);
  const later = (wave, value) => runCli(["run","wave-consult","--root",root,"--run-dir",dir,"--wave",wave,
    "--budget",JSON.stringify(clear),...tracker,"--no-prd","--admitted-work",value], {cwd:root});
  assert.equal(later("3","no").code, 2);
  assert.equal(later("6","no").code, 2);
  const reset = later("5","yes");
  assert.equal(reset.code, 0, reset.stderr);
  assert.equal(JSON.parse(reset.stdout).reason, "drained");
  assert.deepEqual(JSON.parse(readFileSync(ledger)), {...prior, no_progress_waves:0, last_progress_wave:5});
  assert.equal(later("5","yes").code, 0);
  assert.equal(later("6","true").code, 2);
  assert.equal(call([...dry, "--non-convergence"]).code, 2);
});

test("missing configuration uses six dry waves; invalid configuration and closed runs refuse writes", t => {
  const {root, ledger, call, result} = setup(t);
  const base = {schema_version:1, run_id:"run-test", no_progress_waves:5};
  const dry = [...tracker, "--no-prd", "--admitted-work", "no"];
  writeFileSync(ledger, JSON.stringify(base));
  assert.equal(result(dry).reason, "non-convergence");
  writeFileSync(ledger, JSON.stringify({...base,stop_reason:"queue-drained"}));
  const closed = readFileSync(ledger);
  assert.equal(call(dry).code, 2);
  assert.deepEqual(readFileSync(ledger), closed);
  writeFileSync(ledger, JSON.stringify(base));
  writeFileSync(path.join(root, ".faff", "config.yaml"), "convergence:\n  max_waves: 0\n");
  assert.equal(call(dry).code, 2);
  assert.deepEqual(JSON.parse(readFileSync(ledger)), base);
});
