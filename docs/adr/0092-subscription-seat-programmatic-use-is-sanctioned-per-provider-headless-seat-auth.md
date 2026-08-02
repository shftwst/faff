# ADR 0092 — Subscription-seat programmatic use is sanctioned; per-provider headless seat auth mechanics

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-02
- **Issue:** FAFF-478

## Context

faff wants to fund its runs on **subscription seats** (Claude Max, ChatGPT/Codex) rather than metered API keys — cheaper, and the natural fit for the "your laptop is the factory" model. Two questions gated whether that is buildable at all (FAFF-478, a de-risking spike): does each provider *permit* programmatic/headless subscription-seat use (the ToS posture), and by what *auth mechanism*?

Two prior ADRs set the ground:

- **ADR-0090** gave the codex engine `auth: subscription-seat` via a `codex login status` seat probe before the `codex exec` spawn, and established that the codex seat **admits on any harness** — it is not bound to an ambient interactive session.
- **ADR-0076** built the `backends:` namespace with a first-class `auth: subscription-seat | api-key | none` dimension, but deliberately **deferred this spike**: it bound `subscription-seat` to "the ambient interactive session," dropped the `seat_ref` handle field, and recorded (operator, 2026-07-16) that FAFF-478 would settle the seat mechanics later without pre-committing a shape.

Evidence gathered since narrows the spike:

- **Codex** mechanics are settled in-code (`engine-codex.js`) and were exercised live end-to-end in the FAFF-694 run — a full prep→graft→PR→merge driven by Codex/GPT-5.6-sol on a subscription seat.
- **Claude** — the claude-box codebase (shftwst) demonstrates two headless seat mechanisms: (a) a short-lived personal token from the interactive `/login`, written to a credential file (around `~/.claude/…`) and passed to headless runs; and (b) a **long-lived token in an environment variable** — the better path for CI. The env-var token is a *headless seat handle* — precisely the shape ADR-0076 said `subscription-seat` didn't need.

The one remaining question — the ToS / programmatic-use posture — was a human/legal call, taken 2026-08-02.

## Decision

**1. ToS posture — both providers sanctioned.** Headless/programmatic subscription-seat use is ruled **sanctioned** for **Codex/ChatGPT** and **sanctioned** for **Claude Max** (human, 2026-08-02). Neither lane falls back to metered API keys on ToS grounds.

**2. Codex/ChatGPT auth — as decided in ADR-0090, now confirmed.** `auth: subscription-seat` via `codex login` (seat probe `codex login status` before the spawn), admitting on any harness. This ADR does not re-decide it; it records that the ToS ruling confirms it.

**3. Claude Max auth — a headless seat is admitted, amending ADR-0076.** A Claude subscription seat may be driven headlessly by either mechanism above (the `/login` credential file, or the long-lived env-var token — the env-var token is the CI path). This **amends** ADR-0076's "Anthropic seat bound to the ambient interactive session; no `seat_ref` field" deferral: the Claude seat is no longer ambient-session-only. faff **consumes** the seat the cage (claude-box, or any equivalent) provides; it does not implement Claude login.

**4. Config surface — `backends:` `auth: subscription-seat` gains a seat handle for the Claude case.** The codex seat needs no handle (ambient `codex login`), but a headless Claude seat needs a way to name its token source. Reopening ADR-0076's parked question, `auth: subscription-seat` gains an **optional seat-handle field** naming the token source (e.g. the env var); its exact shape and wiring are **FAFF-481**. `api_key_env` remains the *api-key* mode only, never the seat path, and secrets always come from the environment (never the committed rc — ADR-0067).

## Consequences

- **FAFF-481** (wire the seat auth into the engine-call / config path) is unblocked: it implements the seat-handle field on `auth: subscription-seat` per decision 4, resolving the token from env at read time.
- **FAFF-609** (the self-hosted-runner rig doc) is unblocked: the CI path is the long-lived env-var token for both providers' seats.
- **FAFF-696** (the review/adversary lane can't reach the driving frontier seat) gains its enabling decision — a review lane can be pointed at the same subscription seat rather than only metered backends.
- **ADR-0076 remains in force**; only its "subscription-seat is ambient-only / no `seat_ref`" deferral is amended. Anything reasoning about seat portability must now treat *both* the codex seat (any harness) and the Claude seat (headless via handle) as non-ambient-capable.
- The ToS ruling is an operator judgement recorded here. If a provider changes its terms, this ADR is the record to revisit, and the claude-box mechanisms should be re-validated.
