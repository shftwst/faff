# Spec — FAFF-775: Harden `link-skills-worktree.test.mjs` teardown against the `.git` rmSync race

> Spec: faffter-dark-nlspec · 2026-08-11 · autonomous · confidence: high. Full spec on Linear FAFF-775.
>
> Revised 2026-08-11 (spec-review iteration 1) — narrowed the fix to the single true race site (line 111 only), clarified the spawned children are synchronous (`spawnSync`, already exited at teardown), reframed retry-exhaustion as Node's inherited `rmSync` guarantee rather than a bespoke DoD claim, and gave the flake-regression check a deterministic re-run count.

This is a buildable nlspec-format specification for Linear issue **FAFF-775** ("Flaky teardown in link-skills-worktree.test.mjs: recursive rmdir races git on .git (ENOTEMPTY), blocks releases"). Audience: the build agent that will make the change, and the human reviewer gating it. It is a **test-only** hardening: no production or source file is touched.

## 1. WHY — Problem and Principles

**Load-bearing model.** `fs.rmSync(dir, { recursive: true, force: true })` walks a directory tree, then issues a final `rmdirSync` on each now-empty directory. If another process writes a file into a subdirectory *between* the walk and that final `rmdir`, `rmdir` sees a non-empty directory and throws `ENOTEMPTY` (or `EBUSY` on a locked handle). Node's `rmSync` has a built-in cure: `maxRetries` + `retryDelay` make it re-attempt the failed `rmdir` after a short pause, by which time the racing write has landed and the directory can be removed. The fix is to opt into that retry behaviour at the teardown sites that remove live git checkouts.

**Problem statement.** `test/link-skills-worktree.test.mjs` intermittently fails in *teardown* — not on any assertion — when its `clean()` helper recursively removes a temp git checkout whose `.git` directory is still being written by a git/node child spawned during the test; the removal throws `ENOTEMPTY: directory not empty, rmdir '/tmp/ls-main-XXXXXX/.git'`. This single flake (2868/2869 tests otherwise pass) holds the release-please `validate` job, blocking releases. This change makes the teardown removal retry the racing `rmdir` so it absorbs the write-during-removal race.

**Design principles.**

**Test-only, zero production change.** This is an explicit acceptance criterion, not a preference: no file outside `test/link-skills-worktree.test.mjs` may change, and nothing under `plugin/`, `scripts/`, `src/`, or the CLI is touched. The behaviour under test is already correct — only the cleanup is fragile.

**Fix the race at the removal, not by choreographing children.** The durable, low-surface cure is making the removal resilient (retry the `rmdir`), rather than trying to prove every spawned git/node child has fully flushed before teardown — child-exit choreography is brittle, easy to regress, and does not cover async filesystem flushes still in flight after `spawnSync` returns.

**Don't broaden past this file.** Dozens of sibling test files share the same non-retrying `rmSync` pattern. This ticket's acceptance is scoped to `link-skills-worktree.test.mjs`; a repo-wide sweep is explicitly out of scope.

## 2. OUT OF SCOPE

- **Repo-wide `rmSync` retry sweep** — every other test file uses the same non-retrying pattern. **Why excluded:** acceptance is scoped to `link-skills-worktree.test.mjs`; broadening dilutes the release-unblock and invites unrelated churn.
- **Any production/source change** — the CLI, installer (`scripts/link-skills.sh`), and `plugin/` tree. **Why excluded:** the behaviour under test passes; only the test cleanup flakes, and no-production-change is an acceptance criterion.
- **Child-process lifecycle choreography** (barrier-waiting for every spawned git/node child to fully exit before teardown). **Why excluded:** higher-surface, more brittle, and does not cover post-`spawnSync` async flushes; rejected in favour of retry.
- **Closing FAFF-770** — the open duplicate. **Why excluded:** ticket lifecycle is /faff-tidy's job, not this build's.

## 3. WHAT — Types and Interfaces

**Fix-site inventory** (the audit the ticket asks for). The discriminator is "removes a live `.git` checkout a git child may still be writing" — the only site the ENOTEMPTY race can physically occur:

| Line | Call | Removes | `.git` race possible? | Decision |
|---|---|---|---|---|
| 111 | `clean(paths)` loop | real git checkouts (`main`) with a live `.git` dir, built by `mkMainRepo()` | **Yes** — the observed flake | **Harden** (add retry options) |
| 303 | `rmSync(join(home, ".agents", "skills"), …)` | a `~/.agents/skills` dir of flat symlinks/copies — no `.git` | No | **Leave as-is** |
| 391 | `rmSync(join(home, ".agents", "skills"), …)` | same — a skills dir, no `.git` | No | **Leave as-is** |
| 65 | `rmSync(wt, …)` in `addWorktree` | a *fresh empty* mkdtemp dir, pre-`git worktree add` | No — empty, no `.git` | **Leave as-is** |

**Chosen:** Harden **only** line 111 (`clean()`) with `{ maxRetries: 3, retryDelay: 100 }`; leave lines 303, 391, and 65 unchanged.

## 4. HOW — Behaviour

**Approach.** Add `maxRetries: 3, retryDelay: 100` to the single `rmSync` call inside the `clean()` helper (line 111), preserving `recursive: true, force: true`. No signatures, call sites, or test bodies change.

**The fix (line 111).**

```
BEFORE:
  const clean = (paths) => { for (const p of paths) rmSync(p, { recursive: true, force: true }); };

AFTER:
  const clean = (paths) => {
    for (const p of paths) rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
```

**Why a retry, not a masked leak.** The git/node children are spawned with `spawnSync`/`execFileSync` — synchronous calls that have already returned before control reaches the test's `finally`. The residual writer is the OS/git flushing already-issued writes into `.git`. The bounded `3 × 100 ms` retry absorbs exactly that transient window; a directory that stays non-empty for a non-transient reason still throws after the third retry (Node's own `rmSync` contract). The change narrows a timing window; it does not hide a resource leak.

**Anti-patterns:** wrapping `rmSync` in a bare `try/catch {}` (hides genuine failures/leaks); adding `maxRetries` while dropping `force`/`recursive` (both must be retained).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given test/link-skills-worktree.test.mjs is run repeatedly (N sequential/parallel runs)
When a git/node child writes into a temp checkout's .git during that test's finally teardown
Then clean()'s rmSync retries the failing rmdir and teardown completes without throwing ENOTEMPTY/EBUSY
```

## 6. Design Decision Rationale

**How should the teardown race be cured?** Chosen: `rmSync` retry options (`maxRetries`/`retryDelay`) — built into Node ≥14, one-line, directly retries the failing `rmdir`, keeps real failures loud. Matches the resolution family of FAFF-561/FAFF-715/FAFF-686. (Rejected: barrier-wait choreography — brittle, misses async flushes; try/catch swallow — hides leaks.)

**Which sites get retries?** Chosen: only line 111 — the only site that removes a live `.git` checkout. Blanket-applying to 303/391/65 would harden non-race sites, the opposite of the audit's discriminating judgement.

**Must this stay test-only?** Chosen: test-only. No-production-change is an explicit acceptance criterion.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumes:** the repo's Node runtime is ≥14 (where `fs.rmSync` gained `maxRetries`/`retryDelay`). *Validation:* the suite runs on `node:test` (Node ≥18).

## 8. DONE — Definition of Done

### From WHY
- [ ] Deterministic re-run check: `test/link-skills-worktree.test.mjs` run **20 consecutive times**, every run exits 0 with **zero** `ENOTEMPTY`/`EBUSY` in output.
- [ ] `git diff --name-only` lists only `test/link-skills-worktree.test.mjs`.

### From WHAT
- [ ] Line 111 `clean()` `rmSync` carries `recursive: true, force: true, maxRetries: 3, retryDelay: 100`.
- [ ] Lines 303, 391, and the line-65 `addWorktree` `rmSync` are **unchanged**.

### From HOW
- [ ] `recursive: true` and `force: true` are preserved on the hardened call.
- [ ] No test body, helper signature, or `finally { clean([...]) }` call site altered beyond the one option object.
- [ ] The full file passes locally.

confidence: high
spec-review: approve
