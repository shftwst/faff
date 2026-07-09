# Telemetry — token-tag `events.jsonl` for exact phase attribution of token spend

> Spec: faffter-dark-nlspec · 2026-07-09 · autonomous · confidence: high. Full spec on Linear FAFF-408.

This spec defines how a per-event token delta is captured and written into the run event log (`.faff/runs/<run-id>/events.jsonl`), so a token-usage pivot can attribute spend to a delivery phase by *event* rather than by guessing from a timestamp window. Audience: the build agent implementing the change against the bundled `faff` CLI, and the human/QA reviewers of the resulting PR. It was surfaced by the FAFF-407 spike, which could not resolve its phase axis and flagged this as the telemetry gap to close.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff already measures token spend two ways that never meet: the **event log** records phase-tagged boundaries (`prep-start`, `issue-outcome`, …) with a wall-clock `ts` but *no token data*; the **transcripts** (`~/.claude/projects/<cwd>/*.jsonl`) carry per-message token counts but *no phase*. FAFF-407 tried to join them on the time axis and failed — the orchestrator's inline work spans phases, so a timestamp window can't cleanly assign a token to prep vs build. The fix is to stop joining on time: **measure a token delta at the moment each phase-closing event is emitted, and write that delta into the event itself**. The event log then carries its own token attribution — the join is by event, exact, and needs no transcript replay.

**Problem statement.** Today a token-usage breakdown can bucket spend by time or model but not by phase, because the two data sources share no key. This change tags the events that close a phase with the four-class token delta consumed since the previous checkpoint. A pivot then sums deltas by the emitting event's `phase` to get real per-phase attribution.

**Design principles.**

- **Reuse the existing token machinery, do not rebuild accounting.** The delta must be measured with the *same* transcript-sum + child-attribution path that `faff budget check` and `faff economics` already use (`measureTokens` / `sumTranscriptFile`, and critically the `childOwningSession` attribution gate from FAFF-229). A private recount would drift from the figure budget gates on and could silently re-introduce the FAFF-229 over-count bug.
- **Baseline-and-delta, exactly like the budget mechanism.** The budget dimension is `max(0, measured_total − tokens_at_start)`. This spec applies the *same* idea incrementally: each tagged event's delta is `measured_total_now − measured_total_at_previous_checkpoint`. The run-start baseline seeds the first checkpoint.
- **Counts only, never payload (non-leak invariant).** `data.tokens` carries four integers and a source label — nothing else. No prompt text, no response text, no model id, no per-message detail ever enters the event log. The event log is a shipped reader surface (Sentry, FAFF-289); it must stay a counts-only artifact.
- **Additive within `data`, never an envelope schema bump.** The schema-1 event envelope (`schema`/`run_id`/`seq`/`ts`/`phase`/`type`) is **frozen** for its shipped readers (FAFF-289). Token data goes under the already-free-form `data` field — the same place `issue-outcome` carries `data.outcome` and `budget-checkpoint` carries `data` = BudgetState. `schema` stays `1`. An untagged event is byte-for-byte unchanged.
- **Opt-in and degradation-safe.** Token-tagging is requested per append by the emitter; absent the request, `events append` behaves exactly as today (no measurement, no `data.tokens`, no ledger read). When no transcript is readable, the event still writes — with a null delta and an `estimate` source — never a crash and never a fabricated number.

## 2. OUT OF SCOPE

- **A distinct `review` phase / event.** `EVENT_PHASES` today is exactly `{run, tidy, prep, build}` and there is **no** review event: review runs *inside* the graft subagent and reaches the log only folded into the phase-`build` `issue-outcome`. Separating review spend would require graft to return a per-sub-phase token split to the orchestrator — new cross-lane plumbing. Extension point: a follow-on ticket has the `faff-graft` subagent return `{build_tokens, review_tokens}` and the orchestrator emit a `review-done` event reusing this `data.tokens` shape.
- **Rendering the phase breakdown.** This spec makes the data *joinable*; it does not add a `faff audit` / `faff economics` phase column or pivot UI.
- **Back-filling historical runs.** Existing `events.jsonl` files without `data.tokens` are left as-is; a reader treats a missing `data.tokens` as "unattributed".

## 3. WHAT — Vocabulary, Types, and Interfaces

```
RECORD TokenDelta:                 # the value of data.tokens on a tagged event
  input: int                       # >= 0; sum input_tokens since the checkpoint
  output: int                      # >= 0; sum output_tokens
  cache_write: int                 # >= 0; sum cache_creation_input_tokens
  cache_read: int                  # >= 0; sum cache_read_input_tokens
  # NO other fields — counts only (non-leak invariant)

RECORD TaggedEventData:            # the data object carried by a token-tagged event
  ...existing type-specific fields (e.g. outcome, BudgetState)...
  tokens: TokenDelta | null        # null => no transcript readable at emit time
  tokens_source: "transcript" | "estimate"   # "estimate" iff tokens == null
```

Class-mapping (raw transcript key → delta class): `input`←`input_tokens`, `output`←`output_tokens`, `cache_write`←`cache_creation_input_tokens`, `cache_read`←`cache_read_input_tokens`.

New internal primitives (same file):

```
FUNCTION sumTranscriptFileByClass(file) -> { input, output, cache_write, cache_read }
  # per-class counterpart of sumTranscriptFile; same read/skip/parse rules.
  # sumTranscriptFile(file) MUST equal the sum of the four classes (parity).

FUNCTION measureTokensByClass({ cwd, env, runStartMs }) -> { tokens: {4 classes} | null, source }
  # per-class counterpart of measureTokens; reuses the SAME attribution logic
  # (session file + childOwningSession gate + mtime pre-filter).
```

`events append` extension: new flag **`--tokens`**. Absent ⇒ today's behaviour byte-for-byte. When passed, the CLI injects `tokens` + `tokens_source` into the recorded `data` object (creating `data` if the payload omitted it). The emitter never computes the counts — the CLI owns the measurement.

**Checkpoint (Chosen: advancing ledger checkpoint).** Store `budget.tokens_at_last_event` (four-class) in the run ledger, seeded from `budget.tokens_at_start_by_class`. Each tagged append re-measures the fresh cumulative, computes `delta = max(0, fresh − checkpoint)` per class, writes the delta, and advances `checkpoint = fresh`. An `estimate` append writes null and does **not** advance (so the next transcript append's delta spans the gap — no tokens lost). Rejected alternative: reconstructing from stored deltas (a single estimate/null event corrupts the running sum).

## 4. HOW — Behavior

```
PROCEDURE events_append(payload_from_stdin, run, tokensFlag, ts):
  1. Resolve run dir; validate payload via eventViolations(payload, requireEnvelope=false).
  2. seq := eventLineCount(events.jsonl)
  3. record := { schema:1, run_id:run, seq, ts:ts||now, phase, type }; issue if defined; data := payload.data
  4. IF tokensFlag:
     a. runStartMs := run-start ms from ledger if available, else undefined
     b. measured := measureTokensByClass({ cwd:root, env, runStartMs })
     c. checkpoint := ledger.budget.tokens_at_last_event
          ?? ledger.budget.tokens_at_start_by_class
          ?? {input:0,output:0,cache_write:0,cache_read:0}
     d. IF measured.source == "transcript":
          delta := { each class: max(0, measured.tokens[class] - checkpoint[class]) }
          data := { ...(data||{}), tokens: delta, tokens_source: "transcript" }
          ledger.budget.tokens_at_last_event := measured.tokens ; persist ledger
        ELSE:
          data := { ...(data||{}), tokens: null, tokens_source: "estimate" }  # do NOT advance
  5. IF data defined: record.data := data
  6. append; print record; exit 0
```

**Baseline (beep-boop prose half).** Add `budget.tokens_at_start_by_class` (four-class) at run start; seed the checkpoint from it; leave scalar `tokens_at_start` and `budget check` untouched.

**Emitter change (`faff-beep-boop/SKILL.md`).** Pass `--tokens` on the phase-closing emissions only: `tidy-done`, `prep-done`, `issue-outcome`, `budget-checkpoint`, `park`, `run-end`. Not on the opening events (`run-start`, `issue-admitted`, `prep-start`, `build-start`, `discovered-scope-filed`).

**Validation (`eventViolations`).** When `record.data.tokens` is present, assert it is either `null` (with `tokens_source == "estimate"`) or an object with exactly the four integer classes each ≥ 0 (with `tokens_source == "transcript"`). Violation exits 1, line-numbered. Untagged events unaffected.

**Failure modes.** In-flight orchestrator turn not flushed at emit → coverage < 1, named not hidden (subagent spend is captured accurately; orchestrator inline lags to the next boundary). Private recount divergence → the parity test catches it; reuse the one attribution gate. Estimate run → source label keeps it honest; readers report coverage, never treat null as zero.

## 5. SCENARIOS — born-verifiable

```
Given a run whose events.jsonl has one prior transcript-sourced checkpoint
When the orchestrator emits prep-done with events append --tokens
Then data.tokens is the four-class delta since that checkpoint, data.tokens_source == "transcript",
  and ledger.budget.tokens_at_last_event advances to the fresh cumulative
```

```
Given a run with NO readable transcript (estimate mode)
When a phase-closing event is emitted with --tokens
Then the event still writes, data.tokens == null, data.tokens_source == "estimate", checkpoint NOT advanced
```

```
Given the same transcript fixture
When sumTranscriptFileByClass and sumTranscriptFile both run on it
Then the sum of the four classes equals the single total (attribution parity)
```

Non-leak: a tagged event's `data.tokens` contains only the four integer classes — asserted structurally by `eventViolations` and by a test grepping the written line for payload absence. Backward-compat: `events append` without `--tokens` produces a byte-identical record to the pre-change CLI.

## 6. DESIGN DECISION RATIONALE

- **Checkpoint storage:** advancing four-class ledger field (Chosen) vs delta-sum reconstruction (rejected — null/estimate events corrupt it).
- **Which events carry a delta:** phase-*closing* only, opt-in `--tokens`.
- **Additive under `data`** vs schema bump: additive; `schema` stays `1` (FAFF-289 frozen envelope).
- **Four clean class names** mapped from raw keys.
- **New by-class primitive** reusing the exact `childOwningSession` attribution gate + a parity test (deriving the single total by summing the classes).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

Open Questions: none blocking. Assumptions: (a) the orchestrator remains the single writer of both `events.jsonl` and `run-ledger.json` within a run; (b) transcript usage records expose the four `BUDGET_TOKEN_USAGE_KEYS` under `message.usage`/`usage` (already relied on by `measureTokens`).

## 8. DONE — Definition of Done

- Phase-tagged events carry a four-class token delta measured via the existing `measureTokens`/`childOwningSession` path (parity test passes); counts-only non-leak invariant asserted.
- `sumTranscriptFileByClass(file)` sum equals `sumTranscriptFile(file)`; `measureTokensByClass` reuses the same attribution gate; class-mapping matches the table.
- `events append --tokens`: transcript → `data.tokens = max(0, fresh − checkpoint)` per class, source `transcript`, `budget.tokens_at_last_event` advances; no transcript → null + `estimate`, checkpoint not advanced; **without** `--tokens` the record is byte-identical to pre-change.
- `budget.tokens_at_start_by_class` captured at run start; scalar `tokens_at_start` and `budget check` unchanged; `schema` stays `1`.
- `eventViolations` rejects malformed `data.tokens` (wrong shape / negative / non-integer / source-mismatch) exit 1; accepts null+estimate and 4-class+transcript.
- `faff-beep-boop/SKILL.md` passes `--tokens` on the phase-closing events and documents `data.tokens`/`tokens_source`.
- `docs/guide/cli.md` `events append` entry documents `--tokens` and the `data.tokens` shape.
- Tests: `test/events.test.mjs` covers the delta, checkpoint advance, estimate fallback, malformed rejection, byte-identical no-flag; parity test `sumTranscriptFileByClass` sum == `sumTranscriptFile`.

confidence: high
