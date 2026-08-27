# Spec: FAFF-872 - Consolidate every native adversarial-review transport onto the one OpenAI-compatible /v1 path (keep anthropic native)

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-872.
> build-tier: complex
> spec-review: approve

*Refreshed 2026-08-27 (autonomous, run run-20260827-065909-beepboop-list-0e6161) - a stale-refresh that folds two human resolutions from the comment thread and re-rates. Both close the one open call that had held the prior spec at medium:*
- *2026-08-23 (alec): keep the anthropic native family unchanged (option a); build the ollama fold now. This closes the section-7 anthropic-disposition Punt in the direction the spec's own principles already favoured ("do not degrade the strongest reviewer to force uniformity").*
- *2026-08-26 (alec): "keep openai and anthropic - the others should all be collapsible into openai spec." This confirms the two-shape target already encoded in `providerFamily` below (openai + anthropic survive; every other provider - including ollama - resolves to the OpenAI-compatible family). No new work: the only genuinely native families are ollama (folded here) and anthropic (kept).*

*The prior spec's core approach is unchanged - the anthropic Punt is closed to Chosen, not overturned; no interface, decision, or scope is redrawn.*

*Codebase drift annotated since the 2026-08-23 spec (all reinforcing, not invalidating):*
- *The live `.faffrc.yaml` no longer carries any `provider: ollama` backend - the three studio backends are already `provider: openai` on spark `/v1` hosts. The atomic config+code migration AC is therefore satisfied-by-inspection for this repo's live config; it survives as a regression-guard (the new CI config-lint test) plus the `.faffrc.example.yaml` prose update.*
- *The OpenAI-path reasoning-off lever has been hardened since (FAFF-898: `enable_thinking` is the kwarg Qwen3/vLLM/SGLang/HF/MLX chat templates actually read - now emitted alongside `thinking`; FAFF-914: per-backend `reasoning_extra` passthrough; FAFF-918: `thinking_token_budget`). FAFF-898 validated reasoning-off against real MLX/Qwen3 backends - the exact local family the operator is migrating to - so the original "does a live `/v1` honour the field?" risk is now substantially de-risked, not merely deferred.*

This is the buildable spec for Linear issue FAFF-872, addressed to the build agent that picks it up under faff-graft and to the human reviewers who gate it. It concerns `review-call.mjs`, the adversarial-review transport dispatcher in the `faffter-dark-adversarial-review` skill. The ticket was re-scoped by the reporter (alec, 2026-08-21/22) from the original "fold the native ollama transport, or justify keeping it" fold-vs-keep decision to one transport shape, and then settled (2026-08-23/26) on **two** surviving shapes: the OpenAI-compatible `/v1/chat/completions` path (the one every non-anthropic backend uses, including ollama/oMLX) and the anthropic native `/v1/messages` path (the capability-justified survivor). oMLX is the local-model backend the reporter is migrating to; ollama stays reachable through the OpenAI-compatible path during the switch.

## 1. WHY - Problem and Principles

**The load-bearing model.** `review-call.mjs` routes each configured review backend to one of **three** wire-format families by provider name (`providerFamily`, review-call.mjs:69): `ollama` goes to a **native** transport (`/api/tags` preflight, `/api/chat` NDJSON stream, `buildChatPayload` with a hardcoded `think:false`, `accumulateNdjson`, `runReviewOllama`); `anthropic` goes to a second **native** transport (`/v1/messages`, `buildAnthropicPayload`, `accumulateAnthropic`, no preflight); everything else (`openai`, `vllm`, `openrouter`, `nvidia`, `deepseek`, `gemini`, `openai-compatible`) goes to the **OpenAI-compatible** transport (`/v1/models` preflight, `/v1/chat/completions` SSE, `buildOpenAiPayload`, `runReviewOpenAi`). The consolidation asks: given that oMLX and ollama both also serve `/v1/chat/completions`, does the native ollama family still earn its own wire format? The answer is no - it folds onto the OpenAI-compatible path. The anthropic native family is the one exception, kept by explicit human decision because Claude's extended thinking cannot cross to a plain `/v1/chat/completions`.

**Problem statement.** Local models are moving from ollama to oMLX (both serve an OpenAI-compatible `/v1`), and the reporter does not want to carry multiple transport shapes. The native ollama family is now redundant machinery for a backend that already speaks `/v1`, and it carries a real behavioural gap: it hardcodes `think:false` and never consults `reasoning_off`, so that flag is a silent no-op there. This change deletes the native ollama family, routes ollama and oMLX through the OpenAI-compatible path, and preserves the three capabilities the native path guarded (model-served preflight, streaming robustness, and the reasoning-off lever). The anthropic native family is kept unchanged: its `/v1/messages` extended-thinking wire format is a capability the OpenAI-compatible path cannot carry, and the reporter has ruled it the justified survivor.

**Design principles.**

- **Two shapes survive: the OpenAI-compatible path, and anthropic native.** The reporter's direction (2026-08-26): "keep openai and anthropic - the others should all be collapsible into openai spec." Every non-anthropic backend - ollama and oMLX included - resolves to the OpenAI-compatible family. A native shape survives only where a capability genuinely cannot cross to `/v1`; anthropic is the sole such case.
- **Do not silently drop a guarded capability.** The native ollama family (FAFF-183) bought four things: the `/api/tags` model-served preflight, NDJSON streaming tolerant of partial trailing lines, a `num_predict`/`max_tokens` output cap, and a guaranteed reasoning-off lever. The fold must preserve the model-served guarantee, the streaming-robustness envelope, and a live reasoning-off lever, not just the happy path.
- **The reasoning-off lever stays live; its target-backend behaviour is now proven, not assumed.** On the OpenAI-compatible path `reasoning_off` emits `chat_template_kwargs:{thinking:false, enable_thinking:false}` (`buildOpenAiPayload`), where `enable_thinking` is the key Qwen3/vLLM/SGLang/HF/MLX chat templates actually read (FAFF-898). FAFF-898 validated this against real MLX/Qwen3 backends - the exact local family the operator is migrating to - so deleting the native `think:false` lever no longer rests on an un-run test. The build agent still confirms the emitted field is honoured on the specific target backend before relying on it; if a target genuinely ignores it over `/v1`, the reporter's thin-shim carve-out is the only sanctioned fallback.
- **The config migration lands atomically with the code.** Dropping the native ollama family and any remaining `provider: ollama` bare-host config are one indivisible change: the moment the native path is gone, a `provider: ollama` backend on a bare `:11434` host (no `/v1`) fails at preflight. In this repo the live `.faffrc.yaml` studio backends are already migrated to `provider: openai` on `/v1` hosts, so the live config already satisfies this; the principle survives as a regression guard (a CI config-lint test) and governs `.faffrc.example.yaml` and any downstream consumer config.
- **Do not degrade the strongest reviewer to force uniformity.** Anthropic's `/v1/messages` is not `/v1/chat/completions`; Anthropic's own OpenAI-compatibility surface is a comparison shim without extended thinking (ADR-0003 records that Claude reached over an OpenAI-compat bridge carries no thinking toggle, and `accumulateAnthropic` specifically reads the `thinking_delta` stream). Folding the anthropic family would regress the Claude reviewer's capability, so it is kept native by the reporter's decision (2026-08-23/26).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM (.mjs) | The transport dispatcher: the only code file with a behavioural change in this spec (native ollama family removal, `providerFamily` change, default-provider change). |
| `test/adversarial-call.test.mjs` (repo root) | Node test (mocked) | The unit surface; imports and tests `buildChatPayload` / `modelServed` / `accumulateNdjson` (all deleted here) and carries the native-ollama-tagged cases that migrate onto the OpenAI-path harness. Makes no real network calls. |
| `.faffrc.yaml` (repo root) | YAML | The live adversarial config. Already migrated: its local backends are `provider: openai` on spark `/v1` hosts - no `provider: ollama` backend remains. The refresh confirms this rather than migrating three studio backends. |
| `.faffrc.example.yaml` (repo root) | YAML | Documents the provider families and transport shapes; its ollama/`/api/chat` prose must be updated to the two-shape model (OpenAI-compatible + anthropic native). |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` / `backends.js` | Node CJS | The backend-config mapper + allowlist (`BACKEND_KEYS`). Read to confirm no schema change is needed (oMLX/ollama are reached as `provider: openai`, `host: .../v1`, already-allowed fields). |
| `eval/ollama-model.mjs` | Node | A separate evaluation subsystem that drives a native `/api/chat` tool-loop (ADR-0003). Out of scope; must not be touched. |

**Scope statement.** This sits at the transport-selection seam of the adversarial-review `review`/`spec_review` slot; it removes the native ollama transport, redirects local models onto the OpenAI-compatible `/v1` path (oMLX target), updates the example config, adds a CI config-lint regression guard, and leaves the anthropic native family unchanged (kept by human decision).

## 2. OUT OF SCOPE

- **Modifying the anthropic native family in this build.** - Why excluded: the reporter decided (2026-08-23/26) to keep it native and unchanged; Claude's extended-thinking capability cannot be expressed over a plain `/v1/chat/completions`, so it is the justified survivor, not a fold target. - Extension point: none intended; a future capability change to the Claude reviewer would edit `runReviewAnthropic` / `buildAnthropicPayload` directly, unrelated to this consolidation.
- **`eval/ollama-model.mjs` and the eval driver's native `/api/chat` tool-loop.** - Why excluded: a distinct evaluation subsystem (ADR-0003) that deliberately uses native `/api/chat` because its agentic kernel needs `think:false` over a transport `claude -p` cannot reach; unrelated to review transport. - Extension point: none needed here.
- **`review-spawn.mjs` / `fan-out.mjs` and the chain/fallback orchestration.** - Why excluded: provider-agnostic; unaffected by removing one transport family. - Extension point: n/a.
- **The graded-effort capability map (`EFFORT_GRADED_FAMILIES` in `bin/lib/config.js`).** - Why excluded: that map keys engine-lane effort capability off `ENGINE_PROVIDER_FAMILY`, a separate map from `review-call.mjs`'s `providerFamily`; re-declaring a local backend as `provider: openai` naturally makes it graded-effort capable there without any edit to that map. - Extension point: if a future change wants ollama-named backends treated as graded, that map is where it happens; not required here.
- **Adding an ollama-native `/v1` reasoning field to `buildOpenAiPayload`.** - Why excluded: only needed if the live-`/v1` confirm step (section 7) finds `chat_template_kwargs:{thinking:false, enable_thinking:false}` is ignored on the specific target; it is the thin-shim carve-out, contingent on that finding. Note the `reasoning_extra` escape hatch (FAFF-914) already lets an operator declare a backend's own reasoning shape without code change. - Extension point: `buildOpenAiPayload`, guarded by a provider check.

## 3. WHAT - Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Native ollama family | The ollama-only transport: `/api/tags` preflight + `/api/chat` NDJSON stream (`runReviewOllama`, `buildChatPayload`, `preflight`, `modelServed`, `accumulateNdjson`). Deleted by this change. |
| OpenAI-compatible family | The `/v1/models` preflight + `/v1/chat/completions` SSE transport (`runReviewOpenAi`, `buildOpenAiPayload`, `preflightOpenAi`, `modelServedOpenAi`, `accumulateSse`). The one shape every non-anthropic backend uses. |
| Anthropic native family | The `/v1/messages` transport (`runReviewAnthropic`, `buildAnthropicPayload`, `accumulateAnthropic`). Kept native and unchanged by human decision (2026-08-23/26); the capability-justified survivor. |
| The fold | Deleting the native ollama family and routing `provider: ollama` and oMLX through the OpenAI-compatible family. |
| oMLX | The local-model backend the reporter is migrating to; serves an OpenAI-compatible `/v1`, reached as `provider: openai`, `host: http://<host>:<port>/v1`. |
| The reasoning-off lever | The mechanism that disables a reasoning model's hidden think block. Native: `think:false`. OpenAI-compatible: `reasoning_off` → `chat_template_kwargs:{thinking:false, enable_thinking:false}` (FAFF-898). |
| The live-`/v1` confirm step | The build-time confirmation, against a live oMLX/ollama `/v1`, that the reasoning-off kwarg is honoured before the native `think:false` lever is deleted. Largely discharged by FAFF-898 for MLX/Qwen3; a per-target confirm remains good practice. |

**Provider-family routing - current vs target.**

```
# CURRENT (review-call.mjs:69) - three families; unset/unknown defaults to ollama.
FUNCTION providerFamily(name):
  n := lower(name OR "ollama")
  IF n == "ollama": RETURN "ollama"
  IF n IN {openai, vllm, openrouter, nvidia, deepseek, openai-compatible, gemini}: RETURN "openai"
  IF n == "anthropic": RETURN "anthropic"
  RETURN n                      # unknown -> unsupported-provider

# TARGET - the native ollama family is gone; "ollama" is an OpenAI-compatible alias;
# the unset/default provider is the OpenAI-compatible family, not ollama. anthropic stays native.
FUNCTION providerFamily(name):
  n := lower(name OR "openai")   # default changed: unset provider -> openai-compatible
  IF n IN {openai, vllm, openrouter, nvidia, deepseek, openai-compatible, gemini, ollama}: RETURN "openai"
  IF n == "anthropic": RETURN "anthropic"
  RETURN n                      # unknown -> unsupported-provider
```

The `ollama` token is retained as an **OpenAI-compatible alias** (not dropped) so an un-migrated `provider: ollama` config routes to `runReviewOpenAi` rather than becoming `unsupported-provider`. The operator must still re-declare that backend's `host` to carry the `/v1` suffix, because the OpenAI-compatible path GETs `/v1/models` and POSTs `/v1/chat/completions`; a bare `:11434` host fails **loud** at preflight (`unreachable` / `model-not-served`), never a silent pass. See section 4 for the host-suffix behaviour and the deliberate decision not to auto-rewrite the host.

**The dispatcher.**

```
# CURRENT (review-call.mjs:960)
FUNCTION runReview(opts):
  fam := providerFamily(opts.provider)
  IF fam == "openai":    RETURN runReviewOpenAi(opts)
  IF fam == "ollama":    RETURN runReviewOllama(opts)     # <- removed
  IF fam == "anthropic": RETURN runReviewAnthropic(opts)
  RETURN { status: "unsupported-provider", ... }

# TARGET
FUNCTION runReview(opts):
  fam := providerFamily(opts.provider)
  IF fam == "openai":    RETURN runReviewOpenAi(opts)
  IF fam == "anthropic": RETURN runReviewAnthropic(opts)   # <- unchanged, kept native
  RETURN { status: "unsupported-provider", ... }
```

**Deleted symbols** (native ollama family): `runReviewOllama`, `buildChatPayload`, `preflight` (the `/api/tags` variant), `modelServed`, `accumulateNdjson`, the `streamOnce` helper local to the ollama path, and the `providerFamily` `ollama`-native branch. Any exported deleted symbol must have its export removed and its test references migrated (section 8 / DONE).

**Capabilities that must remain live after the fold** (all already present on `runReviewOpenAi`, confirmed by explore):

| Guarded capability (native) | OpenAI-compatible equivalent | Status |
|---|---|---|
| `/api/tags` model-served preflight (`modelServed`, fail-loud on mismatch) | `/v1/models` preflight (`preflightOpenAi` + `modelServedOpenAi`, reads `{data:[{id}]}`, fail-loud `model-not-served`) | Present; parity confirmed (section 6, D-preflight). |
| NDJSON streaming tolerant of partial trailing lines (`accumulateNdjson`) | SSE accumulation (`accumulateSse`) wrapped in the same bounded transport retry (`streamWithTransportRetry`, FAFF-227) + 2×-budget truncation retry + FAFF-885 first-byte window | Present; equivalent-or-stronger. |
| `num_predict`/`max_tokens` output cap | `max_tokens` (`DEFAULT_NUM_PREDICT`, renamed by FAFF-917) | Present; same value, same default. |
| Reasoning-off lever `think:false` | `reasoning_off` → `chat_template_kwargs:{thinking:false, enable_thinking:false}` (`buildOpenAiPayload`, FAFF-898), plus `reasoning_extra` escape hatch (FAFF-914) | Present and proven live on MLX/Qwen3 (FAFF-898); per-target confirm still advised (section 7). |

**Design decisions.** See section 6 for full rationale. In document order:

- Delete the native ollama family and route ollama/oMLX through the OpenAI-compatible path - **Chosen** (section 6, D-fold).
- Retain `ollama` as an OpenAI-compatible alias and change the unset-provider default to `openai` - **Chosen** (section 6, D-default).
- Do not auto-rewrite a bare ollama host to add `/v1`; require explicit config migration, fail loud otherwise - **Chosen** (section 6, D-host).
- `/v1/models` is an equivalent model-served preflight to `/api/tags` - **Chosen** (section 6, D-preflight).
- The reasoning-off lever is preserved via `chat_template_kwargs`; its live-backend acceptance is confirmed (FAFF-898) before the native lever is deleted - **Chosen** (section 6, D-reasoning; section 7 Assumes).
- Keep the anthropic native family unchanged as the capability-justified survivor - **Chosen** (section 6, D-anthropic; human decision 2026-08-23/26).

## 4. HOW - Behavior

**Approach.** One code file changes behaviourally: `review-call.mjs`. Config docs and tests change alongside it. The steps:

1. **Remove the native ollama family** from `review-call.mjs`: delete `runReviewOllama`, `buildChatPayload`, the `/api/tags` `preflight`, `modelServed`, `accumulateNdjson`, and the ollama-local `streamOnce`; drop the `fam == "ollama"` branch in `runReview`; drop the ollama-native branch in `providerFamily` and move `ollama` into the OpenAI-compatible alias set.
2. **Change the unset-provider default** from `ollama` to `openai` in `providerFamily` (`name OR "openai"`) and anywhere the legacy single-backend path defaults a missing provider to ollama.
3. **Confirm the live `.faffrc.yaml`** carries no `provider: ollama` bare-host backend (it does not - the studio backends are already `provider: openai` on spark `/v1` hosts). No live-config migration is needed in this repo; the atomicity guarantee is satisfied by inspection and enforced going forward by the CI config-lint test (step 5).
4. **Update `.faffrc.example.yaml`** prose: the provider-family list, the "Transport families: ollama (`/api/chat`), OpenAI-compatible ..." comment, the per-field notes that mention `think:false`, and the host-format note, so they describe the two shapes (OpenAI-compatible + anthropic native).
5. **Migrate the tests and add the config-lint guard**: the native-ollama-tagged cases in `adversarial-call.test.mjs` are removed or rewritten against the OpenAI-path harness; add a case asserting `provider: ollama` now routes to `runReviewOpenAi`; assert the deleted exports are gone; add a CI config-lint test that fails if any `.faffrc.yaml` `provider: ollama` (or unset-provider) backend has a `host` lacking `/v1` (the atomic-migration regression guard - folded in from the prior spec-review's residual QA-minor).

**Behaviour summary.** After the change, a local model (oMLX or, during migration, ollama) is reached only through `runReviewOpenAi`: `/v1/models` preflight, `/v1/chat/completions` SSE, `reasoning_off` → `chat_template_kwargs:{thinking:false, enable_thinking:false}`, `reasoning_effort` (FAFF-873) and `reasoning_extra` (FAFF-914) available. The native `/api/chat` path no longer exists. An un-migrated `provider: ollama` config still routes to the OpenAI-compatible transport (the retained alias) but requires a `/v1` host to reach a served model. The anthropic native `/v1/messages` path is untouched.

```
PROCEDURE route_local_backend(backend):
  1. fam := providerFamily(backend.provider)          # "ollama" now resolves to "openai"
  2. IF fam == "openai":
     a. preflightOpenAi GET {host}/v1/models           # fail loud on unreachable / not-served
     b. stream POST {host}/v1/chat/completions          # SSE, transport retry, 2x truncation retry
     c. buildOpenAiPayload emits chat_template_kwargs:{thinking:false, enable_thinking:false} WHEN reasoning_off
  3. IF fam == "anthropic": route to runReviewAnthropic (UNCHANGED this build)
  4. ELSE unsupported-provider
```

**Edge cases and error handling.**

- **Bare (non-`/v1`) host on a migrated-in-name-only ollama backend.** `preflightOpenAi` GETs `{host}/models`; against a bare `:11434` ollama host that path is not the OpenAI surface, so it returns `unreachable` or `model-not-served`, a **loud** documented exit, never a silent pass. This is the intended signal that the host still needs its `/v1` suffix (D-host).
- **`reasoning_off` semantics on the folded path.** `buildOpenAiPayload` reads `if (reasoningOff)`, for which `undefined` and `false` are identical, so an absent flag emits no `chat_template_kwargs` (thinking left to the model's default) and an explicit `reasoning_off: true` emits `chat_template_kwargs:{thinking:false, enable_thinking:false}`. This differs from the deleted native default (which forced `think:false` whenever unset); see the failure mode below.
- **Preflight, streaming, truncation retry, transport retry** on the OpenAI path are unchanged by this ticket; only the ollama family's removal and the routing/default change are new.
- **`unsupported-provider`** is still returned for a genuinely unknown provider; only `ollama` moves out of that risk by becoming an alias. `anthropic` is unaffected.

**Failure modes.**

- **The failure:** the deleted native path forced `think:false` by default (unset ⇒ off), but the OpenAI-compatible path emits `chat_template_kwargs` only when `reasoning_off` is truthy (unset ⇒ the field is absent ⇒ the model's own default, which for a reasoning model is thinking-on). So a folded backend that previously ran with thinking-off-by-default may now stream its answer into a hidden think block and return empty `message.content`. - **How you'd know:** a migrated local reasoning model returns a zero-length or findings-empty review while preflight and transport report healthy. - **What it means:** narrow, do not abandon. Set `reasoning_off: true` (or a bounded `thinking_token_budget` via `reasoning_extra`, per FAFF-918, which reasons AND emits) on the migrated backend to restore workable behaviour, and record it in the migration note. This is a config detail the build must call out, not a code bug.
- **The failure:** a target oMLX/ollama `/v1` ignores `chat_template_kwargs:{thinking:false, enable_thinking:false}` entirely, so `reasoning_off: true` is a silent no-op on the folded path (the lever is lost). - **How you'd know:** the live-`/v1` confirm step (section 7) sends `reasoning_off: true` to a reasoning model and observes thinking is still on. FAFF-898 already confirmed `enable_thinking` is honoured on MLX/Qwen3, so this failure is now unlikely for the operator's target family. - **What it means:** do not delete the native lever blind; this is the reporter's thin-shim carve-out. If confirmed ignored on a specific target, declare the backend's own reasoning field via `reasoning_extra` (FAFF-914) or emit it guarded by a provider check (OUT OF SCOPE extension point) rather than dropping the capability.

**Anti-pattern:** deleting the native ollama family and the `think:false` lever without confirming the reasoning-off kwarg is honoured on the target. Why: if the target `/v1` ignores it, the fold silently strips reasoning-off from every folded local reviewer. FAFF-898 de-risks this for MLX/Qwen3 but does not universalise it.

**Anti-pattern:** modifying the anthropic native family in this build to "finish the job." Why: Claude's extended thinking is not expressible over a plain `/v1/chat/completions`, so folding it degrades the strongest reviewer; the reporter decided to keep it native (2026-08-23/26).

**Anti-pattern:** auto-rewriting a configured ollama host to append `/v1` in code. Why: it hides a config migration behind a brittle string transform (double-`/v1`, non-standard paths), and the loud preflight failure is a clearer signal; the migration is a config edit, not a runtime rewrite.

**Anti-pattern:** landing the `review-call.mjs` change and any future `.faffrc.yaml` host migration in separate commits or PRs. Why: between the two, a `provider: ollama` bare-host backend routes to `runReviewOpenAi` and fails preflight, breaking every adversarial review on that harness. For this repo the live config is already migrated, so the risk is moot here; the CI config-lint test keeps it that way for future edits and downstream consumers.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a backend configured provider: ollama, host: http://h:11434/v1
When runReview dispatches it
Then it routes to runReviewOpenAi (the OpenAI-compatible family), not a native /api/chat path
And review-call.mjs exports no runReviewOllama / buildChatPayload / accumulateNdjson symbol
```

```
Given a backend on the OpenAI-compatible family with reasoning_off: true
When runReviewOpenAi builds its /v1/chat/completions payload
Then the payload contains chat_template_kwargs:{thinking:false, enable_thinking:false}
```

```
Given a backend configured provider: anthropic
When runReview dispatches it
Then it routes to runReviewAnthropic (the native /v1/messages path), unchanged by this build
```

- The `.faffrc.yaml` live config MUST contain no `provider: ollama` backend on a bare (non-`/v1`) host after this change; every local backend resolves to the OpenAI-compatible `/v1` shape. (Already true in this repo; enforced going forward by the config-lint test.)
- The model-served preflight guarantee MUST be preserved: a mis-named model on a reachable host fails loud (`model-not-served`), never a silent pass.
- The anthropic native family MUST be unchanged by this build (no edit to `runReviewAnthropic` / `buildAnthropicPayload` / `accumulateAnthropic`).

## 6. Design Decision Rationale

**D-fold - Delete the native ollama family, or keep it?**
Options: (a) keep the native family; (b) delete it and route ollama/oMLX through the OpenAI-compatible path.
The reporter closed the original fold-vs-keep question in favour of one shape (2026-08-21/22) and confirmed the two-shape target (2026-08-26). ollama and oMLX both serve `/v1/chat/completions`; the OpenAI-compatible path already carries the model-served preflight (`/v1/models`), the streaming-robustness envelope (SSE + transport retry + truncation retry + first-byte window), the output cap (`max_tokens`), and the reasoning-off lever (`chat_template_kwargs`). The native family is redundant for a `/v1`-speaking backend.
**Chosen:** (b). Delete the native ollama family and route ollama/oMLX through `runReviewOpenAi`. Architecturally significant (removes a transport family) - an ADR-promotion candidate.

**D-default - What does an unset/unknown-but-ollama provider resolve to after the fold?**
Options: (a) drop `ollama` entirely (an un-migrated `provider: ollama` becomes `unsupported-provider`); (b) retain `ollama` as an OpenAI-compatible alias and change the unset default from `ollama` to `openai`.
Dropping it hard-breaks any un-migrated config with an opaque `unsupported-provider`; retaining it as an alias keeps such a config routing to the right transport, and the loud preflight failure on a bare host is a clearer migration signal. The unset default must move off `ollama` because there is no longer an ollama family to default to.
**Chosen:** (b). `ollama` joins the OpenAI-compatible alias set; the unset-provider default becomes `openai`. Architecturally significant (changes a public default) - an ADR-promotion candidate.

**D-host - Auto-append `/v1` to an ollama host, or require explicit migration?**
Options: (a) detect a bare ollama host and append `/v1` in code; (b) require the operator to re-declare the host with `/v1`, failing loud otherwise.
Auto-rewriting hides a migration behind a brittle string transform (double-`/v1`, non-standard paths) and couples the transport to ollama's specific port convention. The preflight already fails loud on a wrong base URL, which is a precise, debuggable signal.
**Chosen:** (b). No auto-rewrite; the migration is a config edit; a bare host fails loud at preflight.

**D-preflight - Does `/v1/models` give the same model-served guarantee as `/api/tags`?**
`preflightOpenAi` GETs `/v1/models` and `modelServedOpenAi` checks the requested model against the returned `data[].id` set; the deleted native `preflight`/`modelServed` did the equivalent against `/api/tags`' `models[].name`. Both fail loud (`model-not-served`, needs-human exit class) on a mismatch. oMLX and ollama both expose `/v1/models`.
**Chosen:** Parity holds; the fold does not regress the model-served preflight. Record this near `providerFamily` so a future reader does not re-litigate it.

**D-reasoning - How is the reasoning-off lever preserved, and when is the native lever safe to delete?**
The OpenAI-compatible path emits `chat_template_kwargs:{thinking:false, enable_thinking:false}` on `reasoning_off` (`buildOpenAiPayload`), so the lever is mechanically preserved by the fold. The open risk in the prior spec was whether a live oMLX/ollama `/v1` honours that field (the original OQ1). FAFF-898 has since fixed the kwarg (`enable_thinking` is the key MLX/Qwen3 templates read) and validated it against real MLX/Qwen3 backends, and FAFF-914's `reasoning_extra` gives a per-backend escape hatch. The residual is a per-target confirm, not an un-run test.
**Chosen:** Preserve the lever via `chat_template_kwargs`; gate deletion of the native lever on the reasoning-off kwarg being honoured on the specific target (largely discharged by FAFF-898). The fold's code and its unit tests do not depend on the confirm step (they assert the payload shape against the mock harness); the confirm governs the operator's confidence that the emitted field is honoured.

**D-anthropic - Keep the anthropic native family, thin-shim it, or fold it?**
Options: (a) keep it native and unchanged; (b) reduce it to a thin shim over the OpenAI-compatible path; (c) fold it onto Anthropic's OpenAI-compat surface and accept the extended-thinking loss.
Claude's first-party API is the Messages API (`/v1/messages`); Anthropic's OpenAI-compatibility surface is a comparison shim without extended thinking, and `accumulateAnthropic` reads the `thinking_delta` stream a plain `/v1/chat/completions` does not carry (ADR-0003). Folding or shimming would degrade the strongest reviewer, defeating the purpose of adversarial review. The reporter's own carve-out sanctions keeping a capability that genuinely cannot cross to `/v1`.
**Chosen:** (a) keep the anthropic native family native and unchanged. This is the reporter's explicit decision (alec, 2026-08-23: "keep the native anthropic family unchanged (option a)"; confirmed 2026-08-26: "keep openai and anthropic"). It requires no code change - the anthropic family is simply left as-is. Architecturally significant (settles the two-shape end state) - an ADR-promotion candidate.

## 7. Open Questions and Assumptions

**Open Questions.**

- None open. The prior spec's anthropic-disposition Punt is closed by human decision (D-anthropic; alec 2026-08-23/26): keep it native and unchanged.

**Assumptions.**

- **Assumes:** a live oMLX or ollama `/v1/chat/completions` honours `chat_template_kwargs:{thinking:false, enable_thinking:false}`. Validation for the build agent: FAFF-898 already confirmed `enable_thinking` is honoured on MLX/Qwen3 (the operator's target local family); before deleting the native `think:false` lever, confirm the same on the specific target backend if it differs. If the build environment cannot reach a live backend, keep the fold's payload-shape change (fully unit-testable against the mock harness) and rely on the FAFF-898 evidence plus the operator's own environment; do not remove the reasoning-off capability on an assumption it fails. If a specific target is confirmed to ignore the field, use `reasoning_extra` (FAFF-914) or the thin-shim extension point (section 2).
- **Assumes:** oMLX serves an OpenAI-compatible `/v1` (`/v1/models` + `/v1/chat/completions`) at the configured host. Validation: the operator's migration; `preflightOpenAi` fails loud if the host is wrong, so a mis-declared host cannot silently pass. No repo fixture of a live oMLX response exists (CI makes zero real calls), so this is confirmed in the operator's environment, not CI.
- **Assumes:** the backend-config allowlist needs no new field. Validation: `BACKEND_KEYS` (`backends.js`) already carries `provider`, `model`, `host`, `reasoning_off`, `reasoning_effort`, `reasoning_extra`, `timeout`; oMLX/ollama are reached as `provider: openai`, `host: .../v1` using only these, so confirm no `BACKEND_KEYS` / `adversarial-backends.js` mapper change is required.

## 8. DONE - Definition of Done

### From WHY
- [ ] `review-call.mjs` no longer contains a native ollama transport family; local models (oMLX, and ollama during migration) are reached only through the OpenAI-compatible `/v1` path.
- [ ] The three guarded capabilities are preserved on the folded path: model-served preflight, streaming robustness (transport + truncation retry), and a live reasoning-off lever.
- [ ] The anthropic native family is unchanged (kept by human decision).

### From WHAT (types and interfaces)
- [ ] `providerFamily("ollama")` returns `"openai"`; `providerFamily(undefined)` returns `"openai"` (the unset default is no longer `ollama`).
- [ ] `runReview` has no `fam == "ollama"` branch; it dispatches only `openai` and `anthropic`, else `unsupported-provider`.
- [ ] `review-call.mjs` exports no `runReviewOllama`, `buildChatPayload`, `accumulateNdjson`, native `/api/tags` `preflight`, or `modelServed` symbol; each deleted export's references are removed or migrated.
- [ ] The anthropic native family (`runReviewAnthropic`, `buildAnthropicPayload`, `accumulateAnthropic`) is byte-unchanged.

### From HOW (behaviour)
- [ ] A `provider: ollama`, `host: .../v1` backend routes to `runReviewOpenAi` and reaches a served model.
- [ ] A backend with `reasoning_off: true` on the folded path emits `chat_template_kwargs:{thinking:false, enable_thinking:false}`; absent `reasoning_off` emits no `chat_template_kwargs`.
- [ ] A bare (non-`/v1`) host fails loud at preflight (`unreachable` / `model-not-served`), never a silent pass.
- [ ] A `provider: anthropic` backend still routes to `runReviewAnthropic` (unchanged).

### From HOW (config)
- [ ] `.faffrc.yaml` contains no `provider: ollama` (or unset-provider) backend on a bare (non-`/v1`) host. (Already satisfied - the studio backends are `provider: openai` on spark `/v1` hosts; the build confirms it rather than migrating.)
- [ ] A CI config-lint test fails if any `.faffrc.yaml` `provider: ollama` / unset-provider backend has a `host` lacking `/v1` (the atomic-migration regression guard - folded from the prior spec-review QA-minor).
- [ ] `.faffrc.example.yaml` prose describes the two transport shapes (OpenAI-compatible + anthropic native): provider-family list, transport-families comment, field notes.

### From HOW (edge cases / findings)
- [ ] Preflight parity finding (D-preflight) is recorded as a comment near `providerFamily`: `/v1/models` is an equivalent model-served check to `/api/tags`.
- [ ] The reasoning-off default-behaviour change (native forced `think:false` when unset; OpenAI path emits the field only on truthy `reasoning_off`) is called out in the migration/example-config note.

### From Open Questions / Assumptions
- [ ] No open Punt remains; the anthropic native family is kept unchanged per the human decision.
- [ ] The reasoning-off lever is preserved by the fold, verified by the mock-harness unit test: `reasoning_off: true` on the folded path emits `chat_template_kwargs:{thinking:false, enable_thinking:false}` and absent emits none (see Tests). This is the pass/fail oracle for "the lever is preserved."

**Operator follow-up (deliberately NOT a DONE checklist item, because CI makes zero real calls and cannot observe it — it must never gate the build):** confirm the reasoning-off kwarg is honoured against the specific live oMLX/ollama `/v1` target (send `reasoning_off: true` to a reasoning model, observe thinking disabled). FAFF-898 already confirmed this for MLX/Qwen3. If a live target is confirmed to ignore the field, use `reasoning_extra` or the thin-shim extension point rather than dropping the lever. Out-of-band operator validation, not a checkable acceptance criterion.

### Tests
- [ ] `test/adversarial-call.test.mjs` (repo root): the import of `buildChatPayload` / `modelServed` / `accumulateNdjson` and their tests are removed (leave `assembleUserMessage`, which is provider-agnostic); a case asserts `provider: ollama` routes to `runReviewOpenAi`; a case asserts the deleted exports are absent (e.g. `assert.equal(typeof mod.runReviewOllama, "undefined")`). No real network calls.
- [ ] **Post-deletion unit-test surface (the replacement for the deleted pure-function tests):** the behaviour those deleted tests covered moves onto the OpenAI-path pure functions, which already exist and are exported: `buildOpenAiPayload` (payload shape, replacing `buildChatPayload`), `modelServedOpenAi` (served-set membership, replacing `modelServed`), and `accumulateSse` (stream folding + truncation flag, replacing `accumulateNdjson`). Add or confirm direct unit cases for these three against the mock harness so no behavioural coverage is lost when the native pure functions are removed.
- [ ] The reasoning-off payload cases (`reasoning_off: true` ⇒ `chat_template_kwargs:{thinking:false, enable_thinking:false}`; absent ⇒ no field) are covered against the mock harness via `buildOpenAiPayload`.
- [ ] The config-lint test asserts no `provider: ollama` / unset-provider bare-host backend in `.faffrc.yaml`.

**Integration smoke test (pseudocode).**

```
PROCEDURE smoke():
  1. runReview({ provider: "ollama", host: "http://h:11434/v1", model: "m", ...mockFns }).
  2. ASSERT the dispatched path is runReviewOpenAi (a /v1/models preflight was attempted).
  3. Build the payload with reasoning_off: true; ASSERT body.chat_template_kwargs == {thinking:false, enable_thinking:false}.
  4. ASSERT typeof review-call exports runReviewOllama === "undefined".
  5. runReview({ provider: "anthropic", ... }); ASSERT it dispatches runReviewAnthropic (unchanged).
```

confidence: high


## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4): no issue - correctly split.** The buildable core is one cohesive outcome (delete the native ollama family, route local models through the one `/v1` shape, update example config + tests, add the config-lint guard). The previously-separable concern - the anthropic native family's disposition - is now a settled human decision (keep native, no code change), so there is nothing left to split out; the ticket is a single 1-3 day unit.
- **Workstream fit (principles 1 + 5): no issue.** Single adversarial-review-transport outcome, coherent with its sibling cluster (FAFF-183 / FAFF-209 / FAFF-870 / FAFF-873 / FAFF-898 / FAFF-914 / FAFF-918); no cross-outcome bundling.
- **Surfaced deps (principle 6): no live blocker.** The referenced tickets (FAFF-183, FAFF-209, FAFF-873, FAFF-898, FAFF-914, FAFF-917, FAFF-918) are all Done - satisfied edges that de-risk the fold, not live blockers. No new blocker link is needed; the anthropic decision spawns no follow-up (it is keep-as-is).
- **Risk profile (principle 7): de-risked, no spike needed.** The one prior risk (does a live `/v1` honour the reasoning-off kwarg?) is now largely discharged by FAFF-898's validation on MLX/Qwen3 - the operator's target family - with `reasoning_extra` as a per-backend escape hatch and a thin-shim carve-out behind it. The payload-shape change stays fully unit-testable against the mock harness. No residual architectural call remains, consistent with `confidence: high`.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```