# Log envelopes

`events.jsonl` and `declared-effects.jsonl` are JSON Lines files with one record per line.

## Envelope schemas

`run-event` and `declared-effect` close the envelope per record version. The base node holds
only `type: object`, `required: ["schema"]` and a `discriminator` on `schema`; it declares no
`properties`, because closing it would reject every key before the discriminator runs. Each mapped
sub-schema is the full closed shape, so a schema-1 record carrying `prev` fails.

| Schema | `run-event` | `declared-effect` |
|---|---|---|
| 1 | unchained; no `prev` | unchained; `kind_of_entry` is `declare` or `observe` |
| 2 | adds required `prev` (64 lowercase hex) and the run-resume top-level fields `epoch`, `prior_state`, `skipped_shipped`, `rebuilt_coarse` | adds required `prev`, optional `origin` and `github_actor` |
| 3 | not used | Commissaire records: `author`, `producer_id`, `contract_revision`, `prev`, optional `commissaire_sig` and `producer_hmac` |

The payload objects (`data`, `effect`, `payload`) stay open. Per-type and per-kind schemas land
with FAFF-1260. The `run-event` `type` and `phase` enums mirror `DELIVERY_PROFILE`.

## Line validators

The schemas cannot express every rule, so `faff evidence validate` also runs the line validators
the writers use: `eventViolations(rec, true)` (`events.js`) for events and
`declaredEffectViolations(rec)` (`effects.js`) for declared effects. They enforce `issue` for
issue-scoped event types, exactly one of `unit_id` or `issue`, and the authenticator matching
`author`.

## Torn tail

The final physical line of a file with no trailing newline that does not parse as a JSON object is
a torn tail. It is skipped and reported, using the same rule as `walkPhysicalChain`. Any other
unparseable or non-object line fails the file.
