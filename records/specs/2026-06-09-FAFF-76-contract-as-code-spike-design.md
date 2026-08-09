# Spec — FAFF-76: Contract-as-code spike (schema language, artifact convention & coercion determinism)

> Produced by faff-prep · faffter-dark-nlspec · 2026-06-09 · **confidence: high**
> (originally medium; the one open Punt — producer-migration posture — was resolved interactively to Path B (opportunistic) and folded into Decision 2.)

This is a design spec for the **architecture-decision spike** that unblocks the contract-as-code epic (FAFF-21). Deliverable: an ADR + one reference schema — not production validation code (that's FAFF-77).

## 1. WHY — Problem and Principles

**Problem.** The `faffidavit-*` adaptors validate conformance in prose/LLM judgement — lenient and run-to-run variable — and `faffidavit-spec` has *no coercion* (the hotspot). The epic replaces this with deterministic contract scripts, but three foundational decisions block every downstream ticket. This spike makes them and proves the schema approach with one reference schema.

**Principles.**
- **Deterministic tools over prose (governing tenet).** Same input → same output ⇒ a tool, not the LLM. Any decision re-introducing run-to-run variance on a mechanically-checkable property is rejected.
- **Preserve the zero-dependency CLI invariant.** The `faff` CLI imports only `node:fs`/`node:path` (no `package.json`). Any decision needing an npm dep to read/validate a schema is rejected.
- **Understandable over clever.** A recognised standard beats a bespoke notation when both fit.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `skills/faff/bin/faff` | dependency-free Node | Sole validator of the schemas; already hand-rolls `parseYamlSubset()` — precedent for a hand-rolled JSON-Schema-subset validator |
| `skills/faffidavit-spec/SKILL.md` | prose skill | The no-coercion hotspot; spec-readiness is the reference contract |
| gateway → Core contracts and adaptor slots | prose | Defines the four fixed contracts the schemas formalise |

**Scope.** Head of the FAFF-21 dependency chain: produces the decisions + reference schema FAFF-77 and later roll-out tickets build on.

## 2. OUT OF SCOPE
- **Writing the contract scripts** — that's the build, gated on these decisions. → FAFF-77.
- **Rewriting `faffidavit-spec` as a thin shell** — depends on the contract script. → FAFF-77.
- **Schematizing the other three contracts** (review-verdict, delivery-outcome, automation-routing) — prove the language on one first. → surfaced remainder on FAFF-21.
- **Migrating producers to emit structured artifacts** — now Chosen as *opportunistic* (Decision 2); not committed epic work. → done per-producer when each is next touched.
- **Extending `faff validate-adapters` to run the wiring-check** — this spike *specifies* the check; FAFF-77 *implements* it.

## 3. WHAT — Vocabulary, Types, Decisions

| Term | Definition |
|---|---|
| Contract script | Deterministic faff-owned program: consumes a producer's outcome, emits structured contract data to the schema, or errors |
| Contract data | The structured JSON the pipeline branches on (e.g. `{confidence, decisions[]}`) |
| Schema | The machine-readable *shape* of contract data; normative for shape only |
| Extraction seam | Where a prose producer's output becomes contract-script input; the one place LLM judgement may remain |
| Fail-loud | On malformed/unmappable input the script errors, never emits a lenient pass |

**Four fixed contracts to schematize** (rendering excluded — no internal contract): `spec-readiness`, `review-verdict`, `delivery-outcome`, `automation-routing`. This spike delivers **`spec-readiness` only** as the reference.

**Reference shape — spec-readiness contract data:**
```
RECORD SpecReadinessContractData:
  confidence: ENUM{high, medium, low}     # required; the gate the pipeline branches on
  decisions: List<Decision>               # one per non-trivial decision section
  markers_valid: Boolean                  # did every multi-option section carry a canonical marker
  violations: List<String>                # empty iff markers_valid
RECORD Decision:
  classification: ENUM{closed, open, external}   # closed=Chosen, open=Punt, external=Assumes
```

### Decision 1 — Schema language + location
Options: JSON Schema (plain `.json`) · zod (TS) · custom DSL.
**Chosen:** JSON Schema (a small **Draft 2020-12 subset**) as `*.schema.json` files under `skills/faff/contracts/`, validated by a hand-rolled dependency-free subset validator in the `faff` CLI — `JSON.parse` is a Node builtin (zero-dep reads), it preserves the dependency-free invariant zod/ajv would break, mirrors the `parseYamlSubset()` precedent, and JSON Schema is a recognised standard. Subset to support: `type`, `required`, `properties`, `enum`, `additionalProperties`, `items`.

### Decision 2 — Producer artifact / extraction convention
Options: (A) producers emit a **structured sidecar artifact** (fully deterministic, changes every producer) · (B) producers stay prose, the **contract script extracts** prose→data with an LLM at the seam (no producer changes).
**Chosen:** a **dual-path model, artifact-preferred** — the script uses a structured artifact when present (deterministic), else falls back to LLM extraction from prose, **failing loud** on malformed extraction. **Migration posture (resolved 2026-06-09): Path B — opportunistic.** The extraction-seam-with-fail-loud is the *durable* design; artifact-emission is a per-producer optimisation done opportunistically when each producer is next touched, **not** a committed epic-wide migration and **not** a gate on FAFF-77. This keeps the epic thin-slice-first (matches the value×risk decomposition): the spec-readiness hotspot fix ships with no producer change.

### Decision 3 — Coercion / fail-loud as deterministic rules
**Chosen:** express each contract's coercion rule in schema + script, not prose — the script maps unmappable input to the safe terminal value deterministically: review → `needs-human`, delivery → `failed`, spec-readiness → fail-loud error (no safe coerce target today, which is why it's the hotspot). Schema encodes the closed enums; script encodes the coercion direction. Moves documented fixed behaviour from prose-the-LLM-reinterprets to a table-the-script-executes-identically.

### Decision 4 — Governance rule
**Chosen:** **schema normative for *shape*; gateway prose normative for *semantics*.** Shape questions ("is `confidence` one of high/medium/low?") resolve to the schema; meaning questions ("what does `medium` mean for promotion?") resolve to the gateway. Prevents the schema becoming a drifting second source of contract semantics.

## 4. HOW — Approach

**Two output artifacts:**
1. An **ADR** under `records/adr/` recording Decisions 1–4 (incl. the Path B migration posture) with options-considered/rationale.
2. A **reference schema** `skills/faff/contracts/spec-readiness.schema.json` encoding `SpecReadinessContractData`.

**Reference-schema proof (subset-validator smoke path):**
```
PROCEDURE prove_reference_schema:
  1. Author spec-readiness.schema.json (subset keywords only).
  2. KNOWN-GOOD contract-data example → subset validator → expect PASS.
  3. KNOWN-BAD example (confidence: "maybe") → expect FAIL with a named violation.
  4. Both run with `node`, no installed dependencies.
```
The full subset-validator implementation is FAFF-77; this spike needs only enough (~a small `validateAgainstSchema`) to run steps 2–3 on the one reference schema.

**Wiring-check contract (specified here, implemented in FAFF-77)** — recorded in the ADR as what `faff validate-adapters` will assert:
```
ASSERT for each adaptor with a contract script:
  - the adaptor's SKILL.md names its contract-script path
  - the named script exists under skills/faff/contracts/ (or sibling script dir)
  - the adaptor declares the script the SOLE source of contract data (no prose-built path)
```

**Anti-pattern:** hand-rolling a *full* JSON Schema validator. Why: the contracts are flat enum/required shapes; a full validator is a dependency's worth of code for no benefit.
**Anti-pattern:** letting the schema encode semantics (e.g. baking "medium ⇒ needs-decision-first" in). Why: violates Decision 4 — meaning lives in the gateway.

## 5. DESIGN DECISION RATIONALE
- **Schema language?** zod/ajv pull npm deps (rejected — breaks the verified zero-dep invariant); custom DSL reinvents a standard (rejected — understandable tenet). **Chosen:** JSON Schema subset.
- **Where?** **Chosen:** `skills/faff/contracts/`, colocated with the only validator; one file per contract.
- **Artifact vs extraction + migration posture?** Sidecar-only blocks on migrating every producer; extraction-only keeps the LLM seam forever. **Chosen:** dual-path, artifact-preferred, fail-loud fallback, with **Path B (opportunistic) migration** — extraction-seam is durable, artifacts adopted per-producer when convenient.
- **Coercion determinism?** **Chosen:** encode (enums in schema, direction in script); spec-readiness fails loud.
- **Governance?** **Chosen:** schema=shape, gateway=semantics.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the producer-migration posture was resolved to Path B (opportunistic) on 2026-06-09 and folded into Decision 2.

**Assumptions.**
- **Assumes:** the project has (or will accept) an ADR/decision-record convention under `docs/`. Validation: check for `records/adr/` or comparable before authoring; if none, the spike establishes the location (this is the case — `records/adr/` is created by this spike).

## 7. DONE

**From WHY**
- [ ] The ADR records a chosen answer + options-considered rationale for all four decisions (incl. Path B posture).
- [ ] No decision re-introduces run-to-run variance on a mechanically-checkable property.

**From WHAT**
- [ ] Decision 1 recorded: JSON Schema subset, `skills/faff/contracts/`, named subset keywords.
- [ ] Decision 2 recorded: dual-path artifact-preferred + fail-loud fallback + Path B (opportunistic) migration.
- [ ] Decision 3 recorded: coercion as enums (schema) + direction (script); per-contract safe target.
- [ ] Decision 4 recorded: schema=shape, gateway=semantics.
- [ ] `spec-readiness.schema.json` exists under `skills/faff/contracts/` encoding the reference shape.

**From HOW**
- [ ] A known-good example validates PASS, run under `node` with no installed dependencies.
- [ ] A known-bad example (`confidence: "maybe"`) validates FAIL with a named violation.
- [ ] The ADR writes down the wiring-check assertions FAFF-77 must implement.
- [ ] No npm dependency introduced; `JSON.parse` + hand-rolled subset checks only.

**Integration smoke test:**
```
node validate good-example.json spec-readiness.schema.json  → exit 0, no violations
node validate bad-example.json  spec-readiness.schema.json  → non-zero / violation listing "confidence"
```

## Methodology critique (agile-delivery lens)
- **Right-sized?** Yes — a 1–3 day decisions+reference-schema spike; the scope guard keeps the contract-script/adaptor work out to FAFF-77.
- **Workstream fit?** Strong — head of the contract-framework chain; unblocks FAFF-77.
- **Deps surfaced?** Yes — blocks FAFF-77 (explicit link); no hidden deps.
- **Risk profile?** This *is* the de-risking spike for the epic's novel-integration risk (principle 7); the one residual human call (migration posture) is now resolved to Path B.
