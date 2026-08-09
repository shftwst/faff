# FAFF-515 — Tracker topology creation follows the PRDR lifecycle — supersede ADR-0071's container-confirm floor

> Spec: faffter-dark-nlspec · 2026-07-15 · interactive · confidence: high. Full spec on Linear FAFF-515.

This spec turns FAFF-515's decided rule into a buildable change: the `l4-topology-envelope` contract's `container-create` verdict stops being an unconditional `propose-only` and instead applies the PRDR lifecycle's two-gate rule (human Accepts the root, loop admits contained children) to the tracker medium. Audience: the build agent and human reviewers. It deliberately reopens ADR-0071's container-confirm floor via the reopening path ADR-0071 §Consequences itself documented.

## 1. WHY — Problem and Principles

**Load-bearing model.** A tracker container (initiative/project) and a git PRDR are the same abstraction in different media: a scoped node with a definition of done, and FAFF-245 pairs a project 1:1 with a PRDR. The PRDR lifecycle already has a two-gate rule: the human Accepts the root once; everything contained beneath an Accepted root is loop-admittable (`faff prdr admit --actor loop`). This change applies that same rule to the tracker medium's container-create op — one human Accept at the root PRD buys full-depth autonomous decomposition below it. Only the write path (`save_project` vs a `docs/prdr/` commit) and the reversal mechanic (archive/reparent vs revert-via-PR) are medium-specific; the governing rule is medium-independent.

**Problem statement.** ADR-0071 shipped `container-create` → unconditional `propose-only` at every level including `full` (`l4TopologyDecision`, `plugin/skills/faff/bin/lib/contract-defs.js:968-970`), while admitting `epic-create` under a confirmed parent — the same safety class (reversible, provenance-stamped, contained, non-PR-gated tracker write). That is unprincipled, and it is self-defeating for L4: an unattended plan pass that must wake a human to "confirm these 5 projects" is not lights-out, which is the capability FAFF-494 exists to deliver — and it double-charges the human, whose PRD admission was already the scoping gesture. This change makes the container-create verdict conditional: `admit` iff loop-authored and contained under the run's human-Accepted root PRD, at L4.

**Design principles.**

- **Reuse the PRDR rule, never its predicate.** The unification is at the rules level. `l4TopologyDecision` stays a pure function of its op literal (parity with `faff next` / `faff prdr admit` — no tracker/network read). It must not call `computePrdrAdmissionVerdict`, whose inputs (supersedes-provenance, lineage, thrash, YAGNI upper, coverage lower) are supersession concepts a create op does not have.
- **Fail-safe toward gated.** Absent, malformed, or false signal ⇒ the container stays confirm-gated. No code path may default the new signal toward `admit`.
- **The op shape stays target-axis-free.** FAFF-493's spec fixed "no target/outward axis; do not conflate" (its §2/§3). This change adds a caller-asserted composed signal, not a target axis — outward enforcement proper stays at the upstream `faff contain` chokepoints (gateway SKILL.md hard floor, FAFF-221).
- **Reopen the floor legibly.** ADR-0071's Chosen is superseded by a new decision record, never edited in place — the reasoning trail that "no future reader re-proposes it without reopening the floor deliberately" must survive as history.

**Reference context.**

| System | Where | Relevance |
|---|---|---|
| Envelope decision table + validator | `plugin/skills/faff/bin/lib/contract-defs.js:935-1029` | `l4TopologyDecision` (960-981) is the row being changed; `computeL4TopologyEnvelope` re-derives and diffs — never trusts a claimed verdict. |
| Envelope schema | `plugin/skills/faff/contracts/l4-topology-envelope.schema.json` | `additionalProperties:false` on `op` — the new field requires a schema edit. |
| Inline fixtures | `contract-defs.js:1514-1541` (`CONTRACTS["l4-topology-envelope"]`) | `container-create-admit-mismatch` (~1531) asserts the old rule and must change. |
| ADR-0071 | `records/adr/0071-l4-topology-write-authority-…md` | Status Proposed. Its Consequences invite this reopening as "a larger, separate decision". Carries the two-floor-proof methodology every `admit` row must satisfy. |
| PRDR admission gate | `contract-defs.js:884-933`, `bin/lib/prdr.js` (`admit`) | The rule being mirrored; also FAFF-495's gate over the container's paired PRDR — the no-double-gate boundary. |
| L4 run-start PRD gate | `bin/lib/lights-out.js:595-604,620-625,816` | The `--prd-creative-licence` flag→ledger seam the new accepted-root signal extends. |
| PRD statuses | `bin/lib/prd.js:19` | `["Draft","Active","Frozen","Stale"]` — no `Accepted`; the accept signal must come from somewhere else (§3). |
| Container-confirm floor prose | `faff-plot/SKILL.md:67,137,200`, `faff-jot/SKILL.md:159,171`, gateway `SKILL.md:485,726` | The unconditional "containers always confirm" statements that gain the L4-envelope carve-out. |
| Golden contract cases | `test/golden/contracts/cases.json` | Zero `l4-topology-envelope` cases today (every other Pattern-B contract has them) — gap closed here. |

**Scope statement.** This sits between FAFF-493 (the shipped envelope this amends) and FAFF-494/495 (the unbuilt consumers); it blocks FAFF-494.

## 2. OUT OF SCOPE

- **Outward / new-root enforcement.** A new root PRD still needs a human Accept; outward ops are still caught by the upstream `faff contain` chokepoints (FAFF-221/222, gateway hard floor). This change folds outwardness into the *semantics* of the caller-asserted signal (§3) but adds no enforcement — extension point: FAFF-496's refusal taxonomy.
- **Restructuring existing containers** (even loop-authored) — still FAFF-216's axis (needs the actor/history API Linear lacks). This unlocks create-all-the-way-down, not re-decompose-existing. Extension point: FAFF-216, if ever unblocked.
- **Cancel/delete** — still `reject` at every level (reversibility floor). Untouched.
- **Human-curated containers** — never restructured; the human-curated floor row stays ordered before the container-create row. Untouched.
- **Epics** — carry specs, not PRDRs; they stay governed by spec-readiness and the existing `epic-create` row. Do not fold epics into the PRDR rule.
- **Building FAFF-494/495.** They consume this verdict; the loop-side container-create harness (stamping `initiated: autonomous` markers on created containers, computing the asserted signal, authoring the paired PRDR) is theirs. Extension points: FAFF-494's plot re-entry harness, FAFF-495's `prdr-author` wiring.
- **Accepting ADR-0071 itself.** Its Proposed→Accepted lifecycle is FAFF-493's business; this change amends it in part regardless.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Accepted root PRD | The PRD the L4 run was admitted against: the run-start `prd-readiness` gate returned `admissible` for it, recorded in the run ledger at mint. Not a PRD `Status:` value. |
| Accepted-root envelope | The subtree of the tracker container that Accepted root PRD is linked to. |
| Composed containment signal | Caller-asserted boolean: this op's target parent chain is contained (`faff contain` ⇒ `contained`) within the accepted-root envelope of *this run's* ledger-recorded root PRD. |

**The op shape gains one field** (schema edit required — `additionalProperties:false`):

```
RECORD op:
  kind:        container-create | epic-create | reparent | convert | rehome | cancel | delete
  level:       L1..L4
  provenance:  faff-authored | human-curated
  parent_confirmed: bool                    # unchanged; read by epic-create only
  contained_under_accepted_prd: bool        # NEW; read by container-create only.
      # Caller-asserted (same trust posture as parent_confirmed): true iff
      # (a) the run's ledger records an admissible root PRD (mint-time record, §4), AND
      # (b) faff contain says the op's target parent chain is contained in that root's subtree.
      # Required on EVERY op kind; non-boolean/absent ⇒ fail-loud (exit 2).
```

**The changed decision row** (all other rows and their ordering unchanged — floors outermost-in):

| `op` | `disposition` | `reversible` |
|---|---|---|
| `container-create`, `L4`, `faff-authored`, `contained_under_accepted_prd: true` | `admit` | `true` |
| `container-create` — not L4, or signal false | `propose-only` | `true` |

The `admit` reason cites the new ADR and the rule ("prdr-lifecycle: loop-authored container contained under the run's admitted root PRD — the human Accept sits at the root, once"). The fall-through reason names what failed ("outside the accepted-root envelope — container-confirm holds").

**Design decisions** (rationale in §6, markers here are canonical):

- **What "human-Accepted root PRD" is, given no such datum exists.** **Chosen:** the run-scoped referent — the L4 run-start `prd-readiness` gate's `admissible` verdict over the run's root PRD, newly persisted into the run ledger at mint. No new `Accepted` PRD status is added to `PRD_STATUSES`.
- **How the signal reaches the pure function.** **Chosen:** a new caller-asserted required op field, `contained_under_accepted_prd` — matching how `parent_confirmed` works today: detective, not preventive (FAFF-354 stance), preserving `l4TopologyDecision`'s pure-function invariant. Never a live PRD/ledger read inside the decision function.
- **Where outwardness lives.** **Chosen:** folded into the asserted field's semantics (the caller computes containment via `faff contain` against the ledger-recorded root), not a new target axis on the op. An outward or new-root container-create asserts `false` and stays `propose-only`; enforcement proper remains the upstream chokepoints.
- **Does container-create call the PRDR admit predicate or mirror its rule?** (ticket open question 1) **Chosen:** mirror the rule in `l4TopologyDecision`'s own table; never call `computePrdrAdmissionVerdict`. The shared `admit|propose-only|reject` vocabulary is already the composition seam.
- **Interaction with FAFF-495's `--actor loop` admit path.** (ticket open question 3) **Chosen:** no double-gate, because the two gates govern different artifacts in sequence — the envelope gates the *tracker write* (may this container exist?); `faff prdr admit --actor loop` gates the *paired PRDR's content* (is this DoD warranted — trace-to-goal, YAGNI, coverage?). A container whose paired PRDR is subsequently rejected is reversed (archive/reparent) by the consumer, which is exactly why the admit row's `reversible: true` is load-bearing.
- **Level scope of the new admit.** **Chosen:** L4 only (parity with the `epic-create` row and the ADR-0037 `full`-at-L4 pin). At L1–L3 the human is present; interactive plot/jot container confirms are unchanged behaviour.
- **Field mechanics.** **Chosen:** required on every op kind, fail-loud when absent or non-boolean (the `parent_confirmed` precedent). The breaking schema change is safe: FAFF-494/495 are unbuilt — a repo-wide search finds no producer of this block outside the contract's own fixtures.
- **ADR supersession mechanics, given ADR-0071 is still Proposed.** (ticket "how" item 1) **Chosen:** a new ADR (next free number, 0072) that supersedes ADR-0071 *in part* — only the container-create row and its container-confirm-floor citation — with ADR-0071 gaining an `**Amended:**` header line pointing forward (ADR-0004 precedent — the only existing `**Amended:**` header in the log; no supersede-in-part exists yet, so ADR-0072 is the first and names itself as such). ADR-0071's Status and every other row stay untouched; no in-place rewrite of its Chosen.
- **PRD human-provenance.** **Assumes:** the root PRD is human-authored/ratified by construction — no autonomous path authors PRDs (verified: `faff prd new` has no loop caller; ADR-0069 pins the PRD as an adopter/human artifact and forbids a faff self-PRD). Validation: grep skills for autonomous `faff prd new`/`prd link` calls; none may exist.

**Epic composition note (documentation, no code change).** For full-depth decomposition to compose, `parent_confirmed` on an `epic-create` op is *defined* as satisfied when the parent was human-confirmed **or** envelope-admitted under the accepted root. The epic row's code is untouched; the new ADR and gateway prose record this widened caller-side definition — without it, epics under loop-admitted containers would silently re-require a human confirm and defeat the unification.

## 4. HOW — Behaviour

**The decision function change** (floors stay outermost-in; only the container-create branch changes):

```
FUNCTION l4TopologyDecision(op):
  1. cancel | delete                      -> reject   (reversibility floor — unchanged)
  2. provenance == human-curated          -> propose-only (human-curated floor — unchanged, and
                                             pre-empts container-create: human restructure never admits)
  3. container-create:
       IF level == L4 AND contained_under_accepted_prd == true
         -> admit  (reason cites ADR-0072 prdr-lifecycle rule; reversible: true)
       ELSE
         -> propose-only (container-confirm holds outside the accepted-root envelope; reversible: true)
  4. epic-create                          -> unchanged (L4 ∧ parent_confirmed ⇒ admit, else propose-only)
  5. reparent | convert | rehome          -> admit (unchanged)
  6. unrecognised kind                    -> reject (unchanged)
```

**Validator + schema.** `computeL4TopologyEnvelope` adds the `typeof op.contained_under_accepted_prd === "boolean"` fail-loud check beside the `parent_confirmed` one and copies the field into the echoed `op`. The schema adds the field to `op.properties` and `op.required`. The re-derive-and-diff conformance mechanic is untouched.

**The accepted-root signal's durable referent** (the seam the caller asserts from). Extend the existing `--prd-creative-licence` flag→ledger pattern (`lights-out.js:595-604,816`): the run-start PRD gate additionally hands the mint the admitted PRD's container identity (e.g. `--prd-root-container <container>`), and the mint persists it beside `prd_creative_licence` (e.g. ledger field `prd_root_container`). Fail-loud resolver, same shape as `prdCreativeLicenceFromFlag`: the container flag without the licence flag (gate didn't run) is a mint refusal, never a silent null. The FAFF-494 caller then computes the asserted field as: ledger has a recorded root PRD ∧ `faff contain` returns `contained` for the op's target parent chain against that root's subtree. A run minted without the PRD gate (including faff-on-itself, which has no PRD by ADR-0069 policy) has a null record ⇒ the signal is false ⇒ container-create stays gated — the no-op-for-faff property composes for free.

**The new ADR (0072).** Records the container↔PRDR unification (the ticket's table), supersedes-in-part ADR-0071's container-create row, and must discharge ADR-0071's own methodology for the new admit row:

- **Two-floor conformance citation** — reversibility floor: container-create is pure scope-addition ("`full` adds scope … but never removes it", gateway SKILL.md:731) and reversible via archive/reparent (tracker-native, no data loss); human-curated floor: a loop-authored container under the accepted root never touches human-curated structure — the root PRD Accept *is* the propose-and-confirm gate applied at the root, once (the same shape as the epic row's "parent-confirm is the gate applied one level up").
- **216-independence** — a fresh create, never a re-link/re-prioritise of existing machine-authored structure; the trace extends, it does not reopen.
- **Counter to FAFF-493 spec §6's rejection reasoning** (required by the ticket): "containers are expensive to undo" is answered by the reversal mechanic plus provenance stamping plus containment (the expense was per-container *human attention*, now correctly charged once at the root); "raises the chance of needing 216" is answered by the boundary kept: creation is admitted, restructuring existing containers is still 216's axis and still gated.
- **Gate-routing composition clause** — ADR-0071's Decision routes plan-time topology writes through `faff prdr admit --actor loop` ("never a parallel admission path"), a clause that never contemplated an admitted container-create class. ADR-0072 states explicitly how the new class composes *with* (not through) that gate: the envelope admits the *tracker write*; the paired PRDR is then authored (`--provenance loop`, born Proposed) and content-gated by `faff prdr admit`; a rejected PRDR reverses the container. Sequential composition of two single-purpose gates — not a parallel admission path.
- **Soft-precondition inheritance** — restate ADR-0071's "outward-only stays a soft precondition" consequence against the *widened* admit, naming FAFF-496 as the mechanising ticket (run-start predicate + refusal taxonomy), so the revalidation trigger ADR-0071 asked for survives the supersession instead of silently lapsing with the superseded row.

**ADR-0071 edit** — header gains one line: `**Amended:** <date> — container-create row superseded in part by ADR-0072 (FAFF-515); all other rows, the epic-create scope, and the two-floor methodology unchanged.` Nothing else in 0071 changes. Note: do not propagate ADR-0071's stale forward-reference of "ADR-0069" as the future outward-only ADR — number 0069 is now the (Accepted) no-self-PRD ADR; ADR-0072 cites outward-only from PRDR-0001/0002 prose or FAFF-496, never as "ADR-0069".

**Prose floor edits** (each gains the same one-clause carve-out citing ADR-0072, e.g. "…except within the L4 accepted-root envelope (ADR-0072): a loop-authored container contained under the run's admitted root PRD is admitted"):

- `faff-plot/SKILL.md:67` and `:200` ("Containers always confirm…"); `:137` composes with :67 and inherits the carve-out by reference — verify it reads correctly, edit only if it restates the unconditional form.
- `faff-jot/SKILL.md:159` and `:171`.
- Gateway `SKILL.md:485` (parenthetical "containers always confirm") and `:726` (L4 composition anchor — extend to name the conditional container-create scope).
- `contract-defs.js:935-944` comment block and the `:969` reason string (both currently state "confirm-gated at every level").

**Fixtures** (inline, `CONTRACTS["l4-topology-envelope"]`):

- Every existing op gains `contained_under_accepted_prd` (existing rows: `false`, preserving their expected verdicts — except as below).
- `container-create-admit-mismatch` becomes the new-rule cases: (a) conformant admit — `{container-create, L4, faff-authored, contained_under_accepted_prd: true}` claiming `admit` ⇒ exit 0; (b) mismatch — same op with signal `false` claiming `admit` ⇒ exit 1 (the load-bearing "validator re-derives" check survives, one row over).
- New conformant rows: signal true but level L3 ⇒ `propose-only`; human-curated container-create with signal true ⇒ `propose-only` (floor ordering proof).
- New fail-loud row: op missing `contained_under_accepted_prd` ⇒ exit 2.
- **Golden cases**: add `l4-topology-envelope` rows to `test/golden/contracts/cases.json` (at minimum the admit, the gated, and one fail-loud) — closing the gap where this is the only Pattern-B contract with zero golden coverage.

**Failure modes.**

- **A fabricated assertion admits an uncontained container.** The signal is agent-asserted, so the check binds structure, not truthfulness. How you'd know: `faff audit`-style recompute against the ledger's `prd_root_container` + a fresh `faff contain` run diverges from the asserted value. What it means: accepted — the same detective posture as `parent_confirmed` and `faff contain --record` (FAFF-354); the ledger referent exists precisely to make fabrication durable evidence, and preventive enforcement is not this contract's job.
- **Container sprawl under one Accept.** One root Accept admits unbounded depth. How you'd know: per-run container-create counts in the run ledger/audit trail. What it means: the paired-PRDR gate (FAFF-495: trace-to-goal, YAGNI challenge) is the content brake — a container whose PRDR is rejected gets reversed; if sprawl still shows up in calibration, narrow with a per-run count ceiling as a follow-up, not here.
- **The "not-ready never mints" assumption drifts.** If a future mint path skips the PRD gate, the ledger record is null ⇒ signal false ⇒ gated. Fail-safe direction is preserved by construction; nothing to add.

**Anti-patterns.**

- **Anti-pattern:** calling `computePrdrAdmissionVerdict` from `l4TopologyDecision`. Why: category mismatch — a create op has no supersession inputs; you'd fabricate neutral values and couple two pure functions for no shared computation.
- **Anti-pattern:** adding a target/outward axis to the op. Why: contradicts FAFF-493's do-not-conflate Chosen and duplicates FAFF-221/496 upstream enforcement.
- **Anti-pattern:** requiring `parent_confirmed` for the container-create admit. Why: re-introduces the per-container human confirm the root Accept replaces — defeats lights-out.
- **Anti-pattern:** editing ADR-0071's Chosen or decision table in place. Why: erases the recorded reasoning the reopening must remain legible against.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run whose ledger records an admissible root PRD
When op {kind: container-create, level: L4, provenance: faff-authored, contained_under_accepted_prd: true}
Then verdict {disposition: admit, reversible: true}, reason citing ADR-0072's prdr-lifecycle rule
```

```
Given no admitted root PRD (or an outward target parent chain) so the asserted signal is false
When op {kind: container-create, level: L4, provenance: faff-authored, contained_under_accepted_prd: false}
Then verdict {disposition: propose-only} — the container-confirm floor holds outside the accepted-root envelope
```

```
Given a producer claiming admit for a container-create whose asserted signal is false
When the block is piped to `faff contract l4-topology-envelope`
Then the validator re-derives propose-only and exits 1 (non-conformant)
```

- An op missing `contained_under_accepted_prd` MUST fail loud (exit 2), never default toward any disposition.
- A run minted without the PRD gate MUST leave the ledger's root-PRD record null (fail-safe: signal false downstream).

## 6. DESIGN DECISION RATIONALE

**What is the "human-Accepted root PRD" datum?** Options: (a) add `Accepted` to `PRD_STATUSES` and require a human status flip; (b) the run-scoped referent — run-start `prd-readiness` `admissible` verdict persisted to the ledger. (a) invents a second accept gesture (the double-charge the ticket removes), duplicates what `Active` already connotes, and creates a status with no lifecycle owner. (b) matches the ticket's own framing ("the PRD admission was already the scoping gesture"), reuses the existing gate and flag→ledger seam, and is run-scoped — which is correct, because the authority being granted is per-run. **Chosen:** (b). Binding the signal to *this run's* ledger record also closes the mid-run hole: a loop cannot mint a new PRD and claim containers under it — that PRD is not the ledger's root, and a new root is the outward floor's business anyway.

**Pure function + asserted field vs live read.** A live PRD/ledger read inside `l4TopologyDecision` breaks the pure-function CLI invariant every sibling gate holds (`faff next`, `faff prdr admit`) and makes the contract untestable by fixture. The asserted field matches `parent_confirmed` exactly — same trust posture, same detective control story, same fixture mechanics. **Chosen:** asserted field.

**Mirror vs call the PRDR predicate** (DRY vs coupling). The only thing genuinely shared is the disposition vocabulary, already reused verbatim (`PRDR_DISPOSITIONS`). The rule ("human gate at the root, loop admits contained children") is four lines in the table; importing the predicate would import six inputs that are meaningless for a create. DRY at the rules level lives in ADR-0072's unification table, not in code sharing. **Chosen:** mirror.

**No double-gate with FAFF-495.** The alternative — routing container-create *through* `faff prdr admit` — would conflate the write authorisation with the DoD-content admission and force a PRDR to exist before its container does. Sequencing them (envelope admits the write; the paired PRDR is then authored `--provenance loop`, born Proposed, and gated on its content) keeps each gate single-purpose and makes FAFF-495 the container-create authority the ticket names. **Chosen:** sequential composition, two artifacts.

**ADR mechanics.** Editing Proposed ADR-0071 in place is tempting (it isn't Accepted yet) but destroys the deliberate-reopening trail its Consequences created; a full supersession (`faff adr supersede`) would wrongly retire the epic-create decision too. Supersede-in-part via a new ADR + an `**Amended:**` back-pointer follows the ADR-0004 `**Amended:**` precedent (the log's only existing amend header; no supersede-in-part exists in the log yet — ADR-0072 is the first and says so). **Chosen:** new ADR-0072, supersede-in-part.

*Temporal anchor:* at spec time the ADR log ends at 0071, FAFF-494/495 are unbuilt (no producer of this contract block exists outside fixtures), and `docs/prdr/` is not on main — ADR-0072 cites PRDR prose the way ADR-0071 does, without assuming the files are readable.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — all three ticket open questions are closed as Chosen (§3/§6).

**Assumptions:**

- **Assumes:** no autonomous path authors PRDs — the root PRD is human-provenance by construction (ADR-0069 Accepted; `faff prd new` has no loop caller). Validation before build: grep the skills tree for autonomous `faff prd new` / `prd link` invocations; finding one is a blocker to raise, not work around.
- **Assumes:** the run-refusal invariant "prd-readiness `not-ready` ⇒ no L4 mint" continues to hold (it is what makes the ledger record a trustworthy accept referent). Validation: confirm the beep-boop/lights-out run-start prose still branches refuse-on-not-ready before mint.

## 8. DONE — Definition of Done

### From WHAT (contract change)
- [ ] `l4TopologyDecision`'s container-create branch returns `admit`/`reversible:true` iff `level=="L4" && contained_under_accepted_prd===true`, else `propose-only`; all other rows byte-for-byte-equivalent behaviour.
- [ ] Op field `contained_under_accepted_prd` added: schema (`op.properties` + `op.required`, `additionalProperties:false` intact) and validator fail-loud check; absent/non-boolean ⇒ exit 2.
- [ ] `faff contract l4-topology-envelope --selftest` passes with: conformant admit fixture (signal true, L4); mismatch fixture (signal false, claimed admit ⇒ exit 1); L3-with-signal ⇒ propose-only; human-curated-with-signal ⇒ propose-only; missing-field ⇒ exit 2; all pre-existing rows updated with the field and still passing.
- [ ] `l4-topology-envelope` golden cases exist in `test/golden/contracts/cases.json` (≥ admit, gated, fail-loud) and `test/contract-golden.test.mjs` passes.

### From HOW (signal referent)
- [ ] Lights-out mint accepts the root-PRD-container flag, persists it beside `prd_creative_licence` in the ledger; flag-without-licence is a fail-loud mint refusal; no flag ⇒ null record (selftest or unit coverage for all three).

### From HOW (records and prose)
- [ ] ADR-0072 exists: unification table, supersedes-in-part declaration (the log's first — cites the ADR-0004 `**Amended:**` precedent), two-floor conformance citation for the new admit row, 216-independence note, counter to FAFF-493 §6's rejection reasoning, the gate-routing composition clause (container-create composes *with*, not through, `faff prdr admit`), the inherited outward-only soft-precondition flag naming FAFF-496, the widened `parent_confirmed` definition for epics under loop-admitted containers, and no "ADR-0069 = outward-only" reference.
- [ ] ADR-0071 header carries the `**Amended:**` line; its body is otherwise unchanged.
- [ ] Floor prose carve-outs applied at `faff-plot/SKILL.md:67,200` (and `:137` if it restates the unconditional form), `faff-jot/SKILL.md:159,171`, gateway `SKILL.md:485,726`, and the `contract-defs.js:935-944` comment + `:969` reason string; `faff validate-adapters` passes.

### From boundaries
- [ ] Cancel/delete, human-curated, outward/new-root, and restructure-existing behaviours demonstrably unchanged (covered by the retained fixtures above — no new mechanism for any of them).

**Integration smoke test:**
```
1. echo the block {op:{container-create, L4, faff-authored, parent_confirmed:false,
   contained_under_accepted_prd:true}, verdict:{admit, reversible:true}}
   | faff contract l4-topology-envelope           -> exit 0
2. same op with contained_under_accepted_prd:false, verdict admit  -> exit 1
3. same op with the field absent                                   -> exit 2
4. faff contract l4-topology-envelope --selftest                   -> all fixtures pass
```

confidence: high
spec-review: approve
