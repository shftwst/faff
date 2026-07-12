# ADR 0060 — The L4 spend governor must be measurable, not merely configured

- **Status:** Proposed
- **Date:** 2026-07-12
- **Issue:** FAFF-428

## Context

ADR-0044 made budget a spend/time backstop at L4 and settled *refuse, don't warn* when no ceiling is **set**. That closes half the governor-honesty question. The other half: the meter behind a set ceiling can itself be broken. `measureTokensByClass` (`plugin/skills/faff/bin/lib/budget.js`) silently falls back to an `attempts × 200k` estimate whenever session transcripts are unreadable (`CLAUDE_CODE_SESSION_ID` unset, the encoded-cwd transcript dir missing, or the session file absent — e.g. skip-history). Real runs show that estimate under-reports true spend by roughly 10×. The existing preflight (`spendTimeCeilingSet`) only checks ceiling *shape* — it never asks whether the instrument reading against that ceiling actually works. An L4 run can therefore sail under a governor whose meter reads a tenth of true spend, exactly when observability has already degraded — the failure mode is silent by construction, not by neglect.

ADR-0059 (FAFF-427, immediately prior) fixed *what a token costs* (map pricing, cost-armed detection). This ADR fixes *whether the token count feeding that price is real*.

## Decision

**The L4 spend governor must be measurable, not merely configured.** A token-dependent ceiling (`budget.tokens`, or an armed `budget.cost` per ADR-0059's cost-armed test) is only a real governor when its meter can resolve real transcripts. Estimate-only metering (`measureTokensByClass` returns `source: "estimate"`) is therefore a **preflight-refusing condition by default**:

- `lightsOutPreflight` gains a `budget-metering` refusal gate, fired only when a token-dependent ceiling is armed and the meter is not measurable. A clock-only governor (`budget.until`, `max_attempts`) needs no token meter and is never gated by this.
- The posture is configurable via `budget.on_estimate_only: refuse | warn` — `refuse` (default, and the fail-safe target for any unset or unrecognised value) fails closed at preflight; `warn` is an explicit, human-set opt-in that proceeds but degrades loudly: the preflight banner carries a `DEGRADED` line, the JSON response carries `degrades[]`, and the minted run ledger records `budget.metering = { source_at_mint, degraded: true }`.
- **The posture default is level-scoped local state in `lights-out.js`**, following the `mintAtCeiling` precedent — never a `DEFAULTS` registry entry, because the key is consumed only on the L4 path and a registry entry would misleadingly imply L1–L3 consumers.
- **Mid-run degrade never rides the exit code.** `cmdBudget` at L4 with `tokens_source: "estimate"` appends to the existing `warnings[]` array (the FAFF-364 mechanism) — never a new non-zero exit — because `sentryReadBudget` and `run-done --budget` both treat a non-zero child exit as fail-open (unbreached). Signalling degrade through the exit code would invert the intent: it would mask real breaches instead of surfacing a metering fault.
- `computeBudgetState` (the breach core) stays level-blind and `tokens_source`-blind: an estimate that breaches still stops the run. The hazard this ADR closes is *under-report*, not "estimates never breach."

This is the mechanical completion of the FAFF-312 → FAFF-364 → FAFF-427 governor-honesty line: FAFF-312 demoted count-caps and made spend/time the real L4 governor; FAFF-364 refused a vacuous `until`; FAFF-427 made cost always priceable; this ADR makes the meter itself an assertable precondition of "the governor is armed," not an assumed one.

## Consequences

- Any future L4 governor work that reads token/cost figures must go through `measureTokensByClass`'s `source` field rather than trusting a non-null figure — a non-null estimate is not evidence of a working meter.
- `budget.on_estimate_only` must stay a level-scoped resolver in `lights-out.js`, never migrate into the level-blind `DEFAULTS` registry — doing so would need re-justifying against this ADR, since `config defaults --selftest` is explicitly untouched by this change.
- No consumer of `budget check` (sentry, run-done, or a future one) may treat the metering degrade as a reason to add a new non-zero exit path; the `warnings[]` channel is the only sanctioned surface for this signal, by construction of the fail-open behaviour upstream.
- A `warn`-posture operator who stops reading run summaries silently normalises degraded metering across runs; this is an accepted, explicit trade-off of a human-set config value, not a gap this ADR leaves unaddressed — faff surfaces the degrade at every layer it owns (preflight banner, ledger, `budget check` warnings, run summary).
- Teaching Sentry to react to `tokens_source`/`warnings` directly (rather than only `{breached, outcome}`) is an explicit follow-up (tracked as FAFF-447), not folded into this decision — this ADR only guarantees the signal exists and is loud, not that every consumer already reacts to it.
- The estimate's accuracy (calibrating `est_tokens_per_attempt`) remains untouched; this ADR is about honesty of reporting, not estimator quality, and a future recalibration does not revisit this decision.

**Self-review:** the Consequences above are checked against the shipped diff — `estimateOnlyPosture` lives in `lights-out.js` (not `DEFAULTS`), the `budget-metering` refusal gates only on a token-dependent ceiling, and the mid-run warning is appended to the existing `warnings[]` array with no new exit path. No drift between the decision as recorded here and what shipped.

confidence: high
