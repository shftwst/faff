# Agent Delivery Evidence spec, v0.3 (current)

v0.3 describes the files a per-PR anchor can hold and gives each one a closed JSON
Schema, so the bytes can be checked without reading faff's source. It covers the shapes
the writers produce today, plus the version stamp (`schema_version`) that later slices of
FAFF-1255 start writing.

**Status: current.** The per-PR mint refuses, and CI fails, an anchor that does not conform to
these schemas. FAFF-1287 extended `ac-checklist` in place with the optional `ac_id` and
`verifications` keys. Changes to v0.3 follow the versioning rule in
[`verification/evidence/README.md`](../README.md).

`faff evidence validate <anchor-dir>` reads an anchor and reports `pass`, `fail` or `legacy`;
`faff events anchor` runs the same check on the anchor it is about to commit. Neither changes
merge-gate routing.

## Contents

| Page | What it holds |
|---|---|
| [`anchor-manifest.md`](anchor-manifest.md) | The manifest, the legacy rule and the `faff evidence validate` command |
| [`evidence-documents.md`](evidence-documents.md) | Each evidence document: writer, shape and the slice that starts stamping it |
| [`logs.md`](logs.md) | The `events.jsonl` and `declared-effects.jsonl` envelopes and their line validators |
| [`anchor-manifest.json`](anchor-manifest.json) | The machine-readable manifest |
| [`schema/`](schema/) | One closed schema per anchor file, plus a valid and an invalid example each |

## Self-contained

Every schema the manifest names lives in `schema/`, and manifest paths are relative to the
manifest's own directory. `verification/` does not ship with the plugin, so a byte-identical
copy lives at `plugin/skills/faff/contracts/evidence-v0.3/` and the CLI reads that copy. A
test fails if the two trees differ.

Three schemas restate shapes that live elsewhere, so the bundled copy needs no outside path:

- `chain-head` restates v0.2's six keys with typed nullable fields.
- `producer-pk` restates the Commissaire facade v0.2 `producer-pk`.
- `holdout-anchored` restates the `attestation` object from `contracts/holdout-verdict.schema.json`.

A test keeps each restatement structurally equal to its source.

## Validator keywords

The schemas use the keywords the subset validator supports: `type` (a string or an array of
names, including `null`), `required`, `properties`, `enum`, `additionalProperties` (`false` or
a schema), `items`, `minItems`, `pattern` and `discriminator`. No violation message contains a
data value, so the output of `faff evidence validate` is safe to land in CI logs.

## Examples

Examples for shapes that exist today (run ledger, build progress, chain head, producer key, one
event line, one declared-effect line per record version) were carried from committed anchors
and scrubbed: session ids, hostnames, logins and free text are replaced with synthetic values.
The four shapes with no real instance yet (anchored review verdict, review round, anchored
spec-review verdict, anchored holdout) are built from the FAFF-1255 design scenarios.
