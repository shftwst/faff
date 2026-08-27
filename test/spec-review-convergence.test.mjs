// FAFF-874 — spec-review-convergence: let the Spec-review-gate loop cap yield to a strictly
// converging reviewer. Covers the pure comparator (all fixture cases + the four spec
// scenarios), the derived count/blocker helpers, the CLI subcommand (directory read, numeric
// ordering, --selftest, unreadable-dir degrade vs malformed-record fail-loud), and the
// faff-prep/SKILL.md Loop cap wiring (the convergence-yield clause) this resolver plugs into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  SPEC_REVIEW_CONVERGENCE_CASES,
  detectSpecReviewConvergence,
  blockerCount,
  objectionCount,
  roundFilesInDir,
  specReviewConvergenceSelftest,
} from "../plugin/skills/faff/bin/lib/spec-review-convergence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PREP_SKILL = join(REPO, "plugin", "skills", "faff-prep", "SKILL.md");

// obj helpers to build round objection arrays of a given size/lens/blocker-count.
function mkObjs(total, lens, blockers = 0) {
  const arr = [];
  for (let i = 0; i < total; i++) arr.push({ lens, severity: i < blockers ? "blocker" : "major" });
  return arr;
}

// --- Pure comparator: every fixture case ------------------------------------------------

test("detectSpecReviewConvergence: fixture cases (converging/flat/churn/blocker/<2/verdict-agnostic)", () => {
  for (const [name, rounds, wantConverging, wantSD, wantBFL, wantNC] of SPEC_REVIEW_CONVERGENCE_CASES) {
    const res = detectSpecReviewConvergence(rounds);
    assert.equal(res.converging, wantConverging, name);
    assert.equal(res.strictly_decreasing, wantSD, name);
    assert.equal(res.blocker_free_latest, wantBFL, name);
    assert.equal(res.no_churn, wantNC, name);
    // The load-bearing constraint: converging is exactly the conjunction of the three legs.
    assert.equal(res.converging, res.strictly_decreasing && res.blocker_free_latest && res.no_churn, name);
  }
});

// --- The four spec scenarios (WHAT §5) --------------------------------------------------

test("Scenario 1: 14→13→8, blocker-free latest, no new lens — converging, grants next round", () => {
  const rounds = [
    { verdict: "reject-approach", objections: mkObjs(14, "architectural", 2) },
    { verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) },
  ];
  const res = detectSpecReviewConvergence(rounds);
  assert.equal(res.converging, true);
  assert.equal(res.strictly_decreasing, true);
  assert.equal(res.blocker_free_latest, true);
  assert.equal(res.no_churn, true);
  assert.deepEqual(res.totals, [14, 13, 8]);
});

test("Scenario 2: 13→13→8 flat first step — not strictly decreasing, parks unchanged", () => {
  const rounds = [
    { verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) },
  ];
  const res = detectSpecReviewConvergence(rounds);
  assert.equal(res.converging, false);
  assert.equal(res.strictly_decreasing, false);
  assert.match(res.reason, /not strictly decreasing at step 1/);
});

test("Scenario 3: a new lens appears between rounds — no_churn false, converging false", () => {
  const rounds = [
    { verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(9, "architectural", 0).concat(mkObjs(1, "infosec", 0)) },
  ];
  const res = detectSpecReviewConvergence(rounds);
  assert.equal(res.no_churn, false);
  assert.equal(res.converging, false);
  assert.deepEqual(res.new_lenses_by_step, [["infosec"]]);
});

test("Scenario 4 (holdout): strictly decreasing but a blocker remains in the latest round — parks", () => {
  const rounds = [
    { verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(11, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(8, "architectural", 1) },
  ];
  const res = detectSpecReviewConvergence(rounds);
  assert.equal(res.strictly_decreasing, true);
  assert.equal(res.blocker_free_latest, false);
  assert.equal(res.converging, false);
  assert.match(res.reason, /blocker\(s\) remain in the latest round/);
});

// --- no_churn checks EVERY step, including round-2-vs-round-3 (D1 whole-window) ----------

test("no_churn guards the round-2-vs-round-3 step, not just round-1-vs-round-2", () => {
  const rounds = [
    { verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) },
    { verdict: "reject-approach", objections: mkObjs(10, "architectural", 0) },
    // round 3 introduces a NEW lens (QA) at the second step — must be caught.
    { verdict: "reject-approach", objections: mkObjs(5, "architectural", 0).concat(mkObjs(1, "QA", 0)) },
  ];
  const res = detectSpecReviewConvergence(rounds);
  assert.equal(res.no_churn, false);
  assert.equal(res.converging, false);
  assert.deepEqual(res.new_lenses_by_step, [[], ["QA"]]);
  assert.match(res.reason, /new objecting lens\(es\) at step 2: QA/);
});

// --- verdict-agnostic: the comparator reads only objections ------------------------------

test("comparator is verdict-agnostic — same counts regardless of which verdict produced them", () => {
  const rounds = [
    { verdict: "revise", objections: mkObjs(6, "QA", 0) },
    { verdict: "reject-approach", objections: mkObjs(4, "QA", 0) },
    { verdict: "needs-human", objections: mkObjs(2, "QA", 0) },
  ];
  const res = detectSpecReviewConvergence(rounds);
  assert.equal(res.converging, true);
  assert.deepEqual(res.totals, [6, 4, 2]);
});

// --- <2 rounds defensive ----------------------------------------------------------------

test("fewer than 2 rounds → converging:false (defensive; cannot happen at a genuine cap)", () => {
  const res = detectSpecReviewConvergence([{ verdict: "reject-approach", objections: mkObjs(5, "architectural", 0) }]);
  assert.equal(res.converging, false);
  assert.equal(res.reason, "need >=2 rounds to assess a trend");
  const empty = detectSpecReviewConvergence([]);
  assert.equal(empty.converging, false);
  assert.deepEqual(empty.totals, []);
});

// --- Derived counts: no schema field --------------------------------------------------

test("blockerCount / objectionCount are derived (no schema field), tolerate malformed input", () => {
  assert.equal(blockerCount([{ severity: "blocker" }, { severity: "major" }, { severity: "blocker" }]), 2);
  assert.equal(blockerCount(undefined), 0);
  assert.equal(objectionCount([{ lens: "QA" }, { lens: "infosec" }]), 2);
  assert.equal(objectionCount(null), 0);
});

// --- CLI wrapper: directory read + numeric ordering + degrade/fail-loud ------------------

test("roundFilesInDir orders numerically (round-10 after round-2), ignores non-round files", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-order-"));
  try {
    for (const n of [2, 10, 1]) writeFileSync(join(dir, `round-${n}.json`), "{}");
    writeFileSync(join(dir, "verdict-block.txt"), "ignored");
    assert.deepEqual(roundFilesInDir(dir).map((f) => f.n), [1, 2, 10]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: faff spec-review-convergence --dir reads+orders records, prints converging JSON, exit 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-cli-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(14, "architectural", 2) }));
    writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) }));
    writeFileSync(join(dir, "round-3.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) }));
    const r = runCli(["spec-review-convergence", "--dir", dir]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.converging, true);
    assert.deepEqual(out.totals, [14, 13, 8]);
    assert.equal(out.blocker_free_latest, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: unreadable --dir degrades to converging:false (fail-safe = park), exit 0", () => {
  const r = runCli(["spec-review-convergence", "--dir", join(tmpdir(), "faff-conv-does-not-exist-xyz")]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).converging, false);
});

test("CLI: a malformed round record is fail-loud (exit 2), never silently coerced", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-bad-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: [] }));
    writeFileSync(join(dir, "round-2.json"), "not json at all");
    const r = runCli(["spec-review-convergence", "--dir", dir]);
    assert.equal(r.code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --dir is required (usage error when absent)", () => {
  const r = runCli(["spec-review-convergence"]);
  assert.notEqual(r.code, 0);
});

// --- --selftest ------------------------------------------------------------------------

test("CLI: --selftest reports PASS", () => {
  const r = runCli(["spec-review-convergence", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("specReviewConvergenceSelftest() returns 0 in-process", () => {
  // Silence its console.log while asserting the return code.
  const orig = console.log;
  console.log = () => {};
  try {
    assert.equal(specReviewConvergenceSelftest(), 0);
  } finally {
    console.log = orig;
  }
});

// --- faff-prep/SKILL.md wiring ---------------------------------------------------------

test("faff-prep/SKILL.md: Loop cap gains the convergence-yield clause naming the CLI + behaviour", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  assert.match(body, /faff spec-review-convergence/, "the Loop cap must resolve convergence via the CLI, never eyeball it");
  assert.match(body, /yields to a convergence signal/, "must state the count cap yields to the convergence signal");
  assert.match(body, /converging: true/, "must name the converging:true yield");
  assert.match(body, /converging: false/, "must name the converging:false park");
  assert.match(body, /converging direction only/, "must state the yield is converging-direction-only (thrashing still parks)");
});

// --- FAFF-909: --window-start N read-time filter ----------------------------------------

test("CLI: --window-start omitted is byte-identical to today (whole-directory read)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-ws-omit-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) }));
    writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) }));
    writeFileSync(join(dir, "round-3.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) }));
    const withFlag = runCli(["spec-review-convergence", "--dir", dir, "--window-start", "1"]);
    const without = runCli(["spec-review-convergence", "--dir", dir]);
    assert.equal(withFlag.code, 0, withFlag.stdout + withFlag.stderr);
    assert.equal(without.code, 0, without.stdout + without.stderr);
    assert.deepEqual(JSON.parse(withFlag.stdout).totals, [14, 13, 8]);
    assert.deepEqual(JSON.parse(without.stdout).totals, [14, 13, 8], "window-start 1 == whole-directory read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Scenario (discontinuity): --window-start 4 compares only round-4 and round-5", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-ws-disc-"));
  try {
    // round-1..3 belong to a pre-restart conversation; round-4..5 are the current window.
    // The pre-window rounds would poison the strictly-decreasing signal if included
    // (round-3 is smaller than round-4), so the window must exclude them.
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) }));
    writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(9, "architectural", 0) }));
    writeFileSync(join(dir, "round-3.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(3, "architectural", 0) }));
    writeFileSync(join(dir, "round-4.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(10, "architectural", 0) }));
    writeFileSync(join(dir, "round-5.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(6, "architectural", 0) }));
    const r = runCli(["spec-review-convergence", "--dir", dir, "--window-start", "4"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.totals, [10, 6], "only round-4 and round-5 contribute");
    assert.equal(out.converging, true, "10→6 strictly decreasing, blocker-free, no churn");
    // Without the window the pre-window round-3 (3) before round-4 (10) breaks strict-decrease.
    const whole = JSON.parse(runCli(["spec-review-convergence", "--dir", dir]).stdout);
    assert.equal(whole.converging, false, "whole-directory read is poisoned by the discontinuity");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("holdout scenario: round-1..4 (14,13,8,5) with --window-start 1 → converging true", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-ws-holdout-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) }));
    writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) }));
    writeFileSync(join(dir, "round-3.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) }));
    writeFileSync(join(dir, "round-4.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(5, "architectural", 0) }));
    const r = runCli(["spec-review-convergence", "--dir", dir, "--window-start", "1"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.converging, true);
    assert.deepEqual(out.totals, [14, 13, 8, 5]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --window-start past the max round → converging:false with the need >=2 reason (park)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-ws-past-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(9, "architectural", 0) }));
    writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(5, "architectural", 0) }));
    const r = runCli(["spec-review-convergence", "--dir", dir, "--window-start", "5"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.converging, false);
    assert.match(out.reason, /need >=2 rounds/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: a malformed --window-start is a usage error (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-ws-bad-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: [] }));
    assert.equal(runCli(["spec-review-convergence", "--dir", dir, "--window-start", "0"]).code, 2, "0 rejected");
    assert.equal(runCli(["spec-review-convergence", "--dir", dir, "--window-start", "1.5"]).code, 2, "1.5 rejected");
    assert.equal(runCli(["spec-review-convergence", "--dir", dir, "--window-start", "abc"]).code, 2, "abc rejected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --window-start keeps the existing degrades (unreadable --dir → converging:false exit 0)", () => {
  const r = runCli(["spec-review-convergence", "--dir", join(tmpdir(), "faff-conv-ws-missing-xyz"), "--window-start", "2"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).converging, false);
});

test("CLI: a malformed round record INSIDE the window is still fail-loud (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-conv-ws-badrec-"));
  try {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: [] }));
    writeFileSync(join(dir, "round-2.json"), "not json at all");
    // round-2 is inside the window [2..] → fail-loud.
    assert.equal(runCli(["spec-review-convergence", "--dir", dir, "--window-start", "2"]).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
