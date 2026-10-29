# FAFF-1412: The Fly runner fires a paid drain every few minutes that admits nothing

> Spec: faffter-dark-nlspec · 2026-10-28 · interactive · claude-code/unknown · faff 0.43.0 · confidence: high. Full spec on Linear FAFF-1412.

This spec is for the build agent that implements FAFF-1412 and for the humans who review it. It gives the runner's cheap pre-check a way to skip issues that a recent drain already declined and that nobody has touched since. The faff half is built here. The runner half is a separate change in the runner repository, described in Appendix A.

## 1. WHY

**The model this spec turns on:** a drain that declines an issue leaves no trace the pre-check can see. The pre-check reads only the tracker, and a routed-out or claimed-by-peer issue keeps the same labels and state, so the next tick matches it again and starts another full model session. This change makes each drain record what it declined and when, on the runner's state volume. A cheap command then filters the pre-check's hits against those records, with no model call.

**Problem.** Between 18:52Z and 19:52Z on 2026-10-27, `fly-ci-l3-runner` ran 12 drains over the same four issues, each costing 4.7M to 11.5M tokens and admitting nothing. FAFF-1318 was routed out every time as inadmissible (`faff admissible --lights-out`: 0 born-verifiable scenarios). FAFF-1292, FAFF-1207 and FAFF-1205 were In Review with held PRs, skipped as claimed-by-peer, and not recorded in the ledger at all. None of the four changed between drains. Those three PRs (#1146, #1147, #1149) have since merged, so only FAFF-1318 still matches the pre-check.

### Design principles

**The CLI never touches the tracker.** The runner already queries Linear. It hands faff each candidate's id and last-change time; faff reads only local run state.

**Fail open.** This is a cost filter, never a gate on work. Any doubt (a malformed candidate, an unreadable ledger, an unknown time) keeps the candidate, so the worst case is today's behaviour.

**The daily full drain stays the backstop.** The filter applies only to the cheap targeted pass. The once-a-day full drain is never filtered, and a decline expires after a bounded age even if the full drain fails.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/run-ledger.js` (`captureCapability`, `RUN_LEDGER_SURFACE`) | JavaScript | Precedent for an additive locked ledger write; gains `record-declined` |
| `plugin/skills/faff/bin/lib/heartbeat.js` `mutateLedgerUnderLock` | JavaScript | The locked write path, which also folds a `ledger-write` event |
| `plugin/skills/faff/bin/lib/queue-state.js` | JavaScript | Shape precedent for a pure, read-only command over run state |
| `faff run-ledger init-self-drain` (existing, FAFF-966) | JavaScript | Mints an L3 run dir with a ledger; used by the tests and the smoke test |
| `plugin/skills/faff/contracts/evidence-v0.3/schema/run-ledger.schema.json`, `evidence-documents.md` | JSON, Markdown | Closed schema; gains `declined` |
| `plugin/skills/faff/bin/lib/runcheck.js` `auditLedger` | JavaScript | Why `outcomes` cannot hold `claimed-by-peer` (not in `terminal_states`) |
| `plugin/skills/faff-beep-boop/SKILL.md` step 4 | Markdown | Routed-out and claimed-by-peer sites that call the new writer |
| Runner `entrypoint.sh` `eligible_ids()` (separate repository) | Bash | The pre-check that calls the new filter (Appendix A) |

All `bin/lib` paths are under `plugin/skills/faff/`.

**Scope.** This sits between beep-boop's build-queue assembly and the runner's pre-check. It changes no routing, admission or eligibility decision.

## 2. OUT OF SCOPE

The items below that name a separate cause are filed as their own tickets when this spec is attached, each linked from this ticket, unless a ticket for that cause already exists.

- **The runner's `entrypoint.sh` change.** It lives in the runner repository and is tracked as its own ticket, filed at attach and linked from this one, with Appendix A as its spec. FAFF-1412 delivers the faff half; the runner ticket delivers the saving. *Extension point:* `eligible_ids()` and the tick loop, as written up in Appendix A.
- **Fixing FAFF-1318 itself.** Its spec needs a born-verifiable scenario, or a human builds it. The operator chose on 2026-10-28 to leave `faff-automate` on it, so it keeps matching the pre-check, and each tick keeps starting a drain, until the runner change lands. Closing FAFF-1412 does not by itself stop that.
- **Prep promoting a spec that the lights-out admissibility floor will refuse.** Filed separately as discovered scope. *Extension point:* the faff-prep promote step, before Todo, for an automation-eligible issue.
- **`faff next` consulting admissibility.** `faff next` returned `graft` for FAFF-1318 although no build could admit it. Changing kernel inputs is out of scope here. *Extension point:* `nextStep` inputs in `bin/lib/next.js`.
- **The three In Review PRs held at the time.** They were held by the custody-verdict `faff_version` defect the drains reported; all three merged on 2026-10-28.
- **Filtering the full drain.** The daily full drain re-evaluates everything by design.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| Decline | A drain considered an issue and did not admit it: routed out (any reason) or claimed by a peer |
| Decline record | `ledger.declined[issue] = { reason, at, recorded_at }`, written by `faff run-ledger record-declined` |
| `changed_at` | The candidate's last tracker change time, supplied by the caller |
| Window | Runs that started no more than `--max-age-hours` ago |

### Commands

```
faff run-ledger record-declined --issue <ISSUE-ID> --reason <TEXT> --observed-at <ISO> [--run-dir DIR] [--root DIR] [--json]
faff drain-filter [--runs-dir DIR] [--root DIR] [--max-age-hours N] [--now ISO] [--json]   # stdin: candidates
```

### Types

```
RECORD DeclineRecord:                 # ledger.declined[issue]
  reason: String                      # non-empty, one line, at most 200 characters, e.g. "inadmissible:0 born-verifiable scenario(s)" or "claimed-by-peer:bundle TAMPERED"
  at: ISO-8601 UTC String             # --observed-at: when the drain read the issue it then declined
  recorded_at: ISO-8601 UTC String    # stamped by the CLI at write time; audit only, never compared

RECORD Candidate:                     # drain-filter stdin is a JSON array of these
  issue: String                       # must match the ledger issue id grammar
  changed_at: ISO-8601 String | null  # null or unparseable means "unknown", which keeps the candidate

RECORD FilterResult:                  # --json stdout
  kept: [String]                      # input order preserved
  suppressed: [{ issue, run_id, reason, declined_at, changed_at }]
  degraded: String | null             # set when any fail-open rule fired, e.g. "unreadable-ledger:<run_id>"; several causes join with "; "
  window_hours: Number
```

Without `--json`, stdout is the kept ids joined by single spaces, then a newline (an empty line when nothing is kept).

`record-declined` prints `recorded <ISSUE> declined in <run-dir>` by default. With `--json` it prints one line: `{"recorded": true, "run_id", "run_dir", "issue", "declined": {reason, at}, "ledger_sha256_before", "ledger_sha256_after"}`, mirroring `record-outcome --json`.

**Flag validity.** `--max-age-hours` is an integer from 1 to 168; `--now` must parse as ISO-8601. Anything else is exit 2.

**Exit codes.** `record-declined`: 0 written; 2 bad `--issue` or `--reason`; 3 no run dir with a `run-ledger.json` resolved, or the locked write failed. `drain-filter`: 0 on any well-formed input (including all kept or all suppressed); 2 when stdin is not a JSON array of objects, or a flag is unknown or invalid.

### Design decisions

**Where the fix lives.** **Chosen:** a faff command the runner calls, fed by a ledger record each drain writes. Parking declined issues would change the tracker for a skip that is not a failure, and it cannot apply to a claimed-by-peer issue that a peer may genuinely be building. A runner-only jq filter over ledgers would copy faff's ledger semantics into another repository.

**Where the decline is recorded.** **Chosen:** a new `declined` ledger map with a documented writer. `outcomes` cannot hold `claimed-by-peer`, because runcheck rejects values outside `terminal_states`. `outcome_details` is documented as never read by a gate.

**What counts as a change.** **Chosen:** the caller's `changed_at` is later than the decline's `at`. faff cannot read the tracker, and the runner already has the issue in hand.

## 4. HOW

### 4.1 `faff run-ledger record-declined`

Mirrors `capture-capability`: same run-dir resolution (`--run-dir`, then `$FAFF_RUN_DIR`, then the newest run under the root), same lock, and the mutate closure omits `level`. It sets `declined[issue] = { reason, at: <--observed-at, normalised to UTC>, recorded_at: now }`, overwriting an earlier record for the same issue in the same run, and leaves every other field untouched. It does not require the issue to be in `admitted`. The `ledger-write` event the lock folds is the existing run-scoped event (`phase: "run"`, no issue field), exactly as for `record-outcome` and `capture-capability`; per-issue attribution lives in the `declined` entry itself, keyed by issue, so the write produces no unattributable issue-scoped row. `--reason` has every control character (U+0000 to U+001F, including CR, LF and tab, and U+007F) replaced by a space, runs of spaces collapsed, and is trimmed; empty, or longer than 200 characters after that, is exit 2. `--observed-at` must parse as ISO-8601. Any past time is accepted, however long ago; a time more than 60 seconds in the future (beyond clock tolerance) is exit 2.

**Why the observation time, not the write time.** A human change that lands after the drain read the issue but before it wrote the decline must keep the issue. Anchoring on the read time does that. The cost is the opposite race: a beep-boop tracker write for the issue after the read would keep it every tick, which only costs money (the fail-open direction).

### 4.2 `faff drain-filter`

```
PROCEDURE drain_filter(candidates, runs_dir, max_age_hours = 24, now):
  0. Parse stdin; not an array of objects -> exit 2. Drop no entry: a candidate with a bad
     issue id is kept and listed in degraded ("bad-candidate:<index>").
  1. runs_dir := --runs-dir, else <root>/.faff/runs. Read entries following symlinks.
     Missing runs_dir -> keep all, degraded "no-runs-dir", exit 0.
  2. For each run dir: start := time parsed from the name run-YYYYMMDD-HHMMSS-*,
     else ledger.owner.started_at, else the run dir's own modification time (always
     available, so every run ages out). Skip runs with start older than now - max_age_hours.
  3. Read run-ledger.json for every run left. A run whose ledger is unreadable or malformed
     is skipped and added to degraded ("unreadable-ledger:<run>"). Its start time from step 2
     is kept as an unreadable marker, so it ages out of the window like any other run.
  4. For each candidate c, find the newest readable run (by start) whose ledger mentions
     c.issue in admitted, outcomes or declined.
       a. No such run -> keep.
       a2. An unreadable run started after that run -> keep, because it may have admitted
           the issue.
       b. c.issue in that run's admitted -> keep (the newest run built it).
       c. Else if declined[c.issue] exists:
            keep IF c.changed_at is unknown OR c.changed_at > declined.at
            ELSE suppress, recording run_id, reason, declined_at, changed_at.
       d. Else (mentioned only in outcomes, e.g. routed-out without a decline record) -> keep.
  5. Print the result. Exit 0.
```

Notes:

- `--now` exists for tests; the default is the current time.
- Times compare as instants, so `2026-10-27T19:52:10Z` and `2026-10-27T19:52:10.000Z` are equal.
- The command writes nothing and makes no network call.

**Anti-pattern:** treating a routed-out `outcomes` entry with no `declined` record as a decline (step 4d). Why: ledgers written before this change carry no `at`, and the run's start time precedes any tracker write the run made, so suppressing on it could hide a human change made during the run.

**Anti-pattern:** filtering out a candidate because the filter itself failed. Why: the filter is a cost saving; a failure must cost money, never block work.

### 4.3 beep-boop prose (`faff-beep-boop/SKILL.md`)

- **Observation time:** capture `observed_at=$(date -u +%FT%TZ)` immediately before the at-assembly tracker read of each candidate (the claim-before-admit re-read), and pass it as `--observed-at` to every `record-declined` call for that candidate.
- **Claim-before-admit (claimed-by-peer):** after giving a candidate the `claimed-by-peer` disposition, run `faff run-ledger record-declined --issue <ID> --reason "claimed-by-peer:<cause>"`, including the endgame-admission fall-throughs.
- **Admissibility filter and other routed-out dispositions:** after recording the `routed-out` outcome, run `record-declined` with the disposition as the reason.
- A non-zero `record-declined` exit is logged in the run log and never stops the drain or changes the candidate's disposition; the only effect is that the next tick keeps the candidate.
- In both places, beep-boop makes no tracker write for a declined issue after the observation; today neither disposition writes to the tracker.
- **Run ledger field list:** one bullet for `declined`.
- **First drain after the change:** ledgers written before this change carry no `declined` records, so the first drain after deployment still runs and declines once; from then on its records apply.
- Fold the edits into existing sentences where possible. Any growth raises `SKILL_LINE_BASELINE["faff-beep-boop"]` to the exact new size, with a `FAFF-1412 +N` note in house style.

### 4.4 Registration, schema and docs

- **`bin/faff` `COMMANDS`:** `"drain-filter": cmdDrainFilter` via `lazy()`.
- **Regions:** the new module `bin/lib/drain-filter.js` is region `factory`, with the banner `// === region:factory — drain-filter — FAFF-1412: <summary> ===`. Also add `REGION_MAP` `"drain-filter": "factory"` and `REGION_SELFTEST_ARGV` `"drain-filter": null`.
- **No new `--selftest` blocks** (operator decision, 2026-10-28). Neither `drain-filter.js` nor the `record-declined` code in `run-ledger.js` adds selftest cases; tests live under `test/`. Declare `"drain-filter": "test/drain-filter.test.mjs"` in `TEST_FILE_COVERAGE` in `bin/lib/lint-cli-coverage.js`. `run-ledger` keeps its existing selftest; the build may move any case it changes into `test/` but adds none.
- **`RUN_LEDGER_SURFACE` and `USAGE` in `run-ledger.js`:** gain `record-declined` (required flags `--issue`, `--reason`).
- **`run-ledger.schema.json`:** gains `declined` as an object whose values are closed objects, each with string properties `reason` and `at` (both required) and `recorded_at` (optional, always written by `record-declined`). `evidence-documents.md` lists `declined` among the issue-keyed maps, and names `record-declined` as its writer.
- **Writer inventory:** register the new writer wherever `test/run-ledger-writer-inventory.test.mjs` requires it.
- **`docs/guide/cli.md`:** one row for `drain-filter` and one row for `run-ledger record-declined`.

### 4.5 Edge cases

Each case below is a required test case (see 7).

- **The same issue is declined twice in one run** (for example in two waves): the later record wins.
- **The issue is declined in wave 1 and admitted in wave 2 of the same run:** step 4b keeps it, because `admitted` wins inside a run.
- **Two runs share a start second:** order them by the run dir name, which is unique.
- **A crashed run with `owner.status` still `running`:** its decline records count, because they were written before the crash.
- **Clock skew between Linear and the runner:** a `changed_at` slightly later than true keeps the candidate, which is the safe direction. A `changed_at` earlier than true could hide a change for at most `max_age_hours`.

### 4.6 Failure modes

| The failure | How you'd know | What it means |
|---|---|---|
| beep-boop writes to the tracker for a declined issue after its observation (for example a comment) | The runner log shows the same issue kept on every tick, with `changed_at` just after `declined_at` | The rule in 4.3 was not followed; fix the call site. The cost is today's behaviour, never lost work |
| A drain writes a decline for an issue it never considered (a defect, or a drain steered by issue content) | `suppressed` names an issue absent from that run's summary | Accepted risk: the effect is a delay of at most `--max-age-hours` on the cheap pass, never lost work, and the daily full drain still runs. The ledger is already agent-writable under a shared uid (`faff corrective-integrity`), so binding the record to run contents would not stop a forger |
| The cage image cannot run a bare command | Appendix A's one-off check fails: the command starts a model session or does not find `faff` | Install Node and run the faff CLI from the outer container instead (Appendix A step 2); the faff half is unchanged |
| The runner supplies `updatedAt` only, and Linear does not advance it when a comment is added | A human's resolving comment does not trigger a drain until the decline expires or the daily full drain runs | Appendix A tells the runner to fold the newest comment time into `changed_at`; this is runner-side |
| The cage's cached faff is older than this change | `drain-filter` fails with an unknown command; the runner falls back to the unfiltered list | Expected until the image refreshes the plugin; Appendix A makes the fallback explicit |

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a runs dir holding one ledger, run-20261027-185215-beepboop-list-1456d4, with declined {"FAFF-1318": {"reason": "inadmissible:0 born-verifiable scenario(s)", "at": "2026-10-27T18:56:00Z"}} and admitted []
When  faff drain-filter --runs-dir <dir> --now 2026-10-27T19:00:00Z --json runs with stdin [{"issue":"FAFF-1318","changed_at":"2026-10-27T07:31:53Z"},{"issue":"FAFF-9","changed_at":"2026-10-27T07:00:00Z"}]
Then  kept is ["FAFF-9"]
And   suppressed has one entry with issue "FAFF-1318", run_id "run-20261027-185215-beepboop-list-1456d4" and declined_at "2026-10-27T18:56:00Z"
And   the exit code is 0
```

```
Given the same runs dir
When  faff drain-filter --runs-dir <dir> --now 2026-10-27T19:00:00Z runs with stdin [{"issue":"FAFF-1318","changed_at":"2026-10-27T18:58:00Z"}]
Then  stdout is "FAFF-1318" followed by a newline, because the issue changed after the decline
```

```
Given a runs dir with the same declined FAFF-1318 ledger, plus a later run directory, run-20261027-185806-beepboop-list-620a46, whose run-ledger.json is not valid JSON
When  faff drain-filter --runs-dir <dir> --now 2026-10-27T19:00:00Z --json runs with stdin [{"issue":"FAFF-1318","changed_at":"2026-10-27T07:31:53Z"}]
Then  kept is ["FAFF-1318"], suppressed is empty, degraded contains "unreadable-ledger:run-20261027-185806-beepboop-list-620a46", and the exit code is 0
```

```
Given a run dir whose run-ledger.json has admitted [] and no declined map
When  faff run-ledger record-declined --issue FAFF-1292 --reason "claimed-by-peer:bundle-recover refused" --observed-at 2026-10-27T18:53:00Z --run-dir <dir> --json runs
Then  the exit code is 0, and stdout is one JSON object with recorded true, issue "FAFF-1292" and declined.reason "claimed-by-peer:bundle-recover refused"
And   the ledger's declined["FAFF-1292"].reason is "claimed-by-peer:bundle-recover refused" and declined["FAFF-1292"].at is "2026-10-27T18:53:00.000Z" and declined["FAFF-1292"].recorded_at is a valid ISO-8601 time
And   faff runcheck --json <dir> reports the ledger clean
```

- `faff drain-filter` makes no network call and writes no file.

## 5. DESIGN DECISION RATIONALE

**Where should the fix live?**
- A runner-side log of the ids fed to each drain, suppressing them until they change: no faff change at all, but "fed" is not "declined". A drain that timed out, hit its budget, or was aborted by the sentry before reaching an issue would suppress that issue for a day without ever having considered it. Only the drain knows what it actually declined.
- Exclude In Progress and In Review (Linear `started`) from the pre-check: would have removed the three then-held PRs from this incident with a one-line runner change, but it is deliberate that they match. The runner's own comment on `eligible_ids()` keeps `started` so that a held or orphaned build is picked up and resumed, and beep-boop's endgame-only admission (FAFF-842) drives a stranded In Review PR to merged from exactly this path. Excluding them would leave a stranded PR to the daily full drain, and would not help FAFF-1318, which is in Todo.
- Park declined issues (`faff-parked`): fixes the pre-check with no runner change, but turns a skip into a park, adds tracker noise, and is wrong for a claimed-by-peer issue.
- A runner-only filter in jq: no faff change, but it duplicates ledger semantics in another repository and breaks silently when the ledger changes.
- A faff command plus a ledger record: needs a small runner change, but keeps the semantics in faff, testable and versioned.
- **Chosen:** a faff command plus a ledger record.

**Where is the decline recorded?**
- `outcomes`: rejected, because runcheck treats `claimed-by-peer` as an invalid outcome.
- `outcome_details`: rejected, because it is documented as never read by a gate.
- The observed-only `claimed_by_peer` key: rejected, because it has no timestamp and covers only one of the two dispositions.
- **Chosen:** a new `declined` map with a documented writer.

**How is "changed since" decided?**
- **Chosen:** the caller's `changed_at` against the decline's `at`, which is the time the drain read the issue (`--observed-at`). The CLI write time would hide a human change made between that read and the write. The run's start time is earlier still, but is not per issue. The `run-end` time would hide any human change made during the run.

**How long does a decline hold?**
- **Chosen:** 24 hours by default (`--max-age-hours`). That matches the full-drain cadence and caps the damage of a wrong `changed_at`.

**What is the command called?**
- **Chosen:** `faff drain-filter`. It names what it does for its one caller.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

**Assumes:** the runner repository's maintainer applies Appendix A, including its one-off check that the cage image runs `faff drain-filter` without a model session, tracked by the linked runner ticket, so the runner calls `faff drain-filter` with each candidate's `changed_at`. *Validation:* before closing FAFF-1412, check that the runner ticket exists and is linked. The faff half ships and is testable without the runner change, and until that change lands the runner behaves exactly as today. The cost stops only when the runner ticket is done.

## 7. DONE

### From WHY
- [ ] A drain that routes out or claims-by-peer an issue leaves a `declined` record whose `at` is the drain's observation time for that issue, and whose `recorded_at` is CLI-stamped.
- [ ] Fed the 2026-10-27 shape (one declined FAFF-1318 record, unchanged since), `faff drain-filter` suppresses it; fed a later `changed_at`, it keeps it.

### From WHAT (commands and types)
- [ ] `faff run-ledger record-declined` validates `--issue` and `--reason` as in 3 and 4.1, and returns exit codes 0, 2 and 3 as listed in 3.
- [ ] `record-declined --json` prints the one-line object defined in 3, and the default output is the `recorded … declined in …` line.
- [ ] `faff drain-filter` reads a JSON array of `{issue, changed_at}` on stdin, prints space-separated kept ids by default and `FilterResult` with `--json`, and exits 2 on non-array stdin or an unknown flag.
- [ ] `run-ledger.schema.json` declares `declined`, closed, with required string `reason` and `at` and optional string `recorded_at`, as 4.4 says; the closed-schema test still passes, and a ledger written by `record-declined` validates against the schema with `contracts/validate-schema.mjs`.

### From HOW (behaviour)
- [ ] Within one run, an issue in `admitted` is never suppressed, even with a decline record.
- [ ] The newest run in the window that mentions the issue decides; runs older than `--max-age-hours` are ignored.
- [ ] A routed-out `outcomes` entry with no `declined` record keeps the candidate.
- [ ] An unreadable ledger is skipped and named in `degraded`, and keeps only the candidates whose deciding run is older than it; a missing runs dir or an unknown `changed_at` keeps candidates, as 4.2 says.
- [ ] A symlinked runs dir is read through the link.
- [ ] `record-declined` leaves `admitted`, `outcomes`, `owner`, `level` and `budget` unchanged, and the run's events chain still verifies after the write.

### From HOW (prose, registration, docs)
- [ ] `faff-beep-boop/SKILL.md` says a failed `record-declined` is logged and never stops the drain.
- [ ] `faff-beep-boop/SKILL.md` calls `record-declined` at the claimed-by-peer and routed-out sites as the last write for that issue, and lists `declined` in the run-ledger fields.
- [ ] `SKILL_LINE_BASELINE["faff-beep-boop"]` equals the file's new size, and `faff validate-adapters` reports no FAIL.
- [ ] `faff regions check` passes with `drain-filter.js` carrying its `region:factory` banner and `REGION_SELFTEST_ARGV["drain-filter"]` set to `null`.
- [ ] `TEST_FILE_COVERAGE` declares `"drain-filter": "test/drain-filter.test.mjs"`, and the diff adds no `--selftest` case anywhere.
- [ ] `faff lint-cli-doc` and `faff lint-cli-coverage` pass with the two new `docs/guide/cli.md` rows.
- [ ] `evidence-documents.md` names `declined` and its writer.

### Tests
- [ ] `test/drain-filter.test.mjs` exists, runs under `node --test`, and passes, covering each step of 4.2 against `mkdtempSync` fixtures.
- [ ] The same file has one named case per 4.5 edge case: a double decline in one run keeps the later record; a wave-1 decline followed by a wave-2 admission in the same run keeps the candidate; two runs with the same start second are ordered by run dir name; a crashed run's decline suppresses; an unreadable run newer than the deciding decline keeps the candidate, while an unreadable run older than it does not; and a `changed_at` one second after `at` keeps the candidate while one equal to `at` suppresses it (the clock-skew boundary).
- [ ] Exit-code cases are tested: `record-declined` exits 2 on a bad `--issue`, an empty or over-long `--reason`, and an `--observed-at` more than 60 seconds in the future, accepts an `--observed-at` hours in the past, and exits 3 with no resolvable run dir; `drain-filter` exits 2 on stdin `{}`, on stdin `[1,2]` and on an unknown flag.
- [ ] A candidate with a malformed issue id (for example `{"issue":"../x","changed_at":null}` at index 1) is kept, in input order, and `degraded` contains `bad-candidate:1`.
- [ ] `drain-filter` exits 2 on `--max-age-hours 0`, `--max-age-hours 169`, `--max-age-hours x` and `--now yesterday`.
- [ ] A `reason` containing CR, LF and tab is stored with each replaced by a space.
- [ ] A `record-declined` test file (or cases in an existing `test/run-ledger-*.test.mjs`) passes, and `test/run-ledger-writer-inventory.test.mjs` passes with the new writer registered.

### Integration smoke test

```
PROCEDURE smoke():
  1. tmp root; faff run-ledger init-self-drain --root tmp      # mints a run id from the current time
  2. faff run-ledger record-declined --issue FAFF-1318 --reason "inadmissible:test" --observed-at <now> --run-dir <that run>   -> exit 0
  3. echo '[{"issue":"FAFF-1318","changed_at":"2026-10-27T07:31:53Z"}]' | faff drain-filter --root tmp --now <now + 1 min>
                                                                                                  -> empty line, exit 0
```

## Appendix A: runner repository change (for the runner maintainer)

1. **Query.** Add `updatedAt` and `comments(last: 1) { nodes { createdAt } }` to the `eligible_ids()` node selection. Set `changed_at` to the later of the two.
2. **Filter.** Pipe `[{issue, changed_at}]` for the hits into `faff drain-filter --runs-dir /home/faff/state/runs --json`. Run it in the cage image with the `faff-state` volume mounted and the image's entrypoint overridden, for example `docker run --rm -i --entrypoint sh -v faff-state:/home/faff/state <cage-image> -c 'claude plugin update faff@faff >/dev/null 2>&1; faff drain-filter …'`. `claude plugin update` and `faff` are plain commands and start no model session. The run directories live on the volume: `drain.sh` runs `ln -sfn /home/faff/state/runs /home/faff/app/.faff/runs`, so the real directories are at `/home/faff/state/runs` in the cage and `/var/lib/docker/volumes/faff-state/_data/runs` on the host. **Check this once on the runner before relying on it:** the command must print a `FilterResult` whose `degraded` is `null`, after at least one drain has written a `declined` record, and must start no `claude -p`. A `no-runs-dir` result means the path is wrong. If the image cannot run it, install Node in the outer image and run the faff CLI there against `/var/lib/docker/volumes/faff-state/_data/runs`.
3. **Fallback.** On any non-zero exit or unparseable output, use the unfiltered hits, as today, and log `pre-check: filter unavailable`.
4. **Log.** Each tick logs the kept ids, each suppressed id with its `run_id` and reason, and any `degraded` value (a `no-runs-dir` value is a deployment fault and is logged as a warning), for example `pre-check: eligible -> FAFF-9; suppressed (declined, unchanged) -> FAFF-1318 (run-...: inadmissible:...)`. After a drain, log the admitted count from the resolved run dir's ledger, with the issue ids the drain was given when that count is zero.
5. **Cleanup.** Drop `faff-automation-hold` from the label exclusion. That label was retired by FAFF-1097, so excluding it is harmless but misleading.

confidence: high
build-tier: complex
spec-review: accept (human, after round 12)

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized:** no issues. One read-only module, one additive `run-ledger` subcommand, one schema field and a few lines of beep-boop prose, about one to two days. The writer and the filter always ship together, because the filter has nothing to read without the writer, so they stay one unit.
- **Workstream fit:** no issues. Project-less Backlog, alongside the other runner-cost and drain-reliability work found during the FAFF-974 collection.
- **Deps surfaced:** the saving needs the runner-repository change in Appendix A, which this tracker cannot block on. Recommend recording it as a runner-repository issue, linked from this ticket. Prep promoting a spec the admissibility floor refuses is a separate cause and is filed as its own ticket. The held In Review PRs have since merged.
- **Risk profile:** low technical risk, because the filter fails open. The value risk is timing: nothing is saved until the runner calls the filter, and FAFF-1318 keeps the loop going until then, because the operator kept `faff-automate` on it.
