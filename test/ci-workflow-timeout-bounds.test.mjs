// FAFF-1035 — the guard: every job under .github/workflows/ must declare a `timeout-minutes` in
// 1-360 (GitHub silently ignores anything above 360 on hosted runners), so a runner-side stall
// (observed on PR #879: validate-macos hung 101.6 minutes with zero log output before a manual
// cancel) self-terminates instead of running until a person notices and cancels it by hand.
//
// Job enumeration mirrors the job-key extraction gates.js already uses (extractRunCommandsWithContext,
// plugin/skills/faff/bin/lib/gates.js): a job key is a `<name>:` line at indent 2 directly under a
// top-level `jobs:` block, and a job property (here `timeout-minutes:`) is a `key: value` line at
// indent 4 under that job header — so the guard and the gate ladder agree on what a job is. This
// guard runs on the `unit` node:test lane (validate.yml), the same CI lane that runs this file, so
// a newly added unbounded job reddens a pull request with no edit to any workflow file [AC4].

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

// PURE — parses one workflow file's text into `[{ job, hasTimeout, raw }]`. Indent-2 job header /
// indent-4 property recognition mirrors gates.js's extractRunCommandsWithContext exactly (the same
// jobMatch / runs-on-style regex, applied to `timeout-minutes` instead of `runs-on`).
function parseWorkflowJobs(text) {
  const lines = String(text).split(/\r?\n/);
  const indentOf = (s) => (s.match(/^[ \t]*/) || [""])[0].length;
  const jobs = [];
  let inJobsBlock = false;
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inJobsBlock && /^jobs:\s*$/.test(trimmed) && indentOf(line) === 0) {
      inJobsBlock = true;
      continue;
    }
    if (!inJobsBlock) continue;
    const jobMatch = /^([A-Za-z0-9_.-]+):\s*$/.exec(trimmed);
    if (jobMatch && indentOf(line) === 2) {
      current = { job: jobMatch[1], hasTimeout: false, raw: null };
      jobs.push(current);
      continue;
    }
    if (!current) continue;
    const timeoutMatch = /^\s*timeout-minutes:\s*(.+)$/.exec(line);
    if (timeoutMatch && indentOf(line) === 4) {
      current.hasTimeout = true;
      current.raw = timeoutMatch[1].trim();
    }
  }
  return jobs;
}

// PURE — the guard proper. Returns `{ jobCount, violations }`; `violations` is empty iff every job
// declares an integer `timeout-minutes` in 1-360.
function guardWorkflowBounds(files) {
  const violations = [];
  let jobCount = 0;
  for (const { name, text } of files) {
    for (const { job, hasTimeout, raw } of parseWorkflowJobs(text)) {
      jobCount += 1;
      if (!hasTimeout) {
        violations.push(`${name}:${job} — missing timeout-minutes`);
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 360) {
        violations.push(`${name}:${job} — timeout-minutes=${raw} outside 1-360`);
      }
    }
  }
  return { jobCount, violations };
}

function readRealWorkflowFiles() {
  const names = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  return names.map((name) => ({ name, text: readFileSync(join(workflowsDir, name), "utf8") }));
}

// --- AC1 + AC2: the real repo, today ---

test("every job under .github/workflows/ declares an integer timeout-minutes in 1-360; job count is 14 [AC1, AC2]", () => {
  const files = readRealWorkflowFiles();
  const { jobCount, violations } = guardWorkflowBounds(files);
  assert.deepEqual(violations, [], `violations found: ${violations.join("; ")}`);
  assert.equal(jobCount, 14, "job count across the 8 workflow files must be 14");
});

test("job enumeration matches the 8 known files with their known per-file job counts", () => {
  const files = readRealWorkflowFiles();
  const counts = Object.fromEntries(files.map(({ name, text }) => [name, parseWorkflowJobs(text).length]));
  assert.deepEqual(counts, {
    "dco.yml": 1,
    "deploy-docs.yml": 2,
    "faff-landing-comment.yml": 1,
    "governance.yml": 1,
    "job-surface-probe.yml": 2,
    "release-please.yml": 1,
    "semantic-pr.yml": 1,
    "validate.yml": 5,
  });
});

// --- AC3: the guard reddens on omission and on an out-of-range value, and greens once restored ---
// Demonstrated against a REAL file's bytes (dco.yml), mutated only in memory — never against the
// checked-in workflow files themselves, so this test file never regresses AC1.

test("guard: deleting a job's timeout-minutes reddens the guard; restoring it greens again [AC3]", () => {
  const dco = readRealWorkflowFiles().find((f) => f.name === "dco.yml");
  assert.ok(dco, "fixture precondition: dco.yml must exist");

  const original = dco.text;
  const { violations: cleanViolations } = guardWorkflowBounds([{ name: dco.name, text: original }]);
  assert.deepEqual(cleanViolations, [], "precondition: dco.yml is clean before mutation");

  const deletedLine = original.split(/\r?\n/).filter((l) => !/^\s*timeout-minutes:\s*5\s*$/.test(l)).join("\n");
  assert.notEqual(deletedLine, original, "fixture precondition: the timeout-minutes line was actually found and removed");
  const { violations: redViolations } = guardWorkflowBounds([{ name: dco.name, text: deletedLine }]);
  assert.ok(
    redViolations.some((v) => v.includes("dco") && v.includes("missing timeout-minutes")),
    `expected a missing-timeout-minutes violation for dco, got: ${redViolations.join("; ")}`,
  );

  const { violations: restoredViolations } = guardWorkflowBounds([{ name: dco.name, text: original }]);
  assert.deepEqual(restoredViolations, [], "restoring the original text clears the violation");
});

test("guard: a timeout-minutes value of 600 (above GitHub's 360 ceiling) reddens the guard [AC3]", () => {
  const dco = readRealWorkflowFiles().find((f) => f.name === "dco.yml");
  const mutated = dco.text.replace(/timeout-minutes:\s*5/, "timeout-minutes: 600");
  assert.notEqual(mutated, dco.text, "fixture precondition: the value was actually replaced");
  const { violations } = guardWorkflowBounds([{ name: dco.name, text: mutated }]);
  assert.ok(
    violations.some((v) => v.includes("dco") && v.includes("outside 1-360")),
    `expected an out-of-range violation for dco at 600, got: ${violations.join("; ")}`,
  );
});

test("guard: a synthetic newly-added job with no timeout-minutes is caught (AC4's newly-added-job case, isolated from disk)", () => {
  const synthetic = "jobs:\n  brand-new-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
  const { jobCount, violations } = guardWorkflowBounds([{ name: "synthetic.yml", text: synthetic }]);
  assert.equal(jobCount, 1);
  assert.ok(violations.some((v) => v.includes("brand-new-job") && v.includes("missing timeout-minutes")));
});

test("guard: a synthetic job with a valid bound passes clean", () => {
  const synthetic = "jobs:\n  ok-job:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - run: echo hi\n";
  const { jobCount, violations } = guardWorkflowBounds([{ name: "synthetic.yml", text: synthetic }]);
  assert.equal(jobCount, 1);
  assert.deepEqual(violations, []);
});

test("guard: a non-integer timeout-minutes value is rejected", () => {
  const synthetic = "jobs:\n  bad-job:\n    runs-on: ubuntu-latest\n    timeout-minutes: soon\n    steps:\n      - run: echo hi\n";
  const { violations } = guardWorkflowBounds([{ name: "synthetic.yml", text: synthetic }]);
  assert.ok(violations.some((v) => v.includes("bad-job") && v.includes("outside 1-360")));
});

test("guard: timeout-minutes of 0 is rejected (must be >= 1)", () => {
  const synthetic = "jobs:\n  zero-job:\n    runs-on: ubuntu-latest\n    timeout-minutes: 0\n    steps:\n      - run: echo hi\n";
  const { violations } = guardWorkflowBounds([{ name: "synthetic.yml", text: synthetic }]);
  assert.ok(violations.some((v) => v.includes("zero-job") && v.includes("outside 1-360")));
});
