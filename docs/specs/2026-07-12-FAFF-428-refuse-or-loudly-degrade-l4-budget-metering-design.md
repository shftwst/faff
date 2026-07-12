# FAFF-428 — Refuse or loudly degrade L4 budget metering when transcripts are unavailable (estimate-only)

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-428.

This spec addresses FAFF-428 for the build agent and human reviewers: it makes the L4 lights-out preflight require the budget meter to be *measurable* (transcripts readable), not merely *configured* — refusing by default when metering is estimate-only, degrading loudly under an opt-in posture, and surfacing any mid-run degrade in the budget-check JSON, the run ledger, and the run summary. L1–L3 behaviour is unchanged.

## 1. WHY — Problem and Principles

**Load-bearing model:** an L4 spend governor is only as trustworthy as its instrument. The preflight (`spendTimeCeilingSet`, `plugin/skills/faff/bin/lib/lights-out.js`) checks a spend/time ceiling is SET; the meter itself (`measureTokensByClass`, `plugin/skills/faff/bin/lib/budget.js`) can silently degrade to an `attempts × 200k` estimate whenever transcripts are unreadable (`CLAUDE_CODE_SESSION_ID` unset, the encoded-cwd transcript dir missing, or the session file absent — e.g. skip-history). Real runs show the estimate under-reports ~10× — so an L4 run can sail under a ceiling whose instrument reads a tenth of true spend, exactly when observability is degraded. This change adds the missing half of the preflight predicate: the governor's meter must be measurable at mint, and a degrade anywhere must be loud.

**Problem:** `measureTokensByClass` returns `{ tokens: null, source: "estimate" }` on any transcript-unavailability and `cmdBudget` silently substitutes `attempts × (budget.est_tokens_per_attempt || 200000)` with no warning; `lightsOutPreflight` never asks whether the meter works. Result: the L4 budget guardrail reports "armed" while metering fiction.

**Design principles:**

**Fail toward refusing, never toward silence.** Same posture as the FAFF-364 vacuous-`until` refusal and FAFF-427's never-silently-undercount rule: a governor whose instrument is broken must refuse or shout, never quietly govern fiction. Default posture is `refuse`; an unrecognised posture value coerces to `refuse`.

**Never signal through the exit code of `budget check`.** `sentryReadBudget` and `run-done --budget` treat any non-zero child exit as the unbreached default (fail-open) — the FAFF-364 comment in `cmdBudget` documents this exactly. A mid-run degrade therefore rides the JSON `warnings[]` mechanism, never a new exit code.

**Level-scoped policy stays level-scoped.** The posture is consumed only on the L4 path, so its default lives in `lights-out.js` as a local pure resolver (the `mintAtCeiling` precedent), NOT in the level-blind `DEFAULTS` registry — L1–L3 budget semantics and `config defaults --selftest` are untouched.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | `measureTokensByClass` (~309: `{tokens:null, source:"estimate"}` on unavailability), `cmdBudget` estimate branch (~429–433: `attempts × est_tokens_per_attempt`), FAFF-364 `warnings` mechanism (~455–460), `computeBudgetState` (level-blind, unchanged) |
| `plugin/skills/faff/bin/lib/lights-out.js` | `lightsOutPreflight` (~297: refusal gates `budget-ceiling`, `budget-until-invalid`), `spendTimeCeilingSet` (~423: config-shape-only), `mintAtCeiling` (~430: the level-scoped-default precedent), mint block (~600–623: `level: "L4"`, `budget: { envelope }`) |
| `plugin/skills/faff-beep-boop/SKILL.md` | Run-summary template — already renders `tokens_source` + one ⚠ per `warnings[]` entry |
| `test/budget.test.mjs`, `test/lights-out.test.mjs` | Estimate-fallback test (~101), "no budget ceiling refuses" test (~71), FAFF-364 warning tests — the patterns to extend |

**Scope:** a CLI-internal change to `lights-out.js` + `budget.js` plus their tests and documentation; no skill-prose control flow, contract vocabulary, or tracker behaviour changes beyond one run-summary rendering line.

## 2. OUT OF SCOPE

- **FAFF-427 (map pricing / dollar-ceiling default)** — sequences FIRST; this spec assumes its changes (see Assumptions) and never re-touches pricing. Extension point consumed here: the `tokens_source === "estimate"` branch of `cmdBudget` that 427 leaves as `cost: null` + warning under map pricing.
- **Sentry visibility of the degrade** — `sentryReadBudget` reads only `{breached, outcome}`; teaching the kill-switch to react to `tokens_source`/`warnings` is a follow-up. Extension point: `sentryReadBudget` in `plugin/skills/faff/bin/lib/sentry.js`.
- **L1–L3 estimate-fallback semantics** — the `attempts × 200k` fallback stays exactly as-is below L4 (it is a reasonable L3 count-idiom); no warning is added on non-L4 paths.
- **Changing `budget check` exit codes** — deliberately excluded (fail-open hazard above). Extension point if ever wanted: the FAFF-425 `outcome: "indeterminate"` channel.
- **Making the estimate accurate** (calibrating `est_tokens_per_attempt`) — orthogonal; the fix here is honesty, not estimator quality.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| measurable metering | `measureTokensByClass` resolves the session transcript set — `source: "transcript"` |
| estimate-only metering | transcripts unreadable — `source: "estimate"`, spend figure derived from `attempts × est_tokens_per_attempt` |
| token-dependent ceiling | a ceiling whose breach test needs the token meter: `budget.tokens`, or `budget.cost` when armed (under FAFF-427 map pricing `cost` is always priceable, so an armed cost ceiling is always token-dependent) |
| posture | what L4 does about estimate-only metering: `refuse` (fail-closed preflight, default) or `warn` (proceed + loud degrade) |

**New config key (level-scoped, not in `DEFAULTS`):**

```
budget.on_estimate_only: refuse | warn     # consumed only by the L4 path; unset → refuse; unrecognised → refuse
```

**New/changed shapes (pseudocode):**

```
FUNCTION estimateOnlyPosture(cfg):          # lights-out.js, pure — the mintAtCeiling pattern
  raw = dig(cfg, "budget.on_estimate_only")
  IF raw is null: RETURN "refuse"           # L4 default: fail-closed
  v = trim+lowercase(raw)
  RETURN v in {"refuse","warn"} ? v : "refuse"   # typo fails safe toward refusing

lightsOutPreflight probes (additive):
  meteringMeasurable: bool                  # measureTokensByClass(...).source == "transcript", sampled by cmdLightsOut
  estimateOnlyPosture: "refuse" | "warn"

lightsOutPreflight result (additive):
  degrades: [ { gate, detail } ]            # warn-posture degrades; absent/empty on a clean run

run-ledger budget block (additive, mint time):
  budget.metering: { source_at_mint: "transcript"|"estimate", degraded: bool }
                                            # degraded == true only on a warn-posture estimate-only mint

budget check JSON (additive):
  warnings: [ ...existing FAFF-364 entries..., "<L4 estimate-only degrade warning>" ]   # present only when non-empty
```

**Design decisions** (rationale in section 6): gate lives at preflight, breach core stays level-blind — **Chosen:** below; posture key + fail-safe default — **Chosen:**; gate fires only for token-dependent ceilings — **Chosen:**; mid-run degrade rides `warnings[]`, never the exit code — **Chosen:**; posture default is level-scoped local, not `DEFAULTS` — **Chosen:**.

## 4. HOW — Behavior

**Preflight (the load-bearing change).** `cmdLightsOut` samples the meter once and threads two new probe fields; `lightsOutPreflight` stays pure:

```
PROCEDURE cmdLightsOut (additions):
  1. metering = measureTokensByClass({ cwd: root, env: process.env, runStartMs: null })
     # runStartMs null is the documented degenerate path — the session match alone decides
  2. probes.meteringMeasurable = (metering.source == "transcript")
  3. probes.estimateOnlyPosture = estimateOnlyPosture(cfg)

PROCEDURE lightsOutPreflight (additions, after the budget-ceiling check):
  1. tokenDependent = ceilings.tokens != null OR cost-armed(envelope)   # cost-armed per FAFF-427: pricing "map", or "flat" with price_per_mtok > 0
  2. IF tokenDependent AND NOT probes.meteringMeasurable:
     a. IF probes.estimateOnlyPosture == "refuse":
          refusals.push({ gate: "budget-metering",
                          detail: "budget meter is estimate-only (transcripts unreadable: session id unset, transcript dir missing, or session file absent) — a token/cost ceiling cannot be measured, only estimated (~10x under-report); fix transcript availability, or set budget.on_estimate_only: warn to accept degraded metering" })
     b. ELSE (warn):
          degrades.push({ gate: "budget-metering",
                          detail: "budget metering degraded: estimate-only (attempts x est_tokens_per_attempt) — token/cost ceiling figures may under-report ~10x" })
  3. RETURN { ...existing, degrades }
```

- The refusal joins the existing list mechanics unchanged: JSON `{ proceed: false, refusals: [...] }`, exit 1, nothing minted; non-JSON prints it in the `REFUSED` list. `--check` reports identically and mints nothing.
- On a warn-posture proceed, `cmdLightsOut` prints each degrade in the banner output (a `DEGRADED` line mirroring the `REFUSED` rendering) and includes `degrades` in the JSON.
- **Mint records the metering state** whenever a ledger is minted: `ledger.budget.metering = { source_at_mint: metering.source, degraded: <true only when degrades includes budget-metering> }`. Additive — nothing downstream keys on its absence (pre-change ledgers simply lack it).
- When only `budget.until` (and/or `max_attempts`) is armed, the gate does not fire: a clock ceiling needs no token meter. The `budget-ceiling` gate is untouched and still runs first; both can appear together (e.g. no ceiling at all + unreadable transcripts → only `budget-ceiling`, since no token-dependent ceiling is armed).

**Mid-run honesty (`cmdBudget`).** Transcripts can vanish after a measurable mint (env change across resume, deleted history), so the meter itself reports the degrade — at L4 only, both postures, via the FAFF-364 warning mechanism:

```
PROCEDURE cmdBudget (additions, where warnings are assembled):
  1. IF tokensSource == "estimate" AND ledger.level == "L4":
       warnings.push("L4 budget metering degraded: transcripts unreadable — token figure is attempts x est_tokens_per_attempt (may under-report ~10x)")
       stderr line, same text prefixed "faff budget check: "
  2. warnings assembly becomes APPEND-based so the FAFF-364 until-warning and this one coexist
     (state.warnings = [msg] assignment today — collect into one array, attach only when non-empty)
```

- `computeBudgetState` is untouched — breach logic stays level-blind and tokens_source-blind; an estimate figure still breaches identically (an estimate that DOES breach is still a stop signal; the hazard is under-report, and under-report is what the warning names).
- No ledger, no `level` field, or `level != "L4"` → byte-for-byte today's behaviour (L1–L3 unchanged).

**Run-summary surfacing (`plugin/skills/faff-beep-boop/SKILL.md`, one rendering line).** The summary template already renders `tokens_source` and one ⚠ per `warnings[]` entry from `budget check`/`economics`; add the mint-time half: when the run ledger's `budget.metering.degraded` is true, the summary's budget line carries an explicit `⚠ metering degraded at mint: estimate-only (budget.on_estimate_only: warn)` marker. Together with the `warnings[]` rendering this discharges the "surfaced in run ledger + run summary" acceptance criterion.

**Edge cases:**

- Malformed `budget.on_estimate_only` (typo, wrong type) → `refuse` (fail-safe direction; mirrors `mintAtCeiling`'s typo rule, but toward the closed posture since here fail-closed IS the default).
- Preflight measurable, mid-run unreadable → mid-run warning fires (the preflight probe is a mint-time sample, not a guarantee; the warning is the persistent net).
- Estimate-only + until-only ceiling at L4 → no refusal, but the mid-run `cmdBudget` warning still fires (reporting honesty: attempts/tokens figures in summaries are estimates even when the governor is a clock).
- `probes.meteringMeasurable` absent (an older caller of the pure function) → treat as measurable (no refusal) — additive-probe tolerance, matching how other optional probes degrade; the shipped `cmdLightsOut` always supplies it.
- Empty-but-readable transcript (session file exists, zero usage lines) → `source: "transcript"`, measurable; tokens 0 — unchanged today, correctly not a degrade.

**Failure modes:**

- **The preflight probe samples a different environment than later `budget check` invocations** (e.g. the runner mints from a shell where `CLAUDE_CODE_SESSION_ID` is set, but the orchestrator session that runs `budget check` differs). How you'd know: mint records `source_at_mint: "transcript"` yet `budget check` JSON carries the L4 degrade warning. What it means: the mid-run warning is the real net; the preflight gate only guarantees the run *starts* measurable — acceptable, documented, and visible.
- **Warn posture normalises the degrade** (operator sets `warn` and stops reading summaries). How you'd know: `budget.metering.degraded: true` accumulating across run ledgers. What it means: operator choice — the posture is explicit, human-set config; faff surfaced it loudly at every layer it owns.

**Anti-pattern:** signalling the degrade via a non-zero `budget check` exit code. Why: sentry/run-done treat non-zero as unbreached (fail-open) — the degrade would mask real breaches, the exact inversion of intent.

**Anti-pattern:** registering `budget.on_estimate_only` in the level-blind `DEFAULTS` registry. Why: the posture is L4-scoped policy; `mintAtCeiling` establishes the level-scoped-local-resolver pattern, and a `DEFAULTS` entry would imply L1–L3 consumers exist (there are none).

## 5. SCENARIOS

```
Given an L4 config with budget.tokens set (and budget.on_estimate_only unset)
  and CLAUDE_CODE_SESSION_ID unset (or the transcript dir/session file absent)
When faff lights-out --json runs (contained, guardrails live)
Then exit 1, proceed: false, refusals include gate "budget-metering", and no .faff run ledger is minted
```

```
Given the same config plus budget.on_estimate_only: warn
When faff lights-out --json runs
Then the run proceeds, the JSON carries degrades[] naming "budget-metering",
  and the minted ledger records budget.metering = { source_at_mint: "estimate", degraded: true }
```

```
Given an L4 config whose only ceiling is budget.until (valid HH:MM) with transcripts unreadable
When faff lights-out --json runs
Then no "budget-metering" refusal fires (a clock ceiling needs no token meter)
```

```
Given an in-flight L4 run ledger (level: "L4") and unreadable transcripts
When faff budget check --run-dir <dir> runs
Then the JSON reports tokens_source "estimate" and warnings[] names the L4 metering degrade;
  and the same command against a non-L4 ledger emits no such warning (L1-L3 unchanged)
```

Assertions (non-functional): a clean measurable L4 run's `budget check` JSON is byte-identical to today (warnings only when non-empty); `computeBudgetState` behaviour unchanged; `node --test` and the budget/lights-out `--selftest` tables pass.

## 6. DESIGN DECISION RATIONALE

**Where does the fail-closed gate live?** Options: (a) `lightsOutPreflight` refusal (the level-aware chokepoint, mirrors `budget-ceiling`/`budget-until-invalid`); (b) teach `computeBudgetState` to refuse on estimate at L4 (pollutes the level-blind pure core, and mid-run refusal has no safe channel — exit codes fail open); (c) orchestrator prose only (not mechanical). **Chosen:** (a) preflight refusal + (mid-run) warnings — the gate is mechanical where L4-ness is authoritative, and the breach core stays pure and level-blind.

**Posture key, values, default?** Options: (a) `budget.on_estimate_only: refuse|warn`, default refuse; (b) reuse the `autonomous.require_*` warn|block prose-knob pattern (but this gate is CLI-mechanical, not prose, and its fail-safe direction is the opposite — closed by default); (c) a boolean `budget.allow_estimate_only` (loses the posture vocabulary). **Chosen:** (a) — named like `budget.at_ceiling` (event-key → action-value), default `refuse` per the issue's fail-closed intent, unrecognised value coerces to `refuse`.

**Which ceilings trigger the gate?** Options: (a) any armed ceiling; (b) only token-dependent ceilings (`tokens`, armed `cost`). **Chosen:** (b) — an until-only governor is a clock, honestly measurable without transcripts; refusing it for meter unavailability would block a legitimately-governed run. The mid-run reporting warning still fires for figure-honesty.

**Mid-run degrade channel?** Options: (a) `warnings[]` + stderr (FAFF-364 mechanism, additive JSON); (b) non-zero exit (fails open through sentry/run-done — rejected); (c) `outcome: "indeterminate"` (FAFF-425's channel — overloads own-fault semantics; the meter isn't faulted, it degraded to its documented fallback). **Chosen:** (a), gated on `ledger.level === "L4"`.

**Where does the posture default live?** Options: (a) `DEFAULTS` registry; (b) level-scoped local resolver in `lights-out.js` (the `mintAtCeiling` precedent). **Chosen:** (b) — the key is consumed only by the L4 path; the registry stays level-blind and `config defaults --selftest` is untouched.

**Is this ADR-worthy?** It completes the FAFF-312/364/427 L4 governor-honesty posture with a durable rule future governor work must obey. **Chosen:** yes — one candidate: "the L4 spend governor must be measurable, not merely configured: estimate-only metering refuses at preflight by default (`budget.on_estimate_only`, level-scoped)" (materialised by graft via `faff adr new`).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none blocking — every decision above carries a **Chosen:** marker.

**Assumptions:**

- **Assumes:** FAFF-427 has merged before this builds (same `cmdBudget` region; explicitly sequenced first, never concurrent). Its envelope `pricing` field defines cost-armed for the token-dependent test. Validate: `git log --oneline -5 -- plugin/skills/faff/bin/lib/budget.js` at build start and confirm the `pricing` field exists in `envelopeFrom`. If FAFF-427 has NOT merged, the cost-armed test degrades to today's `cost != null && price_per_mtok > 0` — note it in the PR and keep the seam one-line.
- **Assumes:** every L4-minted ledger carries `level: "L4"` (written at the lights-out mint block) — the mid-run warning's gate. Validate: read the mint block in `lights-out.js` before building.
- **Assumes:** `measureTokensByClass` is exported from `budget.js` and `lights-out.js` may import it (it already requires `./budget` for `envelopeFrom`; both are governance-region). Validate: check `module.exports` in `budget.js`.

## 8. DONE — Definition of Done

### From WHY
- [ ] An L4 run with a token/cost ceiling and unreadable transcripts cannot start under the default posture: `faff lights-out` (and `--check`) refuses with gate `budget-metering`, exit 1, nothing minted.

### From WHAT
- [ ] `estimateOnlyPosture(cfg)` pure resolver in `lights-out.js`: unset → `refuse`, `warn` honoured, unrecognised → `refuse`; NOT registered in `DEFAULTS` (registry + `config defaults --selftest` untouched).
- [ ] `lightsOutPreflight` takes `meteringMeasurable` + `estimateOnlyPosture` probes and returns an additive `degrades[]`; absent `meteringMeasurable` tolerated as measurable.
- [ ] Warn-posture mint records `budget.metering = { source_at_mint, degraded }` in the run ledger; measurable mints record `source_at_mint: "transcript", degraded: false`.

### From HOW
- [ ] Refusal fires only when a token-dependent ceiling is armed (`tokens`, or armed `cost`); an until-only config with unreadable transcripts does not refuse.
- [ ] Warn posture proceeds with `degrades[]` in JSON + a banner DEGRADED line.
- [ ] `cmdBudget` at L4 (`ledger.level === "L4"`) + `tokens_source: "estimate"` → `warnings[]` entry + stderr line; warnings assembly is append-based (coexists with the FAFF-364 until-warning); non-L4 ledgers byte-identical to today.
- [ ] `budget check` exit codes unchanged (no new non-zero path).

### From docs/tests (same PR — docs never go stale)
- [ ] `docs/guide/cli.md` lights-out row names the `budget-metering` gate + posture key; beep-boop `SKILL.md` summary template carries the mint-degrade ⚠ line.
- [ ] New ADR recorded via the graft ADR step (candidate named in section 6).
- [ ] `test/lights-out.test.mjs`: refuse-by-default, warn-proceeds-with-ledger-marker, until-only-no-refusal (patterned on the "no budget ceiling refuses" test); `test/budget.test.mjs`: L4-estimate warning present, non-L4 absent, both-warnings coexistence; `lightsOutSelftest` gains `meteringMeasurable`/posture fixtures and `budgetSelftest` the posture-coercion rows where pure; full `node --test` green.

**Integration smoke test:**

```
1. Fixture .faffrc with budget.tokens: 1000000 (no other budget keys); env WITHOUT CLAUDE_CODE_SESSION_ID
2. faff lights-out --check --json (contained fixture env) → exit 1, refusals include "budget-metering", no .faff/runs dir created
3. Add budget.on_estimate_only: warn → same command proceeds; mint (non --check) writes ledger with budget.metering.degraded: true
4. faff budget check --run-dir <that dir> → tokens_source "estimate", warnings[] names the L4 degrade
```

## Already shipped against this surface

Done tickets matched on the budget/lights-out governance surface — related groundwork, none supersedes this premise (no Done ticket makes the L4 meter measurability-checked):

- FAFF-312: demoted count-caps, made spend/time the L4 governor — the SET-ness check this adds MEASURABLE-ness to.
- FAFF-364: vacuous-`until` preflight refusal — the refusal pattern and warning mechanism this extends.
- FAFF-425: governance CLIs fail closed on own read faults — adjacent posture; its `indeterminate` channel deliberately NOT reused here (section 6).
- FAFF-36 / FAFF-229: the budget envelope + transcript attribution machinery being gated.
- FAFF-407 / FAFF-408 / FAFF-410 / FAFF-357: token accounting, per-event `tokens_source` tagging, economics — the observability surfaces that render the degrade.
- FAFF-225 / FAFF-298: the lights-out runner + dial-coherence preflight this slots into.

(FAFF-427 is Todo, not Done — the sequenced-first sibling this spec composes with, not superseding work.)

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a single cohesive 1–3 day slice: one preflight gate + posture resolver + one warning site + surfacing + tests. Splitting the preflight gate from the mid-run warning would ship a governor honest at mint but silent mid-run.
- **Workstream fit?** No issues — "T2 — gates are complete" is outcome-named; a measurability-checked spend governor completes the budget gate's honesty.
- **Deps surfaced?** One finding (repeat of the FAFF-427 critique): the sequencing lives in description prose plus an undirected `relatedTo` link — still no directed **FAFF-428 blockedBy FAFF-427** edge, so graph readers won't serialise the pair. Recommended: a human (or tidy) draws the edge; until then any run picking up FAFF-428 must honour the prose sequencing (this run's orchestrator already does).
- **Risk profile?** No issues — deterministic CLI seams with strong existing test patterns (`--selftest` tables, `node --test` fixtures); no de-risking spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
