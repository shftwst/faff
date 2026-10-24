# FAFF-1354: a suppressed capture names the rule that refused it

> Spec: faffter-dark-nlspec · 2026-10-20 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1354.

_Revised 2026-10-20, round 2, after spec review round 1 (revise, five objections, all from the methodology and QA lenses). Round 2 replaces the line-feed holdout with a second plain-CLI holdout and moves the line-feed case into a visible scenario, corrects the shared setup (the run directory must exist before `faff events append`, and the config file is `.faff/config.yaml`), records the FAFF-1270 relationship and the harness contingency in section 7, and notes the tracker hygiene done during prep: FAFF-1354 is retitled and linked as blocking FAFF-1270._

This is the build spec for FAFF-1354, slice 2 of 2 under FAFF-1348. It is written for the build agent that implements the change and for the people who review it. Slice 1, FAFF-1353 (PR #1094, commit `abd65009`), made the `events.jsonl` write core refuse an issue-scoped event whose `issue` is empty. This slice makes that refusal readable when it happens inside decision capture. It changes no exit code. It is also FAFF-1270's code-blind holdout proving run; section 7 records what that means for this slice.

## 1. Why

When the write core refuses a decision-capture event, the capture path already reports it, but in words that hide the cause. `bestEffortFail` (`plugin/skills/faff/bin/lib/decision-capture.js:324-333`) writes one stderr line and one `.faff/logs/decision-capture.jsonl` note, and every append site passes it `journal append failed: <error message>`. This slice replaces that text, for a schema refusal only, with a reason that names the event type, the kernel that was capturing and the rule that refused it. It also makes every degraded-capture reason safe to print on one line and bounded in size.

**Problem.** Today a capture that the write core refuses reads `journal append failed: decision-capture event refused by the v0.3 run-event schema: type 'decision-capture' is issue-scoped but missing required field 'issue'`. The reader cannot tell which kernel lost its record, the text reads like an I/O fault, and nothing in the note can be filtered on. The reason is also printed raw: a caller-supplied value such as `--kernel` containing a newline splits the stderr line, and no length cap applies.

### Design principles

**The capture path never gates.** BEST-EFFORT-FAIL is documented in `records/specs/2026-08-19-faff-821-capture-current-decision-kernel-inputs-and-chosen-actions-for-phase-1-fidelity-design.md:151-153`, `records/specs/2026-09-02-FAFF-956-widen-decision-capture-design.md:19` and `docs/guide/cli.md:184` ("always exits 0"). Reject any implementation that changes an exit code or stdout byte of a kernel or of `faff decision-capture record` and `action`.

**The issue-scoped rule has one home.** FAFF-1353 made `issueScopedViolations` (`events.js:159-165`) the only implementation of the rule, called by `eventViolations` and the write core. Reject any implementation that re-decides "is this issue empty" in `decision-capture.js`.

**The rule is named by the code that applied it.** The reason's rule name comes from the write core, which knows which check produced each violation. Reject any implementation that infers the rule by matching violation text.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/decision-capture.js` | JavaScript | `bestEffortFail` :324-333; append sites in `cmdRecordVerb` :415-419, `captureDecisionCore` :482-484 and `cmdActionVerb` :588-592; the comment at :454-458 |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `appendRecordUnderLock` :618-640 runs the issue-scoped check then the payload check; `eventSchemaError` :642-647 builds the `EVENT_SCHEMA` error |
| `plugin/skills/faff/bin/lib/evidence.js` | JavaScript | `noteSchemaUnavailable` :229-233, the only run-directory marker today |
| `plugin/skills/faff/bin/lib/effects-reconcile.js` | JavaScript | `sanitizeDetail` :126-133, the codebase's precedent for collapsing control characters and a UTF-8-safe byte cap |
| `docs/guide/cli.md` | Markdown | The `decision-capture` row, line 184 |

**Scope.** One change to the decision-capture failure reporting, plus an additive property on the write core's `EVENT_SCHEMA` error.

## 2. Out of scope

- **Everything FAFF-1353 excluded.** That covers the fourteen existing rows, the payload-schema degrade, orchestrator prose, the `__run__` allow-list, the un-wired `tier` and `regions` kernels, and suppressing a row that has a good issue but an empty `correlation_id`. Why excluded: the parent split assigned them elsewhere or deferred them. Extension point: the deferred `correlation_id` half stays at the empty-correlation branch in `captureDecisionCore` (`decision-capture.js:459-461`).
- **A run-directory suppression marker.** Why excluded: section 3 decides against it; the note carries everything the marker would. Extension point: a sibling of `noteSchemaUnavailable` in `evidence.js`, written from `bestEffortFail`, if a run-local reader ever needs a presence check.
- **The stderr prefix.** `bestEffortFail` prints the prefix `faff decision-capture record: degraded capture` on every path, including the `action` verb and in-kernel capture. Why excluded: no test or reader depends on it, and the new reason names the kernel, so the prefix no longer misleads about what was capturing. Extension point: a `verb` argument to `bestEffortFail`.
- **The `run` field when `action` resolves its run from `$FAFF_RUN_DIR`.** `cmdActionVerb` passes `values["--run"]`, so the note's `run` is `null` in that case. Why excluded: pre-existing and unrelated to the refusal reason. Extension point: pass `runId` from `cmdActionVerb` to `bestEffortFail`.
- **A reader of `.faff/logs/decision-capture.jsonl`.** No production code reads it today. Why excluded: this slice only makes the note filterable. Extension point: `/faff-wtf`'s run summary.
- **Bidirectional-text controls (U+202A to U+202E, U+2066 to U+2069) in reasons.** Why excluded: no sanitiser in the codebase handles them, so adding them is a hardening call across every sanitiser, not this slice's. Extension point: the character class in `lineSafe`.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Suppressed capture | A decision-capture event that the `events.jsonl` write core refused with `EVENT_SCHEMA`, so no row was written |
| Rule | One of the write core's two checks: `issue-scoped` (the `issueScopedViolations` predicate) or `payload-schema` (the v0.3 payload check from `logRecordChecker`) |
| Degraded-capture note | One JSON line appended to `.faff/logs/decision-capture.jsonl` by `bestEffortFail` |
| Line-safe | Contains no character that a terminal or a line-oriented reader treats as a line break or control |

### Types

```
ENUM WriteCoreRule:
  "issue-scoped"      # issueScopedViolations returned >= 1 violation
  "payload-schema"    # the v0.3 payload checker returned >= 1 violation

RECORD EventSchemaError (existing, extended):
  code: "EVENT_SCHEMA"
  message: String              # unchanged
  violations: List<String>     # unchanged; issue-scoped violations first
  rules: List<WriteCoreRule>   # NEW; non-empty; each rule that produced >= 1 violation,
                               # "issue-scoped" before "payload-schema"; no duplicates

RECORD DegradedCaptureNote (existing, extended):
  ts: ISO-8601 String          # unchanged
  run: String | null           # unchanged
  note: "degraded-capture"     # unchanged, on every path including suppression
  reason: String               # now always line-safe and at most 1024 UTF-8 bytes
  # present only on a suppressed capture:
  event_type: "decision-capture" | "decision-capture-action"
  kernel: String               # line-safe, at most 1024 UTF-8 bytes
  rules: List<WriteCoreRule>   # copied from EventSchemaError.rules, [] when absent

  CONSTRAINT key order: ts, run, note, reason, then event_type, kernel, rules when present
```

### The suppression reason

```
capture suppressed: <event_type> event for kernel <kernel> refused by the <rule phrase>: <violations>
```

- `<event_type>` is the type the site tried to append.
- `<kernel>` is the kernel name the site holds: the `kernel` argument in `captureDecisionCore`, `values["--kernel"]` in `cmdRecordVerb`, `kernel` in `cmdActionVerb`.
- `<rule phrase>` is `issue-scoped rule`, `payload-schema rule`, `issue-scoped and payload-schema rules`, or `run-event schema` when `rules` is absent or empty.
- `<violations>` is `e.violations` joined with `"; "`.
- The whole string then passes through `lineSafe` (below) before it reaches stderr or the note.

Example, for `faff next` run with no issue:

```
capture suppressed: decision-capture event for kernel next refused by the issue-scoped rule: type 'decision-capture' is issue-scoped but missing required field 'issue'
```

Any other append failure (`EVENTS_LOCKED`, an I/O error) keeps the reason `journal append failed: <message>`, also passed through `lineSafe`.

### Line-safe escaping and the length cap

`lineSafe` applies to every reason `bestEffortFail` receives, on every path, and to the note's `kernel` field.

```
PROCEDURE lineSafe(value):
  1. s = String(value)
  2. Replace each maximal run of characters in
       U+0000..U+001F, U+007F..U+009F, U+2028, U+2029
     with one ASCII space
  3. Trim leading and trailing whitespace
  4. IF UTF-8 byte length of s <= 1024: RETURN s
  5. Take the longest prefix of s whose UTF-8 encoding is <= 1010 bytes
     and ends on a code-point boundary
  6. RETURN prefix + "...[truncated]"        # 14 bytes, total <= 1024
```

The stderr line is the existing prefix followed by the line-safe reason and one `\n`. The note's `reason` is the same line-safe string, byte for byte, then serialised by `JSON.stringify` as today.

**Chosen:** collapse control characters to a space and cap in UTF-8 bytes, matching `sanitizeDetail` (`effects-reconcile.js:126-133`), `finding-id.js:14` and `evidence.js:474`. Rationale: the codebase already treats untrusted text bound for logs this way, and nobody needs to reverse the text. A local helper in `decision-capture.js`, not an import of `sanitizeDetail`: that helper's 200-byte bound is too small for a joined list of payload-schema violations (the nine violations `faff events append` lists for an empty `decision-capture` payload join to 474 bytes), it omits the C1 range and U+2028/U+2029, and it adds no truncation marker.

### Marker or note

The ticket asked for a first-write-only run-directory marker `{timestamp, writer, reason}` and said to drop it if it adds nothing the note lacks.

| Property | Run-directory marker | Enriched note |
|---|---|---|
| Reader today | None | None |
| Run-scoped | By location | By its `run` field, already present |
| Writer | `writer` field | `kernel` and `event_type` fields |
| Repeated suppressions in one run | First only | Every one, each with `ts` |
| Anchored to the repo | Never (`mintIssueAnchor`'s allow-list, `test/evidence-payload-writers.test.mjs:191-212`) | Never (`.faff/*` is gitignored) |
| Documented surface | New | Named in `docs/guide/cli.md:184` |
| Escaping and cap rules | A second place to apply them | One place, `bestEffortFail` |

**Chosen:** no marker; enrich the note with `event_type`, `kernel` and `rules`. Rationale: the marker's only addition over the note is a file whose presence can be checked in the run directory, and nothing checks it. The note already carries the run, keeps every occurrence rather than the first, is the documented surface, and keeps the escaping rule in one function. This slice is therefore a reason string, the note fields, and the comment update, as the ticket allowed.

### The write core names its rules

`appendRecordUnderLock` (`events.js:618-640`) already runs the issue-scoped check and then the payload check. It records which of the two produced violations and passes that list to `eventSchemaError`, which sets `e.rules`. `message`, `violations` and `code` are unchanged, so `faff events append` (`events.js:1206-1208`), `corrective.js:381`, `sentry-poller.js:121`, `bundle.js:1054`, `contain.js:186` and `self-intake.js:190` behave as before.

**Chosen:** an additive `rules` property on the existing error. Rationale: the write core is the only code that knows which check fired. Matching the violation text in `decision-capture.js` would couple it to the wording of `issueScopedViolations` and to the schema validator's messages.

## 4. How

### Append sites

All three `appendEventRecord` sites in `decision-capture.js` change their `catch` the same way.

```
PROCEDURE reportAppendFailure(root, run, e, eventType, kernel):
  1. IF e.code == "EVENT_SCHEMA":
     a. rules = e.rules if a non-empty array, else []
     b. reason = suppression reason built from eventType, kernel, rules, e.violations
     c. RETURN bestEffortFail(root, run, reason,
                              { event_type: eventType, kernel: lineSafe(kernel), rules })
  2. ELSE:
     RETURN bestEffortFail(root, run, "journal append failed: " + (e && e.message))
```

- `cmdRecordVerb`: `return reportAppendFailure(root, run, e, "decision-capture", kernel)`.
- `captureDecisionCore`: `reportAppendFailure(root, run, e, "decision-capture", kernel); return;`.
- `cmdActionVerb`: `return reportAppendFailure(root, run, e, "decision-capture-action", kernel)`.

`bestEffortFail(root, run, reason, fields = {})` line-safes `reason`, writes the stderr line, and appends the note with `fields` spread after the existing four keys. It still returns 0 and still swallows a logging fault.

### Catch the refusal, do not pre-check

`captureDecisionCore` resolves `issueVal` at :462 and could test `issueVal === ""` before building the record.

**Chosen:** catch the `EVENT_SCHEMA` throw; add no pre-check. Rationale:

- The write core applies the rule only when the active profile lists the type in `issue_scoped_types`. A pre-check on `issueVal === ""` would suppress a capture that a profile override accepts, which is a second, disagreeing copy of the rule.
- Calling `issueScopedViolations` from `decision-capture.js` would need a second `activeProfile()` resolution and would still duplicate the decision the core makes under its lock.
- One `catch` covers all three sites, including the `record` and `action` verbs, where the issue comes from `--issue`.
- The cost is a chain-head read and a record build before the refusal, both already paid on the success path.

**Anti-pattern:** testing `e.message` or `e.violations[0]` for the text `issue-scoped`. Why: it re-derives the rule from wording the write core owns; `e.rules` exists for this.

### The comment at `decision-capture.js:454-458`

Replace the comment so it states which half of the deferred FAFF-956 call is decided. Suggested text:

```
// FAFF-989: an empty correlation_id yields a base no action marker can join. Note it and still
// append; suppressing that append is the half of the FAFF-956 call that remains deferred.
// The other half is decided: the write core refuses an empty issue (FAFF-1353), and the append's
// catch reports it as a suppressed capture.
```

### Exit codes stay asymmetric

`faff events append` with an issue-scoped type and `issue: ""` exits 1 (`events.js:1206-1208`). `faff decision-capture record --issue ""` and `action --issue ""` exit 0.

**Chosen:** keep the asymmetry and record the reason in `docs/guide/cli.md`. Rationale: `events append` is an operator's write tool, and its exit code is the operator's feedback. `decision-capture record` and `action` are instrumentation that orchestrator prose calls with a templated `--issue <issue>` (`plugin/skills/faff-beep-boop/SKILL.md:217-219`, `plugin/skills/faff-tidy/SKILL.md:271`, `:286`). An empty template value exiting non-zero is the failure BEST-EFFORT-FAIL exists to prevent. After this slice, the stderr line and note name the refusal, which is the information the exit code would have carried. The existing usage error for an absent `--issue` (exit 2, `decision-capture.js:817-818`) is unchanged.

Add one sentence to the `decision-capture` row in `docs/guide/cli.md`, after "always exits 0": an event the write core refuses (an empty `--issue` on the issue-scoped `decision-capture` and `decision-capture-action` types) is a suppressed capture whose note names the event type, kernel and rule; unlike `faff events append`, which exits 1 on the same refusal, capture is instrumentation and never gates.

### Edge cases

| Case | Behaviour |
|---|---|
| Empty `correlation_id` and empty issue, in-kernel | Two stderr lines and two notes, in this order: the existing empty-correlation reason, then the suppression reason |
| `EVENT_SCHEMA` without `rules` (a future caller of `eventSchemaError`) | Rule phrase `run-event schema`; note `rules: []` |
| Both rules fire | Rule phrase `issue-scoped and payload-schema rules`; violations in the error's order |
| `--kernel` contains a newline or tab | Collapsed to a space in the reason and the note's `kernel`; stderr stays one line |
| Reason longer than 1024 bytes | Truncated per `lineSafe`, ending `...[truncated]` |
| Capture gate off | No change: no stderr, no note |

### Failure modes

- **The failure:** a later change adds a third check to `appendRecordUnderLock` without adding a rule name, so its refusals read as `issue-scoped` or `payload-schema`. **How you'd know:** the unit test that every `EVENT_SCHEMA` from the core carries a non-empty `rules` whose members match the checks that produced violations. **What it means:** extend `WriteCoreRule`; the reason format absorbs a new name.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

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

## 6. Design decision rationale

**Marker or note?** A run-directory marker gives a presence check in the run directory; the enriched note keeps every occurrence, is already run-keyed and documented, and keeps one escaping site. Neither has a reader. **Chosen:** enriched note, no marker (section 3).

**Escaping form?** Options: collapse control characters to a space, or escape them as `\uXXXX` (reversible, but a new convention). **Chosen:** collapse to a space with a 1024-byte cap and a truncation marker, following `sanitizeDetail` and `finding-id.js` (section 3).

**Pre-check or catch?** A pre-check on `issueVal === ""` is cheap but disagrees with the profile-keyed rule and duplicates it. **Chosen:** catch `EVENT_SCHEMA` at all three sites (section 4).

**How does decision capture learn the rule?** Options: match violation text, call `issueScopedViolations` again with a resolved profile, or have the write core report it. **Chosen:** `e.rules` set by the write core (section 3).

**Close the exit-code gap?** Options: make `record` and `action` exit non-zero on a refusal, make `--issue ""` a usage error (exit 2), or keep exit 0 and document why. Either non-zero option lets an orchestrator template bug trip a run. **Chosen:** keep exit 0 and document the asymmetry in `docs/guide/cli.md` (section 4).

## 7. Open questions and assumptions

No open questions and no assumptions.

**This build is FAFF-1270's holdout proving run.** FAFF-1270 ("run the evidence-readiness proving runs before enforcement") needs one graft whose spec has a holdout scenario and whose anchor carries `holdout.json`, and FAFF-1270 blocks FAFF-1261. FAFF-1354 is linked as blocking FAFF-1270 so the graph shows that the enforcement chain waits on this graft. Both holdouts drive only the CLI with fixed arguments, environment variables and exact stdout, so a code-blind evaluator can run them; the line-feed case, which needs a control character inside an argument, is a visible scenario instead.

**Chosen:** a holdout or anchor failure traced to the evaluator harness, or to FAFF-1346 (the anchor command can mint a non-conforming anchor and exit 0), is filed against FAFF-1270 or FAFF-1346 and is not counted as a FAFF-1354 defect; the operator decides at merge whether to land FAFF-1354 on the strength of its other checks. Rationale: the proving run exists to find exactly those harness faults, and holding a small, independently tested fix behind them would make FAFF-1270's failure mode this slice's. A holdout failure traced to the feature itself is an ordinary FAFF-1354 defect and is fixed here.

Checked against `abd65009` while drafting: `parseArgs` passes `--issue ""` through as the empty string, so `faff decision-capture record --run run-1 --issue "" --kernel next` reaches the append and is refused today with the generic reason, exit 0.

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

### Integration smoke test

```
1. Build the shared setup from section 5
2. Run `faff next --status todo --spec high` with FAFF_RUN_DIR set,
   FAFF_DECISION_CORRELATION_ID=run-1/x/next/1, FAFF_DECISION_ISSUE unset
3. ASSERT exit 0 and {"next":"graft",...} on stdout
4. ASSERT the last note has rules ["issue-scoped"] and kernel "next"
5. ASSERT `faff events validate --file .faff/runs/run-1/events.jsonl` exits 0
6. ASSERT `faff events verify --run-dir .faff/runs/run-1` exits 0
```

### Size

About a day: one helper, one error property, three `catch` blocks, one comment, one documentation sentence, and tests.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Advisory only; it gates nothing.

### Right-sizing

No issues. The spec's own estimate is about a day: one helper (`lineSafe`), one additive `rules` property on the `EVENT_SCHEMA` error, three `catch` blocks, one comment, one doc sentence, and tests. The `events.js` change goes slightly beyond what the ticket listed, but it is the same concern: the write core names the rule so decision capture never has to guess it. Dropping the marker makes the slice thinner, as the ticket allowed.

### Workstream fit

- **What's there.** The title still reads "...names which rule refused it and leaves a run-directory marker", but the spec drops the marker in favour of enriching the `.faff/logs/decision-capture.jsonl` note.
- **Why it matters.** A merged PR whose ticket promises a marker will look incomplete, and invites a follow-up to "add the missing marker", the duplicate observability the ticket said to drop.
- **What to do.** Retitle FAFF-1354 to the outcome that will ship, for example "A suppressed capture names the event type, kernel and rule that refused it", and record in the description that the marker was dropped in favour of the note.
- **Prep, round 2.** Done during prep: retitled, and the description notes the marker was dropped.

### Dependencies

- **What's there.** The only declared blocker, FAFF-1353, is Done. This build also serves as FAFF-1270's code-blind holdout proving run, but nothing in the tracker links FAFF-1354 to FAFF-1270, and the description says nothing downstream is blocked by this slice.
- **Why it matters.** FAFF-1270 blocks FAFF-1261. The enforcement chain now waits on this graft, but the graph doesn't show it.
- **What to do.** Link FAFF-1354 as blocking FAFF-1270 (or as related, if it is one candidate among several), and correct the "nothing downstream is blocked" line.
- **Prep, round 2.** Done during prep: FAFF-1354 is linked as blocking FAFF-1270, and section 7 records the relationship.

### Risk

- **What's there.** Feature risk is low: the `rules` property is additive and no exit code changes. The risk sits in the second job this build carries, the first real exercise of the code-blind holdout path:
  - The second holdout needs the evaluator to pass a literal line feed inside a `--kernel` argument, which a code-blind judge driving a running env may not be able to express.
  - The run's per-PR anchor is minted while FAFF-1346 (anchor mints a non-conforming anchor and exits 0) is still open.
- **Why it matters.** A harness stumble would stall a small, independently valuable fix and leave FAFF-1270 with a failed proving run of ambiguous cause.
- **What to do.** Before the graft, confirm the evaluator env can pass an argument containing a raw line feed; if not, swap that holdout for a `claim-verdict`-style scenario and keep the line-feed case in the visible integration tests. Agree in advance that a holdout result traced to the harness is filed against FAFF-1270 or FAFF-1346, not held against FAFF-1354's merge.
- **Prep, round 2.** The line-feed holdout is replaced with a plain-CLI `eligible` holdout and moved to a visible scenario, and section 7 records the harness contingency as a decision.

build-tier: complex
spec-review: approve
confidence: high