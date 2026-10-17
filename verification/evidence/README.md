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
| [`v0.3/`](v0.3/) | current | A closed schema for every file a per-PR anchor can hold, the anchor manifest, and the read-only `faff evidence validate` command (FAFF-1256, slice 1 of FAFF-1255). A copy ships with the plugin. Enforced since FAFF-1261: the mint refuses and CI fails a non-conforming anchor. Changes follow the versioning rule below. |

Each version directory is a **full, self-contained description of its own scope** —
`v0.2/` does not restate v0.1's unchanged pages; it documents only what's new and points
back to `v0.1/` for everything else. `v0.1/conformance.md` stays on disk unedited as the
historical record of what v0.1 asserted; `v0.2/conformance.md` supersedes it as the
citable statement.

## Versioning policy

The spec version is **independent of faff's release version** and of the per-record
`schema: 1|2` field inside `events.jsonl` (in-band record versioning, orthogonal to the
spec version). v0.1 = the shipped dialect at the date of landing.

**Pre-1.0 rule:** v0.1 and v0.2 are **immutable** once landed (a typo or prose fix that changes
no schema or normative statement may land in place), and this durable rule binds FAFF-610 (the
Action names the spec version it checks), FAFF-611 (per-unit release plumbing), and the
flight-recorder extraction (v2 is reserved for the `issue`→`unit` rename). From v0.3 on, one
versioning rule applies, and every change carries a dated changelog entry below:

- An **additive change to a JSON evidence document** (as `classifySchemaChange` defines additive,
  with the array tightening of FAFF-1278) may land in place, with no new version directory.
- A **change to a JSONL record** (a new event type, effect kind, payload field or enum value) lands
  in place in schema-first, writer-second order, with the line-validator change in the first PR.
- **Any other change** to a v0.3 schema needs a new minor version.

**Vocabulary sequencing:** a new event type, effect kind or enum value lands before any anchor uses
it. "In place" means no new version directory, not one PR: the mint validates with the installed
CLI's bundled schemas, which in normal use match `main`, so a writer may emit a new field only
after the schema change that adds it is on `main` (and in the installed CLI). The schema change
and the writer change are two PRs, in that order, for JSON documents as well as JSONL records.

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

That signing/attestation layer has its own sibling spec:
[`verification/commissaire-facade/`](../commissaire-facade/) documents Commissaire's
`schema:3` facade records — signature/HMAC-verified, forgery-resistant, and replayable
secret-free via `commissaire audit verify` — for a reuser embedding Commissaire standalone.
It holds the opposite posture to this directory and serves a different reader; the two
cross-link rather than merge.

## Changelog

- **v0.3 — 2026-10-17 (FAFF-1261, current, slice 6).** v0.3 freezes and becomes current: the
  per-PR mint (`faff events anchor`) validates a staged anchor and refuses one that fails its
  schema, and the governance-check Action's `evidence-schema` input defaults to `require`. The
  freeze covers v0.3 as it stands, including two in-place additions that had no entry before:
  FAFF-1287's optional `ac_id` and `verifications` on `ac-checklist` criteria, and FAFF-1268's
  published `review-round` schema. A `holdout.json` must carry the issue named by
  `chain-head.json`. The `faff evidence write ac-checklist` writer now requires an `ac_id` on every
  criterion; that is a writer rule, not a schema change, so anchors with absent or `null` ids still
  validate. The draft rule is replaced by the versioning rule above.
- **v0.3 — 2026-10-18 (FAFF-1342, draft, schema slice of FAFF-1291).** Adds the optional, closed
  top-level `delegated` array to `holdout-anchored.schema.json`, so `holdout.json` can list every
  criterion the code-blind judge did not judge with the verifier that covers it. `required` and
  `schema_version` are unchanged. Additive under the draft rule: every committed anchor that
  validated still gives the same result. The writer that fills it is FAFF-1291.
- **v0.3 — 2026-10-14 (FAFF-1260, draft, slice 5).** Closes the log payloads: one schema per
  event type (27, including `evidence-terminal-only`), per effect kind (16) and per schema-3 record
  kind (8), under `v0.3/schema/events/`, `effects/` and `commissaire/`, composed into
  `run-event.schema.json` and `declared-effect.schema.json` by `scripts/evidence-v0.3-compose.mjs`.
  Every writer of either log now checks each record inside its append lock. Additive under the
  draft rule: every committed line the line validators accept still passes.
- **v0.3 — 2026-10-14 (FAFF-1256, draft).** Adds `v0.3/`: closed schemas for every file the
  per-PR mint can place in an anchor, `anchor-manifest.json`, four prose pages and the
  read-only `faff evidence validate` command. The subset validator gains `type` unions
  including `null`, `additionalProperties` as a schema, `minItems`, `pattern` and
  `discriminator`; its `enum` message no longer prints the offending value. v0.1 and v0.2 are
  not edited.
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
