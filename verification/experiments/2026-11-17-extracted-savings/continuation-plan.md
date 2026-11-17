# Continued skill reduction

Continue implementation, checks and merge monitoring without waiting for a new prompt. Keep experiment evidence off main and publish small source/CLI extractions.

## Size and behaviour accounting

Record complete-file bytes and ceil(UTF-16 code units /4) token estimates. Track merged, qualified pending, held and unmeasured cuts separately. For CLI changes also report tool declarations, required help/reference loads and added authored/shipped code. Moving prose to a file read on every invocation is not a runtime saving. Model/provider billing and actual per-session tokens require separate observations.

## Work sequence

| Phase | Scope | Planning range, not measured | Determinism |
|---|---|---|---|
| Conservative paragraphs | Graft/prep/adversarial spec-review, concurrency, remaining producers and shared references | Further 20-50KB beyond earlier prepared extractions | Source rules unchanged; no new machine enforcement |
| Mechanical CLI extraction | Stored review-comment apply; bounded ledger/event bookkeeping or prep context assembly using existing functions | Potential 80-180KB across later slices, dependent on source inventories | Code owns validated mechanical operations; model supplies judgement inputs |
| Deduplication and loading | One shared home, required stage-only reads, concise command contracts | Potential 30-80KB actual duplicate removal; task-loaded savings separately measured | Shared validation reduces interpretation differences; lazy loading alone is not determinism |
| Judgement compression | Review/spec/methodology text and useful examples | Test 5-15% reductions of affected remaining text; no suite forecast yet | Remains probabilistic, measured by fidelity and failure rates |

Working suite target: 25-35% below original 1,372,081B, approximately 0.89-1.03MB/220-255k estimated tokens. This is a planning target, not evidence or a promised result. Do not add overlapping ranges.

## Current concrete CLI work

- Stored comment application: draft PR #1216 extracts production code without its old harness. Static prompt saving 3,211B/786tokens; new tool definitions 998B/250tokens when loaded, leaving 2,213B/536tokens before protocol/output costs. 163 tests and independent source review pass. Actual hosted connector/auth/listing/ack qualification remains missing; no default activation or savings counted as landed.
- Prep context assembly: compose scratch/container/ratified-scope operations only where existing rules are defined. Raw intent topic parsing and equal/missing timestamp policy are unspecified; preserve the caller's existing structured-resolution extraction rather than invent parser policy. No new review-loop state machine.
- Inspected bookkeeping surfaces total about 21KB across three candidate areas. These are ceilings, not net savings, and overlap historical ledger prose cuts. Larger CLI-phase estimates remain provisional pending broader inventories.

## Acceptance per change

Source-only cuts: independent actual before/after review, unchanged protected operational text, relevant existing consumer tests, adapter lint and complete rule inventory. Claim source review and test coverage accurately; no new model parity claim where none ran.

CLI cuts: test extracted rules/failures and real consumers, then use a bounded intended-driver check that invokes the actual new command. Existing fixture coverage of old constituent commands does not certify a new wrapper. Reuse existing infrastructure; do not build another general framework. Preserve failed runs and stop unproductive retries.
