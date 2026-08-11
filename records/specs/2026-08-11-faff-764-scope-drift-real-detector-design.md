# Spec — FAFF-764: give `scope-drift` a real detector on the containment seam

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-764.

This is the build spec for FAFF-764, addressed to the coding agent that will implement it and the human reviewers who gate it. It replaces the sentry's hollow, self-reported `scope-drift` signal with a behaviour-derived detective that folds the recorded containment stream against the run's accepted-root envelope. It touches one file of engine logic (`plugin/skills/faff/bin/lib/sentry.js`) plus its unit tests, and reuses — never re-implements — the containment comparators that `faff contain` and `faff audit` already share.

## 1. WHY — Problem and Principles

**The load-bearing model.** The sentry already owns six behaviour-derived derailment detectors that are pure predicates over an already-normalized `{events, ledger, budget, …}` surface — no I/O of their own. `scope-drift` is the seventh signal but the only one with no such predicate: it fires only when something upstream hands it a `scope_drift: true` flag. Meanwhile faff already has a recorded, recomputable notion of "is this run inside its declared subtree?" — the `containment-check` events that `faff contain --record` appends and that `faff audit` re-runs to find coherence gaps. This change makes `scope-drift` derive itself from that recorded containment stream, using the exact same comparators `faff audit` uses, so scope-drift becomes the live-run detective counterpart to faff's preventive containment controls.

**Problem statement.** Today `scope-drift` is advisory-only (maps to `continue`, emits `severity:"warn"`, never trips any action) and self-reported (`evalScopeDrift` reads only `signals.scope_drift` or an event's `data.scope_drift`, computing nothing). On an unattended L4 run the sentry therefore cannot catch mandate/containment creep unless some other component already flagged it — a real gap for L4 mandate discipline. This change replaces the self-report with a predicate that derives drift from the recorded containment stream versus the accepted-root envelope, and promotes the signal so a confirmed drift actually surfaces with teeth.

**Design principle — reuse the containment seam, never a parallel scope notion.** The detector must compute "inside/outside scope" through the existing `subtreeContains` / `parseAncestry` comparators exported from `shared-infra.js` (the same functions `contain.js` and `audit.js` import), against `ledger.prd_root_container` (the L4 accepted-root envelope) and the recorded `containment-check` events. Any implementation that introduces a second, independent idea of "scope" (a fresh path walk, a re-parse of tracker ancestry from somewhere else) is rejected: the whole point is that this is the detective read of the *same* seam the preventive controls write.

**Design principle — the verdict binds STRUCTURE, not TRUTHFULNESS.** Containment ancestry is agent-sourced (FAFF-354, ADR-0072): `faff contain`/`faff audit` are detective, not preventive, because an honest-but-false self-consistent fabrication recomputes clean. A scope-drift detector built on this seam inherits — does not worsen — that ceiling. It therefore must never become a hard preventive brake, and its prose and evidence must describe it as a recompute-and-compare audit of structure, not a truth oracle. Any implementation that treats a drift verdict as proof the run genuinely left its true scope is rejected.

**Design principle — never fire on the sanctioned filing floor.** An `outward` verdict from `faff contain --root` is the *designed* discovered-scope filing path (the outward-new-root floor: "intended new root — needs human sanction"), and it is emitted on normal operation. The detector must exclude root-outward checks from the drift signal, or it will trip on every legitimate discovered-scope filing. Only a *non-root* pre-create walk that came back `outward` counts as a boundary reach.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` | Node.js | Houses `evalScopeDrift` (401-410), the predicate this spec rewrites; `evaluateDerailment` (509-574) that folds it; the `SIGNAL_TRIP_INTERVENTION` map (133-142). |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node.js | Exports `subtreeContains`, `parseAncestry`, `CONTAIN_ROOT` — the containment comparators the detector reuses (already exported, line 661). |
| `plugin/skills/faff/bin/lib/audit.js` | Node.js | `buildReconstruction` (207) computes `coherence.containment_mismatches` (327-343) and `coherence.unrecorded_creates` (373-375); the detector mirrors this exact logic in-process. |
| `plugin/skills/faff/bin/lib/contain.js` | Node.js | `--record` (160-192) appends the `containment-check` event `{mandate,parent,root,ancestry_raw,verdict,exit}` the detector reads. |
| `plugin/skills/faff/bin/lib/lights-out.js` | Node.js | Mints `ledger.prd_root_container` at L4 start (965) — the accepted-root envelope. |

**Scope statement.** This lands one new behaviour-derived detector inside the sentry's existing derailment fold; it does not change when or how hard the sentry acts beyond promoting this one signal onto the existing pause rung.

## Already shipped against this surface

Extensive sentry + containment work is Done, but all of it is the *substrate* this detector reuses — none delivers a behaviour-derived `scope-drift` detector, so the premise holds:

- **FAFF-49** (Sentry-1 — derailment detection + kill-switch) built the sentry and the seven `DERAILMENT_SIGNALS`, landing `scope-drift` as the advisory self-reported placeholder this issue replaces.
- **FAFF-217 / FAFF-221 / FAFF-222** built scope-containment: `faff contain`, the ancestry model, `--record`, and the outward-new-root filing floor — the exact seam the detector reads.
- **FAFF-326 / FAFF-278 / FAFF-324 / FAFF-325 / FAFF-466** built the corrective-authority + detection-integrity machinery (Channel A, the `authority` gate, integrity-gate detection reads).
- **FAFF-352 / FAFF-470 / FAFF-426 / FAFF-327** wired `faff sentry check` into the beep-boop checkpoints, the detached poller, and fleet supervision — the invocation loci this signal rides.
- **FAFF-717** (decouple liveness posture) is the Sentry-acting-per-attendedness axis; **FAFF-763** (out of scope here) owns *when* the sentry acts.

The defect is live: `evalScopeDrift` (sentry.js:401-410) still reads only the self-report flag. This spec is net-new detector code over an already-built substrate.

## 2. OUT OF SCOPE

- **L3 "outside the admitted queue" drift.** Excluded — L3 runs have no `prd_root_container` envelope and "outside the admitted labelled queue" is not the containment subtree the seam models, so it is not cleanly derivable from the same comparators. Extension point: a future increment could derive an L3 signal from `ledger.admitted` versus per-issue attribution, but that is a different notion of scope and would live as its own branch inside the rewritten `evalScopeDrift` (or a sibling predicate), gated on `ledger.level` being L1–L3.

- **Live-tracker truthfulness verification of ancestry.** Excluded — verifying that the agent-supplied ancestry matches the real tracker is FAFF-316 (unbuilt). The detector inherits the FAFF-354 ceiling and reads only what the run recorded. Extension point: FAFF-316 would add an independent surface read upstream of the containment record; this detector would consume its verdict unchanged.

- **A hard preventive brake / Stop-hook-class enforcement.** Excluded by the trust ceiling — a stop-class abort on agent-sourced ancestry is not justifiable. Extension point: none in this issue; abort routing for any signal is owned elsewhere.

- **De-levelling *when* the sentry acts (FAFF-763).** Excluded — this spec reuses the existing `SIGNAL_TRIP_INTERVENTION` map and the existing `actsOnSentryAbort` / cooperative-handling machinery unchanged; the orthogonal question of how hard the sentry acts at each level is FAFF-763's. Extension point: FAFF-763 owns the acting-model table this signal's mapped intervention feeds into.

- **A new `container-create` / `ticket-create` event.** Excluded — the event vocabulary records only the *pre*-create containment walk, never a post-create tracker fact. The detector works from the walk record alone. Extension point: `EVENT_TYPES` in `governance-profile.js` is where a post-create fact would be added, letting a later increment correlate an `outward` verdict with a create that actually happened.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Accepted-root envelope | `ledger.prd_root_container` — the tracker container an L4 run's admitted work must sit under (ADR-0072). The crisp definition of "inside scope" for this detector. |
| `containment-check` event | The record `faff contain --record` appends: `{type:"containment-check", issue, data:{mandate, parent, root, ancestry_raw, verdict, exit}}`. `verdict ∈ {"contained","outward"}`. |
| Drift kind | Which of the three recorded incoherences the detector found: recompute-mismatch, unrecorded-create, or outward-boundary-reach. |
| Detective (vs preventive) | A recompute-and-compare audit that binds structure not truthfulness — it flags a record that is incoherent or reaches the boundary, it does not prove the run truly left its scope. |

**The verdict this predicate returns** (mirrors the shape of `evalThrash` / `evalWallClock`):

```
RECORD DerailmentVerdict:        # returned by evalScopeDrift, or null
  signal:   "scope-drift"        # constant
  severity: "trip"               # promoted from the old "warn"
  evidence: ScopeDriftEvidence

RECORD ScopeDriftEvidence:
  drift_kind:    "recompute-mismatch" | "unrecorded-create" | "outward-boundary-reach"
  accepted_root: String | null   # ledger.prd_root_container (the envelope judged against)
  detective:     true            # constant — self-describes the trust ceiling (structure, not truth)
  # exactly one kind-specific group, matching drift_kind:
  #   recompute-mismatch:     { seq, issue, recorded, recomputed }   # mirrors audit containment_mismatches entry
  #   unrecorded-create:      { discovered_scope_filed: Int }        # mirrors audit unrecorded_creates
  #   outward-boundary-reach: { seq, issue, mandate, parent }
```

**The intervention mapping change.** `SIGNAL_TRIP_INTERVENTION["scope-drift"]` moves from `"continue"` (vestigial) to `"pause"`. `scope-drift` is NOT added to `CORRECTABLE_SIGNAL` and NOT wired to the `authority` upgrade path — it maps straight to `pause`, un-gated, exactly like `budget-metering-degraded`.

**Removed inputs.** The self-report path is deleted: `normalizeSentrySignals` drops its `scope_drift: r.scope_drift === true` line (217), and the predicate no longer reads any event's `data.scope_drift`. Nothing else consumes that key.

**Design decision — inline computation vs child-spawning `faff audit`.** The detector re-derives the same `coherence.*` facts `faff audit` computes. It could either compute them inline over the already-normalized `s.events`/`s.ledger`, or child-spawn `faff audit <run-id> --json` and read `coherence.containment_mismatches` / `coherence.unrecorded_creates` (mirroring how `sentryReadBudget` spawns `faff budget check`).

- *Inline*: pro — every input is already present in the normalized surface (`s.events` holds the `containment-check` events, `s.ledger` holds `prd_root_container` and `discovered_scope_filed`); no subprocess, so it stays a pure predicate like every sibling and is unit-testable without spawning; the recompute reuses `subtreeContains`/`parseAncestry` (a shared-infra import), so it is the *same* logic, not a fork. Con — the recompute walk runs on every sentry poll (cheap: bounded by the count of `containment-check` events, typically a handful).
- *Child-spawn `faff audit`*: pro — literally the same code path as audit, zero drift risk. Con — a subprocess on every cooperative checkpoint *and* every detached-poller tick; `faff budget check` is spawned because the sentry deliberately does no token math, but the containment inputs are already in hand, so a spawn buys nothing here; a child-spawn inside a predicate would break the "pure over the normalized surface" invariant every other predicate holds (AC5).

**Chosen:** compute inline as a pure predicate, importing `subtreeContains`, `parseAncestry`, and `CONTAIN_ROOT` from `shared-infra.js` (the same exports `audit.js` uses at line 27) — reusing the exact comparators, no subprocess, no parallel scope notion. This keeps the predicate pure and unit-testable, avoids a subprocess on every poll, and mirrors how `audit.js` itself reuses shared-infra rather than re-implementing the walk.

## 4. HOW — Behavior

**Architecture and approach.** Rewrite the body of `evalScopeDrift(signals)` in `sentry.js`. It keeps its signature (called `push(evalScopeDrift(s))` at line 522, passed the normalized surface) and its position in `evaluateDerailment`. It reads `signals.ledger` and `signals.events` only — no filesystem, no subprocess. It gates on L4, then derives up to three drift kinds from the recorded containment stream, and returns a single `trip` verdict (or `null`) choosing the most-specific kind by precedence. Add `subtreeContains`, `parseAncestry`, `CONTAIN_ROOT` to the existing `shared-infra` require at line 92. Change the one map entry at line 139.

**The recompute helper mirrors `audit.js` exactly** (lines 332-339) — same comparator, same `CONTAIN_ROOT` sentinel, same fail-to-`unreproducible` on a malformed `ancestry_raw`:

```
PROCEDURE recompute_verdict(d):        # d = a containment-check event's data
  1. IF d.ancestry_raw is null or undefined:
       RETURN subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, emptyMap)
  2. TRY entryOf = parseAncestry(d.ancestry_raw)
     CATCH: RETURN "unreproducible"
  3. RETURN subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, entryOf)
```

**The predicate:**

```
PROCEDURE evalScopeDrift(signals):
  ledger = signals.ledger; events = signals.events

  1. # L4-first gate (mirrors evalBudgetMeteringDegraded's level gate)
     IF ledger is absent OR ledger.level != "L4": RETURN null

  2. checks = [ e in events WHERE e.type == "containment-check" ]
     filed  = ledger.discovered_scope_filed IS a number ? it : 0
     accepted_root = ledger.prd_root_container ?? null

  3. # (a) recompute-mismatch — a recorded verdict that does not reproduce
     FOR e in checks (ascending seq):
        d = e.data or {}
        recomputed = recompute_verdict(d)
        IF recomputed != d.verdict:
           mismatch = { seq: e.seq ?? null, issue: e.issue ?? null,
                        recorded: d.verdict, recomputed }
           BREAK   # first offender is enough

  4. # (b) unrecorded-create — scope filed with zero recorded walks
     unrecorded = (filed > 0 AND checks is empty)

  5. # (c) outward-boundary-reach — a NON-root pre-create walk that came back outward
     FOR e in checks (ascending seq):
        d = e.data or {}
        IF d.verdict == "outward" AND d.root != true:
           outward = { seq: e.seq ?? null, issue: e.issue ?? null,
                       mandate: d.mandate ?? null, parent: d.parent ?? null }
           BREAK

  6. IF no mismatch AND not unrecorded AND no outward: RETURN null

  7. # precedence: an incoherent record is the strongest signal, then a missing
     #   record, then a recorded reach-past-the-boundary.
     IF mismatch:   kind = "recompute-mismatch";     detail = mismatch
     ELSE IF unrecorded: kind = "unrecorded-create"; detail = { discovered_scope_filed: filed }
     ELSE:          kind = "outward-boundary-reach";  detail = outward

     RETURN { signal: "scope-drift", severity: "trip",
              evidence: { drift_kind: kind, accepted_root, detective: true, ...detail } }
```

**Behaviour summary.** On an L4 run, if the recorded containment stream is incoherent with itself (a verdict that no longer recomputes), missing where the ledger says scope was filed, or shows the run's own pre-create walk reaching a non-root target outside the accepted subtree, the detector trips `scope-drift`, which the fold maps to `pause`. On anything else — non-L4, or an L4 run whose containment records are all coherent/contained, or a run with no containment activity at all — it returns `null`.

**The fold change.** In `evaluateDerailment`, the `push(evalScopeDrift(s))` call and its position are unchanged. Because the verdict is now `severity:"trip"`, it reaches the trip loop (533+), where `SIGNAL_TRIP_INTERVENTION["scope-drift"]` resolves to `"pause"` and contributes to the ladder-max. It is never touched by the `CORRECTABLE_SIGNAL` upgrade (that guard is `v.signal === "fix-review-thrash"`) nor by the member-stall cap (`v.signal === "wall-clock-runaway"`), so no authority parameter is consulted.

**Edge cases and fallbacks.**
- **No `ledger.level` or non-L4** → `null` at step 1 (before any event scan). This is the primary non-firing case and keeps L3/legacy runs byte-equivalent to today.
- **L4, no `containment-check` events, `discovered_scope_filed` 0/absent** → `null` (nothing to derive). Explicit: a run with zero containment activity yields no drift signal.
- **`root:true` outward check** (the sanctioned discovered-scope filing floor) → never contributes to `outward-boundary-reach` (step 5 requires `root != true`). A run that only files new roots the designed way does not trip.
- **Malformed `ancestry_raw`** on a recorded check → `recompute_verdict` returns `"unreproducible"`, which differs from any recorded `"contained"`/`"outward"`, so it counts as a recompute-mismatch (`recomputed:"unreproducible"`) — exactly `audit.js`'s behaviour (337).
- **Missing `e.seq` / `e.issue`** → carried as `null` in evidence (mirrors the other predicates' `event_seq ?? null`).
- **Multiple drift kinds present at once** → one verdict, chosen by the step-7 precedence; the others are not separately surfaced (matches the single-worst-verdict shape of `evalThrash`/`evalRepeatedFailure`).

**Failure modes.**
- **The failure:** the detector is noisy — it pauses legitimate runs. The dominant false-positive source (root-outward filing-floor walks) is excluded by construction, but a legitimately human-sanctioned non-root outward reach still trips, because the sentry cannot see the sanction from the event stream. **How you'd know:** L4 runs pausing on `drift_kind:"outward-boundary-reach"` whose reaches were in fact sanctioned. **What it means:** proceed — this is andon working as intended (a human clears the pause after confirming the reach was sanctioned); if field rate is intolerable, narrow by requiring the reach to also be *acted on*, which needs the post-create event this spec lists as out of scope.
- **The failure:** the trust ceiling makes the signal meaningless — an honest-but-false self-consistent fabrication recomputes clean, so recompute-mismatch catches only tampered/foreign records, not untrue-but-well-formed ancestry. **How you'd know:** a run with fabricated-but-coherent ancestry never trips recompute-mismatch. **What it means:** proceed — this is the inherited, documented FAFF-354 ceiling, not a regression; the detector is explicitly labelled `detective:true` and truthfulness verification is FAFF-316.

**Anti-pattern:** re-reading `events.jsonl` or `run-ledger.json` from disk inside the predicate. Why: the normalized surface already holds both, and every sibling predicate is pure over that surface — a disk read breaks testability and the AC5 closed-surface property.

**Anti-pattern:** copying `subtreeContains`/`parseAncestry` into `sentry.js` or writing a fresh subtree walk. Why: the design principle is one containment notion; the comparators are already exported from `shared-infra.js` — import them.

**Anti-pattern:** adding `scope-drift` to `CORRECTABLE_SIGNAL` or threading it through the `authority` parameter to reach `correct`/`abort`. Why: the trust ceiling caps this at a `pause`-class detective surface; `correct` (redispatch) has nothing to redispatch and stop-class acting is FAFF-763/out of scope.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run whose ledger has prd_root_container set
  and a recorded containment-check whose data.verdict is "contained"
  but whose data.ancestry_raw no longer recomputes to "contained"
When evalScopeDrift runs over the normalized surface
Then it returns { signal:"scope-drift", severity:"trip",
     evidence:{ drift_kind:"recompute-mismatch", recorded:"contained",
                recomputed:<the recomputed verdict>, detective:true } }
```

```
Given an L4 run whose ledger.discovered_scope_filed is 2
  and whose events contain zero containment-check events
When evalScopeDrift runs
Then it trips with evidence.drift_kind == "unrecorded-create"
     and evidence.discovered_scope_filed == 2
```

```
Given an L4 run with a recorded containment-check where data.root is false
  and data.verdict is "outward"
When evalScopeDrift runs
Then it trips with evidence.drift_kind == "outward-boundary-reach"
     and evidence carries that check's seq, issue, mandate and parent
```

```
Given an L4 scope-drift verdict flows through evaluateDerailment with no authority parameter
When the trip fold maps it via SIGNAL_TRIP_INTERVENTION
Then the aggregate intervention includes "pause"
     and no CORRECTABLE_SIGNAL / authority upgrade is consulted for it
```

- The predicate MUST perform no filesystem or subprocess I/O — it reads only `signals.ledger` and `signals.events`.
- A non-L4 run (`ledger.level` absent or != "L4") MUST return `null` regardless of any `containment-check` events present.
- Setting `signals.scope_drift = true` or an event's `data.scope_drift = true` MUST NOT, by itself, produce any scope-drift verdict (the self-report path is removed).

## 6. Design Decision Rationale

**How should drift be detected — self-report flag, a fresh scope walk, or the recorded containment stream?**
- Keep self-report: no work, but it is the defect — computes nothing. Rejected.
- Fresh independent scope walk: a second notion of scope, drifts from the preventive controls. Rejected by the reuse principle.
- Recorded containment stream via shared comparators: the same seam the preventive controls write, recomputable, already normalized into the sentry surface.
- **Chosen:** derive drift from the recorded `containment-check` events + `ledger` via `shared-infra`'s `subtreeContains`/`parseAncestry`, mirroring `faff audit`'s coherence checks — one containment notion, reused not re-implemented.

**Compute inline or child-spawn `faff audit --json`?** (full tradeoff in §3.)
- **Chosen:** inline pure predicate — all inputs already in the normalized surface, no subprocess on every poll, preserves the pure-predicate invariant, reuses the exact comparators.

**Should a confirmed drift bite, or stay advisory?**
- Keep `warn`→`continue`: leaves the signal toothless — the exact complaint in the ticket ("advisory-only, never trips any action at any level"). Rejected.
- Promote to `trip`→`abort`: a hard preventive on agent-sourced ancestry, forbidden by the FAFF-354 trust ceiling and out of scope. Rejected.
- Promote to `trip`→`correct`: `correct` is redispatch (thrash-shaped), authority-gated, and there is nothing to redispatch on a drift; how-hard-to-act is FAFF-763. Rejected.
- Promote to `trip`→`pause`, un-gated: gives the signal real teeth via the existing pause rung, stays a cooperative detective surface (L4-acts / L3-advisory through the unchanged `actsOnSentryAbort`/handling machinery), needs no new authority machinery.
- **Chosen:** `trip`→`pause`, un-gated, mirroring `budget-metering-degraded` (FAFF-447) — the precedent for landing a new trip-severity *detective* signal ("a blind spot, not a proven breach") without touching the authority/correctable path. The false-positive surface is contained by excluding the root-outward filing floor.

**Which scope level — L4-first, or also L3?**
- **Chosen:** L4-first, gated on `ledger.level === "L4"` (mirrors `evalBudgetMeteringDegraded`). The accepted-root envelope makes "outside scope" crisp; L3 "outside the admitted queue" is a different, fuzzier notion with no envelope to recompute against, so it is out of scope (§2) as a future increment.

**Is agent-sourced ancestry enough, or does it need an independent surface read?**
- **Chosen:** agent-sourced ancestry is sufficient for a *detective* structural signal — it is the same basis `faff contain`/`faff audit` already stand on (FAFF-354, ADR-0072). The verdict binds structure not truthfulness, and the evidence carries `detective:true` to say so. An independent surface read is FAFF-316 (unbuilt) and out of scope; this detector inherits, and does not worsen, the ceiling.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking — every design decision above is closed with a `**Chosen:**` grounded in the code and in FAFF-447/FAFF-354/ADR-0072 precedent. (Appetite is high; a single defensible answer was taken for each open question the issue raised.)

**Assumptions.**

**Assumes:** on the runs this detector targets, the `containment-check` event stream and `ledger.prd_root_container` are populated — i.e. L4 runs that invoked `faff contain --record`. Validate before building: confirm `contain.js --record` still appends `containment-check` events with `data.{mandate,parent,root,ancestry_raw,verdict}` (contain.js:160-192) and that `lights-out.js` still sets `ledger.prd_root_container` at L4 mint (lights-out.js:965). A run with zero containment activity yields no drift signal — this is stated non-firing behaviour, not a bug: the detector returns `null` at §4 steps 4-6 when there are no checks and nothing filed.

## 8. DONE — Definition of Done

### From WHY
- [ ] `scope-drift` is derived from behaviour (the recorded containment stream + ledger), not from `signals.scope_drift` / `data.scope_drift`; setting either flag alone produces no verdict.
- [ ] The detector reuses `subtreeContains`/`parseAncestry`/`CONTAIN_ROOT` from `shared-infra.js` — no re-implemented subtree walk and no second scope notion in `sentry.js`.
- [ ] The verdict is documented and shaped as detective (evidence carries `detective:true`); no hard-preventive/abort path is added.

### From WHAT (types and interfaces)
- [ ] `evalScopeDrift` returns `null` or `{signal:"scope-drift", severity:"trip", evidence:{drift_kind, accepted_root, detective:true, …}}` matching the record in §3.
- [ ] `evidence.drift_kind ∈ {"recompute-mismatch","unrecorded-create","outward-boundary-reach"}` with exactly the kind-specific fields (recompute-mismatch: `seq,issue,recorded,recomputed`; unrecorded-create: `discovered_scope_filed`; outward-boundary-reach: `seq,issue,mandate,parent`).
- [ ] `SIGNAL_TRIP_INTERVENTION["scope-drift"]` is `"pause"` (was `"continue"`); `scope-drift` is absent from `CORRECTABLE_SIGNAL`/the authority upgrade path.
- [ ] `normalizeSentrySignals` no longer emits a `scope_drift` key and no predicate reads `e.data.scope_drift`.

### From HOW (behaviour)
- [ ] Non-L4 run (`ledger.level` absent or `!== "L4"`) → `null`, regardless of any `containment-check` events.
- [ ] L4 run, a `containment-check` whose recorded verdict differs from `recompute_verdict(d)` → trips with `drift_kind:"recompute-mismatch"` and `recorded`/`recomputed` set (malformed `ancestry_raw` → `recomputed:"unreproducible"`).
- [ ] L4 run, `discovered_scope_filed > 0` with zero `containment-check` events → trips with `drift_kind:"unrecorded-create"` and `discovered_scope_filed` echoed.
- [ ] L4 run, a `containment-check` with `root != true` and `verdict:"outward"` → trips with `drift_kind:"outward-boundary-reach"` carrying that check's `seq,issue,mandate,parent`.
- [ ] A `trip` scope-drift verdict makes `evaluateDerailment`'s aggregate `intervention` at least `"pause"`, with no authority parameter consulted.

### From HOW (edge cases)
- [ ] L4 run whose only `containment-check` has `root:true, verdict:"outward"` (the filing floor), recomputes cleanly, with `discovered_scope_filed` matching → `null`.
- [ ] L4 run with all-`contained`, cleanly-recomputing checks and `discovered_scope_filed` 0/absent → `null`.
- [ ] When more than one drift kind is present, exactly one verdict is returned, chosen by precedence recompute-mismatch > unrecorded-create > outward-boundary-reach.
- [ ] The predicate performs no filesystem/subprocess I/O (reads only `signals.ledger`/`signals.events`).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Build a normalized surface s with:
       s.ledger = { level:"L4", prd_root_container:"FAFF-700",
                    discovered_scope_filed: 1 }
       s.events = [ { type:"containment-check", seq:5, issue:"FAFF-900",
                      data:{ mandate:"FAFF-700", parent:"FAFF-401", root:false,
                             ancestry_raw:"<a chain that recomputes to outward>",
                             verdict:"outward" } } ]
  2. v = evalScopeDrift(s)
  3. ASSERT v.signal=="scope-drift" AND v.severity=="trip"
       AND v.evidence.drift_kind=="outward-boundary-reach"
       AND v.evidence.accepted_root=="FAFF-700"
  4. r = evaluateDerailment(s, thresholds, /*authority*/ undefined)
  5. ASSERT r.tripped == true AND r.intervention is at least "pause"
```

confidence: high
spec-review: approve

## Methodology critique

**Right-sized?** No issues. The spec is one 1-3 day unit: a single pure-predicate rewrite (`evalScopeDrift` in `sentry.js`), its unit tests, one `SIGNAL_TRIP_INTERVENTION` map-entry flip, and the deletion of the self-report line in `normalizeSentrySignals`. The three drift kinds (recompute-mismatch, unrecorded-create, outward-boundary-reach) are facets of one detector over one containment stream, not structurally independent concerns that could ship separately, so they belong together. The teeth-promotion (warn→trip→pause) correctly ships *with* the detector rather than as a separate ticket.

**Workstream fit?** No issues. The spec encodes a single, outcome-shaped deliverable — "L4 mandate/containment creep is caught live by a behaviour-derived detective" — with one signal, one predicate, one intervention. The explicitly-excluded L3 drift, truthfulness verification (FAFF-316), and acting-model de-levelling (FAFF-763) are all cleanly carved out to their own homes.

**Deps surfaced?** No issues. The load-bearing couplings are all named and correctly classified: reuse of `subtreeContains`/`parseAncestry`/`CONTAIN_ROOT` from `shared-infra.js` (Done substrate), the FAFF-717 `actsOnSentryAbort` machinery (Done), the FAFF-354/ADR-0072 trust ceiling (documented caveat), FAFF-763 as the out-of-scope owner of *when* the sentry acts. The two runtime couplings — `contain.js --record` emitting `containment-check` events, `lights-out.js` minting `ledger.prd_root_container` — are surfaced as explicit validate-before-build assumptions.

**Risk profile?** The change promotes `scope-drift` to a biting `pause` on unattended L4 runs for all three drift kinds at once, but their false-positive profiles differ. Recompute-mismatch and unrecorded-create flag genuine incoherence (near-zero false positive). Outward-boundary-reach carries an acknowledged false-positive path: a human-sanctioned non-root outward reach still trips (the sentry cannot see the sanction), so an overnight run could pause on a sanctioned reach until a human clears it in the morning. Sequencing option to weigh (not a defect — the spec consciously accepts the andon trade-off): land recompute-mismatch + unrecorded-create at `pause` immediately, and hold outward-boundary-reach at a softer/observe posture for one field cycle to measure the sanctioned-reach false-positive rate before it pauses real runs.

Methodology: faffter-dark-methodology-agile-delivery
