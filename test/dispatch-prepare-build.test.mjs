import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot, runCli } from "./helpers/run-cli.mjs";

const BUILD_CONFIG = `
dispatch:
  build:
    model: inherit
    effort: low
    by_tier:
      mechanical:
        model: haiku
        effort: low
      standard:
        model: opus
        effort: medium
      complex:
        effort: high
      default:
        effort: medium
    by_confidence:
      default:
        model: fable
      high:
        model: opus
      medium:
        model: sonnet
`;

const run = {
  run_id: "run-42",
  run_dir: "/tmp/work space/checkout/.faff/runs/run-42",
  session_id: "session-9",
};
const inputFor = (members) => ({ members, ...run });

function configRoot(t, config) {
  const root = mkdtempSync(join(tmpdir(), "faff-dispatch-prepare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".faff"));
  if (config !== undefined) writeFileSync(join(root, ".faffrc.yaml"), config);
  return root;
}

function prepare(root, executor, unit, opts = {}) {
  const { cwd = root, explicitRoot = false } = opts;
  const flags = ["--executor", executor];
  if (explicitRoot) flags.push("--root", root);
  return runCli(["dispatch", "prepare-build", ...flags], { cwd, input: JSON.stringify(unit) });
}

function parseSuccess(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function resolve(root, ...matchers) {
  return parseSuccess(runCli(["dispatch", "resolve", "build", "--root", root, ...matchers]));
}

function expectRefusal(result, diagnostic) {
  assert.equal(result.code, 2, result.stderr);
  assert.equal(result.stdout, "", "a refusal must leave no worker handoff on stdout");
  assert.match(result.stderr, diagnostic);
}

test("parallel and sequential prepare the same ordered build unit with their own launch mode", (t) => {
  const root = configRoot(t, BUILD_CONFIG);
  const unit = inputFor([
    { issue: "FAFF-8", tier: "mechanical", confidence: "medium" },
    { issue: "FAFF-2", "build-tier": "complex", confidence: "unknown" },
    { issue: "FAFF-6", tier: "standard", confidence: "high" },
  ]);
  const resolved = resolve(root, "--tier", "complex", "--confidence", "medium");
  assert.deepEqual(resolved, { model: "sonnet", effort: "high" });

  for (const executor of ["sequential", "parallel"]) {
    const result = parseSuccess(prepare(root, executor, unit, { cwd: repoRoot, explicitRoot: true }));
    // The exact shape keeps effort in the log alone and gives the caller no event payload.
    assert.deepEqual(result, {
      dispatch: {
        issues: ["FAFF-8", "FAFF-2", "FAFF-6"],
        ...run,
        mode_signal: "autonomous",
        model: resolved.model,
      },
      agent_parameters: { run_in_background: executor === "parallel", model: resolved.model },
      effort_log: resolved.effort,
    }, executor);
  }
});

test("omitted tier skips the tier model default; unrecognised confidence uses the resolver fallback", (t) => {
  const config = BUILD_CONFIG.replace("default:\n        effort: medium", "default:\n        model: haiku\n        effort: medium");
  const root = configRoot(t, config);
  const resolved = resolve(root, "--confidence", "unrated");
  assert.deepEqual(resolved, { model: "fable", effort: "medium" });

  const unrated = parseSuccess(prepare(root, "sequential", inputFor([{ issue: "FAFF-1", confidence: "unrated" }])));
  const omitted = parseSuccess(prepare(root, "sequential", inputFor([{ issue: "FAFF-1" }])));
  assert.deepEqual(unrated, omitted);
  assert.equal(unrated.dispatch.model, resolved.model);
  assert.equal(unrated.agent_parameters.model, resolved.model);
  assert.equal(unrated.effort_log, resolved.effort);

  const tierDefault = parseSuccess(prepare(root, "sequential", inputFor([{ issue: "FAFF-1", tier: "unknown" }])));
  assert.equal(tierDefault.dispatch.model, resolve(root, "--tier", "unknown").model);
  assert.equal(tierDefault.dispatch.model, "haiku");
});

test("inherit omits the Agent model parameter in both launch modes", (t) => {
  const root = configRoot(t);
  const resolved = resolve(root);
  assert.deepEqual(resolved, { model: "inherit", effort: "inherit" });

  for (const executor of ["sequential", "parallel"]) {
    const result = parseSuccess(prepare(root, executor, inputFor([{ issue: "FAFF-1" }])));
    assert.deepEqual(result, {
      dispatch: { issues: ["FAFF-1"], ...run, mode_signal: "autonomous", model: resolved.model },
      agent_parameters: { run_in_background: executor === "parallel" },
      effort_log: resolved.effort,
    });
  }
});

test("malformed units fail closed before an Agent request can be formed", (t) => {
  const root = configRoot(t, BUILD_CONFIG);
  const cases = [
    [inputFor([]), /nonempty members array/],
    [inputFor([null]), /partition member/],
    [inputFor([{}]), /member\.issue/],
    [inputFor([{ issue: 1 }]), /member\.issue/],
    [inputFor([{ issue: " " }]), /member\.issue/],
    [inputFor([{ issue: "FAFF-1" }, { issue: "FAFF-1" }]), /duplicate issue FAFF-1/],
    [inputFor([{ issue: "FAFF-1", tier: "standard", "build-tier": "complex" }]), /conflicting tier fields/],
    [{ members: [{ issue: "FAFF-1" }], ...run, run_dir: "" }, /run_dir/],
    [{ ...inputFor([{ issue: "FAFF-1" }]), constraints: { descope: ["anything"] } }, /constraints/],
  ];
  for (const [unit, diagnostic] of cases) {
    expectRefusal(prepare(root, "parallel", unit), diagnostic);
  }
  expectRefusal(runCli(["dispatch", "prepare-build", "--executor", "parallel"], { cwd: root, input: "{" }), /prepare-build/);
});

test("prepare-build refuses invalid dispatch config in an unselected lane", (t) => {
  const root = configRoot(t, BUILD_CONFIG + "  spec:\n    effort: turbo\n");
  const baseline = runCli(["dispatch", "resolve", "build"], { cwd: root });
  expectRefusal(baseline, /dispatch\.spec\.effort/);
  expectRefusal(prepare(root, "sequential", inputFor([{ issue: "FAFF-1" }])), /dispatch\.spec\.effort/);
});

test("prepare-build refuses unknown, duplicate, missing and invalid flags", (t) => {
  const root = configRoot(t, BUILD_CONFIG);
  const input = JSON.stringify(inputFor([{ issue: "FAFF-1" }]));
  const cases = [
    [[], /usage: faff dispatch prepare-build/],
    [["--executor", "other"], /sequential\|parallel/],
    [["--executor"], /requires a value/],
    [["--executor", "sequential", "--executor", "parallel"], /--executor given more than once/],
    [["--executor", "parallel", "--root", root, "--root", root], /--root given more than once/],
    [["--executor", "parallel", "--constraints", "{}"], /unknown flag --constraints/],
    [["--executor", "parallel", "--json"], /unknown flag --json/],
  ];
  for (const [flags, diagnostic] of cases) {
    expectRefusal(runCli(["dispatch", "prepare-build", ...flags], { cwd: root, input }), diagnostic);
  }
});

test("both default executor paths use the CLI and the shared build worker prompt", () => {
  const readSkill = (...parts) => readFileSync(join(repoRoot, "plugin", "skills", ...parts), "utf8");
  const executors = [
    ["faffter-noon-concurrency-sequential", "sequential"],
    ["faffter-dark-concurrency-parallel", "parallel"],
  ];
  for (const [skill, executor] of executors) {
    const prompt = readSkill(skill, "SKILL.md");
    assert.ok(prompt.includes("faff dispatch prepare-build --executor " + executor), skill);
    assert.ok(prompt.includes("**Build worker prompt**"), skill);
  }

  const l4 = readSkill("faff", "references", "l4.md");
  const worker = l4.split(/^### Build worker prompt\s*$/m)[1]?.split(/^#{1,3} /m)[0];
  assert.ok(worker, "l4.md holds the canonical worker prompt");
  assert.match(worker, /review-target --resolve/);
  assert.match(worker, /review-target --guard/);
  assert.match(worker, /Foreground-to-terminal:/i);
  assert.match(worker, /Voice clause.*kernel\.md/i);
  assert.match(worker, /agent_parameters.*Agent\/Task/);

  const kernel = readSkill("faff", "references", "kernel.md");
  assert.match(kernel, /\*\*Voice clause\.\*\*.*House voice:/);
});

test("wave tags preserve the cluster description and do not change execution options", t => {
  const root = configRoot(t, BUILD_CONFIG);
  const unit = inputFor([{issue:"FAFF-5"}]);
  for (const executor of ["parallel","sequential"]) {
    const ordinary = parseSuccess(prepare(root,executor,unit));
    assert.deepEqual(parseSuccess(prepare(root,executor,{...unit,wave:3})), {...ordinary,description_tag:"faff-build-wave:3"});
  }
  for (const wave of [0,-1,1.5,"2",null]) expectRefusal(prepare(root,"parallel",{...unit,wave}),/wave/);
});
