# FAFF-1087 — End-to-end rebase-mechanics integration test for dependency stacking

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1087.

This is a buildable spec for FAFF-1087. The artifact is a new test file, `test/faff-1087-<slug>.test.mjs`, that exercises the two impure git-mutation functions in the dependency-stacking interlock (`boundedRebaseOntoMain` and `dependencyInterlock`) against a real two-branch git repo with a real bare-remote and a stubbed `gh`. It is written for the build agent who will author the test and for the human reviewers who gate the merge. It adds test coverage only; it changes no production code.

## Already shipped against this surface

FAFF-1077 (Done, shipped in PR shftwst/faff#924) delivered the whole dependency-stacking mechanic and the unit tests for its pure seams. Those tests live in `test/faff-1077-dependency-stacking.test.mjs` and cover: the `graft.dependency_wait` config knob default, the additive `decideFloor` `dependency_gate` leg (including the byte-identical-when-absent property), `observeForgeMerge` fail-closed on a null PR, the full `classifyDependencyGate` disposition table (imported and called directly, pure), `readStackAnchor` against a real git temp repo (absent, present, malformed), the `faff-stacked` label manifest, and `setup-worktree.sh`'s `FAFF_WORKTREE_BASE_REF` override including the tip-SHA race.

What has never shipped is an end-to-end test of the two impure functions. A grep across `test/` for `boundedRebaseOntoMain` and `dependencyInterlock` returns zero files: neither function is imported by any test. The pure decision core is exercised in isolation, but the real git operations it composes (fetch, `rebase --onto`, force-push, and the check-only/execute fork) rest on code inspection alone. That is the genuine remaining delta this ticket closes.

## 1. WHY — Problem and Principles

**The load-bearing model: a pinned parent tip makes a squash-merge safe to rebase over.** When branch D is stacked on branch B, D's branch initially carries B's own commits underneath D's. At the moment D is stacked, B's tip SHA is pinned into D's committed anchor (`stack-parent.json`, field `parent_tip_sha`). Everything in D's history *after* that pinned SHA is, by construction, D's own work. So once B's PR squash-merges into `main` (collapsing B's originals into one new commit that does not match any SHA in D's history), rebasing D with `git rebase --onto origin/main <parent_tip_sha> <D-branch>` replays only the commits above the pin. D's final diff therefore contains D's changes and nothing of B's now-squashed originals. This is the highest-risk mechanic in the feature, and today only unit-level inspection of the pure seams backs it.

**Problem statement.** FAFF-1077 unit-covers the pure `classifyDependencyGate` core and the check-only wiring, but the two functions that actually mutate git (`boundedRebaseOntoMain`, `dependencyInterlock`) have no test against a real repo. This ticket adds an integration test that drives real branches, a real bare-remote, a simulated squash-merge, and a real rebase-and-force-push, then asserts the squash-safe and never-merge-before-B properties empirically.

**Design principles:**

**Prove the property, not the call.** The test must assert that D's rebased tree contains only D's file changes after B squash-merges, not merely that `boundedRebaseOntoMain` returned `{ outcome: "ok" }`. A green return with a wrong tree is exactly the failure this test exists to catch.

**Keep the blast radius inside this ticket.** The existing `STUB_GH` in `test/merge-gate-controlflow.test.mjs` and the `scaffoldRepoWithRemote` helper in `test/faff-1077-dependency-stacking.test.mjs` are consumed by their own passing tests. This ticket does not mutate either; it writes its own fixtures so a change here cannot regress an unrelated suite.

**Heavy setup lives inside `test(...)` bodies.** `faff gates run` shards the unit rung across N `node --test` processes, and every shard imports every test file at discovery. Real repos, bare remotes, and subprocess spawns at module top level multiply by shard count and starve siblings (the FAFF-1137 precedent). All fixture construction is deferred into the test bodies; only cheap constants sit at module scope.

**Reference context:**

| System | Location | Relevance |
|---|---|---|
| Interlock mechanics under test | `plugin/skills/faff/bin/lib/merge-gate.js` | `classifyDependencyGate`, `boundedRebaseOntoMain`, `dependencyInterlock`, `readStackAnchor`, all exported at file bottom, require-able directly |
| Forge observation | `plugin/skills/faff/bin/lib/forge-merge.js` | `observeForgeMerge` shells `gh pr view <pr> --json state,mergeCommit`; reads `j.state` and `j.mergeCommit.oid`; no injectable seam |
| Pure-seam unit tests (FAFF-1077) | `test/faff-1077-dependency-stacking.test.mjs` | The `scaffoldRepoWithRemote` bare-remote pattern to mirror; the pure-import and real-temp-repo conventions to follow |
| gh-stub precedent | `test/merge-gate-controlflow.test.mjs` | `STUB_GH` + `stubGhEnv`: an executable bash stub on `PATH`, chmod `0o755`, that shadows `gh` for the child |
| CLI runner | `test/helpers/run-cli.mjs` | `runCli(args, { cwd, input, env })` spawns the real `bin/faff` and returns `{ stdout, stderr, code }` |
| Shard-safety convention | `docs/reference/docker-gated-tests.md` | Why heavy fixture work must sit inside test bodies |

**Scope statement.** This test sits in the unit rung alongside the other `test/*.test.mjs` files, invoked by `node --import ./test/hermetic-env.mjs --test test/`; it is the integration-level complement to FAFF-1077's pure-seam unit coverage of the same feature.

## 2. OUT OF SCOPE

- **Re-testing the pure seams.** FAFF-1077 already covers `classifyDependencyGate`, `readStackAnchor`, `observeForgeMerge` fail-closed, and the additive `decideFloor` leg. Why excluded: duplicating passing coverage is bloat. Extension point: none needed; those live in `test/faff-1077-dependency-stacking.test.mjs`.

- **Promoting `scaffoldRepoWithRemote` to a shared helper.** Why excluded: FAFF-1077's helper is single-branch and lives inside its own file; promoting it is a refactor of a passing test beyond this ticket. Extension point: a future consolidation ticket could lift a two-branch scaffold into `test/helpers/` once a second consumer exists.

- **A real GitHub PR or real `gh` calls.** Why excluded: the test must be hermetic and offline. Extension point: the `gh` binary is stubbed on `PATH`; a live-forge smoke test would be a separate, non-hermetic ticket.

- **The owner-park enactment path.** `dependencyInterlock` only surfaces a `park` intent; enacting it belongs to the concurrency occupant / faff-graft Step 10 (per the merge-gate comment). Why excluded: out of the interlock's own responsibility. Extension point: `faffter-noon-ship`'s delivery-outcome vocabulary, tested elsewhere.

- **The `setup-worktree.sh` base-override and tip-SHA race.** Why excluded: FAFF-1077 already covers these end-to-end. Extension point: existing `setup-worktree` tests.

- **Non-squash merge methods (`--merge`, `--rebase`).** Why excluded: the squash path is the highest-risk mechanic and the one the ticket names; a plain merge leaves B's SHAs on `main`, so the rebase is trivially safe and lower-value to prove. Extension point: an additional scenario in this same file if a regression later warrants it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Dependency (B) | The parent branch/PR that D is stacked on; must merge first |
| Dependent (D) | The stacked branch whose merge is gated on B, and whose branch is rebased once B merges |
| Pinned tip | `parent_tip_sha` in D's anchor: B's tip SHA recorded at stacking time, before B's PR merged |
| Squash-safe | The property that D's post-rebase diff contains only D's own commits, even though B merged as a single squashed commit absent from D's history |
| The interlock | `dependencyInterlock`, wired into `cmdMergeGate` before CI observation and before `decideFloor`, contributing the additive `dependency_gate` leg |

**Functions under test (existing signatures, do not change):**

```
FUNCTION boundedRebaseOntoMain(cwd, anchor, headShaBefore) -> { outcome: "ok", headSha } | { outcome: "conflict" }
  # resolves local base (main else master); fetches origin/<base>;
  # runs: git rebase --onto origin/<base> <anchor.parent_tip_sha> <current-branch>
  # conflict -> git rebase --abort, returns { outcome: "conflict" }, never retried (ONE attempt)
  # success -> if head advanced, git push --force-with-lease origin <branch>; returns { outcome: "ok", headSha }
  # no-op rebase (head unchanged) -> skips the push

FUNCTION dependencyInterlock({ cwd, runDir, issue, headSha, mutate = true })
    -> { gate, park, note, headSha }
  # readStackAnchor -> observeForgeMerge -> (if MERGED and mutate) boundedRebaseOntoMain -> classifyDependencyGate
  # mutate=false (check-only): a MERGED dependency is optimistically assumed rebase-clean; D's branch is NOT touched
```

**Anchor fixture shape (committed into D's branch, read via `git show <headSha>:<path>`):**

```
RECORD stack-parent.json:               # at .faff/anchors/<run>/<issue>/stack-parent.json
  parent_issue:  String                 # e.g. "FAFF-B"
  parent_pr:     Number                 # B's PR number the stub answers for
  parent_branch: String                 # B's branch name
  parent_tip_sha: String                # B's tip SHA pinned at stacking time (the rebase base)
  # dependent, stacked_at optional per the FAFF-1077 fixture
```

**gh stub JSON contract the test must emit** (from `forge-merge.js`, `gh pr view <pr> --json state,mergeCommit`):

```
{ "state": "OPEN" | "CLOSED" | "MERGED",
  "mergeCommit": { "oid": "<sha>" } | null }
```

The interlock reads only `state`; `mergeCommit.oid` is read by `observeForgeMerge` but unused by the dependency path, so the MERGED case may emit it for fidelity or omit it. When the full-CLI path is exercised, `cmdMergeGate`'s own `gh pr view` of D's PR also needs `headRefOid`, `headRefName`, and `state` (per the existing `STUB_GH` shape).

### Design decisions (each marked)

**Coverage split: direct-call vs full-CLI.** Calling the three exported functions directly against a real temp repo proves `boundedRebaseOntoMain` and `dependencyInterlock` in isolation with minimal stub surface, and lets the test assert the returned `outcome`, `headSha`, and gate value precisely. Driving the full `faff merge-gate --execute` CLI via `runCli` instead proves the `cmdMergeGate` wiring: the `interlock.headSha` hand-off into the subsequent CI observation, and the never-merge-before-B floor structurally refusing D while B is OPEN. Both carry weight, so the coverage is split rather than either alone. **Chosen:** direct-call is the primary vehicle for the squash-safe property, the one-shot conflict, and the check-only/execute fork; a single `runCli` full-CLI test covers the never-merge-before-B ordering and the OPEN-to-MERGED flip end-to-end. The full-CLI test does not need an all-green floor: the interlock runs before CI observation and `decideFloor` and feeds an additive leg, so the ordering guarantee is proven from the `--json` `blockers` array (the stacked-dependency blocker present while B is OPEN, absent once B is MERGED) plus the merge sentinel staying unwritten. D's own PR stays OPEN throughout (a MERGED D-PR short-circuits into the already-merged reconcile path); only B's PR state varies.

**Fixture location: inline vs promoted helper.** FAFF-1077's `scaffoldRepoWithRemote` is single-branch and file-local; this test needs a two-branch stack with divergent B and D history plus a pinned anchor. **Chosen:** write a bespoke two-branch scaffold inline in the new test file, mirroring FAFF-1077's bare-remote pattern (`git init --bare` as a standalone dir, `git remote add origin <bare>`, push `main`), rather than promoting a shared helper now; promotion is recorded in OUT OF SCOPE for a future consolidation ticket.

**gh stub: new vs extend existing.** The existing `STUB_GH` in `merge-gate-controlflow.test.mjs` answers any `gh pr view <N>` from one `STUB_PR_STATE`, and does not emit `mergeCommit`. The interlock needs B's PR and D's PR to report different states in one run. **Chosen:** write a new, self-contained two-PR gh stub inside this test file that branches on the PR-number argument (`$3`) to serve B's and D's states independently, rather than mutating the shared `STUB_GH`. One stub serves both the direct-call interlock tests and the full-CLI test: for D's PR it emits `headRefOid`, `headRefName`, `state` (always OPEN), `url` (the shape `cmdMergeGate`'s own `gh pr view --json headRefOid,headRefName,state,url` reads); for B's PR it emits `state` and `mergeCommit` (the shape `observeForgeMerge` parses); it answers `repo view`, `pr checks`, and the CI `api` probes so no subcommand falls through; and it writes `pr merge`'s argv to a sentinel and exits non-zero on anything unhandled. This keeps the change inside this ticket and off an unrelated suite.

**Squash-merge simulation and the squash-safe proof.** **Chosen:** simulate B's forge squash-merge on the bare-remote `main` as a single new commit whose tree equals B's content (a squash commit), never a fast-forward of B's original commits, so B's original SHAs are absent from the post-merge `main` (asserted, e.g. `git cat-file -e` against `main`'s history fails for a B original); then run `boundedRebaseOntoMain` and assert D's resulting tree contains D's file(s) and the squashed B file, with D's own commit(s) replayed and no ghost of B's pre-squash commit objects in D's rebased history.

**Asserting `--force-with-lease`, not `--force`.** A successful push cannot distinguish the two flags against an unchanged remote, and the function exposes no injectable git seam. **Chosen:** assert the flag with a git-argv-recording shim on `PATH` (a passthrough script that appends its argv to a sentinel then `exec`s the real `git`), installed only around the `boundedRebaseOntoMain` call (save and restore `process.env.PATH`, since the function resolves `git` from the process `PATH`); then assert the recorded push line contains `--force-with-lease` and no bare `--force`. This mirrors the executable-stub-on-`PATH` technique already used for `gh`.

**Check-only preview coverage.** **Chosen:** exercise the `mutate: false` path as well as `mutate: true`: assert that with a MERGED dependency, check-only reports `gate: "satisfied"` while leaving D's branch tip and the remote unchanged (no rebase, no force-push), distinct from execute which advances D and force-pushes.

**Docker/shard-safety.** **Chosen:** no docker probe is needed (this is pure git plus a bash gh-stub, no container); confirm shard-safety by keeping all repo/remote/stub construction inside `test(...)` bodies, matching the FAFF-1137 precedent, with only cheap constants at module top level.

## 4. HOW — Behavior

**Approach.** The test file follows the FAFF-1077 conventions: `node:test` (`test`, `after`), `node:assert/strict`, `mkdtempSync` temp dirs registered for teardown in an `after` hook, a thin `git(cwd, ...args)` spawn wrapper, and direct dynamic `import` of the functions under test from `plugin/skills/faff/bin/lib/merge-gate.js`. It is invoked under the canonical `node --import ./test/hermetic-env.mjs --test test/`.

**Behavior summary: building a genuine two-branch stack.** Create a real repo with a bare-remote origin. Commit a base on `main` and push. Branch B off `main`, add B's own commit(s) that touch B's file, push B, and record B's tip SHA as the pin. Branch D off B's tip, add D's own commit(s) that touch D's file, commit D's anchor (`stack-parent.json`) carrying B's pin, push D. This yields the real precondition: D's branch carries B's commits underneath D's, and the anchor pins B's tip.

```
PROCEDURE build_two_branch_stack(repo, bare):
  1. init repo (main) + init --bare <bare>; remote add origin <bare>; commit base on main; push main
  2. checkout -b B off main; write b.txt; commit "B work"; push B
     pinnedTip := rev-parse B   # goes into the anchor as parent_tip_sha
  3. checkout -b D off pinnedTip; write d.txt; commit "D work"
  4. write .faff/anchors/<run>/<issue>/stack-parent.json
        { parent_issue, parent_pr, parent_branch: "B", parent_tip_sha: pinnedTip }
     commit "D anchor"; push D
  5. RETURN { pinnedTip, dHeadBefore := rev-parse D }
```

**Behavior summary: simulating B's squash-merge, then proving squash-safety.** On the bare-remote's `main`, land a single squash commit that carries B's content but not B's original commit objects (mirror B's `b.txt` into a fresh commit on `main`, push). Then run `boundedRebaseOntoMain(repoD, anchor, dHeadBefore)` and assert the outcome and the resulting tree.

```
PROCEDURE simulate_squash_and_rebase(repo, bare, anchor, dHeadBefore):
  1. on a main working checkout: reset/create a single commit that adds b.txt's content
        (a squash commit), NOT a merge/ff of B's commits; push origin main
  2. checkout D in repo (or use a D checkout whose HEAD is dHeadBefore)
  3. result := boundedRebaseOntoMain(repoD, anchor, dHeadBefore)
  4. ASSERT result.outcome == "ok" and result.headSha != dHeadBefore
  5. ASSERT the rebased COMMIT TREE (git show HEAD:<path>, not the filesystem) contains
        d.txt (D's change) AND b.txt (from squashed main)
  6. ASSERT D's rebased history above origin/main is EXACTLY D's own commit(s):
        git log origin/main..HEAD  -> the D commits only, no B pre-squash commit
  7. ASSERT origin/D now points at the advanced head (the push landed), AND, with the git-argv
        shim active for this call, the recorded push line carries --force-with-lease, not --force
```

**Behavior summary: the never-merge-before-B ordering, end-to-end.** Drive the real CLI with the two-PR gh stub on `PATH`. With B's PR OPEN, `faff merge-gate --execute` for D must refuse (the additive `dependency_gate` leg reads `blocked`), and no merge is attempted (the stub's merge sentinel is untouched). Flip B's PR to MERGED and the same invocation must let the dependency leg read `satisfied`.

```
PROCEDURE ordering_end_to_end(repoD, stubEnv):
  1. stub: D's PR (number dPr) OPEN, head = D's REAL committed head (so the anchor read resolves);
           B's PR (number bPr) OPEN
  2. runCli(["merge-gate","--execute","--json","--pr",dPr,"--issue","FAFF-D","--run-dir",...],
            { cwd: repoD, env: stubEnv })
     ASSERT --json blockers include the stacked-dependency blocker
            (/stacked dependency PR not yet merged/)  # the dependency leg fired blocked
     ASSERT merge sentinel NOT written                # D was never merged before B
  3. stub: flip B's PR (bPr) -> MERGED (with origin/main carrying B's squash so the rebase is clean)
  4. runCli(...same...)
     ASSERT the stacked-dependency blocker is ABSENT from blockers (the leg flipped to satisfied)
```

The full-CLI test asserts only the presence/absence of the dependency blocker and the merge sentinel, never an all-green floor: any blocker refuses and leaves the sentinel unwritten, so "never merged D before B" holds while B is OPEN regardless of the other legs, and attribution to the dependency leg comes from the blocker text.

**The gh stub, discriminating on the PR number.** The stub script switches on `$1`/`$2` for `pr view`, then on the PR-number positional (`$3`) to select which PR's state to print, reading two independent state variables from the environment (one for D's PR, one for B's PR). It emits the `{ state, mergeCommit }` shape for the interlock's `observeForgeMerge` read, and the `{ headRefOid, headRefName, state }` fields for `cmdMergeGate`'s own D-PR read. An unhandled subcommand exits non-zero loudly, matching the existing precedent.

```
PROCEDURE gh_stub(argv):   # $1=pr/repo/api, $2=view/checks/merge, $3=<PR number> for pr view
  case pr view <N>:
    if N == D_PR:  print { headRefOid: D_REAL_HEAD, headRefName: D_BRANCH, state: "OPEN", url: ... }
    if N == B_PR:  print { state: $B_STATE, mergeCommit: (B_STATE=="MERGED" ? {oid: B_MERGE_SHA} : null) }
  case pr checks:  print []            # CI probe, answered so nothing falls through
  case api ...:    print status/check-runs stubs
  case repo view:  print { nameWithOwner: ... }
  case pr merge:   write argv to $MERGE_SENTINEL; exit 0
  default:         print to stderr; exit 3
```

**Edge cases and error handling.**

- **One-shot conflict.** Construct a case where D's own commit and B's squash edit the SAME file at overlapping lines (give D a commit that modifies `b.txt`, and land the squash on `main` touching those same lines) so the single `rebase --onto` attempt conflicts. Assert `boundedRebaseOntoMain` returns `{ outcome: "conflict" }`, the working tree is clean afterwards (the abort ran, no half-applied rebase, no `rebase-merge`/`rebase-apply` state dir left), and no force-push landed on the remote. There is exactly one attempt: the test asserts no retry by observing the branch is unchanged from `dHeadBefore` after the conflict.
- **No-op rebase skips the push.** If nothing needs replaying (head unchanged), the function returns `ok` without pushing. Lower priority than the conflict and squash-safe cases; assert only if cheap to set up.
- **Check-only never mutates.** With `mutate: false` and B MERGED, assert `gate: "satisfied"`, D's local branch tip equals `dHeadBefore`, and origin/D is unchanged.

**Failure modes — how this test could mislead, and how you'd notice.**

- **The failure: a false-green squash simulation.** If the test lands B's squash on `main` as a fast-forward or a merge that keeps B's original commit SHAs, then D's rebase is trivially clean and the test passes without proving the squash-safe property. How you'd know: the assertion `git log origin/main..HEAD` would still pass, but a mutation test that reverted the squash-safe logic in `boundedRebaseOntoMain` would not fail. What it means: narrow the fixture until B's original SHAs are provably absent from post-merge `main` (assert `git cat-file -e <B-original-sha>` against `origin/main`'s history fails), else the test is not proving what the ticket asks.
- **The failure: the tree assertion passes on content the rebase did not produce.** If the test asserts file presence by reading the working directory rather than the rebased commit's tree, a stale checkout could satisfy it. How you'd know: assert against `git show HEAD:d.txt` / `HEAD:b.txt` (the committed tree), not the filesystem. What it means: proceed only with tree-based assertions.
- **The failure: the ordering test passes because the merge was refused for an unrelated floor reason.** If D's PR is also failing CI or AC in the stub, the refuse is not attributable to the dependency leg. How you'd know: assert the refuse blocker text names the stacked-dependency leg, and keep every other floor input green in the stub. What it means: narrow the stub so the only blocker is the dependency gate.

**Anti-patterns:**

**Anti-pattern:** asserting only `outcome === "ok"` for the rebase. Why: a green return with a wrong tree is the exact defect this test exists to catch; assert the tree.
**Anti-pattern:** mutating the shared `STUB_GH` in `merge-gate-controlflow.test.mjs` to add PR-number discrimination. Why: it is consumed by that suite's passing tests; a change there can regress them. Write a self-contained stub here.
**Anti-pattern:** constructing fixtures at module top level. Why: every shard imports every file at discovery, so top-level repos/remotes/spawns multiply by shard count and starve siblings (FAFF-1137).

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a two-branch stack where D is based on B's pinned tip and D's anchor records that tip
When B's PR is squash-merged onto main (a single squash commit, B's originals absent) and boundedRebaseOntoMain runs
Then it returns { outcome: "ok" } with an advanced headSha, and D's rebased commit tree contains D's own file plus the squashed content, with only D's own commit(s) above origin/main
```

```
Given a merged dependency where D and the squashed main conflict on the same lines
When boundedRebaseOntoMain makes its single rebase --onto attempt
Then it returns { outcome: "conflict" }, the rebase is aborted (no in-progress rebase state, clean tree), the branch is unchanged from before, and no force-push lands on the remote
```

```
Given a real repo driven through faff merge-gate --execute --json with the two-PR gh stub, D's PR OPEN
When B's PR reads OPEN
Then the --json blockers array includes the stacked-dependency blocker and the gh-merge sentinel is never written (D is never merged before B); and when B's PR flips to MERGED (origin/main carrying B's squash so the rebase is clean), the stacked-dependency blocker is absent from the blockers on the next invocation
```

- The force-push MUST use `--force-with-lease`, never `--force`: assert with a git-argv-recording shim on `PATH` active during the `boundedRebaseOntoMain` call, checking the recorded push invocation contains `--force-with-lease` and no bare `--force`.

## 6. DESIGN DECISION RATIONALE

**How should the mechanics be driven: direct function calls, the full CLI, or both?**
- Direct-call — pros: minimal stub surface, precise assertions on `outcome`/`headSha`/gate, isolates the two impure functions. Cons: does not exercise the `cmdMergeGate` wiring or the headSha hand-off.
- Full-CLI via `runCli` — pros: proves the wiring, the ordering floor, and the OPEN-to-MERGED flip as a user sees it. Cons: larger stub surface (D's PR view, floor inputs) and coarser assertions on the internal rebase.
- **Chosen:** both, split by purpose — direct-call for squash-safety, conflict, and the check-only fork; one full-CLI test for the never-merge-before-B ordering and the state flip. Rationale: each proves something the other cannot, and the ticket names both the squash-safe rebase and the ordering guarantee.

**Where should the two-branch fixture live?**
- Promote a shared helper to `test/helpers/` — pros: reusable. Cons: refactors a passing FAFF-1077 test with no second consumer yet; scope creep.
- Inline bespoke scaffold — pros: contained, mirrors the proven pattern, zero blast radius. Cons: a little duplication with FAFF-1077's single-branch scaffold.
- **Chosen:** inline bespoke, with promotion logged under OUT OF SCOPE. Rationale: keep this ticket to added coverage; consolidate later when a second caller exists.

**New gh stub or extend the existing one?**
- Extend `STUB_GH` — pros: one stub. Cons: it is shared with `merge-gate-controlflow.test.mjs`, does not discriminate on PR number, and omits `mergeCommit`; changing it risks that suite.
- New self-contained stub in this file — pros: isolated, tailored to two PRs and the `state`/`mergeCommit` shape. Cons: a second stub script in the tree.
- **Chosen:** new self-contained stub branching on `$3`. Rationale: the interlock's whole point is two PRs at different states in one run; the shared stub cannot express that without a change that endangers an unrelated suite.

At the time of writing, `boundedRebaseOntoMain` and `dependencyInterlock` expose no dependency-injection seam for git or `gh`; both shell out (`spawnSync`) directly. So the test must drive a real on-disk repo and shadow `gh` on `PATH`. If a future refactor introduces an injectable seam, this test could be simplified to inject fakes, but that refactor is not in scope here.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Every decision above is closed with `**Chosen:**`.

**Assumptions:**

**Assumes:** the CI and developer environments provide a POSIX `bash` (for the executable `gh` stub, chmod `0o755`, shadowed on `PATH`) and a `git` supporting `rebase --onto` and `push --force-with-lease` over local filesystem (bare-repo) transport. Validation: `test/merge-gate-controlflow.test.mjs` already writes and runs a bash `gh` stub, and `test/faff-1077-dependency-stacking.test.mjs` already pushes/fetches over a filesystem bare-remote; if those two suites pass in the target environment, this assumption holds. The build agent should run them first and stop if either is red.

## 8. DONE — Definition of Done

### From WHY
- [ ] A new test file `test/faff-1087-<slug>.test.mjs` exists, runs green under `node --import ./test/hermetic-env.mjs --test test/`, and imports `boundedRebaseOntoMain` and `dependencyInterlock` from `plugin/skills/faff/bin/lib/merge-gate.js` (a grep for those names now finds this file).
- [ ] The test asserts the squash-safe property empirically (D's rebased tree contents), not merely a green `outcome`.

### From WHAT (fixtures and interfaces)
- [ ] A two-branch stack is built with a real bare-remote: base on `main`, branch B with its own commit pushed, branch D based off B's pinned tip with its own commit, and a committed `stack-parent.json` anchor carrying `parent_pr`, `parent_branch`, and `parent_tip_sha` (B's tip SHA).
- [ ] A single self-contained gh stub in this file branches on the PR-number argument (`$3`) to serve B's and D's states independently: `{ headRefOid, headRefName, state: "OPEN", url }` for D's PR, `{ state, mergeCommit }` for B's PR; it answers `repo view`, `pr checks`, and the CI `api` probes, writes `pr merge`'s argv to a sentinel, and exits non-zero on an unhandled subcommand.
- [ ] The existing `STUB_GH` in `merge-gate-controlflow.test.mjs` and `scaffoldRepoWithRemote` in `faff-1077-dependency-stacking.test.mjs` are unchanged.

### From HOW (behaviour — squash-safe rebase)
- [ ] After B's simulated squash-merge onto `main` (a single squash commit; B's original commit SHAs are absent from post-merge `main`, asserted), `boundedRebaseOntoMain` returns `{ outcome: "ok" }` with `headSha !== dHeadBefore`.
- [ ] D's rebased commit tree (asserted via `git show HEAD:<path>`, not the filesystem) contains D's own file and the squashed content, and `git log origin/main..HEAD` shows only D's own commit(s), no B pre-squash commit.
- [ ] `origin/D` advances to the rebased head, and, with the git-argv-recording shim active during the call, the recorded push invocation carries `--force-with-lease` and no bare `--force`.

### From HOW (behaviour — ordering and state flip)
- [ ] Driven through `faff merge-gate --execute --json` with D's PR OPEN and B's PR OPEN, the `--json` `blockers` array includes the stacked-dependency blocker (`/stacked dependency PR not yet merged/`) and the gh-merge sentinel is never written (D never merges before B).
- [ ] With B's PR flipped to MERGED (origin/main carrying B's squash so the rebase is clean), the stacked-dependency blocker is absent from the `blockers` on the next invocation.

### From HOW (edge cases)
- [ ] A same-line conflict yields `{ outcome: "conflict" }`, an aborted rebase (no in-progress `rebase-merge`/`rebase-apply` state, clean working tree), an unchanged branch (proving one attempt, no retry), and no force-push on the remote.
- [ ] Check-only (`mutate: false`) with B MERGED returns `gate: "satisfied"` while D's local tip and `origin/D` are unchanged.

### From shard-safety
- [ ] All repo/remote/stub construction sits inside `test(...)` bodies; only cheap constants are at module top level. No docker probe is added.

**Integration smoke test (happy path):**

```
1. build_two_branch_stack -> { pinnedTip, dHeadBefore }
2. simulate B squash-merge on origin/main (single commit)
3. boundedRebaseOntoMain(repoD, anchor, dHeadBefore) -> { outcome: "ok", headSha }
4. assert headSha != dHeadBefore; git show HEAD:d.txt present; git log origin/main..HEAD == D's commit(s) only
   => if this passes, the real fetch/rebase --onto/force-push plumbing is connected and squash-safe
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sizing (principle 4)** — What's there: FAFF-1087 is one test-only file, but it carries five scenarios (squash-safe rebase + tree proof, same-line conflict, optional no-op, check-only `mutate:false`, and the full-CLI ordering flip) plus four pieces of bespoke fixture engineering (the two-branch bare-remote scaffold, the squash-merge simulation, the two-PR `gh` stub, and the `git`-argv `--force-with-lease` PATH shim). That is meatier than a typical single ticket, and there is a real fault line: the direct-call proofs of `boundedRebaseOntoMain` versus the `runCli` proof of the `cmdMergeGate` wiring are structurally separable. Why it's still right-sized: both halves converge on one outcome — integration coverage of the two impure functions — and they share the two-branch fixture and the `gh` stub. Splitting would either duplicate that scaffold across two files or force the shared-helper promotion the spec deliberately parks in OUT OF SCOPE, so principle 4's merge-when-always-together logic argues for keeping it whole. What to do: build it as one ticket, but treat the fixture work as the estimate driver — if the two-branch scaffold plus the two-PR stub push the realistic estimate past ~3 days, peel the full-CLI ordering scenario into a fast-follow ticket (it is the clean seam and the lower-risk half), rather than letting the file sit In Progress signalling nothing.

**Workstream fit (principles 1 + 5)** — What's there: the input envelope names FAFF-1087 as a discovered-scope follow-up from FAFF-1077 but does not surface its container (project/workstream) or a machine-readable Definition of Done, so the lens cannot confirm where it is homed. Why it matters: a test that proves the highest-risk mechanic of the dependency-stacking feature belongs alongside that feature's outcome (the dependency-stacking / verifiable-delivery stream FAFF-1077 shipped into); if it has instead been dropped into an activity-named bucket ("Tests", "Tech debt", "Coverage"), that bucket can't be sequenced — there is no shared outcome the tickets in it converge on. What to do: confirm FAFF-1087 sits in the same outcome stream as FAFF-1077 (the dependency-stacking mechanic), not a test/coverage catch-all; if no such outcome home exists yet, leave it project-less in Backlog rather than manufacturing an activity bucket for it.

**Surfaced deps (principle 6)** — No issues. The one load-bearing prerequisite — FAFF-1077, whose shipped `boundedRebaseOntoMain` / `dependencyInterlock` this test imports and exercises — is declared as an explicit blocker and is Done, so the ticket is honestly actionable now. The other references (FAFF-1137's shard-safety precedent, the `merge-gate-controlflow.test.mjs` and `faff-1077-dependency-stacking.test.mjs` conventions) are code/convention citations, not output this ticket consumes, so they correctly need no blocker link.

**Risk profile (principle 7)** — No issues; the risk is already front-loaded. What's there: as test-only work with no production change and a Done blocker, the ticket carries no late-landing delivery risk, and its one genuine hazard — a false-green fixture that passes without proving the squash-safe property — is the exact thing the spec's "Failure modes" section pre-empts (assert B's original SHAs are provably absent from post-merge `main`, assert against `git show HEAD:<path>` trees not the working directory, and attribute the ordering refusal to the dependency blocker text). The novel, unproven pieces (the squash simulation and the argv-recording PATH shim) are where a subtle fixture bug would hide, and the spec already prescribes the guards for each. No separate de-risking spike is warranted; the spec's own Assumptions gate — run `merge-gate-controlflow` and `faff-1077-dependency-stacking` first and stop if either is red — is the right and sufficient early check to keep.
