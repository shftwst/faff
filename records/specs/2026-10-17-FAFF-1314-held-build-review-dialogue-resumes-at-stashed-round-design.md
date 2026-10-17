# FAFF-1314: A held build-review dialogue resumes at the stashed round

> Spec: faffter-dark-nlspec · 2026-10-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1314.

This spec fixes the build-review dialogue hold so a resumed build carries its round records and counters into the fresh run dir. It is written for the build agent and for the human reviewer of the PR.

## 1. WHY

**The load-bearing model.** The build-review dialogue numbers its rounds from disk: `faff spec-review-window --next-round --dir <run-dir>/<ISSUE>/build-review` returns the highest `round-<n>.json` plus 1. Each beep-boop drain gets a fresh run dir, so the only way round 3 follows round 2 across a hold is for `build-review/` to travel through the resume store at `.faff/resume/<ISSUE>/` and come back intact. Today it does not.

**Problem.** The `built-but-not-admitted` hold in `plugin/skills/faff-graft/SKILL.md` (Step 9) stashes "the round records" plus `review-rounds/` but never names `build-review/`, and the Step 3 resume-store fallback restores `*.json` flat plus `review-rounds/` only. The resumed run therefore has no `build-review/`, `--next-round` returns 1, the judge's `build-review/judge/` ledger is gone, and the counters `{hold_count, fix_rounds_used, rebuttal_rounds_used, next_round}` are stashed to a file the prose never names, so nothing reliably reads them back. This change moves the stash and restore out of prose into one small CLI verb that copies a fixed layout, owns the hold record, and refuses a store whose rounds and record disagree.

**Verified on origin/main (87417f60).** No CLI performs the stash or restore today: `git grep` for `.faff/resume` in `plugin/skills/faff/bin/lib/` finds only the lights-out presence check (`lights-out.js`), the prep spec-review hold (`spec-review-hold.json`, written by `lights-out.js` and read by `prepcheck.js`), and comments. The copy is SKILL prose at graft lines 201, 507 and 516.

### Design principles

- **The CLI owns the layout, prose owns the decision.** Graft decides when to hold and what to do on refusal; `faff resume-store` decides which files move and in what shape. Two prose sites that describe the same copy are the drift this ticket fixes.
- **Disk is the round counter.** `next_round` in the hold record is a cross-check derived from the stashed `build-review/`, never an independent counter the agent supplies.
- **Fail closed toward a human, never toward round 1.** A store that cannot prove its round chain parks `needs-human`. A fresh rebuild would reset `hold_count` and defeat `graft.build_review_hold_limit`.
- **Never clobber the prep hold.** `.faff/resume/<ISSUE>/spec-review-hold.json` belongs to faff-prep. The stash preserves it and the restore ignores it.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` lines 201, 204, 507, 516 | Markdown | The three copy sites and the dialogue resume arm this replaces |
| `plugin/skills/faff/bin/lib/spec-review-window.js` (`nextRoundNumber`) | JS | The disk-derived round counter the dialogue loop and this CLI share |
| `plugin/skills/faff/bin/lib/effects.js` (`build-progress`, `review-progress`) | JS | Sibling per-issue checkpoint verbs; shape and exit-code conventions to mirror |
| `plugin/skills/faff/bin/lib/regions.js` | JS | Command to region map and selftest map every new verb registers in |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (`SKILL_LINE_BASELINE`) | JS | `faff-graft` baseline 957; the file is 956 lines today |
| `docs/guide/cli.md` | Markdown | CLI reference table; `build-progress` row is the model |
| `test/build-progress.test.mjs` | JS | Test style (`runCli` helper, temp run dirs) |

**Scope.** One CLI verb plus three prose edits inside faff-graft's autonomous hold and resume paths. Interactive graft never holds, so it is untouched.

## 2. OUT OF SCOPE

- **Clearing the store on a terminal disposition.** Graft's `rm -rf .faff/resume/<issue>/` sites stay as they are, even though they also delete a prep `spec-review-hold.json`. Why: pre-existing, and prep's hold never coexists with a build hold in practice. Extension point: a `faff resume-store clear` subcommand in the same module.
- **Lights-out re-entry.** `lights-out.js` keeps using the store directory's presence as the awaiting-review proxy. Why: presence semantics are unchanged by this fix. Extension point: `gatherResumeEvidence` in `lights-out.js` could read the hold record later.
- **Re-scrubbing rebuttals at stash time.** Rebuttals are secret-redact-scrubbed before they land in `round-<n>.json` (graft dialogue step 3). The stash copies bytes verbatim. Extension point: `redactKnownSecrets` in `redact.js`.
- **A schema for the hold record under the v0.3 evidence directory.** The record is resume class (kernel: sensor/resume, lane-writable), not evidence class, so it is not an anchor. Extension point: `plugin/skills/faff/contracts/`.
- **Re-acquiring the build claim on a resumed run.** Both resume arms skip Step 5, so a resumed run holds no build-claim ref, and the next hold's `faff build-claim release --sha <sha>` has no `sha` to release. Why: pre-existing and independent of the copy layout; this spec does not rely on the claim (the stash takes its own lock, see HOW). Extension point: the Step 3 resume-store fallback in `faff-graft/SKILL.md`, before the worktree is recreated.
- **Migrating a stash written by the old prose.** A pre-fix dialogue stash has no hold record and no `build-review/`. It restores as the legacy single-cause shape (`review-outage`), exactly as today. Extension point: none needed; holds drain within `graft.build_review_hold_limit` (default 2) drains.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Resume store | `<store-root>/<ISSUE>/`, default `<store-root>` = `.faff/resume` under the repo root. Run-agnostic handoff between drains. |
| Issue dir | `<run-dir>/<ISSUE>/`, the per-issue folder of one run. |
| Hold record | `<store-root>/<ISSUE>/hold.json`, written only by `faff resume-store stash`. |
| Carried set | What a stash copies: every top-level regular `*.json` file in the issue dir, plus the `review-rounds/` and `build-review/` folders recursively when present. |

### Types

```
ENUM HoldCause:
  review-outage            # graft Step 9 retry-later hold
  build-review-dialogue    # graft Step 9 built-but-not-admitted hold

RECORD HoldRecord:                 # <store-root>/<ISSUE>/hold.json
  schema_version: 1
  issue: String                    # matches the --issue argument
  cause: HoldCause
  stashed_at: ISO-8601 String
  carried: List<String>            # relative paths copied, sorted; audit only
  dialogue: DialogueCounters?      # present iff the issue dir's build-review/ holds >= 1 round file

RECORD DialogueCounters:
  hold_count: Integer >= 0         # dialogue holds so far; see stash steps 7 and 12
  next_round: Integer >= 2         # nextRoundNumber(<issue dir>/build-review) at stash time
  fix_rounds_used: Integer >= 0    # from --fix-rounds-used
  rebuttal_rounds_used: Integer >= 0   # from --rebuttal-rounds-used

  CONSTRAINT next_round == nextRoundNumber(<store>/build-review)   # checked by restore
```

The review-outage counter stays where it is today, in `review-progress.json` (`outage_retries`), which travels in the carried set. The dialogue counters ride on both causes: a provider outage can interrupt a dialogue reviewer pass (graft routes that `unavailable` to the outage hold), and the counters must survive that hold too.

### CLI surface

```
faff resume-store stash   --run-dir <dir> --issue <id> --cause <HoldCause>
                          [--fix-rounds-used N --rebuttal-rounds-used N]   # required iff build-review/ holds a round file
                          [--store-root <dir>]
faff resume-store restore --run-dir <dir> --issue <id> [--store-root <dir>]
faff resume-store read    --issue <id> [--store-root <dir>]
faff resume-store --selftest
```

| Subcommand | stdout | Exit |
|---|---|---|
| `stash` | the written `HoldRecord` JSON | 0 written; 1 refused (see HOW); 2 usage or I/O fault; 4 busy (another subcommand holds the issue lock) |
| `restore` | the `HoldRecord` JSON (legacy: `{ "cause": "review-outage", "legacy": true }`) | 0 restored; 1 refused; 2 usage or I/O fault; 3 no store; 4 busy |
| `read` | the `HoldRecord` JSON; a store without `hold.json` prints the legacy shape, as `restore` does | 0; 2 present but unreadable or out of shape; 3 no store; 4 busy |

- `--issue` must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (the `evidence.js` shape) before any path join; otherwise exit 2.
- `--store-root` defaults to `.faff/resume` resolved against the current working directory.
- `--cause` outside `HoldCause` exits 2. A stored `hold.json` whose `cause` is outside `HoldCause` reads as out of shape, so `restore` and `read` exit 2.

### Registration

- **Chosen:** a new module `plugin/skills/faff/bin/lib/resume-store.js` in the `factory` region, registered in the `bin/faff` command table and usage text, the `regions.js` region map and selftest map, and `docs/guide/cli.md`. Rationale: it requires `nextRoundNumber` from `spec-review-window.js`, which is `factory`; a `governance` module may not require a `factory` one, so placing it beside `build-progress` in `effects.js` would fail `faff regions check`.

## 4. HOW

### Issue lock and torn-swap recovery (shared by every subcommand)

`stash`, `restore` and `read` each take the per-issue lock for their whole run, so no reader ever sees a store mid-swap. The lock is the exclusive, non-recursive `mkdir` of `store_root/.<issue>.stage` (after `mkdir -p store_root`). On success the caller writes a random nonce to `stage/.lock`. On `EEXIST`: a stage older than 10 minutes is stale, so remove the stage only and retry once; otherwise exit 4 (busy). Two callers can both judge the same stage stale; the loser's stage is then removed under it, so `stash` re-reads `stage/.lock` immediately before publishing and exits 4 when the nonce is missing or not its own. `.lock` is never listed in `carried` and is ignored by `restore` and `read`. `restore` and `read` remove the empty stage on exit; `stash` fills it and publishes it by rename. On any fault while holding the lock, remove the stage before exiting.

Stash publishes a new store with two renames. A crash between them leaves the previous store at `.<issue>.old` and nothing at `<issue>`. Every subcommand runs `recover` under the lock before reading the store, so the previous store is never lost or ignored.

```
PROCEDURE recover(store_root, issue):
  1. dst := store_root/issue ; old := store_root/.<issue>.old
  2. IF dst absent AND old present -> rename old -> dst   # the torn swap is undone
  3. IF dst present AND old present -> remove old         # a completed swap's leftover
```

### Stash

Stash copies the carried set from the issue dir into a staging folder, writes the hold record, and swaps it in.

```
PROCEDURE stash(run_dir, issue, cause, counters, store_root):
  1. src := run_dir/issue ; dst := store_root/issue
  2. IF src is not a directory -> exit 2 ("no issue dir")
  3. n := nextRoundNumber(src/build-review)
     a. IF cause == build-review-dialogue AND n == 1 -> exit 1 ("no dialogue rounds to resume")
     b. IF n > 1 AND fix/rebuttal counters missing or not integers >= 0 -> exit 2
  4. mkdir -p store_root   # the first hold in a repo creates .faff/resume
  5. take the issue lock; stage := store_root/.<issue>.stage   # busy -> exit 4
     (graft does not hold the build-claim ref on a resumed run, so the stash cannot rely on it)
  6. recover(store_root, issue)
  7. prior := read dst/hold.json   # absent -> no prior
     IF present but unparseable or out of shape -> exit 2
     prior_holds := prior.dialogue.hold_count if present, else 0   # carried across a cause switch
  8. copy every top-level regular *.json in src into stage,
       EXCLUDING hold.json and spec-review-hold.json
  9. FOR folder IN [review-rounds, build-review]:
       IF src/folder is a directory: copy it recursively into stage
 10. All copies preserve file mode and timestamps; source symlinks are skipped, never followed
 11. IF dst/spec-review-hold.json exists: copy it into stage unchanged
 12. write stage/hold.json:
       carried := sorted relative paths of every file in stage except hold.json
       IF n > 1: dialogue := { hold_count: prior_holds + (1 if cause == build-review-dialogue else 0),
                               next_round: n, fix_rounds_used, rebuttal_rounds_used }
 13. IF dst exists: rename dst -> store_root/.<issue>.old
     rename stage -> dst            # publishes the store and releases the lock
     remove store_root/.<issue>.old
 14. print the HoldRecord ; exit 0
     ON any fault before step 13: remove stage before exiting, so the lock never outlives the call
```

### Restore

Restore checks the store, rebuilds it in a staging folder beside the issue dir, proves the round chain there, and only then moves entries into the issue dir. Every exit 1 leaves the run dir as it found it.

```
PROCEDURE restore(run_dir, issue, store_root):
  1. src := store_root/issue ; dst := run_dir/issue
  2. take the issue lock   # busy -> exit 4; released on every exit below
  3. recover(store_root, issue)
  4. IF src absent -> exit 3
  5. rec := read src/hold.json
       absent AND src/build-review present -> exit 1 ("dialogue store without a hold record")
       absent      -> rec := { cause: review-outage, legacy: true }
       unreadable  -> exit 2
  6. IF rec.dialogue present AND nextRoundNumber(src/build-review) != rec.dialogue.next_round
       -> exit 1 ("stashed rounds and hold record disagree")
  7. FOR folder IN [review-rounds, build-review]:
       IF dst/folder is a symlink, or exists and is non-empty -> exit 1 ("run dir already has <folder>")
  8. rstage := run_dir/.<issue>.restore ; remove it if left over ; mkdir it
  9. copy into rstage every top-level regular *.json in src (EXCLUDING hold.json and spec-review-hold.json)
       and review-rounds/ and build-review/ recursively when stashed; same mode/timestamp/symlink rules as stash
 10. IF rec.dialogue present AND nextRoundNumber(rstage/build-review) != rec.dialogue.next_round
       -> remove rstage ; exit 1   # the post-copy proof runs before the run dir is touched
 11. mkdir -p dst ; move each entry of rstage into dst by rename
       (a top-level file replaces any same-named file or symlink in dst; never follows a destination symlink)
     remove rstage
     an I/O fault during the moves exits 2; a later restore then refuses at step 7, so graft parks rather than resuming on a half-moved dir
 12. print rec ; exit 0
```

Preserving timestamps keeps the relative mtimes of `holdout.json` and `build-progress.json` as they were at hold time, so Step 8c's `holdout.json mtime > build-progress.json` idempotency check reads the same on resume regardless of copy order.

### Graft SKILL edits

- **Chosen:** every graft call passes `--store-root "$repo/.faff/resume"` explicitly, matching today's `faff build-progress read "$repo/.faff/resume"`. Rationale: graft runs some steps from inside a worktree, so the working-directory default is not a safe store locator there; the default exists for operators running the verb by hand.

All three edits replace existing prose in place. `plugin/skills/faff-graft/SKILL.md` must stay at or under its 957-line baseline. The line count only grows if a new line is added: the outage-hold and dialogue-hold sites are single-line bullets, so their edits stay on their own lines (the paragraph cap only warns on a bold-lead bullet), and only the Step 3 paragraph may spend the one spare line, as described in edit 1.

Line numbers below are as of origin/main 87417f60 and are for orientation only; locate each site by the quoted text.

1. **Step 3 resume-store fallback** (the paragraph starting "**Resume-store fallback (autonomous L3/L4 only"). Replace the `cp .faff/resume/<ISSUE>/*.json …` plus `cp -R … review-rounds` clause with `faff resume-store restore --run-dir "$run_dir" --issue <ISSUE> --store-root "$repo/.faff/resume"` and branch on the printed `cause`. Exit routing:
   - exit 1 or 2 → `needs-human` park citing the CLI's stderr line;
   - exit 3, and likewise the existing `faff build-progress read` exit 3 on this path → `needs-human` park, cause "hold label present but resume store missing". The fallback only runs when a hold label is on the issue, so a missing store there is store loss, not a stale label; a fresh build would reset `hold_count` and `outage_retries`. This replaces today's "exit 3 → stale label, fresh build" rule for both hold labels;
   - exit 4 → return `claimed-by-peer`, the existing token graft returns when the Step 5 build-claim is held elsewhere and a run-ledger outcome the drain already handles: another run is working this issue's store, and the issue stays Todo with its hold label for the next drain.
   The paragraph is plain prose (189 words today) and must stay at or under the 200-word cap. Removing the `cp` clauses frees roughly 60 words; if the routing above still does not fit, put it in one bullet under the paragraph, which uses the file's one spare line. The freshness parenthetical may be shortened to a pointer, since the CLI now owns copy order and timestamps.
2. **Both resume arms** (the bullets starting "**`cause: review-outage`**" and "**`cause: build-review-dialogue`**"). When the restore output carries a `dialogue` object, the dialogue loop seeds `fix_rounds_used`, `rebuttal_rounds_used` and `hold_count` from it, whichever arm re-enters the loop. The dialogue arm re-enters at `dialogue.next_round`. Wording otherwise unchanged.
3. **Outage hold** (the "**Else → retry-later**" bullet) **and dialogue hold** (the "**Else → hold**" bullet). Replace each "stash … to `.faff/resume/<issue>/` tagged `cause: …`" clause with `faff resume-store stash --run-dir "$run_dir" --issue <issue> --store-root "$repo/.faff/resume" --cause review-outage|build-review-dialogue`, adding `--fix-rounds-used <n> --rebuttal-rounds-used <n>` whenever `<run_dir>/<ISSUE>/build-review/` holds a round file (the same test the CLI applies, so graft never omits counters the CLI requires). The dialogue hold reads `hold_count` for its limit check via `faff resume-store read --issue <issue> --store-root "$repo/.faff/resume"`: exit 0 → `dialogue.hold_count`, absent → 0; exit 3 → 0 on a run that did not resume from the store, and `needs-human` park on one that did (the store it restored from has gone); exit 2 → `needs-human` park (a corrupt counter is never read as 0); exit 4 → wait briefly and retry once, then `needs-human`. A stash exit 4 gets the same single retry; any other non-zero stash exit → `needs-human` park, never a hold that cannot resume. A run resumed from the store exactly when its own Step 3 `faff resume-store restore` exited 0; graft records that in the per-issue log at Step 3, so the hold step reads it rather than inferring it.

**Anti-pattern:** describing the carried set in SKILL prose as well as in the CLI. Why: two descriptions of one copy is how `build-review/` went missing. The SKILL names the verb; the CLI and `docs/guide/cli.md` describe the layout.

**Anti-pattern:** on a restore refusal or a missing store under a hold label, discarding the store and rebuilding fresh. Why: a fresh build resets `hold_count` to 0, which turns `graft.build_review_hold_limit` into a label that resets on every drain.

### Edge cases

- **Second hold in a resumed run.** The resumed issue dir holds rounds 1 to 2 (restored) plus round 3; stash replaces the whole store, so it carries rounds 1 to 3, `next_round` 4 and `hold_count` 2.
- **Cause switch.** An outage hold during a dialogue carries the `dialogue` object with `hold_count` unchanged; a later dialogue hold increments from it. `outage_retries` stays inside the carried `review-progress.json`, so neither counter resets the other.
- **Concurrent access.** Any subcommand that finds the issue lock held exits 4. Graft treats that as contention, not as a verdict: a restore returns `claimed-by-peer` so the next drain retries, and a stash or read retries once before parking. A lock left by a crashed call goes stale after 10 minutes, well beyond any copy of a few JSON files.
- **Store loss under a hold label.** Store missing while a hold label is present now parks `needs-human` for both labels, instead of rebuilding fresh. A human sees the anomaly; `/faff-tidy`'s stale-label sweep still clears labels on issues that have moved to In Review, Done or Cancelled, so a label left by a best-effort housekeeping miss on a finished issue never reaches this path.
- **Judge files.** `build-review/judge/ledger.json` and `case-*.json` are written mode 0600; the copy keeps 0600.
- **Torn swap.** A crash between the two renames in stash step 13 leaves `.<issue>.old` and no `<issue>`. `recover` renames it back before any subcommand reads the store, so the previous store and its `hold_count` survive. `lights-out.js` checks only `<store-root>/<issue>`, so in the short window before the next subcommand runs it reads the store as absent; that check is a liveness hint, not a counter, and the next graft call repairs the store before reading it.
- **Leftover staging folders.** `.<issue>.stage` and `<run-dir>/.<issue>.restore` are dot-prefixed. A stale stash stage is removed only after 10 minutes and never together with `.<issue>.old`; a leftover restore stage is removed at the start of the next restore.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir whose FAFF-9/build-review holds round-1.json and round-2.json
  and a fresh run dir with no FAFF-9 folder
When graft holds with `faff resume-store stash --cause build-review-dialogue --fix-rounds-used 1 --rebuttal-rounds-used 1`
  and the next drain runs `faff resume-store restore` into the fresh run dir
Then `faff spec-review-window --next-round --dir <fresh>/FAFF-9/build-review` prints 3
  and the restore output carries dialogue.next_round 3 and dialogue.hold_count 1
```

```
Given a store whose hold record says next_round 3 but whose build-review holds only round-1.json
When `faff resume-store restore` runs
Then it exits 1, names the disagreement on stderr, and writes nothing into the run dir
```

```
Given a run dir whose FAFF-9 holds build-progress.json, review-progress.json with outage_retries 1, and review-rounds/round-1.json, and no build-review/
When graft holds with `faff resume-store stash --cause review-outage` and the next drain runs `faff resume-store restore` into a fresh run dir
Then the restore output has cause review-outage and no dialogue object,
  and `faff review-progress read <fresh> FAFF-9` reports outage_retries 1
```

```
Given a store holding build-progress.json and review-rounds/ but no hold.json (written by the old prose)
When `faff resume-store restore` runs
Then it exits 0, prints { "cause": "review-outage", "legacy": true }, and copies both into the run dir
```

```
Given a store for FAFF-9 with dialogue.hold_count 1, renamed to .FAFF-9.old as if a stash crashed mid-swap
When graft holds FAFF-9 again with `faff resume-store stash --cause build-review-dialogue`
Then the new hold record carries hold_count 2, and no .FAFF-9.old remains
```

- `.faff/resume/<ISSUE>/spec-review-hold.json` is byte-identical before and after any `stash` or `restore`.

## 6. Design decision rationale

**Where does the copy live: prose or CLI?**
- Prose fix (add `build-review/` to both `cp` clauses): smallest diff, but untestable, and leaves the counters in an unnamed file.
- CLI verb: testable, one description of the layout, names the hold record.
- **Chosen:** CLI verb `faff resume-store`. The ticket asks for a test that holds at round 2 and resumes at round 3; only a CLI can carry that test, and the unnamed counter file is the same defect class.

**Which holds use it?**
- Dialogue hold only: the Step 3 restore is shared by both causes, so the outage stash would still have to match the CLI's layout by hand.
- **Chosen:** both stash sites and the one restore site. One writer per layout.

**What happens when restore refuses?**
- Discard and rebuild fresh (today's rule for a diff-hash mismatch): resets `hold_count`.
- Park `needs-human`.
- **Chosen:** park `needs-human`. It matches the hold-limit-exhausted direction. The existing diff-hash mismatch rule (discard, rebuild) is unchanged because it runs before restore.

**Who increments `hold_count`?**
- Prose reads, adds 1, passes `--hold-count`.
- **Chosen:** the CLI increments on stash from the prior record, under its own lock. One source for the counter; prose only reads it for the limit check.

**How are concurrent stashes kept apart?**
- Rely on the build-claim ref: not held on a resumed run (see OUT OF SCOPE).
- A lock file with `O_EXCL`: a second artefact to clean up.
- **Chosen:** the exclusive `mkdir` of the staging folder is the lock, taken by all three subcommands, with its own exit code 4 so graft can tell contention from a refusal. It already exists for the swap, and the rename that publishes the store also releases it. Stale-lock cleanup removes only the stage, and `recover` restores a torn swap, so the lock adds no path that can lose the previous store.

**Which cause carries the dialogue counters?**
- Dialogue cause only: an outage that interrupts a dialogue reviewer pass loses the caps.
- **Chosen:** any stash whose `build-review/` holds a round. The counters describe the dialogue, not the reason for the hold.

**Which carried set?**
- An allowlist of named files (`build-progress.json`, `review-progress.json`, `holdout.json`).
- **Chosen:** every top-level `*.json` (minus the two hold files) plus the two folders. The dialogue resume skips Steps 4 to 8, so files such as `ac-checklist.json` must travel too; today's `*.json` glob already carries them, and narrowing it would be a regression.

**Region.**
- **Chosen:** `factory` (see Registration).

## 7. Open questions and assumptions

No open questions.

- **Assumes:** Node's `fs.cpSync` with `preserveTimestamps: true` keeps mode bits and mtimes on the supported floor (Node 20). Validate: the selftest stats a 0600 file and an mtime after a copy and compares them.

## 8. DONE

### From WHY
- [ ] A dialogue held at round 2 and restored into a fresh run dir yields `--next-round` 3 (test `test/resume-store.test.mjs`).
- [ ] `git grep "cp .faff/resume\|cp -R .faff/resume" plugin/skills/faff-graft/SKILL.md` returns nothing.

### From WHAT
- [ ] `faff resume-store stash|restore|read|--selftest` exist with the flags, stdout and exit codes in the CLI surface table.
- [ ] `hold.json` matches `HoldRecord`; `dialogue` is present iff the stashed `build-review/` holds a round file; `carried` equals the sorted list of every file in the store except `hold.json`.
- [ ] An `--issue` outside `^[A-Za-z0-9][A-Za-z0-9._-]*$` exits 2 before any filesystem access.
- [ ] The verb is registered in `bin/faff`, `regions.js` (region `factory` and the selftest map) and `docs/guide/cli.md`; `faff regions check` passes.

### From HOW (behaviour)
- [ ] Stash carries every top-level `*.json` except `hold.json` and `spec-review-hold.json`, plus `review-rounds/` and `build-review/` recursively, including `build-review/judge/`.
- [ ] A dialogue stash sets `hold_count` to the prior record's `dialogue.hold_count` + 1 (no prior → 1); an outage stash with rounds carries it unchanged.
- [ ] Stash refuses (exit 1) a dialogue hold with no round files, and exits 2 when rounds exist but the fix or rebuttal counter is missing.
- [ ] `stash`, `restore` and `read` started while `.<issue>.stage` exists and is under 10 minutes old each exit 4 and leave the store and the stage untouched; a stage older than 10 minutes is cleared and the call proceeds; `restore` and `read` leave no stage behind.
- [ ] Stash leaves an existing `spec-review-hold.json` byte-identical.
- [ ] Restore and read exit 3 when the store folder is absent.
- [ ] Restore and read exit 0 and print `{ "cause": "review-outage", "legacy": true }` when the store folder exists without `hold.json` and (for restore) without a stashed `build-review/`.
- [ ] `--cause` outside `HoldCause`, or a stored `hold.json` with such a cause, exits 2.
- [ ] Two stashes that both take over the same stale stage end with exactly one published store; the other exits 4 (selftest: replace `stage/.lock` before publish and assert exit 4).
- [ ] Restore exits 1 with the run dir byte-identical (including pre-existing top-level JSON files) when the stashed rounds disagree with `next_round`, `hold.json` is absent but `build-review/` is stashed, the run dir already has a non-empty `review-rounds/` or `build-review/`, the run dir's `review-rounds/` or `build-review/` is a symlink, or the staged round check fails (the selftest drives that check with a mismatching expected round).
- [ ] A review-outage stash and restore round trip keeps `outage_retries` and `review-rounds/` intact and prints no `dialogue` object when no round exists.
- [ ] Copies preserve mode (a 0600 judge file stays 0600) and mtimes, and skip symlinks.
- [ ] The four graft SKILL sites named under Graft SKILL edits call the verb with `--store-root "$repo/.faff/resume"`, with the exit routing listed there: restore 1, 2 or 3 and build-progress exit 3 on the fallback path park `needs-human`; restore 4 returns `claimed-by-peer`; stash or read 4 retries once; `read` 3 parks only on a resumed run; both resume arms seed the dialogue counters from the restore output.

### From HOW (edge cases)
- [ ] A second hold after a restore carries rounds 1 to 3, `next_round` 4 and `hold_count` 2.
- [ ] A dialogue hold, then an outage hold, then a dialogue hold yields `hold_count` 1, 1, 2.
- [ ] With `.<issue>.old` present and `<issue>` absent, every subcommand first renames `.old` back; a following stash reads the old `hold_count` and increments it.
- [ ] A stale `.<issue>.stage` is removed without touching `.<issue>.old`.
- [ ] The first stash in a repo with no `<store-root>` creates it and exits 0.

### Lint
- [ ] `faff validate-adapters` passes; `faff-graft/SKILL.md` is at or under 957 lines and the Step 3 resume-store fallback paragraph is at or under 200 words.
- [ ] `faff lint-refs` finds no ticket or ADR reference added to the SKILL.

### Integration smoke test

```
1. mk run A; write A/FAFF-9/{build-progress.json, ac-checklist.json, review-progress.json}
   write A/FAFF-9/build-review/{round-1.json, round-2.json}, A/FAFF-9/build-review/judge/ledger.json (0600)
   write A/FAFF-9/review-rounds/round-1.json
2. faff resume-store stash --run-dir A --issue FAFF-9 --cause build-review-dialogue \
     --fix-rounds-used 1 --rebuttal-rounds-used 1 --store-root S        -> exit 0
3. mk run B (empty)
4. faff resume-store restore --run-dir B --issue FAFF-9 --store-root S   -> exit 0, dialogue.next_round 3
5. faff spec-review-window --next-round --dir B/FAFF-9/build-review       -> "3"
6. assert B/FAFF-9/ac-checklist.json exists, B/FAFF-9/build-review/judge/ledger.json mode 0600
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** No issues. One CLI module with a selftest and a test file, three in-place prose edits, and a docs row: a 1 to 2 day unit. The CLI and the SKILL edits always ship together, so they belong in one ticket.
- **Workstream fit? (principles 1 and 5)** FAFF-1314 sits under FAFF-1255 (anchor evidence), but the defect is in graft's resume path, not in evidence recording. It was filed there because the FAFF-1268 review found it. Leaving it there blurs what "done" means for FAFF-1255. Consider moving it out to project-less Backlog or to the project that owns the build-review dialogue; this is a human call and prep does not move it.
- **Deps surfaced? (principle 6)** No blocker is needed: everything the spec relies on is on origin/main. One soft coupling: `faff-graft/SKILL.md` has one line of headroom under its baseline, and any sibling ticket editing that file at the same time competes for it. The spec keeps its edits within that one spare line, so no link is proposed.
- **Risk profile? (principle 7)** Low. No new integration. The one technical unknown, mode and mtime preservation on the Node 20 floor, is checked by the selftest before anything else depends on it.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-4 minors fixed, not re-reviewed)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}] }
```