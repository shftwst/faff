---
name: faffter-noon-prd-validator
description: "Default `prd_validator` slot occupant — the code-blind PRD-admissibility validator. Given only a PRD document, it judges whether the PRD's stop-conditions are machine-verifiable and how wide the implementation's creative licence is, then emits one `faff-contract:prd-readiness` block. The L4 run-start gate pipes that block to `faff contract prd-readiness` to admit or refuse the run. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: prd-readiness
---

# faffter-noon-prd-validator

The default occupant of the **`prd_validator`** slot — the LLM half of the PRD-admissibility gate. Given a container's PRD document — and **nothing else** — it answers one question the L4 run-start gate needs before a lights-out run may mint: does this PRD state a machine-verifiable done-signal, so an unattended run is terminable and auditable rather than free to loop forever against vague prose goals? It emits one `faff-contract:prd-readiness` verdict; the deterministic `faff contract prd-readiness` check validates that verdict's shape and makes the admit/refuse call.

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

## What it does

One pass turns a PRD document into one verdict block. The verdict is a **contract**, not an implementation — the caller branches on the block, never on how the PRD was read, so any validator conforms by emitting the same block. The trust boundary is fixed: the LLM judges the two rubric questions below; `faff contract prd-readiness` validates the block's shape and is the sole gate. The gate is fail-safe toward **refusal** — a malformed or missing block never coerces toward `admissible`.

## Inputs

- **The PRD document** — given as an absolute file path (resolved upstream by `faff prd path <container>`), which this skill reads. That one PRD file is the *only* thing it reads.
- **Never** the codebase, the tracker, the run context, or any spec. Code-blind by construction: the verdict describes the PRD, not an implementation, so it cannot be talked into a pass by plausible code.

## The rubric (the LLM applies this)

1. **Stop-conditions verifiable?** — Are the PRD's done-criteria concrete and machine-checkable? Each must be either a Given/When/Then scenario or a single MUST/comparator assertion. Loose prose ("the system should be stable", "users will be satisfied") is **not** verifiable. `stop_conditions_verifiable: true` requires at least one verifiable stop-condition; `false` when all criteria are vague or absent.
2. **Creative-licence envelope** (`broad` | `tight`) — How much latitude does the implementation team have? `tight` = the PRD prescribes specific implementation choices (technology, API shapes, data models). `broad` = the PRD states goals/behaviours with wide implementation space. Forward-carried to calibrate downstream scope strictness; it is **never** gate-decisive here.

**Verdict:** `admissible` when at least one stop-condition is verifiable; `not-ready` when all criteria are vague or absent.

## Output (the contract artifact)

Emit exactly one fenced block **last** in output — the caller locates it, `JSON.parse`s it, and pipes it to `faff contract prd-readiness` (the sole source of contract data):

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```

Shape rules the contract enforces — emit a conformant block, do not re-validate here:

- `verdict` is `admissible` or `not-ready`; `creative_licence` is `broad` or `tight`.
- `admissible` requires `stop_conditions_verifiable: true` and an **empty** `reason`.
- `not-ready` carries a non-empty `reason` — one of `no-stop-conditions` (no done-criteria at all), `ambiguous-stop-conditions` (criteria present but none machine-checkable), or `other`.

## Rules

- Judge the PRD as written — never infer stop-conditions the PRD does not state, and never soften a vague PRD toward `admissible` to unblock a run. When in doubt, `not-ready` is the safe verdict.
- Produce the block; the admit/refuse decision belongs to the caller piping it to `faff contract prd-readiness`. This skill emits a verdict, it does not gate.
- A swapped-in validator (a different rubric or model) conforms by emitting the same block.
