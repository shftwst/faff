// ===========================================================================
// === region:factory — park-history — FAFF-152: the DETERMINISTIC repeat-park counting seam. Reads the ===
// newest ~50 .faff/runs/*/summary.md, parses each run's ```faff-parks fenced JSON
// block (an array of {issue_id, root_cause_class, timestamp} — the root_cause_class
// is ASSIGNED by the routing_adaptor at park time and READ BACK here, never
// re-derived: that classification is LLM judgement, out of scope), windows the parks
// to a rolling 21 days ending at an INJECTED --now (no ambient clock → fully
// deterministic), and emits per-issue same-class counts plus the repeat_parked list
// at the >=3-same-class threshold. The 21-day window + >=3 threshold are the fixed
// gateway defaults (gateway repeat-park line; faff-tidy demote; routing adaptor) —
// not .faffrc knobs. Counting only: it never reads the tracker, never mutates, never
// classifies. faff-tidy consumes repeat_parked to demote Todo->Backlog + tag
// repeat-parked; this seam just does the deterministic half tidy's prose relied on.
//
// FAFF-779: this module also owns the WRITER half of the same wire format — the shared
// Park protocol's in-run `park_records` accumulator (`addParkRecord`, dedup-by-completed-
// transition) and its run-end render (`renderParksBlock`, the exact fence `extractParksBlock`
// above parses). One shared reader + writer for every park class (`punt-not-closed` / `gap`
// / `cycle` / ...) — no verdict-specific writer, no second storage format. Both are PURE:
// no filesystem/tracker access; the orchestrator (faff-beep-boop) holds the accumulator in
// memory for the run and writes the rendered fence into `summary.md` itself.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { findRoot } = require("./shared-infra");

const PARK_WINDOW_DAYS = 21;          // rolling window (gateway default)
const REPEAT_PARK_THRESHOLD = 3;      // >=3 same-class parks in the window → flagged
const PARK_HISTORY_SCAN = 50;         // newest N run summaries scanned
const ROOT_CAUSE_CLASSES = new Set([  // the fixed five (gateway root-cause enum)
  "punt-not-closed", "gap", "cycle", "spec-ambiguous-external", "other",
]);

// Extract the single ```faff-parks fenced JSON block from a summary.md body, if present.
// Returns the parsed array, or null when no block exists (a run with no parks). Throws
// (fail-loud) on a malformed block — a present-but-broken fence is a corrupt fixture,
// never silently treated as "no parks".
function extractParksBlock(body, runId) {
  const m = body.match(/```faff-parks[ \t]*\r?\n([\s\S]*?)\r?\n```/);
  if (!m) return null;
  let parsed;
  try { parsed = JSON.parse(m[1]); }
  catch (e) { throw new Error(`malformed faff-parks block in run '${runId}': ${e.message}`); }
  if (!Array.isArray(parsed)) {
    throw new Error(`faff-parks block in run '${runId}' must be a JSON array`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// FAFF-779 — the shared writer half. PURE: given the accumulator so far and one
// completed park fact, return the (possibly unchanged) next accumulator. A "completed
// park transition" is identified by its own record — same issue, same root-cause class,
// same timestamp — because both the original Park-protocol return and any later backstop
// reconciliation of that SAME transition read the same on-disk/tracker completed-transition
// instant, never "now". A record matching an existing one byte-for-byte on those three
// fields is a retry/rediscovery of the transition already recorded and is dropped, not
// appended — this is what keeps `faff park-history`'s counts honest under a retried return
// or a reconciled backstop, and what makes "exactly one record per completed transition"
// provable rather than asserted. A genuinely later, distinct transition (a different
// timestamp) for the same issue/class is NOT a duplicate — it is a real repeat park and is
// appended, occurrence-ordered, same as any other class.
// ---------------------------------------------------------------------------
function addParkRecord(records, record) {
  const list = Array.isArray(records) ? records : [];
  const isDuplicate = list.some((r) => r && record
    && r.issue_id === record.issue_id
    && r.root_cause_class === record.root_cause_class
    && r.timestamp === record.timestamp);
  return isDuplicate ? list : [...list, record];
}

// Render the canonical fenced `faff-parks` block from the accumulator — the exact wire
// format `extractParksBlock` above parses (round-trip proof lives in the test suite).
// `[]` for an empty accumulator (never an omitted fence) so every run's summary carries
// one stable producer shape for `faff park-history` to consume.
function renderParksBlock(records) {
  const list = Array.isArray(records) ? records : [];
  return "```faff-parks\n" + JSON.stringify(list, null, 2) + "\n```";
}

// Pure core: given a flat list of park records + the now-instant, count parks per
// issue per root_cause_class within the rolling window and flag the repeat-parked.
// Records with a missing/out-of-enum class or an unparseable timestamp are skipped
// (defensive — a real summary's parks come from the routing_adaptor, but the seam
// must not crash on a stray record). Optionally narrow to a single --issue.
function computeParkHistory(parks, nowMs, onlyIssue) {
  const windowStart = nowMs - PARK_WINDOW_DAYS * 86400000;
  const counts = {};                              // { issue: { class: n } }
  for (const p of parks) {
    if (!p || typeof p !== "object") continue;
    const issue = p.issue_id;
    const cls = p.root_cause_class;
    if (typeof issue !== "string" || !ROOT_CAUSE_CLASSES.has(cls)) continue;
    if (onlyIssue && issue !== onlyIssue) continue;
    const t = Date.parse(p.timestamp);
    if (Number.isNaN(t)) continue;
    if (t < windowStart || t > nowMs) continue;   // rolling [now-21d, now]
    (counts[issue] ||= {})[cls] = (counts[issue][cls] || 0) + 1;
  }
  const repeat_parked = Object.keys(counts)
    .filter((issue) => Object.values(counts[issue]).some((n) => n >= REPEAT_PARK_THRESHOLD))
    .sort();
  return { window_days: PARK_WINDOW_DAYS, threshold: REPEAT_PARK_THRESHOLD, counts, repeat_parked };
}

// Gather parks from the newest ~50 run summaries under root/.faff/runs.
function gatherParks(root) {
  const runsDir = path.join(root, ".faff", "runs");
  let names;
  try { names = fs.readdirSync(runsDir); } catch { return []; }
  const runIds = names
    .filter((name) => { try { return fs.statSync(path.join(runsDir, name)).isDirectory(); } catch { return false; } })
    .sort().reverse()                              // run-ids date-prefixed → lexical == chronological
    .slice(0, PARK_HISTORY_SCAN);
  const parks = [];
  for (const runId of runIds) {
    const summary = path.join(runsDir, runId, "summary.md");
    let body;
    try { body = fs.readFileSync(summary, "utf8"); } catch { continue; } // no summary → no parks
    const block = extractParksBlock(body, runId);   // throws on malformed (fail-loud)
    if (block) parks.push(...block);
  }
  return parks;
}

const PARK_HISTORY_SELFTEST_CASES = [
  // [parks, now, onlyIssue, wantRepeatParked]
  // FLAG: 3 same-class within 21d → flagged.
  [[
    { issue_id: "ISS-RP", root_cause_class: "punt-not-closed", timestamp: "2026-06-01T09:00:00Z" },
    { issue_id: "ISS-RP", root_cause_class: "punt-not-closed", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-RP", root_cause_class: "punt-not-closed", timestamp: "2026-06-15T09:00:00Z" },
  ], "2026-06-16T00:00:00Z", null, ["ISS-RP"]],
  // UNDER: only 2 same-class in window → not flagged.
  [[
    { issue_id: "ISS-U", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-U", root_cause_class: "gap", timestamp: "2026-06-15T09:00:00Z" },
  ], "2026-06-16T00:00:00Z", null, []],
  // WINDOW: a 3rd same-class park but dated > 21d before now → not flagged.
  [[
    { issue_id: "ISS-W", root_cause_class: "cycle", timestamp: "2026-05-01T09:00:00Z" },
    { issue_id: "ISS-W", root_cause_class: "cycle", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-W", root_cause_class: "cycle", timestamp: "2026-06-15T09:00:00Z" },
  ], "2026-06-16T00:00:00Z", null, []],
  // MIXED: 3 parks across 3 different classes → not flagged (threshold is per-class).
  [[
    { issue_id: "ISS-M", root_cause_class: "punt-not-closed", timestamp: "2026-06-01T09:00:00Z" },
    { issue_id: "ISS-M", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-M", root_cause_class: "cycle", timestamp: "2026-06-15T09:00:00Z" },
  ], "2026-06-16T00:00:00Z", null, []],
  // EXACT-EDGE: a same-class park exactly 21d before now is inside the window.
  [[
    { issue_id: "ISS-E", root_cause_class: "other", timestamp: "2026-05-26T00:00:00Z" },
    { issue_id: "ISS-E", root_cause_class: "other", timestamp: "2026-06-05T00:00:00Z" },
    { issue_id: "ISS-E", root_cause_class: "other", timestamp: "2026-06-16T00:00:00Z" },
  ], "2026-06-16T00:00:00Z", null, ["ISS-E"]],
  // FILTER: --issue narrows the result to one issue even when others would flag.
  [[
    { issue_id: "ISS-RP", root_cause_class: "gap", timestamp: "2026-06-01T09:00:00Z" },
    { issue_id: "ISS-RP", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-RP", root_cause_class: "gap", timestamp: "2026-06-15T09:00:00Z" },
    { issue_id: "ISS-OTHER", root_cause_class: "gap", timestamp: "2026-06-01T09:00:00Z" },
    { issue_id: "ISS-OTHER", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-OTHER", root_cause_class: "gap", timestamp: "2026-06-15T09:00:00Z" },
  ], "2026-06-16T00:00:00Z", "ISS-RP", ["ISS-RP"]],
  // OUT-OF-ENUM: a record with a bogus class is ignored, not counted.
  [[
    { issue_id: "ISS-X", root_cause_class: "not-a-real-class", timestamp: "2026-06-01T09:00:00Z" },
    { issue_id: "ISS-X", root_cause_class: "not-a-real-class", timestamp: "2026-06-08T09:00:00Z" },
    { issue_id: "ISS-X", root_cause_class: "not-a-real-class", timestamp: "2026-06-15T09:00:00Z" },
  ], "2026-06-16T00:00:00Z", null, []],
];

function parkHistorySelftest() {
  let fail = 0;
  for (const [parks, now, onlyIssue, want] of PARK_HISTORY_SELFTEST_CASES) {
    const got = computeParkHistory(parks, Date.parse(now), onlyIssue).repeat_parked;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} now=${now}${onlyIssue ? ` issue=${onlyIssue}` : ""} → repeat_parked=${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${PARK_HISTORY_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");
const PARK_HISTORY_SPEC = { flags: { "--selftest": { arity: 0 }, "--now": { arity: 1 }, "--root": { arity: 1 }, "--issue": { arity: 1 } } };

function cmdParkHistory(args) {
  if (args.includes("--selftest")) return parkHistorySelftest();
  const { values, errors } = parseArgs(args, PARK_HISTORY_SPEC);
  if (errors.length) return usageError(errors, "usage: faff park-history --now ISO-8601 [--root DIR] [--issue ID]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const nowArg = get("--now");
  if (!nowArg) {
    process.stderr.write("faff park-history: --now <ISO-8601> is required (the window end; no ambient clock)\n");
    return 2;
  }
  const nowMs = Date.parse(nowArg);
  if (Number.isNaN(nowMs)) {
    process.stderr.write(`faff park-history: --now '${nowArg}' is not a parseable ISO-8601 timestamp\n`);
    return 2;
  }
  const root = get("--root") || findRoot();
  const onlyIssue = get("--issue");
  let parks;
  try { parks = gatherParks(root); }
  catch (e) { process.stderr.write(`faff park-history: ${e.message}\n`); return 2; } // fail-loud on a malformed block
  console.log(JSON.stringify(computeParkHistory(parks, nowMs, onlyIssue)));
  return 0;
}


module.exports = { PARK_HISTORY_SCAN, PARK_HISTORY_SELFTEST_CASES, PARK_WINDOW_DAYS, REPEAT_PARK_THRESHOLD, ROOT_CAUSE_CLASSES, addParkRecord, cmdParkHistory, computeParkHistory, extractParksBlock, gatherParks, parkHistorySelftest, renderParksBlock };
