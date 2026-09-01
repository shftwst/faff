# FAFF-724 — Confirm codex cache_write/reasoning token relationships on a live cold-cache call

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: medium. Full spec on Linear FAFF-724.
>
> Revised by human decision on 2026-08-19: the paid live non-zero capture requirement below is superseded. Official OpenAI Responses usage semantics plus the version-pinned Codex mapping are the acceptance evidence; the original text remains as the historical proposal. Reconfirmed on 2026-08-27 with the instruction to preserve the implementation and rerun review and CI.

confidence: medium
spec-review: approve

This spec is for the build agent (and any human reviewer holding a codex seat). It settles an **empirical** question FAFF-666 left open: whether codex-cli's `cache_write_input_tokens` and `reasoning_output_tokens` are additive to, or subsets of, `input_tokens` / `output_tokens`. The deliverable is an observation plus a written verdict — not a design. **The build cannot be completed without a live, reasoning-capable codex seat driven into a cold-cache posture** (see Assumptions); an autonomous lane with no such seat must stop at that assumption, never fabricate a payload.

## 1. WHY — Problem and Principles

**The load-bearing model.** `sumCodexUsage` buckets a codex `turn.completed.usage` object into four token classes. Two of the five reported fields — `cache_write_input_tokens` and `reasoning_output_tokens` — are currently treated as **subsets** (the write class is subtracted out of `input`, reasoning is assumed already inside `output_tokens`). "Subset vs additive" is not a code choice we can reason our way to; it is a fact about how the codex binary reports, observable only on a call where the field is **non-zero**.

**Problem statement.** FAFF-666 (PR #554) shipped the structural fix so `cache_write` is no longer permanently zero for codex, but it could not self-certify the field's arithmetic relationship because the only two live captures (FAFF-665) were warm-cache reads showing `cache_write_input_tokens: 0`. Until a non-zero cold-cache payload is observed, the subset assumption is undercount-safe-but-unproven. This ticket captures that payload and records the verdict.

**Design principles.**

- **Never fabricate the payload.** The entire value of this ticket is that the number came off a real binary. A hand-written or guessed `turn.completed.usage` fixture is worse than no fixture — it launders a guess as evidence. If no live cold-cache seat is available, the correct outcome is to stop and surface the block, not to synthesise data.
- **Undercount-safe is the current default; only a contradicting observation flips it.** The subset handling already in `sumCodexUsage` is the safe posture. Change code **only** if the live observation proves a field disjoint — otherwise the code change is a no-op and DONE is satisfied by the recorded verdict alone.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/engine-codex.js` (`sumCodexUsage`, ~L124-137) | JavaScript | The consumer under test; the two one-line flips are pre-identified in its comment block (L97-118). |
| `test/engine-call.test.mjs` (FAFF-666 section, ~L571-585) | JS (node:test) | Where the committed payload becomes a fixture-backed unit assertion. |
| `docs/architecture/codex-cli-observed.md` | Markdown | Does **not** yet exist; this ticket creates it as the written home of the verdict. |
| FAFF-665 captures | — | The two warm-cache (`cache_write_input_tokens: 0`) captures that motivated the follow-up. |

**Scope statement.** A one-shot empirical confirmation feeding a possible one-line code adjustment plus a documentation record; it sits at the codex-usage accounting seam, downstream of FAFF-666's structural fix.

## Already shipped against this surface

- **FAFF-666** (PR #554, Done) — shipped the *structural* fix in `sumCodexUsage`: reads `cache_write_input_tokens` → `cache_write` (as a subset of `input_tokens`) and `reasoning_output_tokens` → `output` (subset). Unit-tested against a committed warm-cache payload. This ticket's delta is the **empirical** confirmation it explicitly could not self-certify — the premise still holds (no cold-cache non-zero payload exists yet).
- **FAFF-665** (Done) — captured two *live* codex payloads, both warm-cache (`cache_write_input_tokens: 0`), which is exactly why a cold-cache capture is still outstanding.

## 2. OUT OF SCOPE

- **Reworking the four-class bucketing model.** — Why excluded: FAFF-666 settled the structure; this only confirms two arithmetic relationships. — Extension point: `sumCodexUsage` in `engine-codex.js`.
- **The Anthropic-side token classes.** — Why excluded: this ticket is codex-specific; Anthropic parity is already the stated rationale, not under test. — Extension point: `TOKEN_CLASS_FROM_USAGE` in `budget.js`.
- **A general codex-cli observation harness.** — Why excluded: one payload settles this; a reusable capture tool is a separate concern. — Extension point: a future ticket over `engine-codex.js` selftest.
- **Warm-cache behaviour.** — Why excluded: already characterised by FAFF-665. — Extension point: the same observed-doc.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Cold-cache call | A codex turn whose prompt is not already cached server-side, so the provider **writes** cache and reports `cache_write_input_tokens > 0`. |
| Cache-writing posture | The prompt/seat conditions that force a cache write: a long, reasoning-capable prompt on a fresh cache key (first call of a novel long context). |
| Subset relationship | `cache_write_input_tokens` (or `reasoning_output_tokens`) is already counted **inside** `input_tokens` (`output_tokens`); it must be subtracted / not re-added to avoid double-counting. |
| Additive relationship | The field is **disjoint** from its parent; it must be added to the class total or it is silently dropped. |

**The observed payload (shape to capture verbatim).**

```
RECORD TurnCompletedUsage:            # codex-cli turn.completed.usage, v0.145.0
  input_tokens: int
  cached_input_tokens: int            # proven SUBSET of input_tokens (FAFF-604)
  cache_write_input_tokens: int       # relationship UNDER TEST — must be > 0 in the capture
  output_tokens: int
  reasoning_output_tokens: int         # relationship UNDER TEST
  CONSTRAINT cache_write_input_tokens > 0   # the capture is invalid for this ticket without it
```

**Design decisions.**

- Handling of `cache_write_input_tokens` after the observation. **Chosen:** keep the current subset handling (`input -= cache_write`) if the observation is consistent with subset; flip to additive (drop the `- cacheWrite` term) **only** if the live payload proves it disjoint. The observation decides; the spec does not pre-judge it.
- Handling of `reasoning_output_tokens` after the observation. **Chosen:** keep folded-into-`output` (subset) unless the observation proves it disjoint, in which case add `+ n(u.reasoning_output_tokens)` to the output line. Same evidence-gated posture.
- What "proves" the relationship. **Punt:** the exact arithmetic test that distinguishes subset from additive from a single payload — e.g. whether an independent ground-truth total (billing dashboard, a second field) is needed to disambiguate, or whether the field-naming convention + one non-zero call is deemed sufficient. **(decides: qa)** Needs the human running the seat to judge what the captured numbers actually license.

## 4. HOW — Behavior

**Approach.** Acquire a reasoning-capable codex seat, drive one cold-cache call, capture the raw `turn.completed.usage`, commit it as a fixture, read the arithmetic, write the verdict, and flip code only if contradicted.

```
PROCEDURE settle_relationships():
  1. Acquire a live reasoning-capable codex seat/binary (see Assumptions — HARD external dependency).
  2. Construct a cache-writing posture: a long, novel prompt on a fresh cache key, reasoning enabled.
  3. Run one codex call; capture the raw turn.completed.usage object from the event stream
     (the parse path already keeps usage fields — parseCodexEvents in engine-codex.js).
  4. ASSERT captured.cache_write_input_tokens > 0. IF not > 0:
     a. The call was warm/ineligible — retry with a fresh cache key / longer prompt.
     b. IF a non-zero write cannot be produced, STOP: record the attempt, do NOT commit a zero payload,
        surface as blocked-on-external-resource. (This is a valid, honest terminal outcome.)
  5. Commit the raw payload as a fixture under the test tree (alongside the FAFF-666 section).
  6. Read the arithmetic:
     a. Compare cache_write_input_tokens against input_tokens (and any independent total) -> subset | additive.
     b. Compare reasoning_output_tokens against output_tokens -> subset | additive.
  7. Record the verdict + the observation that settled it in docs/architecture/codex-cli-observed.md.
  8. IF observation contradicts the subset assumption for a field:
     a. cache_write additive  -> drop `- cacheWrite` from the input line in sumCodexUsage.
     b. reasoning additive     -> add `+ n(u.reasoning_output_tokens)` to the output line.
     c. Update the L97-118 comment to state the now-proven relationship.
     ELSE: no code change — the subset handling stands; note "confirmed subset" in the comment.
  9. Add/extend a unit test in test/engine-call.test.mjs asserting sumCodexUsage buckets the
     committed fixture per the settled verdict.
```

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** no cold-cache posture is achievable on the available seat — every call reads warm, `cache_write_input_tokens` stays 0. **How you'd know:** step 4's assertion never passes across retries. **What it means:** abandon-for-now / surface as blocked-on-external-resource; a zero payload does not settle the question and must not be committed as if it did.
- **The failure:** a single non-zero payload is arithmetically ambiguous — the numbers are consistent with *both* subset and additive. **How you'd know:** step 6 can't distinguish without an independent ground-truth total. **What it means:** narrow — capture a second call or an external total (the qa Punt above), or record the verdict as "unresolved, subset retained as undercount-safe default" with the evidence, rather than overclaiming.
- **The failure:** the observed codex-cli version differs from 0.145.0 and reports a changed shape. **How you'd know:** the captured object is missing a named field or carries a new one. **What it means:** record the version explicitly in the observed-doc; the verdict is version-stamped, not universal.

**Anti-pattern:** Committing a hand-authored `turn.completed.usage` with a non-zero `cache_write_input_tokens` to "unblock" the ticket. Why: it fabricates the exact evidence the ticket exists to gather, and every downstream reader would trust it as a live observation.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a live reasoning-capable codex seat in a cache-writing posture
When one cold-cache call is captured
Then the committed fixture's turn.completed.usage has cache_write_input_tokens > 0
```

```
Given the committed non-zero cold-cache fixture
When sumCodexUsage runs over it
Then its four-class totals match the settled subset-vs-additive verdict for both fields
```

- The subset-vs-additive verdict for both `cache_write_input_tokens` and `reasoning_output_tokens` is stated in writing in `docs/architecture/codex-cli-observed.md`, each with the observation that settled it and the codex-cli version.

## 6. DESIGN DECISION RATIONALE

**Do we change code now, or only on a contradicting observation?** Options: (a) pre-emptively flip to additive; (b) keep subset, flip only if disproven. Subset is the undercount-safe default (subtracting a truly-disjoint field only undercounts `input`; not-subtracting a truly-nested field double-counts). **Chosen:** (b) — evidence-gated flip, matching the existing comment's stated plan; a no-op code change is the expected and acceptable result.

**Do we build this autonomously or gate on a human seat?** The DoD's first criterion is a live non-zero cold-cache capture, which no fabricated data can satisfy and no guaranteed codex seat exists for in the autonomous lane. **Chosen:** treat the live codex seat as an external assumption the build agent validates **before** starting; absent it, stop and surface rather than proceed. This is why the spec self-rates `medium` (needs-decision-first), not `high`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt (decides: qa):** the exact arithmetic test that distinguishes subset from additive from the captured payload — whether a single non-zero call suffices, or an independent ground-truth total is required. The human running the seat judges this against the real numbers.

**Assumptions.**

- **Assumes:** a live, reasoning-capable codex binary/seat is available and can be driven into a cold-cache (cache-writing) posture at build time. **Validation:** before any other step, confirm the seat exists and that a trial call reports `cache_write_input_tokens > 0`; if it cannot, do not proceed — surface as blocked-on-external-resource. **This assumption does not hold in an unattended autonomous environment with no codex seat; a fire-and-forget run must stop here.**
- **Assumes:** the codex event-parse path preserves the raw `turn.completed.usage` fields (it does today — `parseCodexEvents` keeps usage fields, per the FAFF-604 seam). **Validation:** confirm the captured object carries all five named fields.
- **Assumes:** codex-cli version is recorded with the capture (observed baseline was 0.145.0). **Validation:** capture `codex --version` alongside the payload.

## 8. DONE — Definition of Done

### From WHY
- [ ] A real cold-cache codex `turn.completed.usage` payload with `cache_write_input_tokens > 0` is captured and committed as a fixture (never fabricated).

### From WHAT / DESIGN DECISIONS
- [ ] The subset-vs-additive verdict for `cache_write_input_tokens` is recorded in writing with the settling observation.
- [ ] The subset-vs-additive verdict for `reasoning_output_tokens` is recorded in writing with the settling observation.
- [ ] The verdict record lives in `docs/architecture/codex-cli-observed.md` and names the codex-cli version.

### From HOW (behaviour)
- [ ] `sumCodexUsage` handling matches the settled verdict — a no-op if subset holds; the pre-identified one-line flip(s) applied if a field proves additive, with the L97-118 comment updated to state the now-proven relationship.
- [ ] A unit test in `test/engine-call.test.mjs` asserts `sumCodexUsage` buckets the committed fixture per the settled verdict.

### From HOW (edge cases)
- [ ] If a non-zero cold-cache payload cannot be produced, the attempt is recorded and the ticket surfaced as blocked-on-external-resource — no zero or fabricated payload is committed.

**Integration smoke test:**

```
Load the committed fixture -> sumCodexUsage(fixture.events) -> assert the four-class totals
equal the values the recorded verdict predicts (input/output/cache_write/cache_read).
```

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes — a single 1–3 day empirical unit (one capture + one doc record + a conditional one-line code flip). Human-sliced off FAFF-666 during the 2026-08-04 unblock. No split or merge indicated.
- **Workstream fit?** Cohesive with the codex-usage accounting workstream; it closes the one empirical loose end FAFF-666 left open. Outcome-named.
- **Deps surfaced?** The load-bearing dependency is an **external resource** (a live reasoning-capable codex seat in cold-cache posture), not a tracker-linkable blocker — it is surfaced as a validated `**Assumes:**` with a stop-and-surface instruction. Related-to links to FAFF-665/666 are present.
- **Risk profile?** External-dependency + empirical-unknown risk (principle 7): the verdict is genuinely unknowable until observed, and the seat is not guaranteed in the autonomous lane. This ticket *is* the de-risking probe, so no separate spike is warranted — but it must not run fire-and-forget. Reflected in the `medium` rating / `needs-decision-first` routing.

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
