# External-verification protocol v0.1

This is the normative method for publishing an external verification of a SuperDomestique (formerly known as `faff`) claim. It fixes one record shape for every outcome, so a positive, negative, inconclusive or stopped result is published the same way and read the same way. A reader with a clean checkout and this page has everything needed to run the protocol and to check a published report; no tracker comments or private context are required.

The Markdown report at [`report-template.md`](report-template.md) is the operator interface. The JSON record at [`schema/experiment-report.schema.json`](schema/experiment-report.schema.json) carries the fields and enums that are checked by machine. The synthetic fixture under [`schema/examples/`](schema/examples/) proves the machinery; it is marked synthetic and is never a citable result.

## Principles

- **Freeze before execute.** The hypothesis, success criteria, procedure and decision rule are registered and frozen before any result is known. A correction never rewrites a frozen field; a change to a frozen field opens a new experiment identity instead.
- **One shape for every outcome.** Negative, inconclusive, stopped and positive results use the same record and template. A protocol failure is never relabelled as evidence against the hypothesis, and a negative result is never relabelled as a system failure.
- **Integrity is not authenticity.** Checksums and replay detect drift between declared bytes; they never prove who produced the source. This is the same boundary stated for the delivery-evidence spec under [`verification/evidence/`](../../../evidence/README.md), inherited here rather than restated.
- **Scope claims explicitly.** One run supports a bounded claim about that run. Reproducibility, repeatability and generalisation are independent assessments that default to `not-evaluated`; a supported main result never grants them automatically.
- **The schema carries only what the shared validator can check; the report test carries the rest.** The shared subset validator understands a narrow slice of draft 2020-12. Every richer rule is enforced by the focused Node test, never smuggled into a schema that cannot express it.

## The eight stages

Every report walks these stages in order.

| Stage | What happens |
|---|---|
| register | Record the experiment identity, hypothesis, unit of claim, success criteria, decision rule and planned variations. Registration is either a committed pre-run record or a commit holding the incomplete report. |
| freeze | The registered hypothesis, criteria, procedure and decision rule become immutable. Later edits to them are forbidden; they open a new experiment identity. |
| execute | Run the procedure against the pinned subject and environment. |
| capture | Record environment, runtime versions, inputs, ordered procedure steps, observations and outputs, with hashes for committed bytes. |
| check | Run the objective checks. Each names an oracle, an expected value, an observed value, a verdict and evidence. |
| judge | Optional. Where the frozen decision rule predeclares a criterion as judgement-dependent, a subjective judgement decides it. |
| classify | Resolve every criterion, derive the main result, and assess reproducibility, repeatability and generalisation. |
| publish | Write the immutable, append-only record. |

The final record keeps the original registration time and hypothesis and lists every deviation from the registered plan.

## Success criteria and deciding records

Each success criterion has a stable ID of the form `SC-` followed by digits (for example `SC-1`, `SC-14`) and a statement. Finalisation adds exactly one `criterion_outcomes` entry for every declared criterion ID, and no entry for an undeclared ID.

Each outcome names exactly one deciding record by `{ "kind": "objective-check" | "subjective-judgement", "id": <stable record ID> }`, and the referenced record exists exactly once. An objective check is the default deciding record. A subjective judgement may decide a criterion only when that criterion is predeclared as judgement-dependent by the frozen decision rule.

A criterion outcome is exactly `pass`, `fail` or `unresolved`:

| Outcome | Meaning | `unresolved_reason` |
|---|---|---|
| `pass` | The deciding record met the criterion | absent |
| `fail` | The deciding record did not meet the criterion | absent |
| `unresolved` | The criterion could not be decided | required, non-empty |

A deciding objective check maps its `pass`, `fail` or `not-run` verdict to criterion `pass`, `fail` or `unresolved`. A deciding subjective judgement supplies an explicit criterion outcome from the same three values; an absent assessor result is `unresolved`, never inferred as a pass or fail. A check or judgement may add context for several criteria, but each criterion has one and only one deciding reference.

## Objective checks and subjective judgements

Objective checks are required; subjective judgements are optional.

- **Objective checks** carry stable IDs of the form `OC-` followed by digits. Each names an oracle, an expected value, an observed value, a verdict (`pass`, `fail` or `not-run`) and evidence.
- **Subjective judgements** carry stable IDs of the form `SJ-` followed by digits. Each names the dimension, the rubric, the assessor, the assessor type, the blinding state, the rating, the rationale, an explicit criterion outcome and evidence.

A judgement affects the main result only when the frozen decision rule predeclares its criterion as judgement-dependent, and the report labels that result judgement-dependent.

## Main result classification

The main result is exactly one of four values, derived from the criterion outcomes, the evidence-completeness flag and the first-failure state.

| Value | Condition |
|---|---|
| `supports-hypothesis` | all criterion outcomes are `pass`, none `unresolved`, required evidence complete, `first_failure` null |
| `does-not-support` | at least one criterion `fail`, none `unresolved`, required evidence complete, `first_failure` null |
| `inconclusive` | at least one criterion `unresolved` or required evidence incomplete, no protocol-stage failure, `first_failure` null |
| `protocol-failure` | registration, prerequisites, execution, capture or analysis failed; `first_failure` is required. Criterion outcomes already reached are recorded; every undecidable criterion is `unresolved` |

The first failure is the earliest protocol stage that could not meet its required condition.

## The three claim assessments

Every report assesses reproducibility, repeatability and generalisation exactly once, using `supported`, `not-supported`, `inconclusive` or `not-evaluated`, and defaulting to `not-evaluated`. The main result never auto-supports these broader claims.

| Assessment | Definition | Support floor |
|---|---|---|
| Reproducibility | A different operator analyses the same pinned inputs and artifacts with the same procedure and reaches the same objective classification | an independent operator |
| Repeatability | The procedure is executed again under the same declared setup and meets a predeclared tolerance | at least two executions |
| Generalisation | A broader claim is evaluated across predeclared varied axes, a stated population and an aggregation rule | varied axes plus a stated population and aggregation rule |

A claim may be marked `supported` only when its floor is met. Below the floor the honest value is `inconclusive` or `not-evaluated`.

## Minimum evidence

A report cannot reach `supports-hypothesis` while any required evidence is missing. The floor is:

- the frozen hypothesis and decision rule;
- the full subject and SuperDomestique repository revisions;
- the tool, harness and, where exposed, provider and serving-model identity;
- the non-secret environment and configuration;
- the ordered commands and observations;
- at least one deterministic oracle;
- SHA-256 hashes for committed inputs and outputs;
- deviations, redactions, the classification and the three claim assessments;
- non-empty limitations;
- rerunnable validator output.

## Evidence references

Each evidence reference names a role, a local path or a network URL, a media type, and a SHA-256 when the bytes are locally checkable.

- Local paths are repository-relative and contain no `..`. They resolve to a real file inside the repository, and no path component may be a symlink. A path that is absolute, that escapes the repository, or that passes through a symlink is rejected before any hash is read.
- Network URLs are recorded but never fetched by local validation.
- A missing public hash requires an explicit reason.

## Secret and configuration handling

Captured configuration is an allowlist of non-secret values. Secrets are recorded by name-presence only: the report states that a named secret was present, never its value. A report never contains a secret value.

## Publication and immutability

Publication metadata pins each record to a numbered, immutable file.

| Field | Rule |
|---|---|
| `publication.revision` | a positive integer; the first publication is revision 1 |
| `publication.path` | `reports/<revision padded to four digits>.json`, for example `reports/0001.json` |
| `publication.status` | `original` for revision 1, `correction` thereafter |
| `publication.supersedes` | null for revision 1; otherwise the immediately preceding repository-relative path and its SHA-256 |
| `publication.correction_reason` | null for the original; non-empty for a correction |

Published records are append-only. The first publication is `reports/0001.json`; a correction adds the next zero-padded file and keeps every earlier file byte-for-byte. Revisions are contiguous: there is no gap and no reused number.

## Corrections

A correction never rewrites the frozen hypothesis, success criteria, procedure or decision rule; a change to any of those opens a new experiment identity. Corrections are limited to fixing a transcription error, adding newly recovered evidence, or honestly downgrading a classification after an integrity defect is found. Each correction states its reason and names the record it supersedes with that record's SHA-256, so an edited earlier revision is detectable.

## What the schema checks, and what the test checks

The JSON Schema declares field presence, object closure, types and closed enums, using only the keyword subset the shared validator supports: `type`, `required`, `properties`, `enum`, `additionalProperties: false`, and `items`. It declares an explicit `type` on the root and on every nested object and array node, because the shared validator's closure and recursion are type-gated: a node without `type: "object"` enforces neither its `required` list nor its `additionalProperties: false`, and a node without `type: "array"` never checks its `items`. The schema uses no `pattern`, no length or item bounds, no `format`, no `const`, no numeric bounds, and no `oneOf`, `anyOf` or `$ref`, because the validator ignores them.

Every richer rule is enforced by [`test/external-verification-protocol.test.mjs`](../../../../test/external-verification-protocol.test.mjs): the ID patterns and their uniqueness, exactly-once criterion resolution, deciding-record agreement, the judgement-dependent predeclaration rule, classification derivation, the three claim support-floors, protocol and evidence digest matching, path containment, append-only publication with predecessor-digest and frozen-field checks, and agreement between the JSON record and the Markdown report. A constraint that reads as enforced but is silently ignored is worse than one enforced visibly in code.

## Where real cases live

Real external-verification cases are published as v0.1 reports under `verification/external-verification/results/<case>/`, owned by the case ticket that produces them. This protocol directory publishes the method and proves it against the synthetic fixture only; it creates no real case. The synthetic fixture under `schema/examples/` carries a synthetic experiment identity so it can never be mistaken for, or cited as, a real verification outcome.

## Versioning

This protocol adopts the same versioning policy as the sibling delivery-evidence spec under [`verification/evidence/`](../../../evidence/README.md), so a reader meets one convention across `verification/`.

- The protocol version is independent of the SuperDomestique release version.
- Every change to the documented shape, additive or breaking, bumps the minor (v0.2, v0.3, and so on) with a dated changelog entry.
- Published version directories are immutable once landed; only a prose or link fix that changes no rule may land in place.
- v1.0 is reserved for the first version an external consumer pins.

v0.1 is the dialect shipped at landing, proven by the synthetic fixture and not yet pinned by any external consumer.

## Changelog

- **v0.1 — 2026-08-18.** Initial protocol: the eight stages, the four-value main result, the three independent claim assessments with their support floors, stable-ID success criteria with exactly-once resolution, objective checks required with optional predeclared subjective judgements, the minimum-evidence floor, append-only publication with predecessor digests, the integrity-not-authenticity boundary inherited from the delivery-evidence spec, name-presence-only secret handling, the correction rule, and the closed JSON record proven by the synthetic fixture.
