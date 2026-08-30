# FAFF-935 — Refuter objections carry {claim, evidence, predicted_consequence}

> Spec: faffter-dark-nlspec · 2026-08-30 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-935.

## Why

FAFF-930 (the blinded per-proposition spec-review judge, currently blocked-by this ticket) discriminates a real defect from taste by whether an objection can name a concrete, checkable `predicted_consequence`. That field only carries signal if the reviewer produces it. Today the refuter lenses emit objections as bare `{lens, severity}` tuples plus free prose, so any consumer that wants the argued content has to degrade `predicted_consequence` to a stub. This ticket makes each refuter objection carry the argued content up front as a structured triple, so a downstream judge builds on a real discriminator instead of a degraded stub.

The change is additive enrichment, not a re-gate: the existing `{lens, severity}` gating path (majority rule, arithmetic floors) stays byte-identical, and legacy records that carry no triple still validate and gate exactly as before.

## What

Make each spec-review objection carry a structured triple alongside its `{lens, severity}`:

- `claim` — the assertion (what is wrong)
- `evidence` — what it points to (file/section/fact)
- `predicted_consequence` — the concrete, checkable thing that happens if the spec ships as-is

The triple must survive from the producer through `aggregate.mjs` and the per-round record (`round-<n>.json` `objections[]`) into the shape `faff spec-judge-evidence` already reads.

Surface touched (all on origin/main, verified in the FAFF-935 worktree):

- `plugin/skills/faff/contracts/spec-review-verdict.schema.json` — the objection-item schema.
- `plugin/skills/faff/bin/lib/contract-defs.js` — `computeSpecReviewVerdict` (the validator that normalises objections) and its embedded validate/describe self-test tables.
- `plugin/skills/faffter-dark-spec-review/aggregate.mjs` — the majority/severity roll-up that builds output objections.
- `plugin/skills/faffter-dark-spec-review/SKILL.md` + `refute-architectural.md` / `refute-infosec.md` / `refute-methodology.md` / `refute-qa.md` — the adversarial producers.
- `plugin/skills/faffter-noon-spec-review/SKILL.md` — the single-pass producer.
- Tests: `test/spec-refute-aggregate.test.mjs`, `test/spec-judge-evidence.test.mjs`, `test/contract-golden.test.mjs`, `test/contract-describe.test.mjs`.

Not touched (carry-through is already verbatim): `plugin/skills/faff/bin/lib/spec-judge-evidence.js` reads `rec.objections` verbatim into the bundle's `standing_objections`, so once the round record carries the triple it reaches FAFF-930's assembler with no change here.

## How

### Contract — extend the objection shape additively

**Chosen:** extend `objections[]` from `{lens, severity}` to `{lens, severity, claim?, evidence?, predicted_consequence?}` with the three new fields optional. This is the ticket's preferred option over a parallel sidecar: a sidecar would need a second store and a join key the objection shape lacks, whereas the objection entry is already the unit that flows verbatim through the round record into `spec-judge-evidence`.

**Chosen:** the validator preserves the triple, never re-gates on it. In `computeSpecReviewVerdict` (contract-defs.js), the `raw.map(...)` that today returns `{ lens, severity }` also copies `claim` / `evidence` / `predicted_consequence` onto the output objection when each is present as a string, and omits it when absent or non-string. The existing lens/severity enum violations, the founded-verdict checks (`approve` carries none; every non-approve carries at least one), and the `conformant` boolean are all computed exactly as today — the triple fields add no violation and change no verdict. This keeps the gating path a byte-identical decision over `{lens, severity}` while making the enriched objection survive verbatim through the consumer-fold's round-record write.

**Chosen:** the schema permits the three optional string fields. In `spec-review-verdict.schema.json`, the objection item adds `claim` / `evidence` / `predicted_consequence` as `{ "type": "string" }` properties, keeps `required: ["lens", "severity"]`, and keeps `additionalProperties: false` (now listing the three). A legacy `{lens, severity}`-only objection still validates because the new fields are optional. `schemaCheck` runs on the validator's normalised `contractData`, so the schema and the validator's pass-through must agree on the field set — both are edited together.

**Chosen:** the taste-level sentinel is the literal string `"not separately stated"`. A lens that genuinely cannot name a concrete predicted consequence emits `predicted_consequence: "not separately stated"` rather than omitting the field — the honest signal that the objection is taste-level, which is exactly the discriminator FAFF-930 keys on. This is a producer convention, not a validator rule: the validator treats it as any other string (it never inspects the value), so no enum or special-case handling is added to the contract.

### Aggregation — preserve the triple through the roll-up

**Chosen:** `aggregate.mjs` carries the triple from each input Refutation objection onto the output objection. Where the roll-up today pushes `{ lens: r.lens, severity: sev }`, it also copies `claim` / `evidence` / `predicted_consequence` from the source objection `o` when present. The severity mapping, the `refutedCount` / `anyCritical` tally, the majority gate, and the transport-floor synthesis (`nameLenses`) are unchanged. Transport-floor-synthesised objections (a down or config-fault lens with no finding to grade) carry no triple — correct, since there is no argued content to attach; the fields are optional precisely for this case.

### Producers — emit the triple

**Chosen:** both spec-review occupants emit the triple per objection.

- The four `refute-<lens>.md` prompts change their per-objection output block from a bare `### [severity]: title` + `Concrete refutation:` prose shape to one that names the three parts explicitly (claim / evidence / predicted_consequence), and instruct the lens to emit `predicted_consequence: not separately stated` when it cannot name a concrete consequence.
- `faffter-dark-spec-review/SKILL.md` updates the Refutation JSON entry shape it documents (the objections it assembles from each lens's prose) from `[{ severity, summary? }]` to `[{ severity, claim, evidence, predicted_consequence, summary? }]`, and notes that `aggregate.mjs` carries the triple through into the round record.
- `faffter-noon-spec-review/SKILL.md` (the single-pass L1–L3 occupant) updates its "gathers `{lens, severity}` objections" language and its contract-block output examples so each emitted objection carries the triple (with the `"not separately stated"` sentinel for a taste-level finding).

**Chosen:** reconcile the "never widen `round-<n>.json`'s shape" note. `faffter-dark-spec-review/SKILL.md` currently warns against widening `round-<n>.json`'s `{verdict, objections}` shape because churn/convergence read it. That note is refined, not deleted: the top-level record shape stays `{verdict, objections}` and the gating reads (`spec-review-churn`, `spec-review-convergence`) are unchanged — they read only `lens` / `severity` / `objections.length` and are already defensive against extra fields. What changes is that each objection *entry* may now carry the optional triple. The note is reworded to permit the additive per-objection fields while keeping the top-level shape and the gating reads off-limits.

### Carry-through — already verbatim

**Assumes:** `spec-judge-evidence.js` copies `rec.objections` verbatim into the bundle's `standing_objections` and reads only `lens` / `severity` for its arithmetic (`infosecMajorFree`). Confirmed in the worktree — no change is needed there for the triple to reach FAFF-930's assembler; a test asserts the pass-through.

**Assumes:** faff-prep writes `round-<n>.json` as the `{verdict, objections}` it parsed from the producer's contract block (the consumer-fold), so with the validator preserving the triple the round record carries it automatically. No new write path is added in prep.

### Back-compat and non-goals

**Chosen:** back-compat is guaranteed at three points and fixtures cover both shapes: (1) a legacy verdict block / round record carrying only `{lens, severity}` validates exit 0; (2) churn and convergence produce identical output on legacy and enriched records; (3) `aggregate()`'s verdict and `spec-judge-evidence`'s `blocker_free_latest` / `infosec_major_free_latest` are unchanged.

**Punt:** whether FAFF-930's assembler surfaces or weighs the triple is out of scope — this ticket only guarantees the triple is *available* when produced. FAFF-930 owns the `argumentA` degrade path and re-preps once this is Done.

## Done (acceptance criteria)

1. The contract validator `computeSpecReviewVerdict` (contract-defs.js) copies `claim` / `evidence` / `predicted_consequence` (string values) onto each output objection when present and omits them when absent; the `{lens, severity}` enum violations, the founded-verdict checks, and the `conformant` boolean are unchanged. Verified: new cases in the embedded validate self-test table and `test/contract-golden.test.mjs` — a triple-carrying objection round-trips the three fields; a legacy `{lens, severity}` objection validates exit 0 with no triple keys; a non-string triple field adds no violation and does not change the verdict.

2. The schema `spec-review-verdict.schema.json` permits `claim` / `evidence` / `predicted_consequence` as optional string properties on objection items, keeps `required: [lens, severity]` and `additionalProperties: false`, and a legacy `{lens, severity}`-only objection still validates. Verified: `schemaCheck` via the contract validate self-test passing on both a triple-carrying and a legacy `contractData`.

3. `aggregate.mjs` carries the triple from each input Refutation objection onto the output objection when present and omits it when absent; the majority/severity verdict, the objection count, and the transport-floor synthesis are unchanged. Verified: new `aggregate.mjs --selftest` cases and `test/spec-refute-aggregate.test.mjs` — an enriched input yields output objections carrying the triple; a bare input yields today's `{lens, severity}` output; the verdict is identical across both.

4. The triple survives into the per-round record and thence `faff spec-judge-evidence`'s `standing_objections`. Verified: `test/spec-judge-evidence.test.mjs` — a `round-<n>.json` fixture whose `objections[]` carry the triple produces a bundle whose `standing_objections` carry it verbatim; a legacy fixture without the triple assembles and gates identically (`blocker_free_latest` / `infosec_major_free_latest` unchanged).

5. Both spec-review occupants' prompts emit the triple per objection, with the literal `"not separately stated"` for a taste-level objection. Verified: the four `refute-<lens>.md` prompts and both occupant `SKILL.md` files describe the `{claim, evidence, predicted_consequence}` objection shape and the `"not separately stated"` sentinel, and `faff validate-adapters` stays green on every edited skill file.

6. Legacy back-compat: a `{lens, severity}`-only verdict block and round record still validate (exit 0) and drive the existing gate identically, and `spec-review-churn` / `spec-review-convergence` output is unchanged on legacy vs enriched records. Verified: the existing churn/convergence tests stay green plus a fixture pair (legacy and enriched) asserting identical churn/convergence output.

7. No change to the majority rule or the arithmetic floors. Verified: the existing `aggregate.mjs` and `spec-judge-evidence` self-tests and their test files remain green with no edits to the gating assertions.

8. The full engineering gate ladder is green: `faff validate-adapters`, `faff lint-refs`, `faff lint-cli-doc`, `faff adr validate`, `faff prdr validate`, `faff regions check`, and the unit suite (`node --import ./test/hermetic-env.mjs --test`).

confidence: high