// ===========================================================================
// === region:factory — gates-select — FAFF-849 (639b): select the runnable rungs from the reporting set and run the ladder (runLadder) ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { localOs, readGatesConfig } = require("./gates-config");
const { CI_COST_PENALTY, GATE_COST, ciRunnerKind, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRunnerFiles, mergeRunnerTier, normaliseLocalRungCommand } = require("./gates-discover");
const { extractRunCommandsWithContext, reportKind } = require("./gates-report");
const { aggregateUnits, listRungUnits, runRung, runUnit, rungCwd } = require("./gates-exec");
const { checkProgressDir, clearProgress, contentIds, ensureProgressIgnored, graceSecs, judgeProgress, knownSecrets, planFingerprint, progressPath, readProgress, treeFingerprint, writeProgress, PROGRESS_SCHEMA } = require("./gates-progress");

// ===========================================================================
// FAFF-849 (639b) — the EXECUTION path consumes the wider REPORTING recogniser (848's
// discoverRungsReporting set), but "recognised is not runnable": before running, execution
// subtracts what is unsafe/impossible to run locally (exclusion rules), collapses the regions
// selftest family into one aggregate rung, caps the per-kind blast radius, and applies a
// partial-coverage policy. See records/specs/2026-08-27-faff-849-…-design.md.
// ===========================================================================

// Map a workflow `runs-on:` label to an OS family, or null for an unrecognised/absent/matrix value
// (which fails TOWARD running — a missing/expression runs-on is usually the default Linux runner).
function osFamily(runsOn) {
  const s = String(runsOn || "").toLowerCase();
  if (/macos|osx|mac-/.test(s)) return "macos";
  if (/windows|win-/.test(s)) return "windows";
  if (/ubuntu|linux/.test(s)) return "linux";
  return null;
}

// FAFF-1149: a recognised portable UNIT test runner (the UNIT entries of CI_RUNNERS — node --test,
// pytest, jest, vitest, mocha, ava, tap, go test, cargo test). Its result is OS-independent by
// construction, so it survives an os-mismatch and runs on any dev host.
function isPortableRunner(command) {
  return ciRunnerKind(command) === "UNIT";
}

// FAFF-1149: a scraped `run:` body line that cannot be executed standalone in the worktree, so it
// must never become a rung (excluded "not-runnable", never fail/errored). Reached only AFTER the
// github-context check in exclusionReason, so cmd carries no ${{ }} / $GITHUB_ / $RUNNER_ token.
// Three cases:
//   (a) a comment-only line (trimmed starts with "#");
//   (b) a reference to a shell variable ($NAME or ${NAME}) whose NAME is not a live process.env key
//       (a workflow-local var like $f / ${test_timeout_ms}; an exported var like $HOME is runnable);
//   (c) a bare control-operator fragment: a lone shell keyword (fi/done/then/else/do/esac), an
//       assignment-only NAME=VALUE line, or a lone control operator (a trailing "&" with no command).
function isNotRunnable(command) {
  const cmd = String(command);
  const trimmed = cmd.trim();
  if (trimmed.startsWith("#")) return true;
  for (const m of cmd.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = m[1] || m[2];
    if (!Object.prototype.hasOwnProperty.call(process.env, name)) return true;
  }
  if (/^(fi|done|then|else|do|esac)$/.test(trimmed)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(trimmed)) return true;
  if (/^[&|;]+$/.test(trimmed)) return true;
  return false;
}

// Why a recognised/candidate step is excluded from local execution, or null if runnable.
// Precedence (FAFF-1149): configured > github-context > not-runnable > os-mismatch (any one
// excludes). github-context stays AHEAD of not-runnable so ${{ }} / $GITHUB_ / $RUNNER_ keep their
// existing reason and the existing selftests pass unchanged; a recognised portable UNIT runner
// survives os-mismatch so the genuine cross-platform suite runs on any dev host.
function isInsideRoot(relativeDir) {
  const resolved = path.posix.normalize(String(relativeDir));
  return !path.posix.isAbsolute(resolved) && resolved !== ".." && !resolved.startsWith("../");
}

function exclusionReason(rec, cfg, localOsVal) {
  const cmd = String(rec.command);
  if (cfg.exclude.some((pat) => pat && cmd.includes(pat))) return "configured";
  if (/\$\{\{|\$GITHUB_|\$RUNNER_/.test(`${cmd}\n${rec.working_directory || ""}`)) return "github-context";
  if (isNotRunnable(cmd)) return "not-runnable";
  if (rec.working_directory && !isInsideRoot(rec.working_directory)) return "not-runnable";
  if (rec.runs_on) {
    const fam = osFamily(rec.runs_on);
    if (fam !== null && fam !== localOsVal && !isPortableRunner(cmd)) return "os-mismatch";
  }
  return null;
}

// Runnable variant of discoverCiWorkflowsReporting: applies the exclusion filter at step
// granularity (a step is subtracted from eligible_steps only when EVERY one of its command
// records is excluded — matching 848's per-step counting), emits a rung per recognised, runnable
// command, and returns the runnable-coverage inputs + the exclusion log. Never throws (same
// missing-dir/unreadable-file posture as discoverCiWorkflowsReporting).
function discoverCiWorkflowsRunnable(root, cfg, hostOs = localOs()) {
  const rungs = [];
  const exclusions = [];
  let eligibleSteps = 0;
  const recognisedStepKeys = new Set();
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
      // FAFF-987: derive the LOCAL rung command before exclusion/kind resolution, so a sharded CI
      // node --test line runs the whole suite unsharded locally AND its `${{ matrix.shard }}` no
      // longer trips the github-context exclusion below. No-op for a command without --test-shard.
      for (const rec of recs) rec.command = normaliseLocalRungCommand(rec.command);
      const reasons = recs.map((r) => exclusionReason(r, cfg, hostOs));
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
        const rung = { kind, name: `${kind.toLowerCase()} (ci-workflow: ${rec.command})`, command: rec.command, source: "ci_workflow", cost_rank: GATE_COST[kind] + CI_COST_PENALTY, required: true };
        if (rec.working_directory) {
          rung.cwd = rec.working_directory;
          rung.name = `${kind.toLowerCase()} (ci-workflow: ${rec.command}; in ${rec.working_directory})`;
        }
        rungs.push(rung);
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
function selectRunnableRungs(root, cfg, hostOs = localOs()) {
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

  const { rungs: ciRunnable, exclusions, eligibleSteps, recognisedSteps } = discoverCiWorkflowsRunnable(root, cfg, hostOs);
  const ciByKindCommand = new Map();
  for (const r of ciRunnable) {
    const key = `${r.kind} ${r.cwd || "."} ${r.command}`;
    if (!ciByKindCommand.has(key)) ciByKindCommand.set(key, r);   // two-tier: keep distinct commands
  }
  const runner = discoverRunnerFiles(root, { hostOs, cap: cfg.max_rungs_per_kind, exclude: cfg.exclude });
  const merged = mergeRunnerTier(dedupedLocal, runner.rungs, [...ciByKindCommand.values()]); // FAFF-533
  exclusions.push(...runner.exclusions, ...merged.displaced);

  let rungs = aggregateSelftest(merged.rungs);
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
async function runLadder(root, opts) {
  if (opts) return runBudgetedLadder(root, opts);
  const cfg = readGatesConfig(root);
  const { rungs, discovery, coverage, exclusions } = selectRunnableRungs(root, cfg);
  const results = [];
  let needsHuman = false;
  for (const rung of rungs) {
    const r = await runRung(rung, root);
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

// FAFF-1405: the budgeted, resumable ladder behind `faff gates run --budget-secs N` / `--resume`.
// Same rungs, same order and the same rules as runLadder, but run unit by unit (a whole rung, a pool
// file, or a shard) against a wall-clock budget measured on the call clock, which starts when the
// call's first unit starts. No unit but the first starts after the budget. At expiry a call that has
// finished a unit cuts its in-flight units and discards them; a call that has finished none lets them
// run to the ceiling and records any still running there as errored "exceeds-call-budget", so every
// incomplete call records at least one new unit. Progress is rewritten after every recorded unit.
// Returns { incomplete: true, ... } or { outcome } (a GatesOutcome plus resumed and setup_ms).
async function runBudgetedLadder(root, opts) {
  const now = opts.now || Date.now;
  const callStart = now();
  const budgetSecs = opts.budgetSecs;
  const budgetMs = budgetSecs * 1000;
  const ceilingSecs = budgetSecs + graceSecs(budgetSecs);
  const ceilingMs = ceilingSecs * 1000;
  const cfg = readGatesConfig(root);
  const { rungs, discovery, coverage, exclusions } = selectRunnableRungs(root, cfg);
  const plans = rungs.map((rung) => ({ rung, ...listRungUnits(rung, root, cfg) }));
  for (const p of plans) {
    if (p.mode !== "pool") continue;
    const cwd = rungCwd(p.rung, root);
    const ids = contentIds(root, p.units.map((u) => path.join(cwd, u.file)));
    p.units.forEach((u, i) => { u.content = ids[i]; });
  }
  const tree = treeFingerprint(root);
  const plan = planFingerprint(plans, cfg);
  checkProgressDir(root, { create: true });
  ensureProgressIgnored(root);
  const { prior, discarded } = opts.resume ? judgeProgress(readProgress(root), tree, plan, callStart) : { prior: null, discarded: null };
  if (discarded) clearProgress(root);
  const secrets = knownSecrets(root);
  const calls = (prior ? prior.calls : 0) + 1;
  const rung_ms = {};
  if (prior) for (const [k, v] of Object.entries(prior.rung_ms)) if (Number.isFinite(v)) rung_ms[k] = v;

  const keyOf = (ri, u) => `${ri}|${u.id}`;
  const done = new Map();
  if (prior) {
    for (const rec of prior.done) {
      // A ceiling cut is reused only when it was cut at a ceiling at least as high as this call's,
      // so raising the budget retries the unit.
      if (rec.reason === "exceeds-call-budget" && !(rec.ceiling_secs >= ceilingSecs)) continue;
      done.set(`${rec.rung_index}|${rec.unit}`, rec);
    }
  }
  const unitsTotal = plans.reduce((n, p) => n + p.units.length, 0);
  const persist = () => writeProgress(root, {
    schema: PROGRESS_SCHEMA, tree, plan, written_at: new Date(now()).toISOString(), calls,
    done: [...done.values()].sort((a, b) => a.rung_index - b.rung_index), rung_ms,
  }, secrets);

  let clockStart = null;
  let newRecords = 0;
  let expired = false;
  let ceilingHit = false;
  const inflight = new Set();
  const timers = [];
  const cutAll = () => { for (const h of inflight) if (h.cut) h.cut(); };
  const armTimers = () => {
    timers.push(setTimeout(() => {
      expired = true;
      if (newRecords > 0) { cutAll(); return; }
      timers.push(setTimeout(() => { ceilingHit = true; cutAll(); }, Math.max(0, ceilingMs - budgetMs)));
    }, budgetMs));
  };
  const canStart = () => clockStart === null || (!expired && now() - clockStart < budgetMs);
  const runOne = async (ri, p, u) => {
    if (clockStart === null) { clockStart = now(); armTimers(); }
    const handle = {};
    inflight.add(handle);
    const r = await runUnit(p.rung, u, root, cfg.rung_timeout_ms, handle);
    inflight.delete(handle);
    let rec;
    if (r.cut) {
      if (!ceilingHit) return;                                        // a budget cut: discarded
      rec = { rung_index: ri, unit: u.id, status: "errored", reason: "exceeds-call-budget", ceiling_secs: ceilingSecs, duration_ms: r.duration_ms,
        detail: `${u.id} was still running at the ${ceilingSecs}s call ceiling; raise the budget or split the unit` };
    } else {
      rec = { rung_index: ri, unit: u.id, status: r.status, duration_ms: r.duration_ms, detail: r.detail || "" };
      if (r.reason) rec.reason = r.reason;
    }
    done.set(keyOf(ri, u), rec);
    newRecords += 1;
    persist();
  };
  const runList = async (ri, p, list, width) => {
    let next = 0;
    const worker = async () => {
      while (next < list.length && canStart()) await runOne(ri, p, list[next++]);
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(width, list.length)) }, () => worker()));
  };

  const results = [];
  let needsHuman = false;
  let failed = false;
  let incomplete = false;
  try {
    for (let ri = 0; ri < plans.length; ri++) {
      const p = plans[ri];
      const todo = p.units.filter((u) => !done.has(keyOf(ri, u)));
      if (todo.length) {
        const rungStart = now();
        if (p.mode === "pool") {
          await runList(ri, p, todo.filter((u) => !u.serial), cfg.file_pool_concurrency);
          if (p.units.filter((u) => !u.serial).every((u) => done.has(keyOf(ri, u)))) {
            await runList(ri, p, todo.filter((u) => u.serial), 1);
          }
        } else if (p.mode === "shard") {
          await runList(ri, p, todo, cfg.local_shard_concurrency);
        } else {
          await runList(ri, p, todo, 1);
        }
        rung_ms[ri] = (rung_ms[ri] || 0) + (now() - rungStart);
      }
      if (!p.units.every((u) => done.has(keyOf(ri, u)))) { incomplete = true; break; }
      const unitResults = p.units.map((u) => {
        const rec = done.get(keyOf(ri, u));
        const r = { kind: p.rung.kind, name: p.rung.name, command: p.rung.command, status: rec.status, duration_ms: rec.duration_ms, detail: rec.detail };
        if (rec.reason) r.reason = rec.reason;
        if (u.file) r.file = u.file;
        if (u.index) r.index = u.index;
        return r;
      });
      const agg = aggregateUnits(p.rung, p.mode, p.units, unitResults, rung_ms[ri] || 0);
      results.push(agg);
      if (agg.status === "errored") { needsHuman = true; continue; }
      if (p.rung.required && agg.status === "fail") { failed = true; break; }
    }
  } finally {
    for (const t of timers) clearTimeout(t);
  }
  const setup_ms = (clockStart === null ? now() : clockStart) - callStart;
  if (incomplete) {
    persist();                                                        // carries the final rung_ms
    return { incomplete: true, budget_secs: budgetSecs, units_done: done.size, units_total: unitsTotal, progress: progressPath(root), setup_ms, discarded };
  }
  clearProgress(root);
  let signal = "pass";
  if (failed) signal = "fail";
  else if (discovery === "none") signal = cfg.fallback === "fail-closed" ? "needs-human" : "pass";
  else if (needsHuman) signal = "needs-human";
  const resumed = { calls };
  if (discarded) resumed.discarded = discarded;
  if (failed) return { outcome: { signal, discovery, coverage, exclusions, rungs: results, resumed, setup_ms } };
  const { signal: finalSignal, partialWarning } = applyPartialPolicy(signal, discovery, coverage, cfg);
  return { outcome: { signal: finalSignal, discovery, coverage, exclusions, rungs: results, partialWarning, resumed, setup_ms } };
}

module.exports = { runBudgetedLadder, aggregateSelftest, applyPartialPolicy, capPerKind, discoverCiWorkflowsRunnable, exclusionReason, osFamily, runLadder, selectRunnableRungs };
