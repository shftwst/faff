# FAFF-1114 — Self-heal a graft worktree whose git admin metadata was pruned out-of-band

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1114.

This is a buildable spec for FAFF-1114, a concurrency / worktree-lifecycle bug. Audience: the build agent that will implement the fix, and the human reviewers who gate it. It describes a defensive **recovery** capability added to graft's worktree-provisioning path, reusing the FAFF-126 prune primitives and the FAFF-948 `worktree-check` contract. It is deliberately small: a new detection signal plus a git-native in-place repair, not a rebuild of the prune machinery.

## Already shipped against this surface

Read this first — it reframes the ticket. The ticket's original framing ("find and eliminate every unscoped `git worktree prune`") is **already discharged**, so this ticket is only the residual recovery half.

| Prior work | What it settled | Why this ticket does not redo it |
|---|---|---|
| **FAFF-126** (`records/specs/2026-06-22-faff-126-worktree-prune-mechanical-design.md`) | Made the prune guard mechanical: `faff worktree-prune --issue <id>` scopes removal to the run's OWN dangling admin dirs, addressed by authoritative admin-dir id, never a repo-wide `git worktree prune`. Removed every in-repo unscoped prune. | The explore confirmed: **no** raw/mutating repo-wide `git worktree prune` exists in any faff executable path (JS, shell, hook, CI). The only in-code `git worktree prune` is a read-only `--dry-run --verbose` fallback inside `parseWorktreeEntries`. So the clobber's origin is **out-of-band** (a human at the terminal, `git gc`/housekeeping, or an external tool pruning the shared clone). faff cannot delete a call site that does not exist. |
| **FAFF-948** (`records/specs/2026-09-01-FAFF-948-graft-worktree-reuse-staleness-check-design.md`) | `faff worktree-check --issue <id>` — the reuse-path freshness classifier. Contract: exit 0 fresh / 1 stale / 2 cannot-certify, with a `reason` discriminator; graft Step 3 branches on exit code and `reason`. | This ticket **extends** that contract with one new `reason`, rather than inventing a parallel detector. `worktree-check` already reuses `parseWorktreeEntries` + `ownMatches` — it is the natural home for the new detection. |

**Therefore the fix is defensive self-heal, not call-site deletion.** Prevention of an out-of-band prune is out of scope (see OUT OF SCOPE), mirroring FAFF-126's explicit "namespacing/lockfile out of scope" stance.

## 1. WHY — Problem and Principles

**The load-bearing model.** When git's per-worktree admin directory (`.git/worktrees/<id>/`) is deleted but the worktree's checkout directory survives on disk, git stops tracking that worktree entirely — yet the checkout dir and the branch ref both still exist. Recovery is possible *because* the branch ref and commits live in the shared clone's ref store and object store (never in the admin dir), and the surviving checkout carries the working-tree content. The fix restores the missing admin metadata in place rather than treating the worktree as absent.

**Problem statement.** When two faff sessions run against the same repo concurrently, an out-of-band prune of the shared clone destroys a live graft worktree's `.git/worktrees/<id>/` admin metadata; `git worktree list` no longer tracks it and every git op from that worktree fails (`fatal: not a git repository: .../.git/worktrees/<id>`). graft's Step 3 detection (`worktree-check`) then reports `reason: "no-worktree"` — indistinguishable from a genuinely-absent worktree — so graft falls through to the fresh-create path, which **collides** (the dir and branch still exist) and the build fails instead of recovering. This change makes graft detect the clobber and repair the worktree's admin metadata in place.

**Design principles.**

- **Recovery only, never prevention.** faff cannot stop an external process from pruning the shared `.git/worktrees/`. This ticket makes graft resilient to it after the fact; it adds no lock, hook, or advertised guard.
- **Fail-safe: never claim a clobber you cannot prove — symmetrically on directory AND branch.** The detection must be as conservative as FAFF-126's prune classifier. The "exactly one" guard binds **both** ends: exactly one issue-owned orphaned checkout directory, AND exactly one branch ref that maps to *that specific checkout's* path. Any ambiguity on either end (multiple issue-matching candidate dirs, multiple refs mapping to the checkout, no ref for the checkout, admin id unresolvable) degrades to the existing `no-worktree` / `cannot-certify` behaviour — never a false `clobbered-recoverable` that would drive an unwanted mutation.
- **Branch is bound to the checkout, not to the issue token.** The heal writes a branch into `admin/HEAD`; that branch must be the one this specific checkout belongs to (derived from the checkout's own path), never "any ref-store branch whose name token-matches the issue". Binding to the issue token would let a second stale issue-token branch (e.g. `faff-1114-old` alongside `faff-1114-thread-...`) silently drive the heal onto the wrong branch tip — the very unwanted-mutation-on-ambiguity this spec exists to prevent.
- **Ownership-scoped, reusing the FAFF-126 matcher.** Detection matches the orphaned checkout *directory* to the issue via the imported `ownMatches` / `tokenMatch` (whole-token, prefix-collision-safe: `faff-12` never claims `faff-126`), never a raw substring. The branch is then bound to that checkout (above), not re-matched by token.
- **Mechanics live in tested CLI code, not skill prose.** The git/filesystem surgery is fiddly and must be selftested like `worktree-prune` / `worktree-check`; graft prose only branches on an exit code, consistent with the FAFF-126 / FAFF-948 architecture (CLI owns mechanics, skill branches on exit codes).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/worktree-prune.js` | JavaScript | FAFF-126 primitives to reuse: `parseWorktreeEntries`, `worktreeAdminIds`, `ownMatches`, `tokenMatch`. Exports at `:241`. |
| `plugin/skills/faff/bin/lib/worktree-check.js` | JavaScript | FAFF-948 detector; home for the new `clobbered-recoverable` reason. Emits exit 0/1/2 + `reason` (`:101`–`:123`). |
| `plugin/skills/faff-graft/SKILL.md` | Markdown (skill) | Step 3 worktree provisioning; the exit-2 `reason` switch (`:180`–`:182`) is where graft acts on the new signal. |
| `plugin/skills/faff-graft/setup-worktree.sh` | Bash | Fresh-create path; `git worktree add -b` at `:104` is what collides today. |
| `plugin/skills/faff/bin/lib/sentry.js` | JavaScript | Abort-time WIP commit (`:1306`–`:1343`) — the WIP-safety net whose ordering this spec reconciles. |
| `records/adr/0008-liveness-is-owner-emitted-...md` | ADR | Liveness is owner-emitted, never inferred from artifacts — the tension this detection must not violate. |

**Scope statement.** This sits entirely inside graft's Step 3 worktree-provisioning decision, between "does a reusable worktree exist?" (`worktree-check`) and "create a fresh one" (`setup-worktree.sh`).

## 2. OUT OF SCOPE

- **Preventing the out-of-band prune** — a git hook, an advertised lockfile, or a namespaced admin store. *Why excluded:* faff cannot stop an external/non-faff process from pruning the shared clone; FAFF-126 already declared prevention out of scope for the same reason. *Extension point:* a future ticket could add a `.faffrc` `worktree_lock` advisory guard around the shared clone; it would live beside the FAFF-382 `worktree-root` resolver, not here.
- **Ephemeral concurrency / post-merge worktrees.** *Why excluded:* those are created and torn down path-addressed within a single operation (`post-merge.js`, the parallel executor) and are already fail-safe removed by path; a clobber of one aborts only its own throwaway operation, with no branch to strand. *Extension point:* if a future ephemeral worktree gains a durable branch worth recovering, it would call the same `faff worktree-heal` verb this ticket introduces.
- **Recovering uncommitted *index* (staging) state.** *Why excluded:* the git index for a worktree lives inside the deleted admin dir (`.git/worktrees/<id>/index`), so staging state is unrecoverable by construction. Working-tree file *content* is preserved (it lives in the checkout dir); only "what was `git add`-ed" is lost, and graft re-stages from the working tree anyway. *Extension point:* none — this is a git-structural limit, documented as a Failure mode.
- **Changing the liveness / abandonment model.** *Why excluded:* detection here is a recovery-eligibility question, not a liveness claim (see the liveness reconciliation in HOW). ADR-0008's owner-emitted heartbeat is untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Clobber | An out-of-band deletion of `.git/worktrees/<id>/` while the worktree's checkout dir survives on disk. |
| Orphaned checkout | The surviving checkout dir of a clobbered worktree: its `.git` file still names a now-missing admin dir; git ops from it fail. |
| Admin dir / admin id | git's per-worktree metadata directory `.git/worktrees/<id>/` and its id. The id is authoritative from the checkout's `.git` file `gitdir:` line, never inferred from the dir basename (FAFF-126 rule — git de-duplicates basenames with numeric suffixes). |
| Clobbered-recoverable | The new `worktree-check` reason: an orphaned checkout for this issue exists on disk AND its branch ref survives, so the admin metadata can be repaired in place. |
| Heal / repair-in-place | Recreating the minimal admin files then `git worktree repair` to re-register the surviving checkout — as opposed to deleting and recreating it. |

**New `worktree-check` detection.** When `parseWorktreeEntries` yields no entry for the issue (git has untracked the clobbered worktree), `worktree-check` runs a filesystem probe before concluding `no-worktree`:

```
FUNCTION detect_clobber(root, issue) -> ClobberFinding | null:
  wt_root      := resolved worktree root (faff worktree-root --root <root>)
  candidates   := directories directly under wt_root whose basename tokenMatches(issue)   # reuse tokenMatch
  clobbered    := [ c in candidates WHERE
                     c has a `.git` FILE (not dir) with a `gitdir: <admin>` line
                     AND <admin> path does NOT exist on disk ]                            # admin metadata gone
  IF clobbered does NOT have exactly one entry -> RETURN null                             # 0 or >1 dirs -> fail-safe
  c := the single clobbered candidate
  # Bind the branch to THIS checkout, not to the issue token. A worktree at
  # <wt_root>/<SAFE_NAME> was created for branch B where SAFE_NAME = B with '/'->'-'
  # (setup-worktree.sh). Invert that: the branch is the unique refs/heads ref whose
  # slash-flattened name equals basename(c). Require EXACTLY ONE such ref.
  refs         := [ br in `git -C root for-each-ref --format='%(refname:short)' refs/heads`
                    WHERE flatten_slashes(br) == basename(c) ]                            # flatten: '/'->'-'
  IF refs does NOT have exactly one entry -> RETURN null                                  # 0 refs (branch gone) or >1 (ambiguous) -> fail-safe
  branch       := refs[0]
  admin_id     := id parsed from c's `.git` file `gitdir:` line (authoritative, never basename)
  RETURN { worktree_path: c, branch: branch, admin_id: admin_id }
```

```
RECORD ClobberFinding:
  worktree_path : AbsPath      # the surviving orphaned checkout
  branch        : string       # the branch BOUND to this checkout: the unique refs/heads ref whose
                               # slash-flattened name == basename(worktree_path). NOT any issue-token ref.
                               # If zero or >1 refs map to this checkout, no finding is produced (fail-safe).
  admin_id      : string       # authoritative id parsed from the checkout's .git file gitdir: line
```

**`worktree-check` contract extension (additive; exit codes unchanged).**

| Exit | reason | Meaning | graft Step 3 action |
|---|---|---|---|
| 2 | `no-worktree` (existing) | Genuinely nothing on disk for this issue | Fresh-create (unchanged) |
| 2 | **`clobbered-recoverable`** (new) | Orphaned checkout + branch ref present; admin metadata gone | **Heal in place**, then continue the reuse flow |
| 2 | `ambiguous-match` / `no-branch` / `base-unresolvable` / `unreadable-behind` / `git-unavailable` (existing) | Cannot certify; a worktree may exist | Park (autonomous) / WARN (interactive) — unchanged |

The JSON body for `clobbered-recoverable` carries `worktree_path`, `branch`, and `admin_id` alongside the existing `issue` / `error` / `reason` fields, so graft acts without re-probing.

**Chosen: emit the signal as a new `reason` under the existing exit 2, not a new exit code.** Options: (a) a new `reason` under exit 2; (b) a fourth exit code (e.g. 3). *(a)* reuses the exact contract shape graft already switches on (`:180`–`:182`), needs no change to the exit-code semantics other callers rely on, and keeps `worktree-check`'s "exit 2 = could not certify a *reusable* worktree" invariant true (a clobbered worktree is not reusable until healed). **Chosen: (a).**

**New CLI verb `faff worktree-heal`.** The repair mechanics live in a new lib module `plugin/skills/faff/bin/lib/worktree-heal.js`, mirroring the `worktree-prune` / `worktree-check` shape (pure-core classifier where possible + git/fs wrapper + `--selftest`), and reusing `worktreeAdminIds` / `ownMatches` / `parseWorktreeEntries`:

```
faff worktree-heal --issue <ID> [--root DIR] [--json]
  exit 0 = healed        (worktree re-registered AND tracked by `git worktree list`; git ops work; correct branch)
  exit 1 = heal failed   (repair did not restore a tracked, working worktree)
  exit 2 = usage / nothing clobbered to heal for this issue, incl. ambiguity (fail-safe no-op)
```

**Chosen: heal mechanics in a tested CLI verb, not graft prose.** graft's exit-2 `clobbered-recoverable` branch shells one line (`faff worktree-heal --issue <ID> --root "$repo_root" --json`) and branches on its exit code — no fiddly git surgery in Markdown. This matches how FAFF-126/948 keep mechanics in selftested JS.

## 4. HOW — Behaviour

**Architecture.** Two additive pieces, one seam:

```
graft Step 3
  └─ faff worktree-check --issue ID           (FAFF-948, extended)
        exit 0 fresh   -> reuse (unchanged)
        exit 1 stale   -> rebase/park (unchanged)
        exit 2 reason:
           no-worktree            -> fresh-create (unchanged)
           clobbered-recoverable  -> faff worktree-heal --issue ID   (NEW)
                                        exit 0 -> re-enter worktree-check (now exit 0/1) -> reuse/rebase
                                        exit 1 -> park (autonomous) / WARN (interactive)
           <other reason>         -> park / WARN (unchanged)
```

Healing re-enters the existing FAFF-948 staleness gate rather than assuming freshness: a just-healed worktree is subject to the same rebase-onto-fetched-base check as any reused worktree, so no new liveness/staleness path is introduced.

**The heal procedure (empirically grounded — see Failure modes for what was ruled out).**

Plain intent: recreate exactly the admin pointer files an external prune deleted, then let git's own `worktree repair` re-register the surviving checkout.

```
PROCEDURE heal_clobbered_worktree(root, issue):
  finding := detect_clobber(root, issue)            # same probe worktree-check uses; branch is bound to the checkout
  IF finding is null: RETURN 2                       # nothing clobbered (or ambiguous) -> fail-safe no-op.
                                                     # This is the REAL idempotency route: a re-run after a heal
                                                     # finds the admin dir present, so detect_clobber yields null here.
  admin := <root>/.git/worktrees/<finding.admin_id>
  ASSERT admin does NOT exist                        # defensive only; normally unreachable — detect_clobber already
                                                     # required admin absent. If it somehow exists, RETURN 2 (no-op),
                                                     # never overwrite live admin metadata.
  1. mkdir -p admin
  2. write admin/gitdir     := "<finding.worktree_path>/.git\n"
  3. write admin/HEAD       := "ref: refs/heads/<finding.branch>\n"    # branch bound to THIS checkout (see detect_clobber)
  4. write admin/commondir  := "../..\n"             # standard non-bare layout; the step-6 verify is what catches a wrong value
  5. run: git -C <root> worktree repair <finding.worktree_path>
  6. VERIFY: git -C <finding.worktree_path> rev-parse --abbrev-ref HEAD == finding.branch
       AND   git -C <finding.worktree_path> rev-parse --verify HEAD succeeds
       AND   git -C <root> worktree list names <finding.worktree_path>   # repo-side re-registration confirmed
     IF verify passes: RETURN 0                       # healed; working tree preserved
     ELSE:             RETURN 1                        # repair did not restore a tracked, working worktree
```

**Behaviour summary.** Steps 1–4 restore the three pointer files git needs; `git worktree repair` (step 5) corrects the `gitdir` back-link and re-lists the worktree; the verify (step 6) is the born-verifiable success gate, asserting both checkout-side git ops (correct branch, resolvable HEAD) **and** repo-side re-registration (`git worktree list` names it). All commits and working-tree content survive because they never lived in the admin dir.

**Implementer note — `commondir`.** `"../.."` is correct for the standard non-bare layout (admin dir `<root>/.git/worktrees/<id>/` → common `.git` is two levels up). It is deliberately not made configurable: a non-standard layout that breaks this assumption is caught by the step-6 verify (`rev-parse` fails → exit 1 → park), never a silently mis-linked worktree. `git worktree repair` is relied on to normalise the `gitdir` back-link after the files are written.

**WIP safety and the sentry ordering (resolves design question 3).** Heal-in-place preserves working-tree *content* (it lives in the checkout dir, untouched); only the index/staging state is lost (design question 3's residual), which is out of scope and re-derivable by re-staging. Reconciliation with sentry's abort-WIP-commit path (`sentry.js:1306`): that path needs a working `.git` — on a clobbered worktree `git -C <wt> rev-parse --is-inside-work-tree` fails, so sentry's WIP commit is a silent no-op until the admin metadata is restored. **Therefore heal must run before any WIP-commit safety net can help**; once healed, the normal graft flow (including any later sentry abort) has a functioning worktree again. No change to `sentry.js` is required — only the ordering guarantee that heal precedes it.

**Anti-pattern:** re-adding the worktree with `git worktree add <path> <branch>` (with or without `-b`, with or without `--force`/`--force --force`). Why: the surviving checkout dir is non-empty, so every `git worktree add` form fails with `fatal: '<path>' already exists` (verified on git 2.39.5). This is the correction to the ticket's assumed action — `add` cannot adopt an existing directory.

**Anti-pattern:** deleting the orphaned checkout and fresh-creating from the branch as the *primary* heal. Why: it discards uncommitted working-tree content unnecessarily when repair-in-place preserves it. Clean-recreate is the *fallback* only (below), never the first move.

**Fallback on heal failure.** If `worktree-heal` returns exit 1 (repair did not restore a working worktree — e.g. a partially-corrupted checkout), graft treats it exactly like the existing non-`no-worktree` exit-2 causes: **autonomous parks** (cause: "worktree admin metadata clobbered and in-place repair failed — needs human"), **interactive WARNs** and hands it to the human (whose fallback is to `rm` the orphaned dir and let graft fresh-create off the safe branch — the branch is intact). Clean-recreate is deliberately human/last-resort, never a silent autonomous data-losing action.

**Failure modes.**

- **The failure:** the minimal admin file set is insufficient on some git version, so `worktree repair` leaves a broken/detached worktree. *How you'd know:* the step-6 verify fails (HEAD not on `finding.branch`, or `rev-parse HEAD` errors) → `worktree-heal` exits 1. Verified on git 2.39.5 that an *empty* admin dir yields a broken `(detached HEAD 0000000)`, while the three-file set (`gitdir`+`HEAD`+`commondir`) yields a correct heal. *What it means:* proceed — the verify is the guard; a false heal fails loud as exit 1 → park, never a silent bad worktree.
- **The failure:** detection false-positives and heals the wrong worktree or writes the wrong branch into `admin/HEAD`. *How you'd know:* the symmetric "exactly one" guard — exactly one issue-owned orphaned **directory** AND exactly one **ref** whose slash-flattened name maps to that directory's basename; either count ≠ 1 returns null (no heal). This closes the ambiguous-branch case: two issue-token branches (`faff-1114-thread-...` and a stale `faff-1114-old`) do not both map to one checkout's basename, and if two refs *did* flatten to the same basename the count-≠-1 rule nulls out rather than guessing. *What it means:* narrow — same fail-safe posture as FAFF-126's prune classifier, now binding on both dir and branch.
- **The failure:** the branch ref for the surviving checkout is *also* gone (a deeper clobber than observed), so recovery is impossible. *How you'd know:* `detect_clobber` finds zero refs mapping to the checkout's basename → the finding is null → `worktree-check` reports `no-worktree`, graft fresh-creates. *What it means:* proceed — with no branch ref there is nothing to recover to, and fresh-create is correct. This is the same fold-through as the ambiguity case; both are "no bindable branch → not clobbered-recoverable".

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a graft worktree whose .git/worktrees/<id>/ admin dir was deleted while its checkout dir and branch ref survive
When faff worktree-check --issue <ID> runs
Then it exits 2 with reason "clobbered-recoverable" (not "no-worktree") and reports worktree_path, branch, and admin_id
```

```
Given worktree-check reported clobbered-recoverable for an issue
When faff worktree-heal --issue <ID> runs
Then it recreates the admin metadata, git worktree list tracks the worktree again, git ops from the checkout succeed on the correct branch, and the working-tree content is preserved
```

```
Given two issue-matching candidate directories under the worktree root (ambiguous directory ownership)
When detection runs
Then it does NOT report clobbered-recoverable (fail-safe: returns null / no-worktree), and no heal mutates anything
```

```
Given one orphaned checkout for the issue but TWO issue-token branches in the ref store (e.g. faff-1114-thread-... and a stale faff-1114-old)
When detection runs and then heal is attempted
Then the branch bound to the checkout is derived from the checkout's own path (not the issue token), the heal writes that branch into admin/HEAD, and a subsequent commit lands on the checkout's real branch — never on the stale branch's tip
```

- The heal is idempotent via the null-finding path: a re-run after a successful heal finds the admin dir present, so `detect_clobber` yields null and `worktree-heal` returns exit 2 (no-op), never a double-repair.

## 6. Design Decision Rationale

**Where does the detection live — new `worktree-check` reason, or standalone probe in graft prose?**
- *worktree-check reason:* reuses `parseWorktreeEntries` + `ownMatches`, one home for all "what's the state of this issue's worktree?" questions, graft already branches on `reason`. Con: adds a filesystem probe to a classifier that was previously git-read-only.
- *graft prose probe:* keeps worktree-check pure. Con: fiddly fs logic in Markdown, untestable, duplicates the matcher.
- **Chosen:** new `worktree-check` reason `clobbered-recoverable`. The fs probe is small, ownership-scoped, and only runs on the `no-worktree`-would-have-fired path (zero cost for a normal reusable worktree).

**How is the branch bound for `admin/HEAD` — by issue token, or by the checkout's path?**
- *By issue token (any `ownMatches` ref):* simplest, reuses the FAFF-126 matcher directly. **Ruled out** — with >1 issue-token branch in the ref store (e.g. an active `faff-1114-thread-...` and a stale `faff-1114-old`, both matching the `faff-1114` token), the branch is ambiguous, the directory-only "exactly one" guard does not null it out, and heal writes the wrong branch into `admin/HEAD`; a subsequent commit lands on the wrong tip while the born-verifiable "commit includes the change" AC still passes — a silent wrong-branch mutation.
- *By the checkout's path (the unique ref whose slash-flattened name equals the checkout basename), require exactly one:* binds the branch to the specific surviving checkout, prefix- and slash-collision-safe, folds zero-ref (branch gone) and >1-ref (ambiguous) into the existing "not clobbered-recoverable → fresh-create" path.
- **Chosen:** bind by the checkout's path with an exact "exactly one ref" guard, symmetric with the directory guard. This closes the infosec fail-safe gap.

**What is the heal action?**
- *`git worktree add` (any form):* the ticket's assumed action. **Ruled out** — empirically fails `fatal: '<path>' already exists` on the surviving dir (git 2.39.5), including `--force --force`.
- *`git worktree repair` alone:* **ruled out** — with the admin dir fully deleted it errors `unable to locate repository` (repair fixes moved/broken links, it does not reconstruct a missing admin dir).
- *Recreate minimal admin files (`gitdir`+`HEAD`+`commondir`) then `git worktree repair`:* preserves the working tree, restores git ops, verified on git 2.39.5. Con: writes three git-internal pointer files directly.
- *Delete orphaned checkout + fresh-create off the safe branch:* robust but discards uncommitted working-tree content.
- **Chosen:** recreate-minimal-admin + `git worktree repair`, guarded by a post-heal verify, with delete-and-recreate as the human/last-resort fallback on verify failure. Rationale: it is the only route that both restores git ops *and* preserves the surviving working tree, honouring the same WIP-preserving disposition sentry embodies. At time of writing (git 2.39.5) `git worktree repair` cannot reconstruct a fully-missing admin dir on its own, which is why the three pointer files are recreated first; revisit if a future git gains a one-shot reconstruct.

**Where do the heal mechanics live — CLI verb or graft prose?**
- **Chosen:** a new tested CLI verb `faff worktree-heal` (`worktree-heal.js`), so the git/fs surgery is selftested like `worktree-prune`/`worktree-check` and graft prose only shells one line and branches on the exit code.

**Does this violate ADR-0008 (liveness never inferred from artifacts)?**
- **Chosen: no — and the spec states why.** ADR-0008 governs the *liveness / abandonment* signal (owner-emitted heartbeat), forbidding inference of "is this run held?" from artifact timestamps or out-of-band probes. This detection answers a different question — "is there orphaned, *recoverable* admin metadata for a worktree this run owns?" — a recovery-eligibility check, not a liveness claim. It never asserts a worktree is live/held, never reads a heartbeat, and never keys on git's `prunable` attribute (git does not list the clobbered entry, so no `prunable` attribute exists to read). No new liveness inference is introduced; ADR-0008 is untouched. No ADR promotion intent is warranted.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. The empirical git behaviour is pinned to git 2.39.5; the post-heal verify makes any version drift fail loud (exit 1 → park) rather than silently wrong, so no version question is left open.

**Assumptions.**

- **Assumes:** `faff worktree-root --root <root>` resolves the worktree root the same way `setup-worktree.sh` does (FAFF-382 single resolver). *Validation:* confirmed shipped — FAFF-382 merged (`7cf1cc5d`, #289); `setup-worktree.sh:52`–`:56` and graft Step 3 assert both call it; the build agent reuses that resolver, never a second path derivation.
- **Assumes:** the surviving checkout's `.git` file still contains its original `gitdir:` line naming the deleted admin dir. *Validation:* confirmed in the reproduction — an out-of-band prune deletes `.git/worktrees/<id>/` but does not touch the checkout's own `.git` file; the build agent should still guard the parse (a missing/garbled `.git` file → finding null → `no-worktree`, fail-safe).
- **Assumes:** the target git provides `git worktree repair` (shipped in git 2.30, Jan 2021) and honours the three-file admin reconstruction. *Validation:* `git worktree repair` presence is the supported git floor for the heal; the regression test asserts a successful heal on the CI/adopter git version, so a git that cannot heal is caught as a failing test (build-time), not as a routine runtime degrade-to-park. Verified on git 2.39.5.

## 8. DONE — Definition of Done

### From WHY
- [ ] A clobbered graft worktree (admin dir deleted, checkout + branch ref surviving) no longer drives graft into a colliding fresh-create; graft recovers it.
- [ ] No prevention mechanism (hook/lock) is added — recovery only.

### From WHAT (detection contract)
- [ ] `faff worktree-check --issue <ID>` returns exit 2 with `reason: "clobbered-recoverable"` when an orphaned issue-owned checkout with a surviving branch ref exists, and its JSON carries `worktree_path`, `branch`, `admin_id`.
- [ ] The same command still returns `reason: "no-worktree"` when nothing is on disk, and returns null-finding (no `clobbered-recoverable`) when >1 issue-matching candidate **directory** exists (directory ambiguity → fail-safe).
- [ ] `finding.branch` is bound to the surviving checkout: it is the unique `refs/heads` ref whose slash-flattened name equals the checkout basename. With zero such refs (branch gone) OR >1 such refs (branch ambiguous), detection returns null-finding (no heal), NOT a guessed branch.
- [ ] With one orphaned checkout and >1 issue-token branch in the ref store, heal writes the checkout's *own* branch into `admin/HEAD`; a post-heal commit lands on that branch, never on a stale same-token branch's tip.
- [ ] Detection reuses the imported `tokenMatch`/`ownMatches` for the **directory** match (prefix-collision-safe: an owner of `faff-11` never claims a `faff-1114` checkout); the branch is bound by path, not re-matched by token.

### From WHAT (heal verb)
- [ ] `faff worktree-heal --issue <ID> --root DIR` exists, returns exit 0 on heal / 1 on failed repair / 2 on nothing-to-heal, and is idempotent: a re-run after a successful heal returns exit 2 via the null-finding path (`detect_clobber` finds the admin dir present), never a double-repair.
- [ ] Heal mechanics live in `worktree-heal.js` with a `--selftest`, reusing `worktreeAdminIds`/`ownMatches`.

### From HOW (behaviour)
- [ ] After heal, `git worktree list` tracks the worktree and `git -C <worktree> rev-parse --abbrev-ref HEAD` equals the checkout-bound branch; `git -C <worktree> rev-parse --verify HEAD` succeeds. The verb's own exit-0 verify asserts all three (checkout branch, resolvable HEAD, repo-side list-tracking).
- [ ] Working-tree content present before the clobber is present after heal (a subsequent commit includes it).
- [ ] graft Step 3's exit-2 switch routes `clobbered-recoverable` to `worktree-heal`, then re-enters `worktree-check` (subject to the FAFF-948 staleness gate); heal-exit-1 is treated as the existing non-`no-worktree` exit-2 park/WARN case.
- [ ] Heal runs before any sentry WIP-commit could apply (no `sentry.js` change required).

### From HOW (edge cases / failure modes)
- [ ] No ref maps to the checkout basename (branch gone) OR >1 ref maps to it (ambiguous) → finding null → `no-worktree` → fresh-create (no false heal, no wrong-branch heal).
- [ ] `git worktree add` is never used to adopt the surviving dir (the collision path is gone).
- [ ] Post-heal verify failure yields exit 1 → autonomous park / interactive WARN, never a silent broken worktree.

### From reproduction (the born-verifiable regression test)
- [ ] A test simulates the clobber (create a worktree; delete its `.git/worktrees/<id>/` while the checkout dir survives) and asserts: (a) `worktree-check` reports `clobbered-recoverable` not `no-worktree`; (b) `worktree-heal` re-registers the worktree and restores working git ops on the correct branch; (c) working-tree content is preserved; (d) no `git worktree add` collision occurs.

**Integration smoke test:**

```
1. In a scratch repo, git worktree add -b feat <wt> HEAD; write a tracked WIP change in <wt>.
2. rm -rf .git/worktrees/<id>            # simulate the out-of-band clobber
3. faff worktree-check --issue feat --json   -> assert exit 2, reason "clobbered-recoverable"
4. faff worktree-heal  --issue feat --json   -> assert exit 0
5. git worktree list                          -> assert <wt> is tracked again
6. git -C <wt> add -A && git -C <wt> commit   -> assert success and the WIP change is in the commit
```

## Methodology critique (agile-delivery lens)

- **Right-sized — keep as ONE ticket.** The four parts (the `worktree-check` `clobbered-recoverable` detection reason, the `worktree-heal` verb, graft's exit-2 branch to it, and the regression test) always ship together — none delivers standalone value, and a partial merge (detection without heal, or heal without the graft branch) would leave the collision bug live. Do not split.
- **Workstream fit.** Home FAFF-1114 in the concurrency-safety / worktree-lifecycle workstream alongside FAFF-126 (scoped prune) and FAFF-948 (reuse staleness), not loose Backlog — it extends both directly.
- **Dependencies.**
  - FAFF-382 (`worktree-root` single resolver) is load-bearing and **confirmed shipped** (`7cf1cc5d`, #289) → record a `relatedTo` link (not `blockedBy` — nothing to wait on).
  - FAFF-1034 is where the clobber was observed (surfaced-during, not a code dependency) → record a `relatedTo` link. FAFF-1034 does not need this heal to land, and this heal does not block it.
- **Risk — git-version sensitivity.** The heal is empirically pinned to `git worktree repair` (git ≥ 2.30) and verified on git 2.39.5. The regression test MUST run on CI's and adopters' actual git version(s), so a git that cannot reconstruct the admin dir from the three-file set is caught as a failing test at build time — not as a routine runtime degrade-to-park that would quietly reintroduce the original failure. State the supported git floor (≥ 2.30) in the test or the verb's usage.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
