// ===========================================================================
// === region:factory — gates — FAFF-11: the engineering-quality gate ladder. ===
// `faff gates discover` deterministically inspects the repo's OWN declared checks and emits an
// ordered List<Rung> cheapest-first + a discovery classification (confident/none). Sources read
// (v2, FAFF-533): pre-commit hooks, package.json scripts, Makefile targets, and `.github/workflows/*.yml`
// (a `run:`-line scan against a curated recognised-runner allow-list; the CI source lets a repo whose
// gates live ONLY in CI — faff's own, via validate.yml — resolve `confident` instead of `none`).
// (The spec also names CLAUDE.md and other CI hosts as future sources — not yet parsed here; a repo
// declaring checks ONLY in those resolves `discovery: none`, which the fail-closed default routes to
// needs-human rather than silently passing — never green by silence. `gates.fallback: advisory` is
// the explicit opt-out.)
// `faff gates run` discovers then executes the rungs cheapest-first in the worktree sandbox
// (execution_target = cwd; the single FAFF-12 seam) and emits a GatesOutcome + a fenced
// faff-contract:quality-gates block. Pure-deterministic: NO LLM judgement decides what counts as a
// gate, and a command whose only source is an issue description / third-party comment is NEVER
// discovered (TRUSTED-SOURCE-ONLY: only the repo's own config files, like Step 8).
// The ladder is split across sibling modules (FAFF-1390); this file is the facade and re-exports
// every name it exported before the split, so `require("./gates")` callers are unchanged:
//   gates-config.js — the gates.* config knobs (readGatesConfig, gatesFallbackPolicy) and the host facts they default from (shard concurrency, local OS)
//   gates-discover.js — the run-path discovery sources: package.json scripts, Makefile, pre-commit, runner files, and the CI_RUNNERS recogniser over workflow `run:` lines (discoverRungs)
//   gates-report.js — FAFF-848 (639a): the REPORTING recogniser for `faff gates discover` (discoverRungsReporting)
//   gates-exec.js — rung execution: one spawn, a sharded rung, or a per-file pool (runRung)
//   gates-select.js — FAFF-849 (639b): select the runnable rungs from the reporting set and run the ladder (runLadder)
//   gates-cli.js — the `faff gates` command (cmdGates) and its --selftest
//   gates-doctor.js — the `faff doctor` install-health check and its `faff sync` repair
// ===========================================================================

const { defaultShardConcurrency, gatesFallbackPolicy, localOs, readGatesConfig, safeAvailableParallelism } = require("./gates-config");
const { CI_COST_PENALTY, GATE_COST, ciRunnerKind, discoverCiWorkflows, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRunnerFiles, discoverRungs, extractRunCommands, gateKindForName, normaliseLocalRungCommand, runnerKindForName } = require("./gates-discover");
const { PARTIAL_COVERAGE_THRESHOLD, discoverCiWorkflowsReporting, discoverRungsReporting, extractRunCommandsWithContext, reportKind } = require("./gates-report");
const { MAX_RUNG_STDOUT_BYTES, aggregateFileResults, aggregateShardResults, globToRegExp, listTestFiles, runFilePoolRung, classifyRungResult, runRung, runShardedRung, runSingleSpawnSync, shardCapable, spawnAsync } = require("./gates-exec");
const { aggregateSelftest, applyPartialPolicy, capPerKind, discoverCiWorkflowsRunnable, exclusionReason, osFamily, runLadder, selectRunnableRungs } = require("./gates-select");
const { GATES_SPEC, GATES_SURFACE, cmdGates, gatesContractExtraction, gatesSelftest } = require("./gates-cli");
const { assertScanSetExpectCopiesInvariant, buildDoctorJson, cmdDoctor, cmdSync, gatherDoctorState, mergeFencePresentAt, resolveDoctorScanSet, resolveSyncScript, scanDoctorDirectory } = require("./gates-doctor");

module.exports = { CI_COST_PENALTY, GATES_SPEC, GATES_SURFACE, GATE_COST, MAX_RUNG_STDOUT_BYTES, PARTIAL_COVERAGE_THRESHOLD, aggregateFileResults, aggregateSelftest, aggregateShardResults, globToRegExp, listTestFiles, runFilePoolRung, applyPartialPolicy, assertScanSetExpectCopiesInvariant, buildDoctorJson, capPerKind, defaultShardConcurrency, ciRunnerKind, classifyRungResult, cmdDoctor, cmdGates, cmdSync, discoverCiWorkflows, discoverCiWorkflowsReporting, discoverCiWorkflowsRunnable, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRunnerFiles, discoverRungs, discoverRungsReporting, exclusionReason, extractRunCommands, extractRunCommandsWithContext, gateKindForName, gatesContractExtraction, gatesFallbackPolicy, gatesSelftest, gatherDoctorState, localOs, mergeFencePresentAt, normaliseLocalRungCommand, osFamily, readGatesConfig, reportKind, resolveDoctorScanSet, resolveSyncScript, runLadder, runnerKindForName, runRung, runShardedRung, runSingleSpawnSync, safeAvailableParallelism, scanDoctorDirectory, selectRunnableRungs, shardCapable, spawnAsync };
