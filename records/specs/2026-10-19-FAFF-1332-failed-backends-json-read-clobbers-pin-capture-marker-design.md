# FAFF-1332: a failed `--backends-json` read clobbers a healthy pin-capture marker

> Spec: faffter-dark-nlspec · 2026-10-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1332.

This spec is the build document for FAFF-1332. It is written for the build agent that will change
`plugin/skills/faff/bin/lib/spec-review-pin.js`, and for the human reviewer who needs to see that the
remedy does not quietly undo what FAFF-1052 put in place. Line numbers are given throughout so every
claim can be re-checked rather than trusted.

**Read a checkout that contains `3501de7f`, which `origin/main` does.** FAFF-1324 (`3501de7f`, "an
unvouchable pin marker narrows the window to n", merged 2026-10-17) rewrote the exact
`spec-review-window.js` governor arm this ticket's defect lands on. The post-FAFF-1324 behaviour is
normative for this build and every citation below is to it; read each file with `git show
origin/main:<path>`. A checkout predating `3501de7f` has `capRound = 1` on that arm and no
`unpinnable-reset`, so it measures a smaller defect than the one this ticket closes: confirm with
`git merge-base --is-ancestor 3501de7f HEAD` before measuring anything. The commit is named rather
than a branch head because a ref moves and a SHA does not. FAFF-1324 touched only
`spec-review-window.js` and its own test, so `spec-review-pin.js`, `spec-review-convergence.js`,
`faff-prep/SKILL.md`, `faffter-dark-spec-review/SKILL.md`, `test/spec-review-pin.test.mjs` and
`test/spec-review-occupant-served-dispatch.test.mjs` need no special care.

## WHY: problem and principles

**The load-bearing model.** `pin-capture.json` is a single-slot file. It holds one marker describing
the most recent capture attempt, and the window governor branches on just two of its fields, `state`
and `round`. Because the slot is single, any writer that fills it with a fresh marker destroys what
the previous writer recorded. The pin itself lives in a different file, `pinned-reviewer.json`, and
survives. So the two files can disagree: a pin on disk beside a marker that no longer says
`captured`. The governor treats that disagreement as a reason to stop trusting the pin, narrows the
convergence window to the round it is governing, and because nothing ever repairs the marker it does
so again on every later round of the loop. Every bug on this surface, this one included, is a writer
filling the single slot when it should have written beside what was already there.

**The problem.** In the served `--capture` path, a failed read or parse of `--backends-json` writes
`{state:"failed", round, reason, ts}` into `pin-capture.json` before exiting 2
(`spec-review-pin.js:382`), and that write is unguarded: the catch block in `cmdSpecReviewPin` does
not consult the prior marker, and `pinned-reviewer.json`'s path is not in scope in that function. It
also runs before `capturePin` is called at `:386`, so `capturePin`'s pin-exists early return cannot
protect the marker. A healthy `{state:"captured", round:1}` from an earlier round is therefore
replaced by a later round's read failure. This spec makes that write preserve an established capture
instead of replacing it, exactly as the sibling no-lens writer was taught to do in FAFF-1323.

**What goes wrong downstream, and why it never heals.** Once the marker reads `failed` while a pin
exists, every later served round takes the governor's unvouchable-marker arm at
`spec-review-window.js:247`: `capRound = n`, and `anomaly = "pin-marker-contradiction"`. Because
`ws < n` for any later round, the advance rule at `:251` then fires with a non-null anomaly, so
`window_start` is narrowed to `n` and `action` is recorded as `"unpinnable-reset"` rather than
`"late-pin-advance"`. The record also carries `capture_state: "failed"` and `capture_round: n` instead
of `"captured"` and the real pinning round (`captureCrossRefs`, `:162-167`), and prep surfaces the
anomaly into `prep.md` as a loud finding (`faff-prep/SKILL.md:126`). Nothing repairs the marker,
because `capturePin` is a marker no-op once a pin exists, so every later round re-narrows the window
to itself. That is the latch: the window always holds exactly one round record, and the narrowing is
exactly the behaviour FAFF-1324 deliberately introduced for a marker that cannot vouch for the pin's
capture round.

**What the latch costs, verified down the chain.** A one-round window is a window convergence cannot
read. `faff spec-review-convergence --dir <scratch> --window-start <ws>` filters the round records to
`n >= window_start` (`spec-review-convergence.js:375`), and with fewer than two records in window
`detectSpecReviewConvergence` returns `converging: false` with the reason `need >=2 rounds to assess
a trend` (`:84-95`, and the CLI comment at `:334-335` names this case explicitly). Prep runs exactly
that call at the loop-cap would-be-park point (`faff-prep/SKILL.md:210`), so the loop-cap convergence
yield can never fire while the marker is clobbered: a genuinely converging spec-review loop is parked
at the appetite ceiling (`faff spec-review-iteration-cap`, 1/3/5/10, `faff-prep/SKILL.md:208`)
instead of being granted the round that would have closed it. The clobber also disables
`late-pin-advance` outright, which is the behaviour FAFF-1323's title names: with a non-null anomaly
the advance branch at `:251` relabels itself `unpinnable-reset`, so a legitimately late pin can never
be advanced to while the marker is unvouchable.

**One piece of local evidence, correctly scoped.** Twelve `pin-marker-contradiction` records exist
across four loops in `.faff/spec-review/` on this machine, all produced by the FAFF-1323 no-lens
writer, and all reading `action: "unchanged"` with the window start unmoved. Those records all
predate FAFF-1324 (FAFF-1212 and FAFF-1216 are 2026-10-12, FAFF-1307 is 2026-10-16; `3501de7f` merged
2026-10-17), so they show what the old soft arm did and are not evidence about post-FAFF-1324
behaviour. They do corroborate that the clobber itself is organically reachable on this surface,
through a sibling writer.

**What this fix does not do: containment, not prevention.** It does not stop the failing round
narrowing its own window. That round has no served-identity sidecar, because the capture aborted
before writing one, so `--govern` takes the `served-identity-missing-or-malformed` fault arm at
`:231-240`, sets `window_start := n` and exits 2, before and after this change alike. That arm is
correct and is out of scope here. What the fix removes is the contradiction persisting: post-fix,
rounds after the failing one come back `anomaly: null`, `action: "unchanged"`, the window keeps its
span and can advance on a legitimate late pin, and convergence has something to read; pre-fix they
report `pin-marker-contradiction` and `unpinnable-reset` forever and the window is stuck at one
round.

**How often this fires, without overselling it.** The trigger is narrow. `$backends_json` is a
`mktemp` file written once per occupant pass by `spec-review-pin --resolve`
(`faffter-dark-spec-review/SKILL.md:65-71`). If resolve fails outright, no lens serves and the
occupant takes the `--no-lens-served` form, which never reaches this code. Reaching the catch block
needs the file to vanish or corrupt between resolve and capture. Measured on the operator's machine
on 2026-10-19: 105 loops in `.faff/spec-review/` established a pin, 88 of them left a
`pin-capture.json`, and of those 83 read `captured`, 4 read `skipped-no-lens` and none read `failed`.
The corpus grows with every prep run, so the totals are a snapshot and the zero is the finding. The
defect is reachable on demand with a deterministic reproduction and has never been observed
organically. Both halves belong in any judgement about priority.

**Eligibility, stated as a fact and left alone.** This ticket's value case is that it is cheap,
deterministic machine work, yet eligibility is fail-safe opt-in and the `faff-automate` label is
absent, so no autonomous drain can pick it up. Applying that label is a human opt-in gesture and is
not an action this spec proposes, recommends or assumes. It is recorded here only so the operator
weighs the ticket knowing it currently competes for human attention.

### Design principles

**Do not drop the write.** The comment at the catch block records that the write exists for
FAFF-1052's never-silent property ("never silent: write pin-capture.json{failed} before the existing
exit 2"), and FAFF-1052's interface section mandates it. The defect FAFF-1052 closed was that a
missing pin from a silent non-run was indistinguishable from one from a legitimate nothing-served
skip. Deleting this write reintroduces exactly that silence, so a remedy that deletes it is not a
remedy.

**FAFF-1052's guarantee is "disk-recorded", not "in the `state` field".** This is what makes a fold
legitimate rather than a breach. FAFF-1052 requires the outcome of every capture attempt to be an
explicit, disk-recorded fact; it does not require the fact to occupy `pin-capture.json`'s `state`
key. What a fold is not is as loud as today, and the loudness decision below treats that honestly
instead of hiding behind this principle.

**FAFF-1052 asserts a co-occurrence invariant that is false, and this ticket is the counterexample.**
FAFF-1052's scenarios state that the CLI's own `--capture` sequence never emits a failed-or-skipped
marker alongside a pin, so a fixture exercising that coexistence tests only reader tolerance of a
synthetic condition. The catch block is a CLI path that emits a `failed` marker alongside a pin.
Resist overclaiming the point: FAFF-1052's non-silence guarantee still holds, it is the narrower
co-occurrence claim that is wrong, and this ticket is what makes it true again for this writer.

**Preserve the guard that already works.** `capturePin`'s own `writeFailedMarker` (`:210-211`) is
called only from the three bad-capture branches, all of which sit after the pin-exists early return
at `:214`, so it cannot run while a pin exists. The ticket's open question about whether that helper
is also unsafe is answered no, and it is not changed here.

### Reference context

| Location | What it is | Relevance |
|---|---|---|
| `spec-review-pin.js:378-385` (catch block in `cmdSpecReviewPin`) | The unguarded `{state:"failed"}` write | The sole production change |
| `spec-review-pin.js:264-273` (`captureNoLensServed`) | The sibling writer FAFF-1323 fixed | The precedent this remedy mirrors |
| `spec-review-pin.js:206-248` (`capturePin`, `writeFailedMarker`) | The positionally-guarded failed-marker writer | Already safe; explicitly unchanged |
| `spec-review-window.js:162-167, 231-255` (`captureCrossRefs`, `govern`), on `origin/main` | The only automated reader of the marker | Branches on `state` and `round` only; `:247` is the post-FAFF-1324 narrowing arm |
| `spec-review-convergence.js:84-95, 375` | The window-bounded convergence read | Why a one-round window costs the loop-cap yield |
| `faff-prep/SKILL.md:126` | Surfaces `result.anomaly` (and the marker's `reason`) into `prep.md` | Fires only when an anomaly is present |
| `test/spec-review-pin.test.mjs:262-301` | FAFF-1323's preserve and replace tests | The shape the new tests copy |
| `test/spec-review-occupant-served-dispatch.test.mjs:44` | Runs the occupant snippet under a test-authored `set -e` | Why the exit code is load-bearing, in the test and nowhere else |

**Build note.** `spec-review-pin.js` has no `.ts` sibling, so per `AGENTS.md` the committed `.js` is
edited directly, no emit rebuild is needed, and `faff regions check` will not fault.

### The cluster, and the sequencing

- **FAFF-1323** (Done) fixed the sibling no-lens clobber and is the source of the preserve-and-fold
  precedent. It left the catch block untouched, which is why this ticket exists.
- **FAFF-1324** (Done, `3501de7f`) settled the governor's disposition toward an unvouchable marker:
  it narrows the window to the round being governed and labels the action `unpinnable-reset`. Settled
  means settled, and it is the reason a clobbered marker bites rather than merely being recorded.
- **FAFF-1052** (Done) added the catch block's write, and is the source of both the binding
  constraint above and the false co-occurrence invariant.
- **FAFF-1331** (Backlog, specced) is the after-the-fact repair of an already-clobbered marker: a
  generic backstop covering every mechanism, including the window between `capturePin`'s pin write
  and its marker write that this ticket cannot reach. A sibling, not a superseding ticket.
- **FAFF-1338** (Backlog) is the scrub-asymmetry false-fire in `spec-review-window.js`, a third
  independent mechanism in the same symptom class, on a different file.

**Why FAFF-1332 before FAFF-1331, on the reason that actually holds.** Not "prevention before
recovery": read straight, the measured evidence favours the recovery half, because FAFF-1331 repairs
a clobbered marker whatever clobbered it while this ticket closes one writer whose organic rate is
zero. The ordering holds because FAFF-1332 is the smaller, uncontested, independently verifiable half
whose completion narrows the mechanism set FAFF-1331's repair must be correct across, while FAFF-1331
is the contested half. Note also that the pairwise comparison omits FAFF-1338 entirely, so
"prevention before recovery" as a rule would rank that third member on a premise nobody measured. The
order is right; the old reason was not, and a corrected reason is what the next sequencing call on
this surface should inherit.

**The boundary with FAFF-1331 is verified, and the tracker does not carry it.** FAFF-1331 carries no
tracker attachment (`attachments: []`); its spec body lives as a series of comments on the issue, so
the citable artifact is **the most recent spec comment on FAFF-1331** and not a line offset into it.
A line number cited here rots the moment a further revision is posted, so the exclusion is quoted
instead. That comment's OUT OF SCOPE section reads "the `--backends-json` read failure that writes
`{state:"failed"}` (`spec-review-pin.js:382`), excluded because FAFF-1332 owns it", names the
extension point as the write inside `cmdSpecReviewPin`, states "FAFF-1332 ships first", carries its
own canonical chosen-marker for that sequencing, and closes with the statement that it touches
nothing FAFF-1332 would change. The same-file collision risk is therefore discharged by FAFF-1331's
own text, not by a human remembering. A reader checking this claim reads the latest spec comment on
FAFF-1331 and greps for the quoted string. What is absent is any graph edge:
FAFF-1332 and
FAFF-1331 carry only a `relatedTo` link, with `blocks: []` and `blockedBy: []` on both. A conflict
partitioner that partitions by file collision could still hand the pair out as independents. Drawing
a `blockedBy` edge is an operator action outside this spec's diff, and this spec does not claim it is
filed, added or pending. The sequencing decision itself is already marked in FAFF-1331's spec, so it
is not re-marked here.

**Where this spec diverges from the ticket's acceptance text, and why.** The ticket's DONE clause asks
for `anomaly: null` on the failing round. That is unsatisfiable as worded and no lens raised it: the
served-identity fault arm narrows that round and raises its own fault independently of the marker,
deliberately out of scope here, so no change to this writer can make the failing round come back
clean. What this spec delivers instead is `anomaly: null` on the next round that serves successfully,
which is the containment the ticket is actually after. The DoD below is written to the deliverable
fact, not to the ticket's wording, and is not weakened to match it.

## OUT OF SCOPE

- **Any governor-side disclosure of a folded failure.** Excluded because it changes a
  governance-record schema FAFF-1324 has just settled and touches prep's surfacing, neither of which
  this ticket's guard reaches. The decision about which shape a later ticket should take is **closed
  below**, so this is a scoped extension point rather than an open question. Extension point:
  `captureCrossRefs` in `spec-review-window.js`, as an additive `capture_last_failure_round`
  cross-ref beside the `capture_state` and `capture_round` it already copies, and explicitly **not**
  a new anomaly token.
- **Per-round failure history.** A fold keeps only the most recent failure. Excluded because full
  history needs a round-scoped artifact with its own path helper, export, selftest and tests, and a
  reader before it is non-silent in practice. Extension point: `servedIdentityPath` in
  `spec-review-pin.js`.
- **The governor's served-identity fault arm on the failing round.** Excluded because that arm is
  correct: there genuinely is no served identity for a round whose capture never completed. Extension
  point: the served-identity branch of `govern`.
- **The two residual weaknesses of `capturePin`'s positional guard** (it tests only that the pin file
  exists, so a deleted pin or a torn pin file can mislead it). Excluded because neither is this
  ticket's bug. Extension point: `writeFailedMarker` and the `fs.existsSync(pinPath)` early return.
- **Factoring the preserve-and-fold shape out of `captureNoLensServed`.** Excluded because that
  function is shipped and covered, and refactoring it risks a regression in FAFF-1323's fix for no
  gain here. Extension point: `captureNoLensServed`, beside the new helper.
- **FAFF-1331's repair and FAFF-1324's disposition.** Both settled elsewhere.
- **Changing the exit code.** A closed decision below, named here so no builder treats it as open.

## WHAT: vocabulary, types and decisions

| Term | Definition |
|---|---|
| The marker | The single JSON object in `pin-capture.json`. One per scratch dir, overwritten in place. |
| The pin | `pinned-reviewer.json`, the first-served backend object, written once per loop. |
| Fold | Writing new facts into sibling fields of an existing marker instead of replacing it. |
| Clobber | Replacing an established `captured` marker with a fresh marker of another state. The bug. |
| Served capture | `--capture` with `--winner-index` and `--backends-json`; the path containing the bug. |

### The marker shape after this change

```
RECORD PinCaptureMarker:                  # pin-capture.json, single slot, overwritten in place
  state: ENUM { captured, failed, skipped-no-lens }   # the only field govern branches on
  round: Integer >= 1                      # the round the STATE belongs to, not the latest round
  reason: String                           # failed / skipped-no-lens only; CLI-authored, bounded
  winner_index: Integer                    # captured only
  backend_identity: String                 # captured only
  ts: Timestamp                            # when the STATE was recorded; never rewritten by a fold

  # folded by captureNoLensServed (FAFF-1323, shipped)
  last_no_lens_round: Integer >= 1
  last_no_lens_ts: Timestamp

  # folded by the new read-failure writer (this ticket)
  last_failure_round: Integer >= 1         # the round whose --backends-json read failed
  last_failure_reason: String              # CLI-authored, bounded by the same scrub
  last_failure_ts: Timestamp

  CONSTRAINT a fold never alters state, round, reason, winner_index, backend_identity or ts
  CONSTRAINT the folded failure fields are written ONLY when state == "captured"
```

The three new keys are additive and nothing breaks by their presence: `readCaptureOutcome` parses the
object whole, `govern` branches on two named fields, and `captureNoLensServed`'s preserve arm spreads
the prior marker wholesale, so a folded failure survives a later no-lens round untouched.

### The new helper

```
FUNCTION captureReadFailure(scratchDir, round, reason) -> { state: "failed", marker_preserved?: true }
  # Mirrors captureNoLensServed's signature, branch shape and return contract.
  # Pure with respect to the pin: it neither reads nor writes pinned-reviewer.json.
```

Exported from `spec-review-pin.js` beside `capturePin` and `captureNoLensServed`, so the branch is
reachable from the module selftest and the test file without driving the CLI.

### Decision: which remedy

| Remedy | What it costs |
|---|---|
| Preserve and fold beside | Loses failure history; invisible to every current reader; makes one line of occupant prose inaccurate until updated |
| Round-scoped sidecar (`capture-failed-<n>.json`) | New artifact type, path helper, export, selftest and tests; still needs the `{failed}` marker for the no-prior-marker case; widest change by far |
| Guard on pin absence and skip the write | When a pin exists the failure leaves no disk trace at all, which is the silence FAFF-1052 exists to remove; also misses the torn-pin case |

**Chosen:** preserve and fold beside. It is the only option that stops the clobber while keeping a
disk-recorded trace on both branches, and it reuses a shape that shipped one ticket ago in
`captureNoLensServed` rather than inventing a second mechanism for the same job.

### Decision: how loud a folded failure should be

A preserved `captured` marker raises no anomaly, so prep's surfacing never fires on that account and
a later successful round reports nothing. A folded failure is a disk fact a human can find with
`cat`, not a fact the system volunteers. Nothing in production reads `last_failure_*`, exactly as
nothing reads FAFF-1323's `last_no_lens_*`. Two things bound the loss, one widens it in a narrow
branch, and one states what is actually given up.

*In-band loudness is reduced, not preserved, and the round-1 draft had this inverted.* The failure
still writes its reason to stderr and still returns 2. But the occupant's capture call is a bare
command inside an `if`/`else` with no `$?` inspection, and there is no `set -e` anywhere in
`faffter-dark-spec-review/SKILL.md`. The only `set -e` on this surface is authored by the test
harness at `test/spec-review-occupant-served-dispatch.test.mjs:44`. So a non-zero exit does not abort
the occupant round: the operator gets stderr and the exit code, and the round continues. The earlier
claim that the round aborts was wrong in the spec's favour and is corrected here.

*Whether the failing round is flagged at all depends on a retry, and in one branch it is not.*
`--govern` is run by prep, not the occupant (`faffter-dark-spec-review/SKILL.md:163`), so nothing the
capture call returns can stop it running. Post-fix there is one flagged channel and one silent one.

- **No retry, or a retry that also fails.** No `served-<n>.json` was written, so `--govern` takes the
  `served-identity-missing-or-malformed` fault arm, writes a fault record and exits 2, and prep
  surfaces the fault. This is the common channel.
- **A retry heals the sidecar, and post-fix that round carries no governance trace at all.** Prep's
  `disposition_unavailable` re-dispatches the occupant for the still-outaged lenses at the same round
  number (`faff-prep/SKILL.md:236-243`), with a fresh `mktemp` `$backends_json` from a fresh
  `--resolve`. On that attempt `capturePin` takes its existing-pin arm (`:214-225`), writes
  `served-<n>.json` and returns `{written:false}` without rewriting the marker. The fault arm then
  does not fire. Pre-fix the round was flagged by `anomaly: "pin-marker-contradiction"`, because the
  clobbered `{state:"failed"}` marker was still on disk. Post-fix the fold preserves
  `state: "captured"`, so `--govern` takes the captured arm at `:244`, reads `capRound = cap.round`
  and records `anomaly: null`. `action` is `"unchanged"` unless the retry happened to be served by a
  different backend than the pin, in which case the swap rule at `:252` fires on its own account and
  records `swap-reset`; neither value names the capture failure. The failed capture leaves **no**
  governance trace in this branch: no fault record, no anomaly, nothing but `last_failure_*` on the
  preserved marker and
  the stderr the operator may no longer be watching. This is the sharpest edge of the trade and the
  spec states it rather than rounding it off. The retry is triggered by a lens outage, never by the
  capture failure itself, so the branch needs a coinciding outage in the same round.

*Today's post-hoc loudness on later rounds is the bug, not a feature traded away.* What the clobbered
marker makes the governor report every later round is a misdiagnosis: the pin and marker called
inconsistent, when the truth is that one earlier round's backends read failed. That misdiagnosis also
narrows the window every round, so it is not a free alarm. Preserving the marker stops a false alarm
that never resets; it does not silence a correct one.

*The real loss.* An operator reading a finished loop's artifacts gets no automated flag naming a
capture read failure at round n. In the common channel they get that round's fault record saying the
served identity was missing, and must open `pin-capture.json` to learn why. In the retry-healed
channel they get nothing at all from governance. That is a genuine reduction in post-hoc precision,
worse in the second channel than the first, and it is what the governor-disclosure decision below
weighs. That decision is closed: no anomaly here, and the data-shaped cross-ref named as the scoped
extension point for a later ticket.

**Chosen:** accept the reduced post-hoc precision and add the cheapest in-band disclosure that needs
no reader change. The catch block prints the helper's result object to stdout before its stderr write
and `return 2`, so a fold announces itself as `marker_preserved: true` in the transcript exactly as
the no-lens path already does. Verified safe: no existing test asserts this path's stdout is empty,
and no caller parses the capture call's stdout. This does not make the fold as loud as a governor
anomaly, and this spec does not claim it does.

### Decision: the exit code

No caller branches on `--capture`'s exit status, but `test/spec-review-occupant-served-dispatch.test.mjs`
builds its script as `set -e` plus the snippet extracted verbatim from the occupant SKILL, so a
changed exit code would change that test's behaviour and widen the ticket.

**Chosen:** `return 2` unchanged on both arms. The remedy is about which bytes land in
`pin-capture.json`, not about how the command terminates.

### Decision: a helper or an inline edit

Inline keeps the diff smaller; a helper makes the branch reachable from the module selftest and from
unit tests without driving the CLI, which is how every other writer in this file is tested.

**Chosen:** add `captureReadFailure` as an exported module-level function mirroring
`captureNoLensServed`, and leave `captureNoLensServed` itself untouched. The two writers share a
shape, not an implementation; unifying them is an extension point, not work for this ticket.

### Decision: scrubbing the folded reason

**Chosen:** pass the folded reason through the existing `scrub` helper, as the current write does. Be
accurate about what it does: `scrub` (`:73-78`) strips control characters and truncates to 200
characters, and is not a path redactor. It is what satisfies FAFF-1052's "CLI-authored, bounded"
requirement, since the reason interpolates an exception message of unbounded length; and applying it
on one arm but not the other would introduce a second scrub asymmetry on the exact surface where
FAFF-1338 already tracks a live defect caused by one.

## HOW: behaviour

One function is added and one catch block is rewired. The catch block stops writing the marker and
delegates to `captureReadFailure`, which chooses between folding and fresh-writing by reading the
prior marker, then returns a result object the catch block prints before its existing stderr write
and `return 2`.

```
PROCEDURE captureReadFailure(scratchDir, round, reason):
  1. ts := current ISO timestamp
  2. prior := readCaptureOutcome(scratchDir)        # null on absent or malformed; never throws
  3. IF prior is non-null AND prior.state == "captured":
     a. Write { ...prior,
                last_failure_round:  round,
                last_failure_reason: scrub(reason),
                last_failure_ts:     ts }
        to pinCapturePath(scratchDir) via atomicWriteJSON
     b. Return { state: "failed", marker_preserved: true }
  4. OTHERWISE:
     a. Write { state: "failed", round, reason: scrub(reason), ts }
        to pinCapturePath(scratchDir) via atomicWriteJSON
     b. Return { state: "failed" }
```

```
PROCEDURE the catch block in cmdSpecReviewPin, on a failed --backends-json read or parse:
  1. reason := "--backends-json could not be read as JSON: " + the exception message   # unchanged
  2. result := captureReadFailure(dir, round, reason)
  3. Print JSON.stringify(result) to stdout                      # the only new observable
  4. Write "faff spec-review-pin: " + reason to stderr           # unchanged
  5. Return 2                                                    # unchanged
```

### Edge cases, with explicit precedence

The branch is decided solely by the prior marker's `state`.

| Prior marker on disk | Branch | Resulting marker |
|---|---|---|
| Absent | Fresh write | `{state:"failed", round, reason, ts}`, FAFF-1052's original scenario, unchanged |
| Malformed or torn JSON | Fresh write | Same as absent; `readCaptureOutcome` returns null for both and never throws |
| `state: "captured"` | Fold | Prior marker intact plus the three `last_failure_*` keys |
| `state: "failed"` | Fresh write | Overwritten with this round's failure; the earlier failure's details are lost |
| `state: "skipped-no-lens"` | Fresh write | Overwritten, mirroring `captureNoLensServed`'s own replace arm |
| `state: "captured"` with `last_failure_*` already | Fold | The three keys take this round's values |
| `state: "captured"` with `last_no_lens_*` | Fold | Both sets coexist, because the spread preserves the no-lens keys |

The branch deliberately does not consult `pinned-reviewer.json`. The marker is the thing being
protected, and its own `state` is a more direct test of whether there is an established capture worth
preserving than the pin file's existence; it also sidesteps the torn-pin weakness named out of scope,
since a torn pin cannot mislead a reader that never opens it.

**Anti-pattern:** dropping the write, or making it conditional on there being no pin. Why: the catch
block's comment and `capturePin`'s header both record that this write exists for FAFF-1052's
never-silent property, and FAFF-1052's interface mandates it. This is the single thing this ticket
most needs the builder not to do.

**Anti-pattern:** guarding on `fs.existsSync(pinPath)` instead of on the prior marker's state. Why: it
copies `capturePin`'s positional guard along with both known weaknesses, and it skips the write
rather than folding it.

**Anti-pattern:** folding into a non-`captured` marker, or rewriting `ts`, `round` or
`backend_identity` in the fold arm. Why: `failed` and `skipped-no-lens` markers record no pinning
round worth protecting, and the governor reads `round` as the round the pin was captured in, so
advancing it manufactures a different form of the same bug. FAFF-1323's test asserts `cap.ts` is not
rewritten for this reason.

### Prose that stops being true

`plugin/skills/faffter-dark-spec-review/SKILL.md:148` says a failed `--backends-json` read or parse is
recorded `{failed}` before the existing exit 2, never silent. After the fold that holds only when no
established capture exists. Amend it to say that an established `captured` marker is preserved with
the failure folded beside it, and that the `{failed}` marker is written when there is no established
capture. Keep the edit short: the skill-authoring standard caps prose length and `faff
validate-adapters` lints it. FAFF-1052's own spec is a shipped historical record and is not
rewritten; this spec is the amendment.

### Failure modes of the approach

**The harm could be measured against the wrong branch.** Every claim about what a clobbered marker
costs depends on the governor arm at `spec-review-window.js:247`, and that arm differs between a
stale working branch and `origin/main`: pre-FAFF-1324 it was soft (`capRound = 1`, no narrowing),
post-FAFF-1324 it narrows to `n`. A builder reading the stale copy would measure a smaller defect and
could reasonably conclude the ticket is not worth doing. How you would know: the governance-level DoD
item below asserts `action` and `window_start`, which differ between the two arms, so a stale
checkout fails it rather than passing quietly. What it means: proceed, having read `origin/main`.

**The fold could be protecting a marker that is itself wrong.** If the pin were deleted out of band
while a `captured` marker survived, the fold preserves a marker describing a pin that no longer
exists. How you would know: `govern`'s `pin === null` arm already records `unpinnable` or
`round1-capture-missed` rather than trusting the marker. What it means: proceed; it is strictly better
than today, where the same situation plus a read failure also yields the false contradiction.

**The regression test could pass against the current code**, which would mean the staged precondition
does not reproduce the bug and this spec's model of it is wrong. How you would know: the
confirm-it-fails step, which is the build's first action below. What it means: stop and re-derive,
because every other claim here rests on that model.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a scratch dir holding an established pin and a marker {state:"captured", round:1, winner_index, backend_identity, ts}
When a later round runs a served --capture whose --backends-json file cannot be read or parsed
Then pin-capture.json still reads state "captured" with round 1 and the original backend_identity and ts,
  and additionally carries last_failure_round for that later round, a non-empty last_failure_reason
  and a last_failure_ts, and the command exits 2 after writing its reason to stderr
```

```
Given a scratch dir with no pin-capture.json at all
When a served --capture runs with an unreadable --backends-json file at round 2
Then pin-capture.json reads {state:"failed", round:2} with a non-empty reason, exactly as before this
  change, and the command exits 2, so FAFF-1052's own scenario is untouched
```

```
Given a scratch dir whose pin-capture.json contains torn, unparseable JSON
When a served --capture runs with an unreadable --backends-json file at round 3
Then the marker is replaced with {state:"failed", round:3} rather than folded, and nothing throws
```

- The folded reason passes through the same `scrub` helper as the fresh-written reason, so a long or
  control-character-bearing exception message is bounded identically on both arms.
- No fold reads, writes or requires `pinned-reviewer.json`.

## The governor-disclosure decision, and assumptions

### Decision: how a folded failure should reach the governance record, if ever

This was carried as an open punt through two review rounds and is now settled by the operator
(2026-10-19, decides: architecture). It is recorded here rather than dropped, because the reasoning
is what keeps a later ticket from walking into a shipped acceptance.

The question was whether `--govern` should raise a non-action-changing anomaly when the preserved
marker carries `last_failure_round`. Both horns were weighed against the code rather than against
intuition.

The case for disclosure is stronger than earlier drafts of this spec allowed. Those drafts argued the
failing round is still flagged by the served-identity fault arm, which is true in the common channel
and false in the retry-healed one: there the fold preserves `captured`, `govern` takes the captured
arm with `anomaly: null` and `action: "unchanged"`, and no artifact names the failure at all.

The case against an **anomaly specifically** is firmer than the generic schema-churn argument. Two
verified facts decide it. `spec-review-window.js:251` reads
`action = anomaly === null ? "late-pin-advance" : "unpinnable-reset"`, so setting an anomaly on the
captured arm flips that ternary and labels a legitimate late-pin advance as a reset. Be accurate
about the size of that: `newWs = capRound` on both arms, and FAFF-1324 records that nothing consumes
`action` behaviourally, so the cost is a mislabelled diagnostic on precisely the rule this ticket
family exists to protect, not a behavioural regression. The firmer constraint is FAFF-1324's own
acceptance, which pinned "No `AnomalyToken` or `ActionToken` value is added, renamed, or removed". An
anomaly-shaped follow-up would have to amend a shipped acceptance to land.

**Chosen:** no governor anomaly, and a later ticket that wants the disclosure takes the data shape
instead: an additive `capture_last_failure_round` cross-ref in `captureCrossRefs`, beside the
`capture_state` and `capture_round` it already copies, with `anomaly` left `null`. That buys the
post-hoc precision the retry-healed branch genuinely lacks, adds no anomaly token, never reaches the
`:251` ternary, and leaves prep's anomaly surfacing untouched. It is additive to a record that exists
for exactly this cross-referencing job. This spec does not make that change: it is a governor-side
edit, outside this ticket's guard either way, and it is recorded under OUT OF SCOPE as the scoped
extension point.

### Assumptions

**Assumes:** `scrub`, `atomicWriteJSON`, `readCaptureOutcome` and `pinCapturePath` are in scope in
`spec-review-pin.js` and exported from it. Validation: all four were confirmed present in the
module's export list this pass (`:609-626`), so the builder need only confirm they are still there.

## DONE: definition of done

### First, before any code is written

- [ ] **Confirm it fails, on `origin/main`.** In a temp scratch dir, run a valid served `--capture` at
      round 1, then a served `--capture` at round 2 whose `--backends-json` path does not exist, and
      read `pin-capture.json`: it must read `state: "failed"` with `round: 2`, the pin still present.
      Then run a valid served `--capture` at round 3 and govern it: the record must read
      `anomaly: "pin-marker-contradiction"`, `action: "unpinnable-reset"` and `window_start: 3`.
      Record both observed outputs in the build record. If either does not reproduce, stop and
      re-derive, and check first that the checkout contains `3501de7f`: every other item here
      rests on this.

### The change and its gate

- [ ] `captureReadFailure(scratchDir, round, reason)` exists in `spec-review-pin.js`, is listed in
      `module.exports`, and returns `{state:"failed", marker_preserved:true}` on the fold arm and
      `{state:"failed"}` on the fresh-write arm.
- [ ] On a prior `captured` marker the fold leaves `state`, `round`, `reason`, `winner_index`,
      `backend_identity` and `ts` unchanged, adds exactly `last_failure_round`, `last_failure_reason`
      and `last_failure_ts` and no other key, and keeps any `last_no_lens_*` keys already present.
- [ ] `last_failure_reason` is `scrub`'s output: a reason longer than 200 characters is stored
      truncated to 200, matching the fresh-write arm's bound.
- [ ] Absent, torn, `failed` and `skipped-no-lens` priors each fresh-write `{state:"failed", round,
      reason, ts}`, one case per precedence row, and a torn prior throws nothing.
- [ ] The catch block calls `captureReadFailure` instead of writing the marker itself, prints
      `JSON.stringify(result)` to stdout, writes its existing stderr line with the reason string
      unchanged, and returns 2 on both arms.
- [ ] The diff touches no line inside `captureNoLensServed`, `capturePin` or `writeFailedMarker`.
- [ ] A governance-level test, run against `origin/main`'s `spec-review-window.js`, stages the fold at
      round 2 and then governs a successfully served round 3: `anomaly` is null, `action` is not
      `"unpinnable-reset"`, `window_start` is not narrowed to 3, `capture_state` is `"captured"` and
      `capture_round` is 1. The same test against the unmodified writer fails with
      `anomaly: "pin-marker-contradiction"`, `action: "unpinnable-reset"`, `window_start: 3` and
      `capture_round: 2`, which is what demonstrates the latch rather than only the clobber.
- [ ] `faffter-dark-spec-review/SKILL.md:148` no longer states unconditionally that the failure is
      recorded `{failed}`, and `faff validate-adapters` passes.
- [ ] `spec-review-pin --selftest` covers both helper arms, and the full suite passes, including
      `test/spec-review-window.test.mjs` and `test/spec-review-occupant-served-dispatch.test.mjs`.

### Integration smoke test

```
PROCEDURE smoke (one end-to-end path through the CLI seam, via the runCli helper):
  1. Make a temp scratch dir
  2. spec-review-pin --capture --dir <d> --backends-json <valid chain file> --winner-index 0 --round 1
     Expect exit 0, stdout {written:true}, pinned-reviewer.json present,
     pin-capture.json {state:"captured", round:1}
  3. spec-review-pin --capture --dir <d> --backends-json <path that does not exist> --winner-index 0 --round 2
     Expect exit 2, stderr containing "--backends-json could not be read as JSON",
     stdout parsing to {state:"failed", marker_preserved:true}
  4. Re-read pin-capture.json
     Expect state "captured", round 1, backend_identity and ts unchanged from step 2,
     last_failure_round 2, last_failure_reason non-empty, last_failure_ts a string
  5. spec-review-pin --capture --dir <d> --backends-json <the valid chain file> --winner-index 0 --round 3
     Expect exit 0, stdout {written:false}, served-3.json present
  6. spec-review-window --govern --dir <d> --round 3 --any-served   # origin/main's governor
     Expect exit 0, anomaly null, action "unchanged", window_start NOT narrowed to 3,
     capture_state "captured", capture_round 1
     (against the unmodified writer: anomaly "pin-marker-contradiction",
      action "unpinnable-reset", window_start 3, capture_round 2)
```

Step 6's `--any-served` is an existing arity-0 flag on `origin/main`'s governor, declared at
`spec-review-window.js:282`, carried in the usage string at `:289` and read at `:315`. It is named
here so the step is runnable as written without the reader checking first; this spec neither adds nor
changes it.

Steps 5 and 6 are the point of the ticket: a read failure at round 2 no longer narrows round 3's
window or makes its governance record describe a loop that contradicts itself, so convergence still
has a window it can read. Governing round 2 is deliberately not part of this smoke test, because that
round legitimately faults on its missing served identity before and after the change, so it proves
nothing either way.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
build-tier: complex
