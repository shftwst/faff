# Spec — FAFF-253: PRD-admissibility gate

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous (beep-boop run-20260626-220907) · confidence: high (re-rated by the 2026-06-27 Resolution below). Source: Linear FAFF-253.

The **PRD-admissibility gate**: an LLM-judgment validator that reads a container's PRD and emits a structured `prd-readiness` verdict, plus a deterministic `faff contract prd-readiness` script that validates that verdict's *shape*. Builds on the `faff prd` artifact (FAFF-252, shipped).

## Resolution — Punt decided (human, 2026-06-27) → spec re-rated to high

**Punt — LLM-validator packaging → CHOSEN: ship the deterministic contract now; defer the validator.**
FAFF-253 scopes to the **deterministic half**: `computePrdReadiness` / `contractPrdReadiness` in `bin/faff` + `contracts/prd-readiness.schema.json` + the `CONTRACTS` registry entry + the `--selftest` fixture table + the documented run-start call-site contract. The **LLM validator** (reads a PRD, emits the verdict) and its packaging + run-start wiring are **deferred to FAFF-260**, because the L4 run-start orchestrator that would invoke it doesn't exist yet.

**Build coordination:** FAFF-253 **leads**, FAFF-254 follows — both touch `bin/faff` + `contracts/` for the shared `prd-readiness` surface. Serialise **253 → 254** (collision group). 253 creates the `prd-readiness` contract + schema; 254 reuses it for `prd validate --strict`.

## 1. WHY
A lights-out (L4) run is steered by the immutable human PRD. If that PRD has no **machine-checkable stop-conditions**, the loop judges its own "done" — the exact failure L4 removes. This is the **product-axis analog of the spec-readiness gate**: an LLM reads the PRD, emits a verdict; a deterministic script validates the verdict's shape (LLM reasons, script validates). Today `faff prd validate` is lenient (presence only) — a PRD with vague ends passes and could admit a run that can't terminate accountably. This adds the stricter, judgment-backed admissibility check at run-start.
**Principles:** deterministic gate-decision over a structured verdict (never a prose re-read); fail-safe toward **refusal** (never coerce toward admissible); right-sized (the gate, not the born-verifiable stop-condition *form* — that's FAFF-254).

## 2. OUT OF SCOPE
- Born-verifiable stop-condition *representation* → FAFF-254 (this gate *judges* whatever form it takes).
- Spec-side mechanical DoD gate (FAFF-224) — sibling at a different altitude (per-spec, mechanical) vs this (PRD-level, LLM).
- Spec-stage adversarial review (FAFF-9) — heavier judgment layer above this.
- The downstream YAGNI/PRDR reviewer that *consumes* `creative_licence`.
- The L4 lights-out run-start orchestrator itself (not built yet — this defines its call-site contract).
- `faff prd validate` changes (the lenient check stays; admissibility is separate).
- **The LLM validator itself + its packaging + run-start wiring → FAFF-260** (deferred per the Resolution above).

## 3. WHAT
**LLM validator** (FAFF-260) reads `docs/prd/<container>.md`, emits one `faff-contract:prd-readiness` block (last thing in output), judging: (1) verifiable stop-conditions present? (2) creative-licence envelope (`broad`/`tight`).
```
RECORD PrdReadinessExtraction:   # producer emits
  verdict: "admissible"|"not-ready"
  reason: String                 # "" iff admissible; ∈ {no-stop-conditions, ambiguous-stop-conditions, other}
  stop_conditions_verifiable: Boolean
  creative_licence: "broad"|"tight"
RECORD PrdReadinessContractData: # faff contract emits = extraction + conformant + violations[]
```
**CLI:** `faff contract prd-readiness [--in FILE]` / `--selftest` (exit 0 conformant / 1 violations / 2 fail-loud).
**Chosen:** fail-loud no-safe-coerce (faff's own producer, like spec-readiness); `reason` closed-set with normalisation to `other`+violation; `creative_licence` binary; L4-only gate (sibling FAFF-224 precedent).

## 4. HOW
Two halves split on the deterministic/LLM line, mirroring the 5 existing contracts. **This ticket ships the deterministic half only.** Add `computePrdReadiness` + `contractPrdReadiness` to `bin/faff` (modelled on `computeReviewVerdict`): fail-loud on non-object / verdict-out-of-enum / creative_licence-out-of-enum; violations for not-ready-no-reason, out-of-set-reason (→`other`), admissible-with-reason, admissible-but-unverifiable; belt-and-braces `schemaCheck(_, "prd-readiness")`; register in `CONTRACTS` (no `cmdContract` change). Add `contracts/prd-readiness.schema.json` (shape-normative, `additionalProperties:false`).

**Run-start gate (call-site contract — documented, built in FAFF-260):** resolve PRD via `faff prd path`, invoke validator, pipe block to `faff contract prd-readiness`, branch: admissible→admit; not-ready→refuse+escalate; violations/fail-loud→refuse (fail-safe). Edge: missing PRD → refuse (not crash); absent-block → fail-loud → refuse.
**Anti-patterns:** LLM judgment inside the dependency-free CLI; coercing malformed → admissible.

## 5. Scenarios
- concrete machine-checkable PRD criteria → `admissible`, exit 0.
- no done-criteria → `not-ready`/`no-stop-conditions` → gate REFUSES + escalates.
- `verdict:"maybe"` → fail-loud exit 2 → REFUSE (never coerces).
- novel reason string → normalised `other` + violation, exit 1.

## 8. DONE (deterministic half — this ticket)
contracts/prd-readiness.schema.json + `computePrdReadiness`/`contractPrdReadiness` + CONTRACTS registry entry + `--selftest` fixture table (admissible/not-ready/violations/fail-loud cases); the run-start call-site contract documented; additive (no `cmdContract`/`prd validate` change). Smoke: 3 piped `faff contract prd-readiness` cases (admissible exit0, not-ready exit0, bad-verdict exit2).

confidence: high
