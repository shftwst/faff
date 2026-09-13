// FAFF-1038 — negative fixture for the validate-macos test-count guard's TAP-summary fix.
//
// Extracts the REAL `validate-macos` step body out of `.github/workflows/validate.yml` via
// gates.js's `extractRunCommandsWithContext` (the same helper test/gates-ci-source.test.mjs
// already reuses for the same file), then executes that body under `bash -e` — the runner's own
// default shell for a step declaring no `shell:` — against a stub `node` on PATH and a synthetic
// `test/impure/` manifest clearing the file-count floor. Anchoring to the real extracted text (not
// a hand-copied script) means this fixture reads whatever validate.yml actually ships, so a future
// edit to the step body is exercised here too.
//
// AC1/AC2: a summary-less log (no "# tests N" line) must print exactly one pre-summary ::error::
// and exit non-zero (node's own status, floored to 1 when node itself exited 0).
// AC3: the existing mass-skip guard (a low "# tests N" count) is unchanged.
// AC4/AC5: a summarised, at-or-above-floor run passes node's status through with no ::error::.
// AC6: the node invocation carries --test-reporter=tap.
// AC7: this file demonstrates BOTH directions — the fixed body passes AC1/AC2, and a
// mechanically-reconstructed PRE-FIX body (today's shipped bug) reproduces the exact regression
// the ticket reports: exit 1, no annotation, node's real 137 discarded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(repoRoot, ".github", "workflows", "validate.yml");
const require = createRequire(import.meta.url);
const { extractRunCommandsWithContext } = require("../plugin/skills/faff/bin/lib/gates.js");

// Pull the validate-macos step body's command lines out of the REAL workflow text (not a copy).
function extractValidateMacosLines(workflowText) {
  const records = extractRunCommandsWithContext(workflowText);
  const lines = records.filter((r) => r.job === "validate-macos").map((r) => r.command);
  assert.ok(lines.length > 0, "fixture precondition: validate-macos must have a non-empty run: step body");
  return lines;
}

// Splices the real (fixed) body back to today's shipped bug, for the AC7 "remove the branch, it
// reddens" demonstration. Matches on the line's own text, not a line number, so this fixture
// survives an unrelated future edit above the splice point instead of erroring on its own
// precondition.
function toPreFixBody(fixedLines, logPath, floorLine) {
  const idx = fixedLines.findIndex((l) => l.startsWith("summary_line=$(grep"));
  assert.ok(idx >= 0, "fixture precondition: the fixed no-summary branch must be present to splice out");
  const prefix = fixedLines.slice(0, idx);
  // `floorLine` (e.g. "test_floor=50") is extracted from the REAL fixed body, not hardcoded, so a
  // future change to the floor value can't silently desync this reconstruction from the shipped
  // guard (adversarial review finding).
  const preFixTail = [
    `tests_ran=$(grep -oE '^# tests [0-9]+' ${logPath} | tail -1 | grep -oE '[0-9]+$')`,
    "tests_ran=${tests_ran:-0}",
    floorLine,
    'if [ "$tests_ran" -lt "$test_floor" ]; then',
    '  echo "::error::only ${tests_ran} impure tests ran (expected at least ${test_floor}) — tests likely mass-skipped; see the log above"',
    "  exit 1",
    "fi",
    'exit "$test_status"',
  ];
  return [...prefix, ...preFixTail].join("\n");
}

// Sandbox: a cwd with >=8 stub test/impure/*.test.mjs (clears the file_floor=8 guard unrelated to
// this fix) and a stub `node` on PATH driven by env vars, so each scenario controls exactly what
// the "node --test | tee" pipeline writes/exits with, without running a real test suite. The stub
// also records its own argv (`$dir/node-argv.txt`) so AC6 can assert the flag actually reaches the
// invocation, not merely that the source text contains it (adversarial review finding).
function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "faff-1038-macos-guard-"));
  const impureDir = join(dir, "test", "impure");
  mkdirSync(impureDir, { recursive: true });
  for (let i = 0; i < 8; i += 1) writeFileSync(join(impureDir, `stub-${i}.test.mjs`), "// stub\n");

  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const nodeStub = join(binDir, "node");
  const argvLog = join(dir, "node-argv.txt");
  writeFileSync(
    nodeStub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${JSON.stringify(argvLog)}\nprintf '%b' "$NODE_STUB_STDOUT"\nexit "\${NODE_STUB_EXIT:-0}"\n`,
  );
  chmodSync(nodeStub, 0o755);
  return { dir, binDir, argvLog };
}

// Runs an extracted step body under bash -e, with node stubbed to emit `stdout` and exit `exitCode`.
// `logPath` (the real, extracted target — see below) is cleaned up before/after so runs never see a
// stale file. Returns `argv` (the stub's own recorded argv) so a test can assert flag pass-through,
// not just source-text presence (adversarial review finding).
function run(body, stdout, exitCode, logPath) {
  const { dir, binDir, argvLog } = makeSandbox();
  rmSync(logPath, { force: true });
  writeFileSync(join(dir, "step.sh"), body);
  try {
    const out = execFileSync("bash", ["-e", join(dir, "step.sh")], {
      cwd: dir,
      env: { PATH: `${binDir}:${process.env.PATH}`, NODE_STUB_STDOUT: stdout, NODE_STUB_EXIT: String(exitCode) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: out.toString(), argv: readFileSync(argvLog, "utf8") };
  } catch (err) {
    let argv = "";
    try { argv = readFileSync(argvLog, "utf8"); } catch { /* node stub never ran (e.g. glob/file-floor exit) */ }
    return { code: err.status, stdout: String(err.stdout || ""), argv };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(logPath, { force: true });
  }
}

const workflowText = readFileSync(workflowPath, "utf8");
const fixedLines = extractValidateMacosLines(workflowText);
const fixedBody = fixedLines.join("\n");

// Derived from the REAL extracted body, not hardcoded, so a future rename/edit can't desync the
// fixture's own cleanup/reconstruction from what the step actually does (adversarial review finding).
const teeLine = fixedLines.find((l) => l.includes("| tee "));
assert.ok(teeLine, "fixture precondition: the node invocation must pipe through tee to a log path");
const logPath = teeLine.match(/\|\s*tee\s+(\S+)/)[1];
const floorLine = fixedLines.find((l) => l.startsWith("test_floor="));
assert.ok(floorLine, "fixture precondition: the mass-skip test_floor= line must be present");

test("AC1: summary-less log + node exit 137 -> exactly one pre-summary ::error:: (not mass-skip), exits 137", () => {
  const result = run(fixedBody, "TAP version 13\n", 137, logPath);
  assert.equal(result.code, 137);
  const errorLines = result.stdout.split("\n").filter((l) => l.includes("::error::"));
  assert.equal(errorLines.length, 1, `expected exactly one ::error:: line, got: ${JSON.stringify(errorLines)}`);
  assert.ok(errorLines[0].includes("before the test runner emitted its summary line"), errorLines[0]);
  assert.ok(!errorLines[0].includes("mass-skipped"), "must be distinguishable from the mass-skip annotation");
});

test("AC2 (holdout scenario, verified here too): summary-less log + node exit 0 -> same pre-summary ::error::, exits non-zero (floored)", () => {
  const result = run(fixedBody, "TAP version 13\n", 0, logPath);
  assert.notEqual(result.code, 0, "a summary-less log must never report green");
  assert.equal(result.code, 1, "test_status of 0 is floored to 1");
  const errorLines = result.stdout.split("\n").filter((l) => l.includes("::error::"));
  assert.equal(errorLines.length, 1);
  assert.ok(errorLines[0].includes("before the test runner emitted its summary line"), errorLines[0]);
});

test("AC3: mass-skip guard unchanged — '# tests 3' + node exit 1 -> mass-skip ::error::, exits 1", () => {
  const result = run(fixedBody, "TAP version 13\n# tests 3\n", 1, logPath);
  assert.equal(result.code, 1);
  const errorLines = result.stdout.split("\n").filter((l) => l.includes("::error::"));
  assert.equal(errorLines.length, 1);
  assert.ok(errorLines[0].includes("only 3 impure tests ran (expected at least 50)"), errorLines[0]);
});

// Asserts no GitHub Actions workflow-command annotation of any kind (::error::/::warning::/
// ::notice::) — not merely the absence of the "::error::" substring, so a future edit that changes
// the annotation's severity/shape but still emits *something* is caught (adversarial review finding;
// the spec's AC4/AC5 claim is "no annotation prints", which this checks directly).
function annotationLines(stdout) {
  return stdout.split("\n").filter((l) => /^::(error|warning|notice)::/.test(l));
}

test("AC4: summarised at-floor run + node exit 7 -> passes status through, no annotation", () => {
  const result = run(fixedBody, "TAP version 13\n# tests 60\n", 7, logPath);
  assert.equal(result.code, 7);
  assert.deepEqual(annotationLines(result.stdout), [], result.stdout);
});

test("AC5: summarised at-floor run + node exit 0 -> exits 0, no annotation", () => {
  const result = run(fixedBody, "TAP version 13\n# tests 60\n", 0, logPath);
  assert.equal(result.code, 0);
  assert.deepEqual(annotationLines(result.stdout), [], result.stdout);
});

test("AC6: the node --test invocation carries --test-reporter=tap, AND the flag actually reaches node's argv", () => {
  const invocation = fixedLines.find((l) => l.startsWith("node --import"));
  assert.ok(invocation, "fixture precondition: the node --test invocation line must be present");
  assert.ok(invocation.includes("--test-reporter=tap"), invocation);
  // Source-text presence alone doesn't prove the flag survives bash -e execution (a future edit
  // could move it into a variable, or wrap the invocation in a function that drops unknown flags) —
  // so also execute the real body and assert the stub `node` actually received the flag on its own
  // argv (adversarial review finding).
  const result = run(fixedBody, "TAP version 13\n# tests 60\n", 0, logPath);
  assert.equal(result.code, 0, "sandbox precondition: this run must reach the stub node");
  assert.match(result.argv, /--test-reporter=tap/, `stub node's recorded argv did not carry the flag: ${JSON.stringify(result.argv)}`);
  // The node-24 behavioural half of AC6 (docker node:24 writes "# tests N" with this flag, and
  // does not without it) requires a docker runtime unavailable in this sandbox — verified manually
  // per the spec's DESIGN DECISION RATIONALE; not re-asserted here.
});

test("AC7: removing the no-summary branch reddens AC1's scenario exactly as the ticket reports (regression lock)", () => {
  const preFixBody = toPreFixBody(fixedLines, logPath, floorLine);

  const preFix = run(preFixBody, "TAP version 13\n", 137, logPath);
  assert.equal(preFix.code, 1, "today's shipped bug: node's real 137 is discarded, generic exit 1");
  assert.ok(!preFix.stdout.includes("::error::"), "today's shipped bug: no annotation ever prints");

  const fixed = run(fixedBody, "TAP version 13\n", 137, logPath);
  assert.equal(fixed.code, 137, "restoring the fix: node's real status is preserved");
  assert.ok(fixed.stdout.includes("::error::"), "restoring the fix: the pre-summary annotation prints");
});
