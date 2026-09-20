// FAFF-996 — build-review-churn: detect a thrashing build-review dialogue loop. Sibling of
// test/spec-review-churn.test.mjs, ported to the finding-identity comparator: covers the pure
// comparator (all fixture cases), the CLI subcommand (stdout/exit-code contract, --selftest),
// and the missing-vs-malformed --prev/--curr split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  BUILD_REVIEW_CHURN_CASES,
  computeChurn,
  standingCriticalIds,
  buildReviewChurnSelftest,
} from "../plugin/skills/faff/bin/lib/build-review-churn.js";

// --- Pure comparator: every fixture case ------------------------------------------------

test("computeChurn: fixture cases (identical/shrink/new-id/disjoint-swap/missing-prev/non-critical)", () => {
  for (const [name, prev, curr, prevRoundNumber, wantChurn, wantNewIds] of BUILD_REVIEW_CHURN_CASES) {
    const res = computeChurn(prev, curr, prevRoundNumber);
    assert.equal(res.churn, wantChurn, name);
    assert.deepEqual(res.new_critical_ids, wantNewIds, name);
  }
});

test("computeChurn: a same file+title finding whose location shifts by a line is the SAME identity — no churn (p-10)", () => {
  const prev = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical", location: "foo.js:120", title: "T" }] };
  const curr = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical", location: "foo.js:121", title: "T" }] };
  const res = computeChurn(prev, curr, 1);
  assert.equal(res.churn, false);
});

test("computeChurn: a genuinely new title at the same file is a NEW identity — churn (p-10)", () => {
  const prev = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical" }] };
  const curr = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical" }, { finding_id: "foo.js::u", severity: "critical" }] };
  const res = computeChurn(prev, curr, 1);
  assert.equal(res.churn, true);
  assert.deepEqual(res.new_critical_ids, ["foo.js::u"]);
});

test("computeChurn: round 1 (no prior record) degrades safely", () => {
  const curr = { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] };
  const res = computeChurn(null, curr, null);
  assert.equal(res.churn, false);
  assert.equal(res.reason, "no prior round on disk");
});

test("computeChurn: mixed signal types — comparator only looks at findings", () => {
  const prev = { signal: "fail", findings: [{ finding_id: "a.js::x", severity: "critical" }] };
  const curr = { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] };
  const res = computeChurn(prev, curr, 1);
  assert.equal(res.churn, false);
});

// --- standingCriticalIds helper --------------------------------------------------------

test("standingCriticalIds: dedupes, sorts, tolerates malformed input, ignores non-critical severities", () => {
  assert.deepEqual(standingCriticalIds([{ finding_id: "b", severity: "critical" }, { finding_id: "a", severity: "critical" }, { finding_id: "b", severity: "critical" }]), ["a", "b"]);
  assert.deepEqual(standingCriticalIds(undefined), []);
  assert.deepEqual(standingCriticalIds("not-an-array"), []);
  assert.deepEqual(standingCriticalIds([{ notFinding: 1 }, null, { finding_id: "a", severity: "major" }, { finding_id: "b", severity: "critical" }]), ["b"]);
});

// --- in-process selftest ------------------------------------------------------------------

test("in-process selftest passes", () => {
  assert.equal(buildReviewChurnSelftest(), 0);
});

// --- CLI subcommand -------------------------------------------------------------------------

test("faff build-review-churn --prev --curr: prints a BuildReviewChurnResult, exit 0 (integration smoke test)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const round1 = join(tmp, "round-1.json");
    const round2 = join(tmp, "round-2.json");
    writeFileSync(round1, JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] }));
    writeFileSync(round2, JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical" }, { finding_id: "b.js::y", severity: "critical" }],
    }));
    const r = runCli(["build-review-churn", "--prev", round1, "--curr", round2]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.churn, true);
    assert.deepEqual(parsed.new_critical_ids, ["b.js::y"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: missing --prev degrades to churn:false, exit 0 (round-1 shape)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const round1 = join(tmp, "round-1.json");
    writeFileSync(round1, JSON.stringify({ signal: "pass", findings: [] }));
    const r = runCli(["build-review-churn", "--prev", join(tmp, "round-0-never-written.json"), "--curr", round1]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).churn, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: malformed --prev fails loud, exit 2, nothing on stdout", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const badPrev = join(tmp, "round-1.json");
    writeFileSync(badPrev, "not valid json");
    const curr = join(tmp, "round-2.json");
    writeFileSync(curr, JSON.stringify({ signal: "pass", findings: [] }));
    const r = runCli(["build-review-churn", "--prev", badPrev, "--curr", curr]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: malformed --curr fails loud, exit 2", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const prev = join(tmp, "round-1.json");
    writeFileSync(prev, JSON.stringify({ signal: "pass", findings: [] }));
    const badCurr = join(tmp, "round-2.json");
    writeFileSync(badCurr, "not valid json");
    const r = runCli(["build-review-churn", "--prev", prev, "--curr", badCurr]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: missing both flags exits 2, usage on stderr", () => {
  const r = runCli(["build-review-churn"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: faff build-review-churn/);
});

test("faff build-review-churn --selftest exits 0 and reports PASS", () => {
  const r = runCli(["build-review-churn", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});
