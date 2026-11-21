import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot, runCli } from "./helpers/run-cli.mjs";

function project(t, base = "", overlay) {
  const root = mkdtempSync(join(tmpdir(), "faff-producer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".faff"));
  if (base) writeFileSync(join(root, ".faffrc.yaml"), base);
  if (overlay) writeFileSync(join(root, ".faffrc.local.yaml"), overlay);
  return root;
}

function output(result) {
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

function compare(root, lane, inContext = false) {
  const previous = (...args) => runCli(args, { cwd: root });
  const occupant = output(previous("config", "get", "slots." + lane));
  const classification = previous("validate-adapters", "--is-bundled", occupant, "--slot", lane);
  assert.ok([0, 1].includes(classification.code), classification.stderr);
  const validation = classification.code === 0 ? "bundled" : "validate";
  const expected = { occupant, validation, transport: "in-context" };
  if (!inContext) {
    const dispatch = JSON.parse(output(previous("dispatch", "resolve", lane)));
    Object.assign(expected, dispatch, { transport: dispatch.model.startsWith("engine:") ? "engine" : "agent" });
  }
  const args = ["dispatch", "prepare-producer", lane, "--root", root];
  if (inContext) args.push("--in-context");
  const prepared = JSON.parse(output(runCli(args, { cwd: repoRoot })));
  assert.deepEqual(prepared, expected);
  return prepared;
}

test("every producer lane matches its default occupant, first-use check and model selection", t => {
  const root = project(t);
  for (const lane of ["spec", "spec_review", "architecture", "intake", "methodology", "adr"]) {
    const result = compare(root, lane);
    assert.deepEqual([result.validation, result.model, result.effort], ["bundled", "inherit", "inherit"]);
  }
  assert.deepEqual(readdirSync(join(root, ".faff")), []);
});

test("the overlay, registered alternate, foreign namespace and wrong-slot validation survive the handoff", t => {
  const root = project(t, "slots:\n  spec: replaced\n  architecture: faffter-noon-spec\ndispatch:\n  spec:\n    model: sonnet\n    effort: high\n",
    "slots:\n  spec: faffter-dark-nlspec\n  spec_review: example:reviewer\ndispatch:\n  spec:\n    model: opus\n");
  assert.deepEqual(compare(root, "spec"), {
    occupant: "faffter-dark-nlspec", validation: "bundled", transport: "agent", model: "opus", effort: "high",
  });
  assert.equal(compare(root, "architecture").validation, "validate");
  assert.equal(compare(root, "spec_review").validation, "validate");
});

test("engine producers retain the engine, effort and first-use check", t => {
  const root = project(t, "engines:\n  local:\n    provider: vllm\n    model: m1\n    host: http://h.test:8000\ndispatch:\n  intake:\n    model: engine:local\n    effort: low\n");
  assert.equal(compare(root, "intake").transport, "engine");
  assert.equal(compare(root, "intake", true).transport, "in-context");
});

test("an in-context invocation still validates the occupant and inherits the existing session", t => {
  const root = project(t, "slots:\n  architecture: foreign:architecture\ndispatch:\n  spec:\n    effort: bogus\n");
  assert.deepEqual(compare(root, "architecture", true), {
    occupant: "foreign:architecture", validation: "validate", transport: "in-context",
  });
  const external = runCli(["dispatch", "prepare-producer", "architecture"], { cwd: root });
  assert.equal(external.code, 2);
  assert.equal(external.stdout, "");
  assert.match(external.stderr, /bogus/);
});

test("dispatch config and argument errors leave no handoff", t => {
  for (const base of ["models:\n  spec: opus\n", "dispatch:\n  spec:\n    model: engine:absent\n", "slots:\n  spec: '  '\n"]) {
    const root = project(t, base);
    const result = runCli(["dispatch", "prepare-producer", "spec"], { cwd: root });
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
  }
  const root = project(t);
  for (const args of [[], ["prep_explore"], ["ship"], ["__proto__"], ["spec", "unexpected"], ["spec", "--in-contxt"]]) {
    const result = runCli(["dispatch", "prepare-producer", ...args], { cwd: root });
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
  }
});

test("prep uses producer handoffs for spec, review and conditional architecture", () => {
  const prep = readFileSync(join(repoRoot, "plugin/skills/faff-prep/SKILL.md"), "utf8");
  for (const lane of ["spec_review", "architecture", "spec"]) {
    assert.ok(prep.includes("faff dispatch prepare-producer " + lane + "`"));
  }
  assert.match(prep, /prepare-producer architecture` \(add `--in-context` when prep is a subagent\)/);
});
