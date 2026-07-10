# Harden `readHoldout` — run-dir-relative resolution + freshness-bound holdout verdict

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-420.

This is the build spec for **FAFF-420**, for the build agent and human reviewers. It hardens the fourth (L4-only) floor condition of `faff merge-gate` so a **stale or foreign holdout verdict can no longer satisfy the current merge's gate**. All target code is in the single Node CLI `plugin/skills/faff/bin/faff`; the holdout **write** step is prose in `plugin/skills/faff-graft/SKILL.md` + `plugin/skills/faffter-noon-evaluate/SKILL.md`.

## 1. WHY — Problem and Principles

**Load-bearing model.** A merge-gate floor artifact is trusted **because of where it lives, not what it says.** The two sibling floor readers (`readAcComplete`, `readReviewVerdict`) resolve `path.join(runDir, issue, "<artifact>.json")` — so an artifact from another run *physically cannot be read*, and run-binding is free. `readHoldout` is the lone floor reader that breaks this rule: it reads a **global, CWD-relative** `.faff/holdout/<issue>.json` with no run binding and no freshness check. Restore the invariant and the bug closes.

**Problem statement.** `faff merge-gate`'s L4 fourth floor reads the per-issue holdout verdict via `readHoldout(issue, dir)`, which builds `path.join(dir || ".faff/holdout", ${issue}.json)` and is called (merge-gate call site) with **no `dir`** — so it resolves CWD-relative, unbound to the run the gate is deciding. Any `meets-spec` holdout for that issue sitting in the working directory — from a prior run, a different worktree, or a hand-placed file — vacuously satisfies condition 4. This change makes the holdout read **run-scoped and freshness-checked**, fail-closed on anything it cannot prove belongs to the current run.

**Design principles.**

- **Match the sibling convention, don't invent a parallel one.** The fix must make `readHoldout` bind exactly as `readAcComplete` / `readReviewVerdict` already do (`<run-dir>/<issue>/…`). Consistency here *is* the correctness property; a bespoke run-binding scheme would be a second thing to get wrong.
- **Fail-closed is the existing posture — extend it, never soften it.** The holdout gate already refuses on `missing`. Every new negative outcome (foreign, stale, un-provable freshness) collapses into the same refuse path. There is no code path where an unverifiable holdout passes.
- **Reuse the run-scoped anchor already in hand.** `cmdMergeGate` already threads `--run-dir` to the two siblings. The build-complete checkpoint (`<run-dir>/<issue>/build-progress.json`) is a concrete, already-persisted timestamp under that same run-dir — the freshness comparison needs no new artifact.

**Scope statement.** This is one condition of the L4 merge floor (`faff merge-gate`); it does not touch the other three floors or the verdict-reducer semantics.

## 2. OUT OF SCOPE

- **The holdout-verdict contract schema (`computeHoldoutVerdict` fields).** No new `run_id` / timestamp field is added to the artifact — the Chosen design binds structurally by path (like the siblings), which makes an in-artifact run stamp redundant.
- **Migrating the association-level roll-up readers** (`faff holdout verdicts` / `faff holdout verdict` / `faff prdr coverage --dod-verdicts`) off the global `.faff/holdout/` directory — a cross-run association concern, not the per-run gate. The write step keeps the global copy so these keep working.
- **The other three floors** (`ac_complete`, `review_verdict`, CI/head-sha) — already run-bound; unaffected.
- **`resolveRunDir`-style existence validation of `--run-dir` in `cmdMergeGate`** — a latent inconsistency the siblings share too; not this ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Run-dir | The per-run directory `--run-dir` names (e.g. `.faff/runs/<run-id>/`); its basename is the conventional run-id. |
| Build-complete checkpoint | `<run-dir>/<issue>/build-progress.json`, written after a successful push; carries `updated_at` (ISO) and `build.pushed_at` (ISO). |
| Fresh (of a verdict) | The holdout artifact's last-modified time is **strictly after** the build-complete checkpoint's timestamp. |
| Foreign (of a verdict) | A verdict not located under the current run's `<run-dir>/<issue>/`. Structurally unreadable ⇒ treated as `missing`. |

**Signature change.**

```
FUNCTION readHoldout(runDir, issue) -> "meets-spec" | "missing" | "blocked"   # was readHoldout(issue, dir)
```

Argument order flips to `(runDir, issue)` to mirror `readAcComplete(runDir, issue)` / `readReviewVerdict(runDir, issue)` exactly. Return enum is unchanged (`FLOOR_HOLDOUTS`).

**Path resolution.**

```
holdout_path    = path.join(runDir, issue, "holdout.json")
checkpoint_path = path.join(runDir, issue, "build-progress.json")
```

**Freshness helper (new, pure, testable).**

```
FUNCTION holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs) -> boolean
  RETURN Number.isFinite(holdoutMtimeMs)
     AND Number.isFinite(checkpointTimeMs)
     AND holdoutMtimeMs > checkpointTimeMs
```

## 4. HOW — Behavior

```
PROCEDURE readHoldout(runDir, issue):
  1. IF runDir is falsy -> return "missing"
  2. holdout_path <- path.join(runDir, issue, "holdout.json")
     block <- JSON.parse(readFileSync(holdout_path))
     holdout_mtime <- statSync(holdout_path).mtimeMs
     ON any error in step 2 -> return "missing"
  3. checkpoint <- JSON.parse(readFileSync(path.join(runDir, issue, "build-progress.json")))
     checkpoint_time <- Date.parse(checkpoint.updated_at ?? checkpoint.build?.pushed_at)
     ON any error, OR checkpoint_time not finite -> return "blocked"
  4. IF NOT holdoutIsFresh(holdout_mtime, checkpoint_time) -> return "blocked"
  5. res <- holdoutGateResult(block)
     IF res.gate == "pass" -> return "meets-spec"
     return res.reason == "missing" ? "missing" : "blocked"
```

**Call-site fix.** `holdout: level === "L4" ? readHoldout(runDir, issue) : "not-applicable"`.

**Writer change (prose).** The holdout persistence step (graft's per-issue holdout gate / `holdout_step`) writes the verdict block to **both** the run-scoped `<run-dir>/<issue>/holdout.json` (the gate's copy, written after the build-complete checkpoint so it is fresh by construction) and the existing global `.faff/holdout/<issue>.json` (kept for the association-level roll-up readers). The `faff merge-gate` help/registry text is updated to reflect the run-dir-relative convention.

**Edge cases.**

- `runDir` falsy → `missing`.
- Holdout file absent / unreadable / bad JSON → `missing`.
- Checkpoint absent / unparseable / no usable timestamp → `blocked` (not `missing`).
- Holdout mtime ≤ checkpoint time → `blocked` (stale).
- `holdoutGateResult` says block → preserve its `missing` vs `blocked` distinction.

## 5. SCENARIOS

```
Given a holdout verdict written under a DIFFERENT run-dir (foreign)
When merge-gate assembles the L4 floor for the current run-dir
Then readHoldout returns "missing" and the floor refuses
```

```
Given a meets-spec holdout whose mtime predates the current run's build-complete checkpoint
When readHoldout resolves it under the current run-dir
Then it returns "blocked" (stale) and the floor refuses
```

```
Given a meets-spec holdout under <run-dir>/<issue>/holdout.json written AFTER the build-complete checkpoint
When readHoldout resolves it for the current run
Then it returns "meets-spec" and the L4 holdout floor passes (happy path unchanged)
```

```
Given a holdout file that exists but no readable build-complete checkpoint under the run-dir
When readHoldout evaluates freshness
Then it returns "blocked" (freshness unprovable => fail-closed), never "meets-spec"
```

## 6. DESIGN DECISION RATIONALE

**Chosen: path convention (structural binding) + mtime-freshness assertion**, mirroring `readAcComplete` / `readReviewVerdict` exactly, over a schema bump adding an in-artifact `run_id` field. The path already guarantees the binding a schema field would duplicate; matching the sibling convention is both the smallest change and the one that removes a way to get run-binding wrong.

**Dual-write (global + run-dir) rather than migrate.** The association-level readers (`faff holdout verdicts`, `faff prdr coverage --dod-verdicts`) consume the global directory; migrating them is a separate concern. Two persisted copies of one in-memory block, written at the same instant, cannot diverge.

**Un-provable freshness is `blocked`, not `missing`.** Both refuse at L4, but the distinct signal makes the merge-gate blocker message diagnostic (points at a checkpoint/staleness problem, not an absent evaluator run).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

None open — the ticket's sole open question (schema vs path) is settled to *path convention* in §6.

**Assumptions.**

- The graft `holdout_step` runs *after* the build-complete checkpoint is written, so the run-dir holdout copy is naturally fresh.
- `<run-dir>/<issue>/` is the established per-issue artifact directory (`ac-checklist.json`, `review-verdict.json`, `build-progress.json`, `review-progress.json` all live there).

## 8. DONE — Definition of Done

### From WHY
- [ ] A holdout verdict located under a different run-dir no longer satisfies the L4 floor (returns `missing` → refuse).
- [ ] `readHoldout` never resolves a CWD-relative path; with a falsy `runDir` it returns `missing`.

### From WHAT (interfaces)
- [ ] `readHoldout` signature is `(runDir, issue)`, mirroring the sibling readers; the merge-gate call site passes `runDir`.
- [ ] Return values stay within `FLOOR_HOLDOUTS`; `decideFloor` and `FLOOR_HOLDOUTS` are unchanged.
- [ ] `holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs)` returns true iff both are finite and `holdoutMtimeMs > checkpointTimeMs`.

### From HOW (behaviour)
- [ ] Holdout path resolves to `path.join(runDir, issue, "holdout.json")`.
- [ ] Freshness is asserted against `<run-dir>/<issue>/build-progress.json` (`updated_at`, falling back to `build.pushed_at`).
- [ ] A holdout whose mtime is ≤ the checkpoint time returns `blocked`.
- [ ] An absent/unparseable/timestamp-less checkpoint returns `blocked` (not `missing`, not `meets-spec`).
- [ ] The conformant verdict block is still reduced by the unchanged `holdoutGateResult`.
- [ ] The graft `holdout_step` prose persists the verdict to `<run-dir>/<issue>/holdout.json` in addition to the global copy; the merge-gate help/registry text reflects the run-dir path.

### From HOW (tests)
- [ ] `mergeGateSelftest` gains a pure case for `holdoutIsFresh` (stale → false, fresh → true, non-finite → false).
- [ ] `test/merge-gate-controlflow.test.mjs` gains `--level L4` cases over real temp run-dirs: (a) foreign/absent holdout → refuse, (b) stale holdout (mtime ≤ checkpoint) → refuse, (c) fresh holdout → the holdout floor passes, (d) holdout present + no checkpoint → refuse. `node --test` green.
