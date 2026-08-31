# SuperDomestique runtime v5: cutover-slice selection

Built against commit `121bd73c`, 2026-08-31.
Status: Phase 1 deliverable for FAFF-944. Sole input: the state-authority map `STATE-AUTHORITY-MAP-v5.md` (FAFF-825), which exists and passes its own eight-step integration smoke test at this commit. This document does not edit that map; a defect found while scoring is routed back to FAFF-825 as a finding.

This document scores a fixed set of candidate cutover slices against the map and hands a human a decision-support brief. The rubric informs; it does not decide. No score eliminates a candidate and no tie-break names a winner. The human picks the winner and their reasoning is recorded in the ADR named below; they may also decline, in which case the choice routes to FAFF-827 and no ADR is written.

## Why this is a decision, not an arithmetic

A wrong first slice introduces the second canonical history the master RFC's Phase 1 exit evidence forbids ("no second canonical history is introduced", `FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md`, "Phase 1: map, characterise, and measure" → Exit evidence). The earlier design for this ticket made the rubric the decision-maker, and its assurance floor and tie-breaks were the locus of four unresolved spec-review objections. Those dissolve once a human decides on the evidence: scores that decide nothing cannot be circular or perverse. So the brief below scores every candidate on every criterion with a cited map row key, surfaces an unproven-assurance flag prominently where it applies, and stops there.

## The six Commissaire facade verbs (the closed source for a span's missing ends)

Quoted verbatim from `FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md`, "Minimum external facade":

1. admit a versioned contract;
2. register producer-authentic facts and immutable evidence;
3. request a protected-effect decision;
4. append observations and request reconciliation;
5. request a terminal conformance verdict; and
6. seal and export an audit bundle.

A span step that has no current implementation must name one of these six verbs verbatim, never free prose such as "supplied by Phase 2A".

## The candidate floor

Five candidates, each anchored to modules verified present in the map's classification table at the recorded commit. The map surfaced no sixth candidate that clears the same "a coherent module set mapping to one facade concern" bar, so the floor is the full set.

| Candidate | Modules (all in the classification table) | Facade verb it maps to |
|---|---|---|
| Recovery-bundle publish and verify | `bundle`, `bundle-recover`, `integrity-digest` | Seal and export an audit bundle (verb 6) |
| Declared effects | `effects` (declare / observe), `effects-chain-head.json` | Request a protected-effect decision (verb 3) |
| Run-end ground truth | `reconcile`, `disposition`, `runcheck` | Append observations and request reconciliation (verb 4); request a terminal conformance verdict (verb 5) |
| Merge floor | `merge-gate`, `lane-boundary`, the anchors tree | None; Software Delivery policy |
| Corrective authority | `contain`, `corrective`, `corrective-integrity` | None directly; authority and obligations |

This document deliberately does not name the winner. Naming it would put the conclusion in the premise, and the ADR and the FAFF-827 review would then inherit it and read as independent support for a choice made before the evidence was gathered.

## The rubric

Ten criteria, each scored `0`, `1`, or `2`, each defined at all three points so a score is never interpolated against an undefined midpoint. Each is derived from a cited line in the parent ticket's acceptance boundary, the RFC's Phase 2A exit evidence, or the master RFC's second-producer rule. The rubric is decision support: nothing in it decides the winner.

| # | Criterion | Source | 0 | 1 | 2 |
|---|---|---|---|---|---|
| 1 | No scheduling or skill dependency | Phase 2A exit: "the producer imports neither SuperDomestique scheduling nor current skills" | Slice modules require queue assembly or a `faff-*` skill | A dependency exists but is confined to one named module and severable without redesign | Slice modules import neither |
| 2 | Complete span | Ticket acceptance boundary | Neither admission nor terminal verdict has a step | One end exists in current code and the other is supplied by a named Phase 2A facade verb | Both ends exist in current code |
| 3 | One canonical writer per state change | Ticket: "One owner and durable fact exists for every mapped state change" | Two or more writers on some step | Every step has one writer, but at least one is recorded as a single-writer finding rather than settled | One settled writer on every step |
| 4 | No second canonical history | Phase 1 exit evidence | Cutover requires mirroring a record into both formats | Mirroring is confined to a compatibility reader over frozen historical records | No mirroring needed |
| 5 | Existing characterisation coverage | RFC Phase 1 deliverable | Most steps are `gap` | Every step cites a test or `--selftest`, but at least one covers the module rather than the specific durable fact | Every step cites coverage of the durable fact itself |
| 6 | Reversible | RFC rollback rule: additive publication disables without changing current canonical files | Some step sits past the first-generic-work-item boundary | Every step reversible, but at least one needs a documented manual step | Every step reversible by disabling additive publication alone |
| 7 | Stays behind the current `faff` surface | Phase 1 exit: "the first slice remains behind the current `faff` surface" | Needs a new live entrypoint | An existing `faff` command is the entry but needs a new flag or subcommand | An existing `faff` command is the entry unchanged |
| 8 | Small TypeScript travel | Ticket: TypeScript travels only with the selected slice; live entrypoints move last | Requires converting a live entrypoint | Converts a module a live entrypoint imports, entrypoint itself unmoved | Only pure decision or record-mechanics modules |
| 9 | Present assurance class and its gap | Master RFC journal classes J-A–J-D and effect classes E-A–E-D; "Only E-A and E-B support a pre-execution prevention claim" | A relied-on stream's present class is J-D, or a protected effect is E-D, with no named mechanism that would raise it | Present class is below target, and the map names the specific missing mechanism that would raise it | Every relied-on stream already J-C or stronger and every protected effect already E-A or E-B, each by the mechanism its own evidence cell cites |
| 10 | Second producer plausibility | Master RFC: the neutral envelope arrives "only when an external producer becomes the second producer" (Executive decision); "Phase 2A supplies a second producer" (Preserve before replacing); "Stabilise after the second concrete use" | No plausible external producer exists for this slice's facade verb | A producer is conceivable but none is named | A concrete candidate producer exists, or the slice maps to a facade verb an external producer demonstrably needs first |

Two criteria are non-discriminating here, and that is itself a recorded finding rather than a defect:

- **Criterion 2 (complete span) is `1` for every candidate.** Contract admission (verb 1) exists nowhere in the codebase, so no candidate can reach `2`, and every candidate's own characteristic machinery exists, so none drops to `0`. This is expected, not a scoring defect — a pass-or-fail version of the criterion would eliminate every candidate, since contract admission does not exist at all. The criterion still earns its place — it forces each candidate's non-admission end to be named against a real module — but it does not separate the field.
- **Criterion 7 (stays behind the `faff` surface) is `2` for every candidate.** Every candidate's entry is an existing `faff` command that needs no new live entrypoint. This is a genuine property of the whole slice space, not a scoring artefact.

## The scored brief

Every score cites a `row_key` (a `faff <command>` step or an artifact path) that appears in `STATE-AUTHORITY-MAP-v5.md`. A criterion scored with no citation would be invalid.

### Recovery-bundle publish and verify

| # | Criterion | Score | Citation and basis |
|---|---|---|---|
| 1 | No scheduling/skill dependency | 2 | `faff bundle`, `faff bundle-recover` — record-mechanics modules (local/git-ref store, projection reconstruct); the classification rows show no scheduling or `faff-*` skill import |
| 2 | Complete span | 1 | `faff bundle` — the seal/export end (verb 6) exists in current code; the admission end (verb 1) does not |
| 3 | One canonical writer per state change | 2 | `faff bundle` (bundle.js :: localBundleStore), `faff bundle-recover` (reconstructProjection), `faff integrity-digest` (atomicWriteVerdictBytes) — each a single settled writer; none appears in the map's single-writer-finding list |
| 4 | No second canonical history | 2 | `faff bundle` migration row: immutable-blob, "a replica and recovery input. It is not a new journal … never migrated" — no mirroring at all |
| 5 | Existing characterisation coverage | 2 | `faff bundle` (test/bundle.test.mjs), `faff bundle-recover` (inline bundleRecoverSelftest), `faff integrity-digest` (test/integrity-digest.test.mjs) — each covers the durable fact |
| 6 | Reversible | 2 | `faff bundle` (Rollback rule 1, additive publication disables without changing canonical files); `faff integrity-digest` (Rollback rule 7) rides frozen-evidence non-reliance — both additive-disable |
| 7 | Stays behind `faff` surface | 2 | `faff bundle` — existing command, invoked inside the current graft flow, no new live entrypoint |
| 8 | Small TypeScript travel | 2 | `faff bundle` — bundle.js / bundle-recover.js / integrity-digest.js are pure record-mechanics modules, no live entrypoint |
| 9 | Present assurance class and its gap | 2 | `faff bundle` (J-C, classifyBundle fail-closed digest ladder), `faff bundle-recover` (J-C), `faff integrity-digest` (J-C); effect class n/a (a recovery replica is not a protected effect). Every relied-on stream is already J-C by its cited mechanism |
| 10 | Second producer plausibility | 1 | `faff bundle` — verb 6 (seal/export) is a real Phase 2A deliverable ("sealed audit bundles and summaries") but is the terminal verb, not the one an external producer needs first, and no concrete producer is named for this slice |

Decision-support total: **18**. No unproven-assurance flag.

### Declared effects

| # | Criterion | Score | Citation and basis |
|---|---|---|---|
| 1 | No scheduling/skill dependency | 2 | `faff effects declare` — appends to declared-effects.jsonl via events.js :: appendRecordsUnderLock; a record-mechanics module with no scheduling or skill import |
| 2 | Complete span | 1 | `faff effects declare` — the declare/observe/check machinery exists in current code; the admission end (verb 1) does not |
| 3 | One canonical writer per state change | 2 | `faff effects declare` / `faff effects observe` — both reach disk through the single events.js :: appendRecordsUnderLock chokepoint; the map frames this as one shared low-level write primitive under two distinct entitled functions, not a single-writer finding |
| 4 | No second canonical history | 1 | `faff effects declare` migration row: translated — a Phase 2A reader loads pre-cutover declared-effects.jsonl verbatim as frozen history, the generic stream starts fresh; mirroring confined to a compatibility reader over frozen records |
| 5 | Existing characterisation coverage | 2 | `faff effects declare` — test/effects.test.mjs, test/effects-chain.test.mjs, test/effects-concurrency.test.mjs cover the durable append fact; `effects-chain-head.json` covered by test/effects-chain.test.mjs |
| 6 | Reversible | 2 | `faff effects declare` (Rollback rule 7) — the declared-effects.jsonl append is additive; disabling it changes no canonical file |
| 7 | Stays behind `faff` surface | 2 | `faff effects declare` — existing command, no new live entrypoint |
| 8 | Small TypeScript travel | 2 | `faff effects declare` — effects.js is a record-mechanics module, not a live entrypoint |
| 9 | Present assurance class and its gap | 1 | `faff effects declare` — journal J-C (chained-append producer binding) meets the governance floor, but the protected-effect class is **E-C** (the map's effects row: "detection and reconciliation, never prevention"), below the E-B prevention target. The score is 1, not 0: E-C is neither the level-0 case (J-D/E-D with no mechanism) nor level-2 (E-A/E-B). The raising mechanism is named — the mediated protected-effect decision, facade verb 3 — though in the RFC facade rather than the map's effects cell, which describes only the present detection mechanism; verb 3 is precisely this slice's own target |
| 10 | Second producer plausibility | 2 | `faff effects declare` — verb 3 (protected-effect decision) is demonstrably needed first by any external producer with consequential effects; the master RFC's Phase 2A exercises exactly this ("a protected effect is prevented or a false effect claim is detected and reconciled") |

Decision-support total: **17**. No unproven-assurance flag.

### Run-end ground truth

| # | Criterion | Score | Citation and basis |
|---|---|---|---|
| 1 | No scheduling/skill dependency | 1 | `runcheck` — its own job is to verify "a beep-boop run actually dispatched its queue", a scheduling coupling; it is confined to runcheck and severable (the reconcile.js half carries no queue dependency) |
| 2 | Complete span | 1 | `run-ledger.json` — the reconciliation machinery (reconcile.js, run-membership outcomes) exists; the admission end (verb 1) and the **work-item** terminal-verdict end (verb 5) do not — the map's disposition-scope "Work item" row reads "No current implementation" |
| 3 | One canonical writer per state change | 2 | `run-ledger.json` — the slice writes nothing itself; the run outcome it reconciles has one settled writer, heartbeat.js :: atomicWriteLedger (the map's "cleanest possible instance of exactly one canonical writer") |
| 4 | No second canonical history | 1 | `run-ledger.json` migration row: translated — a Phase 2A reader loads a pre-cutover ledger verbatim; the frozen historical ledgers read through a compatibility path |
| 5 | Existing characterisation coverage | 1 | `run-ledger.json` (test/run-ledger-init-interactive.test.mjs, test/heartbeat-concurrency.test.mjs) covers the ledger artifact, but the slice's own verdict-computation modules (reconcile / disposition / runcheck) are read-only and carry no durable-row characterisation test in the map |
| 6 | Reversible | 1 | `run-ledger.json` (Rollback rule 7) — reversible at the Phase 0/1 boundary, but the ledger is canonical current state, not additive publication, so its reversibility is not the clean "disable additive publication alone" case |
| 7 | Stays behind `faff` surface | 2 | `runcheck` — existing command / Stop-hook consult, no new live entrypoint |
| 8 | Small TypeScript travel | 2 | `runcheck` — reconcile.js / disposition.js / runcheck.js are pure read-only verdict modules, no live entrypoint |
| 9 | Present assurance class and its gap | 2 | `run-ledger.json` (J-C), `faff heartbeat` (J-B) — every stream the slice relies on is already J-C or stronger; no protected effect (read-only verdicts). **Flag:** the slice writes no durable record of its own, so its terminal-verdict output has no stream to classify at all |
| 10 | Second producer plausibility | 2 | `run-ledger.json` / disposition-scope "Work item" — verb 5 (terminal conformance verdict, `accepted_under_contract`) is the positive verdict every external governed workflow must obtain; demonstrably needed |

Decision-support total: **15**. No unproven-assurance flag, but see the criterion-9 note: the slice's own terminal-verdict output is currently unmodelled (the single largest gap in the map).

### Merge floor

| # | Criterion | Score | Citation and basis |
|---|---|---|---|
| 1 | No scheduling/skill dependency | 2 | `faff merge-gate` — re-observes CI and reads floor artifacts; merge-gate.js imports no scheduler and no `faff-*` skill |
| 2 | Complete span | 1 | `faff merge-gate` — the merge-record machinery exists in current code; the admission end (verb 1) does not |
| 3 | One canonical writer per state change | 2 | `faff merge-gate` (writeMergeRecord), `faff governance-check floor` (writeFloorArtifacts), `anchor: floor-evidence` (mintIssueAnchor) — each state change has its own single settled writer |
| 4 | No second canonical history | 1 | `faff merge-gate` migration row: translated — a Phase 2A reader treats a pre-cutover merge record as frozen evidence, read through a compatibility path |
| 5 | Existing characterisation coverage | 2 | `faff merge-gate` (test/merge-gate.test.mjs, merge-gate-local, merge-gate-controlflow), `faff governance-check floor` (test/faff-363-governance-check.test.mjs), `anchor: floor-evidence` (test/events.test.mjs) — each covers the durable fact |
| 6 | Reversible | 2 | `faff merge-gate` (Rollback rule 7) — the merge record is additive evidence; the merge action itself is the one genuinely irreversible effect, but its rollback is Phase 2A's burden, not this slice's steps |
| 7 | Stays behind `faff` surface | 2 | `faff merge-gate` — the sole sanctioned `gh pr merge` path, an existing command entry unchanged |
| 8 | Small TypeScript travel | 1 | `faff merge-gate` — merge-gate.js performs the actual merge (a near-live-entrypoint actor); converting it moves a module the `faff` binary invokes directly, with the binary itself unmoved |
| 9 | Present assurance class and its gap | **0 — FLAG** | `faff governance-check floor` (**J-D**, "written from the harness-independent CI binding's own inputs with no independent verification of the underlying review"), `faff ci-triage verdict` (**J-D**), `anchor: floor-evidence` (**J-D**) — the merge floor relies on multiple J-D self-declared streams with no map-named mechanism to raise them. `holdout.json` is J-C but carries its own NAMED GAP (the spawner-attested path's join to the per-run merge-floor file is unestablished). The merge effect itself is strong (`faff merge-gate` E-B, the single authenticated actor), but the **evidence it gates on is self-declared** |
| 10 | Second producer plausibility | **0** | `faff merge-gate` is classified `software-delivery-policy` and maps to **no facade verb** — it is domain merge policy an external producer in another domain would not use. This criterion exists precisely to separate a candidate like this one: a slice that maps to no facade verb has no external producer that needs it first |

Decision-support total: **13**. **Unproven-assurance flag raised** (criterion 9 = 0): the merge floor gates on J-D self-declared review/CI evidence. Per this ticket's decision structure the flag never eliminates the candidate — it travels with it into the human's decision.

### Corrective authority

| # | Criterion | Score | Citation and basis |
|---|---|---|---|
| 1 | No scheduling/skill dependency | 1 | `faff corrective` — folds a cumulative constraint set into the next dispatch via next.js; the dispatch coupling is confined to corrective-integrity.js → next.js and severable |
| 2 | Complete span | 1 | `faff corrective` — the corrective-authoring machinery exists; the admission end (verb 1) does not |
| 3 | One canonical writer per state change | 2 | `faff corrective` (cmdCorrectiveAuthor), `faff integrity-digest` (atomicWriteVerdictBytes) — each a single settled writer; corrective-integrity.js is read-only |
| 4 | No second canonical history | 1 | `faff corrective` migration row: translated — a Phase 2A reader treats a pre-cutover corrective input as frozen, read through a compatibility path |
| 5 | Existing characterisation coverage | 2 | `faff corrective` (test/corrective.test.mjs), `faff integrity-digest` (test/integrity-digest.test.mjs) — each covers the durable fact |
| 6 | Reversible | 1 | `faff corrective` (Rollback rule 7) — the corrective record is additive, but its consequence (folding into the next dispatch) is live control, so a rollback is a deliberate behaviour change, not a bare additive-publication disable |
| 7 | Stays behind `faff` surface | 2 | `faff corrective` — existing command, no new live entrypoint |
| 8 | Small TypeScript travel | 2 | `faff corrective` — corrective.js / corrective-integrity.js / integrity-digest.js are decision and record-mechanics modules feeding next.js (pure), no live entrypoint |
| 9 | Present assurance class and its gap | 1 | `faff corrective` (**J-D**, "no independent verification of the author's authority beyond the CLI's own validation") is below target, but the map names the mechanism that raises it: `faff integrity-digest` (J-C) folds a custody digest over the corrective set (corrective-integrity.js :: correctiveIntegrityDirs), giving the records verifiable tamper-detection |
| 10 | Second producer plausibility | 1 | `faff corrective` maps to the RFC's "authority, obligations" (Commissaire responsibilities), which any governed producer is subject to — but corrective authority is a control *over* a producer, not a verb the producer calls, and no concrete producer is named |

Decision-support total: **14**. No unproven-assurance flag.

## The brief at a glance

Totals are recorded for transparency; they do not rank and no floor eliminates. Read the per-criterion cells and the flags, not the sum.

| Candidate | Facade verb | Total | Assurance flag | The one-line shape of it |
|---|---|---|---|---|
| Recovery-bundle publish and verify | Seal and export an audit bundle (6) | 18 | — | Safest and best-assured (J-C throughout, additive-only, no second history), but its verb is the terminal one an external producer needs last |
| Declared effects | Request a protected-effect decision (3) | 17 | — | Maps to the verb an external producer needs first, mature and well-covered; its present effect class is E-C detection, and reaching E-B prevention *is* the Phase 2A verb |
| Run-end ground truth | Reconciliation (4); terminal verdict (5) | 15 | — | Maps to the terminal verdict every workflow needs, but the work-item verdict is entirely unmodelled today and the slice writes no durable record of its own |
| Merge floor | None (Software Delivery policy) | 13 | **Yes** | Strong merge effect (E-B) but gates on J-D self-declared evidence, and maps to no facade verb — the least Commissaire-shaped of the five |
| Corrective authority | None directly (authority, obligations) | 14 | — | J-D authoring raised to verifiable integrity by the named custody-digest mechanism; a control over producers rather than a verb they call |

## The chosen slice: Declared effects

**Chosen by the human on 2026-08-31: Declared effects** — the protected-effect-decision slice, facade verb 3.

The reasoning recorded here is the human's, not a total:

> The first cutover should prove the protocol on the verb that gets exercised **first and most**, not the one exercised last. Facade verb 3 (request a protected-effect decision) is on the path of every consequential effect in every run, so it exercises the external facade hardest and is the slice most likely to make a real external second producer necessary. Recovery-bundle (verb 6, seal and export) fires only on recovery and is exercised least — least valuable as a first proof. The known cost — the slice's present effect class is **E-C (detection)** rather than **E-B (prevention)** — is accepted knowingly, because closing that E-C→E-B gap *is* the Phase 2A deliverable for this verb (a mediated protected-effect decision), not deferred or unplanned work. Verb 3 is also one of the facade's genuinely atomic operations (unlike the compound entries 4 and 6), so the slice's facade boundary is a single well-defined operation.

Two commitments this decision makes explicit, so neither is a surprise at FAFF-827:

1. **The E-C→E-B upgrade is Phase 2A's scope (FAFF-828), not this ticket's.** This ticket builds nothing; the E-C detection mechanism already runs in `faff` today and stays as-is until Phase 2A cuts the slice over and builds the mediated gateway in one move. Detection is not lost when prevention is added — the observe/reconcile loop (facade verb 4) persists alongside the new decision gate (verb 3).
2. **The ADR is `Status: Proposed`.** FAFF-827 (the Phase-1 acceptance gate) is where it flips to Accepted. No `broken` invariant surfaced in the span trace below, so nothing on that axis escalates early.

## The winner's span

Ordered steps from contract admission to terminal verdict. Each names its semantic owner and its durable fact. A step with no current implementation names one of the six facade verbs verbatim (never free prose). Steps are derived from the map's ownership rows in call order, not composed.

| # | Step | Present? | Semantic owner | Durable fact | Map basis / missing-end facade verb |
|---|---|---|---|---|---|
| 1 | **admit a versioned contract** | no | commissaire-governance | the admitted contract revision | Missing end — facade verb 1, "admit a versioned contract". Contract admission exists nowhere in the codebase |
| 2 | `faff effects declare` | yes | commissaire-governance | the `declared-effects.jsonl` declare entry (effect intent) | effects.js :: appendEffectEntries → events.js :: appendRecordsUnderLock (the declare-before-acting half) |
| 3 | **request a protected-effect decision** | no | commissaire-governance | the grant/deny decision (the mediated E-B gateway) | Missing end — facade verb 3, "request a protected-effect decision". Today the slice reaches only E-C detection; the decision gate is Phase 2A's deliverable |
| 4 | `faff effects observe` | yes | commissaire-governance | the `declared-effects.jsonl` observe entry | effects.js :: appendEffectEntries → events.js :: appendRecordsUnderLock (the after-the-fact observation) |
| 5 | `faff effects` check (observed − declared) | yes (read-only) | commissaire-governance | none — a detection computation, no durable write | The invariant "Effect" family, current mechanism: "computes observed minus declared; detection only, never aborts" |
| 6 | `effects-chain-head.json` | yes | commissaire-governance | the chain-head hash witness certifying the effect journal | events.js :: computeChainHead (called from mintIssueAnchor) |
| 7 | **request a terminal conformance verdict** | no | commissaire-governance | the work-item terminal verdict (`accepted_under_contract`) | Missing end — facade verb 5, "request a terminal conformance verdict". The work-item verdict is unmodelled (disposition-scope "Work item": "No current implementation") |

Steps 1, 3, and 7 are the three missing ends, each named against a facade verb verbatim. Steps 1 and 7 are the generic admission and terminal-verdict ends every slice lacks; step 3 is this slice's own characteristic end — present as E-C detection, needing the E-B gateway.

**Back-check against the map.** The slice modules are `effects.js` (and the chain-head witness in `events.js`). Every ownership row whose `canonical_writer` is a slice module appears above as a step, or is listed here as deliberately outside the span with a reason:

- `faff effects declare` → step 2. ✓
- `faff effects observe` → step 4. ✓
- `effects-chain-head.json` (events.js :: computeChainHead) → step 6. ✓
- `faff review-progress`, `faff build-progress`, `faff landing-progress` (all `effects.js`-authored) → **deliberately outside the span.** They are per-stage progress checkpoints — a different durable fact (stage-attempt identity, not effect intent) — that share `effects.js` mechanically but are not part of the protected-effect-decision concern. The map's own splitting rule already treats declare/observe as distinct write kinds from the progress commands.

No span step names a row the map does not know, and no slice-module ownership row is omitted without a reason.

## The eight-invariant verdict table

For the Declared-effects slice, what happens to each invariant family at cutover. Verdicts read from the map's "eight invariant families" and migration rows; each `intentionally changed` cites the test, migration rule, and rollback path that make it safe.

| Family | Verdict | Basis |
|---|---|---|
| Queue | retained | `queue-state.js` — the effects cutover adds no queue machinery; queue derivation is untouched |
| Termination | retained | `run-done.js` — untouched by the effects slice |
| Budget | retained | `budget.js` — untouched by the effects slice |
| Liveness | retained | `heartbeat.js` / `sentry.js` — untouched by the effects slice |
| Gate | retained | `gates.js` — the gate mechanism is unchanged; it consumes the effect stream through the Phase-2A compatibility reader (see unknown **U2** on whether that reader is transparent to the gate or exposes a changed read path) |
| Merge | retained | `merge-gate.js` — `decideFloor` and the `gh pr merge` path are unchanged; the merge floor's effect-witness read (`requireWitness`) consumes the effect chain via the same compatibility reader (see **U2**) |
| **Effect** | **intentionally changed** | `effects.js` — this is the slice. **Test:** test/effects.test.mjs, test/effects-chain.test.mjs, test/effects-concurrency.test.mjs. **Migration rule:** translated — a Phase 2A reader loads pre-cutover `declared-effects.jsonl` verbatim as frozen effect-intent history; the generic effect stream starts fresh at cutover. **Rollback path:** Rollback rule 7 (historical evidence is never rewritten); reversible at the Phase 0/1 boundary (no generic-format work item exists yet, so the irreversible boundary is uncrossed) |
| Amendment | retained | `none` — the map establishes there is no current amendment mechanism, and this slice adds none (amendment concerns contract revisions, facade verb 1, not effects). The map's amendment finding stands, owned by Phase 2A |

**No invariant is `broken`.** The one intentionally-changed family (Effect) carries a cited test, a migration rule, and a rollback path, so it does not escalate to FAFF-827 as a broken invariant. The slice does not touch the amendment family, so this document's amendment statement is simply the map's own verdict, unchanged.

## Unknowns carried out

Each unknown that could change authority or canonicality is listed here with its routing and the one-line reason it could not be settled in a select-only ticket.

- **U1 — The facade's "verbs" mix governance acts with mechanical byproducts.** Entries 4 ("append observations *and* request reconciliation") and 6 ("seal *and* export an audit bundle") each fuse two operations that fire at different times, so reduced to atomic operations the facade lists eight, not six: admit · register · decide · append · reconcile · rule · seal · export. Sharper still, several of those eight are the *mechanical byproduct* of a governance act rather than a governance act in their own right: **appending** is how an **observation** is stored (the governance act is observe; the append is journal mechanics), and **exporting** is delivery of the **sealed** package (the governance act is seal; the export is transport, not governance). The same lens applies to entry 2 — its governance content is the producer-authentic binding, better named **attest** than "register", with the recording of the bytes as the mechanical part. By that reading the governance-specific acts are seven — admit · attest · decide · observe · reconcile · rule · seal — with record/append/export falling out as consequences. Whether the facade should expose the governance acts or the storage/transport operations, and how they are named, is a facade-design decision. **Routing:** FAFF-827 / the Phase-2A facade design. **Reason it is not settled here:** the facade's operation granularity and naming is a decision for the phase that implements it, not something the state-authority map or a slice choice fixes; it does not change which slice is picked first, but it changes how the facade is decomposed and named.
- **U2 — Whether the effect-stream readers need code changes at cutover.** `merge-gate.js` (`requireWitness`) and `governance-check.js` read the effect chain; whether they are insulated by a transparent Phase-2A compatibility reader (leaving the Gate and Merge families genuinely `retained`) or must change to read the new envelope (making those verdicts `intentionally changed`) depends on how the compatibility reader is built. **Routing:** FAFF-828 (Phase 2A cutover implementation). **Reason it is not settled here:** the compatibility reader is a Phase 2A deliverable ("the selected-slice cutover and historical compatibility reader"); its transparency is an implementation property this ticket cannot observe.
- **U3 — The E-C→E-B mechanism is unbuilt.** Reaching E-B prevention requires the mediated protected-effect-decision gateway (facade verb 3), which does not exist. **Routing:** FAFF-828, whose exit evidence proves it ("a protected effect is prevented or a false effect claim is detected and reconciled"). **Reason it is not settled here:** this ticket selects; it builds nothing, and the gateway is Phase 2A's named deliverable.

## The decision record

The human's choice and reasoning are recorded as an ADR at `records/adr/0122-adopt-declared-effects-as-the-first-v5-cutover-slice.md`, `Status: Proposed`, citing this document. FAFF-827 is where it flips to `Accepted`.

## Selection smoke checks

Run 2026-08-31 against this document and the ADR, resolving all citations against the header commit. All five pass; re-run after every content fix during authoring, and the run recorded here is the final passing run.

| Step | Check | Result |
|---|---|---|
| 1 | The commit recorded in the header resolves to a real commit | **PASS** — `121bd73c` resolves |
| 2 | Every repository-relative path cited in this document and the ADR (inline code spans and table-cell test paths) exists at that commit | **PASS** — 13 paths resolve (the map, the ADR, and 11 `test/*.test.mjs` characterisation-test paths) |
| 3 | Every `row_key` a score cites appears in `STATE-AUTHORITY-MAP-v5.md` | **PASS** — all cited row keys resolve in the map |
| 4 | Every fragment quoted from the RFC or the map appears verbatim in the file it is attributed to | **PASS** — RFC facade verbs and exit-evidence quotes verbatim under their named sections; map quotes verbatim |
| 5 | The ADR's own citations resolve (the selection document it cites, and any map row key) | **PASS** |

What these checks prove is that every claim the selection makes points at something that exists, where it says it exists. What they do not prove is that the choice is the right one — that judgement belongs to the human who made it here and to FAFF-827, which ratifies it.

