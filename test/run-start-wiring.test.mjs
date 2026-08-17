// FAFF-498 — beep-boop §0a's run-start wiring: the caller-side signal assembly that seats the
// shipped `faff run-start` predicate (FAFF-496) at the top of an L4 lights-out run.
//
// Proves the COMPOSITION seam §0a's prose describes: computing `outward` via `faff run-outward`
// (FAFF-521) and `coverage_covered` via `faff prdr coverage` (boolean v1, no ratio) against real
// PRDR fixtures, then feeding the assembled seven-boolean bundle to `faff run-start`, produces the
// exact verdicts spec §5 names — the two non-holdout scenarios (plan/coverage-thin,
// drain/prd-covered) plus the two holdout scenarios (refuse/self-directed BEFORE any PRD check,
// refuse/coverage-unmeasurable never coerced to drain). The pure decision tables for run-start,
// run-outward, and prdr coverage are already exhaustively covered by their own --selftest suites
// and integration tests (run-start.test.mjs, run-outward.test.mjs) — this file's value is proving
// the ASSEMBLY §0a documents (which flags, which omissions, which fallbacks) composes correctly
// end-to-end against real fixtures, not re-testing any of those predicates in isolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");
const skillPath = path.join(repoRoot, "plugin", "skills", "faff-beep-boop", "SKILL.md");

function faff(args, opts) {
  const r = spawnSync("node", [faffBin, ...args], { encoding: "utf8", cwd: repoRoot, ...opts });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

function mkPrdrFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-498-prdr-"));
  return tmp;
}

// --- §0a step 3: the outward read (mirrors plot-ignition's repo-slug oracle identically) ---

test("§0a wiring: an outward (non-self) adopter target resolves outward:true via faff run-outward", () => {
  const target = JSON.stringify({ container: "ADOPT-1", repo: "acme/widget" });
  const self = JSON.stringify({ container: null, repo: "shftwst/faff", is_self: false });
  const r = faff(["run-outward", "--target", target, "--self", self, "--json"]);
  assert.equal(r.code, 0);
  const sig = JSON.parse(r.stdout);
  assert.equal(sig.outward, true);
});

test("§0a wiring: a self-directed target (repo-slug match) resolves outward:false", () => {
  const target = JSON.stringify({ container: null, repo: "shftwst/faff" });
  const self = JSON.stringify({ container: null, repo: "shftwst/faff", is_self: true });
  const r = faff(["run-outward", "--target", target, "--self", self, "--json"]);
  assert.equal(r.code, 0);
  const sig = JSON.parse(r.stdout);
  assert.equal(sig.outward, false);
  assert.equal(sig.reason, "self-marked");
});

// --- §0a step 6: the coverage read — boolean v1, `--prd-goals` + docs/prdr filesystem read, no --live-prdrs ---

test("§0a wiring: faff prdr coverage --container --prd-goals (no --live-prdrs) reads docs/prdr itself and reports covered:true when every goal has a live PRDR", () => {
  const tmp = mkPrdrFixture();
  const mk = faff(["prdr", "new", "Ship booking flow", "--container", "demo", "--prd-goal", "ship booking", "--root", tmp]);
  assert.equal(mk.code, 0, mk.stderr);
  const r = faff(["prdr", "coverage", "--container", "demo", "--prd-goals", JSON.stringify(["ship booking"]), "--root", tmp]);
  assert.equal(r.code, 0, r.stderr);
  const block = JSON.parse(r.stdout);
  assert.equal(block.covered, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("§0a wiring: a PRD goal with no live PRDR reports covered:false (coverage-thin)", () => {
  const tmp = mkPrdrFixture();
  const mk = faff(["prdr", "new", "Ship booking flow", "--container", "demo", "--prd-goal", "ship booking", "--root", tmp]);
  assert.equal(mk.code, 0, mk.stderr);
  const r = faff(["prdr", "coverage", "--container", "demo", "--prd-goals", JSON.stringify(["ship booking", "reduce no-shows"]), "--root", tmp]);
  assert.equal(r.code, 0, r.stderr);
  const block = JSON.parse(r.stdout);
  assert.equal(block.covered, false);
  assert.deepEqual(block.uncovered_goals, ["reduce no-shows"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("§0a wiring: coverage read emits a boolean-only block — no fraction/ratio field on the printed verdict", () => {
  const tmp = mkPrdrFixture();
  faff(["prdr", "new", "Ship booking flow", "--container", "demo", "--prd-goal", "ship booking", "--root", tmp]);
  const r = faff(["prdr", "coverage", "--container", "demo", "--prd-goals", JSON.stringify(["ship booking"]), "--root", tmp]);
  const block = JSON.parse(r.stdout);
  assert.equal(typeof block.covered, "boolean");
  for (const k of Object.keys(block)) {
    assert.doesNotMatch(k.toLowerCase(), /ratio|percent|fraction/);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- End-to-end: the full §0a assembly (outward + coverage) feeding faff run-start ---

test("end-to-end: outward target + admissible PRD + an uncovered goal → plan/coverage-thin (spec §5 scenario 1)", () => {
  const tmp = mkPrdrFixture();
  faff(["prdr", "new", "Ship booking flow", "--container", "demo", "--prd-goal", "ship booking", "--root", tmp]);
  const cov = JSON.parse(faff(["prdr", "coverage", "--container", "demo", "--prd-goals", JSON.stringify(["ship booking", "reduce no-shows"]), "--root", tmp]).stdout);
  const out = JSON.parse(faff(["run-outward", "--target", JSON.stringify({ container: "demo", repo: "acme/widget" }), "--self", JSON.stringify({ container: null, repo: "shftwst/faff", is_self: false }), "--json"]).stdout);
  const signals = {
    target_resolved: true, outward: out.outward,
    prd_present: true, prd_ambiguous: false, prd_admissible: true,
    coverage_measurable: true, coverage_covered: cov.covered,
  };
  const verdict = JSON.parse(faff(["run-start", "--signals", JSON.stringify(signals)]).stdout);
  assert.equal(verdict.verdict, "plan");
  assert.equal(verdict.reason, "coverage-thin");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("end-to-end: outward target + admissible PRD + every goal covered → drain/prd-covered (spec §5 scenario 2)", () => {
  const tmp = mkPrdrFixture();
  faff(["prdr", "new", "Ship booking flow", "--container", "demo", "--prd-goal", "ship booking", "--root", tmp]);
  const cov = JSON.parse(faff(["prdr", "coverage", "--container", "demo", "--prd-goals", JSON.stringify(["ship booking"]), "--root", tmp]).stdout);
  const out = JSON.parse(faff(["run-outward", "--target", JSON.stringify({ container: "demo", repo: "acme/widget" }), "--self", JSON.stringify({ container: null, repo: "shftwst/faff", is_self: false }), "--json"]).stdout);
  const signals = {
    target_resolved: true, outward: out.outward,
    prd_present: true, prd_ambiguous: false, prd_admissible: true,
    coverage_measurable: true, coverage_covered: cov.covered,
  };
  const verdict = JSON.parse(faff(["run-start", "--signals", JSON.stringify(signals)]).stdout);
  assert.equal(verdict.verdict, "drain");
  assert.equal(verdict.reason, "prd-covered");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("end-to-end (holdout): a self-directed target refuses BEFORE any PRD/admissibility branch, even with an admissible+covered PRD", () => {
  const out = JSON.parse(faff(["run-outward", "--target", JSON.stringify({ container: null, repo: "shftwst/faff" }), "--self", JSON.stringify({ container: null, repo: "shftwst/faff", is_self: true }), "--json"]).stdout);
  assert.equal(out.outward, false);
  const signals = {
    target_resolved: true, outward: out.outward,
    prd_present: true, prd_ambiguous: false, prd_admissible: true,
    coverage_measurable: true, coverage_covered: true,
  };
  const verdict = JSON.parse(faff(["run-start", "--signals", JSON.stringify(signals)]).stdout);
  assert.equal(verdict.verdict, "refuse");
  assert.equal(verdict.reason, "self-directed");
});

test("end-to-end (holdout): an unreadable/malformed coverage read (coverage_measurable:false) refuses coverage-unmeasurable, never coerced to drain", () => {
  const signals = {
    target_resolved: true, outward: true,
    prd_present: true, prd_ambiguous: false, prd_admissible: true,
    coverage_measurable: false, coverage_covered: false,
  };
  const verdict = JSON.parse(faff(["run-start", "--signals", JSON.stringify(signals)]).stdout);
  assert.equal(verdict.verdict, "refuse");
  assert.equal(verdict.reason, "coverage-unmeasurable");
});

test("end-to-end: the no-PRD case still drains (no-prd-nothing-to-plan) when the target resolves and is outward", () => {
  const out = JSON.parse(faff(["run-outward", "--target", JSON.stringify({ container: null, repo: "acme/widget" }), "--self", JSON.stringify({ container: null, repo: "shftwst/faff", is_self: false }), "--json"]).stdout);
  const signals = {
    target_resolved: true, outward: out.outward,
    prd_present: false, prd_ambiguous: false, prd_admissible: false,
    coverage_measurable: false, coverage_covered: false,
  };
  const verdict = JSON.parse(faff(["run-start", "--signals", JSON.stringify(signals)]).stdout);
  assert.equal(verdict.verdict, "drain");
  assert.equal(verdict.reason, "no-prd-nothing-to-plan");
});

// --- Static checks over the §0a prose itself (spec §5's two static-check DoD lines) ---

test("static: the §0a call-site carries no ad-hoc --autonomous/--plan flag or env sniff gating the run-start call — the only guard is the L4-lights-out heading", () => {
  const text = fs.readFileSync(skillPath, "utf8");
  const start = text.indexOf("### 0a. Run-start trigger");
  assert.notEqual(start, -1, "§0a heading not found");
  const end = text.indexOf("### 1. Tidy pass", start);
  const section = text.slice(start, end);
  // Two sanctioned mentions are not a gating flag: `/faff-plot --autonomous` is the DOWNSTREAM
  // action on a `plan` verdict (a different skill's own flag), and the invariant paragraph itself
  // NAMES the banned pattern in prose ("never an ad-hoc `--autonomous`/`--plan` flag..."). Strip
  // both before checking for an actual gating flag read at this call-site.
  const stripped = section
    .split("/faff-plot --autonomous").join("")
    .split("ad-hoc `--autonomous`/`--plan` flag").join("");
  assert.doesNotMatch(stripped, /--autonomous\b/);
  assert.doesNotMatch(stripped, /--plan\b/);
  assert.doesNotMatch(section, /process\.env|\$[A-Z_]+_AUTONOMOUS/);
  assert.match(section, /L4 lights-out signal only/);
});

test("static: the §0a coverage read consumes boolean .covered and computes no fraction/ratio at the call-site", () => {
  const text = fs.readFileSync(skillPath, "utf8");
  const start = text.indexOf("### 0a. Run-start trigger");
  const end = text.indexOf("### 1. Tidy pass", start);
  const section = text.slice(start, end);
  assert.match(section, /faff prdr coverage/);
  // coverage_covered is derived from exactly one boolean read — no arithmetic, no numeric
  // threshold/percentage constant anywhere near the assignment (a ratio computation would need one).
  const assign = section.match(/coverage_covered\s*:=\s*block\.covered === true`[^.]*\./)[0];
  assert.match(assign, /block\.covered === true/);
  assert.doesNotMatch(assign, /[0-9]|\/|%|>=|<=/);
});

test("static: the §0a heading + prose sit under the L4-lights-out-only guard, before faff lights-out mints", () => {
  const text = fs.readFileSync(skillPath, "utf8");
  const start = text.indexOf("### 0a. Run-start trigger");
  assert.notEqual(start, -1);
  const guardLine = text.slice(start, start + 700);
  assert.match(guardLine, /L4 lights-out signal only/);
  assert.match(guardLine, /before .*faff lights-out.* mints the ledger/);
});

test("static: a plan verdict invokes /faff-plot --autonomous, then mints its own faff lights-out ledger and falls through (no STOP, converge don't stop)", () => {
  const text = fs.readFileSync(skillPath, "utf8");
  const start = text.indexOf("### 0a. Run-start trigger");
  const end = text.indexOf("### 1. Tidy pass", start);
  const section = text.slice(start, end);
  const planLine = section.match(/\*\*`plan`\*\*[\s\S]*?fall-through\./)[0];
  assert.match(planLine, /\/faff-plot --autonomous/);
  // it mints its OWN build-pass ledger — never reuses plot's decompose-pass ledger
  assert.match(planLine, /faff lights-out --prd-creative-licence/);
  assert.match(planLine, /never.*reuse plot's decompose-pass ledger/);
  // falls through to the build pipeline instead of stopping decompose-only
  assert.match(planLine, /fall through to step 1/);
  assert.doesNotMatch(planLine, /\bSTOP\.(?!\S)/);
});

test("static: a drain verdict mints via faff lights-out --prd-creative-licence; a refuse verdict mints nothing", () => {
  const text = fs.readFileSync(skillPath, "utf8");
  const start = text.indexOf("### 0a. Run-start trigger");
  const end = text.indexOf("### 1. Tidy pass", start);
  const section = text.slice(start, end);
  const drainLine = section.match(/\*\*`drain`\*\*[\s\S]*?ordinary pipeline\./)[0];
  assert.match(drainLine, /faff lights-out --prd-creative-licence/);
  const refuseLine = section.match(/\*\*`refuse`\*\*[\s\S]*?any tracker write\./)[0];
  assert.match(refuseLine, /mint \*\*nothing\*\*/);
});
