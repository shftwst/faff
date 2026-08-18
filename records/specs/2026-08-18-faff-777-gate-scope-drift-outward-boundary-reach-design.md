# Spec — FAFF-777: Gate scope-drift's `outward-boundary-reach` so it can't false-park healthy L4 work

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-777.

**Revised 2026-08-17 (autonomous stale-refresh).** Folded the human resolution comment "Unparked — both decisions settled" (2026-08-16). Two changes, no approach change:
- **Decision A — `OUTWARD_ALONE_RUNG` = `surface`.** The spec's one open architecture punt (the soft-rung value, `decides: architecture`) is now closed to `surface` — see the Chosen markers in §3, §6 and the resolved note in §7. This matches the spec's existing default, so the mechanism is byte-unchanged.
- **Decision B — gate, not tune — ratified.** The core `**Chosen:**` (per-kind intervention split) is confirmed by the human; annotated as ratified in §3 and §6.

Confidence re-rated **medium → high**: the sole human-owed decision is settled and matches the spec's default, no open decision remains, and the human cleared it for build ("Ready for `/faff-graft FAFF-777` as-is"). Freshness re-validated against `sentry.js` at refresh (the change is still unbuilt; `surface` still sits at index 1 of `SENTRY_INTERVENTIONS`).

This spec is for the build agent implementing FAFF-777 and the human reviewers gating it. It addresses the false-positive risk that FAFF-764 shipped and its adversarial review re-flagged: the `outward-boundary-reach` drift kind, now `pause`-acting, can park a legitimate L4 issue.

**This is a design spec, not a patch.** It describes the change the build agent will make to `plugin/skills/faff/bin/lib/sentry.js`; the spec body carries no code diff by design (the implementation is the build phase's output, reviewed as a PR). A reviewer should assess the *approach*, not expect a code change inside the spec artifact.

## 1. WHY — Problem and Principles

**Load-bearing model.** `evalScopeDrift` (sentry.js) emits **one** `scope-drift` verdict per run, of exactly one of three kinds in precedence order — `recompute-mismatch` > `unrecorded-create` > `outward-boundary-reach` — and the whole signal maps to a single intervention (`pause`). The three kinds are **not equally trustworthy**: the first two are *corroborated* (a record that contradicts its own recomputation; a ledger claim with no matching walk), whereas `outward-boundary-reach` is the **bare record itself** — a single honestly-recorded pre-create walk that came back `outward`. Under the FAFF-354 trust ceiling that record binds *structure, not truthfulness*, so an outward reach is **structurally indistinguishable from a false positive**: a legitimate in-envelope create whose agent-sourced parent chain simply doesn't reach the accepted root records `outward` exactly as a genuine drift does.

**Problem statement.** Today any single non-root `outward` walk trips `pause`, parking the issue that recorded it. Because that kind is uncorroborated and un-truthful by construction (FAFF-354), a healthy L4 issue can be parked on a signal that proves nothing. This change stops `outward-boundary-reach`-**alone** from parking, while keeping the corroborated kinds biting and keeping the reach visible as a detective breadcrumb.

**Design principles.**

- **Detective, not preventive (FAFF-354).** A drift verdict binds structure, not truthfulness. An uncorroborated, un-truthful kind must not carry a preventive-strength (`pause`/park) response. It may still be *surfaced*.
- **Corroboration earns teeth.** The response strength of a drift kind tracks how corroborated it is. `recompute-mismatch` and `unrecorded-create` caught an actual inconsistency; `outward-boundary-reach` caught only a boundary reach.
- **Never silence the signal.** FAFF-764's purpose was to give scope-drift real detection. The fix removes the *park harm*, not the *visibility* — a downgrade to a non-parking rung, never to nothing.
- **No magic numbers we can't ground.** The repo holds no real L4 run corpus (verified: no `containment-check` events, no `prd_root_container` in any `.faff/runs/*` ledger). Any fix must be defensible from the FAFF-354 posture alone, not from an FP rate we cannot measure. (Ratified by human decision B, 2026-08-16.)

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` `evalScopeDrift` (~494-534) | Node | The predicate emitting the `scope-drift` verdict + `evidence.drift_kind` |
| `sentry.js` `SIGNAL_TRIP_INTERVENTION` (~148), `SENTRY_INTERVENTIONS` ladder (141) | Node | Signal→intervention map; `continue < surface < pause < correct < abort` |
| `sentry.js` `evaluateDerailment` aggregation (~640-665, the `mapped = SIGNAL_TRIP_INTERVENTION[v.signal]` resolve at ~662) | Node | Resolves each tripped verdict's intervention and takes the ladder-max |
| `sentry.js` selftest (~1210-1315) | Node | Synthetic `containment-check` fixtures — the stand-in test corpus |
| FAFF-767 `surface` rung | — | Run-scoped log/`/faff-wtf` write that never parks; the "blind spot, not a proven breach" rung |

**Scope statement.** A response-strength correction inside the already-shipped scope-drift detector; it changes *how hard* one drift kind bites, not *what* the detector detects.

## 2. OUT OF SCOPE

- **Empirically measuring the real-world FP rate.** — *Why excluded:* no L4 run corpus exists in-repo (L4 is preview, no end-to-end run has produced `containment-check`/`prd_root_container` data), so a real FP rate is unmeasurable now. Ratified as accepted-OOS by human decision B (2026-08-16). *Extension point:* re-run the measurement against `.faff/runs/*` once a real `faff lights-out` run has produced a containment-check stream; the synthetic selftest fixtures (sentry.js selftest block) stand in until then.
- **Re-truthing agent-sourced ancestry.** — *Why excluded:* that is FAFF-354's domain (Done) and its ceiling is accepted here, not reopened. *Extension point:* an independent surface re-fetch of the parentId chain (FAFF-354's own noted follow-up).
- **Telemetry integrity of the `containment-check`/`events.jsonl` stream.** — *Why excluded:* the sentry's input-trust model is already fixed and unchanged by this ticket — `normalizeSentrySignals` is a closed-allowlist coercion (the AC5 un-subvertability property, FAFF-326) and ancestry truthfulness is the FAFF-354 ceiling. This change does **not** widen that surface; it only *downgrades* one uncorroborated kind. It cannot "mask a real violation": a forger who could fabricate telemetry would forge a *clean* record (no drift at all), not an `outward` one, and the corroborated kinds a forger would have to keep self-consistent (`recompute-mismatch`, `unrecorded-create`) retain `pause`. *Extension point:* signing/attesting the event stream is its own future ticket, orthogonal to which drift kind bites.
- **The acting/attendedness model.** — *Why excluded:* whether `pause` acts on a given run is FAFF-763/765/766's axis, orthogonal to *which* drift kind earns `pause`. *Extension point:* `actsOnSentryAbort`/de-levelling in sentry.js.
- **Changing recompute-mismatch / unrecorded-create behaviour.** — *Why excluded:* those kinds are corroborated and keep their `pause`; only the uncorroborated kind is re-graded. *Extension point:* `SCOPE_DRIFT_KIND_INTERVENTION` (below) already keys by kind, so a future re-grade of any kind is a one-line map edit.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| drift kind | Which of the three scope-drift detectors fired: `recompute-mismatch`, `unrecorded-create`, `outward-boundary-reach` (`evidence.drift_kind`). |
| corroborated kind | A drift kind whose evidence is an *inconsistency* the sentry re-derived (`recompute-mismatch`, `unrecorded-create`), not a bare record. |
| soft rung | A non-parking intervention: `continue` or `surface`. |
| gate | Route the uncorroborated kind to a soft rung so it can't park, keeping the corroborated kinds at `pause`. |

**Design decision — tune vs gate.**

| Option | What it does | Cons |
|---|---|---|
| Tune threshold | Require N≥2 non-root `outward` reaches before tripping | Needs an FP rate to pick N (unmeasurable); count ≠ truthfulness — 10 FPs still trip, 1 genuine drift misses; frequency is the wrong axis for a truthfulness problem |
| Gate by corroboration | `outward-boundary-reach`-alone routes to a soft rung; corroborated kinds keep `pause` | Requires a per-kind intervention split (small, clean); leaves outward drift non-parking (acceptable under FAFF-354 detective posture) |

**Chosen:** Gate by corroboration — split `scope-drift`'s intervention **per drift kind** so `outward-boundary-reach` alone routes to a non-parking soft rung while `recompute-mismatch` and `unrecorded-create` keep `pause`. Rationale: the FP is a *truthfulness* problem (FAFF-354), not a *frequency* problem, so a count threshold is the wrong instrument and additionally needs data we don't have; gating is defensible from the FAFF-354 posture alone. This subsumes the ticket's "require recompute-mismatch alongside" suggestion — a co-present mismatch already wins precedence and keeps `pause`; the residual case the fix targets is outward-*alone*. **Ratified by human decision B (2026-08-16): gate, not tune.**

**Chosen:** `OUTWARD_ALONE_RUNG` = `surface`. The outward-alone soft rung is FAFF-767's `surface` (logged to the run + `/faff-wtf`, a visible detective breadcrumb), not `continue`. **Settled by human decision A (2026-08-16)**: a parked-issue breadcrumb is worth more than a silent `continue`, and the mild semantic stretch — a scope-drift verdict names the issue that recorded the reach, whereas FAFF-767 frames `surface` as naming no issue — is accepted. This is the value the spec already defaulted to, so the build mechanism is unchanged; the decision simply removes the open sign-off item.

**Was build-decoupled, now closed.** The build target is the *mechanism* (per-kind intervention split) with the single named constant `OUTWARD_ALONE_RUNG` holding the outward-alone soft rung, now fixed at `surface`. Both former candidate values were non-parking, so every DONE criterion and scenario below is expressed against "a non-parking rung"; with `surface` settled they hold concretely. No human sign-off item is outstanding.

**Type / map surface.**

```
# The single named constant holding the outward-alone soft rung. Settled to "surface"
# by human decision A (2026-08-16).
CONST OUTWARD_ALONE_RUNG = "surface"     # MUST be a non-parking rung (index < "pause")

# New per-kind intervention map for scope-drift, consulted by the aggregation loop.
CONST SCOPE_DRIFT_KIND_INTERVENTION:
  "recompute-mismatch":     "pause"              # corroborated — unchanged teeth
  "unrecorded-create":      "pause"              # corroborated — unchanged teeth
  "outward-boundary-reach": OUTWARD_ALONE_RUNG   # uncorroborated — gated to a non-parking rung

# SIGNAL_TRIP_INTERVENTION["scope-drift"] stays "pause" as the DEFAULT/fallback for a
# scope-drift verdict whose drift_kind is absent or unrecognised (fail toward the
# stronger response — never silently weaken an unknown kind).
```

## 4. HOW — Behavior

**Approach.** `evalScopeDrift` is unchanged in *detection* — it still emits the same single verdict with `evidence.drift_kind`. The change is in **intervention resolution**: where `evaluateDerailment` currently maps a tripped verdict via `SIGNAL_TRIP_INTERVENTION[v.signal]` (sentry.js ~662), for a `scope-drift` verdict it first consults `SCOPE_DRIFT_KIND_INTERVENTION[v.evidence.drift_kind]`, falling back to `SIGNAL_TRIP_INTERVENTION["scope-drift"]` when the kind is absent/unrecognised. Every other signal resolves exactly as today.

```
PROCEDURE resolve_intervention(verdict):
  1. IF verdict.severity == "warn": RETURN "continue"          # unchanged: warn never escalates
  2. IF verdict.signal == "scope-drift":
     a. kind := verdict.evidence.drift_kind
     b. mapped := SCOPE_DRIFT_KIND_INTERVENTION[kind]
     c. IF mapped is defined: RETURN mapped
     d. ELSE: RETURN SIGNAL_TRIP_INTERVENTION["scope-drift"]   # fail toward "pause"
  3. RETURN SIGNAL_TRIP_INTERVENTION[verdict.signal]           # every other signal, unchanged
```

The ladder-max aggregation over all tripped verdicts is unchanged — only the per-verdict intervention feeding it changes, and only for `scope-drift`.

**Behaviour summary.** After this change: a run whose only drift is a single non-root `outward` reach resolves that verdict to `surface` (non-parking) instead of `pause`; a run with a `recompute-mismatch` or `unrecorded-create` still resolves to `pause`; a run with both still resolves to `pause` (mismatch wins precedence in `evalScopeDrift`, unchanged).

**Edge cases.**

- **Unknown/absent `drift_kind`** → fall back to `SIGNAL_TRIP_INTERVENTION["scope-drift"]` = `pause` (never weaken an unrecognised kind).
- **`outward` co-present with a corroborated kind** → `evalScopeDrift` precedence already emits the corroborated `drift_kind`; resolution returns `pause`. No change needed there.
- **Ladder interaction** → if another signal in the same run trips a higher rung (e.g. `budget-breach` → `abort`), the ladder-max still wins; gating scope-drift only lowers *its own* contribution.

**Failure modes.**

- **The failure:** gating removes a genuine-drift park — a real outward expansion now only surfaces, not parks. **How you'd know:** a post-hoc audit (`faff audit`) finds an out-of-envelope subtree on a run that scope-drift only `surface`d. **What it means:** proceed — this is the accepted FAFF-354 detective posture (structure-not-truthfulness can't preventively block); the breadcrumb + audit is the designed backstop, and the corroborated kinds still park.
- **The failure:** the fix is validated only against synthetic fixtures, so a real-corpus FP shape we didn't imagine still parks (via a corroborated kind) or still leaks (via outward). **How you'd know:** the deferred real-corpus measurement (OOS) once L4 data exists. **What it means:** narrow/revisit then; not a blocker now.

**Anti-pattern:** Adding a `sentry.scope_drift_outward_n` count threshold. Why: the FP is a truthfulness problem under FAFF-354, not a frequency one — a count neither separates FP from genuine drift nor can be grounded without the missing corpus.

**Anti-pattern:** Making `evalScopeDrift` return `null` for outward-alone (dropping the kind). Why: that destroys the detective breadcrumb FAFF-764 exists to provide; the fix must down-*grade* the response, not delete the detection.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run whose only containment-check is a single non-root walk recorded verdict:"outward"
When evaluateDerailment resolves the scope-drift verdict
Then the aggregate intervention equals OUTWARD_ALONE_RUNG (surface) and sits strictly below "pause" in SENTRY_INTERVENTIONS (a non-parking rung), and no park/abort action is dispatched for the issue
```

```
Given an L4 run whose only containment-check is a non-root outward reach and a scope-drift verdict with evidence.drift_kind:"foo" (an unrecognised string)
When intervention resolution runs
Then it falls back to "pause" (SCOPE_DRIFT_KIND_INTERVENTION has no "foo" key)
```

```
Given an L4 run with a containment-check that recomputes to a verdict different from its recorded one
When evaluateDerailment resolves the scope-drift verdict (drift_kind recompute-mismatch)
Then the aggregate intervention is still "pause"
```

```
Given a scope-drift verdict whose evidence.drift_kind is absent or an unrecognised string
When intervention resolution runs
Then it falls back to "pause" (never weakens an unknown kind)
```

## 6. DESIGN DECISION RATIONALE

**How to reduce the outward-boundary-reach FP without measurable data?**
- *Tune (count threshold):* rejected — needs an unmeasurable FP rate; count is orthogonal to truthfulness.
- *Gate (per-kind intervention):* chosen — defensible from FAFF-354 alone; keeps corroborated kinds biting.
- **Chosen:** Gate by corroboration via `SCOPE_DRIFT_KIND_INTERVENTION`, `outward-boundary-reach` → soft rung. Rationale above. **Ratified by human decision B (2026-08-16): the FP is a truthfulness problem under FAFF-354, not a frequency one, and a count threshold N can't be grounded without an L4 run corpus that does not exist — gate, not tune.**

**Where does the per-kind split live — in `evalScopeDrift` (emit intervention) or in the aggregation (resolve by kind)?**
- *In the predicate:* couples detection to intervention policy; the predicate stays purely detective everywhere else.
- *In the aggregation:* keeps `evalScopeDrift` a pure detector and localises policy in the one place interventions are already resolved.
- **Chosen:** Resolve in the aggregation loop against a `drift_kind`-keyed map, `SIGNAL_TRIP_INTERVENTION["scope-drift"]` retained as the fallback. Keeps the detector pure and the policy in one readable place.

**Soft-rung target for `outward-boundary-reach`-alone — `surface` vs `continue`?**
- *`continue`:* fits FAFF-767's "names no issue" semantics exactly, but drops the run-scoped surface line — the reach leaves no breadcrumb.
- *`surface`:* keeps a run-scoped breadcrumb (logged to the run + `/faff-wtf`), at the cost of a mild stretch of FAFF-767's "names no issue" framing.
- **Chosen:** `surface`. **Settled by human decision A (2026-08-16):** the detective breadcrumb is worth more than a silent `continue`; the semantic stretch is accepted.

## 7. ASSUMPTIONS

**Resolved (was an Open Question).** The soft-rung target for `outward-boundary-reach`-alone is settled to `surface` per human decision A (2026-08-16) — see the `**Chosen:**` markers in §3 and §6. No open decisions remain in this spec.

**Assumptions.**
- **Assumes:** the `surface` rung (FAFF-767) is present in `SENTRY_INTERVENTIONS` and behaves as a non-parking run-scoped write. *Validate:* confirmed at refresh — `SENTRY_INTERVENTIONS = ["continue", "surface", "pause", "correct", "abort"]` at sentry.js:141, so `"surface"` sits at index 1, strictly below `"pause"` (index 2); the poller/handling table treats it as non-parking.
- **Assumes:** no real L4 containment-check corpus exists to measure against, so synthetic selftest fixtures are the acceptance substrate. *Validate:* `grep -rl containment-check .faff/runs` returns nothing (confirmed at spec time and re-confirmed at refresh). Accepted-OOS by human decision B.

## 8. DONE — Definition of Done

### From WHY
- [ ] A single non-root `outward` containment-check no longer parks its L4 issue (resolves to a non-parking rung).
- [ ] The corroborated kinds (`recompute-mismatch`, `unrecorded-create`) still resolve to `pause`.

### From WHAT
- [ ] `SCOPE_DRIFT_KIND_INTERVENTION` exists, keying the three drift kinds (`recompute-mismatch`/`unrecorded-create` → `pause`, `outward-boundary-reach` → `OUTWARD_ALONE_RUNG`).
- [ ] `OUTWARD_ALONE_RUNG` is a single named constant set to `surface`, and is asserted at load/test to be a non-parking rung: `SENTRY_INTERVENTIONS.indexOf(OUTWARD_ALONE_RUNG) < SENTRY_INTERVENTIONS.indexOf("pause")`.
- [ ] `SIGNAL_TRIP_INTERVENTION["scope-drift"]` remains `pause` as the fallback for absent/unrecognised `drift_kind`.

### From HOW (behaviour)
- [ ] `evaluateDerailment` resolves a `scope-drift` verdict's intervention via `drift_kind` first, falling back to the signal-level map; all other signals resolve unchanged (byte-equivalent).
- [ ] `evalScopeDrift`'s detection output is unchanged (same verdict, same `evidence.drift_kind`, same precedence).
- [ ] Outward-alone resolves to a non-parking rung (asserted structurally as index < `pause`), and no park/abort is dispatched for its named issue.

### From HOW (edge cases)
- [ ] An unrecognised `drift_kind` string (e.g. `"foo"`) and an absent `drift_kind` both fall back to `pause`.
- [ ] A run tripping a higher-rung signal alongside outward-alone still yields the higher rung (ladder-max intact).

### Tests
- [ ] The scope-drift selftest block (sentry.js — the build agent locates the block by content, not by fixed line) is extended: outward-alone → non-parking rung (`surface`); recompute-mismatch → pause; mismatch+outward → pause; unrecognised-kind `"foo"` → pause. The existing outward-alone fixture (the `verdict:"outward"`, `root:false` L4 case already present in that block) is reused as the base case; a new fixture is added only for the unrecognised-kind path.

**Integration smoke test:**
```
run evalScopeDrift + evaluateDerailment on the existing outward-alone L4 fixture in the sentry.js selftest block
=> assert aggregate intervention == OUTWARD_ALONE_RUNG (surface), that rung is non-parking (index < "pause"), tripped == true, issue not parked
```

confidence: high
build-tier: complex
spec-review: approve
