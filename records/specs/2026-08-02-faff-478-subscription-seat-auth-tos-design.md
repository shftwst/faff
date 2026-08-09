# Spec — FAFF-478: subscription-seat programmatic-use posture (ToS + auth) → ADR

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: high. Full spec on Linear FAFF-478.

## 1. WHY — problem and principle

Funding faff on a **subscription seat** instead of metered API keys is high-value, but the programmatic-use posture was genuinely open — so it was pulled to the front as a de-risking spike whose deliverable is an **ADR**. It **blocks FAFF-481** (wire the seat auth into the config path) and **FAFF-609** (the self-hosted-runner rig doc).

Since it was filed, two ADRs moved the ground and **narrowed** it:

- **ADR-0090** ("engine transport gains a spawn family: codex") decided the **Codex** seat: `auth: subscription-seat` via a `codex login status` probe before the `exec` spawn, and — unlike the Anthropic seat — it **admits on any harness**. Evidenced live by the [FAFF-694](https://linear.app/shftwst/issue/FAFF-694) run. So the Codex mechanics are already settled.
- **ADR-0076** ("the `backends:` namespace") built the config substrate with a first-class `auth: subscription-seat | api-key | none` dimension, but **explicitly deferred this spike**: it bound `subscription-seat` to "the ambient interactive session," dropped the `seat_ref` handle field, and recorded (operator, 2026-07-16) that FAFF-478's seat-mechanics spike lands later without pre-committing a shape.

So 478's live scope is now sharper: **(a)** the **Claude/Anthropic seat** mechanics — the claude-box evidence shows a **long-lived env-var token** that works headlessly for CI, which is exactly the *seat handle* ADR-0076 said it didn't need; admitting it **amends ADR-0076's ambient-session-only deferral** — and **(b)** the **ToS posture** per provider, now ruled by the human (both sanctioned — see WHAT). The Codex half is now a matter of *pointing at* ADR-0090, not re-deciding it.

## 2. WHAT — the decision to record

**Chosen: Codex/ChatGPT — already decided; the ADR references ADR-0090, does not re-decide.** `auth: subscription-seat` via `codex login`, admits on any harness, seat probe `codex login status`. Evidence: ADR-0090, `engine-codex.js`, the FAFF-694 run.

**Chosen: Claude Max — admit a headless seat handle (the long-lived env-var token), amending ADR-0076.** claude-box demonstrates two mechanisms: a short-lived `/login` credential file, and a **long-lived env-var token (the CI path)**. The env-var token is a headless seat handle — precisely what ADR-0076 deferred ("Anthropic seat bound to the ambient interactive session; no `seat_ref` field"). This spike's finding is that a Claude seat *can* be driven headlessly, so the ADR **amends ADR-0076** to admit a Claude subscription-seat that is not ambient-session-bound. faff **consumes** the seat the cage (claude-box) provides; it does not implement Claude login.

**Chosen: config surface = the `backends:` `auth: subscription-seat` dimension (ADR-0076), not `api_key_env`.** `api_key_env` is the *api-key* mode (an env-var name for a metered key); a subscription seat is the distinct `auth: subscription-seat` value. The question ADR-0076 parked — whether `subscription-seat` needs a handle field — is **reopened by the Claude env-var-token case**: a headless Claude seat needs a way to name its token source, where the codex seat (ambient `codex login`) did not. Deciding that field's shape is this ADR's call; **wiring it is FAFF-481.**

**Chosen (ToS ruling — human, 2026-08-02): both providers sanctioned.** Headless/programmatic subscription-seat use is ruled **sanctioned** for **Codex/ChatGPT** and **sanctioned** for **Claude Max**. So both providers' headless seat mechanics above are usable; neither falls back to metered keys on ToS grounds. This was the load-bearing human/legal call the spike existed to settle; with it ruled, the ADR's conclusion holds for both providers.

**Assumes:** claude-box's env-var-token mechanism is a genuinely headless Claude seat (not a wrapped ambient session), reflecting current provider behaviour as of 2026-08 — re-validate if Anthropic changes the flow. claude-box is the reference implementation for the Claude-seat mechanics.

## 3. HOW — acceptance

The deliverable is a single **ADR** under `records/adr/` (the repo's Nygard Context/Decision/Consequences convention), **related to ADR-0076 (amends the ambient-session-only deferral) and ADR-0090 (Codex reference)**, recording per provider (Codex/ChatGPT, Claude Max):

- the supported headless auth mechanism(s) with evidence pointers, or "unsupported — use metered keys";
- the human's ToS / programmatic-use ruling;
- the `backends:` config direction for FAFF-481 — the `auth: subscription-seat` handle-field decision the Claude env-var case reopens.

### Scenarios

```
Given the ADR is authored
When a reader checks the Codex/ChatGPT row
Then it references ADR-0090 (auth: subscription-seat, codex login, admits on any harness)
And cites engine-codex.js and the FAFF-694 run.
```

```
Given the ADR is authored
When a reader checks the Claude Max row
Then it names the /login credential-file and long-lived env-var-token mechanisms, cites claude-box,
And records the ADR-0076 amendment admitting a headless (non-ambient) Claude seat.
```

```
Given the ToS posture is not yet ruled on
When the ADR is drafted
Then the per-provider ToS ruling is recorded as an explicit human decision
And is never silently assumed sanctioned.
```

## 4. DONE — definition of done

- [ ] An ADR is committed under `records/adr/` (Nygard format), **related to ADR-0076 (amends) and ADR-0090 (references)**.
- [ ] Per-provider supported headless auth path (or "unsupported — use metered keys") is recorded with evidence pointers.
- [ ] The human's ToS / programmatic-use ruling is recorded per provider — **Codex/ChatGPT: sanctioned; Claude Max: sanctioned** (human, 2026-08-02).
- [ ] The `backends:` config direction for FAFF-481 is stated — `auth: subscription-seat` plus the seat-handle-field decision the Claude env-var case reopens.
- [ ] Evidence cited: ADR-0090, ADR-0076, `engine-codex.js`, the FAFF-694 run, and claude-box.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
