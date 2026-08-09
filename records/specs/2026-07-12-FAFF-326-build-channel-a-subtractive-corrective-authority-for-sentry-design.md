# Spec — FAFF-326: Build Channel A — subtractive corrective authority for Sentry

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-326.

*Build spec for FAFF-326. Audience: the build agent and human reviewers. It ships Channel A from ADR-0039 — stop-and-redispatch with a machine-authored corrective input, subtractive width only — behind the FAFF-373 integrity gate, so the whole mechanism is inert (degrades to Channel D, human relay) until FAFF-325 wires an un-forgeable integrity signal.*

## 1. WHY — Problem and Principles

**The load-bearing idea:** every redirect-shaped act faff performs safely today (respec, park→re-enter, abort→resume) happens while the supervised agent is *not running*, through orchestrator-lane artifacts. Channel A formalises that: a corrective input is authored by the orchestrator from its own closed surface, written to disk while the build lane is dead or not yet dispatched, and consumed by the orchestrator's own re-dispatch — never a message into a running lane. Safety comes from what the machine structurally cannot do: the input schema can only *narrow* a mandate (subtractive), never grant authority (additive).

**Problem statement.** Sentry-1 can only `continue | pause | abort` — a derailment either parks work or halts the run, even when a narrow, machine-derivable correction (tighten a threshold, forbid a surface, de-scope) would let the run proceed safely. ADR-0039 admitted Channel A GO-narrow; nothing implements it. This ticket builds the schema, authoring path, re-dispatch consumption, and the degrade paths.

**Design principles.**

- **Subtractive only, by construction.** The op vocabulary is a closed enum of narrowing operations. Additive intent is inexpressible in the schema; anything not in the enum fails validation and routes to park / needs-human. (ADR-0039 limit 1.)
- **Orchestrator-lane authoring, dispatch-boundary consumption.** Author post-abort or pre-dispatch from the closed orchestrator surface only; consume at the next dispatch via the existing resume-from-ledger path. No new write path into a running lane. (ADR-0039 limit 2.)
- **Gate-degraded until FAFF-325.** Consumption runs through `integrityGate(probe, "corrective")` (FAFF-373). Unasserted (the only production state today) → disposition `channel-D`: an on-disk corrective artifact is *never* acted on as authentic; it is surfaced for human relay. The `asserted:true` branch is exercised only via the pure-function seam in tests.
- **Never weaken abort.** Signals that route to `abort` today keep routing to `abort`. The new `correct` rung only ever replaces a `pause`-class response, and only when authority is available.
- **Deterministic tools over prose.** Schema validation, subtractive-width checks, citation checks, empty-mandate detection, and the integrity gate are CLI (pure cores + thin I/O + `--selftest`); only *whether/what* to correct is orchestrator judgement.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` | `SENTRY_INTERVENTIONS`, `SIGNAL_TRIP_INTERVENTION`, `normalizeSentrySignals` (AC5 allowlist), `evaluateDerailment`, `applySentryAbort` — the ladder this extends |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | FAFF-373 probe/gate + `correctiveIntegrityDirs(runDir)` — the single-sourced forge surface (`<run-dir>/corrective/` + `run-ledger.json`) |
| `plugin/skills/faff/bin/lib/events.js` | Closed `EVENT_TYPES` set — the append-only audit surface the citation trail lands on |
| `test/sentry.test.mjs` | AC5 no-write-path + AC6 no-`correct` guard — AC6 exists to be consciously extended here |
| `plugin/skills/faff-beep-boop/SKILL.md` | Between-units Sentry consult + mint-scoped intervention table — the acting site |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md`, `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | `BuildDispatch` — where a narrowed mandate reaches the build subagent |
| `plugin/skills/faff/bin/lib/lights-out.js` | `corrective_authority: available \| channel-D-only` capability flag (FAFF-373) |

**Scope statement.** This is the Sentry-2 build slice of the supervision workstream: it sits between FAFF-373 (the fail-safe gate, shipped) and FAFF-325 (the trust channel, shipped), and is validated live by FAFF-328.

## 2. OUT OF SCOPE

- **The integrity trust channel** (anything that makes `asserted:true` in production) — FAFF-325 (shipped; consumed here as-is). *Extension point:* the `signal` seam on `correctiveIntegrityProbe`.
- **Fleet (concurrent) supervision / fleet-level corrective artifacts** — FAFF-327; per-run only here. *Extension point:* the run-dir-scoped artifact layout.
- **Live-run validation** of Channel A on a real derailed run — FAFF-328.
- **Re-examining detection un-subvertability under shared fs** — FAFF-324 (this ticket only consumes the shared `consumer="detection"` degrade FAFF-373 shipped).
- **Additive corrective authority** — never: inexpressible in the schema by design; an additive intent routes to park / needs-human (Channel D).
- **A watcher-of-watchers lane** — rejected for v1 by ADR-0039.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Corrective input | A machine-authored, subtractive constraint on one issue's next dispatch, on disk under `<run-dir>/corrective/` |
| Mandate | What the re-dispatched unit is allowed to do: the human-gated spec minus all applied subtractive constraints |
| Empty mandate | A constraint set that narrows the mandate to nothing — must park before dispatch, never spin |
| Channel D | Human relay — the fallback whenever a corrective input cannot be trusted or expressed subtractively |
| Authority available | `integrityGate(probe, "corrective").trusted == true` — never true in production until FAFF-325 |

**The corrective-input record (new).**

```
RECORD CorrectiveInput:
  schema: 1
  run_id: String                 # the minting run
  issue: String                  # the one unit this constrains
  op: ENUM { park-with-cause, forbid-surface, tighten-threshold, descope-to-subset }
  payload:                       # op-shaped, exactly one populated:
    cause: String                #   park-with-cause — the park comment cause
    surfaces: [String]           #   forbid-surface — named files/dirs/modules to forbid
    threshold: { key, value }    #   tighten-threshold — a sentry.* key; value must be STRICTLY
                                 #     more conservative than the effective config value
    subset: [String]             #   descope-to-subset — the DoD items / spec surface retained
  cites:                         # REQUIRED — the triggering DerailmentVerdict (steering audit)
    signal: String               #   one of DERAILMENT_SIGNALS
    event_seq: Int | null
    evidence: String             #   one-line summary from the verdict
  authored_at: ISO-8601
  authored_by: "orchestrator"    # informational only — trust comes from the gate, never this field

  CONSTRAINT op in the closed enum        # additive is inexpressible
  CONSTRAINT cites.signal present          # no un-cited corrective input ever validates
```

**New CLI region `corrective`** (pure cores + thin I/O + `--selftest`, mirroring sentry / corrective-integrity):

```
faff corrective author --run-dir D --issue I --op OP <op flags> --cites-signal S [--cites-seq N] [--json]
  # validates the record (closed enum, op-shaped payload, citation present, threshold strictly
  # tighter than effective config), writes <run-dir>/corrective/<seq>-<issue>.json,
  # appends a `corrective-authored` event. Invalid input → exit 1, nothing written.

faff corrective check --run-dir D --issue I [--json]
  # gates then computes: runs integrityGate(correctiveIntegrityProbe(...), "corrective").
  #   unasserted → { disposition: "channel-D", consumed: false, inputs: [...] }  (surface, never act)
  #   asserted   → validates each input, folds the cumulative constraint set, returns
  #                { disposition: "trusted", mandate: "narrowed"|"empty"|"indeterminate",
  #                  constraints: {...}, applied: [...] } and appends `corrective-consumed`.
  # An invalid/foreign/additive artifact in the dir → that input is rejected (never applied) and
  # reported { rejected: [...] } for park/needs-human routing. Exit 0 report; 2 usage; 3 no run dir.
```

**Sentry ladder extension.**

```
SENTRY_INTERVENTIONS := ["continue", "pause", "correct", "abort"]   # ascending; abort still max
SIGNAL_TRIP_INTERVENTION["fix-review-thrash"] := "correct" WHEN authority available, ELSE "pause"
# all other signal→intervention mappings unchanged; abort routes are never weakened
evaluateDerailment(rawSignals, thresholds, authority)   # authority is an EXPLICIT parameter,
# default "channel-D-only" — not a raw-signal field, so no injected bundle value can enable it.
# cmdSentry computes it from correctiveIntegrityProbe directly (same derivation as lights-out).
```

**BuildDispatch extension (prose contract, both concurrency executors).** Optional `constraints` field — `{ forbid_surfaces: [...], thresholds: {...}, descope: [...] }` — stamped from `faff corrective check`'s output at dispatch; absent ⇒ today's dispatch byte-for-byte.

**Event types.** `EVENT_TYPES` gains issue-scoped `corrective-authored` and `corrective-consumed` — the append-only audit trail that makes a sequential-narrowing pattern visible (ADR-0039 residual).

**Design decisions** are collected in section 6, each with its marker.

## 4. HOW — Behavior

**Architecture.** One new CLI region (`corrective`), a parameterised extension of the sentry pure core, two new event types, and prose wiring at the three orchestration sites (beep-boop interrupt table; both executors' dispatch step). Authoring judgement stays with the orchestrator LLM; every mechanical decision is CLI.

```
PROCEDURE correct-flow (L4, authority available — test-only until FAFF-325 wires production trust):
  1. Between-units checkpoint: faff sentry check → intervention "correct" (thrash trip, authority available)
  2. Orchestrator aborts the implicated unit resumably (existing applySentryAbort shape, issue-scoped)
  3. Orchestrator judges the narrowing from the verdict evidence and runs
     faff corrective author --issue I --op ... --cites-signal fix-review-thrash --cites-seq N
     (CLI validates + writes the artifact + appends corrective-authored)
  4. Next dispatch boundary (wave re-entry / resume-from-ledger): faff corrective check --issue I
     a. disposition channel-D → surface for human relay; dispatch WITHOUT constraints (today's path)
     b. trusted + mandate narrowed → stamp constraints into the unit's BuildDispatch; dispatch
     c. trusted + mandate empty|indeterminate → park with cause (shared park protocol); never dispatch
```

```
PROCEDURE degrade-paths (production today — authority unavailable):
  - sentry check: fix-review-thrash maps to "pause" exactly as v1 (correct unreachable)
  - corrective check: any on-disk artifact → channel-D report; nothing consumed
  - an additive/foreign/uncited artifact: rejected by validation; orchestrator parks the unit
    (needs-human) rather than dispatching against an untrustable constraint set
```

**Empty-mandate detection (mechanically decidable core).** `faff corrective check` returns `mandate: "empty"` when: the `descope-to-subset` retained set is empty; the cumulative retained set minus forbidden surfaces is empty (comparable path-shaped entries only); or constraint pairs contradict (subset ⊆ forbidden surfaces). Semantic emptiness the CLI cannot decide returns `"indeterminate"`; the orchestrator judges, and parks on doubt. `park-with-cause` never reaches mandate folding — it is executed as a park via the shared protocol at authoring time.

**Edge cases.**

- Corrective dir absent / empty → `check` returns no inputs, `mandate: "narrowed"` with empty constraints (a no-op; dispatch proceeds unchanged).
- Unreadable / unparseable artifact → rejected input (never a crash; never applied) — mirrors the region's never-throws posture.
- `tighten-threshold` value equal to or looser than the effective config value → validation failure at `author` (subtractive means strictly tighter).
- Multiple corrective inputs for one issue → the cumulative set folds (all constraints apply); the fold is order-independent (intersection semantics).
- Aborted-resumable run re-entered by a fresh session → `check` reads the same run-dir artifacts; consumption is idempotent (re-running `check` recomputes the same fold; `corrective-consumed` is appended per actual dispatch, not per read).

**Failure modes.**

- **Steering by sequential narrowing** (ADR-0039 residual): individually-subtractive inputs accumulate into an additive-in-effect steer. *How you'd know:* the per-issue `corrective-authored` event trail + `check`'s `applied` list make the cumulative set reviewable; ≥2 corrective inputs on one issue is surfaced in the run summary / `/faff-wtf`. *What it means:* human reviews the trail; FAFF-328's live validation is the systemic check.
- **Empty-mandate detection misses a semantic ∅** → the re-dispatched unit spins. *How you'd know:* the existing thrash trip fires on the re-dispatch loop (build-starts accumulate, no ship) and escalates — the ladder is its own backstop. *What it means:* tighten the decidable core; never rely on it alone.
- **The gate seam wired to a forgeable source later** would let the build lane self-author corrections. *How you'd know:* the FAFF-373 test that a shared-fs `signal` never flips to trusted; the AC5-shaped no-foreign-authorship test here. *What it means:* the trust source must remain FAFF-325's un-forgeable channel.

**Anti-pattern:** acting on any on-disk corrective artifact while `asserted:false` "because the orchestrator just wrote it". Why: under shared uid the orchestrator cannot distinguish its own write from a forged one; the gate is the only honest arbiter (FAFF-373).

**Anti-pattern:** mapping any abort-routed signal to `correct`. Why: correct is a narrowing of pause-class response only; weakening abort re-opens the runaway surface ADR-0034 closed.

## 5. SCENARIOS

```
Given authority available (asserted:true injected at the pure-function seam) and a thrash trip on issue X
When the orchestrator authors a forbid-surface corrective input citing that verdict and re-dispatches
Then faff corrective check returns trusted/narrowed, the constraint reaches X's BuildDispatch, and
     corrective-authored + corrective-consumed events carry the citation
```

```
Given production state (no FAFF-325 attestation; probe returns asserted:false) and a corrective artifact on disk
When the next dispatch boundary runs faff corrective check
Then disposition is channel-D, nothing is consumed, and the artifact is surfaced for human relay
```

```
Given an artifact whose op is additive (not in the closed enum) or whose citation is absent
When validation runs (at author or at check)
Then it is rejected — never written / never applied — and the unit routes to park / needs-human
```

```
Given a cumulative constraint set that narrows issue X's mandate to nothing
When faff corrective check computes the fold before dispatch
Then it returns mandate: empty and the orchestrator parks X with cause — no dispatch, no spin
```

```
Given a hostile signal bundle injecting corrective_authority/intervention/suppress fields
When evaluateDerailment runs with the default authority parameter
Then no injected field makes `correct` reachable or suppresses a trip (AC5-shaped no-foreign-authorship)
```

## 6. DESIGN DECISION RATIONALE

- **How is "subtractive only" enforced?** Prose review vs closed schema. **Chosen:** a closed op enum — additive intent is inexpressible by construction; validation rejects anything else. The boundary is load-bearing, so it must be structural, not judged.
- **Where do corrective artifacts live?** New dir vs the FAFF-373 forge surface. **Chosen:** `<run-dir>/corrective/` via `correctiveIntegrityDirs` — the gate already names it; a second location would fork the forge surface (the exact bypass FAFF-373 warns against).
- **How does the ladder learn about authority?** A raw-signal field vs an explicit parameter. **Chosen:** explicit `authority` parameter on `evaluateDerailment`, default unavailable, computed by `cmdSentry` from `correctiveIntegrityProbe` directly — a raw-signal field would put an authority bit inside attacker-shapeable input; a parameter keeps AC5's closed-allowlist property intact.
- **Which signals route to `correct`?** All issue-scoped trips vs thrash only. **Chosen:** `fix-review-thrash` only at v1 — it is precisely the stop-and-redispatch shape, and it upgrades a `pause` (never weakens an `abort`). Widening to other signals is a conscious future edit with FAFF-328 evidence behind it.
- **Where does `correct` sit in the ladder?** Above abort vs between pause and abort. **Chosen:** between — ladder-max aggregation must still let a co-tripping abort signal win (budget-breach + thrash ⇒ abort, never correct).
- **Ship inert or wait for FAFF-325?** **Chosen:** ship gate-degraded (the FAFF-373 precedent) — the whole path is testable via the pure seam, the AC6 guard is extended consciously, and production behaviour is unchanged now that FAFF-325 has landed the trust channel (the gate simply evaluates its live signal).
- **How is the steering residual discharged?** Optional citation vs required. **Chosen:** required `cites` — `author` refuses an uncited input, so the audit trail exists by construction (ADR-0039 names this as pinned for this ticket).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the genuinely-open trust-channel question was FAFF-325's by design; FAFF-325 has since merged to main (commit b5f2e63), so Channel A now runs against a live (if still narrow) attestation signal rather than a permanently-unasserted probe.

**Assumptions.**

- **Assumes:** the FAFF-325 corrective-artifact integrity mechanism exists before Channel A carries production authority — FAFF-325 merged 2026-07-12 (commit b5f2e63), so this build's `asserted:true` branch is reachable in production wherever FAFF-325's attestation signal is present, and still degrades to channel-D wherever it is absent. *Validate:* `plugin/skills/faff/bin/lib/corrective-integrity.js` exports as of b5f2e63.
- **Assumes:** FAFF-373's exports (`correctiveIntegrityProbe`, `integrityGate`, `correctiveIntegrityDirs`) are the stable gate seam. *Validate:* `plugin/skills/faff/bin/lib/corrective-integrity.js` module.exports.
- **Assumes:** `EVENT_TYPES` extension is additive-safe for existing readers (validator-gated writers, tolerant readers). *Validate:* `events.js` read paths skip-don't-crash on unknown-to-them types.
- **Assumes:** the `test/sentry.test.mjs` AC6 guard is the invariant to extend consciously, not delete. *Validate:* the new guard asserts `correct` exists in the ladder AND is unreachable while unasserted.

## 8. DONE — Definition of Done

### From WHY
- [ ] Production behaviour is unchanged with no asserted attestation: every trip routes exactly as v1 (`correct` unreachable), and no on-disk corrective artifact is ever acted on as authentic (channel-D) unless the FAFF-325 gate reports `asserted:true`.

### From WHAT (types and interfaces)
- [ ] `CorrectiveInput` validates per the record: closed op enum, op-shaped payload, required citation; an additive/unknown op or missing citation → exit 1 at `author`, rejected at `check`.
- [ ] `faff corrective author` writes only a valid artifact into `correctiveIntegrityDirs(runDir)`'s corrective dir and appends `corrective-authored`.
- [ ] `faff corrective check` returns channel-D/unconsumed when unasserted; trusted + `mandate: narrowed|empty|indeterminate` + cumulative `constraints`/`applied` when asserted (seam-injected or live FAFF-325 signal).
- [ ] `SENTRY_INTERVENTIONS` is `continue|pause|correct|abort`; only `fix-review-thrash` maps to `correct`, and only under available authority; all abort mappings unchanged.
- [ ] `evaluateDerailment` takes authority as an explicit parameter defaulting to unavailable; `cmdSentry` derives it from the probe.
- [ ] `EVENT_TYPES` gains issue-scoped `corrective-authored` / `corrective-consumed`; both validate.

### From HOW (behaviour)
- [ ] A subtractive input reaches the re-dispatched unit's `BuildDispatch.constraints` (asserted seam); an absent constraint set dispatches byte-for-byte as today.
- [ ] Empty mandate is detected before dispatch (`mandate: empty` on the decidable core; park on empty/indeterminate-with-doubt) — never a dispatch spin.
- [ ] `tighten-threshold` accepts only strictly-tighter values than the effective config.
- [ ] Skill prose wired: beep-boop interrupt table carries the `correct` row (L4 acts / non-L4 advisory); both concurrency executors run `corrective check` at dispatch and stamp constraints.

### From tests
- [ ] AC5-shaped no-foreign-authorship: hostile injected fields (including an authority claim) cannot make `correct` reachable, suppress a trip, or author/alter a corrective input; a build-lane-writable source never flips the gate.
- [ ] AC6 consciously extended: the guard now asserts the ladder contains `correct` AND that it is unreachable while unasserted (source + live assertions updated together).
- [ ] Additive input → park/needs-human; empty mandate → park; unasserted → channel-D — each pinned by a test.
- [ ] New region registered (regions.js + selftest table + CLI doc header); `node --test` green; `--selftest` tables pass.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. author a forbid-surface input citing a thrash verdict → artifact in <run-dir>/corrective/, event appended
  2. corrective check (unasserted) → channel-D, consumed:false
  3. corrective check (asserted via seam) → trusted, mandate narrowed, constraints present
  4. evaluateDerailment(thrash-trip, th, "available") → correct; (…, default) → pause; (+budget escalate) → abort
  5. descope-to-subset [] → mandate empty → park path
```

## Already shipped against this surface

Related Done work — context, not supersession:

- **FAFF-49 (Done)** — Sentry-1: detection + `continue|pause|abort` ladder, AC5 normalizer, `applySentryAbort` aborted-resumable. The substrate this extends; no corrective channel shipped.
- **FAFF-373 (Done)** — the corrective-integrity fail-safe gate (`correctiveIntegrityProbe` / `integrityGate` / `correctiveIntegrityDirs`), the `consumer="corrective"` → channel-D degrade, and the lights-out `corrective_authority` capability flag. It is the gate this build consumes — it deliberately shipped *no* Channel A schema/authoring/consumption (its OUT OF SCOPE names FAFF-326).
- **FAFF-325 (Done, merged 2026-07-12, commit b5f2e63)** — wired the trusted attestation signal into the corrective-integrity gate + the merge-floor consumer. This build now runs against that live (still narrow-scope) signal rather than a permanently-unasserted probe; production behaviour when the signal is absent is still channel-D.
- **FAFF-352 (Done, merged 2026-07-12, commit 01b7ba2)** — wired `faff sentry check` into beep-boop's between-units checkpoints. This is the acting site the spec's `correct-flow` PROCEDURE step 1 leans on; it is now live rather than a stale/orphaned consult.
- **FAFF-425 (Done)** — sentry own-fault indeterminate hardening; adjacent posture precedent (fail closed, never silently blind), no corrective surface.

None deliver the corrective-input schema, authoring path, consumption, or the `correct` rung — the premise holds.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — No issues. The slice bundles schema + authoring + consumption + degrade paths + guard extension, which sit at the upper edge of a 1–3 day unit but are always-ship-together concerns: the schema without consumption is dead surface, and either half alone is unverifiable. Not a split candidate.
- **Workstream fit? (principles 1 + 5)** — No issues. "T3 — supervision stands alone" is outcome-named, and this is its corrective-authority increment, between FAFF-373 (shipped gate) and FAFF-328 (live validation).
- **Deps surfaced? (principle 6)** — Resolved since spec-review: FAFF-352 (the between-units Sentry consult acting site) merged 2026-07-12, ahead of this build. FAFF-325 (the trust channel) also merged 2026-07-12. Both blockers this spec flagged as build-order edges (not design unknowns) are now closed — this build proceeds against the live post-325/352 surfaces rather than the gate-degraded-forever posture the spec was written against.
- **Risk profile? (principle 7)** — No issues. The risky unknowns were de-risked up front by structure: the FAFF-278 spike settled the authority model, FAFF-373 shipped the fail-safe, and FAFF-328 carries the live-run validation. The named residual (sequential-narrowing steering) is discharged in-spec via the required citation + audit events. No further de-risking spike warranted.

confidence: high

---

## ADR promotion intent

Recorded autonomously (adr.mode: offer, appetite: high — the ADR ships in the PR, reviewable and revertible). `/faff-graft` materialises via `faff adr new` on the feature branch:

- **Sentry-2 Channel A ships gate-degraded: closed subtractive corrective-input schema + a `correct` rung reachable only under asserted integrity** — from the spec's "Sentry ladder extension" (WHAT) and Design decision rationale. Cross-slice and durable: it extends the ADR-0034/ADR-0039 intervention-ladder lineage (`continue|pause|correct|abort`, `correct` between pause and abort, thrash-only at v1, never weakening an abort), fixes authority derivation as an explicit parameter sourced from `correctiveIntegrityProbe` (never signal-bundle input), and pins the FAFF-373 forge surface (`<run-dir>/corrective/`) as the one artifact home.

## Spec review

spec-review: approve

Single-pass spec review (faffter-noon-spec-review; lenses fired per the change-surface cost-gate: architectural, infosec, QA; mode single-pass, level L3, appetite high). Zero objections:

- **architectural** — reuses the FAFF-373 forge surface (no fork); explicit `authority` parameter preserves the AC5 closed-allowlist property; `correct` sits below `abort` so ladder-max never weakens an abort; ship-inert-behind-the-gate follows the FAFF-373 precedent.
- **infosec** — forgery gated (unasserted → channel-D), injection closed structurally (closed op enum, authority-as-parameter), steering residual discharged (required citation + audit events), no new secrets/crypto, production blast radius nil until FAFF-325 (now landed — blast radius stays scoped to FAFF-325's own narrow attestation signal).
- **QA** — GWT scenarios cover trusted/degrade/additive-rejection/empty-mandate/hostile-injection; DONE mirrors the body 1:1; the asserted branch is testable via the pure-function seam.

This verdict is retained alongside the spec's `confidence: high` line (the parent comment is the spec of record; treat `confidence: high` + `spec-review: approve` as its retained gate state).

## Build-time addendum (2026-07-12, faff-graft autonomous)

FAFF-352 and FAFF-325 merged to origin/main (commits 01b7ba2, b5f2e63) ahead of this build. The worktree was rebased on current origin/main before building; line anchors below are re-verified against post-325/352 source rather than trusted from spec prose. No spec decision changed — `Chosen:` markers above hold exactly as written (subtractive-only, authority-as-explicit-parameter, `correct` below `abort`).
