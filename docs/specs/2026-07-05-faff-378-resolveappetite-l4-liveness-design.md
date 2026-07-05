# FAFF-378 — resolveAppetite honors the L4 pin only for a live run

> Spec: faffter-dark-nlspec · 2026-07-05 · autonomous · confidence: high. Full spec on Linear FAFF-378.

This spec addresses Linear issue FAFF-378 (from the FAFF-316 frontier audit, finding F6, MED): `resolveAppetite` grants `appetite: full` on any `level:"L4"` run ledger regardless of whether the run is still alive. Audience: the build agent implementing the fix, and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model:** faff already has one canonical answer to "is this run alive?" — `runIsHeld(ledger, nowMs, env)` (owner status `running` + heartbeat fresher than the staleness window), used by runcheck and sentry. This fix makes appetite resolution ask that same question instead of its current weaker one ("does the ledger say L4?"), so a dead run's ledger stops escalating agency.

**Problem statement:** `resolveAppetite` (the single appetite-resolution channel, FAFF-308) pins appetite to `full` whenever `FAFF_RUN_DIR` points at a ledger with `level:"L4"` — it never checks run liveness. A completed or abandoned L4 run's ledger carries `level:"L4"` forever, so a persisted `FAFF_RUN_DIR` (shell profile, `.env`, a CI step after the L4 job) makes every later session resolve `full` — including L1/L2 interactive work the operator never armed. The fix gates the pin on the run being live.

**Design principles:**

- **Staleness must only de-escalate agency, never escalate it.** An env-downgrade that fails safe is tolerable; a stale artifact that silently grants `full` is not. Any liveness doubt therefore falls through to config, never to `full`.
- **One liveness predicate.** Run-aliveness has a single canonical definition in this CLI (`runIsHeld`). Appetite resolution reuses it; it does not grow a private, weaker variant that drifts.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` `resolveAppetite` (~:373) | JavaScript (single-file CLI) | The bug site — the ledger brace at step 2 of its precedence chain |
| `plugin/skills/faff/bin/faff` `runIsHeld` (~:1138) | JavaScript | The canonical liveness predicate this fix adopts (heartbeat-only per FAFF-233) |
| `plugin/skills/faff/bin/faff` `cmdLightsOut` ledger mint (~:12735) | JavaScript | Mints `owner: { status: "running", …, last_heartbeat: nowIso }` — a freshly-minted run is held immediately |
| `test/appetite-resolution.test.mjs` | JavaScript (node --test, runCli seam per ADR 0002) | Existing 12-test coverage; its `mintLedger` fixture writes a running owner with NO `last_heartbeat` and must be extended |

**Scope statement:** a guard-tightening change to one function plus its test file; no schema, contract, or skill-prose changes.

## 2. OUT OF SCOPE

- **The `FAFF_APPETITE` env belt (precedence step 1)** — an explicit operator-set env token is a different channel from a stale artifact; a persisted `FAFF_APPETITE=full` is operator hygiene, not a faff forgery/staleness hazard of the same class. Extension point: the env-belt branch at the top of `resolveAppetite`.
- **Clearing `FAFF_RUN_DIR` at run end** — runner/shell hygiene, orthogonal to making the resolver robust against it persisting. Extension point: the run-completion path that flips `owner.status` off `running`.
- **runcheck / sentry / heartbeat liveness behaviour** — they already use `runIsHeld` or the status guard correctly; untouched.
- **A new ADR** — ADR-0037 (`docs/adr/0037-appetite-is-level-scoped-l4-forces-full.md`) already says "an **active**-L4 run ledger"; this fix implements the liveness half of the recorded intent. No decision changes.

## 3. WHAT — Interfaces

No new types, vocabulary, or surfaces. The observable contract of `faff config get appetite` changes in exactly one region of its input space:

- Before: `FAFF_RUN_DIR` → readable ledger with `level:"L4"` → `full`, unconditionally.
- After: `FAFF_RUN_DIR` → readable ledger with `level:"L4"` **and** `runIsHeld(ledger, Date.now(), env)` true → `full`; otherwise fall through to config → baked default.

All other precedence steps (env belt, non-L4 ledger, unreadable ledger, config, default) are byte-identical.

### Design decision — which liveness check gates the pin

Two candidates existed:

- **Status-only** (`ledger.owner && ledger.owner.status === "running"`), mirroring `applyHeartbeat`'s guard (~:1333). Closes the reported done/abandoned-ledger hazard, but a crashed owner leaves `status:"running"` forever with a stale heartbeat — exactly the abandonment case heartbeat staleness exists to catch — and that ledger would still grant `full` indefinitely.
- **Full `runIsHeld`** (status `running` + heartbeat fresher than `FAFF_RUN_HEARTBEAT_STALE_SECS`, default 900s). Strictly fail-safe here — staleness can only de-escalate agency — and gives real parity with runcheck/sentry. Mid-run flap risk (a slow build starving the heartbeat past the window) is mitigated twice over: `faff heartbeat` (FAFF-234) exists precisely to keep long sub-steps held and beep-boop orchestrators tick it between steps, and the lights-out handoff also exports the `FAFF_APPETITE=full` env belt, which resolves at precedence step 1 without touching the ledger. A flap that does slip both nets downgrades appetite toward config — the safe direction.

**Chosen:** full `runIsHeld` — status-only would leave the crashed-owner ledger granting `full` forever, which is the same hazard class the issue reports; `runIsHeld` is the project's canonical liveness answer and fails safe in the only direction that matters here.

### Design decision — reuse `runIsHeld` or inline a copy

`runIsHeld` is declared later in the file than `resolveAppetite`; function declarations hoist, so a direct call is safe in this single-file CLI (no reordering needed). Inlining a private copy would duplicate the staleness contract and drift.

**Chosen:** call `runIsHeld(ledger, Date.now(), env)` directly, passing the `env` parameter `resolveAppetite` already receives so `FAFF_RUN_HEARTBEAT_STALE_SECS` is read from the caller's env (matters for the child-process test seam).

## 4. HOW — Behavior

The ledger brace (step 2 of the precedence chain) gains one condition:

```
PROCEDURE resolveAppetite step 2 (ledger brace):
  1. runDir = env.FAFF_RUN_DIR; if absent → step 3 (config)
  2. TRY read ledger from runDir; on failure → step 3 (unchanged: never fabricate full)
  3. IF ledger.level == "L4" AND runIsHeld(ledger, now, env) → return "full"
  4. OTHERWISE → step 3 (config → baked default)
```

`runIsHeld` already encodes every edge case, all falling through to config (the safe direction):

- `owner` absent (legacy/unowned ledger) → not held
- `owner.status !== "running"` (done / aborted) → not held
- `last_heartbeat` missing or unparseable → not held
- heartbeat older than `FAFF_RUN_HEARTBEAT_STALE_SECS` (default 900s via `heartbeatStaleSecs(env)`) → not held

**Comment honesty:** the precedence comment block above `resolveAppetite` (~:361-370) documents the chain as "active-L4 ledger". Update its wording so "active" is explicitly "live per `runIsHeld` (running owner + fresh heartbeat)" — the comment must not continue to imply the level alone pins.

**Anti-pattern:** consulting `owner.pid` as a liveness corroborator. Why: FAFF-233 removed pid checks from `runIsHeld` deliberately (worker pids roll between issues); reintroducing one here would wrongly flip live runs to not-held.

**Failure mode — mid-run heartbeat starvation.** The risk in choosing `runIsHeld` over status-only: a live L4 run whose heartbeat goes stale mid-step downgrades appetite for ledger-brace readers until the next tick. How you'd know: a beep-boop step inside an armed L4 run resolves a non-`full` appetite (visible in run logs / punt-handling behaviour). What it means: proceed — the env belt covers the handoff shells, `faff heartbeat` discipline covers long steps, and the downgrade direction is the fail-safe one; if it recurs in practice, that is heartbeat-discipline debt (FAFF-234 usage), not a reason to weaken this predicate.

### Tests (`test/appetite-resolution.test.mjs`)

The `mintLedger` fixture currently writes `owner: { status: "running" }` with no `last_heartbeat` — under the fix that ledger is *not held*, so the existing L4-pin tests (resolve `full`, `--json` prints `"full"`) would break. Fix the fixture, then add the new cases:

- **Fixture:** `mintLedger(level, owner?)` writes a fresh `last_heartbeat` (now ISO) on the default running owner; an explicit `owner` argument overrides the whole owner block (including `owner: null` to omit it).
- **Existing tests:** unchanged in assertion; they now exercise the live-run path via the extended fixture.
- **New tests (each expecting config appetite, not `full`, except the last):**
  1. L4 ledger, `owner.status: "done"`, fresh heartbeat → resolves config appetite (the issue's headline case)
  2. L4 ledger, `owner.status: "running"`, stale heartbeat (older than the window; pin the window small via `FAFF_RUN_HEARTBEAT_STALE_SECS` in the child env to keep the test fast and deterministic) → resolves config appetite
  3. L4 ledger, no `owner` at all → resolves config appetite
  4. L4 ledger, running owner, fresh heartbeat → still resolves `full` (explicit live-path regression guard, not just via the reused fixture)

## 5. Scenarios

```
Given a finished L4 run whose ledger has level:"L4" and owner.status:"done"
  and FAFF_RUN_DIR still pointing at that run dir
When any later session runs `faff config get appetite` with config appetite: low
Then it resolves "low" (config), not "full"
```

```
Given an abandoned L4 run whose ledger has owner.status:"running" but a heartbeat older than the staleness window
When `faff config get appetite` resolves
Then it falls through to config — the crashed-owner ledger no longer grants full
```

```
Given an armed, live L4 run (running owner, fresh heartbeat)
When `faff config get appetite` resolves via the FAFF_RUN_DIR ledger brace
Then it still resolves "full" — the L4 pin is unchanged for the run it was minted for
```

## 6. Design decision rationale

**Which liveness predicate gates the L4 pin?** Options: status-only (closes the reported case, leaves crashed-owner ledgers granting `full` forever) vs full `runIsHeld` (parity with runcheck/sentry, staleness only de-escalates, small mid-run flap risk covered by the env belt + heartbeat discipline). **Chosen:** full `runIsHeld` — rationale in the WHAT section; the deciding fact is that status-only reproduces the reported hazard class for the crash/abandon case.

**Reuse or inline the predicate?** Options: call `runIsHeld` (hoisted, single source of truth) vs inline copy (no forward reference, but drifts). **Chosen:** call `runIsHeld` directly with the resolver's `env` passed through.

**Fixture strategy for the existing test file?** Options: extend `mintLedger` with a default fresh heartbeat + owner override (existing tests keep their assertions) vs write bespoke ledgers per new test (duplicates JSON shapes). **Chosen:** extend `mintLedger` — the existing L4-pin tests then double as live-path coverage, and the override parameter serves every new case.

## 7. Open questions and assumptions

None — all decisions are closed, and every dependency (predicate, fixture, mint-time heartbeat, comment block) was verified in-repo. No `**Punt:**` or `**Assumes:**` items.

## 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] `resolveAppetite` returns `full` via the ledger brace only when `ledger.level === "L4"` AND `runIsHeld(ledger, Date.now(), env)` is true; every other ledger state falls through to config → baked default
- [ ] All non-ledger precedence steps (env belt, config, baked default, non-L4 ledger, unreadable ledger) behave byte-identically to before

### From HOW
- [ ] The precedence comment block above `resolveAppetite` states the liveness condition (running owner + fresh heartbeat), not bare "active-L4 ledger"
- [ ] No `owner.pid` consultation introduced (heartbeat-only per the existing predicate)

### From HOW (tests)
- [ ] `mintLedger` fixture writes a fresh `last_heartbeat` by default and accepts an owner override
- [ ] All 12 existing tests in `test/appetite-resolution.test.mjs` pass unmodified in assertion
- [ ] New test: done-owner L4 ledger → resolves config appetite
- [ ] New test: stale-heartbeat running-owner L4 ledger (window pinned via `FAFF_RUN_HEARTBEAT_STALE_SECS` in the child env) → resolves config appetite
- [ ] New test: ownerless L4 ledger → resolves config appetite
- [ ] New test: live L4 ledger (running + fresh heartbeat) → still resolves `full`
- [ ] `node --test` green apart from the 3 known pre-existing failures on main in this environment

**Integration smoke test:**

```
1. Mint a temp repo root (config appetite: low) and a temp run dir with a done-owner L4 ledger
2. Run `faff config get appetite` with FAFF_RUN_DIR pointing at it (FAFF_APPETITE unset)
3. Expect stdout "low" — the stale L4 ledger no longer escalates
```

confidence: high
spec-review: approve
