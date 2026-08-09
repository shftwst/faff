// ===========================================================================
// === region:factory — spec-review-churn — FAFF-707: detect a non-converging prep↔review loop ===
// The prep↔review Spec-review gate's 2-iteration cap (faff-prep/SKILL.md's Loop cap
// paragraph) bounds how many revise/reject-approach rounds run, but it counts rounds,
// not agreement — a reviewer that raises a genuinely NEW objecting lens every round
// looks identical, to that cap, as one that's steadily converging toward `approve`.
// Under the FAFF-694 codex run this let a spec balloon v1→v5 before the cap forced a
// decision, two rounds late.
//
// This resolver answers one narrow question — "did a lens that wasn't objecting in the
// prior round start objecting now?" — from two persisted round records (each the
// `{verdict, objections}` extraction JSON faff-prep already parses for the
// `faff contract spec-review-verdict` pipe, written verbatim to
// `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json`). It is PURE (no tracker/
// network writes — parity with review-iteration-cap.js / park-history.js): faff-prep
// reads the round records off disk and passes both paths in; this module never resolves
// a run-id or issue itself.
//
// Deliberately coarse: the objection shape (`spec-review-verdict.schema.json`) is exactly
// `{lens, severity}`, no stable id — so "the architectural objection cleared" and "a
// different architectural objection just replaced it" are indistinguishable at this
// granularity. The check tracks the LENS-SET only (did a new lens start objecting),
// never individual objections. See FAFF-707's spec, Design Decision Rationale, for the
// accepted narrow gap this leaves (a same-lens swap can read as convergence).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");

const SPEC_REVIEW_LENSES = ["architectural", "infosec", "methodology", "QA"];

// lensSet(objections) -> sorted, deduped array of lens strings appearing in a round
// record's `objections` array. Defensive against a missing/malformed `objections` field
// (mirrors computeSpecReviewVerdict's own tolerance in contract-defs.js) — an absent or
// non-array `objections`, or an entry with no string `lens`, contributes nothing rather
// than throwing; this module validates SHAPE for its own purposes only, it is not the
// contract's own schema check (that already ran, at write time, via
// `faff contract spec-review-verdict`).
function lensSet(objections) {
  const arr = Array.isArray(objections) ? objections : [];
  const set = new Set();
  for (const o of arr) {
    if (o && typeof o === "object" && typeof o.lens === "string" && o.lens) set.add(o.lens);
  }
  return Array.from(set).sort();
}

// roundNumberFromPath("…/round-3.json") -> 3; anything else -> null.
// The persisted round record body is exactly `{verdict, objections}` (WHAT decision (b)
// — no shape extension), so the round number this resolver cites in `reason` text is
// read from the `--prev` filename, never invented as a body field.
function roundNumberFromPath(p) {
  const m = path.basename(String(p || "")).match(/^round-(\d+)\.json$/);
  return m ? parseInt(m[1], 10) : null;
}

// detectSpecReviewChurn(prev, curr, prevRoundNumber) -> SpecReviewChurnResult
//   prev             — the parsed prior round record ({verdict, objections}), or `null`
//                       when no prior round exists on disk (the defensive default; faff-prep
//                       never calls this for round 1 — there is nothing yet to compare).
//   curr             — the parsed current round record. Required; the caller (faff-prep) only
//                       ever calls this once the current round's own record has been written.
//   prevRoundNumber  — the prior round's 1-indexed number (from its filename), or `null` when
//                       `prev` is null. Cosmetic only — it never affects the `churn` verdict.
// Pure: no I/O, no tracker/network calls. `churn` is true iff `curr`'s objecting lens-set
// contains a lens that was NOT objecting in `prev` — i.e. the lens-set grew, never merely
// held steady or shrank.
function detectSpecReviewChurn(prev, curr, prevRoundNumber) {
  const currLenses = lensSet(curr && curr.objections);
  if (prev === null || prev === undefined) {
    return { churn: false, prev_lenses: [], curr_lenses: currLenses, new_lenses: [], reason: "no prior round on disk" };
  }
  const prevLenses = lensSet(prev.objections);
  const prevAsSet = new Set(prevLenses);
  const newLenses = currLenses.filter((l) => !prevAsSet.has(l));
  const churn = newLenses.length > 0;
  const roundLabel = prevRoundNumber != null ? String(prevRoundNumber) : "the previous round";
  const reason = churn
    ? `new objecting lens(es) since round ${roundLabel}: ${newLenses.join(", ")}`
    : `objecting lens-set held steady or shrank since round ${roundLabel}`;
  return { churn, prev_lenses: prevLenses, curr_lenses: currLenses, new_lenses: newLenses, reason };
}

// readRoundRecord(p) -> { record } | { missing: true, error } | { malformed: string }
// Distinguishes "the file isn't there / can't be read" (ENOENT, permission, etc. — the
// degrade-to-no-churn case for `--prev`) from "the file is there but isn't valid JSON"
// (plumbing corruption — always fail-loud, for BOTH --prev and --curr; a file this same
// mechanism wrote being unparseable is never a legitimate degrade case).
function readRoundRecord(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    return { missing: true, error: e };
  }
  try {
    return { record: JSON.parse(raw) };
  } catch (e) {
    return { malformed: e.message };
  }
}

// ---------------------------------------------------------------------------
// Fixture cases for the pure comparator — exercised both by --selftest and by
// test/spec-review-churn.test.mjs directly.
// [name, prev, curr, prevRoundNumber, wantChurn, wantNewLenses]
// ---------------------------------------------------------------------------
const SPEC_REVIEW_CHURN_CASES = [
  [
    "identical lens-sets — no churn",
    { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] },
    { verdict: "revise", objections: [{ lens: "architectural", severity: "minor" }] },
    1,
    false,
    [],
  ],
  [
    "strict-subset shrink — no churn",
    { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }, { lens: "QA", severity: "minor" }, { lens: "infosec", severity: "minor" }] },
    { verdict: "revise", objections: [{ lens: "architectural", severity: "minor" }] },
    1,
    false,
    [],
  ],
  [
    "a genuinely new lens appears alongside the old — churn",
    { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] },
    { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }, { lens: "infosec", severity: "blocker" }] },
    1,
    true,
    ["infosec"],
  ],
  [
    "a fully disjoint lens-set swap — churn",
    { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] },
    { verdict: "revise", objections: [{ lens: "QA", severity: "minor" }] },
    2,
    true,
    ["QA"],
  ],
  [
    "missing prior round — degrades to no-churn, never crashes",
    null,
    { verdict: "revise", objections: [{ lens: "infosec", severity: "blocker" }] },
    null,
    false,
    [],
  ],
  [
    "empty objections both rounds — no churn (e.g. two non-approve edge records)",
    { verdict: "revise", objections: [] },
    { verdict: "revise", objections: [] },
    1,
    false,
    [],
  ],
];

function specReviewChurnSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  for (const [name, prev, curr, prevRoundNumber, wantChurn, wantNewLenses] of SPEC_REVIEW_CHURN_CASES) {
    const res = detectSpecReviewChurn(prev, curr, prevRoundNumber);
    ok(`${name} (churn)`, res.churn === wantChurn);
    ok(`${name} (new_lenses)`, JSON.stringify(res.new_lenses) === JSON.stringify(wantNewLenses));
  }

  // Lens-set derivation tolerates a malformed/absent `objections` array rather than throwing.
  ok("lensSet tolerates non-array objections", JSON.stringify(lensSet(undefined)) === "[]");
  ok("lensSet tolerates a garbage entry", JSON.stringify(lensSet([{ notLens: 1 }, { lens: "QA", severity: "minor" }])) === '["QA"]');
  ok("lensSet dedupes + sorts", JSON.stringify(lensSet([{ lens: "QA" }, { lens: "architectural" }, { lens: "QA" }])) === '["QA","architectural"]');

  // roundNumberFromPath: filename-derived, never a body field (WHAT decision (b) — no shape extension).
  ok("roundNumberFromPath parses round-<n>.json", roundNumberFromPath("/x/y/round-3.json") === 3);
  ok("roundNumberFromPath returns null for a non-matching name", roundNumberFromPath("/x/y/prev.json") === null);

  // --- File-level behaviour: missing --prev degrades, malformed --prev/--curr fail loud ---
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-spec-review-churn-"));
  try {
    const currPath = path.join(tmp, "round-2.json");
    fs.writeFileSync(currPath, JSON.stringify({ verdict: "revise", objections: [{ lens: "infosec", severity: "blocker" }] }));

    // Missing --prev (never written, e.g. faff-prep round 1) — degrade, no crash.
    const missingPrevPath = path.join(tmp, "round-1.json");
    const readMissing = readRoundRecord(missingPrevPath);
    ok("readRoundRecord reports missing (not malformed) for an absent file", readMissing.missing === true && !readMissing.malformed);

    // Malformed --prev — fail-loud signal, never silently treated as "no prior round".
    fs.writeFileSync(missingPrevPath, "{ not valid json");
    const readMalformed = readRoundRecord(missingPrevPath);
    ok("readRoundRecord reports malformed (not missing) for corrupt JSON", !!readMalformed.malformed && !readMalformed.missing);

    // Round-trip through the CLI wrapper: missing --prev degrades cleanly to churn:false.
    fs.rmSync(missingPrevPath, { force: true });
    const cliMissing = runSpecReviewChurnForSelftest(["--prev", missingPrevPath, "--curr", currPath]);
    ok("CLI: missing --prev exits 0, degrades to churn:false", cliMissing.code === 0 && JSON.parse(cliMissing.stdout).churn === false);

    // Round-trip: malformed --curr fails loud (exit 2), never silently coerced.
    const badCurrPath = path.join(tmp, "round-2-bad.json");
    fs.writeFileSync(badCurrPath, "not json at all");
    const cliBadCurr = runSpecReviewChurnForSelftest(["--prev", missingPrevPath, "--curr", badCurrPath]);
    ok("CLI: malformed --curr exits 2 (fail-loud)", cliBadCurr.code === 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-churn resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

// In-process harness for the selftest's CLI-shaped assertions above — captures stdout/stderr
// + the handler's return code without spawning a subprocess (mirrors the in-repo convention
// of exercising cmd* handlers directly rather than via child_process in a --selftest path).
function runSpecReviewChurnForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try {
    const code = cmdSpecReviewChurn(args);
    return { code, stdout };
  } finally {
    console.log = origLog;
  }
}

// `faff spec-review-churn --prev <path> --curr <path>` — reads the two round-record JSON
// files, prints a SpecReviewChurnResult as JSON to stdout, exit 0. `--prev`/`--curr` are
// both required flags; a missing/malformed `--curr` (the just-computed current round) is
// always fail-loud (exit 2) — there is nothing to compare against otherwise. A missing/
// unreadable `--prev` degrades to `churn:false` (see detectSpecReviewChurn); a malformed
// `--prev` (present but corrupt JSON) is fail-loud (exit 2) — plumbing breakage, not a
// legitimate degrade case.
const SPEC_REVIEW_CHURN_SPEC = { flags: { "--selftest": { arity: 0 }, "--prev": { arity: 1 }, "--curr": { arity: 1 } } };
const SPEC_REVIEW_CHURN_USAGE = "usage: faff spec-review-churn --prev <path> --curr <path>";

function cmdSpecReviewChurn(args) {
  if (args.includes("--selftest")) return specReviewChurnSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_CHURN_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_CHURN_USAGE);
  if (values["--prev"] == null || values["--curr"] == null) {
    return usageError([{ code: "missing-value", detail: "--prev and --curr are both required" }], SPEC_REVIEW_CHURN_USAGE);
  }
  const prevPath = values["--prev"];
  const currPath = values["--curr"];

  const currRead = readRoundRecord(currPath);
  if (currRead.malformed) {
    process.stderr.write(`faff spec-review-churn: --curr ${currPath} is not valid JSON (${currRead.malformed})\n`);
    return 2;
  }
  if (currRead.missing) {
    process.stderr.write(`faff spec-review-churn: --curr ${currPath} could not be read (${currRead.error && currRead.error.message})\n`);
    return 2;
  }

  const prevRead = readRoundRecord(prevPath);
  if (prevRead.malformed) {
    process.stderr.write(`faff spec-review-churn: --prev ${prevPath} is not valid JSON (${prevRead.malformed})\n`);
    return 2;
  }
  const prevRecord = prevRead.missing ? null : prevRead.record;
  const prevRoundNumber = prevRead.missing ? null : roundNumberFromPath(prevPath);

  const result = detectSpecReviewChurn(prevRecord, currRead.record, prevRoundNumber);
  console.log(JSON.stringify(result));
  return 0;
}

module.exports = {
  SPEC_REVIEW_LENSES,
  SPEC_REVIEW_CHURN_CASES,
  cmdSpecReviewChurn,
  detectSpecReviewChurn,
  lensSet,
  readRoundRecord,
  roundNumberFromPath,
  specReviewChurnSelftest,
};
