# Review-comment command comparisons

The command experiment uses the actual policy slice from each committed checkout.
The candidate receives `plan_review_comment`, which invokes its pinned emitted
CLI. The baseline keeps the existing four tracker tools. Both use fresh fixture
state and the same model, effort, provider limits and admission proxy.

Prepare after both checkouts and this harness are committed. The baseline policy
must match the eleven-case registry. Keep the candidate's reduced policy between
the existing review-comment section anchors.

```sh
node eval/control-parity/run.mjs prepare-pairs \
  --source-root "$BASELINE_ROOT" --pinned-commit "$BASELINE_COMMIT" \
  --candidate-root "$CANDIDATE_ROOT" --candidate-commit "$CANDIDATE_COMMIT" \
  --credential-env CLAUDE_CODE_OAUTH_TOKEN \
  --model claude-opus-5-5 --effort medium --attempts 22 --out "$PREPARE_OUT"
node eval/control-parity/run.mjs preflight-pairs \
  --manifest "$PREPARE_OUT/manifest.json" --out "$PREFLIGHT_OUT"
node eval/control-parity/run.mjs pairs \
  --manifest "$PREPARE_OUT/manifest.json" \
  --readiness "$PREFLIGHT_OUT/readiness.json" --out "$RUN_OUT"
```

All output directories must be new. Preflight invokes the candidate once locally,
then captures and refuses one model request from each arm without forwarding it.
It requires the declared access-token environment variable. It never reads a
credential file. A real batch retains the existing $10 allowance, one worker,
no retries, twelve turns per attempt and the existing time/output limits.

The manifest binds both commits and all tracked plugin bytes, both policy slices,
command caps, harness files, oracle, policy decisions and historical declarations.
The seeded schedule records 22 individual executions, alternating which arm runs
first. CLI and source bindings are rechecked before each execution. Drift or an
unexplained runtime difference stops the batch; remaining executions stay in the
report as `not-run`.

| Report evidence | Meaning |
|---|---|
| `comparison.json` | Original schema-2 strict comparison, including the changed runtime fingerprints |
| `declared-runtime-comparison.json` | Strict comparison over a derived view with the verified common runtime, produced only when every execution matches readiness; saved traces retain their raw runtime hashes |
| `pairs[].event_differences` | Actual tracker event differences, reported even when runtime fingerprints differ |
| `preserved` | Both arms conform and have equal event projections; the candidate used its command |
| `declared-change` | Candidate conforms and used the command; baseline exactly matches one recorded historical difference |
| `candidate-failure` | Candidate violates its independent expected outcome |
| `command-not-followed` | Candidate did not establish correct use of the command, regardless of tracker outcome |
| `unexpected-difference` | Difference outside the committed declarations |
| `incomplete` | Missing, interrupted, unmetered or unpaired evidence |

`intended-differences.json` permits only the four exact historical event
projections. Each entry binds its fixture, policy, exact expected candidate event projection and
operator decision. All seven decisions are pinned, including fenced examples;
unobserved baseline deviations receive no automatic exemption. A new deviation
requires a separately reviewed declaration and fresh preparation. The report
never requires the baseline to reproduce four differences.

Runtime comparison removes only the exact per-case prompt, the declared tool-list
sentence in the candidate harness, the validated additional tool and the
per-session `metadata.user_id`. Other request fields remain in the comparison.
Each arm must also match its own preflight fingerprint, including its complete
tool definitions.
The admission proxy also refuses changes to system instructions, tool definitions
or other static request fields on later turns within an attempt. Message history
may grow; unrelated runtime changes cannot be hidden in a later turn.

`observed_cost_nanos` contains reconciled provider usage priced at the manifest's
rates. Held and open reservations are separate, and `allowance_committed_nanos`
includes them. New baseline reports use `spend_nanos` as an alias for observed
cost; historical reports are unchanged. Partial attempts retain observed token
counts, contributing-request counts and cache TTL buckets while their complete
totals remain unknown. `arm_totals` presents the same observed quantities by arm.
Command spawn time, total attempt time and observed cache strata are separate.
No fresh configuration directory establishes a cold cache.

Deterministic tests use fixture executables and scripted model drivers. Their
results establish harness behaviour, not planner conformance or measured model
savings. The production planner, reduced caller and fresh Claude comparison are
separate prerequisites for extraction acceptance.
