// ===========================================================================
// === region:factory — merge-gate-classify — FAFF-1391: the pure merge-gate classifiers (merge flags, human-flag fence, CI, merge failure, branch protection, GitHub auth) ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged. Every function here is pure: no gh, git or fs.

const { decideFloor } = require("./contract-defs");

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

// FAFF-537: the methods-only subset of MERGE_FLAG_ALLOW — the mutually-exclusive `gh pr merge`
// strategy flags. A bare top-level --squash/--merge/--rebase (the natural gh-shaped form an operator
// reaches for) is folded into the resolved flag set so it is never silently dropped; the modifiers
// (--delete-branch/--auto) are deliberately NOT harvested from argv — a bare modifier is not the
// reported friction and gh requires none, so widening the bare surface only adds blast radius.
const MERGE_METHOD_FLAGS = new Set(["--squash", "--merge", "--rebase"]);

// PURE (FAFF-537): resolve the effective merge flags from BOTH sources — the --merge-args value (via
// the unchanged parseMergeArgs) and any bare MERGE_METHOD_FLAGS token on argv — de-duplicated,
// order-stable (the --merge-args flags first, then bare additions). Reports method presence/conflict
// so cmdMergeGate can fail loud on zero or >1 distinct methods instead of letting a bare flag
// evaporate and gh reject with its cryptic generic message. Depends only on (args, mergeArgsRaw); no I/O.
function resolveMergeFlags(args, mergeArgsRaw) {
  const parsed = parseMergeArgs(mergeArgsRaw);
  const flags = [...parsed.flags];
  for (const t of (args || [])) {
    if (MERGE_METHOD_FLAGS.has(t) && !flags.includes(t)) flags.push(t);
  }
  const methods = [...new Set(flags.filter((f) => MERGE_METHOD_FLAGS.has(f)))];
  return { parsed, flags, rejected: parsed.rejected, methods, conflict: methods.length > 1, method_present: methods.length >= 1 };
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
  // FAFF-673: a human non-graft override must carry a justification — the reason is the explainable
  // record `faff audit` reconciles, so an override with no reason is a loud caller error (exit 2),
  // never a silent unexplained merge. Required whenever --human-override is present, on both paths.
  if (i.human_override && (i.override_reason === undefined || i.override_reason === null || String(i.override_reason).trim() === "")) {
    violations.push('--human-override requires --override-reason "<what merged + why no floor applies>"');
  }
  // FAFF-912: --accept-review-unavailable gets the SAME human-only fence as --human-override
  // (real TTY + --interactive + a non-empty reason) — it is still a human overriding a floor leg,
  // just a narrower one. Plus a mutual-exclusion check: the two flags write different audit
  // records at different scopes, so passing both is an ambiguous invocation, fenced loud rather
  // than silently resolved by precedence.
  if (i.accept_review_unavailable && !i.stdin_is_tty) violations.push(`--accept-review-unavailable is human-only: stdin is not a TTY — ${remedy}`);
  if (i.accept_review_unavailable && !i.interactive) violations.push("--accept-review-unavailable requires --interactive");
  if (i.accept_review_unavailable && (i.override_reason === undefined || i.override_reason === null || String(i.override_reason).trim() === "")) {
    violations.push('--accept-review-unavailable requires --override-reason "<what merged + why the review outage is acceptable>"');
  }
  if (i.human_override && i.accept_review_unavailable) {
    violations.push("--human-override and --accept-review-unavailable are mutually exclusive — choose the blanket override or the narrow review-unavailable accept");
  }
  return { ok: violations.length === 0, violations };
}

// FAFF-673: the NON-GRAFT floor signature — a refuse whose ONLY unmet legs are "no AC checklist"
// AND "no review verdict" is a change that never came through /faff-graft (a spike's findings, a
// docs capture, a one-line fix), not a graft change awaiting review/CI. Keyed on the SAME floor
// inputs decideFloor already saw — never re-derived, and decideFloor stays provenance-blind. A
// graft floor (review_verdict "fail"/"pass", or ac_complete true) never matches this key.
function nonGraftFloorSignature(floor) {
  return floor.ac_complete === false && floor.review_verdict === "missing";
}

// FAFF-912: the narrow-accept predicate — true iff the ONLY thing keeping the floor from merge-ok
// is the review-unavailable leg. Computed STRUCTURALLY by re-deciding the pure floor (decideFloor,
// unmodified) with review_verdict forced to "pass" and requiring the remaining blocker set to be
// empty — never by string-matching the blockers array, which would couple this gate to blocker
// prose. `fail` / `needs-human` / `missing` review verdicts all fail the first conjunct: this
// disposition accepts a review OUTAGE, never an absent or adverse review.
function narrowReviewUnavailableExcusable(floor) {
  return floor.review_verdict === "unavailable"
    && decideFloor({ ...floor, review_verdict: "pass" }).blockers.length === 0;
}

// FAFF-673: the human-merge remedy named beside the blockers ON THE NON-GRAFT SIGNATURE ONLY.
// Names the sanctioned declare-then-merge path so the reader is not left inferring it; a bare raw
// `gh pr merge` is never the sanctioned path (it leaves no observe / no merge-record — invisible).
const NON_GRAFT_REMEDY_STRING = "this change has no graft origin (no ACs, no review). If it is a legitimate non-graft change (a spike's findings, a docs capture, a one-line fix), landing it is a human action, not an autonomous one: declare the merge effect (faff effects declare --run <run> --issue <issue> --step merge) then merge it yourself with faff merge-gate … --human-override --interactive --override-reason \"<what merged + why no floor applies>\". The declaration and the reason are the explainable record faff audit reconciles.";

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

// PURE (FAFF-503): extract required-status-check contexts from an effective-rules payload
// (`gh api repos/{repo}/rules/branches/{branch}` — the documented union of classic protection +
// rulesets). Operates on an already-fetched array; no network. `protected` is defined precisely as
// "a required_status_checks rule applies" — the rule's presence is the signal, even with an empty
// contexts list (a well-formed, if unusual, ruleset the probe does not second-guess).
// `code_owner_review` (FAFF-1278) reads `require_code_owner_review` from the pull_request rule(s):
// true when any applying rule requires it, false when none does, null when no pull_request rule applies.
function extractRequiredChecks(rules) {
  if (!Array.isArray(rules)) return { protected: false, required_checks: [], code_owner_review: null }; // defensive; caller guarantees array
  const prRules = rules.filter((r) => r && r.type === "pull_request");
  const code_owner_review = prRules.length ? prRules.some((r) => !!(r.parameters && r.parameters.require_code_owner_review === true)) : null;
  const rsc = rules.find((r) => r && r.type === "required_status_checks");
  if (!rsc) return { protected: false, required_checks: [], code_owner_review };
  const raw = (rsc.parameters && rsc.parameters.required_status_checks) || [];
  const contexts = raw.filter((c) => c && typeof c.context === "string" && c.context.length > 0).map((c) => c.context);
  return { protected: true, required_checks: contexts, code_owner_review };
}

// PURE: the probe result → BranchProtectionState. ok:true + protected → protected;
// ok:true + not-protected → unprotected; ok:false (unreachable/404/unparseable) → indeterminate
// (fail-closed, warns). Unchanged across FAFF-503 — only how the probe is built moved to the
// effective-rules endpoint.
function classifyBranchProtection(probe) {
  if (!probe || !probe.ok) return { status: "indeterminate", required_checks: [], basis: (probe && probe.basis) || "gh api unreachable" };
  if (probe.protected) return { status: "protected", required_checks: probe.required_checks || [], basis: probe.basis || "branch protection present" };
  return { status: "unprotected", required_checks: [], basis: probe.basis || "no branch protection" };
}

// FAFF-728: PURE classifier for the run-start GitHub-auth preflight. Maps a raw `gh api user`
// spawnSync result — { error, status, stdout, stderr } — onto the closed GithubAuthStatus record
// { status ∈ authed|auth-failed|indeterminate, basis, login }. Deliberately fail-OPEN: only a
// credential the API actually rejected is `auth-failed` ("re-auth"); a missing `gh`, a network
// error, or any non-auth failure is `indeterminate` (advisory, never a re-auth claim). Keys on the
// HTTP status code (401/403) first, treats stderr string matching as a secondary signal, and never
// echoes stdout on a failure path — the token value never appears in `basis` (gh's auth-failure
// stderr reports "Bad credentials" / the HTTP status, not the token).
function classifyGithubAuth(r) {
  if (r && r.error) {
    const msg = typeof r.error === "string" ? r.error : (r.error.message || String(r.error));
    return { status: "indeterminate", basis: `gh unavailable: ${msg}`, login: null };
  }
  if (r && r.status === 0) {
    let data;
    try { data = JSON.parse(r.stdout); } catch { data = null; }
    if (data && typeof data.login === "string" && data.login) {
      return { status: "authed", basis: "gh api user ok", login: data.login };
    }
    return { status: "indeterminate", basis: "gh api user returned unparseable body", login: null };
  }
  const stderr = String((r && r.stderr) || "");
  const firstLine = stderr.split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  const status = r ? r.status : null;
  // Key on the HTTP status FIRST (401/403), then on specific credential-rejection phrases. A bare
  // `authentication` substring is deliberately NOT matched — it false-positives on non-auth
  // network/infra faults that merely mention the word (a proxy "407 Proxy Authentication Required",
  // an "authentication service unavailable" 5xx), which the DoD requires stay `indeterminate` (never
  // a re-auth claim). Every genuine GitHub auth failure carries a 401/403 or one of these phrases.
  if (/\b(401|403)\b|bad credentials|not logged in|requires authentication/i.test(stderr)) {
    return { status: "auth-failed", basis: `gh api user rejected credential: ${firstLine}`, login: null };
  }
  return { status: "indeterminate", basis: `gh api error (${status}): ${firstLine}`, login: null };
}

module.exports = { MERGE_FLAG_ALLOW, parseMergeArgs, MERGE_METHOD_FLAGS, resolveMergeFlags, fenceHumanFlags, nonGraftFloorSignature, narrowReviewUnavailableExcusable, NON_GRAFT_REMEDY_STRING, classifyHeadShaChecks, classifyCiObservation, classifyMergeFailure, classifyPostMerge, extractRequiredChecks, classifyBranchProtection, classifyGithubAuth };
