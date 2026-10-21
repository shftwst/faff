## 5. Scenarios

Shared setup for every scenario: a scratch directory initialised as a git repository, containing `.faff/config.yaml` whose two lines are `capture:` and `  decision_kernel: on`, and an empty directory `.faff/runs/run-1` (create it first; `faff events append` does not create the run directory). Then mint one `run-start` row into it with `echo '{"phase":"run","type":"run-start"}' | faff events append --run run-1 --ts 2026-01-01T00:00:00Z`. Commands run from the scratch directory. "The capture line" means a stderr line beginning `faff decision-capture`.

```
Given the shared setup, FAFF_RUN_DIR=<abs path of .faff/runs/run-1>,
  FAFF_DECISION_CORRELATION_ID=run-1/x/next/1, and FAFF_DECISION_ISSUE unset
When `faff next --status todo --spec high` runs
Then it exits 0 and prints the same stdout as the same command in a copy with decision_kernel: off
  And stderr has exactly one capture line, ending
    "capture suppressed: decision-capture event for kernel next refused by the issue-scoped rule: type 'decision-capture' is issue-scoped but missing required field 'issue'"
  And the last line of .faff/logs/decision-capture.jsonl parses as JSON with note "degraded-capture",
    run "run-1", event_type "decision-capture", kernel "next", rules ["issue-scoped"]
  And events.jsonl is byte-identical to before the command
```

```
Given the shared setup with FAFF_RUN_DIR set and neither FAFF_DECISION_CORRELATION_ID nor FAFF_DECISION_ISSUE set
When `faff next --status todo --spec high` runs
Then it exits 0
  And stderr has two capture lines: the first contains "empty correlation_id", the second contains "capture suppressed: decision-capture event for kernel next"
```

```
Given the shared setup
When `faff decision-capture record --run run-1 --issue "" --kernel <2000 copies of "k">` runs
  with stdin {"normalised_inputs":{},"selected_action":"graft"}
Then it exits 0 with empty stdout
  And the note's reason is at most 1024 UTF-8 bytes and ends with "...[truncated]"
  And the text after the capture line's prefix equals the note's reason
```

```
Given the shared setup
When `faff decision-capture record --run run-1 --issue "" --kernel "bad<newline>kernel"` runs,
  where <newline> is a literal line feed inside the argument, with stdin {"normalised_inputs":{},"selected_action":"graft"}
Then it exits 0 with empty stdout
  And stderr has exactly one capture line, and it contains "for kernel bad kernel refused by the issue-scoped rule"
  And no stderr line begins with "kernel refused by"
  And the last note has kernel "bad kernel" and a reason containing no line feed
```

```holdout
Given the shared setup, FAFF_RUN_DIR=<abs path of .faff/runs/run-1>,
  FAFF_DECISION_CORRELATION_ID=run-1/FAFF-7/claim-verdict/1, and FAFF_DECISION_ISSUE exported as the empty string
When `faff claim-verdict --claimed-at 2026-01-01T00:00:00Z --now 2026-01-05T00:00:00Z --ttl-hours 24` runs
Then it exits 0 and stdout is exactly {"verdict":"stale","age_secs":345600,"ttl_secs":86400}
  And stderr has exactly one capture line, containing "capture suppressed: decision-capture event for kernel claim-verdict refused by the issue-scoped rule"
  And the last line of .faff/logs/decision-capture.jsonl has kernel "claim-verdict", event_type "decision-capture" and rules ["issue-scoped"]
  And .faff/runs/run-1/events.jsonl still holds exactly one line
```

```holdout
Given the shared setup, FAFF_RUN_DIR=<abs path of .faff/runs/run-1>,
  FAFF_DECISION_CORRELATION_ID=run-1/FAFF-7/eligible/1, and FAFF_DECISION_ISSUE exported as the empty string
When `faff eligible --label faff-automate --label bug` runs
Then it exits 0 and stdout is exactly the line `true`
  And stderr has exactly one capture line, containing "capture suppressed: decision-capture event for kernel eligible refused by the issue-scoped rule"
  And the last line of .faff/logs/decision-capture.jsonl has kernel "eligible", event_type "decision-capture" and rules ["issue-scoped"]
  And .faff/runs/run-1/events.jsonl still holds exactly one line
```

## 8. Done

### From why
- [ ] A refused capture's stderr line and note name the event type, the kernel and the rule, in the format in section 3.

### From what
- [ ] Every `EVENT_SCHEMA` error thrown by `appendRecordUnderLock` has `rules`: `["issue-scoped"]` for an empty issue with a valid payload, `["payload-schema"]` for a good issue with a bad payload under the delivery profile, and `["issue-scoped","payload-schema"]` when both fail. `message`, `violations` and `code` are byte-identical to before for the same inputs.
- [ ] `test/faff-1353-write-core-issue-scoped.test.mjs` and `test/events.test.mjs` pass unmodified, and `faff events append` with `{"phase":"run","type":"decision-capture","issue":""}` still exits 1 with one `- <violation>` stderr line per violation.
- [ ] `lineSafe` unit cases: `"a\nb\tc"` gives `"a b c"`; `a`, U+2028 LINE SEPARATOR, `b` gives `"a b"`; `"a\u0085b"` gives `"a b"`; a 1024-byte ASCII string is returned unchanged; a 2000-byte ASCII string gives 1010 bytes plus `...[truncated]` (1024 bytes); a string of 600 copies of `é` (1200 bytes) gives at most 1024 bytes, no U+FFFD, and ends `...[truncated]`.
- [ ] A suppressed capture's note has exactly the keys `ts, run, note, reason, event_type, kernel, rules`, in that order; every other degraded-capture note has exactly `ts, run, note, reason`.
- [ ] `docs/guide/cli.md`'s `decision-capture` row carries the suppressed-capture sentence and the exit-code justification.

### From how
- [ ] The three sites (`record`, in-kernel, `action`) each produce the suppression reason for an empty issue, with event types `decision-capture`, `decision-capture`, `decision-capture-action`.
- [ ] A non-schema append failure still produces `journal append failed: <message>`: called with `{code: "EVENTS_LOCKED", message: "m"}`, `reportAppendFailure` writes a note whose reason is `journal append failed: m` and which has no `event_type` key. Export `reportAppendFailure` and `lineSafe` for the unit tests, as `effects-reconcile.js` exports `sanitizeDetail`.
- [ ] Each existing degraded-capture reason (config read, stdin, shape, run dir, chain head, empty correlation) is unchanged in text when it contains no control characters and is under 1024 bytes; `test/decision-capture.test.mjs:172-215`, `test/faff-989-decision-capture-driver.test.mjs` and `test/faff-1009-decision-capture-tier-wiring.test.mjs:138-176` pass unmodified.
- [ ] The comment at `decision-capture.js:454-458` no longer says the append always happens; it names the empty-issue half as decided by the write core and the empty-`correlation_id` half as deferred.
- [ ] `decision-capture.js` contains no test of `issueVal === ""` and no match on violation text to pick a rule.

### From edge cases
- [ ] With both `FAFF_DECISION_CORRELATION_ID` and `FAFF_DECISION_ISSUE` unset, `faff next` writes the empty-correlation note before the suppression note.
- [ ] The visible scenarios in section 5 pass as integration tests that spawn the CLI, including the `--kernel` line-feed scenario.
- [ ] For every kernel that calls `captureDecision` with `process.env.FAFF_DECISION_ISSUE || ""` (`next`, `project-next`, `claim-verdict`, `eligible`, `park-verdict`), a run with `FAFF_DECISION_ISSUE` unset, capture on, exits with the same code and prints the same stdout as with capture off.
- [ ] With capture off, no stderr capture line and no note are written on any of the paths above.
