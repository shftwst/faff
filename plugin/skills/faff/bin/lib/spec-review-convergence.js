// ===========================================================================
// === region:factory — spec-review-convergence — FAFF-874: let the loop cap yield to a converging reviewer ===
// The prep↔review Spec-review gate's 2-iteration count cap (faff-prep/SKILL.md's Loop cap
// paragraph) force-parks `needs-human` on the third unresolved revise/reject-approach — it
// counts ROUNDS, not agreement, so a reviewer that is measurably CONVERGING (its total
// objection count strictly falling round-on-round, its remaining objections all in-place-
// fixable, and no new lens objecting) is parked identically to a thrashing one. This
// resolver is the deterministic convergence signal the count cap yields to: given the
// ordered round records, it answers "is this reviewer strictly converging across the whole
// window?" so faff-prep grants the next round instead of parking — and only while the
// signal holds.
//
// It reads the SAME persisted round records as spec-review-churn.js — each the
// `{verdict, objections}` extraction JSON faff-prep already parses for the
// `faff contract spec-review-verdict` pipe, written verbatim to
// `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` — with NO schema change (total
// count = `objections.length`; blocker count = objections at `severity == "blocker"`; both
// derived). The pure comparator `detectSpecReviewConvergence(rounds)` carries no I/O
// (parity with `detectSpecReviewChurn`); the CLI wrapper owns the directory read + ordering.
//
// Convergence is ALL THREE, over the full available window, at EVERY consecutive step:
//   (1) strictly_decreasing — totals[i] > totals[i+1] every step (the raw "closing" signal),
//   (2) blocker_free_latest — the latest round has zero blocker-severity objections (a fresh
//       blocker is never waved through), and
//   (3) no_churn           — no lens objects in a round that wasn't objecting in its
//       predecessor, checked over EVERY step (extends spec-review-churn's round-1-vs-round-2
//       lens-set guard across the whole window, since round 3 can now yield to round 4).
// A strictly-decreasing sequence of non-negative integers is self-terminating (length
// <= initial+1), so a yielding loop always terminates — the first round that fails to
// strictly decrease, reintroduces a blocker, or churns re-fires the count cap and parks.
//
// The lens-set / blocker-severity granularity shares spec-review-churn's accepted narrow
// gap: objections carry no stable id (`spec-review-verdict.schema.json` is `{lens, severity}`),
// so a same-lens objection SWAP (shed two `architectural`, add one different `architectural`)
// reads as convergence. That is bounded by the self-terminating strict-decrease invariant
// (the count cannot fall forever) and left as an accepted gap — see FAFF-874's spec, HOW
// -> Failure modes. This module reuses spec-review-churn.js's `lensSet` / `SPEC_REVIEW_LENSES`
// / `readRoundRecord` (single source of truth for the shared shape; factory -> factory is a
// legal require edge, ADR-0042).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { SPEC_REVIEW_LENSES, lensSet, readRoundRecord } = require("./spec-review-churn");

// blockerCount(objections) -> number of entries whose `severity == "blocker"`. Defensive
// against a missing/malformed `objections` field, exactly as lensSet is (an absent or
// non-array `objections`, or an entry with no string severity, contributes nothing) — this
// module validates SHAPE for its own purposes only; the contract's own schema check already
// ran at write time via `faff contract spec-review-verdict`.
function blockerCount(objections) {
  const arr = Array.isArray(objections) ? objections : [];
  let n = 0;
  for (const o of arr) {
    if (o && typeof o === "object" && o.severity === "blocker") n++;
  }
  return n;
}

// objectionCount(objections) -> total objection count for a round. Non-array -> 0.
function objectionCount(objections) {
  return Array.isArray(objections) ? objections.length : 0;
}

// detectSpecReviewConvergence(rounds) -> SpecReviewConvergenceResult
//   rounds — the parsed round records ({verdict, objections}), ALREADY ordered by round
//            number (the CLI wrapper owns the directory read + numeric sort). The comparator
//            reads only `objections`, never `verdict` — a round's counts and lens-set are
//            well-defined regardless of which loop-eligible verdict produced it (parity with
//            detectSpecReviewChurn).
// Pure: no I/O, no tracker/network calls. `converging` is true iff, across the full window,
// the total objection count strictly decreases at every consecutive step AND the latest
// round has zero blockers AND no new lens appears at any step.
function detectSpecReviewConvergence(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const totals = list.map((r) => objectionCount(r && r.objections));
  const blocker_counts = list.map((r) => blockerCount(r && r.objections));
  const lens_sets = list.map((r) => lensSet(r && r.objections));
  const blocker_free_latest = list.length > 0 ? blocker_counts[blocker_counts.length - 1] === 0 : false;

  // Defensive: a genuine cap-decision point always has >=3 rounds; a trend needs >=2.
  if (list.length < 2) {
    return {
      converging: false,
      totals,
      blocker_counts,
      strictly_decreasing: false,
      blocker_free_latest,
      no_churn: true,
      new_lenses_by_step: [],
      reason: "need >=2 rounds to assess a trend",
    };
  }

  const new_lenses_by_step = [];
  for (let i = 0; i < list.length - 1; i++) {
    const prevAsSet = new Set(lens_sets[i]);
    new_lenses_by_step.push(lens_sets[i + 1].filter((l) => !prevAsSet.has(l)));
  }

  let strictly_decreasing = true;
  let firstNonDecreasingStep = -1;
  for (let i = 0; i < totals.length - 1; i++) {
    if (!(totals[i] > totals[i + 1])) {
      strictly_decreasing = false;
      firstNonDecreasingStep = i;
      break;
    }
  }

  const firstChurnStep = new_lenses_by_step.findIndex((step) => step.length > 0);
  const no_churn = firstChurnStep === -1;

  const converging = strictly_decreasing && blocker_free_latest && no_churn;

  let reason;
  if (converging) {
    reason = `strictly converging: totals ${totals.join("→")}, latest round blocker-free, no new lens`;
  } else if (!strictly_decreasing) {
    const k = firstNonDecreasingStep;
    reason = `not strictly decreasing at step ${k + 1} (totals ${totals[k]}→${totals[k + 1]})`;
  } else if (!blocker_free_latest) {
    reason = `blocker(s) remain in the latest round (${blocker_counts[blocker_counts.length - 1]} blocker-severity)`;
  } else {
    const k = firstChurnStep;
    reason = `new objecting lens(es) at step ${k + 1}: ${new_lenses_by_step[k].join(", ")}`;
  }

  return {
    converging,
    totals,
    blocker_counts,
    strictly_decreasing,
    blocker_free_latest,
    no_churn,
    new_lenses_by_step,
    reason,
  };
}

// roundFilesInDir(dir) -> [{ n, path }] for entries matching /^round-(\d+)\.json$/, sorted
// ascending by the NUMERIC round number (so round-10 sorts after round-2, never lexically).
function roundFilesInDir(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^round-(\d+)\.json$/);
    if (m) out.push({ n: parseInt(m[1], 10), path: path.join(dir, name) });
  }
  out.sort((a, b) => a.n - b.n);
  return out;
}

// ---------------------------------------------------------------------------
// Fixture cases for the pure comparator — exercised both by --selftest and by
// test/spec-review-convergence.test.mjs directly.
// [name, rounds, wantConverging, wantStrictlyDecreasing, wantBlockerFreeLatest, wantNoChurn]
// ---------------------------------------------------------------------------
function mkObjs(total, lens, blockers = 0) {
  const arr = [];
  for (let i = 0; i < total; i++) arr.push({ lens, severity: i < blockers ? "blocker" : "major" });
  return arr;
}

const SPEC_REVIEW_CONVERGENCE_CASES = [
  [
    "strictly converging 14→13→8, blocker-free latest, no new lens — converging",
    [
      { verdict: "reject-approach", objections: mkObjs(14, "architectural", 2) },
      { verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) },
      { verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) },
    ],
    true,
    true,
    true,
    true,
  ],
  [
    "flat count 13→13→8 — not strictly decreasing, parks",
    [
      { verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) },
      { verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) },
      { verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) },
    ],
    false,
    false,
    true,
    true,
  ],
  [
    "new lens at a step 14→10 (infosec appears) — churn, parks",
    [
      { verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) },
      { verdict: "reject-approach", objections: mkObjs(9, "architectural", 0).concat(mkObjs(1, "infosec", 0)) },
    ],
    false,
    true,
    true,
    false,
  ],
  [
    "strictly decreasing 14→11→8 but a blocker remains in the latest round — parks (holdout)",
    [
      { verdict: "reject-approach", objections: mkObjs(14, "architectural", 0) },
      { verdict: "reject-approach", objections: mkObjs(11, "architectural", 0) },
      { verdict: "reject-approach", objections: mkObjs(8, "architectural", 1) },
    ],
    false,
    true,
    false,
    true,
  ],
  [
    "single round (<2) — defensive converging:false",
    [{ verdict: "reject-approach", objections: mkObjs(5, "architectural", 0) }],
    false,
    false,
    true,
    true,
  ],
  [
    "verdict-agnostic: mixed revise/reject-approach, converging on objections alone",
    [
      { verdict: "revise", objections: mkObjs(6, "QA", 0) },
      { verdict: "reject-approach", objections: mkObjs(4, "QA", 0) },
      { verdict: "revise", objections: mkObjs(2, "QA", 0) },
    ],
    true,
    true,
    true,
    true,
  ],
];

function specReviewConvergenceSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  for (const [name, rounds, wantConverging, wantSD, wantBFL, wantNC] of SPEC_REVIEW_CONVERGENCE_CASES) {
    const res = detectSpecReviewConvergence(rounds);
    ok(`${name} (converging)`, res.converging === wantConverging);
    ok(`${name} (strictly_decreasing)`, res.strictly_decreasing === wantSD);
    ok(`${name} (blocker_free_latest)`, res.blocker_free_latest === wantBFL);
    ok(`${name} (no_churn)`, res.no_churn === wantNC);
    ok(`${name} (converging == SD && BFL && NC)`, res.converging === (res.strictly_decreasing && res.blocker_free_latest && res.no_churn));
  }

  // Derived counts, no schema field: total = objections.length, blocker = severity=="blocker".
  ok("blockerCount counts only blocker-severity", blockerCount([{ severity: "blocker" }, { severity: "major" }, { severity: "blocker" }]) === 2);
  ok("blockerCount tolerates non-array", blockerCount(undefined) === 0);
  ok("objectionCount is the length", objectionCount([{ lens: "QA" }, { lens: "infosec" }]) === 2);
  ok("SPEC_REVIEW_LENSES reused from spec-review-churn", Array.isArray(SPEC_REVIEW_LENSES) && SPEC_REVIEW_LENSES.includes("architectural"));

  // reason names the first failing condition.
  ok("reason names not-strictly-decreasing", /not strictly decreasing at step 1/.test(detectSpecReviewConvergence(SPEC_REVIEW_CONVERGENCE_CASES[1][1]).reason));
  ok("reason names a remaining blocker", /blocker\(s\) remain in the latest round/.test(detectSpecReviewConvergence(SPEC_REVIEW_CONVERGENCE_CASES[3][1]).reason));
  ok("reason names a new lens", /new objecting lens\(es\) at step 1: infosec/.test(detectSpecReviewConvergence(SPEC_REVIEW_CONVERGENCE_CASES[2][1]).reason));

  // --- File-level behaviour: directory read + numeric ordering, malformed fail-loud,
  //     unreadable dir degrades to converging:false (fail-safe = park as today) ---
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-spec-review-convergence-"));
  try {
    fs.writeFileSync(path.join(tmp, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(14, "architectural", 2) }));
    fs.writeFileSync(path.join(tmp, "round-2.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(13, "architectural", 0) }));
    fs.writeFileSync(path.join(tmp, "round-3.json"), JSON.stringify({ verdict: "reject-approach", objections: mkObjs(8, "architectural", 0) }));

    // Numeric (not lexical) ordering: add a round-10 that would sort before round-2 lexically.
    // Keep the trend strictly decreasing so the happy-path assertion below is unaffected only
    // when we do NOT include it — so exercise ordering separately.
    ok("roundFilesInDir sorts numerically", (() => {
      const t2 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-src-order-"));
      try {
        for (const n of [1, 2, 10]) fs.writeFileSync(path.join(t2, `round-${n}.json`), "{}");
        fs.writeFileSync(path.join(t2, "notes.txt"), "ignored");
        const ns = roundFilesInDir(t2).map((f) => f.n);
        return JSON.stringify(ns) === JSON.stringify([1, 2, 10]);
      } finally {
        fs.rmSync(t2, { recursive: true, force: true });
      }
    })());

    const cliOk = runSpecReviewConvergenceForSelftest(["--dir", tmp]);
    const parsed = JSON.parse(cliOk.stdout);
    ok("CLI: reads+orders round-<n>.json, exit 0", cliOk.code === 0);
    ok("CLI: converging true for 14→13→8 blocker-free no-churn", parsed.converging === true && parsed.strictly_decreasing === true && parsed.blocker_free_latest === true && parsed.no_churn === true);
    ok("CLI: totals in round order", JSON.stringify(parsed.totals) === JSON.stringify([14, 13, 8]));

    // Unreadable spec-review dir — degrade to converging:false, exit 0 (fail-safe = park).
    const cliMissing = runSpecReviewConvergenceForSelftest(["--dir", path.join(tmp, "does-not-exist")]);
    ok("CLI: unreadable --dir degrades to converging:false, exit 0", cliMissing.code === 0 && JSON.parse(cliMissing.stdout).converging === false);

    // Malformed round-record JSON — fail-loud (exit 2), never silently coerced.
    fs.writeFileSync(path.join(tmp, "round-4.json"), "not json at all");
    const cliBad = runSpecReviewConvergenceForSelftest(["--dir", tmp]);
    ok("CLI: malformed round record exits 2 (fail-loud)", cliBad.code === 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-convergence resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

// In-process harness for the selftest's CLI-shaped assertions — captures stdout + the
// handler's return code without spawning a subprocess (mirrors spec-review-churn.js).
function runSpecReviewConvergenceForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try {
    const code = cmdSpecReviewConvergence(args);
    return { code, stdout };
  } finally {
    console.log = origLog;
  }
}

// `faff spec-review-convergence --dir <spec-review-dir> [--window-start N]` — reads every
// round-<n>.json in the directory, orders them by <n>, computes a SpecReviewConvergenceResult,
// prints it as JSON to stdout, exit 0. A missing/unreadable directory DEGRADES to
// `converging:false` (fail-SAFE direction for a YIELD gate = do not yield = park as today, the
// opposite of churn's degrade direction). A malformed round record (present but corrupt JSON)
// is fail-loud (exit 2) — plumbing breakage, parity with spec-review-churn's `--curr`.
//
// FAFF-909: `--window-start N` bounds the comparison to the convergence window `[N .. max]` —
// after reading every record, keep only those with round number `>= N` before ordering and
// detecting, so a restart / human unpark can compare only records from one continuous
// conversation (matching how spec-review-churn is already window-scoped by its explicit
// `--prev`/`--curr` paths). Omitted → today's whole-directory behaviour, byte-identical. `N`
// must be an integer `>= 1` (else usage error exit 2); an `N` past the max round leaves fewer
// than two records in window, so detectSpecReviewConvergence returns `converging:false` with
// its existing "need >=2 rounds" reason — a park, the fail-safe direction.
const SPEC_REVIEW_CONVERGENCE_SPEC = { flags: { "--selftest": { arity: 0 }, "--dir": { arity: 1 }, "--window-start": { arity: 1 } } };
const SPEC_REVIEW_CONVERGENCE_USAGE = "usage: faff spec-review-convergence --dir <spec-review-dir> [--window-start N]";

function cmdSpecReviewConvergence(args) {
  if (args.includes("--selftest")) return specReviewConvergenceSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_CONVERGENCE_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_CONVERGENCE_USAGE);
  if (values["--dir"] == null) {
    return usageError([{ code: "missing-value", detail: "--dir is required" }], SPEC_REVIEW_CONVERGENCE_USAGE);
  }
  const dir = values["--dir"];

  // --window-start N — a usage error (exit 2) when malformed, validated up front so it is
  // independent of whether the directory is readable (a usage error never depends on runtime
  // state). A strict integer-string check: one or more digits, value >= 1.
  let windowStart = null;
  if (values["--window-start"] != null) {
    const raw = values["--window-start"];
    if (!/^\d+$/.test(String(raw)) || parseInt(raw, 10) < 1) {
      return usageError(
        [{ code: "invalid-value", detail: `--window-start expects an integer >= 1, got "${raw}"` }],
        SPEC_REVIEW_CONVERGENCE_USAGE,
      );
    }
    windowStart = parseInt(raw, 10);
  }

  let files;
  try {
    files = roundFilesInDir(dir);
  } catch (e) {
    // Missing / unreadable directory — degrade to no-yield (park as today), never fail prep.
    console.log(JSON.stringify({ converging: false, reason: "spec-review dir unreadable" }));
    return 0;
  }

  // Bound the comparison to the window [windowStart .. max]: a read-time filter that leaves
  // every record in place for forensics (never archives/moves them).
  if (windowStart != null) {
    files = files.filter((f) => f.n >= windowStart);
  }

  const rounds = [];
  for (const f of files) {
    const read = readRoundRecord(f.path);
    if (read.malformed) {
      process.stderr.write(`faff spec-review-convergence: ${f.path} is not valid JSON (${read.malformed})\n`);
      return 2;
    }
    if (read.missing) {
      // Listed-then-vanished (a race) — treat like corrupt plumbing, fail-loud.
      process.stderr.write(`faff spec-review-convergence: ${f.path} could not be read (${read.error && read.error.message})\n`);
      return 2;
    }
    rounds.push(read.record);
  }

  const result = detectSpecReviewConvergence(rounds);
  console.log(JSON.stringify(result));
  return 0;
}

module.exports = {
  SPEC_REVIEW_CONVERGENCE_CASES,
  cmdSpecReviewConvergence,
  detectSpecReviewConvergence,
  blockerCount,
  objectionCount,
  roundFilesInDir,
  specReviewConvergenceSelftest,
};
