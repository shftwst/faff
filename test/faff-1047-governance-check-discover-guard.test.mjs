// FAFF-1047 — negative fixture for the governance-check "Discover carried run dirs" step's
// errexit-abort guard (the same shape FAFF-1038 fixed at validate.yml:256).
//
// Extracts the REAL `discover` step body out of `.github/actions/governance-check/action.yml`
// via gates.js's `extractRunCommandsWithContext` (the same helper test/gates-ci-macos-guard.test.mjs
// reuses for validate.yml), substitutes the step's `${{ }}` GitHub Actions expression templating
// with concrete test values, stubs `git diff --name-only` on PATH to emit a synthetic base...head
// diff, and executes that body under `bash -eo pipefail` — the step's own declared `set -euo
// pipefail` plus the shell the step's `shell: bash` line names. Anchoring to the real extracted
// text (not a hand-copied script) means this fixture reads whatever action.yml actually ships, so
// a future edit to the step body is exercised here too.
//
// Trigger scenario: the alphabetically-last changed run-dir path is a DELETION (absent on disk at
// HEAD) with at least one earlier changed run-dir path that still exists. Pre-fix, the while
// loop's final iteration fails `[ -d "$d" ]`, pipefail surfaces the non-zero, and the `DIRS=`
// assignment trips errexit before the `dirs`/`found` outputs are written. Post-fix, `|| true`
// neutralises the status so the step reaches its outputs with the same filtered `DIRS` content.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const actionPath = join(repoRoot, ".github", "actions", "governance-check", "action.yml");
const require = createRequire(import.meta.url);
const { extractRunCommandsWithContext } = require("../plugin/skills/faff/bin/lib/gates.js");

const ARTIFACTS_PATH = "artifacts";
const BASE_SHA = "base-sha-test";
const HEAD_SHA = "head-sha-test";

// Pull the "Discover carried run dirs" step body's command lines out of the REAL action.yml text
// (not a copy). The composite action declares no `jobs:` block, so extractRunCommandsWithContext's
// step_name capture (independent of the jobs-block state machine) is what makes this work.
function extractDiscoverLines(actionText) {
  const records = extractRunCommandsWithContext(actionText);
  const lines = records.filter((r) => r.step_name === "Discover carried run dirs").map((r) => r.command);
  assert.ok(lines.length > 0, "fixture precondition: the discover step must have a non-empty run: step body");
  return lines;
}

// Substitutes the step's `${{ inputs.artifacts-path }}` / `${{ github.event.pull_request.base.sha
// }}` / `${{ github.event.pull_request.head.sha }}` GitHub Actions expression templating with
// concrete test values, so the extracted text becomes plain, executable bash.
function templateFill(lines) {
  return lines
    .map((l) =>
      l
        .replaceAll("${{ inputs.artifacts-path }}", ARTIFACTS_PATH)
        .replaceAll("${{ github.event.pull_request.base.sha }}", BASE_SHA)
        .replaceAll("${{ github.event.pull_request.head.sha }}", HEAD_SHA),
    )
    .join("\n");
}

// Splices the real (fixed) lines back to today's shipped bug — drops the trailing `|| true` off
// the line-150 capture — for the "remove the guard, it reddens" regression-lock demonstration.
// Matches on the line's own text (the `DIRS="$(` prefix), not a line number, so this fixture
// survives an unrelated future edit elsewhere in the step instead of erroring on its own
// precondition.
function toPreFixLines(fixedLines) {
  const idx = fixedLines.findIndex((l) => l.trimStart().startsWith('DIRS="$('));
  assert.ok(idx >= 0, "fixture precondition: the DIRS= capture line must be present to unguard");
  const capture = fixedLines[idx];
  assert.ok(capture.endsWith(' || true)"'), "fixture precondition: the shipped capture must end in the `|| true` guard");
  const preFixCapture = capture.slice(0, -' || true)"'.length) + ')"';
  const out = [...fixedLines];
  out[idx] = preFixCapture;
  return out;
}

// Sandbox: a cwd with a stub `git` on PATH (driven by an env var naming the synthetic diff output)
// and a run dir tree under ARTIFACTS_PATH matching the scenario ($dir/<ARTIFACTS_PATH>/<run>/...).
function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "faff-1047-discover-guard-"));
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const gitStub = join(binDir, "git");
  // The stub answers only `git diff --name-only <base> <head> -- <path>` (the one invocation the
  // step makes) by printing $GIT_STUB_DIFF verbatim, exiting 0.
  writeFileSync(gitStub, `#!/usr/bin/env bash\nprintf '%b' "$GIT_STUB_DIFF"\nexit 0\n`);
  chmodSync(gitStub, 0o755);
  return { dir, binDir };
}

function run(body, diffLines, { dir, binDir }) {
  const outputPath = join(dir, "github-output.txt");
  writeFileSync(outputPath, "");
  writeFileSync(join(dir, "step.sh"), body);
  try {
    execFileSync("bash", ["-eo", "pipefail", join(dir, "step.sh")], {
      cwd: dir,
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        GIT_STUB_DIFF: diffLines.join("\n") + (diffLines.length ? "\n" : ""),
        GITHUB_OUTPUT: outputPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, outputs: parseOutputs(readFileSync(outputPath, "utf8")) };
  } catch (err) {
    let outputs = {};
    try { outputs = parseOutputs(readFileSync(outputPath, "utf8")); } catch { /* file gone with the sandbox */ }
    return { code: err.status, outputs, stderr: String(err.stderr || "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Parses the $GITHUB_OUTPUT file format: `key=value` lines, plus `key<<EOF\n...\nEOF` heredoc
// blocks for multiline values (the `dirs` output's own shape).
function parseOutputs(text) {
  const out = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heredoc = /^([A-Za-z_][A-Za-z0-9_]*)<<([A-Za-z0-9]+)$/.exec(line);
    if (heredoc) {
      const [, key, marker] = heredoc;
      const body = [];
      i += 1;
      while (i < lines.length && lines[i] !== marker) { body.push(lines[i]); i += 1; }
      out[key] = body.join("\n");
      i += 1;
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
    i += 1;
  }
  return out;
}

const actionText = readFileSync(actionPath, "utf8");
const fixedLines = extractDiscoverLines(actionText);
const fixedBody = templateFill(fixedLines);
const preFixBody = templateFill(toPreFixLines(fixedLines));

test("trigger input: last-changed run dir deleted, one earlier dir exists -> exits 0, dirs excludes the deletion, found=true", () => {
  const sandbox = makeSandbox();
  const existingRun = join(sandbox.dir, ARTIFACTS_PATH, "aaa-run");
  mkdirSync(existingRun, { recursive: true });
  const existingPath = `${ARTIFACTS_PATH}/aaa-run/run-ledger.json`;
  const deletedPath = `${ARTIFACTS_PATH}/zzz-deleted/run-ledger.json`; // sorts alphabetically last
  const result = run(fixedBody, [existingPath, deletedPath], sandbox);
  assert.equal(result.code, 0, `expected exit 0, got ${result.code} (stderr: ${result.stderr})`);
  assert.equal(result.outputs.dirs, `${ARTIFACTS_PATH}/aaa-run`, `dirs mismatch: ${JSON.stringify(result.outputs)}`);
  assert.equal(result.outputs.found, "true");
});

test("empty CHANGED (no artifacts in the diff) -> unchanged: exits 0, dirs empty, found=false", () => {
  const sandbox = makeSandbox();
  const result = run(fixedBody, [], sandbox);
  assert.equal(result.code, 0, `expected exit 0, got ${result.code} (stderr: ${result.stderr})`);
  assert.equal(result.outputs.dirs, "", `dirs mismatch: ${JSON.stringify(result.outputs)}`);
  assert.equal(result.outputs.found, "false");
});

test("last-changed dir present on disk -> unchanged: exits 0, dirs lists it, found=true", () => {
  const sandbox = makeSandbox();
  const existingRun = join(sandbox.dir, ARTIFACTS_PATH, "only-run");
  mkdirSync(existingRun, { recursive: true });
  const result = run(fixedBody, [`${ARTIFACTS_PATH}/only-run/run-ledger.json`], sandbox);
  assert.equal(result.code, 0, `expected exit 0, got ${result.code} (stderr: ${result.stderr})`);
  assert.equal(result.outputs.dirs, `${ARTIFACTS_PATH}/only-run`);
  assert.equal(result.outputs.found, "true");
});

test("pure-cleanup-only holdout case: ONLY changed run-dir path is a single deletion -> exits 0, dirs empty, found=false", () => {
  const sandbox = makeSandbox();
  const result = run(fixedBody, [`${ARTIFACTS_PATH}/only-deleted/run-ledger.json`], sandbox);
  assert.equal(result.code, 0, `expected exit 0, got ${result.code} (stderr: ${result.stderr})`);
  assert.equal(result.outputs.dirs, "", `dirs mismatch: ${JSON.stringify(result.outputs)}`);
  assert.equal(result.outputs.found, "false");
});

test("regression lock: removing the `|| true` guard reproduces the ticket's reported abort on the trigger input", () => {
  const sandbox = makeSandbox();
  const existingRun = join(sandbox.dir, ARTIFACTS_PATH, "aaa-run");
  mkdirSync(existingRun, { recursive: true });
  const existingPath = `${ARTIFACTS_PATH}/aaa-run/run-ledger.json`;
  const deletedPath = `${ARTIFACTS_PATH}/zzz-deleted/run-ledger.json`;

  const preFix = run(preFixBody, [existingPath, deletedPath], sandbox);
  assert.notEqual(preFix.code, 0, "today's shipped bug: the step must abort (errexit) on this trigger input");
  assert.equal(preFix.outputs.dirs, undefined, "pre-fix: the outputs must never be written (aborted before line 154)");
  assert.equal(preFix.outputs.found, undefined, "pre-fix: the outputs must never be written (aborted before line 154)");

  const fixedSandbox = makeSandbox();
  mkdirSync(join(fixedSandbox.dir, ARTIFACTS_PATH, "aaa-run"), { recursive: true });
  const fixed = run(fixedBody, [existingPath, deletedPath], fixedSandbox);
  assert.equal(fixed.code, 0, "restoring the fix: the step reaches its outputs");
  assert.equal(fixed.outputs.dirs, `${ARTIFACTS_PATH}/aaa-run`);
  assert.equal(fixed.outputs.found, "true");
});
