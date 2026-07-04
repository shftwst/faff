# FAFF-350 — `faff merge-gate`: a mechanical merge floor + branch-protection preflight

> Spec: faffter-dark-nlspec · 2026-07-04 · autonomous · confidence: high. Full spec on Linear FAFF-350.

This is the design spec for FAFF-350, addressed to the build agent and human reviewers. It specifies a new `faff merge-gate` CLI subcommand that becomes the **sole sanctioned autonomous merge path**, a companion `faff branch-protection-check` probe consumed by an autonomous-entry preflight, and the rewiring of graft Step 10 / the default ship producer to route their merge through the gate. The origin is the 2026-07-04 independent critical review's ranked change #1 (`design/faff-critical-review-2026-07-04.md`).

## 1. WHY — Problem and Principles

**The load-bearing model:** today the merge floor is *prose an obedient model is trusted to assert*, not a tool the model is *forced to route through*. Graft Step 10 asserts the integrity floor — AC checklist self-verified, `review-verdict` self-`pass`, CI green, plus the L4 holdout — and then a producer runs `gh pr merge`. Every leg except CI is a self-report, and the CI leg is only meaningful if CI actually exists and ran on the code being merged. A compliant-but-wrong model can hand a plausible-but-wrong PR straight to `gh pr merge`, and `runcheck` will certify the run **clean** — because clean means *complete*, not *correct*. This spec turns the floor into a **mechanical interlock**: a CLI that re-verifies the floor from artifacts + the live CI API on the PR head sha and is the only thing that calls `gh pr merge`. If the model doesn't route through the tool, it doesn't merge.

**Problem statement.** The three-condition floor is self-asserted prose with no mechanical enforcement, and faff never requires CI or branch protection to make the floor binding on a consumer's repo. The most likely real-world embarrassment is a silent bad auto-merge on a thin-CI repo that every artifact reports as a success. This change makes the floor a tool the merge must pass through, and warns (or blocks) when the repo lacks the branch protection that makes the floor binding.

**Design principles (governing constraints):**

- **Deterministic tools over prose (the whole point of this ticket).** The floor combination logic must be a pure, `--selftest`-covered decision — same inputs, same verdict — so it is testable and cannot be talked out of a refusal. The impure edges (observe CI, run the merge) are isolated around that pure core.
- **The gate must not trust the model's self-report of the leg it is checking.** merge-gate exists precisely because the model can misreport. It therefore **observes CI itself** on the head sha rather than accepting a caller-supplied CI verdict, and re-reads the persisted verdict/holdout artifacts rather than a conversational claim. A design that takes CI-green as an argument reintroduces the exact trust hole it is built to close.
- **Fail-closed.** A missing, unreadable, or malformed floor artifact, an indeterminate CI observation, or a head-sha mismatch is a **refuse-to-merge**, never a pass. This mirrors every existing faff gate (`contract … → needs-human never pass`; `holdout verdict` missing → block).
- **Assert, don't enforce, at the repo boundary.** For branch protection faff follows the established `container-check` stance (ADR-0010): it *detects and reports* whether protection exists; it warns by default and only blocks under an explicit opt-in knob. faff never mutates the consumer's GitHub settings.

## 2. OUT OF SCOPE

- **Building CI or branch protection for the consumer's repo.** faff asserts, never provisions (ADR-0010).
- **Re-implementing the individual floor legs.** AC verification (graft Step 8), the `review-verdict` producer/contract, the CI trichotomy (FAFF-3), the code-blind holdout (`holdout_step`), and the delivery-precondition probe (FAFF-4) already exist. merge-gate **composes** them.
- **A deploy-capable third-party ship producer's post-merge deploy interface.** Separate design; `slots.ship`; see the Punt in §7.
- **Retrofitting merge authority onto non-`gh`/GitHub forges.** v1 targets `git`+`gh`.
- **A cryptographic guarantee that a raw `gh pr merge` can never be run out-of-band.** A human or a rogue call bypassing the CLI is a loud off-script boundary, not a cryptographically-blocked one.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Integrity floor | AC checklist complete, `review-verdict` `pass`, CI green on head sha, and (under the L4 signal) the code-blind holdout `meets-spec`. |
| Floor artifact | A persisted, per-issue file merge-gate re-reads to verify a leg (not a conversational claim). |
| Sole sanctioned merge path | The only place faff-driven code invokes `gh pr merge` is inside `merge-gate`. |
| Head-sha binding | The CI observation merge-gate trusts is the check set for the PR's current head commit. |

```
ENUM CiState: ci-green | ci-red | no-ci-coverage | indeterminate
ENUM MergeGateVerdict: merge-ok | refuse
RECORD FloorInputs:
  ac_complete: bool
  review_verdict: pass | fail | needs-human | missing
  ci_state: CiState
  head_sha_matches: bool
  level: L1 | L2 | L3 | L4
  holdout: meets-spec | blocked | missing | not-applicable
  no_ci_policy: needs-human | allow
```

CLI surfaces:

```
faff merge-gate --pr <n> --issue <ID> --run-dir <path> --level <L1|L2|L3|L4>
                [--merge-args "<gh pr merge flags>"] [--execute|--check-only]
                [--interactive] [--human-override] [--json]
faff branch-protection-check [--repo <owner/repo>] [--branch <name>] [--json]
```

Design decisions: pure `decide_floor` core registered as `CONTRACTS["integrity-floor"]` wrapped in a thin impure `gh`/`git` shell; CI observed, never passed in; floor artifacts from the run-dir; branch protection a separate probe + preflight mirroring `container-check`; interactive L2 also routes through the gate with a recorded `--human-override`.

## 4. HOW — Behavior

```
PURE FUNCTION decide_floor(f: FloorInputs) -> {verdict, blockers}:
  blockers := []
  IF NOT f.ac_complete:                     blockers += "ACs not all verified"
  IF f.review_verdict != pass:              blockers += "review verdict is <v> (need pass)"
  IF f.ci_state == ci-red:                  blockers += "CI failing on head sha"
  IF f.ci_state == indeterminate:           blockers += "CI state indeterminate / not on head sha"
  IF NOT f.head_sha_matches:                blockers += "green CI is not on the current PR head sha"
  IF f.ci_state == no-ci-coverage AND f.no_ci_policy == needs-human:
                                            blockers += "no CI coverage for this diff (FAFF-3)"
  IF f.level == L4 AND f.holdout != meets-spec:
                                            blockers += "L4 holdout: <holdout> (need meets-spec)"
  verdict := (blockers empty) ? merge-ok : refuse
```

Branch-protection preflight: once at autonomous entry, probe branch protection; `protected` → continue silently; otherwise resolve `autonomous.require_branch_protection` (default `warn`) — warn emits one warning + continues, block aborts needs-human. Never fires interactive.

`--merge-args` is validated against a closed allowlist (`--squash`/`--merge`/`--rebase`/`--delete-branch`/`--auto`/`--admin`); any unrecognised token is rejected (exit 2).

## 5. Scenarios

- Review-verdict `pass`, AC complete, CI green on head sha (L3), `--execute` → one `gh pr merge`, exit 0.
- Green CI on an earlier commit than head → refuse (exit 1), no merge.
- Zero applicable CI checks (no-ci-coverage) under the default policy → refuse (exit 1).
- L4, conditions 1–3 green, holdout verdict missing → refuse (exit 1, fail-closed).
- Default ship producer routes through `faff merge-gate`; graft/default-ship contain no direct `gh pr merge`.
- Autonomous entry on an unprotected branch, knob unset → one warning, run continues; under `block` → aborts needs-human.
- `decide_floor` and the branch-protection classifier are pure — `--selftest` drives their tables with no network.

## 6–8. Rationale, Assumptions, DONE

Pure-core + impure-shell reconciles the pure-function-CLI convention with a subcommand that needs `gh`. CI observed not passed in. Floor artifacts from run-dir canonical paths. Two subcommands (repo-entry concern vs per-PR concern). Interactive L2 routes through the gate. The default ship producer's `gh pr merge --squash --delete-branch` becomes a `merge-gate … --merge-args "--squash --delete-branch"` call.

DoD summary: `decide_floor` pure + `--selftest`; both subcommands in `COMMANDS` + documented in `docs/guide/cli.md`; CI observed on head sha (FAFF-3 trichotomy), never an input; stale-sha / no-ci-coverage / indeterminate / missing-artifact / L4-holdout-miss all refuse fail-closed; `--merge-args` allowlist-validated; `autonomous.require_branch_protection` knob (default `warn`); prose rewiring of graft Step 10 + `faffter-noon-ship` + the branch-protection preflight; `--selftest` tables for `merge-gate`, `branch-protection-check`, and the `integrity-floor` contract.

confidence: high
spec-review: approve
