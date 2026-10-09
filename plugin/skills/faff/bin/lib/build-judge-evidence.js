// ===========================================================================
// === region:factory — build-judge-evidence — the build-review would-be-park judge's CLI layer ===
// Sibling of `spec-judge-evidence.js`'s `--assemble`/`--admit` CLI layer, ported to the
// build-review dialogue's would-be-park point (FAFF-996). Two modes on one subcommand:
//
//   --assemble --dir <build-review-dir> --issue <issue> --diff <diff-file> [...]
//     Reads the dialogue round records, derives the adjudication set (standing criticals plus
//     any rebuttal-driven withdrawal awaiting confirmation, p-05), calls
//     `assembleBuildCaseFiles` (the deterministic case-file assembler in
//     `build-judge-casefile.js`), writes `case-<case_id>.json` + `ledger.json` (mode 0600) —
//     THEN, for each non-parked case_id in ledger order, dispatches the two-phase judge via
//     `review-call.mjs` (Phase 1 blind reconstruction, Phase 2 rule), writing
//     `ruling-<case_id>.json` per finding, stamped with a `binding` (finding_id, pre_ruling_diff_sha,
//     case_sha, run_id) so --admit can tell which ledger entry the file was made for. Each call is
//     bounded by a wall-clock budget (--budget-secs > graft.build_judge_call_budget_secs > 540): it stops
//     before any attempt that would not fit (the first attempt of a call always runs), persists
//     `ledger.json` after every attempt (tmp + rename), and exits 3 (incomplete) so the caller
//     re-invokes it with the same arguments (FAFF-1246). A ledger whose adjudication identity matches
//     the fresh assembly is resumed (ruled and parked entries skipped, per-phase attempt counts kept in
//     `judge_progress`, Phase 1's validated output kept in a bound `recon-<case_id>.json`); on a mismatch
//     --assemble first clears earlier `ruling-*.json`, `recon-*.json` and `admit-result.json`
//     (best-effort; the bindings are the guard). Unlike the spec side (whose per-proposition dispatch
//     is driven by faff-prep's own SKILL.md loop), the build side's dispatch is embedded HERE —
//     a deliberate shape departure the FAFF-996 spec calls for, not a refactor of the spec side.
//
//   --admit --dir <build-review-dir> --level <level> --run-dir <run-dir>
//     Rolls the resolved ledger up via `admitBuildRollup`, computing the ONE build-side floor
//     (critical-free-latest, p-17) from the last dialogue round record here (never inside the
//     deterministic roll-up, which stays a pure fn over its floor INPUT). Prints the AdmitResult
//     and exits 0 (admit) / 1 (not admit) — mirroring spec-judge-evidence's --admit convention.
//     An on-disk ruling whose binding does not match its ledger entry is treated as missing (exit 2);
//     an inline `entry.ruling` is trusted as written by the same --assemble run (FAFF-1248).
//
// Degrade discipline mirrors spec-judge-evidence.js: an unreadable --dir is fail-SAFE (a
// park-direction bundle, exit 0 — the loop parks, the judge is never consulted on unassemblable
// evidence); a malformed round record is fail-LOUD (exit 2, plumbing breakage).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { readRoundRecord } = require("./spec-review-churn");
const { roundFilesInDir } = require("./spec-review-convergence");
const { standingCriticalIds } = require("./build-review-churn");
const { assembleBuildCaseFiles, admitBuildRollup, sha256Text } = require("./build-judge-casefile");
const { parseVerdictBlock, validateReconstruction, imperativeScrub } = require("./adversarial-judge-scrub");
const { findRoot, dig } = require("./shared-infra");
const { loadConfig } = require("./config");
const { assembleAdversarialBackends } = require("./adversarial-backends");

const FAFF_BIN = path.resolve(__dirname, "..", "faff");
const REVIEW_CALL_MJS = path.resolve(__dirname, "..", "..", "..", "faffter-dark-adversarial-review", "review-call.mjs");
const PHASE1_PROMPT = path.resolve(__dirname, "..", "..", "..", "faffter-dark-adversarial-review", "adjudicate-build-phase1-reconstruct.md");
const PHASE2_PROMPT = path.resolve(__dirname, "..", "..", "..", "faffter-dark-adversarial-review", "adjudicate-build-phase2-rule.md");

const BARE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function badBareId(v) {
  return typeof v !== "string" || !BARE_ID_RE.test(v) || v.includes("..");
}

// Run a bin/faff subcommand, returning { code, stdout, stderr } — the same recover-from-throw
// shape spec-judge-evidence.js's runFaff uses.
function runFaff(args) {
  try {
    const stdout = execFileSync("node", [FAFF_BIN, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout != null ? String(e.stdout) : "",
      stderr: e.stderr != null ? String(e.stderr) : "",
    };
  }
}

// Judge clock defaults and the spawn backstop (FAFF-1244). The deadline default matches code
// review's `adversarial.deadline -d 480`; the grace mirrors killable-spawn.mjs
// DEFAULT_GRACE_SECONDS and the exit mirrors review-call EXIT.DEADLINE / WRAPPER_EXIT.DEADLINE
// (both pinned by a parity test, since this CJS module cannot import the ESM sources).
const DEFAULT_BUILD_JUDGE_DEADLINE_SECS = 480;
const DEFAULT_BUILD_JUDGE_TIMEOUT_SECS = 120;
const BUILD_JUDGE_SPAWN_GRACE_SECS = 30;
const REVIEW_CALL_DEADLINE_EXIT = 8;

// Per-call wall-clock budget for --assemble (FAFF-1246): under graft's 600s foreground Bash cap with 60s
// headroom, and above the default attempt cost (480 + 30). Exit 3 means "incomplete, call me again"
// (the same meaning it has in `faff events anchor`); pinned to config.js DEFAULTS by a parity test.
const DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS = 540;
const ASSEMBLE_INCOMPLETE_EXIT = 3;

// positiveInt(v) -> integer > 0 | null: a YAML integer, or a string of ASCII digits, above zero.
// Floats, "abc", "", 0, negatives, booleans, null and objects are all "not valid at this tier".
function positiveInt(v) {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+$/.test(t) && parseInt(t, 10) > 0) return parseInt(t, 10);
  }
  return null;
}

// nonNegativeInt(v) -> integer >= 0 | null: positiveInt's shape, but zero is valid (0 retries is meaningful).
function nonNegativeInt(v) {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
  }
  return null;
}

// resolveBuildJudgeClock(cfg) -> { deadline, timeout } (whole seconds, both > 0). Each value walks
// adversarial.build_judge.* -> adversarial.* -> terminal default and takes the first valid tier; an
// invalid value at one tier falls through to the next. Pure: cfg null / non-object yields defaults.
function resolveBuildJudgeClock(cfg) {
  const get = (key) => dig(cfg, key);
  const deadline = positiveInt(get("adversarial.build_judge.deadline"))
    ?? positiveInt(get("adversarial.deadline"))
    ?? DEFAULT_BUILD_JUDGE_DEADLINE_SECS;
  const timeout = positiveInt(get("adversarial.build_judge.timeout"))
    ?? positiveInt(get("adversarial.timeout"))
    ?? DEFAULT_BUILD_JUDGE_TIMEOUT_SECS;
  return { deadline, timeout };
}

// realResolveBuildJudgeClock() -> { deadline, timeout }: the same config load as
// realResolveAdversarialBackends. Injectable via cmdAssemble's deps.resolveBuildJudgeClock.
function realResolveBuildJudgeClock() {
  const [cfg] = loadConfig(findRoot());
  return resolveBuildJudgeClock(cfg);
}

// resolveBuildJudgeRetryLimit(cfg) -> integer >= 0: graft.build_judge_retry_limit, else the default.
// Pure: an invalid value (or cfg null / non-object / graft not a map) falls through to the default.
function resolveBuildJudgeRetryLimit(cfg) {
  return nonNegativeInt(dig(cfg, "graft.build_judge_retry_limit")) ?? DEFAULT_BUILD_JUDGE_RETRY_LIMIT;
}

// realResolveBuildJudgeRetryLimit() -> integer >= 0: the same config load as realResolveBuildJudgeClock.
// Injectable via cmdAssemble's deps.resolveBuildJudgeRetryLimit.
function realResolveBuildJudgeRetryLimit() {
  const [cfg] = loadConfig(findRoot());
  return resolveBuildJudgeRetryLimit(cfg);
}

// resolveBuildJudgeCallBudget(cfg) -> integer > 0: graft.build_judge_call_budget_secs, else the default.
// Pure: an invalid value (or cfg null / non-object / graft not a map) falls through to the default.
function resolveBuildJudgeCallBudget(cfg) {
  return positiveInt(dig(cfg, "graft.build_judge_call_budget_secs")) ?? DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS;
}

// realResolveBuildJudgeCallBudget() -> integer > 0: the same config load as realResolveBuildJudgeClock.
// Injectable via cmdAssemble's deps.resolveBuildJudgeCallBudget.
function realResolveBuildJudgeCallBudget() {
  const [cfg] = loadConfig(findRoot());
  return resolveBuildJudgeCallBudget(cfg);
}

// reviewCallSpawnOptions(deadlineSecs?) -> execFileSync options. A valid deadline arms the spawn
// backstop strictly AFTER review-call's own --deadline (deadline + grace, FAFF-793 rule), so the
// healthy path never reaches it; otherwise today's options, unchanged.
function reviewCallSpawnOptions(deadlineSecs) {
  const secs = positiveInt(deadlineSecs);
  if (secs === null) return { encoding: "utf8" };
  return { encoding: "utf8", timeout: (secs + BUILD_JUDGE_SPAWN_GRACE_SECS) * 1000, killSignal: "SIGKILL" };
}

// reviewCallExitFromError(e) -> exit code. Only the backstop kill (code ETIMEDOUT) maps to the
// deadline exit; ENOBUFS, an external signal or a spawn failure keep the old exit 1 (park).
function reviewCallExitFromError(e) {
  if (e && e.code === "ETIMEDOUT") return REVIEW_CALL_DEADLINE_EXIT;
  if (e && typeof e.status === "number") return e.status;
  return 1;
}

// The REAL review-call.mjs transport — a thin execFileSync wrapper. Injectable (see
// dispatchJudgeRulings' `deps` parameter) so tests never spawn a real subprocess or hit a
// network backend. opts.deadlineSecs arms the spawn backstop; opts.exec is a test seam.
function realRunReviewCall(args, opts = {}) {
  const exec = opts.exec || execFileSync;
  try {
    const stdout = exec("node", [REVIEW_CALL_MJS, ...args], reviewCallSpawnOptions(opts.deadlineSecs));
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    if (e && e.code === "ETIMEDOUT") {
      process.stderr.write(`faff build-judge-evidence: review-call still alive at deadline(${opts.deadlineSecs}s)+grace(${BUILD_JUDGE_SPAWN_GRACE_SECS}s); killed, treated as exit 8 (FAFF-1244)\n`);
    }
    return {
      code: reviewCallExitFromError(e),
      stdout: e.stdout != null ? String(e.stdout) : "",
      stderr: e.stderr != null ? String(e.stderr) : "",
    };
  }
}

// realResolveAdversarialBackends() -> { chain } | { error: "unset"|"malformed", detail? } — resolves
// the adversarial backend chain for the `build_judge` consumer (per-consumer refs, shared refs,
// native backends, or legacy host/model — all handled inside assembleAdversarialBackends). Injectable
// via cmdAssemble's deps.resolveAdversarialBackends so the dispatch-loop tests stay hermetic.
function realResolveAdversarialBackends() {
  const root = findRoot();
  const [cfg] = loadConfig(root);
  return assembleAdversarialBackends(cfg, "build_judge");
}

// judgeDispatchDisposition lives in review-call.mjs (ESM) — dynamic `import()` is the only way
// to reach it from this CJS module (never reimplemented; the exit-taxonomy-to-disposition
// mapping is single-sourced there). Cached after first resolution.
let _judgeDispatchDispositionFn = null;
async function realJudgeDispatchDisposition(exit) {
  if (!_judgeDispatchDispositionFn) {
    const mod = await import(require("node:url").pathToFileURL(REVIEW_CALL_MJS).href);
    _judgeDispatchDispositionFn = mod.judgeDispatchDisposition;
  }
  return _judgeDispatchDispositionFn(exit);
}

// --- adjudication-set derivation (which findings need a judge pass) --------

// findLastKnownFinding(findingId, rounds) -> {location, title} | null — scans rounds NEWEST-
// first for a `findings[]` entry carrying this finding_id, so a withdrawn finding's identity
// fields (needed to build its case file) are recovered from its last known appearance.
function findLastKnownFinding(findingId, rounds) {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const findings = Array.isArray(rounds[i].findings) ? rounds[i].findings : [];
    const hit = findings.find((f) => f && f.finding_id === findingId);
    if (hit) return { location: hit.location || "", title: hit.title || "" };
  }
  return null;
}

// latestRebuttalFor(findingId, rounds) -> the most recent rebuttal_text authored for this
// finding_id (newest-round-first scan of author_replies), or undefined.
function latestRebuttalFor(findingId, rounds) {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const replies = Array.isArray(rounds[i].author_replies) ? rounds[i].author_replies : [];
    const hit = [...replies].reverse().find((r) => r && r.kind === "rebuttal" && r.finding_ref === findingId);
    if (hit) return hit.rebuttal_text;
  }
  return undefined;
}

// collectAdjudicationSet(rounds) -> [{finding_id, location, title, rebuttal_text, requires_confirm}]
//   adjudicate := standing_criticals ∪ rebuttal_withdrawn_criticals(last_round) — the PROCEDURE
//   build_judge input set (spec HOW section). `rounds` is ordered ascending, already read from
//   disk by the caller.
//
// The rebuttal-withdrawn half scans the WHOLE round history, not just the immediately-prior
// round: with multiple standing criticals, one can be rebutted-and-withdrawn in an early round
// while a SIBLING critical keeps the loop going for several more (fix-only) rounds before the
// standing set finally empties. p-05 is a per-finding invariant ("a finding that was cleared by
// a rebuttal-driven withdrawal is judge-confirmed before admit"), not a "only the round
// immediately before the stop mattered" one — narrowing the lookback to one round would let an
// earlier rebuttal-withdrawal on a different finding slip through unconfirmed once the *last*
// standing critical happens to resolve via a fresh-review fix (the judge-free p-15 path), which
// is exactly the false-admit gap the round-trip's judge confirmation exists to close.
function collectAdjudicationSet(rounds) {
  if (!rounds.length) return [];
  const latest = rounds[rounds.length - 1];
  const standingNow = new Set(
    (Array.isArray(latest.findings) ? latest.findings : [])
      .filter((f) => f && f.severity === "critical")
      .map((f) => f.finding_id),
  );
  const out = [...standingNow].map((id) => {
    const info = findLastKnownFinding(id, rounds) || { location: "", title: "" };
    return {
      finding_id: id, location: info.location, title: info.title,
      rebuttal_text: latestRebuttalFor(id, rounds), requires_confirm: false,
    };
  });

  // For each round i's rebuttal reply, that finding is a rebuttal-driven withdrawal (needs
  // confirming) iff it never appears as a standing critical in any round AFTER i (i.e. the
  // reviewer genuinely dropped it, rather than re-raising it after all). A finding standing
  // right now is already covered above via `standingNow`, never duplicated here.
  const withdrawnSeen = new Set();
  for (let i = 0; i < rounds.length - 1; i++) {
    const repliesI = Array.isArray(rounds[i].author_replies) ? rounds[i].author_replies : [];
    for (const r of repliesI) {
      if (!r || r.kind !== "rebuttal") continue;
      const id = r.finding_ref;
      if (!id || withdrawnSeen.has(id) || standingNow.has(id)) continue;
      const reappearedLater = rounds.slice(i + 1).some((round) =>
        (Array.isArray(round.findings) ? round.findings : []).some(
          (f) => f && f.finding_id === id && f.severity === "critical",
        ));
      if (reappearedLater) continue;
      withdrawnSeen.add(id);
      const info = findLastKnownFinding(id, rounds) || { location: "", title: "" };
      out.push({ finding_id: id, location: info.location, title: info.title, rebuttal_text: r.rebuttal_text, requires_confirm: true });
    }
  }
  return out;
}

// --- Phase 1/2 dispatch loop -------------------------------------------------

// Write a scratch file under a tmp dir and return its path (dispatch context files).
function writeTmp(tmpDir, name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

// runPhase(phase, entry, args, deps) -> { stopped } | { exhausted, cause } | { disposition, res }.
// One phase's bounded retry loop, resumable across --assemble calls: the per-phase attempt count lives
// on entry.judge_progress and is bumped and persisted BEFORE the attempt runs, so an attempt killed by
// anything still counts toward (retryLimit + 1). The budget gate is checked before each attempt, never
// after, so no attempt starts with less than its own cost left in the call.
async function runPhase(phase, entry, args, deps) {
  const { runReviewCall, judgeDispatchDisposition, retryLimit, budget, persistLedger, runOpts } = deps;
  const p = entry.judge_progress || { phase1_attempts: 0, phase2_attempts: 0, last_exit: null, reconstruction: null };
  const key = `phase${phase}_attempts`;
  for (;;) {
    const n = p[key];
    if (n >= retryLimit + 1) {
      if (p.last_exit != null) {
        return { exhausted: true, cause: `phase-${phase} dispatch disposition "${await judgeDispatchDisposition(p.last_exit)}" (exit ${p.last_exit})` };
      }
      return { exhausted: true, cause: `phase-${phase} attempts exhausted: attempt ${n} of ${retryLimit + 1} did not complete` };
    }
    if (!budget.allows()) return { stopped: true };
    p[key] = n + 1;
    p.last_exit = null;
    entry.judge_progress = p;
    persistLedger();
    budget.attemptsStarted += 1;
    const res = runReviewCall(args, runOpts);
    p.last_exit = res.code;
    persistLedger();
    const disp = await judgeDispatchDisposition(res.code);
    if (disp === "retry") continue;
    return { disposition: disp, res };
  }
}

const parkedOutcome = (cause) => ({ ruling: null, resolution: "parked", cause });

// dispatchOne(caseId, caseFile, tmpDir, entry, deps) -> { stopped: true } | { ruling: BuildJudgeVerdict|null,
//   resolution, cause } — runs Phase 1 (bounded retry on UNREACHABLE/DEADLINE) then, on a valid
// reconstruction, Phase 2 (same bounded retry), returning a park cause on any other disposition. Phase 1's
// validated output is persisted to a bound recon-<case_id>.json so a later call resumes at Phase 2.
// deps adds { ledger, judgeDir, persistLedger, budget } to the transport/clock/retry deps.
async function dispatchOne(caseId, caseFile, tmpDir, entry, deps) {
  const { clock, ledger, judgeDir } = deps;
  const clockArgs = ["--timeout", String(clock.timeout), "--deadline", String(clock.deadline)];
  const phaseDeps = { ...deps, runOpts: { deadlineSecs: clock.deadline } };
  const backendsArgs = deps.backendsJsonPath ? ["--backends-json", deps.backendsJsonPath] : [];
  const diffFile = writeTmp(tmpDir, `${caseId}-diff.txt`, caseFile.reconstruction_context.relevant_diff || "");
  const progress = () => entry.judge_progress || {};

  let reconStdout;
  if (!progress().reconstruction) {
    // Phase 1: blind reconstruction — --context is the reconstruction_context ONLY, never
    // argument_A/B.
    const reconContextFile = writeTmp(tmpDir, `${caseId}-recon-context.json`, JSON.stringify({
      acceptance_criteria: caseFile.reconstruction_context.acceptance_criteria,
      repository_evidence: caseFile.reconstruction_context.repository_evidence,
      proposition: caseFile.reconstruction_context.proposition,
    }, null, 2));
    const r1 = await runPhase(1, entry, [
      "--system", PHASE1_PROMPT, "--diff", diffFile, "--context", reconContextFile,
      "--expect", "contract",
      ...backendsArgs, ...clockArgs,
    ], phaseDeps);
    if (r1.stopped) return { stopped: true };
    if (r1.exhausted) return parkedOutcome(r1.cause);
    if (r1.disposition !== "ruling") return parkedOutcome(`phase-1 dispatch disposition "${r1.disposition}" (exit ${r1.res.code})`);
    const reconCheck = validateReconstruction(r1.res.stdout);
    if (!reconCheck.ok) return parkedOutcome(`reconstruction empty/failed: ${reconCheck.reason}`);
    const reconName = `recon-${caseId}.json`;
    writeFileMode600(path.join(judgeDir, reconName), JSON.stringify({ binding: bindingFor(ledger, caseId), stdout: r1.res.stdout }, null, 2) + "\n");
    progress().reconstruction = reconName;
    progress().last_exit = null;
    deps.persistLedger();
    reconStdout = r1.res.stdout;
  } else {
    // Resume at Phase 2 from the persisted reconstruction; never re-run Phase 1 (its attempts are already counted).
    let file = null;
    try { file = JSON.parse(fs.readFileSync(path.join(judgeDir, `recon-${caseId}.json`), "utf8")); } catch { /* parked below */ }
    if (!file || !bindingMatches(file.binding, ledger, caseId) || typeof file.stdout !== "string" || !validateReconstruction(file.stdout).ok) {
      return parkedOutcome("phase-1 reconstruction missing or unbound on resume");
    }
    reconStdout = file.stdout;
  }

  // Phase 2: rule — imperative-scrub the Phase-1 OUTPUT (closes the two-call laundering path),
  // then the scrubbed reconstruction + the already-scrubbed arguments A/B as --context.
  const scrubbedRecon = imperativeScrub(reconStdout);
  const phase2ContextFile = writeTmp(tmpDir, `${caseId}-phase2-context.json`, JSON.stringify({
    reconstruction: scrubbedRecon,
    argument_A: caseFile.arguments.argument_A,
    argument_B: caseFile.arguments.argument_B,
    proposition: caseFile.reconstruction_context.proposition,
  }, null, 2));
  const r2 = await runPhase(2, entry, [
    "--system", PHASE2_PROMPT, "--diff", diffFile, "--context", phase2ContextFile,
    "--expect", "contract",
    ...backendsArgs, ...clockArgs,
  ], phaseDeps);
  if (r2.stopped) return { stopped: true };
  if (r2.exhausted) return parkedOutcome(r2.cause);
  if (r2.disposition !== "ruling") return parkedOutcome(`phase-2 dispatch disposition "${r2.disposition}" (exit ${r2.res.code})`);
  const parsed = parseVerdictBlock(r2.res.stdout, "build-judge-verdict");
  if (!parsed.ok) return parkedOutcome(`phase-2 verdict block: ${parsed.cause}`);
  const outcome = parsed.json && parsed.json.outcome;
  return { ruling: parsed.json, resolution: outcome === "OVERTURN" ? "overturned" : "pending", cause: null };
}

// Write a file readable by the owner only (the ledger's mode); chmod covers a pre-existing wider file.
function writeFileMode600(file, content) {
  fs.writeFileSync(file, content, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best-effort */ }
}

// The binding ties a ruling file to the exact case it was made on. Case ids are positional, so the
// file name alone cannot say which finding a ruling belongs to across assemblies. A guardrail
// against accidental reuse, not a tamper boundary (every input lives in the same writable dir).
function bindingFor(ledger, cid) {
  const entry = ledger.entries[cid];
  return {
    finding_id: entry.finding_id,
    pre_ruling_diff_sha: entry.pre_ruling_diff_sha,
    case_sha: entry.case_sha,
    run_id: ledger.run_id,
  };
}

function bindingMatches(binding, ledger, cid) {
  const entry = ledger.entries[cid];
  if (!entry || binding === null || typeof binding !== "object" || Array.isArray(binding)) return false;
  for (const k of ["finding_id", "pre_ruling_diff_sha", "case_sha"]) {
    if (typeof binding[k] !== "string" || typeof entry[k] !== "string" || binding[k] !== entry[k]) return false;
  }
  return typeof binding.run_id === "string" && typeof ledger.run_id === "string" && binding.run_id === ledger.run_id;
}

// Best-effort: clear the rulings, Phase-1 reconstructions and admit result of an earlier judge pass. A
// failed unlink only warns; the bindings (checked at --admit and on resume) are what guarantee safety.
function sweepStaleRulings(outDir) {
  let names;
  try { names = fs.readdirSync(outDir); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: warning: could not list ${outDir} to clear stale rulings: ${e.message}\n`); return; }
  for (const name of names) {
    if (!/^(ruling|recon)-.+\.json$/.test(name) && name !== "admit-result.json") continue;
    try { fs.unlinkSync(path.join(outDir, name)); }
    catch (e) {
      if (e && e.code === "ENOENT") continue;
      process.stderr.write(`faff build-judge-evidence --assemble: warning: could not remove stale ${name}: ${e.message}\n`);
    }
  }
}

// adjudicationIdentity(ledger) -> String: the tuple that decides whether an on-disk ledger describes the
// same judge pass as a fresh assembly. It covers the same fields a ruling binding covers (finding_id, diff
// sha, case_sha, run_id) plus the order and window, so a resumed ledger's rulings are bound to entries
// with the same identity. A ledger missing any of it (or written before case_sha) never matches.
function adjudicationIdentity(ledger) {
  const entries = (ledger && ledger.entries) || {};
  return JSON.stringify({
    run_id: ledger.run_id,
    window_start: ledger.window_start,
    cases: ledger.order.map((cid) => {
      const e = entries[cid] || {};
      return [cid, e.finding_id, e.pre_ruling_diff_sha, e.case_sha];
    }),
  });
}

// dispatchJudgeRulings(ledger, caseFiles, judgeDir, { runReviewCall, judgeDispatchDisposition,
//   retryLimit, backendsChain, clock: { deadline, timeout }, budget, persistLedger }) -> { stopped }.
//   Mutates ledger.entries[*].{ruling,resolution,park_cause,judge_progress} in place, persisting the ledger
//   after every attempt and outcome, then writes ruling-<case_id>.json (after the ledger holding the same
//   ruling inline). Ruled and parked entries are skipped, so a resumed ledger only judges what is left;
//   stopped is true when the call budget ran out before every entry was decided. Every dependency is
//   injectable so a test never spawns review-call.mjs.
async function dispatchJudgeRulings(ledger, caseFiles, judgeDir, deps) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-build-judge-dispatch-"));
  const persistLedger = deps.persistLedger || (() => {});
  const budget = deps.budget || { attemptsStarted: 0, allows: () => true };
  try {
    // One file for the whole run — the chain is identical across every case and phase.
    const backendsJsonPath = deps.backendsChain
      ? writeTmp(tmpDir, "backends.json", JSON.stringify(deps.backendsChain))
      : null;
    for (const cid of ledger.order) {
      const entry = ledger.entries[cid];
      if (!entry || entry.resolution === "parked") continue; // parked at assemble or by an earlier call
      if (entry.resolution === "overturned" || entry.ruling != null) continue; // already ruled
      const result = await dispatchOne(cid, caseFiles[cid], tmpDir, entry, { ...deps, ledger, judgeDir, persistLedger, budget, backendsJsonPath });
      if (result.stopped) return { stopped: true }; // the entry's progress is already persisted
      // A `binding` key the model put in its verdict is dropped from the inline copy too, so the
      // ledger and the ruling file carry the same verdict fields (only the file is stamped).
      let verdict = result.ruling;
      if (verdict && typeof verdict === "object") { const { binding: _modelBinding, ...rest } = verdict; verdict = rest; }
      entry.ruling = verdict;
      entry.resolution = result.resolution;
      if (result.cause) entry.park_cause = result.cause;
      persistLedger(); // ledger first: --admit reads the inline ruling before any file
      if (verdict) {
        fs.writeFileSync(path.join(judgeDir, `ruling-${cid}.json`), JSON.stringify({ ...verdict, binding: bindingFor(ledger, cid) }, null, 2) + "\n");
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { stopped: false };
}

// --- critical-free-latest floor (p-17) — computed HERE (CLI layer), never inside the pure
// admitBuildRollup. Reads the last dialogue round record's standing criticals and checks every
// one resolved to an OVERTURN ruling. Missing/unreadable --dir or no rounds -> null (degraded ->
// admitBuildRollup fails it CLOSED). `rulings` (the SAME case_id -> BuildJudgeVerdict|null map
// --admit already loaded) is the source of truth for "overturned" — never a possibly-stale
// `ledger.entries[cid].resolution` field, so the floor can never disagree with admitBuildRollup's
// own resolved/unresolved split over the identical ruling data.
function computeCriticalFreeLatestFloor(dir, ledger, rulings) {
  let files;
  try { files = roundFilesInDir(dir); } catch { return null; }
  if (!files.length) return null;
  const latestFile = files[files.length - 1];
  const read = readRoundRecord(latestFile.path);
  if (read.malformed || read.missing) return null;
  const standingIds = standingCriticalIds(read.record && read.record.findings);
  if (standingIds.length === 0) return true;
  const entries = (ledger && ledger.entries) || {};
  const overturnedIds = new Set();
  for (const [cid, entry] of Object.entries(entries)) {
    if (!entry) continue;
    const ruling = (rulings || {})[cid];
    if (ruling && ruling.outcome === "OVERTURN") overturnedIds.add(entry.finding_id);
  }
  return standingIds.every((id) => overturnedIds.has(id));
}

// ===========================================================================
// CLI
// ===========================================================================

const BUILD_JUDGE_EVIDENCE_SPEC = {
  flags: {
    "--dir": { arity: 1 },
    "--issue": { arity: 1 },
    "--diff": { arity: 1 },
    "--out": { arity: 1 },
    "--run-id": { arity: 1 },
    "--run-dir": { arity: 1 },
    "--window-start": { arity: 1 },
    "--level": { arity: 1 },
    "--assemble": { arity: 0 },
    "--admit": { arity: 0 },
    "--repository-evidence": { arity: 1 },
    "--acceptance-criteria": { arity: 1 },
    "--retry-limit": { arity: 1 },
    "--budget-secs": { arity: 1 },
  },
};
const BUILD_JUDGE_EVIDENCE_USAGE =
  "usage: faff build-judge-evidence --assemble --dir <build-review-dir> --issue <issue> --diff <diff-file> " +
  "[--out <judge-dir>] [--acceptance-criteria <file>] [--repository-evidence <file>] [--window-start N] [--run-id ID] [--retry-limit N] [--budget-secs N]\n" +
  "     (exit 0 complete, 2 usage/plumbing failure, 3 incomplete: the call budget was reached, call again with the same arguments;\n" +
  "      a ledger whose adjudication identity matches is resumed, earlier ruling/recon/admit-result files are swept only on a mismatch)\n" +
  "   or: faff build-judge-evidence --admit --dir <build-review-dir> --level <level> --run-dir <run-dir> [--out <judge-dir>]";

// Pinned to config.js DEFAULTS["graft.build_judge_retry_limit"] by a parity test (FAFF-1245).
const DEFAULT_BUILD_JUDGE_RETRY_LIMIT = 2;

function cmdBuildJudgeEvidence(args) {
  const { values, errors } = parseArgs(args, BUILD_JUDGE_EVIDENCE_SPEC);
  if (errors.length) return usageError(errors, BUILD_JUDGE_EVIDENCE_USAGE);
  const modeCount = ["--assemble", "--admit"].filter((f) => values[f]).length;
  if (modeCount !== 1) {
    return usageError([{ code: "invalid-value", detail: "exactly one of --assemble or --admit is required" }], BUILD_JUDGE_EVIDENCE_USAGE);
  }
  if (values["--assemble"]) return cmdAssemble(values);
  return cmdAdmit(values);
}

function cmdAssemble(values, deps = {}) {
  const dir = values["--dir"];
  const issue = values["--issue"];
  const diffPath = values["--diff"];
  if (dir == null) return usageError([{ code: "missing-value", detail: "--assemble requires --dir" }], BUILD_JUDGE_EVIDENCE_USAGE);
  if (issue == null) return usageError([{ code: "missing-value", detail: "--assemble requires --issue" }], BUILD_JUDGE_EVIDENCE_USAGE);
  if (diffPath == null) return usageError([{ code: "missing-value", detail: "--assemble requires --diff" }], BUILD_JUDGE_EVIDENCE_USAGE);
  if (badBareId(issue)) return usageError([{ code: "invalid-value", detail: `--issue "${issue}" is not a bare id` }], BUILD_JUDGE_EVIDENCE_USAGE);

  const rawWindow = values["--window-start"];
  const windowStart = rawWindow == null ? 1 : parseInt(rawWindow, 10);
  if (rawWindow != null && (!/^\d+$/.test(String(rawWindow)) || windowStart < 1)) {
    return usageError([{ code: "invalid-value", detail: "--window-start expects an integer >= 1" }], BUILD_JUDGE_EVIDENCE_USAGE);
  }

  // Validate --retry-limit up front so a bad flag is a usage error on every path, early returns included.
  const rawRetryLimit = values["--retry-limit"];
  let flagRetryLimit = null;
  if (rawRetryLimit != null) {
    flagRetryLimit = nonNegativeInt(rawRetryLimit);
    if (flagRetryLimit === null) {
      return usageError([{ code: "invalid-value", detail: "--retry-limit expects an integer >= 0" }], BUILD_JUDGE_EVIDENCE_USAGE);
    }
  }

  // Same for --budget-secs: an explicit flag that is not an integer > 0 is a usage error (a config typo falls through to the default).
  const rawBudget = values["--budget-secs"];
  const flagBudget = rawBudget == null ? null : positiveInt(rawBudget);
  if (rawBudget != null && flagBudget === null) {
    return usageError([{ code: "invalid-value", detail: "--budget-secs expects an integer > 0" }], BUILD_JUDGE_EVIDENCE_USAGE);
  }
  const now = deps.now || Date.now;
  const startedAt = now();

  let files;
  try { files = roundFilesInDir(dir).filter((f) => f.n >= windowStart); }
  catch { console.log(JSON.stringify({ park: true, reason: "build-review dir unreadable" })); return 0; }

  const rounds = [];
  for (const f of files) {
    const read = readRoundRecord(f.path);
    if (read.malformed || read.missing) {
      const why = read.malformed ? `not valid JSON (${read.malformed})` : "could not be read (listed then vanished)";
      process.stderr.write(`faff build-judge-evidence --assemble: ${f.path} is ${why}\n`);
      return 2;
    }
    rounds.push(read.record || {});
  }

  let diffText;
  try { diffText = fs.readFileSync(diffPath, "utf8"); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot read --diff ${JSON.stringify(diffPath)}: ${e.message}\n`); return 2; }

  const acPath = values["--acceptance-criteria"];
  let acceptanceCriteria = "";
  if (acPath != null) {
    try { acceptanceCriteria = fs.readFileSync(acPath, "utf8"); }
    catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot read --acceptance-criteria ${JSON.stringify(acPath)}: ${e.message}\n`); return 2; }
  }
  const rePath = values["--repository-evidence"];
  let repositoryEvidenceText = "";
  if (rePath != null) {
    try { repositoryEvidenceText = fs.readFileSync(rePath, "utf8"); }
    catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot read --repository-evidence ${JSON.stringify(rePath)}: ${e.message}\n`); return 2; }
  }

  const runId = values["--run-id"] || issue;
  const outDir = values["--out"] || path.join(dir, "judge");

  const criticalsToAdjudicate = collectAdjudicationSet(rounds);
  const { caseFiles, ledger: freshLedger, parked } = assembleBuildCaseFiles({
    criticalsToAdjudicate, diffText, acceptanceCriteria, runId, windowStart, repositoryEvidenceText,
  });

  try { fs.mkdirSync(outDir, { recursive: true }); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot create --out ${JSON.stringify(outDir)}: ${e.message}\n`); return 2; }

  for (const cid of freshLedger.order) {
    freshLedger.entries[cid].case_sha = caseFiles[cid] ? sha256Text(JSON.stringify(caseFiles[cid])) : "";
  }

  // Resume an on-disk ledger only when it describes the same judge pass (same adjudication identity);
  // anything else (missing, malformed, pre-case_sha, changed inputs) starts fresh and sweeps what the
  // earlier pass left behind, since nothing on disk can belong to the new one.
  let existing = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, "ledger.json"), "utf8"));
    if (parsed && Array.isArray(parsed.order) && parsed.entries && typeof parsed.entries === "object") existing = parsed;
  } catch { /* absent or malformed: start fresh */ }
  let ledger = freshLedger;
  let resumed = false;
  if (existing && adjudicationIdentity(existing) === adjudicationIdentity(freshLedger)) {
    ledger = existing;
    resumed = true;
  } else {
    sweepStaleRulings(outDir);
  }

  for (const cid of ledger.order) {
    if (caseFiles[cid]) fs.writeFileSync(path.join(outDir, `case-${cid}.json`), JSON.stringify(caseFiles[cid], null, 2) + "\n");
  }
  // tmp + rename, so a kill mid-write never leaves a torn ledger (which would read as a mismatch and
  // restart the pass, discarding the attempt counts).
  const persistLedger = () => {
    const file = path.join(outDir, "ledger.json");
    const tmp = `${file}.tmp`;
    writeFileMode600(tmp, JSON.stringify(ledger, null, 2) + "\n");
    fs.renameSync(tmp, file);
  };
  persistLedger();

  // remaining(): the pending-unruled case ids; attemptsRemaining(L): the attempts they may still start.
  const isPendingUnruled = (e) => !!e && e.resolution === "pending" && e.ruling == null;
  const summary = (extra) => {
    const remaining = ledger.order.filter((cid) => isPendingUnruled(ledger.entries[cid]));
    const incomplete = !!(extra && extra.incomplete);
    const limit = extra && Number.isInteger(extra.retryLimit) ? extra.retryLimit + 1 : 0;
    let attemptsRemaining = 0;
    for (const cid of remaining) {
      const p = ledger.entries[cid].judge_progress || {};
      attemptsRemaining += p.reconstruction
        ? Math.max(0, limit - (p.phase2_attempts || 0))
        : Math.max(0, limit - (p.phase1_attempts || 0)) + limit;
    }
    return JSON.stringify({
      assembled: ledger.order.length, dispatched: ledger.order.length - parked.length, out: outDir, cases: ledger.order,
      resumed, incomplete, remaining: incomplete ? remaining : [], attempts_remaining: incomplete ? attemptsRemaining : 0,
    });
  };

  if (ledger.order.length === 0) {
    console.log(summary());
    return 0;
  }

  // Resolve the adversarial backend chain ONCE, before any dispatch. review-call.mjs never reads
  // .faffrc — it only knows its own argv — so without this the judge dispatch hits a bare USAGE(2)
  // and parks on every repo (FAFF-1075). An unresolvable chain fails SAFE here (park every standing
  // case with a diagnostic cause, never a call that cannot succeed), mirroring the unreadable-`--dir`
  // park bundle above.
  const resolveBackends = deps.resolveAdversarialBackends || realResolveAdversarialBackends;
  const backendsResult = resolveBackends();
  if (backendsResult.error) {
    const cause = backendsResult.error === "unset"
      ? "adversarial backend config unset — no adversarial.build_judge/.refs/.backends/.host+.model configured"
      : `adversarial backend config malformed: ${backendsResult.detail}`;
    for (const cid of ledger.order) {
      const entry = ledger.entries[cid];
      if (isPendingUnruled(entry)) {
        entry.resolution = "parked";
        entry.park_cause = cause;
      }
    }
    persistLedger();
    console.log(summary());
    return 0;
  }

  // A valid flag wins (nullish coalescing: a flag of 0 must not fall through to config).
  const retryLimit = flagRetryLimit ?? (deps.resolveBuildJudgeRetryLimit || realResolveBuildJudgeRetryLimit)();
  const clock = (deps.resolveBuildJudgeClock || realResolveBuildJudgeClock)();
  const budgetSecs = flagBudget ?? (deps.resolveBuildJudgeCallBudget || realResolveBuildJudgeCallBudget)();
  const attemptCost = clock.deadline + BUILD_JUDGE_SPAWN_GRACE_SECS;
  if (attemptCost > budgetSecs) {
    process.stderr.write(`faff build-judge-evidence --assemble: deadline(${clock.deadline}s)+grace(${BUILD_JUDGE_SPAWN_GRACE_SECS}s) exceeds the call budget (${budgetSecs}s); each call will run one attempt and may overshoot the budget by up to ${attemptCost - budgetSecs}s\n`);
  }
  // attemptsStarted is per invocation (never reset per case or phase): the first attempt of a call always
  // runs, so every incomplete exit has consumed one bounded attempt and the caller's loop terminates.
  const budget = {
    attemptsStarted: 0,
    allows() { return this.attemptsStarted === 0 || (now() - startedAt) / 1000 + attemptCost <= budgetSecs; },
  };
  const dispatchDeps = {
    runReviewCall: deps.runReviewCall || realRunReviewCall,
    judgeDispatchDisposition: deps.judgeDispatchDisposition || realJudgeDispatchDisposition,
    retryLimit,
    backendsChain: backendsResult.chain,
    clock,
    budget,
    persistLedger,
  };

  return dispatchJudgeRulings(ledger, caseFiles, outDir, dispatchDeps).then((outcome) => {
    persistLedger();
    console.log(summary({ incomplete: outcome.stopped, retryLimit }));
    return outcome.stopped ? ASSEMBLE_INCOMPLETE_EXIT : 0;
  }).catch((e) => {
    process.stderr.write(`faff build-judge-evidence --assemble: judge dispatch failed: ${(e && e.message) || e}\n`);
    return 2;
  });
}

// readBoundRuling(outDir, ledger, cid) -> { ok: true, ruling } | { ok: false, error }. Reads
// ruling-<cid>.json and accepts it only when its binding matches the ledger entry; the returned ruling
// has the binding stripped, so the roll-up and the floor see the verdict fields only (FAFF-1248).
function readBoundRuling(outDir, ledger, cid) {
  let ruling;
  try { ruling = JSON.parse(fs.readFileSync(path.join(outDir, `ruling-${cid}.json`), "utf8")); }
  catch (e) { return { ok: false, error: `missing/malformed ruling-${cid}.json in ${outDir}: ${e.message}` }; }
  if (!ruling || !bindingMatches(ruling.binding, ledger, cid)) {
    return { ok: false, error: `ruling-${cid}.json is not bound to this ledger entry (finding_id/pre_ruling_diff_sha/case_sha/run_id); treated as missing` };
  }
  const { binding: _binding, ...bare } = ruling;
  return { ok: true, ruling: bare };
}

function cmdAdmit(values) {
  const level = values["--level"];
  if (level == null) return usageError([{ code: "missing-value", detail: "--admit requires --level" }], BUILD_JUDGE_EVIDENCE_USAGE);
  const dir = values["--dir"];
  const outDir = values["--out"] || (dir ? path.join(dir, "judge") : null);
  if (outDir == null) return usageError([{ code: "missing-value", detail: "--admit requires --out (or --dir)" }], BUILD_JUDGE_EVIDENCE_USAGE);

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(path.join(outDir, "ledger.json"), "utf8")); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --admit: ledger.json unreadable/malformed in ${outDir}: ${e.message}\n`); return 2; }
  if (!ledger || !Array.isArray(ledger.order) || !ledger.entries) {
    process.stderr.write(`faff build-judge-evidence --admit: ledger.json in ${outDir} has no order[]/entries{}\n`); return 2;
  }

  const rulings = {};
  for (const cid of ledger.order) {
    const entry = ledger.entries[cid];
    if (entry && entry.resolution === "parked") { rulings[cid] = null; continue; }
    if (entry && entry.ruling) { rulings[cid] = entry.ruling; continue; }
    const read = readBoundRuling(outDir, ledger, cid);
    if (!read.ok) { process.stderr.write(`faff build-judge-evidence --admit: ${read.error}\n`); return 2; }
    rulings[cid] = read.ruling;
  }

  const criticalFreeLatest = dir ? computeCriticalFreeLatestFloor(dir, ledger, rulings) : null;

  let result;
  try {
    result = admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: criticalFreeLatest } });
  } catch (e) {
    if (e && e.failLoud) { process.stderr.write(`faff build-judge-evidence --admit: ${e.failLoud}\n`); return 2; }
    throw e;
  }
  result.level = level;
  try { fs.writeFileSync(path.join(outDir, "admit-result.json"), JSON.stringify(result, null, 2) + "\n"); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --admit: warning — could not write admit-result.json: ${e.message}\n`); }
  console.log(JSON.stringify(result));
  return result.admit ? 0 : 1;
}

module.exports = {
  cmdBuildJudgeEvidence,
  cmdAssemble,
  cmdAdmit,
  collectAdjudicationSet,
  findLastKnownFinding,
  latestRebuttalFor,
  dispatchOne,
  dispatchJudgeRulings,
  computeCriticalFreeLatestFloor,
  bindingFor,
  bindingMatches,
  readBoundRuling,
  realRunReviewCall,
  realJudgeDispatchDisposition,
  realResolveAdversarialBackends,
  realResolveBuildJudgeClock,
  resolveBuildJudgeClock,
  realResolveBuildJudgeRetryLimit,
  resolveBuildJudgeRetryLimit,
  realResolveBuildJudgeCallBudget,
  resolveBuildJudgeCallBudget,
  adjudicationIdentity,
  reviewCallSpawnOptions,
  reviewCallExitFromError,
  DEFAULT_BUILD_JUDGE_DEADLINE_SECS,
  DEFAULT_BUILD_JUDGE_TIMEOUT_SECS,
  DEFAULT_BUILD_JUDGE_RETRY_LIMIT,
  DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS,
  ASSEMBLE_INCOMPLETE_EXIT,
  BUILD_JUDGE_SPAWN_GRACE_SECS,
  REVIEW_CALL_DEADLINE_EXIT,
};
