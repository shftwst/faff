# FAFF-126 — Concurrent `git worktree prune` clobbers a peer's live worktree: make the no-global-prune guard mechanical

> Spec confidence: **high**. Bug. Seam 1 of FAFF-82 (seam 2 already closed by PR #49).

## WHY

FAFF-82 closed only **seam 2** (tracker-status monotonicity). **Seam 1** — the worktree-registry race — shipped as a **prose-only** stopgap in gateway → Worktree policy: *"Never run a repo-wide `git worktree prune` while a peer orchestrator may be live."* A concurrent run did not honour it: on 2026-06-12, FAFF-114's cleanup ran a repo-wide `git worktree prune` against the shared clone and wiped FAFF-93's in-flight git admin dir. No work was lost (the spec commit was safe on the branch ref) but it cost a rebuild and the safety guarantee was false.

A bare `git worktree prune` is **repo-wide**: it clears *every* dangling entry in the shared clone's `.git/worktrees/`. A peer whose checkout briefly looks absent (ephemeral container, mid-provisioning) has its admin dir removed mid-run. The guard cannot be a rule a concurrent agent has to remember — it must be **mechanical, scoped by construction**.

## WHAT / HOW

Of FAFF-82's four candidate mechanisms (per-run namespacing, separate `worktree_root`, scope-the-prune, lockfile), this ships **scope-the-prune**: a `faff worktree-prune` CLI subcommand that removes **only the calling run's own** dangling worktree metadata, never the repo-wide prune.

1. **`faff worktree-prune` CLI subcommand** (`plugin/skills/faff/bin/faff`). Dry-run-then-classify:
   - Enumerate worktree entries via `git worktree list --porcelain` (marking `prunable` entries; fall back to `git worktree prune --dry-run --verbose` for older gits that omit the `prunable` attribute).
   - The run declares ownership via `--own <path>` (repeatable), `--branch <name>`, or `--issue <id>`.
   - Classify each entry: **OWN+prunable → prune**; **OWN+live → skip** (the run's in-flight tree); **!OWN+live → FOREIGN** (a peer — protected, never touched); **!OWN+prunable → UNKNOWN** (dangling but unproven-ours → **fail-safe SKIP**).
   - Removal is **scoped**: delete only each OWN dangling `.git/worktrees/<id>` dir by path — never the repo-wide `git worktree prune`.
   - With **no** ownership selector declared, nothing is OWN, so nothing is pruned (fail-safe).
   - `--dry-run` mutates nothing; `--json` for machine output; `--selftest` drives the pure classification table without touching git/fs. Wired into `main()`'s dispatch and `USAGE`.

2. **Gateway prose guard rewrite** (`plugin/skills/faff/SKILL.md` → Worktree policy). Replace the "never global-prune, remember it" bullet with one pointing cleanup at `faff worktree-prune --issue <id>` — the scoping is now by construction. Stay within skill-authoring lint caps.

3. **Cleanup callers** (`faff-graft/SKILL.md`, `faff-beep-boop/SKILL.md`). Point the post-merge worktree-cleanup / housekeeping reference at `faff worktree-prune` (binary resolved per gateway → Resolving the `faff` executable, never hardcoded).

## DONE (acceptance criteria)

- **AC1** — `faff worktree-prune` exists, dispatched in `main()`, listed in `USAGE`.
- **AC2** — classifies candidates OWN/FOREIGN/UNKNOWN and prunes ONLY OWN; FOREIGN (live peer) and UNKNOWN (dangling-but-unproven) are never pruned (fail-safe).
- **AC3** — `faff worktree-prune --selftest` passes, driving the classification table without touching real git/fs.
- **AC4** — gateway Worktree policy guard rewritten to the mechanical command; `faff validate-adapters` passes (lint caps respected).
- **AC5** — `faff-graft` + `faff-beep-boop` cleanup callers reference `faff worktree-prune` via the resolved binary.
- **AC6** — no regression: existing `faff <cmd> --selftest` all pass.

## Out of scope

Seam 2 (tracker-lifecycle clobber — already fixed by FAFF-82 / PR #49); any broader multi-orchestrator coordination redesign; per-run worktree-root namespacing or lockfile mechanisms (scope-the-prune chosen instead).
