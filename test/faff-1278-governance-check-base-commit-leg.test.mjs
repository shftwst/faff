// FAFF-1278: the governance-check Action's base-commit evidence leg.
//
// Two halves. The structural half reads `.github/actions/governance-check/action.yml` as text and
// pins step order, gates, the fail-closed `verdict` expression and the constant plugin path. The
// harness half extracts the REAL `run:` bodies of `anchors-touched`, `resolve-trusted-cli` and
// `evidence-schema-base` and runs them under bash against temp git repos whose base commit carries
// this branch's faff CLI, so every behaviour below is the shipped step text, not a copy.
//
// What node:test cannot observe (composite-step `if: !cancelled()` on a real runner, the runner's
// evaluation of the `verdict` expression) is the spike's job; `actionVerdict` below mirrors the
// pinned expression so the harness can state what that expression yields for each step result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { example, mkChainedRun, writeEvidence, repoRoot } from "./helpers/evidence-anchor-fixtures.mjs";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const PLUGIN = "plugin/skills/faff";
const ANCHORS = ".faff/anchors";
const SENTINEL = "S3CR3T-SENTINEL";
const actionText = readFileSync(path.join(repoRoot, ".github/actions/governance-check/action.yml"), "utf8");

// ---------------------------------------------------------------------------------------------
// Action text helpers
// ---------------------------------------------------------------------------------------------

// Step blocks keyed by id, full-line comments stripped (same convention as the FAFF-924 test).
function stepBlocks(text) {
  const lines = text.split("\n").filter((line) => !/^\s*#/.test(line));
  const starts = [];
  lines.forEach((line, i) => { if (/^ {4}- name:/.test(line)) starts.push(i); });
  const blocks = {};
  const order = [];
  starts.forEach((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const block = lines.slice(start, end).join("\n");
    const id = block.match(/^ {6}id:\s*(\S+)/m);
    if (id) { blocks[id[1]] = block; order.push(id[1]); }
  });
  return { blocks, order };
}

// The literal `run: |` body of one step, dedented, so bash sees exactly the shipped script.
function runBody(id) {
  const lines = actionText.split("\n");
  const at = lines.findIndex((l) => l === `      id: ${id}`);
  assert.ok(at >= 0, `step ${id} exists`);
  const runAt = lines.findIndex((l, i) => i > at && l === "      run: |");
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== "" && !l.startsWith("        ")) break;
    body.push(l.slice(8));
  }
  return body.join("\n") + "\n";
}

const { blocks, order } = stepBlocks(actionText);
const GATE = "if: ${{ !cancelled() && steps.anchors-touched.outputs.touched != 'false' }}";
const VERDICT_EXPR = "${{ (steps.anchors-touched.outputs.touched == 'false' || (steps.evidence-schema-base.outcome == 'success' && steps.evidence-schema-base.outputs.verdict == 'pass')) && (steps.governance-check.outputs.verdict || steps.anchor-missing.outputs.verdict || steps.on-missing.outputs.verdict) || 'fail' }}";

// What the pinned expression yields. GitHub's `a && b || c` returns b when a and b are truthy.
function actionVerdict({ touched, baseOutcome, baseVerdict, headVerdict }) {
  const clean = touched === "false" || (baseOutcome === "success" && baseVerdict === "pass");
  return (clean && headVerdict) || "fail";
}

// ---------------------------------------------------------------------------------------------
// Structural tests
// ---------------------------------------------------------------------------------------------

test("anchors-touched sits before anchor discovery, runs no faff binary and has no gate", () => {
  assert.ok(order.indexOf("anchors-touched") >= 0);
  assert.ok(order.indexOf("anchors-touched") < order.indexOf("discover-anchors"));
  const block = blocks["anchors-touched"];
  assert.ok(!/\n {6}if:/.test(block), "anchors-touched always runs");
  assert.ok(!/\bnode\b|\bfaff\b|outputs\.bin|inputs\.faff-binary/.test(block.replace(/^ {4}- name:.*$/m, "")), "no faff binary");
  for (const value of ["touched=true", "touched=false", "touched=error"]) assert.ok(block.includes(value), value);
});

test("the two base-commit steps sit after governance-check and are gated on !cancelled() and touched", () => {
  const head = order.indexOf("governance-check");
  assert.ok(head >= 0);
  assert.ok(order.indexOf("resolve-trusted-cli") > head);
  assert.ok(order.indexOf("evidence-schema-base") > order.indexOf("resolve-trusted-cli"));
  for (const id of ["resolve-trusted-cli", "evidence-schema-base"]) {
    assert.ok(blocks[id].includes(`      ${GATE}`), `${id} gate`);
  }
});

test("the Action verdict output is pinned to the fail-closed form and evidence-result is exposed", () => {
  assert.ok(actionText.includes(`    value: ${VERDICT_EXPR}`));
  assert.ok(actionText.includes("    value: ${{ steps.evidence-schema-base.outputs.evidence_result }}"));
});

test("the evidence-schema input defaults to require and the head verb gets the flag only under require", () => {
  assert.match(actionText, /\n {2}evidence-schema:\n(?: {4}.*\n)+? {4}default: "require"\n/);
  const block = blocks["governance-check"];
  const guarded = /if \[ "\$\{\{ inputs\.evidence-schema \}\}" = "require" \]; then\n\s+ARGS\+=\(--require-evidence-schema\)\n\s+fi/;
  assert.match(block, guarded);
  assert.equal(block.split("--require-evidence-schema").length - 1, 1, "the flag appears only inside the require guard");
});

test("the base extraction path is the literal plugin/skills/faff and no trusted call reads inputs.faff-binary", () => {
  const resolve = blocks["resolve-trusted-cli"];
  assert.ok(resolve.includes('PLUGIN="plugin/skills/faff"'));
  assert.ok(resolve.includes('git archive "$BASE_SHA" -- "$PLUGIN"'));
  for (const id of ["resolve-trusted-cli", "evidence-schema-base"]) {
    assert.ok(!blocks[id].includes("inputs.faff-binary"), `${id} never reads inputs.faff-binary`);
    assert.ok(!blocks[id].includes("steps.use-in-checkout"), `${id} never runs the head binary`);
  }
});

test("run_trusted runs node with an empty cwd under RUNNER_TEMP and env -i", () => {
  const expected = 'run_trusted() { (cd "$RUNNER_TEMP/faff-trusted-cwd" && env -i PATH="$PATH" HOME="$RUNNER_TEMP/faff-home" node "$TRUSTED" "$@"); }';
  for (const id of ["resolve-trusted-cli", "evidence-schema-base"]) assert.ok(blocks[id].includes(expected), id);
});

test("the repo has no .gitattributes export-ignore that could drop plugin files from git archive", () => {
  const attrs = spawnSync("git", ["-C", repoRoot, "ls-files", "--", "*.gitattributes", ".gitattributes"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const file of attrs) {
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    assert.ok(!/export-ignore/.test(text), `${file} carries export-ignore`);
  }
  const check = spawnSync("git", ["-C", repoRoot, "check-attr", "export-ignore", "--", `${PLUGIN}/bin/faff`, `${PLUGIN}/bin/lib/evidence.js`, `${PLUGIN}/contracts/evidence-v0.3/anchor-manifest.json`], { encoding: "utf8" });
  assert.ok(!/export-ignore: set/.test(check.stdout), check.stdout);
});

// ---------------------------------------------------------------------------------------------
// Harness: temp repos whose base commit carries this branch's faff CLI
// ---------------------------------------------------------------------------------------------

const TMP = mkdtempSync(path.join(tmpdir(), "faff-1278-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

function git(dir, args, opts = {}) {
  const r = spawnSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", ...opts });
  if (!opts.allowFail) assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r;
}

function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).stdout.trim();
}

// A template repo per base flavour, cloned per case: "cli" (this branch), "old-cli" (no
// capabilities subcommand), "no-binding-cli" (capabilities without holdout-binding) and "no-cli"
// (no plugin at all).
const templates = new Map();
function template(flavour) {
  if (templates.has(flavour)) return templates.get(flavour);
  const dir = path.join(TMP, `tpl-${flavour}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "T"]);
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  if (flavour !== "no-cli") {
    const files = spawnSync("git", ["-C", repoRoot, "ls-files", "--", PLUGIN], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    for (const rel of files) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      cpSync(path.join(repoRoot, rel), path.join(dir, rel));
    }
    if (flavour === "no-binding-cli") {
      const lib = path.join(dir, PLUGIN, "bin/lib/evidence.js");
      const text = readFileSync(lib, "utf8");
      assert.ok(text.includes(', "holdout-binding"]'));
      writeFileSync(lib, text.replace(', "holdout-binding"]', "]"));
    }
    if (flavour === "old-cli") {
      const lib = path.join(dir, PLUGIN, "bin/lib/evidence.js");
      const text = readFileSync(lib, "utf8");
      assert.ok(text.includes('sub === "capabilities"'));
      writeFileSync(lib, text.replace('sub === "capabilities"', 'sub === "capabilities-removed-for-test"'));
    }
  }
  const sha = commitAll(dir, "base");
  templates.set(flavour, { dir, sha });
  return templates.get(flavour);
}

let caseCount = 0;
function workRepo(flavour = "cli") {
  const tpl = template(flavour);
  const dir = path.join(TMP, `case-${++caseCount}`);
  spawnSync("git", ["clone", "-q", tpl.dir, dir], { encoding: "utf8" });
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "T"]);
  return { dir, base: tpl.sha };
}

// The conforming anchor: a minted chain plus v0.3 evidence whose merge floor is complete.
let mintedAnchor = null;
function conformingAnchor() {
  if (mintedAnchor) return mintedAnchor;
  const root = path.join(TMP, "mint");
  const run = mkChainedRun(root);
  writeEvidence(run, "v03");
  writeFileSync(path.join(run, "FAFF-1", "ac-checklist.json"), JSON.stringify({
    schema_version: 1, all_verified: true, criteria: [{ ac: "a", verified: "Verified: test", passed: true }],
  }));
  const dest = path.join(root, "anchor");
  const r = runCli(["events", "anchor", "--run-dir", run, "--issue", "FAFF-1", "--dest", dest]);
  assert.equal(r.code, 0, r.stderr);
  mintedAnchor = dest;
  return dest;
}

function placeAnchor(repo, rel, mutate) {
  const dest = path.join(repo, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(conformingAnchor(), dest, { recursive: true });
  if (mutate) mutate(dest);
  return dest;
}

const editJson = (file, edit) => writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, "utf8")))));
const breakReview = (dir) => editJson(path.join(dir, "review-verdict.json"), (d) => { delete d.rounds_total; return d; });

function parseOutputs(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

function runStep(id, { cwd, env, temp, detached = false }) {
  const scratch = mkdtempSync(path.join(TMP, `${id}-`));
  const outputFile = path.join(scratch, "output");
  const summaryFile = env.GITHUB_STEP_SUMMARY ?? path.join(scratch, "summary.md");
  writeFileSync(outputFile, "");
  if (!env.GITHUB_STEP_SUMMARY) writeFileSync(summaryFile, "");
  const script = path.join(scratch, "step.sh");
  writeFileSync(script, runBody(id));
  const r = spawnSync("bash", ["-e", script], {
    cwd,
    encoding: "utf8",
    detached,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_WORKSPACE: cwd, RUNNER_TEMP: temp,
      GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile, ...env,
    },
  });
  let summary = "";
  try { summary = readFileSync(summaryFile, "utf8"); } catch { /* a directory in the fault case */ }
  return { code: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, outputs: parseOutputs(readFileSync(outputFile, "utf8")), summary };
}

// Runs anchors-touched, resolve-trusted-cli and evidence-schema-base in order, as the Action does.
function runLeg(repo, { base, head, mode = "report", inCheckout = "true", pinnedBin = "", extraEnv = {}, trustedOverride, detached = false } = {}) {
  const temp = mkdtempSync(path.join(TMP, "runner-temp-"));
  const shas = { BASE_SHA: base, HEAD_SHA: head };
  const touched = runStep("anchors-touched", { cwd: repo, temp, env: { ANCHORS_PATH: ANCHORS, ...shas, ...extraEnv } });
  const touchedValue = touched.outputs.touched;
  if (touchedValue === "false") return { touched: touchedValue, base: null };
  const resolve = runStep("resolve-trusted-cli", { cwd: repo, temp, env: { IN_CHECKOUT: inCheckout, PINNED_BIN: pinnedBin, BASE_SHA: base, ...extraEnv } });
  const trusted = trustedOverride ? trustedOverride(resolve.outputs.trusted) : resolve.outputs.trusted;
  const leg = runStep("evidence-schema-base", {
    cwd: repo, temp,
    detached,
    env: {
      MODE: mode, TOUCHED: touchedValue, UNAVAILABLE: resolve.outputs.unavailable ?? "", TRUSTED: trusted ?? "",
      CANDIDATE: resolve.outputs.candidate ?? "", HOLDOUT_BINDING: resolve.outputs["holdout-binding"] ?? "",
      ANCHORS_PATH: ANCHORS, ...shas, ...extraEnv,
    },
  });
  return { touched: touchedValue, resolve, base: leg, log: leg.stdout + leg.stderr + resolve.stdout + resolve.stderr };
}

// A base repo plus a head commit made by `build(repoDir)`.
function scenario(build, { flavour = "cli", baseBuild } = {}) {
  const { dir } = workRepo(flavour);
  let base = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
  if (baseBuild) { baseBuild(dir); base = commitAll(dir, "base anchors"); }
  build(dir);
  const head = commitAll(dir, "head");
  return { dir, base, head };
}

const annotations = (text, kind) => text.split("\n").filter((l) => l.startsWith(`::${kind}::`));

// ---------------------------------------------------------------------------------------------
// Harness tests
// ---------------------------------------------------------------------------------------------

test("smoke: a conforming anchor passes under require; a loosened head schema cannot rescue a broken one; an edit to a committed anchor is refused", () => {
  // Steps 1 and 2: base A carries the CLI, head B adds a conforming anchor.
  const { dir } = workRepo();
  const a = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
  placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`);
  const b = commitAll(dir, "B");
  const pass = runLeg(dir, { base: a, head: b, mode: "require" });
  assert.equal(pass.base.code, 0, pass.log);
  assert.equal(pass.base.outputs.verdict, "pass");
  assert.equal(pass.base.outputs.evidence_result, "pass");
  assert.match(pass.base.summary, /### Evidence schema \(base commit [0-9a-f]{12}\)/);

  // Step 3: C drops schema_version from the anchor's review verdict and loosens the head schema.
  git(dir, ["checkout", "-q", "-b", "c", a]);
  placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, (d) => editJson(path.join(d, "review-verdict.json"), (doc) => { delete doc.schema_version; return doc; }));
  editJson(path.join(dir, PLUGIN, "contracts/evidence-v0.3/schema/review-verdict-anchored.schema.json"), (s) => {
    s.required = s.required.filter((k) => k !== "schema_version"); return s;
  });
  const c = commitAll(dir, "C");
  const req = runLeg(dir, { base: a, head: c, mode: "require" });
  assert.equal(req.base.code, 1, req.log);
  assert.equal(req.base.outputs.verdict, "fail");
  assert.match(req.base.summary, /partial \(schema\/review-verdict-anchored\.schema\.json\)/);
  const rep = runLeg(dir, { base: a, head: c, mode: "report" });
  assert.equal(rep.base.code, 0, rep.log);
  assert.equal(rep.base.outputs.verdict, "pass");
  assert.equal(rep.base.outputs.evidence_result, "fail");

  // Step 4: D, on top of B, modifies a file of B's anchor.
  git(dir, ["checkout", "-q", "-b", "d", b]);
  const committed = path.join(dir, ANCHORS, "run-x/FAFF-1/ac-checklist.json");
  writeFileSync(committed, readFileSync(committed, "utf8") + " ");
  const d = commitAll(dir, "D");
  for (const mode of ["require", "report"]) {
    const r = runLeg(dir, { base: b, head: d, mode });
    assert.equal(r.base.code, 1, r.log);
    assert.equal(r.base.outputs.verdict, "fail");
    assert.ok(annotations(r.base.stdout, "error").some((l) => l.includes(`anchor-immutable ${ANCHORS}/run-x/FAFF-1/ac-checklist.json`)), r.base.stdout);
  }
});

test("Scenario 1: a head schema that drops additionalProperties:false is rejected as a candidate and the base schema fails the anchor, while the head verb passes", () => {
  const s = scenario((dir) => {
    editJson(path.join(dir, PLUGIN, "contracts/evidence-v0.3/schema/review-verdict-anchored.schema.json"), (schema) => { delete schema.additionalProperties; return schema; });
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, (d) => editJson(path.join(d, "review-verdict.json"), (doc) => ({ ...doc, extra_key: "x" })));
  });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.base.code, 1, r.log);
  assert.equal(r.base.outputs.verdict, "fail");
  assert.match(r.base.summary, /\| \*\*fail\*\* \| fail \| review-verdict\.json \(fail\) \| partial \(schema\/review-verdict-anchored\.schema\.json\) \|/);
  assert.equal(actionVerdict({ touched: "true", baseOutcome: "failure", baseVerdict: "fail", headVerdict: "pass" }), "fail");

  const head = spawnSync("node", [path.join(s.dir, PLUGIN, "bin/faff"), "governance-check", "--anchor-dir", path.join(s.dir, ANCHORS, "run-x/FAFF-1"), "--require-evidence-schema", "--json"], { cwd: s.dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(head.status, 0, head.stdout + head.stderr);
});

test("Scenario 2: an optional typed closed property added to the head run-ledger schema is accepted and the anchor carrying it passes", () => {
  const s = scenario((dir) => {
    for (const root of [path.join(dir, PLUGIN, "contracts/evidence-v0.3"), path.join(dir, "verification/evidence/v0.3")]) {
      const file = path.join(root, "schema/run-ledger.schema.json");
      if (root.includes("verification")) mkdirSync(path.dirname(file), { recursive: true });
      const schema = JSON.parse(readFileSync(path.join(dir, PLUGIN, "contracts/evidence-v0.3/schema/run-ledger.schema.json"), "utf8"));
      schema.properties.operator_notes = { type: "string" };
      writeFileSync(file, JSON.stringify(schema));
    }
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, (d) => editJson(path.join(d, "run-ledger.json"), (doc) => ({ ...doc, operator_notes: "n" })));
  });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.base.code, 0, r.log);
  assert.equal(r.base.outputs.verdict, "pass");
  assert.match(r.base.summary, /\| ok \| pass \| - \| accepted \|/);
});

test("Scenario 3: a head that empties --derive-anchor-dirs cannot hide a non-conforming anchor from the base CLI", () => {
  const s = scenario((dir) => {
    const lib = path.join(dir, PLUGIN, "bin/lib/governance-check.js");
    const text = readFileSync(lib, "utf8");
    writeFileSync(lib, text.replace("function deriveAnchorDirs(changedPaths, anchorsPath) {", "function deriveAnchorDirs(changedPaths, anchorsPath) {\n  return { dirs: [], dropped: [] };"));
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, breakReview);
  });
  const headDiscovery = spawnSync("node", [path.join(s.dir, PLUGIN, "bin/faff"), "governance-check", "--derive-anchor-dirs", ANCHORS], { cwd: s.dir, input: `${ANCHORS}/run-x/FAFF-1/review-verdict.json\n`, encoding: "utf8" });
  assert.equal(headDiscovery.stdout, "", "the head binary's discovery is stubbed empty");
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.base.code, 1, r.log);
  assert.match(r.base.summary, /\| \.faff\/anchors\/run-x\/FAFF-1 \| \*\*fail\*\* \| fail \|/);
});

test("Scenario 4: under report the same anchor gives step exit 0, verdict pass, evidence_result fail and a warning naming the dir", () => {
  const s = scenario((dir) => {
    editJson(path.join(dir, PLUGIN, "contracts/evidence-v0.3/schema/review-verdict-anchored.schema.json"), (schema) => { delete schema.additionalProperties; return schema; });
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, (d) => editJson(path.join(d, "review-verdict.json"), (doc) => ({ ...doc, extra_key: "x" })));
  });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "report" });
  assert.equal(r.base.code, 0, r.log);
  assert.equal(r.base.outputs.verdict, "pass");
  assert.equal(r.base.outputs.evidence_result, "fail");
  assert.deepEqual(annotations(r.base.stdout, "error"), []);
  assert.ok(annotations(r.base.stdout, "warning").some((l) => l.includes(".faff/anchors/run-x/FAFF-1")), r.base.stdout);
  for (const head of ["pass", "fail"]) {
    assert.equal(actionVerdict({ touched: "true", baseOutcome: "success", baseVerdict: r.base.outputs.verdict, headVerdict: head }), head);
  }
});

test("Scenario 5: a step killed before writing its verdict leaves the Action verdict at fail, and an unexpected fault writes verdict=fail through the trap", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`));
  const killer = path.join(TMP, "kill-step.js");
  // SIGKILLs the step's whole process group (the step runs detached, so it leads its own group):
  // no trap can run, so the step ends without writing a verdict.
  writeFileSync(killer, `const { execFileSync } = require("node:child_process");
const group = execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim();
process.kill(-Number(group), "SIGKILL");
setTimeout(() => {}, 5000);
`);
  for (const mode of ["require", "report"]) {
    const killed = runLeg(s.dir, { base: s.base, head: s.head, mode, trustedOverride: () => killer, detached: true });
    assert.equal(killed.base.signal, "SIGKILL", killed.log);
    assert.equal(killed.base.outputs.verdict, undefined, "no verdict was written");
    assert.equal(actionVerdict({ touched: "true", baseOutcome: "failure", baseVerdict: killed.base.outputs.verdict, headVerdict: "pass" }), "fail");

    const summaryDir = mkdtempSync(path.join(TMP, "summary-dir-"));
    const fault = runLeg(s.dir, { base: s.base, head: s.head, mode, extraEnv: { GITHUB_STEP_SUMMARY: summaryDir } });
    assert.equal(fault.base.code, 1, fault.log);
    assert.equal(fault.base.outputs.verdict, "fail");
    assert.ok(fault.base.stdout.includes("stopped before reaching a verdict"));
  }
});

test("a base commit with no faff CLI fails closed with evidence-validator-unavailable in both modes", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`), { flavour: "no-cli" });
  for (const mode of ["require", "report"]) {
    const r = runLeg(s.dir, { base: s.base, head: s.head, mode });
    assert.equal(r.resolve.outputs.unavailable, "true");
    assert.equal(r.base.code, 1, r.log);
    assert.equal(r.base.outputs.verdict, "fail");
    assert.ok(annotations(r.base.stdout, "error").some((l) => l.includes("evidence-validator-unavailable")));
  }
});

test("a base CLI without capabilities validates against base schemas only and reports candidate n/a", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`), { flavour: "old-cli" });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.resolve.outputs.candidate, "", "no candidate offered");
  assert.equal(r.base.code, 0, r.log);
  assert.match(r.base.summary, /\| ok \| pass \| - \| n\/a \|/);
});

test("--candidate-schemas and every validate dir argument are absolute", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`));
  const log = path.join(TMP, "argv.log");
  const recorder = path.join(TMP, "record-argv.js");
  const r = runLeg(s.dir, {
    base: s.base, head: s.head, mode: "require",
    trustedOverride: (trusted) => {
      assert.ok(path.isAbsolute(trusted));
      writeFileSync(recorder, `const { spawnSync } = require("node:child_process");
require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(spawnSync(process.execPath, [${JSON.stringify(trusted)}, ...process.argv.slice(2)], { stdio: "inherit" }).status);
`);
      return recorder;
    },
  });
  assert.equal(r.base.code, 0, r.log);
  assert.ok(path.isAbsolute(r.resolve.outputs.candidate));
  const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const validates = calls.filter((a) => a[0] === "evidence" && a[1] === "validate");
  assert.equal(validates.length, 1);
  for (const a of validates) {
    assert.ok(path.isAbsolute(a[2]), a[2]);
    assert.ok(path.isAbsolute(a[a.indexOf("--candidate-schemas") + 1]));
  }
  const derive = calls.find((a) => a.includes("--derive-anchor-dirs"));
  assert.ok(path.isAbsolute(derive[derive.indexOf("--derive-anchor-dirs") + 1]));
});

test("no violation text or evidence value reaches the job log or summary", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, (d) => {
    const lines = readFileSync(path.join(d, "events.jsonl"), "utf8").trimEnd().split("\n");
    const first = JSON.parse(lines[0]);
    lines[0] = JSON.stringify({ ...first, type: SENTINEL });
    writeFileSync(path.join(d, "events.jsonl"), lines.join("\n") + "\n");
    editJson(path.join(d, "review-verdict.json"), (doc) => ({ ...doc, signal: SENTINEL }));
  }));
  for (const mode of ["require", "report"]) {
    const r = runLeg(s.dir, { base: s.base, head: s.head, mode });
    assert.equal(r.base.outputs.evidence_result, "fail");
    assert.ok(!r.log.includes(SENTINEL), r.log);
    assert.ok(!r.base.summary.includes(SENTINEL), r.base.summary);
  }
});

test("adding a file to an anchor dir present at the merge base fails with anchor-immutable", () => {
  const s = scenario(
    (dir) => writeFileSync(path.join(dir, ANCHORS, "run-x/FAFF-1/holdout.json"), "{}"),
    { baseBuild: (dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`) },
  );
  for (const mode of ["require", "report"]) {
    const r = runLeg(s.dir, { base: s.base, head: s.head, mode });
    assert.equal(r.base.code, 1, r.log);
    assert.ok(annotations(r.base.stdout, "error").some((l) => l.endsWith(`anchor-immutable ${ANCHORS}/run-x/FAFF-1/holdout.json`)), r.base.stdout);
  }
});

test("modifying or deleting a file of a committed anchor fails with anchor-immutable; anchors the base gained after the fork do not", () => {
  const edits = {
    modify: (dir) => writeFileSync(path.join(dir, ANCHORS, "run-x/FAFF-1/ac-checklist.json"), "{}"),
    delete: (dir) => unlinkSync(path.join(dir, ANCHORS, "run-x/FAFF-1/ac-checklist.json")),
  };
  for (const [name, edit] of Object.entries(edits)) {
    const s = scenario(edit, { baseBuild: (dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`) });
    for (const mode of ["require", "report"]) {
      const r = runLeg(s.dir, { base: s.base, head: s.head, mode });
      assert.equal(r.base.code, 1, `${name}/${mode}: ${r.log}`);
      assert.ok(annotations(r.base.stdout, "error").some((l) => l.endsWith(`anchor-immutable ${ANCHORS}/run-x/FAFF-1/ac-checklist.json`)), r.base.stdout);
    }
  }

  // main moves on after the fork and gains its own anchor; the PR's base sha is the new main tip.
  const { dir } = workRepo();
  const fork = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
  git(dir, ["checkout", "-q", "-b", "feature"]);
  placeAnchor(dir, `${ANCHORS}/run-pr/FAFF-2`);
  const head = commitAll(dir, "feature anchor");
  git(dir, ["checkout", "-q", "main"]);
  placeAnchor(dir, `${ANCHORS}/run-main/FAFF-3`);
  const base = commitAll(dir, "main anchor");
  git(dir, ["checkout", "-q", "feature"]);
  assert.notEqual(base, fork);
  for (const mode of ["require", "report"]) {
    const r = runLeg(dir, { base, head, mode });
    assert.equal(r.base.code, 0, r.log);
    assert.equal(r.base.outputs.verdict, "pass");
    assert.ok(!r.log.includes("run-main"), r.log);
  }
});

test("a failing git diff sets touched=error and a non-zero trusted derive both fail with anchor-discovery-failed in both modes", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`));
  const missing = "0123456789abcdef0123456789abcdef01234567";
  const failingDerive = path.join(TMP, "failing-derive.js");
  writeFileSync(failingDerive, `if (process.argv.includes("--derive-anchor-dirs")) process.exit(3);\n`);
  for (const mode of ["require", "report"]) {
    const r = runLeg(s.dir, { base: missing, head: s.head, mode });
    assert.equal(r.touched, "error");
    assert.equal(r.base.code, 1, r.log);
    assert.ok(annotations(r.base.stdout, "error").some((l) => l.includes("anchor-discovery-failed")));

    const d = runLeg(s.dir, { base: s.base, head: s.head, mode, trustedOverride: () => failingDerive });
    assert.equal(d.base.code, 1, d.log);
    assert.ok(annotations(d.base.stdout, "error").some((l) => l.includes("anchor-discovery-failed: trusted anchor discovery exited non-zero")));
  }
});

test("changed anchor paths that are too shallow, dropped by discovery, symlink-escaping or quoted fail with anchor-path-unvalidated", () => {
  const outside = (dir) => { mkdirSync(path.join(dir, "elsewhere"), { recursive: true }); writeFileSync(path.join(dir, "elsewhere/review-verdict.json"), "{}"); };
  const cases = {
    "too shallow": { build: (dir) => { mkdirSync(path.join(dir, ANCHORS, "run-x"), { recursive: true }); writeFileSync(path.join(dir, ANCHORS, "run-x/stray.json"), "{}"); }, path: `${ANCHORS}/run-x/stray.json` },
    "symlink escape": { build: (dir) => { outside(dir); mkdirSync(path.join(dir, ANCHORS, "run-x"), { recursive: true }); symlinkSync("../../../elsewhere", path.join(dir, ANCHORS, "run-x/FAFF-9")); }, path: `${ANCHORS}/run-x/FAFF-9` },
    "quoted non-ASCII name": { build: (dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-é`), path: `${ANCHORS}/run-x/FAFF-é/` },
  };
  for (const [name, c] of Object.entries(cases)) {
    const s = scenario(c.build);
    for (const mode of ["require", "report"]) {
      const r = runLeg(s.dir, { base: s.base, head: s.head, mode });
      assert.equal(r.base.code, 1, `${name}/${mode}: ${r.log}`);
      assert.ok(annotations(r.base.stdout, "error").some((l) => l.includes(`anchor-path-unvalidated ${c.path}`)), `${name}: ${r.base.stdout}`);
    }
  }
  // Traversal: git never records a ".." segment, so a traversal is a path the trusted derive drops.
  // A derive that drops every path stands in for it: nothing changed may land unjudged.
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`));
  const dropAll = path.join(TMP, "drop-all.js");
  writeFileSync(dropAll, `if (process.argv.includes("--derive-anchor-dirs")) process.exit(0);\n`);
  for (const mode of ["require", "report"]) {
    const r = runLeg(s.dir, { base: s.base, head: s.head, mode, trustedOverride: () => dropAll });
    assert.equal(r.base.code, 1, r.log);
    assert.ok(annotations(r.base.stdout, "error").some((l) => l.includes(`anchor-path-unvalidated ${ANCHORS}/run-x/FAFF-1/review-verdict.json`)));
  }
});

test("a run-level summary.md passes coverage; a symlink inside a new anchor dir fails with anchor-path-unvalidated", () => {
  const ok = scenario((dir) => {
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`);
    writeFileSync(path.join(dir, ANCHORS, "run-x/summary.md"), "# run summary\n");
  });
  const r = runLeg(ok.dir, { base: ok.base, head: ok.head, mode: "require" });
  assert.equal(r.base.code, 0, r.log);

  const bad = scenario((dir) => {
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`);
    symlinkSync("/etc/hostname", path.join(dir, ANCHORS, "run-x/FAFF-1/link.json"));
  });
  for (const mode of ["require", "report"]) {
    const b = runLeg(bad.dir, { base: bad.base, head: bad.head, mode });
    assert.equal(b.base.code, 1, b.log);
    assert.ok(annotations(b.base.stdout, "error").some((l) => l.endsWith(`anchor-path-unvalidated ${ANCHORS}/run-x/FAFF-1/link.json`)), b.base.stdout);
  }
});

test("anchor dir names carrying ::, a control character or | are neutralised in annotations and summary rows", () => {
  const s = scenario((dir) => {
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1::warning::x|y`, breakReview);
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-2\tz`);
  });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.base.code, 1, r.log);
  for (const line of r.base.stdout.split("\n")) {
    assert.ok(!line.slice(2).includes("::warning::x"), line);
    assert.ok(!line.includes("\t"), JSON.stringify(line));
  }
  assert.ok(r.base.summary.includes("FAFF-1: :warning: :x\\|y"), r.base.summary);
  assert.ok(r.base.stdout.includes("anchor-path-unvalidated .faff/anchors/run-x/FAFF-2 z/"), r.base.stdout);

  const percent = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-3%0Anext`, breakReview));
  const p = runLeg(percent.dir, { base: percent.base, head: percent.head, mode: "require" });
  assert.ok(annotations(p.base.stdout, "error").some((l) => l.includes("FAFF-3%250Anext")), p.base.stdout);
  assert.ok(p.base.summary.includes("FAFF-3%0Anext"), "the summary keeps the name readable");
  const rows = r.base.summary.split("\n").filter((l) => l.startsWith("| .faff"));
  for (const row of rows) assert.equal(row.split(/(?<!\\)\|/).length, 7, row);
});

const boundHoldout = (d) => writeFileSync(path.join(d, "holdout.json"), JSON.stringify({ ...JSON.parse(example("holdout-anchored")), issue: "FAFF-1" }));

test("under require a base CLI without holdout-binding warns that the holdout binding was not checked", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, boundHoldout), { flavour: "no-binding-cli" });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.resolve.outputs["holdout-binding"], "false");
  assert.ok(annotations(r.base.stdout, "warning").some((l) => l.endsWith("holdout binding not checked: base CLI predates FAFF-1261")));
  assert.match(r.base.summary, /- holdout binding not checked: base CLI predates FAFF-1261/);
  const rep = runLeg(s.dir, { base: s.base, head: s.head, mode: "report" });
  assert.ok(!rep.base.stdout.includes("holdout binding not checked"));
});

test("under require a base CLI listing holdout-binding emits no holdout binding warning", () => {
  const s = scenario((dir) => placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, boundHoldout));
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.resolve.outputs["holdout-binding"], "true");
  assert.ok(!r.base.stdout.includes("holdout binding not checked"));
  assert.ok(!r.base.summary.includes("holdout binding not checked"));
  assert.equal(r.base.outputs.verdict, "pass", r.log);
});

test("a .faffrc.yaml and FAFF_* variables in the PR checkout do not change the base leg's result", () => {
  const s = scenario((dir) => {
    placeAnchor(dir, `${ANCHORS}/run-x/FAFF-1`, breakReview);
    writeFileSync(path.join(dir, ".faffrc.yaml"), "tracking:\n  spec_docs_path: elsewhere\nevidence:\n  bundle: ./nope\n");
  });
  const plain = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  const noisy = runLeg(s.dir, { base: s.base, head: s.head, mode: "require", extraEnv: { FAFF_RUN_DIR: s.dir, FAFF_ROOT: s.dir, FAFF_EVIDENCE_BUNDLE: s.dir, NODE_OPTIONS: "" } });
  assert.equal(plain.base.code, noisy.base.code);
  assert.deepEqual(plain.base.outputs, noisy.base.outputs);
  const table = (t) => t.split("\n").filter((l) => l.startsWith("|")).join("\n");
  assert.equal(table(plain.base.summary), table(noisy.base.summary));
});

test("a PR that touches no anchors skips the leg and keeps today's verdict", () => {
  const s = scenario((dir) => writeFileSync(path.join(dir, "README.md"), "changed\n"));
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.touched, "false");
  assert.equal(r.base, null);
  assert.equal(actionVerdict({ touched: "false", baseOutcome: "skipped", baseVerdict: undefined, headVerdict: "no-artifacts" }), "no-artifacts");
});

test("CODEOWNERS lists /.github/ and /verification/ with human owners only", () => {
  const text = readFileSync(path.join(repoRoot, ".github/CODEOWNERS"), "utf8");
  const rules = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).map((l) => l.trim().split(/\s+/));
  const byPath = Object.fromEntries(rules.map(([p, ...owners]) => [p, owners]));
  assert.deepEqual(Object.keys(byPath).sort(), ["/.github/", "/verification/"]);
  const { readRunnerGhConfig } = require("../plugin/skills/faff/bin/lib/merge-gate.js");
  const runner = readRunnerGhConfig().configuredLogin;
  for (const owners of Object.values(byPath)) {
    assert.ok(owners.length > 0);
    for (const owner of owners) {
      assert.match(owner, /^@[A-Za-z0-9-]+$/, "a user login, never a team or an app");
      assert.ok(!owner.endsWith("[bot]"));
      if (runner) assert.notEqual(owner.slice(1).toLowerCase(), runner.toLowerCase(), "the runner is never a code owner");
    }
  }
});

test("FAFF-1263's report-only leg is unchanged without --require-evidence-schema and gates with it", () => {
  const root = mkdtempSync(path.join(TMP, "gov-"));
  const legacy = path.join(root, "legacy");
  const run = mkChainedRun(path.join(root, "legacy-run"));
  writeEvidence(run, "v03");
  assert.equal(runCli(["events", "anchor", "--run-dir", run, "--issue", "FAFF-1", "--dest", legacy]).code, 0);
  // The mint refuses a legacy anchor, so the legacy shape is made by rewriting a minted one.
  rmSync(path.join(legacy, "run-ledger.json"));
  writeFileSync(path.join(legacy, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(path.join(legacy, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
  const invalid = path.join(root, "invalid");
  cpSync(conformingAnchor(), invalid, { recursive: true });
  breakReview(invalid);
  const conforming = conformingAnchor();
  const gov = (dir, extra = []) => {
    const r = runCli(["governance-check", "--anchor-dir", dir, "--json", ...extra]);
    return { code: r.code, verdict: JSON.parse(r.stdout) };
  };

  for (const dir of [legacy, invalid, conforming]) {
    const off = gov(dir);
    assert.equal(off.verdict.runs[0].legs.evidence_schema.report_only, true);
    assert.equal("pass" in off.verdict.runs[0].legs.evidence_schema, false);
    assert.ok(!off.verdict.reasons.some((r) => r.includes("evidence_schema")));
  }
  assert.equal(gov(conforming, ["--require-evidence-schema"]).code, 0);
  for (const [dir, status] of [[legacy, "legacy"], [invalid, "fail"]]) {
    const on = gov(dir, ["--require-evidence-schema"]);
    assert.equal(on.code, 1);
    assert.equal(on.verdict.pass, false);
    assert.equal(on.verdict.runs[0].legs.evidence_schema.report_only, false);
    assert.equal(on.verdict.runs[0].legs.evidence_schema.pass, false);
    assert.ok(on.verdict.reasons.some((r) => r.includes(`evidence_schema — ${status}`)), on.verdict.reasons.join("\n"));
  }

  const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
  const gc = require("../plugin/skills/faff/bin/lib/governance-check.js");
  const real = evidence.validateAnchorDir;
  try {
    evidence.validateAnchorDir = () => { throw new TypeError(`${SENTINEL} boom`); };
    const on = gc.evaluateAnchorDir(conforming, "pass", "L3", { requireEvidenceSchema: true });
    assert.equal(on.legs.evidence_schema.status, "error");
    assert.equal(on.pass, false);
    assert.ok(gc.buildReasons(on).some((r) => r.includes("evidence_schema — error")));
    assert.ok(!JSON.stringify(on).includes(SENTINEL));
    const off = gc.evaluateAnchorDir(conforming, "pass", "L3");
    assert.equal(off.pass, on.legs.integrity.pass && on.legs.merge_floor.pass);
  } finally {
    evidence.validateAnchorDir = real;
  }
});

test("faff evidence capabilities --json prints the documented object", () => {
  const r = runCli(["evidence", "capabilities", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { validate: ["require-evidence-schema", "candidate-schemas", "holdout-binding"] });
});

