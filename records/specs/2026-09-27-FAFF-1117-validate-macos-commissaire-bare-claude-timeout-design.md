# Spec — FAFF-1117: stop the impure `commissaire-bare-claude` test tripping the new 120s per-subtest ceiling on `validate-macos`

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1117.

This spec is a design doc for the build agent and human reviewers. It fixes an intermittent CI red on the `validate-macos` lane. The work is a CI-config and test-infra change: one line of GitHub Actions YAML, no new runnable product surface, no architecture decision.

## 1. WHY — Problem and Principles

**The core mechanism.** The heavy test did not get slower; a ceiling was newly lowered onto it. FAFF-1049 (#920) restructured `validate-macos` from a single whole-manifest `node --test` run (shared 15-minute job budget, no per-test cap) into a per-file loop where each file gets `--test-timeout=120000`, a 120s **per-subtest** ceiling that never existed before. One subtest in `test/impure/commissaire-bare-claude.test.mjs` pays a one-time `git fetch --unshallow origin` (a full-history fetch of the whole repo) whenever the checkout is shallow. On a full local clone that fetch never fires, so the file passes fast; on a loaded `macos-latest` runner with GitHub Actions' default shallow depth-1 checkout, that one-time fetch tips a single subtest past the new 120s cap. Give the CI checkout full history and the in-test fetch never fires, restoring the fast-local behaviour on CI.

**Problem statement.** A shallow CI checkout forces `provisionDriver` to run a full-repo `git fetch --unshallow` inside whichever subtest provisions the driver first, and under load that one-time cost exceeds the FAFF-1049 120s per-subtest ceiling. The red `validate-macos` check then refuses the sanctioned merge, because `faff merge-gate` observes all checks and not only the branch-protection-required ones, forcing `--human-override`. This change makes the CI checkout carry full history so the in-test fetch is never needed.

**Design principles.**

- **Fix the precondition, not the symptom.** The subtest is slow only because the checkout is shallow. Remove the shallowness at its source rather than raising the cap or editing the test's fetch logic.
- **Keep the in-test guard intact.** The test still runs on the Linux `validate` lane and on shallow local clones, so its shallow-detection and fetch fallback must stay correct everywhere; this change only removes the *need* for them on the macOS lane.
- **Do not touch the guarded literal.** The `120000` literal is asserted by a separate guard test. The fix must not change it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/validate.yml` — `validate-macos` job (L232-327), checkout step (L236) | GitHub Actions YAML | Holds the checkout being changed and the per-file `--test-timeout=120000` loop (L259, L273) |
| `test/impure/commissaire-bare-claude.test.mjs` — `provisionDriver` (L47-78) | Node / ESM test | Sole caller of the in-test `git fetch --unshallow origin` (L65) this change neutralises |
| `test/gates-ci-macos-guard.test.mjs` — AC2 (L170-182) | Node / ESM test | Asserts the `--test-timeout=120000` literal reaches node's argv; must stay green and untouched |
| `test/faff-1051-diff-kind.test.mjs` (L114-148), `test/oracle-triage.test.mjs` (L221-237) | Node / ESM test | Shallow-tolerant tests whose comments claim "no `fetch-depth: 0` anywhere in validate.yml"; stay green, comments go stale |

**Scope.** A single edit to the `validate-macos` checkout step in the CI workflow, plus a comment-accuracy touch-up in two unrelated test files. It sits entirely in the CI/test-infra layer.

## 2. OUT OF SCOPE

- **Realigning `faff merge-gate` to gate only on branch-protection-required checks.**
  - *Why excluded:* the ticket's own "separate design question — do not assume"; it is being tracked separately.
  - *Extension point:* the merge-gate check-observation logic, in its own future issue. Do not build it here.

- **Optional fixture memoization in the test.**
  - *Why excluded:* the test re-pays ~24 unmemoized `scaffold()` (bash + `git init`/commit) and several `completedSut()` (3 subprocess spawns each) fixtures, where a `sharedFixture()`-style cache already proves reuse works (`commissaire-bare-claude.test.mjs:132-146`). This is real headroom but the `--unshallow` is the dominant cost; removing it alone clears the ceiling. Adding memoization here would widen the change and its blast radius for no required benefit.
  - *Extension point:* extend the existing `sharedFixture()` / `driverCache` (L46) memoization pattern in `commissaire-bare-claude.test.mjs` in a follow-on issue if further headroom is wanted.

- **Changing the `--test-timeout=120000` literal or the FAFF-1049 per-file loop / watchdog.**
  - *Why excluded:* the ceiling is not the defect; the one-time fetch is. The literal is guarded (see §3) and the loop's purpose (naming a pre-first-test hang) is unrelated.
  - *Extension point:* none needed for this fix.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Shallow checkout | A clone with truncated history (`actions/checkout@v4` default `fetch-depth: 1`); only the tip commit and its tree are present |
| Unshallow | `git fetch --unshallow origin` — converts a shallow clone into a full-history one by fetching the entire remaining repo |
| Per-subtest ceiling | The `--test-timeout=120000` (120s) node test-runner cap applied to each individual `test(...)` in a file |
| FAFF-828 ancestor | The facade commit `881f4a2555aa919947ec7e52a15b093478ed8110`; the test's preflight requires it to be an ancestor of the driver revision |
| Driver revisions | `EXPECTED = fd1e9788…` and `DRIFT = 3910417c…`; both confirmed ancestors of `HEAD` on main history |

**The interface being changed** is one step's configuration in the `validate-macos` job:

```
STEP (validate-macos, currently L236):
  uses: actions/checkout@v4
  # add:
  with:
    fetch-depth: 0        # 0 = full history (not the default depth-1 shallow clone)
```

`fetch-depth: 0` makes the runner's working copy a full-history clone. All three commits the test needs (`FAFF828`, `EXPECTED`, `DRIFT`) are then already present, so none of `provisionDriver`'s in-test fetches — the driver-SHA fetch (L51-53) and the `--unshallow` (L65) — have a reason to fire.

**Guarded literal — do not touch.** `test/gates-ci-macos-guard.test.mjs` AC2 (L170-182) asserts the literal `120000` reaches node's real argv. That guard extracts only the `run:` command lines of the `validate-macos` job (via `extractRunCommandsWithContext` filtered to `job === "validate-macos"`). The edit is to the `uses:` step's `with:` block, which is not a `run:` line, so no extracted command line changes and the guard is unaffected by construction.

**Design decision.** See §6 for the full rationale. **Chosen:** add `fetch-depth: 0` to the `validate-macos` checkout, in preference to an in-test change that drops `--unshallow`.

## 4. HOW — Behavior

**Approach.** `provisionDriver` (L47-78) decides whether to fetch based on which commits are already present locally. The whole decision is a precondition test on local object presence. Making the checkout full-history satisfies every precondition up front, so every fetch branch is skipped. Nothing inside the test file changes its behaviour; the environment it runs in changes.

**Current in-test flow (shallow CI checkout).**

```
PROCEDURE provisionDriver(sha):            # commissaire-bare-claude.test.mjs L47-78
  1. IF sha already provisioned (driverCache): return cached dir
  2. IF commit `sha` object absent locally:          # true on shallow CI
     a. git fetch --depth 1 origin <sha>             # cheap: one commit
     b. IF that failed: git fetch origin <sha>       # fallback
  3. IF FAFF828 (881f4a25…) object absent locally:   # true on shallow CI
     a. shallow := (git rev-parse --is-shallow-repository == "true")
     b. IF shallow: git fetch --unshallow origin      # DOMINANT COST: full repo
     c. IF FAFF828 still absent: git fetch origin FAFF828   # cheap fallback
  4. git worktree add --detach <dir> <sha>
  5. cache and return <dir>
```

On a loaded `macos-latest` runner, step 3b is the one-time cost that tips the provisioning subtest past 120s.

**Flow after the fix (full-history CI checkout).**

```
Given the runner checked out with fetch-depth: 0
  → FAFF828, EXPECTED and DRIFT are all present locally
  → step 2 condition is false (no driver-SHA fetch)
  → step 3 condition is false (no --unshallow, no FAFF828 fetch)
  → provisionDriver goes straight to `git worktree add`, as it already does on a full local clone
```

The slightly slower full-history checkout runs as its own workflow step, outside any per-test cap and well inside the job's `timeout-minutes: 15`.

**Edge cases.**

- **The `validate` (Linux) lane and local shallow clones are unchanged.** They do not get `fetch-depth: 0` and keep exercising the in-test shallow path; the test's guard logic must therefore remain in place and correct. Do not delete it as "now dead".
- **Stale comments in sibling tests.** After the edit, `fetch-depth: 0` does appear in `validate.yml` (on `validate-macos` only). Two shallow-tolerant tests — `test/faff-1051-diff-kind.test.mjs` (L121) and `test/oracle-triage.test.mjs` (L222-227) — carry comments asserting "no `fetch-depth: 0` anywhere in validate.yml". Both gate their strong assertion on a runtime `is-shallow-repository` check and run only on the ubuntu `unit` lane (they are not under `test/impure/`, so they never run on macOS), so they stay green. Correct the two comments so the prose stays accurate: note that `validate-macos` now sets `fetch-depth: 0`, while the lanes these tests run on remain shallow.

**Failure modes.**

- **The `--unshallow` is not actually the dominant cost.** The fix rests on the diagnosis that the full-repo fetch, not the ~24 `scaffold()` / `completedSut()` fixtures, dominates the subtest's time.
  - *How you'd know:* after `fetch-depth: 0`, the provisioning subtest still approaches or exceeds 120s on the macOS lane under load.
  - *What it means:* narrow, not abandon — pursue the optional fixture-memoization follow-on scoped out in §2. The fetch removal is still correct and necessary; it was just not sufficient.
- **Full-history checkout threatens the job budget.**
  - *How you'd know:* the `validate-macos` job's wall-clock climbs toward `timeout-minutes: 15`.
  - *What it means:* proceed unless it actually breaches; the checkout runs outside any per-test cap and the repo's history is modest. If it ever breaches, a bounded `fetch-depth: N` deep enough to contain FAFF828 is the fallback lever.

**Anti-patterns.**

- **Anti-pattern:** raising `--test-timeout=120000` to make the slow subtest fit. **Why:** it masks the one-time fetch instead of removing it, keeps a full-repo fetch on the critical path, and trips the guard test.
- **Anti-pattern:** adding `fetch-depth: 0` to the `unit` / `validate` / other job checkouts "for consistency". **Why:** only `validate-macos` runs the impure suite that calls `provisionDriver`; widening it needlessly slows every other checkout and would defeat the shallow-tolerant assumptions the sibling tests document.
- **Anti-pattern:** deleting the in-test `--unshallow` / shallow-guard block as dead code. **Why:** the test still runs on the Linux lane and on local shallow clones, where that logic is exactly what keeps it correct.

## 5. Scenarios

Main objectives, expressed so they are born verifiable. No holdouts: the ticket has no runnable product surface for a code-blind evaluator to exercise, so a withheld scenario would add nothing.

```
Given the validate-macos job checks out with fetch-depth: 0
When the impure manifest runs commissaire-bare-claude.test.mjs on the macOS runner
Then git rev-parse --is-shallow-repository reports "false" during the run
And provisionDriver invokes neither `git fetch --unshallow origin` nor a driver-SHA fetch
```

```
Given the macOS runner is under load
When the driver-provisioning subtest runs with the full-history checkout
Then it completes inside the 120s per-subtest ceiling with margin
And the validate-macos check passes without --human-override
```

Non-functional assertions:

- The `--test-timeout=120000` literal in `validate.yml` is unchanged, and `test/gates-ci-macos-guard.test.mjs` passes unchanged.
- `commissaire-bare-claude.test.mjs` keeps all its assertions and its current passing test count (47/47); the fix changes only the environment, not the test body.

## 6. Design Decision Rationale

**How should the in-test full-repo `--unshallow` be prevented from tripping the 120s per-subtest ceiling on `validate-macos`?**

| Option | Pros | Cons |
|---|---|---|
| A. `fetch-depth: 0` on the `validate-macos` checkout | One line; commits present up front so no in-test fetch fires; restores the fast-local behaviour; leaves the test body and the guarded literal untouched; the extra checkout time is outside any per-test cap | The checkout step itself is a little slower |
| B. In-test fix: drop `--unshallow`, fetch only FAFF828 shallowly via the existing cheap fallback | No workflow change | Risks the lineage/ancestor sanity check: the code comment (L57-61) states the preflight needs connecting history that a bare single-commit fetch does not provide, which is likely why the `--unshallow` exists; a fetch-only-FAFF828 route could leave `git merge-base --is-ancestor` unable to resolve, reintroducing the preflight failure the `--unshallow` was added to prevent |
| C. Raise the `--test-timeout` literal | Trivial | Masks the cost rather than removing it, keeps the full-repo fetch on the critical path, and trips the guard test — an anti-pattern (§4) |

**Chosen:** Option A — add `fetch-depth: 0` to the `validate-macos` checkout. It provides real full history, so all three required commits are present and every in-test fetch branch is skipped, sidestepping the connecting-history risk that makes Option B unsafe, and it leaves both the test body and the guarded `120000` literal untouched.

Temporal anchor: at the time of writing, `actions/checkout@v4` defaults to `fetch-depth: 1` (shallow), and no `fetch-depth` is set anywhere in `validate.yml`. Revisit if the action's default changes or the repo history grows large enough for a full checkout to threaten the 15-minute job budget.

## 7. Open Questions and Assumptions

**Open Questions.** None. The fix is settled; the in-test alternative is rejected in §6, not deferred.

**Assumptions.**

- **Assumes:** the in-test preflight's `git merge-base --is-ancestor` check needs the connecting history between `FAFF828` and the driver revision, which a bare single-commit fetch would not provide — this is why the `--unshallow` exists (per the code comment at `commissaire-bare-claude.test.mjs:57-61`).
  - *Why it matters:* it is the reason Option B is rejected. The chosen fix does not depend on this being true, because `fetch-depth: 0` supplies full history either way; the assumption only justifies not pursuing the in-test route.
  - *Validation instruction:* read `commissaire-bare-claude.test.mjs:57-67` and confirm the comment's account before considering any future in-test change. No action is required for this fix.

## 8. DONE — Definition of Done

### From WHY
- [ ] On the `validate-macos` lane, `git rev-parse --is-shallow-repository` reports `false` during the run (the repo is full-history), so the in-test `--unshallow` has no reason to fire.
- [ ] The provisioning subtest in `commissaire-bare-claude.test.mjs` clears the 120s per-subtest ceiling with margin on the macOS lane, and the `validate-macos` check passes without `--human-override`.

### From WHAT (interface)
- [ ] The `validate-macos` checkout step (`.github/workflows/validate.yml`, currently L236) carries `with: { fetch-depth: 0 }`.
- [ ] The `--test-timeout=120000` literal is unchanged, and `test/gates-ci-macos-guard.test.mjs` passes unchanged.

### From HOW (behaviour)
- [ ] `provisionDriver` invokes neither `git fetch --unshallow origin` nor a driver-SHA `git fetch` during the `validate-macos` run (all three of `FAFF828`, `EXPECTED`, `DRIFT` are present from the full checkout).
- [ ] `commissaire-bare-claude.test.mjs` keeps every assertion and its current passing count (47/47); no test-body behaviour changes.

### From HOW (edge cases)
- [ ] The `validate` (Linux) lane and other jobs do **not** get `fetch-depth: 0`; the in-test shallow-detection / fetch logic is left in place.
- [ ] The stale comments in `test/faff-1051-diff-kind.test.mjs` (L121) and `test/oracle-triage.test.mjs` (L222-227) are corrected to reflect that `validate-macos` now sets `fetch-depth: 0` while their own lanes stay shallow; both tests still pass.

**Integration smoke test.**

```
1. Open a PR (or push a branch) that adds `fetch-depth: 0` to the validate-macos checkout.
2. On the validate-macos run, confirm in the job log:
   - `git rev-parse --is-shallow-repository` context is full (no --unshallow line appears)
   - commissaire-bare-claude.test.mjs reports its full passing count within the per-subtest ceiling
3. Confirm the validate + gates-ci-macos-guard checks are green.
If validate-macos goes green with no --unshallow in the log, the plumbing is connected.
```

confidence: high
build-tier: complex
spec-review: approve