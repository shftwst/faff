# Skill diet measurements

Qualified source savings: **109,175 bytes and 26,887 estimated tokens**, from ten body/reference cuts and 26 shorter discovery descriptions. Pending candidates are excluded. Draft PR: https://github.com/shftwst/faff/pull/1202.

Baseline: `a8509086ad28fa0e55cf3d1d818f2055294e663b`. Current measured source commit: `c650c72bc5c4b602a187d619249277325c7d2ce7`. The 41-file set falls from 1,369,435 to 1,260,260 bytes, and from 339,279 to 312,392 estimated tokens. Estimates use ceil(UTF-16 characters/4) per file, summed; they are not provider usage or billing.

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
| faffter-noon-spec-review | 9,460 | 8,055 | 1,405 | 2,345 | 2,001 | 344 |
| faff-wtf | 31,369 | 27,152 | 4,217 | 7,761 | 6,734 | 1,027 |
| faffter-noon-intake | 7,622 | 5,689 | 1,933 | 1,890 | 1,412 | 478 |
| 26 discovery descriptions | 832,740 | 828,416 | 4,324 | 206,322 | 205,255 | 1,067 |

The 26 description reductions exclude gateway, adversarial review, rendering and thematic, whose metadata changes are counted with their body cuts. The later PRD, review and spec-review body cuts start after their accepted descriptions. `ledger.json` reconciles exactly to the committed source set, with no double counting or new mandatory reads.

## Fidelity before and after

Every paired row has five samples per arm and complete native tool-log audits. Review V4 uses five new candidates with the unchanged five successful V3 baselines; earlier candidate samples are excluded. Gateway through kernel configuration use Claude Opus 5.5, medium effort, CLI 2.1.325. PRD uses a separate fresh Astra-low pair; review uses a separate Astra-low comparison, verified as gpt-6-astra / low / Codex CLI 0.169.0; no Claude samples are pooled into it. Default spec review uses a separate fresh Sol-medium pair, verified as gpt-6.1-sol / medium / Codex CLI 0.169.0.

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
| Default spec reviewer | 30/30 artifacts; 75/75 decisions; 30/30 contract/routing replays | Same | All 60 actual artifacts independently read; real contract and reject-approach consumers; 60 unfounded verdict mutations rejected |
| Intake producer | 30/30 assessed artifacts; 60/60 decisions | Same | All 60 persisted briefs independently read, exact source/contract regrading and ten native audits; no executable semantic brief consumer |
| Focus report | 15/15 artifact rubrics; 70/70 assessed decisions; 9/15 targeted manual checks | 15/15 rubrics; 70/70 decisions; 15/15 manual checks | All 30 actual reports read; source facts retained; missing offers, empty automation headers and queue partitions explicitly preserved |

Rendering raw decision scores are 95/100 per arm; the separately recorded assessment accepts the correct heading with its Markdown marker. Adversarial assessments record three permitted output-existence probes. Original failures, captures and corrections remain preserved. Kernel V2/V3 native protocol failures are not pooled into qualified V4. The catalogue V1 selection regression was resolved by restoring the jot and prep descriptions.

Qualification files bind source, reports, native audits and manual artifact reviews. `review-astra-v4-main-rule-inventory.json` covers all 560 deleted blocks: 28 moved and 532 mapped, none uncovered. The PRD integration passes 539 tests and adapter lint; the initial inventory formatting failure is preserved. Adapter lint, targeted execution checks and size ratchets pass. Earlier observations and failed treatments are retained in [the measurement journal](MEASUREMENT-JOURNAL.md).

## Limits and pending work

These are bounded comparisons, not statistical equivalence or proof of complete graft/ship, live tracker mutation or hosted publication. Untested mutation sections of the thematic skill remain byte-identical. Source totals count all tracked prose, not one prompt; `load-manifest.json` and `wtf-sol-v3-after-loads.json` separately describe declared entry reads, counting each dependency once.

Claude exhausted its weekly allowance during the PRD and default-review candidate sets. Those incomplete pairs are preserved and unqualified. The separate Astra PRD and review comparisons are qualified. Review V3 passed functional, native, title and downstream checks but failed integration enum lint. V4 separates the existing judgement conditions and passes all those checks plus 641 integration tests and adapter lint. Sentence-style finding titles occur in both arms; perfect noun-phrase style is not claimed.

WTF Astra V2 passes automatic checks but is held because two candidate reports omit the full-groom offer. Later Sol sourceV4 restores the empty top-level header, but two candidate reports omit an empty queue partition. SourceV5 explicitly preserves both partitions and passes all five new candidate samples. Targeted manual report checks improve from 9/15 to 15/15, with 576 integration tests and all ten native audits passing. An independent review also found omitted empty automation subsections in both older Astra arms; the new manual gate includes that rule. Intake's earlier exact-string issue was corrected by clarifying canonical identifier spelling. Later Astra trials stopped on provider usage limits. Intake Sol candidate3 preserves brief facts but fails native literal-path and heredoc rules; its continuation stopped. The default spec-review Sol pair is qualified with all 60 artifacts reviewed and replayed, plus 599 integration tests. No pending savings are counted.

The operator requested continuation after the original time window and calibration of Sol medium against preserved Opus gateway/rendering results. The same policy, fixture and runtime hashes are used, with provider, native-tool, guidance-content and timeout differences disclosed. The initial Sol model-expectation audit error is corrected by re-auditing original captures, retaining the first reports; samples are not replaced.

Other held cuts remain excluded: routing varies its baseline root-cause assignment and fails the frozen exact projection; ADR-body adds an unsupported acceptance-event date; map omits the required TL;DR section; agile adds an unsupported dependency qualifier. Those are baseline failures, not measured candidate regressions. Candidate continuations were stopped. All PR CI checks passed at `19d36dab`, including the accepted review source and calibration tooling.

The full PRD downstream replay passes all 240 cases and rejects 240 forged decisions. The accepted review V4 replay passes for all 70 actual artifacts, with one acknowledged stored-comment write each and exact preserved content/newlines. These are deterministic caller checks, not additional model samples or full caller workflows.

The six-combination stand-in comparison is complete. Sol medium and Astra medium each pass 30/30 assessed runs, 420/420 case checks and 30/30 native audits across gateway, rendering and proposal judgement/CLI consumption, matching preserved Opus outcomes. Each has one confirmed wording caveat in 80 manually read judgement reasons; neither is a clear fidelity winner. Sol medium is the practical default, with Astra medium as a second check. Their observed mean times are 164 and 182 seconds, including queue and tool overhead. Sol low fails one screen run; Sol-high and Terra audit compatibility failures remain distinct from functional scores. Astra low also passes the small screen. [Full comparison and limits](GPT-OPUS-STANDIN-RESULTS.md) preserve raw scores, the frozen rendering correction, manual findings and all failed samples.

GPT's harder judgement task has a frozen same-provider-family amendment; it does not claim independence from an OpenAI primary. Original policy, fixtures, outcomes and runtime are unchanged, while guidance, task wording and native transport differences are disclosed. The [prepared Opus queue](opus-renewal-priority-queue-v2.json) prioritises the default code reviewer, default spec reviewer, PRD and focus report after allowance renewal. Those four source cuts and the later intake cut remain qualified on GPT only. No Claude calls or paid credits were enabled for the comparison.

The default spec-review qualification binds the source, all ten native audits, 60 manual artifact reviews, real contract/routing replay and 599 integration tests. QA major/blocker severity varies while preserving the required revise outcome. Main adapter lint and cumulative rule inventory pass. The consumer replay does not exercise a full prep loop, human escalation or L4 refuter.

Focus-report sourceV5 is accepted with 4,217 bytes and 1,027 estimated tokens saved. Shared calibration paragraph-plus-bullet formatting variance and existing prep-form ambiguities are disclosed; perfect style compliance is not claimed. Only Output Format and duplicated Notes change. Configuration, acquisition phases, chaining/action authority and Autonomous Mode are unchanged; no full WTF workflow execution is claimed.

Intake is accepted at `c650c72b`, saving 1,933 bytes and 478 estimated tokens. Fresh Astra-medium baseline and candidate arms each pass 30/30 assessed artifact checks, 60/60 decisions, 30/30 manual reviews and 5/5 native audits. Both retain 29/30 raw artifact passes: baseline 2 and candidate 3 use the same frozen exact-question correction, with no invented platform, language or first slice. All 632 integration tests, adapter lint and cumulative inventory pass. Elicitation, ticket shaping and full jot/plot execution are outside this cut; the discovery procedure and formal template remain unchanged. The shared context is fixed for the pair, not a model proof of every combined skill context.

Reporting and full-nlspec reductions remain pending. Reporting uses the real pinned summary handler with controlled external dependencies and publication. Nlspec uses actual generated specs plus five real consumer commands. Its untested failure-mode and related branches remain verbatim. The new Sol roadmap baseline is held for report-order and gate-fireability errors; its candidate was never measured or installed.
