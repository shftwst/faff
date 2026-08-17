// ===========================================================================
// === region:factory — tracker — FAFF-695/FAFF-808: classify the tracker-availability pin. ===
// PURE: reads `.faffrc tracking.tracker` and reports whether a tracker connector is
// PINNED (asserted to exist), UNPINNED, or GIT-ONLY (asserted to not exist). It
// deliberately does NOT — and cannot — determine whether a pinned connector is
// *reachable this session*: every bin/lib module is MCP-blind by invariant, so live
// reachability is the model's call after a harness discovery attempt. This classifier's
// whole job is the deterministic half: a connector pin is an operator's assertion the
// connector exists, so a skill that sees `pinned` MUST NOT downgrade to git-only merely
// because the tool isn't in its immediately-visible set (the Codex deferred-tool failure
// FAFF-695 fixes). The git-only pin (FAFF-808) is the symmetric inverse assertion — the
// operator states the repo has no tracker relationship, so a skill that sees `git-only`
// MUST NOT upgrade to tracker-mode even if a tracker MCP is visible this session, and
// resolves it before any discovery attempt. `unpinned` means neither assertion — the
// skill must attempt discovery before concluding absence.
// The skills carry the harness-specific discovery + the "unreachable this session"
// fail-loud in prose (a CLI can't probe MCP); this command is the pin-read they lean on.
// ===========================================================================

const { parseArgs, usageError } = require("./argv");
const { findRoot, dig } = require("./shared-infra");
const { loadConfig } = require("./config");

// Reserved `tracking.tracker` values asserting git-only (case-insensitive, trimmed).
// `none` is canonical; `git-only` is an identical alias — both resolve to "git-only".
const GIT_ONLY_SENTINELS = new Set(["none", "git-only"]);

// Pure core: resolved config map → { pin, resolution }.
// - blank/absent ⇒ { pin: null, resolution: "unpinned" }
// - a reserved sentinel (none / git-only, case-insensitive, trimmed) ⇒ { pin: null, resolution: "git-only" }
// - any other non-empty string ⇒ { pin: <trimmed>, resolution: "pinned" }
function classifyTracker(data) {
  const raw = dig(data, "tracking.tracker");
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { pin: null, resolution: "unpinned" };
  }
  const trimmed = String(raw).trim();
  if (GIT_ONLY_SENTINELS.has(trimmed.toLowerCase())) {
    return { pin: null, resolution: "git-only" };
  }
  return { pin: trimmed, resolution: "pinned" };
}

const TRACKER_CASES = [
  [{ tracking: { tracker: "linear" } }, { pin: "linear", resolution: "pinned" }],
  [{ tracking: { tracker: "github" } }, { pin: "github", resolution: "pinned" }],
  [{ tracking: { tracker: "  jira  " } }, { pin: "jira", resolution: "pinned" }], // trimmed
  [{ tracking: { tracker: "" } }, { pin: null, resolution: "unpinned" }],         // blank ⇒ unpinned
  [{ tracking: { tracker: "   " } }, { pin: null, resolution: "unpinned" }],       // whitespace ⇒ unpinned
  [{ tracking: {} }, { pin: null, resolution: "unpinned" }],                       // key absent
  [{}, { pin: null, resolution: "unpinned" }],                                     // no tracking block
  [{ tracking: { tracker: "none" } }, { pin: null, resolution: "git-only" }],       // FAFF-808: canonical sentinel
  [{ tracking: { tracker: "git-only" } }, { pin: null, resolution: "git-only" }],   // FAFF-808: alias sentinel
  [{ tracking: { tracker: "NONE" } }, { pin: null, resolution: "git-only" }],       // FAFF-808: case-insensitive
  [{ tracking: { tracker: "  none  " } }, { pin: null, resolution: "git-only" }],   // FAFF-808: trimmed
  [{ tracking: { tracker: "Git-Only" } }, { pin: null, resolution: "git-only" }],   // FAFF-808: mixed-case alias
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
