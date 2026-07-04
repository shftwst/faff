# ADR 0043 — The merge floor is a mechanical interlock: faff merge-gate is the sole sanctioned gh pr merge path

- **Status:** Proposed
- **Date:** 2026-07-04
- **Issue:** FAFF-350

## Context

The three-condition merge floor (AC-verified, review `pass`, CI green, plus the L4 holdout) was **prose an obedient model was trusted to assert**, not a tool the model was forced to route through. Graft Step 10 asserted the floor and then a producer ran a raw `gh pr merge`. Every leg except CI is a self-report, and the CI leg is only meaningful if CI actually ran on the code being merged (on the head sha). A compliant-but-wrong model could hand a plausible-but-wrong PR straight to `gh pr merge`, and `runcheck` would certify the run **clean** — because clean means *complete*, not *correct*. This is the single biggest L3 grade-mover: the most likely real embarrassment is a silent bad auto-merge on a thin-CI repo that every artifact reports as a success. FAFF-3's own spec named `CONTRACTS["integrity-floor"]` as the extension point a future issue would fill; this is that issue.

## Decision

The merge floor is a **mechanical interlock**. `faff merge-gate` is the **sole sanctioned `gh pr merge` path** in faff-driven code — graft Step 10 and the default `ship` producer route their merge through it, and neither calls `gh pr merge` directly. The gate is built as a **pure `decide_floor` core** registered in the CLI's `CONTRACTS` registry as `integrity-floor` (`--selftest`-covered, same table-driven harness as every other contract) wrapped in a **thin impure `gh`/`git` shell** (`cmdMergeGate`) that gathers observations and executes the merge. Two properties are load-bearing: (1) the gate **observes CI itself** on the resolved PR head sha and classifies it into the FAFF-3 `ci-green`/`ci-red`/`no-ci-coverage`/`indeterminate` trichotomy — it never accepts a caller-supplied CI verdict, because the model's self-report is exactly what it exists to distrust; (2) it re-reads the persisted floor artifacts (`review-verdict` block, AC-checklist result, `.faff/holdout/<issue>.json`) from the run-dir, not a conversational claim. Fail-closed throughout: a missing/unreadable/malformed artifact, an indeterminate CI observation, or a head-sha mismatch is a refuse-to-merge, never a pass. `gh` becomes a sanctioned CLI shell-out for the first time (already on the trusted-command allowlist); `--merge-args` is validated against a closed `gh pr merge` flag allowlist so no untrusted free-text reaches the merge shell.

## Consequences

- Every future `ship` producer reaches `main` through `merge-gate` (or reopens a second, ungated merge path — the property to preserve). The default producer's `gh pr merge --squash --delete-branch` becomes a `merge-gate … --merge-args "--squash --delete-branch"` call; its FAFF-4 delivery-precondition probe and `delivery-outcome` emission are unchanged.
- The CLI's decision/impurity boundary is fixed: the floor *combination* is a pure, testable contract; the impurity is quarantined to the observe + execute edges.
- The residual is honest and deliberate: a model (or a human) can still bypass the CLI and run a raw `gh pr merge` off-script. That is a loud off-script boundary, not a cryptographic control (parity with FAFF-212's stance). The **branch-protection preflight** (`faff branch-protection-check` + the `autonomous.require_branch_protection` knob, mirroring `container-check` / ADR-0010) is the compensating control that makes the floor binding *at the forge* even if the model misbehaves — assert-don't-enforce: faff detects and warns (blocks under the opt-in knob), never mutating the consumer's GitHub settings.
