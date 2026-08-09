# Spec — FAFF-77: Spec-contract vertical slice

> Spec: faffter-dark-nlspec · 2026-06-09 · interactive · adaptor: faffidavit-spec · confidence: high. Full spec on Linear FAFF-77.

Builds directly to FAFF-76's settled decisions (ADR 0001); does not re-litigate them.

## 1. WHY — Problem and Principles

**Problem.** `faffidavit-spec` validates conformance with prose checks and has **no coercion** — the leniency hotspot FAFF-21 targets. FAFF-76 settled the architecture and landed a reference schema + `validateAgainstSchema`; this slice turns that into a working vertical: a deterministic **contract script** in the faff CLI that emits the spec-readiness contract data, `faffidavit-spec` rewritten as a **thin shell** wiring to it, and a `validate-adapters` **wiring-check** enforcing the script is the sole source of contract data.

**Principles.**
- **The script is the SOLE source of contract data (load-bearing).** "Check the wiring" is only sound if the adaptor's contract output *is* the script's output verbatim.
- **Deterministic tools over prose.** All conformance/shape computation moves into the script; only prose→structured *extraction* (the LLM seam, FAFF-76 Decision 2 Path B) stays in the adaptor.
- **Schema = shape, gateway = semantics (FAFF-76 Decision 4).** The script must not encode gate meanings (high→promote, medium→needs-decision-first, low→park).
- **Preserve the zero-dependency CLI invariant.** Port `validateAgainstSchema` as plain CommonJS; no npm deps, no importing the ESM `.mjs`.

## 2. OUT OF SCOPE
- The other three contracts (review-verdict, delivery-outcome, automation-routing) — prove one first.
- Producer artifact migration — FAFF-76 chose Path B (opportunistic).
- Fully-deterministic extraction (regex marker detection) — an optimisation beyond this slice.
- Removing other faffidavit-* adaptors' prose validation — only the spec adaptor is in this slice.

## 3. WHAT — Vocabulary, Types, Interfaces

**Extraction JSON (script input — assembled by the adaptor's LLM seam):**
```
RECORD Extraction:
  confidence: String              # verbatim token from the spec's trailing `confidence:` line
  provenance_present: Boolean      # did the adaptor find a well-formed provenance stamp under H1
  decisions: List<{ marker: ENUM{chosen, punt, assumes, none} }>
```

**Contract data (script output — canonical, schema-valid, FAFF-76 shape):**
`{ confidence: high|medium|low, decisions: [{classification: closed|open|external}], markers_valid: bool, violations: [string] }`

**Marker → classification map (deterministic):** chosen→closed, punt→open, assumes→external, none→(violation).

### Decision A — CLI subcommand surface
**Chosen:** `faff contract <contract-name>` — here `faff contract spec-readiness`. Reads extraction JSON from stdin (or `--in <file>`); writes contract-data JSON to stdout; `--selftest` runs built-in fixtures. Rejected: `validate-contract` (verb implies pass/fail); a separate binary.

### Decision B — Compute split
**Chosen:** the adaptor supplies only the extraction; the script does all conformance computation and validates its output against the schema. Rejected: adaptor assembles full contract data (would defeat the wiring-check).

### Decision C — Exit-code / fail-loud semantics
**Chosen:** 0 conformant (markers_valid:true, violations:[]) / 1 non-conformant verdict (marker:none or provenance_present:false → contract data with markers_valid:false + violations) / 2 fail-loud (extraction unparseable / missing keys, or confidence absent or not in {high,medium,low}; no contract data) — the FAFF-76 Decision 3 "spec-readiness has no safe coerce target".

### Decision D — Validator port
**Chosen:** copy `validateAgainstSchema` into the CLI as plain CommonJS (same subset keywords); schema-validate the emitted contract data. Rejected: importing the ESM `.mjs`.

### Decision E — validate-adapters wiring-check
**Chosen:** extend `checksFor` so the spec adaptor is checked for: (1) names `faff contract spec-readiness`; (2) the contract resolves (schema exists); (3) declares the script the sole source of contract data, old prose-marker checklist gone.

## 4. HOW — Approach
```
faff contract spec-readiness (deterministic):
  1. parse stdin JSON → fail-loud (exit 2) if unparseable / missing confidence|decisions
  2. confidence ∉ {high,medium,low} → fail-loud (exit 2)
  3. each decision: marker→classification; marker==none → violation
  4. provenance_present==false → violation
  5. markers_valid = violations.length === 0
  6. contractData = {confidence, decisions:[{classification}], markers_valid, violations}
  7. validateAgainstSchema(contractData, schema) non-empty → fail-loud (exit 2)
  8. print contractData; exit 0 if markers_valid else 1
```
`--selftest`: conformant→exit0; missing-marker→exit1; bad-confidence→exit2; malformed→exit2; exit 0 only if all behave.

**faffidavit-spec SKILL.md:** replace Validation section with "build Extraction JSON → invoke `faff contract spec-readiness` → return its stdout as the contract data verbatim"; preserve the provenance-stamp section; add the sole-source declaration line.

**Anti-patterns:** adaptor computing markers_valid/violations itself; script encoding gate meanings.

## 5. DESIGN DECISION RATIONALE
See Decisions A–E above (each Chosen with rejected alternatives).

## 6. OPEN QUESTIONS AND ASSUMPTIONS
**Open Questions.** None.
**Assumptions.** spec-readiness.schema.json + validateAgainstSchema exist on main (FAFF-76, #28) — verified. validateAgainstSchema kept consistent between the .mjs proof and the CLI copy — DONE-flagged.

## 7. DONE
- [ ] faffidavit-spec produces contract data solely via the script (no prose-built path).
- [ ] Script encodes no gate semantics.
- [ ] `faff contract spec-readiness` stdin extraction JSON → stdout contract data (FAFF-76 shape).
- [ ] Marker→classification map applied; none→violation.
- [ ] Emitted contract data validates against the schema.
- [ ] Conformant → exit 0 markers_valid:true; missing-marker → exit 1 markers_valid:false; bad/absent confidence → exit 2 fail-loud; malformed → exit 2 fail-loud.
- [ ] `faff contract spec-readiness --selftest` exits 0; added to CI.
- [ ] USAGE updated with `contract`.
- [ ] faffidavit-spec Validation delegates to the script; six-rule prose checklist removed.
- [ ] Provenance-stamp section unchanged; trailing confidence line authoritative.
- [ ] SKILL.md carries the sole-source declaration.
- [ ] validate-adapters asserts the wiring; fails if the adaptor bypasses the script.
- [ ] Full CI backstop green incl. contract --selftest.

**Integration smoke test:**
```
echo '{"confidence":"high","provenance_present":true,"decisions":[{"marker":"chosen"},{"marker":"punt"}]}' | node skills/faff/bin/faff contract spec-readiness
# → {"confidence":"high","decisions":[{"classification":"closed"},{"classification":"open"}],"markers_valid":true,"violations":[]}  exit 0
echo '{"confidence":"maybe","provenance_present":true,"decisions":[]}' | node skills/faff/bin/faff contract spec-readiness ; echo $?  # → exit 2
node skills/faff/bin/faff validate-adapters   # → spec adaptor wiring-check passes
```

confidence: high
