# FAFF-941 — make the spec-review judge dispatch reliable unattended

> Spec: faffter-noon-spec (lite nlspec) · 2026-08-30 · autonomous · claude-code/opus · confidence: high. Full spec on Linear FAFF-941.

## Why

The FAFF-922 spec-review judge is the last thing tried before a would-be-park escalates to a human. It only earns its keep if it returns a ruling first time, unattended. Two defects in the shipped dispatch (post-FAFF-940) stop that, and both surfaced live while the judge adjudicated FAFF-930's own spec.

- **Defect 1 — the reasoning cap never reaches the GLM judge backend, so it returns empty.** faff-prep's judge dispatch hardcodes `reasoning_extra: { thinking_token_budget: N }`. `thinking_token_budget` is the qwen3 chat-template thinking-budget lever; the configured judge backends `z-ai/glm-5.2:free` and `z-ai/glm-5.3-flash` (OpenRouter, OpenAI-compatible) do not read it. So GLM reasons freely, the reasoning eats the whole `max_tokens`, and the call returns empty content (exit 11). Confirmed live: the judge only produced a ruling once reasoning was capped the OpenRouter-native way, `reasoning: { max_tokens: 2000 }`.
- **Defect 2 — the judge dispatch parks on the first transient transport blip.** The dispatch has no bounded in-turn retry, unlike the reviewer path (limit 2). A transient transport fault that exhausts the judge chain surfaces as an outage exit, and the dispatch parks straight away. One blip in a would-be-park pass escalates the whole pass to needs-human and defeats the terminal one-pass purpose.

## What

Two coherent parts plus tests, all serving "the judge dispatches, gets a ruling, and rides out a transient blip before it parks":

- **A — the reasoning cap, config-driven per backend.** Stop hardcoding a reasoning knob in the judge dispatch. Each backend already declares its own reasoning control in `.faffrc` `reasoning_extra`; give the two GLM judge backends the OpenRouter-native cap `reasoning: { max_tokens: 2000 }` there, and leave the qwen refuter backend's `thinking_token_budget` untouched. The transport stays generic: no branch on model or provider. The per-endpoint difference lives as data in `.faffrc`, one line per backend.
- **B — a bounded in-turn judge retry.** Give the judge dispatch a bounded in-turn retry (limit 2, from a config key defaulting to 2) on a transient transport outage exit, before it parks. A config-fault or a conformant ruling is unchanged; only the swing-capable transport-outage class retries.
- **C — tests** that an OpenRouter judge backend's request body carries `reasoning.max_tokens` sourced from its config `reasoning_extra` (and that qwen's `thinking_token_budget` still passes through), and that a single transient transport failure is retried and does not park when the retry succeeds.

Surface touched (all on origin/main, verified in the FAFF-941 worktree at 86bcba4):

- `.faffrc.yaml` — `openrouter-glm-5-2` and `openrouter-glm-5-3-flash` gain `reasoning_extra: { reasoning: { max_tokens: 2000 } }`; their stale comments about the dispatch setting the knob are corrected.
- `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` — a new pure exported classifier `judgeDispatchDisposition` (plus the `JUDGE_RETRY_OUTAGE_EXITS` set) that maps a review-call terminal exit to ruling / retry / park over the whole EXIT taxonomy. The reasoning payload shaping is untouched.
- `plugin/skills/faff-prep/SKILL.md` — the "Spec-review judge" dispatch step: drop the hardcoded `thinking_token_budget`, add the bounded in-turn retry keyed off the classifier.
- `plugin/skills/faff/bin/lib/config.js` — a new `prep.spec_review_judge_retry_limit` default (2) and its known-key registration.
- `test/adversarial-call.test.mjs` — the reasoning-cap request-body cases, the classifier enumeration case, and the transient-transport-retry case.
- `test/adversarial-backends.test.mjs` — a case that the `spec_judge` consumer chain carries the GLM backends' reasoning cap through from config.

Not touched: `review-call.mjs`'s reasoning payload shaping. `reasoning` is already in `REASONING_EXTRA_KEYS`, and `mergeReasoningExtra` already merges it as a top-level request-body param (proven by the existing FAFF-914 test that merges `reasoning: { enabled: false }`), so the config value reaches the wire with no code branch on model or provider. The refuter path and the transport-retry primitive (`TRANSPORT_RETRY`, `streamWithTransportRetry`) are byte-identical.

## How

### Part A — the GLM judge reasoning cap, in config

**Chosen:** add `reasoning_extra: { reasoning: { max_tokens: 2000 } }` to both `openrouter-glm-5-2` and `openrouter-glm-5-3-flash` in `.faffrc.yaml`. `faff adversarial-backends --consumer spec_judge` already carries a backend's `reasoning_extra` into the emitted chain (its `BACKEND_KEYS` lists `reasoning_extra`), and `review-call.mjs`'s `--backends-json` mapper reads `b.reasoning_extra` into `buildOpenAiPayload`, which merges it verbatim at the top level. So the cap reaches the GLM request body as `reasoning: { max_tokens: 2000 }` with no transport change. This is exactly the per-backend escape hatch `reasoning_extra` was built for (FAFF-914): the operator declares the wire shape their endpoint honours, and faff merges it — qwen/vLLM read `thinking_token_budget`, OpenRouter reads `reasoning: { max_tokens }`, an OpenAI o-series endpoint reads `reasoning_effort`, and none of that divergence lives in a code branch.

**Chosen:** update the two GLM backends' comments, which currently say "the judge dispatch sets thinking_token_budget itself". Replace with a note that the reasoning cap is the OpenRouter-native `reasoning: { max_tokens }` carried here, and that reasoning stays on (no `reasoning_off`). The qwen refuter backend's `thinking_token_budget: 2000` is left exactly as-is.

### Part B — wire faff-prep's judge dispatch: drop the hardcoded knob, add the retry

**Chosen:** in the "Spec-review judge" dispatch step, replace "set `reasoning_extra: { thinking_token_budget: N }`, never `reasoning_off`" with "keep reasoning on by not setting `reasoning_off`; the reasoning cap comes from the resolved backend's own `reasoning_extra` (OpenRouter honours `reasoning: { max_tokens }`, qwen/vLLM `thinking_token_budget`)". The dispatch no longer names a knob; the config supplies it.

**Chosen:** the retry-vs-park decision is a tested classifier, not prose. Add a pure exported `judgeDispatchDisposition(exit)` to `review-call.mjs` that maps a terminal exit to `ruling` / `retry` / `park` over the whole EXIT taxonomy. The `retry` class is exactly `mandatoryRemap`'s no-opinion outage pair — `EXIT.UNREACHABLE` (5, all configured judge hosts down or a 429 chain that exhausted the internal transport-retry) and `EXIT.DEADLINE` (8, the judge budget hit before a ruling). Grounding the pair in `mandatoryRemap` (which already fails these two closed together at L4) is what makes the class a settled transport invariant rather than an ad-hoc per-exit choice. Every needs-human/config-fault class (`CHAIN_NEEDS_HUMAN` = 2/4/6/7/11), `OTHER` (1), and a garbled ruling (`MALFORMED` 10) park directly. `MANDATORY_OUTAGE` (9) never arises (the judge is never a `--lights-out` mandatory review) and is classified park for completeness.

**Chosen:** the faff-prep dispatch reads that classifier. On a `retry` disposition, re-dispatch the judge up to `faff config get prep.spec_review_judge_retry_limit` (default 2) times before parking; on `park`, park directly, unchanged; on `ruling`, validate as today. The retry stays inside the single dispatch turn, backstopped by the same `faff turncheck` Stop hook that guards the surrounding review loop.

### Part C — config default

**Chosen:** register `prep.spec_review_judge_retry_limit` with a default of `"2"` in `config.js`, alongside the existing `prep.spec_review_outage_retry_limit`, and add it to the known-key allowlist so `faff config get` resolves it and `faff config check` does not warn on it. It mirrors the reviewer's in-turn ceiling; a distinct key keeps the two dispatches independently tunable.

### Part D — tests

**Chosen:** add to `test/adversarial-call.test.mjs`:

1. An OpenRouter judge backend, shaped as the chain mapper produces it from `.faffrc` (`reasoning_extra: { reasoning: { max_tokens: 2000 } }`), builds a request body whose `reasoning.max_tokens === 2000` with no top-level `thinking_token_budget` — sourced from config, with no branch on model or provider.
2. A qwen backend with `reasoning_extra: { thinking_token_budget: 2000 }` still builds a body carrying `thinking_token_budget: 2000` (the refuter path is unbroken).
3. A single transient transport failure (an `HTTP 503` on the first stream attempt, a valid SSE result on the second) is retried through `runReview` and returns `status: "ok"` with content, never a transport-failed park.

### Non-goals

**Punt:** the judge's ruling quality and calibration (FAFF-930 owns the judge's reasoning). This ticket only makes the dispatch return a ruling and ride out a transient blip.

**Assumes:** `faff adversarial-backends` carries `reasoning_extra` through and `review-call.mjs` merges `reasoning` at the top level. Both confirmed in the worktree (`BACKEND_KEYS` and the existing FAFF-914 passthrough test).

## Done (acceptance criteria)

1. `.faffrc.yaml` carries `reasoning_extra: { reasoning: { max_tokens: 2000 } }` on both `openrouter-glm-5-2` and `openrouter-glm-5-3-flash`, and `spark-qwen-3-8`'s `reasoning_extra.thinking_token_budget` is unchanged. Verified: `faff adversarial-backends --consumer spec_judge --json` emits both GLM backends carrying `reasoning.max_tokens: 2000`; `faff config check` is clean; and the config→chain wiring is pinned by the new `spec_judge`-consumer case in `test/adversarial-backends.test.mjs`.

2. faff-prep's "Spec-review judge" dispatch step no longer sets any hardcoded reasoning knob (no `thinking_token_budget` literal); it keeps reasoning on by not setting `reasoning_off` and takes the cap from the resolved backend's `reasoning_extra`. Verified: the SKILL.md step reads as specified and `faff validate-adapters` stays green.

3. The judge dispatch's retry-vs-park decision is the tested `judgeDispatchDisposition` classifier: it retries exactly the transient-outage pair (`EXIT.UNREACHABLE` 5 / `EXIT.DEADLINE` 8) and parks every config-fault/needs-human class (2/4/6/7/11), `OTHER` (1), `MALFORMED` (10) and `MANDATORY_OUTAGE` (9), over the whole EXIT taxonomy. The faff-prep step re-dispatches up to `prep.spec_review_judge_retry_limit` (default 2) on a `retry` disposition before parking. Verified: the classifier enumeration case in `test/adversarial-call.test.mjs`; the SKILL.md step reads as specified; `faff config get prep.spec_review_judge_retry_limit` resolves `2`.

4. An OpenRouter judge backend's request body carries `reasoning.max_tokens` sourced from its config `reasoning_extra`, with no top-level `thinking_token_budget`, and a qwen backend's `thinking_token_budget` still passes through — both with no code branch on model or provider. Verified: the two new `buildOpenAiPayload` request-body cases in `test/adversarial-call.test.mjs`.

5. A single transient transport failure is retried and does not park when the retry succeeds. Verified: the new `runReview` transient-transport-retry case (fails `HTTP 503` once, then streams a valid SSE result, returns `status: "ok"`).

6. The full engineering gate ladder is green: `faff validate-adapters`, `faff lint-refs`, `faff lint-cli-doc`, and the unit suite (`node --import ./test/hermetic-env.mjs --test`).

confidence: high
