# FAFF-705 — Allow reasoning-effort tuning on engine/seat lanes (lift the effort × engine refusal)

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: high. Full spec on Linear FAFF-705.

This is the buildable specification for Linear issue **FAFF-705 — "Allow reasoning-effort tuning on engine/seat lanes (lift the effort × engine refusal)."** Its audience is the build agent that will implement the change and the human reviewers gating it. It follows the full nlspec arc (WHY → OUT OF SCOPE → WHAT → HOW → SCENARIOS → RATIONALE → OPEN QUESTIONS/ASSUMPTIONS → DONE). All file paths are relative to `plugin/skills/faff/` unless given in full.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff has two independent per-lane knobs today: `models.<lane>` picks *which* model runs, and `effort.<lane>` picks *how hard it reasons*. For an Anthropic model the effort knob drives the Agent tool's `reasoning-effort` argument. For an `engine:<name>` lane (a GPT/Codex subscription seat), `effort.<lane>` is currently **refused outright** — the transport ignores it. But the two engine transports faff already speaks (the OpenAI-compatible `reasoning_effort` request field, and `codex exec`'s `-c model_reasoning_effort`) both accept graded effort. So the refusal is a not-built-yet placeholder, not a principled no. This change plumbs a resolved `effort.<lane>` through `faff engine call` to those transports, and teaches `economics --by effort` to see the result.

**Problem statement.** Today `resolveEngineForLane` (`bin/lib/config.js:287-289`) hard-refuses any non-`inherit` `effort.<lane>` on an engine-valued lane, so a Codex/GPT seat lane can tune which model runs but is stuck at `reasoning_off` on/off — never the graded `low|medium|high|xhigh|max` those backends expose. With subscription-seat auth landed (FAFF-481 / ADR-0092), "run GPT on my seat" should include "at the effort I choose." This change lifts the refusal for engines whose transport carries graded effort, maps the value onto each transport, and keeps a reworded refusal only for engines that genuinely cannot.

**Design principles.**

**Fail loud, never silently degrade.** faff's house rule (visible throughout `bin/lib/`, e.g. the `resolveSpendSink` stderr note at `engine.js:222`, the fail-loud effort-vocab validation at `config.js:330`) is that a knob that cannot be honoured is refused with a named message, never quietly dropped. A lifted refusal must therefore either honour the effort or say precisely why it cannot — it must not accept `effort.<lane>` and then ignore it.

**The five-level effort vocabulary stays closed and lane-uniform.** `EFFORT_LANE_VOCAB` (`config.js:323-327`) fixes `inherit|low|medium|high|xhigh|max` for every tunable lane. This change must NOT fork the vocabulary per-engine (a lane's legal effort set cannot depend on which engine it points at — read-time validation has no engine context). Any narrower transport target is reached by *mapping at dispatch*, not by refusing tokens at read.

**Capability is a property of the transport family, not a hand-set flag.** Which transport can carry graded effort is already fully determined by `ENGINE_PROVIDER_FAMILY` (`config.js:207-212`). The lift keys off that single source, not a new opt-in field an operator could get wrong.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `bin/lib/config.js` `resolveEngineForLane` (271-317) | JavaScript | The refusal (285-289) and the resolved-engine record this change extends |
| `bin/lib/config.js` `EFFORT_LANE_VOCAB` (323-327) | JavaScript | Closed effort vocabulary + `validateEffortLane` |
| `bin/lib/engine.js` `buildEngineRequest` (43-62) | JavaScript | OpenAI/ollama HTTP request builder — one graded-effort encode site |
| `bin/lib/engine-codex.js` `buildCodexArgv` (44-47) | JavaScript | codex argv builder — the other encode site |
| `bin/lib/engine.js` `cmdEngine` (229-301) | JavaScript | Dispatch: resolve → fork to spawn runner or HTTP path |
| `bin/lib/engine-codex.js` `runCodexCall` (153-282) | JavaScript | codex spawn runner + spend sink (264-277) |
| `bin/lib/economics.js` `economicsEffortBreakdown` (553-591) | JavaScript | `--by effort` axis (reads events.jsonl only) |
| `bin/lib/economics.js` model-axis engine fold (411-451) | JavaScript | The existing FAFF-604 two-source pattern this change mirrors for the effort axis |
| `bin/lib/budget.js` `appendEngineSpend`/`readEngineSpend` (614-650) | JavaScript | engine-spend.jsonl writer/reader + the SpendRecord shape |
| `docs/adr/0054-*.md` (FAFF-422) | Markdown | ADR whose "effort refused on engine lanes" consequence this ticket amends |
| `docs/adr/0050-*.md` (FAFF-416) | Markdown | Establishes the three tunable effort lanes; engine lanes are two of them |

**Scope statement.** This sits at the seam between the per-lane effort surface (FAFF-416) and the engine-call transport layer (FAFF-422/FAFF-593/FAFF-481) — it is the tuning branch FAFF-593 explicitly deferred to a later ticket (`docs/specs/2026-07-25-FAFF-593-*-design.md:39,225`).

## 2. OUT OF SCOPE

- **HTTP (OpenAI-family) engine-call spend metering.** — *Excluded:* The HTTP dispatch path (`runEngineCall`, `engine.js:153-167,292`) records **no** spend today — only the codex spawn path has a `spendSink` (`engine-codex.js:264-277`); the OpenAI response's `usage` block is discarded by `parseEngineResponse`. Metering HTTP engine calls is a pre-existing FAFF-604 gap, orthogonal to effort. *Why:* Adding usage extraction + a new sink on the HTTP path is a separate, larger change; this ticket lands effort *control* on both families and effort *measurement* wherever engine-spend already flows (codex). *Extension point:* give `runEngineCall` a `spendSink` (mirroring `runCodexCall`), extract `usage` in `parseEngineResponse`, append an engine-spend record carrying the same `effort` field this ticket adds.

- **New effort-tunable lanes.** — *Excluded:* The tunable set stays `effort.build|methodology|intake` (ADR-0050); only `methodology`/`intake` are engine-dispatchable (`ENGINE_CALL_LANES`, `config.js:199`). *Why:* Widening `ENGINE_CALL_LANES` is a deliberate two-enforcement-point act (ADR-0054), out of this ticket's intent. *Extension point:* `ENGINE_CALL_LANES` and `EFFORT_LANE_VOCAB`.

- **A per-backend effort override field.** — *Excluded:* FAFF-593's note floated "a future per-backend tuning field in the Backend record, mirroring `reasoning_off`." This change derives capability from the provider family instead (see the WHAT capability decision). *Why:* The effort *value* already comes from `effort.<lane>`; the *capability* is family-determined; a per-backend field would duplicate both. *Extension point:* `BACKEND_RECORD_KEYS` (`backends.js:28-31`) if a future ticket needs per-engine effort caps beyond the family default.

- **A richer OpenAI effort vocabulary (e.g. `minimal`).** — *Excluded:* The mapping targets `low|medium|high` only. *Why:* faff's floor is `low`; nothing below it is expressible in `EFFORT_LANE_VOCAB`. *Extension point:* the `reasoningEffortForTransport` mapping helper.

- **Streaming / incremental transport changes and codex sandbox-mode mapping.** — *Excluded:* FAFF-593/FAFF-605 territory, untouched here. *Extension point:* `buildCodexArgv` (sandbox), the codex parser (streaming).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| faff effort level | A token from the closed five-level vocabulary `low|medium|high|xhigh|max` (plus the config-time-only `inherit`). What an operator writes in `effort.<lane>`. |
| transport effort level | The value actually sent to a backend: OpenAI `reasoning_effort` / codex `model_reasoning_effort`, drawn from the three-level target `low|medium|high` (per Assumptions). |
| graded-effort family | A transport family whose wire protocol carries a graded reasoning-effort control. Here: `openai` and `codex`. `ollama` is not one (only `think:false` on/off). |
| effort clamp | Mapping a faff level above the transport ceiling (`xhigh`, `max`) down to the nearest supported transport level (`high`). |

**The graded-effort family set.** A single derived constant names the families whose transport carries graded effort, keyed off the existing family strings:

```
CONSTANT EFFORT_GRADED_FAMILIES = { "openai", "codex" }   # NOT "ollama"
# Home: config.js, beside ENGINE_PROVIDER_FAMILY (207-212). Membership is
# derived from the family string that ENGINE_PROVIDER_FAMILY already assigns —
# no new per-backend config field.
```

**The transport mapping (pure).** One helper both encode sites call:

```
FUNCTION reasoningEffortForTransport(faffLevel):    # faffLevel ∈ low|medium|high|xhigh|max
  RETURN one of "low" | "medium" | "high":
    low    -> low
    medium -> medium
    high   -> high
    xhigh  -> high      # clamp to ceiling
    max    -> high      # clamp to ceiling
  # never called with "inherit" (that path omits effort entirely)
# Home: config.js (the effort-vocabulary module both engine.js and
# engine-codex.js already require). Exported.
```

**The resolved-engine record gains an `effort` field.** `resolveEngineForLane`'s success return (`config.js:302-316`) adds one field:

```
RECORD ResolvedEngine (added field only):
  effort: faff effort level | null   # null when effort.<lane> is inherit (or unset);
                                      # else the resolved faff level (pre-map, five-level)
  # existing fields unchanged: name, provider, family, model, host, binPath,
  # apiKeyEnv, auth, seatTokenEnv, reasoningOff, timeoutMs
```

The stored value is the **faff-requested** level (five-level), not the transport-mapped level — see the HOW decision on what the telemetry records.

**The SpendRecord gains an `effort` field.** The codex spend record (`engine-codex.js:266-273`, written via `appendEngineSpend`) adds one optional field:

```
RECORD SpendRecord (added field only):
  effort: faff effort level | null   # the resolved faff level for this call, or null
  # existing fields unchanged: ts, engine, provider, model, source,
  # input, output, cache_write, cache_read
```

**Interfaces changed.**

- `buildEngineRequest({ ..., reasoningOff, effort })` — new optional `effort` param (faff level | null). `engine.js:43`.
- `buildCodexArgv(model, effort)` — new optional second param (faff level | null). `engine-codex.js:44`.
- `runCodexCall` reads `engine.effort`, passes it to `buildCodexArgv` and into the SpendRecord. `engine-codex.js:153`.
- `readEngineSpend(runDir)` — **extended** (`budget.js:624-650`). Today it returns `{ totals, by_model, engines, records, malformed }` where `by_model` is a `Map<model, {classes}>` that has collapsed away every effort dimension and `records` is a **count**, not an array — so the effort axis cannot recover per-effort tokens from it. Add a joint aggregation `by_model_effort: Map<"model effort", {input,output,cache_write,cache_read}>` (effort key `(none)` when the record has no `effort` field), accumulated in the same read loop beside `by_model`. `by_model`, `totals`, `records`, `engines`, and every existing consumer stay byte-for-byte unchanged (a new map is additive — `measureRunSpend`'s fold, `budget.js:660-668`, ignores it). This is the load-bearing reader change the effort fold depends on; it was previously mis-described as "already computed."
- `economicsEffortBreakdown(events, priceMap, dominant, topLineTotal, malformedLines, engineSpend)` — new trailing optional `engineSpend` param: the **extended** `readEngineSpend` result (carrying `by_model_effort`), computed at the call site alongside the existing model-axis fold (`economics.js:760`). The fold reads `by_model_effort`, never per-record. `economics.js:553`.

## 4. HOW — Behavior

**Architecture and approach.** The change touches four points along one path: (1) `resolveEngineForLane` stops blanket-refusing and instead resolves+validates effort against the family's capability, carrying a faff level on the record; (2) the two encode sites (`buildEngineRequest` for OpenAI HTTP, `buildCodexArgv` for codex spawn) emit the mapped transport value; (3) the codex spend record carries the faff level; (4) the `--by effort` economics axis folds engine-spend records into its buckets, exactly as the model axis already folds them for cost.

**Resolving effort at the lane (replaces the refusal).** Behaviour summary: an `inherit` lane is byte-for-byte unchanged; a graded level on a graded-effort family is carried through; a graded level on a non-graded family, or a contradiction with `reasoning_off`, fails loud.

```
PROCEDURE resolve_effort_for_engine(cfg, lane, family, name, provider, reasoningOff):
  # replaces config.js:285-289
  1. effort <- normalise(dig(cfg, "effort."+lane))   # "" / null -> "inherit"
  2. IF effort == "inherit":
       RETURN { effort: null }                        # unchanged path — no arg emitted
  3. IF family NOT in EFFORT_GRADED_FAMILIES:          # ollama today
       RETURN { error: 'effort.<lane> is "<effort>" but engines.<name> '
                       '(provider <provider>, family <family>) has no graded '
                       'reasoning-effort transport — only reasoning_off (on/off). '
                       'Set effort.<lane> to inherit and use '
                       'engines.<name>.reasoning_off, or point the lane at a '
                       'graded-effort engine (an openai-family or codex backend).' }
  4. IF reasoningOff == true:                          # contradictory config
       RETURN { error: 'effort.<lane> is "<effort>" (graded) but engines.<name> '
                       'sets reasoning_off: true — contradictory; a lane cannot '
                       'both silence reasoning and request a graded effort. '
                       'Drop one.' }
  5. RETURN { effort: effort }                         # carried on the resolved record
```

Note: `validateEngineRef` already refuses `reasoning_off: true` on codex (`config.js:254-256`), so step 4 bites only on the OpenAI family (where both `reasoning_off` and `reasoning_effort` are individually legal). The off-vocabulary guard is unchanged: `validateEffortLane` (`config.js:328`) still fails a bad token at read time, so step 1 only ever sees a legal faff level or `inherit`.

**OpenAI HTTP encode site.** Behaviour summary: emit `reasoning_effort` only when a graded effort is present and reasoning is not being silenced.

```
PROCEDURE buildEngineRequest_openai(payload, reasoningOff, effort):
  # engine.js:52-54, family == "openai"
  1. IF reasoningOff:  payload.chat_template_kwargs = { thinking: false }   # unchanged
  2. ELSE IF effort:   payload.reasoning_effort = reasoningEffortForTransport(effort)
  # ollama branch (49-51) unchanged: only think:false; effort never reaches it
  # (refused at resolve). Guard: ignore a stray effort on ollama, never throw.
```

**codex spawn encode site.** Behaviour summary: append `-c model_reasoning_effort=<mapped>` before the trailing stdin `-`.

```
PROCEDURE buildCodexArgv(model, effort):
  # engine-codex.js:44-47
  base <- ["exec","--json","--ephemeral","--skip-git-repo-check",
           "--sandbox","read-only","-m", model]
  IF effort:  base <- base + ["-c", "model_reasoning_effort=" + reasoningEffortForTransport(effort)]
  RETURN base + ["-"]
```

**The clamp note (fail-loud spirit without noise).** When `reasoningEffortForTransport` clamps (`xhigh`/`max` → `high`), `cmdEngine` writes one informational stderr line before dispatch — mirroring the existing `resolveSpendSink` "spend not metered" note (`engine.js:222`) — so an operator who set `max` on a three-level seat is told it ran at `high`, not left to guess:

```
faff engine call: effort.<lane> "<effort>" clamped to "high" — engines.<name>
(<provider>) reasoning-effort tops out at high; set effort.<lane> to high to
silence this note.
```

This is a note, not a refusal (the ticket sanctions "map to the nearest supported"). It is emitted once per call at the point of dispatch, not per token.

**Economics `--by effort` fold.** Behaviour summary: the effort axis becomes two-source like the model axis — events.jsonl for Agent-lane dispatches, engine-spend.jsonl for engine-lane calls — bucketed by the faff level each carries.

```
PROCEDURE economicsEffortBreakdown(events, ..., engineSpend):
  1. Bucket events by data.effort as today (economics.js:557-577).
  2. IF engineSpend.records > 0:                          # the byte-identity gate
       FOR each ("model effort" -> cell) in engineSpend.by_model_effort:
         IF effort NOT in EFFORT_LEVELS: effort <- "(none)"  # incl. the (none) key
         bucket <- buckets[effort]   (create if absent)
         add cell.{input,output,cache_write,cache_read} to bucket + bucket.total
         # price THIS cell at THIS model (the map key carries the model), then
         # accumulate the priced cost into the bucket — pricing per (model,effort)
         # cell is exactly why the reader keeps the joint map, not a flat by_effort
  3. Pricing: each by_model_effort cell is priced at its own model via the same
     price map the model-axis fold uses (economics.js:411-420);
     transcript-derived (events) buckets stay priced at `dominant` as today.
  4. source <- "events+engine-spend" when engineSpend.records > 0, else "events".
  5. Reconciliation: extend the honest-coverage reporting to include folded
     engine tokens (mirror economics.js:440-443's engineFolded target adjustment).
```

The fold iterates the reader's **aggregated** `by_model_effort` map (one cell per model×effort), never per-record — the raw records are not retained, and do not need to be, because bucketing is by effort and pricing is by the model the map key carries.

The membership gate is the existing `EFFORT_LEVELS` set (`events.js:82` = `low|medium|high|xhigh|max`, no `inherit`) — the faff-level `effort` stored on the SpendRecord validates against exactly the same closed set the event tags do, which is *why* the record stores the faff level, not the transport-mapped one.

**Edge cases and error handling.**

- **`inherit` (or unset) effort** on any engine lane → `effort: null`, no transport arg, byte-for-byte unchanged dispatch and unchanged engine-spend record shape (the `effort` key is omitted — see the byte-identity note in Failure modes).
- **Graded effort on ollama** → refused at resolve (step 3), exit 2, before any spawn/HTTP.
- **Graded effort + `reasoning_off: true` on one OpenAI engine** → refused at resolve (step 4), exit 2.
- **`xhigh`/`max` on a three-level family** → clamped to `high`, one stderr note, dispatched.
- **Off-vocabulary effort token** (e.g. `effort.methodology: turbo`) → unchanged: `validateEffortLane` fails it at read (`config get` exit 2), never reaches resolve.
- **codex with graded effort but not logged in** → unchanged failure ordering: the seat probe (`engine-codex.js:176-185`) still fails auth before the effort-bearing spawn.

**Failure modes.**

- **The failure:** folding engine-spend into the effort axis breaks FAFF-604's byte-identity guarantee (an unchanged transcript-only run must emit unchanged economics JSON, down to absent keys — `economics.js:406-410`). *How you'd know:* the economics selftest / `economics.test.mjs` snapshot for a transcript-only run diffs. *What it means:* narrow — gate the fold behind "engine-spend has records" exactly as the model axis does (`economics.js:411,417-420`); a run with no engine-spend must produce byte-identical output including `source: "events"`.
- **The failure:** storing `effort: null` on every codex SpendRecord (including `inherit` calls) changes the serialized record for pre-existing codex runs, tripping FAFF-604 spend snapshots. *How you'd know:* `economics.test.mjs` engine-spend fixtures (`:733-841`) diff on the added key. *What it means:* narrow — omit the `effort` key entirely when it is null (do not serialize `effort: null`), so an `inherit` engine call's record is byte-identical to today; `readEngineSpend` already treats a missing field as absent.
- **The failure:** the three-level target assumption is wrong for one backend (e.g. a codex build that rejects `high`, or an OpenAI-compatible host that 400s on `reasoning_effort`). *How you'd know:* `faff engine call` returns `engine-unreachable`/`malformed-response` (exit 5/7) for that engine only, with the transport's error in the note. *What it means:* proceed — the failure is named and per-engine (not silent); the Assumption below records how to validate before relying on it.

**Anti-pattern:** forking `EFFORT_LANE_VOCAB` per family so ollama lanes reject `high`. Why: read-time validation has no engine context, and it breaks the lane-uniform vocabulary principle — the narrowing belongs at dispatch (resolve refusal + clamp), not at read.

**Anti-pattern:** making the OpenAI HTTP path write engine-spend as a side-quest of this ticket. Why: HTTP engine calls are entirely unmetered today (a distinct FAFF-604 gap); bolting usage-extraction + a sink onto this change smuggles in scope. It is an explicit OUT OF SCOPE item with an extension point.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a methodology lane set to engine:<gpt-seat> (an openai-family backend)
  and effort.methodology set to "high"
When faff engine call --lane methodology dispatches
Then the resolved engine record carries effort "high"
  and the HTTP request payload includes reasoning_effort: "high"
  and the call is NOT refused
```

```
Given an intake lane set to engine:<codex-seat> and effort.intake set to "medium"
When faff engine call --lane intake dispatches
Then buildCodexArgv includes -c model_reasoning_effort=medium
  and the appended engine-spend record carries effort: "medium"
```

```
Given a methodology lane pointed at an ollama engine and effort.methodology set to "low"
When faff engine call --lane methodology dispatches
Then the call is refused with exit 2
  and the message names ollama's lack of a graded reasoning-effort transport
  and directs the operator to reasoning_off or a graded-effort engine
```

```
Given a run whose engine-spend.jsonl holds codex calls tagged effort "high" and "medium"
  and events.jsonl holds Agent-lane dispatches tagged effort "low"
When economics --by effort runs
Then the high, medium, and low buckets are all populated
  and the breakdown's source reads "events+engine-spend"
```

- A transcript-only run with no engine-spend records MUST produce economics `--by effort` output byte-identical to today, including `source: "events"`.
- An `inherit` (or unset) engine lane MUST dispatch byte-identically to today — no transport effort arg, and an engine-spend record with no `effort` key.

## 6. DESIGN DECISION RATIONALE

**How does the five-level faff vocabulary map onto the OpenAI three-level `reasoning_effort`?** Options: (a) clamp above-ceiling levels to the nearest supported (`xhigh`,`max`→`high`); (b) refuse `xhigh`/`max` on three-level engines. Refusing fragments the closed lane-uniform vocabulary (a lane's legal set would depend on its engine) and contradicts the ticket's own "map to the nearest supported" wording. **Chosen:** clamp `xhigh`/`max`→`high` via a pure `reasoningEffortForTransport` helper, and emit one informational stderr note on clamp (fail-loud spirit, no per-token noise) — `low/medium/high` pass through unchanged.

**How does effort reach codex?** codex exposes `model_reasoning_effort` as a `-c` config override. **Chosen:** append `-c model_reasoning_effort=<mapped>` to `buildCodexArgv` (before the trailing stdin `-`) when a graded effort is present, using the same `reasoningEffortForTransport` mapping as the OpenAI path — one mapping, two encode sites.

**What happens on families with no graded reasoning-effort transport (ollama)?** Options: (a) keep the refusal but reword it to be capability-specific; (b) collapse any non-inherit effort to `reasoning_off`. Collapsing conflates two distinct knobs (a graded effort request silently becoming "reasoning off" is exactly the silent-degradation the house rule bans). **Chosen:** keep a reworded, capability-specific refusal for non-graded families — it names the missing transport capability and points at `reasoning_off` or a graded-effort engine, replacing today's blanket "engines can't carry effort" prose.

**What if a graded effort and `reasoning_off: true` are set on the same OpenAI engine?** Both are individually legal on the OpenAI family, but together they contradict (silence reasoning vs request graded reasoning). **Chosen:** refuse the pair at resolve time (exit 2) with a message naming the contradiction — do not let one silently win.

**How is graded-effort capability declared — a Backend field or the provider family?** FAFF-593 floated a future per-backend field mirroring `reasoning_off`. But `ENGINE_PROVIDER_FAMILY` already assigns every provider a family string, and capability tracks the family exactly (`openai`+`codex` graded; `ollama` not). A per-backend field would duplicate that and add a way to misconfigure it. **Chosen:** derive capability from the family via an `EFFORT_GRADED_FAMILIES` set beside `ENGINE_PROVIDER_FAMILY` — no new Backend record field. (Rejected FAFF-593's speculative per-backend field; noted as an extension point if per-engine caps are ever needed.)

**How does `economics --by effort` gain engine-lane coverage — an events.jsonl append or a SpendRecord field folded into the axis?** The model axis already folds engine-spend.jsonl into its breakdown (`economics.js:411-451`, FAFF-604 two-source union). Making engine calls also write events.jsonl would be a second, redundant telemetry path (engine calls deliberately use engine-spend.jsonl, not events.jsonl). **Chosen:** add an `effort` field to the codex SpendRecord, **extend `readEngineSpend` to carry a joint `by_model_effort` aggregation** (the existing `by_model` map has no effort dimension and `records` is only a count — neither can back a per-effort, per-model-priced fold, so the reader must grow the joint map), and fold that map into `economicsEffortBreakdown`'s buckets — mirroring the existing model-axis fold, priced at each cell's own model, gated on `engineSpend.records > 0` to preserve byte-identity for transcript-only runs. (Rejected: retaining raw per-record data in the reader — every other `readEngineSpend` consumer wants aggregates, so a joint aggregation is the minimal additive change.)

**Does the SpendRecord store the faff level or the transport-mapped level?** The `--by effort` axis validates buckets against `EFFORT_LEVELS` (`low|medium|high|xhigh|max`) and, for Agent lanes, buckets by the operator's chosen faff level. **Chosen:** store the resolved **faff** level (five-level, pre-clamp) on the SpendRecord, so an `xhigh` engine lane appears in the `xhigh` bucket alongside an `xhigh` Agent lane — the axis measures effort-requested uniformly, not per-transport-mapped. Omit the key entirely when null (byte-identity for `inherit` runs).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — every decision above is closed against codebase evidence and the ticket's stated intent.

**Assumptions.**

**Assumes:** the OpenAI-compatible `reasoning_effort` request field and codex's `-c model_reasoning_effort` both accept the values `low`, `medium`, and `high` on the seat backends operators will point these lanes at. *Validation before relying on it:* this is an external backend contract, not verifiable from the faff repo. The build agent implements against `low|medium|high` (per the explore findings and the ticket) and relies on the per-engine fail-loud path (`engine-unreachable`/`malformed-response`, exit 5/7) to surface any backend that rejects a value — the failure is named per-engine, never silent, so a wrong assumption degrades to a loud error for that one engine, not a silent miss across the fleet. (Reviewer-flagged extension: fold a one-call-per-graded-family behaviour check into build — confirm effort actually changes backend behaviour, not merely that the arg is accepted, before relying on the transport.)

## 8. DONE — Definition of Done

### From WHY
- [ ] A non-`inherit` `effort.<lane>` on a graded-effort engine lane (openai-family or codex) is NO LONGER refused; it dispatches carrying the effort.
- [ ] The rationale comment above `resolveEngineForLane` (`config.js:264-270`) and the SKILL.md refusal prose (`SKILL.md:273,925`) are updated to describe the lifted, capability-gated behaviour.
- [ ] ADR-0054's consequence "`effort.<lane>` refused on engine-valued lanes" is amended (revisit/supersede note) to reflect the graded-effort lift.

### From WHAT (types and interfaces)
- [ ] `EFFORT_GRADED_FAMILIES = { openai, codex }` exists beside `ENGINE_PROVIDER_FAMILY` and is derived from the family string (no new Backend field).
- [ ] `reasoningEffortForTransport(faffLevel)` returns `low→low, medium→medium, high→high, xhigh→high, max→high`.
- [ ] `resolveEngineForLane`'s success record carries `effort` (faff level, or `null` for inherit); existing fields unchanged.
- [ ] The codex SpendRecord carries `effort` (faff level) when non-null; the key is omitted when null.
- [ ] `readEngineSpend` returns an additive `by_model_effort: Map<"model effort", {classes}>` (effort key `(none)` when absent), accumulated in the existing read loop; `totals`/`by_model`/`records`/`engines` and all existing consumers (`measureRunSpend`) stay byte-for-byte unchanged.

### From HOW (behaviour)
- [ ] `buildEngineRequest` emits `reasoning_effort: <mapped>` for the openai family when `effort` is present and `reasoningOff` is false; ollama branch and the reasoning_off branch unchanged.
- [ ] `buildCodexArgv` appends `-c model_reasoning_effort=<mapped>` before the trailing `-` when `effort` is present; unchanged argv when absent.
- [ ] `runCodexCall` passes `engine.effort` to `buildCodexArgv` and into the SpendRecord.
- [ ] `cmdEngine` writes one stderr clamp note when `xhigh`/`max` is mapped to `high`.
- [ ] `economicsEffortBreakdown` folds the reader's `by_model_effort` map into effort buckets (bucket by the effort key, price each cell at its own model), `source` = `events+engine-spend` when `engineSpend.records > 0`; gated so a run with no engine-spend is byte-identical (`source: events`). The per-(model,effort) pricing is verifiable because the joint map key carries the model.

### From HOW (edge cases)
- [ ] A graded effort on an ollama engine lane is refused (exit 2) with the capability-specific message naming the missing transport and pointing at `reasoning_off` / a graded-effort engine.
- [ ] A graded effort combined with `reasoning_off: true` on one openai engine is refused (exit 2) naming the contradiction.
- [ ] An `inherit`/unset engine lane dispatches byte-identically to today (no transport arg; engine-spend record with no `effort` key).
- [ ] An off-vocabulary effort token still fails at read via `validateEffortLane` (`config get` exit 2), never reaches resolve.

### From tests
- [ ] `test/engine-call.test.mjs:131-138` (the "non-inherit effort × engine refused" test) is inverted for graded-effort families (now accepted, effort observable in argv/request) and kept — reworded — for ollama.
- [ ] The codex dispatch argv test (`engine-call.test.mjs:338-353`) covers a graded-effort argv (`-c model_reasoning_effort=...`).
- [ ] `test/economics.test.mjs` `--by effort` tests (`:461-538`) cover an engine-spend fold, and the FAFF-604 engine-spend tests (`:733-841`) assert byte-identity for a null-effort (inherit) codex record.
- [ ] The in-file selftests are updated: `engineSelftest` (`engine.js:398-428`, the `/effort/` refusal assertion), `codexSelftest`, `economicsEffortBreakdown` selftest (`economics.js:1065-1091`), `budgetSelftest` (`budget.js:1714-1729`, add a `by_model_effort` assertion), and `config.js` selftests.

### Eval coverage
- [ ] Not applicable — this change introduces no new LLM-judgement seam (the effort knob and its mapping are deterministic config/transport plumbing, not a graded/judged output).

### Integration smoke test
```
PROCEDURE smoke():
  1. Configure a methodology lane: models.methodology = engine:<codex-seat>,
     effort.methodology = "high", codex logged in (or api_key_env set).
  2. Run: faff engine call --lane methodology --system S --user U --run-dir D
  3. Assert exit 0 and the codex child was invoked with
     -c model_reasoning_effort=high.
  4. Run: faff economics --by effort --run-dir D
  5. Assert the "high" bucket is populated and source reads "events+engine-spend".
  # If this path works, resolve → transport encode → spend record → effort axis
  # are all connected.
```
