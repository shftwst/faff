# PRD producer skill diet

## Scope and proof

Consolidate repeated code-blind trust-boundary and contract explanations. Keep
both rubric questions, the at-least-one criterion, conservative refusal, closed
verdict/reason shapes, standalone kernel read, and sole deterministic caller gate.
The accepted catalogue description and all frontmatter remain unchanged.

Six PRD reads produce actual persisted artifacts that the real prd-readiness
validator consumes. Eight decisions remain separately counted. Require five
baseline/candidate samples, all intended cases, complete native audits and manual
reading of all sixty artifacts. No implementation inspection, run mint or complete
caller workflow is claimed. Evidence and plans are in
verification/experiments/2026-11-16-skill-diet/.

## Rule inventory

| Prose rule | Replacement owner and observable behaviour | Covering test | Disposition |
|---|---|---|---|
| `The default occupant of the prd slot — the LLM half of the PRD-admissibility gate. Given a container's PRD document — and nothing else — it answers one que` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `> When standalone, Read the sibling faff/references/kernel.md (the shared kernel) first — it holds the shared rules and the fixed contracts. This recap is ` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `## What it does` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `One pass turns a PRD document into one verdict block. The verdict is a contract, not an implementation — the caller branches on the block, never on how the` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `## Inputs` | Input retains the absolute PRD path and code/tracker/context/spec blindness. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- The PRD document — given as an absolute file path (resolved upstream by faff prd path <container>), which this skill reads. That one PRD file is the only` | Input retains the absolute PRD path and code/tracker/context/spec blindness. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- Never the codebase, the tracker, the run context, or any spec. Code-blind by construction: the verdict describes the PRD, not an implementation, so it ca` | Input retains the absolute PRD path and code/tracker/context/spec blindness. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `## The rubric (the LLM applies this)` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `1. Stop-conditions verifiable? — Are the PRD's done-criteria concrete and machine-checkable? Each must be either a Given/When/Then scenario or a single MUS` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `2. Creative-licence envelope (broad \| tight) — How much latitude does the implementation team have? tight = the PRD prescribes specific implementation cho` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `Verdict: admissible when at least one stop-condition is verifiable; not-ready when all criteria are vague or absent.` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `## Output (the contract artifact)` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `Emit exactly one fenced block last in output — the caller locates it, JSON.parses it, and pipes it to faff contract prd-readiness (the sole source of contr` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `Shape rules the contract enforces — emit a conformant block, do not re-validate here:` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- verdict and creative_licence are each one of a closed pair (canonical semantics: faff contract prd-readiness --describe).` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- admissible requires stop_conditions_verifiable: true and an empty reason.` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- not-ready carries a non-empty reason from the closed reason set — no done-criteria at all, criteria present but none machine-checkable, or a reason outsi` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `## Rules` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- Judge the PRD as written — never infer stop-conditions the PRD does not state, and never soften a vague PRD toward admissible to unblock a run. When in d` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- Produce the block; the admit/refuse decision belongs to the caller piping it to faff contract prd-readiness. This skill emits a verdict, it does not gate` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
| `- A swapped-in validator (a different rubric or model) conforms by emitting the same block.` | Rubric and Output retain verifiable-stop judgement, creative licence, conservative refusal and deterministic contract ownership. | test/prd-producer.test.mjs | changed: consolidate duplicate explanation while retaining the rule |
