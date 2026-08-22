# FAFF-898 — reasoning_off: send `enable_thinking` for OpenAI-compatible reasoning servers

> Spec: faffter-dark-nlspec · 2026-08-22 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-898.

This nlspec addresses **FAFF-898** — a bug where `reasoning_off` is inert against OpenAI-compatible MLX/Qwen3-family servers because the payload builders send the wrong chat-template kwarg (`thinking` instead of `enable_thinking`). The audience is the build agent implementing the fix and the human reviewers gating it. The change is a narrow, two-site payload correction plus its tests, comments, and one documentation surface; it is buildable from this spec alone.

## 1. WHY — Problem and Principles

**Load-bearing model.** A reasoning model behind an OpenAI-compatible server (mlx_lm, vLLM, SGLang, HF TGI) decides whether to emit a hidden think-block by reading a chat-template kwarg passed through the request body's `chat_template_kwargs` map. Qwen3-family templates gate that phase on the key **`enable_thinking`**. faff currently sends the key `thinking`, which those templates never read — so an unknown kwarg is silently ignored and the model reasons anyway. "Turning reasoning off" therefore only works if the exact key the server's template inspects is the one we send.

**Problem statement.** Today faff's two OpenAI-compatible payload builders implement `reasoning_off:true` by sending `chat_template_kwargs:{thinking:false}`; against an mlx_lm/Qwen3-style server this kwarg is ignored and reasoning stays ON, so the review lens gets empty visible content (all output consumed by the dropped reasoning block → exit 11) or reasoning bleeding into a non-findings-shaped answer (exit 10), and the mandatory QA lens cannot reach a founded verdict. The fix sends the kwarg key those templates actually read (`enable_thinking`), so `reasoning_off` silences the think phase on the wire. It touches only the two OpenAI-compatible builders — the ollama path already sends its own honoured `think:false` and is unaffected.

**Design principles.**

- **Opt-in on the wire is preserved.** The kwarg is emitted **only** when `reasoning_off` is set. Vanilla hosted OpenAI (GPT-4o / o-series) must never see `chat_template_kwargs` — it rejects the unknown field. Any implementation that starts sending the field unconditionally is wrong regardless of which key it uses.
- **The two sites are one defect.** The identical one-line pattern exists in two sibling transports (the adversarial-review helper and the `faff engine call` one-shot). They gate the same behaviour against the same class of backend; they must ship the same kwarg shape or `reasoning_off` stays half-broken.
- **Ignored-kwarg tolerance is the safety net.** Servers that don't recognise a kwarg ignore it rather than erroring. This is what makes sending an additional/compatibility key free — the design leans on it deliberately.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM (.mjs) | `buildOpenAiPayload` (~L459-474) — primary bug site (L471) |
| `plugin/skills/faff/bin/lib/engine.js` | Node (.js) | `buildEngineRequest` (~L44-69) — parallel identical bug (L60) |
| `test/adversarial-call.test.mjs` | Node test runner | Asserts the current `{thinking:false}` shape (L166, L196, L271) |
| `plugin/skills/faff/bin/lib/engine.js` (inline self-test) | Node | Asserts the current shape (L369, L378) |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown | Documents the wire behaviour (L124, L158) |

**Scope statement.** This sits at the OpenAI-compatible transport payload-build seam shared by the `review` slot's adversarial helper and the `faff engine call` one-shot; it corrects one field key and nothing else in the request/response lifecycle.

## 2. OUT OF SCOPE

- **The ollama transport** — Why excluded: it sends ollama's native `think:false`, which those servers honour; it is already correct. Extension point: `buildEngineRequest`'s `family === "ollama"` branch (engine.js ~L50-54) and review-call.mjs's ollama path, if ollama ever changes its kwarg.
- **The anthropic transport** — Why excluded: it has no `reasoning_off` concept and no `chat_template_kwargs` (SKILL.md L152). Extension point: the native `/v1/messages` builder, if reasoning control is ever added there.
- **Config schema / a new backend field** — Why excluded: the `reasoning_off` boolean already threads end-to-end to `reasoningOff`/`effort`; no new knob is needed. Extension point: `adversarial-backends.js` / `backends.js` / `config.js` if a future ticket wants per-backend kwarg-key selection.
- **Runtime probing of which kwarg a server wants** — Why excluded: over-engineering; the compatibility shape (below) covers the known families statically. Extension point: a capability-detection step in the preflight (`preflightOpenAi` / `modelServedOpenAi`), if a server family ever reads a third key.
- **`reasoning_effort` handling and its precedence** — Why excluded: unchanged; `reasoning_off` still wins over `reasoning_effort` on both paths (the existing `if/else if`). Extension point: `clampEffortToWire` / `reasoningEffortForTransport`.
- **The "document that operators must start the server with thinking disabled" workaround** named in the ticket — Why excluded: it doesn't fix the wire and leaves the default broken. It may appear as a belt-and-braces doc note, but the payload fix is primary. Extension point: the `reasoning_off` prose in SKILL.md.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `reasoning_off` | Per-backend config boolean; when true, faff asks the server to suppress the model's hidden reasoning/think phase. Threads to `reasoningOff` (review-call.mjs) / `reasoningOff` param (engine.js). |
| `chat_template_kwargs` | A top-level request-body map passed through to the server's Jinja chat template; keys the template inspects control template behaviour. In the Python OpenAI SDK this rides `extra_body`; over the raw wire it is a top-level body field (exactly where the code already places it). |
| think phase / think-block | The model's hidden reasoning output, emitted before the visible answer; when not suppressed it can consume the whole response or bleed into the answer. |
| `enable_thinking` | The kwarg key Qwen3 / vLLM / SGLang / HF / MLX chat templates actually read to gate the think phase. `false` disables it. |
| `thinking` | The (wrong) key faff currently sends; not read by the above templates. Retained only for compatibility with any server that might read it. |

**The payload shape (the one thing that changes).** Both builders, when `reasoningOff` is set, currently write:

```
chat_template_kwargs = { thinking: false }
```

and must instead write the corrected shape:

```
chat_template_kwargs = { thinking: false, enable_thinking: false }
```

Every other field of both payloads (`model`, `stream`, `messages`, `temperature`, `max_tokens` / engine's `stream:false`, the `reasoning_effort` branch, headers, auth) is **byte-identical to today**. The field remains emitted only inside the `if (reasoningOff)` branch.

**Design decision — kwarg shape.** Two options: (a) replace with `{ enable_thinking: false }` only; (b) send both `{ thinking: false, enable_thinking: false }`. **Chosen:** (b) — send both keys. Rationale: `enable_thinking` covers every known reasoning family (Qwen3/vLLM/SGLang/HF/MLX); keeping `thinking` costs nothing because unrecognised kwargs are ignored, and it preserves behaviour for any server that happened to read the old key. There is no known server that reads `thinking` but not `enable_thinking`, so (a) is defensible, but (b) is strictly more compatible at zero wire cost and still fully opt-in (only sent when `reasoningOff`, so vanilla OpenAI never sees it).

**Design decision — scope.** Fix `review-call.mjs` only, or both it and `engine.js`. **Chosen:** fix **both**. Rationale: `engine.js`'s `buildEngineRequest` (L60) carries the identical one-line defect on the sibling OpenAI-compatible transport used by `engine:<name>` producer lanes (methodology/intake); it targets the same Qwen3/MLX backends with the same blast radius. The ticket text names only review-call.mjs, but fixing one site leaves `reasoning_off` inert on the engine path against the exact same servers. They are one logical defect ("the OpenAI-compatible `reasoning_off` kwarg"), corrected as one cohesive unit.

## 4. HOW — Behavior

**Approach.** This is a mechanical, localised correction at two payload-build seams plus their fixtures and prose — no control-flow, no new branches, no signature changes.

1. In `buildOpenAiPayload` (review-call.mjs ~L471), change the assigned object inside the existing `if (reasoningOff)` branch from `{ thinking: false }` to `{ thinking: false, enable_thinking: false }`. Leave the `else if (reasoningEffort)` branch and precedence untouched.
2. In `buildEngineRequest` (engine.js ~L60), make the identical change to the `if (reasoningOff)` branch under `family === "openai"`. Leave the ollama branch (`think:false`) and the `else if (effort)` branch untouched.
3. Update the explanatory comments so they no longer claim `thinking:false` is the OpenAI-compatible analogue: review-call.mjs L450-458 and engine.js L41-42/L60 should describe `enable_thinking:false` (with `thinking` retained for compatibility).
4. Update the one documentation surface that states the wire shape: SKILL.md L124 (the config-field comment) and L158 (the `reasoning_off` paragraph) — from `chat_template_kwargs:{thinking:false}` to the corrected shape/description. (This surface was not named in the explore findings; it is included because it otherwise leaves the docs contradicting the wire.)
5. Move every test assertion of the old shape to the new shape (see §8 DONE for the exact list).

**Behaviour summary.** After the change, a `reasoning_off:true` backend on an mlx_lm/Qwen3-style OpenAI-compatible server receives a kwarg its chat template reads, suppresses the think phase, and returns findings-shaped visible content — so the QA lens reaches a founded verdict instead of exit 10/11.

```
PROCEDURE build_openai_payload_reasoning_branch(reasoningOff, reasoningEffort):
  1. IF reasoningOff:
     a. body.chat_template_kwargs = { thinking: false, enable_thinking: false }
     b. (reasoning_effort is NOT emitted — reasoning_off wins)
  2. ELSE IF reasoningEffort:
     a. body.reasoning_effort = clamp_to_wire(reasoningEffort)
  3. ELSE: emit neither key (byte-identical to a plain request)
```

**Edge cases.**

- **`reasoning_off:false` (or unset).** Neither `chat_template_kwargs` key is emitted; hosted OpenAI stays happy. Unchanged.
- **`reasoning_off` AND `reasoning_effort` both present.** `reasoning_off` wins; `reasoning_effort` is not emitted. Unchanged — only the object literal differs.
- **Server that reads neither key.** Both kwargs ignored; identical outcome to today for that server (no regression).
- **Server that read the old `thinking` key.** Still receives `thinking:false`; no behaviour change for it.

**Failure modes.**

- **The failure:** the real key for some target server is neither `thinking` nor `enable_thinking` (a template variant we don't know about). **How you'd know:** against that specific server, `reasoning_off:true` still yields empty/exit-11 or malformed/exit-10 output despite the fix. **What it means:** narrow — add the additional key to the same map in both builders under the same opt-in guard; the design (a static compatibility map) already anticipates this extension, so it is a one-line follow-up, not an abandon.
- **The failure:** a server *errors* on an unrecognised `chat_template_kwargs` key rather than ignoring it (violating the ignored-kwarg assumption). **How you'd know:** that backend returns an HTTP 4xx / malformed-response for `reasoning_off:true` requests where it previously streamed. **What it means:** narrow — such a server would already have rejected today's `thinking` key, so the blast radius is unchanged; if it surfaces, per-backend key selection (an out-of-scope extension point) is the answer, not reverting.

**Anti-pattern:** emitting `chat_template_kwargs` outside the `if (reasoningOff)` guard. Why: vanilla hosted OpenAI rejects the unknown field, breaking every non-reasoning hosted call — the opt-in guard is the only thing that keeps the field safe.

**Anti-pattern:** fixing only `review-call.mjs` and leaving `engine.js`. Why: `reasoning_off` stays inert on the `engine:<name>` producer lanes against the identical servers, so the bug is only half-closed and re-surfaces on a different path.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a reasoning model behind an OpenAI-compatible mlx_lm/Qwen3-style server, configured with reasoning_off:true
When buildOpenAiPayload constructs the /v1/chat/completions request body
Then body.chat_template_kwargs equals { thinking: false, enable_thinking: false } and reasoning_effort is absent
```

```
Given the faff engine call one-shot targeting an openai-family host with reasoning_off:true
When buildEngineRequest constructs the request
Then the parsed body's chat_template_kwargs has enable_thinking === false (and thinking === false), and reasoning_effort is absent
```

- The ollama transport's `reasoning_off` path is unchanged: `buildEngineRequest` with `family:"ollama", reasoningOff:true` still sets `think:false` and never sets `chat_template_kwargs`.

## 6. Design Decision Rationale

**Which kwarg shape should `reasoning_off` send?**

- **(a) `{ enable_thinking: false }` only** — Pros: minimal, matches the reference SDK pattern exactly, no dead key. Cons: drops any server that read the old `thinking` key (none known, but not provably empty).
- **(b) `{ thinking: false, enable_thinking: false }` (both)** — Pros: covers Qwen3/vLLM/SGLang/HF/MLX via `enable_thinking` AND any legacy `thinking` reader; zero wire cost (unrecognised keys ignored); still fully opt-in. Cons: carries one key with no known live reader.

**Chosen:** (b) send both — maximal compatibility at zero cost, and it can never be *less* correct than (a) because `enable_thinking` is present in both. (decides: architecture)

**Should the fix cover one site or both?**

- **review-call.mjs only** — Pros: matches the literal ticket scope. Cons: leaves the identical defect live in `engine.js`, so `reasoning_off` stays broken on the `engine:<name>` lanes against the same servers.
- **Both review-call.mjs and engine.js** — Pros: closes the whole defect class in one change; the two are the same one-line pattern gating the same behaviour. Cons: touches a file the ticket didn't name (acceptable — it's the same root cause).

**Chosen:** both — one logical defect, corrected as one unit; a partial fix would re-file the same bug against the sibling transport. (decides: architecture)

At the time of writing, no OpenAI-compatible server is known to read `thinking` while ignoring `enable_thinking`; if that ever changes, option (b) already covers it and the decision need not be revisited.

## 7. Open Questions and Assumptions

**Open Questions.** None — both non-trivial decisions are closed with `**Chosen:**` markers above.

**Assumptions.**

- **Assumes:** the `reasoning_off` config boolean already threads to `reasoningOff` (review-call.mjs) and the `reasoningOff` param (engine.js) with no schema or plumbing change required. Validation: before starting, confirm `reasoningOff` is a received parameter of `buildOpenAiPayload` (review-call.mjs ~L459) and `buildEngineRequest` (engine.js ~L44), and that no edit to `adversarial-backends.js` / `backends.js` / `config.js` is implied by this change. (Verified during spec exploration; re-confirm before editing.)
- **Assumes:** unrecognised `chat_template_kwargs` keys are ignored (not rejected) by the target OpenAI-compatible servers — the property that makes sending both keys safe. Validation: this is the same tolerance today's `thinking` key already relies on; no new risk is introduced by adding a second key. (The methodology critique flags this as the one load-bearing assumption worth a cheap live-validation against the actual backends before landing.)

## 8. DONE — Definition of Done

### From WHY
- [ ] With `reasoning_off:true` against an OpenAI-compatible reasoning-model server, the request carries a kwarg the chat template reads (`enable_thinking:false`), so the think phase is suppressed and the response is findings-shaped (no exit 10/11 from reasoning bleed/empty content).
- [ ] The field is still emitted only when reasoning is being silenced; a `reasoning_off:false`/unset request is byte-identical to today.

### From WHAT (payload shape + decisions)
- [ ] `buildOpenAiPayload` (review-call.mjs ~L471) sets `chat_template_kwargs = { thinking: false, enable_thinking: false }` inside the existing `if (reasoningOff)` branch; the `else if (reasoningEffort)` branch and precedence are unchanged.
- [ ] `buildEngineRequest` (engine.js ~L60) sets `chat_template_kwargs = { thinking: false, enable_thinking: false }` inside the `family === "openai"` / `if (reasoningOff)` branch; the ollama and effort branches are unchanged.

### From HOW (comments + docs)
- [ ] The explanatory comments in review-call.mjs (~L450-458) and engine.js (~L41-42, L60) describe `enable_thinking:false` (with `thinking` retained for compatibility), not `thinking:false` alone.
- [ ] SKILL.md L124 (config-field comment) and L158 (`reasoning_off` paragraph) state the corrected kwarg shape/description.

### From HOW (edge cases)
- [ ] `reasoning_off` + `reasoning_effort` together: `reasoning_off` wins, `reasoning_effort` key absent (both builders).
- [ ] `family:"ollama", reasoningOff:true` still sets `think:false` and never sets `chat_template_kwargs`.

### From tests (exact assertion moves)
- [ ] `test/adversarial-call.test.mjs` L166: `off.chat_template_kwargs` deepEqual updated to `{ thinking: false, enable_thinking: false }`.
- [ ] `test/adversarial-call.test.mjs` L196 (reasoning_off-wins-over-effort): `body.chat_template_kwargs` deepEqual updated to `{ thinking: false, enable_thinking: false }`, and `reasoning_effort` still asserted absent.
- [ ] `test/adversarial-call.test.mjs` L271 (`runReview` streamFn body assertion): `JSON.parse(body).chat_template_kwargs` deepEqual updated to `{ thinking: false, enable_thinking: false }`.
- [ ] The two "not sent unless reasoningOff" / vanilla-OpenAI assertions (L170, L183) remain green unchanged (field still absent when reasoning is on).
- [ ] engine.js inline self-test L369: assert `JSON.parse(r3.body).chat_template_kwargs.enable_thinking === false` (and `.thinking === false`).
- [ ] engine.js inline self-test L378 (reasoning_off-wins-over-effort): assert `chat_template_kwargs.enable_thinking === false` (and `.thinking === false`) and `reasoning_effort` absent.
- [ ] The full test suite passes (`test/adversarial-call.test.mjs` plus the engine.js inline self-test invocation, and any suite runner the repo uses), with no other assertion touched.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. r  = buildOpenAiPayload({ model:"qwen3-27b", system:"S", user:"U", reasoningOff:true })
     ASSERT r.chat_template_kwargs == { thinking:false, enable_thinking:false }
     ASSERT "reasoning_effort" NOT IN r
  2. e  = buildEngineRequest({ family:"openai", host:"https://h/v1", model:"m", system:"", user:"", reasoningOff:true })
     ASSERT JSON.parse(e.body).chat_template_kwargs.enable_thinking === false
  3. v  = buildOpenAiPayload({ model:"gpt-4o", system:"S", user:"U" })   // reasoning on/unset
     ASSERT "chat_template_kwargs" NOT IN v                              // opt-in preserved
```

## Already shipped against this surface

Same-surface Done tickets, scanned for premise-supersede — **none supersede this bug** (the live code still sends `{thinking:false}`); listed as reader context:

- **FAFF-209** (Done) — OpenAI-compatible transport for faffter-dark adversarial review. Introduced the `/v1` path and `buildOpenAiPayload`; did not address the `thinking` vs `enable_thinking` kwarg key.
- **FAFF-873** (Done) — configurable `reasoning_effort` on the OpenAI-compatible payload. Added the sibling `else if (reasoningEffort)` branch this spec leaves untouched; orthogonal to the `reasoning_off` kwarg.
- **FAFF-137** (Done) — ollama `think`/options param. The ollama-side `think:false` lever — already correct and explicitly out of scope here.

Premise **holds** → proceed.

## Methodology critique

*(agile-delivery lens, `issue-critique` — advisory, non-blocking)*

- **Right-sized?** No issues. One atomic sub-day unit: the same one-key change at two payload-build sites plus co-located comments, one doc surface, and two test-assertion moves. The two sites are an always-ship-together pair (shipping one leaves a review-transport path inert), correctly kept in a single ticket.
- **Workstream fit?** Worth surfacing. FAFF-898 sits project-less in Backlog (correct default for a fresh bug), but names siblings **FAFF-897** and **FAFF-885** and calls all three "review-transport bugs" — a groupable cluster around one outcome (*reliable review-lens output from OpenAI-compatible / local backends*). Consider a rehoming pass to propose an outcome-led home for the three. Proposal only; if genuinely independent, leaving them loose is correct.
- **Deps surfaced?** Mostly clean. The spec explicitly declares FAFF-897/FAFF-885 "not blockers" — honest, no `blockedBy` warranted. One note: all three touch the same review-transport files (`review-call.mjs`, `engine.js`), so there is file-overlap coupling (whichever lands first, the others rebase) — a build-queue ordering concern, not a tracker edge.
- **Risk profile?** Low overall. The single risk carrier is the `**Assumes:**` "unrecognised kwargs ignored": sending both keys is safe only if every OpenAI-compatible server the transport talks to ignores (not rejects) the now-unknown key. Cheap to de-risk — confirm the ignore-behaviour against the actual backends in play before landing, rather than assuming it. No spike needed; a quick validation is proportionate.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
