import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runBuiltinLanding } from "../plugin/skills/faff/bin/lib/builtin-landing.js";
import { runCli } from "./helpers/run-cli.mjs";

const issue = "KIT-17";
const sha = "a".repeat(40);
const ok = (body) => ({ status: 0, stdout: JSON.stringify(body), stderr: "" });
const confirmed = { verdict: "merge-ok", merged: true, blockers: [], head_sha: sha, post_merge_state: "MERGED" };

function fixture(t, target = ["--pr", "17"]) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-builtin-landing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unit = path.join(dir, issue);
  mkdirSync(unit);
  return { args: ["--execute", "--issue", issue, "--run-dir", dir, "--level", "L3", ...target], unit };
}

function simulate(fix, overrides = {}) {
  const calls = [];
  function run(args, input) {
    const verb = args[0] === "merge" || args[1] === "delivery-receipt" ? args.slice(0, 2).join(" ") : args[0];
    calls.push({ verb, args });
    if (overrides[verb]) return overrides[verb];
    switch (verb) {
      case "merge authorize": return ok({ governed: true, written: true, effects: [] });
      case "merge-gate":
        writeFileSync(path.join(fix.unit, "merge-record.json"), JSON.stringify({
          pr: args.includes("--local") ? 0 : 17, merged: true, head_sha: sha,
          merged_at: "2026-01-01T00:00:00.000Z", integrity: "peer-asserted",
        }));
        return ok(confirmed);
      case "merge observe": return ok({ governed: true, written: true, effects: [] });
      case "merge-gate delivery-receipt": {
        const { code, stdout, stderr } = runCli(args, { input });
        return { status: code, stdout, stderr };
      }
      default: assert.fail("Unexpected landing subprocess " + args.join(" "));
    }
  }
  const result = runBuiltinLanding(fix.args, run, () => false);
  return { calls, result };
}

function value(args, flag) {
  const i = args.indexOf(flag);
  assert.ok(i >= 0, "missing " + flag);
  return args[i + 1];
}

for (const [name, target] of [
  ["PR", ["--pr", "17"]],
  ["local", ["--local", "--base", "main", "--branch", "feature"]],
]) {
  test(name + " landing authorizes and observes the same target and passes custody to the gate", (t) => {
    const fix = fixture(t, target);
    const custody = path.join(fix.unit, "custody-verdict.json");
    const digest = "d".repeat(64);
    fix.args.push("--custody-verdict", custody, "--custody-verdict-sha256", digest);
    const { calls, result } = simulate(fix);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"outcome":"shipped"/);
    const entry = calls.filter(c => c.verb !== "merge-gate delivery-receipt");
    assert.deepEqual(entry.map(c => c.verb), ["merge authorize", "merge-gate", "merge observe"]);
    for (const { args } of entry) {
      assert.equal(value(args, "--issue"), issue);
      assert.equal(value(args, "--run-dir"), path.dirname(fix.unit));
      if (name === "PR") assert.equal(value(args, "--pr"), "17");
      else {
        assert.ok(args.includes("--local"));
        assert.equal(value(args, "--base"), "main");
        assert.equal(value(args, "--branch"), "feature");
        assert.ok(!args.includes("--delete-branch"));
      }
    }
    const gate = entry[1].args;
    assert.ok(gate.includes("--execute"));
    assert.equal(value(gate, "--level"), "L3");
    assert.equal(value(gate, "--custody-verdict"), custody);
    assert.equal(value(gate, "--custody-verdict-sha256"), digest);
    if (name === "PR") {
      assert.ok(entry[0].args.includes("--delete-branch"));
      assert.ok(entry[2].args.includes("--delete-branch"));
    }
  });
}

for (const status of [1, 2]) {
  test("authorization exit " + status + " stops before the merge", (t) => {
    const { calls, result } = simulate(fixture(t), {
      "merge authorize": { status, stdout: "", stderr: "grant unavailable" },
    });
    assert.equal(result.status, status);
    assert.deepEqual(calls.map(c => c.verb), ["merge authorize"]);
    assert.doesNotMatch(result.stdout, /"outcome":"shipped"/);
  });
}

for (const [name, gate] of [
  ["refuses", { status: 1, stdout: JSON.stringify({ verdict: "refuse", merged: false, blockers: ["CI red"] }), stderr: "" }],
  ["returns malformed evidence", { status: 0, stdout: "{", stderr: "" }],
  ["only previews", ok({ ...confirmed, merged: false })],
]) {
  test("a gate that " + name + " cannot trigger observation or a shipped outcome", (t) => {
    const { calls, result } = simulate(fixture(t), { "merge-gate": gate });
    assert.ok(calls.some(c => c.verb === "merge-gate"));
    assert.ok(!calls.some(c => c.verb === "merge observe"));
    assert.doesNotMatch(result.stdout, /"outcome":"shipped"/);
  });
}

test("observation failure does not yield a shipped outcome", t => {
  const { result } = simulate(fixture(t), {
    "merge observe": { status: 2, stdout: "", stderr: "ledger unavailable" },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /"outcome":"shipped"/);
});

test("requires explicit execution before invoking any command", t => {
  const fix = fixture(t);
  fix.args = fix.args.filter(arg => arg !== "--execute");
  const { result, calls } = simulate(fix);
  assert.equal(result.status, 2);
  assert.deepEqual(calls, []);
});
