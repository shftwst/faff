// ===========================================================================
// === region:factory — merge-gate — FAFF-350/375: the merge-gate interlock + branch-protection check, rehomed out of the shell registry span ===
// ===========================================================================
// merge-gate — FAFF-350: the SOLE sanctioned `gh pr merge` path in autonomous mode.
// pure-core (decideFloor, registered as CONTRACTS["integrity-floor"]) + impure-shell (here).
// The shell OBSERVES CI itself on the resolved PR head sha (never accepts a caller CI verdict —
// the model's self-report is exactly what the gate distrusts), RE-READS the persisted floor
// artifacts from the run-dir, decides via the pure contract, and executes the merge only on
// merge-ok. Fail-closed everywhere: a missing/unreadable artifact, an indeterminate CI reading,
// or a head-sha mismatch REFUSES (exit 1). `gh`/`git` are the only external commands.
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { adrFlag } = require("./adr");
const { FLOOR_LEVELS, computeLaneBoundary, computeReviewVerdict, decideFloor, holdoutGateResult, resolveGateLevel } = require("./contract-defs");
const { realFsq } = require("./container-check");
const { correctiveIntegrityDirs, correctiveIntegrityProbe, integrityGate } = require("./corrective-integrity");
const { appendEffectEntries, buildProgressPath, effectTargetMatches } = require("./effects");
const { tryReadLedger } = require("./prepcheck");

// The closed `gh pr merge` flag vocabulary. `--merge-args` is validated against this so no
// untrusted free-text reaches the merge shell (the caller is always graft / the default ship
// producer — never a ticket description). Unrecognised token → the whole call fail-louds.
// `--admin` is deliberately ABSENT (FAFF-375): it tells the forge to bypass branch protection —
// the forge-side backstop the merge floor itself leans on (and which `faff branch-protection-check`
// exists to assert) — so faff must never issue one under any lane. `--merge-args "--admin"` now
// lands in `rejected` → exit 2 via the existing unrecognised-token path. A human who genuinely
// needs a force-merge does it at the forge, the same loud off-script boundary FAFF-350 accepts.
const MERGE_FLAG_ALLOW = new Set(["--squash", "--merge", "--rebase", "--delete-branch", "--auto"]);
function parseMergeArgs(s) {
  const toks = String(s || "").trim().split(/\s+/).filter(Boolean);
  const flags = [], rejected = [];
  for (const t of toks) { if (MERGE_FLAG_ALLOW.has(t)) flags.push(t); else rejected.push(t); }
  return { flags, rejected };
}

// PURE (FAFF-375): fence the two HUMAN-ONLY flags on a genuine interactivity signal, not sibling
// argv flags. `--human-override` (replaces the refusal, overriding every blocker at once) and
// `--allow-no-ci` (opts a change-class past the no-ci-coverage refusal) both weaken the floor, so
// each may be honoured ONLY when a real human is at the process terminal — signalled by
// `process.stdin.isTTY === true` (the shell coerces undefined/absent → false, fail-closed) AND the
// declarative `--interactive` pairing. An autonomous caller cannot mint a TTY by adding a token to
// its own argv, so the gate's guarantee no longer depends on callers omitting a flag. A violation
// is a bad invocation → exit 2 fail-loud (never a silent downgrade to the plain exit-1 refusal,
// which would read as "floor not met" and invite retry-with-different-flags).
function fenceHumanFlags(i) {
  const violations = [];
  const remedy = "run this merge-gate command yourself in a real terminal";
  if (i.human_override && !i.stdin_is_tty) violations.push(`--human-override is human-only: stdin is not a TTY — ${remedy}`);
  if (i.allow_no_ci && !i.stdin_is_tty) violations.push(`--allow-no-ci is human-only: stdin is not a TTY — ${remedy}`);
  if (i.human_override && !i.interactive) violations.push("--human-override requires --interactive");
  if (i.allow_no_ci && !i.interactive) violations.push("--allow-no-ci requires --interactive");
  return { ok: violations.length === 0, violations };
}

// PURE: classify the check set FOR THE HEAD SHA into the FAFF-3 trichotomy (+ indeterminate).
// `runs` = check-runs API rows [{status, conclusion}]; `statusState`/`statusCount` = the legacy
// commit-status combined state + count. Staleness (checks exist but not on head) is the shell's
// job — this only judges the head-sha set. Empty set → no-ci-coverage; any fail/unknown → ci-red
// (fail-closed); any pending → indeterminate; all-ok → ci-green.
function classifyHeadShaChecks(runs, statusState, statusCount) {
  runs = Array.isArray(runs) ? runs : [];
  const legacyCount = statusCount || 0;
  const total = runs.length + legacyCount;
  if (total === 0) return "no-ci-coverage";
  const FAIL = new Set(["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"]);
  const OK = new Set(["success", "neutral", "skipped"]);
  // `anySuccess` = a check that genuinely EXECUTED green. `skipped`/`neutral` are OK-not-fail but did
  // not run, so they do not count as coverage (FAFF-366).
  let anyPending = false, anyFail = false, anySuccess = false;
  for (const r of runs) {
    if (r && r.status && r.status !== "completed") { anyPending = true; continue; }
    const c = r && r.conclusion;
    if (FAIL.has(c) || !OK.has(c)) { anyFail = true; continue; } // unknown conclusion → fail-closed
    if (c === "success") anySuccess = true;
  }
  // The legacy combined commit-status is only meaningful when >=1 legacy status actually exists.
  // GitHub returns {state:"pending", count:0} BY DEFAULT for an Actions-only commit (zero legacy
  // statuses) — that is not a real pending signal, and heeding it refused every genuinely-green
  // merge on Actions-only repos (FAFF-369). Only read statusState when legacyCount>0.
  if (legacyCount > 0) {
    if (statusState === "failure" || statusState === "error") anyFail = true;
    else if (statusState === "pending") anyPending = true;
    else if (statusState === "success") anySuccess = true;
  }
  if (anyFail) return "ci-red";
  if (anyPending) return "indeterminate";
  // Checks exist (total>0) but none actually executed to green — every check was skipped/neutral, so
  // no real CI ran on this head sha. That is absence of coverage, NOT a green (fail-open guard,
  // FAFF-366). A single genuine success alongside skipped checks still reads ci-green.
  if (!anySuccess) return "no-ci-coverage";
  return "ci-green";
}

// PURE (FAFF-376): judge whether the CI reading can be TRUSTED before it is classified. The check-runs
// API is the PRIMARY signal; the legacy commit-status API is only a SUPPLEMENT, trusted solely alongside
// a readable primary. When the primary signal is unreadable the result is "indeterminate" REGARDLESS of
// the legacy status — a legacy success never yields ci-green and a legacy failure never upgrades to
// ci-red (uniform severity: the gate cannot see the primary signal, so it reports exactly that; fail
// closed on primary-signal loss). When the primary IS readable, classification is delegated unchanged to
// classifyHeadShaChecks with the legacy supplement folded in only if the legacy API itself was readable.
// api_degraded_reason is non-null IFF ci_state was forced to "indeterminate" by API loss.
function classifyCiObservation(checkRunsOk, runs, statusOk, statusState, statusCount) {
  if (!checkRunsOk) {
    const reason = statusOk
      ? "check-runs API unavailable — legacy status alone is not trusted"
      : "gh api unreachable for head-sha checks";
    return { ci_state: "indeterminate", api_degraded_reason: reason };
  }
  const effectiveState = statusOk ? statusState : null;
  const effectiveCount = statusOk ? statusCount : 0;
  return {
    ci_state: classifyHeadShaChecks(Array.isArray(runs) ? runs : [], effectiveState, effectiveCount),
    api_degraded_reason: null,
  };
}

// PURE (FAFF-376): name a non-zero `gh pr merge` exit into a refusal blocker. Called ONLY on a non-zero
// merge exit — every kind is a REFUSAL; there is NO success branch. head-drift = the forge rejected the
// head pin because the live head no longer equals the observed sha (drift in the observe-to-merge
// window); pin-unsupported = the installed gh lacks --match-head-commit, so an unpinned merge was never
// attempted (remedy: upgrade gh, not retry); generic = any other rejection, preserving today's blocker
// text. Unrecognisable pin-rejection wording degrades to generic (still a refusal) — a wording change
// can only cost blocker specificity, never fail open.
function classifyMergeFailure(stderr, observedSha) {
  const s = String(stderr || "").trim();
  if (/unknown flag.*match-head-commit/i.test(s) || /match-head-commit.*unknown flag/i.test(s)) {
    return { kind: "pin-unsupported", blocker: "installed gh does not support --match-head-commit — upgrade gh; the gate never merges unpinned" };
  }
  // Forge-side expectedHeadOid rejection (empirically-captured wording; candidates below). The camelCase
  // `expectedHeadOid` GraphQL field name is matched directly (it can surface verbatim when gh relays the
  // raw GraphQL error), alongside the prose forms. An unmatched wording still degrades to `generic` — a
  // refusal either way, never a fail-open.
  if (/head (?:branch |ref |commit )?was modified/i.test(s) || /expected head (?:sha|oid)/i.test(s) || /expectedheadoid/i.test(s)
      || /head (?:sha |ref |oid |commit )?(?:has )?(?:changed|was modified|is out.?of.?date)/i.test(s) || /does not match .*(?:expected )?head/i.test(s)) {
    return { kind: "head-drift", blocker: `head sha changed between CI observation and merge: observed ${observedSha}; the forge refused the head pin` };
  }
  return { kind: "generic", blocker: `gh pr merge rejected: ${s || "non-zero exit"}` };
}

// FAFF-365: PURE post-merge classifier. `gh pr merge` conflates two things in one exit code — the
// merge itself, and optional POST-merge steps (--delete-branch, --auto bookkeeping). A non-zero exit
// does not mean "the merge failed"; it can equally mean "the merge landed and a follow-up step
// failed." PR state (a re-read `gh pr view --json state`) is authoritative over the CLI exit code —
// the exit code only ever TRIGGERS this re-check, it never decides merged-vs-refuse by itself.
// merge_ok=true short-circuits (mirrors the caller's own zero-exit path; never reached in practice
// since cmdMergeGate only calls this on a non-zero exit, but keeps the function total).
// post_state===null means the re-read itself failed (gh unreachable) — fails CLOSED to refuse: we
// cannot prove the PR merged, and a later re-run's idempotent top-of-function MERGED check recovers
// it once state is readable, so nothing is lost by refusing now rather than guessing merged.
function classifyPostMerge({ merge_ok, post_state, merge_stderr }) {
  if (merge_ok) return { merged: true, outcome: "merged", warning: null, blocker: null };
  // Collapse embedded newlines before interpolation — a multi-line `gh` stderr would otherwise make
  // the rendered warning/blocker line wrap unprefixed in `emit`'s `  ⚠ `/`  ✗ ` single-line format.
  const stderrText = String(merge_stderr || "non-zero exit").replace(/[\r\n]+/g, " ").trim() || "non-zero exit";
  if (post_state === "MERGED") {
    return {
      merged: true,
      outcome: "merged",
      warning: `gh pr merge exited non-zero after the merge landed (post-merge step failed): ${stderrText}`,
      blocker: null,
    };
  }
  // Strict null check (matches the "unreadable re-read" contract exactly): the caller only ever
  // passes `null` (unreadable) or a state string, never `undefined` — kept strict for symmetry with
  // the `=== "MERGED"` check above rather than the looser `== null`.
  if (post_state === null) {
    return { merged: false, outcome: "refuse", warning: null, blocker: `gh pr merge rejected: ${stderrText} (post-merge state re-read failed)` };
  }
  return { merged: false, outcome: "refuse", warning: null, blocker: `gh pr merge rejected: ${stderrText}` };
}

// PURE: the gh-api probe result → BranchProtectionState. Reachable+protected → protected;
// reachable+404 → unprotected; unreachable/forbidden → indeterminate (fail-closed, warns).
function classifyBranchProtection(probe) {
  if (!probe || !probe.ok) return { status: "indeterminate", required_checks: [], basis: (probe && probe.basis) || "gh api unreachable" };
  if (probe.protected) return { status: "protected", required_checks: probe.required_checks || [], basis: probe.basis || "branch protection present" };
  return { status: "unprotected", required_checks: [], basis: probe.basis || "no branch protection" };
}

// Impure gh helper: run `gh <args>`, JSON-parse stdout. Returns { ok, data, status, stderr }.
function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", timeout: 60000 });
  if (r.error || r.status !== 0) return { ok: false, data: null, status: r.status, stderr: (r.stderr || (r.error && r.error.message) || "").trim() };
  try { return { ok: true, data: JSON.parse(r.stdout), status: 0, stderr: "" }; }
  catch { return { ok: false, data: null, status: 0, stderr: "unparseable gh JSON" }; }
}

function ghRepoSlug(explicit) {
  if (explicit) return explicit;
  const r = ghJson(["repo", "view", "--json", "nameWithOwner"]);
  return r.ok && r.data ? r.data.nameWithOwner : null;
}

// Observe CI for the head sha authoritatively (head-sha check-runs + legacy status). A zero head-sha
// set is disambiguated: if `gh pr checks` shows ANY checks they belong to an earlier commit → stale
// green (head_sha_matches:false → refuse); otherwise genuine no-ci-coverage. gh outage → indeterminate.
function observeCi(repo, pr, headSha) {
  const cr = ghJson(["api", `repos/${repo}/commits/${headSha}/check-runs`, "--jq", "[.check_runs[] | {status, conclusion}]"]);
  const stt = ghJson(["api", `repos/${repo}/commits/${headSha}/status`, "--jq", "{state: .state, count: (.statuses | length)}"]);
  // Trust judgement first (FAFF-376): loss of the PRIMARY check-runs signal → indeterminate regardless
  // of the legacy status. The old `!cr.ok && !stt.ok` early return is subsumed by this (its both-down
  // detail string is preserved). Only when the primary was readable do we proceed to head-state handling.
  // A zero-exit gh call whose payload is NOT the expected array means the primary responded but is
  // unreadable (malformed/shape-changed) — treat that as check-runs-unavailable (→ indeterminate), never
  // as an empty green set, so a malformed primary can never fail open into no-ci-coverage.
  const checkRunsOk = cr.ok && Array.isArray(cr.data);
  const cls = classifyCiObservation(
    checkRunsOk, checkRunsOk ? cr.data : [],
    stt.ok, stt.ok && stt.data ? stt.data.state : null,
    stt.ok && stt.data ? stt.data.count : 0,
  );
  if (cls.api_degraded_reason) return { ci_state: "indeterminate", head_sha_matches: true, detail: cls.api_degraded_reason };
  const headState = cls.ci_state;
  if (headState !== "no-ci-coverage") return { ci_state: headState, head_sha_matches: true, detail: `head-sha checks: ${headState}` };
  // Head sha carries zero checks — stale-green or genuine no-CI?
  const prc = ghJson(["pr", "checks", String(pr), "--json", "state"]);
  const anyPr = prc.ok && Array.isArray(prc.data) && prc.data.length > 0;
  if (anyPr) return { ci_state: "ci-green", head_sha_matches: false, detail: "checks exist but none on the current head sha (stale green)" };
  return { ci_state: "no-ci-coverage", head_sha_matches: true, detail: "no checks on head sha and none on the PR" };
}

// FAFF-397: the per-issue merge-record path — the additive floor artifact `faff reconcile`
// re-reads at run-end to confront a ledger `shipped` claim with the ACTUAL merged head sha.
// Mirrors ac-checklist.json/review-verdict.json's <run-dir>/<issue>/<file> convention exactly.
function mergeRecordPath(runDir, issue) {
  return path.join(runDir, issue, "merge-record.json");
}

// Write the merge record on every merge-ok path (idempotent already-merged, the normal
// successful merge, and the FAFF-365 post-merge-success re-read) — the sha it already resolved
// for --match-head-commit, so no second observation. Best-effort: a write failure is surfaced
// but never un-does an already-landed merge (the merge itself is the load-bearing event; a
// missing record just means `faff reconcile` will (correctly) flag this issue as unproven at
// run-end, fail-closed — never silently drop the merge).
// `integrity` (FAFF-325, optional): the corrective-integrity annotation ("asserted" |
// "unasserted" | "violated") — ALWAYS supplied by cmdMergeGate on every call site, so the merge
// record carries the attestation basis it was decided under, never silently omitted.
function writeMergeRecord(runDir, issue, pr, headSha, integrity) {
  try {
    const dir = path.join(runDir, issue);
    fs.mkdirSync(dir, { recursive: true });
    const record = { pr: Number(pr), head_sha: headSha, merged: true, merged_at: new Date().toISOString(), integrity: integrity || "unasserted" };
    fs.writeFileSync(mergeRecordPath(runDir, issue), JSON.stringify(record, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`faff merge-gate: warning — could not write merge-record.json: ${e.message}\n`);
  }
}

// FAFF-325: derive the corrective-integrity annotation for THIS merge decision.
//   probe    := correctiveIntegrityProbe(process.env, realFsq(), correctiveIntegrityDirs(runDir, issue))
//   gate     := integrityGate(probe, "merge-floor")  — trusted | refuse (violation) | unasserted
// The L4 defence-in-depth branch (unasserted -> refuse) is keyed on `level` — the SAME
// ledger-reconciled value the holdout leg already uses (resolveGateLevel's mismatch check, above
// in cmdMergeGate, already fail-LOUDS — exit 2 — the instant an explicit --level disagrees with
// run-ledger.json's level; it is never silently resolved in the ledger's favour). Re-deriving a
// SEPARATE, flag-only level source for this one leg would not close any gap the mismatch check
// doesn't already close when a level IS asserted at invocation, and would REGRESS a genuine L4
// run whose caller (legitimately) leans on the ledger-resolved level without repeating --level —
// so this leg rides the same reconciled `level`, exactly like holdout.
// Returns { state, display } — `state` (4-valued) is what decideFloor's blocker logic keys on;
// `display` (3-valued: asserted|unasserted|violated) is what the merge record / banner annotate.
function resolveIntegrity(runDir, issue, level) {
  const dirs = correctiveIntegrityDirs(runDir, issue);
  const probe = correctiveIntegrityProbe(process.env, realFsq(), dirs);
  const gate = integrityGate(probe, "merge-floor");
  let state;
  if (gate.disposition === "trusted") state = "asserted";
  else if (gate.disposition === "refuse") state = "violated";
  else state = level === "L4" ? "unasserted-refuse" : "unasserted-ok";
  const display = state === "asserted" ? "asserted" : state === "violated" ? "violated" : "unasserted";
  return { state, display, basis: probe.basis };
}

// Read the AC-checklist artifact graft persists at <run-dir>/<ISSUE>/ac-checklist.json.
// Missing/unreadable/malformed → false (fail-closed: an unverifiable AC leg never passes).
function readAcComplete(runDir, issue) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(runDir, issue, "ac-checklist.json"), "utf8"));
    return j && (j.all_verified === true || j.ac_complete === true);
  } catch { return false; }
}

// Read + RE-VALIDATE the review-verdict block graft persists at <run-dir>/<ISSUE>/review-verdict.json
// through the SAME computeReviewVerdict rule (never a forked check). Missing/unreadable/fail-loud →
// "missing" (fail-closed). A conformant block yields its own signal (pass|fail|needs-human|unavailable —
// FAFF-405; decideFloor's `!== "pass"` check already blocks the new value with no change here).
function readReviewVerdict(runDir, issue) {
  let block;
  try { block = JSON.parse(fs.readFileSync(path.join(runDir, issue, "review-verdict.json"), "utf8")); }
  catch { return "missing"; }
  const { contractData, failLoud } = computeReviewVerdict(block);
  if (failLoud || !contractData) return "missing";
  return contractData.signal;
}

// FAFF-420: pure freshness check — the holdout verdict must STRICTLY postdate the build-complete
// checkpoint it's being read for, so a verdict produced before this build (stale, or left over from a
// prior build of the same issue) can never satisfy the gate. Both timestamps must be finite; a
// non-finite either side is never "fresh" (fail-closed, mirrors the mtime-floor precedent in prepIsHeld).
function holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs) {
  return Number.isFinite(holdoutMtimeMs) && Number.isFinite(checkpointTimeMs) && holdoutMtimeMs > checkpointTimeMs;
}

// FAFF-420: read the per-issue holdout verdict RUN-DIR-RELATIVE (never CWD-relative — the CWD-relative
// default was the bug: a stale or foreign verdict sitting in the working directory could vacuously
// satisfy the gate). Mirrors readAcComplete/readReviewVerdict's convention exactly: the artifact lives
// at <run-dir>/<issue>/holdout.json, so a verdict from a different run is structurally unreadable here.
// On top of the structural binding, the verdict must be FRESH — its mtime must postdate the
// build-complete checkpoint (<run-dir>/<issue>/build-progress.json) — so a same-run-dir but
// pre-this-build verdict is refused too. Reduces through the SAME holdoutGateResult gate (never forked).
// pass → meets-spec; a "missing" block or an absent/foreign holdout file → missing; anything else
// (including unprovable/failed freshness) → blocked.
// FAFF-384: resolve the run's cage promise from its lane-boundary intent artifact (<run-dir>/lane-boundary.json,
// the orchestrator-held, rung-1-integrity-covered run dir). The promise ARMS the spawner-attestation ratchet in
// readHoldout below — the merge-floor's physical enforcement of "the evaluator was code-blind by construction".
// Fail-SAFE toward the strong direction the spec fixes ("a malformed promise never relaxes to legacy"):
//   - absent file (ENOENT) → promise ABSENT → ratchet OFF → byte-for-byte legacy (uncaged runs unaffected).
//   - present + valid + cage-shaped (lane evaluator, container own, accesses.repo absent) → ratchet ON.
//   - present + valid but NON-cage (e.g. container shared / repo present — a legitimate rung-0 declaration) → OFF.
//   - present + malformed/unreadable → ratchet ON (a present-but-broken promise never relaxes to self-attestation).
// PURE beyond the single-file read; never throws.
function laneBoundaryPromisesCage(runDir) {
  if (!runDir) return false;
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, "lane-boundary.json"), "utf8"); }
  catch (e) { return e.code === "ENOENT" ? false : true; } // absent → legacy; unreadable → present-but-broken → arm
  let intent;
  try { intent = JSON.parse(raw); } catch { return true; } // present-but-malformed → arm (never relax)
  const { contractData, failLoud } = computeLaneBoundary(intent);
  if (failLoud || !contractData) return true; // structurally malformed present intent → arm
  if (contractData.violations.length > 0) return true; // a present, invalid promise → arm
  return contractData.lane === "evaluator" && contractData.container === "own" && contractData.accesses.repo === "absent";
}

function readHoldout(runDir, issue) {
  if (!runDir) return "missing"; // no run to bind to => fail-closed, never fall back to CWD-relative
  const holdoutPath = path.join(runDir, issue, "holdout.json");
  let block, holdoutMtimeMs;
  try {
    block = JSON.parse(fs.readFileSync(holdoutPath, "utf8"));
    holdoutMtimeMs = fs.statSync(holdoutPath).mtimeMs;
  } catch (e) { return "missing"; } // absent/unreadable/malformed/foreign => missing (existing posture)

  let checkpointTimeMs = NaN;
  try {
    const checkpoint = JSON.parse(fs.readFileSync(buildProgressPath(runDir, issue), "utf8"));
    checkpointTimeMs = Date.parse(checkpoint.updated_at ?? checkpoint.build?.pushed_at);
  } catch (e) { /* leave checkpointTimeMs NaN => not fresh below */ }
  if (!holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs)) return "blocked"; // stale, or freshness unprovable => refuse (never "missing")

  // FAFF-384: arm the spawner-attestation ratchet iff THIS run promised the evaluator cage. Absent a promise
  // (the overwhelmingly common non-L4-cage path) the gate is byte-for-byte today's holdoutGateResult.
  const requireSpawnerAttested = laneBoundaryPromisesCage(runDir);
  const res = holdoutGateResult(block, { requireSpawnerAttested });
  if (res.gate === "pass") return "meets-spec";
  return res.reason === "missing" ? "missing" : "blocked";
}

// === FAFF-383: mechanical observe — the merge chokepoint's half of the effects ledger =====
// Detection-only, per ADR-0064's authority split: the OBSERVE is written only by the mechanical
// actor that performed the effect (this module, after `gh pr merge` is confirmed to have landed),
// never by the orchestrating step (graft Step 10 owns the DECLARE, before invoking this CLI at
// all — never here). Nothing in this region may change merge-gate's verdict, exit code, or
// emitted JSON — every call site below is reached strictly AFTER the verdict is already decided,
// and every failure inside this region is swallowed to a stderr line, never a thrown/propagated
// error, never a schema-2 effects[] on the result object.

// Build the effect descriptors THIS invocation is about to observe. `deleteBranch` gates the
// branch-delete leg — only the clean-success tail may pass true; the classifyPostMerge "merged"
// path (post-merge step failed) always passes false, because whether --delete-branch itself
// succeeded is exactly what's unconfirmed on that path (see 4.2's path (b) note in the spec).
function mergeEffectsFor(pr, deleteBranch, headRefName) {
  const effects = [{ kind: "merge", target: `pr:${pr}`, reversible: true }];
  if (deleteBranch && headRefName) effects.push({ kind: "branch-delete", target: headRefName, reversible: true });
  return effects;
}

// Read declared-effects.jsonl and warn — never refuse — for each about-to-be-observed effect with
// no covering declaration at (issue, step "merge"): same kind, and target either an exact match or
// covered by a "*" wildcard declaration (effectTargetMatches, the same match rule `effects check`
// uses). This is advisory-only: it never blocks, and any read/parse failure degrades to "treat as
// uncovered" (an unreadable ledger looks identical to an empty one — the caller still gets the
// warning, never a silent skip).
function warnUncoveredMergeObserves(runDir, issue, effects) {
  let declared = [];
  try {
    const ledgerPath = path.join(runDir, "declared-effects.jsonl");
    if (fs.existsSync(ledgerPath)) {
      declared = fs.readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim() !== "")
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        .filter((e) => e.kind_of_entry === "declare" && e.issue === issue && e.step === "merge")
        .map((e) => e.effect);
    }
  } catch (e) { /* unreadable ledger => declared stays [] => every effect below reads as uncovered */ }
  for (const eff of effects) {
    const covered = declared.some((d) => d && d.kind === eff.kind && effectTargetMatches(d.target, eff.target));
    if (!covered) {
      process.stderr.write(`faff merge-gate: observed ${eff.kind} ${eff.target} with no covering declaration — declare it at graft Step 10 (faff effects declare --step merge); this will read as an escaped side-effect\n`);
    }
  }
}

// Observe what THIS invocation actually did. Called at exactly two points, both AFTER a
// confirmed merge: the clean-success tail, and the classifyPostMerge "merged" path. Any failure
// anywhere in this function (unreadable ledger, append error) is swallowed to one stderr warning —
// the merge outcome this function is called from is already final by the time it runs.
function observeMergeEffects(runDir, issue, effects) {
  try {
    warnUncoveredMergeObserves(runDir, issue, effects);
    const result = appendEffectEntries(runDir, "observe", issue, "merge", effects);
    if (result.violations) {
      // Should not happen for internally-built descriptors (kind/target/reversible are all
      // faff-constructed, never derived from untrusted input) — surfaced loudly if it ever does.
      process.stderr.write(`faff merge-gate: effects ledger append rejected internally-built descriptors: ${JSON.stringify(result.violations)}\n`);
    }
  } catch (e) {
    process.stderr.write(`faff merge-gate: effects ledger observe failed (merge outcome unaffected): ${e.message}\n`);
  }
}

function cmdMergeGate(args) {
  if (args.includes("--selftest")) return mergeGateSelftest();
  const json = args.includes("--json");
  const pr = adrFlag(args, "--pr");
  const issue = adrFlag(args, "--issue");
  const runDir = adrFlag(args, "--run-dir");
  const flagLevel = adrFlag(args, "--level");
  const mode = args.includes("--check-only") ? "check-only" : "execute";
  const interactive = args.includes("--interactive");
  const humanOverride = args.includes("--human-override");
  const allowNoCi = args.includes("--allow-no-ci");
  const noCiPolicy = allowNoCi ? "allow" : "needs-human";
  const mergeArgsRaw = adrFlag(args, "--merge-args") || "";
  const repoFlag = adrFlag(args, "--repo");

  if (!pr || !issue || !runDir) { process.stderr.write("faff merge-gate: --pr, --issue and --run-dir are required\n"); return 2; }
  if (flagLevel != null && !FLOOR_LEVELS.includes(flagLevel)) { process.stderr.write(`faff merge-gate: --level ${JSON.stringify(flagLevel)} not in {${FLOOR_LEVELS.join(",")}}\n`); return 2; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) { process.stderr.write(`faff merge-gate: --issue ${JSON.stringify(issue)} is not a valid issue id\n`); return 2; }
  // FAFF-424: the run-ledger's `level` (minted by `faff lights-out`) governs when present — an
  // explicit --level may only agree or trigger a fail-loud mismatch refusal, never silently
  // downgrade it. Absent/unreadable/out-of-enum ledger level leaves the flag/default path unchanged.
  const ledger = tryReadLedger(runDir);
  const ledgerLevel = (ledger && FLOOR_LEVELS.includes(ledger.level)) ? ledger.level : null;
  const { level, mismatch } = resolveGateLevel(ledgerLevel, flagLevel);
  if (mismatch) {
    process.stderr.write(`faff merge-gate: --level ${JSON.stringify(flagLevel)} contradicts run-ledger level ${JSON.stringify(ledgerLevel)} (${path.join(runDir, "run-ledger.json")}); the ledger level governs — drop --level or pass --level ${ledgerLevel}\n`);
    return 2;
  }
  const parsedMerge = parseMergeArgs(mergeArgsRaw);
  if (parsedMerge.rejected.length) { process.stderr.write(`faff merge-gate: unrecognised --merge-args token(s): ${parsedMerge.rejected.join(", ")} (allowed: ${[...MERGE_FLAG_ALLOW].join(", ")})\n`); return 2; }

  // FAFF-375: fence the human-only flags on a genuine interactivity signal BEFORE any gh call —
  // a fenced flag from a non-interactive context is a caller bug, surfaced loudly (exit 2) rather
  // than silently ignored. Pre-network ordering also makes the refusal CLI-boundary-testable with
  // zero mocking (the spawned test child is non-TTY by construction).
  const fence = fenceHumanFlags({ human_override: humanOverride, allow_no_ci: allowNoCi, interactive, stdin_is_tty: process.stdin.isTTY === true });
  if (!fence.ok) { for (const v of fence.violations) process.stderr.write(`faff merge-gate: ${v}\n`); return 2; }

  const emit = (res, status) => {
    if (json) process.stdout.write(JSON.stringify(res) + "\n");
    else {
      console.log(`${res.verdict}${res.merged ? " (merged)" : ""} — CI ${res.ci_state}, head ${res.head_sha || "?"}, integrity ${res.integrity || "unasserted"}`);
      for (const b of (res.blockers || [])) console.log(`  ✗ ${b}`);
      for (const w of (res.warnings || [])) console.log(`  ⚠ ${w}`);
    }
    return status;
  };

  // FAFF-325: computed once, reused on EVERY path below (idempotent no-op, refuse, merge-ok) —
  // "the merge record + ledger banner ALWAYS annotate the integrity basis, on every decision path".
  const integrity = resolveIntegrity(runDir, issue, level);

  const repo = ghRepoSlug(repoFlag);
  if (!repo) { process.stderr.write("faff merge-gate: cannot resolve repo slug (gh repo view failed)\n"); return 2; }
  // headRefName (FAFF-383): the branch-delete observe target, derived mechanically alongside the
  // identity fetch that already runs on every path — never a second gh call.
  const hv = ghJson(["pr", "view", String(pr), "--json", "headRefOid,headRefName,state,url"]);
  if (!hv.ok || !hv.data || !hv.data.headRefOid) { process.stderr.write(`faff merge-gate: cannot establish PR identity for #${pr}: ${hv.stderr}\n`); return 2; }
  const headSha = hv.data.headRefOid;
  const headRefName = hv.data.headRefName || null;
  // Idempotent: a PR a peer already merged is a no-op, never a double-merge (gateway → status monotonicity).
  if (hv.data.state === "MERGED") {
    writeMergeRecord(runDir, issue, pr, headSha, integrity.display); // FAFF-397: ensure the record exists even on the idempotent no-op path
    return emit({ verdict: "merge-ok", merged: true, blockers: [], ci_state: "n/a", head_sha: headSha, integrity: integrity.display, note: "already merged" }, 0);
  }

  const ci = observeCi(repo, pr, headSha);
  const floor = {
    ac_complete: readAcComplete(runDir, issue),
    review_verdict: readReviewVerdict(runDir, issue),
    ci_state: ci.ci_state,
    head_sha_matches: ci.head_sha_matches,
    level,
    holdout: level === "L4" ? readHoldout(runDir, issue) : "not-applicable",
    no_ci_policy: noCiPolicy,
    integrity: integrity.state,
  };
  const { verdict, blockers } = decideFloor(floor);
  const result = { verdict, blockers, merged: false, ci_state: ci.ci_state, head_sha: headSha, ci_detail: ci.detail, integrity: integrity.display };

  if (verdict === "refuse") {
    if (interactive && humanOverride) {
      try {
        fs.mkdirSync(path.join(runDir, issue), { recursive: true });
        fs.writeFileSync(path.join(runDir, issue, "merge-gate-override.json"), JSON.stringify({ pr, issue, head_sha: headSha, blockers, overridden_at: new Date().toISOString() }, null, 2) + "\n");
      } catch (e) { process.stderr.write(`faff merge-gate: could not record human override: ${e.message}\n`); return 2; }
      // fall through to execute — the recorded human override REPLACES the autonomous refusal.
    } else {
      return emit(result, 1);
    }
  }
  if (mode === "check-only") return emit({ ...result, verdict: "merge-ok" }, 0);

  // Head pin (FAFF-376): --match-head-commit makes the forge itself refuse any merge whose live head no
  // longer equals `headSha` — the SAME variable CI was classified against (:observed sha). Gate-composed,
  // appended after parsedMerge.flags so it rides EVERY executed merge (normal path and the human-override
  // fall-through alike); callers cannot supply it (parseMergeArgs rejects it → exit 2). --check-only and
  // the already-MERGED no-op never reach this spawn.
  const m = spawnSync("gh", ["pr", "merge", String(pr), ...parsedMerge.flags, "--match-head-commit", headSha], { encoding: "utf8", timeout: 120000 });
  if (m.status !== 0) {
    const mergeStderr = (m.stderr || "").trim();
    // FAFF-365: a non-zero `gh pr merge` exit does not by itself mean the merge failed — it can mean
    // the merge landed and a POST-merge step failed (e.g. --delete-branch). Re-read PR state (the
    // authoritative source) before concluding refuse; classifyPostMerge is the pure merged-vs-refuse
    // decision over (merge exit, re-read state).
    const sv = ghJson(["pr", "view", String(pr), "--json", "state"]);
    const postState = (sv.ok && sv.data) ? sv.data.state : null;
    const pm = classifyPostMerge({ merge_ok: false, post_state: postState, merge_stderr: mergeStderr });
    if (pm.outcome === "merged") {
      result.merged = true;
      result.verdict = "merge-ok";
      result.warnings = [...(result.warnings || []), pm.warning];
      writeMergeRecord(runDir, issue, pr, headSha, integrity.display); // FAFF-397
      // FAFF-383: path (b) — the post-merge step's own success is unconfirmed (that's WHY gh
      // exited non-zero here), so observe the merge only, never branch-delete.
      observeMergeEffects(runDir, issue, mergeEffectsFor(pr, false, headRefName));
      return emit(result, 0);
    }
    // Genuine refusal (PR did not merge) — behaviour-identical to today: classifyMergeFailure still
    // owns the blocker's specific wording (head-drift / pin-unsupported / generic).
    const cls = classifyMergeFailure(mergeStderr, headSha);
    result.verdict = "refuse";
    result.blockers = [...blockers, cls.blocker];
    return emit(result, 1);
  }
  result.merged = true;
  result.verdict = "merge-ok";
  writeMergeRecord(runDir, issue, pr, headSha, integrity.display); // FAFF-397
  // FAFF-383: path (a) — the clean-success tail; branch-delete observes iff this invocation's own
  // merge-args carried --delete-branch (parsedMerge.flags, not the raw --merge-args string).
  observeMergeEffects(runDir, issue, mergeEffectsFor(pr, parsedMerge.flags.includes("--delete-branch"), headRefName));
  return emit(result, 0);
}

function cmdBranchProtectionCheck(args) {
  if (args.includes("--selftest")) return branchProtectionSelftest();
  const json = args.includes("--json");
  const repo = ghRepoSlug(adrFlag(args, "--repo"));
  if (!repo) { process.stderr.write("faff branch-protection-check: cannot resolve repo slug (gh repo view failed)\n"); return 2; }
  let branch = adrFlag(args, "--branch");
  if (!branch) {
    const dv = ghJson(["repo", "view", "--json", "defaultBranchRef"]);
    branch = dv.ok && dv.data && dv.data.defaultBranchRef ? dv.data.defaultBranchRef.name : "main";
  }
  const r = spawnSync("gh", ["api", `repos/${repo}/branches/${branch}/protection`], { encoding: "utf8", timeout: 60000 });
  let probe;
  if (r.error) probe = { ok: false, basis: `gh unavailable: ${r.error.message}` };
  else if (r.status === 0) {
    let contexts = [];
    try { const p = JSON.parse(r.stdout); contexts = (p.required_status_checks && p.required_status_checks.contexts) || []; } catch {}
    probe = { ok: true, protected: true, required_checks: contexts, basis: `gh api repos/${repo}/branches/${branch}/protection` };
  } else if (/404|Not Found|Branch not protected/i.test(r.stderr || "")) {
    probe = { ok: true, protected: false, basis: `no protection on ${branch}` };
  } else {
    probe = { ok: false, basis: `gh api error (${r.status}): ${(r.stderr || "").split("\n")[0]}` };
  }
  const st = classifyBranchProtection(probe);
  st.branch = branch; st.repo = repo;
  if (json) process.stdout.write(JSON.stringify(st) + "\n");
  else console.log(`${st.status} (basis: ${st.basis})${st.required_checks.length ? ` — required: ${st.required_checks.join(", ")}` : ""}`);
  return st.status === "protected" ? 0 : 1;
}

// In-memory selftest: drives the PURE cores (decideFloor via classifyHeadShaChecks + parseMergeArgs
// + classifyBranchProtection) with NO network. The impure gh/git path is covered by the integration
// smoke test in the spec, not here (parity with container-check's pure-only selftest).
function mergeGateSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };
  const F = (o) => decideFloor({ ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "needs-human", ...o });
  check("all-green → merge-ok", F({}).verdict === "merge-ok");
  check("ci-red → refuse", F({ ci_state: "ci-red" }).verdict === "refuse");
  check("no-ci-coverage → refuse (default)", F({ ci_state: "no-ci-coverage" }).verdict === "refuse");
  check("no-ci-coverage + allow → merge-ok", F({ ci_state: "no-ci-coverage", no_ci_policy: "allow" }).verdict === "merge-ok");
  check("head-sha-mismatch → refuse", F({ head_sha_matches: false }).verdict === "refuse");
  check("indeterminate → refuse", F({ ci_state: "indeterminate" }).verdict === "refuse");
  check("absent review block → refuse", F({ review_verdict: "missing" }).verdict === "refuse");
  check("unavailable review verdict → refuse, never merge-ok (FAFF-405)", F({ review_verdict: "unavailable" }).verdict === "refuse");
  check("L4 holdout meets-spec → merge-ok", F({ level: "L4", holdout: "meets-spec" }).verdict === "merge-ok");
  check("L4 holdout missing → refuse", F({ level: "L4", holdout: "missing" }).verdict === "refuse");
  check("L4 holdout blocked → refuse", F({ level: "L4", holdout: "blocked" }).verdict === "refuse");
  // holdoutIsFresh (FAFF-420): pure freshness comparator readHoldout wraps around the run-scoped read
  check("holdoutIsFresh: fresh (holdout after checkpoint) → true", holdoutIsFresh(200, 100) === true);
  check("holdoutIsFresh: stale (holdout before checkpoint) → false", holdoutIsFresh(50, 100) === false);
  check("holdoutIsFresh: equal timestamps (not strictly after) → false", holdoutIsFresh(100, 100) === false);
  check("holdoutIsFresh: non-finite holdout mtime → false", holdoutIsFresh(NaN, 100) === false);
  check("holdoutIsFresh: non-finite checkpoint time → false", holdoutIsFresh(200, NaN) === false);
  check("holdoutIsFresh: both non-finite → false", holdoutIsFresh(NaN, NaN) === false);
  check("multi-blocker names all legs", F({ ac_complete: false, review_verdict: "fail" }).blockers.length === 2);
  // decideFloor integrity leg (FAFF-325): undefined (every pre-existing fixture above) is a no-op;
  // "violated" refuses at EVERY level, never level-graded; "unasserted-refuse" (the L4
  // defence-in-depth branch) refuses; "asserted"/"unasserted-ok" never block.
  check("integrity: undefined (unset) → no-op, all-green still merge-ok", F({}).verdict === "merge-ok");
  check("integrity: asserted → merge-ok", F({ integrity: "asserted" }).verdict === "merge-ok");
  check("integrity: unasserted-ok (L1-L3, no declaration) → merge-ok", F({ integrity: "unasserted-ok" }).verdict === "merge-ok");
  check("integrity: unasserted-refuse (L4 defence-in-depth) → refuse", F({ level: "L4", holdout: "meets-spec", integrity: "unasserted-refuse" }).verdict === "refuse");
  check("integrity: violated at L3 → refuse (violation is never level-graded)", F({ integrity: "violated" }).verdict === "refuse");
  check("integrity: violated at L4 → refuse too", F({ level: "L4", holdout: "meets-spec", integrity: "violated" }).verdict === "refuse");
  check("integrity: violated names the FAFF-325 blocker", /corrective-artifact integrity violated/.test(F({ integrity: "violated" }).blockers.join(" ")));
  check("integrity: unasserted-refuse names the FAFF-325 blocker", /unasserted at L4/.test(F({ level: "L4", holdout: "meets-spec", integrity: "unasserted-refuse" }).blockers.join(" ")));
  // resolveIntegrity (FAFF-325): pure-enough to drive with a synthetic fsq (no real /proc/1/environ
  // dependency) — proves the L4 branch is keyed on the SAME reconciled `level` as holdout, never a
  // second, divergent source, and that a violation basis always yields "violated" regardless of level.
  check("resolveIntegrity: no-declaration + L3 → unasserted-ok/unasserted", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L3");
      return r.state === "unasserted-ok" && r.display === "unasserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("resolveIntegrity: no-declaration + L4 → unasserted-refuse/unasserted (defence-in-depth)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L4");
      return r.state === "unasserted-refuse" && r.display === "unasserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // resolveGateLevel (FAFF-424): ledger governs when present; flag/default path unchanged when absent
  check("resolveGateLevel: L4 ledger, no flag → L4/no-mismatch", (() => { const r = resolveGateLevel("L4", null); return r.level === "L4" && r.mismatch === false; })());
  check("resolveGateLevel: L4 ledger, L3 flag → mismatch", (() => { const r = resolveGateLevel("L4", "L3"); return r.level === "L4" && r.mismatch === true; })());
  check("resolveGateLevel: L4 ledger, L4 flag → L4/no-mismatch", (() => { const r = resolveGateLevel("L4", "L4"); return r.level === "L4" && r.mismatch === false; })());
  check("resolveGateLevel: no ledger, L3 flag → L3/no-mismatch", (() => { const r = resolveGateLevel(null, "L3"); return r.level === "L3" && r.mismatch === false; })());
  check("resolveGateLevel: no ledger, no flag → L3 default", (() => { const r = resolveGateLevel(null, null); return r.level === "L3" && r.mismatch === false; })());
  check("resolveGateLevel: out-of-enum ledger level (pre-normalised null), L4 flag → L4", (() => { const r = resolveGateLevel(null, "L4"); return r.level === "L4" && r.mismatch === false; })());
  // classifyHeadShaChecks
  check("head checks: empty → no-ci-coverage", classifyHeadShaChecks([], null, 0) === "no-ci-coverage");
  check("head checks: all success → ci-green", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }], "success", 1) === "ci-green");
  check("head checks: a failure → ci-red", classifyHeadShaChecks([{ status: "completed", conclusion: "failure" }], null, 0) === "ci-red");
  check("head checks: pending → indeterminate", classifyHeadShaChecks([{ status: "in_progress", conclusion: null }], null, 0) === "indeterminate");
  check("head checks: unknown conclusion → ci-red (fail-closed)", classifyHeadShaChecks([{ status: "completed", conclusion: "weird" }], null, 0) === "ci-red");
  check("head checks: status failure → ci-red", classifyHeadShaChecks([], "failure", 1) === "ci-red");
  // FAFF-369: Actions-only repo — green check-run + GitHub's default empty legacy status {pending,0} → ci-green (not indeterminate)
  check("head checks: success + empty legacy {pending,count:0} → ci-green (FAFF-369)", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }], "pending", 0) === "ci-green");
  check("head checks: success + no legacy status at all → ci-green", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }], null, 0) === "ci-green");
  // FAFF-366: checks exist but all skipped/neutral (none executed green) → no-ci-coverage, not a vacuous ci-green (fail-open guard)
  check("head checks: all skipped → no-ci-coverage (FAFF-366)", classifyHeadShaChecks([{ status: "completed", conclusion: "skipped" }, { status: "completed", conclusion: "skipped" }], null, 0) === "no-ci-coverage");
  check("head checks: all neutral → no-ci-coverage (FAFF-366)", classifyHeadShaChecks([{ status: "completed", conclusion: "neutral" }], null, 0) === "no-ci-coverage");
  check("head checks: mixed success + skipped → ci-green (FAFF-366)", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }], null, 0) === "ci-green");
  // real legacy status still honoured when it genuinely exists (count>0)
  check("head checks: legacy pending with count>0 → indeterminate", classifyHeadShaChecks([], "pending", 2) === "indeterminate");
  // parseMergeArgs
  check("merge-args: allowed pass through", (() => { const p = parseMergeArgs("--squash --delete-branch"); return p.flags.length === 2 && p.rejected.length === 0; })());
  check("merge-args: unknown token rejected", parseMergeArgs("--squash; rm -rf /").rejected.length > 0);
  check("merge-args: empty → nothing", (() => { const p = parseMergeArgs(""); return p.flags.length === 0 && p.rejected.length === 0; })());
  // FAFF-375: --admin is no longer in the allowlist — it lands in rejected (exit-2 path)
  check("merge-args: --admin rejected (FAFF-375)", (() => { const p = parseMergeArgs("--admin"); return p.rejected.includes("--admin") && p.flags.length === 0; })());
  check("merge-args: --squash --admin → --squash passes, --admin rejected", (() => { const p = parseMergeArgs("--squash --admin"); return p.flags.includes("--squash") && p.rejected.includes("--admin"); })());
  // fenceHumanFlags (FAFF-375): human-only flags fenced on a genuine interactivity signal (TTY + --interactive)
  const fence = (o) => fenceHumanFlags({ human_override: false, allow_no_ci: false, interactive: false, stdin_is_tty: false, ...o });
  check("fence: --human-override + non-TTY → violation", !fence({ human_override: true, interactive: true }).ok);
  check("fence: --human-override + TTY + no --interactive → violation", !fence({ human_override: true, stdin_is_tty: true }).ok);
  check("fence: --human-override + TTY + --interactive → ok", fence({ human_override: true, interactive: true, stdin_is_tty: true }).ok);
  check("fence: --allow-no-ci + non-TTY → violation", !fence({ allow_no_ci: true, interactive: true }).ok);
  check("fence: --allow-no-ci + TTY + no --interactive → violation", !fence({ allow_no_ci: true, stdin_is_tty: true }).ok);
  check("fence: --allow-no-ci + TTY + --interactive → ok", fence({ allow_no_ci: true, interactive: true, stdin_is_tty: true }).ok);
  check("fence: neither human-only flag + non-TTY → ok (ordinary autonomous path untouched)", fence({}).ok);
  check("fence: non-TTY names the real-terminal remedy", /real terminal/.test(fence({ human_override: true, interactive: true }).violations.join(" ")));
  // classifyCiObservation (FAFF-376): primary check-runs signal is required; legacy status is an optional supplement
  check("ci-obs: both APIs down → indeterminate + reason", (() => { const r = classifyCiObservation(false, [], false, null, 0); return r.ci_state === "indeterminate" && !!r.api_degraded_reason; })());
  check("ci-obs: check-runs down + legacy success(n>0) → indeterminate (FAFF-376)", classifyCiObservation(false, [], true, "success", 1).ci_state === "indeterminate");
  check("ci-obs: check-runs down + legacy failure(n>0) → indeterminate (uniform severity)", classifyCiObservation(false, [], true, "failure", 1).ci_state === "indeterminate");
  check("ci-obs: check-runs ok(empty) + legacy API down → no-ci-coverage (classification proceeds)", (() => { const r = classifyCiObservation(true, [], false, null, 0); return r.ci_state === "no-ci-coverage" && r.api_degraded_reason === null; })());
  check("ci-obs: check-runs ok(success) + legacy API down → ci-green (supplement optional)", classifyCiObservation(true, [{ status: "completed", conclusion: "success" }], false, null, 0).ci_state === "ci-green");
  check("ci-obs: check-runs ok(success) + legacy success → ci-green (delegation intact)", classifyCiObservation(true, [{ status: "completed", conclusion: "success" }], true, "success", 1).ci_state === "ci-green");
  // classifyMergeFailure (FAFF-376): every kind is a refusal, no success branch
  check("merge-fail: pin-mismatch → head-drift names observed sha", (() => { const r = classifyMergeFailure("failed to merge PR: Head branch was modified. Review and try the merge again.", "abc1234"); return r.kind === "head-drift" && r.blocker.includes("abc1234"); })());
  check("merge-fail: camelCase expectedHeadOid → head-drift", (() => { const r = classifyMergeFailure("GraphQL: expectedHeadOid abcd does not match head", "abc1234"); return r.kind === "head-drift"; })());
  check("merge-fail: 'head ref was modified' → head-drift", (() => { const r = classifyMergeFailure("pull request head ref was modified; review and try the merge again", "abc1234"); return r.kind === "head-drift"; })());
  check("merge-fail: unknown flag → pin-unsupported says upgrade gh", (() => { const r = classifyMergeFailure("unknown flag: --match-head-commit", "abc1234"); return r.kind === "pin-unsupported" && /upgrade gh/i.test(r.blocker); })());
  check("merge-fail: unrelated stderr → generic embeds it verbatim", (() => { const r = classifyMergeFailure("failed to merge: merge conflict between base and head", "abc1234"); return r.kind === "generic" && r.blocker.includes("merge conflict between base and head"); })());
  check("merge-fail: empty stderr → generic 'non-zero exit'", (() => { const r = classifyMergeFailure("", "abc1234"); return r.kind === "generic" && /non-zero exit/.test(r.blocker); })());
  // classifyPostMerge (FAFF-365): the merged-vs-refuse decision on a NON-ZERO gh pr merge exit is a
  // pure function of (merge exit, re-read PR state) — PR state is authoritative over the exit code.
  check("post-merge: merge_ok=true → merged, no warning/blocker", (() => { const r = classifyPostMerge({ merge_ok: true, post_state: null, merge_stderr: "" }); return r.merged === true && r.outcome === "merged" && r.warning === null && r.blocker === null; })());
  check("post-merge: non-zero exit + re-read MERGED → merged with a warning, no blocker", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "MERGED", merge_stderr: "fatal: 'main' is already checked out" }); return r.merged === true && r.outcome === "merged" && r.blocker === null && /post-merge step failed/.test(r.warning) && r.warning.includes("already checked out"); })());
  check("post-merge: non-zero exit + re-read OPEN → refuse, no warning", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "OPEN", merge_stderr: "some error" }); return r.merged === false && r.outcome === "refuse" && r.warning === null && /some error/.test(r.blocker); })());
  check("post-merge: non-zero exit + re-read CLOSED → refuse", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "CLOSED", merge_stderr: "some error" }); return r.merged === false && r.outcome === "refuse"; })());
  check("post-merge: non-zero exit + unreadable re-read (null) → refuse (fail-closed), blocker notes the re-read failure", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: null, merge_stderr: "some error" }); return r.merged === false && r.outcome === "refuse" && /post-merge state re-read failed/.test(r.blocker); })());
  check("post-merge: multi-line stderr collapses to one line in the warning (adversarial review finding)", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "MERGED", merge_stderr: "line one\nline two\r\nline three" }); return !/[\r\n]/.test(r.warning) && r.warning.includes("line one line two line three"); })());
  check("post-merge: post_state=undefined is NOT treated as unreadable (strict === null, not == null)", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: undefined, merge_stderr: "some error" }); return r.outcome === "refuse" && !/post-merge state re-read failed/.test(r.blocker); })());
  // writeMergeRecord / mergeRecordPath (FAFF-397): the additive floor artifact `faff reconcile`
  // re-reads at run-end — written under <run-dir>/<issue>/merge-record.json on every merge-ok path.
  check("mergeRecordPath: <run-dir>/<issue>/merge-record.json", mergeRecordPath("/r/run-1", "FAFF-397") === path.join("/r/run-1", "FAFF-397", "merge-record.json"));
  check("writeMergeRecord: writes {pr,head_sha,merged,merged_at} to the resolved path", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-397", 42, "abc123");
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-397"), "utf8"));
      return record.pr === 42 && record.head_sha === "abc123" && record.merged === true && typeof record.merged_at === "string";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // writeMergeRecord (FAFF-325): the merge record ALWAYS carries the integrity annotation — an
  // omitted `integrity` arg defaults to "unasserted" (never silently absent), and an explicit
  // value is persisted verbatim.
  check("writeMergeRecord: integrity defaults to 'unasserted' when omitted", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc");
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return record.integrity === "unasserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("writeMergeRecord: an explicit integrity value is persisted verbatim", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc", "violated");
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return record.integrity === "violated";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // mergeEffectsFor / observeMergeEffects (FAFF-383): the merge chokepoint's mechanical-observe
  // side of the effects ledger — pure descriptor construction + the ledger-append integration.
  check("mergeEffectsFor: merge only, no delete-branch → one merge descriptor", (() => {
    const e = mergeEffectsFor(7, false, "some-branch");
    return e.length === 1 && e[0].kind === "merge" && e[0].target === "pr:7" && e[0].reversible === true;
  })());
  check("mergeEffectsFor: delete-branch requested + headRefName known → merge + branch-delete", (() => {
    const e = mergeEffectsFor(7, true, "faff-7-x");
    return e.length === 2 && e[1].kind === "branch-delete" && e[1].target === "faff-7-x" && e[1].reversible === true;
  })());
  check("mergeEffectsFor: delete-branch requested but headRefName unknown → merge only (no crash, no null target)", (() => {
    const e = mergeEffectsFor(7, true, null);
    return e.length === 1 && e[0].kind === "merge";
  })());
  check("observeMergeEffects: appends an observe record covering (issue, step=merge) that check() reads as covered", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-observe-"));
    try {
      appendEffectEntries(tmp, "declare", "FAFF-9", "merge", [{ kind: "merge", target: "pr:9" }]);
      observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9, false, null));
      const lines = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      return lines.length === 2 && lines[1].kind_of_entry === "observe" && lines[1].effect.target === "pr:9";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("observeMergeEffects: an unwritable run dir never throws AND emits the stderr warning (adversarial review: a prior version of this test only checked no-throw, which would still pass under a silent double-swallow)", (() => {
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = (chunk) => { captured += chunk; return true; };
    let threw = false;
    try { observeMergeEffects("/nonexistent/definitely-not-a-real-path", "FAFF-9", mergeEffectsFor(9, false, null)); }
    catch (e) { threw = true; }
    finally { process.stderr.write = origWrite; }
    return !threw && /effects ledger observe failed/.test(captured);
  })());
  check("observeMergeEffects: an uncovered effect emits exactly the documented stderr warning (adversarial review: assert the actual warning text, not just its absence of a throw)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-observe-warn-"));
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = (chunk) => { captured += chunk; return true; };
    try { observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9, false, null)); }
    finally { process.stderr.write = origWrite; fs.rmSync(tmp, { recursive: true, force: true }); }
    return /observed merge pr:9 with no covering declaration — declare it at graft Step 10/.test(captured);
  })());
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (merge-gate pure cores, ${fail} failed)`);
  return fail ? 1 : 0;
}

function branchProtectionSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };
  check("reachable + protected → protected", classifyBranchProtection({ ok: true, protected: true, required_checks: ["validate"] }).status === "protected");
  check("protected carries required_checks", classifyBranchProtection({ ok: true, protected: true, required_checks: ["validate"] }).required_checks.length === 1);
  check("reachable + not protected → unprotected", classifyBranchProtection({ ok: true, protected: false }).status === "unprotected");
  check("unreachable → indeterminate", classifyBranchProtection({ ok: false, basis: "gh outage" }).status === "indeterminate");
  check("null probe → indeterminate", classifyBranchProtection(null).status === "indeterminate");
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (branch-protection pure classifier, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { MERGE_FLAG_ALLOW, branchProtectionSelftest, classifyBranchProtection, classifyCiObservation, classifyHeadShaChecks, classifyMergeFailure, classifyPostMerge, cmdBranchProtectionCheck, cmdMergeGate, fenceHumanFlags, ghJson, ghRepoSlug, holdoutIsFresh, laneBoundaryPromisesCage, mergeEffectsFor, mergeGateSelftest, mergeRecordPath, observeCi, observeMergeEffects, parseMergeArgs, readAcComplete, readHoldout, readReviewVerdict, resolveIntegrity, warnUncoveredMergeObserves, writeMergeRecord };
