# FAFF-1405: faff gates run --budget-secs N --resume: let a lane poll a long gate run across foreground calls

> Spec: faffter-dark-nlspec · 2026-10-28 · interactive · claude-code/unknown · faff 0.43.0 · confidence: high. Full spec on Linear FAFF-1405.

This spec is for the build agent that implements FAFF-1405 and for the humans who review it. It gives `faff gates run` a wall-clock budget and a resume mode, so a build lane can finish a long gate run in several foreground calls instead of one call that outlasts the 10-minute tool cap. It follows the last action in `verification/audits/2026-10-22-repo-review-throughput-cull-split.md` §1.3.

## 1. WHY

**The model this spec turns on:** the gate ladder is a list of independent units of work, and a unit's result stays true for as long as the tree it ran on is unchanged, where "the tree" is what git sees: tracked and untracked files, not ignored ones. So a call can stop when its budget runs out, write down which units passed on which tree, and the next call can skip them. A unit is a whole rung, or one file of the file-pool UNIT rung, or one shard of a sharded rung. The tree fingerprint is what makes skipping safe: any change git can see throws the saved progress away.

**Problem.** A build lane runs commands in the foreground under a 10-minute cap, and a full gate run can outlast it on a cold or loaded host. When it does, the lane stalls with nothing to show: FAFF-1356's first build agent sat for 40 minutes before the sentry tripped (orchestrator defect 3 in run `run-20261020-191739-beepboop-list-d57076`). Graft's prose tells the agent to "chunk" the run, but the CLI has no way to do it, and backgrounding the gate is forbidden.

### Design principles

**A result is never reported for a tree it did not run on.** Saved progress carries a fingerprint of the tree content and of the gate plan. A call whose fingerprint differs discards the progress and starts the ladder from the first rung.

**Progress is short-lived.** A unit's result can also depend on state outside the tree: a local service, the host's load, the clock. Progress older than one hour is discarded as `stale`. Within that hour a resumed run carries the same exposure as one long uninterrupted run, whose first rung's result is also minutes old when its last rung finishes; the hour only stops it growing without bound.

**Every call records at least one unit, and no call outlives its ceiling.** A call that has finished no unit when its budget runs out lets its in-flight units run on to a hard ceiling. A unit still running at the ceiling is cut and recorded as `errored` with reason `exceeds-call-budget`, which the ladder already reads as needs-human. So a resume loop always ends, and a unit that cannot finish inside one call is reported instead of re-run forever.

**The contract does not change.** A finished resumed run prints the same `faff-contract:quality-gates` block, with the same `{signal, rungs}` shape, as an uninterrupted run. An incomplete call prints no contract block at all, so nothing downstream can read it as a verdict.

**Today's behaviour is the default.** With neither new flag, `faff gates run` runs exactly as it does now: no budget, no progress file, the same exits.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `bin/lib/gates-cli.js` (`cmdGates`, `gatesSelftest`) | JavaScript | Gains the two flags and the exit-3 output; its selftest gains no cases |
| `bin/lib/gates-select.js` (`runLadder`) | JavaScript | The ladder loop; gains an optional budget and progress argument |
| `bin/lib/gates-exec.js` (`runRung`, `runFilePoolRung`, `runShardedRung`, `spawnAsync`) | JavaScript | Unit execution; gains a stop signal and per-unit results |
| `bin/lib/gates-config.js` (`readGatesConfig`) | JavaScript | Gains `gates.run_budget_secs` |
| `bin/lib/build-judge-evidence.js` (`--budget-secs`, exit 3) | JavaScript | The idiom this copies: budget flag, config key, exit 3 means "call me again" |
| `bin/lib/leaf-read.js` (`readLeafNoFollow`, FAFF-1400) | JavaScript | Reads the progress file without following a symlink |
| `bin/lib/merge-gate-local.js`, `post-merge-check` | JavaScript | Call `runLadder` / `runRung` directly; they stay fresh, unbudgeted runs |
| `plugin/skills/faff-graft/SKILL.md` Step 7.5 (line 344 on) and the foreground-posture paragraph (line 349) | Markdown | The "chunked or polled" sentence becomes the re-invoke loop |
| `bin/lib/validate-adapters.js` line 65 | JavaScript | `SKILL_LINE_BASELINE["faff-graft"]` |

All `bin/lib` paths are under `plugin/skills/faff/`. Line numbers are on `origin/main` at 8f35ba88.

**Scope.** One CLI capability on the gate ladder and the graft prose that uses it. It is not one of the §1.4 prose-to-command collapses.

## 2. OUT OF SCOPE

- **Resuming inside `faff merge-gate --local` or `post-merge-check`.** Both run a fresh ladder as their own CI-equivalent, and a merge floor must never read progress a lane could have written. *Extension point:* the `runLadder` options argument this spec adds; neither caller passes it.
- **Cutting a unit mid-run and resuming it part-way.** A cut unit is discarded and re-run from its start. *Extension point:* none needed; Node's test runner has no resume.
- **Splitting a long single-command rung** (for example a `make test` that is not shard-capable) into units. It stays one unit. If it cannot finish inside one call's ceiling it is recorded `errored` with reason `exceeds-call-budget` and the run ends `needs-human`. *Extension point:* `shardCapable` in `gates-exec.js`.
- **A lock against two gate runs in the same worktree at once.** Two concurrent runs already collide on test temp state today; this spec adds nothing for that case. *Extension point:* the progress writer in `gates-progress.js`.
- **The `gates` slot.** A custom runner configured in `slots.gates` owns its own chunking. The prose loop applies to the default graft-step only.
- **Changing `rung_timeout_ms` or the file-pool width.** Unchanged.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Unit | The smallest piece of the ladder that runs as one process: a whole rung that is neither file-pooled nor sharded, one file of a file-pool rung, or one shard of a sharded rung. |
| Budget | Seconds of wall clock one call may spend starting units. |
| Cut | Stopping an in-flight unit at the budget or the ceiling. A cut in a call that has already finished a unit is thrown away, never recorded; a cut at the ceiling is recorded as `errored`, reason `exceeds-call-budget`. |
| Call clock | Starts when the call's first unit starts, after the fingerprints and the progress read. The budget and the ceiling are measured on it, so setup time never eats into a unit's slice. |
| Ceiling | budget + grace on the call clock, where grace is the smaller of 60 seconds and the budget. No call runs units past it. |
| Finished by this call | A unit this call started and recorded. A result reused from progress is never finished by this call. |
| Progress | The record of finished units, written when a call ends incomplete. |
| Tree fingerprint | sha256 over `HEAD`'s tree id and the path, mode and content id of every file that differs from it, tracked or untracked, with ignored files and `.faff/` left out. Computed without writing to the object store or the index. |
| Plan fingerprint | sha256 over the ordered runnable rung list (kind, name, command, required, cwd), each rung's ordered unit list with each pool file's content id, and the resolved `readGatesConfig` object without `run_budget_secs`. |

### Command

```
faff gates run [--json] [--root DIR] [--budget-secs N] [--resume]
faff gates run --clear-progress [--root DIR]
```

- `--budget-secs N`: an integer from 1 to 480. Anything else exits 2, naming the range. 480 is the largest budget whose ceiling (540 seconds) stays under the 600-second tool cap with room for setup and output.
- `gates.run_budget_secs` above 480 is clamped to 480, with one stderr line naming the key and the clamp; absent, non-numeric or below 1 gives the default.
- `--clear-progress`: delete `.faff/gates/run-progress.json` and its temporary files, run nothing, exit 0. Combined with any other flag but `--root`, exit 2.
- `--resume`: continue from saved progress when it matches this tree and plan; otherwise start from the first rung.

**Chosen:** the budget comes from `--budget-secs`; failing that, when `--resume` is given, from `gates.run_budget_secs` (default 420); with neither flag there is no budget. A lane's loop passes `--resume` alone and is tunable through config, and the no-flag run is today's run. The margin is measured from the ceiling, since the no-progress call is the long one: 420 gives a ceiling of 480 seconds, which leaves 120 seconds under the 600-second tool cap for the tree fingerprint, the cut and the output.

### Types

```
RECORD GatesProgress:                      # <root>/.faff/gates/run-progress.json, mode 0600
  schema: 1
  tree: Hex64                              # tree fingerprint at the start of the call that wrote it
  written_at: Timestamp                    # when it was written; older than 3600 s is stale
  plan: Hex64                              # plan fingerprint
  calls: Int                               # calls that have contributed, >= 1
  done: List<UnitResult>                   # in ladder order
  rung_ms: Map<rung_index, Int>            # wall time each rung has used so far, summed across calls

RECORD UnitResult:
  rung_index: Int                          # position in the runnable rung list
  unit: "whole" | "file:<path>" | "shard:<i>/<n>"
  status: "pass" | "fail" | "errored"
  reason?: String                          # as classifyRungResult gives it, for example "timed-out"
  duration_ms: Int
  detail: String                           # empty for pass; for fail and errored, the 500-character tail
                                           # classifyRungResult keeps, after secret redaction (4.3)
  ceiling_secs?: Int                       # only on reason "exceeds-call-budget": the ceiling it was cut at

RECORD GatesIncomplete:                    # stdout under --json on exit 3; no "signal", no "contract"
  status: "incomplete"
  budget_secs: Int
  units_done: Int                          # recorded units of any status (pass, fail, errored, including
                                           # exceeds-call-budget) across all calls on this tree and plan
  units_total: Int
  progress: Path
  discarded?: "tree-changed" | "plan-changed" | "stale" | "unreadable"   # set when this call threw progress away
```

Without `--json`, exit 3 prints exactly one line, `gate ladder: incomplete (budget <N>s): <units_done> of <units_total> units done; run again with --resume`, preceded by `progress discarded: <reason>` when `discarded` is set, and nothing else.

A finished run keeps today's `GatesOutcome` JSON and adds one field, `resumed: { calls: Int, discarded?: String }`, only when `--resume` or `--budget-secs` was given. `calls` counts the calls that contributed to this result, this one included, so it is 1 after a discard. `discarded` is set exactly when this call threw progress away at step 4, with the same value `GatesIncomplete.discarded` would carry, and is absent otherwise. Both outputs also carry `setup_ms`, the time from call start to the call clock's start.

**Chosen:** exit 3 for incomplete, exits 0 and 1 as today when the ladder finishes, exit 2 for usage errors. This is `build-judge-evidence`'s convention.

## 4. HOW

### 4.1 The budgeted ladder

**Summary:** run the ladder as today, but before starting each unit check the budget, skip units already in matching progress, and when the budget runs out save what finished and exit 3.

```
PROCEDURE gates_run(root, budget_secs?, resume):
  1. IF budget_secs is null AND NOT resume: runLadder(root) exactly as today. RETURN.
  2. IF root is not inside a git work tree: usage error, exit 2,
     "--budget-secs and --resume need a git work tree".
  3. tree := tree_fingerprint(root); plan := plan_fingerprint(root)
  4. prior := null
     IF resume AND <root>/.faff/gates/run-progress.json exists:
       read it with readLeafNoFollow; parse; validate the GatesProgress shape
       unreadable or invalid       -> discarded := "unreadable"
       prior.tree != tree          -> discarded := "tree-changed"
       prior.plan != plan          -> discarded := "plan-changed"
       now - prior.written_at > 3600 s -> discarded := "stale"
       otherwise                   -> prior is kept
     A discarded file is deleted before any unit runs.
  5. Walk the runnable rungs in order. For each rung, list its units. For each unit:
       a. IF prior holds a result for (rung_index, unit): reuse it; do not run it. Exception: an errored
          result with reason "exceeds-call-budget" is reused only when its recorded ceiling_secs is at
          least this call's ceiling; otherwise the unit runs again, so raising the budget retries it.
       b. ELSE IF the budget is spent AND this call has already started a unit: stop dispatching (go to 6).
          (The first unit a call needs to run is always started, even past the budget.)
       c. ELSE start it.
     Each time a unit's result is recorded, progress is rewritten (as in 6b), so a call killed from
     outside loses only its in-flight units.
     When every unit of a rung has a result, aggregate them exactly as today
     (aggregateFileResults, aggregateShardResults, or the single result) and apply today's
     ladder rules: an errored rung sets needs-human and the ladder continues; a required rung
     that fails ends the ladder with signal fail.
  6. On budget expiry with units still to run:
       a. IF at least one unit has been finished by this call (reused results do not count): cut every
          in-flight unit and discard its result.
          ELSE let the in-flight units run on to the ceiling (budget + min(60 s, budget)); record each
          that finishes; cut each still running at the ceiling and record it as errored, reason
          "exceeds-call-budget", detail naming the unit and the ceiling. No new unit starts after the budget.
       b. Write progress atomically (temp file in the same directory, then rename), mode 0600,
          with tree and plan from step 3, written_at := now, and calls := (prior.calls or 0) + 1.
       c. IF no unit is left to run after 6a: continue to 7 instead of exiting 3.
     Invariant: every call that exits 3 has recorded at least one new unit, because its first unit
     always starts (5b) and is either recorded when it finishes or recorded at the ceiling (6a). So
     units_done strictly rises from one exit-3 call to the next within an attempt.
       d. Print GatesIncomplete; exit 3.
  7. Ladder finished: build GatesOutcome from the recorded and new results, delete the progress
     file, print the outcome and the contract block as today, exit 0 or 1 as today.
```

**Chosen:** the unit is the rung, the pool file or the shard, not the whole rung. This repository's UNIT rung is the file pool and takes about 190 of the gate's roughly 230 seconds, so rung granularity alone would leave the long part as one piece.

**Chosen:** cut, then discard. Letting in-flight units run past the budget would make a call's length depend on whichever file was in flight. Cutting bounds each call at the budget plus the time a cut takes, and the no-progress case at the ceiling. With the default 420-second budget the ceiling is 480 seconds, leaving 120 seconds of the 600-second tool cap for the fingerprint and the output.

**Chosen:** in budget mode a whole-rung unit runs through `spawnAsync`, so it can be cut. The unbudgeted path keeps `spawnSync`. A cut is told apart from `rung_timeout_ms` by the caller's stop signal, never by the exit status, so a cut never becomes an `errored` result with reason `timed-out`.

**Anti-pattern:** recording a budget cut as `errored` or `fail` in a call that already finished a unit. Why: it would turn an interrupted pass into a needs-human or a fail on the next call. Only the ceiling cut in a no-progress call is recorded, because that unit had a whole call and still could not finish.

**Anti-pattern:** reading progress in the no-flag path. Why: today's caller would silently get skipped rungs.

### 4.2 Fingerprints

```
PROCEDURE tree_fingerprint(root):
  1. base := git rev-parse HEAD^{tree}
  2. changed := git --no-optional-locks status --porcelain=v2 -z --untracked-files=all
                  -- . ':(exclude).faff'
     (--no-optional-locks: git does not refresh or rewrite .git/index)
  3. For each changed path, sorted by path:
       deleted                 -> entry "D <path>"
       present (file or link)  -> entry "<mode> <content id> <path>", where content id comes from
                                  git hash-object --no-filters --stdin-paths (no -w: nothing is written)
                                  and mode is the lstat file type and executable bit
  4. RETURN sha256(base + "\0" + entries joined by "\0")
     Any git failure: exit 2, naming the failing git step.
```

Nothing is written: no index, no objects. Only changed and untracked files are hashed, so the cost is a `git status` (about 0.5 seconds on this repository) plus the size of the uncommitted work.

**Chosen:** `HEAD`'s tree id plus the content of every file that differs from it, read through `git status`. It covers uncommitted edits and new untracked files, which a `HEAD` sha alone would miss, and it uses git's own ignore rules, so build output already ignored does not invalidate progress. An earlier draft used a temporary index and `git write-tree`; that copies untracked files, which can hold credentials, into `.git/objects`, so it was dropped.

**Chosen:** `.faff/` is always excluded. The progress file lives there, and an adopter whose `.faff/` is not ignored would otherwise change the fingerprint by writing progress. Gate configuration under `.faff/config.yaml` is still covered, through the plan fingerprint.

The plan fingerprint hashes, in order: each runnable rung's `kind`, `name`, `command`, `required` and `cwd`; each rung's unit list (for a file pool, the sorted file list `listTestFiles` returns, split into pooled and serial, each with its content id from `git hash-object --no-filters` without `-w`, so an ignored test file is covered too; for shards, `n`); and the JSON of `readGatesConfig(root)` with keys sorted and `run_budget_secs` removed, since the budget decides when a call stops and not whether a result holds.

**Chosen:** ignored files other than pool test files stay outside both fingerprints. Hashing every ignored file would hash `node_modules` and build output on every call. An ignored input a test reads (a local `.env`, a local fixture) is in the same class as state outside the tree, covered by the `stale` bound and by CI (4.6).

### 4.3 Where things live

**Chosen:** a new module `bin/lib/gates-progress.js` (region `factory`, banner `// === region:factory — gates-progress — FAFF-1405: budgeted, resumable gate runs (fingerprints and the progress file) ===`) holding `treeFingerprint`, `planFingerprint`, `readProgress`, `writeProgress` and `clearProgress`. `runLadder(root, opts)` gains an optional `opts = { budgetMs, progress, now, stopSignal }`; with `opts` absent it behaves as today. `gates.js` re-exports the new names, as it does for the other split modules.

- Before every progress write, the writer runs `git check-ignore -q .faff/gates/run-progress.json`. Ignored: write. Not ignored and `.faff/gates/.gitignore` is untracked or absent: write that file as exactly `*` and a newline (a regular file, checked with `lstat`), then write progress. Not ignored and `.faff/gates/.gitignore` is tracked: leave the adopter's file untouched, write no progress, and exit 2 with reason `progress-file-not-ignored`. So progress never sits unignored in a tracked `.faff/`, and faff never edits a tracked file.
- Progress stores `detail` only for `fail` and `errored` units, and passes it through `redactKnownSecrets` (`redact.js`, the configured secret values) and `secretRedact` (`adversarial-judge-scrub.js`, the secret-shaped patterns) before writing.
- When the graft loop stops as `needs-human` (4.4), it runs `faff gates run --clear-progress`, a third flag that deletes the progress file and its temporary files and exits 0, so an abandoned attempt leaves no output tails at rest. Stale progress is also deleted by the next run that reads it.
- The progress directory: `.faff` and `.faff/gates` are each checked with `lstat` and must be real directories, not symlinks, and `.faff/gates` must resolve inside `root`. Either one missing is created with mode 0700. A symlink or an escape exits 2 before any unit runs, with reason `progress-dir-unsafe`. The temporary file for the atomic write is created in that checked directory with `O_EXCL`.
- `runFilePoolRung` and `runShardedRung` gain an optional `opts` carrying the reusable results, the stop signal and a per-unit callback, and they skip units already done.
- `readGatesConfig` gains `run_budget_secs` (present-ness before coercion, as its other knobs; absent, non-numeric or below 1 gives the default 420).
- `config-core.js` DEFAULTS: `"gates.run_budget_secs": "420"`. The `defaults --selftest` expected list in `config.js` is not extended (no new selftest cases; see Tests).
- `docs/guide/cli.md`: extend the `gates` row's usage to `gates <discover\|run> [--json] [--budget-secs N] [--resume] [--clear-progress]` and add one sentence on exit 3 and resume.

### 4.4 Graft prose

**Chosen:** graft runs the gate with `--resume` and loops on exit 3, the same shape as Step 9's chunked judge calls.

- Step 7.5's code block becomes `"$faff" gates run --json --resume`, run as a foreground Bash call with `timeout: 600000`.
- One new sentence after the block, defining the loop: one gate attempt is a run of calls with no edit to the tree in between. While a call exits 3, tick `faff heartbeat "$run_dir" --unit <issue>` and run the same command again, as long as the call's `units_done` is higher than the previous call's in this attempt (the first call of an attempt has no previous call and always re-invokes). Stop and treat the gate as `needs-human` when `units_done` did not rise, when any call after the first in the attempt reports `discarded` (nothing should have changed between those calls), or when a call ends with anything other than exit 0, 1 or 3, including the tool killing it. On that stop it runs `"$faff" gates run --clear-progress` before parking or surfacing.
- A fix after a `fail` starts a new attempt. Its first call may report `discarded: "tree-changed"` for the old progress, and that is expected.
- In the foreground-posture paragraph, "is **chunked or polled across successive foreground calls**, never backgrounded" becomes a pointer to that loop for the gate ladder, keeping "never backgrounded" and all three `ANCHOR_PHRASES` (`run_in_background: true`, `never end a turn`, `foreground-to-terminal`).
- `validate-adapters.js`: set `SKILL_LINE_BASELINE["faff-graft"]` to the file's new size, with a `FAFF-1405 ±N faff-graft` note in the inline comment in the house style.

### 4.5 Edge cases

- **`--resume` and no progress file:** a normal budgeted run from the first rung; `discarded` is absent.
- **`--budget-secs` without `--resume`:** existing progress is ignored and overwritten if this call ends incomplete. A fresh run on request.
- **A tree edit between attempts (the lane fixed a failure and runs the gate again):** the new attempt's first call reports `discarded: "tree-changed"` if progress was left behind, and the ladder restarts. This is the intended path after a fix. Within one attempt the lane makes no edits, so a `discarded` there is a fault and stops the loop (4.4).
- **A changed `.faff/config.yaml` gates block, or a new test file:** `discarded: "plan-changed"` (a new untracked test file also changes the tree).
- **`.faff` or `.faff/gates` is a symlink** (an adopter repository can commit one): exit 2, `progress-dir-unsafe`, before any unit runs. Nothing is read or written through it.
- **Progress older than one hour:** `discarded: "stale"`, the ladder restarts.
- **The progress file is a symlink, empty, or malformed JSON:** `readLeafNoFollow` refuses it or the shape check fails; `discarded: "unreadable"`, the file is deleted, the run starts fresh. It is never trusted.
- **A required rung failed in an earlier call:** cannot happen; that call ended the ladder with exit 1 and deleted the progress.
- **The budget runs out while the last units are in flight and this call already finished one:** they are cut, progress is written, exit 3; the next call runs only them.
- **`discovery: none`:** no units; the ladder finishes in the first call with today's fallback signal.
- **A root that is not a git work tree with either flag:** exit 2.

### 4.6 Failure modes

| The failure | How you'd know | What it means |
|---|---|---|
| Running the gate itself, or a cut test process, writes non-ignored files into the tree, so the next call sees `tree-changed` | `discarded: "tree-changed"` on the second call of an attempt; the graft loop stops as `needs-human` (4.4) | Add the written path to `.gitignore` (or the test's temp dir); the loop stops safely rather than spinning |
| One unit alone takes longer than the ceiling on a loaded host | That unit is recorded `errored` with reason `exceeds-call-budget` and the finished run's signal is `needs-human` | The ladder still finishes and no call passes the tool cap. A human splits the unit, makes it shard-capable, or runs that gate outside a lane |
| Cutting a test process leaves temp state that breaks the re-run | The re-run of a cut file fails while an unbudgeted run passes | A test isolation bug in that file; the cut is a SIGTERM to the process group, the same signal `rung_timeout_ms` already sends |
| A failing test prints a secret into its output tail | The redacted tail is in `run-progress.json` | Redaction catches configured secrets and secret-shaped values, not every secret. The file is mode 0600 and ignored by git, and is deleted when the ladder finishes, when graft's loop stops, or by the next run once stale. A backup taken during an attempt can still copy it |
| The tree fingerprint is slow because the lane has large changed or untracked files that are not ignored | `setup_ms` in the output is large; on a big enough tree the call is killed by the tool cap and the graft loop stops as `needs-human` | Ignore the generated files. Setup sits outside the call clock, so the 120-second margin under the cap is what absorbs it |
| A unit's result depended on state outside the tree that changed between calls (a local service went down) | A resumed run passes where an uninterrupted run started now would fail | The same exposure an uninterrupted run already has across its own length; the one-hour `stale` bound caps it. CI on the PR re-runs everything |
| A same-user process forges the progress file to skip a failing rung: the lane, a unit's own test code, or a process a test left running after the call | Nothing at Step 7.5; the resumed contract block shows a pass for a unit with no execution in this call | Accepted at this layer. A lane can already forge the contract block it pipes, and code running inside a gate unit is already trusted with that unit's verdict. The merge floor never reads progress (merge-gate runs a fresh ladder locally, and CI on the PR path), so a forged pass cannot merge |

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fixture repo whose ladder is three whole rungs of about 2 seconds each
When faff gates run --json --budget-secs 3 is run, then faff gates run --json --resume --budget-secs 3 until it exits 0
Then the first call exits 3 with units_done between 1 and 2 and no contract block,
  and the final call's faff-contract:quality-gates block (signal and each rung's kind and status) is identical
  to that of one uninterrupted faff gates run on the same repo; the JSON "resumed" field is not compared
```

```
Given a fixture repo with saved progress from an earlier call
When one tracked file is edited and faff gates run --json --resume is run
Then the output reports discarded "tree-changed" and every rung runs again
```

```
Given a fixture repo with one whole rung that sleeps 10 seconds and a second rung that passes
When faff gates run --json --resume --budget-secs 2 is run until it stops exiting 3
Then the first call takes no more than about 4 seconds of unit time and exits 3 with units_done 1,
  the next call runs only the second rung and exits 1,
  and its contract block shows the first rung as errored and the signal as needs-human
```

- A call with a budget never starts a unit after its budget has run out, other than the first unit it needs to run.
- A call that has finished no unit never cuts one before its ceiling, and never runs one past it.

## 5. DESIGN DECISION RATIONALE

**What is the unit of progress?** Whole rungs only: simple, but this repository's long rung is one piece. Rung plus pool file plus shard: matches how the executor already spawns processes. **Chosen:** rung, pool file and shard (4.1).

**Where does the budget come from?** Flag only: the lane loop must carry a number. Flag, config, default always on: changes today's no-flag run. **Chosen:** flag, else config under `--resume`, else none (section 3).

**What happens to in-flight units at expiry?** Let them finish: a call's length depends on the slowest file, and can pass the tool cap. Cut always: a single long unit never finishes and the loop never ends. **Chosen:** cut and discard, except a call with no finished unit lets its units run to the ceiling and records any still running as `errored` (4.1).

**How is "the same tree" decided?** `HEAD` sha: misses uncommitted edits. `git status` text alone: misses edits to an already-modified file. Temporary-index `write-tree`: copies untracked files into the object store. Hashing every file by hand: slow and re-implements ignore rules. **Chosen:** `HEAD`'s tree id plus content ids of the files `git status` reports, written nowhere, excluding `.faff/` (4.2).

**What does an incomplete call print?** A contract block with a new `incomplete` signal: changes a fixed contract. Today's block with the partial rungs: a reader could take it as a verdict. **Chosen:** no block, exit 3 and `GatesIncomplete` (section 3).

**Does the merge floor use resume?** **Chosen:** no; merge-gate and post-merge-check keep fresh runs (Out of scope).

**When does graft's loop stop?** On a fixed call count: arbitrary. While `units_done` rises: the judge-call idiom, and finite by the progress guarantee, but only within one attempt, since a fix resets the count. **Chosen:** while `units_done` rises within an attempt, and on any `discarded` after an attempt's first call (4.4).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

**Assumes:** a `faff gates run` on this repository leaves `git status --porcelain` unchanged, both when it runs to the end and when it is cut mid-UNIT (the gate and a SIGTERM'd test write only ignored paths). Validate before building: on a clean worktree, compare `git status --porcelain` before and after one full run, and before and after a run killed with SIGTERM to its process group about 60 seconds into the UNIT rung. If either changes, ignore the written paths in the same PR.

## 7. DONE

### From WHY
- [ ] A gate run that needs more than one budget completes through repeated `--resume` calls, and its final `faff-contract:quality-gates` block (signal plus each rung's kind and status) is identical to an uninterrupted run's on the same tree; `resumed`, `setup_ms` and durations are not compared.

### From WHAT (command and types)
- [ ] `--budget-secs` rejects 0, negative, non-integer, missing and above-480 values with exit 2.
- [ ] `gates.run_budget_secs: 600` gives a budget of 480 and one stderr line naming the clamp.
- [ ] `--clear-progress` deletes the progress file, runs no rung, and exits 0; combined with `--resume` it exits 2.
- [ ] With `--resume` and no `--budget-secs`, the budget is `gates.run_budget_secs`, and 420 when that key is unset.
- [ ] With neither flag, the run's stdout, exit code and files on disk are the same as before this change (no `resumed` field, no progress file).
- [ ] An incomplete call exits 3, prints `GatesIncomplete` under `--json`, prints only the `progress discarded` line (when set) and the `gate ladder: incomplete` line without `--json`, and prints no `faff-contract:quality-gates` block in either mode.
- [ ] A finished budgeted or resumed run's JSON carries `resumed.calls`.
- [ ] `gates.run_budget_secs` appears in `faff config defaults` with value 420.

### From HOW (budgeted ladder)
- [ ] No unit other than the call's first starts after the budget is spent on the call clock.
- [ ] A call whose setup (fingerprints and progress read) takes longer than the budget still gives its first unit the full ceiling, measured from that unit's start.
- [ ] A call that reuses results from progress and has its only new unit in flight at expiry lets that unit run to the ceiling and records it, because reused results are not finished by this call.
- [ ] A finished run that discarded progress at step 4 carries `resumed.discarded` with the reason and `resumed.calls` of 1; a finished run that discarded nothing has no `resumed.discarded`.
- [ ] A call that has finished at least one unit cuts in-flight units at expiry, and no cut unit's result appears in progress or in any later output.
- [ ] A call that has finished no unit lets its in-flight units run to the ceiling, records those that finish, and records each still running at the ceiling as `errored` with reason `exceeds-call-budget`; no call runs a unit past its ceiling.
- [ ] Changing `gates.run_budget_secs` between calls does not change the plan fingerprint.
- [ ] Editing an ignored pool test file between calls reports `plan-changed`.
- [ ] Progress holds an empty `detail` for every `pass` unit, and after any progress write `.faff/gates/.gitignore` contains exactly `*`, including when `.faff/gates` existed beforehand without it.
- [ ] With `.faff/gates/.gitignore` tracked and not ignoring the progress file, a budgeted call exits 2 with reason `progress-file-not-ignored` and leaves the tracked file byte-identical.
- [ ] A `fail` unit whose output contains a configured secret value and a secret-shaped token has both replaced by the redaction placeholder in `run-progress.json`.
- [ ] A progress file holding an `exceeds-call-budget` result whose `ceiling_secs` is below the current call's ceiling makes that unit run again; one at or above it is reused.
- [ ] Progress is rewritten after each recorded unit, so a call killed after recording a unit leaves that unit in progress.
- [ ] Every call that exits 3 reports a `units_done` higher than the previous exit-3 call on the same tree and plan.
- [ ] A cut whole-rung unit is never reported as `errored` with reason `timed-out`.
- [ ] Units recorded in matching progress are not run again.
- [ ] A required rung that fails ends the ladder with exit 1 and deletes the progress file.
- [ ] The progress file is mode 0600 and is replaced by rename, never written in place.

### From HOW (fingerprints)
- [ ] Editing a tracked file, adding an untracked file, or changing the gates config between calls makes the next `--resume` call report `tree-changed` or `plan-changed` and run every rung.
- [ ] Changing a file under `.faff/` other than the gates config does not change the tree fingerprint.
- [ ] Computing the tree fingerprint leaves `.git/index` byte-identical and adds no object to `.git/objects` (an untracked fixture file's content id is not present in the object store afterwards).
- [ ] Progress whose `written_at` is more than 3600 seconds old is reported `stale` and not used.
- [ ] With `.faff` or `.faff/gates` a symlink, either flag exits 2 with reason `progress-dir-unsafe`, and nothing is written through the link.
- [ ] A progress file that is a symlink, empty, or malformed is reported `unreadable`, deleted, and never used.
- [ ] Either flag in a root that is not a git work tree exits 2.

### From HOW (callers and prose)
- [ ] `merge-gate-local.js` (`runLadder`) and `post-merge-check` (`runRung`) are called without the new options, and a progress file in their tree does not change their result.
- [ ] `faff-graft/SKILL.md` Step 7.5 runs `faff gates run --json --resume`, re-invokes it on exit 3 while `units_done` rises within one attempt, ticking the heartbeat between calls, and stops as `needs-human` when `units_done` did not rise, a call after the first in an attempt reports `discarded`, or a call ends with an exit other than 0, 1 or 3, and on that stop runs `faff gates run --clear-progress`.
- [ ] The foreground-posture paragraph no longer says "chunked or polled", still says "never backgrounded", and keeps all three faff-graft `ANCHOR_PHRASES`.
- [ ] `SKILL_LINE_BASELINE["faff-graft"]` equals the file's new size, and `faff validate-adapters` reports no RATCHET and no FAIL.
- [ ] `docs/guide/cli.md`'s `gates` row shows the three new flags, and `faff lint-cli-doc` passes.
- [ ] `faff regions check` passes with `gates-progress.js` carrying the `region:factory … FAFF-1405` banner.

### Tests
- [ ] No new `--selftest` cases: `gatesSelftest` and the `config defaults --selftest` expected list gain no entries. A selftest case this change alters may move into `test/`, never the reverse. `gates` keeps its existing selftest coverage, so no `TEST_FILE_COVERAGE` entry is needed.
- [ ] `test/gates-budget.test.mjs` exists, runs under `node --test`, and passes. It drives the real `faff gates run` on `mkdtempSync` git repos and covers: exit 3 then resume to exit 0; tree change discards; plan change discards; stale progress discards; the no-progress-call rule and the ceiling cut; a budget cut is not recorded; a malformed or symlinked progress file is discarded; `units_done` strictly rises across exit-3 calls; the non-JSON exit-3 line; `gates.run_budget_secs` in `faff config defaults`.
- [ ] `test/gates-progress.test.mjs` exists, runs under `node --test`, and passes, covering the fingerprints and the progress reader and writer on a `mkdtempSync` git repo.

### Integration smoke test

```
PROCEDURE smoke():
  1. tmp git repo; package.json scripts lint="sleep 1", test="sleep 4"; commit
  2. faff gates run --json --root tmp --budget-secs 3          → exit 3, units_done 1, no contract block
  3. faff gates run --json --root tmp --resume --budget-secs 3 → exit 0 (test ran past the budget, inside the 6 s ceiling),
                                                                 rungs LINT pass, UNIT pass, resumed.calls 2
  4. ls tmp/.faff/gates/run-progress.json                     → absent
```

confidence: high
build-tier: complex
spec-review: accept (human, after round 5)

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized:** no issues. One CLI capability (one new module, changes to three existing gate modules, and two test files) plus one graft prose edit, about one to two days. The CLI and the prose ship together: the prose is useless without the flags, and the flags are unused without the prose. The `complex` tier comes from the executor change (cut and stop signal), not from breadth.
- **Workstream fit:** no issues. Project-less Backlog, in the same throughput cluster as FAFF-1404 (shipped) and FAFF-1406.
- **Deps surfaced:** FAFF-1404 has merged (#1152) and edited the same `faff-graft/SKILL.md` and its baseline, so build on an `origin/main` that contains it. FAFF-1400 has merged (#1125) and provides `readLeafNoFollow`. FAFF-1406 edits only `faff-prep`, so the two do not collide. No blocker link is needed.
- **Risk profile:** the one unvalidated assumption is that the gate does not write non-ignored files into the tree; the spec makes checking it the first build step. The failure is safe either way: the graft loop stops when `units_done` stops rising.
