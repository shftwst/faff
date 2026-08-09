# Remove the legacy `budget.price_per_mtok` knob once the ADR-0048 per-class price map is authoritative

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-446.

This spec covers retiring the flat-scalar `budget.price_per_mtok` config knob now that
[FAFF-427](https://linear.app/shftwst/issue/FAFF-427) (PR #324) has wired the ADR-0048
per-model × per-class price map into `budget.cost` as the default pricing source. Audience:
the build agent implementing this chore, and a human reviewer checking the removal posture.

## 1. WHY — Problem and Principles

**The load-bearing model:** `budget.price_per_mtok` is no longer a pricing input anywhere in
the codebase — it is a **dead config key that a stale `.faffrc.yaml` might still carry**. Since
FAFF-427 shipped, `budget.cost` and `economics`'s top-line both resolve pricing from the
built-in ADR-0048 map by default (`pricing:"map"`), with the flat scalar kept only as an
explicit human override (`pricing:"flat"`, `price_per_mtok > 0`) for byte-for-byte continuity.
This ticket removes the ability to set that override going forward, leaving the map as the
**sole** pricing source, so two competing price sources can never diverge again.

**Problem statement:** FAFF-427's spec explicitly named removing the scalar as "future
cleanup," un-ticketed, deferred. Leaving `budget.price_per_mtok` configurable risks a repo
whose `.faffrc.yaml` still sets it (deliberately or by copy-paste) silently keeping flat
pricing forever, permanently deferring the reconciliation ADR-0048/ADR-0059 already did the
hard work for. This ticket closes that door: the flat scalar can no longer be *set* via fresh
config; the map is authoritative, unconditionally.

**Design principle — never let a hard-error here fail open a live breach.** `faff budget
check` is read at every between-units checkpoint by `sentryReadBudget`/`run-done --budget`,
both of which treat **any non-zero exit as the unbreached default** (an established,
documented invariant — see FAFF-364's `until_invalid` handling in `budget.js`, which degrades
a malformed `budget.until` to a warning for the exact same reason: a hard failure at that
call site would mask a real, live tokens/cost breach). A newly-removed config key must not
introduce a second way to fail open the budget signal. This is why the posture below is
**not** a single blanket answer — it reuses the codebase's own existing two-tier precedent
(hard-refuse where refusing carries no fail-open risk, degrade-to-warning where it does).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | JS | `envelopeFrom` (config→envelope resolve), `envelopeFromLedger` (ledger-recorded backward compat), `cmdBudget` (the between-checkpoint producer) |
| `plugin/skills/faff/bin/lib/economics.js` | JS | `cmdEconomics` (reporting-only top-line; never gates) |
| `plugin/skills/faff/bin/lib/lights-out.js` | JS | `cmdLightsOut` preflight probes + `lightsOutPreflight` refusal-gate list (mint-time; refusing here has no fail-open risk) |
| `plugin/skills/faff/bin/lib/config.js` | JS | `DEFAULTS` registry (`budget.price_per_mtok`), `config defaults --selftest` expected-key list |
| ADR-0048, ADR-0059 | Markdown | The pricing-model decisions this ticket's removal amends |
| `plugin/skills/faff-beep-boop/SKILL.md`, `docs/guide/cli.md` | Markdown | User-facing budget docs naming the knob |

**Scope statement:** this is a config-schema + read-site + docs cleanup inside the existing
`budget`/`economics`/`lights-out` governance surface FAFF-427/ADR-0059 already built — it adds
no new pricing mechanism.

## 2. OUT OF SCOPE

- **`budget.price_per_mtok_by_model`** — the per-model override merged over the built-in map.
  *Why excluded:* it is a categorically different knob (a map override, not a competing flat
  price source) and the ticket explicitly keeps it. *Extension point:* unchanged,
  `resolveEconomicsPriceMap` in `budget.js`.
- **Reinterpreting an already-minted ledger's recorded `pricing:"flat"` / `price_per_mtok`
  fields** (`envelopeFromLedger`'s read of `rec.price_per_mtok`/`rec.pricing`). *Why excluded:*
  those fields are historical fact baked into a ledger by a run that started under the
  pre-removal binary — silently reinterpreting them under the new map-only rule would change
  a **live, in-flight** run's dollar ceiling mid-run without the operator doing anything,
  exactly the surprise this ticket exists to prevent elsewhere. *Extension point:* if a future
  ticket wants to force-migrate old ledgers too, it starts at `envelopeFromLedger`
  (`plugin/skills/faff/bin/lib/budget.js`).
- **Deleting the `pricing:"flat"` cost-computation branch in `cmdBudget`.** *Why excluded:* it
  stays reachable — for a **legacy, already-minted** ledger — via the ledger-recorded path
  above; deleting the branch would break in-flight L4 runs started before this ships.
  *Extension point:* revisit once every ledger from before this change has aged out (no
  mechanical detector for that exists today).
- **A `faff config` deprecated-key lint / bulk `.faffrc.yaml` migration tool.** *Why excluded:*
  no such general mechanism exists in the codebase today, and one config key does not justify
  building it. *Extension point:* `plugin/skills/faff/bin/lib/config.js`'s `cmdConfig`, if a
  later ticket wants to generalize.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary**

| Term | Definition |
|---|---|
| Fresh resolve | `envelopeFrom(cfg, flags)` — building a `BudgetEnvelope` straight from `.faffrc.yaml` + CLI flags, never from a persisted ledger. |
| Ledger-recorded resolve | `envelopeFromLedger(rec, flags, cfg)` — rebuilding the envelope from a run-ledger's persisted `budget.envelope`, honouring what a *prior* mint recorded. |
| Removed-knob signal | The new `price_per_mtok_removed` field this spec adds to the envelope shape (see below) — mirrors the existing `until_invalid` field's shape and intent. |

**Envelope shape change** (additive field only):

```
RECORD BudgetEnvelope:
  ceilings: { until, max_attempts, tokens, cost }
  until_invalid: String | null           # unchanged (FAFF-364)
  price_per_mtok_removed: String | null  # NEW — the raw configured price_per_mtok
                                          #  value when > 0 was found in FRESH config;
                                          #  null when absent, or set to a value ≤ 0
                                          #  (0 was always a no-op, never triggers this)
  at_ceiling: "stop" | "narrow" | "escalate"
  price_per_mtok: Number                 # unchanged shape; now always 0 on a FRESH
                                          #  resolve (a legacy-ledger resolve may still
                                          #  carry a recorded > 0 value — OUT OF SCOPE above)
  pricing: "flat" | "map"                # unchanged shape; always "map" on a FRESH
                                          #  resolve (a legacy-ledger resolve may still
                                          #  carry a recorded "flat" — OUT OF SCOPE above)
```

**Design decisions**

*Where does the removed-knob signal live: a thrown exception, or a named field on the
envelope (mirroring `until_invalid`)?* A thrown exception from `envelopeFrom` — a function
called from 4+ sites, several of them pure-function selftest tables — forces every caller
into try/catch and collapses the two legitimately different postures (refuse vs warn) into
one. **Chosen:** a named field, `price_per_mtok_removed`, exactly mirroring how `until_invalid`
already solves this identical shape of problem in this file. Each caller reads the field and
decides its own posture.

*Does `price_per_mtok: 0` (the historical "disabled" sentinel, and the value the shipped
`.faffrc` example already showed) also trigger the removed-knob signal?* No. **Chosen:** only
`price_per_mtok > 0` sets `price_per_mtok_removed` — `0` and absent are behaviourally
identical today (both already resolve to map pricing under FAFF-427) and always have been, so
flagging `0` would be a needless, noisy break for any repo that has `price_per_mtok: 0`
sitting in its config as an explicit no-op (as this exact codebase's own beep-boop `SKILL.md`
`.faffrc` sample does).

## 4. HOW — Behavior

**`envelopeFrom` (`budget.js`):** stop reading `b.price_per_mtok` into the resolved `price`.
Compute `price_per_mtok_removed = (num(b.price_per_mtok) > 0) ? String(b.price_per_mtok) :
null`. Always return `price_per_mtok: 0` and `pricing: "map"` from this function now (flat
pricing can no longer be freshly configured — only a legacy-recorded ledger can still carry
it, via `envelopeFromLedger`, out of scope above).

**`envelopeFromLedger` (`budget.js`):** unchanged for `rec.price_per_mtok`/`rec.pricing`
(legacy-ledger backward compat, preserved verbatim). Additionally propagate
`price_per_mtok_removed: fresh.price_per_mtok_removed` onto its return, so `cmdBudget`'s single
call site reacts uniformly regardless of which resolve path fired (an operator whose *live*
config still carries the removed key should still be warned, even while an in-flight run's
ledger-recorded pricing continues unaffected).

**Chosen removal posture (per call site, justified above):**

1. **`cmdBudget` (`faff budget check`, the between-checkpoint producer) — warn-and-ignore.**
   When `env.price_per_mtok_removed != null`, push a message onto the existing `warnings[]`
   array (same tier as `until_invalid`, unconditional — not gated on `costConfigured`, since
   this is about stale config, not specifically the cost dimension) naming the ignored value
   and the remedy (unset it; `budget.price_per_mtok_by_model` for per-model overrides), and
   mirror it to stderr. **Never** a non-zero exit — `sentryReadBudget`/`run-done --budget`
   treat any non-zero child exit as the unbreached default, so a hard failure here would mask
   a real tokens/cost breach (the exact FAFF-364 `until_invalid` reasoning).
2. **`faff economics` (reporting-only, never gates) — warn-and-ignore.** Same posture as (1):
   append the same notice to `map_warnings` (folded into the existing `warnings[]` on the
   `UnitEconomics` JSON) when `env.price_per_mtok_removed != null`. Economics never governs a
   ceiling, so there is no fail-open risk either way, but consistency with (1) is simpler than
   a third posture for a reporting surface that shares the identical resolve call.
3. **`faff lights-out` preflight (mint-time) — hard-refuse.** A new named gate,
   `budget-price-per-mtok-removed`, fires when the resolved envelope's
   `price_per_mtok_removed != null`, refusing the mint (mints nothing, emits no work — the
   established lights-out refusal shape, same as `budget-until-invalid`). Refusing here
   carries **no** fail-open risk (a refusal blocks a mint outright; it can never mask an
   in-flight breach the way a `budget check` non-zero exit could), so the honest,
   anti-divergence stance the ticket wants is the right one at this specific site: an L4 run
   must not launch under stale config that no longer means what it appears to.

**Config-schema removal (`config.js`):** delete the `"budget.price_per_mtok": "0"` entry from
`DEFAULTS`, and delete `"budget.price_per_mtok"` from the `config defaults --selftest`
expected-key array. `faff config get budget.price_per_mtok` on an unset config now falls
through to the existing "no default" path (exit 3) — no new code needed there; it is a genuine
removed key, not a value to synthesize.

```
PROCEDURE resolve_budget_envelope(cfg, flags):
  1. b := cfg.budget or {}
  2. rawPrice := num(b.price_per_mtok)
  3. price_per_mtok_removed := (rawPrice != null AND rawPrice > 0) ? String(b.price_per_mtok) : null
  4. pricing := "map"          # always, on a fresh resolve
  5. price_per_mtok := 0       # always, on a fresh resolve
  6. RETURN { ceilings, until_invalid, price_per_mtok_removed, at_ceiling, price_per_mtok, pricing }
```

**Edge cases:**
- `price_per_mtok: 0` or absent → `price_per_mtok_removed: null` (no-op, unchanged behaviour).
- `price_per_mtok: -5` or a non-numeric string → `num()` already returns `null`/non-positive,
  so `price_per_mtok_removed` stays `null` (never flags a malformed-but-inert value; only a
  genuinely *effective* legacy value is named).
- A ledger minted **before** this change ships, still mid-run when it ships, keeps its
  recorded `pricing`/`price_per_mtok` verbatim via `envelopeFromLedger`'s untouched legacy
  path — its own cost math never silently changes — while `cmdBudget` still separately warns
  if the *live* `.faffrc.yaml` also still sets `price_per_mtok > 0` (the two are independent
  signals, both surfaced).

**Anti-pattern:** having `envelopeFrom` throw on a removed key. Why: it is called from
selftest tables and multiple production call sites with genuinely different fail-open
exposure; a thrown exception forces a single posture onto all of them, which is exactly the
wrong answer here (see Design Decisions above).

## 5. DONE — Definition of Done

### From WHY
- [ ] A `.faffrc.yaml` with `budget.price_per_mtok` no longer changes `budget.cost`'s or
      `economics`'s pricing on a fresh resolve — both always use the ADR-0048 map.

### From WHAT (types and interfaces)
- [ ] `envelopeFrom`'s returned shape carries `price_per_mtok_removed: String|null`, set only
      when the configured value is `> 0`.
- [ ] `envelopeFrom`'s returned `pricing` is always `"map"` and `price_per_mtok` is always `0`
      on every fresh resolve, regardless of what `.faffrc.yaml` sets for `price_per_mtok`.
- [ ] `envelopeFromLedger` preserves a recorded legacy ledger's `pricing`/`price_per_mtok`
      verbatim (unchanged), and additionally forwards `price_per_mtok_removed` from the fresh
      resolve of the live config.

### From HOW (behaviour)
- [ ] `faff budget check` with `.faffrc.yaml` still setting `budget.price_per_mtok: 3` exits 0,
      prices `cost` from the map, and carries a `warnings[]` entry naming the ignored value +
      remedy (never a non-zero exit for this reason alone).
- [ ] `faff economics` with the same config carries the equivalent notice in its `warnings[]`,
      and its top-line `cost_total` prices from the map.
- [ ] `faff lights-out --check` with the same config refuses, naming gate
      `budget-price-per-mtok-removed` in `refusals[]`, with a detail naming the raw value and
      the remedy.
- [ ] `faff lights-out --check` with `budget.price_per_mtok` absent (or `0`) and a `budget.cost`
      ceiling set proceeds exactly as before (byte-for-byte unaffected).
- [ ] `budget.price_per_mtok: 0` (explicit no-op) never fires the new warning/refusal anywhere.
- [ ] `config defaults --selftest` no longer expects `budget.price_per_mtok`; `faff config get
      budget.price_per_mtok` (unset) now returns exit 3 (no default), not `"0"`.

### From docs
- [ ] `plugin/skills/faff-beep-boop/SKILL.md`'s budget table + `.faffrc` sample no longer show
      `price_per_mtok` as a settable knob (the `price_per_mtok_by_model` row/line stays).
- [ ] `docs/guide/cli.md`'s `budget check`/`economics` rows no longer describe
      `budget.price_per_mtok` as a live override path; both now state the map is the sole
      pricing source (byte-for-byte otherwise).
- [ ] ADR-0059's "`budget.price_per_mtok` is not removed... tracked separately (FAFF-446)"
      consequence is amended to record that FAFF-446 has now removed it, per this spec's
      chosen posture. ADR-0048 carries a short reconciliation pointer to the same effect.

**Integration smoke test:** with a `.faffrc.yaml` carrying `budget: { cost: 5,
price_per_mtok: 3 }`, run `faff budget check --run-dir <dir>` — expect exit 0, JSON `pricing`
absent from output shape change (field names unchanged), a dollar `spent.cost` computed from
the map (not `tokens/1e6 * 3`), and `warnings` containing the removed-knob notice.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumptions:**
- **Assumes:** FAFF-427 (PR #324) has merged to `main` and `envelopeFrom`/`envelopeFromLedger`
  already carry the `pricing`/`price_per_mtok` fields exactly as read in this exploration.
  Validate: `git log --oneline -5 -- plugin/skills/faff/bin/lib/budget.js` on the build branch
  shows the FAFF-427 commit, and `grep -n 'pricing' plugin/skills/faff/bin/lib/budget.js`
  finds the `envelopeFrom`/`envelopeFromLedger` fields this spec extends.

No `**Punt:**` items — every decision above closes with `**Chosen:**`.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
