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
const { readerFindingIds, resolveRoundChain } = require("./finding-id");
const { roundFilesInDir } = require("./spec-review-convergence");
const path = require("node:path");

// standingCriticalIds(findings, round) -> sorted, deduped array of finding ids for every finding
// at severity=="critical", resolved for a single round with no prior (round-1 identity): the
// `readerFindingIds` id (computed from `title` + `location`, else the stored `finding_id`, else
// the round-scoped `round-<n>#<i>`), so an untitled, id-less critical still counts as standing.
// Defensive against a missing/malformed `findings` field — it contributes nothing.
function standingCriticalIds(findings, round = "unknown") {
  const arr = Array.isArray(findings) ? findings : [];
  return standingCriticals(arr, readerFindingIds(arr, round)).ids;
}

function standingCriticals(findings, entries) {
  const ids = new Set();
  const carried = new Set();
  findings.forEach((f, i) => {
    if (!(f && typeof f === "object" && f.severity === "critical")) return;
    ids.add(entries[i].id);
    if (entries[i].carry === "accepted") carried.add(entries[i].id);
  });
  return { ids: Array.from(ids).sort(), carried: Array.from(carried).sort() };
}

function refusedCarries(entries) {
  return entries.filter((e) => e.carry === "refused").length;
}

function findingsOf(record) {
  return record && Array.isArray(record.findings) ? record.findings : [];
}

// computeChurn(prev, curr, prevRoundNumber, currRoundNumber, earlier) -> BuildReviewChurnResult
//   prev             — the parsed prior DialogueRoundRecord ({signal, findings, author_replies}),
//                       or `null` when no prior round exists on disk (round 1 — nothing to compare).
//   curr             — the parsed current DialogueRoundRecord. Required.
//   prevRoundNumber  — the prior round's number (from its filename), or `null`; scopes the round
//                       token of a prior finding's fallback id.
//   currRoundNumber  — optional: the current round's number. When a number is absent the round
//                       token is the literal `prev` or `curr`, keeping the two rounds' fallback
//                       ids distinct.
//   earlier          — optional `[{ round, record }]`, ascending: the rounds before `prev`, so a
//                       carried id resolves through the whole chain (FAFF-1276).
// Pure: no I/O. Ids come from `resolveRoundChain` over `[...earlier, prev, curr]`. `churn` is true
// iff `curr`'s standing-critical id set contains an id that was NOT standing-critical in `prev`.
// `refused_carries` counts `curr`'s refused carries, so a reviewer whose carries keep failing shows.
function computeChurn(prev, curr, prevRoundNumber, currRoundNumber, earlier = []) {
  const currToken = currRoundNumber != null ? currRoundNumber : "curr";
  const currFindings = findingsOf(curr);
  if (prev === null || prev === undefined) {
    const currEntries = resolveRoundChain([{ round: currToken, findings: currFindings }])[0];
    const currSet = standingCriticals(currFindings, currEntries);
    return { churn: false, prev_critical_ids: [], curr_critical_ids: currSet.ids, new_critical_ids: [], carried_critical_ids: currSet.carried, refused_carries: refusedCarries(currEntries), reason: "no prior round on disk" };
  }
  const prevFindings = findingsOf(prev);
  const chain = [
    ...(Array.isArray(earlier) ? earlier : []).map((e) => ({ round: e.round, findings: findingsOf(e.record) })),
    { round: prevRoundNumber != null ? prevRoundNumber : "prev", findings: prevFindings },
    { round: currToken, findings: currFindings },
  ];
  const resolved = resolveRoundChain(chain);
  const prevIds = standingCriticals(prevFindings, resolved[resolved.length - 2]).ids;
  const currSet = standingCriticals(currFindings, resolved[resolved.length - 1]);
  const prevAsSet = new Set(prevIds);
  const newIds = currSet.ids.filter((id) => !prevAsSet.has(id));
  const churn = newIds.length > 0;
  const roundLabel = prevRoundNumber != null ? String(prevRoundNumber) : "the previous round";
  const reason = churn
    ? `new standing-critical finding_id(s) since round ${roundLabel}: ${newIds.join(", ")}`
    : `standing-critical finding_id set held steady or shrank since round ${roundLabel}`;
  return { churn, prev_critical_ids: prevIds, curr_critical_ids: currSet.ids, new_critical_ids: newIds, carried_critical_ids: currSet.carried, refused_carries: refusedCarries(resolved[resolved.length - 1]), reason };
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

  const sameDir = path.resolve(path.dirname(prevPath)) === path.resolve(path.dirname(currPath));
  const earlier = [];
  if (prevRecord !== null && sameDir && prevRoundNumber != null) {
    for (const { n, path: p } of roundFilesInDir(path.dirname(prevPath))) {
      if (n >= prevRoundNumber) continue;
      const read = readRoundRecord(p);
      if (read.malformed || read.missing) {
        process.stderr.write(`faff build-review-churn: earlier round ${p} is unreadable or not valid JSON (${read.malformed || (read.error && read.error.message)})\n`);
        return 2;
      }
      earlier.push({ round: n, record: read.record });
    }
  }

  const result = computeChurn(prevRecord, currRead.record, prevRoundNumber, roundNumberFromPath(currPath), earlier);
  if (prevRecord !== null && !sameDir) {
    process.stderr.write("faff build-review-churn: --prev and --curr are in different directories; ids were resolved over two rounds only\n");
    result.chain_rounds = 2;
  }
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
