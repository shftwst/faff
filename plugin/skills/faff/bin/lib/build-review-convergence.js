// ===========================================================================
// === region:factory — build-review-convergence — FAFF-996: let the fix-cap yield to a converging reviewer ===
// The build-review dialogue loop's fix cap (`review-iteration-cap`, appetite-scaled 1/3/5/10)
// would force the loop to the would-be-park point on the Nth fix round even when the
// independent reviewer is measurably converging — its standing-critical count strictly
// falling round-on-round, with no new critical identity appearing. This resolver is the
// sibling of `spec-review-convergence.js`, ported one altitude down: same directory-read +
// numeric-ordering + `--window-start` scaffolding, but the comparator tracks the
// STANDING-CRITICAL finding_id SET (p-10 digest), never a lens-set, and carries no
// `blocker_free_latest`-style third clause.
//
// [folded 2026-09-19] Exact, single definition (WHAT/HOW/DONE all state it identically):
// `converging: true` iff, over the rounds in `[window-start .. n]`, (i) the standing-critical
// COUNT strictly decreases every round, AND (ii) no new `finding_id` appeared since the prior
// round. There is NO third "latest round critical-free" clause — convergence is only ever
// consulted while standing criticals are non-empty (the fix-cap-exhaustion yield check), so a
// zero-blockers-in-latest requirement would return `converging:false` on every call. A
// strictly-decreasing sequence of non-negative integers is self-terminating, so a yielding loop
// always terminates.
//
// Reuses `roundFilesInDir` from `spec-review-convergence.js` (the directory lister + numeric
// sort — shape-agnostic, a legal factory-to-factory require edge, ADR-0042, the same edge
// `spec-review-window.js` already uses to reach it) and `standingCriticalIds` /
// `readRoundRecord` from `build-review-churn.js` / `spec-review-churn.js` respectively — no
// second copy of either.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { roundFilesInDir } = require("./spec-review-convergence");
const { readRoundRecord } = require("./spec-review-churn");
const { standingCriticalIds } = require("./build-review-churn");

// standingCriticalCount(findings) -> the standing-critical count for a round (the number of
// distinct standing-critical finding_id's — dedupes a same-identity double-report).
function standingCriticalCount(findings) {
  return standingCriticalIds(findings).length;
}

// computeConvergence(rounds) -> BuildReviewConvergenceResult
//   rounds — the parsed DialogueRoundRecords ({signal, findings, author_replies}), ALREADY
//            ordered by round number (the CLI wrapper owns the directory read + numeric sort).
// Pure: no I/O. `converging` is true iff, across the full window, the standing-critical count
// strictly decreases at every consecutive step AND no new standing-critical finding_id appears
// at any step.
function computeConvergence(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const totals = list.map((r) => standingCriticalCount(r && r.findings));
  const idSets = list.map((r) => standingCriticalIds(r && r.findings));

  if (list.length < 2) {
    return {
      converging: false,
      totals,
      strictly_decreasing: false,
      no_new_finding: true,
      new_finding_ids_by_step: [],
      reason: "need >=2 rounds to assess a trend",
    };
  }

  const new_finding_ids_by_step = [];
  for (let i = 0; i < list.length - 1; i++) {
    const prevAsSet = new Set(idSets[i]);
    new_finding_ids_by_step.push(idSets[i + 1].filter((id) => !prevAsSet.has(id)));
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

  const firstNewStep = new_finding_ids_by_step.findIndex((step) => step.length > 0);
  const no_new_finding = firstNewStep === -1;

  const converging = strictly_decreasing && no_new_finding;

  let reason;
  if (converging) {
    reason = `strictly converging: standing-critical totals ${totals.join("→")}, no new finding_id`;
  } else if (!strictly_decreasing) {
    const k = firstNonDecreasingStep;
    reason = `not strictly decreasing at step ${k + 1} (totals ${totals[k]}→${totals[k + 1]})`;
  } else {
    const k = firstNewStep;
    reason = `new standing-critical finding_id(s) at step ${k + 1}: ${new_finding_ids_by_step[k].join(", ")}`;
  }

  return { converging, totals, strictly_decreasing, no_new_finding, new_finding_ids_by_step, reason };
}

// ---------------------------------------------------------------------------
// Fixture cases for the pure comparator — exercised both by --selftest and by
// test/build-review-convergence.test.mjs directly.
// [name, rounds, wantConverging, wantStrictlyDecreasing, wantNoNewFinding]
// ---------------------------------------------------------------------------
function mkFindings(n, prefix = "f") {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ finding_id: `${prefix}${i}.js::t`, severity: "critical" });
  return arr;
}

const BUILD_REVIEW_CONVERGENCE_CASES = [
  [
    "strictly converging 3→2→1, no new finding — converging",
    [
      { signal: "needs-human", findings: mkFindings(3) },
      { signal: "needs-human", findings: mkFindings(2) },
      { signal: "needs-human", findings: mkFindings(1) },
    ],
    true,
    true,
    true,
  ],
  [
    "flat count 2→2→1 — not strictly decreasing, parks",
    [
      { signal: "needs-human", findings: mkFindings(2) },
      { signal: "needs-human", findings: mkFindings(2) },
      { signal: "needs-human", findings: mkFindings(1) },
    ],
    false,
    false,
    true,
  ],
  [
    "a new finding_id appears at a step (count still falls) — not converging",
    [
      { signal: "needs-human", findings: mkFindings(3) },
      { signal: "needs-human", findings: [{ finding_id: "f0.js::t", severity: "critical" }, { finding_id: "new.js::u", severity: "critical" }] },
    ],
    false,
    true,
    false,
  ],
  [
    "single round (<2) — defensive converging:false",
    [{ signal: "needs-human", findings: mkFindings(2) }],
    false,
    false,
    true,
  ],
  [
    "verdict-agnostic: mixed signals, converging on standing-critical count alone",
    [
      { signal: "fail", findings: mkFindings(3) },
      { signal: "needs-human", findings: mkFindings(2) },
      { signal: "needs-human", findings: mkFindings(1) },
    ],
    true,
    true,
    true,
  ],
];

function buildReviewConvergenceSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  for (const [name, rounds, wantConverging, wantSD, wantNNF] of BUILD_REVIEW_CONVERGENCE_CASES) {
    const res = computeConvergence(rounds);
    ok(`${name} (converging)`, res.converging === wantConverging);
    ok(`${name} (strictly_decreasing)`, res.strictly_decreasing === wantSD);
    ok(`${name} (no_new_finding)`, res.no_new_finding === wantNNF);
    ok(`${name} (converging == SD && NNF)`, res.converging === (res.strictly_decreasing && res.no_new_finding));
  }

  ok("standingCriticalCount is the deduped finding_id count", standingCriticalCount([{ finding_id: "a", severity: "critical" }, { finding_id: "a", severity: "critical" }, { finding_id: "b", severity: "major" }]) === 1);

  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-build-review-convergence-"));
  try {
    fs.writeFileSync(path.join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(3) }));
    fs.writeFileSync(path.join(tmp, "round-2.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(2) }));
    fs.writeFileSync(path.join(tmp, "round-3.json"), JSON.stringify({ signal: "needs-human", findings: mkFindings(1) }));

    const cliOk = runBuildReviewConvergenceForSelftest(["--dir", tmp]);
    const parsed = JSON.parse(cliOk.stdout);
    ok("CLI: reads+orders round-<n>.json, exit 0", cliOk.code === 0);
    ok("CLI: converging true for 3→2→1 no-new-finding", parsed.converging === true && parsed.strictly_decreasing === true && parsed.no_new_finding === true);
    ok("CLI: totals in round order", JSON.stringify(parsed.totals) === JSON.stringify([3, 2, 1]));

    const cliMissing = runBuildReviewConvergenceForSelftest(["--dir", path.join(tmp, "does-not-exist")]);
    ok("CLI: unreadable --dir degrades to converging:false, exit 0", cliMissing.code === 0 && JSON.parse(cliMissing.stdout).converging === false);

    fs.writeFileSync(path.join(tmp, "round-4.json"), "not json at all");
    const cliBad = runBuildReviewConvergenceForSelftest(["--dir", tmp]);
    ok("CLI: malformed round record exits 2 (fail-loud)", cliBad.code === 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (build-review-convergence resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

function runBuildReviewConvergenceForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try {
    const code = cmdBuildReviewConvergence(args);
    return { code, stdout };
  } finally {
    console.log = origLog;
  }
}

// `faff build-review-convergence --dir <build-review-dir> [--window-start N]` — reads every
// round-<n>.json in DIR, orders by <n>, computes a BuildReviewConvergenceResult, prints it as
// JSON to stdout, exit 0. A missing/unreadable directory degrades to `converging:false`
// (fail-safe = do not yield = park). A malformed round record is fail-loud (exit 2).
// `--window-start N` bounds the comparison to `[N .. max]` (an integer >= 1, else usage error).
const BUILD_REVIEW_CONVERGENCE_SPEC = { flags: { "--selftest": { arity: 0 }, "--dir": { arity: 1 }, "--window-start": { arity: 1 } } };
const BUILD_REVIEW_CONVERGENCE_USAGE = "usage: faff build-review-convergence --dir <build-review-dir> [--window-start N]";

function cmdBuildReviewConvergence(args) {
  if (args.includes("--selftest")) return buildReviewConvergenceSelftest();
  const { values, errors } = parseArgs(args, BUILD_REVIEW_CONVERGENCE_SPEC);
  if (errors.length) return usageError(errors, BUILD_REVIEW_CONVERGENCE_USAGE);
  if (values["--dir"] == null) {
    return usageError([{ code: "missing-value", detail: "--dir is required" }], BUILD_REVIEW_CONVERGENCE_USAGE);
  }
  const dir = values["--dir"];

  let windowStart = null;
  if (values["--window-start"] != null) {
    const raw = values["--window-start"];
    if (!/^\d+$/.test(String(raw)) || parseInt(raw, 10) < 1) {
      return usageError(
        [{ code: "invalid-value", detail: `--window-start expects an integer >= 1, got "${raw}"` }],
        BUILD_REVIEW_CONVERGENCE_USAGE,
      );
    }
    windowStart = parseInt(raw, 10);
  }

  let files;
  try {
    files = roundFilesInDir(dir);
  } catch (e) {
    console.log(JSON.stringify({ converging: false, reason: "build-review dir unreadable" }));
    return 0;
  }

  if (windowStart != null) {
    files = files.filter((f) => f.n >= windowStart);
  }

  const rounds = [];
  for (const f of files) {
    const read = readRoundRecord(f.path);
    if (read.malformed) {
      process.stderr.write(`faff build-review-convergence: ${f.path} is not valid JSON (${read.malformed})\n`);
      return 2;
    }
    if (read.missing) {
      process.stderr.write(`faff build-review-convergence: ${f.path} could not be read (${read.error && read.error.message})\n`);
      return 2;
    }
    rounds.push(read.record);
  }

  const result = computeConvergence(rounds);
  console.log(JSON.stringify(result));
  return 0;
}

module.exports = {
  BUILD_REVIEW_CONVERGENCE_CASES,
  cmdBuildReviewConvergence,
  computeConvergence,
  standingCriticalCount,
  buildReviewConvergenceSelftest,
};
