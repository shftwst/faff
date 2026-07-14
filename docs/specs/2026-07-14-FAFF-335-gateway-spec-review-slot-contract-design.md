# FAFF-335 — Gateway: add spec_review + grounding slots and the fixed spec-review-verdict contract section

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-335.

This spec addresses FAFF-335 for the build agent and human reviewers: it documents, in `plugin/skills/faff/SKILL.md` (the gateway), a `spec_review` row and a `grounding` row in the slot-defaults table, plus a **"Spec-review verdict (fixed)"** section under Core contracts that mirrors the already-shipped `faff contract spec-review-verdict` enum/shape byte-for-byte. This is a document-the-shipped-behaviour ticket — audit finding D1 (`docs/audits/2026-07-04-faff-323-whole-system-coherence.md`) — no runtime behaviour changes.

## 1. WHY — Problem and Principles

**Load-bearing model:** the gateway (`plugin/skills/faff/SKILL.md`) is the declared single home of fixed internal contracts — every adaptor/producer slot "refers back" to it rather than carrying its own authoritative copy (**Contract loading & conformance**, gateway lines ~920–943). This works only if the referenced section actually exists.

**Problem:** the `spec_review` slot is fully implemented — `faff contract spec-review-verdict` (dispatcher-known, 9 passing selftest fixtures), two shipped occupants (`faffter-noon-spec-review`, `faffter-dark-spec-review`), faff-prep's consumer-fold (`faff-prep/SKILL.md` §"Spec-review gate"), the `faff spec-review-lenses` cost-gate, and the lights-out preflight probe (`lights-out.js`'s `LIGHTS_OUT_GUARDRAILS` `spec_review` entry + Rule A adversarial-occupant coherence check) — but the gateway never defines the slot in its slot-defaults table (`faff/SKILL.md:200–217`) nor a fixed contract section under Core contracts (`faff/SKILL.md:914–1007`). Both occupants' refer-backs (`faffter-noon-spec-review/SKILL.md:12`, `faffter-dark-spec-review/SKILL.md:14` — "Read the sibling `faff/SKILL.md` … it holds the shared rules and the fixed contracts") point at a gateway that is silent on this exact contract, so the conformance mechanism (**Contract loading & conformance** mechanism 2, "standalone reads on demand") fails for a standalone invocation, and each occupant's own non-normative recap (e.g. `faffter-noon-spec-review/SKILL.md:79`) becomes authoritative by default — precisely the drift the refer-back pattern exists to prevent.

The `grounding` slot (ADR-0040, `faff-contract:grounding-evidence` named in FAFF-330) has the same gap: it is referenced in prose (gateway line ~1037, "Grounding is advisory — the domain KB (grounding slot, FAFF-127/128)") but has no row in the slot-defaults table.

**Design principles:**

**Document the shipped shape, invent nothing.** `plugin/skills/faff/bin/lib/contract-defs.js`'s `computeSpecReviewVerdict` + `plugin/skills/faff/contracts/spec-review-verdict.schema.json` are the ground truth. The new gateway section restates their enum/shape/invariant exactly — no new field, no new verdict, no reinterpretation.

**Terse, not a restatement of the occupants.** Per `docs/skill-authoring.md` (lean/deduplicated/skimmable) and the gateway's own `SKILL_LINE_CAP_OVERRIDE` note ("the gateway is the shared-prose hub … it grows structurally with each new slot/contract … forcing leanness per addition"), the new section mirrors the shape and terseness of the existing fixed-contract sections (**Review verdict (fixed)**, **Delivery outcome (fixed)**) — it states the contract once; it does not re-explain the four lenses or the cost-gate (those stay owned by `faff-prep`/the occupants).

**The gateway's own line cap is the real constraint.** The gateway is 1095 lines against a 1100-line override cap (`SKILL_LINE_CAP_OVERRIDE.faff`, `validate-adapters.js:39`) — near-zero headroom. The two additions (2 slot-table rows + one ~6-line contract section) push it past 1100, so the override needs a minimal bump, in the same spirit as its own comment and prior precedent (beep-boop's cap moved 650→660→690 across tickets).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/SKILL.md:200–223` | The `slots:` yaml table (**Slots (optional delegation)**) — where the two new rows land |
| `plugin/skills/faff/SKILL.md:914–1007` | **Core contracts and adaptor slots** — where the new fixed-contract subsection lands, alongside the sibling fixed sections it mirrors (**Review verdict (fixed)**, **Delivery outcome (fixed)**, **Automation-routing verdict (fixed)**, **Spec readiness (fixed)**) |
| `plugin/skills/faff/bin/lib/contract-defs.js:264–305` | `computeSpecReviewVerdict`/`contractSpecReviewVerdict` — the shipped enum (`approve\|revise\|reject-approach\|needs-human`), the objection shape (`lens` × `severity`), and the founded-verdict invariant this spec documents verbatim |
| `plugin/skills/faff/contracts/spec-review-verdict.schema.json` | The JSON-schema mirror of the same shape (`verdict`, `objections[]`, `conformant`, `violations`) |
| `plugin/skills/faff/bin/lib/validate-adapters.js:39` | `SKILL_LINE_CAP_OVERRIDE` — the cap this spec bumps minimally |
| `plugin/skills/faff-prep/SKILL.md:98–119` | The Spec-review gate consumer-fold — already correctly implements the contract; unaffected by this doc-only change |
| `plugin/skills/faff/bin/lib/lights-out.js:47,271–279,354-355` | The `spec_review` lights-out guardrail + Rule A adversarial-occupant coherence — already correctly implements/enforces the slot; unaffected |
| `docs/audits/2026-07-04-faff-323-whole-system-coherence.md` (D1/T1) | The audit finding this ticket closes |

**Scope:** a documentation-only change to `plugin/skills/faff/SKILL.md` (two slot-table rows + one new fixed-contract subsection) plus the minimal companion bump to `SKILL_LINE_CAP_OVERRIDE.faff` in `plugin/skills/faff/bin/lib/validate-adapters.js`. No CLI behaviour change, no schema change, no occupant change.

## 2. OUT OF SCOPE

- **Any change to `faff contract spec-review-verdict`'s implementation, schema, or selftest fixtures.** This ticket documents the shipped shape; it does not touch `contract-defs.js` or the `.schema.json`.
- **A `faff-contract:grounding-evidence` fixed-contract section.** The ticket asks only for a `grounding` **slot row** (default: none — no-op by absence), not a fixed-contract subsection; ADR-0040/FAFF-127/128 own that separately and are not re-opened here.
- **Any occupant-side (`faffter-noon-spec-review`, `faffter-dark-spec-review`) prose change.** Their refer-backs already correctly say "Read the sibling `faff/SKILL.md`"; they need no edit once the target section exists.
- **A lavish cap bump.** The `SKILL_LINE_CAP_OVERRIDE.faff` value moves by the minimum needed to fit the lean addition plus small headroom — not a round, generous number chosen independent of the actual new line count.
- **`faff-prep`/lights-out/lens-selection prose changes.** All three already correctly implement and refer to the slot; only the gateway (the thing they refer back to) is silent.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary (identical to the shipped code — restated, not redefined):**

| Term | Definition |
|---|---|
| `verdict` | one of `approve` \| `revise` \| `reject-approach` \| `needs-human` (`SPEC_REVIEW_VERDICTS`, `contract-defs.js:271`) |
| `objections` | `[{ lens, severity }]`; `lens` ∈ `architectural\|infosec\|methodology\|QA` (`SPEC_REVIEW_LENSES`), `severity` ∈ `blocker\|major\|minor` (`SPEC_REVIEW_SEVERITIES`) |
| founded-verdict invariant | `approve` ⇒ zero objections; every non-`approve` verdict ⇒ ≥1 objection (`contract-defs.js:294–295`) |
| coercion (fixed) | a malformed/absent extraction (no block, unparseable, or `verdict` outside the four-value enum) is treated as `needs-human` by the consumer (faff-prep, `faff-prep/SKILL.md:111–112`) — the contract script itself fails loud (exit 2, no safe coerce target, since faff's own producer emits the block) and the consumer maps that fail-loud to `needs-human`, mirroring the review-verdict contract's "malformed → `needs-human`, never `pass`" precedent |

**Gateway diff (pseudocode):**

```
slots: yaml table (after `prd:`, before `methodology:` — grouping producer slots together):
  + spec_review: <example>   # spec-stage approach-critique producer for faff-prep, optional (default faffter-noon-spec-review)
  + grounding: <example>     # optional domain-KB advisor (ADR-0040, FAFF-127/128), optional (default: none — no-op by absence)

Core contracts and adaptor slots, new subsection after "### Review verdict (fixed)":
  + ### Spec-review verdict (fixed)
      - Internal contract (fixed): verdict enum + objections shape + founded-verdict invariant + coercion rule
      - The envelope + the consumer-fold: producer emits, faff-prep (Spec-review gate) is the consumer

validate-adapters.js:
  SKILL_LINE_CAP_OVERRIDE.faff: 1100 → <new gateway line count + small headroom>
```

**Design decisions** (rationale in section 6): section placement (new subsection vs. folding into an existing one) — **Chosen:**; heading text (`Spec-review verdict (fixed)`, matching the sibling fixed-section naming convention) — **Chosen:**; cap-bump sizing — **Chosen:**; `grounding` row scope (slot row only, no new fixed-contract section) — **Chosen:**.

## 4. HOW — Behavior

**Step 1 — slot-defaults table.** In `plugin/skills/faff/SKILL.md`'s `slots:` yaml block (**Slots (optional delegation)**, currently lines ~205–216), add two rows following the existing style (an illustrative third-party example value + a trailing comment naming the real default):

```yaml
  spec_review: faffter-dark-spec-review              # spec-stage approach-critique producer for faff-prep, optional (default faffter-noon-spec-review)
  grounding: my-org:domain-kb                         # optional domain-KB advisor (ADR-0040, FAFF-127/128), optional (default: none — no-op by absence)
```

Placement: group with the other producer-slot rows (after `prd:`, before `methodology:` — `methodology` is a diagnostic lens, not a producer, so the producer cluster stays contiguous).

**Step 2 — fixed-contract section.** Under **Core contracts and adaptor slots**, insert a new `### Spec-review verdict (fixed)` subsection immediately after `### Review verdict (fixed)` (and before `### Delivery outcome (fixed)`) — same tier of section, same terseness. Content (verbatim, mirroring the sibling sections' two-paragraph shape):

```
### Spec-review verdict (fixed)

**Internal contract (fixed):** the spec-stage approach-critique (the `spec_review` slot) returns exactly
one of four verdicts — `approve` / `revise` / `reject-approach` / `needs-human` — plus `objections:
[{ lens, severity }]` over the fixed enums `architectural|infosec|methodology|QA` (lens) ×
`blocker|major|minor` (severity). **Founded-verdict invariant:** `approve` carries zero objections;
every non-`approve` verdict carries at least one; a malformed or absent extraction (no block,
unparseable, or a verdict outside the four-value enum) is never `approve` — it coerces to
`needs-human`, mirroring the review-verdict contract's "malformed → `needs-human`, never `pass`" rule.
`faff contract spec-review-verdict` is the sole source of contract data.

**The envelope + the consumer-fold.** The `spec_review` slot (default `faffter-noon-spec-review`)
emits its verdict as a `faff-contract:spec-review-verdict` artifact block — `{ "verdict": "...",
"objections": [ { "lens": "...", "severity": "..." }, … ] }`. **faff-prep is the consumer** (see
**Spec-review gate**): it locates the block, `JSON.parse`s it, and pipes it to `faff contract
spec-review-verdict`; exit 0 routes on the verdict, exit 1/2 or an absent/garbled block parks as
`needs-human`. No paired adaptor slot — the producer self-declares, per the `spec`/`review`/`ship`
precedent (**Producer slots vs adaptor slots**).
```

(Each paragraph is written as a single unwrapped line in the actual file, per the gateway's existing prose convention — the line-wrapping above is presentation only.)

**Step 3 — cap bump.** After Steps 1–2 land, run `wc -l plugin/skills/faff/SKILL.md` to get the real new count, then set `SKILL_LINE_CAP_OVERRIDE.faff` in `plugin/skills/faff/bin/lib/validate-adapters.js:39` to that count plus a small headroom (round to the nearest 5, matching the beep-boop precedent's step size) — not a speculative round number chosen before the real count is known.

**Step 4 — verify.** Run `faff validate-adapters` (foreground) and confirm: the line-cap check passes for `faff`, no duplicated-block violation is introduced (the new prose is original, not copied from either occupant), no stray-marker violation, and the existing occupant structural checks (`producer-spec-review` type, already passing) are unaffected.

**Edge cases:**

- The `grounding` slot has **no** occupant shipped and **no** fixed contract section — its row states "default: none — no-op by absence" exactly as the ticket specifies; this spec does not invent a `faff-contract:grounding-evidence` section (out of scope, see §2).
- If the real post-edit line count comes in lower than expected (leaner phrasing than drafted above), the cap bump should still track the *actual* count, not the estimate in this spec — the HOW step's "run `wc -l` first" ordering exists precisely so the bump is measured, not guessed.

**Failure modes:**

- **The cap bump is skipped and `faff validate-adapters` fails on the line-cap check.** How you'd know: the gate output names `faff (line cap)` with the actual/cap numbers. What it means: Step 3 didn't run, or ran before Steps 1–2 finished — reorder to measure last.
- **The new section duplicates occupant prose closely enough to trip the duplicated-block lint (`DUP_BLOCK_WINDOW`/`DUP_SIG_MINLEN`).** How you'd know: `validate-adapters` names the duplicated lines across two skills. What it means: the section drifted from "state the contract, don't restate the occupant's reasoning" — tighten the wording so it describes the *shape*, not the occupants' lens/checklist logic (which stays occupant-owned).

**Anti-pattern:** bumping the cap first and writing to fit whatever headroom that creates. Why: that inverts the ticket's own ordering (lean first, bump only what's left over) and risks a lavish, unjustified cap increase.

## 5. SCENARIOS

```
Given plugin/skills/faff/SKILL.md before this change (no `spec_review`/`grounding` slot rows,
  no "Spec-review verdict (fixed)" section)
When a reviewer greps the slot-defaults table and Core contracts section
Then neither `spec_review` nor `grounding` appears, and no fixed-contract section names the
  spec-review-verdict shape
```

```
Given the change applied
When a reviewer greps `plugin/skills/faff/SKILL.md` for `spec_review` and `grounding`
Then both appear as slot-table rows, and a "### Spec-review verdict (fixed)" heading exists
  under "## Core contracts and adaptor slots"
```

```
Given the new "Spec-review verdict (fixed)" section
When its enum/shape/invariant text is compared against `contract-defs.js`'s
  `SPEC_REVIEW_VERDICTS`/`SPEC_REVIEW_LENSES`/`SPEC_REVIEW_SEVERITIES` and the
  approve/non-approve objection-count rule
Then they match exactly — no invented field, no renamed enum value
```

```
Given the two occupants' existing refer-back sentences ("Read the sibling `faff/SKILL.md`
  … it holds the shared rules and the fixed contracts")
When the gateway now contains the target section
Then the refer-back resolves to real content instead of an absent section
```

```
Given the edited gateway file
When `wc -l plugin/skills/faff/SKILL.md` is run and compared against the (possibly bumped)
  `SKILL_LINE_CAP_OVERRIDE.faff`
Then the line count is at or under the (updated) cap
```

```
Given the edited gateway + the bumped cap
When `faff validate-adapters` runs
Then it exits 0 (PASS) — no line-cap failure, no duplicated-block violation, no stray-marker
  violation, all existing occupant checks still pass
```

## 6. DESIGN DECISION RATIONALE

**Section placement — new subsection vs. folding into an existing one?** Options: (a) a new `### Spec-review verdict (fixed)` subsection, sibling to **Review verdict (fixed)** / **Delivery outcome (fixed)**; (b) fold the content into **Spec readiness (fixed)** (both gate the spec stage). **Chosen:** (a) — spec-readiness and spec-review are orthogonal gates (**internally well-formed?** vs. **is the approach any good?**, `faff-prep/SKILL.md:98`'s own framing) with distinct contracts (`spec-readiness` vs. `spec-review-verdict`); every other fixed contract already gets its own subsection, so a new one is the consistent, discoverable placement — folding would bury a fourth contract inside a section named for a different one.

**Heading text?** Options: (a) `Spec-review verdict (fixed)` (matches the ticket's own wording and the `Review verdict (fixed)` / `Delivery outcome (fixed)` / `Automation-routing verdict (fixed)` naming pattern); (b) something occupant-specific. **Chosen:** (a) — consistency with the existing four fixed-contract headings makes the section immediately recognizable as "one of the fixed set," and it is exactly what the ticket names.

**Cap-bump sizing?** Options: (a) measure the real post-edit line count and add small headroom, rounded to the nearest 5; (b) jump straight to a round number (1110, 1120) without measuring. **Chosen:** (a) — the ticket is explicit that the bump must be minimal, and the prior beep-boop precedent (650→660→690) moved in small, measured steps tied to actual additions, not speculative ones.

**`grounding` row scope — slot row only, or also a fixed-contract section?** Options: (a) slot row only (default: none, no-op by absence); (b) also add a `faff-contract:grounding-evidence` fixed section now. **Chosen:** (a) — the ticket and the audit finding (D1/T1) both scope the ask to the slot-defaults table row; `grounding-evidence`'s fixed-contract section is ADR-0040/FAFF-127/128's own territory and pulling it in here would exceed this ticket's boundary (and burn more of the tight line-cap budget on an unrelated contract).

**Is this ADR-worthy?** This ticket documents an already-shipped, already-implemented contract — it establishes no new architectural rule, only closes a documentation gap the audit found. **Chosen:** not ADR-worthy.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none blocking — every decision above carries a **Chosen:** marker.

**Assumptions:**

- **Assumes:** the shipped `computeSpecReviewVerdict`/`contractSpecReviewVerdict` in `contract-defs.js` and `spec-review-verdict.schema.json` are the ground truth for the enum/shape (i.e., they are not themselves mid-change). Validate: confirmed by direct read at spec time (`contract-defs.js:264–305`, schema file) and by the 9 passing selftest fixtures (`fixtures: [...]`, `contract-defs.js:1287–1300`).
- **Assumes:** no other in-flight ticket is simultaneously editing `plugin/skills/faff/SKILL.md`'s slot table or Core contracts section (a merge-conflict risk, not a design risk) or `SKILL_LINE_CAP_OVERRIDE` in `validate-adapters.js`. Validate: checked no open PR touches these ranges at build start.
- **Assumes:** FAFF-348 (related, "give faffter-dark-nlspec a documented quality bar") is a separate, non-blocking concern — it targets the `spec` slot's occupant, not the `spec_review` slot this ticket documents. No dependency either direction.

## 8. DONE — Definition of Done

### From WHY
- [ ] The gateway (`plugin/skills/faff/SKILL.md`) defines the `spec_review` slot (with its default named) and a fixed contract section for `spec-review-verdict`, so both occupants' "Read the sibling `faff/SKILL.md`" refer-backs resolve to real content — closing audit finding D1/T1.

### From WHAT
- [ ] `slots:` yaml table gains a `spec_review:` row (comment names default `faffter-noon-spec-review`) and a `grounding:` row (comment states default: none — no-op by absence).
- [ ] A `### Spec-review verdict (fixed)` section exists under `## Core contracts and adaptor slots`, stating: the four-value verdict enum, the `objections: [{lens, severity}]` shape with both enums, the founded-verdict invariant (approve ⇒ 0 objections, non-approve ⇒ ≥1), and the malformed/absent → `needs-human`-never-`approve` coercion rule.
- [ ] The documented enum/shape/invariant matches `contract-defs.js`'s `SPEC_REVIEW_VERDICTS` / `SPEC_REVIEW_LENSES` / `SPEC_REVIEW_SEVERITIES` and the approve/objection-count rule exactly — verified by direct comparison, not by inspection alone.

### From HOW
- [ ] `plugin/skills/faff/bin/lib/validate-adapters.js`'s `SKILL_LINE_CAP_OVERRIDE.faff` is bumped from 1100 to the real post-edit line count plus small headroom (measured via `wc -l`, not guessed).
- [ ] `faff validate-adapters` (foreground) exits 0: no line-cap failure for `faff`, no duplicated-block violation, no stray-marker violation, both `producer-spec-review` occupants still pass their existing structural checks unchanged.
- [ ] `node --test` stays green (no CLI logic touched, but the full suite is re-run as a safety net since `validate-adapters.js` was edited).

### From docs/tests (same PR — docs never go stale)
- [ ] No occupant SKILL.md needs editing (their refer-back prose was already correct) — verified by re-reading `faffter-noon-spec-review/SKILL.md:12` and `faffter-dark-spec-review/SKILL.md:14` post-change and confirming no further edit is warranted.

## Already shipped against this surface

Done tickets matched on the spec-review-verdict / gateway-contract surface — related groundwork, none supersedes this premise (no Done ticket documents this contract in the gateway):

- FAFF-265: the `spec-review-verdict` contract-as-code surface (`contract-defs.js`, schema, selftest) this spec documents verbatim.
- FAFF-266: the default single-pass `spec_review` occupant (`faffter-noon-spec-review`).
- FAFF-267: the L4 adversarial per-lens occupant (`faffter-dark-spec-review`).
- FAFF-268: the lens-selection cost-gate (`faff spec-review-lenses`) that feeds the producer — unaffected by this doc-only change.
- FAFF-323: the whole-system coherence audit that surfaced this exact gap as finding D1/T1.
- FAFF-115: the gateway-as-shared-prose-hub decision (`SKILL_LINE_CAP_OVERRIDE`'s own comment) this spec's cap-bump follows.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a single cohesive slice: two slot-table rows + one fixed-contract section + the one companion cap-bump line they force. Splitting the cap-bump into a separate ticket would leave the documentation change unable to land (it would fail its own line-cap gate).
- **Workstream fit?** No issues — closes a named, evidence-backed audit finding (D1/T1) discovered during FAFF-323; no scope creep beyond the finding's own stated fix (the `grounding` section is explicitly left out, see §2).
- **Deps surfaced?** None blocking. FAFF-348 (spec occupant's own quality-bar gap) touches a different slot (`spec`, not `spec_review`) and is not a blocker or dependency either direction — confirmed via `get_issue --includeRelations` (`relatedTo: [FAFF-323, FAFF-348]`, no `blockedBy`).
- **Risk profile?** No issues — a documentation-only change with a deterministic verification gate (`faff validate-adapters`); no de-risking spike warranted.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
