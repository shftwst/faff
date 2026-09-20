// FAFF-996 — build-review-convergence: let the fix cap yield to a converging build-review
// dialogue. Sibling of test/spec-review-convergence.test.mjs, ported to the standing-critical
// finding_id comparator (no blocker_free_latest-style third clause — see the module header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  BUILD_REVIEW_CONVERGENCE_CASES,
  computeConvergence,
  standingCriticalCount,
  buildReviewConvergenceSelftest,
} from "../plugin/skills/faff/bin/lib/build-review-convergence.js";

function mkFindings(n, prefix = "f") {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ finding_id: `${prefix}${i}.js::t`, severity: "critical" });
  return arr;
}

// --- Pure comparator: every fixture case ------------------------------------------------

test("computeConvergence: fixture cases (strictly-converging/flat/new-finding/single-round/mixed-signal)", () => {
  for (const [name, rounds, wantConverging, wantSD, wantNNF] of BUILD_REVIEW_CONVERGENCE_CASES) {
    const res = computeConvergence(rounds);
    assert.equal(res.converging, wantConverging, name);
    assert.equal(res.strictly_decreasing, wantSD, name);
    assert.equal(res.no_new_finding, wantNNF, name);
  }
});

test("computeConvergence: NO third 'latest round critical-free' clause — a non-empty latest standing-critical set can still converge (p-10/spec section 6)", () => {
  const rounds = [
    { signal: "needs-human", findings: mkFindings(3) },
    { signal: "needs-human", findings: mkFindings(2) },
    { signal: "needs-human", findings: mkFindings(1) }, // still one standing critical
  ];
  const res = computeConvergence(rounds);
  assert.equal(res.converging, true, "convergence never requires a critical-free latest round");
});

test("computeConvergence: flat count parks (not strictly decreasing)", () => {
  const rounds = [
    { signal: "needs-human", findings: mkFindings(2) },
    { signal: "needs-human", findings: mkFindings(2) },
  ];
  const res = computeConvergence(rounds);
  assert.equal(res.converging, false);
  assert.equal(res.strictly_decreasing, false);
});

test("computeConvergence: single round is defensively converging:false", () => {
  const res = computeConvergence([{ signal: "needs-human", findings: mkFindings(2) }]);
  assert.equal(res.converging, false);
  assert.match(res.reason, /need >=2 rounds/);
});

// --- standingCriticalCount --------------------------------------------------------------

test("standingCriticalCount: the deduped standing-critical finding_id count", () => {
  assert.equal(standingCriticalCount([{ finding_id: "a", severity: "critical" }, { finding_id: "a", severity: "critical" }, { finding_id: "b", severity: "major" }]), 1);
  assert.equal(standingCriticalCount(undefined), 0);
});

// --- in-process selftest ------------------------------------------------------------------

test("in-process selftest passes", () => {
  assert.equal(buildReviewConvergenceSelftest(), 0);
});

// --- CLI subcommand -------------------------------------------------------------------------

test("faff build-review-convergence --dir: reads+orders round-<n>.json, exit 0 (integration smoke test)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-convergence-cli-"));
  try {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(3) }));
    writeFileSync(join(tmp, "round-2.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(2) }));
    writeFileSync(join(tmp, "round-3.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(1) }));
    const r = runCli(["build-review-convergence", "--dir", tmp]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.converging, true);
    assert.deepEqual(parsed.totals, [3, 2, 1]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-convergence: unreadable --dir degrades to converging:false, exit 0", () => {
  const r = runCli(["build-review-convergence", "--dir", "/does/not/exist/anywhere"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).converging, false);
});

test("faff build-review-convergence: malformed round record exits 2 (fail-loud)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-convergence-cli-"));
  try {
    writeFileSync(join(tmp, "round-1.json"), "not json at all");
    const r = runCli(["build-review-convergence", "--dir", tmp]);
    assert.equal(r.code, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-convergence: --window-start bounds the comparison", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-convergence-cli-"));
  try {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(5) }));
    writeFileSync(join(tmp, "round-2.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(1) }));
    writeFileSync(join(tmp, "round-3.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(2) })); // an increase after round-2
    // Whole-directory read would fail to converge (5->1->2 is not strictly decreasing); a
    // window starting at round-2 compares only [2,3] which likewise isn't decreasing but
    // demonstrates the filter applied (only two records considered, not three).
    const r = runCli(["build-review-convergence", "--dir", tmp, "--window-start", "2"]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed.totals, [1, 2]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-convergence: a malformed --window-start is a usage error (exit 2)", () => {
  const r = runCli(["build-review-convergence", "--dir", "/tmp", "--window-start", "0"]);
  assert.equal(r.code, 2);
});

test("faff build-review-convergence: missing --dir exits 2, usage on stderr", () => {
  const r = runCli(["build-review-convergence"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: faff build-review-convergence/);
});

test("faff build-review-convergence --selftest exits 0 and reports PASS", () => {
  const r = runCli(["build-review-convergence", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});
