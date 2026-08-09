# Spec — FAFF-696: route the review / spec_review lane to a subscription-seat backend

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: high. Full spec on Linear FAFF-696.

## 1. WHY — problem and principle

Under the FAFF-694 codex run the adversarial review lane could only reach weak metered backends while a frontier seat drove the session. Routing the review lane at a subscription seat is the fix — and the exploration shows **almost all of it already exists**; only one link is missing.

The path today:

- **`faffter_dark.adversarial.refs: [<name>]` already resolves into the shared `backends:` namespace** (FAFF-523, `adversarial-backends.js:73` → `resolveBackendRefs`), returning fully-normalized backends — including `auth` and (post-FAFF-481) `seat_token_env`.
- **`review-call.mjs` already resolves a seat token** from `auth`/`seat_token_env` and sends it as `Bearer` (openai) or `x-api-key` (anthropic) — the FAFF-481 wiring.
- **The missing link:** `adversarial-backends.js`'s `pickBackendKeys` copies only `BACKEND_KEYS = ["provider","model","host","api_key_env","reasoning_off","timeout"]` (line 30) into the emitted chain. It **drops `auth` and `seat_token_env`**, so a referenced seat backend arrives at `review-call.mjs` stripped of its seat identity — it falls back to the (absent) `api_key_env` path and fails.

So the seat can be *referenced* but not *authenticated*: the chain mapper is the one seam that hasn't caught up with FAFF-481/523.

## 2. WHAT — design

**Chosen: add `auth` and `seat_token_env` to `BACKEND_KEYS` in `adversarial-backends.js`.** `pickBackendKeys` then carries both through every chain form (the `refs:` path, the native `backends:` array, and legacy inheritance), so a seat backend's identity survives to `review-call.mjs`, which already knows what to do with it. This is the entire seat-routing wire.

**Chosen: no new preflight, no new resolution.** `review-call.mjs`'s `checkPayloadSize` (FAFF-445) already handles the context-overflow sub-finding; its FAFF-481 token resolution already handles Bearer/x-api-key. This ticket adds no logic on those paths — it stops dropping two fields.

**Chosen: metered path unchanged.** A backend with no `auth`/`seat_token_env` (every existing config) emits byte-identically — the two new keys are simply absent, and `review-call.mjs`'s legacy `api_key_env` fallback is untouched. Compose, don't replace.

**Assumes:** the operator declares a subscription-seat backend in the top-level `backends:` namespace (with `seat_token_env` for a headless seat, per FAFF-481) and references it from `faffter_dark.adversarial.refs:`. Standing up that backend is config, not code — this ticket makes the reference *work*, it doesn't author the operator's config.

## 3. HOW — acceptance

- `BACKEND_KEYS` includes `auth` and `seat_token_env`; `pickBackendKeys` carries both when present.
- A `faffter_dark.adversarial.refs: [<seat-backend>]` chain emits `auth` + `seat_token_env` in the assembled chain (was: dropped).
- End-to-end: the emitted chain reaches `review-call.mjs`'s mapper (which already reads `b.auth` / `b.seat_token_env` from FAFF-481) and resolves the seat token — Bearer or x-api-key by provider.
- Existing metered/`api_key_env` configs emit byte-identically (the two keys absent).
- `adversarial-backends` selftest extended.

### Scenarios

```
Given a subscription-seat backend in backends: with seat_token_env
And faffter_dark.adversarial.refs referencing it
When faff adversarial-backends assembles the chain
Then the emitted chain entry carries auth: subscription-seat and seat_token_env.
```

```
Given a legacy metered adversarial config (api_key_env, no auth field)
When the chain is assembled
Then it emits byte-identically to today (no auth/seat_token_env keys).
```

```
Given the seat-carrying chain reaches review-call.mjs
When it authenticates
Then the seat token is resolved (FAFF-481) and sent as Bearer or x-api-key.
```

## 4. DONE — definition of done

- [ ] `BACKEND_KEYS` in `adversarial-backends.js` includes `auth` + `seat_token_env`; `pickBackendKeys` carries both.
- [ ] `refs:`-into-a-seat-backend chain emits the seat fields; verified by selftest.
- [ ] Legacy metered configs emit byte-identically (regression-guarded).
- [ ] End-to-end seat auth confirmed reaching `review-call.mjs` (its FAFF-481 resolution already tested; this confirms the fields arrive).
- [ ] Out of scope respected: concurrency (FAFF-706) and loop-convergence (FAFF-707) untouched.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
