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

The shorter packet wrote 5,305 fewer tokens to cache in this pair. It incurred 49,810 more cache-read tokens and one extra request. The earlier caller made two Bash calls and one Read. The revised caller made three Bash calls and one Read. The arms differed in tool calls, output length and warm prefixes. Neither the quota effect nor a whole-run saving follows from this pair. An older review-comment baseline independently recorded 116,468 cache reads, 33,873 cache writes, 82 other input tokens and 10,784 output tokens across 41 distinct Opus 5.5 requests. Seven of its eleven attempts passed the behavioral grader.

The Claude worker archive for this repository contained 247 top-level sessions and two nested subagent logs. A conservative scan for explicit faff slash invocations or Skill tool dispatches found one Jot session and no session that also issued a direct run-close command. Natural-language invocations and shell wrappers can escape that filter. This archive supplies the paired exercise, but the scan could not identify a complete field lifecycle.

For a lifecycle baseline, match one build through review and landing, including any resumed or child sessions. Keep the CLI version, model, skill revision, issue outcome and number of review rounds. Count each request once, keeping billable input classes and output separate. Record phase, named skill or reference read, tool invocations, worker boundaries, compaction and wait duration when available. A pseudonymous issue/session/request ID is sufficient for joining. Summarize success, requests, input by class and output per completed issue. Report incomplete and parked runs separately. An identical-work comparison on a few representative flows can then test whether conditional loading improves the completed outcome's token usage. A reference appended through a tool can retain the existing prefix, while changing an early tool definition or system block changes the matching prefix for later content. [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [Claude Code cache statistics](https://code.claude.com/docs/en/costs#prompt-cache-statistics)

## Historical Fly beep-boop streams

The checkout's September 4 runner-volume snapshot contains two complete gzip streams with matching run-ledger snapshots, both from September 3. The run IDs are `run-20260903-203823-fly-l3` and `run-20260903-213310-fly-l3`. The third run directory has a summary and no matching recorded stream. The source runner stores the verbose Claude stream alongside the run directories in the `faff-state` volume. [Runner drain](https://github.com/shftwst/fly-ci-l3-runner/blob/dbe18502e63a9bfc86d0b8be4bc18ed28e8949d3/drain.sh#L302)

| Drain start (UTC) | Outcomes in saved ledger | Visible API request IDs | Cache-read input | Cache-write input | Other input | Output |
|---|---|---:|---:|---:|---:|---:|
| 20:38 | 3 routed out | 251 | 42,664,643 | 2,622,180 | 496 | 416,928 |
| 21:33 | 2 parked | 200 | 42,132,643 | 3,076,388 | 399 | 274,417 |

The counters are the CLI's final `result.modelUsage`, summed across models and counted once for the session. The first stream repeats the same session-level totals in six result frames. The request counts come from distinct assistant request IDs. Some second-drain requests are absent from the visible messages, so the final totals are authoritative. Both ledgers still showed the owner as running when copied. These are historical drains without a recorded shipped issue. The first used Opus 4.8; the second included Sonnet 5 workers. Both used Claude Code 2.1.227.

For direct `Read` calls on a skill or its references, match a successful tool result by tool-use ID to the next distinct API request in that session, parent-tool context and model. All 38 matched reads (23 and 15) retained cache hits at least as large as the prior request's cache-read plus cache-created input. This length comparison is consistent with prefix reuse. It cannot identify the contents of individual cached blocks. Of these reads, 36 were the first observed read of that file in that parent or worker context. The other two were additional reads of the shared kernel reference. The two streams show 303 Bash calls, 263 in child workers.

The recorded drains used 84,797,286 cache-read input tokens and 5,698,568 cache-write input tokens. Their combined input-token cache hit share was 93.7%. A change that removes a redundant turn or shortens the prefix read on many turns can still matter at that hit rate. These files predate the six workflow changes. A post-change matched drain is needed to estimate the effect on a completed issue. Raw transcripts stay outside this branch.
