# FAFF-305 — Lights-out banner: distinguish *reachable* from *enforced* guardrails

> Spec: faffter-dark-nlspec · 2026-06-30 · autonomous · confidence: high. Full spec on Linear FAFF-305.

This is the build spec for **FAFF-305** (Bug, High). Audience: the build agent implementing the fix, and the human reviewer of the L4 trust surface. It is buildable from this spec alone plus the named functions in `plugin/skills/faff/bin/faff`.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the lights-out banner conflates two different facts about a guardrail. *Reachable* means its CLI contract answers a `--selftest` probe (the wiring is intact). *Enforced* means some orchestrator step actually **invokes** that guardrail during the run. Today the banner only knows the first and prints it as "live", so a guardrail that is wired-but-never-called reads identically to one that genuinely fires. This fix adds the second fact and makes the banner state both.

**Problem statement.** The L4 preflight prints `ARMED — all 8 guardrails live`, where "live" is pure reachability; the `holdout` guardrail (and the env lane it depends on) is reachable but invoked by no orchestrator — `faffter-noon-evaluate` and `faffter-noon-env-compose` have no caller. An operator reads "all 8 live" as "all 8 are verifying my unattended run" and walks away, when one of the eight never fires — the safety-surface analogue of a disconnected smoke alarm reading "OK". This change makes the banner declare each guardrail's enforcement state alongside its reachability, so "live" is never bare.

**Design principles.**

**Fail-closed enforcement.** A guardrail counts as enforced only when its `enforced` flag is *exactly* `true` (strict `=== true`). Any other value — `undefined`, missing, truthy-but-not-`true` — is treated as **not enforced**. A new guardrail added without an explicit `enforced: true` is therefore reported as reachable-but-not-enforced by default, never silently counted as enforced. This mirrors the existing armed-state rule (a configured-but-unreachable contract is never silently `live`).

**Banner honesty only — no gating change.** `proceed` is computed exactly as today (every guardrail `live`, slots reachable, budget ceiling set, floor holds). Enforcement state is **reported, never gated on**. A reachable-but-not-enforced guardrail does **not** refuse the run — it would be a behavioural change to the L4 admission decision, which is explicitly out of scope. This fix changes only what the banner *says*, not what the runner *does*.

**Banner is 1:1 derivable from state.** The existing invariant — every guardrail id + its state appears in the banner, so a human can confirm the run without re-deriving config — is preserved and extended: every guardrail line now carries both its reachability state and its enforced flag.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `LIGHTS_OUT_GUARDRAILS` (~L10421) | Node (dependency-free) | The 8-guardrail table; gains a per-entry `enforced` flag |
| `lightsOutArmed(probes)` (~L10440) | Node | Pure armed-state derivation; the model for the new enforced derivation |
| `lightsOutPreflight(probes)` (~L10460) | Node | Returns `{proceed, refusals, armed, banner, floor}`; gains `enforced` |
| `renderLightsOutBanner(armed, floor, proceed, probes)` (~L10497) | Node | Per-guardrail lines + status line; gains the enforced qualifier |
| `cmdLightsOut(args)` (~L10530) | Node | Persists `ledger.armed` + `ledger.banner`; gains `ledger.enforced` |
| `lightsOutSelftest()` (~L10652) | Node | In-memory selftest; extended for the enforced map + banner wording |

**Scope.** A self-contained correction to the L4 lights-out trust surface inside the bundled `faff` CLI — the operator's walk-away signal. No new module structure, no new dependency.

## 2. OUT OF SCOPE

- **Wiring the env→evaluate chain** — actually invoking `faffter-noon-env-compose` + `faffter-noon-evaluate` from the autonomous loop so the holdout guardrail becomes genuinely enforced. *Why excluded:* that is the "L4 frontier — not built yet" (the orchestration that fires the holdout in the loop). This bug is narrowly the banner-honesty defect: the banner must stop overstating, regardless of when the chain lands. *Extension point:* when the chain ships, flip `holdout`'s entry to `enforced: true` in `LIGHTS_OUT_GUARDRAILS` — a one-line change, and the banner self-updates to `8/8 enforced`. Tracked by related FAFF-34 (evaluator harness), FAFF-303 (env mis-provision), FAFF-276 (sandboxed code-blind).
- **Refusing a run on under-enforcement** — gating `proceed` on enforcement rather than just reachability. *Why excluded:* changing the admission decision is a behavioural change, not a reporting fix; per the banner-honesty principle this fix leaves `proceed` untouched. *Extension point:* a future preflight rule could add an `enforcement` refusal class in `lightsOutPreflight`.
- **Per-run dynamic enforcement detection** — computing `enforced` from what *this* run actually invoked rather than from a static table. *Why excluded:* enforcement is a property of the orchestration wiring (which steps exist), not of a single run's data; a static table keyed to the shipped pipeline is correct and far simpler. *Extension point:* `lightsOutEnforced` could later take run-observed signals instead of the static flags.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Reachable | A guardrail's CLI contract answers its `--selftest` probe (exit 0). The existing armed-state `live`. |
| Enforced | Some orchestrator step actually invokes the guardrail during a run. New: the `enforced` flag. |
| Reachable-but-not-enforced | Wiring intact but never called this run (today: `holdout`). The state the banner must now surface. |

**Guardrail entry — gains one field.** Each `LIGHTS_OUT_GUARDRAILS` entry currently has `{id, contract, probe}`; add `enforced`:

```
RECORD Guardrail:
  id: String           # e.g. "holdout"
  contract: String     # label only — the CLI contract backing it
  probe: String | null # the --selftest subcommand (null ⇒ resolved from container verdict)
  enforced: Boolean    # NEW: true iff an orchestrator step invokes this guardrail in the loop

  # Values: admissibility, spec_review, terminating, budget, observability,
  #         kill_switch, container ⇒ enforced: true
  #         holdout ⇒ enforced: false (reachable, but no caller in any orchestrator)
```

**Enforced map — derived, fail-closed.** A pure derivation mirroring `lightsOutArmed`, keyed by guardrail id, value boolean, computed by strict equality:

```
FUNCTION lightsOutEnforced() -> { [id]: Boolean }:
  for each g in LIGHTS_OUT_GUARDRAILS:
    result[g.id] = (g.enforced === true)   # strict; anything else ⇒ false
  return result
```

It takes no probes — enforcement is a static property of the shipped pipeline, not of probe results. (Contrast `lightsOutArmed`, which is probe-derived.)

**Preflight result — gains `enforced`.** `lightsOutPreflight` returns `{ proceed, refusals, armed, enforced, banner, floor }`. `enforced` is the map above. `proceed` and `refusals` are computed **exactly as today** — `enforced` is carried for the banner and the ledger, and is never an input to the proceed decision.

**Ledger — gains `enforced`.** The persisted L4 run-ledger in `cmdLightsOut` records `enforced` alongside `armed` (so the persisted banner and the structured enforcement map agree, and a morning reader sees which guardrails actually fired).

**Design decision — derivation source.**
**Chosen:** Static per-entry `enforced` flag + strict `=== true` derivation — enforcement reflects which orchestrator steps exist (a property of the shipped wiring), so a static table is both correct and the simplest thing that fails closed. A dynamic "did this run invoke it" probe would be more precise but is unwarranted: the wiring is the same every run, and the dynamic path is the out-of-scope frontier.

## 4. HOW — Behavior

**Architecture.** Five touch points, all in `plugin/skills/faff/bin/faff`, all pure except the ledger write:

1. **`LIGHTS_OUT_GUARDRAILS`** — add `enforced: true` to all entries except `holdout` (`enforced: false`).
2. **`lightsOutEnforced()`** — new pure function deriving the `{id: boolean}` map via strict `=== true`.
3. **`lightsOutPreflight(probes)`** — call `lightsOutEnforced()`, add `enforced` to the returned object, pass it into `renderLightsOutBanner`. **Do not** touch the `refusals`/`proceed` computation.
4. **`renderLightsOutBanner(armed, floor, proceed, probes, enforced)`** — add the `enforced` parameter; qualify every guardrail line with both reachability and enforcement; rebuild the status line.
5. **`cmdLightsOut(args)`** — write `enforced: pf.enforced` into the ledger object.

**Banner — per-guardrail line.** Each line states the reachability state (as today, with its mark glyph) **and** the enforcement flag, so "live" is never printed bare:

```
PROCEDURE render_guardrail_line(g, armedState, isEnforced):
  1. mark = glyph(armedState)              # ● live / ◐ degraded / ○ absent (unchanged)
  2. enf  = isEnforced ? "enforced" : "reachable-only"
  3. emit: "    {mark} {g.id:pad14} reachable:{armedState:pad9} {enf:pad14} ({g.contract})"
```

The exact column layout is the implementer's call provided **both** the reachability state token and an enforcement token appear on every line; the load-bearing requirement is that no line shows a bare `live` without an accompanying enforcement token.

**Banner — status line.** Replace the hard-coded `all N guardrails live` with a count derived from the `enforced` map:

```
PROCEDURE render_status_line(proceed, armed, enforced):
  1. IF not proceed:
       emit existing REFUSED line  (unchanged — including the "(a guardrail is not live)" suffix)
       return
  2. total       = LIGHTS_OUT_GUARDRAILS.length            # 8
  3. enforcedN   = count of ids where enforced[id] === true
  4. notEnforced = [ id for id in guardrail order where enforced[id] !== true ]
  5. base = "ARMED — {enforcedN}/{total} enforced"
  6. IF notEnforced is non-empty:
       emit base + "; {notEnforced.length} reachable-but-not-enforced: {notEnforced joined ', '}"
     ELSE:
       emit base                                            # future: 8/8, no trailing clause
```

For today's table this yields exactly: `ARMED — 7/8 enforced; 1 reachable-but-not-enforced: holdout`. When `holdout` is later wired (`enforced: true`), it self-updates to `ARMED — 8/8 enforced` with no code change.

**Anti-pattern:** gating `proceed` on `enforcedN === total`. Why: that turns a reporting fix into a behavioural change to L4 admission — today's run would start refusing, which is out of scope and would break every existing proceed test.

**Anti-pattern:** deriving `enforced` with a loose check (`if (g.enforced)`) or defaulting a missing flag to enforced. Why: a future guardrail added without an explicit flag must read as *not* enforced (fail-closed); only strict `=== true` guarantees that.

**Edge cases.**
- **Missing/absent `enforced` flag** on an entry → strict `=== true` yields `false` → counted as not-enforced (fail-closed). No throw.
- **REFUSED path** (`proceed === false`) → status line is the existing REFUSED text, unchanged; per-guardrail lines still carry the enforcement token (the banner is rendered the same way regardless of proceed).
- **All enforced** (future) → `notEnforced` empty → status line omits the trailing clause.

**Failure modes.**
- **The failure:** the new `enforced` parameter is appended to `renderLightsOutBanner` but a caller (or the selftest) still invokes the 4-arg form, so `enforced` arrives `undefined` and every line renders `reachable-only` / the status line shows `0/8 enforced`. **How you'd know:** the selftest's `7/8 enforced` assertion fails, or the persisted banner shows `0/8`. **What it means:** proceed — fix the call site; it is a wiring slip, not a design fault. (Mitigated by updating all call sites + asserting the wording in the selftest.)
- **The failure:** `enforced` leaks into the proceed decision (e.g. a stray refusal pushed for a not-enforced guardrail). **How you'd know:** an existing happy-path proceed selftest flips to `proceed === false`, or the new "proceed unchanged when holdout not enforced" assertion fails. **What it means:** proceed — remove the coupling; `proceed` must be byte-identical to pre-change behaviour.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a fully-reachable, contained L4 preflight (every guardrail probe passes)
When the banner is rendered on the proceed path
Then the status line reads "ARMED — 7/8 enforced; 1 reachable-but-not-enforced: holdout"
 And no guardrail line shows a bare "live" without an enforcement token
```

```
Given the holdout guardrail is reachable (its probe passes) but enforced: false
When lightsOutPreflight runs with all preconditions met
Then proceed is true — identical to the pre-change happy path (enforcement does not gate)
 And the returned result includes an enforced map with enforced.holdout === false
 And enforced[id] === true for the other 7 guardrails
```

```
Given a guardrail entry whose enforced flag is missing or not strictly true
When lightsOutEnforced derives the map
Then that guardrail is reported as not enforced (fail-closed, strict === true)
```

```
Given a proceed-path L4 run is minted
When the run-ledger is persisted
Then the ledger carries an enforced map alongside armed, matching the banner
```

## 6. DESIGN DECISION RATIONALE

**How should `enforced` be sourced?**
- *Static per-entry flag (chosen)* — pro: enforcement is a property of which orchestrator steps exist, identical every run; simplest; fails closed with strict `===`. Con: must be hand-updated when the chain is wired (one line, and the out-of-scope ticket owns it).
- *Dynamic per-run detection* — pro: precise to what actually fired. Con: enforcement doesn't vary run-to-run; this is the out-of-scope frontier; far more code for no added correctness today.

**Chosen:** Static per-entry `enforced` flag, derived via strict `=== true` — correct for the fixed pipeline, minimal, fail-closed.

**Should enforcement affect `proceed`?**
- *Report only (chosen)* — pro: pure banner-honesty fix, zero behavioural change, no existing proceed test disturbed. Con: an operator could still proceed with holdout unenforced (but now they *see* it).
- *Gate proceed on enforcement* — pro: stronger. Con: out-of-scope behavioural change; would refuse today's runs.

**Chosen:** Report only — `proceed` is untouched; the banner tells the truth and the operator decides.

**Where does the enforced parameter go in `renderLightsOutBanner`?**
**Chosen:** Append `enforced` as a new trailing parameter and update all call sites — keeps the existing positional signature stable for the first four args and is the smallest diff.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the scope is fully closed.

**Assumptions.**
- **Assumes:** `holdout` is the only guardrail not invoked by an orchestrator step at the time of writing. *Validation:* confirm during build that `faffter-noon-evaluate` / `faffter-noon-env-compose` still have no caller in any orchestrator skill (grep the skills for an invocation), and that the other 7 guardrails' contracts are each invoked by an existing pipeline step. If a second guardrail is also unenforced, set its flag `false` too — the banner math and tests already generalise.

## 8. DONE — Definition of Done

### From WHY
- [ ] The banner never prints a bare `live` for a guardrail without an accompanying enforcement token.
- [ ] An operator can read, from the banner alone, that `holdout` is reachable but not enforced.

### From WHAT (types and interfaces)
- [ ] Every `LIGHTS_OUT_GUARDRAILS` entry has an explicit `enforced` boolean; `holdout` is `false`, the other 7 are `true`.
- [ ] `lightsOutEnforced()` returns a `{id: boolean}` map derived via strict `=== true`.
- [ ] `lightsOutPreflight` returns `enforced` in its result object.

### From HOW (behaviour)
- [ ] `proceed` / `refusals` are byte-for-byte unchanged from pre-change behaviour (no proceed selftest regresses).
- [ ] The proceed-path status line reads `ARMED — 7/8 enforced; 1 reachable-but-not-enforced: holdout`.
- [ ] The status line generalises: an all-enforced table yields `ARMED — 8/8 enforced` with no trailing clause.
- [ ] Each guardrail line carries both a reachability token and an enforcement token.
- [ ] The persisted L4 run-ledger records `enforced` alongside `armed`.

### From HOW (edge cases)
- [ ] A missing/non-`true` `enforced` flag is reported as not enforced (fail-closed).
- [ ] The REFUSED status line is unchanged.

### From the selftest
- [ ] `lightsOutSelftest` asserts: enforced map is 7/8; `holdout` is false; strict `=== true` (a non-boolean-truthy flag reads false); the proceed-path banner contains the `7/8 enforced; 1 reachable-but-not-enforced: holdout` wording; the ledger/result carries `enforced`.
- [ ] `node plugin/skills/faff/bin/faff lights-out --selftest` exits 0.

**Integration smoke test:**
```
1. Run: node plugin/skills/faff/bin/faff lights-out --selftest
2. Expect: exit 0, "lights-out --selftest: ok"
3. (manual, in-container) Run a real `lights-out --check`; confirm the banner status line
   shows "ARMED — 7/8 enforced; 1 reachable-but-not-enforced: holdout" and holdout's line
   shows reachable:live with a "reachable-only" enforcement token.
```
