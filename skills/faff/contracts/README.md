# faff contract schemas

Machine-readable **shape** schemas for faff's fixed internal contracts — the
conformance-by-construction substrate from FAFF-21 (contract-as-code).

- **What lives here:** one `*.schema.json` per fixed contract (`spec-readiness`,
  and — added by later roll-out tickets — `review-verdict`, `delivery-outcome`,
  `automation-routing`). Schemas are **normative for shape only**; the *semantics*
  of each value live in the gateway prose. See `docs/adr/0001-contract-as-code-foundations.md`.
- **`validate-schema.mjs`:** a minimal, dependency-free JSON Schema (Draft 2020-12
  **subset**) validator — the FAFF-76 spike's proof that the chosen language works
  with zero installed dependencies (`JSON.parse` + Node builtins only). It is the
  spike's proof harness, **not** the production validator; porting it into the faff
  CLI is FAFF-77.
- **`examples/`:** known-good / known-bad contract-data examples used by the proof.

## Run the proof

```sh
node skills/faff/contracts/validate-schema.mjs --selftest
# good example -> PASS, bad example (confidence: "maybe") -> FAIL

# or validate an arbitrary file:
node skills/faff/contracts/validate-schema.mjs <data.json> skills/faff/contracts/spec-readiness.schema.json
```

Scope (FAFF-76, the spike): the **decisions** (ADR 0001) + the **spec-readiness**
reference schema + this proof harness. Contract scripts, the thin-shell adaptor
rewrite, and the `validate-adapters` wiring-check are FAFF-77 and the roll-out.
