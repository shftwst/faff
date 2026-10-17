# ADR 0140 — Evidence spec v0.3 takes additive changes in place after the freeze

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-17
- **Issue:** FAFF-1261

## Context

Evidence spec v0.3 (`verification/evidence/v0.3/`) holds a closed schema for every file a per-PR anchor can hold, the anchor manifest, and the payload schemas for every event type, effect kind and schema-3 record kind. Until FAFF-1261 it was a draft: the FAFF-1255 slices edited it in place, and nothing refused on it. FAFF-1261 makes the mint refuse a non-conforming anchor, flips the CI evidence-schema leg to `require`, and moves v0.3 from draft to current.

The README's Pre-1.0 rule said every change to the documented shape, additive or breaking, bumps the minor, and that published version directories are immutable. Applied to v0.3 after the freeze, that rule would make every new event type, effect kind, enum value or optional field cost a new version directory, a new bundled copy in the plugin and a new manifest.

Two pieces already shipped assume a different rule:

- FAFF-1258 ships `classifySchemaChange(base, head)` and `faff evidence validate --candidate-schemas <dir>`, which accept an additive candidate schema and reject anything else (`candidate_rejected`).
- FAFF-1278 ships the base-commit CI leg, which judges a PR's anchors with the base commit's code and uses the candidate path for schemas the PR adds to. It also tightens the additive rule for arrays.

FAFF-1287 (which settled the acceptance-criterion id grammar, ADR 0139) already added optional `ac_id` and `verifications` to v0.3 in place as an additive change, under the draft rule.

Two options were considered:

- **Keep v0.3 immutable after the freeze** and bump to v0.4 for every change. This is the conservative reading of the Pre-1.0 rule, but each new event type would cost a version directory, a bundled copy and a manifest, and it would leave FAFF-1258's candidate-schema path and most of FAFF-1278's base-commit leg unused.
- **Let v0.3 take additive changes in place** under a rule the shipped checks already enforce.

Round 8 of the FAFF-1261 spec review raised the conflict between the reviewed in-place rule and the README's Pre-1.0 rule. The product owner settled it on 2026-10-17.

## Decision

When FAFF-1261 lands, v0.3 moves from draft to current, and from then on one versioning rule applies to it:

- An additive change to a JSON evidence document, as `classifySchemaChange` defines it with FAFF-1278's array tightening, lands in v0.3 in place with a dated changelog entry.
- A JSONL record change (a new event type, effect kind, payload field or enum value) lands in v0.3 in place, schema first and writer second: two PRs, with the line-validator change in the first.
- A new event type, effect kind or enum value lands before any anchor uses it.
- Any other change to a v0.3 schema needs a new minor version.

"In place" means no new version directory, not one PR. The mint validates with the installed CLI's bundled schemas, which in normal use match `main`, so a writer may emit a new field only after the schema change that adds it is on `main` and in the installed CLI. The schema PR and the writer PR are separate and in that order for JSON documents as well as JSONL records.

The rest of the policy stays:

- v0.1 and v0.2 stay immutable.
- A typo or prose fix that changes no schema or normative statement may still land in place in any version.
- v1.0 stays reserved for the first version an external consumer pins.

`verification/evidence/README.md` replaces both the Pre-1.0 rule and the draft rule with this single rule, so the README does not carry two rules that disagree.

## Consequences

- The v0.3 schemas are closed (`additionalProperties: false`). A consumer holding an older copy of v0.3 rejects a key added later in place. The version string does not tell such a consumer that its copy is stale; the dated changelog entries do. An external consumer that needs a fixed shape waits for v1.0, which this decision keeps reserved for that purpose.
- CI is covered by the base leg's candidate path: the schema PR's own anchor passes while its head adds the field, and an adopter whose installed CLI is ahead of the base is judged correctly. The mint has no candidate path. It judges with the installed CLI's bundled schemas, so a writer change that reaches `main` before its schema change produces anchors the mint refuses. The two-PR order is the guard.
- `classifySchemaChange` now decides what counts as a version bump. A change to it that widens "additive" widens what can land in v0.3 without a new minor, so changes to it need the same review as a change to the versioning rule.
- New event types, effect kinds and enum values no longer need a version directory, a bundled copy or a manifest. FAFF-1258's and FAFF-1278's candidate machinery carries that work.
- The freeze entry in the README changelog names FAFF-1287's `ac_id` and `verifications` and FAFF-1268's `review-round` schema, which landed under the draft rule without entries of their own.
- Making `ac_id` required in the `ac-checklist` schema is not additive, so it needs a new minor version. FAFF-1261 enforces `ac_id` as a writer rule instead, which is not a schema change.
