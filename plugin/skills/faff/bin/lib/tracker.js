// ===========================================================================
// === region:factory — tracker — FAFF-695: classify the tracker-availability pin. ===
// PURE: reads `.faffrc tracking.tracker` and reports whether a tracker connector is
// PINNED (asserted to exist) or UNPINNED. It deliberately does NOT — and cannot —
// determine whether the connector is *reachable this session*: every bin/lib module
// is MCP-blind by invariant, so live reachability is the model's call after a
// harness discovery attempt. This classifier's whole job is the deterministic half:
// a pin is an operator's assertion the connector exists, so a skill that sees `pinned`
// MUST NOT downgrade to git-only merely because the tool isn't in its immediately-
// visible set (the Codex deferred-tool failure the ticket fixes). `unpinned` means
// no such assertion — the skill must attempt discovery before concluding absence.
// The skills carry the harness-specific discovery + the "unreachable this session"
// fail-loud in prose (a CLI can't probe MCP); this command is the pin-read they lean on.
// ===========================================================================

const { parseArgs, usageError } = require("./argv");
const { findRoot, dig } = require("./shared-infra");
const { loadConfig } = require("./config");

// Pure core: resolved config map → { pin, resolution }.
// A pin is any non-empty `tracking.tracker` string; blank/absent ⇒ unpinned.
function classifyTracker(data) {
  const raw = dig(data, "tracking.tracker");
  const pin = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim();
  return { pin, resolution: pin ? "pinned" : "unpinned" };
}

const TRACKER_CASES = [
  [{ tracking: { tracker: "linear" } }, { pin: "linear", resolution: "pinned" }],
  [{ tracking: { tracker: "github" } }, { pin: "github", resolution: "pinned" }],
  [{ tracking: { tracker: "  jira  " } }, { pin: "jira", resolution: "pinned" }], // trimmed
  [{ tracking: { tracker: "" } }, { pin: null, resolution: "unpinned" }],         // blank ⇒ unpinned
  [{ tracking: { tracker: "   " } }, { pin: null, resolution: "unpinned" }],       // whitespace ⇒ unpinned
  [{ tracking: {} }, { pin: null, resolution: "unpinned" }],                       // key absent
  [{}, { pin: null, resolution: "unpinned" }],                                     // no tracking block
];

function runTrackerCases() {
  let fail = 0;
  for (const [data, want] of TRACKER_CASES) {
    const got = classifyTracker(data);
    const ok = got.pin === want.pin && got.resolution === want.resolution;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(data.tracking ?? null)} → ${got.resolution} (pin=${got.pin}) (want ${want.resolution}/${want.pin})`);
  }
  return fail;
}

function trackerSelftest() {
  const fail = runTrackerCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${TRACKER_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const TRACKER_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--json": { arity: 0 },
    "--root": { arity: 1 },
  },
};
const TRACKER_USAGE = "usage: faff tracker probe [--json] [--root DIR]";

function cmdTracker(args) {
  if (args.includes("--selftest")) return trackerSelftest();
  const [verb, ...rest] = args;
  if (verb !== "probe") return usageError([`unknown tracker verb: ${verb ?? "(none)"}`], TRACKER_USAGE);
  const { values, errors } = parseArgs(rest, TRACKER_SPEC);
  if (errors.length) return usageError(errors, TRACKER_USAGE);
  const root = values["--root"] || findRoot();
  const [data] = loadConfig(root);
  const out = classifyTracker(data);
  if (values["--json"]) console.log(JSON.stringify(out));
  else console.log(out.resolution);
  return 0; // pure classifier — always exit 0 (like `faff eligible`); the resolution is on stdout
}

module.exports = { TRACKER_CASES, classifyTracker, cmdTracker, runTrackerCases, trackerSelftest };
