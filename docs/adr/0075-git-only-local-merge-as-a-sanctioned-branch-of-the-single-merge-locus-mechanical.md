# ADR 0075 — Git-only local merge as a sanctioned branch of the single merge locus, mechanically fenced on no-remote repos

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-16
- **Issue:** FAFF-526

## Context

ADR-0043 established `faff merge-gate` as the sole sanctioned merge locus: a pure floor decision (`decideFloor`) fed by AC-verified + review-`pass` + CI-green, wrapped in a thin impure shell that sources every leg from GitHub (`gh pr view`, `gh api …/check-runs`, `gh pr merge`). That shell assumes a pushable remote exists.

A purely-local system-under-test (no remote, no `gh`, no CI — the external-verification SUTs, FAFF-310) has no forge to source any leg from. graft's ship step (push → `gh pr create` → `faff merge-gate --pr`) cannot run at all, so a full autonomous/lights-out drain stalls at push/PR on exactly the repos this program most needs to prove itself against. The engineering gates that would back a CI-green verdict already run locally, pre-PR, at graft Step 7.5 — CI on the PR path is only a remote re-run of that same check. So the missing piece is not a new verification step; it is a way to feed the existing floor from local sources and land the merge without a forge.

## Decision

Add a git-only branch to the *existing* merge locus rather than a second one: `faff merge-gate --local`. It is selected by remote-absence detection (`git remote` empty), never forced — a repo with a remote, even one that is momentarily unreachable, stays on the PR/CI path and fails loud rather than silently dropping CI. The bypass-guard makes `--local` self-refuse (exit 2) whenever a remote is present, so the flag cannot be used to skip CI on a remote-backed repo.

Inside the branch, `decideFloor` (`contract-defs.js`) is reused **verbatim** — the local path only populates its `floor` object from local sources: AC and review verdicts from the existing Step-8/Step-9 artifacts (unchanged), and the CI-green leg from a **fresh** `faff gates run` executed at merge time on the branch tip (mirroring the ADR-0043 keystone property that the gate observes CI itself on the head sha, never a caller-supplied verdict). `GatesOutcome.signal` maps onto `floor.ci_state` (`pass`→`ci-green`, `fail`→`ci-red`, `needs-human`→`indeterminate`, `discovery:none`→`no-ci-coverage`), and an empty/errored/uncovered gate set refuses fail-closed under the existing `no_ci_policy: needs-human` default — a git-only build can never merge on an unconcludable or absent check set. On `merge-ok` the branch performs a fast-forward-only local `git merge` (rebase-first if the base moved; non-ff is out of scope) and writes the same `merge-record.json` shape (`head_sha`, `merged`, `integrity`; `pr: 0` as the harmless coercion of a null/sentinel `pr` input) that `post-merge-check` and `reconcile` already read — so both consumers work unchanged, degrading their evidence-gathering to git ground-truth instead of forge state.

On a repo with a remote, GitHub branch protection is an independent mechanical wall behind the PR path; on a no-remote repo that wall is absent. This decision closes that gap in the same slice rather than as a fast-follow: `merge-fence.js` (ADR-0043's PreToolUse deny of raw `gh pr merge`) gains a sibling matcher, `matchesRawLocalBaseMerge`, active only when `git remote` is empty. It denies raw base-branch **mutation** — `git merge <feature>` while on the base branch, `git update-ref refs/heads/<base>`, `git push . HEAD:<base>` — with a remedy pointing at `faff merge-gate --local`, while explicitly never denying base-branch **consumption** (`git merge <base>` run from a feature branch, a legitimate update). Because the matcher is gated on remote-absence, it is dormant on every remote-backed repo: zero L1–L3 impact.

## Consequences

- `faff merge-gate` now has two condition-branches over one floor core and one locus: `--pr` (forge-sourced) and `--local` (git-sourced). Any future change to the floor's three-condition guarantee must be made once, in `decideFloor`, and both branches inherit it automatically — this is the property the design deliberately protects against drifting.
- On a no-remote repo, `faff merge-gate --local` is now the *only* mechanically-sanctioned path onto the base branch; `merge-fence`'s new matcher is what makes that true in practice rather than by prose discipline alone. Any future local-merge convenience path (a script, a raw `git merge` in a skill) must route through the gate or it will be denied.
- `post-merge-check` and `reconcile` needed no logic change — both already keyed off `head_sha` rather than `pr`, confirming the git-only path is a faithful reuse of their existing seams rather than a new integration surface.
- The `no-ci-coverage` → fail-closed mapping is now load-bearing for git-only SUTs specifically: a SUT that declares no engineering gates cannot merge anything until it does. This is intended (an un-gated SUT would otherwise merge un-verified code by default) but is a new operational requirement worth surfacing to anyone scaffolding a git-only SUT.
- Non-fast-forward local merges, a non-ff `graft.local_merge_method` knob, and a fully shell-aware fence matcher are explicitly out of scope and remain open extension points if a git-only SUT's usage pattern outgrows single-session/sequential building.

confidence: high
