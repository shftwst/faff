# Spec — FAFF-873: Configurable `reasoning_effort` on the OpenAI-compatible adversarial payload

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-873.

This is a buildable design spec for FAFF-873, authored for the build agent that will implement it and the human reviewers who gate it. It adds a per-backend `reasoning_effort` knob that the OpenAI-compatible adversarial-review payload emits as the wire field `reasoning_effort`, so adversarial-review backends that honour graded reasoning can be tuned. The change is purely additive: a backend that does not set the field emits a byte-identical payload to today.

## 1. WHY — Problem and Principles

**The load-bearing model.** A single adversarial-review backend record flows from `.faffrc` config through two normalisation/allowlist gates and ends at one of two payload builders. `reasoning_effort` is a new optional scalar on that record. It must be threaded through *every* gate on the live path or it is silently dropped, and it must be translated from faff's five-tier effort vocabulary (`low|medium|high|xhigh|max`) into the wire's three-tier vocabulary (`low|medium|high`) at the moment of emission, so a real OpenAI endpoint never receives a token it would reject with a 400.

**Problem statement.** Today the adversarial payload can silence a reasoning model (`reasoning_off` → `chat_template_kwargs:{thinking:false}`) but cannot *tune* graded reasoning effort, even though faff already carries a graded-effort vocabulary and a transport clamp for its own engine lanes. This ticket adds a per-backend `reasoning_effort` control that emits the OpenAI `reasoning_effort` wire field, translated through the same clamp, so operators can dial adversarial reviewers up or down. Unset stays unset — no behaviour change for any existing config.

**Design principles.**

**Byte-identical when unset is the acceptance floor, not a nicety.** Every existing adversarial config must produce a wire payload identical to today's, byte-for-byte. The field is `present()`-gated at every copy and emit site, exactly as `reasoning_off` and `api_key_env` already are. Any implementation that changes an unset-field payload is wrong regardless of how the set-field path behaves.

**The wire never sees a non-enum token.** faff's config vocabulary is closed and wider than the wire's (`xhigh`/`max` have no wire equivalent). The config→wire mapper is the safety net: it clamps `xhigh` and `max` down to `high` before emission. This mirrors the shipped `reasoningEffortForTransport` clamp (`config.js:284`) that already governs faff's own engine lanes. Because the mapper guarantees a wire-legal token, a vanilla OpenAI endpoint never 400s on our emit.

**This is config-vocabulary validation, never model-capability validation.** The fail-loud check validates the *configured value* against faff's closed effort set. It must not validate against any hardcoded model list or infer whether a given model actually honours graded reasoning — the ticket forbids that. A wire-legal token sent to a model that ignores it is a no-op, not an error.

**`reasoning_off` and `reasoning_effort` are mutually exclusive on the wire, with a fixed precedence.** When both are set, `reasoning_off` wins and `reasoning_effort` is omitted — the established `engine.js:60-61` `else if` precedent. This is a precedence rule, not a config-validation error; a config that sets both is legal and resolves deterministically.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/backends.js` | CommonJS | Backend-record normalisation, record-key set, fail-loud constraint validation — the `refs:` path's gate |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | CommonJS | The emit allowlist (`BACKEND_KEYS`) + `pickBackendKeys` that assembles `--backends-json`, plus legacy-fallback inheritance |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Standalone `.mjs` (zero faff imports) | `buildOpenAiPayload` (config→wire emit) + the `--backends-json` chain mapper + CLI flag parse + threading through `runReviewOpenAi`/`streamOnceOpenAi`/`runReviewChain` |
| `plugin/skills/faff/bin/lib/config.js` | CommonJS | `reasoningEffortForTransport` (the 5→3 clamp to mirror) and `EFFORT_LANE_VOCAB` (the closed effort vocabulary to align against) |
| `plugin/skills/faff/bin/lib/engine.js` | CommonJS | `buildEngineRequest` — the exact `reasoning_off`-vs-effort emission pattern to replicate |
| `.faffrc.example.yaml` | YAML | Documents the adversarial block and the reserved per-consumer field-name list |

**Scope statement.** This sits on the adversarial-review transport seam (the `review` slot's OpenAI-compatible path), extending the per-backend record that FAFF-209 introduced and FAFF-696/FAFF-523/FAFF-870 have since grown.

## 2. OUT OF SCOPE

- **Native ollama reasoning-effort.** — Excluded because native ollama uses a separate payload builder (`buildChatPayload`, `review-call.mjs:77`, `options:{temperature,num_predict}` with unconditional `think:false`) that never reaches `buildOpenAiPayload`. `reasoning_effort` is inherently OpenAI-compat-only. *Extension point:* FAFF-872 (native ollama transport fold, currently Todo/parked) owns any ollama-side equivalent; it would add the knob to `buildChatPayload`, not here.
- **Per-consumer reasoning-effort overrides.** — Excluded because FAFF-870 (DONE) split only `refs`+`timeout` per consumer; `reasoning_effort` is a per-*backend* field, so a per-consumer chain that points at a backend already inherits that backend's `reasoning_effort` for free. *Extension point:* none needed — a future per-consumer *scalar* override would live in `assembleAdversarialBackends`'s per-consumer branch (`adversarial-backends.js:93-101`) alongside the timeout read.
- **Model-capability validation.** — Excluded by ticket mandate: the field is never validated against a hardcoded model list. *Extension point:* if capability gating is ever wanted, it would derive from transport family (the ADR-0100 `EFFORT_GRADED_FAMILIES` pattern), not from a model allowlist, and not in this ticket.
- **Widening faff's effort vocabulary (e.g. an OpenAI `minimal` tier).** — Excluded; ADR-0099 anticipates new tiers by *extending the transport mapper*, never by widening the config vocab below floor. *Extension point:* `reasoningEffortForTransport` in `config.js` and its mirror in `review-call.mjs`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| faff effort vocabulary | The closed five-tier set `low\|medium\|high\|xhigh\|max` (plus `inherit`, which is a lane-only sentinel and not a backend value), defined by `EFFORT_LANE_VOCAB` (`config.js:430`) |
| wire vocabulary | The three tiers the OpenAI `reasoning_effort` field accepts: `low\|medium\|high` |
| transport clamp | The pure 5→3 mapper `reasoningEffortForTransport` (`config.js:284`): `low/medium/high` pass through, `xhigh/max` clamp to `high` |
| the `refs:` path | The config path (FAFF-523) that resolves named backends through `normalizeBackend` **before** the emit allowlist — the reason a field added to only one list is dropped |
| the legacy inline paths | The native `backends:` array and single-backend flag forms, which reach `pickBackendKeys`/the mapper **without** passing through `normalizeBackend` |

**The Backend record — the added field.**

```
RECORD Backend:
  ...existing fields (provider, model, host, auth, api_key_env,
                      seat_token_env, egress, reasoning_off, timeout, telemetry)...
  reasoning_effort: Effort?        # OPTIONAL. Absent ⇒ field omitted from wire ⇒ byte-identical to today.
                                   # snake_case on the record (mapper also tolerates camelCase reasoningEffort,
                                   # matching the reasoning_off ?? reasoningOff pattern).

  CONSTRAINT reasoning_effort ∈ { low, medium, high, xhigh, max }   # closed config vocabulary; fail-loud on any other token
  PRECEDENCE reasoning_off === true  ⇒  reasoning_effort is NOT emitted (reasoning_off wins on the wire)
```

```
ENUM Effort: low | medium | high | xhigh | max
  # = EFFORT_LANE_VOCAB minus `inherit`. `inherit` is a lane sentinel, never a per-backend value.
```

**Config value set — decision.** The field accepts faff's **full** backend-applicable tier set `low|medium|high|xhigh|max`, not just the wire-native three. This aligns with faff's own `EFFORT_LANE_VOCAB` (minus `inherit`) so an operator uses one vocabulary everywhere; `xhigh` and `max` both clamp to wire `high`. **Chosen:** accept `low|medium|high|xhigh|max` (see Design Decision Rationale for the `max` question).

**The wire payload — the added emission.** `buildOpenAiPayload` gains a `reasoningEffort` parameter. When set and `reasoningOff` is false, it emits `reasoning_effort: <clamped>`:

```
buildOpenAiPayload({ model, system, user, maxTokens, reasoningOff=false, reasoningEffort=null, temperature=0.2 }) → body
  body = { model, stream:true, messages:[system,user], temperature, max_tokens:maxTokens }
  IF reasoningOff:              body.chat_template_kwargs = { thinking:false }   # unchanged, wins
  ELSE IF reasoningEffort:      body.reasoning_effort     = clampEffortToWire(reasoningEffort)
  RETURN body
```

**The clamp — mirrored, not imported.** `review-call.mjs` is a standalone zero-faff-import `.mjs` (its own comment at L1203-1208 mirrors `backends.js resolveTokenSource` locally rather than importing). Reusing `config.js`'s `reasoningEffortForTransport` therefore means **mirroring** its five-case switch locally, not importing it. **Chosen:** mirror the clamp locally (the file's established convention — see Design Decision Rationale).

**The two allowlists — both must list the field.** The `refs:` path passes a backend through `normalizeBackend` before the emit allowlist, so the field must be added to *both* the record-key set and the emit allowlist or it is dropped on the live path:

| List | File / symbol | Change |
|---|---|---|
| Normalized record key set | `backends.js` `BACKEND_RECORD_KEYS` (L28) | Add `"reasoning_effort"` |
| Explicit normalise copy | `backends.js` `normalizeBackend` (L149) | Add `b.reasoning_effort = present(raw.reasoning_effort) ? String(raw.reasoning_effort) : undefined;` |
| Fail-loud constraint check | `backends.js` `validateBackendConstraints` (L97) | Add a closed-enum check against the Effort set (sibling of the auth/egress/telemetry checks) |
| Emit allowlist | `adversarial-backends.js` `BACKEND_KEYS` (L35) | Add `"reasoning_effort"` (`pickBackendKeys` is `present()`-gated already) |
| Legacy-fallback inheritance | `adversarial-backends.js` `inheritOptionalFromPrimary` (L64-70) | Add `"reasoning_effort"` to the inherited-key list, for parity with `reasoning_off` |

**The `.mjs` threading surface.** `reasoningEffort` threads through the same call spine as `reasoningOff`:

| Site | File / symbol | Change |
|---|---|---|
| CLI flag parse | `review-call.mjs` `parseArgs` (~L838) | Add `--reasoning-effort` taking a value (sibling of `--reasoning-off`) |
| Usage string | `review-call.mjs` `main` usage (L1159) | Document `[--reasoning-effort E]` |
| `--backends-json` chain mapper | `review-call.mjs` (L1176-1187) | Add `reasoningEffort: b.reasoning_effort ?? b.reasoningEffort` |
| Legacy single-backend element | `review-call.mjs` (L1193-1196) | Add `reasoningEffort: a.reasoningEffort` |
| Chain `callReview` closure | `review-call.mjs` `runReviewChain` (~L1072) | Pass `reasoningEffort: b.reasoningEffort` |
| Orchestration | `review-call.mjs` `runReviewOpenAi` (L733) | Accept + forward `reasoningEffort` to both `streamOnceOpenAi` calls (L748/L750) |
| Stream call | `review-call.mjs` `streamOnceOpenAi` (L721) | Accept `reasoningEffort`, pass into `buildOpenAiPayload` |

**Config documentation.** `.faffrc.example.yaml` documents the adversarial block (the `reasoning_off` line at L337) and a reserved per-consumer field-name list (L329-330). Add a `reasoning_effort` example line beside `reasoning_off`, and add `reasoning_effort` to the reserved-name list, so it becomes a first-class adversarial field a consumer sub-block name may not collide with.

## 4. HOW — Behavior

**Architecture and approach.** The change is a field threaded along an existing, well-worn spine — the same spine `reasoning_off` already travels. There are two ingress shapes and they converge:

- The **`refs:` path** (the shape the live `.faffrc` uses): config → `normalizeBackend` (record-key copy + fail-loud validate) → `pickBackendKeys` (emit allowlist) → `--backends-json` → the `.mjs` mapper → `buildOpenAiPayload`. The config-vocabulary check happens at `normalizeBackend` time here.
- The **legacy inline paths** (native `backends:` array, single-backend flags): config/flags → `pickBackendKeys`/parseArgs → `buildOpenAiPayload`, **skipping** `normalizeBackend`. Here the `buildOpenAiPayload` clamp is the only wire-safety net — but because the clamp only ever *narrows* to a wire-legal token, a stray non-enum inline value can at worst pass through the clamp's `default` branch to `high`, never reaching the wire as an illegal token.

Both converge at `buildOpenAiPayload`, where emission happens exactly once.

**The emit decision (mirrors `engine.js:60-61`).**

```
PROCEDURE emit_reasoning_fields(body, reasoningOff, reasoningEffort):
  1. IF reasoningOff === true:
     a. body.chat_template_kwargs = { thinking: false }   # unchanged; reasoning_off wins
     b. RETURN   # reasoning_effort deliberately NOT emitted
  2. ELSE IF reasoningEffort is set:
     a. body.reasoning_effort = clampEffortToWire(reasoningEffort)
  3. ELSE:
     a. emit neither field   # byte-identical to today
```

**The clamp (mirror of `reasoningEffortForTransport`).**

```
PROCEDURE clampEffortToWire(effort):     # local mirror in review-call.mjs
  low    → low
  medium → medium
  high   → high
  xhigh  → high        # clamp to wire ceiling
  max    → high        # clamp to wire ceiling
  default→ high        # defensive; the config-vocabulary check upstream gates real input
```

**The config-vocabulary check (sibling of the telemetry check in `validateBackendConstraints`).**

```
PROCEDURE validate_reasoning_effort(name, b):
  1. IF b.reasoning_effort is absent: RETURN null           # optional field
  2. IF b.reasoning_effort ∉ { low, medium, high, xhigh, max }:
     RETURN `backends.${name}: invalid reasoning_effort "${b.reasoning_effort}" — legal set: low | medium | high | xhigh | max`
  3. RETURN null
```

This is deliberately *not* a `reasoning_off`-vs-`reasoning_effort` mutual-exclusion error — a backend may legally set both; the precedence rule resolves it at emit time. It is *not* a model-capability check.

**Edge cases and precedence.**

- **Both `reasoning_off:true` and `reasoning_effort` set.** `reasoning_off` wins; `reasoning_effort` is omitted from the wire. No error. Precedence, not conflict.
- **`reasoning_effort` set, `reasoning_off` false/unset.** `reasoning_effort` emitted, clamped.
- **`reasoning_effort` unset.** Neither field's byte changes — the payload is identical to today.
- **`xhigh`/`max` value.** Clamped to `high` on the wire; the config record retains the authored token (only the emit narrows).
- **Off-vocabulary value on the `refs:` path.** Fail-loud at `normalizeBackend` (config exit, names the value + legal set) — never reaches emit.
- **Off-vocabulary value on a legacy inline path.** Not validated at normalise (that path skips it); the clamp's `default → high` prevents an illegal wire token. This is the accepted asymmetry: the `refs:` path is fail-loud, the inline path is fail-safe.

**Failure modes.**

- **The failure:** the field is added to only one of the two lists (record-key set vs emit allowlist), so the live `refs:` path silently drops it — the classic single-list bug this thread is prone to. **How you'd know:** the "refs round-trip through `normalizeBackend`" test asserts a `reasoning_effort`-carrying backend survives resolution into the emitted chain; it fails, or the payload omits the field despite config setting it. **What it means:** proceed only once both lists carry the field and the round-trip test is green.
- **The failure:** the clamp is mirrored with a wrong case (e.g. `xhigh` passes through), so a real OpenAI endpoint 400s. **How you'd know:** the `xhigh→high` clamp assertion on `buildOpenAiPayload` fails. **What it means:** proceed only when both `xhigh` and `max` assert `high`.
- **The failure:** `reasoning_off` precedence is coded as `if`/`if` rather than `if`/`else if`, so a backend with both set emits both fields and the endpoint rejects the pair. **How you'd know:** the precedence test asserts `"reasoning_effort" in body === false` when `reasoningOff` is true. **What it means:** proceed only when the emit is a single `else if` chain.

**Anti-pattern:** importing `config.js`'s `reasoningEffortForTransport` into `review-call.mjs`. Why: it breaks the file's standalone zero-faff-import invariant (documented at L1203-1208); mirror the switch locally instead.

**Anti-pattern:** adding `reasoning_effort` to `EFFORT_LANE_VOCAB` or treating it as an `effort.<lane>` key. Why: it is a per-backend scalar (like `reasoning_off`), not a lane; ADR-0100's engine-lane capability is derived from transport family and adds no Backend-record field, but this ticket's `reasoning_effort` is a per-backend *value* knob, which is consistent with — not a contradiction of — that ADR.

**Anti-pattern:** validating `reasoning_effort` against a model list or refusing a config that sets both `reasoning_off` and `reasoning_effort`. Why: the ticket forbids model-capability validation, and the two-knob case is resolved by precedence, not rejected.

## 5. Scenarios

```
Given an adversarial backend configured via refs: with reasoning_effort: high and reasoning_off unset
When the OpenAI-compatible review payload is built for that backend
Then the payload includes reasoning_effort: "high" and no chat_template_kwargs
```

```
Given an adversarial backend with reasoning_effort: xhigh
When the payload is built
Then the wire payload carries reasoning_effort: "high" (xhigh clamped to the wire ceiling)
```

```
Given an adversarial backend with both reasoning_off: true and reasoning_effort: medium
When the payload is built
Then the payload carries chat_template_kwargs:{thinking:false} and does NOT carry a reasoning_effort key (reasoning_off wins)
```

```
Given an adversarial backend with no reasoning_effort set
When the payload is built
Then the payload is byte-identical to the payload built before this change (field omitted)
```

```
Given a backends: config with reasoning_effort: "ultra" on the refs: path
When the config is normalized
Then normalizeBackend fails loud, naming the value and the legal set low | medium | high | xhigh | max
```

- The emitted `--backends-json` chain for a `reasoning_effort`-carrying backend MUST have its emitted keys ⊆ `BACKEND_KEYS` (no leaked key), and `reasoning_effort` MUST be among them when set.
- A legacy fallback that omits `reasoning_effort` MUST inherit the primary's `reasoning_effort`, matching the existing `reasoning_off` inheritance behaviour.

## 6. Design Decision Rationale

**How does a config value outside the wire's three tiers (`xhigh`/`max`) reach the wire?** Options: (a) reject `xhigh`/`max` at config and accept only wire-native tiers — rejected, it fragments faff's uniform effort vocabulary and surprises operators who use `xhigh` elsewhere; (b) pass the token through raw — rejected, a real OpenAI endpoint 400s on `xhigh`; (c) clamp `xhigh`/`max` down to `high` at emit, mirroring `reasoningEffortForTransport`. **Chosen:** (c) — clamp at emit in `buildOpenAiPayload`, mirroring the shipped `config.js:284` clamp (FAFF-705, ADR-0099/0100). The wire never sees a non-enum token.

**When both `reasoning_off` and `reasoning_effort` are set, what wins?** Options: (a) config error — rejected, it's a needless fail-loud on a legal, resolvable state; (b) `reasoning_effort` wins — rejected, it contradicts the established engine pattern and would silence-then-un-silence confusingly; (c) `reasoning_off` wins, `reasoning_effort` omitted. **Chosen:** (c) — the exact `engine.js:60-61` `else if` precedent; the two knobs are mutually exclusive on the wire and `reasoning_off` takes precedence.

**Should the config field accept `max` in addition to `low|medium|high|xhigh`?** Options: (a) stop at `xhigh` — rejected, it carves an arbitrary hole in faff's tier set with no benefit (both `xhigh` and `max` clamp to `high` anyway); (b) accept the full backend-applicable set `low|medium|high|xhigh|max`. **Chosen:** (b) — the value vocabulary is exactly `EFFORT_LANE_VOCAB` minus the lane-only `inherit`, so operators use one consistent vocabulary and both top tiers clamp to wire `high`.

**Where does the config-vocabulary check live?** Options: (a) only in `buildOpenAiPayload` — rejected, that's an emit-time site with no config-error channel and it can't fail loud with a config path; (b) in `validateBackendConstraints`, the fail-loud closed-enum home for auth/egress/telemetry. **Chosen:** (b) for the `refs:` path (fail-loud, names value + legal set), with the `buildOpenAiPayload` clamp as the wire-safety net for the legacy inline paths that skip `normalizeBackend`. This is config-vocabulary validation, never model-capability validation.

**Import or mirror the clamp in `review-call.mjs`?** Options: (a) `import` `reasoningEffortForTransport` from `config.js` — rejected, it breaks the file's deliberate standalone zero-faff-import invariant (documented at L1203-1208, which already mirrors `resolveTokenSource` locally for the same reason); (b) mirror the five-case switch locally. **Chosen:** (b) — mirror, matching the file's established convention. Temporal anchor: at the time of writing the two clamps must be kept in sync by hand; a future consolidation would need to lift the shared logic somewhere both a CommonJS module and a standalone `.mjs` can reach without coupling.

**Does per-consumer (FAFF-870) need work?** Options: (a) add a per-consumer `reasoning_effort` override — rejected, out of scope and unnecessary; (b) rely on per-backend selection. **Chosen:** (b) — `reasoning_effort` is a per-backend field, so a per-consumer chain that references a backend inherits that backend's `reasoning_effort` for free. No per-consumer code changes.

**Does native ollama get the knob?** Options: (a) add it to `buildChatPayload` too — rejected, out of scope and owned by FAFF-872; (b) OpenAI-compat only. **Chosen:** (b) — native ollama uses a separate builder that never reaches `buildOpenAiPayload`; `reasoning_effort` is inherently OpenAI-compat-only until FAFF-872.

**Does `inheritOptionalFromPrimary` back-fill `reasoning_effort`?** Options: (a) leave it out — rejected, it breaks parity with `reasoning_off` and surprises operators who expect a fallback to inherit reasoning settings; (b) add it to the inherited-key list. **Chosen:** (b) — add `reasoning_effort` alongside `api_key_env`/`reasoning_off`/`timeout` for parity.

**Does `.faffrc.example.yaml`'s reserved per-consumer field-name list gain `reasoning_effort`?** Options: (a) leave the reserved list as-is — rejected, a first-class adversarial field absent from the reserved list would let a consumer sub-block name collide with it; (b) add it. **Chosen:** (b) — add `reasoning_effort` to the reserved-name list (L329-330) and document it beside the `reasoning_off` example.

## 7. Open Questions and Assumptions

**Open Questions.** None — every decision is closed with a founded `**Chosen:**` marker.

**Assumptions.** None external — every touched symbol was verified present in the codebase at authoring time (`buildOpenAiPayload`, `BACKEND_KEYS`, `BACKEND_RECORD_KEYS`, `normalizeBackend`, `validateBackendConstraints`, `inheritOptionalFromPrimary`, `reasoningEffortForTransport`, `EFFORT_LANE_VOCAB`, `engine.js:60-61`).

## 8. DONE — Definition of Done

### From WHY
- [ ] An adversarial config that does not set `reasoning_effort` produces a wire payload byte-identical to today's (the byte-identical-when-unset floor).
- [ ] The wire `reasoning_effort` value is always one of `low|medium|high` (never `xhigh`/`max`/other), for every accepted config value.

### From WHAT (types and record threading)
- [ ] `BACKEND_RECORD_KEYS` includes `reasoning_effort`; `faff backends resolve` prints it.
- [ ] `normalizeBackend` copies `reasoning_effort` explicitly (a `refs:`-path backend retains it through resolution).
- [ ] `BACKEND_KEYS` includes `reasoning_effort`; `pickBackendKeys` emits it when set and omits it when unset.
- [ ] The emitted `--backends-json` chain's keys are a subset of `BACKEND_KEYS` (no leaked key) with `reasoning_effort` present when set.
- [ ] `inheritOptionalFromPrimary` back-fills `reasoning_effort` from the primary onto a legacy fallback that omits it.
- [ ] The config field accepts `low|medium|high|xhigh|max` and no other token.

### From HOW (behaviour)
- [ ] `buildOpenAiPayload` emits `reasoning_effort: <clamped>` when `reasoningEffort` is set and `reasoningOff` is false.
- [ ] `xhigh` and `max` each emit wire `reasoning_effort: "high"`; `low`/`medium`/`high` pass through unchanged.
- [ ] When `reasoningOff` is true, no `reasoning_effort` key is emitted regardless of `reasoningEffort` (precedence).
- [ ] `reasoningEffort` threads through `--reasoning-effort` (parse + usage), the `--backends-json` mapper, the legacy single-backend element, `runReviewChain`'s `callReview`, `runReviewOpenAi`, and both `streamOnceOpenAi` calls.
- [ ] The clamp is mirrored locally in `review-call.mjs` (no `import` of `config.js`).

### From HOW (edge cases + validation)
- [ ] An off-vocabulary `reasoning_effort` on the `refs:` path fails loud at `normalizeBackend`, naming the value and the legal set.
- [ ] A config that sets both `reasoning_off:true` and `reasoning_effort` is accepted (no validation error) and resolves by precedence.

### From config docs
- [ ] `.faffrc.example.yaml` documents `reasoning_effort` beside `reasoning_off` and adds it to the reserved per-consumer field-name list.

### Tests
- [ ] `test/adversarial-call.test.mjs`: `reasoning_effort` emitted when set, omitted when unset (byte-identical), `xhigh→high` clamp, `reasoning_off` precedence.
- [ ] `test/adversarial-backends.test.mjs`: `BACKEND_KEYS`/`BACKEND_RECORD_KEYS` inclusion, `pickBackendKeys` present-gating, `inheritOptionalFromPrimary` inheritance, refs round-trip through `normalizeBackend`, config-vocabulary fail-loud.
- [ ] Parallel in-module `*Selftest()` assertions added for the same behaviours (the established convention).

### Integration smoke test
```
PROCEDURE smoke:
  1. Configure an adversarial backend via refs: with reasoning_effort: xhigh (host/model stubbed).
  2. Assemble the chain (assembleAdversarialBackends) → --backends-json.
  3. Run the .mjs mapper → buildOpenAiPayload for that backend.
  4. Assert the built body carries reasoning_effort: "high" and no chat_template_kwargs.
  5. Repeat with the field unset; assert the body byte-matches the pre-change payload.
```

confidence: high
spec-review: approve
build-tier: complex
