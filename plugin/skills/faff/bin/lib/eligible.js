// ===========================================================================
// === region:factory — eligible — FAFF-61/1097: the automation-eligibility function. PURE: resolves ===
// whether a ticket may be touched by the AUTONOMOUS pipeline from a single signal —
// the tracker-owned `faff-automate` label. Present ⇒ eligible, absent ⇒ not. One
// eligibility model everywhere (FAFF-1097, operator decision 2026-09-24): tracker and
// git-only mode alike default opt-in, so the `automation_default` opt-out and the
// FAFF-753 git-only exclude are retired. `automationDefault` / `trackerPresent` are
// retained ONLY to keep the fixed 3-arg signature decision-capture's KERNEL_REGISTRY
// "eligible" contract depends on (see the signature note below); neither affects the
// verdict. Read-only skills never gate on this. The agent calls this (passing the
// issue's labels) and feeds the result to `faff next` as --not-eligible.
// ===========================================================================


// UNCHANGED signature/body (FAFF-1044): this positional 3-arg shape is decision-capture's
// KERNEL_REGISTRY "eligible" contract (required_inputs: labels/automationDefault/
// trackerPresent) — shadow-fidelity's `declaredInputKeys`/`optionalInputs` structurally
// introspects this exact function, so adding a 4th parameter here would grow the kernel's
// declared input set and break its "optionalInputs empty for every in-scope kernel"
// invariant (FAFF-826/956). Prefix support lives one layer up instead: see
// `normalizeEligibilityLabels` below, which translates a configured-prefix label onto the
// literal strings this function still compares against, threaded in by cmdEligible.
function automationEligible(labels, automationDefault, trackerPresent) {
  // FAFF-1097: eligibility is one signal — faff-automate present ⇒ eligible, absent ⇒ not.
  // automationDefault/trackerPresent are unused (retained only for the fixed signature).
  return new Set(labels).has("faff-automate");
}

// FAFF-1044: the role-lookup translation layer. Maps a raw label list resolved against
// the CONFIGURED prefix onto the default "faff-automate" spelling automationEligible
// compares — so the pipeline's actual eligibility decision is genuinely prefix-aware
// without automationEligible's own signature ever changing. Pure, no config read (prefix
// is threaded in by the caller); a "faff" prefix is a byte-identical no-op. Under a
// NON-default prefix, a literal "faff-automate" label is stripped first (never passed
// through unmapped) — otherwise it would leak past the translation and still match
// automationEligible's own unchanged literal check, silently reintroducing the "faff-"
// prefix as a fallback the spec explicitly rules out (no cross-prefix fallback; §5
// SCENARIOS "the role lookup resolves against the configured prefix, not faff-").
function normalizeEligibilityLabels(labels, prefix = "faff") {
  if (prefix === "faff") return labels;
  const automate = `${prefix}-automate`;
  return labels
    .filter((l) => l !== "faff-automate")
    .map((l) => (l === automate ? "faff-automate" : l));
}

// Cases: [[labels, default, trackerPresent], want]. FAFF-1097: only faff-automate
// presence decides eligibility now; default/trackerPresent are retained args that no
// longer affect the verdict (the rows that vary them prove they are ignored).
const ELIGIBLE_CASES = [
  [[["faff-automate"], "opt-in", true], true],                    // explicit include, tracker present
  [[["faff-automate"], "opt-in", false], true],                   // explicit include, git-only ⇒ still eligible
  [[["faff-automate"], "garbage", true], true],                   // default ignored — automate present wins
  [[[], "opt-in", true], false],                                  // unlabelled ⇒ ineligible (one opt-in model)
  [[[], "opt-in", false], false],                                 // unlabelled, git-only ⇒ ineligible (opt-in everywhere)
  [[[], "garbage", false], false],                                // default ignored — absent ⇒ ineligible
  [[[], "opt-in", undefined], false],                             // legacy 2-arg call ⇒ ineligible
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

// FAFF-1044: a configured non-default prefix resolves automate by role against THAT
// prefix — normalizeEligibilityLabels maps the configured-prefix label onto the literal
// automationEligible compares, and the default-prefix "faff-automate" string does NOT
// match under a custom prefix (no cross-prefix fallback).
const ELIGIBLE_PREFIX_CASES = [
  // [rawLabels, prefix, def, tracker] -> want (after normalizeEligibilityLabels + automationEligible)
  [["sd-automate"], "sd", "opt-in", true, true],             // explicit include under the configured prefix
  [["faff-automate"], "sd", "opt-in", true, false],          // default-prefix label doesn't match under "sd"
];

function runEligiblePrefixCases() {
  let fail = 0;
  for (const [rawLabels, prefix, def, tracker, want] of ELIGIBLE_PREFIX_CASES) {
    const normLabels = normalizeEligibilityLabels(rawLabels, prefix);
    const got = automationEligible(normLabels, def, tracker);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} labels=[${rawLabels.join(",")}] prefix=${prefix} default=${def} tracker=${tracker} → ${got} (want ${want})`);
  }
  return fail;
}

function eligibleSelftest() {
  const fail = runEligibleCases() + runEligiblePrefixCases();
  const total = ELIGIBLE_CASES.length + ELIGIBLE_PREFIX_CASES.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");
const { captureDecision } = require("./decision-capture");
const { findRoot } = require("./shared-infra");

const ELIGIBLE_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--label": { arity: 1, repeatable: true },
    "--default": { arity: 1 }, // retained for signature/decision-capture faithfulness; no longer affects the verdict (FAFF-1097)
    "--tracker": { arity: 1 }, // retained for signature/decision-capture faithfulness; no longer affects the verdict (FAFF-1097)
    "--root": { arity: 1 },
  },
};
const ELIGIBLE_USAGE = "usage: faff eligible [--label L]... [--default VALUE] [--tracker present|absent] [--root DIR]";

function cmdEligible(args) {
  if (args.includes("--selftest")) return eligibleSelftest();
  const { values, errors } = parseArgs(args, ELIGIBLE_SPEC);
  if (errors.length) return usageError(errors, ELIGIBLE_USAGE);
  const labels = values["--label"] || [];
  const def = (values["--default"] || "opt-in").toLowerCase();
  // absent ⇒ git-only (false); present, omitted, or any other value ⇒ tracker-present (true, tighter).
  const trackerPresent = (values["--tracker"] || "present").toLowerCase() !== "absent";
  // FAFF-1044: cmdEligible is the command layer — resolve the configured prefix once
  // (fail loud on a malformed value, same as `config get`) and normalise the raw labels
  // onto automationEligible's unchanged literal comparison via normalizeEligibilityLabels
  // (kept OUT of automationEligible's own signature — see that function's comment on why:
  // decision-capture's KERNEL_REGISTRY "eligible" contract / shadow-fidelity's structural
  // signature introspection, FAFF-826/956). Unset config ⇒ "faff", byte-identical zero-config.
  const { resolveLabelPrefix } = require("./config");
  const root = values["--root"] || findRoot();
  const resolvedPrefix = resolveLabelPrefix(root);
  if (resolvedPrefix.error) { process.stderr.write(resolvedPrefix.error + "\n"); return 2; }
  const normLabels = normalizeEligibilityLabels(labels, resolvedPrefix.prefix);
  const verdict = automationEligible(normLabels, def, trackerPresent);
  console.log(String(verdict));
  // FAFF-956: deterministic in-kernel decision-capture — best-effort, flag-guarded,
  // authority-inert. normalised_inputs uses the registry's canonical keys
  // (labels/automationDefault/trackerPresent) — `labels` here is the POST-normalisation
  // list (what automationEligible actually saw), so a replay of this exact record is
  // faithful; verdict is wrapped so it projects like-for-like against the replay (a bare
  // boolean is not an object|string base-record verdict).
  captureDecision({
    kernel: "eligible",
    normalised_inputs: { labels: normLabels, automationDefault: def, trackerPresent },
    verdict: { eligible: verdict },
    issue: process.env.FAFF_DECISION_ISSUE || "",
  });
  return 0;
}


module.exports = { ELIGIBLE_CASES, ELIGIBLE_PREFIX_CASES, automationEligible, cmdEligible, eligibleSelftest, normalizeEligibilityLabels, runEligibleCases, runEligiblePrefixCases };
