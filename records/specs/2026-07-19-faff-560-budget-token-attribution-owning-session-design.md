# FAFF-560 — Budget token attribution honours the run's owning session over the ambient one

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-560.

## Why

`faff budget check` is the L4 spend governor: a token/cost ceiling breach is a fixed terminating floor at every level, so its token attribution must be exact — an over-count false-trips a real ceiling and halts a healthy unattended run.

Today `measureTokens` (and its by-class / by-model siblings) key transcript selection off the **ambient** `CLAUDE_CODE_SESSION_ID` (`bin/lib/budget.js`, `sid = env.CLAUDE_CODE_SESSION_ID`). After a mid-run compaction or a session hand-off the ambient session id can differ from the session that actually **owns** the run — the one whose `<sid>.jsonl` transcript carries this run's spend. When they diverge, the check meters a foreign session's transcript: it either sweeps in another session's spend (over-count) or degrades to estimate because the ambient session has no owned transcript. Both corrupt the governor.

The run already knows its true measuring session at mint time (the ambient `CLAUDE_CODE_SESSION_ID` present when `lights-out` minted the ledger, before any compaction). Persisting that and preferring it over the drifted ambient value restores correct attribution.

FAFF-488 established the `--session-id` flag as an **explicit operator override** of the metered session — "a selector, not a payload; non-leak by construction." That contract must survive: an explicit flag always wins.

## What

1. **Persist the measuring session at mint.** `lights-out` mint writes a new ledger field `budget.measure_session_id` = the ambient `CLAUDE_CODE_SESSION_ID` at mint time (the session whose transcript the run's spend accrues to).
2. **Prefer the persisted session over the ambient one in `budget check`.** In `cmdBudget`, resolve the metered session with precedence **`--session-id` flag > persisted `budget.measure_session_id` > ambient `CLAUDE_CODE_SESSION_ID`**, and hand the resolved id to the measure functions via the existing effective-env overlay (never mutating `process.env`, never writing it into any event/ledger field).

**Precedence rationale (deliberate divergence from the ticket's suggested order).**
**Chosen:** precedence is `--session-id` flag > persisted `measure_session_id` > ambient `CLAUDE_CODE_SESSION_ID`. The ticket's "owning over ambient" framing addresses only the persisted-vs-ambient pair; it is silent on the flag. Slotting the persisted value **below** the flag (not above it) preserves the FAFF-488 explicit-override contract — an operator who types `--session-id` is deliberately pinning the metered session and must still win, exactly as they do today. This is a closed decision, not an open question.

## How

All changes are in `bin/lib/budget.js` (read/selection side), `bin/lib/lights-out.js` (mint write), and the test files.

### Mint write — `bin/lib/lights-out.js`

The mint budget block is assembled at `const budgetBlock = { envelope };` (currently followed by the conditional `tokens_at_start_by_model_class` and the `metering` sub-object). Add the persisted measuring session alongside them.

**Chosen:** `budget.measure_session_id = process.env.CLAUDE_CODE_SESSION_ID || null`, written unconditionally on the mint budget block (mirroring how `owner.session_id` is written as `process.env.FAFF_SESSION_ID || null`).
- **Rationale — which session id.** The persisted field must be in the **Claude Code** session-id namespace, because `measureTokens` builds the transcript path from it (`${sid}.jsonl`). It is deliberately **not** `FAFF_SESSION_ID` (faff's own run-session id, used for `owner.session_id`) — that namespace does not name a transcript file. The mint's own baseline snapshot (`modelBaseline = measureTokensByModelClass({ env: process.env, … })`) already meters against this same ambient `CLAUDE_CODE_SESSION_ID`, so persisting it makes the check re-select the identical session the baseline was measured under.
- A `null` value (ambient session id unset at mint) is stored verbatim; the read side treats `null`/absent identically (both falsy → fall through to ambient), so pre-change ledgers and null-valued ledgers behave the same.

### Session selection — `bin/lib/budget.js` (`cmdBudget`)

Today `cmdBudget` builds the effective env **before** the ledger is resolved:

```
const sessionIdFlag = get("--session-id");
const effectiveEnv = sessionIdFlag ? { ...process.env, CLAUDE_CODE_SESSION_ID: sessionIdFlag } : process.env;
… // (later) resolveLedgerOrFault → ledger
```

**Chosen:** relocate the `effectiveEnv` construction to **after** the ledger is resolved (after the `const ledger = resolved.empty ? {} : resolved.ledger;` assignment) and fold the persisted field into the precedence:

```
const measureSessionId =
  sessionIdFlag                                  // 1. explicit flag (FAFF-488) — always wins
  || (ledger.budget && ledger.budget.measure_session_id)  // 2. persisted owning session
  || null;                                       // 3. else leave ambient untouched
const effectiveEnv = measureSessionId
  ? { ...process.env, CLAUDE_CODE_SESSION_ID: measureSessionId }
  : process.env;
```

- `sessionIdFlag` is captured where it is today (flag parsing is unchanged); only the `effectiveEnv` line moves down so it can read the ledger.
- **Non-leak preserved.** The resolved id is overlaid only onto the throwaway `effectiveEnv` handed to the measure functions — never `process.env`, never any event/ledger field — identical to the FAFF-488 flag mechanism.
- **Byte-for-byte fallbacks.** No flag + no persisted field (or an empty/absent-ledger run where `ledger.budget` is undefined) ⇒ `measureSessionId` is `null` ⇒ `effectiveEnv === process.env`, i.e. today's ambient resolution unchanged (preserves the FAFF-488 S4 "byte-for-byte ambient" test). The `measuredFull = measureTokensByModelClass({ … env: effectiveEnv … })` call site (well below the ledger read) already sits after the relocation point, so no other statement moves.

**Scope boundary — `budget check` only.**
**Chosen:** apply the persisted-precedence resolution to `cmdBudget` (`faff budget check`) only; leave `faff economics`' `--session-id` / ambient resolution as-is. `budget check` is the governor named in the acceptance criteria; `economics` is a reporting surface, not a terminating floor, and is out of this slice's scope. (A later slice may unify them; not this one.)

**Assumes:** the run ledger read by `budget check` (`resolveLedgerOrFault`) exposes `ledger.budget.measure_session_id` for runs minted after this change — validated by construction, since the same file's mint path is edited in this slice to write it. Pre-change ledgers legitimately lack the field and fall through to ambient (no regression).

## Done — Acceptance criteria

1. **Owning ≠ ambient → attribute to owning.** Given a ledger carrying `budget.measure_session_id: <owning>` and an ambient `CLAUDE_CODE_SESSION_ID: <ambient>` (different, each with its own transcript), `faff budget check` meters `<owning>`'s transcript: `tokens_source: "transcript"` and `spent.tokens` equal to `<owning>`'s baselined spend, not `<ambient>`'s. (Test in `test/budget.test.mjs`.)
2. **Flag beats persisted.** With the same ledger and `--session-id <flag>` supplied (its own transcript), the check meters `<flag>` — the persisted value is overridden, proving the FAFF-488 contract holds. (Test in `test/budget.test.mjs`.)
3. **No regression to single-session runs.** With no `budget.measure_session_id` in the ledger (owning == ambient), resolution is byte-for-byte the ambient path — the existing FAFF-488 S4 test still passes and a new explicit "persisted-absent → ambient" assertion holds. (Test in `test/budget.test.mjs`.)
4. **Mint writes the field.** A `lights-out` mint on a proceed path records `ledger.budget.measure_session_id === process.env.CLAUDE_CODE_SESSION_ID` (or `null` when unset). (Test in `test/lights-out.test.mjs` — the natural home for a mint-ledger assertion; a minor, justified addition to the ticket's file list, since the write lives in `lights-out.js`.)
5. **`budget --selftest` and the full `budget` / `lights-out` suites stay green** — no behavioural drift on any existing path.

## Files touched

- `bin/lib/budget.js` — relocate `effectiveEnv` construction below the ledger read; fold `ledger.budget.measure_session_id` into the flag > persisted > ambient precedence.
- `bin/lib/lights-out.js` — mint writes `budget.measure_session_id` on the budget block.
- `test/budget.test.mjs` — precedence tests (owning≠ambient, flag-beats-persisted, single-session regression).
- `test/lights-out.test.mjs` — mint-write assertion.

## Methodology critique (agile-delivery lens)

- **Right-sized?** Yes. One cohesive concern (session-selection correctness for the budget governor) across ~3 source touch-points; a clean single 1–3 day unit. No split warranted.
- **Workstream fit?** Yes. Slice 2 of 2 under FAFF-552 (budget baseline/attribution correctness); outcome-named and cohesive with FAFF-558 and the FAFF-488 override contract it preserves.
- **Deps surfaced?** Yes. Same-file collision with FAFF-558 (`bin/lib/budget.js` `measureTokens` path) is explicit — build-serialise behind FAFF-558, a rebase ordering, not a logical blocker. No implicit dep is hidden.
- **Risk profile?** Low-novelty but governor-touching: an attribution error false-trips a terminating ceiling. De-risked by the named regression + precedence tests and the byte-for-byte fallback assertions; no de-risking spike needed.

confidence: high
spec-review: approve
