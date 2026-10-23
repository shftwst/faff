// ===========================================================================
// === region:factory — merge-gate-local — FAFF-1391: the git-only `--local` branch of the merge locus (FAFF-526) ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged. gitRun lives in merge-gate-floor.js.

const fs = require("node:fs");
const path = require("node:path");
const { decideFloor, resolveGateLevel } = require("./contract-defs");
const { runLadder } = require("./gates");
const { parseWorktreeEntries } = require("./worktree-prune");
const { parseMergeArgs, fenceHumanFlags, nonGraftFloorSignature, narrowReviewUnavailableExcusable, NON_GRAFT_REMEDY_STRING } = require("./merge-gate-classify");
const { gitRun, resolveAnchorLevel, anchorRefusal, writeMergeRecord, resolveIntegrity, buildMergeFloorDigestVerify, readAcComplete, readReviewVerdict, evaluateCustody, resolveHoldoutLeg } = require("./merge-gate-floor");
const { makeTrustContext, resolveCommissaireDecisionGrantDetail, legReport } = require("./merge-gate-effects");

// ===========================================================================
// === FAFF-526: the git-only `--local` branch of the SAME merge locus. ====================
// A sibling condition, never a second command: it substitutes the CI-green floor leg with a
// FRESH `faff gates run` (gates.js's runLadder — the identical cost-ordered ladder graft's Step
// 7.5 trusts) on the exact branch tip about to land, and substitutes `gh pr merge` with a local
// ff-only `git update-ref` move of the base branch. decideFloor is reused VERBATIM — this only
// populates its floor inputs from local sources. Detected (remote-absence), never forced: a repo
// WITH a remote (or one whose remote-state can't be determined) self-refuses (exit 2), so
// `--local` can never be used to dodge real CI on a remote-backed repo. The internal `git
// update-ref` is a spawnSync CHILD PROCESS — not a Bash tool call — so it is structurally
// invisible to the merge-fence PreToolUse hook, exactly like the PR path's own `gh pr merge`
// (see the file header comment); no fence allowlisting is needed for the sanctioned merge itself.
// ===========================================================================


// FAFF-545 — pure detection helper: does a PEER worktree (not the invoking cwd) have `base`
// checked out? `entries` is the parseWorktreeEntries() shape ({ path, branch }, branch already
// stripped of refs/heads/, detached-HEAD entries have branch === null and never match). Case A
// (base checked out nowhere else) is the overwhelmingly common single-worktree layout; Case B
// (exactly one peer) is the worktree-aware land path; >1 match is anomalous (git normally
// prevents the same branch being checked out twice) and is treated as unsafe.
function baseCheckedOutWorktree(entries, base) {
  const matches = (entries || []).filter((e) => e && e.branch === base);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return { anomaly: true };
}

// Does this repo have a configured, pushable remote? `git remote` empty stdout => no remote
// (`--local` may activate / the fence matcher may activate). A git-command failure (not a repo,
// git unreachable) is INDETERMINATE (null) — every call site treats indeterminate as "NOT
// confirmed-empty", i.e. fails toward the existing PR path / fence-dormant, never toward
// silently activating a new merge/enforcement surface on a repo whose remote state is unreadable.
function gitRemoteEmpty(cwd) {
  const r = gitRun(cwd, ["remote"], 5000);
  if (r.status !== 0) return null;
  return r.stdout === "";
}

// Resolve the LOCAL base branch a feature merges into. An explicit --base wins outright;
// otherwise `main` if it exists locally, else `master`, else null (unresolvable — the caller
// refuses). Deliberately simple (spec §2 OUT OF SCOPE: no general ancestry/fork-point search) —
// git-only SUTs are single-session/sequential, so "the" long-lived branch is main-or-master.
// Shared verbatim with merge-fence.js's matchesRawLocalBaseMerge so the gate and the fence always
// name the same base branch for a given repo (spec §6 assumption).
function resolveLocalBase(cwd, explicitBase) {
  if (explicitBase) return explicitBase;
  for (const cand of ["main", "master"]) {
    const r = gitRun(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${cand}`], 5000);
    if (r.status === 0) return cand;
  }
  return null;
}

// PURE: map a `faff gates run` GatesOutcome onto floor.ci_state — the WHOLE CI-equivalent
// substitution (spec §3 WHAT table). `discovery === "none"` is checked FIRST and always maps to
// no-ci-coverage, regardless of runLadder's own gates.fallback-derived signal (which folds
// discovery:none into a bare "needs-human"/"pass" signal under its OWN advisory/fail-closed
// knob) — the git-only floor's no-CI-coverage leg must be governed by decideFloor's own
// `no_ci_policy` (merge-gate's --allow-no-ci), never silently double-gated by a second,
// divergent repo-level config knob. Any unrecognised/future signal also falls to the fail-closed
// no-ci-coverage leg rather than a fabricated green.
function gatesSignalToCiState(outcome) {
  if (!outcome || outcome.discovery === "none") return "no-ci-coverage";
  if (outcome.signal === "pass") return "ci-green";
  if (outcome.signal === "fail") return "ci-red";
  if (outcome.signal === "needs-human") return "indeterminate";
  return "no-ci-coverage";
}

// FAFF-875 — the shared ff-only base-advance primitive, extracted from `cmdMergeGateLocal`'s
// former inline land step (verbatim Cases A/B) so `faff prdr land --local` can reuse the exact
// same atomicity/safety machinery instead of forking it. Pure orchestration over `gitRun` —
// still impure (spawns git), but the ONE place either caller lands a ref onto `base`.
//
// Cases A/B are BYTE-FOR-BYTE the original inline logic (same order, same blocker strings via
// the default `retryHint`) — merge-gate --local's behaviour is unchanged (FAFF-875 AC #9).
// Case C is net-new: `merge-gate --local` deliberately never lands INTO its own invoking
// worktree (a feature branch is landed FROM a peer/bare ref, never by checking out `base`
// yourself mid-command) — `allowInPlace` stays false there, so Case C is dead code for that
// caller by construction, preserving the exact Case A resolution FAFF-545's regression test
// pins (`--local` invoked from the base worktree via a `--branch` override still lands via
// update-ref, never a self-merge). `faff prdr land --local` is the opposite shape — its normal
// git-only single-worktree flow always sits ON base (`faff prdr accept` switches back to it) —
// so it passes `allowInPlace: true` to land via an in-place `git merge --ff-only`, refreshing
// the invoking worktree's own index/working tree (a bare `update-ref` here would desync it —
// the exact phantom-staged-deletes bug Case B's peer-worktree guard exists to avoid, self-applied).
//
// Returns { ok: true, case: "A"|"B"|"C" } on a successful advance, or { ok: false, blocker }
// (a single human-readable reason) on any refusal — the caller folds `blocker` into its own
// `blockers` array and exits however it exits; this helper never writes to stdout/stderr itself.
function landBaseFfOnly({ cwd, base, tipSha, baseShaBefore, allowInPlace = false, retryHint = "faff merge-gate --local" }) {
  if (allowInPlace) {
    const selfBranch = gitRun(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (selfBranch.ok && selfBranch.stdout === base) {
      // Case C — base is checked out in the INVOKING worktree itself.
      const dirty = gitRun(cwd, ["status", "--porcelain"]);
      if (!dirty.ok) return { ok: false, blocker: `cannot check the invoking worktree for local changes — re-run ${retryHint}` };
      if (dirty.stdout !== "") return { ok: false, blocker: `base '${base}' has uncommitted changes in the invoking worktree — commit or stash them, then re-run ${retryHint} (refusing rather than overwrite)` };
      const mrg = gitRun(cwd, ["merge", "--ff-only", tipSha]);
      if (!mrg.ok) return { ok: false, blocker: `fast-forward of '${base}' in the invoking worktree failed: ${mrg.stderr || "git merge --ff-only rejected the fast-forward"}` };
      return { ok: true, case: "C" };
    }
  }

  // Cases A/B — verbatim FAFF-545 logic: enumerate worktrees, exclude the invoking cwd's own
  // entry BEFORE matching (the defensive filter the FAFF-545 review finding added), land via a
  // peer's `merge --ff-only` when base is checked out there, else a bare compare-and-swap
  // `update-ref` (Case A, the overwhelmingly common single-worktree layout).
  const entries = parseWorktreeEntries(cwd);
  if (entries === null) return { ok: false, blocker: `cannot enumerate git worktrees to land safely — re-run ${retryHint}` };
  const selfRoot = gitRun(cwd, ["rev-parse", "--show-toplevel"]);
  if (!selfRoot.ok) return { ok: false, blocker: `cannot resolve the invoking worktree's own root to land safely — re-run ${retryHint}` };
  const peerCandidates = entries.filter((e) => e && path.resolve(e.path || "") !== path.resolve(selfRoot.stdout));
  const peer = baseCheckedOutWorktree(peerCandidates, base);

  if (peer && peer.anomaly) return { ok: false, blocker: `base '${base}' is checked out in multiple worktrees — cannot land safely; reconcile the worktrees first` };

  if (peer) {
    // Case B — base checked out in exactly one CLEAN peer worktree.
    const dirty = gitRun(cwd, ["-C", peer.path, "status", "--porcelain"]);
    if (!dirty.ok) return { ok: false, blocker: `cannot check the peer worktree '${peer.path}' for local changes — re-run ${retryHint}` };
    if (dirty.stdout !== "") return { ok: false, blocker: `base '${base}' is checked out with uncommitted changes in ${peer.path} — commit or stash them, then re-run ${retryHint} (refusing rather than overwrite)` };
    const mrg = gitRun(cwd, ["-C", peer.path, "merge", "--ff-only", tipSha]);
    if (!mrg.ok) return { ok: false, blocker: `fast-forward of '${base}' in peer worktree ${peer.path} failed: ${mrg.stderr || "git merge --ff-only rejected the fast-forward"}` };
    return { ok: true, case: "B" };
  }

  // Case A — base checked out nowhere else. `--old-value` makes this a compare-and-swap — it
  // fails rather than clobbering a base that moved since baseShaBefore was read.
  const upd = gitRun(cwd, ["update-ref", `refs/heads/${base}`, tipSha, baseShaBefore]);
  if (!upd.ok) return { ok: false, blocker: `local base-branch update failed: ${upd.stderr || "git update-ref rejected the fast-forward"}` };
  return { ok: true, case: "A" };
}

async function cmdMergeGateLocal({ issue, runDir, branchFlag, baseFlag, flagLevel, mode, interactive, humanOverride, acceptReviewUnavailable, overrideReason, allowNoCi, noCiPolicy, mergeArgsRaw, json, custodyPathArg, custodyShaArg, cwd }) {
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

  // Step 1 (spec HOW pseudocode): bypass-guard, BEFORE any other work — detected-not-forced,
  // bypass-proof. `null` (indeterminate) is treated as "has a remote": never silently drop to an
  // un-CI'd local merge on a repo whose remote state couldn't be established.
  const remoteEmpty = gitRemoteEmpty(cwd);
  if (remoteEmpty !== true) {
    process.stderr.write("faff merge-gate --local: repo has a remote (or its remote-state is indeterminate) — use the PR path (faff merge-gate --pr)\n");
    return 2;
  }

  const parsedMerge = parseMergeArgs(mergeArgsRaw);
  if (parsedMerge.rejected.length) { process.stderr.write(`faff merge-gate: unrecognised --merge-args token(s): ${parsedMerge.rejected.join(", ")} (allowed: ${[...MERGE_FLAG_ALLOW].join(", ")})\n`); return 2; }

  const fence = fenceHumanFlags({ human_override: humanOverride, accept_review_unavailable: acceptReviewUnavailable, override_reason: overrideReason, allow_no_ci: allowNoCi, interactive, stdin_is_tty: process.stdin.isTTY === true });
  if (!fence.ok) { for (const v of fence.violations) process.stderr.write(`faff merge-gate: ${v}\n`); return 2; }

  // FAFF-690 (F1): resolve the branch BEFORE the level — the anchor is pinned to the branch head sha.
  const branch = branchFlag || (() => { const r = gitRun(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]); return r.ok ? r.stdout : null; })();
  if (!branch || branch === "HEAD") { process.stderr.write("faff merge-gate --local: cannot resolve the current branch (detached HEAD?) — pass --branch explicitly\n"); return 2; }
  const base = resolveLocalBase(cwd, baseFlag);
  if (!base) { process.stderr.write("faff merge-gate --local: cannot resolve a local base branch (no --base, and neither main nor master exists locally)\n"); return 2; }
  if (base === branch) { process.stderr.write(`faff merge-gate --local: branch and base are the same ref (${branch}) — nothing to merge\n`); return 2; }

  // FAFF-690 (F1): source the governing level from the committed anchor at the branch head sha via
  // `git show` on the LOCAL object store only (no forge / Contents-API fallback — this is the
  // no-remote path). Fail closed on a missing/malformed anchor (exit 2); the live run-ledger.json is
  // no longer a level source here either.
  const headShaBefore = gitRun(cwd, ["rev-parse", branch]).stdout;

  // FAFF-784: custody validation — the SAME gate + placement rationale as the PR path (see
  // cmdMergeGate): before the existing integrity/AC/review/CI/holdout gates, and before the
  // idempotent already-merged short-circuit below, so a custody refusal on an already-merged branch
  // still reports `merged:true` accurately. The local/git-only form carries the same custody
  // arguments — no separate opt-out for git-only mode.
  const custody = evaluateCustody(runDir, issue, custodyPathArg, custodyShaArg);
  if (custody.required && !custody.ok) {
    const merged = gitRun(cwd, ["merge-base", "--is-ancestor", branch, base]).ok;
    return emit({
      verdict: "refuse", merged, blockers: [custody.reason],
      ci_state: "n/a", head_sha: headShaBefore, integrity: "unasserted", warnings: [],
      note: merged ? "already merged but custody not satisfied — no success evidence written" : undefined,
    }, 1);
  }

  const anchor = resolveAnchorLevel(cwd, null, runDir, issue, headShaBefore);
  if (anchor.status !== "ok") { process.stderr.write(anchorRefusal(runDir, issue, headShaBefore, anchor.status)); return 2; }
  const ledgerLevel = anchor.level;
  const { level, mismatch } = resolveGateLevel(ledgerLevel, flagLevel);
  if (mismatch) {
    process.stderr.write(`faff merge-gate --local: --level ${JSON.stringify(flagLevel)} contradicts the committed anchor level ${JSON.stringify(ledgerLevel)} at ${branch} head ${headShaBefore}; the anchor governs — drop --level or pass --level ${ledgerLevel}\n`);
    return 2;
  }

  const mfDigestVerify = buildMergeFloorDigestVerify(runDir, issue, custodyPathArg, custodyShaArg);
  const cfg = require("./config").loadConfig(cwd)[0]; // FAFF-1072: for branch-6's unattended fact — the repo being merged, lazy require (file convention)
  const integrity = resolveIntegrity(runDir, issue, level, mfDigestVerify, cfg);

  // Idempotent: a peer/earlier invocation that already landed this branch is a no-op, never a
  // double-merge (gateway → status monotonicity; mirrors the PR path's already-MERGED short-circuit).
  if (gitRun(cwd, ["merge-base", "--is-ancestor", branch, base]).ok) {
    writeMergeRecord(runDir, issue, null, headShaBefore, integrity.display);
    return emit({ verdict: "merge-ok", merged: true, blockers: [], ci_state: "n/a", head_sha: headShaBefore, integrity: integrity.display, warnings: [], note: "already merged" }, 0);
  }

  // ff-only (spec §5 decision — rebase-first if the base moved; non-ff is out of scope).
  if (!gitRun(cwd, ["merge-base", "--is-ancestor", base, branch]).ok) {
    return emit({ verdict: "refuse", blockers: [`base branch '${base}' moved; rebase '${branch}' onto '${base}' first (ff-only local merge)`], merged: false, ci_state: "n/a", head_sha: headShaBefore, integrity: integrity.display, warnings: [] }, 1);
  }

  // Fresh CI-equivalent (spec: NEVER reuse graft's earlier Step-7.5 result — the gate observes
  // the CI-equivalent itself on the final head sha, mirroring the FAFF-350 keystone property).
  const gatesOutcome = await runLadder(cwd);
  const ci_state = gatesSignalToCiState(gatesOutcome);

  const holdoutLeg = resolveHoldoutLeg(runDir, issue); // FAFF-1040: posture from run facts, not the L4 label
  // FAFF-1212: the git-only path has no remote, so the trust file is read from the local base ref (never evidence).
  const mergeLeg = resolveCommissaireDecisionGrantDetail(runDir, issue, base, makeTrustContext({ transport: "local", repo_dir: cwd, base_ref: base }));
  const grantReport = legReport([mergeLeg]);
  const floor = {
    ac_complete: readAcComplete(runDir, issue),
    review_verdict: readReviewVerdict(runDir, issue),
    ci_state,
    head_sha_matches: true, // the gates just ran against this EXACT branch tip — no drift leg to model
    level,
    holdout: holdoutLeg.holdout,
    holdout_posture: holdoutLeg.holdout_posture,
    holdout_missing: holdoutLeg.holdout_missing,
    holdout_fault: holdoutLeg.holdout_fault,
    no_ci_policy: noCiPolicy,
    integrity: integrity.state,
    decision_grant: mergeLeg.state,
  };
  const { verdict, blockers: floorBlockers } = decideFloor(floor); // UNCHANGED pure core
  const blockers = [...floorBlockers, ...grantReport.blockers];
  const result = { verdict, blockers, merged: false, ci_state, head_sha: headShaBefore, integrity: integrity.display, warnings: [], holdout_posture: holdoutLeg.holdout_posture, holdout_missing: holdoutLeg.holdout_missing, holdout_fault: holdoutLeg.holdout_fault, ...(grantReport.details.length ? { commissaire_grants: grantReport.details } : {}) };

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
          fs.writeFileSync(path.join(runDir, issue, "merge-gate-override.json"), JSON.stringify({ issue, head_sha: headShaBefore, blockers, overridden_at: new Date().toISOString(), reason: overrideReason, source: "review-unavailable-accept" }, null, 2) + "\n");
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
        fs.writeFileSync(path.join(runDir, issue, "merge-gate-override.json"), JSON.stringify({ issue, head_sha: headShaBefore, blockers, overridden_at: new Date().toISOString(), reason: overrideReason, source: "human-override" }, null, 2) + "\n");
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

  // Re-assert the head sha is unchanged since the gates run (the local analogue of the PR path's
  // --match-head-commit head-pin) — refuse rather than land a merge the gates never actually ran against.
  const baseShaBefore = gitRun(cwd, ["rev-parse", base]).stdout;
  const headShaNow = gitRun(cwd, ["rev-parse", branch]).stdout;
  if (headShaNow !== headShaBefore) {
    result.verdict = "refuse";
    result.blockers = [...blockers, `branch head moved during the gate run (was ${headShaBefore}, now ${headShaNow}) — re-run faff merge-gate --local`];
    return emit(result, 1);
  }

  // Land it: move the base ref to the (fast-forwardable) branch tip. This is the ONE sanctioned
  // path onto the base branch on a no-remote repo (merge-fence's matchesRawLocalBaseMerge denies
  // every raw equivalent); as a spawnSync child process it is structurally invisible to that
  // PreToolUse hook, exactly like the PR path's `gh pr merge`. FAFF-875: the actual Cases A/B
  // land logic now lives in the shared `landBaseFfOnly` helper (verbatim extraction — `faff prdr
  // land --local` reuses it for its own doc-only landing) — `allowInPlace` stays at its default
  // false here, so this call resolves identically to the pre-extraction inline code, including
  // the FAFF-545 self-merge regression case (sitting on `base` via a `--branch` override still
  // lands via update-ref, never a self-merge — see landBaseFfOnly's own header comment).
  const land = landBaseFfOnly({ cwd, base, tipSha: headShaNow, baseShaBefore });
  if (!land.ok) {
    result.verdict = "refuse";
    result.blockers = [...blockers, land.blocker];
    return emit(result, 1);
  }
  result.merged = true;
  result.verdict = "merge-ok";
  writeMergeRecord(runDir, issue, null, headShaNow, integrity.display); // FAFF-397: pr:0 (null coerced by Number())
  return emit(result, 0);
}

module.exports = { baseCheckedOutWorktree, gitRemoteEmpty, resolveLocalBase, gatesSignalToCiState, landBaseFfOnly, cmdMergeGateLocal };
