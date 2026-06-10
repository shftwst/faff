# Spec — FAFF-82: Multi-orchestrator concurrency safety (tracker-status claim)

> Spec: faffter-dark-nlspec · 2026-06-10 · interactive · adaptor: faffidavit-spec · confidence: high. Full spec on Linear FAFF-82.

*Revised 2026-06-10 — simplified to a **purely tracker-based** claim per human direction. The earlier two-layer design (a same-machine `faff claim` O_EXCL lockfile + the tracker) was rejected as too much machinery for a rare event; this supersedes it.*

**Preamble.** Two *independent* `/faff-beep-boop` orchestrators sharing one Linear tracker can pick up the same issue and clobber each other on the two seams that are **not** git-protected: the worktree registry and the tracker's issue-status. On 2026-06-09 a worktree was clobbered, and graft's unconditional "move to In Progress" reverted FAFF-7 `Done → In Progress` (real board corruption). This spec closes both with **no new code or config** — just two prose-contract rules on how faff writes tracker status:

1. **The issue's `In Progress` status *is* the claim.** It is the one coordination point every orchestrator shares regardless of machine. Acquire it by reading status first and only starting if the issue is still `Todo`/`Backlog`; if it is already `In Progress`/`In Review`/`Done` (or the PR is merged), a peer owns it (or it's done) — skip.
2. **Status-monotonicity guard:** every status write moves **forward only** by rank; never move an issue out of `Done`/`In Review` back to `In Progress`. This single rule kills the FAFF-7 revert and needs no compare-and-set.

This is deliberately **best-effort, not a hard mutex**: Linear's `save_issue` has no compare-and-set, so a tight simultaneous race could let two runs both write `In Progress`. That is acceptable — the damage is bounded to a wasted duplicate build (caught at merge by git: rebase-before-merge → conflict, or already-merged → no-op), never corruption (the monotonicity guard prevents that). A heavier hard-mutex layer is unjustified for an event this rare.

## 1. WHY

- **Seam 1 — worktree registry.** Two runs picking one issue derive the same branch and clobber the same `~/.faff/worktrees/<repo>/<branch>` dir. The In-Progress claim dedupes the issue, so two runs never legitimately target the same branch dir; additionally, a global `git worktree prune` must never run while a peer may be live.
- **Seam 2 — tracker status (last-writer-wins).** No merge semantics; graft Step 5 ("if not already In Progress, transition it") treats `Done` as "not In Progress" and writes `Done → In Progress` — the FAFF-7 corruption. The monotonicity guard fixes it.

**Design principle — keep it proportionate.** The hazard is real but rare (independent concurrent orchestrators on one repo). The fix is two status-write rules, not a new locking subsystem. Reject any design that adds a CLI primitive, a lockfile, TTL/heartbeat machinery, or config for this.

## 2. OUT OF SCOPE

- A same-machine lockfile / `faff claim` CLI / TTL-heartbeat staleness — **rejected as over-built** for a rare event; the tracker is the claim.
- True tracker compare-and-set — Linear exposes none; the claim is best-effort, the monotonicity guard carries the corruption-safety.
- Intra-orchestrator parallelism (the `concurrency` slot) — already safe and unchanged.
- A stuck-`In Progress` recovery mechanism — a crashed run leaves a visible `In Progress`; a human (or tidy, surfacing it) clears it. No dedicated machinery.

## 3. WHAT

**Vocabulary.**
- **Claim** — the issue being `In Progress`. Acquired by setting status `Todo → In Progress` after confirming it is not already claimed/done.
- **Status rank** — `Backlog < Todo < In Progress < In Review < Done` (Cancelled is terminal, never auto-written).

**Chosen:** the claim is the tracker `In Progress` status — the only cross-machine coordination point — acquired best-effort (no CAS), with the monotonicity guard carrying corruption-safety. No local state, no CLI, no config.

## 4. HOW

### 4.1 graft — claim + monotonicity guard (Step 5)

Rewrite graft's "Move to In Progress" (Step 5) to the guarded tracker-claim:
- Re-read the issue's **live** status (not a cached snapshot from Step 1).
- If it is already `In Progress` / `In Review` / `Done`, or its PR is merged → a peer is building it, or it's done → **stop**. Interactive: tell the user "another run is already building <issue>". Autonomous: skip (a `claimed-by-peer` skip, not a park).
- Else transition `→ In Progress` — this is the claim.
- **Status-monotonicity guard (binds every status write from here):** only move forward by rank; **never** move an issue out of `Done`/`In Review` back to `In Progress`. A "move to In Progress" on an issue already at/past it is a no-op.
- **Acquire early.** Do the read-and-claim *before* creating the worktree (Step 3) where practical, so a peer-owned issue is skipped without provisioning a worktree.
- **Re-read before merge.** Immediately before merge, re-read status / PR state; if already merged or advanced by a peer, do not double-merge and do not revert.

### 4.2 beep-boop — claim-before-admit

At build-queue assembly (and wave re-entry re-assembly), before admitting an issue, re-read its live status. If already `In Progress`/`In Review`/`Done` set by a peer → **`claimed-by-peer`** disposition, **not** appended to the run-ledger `admitted` array (so `runcheck`'s `admitted − outcomes == ∅` stays true) and **not** a park. Surface it in the run summary's "Claimed by peer" line.

### 4.3 gateway — the canonical rule + worktree-prune

A shared-rules section **Issue claim & status monotonicity** stating §3/§4 (the In-Progress-as-claim, the best-effort caveat, the monotonicity guard, the claimed-by-peer disposition). Plus, in Worktree policy: **never run a global `git worktree prune` while a peer orchestrator may be live** — scope any prune to this run's own merged worktree.

### 4.4 Anti-patterns

- Never write `In Progress` over `Done`/`In Review` (the FAFF-7 revert).
- Never "release" the claim by reverting status — it advances forward to `In Review`/`Done`.
- Never treat the claim as a hard mutex — it is best-effort; git's merge-time rebase is the duplicate-build backstop.
- Never run a global `git worktree prune` on a shared clone while peers may be live.

## 5. DESIGN DECISION RATIONALE

- **Why tracker-only (not a local lockfile).** The tracker is the only coordination point every orchestrator shares regardless of filesystem, and the event is rare enough that a same-machine hard mutex + its TTL/heartbeat/CLI machinery is disproportionate. Best-effort dedup + the monotonicity guard + git's merge backstop covers the real risk simply.
- **Why monotonicity, not CAS.** The corruption is directional (backward past Done); a forward-only rank rule catches every backward write with a local comparison, no atomic primitive.
- **Accepted residual.** A tight simultaneous claim race → at most one duplicate build, caught at merge. Acceptable for the frequency.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** Linear's `save_issue` has no compare-and-set, so the claim is best-effort. *Validate:* if a CAS/`updatedAt`-precondition appears, the claim can be tightened to a conditional write; until then the monotonicity guard carries corruption-safety.
**Assumes:** an issue's live status is readable immediately before the claim and before merge. *Validate:* graft already reads status in Step 1; re-read at the claim and merge points.

## 7. DONE

1. graft Step 5 reads live status and **skips** (no worktree provisioned where practical) when the issue is already `In Progress`/`In Review`/`Done` or PR-merged; else claims by setting `In Progress`.
2. The status-monotonicity guard binds every faff status writer: no write moves an issue out of `Done`/`In Review` back to `In Progress`. Regression: the FAFF-7 `Done → In Progress` revert cannot occur.
3. graft re-reads before merge; no double-merge and no revert of an already-merged/peer-advanced issue.
4. beep-boop skips a peer-claimed issue as `claimed-by-peer`, never entering `admitted`; `runcheck`'s invariant holds.
5. The gateway carries the canonical **Issue claim & status monotonicity** rule + the never-global-prune-while-peers-live worktree rule.
6. No new CLI, lockfile, or config is added (the whole change is prose-contract status-write rules).

confidence: high
