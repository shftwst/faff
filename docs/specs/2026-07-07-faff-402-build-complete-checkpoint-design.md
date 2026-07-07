# Deterministic build-complete checkpoint + push-at-build-complete

> Spec: faffter-dark-nlspec · 2026-07-07 · interactive · confidence: high
> (spec-review: approve — architectural / infosec / QA; Punts resolved to committed decisions)

Splits graft's PR-creation step so the feature branch is pushed at **build-complete** (before review) rather than at review-pass, adds a durable **diff-hash-keyed build-complete checkpoint** (a sibling of FAFF-329's review-progress), and makes graft re-entry **resume at review** — recreating the worktree from `origin/<branch>` and skipping build/gates/AC — when the checkpoint still matches the pushed branch. Supersedes retired FAFF-395; the keystone that lets FAFF-403 reclassify a review-provider outage as retry-later instead of a rebuild.

## 1. WHY

Today all of graft's build work lives in a **disposable worktree**, and the branch is not pushed until review passes (`faff-graft/SKILL.md` Step 9b). So if graft's turn ends after a clean build but before review resolves (a review-provider outage, a mid-Phase-2 turn boundary), the worktree can be pruned and **every byte of the build is gone** → re-dispatch rebuilds. This makes the build durable at **origin** at build-complete and the worktree a **rebuildable cache**.

Principles (each rejects an otherwise-valid impl):
- **The checkpoint is a hint, never authoritative over git** — only ever lets a resume *skip* work when the current pushed diff still matches what was gated; any mismatch rebuilds. Mirrors FAFF-329's diff-identity guard.
- **A checkpoint always implies a durable branch** — push before checkpoint; a failed push writes no checkpoint.
- **The governance store stays pure** — `build-progress` is pure JSON read/write, no network/git (the diff-hash, which needs `git fetch`, is computed in graft prose, not the CLI), so it keeps a no-I/O `--selftest`.
- **The early push must not fire CI** — rests on CI being PR-gated (this repo: `on: pull_request` + `push:[main]`); a knob covers push-triggered-CI repos.

## 2. OUT OF SCOPE
- Coupling the build-progress hash to FAFF-329's review-progress hash (two independent guards, two layers).
- `faff merge-gate` reading build-progress (floor reads only ac-checklist.json + review-verdict.json; build-progress is a resume artifact, not a merge-floor assertion).
- A separate auto-merge fast-path for the early push (push at 8b never opens a PR; merge stays Step 10 only).
- Auto-detecting a repo's CI trigger topology (the manual knob covers it).
- Interactive-graft resume (L3/L4-only, like FAFF-329).

## 3. WHAT
**build-progress record** at `<run-dir>/<issue>/build-progress.json`: `{ issue, build:{ status:"complete", diff_hash, branch, pushed_at }, updated_at }`. `diff_hash` = sha256 of the remote three-dot diff (graft prose); `branch` = the pushed feature branch; `pushed_at` set when the attested push succeeded.

**New `faff build-progress` governance command** (mirrors review-progress):
- `read <run-dir> <issue>` → exit 3 if absent (not an error), else exit 0 + JSON.
- `write <run-dir> <issue> --build-complete --diff-hash H --branch B` → pure immutable fold + atomic tmp+rename; missing hash/branch → exit 2.
- `--selftest` → pure fold table, no I/O. Governance region ⇒ selftest mandatory (fatal if absent).
- Registry: REGION_MAP `"build-progress":"governance"`, REGION_SELFTEST_ARGV, COMMANDS, help.

**Chosen:** a single immutable `buildProgressApplyComplete(existing, issue, diffHash, branch, nowIso)` + atomic tmp+rename — byte-for-byte the review-progress discipline.
**Anti-pattern:** git fetch/diff inside `cmdBuildProgress` (breaks governance no-network/no-git purity; the hash is graft prose).

## 4. HOW
**New Step 8b (both modes, after Step 8 writes ac-checklist.json):** push first, hash second, checkpoint last.
1. `git push origin <branch>` — durable; no PR ⇒ no CI. Push fails → no checkpoint, next run rebuilds (safe).
2. `git fetch origin`.
3. `diff_hash = sha256(git diff origin/main...origin/<branch>)` — remote three-dot, in graft prose.
4. `faff build-progress write "$run_dir" <issue> --build-complete --diff-hash <h> --branch <branch>`.
Gated on `graft.push_at_build_complete` (default on); off → deferred-push (today's behaviour).

**Step 9b narrows to `gh pr create` only** (branch already pushed at 8b), reached only on review pass; CI fires once at PR-open. Review-fix loops between 8b and 9b push to the branch → still no PR → no CI. Knob off → 9b keeps push+create.

**Step 3 re-entry (autonomous L3/L4), no worktree:** `faff build-progress read` → exit 3 or hash-mismatch → normal path. Exit 0 AND `build.diff_hash == sha256(git fetch; git diff origin/main...origin/<branch>)` → RESUME: recreate worktree from origin/<branch>, skip the build (Step 7), re-run gates+AC (7.5/8), enter at Step 9 (review, which applies its own FAFF-329 checkpoint). Two guards, two layers.

**Chosen — worktree recreation = graft-direct.** On resume, graft runs `git fetch origin && git worktree add <path> <branch>` directly (checkout existing remote branch, no -b), NOT through the WorktreeCreate hook (which is EnterWorktree-bound and hard-wired to `-b … HEAD`). Keeps the hook single-purpose.

**Chosen — trust-vs-re-verify on resume = re-verify.** On a checkpoint-match resume, graft skips the build (Step 7) but re-runs the gate ladder (7.5) + AC (8) in the recreated worktree before review. Diff is byte-identical (hash match), so this is cheap and strictly stronger than trusting the checkpoint; the expensive build is what's skipped.

**Chosen — CI-topology = manual knob only.** `graft.push_at_build_complete` (default on). Auto-detecting workflow triggers is a future enhancement, out of scope.

**Chosen — checkpoint on review-fix push = freeze.** Written once at build-complete, not re-stamped across review-fix loops; a resume landing mid-fix rebuilds (fail-safe). Re-stamping is a future optimization, out of scope.

**Status-monotonicity on resume:** a resumed issue is already In Progress/In Review → no-op claim at Step 5, never revert.

Edge cases: push-ok/checkpoint-fail → rebuild next run; branch gone on origin → ref unresolvable → mismatch → rebuild; concurrent peer holds worktree → guarded by the Step-5 In Progress claim; missing --diff-hash/--branch → exit 2.

## 5. SCENARIOS (born-verifiable)
- Clean build passes gates+AC → Step 8b (knob on) → origin/<branch> exists, build-progress.json records complete+diff_hash+branch, NO CI triggered (no PR).
- Checkpoint diff_hash matches origin's current three-dot diff, no worktree → Step 3 recreates worktree from origin/<branch>, skips the build, re-runs gates+AC, enters at Step 9.
- Checkpoint diff_hash no longer matches (branch moved/gone) → discard checkpoint, normal rebuild.
- Review passes (resumed/first) → Step 9b opens the PR (branch already pushed), CI fires exactly once.
- Assertion (reproducibility): diff_hash at 8b == sha256(git diff origin/main...origin/<branch>) recomputed from remote refs at resume for an unchanged un-rebased branch.
- Assertion (non-interference): early push triggers zero CI; does not touch the merge-time rebase.

## 6. RATIONALE (Chosen)
Mirror review-progress exactly; remote three-dot hash in graft prose (reproducible without a worktree; keeps the CLI pure); push before checkpoint; narrow 9b to gh pr create; resume enters at review, hint-not-authoritative; merge-gate stays blind to build-progress; config knob for push-triggered-CI repos; worktree recreation graft-direct; re-verify (not trust) on resume; CI-topology manual knob; freeze (not re-stamp) the checkpoint.

## 7. ASSUMPTIONS
- **Assumes:** this repo's CI is PR-gated (`validate.yml` = on: pull_request + push:[main]) — a repo adding on:push for all branches must set graft.push_at_build_complete:false. Validate the triggers before relying on the no-CI push.
- **Assumes:** origin/main is the merge base (branch cut from main, not rebased within the resume window) — self-checking via the diff-identity guard.

## 8. DONE
**Command + schema:** `faff build-progress` is a governance command (REGION_MAP / REGION_SELFTEST_ARGV / COMMANDS / help); read→exit-3-absent/exit-0-JSON; write --build-complete --diff-hash H --branch B → schema, atomic; missing hash/branch → exit 2; --selftest pure fold passes + `regions selftest --region governance` includes it; test/build-progress.test.mjs mirrors review-progress.test.mjs.
**Hash reproducibility:** a test/assertion shows the 8b diff_hash == sha256(git diff origin/main...origin/<branch>) recomputed from remote refs; the hash lives in graft prose, not cmdBuildProgress.
**Graft edits:** new Step 8b pushes then checkpoints (both modes); gated on graft.push_at_build_complete (default on); Step 9b (knob on) = gh pr create only; Step 3 no-worktree reads the checkpoint, recomputes the remote hash, on match recreates the worktree graft-direct from origin/<branch> and enters at Step 9 (skips build, re-runs gates+AC); exit-3/mismatch → rebuild; worktree recreation checks out the existing remote branch (no -b); resumed status is a no-op claim.
**Boundaries:** merge-gate does not read build-progress; the early push triggers zero CI + does not alter rebase-before-merge.

confidence: high
