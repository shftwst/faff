# ADR 0091 — Engine-declared telemetry source: spend measurement is a two-source union behind one dispatch layer

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-25
- **Issue:** FAFF-604

## Context

Every spend figure faff reports is read from one place: Claude Code transcript JSONL, walked by `sumTranscriptFileByModelClass` and attributed by session id. That was fine while every producer dispatch was an in-harness Claude subagent. It stopped being fine when the transport fork that keys the dispatch vehicle off the lane value (ADR-0054) gained a spawned-child branch for codex (ADR-0090): a codex build lane's spend is real money and currently invisible. `runCodexCall` already parses the usage numbers out of the event stream and throws them away — ADR-0090 deliberately kept the full event list as the read point for this ticket. So a mixed-fleet run under a dollar ceiling counts the Claude side, counts the codex side as nothing, and reports the difference as headroom.

Three forces shape the fix.

**The measurement is Claude-shaped, and has to stay byte-for-byte.** The transcript read loop and its session-ownership gate are the most load-bearing code in the governance region, and the ownership hazard they close (inferring ownership from file mtime) was retired deliberately. Whatever reads a second source cannot be an edit inside that loop.

**Nothing may read as zero when it is merely unreadable.** An engine whose spend cannot be observed at all — every HTTP family today — must not contribute a confident 0 to a total that then reads as under budget. This is the line the governor-honesty work already drew when it made an estimate-only meter a preflight refusal rather than an accepted reading (ADR-0060): a non-null number is not evidence of a working meter.

**`budget check` cannot be the thing that refuses.** The sentry and `run-done --budget` both read a non-zero exit from `budget check` as *unbreached* — a deliberate fail-open, so a crashed check never masquerades as a breach. Refusing there would fail the whole budget signal open, the exact failure the earlier invalid-deadline work closed. Refusal has to live where refusing costs nothing.

Two adjacent decisions were waiting on this seam: the 5-hour window governor's first-draw anchor (ADR-0088) deferred per-backend attribution behind it, and the price map (ADR-0048, wired into `budget.cost` by ADR-0059) carries no non-Anthropic rates.

## Decision

**Each engine declares where its spend can be read, and one combining layer sums those sources into the single figure every ceiling reads.**

- **`telemetry: transcript-jsonl | exec-json-events | none`** joins the Backend record as a derive-with-override field — the shape `auth` and `egress` already use on the named model-access substrate (ADR-0076). Provider `anthropic` derives `transcript-jsonl`, provider `codex` derives `exec-json-events`, everything else derives `none`; an explicit value wins. The enum is closed and constrained by family capability: a backend cannot claim a source its family cannot physically serve, and an impossible claim fails at normalize time rather than at spend-read time. `none` is legal on any provider — it is the honest universal claim.

- **A new `measureRunSpend` sits above the existing measurers, never inside them.** It calls today's transcript measurement unchanged, reads a run-owned append-only `engine-spend.jsonl`, and sums the two per model class. The transcript read loop, the session-ownership gate and `measureTokens*` keep their exact bodies and stay exported; a run with no `engine-spend.jsonl` produces output identical to today's. The alternative — teaching the transcript loop to also read the spend file — is refused: it collapses the two sources into one walk and loses the byte-for-byte guarantee and the per-source labels together.

- **Spend is recorded at the call boundary, because that is the only place that knows both halves.** `codex exec` runs ephemeral: no session file, a temp cwd that gets removed, nothing left behind to attribute later. So `runCodexCall` gains an injectable sink; on a successful call it sums usage across the call's turn-completion events and hands the sink one record, which by default appends a line to the run's spend file. `faff engine call` learns its run from a `--run-dir` flag, falling back to latest-run resolution for ad-hoc human calls only — any dispatcher already inside a run passes `--run-dir` explicitly, because "newest run dir" is the same mtime-shaped ownership signal this codebase retired once already. A write failure warns and leaves the call's exit code alone: metering must never break a producer dispatch.

- **One measurement, all ceilings.** Tokens, cost and window all read the combined figure. No ceiling gets a private recount.

- **An unobservable engine refuses at mint, not at check.** When a dollar ceiling is set and a resolved fleet engine reports `telemetry: none` without an explicit waiver, the lights-out preflight refuses, naming the engine and both remedies. `budget check` in the same state reports `cost: null` with a warning and exit 0 — loud, never fail-open. The waiver is `budget.allow_unmetered: [<backend names>]` in the budget block, not a flag on the engine record: accepting unmetered spend under a ceiling is a policy owned by whoever set the ceiling, and a per-engine flag would let an engine definition quietly waive someone else's.

- **Labels are additive.** `tokens_source` keeps its exact current meaning (the transcript-side measurement basis). Economics gains a `spend_sources` array and an `unmetered_engines` list, both absent on a single-source transcript-only run, so existing consumers see identical JSON. An engine named in `allow_unmetered` still appears in `unmetered_engines` everywhere — opted out of refusal, never out of visibility.

## Consequences

- **Every future engine family has to answer "where can your spend be read?"** Adding a family is now a telemetry decision as well as a transport one. The honest answer for a new HTTP family is `none`, which is admissible but costs something at dollar-ceiling time — that pressure is intended.
- **Window mode composes for free.** The window draw baseline is the run-total figure, so combining upstream means the accumulator, anchor and reset logic need no edits: a mixed-fleet window ceiling is a true combined total by construction, and the first-draw anchor rule stands untouched. Per-backend window attribution is still its own decision; this seam just stops blocking it.
- **`none` engines get window mode or an explicit waiver, and nothing else.** Window mode with an unmetered engine in the fleet is permitted and meters only the observable draw, with `unmetered_engines` on every output so the reading is labeled a lower bound rather than presented as a total. Refusing window mode as well would leave those engines with no budget story at all.
- **A second spend artifact is a second thing that can go wrong.** A lost or partly-written `engine-spend.jsonl` under-counts; malformed lines are skipped and counted, not fatal. Under-count is the accepted direction because it is how the transcript path already errs, and because the alternative at this seam is crashing a check that fails open when it crashes.
- **Codex spend prices at the over-count fail-safe until someone rules on non-Anthropic rates.** A model absent from the price map prices at the costliest known rate with a named warning; that fail-safe now covers real traffic rather than a hypothetical one. Whether faff carries non-Anthropic rates at all is still an open pricing call.
- **One source per family is a guard, not a coincidence.** An engine whose calls landed in both the transcript and the spend file would double-count. The family-capability constraint is what prevents that; keeping the enum closed is what keeps it true.
- **`engine-spend.jsonl` needs a write-authority class.** It is a new run artifact that a governor reads, written wherever an engine call happens — the two-class model for run artifacts (ADR-0077) should be applied to it explicitly rather than left implied. Sensor class is the likely answer given the under-count-only error direction, but that is a call for the slice that mounts the boundary, not this one.
- **Historical runs stay unattributed.** The spend file starts empty; codex spend from before this change is gone and stays gone.

No live ADR is reversed here. This extends the transport fork and its codex branch, leaves the pricing rule and the fail-open posture of `budget check` intact, and answers the per-backend question the window governor deferred.

**Self-review:** the Consequences are checked against the committed FAFF-604 design and its done-criteria — the parity requirement (transcript loop and `parseCodexEvents` textually unchanged), the mint-time refusal with `budget check` degrading to `cost: null` at exit 0, and the untouched window accumulator are all pinned there as acceptance items. The implementation diff is not present in this worktree, so those are recorded as what the change commits to rather than as observed output; the write-authority classification of the new spend file is genuinely unsettled and is written up as open, not decided.

confidence: high
