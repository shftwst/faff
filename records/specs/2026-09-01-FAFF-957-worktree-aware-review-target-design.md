# FAFF-957 — Worktree-aware review target: stop code-review reviewing the session cwd's diff

> Spec: faffter-dark-nlspec · 2026-09-01 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-957.
> build-tier: mechanical

## Why

Under a worktree build lane, `/faff-graft` builds an issue in a **linked git worktree** at `~/.faff/worktrees/<repo>/<branch>`, but the **harness session's process cwd stays at the main checkout** (e.g. `/home/faff/app`) — entering a worktree is `cd "$wt"` inside individual Bash tool calls, which never moves the harness's own cwd. This is a deliberate consequence of **FAFF-595** (de-hook worktree provisioning): graft stopped calling the `EnterWorktree` tool and now just captures the worktree path (`wt=$(bash setup-worktree.sh ...)`), operating on it via explicit `cd`/absolute paths within each foreground bash chain. So the session's true harness-level cwd — what a *freshly forked* skill inherits — was never switched into the worktree; it stays at the main checkout, which can be sitting on an unrelated branch (during the FAFF-930 build it was on the FAFF-947 work branch).

When a build agent reaches for the harness `code-review` skill (`/code-review`, forked) with **no explicit target**, that skill resolves "the current diff" against the ambient process cwd's git state. So it reviewed the main checkout's diff — surfacing findings about `decision-capture.js` (FAFF-947) and `shadow-fidelity.js` (FAFF-826) — instead of the FAFF-930 PR diff (`gh pr diff 797 --name-only` lists 19 files, none of them those). The build agent had to notice the mismatch and re-run `/code-review high 797` with an explicit PR-number target to review the real change set.

This is a **silent correctness failure**: a confidently-wrong review of an unrelated diff is worse than no review, because it can pass a build on evidence that never looked at the build's code. A worktree lane must never let an ambient-cwd default silently select the wrong tree.

**Scope boundary (load-bearing).** The harness `code-review` skill is **not** owned by this repo — it is a first-party skill compiled into the Claude Code binary, with no editable `SKILL.md` anywhere under faff's control, and it is entirely faff-unaware (no notion of worktrees, `FAFF_RUN_DIR`, or the run-ledger). faff's own `review` slot lane does **not** invoke it — `faffter-noon-review` / `faffter-dark-adversarial-review` compute a ref-to-ref remote three-dot diff (`git diff <base>...<branch>`), which is cwd-independent and already correct. The failure has two layers: a **mechanism gap** (post-FAFF-595, a forked skill inherits the main-checkout cwd) and a **process gap** (faff prose neither sanctions, forbids, nor gives a safe invocation pattern for an ad-hoc `/code-review` fork during a build). Since the skill's internals are unreachable, the faff-side fix is not "patch code-review" — it is to give the lane a **resolved, explicit target** and a **loud mismatch guard**, so any review of the build diff cannot silently bind to the wrong cwd.

## What

Two complementary faff-owned deliverables, matching the ticket's two proposed directions:

1. **A target resolver** — a new `faff review-target` CLI verb that, from the build context (run-ledger + `git worktree list` + `gh`), emits the correct explicit review target for the issue/branch under build:
   - post-PR: `pr:<n>` (the issue branch's open PR, resolved via `gh pr list --head <branch> --json number`);
   - pre-PR (faff reviews before the PR is raised): the worktree path + branch, as an explicit path/branch target and the ref-to-ref base, so a review targets `git -C <wt> diff <base>...<branch>` rather than the ambient cwd.

2. **A cwd/branch mismatch guard** — the same verb in `--guard` mode compares the **ambient cwd's HEAD branch** against the **branch under build** and, on mismatch, exits non-zero and prints the correct explicit target to use. This is the mechanical backstop: even if a target is not passed, a review that *would* silently bind to the wrong tree is refused loudly instead of producing a wrong verdict.

3. **Lane wiring** — the build-lane dispatch prompt (the `concurrency`/`graft` build dispatch) stamps an invariant: *any review of the build diff must resolve its target via `faff review-target` and pass it explicitly; never rely on `/code-review`'s ambient-cwd default.* The guard is the backstop when the invariant is not honoured.

**Decisions**

- **Chosen:** Fix on the **faff side** via a `faff review-target` resolver + `--guard`, plus a lane-dispatch invariant — do **not** attempt to change the harness `code-review` skill. Rationale: `/code-review` is a Claude Code built-in outside this repo; faff cannot edit it and must not depend on a change landing there. A faff-owned resolver + guard makes the lane robust regardless of which review path the agent reaches for, and is fully testable in this repo.
- **Chosen:** Make the resolver **worktree-aware and PR-aware**, preferring `pr:<n>` when an open PR exists for the branch and falling back to the worktree path + ref-to-ref base pre-PR. Rationale: the PR-number target is the one that demonstrably worked in the incident (`/code-review high 797`); pre-PR there is no PR, so the worktree/branch diff is the only correct target. Resolving both from one verb keeps a single source of truth for "what is the right diff here".
- **Chosen:** The mismatch guard **fails loud (non-zero) and refuses**, rather than auto-redirecting the review. Rationale: silently re-pointing a review hides the fact that the invocation was mis-targeted; a loud refuse that names the correct target both stops the wrong review and teaches the caller the right invocation — the exact recovery the human performed by hand.
- **Chosen:** Resolve the branch-under-build from the **run-ledger + worktree registry** (`git worktree list` matched on issue id → branch), not from the ambient cwd. Rationale: the ambient cwd is precisely the untrustworthy signal here; the run context is the authoritative source of what is being built.
- **Chosen:** Fail-safe direction is **refuse/park, never a silent pass** — an unresolvable target or an ambiguous branch match makes the guard refuse (demand an explicit target), consistent with faff's fail-closed review posture. Rationale: a wrong-diff review that passes is the harm being prevented; refusing is always the safe side.
- **Assumes:** The harness `code-review` skill honours an explicit `pr:<n>` / PR-number and branch/path target **cwd-independently** (the incident confirms the PR-number target works). The resolver's contract is to emit such a target; how `/code-review` consumes it is unchanged.
- **Assumes:** In a worktree build the linked worktree and its branch are discoverable via `git worktree list` and the run-ledger's admitted issue set; `gh` is available for PR resolution in the tracker-backed lane (git-only lanes have no PR, so pre-PR worktree targeting applies).
- **Punt:** Whether the harness `code-review` skill *itself* should also gain worktree-awareness (so an un-guarded ad-hoc `/code-review` in any repo behaves) is a **cross-repo change outside faff's ownership** — filed as a follow-up dependency, not built here. The faff-side guard makes the faff lane safe without it.
- **Punt:** Whether the guard should be promoted from a lane-dispatch invariant into a **hard Stop-hook** (refusing turn-end on an un-targeted review in a worktree lane) is deferred — the dispatch invariant + `--guard` verb is the v1; a hook is a later hardening if the invariant proves easy to skip.

## How (shape, not implementation)

- **New CLI verb** `faff review-target` (a pure-logic sibling of `worktree-root` / `build-progress`), two modes:
  - default/`--resolve`: given `--issue <ID>` (and/or `--run-dir`), emit the explicit target — `pr:<n>` when `gh pr list --head <branch>` finds an open PR, else a worktree/branch target (`--path <wt> --base <base> --branch <branch>`), as JSON on stdout.
  - `--guard`: compare `git rev-parse --abbrev-ref HEAD` (ambient cwd) against the resolved branch-under-build; exit 0 when they match (or when not in a worktree lane — nothing to guard), non-zero with the correct target on stderr when they mismatch.
- **Branch/PR resolution reuses existing primitives — do not invent a third resolver** (per FAFF-382's single-sourced-resolution principle):
  - `resolveGit(root, issue)` in `bin/lib/state.js` (the `faff state <issue>` core) already maps issue id → branch (`git branch --list`) → worktree path (`git worktree list --porcelain`); extend it to also carry the PR, or compose it.
  - `mainWorktreeRoot(root)` in `bin/lib/shared-infra.js` and the established **worktree-aware fallback** pattern (`git rev-parse --git-common-dir`) already used by `faff events append` / `faff effects` — resolve correctly *regardless of which git tree the cwd is in*, rather than trusting `process.cwd()`. The guard reuses this direction.
  - `remote-diff-base.sh` for the base ref (the same base the review/build-progress diffs already use), and `gh pr list --head <branch> --json number` for the PR (the incident's own recovery used `gh pr diff 797`, cwd-independent). Pre-merge, the PR number otherwise lives only in the turn context / `merge-record.json`, so the `gh`-side read is the durable resolver.
- **Lane wiring**: add the invariant clause to the build-lane dispatch prompt (`faffter-dark-concurrency-parallel` / the `graft` build dispatch, e.g. faff-graft Step 9) — resolve the target via `faff review-target` and pass it explicitly to any `/code-review`; the `--guard` call is the pre-review backstop. This closes the *process gap* (faff prose currently says nothing about ad-hoc `/code-review`).
- **No change** to `faffter-noon-review` / `faffter-dark-adversarial-review` diff computation — they are already cwd-robust; the fix is confined to the ad-hoc `/code-review` path and the guard.

**Prior art to mirror (not re-derive):** FAFF-382 (`worktree-root --assert`, fail-closed containment), FAFF-595 (the root-cause de-hook), the `faff events`/`effects` worktree-aware fallback, and the `link-skills` global-vs-worktree detection tests (`test/link-skills-worktree.test.mjs`) — all the same "detect a resolution pointing at the wrong tree and refuse/warn loudly" shape.

## Done — acceptance criteria

1. `faff review-target --resolve --issue <ID>` in a worktree build lane emits `pr:<n>` when an open PR exists for the issue's branch, and a worktree path + branch + base target when no PR exists yet — verified against a fixture run-ledger + `git worktree list` (unit-testable with `gh` stubbed).
2. `faff review-target --guard` exits **non-zero** and prints the correct explicit target when the ambient cwd's HEAD branch differs from the branch under build; exits **0** when they match, and exits **0** (no-op) when the process is not in a worktree build lane.
3. Reproduction is closed: given the incident shape — ambient cwd on branch `faff-947-...`, build lane on `faff-930-...` with PR 797 — the guard refuses and names `pr:797` (or the FAFF-930 worktree diff pre-PR), rather than allowing a review of the `faff-947` diff.
4. The build-lane dispatch prompt carries the explicit-target invariant, and a review invoked through the lane resolves and passes an explicit target (no reliance on the ambient-cwd default) — asserted by the dispatch-prompt text and an integration check that the resolved target is non-empty for an admitted issue.
5. faff's own `review` slot lane (`faffter-noon-review` / adversarial) is unchanged and still reviews the correct ref-to-ref diff — a regression guard that the fix did not perturb the already-correct path.
6. Fail-safe: an unresolvable branch/target (ambiguous or missing worktree) makes `--guard` refuse (non-zero) rather than pass — no path silently green-lights a review against an unverified tree.

## Already shipped against this surface

Related Done work on the worktree/cwd-mismatch class — **context and prior-art to mirror, none supersede this**:

- **FAFF-591** (Done) — `faff effects declare` resolved the run dir relative to cwd, missing the main checkout's `.faff/runs` from a build worktree. The *same class* as this bug (cwd-relative resolution from a build worktree), fixed for `effects` via the `git rev-parse --git-common-dir` worktree-aware fallback — the pattern to reuse — but it did **not** touch review-diff target resolution, which is still cwd-bound (this ticket).
- **FAFF-595** (Done) — de-hooked worktree provisioning (removed `EnterWorktree`); the mechanism root cause named in Why. Not a fix for the review target.
- **FAFF-208** (Done) — a *different* review-in-worktree misconfig (missing `.faffrc` → adversarial review ran on localhost default), not a diff-target bug.
- **FAFF-382** (Done) — `worktree-root --assert` fail-closed containment; the "detect wrong-tree resolution and refuse loudly" prior art the guard mirrors.
- Related-to (all in-flight, not delivering this surface): FAFF-930 (the build that hit it), FAFF-947 / FAFF-826 (the diffs it wrongly surfaced).

confidence: high
