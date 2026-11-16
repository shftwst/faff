# Skill diet measurements

Qualified source savings: **101,620 bytes and 25,038 estimated tokens**, from seven body/reference cuts and 26 shorter discovery descriptions. Pending candidates are excluded. Draft PR: https://github.com/shftwst/faff/pull/1202.

Baseline: `a8509086ad28fa0e55cf3d1d818f2055294e663b`. Current measured source commit: `f6324f6112eeb54999aeda04c20245edac7187a9`. The 41-file set falls from 1,369,435 to 1,267,815 bytes, and from 339,279 to 314,241 estimated tokens. Estimates use ceil(UTF-16 characters/4) per file, summed; they are not provider usage or billing.

## Source reductions

| Slice | Bytes before | After | Saved | Tokens before | After | Saved |
|---|---:|---:|---:|---:|---:|---:|
| faff | 12,984 | 5,832 | 7,152 | 3,222 | 1,458 | 1,764 |
| faffter-dark-adversarial-review | 74,897 | 22,259 | 52,638 | 18,574 | 5,565 | 13,009 |
| faffidavit-rendering | 24,639 | 11,288 | 13,351 | 6,040 | 2,777 | 3,263 |
| faffter-noon-methodology-thematic | 35,118 | 29,418 | 5,700 | 8,672 | 7,281 | 1,391 |
| shared kernel configuration | 95,418 | 84,072 | 11,346 | 23,652 | 20,857 | 2,795 |
| faffter-noon-prd | 4,214 | 2,465 | 1,749 | 1,047 | 617 | 430 |
| faffter-noon-review | 13,405 | 8,045 | 5,360 | 3,327 | 2,008 | 1,319 |
| 26 discovery descriptions | 832,740 | 828,416 | 4,324 | 206,322 | 205,255 | 1,067 |

The 26 description reductions exclude gateway, adversarial review, rendering and thematic, whose metadata changes are counted with their body cuts. The later PRD and review body cuts start after their accepted descriptions. `ledger.json` reconciles exactly to the committed source set, with no double counting or new mandatory reads.

## Fidelity before and after

Every paired row has five samples per arm and complete native tool-log audits. Review V4 uses five new candidates with the unchanged five successful V3 baselines; earlier candidate samples are excluded. Gateway through kernel configuration use Claude Opus 5.5, medium effort, CLI 2.1.325. PRD uses a separate fresh Astra-low pair; review uses a separate Astra-low comparison, verified as gpt-6-astra / low / Codex CLI 0.169.0; no Claude samples are pooled into it.

| Slice | Before | After | Executed boundary |
|---|---|---|---|
| Gateway | 25/25 entry cases; 85/85 decisions | Same | Real CLI and private Git, controlled downstream stubs |
| Adversarial review | 50/50 execution; 40/40 challenge consumptions; 185/185 decisions; 40/40 artifact judgements | Same | Real helper, checkpoint, contract and merge-floor commands; controlled provider inputs |
| Rendering | 45/45 persisted artifacts; 100/100 assessed decisions | Same | Actual transformed artifacts, all 90 read during review |
| Catalogue | 175/175 selections | Same | Discovery choice only, no selected workflow execution |
| Thematic | 15/15 ticket proposals; 60/60 decisions; 5/5 policy outputs; 45/45 run-done cases and contract checks | Same | Persisted proposals plus real termination-policy consumption |
| Kernel configuration | 45/45 execution; 120/120 decisions | Same | Real config reads/writes, refusal paths and slot resolution with downstream stubs |
| PRD producer | 30/30 artifacts; 40/40 decisions; 120/120 downstream cases | Same | Real PRD reads and contract consumption; all 60 artifacts read; deterministic coverage/run-start/run-trigger replay rejects 120 forged decisions per arm |

| Review producer | 35/35 artifacts; 100/100 decisions; 35/35 stored-comment handoffs | Same | Real review-verdict consumer and stored-comment connector; all 70 outputs read; exact prose/JSON titles and preserved comment bytes checked |

Rendering raw decision scores are 95/100 per arm; the separately recorded assessment accepts the correct heading with its Markdown marker. Adversarial assessments record three permitted output-existence probes. Original failures, captures and corrections remain preserved. Kernel V2/V3 native protocol failures are not pooled into qualified V4. The catalogue V1 selection regression was resolved by restoring the jot and prep descriptions.

Qualification files bind source, reports, native audits and manual artifact reviews. `review-astra-v4-main-rule-inventory.json` covers all 560 deleted blocks: 28 moved and 532 mapped, none uncovered. The PRD integration passes 539 tests and adapter lint; the initial inventory formatting failure is preserved. Adapter lint, targeted execution checks and size ratchets pass. Earlier observations and failed treatments are retained in [the measurement journal](MEASUREMENT-JOURNAL.md).

## Limits and pending work

These are bounded comparisons, not statistical equivalence or proof of complete graft/ship, live tracker mutation or hosted publication. Untested mutation sections of the thematic skill remain byte-identical. Source totals count all tracked prose, not one prompt; `load-manifest.json` and `review-astra-v4-after-loads.json` separately describe declared entry reads, counting each dependency once.

Claude exhausted its weekly allowance during the PRD and default-review candidate sets. Those incomplete pairs are preserved and unqualified. The separate Astra PRD and review comparisons are qualified. Review V3 passed functional, native, title and downstream checks but failed integration enum lint. V4 separates the existing judgement conditions and passes all those checks plus 641 integration tests and adapter lint. Sentence-style finding titles occur in both arms; perfect noun-phrase style is not claimed.

WTF V2 passes automatic checks but is held because two candidate reports omit the full-groom offer. V3 adds a reminder and is being measured in a fresh Sol-medium pair. An independent review also found omitted empty automation subsections in both older Astra arms; the new manual gate includes that rule. Intake's earlier exact-string issue was corrected by clarifying canonical identifier spelling. Later Astra trials stopped on provider usage limits. Fresh Sol pairs cover intake and the default spec reviewer as well. No pending savings are counted.

The operator requested continuation after the original time window and calibration of Sol medium against preserved Opus gateway/rendering results. The same policy, fixture and runtime hashes are used, with provider, native-tool, guidance-content and timeout differences disclosed. The initial Sol model-expectation audit error is corrected by re-auditing original captures, retaining the first reports; samples are not replaced.

Other held cuts remain excluded: routing varies its baseline root-cause assignment and fails the frozen exact projection; ADR-body adds an unsupported acceptance-event date; map omits the required TL;DR section; agile adds an unsupported dependency qualifier. Those are baseline failures, not measured candidate regressions. Candidate continuations were stopped. All PR CI checks passed at bc66798c; the newly committed review source is awaiting its own CI.

The full PRD downstream replay passes all 240 cases and rejects 240 forged decisions. The accepted review V4 replay passes for all 70 actual artifacts, with one acknowledged stored-comment write each and exact preserved content/newlines. These are deterministic caller checks, not additional model samples or full caller workflows.
