---
name: faffter-noon-prd
description: "Default code-blind prd slot: judge machine-verifiable PRD stop conditions and creative licence; emit prd-readiness for the deterministic L4 run-start gate."
user-invocable: false
judgement_seam: prd-readiness
---

# faffter-noon-prd

Default `prd` slot: judge a container PRD's machine-verifiable stop conditions and creative licence before an L4 run can mint. Emit a `faff-contract:prd-readiness` verdict; `faff contract prd-readiness` alone validates and admits/refuses it. Missing or malformed output never admits.

When standalone, first Read `faff/references/kernel.md` for shared rules and fixed contracts; the kernel wins over this recap.

## Input

Read the PRD document at the supplied absolute path, resolved upstream by `faff prd path <container>`. It is the only task input. Never read the codebase, tracker, run context or specs to judge readiness; this verdict describes the PRD, not implementation quality.

## Rubric

| Question | Judgement |
|---|---|
| Verifiable stop conditions? | At least one concrete machine-checkable Given/When/Then scenario or single MUST/comparator assertion makes `stop_conditions_verifiable` true. If all criteria are absent or vague, it is false. "Stable system" or "satisfied users" is insufficient. |
| Creative licence? | `tight` when technology, API shapes or data models are prescribed; `broad` when goals/behaviours leave wide implementation space. Carry this downstream for scope strictness; it never decides this gate. |

At least one verifiable stop condition gives `admissible`; none gives `not-ready`. Judge only what is written. Never invent criteria or soften a vague PRD to unblock a run. When uncertain, choose `not-ready`.

## Output

Emit exactly one valid JSON block, last in the output:

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```

`admissible` requires true and an empty reason. For `not-ready`, use false and the non-empty closed reason for missing done-criteria, present but uncheckable criteria, or another reason. Canonical values and semantics: `faff contract prd-readiness --describe`.

The caller parses the block and pipes it to the contract CLI, the sole source of contract data and gate authority. Emit conformant data; do not re-validate or make the caller's admission decision. A replacement rubric or model conforms through the same block.
