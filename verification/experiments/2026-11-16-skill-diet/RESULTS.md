# Skill diet measurements

Qualified source savings: **96,260 bytes and 23,719 estimated tokens**, from six body/reference cuts and 26 shorter discovery descriptions. Pending candidates are excluded. Draft PR: https://github.com/shftwst/faff/pull/1202.

Baseline: `a8509086ad28fa0e55cf3d1d818f2055294e663b`. Current measured source commit: `ce02b49ac0428e03daae4c3ae8f77eee4dcd008c`. The 41-file set falls from 1,369,435 to 1,273,175 bytes, and from 339,279 to 315,560 estimated tokens. Estimates use ceil(UTF-16 characters/4) per file, summed; they are not provider usage or billing.

## Source reductions

| Slice | Bytes before | After | Saved | Tokens before | After | Saved |
|---|---:|---:|---:|---:|---:|---:|
| faff | 12,984 | 5,832 | 7,152 | 3,222 | 1,458 | 1,764 |
| faffter-dark-adversarial-review | 74,897 | 22,259 | 52,638 | 18,574 | 5,565 | 13,009 |
| faffidavit-rendering | 24,639 | 11,288 | 13,351 | 6,040 | 2,777 | 3,263 |
| faffter-noon-methodology-thematic | 35,118 | 29,418 | 5,700 | 8,672 | 7,281 | 1,391 |
| shared kernel configuration | 95,418 | 84,072 | 11,346 | 23,652 | 20,857 | 2,795 |
| faffter-noon-prd | 4,214 | 2,465 | 1,749 | 1,047 | 617 | 430 |
| 26 discovery descriptions | 832,740 | 828,416 | 4,324 | 206,322 | 205,255 | 1,067 |

The 26 description reductions exclude gateway, adversarial review, rendering and thematic, whose metadata changes are counted with their body cuts. The later PRD body cut starts after its accepted description. `ledger.json` reconciles exactly to the committed source set, with no double counting or new mandatory reads.

## Fidelity before and after

Every paired row has five fresh samples per arm and complete native tool-log audits. Gateway through kernel configuration use Claude Opus 5.5, medium effort, CLI 2.1.325. PRD uses a separate fresh Astra-low pair, verified as gpt-6-astra / low / Codex CLI 0.169.0; no Claude samples are pooled into it.

| Slice | Before | After | Executed boundary |
|---|---|---|---|
| Gateway | 25/25 entry cases; 85/85 decisions | Same | Real CLI and private Git, controlled downstream stubs |
| Adversarial review | 50/50 execution; 40/40 challenge consumptions; 185/185 decisions; 40/40 artifact judgements | Same | Real helper, checkpoint, contract and merge-floor commands; controlled provider inputs |
| Rendering | 45/45 persisted artifacts; 100/100 assessed decisions | Same | Actual transformed artifacts, all 90 read during review |
| Catalogue | 175/175 selections | Same | Discovery choice only, no selected workflow execution |
| Thematic | 15/15 ticket proposals; 60/60 decisions; 5/5 policy outputs; 45/45 run-done cases and contract checks | Same | Persisted proposals plus real termination-policy consumption |
| Kernel configuration | 45/45 execution; 120/120 decisions | Same | Real config reads/writes, refusal paths and slot resolution with downstream stubs |
| PRD producer | 30/30 artifacts; 40/40 decisions; 120/120 downstream cases | Same | Real PRD reads and contract consumption; all 60 artifacts read; deterministic coverage/run-start/run-trigger replay rejects 120 forged decisions per arm |

Rendering raw decision scores are 95/100 per arm; the separately recorded assessment accepts the correct heading with its Markdown marker. Adversarial assessments record three permitted output-existence probes. Original failures, captures and corrections remain preserved. Kernel V2/V3 native protocol failures are not pooled into qualified V4. The catalogue V1 selection regression was resolved by restoring the jot and prep descriptions.

Qualification files bind source, reports, native audits and manual artifact reviews. `prd-astra-v2-rule-inventory-fixed.json` covers all 495 deleted blocks: 26 moved and 469 mapped, none uncovered. The PRD integration passes 539 tests and adapter lint; the initial inventory formatting failure is preserved. Adapter lint, targeted execution checks and size ratchets pass. Earlier observations and failed treatments are retained in [the measurement journal](MEASUREMENT-JOURNAL.md).

## Limits and pending work

These are bounded comparisons, not statistical equivalence or proof of complete graft/ship, live tracker mutation or hosted publication. Untested mutation sections of the thematic skill remain byte-identical. Source totals count all tracked prose, not one prompt; `load-manifest.json` and `prd-astra-v2-after-loads.json` separately describe declared entry reads, counting each dependency once.

Claude exhausted its weekly allowance during the PRD and default-review candidate sets. Those incomplete pairs are preserved and unqualified. The separate Astra PRD pair is qualified. Review and WTF comparisons are running; routing has begun, with a candidate prepared; map is queued. Pending body cuts remain excluded from totals. The WTF candidate was revised for omitted offers, and the review candidate for mismatched prose/JSON titles. The agile cut is held: manual review found an unsupported UI dependency qualifier in an Astra baseline diagnosis, failing the frozen all-artifact semantic bar. This is a baseline failure, not evidence of a candidate regression. The candidate continuation was cancelled and its measurement lane moves to routing. All PR CI checks pass at `43c8e46f`, including all unit shards, the full Node 24 source-build suite, adapter lint, macOS validation and governance checks.

The full PRD downstream replay passes all 240 cases and rejects 240 forged decisions. The review replay is queued after its pair, with the production connector preflight already passing. These are deterministic caller checks, not additional model samples or full caller workflows.
