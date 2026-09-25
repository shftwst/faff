# Spec — FAFF-1116: Capture SUT-standability in the run ledger; redirect the merge floor to read it

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1116.

This is the build-ready spec for FAFF-1116. Audience: the build agent implementing the change, and the human reviewers who gate it. It covers one cohesive change that ships together: record the single fact "could a system-under-test stand?" in the run ledger at the moment it becomes known, and redirect the FAFF-1040 merge floor to read that recorded fact instead of inferring it from a merge-time artifact proxy, without moving any verdict.

## 1. WHY — Problem and Principles

**The load-bearing model.** The FAFF-1040 merge floor decides whether to enforce the code-blind holdout by resolving two capability facts at merge time: "could a SUT stand and be judged?" (`can_run`) and "was the evaluator caged?" (`caged`). Today `can_run` is *inferred* from the presence, freshness, and readability of `<run-dir>/<issue>/holdout.json`, because the fact that actually settles standability, the env-handle, is an in-band contract block the env slot emits and never a run-dir artifact (ADR-0131). This ticket records standability directly in the run ledger the instant the env stands or fails to stand, and points the floor at that record. It changes the *source* of the standability fact, not the decision the floor makes.

**Problem statement.** The env-handle proves standability at stand time but is gone by merge time, so the floor guesses standability from a lossy holdout.json proxy that cannot tell "no SUT could stand" from "a SUT stood but its verdict went missing." The floor has no durable, auditable record of standability at the point it decides. This change captures `sut_env_stood` in the ledger at stand time and reads it at merge, leaving every FAFF-1040 verdict unchanged.

**Design principles.**

**Posture preservation is the binding constraint.** No legitimate run may change its merge verdict as a result of this change. The capture swaps the fact source; it never rewrites the FAFF-1040 decision. Any mapping that would newly block a run that passes through today, or newly pass a run that blocks today, is wrong by definition.

**Fail-safe on every unknown.** A missing, unreadable, or uncaptured value must degrade to today's live behaviour, never to a silent pass. Absence of the captured fact is not evidence of standability.

**Trusted-side write authority is a write policy, not the read's security guarantee.** The run ledger is Evidence class, so under a dispatch cut the trusted side owns this write and a dispatched build or evaluator lane must never author its own gate evidence as final authority (interactive top-level graft, the operator's own process with no cut above it, writes directly). But this is a policy about who *should* write, not a mechanism that makes the merge-time *read* safe: FAFF-690 (merge-gate.js:329) is explicit that the live `run-ledger.json` is build-lane-writable, which is exactly why it reads `level` from the committed anchor instead. This change does not claim the live ledger is write-isolated. The safety of the live `sut_env_stood` read rests entirely on two merge-side guards — the contradiction guard (D7) and the pre-existing absent-verdict dominance — analysed in the failure modes below; the write policy is defence-in-depth that reduces the opportunity for a forge, never the thing that makes a forge harmless.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node/JS | `readCanRun` (737-754), `resolveHoldoutLeg` (782-787), the forward-pointer comment (774-779) naming this follow-up, the FAFF-690 anchor-level read (327-382) |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node/JS | `resolveHoldoutPosture` (2294-2305), pure and downstream, consumes the three-way unchanged |
| `plugin/skills/faff/bin/lib/heartbeat.js` | Node/JS | `mutateLedgerUnderLock` (316-351), the locked-write helper with the LEVEL_WRITE_ONCE guard |
| `plugin/skills/faff/bin/lib/run-ledger.js` | Node/JS | ledger builders (98-144), `record-outcome`'s locked-write pattern (544-550) |
| `plugin/skills/faff/bin/lib/governance-check.js` | Node/JS | `evaluateMergeFloorLeg` (137-146), imports and calls the same `resolveHoldoutLeg`, inherits the redirect for free |
| `plugin/skills/faff-beep-boop/SKILL.md` | Prose skill | `holdout_step` definition (344-353), where standability is resolved |
| `plugin/skills/faff-graft/SKILL.md` | Prose skill | Step 9b anchor (line 160), Step 10 holdout gate (605-611), the per-issue call site |

**Scope statement.** This sits at the seam between the L4 holdout evaluation (which knows standability) and the merge floor (which currently guesses it); it is the follow-up the FAFF-1040 forward-pointer comment explicitly names.

## 2. OUT OF SCOPE

- **Standing a code-artifact SUT (a CLI, a library, a pure-logic or prose change).** Why excluded: `sut_env_stood` records only what the env-handle asserts, and the env-handle model is **service-shaped** — a `ready` env requires a non-empty `endpoint` and ≥1 passing `health_check`, and the evaluator drives the feature against that endpoint. A code artifact has no such endpoint, so it never reaches a conforming `ready` handle; `sut_env_stood` resolves `false`/absent and the holdout leg is pass-through (no gate). This fact is therefore load-bearing only for the http-service subset of SUTs; for the code/prose work faff mostly builds, it is honestly absent. Making a code artifact standable (a non-service exercisable handle, or a run-the-CLI/import-the-lib exercise mode) is an env-slot / evaluator concern (FAFF-30 / FAFF-34 / FAFF-384), not this ticket. Extension point: the `env` slot and the `env-handle` contract shape.

- **The other three FAFF-1101 capabilities (`caged`, `code_blind`, `born_verifiable`).** Why excluded: the FAFF-1101 spec review found them redundant. `caged` is readable live from `lane-boundary.json` (`readCaged`, merge-gate.js:761), `code_blind` already lives in `holdout.json` and no floor reader consults it from the ledger, and `born_verifiable` is derivable from `dod classify` at merge time. Extension point: if a future floor reader genuinely needs one of them earlier than its live source can supply it, add another key under the same `capabilities[issue]` map introduced here.

- **Closing the "SUT stood but verdict missing" silent-pass hole.** Why excluded: mapping `sut_env_stood: true` with an absent verdict to a block would change a verdict for a run that legitimately passes through today (an evaluator that crashed after the env stood). That is a posture change this ticket forbids. Extension point: a future ticket may deliberately decide to tighten `true` + verdict-ENOENT to `faulted`; the mapping in `resolveCanRun` (section 4) is the single place that decision lives.

- **Changing what the anchor ledger carries at Step 9b.** Why excluded: standability is not known until Step 10, after the anchor is frozen, so it cannot and must not be anchored. Extension point: none needed; the read is deliberately live (see decision D5).

- **A formal JSON schema or `additionalProperties: false` for the run ledger.** Why excluded: the ledger has no formal schema today and additive fields are already safe; introducing one is a separate concern. Extension point: `run-ledger.js` builders.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `sut_env_stood` | A boolean fact: at stand time, did a running, health-checked env for the system under build come up? True when the env-handle asserts ready with an endpoint, health-checks, and a teardown_ref; false when the env could not stand or there was nothing to stand for. (Named `sut_standable` in the ticket text; renamed here to front the **env-stand event** — a code artifact is also a SUT, so "SUT" does not discriminate; the fact is specifically whether a service **env stood** this run, and it is an observed past fact, not a capability.) |
| standability arm | The part of the live `readCanRun` three-way that answers "could a SUT stand?" (the `absent` result on ENOENT). This ticket replaces its *source*. |
| verdict-freshness arm | The part of the live `readCanRun` three-way that answers "is the produced verdict fresh and readable?" (`satisfied` vs `faulted`). This ticket leaves it live. |
| dispatch cut | The isolation boundary under an L4 caged run separating the trusted orchestrator/spawner side from the dispatched build and evaluator lanes. |

**New ledger field.**

```
RECORD RunLedger:                       # additive; no existing reader affected
  ...existing keys unchanged...
  capabilities: Map<IssueId, IssueCapabilities>   # OPTIONAL; absent on older runs and pre-capture
                                                   # mint. Per-issue keyed map, mirrors outcomes[issue].

RECORD IssueCapabilities:
  sut_env_stood: Boolean              # the ONLY key this ticket writes
                                      # true  = env stood, health-checked, judgeable
                                      # false = env failed to stand / nothing to stand for
```

The field is additive: there is no `additionalProperties: false` and no schema rejection, and the only consumers of the ledger today (`runcheck`, the Stop hook) read `admitted`/`outcomes`/`owner`/`budget` only. `capabilities` is safe to add.

**Capture write interface.** No new binary. The write reuses `mutateLedgerUnderLock(runDir, mutate, expectedOwner)` (heartbeat.js:316) exactly as `record-outcome` does (run-ledger.js:544), with a `mutate` that merges `capabilities[issue].sut_env_stood` and OMITS `level` so it re-inherits the launch value rather than tripping LEVEL_WRITE_ONCE (heartbeat.js:339-347).

```
PROCEDURE capture_sut_env_stood(runDir, issue, standable, expectedOwner):
  mutateLedgerUnderLock(runDir, (fresh) => {
    IF fresh is null OR not an object: RETURN null        # vanished/malformed → abort, no write
    fresh.capabilities = fresh.capabilities OR {}
    fresh.capabilities[issue] = { ...fresh.capabilities[issue], sut_env_stood: standable }
    RETURN fresh                                          # note: no `level` key set → re-inherited
  }, expectedOwner)
```

**Redirect interface.** A new pure-ish resolver `resolveCanRun(runDir, issue)` in merge-gate.js replaces the direct `readCanRun` call inside `resolveHoldoutLeg` (merge-gate.js:783). It reads the ledger first, maps `sut_env_stood` to the three-way per section 4, and falls back to the existing live `readCanRun` when no captured value is available. Signature and return domain are identical to `readCanRun` (`"satisfied" | "absent" | "faulted"`), so `resolveHoldoutPosture` consumes it unchanged and `governance-check`'s `evaluateMergeFloorLeg` inherits the redirect with no edit.

## 4. HOW — Behavior

**Architecture.** Two touch points and one guaranteed-inherited third:

```
  stand time (holdout_step, trusted side)          merge time (merge-gate)
  ---------------------------------------          ------------------------------------
  env-handle asserted ready?                        resolveHoldoutLeg(runDir, issue)
    yes → capture sut_env_stood = true                caps.can_run = resolveCanRun(...)   <- redirect
    no  → capture sut_env_stood = false                          |
         (write via mutateLedgerUnderLock,           caps.caged  = readCaged(...)         <- unchanged
          OMITTING level)                            resolveHoldoutPosture(caps)          <- pure, unchanged
                                                     |
                                                     governance-check.evaluateMergeFloorLeg
                                                       calls the SAME resolveHoldoutLeg   <- inherits redirect
```

**The capture write (stand time).**

Behaviour summary: the instant `holdout_step` learns whether a SUT stood, it records that one boolean under the run-ledger lock, from the trusted side only.

```
PROCEDURE resolve_and_capture_standability(spec, key, runDir):   # inside holdout_step
  1. IF `faff dod classify` reports zero born-verifiable criteria (the short-circuit,
     graft Step 10): standable := false                          # nothing to stand for
  2. ELSE provision env, assert env-handle, pipe to `faff contract env-handle`:
     a. exit 0 (ready + endpoint + health-checks + teardown_ref) → standable := true
     b. non-zero, provisioning error, or no architecture proposal → standable := false
  3. capture_sut_env_stood(runDir, key, standable, expectedOwner)  # trusted-side write
```

The value is resolved and written on the trusted orchestrator side at both call sites: the per-run beep-boop phase and the per-issue graft Step 10 (graft runs `holdout_step` above the cut and spawns the caged evaluator below it). The dispatched build lane and the caged evaluator never author this field.

**The redirect mapping (merge time). This is the crux.**

Behaviour summary: the captured fact replaces only the "could a SUT stand?" inference; the verdict's own freshness and readability still come from the live artifact read.

```
FUNCTION resolveCanRun(runDir, issue) -> "satisfied" | "absent" | "faulted":
  standable := read_ledger_sut_env_stood(runDir, issue)   # try/catch; any read/parse error → UNKNOWN

  IF standable is UNKNOWN (field absent, no ledger, unreadable, or malformed):
     RETURN readCanRun(runDir, issue)                      # FALLBACK: exact live behaviour (D6)

  IF standable is false:
     live := readCanRun(runDir, issue)
     RETURN live == "absent" ? "absent" : "faulted"        # stand-failed → absent (crux);
                                                            # any verdict present is a contradiction → fail-safe (D7)

  IF standable is true:
     RETURN readCanRun(runDir, issue)                       # defer freshness/readability to the live read (D4)
                                                            # true+fresh→satisfied; true+stale/bad→faulted;
                                                            # true+ENOENT→absent (hole preserved, D8)
```

`read_ledger_sut_env_stood` wraps its `readFileSync`/`JSON.parse` in try/catch and returns UNKNOWN on any failure, so `resolveCanRun` never throws, preserving `resolveHoldoutLeg`'s "never throws" contract. It reads the *live* `<run-dir>/run-ledger.json`, not the anchor (D5).

**Posture-equivalence table.** `resolveHoldoutPosture` is **fault-first** (contract-defs.js:2297-2299): a `faulted` `can_run` forces `strict` regardless of `caged`; an `absent` `can_run` yields `pass-through` only when `caged` is not itself faulted. So `can_run` influences the verdict under **both** `caged` states, not only `caged == satisfied`. Both columns are shown below so the proof is complete. `resolveCanRun`'s three-way is identical in both (it is independent of `caged`); the two columns differ only in how `resolveHoldoutPosture` folds that three-way with `caged`.

| World state | `sut_env_stood` | live holdout.json | `resolveCanRun` | posture, `caged==satisfied` | today, `caged==satisfied` | posture, `caged==absent` | today, `caged==absent` | verdict change |
|---|---|---|---|---|---|---|---|---|
| env failed to stand | false | ENOENT | absent | pass-through | pass-through | pass-through | pass-through | none |
| zero born-verifiable | false | ENOENT | absent | pass-through | pass-through | pass-through | pass-through | none |
| stood, fresh verdict | true | fresh, readable | satisfied | strict, judged | strict, judged | pass-through (no cage) | pass-through | none |
| stood, verdict missing | true | ENOENT | absent | pass-through | pass-through | pass-through | pass-through | none (hole preserved) |
| stood, verdict stale/bad | true | present, stale/malformed | faulted | strict, fail-safe | strict, fail-safe | strict (fault-first) | strict (fault-first) | none |
| older/uncaptured run | field absent | any | = `readCanRun` | = today | = today | = today | = today | none |
| contradiction: not-stood yet a fresh verdict exists | false | fresh, readable | faulted | strict, fail-safe | (cannot occur legitimately) | strict (fault-first) | pass-through | fail-safe only |

Every LEGITIMATE world state (rows 1-6) yields the same posture as today in **both** `caged` columns. The only deviation from the live proxy is the last row, the illegitimate contradiction, and only toward `strict` (fail-safe): under `caged==satisfied` today's state cannot occur legitimately, and under `caged==absent` the redirect gives `strict` where today would give `pass-through`. A `false` capture means `holdout_step` returned before writing any verdict, so a fresh readable verdict alongside a `false` cannot arise from a legitimate stand-failure; it changes no real run's verdict and serves as the merge-side backstop for a forged-`false` write.

**Failure modes.**

- **The failure: a run-ledger writer forges `sut_env_stood: false` to dodge a failing holdout.** FAFF-690 (merge-gate.js:329) establishes that the live `run-ledger.json` is build-lane-writable, so the floor must not rest a security decision on trusting it. **How you'd know:** a caged run whose live `holdout.json` is a fresh, readable non-`meets-spec` verdict, yet the floor passed it through. **What it means:** proceed; the forge splits into two cases that are each already safe, and the LOAD-BEARING guard is the contradiction guard, not the write policy. (a) Forge `false` while the failing `holdout.json` is still present and fresh: the contradiction guard (D7) returns `faulted` → `strict` (fault-first, so it bites under both `caged` states), the verdict is read, the merge is blocked. This is the new protection this design adds. (b) Forge `false` and also delete `holdout.json`: `resolveCanRun` returns `absent` → pass-through, but that is byte-identical to today's escape, because a writer who can rewrite `run-ledger.json` can already delete `holdout.json` (both live in the same build-lane-writable run dir), yielding today's `readCanRun` ENOENT → `absent`. No new regression. The Evidence-class trusted-side write policy is defence-in-depth that narrows the opportunity, never the guarantee.

- **The failure: the capture is verdict-preserving to the point of being a behavioural no-op, so the ticket delivers nothing.** **How you'd know:** the selftests show identical postures for the captured and live paths in every legitimate row. **What it means:** proceed; this is the intended outcome. The value is a durable, auditable standability record at the decision point, decoupling the standability dimension from the lossy holdout.json proxy, plus the seam the forward-pointer comment names for future hardening. "Never the DECISION" is the ticket's goal, not a defect.

- **The failure: the live ledger read at merge time trusts a field FAFF-690 reads from the committed anchor precisely because the live ledger is build-lane-writable.** **How you'd know:** review flags that `level` is anchor-read but `sut_env_stood` is live-read. **What it means:** proceed; the asymmetry is principled (D5), but its safety does NOT rest on write-isolation. `sut_env_stood` is unknown until Step 10, after the Step-9b anchor is frozen, so it cannot be anchored and must be read live. The live read is made safe at the merge side: (a) the contradiction guard (D7) blocks a forged `false` that keeps a fresh failing verdict, and (b) a forged `false` that also deletes the verdict is byte-identical to today's already-present verdict-deletion escape (previous bullet). `resolveHoldoutPosture` is fault-first (fault before absent), so a `faulted` result forces `strict` irrespective of `caged` — the contradiction guard therefore bites in both the caged and non-caged cases, not only when `caged == satisfied`.

**Anti-pattern:** mapping `sut_env_stood: false` to `faulted`/strict. Why: a stand failure passes through today, so blocking it is a real, forbidden posture change (this is what FAFF-1101 got wrong).

**Anti-pattern:** setting `level` in the capture mutation. Why: `mutateLedgerUnderLock` throws `LEVEL_WRITE_ONCE` on any mutation that changes `level`; the mutation must OMIT it so the launch value is re-inherited.

**Anti-pattern:** editing `governance-check.js`'s holdout leg to read the ledger separately. Why: it already calls the shared `resolveHoldoutLeg`; a second reader risks a four-way divergence between the live floor and the gating mirror. The single-source redirect is the consistency guarantee.

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a caged run whose env failed to stand, with sut_env_stood: false captured and no holdout.json
When the merge floor resolves the holdout leg
Then resolveCanRun returns "absent", the posture is pass-through, and the merge is NOT blocked on the holdout leg
```

```
Given a caged run with sut_env_stood: true captured and a fresh, readable, non-meets-spec holdout.json
When the merge floor resolves the holdout leg
Then resolveCanRun returns "satisfied", the posture is strict, and the failing verdict blocks the merge
```

- The capture write MUST leave `outcomes`, `admitted`, `owner`, `budget`, and `level` unchanged (the mutation omits `level`; it must not trip LEVEL_WRITE_ONCE).
- `governance-check`'s `evaluateMergeFloorLeg` MUST return the same holdout posture as the live merge floor for every captured and uncaptured case (single-source redirect, no four-way divergence).

## 6. Design Decision Rationale

**D1 — What to capture.** Options: the four FAFF-1101 keys, versus `sut_env_stood` only. The FAFF-1101 review showed three of four are redundant (live-readable or unconsulted from the ledger). **Chosen:** capture `sut_env_stood` only. Rationale: it is the one fact with no run-dir artifact source at merge time; the others have live sources.

**D2 — Where the capture write lives, and who may write it.** Options: write from the env slot, the evaluator, or `holdout_step`; write from the build lane or the trusted side. **Chosen:** write inside `holdout_step` from the trusted orchestrator side (per-run beep-boop phase; per-issue graft Step 10 above the cut), never from a dispatched build or evaluator lane, using `mutateLedgerUnderLock` with `expectedOwner`. Rationale: standability is resolved there (env-handle assert / zero-born-verifiable short-circuit), it is beside where `holdout.json` is already written, and the Evidence-class rule requires the trusted side to own the write.

**D3 — Ledger home.** Options: a top-level field, a four-key block, or a per-issue map. **Chosen:** a per-issue `capabilities[issue] = { sut_env_stood }` map, additive, written under the same lock. Rationale: mirrors the only existing per-issue keyed map (`outcomes[issue]`); additive fields are safe (no schema, no `additionalProperties: false`, no reader breaks).

**D4 — What `sut_env_stood: true` maps to.** Options: (a) `true` → `satisfied` directly; (b) `true` → defer to the live verdict-freshness read. Option (a) would flip `true` + missing/stale verdict to strict, changing verdicts. **Chosen:** (b), the captured fact gates only the standability arm; the verdict-freshness arm stays live. Rationale: standability and verdict freshness are separate facts; only the former has no merge-time source, so only the former is replaced.

**D5 — Read from the live ledger, not the anchor.** Options: read the FAFF-690 committed anchor (as `level` is read) versus the live `run-ledger.json`. The anchor is frozen at Step 9b, before standability is known at Step 10, so it cannot carry the fact. **Chosen:** read the live ledger. Rationale: the fact does not exist at anchor time (Step 10 postdates the Step-9b anchor freeze), so it cannot be anchored and must be read live. FAFF-690 reads `level` from the committed anchor *because* the live ledger is build-lane-writable; this change does **not** claim the live ledger is write-isolated, and does not rely on it being so. Instead the live read is made safe at the merge side by two guards that hold even against a writable ledger: the contradiction guard (D7), which blocks a forged `false` that retains a fresh failing verdict, and the pre-existing absent-verdict dominance (a writer who can rewrite the ledger can already delete the verdict today, so a forged `false` that deletes it is no new escape). The fail-safe fallback (D6) covers the uncaptured case. If a mechanism to anchor post-build facts is later added, this decision can be revisited.

**D6 — Fallback when no value is captured.** Options: pass-through on absence, versus fall back to the live read. Pass-through on absence would silently pass older or uncaptured runs. **Chosen:** fall back to the existing live `readCanRun`. Rationale: fail-safe and back-compatible; an uncaptured run behaves exactly as today, including the already-merged retrospective floor path, which reads the same proxy when no live ledger field is available.

**D7 — Contradiction guard.** Options: honour a captured `false` unconditionally, versus fail-safe when `false` coexists with a fresh readable verdict. **Chosen:** `false` + a fresh readable verdict → `faulted` → strict. Rationale: the combination cannot arise from a legitimate stand-failure (a false means `holdout_step` wrote no verdict), so it changes no legitimate run's posture, and it is the merge-side backstop against a forged-false write. It is a cheap, testable guard of the crux invariant. **This guard is load-bearing for the live-read security model (D5), not a mere nicety:** because the live ledger is build-lane-writable (FAFF-690), D7 is precisely what catches a forged `false` that retains a fresh failing verdict — the one forge that would otherwise be a new escape. It must not be removed on the belief that the trusted-side write policy already suffices; the write policy is defence-in-depth, D7 is the guarantee.

**D8 — Do not close the "stood but verdict missing" silent-pass hole.** Options: `true` + verdict-ENOENT → `faulted` (close the hole) versus → `absent` (preserve today). **Chosen:** preserve → `absent` → pass-through. Rationale: an evaluator that crashes after the env stands is a legitimate run that passes through today; blocking it is a posture change this ticket forbids. Documented as an extension point for a future ticket to decide deliberately.

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision is closed above.

**Assumptions.**

- **Assumes:** `mutateLedgerUnderLock(runDir, mutate, expectedOwner)` is importable/callable from the `holdout_step` write context with the run's `expectedOwner` available. Validation: confirm the write site can resolve `runDir` and the owner fence value (the same inputs `record-outcome` uses at run-ledger.js:544); if the owner is not resolvable at that site, write without `expectedOwner` (still atomic under lock) and note it, rather than skipping the write.
- **Assumes:** the env-handle assertion result (`faff contract env-handle` exit code) and the zero-born-verifiable short-circuit are both observable inside `holdout_step` at the point of the write. Validation: confirmed against `holdout_step` steps 1-2 (beep-boop SKILL.md:346-347) and the graft Step 10 short-circuit (graft SKILL.md:607).

## 8. DONE — Definition of Done

### From WHY
- [ ] The merge floor's standability fact comes from the run ledger when captured, and the FAFF-1040 forward-pointer comment (merge-gate.js:774-779) is updated or removed to reflect that the follow-up has landed.

### From WHAT (types and interfaces)
- [ ] The run ledger carries an additive per-issue `capabilities[issue] = { sut_env_stood: <bool> }` map; `admitted`/`outcomes`/`owner`/`budget`/`level` and `runcheck`/Stop-hook reads are unaffected.
- [ ] `resolveCanRun(runDir, issue)` returns strictly `"satisfied" | "absent" | "faulted"` and never throws.

### From HOW (capture write)
- [ ] `holdout_step` writes `sut_env_stood: true` when the env-handle asserts ready (endpoint + health-checks + teardown_ref), and `false` on stand failure, provisioning error, absent proposal, or the zero-born-verifiable short-circuit.
- [ ] The capture mutation OMITS `level` and does not trip `LEVEL_WRITE_ONCE`; a run's `level` is unchanged after the write.
- [ ] The write is issued from the trusted side (orchestrator/graft context), via `mutateLedgerUnderLock`, never from a dispatched build or evaluator lane.

### From HOW (redirect mapping)
- [ ] `resolveHoldoutLeg` calls `resolveCanRun` in place of `readCanRun`; `readCaged` and `resolveHoldoutPosture` are unchanged.
- [ ] `sut_env_stood: false` with no holdout.json maps to `absent` → pass-through (the crux); it is never `faulted`.
- [ ] `sut_env_stood: true` defers to the live `readCanRun` for freshness/readability (`satisfied`/`faulted`/`absent`).
- [ ] `sut_env_stood: false` coexisting with a fresh readable holdout.json maps to `faulted` → strict (contradiction guard).
- [ ] An absent/unreadable/malformed captured value falls back to the live `readCanRun`, byte-identical to today; the read reads the live ledger, not the anchor.

### From HOW (consistency)
- [ ] `governance-check`'s `evaluateMergeFloorLeg` inherits the redirect with no separate edit and returns the same posture as the live floor in every case.

### Selftests (inline `--selftest` blocks; no separate *.test.js)
- [ ] `merge-gate.js --selftest` (extend the FAFF-1040 block ~2422-2455) pins: captured `false`+no-verdict → absent/pass-through; captured `true`+fresh → satisfied/strict; uncaptured → identical to live `readCanRun`; contradiction `false`+fresh-verdict → faulted; and explicitly that a captured `sut_env_stood: false` does NOT newly block a run that passes through today.
- [ ] `merge-gate.js --selftest` also pins the **`caged==absent` axis** (the axis the posture table's proof depends on): every legitimate row is unchanged versus the live floor with `caged==absent` (rows 1-6), and the illegitimate contradiction row flips only toward `strict` (fault-first) — so a legitimate non-caged run's posture is never changed.
- [ ] The `holdout_step` write orchestration (that it calls `capture_sut_env_stood` with the env-handle-derived boolean) is prose-skill behaviour with no inline `--selftest`; it is pinned by the integration smoke test below plus review, and this is called out honestly rather than claimed as unit-covered.
- [ ] `heartbeat.js --selftest` (extend the `mutateLedgerUnderLock` cases ~612-625) pins that the capture mutation writes `capabilities[issue].sut_env_stood`, preserves `level` by omission, and aborts cleanly on a null/malformed fresh ledger.
- [ ] `run-ledger.js --selftest` (~574-670) pins the additive `capabilities` shape leaves the existing ledger shape and readers intact.
- [ ] `governance-check.js --selftest` (~816-910) pins that `evaluateMergeFloorLeg` matches the live floor's posture across the captured, uncaptured, and contradiction cases.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Build a run-ledger with capabilities[ISSUE] = { sut_env_stood: false }, no holdout.json.
  2. Call resolveHoldoutLeg(runDir, ISSUE) with a caged lane-boundary.json present.
  3. ASSERT holdout_posture == "pass-through" AND holdout == "not-applicable" (merge not blocked).
  4. Flip to sut_env_stood: true, write a fresh readable non-meets-spec holdout.json.
  5. Call resolveHoldoutLeg again.
  6. ASSERT holdout_posture == "strict" AND holdout != "meets-spec" (merge blocked).
```

## Already shipped against this surface

- **FAFF-1040 — Done (ADR-0131).** The capability-driven merge floor that consumes `readCanRun`/`resolveHoldoutLeg`. This ticket is the follow-up its own forward-pointer comment (merge-gate.js:774-779) names: it changes `can_run`'s fact SOURCE, the floor decision UNCHANGED. Premise holds.
- **FAFF-1115 — Done (merged 2026-09-25, PR #947).** The sibling build-start OFFER / post-build RUN split; introduced the Step 8c RUN where `holdout_step` now runs. The capture write sits beside the `holdout.json` write in that same step. Related, not superseding. Premise holds.

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

The agile-delivery lens answers four per-issue axes for FAFF-1116. All four pass; groundings are given so the check is auditable.

**Right-sized? (principle 4)** — No issues. One cohesive 1-3 day unit. The two halves (capture `sut_env_stood` at env-stand time, redirect the merge floor's read to consume it) are a merge-together pair, not a split candidate: a captured fact with no reader is dead weight, and a redirected reader with no fact is broken, so they ship in one ticket. The build-tier-complex rating is invariant-preservation depth (three verdict cases, contradiction guard, live-read fallback), not scope breadth. Scope discipline is already visible: the other three FAFF-1101 capabilities, the stood-but-verdict-missing hole, and fact-anchoring are explicitly cut.

**Workstream fit? (principles 1 + 5)** — No issues. Cohesive around a single outcome: a durable stood-fact the FAFF-1040 merge floor can read without racing the live ledger. It sits project-less in Backlog, the correct default landing for a small durability fix. Minor observation (not a fault): the title names the mechanism ("capture X; redirect Y") rather than the outcome it buys; stating the outcome would make it self-describing, but this does not affect sequencing.

**Deps surfaced? (principle 6)** — No issues. FAFF-1040 (consumer) and FAFF-1115 (sibling) are both Done/merged and recorded as `relatedTo`. No live `blockedBy` link is missing, because you cannot block on shipped work: every seam this change edits has already landed, so the ticket is actionable now. The `relatedTo` edges to FAFF-1101/420/1073 are honest provenance.

**Risk profile? (principle 7)** — No issues; no de-risking spike warranted. No novel integration and no external dependency (the spec adds no new LLM seam), so the spike trigger does not fire. The real risk is regression of a live governance guarantee on the merge floor's critical path; that is de-risked the right way already, by the enumerated verdict-preservation matrix exercised through inline `--selftest` extensions across merge-gate.js, heartbeat.js, run-ledger.js and governance-check.js.

confidence: high
build-tier: complex
spec-review: approve (round 2) — post-approve editorial: field renamed `sut_standable` → `sut_env_stood` and a code-artifact-scope note added (naming/documentation only; no decision, AC, or security-model change, so the approve stands)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
