// ===========================================================================
// === region:factory — gates-report — FAFF-848 (639a): the REPORTING recogniser for `faff gates discover` (discoverRungsReporting) ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { readGatesConfig } = require("./gates-config");
const { CI_COST_PENALTY, CI_RUNNERS, GATE_COST, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRunnerFiles, mergeRunnerTier } = require("./gates-discover");

// ===========================================================================
// FAFF-848 (639a) — the REPORTING path. `faff gates discover` only; the run-path discovery
// (discoverRungs, ciRunnerKind, CI_RUNNERS in gates-discover.js) and rung execution (gates-exec.js)
// never require this module. Since FAFF-849 the ladder's selection (gates-select.js) consumes
// reportKind and extractRunCommandsWithContext from here; see the banner there.
// Recognises faff's own invariant lints (regions check/selftest, adr validate, prdr validate) into
// a REPORT, so `faff gates discover` stops under-reporting what CI actually enforces (the FAFF-604
// class of surprise) — without changing what `faff gates run` executes. See records/specs/
// 2026-08-19-FAFF-848-639a-gate-discovery-sees-what-ci-sees-design.md.
// ===========================================================================

// The four invariant-lint patterns, reporting-only. Additive to CI_RUNNERS — never consulted by
// ciRunnerKind/runLadder. `regions selftest` matches BOTH CI variants (--region factory/governance)
// as two distinct commands; report-only recognition of the destructive factory variant is safe
// because 848 executes nothing it reports (human-ratified 2026-08-19 — see the spec §7).
const INVARIANT_LINT_PATTERNS = [
  { pattern: /(^|[^a-z])regions\s+selftest([^a-z]|$)/, kind: "STATIC_ANALYSIS" },
  { pattern: /(^|[^a-z])regions\s+check([^a-z]|$)/, kind: "STATIC_ANALYSIS" },
  { pattern: /(^|[^a-z])adr\s+validate([^a-z]|$)/, kind: "STATIC_ANALYSIS" },
  { pattern: /(^|[^a-z])prdr\s+validate([^a-z]|$)/, kind: "STATIC_ANALYSIS" },
];

// The reporting recogniser = CI_RUNNERS ∪ INVARIANT_LINT_PATTERNS. Reporting-only: never seen by
// ciRunnerKind/runLadder (the execution path keeps consuming ciRunnerKind exactly as before).
const REPORT_RUNNERS = [...CI_RUNNERS, ...INVARIANT_LINT_PATTERNS];

function reportKind(command) {
  const n = String(command).toLowerCase();
  for (const { pattern, kind } of REPORT_RUNNERS) {
    if (pattern.test(n)) return kind;
  }
  return null;
}

// Reporting variant of extractRunCommands: same line-scan posture, but additionally tracks the
// enclosing `jobs.<key>`, the enclosing job's `runs-on:` (a job property at indent 4 — FAFF-849
// (639b), the input the os-mismatch exclusion needs), the most recent `- name:` at step
// indentation, and a `step_index` incremented ONCE per `run:` key (not once per emitted body line
// — a block scalar is one step however many command lines it holds, the counting unit the spec's
// Coverage record needs). Returns `{command, step_index, step_name, job, runs_on}` records, plus
// `working_directory` when the step sets one (before or after its `run:`). The
// execution-path extractRunCommands (gates-discover.js) is untouched and keeps returning bare command strings.
function extractRunCommandsWithContext(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  const indentOf = (s) => (s.match(/^[ \t]*/) || [""])[0].length;
  let inJobsBlock = false;
  let currentJob = null;
  let currentJobRunsOn = null;
  let currentStepName = null;
  let stepsIndent = null;
  let stepDashIndent = null;
  let currentStepWorkdir = null;
  let currentStepRecords = [];
  let stepIndex = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed !== "") {
      const indent = indentOf(line);
      const isStepDash = stepsIndent !== null && indent > stepsIndent && /^\s*-\s+\S/.test(line);
      if (/^steps:\s*$/.test(trimmed)) {
        stepsIndent = indent;
      } else if (stepsIndent !== null && indent <= stepsIndent) {
        stepsIndent = null;
      }
      if (isStepDash || stepsIndent === null || (stepDashIndent !== null && indent <= stepDashIndent)) {
        currentStepWorkdir = null;
        currentStepRecords = [];
        stepDashIndent = isStepDash ? indent : null;
      }
      const workdirMatch = /^\s*(?:-\s+)?working-directory:\s*(.+)$/.exec(line);
      if (workdirMatch && stepDashIndent !== null) {
        currentStepWorkdir = workdirMatch[1].trim().replace(/^["']|["']$/g, "");
        for (const rec of currentStepRecords) rec.working_directory = currentStepWorkdir;
        i += 1; continue;
      }
    }

    if (!inJobsBlock && /^jobs:\s*$/.test(trimmed) && indentOf(line) === 0) {
      inJobsBlock = true;
      i += 1; continue;
    }
    if (inJobsBlock) {
      const jobMatch = /^([A-Za-z0-9_.-]+):\s*$/.exec(trimmed);
      if (jobMatch && indentOf(line) === 2) {
        currentJob = jobMatch[1];
        currentJobRunsOn = null;         // a new job resets the enclosing runs-on
        currentStepName = null;
        i += 1; continue;
      }
      // Capture `runs-on:` as a direct job property (indent 4 under the indent-2 job header).
      // The value is kept raw (`macos-latest`, `ubuntu-latest`, or a `${{ matrix.os }}` expr that
      // osFamily() reads as unrecognised → never excluded on OS grounds).
      const runsOnMatch = /^\s*runs-on:\s*(.+)$/.exec(line);
      if (runsOnMatch && indentOf(line) === 4) {
        currentJobRunsOn = runsOnMatch[1].trim().replace(/^["']|["']$/g, "");
        i += 1; continue;
      }
    }

    const stepNameMatch = /^\s*-\s*name:\s*(.+)$/.exec(line);
    if (stepNameMatch) {
      currentStepName = stepNameMatch[1].trim().replace(/^["']|["']$/g, "");
      i += 1; continue;
    }

    const m = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
    if (!m) { i += 1; continue; }
    const keyIndent = indentOf(line);
    const inline = m[2].trim();
    stepIndex += 1;                     // one increment per `run:` key, regardless of body length
    const thisStepIndex = stepIndex;
    const ctx = { step_index: thisStepIndex, step_name: currentStepName, job: currentJob, runs_on: currentJobRunsOn };
    const emit = (command) => {
      const rec = { command, ...ctx };
      if (currentStepWorkdir) rec.working_directory = currentStepWorkdir;
      out.push(rec);
      currentStepRecords.push(rec);
    };
    if (/^[|>][+-]?\s*$/.test(inline)) {
      i += 1;
      while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > keyIndent)) {
        const body = lines[i].trim();
        if (body !== "") emit(body);
        i += 1;
      }
      continue;
    } else if (inline !== "") {
      emit(inline.replace(/^["']|["']$/g, ""));
    }
    i += 1;
  }
  return out;
}

// Reporting variant of discoverCiWorkflows: emits a rung per REPORT-recognised command (using
// reportKind, not ciRunnerKind) and returns the step-granularity Coverage inputs alongside. A
// missing dir / unreadable file / zero recognised commands → empty rungs + zero coverage (never
// throws — same posture as discoverCiWorkflows).
function discoverCiWorkflowsReporting(root) {
  const rungs = [];
  let eligibleSteps = 0;
  const recognisedStepKeys = new Set();
  const dir = path.join(root, ".github", "workflows");
  let stat;
  try { stat = fs.statSync(dir); } catch { return { rungs, eligibleSteps, recognisedSteps: 0 }; }
  if (!stat.isDirectory()) return { rungs, eligibleSteps, recognisedSteps: 0 };
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return { rungs, eligibleSteps, recognisedSteps: 0 }; }
  const files = entries.filter((f) => /\.ya?ml$/i.test(f)).sort();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const records = extractRunCommandsWithContext(text);
    const stepIndices = new Set(records.map((r) => r.step_index));
    eligibleSteps += stepIndices.size;
    for (const rec of records) {
      const kind = reportKind(rec.command);
      if (!kind) continue;
      recognisedStepKeys.add(`${f}:${rec.step_index}`);
      rungs.push({ kind, name: `${kind.toLowerCase()} (ci-workflow: ${rec.command})`, command: rec.command, source: "ci_workflow", cost_rank: GATE_COST[kind] + CI_COST_PENALTY, required: true });
    }
  }
  return { rungs, eligibleSteps, recognisedSteps: recognisedStepKeys.size };
}

// The reporting resolver `faff gates discover` consumes. DISTINCT from discoverRungs (the
// execution resolver in gates-discover.js, untouched): local sources are reused as-is (discoverPreCommit/
// discoverPkgScripts/discoverMakefile — the same functions the execution path calls), but CI
// rungs come from the WIDER reporting recogniser and a TWO-TIER dedup — by kind within local
// (collapse: usually the same check declared three ways), by (kind, command) within ci (keep:
// distinct CI lints like validate-adapters/lint-refs/lint-cli-doc are different checks). A local
// rung of a kind still suppresses ALL ci rungs of that kind (FAFF-533 preserved). Also computes
// the Coverage record and the discovery classification (confident/partial/none) — `partial` is
// new here (empty → none; ratio < 0.5 → partial; else confident); `runLadder` never sees this.
const PARTIAL_COVERAGE_THRESHOLD = 0.5; // hardcoded constant — a configurable gates.* threshold is 639b.

function discoverRungsReporting(root) {
  const localRungs = [
    ...discoverPreCommit(root),
    ...discoverPkgScripts(root),
    ...discoverMakefile(root),
  ];
  const localByKind = new Map();
  for (const r of localRungs.slice().sort((a, b) => a.cost_rank - b.cost_rank)) {
    if (!localByKind.has(r.kind)) localByKind.set(r.kind, r);
  }
  const dedupedLocal = [...localByKind.values()];

  const { rungs: ciReportRungs, eligibleSteps, recognisedSteps } = discoverCiWorkflowsReporting(root);
  const ciByKindCommand = new Map();
  for (const r of ciReportRungs) {
    const key = `${r.kind} ${r.command}`;
    if (!ciByKindCommand.has(key)) ciByKindCommand.set(key, r); // first occurrence wins (stable)
  }
  const { rungs: runnerRungs } = discoverRunnerFiles(root, { cap: readGatesConfig(root).max_rungs_per_kind });
  const rungs = mergeRunnerTier(dedupedLocal, runnerRungs, [...ciByKindCommand.values()]).rungs
    .sort((a, b) => a.cost_rank - b.cost_rank);
  const ratio = eligibleSteps === 0 ? 1.0 : recognisedSteps / eligibleSteps;
  const coverage = { eligible_steps: eligibleSteps, recognised_steps: recognisedSteps, ratio };
  let discovery;
  if (rungs.length === 0) discovery = "none";
  else if (ratio < PARTIAL_COVERAGE_THRESHOLD) discovery = "partial";
  else discovery = "confident";
  return { rungs, discovery, coverage };
}

module.exports = { PARTIAL_COVERAGE_THRESHOLD, discoverCiWorkflowsReporting, discoverRungsReporting, extractRunCommandsWithContext, reportKind };
