// ===========================================================================
// === region:factory — merge-gate-stack — FAFF-1391: the stacked-dependency merge-order interlock (FAFF-1077) ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged.

const path = require("node:path");
// FAFF-1077: the stacked-dependency merge-order interlock observes the dependency PR through the
// shared forge-merge primitive (the SAME read lights-out's resume reconcile uses).
const { observeForgeMerge } = require("./forge-merge");
const { gitRun } = require("./merge-gate-floor");
const { resolveLocalBase } = require("./merge-gate-local");

// FAFF-1077 — read the branch-stacked dependent's HEAD-SHA-PINNED stack anchor via git-show on the
// local object store (the committed-anchor pattern, same as resolveAnchorLevel's primary read). A
// MISSING anchor is the common case and resolves { present:false } — the interlock then returns
// dependency_gate "not-applicable", byte-identical to a non-stacked merge. A present-but-malformed
// anchor or one missing parent_pr/parent_branch is a bug → the caller fails loud (a stack needs a
// forge parent). No Contents-API fallback: the merge locus runs from D's build checkout, so the
// pushed head object is always local; a pure-remote invocation with no local object is not stacking.
function readStackAnchor(cwd, runDir, issue, headSha) {
  const anchorPath = `.faff/anchors/${path.basename(runDir)}/${issue}/stack-parent.json`;
  const r = gitRun(cwd, ["show", `${headSha}:${anchorPath}`]);
  if (!r.ok) return { present: false };
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { return { present: true, malformed: true }; }
  if (!parsed || typeof parsed !== "object" || parsed.parent_pr == null || !parsed.parent_branch) {
    return { present: true, malformed: true };
  }
  return { present: true, anchor: parsed };
}

// PURE (FAFF-1077) — map the stacked-dependency observation onto the dependency_gate leg plus an
// optional owner-park intent. Keeping the DECISION pure makes the two owner-park outcomes (the
// dependency PR closed-unmerged, and a rebase conflict) born-verifiable without a live forge/git.
//   obsState: the forge PR state (OPEN | CLOSED | MERGED) or null (a transient/unreadable read)
//   rebaseOutcome: null (dependency not merged, no rebase attempted) | "ok" | "conflict"
// The gate is ADDITIVE by construction — every path returns "satisfied" or "blocked", never a leg
// that could remove an existing floor blocker. merge-gate NEVER parks (it returns only refuse /
// merge-ok), so a `park` intent is surfaced upward for the owning layer (the concurrency occupant /
// faff-graft Step 10, via faffter-noon-ship's delivery-outcome vocabulary) to enact.
function classifyDependencyGate(parentIssue, parentPr, obsState, rebaseOutcome) {
  if (obsState === "MERGED") {
    if (rebaseOutcome === "conflict") {
      return { gate: "blocked", park: { cause: `stacked dependent rebase --onto main conflicted after dependency ${parentIssue} merged — a rebase conflict is not an obvious fix (FAFF-1077)`, reconsider: "human" } };
    }
    return { gate: "satisfied", park: null };
  }
  if (obsState === "CLOSED") {
    return { gate: "blocked", park: { cause: `stacked dependency ${parentIssue} PR #${parentPr} closed without merging — the dependent's base is dead (FAFF-1077)`, reconsider: "human" } };
  }
  if (obsState === null) {
    return { gate: "blocked", park: null, note: "stacked dependency PR state unreadable (forge blip) — refusing this attempt, retry later (no park)" };
  }
  return { gate: "blocked", park: null, note: "stacked dependency PR not yet merged — the dependent stays pr-open" };
}

// FAFF-1077 — the bounded rebase-on-merge. Once the dependency merged, the dependent's branch still
// carries the dependency's original commits; replay ONLY the dependent's own commits (those after
// the recorded pinned tip SHA) onto the true updated main, so its final diff is dependent-only and
// correct even under squash-merge (where the dependency's originals are absent from main). ONE
// attempt is the bound: a conflict aborts and returns "conflict" (the caller surfaces a park
// intent), never retried. Success force-pushes with lease and returns the advanced head sha.
function boundedRebaseOntoMain(cwd, anchor, headShaBefore) {
  const base = resolveLocalBase(cwd, null);
  if (!base) return { outcome: "conflict" };
  const dBranchRes = gitRun(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = dBranchRes.ok && dBranchRes.stdout ? dBranchRes.stdout : "HEAD";
  gitRun(cwd, ["fetch", "-q", "origin", base], 60000);
  const rb = gitRun(cwd, ["rebase", "--onto", `origin/${base}`, anchor.parent_tip_sha, branch], 120000);
  if (!rb.ok) { gitRun(cwd, ["rebase", "--abort"]); return { outcome: "conflict" }; }
  const after = gitRun(cwd, ["rev-parse", "HEAD"]);
  const headSha = after.ok && after.stdout ? after.stdout : headShaBefore;
  if (headSha !== headShaBefore) {
    const push = gitRun(cwd, ["push", "--force-with-lease", "origin", branch], 60000);
    if (!push.ok) return { outcome: "conflict" };
  }
  return { outcome: "ok", headSha };
}

// FAFF-1077 — the merge-order interlock, wired into cmdMergeGate. Reads D's stack anchor, observes
// the dependency's PR merge state, and (once the dependency merged) runs the bounded rebase before
// contributing the dependency_gate leg. Returns { gate, park, note, headSha?, failLoud? }: `gate`
// feeds decideFloor; `park` is the owner-park intent (never enacted here); `headSha` is the advanced
// head after a successful rebase (the caller re-observes CI on it). ADDITIVE only — it can push the
// blocker leg or the satisfied leg, never remove a floor blocker.
function dependencyInterlock({ cwd, runDir, issue, headSha, mutate = true }) {
  const st = readStackAnchor(cwd, runDir, issue, headSha);
  if (!st.present) return { gate: "not-applicable", park: null };
  if (st.malformed) {
    return { failLoud: `faff merge-gate: stack anchor for ${issue} at head ${headSha} is malformed or missing parent_pr/parent_branch (FAFF-1077) — a stack needs a forge parent\n` };
  }
  const anchor = st.anchor;
  const obs = observeForgeMerge({ pr: anchor.parent_pr });
  let rebaseOutcome = null;
  let newHead = null;
  // The rebase + force-push is a mutation, so it runs only on the execute path. In check-only
  // (preview) the dependency-merged observation reports "satisfied" without touching D's branch —
  // a preview never rewrites a branch or force-pushes.
  if (obs.state === "MERGED" && mutate) {
    const rb = boundedRebaseOntoMain(cwd, anchor, headSha);
    rebaseOutcome = rb.outcome;
    if (rb.outcome === "ok" && rb.headSha) newHead = rb.headSha;
  } else if (obs.state === "MERGED") {
    rebaseOutcome = "ok"; // preview: assume the rebase would apply cleanly
  }
  const c = classifyDependencyGate(anchor.parent_issue, anchor.parent_pr, obs.state, rebaseOutcome);
  return { gate: c.gate, park: c.park || null, note: c.note || null, headSha: newHead || null };
}

module.exports = { readStackAnchor, classifyDependencyGate, boundedRebaseOntoMain, dependencyInterlock };
