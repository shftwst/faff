# FAFF-943 — Refuter objections carry `spec_anchor`, the attacked section's heading slug

> Spec: faffter-dark-nlspec · 2026-08-31 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-943.

This document is the full nlspec for FAFF-943 (Linear): adding one optional field, `spec_anchor`, to the spec-review objection shape so FAFF-930's blinded judge can bind each disputed proposition to the spec section it attacks. Audience: the build agent and human reviewers. It is a FAFF-935-shaped enrichment, one more optional key through the same pipeline, not a redesign. The reference record for that shape is `records/specs/2026-08-30-FAFF-935-refuter-objections-carry-claim-evidence-design.md`.

## 1. Why

The one idea this spec turns on: FAFF-930's judge finds the spec's own defence (Argument B) for each disputed objection by a deterministic string lookup, never a model call. The join key for that lookup is the heading slug of the spec section the objection attacks. The refuter is the only party that knows which section it is attacking, so the refuter must say so, in a form the consumer can re-derive from the spec's own headings.

Status quo: FAFF-935 shipped objections carrying `{lens, severity}` plus the optional triple `{claim, evidence, predicted_consequence}`, but no section binding. Pain: with no `spec_anchor`, every proposition in FAFF-930's assembler falls to the zero-match path (`orchestrator:undefended`), so the judge weighs every attack against a null defence. This change adds the binding at the source, one additive optional field per objection, carried through the existing FAFF-935 pipeline unchanged.

**Design principle: enrichment, never a re-gate.** The `{lens, severity}` gating path (majority rule, severity veto, arithmetic floors) stays byte-identical. Any implementation that lets `spec_anchor` add a violation, change a verdict, or alter churn/convergence output is wrong, however tidy.

**Design principle: one derivation rule, pinned on both sides.** The producer (an LLM writing prose) and the consumer (FAFF-930's assembler, code) must derive the same slug from the same heading, or the binding silently degrades. The rule is therefore stated once in each producer prompt and exported once as consumer-side code, and a test holds the two to the same worked example.

Reference context:

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,methodology,qa}.md` | prompt markdown | The four adversarial producers; each per-objection block gains one bullet |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | prompt markdown | Documents the Refutation JSON entry shape and the round-record note |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | JS (ESM, zero-dep) | The roll-up; `carryTriple` copies the FAFF-935 fields verbatim |
| `plugin/skills/faffter-noon-spec-review/SKILL.md` | prompt markdown | The single-pass producer; documents the triple and contract examples |
| `plugin/skills/faff/contracts/spec-review-verdict.schema.json` | JSON Schema | Objection item: `required [lens, severity]`, optional triple, `additionalProperties: false` |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JS (CJS) | `computeSpecReviewVerdict` (~line 422) copies the triple; golden fixtures ~line 2390 |
| `plugin/skills/faff/bin/lib/spec-judge-evidence.js` | JS (CJS) | Reads round records verbatim into `standing_objections`; arithmetic reads only lens/severity |
| `plugin/skills/faff/bin/lib/{adr,decisions,prd}.js` | JS (CJS) | The existing heading-slug convention (with a filename-only 80-char cap) |

Scope statement: this sits at the producer end of the spec-review pipeline, between FAFF-935 (the triple, shipped) and FAFF-930 (the judge's Argument-B binding, blocked on this).

## 2. Out of scope

- **FAFF-930's assembler** (the anchor lookup, the derive-from-cited-sections fallback for an absent anchor, the `orchestrator:undefended` zero-match path). Why: FAFF-930 owns the consumer; this ticket only guarantees the anchor is available and the derivation rule is agreed. Extension point: `plugin/skills/faff/bin/lib/heading-slug.js` (new, below) and the bundle's `standing_objections`.
- **The content-addressed stable anchor of the same name.** FAFF-930's round-4 spec also names a `spec_anchor` on its case file: a stable, content-addressed binding captured at assemble time so a renamed heading cannot silently strip a defence. That is a different artifact at a different layer. This ticket's objection-level `spec_anchor` is the heading slug used for the initial assemble-time match only, and it is disambiguated at the point of use, not only in a far-away comment: the schema `description` for the objection field says explicitly it is the mutable heading slug, never the rename-resistant case-file anchor, and must not be persisted across spec revisions. Extension point: FAFF-930's case-file assembly (which should rename its case-file field or namespace it if the collision bites at build time).
- **Weighing or surfacing the anchor in any verdict.** Why: same as FAFF-935's punt on the triple; availability only. Extension point: FAFF-930's judge.
- **Any change to lens selection, the majority rule, severity mapping, or the floors.** Why: the no-re-gate principle. Extension point: none; deliberately closed.

## 3. What

Vocabulary:

| Term | Definition |
|---|---|
| heading slug | The markdown heading text passed through the derivation rule in HOW (lowercase, hyphen-collapsed, trimmed) |
| objection entry | One element of `objections[]` in the `spec-review-verdict` shape |
| carry-through | The verbatim survival of optional objection fields through validator → round record → `spec-judge-evidence` |

The objection entry gains one field:

```
RECORD Objection:                     # one entry in objections[]
  lens: String                        # enum-checked via violations (unchanged)
  severity: String                    # enum-checked via violations (unchanged)
  claim?: String                      # FAFF-935 triple (unchanged)
  evidence?: String                   # FAFF-935 triple (unchanged)
  predicted_consequence?: String      # FAFF-935 triple (unchanged)
  spec_anchor?: String                # NEW — heading slug of the attacked spec section
                                      # omitted entirely when the lens cannot name one section
```

**Additive and optional, on the objection entry itself.** A sidecar store would need a join key the objection shape lacks; a required field would break every legacy record and the transport-floor synthesized objections, which attack nothing. The objection entry is already the unit that flows verbatim into `spec-judge-evidence`. **Chosen:** `spec_anchor` is a single optional string beside the FAFF-935 triple, `required` stays `["lens", "severity"]`, and legacy records without it validate and gate identically.

## 4. How

### Slug discipline — the pinned derivation rule

Behaviour summary: one pure text function turns a heading into the anchor key; both sides of the seam use exactly it.

```
FUNCTION headingSlug(headingText):
  1. Lowercase the text
  2. Replace every run of characters outside [a-z0-9] with a single "-"
  3. Trim leading and trailing "-"
  RETURN the result       # may be "" for an all-punctuation heading; no fallback token
```

**Chosen:** the heading text fed to the rule is pinned too, not just the transform: it is the raw markdown source line of the heading, minus the leading `#`-run and its following whitespace, minus any trailing ATX-closer `#`-run, and nothing else. No rendering, no markup stripping, no entity decoding: inline markup characters (backticks, asterisks, underscores, link brackets) are simply non-alphanumeric runs step 2 collapses, so both sides get the same answer from the same source line by construction. `headingSlug()` takes that extracted text; FAFF-930's assembler indexes the same raw source lines. The same-source invariant is transport fact, not hope: the refuter transport (`review-call.mjs --diff <spec-file>`) sends the spec file's bytes verbatim (no rendering or normalisation pass exists on that path), and FAFF-930's assembler reads the same on-disk spec file — both sides consume one artifact's raw bytes.

Three worked examples (all pinned in the prompts and in the test): `### Aggregation — carry the anchor` → `aggregation-carry-the-anchor`; the run-collapse edge, the step an LLM most plausibly gets wrong — `### Phase 2 — (revised)` → `phase-2-revised` (the ` — (` run and the trailing `)` collapse to single hyphens and trim; never `phase-2--revised` or `phase-2-revised-`); and the inline-markup case — a heading reading `### The ``spec_anchor`` field` → `the-spec-anchor-field` (backticks and the underscore are non-alphanumeric runs; no markup stripping happens first).

This is not an invented dialect: steps 1-3 are byte-identical to the transform the codebase already uses in `adr.js` line 60, `decisions.js` line 46, and `prd.js` line 44 (`toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`); those sites additionally apply a trailing `.slice(0, 80)` and a fallback token, both filename concerns. **Chosen:** the anchor rule carries no length cap and no fallback token. The consumer indexes headings, not filenames, so a cap would make two long headings colliding on an 80-char prefix indistinguishable, and an LLM producer cannot be trusted to reproduce a truncation boundary. A degenerate heading yields `""` honestly rather than a fabricated token that could false-match.

**Chosen:** the rule is pinned in two homes, one per medium. Prose: one bullet in each refuter prompt (the producers are LLMs; they cannot call code). The bullet's rule sentence is quoted here verbatim, and this exact sentence (with the three worked examples) is what all six files carry and what the prose-identity test asserts:

> spec_anchor: the heading slug of the spec section this objection attacks. Derive it from the heading's raw markdown line (drop the leading hash marks and surrounding whitespace, strip nothing else): lowercase; replace every run of characters outside a-z0-9 with a single hyphen; trim leading and trailing hyphens. Omit the field entirely if you cannot name one section.

Code: a new consumer-side module `plugin/skills/faff/bin/lib/heading-slug.js` exporting `headingSlug()`, with the region annotation every `bin/lib` file carries, sited beside the other spec-review consumer libs (`spec-judge-evidence.js`, `spec-review-churn.js`) so FAFF-930's assembler imports it. Not in `aggregate.mjs`: the aggregator only carries the field, never derives it, and a cross-skill import would break the per-skill symlinked install. A unit test asserts all three worked examples the prompts cite round-trip through `headingSlug()` exactly, so the two homes cannot drift without a red test.

**Chosen:** consumer adoption is pinned as far as anything can pin an unbuilt consumer, in three mechanical places rather than a hope. (1) `heading-slug.js`'s header comment names it the single rule home for the `spec_anchor` join key: the FAFF-930 assembler imports `headingSlug()` and never re-derives the rule. (2) The schema `description`'s enrichment note names `heading-slug.js` as the canonical derivation, so the contract surface itself points every future consumer at the one home. (3) The tracker already encodes the direction: FAFF-930 is blocked-by FAFF-943 and re-preps on the shipped field once this lands, so its spec is written against this rule home, not from memory. Residual honesty: a future author can still ignore all three signposts; no artifact shipped here can force an unwritten ticket's code, and the zero-match path keeps that failure soft. The same header comment also names the capped filename slugs (`adr.js`, `decisions.js`, `prd.js`) as the OTHER dialect and says which to use when, so the two-dialect confusion has a signpost at the exact place a future author would import from. That residual is why FAFF-930's own DONE, not this one, is where end-to-end binding is asserted.

**Chosen:** a lens that cannot name the attacked section omits `spec_anchor` entirely; there is no sentinel. FAFF-935's `"not separately stated"` sentinel exists because an absent `predicted_consequence` and a taste-level one mean different things. Here they do not: absence is the signal, and FAFF-930 already defines the absence path (the assembler derives the anchor from cited sections, and a zero-match falls to `orchestrator:undefended`). A sentinel slug would just be a guaranteed zero-match with extra steps.

**Anti-pattern:** stating the slug rule only in one shared document the refuters never see. Why: each refuter receives only its own `refute-<lens>.md` as `--system`; a rule outside that file does not reach the producer.

### Contract — schema and validator mirror FAFF-935

**Chosen:** one more optional key at each of the two contract points, exactly the FAFF-935 shape.

- `spec-review-verdict.schema.json`: add `"spec_anchor": { "type": "string" }` to the objection item's `properties` (mandatory, since `additionalProperties: false` would otherwise reject it); `required` and everything else unchanged. Extend the schema `description`'s enrichment note to name the anchor and `bin/lib/heading-slug.js` as its canonical derivation home.
- `contract-defs.js` `computeSpecReviewVerdict`: extend the copied-field list `["claim", "evidence", "predicted_consequence"]` to include `"spec_anchor"`, so a string value is preserved verbatim and an absent or non-string value is omitted, with no violation either way. The lens/severity enum violations, the founded-verdict checks, and `conformant` are untouched. `schemaCheck` runs on the normalised `contractData`, so the schema and the pass-through list are edited together or the self-test goes red.
- The describe surface (`CONTRACT_DESCRIBES`) is unchanged: `spec_anchor`, like the triple, is a free string with no enum row.

### Aggregation — carry the anchor

**Chosen:** `aggregate.mjs` adds `"spec_anchor"` to the carried-field list consumed by `carryTriple` (line 44's `TRIPLE_FIELDS`; renaming the const is the builder's cosmetic choice, the pinned behaviour is the field set). Severity mapping, the `refutedCount`/`anyCritical` tally, the majority gate, and the transport-floor synthesis (`nameLenses`) are unchanged. Transport-floor synthesized objections carry no anchor: a down lens attacked no section, and the field is optional precisely for this.

### Producers — both occupants emit it

**Chosen:** both `spec_review` occupants emit `spec_anchor` per objection, and the documents that describe the shape are synced in the same change:

- The four `refute-<lens>.md` prompts each gain one bullet in the per-objection output block, after `predicted_consequence:`, carrying the canonical rule sentence (the blockquote above) with the three worked examples. One bullet, mirroring the existing near-identical-across-lenses bullet style, so `faff validate-adapters`' line caps hold.
- `faffter-dark-spec-review/SKILL.md`: the Refutation JSON entry shape (the `{ severity, claim, evidence, predicted_consequence, summary? }` example near line 144) gains `spec_anchor`; the enrichment paragraph below it and the per-round transcript note (line 135, "the optional enrichment triple") are reworded to "the optional enrichment fields (the FAFF-935 triple plus `spec_anchor`)".
- `faffter-noon-spec-review/SKILL.md`: the enrichment-triple paragraph (line 40) gains the anchor and its omit rule; at least one contract-block example carries a `spec_anchor` value.

**Anti-pattern:** paraphrasing the derivation rule differently per file. Why: the producer/consumer agreement is the whole point; every statement of the rule uses the same wording and the same worked examples. The oracle is deliberately not self-referential: because the test's reference is extracted from the committed spec document (above), weakening the oracle requires editing the spec's own blockquote in the same reviewable diff — the PR diff is the second, structurally different guard; a test-only edit cannot silently change what is asserted. This identity is mechanically checked, not review-hoped: the heading-slug unit test reads all six edited prompt/SKILL files and asserts each contains the canonical rule sentence quoted above (the pinned reference lives in the test as a literal, not in the builder's head) and all three worked-example slug strings verbatim, so a paraphrase goes red, exactly as a code drift does.

### Carry-through — already verbatim

**Assumes:** `spec-judge-evidence.js` needs no code change. It pushes `rec.objections` verbatim into `rounds[]` and `standing_objections`, and its arithmetic (`infosecMajorFree`, `blocker_free_latest` via convergence) reads only `lens`/`severity`. Validation instruction: confirm `rounds.push(... objections: rec.objections ...)` and `infosecMajorFree` still match this before building; a new test asserts the anchor's pass-through either way.

**Assumes:** faff-prep writes `round-<n>.json` as the `{verdict, objections}` it parsed from the validated contract block, so the anchor reaches the round record with no new write path. Validation instruction: same consumer-fold FAFF-935 shipped through; confirm no prep-side field allowlist was added since (grep the prep round-record write for field filtering).

### Back-compat and fixtures

**Chosen:** the fixture matrix covers three record generations and three slug outcomes.

Records (contract golden table + aggregate selftest + judge-evidence tests):
- legacy-only: `{lens, severity}`, validates exit 0, gates identically, no new keys appear;
- triple-only: FAFF-935 shape without an anchor, unchanged behaviour (the existing fixtures already cover this; they stay green untouched);
- triple+anchor: all four optional fields round-trip verbatim; plus anchor-only (anchor without triple), a non-string `spec_anchor` dropped with no violation, and an empty-string `spec_anchor` carried verbatim with no violation (the edge case below, exercised through validator and aggregate, not just stated).

Slugs (the new heading-slug test):
- a matching slug: `headingSlug` on a fixture heading equals the objection's anchor, including all three worked examples verbatim;
- a missing field: an objection without `spec_anchor` carries no such key after validator and aggregate (the FAFF-930 absence path's precondition);
- a no-match slug: an anchor matching no fixture heading still validates and carries verbatim; binding failure is the consumer's zero-match path, never a producer-side error.

### Edge cases

- Non-string `spec_anchor` (number, null, object): dropped by validator and aggregate, no violation, verdict unchanged (mirrors the triple).
- Empty-string anchor: carried verbatim; the validator never inspects values. Resolves downstream as a zero-match. Covered by a fixture (Back-compat and fixtures), not just stated.
- Duplicate heading slugs in one spec: already ruled on by the consumer's own spec, not left dangling — FAFF-930's round-4 anchor rule concatenates same-slug blocks in document order (deterministic, order-stable), so a repeated slug binds to the union of its sections' defences rather than the wrong single one; a spec whose duplicate headings carry genuinely different defences is a spec-authoring smell the judge sees as a concatenated defence, never a silent wrong pick. `headingSlug` stays a pure text function.
- Legacy round records mixed with anchored ones in one window: churn and convergence read only lens/severity/count and are already defensive against extra fields; output is byte-identical.

### Failure modes

- **The failure:** the refuters, being LLMs, drift from the pinned slug wording (title text instead of a slug, a truncated slug, the wrong section). How you'd know, in-repo and before FAFF-930 exists: the per-lens transcripts (`round-<n>-<lens>.md`) and the round records (`round-<n>.json`) persist every emitted anchor beside the spec it attacks, so an operator (or a later mechanical pass) can check emitted anchors against `headingSlug()` over the spec's own headings from this ticket's artifacts alone; FAFF-930's rounds later add the running `orchestrator:undefended`/derive-fallback rate, and FAFF-938 (the deterministic producer-boundary parser, related) is the extension point that would validate the field mechanically at emit time. What it means: fix the prompt wording, not the gate; the absence path already makes drift degrade soft, never wrong. Residual honesty: no build-time gate can prove an LLM applied the rule to the right section. The transcripts make it auditable, FAFF-938 is the named mechanical-validation extension point, and the soft-degrade path bounds the damage; that residual is accepted, not overlooked.
- **The failure:** FAFF-930's assembler lands somewhere that cannot import `bin/lib/heading-slug.js`. How you'd know: at FAFF-930 build time, the import does not resolve from the assembler's home. What it means: move or re-export the helper then; the rule's test keeps the behaviour portable either way.

## Scenarios

```
Given a refuter objection { severity: "major", claim, evidence, predicted_consequence,
      spec_anchor: "aggregation-carry-the-anchor" }
When it passes through aggregate.mjs, the contract validator, a round-<n>.json record,
      and faff spec-judge-evidence
Then the bundle's standing_objections entry carries spec_anchor verbatim,
      and the verdict, blocker_free_latest, and infosec_major_free_latest are
      identical to the same run without the anchor
```

```
Given a legacy round record whose objections carry only {lens, severity}
When it is validated, and churn/convergence run over a window containing it
Then validation exits 0 with no spec_anchor key introduced,
      and churn/convergence output is byte-identical to today
```

```
Given the worked example heading "### Aggregation — carry the anchor"
When headingSlug() is applied to its text
Then the result is exactly "aggregation-carry-the-anchor",
      the same string the producer prompts cite
```

- The majority rule, severity veto, and arithmetic floors MUST be decided by `{lens, severity}` alone; no test asserting a gating outcome changes in this ticket.

## 6. Design decision rationale

| Decision (marker above) | Rejected alternative | Why rejected |
|---|---|---|
| Optional field on the objection entry | Sidecar store; required field | No join key exists for a sidecar; required breaks legacy records and synthesized objections |
| Slug rule without the 80-char cap | Reuse `adr.js`'s capped filename slug verbatim | Cap and fallback are filename concerns; prefix collisions and LLM-side truncation errors for no benefit |
| Prose pin in prompts + code pin in `bin/lib/heading-slug.js` | Rule only in prompts; helper inside `aggregate.mjs` | Prompt-only leaves nothing to test against; `aggregate.mjs` never derives slugs and cross-skill imports break the symlinked install |
| Omit when unnameable | A sentinel string, per FAFF-935's `"not separately stated"` | Absence already is the signal here; FAFF-930 defines the absence path; a sentinel is a guaranteed zero-match |
| Fixture matrix as specified | Only a happy-path anchored fixture | The back-compat guarantee is the contract; legacy and no-match paths are where regressions would hide |

At the time of writing, FAFF-930's assembler does not exist; the helper's home was picked to match where the other spec-review consumer libs live.

## 7. Open questions and assumptions

Open questions: none.

Assumptions (collected from HOW, each with its validation instruction there):
- `spec-judge-evidence.js` passes objections through verbatim and reads only lens/severity for arithmetic; confirmed against the current file, re-confirm at build, and a test asserts it.
- faff-prep's round-record write is the unfiltered consumer-fold FAFF-935 shipped through; grep for any later-added field allowlist before building.

## 8. Done

### From WHAT (contract shape)
- [ ] `spec-review-verdict.schema.json` objection items permit `spec_anchor` as an optional string; `required` stays `["lens", "severity"]`, `additionalProperties: false` lists it; a legacy objection still passes `schemaCheck`.
- [ ] `computeSpecReviewVerdict` copies `spec_anchor` when present as a string, omits it otherwise, adds no violation for it; enum violations, founded-verdict checks, and `conformant` unchanged. Golden fixtures: triple+anchor exit 0, anchor-only exit 0, non-string anchor dropped exit 0, empty-string anchor carried verbatim exit 0, legacy exit 0.

### From HOW (slug discipline)
- [ ] `plugin/skills/faff/bin/lib/heading-slug.js` exports `headingSlug()` implementing exactly the pinned rule (no cap, no fallback token), with a region annotation and a header comment naming it the single rule home for the `spec_anchor` join key (FAFF-930's assembler imports it, never re-derives); its unit test covers all three worked examples verbatim (including the multi-character punctuation-run collapse and the inline-markup case), the pinned heading-text extraction (leading/trailing hash-runs dropped, markup kept), a matching slug, a missing field, and a no-match slug.

### From HOW (aggregation and producers)
- [ ] `aggregate.mjs` carries `spec_anchor` verbatim when a string, omits otherwise; verdict, tally, and transport-floor synthesis unchanged; `--selftest` and `test/spec-refute-aggregate.test.mjs` cover anchored, bare, non-string, and synthesized cases.
- [ ] All four `refute-<lens>.md` prompts and both occupant `SKILL.md` files state the anchor field, the canonical rule sentence (quoted in HOW) with all three worked examples, and the omit rule; `faff validate-adapters` green on every edited file; the heading-slug unit test holds the FULL canonical bullet (rule sentence AND its closing omit sentence, 'Omit the field entirely if you cannot name one section.') as a test literal and asserts it, plus all three worked examples as input-output PAIRS — both the input heading text ('Aggregation — carry the anchor', 'Phase 2 — (revised)', 'The `spec_anchor` field') and its output slug ('aggregation-carry-the-anchor', 'phase-2-revised', 'the-spec-anchor-field') held as literals — appear verbatim in all six files. A prompt that drops the omit sentence, a heading input, or a slug output goes red. The reference is not a builder paraphrase and not even a test-authored literal: the test READS the canonical bullet out of the committed spec document itself (the single blockquote in this section of `records/specs/<this spec>-design.md`, extracted by its `> spec_anchor:` prefix) and asserts THAT extracted sentence appears verbatim in all six files — so spec, test, and prompts are pinned to one physical source and a paraphrase anywhere in the chain goes red (the mechanical prose-identity oracle). The six files are pinned in the test as an enumerated literal list (the four `refute-<lens>.md` files and the two occupant `SKILL.md` files by exact path), never a glob — a renamed or added prompt file changes the list in the same diff or the test goes red on the missing path.

### From HOW (carry-through and back-compat)
- [ ] A `round-<n>.json` fixture with anchored objections yields `standing_objections` carrying `spec_anchor` verbatim; a legacy fixture assembles and gates identically (`blocker_free_latest`, `infosec_major_free_latest`); churn and convergence byte-identical on legacy vs anchored — asserted mechanically, not stated: a named fixture pair (the same round records with and without `spec_anchor` on each objection) is run through `faff spec-review-churn` and `faff spec-review-convergence` and the two stdout strings are compared for strict equality (`test/spec-judge-evidence.test.mjs` or the churn/convergence test files).
- [ ] No gating assertion changes anywhere: existing majority/floor tests untouched and green.

### Gates
- [ ] `faff validate-adapters`, `faff lint-refs`, `faff lint-cli-doc`, `faff adr validate`, `faff prdr validate`, `faff regions check`, and the unit suite (`node --import ./test/hermetic-env.mjs --test`) all green.

Integration smoke test:

```
PROCEDURE smoke():
  1. Build one Refutation with an objection carrying the triple + spec_anchor "s"
  2. Pipe [it, three clears] through aggregate.mjs --n 4 → block validates via
     faff contract spec-review-verdict, objections[0].spec_anchor == "s"
  3. Write the validated {verdict, objections} as round-1.json in a temp dir
  4. Run faff spec-judge-evidence over the dir → bundle.standing_objections[0].spec_anchor == "s"
  5. Assert the verdict at step 2 equals the same input without spec_anchor
```

confidence: high
spec-review: accept (judge, L3-provisional)
build-tier: complex
