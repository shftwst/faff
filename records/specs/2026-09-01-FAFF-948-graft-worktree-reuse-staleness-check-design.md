# FAFF-948 — Graft: check a reused worktree's base is current with `origin/main` before running gate/build code

> Spec: faffter-dark-nlspec · 2026-09-01 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-948.

## WHY

`/faff-graft` resumes an issue's **existing** worktree (matched by issue id in the worktree path) to avoid re-doing the spec commit and branch setup. That resume convenience is correct. The bug is that the reuse arm performs **no freshness check** on the worktree's base: a worktree created in a prior run keeps its original base ref indefinitely, and reuse silently runs the gate ladder and the build against that old base — old `review-call.mjs`, old gate code, old everything under `main`.

FAFF-708 already fixed the **new-create** path (`setup-worktree.sh` bases every fresh worktree off the freshly-fetched `origin/<default>` via `remote-diff-base.sh`, fail-loud). The reuse path has no equivalent. Concretely (the provenance incident): a FAFF-930 re-run reused a worktree pinned at `93a88659`, created before FAFF-915 (context-trim) and FAFF-945 (accept-bar) merged. FAFF-915's `trimContextFiles` was therefore absent from that worktree's `review-call.mjs`; the oversized adversarial review emptied out again — the exact wall those merges close — and ~15 minutes of review compute was burned on code that could not succeed. The run *looked* like it was exercising the current gate but was not. Only a manual worktree removal + fresh-off-`main` recreate fixed it.

This is the most insidious of the session's staleness footguns because it is silent and self-camouflaging: no error, just a run exercising stale tooling. Any re-run of an issue whose worktree predates a relevant merge is affected.

## WHAT

Close the reuse-path staleness gap with two coordinated changes, reusing the existing fail-loud base resolver and mirroring `worktree-prune`'s scoping discipline:

1. **A new deterministic CLI primitive `faff worktree-check --issue <id>`** that reports whether the issue's existing worktree is behind the fetched remote default branch, and by how much. It is the single home for the staleness computation — a pure-core classifier plus a git-read wrapper — so the graft prose stays thin and the logic is `--selftest`-covered, exactly as `worktree-prune` is.
2. **A staleness gate in `faff-graft` Step 3's reuse arm** (`plugin/skills/faff-graft/SKILL.md`, the "If a worktree already exists" block) that runs `worktree-check` before reusing. Fresh ⇒ reuse as today. Stale ⇒ surface a loud note and bring the worktree current with the fetched base before any gate/build step runs — never review/build on a stale base.

### Decisions

**Detection home.** **Chosen:** a new `faff worktree-check --issue <id> [--root DIR] [--behind-threshold N] [--json]` subcommand, structured as a pure-core classifier (`classifyWorktreeStaleness`, no git/fs) plus a git-read wrapper, mirroring `worktree-prune.js` one-for-one. Rationale: the issue explicitly asks for a primitive "mirroring the `worktree-prune` scoping discipline"; a CLI verb keeps the git + threshold logic deterministic and selftestable, keeps the SKILL prose declarative, and gives the same fail-safe posture (when it cannot prove a worktree is stale, it does not claim staleness).

**Base ref source.** **Chosen:** resolve the comparison base by shelling the existing `plugin/skills/faff-graft/remote-diff-base.sh` (fetched `origin/<default>`; git-only: local default), never a second base resolver. Rationale: FAFF-708 already made this the one fail-loud, never-stale base shared by provisioning and graft's diffs; a divergent resolver would reintroduce the drift class this fix exists to close. A resolve/fetch failure from that script is surfaced fail-loud by `worktree-check` (it cannot certify freshness against a base it could not fetch), never swallowed into a false "fresh".

**Staleness measure.** **Chosen:** `behind = git rev-list --count <feature-branch>..<base>` — the count of commits reachable from the fetched base but not from the worktree's branch, i.e. how many default-branch commits merged since the worktree forked. Rationale: this is exactly "how far behind `origin/main` the worktree base is"; it is a single git plumbing read, needs no forge API, and is robust to the branch's own commits sitting on top of its base.

**Staleness threshold.** **Chosen:** default threshold `0` — any `behind > 0` is stale — with an explicit `--behind-threshold N` flag (default `0`) for callers that want tolerance. Rationale: the incident proved that even a **single** missed merge (one of FAFF-915/945) silently breaks a run; a non-zero "trivial amount" tolerance would re-admit precisely the failure mode. Correctness over the reuse convenience is the issue's own stated principle. The flag exists so the discipline is a policy input, not a buried constant, but graft calls it with the default.

**Remediation on stale reuse.** **Chosen:** graft brings the reused worktree current by rebasing its feature branch onto the freshly-fetched base, in place, then continues — preserving the branch's already-committed spec/build work rather than orphaning it. If the rebase cannot complete cleanly (conflicts) under autonomous mode, graft **parks** with the loud staleness note (unexpected state), never building on a half-rebased or still-stale tree; interactive mode surfaces the same note and lets the human resolve. Rationale: rebase-onto-current-base is the issue's first offered option and preserves work; picking it over blind remove-and-recreate avoids discarding committed progress, while the conflict→park guard keeps the "never run stale/broken code" invariant hard. (Remove-and-recreate — the manual fix — remains the human's fallback when they choose it interactively; it is not the autonomous default because it discards committed branch state.)

**Loud surfacing.** **Chosen:** on staleness, graft emits a loud note to stderr and, in autonomous mode, records it in the run's `graft.md` (worktree path, base ref, `behind` count, and the remediation taken). Rationale: the bug's danger is silence; the fix must be visible in exactly the logs a `/faff-wtf` or a human post-mortem reads.

**Scope discipline.** **Chosen:** `worktree-check` operates only on the worktree it can identify for the given `--issue` via the same authoritative admin-dir / token-boundary matching `worktree-prune` uses (`ownMatches` / `tokenMatch`, reused, not reimplemented) — never a raw substring match (owning `faff-12` must not claim `faff-126`). Rationale: reuse the vetted, prefix-collision-safe matcher so `worktree-check` inherits the same fail-safe scoping and no second matcher can drift.

### Reference context

- Gap: `plugin/skills/faff-graft/SKILL.md`, Step 3 "Check for Existing Worktree" reuse arm ("If a worktree already exists: … Skip to step 5").
- Base resolver to reuse: `plugin/skills/faff-graft/remote-diff-base.sh`.
- Mirror source (shape, arg-parse, selftest, scoping matcher): `plugin/skills/faff/bin/lib/worktree-prune.js` (`classifyWorktreePrune`, `ownMatches`, `tokenMatch`, `parseWorktreeEntries`, `WORKTREE_PRUNE_SPEC`, `worktreePruneSelftest`).
- Registration touch-points to mirror: `plugin/skills/faff/bin/faff` (require ~L116 + `COMMANDS` ~L229), `plugin/skills/faff/bin/lib/regions.js` (`"factory"` map + `--selftest` map), `docs/guide/cli.md` (the row `lint-cli-doc` asserts).
- Tests: `test/impure/worktree-prune.test.mjs` is the harness pattern for the new git-read test.

## HOW

**1. `worktree-check` library (`plugin/skills/faff/bin/lib/worktree-check.js`).**
- Pure core `classifyWorktreeStaleness({ behind, threshold })` → `{ stale: behind > threshold, behind, threshold }`. No git, no fs — driven directly by a `--selftest` table (behind=0 ⇒ fresh; behind=1, threshold=0 ⇒ stale; behind=3, threshold=5 ⇒ fresh; negative/NaN behind ⇒ fail-safe stale-or-error, chosen so an unreadable count never reads as fresh).
- Git-read wrapper `cmdWorktreeCheck(args)`:
  - Parse `--issue`, `--root` (default `findRoot()`), `--behind-threshold` (default `0`), `--json` via the shared `parseArgs`/`usageError`.
  - Locate the issue's worktree by reusing `parseWorktreeEntries(root)` + `ownMatches`/`tokenMatch` from `worktree-prune.js` (import, do not copy). No matching worktree ⇒ exit `2` with a clear message (fail-safe: nothing to reuse, caller creates fresh).
  - Resolve the base ref by shelling `remote-diff-base.sh` (resolve its path adjacent to the graft skill dir). Non-zero from that script ⇒ exit `2` with the fail-loud reason (cannot certify freshness).
  - `behind = git -C <worktree> rev-list --count <feature-branch>..<base>` (branch from the located entry).
  - Emit `{ issue, worktree_path, branch, base_ref, behind, threshold, stale }` on `--json`; else a one-line human summary.
  - Exit `0` = ran & **fresh**, `1` = ran & **stale**, `2` = usage / no-worktree / base-unresolvable / git-unavailable. (Mirrors `worktree-prune`'s 0/1/2 posture; the stale signal is the exit-1 line so shell callers branch without parsing JSON.)
- Register: require + `COMMANDS["worktree-check"]` in `bin/faff`; `"factory"` + `["worktree-check","--selftest"]` in `regions.js`; a `docs/guide/cli.md` row (or `lint-cli-doc` fails CI).

**2. Graft Step 3 reuse arm (`plugin/skills/faff-graft/SKILL.md`).** Rewrite the "If a worktree already exists" block so that, before "Skip to step 5", it:
- Runs `faff worktree-check --issue <ISSUE> --root "$repo_root" --json` and reads the exit code.
- **Fresh (exit 0):** reuse exactly as today (verify branch, open, skip to Step 5).
- **Stale (exit 1):** emit the loud note (path, `base_ref`, `behind`), then remediate — `git -C "$wt" fetch` + `git -C "$wt" rebase <base_ref>` onto the fetched base. Rebase clean ⇒ continue into the reuse flow (now on a current base). Rebase conflict ⇒ **autonomous:** abort the rebase, log to `graft.md`, return `parked` (cause "reused worktree base stale and rebase conflicted — needs human"); **interactive:** WARN and hand the conflict to the human.
- **Error (exit 2):** treat as "cannot certify" — log loudly and fall through to the no-worktree fresh-create path (which itself bases off the fetched default), never a silent stale reuse.

**3. Tests (`test/impure/worktree-check.test.mjs`, mirroring `worktree-prune.test.mjs`).** Build a real tmp git repo with a base branch and a feature worktree; advance the base by one commit and assert `stale:true, behind:1, exit 1`; assert a worktree current with base reports `stale:false, behind:0, exit 0`; assert an unknown issue exits `2`. Plus the pure-core `--selftest` table above (wired into `regions.js`, so `faff regions --selftest` and the CI selftest sweep cover it).

## DONE

- [ ] `faff worktree-check --issue <id> --json` on a worktree whose branch is behind the fetched base by N>0 emits `{ stale: true, behind: N, base_ref, worktree_path }` and exits `1`.
- [ ] The same on a worktree current with the fetched base emits `stale: false, behind: 0` and exits `0`.
- [ ] No worktree resolvable for `<id>`, or the base ref cannot be fetched/resolved, exits `2` with a clear reason — never a false `fresh`.
- [ ] `faff worktree-check --selftest` runs a pure-core table (fresh / stale-at-threshold-0 / under-threshold / unreadable-count-not-fresh) and is wired into `regions.js` selftest.
- [ ] The base ref is obtained by shelling `remote-diff-base.sh`; no second base resolver is introduced (grep shows one `origin/<default>` resolution path).
- [ ] Worktree matching reuses `ownMatches`/`tokenMatch` from `worktree-prune.js` (imported, not reimplemented); owning `faff-12` never matches a `faff-126` worktree.
- [ ] `faff-graft` Step 3's reuse arm runs `worktree-check` before Step 5; on stale it emits a loud note and rebases the branch onto the fetched base, and on a rebase conflict parks (autonomous) rather than building on a stale/half-rebased tree.
- [ ] `worktree-check` is registered in the `bin/faff` `COMMANDS` map and documented in `docs/guide/cli.md` such that `faff lint-cli-doc` passes.
- [ ] `test/impure/worktree-check.test.mjs` exercises the real-git behind / current / unknown-issue cases and passes.
- [ ] The existing `worktree-prune` selftest and its consumers still pass (no regression to the shared `parseWorktreeEntries`/matcher).

## Open Questions / Assumptions

- **Assumes:** a reused worktree carries no un-pushed, uncommitted local work that must be preserved beyond its committed branch state — graft commits the spec (and build output) onto the feature branch before yielding a worktree between runs, so a rebase of that branch is a safe, work-preserving remediation. (If a repo ever left a dirty reused worktree, the rebase would refuse and the conflict→park guard catches it — fail-safe, never a silent stale build.)

confidence: high
build-tier: standard
