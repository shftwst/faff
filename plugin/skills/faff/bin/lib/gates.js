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
// ===========================================================================

// Cost ranks — lower = cheaper / more-local, the sequencing key (cheapest-first).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const GATES_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 } }, positionals: { min: 0, max: 1, name: "action" } };
// FAFF-628 — declared grammar. Neither `discover` nor `run` unconditionally requires a flag
// today (both default from --root/findRoot()).
const GATES_SURFACE = {
  kind: "subcommand_dispatch",
  spec: GATES_SPEC,
  subcommands: {
    discover: { required_flags: [] },
    run: { required_flags: [] },
  },
};
const SYNC_SPEC = { flags: { "--json": { arity: 0 }, "--dry-run": { arity: 0 }, "--script": { arity: 1 } } };
const DOCTOR_SPEC = { flags: { "--target": { arity: 1 }, "--root": { arity: 1 }, "--json": { arity: 0 } } };
const { loadConfig } = require("./config");
const { contractQualityGates } = require("./contract-defs");
const { commandInvokesFaffHook, preToolUseCommands } = require("./hooks-ensure");
const { dig, findRoot, homeDir, mainWorktreeRoot } = require("./shared-infra");

const GATE_COST = { FORMAT: 10, LINT: 20, TYPECHECK: 30, STATIC_ANALYSIS: 40, UNIT: 50, OTHER: 60 };

// FAFF-533: added to GATE_COST[kind] for a CI-sourced rung, so a locally-declared gate of the same
// kind (pkg/Makefile at base, pre-commit at base-5) always wins the dedup-by-kind (lowest cost_rank).
// CI is the fallback source, discoverable only when it is the SOLE declarer of that kind.
const CI_COST_PENALTY = 5;

// Map a script/target NAME to a RungKind by its conventional intent. Returns null for names that
// are not recognisably an engineering gate (so we never fabricate a gate from an arbitrary script).
function gateKindForName(name) {
  const n = String(name).toLowerCase();
  if (/(^|[^a-z])(fmt|format|prettier|gofmt|rustfmt|black|isort)([^a-z]|$)/.test(n)) return "FORMAT";
  if (/(^|[^a-z])(lint|eslint|flake8|ruff|clippy|vet|rubocop|standard)([^a-z]|$)/.test(n)) return "LINT";
  if (/(^|[^a-z])(typecheck|type-check|tsc|mypy|pyright|types)([^a-z]|$)/.test(n)) return "TYPECHECK";
  if (/(^|[^a-z])(static|analyz|analyse|sast|bandit|semgrep)([^a-z]|$)/.test(n)) return "STATIC_ANALYSIS";
  if (/(^|[^a-z])(test|tests|unit|spec|pytest|jest|vitest|check)([^a-z]|$)/.test(n)) return "UNIT";
  return null;
}

// Discover the package.json scripts that look like engineering gates → rungs.
function discoverPkgScripts(root) {
  const rungs = [];
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return rungs;
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { return rungs; }
  const scripts = (pkg && pkg.scripts) || {};
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string" || !body.trim()) continue;
    const kind = gateKindForName(name);
    if (!kind) continue;
    rungs.push({ kind, name: `${kind.toLowerCase()} (package.json: npm run ${name})`, command: `npm run ${name}`, source: "pkg_script", cost_rank: GATE_COST[kind], required: true });
  }
  return rungs;
}

// Discover Makefile targets that look like engineering gates → rungs. Trusted source: the repo's
// own Makefile. We read target NAMES only (the line `target:` at col 0), never recipe bodies.
function discoverMakefile(root) {
  const rungs = [];
  const mkPath = path.join(root, "Makefile");
  if (!fs.existsSync(mkPath)) return rungs;
  let text;
  try { text = fs.readFileSync(mkPath, "utf8"); } catch { return rungs; }
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/.exec(line);
    if (m) targets.add(m[1]);
  }
  for (const t of targets) {
    const kind = gateKindForName(t);
    if (!kind) continue;
    rungs.push({ kind, name: `${kind.toLowerCase()} (Makefile: make ${t})`, command: `make ${t}`, source: "makefile", cost_rank: GATE_COST[kind], required: true });
  }
  return rungs;
}

// Discover pre-commit hook ids → rungs (declared hooks the repo opted into). Trusted: the repo's
// .pre-commit-config.yaml. We read hook IDs only and run them via `pre-commit run <id> --all-files`.
function discoverPreCommit(root) {
  const rungs = [];
  const cfg = ["", ".yaml", ".yml"].map((e) => path.join(root, ".pre-commit-config" + e)).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!cfg) return rungs;
  let text;
  try { text = fs.readFileSync(cfg, "utf8"); } catch { return rungs; }
  // Minimal: collect `- id: <hook>` lines (our YAML subset parser does lists shallowly; read ids directly).
  const ids = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*-?\s*id:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*$/.exec(line);
    if (m) ids.push(m[1]);
  }
  for (const id of ids) {
    // Only sweep in a hook whose id maps to a recognised engineering-gate kind. A repo's
    // pre-commit config can carry arbitrary heavy hooks (an integration suite, a deploy check);
    // running an UNRECOGNISED hook as a REQUIRED gate is exactly the "slow target labelled cheap"
    // failure the spec names. Drop the unknown ones (consistent with the pkg/Makefile paths, which
    // also drop names gateKindForName can't classify) rather than gate on them.
    const kind = gateKindForName(id);
    if (!kind) continue;
    rungs.push({ kind, name: `${kind.toLowerCase()} (pre-commit: ${id})`, command: `pre-commit run ${id} --all-files`, source: "pre_commit", cost_rank: GATE_COST[kind] - 5, required: true });
  }
  return rungs;
}

// FAFF-533: the curated recognised-runner allow-list. Ordered — first match wins. This matches a
// full COMMAND line (not a script/target NAME like gateKindForName), because gateKindForName's loose
// name tokens (`check`, `test`) over-match arbitrary command text (`git checkout`, `container-check`),
// fabricating required rungs from noise — the "slow target labelled cheap" failure. This list stays
// deliberately narrow: over-matching is a bug, under-matching (a missed runner → `none`) is safe.
// The table is the documented one-line extension point for new runners.
const CI_RUNNERS = [
  // --- TYPECHECK ---
  { pattern: /(^|[^a-z])(tsc|mypy|pyright)([^a-z]|$)/, kind: "TYPECHECK" },
  // --- LINT (incl. faff's OWN CLI gates) ---
  { pattern: /(^|[^a-z])(eslint|flake8|ruff|clippy|rubocop|standardrb?)([^a-z]|$)/, kind: "LINT" },
  { pattern: /(^|[^a-z])go\s+vet([^a-z]|$)/, kind: "LINT" },
  { pattern: /(^|[^a-z])(validate-adapters|lint-refs|lint-cli-doc)([^a-z]|$)/, kind: "LINT" }, // faff's own gates
  // --- FORMAT ---
  { pattern: /(^|[^a-z])(prettier|gofmt|rustfmt|black|isort)([^a-z]|$)/, kind: "FORMAT" },
  // --- UNIT ---
  { pattern: /(^|[^a-z])node\b[^\n]*--test([^a-z]|$)/, kind: "UNIT" }, // node --test
  { pattern: /(^|[^a-z])(jest|vitest|mocha|\bava\b|tap|pytest|phpunit|rspec)([^a-z]|$)/, kind: "UNIT" },
  { pattern: /(^|[^a-z])go\s+test([^a-z]|$)/, kind: "UNIT" },
  { pattern: /(^|[^a-z])cargo\s+test([^a-z]|$)/, kind: "UNIT" },
];

// Return the RungKind for a recognised CI runner command, or null for an unrecognised command.
// Matches a full COMMAND line against the curated CI_RUNNERS allow-list (see the note there).
function ciRunnerKind(command) {
  const n = String(command).toLowerCase();
  for (const { pattern, kind } of CI_RUNNERS) {
    if (pattern.test(n)) return kind;
  }
  return null;
}

// ===========================================================================
// FAFF-848 (639a) — the REPORTING path. `faff gates discover` only; `faff gates run` (runLadder,
// discoverRungs, ciRunnerKind, CI_RUNNERS above) is NEVER touched by anything below this line.
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
// Coverage record needs). Returns `{command, step_index, step_name, job, runs_on}` records. The
// execution-path extractRunCommands above is untouched and keeps returning bare command strings.
function extractRunCommandsWithContext(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  const indentOf = (s) => (s.match(/^[ \t]*/) || [""])[0].length;
  let inJobsBlock = false;
  let currentJob = null;
  let currentJobRunsOn = null;
  let currentStepName = null;
  let stepIndex = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

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
    if (/^[|>][+-]?\s*$/.test(inline)) {
      i += 1;
      while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > keyIndent)) {
        const body = lines[i].trim();
        if (body !== "") out.push({ command: body, ...ctx });
        i += 1;
      }
      continue;
    } else if (inline !== "") {
      out.push({ command: inline.replace(/^["']|["']$/g, ""), ...ctx });
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
// execution resolver above, untouched): local sources are reused as-is (discoverPreCommit/
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
  const localKinds = new Set(dedupedLocal.map((r) => r.kind));

  const { rungs: ciReportRungs, eligibleSteps, recognisedSteps } = discoverCiWorkflowsReporting(root);
  const ciByKindCommand = new Map();
  for (const r of ciReportRungs) {
    const key = `${r.kind} ${r.command}`;
    if (!ciByKindCommand.has(key)) ciByKindCommand.set(key, r); // first occurrence wins (stable)
  }
  const dedupedCi = [...ciByKindCommand.values()].filter((r) => !localKinds.has(r.kind));

  const rungs = [...dedupedLocal, ...dedupedCi].sort((a, b) => a.cost_rank - b.cost_rank);
  const ratio = eligibleSteps === 0 ? 1.0 : recognisedSteps / eligibleSteps;
  const coverage = { eligible_steps: eligibleSteps, recognised_steps: recognisedSteps, ratio };
  let discovery;
  if (rungs.length === 0) discovery = "none";
  else if (ratio < PARTIAL_COVERAGE_THRESHOLD) discovery = "partial";
  else discovery = "confident";
  return { rungs, discovery, coverage };
}

// FAFF-533: pull the command text out of every `run:` step of a workflow file. A purpose-built
// line scan (NOT a full YAML parse) — the same posture as discoverMakefile (scan `target:` lines)
// and discoverPreCommit (scan `- id:` lines). Handles both the inline form (`run: cmd`) and the
// block-scalar form (`run: |` then an indented body). Returns one candidate command per line.
function extractRunCommands(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  const indentOf = (s) => (s.match(/^[ \t]*/) || [""])[0].length;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
    if (!m) { i += 1; continue; }
    const keyIndent = indentOf(line);
    const inline = m[2].trim();
    if (/^[|>][+-]?\s*$/.test(inline)) {
      // block scalar — collect the indented body until indentation returns to <= keyIndent.
      i += 1;
      while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > keyIndent)) {
        const body = lines[i].trim();
        if (body !== "") out.push(body);   // one candidate command per non-blank body line
        i += 1;
      }
      continue;                            // i already advanced past the block
    } else if (inline !== "") {
      out.push(inline.replace(/^["']|["']$/g, "")); // inline single-line command (strip surrounding quotes)
    }
    i += 1;
  }
  return out;
}

// FAFF-533: the 4th detector — recognised gate commands declared in `.github/workflows/*.yml`.
// Reads root/.github/workflows/*.{yml,yaml}; emits a rung per recognised `run:` command. A missing
// dir, an unreadable file, or zero recognised commands → [] (never throws). CI-sourced rungs carry
// cost_rank = GATE_COST[kind] + CI_COST_PENALTY, so a local source of the same kind wins dedup.
function discoverCiWorkflows(root) {
  const rungs = [];
  const dir = path.join(root, ".github", "workflows");
  let stat;
  try { stat = fs.statSync(dir); } catch { return rungs; }
  if (!stat.isDirectory()) return rungs;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return rungs; }
  const files = entries.filter((f) => /\.ya?ml$/i.test(f)).sort();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; } // skip unreadable
    for (const command of extractRunCommands(text)) {
      const kind = ciRunnerKind(command);
      if (!kind) continue;                 // unrecognised → not a gate, drop it
      rungs.push({ kind, name: `${kind.toLowerCase()} (ci-workflow: ${command})`, command, source: "ci_workflow", cost_rank: GATE_COST[kind] + CI_COST_PENALTY, required: true });
    }
  }
  return rungs;
}

// The deterministic discovery. Reuses the resolution ORDER faff-graft Step 8 documents
// (CLAUDE.md/test+lint via the repo's own declarations) — ONE resolver, no second divergent one.
function discoverRungs(root) {
  let rungs = [
    ...discoverPreCommit(root),
    ...discoverPkgScripts(root),
    ...discoverMakefile(root),
    ...discoverCiWorkflows(root),   // FAFF-533: CI-workflow source (fallback — local sources win dedup)
  ];
  // Deduplicate by kind, preferring the cheapest source (lowest cost_rank) for each kind.
  const byKind = new Map();
  for (const r of rungs.sort((a, b) => a.cost_rank - b.cost_rank)) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, r);
  }
  rungs = [...byKind.values()].sort((a, b) => a.cost_rank - b.cost_rank);
  // discovery classification: confident if any rung resolved; none if nothing; partial reserved for
  // the future ambiguous-config case (we resolve conservatively, so we never emit a fabricated rung).
  const discovery = rungs.length ? "confident" : "none";
  return { rungs, discovery };
}

// Execution target = the worktree sandbox (cwd) — the single FAFF-12 seam (Q1 interim default).
// Runs the rung's command and classifies pass/fail/errored. A 127 (command-not-found) is `errored`
// (tool missing) not `fail` — we can't conclude the code is bad.
// FAFF-984: the spawnSync `timeout` is resolved from gates.rung_timeout_ms (default 30 min, was a
// hardcoded 600s) so a slow-but-green whole-suite rung isn't killed prematurely. A timeout kill is
// detected BEFORE the general res.error/127 branch (mirrors classifySentryConsult in
// sentrycheck.js) and tagged with an internal `reason: "timed-out"` + a timeout-shaped `detail` —
// still `status: "errored"` at the faff-contract:quality-gates boundary (the enum stays closed),
// but now diagnosable as "could not conclude" rather than indistinguishable from a genuine crash.
function runRung(rung, root) {
  const { rung_timeout_ms } = readGatesConfig(root);
  const started = Date.now();
  let res;
  try {
    res = spawnSync(rung.command, { cwd: root, shell: true, encoding: "utf8", timeout: rung_timeout_ms });
  } catch (e) {
    return { kind: rung.kind, name: rung.name, command: rung.command, status: "errored", duration_ms: Date.now() - started, detail: String(e && e.message || e).slice(-500) };
  }
  const duration_ms = Date.now() - started;
  const tail = ((res.stderr || "") + (res.stdout || "")).slice(-500);
  // Node's timeout path: either res.error.code === "ETIMEDOUT", or a set res.signal with no
  // res.error (no runRung caller sets its own killSignal, so a bare signal is our own timeout kill
  // — same assumption sentrycheck.js documents for its own module). Must be checked BEFORE the
  // general res.error branch below, since ETIMEDOUT also sets res.error and would otherwise lose
  // its distinct reason.
  const timedOut = (res.error && res.error.code === "ETIMEDOUT") || (res.signal && !res.error);
  if (timedOut) {
    return {
      kind: rung.kind, name: rung.name, command: rung.command, status: "errored", reason: "timed-out",
      duration_ms, detail: `timed out after ${duration_ms}ms (limit ${rung_timeout_ms}ms); ${tail}`,
    };
  }
  let status;
  if (res.error || res.status === 127) status = "errored";       // tool missing / spawn error
  else if (res.status === 0) status = "pass";
  else status = "fail";
  return { kind: rung.kind, name: rung.name, command: rung.command, status, duration_ms, detail: tail };
}

// Resolve the fallback policy for `discovery: none` from config: fail-closed (default) | advisory.
function gatesFallbackPolicy(root) {
  try {
    const [data] = loadConfig(root);
    const v = dig(data, "gates.fallback");
    if (v === "advisory") return "advisory";
  } catch { /* default */ }
  return "fail-closed";
}

// ===========================================================================
// FAFF-849 (639b) — the EXECUTION path consumes the wider REPORTING recogniser (848's
// discoverRungsReporting set), but "recognised is not runnable": before running, execution
// subtracts what is unsafe/impossible to run locally (exclusion rules), collapses the regions
// selftest family into one aggregate rung, caps the per-kind blast radius, and applies a
// partial-coverage policy. See records/specs/2026-08-27-faff-849-…-design.md.
// ===========================================================================

// Read the gates.* config knobs via the loadConfig + dig idiom (mirrors gatesFallbackPolicy),
// each defaulting on absent/malformed. gates.exclude is a list read via dig (not a DEFAULTS scalar).
function readGatesConfig(root) {
  let data = {};
  try { [data] = loadConfig(root); } catch { data = {}; }
  const get = (k) => { try { return dig(data, k); } catch { return undefined; } };
  const fallback = get("gates.fallback") === "advisory" ? "advisory" : "fail-closed";
  const partial = get("gates.partial") === "needs-human" ? "needs-human" : "warn";
  // `dig` returns null for an absent key; Number(null) === 0 is an in-range value, so guard the
  // present-ness of the raw value BEFORE coercing — else an unset key coerces to a spurious 0.
  const num = (k) => { const v = get(k); return (v === null || v === undefined || v === "") ? NaN : Number(v); };
  let max_rungs_per_kind = 5;
  const mr = Math.floor(num("gates.max_rungs_per_kind"));
  if (Number.isFinite(mr) && mr >= 1) max_rungs_per_kind = mr;
  let partial_threshold = 0.5;
  const pt = num("gates.partial_threshold");
  if (Number.isFinite(pt) && pt >= 0 && pt <= 1) partial_threshold = pt;
  const rawExclude = get("gates.exclude");
  const exclude = Array.isArray(rawExclude) ? rawExclude.filter((x) => typeof x === "string") : [];
  // FAFF-984: per-rung spawnSync timeout, raised from a hardcoded 600s to a configurable 30-minute
  // default so a slow-but-green whole-suite UNIT rung isn't killed before it can finish.
  let rung_timeout_ms = 1_800_000;
  const rt = Math.floor(num("gates.rung_timeout_ms"));
  if (Number.isFinite(rt) && rt >= 1) rung_timeout_ms = rt;
  return { fallback, partial, exclude, max_rungs_per_kind, partial_threshold, rung_timeout_ms };
}

// The local host OS family (process.platform → the runs-on families we compare against).
function localOs() {
  const p = process.platform;
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";                     // linux + anything unmapped → the default GitHub runner family
}

// Map a workflow `runs-on:` label to an OS family, or null for an unrecognised/absent/matrix value
// (which fails TOWARD running — a missing/expression runs-on is usually the default Linux runner).
function osFamily(runsOn) {
  const s = String(runsOn || "").toLowerCase();
  if (/macos|osx|mac-/.test(s)) return "macos";
  if (/windows|win-/.test(s)) return "windows";
  if (/ubuntu|linux/.test(s)) return "linux";
  return null;
}

// Why a recognised/candidate step is excluded from local execution, or null if runnable.
// Precedence: configured > os-mismatch > github-context (any one excludes).
function exclusionReason(rec, cfg, localOsVal) {
  const cmd = String(rec.command);
  if (cfg.exclude.some((pat) => pat && cmd.includes(pat))) return "configured";
  if (rec.runs_on) {
    const fam = osFamily(rec.runs_on);
    if (fam !== null && fam !== localOsVal) return "os-mismatch";
  }
  if (/\$\{\{|\$GITHUB_|\$RUNNER_/.test(cmd)) return "github-context";
  return null;
}

// Runnable variant of discoverCiWorkflowsReporting: applies the exclusion filter at step
// granularity (a step is subtracted from eligible_steps only when EVERY one of its command
// records is excluded — matching 848's per-step counting), emits a rung per recognised, runnable
// command, and returns the runnable-coverage inputs + the exclusion log. Never throws (same
// missing-dir/unreadable-file posture as discoverCiWorkflowsReporting).
function discoverCiWorkflowsRunnable(root, cfg) {
  const rungs = [];
  const exclusions = [];
  let eligibleSteps = 0;
  const recognisedStepKeys = new Set();
  const localOsVal = localOs();
  const dir = path.join(root, ".github", "workflows");
  let stat;
  try { stat = fs.statSync(dir); } catch { return { rungs, exclusions, eligibleSteps, recognisedSteps: 0 }; }
  if (!stat.isDirectory()) return { rungs, exclusions, eligibleSteps, recognisedSteps: 0 };
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return { rungs, exclusions, eligibleSteps, recognisedSteps: 0 }; }
  const files = entries.filter((f) => /\.ya?ml$/i.test(f)).sort();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const records = extractRunCommandsWithContext(text);
    const byStep = new Map();
    for (const rec of records) {
      if (!byStep.has(rec.step_index)) byStep.set(rec.step_index, []);
      byStep.get(rec.step_index).push(rec);
    }
    for (const [idx, recs] of byStep) {
      const reasons = recs.map((r) => exclusionReason(r, cfg, localOsVal));
      const allExcluded = reasons.every((x) => x !== null);
      if (allExcluded) {                             // whole step subtracted from eligible + never a rung
        recs.forEach((r, i) => exclusions.push({ command: r.command, reason: reasons[i] }));
        continue;
      }
      eligibleSteps += 1;
      recs.forEach((rec, i) => {
        if (reasons[i]) { exclusions.push({ command: rec.command, reason: reasons[i] }); return; }
        const kind = reportKind(rec.command);
        if (!kind) return;
        recognisedStepKeys.add(`${f}:${idx}`);
        rungs.push({ kind, name: `${kind.toLowerCase()} (ci-workflow: ${rec.command})`, command: rec.command, source: "ci_workflow", cost_rank: GATE_COST[kind] + CI_COST_PENALTY, required: true });
      });
    }
  }
  return { rungs, exclusions, eligibleSteps, recognisedSteps: recognisedStepKeys.size };
}

// Collapse every recognised `regions selftest --region <x>` rung into ONE aggregate
// `regions selftest --region all` rung (the human decision of 2026-08-19). The aggregate inherits
// the cheapest source cost_rank so it sorts among the other STATIC_ANALYSIS rungs, and consumes a
// single slot against the per-kind cap. The invocation prefix is derived from a source command so
// the aggregate stays runnable (e.g. `node bin/faff regions selftest --region all`).
function aggregateSelftest(rungs) {
  const isSelftest = (c) => /regions\s+selftest\s+--region/i.test(String(c));
  const selftests = rungs.filter((r) => isSelftest(r.command));
  if (selftests.length === 0) return rungs;
  const keep = rungs.filter((r) => !isSelftest(r.command));
  const src = selftests[0].command;
  const at = src.toLowerCase().indexOf("regions");
  const prefix = at > 0 ? src.slice(0, at) : "";
  const command = `${prefix}regions selftest --region all`;
  const agg = {
    kind: "STATIC_ANALYSIS",
    name: "static_analysis (ci-workflow: regions selftest --region all)",
    command,
    source: "ci_workflow",
    cost_rank: Math.min(...selftests.map((r) => r.cost_rank)),
    required: true,
  };
  return [...keep, agg];
}

// Keep at most `cap` rungs of each kind, cheapest-first (rungs are cost-sorted first).
function capPerKind(rungs, cap) {
  const n = Number.isInteger(cap) && cap >= 1 ? cap : 5;
  const sorted = rungs.slice().sort((a, b) => a.cost_rank - b.cost_rank);
  const counts = new Map();
  const out = [];
  for (const r of sorted) {
    const c = counts.get(r.kind) || 0;
    if (c >= n) continue;
    counts.set(r.kind, c + 1);
    out.push(r);
  }
  return out;
}

// The EXECUTION resolver: the wide reporting set, filtered to runnable, aggregated, and capped.
// Local rungs (pre-commit/pkg/Makefile) are reused as-is and a local rung of a kind still
// suppresses ALL ci rungs of that kind (FAFF-533 preserved). Returns the bounded rung set +
// runnable coverage + discovery (confident/partial/none) + the exclusion log.
function selectRunnableRungs(root, cfg) {
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
  const localKinds = new Set(dedupedLocal.map((r) => r.kind));

  const { rungs: ciRunnable, exclusions, eligibleSteps, recognisedSteps } = discoverCiWorkflowsRunnable(root, cfg);
  const ciByKindCommand = new Map();
  for (const r of ciRunnable) {
    const key = `${r.kind} ${r.command}`;
    if (!ciByKindCommand.has(key)) ciByKindCommand.set(key, r);   // two-tier: keep distinct commands
  }
  const dedupedCi = [...ciByKindCommand.values()].filter((r) => !localKinds.has(r.kind)); // FAFF-533

  let rungs = [...dedupedLocal, ...dedupedCi];
  rungs = aggregateSelftest(rungs);
  rungs = capPerKind(rungs, cfg.max_rungs_per_kind);
  rungs = rungs.sort((a, b) => a.cost_rank - b.cost_rank);

  const ratio = eligibleSteps === 0 ? 1.0 : recognisedSteps / eligibleSteps;
  const coverage = { eligible_steps: eligibleSteps, recognised_steps: recognisedSteps, ratio };
  let discovery;
  if (rungs.length === 0) discovery = "none";
  else if (ratio < cfg.partial_threshold) discovery = "partial";
  else discovery = "confident";
  return { rungs, discovery, coverage, exclusions };
}

// The partial-coverage policy, factored out as a pure function so its "never lowers an existing
// fail/needs-human" contract is unit-testable without running any rung. When runnable coverage is
// below gates.partial_threshold on a `partial` discovery: gates.partial=needs-human RAISES a `pass`
// to `needs-human` (a fail/needs-human is left untouched); gates.partial=warn leaves the signal and
// flags a warning line. Any other case is a pass-through.
function applyPartialPolicy(signal, discovery, coverage, cfg) {
  if (discovery === "partial" && coverage && coverage.ratio < cfg.partial_threshold) {
    if (cfg.partial === "needs-human") {
      return { signal: signal === "pass" ? "needs-human" : signal, partialWarning: false };
    }
    return { signal, partialWarning: true };                       // warn: signal unchanged, emit a line
  }
  return { signal, partialWarning: false };
}

// Run the ladder: cheapest-first, fail-fast on the first failing REQUIRED rung. An errored rung at
// L3 → needs-human (can't conclude the code is bad). discovery:none → the fallback policy decides.
// FAFF-849 (639b): rungs now come from selectRunnableRungs (the filtered/bounded reporting set),
// and a runnable-coverage-below-threshold `partial` verdict consults gates.partial via
// applyPartialPolicy as a final, never-lowering signal adjustment.
function runLadder(root) {
  const cfg = readGatesConfig(root);
  const { rungs, discovery, coverage, exclusions } = selectRunnableRungs(root, cfg);
  const results = [];
  let needsHuman = false;
  for (const rung of rungs) {
    const r = runRung(rung, root);
    results.push(r);
    if (r.status === "errored") { needsHuman = true; continue; }   // surface, don't gate as fail
    if (rung.required && r.status === "fail") {
      return { signal: "fail", discovery, coverage, exclusions, rungs: results };  // fail-fast
    }
  }
  let signal = "pass";
  if (discovery === "none") {
    signal = cfg.fallback === "fail-closed" ? "needs-human" : "pass";
  } else if (needsHuman) {
    signal = "needs-human";
  }
  const { signal: finalSignal, partialWarning } = applyPartialPolicy(signal, discovery, coverage, cfg);
  return { signal: finalSignal, discovery, coverage, exclusions, rungs: results, partialWarning };
}

// Map a GatesOutcome → the quality-gates contract EXTRACTION shape (rungs reduced to {kind,status}).
function gatesContractExtraction(outcome) {
  return { signal: outcome.signal, rungs: outcome.rungs.map((r) => ({ kind: r.kind, status: r.status })) };
}

function cmdGates(args) {
  if (args.includes("--selftest")) return gatesSelftest();
  const { values, positionals, errors } = parseArgs(args, GATES_SPEC);
  if (errors.length) return usageError(errors, "usage: faff gates <discover|run> [--json] [--root DIR]");
  const action = positionals[0];
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  if (action === "discover") {
    // FAFF-848 (639a): `discover` renders the REPORTING resolver (discoverRungsReporting) — the
    // wider recognition (invariant lints) + two-tier dedup + Coverage/partial classification.
    // `faff gates run` below keeps calling runLadder → discoverRungs (the execution resolver,
    // untouched) — discover and run can now report different rung sets by design (see the spec's
    // recorded interim discover>run gap, closed by FAFF-849).
    const { rungs, discovery, coverage } = discoverRungsReporting(root);
    if (json) { console.log(JSON.stringify({ discovery, coverage, rungs }, null, 2)); return 0; }
    console.log(`gate ladder discovery: ${discovery} (${rungs.length} rung${rungs.length === 1 ? "" : "s"})`);
    for (const r of rungs) console.log(`  ${String(r.cost_rank).padStart(3)}  ${r.kind.padEnd(16)} ${r.command}   [${r.source}]`);
    console.log(`coverage: recognised ${coverage.recognised_steps} / eligible ${coverage.eligible_steps} steps (${coverage.ratio.toFixed(2)})`);
    return 0;
  }

  if (action === "run") {
    const outcome = runLadder(root);
    const extraction = gatesContractExtraction(outcome);
    // Emit the contract block in the SAME fenced-code-block form every faff producer uses
    // (```faff-contract:<name> … ```), so Step 7.5's "locate that block" matches the identical
    // pattern as review-verdict/spec-readiness/delivery-outcome — not a divergent XML envelope.
    const block = "```faff-contract:quality-gates\n" + JSON.stringify(extraction) + "\n```";
    if (json) {
      console.log(JSON.stringify({ ...outcome, contract: extraction }, null, 2));
    } else {
      console.log(`gate ladder: signal=${outcome.signal} discovery=${outcome.discovery}`);
      for (const r of outcome.rungs) console.log(`  ${r.status.padEnd(8)} ${r.kind.padEnd(16)} ${r.command}  (${r.duration_ms}ms)`);
      if (outcome.discovery === "none") console.log("  no declared engineering gates found; ran none");
      for (const ex of outcome.exclusions || []) console.log(`  excluded (${ex.reason}): ${ex.command}`);
      if (outcome.coverage) console.log(`  runnable coverage: recognised ${outcome.coverage.recognised_steps} / eligible ${outcome.coverage.eligible_steps} steps (${outcome.coverage.ratio.toFixed(2)})`);
      if (outcome.partialWarning) console.log(`  [warn] partial coverage: runnable coverage below gates.partial_threshold; ran the recognised subset (gates.partial: warn)`);
      console.log(block);
    }
    // exit 0 all-pass / 1 >=1 fail / 2 usage (mirrors the spec). needs-human exits 1 (non-green).
    return outcome.signal === "pass" ? 0 : 1;
  }

  process.stderr.write("faff gates: expected one of: discover | run (or --selftest)\n");
  return 2;
}

function gatesSelftest() {
  const cases = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-gates-"));
  const mk = (name, files) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), body);
    }
    return d;
  };

  // 1. package.json with lint + test → both discovered, LINT before UNIT by cost_rank.
  const dPkg = mk("pkg", { "package.json": JSON.stringify({ scripts: { lint: "true", test: "true", build: "true" } }) });
  const dis1 = discoverRungs(dPkg);
  cases.push(["pkg: discovers lint+test, not build", dis1.rungs.length === 2 && dis1.rungs[0].kind === "LINT" && dis1.rungs[1].kind === "UNIT"]);
  cases.push(["pkg: discovery confident", dis1.discovery === "confident"]);
  cases.push(["pkg: cost_rank ascending (LINT<UNIT)", dis1.rungs[0].cost_rank < dis1.rungs[1].cost_rank]);

  // 2. run ladder all-pass → signal pass, rungs both pass, ordered LINT before UNIT.
  const out2 = runLadder(dPkg);
  cases.push(["pkg run: signal pass", out2.signal === "pass"]);
  cases.push(["pkg run: LINT then UNIT", out2.rungs[0].kind === "LINT" && out2.rungs[1].kind === "UNIT"]);
  cases.push(["pkg run: both pass", out2.rungs.every((r) => r.status === "pass")]);

  // 3. lint fails (exit 1) → fail-fast: signal fail, stops BEFORE the test rung (only 1 result).
  const dFail = mk("fail", { "package.json": JSON.stringify({ scripts: { lint: "false", test: "true" } }) });
  const out3 = runLadder(dFail);
  cases.push(["fail-fast: signal fail", out3.signal === "fail"]);
  cases.push(["fail-fast: stopped before UNIT (1 result)", out3.rungs.length === 1 && out3.rungs[0].kind === "LINT" && out3.rungs[0].status === "fail"]);

  // 4. no declared checks → discovery none; fail-closed default → needs-human; explicit advisory → pass.
  const dNone = mk("none", { "README.md": "hi" });
  const out4 = runLadder(dNone);
  cases.push(["none: discovery none", out4.discovery === "none"]);
  cases.push(["none: fail-closed default → needs-human", out4.signal === "needs-human"]);
  const dAdvisory = mk("advisory", { "README.md": "hi", ".faffrc.yaml": "gates:\n  fallback: advisory\n" });
  const outAdvisory = runLadder(dAdvisory);
  cases.push(["none: explicit advisory opt-out → pass", outAdvisory.signal === "pass"]);
  const dClosed = mk("closed", { "README.md": "hi", ".faffrc.yaml": "gates:\n  fallback: fail-closed\n" });
  const out5 = runLadder(dClosed);
  cases.push(["none: explicit fail-closed config → needs-human", out5.signal === "needs-human"]);

  // 5. errored rung (command not found) → needs-human, not fail.
  const dErr = mk("err", { "package.json": JSON.stringify({ scripts: { lint: "this-command-does-not-exist-xyz" } }) });
  const out6 = runLadder(dErr);
  cases.push(["errored rung → needs-human not fail", out6.signal === "needs-human" && out6.rungs[0].status === "errored"]);

  // 5b. FAFF-984: a rung killed by the configured spawnSync timeout is classified with a distinct
  // reason:"timed-out" (not a bare crash) and a timeout-shaped detail — never confused with a
  // genuine tool-missing/spawn-error case (still status: "errored" at the contract boundary).
  // Drive runRung directly (not through npm's own script indirection) so the kill lands on the
  // exact process spawnSync is timing, per the spec's fixture shape.
  const dTimeout = mk("timeout", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 500\n" });
  const timeoutRung = runRung({ kind: "UNIT", name: "unit (sleep)", command: "sleep 5" }, dTimeout);
  cases.push(["timeout: rung status errored", timeoutRung.status === "errored"]);
  cases.push(["timeout: reason timed-out", timeoutRung.reason === "timed-out"]);
  cases.push(["timeout: detail names the timeout + limit", /timed out after \d+ms \(limit 500ms\)/.test(timeoutRung.detail)]);
  cases.push(["timeout: contract extraction stays within the closed enum", ["pass", "fail", "skipped", "errored"].includes(gatesContractExtraction({ signal: "needs-human", rungs: [timeoutRung] }).rungs[0].status)]);

  // Confirm the ladder itself still folds a timed-out rung to needs-human (an unfinished suite
  // never reads as green) — same fixture shape as case 5's errored-rung ladder check.
  const dTimeoutLadder = mk("timeout-ladder", {
    "package.json": JSON.stringify({ scripts: { lint: "sleep 5" } }),
    ".faffrc.yaml": "gates:\n  rung_timeout_ms: 500\n",
  });
  const outTimeoutLadder = runLadder(dTimeoutLadder);
  cases.push(["timeout: ladder signal needs-human (unfinished suite never reads as green)", outTimeoutLadder.signal === "needs-human" && outTimeoutLadder.rungs[0].reason === "timed-out"]);

  // 5c. Companion: a fast command under a generous configured timeout still passes (raising/
  // threading the timeout doesn't change ordinary pass behaviour), and carries no `reason`.
  const dTimeoutOk = mk("timeout-ok", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 60000\n" });
  const okRung = runRung({ kind: "UNIT", name: "unit (fast)", command: "true" }, dTimeoutOk);
  cases.push(["timeout: fast command under generous timeout still passes", okRung.status === "pass" && !okRung.reason]);

  // 5e. Unchanged: genuine command-not-found (127) still classifies errored with NO reason — the
  // timeout branch must never swallow a real spawn error.
  const notFoundRung = runRung({ kind: "LINT", name: "lint (missing)", command: "this-command-does-not-exist-xyz" }, dTimeoutOk);
  cases.push(["timeout: genuine command-not-found stays errored with no reason", notFoundRung.status === "errored" && !notFoundRung.reason]);

  // 5d. readGatesConfig: absent/empty/non-numeric/zero/negative rung_timeout_ms all fall back to
  // the 30-minute default; a positive override is honoured.
  cases.push(["config: absent rung_timeout_ms defaults to 1_800_000", readGatesConfig(mk("rt-absent", { "README.md": "hi" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: non-numeric rung_timeout_ms defaults", readGatesConfig(mk("rt-nan", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: not-a-number\n" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: zero rung_timeout_ms defaults", readGatesConfig(mk("rt-zero", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 0\n" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: negative rung_timeout_ms defaults", readGatesConfig(mk("rt-neg", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: -5\n" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: positive rung_timeout_ms honoured", readGatesConfig(mk("rt-ok", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 42000\n" })).rung_timeout_ms === 42000]);

  // 6. Makefile target discovery.
  const dMk = mk("mk", { "Makefile": "lint:\n\ttrue\nbuild:\n\ttrue\n" });
  const dis6 = discoverRungs(dMk);
  cases.push(["makefile: discovers lint target only", dis6.rungs.length === 1 && dis6.rungs[0].kind === "LINT" && dis6.rungs[0].source === "makefile"]);

  // 7. dedup: package.json lint preferred over makefile lint (cheaper source already; one LINT rung).
  const dDup = mk("dup", { "package.json": JSON.stringify({ scripts: { lint: "true" } }), "Makefile": "lint:\n\ttrue\n" });
  const dis7 = discoverRungs(dDup);
  cases.push(["dedup: one LINT rung when both pkg+makefile declare it", dis7.rungs.filter((r) => r.kind === "LINT").length === 1]);

  // 8. contract extraction shape pipes cleanly through the quality-gates contract.
  const ext = gatesContractExtraction(out2);
  const c = contractQualityGates(ext);
  cases.push(["contract: pass outcome conforms", !c.failLoud && c.contractData.conformant === true]);

  // 9. pre-commit: only recognised-kind hooks are swept in; an unknown heavy hook is dropped,
  //    never run as a required gate (the "slow target labelled cheap" failure mode).
  const dPc = mk("pc", { ".pre-commit-config.yaml": "repos:\n  - hooks:\n      - id: ruff\n      - id: my-heavy-integration-suite\n" });
  const dis9 = discoverRungs(dPc);
  cases.push(["pre-commit: recognised hook swept, unknown dropped", dis9.rungs.length === 1 && dis9.rungs[0].kind === "LINT" && dis9.rungs[0].source === "pre_commit"]);

  // 10. discover exit code via the cmd path (--root, --json arg handling — the observation gap).
  const exitDiscover = cmdGates(["discover", "--root", dPkg, "--json"]);
  cases.push(["cmd discover --root --json exit 0", exitDiscover === 0]);
  const exitBad = cmdGates(["bogus-action", "--root", dPkg]);
  cases.push(["cmd unknown-action exit 2 (usage)", exitBad === 2]);
  const exitRunPass = cmdGates(["run", "--root", dPkg, "--json"]);
  cases.push(["cmd run all-pass exit 0", exitRunPass === 0]);
  const exitRunFail = cmdGates(["run", "--root", dFail, "--json"]);
  cases.push(["cmd run with fail exit 1", exitRunFail === 1]);

  // 11. ciRunnerKind: recognised runners map to the right kind; unrecognised → null.
  cases.push(["ci: node --test → UNIT", ciRunnerKind("node --test") === "UNIT"]);
  cases.push(["ci: faff validate-adapters → LINT", ciRunnerKind("node plugin/skills/faff/bin/faff validate-adapters") === "LINT"]);
  cases.push(["ci: lint-refs → LINT", ciRunnerKind("node plugin/skills/faff/bin/faff lint-refs") === "LINT"]);
  cases.push(["ci: pytest → UNIT", ciRunnerKind("python -m pytest -q") === "UNIT"]);
  cases.push(["ci: tsc → TYPECHECK", ciRunnerKind("npx tsc --noEmit") === "TYPECHECK"]);
  cases.push(["ci: git checkout → null (no false positive)", ciRunnerKind("git checkout main") === null]);
  cases.push(["ci: bare shell noise → null", ciRunnerKind("echo done") === null && ciRunnerKind("make build") === null]);

  // 12. extractRunCommands: inline form.
  const exInline = extractRunCommands("    steps:\n      - name: t\n        run: node --test\n");
  cases.push(["extract: inline run command", exInline.length === 1 && exInline[0] === "node --test"]);

  // 13. extractRunCommands: block-scalar form, blank line inside the block does not terminate it.
  const exBlock = extractRunCommands("      - name: tests\n        run: |\n          echo setup\n\n          node --test\n      - name: next\n        run: echo done\n");
  cases.push(["extract: block-scalar yields body lines", exBlock.includes("node --test") && exBlock.includes("echo setup")]);
  cases.push(["extract: block does not swallow the next step", exBlock.includes("echo done")]);

  // 14. discoverCiWorkflows: a CI-only repo resolves confident with a UNIT rung (source ci_workflow).
  const dCi = mk("ci", { ".github/workflows/validate.yml": "jobs:\n  v:\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n      - name: tests\n        run: node --test\n" });
  const disCi = discoverRungs(dCi);
  cases.push(["ci: discovery confident", disCi.discovery === "confident"]);
  cases.push(["ci: UNIT rung node --test source ci_workflow", disCi.rungs.some((r) => r.kind === "UNIT" && r.source === "ci_workflow" && r.command === "node --test")]);
  cases.push(["ci: LINT rung from validate-adapters", disCi.rungs.some((r) => r.kind === "LINT" && r.source === "ci_workflow")]);
  cases.push(["ci: UNIT cost_rank = base + penalty", disCi.rungs.filter((r) => r.kind === "UNIT").every((r) => r.cost_rank === GATE_COST.UNIT + CI_COST_PENALTY)]);

  // 15. dedup: package.json UNIT (test) beats a CI node --test (local wins, lower cost_rank).
  const dCiDup = mk("cidup", { "package.json": JSON.stringify({ scripts: { test: "true" } }), ".github/workflows/ci.yml": "jobs:\n  v:\n    steps:\n      - run: node --test\n" });
  const disCiDup = discoverRungs(dCiDup);
  const unitRungs = disCiDup.rungs.filter((r) => r.kind === "UNIT");
  cases.push(["ci dedup: one UNIT rung", unitRungs.length === 1]);
  cases.push(["ci dedup: local pkg rung wins", unitRungs[0].source === "pkg_script"]);

  // 16. false-positive guard: a workflow of only uses:/name:/non-recognised run: → none, no rung.
  //     A recognised token inside a `name:` label (not a `run:` value) is NOT scanned.
  const dCiNone = mk("cinone", { ".github/workflows/noop.yml": "jobs:\n  v:\n    steps:\n      - uses: actions/checkout@v4\n      - name: Run pytest suite\n        run: echo done\n" });
  const disCiNone = discoverRungs(dCiNone);
  cases.push(["ci false-positive guard: discovery none", disCiNone.discovery === "none"]);
  cases.push(["ci false-positive guard: no rung emitted", disCiNone.rungs.length === 0]);

  // 17. missing .github/workflows dir → [] (the common local-only repo case).
  cases.push(["ci: missing workflows dir → []", discoverCiWorkflows(dPkg).length === 0]);

  // --- FAFF-848 (639a): the REPORTING path (discover only — runLadder/discoverRungs/ciRunnerKind
  // untouched, asserted explicitly in case 24 below). ---

  // 18. reportKind recognises the four invariant-lint patterns → STATIC_ANALYSIS; ciRunnerKind
  //     (the EXECUTION recogniser) stays null for all of them — proves the widened recognition
  //     never reaches the execution path.
  cases.push(["report: regions check → STATIC_ANALYSIS", reportKind("node bin/faff regions check") === "STATIC_ANALYSIS"]);
  cases.push(["report: regions selftest --region factory → STATIC_ANALYSIS", reportKind("node bin/faff regions selftest --region factory") === "STATIC_ANALYSIS"]);
  cases.push(["report: adr validate → STATIC_ANALYSIS", reportKind("node bin/faff adr validate") === "STATIC_ANALYSIS"]);
  cases.push(["report: prdr validate → STATIC_ANALYSIS", reportKind("node bin/faff prdr validate") === "STATIC_ANALYSIS"]);
  cases.push(["report: still rejects shell noise", reportKind("git checkout main") === null]);
  cases.push(["execution: ciRunnerKind never recognises regions check", ciRunnerKind("node bin/faff regions check") === null]);
  cases.push(["execution: ciRunnerKind never recognises adr validate", ciRunnerKind("node bin/faff adr validate") === null]);
  cases.push(["execution: ciRunnerKind never recognises prdr validate", ciRunnerKind("node bin/faff prdr validate") === null]);

  // A CI workflow carrying the three distinct faff LINT lints, all five invariant-lint STATIC_ANALYSIS
  // commands, one UNIT command, and ten unrecognised noise steps (19 candidate steps, 9 recognised —
  // ratio 9/19 ≈ 0.47, deliberately < 0.5 so the SAME fixture also exercises `partial`).
  const wideWorkflow = "jobs:\n  v:\n    steps:\n"
    + "      - name: adapters\n        run: node bin/faff validate-adapters\n"
    + "      - name: refs\n        run: node bin/faff lint-refs\n"
    + "      - name: clidoc\n        run: node bin/faff lint-cli-doc\n"
    + "      - name: regions\n        run: node bin/faff regions check\n"
    + "      - name: selftest-factory\n        run: node bin/faff regions selftest --region factory\n"
    + "      - name: selftest-governance\n        run: node bin/faff regions selftest --region governance\n"
    + "      - name: adr\n        run: node bin/faff adr validate\n"
    + "      - name: prdr\n        run: node bin/faff prdr validate\n"
    + "      - name: tests\n        run: node --test\n"
    + "      - name: noise1\n        run: echo noise-1\n"
    + "      - name: noise2\n        run: echo noise-2\n"
    + "      - name: noise3\n        run: echo noise-3\n"
    + "      - name: noise4\n        run: echo noise-4\n"
    + "      - name: noise5\n        run: echo noise-5\n"
    + "      - name: noise6\n        run: echo noise-6\n"
    + "      - name: noise7\n        run: echo noise-7\n"
    + "      - name: noise8\n        run: echo noise-8\n"
    + "      - name: noise9\n        run: echo noise-9\n"
    + "      - name: noise10 (block scalar — still ONE step)\n        run: |\n          echo multi-line\n          echo noise\n          echo block\n";
  const dWide = mk("wide", { ".github/workflows/wide.yml": wideWorkflow });
  const disWide = discoverRungsReporting(dWide);

  // 19. two-tier dedup — CI: the three distinct LINT commands stay distinct (not collapsed to
  //     one), and all five distinct STATIC_ANALYSIS invariant-lint commands are all reported.
  const wideLint = disWide.rungs.filter((r) => r.kind === "LINT");
  const wideStatic = disWide.rungs.filter((r) => r.kind === "STATIC_ANALYSIS");
  cases.push(["report dedup: 3 distinct LINT rungs (not collapsed)", wideLint.length === 3]);
  cases.push(["report dedup: LINT commands are validate-adapters/lint-refs/lint-cli-doc, each once",
    new Set(wideLint.map((r) => r.command)).size === 3]);
  cases.push(["report dedup: 5 distinct STATIC_ANALYSIS rungs (regions check + 2 selftest + adr + prdr)", wideStatic.length === 5]);
  cases.push(["report dedup: STATIC_ANALYSIS commands all distinct", new Set(wideStatic.map((r) => r.command)).size === 5]);
  cases.push(["report: regions selftest --region factory/governance both present as distinct commands",
    wideStatic.some((r) => r.command.includes("--region factory")) && wideStatic.some((r) => r.command.includes("--region governance"))]);

  // 20. partial classification — this fixture's coverage ratio is deliberately < 0.5.
  cases.push(["report: coverage eligible_steps counts all 19 run: steps", disWide.coverage.eligible_steps === 19]);
  cases.push(["report: coverage recognised_steps counts the 9 recognised steps", disWide.coverage.recognised_steps === 9]);
  cases.push(["report: discovery partial when ratio < 0.5", disWide.discovery === "partial" && disWide.coverage.ratio < 0.5]);

  // 21. discovery confident/none semantics unchanged in the reporting path (mirrors discoverRungs).
  const disNoneReporting = discoverRungsReporting(dNone);
  cases.push(["report: discovery none when nothing recognised (empty rungs)", disNoneReporting.discovery === "none" && disNoneReporting.rungs.length === 0]);
  const dFullCi = mk("fullci", { ".github/workflows/full.yml": "jobs:\n  v:\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n" });
  const disFullReporting = discoverRungsReporting(dFullCi);
  cases.push(["report: discovery confident when ratio == 1.0", disFullReporting.discovery === "confident" && disFullReporting.coverage.ratio === 1.0]);

  // 22. step-granularity coverage counting — a block scalar with N command lines is ONE
  //     candidate step, not N. (wide's noise10 block-scalar step holds 3 lines but contributed 1
  //     to eligible_steps, already asserted via the eligible_steps===19 total above; assert it
  //     directly here too via extractRunCommandsWithContext.)
  const stepCtxRecords = extractRunCommandsWithContext(wideWorkflow);
  const blockScalarIndices = stepCtxRecords.filter((r) => r.command.startsWith("echo") && ["multi-line", "noise", "block"].includes(r.command.replace(/^echo /, ""))).map((r) => r.step_index);
  cases.push(["report: block-scalar body lines share ONE step_index", new Set(blockScalarIndices).size === 1 && blockScalarIndices.length === 3]);
  cases.push(["report: step_index increments once per run: key (19 distinct indices)", new Set(stepCtxRecords.map((r) => r.step_index)).size === 19]);

  // 23. a STATIC_ANALYSIS reported rung sorts ahead of every UNIT reported rung (cost_rank:
  //     STATIC_ANALYSIS=40 < UNIT=50, unmodified — GATE_COST itself is untouched by 848).
  const staticIdx = disWide.rungs.findIndex((r) => r.kind === "STATIC_ANALYSIS");
  const lastUnitIdx = disWide.rungs.map((r) => r.kind).lastIndexOf("UNIT");
  cases.push(["report: STATIC_ANALYSIS sorts ahead of UNIT", staticIdx !== -1 && lastUnitIdx !== -1 && staticIdx < lastUnitIdx]);

  // 24. local rung of a kind still suppresses ALL ci rungs of that kind in the REPORTING path too
  //     (FAFF-533 preserved) — a local pkg lint script means the reporting resolver shows ZERO
  //     ci-sourced LINT rungs even though the CI workflow declares three.
  const dSuppress = mk("suppress", {
    "package.json": JSON.stringify({ scripts: { lint: "true" } }),
    ".github/workflows/wide.yml": wideWorkflow,
  });
  const disSuppress = discoverRungsReporting(dSuppress);
  const suppressLint = disSuppress.rungs.filter((r) => r.kind === "LINT");
  cases.push(["report: local lint suppresses all 3 ci LINT rungs", suppressLint.length === 1 && suppressLint[0].source === "pkg_script"]);
  cases.push(["report: ci STATIC_ANALYSIS/UNIT rungs still reported (local only covers LINT)",
    disSuppress.rungs.some((r) => r.kind === "STATIC_ANALYSIS") && disSuppress.rungs.some((r) => r.kind === "UNIT")]);

  // 25. discoverRungs is UNCHANGED by 639b (it stops feeding runLadder but stays for 848's own
  //     isolation self-tests, per the spec §2): it still sees NONE of the widened STATIC_ANALYSIS
  //     recognition and still collapses LINT by kind — today's narrow, ciRunnerKind-only resolver.
  const disWideExecution = discoverRungs(dWide);
  cases.push(["discoverRungs unchanged: sees no STATIC_ANALYSIS rung on the wide fixture",
    disWideExecution.rungs.every((r) => r.kind !== "STATIC_ANALYSIS")]);
  cases.push(["discoverRungs unchanged: still collapses LINT to exactly one rung",
    disWideExecution.rungs.filter((r) => r.kind === "LINT").length === 1]);

  // --- FAFF-849 (639b): the EXECUTION path now CONSUMES the wider reporting set through
  // selectRunnableRungs (filter → aggregate → cap). These re-express 848's execution-isolation
  // runLadder assertions to reflect the intended widening. ---
  const cfgDefault = readGatesConfig(dNone);        // dNone has no .faffrc → all gates.* defaults
  const selWide = selectRunnableRungs(dWide, cfgDefault);
  cases.push(["execution (639b): selectRunnableRungs surfaces the widened STATIC_ANALYSIS rungs",
    selWide.rungs.some((r) => r.kind === "STATIC_ANALYSIS")]);
  cases.push(["execution (639b): runnable discovery is partial on the wide fixture (ratio < 0.5)",
    selWide.discovery === "partial" && selWide.coverage.ratio < 0.5]);
  cases.push(["execution (639b): runnable coverage counts all 19 eligible + 9 recognised steps",
    selWide.coverage.eligible_steps === 19 && selWide.coverage.recognised_steps === 9]);
  cases.push(["execution (639b): runLadder now sources from selectRunnableRungs — discovery reflects runnable coverage",
    runLadder(dWide).discovery === "partial"]);

  // 26. selftest aggregation — the two per-region selftest commands collapse to ONE
  //     `regions selftest --region all` rung, consuming a single STATIC_ANALYSIS slot; the other
  //     STATIC_ANALYSIS rungs (regions check / adr validate / prdr validate) still stand.
  cases.push(["aggregate: regions selftest family collapses to one --region all rung",
    selWide.rungs.filter((r) => /regions\s+selftest/i.test(r.command)).length === 1 &&
    selWide.rungs.some((r) => /regions\s+selftest\s+--region\s+all/i.test(r.command))]);
  cases.push(["aggregate: 4 STATIC_ANALYSIS rungs after aggregation (check/adr/prdr/selftest-all)",
    selWide.rungs.filter((r) => r.kind === "STATIC_ANALYSIS").length === 4]);
  cases.push(["aggregate: derived command keeps a runnable invocation prefix",
    selWide.rungs.some((r) => /node .*regions\s+selftest\s+--region\s+all/i.test(r.command))]);
  const aggEmpty = aggregateSelftest([{ kind: "LINT", command: "node --test", cost_rank: 25 }]);
  cases.push(["aggregate: no-op when no selftest rung present", aggEmpty.length === 1 && aggEmpty[0].command === "node --test"]);

  // 27. exclusion reasons — precedence configured > os-mismatch > github-context; each excludes.
  const exCfg = { exclude: ["regions selftest"], partial: "warn", max_rungs_per_kind: 5, partial_threshold: 0.5, fallback: "fail-closed" };
  cases.push(["exclude: github-context ${{ }}", exclusionReason({ command: "node --test ${{ matrix.x }}" }, exCfg, "linux") === "github-context"]);
  cases.push(["exclude: github-context $GITHUB_", exclusionReason({ command: "echo $GITHUB_SHA" }, exCfg, "linux") === "github-context"]);
  cases.push(["exclude: os-mismatch macos on linux", exclusionReason({ command: "node --test", runs_on: "macos-latest" }, exCfg, "linux") === "os-mismatch"]);
  cases.push(["exclude: same-OS ubuntu on linux is runnable", exclusionReason({ command: "node --test", runs_on: "ubuntu-latest" }, exCfg, "linux") === null]);
  cases.push(["exclude: absent runs-on not excluded on OS grounds", exclusionReason({ command: "node --test" }, exCfg, "linux") === null]);
  cases.push(["exclude: matrix runs-on (unrecognised) not excluded", exclusionReason({ command: "node --test", runs_on: "${{ matrix.os }}" }, exCfg, "linux") === null]);
  cases.push(["exclude: configured substring match", exclusionReason({ command: "node bin/faff regions selftest --region factory" }, exCfg, "linux") === "configured"]);
  cases.push(["exclude: precedence configured beats os-mismatch", exclusionReason({ command: "regions selftest x", runs_on: "macos-latest" }, exCfg, "linux") === "configured"]);

  // 28. os-mismatch subtracts the whole step from eligible_steps AND emits no rung.
  const dMac = mk("macos", { ".github/workflows/mac.yml": "jobs:\n  impure-macos:\n    runs-on: macos-latest\n    steps:\n      - name: t\n        run: node --test\n  linux-job:\n    runs-on: ubuntu-latest\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n" });
  const selMac = selectRunnableRungs(dMac, cfgDefault);
  cases.push(["os-mismatch: macos step excluded, only the linux LINT rung runnable", selMac.rungs.filter((r) => r.kind === "UNIT").length === 0 && selMac.rungs.some((r) => r.kind === "LINT")]);
  cases.push(["os-mismatch: macos step subtracted from eligible_steps (1 eligible, not 2)", selMac.coverage.eligible_steps === 1]);
  cases.push(["os-mismatch: exclusion logged with reason", selMac.exclusions.some((e) => e.reason === "os-mismatch" && /node --test/.test(e.command))]);

  // 29. configured exclusion — a gates.exclude entry removes matching rungs; the rest still run.
  const dExc = mk("exc", {
    ".faffrc.yaml": "gates:\n  exclude:\n    - regions selftest\n",
    ".github/workflows/w.yml": "jobs:\n  v:\n    steps:\n      - name: check\n        run: node bin/faff regions check\n      - name: self\n        run: node bin/faff regions selftest --region factory\n",
  });
  const selExc = selectRunnableRungs(dExc, readGatesConfig(dExc));
  cases.push(["configured: no regions selftest rung when gates.exclude names it", !selExc.rungs.some((r) => /regions\s+selftest/i.test(r.command))]);
  cases.push(["configured: the non-excluded regions check rung still present", selExc.rungs.some((r) => /regions\s+check/i.test(r.command))]);
  cases.push(["configured: readGatesConfig parses gates.exclude list", readGatesConfig(dExc).exclude.includes("regions selftest")]);

  // 30. per-kind cap — cap 2 keeps the cheapest 2 STATIC_ANALYSIS rungs of the wide fixture.
  const cfgCap = { ...cfgDefault, max_rungs_per_kind: 2 };
  const selCap = selectRunnableRungs(dWide, cfgCap);
  cases.push(["cap: max_rungs_per_kind=2 keeps 2 STATIC_ANALYSIS rungs", selCap.rungs.filter((r) => r.kind === "STATIC_ANALYSIS").length === 2]);
  cases.push(["cap: capPerKind keeps the cheapest N by cost_rank",
    capPerKind([{ kind: "UNIT", cost_rank: 55 }, { kind: "UNIT", cost_rank: 50 }, { kind: "UNIT", cost_rank: 60 }], 2).map((r) => r.cost_rank).join(",") === "50,55"]);

  // 31. readGatesConfig malformed-value coercion → defaults.
  const dBad = mk("badcfg", { ".faffrc.yaml": "gates:\n  partial: banana\n  max_rungs_per_kind: -3\n  partial_threshold: 9\n  exclude: not-a-list\n" });
  const cfgBad = readGatesConfig(dBad);
  cases.push(["config coerce: invalid gates.partial → warn", cfgBad.partial === "warn"]);
  cases.push(["config coerce: non-positive max_rungs_per_kind → 5", cfgBad.max_rungs_per_kind === 5]);
  cases.push(["config coerce: out-of-range partial_threshold → 0.5", cfgBad.partial_threshold === 0.5]);
  cases.push(["config coerce: non-list gates.exclude → []", Array.isArray(cfgBad.exclude) && cfgBad.exclude.length === 0]);
  const dGood = mk("goodcfg", { ".faffrc.yaml": "gates:\n  partial: needs-human\n  max_rungs_per_kind: 3\n  partial_threshold: 0.7\n" });
  const cfgGood = readGatesConfig(dGood);
  cases.push(["config: valid gates.partial needs-human parsed", cfgGood.partial === "needs-human"]);
  cases.push(["config: valid max_rungs_per_kind parsed", cfgGood.max_rungs_per_kind === 3]);
  cases.push(["config: valid partial_threshold parsed", cfgGood.partial_threshold === 0.7]);

  // 32. applyPartialPolicy — the signal branch, unit-tested (never lowers fail/needs-human).
  const cov = { ratio: 0.32, eligible_steps: 19, recognised_steps: 6 };
  const cfgNH = { partial: "needs-human", partial_threshold: 0.5 };
  const cfgWarn = { partial: "warn", partial_threshold: 0.5 };
  cases.push(["signal: partial + needs-human + pass → needs-human", applyPartialPolicy("pass", "partial", cov, cfgNH).signal === "needs-human"]);
  cases.push(["signal: partial + warn + pass → pass + warning", applyPartialPolicy("pass", "partial", cov, cfgWarn).signal === "pass" && applyPartialPolicy("pass", "partial", cov, cfgWarn).partialWarning === true]);
  cases.push(["signal: never lowers a fail (needs-human config)", applyPartialPolicy("fail", "partial", cov, cfgNH).signal === "fail"]);
  cases.push(["signal: never lowers a needs-human (warn config)", applyPartialPolicy("needs-human", "partial", cov, cfgWarn).signal === "needs-human"]);
  cases.push(["signal: confident discovery is a pass-through", applyPartialPolicy("pass", "confident", { ratio: 1.0 }, cfgNH).signal === "pass" && applyPartialPolicy("pass", "confident", { ratio: 1.0 }, cfgNH).partialWarning === false]);
  cases.push(["signal: ratio at/above threshold is a pass-through", applyPartialPolicy("pass", "partial", { ratio: 0.6 }, cfgNH).signal === "pass"]);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

  let failed = 0;
  for (const [n, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) failed++; }
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

// FAFF-190: install-health check. The faff skills can be installed as real-dir COPIES (e.g. a
// marketplace install) rather than symlinks to the repo — in which case shipped repo changes don't
// go live until `link-skills.sh --global --replace`. This reads the FILESYSTEM (is <dir> a symlink?),
// so it reports correctly even when run from a stale installed bin/faff — it is not circular.
// FAFF-434: is the merge-fence PreToolUse hook registered under <root>/.claude/settings.json?
// Independent of the --target skills-dir scan (a different install-health axis entirely) —
// absent/malformed settings.json degrades to "missing", never a crash (a repo with no
// .claude/settings.json yet is the common pre-hooks-ensure state, not a doctor fault).
function mergeFencePresentAt(root) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8")); }
  catch { return false; }
  return preToolUseCommands(settings).some((c) => commandInvokesFaffHook(c, "merge-fence"));
}

// FAFF-443: classify a live global skill/CLI symlink by WHERE it resolves. A global install
// is machine-wide, so a link resolving into a linked worktree is "live but fragile" — it will
// dangle when that worktree is removed. The target sits in a LINKED worktree iff that checkout's
// own top-level differs from the repo's main checkout: `mainWorktreeRoot(dir)` is the parent of
// the shared git-common-dir (the MAIN checkout — the SAME value from the main checkout AND from
// any linked worktree, since they share the common dir), while `git rev-parse --show-toplevel`
// is THIS checkout's root — they diverge only inside a linked worktree. (`git -C` resolves from
// any path within a checkout, so the target's containing dir is a sufficient probe.) Returns
// "dangling" (target gone / realpath race), "intoWorktree" (fragile), or "live".
function classifyGlobalLink(full) {
  if (!fs.existsSync(full)) return "dangling";       // symlink target gone
  let real;
  try { real = fs.realpathSync(full); }
  catch { return "dangling"; }                        // TOCTOU: raced removal mid-classify
  const dir = path.dirname(real);
  const mainRoot = mainWorktreeRoot(dir);            // main checkout (common-dir parent), or null
  if (!mainRoot) return "live";                       // bare / non-repo / no git → not fragile
  const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0 || !(top.stdout || "").trim()) return "live";
  return path.resolve(mainRoot) !== path.resolve(top.stdout.trim()) ? "intoWorktree" : "live";
}

// FAFF-684: mirrors expand_target() in scripts/link-skills.sh (same rule, kept honest by
// the agreement test rather than shared code). A bare "~" expands to $HOME, a "~/…" entry
// drops the "~" and keeps $HOME + the rest, an absolute path passes through unchanged.
// Anything else (relative, empty, a literal "$HOME" YAML never shell-expands) is unusable —
// the caller skips it and returns null rather than joining it against a working directory.
function expandInstallTarget(entry, home) {
  if (entry === "~") return home;
  if (entry.startsWith("~/")) return path.join(home, entry.slice(2));
  if (path.isAbsolute(entry)) return entry;
  return null;
}

// FAFF-684: read `install.skill_targets` from config via the existing loadConfig + dig idiom
// (as gates.fallback does) — no new parser. Returns the expanded, still-unduped candidate
// list, or an empty array on anything short of a genuinely usable non-empty list (absent key,
// read error, wrong type, empty array, every entry unusable) — the caller falls back to the
// hardcoded default pair on empty, exactly as the bash installer does.
function readConfiguredInstallTargets(root, home) {
  try {
    const [data] = loadConfig(root);
    const raw = dig(data, "install.skill_targets");
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const expanded = expandInstallTarget(entry.trim(), home);
      if (expanded) out.push(expanded);
    }
    return out;
  } catch {
    return [];
  }
}

// FAFF-676: doctor's default scan set must match the installer's global target list
// (scripts/link-skills.sh), or doctor is lying about what it looked at. `--target` and
// `$CLAUDE_PLUGIN_ROOT` each still resolve to exactly one directory — unchanged in effect,
// only rewrapped to return a one-element list. Only the home-directory default branch grows,
// to the SAME two directories the installer writes to in global mode, in the SAME order.
// This is the ONLY place in gates.js naming .claude / .agents as skills directories — see
// the installer-and-doctor agreement test in test/link-skills-worktree.test.mjs, which is
// what keeps this list honest against scripts/link-skills.sh's TARGET_DIRS rather than a
// promise that the two never drift apart.
//
// FAFF-684: the home-directory default branch is now sourced from the install.skill_targets
// config key when it resolves to a non-empty, usable list; `root` is threaded in only for
// that read (cmdDoctor already resolves it via findRoot()). Unset/unusable falls back to
// exactly the hardcoded pair below — unchanged from FAFF-676.
//
// FAFF-675: every return now also carries `expectCopies` — true ONLY on the pluginRootEnv
// branch below. A marketplace-plugin install ships its skills as copied (real) directories
// under $CLAUDE_PLUGIN_ROOT by construction — that is the correct shape there and nowhere
// else (ADR-0097: the plugin root is authoritative for the invoking harness, an alternative
// to the global pair, never folded in alongside it — see that record for the full
// rationale and FAFF-685 as the named revisit trigger). `expectCopies` is what tells
// scanDoctorDirectory to read a copied entry as an expected install rather than a copy
// fault.
function assertScanSetExpectCopiesInvariant(result) {
  // FAFF-675: `expectCopies` is a SCAN-SET-WIDE boolean, sound only while its sole `true`
  // branch (pluginRootEnv, below) stays single-element — there is no per-directory record to
  // get wrong today. A future change that makes that branch multi-element (the FAFF-685
  // additive fold) MUST switch to per-directory {directory, expectCopies} records FIRST; this
  // assert is the tripwire that forces that ordering — it throws here, at the return site,
  // rather than letting a real copy fault on a non-plugin directory silently render as
  // "✓ … expected".
  if (result.expectCopies && result.scanSet.length !== 1) {
    throw new Error(
      `resolveDoctorScanSet invariant violated: expectCopies=true with a ${result.scanSet.length}-element ` +
      "scanSet — expectCopies is scan-set-wide and only sound while single-element; switch to " +
      "per-directory {directory, expectCopies} records before making this branch multi-element (FAFF-685).",
    );
  }
  return result;
}

function resolveDoctorScanSet(targetFlag, pluginRootEnv, home, root) {
  if (targetFlag) return assertScanSetExpectCopiesInvariant({ scanSet: [targetFlag], collapseNotices: [], expectCopies: false });
  // ADR-0097: the plugin root is authoritative for the invoking harness — an alternative
  // scan target, never additive with the global pair below. See that record before changing
  // this branch's shape.
  if (pluginRootEnv) return assertScanSetExpectCopiesInvariant({ scanSet: [path.join(pluginRootEnv, "skills")], collapseNotices: [], expectCopies: true });
  const configured = root ? readConfiguredInstallTargets(root, home) : [];
  const candidates = configured.length > 0
    ? configured
    : [path.join(home, ".claude", "skills"), path.join(home, ".agents", "skills")];
  return assertScanSetExpectCopiesInvariant({ ...dedupeByResolvedPath(candidates), expectCopies: false });
}

// Mirrors dedupe_by_resolved_path in scripts/link-skills.sh (same rule, kept honest by the
// agreement test rather than shared code — one's bash, one's Node). A path that does not
// exist can alias nothing, so it resolves to itself rather than throwing.
function dedupeByResolvedPath(candidates) {
  const kept = [];
  const seen = new Map(); // resolved path -> first literal path that produced it
  const collapseNotices = [];
  for (const p of candidates) {
    let resolved;
    try { resolved = fs.realpathSync(p); } catch { resolved = p; }
    if (seen.has(resolved)) {
      collapseNotices.push(`${p} resolves to ${seen.get(resolved)} — treating them as one target`);
      continue;
    }
    seen.set(resolved, p);
    kept.push(p);
  }
  return { scanSet: kept, collapseNotices };
}

const isFaffSkillName = (n) => n === "faff" || n.startsWith("faff-") || n.startsWith("faffter-") || n.startsWith("faffidavit-");

// Scans ONE directory and classifies every faff-owned entry — exactly today's per-skill
// logic (live / intoWorktree / dangling / copy), unchanged. Never throws: an unreadable or
// absent directory is recorded as such and returned, not an early exit — the caller decides
// what an all-unreadable scan set means (FAFF-676's whole point: a single bad directory must
// not go silent while another scanned directory is healthy).
//
// FAFF-675: `expectCopies` (true only for the plugin-root scan, see resolveDoctorScanSet)
// makes a copied, non-symlink entry read as an EXPECTED install rather than a copy FAULT —
// `expected` is a distinct counter from `copies`, so an expected copy never contributes to
// the exit-driving fault count. `targetOverridesPluginRoot` is narrower: true only when an
// explicit --target was given WHILE $CLAUDE_PLUGIN_ROOT is also set, so the operator
// auditing that target as dev-linked (the --target semantics, unchanged) gets a COPY line
// that names WHY it's being read as a fault despite a plugin root being present, rather than
// the plain classic wording — see the --target edge case in the FAFF-675 spec §4.
function scanDoctorDirectory(directory, expectCopies, targetOverridesPluginRoot) {
  let entries;
  try { entries = fs.readdirSync(directory).filter(isFaffSkillName).sort(); }
  catch (e) {
    const reason = e.code === "ENOENT" ? "not present" : `unreadable: ${e.message}`;
    return { directory, readable: false, reason, namesFound: new Set(), copies: 0, dangling: 0, intoWorktree: 0, expected: 0, findings: [] };
  }
  let copies = 0;
  let dangling = 0;
  let intoWorktree = 0;
  let expected = 0;
  const findings = [];
  const namesFound = new Set();
  for (const name of entries) {
    namesFound.add(name);
    const full = path.join(directory, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) {
      // A symlink is healthy only if its target resolves. lstat answers "is-a-symlink"
      // without following the link, so a dangling link (a rename-orphan, FAFF-296) reads
      // as healthy. existsSync follows the link — false ⇒ target gone ⇒ dangling. (FAFF-299)
      // FAFF-443: a live link may still be FRAGILE if it resolves into a linked worktree.
      const state = classifyGlobalLink(full);
      if (state === "live") {
        findings.push(`✓ ${name}  symlink (live → repo)`);
      } else if (state === "intoWorktree") {
        intoWorktree++;
        findings.push(`⚠ ${name}  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`);
      } else {
        dangling++;
        findings.push(`✗ ${name}  symlink-dangling (target gone — stale orphan)`);
      }
    } else if (expectCopies) {
      expected++;
      findings.push(`✓ ${name}  plugin install (copy under $CLAUDE_PLUGIN_ROOT — expected, not dev-linked)`);
    } else if (targetOverridesPluginRoot) {
      copies++;
      findings.push(`✗ ${name}  COPY — --target audits as a dev-linked install; omit --target to audit as a plugin install`);
    } else {
      copies++;
      findings.push(`✗ ${name}  COPY — not dev-linked; shipped changes won't go live`);
    }
  }
  return { directory, readable: true, reason: entries.length === 0 ? "no faff skills here" : null, namesFound, copies, dangling, intoWorktree, expected, findings };
}

// render_missing (spec HOW → "How much an empty directory prints"): a directory that found
// NOTHING is one fact, stated once — never one MISSING line per skill, which would turn the
// most-seen post-FAFF-672 report (a healthy ~/.claude/skills beside an absent
// ~/.agents/skills) into thirty near-identical lines burying the RESULT line. A directory
// missing only a SUBSET gets one line per missing skill, uncapped — that is the genuinely
// per-skill fact worth naming.
function renderDoctorScanBody(scan, unionSize) {
  if (scan.namesFound.size === 0) {
    return [`✗ ${scan.reason} — all ${unionSize} faff skill(s) found elsewhere are MISSING here`];
  }
  const lines = [...scan.findings];
  for (const name of scan.missingHere) lines.push(`✗ ${name}  MISSING here — this harness cannot see it`);
  return lines;
}

// FAFF-675: gathers EVERY install-health axis into one DoctorState, computing `exit` exactly
// ONCE — before either renderer runs. renderHuman/renderJson below differ only in how they
// PRESENT this same state; neither recomputes, short-circuits, or skips an axis. This is what
// makes human/--json exit parity a structural property (both return `state.exit` verbatim)
// rather than a discipline the two renderers would each have to remember to honour — see the
// "compute-once-then-branch" anti-pattern note in the FAFF-675 spec for the failure this
// closes (an early return inside one branch silently skipping an axis like the fence check).
function gatherDoctorState(scanSet, collapseNotices, expectCopies, root, targetOverridesPluginRoot) {
  // Explicit arrow, not a bare `.map(scanDoctorDirectory)` reference — Array.map passes
  // (element, index, array), so a bare reference would silently pass the scan-set INDEX as
  // `expectCopies` (0/falsy for the sole element of a single-directory scan set, defeating
  // the carve-out while looking like it worked).
  const scans = scanSet.map((d) => scanDoctorDirectory(d, expectCopies, targetOverridesPluginRoot));

  // FAFF-676: exit 2 ("nothing installed anywhere") is evaluated ACROSS every scanned
  // directory, never per-directory-early — a single bad directory must not go silent while
  // another scanned directory is healthy. FAFF-675: this no longer returns early to stderr;
  // it folds into `state.exit` like every other axis, so the --json renderer cannot skip it.
  const union = new Set();
  for (const s of scans) for (const n of s.namesFound) union.add(n);
  const emptyUnion = union.size === 0;

  for (const s of scans) {
    s.missingHere = emptyUnion ? [] : (s.namesFound.size === 0
      ? [...union].sort()
      : [...union].filter((n) => !s.namesFound.has(n)).sort());
  }

  let copies = 0;
  let dangling = 0;
  let intoWorktree = 0;
  let expected = 0;
  for (const s of scans) { copies += s.copies; dangling += s.dangling; intoWorktree += s.intoWorktree; expected += s.expected; }

  // FAFF-443: same fragility check for the CLI link as the per-skill symlinks above — a
  // worktree-sourced bin/faff dangles too. Machine-wide: runs exactly once per invocation,
  // independent of the scan set size, and independent of whether the union was empty (the
  // bin/faff and merge-fence axes are unrelated to what skills were found).
  let binFaff = "absent";
  const bin = path.join(homeDir(), ".local", "bin", "faff");
  try {
    const bst = fs.lstatSync(bin);
    if (bst.isSymbolicLink()) {
      if (classifyGlobalLink(bin) === "intoWorktree") { binFaff = "symlink-worktree"; intoWorktree++; }
      else binFaff = "symlink-live";
    } else {
      binFaff = "copy";
    }
  } catch { /* bin link optional — stays "absent" */ }

  // FAFF-434: the merge-fence PreToolUse registration — a distinct install-health axis from
  // the skill-link scan above (reads <root>/.claude/settings.json, not a scanned skills dir),
  // folded into the same non-clean exit. Machine-wide: runs exactly once per invocation.
  const fenceOk = mergeFencePresentAt(root);

  // The plugin root this run's scan short-circuited to, or null. expectCopies is
  // scan-set-wide and (by the return-site invariant on resolveDoctorScanSet) sound only
  // while its sole `true` branch is single-element, so `scanSet[0]` names it exactly.
  const pluginRoot = expectCopies ? scanSet[0] : null;

  const anyMissingHere = scans.some((s) => s.missingHere.length > 0);
  const exit = emptyUnion ? 2 : ((copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere || !fenceOk) ? 1 : 0);

  return {
    scanSet, scans, collapseNotices, unionSize: union.size, emptyUnion,
    copies, dangling, intoWorktree, expected,
    binFaff, fenceOk, pluginRoot, anyMissingHere, exit,
  };
}

function renderHuman(state) {
  if (state.emptyUnion) {
    process.stderr.write(`faff doctor: no faff skills found under any of: ${state.scanSet.join(", ")}\n`);
    return state.exit;
  }

  const multi = state.scans.length > 1;
  const out = [];
  out.push(multi
    ? `faff doctor — install health (${state.scans.length} directories scanned)`
    : `faff doctor — install health (${state.scans[0].directory})`);
  for (const notice of state.collapseNotices) out.push(`  ${notice}`);
  if (multi) {
    for (const s of state.scans) {
      out.push("");
      out.push(`  ${s.directory}`);
      for (const line of renderDoctorScanBody(s, state.unionSize)) out.push(`    ${line}`);
    }
    out.push("");
  } else {
    for (const line of renderDoctorScanBody(state.scans[0], state.unionSize)) out.push(`  ${line}`);
  }

  if (state.binFaff === "symlink-worktree") {
    out.push(`  ⚠ bin/faff  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`);
  } else if (state.binFaff === "symlink-live") {
    out.push(`  ✓ bin/faff  symlink (live)`);
  } else if (state.binFaff === "copy") {
    out.push(`  • bin/faff  real file (copy)`);
  }

  out.push(state.fenceOk
    ? `  ✓ merge-fence PreToolUse fence present`
    : `  ✗ merge-fence PreToolUse fence MISSING — run: faff hooks-ensure`);

  if (state.exit === 1) {
    const problems = [];
    if (state.copies > 0 || state.dangling > 0) problems.push(`${state.copies} copy / ${state.dangling} dangling skill link(s)`);
    if (state.intoWorktree > 0) problems.push(`${state.intoWorktree} worktree-sourced link(s) (fragile — will dangle on worktree removal)`);
    for (const s of state.scans) {
      if (s.missingHere.length > 0) problems.push(`${s.missingHere.length} skill(s) missing from ${s.directory}`);
    }
    if (!state.fenceOk) problems.push("merge-fence PreToolUse fence missing");
    out.push("");
    out.push(`RESULT: ${problems.join(" + ")} — install is not clean.`);
    const fixes = [];
    if (state.copies > 0 || state.dangling > 0 || state.intoWorktree > 0 || state.anyMissingHere) fixes.push("bash scripts/link-skills.sh --global --replace --prune  (from the main checkout)");
    if (!state.fenceOk) fixes.push("faff hooks-ensure");
    out.push(`Fix: ${fixes.join(" && ")}`);
    console.log(out.join("\n"));
    return state.exit;
  }

  out.push("");
  // FAFF-675: a clean plugin-root scan (expected > 0) is not a dev-linked repo — say so.
  out.push(state.expected > 0
    ? `RESULT: faff skills are a marketplace-plugin install (copies under $CLAUDE_PLUGIN_ROOT) — expected. Nothing to repair.`
    : `RESULT: all faff skills are dev-linked (symlinks) — repo is live.`);
  console.log(out.join("\n"));
  return state.exit;
}

// FAFF-675: pure state → DoctorJson object builder, no I/O — the total projection of
// DoctorState onto the --json wire shape. Kept separate from renderJson (which owns the
// stdout/stderr side effects) so tests can assert the object shape directly.
function buildDoctorJson(state) {
  if (state.emptyUnion) {
    return {
      scanned: state.scanSet.map((d) => ({
        directory: d, readable: false, reason: "not present", expected_install: d === state.pluginRoot,
        names_found: [], live: 0, copies: 0, dangling: 0, into_worktree: 0, expected: 0, missing_here: [], findings: [],
      })),
      plugin_root: state.pluginRoot, merge_fence: state.fenceOk, bin_faff: state.binFaff, exit: state.exit, ok: state.exit === 0,
    };
  }
  return {
    scanned: state.scans.map((s) => ({
      directory: s.directory,
      readable: s.readable,
      reason: s.reason,
      expected_install: s.directory === state.pluginRoot,
      names_found: [...s.namesFound].sort(),
      live: s.namesFound.size - s.copies - s.dangling - s.intoWorktree - s.expected,
      copies: s.copies,
      dangling: s.dangling,
      into_worktree: s.intoWorktree,
      expected: s.expected,
      missing_here: s.missingHere ?? [],
      findings: s.findings,
    })),
    plugin_root: state.pluginRoot, merge_fence: state.fenceOk, bin_faff: state.binFaff, exit: state.exit, ok: state.exit === 0,
  };
}

function renderJson(state) {
  if (state.emptyUnion) {
    // FAFF-675: the empty-union case still writes the human-readable breadcrumb to stderr
    // (unchanged from main, so a stderr-scraping consumer isn't silently starved by the
    // channel swap) IN ADDITION to the machine-readable object on stdout below.
    process.stderr.write(`faff doctor: no faff skills found under any of: ${state.scanSet.join(", ")}\n`);
  }
  console.log(JSON.stringify(buildDoctorJson(state), null, 2));
  return state.exit;
}

function cmdDoctor(args) {
  const { values, errors } = parseArgs(args, DOCTOR_SPEC);
  if (errors.length) return usageError(errors, "usage: faff doctor [--target DIR] [--root DIR] [--json]");
  const targetFlag = values["--target"] === undefined ? null : values["--target"];
  let root = values["--root"] === undefined ? null : values["--root"];
  root = root || findRoot();
  const asJson = !!values["--json"];

  const pluginRootEnv = process.env.CLAUDE_PLUGIN_ROOT;
  const { scanSet, collapseNotices, expectCopies } = resolveDoctorScanSet(targetFlag, pluginRootEnv, homeDir(), root);
  // FAFF-675: --target wins the short-circuit outright (expectCopies is false whenever a
  // target was given), but when a plugin root is ALSO set the operator is deliberately
  // auditing it as dev-linked — name that in the COPY line rather than the plain wording.
  const targetOverridesPluginRoot = !!(targetFlag && pluginRootEnv);

  const state = gatherDoctorState(scanSet, collapseNotices, expectCopies, root, targetOverridesPluginRoot);

  // Neither renderer computes an exit; both return state.exit verbatim — parity by
  // construction, not by discipline (see gatherDoctorState's header comment).
  return asJson ? renderJson(state) : renderHuman(state);
}

// FAFF-204: locate scripts/link-skills.sh by a layered resolver that survives the
// stale copy-install state sync exists to repair. An explicit --script wins outright
// (and, if unreadable, fails loud against exactly that path — never silently replaced
// by a default). Otherwise: (1) the cwd/repo anchor via findRoot — the only anchor that
// holds when the CLI is a real-file copy rather than a symlink into the repo; then
// (2) walk-up-from-self — the legacy anchor, which only resolves when the CLI is a
// symlink into the repo (linked-dev run from outside the tree). Returns the first
// readable candidate plus the ordered list of every candidate tried (de-duplicated),
// for the fail-loud message.
function resolveSyncScript(scriptOverride) {
  if (scriptOverride) {
    const readable = (() => { try { fs.accessSync(scriptOverride, fs.constants.R_OK); return true; } catch { return false; } })();
    return { path: readable ? scriptOverride : null, tried: [scriptOverride] };
  }
  const candidates = [];
  // Strategy 1 — cwd/repo anchor (survives copy-install): the reliable primary.
  candidates.push(path.join(findRoot(process.cwd()), "scripts", "link-skills.sh"));
  // Strategy 2 — walk up from the CLI's own resolved location. bin/faff lives at
  // <repo>/plugin/skills/faff/bin/faff → repo root is four dirs up from bin/. Only
  // resolves the repo when the CLI is a symlink into it (i.e. a linked-dev install).
  let self;
  try { self = fs.realpathSync(process.argv[1]); } catch { self = process.argv[1]; }
  const selfCandidate = path.join(path.resolve(path.dirname(self), "..", "..", "..", ".."), "scripts", "link-skills.sh");
  if (!candidates.includes(selfCandidate)) candidates.push(selfCandidate);

  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.R_OK); return { path: c, tried: candidates.slice(0, candidates.indexOf(c) + 1) }; }
    catch { /* not readable — try the next candidate */ }
  }
  return { path: null, tried: candidates };
}

// FAFF-200: skill-owned repair for a stale copy-install. A thin wrapper over the
// tested scripts/link-skills.sh --global --replace (re-links the skill dirs + the CLI
// onto PATH). The repair logic is NOT reimplemented in Node — single source of truth.
// Never auto-run in autonomous mode (it mutates ~/.claude outside any PR): the caller
// (the gateway doctor-at-entry check) only invokes it on an interactive human accept.
function cmdSync(args) {
  const { values, errors } = parseArgs(args, SYNC_SPEC);
  if (errors.length) return usageError(errors, "usage: faff sync [--dry-run] [--script PATH] [--json]");
  const dryRun = !!values["--dry-run"];
  const asJson = !!values["--json"];
  const scriptOverride = values["--script"] === undefined ? null : values["--script"];

  const { path: scriptPath, tried } = resolveSyncScript(scriptOverride);
  if (!scriptPath) {
    process.stderr.write(`faff sync: cannot find link-skills.sh (tried: ${tried.join(", ")})\n`);
    return 2;
  }

  const linkArgs = ["--global", "--replace", ...(dryRun ? ["--dry-run"] : [])];
  const r = spawnSync("bash", [scriptPath, ...linkArgs], { stdio: asJson ? "pipe" : "inherit", encoding: "utf8" });
  if (r.error) { process.stderr.write(`faff sync: failed to run ${scriptPath}: ${r.error.message}\n`); return 2; }

  const result = { script: scriptPath, ran: !dryRun, dry_run: dryRun, exit: r.status, ok: r.status === 0 };
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(r.status === 0
      ? `faff sync: re-linked faff skills to the repo${dryRun ? " (dry-run — nothing changed)" : ""}`
      : `faff sync: link-skills reported exit ${r.status} — see output above`);
  }
  // Pass the script's fail-loud (2) through; map any other non-zero to 1.
  return r.status === 0 ? 0 : (r.status === 2 ? 2 : 1);
}


module.exports = { CI_COST_PENALTY, GATES_SPEC, GATES_SURFACE, GATE_COST, PARTIAL_COVERAGE_THRESHOLD, aggregateSelftest, applyPartialPolicy, assertScanSetExpectCopiesInvariant, buildDoctorJson, capPerKind, ciRunnerKind, cmdDoctor, cmdGates, cmdSync, discoverCiWorkflows, discoverCiWorkflowsReporting, discoverCiWorkflowsRunnable, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRungs, discoverRungsReporting, exclusionReason, extractRunCommands, extractRunCommandsWithContext, gateKindForName, gatesContractExtraction, gatesFallbackPolicy, gatesSelftest, gatherDoctorState, localOs, mergeFencePresentAt, osFamily, readGatesConfig, reportKind, resolveDoctorScanSet, resolveSyncScript, runLadder, runRung, scanDoctorDirectory, selectRunnableRungs };
