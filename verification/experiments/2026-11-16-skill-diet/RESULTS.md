# Skill diet measurements

Qualified source savings: **94,511 bytes and 23,289 estimated tokens**, from five body/reference cuts and 26 shorter discovery descriptions. Pending candidates are excluded. Draft PR: https://github.com/shftwst/faff/pull/1202.

Baseline: `a8509086ad28fa0e55cf3d1d818f2055294e663b`. Current measured source commit: `d4c11473f64f93da4287af48282393eb21c126d5`. The 41-file set falls from 1,369,435 to 1,274,924 bytes, and from 339,279 to 315,990 estimated tokens. Estimates use ceil(UTF-16 characters/4) per file, summed; they are not provider usage or billing.

## Source reductions

| Slice | Bytes before | After | Saved | Tokens before | After | Saved |
|---|---:|---:|---:|---:|---:|---:|
| faff | 12,984 | 5,832 | 7,152 | 3,222 | 1,458 | 1,764 |
| faffter-dark-adversarial-review | 74,897 | 22,259 | 52,638 | 18,574 | 5,565 | 13,009 |
| faffidavit-rendering | 24,639 | 11,288 | 13,351 | 6,040 | 2,777 | 3,263 |
| faffter-noon-methodology-thematic | 35,118 | 29,418 | 5,700 | 8,672 | 7,281 | 1,391 |
| shared kernel configuration | 95,418 | 84,072 | 11,346 | 23,652 | 20,857 | 2,795 |
| 26 discovery descriptions | 832,740 | 828,416 | 4,324 | 206,322 | 205,255 | 1,067 |

The 26 description-only files exclude the four skills with qualified body cuts. `ledger.json` reconciles exactly to the complete committed source set. Any later body cut starts after its accepted description, avoiding double counting. No new mandatory reads were introduced.

## Fidelity before and after

Every paired row below has five fresh samples per arm and complete native tool-log audits. All measured pairs use Claude Opus 5.5, medium effort, CLI 2.1.325. No Astra results have been counted.

| Slice | Before | After | Executed boundary |
|---|---|---|---|
| Gateway | 25/25 entry cases; 85/85 decisions | Same | Real CLI and private Git, controlled downstream stubs |
| Adversarial review | 50/50 execution; 40/40 challenge consumptions; 185/185 decisions; 40/40 artifact judgements | Same | Real helper, checkpoint, contract and merge-floor commands; controlled provider inputs |
| Rendering | 45/45 persisted artifacts; 100/100 assessed decisions | Same | Actual transformed artifacts, all 90 read during review |
| Catalogue | 175/175 selections | Same | Discovery choice only, no selected workflow execution |
| Thematic | 15/15 ticket proposals; 60/60 decisions; 5/5 policy outputs; 45/45 run-done cases and contract checks | Same | Persisted proposals plus real termination-policy consumption |
| Kernel configuration | 45/45 execution; 120/120 decisions | Same | Real config reads/writes, refusal paths and slot resolution with downstream stubs |

Rendering raw decision scores are 95/100 per arm; the separately recorded assessment accepts the correct heading with its Markdown marker. Adversarial assessments record three permitted output-existence probes. Original failures, captures and corrections remain preserved. Kernel V2/V3 native protocol failures are not pooled into qualified V4. The catalogue V1 selection regression was resolved by restoring the jot and prep descriptions.

Qualification files bind source, reports, native audits and manual artifact reviews. `kernel-v4-rule-inventory.json` covers all 474 deleted blocks: 21 moved and 453 mapped, none uncovered. Adapter lint, targeted execution checks and size ratchets pass. Earlier observations and failed treatments are retained in [the measurement journal](MEASUREMENT-JOURNAL.md).

## Limits and pending work

These are bounded comparisons, not statistical equivalence or proof of complete graft/ship, live tracker mutation or hosted publication. Untested mutation sections of the thematic skill remain byte-identical. Source totals count all tracked prose, not one prompt; `load-manifest.json` and `kernel-v4-after-loads.json` separately describe declared entry reads, counting each dependency once.

Claude exhausted its weekly allowance during the PRD and default-review candidate sets. Those incomplete pairs are preserved and unqualified. Fresh Astra-low pairs are running for PRD and review; WTF, map and routing are queued. No Astra result or pending body cut is counted yet. The WTF candidate was revised for omitted offers, and the review candidate for mismatched prose/JSON titles. The agile cut is held: manual review found an unsupported UI dependency qualifier in an Astra baseline diagnosis, failing the frozen all-artifact semantic bar. This is a baseline failure, not evidence of a candidate regression. The candidate continuation was cancelled and its measurement lane moves to routing. All PR CI checks pass at `43c8e46f`, including all unit shards, the full Node 24 source-build suite, adapter lint, macOS validation and governance checks.

Additional downstream checks are prepared: all actual review artifacts will pass through the production stored-comment connector with exact persisted-byte checks, and all PRD artifacts through the run-start and run-trigger CLIs under four controlled contexts. The one-review and six-PRD preflights pass; full replays await complete pairs. These are deterministic caller checks, not additional model samples or full caller workflows.
