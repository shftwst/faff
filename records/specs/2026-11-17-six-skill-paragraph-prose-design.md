# Shorten six skill explanations

## Scope

Compress explanatory paragraphs in map, routing, nlspec and the default spec, evaluator and ship skills. Preserve commands, schemas, headings, tables, examples and every operational boundary. No runtime changes, policy fixes or new mandatory reads. This inventory covers actual deletions from the two source commits; semantic preservation requires independent review.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Roadmap shape is deduced from the tracker. faff does not read a project "methodology doc" and no .faff/co` | changed: same rule, shorter explanation |
| `Always pull the whole roadmap fresh per the shared Always pull fresh rule (gateway): every invocation re-` | changed: same rule, shorter explanation |
| `Below each initiative's block, add one line of recent grounding: "ISSUE-XX (just merged) belongs here — [` | changed: same rule, shorter explanation |
| `Structural-graph risks come from backlog-diagnostics, every pass — never from whether tidy ran. Request t` | changed: same rule, shorter explanation |
| `Optional tidy-log enrichment (never the source). If a /faff-tidy run produced a ### Structural diagnostic` | changed: same rule, shorter explanation |
| `Three to five sentences max. Lead with how many outcomes are in flight, whether the chain joins up end-to` | changed: same rule, shorter explanation |
| `Log the full pass to .faff/logs/YYYY-MM-DD/HHMMSS-map.md. The log must include every MCP call made (initi` | changed: same rule, shorter explanation |
| `How this contract reaches you. The fixed definition is loaded by the invoking consumer (/faff-tidy / /faf` | changed: same rule, shorter explanation |
| `The adaptor assigns exactly one per Todo issue with a discoverable spec. The authoritative definition is ` | changed: same rule, shorter explanation |
| `Validation is conformance by construction: this adaptor does not prose-check the verdict's shape. It extr` | changed: same rule, shorter explanation |
| `Open with the load-bearing model. The WHY's first paragraph states the one idea the reader needs to under` | changed: same rule, shorter explanation |
| `This line is consumed by faff-prep for its gate decision (autonomous mode: high → promote; medium → attac` | changed: same rule, shorter explanation |
| `This producer discharges the spec slot's quality bar by inheritance, not by defining a second one: before` | changed: same rule, shorter explanation |
| `- Nesting therefore stays single-level by construction for this producer — the top-level case the inherit` | changed: same rule, shorter explanation |
| `After the prose spec and the confidence: line, append one fenced code block — tagged faff-contract:spec-r` | changed: same rule, shorter explanation |
| `The default evaluator occupant exercises a spec's born-verifiable done-criteria against a running provisi` | changed: same rule, shorter explanation |
| `One pass judges outcomes, never reads code: exercise the feature externally and report each criterion wit` | changed: same rule, shorter explanation |
| `Anti-pattern: reading the repo's own test suite to decide a verdict. Why: that re-imports the code's blin` | changed: same rule, shorter explanation |
| `The aggregate must match the derivation from the criteria, code_blind must be true, every met/unmet must ` | changed: same rule, shorter explanation |
| `The default producer for ship delivers an integrity-floor-cleared PR (AC-verified + CI-green + review pas` | changed: same rule, shorter explanation |
| `The delivery-outcome contract is fixed in the gateway — see the sibling faff/references/kernel.md → Core ` | changed: same rule, shorter explanation |
| `How this contract reaches you. The fixed definition is loaded by the invoking consumer (/faff-graft reads` | changed: same rule, shorter explanation |
| `1. Delivery-precondition check (ship-time backstop). Immediately before merging, re-run a cheap, read-onl` | changed: same rule, shorter explanation |
| `On a block, emit not-ready:precondition:<kind> — <detail>; remedy: <remedy> (the <kind> is the failing pr` | changed: same rule, shorter explanation |
| `4. Cleanup (deploy-side only). The default created no release artefacts or temp deploy state, so there is` | changed: same rule, shorter explanation |
| `On a merge conflict or any gh failure, the producer declares failed:<reason> (e.g. failed:merge conflict ` | changed: same rule, shorter explanation |
| `After the native result (step 5), append one fenced block tagged faff-contract:delivery-outcome, last in ` | changed: same rule, shorter explanation |
| `A single markdown document following the four-phase arc below, ending with a confidence self-rating line.` | changed: same rule, shorter explanation |
| `Self-rating downgrade rule. If the review surfaces ≥1 blocker or ≥3 major findings, the spec cannot self-` | changed: same rule, shorter explanation |
| `This line is consumed by faff-prep for its autonomous gate decision (high → promote; medium → attach + fl` | changed: same rule, shorter explanation |
| `After the prose spec and the confidence: line, append one fenced code block — tagged faff-contract:spec-r` | changed: same rule, shorter explanation |
