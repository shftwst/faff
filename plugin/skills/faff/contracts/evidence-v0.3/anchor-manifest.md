# The anchor manifest

`anchor-manifest.json` maps each anchor-relative path to the schema that validates it.

```json
{ "schema_version": 1, "files": { "<path>": { "schema": "schema/<name>.schema.json", "format": "json|jsonl", "versioned_by": "field|manifest" } } }
```

`schema` is relative to the manifest's own directory. `versioned_by: "field"` marks an
evidence document, which carries its own `schema_version`. `versioned_by: "manifest"` marks
a file whose version is set by this manifest (the two logs, the chain heads and the producer key).

| Anchor path | Schema | Format | Versioned by |
|---|---|---|---|
| `events.jsonl` | `schema/run-event.schema.json` | jsonl | manifest |
| `declared-effects.jsonl` | `schema/declared-effect.schema.json` | jsonl | manifest |
| `chain-head.json` | `schema/chain-head.schema.json` | json | manifest |
| `effects-chain-head.json` | `schema/chain-head.schema.json` | json | manifest |
| `commissaire/producer/pk.json` | `schema/producer-pk.schema.json` | json | manifest |
| `run-ledger.json` | `schema/run-ledger.schema.json` | json | field |
| `build-progress.json` | `schema/build-progress.schema.json` | json | field |
| `landing-progress.json` | `schema/landing-progress.schema.json` | json | field |
| `ac-checklist.json` | `schema/ac-checklist.schema.json` | json | field |
| `review-verdict.json` | `schema/review-verdict-anchored.schema.json` | json | field |
| `spec-review-verdict.json` | `schema/spec-review-verdict-anchored.schema.json` | json | field |
| `holdout.json` | `schema/holdout-anchored.schema.json` | json | field |

These are the twelve files the per-PR mint can place in an anchor today. `review-round.schema.json`
is published but has no entry: round records are never anchored.

## Legacy rule

A legacy anchor is a directory where no present evidence document carries `schema_version`.
No writer stamps the field yet, so every anchor committed before the later slices is legacy.
A legacy anchor is reported `legacy` without running any schema check, and the legacy check
runs before the unmanifested-file check, so an old anchor with a stray file is never `fail`.
Chain integrity for those anchors stays with the governance-check integrity leg.

## `faff evidence validate`

```
faff evidence validate <anchor-dir> [--require-evidence-schema] [--json]
faff evidence --selftest
```

| Result | Exit | When |
|---|---|---|
| `pass` | 0 | Every file validates and at least one evidence document carries `schema_version` |
| `legacy` | 0, or 1 with `--require-evidence-schema` | No present evidence document carries `schema_version` |
| `fail` | 1 | A file fails its schema or line validator, a mid-file JSONL line is unparseable, or a file has no manifest entry |
| error | 2 | Usage error, a missing `<anchor-dir>`, or an unreadable bundled manifest or schema (`schema-unavailable <path>`) |

A torn tail (a final line with no newline that does not parse) is skipped and reported as
`torn_tail: true` on that file. Any other unparseable line fails the file. With `--json` the
report is `{ status, anchor_dir, spec_version, files: [{ path, status, violations, torn_tail? }] }`
with file statuses `ok`, `fail`, `legacy` or `unschemaed`. Human output lists at most five
violations per file.

The CLI reads the bundled copy of this directory, never the anchor's or the working
checkout's `verification/` directory: in an adopter run the working checkout belongs to the
party being audited.
