# Window-mode budget — global 5-hour rolling window governor (FAFF-594, narrowed)

> Spec: faffter-dark-nlspec · 2026-07-24 · mode: autonomous · confidence: high

This spec covers the **narrowed, human-decided slice** of FAFF-594. The original ticket parked on four architecture/product punts (see prior comment, 2026-07-24). The human resolved all four for this slice:

| Open question | Resolution for this slice |
|---|---|
| Per-backend vs global governor | **Global.** Defer per-backend attribution — it needs the unbuilt FAFF-604 telemetry seam. |
| Weekly vs 5-hour window | **5-hour only.** Defer weekly — it needs cross-run persistence that doesn't exist. |
| Ceiling unit (vendor-quota unobservable) | **Reuse the existing token-metering as a faff-local proxy.** No new request-count metering. Vendor-quota introspection stays permanently out of scope. |
| Window anchor/reset rule | **Roll from the first draw recorded in the window** (simplest defensible rule — captured in an ADR, not just code comments). |

## 1. WHY — Problem and Principles

**Problem statement:** faff's budget prices tokens into dollars (per-model × per-class, ADR-0048/0059). On a subscription seat (Claude Max, ChatGPT Plus/Pro) the vendor meters a rolling 5-hour window, not dollars — a subscription run needs a window-native ceiling that parks-until-reset instead of escalating on a dollar figure.

**Design principles:**

- **A proxy is not the meter.** faff cannot observe the vendor's real remaining 5h quota (no API; the vendor counts all of the user's activity, not just faff's). The window governor is a **faff-local proxy**: it meters faff's own token draw against a faff-configured ceiling. It never claims to know the vendor's true remaining allowance.
- **Fail toward parking, never toward silent over-draw** — consistent with the existing governor posture (FAFF-364 vacuous-ceiling refusal, FAFF-427 conservative unpriced rate).
- **Dollar mode is untouched and default.** Window mode is an opt-in `at_ceiling` disposition plus an additive `budget.window` config block; the existing `envelopeFrom`/`computeBudgetState` dollar/attempts/until paths stay byte-for-byte.
- **Reuse, don't reinvent, the draw meter.** The window's own draw accounting reuses the existing `measureTokens*` transcript-sum machinery (session + child-transcript attribution, FAFF-229/408/427) — no new metering primitive.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | Node | The governor: `AT_CEILING_OUTCOMES` (budget.js:117), `envelopeFrom` (budget.js:320), `computeBudgetState` (budget.js:350), `measureTokens*` (budget.js:506-558), `cmdBudget` (budget.js:666) |
| `plugin/skills/faff/bin/lib/governance-profile.js` | Node | `DELIVERY_PROFILE.terminal_states` (governance-profile.js:62) — the outcome vocabulary `runcheck`/`disposition`/`queue-state` all read |
| `plugin/skills/faff/bin/lib/runcheck.js` | Node | Dangling-check: an `admitted` issue with no terminal-state outcome is flagged. A parked-until-window-reset remainder must carry a terminal outcome so it is not flagged dangling. |
| `plugin/skills/faff/bin/lib/disposition.js` | Node | `ATTENTION_OUTCOMES` (disposition.js:27) — run-outcome classifier consumed by `lights-out`'s non-zero-exit decision |
| `test/budget.test.mjs` | Node (node:test) | Existing `budget --selftest` pure-core table + `--now-ms`-injected CLI integration tests — the pattern this spec's acceptance sketch follows |

**Scope:** an additive `at_ceiling` disposition and an additive `budget.window` config block on the existing budget governor — not a new subsystem, not a rewrite of dollar mode.

## 2. OUT OF SCOPE (deferred, not this slice)

- **Per-backend attribution/ceilings.** No `backends.<name>.budget` dimension exists today (no model→backend map). Deferred behind the unbuilt **FAFF-604** telemetry adapter seam, which is where backend→spend attribution will live. This slice's window governor is **global** — one 5h window across the whole run, not per-engine.
- **The weekly window.** A weekly window spans many runs; each `lights-out`/beep-boop run gets a fresh run dir, so per-run-dir state cannot track a weekly ceiling across runs without a durable cross-run store that doesn't exist yet. Deferred until that store exists (candidate: a follow-up ticket once FAFF-604/cross-run persistence lands).
- **Vendor-quota introspection.** No API exists to read the vendor's real remaining 5h allowance; permanently out of scope for this governor (it is a proxy, by design principle above, not a mirror).
- **Request-count metering.** The ceiling is tokens-only, reusing existing token metering. No new request counter is introduced.

## 3. WHAT — Vocabulary, Types, Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Window | A rolling 5-hour interval, global to the run, with a configured token draw ceiling and an anchor/reset instant |
| Draw | faff's own metered token consumption within the current window (reuses `measureTokens`/`measureTokensByClass`) |
| Window anchor | The instant the current window opened — **the first draw recorded within it** (see ADR, `records/adr/`) |
| `park-until-window-reset` | New `at_ceiling` member: on breach, park the run with a recorded `resume_at`, never dispatch the next unit |
| `resume_at` | The window's reset instant (`anchor + 5h`) — the timestamp `lights-out --resume` (FAFF-527, Done) reads to know when re-entry is legitimate |

**Config surface — additive `budget.window` block** (sibling of the existing `budget.tokens`/`budget.cost`/`budget.max_attempts`/`budget.until`):

```yaml
budget:
  at_ceiling: park-until-window-reset   # joins the existing {stop, narrow, escalate} set
  window:
    hours: 5           # fixed at 5 for this slice (the vendor's 5h window); no weekly key yet
    tokens: 500000      # the window's own token ceiling — a SEPARATE ceiling from budget.tokens
```

`budget.window` is **independent of `budget.tokens`** (the existing all-run token backstop) — a run can carry both: `budget.tokens` as the long-run runaway backstop (unchanged), `budget.window.tokens` as the rolling 5h ceiling. Absent `budget.window` ⇒ no window dimension is ever resolved or checked, byte-for-byte today's behaviour (same additive-and-inert-when-absent posture as every other envelope dimension).

**`AT_CEILING_OUTCOMES`** (budget.js:117) gains a fourth member: `new Set(["stop", "narrow", "escalate", "park-until-window-reset"])`.

**`envelopeFrom` return shape gains, additively:**

```
{ ceilings: {until, max_attempts, tokens, cost}, at_ceiling, price_per_mtok_removed, price_per_mtok, pricing,
  window: { hours: number, tokens: number } | null }   // NEW — null when budget.window absent
```

**`computeBudgetState` return shape gains, additively (only populated on a window breach):**

```
{ spent, tokens_source, breached, outcome,
  resume_at: string(ISO-8601) | null }   // NEW — the window's reset epoch, present only when outcome === "park-until-window-reset"
```

**Window state — persisted where the existing L4 run-ledger already lives** (`ledger.budget.window`, sibling of the existing `ledger.budget.sessions`/`tokens_at_start_by_model_class` — the same store `budget check` already reads/writes each invocation, so this introduces no new persistence mechanism):

```
ledger.budget.window: {
  anchor_epoch: number,      // epoch-ms; set on the FIRST draw observed in the window
  reset_epoch: number,       // anchor_epoch + (window.hours * 3600 * 1000)
  tokens_at_anchor: number,  // the scalar token total AT the anchor instant — the window's own baseline (mirrors tokens_at_start's role for the all-run ceiling)
}
```

`computeBudgetState` stays pure (no I/O, no ledger read/write) — window-state read/write is `cmdBudget`'s job (the existing I/O boundary), exactly as ledger read/write for `tokens_at_start`/`sessions` already is.

**Terminal state.** `DELIVERY_PROFILE.terminal_states` (governance-profile.js:62) gains a new member: `"parked-window"` — parallel to the existing `"unreached-budget"`, so an admitted-but-not-dispatched-due-to-window-park issue carries a recognised terminal outcome and `runcheck`'s dangling check does not flag it. `disposition.js`'s `ATTENTION_OUTCOMES` (disposition.js:27) gains `"parked-window"` too, so a window-parked run still surfaces for human attention (parallel to how `"unreached-budget"`/`"parked"` do today) rather than silently reporting clean.

## 4. HOW — Behaviour

1. **`envelopeFrom`** reads `budget.window` (new, optional). When present and well-formed (`hours` and `tokens` both positive finite numbers), resolves `env.window = { hours, tokens }`; otherwise `env.window = null` (malformed → inert, mirroring `until_invalid`'s "never a silent vacuous ceiling that also never breaches" posture — a malformed window block simply resolves to no window dimension, exactly as an absent one does, and is not a hidden trap). `env.at_ceiling` accepts `"park-until-window-reset"` in the existing coerce-to-`"stop"`-on-unknown check (budget.js:334).
2. **`cmdBudget`** (the I/O boundary, budget.js:666) reads `ledger.budget.window` at each invocation (mirrors the existing `tokens_at_start`/`sessions` read at budget.js:747-769):
   - **No window state yet, or the persisted `reset_epoch` has passed** (`now_ms >= reset_epoch`) → this invocation's draw **opens a fresh window**: `anchor_epoch = now_ms`, `tokens_at_anchor = <the whole-session scalar total measured this invocation>`, `reset_epoch = anchor_epoch + hours*3600*1000`. Write this back to `ledger.budget.window` under the existing lock (`mutateLedgerUnderLock`, already used for ledger writes elsewhere in budget.js).
   - **Existing window state, not yet reset** → keep `anchor_epoch`/`reset_epoch`/`tokens_at_anchor` as persisted; this invocation's window draw = `max(0, <whole-session scalar total this invocation> - tokens_at_anchor)`.
3. **`computeBudgetState`** takes the resolved `env.window` + the computed window draw (passed in `spent.window_tokens`, additive sibling of `spent.tokens`) and, when `env.window != null`, adds `"window"` to `breached` if `window_tokens >= env.window.tokens`. Breach precedence with the existing dimensions is additive — `breached` can carry both `"tokens"` (the all-run backstop) and `"window"` in the same check; `outcome = env.at_ceiling` when `breached.length > 0`, unchanged rule. When the breach set includes `"window"` and `env.at_ceiling === "park-until-window-reset"`, the returned state additionally carries `resume_at: new Date(reset_epoch).toISOString()`.
4. **The orchestrator** (the `run-start`/`lights-out` dispatch loop that already reads `budget check`'s JSON before each dispatch) treats `outcome === "park-until-window-reset"` as a legitimate non-terminal hold: it does not dispatch the next unit, records the un-dispatched remainder's ledger outcome as `"parked-window"` (the new terminal state), and surfaces `resume_at` in the run summary — the same field shape `lights-out --resume` (FAFF-527, Done) already reads to decide when re-entry is legitimate.

**Window anchor rule (ADR-worthy — see Design Decision Rationale below):** the window rolls from the **first draw recorded within it**, not from run start and not from a fixed wall-clock cadence. This is the simplest defensible rule given faff cannot observe the vendor's real anchor instant, and it means a run that dispatches nothing draws nothing and never opens a window.

**Failure modes:**

- **The proxy diverges from the vendor's real 5h window.** faff's local ceiling and anchor are a faff-local guess; the vendor's true window may open/close at a materially different instant (the vendor anchors at the user's first request across ALL activity, not just faff's). How you'd know: the run parks with vendor quota to spare, or the vendor blocks before faff's local window would have breached. What it means: this is inherent to unobservability, not a bug — the ceiling is a human-tuned proxy (per the design principle above), and this divergence is explicitly accepted, not solved, by this slice.
- **A malformed `budget.window` block** (missing `hours`/`tokens`, non-numeric, ≤0) degrades to `env.window = null` — no window dimension is checked, and no crash. Same fail-open-on-malformed-config posture the envelope already applies to `until_invalid`/`price_per_mtok_removed`.

**Anti-pattern:** presenting the window ceiling or `resume_at` in any user-facing output as the vendor's actual quota/reset time. It is faff's own proxy estimate; conflating the two invites false trust.

## 5. SCENARIOS

```
Given a run under budget.window: { hours: 5, tokens: N } with at_ceiling: park-until-window-reset,
  and no prior window state in the ledger,
When the first unit dispatches and draws tokens,
Then `budget check` opens a window anchored at that draw's instant,
  recording anchor_epoch = now and reset_epoch = anchor_epoch + 5h.
```

```
Given an open window whose recorded draw is below its token ceiling,
When the next unit would dispatch,
Then `budget check` returns outcome: "none" (or another dimension's outcome, unaffected),
  the window's draw accumulates the new unit's tokens, and dispatch proceeds.
```

```
Given an open window whose accumulated draw reaches or exceeds its token ceiling,
When the next unit would dispatch,
Then `budget check` returns outcome: "park-until-window-reset" with a `resume_at`
  equal to the window's reset_epoch (ISO-8601),
  the run MUST NOT dispatch that unit,
  the undispatched remainder is recorded under the new "parked-window" terminal state,
  and `runcheck` MUST NOT flag it as dangling.
```

```
Given a window whose reset_epoch has passed (now >= reset_epoch),
When the next unit would dispatch and draws tokens,
Then `budget check` opens a FRESH window anchored at that draw's instant
  (a new anchor_epoch/reset_epoch/tokens_at_anchor, discarding the expired window's state),
  and dispatch is evaluated against the fresh window (not blocked by the expired one).
```

All four scenarios are **born-verifiable with deterministic fake-clock unit/integration tests** — the existing `--now-ms` hermetic clock seam (`resolveBudgetNow`, budget.js:650) and the existing `budget --selftest` pure-core table pattern (`computeBudgetState` unit cases) plus CLI integration tests with an injected ledger fixture and `--now-ms` (the pattern `test/budget.test.mjs` already uses, e.g. its `max_attempts=1` and transcript-sum integration tests) — no real wall-clock waits required anywhere.

## 6. DESIGN DECISION RATIONALE

**Global vs per-backend governor.**
- Options: (a) per-backend `budget:` under `backends.<name>` — matches the original ticket's framing, but the backend→spend attribution seam is FAFF-604 (unbuilt, itself blocked by FAFF-593); (b) a single global window governor — buildable now against existing machinery.
- **Chosen:** (b), a global 5h window across the whole run. Per-backend attribution is explicitly deferred behind FAFF-604 — this is the human's narrowing decision for this ticket (2026-07-24), not re-litigated here.

**Window persistence location.**
- Options: (a) the run dir (the original ticket's words — but a weekly window can't survive a fresh run dir); (b) `ledger.budget.window` in the existing L4 run-ledger (the same store `tokens_at_start`/`sessions` already live in, already lock-guarded, already read by every `budget check` invocation for THIS run).
- **Chosen:** (b), scoped to the 5h window only (in-run and short-lived enough that ledger-scoped persistence is sufficient — a 5h window realistically spans at most a few `lights-out --resume` re-entries within one ledger's lifetime). The weekly window's cross-run persistence question is explicitly deferred (Out of Scope §2) rather than answered here.

**Ceiling unit.**
- Options: (a) new request-count metering; (b) reuse existing token metering as the proxy unit.
- **Chosen:** (b) — tokens only, via the existing `measureTokens`/`measureTokensByClass`. No new metering primitive. This is the human's explicit narrowing instruction.

**Window anchor/reset rule.**
- Options: (a) anchor at first draw within the window (simplest, no new state needed at run start); (b) anchor at run start (couples the window to run lifecycle, which is orthogonal — a run with no dispatches yet shouldn't burn window time); (c) a fixed wall-clock cadence (requires knowing the vendor's real cadence, which is unobservable).
- **Chosen:** (a), first-draw anchoring. **This decision is recorded in a dedicated ADR** (`records/adr/`), not only in code comments, per the human's explicit instruction — because it is the one genuinely debatable design call in an otherwise mechanical slice, and future per-backend/weekly work will need to either inherit or deliberately diverge from this precedent.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none load-bearing for this narrowed slice — the four original punts are resolved above (§6) by the human's explicit narrowing decision, not re-opened.

**Assumes:**
- `**Assumes:** the existing ledger-lock (mutateLedgerUnderLock, used elsewhere in budget.js) is the correct guard for the new ledger.budget.window read-modify-write` — validated: it is the existing mechanism every other ledger.budget.* mutation in this file already uses; the build agent confirms the exact call shape at the write site.
- `**Assumes:** the orchestrator's dispatch loop (run-start/lights-out) already reads budget check's JSON before each dispatch and can gate on a new outcome value the same way it gates on the existing stop/narrow/escalate values` — validated: this is the existing `AT_CEILING_OUTCOMES` consumption pattern (FAFF-38/FAFF-225 contract cited in budget.js's header comment); the build agent confirms the exact call site.

## 8. DONE — Definition of Done

### From WHAT
- [ ] `AT_CEILING_OUTCOMES` includes `"park-until-window-reset"` (budget.js:117); an unknown `at_ceiling` value still coerces to `"stop"`, unchanged
- [ ] `envelopeFrom` resolves `budget.window: {hours, tokens}` into `env.window` (well-formed → object; absent/malformed → `null`, no crash); the existing dollar/attempts/until ceilings resolve byte-for-byte unchanged when `budget.window` is absent
- [ ] `computeBudgetState` accepts a window draw figure, adds `"window"` to `breached` on a ceiling reach, and returns `resume_at` (ISO-8601) only when the breach outcome is `"park-until-window-reset"`
- [ ] `DELIVERY_PROFILE.terminal_states` (governance-profile.js:62) gains `"parked-window"`; `disposition.js`'s `ATTENTION_OUTCOMES` gains it too

### From HOW
- [ ] `cmdBudget` opens a fresh window (anchor/reset/baseline) on the first draw when no window state exists, or when the persisted `reset_epoch` has passed
- [ ] `cmdBudget` accumulates window draw against the persisted anchor when the window is still open, and persists window state to `ledger.budget.window` under the existing lock
- [ ] A 5h window token-draw breach with `at_ceiling: park-until-window-reset` returns `outcome: "park-until-window-reset"` + a correct `resume_at`, and does not dispatch
- [ ] An expired window (`now >= reset_epoch`) reopens fresh on the next draw rather than staying stuck breached
- [ ] The parked remainder carries the `"parked-window"` terminal state; `runcheck` does not flag it dangling
- [ ] Dollar-mode / attempts / until selftest table (existing `budget --selftest`) unchanged, byte-for-byte
- [ ] An ADR is added recording the first-draw window-anchor decision (§6)

### Acceptance sketch (born-verifiable, deterministic — no wall-clock waits)
- [ ] Unit test (pure core): `computeBudgetState` with an injected window draw at/over ceiling + `at_ceiling: "park-until-window-reset"` → `outcome === "park-until-window-reset"`, `resume_at` present and equals the injected `reset_epoch` as ISO-8601
- [ ] Unit test: same, draw under ceiling → `outcome !== "park-until-window-reset"`, breached does not include `"window"`
- [ ] CLI integration test (fixture ledger + `--now-ms`, the `test/budget.test.mjs` pattern): first `budget check` invocation with no prior `ledger.budget.window` opens a window (`anchor_epoch === injected now`)
- [ ] CLI integration test: a second `budget check` invocation with `--now-ms` past the persisted `reset_epoch` opens a **fresh** window, discarding the expired one's baseline
- [ ] CLI integration test: `runcheck` on a ledger carrying a `"parked-window"` outcome for an admitted issue does not report it dangling

## Self-review findings

- **major → resolved:** the persistence-location punt (originally deferred to "human call") is closed here to `ledger.budget.window` — verified against the existing `mutateLedgerUnderLock` pattern and the existing `tokens_at_start`/`sessions` ledger fields, so it is not a fresh invention.
- **minor:** the exact orchestrator call site that reads `budget check`'s JSON and decides not to dispatch is described by reference to the existing `AT_CEILING_OUTCOMES` contract rather than a specific line number — the build agent locates the exact dispatch-loop site (candidates: `lights-out.js`, `run-start.js`) during implementation; this is an implementation-level detail, not a design gap.
- No blockers. All four original architecture/product punts are closed by the human's explicit narrowing decision (§6), each backed by a concrete, codebase-verified mechanism (existing ledger fields, existing lock, existing terminal-state vocabulary, existing hermetic clock seam).

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "assumes" }, { "marker": "assumes" }
  ] }
```
