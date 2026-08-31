# FAFF-825: map current state authority of the faff CLI

> Spec: faffter-dark-nlspec · 2026-08-31 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-825.

This spec describes a documents-and-records deliverable: a state-authority and migration map of the current `faff` implementation. The audience is the build agent that will write the map, and the human reviewers at FAFF-827 who accept Phase 1 evidence. The cutover-slice selection this map feeds moved to its own ticket by human decision on 2026-08-31; this map is that ticket's sole input. All repository facts below were checked against `174f62b7` on 2026-08-31.

## Why

The idea this ticket turns on: **you cannot safely cut anything over until every durable fact in the system has exactly one named owner and exactly one named writer, and today nobody has written that list down.** The V5 programme's first irreversible step is creating the first canonical generic-format work item (`docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md`, "Rollback"). Everything before that is reversible; everything after depends on knowing which record the new writer replaces and which reader still has to serve the old one. The map is the thing that makes that knowable.

**Problem statement.** The repository has two coarse partial maps (the "Current records and artifacts" table and the "Current-to-target responsibility map", both in `TECHNICAL-DESIGN-v5.md`, covering roughly nine headline artifacts), plus a machine-checked command-to-region classification in `plugin/skills/faff/bin/lib/regions.js` that answers a different question. Neither records who semantically owns a record, which identity keys it, what integrity class it achieves, or what a compatibility reader would have to do with pre-cutover instances. Without that, choosing a cutover slice is guesswork, and a wrong choice creates the second canonical history the RFC's Phase 1 exit evidence forbids.

**What this changes.** This ticket produces the map at the grain the RFC's Phase 1 canonicality rule demands ("The map names current writers, current consumers, integrity, future owner, translation, cutover, and rollback"). The slice selection that consumes the map is the follow-on ticket's job; this ticket ends when the map is complete, internally checked, and pointed at from the technical design.

### Design principles

**The map is derived, not composed.** Every row must trace to a file the build read. A row whose canonical writer cannot be pointed at in a module is a gap to record, not a judgement to make. This is the single rule that would cause a reviewer to reject an otherwise plausible map.

**Region is evidence, not the answer.** `regions.js` classifies 114 commands into `governance` (17) and `factory` (97), verified by running the map through Node at `174f62b7`. The RFC says this explicitly: "The current `governance` region is mainly the flight recorder and interlocks... It is not identical to future Commissaire ownership" and "`governance-check` currently belongs to `factory` because it imports Software Delivery gate functions" (`TECHNICAL-DESIGN-v5.md`, "Current dependency regions"). The map carries the current region as a column and the semantic owner as a separate column, and they are allowed to disagree.

**Mapping is not building.** No module changes, no test file is added, no vocabulary is introduced into any `.js` file. Phase 2A owns the cutover.

**The smallest map that can choose, not the largest map that can be written.** The ticket says "smallest complete". Completeness is measured against the command registry and the durable-artifact set, not against everything that could be described.

### Reference context

| Source | What it gives this work |
|---|---|
| `docs/rfc/rfc-superdomestique-runtime/v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md` | Phase 1 deliverables and exit evidence; the six identities; the three disposition scopes; journal classes J-A to J-D; effect classes E-A to E-D; the six facade verbs; the four work-item terminal verdicts |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | The two coarse tables to extend; the four Phase 1 migration classifications; the six safe-boundary conditions; the eight rollback rules; the verification test layers |
| `plugin/skills/faff/bin/lib/regions.js` | `REGION_MAP`: the authoritative command registry, 114 entries. Derive the classification table from it by reading it, never by hand-listing |
| `plugin/skills/faff/bin/lib/governance-profile.js` | `DELIVERY_PROFILE.terminal_states` (8 values) and `ledger_outcomes` (9 values): the only populated disposition vocabularies in the codebase, both run-membership scoped |
| `docs/rfc/rfc-superdomestique-runtime/v5/ARCHITECTURE-DIAGRAMS-v5.md`, "Current implementation map" | Existing high-level diagrams to cite, not redraw |

**Scope statement.** This is the first ticket of V5 Phase 1. The cutover-slice selection ticket, FAFF-944, consumes this map and is blocked by this ticket. FAFF-826 measures orchestration fidelity against the map's decision-point rows; FAFF-827 is the human acceptance gate for the whole of Phase 1. All three sit downstream of this ticket. Further downstream, FAFF-828 consumes the selection at Phase 2A.

## Out of scope

- **The slice selection** — moved to its own ticket by human decision, 2026-08-31; this ticket's map is its sole input. The rubric, the candidate floor, the span derivation, the eight-invariant verdict table for the winner, the unknowns routing, and the ADR all live in that ticket's spec.
- **Any code change under `plugin/skills/faff/bin/lib/`.** Excluded because the RFC assigns cutover to Phase 2A and this ticket's own outcome is a map. Extension point: **FAFF-828** "Prove the external Commissaire protocol with a second producer", which is already filed, sits in Backlog blocked by FAFF-827 and FAFF-824, and whose first-slice boundary covers the selected-slice cutover and the historical compatibility reader.
- **Writing new characterisation tests.** The master RFC lists "characterisation tests seeded from the applicable v2 invariants" as a Phase 1 deliverable with no slice qualifier, so this is a deliberate scope split within Phase 1 rather than something the RFC already excludes. The reason to split: which invariants are "applicable" is decided by the selected slice, and the slice is unknown until the selection ticket ends, so writing them here would mean writing them for every candidate or guessing the winner. This ticket records which tests already exist per row and marks absences as `gap`. Extension point: a follow-on ticket seeded from the map's `gap` rows, filed against this Phase 1 deliverable and blocking FAFF-827.
- **The shadow-coordinator comparison and the coordination-fidelity result.** Excluded: FAFF-826 owns them. Extension point: FAFF-826 consumes this map's decision-point rows as its input set.
- **Placing the work-item terminal-verdict vocabulary (`accepted_under_contract`, `outcome_rejected`, `cancelled`, `abandoned`) into any module.** Excluded because it is a canonical-state change, which Phase 2A owns. Extension point: `plugin/skills/faff/bin/lib/governance-profile.js`, which already carries two deliberately separate disposition keys and would take a third.
- **Any `commissaire` executable, contract-admission surface, or generic envelope.** Excluded: named Phase 2A deliverables in the master RFC. No such code exists in the repository today.
- **Editing `docs/rfc/rfc-superdomestique-runtime/v5/FAFF-PLOT-INPUT-v5.md`.** Its line 157 poses this ticket's founding question and is a dated planning input; historical planning records are not rewritten when the question gets answered. Extension point: none needed; the new map document is discoverable from `TECHNICAL-DESIGN-v5.md`.
- **A pinned compatibility release baseline.** Excluded: the RFC places it "before the first runtime or interface cutover", which is Phase 2A. Extension point: `TECHNICAL-DESIGN-v5.md`, "Compatibility and release baseline".

## What

### Vocabulary

| Term | Definition |
|---|---|
| Row key | The stable identifier of a mapped thing: either a repository-relative artifact path, or a step named as `faff <command>` |
| State-changing step | A command that writes or mutates a durable file under `.faff/`, `records/`, or the anchors tree, or mutates tracker state. Everything else is read-only and is recorded as such |
| Canonical writer | The one module and exported function that is entitled to produce a given durable fact. Exactly one per row |
| Semantic owner | Which of the master RFC's five Phase 1 buckets owns the meaning of the record, independent of which module holds the bytes today |
| Migration rule | Which of the RFC's four Phase 1 future classifications the record takes at cutover |
| Safe boundary | Which of the six Phase 0 safe-boundary conditions the row participates in |
| Commissaire contract | Admitted versioned governance terms, per the master RFC. Unrelated to `faff contract <name>` |

### The five buckets, and which list governs

The master RFC's Phase 1 section names five buckets. `TECHNICAL-DESIGN-v5.md`'s "Interface migration" section names a different five (Commissaire governance; SuperDomestique runtime; Software Delivery; shared record or infrastructure mechanics; compatibility-only). The two lists overlap but are not the same.

**Chosen:** the master RFC's five buckets are the `semantic_owner` vocabulary. The master's own "Source basis" note settles the precedence: where the master and the technical design disagree, "the later inspection is the fresher observation, while this document still controls strategy", and a classification vocabulary is strategy, not implementation detail. The technical design's `compatibility-only` value is preserved as a separate boolean column rather than merged, because a command can be both Commissaire-owned in meaning and destined to survive only as an alias.

### Type definitions

```
ENUM Bucket:
  commissaire-governance
  decision-kernel                       # "deterministic decision kernel"
  software-delivery-policy
  harness-and-skill-orchestration
  external-adapters-and-infrastructure

ENUM Region:          governance | factory        # the ONLY two values REGION_MAP
                                                  # produces across its 114 entries;
                                                  # current_region is copied verbatim,
                                                  # so no third value is reachable
ENUM Identity:        run | run-segment | work-item | contract-revision
                    | stage-attempt | effect | none
ENUM DispositionScope: run-segment | run-membership | work-item | none
ENUM JournalClass:    J-A | J-B | J-C | J-D | n/a   # authority of a relied-on record stream
ENUM EffectClass:     E-A | E-B | E-C | E-D | n/a   # control over a protected effect
ENUM MigrationRule:   translated | rebuildable-projection | immutable-blob
                    | frozen-historical
ENUM Reversibility:   reversible | irreversible-after-first-generic-work-item
```

```
RECORD ClassificationRow:              # one per REGION_MAP entry, 114 of them
  command:            String           # the REGION_MAP key, verbatim
  current_region:     Region
  semantic_owner:     Bucket
  owner_basis:        String           # ONE clause naming what the module does that
                                       # puts it in that bucket, so a reviewer can
                                       # disagree with a reason rather than a label
  state_changing:     yes | no
  write_evidence:     String           # module path + the write call, or "no durable write"
  compatibility_only: yes | no

  CONSTRAINT no field is blank
  CONSTRAINT where semantic_owner disagrees with current_region, owner_basis
             says why — that disagreement is expected and is the map's whole
             point, but it is never left unexplained
```

```
RECORD OwnershipRow:                   # one per durable artifact + one per state-changing step
  row_key:            String
  semantic_owner:     Bucket
  canonical_writer:   String           # exactly one "module.js :: functionName"
  readers:            List<String>     # module paths; may be empty
  identity:           Identity
  disposition_scope:  DispositionScope

  CONSTRAINT exactly one canonical_writer; a row needing two is recorded
             as a named finding, never split across two rows
```

```
RECORD MigrationRow:                   # same row_key set as OwnershipRow
  row_key:                String
  migration_rule:         MigrationRule
  compatibility_path:     String       # what a Phase 2A reader does with pre-cutover instances
  safe_boundary:          List<SafeBoundaryCondition>   # may be empty
  rollback:               RollbackRuleRef + Reversibility
  characterisation_tests: List<String> | "gap"

  CONSTRAINT rowkeys(MigrationRow) == rowkeys(OwnershipRow)
```

```
RECORD AssuranceRow:                   # same row_key set again — a THIRD paired table
  row_key:            String
  journal_class:      JournalClass     # what authority this row's record stream reaches
  journal_evidence:   String           # the mechanism that EARNS it: the chain, witness,
                                       # or credential path, in a named module — or "n/a"
                                       # with a reason when the row carries no stream
  effect_class:       EffectClass      # what control this row's protected effect reaches
  effect_evidence:    String           # same shape; "n/a" with a reason when no effect

  CONSTRAINT rowkeys(AssuranceRow) == rowkeys(OwnershipRow)
  CONSTRAINT a row that is BOTH a relied-on stream and a protected effect states
             BOTH classes. Neither may be left n/a to avoid the other.
```

**Chosen:** journal authority and effect control are **separate columns in a separate table**, never one `integrity_class` field. A single column forces a row that is both — the declared-effects chain is the worked example, carrying chain integrity *and* effect-observation semantics — to pick one label. If it picks `E-C`, a reviewer testing journal authority never sees `J-D` stated, and the slice that later builds on this row inherits a relied-on stream whose journal authority was never established. The master RFC is explicit that "Effect, independence, and journal assurance are separate structured claims", so collapsing two of them into one field contradicts the source the classes come from. A third narrow table sharing the row-key set follows the pattern the other two already use, and keeps every table inside its own ceiling.

`SafeBoundaryCondition` is one of the six bullets under "Safe-boundary recovery" in `TECHNICAL-DESIGN-v5.md`. `RollbackRuleRef` names one of the eight bullets under "Rollback" in the same document. Both are cited by their wording, not by an invented number.

### Deliverable files

**Chosen:** two files, one new and one lightly edited.

| Path | New or edited | Holds |
|---|---|---|
| `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` | new | The classification table, the ownership table, the migration table, the assurance table, the disposition-scope table, and the recorded gaps |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | edited | One pointer line under each of its two existing coarse tables, naming the new map as the fine-grained successor. Nothing else changes |

The map carries a header naming the commit it was built against, following the convention already used in the master RFC's "Source basis" section, so the path-resolution check below is well defined. The map is a companion document rather than an in-place extension because the technical design records an inspection at a named commit; mutating it beyond the two pointer lines would falsify that record. The map is a standing reference later phases re-read and update; the selection is a one-time scored decision with a different review audience, which is part of why it is now a different ticket.

### Map grain

**Chosen:** two grains, because one grain either drowns the map or leaves it incomplete.

- **All 114 commands** get a `ClassificationRow`. Cheap, mechanical, and it satisfies the ticket's "classify current paths" instruction with a row count a reviewer can check against the registry.
- **Only durable artifacts and state-changing steps** get the full `OwnershipRow` plus `MigrationRow` pair. Read-only commands appear in the classification table with `state_changing: no` and a stated reason, and nowhere else.

**Chosen:** the fields are split across narrow tables sharing a row-key set, rather than one wide table. A single eleven-column markdown table does not render legibly, and the shared-key constraint gives a mechanical completeness check that one wide table would not.

The ceiling is stated per table, counted the same way in each: **the key column counts**, and each ceiling equals that table's declared field count exactly. `ClassificationRow` is **seven** (`command`, `current_region`, `semantic_owner`, `owner_basis`, `state_changing`, `write_evidence`, `compatibility_only`), `OwnershipRow` is **six** (`row_key`, `semantic_owner`, `canonical_writer`, `readers`, `identity`, `disposition_scope`), `MigrationRow` is **six** (`row_key`, `migration_rule`, `compatibility_path`, `safe_boundary`, `rollback`, `characterisation_tests`), and `AssuranceRow` is **five** (`row_key`, `journal_class`, `journal_evidence`, `effect_class`, `effect_evidence`). `row_key` cannot be dropped from either paired table — the shared-key completeness check depends on it. The ceiling follows the declared field count; the field count is never trimmed to hit a rounder ceiling. Three earlier drafts asserted ceilings their own records could not satisfy; the rule that stops it recurring is that a table's ceiling is defined as its record's field count, so adding a field raises the ceiling by construction.

**Chosen:** tracker writes count as state-changing steps and are mapped. Their `migration_rule` is `rebuildable-projection`, because the RFC classifies tracker state as "a projection and command surface", and their `effect_class` is `E-C` where `effects.js` already treats the mutation as a declared effect observed after the attempt, with `journal_class` stated separately on the same row. Both facts go in the same row; the tension between "only a projection" and "a protected effect" is real and the map records it rather than resolving it.

**Chosen:** the grain is **one row per kind of tracker mutation** — status transition, comment, label, relation — not one row for "tracker state" and not one per field. One row for the whole projection hides that a status transition and a label write have different owners and different effect classes; one row per field explodes the table for no gain. The same rule settles the anchors tree: one row per anchor kind, not one per file. State the chosen grain in the map's own vocabulary section so a later reader can tell a complete table from a coarse one.

### Anti-patterns

**Anti-pattern:** mapping `faff contract <name>` as Commissaire governance. Why: `plugin/skills/faff/bin/lib/contract-defs.js` and `contract-engine.js` are the slot-handoff extraction validator, a JSON-Schema-subset checker over producer prose output. They have nothing to do with admitting versioned governance terms. The name collision is the trap.

**Anti-pattern:** copying `regions.js` region labels into the `semantic_owner` column. Why: the RFC says the region graph is an input and not the answer, and gives `governance-check` as the worked counter-example.

**Anti-pattern:** renaming the regions and presenting the rename as extraction. Why: stated verbatim in `TECHNICAL-DESIGN-v5.md`, "Phase 1 uses the current region graph as evidence. It does not rename the regions and treat the rename as extraction."

## How

### Build procedure

```
PROCEDURE produce_state_authority_map:
  1. Record the current commit in the new document header.
  2. Read REGION_MAP from regions.js. Emit one ClassificationRow per entry.
     a. current_region comes from the map value, verbatim.
     b. semantic_owner is judged by reading the module, not by the region.
        Record owner_basis in the same pass: one clause naming what the
        module does that puts it in that bucket. The bucket alone is a
        label a reviewer can only accept or reject; the clause is a claim
        they can check.
     c. state_changing is judged by whether the module has a durable write path;
        record the write call as evidence, or "no durable write".
  3. Assemble the durable-artifact set TWICE, from two independent directions,
     and diff them. A set derived only from the rows' own write_evidence can
     only ever agree with itself.
     a. Derived: every file any classification row's write_evidence names,
        plus the anchors tree and tracker state.
     b. Swept: enumerate durable write call sites directly across the WHOLE
        repository, excluding only test/ and node_modules/. Scoping the sweep
        to the CLI's own lib/ would make it a second view of the same
        territory rather than an independent one — skill-side code writes
        durable files too (evaluate-call.mjs writes .faff/holdout/<key>.json,
        and bin/faff itself carries no write calls at all).
        Run it in TWO bounded passes, so the sweep stays mechanically
        executable instead of collapsing into the same judgement that
        produced direction (a):
          i.  SEED (closed, greppable): every writeFileSync, appendFileSync,
              renameSync, mkdirSync, unlinkSync, rmSync, copyFileSync,
              cpSync, writeSync, and every tracker-mutating call.
          ii. CLOSURE (bounded, mechanical): any function that calls a seed
              site is itself a write site; repeat until the set stops
              growing. This is what catches a `persist()` wrapper without
              requiring a human to read every call in the repository.
        The closure pass is what makes the list effectively open while
        keeping it executable: openness comes from following wrappers to a
        fixed point, NOT from judging each call on its merits. If a durable
        write reaches the disk by some route neither pass finds, record it
        as a named limitation of the sweep rather than claiming coverage
        the method does not have.
     c. Diff (a) and (b) BOTH WAYS.
        - A site in (b) and not (a): a state-changing command was recorded
          read-only, or a write_evidence cell is wrong. Fix the row, never
          the sweep.
        - An artifact in (a) and not (b): a write_evidence cell names a write
          the sweep cannot find, so either the evidence is wrong or the sweep
          missed a mechanism. Resolve it before the map ships.
        Record BOTH SETS IN FULL in the map's gaps section — the derived
        list and the swept list, each as enumerated paths — followed by the
        two-way difference and its resolution. A bare "diff: empty" is not
        acceptable: it is indistinguishable from a diff that was never
        computed, and the two enumerated lists are what let a reviewer (or
        the smoke test) recompute the difference instead of trusting it.
        Name the swept scope on the same section.
  4. FOR each artifact and each state_changing command:
     a. Emit an OwnershipRow. If two modules appear to write the same fact,
        do NOT split the row: record it as a single-writer finding in the
        map's gaps section.
     b. Emit a MigrationRow and an AssuranceRow under the same row_key.
        A class is a CLAIM, not a label: record journal_evidence and
        effect_evidence naming the mechanism that earns each, in the same
        shape write_evidence takes. A class with no nameable mechanism is
        recorded at the weakest class it can prove, never at the one it
        would like to hold. Where the row is both a stream and an effect,
        state both classes; n/a on one to dodge the other is the bypass
        this split exists to close.
     c. characterisation_tests cites an existing test/*.test.mjs path, or the
        inline --selftest fixture table and its line range, or "gap" — and
        the citation must cover THIS ROW'S durable fact, not merely the
        module that writes it. A module-level test that never exercises the
        row's fact is a "gap" with a note, not coverage: recording it as
        coverage seeds the follow-on gap ticket from the wrong set.
  5. Emit the disposition-scope table: three rows (run segment, run membership,
     work item), each naming the current vocabulary in code, its source line,
     its semantic owner, and its gap.
  6. Assert rowkeys(OwnershipRow) == rowkeys(MigrationRow) == rowkeys(AssuranceRow).
  7. Assert the classification row count equals the REGION_MAP entry count.
  8. Assert the step-3 diff is resolved IN BOTH DIRECTIONS: every swept write
     site resolves to a row in the ownership table, and every ownership row's
     write_evidence resolves to a swept site — or is recorded with a stated
     reason. Assert also that the map names the swept scope, so a reader can
     tell what the diff's "empty" actually covered. An unresolved entry in
     either direction blocks the map, because the diff is the only signal
     that a durable fact went unmapped, and a diff over a narrow scope
     reports "empty" exactly as a complete one does.
```

### The eight invariant families: current mechanisms

The selection ticket must identify every current queue, termination, budget, liveness, gate, merge, effect, and amendment invariant touched by the slice it selects. The map documents each family's current mechanism so that verdict table can be derived from the map rather than composed. The current mechanisms, verified by reading the modules:

| Family | Current mechanism | Module |
|---|---|---|
| Queue | Pure `queue_empty` / `all_parked` derived from durable gitkeys diffed against ledger `outcomes{}` | `queue-state.js` |
| Termination | Fixed safety floor plus the policy-weighted rung ladder to run-complete, continue, or escalate | `run-done.js` |
| Budget | Four-dimension envelope (until, max_attempts, tokens, cost) with at-ceiling outcomes stop, narrow, escalate; plus `parked-window` for a `budget.window` breach | `budget.js`, `governance-profile.js` |
| Liveness | Sole sanctioned write path to `.faff/runs/<run-id>/heartbeat` via tmp-plus-rename; staleness threshold shared with sentry. **Ratified precedent applies:** a read-only reconstruct-and-preview verb adds no liveness machinery of its own — the write-once claim belongs at the continuation boundary, not the read-only verb (`docs/decisions.md`, "Cross-box liveness for a read-only recovery verb"). A candidate whose span includes a recovery-bundle publish step must not be scored as if that step needed a heartbeat or lease | `heartbeat.js`, `sentry.js` |
| Gate | Review, holdout, and merge gates; slot contracts validated by the schema-subset engine | `gates.js`, `contract-engine.js` |
| Merge | Pure `decideFloor` core plus an impure shell that re-observes CI on the resolved head sha; the sole sanctioned `gh pr merge` path | `merge-gate.js` |
| Effect | `declared-effects.jsonl` chain, declare before acting, `check` computes observed minus declared; detection only, never aborts | `effects.js` |
| Amendment | **No current mechanism.** The RFC's rule that "A material change creates a new immutable contract revision and a new admission decision" has no code counterpart | none |

The amendment row is the one row whose value this spec does not fix in advance. The expectation from a first reading is that no current mechanism exists, but the map must **establish** that rather than assert it, and it must say which surfaces it ruled out and why. Three candidates deserve an explicit verdict, because each carries part of the shape the RFC's rule describes ("A material change creates a new immutable contract revision and a new admission decision"):

| Candidate surface | Why it is a candidate | What to check |
|---|---|---|
| `corrective.js` | The closest analogue: it authors a validated corrective input and folds a cumulative constraint set into a mandate consumed at the next dispatch boundary | Does a material change mint a new immutable revision, or mutate a running one? |
| `contract-defs.js` | Holds the contract definitions themselves, so any versioning of terms would live here | Is there revision identity, or only a current shape? |
| `ratified-scope.js` | Named in earlier readings as the nearest surface | Its own header calls it a read-only reader that "never parses the meaning of what it copies", with `--validate` as "a well-formedness check, NOT an authenticity gate" — so on the face of it, no |

**Chosen:** the map states the amendment row's verdict with the evidence that earned it, names all three surfaces it considered, and, if the verdict is that no mechanism exists, says so as a finding owned by Commissaire. The selection ticket's document then states whether the chosen slice touches the family. What is fixed here is the obligation to check and cite; the answer is not.

### The work-item terminal-verdict scope

The codebase carries one populated disposition vocabulary and it is run-membership scoped: `DELIVERY_PROFILE.terminal_states` (eight values) and `ledger_outcomes` (the same eight plus `claimed-by-peer`), with a module comment stating the two keys are deliberately never unified. `disposition.js` adds a third, run-scoped clean-versus-needs-attention split. Grepping `accepted_under_contract` outside the RFC returns nothing.

**Chosen:** the map records the work-item scope as owned by Commissaire, per the RFC's responsibility table which gives Commissaire "terminal conformance", with the entry "no current implementation" and the four-state vocabulary quoted from the master RFC. This ticket adds nothing to `governance-profile.js` or any other module. Placement in code belongs to the ticket that builds the selected slice. Where the map's own evidence shows a placement would change canonicality, for instance by requiring a second writer to `run-ledger.json`, the map raises it as a named unknown carried to a decision or spike rather than settling it.

The three scopes are therefore not conflated today by accident; the third scope simply is not modelled, and the map's job is to say so plainly.

### Failure modes

**The field vocabulary does not fit the codebase.** How you would know: more than a handful of rows need `n/a` in `semantic_owner`, `journal_class`, `effect_class`, or `migration_rule`. What it means: the vocabulary is wrong for this system. Raise it as a named decision back to the RFC rather than forcing rows into categories that do not describe them.

**The table is bigger than one page-worth.** A first sizing says to expect it: 40 of the 114 registry commands have a same-named module under `plugin/skills/faff/bin/lib/` carrying a direct write call, more write through shared helpers, and the artifact set then adds the anchors tree, tracker state, and the per-issue evidence files. Somewhere between 70 and 90 ownership rows is the expected result, not a warning sign.

**Chosen:** size is a formatting problem, never a park trigger. Above roughly 60 rows the ownership and migration tables are emitted in sections grouped by area (run record, effects, gates and merge, corrective and containment, product records, harness orchestration), each section carrying the same columns, with a row-count line per section and a total. Completeness is still checked across the union of sections, so sectioning changes the layout and nothing else.

**Anti-pattern:** narrowing the definition of "state-changing" until the row count fits. Why: completeness here is measured against the command registry and the durable-artifact set, so trimming the definition to hit a size target is exactly the incompleteness no acceptance criterion downstream would detect. If the count feels unmanageable, section it; do not redefine it.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the completed classification table in STATE-AUTHORITY-MAP-v5.md
When its command column is joined against REGION_MAP from regions.js
Then every registry command appears exactly once
And no row names a command absent from the registry
```

```
Given the ownership, migration and assurance tables
When their row_key sets are compared
Then all three sets are identical, with no key in one and missing from another
```

- The disposition-scope table has exactly three rows and the work-item row states that no implementation exists.
- Each table's column count equals its RECORD's declared field count, counting the key column: seven for classification, six for ownership, six for migration, five for assurance. No declared field is dropped or merged to meet a ceiling, and no ceiling is asserted that its own record cannot satisfy.
- No cell in the classification table is blank.
- No module under `plugin/skills/faff/bin/lib/` and no file under `test/` is added, edited, or deleted by this ticket.

## Open questions and assumptions

**Open questions:** none. Every question carried into this spec is marked `Chosen` above, on cited evidence.

**Assumptions**

**Assumes:** FAFF-826 (read-only shadow comparison) and FAFF-827 (Phase 1 acceptance, human-task) are still Backlog and still blocked by this ticket, so measurement and acceptance stay out of scope here.
*Validation before starting:* check both issues in Linear. If either has moved or been unblocked independently, re-read its scope before writing the map, since the split of measurement work depends on it.

**Assumes:** `plugin/skills/faff/bin/lib/regions.js` still exports `REGION_MAP` covering every CLI command, and `lib/lint-cli-coverage.js` still gates registry coverage in CI, so the registry is a trustworthy denominator.
*Validation before starting:* run `faff regions selftest` and confirm it passes; confirm the entry count, which was 114 at `174f62b7`.

## Done

### From why
- [ ] `STATE-AUTHORITY-MAP-v5.md` exists in `docs/rfc/rfc-superdomestique-runtime/v5/` with a header naming the commit it was built against.
- [ ] `TECHNICAL-DESIGN-v5.md` carries one pointer line under "Current records and artifacts" and one under "Current-to-target responsibility map", each naming the new map. No other line in that file changed.

### From what (vocabulary and types)
- [ ] The classification table has exactly one row per `REGION_MAP` entry and no extra rows.
- [ ] Every `semantic_owner` cell holds one of the five master-RFC buckets and nothing else.
- [ ] Every `semantic_owner` cell is paired with a non-empty `owner_basis` clause naming what the module does that places it in that bucket. Every row where `semantic_owner` disagrees with `current_region` says why in that clause.
- [ ] Every `migration_rule` cell holds one of `translated`, `rebuildable-projection`, `immutable-blob`, `frozen-historical`.
- [ ] Every `journal_class` cell holds one of `J-A` to `J-D` or `n/a`; every `effect_class` cell holds one of `E-A` to `E-D` or `n/a`. No cell holds a value from the other family.
- [ ] Every class cell is paired with its own evidence cell naming the mechanism that earns it (the chain, witness, or credential path) in a named module. Enum membership alone does not satisfy either.
- [ ] No row uses `n/a` on one class to avoid stating the other. A row that is both a relied-on stream and a protected effect states both, each with its own evidence; an `n/a` carries a one-clause reason.
- [ ] Every `identity` cell holds one of the six RFC identities or `none`.
- [ ] Every `current_region` cell holds `governance` or `factory`, copied verbatim from `REGION_MAP`. Any other value means the column was judged rather than copied.
- [ ] No cell in the classification table is blank.
- [ ] The `compatibility_only` column exists and is populated for every classification row.

### From what (deliverable files)
- [ ] **The integration smoke test has been run and all eight steps pass.** It is an acceptance criterion, not an optional procedure: a failing step blocks the map exactly as an unresolved diff entry does, and the failure is recorded rather than worked around. A run that skips the smoke test has not met Done.
- [ ] No file under `plugin/skills/faff/bin/lib/` and no file under `test/` was added, edited, or deleted.
- [ ] `docs/decisions.md` is unchanged.
- [ ] `FAFF-PLOT-INPUT-v5.md` is unchanged.

### From how (map)
- [ ] The ownership, migration and assurance tables carry identical row-key sets.
- [ ] Every field the four RECORD schemas declare has a populated column, and the Done list checks each: `readers`, `disposition_scope`, `safe_boundary`, `rollback`, `compatibility_path`, and the two class/evidence pairs are as required as the fields they sit beside. Three of them — consumers, cutover and rollback — are named directly by the RFC's own map requirement, so a map that omits them fails that requirement however many other boxes it ticks.
- [ ] Every ownership row populates `readers` (a module-path list, or an explicit empty list with a stated reason — never a blank cell) and `disposition_scope` (one of the four values, `none` included).
- [ ] Every migration row populates `compatibility_path` (what a Phase 2A reader does with pre-cutover instances), `safe_boundary` (the conditions it participates in, or an explicit empty list), and `rollback` (a rollback-rule reference plus its reversibility value).
- [ ] The map records the step-3 sweep-versus-derived diff in both directions, and every entry in it either resolves or carries a stated reason. A map with no diff section is incomplete even if every other check passes.
- [ ] The map states the swept scope explicitly (the whole repository excluding `test/` and `node_modules/`) and confirms the sweep was not restricted to the CLI's own `lib/`. An "empty" diff over an unstated or narrow scope proves nothing.
- [ ] Every ownership row names exactly one canonical writer as `module.js :: functionName` — the settled writer, or the leading candidate when a single-writer finding is recorded; a row with a finding still names its leading writer — and every such name resolves: the module exists and declares a function of that name.
- [ ] Any state change with more than one apparent writer appears as a single row plus a named finding in the map's gaps section, never as two rows.
- [ ] Every migration row's `characterisation_tests` cell cites an existing `test/*.test.mjs` path, or a module's inline `--selftest` fixture table with its line range, or the literal `gap` — and each citation covers that row's own durable fact, not just the module. Coverage of the module but not the fact is recorded as `gap` with a note.
- [ ] The disposition-scope table has three rows and the work-item row states that no implementation exists, quoting the four-state vocabulary from the master RFC.
- [ ] Tracker mutations appear as one row per mutation kind (status transition, comment, label, relation), each with `migration_rule: rebuildable-projection`, and the anchors tree as one row per anchor kind. The chosen grain is stated in the map's vocabulary section.
- [ ] The amendment row states a verdict backed by cited evidence, and names `corrective.js`, `contract-defs.js`, and `ratified-scope.js` as surfaces it considered. The verdict is not pre-supplied by this spec.
- [ ] Each of those three surfaces carries a quoted line with its file and line number, and a one-clause reading of what that line does or does not do about revision identity. A verdict citing only a file name is not evidenced: the check is that a reader can follow the quote to the source and disagree with the reading.

### From how (edge cases and failure modes)
- [ ] The ownership table is complete against the derivation rule regardless of its row count. If it exceeds roughly 60 rows it is emitted in area sections with a per-section count and a total, and the definition of "state-changing" is unchanged from the one stated under Vocabulary. Row count alone never parks the run.

### Integration smoke test

```
PROCEDURE citation_smoke_test:
  1. Read the commit recorded in the map document's header.
  2. Extract every repository-relative path cited in the map document and in
     the two pointer lines added to TECHNICAL-DESIGN-v5.md. A cited path is
     a repository-relative path in an inline code span or a table cell;
     prose mentions of directory names are not citations.
  3. FOR each path: reject it unless it matches a restrictive repo-relative
     shape (no leading `/`, no `..` segment, no shell metacharacter), then
     assert it exists at the commit, passing `<commit>:<path>` as a SINGLE
     argv element — never interpolated into a shell command string. The map
     is a standing document later phases re-read, so its paths are input,
     not trusted constants.
  4. Assert the classification table row count equals the REGION_MAP entry
     count read from regions.js at that commit.
  5. Assert the ownership, migration and assurance tables carry identical
     row_key sets.
  6. Extract every quoted RFC fragment together with the section the map
     attributes it to. FOR each: assert the fragment appears verbatim in
     the named file, and that the nearest preceding heading at that
     position is the one the citing document names.
  7. Resolve every cell that names a code mechanism against the codebase:
     a. canonical_writer — for each "module.js :: functionName", assert the
        module exists at the commit and declares or exports that function.
     b. journal_evidence and effect_evidence — assert every module path
        they name exists at the commit, and that the named mechanism
        (function, chain file, or credential path) is present in it. These
        cells feed the selection ticket's rubric, so a phantom mechanism
        does not merely sit in a table, it scores a candidate.
     A cell naming something that does not exist is the cheapest possible
     error to make and, without this step, the most expensive to find.
  8. RECOMPUTE the step-3 diff rather than reading its conclusion: take
     the two enumerated sets the gaps section records, difference them both
     ways, and assert the result matches the difference the document
     claims. Assert also that the section names its swept scope. Checking
     only that a diff section exists and says "empty" would pass a diff
     that was never computed, which is the one failure this mechanism
     exists to prevent.
```

Step 6 is the one that catches this deliverable's characteristic failure. A map whose paths all resolve can still attribute a quote to the wrong section, and every artifact that later cites the map inherits the error. This spec made exactly that mistake in an earlier draft: it attributed "Journal cutover begins only after the Phase 1 map and with the external producer in Phase 2A" to the master RFC's External Commissaire proof list, when the line is item 7 of "Decisions fixed by this direction". The check exists because the error is easy to make and invisible without it.

**Failure behaviour.** A failing step blocks the map. Record which step failed and on what input, fix the document, and re-run all eight — never ship with a recorded failure, and never narrow a step so it passes. This mirrors the step-3 diff's blocking semantics; a check whose failure has no consequence is decoration.

If all eight pass, the map is internally consistent and every claim it makes points at something that exists, where it says it exists. Step 7 is what stops a named mechanism from being decorative: it does not prove the named writer or evidence is the *right* one, only that it is a real one, which is the difference between a checkable claim and a plausible sentence. Step 8 is what stops the completeness diff from being a sentence rather than a computation.

What none of the eight prove is that the judgements are correct — that `semantic_owner` is the right bucket, that `journal_evidence` and `effect_evidence` really earn their classes. Those are what FAFF-827 and the selection ticket's human decision are for, and the map's job is to make them cheap to check rather than to settle them.

confidence: high
build-tier: complex
