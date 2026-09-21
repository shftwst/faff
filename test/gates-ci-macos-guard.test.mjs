// FAFF-1049 — validate-macos: a pre-first-test hang now names its file and fails fast.
//
// The prior whole-manifest single `node --test "${matched[@]}"` invocation buffered TAP output
// until a test resolved, so a hang before the first test (module load, or the very first test's
// setup) named no file — nothing to go on but `TAP version 13` and a 15-minute job-timeout cancel.
// This file extracts the REAL `validate-macos` step body out of `.github/workflows/validate.yml`
// via gates.js's `extractRunCommandsWithContext` (the same helper test/gates-ci-source.test.mjs and
// the prior FAFF-1038 fixture reuse), then executes that body under `bash -e` — the runner's own
// default shell for a step declaring no `shell:` — against a stub `node` on PATH and a synthetic
// `test/impure/` manifest. Anchoring to the real extracted text (not a hand-copied script) means
// this fixture reads whatever validate.yml actually ships, so a future edit is exercised here too.
//
// AC1: the manifest runs PER FILE — one `node --test` invocation per matched file, in a loop, not
//      a single whole-array invocation.
// AC2: each per-file invocation carries --test-timeout=120000.
// AC3: each per-file invocation is bounded by a portable wall-clock that SIGKILLs after the bound
//      and uses no `timeout` binary (macOS runners don't ship GNU timeout) — asserted structurally,
//      and behaviourally via a shortened bound (`PER_FILE_WALL_CLOCK_SECS`, override-only — the
//      real job never sets it, so production always gets the literal 300s).
// AC4: a synthetic file that hangs before emitting a subtest names itself in the log and the step
//      exits non-zero (not a silent pass, not a bare cancel).
// AC5: the aggregate test-count floor (>=50, summed across files) and file-count floor (>=8) still
//      fire on their failure fixtures, and FAFF-1038's "died before its summary line" detection
//      still fires — now per file, naming the specific file rather than the whole run.
// AC6 (test/ci-workflow-timeout-bounds.test.mjs): unaffected by this change — this ticket touches
//      the `validate-macos` step body only, never the job-level `timeout-minutes`.
// AC7 (a healthy run still passes 138/138 within budget): verified by this change's own PR going
//      green, not re-asserted here — no real macOS hang is reproduced by this suite.

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

const workflowText = readFileSync(workflowPath, "utf8");
const fixedLines = extractValidateMacosLines(workflowText);
const fixedBody = fixedLines.join("\n");
const nonCommentLines = fixedLines.filter((l) => !l.trim().startsWith("#"));

// A stub `node` driven entirely by per-target sidecar files (`<target>.stdout` / `.exit` / `.hang`),
// so each scenario controls exactly what "node --test <file>" does without running a real test
// suite. The stub also appends its own argv (one line per invocation) to a shared log, so a test can
// assert invocation SHAPE (one file per call, the flag actually present) — not merely source-text
// presence (adversarial review finding pattern carried over from the FAFF-1038 fixture).
function writeNodeStub(binDir, argvLog) {
  const nodeStub = join(binDir, "node");
  writeFileSync(
    nodeStub,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}`,
      'target="${@: -1}"',
      'if [ -f "${target}.hang" ]; then sleep 999; exit 0; fi',
      'if [ -f "${target}.stdout" ]; then cat "${target}.stdout"; fi',
      "ec=0",
      '[ -f "${target}.exit" ] && ec=$(cat "${target}.exit")',
      'exit "$ec"',
      "",
    ].join("\n"),
  );
  chmodSync(nodeStub, 0o755);
}

// Builds a sandbox cwd with `test/impure/<name>` for every entry in `files`, padded (with trivial
// clean-passing stubs) to at least 8 so a scenario not aimed at the file-count floor never trips it
// by accident. Each entry optionally carries `.stdout` / `.exit` / `.hang` sidecars the stub reads.
function makeSandbox(files) {
  const dir = mkdtempSync(join(tmpdir(), "faff-1049-macos-loop-"));
  const impureDir = join(dir, "test", "impure");
  mkdirSync(impureDir, { recursive: true });
  const all = [...files];
  let pad = 0;
  while (all.length < 8) {
    all.push({ name: `pad-${pad}.test.mjs`, stdout: "TAP version 13\n# tests 10\n", exit: 0 });
    pad += 1;
  }
  for (const f of all) {
    const target = join(impureDir, f.name);
    writeFileSync(target, "// stub\n");
    if (f.hang) writeFileSync(`${target}.hang`, "");
    if (f.stdout !== undefined) writeFileSync(`${target}.stdout`, f.stdout);
    if (f.exit !== undefined) writeFileSync(`${target}.exit`, String(f.exit));
  }
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const argvLog = join(dir, "node-argv.txt");
  writeFileSync(argvLog, "");
  writeNodeStub(binDir, argvLog);
  return { dir, binDir, argvLog };
}

// Runs the real extracted step body under `bash -e` in a fresh sandbox. `env` merges over the
// sandboxed PATH (always the stub node) — used to shorten PER_FILE_WALL_CLOCK_SECS for the kill
// fixtures, the one knob the production step never sets (it always gets the literal 300s default).
function run(files, env = {}) {
  const { dir, binDir, argvLog } = makeSandbox(files);
  writeFileSync(join(dir, "step.sh"), fixedBody);
  try {
    const out = execFileSync("bash", ["-e", join(dir, "step.sh")], {
      cwd: dir,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20000,
    });
    return { code: 0, stdout: out.toString(), argv: readFileSync(argvLog, "utf8") };
  } catch (err) {
    let argv = "";
    try { argv = readFileSync(argvLog, "utf8"); } catch { /* stub never ran (e.g. file-floor exit) */ }
    return { code: err.status, stdout: String(err.stdout || ""), argv };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Asserts no GitHub Actions workflow-command annotation of any kind (::error::/::warning::/
// ::notice::) — not merely the absence of the "::error::" substring (FAFF-1038 fixture pattern).
function annotationLines(stdout) {
  return stdout.split("\n").filter((l) => /^::(error|warning|notice)::/.test(l));
}

// --- AC1: per-file invocation, not a single whole-array call ---

test("AC1 (structural): the step loops over matched files, invoking node once per file via $f", () => {
  assert.ok(
    nonCommentLines.some((l) => l.trim() === 'for f in "${matched[@]}"; do'),
    "expected a per-file for-loop over matched",
  );
  const invocation = nonCommentLines.find((l) => l.includes('--test "$f"'));
  assert.ok(invocation, "expected the node invocation to target the loop variable $f, not the whole array");
  assert.ok(
    !nonCommentLines.some((l) => l.includes('--test "${matched[@]}"')),
    "the old whole-array single invocation must be gone",
  );
});

test("AC1 (behavioural): node is invoked once per matched file, each call naming exactly one file", () => {
  const files = [
    { name: "a.test.mjs", stdout: "TAP version 13\n# tests 10\n", exit: 0 },
    { name: "b.test.mjs", stdout: "TAP version 13\n# tests 10\n", exit: 0 },
  ];
  const result = run(files);
  assert.equal(result.code, 0, result.stdout);
  const argvLines = result.argv.trim().split("\n").filter(Boolean);
  assert.equal(argvLines.length, 8, "one node invocation per matched file (8, after floor padding)");
  for (const line of argvLines) {
    const fileArgs = line.split(/\s+/).filter((tok) => tok.includes(".test.mjs"));
    assert.equal(fileArgs.length, 1, `each invocation must name exactly one file, got: ${line}`);
  }
});

// --- AC2: --test-timeout=120000 on every per-file invocation ---

test("AC2 (structural + behavioural): the node invocation carries --test-timeout=120000, and it reaches node's real argv", () => {
  const invocation = nonCommentLines.find((l) => l.startsWith("node --import"));
  assert.ok(invocation, "fixture precondition: the per-file node invocation line must be present");
  assert.match(invocation, /--test-timeout=(\$\{test_timeout_ms\}|120000)/, invocation);
  const files = [{ name: "a.test.mjs", stdout: "TAP version 13\n# tests 10\n", exit: 0 }];
  const result = run(files);
  assert.equal(result.code, 0, result.stdout);
  const argvLines = result.argv.trim().split("\n").filter(Boolean);
  assert.ok(argvLines.length > 0, "sandbox precondition: the stub must have run");
  for (const line of argvLines) {
    assert.match(line, /--test-timeout=120000/, `stub node's recorded argv did not carry the flag: ${line}`);
  }
});

// --- AC3: portable wall-clock SIGKILL, no `timeout` binary ---

test("AC3 (structural): no `timeout` binary is invoked as a command — a portable background+watchdog SIGKILL pattern only", () => {
  const usesTimeoutBinary = nonCommentLines.some((l) => /(^|[|;&]|\s)timeout(\s|$)/.test(l));
  assert.ok(!usesTimeoutBinary, "must not shell out to the `timeout` binary (unavailable on macos-latest)");
  assert.ok(nonCommentLines.some((l) => l.includes("kill -9")), "expected a SIGKILL in the watchdog");
  assert.ok(nonCommentLines.some((l) => l.trim().startsWith("sleep ")), "expected a sleep-based wall-clock");
});

test("AC3 (behavioural): a hanging file is killed after the (shortened) wall-clock bound, not run unbounded", () => {
  const files = [{ name: "hangs.test.mjs", hang: true }];
  const start = Date.now();
  const result = run(files, { PER_FILE_WALL_CLOCK_SECS: "1" });
  const elapsedMs = Date.now() - start;
  assert.notEqual(result.code, 0, "a killed file must not report green");
  assert.ok(elapsedMs < 15000, `expected the watchdog to cap the wait well under the sandbox timeout, took ${elapsedMs}ms`);
  assert.ok(result.stdout.includes("hangs.test.mjs"), "the killed file must be named in the log");
  assert.match(result.stdout, /killed \(SIGKILL\)/, result.stdout);
});

// --- AC4: a pre-first-test hang names its file and fails fast (not silent, not a bare cancel) ---

test("AC4: a synthetic file that hangs before emitting a subtest names itself and the step exits non-zero", () => {
  const files = [{ name: "silent-hang.test.mjs", hang: true }];
  const result = run(files, { PER_FILE_WALL_CLOCK_SECS: "1" });
  assert.notEqual(result.code, 0);
  const errorLines = annotationLines(result.stdout);
  assert.ok(
    errorLines.some((l) => l.includes("silent-hang.test.mjs") && l.includes("SIGKILL")),
    result.stdout,
  );
});

// --- AC5: aggregate floors + per-file FAFF-1038 pre-summary guard, unchanged in kind ---

test("AC5a: the file-count floor (>=8) is unchanged and still fires below it", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-1049-floor-"));
  const impureDir = join(dir, "test", "impure");
  mkdirSync(impureDir, { recursive: true });
  for (let i = 0; i < 3; i += 1) writeFileSync(join(impureDir, `stub-${i}.test.mjs`), "// stub\n");
  writeFileSync(join(dir, "step.sh"), fixedBody);
  try {
    execFileSync("bash", ["-e", join(dir, "step.sh")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    assert.fail("expected the file-count floor to fail the step");
  } catch (err) {
    assert.notEqual(err.status, 0);
    assert.ok(String(err.stdout).includes("glob likely broke"), String(err.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5b: the aggregate test-count floor (>=50, summed across files) still fires on a mass-skip", () => {
  const files = Array.from({ length: 8 }, (_, i) => ({
    name: `stub-${i}.test.mjs`,
    stdout: "TAP version 13\n# tests 3\n",
    exit: 0,
  }));
  const result = run(files);
  assert.notEqual(result.code, 0);
  assert.ok(
    result.stdout.includes("only 24 impure tests ran across 8 files (expected at least 50)"),
    result.stdout,
  );
});

test("AC5c: a healthy run at/above both floors passes clean, no annotation", () => {
  const files = Array.from({ length: 8 }, (_, i) => ({
    name: `stub-${i}.test.mjs`,
    stdout: "TAP version 13\n# tests 10\n",
    exit: 0,
  }));
  const result = run(files);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(annotationLines(result.stdout), []);
});

test("AC5d: FAFF-1038's pre-summary-line guard now fires PER FILE — a crash with no '# tests N' line names that file, exits non-zero, distinguishable from mass-skip", () => {
  const files = [
    ...Array.from({ length: 7 }, (_, i) => ({
      name: `ok-${i}.test.mjs`,
      stdout: "TAP version 13\n# tests 10\n",
      exit: 0,
    })),
    { name: "crashes.test.mjs", stdout: "TAP version 13\n", exit: 137 },
  ];
  const result = run(files);
  assert.notEqual(result.code, 0);
  const errorLines = annotationLines(result.stdout);
  assert.ok(
    errorLines.some(
      (l) =>
        l.includes("crashes.test.mjs") &&
        l.includes("before the test runner emitted its summary line") &&
        l.includes("node exit status 137"),
    ),
    result.stdout,
  );
  assert.ok(!errorLines.some((l) => l.includes("mass-skipped")), "a summary-less crash must not read as a mass-skip");
});

test("AC5e: a genuine per-file test failure (valid summary line, non-zero exit) fails the step", () => {
  const files = [
    ...Array.from({ length: 7 }, (_, i) => ({
      name: `ok-${i}.test.mjs`,
      stdout: "TAP version 13\n# tests 10\n",
      exit: 0,
    })),
    { name: "fails.test.mjs", stdout: "TAP version 13\n# tests 10\n", exit: 1 },
  ];
  const result = run(files);
  assert.notEqual(result.code, 0, result.stdout);
});
