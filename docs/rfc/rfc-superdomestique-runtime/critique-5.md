# Critique of the v5 pack

**Status:** recorded review
**Date:** 2026-08-16
**Model:** Claude Fable 5
**Scope:** [master v5](v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md), [technical design v5](v5/TECHNICAL-DESIGN-v5.md), [diagram atlas v5](v5/ARCHITECTURE-DIAGRAMS-v5.md), and [plot input v5](v5/FAFF-PLOT-INPUT-v5.md), verified against [critique-4](critique-4.md) and the earlier RFC history in this directory
**Repository state at review:** `cc7c7ccf3537` on 2026-08-16. This is a document review: internal consistency of the pack and implementation of the critique-4 corrections. Implementation and tracker facts were not re-verified beyond the pack's own inspection anchors.

## Bottom line

v5 does what critique-4 asked. Each of the eight recorded v4 defects has a verifiable correction in the master, and the technical design, diagram atlas, and plot input extend the master coherently rather than reopening its decisions.

The review found four pack defects. None disturbs the strategic direction, so they were corrected in place in the v5 documents on the review date rather than through a v6:

1. the plot input companion was referenced by the master and technical design but did not exist when the pack was first assembled;
2. the diagram atlas attached contract and terminal-verdict identities to the run instead of the work item, contradicting the master's fixed decisions;
3. the master's implementation anchor was one commit and three days behind its companions without saying so; and
4. the plot input declared itself approved while the rest of the pack remained proposed.

With those corrections applied, the pack is ready to lock as the final v5.

## Verification of the critique-4 corrections

| Critique-4 defect | v5 resolution | Where verified |
|---|---|---|
| 1. Run, work item, executor attempt, and stage attempt treated as one identity | Six identities with stability rules; bare `attempt ID` banned from schemas and normative prose | Master, record identity and disposition scopes |
| 2. Phase 0A wrote an off-box journal before the Phase 1 migration map | Phase 0 publishes immutable recovery bundles over current canonical artifacts; the generic envelope waits for the Phase 1 map and the Phase 2A second producer | Master, current-artifact durability and journal migration |
| 3. Class C journal authority claimed without producer authenticity | J-C requires a verifiable producer binding unavailable to conflicting producers; a self-declared principal is J-D and cannot satisfy a stronger obligation | Master, journal authority classes |
| 4. Terminal dispositions inconsistent and `Rejected` carrying two meanings | Admission and admitted-work lifecycles separated; `AdmissionRejected` and `OutcomeRejected` distinct; cancellation defined as a transition rule from any non-terminal admitted state | Master, work-item lifecycle |
| 5. Gate 1 governance question claiming recovery and coordination benefits | Recovery, cleaner logs, and seeded failures alone excluded from the governance question; coordination evidence must come from the predeclared fidelity study, shadow comparison, or a repeated real failure | Master, Gate 1 |
| 6. Roadmap diagram sending a coordination-only outcome into Phase 4 | Four-outcome matrix authoritative; governance-no, coordination-yes builds Phase 3 only as software-product hardening and does not feed Phase 4 | Master, Gate 1 matrix; atlas 4.1 |
| 7. Retention and compaction specified before a measured need | Complete proof-phase retention, redaction before publication, measurement of volume and cost, compaction deferred to a later ADR with a defined trigger | Master, retention |
| 8. Solo-builder capacity model ignoring the autonomous runner | Maintainer-steered autonomous capacity, one active architecture decision frontier, evidence-based work-in-progress control | Master, operator surface and capacity model |

The technical design's three-part structure keeps the clean end state, the current implementation, and the transition rules separate, as the master requires. Its fixed outcomes, canonicality timeline, and rollback rules match the master's decisions without extending them past their gates.

## Pack defects and corrections

### 1. The plot input companion was missing

Both the master's companion list and the technical design linked `FAFF-PLOT-INPUT-v5.md`, described as supplying the outcome, constraints, dependencies, evidence horizons, and open questions for roadmap shaping. The file did not exist when the pack was first assembled; the pack was incomplete by its own table of contents.

The document was supplied on 2026-08-15 and reviewed here. It is consistent with the master: the Gate 1 four-outcome matrix is reproduced correctly, including the coordination-only route stopping the horizontal path; the first slice is the Phase 0A recovery-bundle increment with current ledgers staying canonical; conditional phases stay out of committed scope; and the roadmap decomposition is left to the configured methodology rather than pre-written. It states outcomes and constraints without asserting solutions and instructs the planner to surface changed premises rather than plan from stale detail.

### 2. The atlas misattached contract and verdict identities

Atlas diagram 1.6 had `RUN ||--|| CONTRACT : admitted_under` and `RUN ||--o{ TERMINAL_VERDICT : receives`, gave the work item no contract relationship at all, and drew a direct one-to-many run-to-work-item edge even though a work item is stable across runs and run membership is the joining relationship. The master fixes both identities to the work item: a contract revision is the immutable terms governing a work item, and `accepted_under_contract` is the work-item terminal verdict. The atlas's own state machine 5.11 already treated the verdict as work-item scoped, so the atlas disagreed with itself as well as with the master. The same run-level binding leaked into the captions of 5.1 and 5.2, the admission trigger of 5.2, and the contract-enables-run edge in 5.14.

This is the exact failure the master's risk table names as identity-scope collapse, sitting inside the pack's own companion, and the plot input directs planners to the atlas to understand the state model.

Correction applied: 1.6 binds contract revisions and terminal verdicts to the work item, names the contract entity `CONTRACT_REVISION`, and reaches work items from runs only through run membership; the 1.6 caption states the binding rules; the 5.1 caption names the work item as the holder of the governing revision; 5.2's admission trigger is run admission with a caption separating it from contract admission; 5.14 draws contract admission enabling work-item eligibility.

### 3. The master's inspection anchor lagged its companions silently

The master's current-truth and source-basis sections describe the repository at `79563ac` on 2026-08-12. The technical design and atlas were inspected at `7d89640ce7b8` on 2026-08-15. Several commits landed between the two anchors, so the pack carried two observation points without acknowledging the difference.

Correction applied: the master's source-basis section now names both anchors and states that the later inspection is the fresher observation for implementation detail while the master still controls strategy. The existing rule that planning rechecks implementation and tracker facts at work start already covers movement after both anchors, including the commits between `7d89640ce7b8` and the review commit above.

### 4. The pack's status lines disagreed

The plot input declared itself approved while the master, technical design, and atlas remained proposed. A reader could have treated the brief as actionable ahead of the pack it depends on.

Correction applied: the plot input is now a proposed companion that becomes the approved discovery brief when the pack is locked. All four status lines flip together at lock.

## Repository placement note

Not a v5 defect, but it affected committing this directory: the v2 master pack contained licensing and intellectual-property planning content that repository policy keeps out of committed documentation. That content was redacted from the v2 master on 2026-08-16, with dated markers left in place of the removed sections; the material itself remains held privately. The v3, v4, and v5 documents and the critique series are clean on this point, so the directory is committable as it stands.

## Verdict

Lock v5. The critique-4 corrections are implemented, the pack is complete, and the four defects found by this review are corrected in place. The remaining act is the maintainer's: flip the four status lines from proposed at lock. The next recorded review belongs after the first implementation slices produce evidence, not before lock.
