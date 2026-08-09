# FAFF-229 — Budget child-transcript attribution: session-match scoping, not bare mtime

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · confidence: high · Full spec on the issue tracker.

This is the build spec for FAFF-229, a bug follow-up to FAFF-36's `faff budget check`. Audience: the build agent implementing the fix, and human reviewers checking the attribution change preserves FAFF-36's guarantees. It tightens which child `agent-*.jsonl` transcripts are summed into a run's token spend so a foreign run's transcript can never inflate this run's figure.

## 1. WHY — Problem and Principles

**The load-bearing model.** Claude Code writes one transcript file per session under `~/.claude/projects/<encoded-cwd>/`: the orchestrator's own `<sessionId>.jsonl`, plus one `agent-<id>.jsonl` per dispatched subagent. **Every record inside a child `agent-*.jsonl` carries a top-level `sessionId` field equal to the parent orchestrator's session id** (the `<sessionId>.jsonl` filename). That field — not the file's mtime — is the reliable "which run owns this child" signal, and it is already on disk, so reading it keeps `faff budget check` pure.

**Problem statement.** `measureTokens` currently aggregates every `agent-*.jsonl` in the project dir whose `mtimeMs >= runStartMs`. mtime is a wall-clock touch time, not an ownership signal: a prior or parallel run's child transcript that is read, copied, or otherwise touched after this run's start passes the filter and is summed in. This over-counts spend, can fire a token/cost ceiling early, and mis-attributes spend across concurrent runs — directly breaking the "undercount-not-overcount" guarantee FAFF-36's comments claim.

**Design principles.**

**Undercount, never overcount — preserved, not weakened.** The whole point of the fix is to make the existing guard-rail honest. A child file that can't be confidently attributed to this run must be *excluded* (lowering the figure), never *included on suspicion*. A missed late or unreadable child lowers the figure; it never raises it. Any change that could include a foreign run's child is a regression even if it also catches more of this run's children.

**Purity is a hard FAFF-36 constraint.** `faff budget check` must stay a pure CLI — no tracker call, no network — at parity with `faff next` / `faff eligible`. The session-match read is local-filesystem only; it introduces no new I/O class. Do not "fix" attribution by reaching for a tracker or any network source.

**No new orchestrator write-path.** The fix must not require `/faff-beep-boop` (or any dispatcher) to record extra state at run time. The attribution signal already exists in the transcript Claude Code writes; the budget reader simply consults it.

## 2. OUT OF SCOPE

- **Per-run agent-id ledger.** Recording each dispatched agent id in the run-ledger and reading it back. Excluded: requires an orchestrator write-path change for a signal that already exists in the transcript.
- **Per-run env/file marker.** Excluded: agent-spoofable, brittle, redundant given the transcript signal.
- **Compute/CI dimension accounting.** Only token accounting is in scope.
- **Changing the orchestrator-session-file selection.** The `<sessionId>.jsonl` orchestrator file is already keyed off `CLAUDE_CODE_SESSION_ID` correctly.

## 3. WHAT — Vocabulary, Types, Interfaces

A child `agent-*.jsonl` is summed into this run's spend **iff its owning session equals the run session id** (`env.CLAUDE_CODE_SESSION_ID`), with mtime retained only as a cheap pre-filter. A pure helper `childOwningSession(file)` returns the first parseable record's top-level `sessionId` or `null`. `measureTokens({ cwd, env, runStartMs })` keeps its signature; `cmdBudget` wiring and the `BudgetState` JSON shape are unchanged.

## 4. HOW — Behaviour

Replace the bare mtime filter in `measureTokens`'s child-aggregation loop with the session-match predicate. mtime stays as a cheap pre-filter (skip stat-old files without opening them); a file surviving it is still excluded unless `childOwningSession(f) === runSessionId`. Unattributable (no parseable `sessionId`), foreign-session, and unreadable children are excluded — lowering, never raising, the figure. The no-`runStartMs` degenerate path relies on the session match alone (still correct).

## 5. SCENARIOS

- Foreign child (different sessionId, in-window mtime) → NOT included.
- Same-session child (this run's sessionId) → included.
- In-window child with no parseable sessionId → excluded, no crash.
- `faff budget check` performs zero tracker/network I/O.

## 6. DESIGN DECISION RATIONALE

**Chosen:** Transcript-content session match — filter child `agent-*.jsonl` by `sessionId === CLAUDE_CODE_SESSION_ID`, mtime retained as a cheap pre-filter only. Pure, no orchestrator write-path, uses a signal confirmed present in real transcripts; fails safe to undercount if the field ever disappears. (Rejected: per-run agent-id ledger — needs an orchestrator write-path; per-run env/file marker — spoofable/brittle.)

**Chosen:** Keep the mtime pre-filter as a pure performance optimisation, not the attribution gate (a same-session child necessarily post-dates run start, so the pre-filter can only skip files the session match would also reject).

**Chosen:** Extract a pure helper `childOwningSession(file)` so `budgetSelftest()` can unit-test attribution without disk; the directory walk stays in `measureTokens` (the I/O layer).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

None open. Assumes Claude Code writes a top-level `sessionId` on child records equal to the parent orchestrator's session id (verified across real transcripts in prep and at build).

## 8. DONE — Definition of Done

- A foreign run's child touched after this run's start is no longer summed into `spent.tokens`.
- Undercount-not-overcount holds with a parallel run active.
- Child aggregation includes a child iff its first parseable record's `sessionId` equals `env.CLAUDE_CODE_SESSION_ID`.
- mtime retained only as a pre-filter; `measureTokens` signature, `BudgetState` shape, `cmdBudget` wiring unchanged.
- A no-`sessionId` child is excluded and does not crash.
- `faff budget check` performs no tracker/network I/O.
- A pure `childOwningSession` helper is exercised by `budgetSelftest()`.
- `test/budget.test.mjs` gains: same-session INCLUDED, foreign-session EXCLUDED, no-`sessionId` EXCLUDED-and-no-crash; `withTranscripts()` stamps a configurable `sessionId`.
- The existing "child agent files OUTSIDE the run window" test still passes.
- `faff budget --selftest` and the full `test/budget.test.mjs` suite pass.

confidence: high
