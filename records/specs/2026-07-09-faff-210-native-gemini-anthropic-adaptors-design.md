# Native gemini / anthropic adaptors for the adversarial-review backend

> Spec: faffter-dark-nlspec · 2026-07-09 · interactive · confidence: high · spec-review: approve. Full spec on Linear FAFF-210.

This is the buildable spec for **FAFF-210**, a follow-up to FAFF-209. Its audience is the build agent implementing the two new provider transports in `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`, plus the human reviewer gating the spec. FAFF-209 wired two transport families (ollama, OpenAI-compatible) and made `gemini`/`anthropic` fail loud (exit 2) as a safe stopgap; this ticket turns that stopgap into working support.

## 1. WHY — Problem and Principles

**The load-bearing idea:** `review-call.mjs` already decomposes every backend into the same five seams — a *payload builder*, an optional *model-list preflight*, a *streamed-response accumulator*, *endpoint + headers*, and an *orchestration function* returning a fixed status vocabulary — and the exit-code mapping (`mapResultExit`), auth predicate (`isAuthError`), transient-retry predicate (`isTransientTransport`), and bounded transport retry (`streamWithTransportRetry`) are all *status-string / message driven and family-agnostic*. Adding a provider means filling those seams and returning the existing status vocabulary — **nothing downstream changes**.

**Problem statement.** `providerFamily()` passes `gemini`/`anthropic` through as their own literal strings; `runReview()` has no branch for them, so they return `{status:"unsupported-provider"}` → `EXIT.USAGE (2)`. Teams whose primary model is not Claude cannot use a Claude or Gemini model as the *independent* second reviewer — which is the entire point of adversarial review.

**Design principles.**

**Preserve the status vocabulary; never touch the exit machinery.** Each new orchestration function returns only the existing statuses (`ok` / `model-not-served` / `auth-failed` / `unreachable` / `transport-failed`; `unsupported-provider` stays reserved for genuinely unknown providers). Then `mapResultExit`, `unreachableExit`, `chainTerminalExit`, and `mandatoryRemap` need zero edits.

**No silent weakening of the gate.** A misconfiguration (bad key, wrong model name) must surface as `needs-human`, never as a `pass+skip`. This is why the Gemini bad-key wrinkle (below) is handled rather than left to misclassify as an outage.

**Independence is the product.** The `anthropic` provider means *Claude reviewing someone else's code*. Never configure `provider: anthropic` when Claude authored or ran the primary review — a same-family reviewer defeats the correlated-blind-spot goal.

## 2. OUT OF SCOPE
Gemini native `:generateContent` transport (the OpenAI-compat base URL covers the review call); a per-provider omit-sampling knob; anthropic extended-thinking config; preflight via Anthropic's Models API; any change to `mapResultExit` / exit codes / fallback-chain / mandatory-remap.

## 3. WHAT — Types and Interfaces

**Gemini — no new types.** `gemini` joins the `openai` family via a one-line `providerFamily` whitelist. Config reuses every openai-family field; `host: https://generativelanguage.googleapis.com/v1beta/openai`, Bearer `GEMINI_API_KEY`.

**Anthropic — a native adaptor.**
- `ANTHROPIC_VERSION = "2023-06-01"` (required header value; temporal anchor — verify vs Anthropic API docs at build time).
- `buildAnthropicPayload({model,system,user,maxTokens})` → `{model, max_tokens (REQUIRED), system (top-level), messages:[{role:"user",content:user}], stream:true}`, **no** `temperature`; throws if `model` missing.
- Headers: `x-api-key`, `anthropic-version`, `content-type: application/json`.
- `accumulateAnthropic(text)` → `{content, truncated, done}`: fold `content_block_delta`/`text_delta` (ignore `thinking_delta`); `message_delta` sets `done`, and `truncated` on `delta.stop_reason === "max_tokens"`; `message_stop` sets `done`. Non-streamed fallback: if no `data:` frames, `JSON.parse` the body and concatenate `content[]` entries with `type === "text"`, `truncated` on top-level `stop_reason === "max_tokens"`.

## 4. HOW — Behavior

**Gemini.** One-line whitelist + docs + `.faffrc.example`. Inherits `buildOpenAiPayload`, `preflightOpenAi`, `accumulateSse`, `runReviewOpenAi`, and every existing openai-family test.

**Anthropic.** `runReviewAnthropic` mirrors `runReviewOpenAi` with two differences: **no preflight**, and a **404/`not_found` → `model-not-served`** classification in the catch; `401/403` → `auth-failed` via `isAuthError`; one 2× truncation retry; `streamWithTransportRetry` unchanged. Dispatcher gains `fam === "anthropic" → runReviewAnthropic`. `providerFamily` maps `anthropic → "anthropic"`.

**Gemini bad-key handling (no-silent-weakening).** Google's compat layer returns HTTP 400 `API_KEY_INVALID` for a malformed key, which `isAuthError`'s `/HTTP 40[13]/` regex misses → the 400 would fall through to `unreachable` → exit 5 (`pass+skip`). Two coupled changes: (1) enrich `realGet` to append the response body to its error (mirroring `realStream`); (2) broaden `isAuthError` to also match a 400 whose body carries `API_KEY_INVALID` / `api key not valid`. The marker gate keeps the broadening narrow — a generic 400 stays non-auth.

**Anti-patterns.** Adding a new exit code / `mapResultExit` branch for these providers; sending `temperature` to Claude models under extended thinking (rejected with a 400 → `EXIT.OTHER`).

## 5. Scenarios
- anthropic ok → `{status:"ok"}` → exit 0.
- anthropic bad model → first `/v1/messages` POST rejects HTTP 404 → `model-not-served` → exit 4 (needs-human).
- anthropic bad/unset key → 401/403 → `auth-failed` → exit 7 (needs-human).
- gemini via compat, served model → `providerFamily → "openai"` → findings → exit 0.
- gemini bad key HTTP 400 `API_KEY_INVALID` → `isAuthError` recognises the marked 400 → exit 7 (NOT exit 5).
- unknown provider → `unsupported-provider` → exit 2 (loud, AC-3 guard).

## 6. Design Decision Rationale
- **Chosen:** gemini via OpenAI-compat base-URL whitelist (not a native adaptor) — the "less surface area" answer; reuses all openai-family tests; Gemini-only knobs (thinkingBudget, safety) are irrelevant to a system+user+diff→text review.
- **Chosen:** anthropic as a genuine native adaptor (no compat shim exists), preserving the status vocabulary so no exit machinery changes.
- **Chosen:** skip anthropic preflight; map the first stream's 404/`not_found` → `model-not-served`. (Anthropic's Models API exists and could back a `preflightAnthropic` later — extension point.)
- **Chosen:** omit `temperature` from `buildAnthropicPayload`; rely on the model default.
- **Chosen:** `ANTHROPIC_VERSION = "2023-06-01"` named constant with a temporal anchor.
- **Chosen:** fix the gemini-400-bad-key `isAuthError` gap (enrich `realGet` body + marked-400 branch), honouring the no-silent-weakening invariant.

## 7. Open Questions and Assumptions
**Open Questions.** None — no blocking Punt.

**Assumes:** Gemini's OpenAI-compatibility endpoint at `https://generativelanguage.googleapis.com/v1beta/openai` accepts `Authorization: Bearer <GEMINI_API_KEY>` and serves `GET /models` (`{data:[{id}]}`) and `POST /chat/completions` (streaming SSE) in the exact shape the openai family builds and accumulates. **Validate before building — and validate the *streaming* shape, not just existence:** make a real streaming `POST /chat/completions` call as the first build step and confirm the SSE chunks parse through `accumulateSse` unchanged; a `GET /models` check alone proves auth+reachability but not the accumulator-shape assumption. If the base URL/auth differ, only the docs/`.faffrc.example` host value changes — the code path is unaffected.

## 8. DONE — Definition of Done
- [ ] `mapResultExit`, `unreachableExit`, `chainTerminalExit`, `mandatoryRemap`, `isTransientTransport`, `streamWithTransportRetry` unchanged.
- [ ] docs sharpen the independence caveat re `provider: anthropic` when Claude authored/reviewed the code.
- [ ] `providerFamily("gemini") === "openai"`, `providerFamily("anthropic") === "anthropic"`; unknown still passes through (→ unsupported).
- [ ] `buildAnthropicPayload` returns the shape above with no `temperature`, throws on falsy `model`.
- [ ] `accumulateAnthropic` folds `text_delta`, ignores `thinking_delta`, sets `truncated` on `max_tokens`, `done` on `message_delta`/`message_stop`, non-streamed fallback concatenates text blocks.
- [ ] `runReview` dispatches `anthropic → runReviewAnthropic`; `openai` continues to cover `gemini`.
- [ ] `runReviewAnthropic`: transport-retry + one 2× truncation retry; 401/403 → auth-failed; 404/not_found → model-not-served; `x-api-key` + `anthropic-version` headers to `{host}/v1/messages`.
- [ ] `realGet` rejects with `HTTP <status>: <body>`.
- [ ] `isAuthError` true for 401/403 and a 400 containing `API_KEY_INVALID`/`api key not valid`; false for a generic 400.
- [ ] AC-1..3 exit-code parity (7 / 4 / 5); AC-3 unknown-provider exit-2 loud-fail preserved.
- [ ] AC-4: unit tests (injected transport, zero live calls) extended in `test/adversarial-call.test.mjs` — `buildAnthropicPayload`, `accumulateAnthropic`, `runReviewAnthropic` ok/404/401, updated `providerFamily` assertions, `isAuthError` marked-400; the existing gemini/anthropic→unsupported assertion updated.
- [ ] AC-5: `.faffrc.example.yaml`, adversarial `SKILL.md`, `docs/guide/skills.md` move both providers from "not wired" to supported.

## Methodology critique (agile lens)
- **Right-sizing:** one 1–3 day unit; two asymmetric halves. Sequence the gemini whitelist first as independently landable so it isn't held hostage if anthropic slips (build-ordering note, not a split).
- **Workstream fit:** clean (FAFF-209 → FAFF-232 lineage).
- **Surfaced deps:** no missing edges (FAFF-209 Done; FAFF-232 correctly `relatedTo`). Once both providers have transport they become eligible `faffter_dark.adversarial.fallbacks` members — the docs should confirm they slot in cleanly.
- **Risk:** novel-integration; no spike, but sharpen the pre-build Gemini check from `/models` existence to a real streaming `/chat/completions` SSE call so it exercises the accumulator-shape assumption (folded into §7).
