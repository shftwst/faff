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
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
// Bare gh-shaped merge-method/option flags (MERGE_FLAG_ALLOW) are accepted at the top level —
// resolveMergeFlags honours the method ones (--squash/--merge/--rebase); the rest ride --merge-args.
// They MUST be declared here or a live `faff merge-gate … --squash` would be rejected as unknown.
const MERGE_GATE_SPEC = { flags: {
  "--allow-no-ci": { arity: 0 }, "--check-only": { arity: 0 }, "--execute": { arity: 0 }, "--human-override": { arity: 0 },
  "--interactive": { arity: 0 }, "--json": { arity: 0 }, "--local": { arity: 0 }, "--selftest": { arity: 0 },
  "--squash": { arity: 0 }, "--merge": { arity: 0 }, "--rebase": { arity: 0 }, "--delete-branch": { arity: 0 }, "--auto": { arity: 0 },
  "--base": { arity: 1 }, "--branch": { arity: 1 }, "--issue": { arity: 1 }, "--level": { arity: 1 },
  "--merge-args": { arity: 1, greedy: true }, "--pr": { arity: 1 }, "--repo": { arity: 1 }, "--run-dir": { arity: 1 },
  // FAFF-673: the justification a human non-graft merge records on merge-gate-override.json —
  // required whenever --human-override is present (fenceHumanFlags), so no override lands unexplained.
  "--override-reason": { arity: 1 },
  // FAFF-912: the narrow, audited "operator accepts a review-unavailable outage" disposition —
  // a scalpel beside --human-override's hammer. Reuses --override-reason and --interactive; fenced
  // identically to --human-override in fenceHumanFlags, plus mutual exclusion with it.
  "--accept-review-unavailable": { arity: 0 },
  // FAFF-784: the recorded custody verdict — required for a structurally-detected dispatched merge
  // (derived from lane-boundary.json, never a caller opt-out). Carried on both the PR path and
  // --local.
  "--custody-verdict": { arity: 1 }, "--custody-verdict-sha256": { arity: 1 },
} };

// FAFF-1391: the rest of the merge locus lives in sibling modules, each re-exported below so every
// existing `require("./merge-gate")` keeps working: merge-gate-classify (pure classifiers),
// merge-gate-gh (the single gh chokepoint), merge-gate-floor (the floor's inputs), merge-gate-effects
// (declare/observe and grant legs), merge-gate-local (--local), merge-gate-stack (FAFF-1077),
// merge-gate-pr-create and merge-gate-selftest. cmdMergeGate, the PR path's merge call site, stays here.
const { FLOOR_LEVELS, decideFloor, resolveGateLevel } = require("./contract-defs");
const { MERGE_FLAG_ALLOW, parseMergeArgs, MERGE_METHOD_FLAGS, resolveMergeFlags, fenceHumanFlags, nonGraftFloorSignature, narrowReviewUnavailableExcusable, NON_GRAFT_REMEDY_STRING, classifyHeadShaChecks, classifyCiObservation, classifyMergeFailure, classifyPostMerge, extractRequiredChecks, classifyBranchProtection, classifyGithubAuth } = require("./merge-gate-classify");
const { readRunnerGhConfig, resolveRunnerGhEnv, runGh, githubActorMatches, resolveRunnerIdentity, recordRunnerIdentity, ghJson, ghRepoSlug, cmdBranchProtectionCheck, cmdGithubAuthCheck, githubAuthSelftest, branchProtectionSelftest } = require("./merge-gate-gh");
const { gitRun, resolveAnchorLevel, anchorRefusal, alreadyMergedReconcile, observeCi, mergeRecordPath, writeMergeRecord, resolveIntegrity, buildMergeFloorDigestVerify, readAcComplete, readReviewVerdict, holdoutIsFresh, laneBoundaryPromisesCage, laneBoundaryDispatchState, evaluateCustody, readHoldout, readCanRun, readCaged, readLedgerSutEnvStood, resolveCanRun, resolveHoldoutLeg } = require("./merge-gate-floor");
const { mergeEffectsFor, warnUncoveredMergeObserves, observeMergeEffects, governanceRequiredSentinelPresent, repoSlugFromPrUrl, hasPullRequestRule, makeTrustContext, checkLeg, resolveCommissaireDecisionGrantDetail, resolvePrCreateGrantDetail, resolveBranchDeleteGrantDetail, resolveCommissaireDecisionGrant, resolvePrCreateGrant, resolveBranchDeleteGrant, legReport, runIsGoverned, andGrants, legCovered, mergeCoveredBySchema3Grant, prCreateCoveredBySchema3Grant } = require("./merge-gate-effects");
const { baseCheckedOutWorktree, gitRemoteEmpty, resolveLocalBase, gatesSignalToCiState, landBaseFfOnly, cmdMergeGateLocal } = require("./merge-gate-local");
const { readStackAnchor, classifyDependencyGate, boundedRebaseOntoMain, dependencyInterlock } = require("./merge-gate-stack");
const { cmdPrCreate } = require("./merge-gate-pr-create");
const { mergeGateSelftest } = require("./merge-gate-selftest");

function cmdMergeGate(args) {
  if (args.includes("--selftest")) return mergeGateSelftest();
  const parsed = parseArgs(args, MERGE_GATE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff merge-gate --pr N --issue ID --run-dir DIR [--level L] [--execute|--check-only] [--merge-args \"...\"] [--squash|--merge|--rebase] [--json]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const json = !!parsed.values["--json"];
  const local = !!parsed.values["--local"];
  const issue = get("--issue");
  const runDir = get("--run-dir");
  const flagLevel = get("--level");
  // FAFF-1013: --execute is the required affirmative for a merge, not a no-op alias for a default.
  // A merge is irreversible, so intent must be explicit: pass --execute to merge or --check-only
  // to preview. Both flags together is a caller bug, surfaced loudly before any gh call — never a
  // silent --check-only precedence, which would let a caller who asked to execute read exit 0
  // merge-ok off a run that merged nothing. Neither flag is likewise a caller bug: the merge no
  // longer happens by omission.
  if (args.includes("--execute") && args.includes("--check-only")) {
    process.stderr.write("faff merge-gate: --execute and --check-only are mutually exclusive\n");
    return 2;
  }
  if (!args.includes("--execute") && !args.includes("--check-only")) {
    process.stderr.write("faff merge-gate: pass --execute to merge or --check-only to preview\n");
    return 2;
  }
  const mode = args.includes("--check-only") ? "check-only" : "execute";
  const interactive = args.includes("--interactive");
  const humanOverride = args.includes("--human-override");
  const acceptReviewUnavailable = args.includes("--accept-review-unavailable"); // FAFF-912
  const overrideReason = get("--override-reason"); // FAFF-673: required with --human-override (fenceHumanFlags)
  const allowNoCi = args.includes("--allow-no-ci");
  const noCiPolicy = allowNoCi ? "allow" : "needs-human";
  const mergeArgsRaw = get("--merge-args") || "";

  // FAFF-526: --local is a git-only BRANCH of this same command, not a sibling verb — everything
  // below this block (the `gh`-sourced PR path) is untouched, and `--pr` is neither required nor
  // read in local mode. See cmdMergeGateLocal's header comment for the full rationale.
  if (local) {
    if (!issue || !runDir) { process.stderr.write("faff merge-gate --local: --issue and --run-dir are required\n"); return 2; }
    if (flagLevel != null && !FLOOR_LEVELS.includes(flagLevel)) { process.stderr.write(`faff merge-gate: --level ${JSON.stringify(flagLevel)} not in {${FLOOR_LEVELS.join(",")}}\n`); return 2; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) { process.stderr.write(`faff merge-gate: --issue ${JSON.stringify(issue)} is not a valid issue id\n`); return 2; }
    return cmdMergeGateLocal({
      issue, runDir, branchFlag: get("--branch"), baseFlag: get("--base"),
      flagLevel, mode, interactive, humanOverride, acceptReviewUnavailable, overrideReason, allowNoCi, noCiPolicy, mergeArgsRaw, json,
      custodyPathArg: get("--custody-verdict"), custodyShaArg: get("--custody-verdict-sha256"),
      cwd: process.cwd(),
    });
  }

  const pr = get("--pr");
  const repoFlag = get("--repo");

  if (!pr || !issue || !runDir) { process.stderr.write("faff merge-gate: --pr, --issue and --run-dir are required\n"); return 2; }
  if (flagLevel != null && !FLOOR_LEVELS.includes(flagLevel)) { process.stderr.write(`faff merge-gate: --level ${JSON.stringify(flagLevel)} not in {${FLOOR_LEVELS.join(",")}}\n`); return 2; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) { process.stderr.write(`faff merge-gate: --issue ${JSON.stringify(issue)} is not a valid issue id\n`); return 2; }
  // FAFF-690 (F1): the governing autonomy level is resolved from the committed anchor at the observed
  // PR head sha — NOT the live run-ledger.json (removed here). The anchor read needs the head sha, so
  // repo-slug + `gh pr view` are reordered up (below) to resolve BEFORE the level; resolveIntegrity
  // (keyed on level) is reordered to resolve AFTER it. The FAFF-424 --level mismatch guard is retained
  // but now guards a flag that contradicts the ANCHOR (not the live ledger).
  // FAFF-537: resolve the merge method from BOTH --merge-args and any bare top-level
  // --squash/--merge/--rebase, so the bare gh-shaped form is honoured rather than silently dropped.
  const resolved = resolveMergeFlags(args, mergeArgsRaw);
  if (resolved.rejected.length) { process.stderr.write(`faff merge-gate: unrecognised --merge-args token(s): ${resolved.rejected.join(", ")} (allowed: ${[...MERGE_FLAG_ALLOW].join(", ")})\n`); return 2; }
  if (resolved.conflict) { process.stderr.write(`faff merge-gate: conflicting merge methods ${resolved.methods.join(", ")} — pass exactly one of --squash/--merge/--rebase\n`); return 2; }

  // FAFF-375: fence the human-only flags on a genuine interactivity signal BEFORE any gh call —
  // a fenced flag from a non-interactive context is a caller bug, surfaced loudly (exit 2) rather
  // than silently ignored. Pre-network ordering also makes the refusal CLI-boundary-testable with
  // zero mocking (the spawned test child is non-TTY by construction).
  const fence = fenceHumanFlags({ human_override: humanOverride, accept_review_unavailable: acceptReviewUnavailable, override_reason: overrideReason, allow_no_ci: allowNoCi, interactive, stdin_is_tty: process.stdin.isTTY === true });
  if (!fence.ok) { for (const v of fence.violations) process.stderr.write(`faff merge-gate: ${v}\n`); return 2; }

  const emit = (res, status) => {
    if (json) process.stdout.write(JSON.stringify(res) + "\n");
    else {
      console.log(`${res.verdict}${res.merged ? " (merged)" : ""} — CI ${res.ci_state}, head ${res.head_sha || "?"}, integrity ${res.integrity || "unasserted"}`);
      for (const b of (res.blockers || [])) console.log(`  ✗ ${b}`);
      for (const w of (res.warnings || [])) console.log(`  ⚠ ${w}`);
      // FAFF-673: render the human-merge remedy (set on the non-graft-signature refuse) after the
      // blockers, the fenceHumanFlags/anchorRefusal shell-remedy precedent. --json carries it as the
      // `remedy` field automatically (the whole result object is serialised above).
      if (res.remedy) console.log(`  → ${res.remedy}`);
    }
    return status;
  };

  // FAFF-690 (F1): repo slug + `gh pr view` head sha resolve BEFORE the level (the anchor is pinned
  // to the head sha). Both refuse exit 2 on failure, unchanged.
  const cwd = process.cwd();
  const repo = ghRepoSlug(repoFlag);
  if (!repo) { process.stderr.write("faff merge-gate: cannot resolve repo slug (gh repo view failed)\n"); return 2; }
  // headRefName (FAFF-383): the branch-delete observe target, derived mechanically alongside the
  // identity fetch that already runs on every path — never a second gh call.
  const hv = ghJson(["pr", "view", String(pr), "--json", "headRefOid,headRefName,baseRefName,state,url"]);
  if (!hv.ok || !hv.data || !hv.data.headRefOid) { process.stderr.write(`faff merge-gate: cannot establish PR identity for #${pr}: ${hv.stderr}\n`); return 2; }
  // FAFF-1212: a governed run's legs need the PR's base (and, under --delete-branch, head) ref from this
  // same response; an ungoverned run never reads them for a leg, so its handling is unchanged.
  const missingLegField = !hv.data.baseRefName ? "baseRefName" : (resolved.flags.includes("--delete-branch") && !hv.data.headRefName ? "headRefName" : null);
  if (missingLegField && runIsGoverned(runDir)) { process.stderr.write(`faff merge-gate: cannot establish PR identity for #${pr}: response lacks ${missingLegField}\n`); return 2; }
  let headSha = hv.data.headRefOid; // FAFF-1087: reassigned below when the stacked-dependency interlock's bounded rebase advances D's head
  const headRefName = hv.data.headRefName || null;

  // FAFF-784: custody validation runs BEFORE the existing integrity/AC/review/CI/holdout/head-sha
  // gates (and before the already-MERGED branch below, so a custody refusal on an already-merged PR
  // still reports `merged:true` accurately — never an unqualified merge-ok). Structurally detected
  // from lane-boundary.json — no caller opt-out; covers check-only and execute alike (both reach
  // this point before mode branches).
  const custody = evaluateCustody(runDir, issue, get("--custody-verdict"), get("--custody-verdict-sha256"));
  if (custody.required && !custody.ok) {
    const merged = hv.data.state === "MERGED";
    return emit({
      verdict: "refuse", merged, blockers: [custody.reason],
      ci_state: merged ? "not-observed-already-merged" : "not-observed",
      head_sha: headSha, integrity: "unasserted",
      note: merged ? "already merged but custody not satisfied — no success evidence written" : undefined,
    }, 1);
  }

  // FAFF-690 (F1): resolve the governing level from the head-sha-pinned committed anchor. A non-ok
  // status (missing / malformed / unreadable) fails closed (exit 2) — NEVER a live-ledger fallback.
  const anchor = resolveAnchorLevel(cwd, repo, runDir, issue, headSha);
  if (anchor.status !== "ok") { process.stderr.write(anchorRefusal(runDir, issue, headSha, anchor.status)); return 2; }
  const ledgerLevel = anchor.level;
  // FAFF-424 (re-pointed to the anchor): an explicit --level may only AGREE with the committed anchor
  // level; a contradiction fails loud (exit 2) — never a silent downgrade, and never an operator
  // --level downgrade lever (the escape from a wrong anchor is re-anchoring, which produces committed
  // evidence, not a build-lane-writable flag).
  const { level, mismatch } = resolveGateLevel(ledgerLevel, flagLevel);
  if (mismatch) {
    process.stderr.write(`faff merge-gate: --level ${JSON.stringify(flagLevel)} contradicts the committed anchor level ${JSON.stringify(ledgerLevel)} at head ${headSha}; the anchor governs — drop --level or pass --level ${ledgerLevel}\n`);
    return 2;
  }

  // FAFF-325 / FAFF-690: resolveIntegrity is keyed on `level`, so it resolves AFTER the anchor level.
  // Computed once, reused on EVERY path below (already-merged reconcile, refuse, merge-ok) — the merge
  // record + ledger banner ALWAYS annotate the integrity basis, on every decision path.
  const mfDigestVerify = buildMergeFloorDigestVerify(runDir, issue, get("--custody-verdict"), get("--custody-verdict-sha256"));
  const cfg = require("./config").loadConfig(cwd)[0]; // FAFF-1072: for branch-6's unattended fact — the repo being merged, lazy require (file convention)
  const integrity = resolveIntegrity(runDir, issue, level, mfDigestVerify, cfg);

  // Idempotent: a PR a peer already merged is a no-op, never a double-merge (gateway → status
  // monotonicity). FAFF-690 (F3): but success evidence is now conditional on the RETROSPECTIVE floor
  // — an already-merged PR whose AC/review/(at-L4)holdout/integrity cannot be re-proven refuses (exit
  // 1) and writes no merge-record.json. Never spawns `gh pr merge` either way.
  if (hv.data.state === "MERGED") {
    return alreadyMergedReconcile(emit, runDir, issue, pr, headSha, level, integrity);
  }

  // FAFF-1077: the stacked-dependency merge-order interlock. ADDITIVE — it can only push the
  // dependency_gate blocker (the dependency's PR unmerged) or contribute the satisfied leg (the
  // dependency merged → rebase D onto the true main). It NEVER parks; the two owner-park outcomes
  // (dependency closed-unmerged, rebase conflict) ride out on result.dependency_park for the
  // owning layer (concurrency occupant / faff-graft Step 10 via the delivery-outcome vocabulary)
  // to enact. A missing stack anchor resolves not-applicable — byte-identical to today.
  const interlock = dependencyInterlock({ cwd, runDir, issue, headSha, mutate: mode === "execute" });
  if (interlock.failLoud) { process.stderr.write(interlock.failLoud); return 2; }
  if (interlock.headSha) headSha = interlock.headSha; // a successful rebase advanced D's head

  const ci = observeCi(repo, pr, headSha);
  const holdoutLeg = resolveHoldoutLeg(runDir, issue); // FAFF-1040: posture from run facts, not the L4 label
  // FAFF-1118: coattail close — a --delete-branch merge must carry a grant covering BOTH {merge}
  // and {branch-delete}. The shell ANDs the two independently-verified grants into the single
  // decision_grant field (decideFloor untouched). A non-delete merge resolves from the merge grant
  // alone, byte-for-byte the FAFF-1034 path.
  // FAFF-1212: the trust file is read from the repository the PR belongs to (its own url), never from the
  // separately resolved `repo`, which a fork checkout can point elsewhere.
  const trustCtx = makeTrustContext({ transport: "remote", repo_dir: cwd, repo_slug: repoSlugFromPrUrl(hv.data.url), base_ref: hv.data.baseRefName || "" });
  const mergeLeg = resolveCommissaireDecisionGrantDetail(runDir, issue, hv.data.baseRefName, trustCtx);
  const legChecks = resolved.flags.includes("--delete-branch")
    ? [mergeLeg, resolveBranchDeleteGrantDetail(runDir, issue, headRefName, trustCtx)]
    : [mergeLeg];
  const decisionGrant = andGrants(...legChecks.map((c) => c.state));
  const grantReport = legReport(legChecks);
  const floor = {
    ac_complete: readAcComplete(runDir, issue),
    review_verdict: readReviewVerdict(runDir, issue),
    ci_state: ci.ci_state,
    head_sha_matches: ci.head_sha_matches,
    level,
    holdout: holdoutLeg.holdout,
    holdout_posture: holdoutLeg.holdout_posture,
    holdout_missing: holdoutLeg.holdout_missing,
    holdout_fault: holdoutLeg.holdout_fault,
    no_ci_policy: noCiPolicy,
    integrity: integrity.state,
    decision_grant: decisionGrant,
    dependency_gate: interlock.gate,
  };
  const { verdict, blockers: floorBlockers } = decideFloor(floor);
  const blockers = [...floorBlockers, ...grantReport.blockers];
  const result = { verdict, blockers, merged: false, ci_state: ci.ci_state, head_sha: headSha, ci_detail: ci.detail, integrity: integrity.display, holdout_posture: holdoutLeg.holdout_posture, holdout_missing: holdoutLeg.holdout_missing, holdout_fault: holdoutLeg.holdout_fault, ...(grantReport.details.length ? { commissaire_grants: grantReport.details } : {}) };
  // FAFF-1077: surface the interlock's owner-park intent (never enacted here) and any transient
  // note so the owning layer can escalate a "leave pr-open" refuse to a park at the merge locus.
  if (interlock.park) { result.dependency_park = interlock.park; result.remedy = `park the dependent: ${interlock.park.cause}`; }
  if (interlock.note) result.dependency_note = interlock.note;

  if (verdict === "refuse") {
    if (interactive && acceptReviewUnavailable) {
      // FAFF-912: the narrow accept — evaluated ahead of the blanket override; the two are mutually
      // exclusive by fence, so ordering only decides which branch a single-flag invocation takes.
      if (narrowReviewUnavailableExcusable(floor)) {
        try {
          fs.mkdirSync(path.join(runDir, issue), { recursive: true });
          // FAFF-912: a DISTINCT source ("review-unavailable-accept") from the blanket override, so
          // `faff audit` and any override classifier never conflate a narrow outage-accept with a
          // blanket "overrode everything" record.
          fs.writeFileSync(path.join(runDir, issue, "merge-gate-override.json"), JSON.stringify({ pr, issue, head_sha: headSha, blockers, overridden_at: new Date().toISOString(), reason: overrideReason, source: "review-unavailable-accept" }, null, 2) + "\n");
        } catch (e) { process.stderr.write(`faff merge-gate: could not record review-unavailable accept: ${e.message}\n`); return 2; }
        // fall through to execute — the recorded narrow accept REPLACES the refusal.
      } else {
        // FAFF-912: the review isn't actually unavailable, or another leg is also unmet — REFUSE
        // without merging and WITHOUT escalating to a blanket override (that would silently widen
        // the operator's intent from "accept the outage" to "override everything").
        result.remedy = `--accept-review-unavailable only excuses a review-unavailable outage; this floor is unmet for other reasons: ${blockers.join(", ")}`;
        return emit(result, 1);
      }
    } else if (interactive && humanOverride) {
      try {
        fs.mkdirSync(path.join(runDir, issue), { recursive: true });
        // FAFF-673: the override record carries the justification (`reason`, fenced non-empty above)
        // + the `source:"human-override"` marker FAFF-698's classifier composes with — the explainable
        // record `faff audit` reconciles, never a justification-less write read by nothing (FAFF-375).
        fs.writeFileSync(path.join(runDir, issue, "merge-gate-override.json"), JSON.stringify({ pr, issue, head_sha: headSha, blockers, overridden_at: new Date().toISOString(), reason: overrideReason, source: "human-override" }, null, 2) + "\n");
      } catch (e) { process.stderr.write(`faff merge-gate: could not record human override: ${e.message}\n`); return 2; }
      // fall through to execute — the recorded human override REPLACES the autonomous refusal.
    } else {
      // FAFF-673: name the human-merge remedy beside the blockers, ONLY on the non-graft signature
      // (never on a graft change awaiting review/CI). Shell-level; decideFloor stays provenance-blind.
      if (nonGraftFloorSignature(floor)) result.remedy = NON_GRAFT_REMEDY_STRING;
      return emit(result, 1);
    }
  }
  if (mode === "check-only") return emit({ ...result, verdict: "merge-ok" }, 0);

  // Head pin (FAFF-376): --match-head-commit makes the forge itself refuse any merge whose live head no
  // longer equals `headSha` — the SAME variable CI was classified against (:observed sha). Gate-composed,
  // appended after resolved.flags so it rides EVERY executed merge (normal path and the human-override
  // fall-through alike); callers cannot supply it (parseMergeArgs rejects it → exit 2). --check-only and
  // the already-MERGED no-op never reach this spawn.
  // FAFF-537: emit merge-gate's OWN actionable no-method error here — on the about-to-merge path only
  // (check-only returned at :check-only, the already-MERGED no-op returned earlier) — BEFORE delegating
  // to gh, whose generic "--merge/--rebase/--squash required" message points at gh's requirement rather
  // than the real cause (the method never reached the resolved flag set).
  if (!resolved.method_present) {
    process.stderr.write(`faff merge-gate: no merge method — pass one via --merge-args "--squash" (or --merge/--rebase), or as a bare --squash/--merge/--rebase flag\n`);
    return 2;
  }
  const m = runGh(["pr", "merge", String(pr), ...resolved.flags, "--match-head-commit", headSha], { timeout: 120000 }); // FAFF-1213
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
      // FAFF-1034: suppress the schema:2 auto-declare/observe for a merge covered by a schema:3 grant
      // (the covered merge's schema:3 lineage is authoritative — single lineage, no double-count).
      if (!legCovered(mergeLeg)) observeMergeEffects(runDir, issue, mergeEffectsFor(pr, false, headRefName));
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
  // merge-args carried --delete-branch (resolved.flags, not the raw --merge-args string).
  // FAFF-1034: suppressed for a merge covered by a schema:3 grant (single schema:3 lineage).
  if (!legCovered(mergeLeg)) observeMergeEffects(runDir, issue, mergeEffectsFor(pr, resolved.flags.includes("--delete-branch"), headRefName));
  return emit(result, 0);
}

module.exports = { MERGE_FLAG_ALLOW, MERGE_METHOD_FLAGS, resolveMergeFlags, alreadyMergedReconcile, anchorRefusal, baseCheckedOutWorktree, boundedRebaseOntoMain, branchProtectionSelftest, classifyDependencyGate, dependencyInterlock, readStackAnchor, classifyBranchProtection, extractRequiredChecks, classifyCiObservation, classifyGithubAuth, classifyHeadShaChecks, classifyMergeFailure, classifyPostMerge, cmdBranchProtectionCheck, cmdGithubAuthCheck, cmdMergeGate, cmdMergeGateLocal, cmdPrCreate, evaluateCustody, fenceHumanFlags, gatesSignalToCiState, ghJson, ghRepoSlug, githubAuthSelftest, gitRemoteEmpty, gitRun, holdoutIsFresh, landBaseFfOnly, laneBoundaryDispatchState, laneBoundaryPromisesCage, mergeEffectsFor, mergeGateSelftest, mergeRecordPath, narrowReviewUnavailableExcusable, NON_GRAFT_REMEDY_STRING, nonGraftFloorSignature, observeCi, observeMergeEffects, parseMergeArgs, readAcComplete, readHoldout, readCanRun, readLedgerSutEnvStood, resolveCanRun, readCaged, resolveHoldoutLeg, readReviewVerdict, resolveAnchorLevel, resolveCommissaireDecisionGrant, resolvePrCreateGrant, resolveBranchDeleteGrant, resolveCommissaireDecisionGrantDetail, resolvePrCreateGrantDetail, resolveBranchDeleteGrantDetail, checkLeg, makeTrustContext, hasPullRequestRule, repoSlugFromPrUrl, legCovered, andGrants, governanceRequiredSentinelPresent, mergeCoveredBySchema3Grant, prCreateCoveredBySchema3Grant, resolveIntegrity, resolveLocalBase, warnUncoveredMergeObserves, writeMergeRecord, readRunnerGhConfig, resolveRunnerGhEnv, runGh, resolveRunnerIdentity, githubActorMatches, recordRunnerIdentity };
