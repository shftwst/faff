# FAFF-604 — Telemetry adapter seam: budget/economics read an engine-declared spend source

> Spec: faffter-dark-nlspec · 2026-07-25 · interactive · confidence: high

This spec defines the `telemetry` seam on the `backends:` namespace so budget and economics stop assuming every engine writes a Claude Code transcript. It addresses Linear ticket FAFF-604 (project "Harness portability — L2/L3 anywhere"). Audience: the build agent implementing it, and human reviewers checking the design.

## 1. WHY — Problem and principles

**The load-bearing model:** spend measurement becomes a two-source union behind one dispatch layer. Each engine declares where its spend can be read (`telemetry: transcript-jsonl | exec-json-events | none`); a new combining measurer sums the transcript source (today's path, byte-for-byte) with a run-owned spend file that the codex call boundary appends to; every ceiling — tokens, cost, window — reads that one combined figure, and an engine whose spend is unreadable makes dollar mode refuse rather than read zero.

**Problem.** Budget and economics read spend exclusively from Claude Code transcript JSONL (`sumTranscriptFileByModelClass`, session-id attribution) — the deepest Claude-only coupling left after FAFF-593 landed the codex spawn family. A codex build lane's spend is currently invisible: `runCodexCall` parses usage events and throws them away (`engine-codex.js:186-187`), so a mixed-fleet run under a dollar ceiling silently under-counts. This change makes each engine declare its spend source and makes the unobservable case fail loud.

**Design principles** — reject an implementation that violates any of these:

- **Never silently zero.** An engine with `telemetry: none` under a dollar ceiling refuses; it never contributes 0 to a total that then reads as "under budget". This is the ticket's core acceptance clause.
- **One measurement, all ceilings.** The combined transcript+events figure feeds `tokens`, `cost`, and `window` alike. No ceiling gets a private recount (the FAFF-229/FAFF-408 guard-rail, extended across sources).
- **`sumTranscriptFile*` stays byte-for-byte.** The seam is a dispatch layer above the existing transcript read loop, never an edit inside it (`budget.js:422-464` untouched).
- **Budget check never fails open.** `sentryReadBudget`/`run-done --budget` treat any non-zero `budget check` exit as unbreached (`budget.js:957-961`), so refusals must live where refusing carries no fail-open risk — mint time — with `budget check` degrading loudly, not exiting non-zero.

**Reference context:**

| System | File | Relevance |
|---|---|---|
| Transcript read loop | `plugin/skills/faff/bin/lib/budget.js:422` (`sumTranscriptFileByModelClass`) | The single parse loop — stays untouched |
| Session attribution | `budget.js:474` (`childOwningSession`), `:505` (`sessionOwnedTranscriptFiles`) | Transcript-side ownership gate — stays untouched |
| Run measurers | `budget.js:536` (`measureTokensByClass`), `:561` (`measureTokensByModelClass`), `:584` (`measureTokens`) | The layer the new combined measurer wraps |
| Dollar pricing | `budget.js:874-896` (`resolveEconomicsPriceMap` + `priceModelClassSums`), unpriced-model fail-safe `:893-895` | Where combined per-model sums are priced |
| Window governor | `budget.js:339-350` (envelope), `:899-944` (anchor/roll), `cumulativeForWindow = tokens` at `:870` | Window draw already reuses the run-total figure — combining upstream extends it for free |
| Mint-time refusal precedent | `budget.js:316-320` (lights-out preflight hard-refuses; check-time degrades to warning) | Where the `telemetry: none` dollar refusal lives |
| Backends registry | `plugin/skills/faff/bin/lib/backends.js:22` (`BACKEND_RECORD_KEYS`), `:35` (`deriveAuth`), `:96` (`normalizeBackend`), `:71` (`validateBackendConstraints`) | The derive-with-override + closed-enum pattern `telemetry` copies |
| Provider→family map | `plugin/skills/faff/bin/lib/config.js:200` (`ENGINE_PROVIDER_FAMILY`), `:294` (family derived, not stored) | Basis for telemetry derivation |
| Codex events | `plugin/skills/faff/bin/lib/engine-codex.js:54` (`parseCodexEvents` — keeps usage, doc comment names this ticket), `:92` (`runCodexCall`, events discarded at `:186-187`) | The exec-json-events read point |
| Engine call CLI | `plugin/skills/faff/bin/lib/engine.js:169-221` (`cmdEngine` — has `--root`, no run context today) | The call boundary that must learn its run |
| Economics top line | `plugin/skills/faff/bin/lib/economics.js:60-119` (`computeUnitEconomics`, `tokens_source` scalar), `:807-811` (call site), `:383-419` (row building), `:568` (`source: "events"` precedent for a non-transcript axis) | Where source labels surface |
| Tests | `test/budget.test.mjs`, `test/economics.test.mjs`, `test/backends.test.mjs`, `test/engine-call.test.mjs`; in-module `--selftest` tables | Both layers extend |

**Scope statement:** this is the telemetry leg of the harness-portability project — it sits between FAFF-593 (codex transport, merged) and any future non-Claude orchestrator work, and changes nothing about how engines are dispatched.

## 2. OUT OF SCOPE

- **A `--by engine` economics axis** — per-row source labels cover the honesty requirement; a full new pivot axis is a separate reporting feature. Extension point: the axis dispatch in `economics.js:393-419` plus the `--by` flag vocabulary.
- **OpenAI/codex rates in the ADR-0048 price map** — the existing unpriced-model fail-safe (costliest known rate, over-count, named warning — `budget.js:893-895`) covers codex models meanwhile. Extension point: the price map source `resolveEconomicsPriceMap` reads. See Open Questions.
- **Telemetry for future HTTP families (ollama, nvidia, gemini)** — they derive `none` today; a future ticket can add a source value per family. Extension point: `TELEMETRY_VALUES` + `deriveTelemetry` in `backends.js`.
- **Streaming/live spend during a codex call** — spend is recorded once, after child exit, from the complete parsed stream. Mid-call metering would need the async spawn family that doesn't exist yet.
- **Re-attributing historical runs** — `engine-spend.jsonl` starts empty; old runs' codex spend is gone and stays gone.

## 3. WHAT — Vocabulary, types, and interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Telemetry source | Where an engine's spend can be read: `transcript-jsonl`, `exec-json-events`, or `none` |
| Spend record | One appended JSONL line in a run's `engine-spend.jsonl`, capturing one engine call's usage |
| Metered / unmetered engine | An engine whose telemetry is a readable source / is `none` |
| Combined measurement | Transcript-source totals + exec-json-events totals, summed per model class |

**Backend record extension** (`backends.js`):

```
ENUM TelemetryValue: "transcript-jsonl" | "exec-json-events" | "none"   # closed enum, fail loud on anything else

RECORD Backend (extended):
  ... existing keys ...
  telemetry: TelemetryValue        # derive-with-override, like auth/egress

  CONSTRAINT telemetry == "transcript-jsonl"  REQUIRES provider family "http-anthropic-ish" (provider anthropic)
  CONSTRAINT telemetry == "exec-json-events"  REQUIRES provider family "codex"
  # "none" is legal on any provider — it is the safe universal claim.
```

**Derivation** (explicit value always wins, mirroring `deriveAuth`): provider `anthropic` → `transcript-jsonl`; provider `codex` → `exec-json-events`; everything else → `none`. A backend cannot *claim* a source its family cannot physically serve — that is the constraint above, validated in `validateBackendConstraints` alongside the auth rules, error message naming the backend and the legal pairing.

**Chosen:** `telemetry` is a derive-with-override field on the Backend record with a closed value enum and family-capability constraints — exactly the `auth`/`egress` pattern (`backends.js:35-40`, `:71-88`). Rationale: config stays terse for the common case (nobody writes `telemetry:` for a plain anthropic or codex backend), the explicit override exists for the day a family gains a second source, and an impossible claim fails at normalize time, not at spend-read time. Add `telemetry` to `BACKEND_RECORD_KEYS` so `faff backends resolve` prints it.

**Spend record** (new file `engine-spend.jsonl`, per run dir, append-only):

```
RECORD SpendRecord:                # one line per completed engine call
  ts: ISO8601                     # call completion time
  engine: string                  # backend name
  provider: string
  model: string
  source: "exec-json-events"      # the telemetry source that produced this record
  input: int                      # summed over the call's turn.completed usage events
  output: int
  cache_read: int                 # from cached_input_tokens; 0 when absent
  cache_write: int                # codex reports none today — always 0; field kept for shape parity
```

Class names match `TOKEN_DELTA_CLASSES` so the combined measurement is a plain per-class sum.

**Combined measurer** (new, in `budget.js`, above the existing measurers):

```
measureRunSpend(opts) ->
  { totals: {input, output, cache_write, cache_read},
    by_model: Map<model, {classes}>,
    tokens_source: "transcript" | "estimate",        # transcript-side basis, unchanged meaning
    sources: [ { source, tokens, by_model? } ],       # per-source contributions, for labels
    unmetered_engines: [name, ...] }                  # fleet engines with telemetry: none
```

**`computeUnitEconomics` surface:** the `tokens_source` scalar keeps its exact current meaning (transcript-side measurement basis, `economics.js:98` sanity gate untouched). The output blob gains an **additive** `spend_sources` array (same shape as `sources` above, plus per-source cost where priceable) and an additive `unmetered_engines` list — both omitted when the run is single-source pure-transcript, so existing consumers see byte-identical JSON.

**Chosen:** per-engine source labels land as an additive `spend_sources` top-line array plus a `source` field on `--by model` rows; `tokens_source` stays a scalar with unchanged semantics. Rationale: the scalar gates estimate-mode sanity checks and is consumed downstream — overloading it would ripple; the `--by mcp`/`effort` axes already set a per-breakdown `source` label (`economics.js:568`), so a per-row `source` is the established vocabulary. **Punt:** a dedicated `--by engine` axis — needs a call on whether operators want it (decides: product).

**Opt-out shape:**

```
budget:
  cost: 25
  allow_unmetered: [my-ollama-lane]   # explicit, per backend name
```

**Chosen:** the dollar-mode opt-out is `budget.allow_unmetered: [<backend names>]` — a budget-block list, not a backend-record flag. Rationale: "I accept unmetered spend under a dollar ceiling" is a budget policy owned by whoever set the ceiling, not a property of the engine; a per-backend flag would let an engine definition quietly waive someone else's ceiling. The refusal message prints the exact line to add. An allowed-unmetered engine is still named in `unmetered_engines` in every budget/economics output — opted out of refusal, never out of visibility.

## 4. HOW — Behavior

### Recording spend at the codex call boundary

Codex exec is `--ephemeral`: no session file, temp cwd removed. There is no codex-side artifact to attribute later, so attribution happens where the run identity is known — the caller.

**Chosen:** `runCodexCall` gains an injectable spend sink; after a successful parse (step 4 of the existing procedure) it sums usage across the call's `turn.completed` events and invokes the sink with one SpendRecord; the default sink appends the line to `<runDir>/engine-spend.jsonl`. Rationale: the call boundary is the only place that knows both the usage and the run; a sink keeps the selftest zero-I/O (same injection style as `spawnFn`/`mkdtempFn`). Recording failures (unwritable file) warn on stderr and never change the call's exit code — spend metering must not break a producer dispatch.

**Chosen:** `faff engine call` learns its run the way budget does: an optional `--run-dir` flag, else the latest run under `<root>/.faff/runs` (the `resolveLedgerOrFault` family in `shared-infra`). When no run exists, nothing is recorded and a single stderr line says so ("engine call outside a run — spend not metered"). Rationale: an ad-hoc call outside a run has no budget scope to protect; silence would violate the never-silent principle, a hard failure would break legitimate ad-hoc use. **Any dispatcher that already knows its run (a producer dispatch inside a faff run) must pass `--run-dir` explicitly** — the latest-run fallback is for ad-hoc human calls only, because with concurrent runs in one repo "newest run dir" is an mtime-shaped ownership signal of exactly the class FAFF-229 retired for transcripts (the mis-attribution error direction is over-count on a sibling run — safe for ceilings, still wrong for attribution).

Spend recording is unconditional on success (a completed call's usage is always appended when a run dir resolves) and skipped on failed calls — a failed call may still have partial usage in its events, but attributing failed-call spend is a refinement, and under-counting a failed call errs in the direction the transcript path already errs (undercount-not-overcount).

### The combined measurement

```
PROCEDURE measureRunSpend(cwd, env, runStartMs, runDir, cfg):
  1. t := measureTokensByModelClass({cwd, env, runStartMs})      # existing, untouched
  2. e := readEngineSpend(runDir)                                 # parse engine-spend.jsonl;
     #  malformed lines skipped (same posture as the transcript loop); missing file -> zeros
  3. totals/by_model := per-class sum of t and e (union of models)
  4. tokens_source := t.source                                    # "transcript" | "estimate", unchanged meaning
  5. sources := [ {source: "transcript-jsonl", ...t contribution},   # present only when t.source == "transcript"
                  {source: "exec-json-events", ...e contribution} ]  # present only when e has records
  6. unmetered_engines := fleet engines (resolved engine: refs in cfg's models/slots lanes)
     whose merged-backend telemetry == "none"
  RETURN the record from §3
```

**Chosen:** the dispatch layer is this one new function; `cmdBudget check` and `cmdEconomics` switch their measurement call to it; `sumTranscriptFile*`, `sessionOwnedTranscriptFiles`, `measureTokens*` keep their exact current bodies and remain exported. Rationale: the byte-for-byte requirement admits only this direction; parity tests pin that a run with no `engine-spend.jsonl` produces totals identical to today's.

**Estimate mode:** when the transcript side degrades to `{source: "estimate"}`, exec-json-events records still count — they are measured, not estimated. `tokens_source` stays `"estimate"` (the transcript basis), and the cost branch's existing estimate-mode behavior (`budget.js:886-888`) is relaxed only this far: measured exec-json-events sums are priceable; the unmeasured transcript remainder keeps the existing "not meterable from estimates" warning.

### Window mode composes for free

`cumulativeForWindow = tokens` (`budget.js:870`) — the window draw baseline is the run-total figure. Because the combining happens upstream in `measureRunSpend`, the window accumulator, anchor, and reset logic (`budget.js:899-944`) need **no changes**: a mixed-fleet window ceiling is a true combined total by construction.

**Chosen:** window mode with a `telemetry: none` engine in the fleet is *permitted* (it is the ticket's designated fallback for unmetered engines) and meters only the observable engines' draw; every `budget check` output in that state carries `unmetered_engines` so the reading is labeled as a lower bound, never presented as complete. Rationale: refusing window mode too would leave `none` engines with no budget story at all, contradicting the ticket; the honest-labeling rule keeps the lower bound from masquerading as a total.

### Where `telemetry: none` + dollar mode refuses

**Chosen:** the hard refusal lives in the lights-out **mint-time preflight** (the exact seam `budget.js:316-320` names for `price_per_mtok_removed`): when `budget.cost` is configured and any resolved fleet engine has `telemetry: none` and is not listed in `budget.allow_unmetered`, the mint refuses with a message naming the engine, the reason ("spend unobservable — dollar ceiling cannot see this engine"), and the two remedies (window mode / `allow_unmetered`). `budget check` adds defense in depth: in the same state it reports `cost: null` (never a number computed as if the engine spent nothing) plus an unconditional warning — exit code unchanged, per the never-fail-open principle. Rationale: a `checkRealizable`-style admission refusal at check time is structurally impossible here — a non-zero `budget check` exit is read as unbreached and would fail the whole signal open; mint time is where refusing is free, exactly as FAFF-446 established.

### Edge cases and error handling

- **Malformed `engine-spend.jsonl` line** → skip the line (never crash a budget check over a partial write); count of skipped lines surfaces in economics warnings.
- **Unknown `telemetry` value in config** → normalize-time error from `validateBackendConstraints`, closed-enum message (same as `auth`).
- **`telemetry` claim vs family mismatch** (e.g. `exec-json-events` on an ollama backend) → normalize-time error naming the legal pairing.
- **Codex model unpriced in the ADR-0048 map** → existing fail-safe applies unchanged: costliest known rate, over-count, named warning (`budget.js:893-895`). Retryable: no; the warning is the terminal surface until the map gains rates (see Punt).
- **`allow_unmetered` naming an unknown backend** → `faff config check` warning (dead entry), not an error — a renamed backend shouldn't brick the config.
- **Spend file append fails mid-run** → stderr warning from the sink, call exit unchanged; the run under-counts, which is the established safe direction.

### Failure modes — how the approach falls over

- **The failure:** codex-rs renames/reshapes the `turn.completed` usage fields (spec pins them from source, no live binary on the build machine — same posture FAFF-593 shipped with). **How you'd know:** a healthy mixed-fleet run's `spend_sources` shows an `exec-json-events` entry with 0 tokens while the codex lane demonstrably ran (the selftest can't catch live drift; the observable is the zero-usage-with-completed-calls signature). **What it means:** re-pin the usage extraction against the live stream — narrow, don't abandon; the seam itself is source-shape-agnostic.
- **The failure:** per-call spend records double-count against the transcript when a future engine writes both (an engine whose calls also land in the orchestrator transcript). **How you'd know:** the parity test comparing combined totals to transcript-only totals on a Claude-only run would show a diff. **What it means:** the family-capability constraint is the guard — one source per family; keep it closed.

**Anti-pattern:** teaching `sumTranscriptFileByModelClass` to also read `engine-spend.jsonl`. Why: it collapses the two sources into one loop, breaking the byte-for-byte guarantee and the per-source labels at once.

**Anti-pattern:** exiting non-zero from `budget check` on the `none`+dollar condition. Why: `sentryReadBudget` reads non-zero as unbreached — the refusal would fail the budget signal open, the exact failure FAFF-364 closed.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run with a Claude orchestrator (telemetry: transcript-jsonl) and a codex build lane
      (telemetry: exec-json-events) that has completed at least one engine call
When  `faff budget check` runs mid-run
Then  the reported token total equals transcript-attributed tokens + engine-spend.jsonl tokens,
      and the economics blob's spend_sources names both sources with per-source token counts
```

```
Given a fleet containing an engine with telemetry: none, budget.cost set, and no
      budget.allow_unmetered entry for it
When  lights-out attempts to mint a run
Then  the mint refuses, naming the engine and both remedies (window mode / allow_unmetered);
      and a `faff budget check` in the same config reports cost: null with a warning, exit 0
```

```
Given budget.window configured and a mixed fleet with an open window
When  the codex lane completes a call and `faff budget check` runs
Then  window draw (tokens since anchor) includes the exec-json-events tokens —
      one combined figure, not a transcript-only one
```

- A run with no `engine-spend.jsonl` MUST produce budget and economics output byte-identical to pre-change output (additive fields absent).
- `parseCodexEvents` and every function in `budget.js:422-534` MUST be textually unchanged.

## 6. Design decision rationale

- **Explicit `telemetry` field vs derived-with-override?** Explicit-only burdens every config; derived-only can't express future exceptions. **Chosen:** derive-with-override with family-capability constraints — the `auth`/`egress` precedent, stated in §3.
- **Attribute codex spend from the event stream vs at the call boundary?** The stream is ephemeral and carries no run identity. **Chosen:** caller-boundary sink appending to run-owned `engine-spend.jsonl` — stated in §4.
- **How does `engine call` find its run?** **Chosen:** `--run-dir` flag, else latest-run resolution, else warn-and-skip — stated in §4.
- **Refuse at admission (`checkRealizable`-style) vs inside budget check?** **Chosen:** mint-time preflight refusal + check-time loud degrade — the fail-open constraint decides it, stated in §4.
- **Opt-out on the backend record vs the budget block?** **Chosen:** `budget.allow_unmetered` list — ceiling owner owns the waiver, stated in §3.
- **Source labels: overload `tokens_source` vs additive fields?** **Chosen:** additive `spend_sources` + per-row `source`; **Punt:** `--by engine` axis (decides: product) — stated in §3.
- **Window with a `none` engine: refuse, or meter what's observable?** **Chosen:** permit and label — stated in §4.
- **Combine inside the transcript loop vs a layer above?** **Chosen:** new `measureRunSpend` dispatch layer — stated in §4.
- **Punt:** adding OpenAI/codex rates to the ADR-0048 price map — the fail-safe over-count covers the interim; whether to carry non-Anthropic rates at all is a pricing-policy call (decides: product).

## 7. Open questions and assumptions

**Open questions (Punt items):**
- `--by engine` economics axis — wanted, or is per-row labeling enough? (decides: product)
- Non-Anthropic rates in the price map — until decided, codex spend prices at the costliest-known-rate over-count with a named warning. (decides: product)

**Assumptions:**
- **Assumes:** codex `turn.completed` usage carries `input_tokens`, `output_tokens`, and optionally `cached_input_tokens`, per codex-rs `exec_events.rs` — the same unpinned-against-live-binary posture FAFF-593 shipped with (`engine-codex.js:19-23`). Validate: run one live `codex exec --json` call and eyeball a `turn.completed` line before trusting the field mapping; the selftest fixture (`engine-codex.js:211`) shows the expected shape.
- **Assumes:** FAFF-593's `runCodexCall` injectable-dependency style (spawnFn/env/writers/mkdtempFn) is the accepted seam for the new sink parameter. Validate: read `engine-codex.js:92`.
- **Assumes:** `resolveLedgerOrFault`/latest-run resolution in `shared-infra` is callable from `engine.js` without a dependency cycle. Validate: check `shared-infra.js` exports and `engine.js`'s existing requires before wiring.

## 8. DONE — definition of done

### From WHY (principles)
- [ ] A run with no `engine-spend.jsonl` produces budget check + economics JSON byte-identical to pre-change output (parity test in `test/budget.test.mjs` and `test/economics.test.mjs`)
- [ ] `budget.js:422-534` (`sumTranscriptFileByModelClass` through `sessionOwnedTranscriptFiles`) and `parseCodexEvents` textually unchanged

### From WHAT (types and config)
- [ ] `telemetry` in `BACKEND_RECORD_KEYS`; derived anthropic→`transcript-jsonl`, codex→`exec-json-events`, other→`none`; explicit value wins (backendsSelftest rows)
- [ ] Closed enum: unknown `telemetry` value → normalize-time error naming the legal set
- [ ] Family-capability constraint: `exec-json-events` on a non-codex provider (and `transcript-jsonl` on a non-anthropic provider) → normalize-time error
- [ ] `budget.allow_unmetered` parsed from the budget block; unknown backend name → `faff config check` warning

### From HOW (recording)
- [ ] Successful `runCodexCall` with a resolved run dir appends one SpendRecord with class-mapped usage sums to `engine-spend.jsonl` (codexSelftest via injected sink — zero real I/O)
- [ ] `faff engine call` accepts `--run-dir`, falls back to latest-run resolution, and warns-and-skips recording when no run exists (test/engine-call.test.mjs)
- [ ] Sink write failure → stderr warning, call exit code unchanged

### From HOW (measurement and ceilings)
- [ ] `measureRunSpend` sums transcript + engine-spend per model class; budget check token total reflects both (budget.test.mjs fixture with a fake transcript tree AND a seeded engine-spend.jsonl)
- [ ] Window draw includes exec-json-events tokens with `budget.js:899-944` unchanged
- [ ] Estimate-mode transcript + measured engine-spend: totals include the measured part, `tokens_source` stays `"estimate"`
- [ ] Estimate-mode cost: the partial-cost figure prices the measured exec-json-events portion only, and the existing "not meterable from estimates" warning still fires for the transcript remainder
- [ ] Malformed engine-spend lines skipped, surfaced as a warning count

### From HOW (refusal and labels)
- [ ] Mint-time preflight: `budget.cost` + fleet engine with `telemetry: none` not in `allow_unmetered` → mint refuses naming engine + both remedies
- [ ] Same state at `budget check`: `cost: null`, warning emitted, exit 0
- [ ] `unmetered_engines` present in budget check and economics output whenever the fleet has a `none` engine (opted out or not); no field ever reports that engine's spend as 0
- [ ] Economics blob: additive `spend_sources` with per-source tokens (and cost where priced); `--by model` rows carry `source`; single-source transcript-only runs omit the additive fields

**Integration smoke test:**

```
1. Fixture repo: .faffrc with anthropic orchestrator backend + codex backend, budget.cost + budget.window set
2. Seed a fake transcript tree (existing runCli/CLAUDE_CONFIG_DIR harness) and a run dir
3. Invoke runCodexCall with injected spawnFn returning a stream containing turn.completed usage,
   default sink pointed at the run dir
4. Run `faff budget check` → total = transcript + codex tokens; window_tokens reflects both
5. Run `faff economics` → spend_sources lists both sources; totals reconcile with step 4
```

confidence: high
spec-review: approve
