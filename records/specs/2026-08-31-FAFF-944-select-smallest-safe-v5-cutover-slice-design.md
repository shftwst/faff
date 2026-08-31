# FAFF-944 — Select the smallest safe V5 cutover slice from the state-authority map

> Spec: faffter-dark-nlspec · 2026-08-31 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-944.

This spec describes a documents-and-records deliverable: a scored brief over candidate cutover slices, a human-recorded selection of one of them, and the ADR that records the decision. Its sole input is the state-authority map FAFF-825 produces, and this ticket cannot start until that map exists and passes its own completeness checks. All repository facts below were checked against `174f62b7` on 2026-08-31.

## Why

The map FAFF-825 produces names every durable fact's owner, canonical writer, migration rule, and assurance class in the current `faff` implementation. This ticket uses that map to choose the first cutover slice of the V5 programme: the build scores a fixed set of candidates against the map and hands the human a scored brief, the human picks the winner, and the choice is recorded as an ADR. FAFF-827, the human Phase 1 acceptance gate, ratifies the choice by flipping the ADR to `Accepted`. Downstream, FAFF-828 consumes the selection at Phase 2A, where the cutover itself is built. The choice matters because a wrong slice creates the second canonical history the RFC's Phase 1 exit evidence forbids; that is why it is made on the map's evidence and recorded as a decision, never made in passing.

### Reference context

| Source | What it gives this work |
|---|---|
| `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` (FAFF-825's deliverable) | Every row key a score cites; the current mechanisms of the eight invariant families; the amendment-row verdict |
| `docs/rfc/rfc-superdomestique-runtime/v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md` | The six facade verbs; Phase 2A exit evidence; the "Decisions fixed by this direction" list; journal classes J-A to J-D; effect classes E-A to E-D; the second-producer rule |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | The six safe-boundary conditions; the eight rollback rules; the TypeScript sequencing |
| `records/adr/` (121 files, highest `0121`) | ADR house form; `Status: Proposed` is used by 48 of them (counted by the exact house form `- **Status:** Proposed`) |

## Out of scope

- **Building the slice.** Any code change under `plugin/skills/faff/bin/lib/`, any `commissaire` executable, contract-admission surface, or generic envelope: all named Phase 2A deliverables in the master RFC, and no such code exists in the repository today. Extension point: **FAFF-828** "Prove the external Commissaire protocol with a second producer", whose first-slice boundary covers the selected-slice cutover and the historical compatibility reader.
- **Writing new characterisation tests.** The master RFC lists them as a Phase 1 deliverable; which invariants are "applicable" is decided by the slice this ticket selects, so the tests are a follow-on ticket seeded from the map's `gap` rows, filed against that Phase 1 deliverable and blocking FAFF-827.
- **Editing the map.** `STATE-AUTHORITY-MAP-v5.md` is FAFF-825's deliverable. A defect found in it while scoring is routed back to FAFF-825 as a finding, not fixed in place here.

## What

### Vocabulary

| Term | Definition |
|---|---|
| Span | The ordered list of steps a candidate slice runs through, from contract admission to terminal verdict |
| Row key | The stable identifier of a mapped thing, as defined in `STATE-AUTHORITY-MAP-v5.md`: either a repository-relative artifact path, or a step named as `faff <command>` |
| Commissaire contract | Admitted versioned governance terms, per the master RFC. Unrelated to `faff contract <name>` |

### Deliverable files

**Chosen:** two files, both new.

| Path | New or edited | Holds |
|---|---|---|
| `docs/rfc/rfc-superdomestique-runtime/v5/CUTOVER-SLICE-SELECTION-v5.md` | new | The rubric, the scored candidate brief, the human's recorded choice, the selected slice's span, the eight-invariant verdict table, and the unknowns carried out |
| `records/adr/<next-free>-<slug>.md` | new | The slice selection as a decision, with the human's reasoning, `Status: Proposed`, citing the selection document |

Both carry a header naming the commit they were built against, following the convention already used in the master RFC's "Source basis" section, so the path-resolution check below is well defined.

**Chosen:** the ADR is written with `Status: Proposed`. FAFF-827, the human Phase 1 acceptance gate, is where it flips to `Accepted`. This is house convention (48 of the 121 existing ADRs sit at `Proposed`), and it keeps the roles distinct: the human who picks the winner here is deciding one slice, and FAFF-827 is where Phase 1 as a whole is accepted. The build derives the slug from the selected slice in the usual kebab-case decision-statement form, so the exact filename is not fixed here. Neither is the number: `0122` is the next free number as of writing, and the build re-checks `records/adr/` and takes whatever is next free, using it consistently in the filename and every citation.

**Chosen:** no entry is added to `docs/decisions.md`. That register's stated purpose is settling spec punts that faff's autonomous resolve-attempt may cite, which the slice selection is not. The ADR is the right record.

## How

### Scope of the work: select, do not build

The acceptance boundary inherited from FAFF-825 says "The selected slice runs from contract admission to terminal verdict", which reads two ways: the slice must be made to run, or the selection must span that whole distance.

**Chosen:** the span reading. This ticket produces documents and records only. Three pieces of evidence settle it. The parent ticket's own Outcome and Deliverable sections are entirely classification and recording. Item 7 of the master RFC's "Decisions fixed by this direction" says "Journal cutover begins only after the Phase 1 map and with the external producer in Phase 2A", so cutover is after this ticket by construction. And the `commissaire` executable is a named Phase 2A deliverable, with no admission code anywhere in the repository today, so the build reading would require this ticket to implement the whole Phase 2A facade first.

What the span reading demands instead: the selected slice must be traced end to end on paper, every step named with its semantic owner and its durable fact, with no gap left unexplained. A candidate whose span cannot be written down without inventing a step does not qualify.

### Who decides

**Chosen:** the human selects; the rubric informs. The build scores every candidate on every criterion with cited map row keys and hands the human a scored brief; the human picks the winner, and their reasoning is recorded in the ADR. The reason is plain: the earlier design made the rubric the decision maker, and its assurance floor and its two tie-breaks were the locus of four unresolved objections, a floor resting on self-assessed evidence cells and a vacuous completeness tie-break falling through to a fewer-steps rule the spec itself called perverse. Scores that do not decide anything cannot be circular or perverse.

Three consequences follow.

- **No floor.** A candidate scoring 0 on the assurance criterion is never eliminated. The 0 becomes a flag the brief must surface prominently: "this candidate's assurance position is unproven — see its evidence cells". The flag travels with the candidate into the human's decision; it never removes the candidate from the table.
- **No tie-breaks and no tie machinery.** A human choosing has no ties, so there is nothing to break, no tie to record, and no no-winner escalation path to design. The human may of course decline to pick, in which case the choice is routed to FAFF-827 and no ADR is written.
- **The brief is the deliverable of the scoring, and the ADR is the deliverable of the deciding.** The selection document names the winner and points at the ADR for the reasoning; the reasoning is the human's, not a total.

### Build procedure

```
PROCEDURE select_cutover_slice:
  1. REQUIRE STATE-AUTHORITY-MAP-v5.md exists and FAFF-825's own completeness
     asserts pass. This ticket does not start without it.
  2. Assemble the candidate set: the five named below, plus any further
     candidate the completed map surfaces. Minimum five.
  3. FOR each candidate, FOR each of the ten rubric criteria:
     a. Score it, citing the map row_key that supports the score.
     b. A criterion scored with no citation is invalid.
  4. Assemble the scored brief: every candidate with its per-criterion
     scores, citations, and total. A candidate scoring 0 on the assurance
     criterion carries the unproven-assurance flag prominently in the
     brief. No score eliminates any candidate.
  5. Hand the brief to the human. The human picks the winner; the ADR
     records their reasoning. IF the human declines to pick, route the
     choice to FAFF-827, record that in the selection document, and stop:
     no winner is named and no ADR is written.
  6. Write the winner's span: ordered steps from contract admission to
     terminal verdict, each naming semantic owner and durable fact.
     Derive the step list, do not compose it: walk the slice's modules in
     the map and emit a step for every ownership row they own, in call
     order, then add the not-yet-existing ends.
     The ends are derived too, from a CLOSED source: a not-yet-existing
     step must name one of the six Commissaire facade verbs the master RFC
     enumerates, verbatim. "Supplied by Phase 2A" is not a step; "admit a
     versioned contract" is. This is what gives the span an oracle at the
     admission end — the end every candidate lacks, and therefore the end
     where an under-traced span would otherwise be indistinguishable from a
     fully traced one. It also keeps the "derived, not composed" principle
     honest: the implemented steps derive from map rows, the missing ends
     derive from the RFC's closed verb list, and neither is free prose.
     Then check the span back against the map: every ownership row whose
     canonical_writer is a slice module must appear as a step, or be
     listed as deliberately outside the span with a reason. Without that
     back-check the span has no oracle — an omitted step leaves every
     per-step property passing and makes the span read as MORE completely
     traced than an honest one, which would let an under-traced span
     present itself to the human as an honest one.
  7. Write the eight-invariant verdict table for the winner.
  8. Write the ADR (Status: Proposed, next free number) citing the
     selection document and recording the human's reasoning.
```

### The rubric

Ten criteria, each scored 0 to 2, each derived from a cited line in the parent ticket's acceptance boundary, the RFC's Phase 2A exit evidence, or the master RFC's second-producer rule. No criterion is invented. The rubric is decision support: it structures the brief the human reads, and nothing in it decides the winner.

| Criterion | Source | 0 | 1 | 2 |
|---|---|---|---|---|
| No scheduling or skill dependency | Phase 2A exit: "the producer imports neither SuperDomestique scheduling nor current skills" | Slice modules require queue assembly or a `faff-*` skill | A dependency exists but is confined to one named module and is severable without redesign | Slice modules import neither |
| Complete span | Ticket acceptance boundary | Neither admission nor terminal verdict has a step | One end exists in current code and the other is supplied by a named Phase 2A facade verb | Both ends exist in current code |
| One canonical writer per state change | Ticket: "One owner and durable fact exists for every mapped state change" | Two or more writers on some step | Every step has one writer, but at least one is recorded as a single-writer finding rather than settled | One settled writer on every step |
| No second canonical history | Phase 1 exit evidence | Cutover requires mirroring a record into both formats | Mirroring is confined to a compatibility reader over frozen historical records | No mirroring needed |
| Existing characterisation coverage | RFC Phase 1 deliverable | Most steps are `gap` | Every step cites a test or `--selftest` table, but at least one covers the module rather than the specific durable fact | Every step cites coverage of the durable fact itself |
| Reversible | RFC rollback rule: additive publication can be disabled without changing current canonical files | Some step sits past the first-generic-work-item boundary | Every step is reversible, but at least one needs a documented manual step | Every step reversible by disabling additive publication alone |
| Stays behind the current `faff` surface | Phase 1 exit: "the first slice remains behind the current `faff` surface" | Needs a new live entrypoint | An existing `faff` command is the entry but needs a new flag or subcommand | An existing `faff` command is the entry unchanged |
| Small TypeScript travel | Ticket: "TypeScript conversion is proposed only where it travels with the selected useful slice; live entrypoints move last" | Requires converting a live entrypoint | Converts a module a live entrypoint imports, entrypoint itself unmoved | Only pure decision or record-mechanics modules |
| Present assurance class and its gap | Master RFC: "relied-on producer identities meet the declared journal class"; and its protected-effects rule that "Only E-A and E-B support a pre-execution prevention claim" | A relied-on stream's present class is J-D, or a protected effect is E-D, with no named mechanism that would raise it | Present class is below the target, and the map names the specific missing mechanism that would raise it | Every relied-on stream is already J-C or stronger and every protected effect already E-A or E-B, each by the mechanism its own evidence cell cites |
| Second producer plausibility | Master RFC: a domain-neutral record envelope arrives "only when an external producer becomes the second producer" (line 47); "Phase 2A supplies a second producer" (line 144); the "Stabilise after the second concrete use" principle (line 158, restated at line 278) | No plausible external producer exists for this slice's facade verb | A producer is conceivable but none is named | A concrete candidate producer exists, or the slice maps to a facade verb an external producer demonstrably needs first |

The reversibility criterion scores the reversibility of the slice's present steps. The Phase 2A cutover step's rollback is Phase 2A's burden to prove, and the criterion makes no claim about it.

**Chosen:** every criterion defines all three of `0`, `1`, and `2`. A declared range whose table gives only the endpoints is not a scale: two builds interpolate the middle differently, both honestly follow the spec, and the brief the human reads becomes an artefact of which build ran. The span criterion is the worked case the rest follow — a candidate whose admission end would be supplied by the Phase 2A facade's first verb ("admit a versioned contract") scores 1 rather than being eliminated, because pass-or-fail would eliminate every candidate when contract admission does not exist in the codebase at all.

**Chosen:** the assurance criterion scores the **present assurance class and the named gap to the target**, not a prediction about a producer that does not exist. Without it, the brief could rank first a slice that scores well on every structural property and still cannot be proven, because the Phase 2A proof it feeds tests exactly what the other criteria never ask: what journal class the slice's records reach, and what effect-control class its protected effects achieve. A slice resting on self-declared producer identity is J-D by the RFC's own rule, and no amount of reversibility or narrow TypeScript travel repairs that. The map can evidence what class a record reaches today, from the mechanism its `journal_evidence` and `effect_evidence` cells cite; it cannot evidence what class it would reach under a Phase 2A producer whose authentication mechanism the master RFC explicitly defers to that phase. Scoring the present class plus the named missing mechanism keeps the criterion answerable from the map, and a candidate whose gap has no nameable mechanism scores 0 rather than being guessed at. Under this ticket's decision structure that 0 eliminates nothing: it raises the unproven-assurance flag the brief must carry prominently.

**Chosen:** a tenth criterion, second producer plausibility. The master RFC introduces a domain-neutral record envelope "only when an external producer becomes the second producer" (line 47), states that "Phase 2A supplies a second producer" (line 144), and carries the principle "Stabilise after the second concrete use" (line 158, restated at line 278). A slice whose facade verb no external producer would plausibly use defers that proof indefinitely, and none of the other nine criteria ask the question. The candidate-floor row "Merge floor" maps to no facade verb, so this criterion separates candidates rather than scoring them all alike.

### The candidate floor

The build scores at least these five, each anchored to modules verified present at `174f62b7`:

| Candidate | Modules | Facade verb it maps to |
|---|---|---|
| Recovery-bundle publish and verify | `bundle.js`, `bundle-recover.js`, `integrity-digest.js` | Seal and export an audit bundle |
| Declared effects | `effects.js` (declare, observe, check), `effects-chain-head.json` | Request a protected-effect decision |
| Run-end ground truth | `reconcile.js`, `disposition.js`, `runcheck.js` | Append observations and request reconciliation; request a terminal conformance verdict |
| Merge floor | `merge-gate.js`, `lane-boundary.js`, the anchors tree | None; Software Delivery policy |
| Corrective authority | `contain.js`, `corrective.js`, `corrective-integrity.js` | None directly; authority and obligations |

The spec deliberately does not name the winner. Naming it here would put the conclusion into the premise, and the map, the ADR, and the FAFF-827 review would all inherit it and read as independent support for a choice made before any evidence was gathered. The rubric is fixed; the answer is not. That holds with more force now that a human decides: an unanchored brief is what lets them choose on the evidence rather than ratify a premise.

### The eight-invariant verdict table

The winner's table covers the eight invariant families whose current mechanisms `STATE-AUTHORITY-MAP-v5.md` documents: queue, termination, budget, liveness, gate, merge, effect, and amendment. This ticket does not re-derive the current mechanisms; it reads them from the map and states, for the selected slice, what happens to each family. Each family carries one of **three** verdicts, not two: `retained`, `intentionally changed` (which must cite the test, the migration rule, and the rollback path that make the change safe), or `broken`. A change with no test, no migration rule and no rollback path is `broken`, not `intentionally changed` — and a `broken` invariant is a park trigger, escalated to FAFF-827 rather than recorded and passed over.

Two family-specific rules apply. On liveness, ratified precedent governs the scoring: a read-only reconstruct-and-preview verb adds no liveness machinery of its own (`docs/decisions.md`, "Cross-box liveness for a read-only recovery verb"), so a candidate whose span includes a recovery-bundle publish step must not be scored as if that step needed a heartbeat or lease. On amendment, the map establishes the row's verdict about the current system; this ticket's document states whether the chosen slice touches the family, citing the map's verdict.

### Unknowns routing

Unknowns that could change authority or canonicality are listed in a named section of the selection document, each routed to the ADR, a spike, or a follow-on ticket, and each carrying the one-line reason it could not be settled here. The reason is what makes the routing checkable; "none is guessed" on its own is not a criterion a reviewer can fail.

### Failure modes

**No candidate spans admission to terminal verdict.** How you would know: every candidate's span table has an empty admission row. What it means: this is a valid result, not a gap to paper over. Record that the selected slice's admission step is the Phase 2A facade's first verb and that the step does not exist yet. Do not invent an admission surface to fill the row.

**Smallest and safe pull apart.** How you would know: the highest-scoring candidate on the safety criteria (single writer, no second history, reversible) also carries the most mapped steps. What it means: the brief states the tradeoff plainly, because "smallest safe" assumed the two would agree and this is evidence they do not. The human decides it knowingly, or sends it to FAFF-827.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given CUTOVER-SLICE-SELECTION-v5.md
When each of the ten rubric criteria is read for each candidate
Then every score cites a row_key that exists in STATE-AUTHORITY-MAP-v5.md
```

```
Given the selected slice's span table
When it is read from admission to terminal verdict
Then each step names exactly one semantic owner
And each step names one durable fact, or lists all of them and is marked a multi-fact step
And any step with no current implementation says so and names the Phase 2A verb that would supply it
```

```
Given a candidate scoring 0 on the assurance criterion
When the scored brief is read
Then the candidate appears in the table with all its scores
And the brief carries its unproven-assurance flag where the human cannot miss it
And no candidate is marked eliminated
```

## Open questions and assumptions

**Open questions:** none. Every question carried into this spec is marked `Chosen` above, on cited evidence.

**Assumptions**

**Assumes:** `records/adr/` still runs to `0121`, so `0122` is the next free number.
*Validation before starting:* `ls records/adr | sort | tail -1`. If a higher number exists, take the next free one and use it consistently across the ADR file and the selection document's citation.

## Done

### From why
- [ ] `CUTOVER-SLICE-SELECTION-v5.md` exists in `docs/rfc/rfc-superdomestique-runtime/v5/` with a header naming the commit it was built against.

### From what (deliverable files)
- [ ] An ADR exists at `records/adr/<next-free-number>-<slug>.md` — `0122` unless a higher number landed first, in which case the next free one, used consistently in the file name and in every citation of it. It carries `- **Status:** Proposed`, an `- **Issue:**` line naming this ticket, cites `CUTOVER-SLICE-SELECTION-v5.md`, and records the human's reasoning for the choice. If the human declined to pick, no ADR exists and the selection document records the routing to FAFF-827 instead.
- [ ] **The selection smoke checks have been run and all five pass.** A failing check blocks the selection, and the failure is recorded rather than worked around.
- [ ] No file under `plugin/skills/faff/bin/lib/` and no file under `test/` was added, edited, or deleted.
- [ ] `docs/decisions.md` is unchanged.
- [ ] `STATE-AUTHORITY-MAP-v5.md` is unchanged; any defect found in it is routed to FAFF-825 as a finding.

### From how (selection)
- [ ] At least five candidates are scored, including all five of the candidate floor.
- [ ] All ten rubric criteria are scored for every candidate, including the present-assurance-class criterion and the second-producer-plausibility criterion.
- [ ] Every criterion defines `0`, `1`, and `2` in the rubric table, and every score recorded is one of those three. No score is interpolated against an undefined midpoint.
- [ ] Every score cites a row key present in the map.
- [ ] No candidate is eliminated by any score. A candidate scoring 0 on the assurance criterion carries the unproven-assurance flag prominently in the brief and keeps its place in the table.
- [ ] The human's choice is recorded: the selection document names the winner, and the ADR records the human's reasoning. If the human declined, no winner is named, no ADR exists, and the routing to FAFF-827 is recorded.
- [ ] The selected slice's span table runs from contract admission to terminal verdict with no unexplained gap; a step with no current implementation says so and names the Phase 2A facade verb that would supply it.
- [ ] The span is derived from the map and checked back against it: every ownership row owned by a slice module appears as a span step, or is listed as deliberately outside the span with a reason. A span that names steps the map does not know, or omits rows the map does know, fails.
- [ ] Every span step names one semantic owner and one durable fact. A step that genuinely writes several durable facts is recorded as one step listing all of them, with a note that it is a multi-fact step — the same escape hatch the single-writer rule uses, never a silent choice of the first file.
- [ ] The eight-invariant table covers queue, termination, budget, liveness, gate, merge, effect, and amendment, each carrying one of **three** verdicts, not two: `retained`, `intentionally changed` (which must cite the test, the migration rule, and the rollback path that make the change safe), or `broken`. A change with no test, no migration rule and no rollback path is `broken`, not `intentionally changed` — and a `broken` invariant is a park trigger, escalated to FAFF-827 rather than recorded and passed over.
- [ ] The selection document states whether the chosen slice touches the amendment family, citing the map's amendment verdict.
- [ ] Unknowns that could change authority or canonicality are listed in a named section of the selection document, each routed to the ADR, a spike, or a follow-on ticket, and each carrying the one-line reason it could not be settled here. The reason is what makes the routing checkable; "none is guessed" on its own is not a criterion a reviewer can fail.

### Selection smoke checks

```
PROCEDURE selection_smoke_test:
  1. Read the commit recorded in the selection document's header.
  2. Extract every repository-relative path cited in the selection document
     and in the ADR. A cited path is a repository-relative path in an
     inline code span or a table cell; prose mentions of directory names
     are not citations. FOR each path: reject it unless it matches a
     restrictive repo-relative shape (no leading `/`, no `..` segment, no
     shell metacharacter), then assert it exists at the commit, passing
     `<commit>:<path>` as a SINGLE argv element — never interpolated into
     a shell command string.
  3. FOR each score in the candidate table: assert the row_key it cites
     appears in STATE-AUTHORITY-MAP-v5.md.
  4. Extract every quoted RFC fragment together with the section the
     selection document attributes it to. FOR each: assert the fragment
     appears verbatim in the named file, and that the nearest preceding
     heading at that position is the one the citing document names.
  5. Assert the ADR's own citations resolve: the selection document path
     it cites exists, and any map row key it cites appears in the map.
```

**Failure behaviour.** A failing check blocks the selection. Record which check failed and on what input, fix the document, and re-run all five — never ship with a recorded failure, and never narrow a check so it passes.

What the five checks prove is that every claim the selection makes points at something that exists, where it says it exists. What they do not prove is that the choice is the right one. That judgement belongs to the human who makes it here and to FAFF-827, which ratifies it; the documents' job is to make it cheap to check rather than to settle it by arithmetic.

confidence: high
build-tier: standard
