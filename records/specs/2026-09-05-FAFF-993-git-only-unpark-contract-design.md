# Autonomous re-entry and the shared git-only Unpark contract (FAFF-993)

> Revised 2026-09-04, folding the spec-review reject-approach objections (autonomous re-entry seam, interactive gate observable, interactive cross-run write authority, symlink confinement, and the missing oracles).

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-993.

## Preamble

FAFF-993 is the second slice of FAFF-991 (autonomous re-entry for a lights-out `needs-human` park). This revision replaces the earlier spec that spec-review rejected on the scoped slice. It keeps the settled umbrella decisions and the FAFF-992 schema dependency untouched, and re-grounds the four contested seams against the current tree: the autonomous re-entry mechanism, the interactive unpark gate, the interactive session's write authority, and the confinement of the cited input.

FAFF-993 owns the re-entry decision and the shared git-only unpark write path: a pure `classifyReEntry` core, the shared `apply_git_only_unpark` helper, the `faff park-reconsider` compute verb, the autonomous reconsider pass in `resumeLightsOut`, the admitted mid-run route in `reconstructResumePlan`, the interactive `/faff-prep` re-invoke unpark, the `park-reconsidered` record at both seams, and the git-only Unpark contract documentation.

FAFF-993 depends on FAFF-992 (classification and prevention) for the park-record schema: the `reconsider` outcome and `cited_input` fields on the `faff-parks` record, and the `park` sub-object on the `.faff/prep/<issue>.json` marker. That schema is carried here as an `**Assumes:**`, referenced but not redefined. The `park-reconsider-classification` grader is also built in FAFF-992 and is a hard gate on this ticket's autonomous seam.

The producer verified every file reference, line behaviour, and enum against the current tree under `plugin/skills/faff/**`, `plugin/skills/faff-prep/SKILL.md`, and `plugin/skills/faff-beep-boop/SKILL.md` before asserting it. The installed `~/.claude/skills` copies are stale and were not consulted.

---

## 1. WHY

**The load-bearing model.** A park is a promise that a human will make a call. Clearing that promise has no git-only definition today: neither the autonomous resume nor the human's own sanctioned re-invoke of `/faff-prep` actually removes a git-only park, because the kernel's "the label is the contract" unpark rule assumes a tracker label that does not exist in git-only mode. FAFF-993 gives that contract one git-only definition, `apply_git_only_unpark`, and re-enters the unparked issue through machinery that already exists: the autonomous seam hands the issue back to beep-boop's prep-queue drain via the same spec-review-resume hold FAFF-900 already ships, and the interactive seam clears the park inside the prep session the human is already in. Neither seam invents a new re-entry path or a new autonomous execution mode.

**Problem statement.** In a git-only L4 run a spec-review `needs-human` park is recorded as `disposition:"parked"` on the prep marker and as ledger outcome `parked`, and `faff lights-out --resume` has no path that re-enters it even when the cited machine-checkable input has demonstrably changed; separately, an interactive `/faff-prep <issue>` re-invoke on that same parked issue surfaces its questions and ends the turn with `disposition:"parked"` still standing, because no code on the interactive path clears a git-only park. Both symptoms are the same missing git-only definition of the Unpark contract, seen from two seams.

### Design principles (constraints that reject an implementation)

**The autonomous reconsider licence is a demonstrated input change, never the cause class.** A park may be reconsidered by an autonomous path only when the specific external input the park cited has a current content fingerprint that differs from the one captured at park time. This is a resume-time signal available only because arbitrary operator time has elapsed; it is not the claim that a cause labelled `config-fault` is machine-resolvable. Reconsidering a park merely because its class is `config-fault`, without proving the cited input changed, re-opens FAFF-900's closed in-turn ruling (the graceful spec-review-outage design, `records/specs/2026-08-27-faff-900-graceful-spec-review-outage-handling-design.md`, which correctly keeps a config-fault `needs-human` for the in-turn retry loop that has no elapsed time). An implementation that reconsiders by class alone must be rejected. This licence gates the autonomous seam only.

**The autonomous seam re-enters only through the existing prep-queue drain and its spec-review gate, never a bespoke re-review call.** The reconsider pass does not re-run spec-review itself and does not invent a lights-out prep mode. It clears the git-only park and hands the issue to the state beep-boop's prep-queue drain already knows how to resume: the spec-review-resume hold (FAFF-900), which routes a specced Backlog issue back to `faff-prep` in autonomous mode, whose stale-refresh path re-runs the spec-review gate. An implementation that re-reviews the spec inside `resumeLightsOut`, or that assumes an autonomous `/faff-prep` mode distinct from the shipped one, must be rejected.

**The interactive unpark fires on an observable the human supplies, never on the model's opinion that a cause is closed.** The gate is a machine-checkable artifact: a `**Chosen:**` marker the human authored that closes the cited punt or cause (the gateway's Interactive park resolution rule already requires the human to author it), or an explicit unpark instruction. It is never the model inferring, from free-form input, that the cause is now settled. For a `config-file` cited cause the seam additionally recomputes the fingerprint under confinement and records whether the input changed, surfacing a warning when the cited config is byte-identical to park time (the human resolved a cause the cited input does not reflect). An implementation whose unpark branch turns on an ungraded model judgement must be rejected.

**An interactive session writes only what an L2 session is authorised to write: the marker and its own prep log.** The `.faff/prep/<issue>.json` marker is Sensor/resume class, single-writer, and the interactive session may write it. A different, earlier, dispatched run's `run-ledger.json` and `events.jsonl` are Evidence class, writable only from the trusted side of that run's own dispatch cut (kernel.md line 295); a separate interactive session is not that side. The interactive seam therefore never clears or appends to another run's ledger or events stream. It reads the earlier run only to decide whether the park can be cleared safely. An implementation that cross-writes a dispatched run's Evidence artifacts from an interactive session must be rejected.

**A human-judgment park is never auto-reconsidered.** A park whose recorded reconsider outcome is `human` (scope, taste, architecture, or anything the classifier could not prove machine-checkable) is never re-opened by any autonomous path, regardless of elapsed time or file changes. The autonomous decision reads the recorded outcome and stops; it never re-derives the human-versus-machine call at resume, and it never treats an absent, unclassified, or ambiguous record as machine-reconsiderable. In doubt, the park stays human and waits for the human. A present human at the interactive seam is authoritative and may close any park once their authored resolution settles the cause.

**Never a bare disposition strip.** Clearing a park clears every git-only park surfacer it is authorised to clear, together, and logs the unpark. A bare `disposition` strip that leaves a live ledger outcome (and therefore `queue-state`'s `all-parked` derivation) still reading `parked` is a lie to a downstream surfacer and is forbidden. When the authorised ledger clear cannot settle safely (present-but-malformed, or lock-contended), the whole unpark refuses and the marker is left in place. When the ledger belongs to a run the seam may not write (the interactive cross-run case), the seam clears the marker alone only where that leaves no live surfacer reading `parked`, and refuses otherwise.

**Fail closed on any indeterminate input read (autonomous seam).** If the cited input cannot be read, resolves (after symlink resolution) outside the repo root, carries no stored fingerprint, or its freshness cannot be established, the park is not reconsidered and stays parked. An unreadable config file is not evidence of change; it is a reason to leave the human's park in place. The interactive seam has a present human as its authority and does not fail closed on a read.

### Reference-context: files this touches

| File | What it does today | What FAFF-993 changes |
|---|---|---|
| New: `plugin/skills/faff/bin/lib/park-reconsider.js` | (none) | The pure `classifyReEntry` core, the shared `apply_git_only_unpark` helper, `PARK_RECONSIDER_SELFTEST_CASES`, and the `faff park-reconsider` compute verb plus `PARK_RECONSIDER_SURFACE` |
| `plugin/skills/faff/bin/lib/next.js` (`nextStep` lines 34 to 57; the `awaitingSpecReview` arm lines 47 to 52; selftable lines 90 to 95) | A parked issue routes `needs-human`; a `--awaiting-spec-review` hold routes a specced Backlog issue back to `prep` regardless of retained confidence; a cleared Backlog high-confidence spec routes `graft` | Unchanged code. The reconsider pass relies on the existing `awaitingSpecReview` arm to re-enter the unparked issue at `prep` (and therefore the spec-review gate), not `graft` |
| `plugin/skills/faff/bin/lib/lights-out.js` (`resumeLightsOut` line 1130; the `reconsider_parked_items` pass runs after preflight, before the beep-boop hand-off) | Reconstructs the plan over the admitted set, hands off to beep-boop with `FAFF_RUN_DIR` | Runs the autonomous reconsider pass; calls `apply_git_only_unpark` against its OWN live run ledger (authorised); transitions each reconsidered issue into the FAFF-900 spec-review-resume hold so the hand-off drain re-enters it |
| `plugin/skills/faff/bin/lib/heartbeat.js` (`mutateLedgerUnderLock` line 316, `LEDGER_LOCKED` throw line 305, epoch fence yield lines 326 to 329) | The single lock-serialised ledger mutator | The autonomous seam clears its own run's `parked` outcome through this one mutator (no unlocked write); the interactive seam never calls it against another run's ledger |
| `plugin/skills/faff/bin/lib/queue-state.js` (`readOutcomes` lines 115 to 128; `deriveQueueState` pure differ) | A missing run dir or missing `run-ledger.json` reads `{outcomes:{}, malformed:false}`; a present-but-unparseable ledger reads `{outcomes:{}, malformed:true}` (loud); `all-parked` is derived per single run dir | The missing-vs-malformed split picks the interactive helper's absent-ledger branch versus its refuse branch; the per-run `all-parked` derivation is why the autonomous seam clears its own run's outcome and the interactive seam reasons about the earlier run's liveness |
| `plugin/skills/faff/bin/lib/resume.js` (`reconstructResumePlan` line 88; `TERMINAL_NON_SHIPPED` line 38 includes `parked`) | Every `parked` outcome routes to `plan.terminal` | A machine-reconsiderable admitted `parked` outcome whose input changed routes to a new `plan.reconsider` bucket, which re-enters through the same spec-review-resume hold |
| `plugin/skills/faff/bin/lib/governance-profile.js` (`event_types` line 69; `run-resume` line 80; `issue_scoped_types` line 124; `outcome_required_types` line 133) | Registers run-scoped event types | Registers `park-reconsidered` as run-scoped (out of `issue_scoped_types` / `outcome_required_types`, parity with `run-resume`). Only the autonomous seam emits it to a run's `events.jsonl`; the interactive seam records to its prep log instead |
| `plugin/skills/faff/bin/lib/cli-surface.js` (`DISPATCH_SURFACES` line 43; `cliSurfaceSelftest` bijection line 143) | Declared CLI grammar, self-tested by `cli-surface --selftest` | The `park-reconsider` verb is added to the `../faff` COMMANDS dispatch table; `PARK_RECONSIDER_SURFACE` is exported and wired so the bijection self-test still passes |
| `plugin/skills/faff/bin/lib/prepcheck.js` (`owner.run_dir` lines 112, 129; the "deleted / rotated / never-existed run dir" note line 96) | The marker records `owner.run_dir`; `tryReadLedger` collapses a missing or malformed ledger to null | `owner.run_dir` is reused as the interactive seam's cross-run ledger resolver (read-only); the FAFF-992 `park` sub-object is read here |
| `plugin/skills/faff/bin/lib/spec-judge-casefile.js` (`realpathSafe` lines 291 to 293; the symlink-escape refusal lines 266 to 275) | Confines a candidate path by resolving `fs.realpathSync` (tolerating a non-existent leaf via the nearest existing ancestor) and re-asserting the resolved real path is under the repo root | Reused as the model for confining `cited_input.ref` to the repo root before fingerprinting: symlink-resolved, not lexical |
| `plugin/skills/faff/bin/lib/resumecheck.js` (`isUnderRunsRoot`, lines 109 to 113; `resumecheckHookDecision` `no-work-since-run-resume`) | The lexical runs-root confinement model (`path.resolve` + strict `startsWith`, no symlink resolution); the Stop-hook release reason for a resume that did nothing | The lexical model is NOT reused for `cited_input.ref` (it cannot resolve symlinks); it is named only as the model the realpath approach supersedes. Clearing the park is what stops the resume reporting `no-work-since-run-resume` |
| `plugin/skills/faff-prep/SKILL.md` (Autonomous Mode, Path 1 stale-refresh, "re-run the Spec-review gate"; the `spec-review-held` return and `.faff/resume/<issue>/spec-review-hold.json` `cause` union; Scenario B line 435; git-only mode line 493) | The autonomous prep drain re-runs the spec-review gate on a stale-refresh; a spec-review-outage hold writes `spec-review-hold.json` with a `cause`; Scenario B is the interactive iterate/build/park offer with no git-only disposition clear | The reconsider pass writes `spec-review-hold.json` with a new `cause:"reconsider-input-changed"`; the interactive re-invoke runs `apply_git_only_unpark` once the human's authored resolution closes the cited cause |
| `plugin/skills/faff-beep-boop/SKILL.md` (prep queue build step 2; prep queue drain step 3; the `spec_review_outage_pending` re-entry precedent) | Membership decided by `faff next`; a `faff-awaiting-spec-review` Backlog issue is prep-queue membership "regardless of retained confidence"; drain dispatches `faff-prep` in autonomous mode | Unchanged code. The reconsidered issue re-enters through exactly this membership consult and drain, since the reconsider pass left it in the spec-review-resume hold state |
| `plugin/skills/faff/references/kernel.md` (Unpark protocol lines 305 to 315; run-artifact write authority line 295) | Defines the Unpark protocol and the Evidence-vs-Sensor write classes bound to the orchestrator-to-lane dispatch cut | Adds the git-only Unpark contract; grounds the autonomous seam's own-run ledger write on the trusted-side rule and the interactive seam's marker-only write on the Sensor/resume class, with no cross-run Evidence write |

**Scope statement.** FAFF-993 makes a git-only lights-out resume autonomously re-enter a park whose cited machine-checkable input has demonstrably changed (by clearing the park and handing the issue to the existing spec-review-resume drain), gives the interactive `/faff-prep` re-invoke a real git-only unpark effect once the human authors a resolution, and defines one git-only Unpark contract. It adds one internal compute verb (`faff park-reconsider`) and no operator-invocable command.

---

## 2. OUT OF SCOPE

**The FAFF-992 park-record schema is a dependency, not a scope item.** The `reconsider` outcome and `cited_input` fields on the `faff-parks` record, the `park` sub-object on the prep marker, and the park-time classification that assigns `reconsider:machine|human` are all built in FAFF-992 (Ticket 1). FAFF-993 reads that schema and does not define, widen, or re-classify it. This spec references the shapes it consumes (section 3) so the reader can follow the decision logic; the authoritative definition is FAFF-992's.

**The park-versus-hold prevention boundary and its grader.** Stopping a recoverable transient from parking in the first place (the in-turn-recoverable hold path) and the `park-reconsider-classification` grader both belong to FAFF-992. FAFF-993 consumes the grader as a hard gate (section 8) and does not build it.

**A manual operator unpark verb or `--reconsider` flag.** Named and rejected at the umbrella (settled decision, carried in section 6). A `faff unpark <issue>` verb or a `faff-tidy --reconsider` would make a human park more involved and would leak an automation shortcoming into the CLI surface. The internal `faff park-reconsider` compute verb is not this: it is a pure decision/selftest surface with no unpark side effect a human would invoke, mirroring the other `--selftest`-bearing compute verbs. Extension point: a future operator-driven reconsider would attach to the same `classifyReEntry` core and `apply_git_only_unpark` helper.

**Changing `faff next`, the prep-queue drain, or the spec-review gate.** The autonomous re-entry rides existing code unchanged: `next.js`'s `awaitingSpecReview` arm, beep-boop's prep-queue build and drain, and faff-prep's autonomous stale-refresh spec-review re-run. FAFF-993 sets the hold state those paths already consume; it does not modify them. Extension point: if a future cause needs a re-entry route other than the spec-review gate, it would add a new `faff next` arm rather than overloading this one.

**Backend cited-input change detection.** A `config-file` cited input fingerprints cleanly. A `backend` cited input has no obvious content to hash, and "the backend is now reachable" is a liveness probe, not a change diff. The shipped autonomous path fingerprints config-file inputs only; a `backend` cited input fails closed at the autonomous seam until the mechanism is decided (section 7). The interactive seam is unaffected: a present human can close a backend-caused park with an authored resolution. This is the holdout scenario in section 5.

**The admitted mid-run path is specified but is the natural peel-off.** The reproduced incident is a prep-queue park (never admitted). An admitted issue that parked mid-build is covered by the same `classifyReEntry` core applied inside `reconstructResumePlan` (section 4), and this spec specifies that wiring, but the primary path exercised end-to-end is the prep-queue park. If FAFF-993 still exceeds a comfortable slice, the `reconstructResumePlan` reconsider bucket is the intended follow-up peel-off: it is additive over the prep-queue path and shares the pure core.

---

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Reconsider outcome | The FAFF-992 field on a park record: `machine` (the cited input is machine-checkable and its change licences an autonomous re-open) or `human` (a scope, taste, or architecture call that never auto-re-opens). A legacy or absent record reads as `human` |
| Cited external input | The specific external thing a `machine` park depends on: a config file (with the keys the fault named) or a backend reference, plus a content fingerprint captured at park time. Defined by FAFF-992 |
| Autonomous unpark seam | The resume-time reconsider pass in `resumeLightsOut`; gated on `classifyReEntry` (input changed), clearing its OWN live run ledger, then handing the issue to the spec-review-resume hold for re-entry |
| Interactive unpark seam | An interactive `/faff-prep <issue>` re-invoke on a parked git-only issue; gated on the human's authored resolution, writing only the marker and its own prep log, reading (never writing) the earlier run's ledger to decide the branch |
| Spec-review-resume hold | The FAFF-900 state (`.faff/resume/<issue>/spec-review-hold.json` plus the awaiting-spec-review marker flag) that routes a specced Backlog issue back to `faff-prep` at the spec-review gate on the next prep drain. FAFF-993 reuses it with a new `cause` |
| Git-only Unpark contract | The git-only definition of clearing a park: clear the run-ledger `parked` outcome the seam is authorised to write (the autonomous seam's own run), clear the prep-marker `disposition`, record the unpark |
| Reconsider pass | The autonomous-seam step that reads each parked item's record, checks the cited-input change, clears the reconsiderable ones, and holds them for spec-review re-entry |

### The park-record and marker shapes this ticket reads (defined by FAFF-992)

FAFF-993 consumes, and never defines, the following FAFF-992 shapes. They are shown for the reader; FAFF-992 is authoritative.

```
RECORD ParkCause (the marker.park sub-object, git-only):     # from FAFF-992
  reconsider   : ENUM { "machine", "human" }
  cause_class  : ENUM(five)          # mirrors the faff-parks root_cause_class
  parked_at    : ISO-8601            # the park timestamp
  cited_input  : CitedInput OR null

RECORD CitedInput:                                           # from FAFF-992
  kind        : ENUM { "config-file", "backend" }
  ref         : STRING               # a REPO-ROOT-RELATIVE path, or a backend identifier
  keys        : [STRING]             # optional
  fingerprint : STRING               # content hash captured AT PARK TIME
```

**Assumes:** FAFF-992 ships these fields on the `faff-parks` record and the `.faff/prep/<issue>.json` marker's `park` sub-object, present only when `disposition == "parked"`, and `classifyPrepIssue` stays byte-compatible via its unknown-key tolerance. A `disposition:"parked"` marker with no `park` sub-object reads as a `human` park.

### The re-entry decision (pure, autonomous seam only)

```
RECORD ReEntryVerdict:
  reconsider : BOOL
  reason     : STRING     # one of:
                          #   "human-park", "no-cited-input", "no-stored-fingerprint",
                          #   "ref-outside-repo-root", "fingerprint-unreadable",
                          #   "clock-not-advanced", "input-unchanged", "input-changed"
```

```
FUNCTION classifyReEntry(cause, observed_fp, ref_in_root, now):   # PURE, filesystem-free, selftest-driven
  IF cause is absent OR cause.reconsider != "machine":  RETURN { false, "human-park" }
  IF cause.cited_input == null:                          RETURN { false, "no-cited-input" }
  IF cause.cited_input.fingerprint is empty:             RETURN { false, "no-stored-fingerprint" }
  IF ref_in_root != true:                                RETURN { false, "ref-outside-repo-root" }   # fail-closed
  IF observed_fp == null:                                RETURN { false, "fingerprint-unreadable" }   # fail-closed
  IF now <= cause.parked_at:                             RETURN { false, "clock-not-advanced" }        # fail-closed
  IF observed_fp == cause.cited_input.fingerprint:       RETURN { false, "input-unchanged" }
  RETURN { true, "input-changed" }
```

**Canonical marker.** `classifyReEntry` returns `reconsider:true` only when the park is `machine`, carries a `cited_input` with a stored `fingerprint`, its `ref` resolved (after symlink resolution) inside the repo root (`ref_in_root == true`), and the observed current fingerprint differs from the stored one; every other input returns `false` with the specific reason. It is filesystem-free by taking a precomputed `ref_in_root` boolean and an `observed_fp` the impure caller supplies (null when unreadable or out-of-root). It gates the autonomous seam and is never consulted at the interactive seam.

### The unpark record

```
RECORD park-reconsidered:
  # AUTONOMOUS seam: a run-scoped governance event on the run's OWN events.jsonl.
  # INTERACTIVE seam: a structured line in the interactive prep log
  #   .faff/logs/YYYY-MM-DD/HHMMSS-prep-<issue>.md (never a cross-run events.jsonl write).
  schema, ts, type:"park-reconsidered"
  # (run_id, seq, prev, phase:"run" present only on the autonomous events.jsonl form)
  data:
    issue            : STRING
    cause_class      : ENUM(five)
    via              : ENUM { "resume-reconsider", "interactive-reprep" }   # which seam fired
    ledger_cleared   : BOOL          # true only when the seam cleared a live ledger it was authorised to write
    ledger_note      : STRING OR null  # why not, on ledger_cleared:false (absent-run / earlier-run-terminal / earlier-run-live-deferred)
    cited_input_ref  : STRING OR null
    prev_fingerprint : STRING OR null
    new_fingerprint  : STRING OR null   # null on an interactive resolution with no fingerprintable cited input
```

**Canonical marker.** Every unpark is recorded exactly once, with the cause, a `via` discriminator naming the seam, and a `ledger_cleared` flag (plus a `ledger_note` when false). The autonomous seam appends it as a run-scoped event to its own run's `events.jsonl` and registers `park-reconsidered` in `event_types` out of `issue_scoped_types` / `outcome_required_types`, parity with `run-resume`. The interactive seam writes the same fields as a structured line to the interactive prep log, never to another run's events stream.

---

## 4. HOW

### Architecture: two seams, one contract, kernel-respecting write authority

```
                    a parked git-only issue
                            |
        +-------------------+--------------------+
        |                                        |
  autonomous seam                          interactive seam
  resumeLightsOut reconsider pass          /faff-prep <issue> re-invoke
  gate: classifyReEntry (fingerprint diff) gate: the human's AUTHORED resolution
  writes: its OWN live run ledger          writes: the MARKER + its own prep log
   (trusted side of its own cut)            (never another run's Evidence artifacts)
        |                                        |
        |                              reads earlier run (owner.run_dir) to pick a branch
        +--------------------+-------------------+
                             |
                   apply_git_only_unpark   (ONE shared contract)
                             |
      +----------------------+---------------------------+
      |                      |                           |
  own live run          cross-run, earlier run       cross-run, earlier run
  (autonomous)          absent / rotated / TERMINAL  present + LIVE (held)
  clear ledger FIRST    marker-alone IS complete     REFUSE: cannot bare-strip a
  (mutateLedgerUnderLock)  (no live surfacer reads     live surfacer nor cross-write
  then the marker;         parked); marker cleared;    its Evidence ledger; defer to
  ledger_cleared:true      ledger_cleared:false        that run's own resume-reconsider
      |                      (+ malformed => REFUSE)        |
      +----------------------+---------------------------+
                             |
             record park-reconsidered (events.jsonl OR prep log per seam)
                             |
      autonomous only: transition to the spec-review-resume hold, so beep-boop's
      prep-queue drain re-enters the issue at the spec-review gate
```

Both seams meet at `apply_git_only_unpark`, which owns the marker clear, the "never a bare strip" ordering, and the record shape. They differ in the gate, in which ledger (if any) they are authorised to write, and in whether they hand off to the prep-queue drain. **Chosen:** one shared contract, parameterised by ledger-write authority, so the marker clear and its ordering are fixed once, while the kernel's Evidence rule still binds each seam correctly.

### Repo-root confinement of the cited input (infosec)

`cited_input.ref` is read back from `.faff/prep/<issue>.json`, which the kernel classes as Sensor/resume input: single-writer but untrusted (kernel.md line 295). A lane that wrote a malicious `ref` would otherwise get an arbitrary file hashed at resume. The lexical `resumecheck.isUnderRunsRoot` model (`path.resolve` + strict `startsWith`) is NOT sufficient: it never resolves symlinks, so a `ref` that is lexically inside the repo root but is a symlink pointing outside it (for example `.faff/tmp/link -> /etc/ssh/sshd_config`, or a huge or special file) passes the lexical check and is then dereferenced. FAFF-993 confines with the realpath-contain model already proven in `spec-judge-casefile.js`:

```
FUNCTION confine(root, ref):                 # returns ref_in_root : BOOL
  IF ref is null OR not a string:  RETURN false
  candidate := path.resolve(root, ref)
  # realpathSafe: fs.realpathSync, tolerating a non-existent leaf by resolving the
  # nearest EXISTING ancestor (so a not-yet-created config file still resolves through
  # its real, symlink-followed parent chain). Ported from spec-judge-casefile.js.
  real     := realpathSafe(candidate)
  rootReal := realpathSafe(root)
  # strict containment AFTER symlink resolution; a symlink that escapes the root fails here.
  RETURN real == rootReal OR real.startsWith(rootReal + path.sep)
```

The impure caller runs `confine` before any fingerprint read, at both the autonomous pass and the interactive `new_fp` computation. An out-of-root ref (including a symlink escape) is rejected fail-closed: the caller supplies `ref_in_root = false`, never dereferences the input, and `classifyReEntry` returns `ref-outside-repo-root`. **Chosen:** realpath-contain, not the lexical model; the pure core stays filesystem-free via the precomputed `ref_in_root` boolean, and the symlink target is resolved and re-checked before any read.

**Anti-pattern:** confining `cited_input.ref` with the lexical `path.resolve` + `startsWith` check alone. Why: it does not resolve symlinks, so an in-root symlink pointing out of the tree is dereferenced and its content hashed, breaking the "never dereferenced out of root" guarantee.

### The shared unpark helper

The helper owns the marker clear and its ordering. Its ledger handling is parameterised by `ledger_authority`: `own-live-run` (the autonomous seam, writing its own run's Evidence ledger from the trusted side of that run's cut) or `cross-run-readonly` (the interactive seam, which may read but never write the earlier run's ledger). It clears any authorised ledger surfacer FIRST, and only on a settled ledger step clears the marker, so there is never a window where the marker is cleared while a live ledger the seam controls still reads `parked`.

```
PROCEDURE apply_git_only_unpark(root, marker, key, cause, via, prev_fp, new_fp, ledger_authority):
  run_dir := marker.owner?.run_dir
  probe   := readOutcomes(run_dir)     # queue-state split: { outcomes, malformed }  (READ, both seams)

  # BRANCH R (present-but-unparseable ledger) -> REFUSE, both seams.
  IF probe.malformed:
     RETURN { unparked:false, reason:"earlier-run-ledger-malformed; surfaced, park left standing" }

  IF ledger_authority == "own-live-run":
     # AUTONOMOUS: trusted side of its OWN run's cut. Clear the outcome under the lock, then the marker.
     IF run_dir AND ledger-file-exists(run_dir):
        res := mutateLedgerUnderLock(run_dir, (fresh) => {
                 IF fresh?.outcomes?[key] != "parked": RETURN null   # already moved => idempotent no-op
                 delete fresh.outcomes[key]
                 RETURN fresh
               })
        IF res threw LEDGER_LOCKED OR res.yielded OR res threw a parse error:
           RETURN { unparked:false, reason:"own-run-ledger-busy-or-corrupt; retry, park left standing" }
        ledger_cleared := true ; ledger_note := null
     ELSE:
        ledger_cleared := false ; ledger_note := "absent-run"   # own run always present in practice; defensive
  ELSE:  # ledger_authority == "cross-run-readonly"  (INTERACTIVE)
     # NEVER write the earlier run's Evidence ledger/events. Branch on its liveness (read-only).
     IF NOT run_dir OR NOT ledger-file-exists(run_dir):
        ledger_cleared := false ; ledger_note := "absent-run"           # marker-alone is complete
     ELSE IF earlier-run-is-held(run_dir):     # runIsHeld over the earlier ledger + heartbeat (READ)
        RETURN { unparked:false, reason:"earlier-run-live; its own resume-reconsider clears this, or stop/resume it" }
     ELSE:
        ledger_cleared := false ; ledger_note := "earlier-run-terminal"  # historical ledger; marker is the live surfacer

  # Only AFTER the ledger step settled: clear the marker (Sensor/resume class; both seams may write it).
  rewrite .faff/prep/<key>.json: remove disposition "parked", drop the `park` sub-object
  record park-reconsidered { via, ledger_cleared, ledger_note, cited_input_ref, prev_fp, new_fp }
     # autonomous -> run_dir/events.jsonl (run-scoped event) ; interactive -> the interactive prep log
  RETURN { unparked:true, ledger_cleared, ledger_note }
```

**Canonical marker.** The autonomous seam clears its own run's ledger before the marker and refuses (no strip) on malformed/locked/yielded. The interactive seam never writes the earlier run's ledger: it clears the marker alone when the earlier run is absent, rotated, or terminal (no live surfacer reads `parked` for a run that is not being drained), and refuses when the earlier run is present-but-malformed or still live. A committed autonomous ledger clear that finds the outcome already moved is an idempotent no-op, still `unparked:true`.

Why the interactive marker-alone clear is not a bare strip: `queue-state.deriveQueueState` reads outcomes for one run dir. An absent or rotated run reads empty outcomes (the item is pending, never `parked`). A terminal earlier run is not being drained, so no live convergence gate consults its `all-parked`; a new lights-out run mints a fresh run dir with its own outcomes, and `faff next` re-admits the issue from the cleared marker. Only a still-live earlier run has a `queue-state` a drain is actively reading, and that case refuses rather than strip.

### The autonomous seam: the resume reconsider pass (prep-queue path)

```
PROCEDURE reconsider_parked_items(run_dir, root, now):
  # runs in resumeLightsOut after classify / preflight, before the beep-boop hand-off
  changed := []
  FOR each parked item in this run (ledger outcome == "parked" OR prep marker disposition == "parked"):
     marker      := read .faff/prep/<key>.json ; cause := marker.park
     ref_in_root := confine(root, cause?.cited_input?.ref)                    # realpath-contain, fail-closed
     observed_fp := ref_in_root ? fingerprint(root, cause.cited_input) : null # null if unreadable / out-of-root
     verdict     := classifyReEntry(cause, observed_fp, ref_in_root, now)     # PURE
     IF verdict.reconsider:
        res := apply_git_only_unpark(root, marker, key, cause, "resume-reconsider",
                                     cause.cited_input.fingerprint, observed_fp, "own-live-run")
        IF res.unparked:
           # Re-entry: put the issue into the FAFF-900 spec-review-resume hold so the prep-queue
           # drain re-enters it at the spec-review gate (NOT graft; see next.js line 57 vs 52).
           # In git-only mode the hold-file presence IS the awaiting-spec-review signal (the label
           # op is a tracker no-op); the tracker path also applies faff-awaiting-spec-review.
           write .faff/resume/<key>/spec-review-hold.json { cause:"reconsider-input-changed", ... }
           changed.append(key)
  RETURN changed
```

The re-entry is the kernel Unpark trigger performed autonomously, but through machinery that already ships and is already lights-out. The reconsider pass does not re-review the spec and does not assume a bespoke autonomous prep mode. It leaves each unparked issue in the spec-review-resume hold state that `next.js`'s `awaitingSpecReview` arm already routes to `prep` "regardless of retained confidence" (next.js lines 47 to 52, 90 to 95). On the hand-off drain, beep-boop's prep-queue build (step 2, the `faff next` membership consult that already admits a `faff-awaiting-spec-review` Backlog issue) includes the issue, and the prep-queue drain (step 3) invokes `faff-prep` in autonomous mode. faff-prep's autonomous stale-refresh path re-runs the spec-review gate on the refreshed spec against the now-changed config, and routes on the verdict (`approve` promotes; a non-`approve` re-parks or loops). **Chosen:** re-enter through the existing spec-review-resume hold and the shipped autonomous prep drain, so the unparked issue rejoins the same spec-review gate every prep-queue issue rides, with no new re-entry code and no new autonomous execution mode.

Why the hold, not a bare marker clear: a cleared-park Backlog issue with a high-confidence spec routes `graft` under `faff next` (next.js line 57 / selftable line 77), which would build a spec the review gate had parked. The `awaitingSpecReview` arm is the one existing route that sends a specced Backlog issue back to `prep` and therefore back through the spec-review gate. FAFF-900's `spec-review-hold.json` already carries a discriminated `cause` (outage, `turn-budget`); FAFF-993 adds `reconsider-input-changed`.

### The interactive seam: `/faff-prep` re-invoke on a git-only parked issue

An interactive `/faff-prep <issue>` re-invoke has no active run of its own: the `parked` outcome (if any live ledger still holds it) lives in the ledger of the earlier L4 run, resolved read-only through the marker's `owner.run_dir` (prepcheck.js lines 112, 129), which may point at a deleted, rotated, or never-existed run dir (line 96). Per kernel.md line 295, that earlier run's `run-ledger.json` and `events.jsonl` are Evidence class, writable only from the trusted side of that run's own dispatch cut; the interactive session is not that side, so it writes neither. It writes only the marker (Sensor/resume class) and its own prep log.

```
PROCEDURE interactive_reprep_unpark(root, issue):
  marker := read .faff/prep/<issue>.json
  IF marker.disposition != "parked":
     proceed with the ordinary Scenario B flow (nothing to unpark); RETURN

  # A human is present and authoritative. The gate is an OBSERVABLE the human supplies,
  # NOT the model's opinion. The gateway's Interactive park resolution (surface, don't settle)
  # rule governs: surface the cited cause + a recommendation; the human authors the resolution.
  work the park's cited cause with the human

  resolved := (the human authored a **Chosen:** marker closing the cited punt/cause id)
              OR (the human issued an explicit unpark instruction)     # the observable gate
  IF resolved:
     new_fp := (marker.park?.cited_input?.kind == "config-file"
                AND confine(root, marker.park.cited_input.ref))
                 ? fingerprint(root, marker.park.cited_input) : null
     IF new_fp != null AND new_fp == marker.park.cited_input.fingerprint:
        surface a warning: "cited config is byte-identical to park time; confirm this resolution is intended"
        # advisory only; the authored resolution is authoritative, recorded either way
     res := apply_git_only_unpark(root, marker, issue, marker.park, "interactive-reprep",
                                  marker.park?.cited_input?.fingerprint, new_fp, "cross-run-readonly")
     IF NOT res.unparked:   # earlier ledger malformed, or the earlier run is still live
        surface res.reason to the human (park still standing; resume/repair/stop the earlier run, or retry);
        do NOT proceed as if unparked
     ELSE:
        proceed with the (now-unparked) spec / confidence-gate / build-offer flow
  ELSE:
     # the human did NOT author a resolution, so more questions remain. The park STANDS, honestly.
     leave disposition:"parked" in place; /faff-wtf re-surfaces it.
```

**Chosen:** the interactive unpark fires on the presence of a human-authored resolution artifact (a `**Chosen:**` closing the cited cause, or an explicit unpark), which is inspectable in the re-attached spec, not on a model judgement of whether free-form input settled the cause. The fingerprint is recomputed for a config-file cause and recorded (and used to warn on a byte-identical config), but the authoritative gate is the authored artifact, so the branch has a deterministic oracle.

### The admitted mid-run path

`reconstructResumePlan` (resume.js line 88) sends every `parked` outcome to `plan.terminal` via `TERMINAL_NON_SHIPPED` (line 38). FAFF-993 adds a `plan.reconsider` bucket: for an admitted issue with outcome `parked`, the impure evidence gatherer supplies its `ParkCause`, the `ref_in_root` bit, and the observed fingerprint, and `classifyReEntry` decides. A `reconsider:true` verdict routes the issue to `plan.reconsider`, and `resumeLightsOut` runs the same `apply_git_only_unpark` (own-live-run) plus the spec-review-resume hold transition as the prep-queue path, leaving `plan.terminal` for genuine human parks. Same pure core; only the plumbing differs. This is the natural peel-off named in section 2.

### Failure modes

| Failure | How it shows up | How you would notice |
|---|---|---|
| Autonomous unpark clears the park but the issue never re-enters | The resume clears the ledger + marker, hands off, and the drain reports `no-work-since-run-resume` | The reconsider pass writes the spec-review-resume hold; the e2e test asserts a `prep-start` for the issue in the hand-off drain and an `approve`-or-re-park spec-review outcome, not a silent no-work exit |
| Marker disposition cleared but a live ledger outcome left `parked` (autonomous) | `queue-state derive` still reports `all-parked` | The helper clears the own-run ledger FIRST and only clears the marker on a settled ledger step; the concurrency test asserts no half-unpark |
| Interactive unpark cross-writes an earlier dispatched run's Evidence ledger | An interactive session forges a dispatched run's `parked` clear | The interactive path never calls `mutateLedgerUnderLock` against another run; the test asserts the earlier ledger bytes are unchanged and only the marker + prep log moved |
| Interactive unpark against a still-live earlier run | The earlier run is mid-drain; a bare marker strip would lie to its live `queue-state` | The helper refuses (`earlier-run-live`), leaves the park standing, and defers to that run's own resume-reconsider; the test asserts no marker strip |
| Interactive unpark: `owner.run_dir` rotated / gone | The earlier run's ledger cannot be found | Marker-alone is complete (`readOutcomes` on a missing ledger is empty, not `parked`); the record notes `absent-run`; the e2e test asserts no live `all-parked` |
| Interactive unpark: earlier ledger present-but-malformed | Cannot safely reason about the outcome | Refuse the whole unpark, leave the park standing, surface `earlier-run-ledger-malformed`; the test asserts the marker is NOT stripped |
| Out-of-repo-root or symlink-escaping `cited_input.ref` | An arbitrary out-of-tree file would be hashed | Realpath confinement rejects it fail-closed; `classifyReEntry` returns `ref-outside-repo-root`; selftest + an e2e symlink case cover it (no read occurs) |
| Interactive gate mis-fires on model opinion | The park clears without a human resolution, or stands despite one | The gate is the authored `**Chosen:**` / explicit unpark artifact; the test drives the two branches by supplying / withholding that artifact, a deterministic input |
| Human park mis-classified `machine` at park time (FAFF-992's seam) | A taste/scope park auto-re-opens at the autonomous seam | The FAFF-992 `park-reconsider-classification` grader (hard gate here) fails; `classifyReEntry` also treats an absent record as `human` |
| Reconsider re-opens, review re-parks on the same cause | A loop each drain | Bounded by FAFF-992's repeat-park counting (three same-class parks in twenty-one days flags it) |

### Anti-patterns

**Re-reviewing the spec inside `resumeLightsOut`, or inventing a lights-out `/faff-prep` mode.** The reconsider pass must not re-run the spec-review gate itself or assume an autonomous prep path distinct from the shipped one. It clears the park and sets the spec-review-resume hold; the existing prep-queue drain and its autonomous stale-refresh re-run the gate.

**Clearing the marker alone so the unparked issue routes straight to `graft`.** A cleared-park high-confidence Backlog spec routes `graft` under `faff next`, building a spec the review gate had parked. Re-entry goes through the `awaitingSpecReview` arm so the spec-review gate runs again first.

**An interactive session writing a different run's Evidence artifacts.** The interactive seam never clears another run's ledger or appends to its `events.jsonl`. It writes the marker and its own prep log; the earlier run's ledger is read-only.

**A bare `disposition` strip against a live surfacer.** Clearing the marker while a resolvable ledger still reads `parked` leaves `queue-state`'s `all-parked` intact. The helper clears the authorised ledger first (autonomous), or refuses on a live/malformed earlier run (interactive); it clears the marker alone only where no live surfacer reads `parked`.

**Reconsider by cause class alone (autonomous seam).** Re-opening a park because its `cause_class` is `config-fault`, without proving the cited input changed, re-opens FAFF-900's closed in-turn decision. The autonomous licence is the fingerprint diff, not the class.

---

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

**The reproduced incident: a config-fixed prep-queue park re-enters autonomously and reaches the spec-review gate.**
Given a git-only L4 run whose only remaining item is a spec-review `needs-human` park recorded (by FAFF-992) with `reconsider:"machine"`, a `config-file` cited input pointing at the review config (a repo-root path), and a park-time fingerprint; and given the operator has since edited that config so its current fingerprint differs; when `faff lights-out --resume <run-id>` runs the reconsider pass and hands off to beep-boop; then `classifyReEntry` returns `reconsider:true, reason:"input-changed"`, `apply_git_only_unpark` (own-live-run) clears the ledger `parked` outcome then the marker and records `park-reconsidered {via:"resume-reconsider", ledger_cleared:true}` to the run's `events.jsonl`, the reconsider pass writes the spec-review-resume hold, `queue-state derive` returns `work-remaining`, and the hand-off prep-queue drain admits the issue (via `faff next` `awaitingSpecReview` -> `prep`), invokes `faff-prep` autonomous, and re-runs the spec-review gate against the fixed config.

**The autonomous re-entry actually re-dispatches prep (the effect, not just the clear).**
Given the reconsidered issue left in the spec-review-resume hold at the end of the reconsider pass; when beep-boop's prep-queue build and drain run on the hand-off; then a `prep-start` event for the issue is emitted this run and `faff-prep` autonomous returns a spec-review outcome (`promoted`/`refreshed` on `approve`, or a re-park on non-`approve`), so the issue is provably re-entered and not merely un-flagged.

**The second symptom: an interactive re-invoke that the human resolves actually unparks (earlier run terminal).**
Given a git-only issue whose marker carries `disposition:"parked"`, a `park` cause record, and `owner.run_dir` pointing at an earlier, terminal (not held) run; when the operator runs `/faff-prep <issue>` and authors a `**Chosen:**` closing the cited cause; then the interactive seam reads the earlier run (terminal), runs `apply_git_only_unpark` (cross-run-readonly), clears the marker alone, records `park-reconsidered {via:"interactive-reprep", ledger_cleared:false, ledger_note:"earlier-run-terminal"}` to the interactive prep log (not the earlier run's events stream), and the issue proceeds, not left parked at turn end.

**Interactive unpark refuses against a still-live earlier run.**
Given the same parked issue but `owner.run_dir` pointing at a run that is still held; when the human authors a resolution; then `apply_git_only_unpark` refuses (`earlier-run-live`), leaves `disposition:"parked"` in place, surfaces that the earlier run's own resume-reconsider will clear it (or the human stops/resumes it), and never cross-writes the live run's ledger.

**Interactive unpark refuses on a present-but-malformed earlier ledger.**
Given the parked issue and an `owner.run_dir` whose ledger is present but unparseable; when the human authors a resolution; then `apply_git_only_unpark` refuses (`earlier-run-ledger-malformed`), leaves `disposition:"parked"` in place, and surfaces the reason. Never a half-unpark.

**An interactive re-invoke with no authored resolution honestly stays parked.**
Given the parked issue; when the operator runs `/faff-prep <issue>` and does not author a `**Chosen:**` or an explicit unpark; then `disposition:"parked"` stands, no `park-reconsidered` record is written, and `/faff-wtf` re-surfaces it. This branch and the resolved branch are distinguished by the presence of the authored artifact, a deterministic oracle.

**A symlink-escaping cited ref fails closed.**
Given a `machine` park whose `cited_input.ref` is lexically inside the repo root but is a symlink resolving outside it; when the reconsider pass runs; then realpath confinement rejects it, `classifyReEntry` returns `reconsider:false, reason:"ref-outside-repo-root"`, and the symlink target is never read or fingerprinted.

**A genuine human park is never auto-re-opened.**
Given a park recorded `reconsider:"human"`; when any resume runs and any files change; then `classifyReEntry` returns `human-park`, surfacers are untouched, and the issue still requires the human decision.

**A machine park whose input has not changed stays parked (autonomous seam).**
Given a `machine` park whose cited config matches its park-time fingerprint; when the reconsider pass runs; then `classifyReEntry` returns `input-unchanged` and the run does not clear or re-enter it.

**A legacy park record is treated as human.**
Given a `disposition:"parked"` marker with no `park` sub-object; when the reconsider pass runs; then it reads as `human` and is never auto-reconsidered.

**An admitted mid-run park with changed input re-dispatches.**
Given an admitted issue with outcome `parked`, a `machine` record, and a changed cited input; when `reconstructResumePlan` runs; then it lands in `plan.reconsider`, is cleared by the same `apply_git_only_unpark`, and re-enters through the spec-review-resume hold.

---

## 6. Design decision rationale

**The git-only Unpark contract fires at every unpark seam, through one helper.** Options: autonomous seam only; one shared contract at both seams. Leaving the interactive re-invoke as-is keeps the reproduced second symptom. **Chosen:** one shared `apply_git_only_unpark` helper called by both seams, parameterised by ledger-write authority so the marker clear and its ordering are fixed once while the kernel's Evidence rule still binds each seam.

**The autonomous seam re-enters through the existing spec-review-resume hold and the shipped autonomous prep drain.** Options: annotate the run with a bespoke re-queue and invent an autonomous re-review; clear the marker and let `faff next` route it (routes to `graft`, wrong); reuse the FAFF-900 spec-review-resume hold. The first assumes an autonomous prep mode the tree does not have and duplicates the spec-review gate; the second builds a parked spec. **Chosen:** clear the park, then set the spec-review-resume hold (`.faff/resume/<issue>/spec-review-hold.json` with `cause:"reconsider-input-changed"` plus the awaiting-spec-review marker flag), so beep-boop's prep-queue build re-admits via `faff next`'s existing `awaitingSpecReview` arm (next.js lines 47 to 52) and faff-prep's autonomous stale-refresh re-runs the spec-review gate. No new re-entry code, no new autonomous mode.

**The interactive seam writes only the marker and its own prep log; it never cross-writes a dispatched run's Evidence artifacts.** Options: clear the earlier run's ledger from the interactive session (the earlier design); write nothing but the marker and defer/refuse on the earlier ledger. kernel.md line 295 binds Evidence-class writes to the trusted side of the run's own dispatch cut; the earlier run is a dispatched L4 run, and a separate interactive session is not its trusted side, so clearing its ledger is an unauthorised evidence write. **Chosen:** the interactive seam reads the earlier run (via `owner.run_dir`) only to pick a branch, clears the marker (Sensor/resume class, which it may write), records to its own prep log, and either completes marker-alone (absent/rotated/terminal, no live surfacer) or refuses (malformed or still-live). A still-live earlier run's own resume-reconsider clears its ledger later.

**The interactive unpark gates on a human-authored observable, not a model judgement.** Options: fire when the model judges the free-form input closed the cause; fire on an explicit human-authored resolution artifact. The first is an ungraded LLM opinion with no oracle, which the review rejected. **Chosen:** fire on a `**Chosen:**` the human authored that closes the cited cause (the gateway's Interactive park resolution rule already requires it) or an explicit unpark; recompute and record the fingerprint for a config-file cause and warn on a byte-identical config, but treat the authored artifact as authoritative. The artifact is inspectable, so the branch has a deterministic grader.

**Confine the cited-input ref with realpath, not the lexical model.** Options: reuse `resumecheck.isUnderRunsRoot` (lexical `path.resolve` + `startsWith`); use the realpath-contain model. The lexical check does not resolve symlinks, so an in-root symlink pointing out of the tree is dereferenced and hashed. **Chosen:** the `spec-judge-casefile.js` realpath-contain model (`realpathSafe` + strict `startsWith` after symlink resolution, tolerating a non-existent leaf via the nearest existing ancestor); an escaping ref is `ref-outside-repo-root`, fail-closed, never dereferenced.

**The contract clears every git-only surfacer it is authorised to clear, together.** Options: strip the marker and rely on later reconciliation; clear the authorised ledger outcome first, then the marker. **Chosen:** clear the authorised ledger outcome first (under the lock) and the marker second; refuse rather than half-clear when the authorised ledger step cannot settle, and clear the marker alone only where no live surfacer reads `parked`.

**The autonomous reconsider licence is a demonstrated input change, not an inherent cause property.** Options: reconsider any `config-fault`; reconsider only on a proven cited-input change. The cause-class licence re-opens FAFF-900's in-turn ruling. **Chosen:** the input-change licence, a resume-time signal the in-turn retry never has; a different regime, leaving FAFF-900 closed.

**No manual operator affordance.** Options: a `faff unpark` verb; a `faff-tidy --reconsider`; no operator verb. **Chosen:** no operator verb; the interactive `/faff-prep` re-invoke (the kernel's own trigger) covers the human-present case without a new command.

**Primary path is the prep-queue park; the admitted mid-run path shares the core.** **Chosen:** specify both, exercise the prep-queue path end-to-end in tests, route an admitted `parked` outcome through the same `classifyReEntry` into a `plan.reconsider` bucket and the same re-entry.

**Fail closed on indeterminate input (autonomous seam).** **Chosen:** an unreadable, out-of-root, or symlink-escaping input is not evidence of change; the park stays, recoverable next drain or by an interactive re-invoke.

---

## 7. Open questions and assumptions

**Punt:** backend cited-input change detection, needs human (decides: architecture). A `config-file` cited input fingerprints cleanly. A `backend` cited input has no obvious content to hash, and "the backend is now reachable" is a liveness probe, not a change diff. The shipped autonomous path fingerprints config-file inputs only; a `backend` cited input fails closed until the mechanism is decided. The interactive seam is unaffected. This is the holdout scenario in section 5.

**Punt:** multi-file or environment-variable cited inputs, needs human (decides: architecture). If a config-fault cites several files or an environment variable, the single `ref` plus `fingerprint` shape needs either a fingerprint list or an explicit "not fingerprintable, stays human" rule. The shipped path assumes a single repo-root config file; a multi-source cause records `reconsider:"human"` (FAFF-992) until resolved.

**Assumes:** FAFF-992 park-record schema. The `reconsider` outcome, `cited_input`, and the marker `park` sub-object are built and written by FAFF-992 at park time. FAFF-993 reads them and does not define them. FAFF-993 is `blockedBy` FAFF-992. Validate: confirm the marker `park` sub-object and the `faff-parks` `cited_input`/`reconsider` fields are present in the FAFF-992 branch before building.

**Assumes:** the FAFF-900 spec-review-resume hold exists and routes back to prep. `next.js`'s `awaitingSpecReview` arm (lines 47 to 52, 90 to 95) routes a specced Backlog issue to `prep` regardless of retained confidence; `spec-review-hold.json` carries a discriminated `cause`; beep-boop's prep-queue build admits a held Backlog issue via the `faff next` consult; faff-prep's autonomous stale-refresh re-runs the spec-review gate. Validate: re-read these four sites before wiring the reconsider re-entry.

**Assumes:** git-only awaiting-spec-review derivation, and FAFF-993 wires it if absent (decides: architecture). In tracker mode the hold is carried by the `faff-awaiting-spec-review` label (`labels.js` line 27), and beep-boop's prep-queue build sets the `faff next --awaiting-spec-review` flag from that label. In git-only mode the label op is a tracker no-op, so the hold's only trace is `.faff/resume/<issue>/spec-review-hold.json`. The autonomous re-entry therefore requires beep-boop's prep-queue build to derive `awaitingSpecReview` from that hold-file's presence in git-only mode. If that derivation already exists (FAFF-900 shipped a git-only spec-review-outage resume), FAFF-993 reuses it unchanged and this is a pure `**Assumes:**`. If it does not, FAFF-993 must add it: in git-only mode, an issue with a `.faff/resume/<issue>/spec-review-hold.json` present and no cleared marker resolves `awaitingSpecReview = true` for the membership consult. Validate first (read beep-boop's prep-queue build and faff-prep's `spec-review-held` git-only path); the DONE item below is conditional on that read. This is the residual open question that holds the rating at medium.

**Assumes:** the FAFF-900 hold machinery exists and is closed (Done). The park-versus-hold prevention boundary that keeps recoverable transients from parking (FAFF-900 / FAFF-992) is not re-built here; FAFF-993 only re-enters parks that were correctly recorded.

**Assumes:** park-time classification assigns the reconsider outcome. The `machine`-versus-`human` outcome rides on FAFF-992's park-time classification. FAFF-993 reads the recorded outcome and never re-derives it.

---

## 8. DONE

Each item mirrors the body one-to-one and is testable.

- [ ] New pure core `classifyReEntry(cause, observed_fp, ref_in_root, now)` in `park-reconsider.js` returns `reconsider:true` only for a `machine` park with a stored fingerprint, `ref_in_root == true`, and a differing observed fingerprint; every other input returns `false` with the specific reason. **Named selftest table** `PARK_RECONSIDER_SELFTEST_CASES`, driven by `faff park-reconsider --selftest` with an injected fixed NOW, covers every reason: `human-park`, `no-cited-input`, `no-stored-fingerprint`, `ref-outside-repo-root` (fail-closed), `fingerprint-unreadable` (fail-closed), `clock-not-advanced`, `input-unchanged`, `input-changed`, plus a legacy-record-reads-`human` case.
- [ ] Repo-root confinement of `cited_input.ref` uses the realpath-contain model (`realpathSafe` + strict `startsWith` after symlink resolution, tolerating a non-existent leaf), not the lexical `resumecheck.isUnderRunsRoot` model. It runs before any fingerprint read at both the autonomous pass and the interactive `new_fp` computation. Covered by the `ref-outside-repo-root` selftest case plus an e2e case with an in-root symlink resolving outside the repo, asserting no read of the target occurs.
- [ ] `faff park-reconsider` is registered in the `../faff` COMMANDS dispatch table and its `PARK_RECONSIDER_SURFACE` is exported from `park-reconsider.js` and wired so `faff cli-surface --selftest` passes (SURFACES bijective with COMMANDS).
- [ ] The shared `apply_git_only_unpark` helper is parameterised by `ledger_authority`. For `own-live-run` (autonomous): clears the run's `parked` outcome via `mutateLedgerUnderLock` FIRST then the marker, refusing (no strip) on `LEDGER_LOCKED` / yield / parse-throw, and appends a run-scoped `park-reconsidered` event to the run's `events.jsonl`. For `cross-run-readonly` (interactive): never calls `mutateLedgerUnderLock` against the earlier run; refuses on a present-but-malformed earlier ledger and on a still-live earlier run; clears the marker alone (recording `ledger_cleared:false` with `ledger_note` in {`absent-run`, `earlier-run-terminal`}) when the earlier run is absent, rotated, or terminal; and records to the interactive prep log, never the earlier run's events stream. `park-reconsidered` is registered in `governance-profile.js` `event_types` as run-scoped (out of `issue_scoped_types` / `outcome_required_types`, parity with `run-resume`). Covered by a branch selftest over both authorities and every branch.
- [ ] The interactive prep-log `park-reconsidered` record has a defined path and shape: a structured line in `.faff/logs/YYYY-MM-DD/HHMMSS-prep-<issue>.md` (the faff-prep park-protocol log path) carrying `{issue, cause_class, via:"interactive-reprep", ledger_cleared, ledger_note, cited_input_ref, prev_fingerprint, new_fingerprint}`. A reader/asserter is exercised by the interactive-seam e2e test.
- [ ] The interactive seam never writes another run's Evidence artifacts: a test drives the earlier-run-terminal and earlier-run-live cases and asserts the earlier run's `run-ledger.json` and `events.jsonl` bytes are unchanged (only the marker and the interactive prep log moved).
- [ ] **Concurrency test** (`park-reconsider.test.mjs`): `apply_git_only_unpark` (own-live-run) exercised against the `mutateLedgerUnderLock` lock on the same key, asserting no lost update and no double-clear inconsistency (a second clear is an idempotent no-op; the marker and ledger end consistent).
- [ ] `reconstructResumePlan` routes an admitted `parked` outcome with a reconsiderable record to a new `plan.reconsider` bucket, not `plan.terminal`; covered by a `resume --selftest` case.
- [ ] The autonomous reconsider pass transitions each unparked issue into the FAFF-900 spec-review-resume hold: it writes `.faff/resume/<issue>/spec-review-hold.json` with `cause:"reconsider-input-changed"`, so `faff next --awaiting-spec-review` routes the issue to `prep`. Covered by a unit assertion on the hold artifact plus a `faff next` route assertion.
- [ ] **Git-only awaiting-spec-review derivation (conditional on the validation read).** Confirm beep-boop's prep-queue build derives `awaitingSpecReview = true` for a git-only issue whose `.faff/resume/<issue>/spec-review-hold.json` is present (the label being a tracker no-op in git-only mode). If the derivation exists, an e2e assertion covers it as-is; if it does not, FAFF-993 adds it and the same e2e asserts a git-only held issue is admitted to the prep queue and re-entered at the spec-review gate. This is the seam the autonomous re-entry depends on end-to-end in git-only mode.
- [ ] **End-to-end autonomous-seam resume test** (`lights-out-resume.test.mjs`): a real git-only run with a real parked ledger (`outcomes[<key>]:"parked"`) and a real `.faff/prep/<key>.json` marker carrying a `machine` park record and a repo-root config-file cited input. Config untouched -> park stays, `queue-state derive` still `all-parked`, no hold written. Config edited -> resume clears both surfacers, appends `park-reconsidered {via:"resume-reconsider"}` to the run's `events.jsonl`, writes the spec-review-resume hold, `queue-state derive` reports `work-remaining`, and the hand-off prep-queue drain emits a `prep-start` for the issue and reaches a spec-review outcome (the re-dispatch EFFECT, not just the clear), rather than reporting `no-work-since-run-resume`.
- [ ] **End-to-end interactive-seam unpark test** (`park-reconsider.test.mjs` or `prepcheck.test.mjs`), against a real git-only marker with `disposition:"parked"`, a `park` cause record, and `owner.run_dir`, driving the gate by supplying or withholding an authored `**Chosen:**` (the deterministic oracle): (i) terminal earlier ledger + authored resolution -> marker cleared alone, `park-reconsidered {via:"interactive-reprep", ledger_cleared:false, ledger_note:"earlier-run-terminal"}` in the prep log, earlier ledger bytes unchanged; (ii) rotated `owner.run_dir` + authored resolution -> marker cleared, `ledger_note:"absent-run"`, `readOutcomes` on the missing ledger empty; (iii) still-live earlier run -> refuse, marker NOT stripped; (iv) present-but-malformed earlier ledger -> refuse, marker NOT stripped; (v) no authored resolution -> `disposition:"parked"` stands, no record.
- [ ] **Documentation.** `kernel.md` states the git-only Unpark contract at both seams, including the autonomous own-run ledger write basis (trusted side of its own cut) and the interactive marker-only basis (Sensor/resume class, no cross-run Evidence write). `faff-prep/SKILL.md` (Scenario B / Re-prepping / git-only mode) states an interactive re-invoke on a parked git-only issue runs the Unpark contract once the human authors a resolution, and (Autonomous Mode) that the reconsider re-entry arrives through the spec-review-resume hold. An operator-facing note describes how a git-only parked lights-out run re-enters (autonomous input-change or interactive resolution) and that a human park is never auto-re-opened.
- [ ] **Grader hard-gate dependency on FAFF-992.** The `park-reconsider-classification` grader is built in FAFF-992 and is a hard gate on this ticket's autonomous seam: the autonomous re-open must not ship until that grader passes. FAFF-993 does not build the grader; it treats a passing grader as a DONE precondition for shipping the autonomous seam. (FAFF-993 introduces no new LLM-judgement seam of its own: the autonomous gate is the pure `classifyReEntry`, and the interactive gate is the human-authored artifact, both machine-checkable.)

**Integration smoke test.**
```
1. git-only repo; FAFF-992 park a prep-queue issue: marker disposition:"parked",
   park { reconsider:"machine", cited_input:{kind:"config-file", ref:"<repo-root config>", fingerprint:F0} };
   run ledger outcomes[key]:"parked".
2. Edit the config so its content hash != F0.
3. faff lights-out --resume <run-id>.
   EXPECT: park-reconsidered {via:"resume-reconsider", ledger_cleared:true} on events.jsonl;
           ledger outcomes[key] cleared; marker disposition removed;
           .faff/resume/<key>/spec-review-hold.json { cause:"reconsider-input-changed" } present;
           queue-state derive -> work-remaining.
4. On the hand-off drain: faff next for the issue -> prep (awaitingSpecReview arm);
   faff-prep autonomous runs, re-runs the spec-review gate against the fixed config.
   EXPECT: a prep-start event for the issue this run and a spec-review outcome (promote or re-park).
```

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "assumes" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "punt" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" } ] }
```