// ===========================================================================
// === region:factory — contract definitions + dispatch — FAFF-77: per-slot contract scripts (conformance by construction). ===
// `faff contract <name>` reads an extraction JSON (the adaptor's LLM-read of the
// producer's prose output) on stdin and emits the canonical, schema-valid contract
// data on stdout — or fails loud. Contract data flows ONLY from here (the wiring the
// spec adaptor is checked against). Schema = shape (the .json); `faff contract <name>
// --describe` = semantics, bound BY REFERENCE to the same validation enums the
// contract-defs modules branch on (FAFF-598, amending ADR-0001's schema/gateway split — see ADR-0087);
// gate MEANINGS (high/medium/low promotion) still live upstream, never here.
// FAFF-1392: the definitions live in contract-defs-*.js, one module per contract family. This
// file keeps the `faff contract` dispatcher and re-exports every name, so consumers require it.
// ===========================================================================

const fs = require("node:fs");
const { exitFor } = require("./contract-engine");
const { parseArgs, usageError } = require("./argv");
const { REVIEW_DISPOSITIONS, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS } = require("./review-vocab");
const { deriveHoldoutAggregate } = require("./holdout-record");   // FAFF-1291: factory -> governance is the legal direction
const { RUN_TRIGGER_REASONS, RUN_TRIGGER_VERDICTS } = require("./run-start");
const { ARCHITECTURE_RECOMMENDATIONS, BUILD_JUDGE_OUTCOMES, MARKER_CLASS, SPEC_JUDGE_OUTCOMES, computeArchitectureProposal, computeBuildJudgeVerdict, computeReviewVerdict, computeSpecJudgeVerdict, computeSpecReadiness, computeSpecReviewVerdict, contractArchitectureProposal, contractBuildJudgeVerdict, contractReviewVerdict, contractSpecJudgeVerdict, contractSpecReadiness, contractSpecReviewVerdict } = require("./contract-defs-review");
const { CI_TRIAGE_ACTIONS, CI_TRIAGE_FAULT_DOMAIN, CI_TRIAGE_FAULT_DOMAIN_SOURCES, CI_TRIAGE_ORIGIN, CI_TRIAGE_TRANSIENCE, ENV_HANDLE_STATUSES, GATE_RUNG_KINDS, GATE_RUNG_STATUSES, POST_MERGE_VERIFICATION_VERDICTS, ROOT_CAUSES, ROUTING_VERDICTS, computeAutomationRouting, computeCiTriage, computeDeliveryOutcome, computeEnvHandle, computePostMergeVerification, computeQualityGates, contractAutomationRouting, contractCiTriage, contractDeliveryOutcome, contractEnvHandle, contractPostMergeVerification, contractQualityGates, deriveTriageAction } = require("./contract-defs-delivery");
const { ADR_CHALLENGE_OUTCOMES, DISTANCE_CLASSES, DISTANCE_CLASS_RANK, PRDR_ACTORS, PRDR_BY_LEVEL, PRDR_DISPOSITIONS, PRDR_SUPERSEDES, PRDR_YAGNI_CHALLENGE_GROUNDS, PRDR_YAGNI_PROPOSAL_VERDICTS, PRD_READINESS_LICENCES, PRD_READINESS_REASONS, PRD_READINESS_VERDICTS, adrGatesPass, computeAdrAdmission, computeAdrAdmissionVerdict, computePrdCoverage, computePrdCoverageVerdict, computePrdDistance, computePrdReadiness, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict, contractAdrAdmission, contractPrdCoverage, contractPrdDistance, contractPrdReadiness, contractPrdrAdmission, contractPrdrYagni, prdrGatesPass } = require("./contract-defs-prd");
const { BUNDLE_BOUNDARY_KINDS, BUNDLE_VERDICTS, CUSTODY_CLASSIFICATIONS, CUSTODY_DETAIL_MAX, CUSTODY_MERGE_STATES, CUSTODY_VERDICT_SCHEMA_VERSION, HOLDOUT_AGGREGATES, HOLDOUT_CLASSES, HOLDOUT_VERDICTS, HOLDOUT_REASON_CODES, LANE_BOUNDARY_ACCESS, LANE_BOUNDARY_CONTAINERS, LANE_BOUNDARY_HOST, LANE_BOUNDARY_LANES, RECOVERY_DISPOSITIONS, SCENARIO_RECORD_DISPOSITIONS, classifyCustodyVerdictBytes, computeBundleVerdict, computeCustodyVerdict, computeCustodyVerdictAdmission, computeHoldoutVerdict, computeHoldoutVerdictsMap, computeLaneBoundary, computeRecoveryDispositionVerdict, computeScenarioRecordVerdict, contractBundleVerdict, contractHoldoutVerdict, contractLaneBoundary, contractRecoveryDispositionVerdict, contractScenarioRecordVerdict, holdoutGateResult, rollupNeedsHumanReasons } = require("./contract-defs-evidence");
const { L4_ENVELOPE_LEVELS, L4_ENVELOPE_OP_KINDS, L4_ENVELOPE_PROVENANCE, RUN_TERMINATION_FLOOR_VERDICT, RUN_TERMINATION_KNOWN_PLAIN, RUN_TERMINATION_POLICY_SOURCES, computeL4TopologyEnvelope, computeRunTermination, computeRunTrigger, contractL4TopologyEnvelope, contractRunTermination, contractRunTrigger, isKnownStopReason, l4TopologyDecision } = require("./contract-defs-run");
const { CAPABILITY_READS, CI_STATES, DISPATCH_STATES, FLOOR_DECISION_GRANTS, FLOOR_DEPENDENCY_GATES, FLOOR_HOLDOUTS, FLOOR_INTEGRITY, FLOOR_LEVELS, FLOOR_REVIEW_VERDICTS, HOLDOUT_POSTURES, NO_CI_POLICIES, computeIntegrityFloor, contractIntegrityFloor, decideFloor, requiresSelfConsistencyStamp, resolveGateLevel, resolveHoldoutPosture } = require("./contract-defs-floor");
const { CONTRACT_DESCRIBES, describeChecks, renderContractDescribeJson, renderContractDescribeMarkdown } = require("./contract-defs-describe");
const { CONTRACTS } = require("./contract-defs-registry");
const CONTRACT_SPEC = { flags: { "--selftest": { arity: 0 }, "--require-spawner-attested": { arity: 0 }, "--in": { arity: 1 }, "--describe": { arity: 0 }, "--json": { arity: 0 } }, positionals: { min: 0, max: 1, name: "contract-name" } };

function contractSelftest(name) {
  const names = name ? [name] : Object.keys(CONTRACTS);
  let fail = 0, total = 0;
  for (const n of names) {
    const c = CONTRACTS[n];
    if (!c) { process.stderr.write(`faff contract: unknown contract '${n}'\n`); return 2; }
    for (const f of c.fixtures) {
      total++;
      const exit = exitFor(f.opts ? c.run(f.in, f.opts) : c.run(f.in));
      const ok = exit === f.wantExit;
      if (!ok) fail++;
      console.log(`${ok ? "ok  " : "FAIL"} ${n}/${f.name} → exit ${exit} (want ${f.wantExit})`);
    }
    for (const row of describeChecks(n, c)) {
      total++;
      if (!row.ok) fail++;
      console.log(`${row.ok ? "ok  " : "FAIL"} ${n}/${row.label}`);
    }
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdContract(args) {
  const { values, positionals, errors } = parseArgs(args, CONTRACT_SPEC);
  if (errors.length) return usageError(errors, "usage: faff contract <name> [--in FILE] | [<name>] --selftest | [<name>] --describe [--json]   (extraction JSON on stdin)");
  const name = positionals[0];
  if (values["--selftest"]) return contractSelftest(name);
  // FAFF-598: --describe is a read-only rendering branch, checked BEFORE the --in/stdin validation path
  // and reaching NO fs.readFileSync(0) — it must never block on a tty stdin.
  if (values["--describe"]) {
    if (values["--in"] !== undefined) { process.stderr.write("faff contract: --describe takes no input (--in is invalid with --describe)\n"); return 2; }
    if (!name) {
      // Unnamed --describe = index: one "name — purpose" line per dispatcher-known contract (mirrors
      // the unnamed --selftest convention — runs/lists all).
      for (const n of Object.keys(CONTRACTS)) process.stdout.write(`${n} — ${CONTRACTS[n].describe.purpose}\n`);
      return 0;
    }
    const c = CONTRACTS[name];
    if (!c) { process.stderr.write(`faff contract: unknown contract '${name}' (known: ${Object.keys(CONTRACTS).join(", ")})\n`); return 2; }
    if (values["--json"]) { process.stdout.write(JSON.stringify(renderContractDescribeJson(name, c)) + "\n"); return 0; }
    process.stdout.write(renderContractDescribeMarkdown(name, c));
    return 0;
  }
  if (values["--json"]) { process.stderr.write("faff contract: --json requires --describe\n"); return 2; }
  if (!name) { process.stderr.write("usage: faff contract <name> [--in FILE] | [<name>] --selftest | [<name>] --describe [--json]   (extraction JSON on stdin)\n"); return 2; }
  const c = CONTRACTS[name];
  if (!c) { process.stderr.write(`faff contract: unknown contract '${name}' (known: ${Object.keys(CONTRACTS).join(", ")})\n`); return 2; }
  const inFile = values["--in"];
  let rawIn;
  try { rawIn = inFile !== undefined ? fs.readFileSync(inFile, "utf8") : fs.readFileSync(0, "utf8"); }
  catch (e) { process.stderr.write(`faff contract: cannot read input: ${e.message}\n`); return 2; }
  let extraction;
  try { extraction = JSON.parse(rawIn); }
  catch (e) { process.stderr.write(`faff contract ${name}: extraction is not valid JSON: ${e.message}\n`); return 2; }
  // FAFF-384: `--require-spawner-attested` arms the holdout-verdict spawner-attestation ratchet (caller-
  // resolved from the run's lane-boundary cage promise). Ignored by every other contract's run fn.
  const runOpts = name === "holdout-verdict" && values["--require-spawner-attested"] ? { requireSpawnerAttested: true } : undefined;
  const result = runOpts ? c.run(extraction, runOpts) : c.run(extraction);
  if (result.failLoud) { process.stderr.write(`faff contract ${name}: fail-loud: ${result.failLoud}\n`); return 2; }
  process.stdout.write(JSON.stringify(result.contractData) + "\n");
  return (result.contractData.violations || []).length === 0 ? 0 : 1;
}


module.exports = { ADR_CHALLENGE_OUTCOMES, ARCHITECTURE_RECOMMENDATIONS, BUILD_JUDGE_OUTCOMES, BUNDLE_BOUNDARY_KINDS, BUNDLE_VERDICTS, CI_STATES, CUSTODY_CLASSIFICATIONS, CUSTODY_DETAIL_MAX, CUSTODY_MERGE_STATES, CUSTODY_VERDICT_SCHEMA_VERSION, DISTANCE_CLASSES, DISTANCE_CLASS_RANK, CI_TRIAGE_ACTIONS, CI_TRIAGE_FAULT_DOMAIN, CI_TRIAGE_FAULT_DOMAIN_SOURCES, CI_TRIAGE_ORIGIN, CI_TRIAGE_TRANSIENCE, CONTRACTS, CONTRACT_DESCRIBES, DISPATCH_STATES, ENV_HANDLE_STATUSES, FLOOR_DECISION_GRANTS, FLOOR_DEPENDENCY_GATES, FLOOR_HOLDOUTS, FLOOR_INTEGRITY, FLOOR_LEVELS, FLOOR_REVIEW_VERDICTS, GATE_RUNG_KINDS, GATE_RUNG_STATUSES, HOLDOUT_AGGREGATES, HOLDOUT_CLASSES, HOLDOUT_VERDICTS, HOLDOUT_REASON_CODES, L4_ENVELOPE_LEVELS, L4_ENVELOPE_OP_KINDS, L4_ENVELOPE_PROVENANCE, LANE_BOUNDARY_ACCESS, LANE_BOUNDARY_CONTAINERS, LANE_BOUNDARY_HOST, LANE_BOUNDARY_LANES, MARKER_CLASS, NO_CI_POLICIES, POST_MERGE_VERIFICATION_VERDICTS, PRDR_ACTORS, PRDR_BY_LEVEL, PRDR_DISPOSITIONS, PRDR_SUPERSEDES, PRDR_YAGNI_CHALLENGE_GROUNDS, PRDR_YAGNI_PROPOSAL_VERDICTS, PRD_READINESS_LICENCES, PRD_READINESS_REASONS, PRD_READINESS_VERDICTS, RECOVERY_DISPOSITIONS, REVIEW_DISPOSITIONS, ROOT_CAUSES, ROUTING_VERDICTS, SCENARIO_RECORD_DISPOSITIONS, RUN_TERMINATION_FLOOR_VERDICT, RUN_TERMINATION_KNOWN_PLAIN, RUN_TERMINATION_POLICY_SOURCES, RUN_TRIGGER_REASONS, RUN_TRIGGER_VERDICTS, SPEC_JUDGE_OUTCOMES, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS, adrGatesPass, classifyCustodyVerdictBytes, cmdContract, computeAdrAdmission, computeAdrAdmissionVerdict, computeArchitectureProposal, computeAutomationRouting, computeBuildJudgeVerdict, computeBundleVerdict, computeCiTriage, computeCustodyVerdict, computeCustodyVerdictAdmission, computeDeliveryOutcome, computeEnvHandle, computeHoldoutVerdict, computeHoldoutVerdictsMap, computeIntegrityFloor, computeL4TopologyEnvelope, computeLaneBoundary, computePostMergeVerification, computePrdCoverage, computePrdCoverageVerdict, computePrdDistance, computePrdReadiness, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict, computeQualityGates, computeRecoveryDispositionVerdict, computeReviewVerdict, computeRunTermination, computeRunTrigger, computeScenarioRecordVerdict, computeSpecJudgeVerdict, computeSpecReadiness, computeSpecReviewVerdict, contractAdrAdmission, contractArchitectureProposal, contractAutomationRouting, contractBuildJudgeVerdict, contractBundleVerdict, contractCiTriage, contractDeliveryOutcome, contractEnvHandle, contractHoldoutVerdict, contractIntegrityFloor, contractL4TopologyEnvelope, contractLaneBoundary, contractPostMergeVerification, contractPrdCoverage, contractPrdDistance, contractPrdReadiness, contractPrdrAdmission, contractPrdrYagni, contractQualityGates, contractRecoveryDispositionVerdict, contractReviewVerdict, contractRunTermination, contractRunTrigger, contractScenarioRecordVerdict, contractSelftest, contractSpecJudgeVerdict, contractSpecReadiness, contractSpecReviewVerdict, decideFloor, deriveHoldoutAggregate, deriveTriageAction, holdoutGateResult, rollupNeedsHumanReasons, isKnownStopReason, l4TopologyDecision, prdrGatesPass, requiresSelfConsistencyStamp, resolveGateLevel, HOLDOUT_POSTURES, CAPABILITY_READS, resolveHoldoutPosture };
