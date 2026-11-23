import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("only a ready fresh handoff to the bundled adversarial reviewer can use the CLI", t => {
  const dark = "slots:\n  spec_review: faffter-dark-spec-review\n";
  for (const [base, overlay, wanted] of [
    [dark, "", "spec-review-cli"],
    [dark, "dispatch:\n  spec_review:\n    model: opus\n", "agent"],
    [dark, "dispatch:\n  spec_review:\n    effort: high\n", "agent"],
    [dark, "slots:\n  spec_review: team:reviewer\n", "agent"],
    ["", "", "agent"],
  ]) {
    const root = project(t, base, overlay);
    const args = ["dispatch", "prepare-producer", "spec_review", "--root", root];
    const ordinary = JSON.parse(output(runCli(args)));
    assert.equal(ordinary.transport, "agent");
    const fresh = JSON.parse(output(runCli([...args, "--fresh-adversarial"])));
    assert.deepEqual(fresh, { ...ordinary, transport: wanted });
  }
  const bad = project(t, dark + "dispatch:\n  spec_review:\n    effort: typo\n");
  for (const flags of [["spec_review", "--in-context"], ["architecture"], ["spec_review"]]) {
    const result = runCli(["dispatch", "prepare-producer", ...flags, "--fresh-adversarial", "--root", bad]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
  }
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

test("shared spec handoffs allocate private distinct paths for both bundled Agent writers", t => {
  const scratch = project(t);
  const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
  const seen = new Set();
  for (const occupant of ["faffter-noon-spec", "faffter-dark-nlspec", "faffter-dark-nlspec"]) {
    const root = project(t, "slots:\n  spec: " + occupant + "\n");
    const handoff = JSON.parse(output(runCli(["dispatch", "prepare-producer", "spec", "--shared-spec-files"], { cwd: root, env })));
    assert.equal(handoff.occupant, occupant);
    assert.equal(handoff.transport, "agent");
    const { spec, review } = handoff.output_files;
    const dir = dirname(spec);
    assert.equal(dirname(review), dir);
    assert.equal(dirname(dir), scratch);
    assert.equal(seen.has(dir), false);
    seen.add(dir);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(statSync(dir).mode & 0o077, 0);
    const body = "# A change\n\n**Chosen:** Preserve rows.\n\nconfidence: high\n\n```faff-contract:spec-readiness\n" +
      JSON.stringify({ confidence: "high", decisions: [{ marker: "chosen" }], self_review: [] }) + "\n```\n";
    writeFileSync(spec, body);
    writeFileSync(review, "Reviewed; no findings.\n");
    const staged = JSON.parse(output(runCli(["prep", "attach", "--issue", "EX-17", "--spec", spec, "--mode", "autonomous", "--fresh", "--git-only", "--json"], { cwd: root, env })));
    assert.equal(staged.token, "attached");
    assert.equal(staged.confidence, "high");
    const attached = readFileSync(join(root, ".faff", "specs", "EX-17.md"), "utf8");
    assert.match(attached, /Preserve rows/);
    assert.doesNotMatch(attached, /no findings/);
  }
});

test("custom specs keep their transport and unsupported engines or invalid file requests allocate nothing", t => {
  const scratch = project(t);
  const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
  const before = readdirSync(scratch);
  const custom = project(t, "slots:\n  spec: team:spec\n");
  const remote = project(t, "engines:\n  local:\n    provider: vllm\n    model: m1\n    host: http://h.test:8000\ndispatch:\n  spec:\n    model: engine:local\n");
  for (const root of [custom, remote]) {
    const ordinary = runCli(["dispatch", "prepare-producer", "spec"], { cwd: root, env });
    const files = runCli(["dispatch", "prepare-producer", "spec", "--shared-spec-files"], { cwd: root, env });
    assert.deepEqual(files, ordinary);
    if (root === custom) assert.equal(JSON.parse(output(files)).validation, "validate");
    else assert.equal(files.code, 2);
  }
  for (const args of [["methodology"], ["spec", "--in-context"], ["spec", "--fresh-adversarial"]]) {
    const result = runCli(["dispatch", "prepare-producer", ...args, "--shared-spec-files"], { cwd: custom, env });
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
  }
  assert.deepEqual(readdirSync(scratch), before);
});


test("prep logs the worker review without printing it or continuing from missing evidence", t => {
  const root = project(t);
  const spec = join(root, "prepared spec.md");
  const review = join(root, "self review.md");
  const prep_log = join(root, "prep log.md");
  const skill = readFileSync(join(repoRoot, "plugin/skills/faff-prep/SKILL.md"), "utf8");
  const [, record] = skill.match(/`(test -s "\$spec"[^`]+)` before staging/);
  const run = (logPath = prep_log) => spawnSync("bash", ["-c", record + " && printf staged"], {
    encoding: "utf8", env: { ...process.env, spec, review, prep_log: logPath },
  });
  writeFileSync(spec, "# Draft\n");
  writeFileSync(prep_log, "Prior log\n");
  assert.notEqual(run().status, 0);
  writeFileSync(review, "");
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(prep_log, "utf8"), "Prior log\n");
  writeFileSync(review, "One finding and its resolution.\n");
  const ready = run();
  assert.equal(ready.status, 0);
  assert.equal(ready.stdout, "staged");
  assert.equal(readFileSync(prep_log, "utf8"), "Prior log\nOne finding and its resolution.\n");
  const essential = run("");
  assert.equal(essential.status, 0);
  assert.equal(essential.stdout, "staged");
  assert.equal(readFileSync(prep_log, "utf8"), "Prior log\nOne finding and its resolution.\n");
  writeFileSync(spec, "");
  assert.notEqual(run("").status, 0);
  assert.notEqual(run().status, 0);
});
