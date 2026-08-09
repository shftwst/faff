# Spec — FAFF-265: Spec-review verdict contract + `spec_review` slot scaffold

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive · confidence: high. Full spec on Linear FAFF-265.

This is the buildable design for FAFF-265, the first slice of FAFF-9 (spec-stage adversarial review). Audience: the build agent implementing it, and human reviewers gating the approach. It delivers the *spine only* — a new fixed verdict contract and the slot that emits it — that FAFF-266/267/268 later fill with real review logic.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff already has a proven shape for "an LLM judges, a script validates the judgement's *shape*": a producer emits a fenced `faff-contract:<name>` block, the consumer `JSON.parse`s it and pipes it to `faff contract <name>`, whose exit code (0 pass / 1 violations / 2 fail-loud) is the *sole* source of contract data. FAFF-9's spec-stage review needs its own verdict in exactly this mould. This slice builds that verdict and its slot — and nothing that *reasons* with it yet.

**Problem.** Today nothing reviews the *approach* of a spec before code exists, and there is no verdict vocabulary for it. Without a fixed contract first, the L1–L3 reviewer (FAFF-266), the L4 refuters (FAFF-267), and lens-selection (FAFF-268) would each invent their own shape and drift. This slice freezes the shape so the rest conform to one thing.

**Design principles.**

- **Shape, not judgement.** The contract validates the *form* of a verdict (enum membership, required-field invariants), never whether the review's reasoning was correct. Any check that needs to understand the spec under review belongs to the reviewer (FAFF-266+), not here. Same input → same exit code, always.
- **Clone, don't invent.** Mirror the two closest precedents — `prd-readiness` (FAFF-253) for fail-loud-on-bad-verdict, `review-verdict` (FAFF-78) for the "non-trivial verdict must carry findings" invariant.
- **The seam must be exercisable end-to-end on day one.** The passthrough default producer exists so a `faff config get slots.spec_review` → invoke → emit block → `faff contract spec-review-verdict` round-trip works before any real reviewer is written.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`CONTRACTS` registry; `computePrdReadiness`; `computeReviewVerdict`; `exitFor`; `cmdContract`) | Node (dep-free) | Where the new contract is added + dispatched |
| `plugin/skills/faff/contracts/*.schema.json` | JSON Schema | Where `spec-review-verdict.schema.json` is added; `schemaCheck` validates contractData |
| `bin/faff` `DEFAULTS`, `expected` list, `config resolved` SLOTS, `SLOT_TYPES` | Node | Where the `spec_review` slot is registered |
| `bin/faff` `validate-adapters` `REGISTRY` + `checksFor` | Node | Where the passthrough producer's conformance profile is added |
| `test/golden/contracts/cases.json` + `test/contract-golden.test.mjs` | Node test | Where golden cases for the new contract live |

**Scope.** This is the contract+slot foundation under FAFF-9's spec-stage review; it sits in the faff CLI and slot registry, not in any orchestration flow yet.

## 2. OUT OF SCOPE

- **The real 4-lens reviewer** — the L1–L3 single-pass checklist that examines a spec. *Why:* FAFF-266. *Extension point:* upgrade the `faffter-noon-spec-review` producer (shipped here as passthrough) to run the lenses.
- **Wiring the reviewer into the prep→build-admission seam** — consuming the block in `faff-prep`, the `reject-approach` backward edge. *Why:* FAFF-266. *Extension point:* a consumer-fold in `faff-prep` mirroring faff-graft Step 9's `review-verdict` fold.
- **Adversarial per-lens refuters.** *Why:* FAFF-267. *Extension point:* a `faffter-dark-spec-review` occupant reusing `faffter-dark-adversarial-review`/`review-call.mjs`.
- **Lens-selection / cost-gating by change-surface.** *Why:* FAFF-268. *Extension point:* a selection step ahead of the producer.
- **Severity→verdict mapping logic** (e.g. "a blocker forces `reject-approach`"). *Why:* reviewer judgement (FAFF-266/267), not contract shape. The contract only checks a non-`approve` verdict carries ≥1 objection — not which severity implies which verdict. *Extension point:* the reviewer producer.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Verdict | The fixed outcome of a spec-stage review: `approve` / `revise` / `reject-approach` / `needs-human`. |
| Objection | A single lensed concern on a non-`approve` verdict: a `lens` + a `severity`. |
| Lens | The angle a concern came from: `architectural` / `infosec` / `methodology` / `QA`. |
| Passthrough producer | The no-op default `spec_review` occupant; always emits `approve` with no objections, so the seam round-trips before a real reviewer exists. |

**The extraction the producer emits** (input to `faff contract spec-review-verdict`, via the fenced block, over stdin):

```
RECORD SpecReviewExtraction:
  verdict:    String                # expected in {approve, revise, reject-approach, needs-human}
  objections: List<Objection>       # may be empty; required key (use [] for approve)

RECORD Objection:
  lens:     String                  # expected in {architectural, infosec, methodology, QA}
  severity: String                  # expected in {blocker, major, minor}
```

**The contractData the script emits** (stdout on exit 0/1; the canonical, normalised verdict):

```
RECORD SpecReviewVerdict:           # contractData — schema: contracts/spec-review-verdict.schema.json
  verdict:    String                # one of the four (validated)
  objections: List<Objection>       # echoed; each entry's lens/severity validated (see HOW)
  conformant: Boolean               # == (violations is empty)
  violations: List<String>          # human-readable shape problems
```

**Enums.**

```
Verdict   = { approve, revise, reject-approach, needs-human }
Lens      = { architectural, infosec, methodology, QA }
Severity  = { blocker, major, minor }   # the vocabulary faff already uses in spec self-review + adversarial findings
```

**Design decisions** (full rationale in §6):

- Distinct `spec_review` slot vs reusing `review`. **Chosen:** a **distinct** `spec_review` slot. Different input (a spec, not a diff), different verdict semantics, and a backward-routing edge `review` has no concept of.
- Verdict vocabulary. **Chosen:** `{ approve, revise, reject-approach, needs-human }` as the ticket sketches.
- Bad-verdict handling. **Chosen:** **fail-loud** (exit 2) on a `verdict` outside the enum or a non-object extraction — mirroring `prd-readiness`, because faff's own producer emits this block, so an out-of-enum verdict is producer breakage, not a review outcome.
- Objection shape + bad-lens/severity. **Chosen:** `objections: [{ lens, severity }]`; an out-of-enum `lens`/`severity` is a **violation** (exit 1), value echoed as-is, schema typing them as plain strings (enum enforced in compute) — mirroring `prd-readiness`'s soft `reason` field.
- Founded-verdict invariant. **Chosen:** `approve` ⇒ **zero** objections; `revise`/`reject-approach`/`needs-human` ⇒ **≥1** objection — both directions are violations when broken (mirrors `review-verdict`'s findings invariant).
- Default occupant. **Chosen:** `faffter-noon-spec-review`, a passthrough emitting `approve` + `[]`.

## 4. HOW — Behavior

**Architecture.** Three independent additions, no cross-file coupling beyond the existing registries:

1. **The contract** — `computeSpecReviewVerdict(extraction)` + a `CONTRACTS["spec-review-verdict"]` entry (with inline `fixtures`) + `contracts/spec-review-verdict.schema.json`. Routed by the existing `cmdContract`/`exitFor`.
2. **The slot** — register `spec_review` in `DEFAULTS`, the `expected` self-test list, `config resolved` SLOTS, and `SLOT_TYPES`.
3. **The passthrough producer** — a new skill `faffter-noon-spec-review` whose `SKILL.md` emits a fixed `approve` block; plus its `validate-adapters` `REGISTRY` entry + `producer-spec-review` conformance case.

**Behaviour summary.** Given the producer's extraction JSON on stdin, the script returns a normalised, schema-valid verdict and an exit code that says pass / has-violations / fail-loud.

```
PROCEDURE computeSpecReviewVerdict(extraction):
  1. IF extraction is null / not an object / an array:
       RETURN { contractData: null, failLoud: "extraction must be a JSON object" }
  2. IF extraction.verdict NOT IN Verdict:
       RETURN { contractData: null,
                failLoud: `verdict <v> not in {approve,revise,reject-approach,needs-human} — no safe coerce target` }
  3. verdict := extraction.verdict
  4. raw := extraction.objections IF array ELSE []
       IF objections present and not an array: violations += "objections is not an array — treated as empty"
  5. objections := [] ; violations := (carry from step 4)
     FOR each o, i in raw:
        lens     := (o is object) ? o.lens : undefined
        severity := (o is object) ? o.severity : undefined
        IF lens NOT IN Lens:         violations += `objection[i] lens <lens> not in {architectural,infosec,methodology,QA}`
        IF severity NOT IN Severity: violations += `objection[i] severity <severity> not in {blocker,major,minor}`
        objections += { lens: lens ?? "", severity: severity ?? "" }   # echoed; enum enforced via violations
  6. # founded-verdict invariant
     IF verdict == "approve" AND objections non-empty: violations += "approve carries objections — approve must carry none"
     IF verdict != "approve" AND objections empty:     violations += `<verdict> carries no objections`
  7. contractData := { verdict, objections, conformant: violations.length == 0, violations }
  8. RETURN { contractData, failLoud: null }

PROCEDURE contractSpecReviewVerdict(extraction):   # wrapper, mirrors contractPrdReadiness
  { contractData, failLoud } := computeSpecReviewVerdict(extraction)
  IF failLoud: RETURN { failLoud }
  schemaErr := schemaCheck(contractData, "spec-review-verdict")
  IF schemaErr: RETURN { failLoud: schemaErr }
  RETURN { contractData }
```

Exit codes are the existing `exitFor`: `failLoud` → 2, `violations` non-empty → 1, else → 0. No new exit logic.

**The schema** (`contracts/spec-review-verdict.schema.json`) — `additionalProperties:false`, `required` lists every field; `verdict` is enum-constrained (the field that fail-louds); `lens`/`severity` are plain `string` (enum enforced in compute, so an echoed bad value never trips `schemaCheck` into a spurious fail-loud):

```
object, additionalProperties:false, required [verdict, objections, conformant, violations]
  verdict:    string, enum [approve, revise, reject-approach, needs-human]
  objections: array of (object, additionalProperties:false, required [lens, severity]
                          lens: string, severity: string)
  conformant: boolean
  violations: array of string
```

**The passthrough producer** (`faffter-noon-spec-review/SKILL.md`). Emits, unconditionally:

````
```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```
````

It documents that it is a no-op placeholder upgraded by FAFF-266, and (for `validate-adapters`) that it emits a `faff-contract:spec-review-verdict` block. No lens logic, no spec reading.

**Slot registration** (four touch-points, mirroring every existing slot):
- `DEFAULTS["slots.spec_review"] = "faffter-noon-spec-review"`
- add `"slots.spec_review"` to the `expected` list (`config defaults --selftest`)
- add `"spec_review"` to the `config resolved` SLOTS list
- `SLOT_TYPES.spec_review = { type: "producer-spec-review", slot: "spec_review" }`

**`validate-adapters`** — add `REGISTRY["faffter-noon-spec-review"] = { type: "producer-spec-review" }` and a `checksFor` case:
```
case "producer-spec-review":
  out.push([has("faff-contract:spec-review-verdict"), "emits its `faff-contract:spec-review-verdict` artifact block"])
```

**Edge cases.**
- `objections` key absent → treat as `[]` (only `approve` is then conformant; any other verdict gets the "carries no objections" violation). Not fail-loud — absence is recoverable.
- An objection that isn't an object → its `lens`/`severity` resolve undefined → two violations for that index; echoed as `{lens:"", severity:""}`.
- Empty `violations` + valid enums → exit 0, `conformant:true`.

**Anti-pattern:** enum-constraining `lens`/`severity` in the JSON schema. Why: compute echoes the producer's raw value so the violation message can name it; a schema enum would turn a should-be-exit-1 violation into a spurious exit-2 fail-loud via `schemaCheck`. Compute is the single enforcement point for soft fields (the `prd-readiness.reason` precedent).

**Anti-pattern:** coercing an unknown `verdict` to `needs-human`. Why: it silently masks a broken producer as a legitimate "escalate"; fail-loud surfaces the breakage (see §6).

**Failure modes.**
- **The failure:** the `{lens, severity}` objection shape proves too thin once FAFF-266 lands — e.g. it needs a free-text rationale per objection. **How you'd know:** FAFF-266's spec/build can't express its findings within `{lens, severity}` without adding fields. **What it means:** additive schema change then (a new optional field) — cheap because the contract is small and centralised, not a reason to over-build now. Named so the thin-but-extensible contract is deliberate.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a well-formed approve verdict  { "verdict":"approve", "objections":[] }
When  it is piped to `faff contract spec-review-verdict`
Then  the command exits 0 and stdout is the verdict with conformant:true, violations:[]
```
```
Given a verdict outside the enum  { "verdict":"meh", "objections":[] }
When  it is piped to `faff contract spec-review-verdict`
Then  the command exits 2 (fail-loud) and stderr names the bad verdict + the allowed set
```
```
Given a non-approve verdict with no objections  { "verdict":"reject-approach", "objections":[] }
When  it is piped to `faff contract spec-review-verdict`
Then  the command exits 1 and violations contains "reject-approach carries no objections"
```
```
Given an objection with a bad lens  { "verdict":"revise", "objections":[{"lens":"vibes","severity":"major"}] }
When  it is piped to `faff contract spec-review-verdict`
Then  the command exits 1 and violations names objection[0]'s bad lens (verdict itself stays valid)
```
```
Given the default spec_review slot is unset
When  `faff config get slots.spec_review` is run
Then  it prints "faffter-noon-spec-review" and exits 0 (baked default, FAFF-182)
```

Non-functional assertion: the new contract adds **zero** runtime dependencies (the `bin/faff` dep-free invariant holds).

## 6. DESIGN DECISION RATIONALE

**Distinct `spec_review` slot, or parameterise `review` by stage?**
- *Reuse `review`:* one slot, less surface. Cons: `review`'s input is a diff and its verdict is `pass/fail/needs-human`; a spec review takes a spec and needs `approve/revise/reject-approach/needs-human` + a backward edge. Overloading one slot with two contracts and two input types is the conflation the slot model exists to avoid.
- *Distinct slot:* clean inputs, clean verdict, independently swappable occupant.
- **Chosen:** distinct `spec_review` slot — the design doc's lean, confirmed by the divergent verdict vocabulary.

**Fail-loud vs safe-coerce on an unknown `verdict`?**
- *Coerce to `needs-human`* (the `review-verdict` idiom): never crashes. Con: a buggy producer is silently laundered into a legitimate-looking "get a human" outcome — breakage invisible.
- *Fail-loud* (the `prd-readiness` idiom): exit 2 surfaces producer breakage; the consumer (FAFF-266) treats fail-loud as needs-human anyway, so no fail-safety lost.
- **Chosen:** fail-loud. `prd-readiness` (closest sibling — a readiness/admission gate emitted by faff's own producer) set this precedent. Revisit only if a third-party `spec_review` producer is configured.

**Carry `lens`/`severity`, or reduce to structural booleans like `review-verdict`?**
- *Booleans:* simplest, but discards which lens objected — and the ticket makes "which lens(es) objected and at what severity" part of the verdict.
- *Echo `{lens, severity}`, enum enforced in compute:* keeps what the downstream reviewer/renderer needs while validating shape.
- **Chosen:** echo `{lens, severity}` (the `prd-readiness.reason` soft-field precedent).

**Default occupant name.** **Chosen:** `faffter-noon-spec-review` — follows the `faffter-noon-*` default convention; ships as passthrough now and is the same name FAFF-266 upgrades in place, so the slot default never has to change.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — both ticket open-questions are resolved above (distinct slot; verdict + objection schema settled).

**Assumptions.**
- **Assumes:** the contract-as-code infrastructure (`CONTRACTS`, `schemaCheck`, `exitFor`, `cmdContract`, the golden-test harness) exists as the explore findings verified. *Validate:* `grep -n "computePrdReadiness\|function exitFor\|CONTRACTS = " plugin/skills/faff/bin/faff`.
- **Assumes:** the slot-registration touch-points (`DEFAULTS`, `expected` list, `config resolved` SLOTS, `SLOT_TYPES`) exist as named. *Validate:* `faff config get slots.spec -` returns the default and `grep -n "SLOT_TYPES" plugin/skills/faff/bin/faff`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `spec-review-verdict` contract exists and is the single shape FAFF-266/267/268 conform to (validates shape, performs no spec reasoning).

### From WHAT (types and interfaces)
- [ ] Verdict enum is exactly `{approve, revise, reject-approach, needs-human}`.
- [ ] contractData has `verdict, objections, conformant, violations` and validates against `contracts/spec-review-verdict.schema.json` (`additionalProperties:false`).
- [ ] `objections` entries are `{lens, severity}` with `lens ∈ {architectural,infosec,methodology,QA}`, `severity ∈ {blocker,major,minor}`.

### From HOW (behaviour)
- [ ] Well-formed `approve`/`[]` → exit 0, `conformant:true`.
- [ ] `verdict` outside the enum or non-object extraction → exit 2 (fail-loud), stderr names the bad verdict + allowed set.
- [ ] Non-`approve` verdict with empty `objections` → exit 1, violation "<verdict> carries no objections".
- [ ] `approve` with ≥1 objection → exit 1, violation "approve carries objections".
- [ ] Out-of-enum `lens`/`severity` → exit 1, violation naming the offending `objection[i]` field; verdict stays valid.
- [ ] `CONTRACTS["spec-review-verdict"]` carries inline `fixtures`; `faff contract spec-review-verdict --selftest` passes.

### From HOW (slot registration)
- [ ] `faff config get slots.spec_review` prints `faffter-noon-spec-review` when unset (exit 0).
- [ ] `spec_review` appears in `config defaults --selftest`'s expected list, in `config resolved`'s SLOTS, and in `SLOT_TYPES`.

### From HOW (passthrough producer + conformance)
- [ ] `faffter-noon-spec-review/SKILL.md` emits a fixed `faff-contract:spec-review-verdict` `approve`/`[]` block.
- [ ] `validate-adapters` has a `producer-spec-review` case asserting the block is emitted; `faff validate-adapters` passes for the new producer.

### From WHAT (tests)
- [ ] `test/golden/contracts/cases.json` carries cases for: valid-approve (exit 0), bad-verdict (exit 2), non-approve-no-objections (exit 1), bad-lens (exit 1); `node --test` passes.

### Non-functional
- [ ] `bin/faff` remains dependency-free.

**Integration smoke test:**
```
1. echo '{"verdict":"approve","objections":[]}' | faff contract spec-review-verdict   # expect exit 0, conformant:true
2. printf '%s' "$(faff config get slots.spec_review)"                                  # expect "faffter-noon-spec-review"
3. faff contract spec-review-verdict --selftest                                        # expect all fixtures pass
4. faff validate-adapters                                                              # expect pass incl. faffter-noon-spec-review
```

confidence: high
