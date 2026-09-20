// ===========================================================================
// === region:factory — build-review-churn — FAFF-996: detect a thrashing build-review dialogue ===
// The build-review dialogue loop (`faff-graft` Step 9, autonomous only) is bounded by a
// rebuttal cap and a fix cap, but a cap counts ROUNDS, not agreement — a reviewer that raises
// a genuinely NEW critical finding every round looks identical, to a count alone, as one
// steadily converging toward zero standing criticals. This resolver is the sibling of
// `spec-review-churn.js`, ported one altitude down: same file-read / round-number / CLI-arg-
// parsing scaffolding, but the comparator KEY differs — build-review findings carry no lens,
// only a `finding_id` identity digest (p-10: `normalize(file_path) + "::" + normalize_title
// (title)`, line-number-free), so this resolver tracks the STANDING-CRITICAL finding_id SET,
// never a lens-set.
//
// churn:true iff a finding_id present in `--curr`'s standing-critical set (severity=="critical")
// was NOT present in `--prev`'s standing-critical set — i.e. a new critical identity appeared.
// A finding whose location shifts within the same file under the same title is the SAME
// identity (persisted digest, not re-derived text), so a one-line drift never churns.
//
// Reuses `readRoundRecord` / `roundNumberFromPath` verbatim from `spec-review-churn.js` (a
// legal factory-to-factory require edge, ADR-0042 — the reader is shape-agnostic: it only
// parses JSON and classifies missing vs malformed, never touching `objections`/`findings`).
// ===========================================================================

"use strict";

const { parseArgs, usageError } = require("./argv");
const { readRoundRecord, roundNumberFromPath } = require("./spec-review-churn");

// standingCriticalIds(findings) -> sorted, deduped array of finding_id strings for every
// finding at severity=="critical". Defensive against a missing/malformed `findings` field (an
// absent or non-array `findings`, or an entry with no string finding_id, contributes nothing
// rather than throwing) — this module validates SHAPE for its own purposes only.
function standingCriticalIds(findings) {
  const arr = Array.isArray(findings) ? findings : [];
  const set = new Set();
  for (const f of arr) {
    if (f && typeof f === "object" && f.severity === "critical" && typeof f.finding_id === "string" && f.finding_id) {
      set.add(f.finding_id);
    }
  }
  return Array.from(set).sort();
}

// computeChurn(prev, curr, prevRoundNumber) -> BuildReviewChurnResult
//   prev             — the parsed prior DialogueRoundRecord ({signal, findings, author_replies}),
//                       or `null` when no prior round exists on disk (round 1 — nothing to compare).
//   curr             — the parsed current DialogueRoundRecord. Required.
//   prevRoundNumber  — the prior round's 1-indexed number (from its filename), or `null`.
//                       Cosmetic only — never affects the `churn` verdict.
// Pure: no I/O. `churn` is true iff `curr`'s standing-critical finding_id set contains an id
// that was NOT standing-critical in `prev` — i.e. the standing-critical set grew a new identity,
// never merely held steady or shrank.
function computeChurn(prev, curr, prevRoundNumber) {
  const currIds = standingCriticalIds(curr && curr.findings);
  if (prev === null || prev === undefined) {
    return { churn: false, prev_critical_ids: [], curr_critical_ids: currIds, new_critical_ids: [], reason: "no prior round on disk" };
  }
  const prevIds = standingCriticalIds(prev.findings);
  const prevAsSet = new Set(prevIds);
  const newIds = currIds.filter((id) => !prevAsSet.has(id));
  const churn = newIds.length > 0;
  const roundLabel = prevRoundNumber != null ? String(prevRoundNumber) : "the previous round";
  const reason = churn
    ? `new standing-critical finding_id(s) since round ${roundLabel}: ${newIds.join(", ")}`
    : `standing-critical finding_id set held steady or shrank since round ${roundLabel}`;
  return { churn, prev_critical_ids: prevIds, curr_critical_ids: currIds, new_critical_ids: newIds, reason };
}

// ---------------------------------------------------------------------------
// Fixture cases for the pure comparator — exercised both by --selftest and by
// test/build-review-churn.test.mjs directly.
// [name, prev, curr, prevRoundNumber, wantChurn, wantNewIds]
// ---------------------------------------------------------------------------
const BUILD_REVIEW_CHURN_CASES = [
  [
    "identical standing-critical set (line shift, same finding_id) — no churn",
    { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical", location: "foo.js:120", title: "T" }] },
    { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical", location: "foo.js:121", title: "T" }] },
    1,
    false,
    [],
  ],
  [
    "strict-subset shrink (a critical resolved) — no churn",
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }, { finding_id: "b.js::y", severity: "critical" }] },
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] },
    1,
    false,
    [],
  ],
  [
    "a genuinely new finding_id appears alongside the old — churn",
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] },
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }, { finding_id: "u.js::u", severity: "critical" }] },
    1,
    true,
    ["u.js::u"],
  ],
  [
    "a fully disjoint finding_id swap — churn",
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] },
    { signal: "needs-human", findings: [{ finding_id: "b.js::y", severity: "critical" }] },
    2,
    true,
    ["b.js::y"],
  ],
  [
    "missing prior round — degrades to no-churn, never crashes",
    null,
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] },
    null,
    false,
    [],
  ],
  [
    "empty findings both rounds — no churn",
    { signal: "pass", findings: [] },
    { signal: "pass", findings: [] },
    1,
    false,
    [],
  ],
  [
    "non-critical findings never enter the standing-critical set — no churn",
    { signal: "fail", findings: [{ finding_id: "a.js::x", severity: "major" }] },
    { signal: "fail", findings: [{ finding_id: "a.js::x", severity: "major" }, { finding_id: "b.js::y", severity: "minor" }] },
    1,
    false,
    [],
  ],
];

function buildReviewChurnSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  for (const [name, prev, curr, prevRoundNumber, wantChurn, wantNewIds] of BUILD_REVIEW_CHURN_CASES) {
    const res = computeChurn(prev, curr, prevRoundNumber);
    ok(`${name} (churn)`, res.churn === wantChurn);
    ok(`${name} (new_critical_ids)`, JSON.stringify(res.new_critical_ids) === JSON.stringify(wantNewIds));
  }

  ok("standingCriticalIds tolerates non-array findings", JSON.stringify(standingCriticalIds(undefined)) === "[]");
  ok("standingCriticalIds tolerates a garbage entry", JSON.stringify(standingCriticalIds([{ notFinding: 1 }, { finding_id: "a.js::x", severity: "critical" }])) === '["a.js::x"]');
  ok("standingCriticalIds dedupes + sorts", JSON.stringify(standingCriticalIds([{ finding_id: "b.js::y", severity: "critical" }, { finding_id: "a.js::x", severity: "critical" }, { finding_id: "b.js::y", severity: "critical" }])) === '["a.js::x","b.js::y"]');

  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-build-review-churn-"));
  try {
    const currPath = path.join(tmp, "round-2.json");
    fs.writeFileSync(currPath, JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] }));

    const missingPrevPath = path.join(tmp, "round-1.json");
    const cliMissing = runBuildReviewChurnForSelftest(["--prev", missingPrevPath, "--curr", currPath]);
    ok("CLI: missing --prev exits 0, degrades to churn:false", cliMissing.code === 0 && JSON.parse(cliMissing.stdout).churn === false);

    const badCurrPath = path.join(tmp, "round-2-bad.json");
    fs.writeFileSync(badCurrPath, "not json at all");
    const cliBadCurr = runBuildReviewChurnForSelftest(["--prev", missingPrevPath, "--curr", badCurrPath]);
    ok("CLI: malformed --curr exits 2 (fail-loud)", cliBadCurr.code === 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (build-review-churn resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

function runBuildReviewChurnForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try {
    const code = cmdBuildReviewChurn(args);
    return { code, stdout };
  } finally {
    console.log = origLog;
  }
}

// `faff build-review-churn --prev <path> --curr <path>` — reads the two DialogueRoundRecord
// JSON files, prints a BuildReviewChurnResult as JSON to stdout, exit 0. `--prev`/`--curr` are
// both required; a missing/malformed `--curr` is always fail-loud (exit 2). A missing/unreadable
// `--prev` degrades to `churn:false`; a malformed `--prev` (present but corrupt JSON) is
// fail-loud (exit 2) — plumbing breakage, not a legitimate degrade case.
const BUILD_REVIEW_CHURN_SPEC = { flags: { "--selftest": { arity: 0 }, "--prev": { arity: 1 }, "--curr": { arity: 1 } } };
const BUILD_REVIEW_CHURN_USAGE = "usage: faff build-review-churn --prev <path> --curr <path>";

function cmdBuildReviewChurn(args) {
  if (args.includes("--selftest")) return buildReviewChurnSelftest();
  const { values, errors } = parseArgs(args, BUILD_REVIEW_CHURN_SPEC);
  if (errors.length) return usageError(errors, BUILD_REVIEW_CHURN_USAGE);
  if (values["--prev"] == null || values["--curr"] == null) {
    return usageError([{ code: "missing-value", detail: "--prev and --curr are both required" }], BUILD_REVIEW_CHURN_USAGE);
  }
  const prevPath = values["--prev"];
  const currPath = values["--curr"];

  const currRead = readRoundRecord(currPath);
  if (currRead.malformed) {
    process.stderr.write(`faff build-review-churn: --curr ${currPath} is not valid JSON (${currRead.malformed})\n`);
    return 2;
  }
  if (currRead.missing) {
    process.stderr.write(`faff build-review-churn: --curr ${currPath} could not be read (${currRead.error && currRead.error.message})\n`);
    return 2;
  }

  const prevRead = readRoundRecord(prevPath);
  if (prevRead.malformed) {
    process.stderr.write(`faff build-review-churn: --prev ${prevPath} is not valid JSON (${prevRead.malformed})\n`);
    return 2;
  }
  const prevRecord = prevRead.missing ? null : prevRead.record;
  const prevRoundNumber = prevRead.missing ? null : roundNumberFromPath(prevPath);

  const result = computeChurn(prevRecord, currRead.record, prevRoundNumber);
  console.log(JSON.stringify(result));
  return 0;
}

module.exports = {
  BUILD_REVIEW_CHURN_CASES,
  cmdBuildReviewChurn,
  computeChurn,
  standingCriticalIds,
  buildReviewChurnSelftest,
};
