import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const base = {
  confidence: "concrete", mandate: "ISS-1", parent: "ISS-2", ancestry: [{ id: "ISS-2", parentId: "ISS-1" }],
  appetite: "high", opinionated: false, relationship: "blocked-by", relationship_target: "ISS-1",
};
function invoke(cwd, facts, ...args) {
  return spawnSync(process.execPath, [cli, "discovered-scope-plan", "--facts", "-", ...args], {
    cwd, input: JSON.stringify(facts), encoding: "utf8",
  });
}
function result(cwd, facts, ...args) {
  const reply = invoke(cwd, facts, ...args);
  assert.equal(reply.status, 0, reply.stderr);
  assert.equal(reply.stderr, "");
  return JSON.parse(reply.stdout);
}
function repo(t, config = "{}") {
  const root = mkdtempSync(join(tmpdir(), "faff-scope-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(join(root, ".faffrc.yaml"), config);
  return root;
}

test("plans a contained Backlog item, keeping placement and link target separate", t => {
  const root = repo(t);
  const plan = result(root, base);
  assert.deepEqual(plan, {
    action: "may-file", containment: "contained", reason: "appetite-allows",
    proposal: {
      mandate: "ISS-1", parent: "ISS-2", relationship: "blocked-by", relationship_target: "ISS-1",
      status: "Backlog", intake: { via: "jot", initiated: "autonomous" },
    },
  });
  for (const relationship of ["blocker", "peer", "parent"]) {
    assert.equal(result(root, { ...base, relationship }).proposal.relationship, relationship);
  }
});

test("keeps vague, restrained and genuinely-outward items surface-only", t => {
  const root = repo(t);
  assert.deepEqual(result(root, { confidence: "vague" }), { action: "surface", containment: null, reason: "vague" });
  for (const appetite of ["low", "medium"]) {
    assert.equal(result(root, { ...base, appetite }).reason, "appetite-withholds");
  }
  assert.equal(result(root, { ...base, appetite: "medium", opinionated: true }).action, "may-file");
  const outward = { ...base, parent: "OTHER-2", ancestry: [{ id: "OTHER-2", parentId: "OTHER-3" }, { id: "OTHER-3", parentId: "OTHER-2" }], appetite: "full" };
  const rejected = result(root, outward);
  assert.equal(rejected.containment, "outward-new-root");
  assert.equal(rejected.action, "surface");
  assert.equal(rejected.proposal, undefined);
  assert.equal(result(root, { ...base, prior_containment: "outward-new-root" }).action, "surface");
});

test("reuses the local contain and self-intake receipts without claiming a tracker write", t => {
  const root = repo(t, "tracking:\n  team_key: CORE\n  repo: example/product\ncontainment:\n  self_hosting_intake: true\n");
  const runDir = join(root, ".faff", "runs", "test-plan");
  const ledger = '{"run_id":"test-plan","admitted":[],"outcomes":{},"discovered_scope_filed":0}';
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), ledger);
  const facts = { ...base, parent: null, ancestry: [], target: { team: "CORE", repo: null } };
  const planned = result(root, facts, "--record", "test-plan", "--phase", "tidy");
  assert.equal(planned.containment, "outward-self-intake");
  assert.equal(planned.proposal.omit_automation_label, true);
  assert.equal(planned.proposal.destination, "self-intake");
  assert.equal(planned.proposal.parent, undefined);
  assert.equal(planned.proposal.issue_id, undefined);
  assert.equal(readFileSync(join(runDir, "run-ledger.json"), "utf8"), ledger);
  const events = readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events.map(e => e.type), ["containment-check", "self-intake-check"]);
  assert.deepEqual(events.map(e => e.phase), ["tidy", "tidy"]);
  assert.equal(events[0].data.ancestry_raw, "[]");
  assert.equal(JSON.parse(events[1].data.target_raw).team, "CORE");
  const validate = spawnSync(process.execPath, [cli, "events", "validate", "--file", join(runDir, "events.jsonl")], { cwd: root, encoding: "utf8" });
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(invoke(root, facts, "--record", "nonexistent").status, 2);
});

test("structural facts must be usable before a plan is emitted", t => {
  const root = repo(t);
  for (const facts of [
    { ...base, ancestry: "unparsed" }, { ...base, ancestry: [{ id: "ISS-2", type: "unknown" }] },
    { ...base, appetite: "whatever" }, { ...base, relationship_target: null },
    { ...base, mandate: "--selftest" }, { ...base, parent: "--selftest" },
  ]) {
    const reply = invoke(root, facts);
    assert.equal(reply.status, 2);
    assert.equal(reply.stdout, "");
  }
});


test("reads ancestry from a local facts file without changing that file", t => {
  const root = repo(t);
  const file = join(root, "scope facts.json");
  const input = JSON.stringify(base) + "\n";
  writeFileSync(file, input);
  const reply = spawnSync(process.execPath, [cli, "discovered-scope-plan", "--facts", file], { cwd: root, encoding: "utf8" });
  assert.equal(reply.status, 0, reply.stderr);
  assert.equal(JSON.parse(reply.stdout).action, "may-file");
  assert.equal(readFileSync(file, "utf8"), input);
});
