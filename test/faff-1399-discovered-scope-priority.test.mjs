// FAFF-1399 — `faff discovered-scope-priority` is a total enum × enum × boolean lookup that turns a
// DiscoveredScopeEntry's already-judged `relationship` / `source` / `gate_defect` fields into a
// high/medium/low priority, so every autonomous/interactive filing chokepoint (beep-boop's discovered-
// scope filing, interactive graft's Step 12, tidy's chain-gap auto-fill) agrees on the same ticket's
// priority. These tests spawn the CLI directly and cover every row of the spec's §3 priority table,
// the gate_defect short-circuit over a relationship:"none" input, and the chain-gap --source chain-gap
// / --relationship parent combination.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const GRAFT_SKILL = join(REPO, "plugin", "skills", "faff-graft", "SKILL.md");
const BEEPBOOP_SKILL = join(REPO, "plugin", "skills", "faff-beep-boop", "SKILL.md");
const TIDY_SKILL = join(REPO, "plugin", "skills", "faff-tidy", "SKILL.md");

const run = (args) => spawnSync(process.execPath, [BIN, "discovered-scope-priority", ...args], { encoding: "utf8" });

function priority(relationship, source, { gateDefect = false } = {}) {
  const args = ["--relationship", relationship, "--source", source];
  if (gateDefect) args.push("--gate-defect");
  const r = run(args);
  assert.equal(r.status, 0, `exit 0 expected for relationship=${relationship} source=${source} gateDefect=${gateDefect}: ${r.stderr}`);
  return r.stdout.trim();
}

test("FAFF-1399: gate_defect == true is High, even over relationship: none and a low-tier source", () => {
  assert.equal(priority("none", "build", { gateDefect: true }), "high");
  assert.equal(priority("none", "orchestrator", { gateDefect: true }), "high");
});

test("FAFF-1399: gate_defect short-circuits over every other row, including ones that would otherwise be lower", () => {
  assert.equal(priority("peer", "build", { gateDefect: true }), "high");
  assert.equal(priority("blocked-by", "review", { gateDefect: true }), "high");
  assert.equal(priority("parent", "chain-gap", { gateDefect: true }), "high");
});

test("FAFF-1399: relationship == blocker is High", () => {
  assert.equal(priority("blocker", "build", { gateDefect: false }), "high");
  assert.equal(priority("blocker", "review", { gateDefect: false }), "high");
  assert.equal(priority("blocker", "orchestrator", { gateDefect: false }), "high");
});

test("FAFF-1399: source in {post-merge, ci-triage} is High (a regression on main), matched on source not relationship", () => {
  assert.equal(priority("none", "post-merge", { gateDefect: false }), "high");
  assert.equal(priority("peer", "post-merge", { gateDefect: false }), "high");
  assert.equal(priority("none", "ci-triage", { gateDefect: false }), "high");
  assert.equal(priority("peer", "ci-triage", { gateDefect: false }), "high");
});

test("FAFF-1399: relationship in {blocked-by, parent} is Medium", () => {
  assert.equal(priority("blocked-by", "build", { gateDefect: false }), "medium");
  assert.equal(priority("blocked-by", "chain-gap", { gateDefect: false }), "medium");
  assert.equal(priority("parent", "chain-gap", { gateDefect: false }), "medium");
});

test("FAFF-1399: source == review is Medium (when relationship doesn't already route elsewhere)", () => {
  assert.equal(priority("peer", "review", { gateDefect: false }), "medium");
  assert.equal(priority("none", "review", { gateDefect: false }), "medium");
});

test("FAFF-1399: review-sourced items with a HIGHER-priority relationship stay at that higher tier (first match wins)", () => {
  assert.equal(priority("blocker", "review", { gateDefect: false }), "high");
});

test("FAFF-1399: the default row — relationship in {peer, none} and source in {build, orchestrator, chain-gap} — is Low", () => {
  assert.equal(priority("peer", "build", { gateDefect: false }), "low");
  assert.equal(priority("none", "build", { gateDefect: false }), "low");
  assert.equal(priority("peer", "orchestrator", { gateDefect: false }), "low");
  assert.equal(priority("none", "orchestrator", { gateDefect: false }), "low");
  assert.equal(priority("peer", "chain-gap", { gateDefect: false }), "low");
});

test("FAFF-1399: orchestrator-lane default (relationship: none, source: orchestrator, no gate_defect) is Low", () => {
  assert.equal(priority("none", "orchestrator"), "low");
});

test("FAFF-1399: chain-gap sub-type mapping — upstream (blocker) High, downstream (blocked-by) Medium, sub-ticket (parent) Medium, peer Low", () => {
  assert.equal(priority("blocker", "chain-gap"), "high");
  assert.equal(priority("blocked-by", "chain-gap"), "medium");
  assert.equal(priority("parent", "chain-gap"), "medium");
  assert.equal(priority("peer", "chain-gap"), "low");
});

test("FAFF-1399: prints exactly one of high/medium/low to stdout and nothing else", () => {
  const r = run(["--relationship", "blocker", "--source", "build"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^(high|medium|low)\n$/);
});

test("FAFF-1399: an invalid --relationship or --source fails loud (exit non-zero), never a silent 'unknown' default", () => {
  const badRelationship = run(["--relationship", "bogus", "--source", "build"]);
  assert.notEqual(badRelationship.status, 0);
  const badSource = run(["--relationship", "blocker", "--source", "bogus"]);
  assert.notEqual(badSource.status, 0);
});

test("FAFF-1399: missing --relationship or --source fails loud rather than guessing", () => {
  assert.notEqual(run(["--source", "build"]).status, 0);
  assert.notEqual(run(["--relationship", "blocker"]).status, 0);
});

test("FAFF-1399: --selftest exercises the full table and reports PASS", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// Static-text regression guards over the committed SKILL.md prose (the FAFF-1363 precedent) — these
// changes are prose-only at the three filing call sites, so a live CLI test can't exercise the
// tracker-write/no-op fallback or the write-once comment convention; the committed text is the
// behaviour. Scoped to exact, hard-to-drift phrases so a later prose edit that genuinely changes the
// fallback or convention trips the guard rather than silently diverging from the spec's DONE.

test("FAFF-1399: an absent `priority` (vague, or a legacy pre-feature entry) files with no tracker priority and no comment — documented at every filing call site that reads a stored priority", () => {
  const graft = readFileSync(GRAFT_SKILL, "utf8");
  const beepboop = readFileSync(BEEPBOOP_SKILL, "utf8");
  assert.match(graft, /priority.*is.*absent.*files exactly as before/s, "Step 12 must document the absent-priority fallback");
  assert.match(beepboop, /priority.*is.*absent.*files exactly as before/s, "beep-boop §10 sub-step 5 must document the absent-priority fallback");
});

test("FAFF-1399: tidy's chain-gap filing documents the --source chain-gap wiring and its own CLI-failure fallback (it computes priority fresh, so it never reads a stored `absent`)", () => {
  const tidy = readFileSync(TIDY_SKILL, "utf8");
  assert.match(tidy, /--source chain-gap/, "tidy must call the priority CLI with --source chain-gap");
  assert.match(tidy, /CLI failure degrades to no tracker priority \+ no comment/, "tidy must document its own CLI-failure-at-filing-time fallback");
});

test("FAFF-1399: the priority-reason comment is documented as write-once — never edited or re-posted", () => {
  const graft = readFileSync(GRAFT_SKILL, "utf8");
  assert.match(graft, /write-once/, "the priority-reason comment convention must state write-once");
  assert.match(graft, /never edited or re-posted/, "the priority-reason comment convention must rule out later edits/re-posts");
});

test("FAFF-1399: DiscoveredScopeEntry's schema block documents both new fields", () => {
  const graft = readFileSync(GRAFT_SKILL, "utf8");
  assert.match(graft, /"gate_defect":\s*false/, "the DiscoveredScopeEntry JSON example must carry gate_defect");
  assert.match(graft, /"priority":\s*"high\|medium\|low\|absent"/, "the DiscoveredScopeEntry JSON example must carry the priority enum");
});

test("FAFF-1399: every filing call site references the same shared priority-reason comment shape rather than restating it", () => {
  const graft = readFileSync(GRAFT_SKILL, "utf8");
  const beepboop = readFileSync(BEEPBOOP_SKILL, "utf8");
  const tidy = readFileSync(TIDY_SKILL, "utf8");
  assert.match(graft, /The priority-reason comment/, "faff-graft/SKILL.md must define the shared comment shape once");
  assert.match(beepboop, /do not restate it/, "beep-boop must reference, not restate, the shared comment shape");
  assert.match(tidy, /do not restate it/, "tidy must reference, not restate, the shared comment shape at least once");
});
