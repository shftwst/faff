# Review: SuperDomestique Runtime Pack v2

**Date:** 2026-08-11
**Model** Claude Fable 5
**Scope:** `FAFF-PLOT-INPUT-v2.md`, `FAFF-PROGRESSIVE-AUTONOMY-ROADMAP-v2.yaml`, `FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v2.md`, `faff-distributed-evidence-recoverable-runs.md`
**Status:** review input for planning. Read before ingesting the pack with `/faff-plot`.

## Verdict

The direction is sound. The two headline decisions, bank L4 before extracting anything and require competitive falsification before productising, are correct. The evidence-status labels (OBSERVED-CURRENT / RETAINED-AUDIT / PROPOSED) are good discipline, especially since the pack was authored without cloning current `main`.

The plan's structure undermines the plan's philosophy in three ways:

1. it sequences the differentiating proofs last and the speculative schema work early;
2. it treats SuperDomestique as an extraction when it is really a new build;
3. its mass and strict serialization don't fit a solo builder, because the middle of the roadmap banks no value if interrupted.

## Keep these

- L4 as a hard gate (ADR-0009), explicitly reversing v1's inventory-first ordering.
- The non-goals list and "own semantics; adapt infrastructure" (ADR-0012), which prevents OpenFGA/OPA/Temporal formats becoming the accidental public API.
- The traceability matrix (file 17): every current concept has a destination and a proof. Best artifact in the pack.
- Characterization tests before moving code; the invariants doc written to become CI checks; "no domain nouns in core" as an enforceable test.
- ADR-0005 (trackers are projections); matches lived experience in this repo.
- Preserving FAFF as the low-friction adoption layer instead of renaming it away.

## Structural critiques

### 1. A waterfall hiding behind a gate

P0 through P11 is a strict linear chain: all thirteen ADRs decided in one issue (PA2-020), then the Delegation Contract, StageAttempt model, Lane Manifest, and worker/provider contracts all authored as schemas-with-tests (P2), before any generic slice runs (P4), and long before the second domain applies pressure (P6). The pack's own words argue against this: "extract by vertical slice rather than by noun search," "the primitive vocabulary must remain provisional until two domains use it," "use two packs to define rather than inventing a broad SDK first." The likely outcome is that P2's contracts are substantially rewritten at P6. Conformance suites for interfaces with exactly one implementation are ceremony; sequence each suite with the second implementation of its interface.

### 2. The most differentiated claim is tested eighth, but it only needs the facade

The pack calls execution-independent governance the strongest claim, yet P8 sits behind P4 through P7. That dependency is artificial: governing an externally-executed workflow needs the Commissaire facade (P3) and a bridge spec (PA2-080), not the runtime slice, the software pack extraction, or the adapter proof. After P3, spend two weeks governing one workflow SuperDomestique didn't orchestrate (an n8n flow, an Anthropic Managed Agents session, even a human-executed process with manually submitted evidence). If that works, the horizontal story is alive regardless of how much runtime gets built. If it fails, most of P4 through P7 was moot for the horizontal case anyway.

Same logic for the baseline comparison (P10's F6): building the "n8n + OPA + ordinary logs" version of the second-domain scenario requires nothing from P2 through P9. It can kill or validate the thesis for the price of a spike, any time after L4.

### 3. SuperDomestique is a new build, not an extraction

Today the deterministic code is concentrated in governance: the `governance-check` binding, the merge gate, the hash-chained ledgers (events and declared effects). The coordinator is prose: skills interpreted by the harness LLM. `beep-boop` drains queues because the model follows SKILL.md, not because a deterministic scheduler exists. ADR-0011's requirement (same recorded inputs produce the same control decision; replay tests; no hidden LLM routing) inverts the current execution substrate rather than extracting it. Expect the P1 inventory to find the runtime bucket nearly empty of code and full of prose; state that expectation now and treat P4 as greenfield.

This forces a question the pack defers to Q1/Q3 but which is not deferrable: **where does SuperDomestique run?** In-harness (then determinism is at the mercy of the harness process lifecycle), as a local daemon, or hosted. FAFF's adoption thesis is "no infrastructure, install into the harness you already use." A deterministic runtime implies a process that outlives conversations. These pull in opposite directions and the answer shapes P4 more than any schema does.

Related: by the pack's own competitive analysis, orchestration is commodity, so the runtime is the least differentiated of the three layers, yet it receives the most construction. Worth an ADR: SuperDomestique as a reference implementation of a protocol (worker adapter, effect gateway, assignment) that CMA, Temporal, or LangGraph could equally implement, mirroring how authorization is treated. That framing makes the runtime demotable if execution-independent governance proves out, and it matches the repo's existing cage-agnostic posture: state the criteria and provide the check; the operator brings the executor.

### 4. The second domain is a weak falsifier

Supplier onboarding is synthetic, self-selected to fit the evidence-heavy shape, exercised against a mock ERP, with no real user. Q25 and R-FALSE-HORIZONTAL acknowledge the risk, but the listed mitigations are also synthetic, and the P6 pack build (fixtures, lifecycle, external worker, mock ERP, observer) is pure throwaway if the P11 decision is "narrow."

Real second domains exist inside this project already: the eval-sweep process that gates autonomous-posture changes is an evidence-heavy governed workflow whose consequential effect (merging a behaviour change) is not code delivery; infra provisioning on Fly is another, with real effects, real observation via the Fly API, and real approval semantics. A real internal domain applies real pressure and retains value under every P11 outcome. The counter-argument, that software-adjacent domains are too close and let software-shaped abstractions pass, has force; so run the internal domain first as the cheap honest test, and keep supplier onboarding as the deliberately-distant proof only if the horizontal decision is still live afterwards.

### 5. The L4 gate can be self-certified

"Is L4 credible enough?" is answered by the person who built it, which contradicts the pack's own thesis that the executor cannot self-accept. Externalize the gate:

- run the operator-comprehension exercise (the two-minute rule from P9) at L4, not first at P9;
- have someone other than the author run a reference task from the walkthrough;
- land the seeded-failure scenarios as permanent CI fixtures rather than one-off demonstration runs, so the gate's evidence doesn't rot after tagging.

## Technical gaps

### Dual state is named, then waved through

ADR-0001 lists the dual-state problem as a consequence; T2 rates it Critical; the runtime doc says operational state must be "reconstructable or reconcilable from the governance ledger plus worker/system observations." That "plus" carries the whole design. The ledger deliberately records governed facts, not operational ephemera (queue state, in-flight handles, leases), so reconstruction-from-ledger alone cannot work and the reconciliation contract is undefined. Q4 defers it. Make it a time-boxed spike in P2: the answer constrains the persistence choice (Q3) and the runtime design (P4), both currently scheduled to proceed without it.

### Effect mediation assumes a capability that mostly won't exist

Workers today are coding agents holding real credentials. In the software domain, pre-execution blocking is achieved by external system configuration (branch protection enforcing the merge floor), not by a faff-owned gateway; T5 correctly rates gateway bypass High/Critical. The mock-ERP gateway in P6 demonstrates the easy case and proves little about real mediation. The honest generalization of what already works: Commissaire defines the check; enforcement lives in the external system or the cage. Treat the falsification criterion "consequential effect can be blocked before execution" as satisfied only when the block is enforced outside the worker's trust domain.

### Independence policy should include model family from day one

The initial checks are lane-identity rules, with "different model provider or family" deferred. Correlated blind spots across same-family models are exactly the failure the thesis worries about, and the repo already practices cross-model adversarial review (the dark-variant review slot runs a different LLM for this reason). The schema roughly carries worker lineage already; this is a policy decision, not a schema change.

### Say out loud that acceptance is mostly semantic

Commissaire's determinism verifies that an independent semantic opinion exists, with the right lineage, threshold, and artifact version. It does not verify the work is good. That is honest, and the evidence-assurance taxonomy handles it well, but it is the central uncertainty behind the kill criterion "acceptance is almost always another unconstrained LLM opinion" and behind the overhead risk P4: if determinism mostly does bookkeeping around semantic judgments, a simpler system running the same judgments with plain logs captures most of the value. Name it as the primary question the falsification must answer, not one metric among twenty.

## The distributed-evidence note

Strongest single document in the set, and the most immediately actionable: runners already exist on Fly, so dead-executor runs producing ambiguous evidence is a near-term reality. Two problems:

1. **Unsequenced.** Is recoverable-run support in the L4 release scope or after? Neither document says. Recommendation: a minimal slice (journal shipped off-box continuously, interrupted-state detection, the no-partial-admission invariant) belongs in L4 hardening; the full lease/recovery/re-execution machinery follows later.
2. **Vocabulary collides with the master pack.** "Admission" means atomic lineage advance in the note and contract admission in the master pack. "Checkpoint" means a workspace snapshot in the note and a Commissaire evaluation point in the master pack. Both pairs are destined for the same codebase and glossary. Reconcile now, and map the note's concepts into the three-layer model explicitly: journal, workspace checkpoint, and lease are runtime substrate; seal and lineage admission are governance verdicts; canonical lineage is ledger structure. One-page job, currently not done.

## Fit to the builder

- **The pack is itself an instance of R-L4-DRIFT.** Roughly 6,000 lines of design for a phase whose first instruction is "finish L4 and don't do any of this yet." The glossary carries about forty coined nouns before a second domain exists. Every noun is a maintenance liability for one person, paid in document-consistency work rather than code.
- **The freeze window and the roadmap disagree.** Naming is frozen for one to two months; the roadmap is plainly multi-quarter. The freeze expires mid-flight and the naming question reopens at the worst time. Note it in the plan.
- **Interruptibility.** P0 banks value if work stops there. P1 banks value. P2 through P5 bank nothing unless completed; a half-extracted generic runtime is the worst state to pause in: visibly headed horizontal, provably unproven. Tag every project with which P11 outcomes it retains value under. No-regret under all three outcomes: L-levels compiling into explicit lane/authority/evidence policy, the evidence-assurance taxonomy, effect reconciliation. Horizontal-only: the supplier pack, the generic UI. Prefer no-regret work when sequencing.
- **Mechanical ingestion hazards.** The master pack embeds verbatim copies of the plot input and roadmap.yaml that will drift from the standalone files. The ingestion-order doc references filenames (`18-faff-plot-input.md`, `02-architecture-principles.md`) that exist only inside the concatenation. The roadmap violates its own "small reviewable issues" instruction: PA2-020 is thirteen decisions in one issue; PA2-040 is epic-sized. Dedupe and right-size before feeding this to `/faff-plot`, or the generated tickets inherit all of it.

## Recommended re-sequencing

Every gate and every proof kept; only order and thickness change.

1. **P0 as written**, plus an explicit in/out decision on the distributed-evidence minimal slice, plus an externalized gate check (comprehension exercise, non-author reference run, seeded failures as CI fixtures).
2. **P1 as written**, with one added output: measure how much current code actually lands in the runtime bucket, as direct input to how P4 is framed.
3. **P2, thinned.** Decide ADRs individually as needed, not as one batch. Author only the schemas the facade needs. Replace speculative schema authoring with a paper exercise: hand-compile the second-domain contract against the drafts and record where they crack. Spike the dual-state reconciliation question here.
4. **P3 (facade) as written.**
5. **P8, pulled forward and lightened:** govern one workflow SuperDomestique didn't orchestrate, through the facade. Test the differentiator while it's cheap.
6. **F6 baseline spike** in parallel any time after L4: the simpler-stack version of the second-domain scenario, to calibrate what governance must beat.
7. **Then** decide how much runtime to build, informed by 5 and 6, and build P4/P5 as one thin strangler slice rather than two sequential projects.
8. **Supplier onboarding** only if the horizontal question is still open after a real internal second domain has been tried.

This ordering front-loads falsification, keeps the L4 bank intact, and leaves defensible artifacts at every possible stopping point.
