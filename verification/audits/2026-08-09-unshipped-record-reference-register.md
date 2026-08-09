# Unshipped record reference register

This register resolves the missing-path inventory produced by FAFF-754 and implemented by FAFF-756. It distinguishes current dependencies from citations preserved inside dated ADRs, specs, audits, and spikes.

Historical citations remain unchanged. They record the source material an author used at the time, even when that source was local and never committed. Current skills, source comments, and maintained reference pages must be self-contained or point to a tracked source.

## Design references

The original inventory reported 19 distinct `design/*.md` matches. Eighteen are absent root-level targets. The nineteenth is a substring of the tracked `verification/external-verification/faff-labs/experiments/design/l4-experiment-design.md`, not a missing file.

| Referenced path | Disposition | Current tracked context |
|---|---|---|
| `design/adrs.md` | Historical source not shipped. | The implemented record system is under [`records/adr/`](../../records/adr/) and the `faff adr` command. |
| `design/extraction-topology.md` | Historical source not shipped. | [ADR 0042](../../records/adr/0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md) records the resulting region model. |
| `design/faff-critical-review-2026-07-04.md` | Historical review not shipped. | The recommendation and implementation boundary are retained in the FAFF-350 spec. |
| `design/faff-external-verification-brief.md` | Historical brief not shipped; the active dependency was removed. | [`verification/external-verification/README.md`](../external-verification/README.md) now explains the suite directly. |
| `design/future-directions.md` | Historical planning source not shipped. | The specs and ADRs that cite it retain the decisions that followed. |
| `design/governance-extraction-layers.md` | Historical design source not shipped; the active source comment is now self-contained. | [ADR 0042](../../records/adr/0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md) and the FAFF-362 spec retain the implemented boundary. |
| `design/harness-agnostic-runtime.md` | Superseded provisional path. | [`docs/reference/architecture/harness-coupling.md`](../../docs/reference/architecture/harness-coupling.md) is the single maintained seam inventory. |
| `design/harness-portability-surface.md` | Superseded provisional path. | [`docs/reference/architecture/harness-coupling.md`](../../docs/reference/architecture/harness-coupling.md) is the path selected by FAFF-592. |
| `design/lights-out-ci-environments.md` | Historical source not shipped. | The FAFF-391 spec and [`operations/ci/`](../../operations/ci/) retain the implemented CI-triage decisions. |
| `design/lights-out-routing-autonomy.md` | Historical source not shipped. | The FAFF-523 spec retains the backend-routing boundary. |
| `design/linear-cli-output-shape-spec.md` | Historical proposal not shipped. | Its only tracked citation describes a future extension; no current command depends on it. |
| `design/planning-loop.md` | Never committed; active skill dependencies were removed. | The skills now state the discovered-scope rule directly. Historical convergence decisions remain in the FAFF-87 and FAFF-534 specs. |
| `design/portable-runtime.md` | Historical source not shipped. | [`docs/reference/architecture/harness-coupling.md`](../../docs/reference/architecture/harness-coupling.md) and the FAFF-523 spec carry the current runtime and backend boundaries. |
| `design/prdrs.md` | Historical design source not shipped; the active source comment is now self-contained. | The implemented record system is the `faff prdr` command and generated `docs/prdr/` records. |
| `design/prds.md` | Historical design source not shipped. | [ADR 0016](../../records/adr/0016-prd-layer-product-axis-artifact-docs-prd-storage-container-slug-keying.md) and the `faff prd` command define the current storage and lifecycle. |
| `design/self-learning.md` | Historical planning source not shipped. | The citing specs and spike retain the bounded features that were implemented or deferred. |
| `design/spec-stage.md` | Historical planning source not shipped. | [ADR 0047](../../records/adr/0047-infosec-threat-prior-is-a-curated-committed-doc-consumed-as-review-context-auton.md) records the resolved threat-prior decision. |
| `design/team-mode.md` | Historical planning source not shipped. | Its only tracked citation remains as provenance in the FAFF-356 spec; no current surface depends on it. |
| `verification/external-verification/faff-labs/experiments/design/l4-experiment-design.md` | Tracked; no repair required. | This existing nested design file was mistakenly included in the absent-root count because its path contains `design/`. |

## RFC and report references

| Referenced path | Disposition |
|---|---|
| `records/rfc/rfc-governance-tamper-evidence.md` | Restored as a tracked historical RFC. Its shipped implementation specs and ADR establish its provenance. |
| `verification/reports/tracker-filing-plan.md` | Remains unshipped. The local file is a spent tracker execution plan. The active harness-coupling page no longer depends on it; citations in the FAFF-482 spec remain historical. |
| `verification/reports/governance-landscape-2026-07.md` | Remains unshipped. The local file labels itself unpublished research and requires claim re-verification. The dated L4 audit now records that limitation directly. |

This register does not decide repository-wide broken-link enforcement. FAFF-659 retains that separate scope.
