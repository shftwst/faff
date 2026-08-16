# Critique of the v3 direction

**Status:** recorded review
**Date:** 2026-08-12
**Model:** Claude Fable 5
**Scope:** [critique-2](critique-2.md) and [master v3](v3/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v3.md), cross-checked against the current repository and the earlier documents in this directory
**Repository code reviewed at:** `79563ac`

## Bottom line

v3 is a better plan than v2 and most of it should stand. The central correction in critique-2 is accepted: the repository contains a tested deterministic decision kernel, so this is an extraction programme before it is a construction programme, and the external Commissaire proof plus the one-shot comparison belong before any generic runtime work.

v4 keeps v3's phase structure, gates, and architecture, and corrects six defects found in v3:

1. the neutral journal claims write-time append authority that nothing in the no-daemon deployment can enforce; the enforcement class must be named per deployment tier, exactly as v3 already names it for effects;
2. v3 never states the migration boundary between the new journal and the existing hash-chained per-run ledgers, which is the duplicate-state risk its own risk table warns about;
3. the normative lifecycle has no cancelled or abandoned terminal state, so an operator-cancelled run has no disposition;
4. Gate 1 buys two different things with one body of evidence: none of its qualifying advantages tests whether prompt-interpreted orchestration actually fails, which is the specific claim Phase 3 exists to fix, and the repository can measure that claim directly today;
5. Phase 2A's independence language exceeds what one maintainer acting as producer, operator, and rule author can evidence; the claim must be scoped to protocol sufficiency and mechanical detection;
6. useful v2 assets (the implementation invariants, the concept-level traceability matrix, part of the seeded-failure catalogue) and two repository facts (the live ADR log at `records/adr`, the new decisions register) are unaccounted for.

The revised direction is recorded in [master v4](v4/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v4.md).

## What was reviewed

- [Critique-2 and its cross-check of the previous review](critique-2.md)
- [Safe progressive autonomy master v3](v3/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v3.md)
- [Previous review](critique-1.md)
- The v2 pack ([plot input](v2/FAFF-PLOT-INPUT-v2.md), [roadmap](v2/FAFF-PROGRESSIVE-AUTONOMY-ROADMAP-v2.yaml), [master](v2/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v2.md), [distributed-run note](v2/faff-distributed-evidence-recoverable-runs.md))
- Current governance and factory code, watchers, experiment records, ADR log, and decisions register

As in critique-2, a design claim was not counted as current capability unless the repository or an experiment record supports it.

## Repository checks

Rerun at `79563ac`, 18 commits after the state critique-2 reviewed (`6fed6a810e6a`):

| Check | Result |
|---|---|
| `faff regions check` | Pass. Governance-to-factory and shared-infrastructure direction rules hold. |
| `faff next --selftest` | Pass. 23 transition cases plus the eligibility table. |
| `faff run-done --selftest` | Pass. Terminal-floor, policy-rung, and default-behaviour cases. |
| `faff queue-state --selftest` | Pass, including the network-purity case. |

Every file critique-2 cites exists at the stated path. The [L4 experiment design](../../../verification/external-verification/faff-labs/experiments/l4-experiment-design.md) confirms the nine-for-nine one-shot control claim and is stronger than critique-2 presented it: it already defines matched treatment arms, explicit north-star outcomes, and a reportable null. The [FAFF-654 results](../../../records/spikes/2026-07-26-FAFF-654/RESULTS.md) confirm the hosted-runner environment was destroyed after the spike.

Two facts the RFC series has not yet absorbed:

- the repository's real ADR log at [`records/adr`](../../../records/adr) is at number 0105, so the v2 pack's proposed ADR-0001 through ADR-0013 numbering collides with it and must not be used;
- a decisions register (`faff decisions`, FAFF-448, an ADR-lite ledger) merged since the last review and is the natural home for the "decisions taken now" that currently live only inside the v3 RFC.

## Response to critique-2

### Accepted

- **Extraction before construction.** Confirmed against the code: `next.js`, `run-done.js`, `queue-state.js`, `regions.js`, and the adjacent budget, liveness, resume, gate, and ledger modules are real, tested, and deterministic. Critique-1's "treat P4 as greenfield" was too broad. One boundary should be drawn more precisely: the decision kernel exists; the cycle around it does not. No module today loads state, selects work, invokes a worker, records results, and loops; the `faff-beep-boop` skill has the harness LLM do that. v3's own Phase 3 concedes this by building the cycle new. So: extraction for decisions, new code for the loop. This changes emphasis, not the work items.
- **L3 must not freeze.** Correct, and doubly so given the operating model: the L3 runner is also the build capacity executing this programme.
- **The one-shot baseline moved earlier.** Correct, and the existing faff-lab design is a better instrument than either earlier document assumed.
- **The neutral journal direction.** The right answer to the dual-state problem critique-1 flagged, subject to the corrections below.
- **Effect classes A through D and the independence vector.** Accepted outright; they make the honesty demands of both earlier reviews mechanical.
- **Naming tied to the product-shape gate** rather than a calendar. Correct.

### Corrected for the record

Two rows of critique-2's cross-check table reject positions the previous review did not hold:

- "Define the complete architecture and contracts before implementation" was v2's structure, not critique-1's recommendation. Critique-1 argued the same rejection: thin P2, decide ADRs individually as needed, replace speculative schema authoring with a paper exercise.
- "Add distributed evidence and recovery later" was also not held. Critique-1 placed the minimal slice (continuous off-box journal, interrupted-state detection, the no-partial-admission invariant) in L4 hardening, which is where v3's Phase 0 puts it.

The resulting v3 positions are right either way; this note only keeps the lineage of positions accurate.

## Defects in v3

### 1. The journal's append authority is a class-D claim in class-B language

v3 states: "Storage enforcement protects these type scopes." With no daemon and a journal on files or an object store, every producer holds the write credential. Type-scoped append authority at write time requires either an authenticating writer service in front of the store (class B, by v3's own effect taxonomy) or store-side policy outside every producer's trust domain (class A). The no-daemon stance rules out the first for now, and the second is unevidenced for the stores Phase 0 will actually use.

What the first implementation can honestly provide is verification-time checking: producer identity and event-type scope validated when projecting, sealing, or issuing a verdict, with forged or mis-scoped records detected and quarantined rather than prevented. That is class C. v3's very next sentence points the right way ("a payload claiming to be a Commissaire verdict has no authority when appended under a worker or bridge principal"), but the section's headline claim is prevention. By v3's own principle that assurance must be named, the journal must carry the same class vocabulary as effects, per deployment tier. v4 adds that table and a matching risk row.

### 2. No migration boundary from the existing ledgers

The repository already has hash-chained per-run history: `events.jsonl`, chain heads, run ledgers, declared-effect records. v3's mapping table maps v2 roadmap projects, not current artifacts. It never says which current files become journal content, which become projections, or at what point the old chain stops being canonical for a given run. Without that boundary, Phase 0 builds a second history beside the first, which is precisely the "duplicate control semantics" risk v3's own table carries. v4 requires the boundary to be stated per artifact before any journal write path lands.

### 3. Missing terminal dispositions

v3's normative lifecycle has exactly two terminal states, Rejected and AcceptedUnderContract. An operator-cancelled run, or an interrupted run nobody chooses to recover, has no path out of the diagram. v2's invariant 26 (every admitted run has an explicit disposition) and the distributed-run note's Abandoned state both cover this; v3 dropped it. v4 restores Cancelled (authorised cancellation from any non-terminal state) and Abandoned (reconciliation closes an interrupted run without recovery), with evidence retained in both.

### 4. Gate 1 buys the coordinator with governance evidence

Gate 1's qualifying advantages are an independent catch, safe recovery, lower operator burden, an audit or authority property, and reliable correction-resume. Every one is Commissaire or durability value, all obtainable from Phase 0 and Phase 2A machinery. None tests the claim Phase 3 is actually built on: that LLM-interpreted control flow misroutes, drifts, or costs more than explicit code.

That claim is directly measurable today, cheaply. For recorded L3 runs, replay the ledger inputs through the deterministic kernel and count divergences between the action the harness took and the action the kernel prescribes, then classify each divergence's consequence. Where current ledgers do not record enough to replay a decision, that gap is itself a finding, and recording it is Phase 0 work. v4 adds this coordination-fidelity measurement to Phase 1 and splits Gate 1 into two separately answerable questions: does governance earn its cost, and does deterministic coordination earn its cost. The outcomes are independent: governance-yes with coordination-no continues the Commissaire path through the external bridge without building Phase 3's cycle; coordination-yes stands on its own as product hardening even if the horizontal ambition dies.

### 5. Phase 2A claims more independence than one person can produce

Both candidate external producers (a manually executed one-shot task, the internal eval-baseline workflow) are operated by the maintainer, who also wrote the detector and seeds the violations. The proof is still worth running, but what it can establish is protocol sufficiency (the facade works without importing the orchestration stack), mechanical detection of the seeded classes, and replay-stable verdicts. "Commissaire detects violations independent of the executor" overstates it. v4 scopes the exit evidence accordingly and leaves independence to the recorded assurance vector.

### 6. Unaccounted assets and repository facts

- **The 35 implementation invariants** (v2 file 20) are the most directly reusable artifact in the pack, written to become CI checks. v3 gives them no home. v4 assigns them: the subset relevant to the selected slice becomes the Phase 1 characterisation and architecture-test backlog.
- **The traceability matrix** (v2 file 17) maps current concepts to destinations with proofs; critique-1 called it the pack's best artifact. v3's mapping covers projects only. v4 keeps a slice-scoped concept traceability obligation.
- **The seeded-failure catalogue** (v2 F1 through F9) shrank to six reference scenarios with no stated mapping. Self-certification (F2), budget exceeded (F5), mid-run amendment (F7), and the terminal-disposition gap (F9) have no explicit successor; the killed-executor fixture covers F9 only partially. v4 states the mapping and restores the dropped scenarios where they are cheap.
- **ADR numbering and home.** New ADRs take the next free numbers in `records/adr`; the RFC-internal 0001 through 0013 series is dead. Each of v3's "decisions taken now" lands in the decisions register or as a numbered ADR at the moment the first slice needs it, so the RFC does not become a shadow decision log.
- **The adoption-layer hypothesis** (v2 file 27) is reduced in v3 to migration compatibility. In the mixed and software-focused outcomes, the harness-native adoption surface is a product asset in its own right, not a shim to be retired. One paragraph restores the claim without committing packaging.

### 7. Smaller items

- **Broken links.** Critique-2 and v3 reference `v1/faff-distributed-evidence-recoverable-runs.md`; the file lives at `v2/faff-distributed-evidence-recoverable-runs.md`. v4 fixes the references.
- **Lineage compare-and-swap has no named object.** Conditional append is per stream, but two concurrent grafts from the same head contend on a lineage head, not on each other's run streams. The note's `expected_head` check needs a named home; v4 names the lineage-head record.
- **Retention.** Heartbeats and terminal verdicts share one ordered stream. Without retention classes, projection rebuilds walk heartbeat spam forever; with naive compaction, seals break. v4 adds retention classes and requires the evidence seal to remain verifiable after operational-segment compaction.
- **Phase 0 is two programmes in one.** Runner durability and the outward L4 evidence pack have different shapes and different consumers. v4 splits them into Phase 0A and 0B, lets 0B overlap Phase 2A, and marks the Phase 0A off-box format provisional until the second producer appears in 2A.
- **Design-partner lead time is unbudgeted.** Finding a distant partner with a real workflow takes calendar time engineering cannot compress. v4 starts the search during Phase 3 while keeping integration where v3 put it.
- **Operator burden is self-measured.** Derive the minutes from journal and tracker timestamps rather than self-report wherever possible.

## What v3 resolved well

For the record, four things critique-1 asked for that v3 delivered and v4 keeps unchanged in substance:

- the runtime-locus answer: an ephemeral bounded cycle with measured triggers for ever introducing a durable service;
- the vocabulary reconciliation between the distributed-run note and the master (checkpoint split into workspace snapshot and governance gate; admission bound to contract revision);
- retained-value labels on every phase for the horizontal, mixed, and software-focused outcomes;
- `accepted_under_contract` with a structured assurance summary instead of an unqualified acceptance claim.

## Verdict

The direction stands. Proceed on v3's skeleton with the corrections above, which are recorded normatively in [master v4](v4/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v4.md): name the journal's real enforcement class per tier, state the ledger migration boundary before writing the first journal record, restore the missing terminal states, split Gate 1 so the coordinator is bought with coordination evidence, scope Phase 2A's claim to what a solo operation can prove, and give the surviving v2 assets and the repository's real decision infrastructure their homes.
