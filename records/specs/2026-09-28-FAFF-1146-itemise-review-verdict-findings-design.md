# Spec — FAFF-1146: itemise review-verdict findings with severity / refutation / disposition / discovering-model

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1146.

This is the build spec for FAFF-1146. It is written for the build agent that will implement it and for human reviewers. It enriches the fixed `review-verdict` contract so each entry in the `findings` array carries a structured shape — at minimum a severity, an adversarial refutation, a disposition, the model that found it, and a source discriminator — covering both the standard code-review pass and the adversarial second-opinion pass, without regressing any existing verdict.

## 1. WHY — Problem and Principles

**The central model:** a review-verdict's `findings` array is validated today only for two derived booleans per item (`location_present`, `action_present`) — enough to enforce "a fail carries substantiated findings", but it throws away everything the reviewers actually knew: how bad each finding is, whether the adversarial pass refuted it, what was decided about it, which model raised it, and which pass produced it. This spec adds those as **optional, additive per-finding fields**, enforced the same way `spec-review-verdict` already enriches its `objections` (FAFF-935/FAFF-943): enums checked via `violations` (never a fail-loud), unknown-but-typed fields preserved, and every legacy `{location_present, action_present}` item still valid.

**Problem statement:** the `review-verdict` contract requires a `findings` array but pins no per-item shape, so standard findings lose their severity and the adversarial pass's refutations, dispositions, and discovering-model attribution are never captured structurally. This change gives each finding a structured, self-describing shape in the one shared `findings` array. It does so additively, so no already-emitted verdict changes meaning.

**Design principles:**

- **Additive, never gating.** The new fields enrich; they never change which verdicts pass, and they are never read by the merge floor. The existing gating rules (`fail`/`needs-human` must carry ≥1 finding; each finding must have location + action; malformed signal coerces to `needs-human`) are byte-identical after this change. This mirrors `spec-review-verdict`'s FAFF-935/943 enrichment exactly.
- **Enums via violations, not schema fail-loud.** An out-of-enum `severity`, `disposition`, or `source` is a soft violation (exit 1), never a schema fail-loud (exit 2) — matching how `spec-review-verdict` enforces `lens`/`severity` and `prd-readiness` enforces `reason`. A reviewer's echoed bad value must not read as producer breakage.
- **The signal axis and the conformance axis are orthogonal.** Merge routing is a pure function of `signal` (see §4, _Consumer handling_). The soft-enum `violations` this change adds are a **data-quality** axis: surfaced to logs and the terminal review comment, never a merge blocker and never a signal escalation. A non-conformant verdict on a `pass` signal still merges; on a `fail` signal it still iterates. This is what keeps "additive, never gating" true end-to-end, not just at the schema.
- **Attribution is harness-authored, not model-named.** The adversarial pass already establishes that `<provider>/<model>` attribution is stamped by `review-call.mjs`'s `attributionHeader` from the winning backend's provenance (prepended when absent, replaced when a model self-names — never trusted from the model), so a self-named model is never authoritative. The `model` field inherits that guarantee: the assembling occupant copies it from that already-authored header. The contract layer keeps `model` a free string (provider/model pairs are open-ended — no enum, no normalisation step at the contract) precisely because the guarantee is enforced upstream, in the transport, not here.
- **One array, two sources, one discriminator.** Standard and adversarial findings share the single `findings` array (the ticket's explicit requirement). A structural `source` discriminator (`standard` | `adversarial`) rides each finding so a consumer separates the two passes without string-matching `model` — this is the join a future cross-pass correlation extension keys on.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeReviewVerdict`, ~L71–96; describe block ~L3060; SELFTESTS `review-verdict` ~L2533) | JavaScript | The contract validator, its `--describe` text, and its selftest cases — the primary change surface |
| `plugin/skills/faff/contracts/review-verdict.schema.json` | JSON Schema | The reference shape; `additionalProperties:false` means new optional fields MUST be listed here or an enriched verdict fails `schemaCheck` (exit 2) |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeSpecReviewVerdict`, ~L434–478) + `contracts/spec-review-verdict.schema.json` | JavaScript / JSON | The direct precedent: per-item enum-via-violations + optional additive string fields under `additionalProperties:false` (the exact port target) |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`decideFloor`, ~L2332; `FLOOR_REVIEW_VERDICTS`, ~L2243) | JavaScript | The merge floor: it branches solely on the `review_verdict` **signal string** — it never reads `findings[].severity`, `conformant`, or `violations`. This is the ground truth behind the orthogonality principle. |
| `plugin/skills/faffter-noon-review/SKILL.md` (contract block ~L45, mapping ~L110) | Markdown (skill prose) | The default `review` producer; declares the `faff-contract:review-verdict` block it emits |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (findings format ~L52–66; disposition logging ~L74; `attributionHeader` ~L64) | Markdown (skill prose) | The adversarial `review` occupant; emits `### [severity]: [title]` over the exact set `critical/major/minor/observation`, a harness-authored `<provider>/<model>` header, an auto-refutation downgrade to `observation`, and implementor-logged dispositions (`proven false` / `valid + fixed` / `valid + accepted risk`) |
| `plugin/skills/faff/bin/lib/contract-engine.js` (`validateAgainstSchema`, `schemaCheck`) | JavaScript | Enforces `required`, `enum`, `additionalProperties:false`, `items` — the mechanism the schema change rides on |

**Scope statement:** this sits at the `review` slot's contract boundary — the fixed shape every code-review pass emits and faff-graft Step 9 / the merge floor branch on.

## 2. OUT OF SCOPE

- **Disposition round-trip through a re-emitted contract block.** The authoritative, durable disposition record stays the graft Step 9 collapse-and-log terminal review comment (gateway → Review-findings comment identity). This spec carries `disposition` as best-known-at-verdict-emit-time; it does not add a second contract emission after the implementor finishes dispositioning. **Extension point:** a future issue could re-pipe an updated verdict block from faff-graft Step 9 once dispositions settle — `faffter-dark-adversarial-review/SKILL.md` "How findings are handled".
- **Changing verdict semantics or the signal enum.** `{pass, fail, needs-human, unavailable}` and all coercion/gating rules are untouched. **Extension point:** the gateway review-verdict contract (ADR-0001, Decision 4).
- **New adversarial detection categories or a stronger adversarial gate.** The refutation content and severity vocabulary this spec captures are what the adversarial pass already produces. **Extension point:** `faffter-dark-adversarial-review/SKILL.md` review categories.
- **Migrating existing stored verdicts.** No back-fill; legacy `{location_present, action_present}`-only items remain valid by construction, so there is nothing to migrate. **Extension point:** none needed.
- **A per-finding stable ID / cross-pass finding correlation.** Deduping a standard finding against the adversarial finding that refers to the same defect is not modelled here — but the new `source` discriminator is the structural anchor a follow-up correlation pass keys on. **Extension point:** a `finding_id` field, same additive pattern, in a follow-up.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Standard finding | A finding raised by the primary code-review pass (`faffter-noon-review` or its Phase-1 delegate); `source: "standard"` |
| Adversarial finding | A finding raised by the Phase-2 second-opinion pass in `faffter-dark-adversarial-review`, served by a structurally different model; `source: "adversarial"` |
| Refutation | The adversarial challenge to a finding — e.g. the auto-refutation downgrade's evidence line, or a reviewer's counter-argument |
| Disposition | What was decided about a finding at verdict-emit time (see enum below) |
| Assembling occupant | Whichever `review` slot occupant emits the final `faff-contract:review-verdict` block — the default producer, or the adversarial occupant that folds both passes' findings into one array |

**Enums (all enforced in the compute fn via `violations`, never JSON-Schema `enum`):**

- `SEVERITY_ENUM = { critical, major, minor, observation }`
- `DISPOSITION_ENUM = { fixed, refuted, accepted-risk, open }`
- `SOURCE_ENUM = { standard, adversarial }`

**Enriched finding shape (contract data, after `computeReviewVerdict` normalisation):**

```
RECORD Finding:
  location_present: Boolean        # REQUIRED — unchanged; derived "named a code location"
  action_present:   Boolean        # REQUIRED — unchanged; derived "named a concrete action/fix"
  severity:         String?        # OPTIONAL — enum-checked via violations against SEVERITY_ENUM
  refutation:       String?        # OPTIONAL — adversarial challenge text; free string, preserved when present
  disposition:      String?        # OPTIONAL — enum-checked via violations against DISPOSITION_ENUM
  source:           String?        # OPTIONAL — enum-checked via violations against SOURCE_ENUM
  model:            String?        # OPTIONAL — "<provider>/<model>" or a primary-reviewer handle; free string

  # Preservation rule (mirrors computeSpecReviewVerdict, contract-defs.js ~L461-467):
  #   an enum-checked field (severity/disposition/source) is copied when present: a valid value
  #   passes through, an out-of-enum value is preserved in string form (or "" if non-string) AND
  #   pushes a violation naming the finding index. A free-string field (refutation/model) is copied
  #   ONLY when present as a string; absent or non-string → omitted, never defaulted.
  #   location_present/action_present stay coerced booleans exactly as today.
```

**Envelope (unchanged):** `{ signal, findings, conformant, violations }`. `signal` ∈ `{pass, fail, needs-human, unavailable}`; `conformant`/`violations` computed as today plus the new soft-enum checks.

**Schema surface (`review-verdict.schema.json`):** `findings.items` gains the five optional properties (`severity`, `refutation`, `disposition`, `source`, `model`, all `{"type":"string"}`) alongside the two existing required booleans, still under `additionalProperties:false`. `required` stays `["location_present","action_present"]`. This is a hard co-requirement so an enriched verdict passes `schemaCheck` — the compute fn and schema MUST move together (the same coupling `spec-review-verdict` maintains).

**Producer contract-block surface (skill prose):**

- `faffter-noon-review/SKILL.md` — the declared `faff-contract:review-verdict` block extends each finding to optionally carry `severity`/`disposition`/`source`/`model` (a single-model in-session pass sets `source: "standard"`, one `model`, and no `refutation`; all optional, so an un-updated emit still validates).
- `faffter-dark-adversarial-review/SKILL.md` — states how the two passes' findings fold into one array: standard findings from Phase 1 (`source: "standard"`), adversarial findings from Phase 2 (`source: "adversarial"`) each carrying `severity` (already in its `### [severity]:` prose), `refutation` (the auto-refutation evidence line or reviewer counter), `model` (from the harness-authored `attributionHeader`, never self-named), and `disposition` (best-known at emit — e.g. auto-refuted → `refuted`; otherwise `open`).

## 4. HOW — Behavior

**Approach.** Port the `computeSpecReviewVerdict` enrichment pattern onto `computeReviewVerdict`. The gating logic is untouched; a mapping step over each finding adds the optional fields and appends a soft violation for an out-of-enum `severity`/`disposition`/`source`.

```
PROCEDURE computeReviewVerdict(extraction):   # additions only; existing steps unchanged
  1. (unchanged) reject non-object extraction -> failLoud
  2. (unchanged) coerce out-of-enum signal -> needs-human + violation
  3. raw := extraction.findings if array else []
  4. FOR each raw finding f at index i:
     a. location_present := !!f.location_present ; action_present := !!f.action_present   # unchanged
     b. out := { location_present, action_present }
     c. FOR (field, ENUM) in [(severity, SEVERITY_ENUM), (disposition, DISPOSITION_ENUM), (source, SOURCE_ENUM)]:
          IF f[field] present:
            IF f[field] is a string AND in ENUM -> out[field] := f[field]
            ELSE -> out[field] := (string form or "") ; violations.push(`finding[i] <field> <v> not in {ENUM}`)
     d. IF f.refutation is a string -> out.refutation := f.refutation      # free string, no enum, no violation
     e. IF f.model is a string      -> out.model := f.model                # free string, no enum, no violation
     f. append out to findings
  5. (unchanged) IF signal in {fail, needs-human} AND findings empty -> violation "<signal> carries no findings"
  6. (unchanged) FOR each finding: if !location_present -> violation; if !action_present -> violation
  7. return { signal, findings, conformant: violations.length==0, violations }
```

**Behavior summary:** the function still answers "is this verdict conformant, and what are its violations?" — it now additionally carries per-finding severity/refutation/disposition/source/model through to the contract data, and flags an out-of-enum severity/disposition/source as a soft violation rather than dropping it silently or fail-louding.

**Consumer handling of a non-conformant verdict (the resolved architectural objection).** The merge floor `decideFloor` (`contract-defs.js` ~L2335) branches on **one string** — `f.review_verdict`, the extracted `signal` — and blocks on anything ≠ `pass`. It never reads `findings[].severity`, `conformant`, or `violations`. faff-graft Step 9 is the consumer: it locates the block, pipes it to `faff contract review-verdict`, and routes on the extracted `signal` (an out-of-enum **signal** — never an out-of-enum severity/disposition/source — is what coerces to `needs-human`). Therefore:

- **A new soft-enum violation (out-of-enum `severity`/`disposition`/`source`) never changes the merge decision.** On a `fail` verdict it still iterates; on a `pass` verdict it still merges; the `signal` the floor reads is untouched by the enrichment. The violation is surfaced (logged to `graft.md` and folded into the terminal review comment's summary) as a data-quality note — loud, never silent, never a park.
- **The consumer MUST NOT treat an enrichment-caused exit-1 as a park.** Doing so would make the enrichment gating — the exact regression this design forbids. Only the pre-existing conformance signals (a `fail`/`needs-human` with no findings, a finding missing location/action) carry their existing meaning, and even those route through the unchanged `signal`, not through a blanket "exit-1 → park".
- **`merge-gate` re-validation is unchanged.** Step 9 persists `{signal, findings}` to `review-verdict.json`; `faff merge-gate` re-reads and re-pipes it through the same `faff contract review-verdict` rule, and `decideFloor` again reads only the signal. An enriched finding round-trips through that artifact unchanged (the extra optional fields are preserved but never consulted by the floor).

**Edge cases and error handling:**

- **Legacy finding** (`{location_present, action_present}` only) → no new field set, zero new violations, exit unchanged. (Backward-compat floor.)
- **Out-of-enum `severity`/`disposition`/`source`** → the value is preserved in string form (or `""` if non-string) AND a violation naming the finding index is appended → `conformant:false` → exit 1. Never exit 2, never a merge block, never a signal escalation.
- **Non-string `refutation`/`model`** → omitted (not copied), no violation — same tolerance as the `spec-review-verdict` triple.
- **`unavailable` / `pass` with `findings: []`** → unchanged; the map is a no-op over an empty array.
- **`additionalProperties:false` mismatch** → if the schema is NOT updated in lockstep, an enriched-but-valid verdict fails `schemaCheck` (exit 2 fail-loud). The schema change is therefore a hard co-requirement, not optional polish.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure:** the compute fn adds fields the schema's `additionalProperties:false` then rejects, turning every enriched verdict into a spurious fail-loud. **How you'd know:** a selftest case with a populated `severity` returns exit 2 instead of 0. **What it means:** the schema and compute fn drifted — fix by listing the optional fields in the schema (this is why they ship together).
- **The failure:** enum enforcement is done in the schema (`enum`) instead of via violations, so a reviewer echoing a slightly-off severity fail-louds (exit 2) and reads as producer breakage rather than a soft non-conformance. **How you'd know:** an out-of-enum severity case returns exit 2, not exit 1. **What it means:** move the enum check into the compute fn's `violations`, per the `spec-review-verdict`/`prd-readiness` precedent.
- **The failure:** a consumer treats the new exit-1 as a park/block, so an out-of-enum severity silently stops a `pass` merging. **How you'd know:** a `pass` verdict with a bad severity fails to merge in an integration run. **What it means:** the orthogonality rule was violated — route on `signal`, surface the violation as data-quality only.

**Anti-pattern:** encoding `severity`/`disposition`/`source` as JSON-Schema `enum` on the field. Why: that makes an out-of-enum value a fail-loud (exit 2), contradicting the "malformed reviewer value → soft violation, never a green light and never producer-breakage" rule the sibling contracts follow.

**Anti-pattern:** making any new field `required`. Why: it breaks every legacy verdict and every not-yet-updated producer, violating the additive floor.

**Anti-pattern:** having the reviewer model name itself in `model`. Why: attribution is harness-authored from backend provenance (`attributionHeader`); a self-named model can be wrong and the existing transport deliberately overrides it.

**Anti-pattern:** letting the new soft-enum violations reach the merge floor. Why: the floor is a pure function of `signal`; routing enrichment conformance into it turns an additive field into a gate.

## 5. SCENARIOS — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a review-verdict extraction with signal "fail" and one finding
      { location_present: true, action_present: true, severity: "major",
        refutation: "node --check passed on the cited file", disposition: "refuted",
        source: "adversarial", model: "gemini/gemini-2.0" }
When it is piped to `faff contract review-verdict`
Then the command exits 0 (conformant) and the emitted contract data preserves
     severity, refutation, disposition, source, and model verbatim on that finding
```

```
Given a review-verdict extraction with signal "pass" and one finding
      { location_present: true, action_present: true, severity: "observation",
        source: "adversarial", disposition: "open" }
When it is piped to `faff contract review-verdict`
Then the command exits 0 (conformant) — an adversarial `observation` with an
     undecided `open` disposition is a valid, non-violating enriched finding
```

```
Given a legacy review-verdict extraction whose finding carries only
      { location_present: true, action_present: true }
When it is piped to `faff contract review-verdict`
Then the command exits 0 and the finding is unchanged (backward compatibility)
```

- The `review-verdict.schema.json` `findings.items` schema validates an enriched finding (all five optional fields present as strings) under `additionalProperties:false` without a `schemaCheck` fail-loud.

## 6. DESIGN DECISION RATIONALE

**How should the new per-finding fields be enforced?**
- Options: (a) JSON-Schema `enum`/`required` — rigid, fail-loud on any mismatch; (b) additive optional fields with enum-via-violations, following `spec-review-verdict` FAFF-935/943.
- (a) regresses legacy verdicts and turns reviewer typos into producer-breakage; (b) is the established in-repo pattern for exactly this situation.
- **Chosen:** (b) — additive optional fields; `severity`/`disposition`/`source` enum-checked in the compute fn via `violations`; `refutation`/`model` free strings; `location_present`/`action_present` stay required. Schema lists the optional fields under `additionalProperties:false`. Rationale: backward-compatible by construction and consistent with the sibling contract.

**What is the `severity` enum?**
- Options: (a) reuse the adversarial pass's existing `critical | major | minor | observation`; (b) reuse the `spec-review-verdict` vocabulary `blocker | major | minor`.
- The adversarial producer (`faffter-dark-adversarial-review/SKILL.md` ~L58) already emits exactly `critical/major/minor/observation`, including the auto-refutation downgrade to `observation` and the mandatory `### observation: no findings` clean-review token. Choosing (b) would make **every** ordinary adversarial `observation` an out-of-enum soft violation (exit 1) — a self-inflicted false non-conformance on a well-behaved producer.
- **Chosen:** (a) `SEVERITY_ENUM = { critical, major, minor, observation }`. Rationale: it is what the producers already emit, so no producer prose has to change its severity words and no clean adversarial finding trips a spurious violation.

**What is the `disposition` enum, and is `open` a member?**
- The adversarial skill (~L74) logs three settled outcomes: `proven false` → `refuted`, `valid + fixed` → `fixed`, `valid + accepted risk` → `accepted-risk`. But `disposition` is carried at **verdict-emit time**, when most findings are not yet dispositioned (the durable record is graft Step 9's terminal comment, OUT OF SCOPE).
- Options: (a) enum `{fixed, refuted, accepted-risk}` with undecided ≡ field absent; (b) enum `{fixed, refuted, accepted-risk, open}` with `open` the explicit undecided-at-emit value.
- (a) overloads "absent" to mean both "this pass does not model disposition" (legacy / standard single-pass) and "considered, still open", losing a real distinction; (b) keeps them distinct — a modern adversarial finding can say `open` (considered, pending) while a legacy finding simply omits the field.
- **Chosen:** (b) `DISPOSITION_ENUM = { fixed, refuted, accepted-risk, open }`. Rationale: `open` is the honest best-known value for the common at-emit-time state, it makes Scenario 1's `open` born-verifiable, and it preserves the absent-vs-open distinction while staying additive (a legacy finding still omits the field entirely).

**Is `refutation` required for adversarial findings, or optional everywhere?**
- Options: (a) required for adversarial findings; (b) optional everywhere at the contract layer.
- Standard single-pass findings have no refutation, and the adversarial pass is a soft signal; a contract-level requirement would fail-loud a perfectly valid standard verdict.
- **Chosen:** (b) optional everywhere. Rationale: the additive floor. A "should emit for adversarial findings" expectation, if wanted, is a producer-side convention in `faffter-dark-adversarial-review/SKILL.md`, not a contract gate.

**Is `model` recorded per-finding or per-pass, and does the contract normalise it?**
- The ticket mandates one shared `findings` array holding both standard and adversarial findings; a flat array has no pass object to link a per-pass model to.
- **Chosen:** per-finding `model`, a **free string** the assembling occupant copies from the harness-authored `attributionHeader` (adversarial: `<provider>/<model>`; standard: the primary-reviewer handle), never self-named. The contract does not normalise it — provider/model pairs are open-ended, and the "harness-authored, not self-reported" guarantee is enforced upstream in `review-call.mjs`, not at the contract. Rationale: the only attribution shape that survives the single-array merge, and duplicating a normalisation step at the contract would add surface for no gain.

**Why add a `source` discriminator now rather than deferring it?**
- The ticket's "one shared array" requirement removes the per-pass object a consumer would otherwise use to tell standard from adversarial findings. Without a discriminator, a consumer (and the future cross-pass correlation extension) would have to string-match `model` — brittle and semantically wrong.
- **Chosen:** add optional `source ∈ {standard, adversarial}`, enum-checked-via-violations, additive (absent on legacy). Rationale: it is the structural join the correlation extension point needs, it costs nothing for legacy verdicts, and it is trivially populated by the assembling occupant that already knows which pass each finding came from.

**How is a non-conformant-but-`fail` (or -`pass`) verdict handled downstream?**
- The concern: a finding with an out-of-enum severity yields `conformant:false` + exit 1 — what do faff-graft Step 9 and the merge floor do with it?
- Grounded answer: `decideFloor` reads only the `signal` string (`review_verdict`) and blocks on ≠ `pass`; it never reads `findings[].severity`, `conformant`, or `violations`. graft Step 9 routes on the extracted `signal`, coercing only an out-of-enum **signal** to `needs-human`.
- **Chosen:** the signal axis is authoritative for merge routing; the new soft-enum `violations` are a data-quality axis surfaced to logs and the terminal review comment, never a merge blocker and never a signal escalation. The consumer must not treat an enrichment-caused exit-1 as a park. Rationale: this is the only reading consistent with "additive, never gating", and it matches the existing behaviour (a `pass` with an unsubstantiated finding already merges today, because the floor reads the signal, not conformance).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking. The three enum punts from the prior prep (severity membership, disposition membership incl. `open`, refutation required-ness) and the two reviewer objections (a `source` discriminator, consumer handling of a non-conformant verdict) are all resolved in §6 above, grounded in the producer prose and the merge-floor code cited in §1. No genuine architecture decision remains unresolved.

**Assumptions:**

- **Assumes:** `plugin/skills/faff/bin/lib/contract-engine.js`'s `validateAgainstSchema` honours JSON-Schema optional properties under `additionalProperties:false` (a property not in `required` but listed in `properties` validates whether present or absent). **Validate before starting:** read `validateAgainstSchema` and confirm it only errors on unknown keys and missing `required` keys — the `spec-review-verdict.schema.json` optional-fields precedent already relies on this.
- **Assumes:** the `review` slot occupant is the single assembler of the `findings` array (default producer, or the adversarial occupant folding both passes). **Validate before starting:** confirm `faffter-dark-adversarial-review` returns the `faff-contract:review-verdict` block (it is the `review` occupant when configured) and that `faffter-noon-review` emits it under the default.
- **Assumes:** `decideFloor` and `merge-gate` consume review-verdict via the `signal` string only. **Validate before starting:** re-confirm `decideFloor` (contract-defs.js ~L2335) and the `merge-gate` re-read of `review-verdict.json` read no per-finding enrichment field — the whole non-gating guarantee rests on this.

## 8. DONE — Definition of Done

### From WHY
- [ ] Each `review-verdict` finding can carry `severity`, `refutation`, `disposition`, `source`, and `model`, covering both standard and adversarial findings in the one shared `findings` array.
- [ ] All existing gating/coercion rules (`fail`/`needs-human` ≥1 finding; location+action required; out-of-enum signal → `needs-human`) are byte-identical after the change.
- [ ] The merge floor's decision is unchanged: `decideFloor` reads only `signal`; no new field alters which verdicts merge.

### From WHAT (types and schema)
- [ ] `computeReviewVerdict` preserves `severity`/`disposition`/`source` when present (valid → passthrough, out-of-enum → preserved-string + indexed violation) and `refutation`/`model` only when present as a string; absent fields are omitted, not defaulted.
- [ ] `review-verdict.schema.json` `findings.items` lists the five optional string fields under `additionalProperties:false`, with `required` unchanged at `["location_present","action_present"]`.
- [ ] An enriched finding (all five fields present) passes `schemaCheck` (no exit-2 fail-loud).

### From HOW (behaviour)
- [ ] An out-of-enum `severity`, `disposition`, or `source` yields exit 1 with a violation naming the bad value and the finding index — never exit 2.
- [ ] A non-string `refutation`/`model` is omitted with no violation.
- [ ] A legacy `{location_present, action_present}`-only finding still yields the same exit as before this change.
- [ ] The severity enum admits every value the producers emit — `critical`, `major`, `minor`, `observation` (incl. the auto-refutation downgrade and the `### observation: no findings` clean token) — so no well-formed adversarial finding trips a spurious violation.
- [ ] The soft-enum violations never reach `decideFloor`: a `pass` verdict carrying an out-of-enum severity still merges; a `fail` still iterates (an integration check confirming the floor reads only the signal).

### From HOW (producer prose)
- [ ] `faffter-noon-review/SKILL.md` documents the optional `severity`/`disposition`/`source`/`model` fields in its `faff-contract:review-verdict` block (standard findings → `source: "standard"`).
- [ ] `faffter-dark-adversarial-review/SKILL.md` documents how Phase-1 standard findings (`source: "standard"`) and Phase-2 adversarial findings (`source: "adversarial"`, with `severity`, harness-authored `model`, `refutation`, best-known `disposition`) fold into the single `findings` array.

### From documentation / self-consistency
- [ ] `faff contract review-verdict --describe` output describes the enriched finding fields and the three enums (the describe block in `contract-defs.js` ~L3060).
- [ ] The `review-verdict` SELFTESTS block (`contract-defs.js` ~L2533) gains cases for: an enriched conformant verdict incl. `source` (exit 0), an adversarial `observation`+`open` finding (exit 0), an out-of-enum severity (exit 1), an out-of-enum disposition (exit 1), an out-of-enum source (exit 1), and a legacy finding (exit 0). `faff contract review-verdict --selftest` passes.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (this is a deterministic contract change); no grader `KIND` registration is required.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. echo '{ "signal":"fail",
             "findings":[{ "location_present":true, "action_present":true,
                           "severity":"major", "refutation":"n/a",
                           "disposition":"open", "source":"adversarial",
                           "model":"gemini/g-2.0" }] }' \
       | faff contract review-verdict
  2. ASSERT exit 0 AND stdout contract data echoes severity/refutation/disposition/source/model on the finding
  3. echo '{ "signal":"fail", "findings":[{ "location_present":true, "action_present":true, "severity":"nope" }] }' \
       | faff contract review-verdict
  4. ASSERT exit 1 AND a violation names the bad severity and the finding index (finding[0])
```

confidence: high
build-tier: complex
