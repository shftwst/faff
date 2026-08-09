# Agent Delivery Evidence spec

A versioned, in-repo description of the artifacts a governed faff run leaves behind —
the run-ledger, the events log, and the per-issue floor artifacts — so an external
consumer (a governance-check marketplace Action, a dashboard, an auditor) can build
against them without reading faff's source.

The **code stays the enforcement** (`faff events validate`, `faff runcheck`, `faff
contract <name>`, `faff governance-check`); this directory is the citable description of
what that code already produces and reads. A divergence between this spec and a
validator is a spec bug, caught by the CI harness (`test/evidence-spec.test.mjs`), not a
license to relax the validator.

## Versions

| Version | Status | What it covers |
|---|---|---|
| [`v0.1/`](v0.1/) | current baseline | The nine artifacts a governed run produces at construction time: `run-ledger.json`, `events.jsonl`, and the five per-issue floor artifacts (`ac-checklist.json`, `review-verdict.json`, `holdout.json`, `merge-record.json`, `supersession.json`), plus the two supporting artifacts (`build-progress.json`, `lane-boundary.json`) the L4 holdout leg transitively reads. |
| [`v0.2/`](v0.2/) | current | Adds the `chain-head.json` witness artifact, the `faff events verify` / `faff events anchor` verbs, and governance-check's sixth `integrity` leg — the hash-chain anchoring/verification surface FAFF-568 shipped after v0.1 was approved. v0.1's nine pages are otherwise unchanged; see `v0.2/conformance.md` for the six-leg conformance statement FAFF-610's Action should cite going forward. |

Each version directory is a **full, self-contained description of its own scope** —
`v0.2/` does not restate v0.1's unchanged pages; it documents only what's new and points
back to `v0.1/` for everything else. `v0.1/conformance.md` stays on disk unedited as the
historical record of what v0.1 asserted; `v0.2/conformance.md` supersedes it as the
citable statement.

## Versioning policy

The spec version is **independent of faff's release version** and of the per-record
`schema: 1|2` field inside `events.jsonl` (in-band record versioning, orthogonal to the
spec version). v0.1 = the shipped dialect at the date of landing.

**Pre-1.0 rule:** every change to the documented shape — additive or breaking — bumps the
minor (v0.2, v0.3, …) with a dated changelog entry below. There is no silent in-place edit
of a published version directory (a typo/prose fix that changes no schema or normative
statement may land in place). Published version directories are **immutable** once
landed — this durable rule binds FAFF-610 (the Action names the spec version it checks),
FAFF-611 (per-unit release plumbing), and the flight-recorder extraction (v2 is reserved
for the `issue`→`unit` rename).

v1.0 is reserved for the first version an external consumer pins.

## Schema authoring rules

- Draft 2020-12, `$id: faff/evidence/<version>/<name>`.
- **One source per schema.** Where a normative schema for an artifact body already exists
  under `plugin/skills/faff/contracts/` (`review-verdict`, `holdout-verdict`,
  `lane-boundary`), the relevant page references it — it is never copied. New schemas are
  authored only for artifacts that have none.
- Enums restate the closed vocabularies exported by `governance-profile.js`
  (`DELIVERY_PROFILE`) — that module is the implementation source; this directory's
  schemas mirror it, never redefine it independently.
- Examples under each version's `schema/examples/` are hand-carried from real run
  artifacts wherever one exists (never invented from memory) and validated in CI against
  their schema — see `test/evidence-spec.test.mjs`.

## Conformance ≠ authenticity

Every conformance claim in this directory inherits the posture stated in
[`docs/guide/governance-check.md`](../../docs/guide/governance-check.md): artifacts are
**emitter-authored**. Validation catches a cooperating-but-fallible emitter — incomplete
runs, budget breaches, tampered/missing floor artifacts — never a forging one. Signing
and attestation are a separate trust layer, out of scope for this directory.

## Changelog

- **v0.2 — 2026-07-24 (FAFF-601, documenting FAFF-568).** Adds the `chain-head.json`
  witness artifact, `faff events verify`/`faff events anchor`, and governance-check's
  sixth `integrity` leg. v0.1's OUT OF SCOPE bullet excluding this surface (written before
  FAFF-568 shipped) is retired — see `v0.2/anchor-integrity.md` and
  `v0.2/conformance.md`.
- **v0.1 — 2026-07-24 (FAFF-601).** Initial spec: nine pages describing the run-ledger,
  events log, and five per-issue floor artifacts plus two supporting artifacts, as they
  shipped at landing time. Chain construction documented as normative; chain
  anchoring/verification explicitly out of scope (see v0.2 above — that exclusion no
  longer holds).
