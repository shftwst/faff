// FAFF-888 — spec-review-reputation: the selection-time per-backend reputation ledger that
// strikes a candidate-degenerate spec_review reviewer. Covers the pure core (block/overturn
// arithmetic, the two-gate AND, the (run_id, round) accept-ordering), filterEligible's
// strike-but-never-empty rule, the gatherers over a fixture .faff/runs, the CLI contract
// (--report / --eligible / --selftest / fail-loud exits), and the occupant wiring in
// faffter-dark-spec-review/SKILL.md this guard plugs into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  computeReputation,
  filterEligible,
  gatherReviewFacts,
  gatherOutcomeFacts,
  MIN_SAMPLE,
  BLOCK_RATE_FLAG,
  OVERTURN_RATE_FLAG,
  REPUTATION_SCAN,
} from "../plugin/skills/faff/bin/lib/spec-review-reputation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DARK_SKILL = join(REPO, "plugin", "skills", "faffter-dark-spec-review", "SKILL.md");
const NOON_SKILL = join(REPO, "plugin", "skills", "faffter-noon-spec-review", "SKILL.md");

const RUN_A = "run-20260101-000000-a";
const RUN_B = "run-20260102-000000-b"; // strictly after A (date-prefixed → chronological)
const RUN_C = "run-20260103-000000-c";
const block = (identity, issue, run_id, round = 1) => ({ identity, issue, run_id, round, verdict: "reject-approach" });
const approve = (identity, issue, run_id, round = 1) => ({ identity, issue, run_id, round, verdict: "approve" });
const ship = (issue, run_id) => ({ issue, run_id, accepted: true });

// --- Constants are the ratified thresholds -------------------------------------------------

test("thresholds are the ratified named constants", () => {
  assert.equal(MIN_SAMPLE, 8);
  assert.equal(BLOCK_RATE_FLAG, 0.9);
  assert.equal(OVERTURN_RATE_FLAG, 0.3);
  assert.equal(REPUTATION_SCAN, 50);
});

// --- Pure core: block/overturn computation + the two-gate AND ------------------------------

test("computeReputation: degenerate backend (10 reviewed, 10 blocked, 4 shipped) is flagged", () => {
  const reviews = [];
  for (let i = 1; i <= 10; i++) reviews.push(block("p|m|h", `I${i}`, RUN_A));
  const outcomes = [ship("I1", RUN_B), ship("I2", RUN_B), ship("I3", RUN_B), ship("I4", RUN_B)];
  const led = computeReputation(reviews, outcomes);
  const b = led.backends["p|m|h"];
  assert.equal(b.reviewed, 10);
  assert.equal(b.blocked, 10);
  assert.equal(b.blocked_then_accepted, 4);
  assert.equal(b.block_rate, 1);
  assert.equal(b.overturn_rate, 0.4);
  assert.equal(b.flagged, true);
  assert.deepEqual(led.flagged, ["p|m|h"]);
});

test("computeReputation: calibrated backend (blocks 5/12, 3 shipped) is NOT flagged — block_rate gate", () => {
  const reviews = [];
  for (let i = 1; i <= 5; i++) reviews.push(block("q|n|h2", `J${i}`, RUN_A));
  for (let i = 6; i <= 12; i++) reviews.push(approve("q|n|h2", `J${i}`, RUN_A));
  const outcomes = [ship("J1", RUN_B), ship("J2", RUN_B), ship("J3", RUN_B)];
  const led = computeReputation(reviews, outcomes);
  const b = led.backends["q|n|h2"];
  assert.equal(b.reviewed, 12);
  assert.equal(b.blocked, 5);
  assert.equal(b.flagged, false, "block_rate 5/12 is below 0.90 → never flagged whatever the overturn-rate");
  assert.deepEqual(led.flagged, []);
});

test("computeReputation: a high block-rate but low overturn-rate is NOT flagged — overturn gate", () => {
  const reviews = [];
  for (let i = 1; i <= 10; i++) reviews.push(block("r|m|h", `Q${i}`, RUN_A)); // blocks everything
  const outcomes = [ship("Q1", RUN_B)]; // only 1/10 overturned → overturn_rate 0.1 < 0.30
  const b = computeReputation(reviews, outcomes).backends["r|m|h"];
  assert.equal(b.block_rate, 1);
  assert.equal(b.overturn_rate, 0.1);
  assert.equal(b.flagged, false);
});

test("computeReputation: under-sampled backend (reviewed 5 < MIN_SAMPLE) is NOT flagged", () => {
  const reviews = [];
  for (let i = 1; i <= 5; i++) reviews.push(block("u|s|h", `K${i}`, RUN_A));
  const outcomes = [ship("K1", RUN_B), ship("K2", RUN_B), ship("K3", RUN_B)];
  assert.equal(computeReputation(reviews, outcomes).backends["u|s|h"].flagged, false);
});

test("computeReputation: needs-human counts as reviewed, never as a block", () => {
  const reviews = [];
  for (let i = 1; i <= 4; i++) reviews.push(block("z|m|h", `P${i}`, RUN_A));
  for (let i = 5; i <= 8; i++) reviews.push({ identity: "z|m|h", issue: `P${i}`, run_id: RUN_A, round: 1, verdict: "needs-human" });
  const b = computeReputation(reviews, []).backends["z|m|h"];
  assert.equal(b.reviewed, 8);
  assert.equal(b.blocked, 4);
});

// --- Pure core: the (run_id, round) accept-ordering ----------------------------------------

test("ordering: an EARLIER-run peer approve does not overturn a later block", () => {
  const reviews = [];
  for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `L${i}`, RUN_B));
  reviews.push(approve("peer|m|h", "L1", RUN_A)); // run A precedes run B
  assert.equal(computeReputation(reviews, []).backends["x|m|h"].blocked_then_accepted, 0);
});

test("ordering: a LATER-run peer approve overturns the block", () => {
  const reviews = [];
  for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `L${i}`, RUN_B));
  reviews.push(approve("peer|m|h", "L1", RUN_C)); // run C follows run B
  assert.equal(computeReputation(reviews, []).backends["x|m|h"].blocked_then_accepted, 1);
});

test("ordering: a SAME-round peer approve does not count (simultaneous, not later)", () => {
  const reviews = [];
  for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `M${i}`, RUN_B, 1));
  reviews.push(approve("peer|m|h", "M1", RUN_B, 1));
  assert.equal(computeReputation(reviews, []).backends["x|m|h"].blocked_then_accepted, 0);
});

test("ordering: a same-run ship (round +∞) beats a review round in that run", () => {
  const reviews = [];
  for (let i = 1; i <= 8; i++) reviews.push(block("y|m|h", `N${i}`, RUN_B, 1));
  assert.equal(computeReputation(reviews, [ship("N1", RUN_B)]).backends["y|m|h"].blocked_then_accepted, 1);
});

test("ordering: the block a later accept must beat is the LATEST block on that issue", () => {
  // identity blocks L1 in run A (round 1) AND run C (round 1); a peer approve in run B is
  // after the run-A block but before the run-C block → must NOT count as an overturn.
  const reviews = [];
  for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `L${i}`, RUN_A));
  reviews.push(block("x|m|h", "L1", RUN_C)); // a later block on L1
  reviews.push(approve("peer|m|h", "L1", RUN_B)); // between the two blocks
  assert.equal(computeReputation(reviews, []).backends["x|m|h"].blocked_then_accepted, 0);
});

// --- Pure core: fail-safe on empty history -------------------------------------------------

test("computeReputation: empty facts → empty ledger, nothing flagged", () => {
  const led = computeReputation([], []);
  assert.deepEqual(led.backends, {});
  assert.deepEqual(led.flagged, []);
});

test("computeReputation: deterministic — identical facts yield byte-identical output", () => {
  const reviews = [];
  for (let i = 1; i <= 10; i++) reviews.push(block("p|m|h", `I${i}`, RUN_A));
  const outcomes = [ship("I1", RUN_B)];
  assert.equal(JSON.stringify(computeReputation(reviews, outcomes)), JSON.stringify(computeReputation(reviews, outcomes)));
});

// --- filterEligible: strike but never empty ------------------------------------------------

test("filterEligible: strikes a flagged backend from the chain", () => {
  const A = { provider: "p", model: "a", host: "h" };
  const B = { provider: "p", model: "b", host: "h" };
  const C = { provider: "p", model: "c", host: "h" };
  const res = filterEligible([A, B, C], new Set(["p|b|h"]));
  assert.deepEqual(res.chain.map((x) => x.model), ["a", "c"]);
  assert.deepEqual(res.struck, ["p|b|h"]);
  assert.equal(res.all_struck, false);
});

test("filterEligible: an all-flagged chain is returned UNCHANGED with all_struck (gate never emptied)", () => {
  const D = { provider: "p", model: "d", host: "h" };
  const res = filterEligible([D], new Set(["p|d|h"]));
  assert.deepEqual(res.chain.map((x) => x.model), ["d"]);
  assert.equal(res.all_struck, true);
  assert.deepEqual(res.struck, ["p|d|h"]);
});

test("filterEligible: nothing flagged → pass-through unchanged", () => {
  const A = { provider: "p", model: "a", host: "h" };
  const res = filterEligible([A], new Set());
  assert.deepEqual(res.chain, [A]);
  assert.deepEqual(res.struck, []);
  assert.equal(res.all_struck, false);
});

// --- Gatherers over a fixture .faff/runs ---------------------------------------------------

function buildFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-"));
  // run A: FAFF-1..FAFF-8 each blocked (terminal round-1 reject-approach), pinned to p|m|h.
  for (let i = 1; i <= 8; i++) {
    const d = join(root, ".faff", "runs", RUN_A, `FAFF-${i}`, "spec-review");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: [{ lens: "QA", severity: "blocker" }] }));
    writeFileSync(join(d, "pinned-reviewer.json"), JSON.stringify({ provider: "p", model: "m", host: "h" }));
  }
  // run B (later): 3 of the blocked specs reach shipped/pr-open.
  const rb = join(root, ".faff", "runs", RUN_B);
  mkdirSync(rb, { recursive: true });
  writeFileSync(join(rb, "run-ledger.json"), JSON.stringify({ outcomes: { "FAFF-1": "shipped", "FAFF-2": "shipped", "FAFF-3": "pr-open" } }));
  return root;
}

test("gatherers: read terminal verdicts + downstream accepts, flag the degenerate backend", () => {
  const root = buildFixtureRoot();
  try {
    const reviewFacts = gatherReviewFacts(root, REPUTATION_SCAN);
    const outcomeFacts = gatherOutcomeFacts(root, REPUTATION_SCAN);
    assert.equal(reviewFacts.length, 8, "8 attributed review facts");
    assert.equal(outcomeFacts.length, 3, "3 downstream accepts");
    const b = computeReputation(reviewFacts, outcomeFacts).backends["p|m|h"];
    assert.equal(b.reviewed, 8);
    assert.equal(b.block_rate, 1);
    assert.equal(b.blocked_then_accepted, 3);
    assert.equal(b.flagged, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("gatherers: a spec-review dir with no pin sidecar contributes no review fact (skipped)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-nopin-"));
  try {
    const d = join(root, ".faff", "runs", RUN_A, "FAFF-1", "spec-review");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: [] }));
    // no pinned-reviewer.json
    assert.deepEqual(gatherReviewFacts(root, REPUTATION_SCAN), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("gatherers: absent .faff/runs degrades to empty lists (fresh adopter, zero behaviour change)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-empty-"));
  try {
    assert.deepEqual(gatherReviewFacts(root, REPUTATION_SCAN), []);
    assert.deepEqual(gatherOutcomeFacts(root, REPUTATION_SCAN), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("gatherers: a present-but-corrupt round record is fail-loud", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-bad-"));
  try {
    const d = join(root, ".faff", "runs", RUN_A, "FAFF-1", "spec-review");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "round-1.json"), "{ not valid json");
    writeFileSync(join(d, "pinned-reviewer.json"), JSON.stringify({ provider: "p", model: "m", host: "h" }));
    assert.throws(() => gatherReviewFacts(root, REPUTATION_SCAN), /malformed spec-review round record/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- CLI contract --------------------------------------------------------------------------

test("CLI --selftest exits 0 and reports PASS", () => {
  const r = runCli(["spec-review-reputation", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("CLI --report prints the ReputationLedger JSON flagging the degenerate backend", () => {
  const root = buildFixtureRoot();
  try {
    const r = runCli(["spec-review-reputation", "--report", "--root", root, "--now", "2026-08-27T00:00:00Z"]);
    assert.equal(r.code, 0);
    const led = JSON.parse(r.stdout);
    assert.equal(led.scan, REPUTATION_SCAN);
    assert.equal(led.min_sample, 8);
    assert.deepEqual(led.flagged, ["p|m|h"]);
    assert.equal(led.backends["p|m|h"].flagged, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI --eligible strikes the flagged identity and keeps a clean one", () => {
  const root = buildFixtureRoot();
  try {
    const chainFile = join(root, "chain.json");
    writeFileSync(chainFile, JSON.stringify([{ provider: "p", model: "m", host: "h" }, { provider: "q", model: "n", host: "h2" }]));
    const r = runCli(["spec-review-reputation", "--eligible", "--backends-json", chainFile, "--root", root, "--json"]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.chain, [{ provider: "q", model: "n", host: "h2" }]);
    assert.deepEqual(out.struck, ["p|m|h"]);
    assert.equal(out.all_struck, false);
    // default (no --json) prints the bare struck chain array — byte-compatible with the pin output.
    const bare = runCli(["spec-review-reputation", "--eligible", "--backends-json", chainFile, "--root", root]);
    assert.deepEqual(JSON.parse(bare.stdout), [{ provider: "q", model: "n", host: "h2" }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI --eligible on an all-flagged chain returns it unchanged (fail-safe: gate never emptied)", () => {
  const root = buildFixtureRoot();
  try {
    const chainFile = join(root, "chain.json");
    writeFileSync(chainFile, JSON.stringify([{ provider: "p", model: "m", host: "h" }]));
    const r = runCli(["spec-review-reputation", "--eligible", "--backends-json", chainFile, "--root", root, "--json"]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.chain, [{ provider: "p", model: "m", host: "h" }]);
    assert.equal(out.all_struck, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI --eligible on a fresh adopter (no history) passes the chain through unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-fresh-"));
  try {
    const chainFile = join(root, "chain.json");
    const chain = [{ provider: "p", model: "m", host: "h" }, { provider: "q", model: "n", host: "h2" }];
    writeFileSync(chainFile, JSON.stringify(chain));
    const r = runCli(["spec-review-reputation", "--eligible", "--backends-json", chainFile, "--root", root]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), chain);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI --eligible with a missing/unreadable --backends-json is fail-loud (exit 2)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-miss-"));
  try {
    const r = runCli(["spec-review-reputation", "--eligible", "--backends-json", join(root, "nope.json"), "--root", root]);
    assert.equal(r.code, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI requires exactly one of --report / --eligible", () => {
  assert.equal(runCli(["spec-review-reputation"]).code, 2);
  assert.equal(runCli(["spec-review-reputation", "--report", "--eligible"]).code, 2);
});

// --- Occupant wiring: the guard is actually consulted --------------------------------------

test("faffter-dark-spec-review occupant wires the round-1 --eligible reputation filter", () => {
  const body = readFileSync(DARK_SKILL, "utf8");
  assert.match(body, /spec-review-reputation --eligible --backends-json "\$backends_json" --consumer spec_review/,
    "the chain-resolution block pipes the resolved chain through the reputation filter");
  assert.match(body, /if \[ ! -e "\$pin_dir\/pinned-reviewer\.json" \]/,
    "the consult is gated to round 1 (unpinned — no pin sidecar yet)");
});

test("the single-pass faffter-noon-spec-review default resolves no chain and is NOT wired", () => {
  const body = readFileSync(NOON_SKILL, "utf8");
  assert.doesNotMatch(body, /spec-review-reputation/, "the single-pass default has no adversarial chain to filter");
});
