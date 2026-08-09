# Spec — FAFF-545: git-only merge-gate `--local` peer-worktree desync

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-545.

This spec is for the build agent implementing FAFF-545, and for the human reviewers gating it. It fixes a git-only merge-gate bug where the `--local` fast-forward corrupts a peer worktree's index. The whole change lives in one function in `merge-gate.js` plus new coverage in the existing local-merge test file.

## 1. WHY — Problem and Principles

**The load-bearing model.** `git update-ref` moves a branch ref *directly*, touching no working tree — and, critically, it **bypasses git's own "this branch is checked out in another worktree" guard**. That guard is exactly what makes `git checkout` / `git branch -f` refuse to move a branch that's live in a peer checkout. So when the base branch is checked out in a peer worktree, a raw `update-ref` on it silently desyncs that worktree: its HEAD now names the new commit while its index still reflects the old tree.

**Problem statement.** On a no-remote repo (git-only, so `faff merge-gate --local` is the merge path) where `main` is checked out in a peer worktree, every `--local` merge advances `refs/heads/main` via `git update-ref` and leaves the peer checkout's index stale — `git status` there shows phantom staged-deletes, forcing a manual `git reset --hard HEAD` after each merge. This change lands the fast-forward through git's worktree-aware machinery when the base is checked out elsewhere, so the peer's index and working tree stay consistent.

**Design principles.**

- **Never desync a worktree you don't own.** The gate must leave every checkout in the repo — the operator's peer worktrees included — in a consistent state. A merge that requires the operator to run `git reset --hard` afterwards is a defect, not a rough edge.
- **Fail closed on the unsafe sub-case.** When the base is checked out in a peer worktree that can't be safely advanced (a dirty working tree, or an anomalous multi-checkout), refuse with guidance rather than clobber the operator's uncommitted work. A refusal is recoverable; an overwrite is not.
- **Single-worktree behaviour is byte-for-byte unchanged.** The overwhelmingly common layout has nothing else checking out the base; that path must keep the exact `update-ref` compare-and-swap it has today.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` → `cmdMergeGateLocal` | Node (dependency-free) | Holds the buggy land step (line ~628); the whole fix lives here. |
| `plugin/skills/faff/bin/lib/worktree-prune.js` → `parseWorktreeEntries` | Node | Already parses `git worktree list --porcelain` into `{ path, branch, prunable, id }` (exported); the detection helper mirrors this shape. |
| `plugin/skills/faff/bin/lib/merge-fence.js` | Node | The PreToolUse deny-matcher for raw base-ref mutation. References `update-ref` only to *deny* it — not a mover; confirms merge-gate.js is the sole sanctioned base-ref mover. |
| `test/merge-gate-local.test.mjs` | Node test | The git-only merge path's CLI-boundary tests; new peer-worktree coverage lands here. |

**Scope statement.** This is a localised correctness fix inside the git-only (`--local`) branch of the merge-gate interlock; it does not touch the `--pr` path or the pure floor contract (`decideFloor`).

## Already shipped against this surface

Related but **not superseding** — the premise (the `--local` peer-worktree desync) is a genuine, un-covered delta:

- **FAFF-526** (Done) shipped the `--local` git-only merge path itself — this bug lives in the code that ticket introduced; it is not covered by it.
- **FAFF-537** (Done) fixed a *different* merge-gate bug (bare `--squash/--merge/--rebase` flags silently dropped) — unrelated to the land step.
- **FAFF-350 / 365 / 375 / 376 / 434** (Done) all harden the `--pr` (`gh pr merge`) path — a different land mechanism where the worktree-desync class cannot arise.
- **FAFF-442 / 443 / 82 / 382** (Done) touch git worktrees, but for the parity harness / skill-symlink / concurrency-namespacing / lights-out-root concerns — none is the merge-gate land step.

## 2. OUT OF SCOPE

- **The `--pr` path.** Excluded — it merges via `gh pr merge`, never `update-ref`, so the worktree-desync class cannot arise there. Extension point: none needed; the bug is structurally local to `cmdMergeGateLocal`.
- **Post-move `reset --keep` refresh (fix direction 2).** Excluded as the chosen mechanism — see Design Decisions. It's a strictly weaker way to reach the same end state than letting git's merge machinery do the refresh. Extension point: n/a (rejected alternative).
- **General ancestry / fork-point base resolution.** Excluded — `resolveLocalBase` stays main-or-master-or-explicit, unchanged (§2 of FAFF-526 already scoped this out). Extension point: `resolveLocalBase` in merge-gate.js.
- **The "execute-on-plain-call" UX/doc note.** The ticket's secondary note (plain `--local` executes; the non-executing mode is `--check-only`) is a doc/help-text clarity item, not a code defect, and is consistent with the `--pr` path. Excluded here. Extension point: the merge-gate help text / `--check-only` flag description — a separate doc-pass ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Base worktree | A git worktree (other than the invoking cwd) that has the resolved base branch (`main`/`master`/`--base`) checked out. |
| Peer worktree | Any linked worktree of the same repo other than the one the command runs in. |
| Worktree-aware land | Advancing the base ref by running `git -C <base-worktree> merge --ff-only <branch>` inside the checkout that holds it, so its index + working tree refresh with the ref move. |

**Detection helper (pure).**

```
FUNCTION baseCheckedOutWorktree(entries, base) -> { path } | { anomaly: true } | null:
  # entries: parsed `git worktree list --porcelain` rows, each { path, branch }
  #   where branch has the refs/heads/ prefix stripped (parseWorktreeEntries shape).
  #   Detached-HEAD entries have branch = null and never match.
  matches := entries WHERE entry.branch == base
  IF matches is empty:      RETURN null          # Case A — base checked out nowhere
  IF matches has one:       RETURN matches[0]     # Case B — the base worktree
  RETURN { anomaly: true }                        # >1 (git normally forbids) — treat as unsafe
```

The invoking cwd worktree holds the *feature* branch (the command already refuses when `base == branch`), so it never appears in `matches`. Reuse the exported `parseWorktreeEntries` (or an equivalent minimal porcelain parse) rather than re-deriving the format.

**Land outcome.** The land step resolves to exactly one of: `landed-via-update-ref` (Case A), `landed-via-peer-merge` (Case B, clean), or `refuse` (Case B unsafe, or either git command failing). The surrounding result shape (`{ verdict, merged, blockers, ci_state, head_sha, integrity, warnings }`) is unchanged.

## 4. HOW — Behavior

**Architecture and approach.** Only the land step of `cmdMergeGateLocal` changes — everything upstream of it (remote-empty bypass guard, merge-args parse, human-flag fence, level resolution, branch/base resolution, idempotent already-merged short-circuit, ff-only precondition, fresh `runLadder` CI-equivalent, `decideFloor`, `--check-only` early return, and the head-pin re-assert) stays exactly as it is. At the point where the code today unconditionally runs `git update-ref` (merge-gate.js ~628), it now branches on whether the base is checked out in a peer worktree.

**Behavior summary.** Advance the base ref the safe way for the current worktree topology: directly via compare-and-swap `update-ref` when nothing else has the base checked out, or through git's own `merge --ff-only` inside the base worktree when a peer holds it — refusing rather than desyncing or clobbering when that peer can't be safely advanced.

```
PROCEDURE land_local_merge(cwd, base, branch, baseShaBefore, headShaNow):
  # Reached only after: idempotency + ff-only precondition + head-pin re-assert all passed,
  # and verdict != refuse (or a recorded human override). headShaNow == headShaBefore here.

  1. entries := parse `git worktree list --porcelain` (run in cwd)
     a. IF the porcelain read fails → REFUSE, blocker:
        "cannot enumerate git worktrees to land safely — re-run faff merge-gate --local"
  2. peer := baseCheckedOutWorktree(entries, base)

  3. IF peer == null:                      # Case A — single-worktree / base checked out nowhere
     a. upd := git update-ref refs/heads/<base> <headShaNow> <baseShaBefore>   # UNCHANGED, CAS-safe
     b. IF !upd.ok → REFUSE, blocker: "local base-branch update failed: <upd.stderr>"
     c. ELSE → landed (merged = true)

  4. ELSE IF peer.anomaly:                 # base checked out in >1 worktree (git normally forbids)
     a. REFUSE, blocker:
        "base '<base>' is checked out in multiple worktrees — cannot land safely; reconcile the worktrees first"

  5. ELSE:                                 # Case B — base checked out in exactly one peer worktree
     a. IF peer worktree is dirty (git -C <peer.path> status --porcelain non-empty):
        REFUSE, blocker:
        "base '<base>' is checked out with uncommitted changes in <peer.path> —
         commit or stash them, then re-run faff merge-gate --local (refusing rather than overwrite)"
     b. mrg := git -C <peer.path> merge --ff-only <branch>
     c. IF !mrg.ok → REFUSE, blocker:
        "fast-forward of '<base>' in peer worktree <peer.path> failed: <mrg.stderr>"
     d. ELSE → landed (merged = true)

  6. ON landed:
     a. result.merged := true; result.verdict := "merge-ok"
     b. writeMergeRecord(runDir, issue, null, headShaNow, integrity.display)
     c. emit(result, 0)
```

**Why `merge --ff-only` is compare-and-swap-safe in Case B.** The current `update-ref` uses `--old-value baseShaBefore` so it fails rather than clobber a base that moved. `git merge --ff-only` gives the equivalent guarantee live: it reads the base ref at merge time and refuses any non-fast-forward, and reports "already up to date" (a clean no-op) if the base already advanced past the branch tip. So no separate `--old-value` guard is needed — the ff-only merge cannot clobber a diverged base.

**Edge cases and error handling.**

- **Porcelain unavailable / git error enumerating worktrees** → refuse (fail-closed); never fall through to a blind `update-ref`.
- **Peer worktree dirty** → refuse with guidance (don't overwrite operator edits). Retryable by the operator after commit/stash.
- **`merge --ff-only` fails** (base diverged mid-window, permissions) → refuse, surfacing git's stderr. Retryable.
- **Base checked out in >1 worktree** → refuse (anomalous; git normally prevents it).
- **Detached-HEAD peer worktrees** → `branch == null`, never match; ignored.
- **Case A `update-ref` failure** → unchanged refuse path with today's blocker text.
- All refuse paths keep `merged: false` and exit 1 (usage/precondition failures upstream still exit 2, unchanged).

**Failure modes.**

- **The failure:** `git worktree list --porcelain` branch-line format differs across git versions, so base-checkout detection misfires — a peer checkout is missed (→ back to the desync bug) or a false match refuses a safe single-worktree merge.
  - **How you'd know:** the peer-worktree test asserts a clean `git status` in the peer after merge; a miss reproduces phantom staged-deletes. The single-worktree regression test asserts Case A still lands via `update-ref`; a false match turns it into a refuse.
  - **What it means:** proceed — mitigated by reusing the already-shipped `parseWorktreeEntries` parse (the same porcelain format worktree-prune already depends on across git versions) rather than a new bespoke parser.
- **The failure:** a `merge --ff-only` into a clean-but-checked-out base worktree still moves that worktree's HEAD; if the operator was mid-task there, their branch position shifts under them.
  - **How you'd know:** operator reports their peer checkout advanced unexpectedly — but this is the *intended* consistent outcome (the base genuinely fast-forwarded), and it's exactly what a normal `git merge` in that worktree would do.
  - **What it means:** proceed — this is correct behaviour, and the dirty-worktree refuse already protects uncommitted work.

**Anti-patterns.**

- **Anti-pattern:** keep `update-ref` and follow it with `git -C <peer> reset --keep` / `read-tree -m`. Why: it re-implements, more fragilely, what `merge --ff-only` does natively, and `reset --keep` can itself abort on local changes — the same unsafe sub-case, now handled inconsistently.
- **Anti-pattern:** unconditionally route through the peer-merge path even in Case A. Why: it needlessly changes the safe, tested single-worktree path and drops the explicit `--old-value` CAS guard where it's cheap to keep.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a no-remote repo where `main` is checked out in a peer worktree
  and a `feature` branch one commit ahead of `main`, ff-mergeable
When `faff merge-gate --local` lands the merge (floor otherwise passing)
Then the base ref advances to the feature tip
  and `git status` in the peer worktree is clean — no phantom staged-deletes
  and the merge-record is written and the command exits 0
```

```
Given a no-remote single-worktree repo (base checked out nowhere else)
When `faff merge-gate --local` lands the merge
Then the base ref advances via `git update-ref` exactly as before
  and the command exits 0 (single-worktree behaviour unchanged)
```

## 6. Design Decision Rationale

**Which of the three fix directions?**

- *Worktree-aware land (option 1):* land via `git -C <peer> merge --ff-only <branch>` when base is checked out in a peer. Pro: index + working tree refresh by construction, using git's own guard-respecting machinery; ff-only + CAS safety preserved. Con: must detect the peer and handle the dirty sub-case.
- *Post-move refresh (option 2):* keep `update-ref`, then `reset --keep` / `read-tree -m` in the peer. Pro: minimal change to the land call. Con: re-implements merge refresh fragilely; `reset --keep` aborts on local changes, so still needs the dirty sub-case handled — strictly weaker.
- *Refuse-with-guidance only (option 3):* detect the peer checkout and always refuse. Pro: simplest, never desyncs. Con: makes the peer-worktree topology — the exact layout the git-only path was built for — unusable rather than merely fixing it.

**Chosen:** option 1 (worktree-aware land) as the primary path, with option 3 (refuse-with-guidance) as the fail-closed fallback for the unsafe sub-cases (dirty peer, anomalous multi-checkout, git enumeration failure). Rationale: it fixes the topology instead of forbidding it (which option-3-only does), while borrowing option 3's safety exactly where landing can't be done without risking operator work. Option 2 is rejected as a strictly weaker route to the same end state.

**Behaviour when the peer base worktree is dirty?**

- *Clobber (proceed with the ff):* rejected — `merge --ff-only` can overwrite / abort on the operator's uncommitted changes; unrecoverable.
- *Refuse with guidance:* refuse (exit 1), name the peer path, tell the operator to commit / stash.

**Chosen:** refuse with guidance. Rationale: fail-closed on the unsafe sub-case (design principle 2); the operator recovers with one commit / stash and a re-run.

**Second open question — do other git-only base-ref movers carry the same risk?**

**Chosen:** No — resolved by exploration, not deferred. A repo-wide grep for `update-ref` across `bin/lib` shows `cmdMergeGateLocal` (merge-gate.js) is the **sole mover** of a base ref. `merge-fence.js` references `git update-ref refs/heads/<base>` only inside its **deny-matcher** (the PreToolUse hook that refuses raw base-ref mutation), which never moves a ref. So the fix is complete at this one site; no sibling movers need the same treatment.

## 7. Open Questions and Assumptions

**Open Questions.** None — all three fix directions were settled above; the secondary UX/doc note is explicitly out of scope for this ticket.

**Assumptions.**

- **Assumes:** `git worktree list --porcelain` emits a `branch refs/heads/<name>` line for each non-detached worktree (the format `parseWorktreeEntries` already consumes). Validation: the build agent confirms `parseWorktreeEntries` is present/exported and this format is what it parses (it is, per worktree-prune.js) before reusing it.

## 8. DONE — Definition of Done

### From WHY
- [ ] After `faff merge-gate --local` on a no-remote repo where `<base>` is checked out in a peer worktree, that worktree's `git status --porcelain` is empty — no phantom staged-deletes, no manual `git reset --hard HEAD` needed.

### From WHAT (detection)
- [ ] A pure helper resolves, from parsed `git worktree list --porcelain` entries and the base name, whether the base is checked out nowhere (Case A), in exactly one peer worktree (Case B), or in more than one (anomaly).
- [ ] The porcelain parse reuses `parseWorktreeEntries` (or the same shape), not a new bespoke parser.

### From HOW (behaviour)
- [ ] Case A (base checked out nowhere) lands via `git update-ref refs/heads/<base> <headShaNow> <baseShaBefore>` — byte-for-byte the current path, `--old-value` CAS guard intact.
- [ ] Case B clean peer lands via `git -C <peer-path> merge --ff-only <branch>`; the base ref advances and the peer worktree's index / working tree stay consistent.
- [ ] Both land paths set `merged: true`, `verdict: "merge-ok"`, write the merge-record, and exit 0.
- [ ] The FF remains fast-forward-only and cannot clobber a base that moved (update-ref via `--old-value`; peer-merge via `--ff-only`).

### From HOW (edge cases)
- [ ] A dirty peer base worktree → refuse (exit 1) with a blocker naming the peer path; neither base ref nor peer worktree modified.
- [ ] Base checked out in >1 worktree → refuse (exit 1) with a naming blocker.
- [ ] Failure to enumerate worktrees, or a failing `merge --ff-only`, → refuse (exit 1) surfacing git's stderr; never a blind `update-ref` fallthrough.

### From tests
- [ ] `test/merge-gate-local.test.mjs` gains: a peer-worktree clean-land case (asserts clean peer `git status` post-merge), a single-worktree regression case (asserts Case A still lands via update-ref), and a dirty-peer refuse case (asserts exit 1 + unmodified peer).

**Integration smoke test.**

```
1. Scaffold a no-remote repo (git init -b main, one commit); create `feature` one commit ahead.
2. git worktree add <peer-dir> main    # base now checked out in a peer worktree
3. Seed the run-dir floor artifacts (ac-checklist, review-verdict = pass); run
   faff merge-gate --local --issue <ID> --run-dir <run> --level L3 --json
4. Assert: exit 0, merged:true; `git -C <peer-dir> status --porcelain` is empty;
   `git -C <peer-dir> rev-parse main` == feature tip.
```

## Methodology critique

Agile-delivery lens (issue-critique). Advisory — does not gate promotion.

- **Right-sized?** Yes. A single cohesive 1–3 day unit — one concern (the `--local` land step), one function touched plus its test file. No independent second concern to split out; no always-ships-together sibling to merge.
- **Workstream fit?** Fine. A git-only merge-gate bug related to FAFF-526 (Done); project-less Backlog is appropriate — no outcome-sequencing needed.
- **Deps surfaced?** Yes. No blocker; the one relation (FAFF-526) is already shipped. No implicit unlinked dependency.
- **Risk profile?** Low. Localised change reusing an already-shipped porcelain parser and git's own merge machinery; no novel integration, no external dep. No de-risking spike warranted.

No issues.

confidence: high
spec-review: approve
