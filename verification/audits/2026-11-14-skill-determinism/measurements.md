# Measurements and experiment protocol

Source pin and semantic scope: [audit](README.md). Reproduction uses Node 22.23.4 in this workspace. New analysis scripts use Node built-ins and existing eval helpers; no runtime dependency was added.

## Recorded readings

| Reading | Result | Interpretation |
|---|---:|---|
| All skills and references | 1,371,305 bytes; 339,730 estimated tokens | Whole installed source, not one model request |
| Skills only | 274,350 estimated tokens | Existing size census excludes the nine reference files |
| Nine reference files | 65,380 estimated tokens | Must be included in prompt budgets |
| Current graft cold entry | 107,499 estimated tokens | Own skill plus declared references |
| Current beep-boop cold entry | 100,246 estimated tokens | Own skill plus declared references |
| Exact duplicate block groups | 15 | Byte matches above 100 bytes across files; candidates, not proof of redundant obligations |
| Plugin/global description text | 2,704 / 2,596 estimated tokens | Paths, wrappers and actual harness injection are additional |
| August 29 run, transcript usage rows | 2,281 | Includes streaming snapshots; not request count |
| Same run, deduplicated requests | 843 | Existing parser takes maximum counters per request ID within each file |
| Same run, cache read / write | 155,078,239 / 4,241,578 tokens | Reproduces committed baseline exactly |
| Same run, output | 995,907 tokens | Not flagged as suspiciously low by the existing parser |
| Same run, mean / median cache read | 183,960 / 147,220 tokens | Resident prompt and accumulated history, not all attributable to skills |
| Same run, timestamp span | 24,541.753 seconds | About 6h49m; includes gaps and concurrent agents, not inference latency |

Sources: [inventory](data/inventory.json), [entry loads](data/entry-loads.json), [historical cost](data/historical-cost.json), [catalog readings](data/installed-catalog.json).

The existing `eval/prefix-planner.mjs` reports 68,610 estimated tokens for its recombined shared-prose model, an ideal declared-consumer average of 25,636, and a common-prefix contiguity penalty of 19,821. This is a design model over the usage manifest, not observed prompt residency. It excludes each entry's own body. The actual load-preamble census above is the relevant cold-entry comparison. Do not add their totals together.

## Historical cost comparisons performed

All dollar figures below use the repository's historical rate table and cache multipliers in `eval/tokenomics.mjs`. They are modelled dollars, not a new provider quote or a reconciled invoice. The original evidence README and economics output disagree about totals; this audit reproduces the deduplicated 19-transcript tokenomics baseline rather than blending those accounting paths.

| Modelled scenario on the same 843-request workload | Cost | Change |
|---|---:|---:|
| Recorded baseline at fixed prefix 66,153 | $132.913 | reference |
| Fixed prefix reduced to 30,000 | $117.222 | -11.805% |
| Fixed prefix reduced to 15,000 | $110.712 | -16.703% |
| Fixed prefix reduced to 8,300 | $107.804 | -18.891% |
| Entire fixed prefix removed, theoretical bound | $104.202 | -21.601% |

These counterfactuals preserve request count, outputs, tool history and cache-hit behaviour. They subtract from the read or write leg only when the fixed prefix fits. They do not predict fewer orchestration turns, more tool output, different retries, compaction, review quality or current model prices. The target prefixes are sensitivity points, not implemented treatments.

The prior September split-and-lean study used per-lane prefixes on this same workload: $132.913 baseline to $127.43, about 4.1% lower, with only $0.85 added savings from its final kernel slimming. It measured a much larger size reduction on light lanes than on build lanes. The current shared graft load is 63,115 versus the recorded post-lean 59,735, and beep-boop is 61,228 versus 58,073. Scope is the shared prefix only; the entry bodies add further cost. Source: `eval/baselines/post-lean-cost-snapshot-20260902.json`.

The other committed L3 baseline has 281 calls, 59.49 million cache-read tokens and `output_suspect: true`. Its $35.674 cost is unsuitable as a complete-dollar baseline because output is under-recorded. Preserve it as context/cache evidence; do not pool it into a cost-per-success average.

## Additional prior-run readings

[The committed October post-fix captures](data/post-fix-fidelity/result.json) provide newer evidence. The real `shadow-fidelity` CLI verified the source manifest and replayed 128 records: 75 base records and 53 action markers. Forty decisions were graded: `eligible` 7 agreements, `next` 18 agreements and 14 divergences classified as `wasteful`, and `run-done` 1 agreement. Six kernels have zero graded observations. This is 26 agreements out of 40 comparisons, not a whole-system success rate. The current classifier reports no `wrong` divergence; this does not prove safety of unobserved paths. Multiple decisions come from the same run and are correlated. Replay uses today's implementations and recorded kernel-version labels, so check version discipline before attributing every difference to the historical agent.

The source manifest covers 30 run IDs; marker-only and unjoined records do not all contribute graded decisions. Per-run cost artifacts are absent here, so this replay cannot price the 14 divergences. The replay result and pinned manifest are saved separately from both the September pull and August cost evidence. `shadow-fidelity reproduce` verifies the saved result.

[Local Codex readings](data/local-codex-usage.json) capture the last reported cumulative counters from five existing sessions whose metadata points exactly at this checkout, excluding this audit date. The newest matching sessions are from August, not November. They are a convenience sample, not a representative benchmark. Cached input is a subset of input, and reasoning output is a subset of output. No cost is assigned to these model IDs and token events are not labelled requests. No transcript payload is copied into the report.

[Runner fidelity](data/prior-run-fidelity.json) replays decision-capture events from the pre-existing, untracked September runner pull against the current nine-kernel replay registry. There are 11 replayable input records and 11 uncaptured actions. Every graded denominator is zero. The current analyser returns `null_result: false` nevertheless. Treat this as **no comparative evidence**, never zero divergences out of 11. The source runner directory was not changed or added to this work.

Reproduce the fidelity reading by selecting `decision-capture` and `decision-capture-action` events from the three recorded `source_files`, then calling `analyzeCorpus(records, {mapDecisionKernelCommands: readMapDecisionKernelCommands(repoRoot)})` from `plugin/skills/faff/bin/lib/shadow-fidelity.js`. A migration gate must require a positive graded denominator for every changed branch plus a coverage manifest; `null_result` alone is insufficient.

## Proposed comparison design

Use separate experiments so a cheaper model, different default reviewer or changed workload cannot masquerade as a prose saving.

| Arm | Change | What it isolates |
|---|---|---|
| Baseline | Pinned current release, prompts, defaults and fixtures | Reference |
| Discovery | One authoritative installation; internal skill catalog removed | Always-present catalog cost |
| Loading | Same rules and implementation, phase-specific prompt packaging | Loaded/resident prose cost |
| Mechanical slice | One sequence moved into CLI, same judgement rubric | Orchestration turns and control fidelity |
| Judgement compression | Same CLI and default policy, smaller judgement prompt | Rubric/quality and token changes |
| Default policy | Stronger selected occupant, unchanged prompt version | Quality, latency and cost of the product choice |

For each arm, use isolated workspaces and fresh fixture state. Pin release SHA, dirty patch digest, prompt/manifest hashes, config, model identifier, reasoning effort, model transport, tool schema digest, Node/harness versions, OS and price-table version. The existing frontier baseline is `claude-opus-5-5` at `medium`; it is historical evidence, not permission to silently use a different model. Set the actual comparison model and effort explicitly and record them for both arms.

Workload strata:

1. Read-only wtf/map: small and large tracker fixtures, connector missing, pinned connector unavailable, human edits mid-read.
2. Prep: new and refreshed specs, contradictory comments, missing/invalid contract, high/medium confidence, exhausted review, unavailable backend.
3. Graft: clean build, gate failure, stale head, red CI, existing PR, human approval required, holdout required by capability facts.
4. Beep-boop: no work, blocked work, trigger plan versus drain, same-session and peer claim, resume after interruption, sequential and parallel execution.
5. Fault/custody: malformed ledger, missing evidence, expired lease, network timeout before and after mutation, ambiguous success, withheld acknowledgement, duplicate callback.

For pure kernels and bounded commands, enumerate the finite states and run deterministic fixtures. Require exact normalised trace equality for unchanged behaviour. Compare effect attempts, actual effects, their order, exit codes, JSON contracts, relevant file bytes/hashes, tracker status/labels and final ledger states. Do not compare only final success. Every intentionally changed behaviour gets a separate reviewed oracle row.

For real-prompt runs, freeze fixtures and randomise baseline/candidate order in paired blocks. Start with five paired smoke runs per stratum to validate the recorder, then 20 paired runs for each affected judgement family. Increase to 50 when outcomes are unstable or the confidence interval crosses the predeclared margin. These are staging counts, not a claim that 20 runs proves a low failure rate. With zero failures in 20 trials, a one-sided 95% upper failure-rate bound is still about 14%; even zero in 300 only bounds it near 1%. Rare control failures need deterministic enforcement and fault injection.

Acceptance thresholds, chosen before looking at candidate results:

- Control parity: zero unexplained differing transitions and zero forbidden attempted effects. No missing scenarios, silent parser exclusions or zero denominators.
- Safety-sensitive judgement: zero new false approvals on the curated blocking cases; every disagreement reviewed against the frozen oracle. A statistical aggregate cannot waive a safety failure.
- Other judgement: candidate accuracy non-inferior within two percentage points with a paired 95% confidence interval; report per-kind results and false-positive/false-negative changes. If the sample cannot establish this, mark inconclusive and extend it rather than accept on the point estimate.
- Prompt packaging target: at least 50% reduction in heavy cold-entry estimated tokens; stretch 70%. No individual changed entry may grow without an explained exception. These are targets to validate, not promised savings.
- Whole-workload target: at least 10% lower billed/modelled cost per successful completion and no more than 5% regression in p95 end-to-end elapsed time. Report both active execution and total elapsed time, including retries and parks. Keep all failed, aborted and inconclusive runs in the denominator.

Capture first-token and completion timestamps from the harness where available, child-process start/end, CLI wall time, model request count, cold/warm cache classes, output/reasoning, tool-result sizes, compactions, retries and human interventions. Compute confidence intervals by independent run, not by treating correlated requests as independent samples. Provider-side caching cannot be guaranteed cold by making a fresh directory; report observed cache usage and use isolated prefixes to test cold behaviour separately.

No live before/after latency result is claimed in this audit. The observed historical duration and the counterfactual cost comparisons are the readings available before a candidate is implemented.

## Reproduction and checks

```bash
node eval/skill-audit.mjs --out verification/audits/2026-11-14-skill-determinism/data
node --test test/skill-audit.test.mjs test/control-parity.test.mjs
node --test test/eval-tokenomics.test.mjs test/eval-prefix-planner.test.mjs test/skill-harness.test.mjs test/harness-golden.test.mjs test/rule-inventory.test.mjs
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false node --test test/shadow-fidelity.test.mjs
node plugin/skills/faff/bin/faff validate-adapters
node plugin/skills/faff/bin/faff shadow-fidelity run --corpus verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl --manifest verification/reports/FAFF-974-post-fix-fidelity/manifest.json --out verification/audits/2026-11-14-skill-determinism/data/post-fix-fidelity --root . --json
node plugin/skills/faff/bin/faff shadow-fidelity reproduce --dir verification/audits/2026-11-14-skill-determinism/data/post-fix-fidelity --root .
```

The combined original batch contained 108 tests: 104 passed and four temporary Git-signing failures. The isolated fidelity rerun passed 14/14, resolving those four failures. The final new-tool suite passed 11/11, including historical-baseline reproduction and the numeric-overflow regression found during independent review. The shared-prose audit ran 221 existing tests across nine suites successfully; the entry audit exercised 272 cases successfully after its own process-scoped signing correction. See their test records and [validation data](data/validation.json). These are bounded checks, not a complete repository suite or certification of a future prose extraction.

The comparator accepts two JSON suites, each `{schema:1, scenarios:[...]}`. Every scenario carries `scenario`, `inputs_sha256`, `policy_sha256`, `prompt_sha256` and ordered `events`. Events contain exactly `kind`, `target`, `payload`; allowed kinds are `read`, `decision`, `effect-attempt`, `effect-result`, `artifact`, `terminal`. Each trace has evidence before exactly one final terminal. Prompt hashes may differ; input/policy hashes must match. Missing or extra scenarios fail. Object key ordering is immaterial; array/event order is preserved. There is no broad timestamp/path scrubbing. Fixture adapters must inject stable clock/identity values before capture.

```bash
node eval/control-parity.mjs --baseline before.json --candidate after.json --out comparison.json
```

Exit 0 means equality of supplied normalised traces, exit 1 means differences, and invalid input throws non-zero. The production recorder must cover real tool calls and resulting state, including denied attempts. Hand-authored traces alone are not migration evidence.
