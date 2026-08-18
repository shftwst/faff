# FAFF-743: Publish the external-verification protocol as the canonical v0.1 evidence shape

> Spec: faffter-dark-nlspec · 2026-08-18 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-743.
>
> Revised on 2026-08-18 — reshaped so v0.1 is the canonical external-verification evidence shape (not a wrapper for FAFF-734): decouple from FAFF-734, prove the machinery on a synthetic fixture, move the real worked case to FAFF-734, and flip the dependency to `FAFF-734 blockedBy FAFF-743`. Spec-review round 1 `revise` (QA type-gated-closure trap, fixture coverage, versioning) fixed in place; round 2 `approve`. Versioning aligned to the `verification/evidence` policy: start at `v0.1`, `v1.0` reserved for the first external consumer pin.

This implementation specification is for the build agent publishing the external-verification protocol and for the reviewers checking it. It reshapes FAFF-743 so that the v0.1 protocol becomes the canonical target shape for external-verification evidence, published and proven on its own, with FAFF-734 (the Fly.io L3 worked case) retargeted downstream to emit against it. FAFF-743 no longer wraps FAFF-734's bundle and is no longer blocked by it.

## 1. WHY — problem and principles

The idea the rest of this spec turns on: v0.1 is a target, not a wrapper. The protocol, its Markdown report template, and its closed JSON record are published first and proven against a hand-authored synthetic fixture in the evidence-spec `schema/examples/` tradition. Real cases then retarget to emit v0.1-conformant reports; FAFF-734 is the first, and it is owned by that ticket, not by this one.

The problem: external demonstrations need a frozen hypothesis, immutable inputs, environment, procedure, observations, decision rule, evidence and limitations, published in one shape whether the outcome is positive, negative, ambiguous or a protocol failure. The repository has experiment scaffolders under `verification/external-verification/`, versioned delivery-evidence schemas under `verification/evidence/`, and a dependency-free schema validator, but no single external-verification method, no closed result vocabulary for negative and stopped work, and no reusable report shape that separates reproduction of a record from repeatability and generalisation. This issue publishes that method and proves it stands up without waiting on any real case.

Design principles:

- **Freeze before execute.** The hypothesis, success criteria, procedure and decision rule are registered and frozen before a result is known. A correction never rewrites a frozen field; it opens a new experiment identity instead.
- **One shape for every outcome.** Negative, inconclusive, stopped and positive results use the same record and template. A protocol failure is never relabelled as evidence against the hypothesis, and a negative result is never relabelled as a system failure.
- **Integrity is not authenticity.** Checksums and replayability detect drift between declared bytes; they never prove who emitted the source. This inherits the boundary already stated in `verification/evidence/README.md`.
- **Scope claims explicitly.** One run supports a bounded claim about that run. Reproducibility, repeatability and generalisation are independent assessments that default to `not-evaluated` and are never auto-granted by a supported main result.
- **The schema carries only what the subset validator can check; the test carries the rest.** The shared validator supports a narrow draft-2020-12 subset. Everything richer is enforced by the focused Node test, not smuggled into a schema that cannot express it.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `verification/evidence/README.md` | Markdown | Versioning-immutability rule, `$id` convention, one-source-per-schema, hand-carried CI-validated examples, and the integrity-not-authenticity boundary this protocol sits alongside |
| `verification/evidence/v0.2/anchor-integrity.md` | Markdown | The existing integrity classification vocabulary and the "checksums are not signatures" posture v0.1 inherits, not restates |
| `plugin/skills/faff/contracts/validate-schema.mjs` | JavaScript | The dependency-free draft-2020-12 subset validator the test reuses as a subprocess. Supported keywords are exactly `type`, `required`, `properties`, `enum`, `additionalProperties`, `items`; all else is ignored |
| `test/evidence-spec.test.mjs` | JavaScript | The established (schema, example) subprocess-validation and fixture pattern the focused test follows |
| `verification/external-verification/README.md` | Markdown | Currently the SUT-scaffolder index. Gains protocol/template/example links without losing that purpose |
| `verification/evidence/v0.1/schema/examples/` | JSON | The precedent for hand-carried example fixtures validated in CI |

This issue adds the reusable protocol beneath `verification/external-verification/protocol/v0.1/`; the first real worked case is FAFF-734's, published under `verification/external-verification/results/`.

## 2. OUT OF SCOPE

- **Running or curating the real L3 case.** FAFF-734 owns emitting its Fly.io L3 run as a v0.1-conformant report under `verification/external-verification/results/`. Extension point: FAFF-734's own curation and validation tooling, retargeted to this schema.
- **Folding FAFF-734's execution into this issue.** This is a docs, schema, template, test and fixture slice. Extension point: the case ticket, which references v0.1 rather than moving it.
- **Backfilling historical experiments.** FAFF-588 remains the owner of historical result backfill. Extension point: FAFF-588.
- **Changing `verification/evidence/` schemas.** The delivery-evidence dialect is untouched. Extension point: a new evidence minor version under its own versioning policy.
- **Signing or trusted attestation.** Out of scope here as in `verification/evidence`. Extension point: a separate trust layer.
- **Runner, tracker, or runtime behaviour changes, and any benchmark scheduler.** None of these change. Extension point: their own tickets.

## 3. WHAT — vocabulary, records and files

### Vocabulary

| Term | Definition |
|---|---|
| Reproducibility | A different operator analyses the same pinned inputs and artifacts with the same procedure and reaches the same objective classification |
| Repeatability | The procedure is executed again under the same declared setup and meets a predeclared tolerance across at least two executions |
| Generalisation | A broader claim is evaluated across predeclared varied axes, a stated population and an aggregation rule |
| Deviation | A post-registration change to environment, input, procedure, oracle or decision rule |
| First failure | The earliest protocol stage that could not meet its required condition |
| Synthetic fixture | A hand-authored experiment report that exercises the machinery. It lives under `schema/examples/`, is marked synthetic, and is never a citable external-verification result |

### Committed layout

```text
verification/external-verification/
  protocol/v0.1/
    README.md
    report-template.md
    schema/
      experiment-report.schema.json
      examples/
        experiment-report.example.json        # synthetic positive fixture (report JSON)
        experiment-report.example.md           # its agreeing Markdown report
        negative/                              # invalid fixtures the test asserts are rejected
          ...one file per negative case
        publication-sequences/                 # small multi-revision fixture sets for immutability checks
          ...
test/external-verification-protocol.test.mjs
```

`verification/external-verification/README.md` gains a short "Protocol and results" section linking `protocol/v0.1/README.md`, the template, and the synthetic example, and naming `results/<case>/` as where real cases land. Its SUT-scaffolder content is unchanged.

`protocol/v0.1/README.md` is normative. This protocol adopts the **same versioning policy as the sibling `verification/evidence` spec**, so a reader meets one convention across `verification/`: the version is independent of faff's release version; every change to the documented shape, additive or breaking, bumps the minor (`v0.2`, `v0.3`, and so on) with a dated changelog entry; published version directories are immutable once landed, with only a prose or link fix that changes no rule allowed in place; and `v1.0` is reserved for the first version an external consumer pins. `v0.1` is the dialect shipped at landing, proven by the synthetic fixture and not yet pinned by any external consumer. The Markdown template is the operator interface. The JSON record carries the fields and enums that are mechanically checkable.

**Chosen:** version this protocol under the evidence spec's existing policy, starting at `v0.1`, rather than inventing a separate rule or launching at `v1.0`. Rationale: both specs live under `verification/` and are in the same situation, so one shared convention is less confusing than two; `v0.1` is honest about a protocol proven only by a synthetic fixture that no external consumer has pinned yet; and `v1.0` then carries real meaning, earned when an outside operator first pins the protocol, exactly as it does for the evidence spec.

### The canonical result shape and the retarget

**Chosen:** v0.1 becomes the canonical target evidence shape for external-verification, and FAFF-734 retargets to emit a v0.1-conformant `report.json` referencing its evidence files. FAFF-743 publishes the protocol, template, schema and test, and proves them against a synthetic fixture. The real worked application moves out of FAFF-743 and into FAFF-734. Rationale: proving the method on the real case coupled publication of the method to completion of an unrelated run; a synthetic fixture proves the schema, the validator reuse, the classification-derivation rules and the negative cases without that coupling, and keeps method-publication and evidence-production in separate, right-sized increments.

Real cases are published as v0.1 reports under `verification/external-verification/results/<case>/`, owned by the case ticket. The synthetic fixture lives under `protocol/v0.1/schema/examples/` and carries a synthetic experiment identity so it can never be mistaken for, or cited as, a real verification outcome.

### Protocol vocabulary and rules

Every report follows these stages: register, freeze, execute, capture, check, optionally judge, classify, publish. Registration is either a committed pre-run record or a commit containing the incomplete report. The final record preserves the original registration time and hypothesis and lists deviations.

**Success criteria and deciding records.** Each success criterion has a stable ID matching `SC-` followed by digits and a statement. Finalisation adds exactly one `criterion_outcomes` entry for every declared criterion ID and no undeclared ID. Each outcome references exactly one deciding record by `{kind: "objective-check" | "subjective-judgement", id: <stable record ID>}`, and the referenced record exists exactly once. An objective check is the default deciding record; a subjective judgement may decide a criterion only when the frozen decision rule predeclares that criterion as judgement-dependent.

Criterion outcome is exactly `pass`, `fail` or `unresolved`. `unresolved_reason` is required and non-empty only for `unresolved`, and absent for `pass` and `fail`. A deciding objective check's `pass`, `fail` or `not-run` maps to criterion `pass`, `fail` or `unresolved`. A deciding subjective judgement supplies an explicit `criterion_outcome` from the same vocabulary; an absent assessor result is `unresolved`, never inferred. A check or judgement may add context for several criteria, but each criterion has one and only one deciding reference.

**Objective checks are required; subjective judgements are optional.** Objective checks carry stable IDs matching `OC-` followed by digits and name an oracle, expected value, observed value, verdict and evidence. Subjective judgements carry stable IDs matching `SJ-` followed by digits and name the dimension, rubric, assessor, assessor type, blinding state, rating, rationale, explicit criterion outcome and evidence. A judgement affects the main result only when the frozen decision rule says so, and the report labels the result judgement-dependent.

**Main result classification** is exactly one of:

| Value | Condition |
|---|---|
| `supports-hypothesis` | all criterion outcomes pass, none unresolved, required evidence complete, `first_failure` null |
| `does-not-support` | at least one criterion fails, none unresolved, required evidence complete, `first_failure` null |
| `inconclusive` | at least one criterion unresolved or required evidence incomplete, no protocol-stage failure, `first_failure` null |
| `protocol-failure` | registration, prerequisites, execution, capture or analysis failed; `first_failure` required. Criterion outcomes already reached are recorded; all undecidable criteria are `unresolved` |

**Independent claim assessments.** Every report assesses reproducibility, repeatability and generalisation exactly once using `supported`, `not-supported`, `inconclusive` or `not-evaluated`, defaulting to `not-evaluated`. Reproducibility support requires an independent operator; repeatability support requires at least two executions; generalisation support requires varied axes plus a predeclared population and aggregation rule. The main result never auto-supports these broader claims.

### The record shape

The JSON Schema at `protocol/v0.1/schema/experiment-report.schema.json` uses `$id: faff/external-verification/v0.1/experiment-report`, draft 2020-12, with `additionalProperties: false` on the root and every nested object and named arrays for study-specific dimensions. It encodes only the constructs the shared subset validator supports: `type`, `required`, `properties`, `enum`, `additionalProperties: false`, and `items`. It does not use `pattern`, `minItems`, `minLength`, `format`, `const`, numeric bounds, `oneOf`/`anyOf`, or `$ref`, because the validator ignores them; those constraints are enforced by the focused test instead (see HOW).

**Explicit `type` on every node is mandatory, not stylistic.** The shared validator's closure and recursion are *type-gated*: it enforces `required`, `additionalProperties: false` and recurses into `properties` only on a node that declares `type: "object"`, and it applies `items` only on a node that declares `type: "array"` (see `validate-schema.mjs`). An object subschema written with `properties` + `additionalProperties: false` but **no** `type: "object"` therefore enforces nothing and passes vacuously — the same "reads as enforced but is silently ignored" trap the subset rule above guards against, now for closure itself. Every object and array node in the schema declares its `type` explicitly; a node that omits it is a schema bug, and the focused test carries a fixture with an undeclared extra property that must be rejected, proving closure actually fires rather than no-oping.

**Chosen:** the schema declares field presence, object closure, types and closed enums only; every richer constraint (ID patterns, digest matching, path containment, exactly-once criterion resolution, contiguous append-only revisions, classification derivation, claim support-floors, and JSON↔Markdown agreement) is enforced by `test/external-verification-protocol.test.mjs`. Rationale: the reused validator is a documented subset checker; putting a `pattern` or `minItems` in the schema would read as enforced but pass silently, which is worse than enforcing it visibly in code.

Required top-level information:

- schema and experiment identity; registration, completion and publication timestamps;
- publication revision, immutable record path, record status, predecessor reference and correction reason;
- protocol version, repository-relative path and SHA-256;
- hypothesis, unit of claim, stable-ID success criteria, decision rule and planned variations;
- full subject and SuperDomestique repository commits, harness identity and version, provider and serving model ID when exposed;
- captured environment, runtime versions, runner class, trigger, allowlisted non-secret configuration and secret-name presence flags;
- inputs, ordered procedure steps, objective checks, optional subjective judgements, observations, outputs, deviations and redactions;
- exactly-once criterion outcomes with one deciding check or judgement reference each;
- main result, evidence-completeness flag and first failure where applicable;
- exactly one assessment for each of reproducibility, repeatability and generalisation;
- non-empty limitations.

**Publication metadata.** `publication.revision` is a positive integer; `publication.path` is `reports/<revision padded to four digits>.json`; `publication.status` is `original` for revision 1 and `correction` thereafter; `publication.supersedes` is null for revision 1 and otherwise names the immediately preceding repository-relative path and its SHA-256; `publication.correction_reason` is null for the original and non-empty for a correction. Published records are append-only: the first publication is `reports/0001.json`, and a correction adds the next zero-padded file while retaining every earlier file byte-for-byte. A correction never rewrites the frozen hypothesis, criteria, procedure or decision rule; a change to those opens a new experiment identity. Corrections are limited to fixing transcription, adding newly recovered evidence, or honestly downgrading a classification after an integrity defect is found.

**Evidence references** contain role, path or URL, media type, and SHA-256 when locally checkable. Local paths are repository-relative and contain no `..`. Network URLs are recorded but never fetched by local validation. A missing public hash requires an explicit reason. Minimum evidence includes the frozen hypothesis and decision rule, full revisions, tool/harness/model identity, non-secret environment and configuration, ordered commands and observations, at least one deterministic oracle, hashes for committed inputs and outputs, deviations, redactions, classification, claim assessments, limitations, and rerunnable validator output. Missing required evidence cannot yield `supports-hypothesis`.

**Assumes:** the shared validator stays at `plugin/skills/faff/contracts/validate-schema.mjs` and supports exactly the keyword subset above. Validate by reading its `TYPE_CHECK` map and keyword handling before authoring the schema; if the subset has widened, the test may lean on the new keywords, but the schema must still not depend on any keyword the installed validator ignores.

## 4. HOW — behaviour

### The synthetic fixture

The fixture is a matched pair under `protocol/v0.1/schema/examples/`: `experiment-report.example.json` and its agreeing `experiment-report.example.md`. It is hand-authored, marked with a synthetic experiment identity, and describes a small illustrative experiment with at least one objective check, one predeclared judgement-dependent criterion decided by a subjective judgement, a `does-not-support` or `inconclusive` outcome that exercises the non-trivial classification paths, and all three claim assessments set to values that exercise both `not-evaluated` and a supported claim meeting its floor. Its purpose is to prove the machinery, so it deliberately covers more of the shape than a minimal positive case would.

### Validation

`test/external-verification-protocol.test.mjs` follows `test/evidence-spec.test.mjs`: it reuses `plugin/skills/faff/contracts/validate-schema.mjs` as a subprocess for structural validation of every example against the schema, then performs the semantic checks in process on the parsed fixtures. It never makes a network request.

```text
PROCEDURE VALIDATE_PROTOCOL:
  1. For each (schema, example) pair, run validate-schema.mjs as a subprocess; require exit 0 for valid fixtures.
  2. For each file under examples/negative/, assert rejection: a schema-level fixture fails the subprocess validator; a semantic fixture fails an in-process assertion below.
  3. Parse the positive fixture and assert the semantic rules the schema cannot express:
     a. SC/OC/SJ IDs match their patterns and are unique.
     b. criterion_outcomes resolve every declared criterion exactly once to one existing deciding record and contain no undeclared criterion.
     c. deciding-record outcomes agree with criterion outcomes; judgement-dependent criteria were predeclared; unresolved_reason obeys its required/forbidden rule.
     d. main_result equals the value derived from criterion outcomes, evidence completeness and first-failure state using the closed rules.
     e. all three claim types occur once; a supported claim meets its count/operator/axis floor.
     f. protocol digest and every non-null local evidence digest match repository bytes.
     g. every local evidence path passes component-wise symlink rejection with lstat, then realpath containment inside the repository root, before any digest read; absolute, escaping, broken-symlink and symlink-containing paths fail closed; network URLs are never fetched.
  4. For each publication-sequences fixture set, assert revisions are contiguous and append-only, predecessor hashes match, frozen fields are identical across revisions, and any edited earlier revision or skipped/overwritten revision is rejected.
  5. Assert the Markdown example and the JSON example agree on hypothesis, classification and evidence links, all required template headings exist, and no placeholder text remains.
```

**Negative fixtures — one per rejection path in PROCEDURE VALIDATE_PROTOCOL**, so a green suite actually exercises every check rather than a subset of them. They cover:

- *structural (rejected by the subprocess validator):* an object node with an undeclared extra property (proves `additionalProperties: false` fires — the closure-fires fixture), a wrong-typed field, an out-of-enum value for a closed vocabulary, a missing required field.
- *identity and references (step 3a–3c):* a malformed `SC-`/`OC-`/`SJ-` ID, a duplicate ID, a missing criterion outcome, a duplicate criterion outcome, an undeclared criterion outcome, a dangling deciding reference, a multiply-resolving deciding reference, an unresolved criterion without a reason, a `pass`/`fail` criterion carrying an `unresolved_reason`, and a subjective judgement deciding a criterion the frozen decision rule did not predeclare as judgement-dependent.
- *classification derivation (step 3d):* a classification inconsistent with its criterion outcomes, a `supports-hypothesis` result with a failed criterion, and a `protocol-failure` without first-failure data.
- *claim floors (step 3e):* a one-run `supported` generalisation, a `supported` repeatability with fewer than two executions, and a `supported` reproducibility with no independent operator.
- *revisions and digests (step 3f):* a short (non-40-hex) Git revision, a non-publication local evidence reference whose SHA-256 does not match its bytes.
- *path containment (step 3g):* an absolute path, a repository-escaping path, a local symlink whose target is outside the repository, a symlink whose target is inside the repository (still rejected — no symlink component is allowed), and a broken symlink.
- *publication immutability (step 4):* an overwritten prior publication, an edited earlier revision, a skipped publication revision, and a correction with a wrong predecessor digest.
- *cross-surface agreement (step 5):* a fixture whose Markdown and JSON disagree on classification, and one with a residual template placeholder.

Each schema-level fixture must fail the subprocess validator; each semantic fixture must fail a named in-process assertion. The DoD's "negative fixtures cover every case listed in HOW" is satisfied only when there is one fixture per bullet above.

**Failure modes:**

- **A pattern or bound is written into the schema and reads as enforced.** How you would know: the negative fixture that violates it still passes the subprocess validator. What it means: move the constraint into the test; the schema keeps only subset-checkable keywords.
- **An object node omits `type: "object"`, so closure and recursion silently no-op.** How you would know: the closure-fires fixture (an object with an undeclared extra property) passes the subprocess validator instead of being rejected. What it means: the node is missing its explicit `type`; add it, then re-run until the extra-property fixture is rejected.
- **The fixture drifts from the template.** How you would know: the JSON↔Markdown agreement check or the required-headings check fails. What it means: the fixture is regenerated from the template, not patched in one place.

**Anti-pattern:** publishing a real-looking `results/` case inside FAFF-743 to prove the schema. Why: it re-couples this issue to a run it does not own and would either invent evidence or wait on FAFF-734. The synthetic fixture proves the machinery; real cases are owned by their case tickets.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Given a new operator has only a clean checkout and the v0.1 protocol, when they copy the template, then every required hypothesis, revision, environment, procedure, evidence, classification, claim-scope, failure and limitation field has a named place.

Given the synthetic fixture, when the focused test runs, then the schema validates it via the subset validator as a subprocess, and every semantic rule the schema cannot express is checked in process against the parsed fixture.

Given a negative fixture declares a `supports-hypothesis` main result while one criterion outcome is `fail`, when the test derives the classification from the criterion outcomes, then the declared value is rejected.

Given a negative fixture whose evidence path is a symlink pointing outside the repository, when the test walks the path components with lstat before hashing, then the path fails closed and no digest read occurs.

Given a publication-sequences fixture where `reports/0002.json` records a predecessor digest that does not match `reports/0001.json`'s bytes, or where `0001.json` was edited after publication, then the append-only check fails and names the offending revision.

## 6. Design decision rationale

**Should v0.1 wrap FAFF-734's bundle or become the target shape?** Wrapping made FAFF-743's proof depend on FAFF-734 completing, coupling method publication to an unrelated run and inverting the natural dependency.

**Chosen:** v0.1 is the canonical target shape. FAFF-743 leads and publishes it; FAFF-734 retargets to emit against it. The Linear edge becomes `FAFF-734 blockedBy FAFF-743`, replacing today's `FAFF-743 blockedBy FAFF-734`. FAFF-743 is build-admissible on its own once specced.

**How does FAFF-743 prove its machinery without a real case?** Waiting on the real L3 run reintroduces the coupling; inventing a fake "real" case under `results/` would be dishonest.

**Chosen:** a hand-authored synthetic fixture under `schema/examples/`, marked synthetic and CI-validated, in the evidence-spec tradition. It proves the schema, the validator reuse, the classification-derivation rules and the negative cases.

**Where do real cases live, and who owns them?** Mixing the method with its first application in one ticket makes the increment too large and produces an uncitable half-result if either half slips.

**Chosen:** real cases are published under `verification/external-verification/results/<case>/`, owned by the case ticket. FAFF-734 is the first. FAFF-743 states this convention normatively and creates no real case.

**Where do the pattern, digest, containment and derivation constraints live?** The reused validator is a documented subset checker that silently ignores `pattern`, `minItems`, numeric bounds and combinators.

**Chosen:** the schema declares only subset-checkable keywords; the focused test enforces every richer constraint. A constraint that reads as enforced but is silently ignored is worse than one enforced visibly in code.

## 7. Open questions and assumptions

### Open questions

None. The decoupling removes the only prior blocker (FAFF-734), the target paths and validator are grounded, and the fixture replaces the dependency on a real run.

### Assumptions

**Assumes:** the shared validator at `plugin/skills/faff/contracts/validate-schema.mjs` supports exactly `type`, `required`, `properties`, `enum`, `additionalProperties` and `items`. Validate by reading its keyword handling before authoring the schema; author the schema to that subset and enforce everything else in the test.

## 8. DONE — definition of done

### From WHY and scope

- [ ] `protocol/v0.1/README.md` is normative, usable without tracker comments or private context, and states versioning, authenticity, secret-handling, correction and claim-scope rules.
- [ ] FAFF-743 no longer depends on FAFF-734; the spec states the Linear edge should become `FAFF-734 blockedBy FAFF-743`, and FAFF-743 is build-admissible on its own.
- [ ] No runtime, runner, tracker, evidence-schema or infrastructure behaviour changes.

### From WHAT

- [ ] The Markdown template names every required report category and supports stopped and negative work without padding.
- [ ] `experiment-report.schema.json` uses `$id: faff/external-verification/v0.1/experiment-report`, closes every object with `additionalProperties: false`, declares an explicit `type` on every object and array node (so the type-gated validator's closure and recursion fire), and uses only the subset-checkable keywords; it declares no `pattern`, bound, combinator, `format` or `$ref`.
- [ ] The schema encodes the required top-level fields, the four-value main-result enum, the four-value claim-assessment enum, and the criterion/check/judgement/publication field sets.
- [ ] The `results/<case>/` convention is stated normatively and owned by case tickets; FAFF-743 creates no real case.

### From HOW

- [ ] The synthetic fixture pair (`experiment-report.example.json` and `.example.md`) carries a synthetic experiment identity, agrees JSON↔Markdown, and exercises objective checks, a judgement-dependent criterion, a non-trivial classification path and all three claim assessments.
- [ ] `test/external-verification-protocol.test.mjs` reuses `validate-schema.mjs` as a subprocess for structural validation and enforces in process: stable/unique IDs, exactly-once criterion resolution, deciding-record agreement, classification derivation, claim support-floors, protocol and evidence digest matching, component-wise symlink rejection then realpath containment, append-only publication immutability with predecessor-digest and frozen-field checks, and JSON↔Markdown agreement with no residual placeholder.
- [ ] Negative fixtures cover every case listed in HOW; schema-level ones fail the subprocess validator, semantic ones fail an in-process assertion.
- [ ] `verification/external-verification/README.md` links the protocol, template and synthetic example and names `results/<case>/`, without losing its SUT-scaffolder content.
- [ ] `node --test test/external-verification-protocol.test.mjs`, `faff lint-refs`, the documentation build and the normal repository test suite pass.

### Integration smoke test

```text
GIVEN a clean checkout with the published v0.1 protocol, schema, template and synthetic fixture
WHEN node --test test/external-verification-protocol.test.mjs runs
THEN validate-schema.mjs validates the positive fixture as a subprocess
 AND every semantic rule the schema cannot express is checked in process
 AND every negative fixture is rejected at the correct layer
 AND no network request is made
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized.** Protocol, template, closed schema, one synthetic fixture and a focused test are a cohesive one-to-two-day documentation increment. Decoupling from FAFF-734 removes the cross-ticket wait that made the previous shape lumpy; the synthetic fixture proves the machinery without importing a run this ticket does not own.
- **Workstream fit.** The deliverable is the reusable external-verification method, which is the stated project outcome. Real cases are separate, case-owned increments that consume it. This keeps method-publication and evidence-production in their own lanes.
- **Dependency discipline.** The previous spec kept `FAFF-743 blockedBy FAFF-734`, which inverted the natural direction: FAFF-734 needs the schema to target, not the other way round. The flip to `FAFF-734 blockedBy FAFF-743` makes FAFF-743 build-admissible now and removes the repeated-prep churn the old edge caused.
- **Risk profile.** No spike is warranted; the schema reuses the existing subset validator and the evidence-spec test pattern. The residual risk is over-encoding the schema with constraints the validator silently ignores. That is controlled by the explicit subset rule and by placing every richer check in the test, where a violated constraint fails loudly.

## Producer self-review

- Read the current FAFF-743 and FAFF-734 specs, the nlspec skill arc and its inherited self-review, and grounded every claim against the codebase.
- Verified the validator at `plugin/skills/faff/contracts/validate-schema.mjs` supports only `type`, `required`, `properties`, `enum`, `additionalProperties` and `items`, and ignores `pattern`, bounds, `format`, combinators and `$ref`. Reshaped the spec so the schema stays inside that subset and the test enforces the rest; the previous spec implied ID patterns and digest rules were schema-level, which the subset validator cannot do.
- Verified `test/evidence-spec.test.mjs` reuses the validator as a subprocess over (schema, example) pairs and adds semantic checks, and mirrored that pattern.
- Verified `verification/evidence/README.md` sets the `$id: faff/evidence/<version>/<name>` convention, one-source-per-schema, hand-carried CI-validated examples, published-version immutability, and the integrity-not-authenticity boundary; v0.1 sits alongside these consistently with `$id: faff/external-verification/v0.1/experiment-report`.
- Verified `verification/external-verification/README.md` is the SUT-scaffolder index; the added links extend it without displacing that purpose. Confirmed no `protocol/` or `results/` directories exist yet, so this is a clean add, and that the repo spec-docs path is `records/specs` while worked cases live under `verification/external-verification/`.
- Preserved the four-value classification, the independent claim model with `not-evaluated` default and support-floors, the objective-required/subjective-optional split, the stable-ID exactly-once scheme, append-only publication immutability with predecessor digests, realpath/symlink containment, the integrity-not-authenticity boundary, and JSON↔Markdown agreement. Moved the real worked application out to FAFF-734 and replaced it with the synthetic fixture plus the `results/<case>/` normative statement.
- No blocker or unresolved-major remains; no open punt. Confidence high.

spec-review: approve

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```