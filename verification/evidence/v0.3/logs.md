# Log envelopes

`events.jsonl` and `declared-effects.jsonl` are JSON Lines files with one record per line.

## Envelope schemas

`run-event` and `declared-effect` close the envelope per record version. The base node holds
only `type: object`, `required: ["schema"]` and a `discriminator` on `schema`; it declares no
`properties`, because closing it would reject every key before the discriminator runs. Each mapped
sub-schema is the full closed shape, so a schema-1 record carrying `prev` fails.

| Schema | `run-event` | `declared-effect` |
|---|---|---|
| 1 | unchained; no `prev`; `data` stays open (no writer emits schema 1) | unchained; `kind_of_entry` is `declare` or `observe` |
| 2 | adds required `prev` (64 lowercase hex); discriminates again on `type` | adds required `prev`, optional `origin` and `github_actor` |
| 3 | not used | Commissaire records, discriminated on `kind_of_entry` |

## Payload schemas

FAFF-1260 closes every payload. The authored sources are one file per event type
(`schema/events/<type>.schema.json`), per effect kind (`schema/effects/<kind>.schema.json`) and per
schema-3 record kind (`schema/commissaire/<kind>.schema.json`). `scripts/evidence-v0.3-compose.mjs`
fills each file's envelope from one template and inlines every file into `run-event.schema.json`
and `declared-effect.schema.json`, which are generated and never edited by hand.

Every writer of either log checks each record against these schemas inside its append lock and
writes nothing when the check fails. `faff events append` instead drops an agent's unknown
top-level `data` keys and names them in `data.dropped_keys`. An unavailable schema bundle degrades
a writer to its line validator and leaves `evidence-schema-unavailable.json` in the run dir.

### Event `data`

The genesis `run-start` written by `emitGenesisRunStart` carries `faff_version` (FAFF-1395), the faff
plugin release that minted the run. Older runs have no such key.

Each event type accepts every phase. Keys marked * are required. The telemetry tags are
`tokens`, `tokens_source`, `ledger_sha256_before`, `ledger_sha256_after`, `effort`, `gate`,
`rework_turns`, `dropped_keys` and `forbidden_side_effect`.

| Type | `data` | Keys | Telemetry tags |
|---|---|---|---|
| `run-start` | optional | `level`, `faff_version`, `mode`, `requested`, `containment`, `branch_protection`, `issue_count`, `count`, `admitted`, `routed_out`, `issues`, `list`, `note` | yes |
| `run-end` | optional | `stop_reason`, `shipped`, `parked` | yes |
| `tidy-done` | optional | `scope`, `park_labels_cleared`, `prep_candidates` | yes |
| `issue-admitted` | optional | `verdict`, `confidence`, `build_tier` | yes |
| `prep-start` | optional | none | yes |
| `prep-done` | optional | `return`, `outcome`, `verdict`, `result`, `confidence`, `disposition`, `bucket`, `spec_review`, `iterations`, `rounds` | yes |
| `build-start` | optional | `resume`, `attempt`, `worktree`, `branch`, `sequential` | yes |
| `issue-outcome` | required | `outcome`*, `pr`, `verdict`, `via`, `fingerprint` | yes |
| `discovered-scope-filed` | optional | `source` | yes |
| `budget-checkpoint` | optional | the `faff budget check` BudgetState: `spent`, `breached`, `outcome`, `resume_at`, `warnings`, `indeterminate`, `reason`, `spend_sources`, `unmetered_engines`; also `at`, `note` | yes |
| `park` | optional | `cause`, `reason`, `evidence`, `resolve_attempt`, `outcome`, `verdict`, `root_cause`, `note`, `category`, `leg`, `root_cause_class`, `reconsider`, `iterations`, `resumable`, `fingerprint` | yes |
| `sentry-checkpoint` | optional | the `faff sentry check` payload: `run_dir`, `verdicts`, `intervention`, `tripped`, `thresholds`, `authority`, `detection_trust`, `reconcile_check`, `config_malformed`, `stall_window_env_ignored`, `indeterminate`, `reason`; older relays also carry `advisory_L3`, `advisory`, `signal`, `member`, `run_elapsed_secs`, `ceiling`, `note` | yes |
| `sentry-trip` | optional | `verdicts`, `intervention`; the downgrade guard's `guard`, `live_level`, `attempted_issue`; also `remediation`, `note`, `orchestrator_disposition`, `basis` | yes |
| `corrective-authored` | required | the CorrectiveInput record (`schema`, `run_id`, `issue`, `op`, `payload`, `cites`, `authored_at`, `authored_by`) plus `artifact` | yes |
| `corrective-consumed` | required | `disposition`, `basis`, `mandate`, `constraints`, `applied`, `rejected`, `parks` | yes |
| `containment-check` | required | `mandate`, `parent`, `root`, `ancestry_raw`, `verdict`, `exit` | yes |
| `self-intake-check` | required | `mandate`, `target_raw`, `self`, `verdict`, `reason`, `exit` | yes |
| `run-resume` | optional | `epoch`, `prior_state`, `redispatched`, `reason`; top-level `epoch`, `prior_state`, `skipped_shipped`, `rebuilt_coarse` | yes |
| `run-claim-abandoned` | optional | `released_from`, `to`, `reason`; top-level `epoch` | yes |
| `park-reconsidered` | required | `issue`, `cause_class`, `via`, `ledger_cleared`, `ledger_note`, `cited_input_ref`, `prev_fingerprint`, `new_fingerprint` | yes |
| `ledger-write` | required | `ledger_sha256`*, `note` | yes |
| `agent-dispatch` | required | `kind`*, `dispatch_id`*, `cluster_id`*, `cluster_size`* | `tokens`, `tokens_source`, `effort`, `gate`, `rework_turns` only |
| `bundle-store-unavailable` | required | `boundary_kind`*, `boundary_key`*, `detail`* | yes |
| `decision-capture` | required | `kernel`*, `kernel_version`*, `normalised_inputs`*, `selected_action`, `verdict`, `coverage`*, `missing_inputs`*, `correlation_id`, `causation`* | yes |
| `decision-capture-action` | required | `kernel`*, `correlation_id`*, `selected_action`*, `causation`* | yes |
| `runner-identity` | required | `github_login`*, `github_login_source`*, `credential_source`*, `credential_unresolved`*, `verified`* | none |
| `evidence-terminal-only` | required | `issue`*, `writer`* | yes |

Nested objects are closed too. `sentry-checkpoint.data.verdicts[]` and `sentry-trip.data.verdicts[]`
discriminate on `signal`, with one closed `evidence` shape per sentry signal.

### Effect kinds

Each of the 16 kinds in `EFFECT_KINDS` (`merge`, `branch-delete`, `deploy`, `db-migration`,
`secret-rotation`, `email`, `webhook`, `registry-publish`, `force-push`, `prod-script`,
`label-write`, `tracker-write`, `file-write`, `pr-create`, `push`, `other`) has the same closed
descriptor: `kind`* and `target`* strings and an optional `reversible` boolean. Every `effect` on a
schema-1, schema-2, `declare` or `observe` record discriminates on `kind`.

### Schema-3 record kinds

| Kind | `author` | Body |
|---|---|---|
| `admission` | `commissaire` | `payload`: `producer_id`*, `contract_revision`*, `admitted_scope`*, `pk_fingerprint`*, `admitted_at`*, `custody` (`governor` or null) |
| `declare`, `observe` | `producer` | `effect`*, the effect descriptor |
| `effect-decision-request` | `producer` | `payload`: `effect`, `declared_ref`, `evidence_seq`, `level`, `attended`, `holdout` |
| `effect-decision-verdict` | `commissaire` | `payload`: `request_seq`*, `verdict`*, `reason`*, `effect`, `level`, `attended`, `holdout`, `level_policy`, `pure_verdict`, `pure_reason` |
| `conformed_to_contract`, `accepted_under_contract` | `commissaire` | `payload`: `producer_id`*, `contract_revision`*, `evidence_seq_range`* (two seqs), `escapes_checked`* |
| `reconcile` | `producer` | no `effect` and no `payload`; no writer emits this kind |

Every schema-3 record carries the authenticator its `author` implies: `commissaire_sig` or
`producer_hmac`.

### Open nodes

Five nodes stay open because another contract owns and checks them: `decision-capture`
`data.normalised_inputs` and `data.verdict`, `selected_action` on both decision-capture types (the
decision kernel), and `payload.effect` on the request and verdict records (Commissaire, whose
decision leg denies a malformed descriptor `invalid-effect-descriptor`).

## Line validators

The schemas cannot express every rule, so `faff evidence validate` also runs the line validators
the writers use: `eventViolations(rec, true)` (`events.js`) for events and
`declaredEffectViolations(rec)` (`effects.js`) for declared effects. They enforce `issue` for
issue-scoped event types, exactly one of `unit_id` or `issue`, and the authenticator matching
`author`.

## Torn tail

The final physical line of a file with no trailing newline that does not parse as JSON is
a torn tail. It is skipped and reported, using the same rule as `walkPhysicalChain`. Any other
unparseable or non-object line fails the file.
