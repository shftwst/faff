// ===========================================================================
// === region:factory — spec-review-reputation — FAFF-888: the DETERMINISTIC ===
// per-backend reputation ledger that strikes a candidate-degenerate spec_review
// reviewer at slot-selection time. A mono-severity backend that stamps every lens
// `critical` forces `reject-approach` every round and parks the run at the loop cap
// no matter how good the spec is (aggregate.mjs's `anyCritical` veto, correct by
// design, honours it faithfully). Nothing upstream of the aggregator checks whether
// the reviewer can EVER pass a spec. This module is that check — a bar on slot
// selection (voir-dire: strike a juror for cause BEFORE the trial, never mid-
// deliberation), computed by arithmetic over outcomes faff already records.
//
// RECOMPUTE-ON-READ, no materialized store (unblocked on FAFF-459's held learned.yaml
// carrier). Mirrors park-history's deterministic-counting pattern: a fixed run-count
// scan (newest 50), an injected `--now` (no ambient clock → replayable), a pure core
// (`computeReputation`/`filterEligible`, unit-tested directly), gatherers that read the
// run artifacts, and a `--selftest` fixture table. No LLM re-reads anything; the ledger
// is counts, rates, and fixed thresholds.
//
// The evidence, both halves already on disk:
//   - what each backend DECIDED — the terminal `round-<n>.json` `{verdict}`, attributed
//     to a serving identity via the `pinned-reviewer.json` sidecar (spec-review-pin.js).
//   - what LATER happened to the specs it blocked — the run-ledger `outcomes[issue]`
//     (shipped/pr-open), the shipped `issue-outcome` event, or a strictly-later non-reject
//     spec-review verdict by any backend. The downstream accept is the "was this spec
//     actually bad?" ground truth a curated eval set would otherwise have to supply.
//
// Flag a backend candidate-degenerate iff, over a sample at/above MIN_SAMPLE, it blocked
// at/above BLOCK_RATE_FLAG of what it reviewed AND at/above OVERTURN_RATE_FLAG of what it
// blocked was accepted downstream. The two-gate AND is the mitigation for the overturn
// proxy over-counting an ordinary revision: a discriminating backend (block_rate < 0.90)
// is never flagged whatever its overturn-rate. FAIL TOWARD THE GATE: `--eligible` strikes
// flagged identities but NEVER empties the chain — an all-flagged input is returned
// unchanged with `all_struck` set, because a degenerate sole gatekeeper with no configured
// alternative is an operator-widen-the-pool signal, not a licence to skip the gate.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { backendIdentity } = require("./spec-review-pin");
const { roundNumberFromPath } = require("./spec-review-churn");

// Fixed gateway defaults (not .faffrc knobs — mirrors park-history). The first knobs to
// revisit under calibration, so they live in exactly one named-constant block.
const REPUTATION_SCAN = 50;      // newest N run dirs scanned under .faff/runs
const MIN_SAMPLE = 8;            // a backend needs >= this many distinct reviewed specs before it can be flagged
const BLOCK_RATE_FLAG = 0.90;    // flagged only if it blocked >= this fraction of the specs it reviewed
const OVERTURN_RATE_FLAG = 0.30; // AND >= this fraction of what it blocked was accepted downstream

// The contract's spec-review verdict enum (contract-defs.js). Only `reject-approach`
// is a block; `needs-human` is a transport/floor outcome, not a review judgement, and
// is neither a block nor an accept. `approve`/`revise` are the non-reject peer-accept set.
const BLOCK_VERDICT = "reject-approach";
const NON_REJECT_VERDICTS = new Set(["approve", "revise"]);

// ---------------------------------------------------------------------------
// Ordering (resolves the temporal-ordering gap). orderKey(run_id, round) = [run_id, round],
// compared lexically on run_id (date-prefixed → chronological) then numerically on round.
// A ship/pr-open/shipped-event accept sorts at [run_id, +Infinity] — after every review
// round in the run it was recorded in. An accept overturns a block only when its orderKey
// is STRICTLY GREATER than the block's; a same-run ship beats any review round, a same-round
// peer approve does NOT (simultaneous, not later).
// ---------------------------------------------------------------------------
function cmpOrderKey(aRun, aRound, bRun, bRound) {
  if (aRun < bRun) return -1;
  if (aRun > bRun) return 1;
  if (aRound < bRound) return -1;
  if (aRound > bRound) return 1;
  return 0;
}

// PURE core: given the review facts and the downstream-accept facts, compute the
// per-backend reputation ledger. No I/O — unit-tested directly, like computeParkHistory.
//   reviewFacts:  [{ identity, issue, run_id, round, verdict }]  — one per (backend, issue)
//                 terminal spec-review in a run; (run_id, round) is its ordering key. The
//                 non-reject facts here ALSO serve as the peer-accept source.
//   outcomeFacts: [{ issue, run_id, accepted }]  — the ship/pr-open/shipped-event accept,
//                 one per (issue, run); run_id anchors it at (run_id, +Infinity).
//   opts:         { min_sample?, block_rate_flag?, overturn_rate_flag? }  — default CONSTANTS.
function computeReputation(reviewFacts, outcomeFacts, opts) {
  const o = opts || {};
  const minSample = o.min_sample != null ? o.min_sample : MIN_SAMPLE;
  const blockRateFlag = o.block_rate_flag != null ? o.block_rate_flag : BLOCK_RATE_FLAG;
  const overturnRateFlag = o.overturn_rate_flag != null ? o.overturn_rate_flag : OVERTURN_RATE_FLAG;

  const reviews = Array.isArray(reviewFacts) ? reviewFacts : [];
  const outcomes = Array.isArray(outcomeFacts) ? outcomeFacts : [];

  // shipRuns[issue] = Set of run_ids with a ship/pr-open accept (each sorts at (run_id, +Inf)).
  const shipRuns = new Map();
  for (const oc of outcomes) {
    if (!oc || typeof oc !== "object" || !oc.accepted) continue;
    if (typeof oc.issue !== "string" || typeof oc.run_id !== "string") continue;
    if (!shipRuns.has(oc.issue)) shipRuns.set(oc.issue, new Set());
    shipRuns.get(oc.issue).add(oc.run_id);
  }

  // peerAccepts[issue] = [{ run_id, round }] for every non-reject review verdict on the issue
  // (any backend). The "later non-reject verdict" accept signal is derived from these facts,
  // never carried in outcomeFacts.
  const peerAccepts = new Map();
  for (const f of reviews) {
    if (!f || typeof f !== "object") continue;
    if (typeof f.issue !== "string" || typeof f.run_id !== "string") continue;
    if (!NON_REJECT_VERDICTS.has(f.verdict)) continue;
    if (!peerAccepts.has(f.issue)) peerAccepts.set(f.issue, []);
    peerAccepts.get(f.issue).push({ run_id: f.run_id, round: f.round });
  }

  // Group review facts by identity → { issues: Set, blocksByIssue: Map<issue, maxOrderKey> }.
  const byIdentity = new Map();
  for (const f of reviews) {
    if (!f || typeof f !== "object") continue;
    if (typeof f.identity !== "string" || typeof f.issue !== "string" || typeof f.run_id !== "string") continue;
    if (typeof f.verdict !== "string") continue;
    let rec = byIdentity.get(f.identity);
    if (!rec) { rec = { issues: new Set(), blocksByIssue: new Map() }; byIdentity.set(f.identity, rec); }
    rec.issues.add(f.issue);
    if (f.verdict === BLOCK_VERDICT) {
      // blockPos(i) = MAX orderKey over this identity's reject-approach facts on i.
      const prev = rec.blocksByIssue.get(f.issue);
      const cand = { run_id: f.run_id, round: f.round };
      if (!prev || cmpOrderKey(cand.run_id, cand.round, prev.run_id, prev.round) > 0) {
        rec.blocksByIssue.set(f.issue, cand);
      }
    }
  }

  // accepted_after(issue, pos): a ship in the block's run or later, OR a strictly-later
  // non-reject peer verdict.
  function acceptedAfter(issue, pos) {
    const ships = shipRuns.get(issue);
    if (ships) {
      for (const r of ships) {
        // ship sorts at (r, +Inf); counts iff (r, +Inf) > pos.
        if (cmpOrderKey(r, Infinity, pos.run_id, pos.round) > 0) return true;
      }
    }
    const peers = peerAccepts.get(issue);
    if (peers) {
      for (const k of peers) {
        if (cmpOrderKey(k.run_id, k.round, pos.run_id, pos.round) > 0) return true;
      }
    }
    return false;
  }

  const backends = {};
  for (const identity of Array.from(byIdentity.keys()).sort()) {
    const rec = byIdentity.get(identity);
    const reviewed = rec.issues.size;
    const blocked = rec.blocksByIssue.size;
    let blockedThenAccepted = 0;
    for (const [issue, pos] of rec.blocksByIssue) {
      if (acceptedAfter(issue, pos)) blockedThenAccepted++;
    }
    const blockRate = reviewed === 0 ? 0 : blocked / reviewed;
    const overturnRate = blocked === 0 ? 0 : blockedThenAccepted / blocked;
    const flagged = reviewed >= minSample && blockRate >= blockRateFlag && overturnRate >= overturnRateFlag;
    backends[identity] = {
      identity,
      reviewed,
      blocked,
      blocked_then_accepted: blockedThenAccepted,
      block_rate: blockRate,
      overturn_rate: overturnRate,
      flagged,
    };
  }

  const flaggedList = Object.keys(backends).filter((id) => backends[id].flagged).sort();
  return {
    scan: o.scan != null ? o.scan : REPUTATION_SCAN,
    min_sample: minSample,
    block_rate_flag: blockRateFlag,
    overturn_rate_flag: overturnRateFlag,
    backends,
    flagged: flaggedList,
  };
}

// PURE: strike any chain element whose backendIdentity is in flaggedSet. NEVER empties:
// if every element is struck, the chain is returned UNCHANGED with all_struck:true, because
// the gate must survive (fail-closed) — an all-struck chain is an operator-attention signal,
// not a bypass.
function filterEligible(chain, flaggedSet) {
  const arr = Array.isArray(chain) ? chain : [];
  const kept = arr.filter((b) => !flaggedSet.has(backendIdentity(b)));
  const struck = arr.filter((b) => flaggedSet.has(backendIdentity(b))).map(backendIdentity);
  if (kept.length === 0 && arr.length > 0) {
    return { chain: arr, struck, all_struck: true }; // input order unchanged; gate never emptied
  }
  return { chain: kept, struck, all_struck: false };
}

// ---------------------------------------------------------------------------
// Gatherers (filesystem reads; mirror gatherParks). A merely-ABSENT artifact degrades to
// "no fact from that run"; a present-but-corrupt round record / run-ledger.json is fail-loud.
// ---------------------------------------------------------------------------

// newest `scan` run dir names under root/.faff/runs (lexical-desc == chronological; run-ids
// are date-prefixed), else [].
function newestRunIds(root, scan) {
  const runsDir = path.join(root, ".faff", "runs");
  let names;
  try { names = fs.readdirSync(runsDir); } catch { return []; }
  return names
    .filter((name) => { try { return fs.statSync(path.join(runsDir, name)).isDirectory(); } catch { return false; } })
    .sort().reverse()
    .slice(0, scan);
}

// gatherReviewFacts(root, scan) -> [{ identity, issue, run_id, round, verdict }]. Per run, per
// <ISSUE>/spec-review/ dir: the terminal round (highest round-<n>.json), its verdict, and the
// backend read from pinned-reviewer.json. A dir with no attributable backend (no/corrupt pin
// sidecar) contributes NO fact and is skipped, exactly as computeParkHistory skips a bad record.
function gatherReviewFacts(root, scan) {
  const runsDir = path.join(root, ".faff", "runs");
  const facts = [];
  for (const runId of newestRunIds(root, scan)) {
    const runPath = path.join(runsDir, runId);
    let issues;
    try { issues = fs.readdirSync(runPath); } catch { continue; }
    for (const issue of issues) {
      const srDir = path.join(runPath, issue, "spec-review");
      let entries;
      try {
        if (!fs.statSync(srDir).isDirectory()) continue;
        entries = fs.readdirSync(srDir);
      } catch { continue; } // no spec-review dir for this issue → no fact
      // terminal round = highest round-<n>.json
      let terminalRound = null; let terminalFile = null;
      for (const e of entries) {
        const n = roundNumberFromPath(e);
        if (n == null) continue;
        if (terminalRound == null || n > terminalRound) { terminalRound = n; terminalFile = e; }
      }
      if (terminalRound == null) continue; // no round records → no fact

      // attribution — the pin sidecar. Absent/corrupt → un-attributable → skip the fact.
      let identity = null;
      try {
        const pin = JSON.parse(fs.readFileSync(path.join(srDir, "pinned-reviewer.json"), "utf8"));
        if (pin && typeof pin === "object" && !Array.isArray(pin)) identity = backendIdentity(pin);
      } catch { identity = null; }
      if (!identity || identity === "|") continue;

      // the terminal round's verdict — a present-but-corrupt record is fail-loud.
      let verdict;
      const recPath = path.join(srDir, terminalFile);
      let raw;
      try { raw = fs.readFileSync(recPath, "utf8"); } catch { continue; } // vanished between readdir and read → skip
      let rec;
      try { rec = JSON.parse(raw); }
      catch (e) { throw new Error(`malformed spec-review round record '${recPath}': ${e.message}`); }
      if (!rec || typeof rec !== "object" || typeof rec.verdict !== "string") continue; // valid JSON, no verdict → skip (defensive)
      verdict = rec.verdict;

      facts.push({ identity, issue, run_id: runId, round: terminalRound, verdict });
    }
  }
  return facts;
}

// gatherOutcomeFacts(root, scan) -> [{ issue, run_id, accepted:true }]. Per (issue, run):
// accepted iff run-ledger.json outcomes[issue] in {shipped, pr-open}, OR an issue-outcome
// event with data.outcome == "shipped". A present-but-corrupt run-ledger.json is fail-loud;
// an absent one, or an absent/partial events.jsonl, degrades to no fact (never a crash).
function gatherOutcomeFacts(root, scan) {
  const runsDir = path.join(root, ".faff", "runs");
  const facts = [];
  for (const runId of newestRunIds(root, scan)) {
    const seen = new Set(); // dedup (issue) within this run — one accept fact per (issue, run)
    const add = (issue) => { if (typeof issue === "string" && !seen.has(issue)) { seen.add(issue); facts.push({ issue, run_id: runId, accepted: true }); } };

    // primary: run-ledger.json outcomes map.
    const ledgerPath = path.join(runsDir, runId, "run-ledger.json");
    let ledgerRaw = null;
    try { ledgerRaw = fs.readFileSync(ledgerPath, "utf8"); } catch { ledgerRaw = null; } // absent → degrade
    if (ledgerRaw != null) {
      let ledger;
      try { ledger = JSON.parse(ledgerRaw); }
      catch (e) { throw new Error(`malformed run-ledger.json '${ledgerPath}': ${e.message}`); }
      const outcomes = ledger && typeof ledger === "object" ? ledger.outcomes : null;
      if (outcomes && typeof outcomes === "object") {
        for (const issue of Object.keys(outcomes)) {
          if (outcomes[issue] === "shipped" || outcomes[issue] === "pr-open") add(issue);
        }
      }
    }

    // corroborating: issue-outcome shipped events (append-only log; a partial/garbled line degrades).
    const eventsPath = path.join(runsDir, runId, "events.jsonl");
    let eventsRaw = null;
    try { eventsRaw = fs.readFileSync(eventsPath, "utf8"); } catch { eventsRaw = null; }
    if (eventsRaw != null) {
      for (const line of eventsRaw.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        let ev;
        try { ev = JSON.parse(s); } catch { continue; } // tolerate a partial trailing line
        if (ev && ev.type === "issue-outcome" && ev.data && ev.data.outcome === "shipped") add(ev.issue);
      }
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Selftest fixture table — exercised by --selftest and test/spec-review-reputation.test.mjs.
// ---------------------------------------------------------------------------
function block(identity, issue, run_id, round) { return { identity, issue, run_id, round: round == null ? 1 : round, verdict: "reject-approach" }; }
function approve(identity, issue, run_id, round) { return { identity, issue, run_id, round: round == null ? 1 : round, verdict: "approve" }; }
function ship(issue, run_id) { return { issue, run_id, accepted: true }; }

const RUN_A = "run-20260101-000000-a";
const RUN_B = "run-20260102-000000-b";
const RUN_C = "run-20260103-000000-c";

function specReviewReputationSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };

  // Scenario: 10 reviewed, 10 blocked, 4 later shipped → FLAGGED.
  {
    const reviews = []; for (let i = 1; i <= 10; i++) reviews.push(block("p|m|h", `I${i}`, RUN_A, 1));
    const outcomes = [ship("I1", RUN_B), ship("I2", RUN_B), ship("I3", RUN_B), ship("I4", RUN_B)];
    const led = computeReputation(reviews, outcomes);
    const b = led.backends["p|m|h"];
    ok("degenerate: reviewed 10 / blocked 10 / overturn 0.4 → flagged", b.reviewed === 10 && b.blocked === 10 && b.blocked_then_accepted === 4 && b.flagged === true);
    ok("degenerate: appears in the sorted flagged list", led.flagged.length === 1 && led.flagged[0] === "p|m|h");
  }

  // Scenario: calibrated backend blocks 5 of 12, 3 shipped → NOT flagged (block_rate 0.42 < 0.90).
  {
    const reviews = [];
    for (let i = 1; i <= 5; i++) reviews.push(block("q|n|h2", `J${i}`, RUN_A, 1));
    for (let i = 6; i <= 12; i++) reviews.push(approve("q|n|h2", `J${i}`, RUN_A, 1));
    const outcomes = [ship("J1", RUN_B), ship("J2", RUN_B), ship("J3", RUN_B)];
    const led = computeReputation(reviews, outcomes);
    const b = led.backends["q|n|h2"];
    ok("calibrated: block_rate 5/12 below 0.90 → not flagged", b.reviewed === 12 && b.blocked === 5 && b.flagged === false);
    ok("calibrated: not in flagged list", led.flagged.length === 0);
  }

  // Scenario: 5 reviewed all blocked, 3 shipped → NOT flagged (below MIN_SAMPLE 8).
  {
    const reviews = []; for (let i = 1; i <= 5; i++) reviews.push(block("u|s|h", `K${i}`, RUN_A, 1));
    const outcomes = [ship("K1", RUN_B), ship("K2", RUN_B), ship("K3", RUN_B)];
    const led = computeReputation(reviews, outcomes);
    ok("under-sampled: reviewed 5 < MIN_SAMPLE 8 → not flagged", led.backends["u|s|h"].flagged === false);
  }

  // Ordering: an EARLIER-run peer approve does NOT overturn a later block.
  {
    const reviews = []; for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `L${i}`, RUN_B, 1));
    reviews.push(approve("peer|m|h", "L1", RUN_A, 1)); // approve at run A (EARLIER than the block at run B)
    const led = computeReputation(reviews, []);
    ok("ordering: earlier-run peer approve is NOT counted (orderKey precedes the block)", led.backends["x|m|h"].blocked_then_accepted === 0);
  }

  // Ordering: a LATER-run peer approve DOES overturn the block.
  {
    const reviews = []; for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `L${i}`, RUN_B, 1));
    reviews.push(approve("peer|m|h", "L1", RUN_C, 1)); // approve at run C (LATER than the block at run B)
    const led = computeReputation(reviews, []);
    ok("ordering: later-run peer approve IS counted (orderKey strictly after the block)", led.backends["x|m|h"].blocked_then_accepted === 1);
  }

  // Ordering: a SAME-round peer approve does NOT count (simultaneous, not later).
  {
    const reviews = []; for (let i = 1; i <= 8; i++) reviews.push(block("x|m|h", `M${i}`, RUN_B, 1));
    reviews.push(approve("peer|m|h", "M1", RUN_B, 1)); // same run, same round as the block
    const led = computeReputation(reviews, []);
    ok("ordering: same-round peer approve is NOT counted (simultaneous)", led.backends["x|m|h"].blocked_then_accepted === 0);
  }

  // Ordering: a same-run ship (round +Inf) DOES beat a review round in that run.
  {
    const reviews = []; for (let i = 1; i <= 8; i++) reviews.push(block("y|m|h", `N${i}`, RUN_B, 1));
    const led = computeReputation(reviews, [ship("N1", RUN_B)]); // ship recorded in the block's own run
    ok("ordering: same-run ship beats the block round (+Inf > any round)", led.backends["y|m|h"].blocked_then_accepted === 1);
  }

  // needs-human is neither a block nor an accept.
  {
    const reviews = [];
    for (let i = 1; i <= 4; i++) reviews.push(block("z|m|h", `P${i}`, RUN_A, 1));
    for (let i = 5; i <= 8; i++) reviews.push({ identity: "z|m|h", issue: `P${i}`, run_id: RUN_A, round: 1, verdict: "needs-human" });
    const led = computeReputation(reviews, []);
    const b = led.backends["z|m|h"];
    ok("needs-human: counts as reviewed, never as a block", b.reviewed === 8 && b.blocked === 4);
  }

  // filterEligible: [A,B,C] with B flagged → [A,C], struck [id(B)], not all_struck.
  {
    const A = { provider: "p", model: "a", host: "h" };
    const B = { provider: "p", model: "b", host: "h" };
    const C = { provider: "p", model: "c", host: "h" };
    const res = filterEligible([A, B, C], new Set([backendIdentity(B)]));
    ok("filterEligible: strikes the flagged element", res.chain.length === 2 && res.chain[0].model === "a" && res.chain[1].model === "c");
    ok("filterEligible: struck names the flagged identity", res.struck.length === 1 && res.struck[0] === backendIdentity(B) && res.all_struck === false);
  }

  // filterEligible: all-flagged → chain returned UNCHANGED, all_struck:true (gate never emptied).
  {
    const D = { provider: "p", model: "d", host: "h" };
    const res = filterEligible([D], new Set([backendIdentity(D)]));
    ok("filterEligible: all-flagged returns the input unchanged (never empty)", res.chain.length === 1 && res.chain[0].model === "d");
    ok("filterEligible: all-flagged sets all_struck:true", res.all_struck === true && res.struck.length === 1);
  }

  // filterEligible: nothing flagged → chain passes through unchanged, all_struck:false, struck [].
  {
    const A = { provider: "p", model: "a", host: "h" };
    const res = filterEligible([A], new Set());
    ok("filterEligible: no flags → pass-through unchanged", res.chain.length === 1 && res.struck.length === 0 && res.all_struck === false);
  }

  // Determinism: the same facts always yield byte-identical output.
  {
    const reviews = []; for (let i = 1; i <= 10; i++) reviews.push(block("p|m|h", `I${i}`, RUN_A, 1));
    const outcomes = [ship("I1", RUN_B)];
    const a = JSON.stringify(computeReputation(reviews, outcomes));
    const b = JSON.stringify(computeReputation(reviews, outcomes));
    ok("deterministic: identical facts → byte-identical ledger", a === b);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-reputation, ${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const SPEC_REVIEW_REPUTATION_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--report": { arity: 0 },
    "--eligible": { arity: 0 },
    "--backends-json": { arity: 1 },
    "--consumer": { arity: 1 },
    "--now": { arity: 1 },   // accepted for interface parity + determinism echo; no time-decay reads it
    "--root": { arity: 1 },
    "--scan": { arity: 1 },
    "--json": { arity: 0 },
  },
};
const SPEC_REVIEW_REPUTATION_USAGE =
  "usage: faff spec-review-reputation (--report | --eligible --backends-json FILE) " +
  "[--consumer NAME] [--now ISO] [--root DIR] [--scan N] [--json]";

function cmdSpecReviewReputation(args) {
  if (args.includes("--selftest")) return specReviewReputationSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_REPUTATION_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_REPUTATION_USAGE);

  const isReport = values["--report"];
  const isEligible = values["--eligible"];
  if (!!isReport === !!isEligible) {
    return usageError([{ code: "missing-value", detail: "exactly one of --report / --eligible is required" }], SPEC_REVIEW_REPUTATION_USAGE);
  }

  const root = values["--root"] || findRoot();
  let scan = REPUTATION_SCAN;
  if (values["--scan"] != null) {
    scan = Number(values["--scan"]);
    if (!Number.isInteger(scan) || scan <= 0) {
      process.stderr.write(`faff spec-review-reputation: --scan '${values["--scan"]}' must be a positive integer\n`);
      return 2;
    }
  }

  // Compute the ledger (fail-loud on a corrupt round record / run-ledger.json).
  let ledger;
  try {
    const reviewFacts = gatherReviewFacts(root, scan);
    const outcomeFacts = gatherOutcomeFacts(root, scan);
    ledger = computeReputation(reviewFacts, outcomeFacts, { scan });
  } catch (e) {
    process.stderr.write(`faff spec-review-reputation: ${e.message}\n`);
    return 2;
  }

  if (isReport) {
    console.log(JSON.stringify(ledger));
    return 0;
  }

  // --eligible: strike flagged identities from the assembled chain, never emptying it.
  if (values["--backends-json"] == null) {
    return usageError([{ code: "missing-value", detail: "--backends-json FILE is required for --eligible" }], SPEC_REVIEW_REPUTATION_USAGE);
  }
  let chain;
  try {
    chain = JSON.parse(fs.readFileSync(values["--backends-json"], "utf8"));
  } catch (e) {
    // missing/unreadable/unparseable FILE → fail-loud (plumbing breakage, not a legitimate degrade).
    process.stderr.write(`faff spec-review-reputation: --backends-json could not be read as JSON: ${e && e.message}\n`);
    return 2;
  }
  if (!Array.isArray(chain)) {
    process.stderr.write("faff spec-review-reputation: --backends-json must contain a JSON array of backend objects\n");
    return 2;
  }
  const res = filterEligible(chain, new Set(ledger.flagged));
  // Operator-attention advisory on STDERR (never stdout — the bare chain stays byte-compatible
  // with adversarial-backends / spec-review-pin, the drop-in-filter guarantee). The occupant
  // consumes the default bare-array stdout, which cannot itself carry `all_struck`, so surface it
  // here where a run log / operator can see it: an all-flagged chain is preserved with the gate
  // intact, but the operator is advised to widen the backend pool (the strike was a no-op).
  if (res.all_struck) {
    process.stderr.write(`faff spec-review-reputation: every candidate backend is flagged candidate-degenerate (${res.struck.join(", ")}) — the chain is preserved UNCHANGED with the gate intact, but the reviewer pool should be widened\n`);
  } else if (res.struck.length) {
    process.stderr.write(`faff spec-review-reputation: struck ${res.struck.length} candidate-degenerate backend(s) from the chain: ${res.struck.join(", ")}\n`);
  }
  // Default: the bare struck chain array (byte-compatible with adversarial-backends /
  // spec-review-pin output, so it is a drop-in filter). --json: the { chain, struck, all_struck } wrapper.
  console.log(JSON.stringify(values["--json"] ? { chain: res.chain, struck: res.struck, all_struck: res.all_struck } : res.chain));
  return 0;
}

module.exports = {
  REPUTATION_SCAN,
  MIN_SAMPLE,
  BLOCK_RATE_FLAG,
  OVERTURN_RATE_FLAG,
  cmpOrderKey,
  computeReputation,
  filterEligible,
  gatherReviewFacts,
  gatherOutcomeFacts,
  cmdSpecReviewReputation,
  specReviewReputationSelftest,
};
