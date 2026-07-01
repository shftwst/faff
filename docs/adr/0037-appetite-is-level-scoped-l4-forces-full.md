# ADR 0037 — Appetite is level-scoped; L4 forces full

- **Status:** Proposed
- **Date:** 2026-07-01
- **Issue:** FAFF-308

## Context

Appetite (the "appetite for destruction" dial — how much the agent may auto-resolve without a human) has been a single global config value, `appetite`, read identically at every level through one channel: `faff config get appetite`. Level (L1–L4) and appetite were therefore two independent dials.

That independence is incoherent at L4. Choosing L4 (lights-out, fully unattended) *is* the act of handing over the reins — so an operator dial asking "how much may the agent decide for itself?" is redundant with having already chosen the fully-autonomous level. The independence also forced a concrete operational bind: to run true lights-out an operator had to set `appetite: full` in config, which *also* raised their L1–L3 behaviour, making it impossible to run an L3 beep-boop at `high` alongside an L4 run at `full` on the same repo. It further spawned a false question — "should L4 *cap* appetite?" — that narrowed FAFF-298's dial-coherence preflight down to a non-problem.

The correctness property we want is single: *every* appetite consumer (the FAFF-298 dial-coherence pass, ADR promotion, discovered-scope / chain-gap auto-create, the resolve-attempt-before-park) observes `full` under L4 — with none of them individually patched, so new consumers cannot silently miss the pin.

## Decision

**Appetite is level-scoped. At L4, appetite is not an operator dial — it resolves to `full` unconditionally and config `appetite` is ignored. Config `appetite` stays authoritative for L1–L3, untouched.**

The pin binds at *resolution*, not per call-site. `faff config get appetite` becomes the sole appetite-resolution channel, backed by one function `resolveAppetite(cfg, env)` with fixed precedence:

1. env `FAFF_APPETITE` (a valid appetite token) — the runner-exported fast-path *belt*;
2. an active-L4 run ledger reachable via `FAFF_RUN_DIR` whose `level === "L4"` → `full` — the authoritative, subagent-safe *brace*;
3. config `appetite`, then the baked default — the unchanged L1–L3 path.

The lights-out runner (`faff lights-out`) feeds the signal it already owns: it mints `dial_profile.appetite: "full"` into the L4 ledger unconditionally and exports `FAFF_APPETITE=full` on the `FAFF_RUN_DIR=… /faff-beep-boop` handoff. No new plumbing is invented — `FAFF_RUN_DIR` is already the launch handoff, inherited by beep-boop subagents. The override is guarded to the `appetite` key only; every other `config get` key is byte-for-byte unchanged. The override is runtime-only: the config file is never rewritten.

**The hard floor is unchanged and still wins at `full`.** `full` licenses auto-resolution of *resolvable* Punts and architectural calls — it never licenses destructive or irreversible action: no cancel/delete, review never weakens, destructive/irreversible work always parks. "L4 = full" must not be read as "L4 = reckless".

## Consequences

- **One seam, zero per-consumer edits.** Every consumer that resolves through `faff config get appetite` inherits the L4 guarantee automatically; a new consumer that uses the channel is correct by construction. A consumer that *bypasses* the channel (hardcodes/caches config) would leak — guarded by a grep-audit DONE item and the deterministic seam tests.
- **L3 and L4 coexist.** An L3 beep-boop at `high` and an L4 lights-out run at `full` run against the same repo/config without mutating shared state — the exact bind this removes.
- **FAFF-298 simplifies.** The dial-coherence preflight no longer carries an appetite dimension (it was moot once appetite is level-owned); 298 shipped independently at config-appetite in the interim, and this ADR is what let it drop the ceiling.
- **Belt-and-braces propagation.** The env belt is the greppable fast-path; the ledger brace survives subagent shells where an env export might not propagate. A missing/unreadable/non-L4 ledger or an invalid `FAFF_APPETITE` token both fail safe to config — the override never fabricates `full` nor lowers safety.
- **Generalises toward FAFF-18.** Named level+appetite recipes (vetted bundles) are the natural next step now that appetite is level-owned rather than a free global dial.
- **Relates to** ADR 0035 (appetite moves where human control sits) — this fixes *where* on the appetite axis L4 sits; and ADR 0036 (the L4 lights-out runner) — the runner that carries the pin. Neither is superseded.
