# FAFF-1040 — Code-blind holdout guarantee at unattended L3

> Spec: faffter-dark-nlspec · 2026-09-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1040.
> Revised 2026-09-24 — re-scoped to holdout-guarantee-only (operator comment); folds in the FAFF-1073 spike verdict + the conditions×capabilities reframe; supersedes the four-mechanism draft earlier in this thread and its `reject-approach`.
> Revised 2026-09-25 (mid-build, operator-directed) — **removed the config opt-in entirely.** Holdout activation is a pure function of run facts — unattended × can-run (SUT exposable over the code-blind boundary + born-verifiable DoD) × caged — exactly as admissibility is required for any unattended run (FAFF-1072/ADR-0130), with no per-mechanism config toggle. This dissolves both prior Punts (config shape, cost budget): there is no `l3_safety.holdout` leaf and no `opted_in` ledger field; "which tickets" is capability-determined (pass-through where no exposable SUT), not config-flagged.

**Artifact:** an nlspec spec for FAFF-1040, decision-first. Its primary deliverable is **ADR-0131**, which settles the activation posture for the code-blind holdout guarantee and generalises it off the `level === "L4"` label onto run facts, plus the enabling predicate-widening and ledger persistence. **Audience:** the build agent (who lands ADR-0131 and the wiring) and human reviewers (who ratify the fact-based activation posture). The core question was already answered by the FAFF-1073 spike; this spec records that answer and wires it.

## 1. WHY — Problem and Principles

**The load-bearing model.** The holdout guarantee's activation is a **pure function of run facts, not a level label and not a config opt-in**: `is the run unattended? × can holdout run? × is it caged?`. "Can holdout run" means the DoD is born-verifiable **and** a system-under-test can be exposed as an interface over the code-blind boundary (a standable SUT). The three facts pick one of three postures — **strict block-on-fails**, **offer-and-report** (human decides), or **pass-through labelled with the missing capability**. This is the same fact-based template FAFF-1072 shipped for the custody stamp (ADR-0130); FAFF-1040 is the named follow-up that applies it to the holdout guarantee, which ADR-0130 line 22 explicitly deferred. **There is no per-mechanism config toggle** — exactly as admissibility is *required* for any unattended run keyed on run facts (never a config opt-in), so is holdout. Adding an `l3_safety.holdout`-style leaf would contradict the very "gate on facts, not a flag" principle this generalises.

**Problem statement.** Today the holdout gate fires only at `level === "L4"` (`decideFloor` contract-defs.js:2311; the two merge-gate ternaries at :1083/:1418), so an unattended **L3** run merges to `main` with no code-blind check even when it could run one, and an L4 run with no born-verifiable DoD or no SUT **parks on a non-defect** ("holdout: missing"). This change re-keys the guarantee's activation on the underlying facts, so it fires wherever it is viable and steps aside — visibly labelled — wherever it is not.

**Design principles.**

**Key on the fact, resolve it through a shared pure predicate.** ADR-0130's precedent is binding: no new `level === "L4"` activation test. The new resolver mirrors `requiresSelfConsistencyStamp` (contract-defs.js:2270) in shape and `resolveIntegrity`'s `unattended = level === "L4" || (level === "L3" && declaredUnattendedFromConfig(cfg))` (merge-gate.js:534-537) in how the attendedness fact is derived.

**Never park on a non-defect, never silent-green.** A missing capability is not a failure and not a pass. Pass-through must be **labelled with which capability was missing**, recorded on the merge result, so an operator can tell "holdout stood aside because there was no SUT" from "holdout ran and passed".

**Cage is a capability to detect, not a blanket blocker.** Absence of a proven cage routes to pass-through-labelled, never to refuse. The cage is launched by an outer orchestration layer (ADR-0041), so absence of the evaluator lane-boundary emit is not absence of cage — `laneBoundaryPromisesCage` (merge-gate.js:622-633) detects the promise, it does not demand it.

**The binding floor must not be re-derived from live, mutable config.** The resolved posture is stamped once at mint and read back from the run-ledger, never recomputed from a `.faffrc` that may have been edited between mint and merge (see Failure Modes: fail-open-on-resume).

**A capability read distinguishes "absent" from "faulted" — a plumbing fault never becomes pass-through.** The capability facts (`can_run` via `dodClassify`/`computeEnvHandle`, `caged` via `laneBoundaryPromisesCage`) are read at merge-consult time, so their failure direction is load-bearing. A read has **three** outcomes, not two: **satisfied** (the fact holds), **absent** (the artifact is legitimately not there — ENOENT, no SUT declared — so holdout genuinely cannot run), and **faulted** (the artifact exists but is unreadable, torn-down/`terminated`, or stale). Only **absent** routes to pass-through; **faulted never does** — it fails safe (strict when unattended, else needs-human). This mirrors `laneBoundaryPromisesCage`'s own ENOENT-→absent / unreadable-→fail-safe-arm discipline (merge-gate.js:622-633), and it is what stops the generalisation from *inverting* today's L4 fail-closed posture (an absent/unreadable `holdout.json` today makes `readHoldout` return `missing`/`blocked` → `decideFloor` blocks; a naive `can_run:false`-on-any-failure would turn that into a silent skip).

**Reference context.**

| Site | Lang | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js:2303-2317` (`decideFloor`), `:2311` | JS | The core seam: `if (f.level === "L4" && f.holdout !== "meets-spec")`. Folds in the posture. |
| `plugin/skills/faff/bin/lib/contract-defs.js:2270-2272` (`requiresSelfConsistencyStamp`) | JS | The pure-predicate template the new resolver mirrors. |
| `plugin/skills/faff/bin/lib/merge-gate.js:534-537` (`resolveIntegrity`) | JS | The fact-based `unattended = L4 || (L3 && declaredUnattendedFromConfig(cfg))` template to reuse. |
| `plugin/skills/faff/bin/lib/merge-gate.js:1083` (`cmdMergeGateLocal`), `:1418` (`cmdMergeGate`) | JS | The two `holdout: level === "L4" ? … : "not-applicable"` ternaries to widen. |
| `plugin/skills/faff/bin/lib/merge-gate.js:697-719` (`readHoldout`) | JS | Reads holdout.json fail-closed; freshness via `holdoutIsFresh`; arms `requireSpawnerAttested` via `laneBoundaryPromisesCage`. Unchanged; now consulted per posture. |
| `plugin/skills/faff/bin/lib/merge-gate.js:622-633` (`laneBoundaryPromisesCage`) | JS | caged? — already gate-consumed. |
| `plugin/skills/faff/bin/lib/admissibility.js:226-268` (`dodClassify`) | JS | born-verifiable? — `counts.scenario + counts.assertion === 0` is condition-(a). CLI `faff dod classify`. |
| `plugin/skills/faff/bin/lib/contract-defs.js:725-726` (`ENV_HANDLE_STATUSES`, `computeEnvHandle`) | JS | standable SUT? — `status: "ready"` is the only gate-passing status. |
| `plugin/skills/faff/bin/lib/sentry.js:226-228` (`literalTrue`), `:251-253` (`declaredUnattendedFromConfig`) | JS | The unattended fact from config. `literalTrue` accepts `"TRUE"`/`"true"`/bool `true`. |
| `plugin/skills/faff/bin/lib/lights-out.js:1158-1194` (L4 mint ledger object) | JS | Additive seam for the persisted posture, alongside `floor`/`dial_profile`. |
| `plugin/skills/faff/bin/lib/run-ledger.js:127` (`buildSelfDrainLedger`, `SELF_DRAIN_LEVEL`) | JS | The L3 self-drain (beep-boop) mint — where the unattended fact is captured. |
| `plugin/skills/faff/bin/lib/lights-out.js:88` (`LIGHTS_OUT_GUARDRAILS` holdout entry) | JS | The per-unit L4 holdout guardrail row; its `rechecked: true` now covers the widened activation. |
| `records/adr/0130-…md:22` | md | ADR-0130 explicitly declined to generalise the holdout guarantee. ADR-0131 is the named follow-up that does; cite + amend. |

**Scope statement.** This sits in the merge-floor trust machinery — the same `decideFloor` + merge-gate consult path FAFF-1072 (custody) and FAFF-420/384 (holdout freshness + cage) already occupy.

## 2. OUT OF SCOPE

- **Adversarial review activation.** Excluded — it is a slot-occupant choice (`spec_review`/`review` slot), not a flag gated on run facts. Extension point: `.faffrc` `slots:` config and the `faffter-dark-adversarial-review` skill.
- **Admissibility gate + custody self-consistency stamp.** Excluded — extracted to **FAFF-1072 (Done, ADR-0130, PR #927)**. Do not re-open. Extension point: `requiresSelfConsistencyStamp` (contract-defs.js:2270) and the admissibility pre-build screen.
- **The run-level holdout phase (beep-boop step 10b).** Excluded — the `LIGHTS_OUT_GUARDRAILS` holdout row's `rechecked: true` covers only the **per-unit** merge-floor holdout (lights-out.js:84-88 states this limit); the run-level phase has no re-checked artifact. Extension point: beep-boop step 10b.
- **The FAFF-1061 interactive advisory resolver.** Excluded from the binding floor — `resolveInteractiveVerification` (config.js:723-732) short-circuits all-false on any unattended run, which is the opposite of what the binding floor needs. It remains the surface for the **offer** posture (interactive), untouched. Extension point: `faff verification resolve`.
- **The `env`/`evaluator`/`transport` producers that stand up and judge the holdout.** Excluded — this ticket consumes their outputs (env-handle, holdout.json), it does not change them.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Holdout guarantee | The code-blind evaluator's verdict (`holdout.json` → `meets-spec` \| `missing` \| `blocked`) folded into the merge floor. |
| Posture | The activation stance the resolver picks: `strict` (block-on-fails), `offer` (advisory, human decides), `pass-through` (never blocks, labelled). |
| Can-run | Capability fact: the DoD is born-verifiable (`dodClassify` scenario+assertion count > 0) **and** a SUT stands up (`env-handle status === "ready"`). |
| Caged | Capability fact: `laneBoundaryPromisesCage(runDir)` — the evaluator ran repo-absent in its own container. |
| Unattended | Condition fact: `level === "L4" || (level === "L3" && declaredUnattendedFromConfig(cfg))`, resolved once at mint. |

**Type definitions.**

```
ENUM HoldoutPosture: strict | offer | pass-through
ENUM CapabilityRead: satisfied | absent | faulted   # three-way, NOT a bool — see the fault-channel principle

RECORD HoldoutCapabilities:
  can_run: CapabilityRead  # satisfied = born-verifiable DoD AND env-handle status "ready";
                           # absent    = no SUT declared / no born-verifiable criteria (legit can't-run);
                           # faulted   = env-handle unreadable / "terminated" / stale, or dodClassify errored
  caged:   CapabilityRead  # satisfied = laneBoundaryPromisesCage; absent = no cage promised (ENOENT);
                           # faulted   = lane-boundary.json unreadable/malformed

RECORD HoldoutPostureResult:
  posture: HoldoutPosture
  missing: List<String>   # non-empty ONLY when posture == pass-through;
                          # e.g. ["no-born-verifiable-dod", "no-standable-sut", "no-proven-cage"]
  fault:   List<String>   # non-empty ONLY when a capability read faulted (drives the fail-safe branch);
                          # e.g. ["env-handle-terminated", "lane-boundary-unreadable"]

# Additive run-ledger field, stamped once at mint (lights-out.js:1158 / run-ledger.js:127),
# read back at merge via readLedger(runDir) — NEVER re-derived from live .faffrc.
RECORD LedgerHoldoutGuarantee:
  unattended: Bool        # the resolved attendedness fact at mint (L4 || (L3 && declaredUnattendedFromConfig))
                          # L4 mint: unattended = true by construction. NO opted_in field — activation is
                          # fact-based (unattended × can_run × caged), never a config opt-in.
```

**decideFloor input widening.** `FloorInputs` gains one field; `holdout` keeps its meaning.

```
RECORD FloorInputs (additions only):
  holdout_posture: HoldoutPosture   # resolved by the caller (merge-gate) before decideFloor
  holdout_missing: List<String>     # carried through for the labelled result; never affects verdict
  holdout_fault:   List<String>     # carried through + surfaced on the merge record so a fault is diagnosable
                                    # (the failure-mode "how you'd know" needs a guaranteed surface); never affects verdict
  # existing: level, holdout, ac_complete, review_verdict, ci_state, integrity, decision_grant, …
```

**Design decision — the binding fact source.**
**Chosen:** the merge floor reads `unattended` from the **run-ledger** (`readLedger(runDir)`, mint-time-resolved), not from live config. Rationale in Failure Modes (fail-open-on-resume); this is the FAFF-1072 mint-resolved-once precedent (`floor`/`dial_profile` are already resolved at mint).

## 4. HOW — Behavior

**Architecture.** A new pure predicate `resolveHoldoutPosture` lives beside `requiresSelfConsistencyStamp` in `contract-defs.js`. The two merge-gate call sites (:1083, :1418) compute the capability facts and the mint-persisted condition fact, call the resolver, and pass `holdout_posture` + `holdout_missing` into the `floor` object. `decideFloor` blocks **only** when the posture is `strict` and the verdict is not `meets-spec`. The `offer` posture is never reached inside `decideFloor` (it is an interactive path the FAFF-1061 resolver already surfaces); `decideFloor` sees only `strict` or `pass-through`.

**Behaviour summary — the resolver.** Given the three facts, pick the posture; when a capability is missing, name every missing one.

```
PROCEDURE resolveHoldoutPosture(unattended, caps):    # caps: HoldoutCapabilities (three-way reads)
  fault   = []
  IF caps.can_run == faulted:  fault += ["can-run-read-faulted"]
  IF caps.caged   == faulted:  fault += ["cage-read-faulted"]
  1. IF fault is non-empty:                              # FAIL-SAFE — a plumbing fault, never a silent skip
       IF unattended:
         RETURN { posture: strict, missing: [], fault }  # keeps today's L4 fail-closed: a faulted read blocks
       ELSE:
         RETURN { posture: offer,  missing: [], fault }  # interactive: surface the fault, human decides
  missing = []
  IF caps.can_run == absent:  missing += ["no-born-verifiable-dod-or-standable-sut"]
  IF caps.caged   == absent:  missing += ["no-proven-cage"]
  2. IF missing is non-empty:                            # LEGITIMATE can't-run — honest pass-through
       RETURN { posture: pass-through, missing, fault: [] }   # never park on a non-defect
  3. IF unattended:                                      # all satisfied
       RETURN { posture: strict, missing: [], fault: [] }     # block-on-fails, viable now
  4. ELSE:
       RETURN { posture: offer, missing: [], fault: [] }      # interactive: report, human decides
```

**Fault precedence is deliberate:** `faulted` is evaluated **before** `absent`, so a torn-down/unreadable capability artifact can never be mistaken for a legitimate no-capability and silently skipped. A faulted read on an unattended run resolves `strict` (block), preserving the pre-generalisation fail-closed direction exactly.

**Behaviour summary — the floor fold.** Replace the level test with the posture test; pass-through and offer never block.

```
PROCEDURE decideFloor(f):   # only the holdout leg shown; every other leg unchanged
  ...
  IF f.holdout_posture == "strict" AND f.holdout != "meets-spec":
     blockers += ["holdout guarantee (strict): " + f.holdout + " (need meets-spec)"]
  # posture == "pass-through": no blocker; f.holdout_missing is surfaced on the result, not blocked
  # posture == "offer": unreachable in the binding floor (interactive advisory path only)
  ...
```

**Behaviour summary — the merge-gate ternaries (:1083 and :1418, identical shape).** Compute facts, resolve posture, read holdout when the posture is not pass-through.

```
PROCEDURE build_floor_holdout_leg(runDir, issue, level, cfg):
  1. ledger = readLedger(runDir)                          # mint-resolved facts (NOT live cfg)
  2. unattended = ledger.holdout_guarantee.unattended     # stamped at mint; fail-closed to false if absent
  3. caps = {
       can_run: readCanRun(spec, envHandle),              # three-way — see below
       caged:   readCaged(runDir),                        # three-way — see below
     }
  4. { posture, missing, fault } = resolveHoldoutPosture(unattended, caps)
  5. holdout = (posture == "pass-through") ? "not-applicable" : readHoldout(runDir, issue)
  6. RETURN { holdout, holdout_posture: posture, holdout_missing: missing, holdout_fault: fault }

PROCEDURE readCanRun(spec, envHandle):                    # -> CapabilityRead
  IF dodClassify errors                     -> faulted
  born = dodClassify(spec).counts.scenario + .counts.assertion
  IF envHandle artifact absent (ENOENT)     -> absent    # no SUT declared: legit can't-run
  h = computeEnvHandle(envHandle)
  IF h unreadable/malformed                  -> faulted
  IF h.status in {"terminated","failed"} OR NOT envHandleFresh(h)  -> faulted   # torn-down/stale != absent
  IF born == 0                               -> absent    # no born-verifiable criteria
  IF h.status == "ready"                     -> satisfied
  ELSE                                       -> faulted    # provisioning/unknown mid-state, never silent skip

PROCEDURE readCaged(runDir):                              # -> CapabilityRead
  IF lane-boundary.json absent (ENOENT)      -> absent     # no cage promised
  IF lane-boundary.json unreadable/malformed -> faulted
  RETURN laneBoundaryPromisesCage(runDir) ? satisfied : absent
```

**env-handle liveness (the architectural observation, same root/fix).** `computeEnvHandle` is a transient the evaluator stands up and **tears down before the merge floor consults** (`terminated` = "already torn down — not gate-passing", contract-defs.js:3305), and merge-gate does not consume it today — so this is a *new* merge-time read of an artifact whose lifecycle predates it. `readCanRun` therefore needs a **freshness guard** (`envHandleFresh`, mirroring `readHoldout`'s `holdoutIsFresh`, merge-gate.js:600-602) and treats `terminated`/`failed`/stale as **faulted**, not as a clean `absent` — so a post-teardown or snapshot-stale handle fails safe, never no-ops the guarantee to pass-through.

**Persistence at mint (the fail-open-on-resume fix).** At L4 mint (lights-out.js:1158-1194) and L3 self-drain mint (run-ledger.js:127, `buildSelfDrainLedger`), stamp the resolved `holdout_guarantee` object alongside `floor`/`dial_profile`. The merge consult reads it back via `readLedger`; it is never re-derived from `.faffrc`.

```
AT MINT:  ledger.holdout_guarantee = {
            unattended: (level == "L4") || (level == "L3" && declaredUnattendedFromConfig(cfg)),
          }   # no opted_in — activation is fact-based; `declaredUnattendedFromConfig` is the SAME
              # attendedness axis admissibility uses, not a holdout-specific opt-in.
AT MERGE: read ledger.holdout_guarantee — DO NOT call loadConfig for this fact.
```

**Edge cases and precedence.**

- **Ledger absent / `holdout_guarantee` missing** (a pre-feature run, or unreadable ledger) → `unattended = false` → resolver yields `offer` or `pass-through`, never `strict`. Fail-closed toward not-blocking-silently: a legacy run without the stamp keeps today's behaviour for L4 via a compatibility read (below), and never newly blocks an L3 run whose posture was never resolved.
- **L4 back-compat.** For an L4 ledger with no `holdout_guarantee` field (minted before this ships), treat `unattended = true` (L4 is unattended by construction) so an in-flight L4 run keeps blocking on holdout. New L4 mints carry the field.
- **`readHoldout` freshness/cage arming** (merge-gate.js:711-716) is unchanged and runs only when the posture is not pass-through.
- **Missing-capability precedence** — pass-through wins over unattended: an unattended run that cannot run holdout is `pass-through`, not `strict` (you cannot block on a check that cannot execute).

**Anti-pattern:** re-deriving `unattended` from `loadConfig(cwd)` inside the merge consult. Why: the floor is re-derived live on every consult (merge-gate.js:1057/1390), so a `--resume` after a config edit silently flips the binding posture. Read the mint-stamped ledger value.

**Anti-pattern:** treating absence of a `lane-boundary.json` evaluator emit as "not caged" → refuse. Why: the cage is launched by an outer layer (ADR-0041); absence is detected as pass-through-labelled, never refused.

**Failure modes.**

- **The failure:** fail-open-on-resume — an unattended run whose guarantee resolved to `strict` at mint is re-entered after a crash/`--resume` from a `.faffrc` with `autonomous.unattended` removed, and a live re-derivation would silently resolve `unattended` false and the gate off, merging with no record. **How you'd know:** a merge-record showing `holdout_posture: pass-through` on a run whose mint ledger says `unattended: true`. **What it means:** proceed only with the ledger-persisted read; this is why persistence is Chosen, not a punt.
- **The failure:** the `"TRUE"`-coercion trap — assuming a quoted-YAML `"TRUE"` coerces to `false`. It does not: `literalTrue` (sentry.js:227) lower-cases and accepts it. **How you'd know:** a config selftest (config.js:813 precedent) asserting `"TRUE"` → true. **What it means:** proceed; do not add a "handle the string case" workaround — it already works.
- **The failure:** the L4-generalisation loosens a real gate — an L4 no-SUT run that used to hard-block on `holdout: missing` now passes through. **How you'd know:** an L4 merge-record with `holdout_posture: pass-through, missing: [no-born-verifiable-dod-or-standable-sut]`. **What it means:** proceed — this is the intended correction (condition-(a) = 19.3% of specs are non-born-verifiable; forcing holdout there parks a non-defect). ADR-0131 must own this as an amendment to ADR-0130 line 22. **This is the *legitimate-absent* case only** — a faulted read is caught by the fault channel below and does NOT reach pass-through.
- **The failure (fail-open-on-capability-fault — the infosec-major this revision closes):** a naive `can_run = boolean(read succeeded && true)` would collapse "no SUT declared" and "env-handle unreadable/torn-down/stale" into one `false`, routing both to pass-through — so a plumbing fault at an unattended run would **silently skip** the holdout and **invert** today's L4 fail-closed posture (absent/unreadable `holdout.json` → `readHoldout` → `missing`/`blocked` → block). **How you'd know:** an unattended merge-record with `holdout_posture: pass-through` whose `env-handle`/`lane-boundary` artifact was actually present-but-unreadable or `terminated`. **What it means:** the three-way `CapabilityRead` (satisfied/absent/faulted) + fault-before-absent precedence is load-bearing, not a nicety: `faulted` → `strict` (unattended) / `offer` (interactive), never `pass-through`. Mirror `laneBoundaryPromisesCage`'s ENOENT-vs-unreadable discipline and `readHoldout`'s freshness guard.

## 5. Scenarios

```
Given an unattended run (ledger holdout_guarantee.unattended == true), a born-verifiable DoD, a ready SUT, and a proven cage
When the merge floor resolves the holdout posture
Then the posture is "strict" and a non-meets-spec holdout verdict produces a merge blocker
```

```
Given an unattended run with a born-verifiable DoD but no standable SUT (env-handle artifact absent / ENOENT — no SUT declared)
When the merge floor resolves the holdout posture
Then the posture is "pass-through", the result carries missing == ["no-born-verifiable-dod-or-standable-sut"], and the merge is not blocked on holdout
(NB: a present-but-not-"ready" env-handle is "faulted", not "absent" — that routes to strict, per the faulted scenario below; only a genuinely-absent artifact reaches this pass-through)
```

```
Given an interactive run (unattended == false) with can-run and cage both present
When the holdout posture is resolved
Then the posture is "offer" and decideFloor pushes no holdout blocker (the FAFF-1061 advisory surface reports the verdict)
```

```
Given an unattended run that can run holdout but has no proven cage (laneBoundaryPromisesCage == false)
When the holdout posture is resolved
Then the posture is "pass-through" with missing == ["no-proven-cage"] — cage is a capability to detect, never a blocker
```

```
Given an unattended run whose guarantee resolved "strict" at mint, then re-entered via --resume from a .faffrc with autonomous.unattended removed
When the merge floor is consulted
Then the posture is still "strict" (read from the mint-stamped ledger), not silently flipped to pass-through
```

```
Given an unattended run whose env-handle artifact reads "terminated" (torn down) or is unreadable at merge-consult time
When readCanRun classifies the capability and resolveHoldoutPosture runs
Then can_run is "faulted" (not "absent"), the posture is "strict" with fault non-empty, and the merge blocks — a plumbing fault never becomes a silent pass-through (preserves today's L4 fail-closed)
```

```
Given an unattended run with NO SUT declared (env-handle artifact genuinely absent, ENOENT)
When readCanRun classifies the capability
Then can_run is "absent", the posture is "pass-through" labelled "no-...-standable-sut" — the legitimate can't-run case, distinct from a fault
```

- The resolver is a pure function of `(unattended, caps)` — the same value inputs always yield the same posture (assertion, unit-testable).
- `faulted` is evaluated before `absent`; a faulted capability read on an unattended run never yields `pass-through` (assertion — the fail-safe direction).

## 6. Design Decision Rationale

**Where does the holdout guarantee's activation key?**
- Options: (a) keep `level === "L4"`; (b) generalise onto run facts via a shared predicate.
- (a) leaves unattended L3 uncovered and parks L4 no-SUT runs on non-defects. (b) matches the FAFF-1073 spike and the ADR-0130 precedent.
- **Chosen:** (b) — a pure `resolveHoldoutPosture(unattended, caps)` predicate, mirroring `requiresSelfConsistencyStamp`. This is ADR-0131, the named follow-up ADR-0130 line 22 deferred.

**What are the postures, and does a missing capability block?**
- Options: two-state (block / not-applicable) vs three-state (strict / offer / pass-through with labelled miss).
- Two-state cannot distinguish "stood aside, no SUT" from "ran, passed" and re-creates the non-defect park.
- **Chosen:** three-state; a missing capability → `pass-through` labelled with which; cage-absence detects to pass-through, never refuse. (Spike: "cage is a capability to detect, not a blanket blocker.")

**Where is the binding attendedness fact read from?**
- Options: live `loadConfig` at each consult (today's `resolveIntegrity` inline derivation) vs mint-stamped ledger read-back.
- Live re-derivation fails open on `--resume` after a config edit (Failure Modes). The floor is already re-derived live on every consult (merge-gate.js:1057/1390).
- **Chosen:** stamp the resolved `holdout_guarantee` at mint (lights-out.js:1158 / run-ledger.js:127), read via `readLedger`. Same precedent as `floor`/`dial_profile` (resolved once at mint).

**Does generalising loosen the L4 gate?**
- Yes, for L4 no-SUT / non-born-verifiable runs (now pass-through, previously hard-block).
- **Chosen:** accept and record it — condition-(a) = 19.3% of specs are non-born-verifiable; the spike grounds this as removing false parks, not weakening real coverage. ADR-0131 amends ADR-0130 line 22.

**Is there a config opt-in for the holdout guarantee?**
- Options: (a) a per-mechanism opt-in leaf (`l3_safety.holdout`) the resolver ANDs in; (b) no config — activation is purely fact-based.
- (a) contradicts the fact-based principle this generalises: admissibility is *required* for any unattended run with no toggle (FAFF-1072). A holdout opt-in would let an unattended, caged, standable run silently skip the code-blind gate on a config default — the exact silent-skip the fault channel exists to prevent.
- **Chosen:** (b) no config opt-in (operator-directed, 2026-09-25). Activation = `unattended × can_run × caged`, all run facts. `declaredUnattendedFromConfig` remains the attendedness axis (shared with admissibility), which is a condition, not a holdout-specific opt-in.

**Which tickets get holdout — whole queue or a subset?**
- Not a config choice. The "subset" is **capability-determined**: a ticket with a code-blind-exposable SUT + born-verifiable DoD gets `strict` (unattended) or `offer` (interactive); one without gets `pass-through` labelled. The spike showed standup is cheap where a SUT exists (~2.7s, 0 faults), so attempting across the eligible queue costs little, and the no-SUT majority pass through by construction — no flagging mechanism.

*Temporal anchor:* at the time of writing, `verification.holdout` (config.js:329) exists but is FAFF-1061 advisory-only (short-circuits off for unattended); it is a *different axis* (the attended opt-in-to-see surface) and this ticket adds **no** binding config leaf at all.

## 7. Open Questions and Assumptions

**Open Questions.** None material. Both earlier Punts (cost budget; config shape) were dissolved by the operator-directed removal of the config opt-in (2026-09-25): activation is fact-based, and "which tickets" is capability-determined, so neither is an open decision. A future *different* mechanism (not holdout) wanting a per-level binding leaf would revisit config shape then — out of scope here.

**Assumptions.**
- **Assumes:** ADR-0131 lands on top of `origin/main`, which carries FAFF-1072's ADR-0130 and FAFF-1073's spike artifacts; the current dev worktree is on an older branch (`faff-1075-…`). *Validate:* `git log origin/main --oneline | grep -E "FAFF-1072|FAFF-1073"` before authoring, and rebase the ADR onto `origin/main`.
- **Assumes:** `readLedger` (exported from `shared-infra`, consumed widely incl. config.js:670/698/761) is the canonical mint-ledger reader available at the merge consult. *Validate:* confirm `readLedger` import in `merge-gate.js` or add it.
- **Assumes:** the spec text and env-handle needed for `dodClassify` / `computeEnvHandle` capability facts are reachable at merge-consult time (spec on the branch, env-handle artifact in the run dir). *Validate:* confirm the run-dir artifacts exist where the ternary runs.

## 8. DONE — Definition of Done

### From WHY
- [ ] ADR-0131 is written (Context/Decision/Consequences), cites and amends ADR-0130 line 22, and records the fact-based holdout activation posture + the L4-generalisation consequence.
- [ ] No new `level === "L4"` holdout activation test is introduced; activation keys on run facts.

### From WHAT (types and interfaces)
- [ ] `resolveHoldoutPosture(unattended, caps)` returns `{ posture, missing }` with `posture ∈ {strict, offer, pass-through}` and `missing` non-empty only for pass-through.
- [ ] The run-ledger carries a `holdout_guarantee { unattended }` object at L4 mint (lights-out.js:1158) and L3 self-drain mint (run-ledger.js:127). No `opted_in` field — activation is fact-based.
- [ ] `FloorInputs` carries `holdout_posture`, `holdout_missing`, and `holdout_fault` (the last surfaced on the merge record so a fault is diagnosable); every existing field is unchanged.

### From HOW (behaviour)
- [ ] `decideFloor` pushes a holdout blocker iff `holdout_posture === "strict" && holdout !== "meets-spec"`; pass-through and offer never block.
- [ ] Both merge-gate ternaries (:1083, :1418) compute caps, read the mint-stamped `unattended`, resolve the posture, and read holdout only when posture != pass-through.
- [ ] `unattended` at the binding floor is read via `readLedger`, never from `loadConfig` at consult time.
- [ ] `missing` is surfaced on the merge result/record when posture is pass-through (labelled, not silent).

### From HOW (edge cases)
- [ ] An L4 ledger with no `holdout_guarantee` field resolves `unattended = true` (back-compat: in-flight L4 keeps blocking). *(fixture — the fail-closed-direction edge.)*
- [ ] An absent/unreadable ledger resolves `unattended = false` (never newly `strict`). *(fixture — the fail-closed-direction edge.)*
- [ ] `--resume` from a config with `autonomous.unattended` removed keeps the mint-stamped `unattended` (no fail-open).
- [ ] `readCanRun`/`readCaged` return the three-way `CapabilityRead`: a genuinely-absent artifact (ENOENT) → `absent` → pass-through; an unreadable / `terminated` / stale artifact → `faulted` → strict (unattended) / offer, **never** pass-through. Freshness-guarded like `readHoldout`.
- [ ] A faulted capability read on an unattended run yields `strict` (blocks), not `pass-through` — a covered scenario, the fail-safe direction.

### Config / eval coverage
- [ ] **No new config leaf** — activation is fact-based; the change adds no `l3_safety.*` key and touches neither `DEFAULTS` nor `WRITABLE_NAMESPACES`. (A test asserts the resolver ignores config for activation, keying only on ledger `unattended` + capability reads.)
- [ ] This change touches no LLM-judgement seam (pure predicate + wiring), so no grader/eval-case DONE item applies.

**Integration smoke test.**
```
1. Mint an L3 self-drain ledger with autonomous.unattended=true.
2. Assert ledger.holdout_guarantee == { unattended: true }.
3. With a born-verifiable spec + ready env-handle + cage promise, run the merge-gate consult.
4. Assert floor.holdout_posture == "strict"; a non-meets-spec holdout.json yields a merge blocker.
5. Remove the SUT (env-handle status != ready); re-consult.
6. Assert posture == "pass-through", missing includes the no-SUT label, and the merge is not blocked on holdout.
```

## Already shipped against this surface

- **FAFF-1072 / ADR-0130 (PR #927, Done):** shipped the fact-based activation template (`requiresSelfConsistencyStamp`, `resolveIntegrity(cfg)` threading) and explicitly declined to generalise the holdout guarantee (ADR-0130 line 22). This spec's ADR-0131 is that named follow-up.
- **FAFF-1073 (spike, Done):** shipped the decision this spec records — gate the guarantee on conditions and capabilities, not a level; the strict/offer/pass-through hand-back rule; and the grounding rates (condition-a = 19.3%, per-ticket standup ~2.7s/0-faults, cage a proven per-environment capability).
- **FAFF-1061 / FAFF-717 (Done):** shipped the interactive advisory axis (`resolveInteractiveVerification`, `faff verification resolve`, `verification.*`) and the Sentry attendedness axis (`declaredUnattendedFromConfig`, ADR-0103). This spec reuses the attendedness fact and leaves the advisory surface as the `offer` path.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4):** No issues. The re-scope fixes the earlier four-mechanism critique: holdout-only collapses it to one decision (ADR-0131) + the wiring that enacts it — always-ship-together, so a correct merge, not a smell. The two Punts (cost budget, config shape) are deferred to product/architecture, keeping the unit thin. No split.
- **Workstream fit (principles 1+5):** Surface — no outcome container for a coherent cluster. FAFF-1040/717/1072/1061/1043 converge on one outcome (making unattended L3 safe). Propose an outcome-led project ("unattended-L3 safety floor") grouping the live members so the ADR-0130-template generalisation sequences as owned critical path rather than scattered relatedTo edges. A human-confirmed proposal, not a write.
- **Deps surfaced (principle 6):** blockedBy FAFF-1073 (Done, satisfied) + related links present. One implicit capability dep: the resolver reads run facts (born-verifiable DoD / standable SUT / caged) that must actually be emitted by the env/transport/evaluator wiring — the fault channel now fails safe if they're absent/faulted, but confirm at build time whether they're emitted, else the strict path is unreachable in practice. (Assumption 3 flags artifact reachability.)
- **Risk profile (principle 7):** No further spike — FAFF-1073 de-risked the decision; ADR-first is the right shape. Residual risk is the resume/ledger path (fail-open-on-resume) — make it a born-verifiable DoD line and exercise it first (the highest-value increment). Now covered by a Chosen decision + scenario + DoD item.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen", "topic": "fact-based holdout activation posture (ADR-0131); NO config opt-in — required on run facts like admissibility" },
    { "marker": "chosen", "topic": "three-state resolver: strict/offer/pass-through; cage detects not blocks" },
    { "marker": "chosen", "topic": "three-way capability reads (satisfied/absent/faulted); faulted fails safe, never pass-through — preserves L4 fail-closed; env-handle freshness-guarded" },
    { "marker": "chosen", "topic": "persist resolved unattended fact into run-ledger at mint (fail-open-on-resume fix)" },
    { "marker": "chosen", "topic": "accept and record the L4 no-SUT generalisation (amends ADR-0130)" },
    { "marker": "chosen", "topic": "which tickets is capability-determined (pass-through where no exposable SUT), not a config-flagged subset" }
  ] }
```
