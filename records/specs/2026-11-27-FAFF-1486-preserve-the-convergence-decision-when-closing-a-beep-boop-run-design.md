# Spec: preserve the convergence decision when closing a beep-boop run (FAFF-1486)

> Spec: faffter-dark-nlspec · 2026-11-27 · interactive · claude-code/unknown · faff 0.45.0 · confidence: high. Full spec on Linear FAFF-1486.

This spec makes `faff run close` honour a run's saved convergence decision instead of trusting the stop token the orchestrator picks by prose. The build agent implements it in `run-wave-consult.ts` and `run-close.ts`, rebuilds the committed `.js` emit, and extends the installed E2E scorer. Human reviewers check the mapping table and the override rule.

## 1. WHY

The close verb takes its stop token verbatim from the caller, and the run-done verdict from `faff run wave-consult` is printed once and never persisted. So when a consulted run drains, the orchestrator reads the summary's prose, can pick `queue-drained`, and the closed ledger then disagrees with the wave report's `converged/both-dry`. The fix is to persist each consult's decision durably as a per-wave record and have close adopt a terminal record's canonical token over a generic fallback argument.

**Problem.** Run `run-20261126-045730-beepboop-full-1e8076` (#1336) recorded `converged/both-dry` for wave 2 and then closed with `queue-drained`, failing the installed parallel E2E ledger check. Both tokens are valid, so nothing rejects the mismatch. The change makes the consult's decision the single source of the stop reason whenever it terminated the run.

**Design principles.**

- **A generic argument never overrides a terminal decision.** `queue-drained` and `all-remaining-parked` describe "the queue emptied", which a consulted drain refines. Reject any implementation where they win over a saved terminal consult.
- **A specific caller token is never rewritten.** Budget, sentry, escalation, governance and an explicit `converged/both-dry` are informed claims by the caller. Budget, sentry and governance tokens carry outcomes the consult cannot see (a sentry abort, a failed admit). Reject any implementation that substitutes the record for them. Only an explicit `converged/both-dry` is checked against the record and flagged on contradiction, because it is the consult's own canonical token; budget, sentry and governance tokens pass through without a check.
- **One mapping, two readers.** The verdict-to-token mapping is one pure function. The writer calls it to fill the record, and close calls it again on the record's `verdict` and `reason` rather than trusting the stored field, so a malformed or out-of-date record cannot inject a token the mapping would not produce.
- **A consult is adopted only while it is still the last word.** Freshness is defined by the ledger digest: a terminal decision followed by any change to the ledger's admitted list or outcomes map was overridden by the run, so close does not adopt it. Changes outside those two fields are out of scope for freshness.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/run-wave-consult.ts` (+ `.js` emit) | TypeScript | Computes the run-done verdict; gains the durable record |
| `plugin/skills/faff/bin/lib/run-close.ts` (+ `.js` emit) | TypeScript | Validates the token, appends `run-end`, writes `stop_reason`; gains adoption |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | `writeOwnerOnlyJson` (no mkdir) |
| `plugin/skills/faff/bin/lib/run-done.js` | JavaScript | Verdict ladder and reasons; unchanged |
| `plugin/skills/faff/bin/lib/run-wave-mode.ts` | TypeScript | Style precedent for an owner-only run-dir JSON write |
| `test/beep-boop-e2e/wave_score.py` | Python | Installed E2E scorer with the closed-ledger assertion |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown | Wave logs under `wave-N/`, Stopping condition, At orchestrator exit |

**Scope.** Both verbs sit in the factory region of the beep-boop run-end path; no governance surface changes.

## 2. OUT OF SCOPE

- **Making the orchestrator derive the token itself**, close adoption makes the argument safe, so prose selection stops mattering. Extension point: `run summary` could render the adopted token (`run-summary.ts`) in a later ticket.
- **Persisting non-consulted run decisions** (budget checks, sentry), those paths already pass specific tokens. Extension point: a sibling record beside `run-done.json`.
- **Changing the run-done ladder or reasons**, `run-done.js` stays as is.
- **Decision capture** (`capture.decision_kernel`), stays optional and separate from the new record. Extension point: `decision-capture`.
- **Finding the version that introduced the gap**, release 0.45.0 already had overlapping guidance; not needed for the fix.

## 3. WHAT

**Vocabulary.**

| Term | Definition |
|---|---|
| Wave record | `<run-dir>/wave-<N>/run-done.json`, written by every `run wave-consult` call |
| Terminal record | A wave record whose derived stop reason is a token (not null) |
| Fresh record | A wave record whose non-null `ledger_digest` equals the digest of the ledger's admitted list and outcomes map at close, so no work was admitted, finished or changed state after the consult |
| Generic fallback token | `queue-drained` or `all-remaining-parked` as the close argument |
| Latest record | The wave record in the highest-numbered `wave-<N>` directory |

```
RECORD WaveRecord:                 # owner-only JSON, overwritten per call for the same wave
  run_id: String                   # basename of the run dir
  wave: Integer                    # >= 1, equals the directory N
  verdict: "run-complete" | "continue" | "escalate"
  reason: String                   # as returned by computeRunDoneVerdict
  stop_reason: String | null       # stopReasonFor(verdict, reason), kept for the human-readable report
  ledger_digest: String | null     # sha256 of the ledger's admitted list and outcomes map when consulted; null when the ledger was unreadable
  correlation_id: String

RECORD CloseResult (additions):
  stop_reason: String              # the token actually used
  stop_reason_adopted: Boolean     # true when the wave record replaced the argument
```

**Canonical mapping** (pure function `stopReasonFor(verdict, reason)`):

| Verdict | Reason | `stop_reason` |
|---|---|---|
| run-complete | drained, all-parked, value-inflection | `converged/both-dry` |
| run-complete | `budget-hit(<dims>)` | the reason verbatim |
| escalate | `budget-escalated(<dims>)` | the reason verbatim |
| escalate | `non-convergence`, `product-incomplete` | the reason verbatim |
| continue | any, including work-remaining, undispatched-ledger and `budget-narrow(<dims>)` | null |
| any | any verdict and reason pair not listed above (for example `run-complete` with `non-convergence`, or `escalate` with `drained`, which a methodology policy can produce), or a reason that fails `validStopToken` | null |

**Design decisions.**

- Persist where, and in what form? **Chosen:** a per-wave `run-done.json` beside the existing `wave-N/` logs, written with the owner-only JSON style of `wave-mode.json`, on every consult regardless of decision capture. Rationale: the wave directory is already the wave report's home, so the record is the report the ledger must agree with, and capture is off by default.
- Which close arguments may be replaced? **Chosen:** only the generic fallback tokens; an explicit `converged/both-dry` that contradicts a fresh record is kept and flagged, because the ticket scopes the override to the generic argument. Rationale: they are the only tokens that mean "nothing more specific known"; every other token encodes an outcome the consult cannot see.
- Which record does close read? **Chosen:** the latest record only, and only while fresh. Rationale: a later `continue` means the run went on, and a terminal record followed by more admitted or finished work was overridden; the ledger digest in the record makes that checkable without trusting the orchestrator's loop discipline.
- Where does the mapping live? **Chosen:** one pure function in a new small TypeScript module `run-stop-reason.ts` (committed `.js` emit alongside), imported by both verbs. Rationale: one reader-writer contract without close importing the heavy consult module; new `bin/lib` modules are TypeScript. `validStopToken` and its token lists move into that module and close imports them (close keeps its existing export as a re-export), so there is one definition of the stop-token vocabulary and no pin test is needed.

## 4. HOW

**Writer.** After computing the decision, `run wave-consult` creates `wave-<N>` if absent, writes the wave record, then prints its existing output. A failed write adds the warning `run-done-record-unwritable` and does not change the exit code, so the consult stays advisory.

**Close resolution.** Close resolves the effective token once the run dir and root are validated and before any step that writes, and uses it for validation, the prior-close check, the `run-end` event, the ledger write and the human line.

```
PROCEDURE resolve_stop_reason(run_dir, arg):
  1. IF arg is neither generic nor converged/both-dry: RETURN arg, adopted=false
  2. dir = the highest-numbered wave-<N> directory in run_dir (none: RETURN arg, adopted=false)
     record = dir/run-done.json parsed as a WaveRecord with run_id equal to the
     run dir name and wave equal to N (missing or invalid: add the matching
     fault, RETURN arg, adopted=false); no other directory is read
  3. derived = stopReasonFor(record.verdict, record.reason)
     IF derived differs from record.stop_reason: add fault wave-record-inconsistent,
       RETURN arg, adopted=false
  4. IF the record is not fresh: add fault wave-record-stale, RETURN arg, adopted=false
  5. IF arg is converged/both-dry:
       IF derived differs from arg (null, or another token): add fault close-contradicts-wave-record
       RETURN arg, adopted=false          # a specific token is never rewritten
  6. IF derived is null: RETURN arg, adopted=false
     (queue-drained and all-remaining-parked against a null record raise no fault)
  7. RETURN derived, adopted=true
```

Validation of the argument itself still happens first, so an unknown argument still exits 2. The prior-close check compares the ledger's `stop_reason` with the effective token, so a second close with `queue-drained` after an adopted close is idempotent.

**Edge cases.**

- The latest record is read from the highest-numbered `wave-<N>` directory only; an older directory is never consulted, so a stale terminal record cannot be adopted.
- That directory holds a malformed, unparseable, run_id-mismatched or wave-mismatched `run-done.json`: fall back to the argument, add the fault `wave-record-unreadable`, never fail the close, even when an older wave holds a readable terminal record.
- That directory exists but holds no `run-done.json` (a failed write after the directory was created, or a lost record): fall back to the argument and add the fault `wave-record-missing`, so a degraded consult is visible at close and distinguishable from a never-consulted run.
- No `wave-<N>` directory exists: the run never consulted; the argument stands and no fault is added.
- The argument is `converged/both-dry` and the latest record is fresh but its derived token is null (the consult said `continue`) or a different token such as `budget-escalated(cost)`: the argument stands, because a caller token is never rewritten, and close adds the non-failing fault `close-contradicts-wave-record` so the contradictory convergence close is visible in the result.
- The latest record is terminal but not fresh (the run admitted or finished work after the consult, for example an escalation the orchestrator did not obey, or discovered scope built after a `run-complete`): close adds the fault `wave-record-stale`, never adopts it, and the argument stands.
- The stored `stop_reason` differs from `stopReasonFor(verdict, reason)`: fault `wave-record-inconsistent`, argument stands.
- Abort exemption is unaffected: `sentry-abort` is not generic, so it passes through.
- Budget breach after a clean consult: the caller passes `budget-hit(...)`, which passes through.

**Human output.** The line reads `closed as <effective token>`, with `(adopted from the wave record; argument was <arg>)` when adopted. `--json` carries `stop_reason` and `stop_reason_adopted`.

**Failure modes.**

- **The failure:** a terminal record goes stale because the run carried on after the consult. **How you'd know:** the close result carries `wave-record-stale` and the ledger holds the generic argument. **What it means:** the ledger is as accurate as the orchestrator's prose argument again, and the fault says why adoption was withheld; the beep-boop loop consults every wave, so a run that drains normally ends on a fresh record.

**Anti-pattern:** having close recompute the verdict from the ledger. Why: close lacks the queue and budget inputs, so it could disagree with the report again.

**Anti-pattern:** letting the record override any token. Why: it would mask a sentry abort or a failed governance admit.

**Skill prose.** In `faff-beep-boop/SKILL.md`, the At orchestrator exit step keeps passing the summary's token and gains one line: close adopts a saved terminal consult, so a consulted drain closes as its canonical reason. The wave-log paragraph lists `run-done.json` among the files under `wave-N/`. Neither edit deletes a rule, so no rule inventory is needed. Update the `run wave-consult` and `run close` rows in `docs/guide/cli.md`.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run whose wave 2 consult returned run-complete with reason drained
And the ledger has every admitted issue shipped
When the orchestrator runs close with --stop-reason queue-drained
Then the ledger stop_reason is converged/both-dry
And the run-end event data stop_reason is converged/both-dry
And the wave 2 run-done.json stop_reason is converged/both-dry
```

```
Given a run that never called wave-consult and drained its queue
When close runs with --stop-reason queue-drained
Then the ledger stop_reason is queue-drained
And the close result reports stop_reason_adopted false
```

## 6. DESIGN DECISION RATIONALE

- **Where does the saved decision live?** Options: ledger field written by consult (needs owner-epoch locking in an advisory verb); decision-capture (off by default); per-wave file. **Chosen:** per-wave file, because it needs no ledger lock and is already where wave reports live.
- **Adopt always, or only over generic tokens?** Options: always (masks sentry and admit failures); generic only. **Chosen:** generic only, per the acceptance criteria that budget, sentry and escalation outcomes are preserved.
- **Reject a mismatching argument instead of adopting?** That would fail runs the orchestrator closes by prose. **Chosen:** adopt silently with a reported flag, because the ticket asks the generic argument not to override, not to error.
- **Fail the consult on a write error?** **Chosen:** warn only, so a read-only run dir cannot block convergence.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumes:** `computeRunDoneVerdict` reasons are exactly the set in `run-done.js` (drained, all-parked, value-inflection, `budget-hit(<dims>)`, `budget-escalated(<dims>)`, non-convergence, product-incomplete, work-remaining, undispatched-ledger, `budget-narrow(<dims>)`). Validate by reading the `RUN_DONE_RUNG_CANON` table and floor rungs before building. Every reason form in the mapping table (`budget-hit(<dims>)`, `budget-escalated(<dims>)` with comma-joined dims from until, max_attempts, tokens, cost and window, `non-convergence`, `product-incomplete`) already satisfies today's `validStopToken`, so relocating it changes no accepted token; a test asserts each table row maps to a non-null token.

**Assumes:** the ledger's `admitted` list and `outcomes` map are readable from `run-ledger.json` and hashable identically in both `run wave-consult` (which already audits the ledger) and close. Validate by reading `runcheck`'s ledger audit before building.

**Assumes:** `writeOwnerOnlyJson` from shared-infra writes a temp file beside the target and does not create directories. Validate by reading it; the writer therefore creates `wave-<N>` first with the existing owner-only directory helper in `shared-infra.js` (`ensureOwnerOnlyDir`, mode 0700), validating its name and signature before use.

## 8. DONE

### From WHY
- [ ] A consulted drain closed with `--stop-reason queue-drained` produces a ledger, `run-end` event and wave record that all say `converged/both-dry`.
- [ ] The installed parallel and sequential E2E still assert `ledger["stop_reason"] == "converged/both-dry"`.

### From WHAT
- [ ] `run wave-consult` writes `wave-<N>/run-done.json` with run_id, wave, verdict, reason, stop_reason, ledger_digest and correlation_id for run-complete, continue and escalate verdicts, with `decision_kernel` capture off.
- [ ] The mapping function (module `run-stop-reason.ts`, emit committed, `faff regions check` passing) returns the table's tokens, and null for `continue` and for a reason failing `validStopToken`.
- [ ] The `--json` close result includes `stop_reason` and `stop_reason_adopted`.

### From HOW
- [ ] A close with `--stop-reason queue-drained` on a run with no wave records closes as `queue-drained`.
- [ ] Closes with `budget-hit(tokens)`, `budget-escalated(cost)`, `sentry-abort`, `governance-admit-failed` or `converged/both-dry` against a terminal record keep the passed token and report adopted false.
- [ ] A latest record with verdict `continue` leaves `queue-drained` and `all-remaining-parked` unchanged, even when an older wave record is terminal.
- [ ] A malformed or run_id-mismatched latest record falls back to the argument with fault `wave-record-unreadable` and exit 0.
- [ ] A malformed latest record with an older readable terminal record still falls back to the argument with fault `wave-record-unreadable`, and the older record is not adopted.
- [ ] A latest `wave-<N>` directory with no `run-done.json` falls back to the argument with fault `wave-record-missing` and exit 0, even when an older wave holds a terminal record.
- [ ] A close with `converged/both-dry` against a fresh latest record whose derived token is null, or is a different token such as `budget-escalated(cost)`, keeps `converged/both-dry`, reports adopted false, adds fault `close-contradicts-wave-record` and exits 0.
- [ ] A close with `queue-drained` against a terminal latest record that is not fresh (an admission, outcome or outcome state change after the consult, or a null `ledger_digest`) keeps `queue-drained`, adds fault `wave-record-stale` and exits 0, including for a stored `escalate` record.
- [ ] A close with `queue-drained` or `all-remaining-parked` against a fresh record deriving a specific token such as `budget-hit(tokens)` or `non-convergence` adopts that token and reports adopted true.
- [ ] A record whose stored `stop_reason` differs from `stopReasonFor(verdict, reason)` is never adopted and adds fault `wave-record-inconsistent`.
- [ ] A second close with `queue-drained` after an adopted close exits 0 and leaves the ledger unchanged.
- [ ] An unwritable wave directory yields warning `run-done-record-unwritable` and exit 0 from `run wave-consult`.
- [ ] `test/run-close.test.mjs` and `test/run-wave-consult.test.mjs` cover each case above.
- [ ] `test/beep-boop-e2e/wave_score.py` also asserts that, when the latest wave record's `stop_reason` is not null, the closed ledger's `stop_reason` is not a generic fallback token (`queue-drained`, `all-remaining-parked`), so it equals the record or carries any specific close token the caller passed, and that a null record imposes no check, `test_wave_score.py` has a matching passing and failing fixture, and the committed `.js` emit and `build-manifest.json` are rebuilt.
- [ ] The beep-boop skill, `docs/guide/cli.md` rows and `faff validate-adapters` pass.

**Integration smoke test:**

```
1. Open a run, ship one issue, call wave-consult wave 1 (queue empty, ledger clean)
2. Assert wave-1/run-done.json has stop_reason converged/both-dry
3. Call run close with queue-drained
4. Assert ledger stop_reason, run-end event and wave record agree
```

confidence: high
build-tier: complex
admissibility: admissible

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"} ], "self_review": ["major","minor","minor"] }
```
