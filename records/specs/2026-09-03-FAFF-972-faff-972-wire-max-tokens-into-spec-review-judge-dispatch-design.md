# Spec: wire max_tokens into the spec-review judge dispatch

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-972.

Buildable spec for FAFF-972: wire max_tokens into the spec-review judge dispatch.

Audience: the build agent that will edit `plugin/skills/faff-prep/SKILL.md`, and the human reviewer gating this spec. This spec covers the wiring only; the wire-vs-reject fork is already settled as wire it.

## 1. WHY — problem and principles

The load-bearing model: the spec-review judge is prompt-prescribed bash inside a SKILL.md, and it dispatches two `review-call.mjs` calls per proposition. `review-call.mjs` caps output tokens from a `--max-tokens N` flag, and when that flag is absent it silently falls back to `DEFAULT_NUM_PREDICT = 2000` (review-call.mjs line 47). So the judge's output budget is decided entirely by whether the SKILL.md dispatch passes `--max-tokens`. Today it does not.

Problem statement: the config key `adversarial.spec_judge.max_tokens` is inert because the judge dispatch in `plugin/skills/faff-prep/SKILL.md` (the _Spec-review judge_ section, step 2, Call 1 and Call 2) resolves only the judge clock and `--expect contract`, and never resolves or threads a per-consumer output cap. Both judge calls therefore run at the 2000-token default regardless of config. This change resolves the cap once in the dispatch and passes `--max-tokens` on both judge calls, so the config key becomes effective.

Design principles:

**Mirror the two sibling consumers exactly, do not invent a new resolution shape.** `code_review` (faffter-dark-adversarial-review/SKILL.md lines 187-189) and `spec_review` (faffter-dark-spec-review/SKILL.md lines 74-76) already resolve `max_tokens` as a three-tier silent fallback. The judge must use the same three tiers in the same order with the same coercion, so all three adversarial consumers read as one pattern. An implementation that resolves the cap differently would be rejected even if it produced the same number.

**Fail-safe silent resolution, never fail-loud.** Absent config falls back; malformed or non-positive config coerces to 2000. The judge dispatch never errors on a bad cap value. This matches the siblings and is the human-decided behaviour.

Reference context:

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-prep/SKILL.md` (Spec-review judge, lines 194-201) | Prompt bash inside markdown | The dispatch this change edits |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (lines 187-189) | Prompt bash | `code_review` three-tier resolution, the pattern (uses a `$consumer` guard) |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` (lines 74-76) | Prompt bash | `spec_review` three-tier resolution, the closest mirror (fixed consumer, no guard) |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (lines 47, 1200) | Node | Accepts `--max-tokens N`, maps to `numPredict` then `buildOpenAiPayload` `maxTokens`; default 2000 |

Scope statement: this sits at the judge-dispatch step of faff-prep's L3–L4 spec-review loop, one prompt-bash resolution added alongside the existing judge-clock resolution.

## 2. OUT OF SCOPE

- **The two review consumers (`code_review`, `spec_review`).** Why excluded: they already resolve a per-consumer cap and pass `--max-tokens`; they are the pattern being mirrored. Extension point: none needed, leave both SKILL.md blocks untouched.
- **`review-call.mjs`.** Why excluded: it already accepts `--max-tokens N` and maps it to `maxTokens`. Extension point: none, no code change.
- **The `.faffrc.yaml` config value.** Why excluded: config content is a separate concern from consuming it; the wiring must be correct whether or not any value is present. Extension point: an operator sets `adversarial.spec_judge.max_tokens` in `.faffrc.yaml` under the existing `spec_judge:` block. See the Assumptions section for the honest state of this key today.
- **Any new lint or JS test asserting the dispatch passes `--max-tokens`.** Why excluded: the dispatch is prompt prose, not a JS function, and no such seam exists today; inventing one is out of scope for this ticket. Extension point: a future doc-lint rule in `test/` could grep the judge-dispatch section, if that becomes wanted.

## 3. WHAT — the resolution and the two calls

Vocabulary:

| Term | Definition |
|---|---|
| Three-tier fallback | Per-consumer key, then global key with a 2000 default, then a positive-integer coercion back to 2000 |
| The judge dispatch | The per-proposition loop in faff-prep/SKILL.md step 2, which runs Call 1 (Phase 1 reconstruction) and Call 2 (Phase 2 adjudication) |
| Fixed consumer | The consumer name here is the literal string `spec_judge`, never a variable, so no `[ -n "$consumer" ]` guard is needed |

The resolution to add (resolve once, before Call 1 in the per-proposition dispatch):

```
# Output-token cap (max_tokens): per-consumer override, else global, else the 2000 default.
# spec_judge is a fixed consumer name, so no [ -n "$consumer" ] guard (unlike code_review).
# The -gt 0 guard resets a present-but-non-positive value (empty/non-numeric/float/0/negative) to 2000.
max_tokens=$("$faff" config get adversarial.spec_judge.max_tokens)
[ -z "$max_tokens" ] && max_tokens=$("$faff" config get adversarial.max_tokens -d 2000)
[ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000
```

The flag to thread: `--max-tokens "$max_tokens"` on both `review-call.mjs` invocations, Call 1 and Call 2.

**Chosen:** the three-tier silent fallback above, mirroring `spec_review` (fixed consumer, no guard). Rationale in the Design decision rationale section.

**Anti-pattern:** copying `code_review`'s `if [ -n "$consumer" ]; then max_tokens=$("$faff" config get "adversarial.$consumer.max_tokens"); fi` form. Why: the judge consumer is the fixed literal `spec_judge`, so the guard and the variable interpolation are wrong here; use the `spec_review` form with the literal key.

**Anti-pattern:** re-resolving `max_tokens` a second time inside Call 2, or threading a different value onto the two calls. Why: the cap is resolved once and both calls carry the same `$max_tokens`, matching how the siblings pass one resolved value.

## 4. HOW — where the edit lands

Behaviour summary: add the three-tier resolution once at the top of the per-proposition dispatch (the same place the judge already resolves its clock and picks its backend), then carry `--max-tokens "$max_tokens"` onto both judge calls.

```
PROCEDURE wire_judge_max_tokens(faff-prep SKILL.md, Spec-review judge section, step 2):
  1. Locate the per-proposition dispatch preamble in step 2, where the judge
     clock (--timeout/--deadline from adversarial.spec_judge.* || adversarial.*)
     and the spec_judge backend are already resolved.
  2. Add the three-tier max_tokens resolution (WHAT section) at that point,
     resolved ONCE per dispatch, using the fixed literal key
     adversarial.spec_judge.max_tokens and NO consumer guard.
  3. In Call 1 (Phase 1, blind reconstruction), add --max-tokens "$max_tokens"
     to the review-call.mjs flag list, alongside the existing --expect contract
     and the judge clock.
  4. In Call 2 (Phase 2, adjudication), add --max-tokens "$max_tokens" to the
     review-call.mjs flag list. Call 2's prose is terser than Call 1's, so make
     the flag's presence on Call 2 explicit, not implied.
  5. Leave every other flag, the reasoning knob, the backend selection, the
     reconstruction validation, and the retry disposition unchanged.
```

Edge cases and precedence, already handled by the three-tier fallback:

- Key absent at both tiers: `adversarial.spec_judge.max_tokens` empty, then `adversarial.max_tokens` empty so `-d 2000` supplies 2000. Result: 2000, identical to today's implicit default.
- Key present and positive integer (for example 12000): tier one returns it, the `-gt 0` guard passes, result is that value.
- Key present but malformed (empty string, non-numeric, float, 0, or negative): the `-gt 0` test fails or errors under `2>/dev/null`, so the coercion resets to 2000. No NaN, null, or `max_tokens: 0` reaches the wire.

Failure modes:

- **The failure:** the flag is added to Call 1 only, leaving Call 2 at the 2000 default. Call 2 is where the adjudication verdict block is emitted, so a silently-capped Call 2 would truncate a long ruling. How you'd know: grep the judge-dispatch section and count `--max-tokens` occurrences; fewer than two means one call was missed. What it means: narrow, fix Call 2, do not ship with one call wired.
- **The failure:** the `code_review` guarded form is copied, so the literal key becomes `adversarial..max_tokens` or the guard suppresses the read. How you'd know: `faff config get adversarial.spec_judge.max_tokens` resolves today, but the dispatch would query a different, malformed key; a grep for `[ -n "$consumer" ]` inside the judge section would find the wrongly-copied guard. What it means: narrow, use the `spec_review` fixed-consumer form.

## 5. Scenarios

```
Given the judge dispatch has been edited per this spec
When the Spec-review judge section of faff-prep/SKILL.md is read
Then it contains the three-tier max_tokens resolution using the literal key
     adversarial.spec_judge.max_tokens with no [ -n "$consumer" ] guard
And both Call 1 and Call 2 review-call.mjs invocations carry --max-tokens "$max_tokens"
```

```
Given adversarial.spec_judge.max_tokens is set to a positive integer in .faffrc.yaml
When the resolution runs
Then max_tokens takes that value and it is passed to both judge calls
```

```
Given neither adversarial.spec_judge.max_tokens nor adversarial.max_tokens is set (the working repo's state per Assumptions)
When the resolution runs
Then the `-d 2000` fallback supplies 2000 and both judge calls carry --max-tokens "2000"-equivalent
     (i.e. --max-tokens "$max_tokens" with $max_tokens=2000), byte-identical to today's implicit default
```

```
Given adversarial.spec_judge.max_tokens is unset but the global adversarial.max_tokens is set to a positive integer
When the resolution runs
Then the middle tier (`adversarial.max_tokens -d 2000`) supplies the global value and it is passed to both judge calls
```

```
Given adversarial.spec_judge.max_tokens is set to a malformed value (empty string, non-numeric like "abc", a float like 1.5, 0, or a negative)
When the resolution runs
Then the `[ "$max_tokens" -gt 0 ] 2>/dev/null` guard fails or errors and max_tokens is coerced to 2000
     so review-call.mjs never receives a non-positive, empty, or non-numeric --max-tokens value
```

- The three-tier resolution MUST coerce an empty, non-numeric, float, zero, or negative configured value back to 2000, so no non-positive cap reaches `review-call.mjs`.
- Both judge calls MUST pass the *resolved variable* `--max-tokens "$max_tokens"`, never a hardcoded literal such as `--max-tokens 2000` — a hardcoded literal leaves the config key inert (the exact failure in section 1) while superficially carrying the flag.

## 6. Design decision rationale

**Wire the config key, or reject it as inert?**

- Wire it: the two sibling adversarial consumers already resolve a per-consumer cap; the judge is the odd one out. Wiring makes the config surface consistent and lets an operator raise the judge's headroom for a long Phase-1 reconstruction. Cost: three lines of resolution plus one flag on each of two calls.
- Reject it: delete the key from anywhere it appears and treat 2000 as fixed. Cost: the judge stays uncapped-by-config while its two siblings are configurable, an inconsistent surface, and a long reconstruction stays truncated at 2000.

**Chosen:** wire it. The human settled this fork before the spec; the wiring mirrors two shipped consumers and is fail-safe. Rejecting would leave the three adversarial consumers inconsistent for no benefit.

**Which sibling form to mirror, `code_review` or `spec_review`?**

- `code_review`: uses `if [ -n "$consumer" ]; then ... "adversarial.$consumer.max_tokens" ...; fi` because its consumer name is a runtime variable.
- `spec_review`: uses the fixed literal key `adversarial.spec_review.max_tokens` with no guard because its consumer is known at authoring time.

**Chosen:** the `spec_review` form. Rationale: the judge's consumer is the fixed literal `spec_judge`, exactly the `spec_review` situation, so the guard and variable interpolation would be dead code here.

## 7. Open questions and assumptions

Open questions: none. The one real decision (wire vs reject) is settled as wire it.

Assumptions:

**Assumes:** `review-call.mjs` accepts `--max-tokens N` and maps it to the output cap. Validation: confirmed at review-call.mjs line 1200 (`--max-tokens` sets `a.numPredict`) feeding `buildOpenAiPayload`/`buildAnthropicPayload` `maxTokens`; the build agent should re-confirm the flag name has not changed before editing.

**Assumes:** the operator will set `adversarial.spec_judge.max_tokens` in `.faffrc.yaml` if a value above 2000 is wanted. Validation: run `grep -n -A6 "spec_judge:" .faffrc.yaml`. Honest state at spec time: contrary to the ticket's stated fact, the working `.faffrc.yaml` does not currently carry `adversarial.spec_judge.max_tokens` (it was removed since the ticket was filed), and there is no top-level `adversarial.max_tokens` either. So immediately after this wiring, the three-tier fallback resolves to 2000 (the same as today's implicit default) until an operator adds the key. The wiring is still correct and fail-safe, and the key becomes effective the moment it is set. This ticket's scope is the consumption, not the config value, so the build agent must not add or change the config value.

## 8. DONE — definition of done

### From WHY
- [ ] The judge output cap is no longer hardcoded to the 2000 default: the dispatch resolves `adversarial.spec_judge.max_tokens` and passes it on.

### From WHAT (resolution)
- [ ] The Spec-review judge section of `plugin/skills/faff-prep/SKILL.md` contains a three-tier resolution: `adversarial.spec_judge.max_tokens`, then `adversarial.max_tokens -d 2000`, then a `[ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000` coercion.
- [ ] The resolution uses the fixed literal key `adversarial.spec_judge.max_tokens` and contains no `[ -n "$consumer" ]` guard (greppable: the substring `[ -n "$consumer" ]` does not appear in the judge section).
- [ ] `max_tokens` is resolved once per dispatch, not re-resolved inside Call 2.

### From HOW (both calls carry the flag)
- [ ] The Call 1 (Phase 1, blind reconstruction) `review-call.mjs` invocation line carries `--max-tokens "$max_tokens"` (asserted on Call 1's own executable line, not a comment/prose line).
- [ ] The Call 2 (Phase 2, adjudication) `review-call.mjs` invocation line carries `--max-tokens "$max_tokens"` (asserted on Call 2's own executable line — a raw count >= 2 does NOT satisfy this; both flags on Call 1 MUST fail).
- [ ] Both occurrences use the interpolated variable `--max-tokens "$max_tokens"`; a bare/hardcoded `--max-tokens 2000` does NOT satisfy either.
- [ ] The flag-name contract is asserted, not assumed: `review-call.mjs` accepts `--max-tokens` and maps it to the output cap (greppable over `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`) — so a stale/wrong flag name fails loud rather than shipping an inert flag.
- [ ] The resolution executes before it is used: the `max_tokens=...` resolution line precedes both Call 1 and Call 2 invocation lines in the dispatch (resolve-then-use ordering).
- [ ] The edit preserves existing dispatch content: the reconstruction validation, the `--expect contract` flag, the phase-1/phase-2 system-prompt anchors, the backend selection, and the retry disposition all remain — the change adds the resolution and two flags and removes nothing.

### From OUT OF SCOPE (no collateral change)
- [ ] `plugin/skills/faffter-dark-adversarial-review/SKILL.md` `code_review` resolution is unchanged (git diff empty for that block).
- [ ] `plugin/skills/faffter-dark-spec-review/SKILL.md` `spec_review` resolution is unchanged.
- [ ] `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` is unchanged.
- [ ] `.faffrc.yaml` is unchanged by this ticket.

### Checkable seams (honest coverage statement)
- [ ] `faff validate-adapters` still passes (the SKILL.md authoring lint: line caps, dedup, markers; it does not assert flag presence).
- [ ] The CLI already resolves the key: `faff config get adversarial.spec_judge.max_tokens` returns whatever is configured (empty today), confirming the gap was the SKILL.md not consuming it, never the CLI.
- [ ] No JS unit test is added for "the judge passes --max-tokens": the dispatch is prompt bash inside a SKILL.md, not a JS function, so no such unit test can exist. `adversarial-config-lint.test.mjs` recognises `max_tokens` as a config key but does not assert the dispatch prose. Coverage for this change is therefore a grep-level assertion over the SKILL.md prose (the greppable DONE items below, hardened to grep the *interpolated variable* not a bare `--max-tokens`) plus `faff validate-adapters` passing and a diff-clean check on the four out-of-scope files.

**Oracle-strength note (what the greps do and do not close).** A count of bare `--max-tokens` occurrences can be satisfied by a hardcoded `--max-tokens 2000` on both calls, which leaves `adversarial.spec_judge.max_tokens` inert — the exact WHY-section failure. The smoke test below therefore (a) asserts the interpolated flag `--max-tokens "$max_tokens"` on each of the two **executable `review-call.mjs` invocation lines** (Call 1 and Call 2 individually, comment and prose lines excluded), so neither a hardcoded literal, a comment-placed string, nor two-flags-on-Call-1 can pass; (b) asserts the `-gt 0` coercion guard line and the single primary-key resolution; (c) asserts the **flag-name contract** — that `review-call.mjs` actually accepts `--max-tokens` and maps it to the output cap — turning the section-7 Assumption into a checked step; and (d) diff-checks the four out-of-scope files. Honest ceiling: the dispatch is prompt bash with **no JS runtime seam**, so no test can prove the flag changes a real model call — these greps are the strongest static oracle available and are explicitly scoped to executable lines to close the comment-placement and per-call-distribution escapes; residual runtime-behaviour verification is the reviewer reading the two edited Call lines, which the "one flag per Call line" assertions make a bounded, mechanical check.

Integration smoke test:

```
PROCEDURE smoke():
  # Steps 1–7 scope to the Spec-review judge section of faff-prep/SKILL.md.
  # "Call N invocation line" is defined concretely: within the Call 1 block (from the
  # "Call 1 (Phase 1" heading up to the "Call 2 (Phase 2" heading) there is a line containing
  # the substring `review-call.mjs`, and that line (or its backslash-continued argv, up to the
  # next non-continued line) contains `--max-tokens "$max_tokens"`; likewise for the Call 2 block
  # (from "Call 2 (Phase 2" to the end of step 2). Comment lines (leading #) are excluded.
  1. ASSERT the section contains the literal key: adversarial.spec_judge.max_tokens
  2. ASSERT the section contains: adversarial.max_tokens -d 2000
  3. ASSERT the section contains the coercion guard verbatim:
       [ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000
  4. ASSERT the Call 1 (Phase 1 reconstruction) review-call.mjs invocation LINE carries
       --max-tokens "$max_tokens"  (the interpolated variable; a hardcoded literal MUST fail)
  5. ASSERT the Call 2 (Phase 2 adjudication) review-call.mjs invocation LINE carries
       --max-tokens "$max_tokens"  (asserted on Call 2's own line — count>=2 alone MUST NOT satisfy this)
  6. ASSERT count of the primary-key resolution line
       `max_tokens=$("$faff" config get adversarial.spec_judge.max_tokens)` == 1  (resolved once)
  7. ASSERT the substring [ -n "$consumer" ] does NOT appear in the judge section
  8. ASSERT the flag-name contract holds: review-call.mjs accepts --max-tokens and maps it to the cap:
       grep -q -- '--max-tokens' plugin/skills/faffter-dark-adversarial-review/review-call.mjs
       AND grep -Eq 'max-tokens.*numPredict|numPredict.*max-tokens' plugin/skills/faffter-dark-adversarial-review/review-call.mjs
       (fails loud if the flag the dispatch passes is not the flag review-call.mjs reads)
  9. ASSERT execution order: the resolution line
       `max_tokens=$("$faff" config get adversarial.spec_judge.max_tokens)` appears at a LOWER line
       number than BOTH the Call 1 and Call 2 review-call.mjs invocation lines (the cap is resolved
       before it is used on either call — a resolution placed after a call MUST fail this step).
 10. ASSERT existing dispatch content is preserved, not replaced — all of these anchors still appear
       in the judge section after the edit (the change ADDS the resolution + two flags, it removes
       nothing): `adjudicate-phase1-reconstruct.md`, `adjudicate-phase2-rule.md`, `--expect contract`,
       and the reconstruction-validation prose ("each of the four named sections").
 11. ASSERT no collateral change — each diff-clean vs the merge base:
       git diff --quiet <base> -- plugin/skills/faffter-dark-adversarial-review/SKILL.md
       git diff --quiet <base> -- plugin/skills/faffter-dark-spec-review/SKILL.md
       git diff --quiet <base> -- plugin/skills/faffter-dark-adversarial-review/review-call.mjs
       git diff --quiet <base> -- .faffrc.yaml
 12. Run faff validate-adapters; ASSERT exit 0
```

confidence: high
spec-review: accept (judge, L3-provisional)
build-tier: complex
