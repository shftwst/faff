import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "./helpers/run-cli.mjs";

const precondition = "not-ready:precondition:merge-method — squash merge is disabled; remedy: enable squash merging";
const ship = { outcome: "shipped", reason: "", corroborated: true };
const gateReceipt = (fields) => ({
  verdict: "merge-ok", merged: true, blockers: [], head_sha: "abc123", ...fields,
});

function render(exit, receipt, args = []) {
  const input = typeof receipt === "string" ? receipt : JSON.stringify(receipt);
  return runCli(["merge-gate", "delivery-receipt", "--merge-exit", String(exit), ...args], { input });
}

function delivery(result) {
  assert.equal(result.code, 0, result.stderr);
  const marker = /^\x60{3}faff-contract:delivery-outcome\n([^\n]+)\n\x60{3}\n?$/m;
  const match = marker.exec(result.stdout);
  assert.ok(match);
  assert.equal(result.stdout.match(/faff-contract:delivery-outcome/g).length, 1);
  assert.match(result.stdout.slice(match.index), /^\x60{3}faff-contract:delivery-outcome\n[^\n]+\n\x60{3}\n?$/);
  const parsed = JSON.parse(match[1]);
  const validated = runCli(["contract", "delivery-outcome"], { input: JSON.stringify(parsed) });
  assert.equal(validated.code, 0, validated.stderr + validated.stdout);
  return parsed;
}

test("only an observed successful merge ships, including a confirmed merge with cleanup incomplete", () => {
  const complete = gateReceipt();
  assert.deepEqual(delivery(render(0, complete)), ship);
  const partial = gateReceipt({ warnings: ["branch deletion failed"], post_merge_state: "MERGED" });
  const result = render(0, partial);
  assert.deepEqual(delivery(result), ship);
  assert.equal(JSON.parse(result.stdout.split("\n")[1]).warnings[0], "branch deletion failed");

  const preview = delivery(render(0, gateReceipt({ merged: false })));
  assert.equal(preview.outcome, "failed");
  assert.equal(preview.corroborated, false);
  const refusal = delivery(render(1, gateReceipt({ verdict: "refuse", merged: true, blockers: ["custody not satisfied"] })));
  assert.deepEqual(refusal, { outcome: "failed", reason: "custody not satisfied", corroborated: false });
  assert.equal(delivery(render(2, complete)).outcome, "failed");
});

test("a retained precondition deferral requires the gate's observed OPEN rejection", () => {
  const blocked = gateReceipt({ verdict: "refuse", merged: false, blockers: ["gh pr merge rejected: squash disabled"] });
  const args = ["--precondition", precondition];
  assert.deepEqual(delivery(render(1, { ...blocked, post_merge_state: "OPEN" }, args)), {
    outcome: "not-ready", reason: precondition, corroborated: false,
  });
  for (const state of [undefined, null, "MERGED", "CLOSED", "UNKNOWN"]) {
    const result = render(1, { ...blocked, post_merge_state: state }, args);
    assert.deepEqual(delivery(result), { outcome: "failed", reason: blocked.blockers[0], corroborated: false });
    assert.equal(JSON.parse(result.stdout.split("\n")[1]).post_merge_state, state);
  }
  const floor = render(1, { ...blocked, post_merge_state: "OPEN", blockers: ["CI is red"] }, args);
  assert.equal(delivery(floor).outcome, "failed");
});

test("missing, malformed and mismatched receipts fail without inventing merge state", () => {
  for (const bad of ["", "garbage", "{", "[]", "{}", "null", '{"verdict":"merge-ok","merged":true}']) {
    const result = render(0, bad);
    assert.deepEqual(delivery(result), { outcome: "failed", reason: "merge receipt unavailable", corroborated: false });
    assert.match(result.stdout, /^merge-gate exit: 0\n/);
  }
  assert.equal(delivery(render(124, "")).outcome, "failed");
  assert.equal(render(0, gateReceipt(), ["--execute"]).code, 2);
  assert.equal(render(0, gateReceipt(), ["--precondition", "something unrelated"]).code, 2);
});
