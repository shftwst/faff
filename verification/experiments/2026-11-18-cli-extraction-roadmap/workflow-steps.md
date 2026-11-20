# Six workflow extractions and a cache measurement

The original 41 installed skill prompts and Markdown references occupied 1,372,081 bytes and an estimated 339,929 tokens. With the earlier queue and all six workflow changes applied together, those same files occupy 1,069,189 bytes and an estimated 265,249 tokens. This is a projected reduction of 302,892 bytes (22.08%) and 74,680 tokens. The six changes contribute 18,755 bytes and 4,647 tokens of that reduction. Token estimates use UTF-16 code units divided by four, rounded up per file. File rounding means individual token deltas need not sum to the combined total.

| Workflow | Decision now made by the CLI | Bytes saved in composition | PR |
|---|---|---:|---|
| Dispatch return | Verify shared custody before inspecting a member. Distinguish a shared fault from a single bad return. | 4,361 | [1258](https://github.com/shftwst/faff/pull/1258) |
| Landing fix | Bind the original observation, implementor result and expected head to one attempt. Count a failed attempt once on replay. | 1,473 | [1259](https://github.com/shftwst/faff/pull/1259) |
| Spec judge | Resume the pending proposition and verify its correction before assembling the next case. | 3,891 | [1260](https://github.com/shftwst/faff/pull/1260) |
| Build review | Record the independent round, recover on replay and return the next action. Preserve a prior rebuttal's judge requirement through a later fix. | 1,293 | [1261](https://github.com/shftwst/faff/pull/1261) |
| Wave termination | Join the checkpoint, queue, ledger, PRD and policy. Return the verdict and correlation ID for the action taken. | 4,274 | [1262](https://github.com/shftwst/faff/pull/1262) |
| Build-review hold | Publish the carry-forward state and counter together. Recover an interrupted receipt before applying tracker and lease effects. | 3,463 | [1263](https://github.com/shftwst/faff/pull/1263) |

The full-source integration passed 425 focused tests. The final caller changes also passed adapter validation, an additional 11 bracket tests and a composed CLI exercise. The exercise recorded a critical round and rebuttal, published the same hold twice, verified custody, mapped and recorded the outcome, recorded the wave decision and later action, restored the round and sent the withdrawn rebuttal to the judge. The audit covered 71 deleted prompt blocks. The product PRs carry the command implementations, unit tests, caller text and rule inventory. The integration and caller exercises run outside the product branches.

## Paired native caller check

Two cleared Claude Code Opus 5.5 sessions received the same six cases and corresponding before or after excerpts with the revision names hidden. These runs tested what a caller could determine from instructions alone. The preceding CLI tests drove the commands that produce the receipts. The model had no access to a live tracker in this exercise.

| Case | Earlier caller | Revised caller |
|---|---|---|
| Lost manifest after dispatch | Reported the gap and restarted. Could not determine whether to consume the affected return. | Discarded the affected evidence, re-established custody before writing the park, and reserved the new chain for later dispatches. |
| Last critical withdrawn after an earlier rebuttal and a later fix | Proposed direct admission, while also flagging the ambiguity. | Kept judge confirmation pending and delegated the next action to the round recorder. A separate Opus check routed this case explicitly to the judge. |
| Confirmed no-push at two failed fixes and duplicate delivery | Identified the third-failure cap. Could not identify an attempt to replay. | Submitted the confirmed result with the attempt ID. Could not infer the returned action without running the command. After this sample the caller gained an explicit same-ID replay instruction. Real CLI tests verify the unchanged count on replay. |
| Git-only opt-out with unreadable in-scope checklist | Consulted run-done with the no-coverage fallback. | Passed the in-scope path to the consult, logged the warning and recorded the action after taking it. Both withheld a final verdict without queue facts. |
| First spec proposition requires correction | Applied the correction and refreshed the next case. | Applied the correction and ran the verifier before starting the next case. |
| Hold published, reply lost before tracker updates | Recognized that the tracker had not changed. Could not establish a safe replay procedure. | Repeated the same prepare call to recover the stored receipt before tracker updates. |

The packet used the published algorithms and the caller text immediately before the final landing, build-review and single-bracket wording clarifications. These six constructed cases do not estimate field reliability.

## What the cache counters measure

Each row sums the last logged usage per distinct assistant request in that session's single exercise turn. Request-shape records, replayed user messages and multiple content blocks from one response are excluded. Both sessions started with some reusable tool and system context after clearing.

| Native Opus 5.5 session | Requests | Cache-read input | Cache-write input | Other input | Output |
|---|---:|---:|---:|---:|---:|
| Earlier caller excerpts | 4 | 175,521 | 31,938 | 8 | 5,260 |
| Revised caller excerpts | 5 | 225,331 | 26,633 | 10 | 4,249 |

The shorter packet needed 5,305 fewer cache writes in this pair. It incurred 49,810 more cache-read tokens and one extra request. The arms differed in tool calls, output length and warm prefixes. Neither the quota effect nor a whole-run saving follows from this pair. An older review-comment baseline independently recorded 116,468 cache reads, 33,873 cache writes, 82 other input tokens and 10,784 output tokens across 41 distinct Opus 5.5 requests. Seven of its eleven attempts passed the behavioral grader.

The Claude worker archive for this repository contained 247 top-level sessions and two nested subagent logs. A conservative scan for explicit faff slash invocations or Skill tool dispatches found one Jot session and no session that also issued a direct run-close command. Natural-language invocations and shell wrappers can escape that filter. This archive supplies the paired exercise, but the scan could not identify a complete field lifecycle.

For a lifecycle baseline, match one build through review and landing, including any resumed or child sessions. Keep the CLI version, model, skill revision, issue outcome and number of review rounds. Count each request once, keeping billable input classes and output separate. Record phase, named skill or reference read, tool invocations, worker boundaries, compaction and wait duration when available. A pseudonymous issue/session/request ID is sufficient for joining. Summarize success, requests, input by class and output per completed issue. Report incomplete and parked runs separately. An identical-work comparison on a few representative flows can then test whether conditional loading improves the completed outcome's token usage. A reference appended through a tool can retain the existing prefix, while changing an early tool definition or system block changes the matching prefix for later content. [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [Claude Code cache statistics](https://code.claude.com/docs/en/costs#prompt-cache-statistics)
