// ===========================================================================
// === region:factory — forge-merge — the shared forge merge-state observation (FAFF-1077). ===
// ===========================================================================
// Factored out of lights-out.js's formerly-private observeForgeMerge so the merge-order interlock
// (merge-gate.js) reads a dependency PR's state through the SAME primitive lights-out's resume
// reconcile uses, rather than a second `gh pr view` spelling that could drift.

const { spawnSync } = require("node:child_process");

// Observe a PR's live merge state from the forge (best-effort). `recorded` carries `.pr` (the
// resume merge-record shape, or a bare { pr } the interlock builds). Returns
// { pr_merged, merged_head_sha, state }: `state` is the raw forge state (OPEN | CLOSED | MERGED)
// or null when the read failed. No pr / no gh / a read failure ⇒ not-merged with state null
// (fail-closed — a null state is a transient/absent observation the caller must never read as a
// mergeable signal; the resume reconcile parks, the interlock refuses-and-retries).
function observeForgeMerge(recorded) {
  if (!recorded || recorded.pr == null) return { pr_merged: false, merged_head_sha: null, state: null };
  try {
    const r = spawnSync("gh", ["pr", "view", String(recorded.pr), "--json", "state,mergeCommit"], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return { pr_merged: false, merged_head_sha: null, state: null };
    const j = JSON.parse(r.stdout);
    const merged = j.state === "MERGED";
    return { pr_merged: merged, merged_head_sha: merged && j.mergeCommit ? j.mergeCommit.oid : null, state: j.state || null };
  } catch { return { pr_merged: false, merged_head_sha: null, state: null }; }
}

module.exports = { observeForgeMerge };
