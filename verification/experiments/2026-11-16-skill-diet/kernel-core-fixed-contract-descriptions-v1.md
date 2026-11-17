# faff contract review-verdict

The fixed four-value verdict every code-review pass (the `review` slot) emits — what faff-graft's Step 9 and the merge floor branch on. Each finding may additionally carry the optional enrichment fields severity/refutation/disposition/source/model (FAFF-1146), covering both the standard code-review pass and the adversarial second-opinion pass in one shared findings array.

## Values

### `signal`

Enum: `pass`, `fail`, `needs-human`, `unavailable`

| Value | Meaning |
|---|---|
| `pass` | diff matches spec, ACs covered, no flagged items — proceed to merge |
| `fail` | fixable issues found (failing tests, missing coverage, obvious bugs, scope creep) — iterate and re-review |
| `needs-human` | genuine human judgement required (product call, security/privacy concern, irreversible side effect, spec gap) — park, no auto-merge |
| `unavailable` | no review verdict could be produced — a review-chain outage (provider down), not a verdict about the work; never treated as pass |

### `findings[].severity`

Enum: `critical`, `major`, `minor`, `observation`

| Value | Meaning |
|---|---|
| `critical` | a severe defect |
| `major` | a significant defect |
| `minor` | a small defect |
| `observation` | a non-defect note (also the adversarial pass's clean-review token and its auto-refutation downgrade) |

### `findings[].disposition`

Enum: `fixed`, `refuted`, `accepted-risk`, `open`

| Value | Meaning |
|---|---|
| `fixed` | the finding was addressed in the diff |
| `refuted` | the finding was challenged and shown to be a non-defect |
| `accepted-risk` | the finding is valid but accepted as a known risk |
| `open` | undecided at verdict-emit time (the durable disposition record is graft Step 9's terminal comment) |

### `findings[].source`

Enum: `standard`, `adversarial`

| Value | Meaning |
|---|---|
| `standard` | raised by the primary code-review pass |
| `adversarial` | raised by the adversarial second-opinion pass (a structurally different model) |

## Coercion & fail direction

Exit codes: `0` conformant · `1` violations · `2` fail-loud.

- an out-of-enum signal → coerced to needs-human (never pass) — a malformed verdict never reads as a green light
- a fail/needs-human signal with zero findings → conformant:false (exit 1)
- an out-of-enum finding severity/disposition/source → conformant:false (exit 1, not fail-loud — an echoed bad value on an additive soft field, the value preserved verbatim); the merge floor still branches only on `signal`, so it never blocks or escalates the merge

## Envelope

- `signal` (string, required) — one of {pass, fail, needs-human, unavailable}
- `findings` (array, required)
- `conformant` (boolean, required)
- `violations` (array, required)
- `schema_version` (integer, optional)
- `rounds_total` (integer, optional)
- `round_history` (string, optional) — one of {recorded, terminal-only}
- `adversarial_outcome` (string, optional) — one of {chain-outage-skipped}
- `admitted_by` (string, optional) — one of {build-judge}

## Producer notes

- the producer never self-reports `unavailable` — that signal is the orchestrator's own outage detection (FAFF-405), not something a reviewer LLM emits about its own run
- refutation, disposition_rationale and model are optional free strings (no enum, no violation); `disposition_rationale` is the reasoning/commentary behind the disposition (producers SHOULD emit it alongside `disposition`, especially for `accepted-risk`/`refuted`); `model` is the harness-authored `<provider>/<model>` attribution copied from review-call.mjs's attributionHeader, never a self-named model


# faff contract spec-review-verdict

The fixed spec-stage review verdict every spec_review slot occupant emits — what faff-prep's readiness gate and the L1–L4 review lenses (architectural/infosec/methodology/QA) all map onto.

## Values

### `verdict`

Enum: `approve`, `revise`, `reject-approach`, `needs-human`, `unavailable`

| Value | Meaning |
|---|---|
| `approve` | the spec is ready to build as written — carries no objections |
| `revise` | fixable objections exist — the spec needs changes before it's build-ready |
| `reject-approach` | the whole approach is unsound — a different design is needed, not a patch |
| `needs-human` | a human judgement call the reviewer can't resolve on its own |
| `unavailable` | a mandatory spec-review outage whose outaged lens(es) could swing the verdict — the reviewer was down, not a verdict about the spec; never coerced toward approve (FAFF-900) |

### `objections[].lens`

Enum: `architectural`, `infosec`, `methodology`, `QA`

| Value | Meaning |
|---|---|
| `architectural` | a structural/design-fit objection |
| `infosec` | a security or privacy objection |
| `methodology` | a delivery-process or sequencing objection |
| `QA` | a testability or verification-coverage objection |

### `objections[].severity`

Enum: `blocker`, `major`, `minor`

| Value | Meaning |
|---|---|
| `blocker` | must be resolved before the spec can be built |
| `major` | should be resolved but isn't necessarily build-blocking on its own |
| `minor` | a nice-to-fix, not build-blocking |

### `objections[].disposition`

Enum: `fixed`, `refuted`, `accepted-risk`, `open`

| Value | Meaning |
|---|---|
| `fixed` | the objection was addressed by a spec revision |
| `refuted` | the objection was challenged and shown not to hold |
| `accepted-risk` | the objection is valid but accepted as a known risk |
| `open` | undecided at evidence-persist time (not emitted on the cleared-gate path this feature persists on) |

## Coercion & fail direction

Exit codes: `0` conformant · `1` violations · `2` fail-loud.

- an out-of-enum verdict → fail-loud (exit 2) — no safe coerce target, faff's own producer emits this
- approve declared with any objections, or a non-approve verdict declared with zero objections → conformant:false
- an out-of-enum objection lens/severity → conformant:false (not fail-loud — an echoed bad value on a soft field)
- an out-of-enum objection disposition → conformant:false (exit 1, not fail-loud — an echoed bad value on an additive soft field, the value preserved verbatim); this contract is audit-only evidence, so it gates no merge

## Envelope

- `verdict` (string, required) — one of {approve, revise, reject-approach, needs-human, unavailable}
- `objections` (array, required)
- `schema_version` (integer, optional)
- `rounds_total` (integer, optional)
- `final_verdict` (string, optional) — one of {approve, revise, reject-approach, needs-human, unavailable}
- `conformant` (boolean, required)
- `violations` (array, required)

## Producer notes

- refutation and disposition_rationale are optional free strings on an objection (no enum, no violation); `disposition_rationale` is the reasoning behind the disposition. FAFF-1157 persists these as anchored evidence at prep's terminal review seam — they are populated only on the judge path (which produces a correction/AFFIRM rationale); the refuter revise-loop path stamps `disposition:"fixed"` mechanically with no free text


# faff contract delivery-outcome

The fixed three-value outcome the `ship` producer emits after attempting to merge/deploy — what faff-graft routes the caller-facing return on.

## Values

### `outcome`

Enum: `shipped`, `not-ready`, `failed`

| Value | Meaning |
|---|---|
| `shipped` | merged (and deployed, if the producer is deploy-capable) — corroborated by the producer's own result |
| `not-ready` | the merge was deferred without merging — a deploy-readiness tier or a delivery precondition (push/token-scope/merge-method/actions-policy) blocked it; retry-later, not a defect |
| `failed` | merge conflict, deploy error, or an unmappable result coerced to failed |

## Coercion & fail direction

Exit codes: `0` conformant · `1` violations · `2` fail-loud.

- an out-of-enum outcome → coerced to failed (never shipped)
- outcome:shipped with corroborated:false → coerced to failed — an uncorroborated shipped claim is never trusted at face value
- not-ready or failed with an empty reason → conformant:false (exit 1)

## Envelope

- `outcome` (string, required) — one of {shipped, not-ready, failed}
- `reason` (string, required)
- `conformant` (boolean, required)
- `violations` (array, required)


# faff contract spec-readiness

The spec-stage marker-classification contract — whether every decision in a spec resolved to a canonical marker (chosen/punt/assumes) with a provenance stamp, for faff-prep's readiness gate.

## Values

### `decisions[].marker`

Enum: `chosen`, `punt`, `assumes`

| Value | Meaning |
|---|---|
| `chosen` | a closed decision — the spec picked one option and stated it forward |
| `punt` | an open decision — deliberately deferred to the build agent or a human |
| `assumes` | an external assumption — a fact taken as given, not decided here |

## Coercion & fail direction

Exit codes: `0` conformant · `1` violations · `2` fail-loud.

- confidence missing or outside {high,medium,low} → fail-loud (exit 2) — no safe coerce target (FAFF-76 Decision 3)
- a decision with no canonical marker → not fail-loud; recorded as a well-formed verdict with markers_valid:false (exit 1)
- provenance_present:false → markers_valid:false (exit 1), not fail-loud

## Envelope

- `confidence` (string, required) — one of {high, medium, low}
- `decisions` (array, required)
- `markers_valid` (boolean, required)
- `violations` (array, required)
