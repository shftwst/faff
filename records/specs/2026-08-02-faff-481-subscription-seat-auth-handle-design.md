# Spec — FAFF-481: wire the subscription-seat auth handle into the backends / engine-call path

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: high. Full spec on Linear FAFF-481.

## 1. WHY — problem and principle

ADR-0092 (FAFF-478) ruled subscription-seat use **sanctioned** for both providers and decided the config direction: `auth: subscription-seat` gains an **optional seat-handle field** naming the token source, reopening ADR-0076's parked "no handle field" deferral (the claude-box long-lived env-var token is a headless seat handle). FAFF-481 wires that decision into the code.

Today (`plugin/skills/faff/bin/lib/backends.js`):

- `AUTH_VALUES = ["subscription-seat", "api-key", "none"]`; `deriveAuth` maps `api_key_env` present → `api-key`, keyless anthropic/codex → `subscription-seat`, else `none`.
- Validation (line 101-102) **rejects** a handle on a seat: *"auth: subscription-seat must not carry api_key_env (it binds to the ambient interactive session — no handle field, FAFF-523)"*.
- `resolveAuthSource` (line 333-334) returns `{source: "ambient-session"}` for a seat — no env resolution.
- `portableMatrixAdmits` (line 254-261) gates the Anthropic seat to the interactive/claude-code harness only ("the ambient session IS the seat").

That ambient-only binding is exactly what ADR-0092 amended. This ticket makes the seat handle real.

## 2. WHAT — design

**Chosen: add an optional seat-handle field `seat_token_env` to the backend schema.** Add it to `FIELDS` and `normalizeBackend` in `backends.js`; it names the env var holding the seat token (a name, never the secret — ADR-0067). Codex omits it (ambient `codex login`); a headless Claude/CI seat sets it.

**Chosen: relax the subscription-seat validation to admit the handle.** Amend the line-101 rule per ADR-0092: `auth: subscription-seat` MAY carry `seat_token_env` (but never `api_key_env` — that stays the api-key mode). `auth: none` still carries no handle; `auth: api-key` still requires `api_key_env` and rejects `seat_token_env`.

**Chosen: `resolveAuthSource` resolves the handle.** `auth: subscription-seat` **with** `seat_token_env` → `{source: "env", env: seat_token_env}`; **without** → `{source: "ambient-session"}` (unchanged — codex/ambient). Mirrors the existing api-key `{source: "env"}` shape.

**Chosen: relax `portableMatrixAdmits` so a handle-carrying seat admits headlessly.** A subscription-seat that carries `seat_token_env` admits on a non-interactive harness (ADR-0092); the handle-less anthropic seat keeps its interactive-session-only binding, and the codex seat keeps admitting on any harness (unchanged).

**Chosen: wire the resolved seat token into every auth-bearing consumer, honouring each transport's header shape.** A subscription-seat backend with a resolved `seat_token_env` sends its token exactly where `api_key_env` sends one today, per transport:
- **openai-compatible** (`review-call.mjs`'s preflight/stream path, `engine.js`'s openai family) → `Authorization: Bearer <token>`;
- **native anthropic** (`review-call.mjs`'s FAFF-210 `/v1/messages` adaptor — the adversarial-review lane) → `x-api-key: <token>` + the existing `anthropic-version` header. **This is the in-faff consumption point for a Claude seat token**, and its header shape is `x-api-key`, not Bearer — the spec's key correctness point.

In both cases an **unset** handle env is `auth-failed` **before** the call (mirroring the `api_key_env`-unset branch, and the anthropic adaptor's existing "absent key ⇒ API 401s → auth-failed" note). Codex's subscription-seat path (`codex login` probe, `engine-codex.js`) is unchanged.

**Chosen (scope boundary): the native-anthropic *adversarial-review* adaptor is in scope; a native-anthropic *engine-call* transport is not.** The FAFF-210 anthropic adaptor already exists in `review-call.mjs`, so wiring the seat token through its `x-api-key` header is part of 481. What stays out is `faff engine call` — ADR-0076 keeps it refusing `provider: anthropic`, and 481 adds no anthropic engine-call transport. So the Claude seat token is consumed by (a) the config/resolution layer (declare + resolve), (b) the review-lane anthropic adaptor via `x-api-key`, and (c) the driving harness/cage reading the env var directly (claude-box, the build/ambient lane) — but **not** by `faff engine call`.

**Assumes:** a headless Claude/CI seat token is accepted by Anthropic's `/v1/messages` as an `x-api-key` value exactly as a metered key is (so the review-lane adaptor needs only the resolved-token swap, no new wire format), and is consumable by the harness/cage directly for the build lane (the claude-box path). If a provider's seat token needs `faff engine call` specifically, that waits on the out-of-scope native transport; the schema, matrix, resolution, and review-lane wiring still land.

## 3. HOW — acceptance

- `backends.js`: `seat_token_env` in `FIELDS`; `normalizeBackend` reads it; validation admits it **only** on `subscription-seat`, rejects it on `api-key`/`none`; `api_key_env` stays `api-key`-only.
- `resolveAuthSource` returns `{source:"env", env}` for a handle-carrying seat, `{source:"ambient-session"}` without.
- `portableMatrixAdmits`: a handle-carrying subscription-seat admits on a non-interactive harness; the handle-less anthropic seat stays interactive-only; codex unchanged.
- Each auth-bearing consumer uses the resolved seat token in its own header shape: openai-compatible (`review-call.mjs` Bearer path, `engine.js` openai family) → `Bearer`; native anthropic (`review-call.mjs` `/v1/messages` adaptor) → `x-api-key`. An unset handle env → `auth-failed` pre-call in each; `engine-codex.js` codex path unchanged.
- Selftests extended (`backends.js` in-file tests; the openai **and** anthropic auth branches of `review-call`, plus `engine`). Existing handle-absent configs resolve **byte-identically** to today.

### Scenarios

```
Given a backend auth: subscription-seat with seat_token_env set
When resolveAuthSource runs
Then it returns {source:"env", env:<name>}.
```

```
Given seat_token_env is unset
When the openai-compatible backend authenticates
Then it fails auth-failed before any network call.
```

```
Given a handle-less subscription-seat (codex / ambient Claude)
When resolved
Then {source:"ambient-session"} and the codex login path is unchanged.
```

```
Given a handle-carrying seat on a non-interactive harness
When portableMatrixAdmits runs
Then it is admitted (headless), where the handle-less anthropic seat would be refused.
```

```
Given an auth: subscription-seat anthropic backend with seat_token_env set
When the review-lane /v1/messages adaptor authenticates
Then the resolved token is sent as x-api-key (not Bearer), with anthropic-version.
```

## 4. DONE — definition of done

- [ ] `seat_token_env` added (subscription-seat-only): schema, normalize, validation (admitted on seat; rejected on api-key/none; `api_key_env` stays api-key-only).
- [ ] `resolveAuthSource` resolves the handle (`env`) vs `ambient-session`.
- [ ] `portableMatrixAdmits` admits a handle-carrying seat headlessly; handle-less anthropic seat stays interactive-only; codex unchanged.
- [ ] Auth-bearing consumers use the resolved seat token in the right header: openai family → `Bearer`; native anthropic `/v1/messages` adaptor → `x-api-key` + `anthropic-version`; unset handle → `auth-failed` pre-call; codex path unchanged.
- [ ] `backends.js` + `engine` + `review-call` (openai **and** anthropic branches) selftests extended; existing handle-absent configs byte-identical.
- [ ] Scope respected: the review-lane anthropic adaptor is wired; no native-anthropic **engine-call** transport (ADR-0076 refusal stands); consumers are config/resolution, the review-lane `x-api-key` adaptor, and the harness/cage.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
