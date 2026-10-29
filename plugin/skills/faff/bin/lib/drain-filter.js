// ===========================================================================
// === region:factory — drain-filter — FAFF-1412: drop pre-check hits a recent drain declined and nobody has changed since ===
//
// A runner's cheap pre-check reads only the tracker, so an issue a drain routed out or
// skipped as claimed-by-peer keeps matching and starts another paid drain every tick.
// `faff run-ledger record-declined` leaves `declined[issue] = { reason, at }` in the run
// ledger; this command filters the pre-check's candidates against those records.
//
// Read-only and fail-open: it writes nothing, makes no network or tracker call, and keeps
// any candidate it is not sure about. The caller supplies each candidate's last tracker
// change time (`changed_at`), because faff never reads the tracker.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");

// The ledger's own issue-id floor (run-ledger.js ISSUE_ID_RE), plus the `..` refusal.
const ISSUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RUN_NAME_TIME_RE = /^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/;
const MAX_AGE_HOURS_DEFAULT = 24;
const MAX_AGE_HOURS_MAX = 168;

const DRAIN_FILTER_SPEC = {
  flags: {
    "--runs-dir": { arity: 1 },
    "--root": { arity: 1 },
    "--max-age-hours": { arity: 1 },
    "--now": { arity: 1 },
    "--json": { arity: 0 },
  },
  positionals: { min: 0, max: 0 },
};
const USAGE = "usage: faff drain-filter [--runs-dir DIR] [--root DIR] [--max-age-hours N] [--now ISO] [--json]   # stdin: [{\"issue\", \"changed_at\"}]";

const isValidIssue = (s) => typeof s === "string" && ISSUE_ID_RE.test(s) && !s.includes("..");

const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

// An ISO-8601 date-time string -> epoch ms, or null. Instants compare as numbers, so
// "…:10Z" and "…:10.000Z" are equal.
function instant(s) {
  if (typeof s !== "string" || !ISO_DATE_TIME_RE.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function startFromName(name) {
  const m = RUN_NAME_TIME_RE.exec(name);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(t) ? null : t;
}

// One run directory -> { run_id, start, ledger | null }. The start time comes from the
// dir name, else the ledger's owner.started_at, else the dir's own mtime, so every run
// ages out of the window. `ledger` is null when run-ledger.json is unreadable or malformed.
// A dir with no run-ledger.json at all (a runner placeholder or log dir, never a beep-boop run,
// which writes its ledger at mint) returns null and is skipped: it can have admitted nothing.
function readRun(runsDir, name) {
  const dir = path.join(runsDir, name);
  let ledger = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "run-ledger.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ledger = parsed;
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    ledger = null;
  }
  let start = startFromName(name);
  if (start === null && ledger && ledger.owner) start = instant(ledger.owner.started_at);
  if (start === null) {
    try { start = fs.statSync(dir).mtimeMs; } catch { start = null; }
  }
  return { run_id: name, start, ledger };
}

// Does this ledger mention the issue at all (admitted, outcomes or declined)?
function mentions(ledger, issue) {
  const admitted = Array.isArray(ledger.admitted) && ledger.admitted.includes(issue);
  const own = (m) => !!m && typeof m === "object" && Object.prototype.hasOwnProperty.call(m, issue);
  return admitted || own(ledger.outcomes) || own(ledger.declined);
}

// PURE core. `runs` is [{ run_id, start, ledger|null }] already limited to the window.
// Returns { kept, suppressed, degraded: string[] }.
function filterCandidates(candidates, runs) {
  const kept = [];
  const suppressed = [];
  const degraded = [];
  const order = (a, b) => (a.start - b.start) || (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0);
  const readable = runs.filter((r) => r.ledger).sort(order);
  const unreadable = runs.filter((r) => !r.ledger).sort(order);
  for (const r of unreadable) degraded.push(`unreadable-ledger:${r.run_id}`);

  candidates.forEach((c, index) => {
    const issue = c && c.issue;
    if (!isValidIssue(issue)) {
      degraded.push(`bad-candidate:${index}`);
      kept.push(typeof issue === "string" ? issue : String(issue));
      return;
    }
    // The newest readable run that mentions the issue decides.
    let decider = null;
    for (let i = readable.length - 1; i >= 0; i--) {
      if (mentions(readable[i].ledger, issue)) { decider = readable[i]; break; }
    }
    if (!decider) { kept.push(issue); return; }
    // An unreadable run started after the deciding run may have admitted the issue.
    if (unreadable.some((u) => order(u, decider) > 0)) { kept.push(issue); return; }
    const ledger = decider.ledger;
    if (Array.isArray(ledger.admitted) && ledger.admitted.includes(issue)) { kept.push(issue); return; }
    const record = ledger.declined && typeof ledger.declined === "object" && Object.prototype.hasOwnProperty.call(ledger.declined, issue)
      ? ledger.declined[issue] : null;
    // Mentioned only in outcomes (a routed-out entry with no decline record): no `at`, keep.
    if (!record || typeof record !== "object") { kept.push(issue); return; }
    const declinedAt = instant(record.at);
    const changedAt = instant(c.changed_at);
    if (declinedAt === null || changedAt === null || changedAt > declinedAt) { kept.push(issue); return; }
    suppressed.push({ issue, run_id: decider.run_id, reason: typeof record.reason === "string" ? record.reason : null, declined_at: record.at, changed_at: c.changed_at });
  });
  return { kept, suppressed, degraded };
}

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function cmdDrainFilter(args) {
  const { values, errors } = parseArgs(args, DRAIN_FILTER_SPEC);
  if (errors.length) return usageError(errors, USAGE);

  let maxAge = MAX_AGE_HOURS_DEFAULT;
  if (values["--max-age-hours"] !== undefined) {
    const raw = values["--max-age-hours"];
    if (!/^\d+$/.test(raw) || +raw < 1 || +raw > MAX_AGE_HOURS_MAX) {
      process.stderr.write(`faff drain-filter: --max-age-hours ${JSON.stringify(raw)} must be an integer from 1 to ${MAX_AGE_HOURS_MAX}\n${USAGE}\n`);
      return 2;
    }
    maxAge = +raw;
  }
  let now = Date.now();
  if (values["--now"] !== undefined) {
    now = instant(values["--now"]);
    if (now === null) {
      process.stderr.write(`faff drain-filter: --now ${JSON.stringify(values["--now"])} is not an ISO-8601 time\n${USAGE}\n`);
      return 2;
    }
  }

  if (process.stdin.isTTY) {
    process.stderr.write(`faff drain-filter: nothing piped on stdin\n${USAGE}\n`);
    return 2;
  }
  let candidates;
  try { candidates = JSON.parse(readStdin()); } catch { candidates = null; }
  if (!Array.isArray(candidates) || !candidates.every((c) => c !== null && typeof c === "object" && !Array.isArray(c))) {
    process.stderr.write(`faff drain-filter: stdin must be a JSON array of {"issue", "changed_at"} objects\n${USAGE}\n`);
    return 2;
  }

  const runsDir = values["--runs-dir"] || path.join(values["--root"] || findRoot(), ".faff", "runs");
  let result;
  let names = null;
  try {
    // statSync follows a symlinked runs dir (the runner links .faff/runs onto its state volume).
    if (fs.statSync(runsDir).isDirectory()) names = fs.readdirSync(runsDir);
  } catch { names = null; }
  if (names === null) {
    result = filterCandidates(candidates, []);
    result.degraded.unshift("no-runs-dir");
  } else {
    const cutoff = now - maxAge * 3600 * 1000;
    const runs = [];
    for (const name of names.sort()) {
      let isDir = false;
      try { isDir = fs.statSync(path.join(runsDir, name)).isDirectory(); } catch { isDir = false; }
      if (!isDir) continue;
      const run = readRun(runsDir, name);
      if (run === null) continue;
      if (run.start === null || run.start < cutoff) continue;
      runs.push(run);
    }
    result = filterCandidates(candidates, runs);
  }

  if (values["--json"]) {
    const out = { kept: result.kept, suppressed: result.suppressed, degraded: result.degraded.length ? result.degraded.join("; ") : null, window_hours: maxAge };
    process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    process.stdout.write(result.kept.join(" ") + "\n");
  }
  return 0;
}

module.exports = { DRAIN_FILTER_SPEC, ISO_DATE_TIME_RE, cmdDrainFilter, filterCandidates };
