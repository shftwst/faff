# Spec — FAFF-308: L4 is level-scoped for appetite (forces `full`, ignores config `appetite`)

> Spec: faffter-dark-nlspec · 2026-07-01 · autonomous · confidence: high. Full spec on Linear FAFF-308.

This is the buildable spec for FAFF-308, for the build agent and human reviewers. It makes **appetite level-scoped**: under L4 lights-out, appetite resolves to `full` unconditionally and config `appetite` is ignored; config `appetite` stays authoritative for L1–L3. The design pins the override at the **one place every consumer already resolves appetite** — `faff config get appetite` — so the pin bites at resolution, not per call-site.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every appetite consumer in faff resolves the dial through exactly one channel — `faff config get appetite` (prose skills) or the equivalent `dig(cfg, "appetite") || DEFAULTS["appetite"]` read inside `bin/faff`. There is **no** appetite-specific resolver today; the value comes straight from config. That single channel is the seam: make *it* level-aware and every consumer inherits the L4 pin for free, with zero per-consumer edits.

**Problem statement.** Choosing L4 (fully unattended, lights-out) *is* the act of handing over the reins, so an operator dial for appetite is redundant with the level — yet today an operator who wants true lights-out must set `appetite: full` in config, which also mutates their L1–L3 behaviour and forbids running an L3 beep-boop at `high` alongside an L4 run at `full`. This ticket makes L4 force `full` at resolution, leaving config authoritative only for L1–L3.

**Design principles.**

- **Pin at resolution, never per call-site.** The correctness property is "every appetite consumer observes `full` under L4." Editing individual gates (ADR promotion, chain-gap, resolve-attempt) would be N brittle edits that rot as consumers are added. The pin lives at the *one* resolution channel.
- **`full` ≠ reckless.** L4-forces-`full` licenses auto-resolution of *resolvable* Punts and architectural calls only. The appetite **hard floor** (no cancel/delete; review never weakens; destructive/irreversible always parks) is unchanged and still wins at `full`.
- **L1–L3 config is untouched.** The config file is never rewritten; the override is a runtime resolution preference, so an L3 run at `high` and an L4 run at `full` coexist on the same repo/config.
- **The runner already carries the level signal.** `faff lights-out` (FAFF-225) mints an L4 run-ledger (`level: "L4"`) and hands off via `FAFF_RUN_DIR=<runDir> /faff-beep-boop`. That handoff is the propagation channel — no new plumbing invented.

**Scope statement.** This sits at faff's appetite-resolution layer inside `bin/faff` and the lights-out runner — it changes *what appetite resolves to under L4*, not any consumer's per-level behaviour.

## 2. OUT OF SCOPE

- **Rewriting per-consumer appetite gates** — the whole point is that consumers are untouched; they resolve through the level-aware channel.
- **The FAFF-298 dial-coherence preflight itself** — 298 ships independently; removing its appetite dimension is 298's own follow-on.
- **Level-recipe schema (FAFF-18)** — named level+appetite bundles are a separate ticket.
- **Changing the hard floor / destructive-action parking** — unchanged by design; `full` never licenses destructive action.
- **L1–L3 appetite semantics** — config stays authoritative below L4; no behaviour change.

## 3. WHAT — Resolution contract

```
FUNCTION resolveAppetite(cfg, env):
  # precedence: explicit L4 override  >  config  >  baked default
  1. IF env.FAFF_APPETITE is a valid appetite token:   # runner-exported belt
        RETURN env.FAFF_APPETITE
  2. ledger := loadActiveRunLedger(env.FAFF_RUN_DIR)    # braces: survives subagent boundary
     IF ledger AND ledger.level == "L4":
        RETURN "full"
  3. RETURN dig(cfg, "appetite") OR DEFAULTS["appetite"]  # unchanged L1–L3 path
```

- `resolveAppetite` is the **sole** appetite resolver; `config get appetite` routes through it.
- **Chosen (pin location):** a single level-aware `resolveAppetite` behind `faff config get appetite`; the runner mints the L4 ledger + exports the override; consumers untouched.
- **Chosen (propagation):** *both* — env `FAFF_APPETITE=full` as the fast-path belt + the `FAFF_RUN_DIR` ledger `level:"L4"` as the authoritative, subagent-safe brace.
- **Chosen (scope of override):** the level-aware branch fires **only** for the `appetite` key; every other `config get` key is byte-for-byte unchanged.

## 4. HOW — Behaviour

1. **Resolver.** `resolveAppetite(cfg, env)` (pseudocode §3); `config get appetite` routes through it.
2. **Runner mint.** `cmdLightsOut` writes `dial_profile.appetite: "full"` into the L4 ledger unconditionally.
3. **Runner export.** The `FAFF_RUN_DIR=<runDir> /faff-beep-boop` handoff also exports `FAFF_APPETITE=full`.

**Edge cases.** No `FAFF_RUN_DIR`/`FAFF_APPETITE` → config/default (L1–L3, unchanged). `FAFF_RUN_DIR` set but ledger unreadable / not L4 → fall through to config (fail-safe; never fabricate `full`). Invalid `FAFF_APPETITE` token → ignored, fall through. `latestRunDir` lexical-sort hazard avoided — the resolver reads the *explicitly-handed* `FAFF_RUN_DIR`, not a globally-sorted latest.

## 5. Scenarios

- L4 ledger + config `appetite: low` → `config get appetite` resolves `full`.
- No L4 context + config `appetite: high` → resolves `high` (byte-unchanged L1–L3).
- L3 run at `high` and L4 run at `full` coexist without mutating shared config.
- Under L4-forced `full`, destructive/irreversible action still parks (hard floor unchanged).
- The config file is never written by the override path (runtime-only).

## 6. Design Decision Rationale

- **Pin location** — (a) per-consumer checks rot/leak; (c) rewrite-config re-creates the L1–L3 bleed + violates the hard floor; **(b) single resolver behind `config get appetite`** chosen.
- **L4 signal reach** — env-only risks non-propagation across subagent shells; ledger-only costs a read but survives boundaries; **both** chosen (belt + brace).
- **Generic `config get`** — override guarded to `appetite` key only.

`selectLenses` already pins L4 to adversarial all-four regardless of appetite — this ticket keeps that consistent, it does not modify it.

## 7. Open Questions and Assumptions

**Open Questions:** none — env-vs-resolver resolved as *both*.

**Assumptions:** `selectLenses` continues to pin L4 to the full adversarial lens-set; `FAFF_RUN_DIR` is inherited by beep-boop subagents (already read that way by budget-check and runcheck).

## 8. DONE — Definition of Done

- [ ] Under an active L4 run, appetite resolves to `full` regardless of config `appetite`.
- [ ] Config `appetite` is never rewritten by the override path; stays authoritative for L1–L3.
- [ ] A single `resolveAppetite(cfg, env)` is the sole appetite-resolution channel; `config get appetite` routes through it.
- [ ] Precedence is env `FAFF_APPETITE` (valid token) → active-L4 ledger (`FAFF_RUN_DIR`, `level:"L4"`) → config → baked default.
- [ ] The level-aware branch fires **only** for the `appetite` key; other keys unchanged.
- [ ] `cmdLightsOut` writes `dial_profile.appetite: "full"` into the L4 ledger unconditionally.
- [ ] The runner exports `FAFF_APPETITE=full` on the beep-boop handoff.
- [ ] `config get appetite` prints `full` under an L4 ledger with config `appetite: low`.
- [ ] Outside L4, `config get appetite` prints the config value / `high` default — byte-unchanged.
- [ ] `FAFF_RUN_DIR` set but ledger unreadable/non-L4 → falls back to config (fail-safe).
- [ ] Invalid `FAFF_APPETITE` token → ignored, falls through.
- [ ] Under L4-forced `full`, destructive/irreversible actions still park; review never weakens.
- [ ] A grep audit confirms every appetite read routes through `config get appetite` / `resolveAppetite`.
- [ ] No new LLM-judgement seam — pure deterministic resolution; covered by `test/appetite-resolution.test.mjs` + lights-out mint/handoff assertions.

## ADR promotion intent

Decision — **appetite is level-scoped; L4 forces `full`.** Recorded as an ADR in this PR (graft Step 4b).

confidence: high
spec-review: approve
