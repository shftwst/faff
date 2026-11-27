import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/run-cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = join(HERE, "..", "plugin", "skills", "faff-graft", "SKILL.md");

function inReviewBlock(md) {
  const start = md.indexOf("**In Review transition");
  const end = md.indexOf("### Discovered scope");
  assert.ok(start !== -1, "In Review transition heading not found");
  assert.ok(end > start, "Discovered scope heading not found after In Review transition");
  return md.slice(start, end);
}

test("the skill calls the planner after the live read and leaves the MCP write between both effect records", () => {
  const block = inReviewBlock(readFileSync(SKILL_MD, "utf8"));
  assert.match(block, /Re-read the live status.*through tracker MCP/);
  assert.match(block, /Governed tracker-write record/);
  const order = ["Re-read the live status", "faff pr plan-in-review", "faff effects declare", "save_issue", "faff effects observe"];
  let previous = -1;
  for (const operation of order) {
    const at = block.indexOf(operation);
    assert.ok(at > previous, operation);
    previous = at;
  }
  assert.match(block, /including after a declaration failure/);
  assert.match(block, /confirmed MCP success/);
});

test("a fresh In Progress issue produces the same governed declaration and observation around the MCP write", t => {
  const { root, run, plan, facts } = fixture(t);
  const args = ["--run-dir", root, "--issue", "TEST-28", "--step", "tracker-write"];
  const payload = [facts.tracker_transition.effect];
  const result = plan(facts, root);
  assert.deepEqual(result, { action: "write", state: "review-state-id", bracket: { args, payload } });
  const file = join(root, "declared-effects.jsonl");
  assert.equal(existsSync(file), false, "planning writes nothing");

  assert.equal(run(["effects", "declare", ...result.bracket.args], JSON.stringify(result.bracket.payload)).code, 0);
  const saved = () => readFileSync(file, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(saved().map(entry => entry.kind_of_entry), ["declare"], "no observation before simulated MCP success");
  assert.equal(run(["effects", "observe", ...result.bracket.args], JSON.stringify(result.bracket.payload)).code, 0);
  assert.deepEqual(saved().map(({kind_of_entry, issue, step, effect}) => ({kind_of_entry, issue, step, effect})), [
    {kind_of_entry: "declare", issue: "TEST-28", step: "tracker-write", effect: payload[0]},
    {kind_of_entry: "observe", issue: "TEST-28", step: "tracker-write", effect: payload[0]},
  ]);
  const check = run(["effects", "check", "--run-dir", root, "--json"]);
  assert.equal(JSON.parse(check.stdout).any_escape, false);
});

test("the In Review plan abstains on sparse or changed tracker evidence and keeps ungoverned writes unbracketed", t => {
  const { root, plan, facts } = fixture(t);
  for (const live_status of [null, "Todo", "Backlog", "In Review", "Done", "Cancelled", "Blocked"]) {
    assert.deepEqual(plan({ ...facts, live_status }, root), { action: "noop" });
  }
  assert.deepEqual(plan({ ...facts, review_state: null }, root), { action: "noop" });
  assert.deepEqual(plan(facts), { action: "write", state: "review-state-id", bracket: null });
  assert.deepEqual(plan({ ...facts, review_state: { id: facts.review_state, name: "In Review" } }, root), plan(facts, root));
  for (const review_state of [{ name: "In Review" }, { id: null }, { id: " " }]) {
    assert.deepEqual(plan({ ...facts, review_state }, root), { action: "noop" });
  }
  const tracker_transition = { ...facts.tracker_transition, governed: false };
  assert.deepEqual(plan({ ...facts, tracker_transition }, root), { action: "write", state: "review-state-id", bracket: null });
});

test("the In Review plan refuses a descriptor from another issue or a malformed PR-open receipt", t => {
  const { root, run, facts } = fixture(t);
  const argv = ["pr", "plan-in-review", "--issue", "TEST-28", "--run-dir", root];
  const tracker_transition = { ...facts.tracker_transition, effect: { ...facts.tracker_transition.effect,
    target: "OTHER-9:In Progress->In Review" } };
  for (const body of [{...facts, tracker_transition}, { ...facts, tracker_transition: {} }, null]) {
    const result = run(argv, JSON.stringify(body));
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout, "");
  }
  assert.equal(existsSync(join(root, "declared-effects.jsonl")), false);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-review-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const facts = { live_status: "In Progress", review_state: "review-state-id", tracker_transition: {
    to: "In Review", governed: true,
    effect: { kind: "tracker-write", target: "TEST-28:In Progress->In Review", reversible: true },
  } };
  const run = (argv, input) => runCli(argv, { cwd: root, input });
  const plan = (input, runDir) => {
    const args = ["pr", "plan-in-review", "--issue", "TEST-28"];
    if (runDir) args.push("--run-dir", runDir);
    const result = run(args, JSON.stringify(input));
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { root, run, plan, facts };
}
