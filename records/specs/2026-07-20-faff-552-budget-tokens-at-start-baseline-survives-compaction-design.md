# Spec — FAFF-552: budget `tokens_at_start` baseline must survive mid-run compaction

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: medium. Full spec on Linear FAFF-552.

This spec addresses **FAFF-552** (Bug, Urgent): a `faff budget check` re-derives the whole-session token total live from a possibly-compacted transcript and subtracts a baseline that defaults to `0`, so a long run over-counts (~397M tokens observed) and false-trips a real budget ceiling. Audience: the build agent implementing the fix, and the human reviewer gating it. All file/line references are to `plugin/skills/faff/bin/lib/` unless stated.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff budget check` measures *this run's* token spend as a **delta**: `spent.tokens = wholeSessionTotal − tokens_at_start`, where `wholeSessionTotal` is re-summed **live** from the transcript on every check and `tokens_at_start` is a baseline frozen at run start. The delta is only correct when two things hold across the whole run: (1) a real, persisted baseline is subtracted, and (2) both the baseline and the live total are measured against **the same transcript session**. Today neither survives a mid-run compaction: the baseline scalar defaults to `0` for an un-resumed run, and the session summed is the **ambient** `CLAUDE_CODE_SESSION_ID` — which a compaction/resume can silently change out from under the run.

**Problem statement.** A two-epic beep-boop run reported `spent.tokens ≈ 397,370,393` / `cost ≈ $257` with `tokens_source: transcript`, `breached: ["tokens"]`, `outcome: escalate` against an 80M ceiling — the entire multi-hour transcript summed unbaselined against the wrong session. Budget breach is a fixed terminating floor at every level, so this should have escalated the healthy run to `needs-human` and halted convergence one epic short; only a human recognising the artifact kept it going. This change makes the baseline subtraction unconditional and re-readable, and pins measurement to the run's own recorded measuring session rather than the ambient one.

**Design principles.**

- **A governor must never over-count.** The reported failure is a false over-count that halts healthy work. The fix must guarantee `spent.tokens` reflects only post-baseline, same-session spend. Undercounting is the lesser evil already encoded elsewhere (FAFF-229) and is acceptable as a degraded fallback; over-counting into a false breach is the bug.
- **Deterministic tools over prose.** The baseline + measuring-session are written to the ledger today by beep-boop *prose only* (`faff-beep-boop/SKILL.md:378`), with production writers absent — that is exactly why the field is missing at check time. Persistence must move into a code path so it cannot be forgotten.
- **Byte-for-byte for the un-affected paths.** A single-session run whose ledger already carries a consistent baseline, and an estimate-fallback run, must keep today's output. The change is additive: a new read-side fallback + a new write path, not a rewrite of the sum loop.

**Scope statement.** This sits in the token-attribution/baseline path of `faff budget check` — the meter the fixed budget floor compares against; it does not touch the ceiling-compare logic (`computeBudgetState`, 291) or the estimate fallback.

## 2. OUT OF SCOPE

- **FAFF-229 child `agent-*.jsonl` mtime scoping** — excluded.
- **FAFF-502 dotted-cwd transcript-base encoding** — excluded.
- **FAFF-527 explicit-resume `budget.sessions[]` span accounting** — excluded: the `budgetSessions` branch stays; the new unconditional baseline sits *beneath* it as the non-resumed default.
- **Compaction-boundary-aware summation** (`econIsCompactBoundary` inside `sumTranscriptFileByModelClass`) — excluded from this issue; weighed in §5 and left as a documented follow-up. Extension point: `sumTranscriptFileByModelClass`.
- **`budget.measure_root` code-wiring** — separate concern. Not touched here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**New ledger field** (code-read, additive to the `budget` block):

```
RECORD ledger.budget:
  ...existing (envelope, tokens_at_start, tokens_at_start_by_model_class, sessions[], metering)
  measure_session_id: string | absent   # the REAL CLAUDE_CODE_SESSION_ID captured at run start;
                                         # the transcript-selection key for every later check.
                                         # Distinct from owner.session_id (synthetic run-id).
                                         # Absent on legacy ledgers → read side falls back.
```

**New subcommand** — the deterministic baseline writer:

```
COMMAND: faff budget baseline --run-dir DIR [--root DIR] [--session-id ID]
  # Measures the run-start whole-session sum for the effective measuring session and
  # persists the baseline triple into the ledger, atomically, WRITE-ONCE.
  # Effective session: --session-id ID | ambient CLAUDE_CODE_SESSION_ID.
  # Writes: budget.tokens_at_start (scalar), budget.tokens_at_start_by_model_class (per-model),
  #         budget.measure_session_id (the effective session).
  # Idempotent: if budget.measure_session_id is already set, no-op (exit 0).
  # Estimate-degraded (no resolvable transcript): writes measure_session_id + zero baselines
  #             so the field is present; the run still meters (degrades, never crashes).
```

**Session-selection precedence** applied inside `cmdBudget`:

```
resolvedMeasuringSession = sessionIdFlag              # --session-id (explicit operator override, FAFF-488)
                        ?? ledger.budget.measure_session_id   # the run's recorded measuring session
                        ?? process.env.CLAUDE_CODE_SESSION_ID # ambient (today's behaviour)
```

## 4. HOW — Behavior

**A. Read-side — unconditional baseline (`cmdBudget`).** Read the per-model baseline first, then derive the scalar fallback from it instead of `0`.

**B. Read-side — owning-session selection (`cmdBudget`).** Build `effectiveEnv` after the ledger is available and apply the precedence; selector only, never mutates `process.env`.

**C. Write-side — deterministic persistence.**

- **L4 mint (`lights-out.js`):** alongside the existing `tokens_at_start_by_model_class` write, also set `budget.measure_session_id = process.env.CLAUDE_CODE_SESSION_ID`.
- **New `faff budget baseline` subcommand:**

```
PROCEDURE budget_baseline(get, root):
  1. resolved = resolveLedgerOrFault(get, root); on fault → exit (same shape as check)
  2. IF ledger.budget.measure_session_id already set → exit 0 (write-once no-op)
  3. session = --session-id flag ?? process.env.CLAUDE_CODE_SESSION_ID
  4. env = session ? { ...process.env, CLAUDE_CODE_SESSION_ID: session } : process.env
  5. m = measureTokensByModelClass({ cwd: root, env, runStartMs: ownerStartMs })
  6. ledger.budget.measure_session_id = session ?? null
     IF m.source == "transcript":
        ledger.budget.tokens_at_start_by_model_class = Object.fromEntries(m.by_model)
        ledger.budget.tokens_at_start = byModelClassTotal(that map)
     ELSE  # estimate-degraded: record session, zero baselines (field present, meter still works)
        ledger.budget.tokens_at_start_by_model_class = {} ; ledger.budget.tokens_at_start = 0
  7. atomicWriteLedgerFenced(runDir, ledger, expectedOwner)
  8. exit 0
```

- **beep-boop prose:** the run-start baseline is snapshotted by `faff budget baseline --run-dir "$FAFF_RUN_DIR" --root "$measure_root" --session-id "$CLAUDE_CODE_SESSION_ID"`.

**Edge cases and fallback precedence.**

- **Legacy ledger (no `measure_session_id`, no per-model baseline):** session falls to `--session-id` then ambient; scalar derives to `0`. No regression.
- **`measure_session_id` present but that session's transcript is gone:** `source: estimate` → existing estimate path. Never over-counts.
- **`--session-id` explicitly passed:** wins over the persisted field (FAFF-488 override preserved).
- **Estimate path unchanged in `check`:** byte-for-byte today.

## 5. DESIGN DECISION RATIONALE

**Precedence of session sources.** Chosen: `--session-id flag > persisted (measure_session_id) > ambient` — FAFF-488 defines `--session-id` as the explicit operator selector; letting a persisted field beat it would silently break that contract.

**Compaction-boundary detection.** Chosen: do **not** wire `econIsCompactBoundary` into the sum loop in this issue — the reported defect is an over-count fully resolved by baseline + owning-session; boundary-aware summation addresses a different undercount mode and is deferred.

**Idempotency of `faff budget baseline`.** Chosen: write-once (no-op when `measure_session_id` already set) so a stray mid-run call cannot reset a run's baseline to a compacted mid-run total.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking.

**Assumptions.**

- The persisted owning-session transcript file continues to accumulate this run's usage records across a transparent compaction. If instead spend migrates to an unrecorded new session, the §4 undercount mode applies and the boundary-aware follow-up (§2) becomes the real fix — but the over-count this ticket reports is still removed.
- `atomicWriteLedgerFenced` is importable/usable from `budget.js` for the new subcommand.

## 7. DONE — Definition of Done

### From WHAT (fields / interfaces)
- [ ] `budget.measure_session_id` is read by `cmdBudget` and written by both L4 mint and `faff budget baseline`.
- [ ] `faff budget baseline --run-dir DIR [--root DIR] [--session-id ID]` exists, writes the baseline triple atomically, and is write-once (no-op when `measure_session_id` already set, exit 0).
- [ ] Session precedence is `--session-id flag > budget.measure_session_id > ambient CLAUDE_CODE_SESSION_ID`.

### From HOW (behaviour)
- [ ] `cmdBudget` derives `tokensAtStart` from `byModelClassTotal(tokens_at_start_by_model_class)` when the scalar is absent; an explicit scalar is still honoured; the FAFF-527 open-span override still wins on resumed runs.
- [ ] `effectiveEnv` overrides ambient `CLAUDE_CODE_SESSION_ID` with the resolved measuring session (selector only).
- [ ] L4 mint writes `budget.measure_session_id`.
- [ ] beep-boop prose calls `faff budget baseline` at run start.

### From HOW (edge cases)
- [ ] Legacy ledger: byte-for-byte today; no regression.
- [ ] Owning-session transcript missing → `tokens_source: estimate`; never over-counts.

### Regression tests (in `test/budget.test.mjs`)
- [ ] Baseline survives / grows past ceiling.
- [ ] Owning-session vs ambient (no flag).
- [ ] Precedence — explicit flag wins.
- [ ] `faff budget baseline` persists `measure_session_id` and is write-once on it.

confidence: medium
spec-review: approve
