# FAFF-463 — Formalise PRDR git-landing — the missing third step after author + ratify (rev 2)

> Spec: faffter-dark-nlspec · 2026-07-14 · interactive · confidence: high. Full spec on Linear FAFF-463.

The decided, mechanised path by which a ratified PRDR lands in git.

## 1. WHY
Make ratification and committing the same atomic gesture. A new `faff prdr accept` becomes the **sole writer** of `Status: Accepted` — and in the same invocation commits the record onto a dedicated landing branch — so "Accepted" and "committed" are one state, not two that drift. A git-aware validator rule + CI parity make any hand-edit drift fail loud; plot's create offer and the L4 loop re-point at this single path.

Principles: one writer for Accepted (hand-edits become validator violations); everything ships via PR (accept commits to a branch, never main); a failed accept mutates nothing (atomic-or-clean); record-don't-judge stays (tracked-ness is a shape fact); configurable (`prdr.*` keys, safe defaults).

## 2. OUT OF SCOPE
PRD/ADR landing; DoD content judgement; push/PR inside the CLI (accept stops at the local commit; the skill pushes+opens); cross-branch numbering registry (collisions handled at merge by guard+renumber); Rejected-status mechanics.

## 3. WHAT
`faff prdr accept <number> [--actor human|loop] [--admit-verdict <json>] [--root <dir>] [--no-branch]` — THE sole writer of Accepted: flips Proposed→Accepted, stages only the PRDR file (allowlist, never `git add -A`), commits on a landing branch, prints `{file, branch, base}`. Atomic-or-clean.
`faff prdr renumber <file-or-number> --to next|<NNNN> [--ref-scope <scope>]` — port of adrRenumber, prefix "PRDR".
`faff prdr validate` — extended with a git-awareness tier.

Config: `prdr.accept_branch_prefix` (default `prdr/`), `prdr.validate_git` (default `auto` | off).

Validator tiers: `FAIL accepted-uncommitted` (Status Accepted AND untracked-or-modified → exit 1); `NOTE proposed-uncommitted` (Status Proposed AND untracked → informational, exit 0).

Landing resolution: **Chosen** (3)+(2) — atomic ratify+commit trigger onto a landing branch whose PR the caller opens; `--no-branch` rides an existing graft branch. Hand-edit vs mechanic: **Chosen** mechanic-written + validator FAIL. CLI reach: **Chosen** commit yes, push/PR no.

## 4. HOW
`prdr_accept`: (1) resolve; refuse if not found / terminal status / non-git / detached HEAD. (2) actor loop → require --admit-verdict, schemaCheck prdr-admission, refuse unless disposition==admit. (3) base = current if noBranch else default branch (gh → origin/HEAD → main). (4) not noBranch → refuse staged index; refuse existing landing branch; `git switch -c <prefix><NNNN>-<slug> <base>` (refuse on failure — nothing mutated). (5) rewrite Status line → Accepted, strictly AFTER a successful switch. (6) `git add <the one file>` (explicit path). (7) commit. (8) rollback on 6/7 failure: unstage, restore file (→Proposed), switch back, delete landing branch, exit naming the step — a failed accept never leaves Accepted anywhere. (9) print. (10) not noBranch → switch back.

git tier: `validate_git=off` or non-git → []; else per record: Accepted+untracked-or-modified → FAIL; Proposed+untracked → NOTE.

Skill landing: plot §5b / jot / tidy / gateway L4 prose re-pointed from "flip Status: Accepted by hand" to `faff prdr accept <n>` (L4 loop: `--actor loop --admit-verdict`); graft carries a PRDR merge-guard mirroring the ADR one; validate.yml runs live-tree `faff prdr validate`.

Anti-patterns: accept rewriting the body; `git add -A` anywhere.

## 5. Scenarios
- accept 3 → Status Accepted, one commit (only that file) on `prdr/0003-<slug>` off default, original branch restored, stdout names branch+base.
- Accepted+untracked → `faff prdr validate` FAIL exit 1.
- `--actor loop` with propose-only verdict → refuses, Status still Proposed, no branch/commit.
- commit fails mid-accept → exits non-zero naming the step, Status Proposed, original branch checked out, no landing branch.
- two PRDRs numbered 0001 → merge-guard validate+renumber → clean.
- non-git checkout → validate exit 0 (degrade). CI runs live-tree prdr validate.

## 7. Open questions / assumptions
Punt: Proposed-uncommitted staleness threshold — needs human (decides: product); v1 ships age-blind either way (follow-up only). Assumes gh available to skills; spawnSync git acceptable in prdr.js; prdr-admission exposes top-level disposition (verified).

## 8. DONE
- No documented surface instructs a hand-edit of Status: Accepted.
- `faff prdr accept` flips only the Status line; refuses not-found / terminal / non-git / detached-HEAD / existing-branch / staged; `--actor loop` needs a valid admit verdict; atomic rollback on failure never leaves Accepted.
- `faff prdr renumber` with adrRenumber semantics.
- config keys in DEFAULTS.
- git tier: Accepted+untracked → FAIL exit 1; Proposed+untracked → NOTE exit 0; non-git → silent.
- validate.yml runs live-tree prdr validate; graft carries the PRDR merge-guard; prose re-pointed.
- `prdr --selftest` covers accept happy path + each refusal (incl. detached HEAD, staged, rollback), loop-actor gating, --no-branch, renumber, both validator tiers, non-git degrade.

confidence: high
spec-review: approve
