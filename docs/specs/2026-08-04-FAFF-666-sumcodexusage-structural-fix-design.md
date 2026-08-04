# sumCodexUsage — read the two token fields codex reports but faff drops (structural half)

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive (human re-slice) · confidence: high · Full spec on the issue tracker (FAFF-666).

This spec addresses **the structural half of FAFF-666**, per the human's re-slice decision (2026-08-04). The prior full-scope spec parked three times: its Done bar demanded a non-zero `cache_write` on a live cold-cache codex call, which has no in-suite oracle, so a reviewer could never tell "build incomplete" from "field genuinely zero under this call". That live demonstration is now a **separate verification ticket**. What remains here is buildable and testable entirely in-suite: read the two dropped fields into the right token classes, with a conservative documented assumption on the one relationship that a live call would settle, and prove the read is wired against committed real payloads plus synthetic non-zero fixtures.

It is written for the build agent changing `sumCodexUsage`, and for the human reviewer checking codex spend is metered honestly.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff meters spend into four token classes — `input`, `output`, `cache_write`, `cache_read` — and every spend consumer (`budget`, `economics --by class`) compares two sources bucketed into those same four classes: the Anthropic transcript and the codex exec stream. A class means the same thing across both sources only if both decide the *same way* which raw provider field lands in it. This change makes the codex reader read every field codex reports and agree with the Anthropic reader on the mapping, instead of silently dropping two fields and leaving `cache_write` structurally dead for codex.

**Problem statement.** `sumCodexUsage` reads three of the five fields codex reports on `turn.completed.usage`. Its `cache_write` class is declared, returned, and never written — a permanent zero for every codex backend, which reads as "this backend writes no cache" rather than "faff does not look". The two unread fields (`cache_write_input_tokens`, `reasoning_output_tokens`) were `0` in both live captures to date (codex-cli 0.145.0, `docs/architecture/codex-cli-observed.md`), so the drop is latent rather than currently wrong. This change reads `cache_write_input_tokens` into `totals.cache_write` and acknowledges `reasoning_output_tokens` against the `output` class, or names in a comment why a field is deliberately not added.

**Design principles.**

- **Cross-source class parity governs the mapping.** The Anthropic reader (`sumTranscriptFileByModelClass`, `budget.js`) is the reference: it buckets four disjoint raw keys via `TOKEN_CLASS_FROM_USAGE` — `input_tokens → input`, `output_tokens → output`, `cache_creation_input_tokens → cache_write`, `cache_read_input_tokens → cache_read` — and has no separate reasoning key (Anthropic folds thinking into `output_tokens`). Whatever the codex reader does with the two new fields must leave each class meaning the same quantity it means on the Anthropic side. Note the raw shapes differ: Anthropic's cache-creation key is *disjoint* from `input_tokens`, whereas codex's `_input_tokens`-suffixed keys are *nested inside* `input_tokens` (proven for `cached_input_tokens`) — so matching the class *meaning* across sources requires the codex side to subtract its nested keys back out, not to copy Anthropic's disjoint arithmetic.
- **Undercount is the safe direction; double-count is not.** The existing reader already subtracts `cached_input_tokens` out of `input` because codex-rs proves it is a subset (its `non_cached_input()` helper). For a field whose subset-vs-disjoint relationship is *not* proven, prefer the handling that cannot double-count: on a codex stream that means **treating a new `_input_tokens` field as a subset and subtracting it out of `input`** — if it were in fact disjoint, subtracting merely undercounts `input` (the safe direction), whereas *not* subtracting a truly-nested field double-counts it (unsafe). Document the assumption with a pointer to the ticket that settles it on a live call.
- **Structural read, not environmental demonstration.** Two claims are in play and must not be conflated: (a) *the code reads each field into the right class* — provable in-suite by a unit test over a committed real payload of any magnitude plus a synthetic non-zero fixture; and (b) *a real cache-writing codex call produces a non-zero `cache_write`* — an environmental demonstration needing a live cold-cache seat. **(a) is this ticket. (b) is the split-off verification ticket.** This spec's Done bar asserts only (a).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/engine-codex.js` (`sumCodexUsage`, L95–108; comment block L77–94) | JS (Node, no deps) | The function this spec changes. |
| `plugin/skills/faff/bin/lib/budget.js` (`sumTranscriptFileByModelClass` + `TOKEN_CLASS_FROM_USAGE`) | JS | The Anthropic-side reader and its raw-key→class map. The parity reference. |
| `docs/architecture/codex-cli-observed.md` | Markdown | Records the two live captures (codex-cli 0.145.0); both new fields `0`. The committed real payloads the acceptance test reads. |
| `test/engine-call.test.mjs` (L438–521) | JS (node:test) | Existing `sumCodexUsage` coverage: the four-class total, the subset regression, the incoherent-clamp `weird` case. New tests extend this file. |

**Scope statement.** This sits at the codex half of the telemetry-adapter seam (FAFF-604), one function deep — it corrects what codex spend is read; it does not change how spend is stored, attributed, priced, or rendered.

## 2. OUT OF SCOPE

- **Demonstrating a non-zero `cache_write` on a live cold-cache codex call** — the environmental half. This is the split-off **verification ticket** (proposed title in §7). This spec's Done bar deliberately omits any "non-zero cache_write on a real call" criterion.
- **Settling subset-vs-disjoint for the two fields on a live call** — the same verification ticket. Here the relationship is handled by a conservative in-code assumption + pointer, not resolved. Both observed values are `0`, so the assumption has no numeric effect on any spend read today.
- **A fifth token class (a distinct `reasoning` class)** — neither source exposes reasoning as a class; adding one ripples through the price map, event schema, and every economics pivot. Extension point: `TOKEN_DELTA_CLASSES` in `budget.js`.
- **Changing the Anthropic reader's field coverage** — it already covers its four disjoint keys; this ticket only reads it as the parity reference.
- **The other FAFF-604 economics-accuracy tickets** (FAFF-640/641/642) — independent defects; co-land only if picked up together.
- **Re-verifying the three fields already read** — FAFF-665 confirmed `input`/`output`/`cache_read` against a live binary.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Subset field | A usage field already included inside a base field (as `cached_input_tokens` is inside `input_tokens`). Read it by subtracting out of the base, never adding on top. |
| Disjoint field | A usage field reported alongside the base fields, not inside them (as Anthropic's `cache_creation_input_tokens` is disjoint from `input_tokens`). Add it to its class directly, no base adjustment. |
| Conservative assumption | For a field whose subset-vs-disjoint relationship is unproven, the handling that cannot double-count under today's data, recorded as an in-code comment naming the assumption and pointing at the verification ticket that settles it live. On a codex stream, that is subset handling for an `_input_tokens` field. |
| Independent oracle | The expected four-class integers for a fixture payload, hand-derived by arithmetic from that payload's own raw fields — not produced by running `sumCodexUsage`. What makes the test non-circular. |

**The codex usage shape** (`turn.completed.usage`, codex-cli 0.145.0):

```
RECORD CodexUsage:
  input_tokens: int              # base input; INCLUDES cached_input_tokens (subset), proven by codex-rs non_cached_input()
  cached_input_tokens: int       # subset of input_tokens → cache_read class (already read)
  cache_write_input_tokens: int  # NEW → cache_write class. Relationship to input_tokens unproven; handled as a SUBSET (see §4)
  output_tokens: int             # base output
  reasoning_output_tokens: int   # NEW. Relationship to output_tokens unproven; handled as already-inside (see §4)
```

**The four-class totals** (`sumCodexUsage` return, unchanged shape):

```
RECORD Totals:
  input: int        # non-cached, non-cache-write input (cached AND cache_write subtracted out; see §4)
  output: int       # all output including reasoning (parity with the Anthropic output class)
  cache_write: int  # cache-creation tokens (was structurally always 0; now sourced from cache_write_input_tokens)
  cache_read: int   # cached input
```

**Design decisions** (rationale in §6):

- **Chosen:** read `cache_write_input_tokens` into `totals.cache_write`, so the codex `cache_write` class means the same cache-creation quantity as the Anthropic `cache_write` class (sourced there from `cache_creation_input_tokens`). This is the structural fix that kills the dead class.
- **Chosen:** handle `cache_write_input_tokens` as a **subset** of `input_tokens` — subtract it out of `input` alongside `cached_input_tokens`. Reason: it carries codex's `_input_tokens` suffix, and the one such field whose relationship is proven (`cached_input_tokens`) is nested inside `input_tokens`; subtracting is the codex-consistent, undercount-safe direction (if it were disjoint, subtracting only undercounts `input`; not subtracting a nested field double-counts). This also yields true class parity, since both sources' `input` class then means "input excluding cache-write." The relationship is unproven and the observed value is `0`, so this has no numeric effect today. Comment names the assumption + points at the verification ticket.
- **Chosen:** handle `reasoning_output_tokens` as **already inside** `output_tokens` — read/acknowledged but **not** added, so `totals.output` stays `output_tokens`. Reason: parity with the Anthropic transcript, where thinking is folded into `output_tokens` and there is no separate reasoning key; and OpenAI/codex report reasoning as part of the completion — "not added" is the codex-consistent, undercount-safe handling (if reasoning were disjoint, not-adding only undercounts output; adding a nested field double-counts). Comment names the assumption (subset ⇒ ignored) + points at the verification ticket.
- **Chosen:** no separate `reasoning` token class — it would break Anthropic parity and force price-map/schema changes.
- **Assumes (A1):** codex-cli's `cache_write_input_tokens` is a subset of `input_tokens`, and `reasoning_output_tokens` is already inside `output_tokens` — the conservative subset assumptions above. Both observed values are `0`, so neither assumption changes any current spend read; the verification ticket confirms them on a live non-zero call. If either is falsified there (the field is actually disjoint), the fix is a one-line change: stop subtracting `cache_write` from `input`, and/or add `reasoning` onto `output` (§6).

## 4. HOW — Behavior

**Approach.** Extend the existing per-`turn.completed` loop to read the two new fields into the class model under the conservative subset assumptions. The loop, the `n()` finite guard, and the floor-at-0 clamp are unchanged; this adds one class write (`cache_write`), widens the existing input subtraction by one term, acknowledges `reasoning` without adding it, plus the comment discipline. No live probe, no merge-gate, no runtime "unresolved" branch — the function always returns concrete totals.

**Step 1 — read the fields.** Replacing L102–105:

```
PROCEDURE sum_one_turn(u, totals):   # inside the existing loop
  1. cached      := n(u.cached_input_tokens)
  2. cache_write := n(u.cache_write_input_tokens)

  3. totals.cache_read  += cached
  4. totals.cache_write += cache_write                            # was structurally dead; now sourced

  5. totals.input  += max(0, n(u.input_tokens) - cached - cache_write)
                                                                  # both nested _input_tokens subsets subtracted out (A1);
                                                                  # the existing max(0, …) clamp still guards an incoherent stream
  6. totals.output += n(u.output_tokens)                          # reasoning_output_tokens NOT added:
                                                                  # handled as already inside output_tokens (A1)
```

`reasoning_output_tokens` is not referenced in the arithmetic — it is "read" in the sense of being named-and-dispositioned in the comment (Step 2), which satisfies the ticket's "either summed into a class or a comment naming why it is ignored." The value is deliberately not added.

**Step 2 — comment discipline.** Replace the L90–94 "codex reports no cache-write class, so it is always 0" comment (now false) with a block that, beside the reads, names the disposition of **every** field:
- `input_tokens` / `cached_input_tokens` / `output_tokens` — unchanged, proven three-field read (cite FAFF-665).
- `cache_write_input_tokens → cache_write`, handled as a **subset** of `input_tokens` (subtracted out alongside `cached`, the codex-consistent treatment for an `_input_tokens` field). State: relationship to `input_tokens` unproven, both live captures `0`, subset chosen as the undercount-safe default, settled on a live cold-cache call by **the verification ticket** (name it).
- `reasoning_output_tokens` — handled as **already inside** `output_tokens` (parity with the Anthropic transcript, which has no reasoning key and folds thinking into output; codex reports reasoning as part of the completion); therefore not added, and no separate reasoning class. Same unproven/zero/verification-ticket note.

**Step 3 — mirror-check the Anthropic counterpart.** Confirm in the comment (and by reading `budget.js`) that the two sources' classes agree after this change: codex `cache_write` ← `cache_write_input_tokens` ↔ Anthropic `cache_write` ← `cache_creation_input_tokens`; codex `input` = `input_tokens − cached − cache_write` ↔ Anthropic `input` = `input_tokens` (which already excludes both cache classes) — both mean "input excluding cache tokens"; codex `output` = `output_tokens` (reasoning folded) ↔ Anthropic `output` = `output_tokens` (thinking folded). No change to `budget.js` is required — the check is that the codex side now matches it. If a future reader finds the Anthropic `output_tokens` excludes thinking, that is the verification ticket's parity note, not a change here.

**Edge cases.**
- Absent / non-finite new fields contribute 0 via `n()` — old codex builds meter exactly as today.
- The input clamp `max(0, …)` now guards against `cached + cache_write` exceeding `input_tokens` on an incoherent stream, extending the existing single-term guard.
- Only `input` is floored — the other three classes are direct sums of `n()`-guarded values, unchanged from today (a negative-finite raw field is out of contract for a token count and is not separately clamped; the existing behaviour on `cache_read`/`output` is preserved).

**Failure modes.**
- **A1 wrong — `cache_write_input_tokens` is actually disjoint from `input_tokens`.** *Consequence:* when non-zero, `input` is under-counted (cache_write subtracted but not actually inside input) — the safe direction, but still wrong. *How you'd know:* the verification ticket's live cold-cache call shows `input_tokens` does *not* account for cache_write as one of its parts. *Fix:* drop `- cache_write` from line 5 (one line). *Blast radius today:* none — observed value is `0`.
- **A1 wrong — `reasoning_output_tokens` is disjoint (reported on top of `output_tokens`).** *Consequence:* output under-counted when non-zero (the safe direction, but still wrong). *How you'd know:* the verification ticket's reasoning-capable call shows `output_tokens` excludes reasoning. *Fix:* `totals.output += n(u.output_tokens) + n(u.reasoning_output_tokens)` (one line). *Blast radius today:* none — observed value is `0`.

**Anti-patterns.**
- A new `reasoning` class in `TOKEN_DELTA_CLASSES` — breaks Anthropic parity, forces price-map/schema changes, out of scope.
- Copying Anthropic's *disjoint* arithmetic onto the codex stream — adding `cache_write` to its class without subtracting it out of `input`. On a codex stream the `_input_tokens` fields are nested (proven for `cached`), so not subtracting double-counts a truly-nested field. Subtract it out until the verification ticket proves it disjoint.
- Asserting an abstract `input + cache_read + cache_write == input_tokens` partition in the test — that holds only under the subset handling and only when the raw fields are coherent; keep tests pinned to the independent oracle instead so a future handling change surfaces as an explicit oracle edit.
- Recording expected fixture totals by running `sumCodexUsage` on the payload — makes the test assert the function equals itself. Hand-derive the integers.

## 5. Scenarios

```
Given the committed real turn.completed.usage payload from codex-cli-observed.md
     ({input_tokens:14775, cached_input_tokens:12032, cache_write_input_tokens:0, output_tokens:6, reasoning_output_tokens:0})
When sumCodexUsage totals it
Then the return deep-equals the hand-derived independent oracle {input:2743, output:6, cache_write:0, cache_read:12032}
     (14775 − 12032 − 0 = 2743; a real payload of any magnitude — no live call, no probe)
```

```
Given a synthetic turn.completed.usage with non-zero new fields
     ({input_tokens:1000, cached_input_tokens:200, cache_write_input_tokens:150, output_tokens:40, reasoning_output_tokens:9})
When sumCodexUsage totals it
Then the return deep-equals {input:650, output:40, cache_write:150, cache_read:200}
     — proving cache_write_input_tokens reaches totals.cache_write (structural deadness gone),
       input subtracts BOTH cached and cache_write (1000 − 200 − 150 = 650, the subset handling),
       and reasoning_output_tokens is NOT added to output (9 excluded, already-inside handling)
```

```
Given a hand-synthesised incoherent turn.completed.usage where the nested subsets exceed the base
     (e.g. {input_tokens:5, cached_input_tokens:9} or {input_tokens:5, cache_write_input_tokens:9})
When sumCodexUsage totals it
Then totals.input is clamped to >= 0 (extends the existing `weird` clamp case to the widened subtraction),
     and no class double-counts
```

- The codex `output` class MUST equal `output_tokens` (reasoning folded, not added) exactly as the Anthropic `output` class does — cross-source parity for `economics --by class`.
- The codex `cache_write` class MUST source from `cache_write_input_tokens` exactly as the Anthropic `cache_write` class sources from `cache_creation_input_tokens`.

## 6. DESIGN DECISION RATIONALE

**Where should `cache_write_input_tokens` be counted?** (a) `totals.cache_write`; (b) leave unread. (b) keeps the class structurally dead and undercounts premium cache-write spend the moment codex reports it non-zero. **Chosen:** (a).

**Subtract `cache_write` from `input` (subset), or add without subtracting (disjoint)?** The relationship is unproven (both captures `0`). Three priors line up on subtract: (1) the field carries codex's `_input_tokens` suffix and the one proven such field, `cached_input_tokens`, is nested inside `input_tokens`; (2) subtracting is the undercount-safe direction — if it were actually disjoint, subtracting only undercounts `input`, whereas not-subtracting a truly-nested field double-counts it; (3) subtracting yields true class parity, since the Anthropic `input` class already excludes cache tokens. The disjoint alternative would be the double-count-risk direction and inconsistent with how this same function treats `cached` and `reasoning`. **Chosen:** subset (subtract), documented as an assumption with a verification-ticket pointer; the one-line flip to disjoint (drop the `- cache_write`) is reserved for the live call falsifying it.

**Reasoning added to output (disjoint), or treated as already-inside (subset)?** Anthropic folds thinking into `output_tokens` with no separate key, and codex/OpenAI report reasoning as part of the completion; matching that keeps both sources' `output` meaning identical and is the undercount-safe direction (adding a nested field double-counts). **Chosen:** already-inside (not added), documented; the one-line flip to add is reserved for the live call falsifying it.

**Reasoning its own class, or folded into output?** A separate class ripples into pricing/schema and breaks parity. **Chosen:** folded.

**Test oracle: independent hand-derivation, function-recompute, or abstract partition?** Function-recompute is circular; the abstract partition is branch-dependent (true only under the subset handling and only for coherent inputs). **Chosen:** the independent oracle — expected integers hand-derived from the raw fields, shown in the fixture.

**Settle the relationship now (live probe) or defer?** The human re-sliced: the live cold-cache demonstration is a separate verification ticket. Deferring keeps this half fully in-suite and unblocked; the conservative subset assumptions make the deferral safe (no numeric effect at `0`, both flips one line). **Chosen:** defer to the verification ticket.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — no product or architecture decision is outstanding. The one empirical unknown (subset-vs-disjoint for each new field) is deliberately deferred to the verification ticket and handled here by a conservative, documented, numerically-inert assumption.

**Assumptions.**

- **A1 — Assumes:** codex-cli's `cache_write_input_tokens` is a subset of `input_tokens`, and `reasoning_output_tokens` is already inside `output_tokens`. **Basis:** codex's `_input_tokens` nesting convention (proven for `cached_input_tokens`) + Anthropic-parity of the resulting class meanings + the double-count-avoidance principle; both observed values are `0`, so neither assumption alters any current spend read. **Validation:** the split-off verification ticket runs a live cold-cache, reasoning-capable codex call, observes non-zero values, and confirms or flips each (one-line change each). Recorded in `docs/architecture/codex-cli-observed.md` at that point.

**Proposed verification ticket (for the human to file — do not create here):**
- **Title:** "Confirm codex cache_write/reasoning token relationships on a live cold-cache call (settle FAFF-666's A1)"
- **Scope:** Run one operator-controlled, network-restricted, human-gated codex seat call with a fresh long prompt prefix (cold cache ⇒ non-zero `cache_write_input_tokens`) and a reasoning-capable model (non-zero `reasoning_output_tokens`). From the observed `turn.completed.usage`, settle per field whether it is subset-of / disjoint-from its base, record the arithmetic in `docs/architecture/codex-cli-observed.md`, and if either differs from FAFF-666's conservative subset assumption, flip the corresponding one-line branch in `sumCodexUsage` (drop the `cache_write` term from the input subtraction if disjoint, and/or add `reasoning` onto output if disjoint) with a fixture test asserting the corrected non-zero oracle. Done bar includes the environmental demonstration FAFF-666 excluded: `totals.cache_write > 0` for a real cache-writing call.

## Already shipped against this surface

- **FAFF-604** (telemetry adapter seam, Done 2026-07-25) — built `sumCodexUsage` and the cached-out-of-input subtraction this extends; delivered the three-field read, not the two-field gap.
- **FAFF-665** (live codex binary run, Done 2026-08-01) — discovered the two fields exist and were `0` (warm-cache reads); `codex-cli-observed.md` records it did not settle additive-vs-subset and names FAFF-666 as owner.
- **FAFF-415** (reasoning-effort telemetry, Done) — records the reasoning-*effort* dial, a different quantity from `reasoning_output_tokens`; no overlap.

## 8. DONE — Definition of Done

### From WHY
- [ ] Every field codex reports in `turn.completed.usage` is either summed into a token class or carries a comment naming why it is not added.
- [ ] `sumCodexUsage` reads `cache_write_input_tokens` into `totals.cache_write` — the class is no longer structurally dead for codex.

### From WHAT (types and interfaces)
- [ ] `cache_write_input_tokens` maps to `cache_write`; `reasoning_output_tokens` is dispositioned against `output` (not added, already-inside); the return shape `{input, output, cache_write, cache_read}` is unchanged.

### From HOW (behaviour)
- [ ] `input` subtracts both `cached_input_tokens` and `cache_write_input_tokens` (both handled as nested subsets); `output` = `output_tokens` (reasoning not added).
- [ ] A comment beside the reads names both new fields' disposition (class + subset/already-inside handling + the unproven-relationship assumption + a pointer to the verification ticket), and states the codex↔Anthropic class parity it preserves.
- [ ] The now-false "codex reports no cache-write class, so it is always 0" comment (L90–94) is removed/replaced.

### From HOW (edge cases)
- [ ] Absent/non-finite new fields contribute 0 (old codex builds meter as before).
- [ ] The widened input subtraction still floors at 0 on an incoherent stream (extends the `weird` case), asserted with no live input.

### Test evidence (all in-suite; no live seat)
- [ ] A test drives `sumCodexUsage` with the committed real observed payload (`{14775, 12032, 0, 6, 0}`) and asserts the hand-derived oracle `{input:2743, output:6, cache_write:0, cache_read:12032}`.
- [ ] A test drives `sumCodexUsage` with a synthetic **non-zero** new-field payload and asserts `cache_write` receives `cache_write_input_tokens`, `input` subtracts it, and `output` excludes `reasoning_output_tokens` — the assertion that proves structural deadness is gone and the subset/already-inside handling is wired.
- [ ] A test asserts the incoherent-payload input clamp under the widened subtraction.

### Explicitly NOT in this ticket's Done (→ verification ticket)
- [ ] ~~`totals.cache_write` non-zero on a real cold-cache codex call~~ — split-off verification ticket.
- [ ] ~~subset-vs-disjoint settled on a live call~~ — split-off verification ticket.

confidence: high
