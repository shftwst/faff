# FAFF-1249: Resume from the built-but-not-admitted hold re-enters the build judge, not the dialogue loop

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1249.

This spec is for the build agent implementing FAFF-1249 and for the humans reviewing its PR. When a graft build turn ends while the build judge is partway through its chunked `--assemble` calls, the next drain should pick the judge back up from its persisted ledger instead of re-running the build-review dialogue. The spec also settles the question FAFF-1246's code review left for prep: whether a resumed judge re-judges cases it parked because a backend was down.

## 1. WHY

**The load-bearing model.** The judge's progress already survives a hold. `faff resume-store stash` (FAFF-1314) carries `build-review/` recursively, so `build-review/judge/ledger.json` and its `case-*.json`, `recon-*.json` and `ruling-*.json` files come back intact in the next drain's run dir. `faff build-judge-evidence --assemble` (FAFF-1246) resumes any ledger whose adjudication identity matches the fresh assembly. The identity is deterministic across drains: `run_id` defaults to the issue id, and the A/B coin swap is seeded by `orderSeed(runId, windowStart, case_id)`. The pieces are all on disk. What is missing is the routing: nothing tells the resumed build that the judge was mid-flight, so it goes back into the dialogue loop.

**Problem.** A judge pass can take about six foreground calls per case, so a build turn can end between two `--assemble` calls, and graft then takes the `built-but-not-admitted` hold. On the next drain the Step 3 resume-store fallback branches on `cause: build-review-dialogue` and always re-enters the dialogue loop at `dialogue.next_round` (`plugin/skills/faff-graft/SKILL.md` line 204). That runs a fresh reviewer round, which changes the adjudication set, so the next judge pass mismatches the persisted ledger and starts over: every earlier ruling is swept and its calls are spent again. This change records in the hold record that the judge was in progress and sends that resume straight back into the chunked judge loop. It also reopens judge cases that were parked only because the backend was unreachable, once per hold.

### Design principles

- **Disk decides, the record cross-checks.** The FAFF-1314 rule applies here too. Whether the judge was in progress is derived from the presence of `build-review/judge/ledger.json` by the CLI at stash time, never from a flag the agent supplies.
- **The hold limit stays a real ceiling.** Every new retry this change allows is counted against `graft.build_review_hold_limit`, which never resets on a resume.
- **Only reopen what a later drain can fix.** A case parked because the backend was down or unconfigured may succeed later. A case parked because of its own content (an invalid reconstruction, a malformed verdict block, a `park` disposition) would fail the same way again, so it stays parked.
- **Fail closed toward a human.** A store whose record says "judge" but which carries no ledger is refused, and refusal parks `needs-human` through graft's existing restore-refusal routing.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/resume-store.js` (`stash`, `restore`, `holdRecordProblem`) | JS | Writes and validates the hold record this change extends |
| `plugin/skills/faff/bin/lib/build-judge-evidence.js` (`cmdAssemble`, `runPhase`, `dispatchOne`, `parkedOutcome`, `adjudicationIdentity`) | JS | Ledger resume, park causes, and the call summary this change extends |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (`judgeDispatchDisposition`) | JS | Single source of which exits retry (5 unreachable, 8 deadline) and which park |
| `plugin/skills/faff-graft/SKILL.md` lines 201-204 (resume-store fallback), 496-505 (dialogue loop, judge, chunked calls), 513-516 (the hold), 876 (return values) | Markdown | The prose sites this change edits |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (`SKILL_LINE_BASELINE`) | JS | `faff-graft` baseline is 896; the file is 895 lines today |
| `docs/guide/cli.md` (`resume-store` and `build-judge-evidence` rows) | Markdown | CLI reference rows to update |
| `test/resume-store.test.mjs`, `test/build-judge-evidence.test.mjs` | JS | Existing test files and helpers to extend |

**Scope.** Two CLI changes (one hold-record field, one `--assemble` flag plus a park classification) and in-place prose edits to faff-graft's autonomous resume path. Interactive graft never holds, so it is untouched.

## 2. OUT OF SCOPE

- **Pushing review fix commits before a hold.** Fix commits made in the dialogue loop are not pushed until Step 9b, and the build-progress checkpoint is written once at Step 8b. After a fix round, a resumed worktree may therefore lack the fix commits, or Step 3 may rebuild from scratch. Why excluded: FAFF-1325 (graft pushes each code-review fix as it lands, and refreshes the checkpoint) is that fix, and the gap affects FAFF-1314's dialogue resume equally. For this change it means a judge-stage resume after a fix round sees a live diff different from the pre-hold judge's, so the judge starts a fresh pass over the code that will actually ship: today's cost, never a wrong admit (see Failure modes). Once FAFF-1325 ships, that case resumes the ledger too. Extension point: FAFF-1325.
- **Re-acquiring the build claim on a resumed run.** Why excluded: pre-existing, and tracked as FAFF-1330. Extension point: the Step 3 resume-store fallback, before the worktree is recreated.
- **Reopening case-level parks.** Parks caused by the case's own content are never reopened (see the design principles). Extension point: the `park_class` value set in `build-judge-evidence.js`.
- **Changing the hold-notice wording by stage.** The hold comment stays "build-review dialogue pending; held (n/N)". Why excluded: cosmetic, and no consumer parses it. Extension point: faff-graft line 516.
- **A schema file for the hold record.** It stays resume class, not evidence class, as FAFF-1314 ruled. Extension point: `plugin/skills/faff/contracts/`.
- **Spec-side judge (`spec-judge-evidence`).** Its dispatch loop lives in faff-prep's prose, not a resumable CLI. Why excluded: a different hold (`spec-review-hold.json`) and different mechanics. Extension point: faff-prep's Spec-review judge section.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Hold record | `.faff/resume/<ISSUE>/hold.json`, written only by `faff resume-store stash` (FAFF-1314). |
| Judge ledger | `<run-dir>/<ISSUE>/build-review/judge/ledger.json`, written by `faff build-judge-evidence --assemble`. |
| Judge-stage hold | A `build-review-dialogue` hold taken while a judge ledger exists in the issue dir. |
| Outage park | A judge case parked because its phase's bounded retries ran out on retry-class exits, or because an attempt was killed before it finished. |
| Backend-chain park | A judge case parked because the adversarial backend chain was unset or malformed. |
| Final park | Any other judge park: invalid reconstruction, malformed or missing verdict block, a `park` disposition, a missing reconstruction on resume. |

### Hold record: the new `stage` field

```
RECORD HoldRecord.dialogue:            # existing object, present when build-review/ holds a round file
  hold_count: Int >= 0                 # unchanged
  next_round: Int >= 2                 # unchanged
  fix_rounds_used: Int >= 0            # unchanged
  rebuttal_rounds_used: Int >= 0       # unchanged
  stage: "dialogue" | "judge"          # NEW. Derived by stash, never passed in.

  CONSTRAINT stage is present exactly when dialogue is present
  CONSTRAINT when present: stage == "judge"  IFF  <issue-dir>/build-review/judge/ledger.json is a regular file at stash time
  CONSTRAINT absent stage reads as "dialogue"   # records written before this change
  # A record with no dialogue object (no round files) carries no stage, whatever judge/ holds.
  # The judge only runs after at least one round, so a judge ledger with no round file is not
  # reachable by graft; neither holdRecordProblem nor prove_stage treats it as an error.
  # The other side of the first constraint IS an error: a record carrying a stage outside a
  # dialogue object (a top-level `stage`, or `stage` with no `dialogue`) is rejected (exit 2).
```

- `stash` writes `stage` whenever it writes `dialogue` (both causes). Graft only branches on it in the `build-review-dialogue` resume arm.
- `holdRecordProblem` accepts an absent `stage`, rejects any present value other than `"dialogue"` or `"judge"`, and rejects a record that carries a `stage` with no `dialogue` object (each a fault, exit 2). Without that last rule, such a record would restore as an apparent legacy dialogue hold and skip the judge-ledger proof.
- `restore` and `read` print the record unchanged, `stage` included. No new flag on any subcommand.

**Chosen:** the hold record carries `dialogue.stage`, derived by the stash from the ledger's presence. The issue's open question was "the resume stash, or the judge dir's ledger alone". The answer is both: the ledger is the source and the record states the fact. The ledger alone would work for routing, but the issue's acceptance needs the hold to record it, `faff resume-store read` can then show a judge-stage hold without walking the store, and restore can prove the ledger travelled with the record.

**Chosen:** a record with `stage: "judge"` whose store has no `build-review/judge/ledger.json` is refused by `restore` with exit 1 (`judge-stage store without a judge ledger`). The check runs on the stashed store and again on the staged copy, the same way `proveRounds` runs today, and the run dir is left unchanged. Graft already routes `restore` exit 1 to a `needs-human` park. Refusing is better than falling back to the dialogue: a hold record and store that disagree have been tampered with or torn, and silently downgrading would hide it.

### `build-judge-evidence --assemble`: park classes and `--reopen-for-hold`

```
ENUM ParkClass:
  outage          # runPhase exhausted its (retry_limit + 1) attempts: last exit retry-class (5, 8),
                  #   or an attempt that never recorded an exit (killed mid-call)
  backend-chain   # resolveAdversarialBackends returned an error (unset or malformed)
  final           # every other dispatch-time park

RECORD LedgerEntry:                    # existing; additions only
  park_class?: ParkClass               # NEW. Written next to park_cause whenever dispatch parks an entry.
                                       #   Absent on assemble-time parks and on ledgers written before
                                       #   this change. Absent means "never reopened".
  reopen_count?: Int >= 1              # NEW. Times this entry was reopened. Audit only.

RECORD Ledger:                         # existing; additions only
  reopened_for_holds?: List<Int>       # NEW. Hold counts a reopen has already run for. Makes the flag idempotent.

FLAG --reopen-for-hold <n>             # NEW. n is an integer >= 1 (else a usage error, exit 2).
```

- `adjudicationIdentity` is unchanged. The new fields never affect whether a ledger resumes.
- The call summary gains `reopened: [case_id, ...]`, always present and `[]` when nothing was reopened. Every existing summary field is unchanged.

**Chosen:** a resumed judge reopens outage parks and backend-chain parks, once per hold. This answers FAFF-1246's review note. Within one drain, keeping every park is what bounds retries across calls, and that stays true. A hold, though, is exactly the "try again later" moment a transient outage needs, and without a reopen a judge-stage resume with one outage park can only end in a `needs-human` park, even when the backend has come back. Final parks are not reopened, because the same input would fail the same way.

**Chosen:** the park class is a structured `park_class` field stamped when the park happens, not parsed back out of `park_cause`. The cause strings are human-readable. A FAFF-1244 test pins one of them byte-for-byte, and parsing them would couple the reopen to their wording. An entry with no `park_class` is never reopened, which covers assemble-time parks and legacy ledgers without any special case.

**Chosen:** reopening is gated by `--reopen-for-hold <n>`, idempotent per hold count, rather than by a bare flag. Graft passes the restored `dialogue.hold_count` on every `--assemble` call of a judge-stage resume, and the CLI reopens only if `n` is not already in `ledger.reopened_for_holds`. A prose rule like "pass it on the first call only" would be easy to get wrong. With the hold count, a repeated call is a no-op, and the number of reopens is mechanically capped at the number of distinct holds.

## 4. HOW

### Stash derives the stage

`stash` computes the stage before taking the lock, from the same `src` issue dir it already reads to count rounds.

```
PROCEDURE stash_stage(src):
  1. ledger := src/build-review/judge/ledger.json
  2. IF lstat(ledger) is a regular file -> "judge"
  3. ELSE -> "dialogue"          # absent, a directory, or a symlink
  4. record.dialogue.stage := that value, whenever record.dialogue is written
```

A symlinked ledger is not followed, which matches the copy rules (symlinks are skipped, so a symlinked ledger would not travel anyway).

### Restore proves the ledger travelled

```
PROCEDURE prove_stage(dir, rec, where):           # called next to proveRounds, on "stashed" then "staged"
  1. IF rec.dialogue AND rec.dialogue.stage == "judge"
       AND dir/build-review/judge/ledger.json is not a regular file:
       refuse("<where> judge-stage store without a judge ledger")    # exit 1, run dir unchanged
```

### Graft routes a judge-stage resume into the judge

The Step 3 `cause: build-review-dialogue` arm branches on the printed `dialogue.stage`:

```
PROCEDURE resume_build_review_dialogue(rec):      # after restore exit 0, "resumed from store" logged
  1. worktree from the existing branch; skip Steps 4-8 (unchanged)
  2. seed {fix_rounds_used, rebuttal_rounds_used, hold_count} from rec.dialogue; caps not reset (unchanged)
  3. IF rec.dialogue.stage == "judge":
       a. do NOT re-enter the dialogue loop and do NOT run a reviewer round
       b. capture the judge --diff file with the Remote-backed review diff block in the resumed
          worktree (`git diff <remote-base>...HEAD`), the same block that produced the pre-hold
          judge's --diff in Step 9
       c. run Step 9's chunked judge loop with Step 9's own --assemble invocation, verbatim, adding
          only `--reopen-for-hold <rec.dialogue.hold_count>`. Today that invocation is
          `--assemble --dir <run_dir>/<ISSUE>/build-review --issue <ISSUE> --diff <diff-file>`:
          no --run-id, no --window-start, no --acceptance-criteria, no --repository-evidence.
          Whatever flag set Step 9 passes, the resume passes the same set, because any
          difference changes the ledger identity
       d. then `--admit`, routed exactly as today: admit -> evidence write + Step 9b;
          not admit (exit 1 or 2) -> the needs-human park
       e. a turn that ends mid-loop again -> the built-but-not-admitted hold, unchanged
          (the stash sees the ledger, so it records stage "judge" again and increments hold_count)
  4. ELSE (stage "dialogue" or absent): re-enter the dialogue loop at rec.dialogue.next_round (unchanged)
```

**Chosen:** a judge-stage resume skips the dialogue loop entirely. The judge only ever runs at the loop's stop (churn, convergence failing to yield, or the rebuttal cap) and is terminal: it admits or parks. Once a ledger exists, the dialogue is over, and another reviewer round would only change the adjudication set and throw away the judge's progress.

**Chosen:** on a judge-stage resume, the judge's `--diff` is recaptured live from the resumed worktree with the Remote-backed review diff block (`git diff <remote-base>...HEAD`), the same block and the same command Step 9 uses for the pre-hold judge. When the resumed worktree holds the same commits as before the hold (no fix round ran, or FAFF-1325 pushed them), the bytes are identical, `pre_ruling_diff_sha` matches and the ledger resumes. When it does not, the identity mismatches and `--assemble` starts a fresh pass over the code that will actually ship. That costs what today's behaviour costs and can never admit a diff the branch does not hold. The three-dot form diffs from the merge base, so the default branch advancing during the hold does not change the bytes.

### Assemble reopens once per hold

The reopen runs inside `cmdAssemble` after the identity check has decided `resumed`, and before the backend chain is resolved, so a reopened backend-chain park whose config is still unset is re-parked by the existing code with no call made.

```
PROCEDURE reopen_for_hold(ledger, resumed, n):    # n from --reopen-for-hold; skipped when the flag is absent
  0. IF n > graft.build_review_hold_limit (read in-process, the build_judge_retry_limit precedent):
       warn on stderr; return []                  # no hold beyond the limit can exist, so nothing to reopen
  1. done := ledger.reopened_for_holds or []
  2. IF NOT resumed:                              # a fresh pass already gets a full budget for this hold
       ledger.reopened_for_holds := [n]; persist; return []
  3. IF n IN done -> return []                    # this hold already reopened; idempotent
  4. reopened := []
  5. FOR cid IN ledger.order:
       e := ledger.entries[cid]
       IF e.resolution == "parked" AND e.park_class IN {"outage", "backend-chain"}:
         p := e.judge_progress or {phase1_attempts: 0, phase2_attempts: 0, last_exit: null, reconstruction: null}
         IF p.reconstruction: p.phase2_attempts := 0     # Phase 1 succeeded; its bound recon file is kept
         ELSE: p.phase1_attempts := 0; p.phase2_attempts := 0
         p.last_exit := null
         e.judge_progress := p
         e.resolution := "pending"; delete e.park_cause; delete e.park_class
         e.reopen_count := (e.reopen_count or 0) + 1
         reopened.append(cid)
  6. ledger.reopened_for_holds := done + [n]      # recorded even when nothing was reopened
  7. persist the ledger (the existing tmp + rename)
  8. return reopened                              # printed as the summary's `reopened`
```

Where `park_class` is stamped:

| Park site in `build-judge-evidence.js` | `park_class` |
|---|---|
| `runPhase` returns `exhausted` (both cause shapes) | `outage` |
| Backend chain resolve returns `error` (unset or malformed) | `backend-chain` |
| `dispatchOne`: disposition other than `ruling`, invalid reconstruction, unbound or missing reconstruction on resume, verdict block parse failure | `final` |
| `assembleBuildCaseFiles` parks at assembly | none (absent) |

The missing-reconstruction park stays `final` on purpose. FAFF-1246 chose to park it rather than re-run Phase 1, because it only arises when something outside the judge deletes or rewrites `recon-<case_id>.json`. Reopening it would quietly repair that interference instead of surfacing it, against the fail-closed principle above.

**Bound.** Per case and per phase, attempts never exceed `(graft.build_review_hold_limit + 1) x (graft.build_judge_retry_limit + 1)`: one budget for the original pass plus one per distinct hold, and graft parks `needs-human` once `hold_count` reaches the limit. At the defaults (2 and 2) that is 9. The CLI enforces the ceiling itself: it never reopens for an `n` above `graft.build_review_hold_limit`, so a caller passing a wrong `n` cannot buy budgets past the limit. Each hold gets exactly one extra budget, either a reopen or a fresh pass, never both. When a resume mismatches the ledger, the fresh pass records `n` in its new ledger, so a later chunk call of the same resume that now matches does not reopen again.

**Anti-pattern:** clearing the judge dir, or passing a per-drain `--run-id`, to force a re-judge. Why: either one throws away every completed ruling and Phase-1 reconstruction (two backend calls each), and a new `run_id` also re-seeds the A/B coin swap, so cases already judged would be judged again in a different order.

**The identity is the mechanical backstop.** The rule that the resume arm passes Step 9's invocation verbatim is prose across two SKILL.md sites, but any drift in a flag that feeds the ledger identity cannot cause a wrong ruling: it surfaces as `resumed: false` and a fresh pass. The prose rule exists to keep the saving, not to keep the result correct.

**Anti-pattern:** reopening on every `--assemble` call. Why: it undoes FAFF-1246's bound across calls, and graft's chunk loop (stop when `attempts_remaining` does not fall) would see the count jump and stop early.

### Graft prose edits

All edits land in faff-graft's autonomous paths, in place:

- **Line 204 (`cause: build-review-dialogue` arm):** add the `dialogue.stage` branch from `resume_build_review_dialogue` above.
- **Line 501 (the would-be-park judge):** name the judge's `--diff` as the file the Remote-backed review diff block captured for the latest review round. This states what the step already consumes, so the resume arm can point at the same source.
- **Line 876 (`built-but-not-admitted` return value):** "resumes the dialogue loop at the stashed `next_round`" becomes "resumes the dialogue loop at the stashed `next_round`, or the judge when `dialogue.stage` is `judge`".

The file is 895 lines against a baseline of 896. If the edits cannot stay within one added line, raise `SKILL_LINE_BASELINE["faff-graft"]` by the exact amount, with a `FAFF-1249 +N faff-graft (...)` note in the existing comment, following its convention.

### Edge cases

- **Ledger present but malformed.** The stash still records `stage: "judge"` (presence is the signal). On resume, `--assemble` reads it as a mismatch, sweeps, and starts a fresh pass. `--reopen-for-hold n` then reopens nothing and records `n` in the fresh ledger.
- **The hold was taken after `--assemble` finished but before `--admit` ran.** On resume, `--assemble` resumes with nothing pending and exits 0 without a call, and `--admit` runs as normal.
- **The hold was taken after `--admit` ran but before graft acted on it.** `--admit` is a pure roll-up over the ledger and rulings, so running it again gives the same result.
- **A `review-outage` hold whose issue dir holds a judge ledger.** Not reachable today (a review outage happens inside a reviewer round, and the judge only runs after the loop stops). The stash records the stage anyway, and the `review-outage` resume arm ignores it.
- **Store with a pre-change hold record (no `stage`).** Reads as `dialogue` and resumes into the dialogue loop, exactly as today.
- **`--reopen-for-hold` with a value that is not an integer >= 1.** Usage error, exit 2, before any file is touched (the `--budget-secs` precedent).

### Failure modes

- **The failure:** the resumed judge's identity does not match the persisted ledger after all. The expected cause is a fix round before the hold whose commits did not survive into the resumed worktree (until FAFF-1325 ships); another is a drift between Step 9's invocation and the resume arm's. **How you'd know:** the first `--assemble` after a judge-stage resume prints `resumed: false`; graft logs the summary to `graft.md`. **What it means:** proceed. The pass starts fresh over the code that will ship and still runs inside the hold limit; it only costs calls. If it shows up without a fix round, compare the two invocations.
- **The failure:** reopened outage parks fail again because the outage outlasts every hold. **How you'd know:** `reopen_count` equals the number of holds on the parked entries in the final ledger, and the issue parks `needs-human` with an outage `park_cause`. **What it means:** the design works as bounded. A persistent outage reaches a human after at most `hold_limit` extra attempts per case.
- **The failure:** graft passes the wrong hold count (for example one it never restored). **How you'd know:** `reopened_for_holds` holds a value that matches no hold record. **What it means:** still bounded, since each value reopens at most once and holds stop at the limit. Correct the prose.

## 5. SCENARIOS

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an issue dir whose build-review/ holds round-1.json and round-2.json and whose build-review/judge/ holds ledger.json
When `faff resume-store stash --cause build-review-dialogue --fix-rounds-used 1 --rebuttal-rounds-used 1` runs
Then the printed hold record has dialogue.stage "judge", next_round 3 and hold_count 1
```

```
Given a judge ledger from an earlier --assemble call in which case-1 was parked with park_class "outage" after three retry-class exits on Phase 1 (no reconstruction persisted), and case-2 was ruled OVERTURN
When --assemble is called again with unchanged inputs and --reopen-for-hold 1
Then case-1 is dispatched again starting from attempt 1 of its failed phase, case-2 is not dispatched, the summary prints reopened ["case-1"], and the ledger records reopened_for_holds [1] and reopen_count 1 on case-1
```

```
Given the same judge dir after that call
When --assemble is called a third time with --reopen-for-hold 1
Then nothing is reopened, the summary prints reopened [], and case-1 keeps the attempt count the second call left
```

```
Given a resumed judge ledger in which case-1 was parked with park_class "final" (a verdict block that did not parse)
When --assemble is called with --reopen-for-hold 1
Then case-1 stays parked with its park_cause unchanged, the summary prints reopened [], and no review-call is made for case-1
```

```
Given a judge dir left by an identity mismatch: the first --assemble of a resume called with --reopen-for-hold 1 swept the old ledger, started a fresh pass, parked case-1 as an outage and exited 3
When the next chunk call runs with the same arguments and the fresh ledger now resumes
Then nothing is reopened, because the fresh ledger already records reopened_for_holds [1]
```

```
Given a resumed judge ledger with case-1 parked as an outage and graft.build_review_hold_limit at its default of 2
When --assemble is called with --reopen-for-hold 3
Then case-1 stays parked, reopened_for_holds is unchanged, the summary prints reopened [], and stderr names the hold limit
```

```
Given an issue carrying the awaiting-adjudication role whose resume store holds a hold record with dialogue.stage "judge", next_round 3 and a judge ledger
When an autonomous drain re-picks the issue and graft's Step 3 restores the store
Then graft.md logs "resumed from store", the next build-review commands are build-judge-evidence --assemble calls carrying --reopen-for-hold, and build-review/ holds no round-3.json when --admit runs
```

## 6. DESIGN DECISION RATIONALE

**Where does the hold record that the judge was in progress?**
- A flag the agent passes to `stash` (`--stage judge`): simple, but agent-supplied and able to drift from disk.
- The judge ledger alone, read by graft after restore: no record change, but the hold itself does not state the fact, and nothing proves the ledger travelled.
- A record field derived from the ledger by the stash: the hold states the fact and disk stays the source.
- **Chosen:** a `dialogue.stage` field derived by the stash. It follows FAFF-1314's "disk is the round counter" rule.

**What happens when the record says judge but the ledger is missing?**
- Fall back to the dialogue loop: keeps going, but hides a torn or tampered store and discards the judge pass silently.
- Refuse the restore: parks `needs-human` through existing routing.
- **Chosen:** refuse, matching how `proveRounds` treats a rounds/record disagreement.

**Where does a judge-stage resume re-enter?**
- The dialogue loop at `next_round` (today): a new reviewer round changes the adjudication set and sweeps the ledger.
- The chunked judge loop: picks up from the persisted ledger.
- **Chosen:** the chunked judge loop, then `--admit`. The judge is terminal, so the dialogue is already over.

**Which diff does the resumed judge get?**
- The build-progress diff of the remote branch (`$base...$fref`): its hash was checked at Step 3, but against a checkpoint written before the dialogue loop, so it says nothing about the pre-hold judge's bytes, and it is a different command from Step 9's.
- A copy of the pre-hold judge's diff bytes carried in the store: always resumes, but could rule on a diff the resumed branch no longer holds (lost fix commits) and admit it.
- The live Remote-backed review diff of the resumed worktree, the same block Step 9 uses: resumes whenever the code is unchanged, starts a fresh pass whenever it changed.
- **Chosen:** the live review diff. Correctness first: the judge always rules on the code that will ship. FAFF-1325 extends the resume to the fix-round case.

**Should a hold's resume re-judge outage-parked cases?** (FAFF-1246 review note, 2026-10-09)
- Keep every park (today): bounded, but an outage park can only end in a `needs-human` park even after the backend recovers.
- Clear the judge dir, or change identity: re-judges, but throws away every completed ruling and reconstruction and re-seeds the coin swap.
- Reopen only outage and backend-chain parks, once per hold: re-judges what a later drain can fix and keeps what is settled.
- **Chosen:** reopen outage and backend-chain parks, once per hold, still bounded by `graft.build_review_hold_limit`.

**How does `--assemble` know which parks are reopenable?**
- Parse `park_cause`: no schema change, but couples the reopen to human-readable wording that a FAFF-1244 test pins.
- A structured `park_class` stamped at park time.
- **Chosen:** `park_class`, with absent meaning never reopen.

**How is "once per hold" enforced?**
- Prose: graft passes a bare flag on the first call only. Easy to get wrong.
- `--reopen-for-hold <hold_count>`, recorded in the ledger. Idempotent per hold.
- **Chosen:** `--reopen-for-hold <n>` with `ledger.reopened_for_holds`.

**Is a missing Phase-1 reconstruction on resume reopenable?**
- Reopen it and re-run Phase 1: repairs the case for one call, but silently papers over outside interference with the judge dir.
- Keep it `final`: the case parks, a human sees the cause.
- **Chosen:** keep it `final`, as FAFF-1246 decided.

**What does a reopen reset?**
- Every counter and the reconstruction: re-runs Phase 1 even when it already succeeded.
- Only the failed phase's counter, keeping a bound reconstruction.
- **Chosen:** reset only the failed phase, matching FAFF-1246's choice to resume at Phase 2 rather than spend Phase 1 again.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:** none. Every system named above was read on main at 92d1fc52.

## 8. DONE

### From WHY
- [ ] A build held while the judge was mid-assemble resumes into `--assemble`, not a reviewer round: between `faff resume-store restore` exiting 0 and the first `--admit` call, no new `round-<n>.json` appears in `build-review/`.
- [ ] `graft.build_review_hold_limit` still bounds the judge-stage path: a third consecutive judge-stage hold at the default limit of 2 parks `needs-human`.

### From WHAT (hold record)
- [ ] `stash` writes `dialogue.stage` whenever it writes `dialogue`, for either cause: `"judge"` when `build-review/judge/ledger.json` is a regular file in the issue dir, `"dialogue"` otherwise (absent, a directory or a symlink). A record with no `dialogue` carries no `stage`.
- [ ] `stash` takes no new flag; `stage` is never read from argv.
- [ ] `holdRecordProblem` accepts an absent `stage`, accepts `"dialogue"` and `"judge"`, and rejects any other value (`read` and `restore` exit 2).
- [ ] Torn-record check: a hold record with a `stage` present but no `dialogue` object is rejected, so `read` and `restore` exit 2 and the run dir is unchanged.
- [ ] A pre-change record with no `stage` restores and reads exactly as before.
- [ ] `restore` exits 1 with the run dir unchanged when the record says `judge` and the stashed store has no `build-review/judge/ledger.json`.
- [ ] `restore` exits 1 with the run dir unchanged when the staged copy has no judge ledger (checked like `proveRounds`' staged check).

### From WHAT (assemble)
- [ ] Every dispatch-time park writes `park_class`: `outage` for `runPhase` exhaustion (both cause shapes), `backend-chain` for an unset or malformed backend chain, `final` for every other dispatch park.
- [ ] Assemble-time parks from `assembleBuildCaseFiles` carry no `park_class`.
- [ ] `--reopen-for-hold` accepts an integer >= 1; any other value is a usage error, exit 2, with no file written.
- [ ] `adjudicationIdentity` is byte-identical to before (the new fields do not affect resume).
- [ ] The summary always carries `reopened` (`[]` when nothing was reopened); every existing field keeps its meaning.
- [ ] `park_cause` strings are byte-identical to before.

### From HOW (reopen behaviour)
- [ ] With `--reopen-for-hold n` on a resumed ledger, every `outage` or `backend-chain` parked entry becomes `pending`, loses `park_cause` and `park_class`, gains `reopen_count + 1`, and is dispatched in the same call.
- [ ] A reopened entry with a persisted reconstruction resets only `phase2_attempts`, keeps `recon-<case_id>.json`, and makes no Phase-1 call.
- [ ] A reopened entry without a reconstruction resets both phase counters and starts at Phase 1.
- [ ] `final` parks and entries with no `park_class` are never reopened.
- [ ] A second call with the same `n` reopens nothing; `ledger.reopened_for_holds` holds `n` once.
- [ ] A call with `n` above `graft.build_review_hold_limit` reopens nothing, records nothing and prints a stderr warning; the call otherwise proceeds.
- [ ] On a fresh (non-resumed) ledger the flag reopens nothing and sets `reopened_for_holds` to `[n]`, so a later call with the same `n` that resumes that ledger reopens nothing either.
- [ ] A reopened `backend-chain` entry whose chain is still unset is re-parked with `park_class: "backend-chain"` and no review-call is spawned.
- [ ] The ledger with the reopen applied is persisted before the first dispatch of that call.

### From HOW (graft prose)
- [ ] faff-graft line 204's `build-review-dialogue` arm branches on `dialogue.stage`: `judge` goes to the chunked judge loop with `--reopen-for-hold <hold_count>` on every `--assemble` call, then `--admit`; `dialogue` or absent re-enters the dialogue loop as today.
- [ ] The resumed judge's `--assemble` arguments carry no `--run-id`, `--window-start`, `--acceptance-criteria` or `--repository-evidence` (matching Step 9 today).
- [ ] faff-graft's judge-stage resume arm captures `--diff` with the Remote-backed review diff block in the resumed worktree, and line 501 names that same block as the in-drain judge's `--diff` source.
- [ ] The resume arm's `--assemble` invocation is Step 9's invocation verbatim plus `--reopen-for-hold`; the prose states the two must carry the same flag set.
- [ ] faff-graft's `built-but-not-admitted` return value names the judge-stage resume.
- [ ] `faff validate-adapters` passes; any `SKILL_LINE_BASELINE["faff-graft"]` change is exact and carries a `FAFF-1249` note.
- [ ] `docs/guide/cli.md` documents `dialogue.stage` on the `resume-store` row, and `--reopen-for-hold`, `park_class` and `reopened` on the `build-judge-evidence` row.

### From HOW (tests)
- [ ] `test/resume-store.test.mjs` covers: stage `judge` and `dialogue` at stash; a symlinked ledger reads as `dialogue`; a legacy record without `stage`; an out-of-enum `stage` (exit 2); a `stage` with no `dialogue` object (exit 2); the stashed and staged missing-ledger refusals.
- [ ] `test/build-judge-evidence.test.mjs` covers: `park_class` at each park site; reopen of `outage` with and without a reconstruction; reopen of `backend-chain` re-parking with no spawn; `final` and absent-class never reopened; idempotence on a repeated `n`; a fresh ledger records `n` and a later matching call does not reopen; the usage error; `park_cause` strings unchanged (the existing FAFF-1244 exhausted-cause assertion still passes).
- [ ] `faff resume-store --selftest` and the full `node --test test/` suite pass.

### Integration smoke test

```
1. Build an issue dir with build-review/round-1.json, round-2.json (a standing critical) and run
   --assemble with an injected review-call that exits 5 on every Phase-1 attempt: the entry parks
   with park_class "outage".
2. faff resume-store stash --cause build-review-dialogue ...   -> dialogue.stage "judge", hold_count 1
3. faff resume-store restore into a fresh run dir              -> exit 0, the judge ledger is back
4. --assemble with --reopen-for-hold 1 and a review-call that now succeeds
                                                               -> resumed true, reopened [case], ruling written
5. --admit                                                     -> exit 0 on an OVERTURN ruling
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4).** The spec carries two concerns. The first routes a judge-stage resume back into the judge, through the hold record's `dialogue.stage` and graft's resume arm. The second reopens outage and backend-chain parks once per hold, through `park_class` and `--reopen-for-hold`. The second only has an effect on a judge-stage resume, so it cannot ship value without the first, and it is small: one flag, one classification, one reset routine. Together they fit a 1-3 day unit. No split is needed. If the build overruns, the reopen is the clean place to cut, because it sits entirely behind its own flag.
- **Workstream fit (principles 1 and 5).** The issue has no project. It belongs with the build-judge resumability work (FAFF-996, FAFF-1246, FAFF-1314), all of which is Done. No issues.
- **Surfaced dependencies (principle 6).** The description names FAFF-1246 as a blocker. FAFF-1246 is Done and no live blocker link remains. FAFF-1325 (graft pushes each code-review fix as it lands) and FAFF-1330 (a resumed build holds no build claim) are related but not load-bearing. Without FAFF-1325, a judge-stage resume after a fix round starts a fresh judge pass instead of resuming, and the spec states that. Sequencing FAFF-1325 first would widen the benefit, but this ticket does not need to wait for it. No issues.
- **Risk profile (principle 7).** No novel integration and no external dependency. The main risk is getting the retry bound wrong, and the DONE items pin it with tests. No de-risking spike is needed.

confidence: high
build-tier: complex
spec-review: accept (judge, L3-provisional)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
