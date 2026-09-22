# Spec: keep dependent chains moving while a dependency's PR awaits human sign-off (FAFF-1077, branch-stacking)

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1077.

This is the formal build spec for **FAFF-1077**. Audience: the build agent that implements it, and the human reviewers who gate it. It is a **re-spec**. The prior spec chose "awaiting-approval auto-resume" and the repo owner rejected it: auto-resume only re-kicks the dependent, it does not recover throughput, because the dependent still waits for the dependency's PR to merge (days of human review) before it can build. The owner has explicitly chosen **branch-stacking** and accepts its rebase-conflict and review-scope risks as the price of recovering the review-days. This spec designs branch-stacking and the merge-order interlock that keeps it correct.

---

## 1. WHY: problem and principles

**The load-bearing model.** Today faff enforces one invariant on dependent work: *never build a dependent D against a `main` that lacks its dependency B.* It honours that invariant by **waiting**, D is parked until B's PR merges. Branch-stacking keeps the invariant's intent (D is never built against a B-less base) but changes *how*: D is built **on top of B's unmerged branch**, in parallel with B's human review, and the wait invariant is **moved from build-time to merge-time**. The new invariant is: **D's PR must never merge before B's PR.** Everything below turns on replacing one build-time wait with one merge-time interlock.

**Problem statement.** On a repo with required human PR approval (branch protection), a dependency chain advances only as fast as a human reviews each PR in turn, because faff parks each dependent until its dependency merges (`faffter-noon-concurrency-sequential/SKILL.md:25,51`, `faffter-dark-concurrency-parallel/SKILL.md:48,67`, obligation 2 at `plugin/skills/faff/references/l4.md:59`). The pain: on stacked work, throughput collapses to the human review cadence even though the dependent could have been built and reviewed concurrently. This change adds an opt-in path that builds the dependent now, on the dependency's branch, so both PRs sit in review at once.

**Design principles.**

**Correctness beats throughput at the merge boundary.** Stacking trades build-time safety for merge-time safety, never for no safety. The merge-order interlock (D never merges before B) is non-negotiable and additive: it can only ever *add* a refusal to the merge floor, never remove one. faff's existing floor (AC-verified + CI-green + own review slot + L4 holdout) and branch protection still bind D fully.

**Default-off is byte-identical to today.** With the knob unset or `off`, every code path this spec touches behaves exactly as it does now: the dependent is parked, worktrees branch off `origin/<default>`, and the merge floor gains no leg. The new behaviour exists only under an explicit opt-in.

**No `--admin`, no branch-protection bypass.** `merge-gate.js:56-61` bans `--admin` (FAFF-375) and the merge floor never bypasses branch protection. Stacking does not touch that. D still earns its own human approval; the interlock only adds an *ordering* constraint on top.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/setup-worktree.sh` | bash | Provisions the build worktree; must gain a caller-supplied base-override |
| `plugin/skills/faff-graft/remote-diff-base.sh` | bash | Resolves `origin/<default>`; the sole base source today, with no alternate-base param |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JS | The merge floor + `gh pr view` observation; host of the new interlock |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JS | `decideFloor` pure core; gains the `dependency_gate` leg |
| `plugin/skills/faff/references/l4.md` | md | Fixed `concurrency` contract; obligation 2 becomes knob-aware |
| `faffter-noon-concurrency-sequential`, `faffter-dark-concurrency-parallel` | md | Both occupants must honour the knob |
| `plugin/skills/faff/bin/lib/config.js` | JS | `graft.*` DEFAULTS namespace; gains the knob |
| `plugin/skills/faff/bin/lib/lights-out.js` | JS | `observeForgeMerge` (private today); must be factored out for reuse |
| `plugin/skills/faff/bin/lib/labels.js` | JS | `CONTROL_LABEL_DEFS`; gains a stacked-disposition label |

**Scope statement.** This fits at the seam between the `concurrency` slot's in-group serialisation (which decides *stack vs park*), `faff-graft`'s worktree provisioning (which needs an alternate base), and the merge gate (which enforces the ordering), an opt-in overlay on the existing dependent-handling path, not a new pipeline.

---

## 2. Out of scope

- **Awaiting-approval auto-resume as a standalone feature.** The rejected approach. Excluded because it recovers no review-days on its own. Extension point: a future issue could add auto-resume of D's *final rebase-and-merge* once B merges, layered on FAFF-841's bounded landing loop (`faff-graft/SKILL.md:617-762`); this spec leaves D's eventual completion to the next drain / operator re-kick.
- **External (cross-run, `faff next --blocked`) open blockers.** `next.js:19,:65,:156` and `tracker.md:70` gate on external blockers; those stay excluded from the queue, unchanged. Stacking applies only to in-run in-group *dependency* declarations that conflict analysis already partitions. Extension point: `next.js`'s `--blocked` predicate, if a future issue wants cross-run stacking.
- **Git-only stacking.** With no `origin` there is no forge PR and so no human-approval bottleneck to relieve; the premise does not apply. Excluded to avoid designing a merge-state interlock with no forge to observe. Extension point: `remote-diff-base.sh`'s git-only branch + a local-merge observation, if a future issue finds a git-only use.
- **Deep stacks (D on C on B).** Only single-level stacking (D on its direct in-group dependency B) is in scope. A transitive chain is built one level per wave as each parent reaches pr-open. Excluded to bound the rebase and interlock reasoning. Extension point: the `stack-parent.json` anchor (below) generalises to a parent chain; a future issue can walk it.
- **Choosing the merge method (squash vs merge vs rebase).** Unchanged; `MERGE_FLAG_ALLOW` (`merge-gate.js:61`) and existing config own it. The rebase-on-merge step (§HOW) is written to be correct under squash-merge, the riskiest case.

---

## 3. WHAT: vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Dependency B (blocker) | The earlier in-group member D declares a dependency on; its PR is open and awaiting human approval |
| Dependent D | The in-group member that depends on B |
| Stacking | Building D's worktree on B's unmerged pushed branch instead of parking D |
| Merge-order interlock | The merge-time gate that refuses D's merge while B's PR is unmerged |
| Base-override | A caller-supplied base ref that `setup-worktree.sh` branches D's worktree from, replacing `origin/<default>` |
| Stack anchor | `stack-parent.json`, a head-sha-pinned per-issue record naming D's parent B, B's PR, B's branch, and B's tip SHA at stack time |

**The knob.**

```
CONFIG graft.dependency_wait: ENUM { "off", "stack" }   # DEFAULTS entry in config.js, graft.* namespace
  off    # DEFAULT, park the dependent exactly as today (byte-identical)
  stack  # build the dependent on the dependency's branch; enforce the merge-order interlock
```

Read via `faff config get graft.dependency_wait -d` by the `concurrency` occupant. Unknown/unset resolves to `off` (config.js's warn-only unknown-key posture; `-d` supplies the default). Any value other than `stack` is treated as `off`.

**The stack anchor (written at stack time, committed on D's branch, pinned to D's head).**

```
RECORD StackParent:
  dependent: IssueId          # D
  parent_issue: IssueId       # B
  parent_pr: PrNumber         # B's PR (from B's TerminalToken.pr; l4.md obligation 6)
  parent_branch: BranchName   # B's head branch, read live from `gh pr view <B-pr> --json headRefName`
  parent_tip_sha: GitSha      # B's branch tip at the moment D was stacked (for the bounded rebase --onto)
  stacked_at: Timestamp

  CONSTRAINT parent_pr present AND parent_branch present   # a stack with no forge parent is a bug → fail loud
```

Committed onto D's feature branch at `.faff/anchors/<run>/<D>/stack-parent.json` (the committed-anchor location) and read at D's merge locus via `git show <D-head-sha>:<path>`, the same git-show-pinned mechanism the committed run-ledger anchor uses. The build lane cannot rewrite it after the head is set without moving the head. (Note: this is the committed-anchor pattern, not the `resolveAnchorLevel` helper, which resolves the run-ledger anchor specifically.)

**The new merge-floor leg.**

```
ENUM DependencyGate:
  "not-applicable"   # ABSENT default, no stack anchor; an ordinary merge, byte-identical to today
  "satisfied"        # B's PR observed MERGED
  "blocked"          # B's PR observed open/unmerged → refuse D's merge
```

Fed into `decideFloor(f)` as `f.dependency_gate`, mirroring the additive polarity of `decision_grant` and `integrity` (`contract-defs.js` `decideFloor`): absent ⇒ `"not-applicable"` ⇒ no-op, so every extraction that never sets it is unaffected. Validated in `computeIntegrityFloor` with the same fail-loud-on-out-of-enum posture as its siblings.

**Base-override interface to `setup-worktree.sh`.**

```
INPUT (new, optional): FAFF_WORKTREE_BASE_REF   # env var; a fully-qualified ref D branches from (e.g. origin/<B-branch>)
  ABSENT  → today's path: resolve origin/<default> via remote-diff-base.sh (byte-identical)
  PRESENT → fetch + verify that ref, branch D's worktree off it; skip remote-diff-base.sh
```

An env var (not a positional arg) is chosen so the existing direct/hook dual-mode arg parsing (`setup-worktree.sh:18-33`) is untouched and the WorktreeCreate hook contract stays byte-compatible.

**The control label.**

```
CONTROL_LABEL_DEF (labels.js): role "stacked"   # rendered <prefix>-stacked (default faff-stacked)
  machine-writable (no tracker_owned); marks D as built-and-open on an unmerged dependency
```

Consumed by `/faff-wtf`'s disposition surface so a stacked-pending dependent is legible (the issue's "legible in /faff-wtf" acceptance candidate).

---

## 4. HOW: behaviour

### Architecture and approach

Four touchpoints, in the order D flows through them:

```
concurrency occupant (obligation 2, knob-aware)
   └─ knob=stack AND B landed pr-open  →  STACK path:
        1. resolve B's PR + tip SHA from the run ledger; B's branch from `gh pr view <B-pr> --json headRefName`
        2. write StackParent anchor for D
        3. dispatch faff-graft for D with FAFF_WORKTREE_BASE_REF=origin/<B-branch>
              └─ setup-worktree.sh branches D's worktree off B's branch (base-override)
        4. D builds, opens its PR (base = B's branch, a true stacked PR), returns pr-ready
   └─ knob=off OR B not applicable  →  PARK path (today, unchanged)

merge gate (D's merge locus, obligation 7 dispatcher / bounded landing loop)
   └─ read D's StackParent anchor (head-sha-pinned)
   └─ observe B's PR state (observeForgeMerge, now factored/exported)
        MERGED  → rebase D onto updated main (bounded), re-run gates/CI, dependency_gate=satisfied → merge D
        open    → dependency_gate=blocked → refuse; D stays pr-open (stacked)
        closed-unmerged → park D (dead base)
```

### Behaviour: the STACK decision (concurrency occupant, obligation 2)

Under `graft.dependency_wait=stack`, obligation 2's "park the dependent when the blocker landed pr-open" becomes "stack the dependent". Both occupants (`faffter-noon-concurrency-sequential`, `faffter-dark-concurrency-parallel`) honour the knob identically; the fixed contract text at `l4.md:59` is amended to describe the knob-gated fork (see §Failure modes for the contract-change risk).

```
PROCEDURE decide_dependent_disposition(D, B, knob):
  1. IF knob != "stack": PARK D (cause "in-run blocker did not merge, B landed <state>")   # today, unchanged
  2. IF B did not reach pr-open (parked/errored): PARK D (cause "in-run blocker did not open a PR, B landed <state>")
  3. resolve parent_pr from B's TerminalToken.pr; parent_branch from `gh pr view <parent_pr> --json headRefName`;
     parent_tip_sha from `git rev-parse origin/<parent_branch>` after fetch
  4. IF parent_pr absent OR parent_branch absent: PARK D (fail loud, a stack needs a forge parent)
  5. write + commit .faff/anchors/<run>/D/stack-parent.json (StackParent) onto D's branch
  6. dispatch faff-graft for D with FAFF_WORKTREE_BASE_REF="origin/<parent_branch>"
  7. add the faff-stacked control label to D
```

**Anti-pattern:** stacking when B was parked or errored. Why: there is no branch to stack on; D would branch off nothing coherent. Park D instead.

### Behaviour: the base-override (setup-worktree.sh)

The override is consumed **before** the `git remote get-url origin` branch (`setup-worktree.sh:76`), as a distinct code path, so an explicit base is honoured verbatim and never silently overridden by default resolution.

```
PROCEDURE resolve_base_ref():                       # replaces the block at setup-worktree.sh:76-85
  1. IF FAFF_WORKTREE_BASE_REF is set and non-empty:
     a. git fetch -q origin <the branch component of BASE_REF>   # bounded, non-interactive (reuse remote-diff-base.sh net posture)
     b. git rev-parse --verify --quiet "<BASE_REF>^{commit}"  → FATAL exit 1 if it does not resolve (never fall back to HEAD)
     c. BASE_REF := FAFF_WORKTREE_BASE_REF ; log "basing new branch on <BASE_REF> (caller-supplied stack base)"
  2. ELSE: today's path exactly, origin present → remote-diff-base.sh; no origin → HEAD (git-only)
  3. git worktree add -b "${SAFE_NAME}" "$WORKTREE_PATH" "$BASE_REF"    # unchanged call, line 88
```

**Anti-pattern:** resolving the default base and *then* letting an override win. Why: `remote-diff-base.sh` runs a network fetch and is fail-loud; running it when an override is present wastes a round-trip and risks a spurious failure on an unrelated default-branch problem. Branch on the override first.

### Behaviour: the merge-order interlock (the central correctness gate)

**Summary:** before admitting D's merge, the gate reads D's stack anchor, observes B's PR state on the forge, and folds a `dependency_gate` leg into `decideFloor`. D can only merge once B is `MERGED`.

`observeForgeMerge` (`lights-out.js:1587-1598`, `gh pr view <pr> --json state,mergeCommit`, returns `{pr_merged, merged_head_sha}`) is **private and unexported today**, and `lights-out.js` is imported by neither `merge-gate.js` nor the concurrency occupants. Factor it into a shared module (e.g. `lib/forge-merge.js`) and export it, so the merge gate reuses one merge-state observation rather than a second `gh pr view` spelling. This reuses the same forge primitive `merge-gate.js:1230` already calls (`ghJson(["pr","view",...])`) and the same MERGED-state reading as the already-merged reconcile (`merge-gate.js:1242,1276`).

```
PROCEDURE dependency_interlock(D, floor):            # in cmdMergeGate, before decideFloor
  1. anchor := git show <D-head-sha>:.faff/anchors/<run>/D/stack-parent.json (git-show-pinned, the committed-anchor pattern)
  2. IF anchor absent: floor.dependency_gate := "not-applicable" ; RETURN   # ordinary merge, byte-identical
  3. obs := observeForgeMerge(anchor.parent_pr)       # {pr_merged, merged_head_sha}, or forge-state read
  4. IF obs is CLOSED-and-not-merged:
       PARK D (cause "stacked dependency <B> PR closed without merging, D's base is dead", reconsider: human)
       RETURN park   # never reaches decideFloor
  5. IF NOT obs.pr_merged:
       floor.dependency_gate := "blocked"             # decideFloor adds the refusal; D stays pr-open
       RETURN
  6. obs.pr_merged is true:
       rebase_result := bounded_rebase_onto_main(D, anchor.parent_tip_sha)   # see below
       IF rebase_result == conflict: PARK D (reconsider: human) ; RETURN park
       re-run D's gates + CI on the rebased head (rebase-before-merge, the parallel occupant's discipline)
       floor.dependency_gate := "satisfied"           # decideFloor adds no refusal on this leg
```

`decideFloor` gains exactly one line, additive and last:

```
IF f.dependency_gate === "blocked":
    blockers.push("stacked dependency PR not yet merged, D must not merge before its dependency (FAFF-1077)")
```

Because the leg only ever pushes a blocker (never removes one) and defaults to `"not-applicable"`, an ordinary non-stacked merge is unaffected, and a stacked D is strictly *more* gated than today, never less. The interlock does **not** read GitHub approval state (the floor never has; `merge-gate.js` surfaces a required-approval block as a generic refuse), it reads only B's *merge* state.

### Behaviour: rebase-on-merge (bounded)

**Summary:** once B merges, D's branch still carries B's original commits; rebase D's own commits onto the updated main, dropping B's now-merged commits, so D's final diff is D-only against the real main.

```
PROCEDURE bounded_rebase_onto_main(D, parent_tip_sha):
  1. git fetch -q origin <default>
  2. git rebase --onto origin/<default> <parent_tip_sha> <D-branch>
       # replays ONLY D's own commits (those after B's tip) onto the merged main;
       # B's commits are dropped (already in main, however B was merged, squash/merge/rebase)
  3. IF rebase reports conflict:
       git rebase --abort
       RETURN conflict          # caller parks D, reconsider: human
  4. git push --force-with-lease origin <D-branch>   # update D's PR head to the rebased branch
  5. RETURN ok
```

Recording `parent_tip_sha` at stack time is what makes `--onto` precise: it replays D-and-only-D's commits, which is correct even under squash-merge (where B's squashed commit on main has a different SHA than B's originals). A single rebase attempt is the bound; a conflict is not retried, it parks.

### Edge cases and error handling

- **Anchor present but B's PR unresolvable on the forge** (`gh pr view` fails, not a clean CLOSED/MERGED): treat as retryable, refuse this attempt with a transient note (the not-ready → retry-later routing, `faff-graft/SKILL.md:576`), do not park; a forge blip must not kill a live stack.
- **B merges between step 3's observation and step 6's rebase:** benign, the rebase fetches fresh `origin/<default>` at rebase time, so it always targets the true current main.
- **D reaches merge while B still open, repeatedly across drains:** each attempt refuses via `dependency_gate=blocked`; D stays `pr-open` with the `faff-stacked` label. No park, no error, D's human review proceeds in parallel the whole time (the throughput win). D's final merge lands on the drain after B merges.
- **Git-only mode (no origin):** the knob's `stack` value degrades to `off` with a one-line warn; there is no forge PR to await (see OUT OF SCOPE). The base-override env is never set by the occupant in git-only mode, so `setup-worktree.sh` takes its unchanged HEAD path.
- **CI correctness:** D's PR CI runs against B+D while stacked (D's branch = B's branch + D's commits), which is *correct*, D is exercised with its dependency present, not against a B-less main. After B merges and D rebases, CI re-runs against main+D on the new head before the merge is admitted (step 6 re-validation). Both states are correct; neither tests D in isolation from its declared dependency.

### Failure modes

- **The failure:** amending obligation 2 (a fixed, gateway-owned `concurrency` contract at `l4.md:59`) diverges the two occupants, one honours the knob, one still hard-parks. **How you'd know:** a stack run under the parallel executor builds D while the same run under sequential parks it, or `validate-adapters` / `runcheck` flags an occupant that ignores the knob. **What it means:** narrow, the contract text and *both* occupant SKILL.md refer-backs must land together in this ticket, or ship neither. A DONE item pins both.
- **The failure:** GitHub does not auto-retarget D's PR base to main when B merges (the review-scope benefit of a true stacked PR rests on this), so after B merges D's PR shows a stale base against a deleted branch. **How you'd know:** D's PR base still points at `<B-branch>` after B merges, or the PR errors on a deleted base branch (`--delete-branch` is faff's default, `faffter-noon-ship`). **What it means:** proceed but defensively, the rebase-on-merge step force-pushes D's branch and D's merge is admitted against `origin/<default>` regardless of what the PR *displays*; the retarget is a review-ergonomics nicety, not a correctness dependency. This is captured as an **Assumes:** with a validation step, not a load-bearing claim.
- **The failure:** stacking builds D on a dependency that never merges (B's PR rejected), so D's build effort is spent on a dead base. **How you'd know:** B's PR observed CLOSED-not-merged at D's merge locus. **What it means:** accepted risk (the owner signed up for it), park D loudly with the dead-base cause; its work is preserved on the branch for a human to salvage or discard.

**Anti-pattern:** making the interlock remove or weaken any existing floor leg to "let the stack through". Why: the interlock is additive by construction; the moment it can subtract, stacking can merge D on an unreviewed or CI-red base. It may only add the ordering refusal.

---

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given graft.dependency_wait=stack and B landed pr-open in the collision group
When the concurrency occupant decides D's disposition
Then D's worktree is created off origin/<B-branch> (not origin/<default>), D's PR opens, and D carries the faff-stacked label
```

```
Given graft.dependency_wait=off (default) or unset
When any in-group dependent whose blocker landed unmerged is handled
Then it is parked exactly as today and no worktree branches off anything but origin/<default> and decideFloor gains no dependency_gate blocker
```

```
Given graft.dependency_wait=stack and B's PR is closed without merging while D is stacked on it
When faff reaches D's merge locus
Then D is parked with cause naming the dead base and reconsider:human, and D never merges
```

- The merge-order interlock MUST be additive: `decideFloor` with `dependency_gate:"not-applicable"` MUST return byte-identical verdicts to `decideFloor` called without the field.

---

## 6. Design decision rationale

**Where does the `stack vs park` decision live, and what is the knob named?**
- Options: (a) `graft.dependency_wait: off|stack` in the `graft.*` namespace; (b) a `concurrency.*` knob owned by the slot that runs obligation 2.
- (a) pro: graft owns the build/landing loop and the worktree provisioning + rebase mechanics the knob drives; matches the `graft.*` config precedent (`graft.review_outage_retry_limit`, `config.js`). con: the *disposition fork* physically sits in the concurrency occupant.
- (b) pro: co-located with obligation 2. con: fragments graft's stacking config across two namespaces.
- **Chosen:** `graft.dependency_wait: off | stack` in `graft.*`, the occupant *reads* it, graft *owns* the mechanics; one namespace for the whole feature. Default `off`.

**How is the merge-order interlock realised, a new floor leg, or a pre-gate check?**
- Options: (a) a `dependency_gate` leg inside `decideFloor`; (b) a standalone check in `cmdMergeGate` before `decideFloor`.
- **Chosen:** a `dependency_gate` leg in `decideFloor`, additive and defaulting to `"not-applicable"`, exactly like the `decision_grant` and `integrity` legs, so the interlock is a first-class, contract-validated part of the merge floor rather than a bolt-on, and `computeIntegrityFloor` validates it with the same fail-loud posture. The *observation* (reading B's PR state) stays impure in `cmdMergeGate` and feeds the pure leg, mirroring how observed CI feeds the pure core.

**What does D's PR target, B's branch, or main?**
- Options: (a) target B's branch (true stacked PR, GitHub shows D's own diff only, auto-retargets to main when B merges); (b) target main (shows B+D until rebase).
- (a) pro: clean, D-only review scope during the parallel-review window, which is the whole point of stacking; auto-retarget on B's merge. con: relies on GitHub's retarget behaviour and interacts with `--delete-branch`.
- (b) pro: no dependence on retarget. con: reviewers see B+D, defeating the review-scope benefit.
- **Chosen:** target B's branch (true stacked PR). The review-scope win is why the owner chose stacking; the retarget is treated as ergonomics, not correctness, D's merge is admitted against `origin/<default>` via the rebase step regardless of PR display (see the Assumes and the second failure mode).

**How is the rebase bounded and made squash-safe?**
- Options: (a) `git rebase origin/<default>` (replays the whole branch including B's commits); (b) `git rebase --onto origin/<default> <parent_tip_sha> <D-branch>` (replays only D's commits).
- **Chosen:** `--onto` from the recorded `parent_tip_sha`. Under squash-merge B's originals are not on main, so (a) would replay them and conflict/duplicate; (b) drops them cleanly. One attempt; conflict parks (accepted risk).

**How does the disposition become legible in `/faff-wtf`?**
- **Chosen:** a `faff-stacked` control label (`labels.js` `CONTROL_LABEL_DEFS`, machine-writable role, rendered `<prefix>-stacked`) applied when D is stacked-and-open, plus a ledger disposition, so `/faff-wtf` can count and name stacked-pending dependents. A stacked-open D is recognised by the `faff-stacked` label plus its live PR (its in-progress status); `faff next` is unchanged, since it has no PR awareness and its kernel signature is frozen by a decision-capture invariant.

**Git-only behaviour.**
- **Chosen:** `stack` degrades to `off` (with a warn) when no `origin` exists, no forge PR, no approval bottleneck, no interlock to observe. Keeps the feature forge-only and avoids a meaningless local-merge interlock.

At the time of writing, GitHub auto-retargets an open PR's base branch to the merged base when the head's base branch is merged and deleted; the design does not depend on this for correctness, only for review ergonomics.

---

## 7. Open questions and assumptions

**Open Questions.** None blocking. (No `**Punt:**` markers, the central decision and its hard parts are settled per the owner's choice.)

**Assumptions.**

- **Assumes:** GitHub retargets D's open PR base to `origin/<default>` when B's PR merges (and B's branch is deleted by `--delete-branch`). *Validation:* in a scratch repo, open PR-D against branch-B, merge PR-B with delete-branch, confirm PR-D's base becomes the default branch and PR-D stays open. If it does not, the rebase-on-merge force-push still corrects D's head and the merge is admitted against `origin/<default>`; only the PR's displayed base is affected.
- **Assumes:** `observeForgeMerge` (`lights-out.js:1587-1598`) can be factored into a shared module and imported by `merge-gate.js` without pulling in lights-out's run context. *Validation:* the build agent moves the function + its `gh pr view --json state,mergeCommit` call into `lib/forge-merge.js`, confirms `lights-out.js` still resolves it, and confirms `merge-gate.js` imports it with no new lights-out dependency.
- **Assumes:** B's head branch is retrievable from `gh pr view <B-pr> --json headRefName` and exists on `origin`. *Validation:* read `headRefName` for B's PR and confirm it against `git ls-remote origin` before writing the stack anchor; fail loud on a missing branch.

---

## 8. DONE: definition of done

### From WHY
- [ ] With `graft.dependency_wait` unset/`off`, an in-group dependent whose blocker landed unmerged is parked exactly as today (byte-identical park cause), and no worktree branches off anything but `origin/<default>`.
- [ ] With `graft.dependency_wait=stack`, a dependent whose dependency landed pr-open is built (not parked) on the dependency's branch.

### From WHAT (types and interfaces)
- [ ] `graft.dependency_wait` exists as a `graft.*` DEFAULTS entry in `config.js` with default `off`, enum `{off, stack}`, read via `faff config get -d`; any non-`stack` value resolves to `off`.
- [ ] `stack-parent.json` is written and committed on D's branch at `.faff/anchors/<run>/<D>/stack-parent.json` with `{dependent, parent_issue, parent_pr, parent_branch, parent_tip_sha, stacked_at}`, read at the merge locus via `git show <D-head-sha>:<path>`, and fails loud if `parent_pr` or `parent_branch` is absent.
- [ ] `decideFloor` accepts `dependency_gate ∈ {not-applicable, satisfied, blocked}`, defaulting to `not-applicable` when absent; `computeIntegrityFloor` validates it fail-loud on out-of-enum.
- [ ] `setup-worktree.sh` reads `FAFF_WORKTREE_BASE_REF`; when set it fetches + verifies the ref and branches off it, when unset it takes today's `remote-diff-base.sh`/HEAD path unchanged.
- [ ] A `faff-stacked` control label is defined in `labels.js` `CONTROL_LABEL_DEFS` (machine-writable, rendered `<prefix>-stacked`).

### From HOW (behaviour)
- [ ] Under `stack`, the concurrency occupant dispatches D's graft with `FAFF_WORKTREE_BASE_REF=origin/<B-branch>` and applies the `faff-stacked` label; under `off` it parks.
- [ ] `decideFloor` pushes a dependency-not-merged blocker exactly when `dependency_gate === "blocked"`, and pushes nothing on `satisfied` or `not-applicable`.
- [ ] `decideFloor` with `dependency_gate:"not-applicable"` returns byte-identical verdicts/blockers to the same inputs without the field.
- [ ] `observeForgeMerge` is factored into a shared module, exported, and imported by `merge-gate.js`; `lights-out.js` still resolves it.
- [ ] At D's merge locus: B MERGED ⇒ rebase + re-run gates + merge; B open ⇒ refuse, D stays pr-open; B closed-unmerged ⇒ park D with dead-base cause + reconsider:human.
- [ ] The rebase uses `git rebase --onto origin/<default> <parent_tip_sha> <D-branch>` and force-pushes with lease on success; a conflict aborts and parks D (reconsider:human).
- [ ] The interlock never reads GitHub approval state and never bypasses branch protection or issues `--admin`.

### From HOW (edge cases)
- [ ] A transient `gh pr view` failure at the interlock refuses-as-retryable (not park).
- [ ] Git-only mode: `stack` degrades to `off` with a warn; no base-override is set.
- [ ] Both concurrency occupants (`faffter-noon-concurrency-sequential`, `faffter-dark-concurrency-parallel`) honour the knob, and `l4.md` obligation 2 is amended to describe the knob-gated fork, all in this ticket.

### From composition
- [ ] `faff next --blocked` external-blocker behaviour is unchanged (verified no regression on the `next.js` `--blocked` path).
- [ ] A stacked-open D is recognised by the `faff-stacked` label plus its live PR; `faff next` is unchanged (no new PR awareness, signature frozen).

**Integration smoke test:**

```
PROCEDURE smoke():
  1. set graft.dependency_wait=stack
  2. run a collision group [B, D] where D declares a dependency on B, B opens PR pr-open
  3. assert: D's worktree branched off origin/<B-branch>; D's PR opened; D labelled faff-stacked
  4. attempt D merge with B still open → assert refuse (dependency_gate blocker), D stays pr-open
  5. merge B → next drain: assert D rebased --onto main, gates re-run, D merges after B
```

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
