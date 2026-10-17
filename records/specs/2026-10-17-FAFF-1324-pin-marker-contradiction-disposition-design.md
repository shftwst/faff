# Spec — FAFF-1324: the governor's disposition toward an unvouchable pin marker

> Spec: faffter-dark-nlspec · 2026-10-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1324.
> build-tier: complex

This artifact specs FAFF-1324, a spike whose deliverable is a decision plus the localised change that decision implies. It is written for the build agent that will make the change and for the human reviewing the decision itself. The decision is the substance; the code change is three lines.

## 1. WHY — Problem and Principles

**The load-bearing model.** `--govern` decides, once per review round, how far back the convergence window may be read, and the whole point of the window is that every round inside it was served by the *same* reviewer. To know that, the governor needs to know which round established the pin. When the pin-capture marker cannot tell it (`pin-marker-missing`, `pin-marker-contradiction`), the governor today guesses the *earliest* possible answer, `capRound = 1`. One line later the rule `if (newWs < capRound)` can therefore never fire, so the window is never narrowed and convergence is read across rounds the loop cannot prove share a reviewer. The honest value of an unreadable pin round is "unknown, somewhere in `[1..n]`". This spike decides which end of that range the governor should take.

**Problem statement.** `spec-review-window.js:242-245` records a missing or contradictory capture marker as a soft anomaly and sets `capRound = 1`, which silently disables the late-pin-advance rule for that round and every later one. The convergence read then spans rounds served by potentially different backends, which is the exact failure FAFF-1052 built this machinery to stop. This change makes the governor take the conservative end of the unknown range instead, without turning the state into a failure.

**Design principles.**

**Fail-safe at a boundary the system cannot vouch for.** The same function already states this twice: "MUST take this fail-safe" at `:207`, "never a silent compare" at `:233`. Four of the six anomaly arms narrow the window to `n`. The marker arms are the only ones that widen by omission.

**Narrowing only, never widening.** A governed round may raise `window_start`, never lower it. A human unpark deliberately narrows the window (`faff-prep/SKILL.md:130`); a later governed round must not undo that.

**One action is the disposition taken; the anomaly is the cause.** `action: "fault"` already serves two distinct anomalies (`pin-identity-malformed`, `served-identity-missing-or-malformed`). Discrimination lives in `anomaly` and `capture_state`, not in a per-cause action token.

**A shipped ticket's acceptance is a constraint, not a preference.** FAFF-1052 is Done. Its acceptance says the no-lens-served skip path *stays a legitimate no-op and is not turned into a failure*. No disposition chosen here may re-open that.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-review-window.js:242-255` | JavaScript | The branch under decision, and the two rules it feeds |
| `plugin/skills/faff/bin/lib/spec-review-window.js:205-240` | JavaScript | The four sibling anomaly arms whose disposition is already settled |
| `plugin/skills/faff/bin/lib/spec-review-pin.js:109-271` | JavaScript | Writes the marker; `readCaptureOutcome` conflates absent with torn by design |
| `plugin/skills/faff-prep/SKILL.md:126-128` | Prose | The sole consumer of `--govern` |
| `test/spec-review-window.test.mjs:347-373, 418-432, 455-500` | Node test | The committed assertions this change must move |

**Scope statement.** This sits inside the per-round window governance of the spec-review loop, one branch of one function, and changes nothing about how the window is read, who writes the marker, or how convergence is computed.

## 2. OUT OF SCOPE

- **Repairing the marker so the anomaly stops latching.** Once the marker is wrong, nothing rewrites it: `capturePin`'s existing-pin arm (`spec-review-pin.js:214-224`) writes only `served-<n>.json` and returns. So the anomaly, and therefore the narrowed window, persists for the rest of the loop. Excluded because repairing a pin-capture marker from the pin is a write-path design question, not a governor disposition, and the ticket's guard forbids a window-governance rewrite. Extension point: `capturePin`'s existing-pin arm in `plugin/skills/faff/bin/lib/spec-review-pin.js`, which already knows the pin exists and could re-assert `{state:"captured"}` with the pin's own round if that round were recoverable.
- **Closing the second residual cause of a contradiction.** The pin-CLI's `--backends-json` read-failure marker write (`spec-review-pin.js:378-383`) is *not* guarded by pin existence, so it can overwrite a healthy `{captured, round:1}` marker with `{failed, round:3}`. Excluded: this spike decides the governor's disposition toward the state whatever caused it; FAFF-1323 already took the cause-fixing half. Extension point: the same `atomicWriteJSON(pinCapturePath(dir), ...)` call site, which could skip or merge when `pinned-reviewer.json` exists.
- **A non-authoritative "window is suspect" channel into convergence.** Rejected on the merits below, and it would require `detectSpecReviewConvergence` (`spec-review-convergence.js:77`) to take a governance input it is deliberately blind to. Extension point: the convergence CLI wrapper, which already owns the directory read and the `--window-start` bound.
- **The anomaly taxonomy itself.** The ticket's own guard excludes it. No anomaly token is added, removed, or renamed.
- **`judge-trail.js`'s silent degradation to `window_start = 1`** (`:146`). A different reader with a different contract (audit reconstruction, not governance). Extension point: `judge-trail.js:47,150`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Capture marker | `pin-capture.json`, the disk record of which round established the pin and whether that capture succeeded |
| Unvouchable marker | A marker that is absent, torn, or present with `state != "captured"` while a pin exists: `pin-marker-missing` or `pin-marker-contradiction` |
| Marker-arm pair | The two anomalies of the single ternary at `spec-review-window.js:245`; one statement, one severity, one fallback |
| Latch | The property that an unvouchable marker is never repaired, so the anomaly recurs on every later governed round of the loop |

**The record under change is unchanged in shape.**

```
RECORD GovernanceResult:                # persisted as governance-<n>.json
  round:           Integer              # >= 1
  window_start:    Integer              # >= 1; MONOTONIC per loop — never lowered by a governed round
  action:          ActionToken          # the disposition taken
  anomaly:         AnomalyToken | null  # the cause, when the round was not clean
  served_identity: String | null
  capture_state:   "captured" | "failed" | "skipped-no-lens" | "absent"
  capture_round:   Integer | null
  ts:              Timestamp

  CONSTRAINT keys are exactly the eight above — no field added by this change
```

```
ENUM ActionToken:   no-lens | unpinnable-reset | late-pin-advance | swap-reset | unchanged | fault
ENUM AnomalyToken:  null | round1-capture-missed | unpinnable | pin-identity-malformed
                  | served-identity-missing-or-malformed | pin-marker-missing
                  | pin-marker-contradiction
```

Both enums are the committed sets. This change reassigns which `ActionToken` the two marker anomalies pair with; it mints nothing.

**Design decision — which end of the unknown range.** The marker arms resolve an unknown pin round. `capRound = 1` takes the permissive lower bound and compares across an unvouched boundary; `capRound = n` takes the conservative upper bound and narrows the window to this round.

**Chosen:** `capRound = n`, the conservative bound, exit 0 preserved, matching the disposition the other four anomaly arms and both of prep's adjacent seams already take.

**Design decision — reset by assignment, or by falling through the existing rules.** The disposition could be implemented as an early `writeWindowStart(dir, n)` plus an immediate return (mirroring the `pin === null` arm at `:207-217`), or by setting `capRound = n` and letting the existing late-pin and swap rules run.

**Chosen:** set `capRound = n` and fall through. At this point in the function both swap operands are already validated well-formed (`:227-240`), so a genuine backend swap is computable and `swap-reset` remains the truer record of the round. An early return would discard a fact the function already has. The window outcome is identical either way.

**Design decision — which action token the reset reports.** Reuse `unpinnable-reset`, or mint a new token such as `unvouched-pin-reset`.

**Chosen:** reuse `unpinnable-reset`. One action per disposition, discrimination via `anomaly` and `capture_state`, exactly as `fault` already serves two anomalies. A new token would be new vocabulary in a ticket whose guard excludes taxonomy work, and nothing consumes `action` behaviourally.

**Design decision — scope across the marker-arm pair.** `pin-marker-missing` and `pin-marker-contradiction` are the two arms of one ternary, with the same severity and the same fallback, and `readCaptureOutcome` (`spec-review-pin.js:112-123`) deliberately returns `null` for absent and torn alike; its comment asserts no case distinguishes them.

**Chosen:** the decision applies to **both arms**, identically. Splitting them would require a distinction the reader is documented not to make, and the `-missing` arm carries the more live hazards (a legacy pin, a torn marker, a crash between `capturePin`'s pin write and its marker write at `:244-245`).

## 4. HOW — Behavior

**Architecture and approach.** The change is confined to the marker-fallback ternary and the late-pin rule immediately below it, inside `govern()`. Nothing before the ternary moves: the `no-lens` early return, the `pin === null` fail-safe, and both identity faults are untouched, so no path that exits 2 today changes and no path that exits 0 today starts exiting 2.

```
PROCEDURE govern_marker_arms(ws, n, cap, servedIdentity, pinIdentity):
  # Behaviour summary: resolve the pin round, preferring the marker's own answer; when the
  # marker cannot answer, assume the pin is no older than this round and narrow accordingly.
  1. IF cap exists AND cap.state == "captured":
     a. capRound := cap.round
     b. anomaly  := null
  2. ELSE:                                  # the unvouchable-marker arms
     a. capRound := n                       # was 1 — the only substantive change
     b. anomaly  := "pin-marker-contradiction" IF cap exists ELSE "pin-marker-missing"
  3. action := "unchanged";  newWs := ws
  4. IF newWs < capRound:                   # (L) the late-pin rule, unchanged in form
     a. newWs  := capRound
     b. action := "late-pin-advance" IF anomaly == null ELSE "unpinnable-reset"
  5. IF servedIdentity != pinIdentity:      # (S) the swap rule, unchanged
     a. newWs := n;  action := "swap-reset"
  6. Persist window_start := newWs and the GovernanceResult; RETURN code 0
```

Step 4b is the only place the anomaly influences the reported action, and `anomaly` is `null` only on the clean branch, so it is a sound discriminator.

**Edge cases.**

- **The window is already at `n`.** `newWs < capRound` is false, so the round reports `action: "unchanged"` with `window_start: n` and the anomaly recorded. Already fail-safe; no write-churn, no false reset.
- **A human unpark narrowed the window past this round.** `window_start` can equal `n` but never exceed it in a governed loop; the comparison is a strict `<`, so the rule can only raise `window_start`. The monotonic constraint holds, and an unpark's narrowing is never undone.
- **Round 1.** `ws` is 1 and `capRound` is 1, so the rule does not fire, `action` stays `unchanged`, `window_start` stays 1, identical to today. The change is inert at round 1, which is correct: there is no earlier round to wrongly compare against.
- **Contradiction plus a genuine swap.** Rule (S) runs after (L) and overrides, so the record reads `swap-reset` with the anomaly still attached. The window is `n` either way.
- **`capture_state` / `capture_round` cross-refs.** Still built by `captureCrossRefs` (`spec-review-pin.js:160-166`) from the marker as found, so a consumer can still see `"failed"` / `"absent"` verbatim. Unchanged.

**Failure modes.**

- **The failure: the latch makes the loop never converge.** Because nothing repairs the marker, every later governed round also narrows to `n`, so the convergence window is permanently `[n..n]`. `detectSpecReviewConvergence`'s insufficient-input arm (`spec-review-convergence.js:84-96`) then returns `converging: false` for the rest of the loop, the loop-cap yield never fires, and the loop runs to the appetite ceiling and parks `needs-human`. The round-1-vs-round-2 churn check is likewise starved of an in-window prior round, so it cannot park the loop early either.
  **How you'd know:** a prep run whose `prep.md` surfaces a marker anomaly and then parks at the cap with `converging: false` on every round, with each `governance-<n>.json` reading `window_start == round`.
  **What it means: proceed, and accept it — but not for the reason it first appears.** The status quo does not yield a cheap wrong answer in the unsafe direction. A wider window is biased *safe*: this module says so at `spec-review-window.js:18-21`, "a wider window can only make convergence harder to reach, never easier, so it can only over-park, never over-yield", and the comparator confirms it, since `converging` requires `strictly_decreasing` across every consecutive pair in the window and `no_churn` across every step (`spec-review-convergence.js:98-118`), both strictly harder to satisfy as the window widens. FAFF-1052 describes the same direction: "a forced fallback looks like churn; a stronger primary returning after a fallback looks like non-convergence". The committed oracle at `test/spec-review-window.test.mjs:455+` is itself a demonstration of over-parking, not of a false yield: `window_start: 1` *fails* to converge over rounds that converge when correctly windowed.

  So both dispositions terminate at `needs-human`, and this change does not buy a safer outcome. What it buys is the FAFF-1052 acceptance criterion and a comparison the loop can vouch for. What it costs is the one case where a correct yield was still reachable — every round genuinely served by one reviewer, which is the common case even with a torn marker — plus the remaining rounds of the appetite cap burned before parking. Narrowing to `[n..n]` is weakly *more* parking than the status quo, not less. That trade is worth taking because an unfounded comparison that happens to be biased safe is still unfounded, and the spike's job is to make the governor's claim about its own window honest. The cost is bounded by the appetite cap, is loudly attributable in `prep.md`, and the self-heal that removes it is named in OUT OF SCOPE with its extension point.
- **The failure: the state is unreachable, so the change is dead code.** FAFF-1323 fixed the no-lens clobber, which was the known cause of a contradiction.
  **How you'd know:** no residual writer of a non-`captured` marker while a pin exists.
  **What it means:** verified not to hold. Two residual paths remain. The pin CLI's `--backends-json` read-failure marker write (`spec-review-pin.js:378-383`) runs *before* `capturePin` and is not guarded by pin existence, so a round-3 unreadable backends file overwrites a healthy round-1 `{captured}` marker with `{failed, round:3}` while the pin survives, a live `pin-marker-contradiction`. And `capturePin` writes the pin (`:244`) and the marker (`:245`) as two separate atomic writes, so a crash between them leaves a pin with no marker, a live `pin-marker-missing`, alongside the legacy-pin and torn-marker cases the committed selftest already constructs (`spec-review-window.js:553`). Proceed.

**Anti-pattern:** making either marker arm exit 2. Why: prep's non-zero-exit branch (`faff-prep/SKILL.md:127`) already takes `window_start := n`, so exit 2 produces the *same* window as the chosen disposition while additionally labelling a recoverable bookkeeping gap a plumbing fault, and re-opening the turn-a-legitimate-no-op-into-a-failure class that FAFF-1052's acceptance forbids and FAFF-1323 just closed.

**Anti-pattern:** adding a `window_trustworthy` field to `GovernanceResult`. Why: nothing consumes `anomaly` behaviourally today (`SKILL.md:126` prints all four soft values as a set), the convergence comparator takes no governance input at all, and a field no consumer reads is vocabulary growth inside a ticket whose guard excludes it.

**Anti-pattern:** changing prep's `--govern` invocation shape. Why: `test/spec-review-window.test.mjs:268` prose-lints the exact command strings, and `validate-adapters.js:65` pins `faff-prep` at 622 lines against a current 621. The chosen disposition needs no prep change at all: prep's exit-0 branch already assigns `window_start := result.window_start` and already names both marker anomalies in its loud-surface set.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a pin established at round 1 and a capture marker overwritten to {state:"failed"} at round 3
  And a well-formed served-3.json whose identity equals the pin's
  And window.json reading window_start: 1
When round 3 is governed with --any-served
Then the call exits 0
  And the GovernanceResult reads window_start: 3, action: "unpinnable-reset",
      anomaly: "pin-marker-contradiction", capture_state: "failed"
```

```
Given a pin on disk with no pin-capture.json at all (a legacy pin)
  And a well-formed served-3.json whose identity equals the pin's
When round 3 is governed with --any-served
Then the call exits 0
  And the GovernanceResult reads window_start: 3, action: "unpinnable-reset",
      anomaly: "pin-marker-missing", capture_state: "absent", capture_round: null
```

- No `--govern` invocation that exits 0 today exits non-zero after this change, and none that exits 2 today exits 0.
- `GovernanceResult` carries exactly the eight committed keys; no field is added.
- No `AnomalyToken` or `ActionToken` value is minted, renamed, or removed.

## 6. Design Decision Rationale

**Should an unvouchable pin marker fail a governed round?**

| Option | Window outcome | Exit | Verdict |
|---|---|---|---|
| 1. Keep soft, document why (status quo) | left wide | 0 | Rejected |
| 2. Promote to a fault | `n` (via prep's non-zero branch) | 2 | Rejected |
| 3. Carry a "window untrustworthy" signal into the convergence read | left wide, flagged | 0 | Rejected |
| 4. Treat as unpinnable: narrow to `n` | `n` | 0 | **Chosen** |

**Chosen:** option 4, narrow the window to `n`, record the anomaly, exit 0.

**Why not option 1.** Be precise about what is wrong with the status quo, because it is neither an unsafe outcome nor a shipped-acceptance breach. `capRound = 1` leaves the window wide, and a wide window is biased toward over-parking rather than over-yielding (`spec-review-window.js:18-21`; see Failure modes). The defect is narrower and purely epistemic: `window_start` is published as the span the loop can vouch for, and with `capRound = 1` it is not. The governor makes a comparison it cannot justify and reports the result as though it could. The committed oracle at `test/spec-review-window.test.mjs:455+` shows the shape of it, and shows it in the over-park direction: its own inline comment concedes that the fixture's counts still fall, so it demonstrates the failure as churn, asserting `converging === false`.

Three grounds reject option 1, in descending strength.

1. **The fail-safe idiom is already settled for this exact predicament, twelve lines away.** `:207` calls narrowing to `n` a fail-safe the governor *MUST* take when "the loop cannot prove which round established the pin". Four of the six anomaly arms narrow to `n`; prep narrows at both of its adjacent seams (`faff-prep/SKILL.md:127`, `:128`). The marker arms are the only ones that widen by omission, and nothing documents that asymmetry as intentional.
2. **Epistemic honesty about the governor's own record.** This is a correctness claim about the artifact rather than about outcomes, and it is the claim the spike was opened to settle. An unfounded comparison that happens to be biased safe is still unfounded.
3. **FAFF-1052's acceptance, as a supporting consideration whose reading is arguable.** Its bullet reads *"A backend swap between rounds is detected, or the inability to detect it is surfaced, rather than the convergence window silently spanning two reviewers"*. Read as a disjunction whose "rather than" clause glosses both limbs, the second limb is satisfied today: prep surfaces both marker anomalies **loud, never silent** on the exit-0 branch, so the window spans but not silently. This spec does **not** claim option 1 breaches that criterion.

**On FAFF-1052's own position.** It is worth stating plainly, because it cuts against an easy over-reading. FAFF-1052 placed "treat an unpinnable loop as 'window starts here' each round" in its **Proposed direction**, under the heading *"Not settled, for prep to shape"* — not in its Acceptance. It then shipped Done with `capRound = 1` at `spec-review-window.js:245`, a line it wrote. So FAFF-1052 did not decide this; it deferred it, and FAFF-1324 is that deferred question arriving for decision. That is the ticket's warrant. Any argument that the shipped ticket failed its own acceptance is both unnecessary and unsupported by its text.

**Why not option 2, and a correction to the brief.** The brief argued exit 2 breaches FAFF-1052's *"the no-lens-served skip path stays a legitimate no-op and is not turned into a failure"* on the grounds that a no-lens round can legitimately produce this state. Verified against the tree: it no longer can. `captureNoLensServed` (`spec-review-pin.js:264-268`) preserves a `{state:"captured"}` marker and folds the no-lens fact in beside it, which is precisely what FAFF-1323 landed, and it writes a fresh `skipped-no-lens` marker only when no captured marker exists, in which case there is no pin either, so the round takes the `pin === null` arm and never reaches the ternary. So the breach is not literal today, and the rejection of option 2 does not rest on it. Option 2 is rejected on two stronger grounds. First, it buys nothing: prep's non-zero-exit disposition is *already* `window_start := n` (`SKILL.md:127`), so exit 2 reaches the same window as option 4 while adding a fault label. Second, it would reinstate the only structural guard keeping that breach non-literal: one future writer of a non-captured marker alongside a surviving pin, and a legitimate no-op becomes a failure again. FAFF-1052's acceptance is a hard constraint, and option 2 is the option that puts it one commit from being violated.

**Why not option 3.** It is the largest change for the least behaviour. `detectSpecReviewConvergence` (`spec-review-convergence.js:77`) is pure and window-blind by construction; the CLI wrapper owns the directory read and the `--window-start` bound, so the comparator cannot be told its window is suspect without either a new CLI argument (breaking the prose lint at `test/spec-review-window.test.mjs:268`) or a new `GovernanceResult` field routed through prep prose (breaking the key-set assertion at `:422` and growing prep past its 621/622 line headroom). It also conflates further rather than less: the comparator's existing insufficient-input arm already expresses "can't tell" as `converging: false` plus prose. And the nearest existing idiom argues the other way: a contradiction *already* ships `capture_state: "failed"`, an evidence channel no consumer reads. Adding a second unread channel is not a fix. Option 3 is also the only option that cannot be localised, so the ticket's scope guard excludes it.

**Why option 4 is the one consistent with the shipped design.** Two branches twelve lines apart resolve the same predicament, "the loop cannot prove which round established the pin", in opposite directions. `:207-217` narrows to `n` and calls it a fail-safe it *MUST* take; `:242-245` leaves the window wide. Prep takes `window_start := n` at both of its adjacent seams (`SKILL.md:127` and `:128`). Four of the six anomaly arms narrow to `n`. Option 4 moves the established disposition into the one branch that lacks it, mints no vocabulary, changes no exit code, needs no prep change, and leaves the clean and no-lens paths untouched.

**Does the decision cover `pin-marker-missing`?** **Yes, both arms, identically.** They are one ternary, one severity, one fallback, and `readCaptureOutcome`'s own comment (`spec-review-pin.js:112-116`) states that no case distinguishes absent from torn. On the evidence the `-missing` arm is the more live of the two: a legacy pin, a torn marker, and a crash between `capturePin`'s two atomic writes all reach it, and the committed selftest already constructs the legacy-pin case.

**Chosen:** apply to both arms with no behavioural distinction.

**Is this localised enough for the spike's guard?** Three lines of `govern()`, five test edits, two selftest edits. No new field, no new token, no prep prose, no CLI surface, no convergence change.

**Chosen:** yes, it lands in this ticket; no separate implementation ticket is needed. (`spec-review-window.js` is plain JavaScript with no TypeScript sibling, so there is no emit to rebuild.)

**Chosen:** defer the marker self-heal. The latch is an accepted consequence here, recorded in Failure modes with its extension point, because repairing the marker is a write-path change in `spec-review-pin.js` and the ticket's guard confines this spike to the governor's disposition.

## 7. Open Questions and Assumptions

**Open questions.** None. Every decision above carries a `**Chosen:**`.

**Assumptions.**

**Assumes:** `faff-prep/SKILL.md` remains the sole consumer of `--govern` and still branches only on `result.window_start` on exit 0. *Validate:* `grep -rn "spec-review-window --govern" plugin/ test/` returns only `faff-prep/SKILL.md:126-128`, the module itself, its selftest, and `test/spec-review-occupant-served-dispatch.test.mjs`.

**Assumes:** `validate-adapters.js`'s `SKILL_LINE_BASELINE` still pins `faff-prep: 622` against a 621-line file. *Validate:* `wc -l plugin/skills/faff-prep/SKILL.md` reads 621. No prep edit is expected, so no baseline bump should be needed; if the build finds itself bumping the baseline, the change has exceeded this spec's scope and should stop.

## 8. DONE — Definition of Done

### From WHY
- [ ] A governed round with an unvouchable marker and `window_start < n` persists `window_start: n`, so the convergence window no longer spans rounds whose shared reviewer is unproven.
- [ ] The commit message records the decision and rests it on the fail-safe idiom and on `window_start`'s published meaning, states the trade in the direction Failure modes establishes (a wide window is biased toward over-parking, so this change buys a vouchable comparison rather than a safer outcome), and notes that FAFF-1052 deferred this question rather than deciding it. It must **not** claim the status quo yielded false convergence, and must **not** claim it breached FAFF-1052's acceptance.

### From WHAT (types and interfaces)
- [ ] `GovernanceResult` carries exactly `round`, `window_start`, `action`, `anomaly`, `served_identity`, `capture_state`, `capture_round`, `ts`; `test/spec-review-window.test.mjs:418-432` passes with its key list unmodified.
- [ ] No `AnomalyToken` or `ActionToken` value is added, renamed, or removed; `grep -c '"unpinnable-reset"' plugin/skills/faff/bin/lib/spec-review-window.js` shows the token reused, not replaced.

### From HOW (behaviour)
- [ ] `spec-review-window.js:245` — the `else` arm — sets `capRound = n`; the literal `capRound = 1` no longer appears in `govern()`. Do **not** edit `:244`: that is the clean `cap.state === "captured"` arm, and setting `capRound = n` there would break late-pin-advance and fail `test/spec-review-window.test.mjs:308`.
- [ ] The late-pin rule reports `unpinnable-reset` when it fires with a non-null anomaly and `late-pin-advance` when it fires with `anomaly == null`.
- [ ] `test/spec-review-window.test.mjs:347` (`govern: soft pin-marker-missing ... full GovernanceResult asserted`) is updated: `action` changes from `"unchanged"` to `"unpinnable-reset"`, and a new `assert.equal(result.window_start, 3)` is added. `code: 0`, `anomaly: "pin-marker-missing"`, `capture_state: "absent"`, `capture_round: null` are all asserted unchanged.
- [ ] `test/spec-review-window.test.mjs:362` (the `pin-marker-contradiction` twin) gains `assert.equal(result.action, "unpinnable-reset")` and `assert.equal(result.window_start, 3)`. Its existing `code: 0`, `anomaly`, and `capture_state: "failed"` assertions pass unmodified; this test asserts no `action` or `window_start` today, so it does not fail before the edit. The assertions are added so the new behaviour is pinned rather than merely tolerated.
- [ ] The selftest twin at `spec-review-window.js:556` (`govern pin-marker-missing (soft, non-fatal)`) asserts `r.result.action === "unpinnable-reset"` and `r.result.window_start === 3` in place of `action === "unchanged"`, keeping `r.code === 0` and the anomaly check.
- [ ] The selftest twin at `spec-review-window.js:560` (`govern pin-marker-contradiction (soft, non-fatal)`) is extended from code-and-anomaly only to also assert `action === "unpinnable-reset"` and `window_start === 3`, closing the asymmetry with its sibling.
- [ ] `faff spec-review-window --selftest` reports PASS and exits 0, so `test/spec-review-window.test.mjs:250,256` pass.

### From HOW (edge cases)
- [ ] A governed round with an unvouchable marker and `window_start` already equal to `n` reports `action: "unchanged"`, `window_start: n`, anomaly recorded; covered by a new test case.
- [ ] Round 1 with an unvouchable marker is unchanged from today: `window_start: 1`, `action: "unchanged"`; covered by a new test case.
- [ ] An unvouchable marker plus a served identity differing from the pin still reports `action: "swap-reset"` with the anomaly attached; covered by a new test case.
- [ ] `test/spec-review-window.test.mjs:308` (the healthy `late-pin-advance` path) and the `unchanged` and `swap-reset` tests pass unmodified, proving the clean branch is untouched.
- [ ] `test/spec-review-occupant-served-dispatch.test.mjs:76-80` passes unmodified, asserting exit 0 and `action: "swap-reset"` through the real `faff` binary.
- [ ] `test/spec-review-atomic-write.test.mjs:69,88` and `test/spec-review-pin.test.mjs:262,290` pass unmodified.
- [ ] `test/spec-review-window.test.mjs:268` (the prep prose lint) passes unmodified; `git diff --stat` shows no change to `plugin/skills/faff-prep/SKILL.md` and no change to `SKILL_LINE_BASELINE`.

### From OUT OF SCOPE
- [ ] No change to `spec-review-pin.js`, `spec-review-convergence.js`, `judge-trail.js`, or any `SKILL.md`. `git diff --name-only` lists only `spec-review-window.js` and `test/spec-review-window.test.mjs`.
- [ ] The marker self-heal and the unguarded `--backends-json` failure write are filed as separate issues, each citing its extension point from OUT OF SCOPE.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. mkdir a scratch dir; write pinned-reviewer.json = BACKENDS[0]
  2. write pin-capture.json = { state: "failed", round: 1 }
  3. write served-3.json = { round: 3, served_identity: identity(BACKENDS[0]) }
  4. write window.json = { window_start: 1 }
  5. faff spec-review-window --govern --dir <scratch> --round 3 --any-served
  6. ASSERT exit 0
     AND stdout JSON.window_start == 3 AND .action == "unpinnable-reset"
                AND .anomaly == "pin-marker-contradiction"
     AND governance-3.json exists and matches stdout
     AND window.json now reads { "window_start": 3 }
```

confidence: high
