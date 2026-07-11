// ===========================================================================
// === region:factory — eligible — FAFF-61: the automation-eligibility function. PURE: resolves whether ===
// a ticket may be touched by the AUTONOMOUS pipeline, from its labels + the
// configured `automation_default` knob. Precedence: hard-exclude > include > default.
// Fail-safe: the shipped default is opt-in, so an unlabelled ticket is NOT eligible,
// and any non-"opt-out" default value coerces to opt-in. Read-only skills never gate
// on this. The agent calls this (passing the issue's labels + `faff config get
// automation_default -d opt-in`) and feeds the result to `faff next` as --not-eligible.
// ===========================================================================


function automationEligible(labels, automationDefault) {
  const set = new Set(labels);
  if (set.has("faff-automation-hold")) return false; // hard exclude wins, always
  if (set.has("faff-automate")) return true;         // explicit include
  return automationDefault === "opt-out";            // unlabelled ⇒ follow the knob (default opt-in ⇒ false)
}

const ELIGIBLE_CASES = [
  [[["faff-automation-hold"], "opt-out"], false],               // hold wins even under opt-out
  [[["faff-automation-hold", "faff-automate"], "opt-in"], false],// both present ⇒ hold wins
  [[["faff-automate"], "opt-in"], true],                        // explicit include
  [[[], "opt-in"], false],                                      // unlabelled + opt-in ⇒ ineligible (fail-safe)
  [[[], "opt-out"], true],                                      // unlabelled + opt-out ⇒ eligible (legacy)
  [[[], "garbage"], false],                                     // invalid default coerces to opt-in (fail-safe)
];

function runEligibleCases() {
  let fail = 0;
  for (const [[labels, def], want] of ELIGIBLE_CASES) {
    const got = automationEligible(labels, def);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} labels=[${labels.join(",")}] default=${def} → ${got} (want ${want})`);
  }
  return fail;
}

function eligibleSelftest() {
  const fail = runEligibleCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${ELIGIBLE_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdEligible(args) {
  if (args.includes("--selftest")) return eligibleSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const labels = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--label") labels.push(args[++i]);
  const def = (get("--default") || "opt-in").toLowerCase();
  console.log(String(automationEligible(labels, def)));
  return 0;
}


module.exports = { ELIGIBLE_CASES, automationEligible, cmdEligible, eligibleSelftest, runEligibleCases };
