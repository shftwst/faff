# Continued skill reduction

Continue implementation, checks and merge monitoring without waiting for a new prompt. Keep experiment evidence off main and publish small source/CLI extractions.

## Size and behaviour accounting

Record complete-file bytes and ceil(UTF-16 code units /4) token estimates. Track merged, qualified pending, held and unmeasured cuts separately. For CLI changes also report tool declarations, required help/reference loads and added authored/shipped code. Moving prose to a file read on every invocation is not a runtime saving. Model/provider billing and actual per-session tokens require separate observations.

Use ordinary `faff` subcommands for local mechanical work. Follow the existing [tracker availability rule](../../../plugin/skills/faff/references/tracker.md). The skill honours the tracker configuration, discovers the operator’s existing MCP tools in the agent session and uses them for live reads and writes. A local command can calculate a result from the data supplied by the skill. The shell already exposes the CLI. Put its invocation in the skill that uses it and count the invocation, required help reads and model-visible output on that workflow. Count a new model-facing tool definition on every workflow that actually loads it, including workflows that never call the tool. Record eager, deferred or unknown loading when reporting a per-task estimate.

## Work sequence

| Phase | Scope | Planning range, not measured | Determinism |
|---|---|---|---|
| Conservative paragraphs | Graft/prep/adversarial spec-review, concurrency, remaining producers and shared references | Further 20-50KB beyond earlier prepared extractions | Source rules unchanged; no new machine enforcement |
| Mechanical CLI extraction | Prep context assembly, then bounded ledger/event bookkeeping using existing functions | First tranche roughly 10-20KB net; larger total not yet substantiated | Code owns validated mechanical operations; model supplies judgement inputs |
| Deduplication and loading | One shared home, required stage-only reads, concise command contracts | Provisional 30-80KB duplicate-removal target pending inventory; task-loaded savings separately measured | Shared validation reduces interpretation differences; lazy loading alone is not determinism |
| Judgement compression | Review/spec/methodology text and useful examples | Test 5-15% reductions of affected remaining text; no suite forecast yet | Remains probabilistic, measured by fidelity and failure rates |

Working suite target: first 25% below the original 1,372,081B, approximately 1.03MB/255k estimated tokens. A 35% reduction, approximately 0.89MB/220k tokens, is a stretch target requiring further demonstrated opportunities. This is a planning target, not evidence or a promised result. Do not add overlapping ranges.

## Current concrete CLI work

- Stored comment application in draft #1216 is a reference implementation. The two proposed MCP definitions total 998 bytes (about 250 tokens). The 786-token prompt reduction spans two files. A session loading both files and both definitions once would save around 536 static tokens. An unrelated session loading the definitions alone would add around 250. Actual client loading and tool outputs determine the session cost. Keep the draft outside the landing queue. The existing skill owns the live read and write through the discovered tracker MCP. A local planner can select the target and compute a splice. The earlier handoff lost line endings when the model copied the result into a write. Qualify preservation of the human text through the existing connector before counting any review-comment extraction.
- Prep context assembly: compose scratch/container/ratified-scope operations only where existing rules are defined. Raw intent topic parsing and equal/missing timestamp policy are unspecified; preserve the caller's existing structured-resolution extraction rather than invent parser policy. No new review-loop state machine.
- Inspected bookkeeping surfaces total about 21KB across three candidate areas. These are ceilings, not net savings, and overlap historical ledger prose cuts. Larger CLI-phase estimates remain provisional pending broader inventories.

## Acceptance per change

Source-only cuts: independent actual before/after review, unchanged protected operational text, relevant existing consumer tests, adapter lint and complete rule inventory. Claim source review and test coverage accurately; no new model parity claim where none ran.

CLI cuts: test extracted rules/failures and real consumers, then use a bounded intended-driver check that invokes the actual new command. Existing fixture coverage of old constituent commands does not certify a new wrapper. Reuse existing infrastructure; do not build another general framework. Preserve failed runs and stop unproductive retries.

## Forecast update after closer source inspection

The three further bounded CLI slices in `faff-cli-next-large-slices.json` contain 23,060 source bytes but only 5,300-9,000 estimated net prompt bytes can be removed while retaining caller judgement, live tracker reads and write authority. Prefer tidy container-coherence composition first, then graft failed-fix bookkeeping if repeat-call identity is already defined. Beep filing preflight has more entanglement. The earlier 80-180KB CLI-phase forecast is withdrawn as insufficiently grounded; the first tranche is approximately 10-20KB net, from the initial inventory. Its original scope included the review-comment prototype, which is now outside the queue. No full-suite forecast is evidence.

CLI work is already underway in parallel with paragraphs. The review-comment MCP prototype remains draft; its source-bound diagnostic did not reach a model because the worker environment lacked the required OAuth token. Prep-context code and direct consumers pass 64 focused tests. Its caller port passes 161 existing checks, independent source review and a literal shell invocation. It saves a provisional 1,976B/486tokens before overlap with PR1215 is removed; intended-driver workflow measurement remains outstanding. Neither is counted as landed.

## Delivery order and stopping rules

Finish the remaining conservative paragraph pass alongside the prep-context CLI. Revisit review-comment once the existing connector path can demonstrate exact preservation of human text across a real read, splice and update. Land small changes against current main, then use the same commands across additional callers where their contracts match. Before broader CLI work, require a net prompt estimate and a concrete mechanical failure or repeated procedure worth owning in code; avoid a new wrapper for a trivial sentence saving. Start shared-rule/load-path inventory in parallel after those first slices are qualified, keeping required safety/authority contracts on every relevant path. Compress judgement guidance last, retaining useful examples unless the existing fidelity checks support removal.

Do not wait for all 32 skills to finish before merging individual slices. Do not count moved always-read text, overlapping branch cuts, tool-schema overhead, held runs or unpublished prototypes as landed savings. Track exact command outputs/invalid-input handling separately from model adherence and judgement fidelity; no numerical determinism percentage is justified for the whole system.
