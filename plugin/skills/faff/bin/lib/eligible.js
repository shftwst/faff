// ===========================================================================
// === region:factory — eligible — FAFF-61/753: the automation-eligibility function. PURE: resolves whether ===
// a ticket may be touched by the AUTONOMOUS pipeline, from its labels, the
// configured `automation_default` knob, and whether a tracker governs the repo.
// Precedence: hard-exclude > include > default. Fail-safe: the shipped default is
// opt-in, so an unlabelled ticket is NOT eligible, and any non-"opt-out" default
// value coerces to opt-in. FAFF-753: `opt-out` opens the unlabelled surface ONLY in
// git-only mode (no tracker) — under a tracker it is inert, because the two faff-*
// labels are the safe-space control surface there. The caller resolves tracker
// presence via the gateway "Tracker availability resolution" rule and passes it as
// --tracker present|absent; this stays a PURE arg (no config/MCP read here). Read-only
// skills never gate on this. The agent calls this (passing the issue's labels + `faff
// config get automation_default -d opt-in` + the resolved --tracker) and feeds the
// result to `faff next` as --not-eligible.
// ===========================================================================


function automationEligible(labels, automationDefault, trackerPresent) {
  const set = new Set(labels);
  if (set.has("faff-automation-hold")) return false; // hard exclude wins, always
  if (set.has("faff-automate")) return true;         // explicit include
  // unlabelled ⇒ follow the knob, but opt-out opens the surface ONLY in git-only.
  // `trackerPresent === false` is deliberate: only an explicit git-only signal opens
  // it — present, or the legacy 2-arg call (undefined), leaves opt-out inert (fail-safe).
  return automationDefault === "opt-out" && trackerPresent === false;
}

// Cases: [[labels, default, trackerPresent], want]. trackerPresent true = a tracker
// governs the repo (opt-out inert); false = git-only (opt-out is the on-switch);
// undefined = the legacy 2-arg call (must coerce to inert, the fail-safe direction).
const ELIGIBLE_CASES = [
  [[["faff-automation-hold"], "opt-out", false], false],          // hold wins even under opt-out + git-only
  [[["faff-automation-hold"], "opt-out", true], false],           // hold wins under a tracker too
  [[["faff-automation-hold", "faff-automate"], "opt-in", true], false], // both present ⇒ hold wins
  [[["faff-automate"], "opt-in", true], true],                    // explicit include, tracker present
  [[["faff-automate"], "opt-in", false], true],                   // explicit include, git-only
  [[[], "opt-in", true], false],                                  // unlabelled + opt-in ⇒ ineligible (fail-safe)
  [[[], "opt-in", false], false],                                 // unlabelled + opt-in, git-only ⇒ ineligible
  [[[], "opt-out", true], false],                                 // opt-out under a tracker ⇒ INERT (FAFF-753)
  [[[], "opt-out", false], true],                                 // opt-out in git-only ⇒ eligible (the on-switch)
  [[[], "garbage", false], false],                                // invalid default coerces to opt-in (fail-safe)
  [[[], "opt-out", undefined], false],                            // legacy 2-arg call ⇒ opt-out inert (fail-safe)
];

function runEligibleCases() {
  let fail = 0;
  for (const [[labels, def, tracker], want] of ELIGIBLE_CASES) {
    const got = automationEligible(labels, def, tracker);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} labels=[${labels.join(",")}] default=${def} tracker=${tracker} → ${got} (want ${want})`);
  }
  return fail;
}

function eligibleSelftest() {
  const fail = runEligibleCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${ELIGIBLE_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");

const ELIGIBLE_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--label": { arity: 1, repeatable: true },
    "--default": { arity: 1 }, // no enum: a non-opt-out value legitimately coerces to opt-in (fail-safe)
    "--tracker": { arity: 1 }, // no enum: absent = git-only; present/omitted/garbage ⇒ tracker-present (tighter)
  },
};
const ELIGIBLE_USAGE = "usage: faff eligible [--label L]... [--default opt-in|opt-out] [--tracker present|absent]";

function cmdEligible(args) {
  if (args.includes("--selftest")) return eligibleSelftest();
  const { values, errors } = parseArgs(args, ELIGIBLE_SPEC);
  if (errors.length) return usageError(errors, ELIGIBLE_USAGE);
  const labels = values["--label"] || [];
  const def = (values["--default"] || "opt-in").toLowerCase();
  // absent ⇒ git-only (false); present, omitted, or any other value ⇒ tracker-present (true, tighter).
  const trackerPresent = (values["--tracker"] || "present").toLowerCase() !== "absent";
  console.log(String(automationEligible(labels, def, trackerPresent)));
  return 0;
}


module.exports = { ELIGIBLE_CASES, automationEligible, cmdEligible, eligibleSelftest, runEligibleCases };
