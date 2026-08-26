# Fix the adversarial-review empty-content bug via thinking_token_budget (FAFF-918)

> Spec: faffter-dark-nlspec · 2026-08-26 · interactive · claude-code/unknown · confidence: high · build-tier: standard. Full spec on Linear FAFF-918.
> Supersedes the two prior spec comments on this issue (both written against the earlier calibration/parity scope, now retired). Written against HEAD 515bc7b. This cut was authored inline by the prep orchestrator after the delegated producer run was interrupted; it still passes the same readiness contract (markers, confidence, tier).

The adversarial-review empty-content bug is that a reasoning reviewer spends its whole `max_tokens` on reasoning and emits `content: null` (`finish_reason: "length"`), so the review comes back empty. Operator testing of both configured local vLLM backends found one lever that fixes it on both: a top-level `thinking_token_budget` integer that caps reasoning tokens so content always gets emitted. faff cannot send that lever today because it is not in the reasoning-control allowlist. This ticket adds it, configures it per-backend, documents the cross-model behaviour, and has the operator verify the fix at the real output cap.

This is a small, evidence-backed change. The findings, the per-backend behaviour table, and the source references live on the Linear ticket and are not repeated in full here.

## 1. WHY

The empty-out is the root of a cluster of workaround tickets (FAFF-916 decomposer, FAFF-915 context-trim). It reproduces on both `spark-qwen-3-8` (default reasoning parser) and `spark-north-code-mini` (cohere_command4 parser), by two different mechanisms but with the same failure and the same fix. `thinking_token_budget` bounds reasoning length independent of payload size, so a reasoning-on reviewer stops emptying out without decomposing or trimming the input. If the operator verify confirms this at the production cap, the two workaround tickets are moot.

**Principle: the fix is per-backend and model-agnostic.** The levers differ by backend (`enable_thinking` works on qwen, ignored on north; `reasoning_effort` levels inert on both; `thinking_token_budget` works on both; `reasoning_tokens` accounting works on qwen, not north). So the fix must add a shared, opt-in vocabulary key and set concrete levers only per-backend where they are honoured. It must not bake any one model's shape into a shared default.

## 2. WHAT — the change

**The one code change is the allowlist.** `mergeReasoningExtra` (`plugin/skills/faffter-dark-adversarial-review/review-call.mjs`) already sets any allowlisted non-`chat_template_kwargs` key top-level on the openai body, which is exactly the wire shape vLLM reads for `thinking_token_budget`. And `reasoning_extra` already round-trips as an opaque backend config object (`BACKEND_KEYS` in `adversarial-backends.js:35` and `backends.js`, plus the fallback-inherit list). So the only thing blocking `reasoning_extra: { thinking_token_budget: N }` from reaching the wire is the inner-key allowlist.

| Item | Change |
|---|---|
| `REASONING_EXTRA_KEYS` (`review-call.mjs`, ~line 459) | Add `"thinking_token_budget"` to the array. One word. |
| selftest | Assert `buildOpenAiPayload({..., reasoningExtra:{thinking_token_budget: 2000}})` emits a top-level `thinking_token_budget: 2000` on the body, and that an out-of-allowlist key still throws. Mirror the existing FAFF-914 `reasoning_extra` selftests. |
| `.faffrc.yaml` backends | Per-backend `reasoning_extra` (below). |
| docs | Cross-model gotchas comment near the reasoning emit. |

No change to `mergeReasoningExtra`, `BACKEND_KEYS`, or the config round-trip: `thinking_token_budget` is a value inside the already-supported `reasoning_extra` object; only its membership in the inner allowlist is new.

**`reasoning_extra` is reasoning-control-only.** `thinking_token_budget` fits that category (it bounds reasoning), so it belongs in `REASONING_EXTRA_KEYS` alongside `reasoning`/`thinking`/`reasoning_effort`/`chat_template_kwargs`. It is never a faff-managed transport key.

## 3. HOW — per-backend config

Set the lever only where the operator has confirmed the backend honours it:

| Backend | Today | After |
|---|---|---|
| `spark-qwen-3-8` | `reasoning_off: true` | `reasoning_extra: { thinking_token_budget: N }` (bounded reasoning-on) |
| `spark-north-code-mini` | `reasoning_off: true` (a no-op; its parser ignores `enable_thinking`) | `reasoning_extra: { thinking_token_budget: N }`; drop `reasoning_off: true` |
| `openrouter-deepseek-v4-flash` | `reasoning_off: true` | unchanged (its honoured shape is `reasoning:{enabled}`; not tested here) |

**Chosen: run both spark backends reasoning-ON with a bounded budget rather than reasoning-off.** Reasoning-off (`reasoning_effort:"none"` on north, `enable_thinking:false` on qwen) avoids the empty-out but is the measured miss-real-bugs setting. A bounded `thinking_token_budget` keeps reasoning (so detection stays) while capping it so content always emits. That is strictly better than off for a reviewer, which is the whole point of using a reasoning model.

**Chosen: drop north's `reasoning_off: true` rather than keep it alongside the budget.** It is inert on cohere_command4 (verified), so leaving it in is misleading config that reads as "reasoning off" while reasoning runs. The bounded `reasoning_extra` replaces it.

**Chosen: starting value N = 2000, explicitly tunable.** At `max_tokens: 32000` this caps reasoning at ~2000 tokens and leaves ~30000 for findings, which is ample for a review, while being well clear of the empty-out (the operator saw content populate at a budget as low as 40). The precise value per backend and task is deliberately left to the FAFF-920 bench sweep; 2000 is a safe starting point, not a tuned optimum. Any value in the low-thousands satisfies the fix; the exact number is not load-bearing.

**Assumes: the deepseek/OpenRouter backend is out of scope here.** It uses a different shape (`reasoning:{enabled}`) and was not tested; changing it needs its own measurement. Left as-is.

## 4. Documentation

Add a comment block where the reasoning emit is defined (near `buildOpenAiPayload` / `mergeReasoningExtra` in `review-call.mjs`), and a note in the review-bench README, carrying the cross-model behaviour so it is not rediscovered:

- `chat_template_kwargs.enable_thinking` is model-specific (works on qwen, ignored on cohere_command4). Do not treat it as a universal off-switch.
- `reasoning_effort` levels other than `"none"` are not graded on these vLLM builds (on/off only). `"none"` turns reasoning off on both.
- `thinking_token_budget` is the universal bounded-reasoning lever, and the empty-out fix.
- `reasoning_tokens` in the usage block reads 0 on cohere_command4 even while reasoning runs; detect the empty-out via `finish_reason == "length" && content == null`, not `reasoning_tokens`.

## 5. Open questions

**Punt: should faff's default `reasoning_off` emit be made portable?** Today `reasoning_off: true` emits the model-specific nested `chat_template_kwargs.enable_thinking:false`, which is inert on north. A more portable default would prefer top-level `reasoning_effort: "none"` (works on both tested builds), alone or alongside `enable_thinking`. That is a broader production-behaviour change touching every backend and could regress one that relies on `enable_thinking`, so it is a human product/architecture call and likely its own ticket. This ticket handles north via per-backend `reasoning_extra` and does not change the default. Left for the operator to decide.

## 6. DONE — definition of done

### Mechanical (CI-dischargeable)
- [ ] `thinking_token_budget` is in `REASONING_EXTRA_KEYS` (`review-call.mjs`).
- [ ] A selftest asserts `reasoning_extra:{thinking_token_budget: N}` emits a top-level `thinking_token_budget: N` on the openai body, and that an out-of-allowlist key still throws; it passes in the existing selftest run with no network call.
- [ ] `.faffrc.yaml`: `spark-qwen-3-8` and `spark-north-code-mini` carry `reasoning_extra: { thinking_token_budget: <value> }`; north's `reasoning_off: true` is removed; `faff config check` (or the equivalent config validation) passes.
- [ ] A comment near the reasoning emit and a review-bench README note carry the four cross-model gotchas above.

### Operator-run (needs the live servers; not CI-dischargeable)
- [ ] On BOTH `spark-qwen-3-8` and `spark-north-code-mini`, a real review at `max_tokens: 32000` with the bounded `reasoning_extra` returns `content != null` and `finish_reason != "length"` (detected via `finish_reason` + `content`, NOT `reasoning_tokens`), confirming the empty-out is fixed.
- [ ] The verify result is recorded (a short note on FAFF-918, or a `records/spikes/` entry), and FAFF-916 / FAFF-915 are closed as moot if the fix holds.

**Integration smoke test.**
```
1. Selftest: buildOpenAiPayload with reasoningExtra {thinking_token_budget: 2000}
   -> body.thinking_token_budget === 2000 (top level); out-of-allowlist key throws.  # no network
2. Operator: one real review call per spark backend at max_tokens 32000 with the bounded config
   -> content populated, finish_reason != "length".
```

confidence: high
