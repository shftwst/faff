# FAFF-327 — Fleet (concurrent) Sentry supervision

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-327.

This spec defines the work for FAFF-327: extend the shipped per-run Sentry so that one supervisor resolves derailment **per member** of the `faffter-dark-concurrency-parallel` build fleet — member-scoped liveness evidence over single-writer surfaces, member-scoped verdicts, and a member-scoped subtractive intervention — while adding zero new write-paths into shared mutable state. Audience: the build agent and human reviewers. Preconditions: the FAFF-355 heartbeat-file decoupling and the FAFF-352 checkpoint wiring (both blockedBy edges on this ticket; see Assumptions).

## 1. WHY — Problem and Principles

**Load-bearing model.** Sentry's liveness evidence aggregates at run scope: `wall-clock-runaway` reads one run-level heartbeat, so under the parallel executor — N concurrent build subagents sharing one run — a single stalled member is invisible for as long as **any** peer keeps ticking, and the only lever the intervention ladder offers against it is run-scoped `abort` (kill N−1 healthy builds to stop one dead one). Give each member its own single-writer liveness file and the same one Sentry can resolve verdicts to the member, and the fleet-safe response becomes subtractive: park the stalled member at its boundary, let the fleet run on.

**Problem statement.** The FAFF-278 spike deferred fleet supervision until the parallel executor's multi-writer ledger race is closed by the dedicated single-value heartbeat file (ADR-0039, costed follow-up 3). With that fix specced (FAFF-355, approved) the admissibility criterion — *zero new write-paths into shared mutable state* — is satisfiable, but nothing yet detects a stalled member, scopes an intervention below the whole run, or gives the parallel executor's await-all gate a mechanical exit from a member that will never return. This change adds member-resolved detection and the member-park handling that consumes it.

**Design principles.**

- **Zero new shared-mutable write surfaces** (the FAFF-278 admissibility criterion, verbatim). Every evidence surface this change adds is single-writer (one member file per member, written only by that member); `faff sentry check` stays read-only report-only; the run ledger keeps its post-FAFF-355 single writer (the orchestrator). An implementation that adds any fleet-level mutable artifact with more than one writer is rejected.
- **One Sentry, member-resolved.** Fleet supervision is the same `faff sentry check` evaluator over richer evidence — never per-member sentries, never a new watcher lane (ADR-0039's who-watches-the-watcher stance).
- **Member interventions act at member boundaries only.** The orchestrator acts on a member when its agent is dead or not-yet-(re)dispatched — never by live interference with a running subagent. This is ADR-0039's constraint 2 applied at member scope.
- **Subtractive-only fleet authority.** A member-scoped intervention may park/withhold the member (narrowing the fleet); it never amends the member's work, and the ladder stays `continue | pause | abort` — `correct` remains Sentry-2/Channel A territory (out of scope).
- **Consume, never re-implement.** Member liveness reuses the FAFF-355 heartbeat-file model at its own named extension point; checkpoint plumbing reuses FAFF-352's canonical procedure and `sentry-checkpoint` event by reference.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| Sentry evaluator + kill-switch | `plugin/skills/faff/bin/lib/sentry.js` (predicates :120–248, `cmdSentry` :351, selftest :446) | The evaluator this change extends; `evalWallClock` :133 is the run-scoped liveness predicate; `evalThrash` :154 / `evalRepeatedFailure` :184 already carry per-issue evidence |
| Heartbeat write path | `plugin/skills/faff/bin/lib/heartbeat.js` (post-FAFF-355 shape: dedicated `.faff/runs/<run-id>/heartbeat` file, tmp+rename) | Gains the `--unit` member tick; the member-file extension point is named in the FAFF-355 spec's OUT OF SCOPE ("suffix the filename (`heartbeat.<issue>`), take the max at the read seam") |
| Liveness read model | `plugin/skills/faff/bin/lib/runcheck.js` (`runIsHeld` :93, staleness window :60) | Unchanged — run-level liveness semantics are preserved by construction (decision 2) |
| Parallel executor | `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (dispatch loop + await-all gate :41–47) | Gains the fleet consult in the await-all gate + the member-park handling |
| Checkpoint procedure + event | `plugin/skills/faff-beep-boop/SKILL.md` ("The interrupt" :80–90) + FAFF-352 spec (`sentry-checkpoint` event, canonical procedure) | The consult and its observability event, referenced not copied |
| Authority model | `docs/adr/0039-…` + `docs/spikes/2026-07-03-FAFF-278-corrective-authority-refutation-log.md` (Decision 2, costed follow-up 3) | The admissibility criterion and the subtractive-authority ethos this design instantiates |

**Scope statement.** This is the fleet slice of the Sentry ladder — a bin/faff CLI change (one write-path flag, one new pure predicate, verdict-shape extension) plus parallel-executor and graft prose updates, tests and docs in the same PR; project *T3 — supervision stands alone*.

## 2. OUT OF SCOPE

- **Fleet-level corrective (Channel A) authority** — machine-authored corrective inputs at member redispatch boundaries. Why excluded: gated behind the corrective-artifact integrity mechanism (FAFF-325; the shipped FAFF-373 gate makes corrective authority provably unavailable until integrity is proven) and the Channel A build itself (FAFF-326/328). Extension point: the member-park procedure in the parallel executor is where a corrective input would attach once admissible.
- **Multi-run supervision** (one Sentry across several concurrent *runs*). Why excluded: "fleet" here is the N members of one parallel run — the surface ADR-0039 deferred; cross-run supervision has no consumer today. Extension point: iterate run dirs in `cmdSentry`'s resolution step.
- **Producer-side effects instrumentation** (`faff effects declare/observe` call sites) — FAFF-352's own named follow-on, unchanged here.
- **Threshold re-tuning / new knobs** — member staleness reuses `sentry.stall_window_secs`; no new config key. Extension point: a `sentry.member_stall_window_secs` sibling if calibration data ever justifies a separate member window.
- **Sequential executor changes** — one member, single active writer; run-scoped supervision already covers it. Its SKILL.md is untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Fleet | The set of concurrent build subagents of one parallel-executor run |
| Member | One concurrency unit (an independent issue, or a collision-chain occupying one subagent), keyed by issue id |
| Member heartbeat file | `.faff/runs/<run-id>/heartbeat.<issue>` — same single-value format as the run heartbeat file (one ISO-8601 UTC timestamp + newline), written atomically (tmp+rename) by exactly one writer: that member's own subagent |
| In-flight member | An issue with a `build-start` event and no terminal outcome in the ledger's `outcomes` |
| Member-scoped verdict | A DerailmentVerdict carrying `scope: "member"` + `member: <issue>` — attributable to one member rather than the run |
| Member boundary | A point where the member's agent is dead or not-yet-(re)dispatched — the only place member interventions act |

**Member tick — CLI surface.**

```
faff heartbeat [RUN_DIR] [--unit <issue>] [--json]
  # without --unit: unchanged (post-FAFF-355: writes the run heartbeat file)
  # with --unit:    writes BOTH the run heartbeat file AND heartbeat.<issue>,
  #                 each an atomic single-value replace; ledger access stays read-only
  # --json output gains "unit": <issue>|null; exit codes unchanged
```

**Decision — member liveness source.** Options: per-member heartbeat files (FAFF-355's named extension point); member liveness derived from ledger/event timestamps only; per-member sections inside one shared file.
**Chosen:** per-member heartbeat files `heartbeat.<issue>` — the extension point the FAFF-355 spec names for exactly this consumer; each file is single-writer by construction (only its member ticks it), and a shared multi-section file would re-import the read-modify-write race FAFF-355 exists to remove.

**Decision — the member tick writes both files.** Options: `--unit` writes only the member file (run liveness then needs a new max-over-files read seam); `--unit` writes both the run file and the member file.
**Chosen:** both — the run-level scalar stays the one source every existing reader (`runcheck --hook`, agency pin, `prepIsHeld`, sentry run-liveness) already consumes, so zero read-seam changes land outside sentry; N members ticking the run file concurrently is safe by FAFF-355's own reasoning (atomic whole-file replace of a freshness scalar — any interleaving yields *some* recent timestamp).

**Decision — member identity via an explicit flag.** Options: an ambient env var the dispatch exports; an explicit `--unit <issue>` at graft's existing tick call sites.
**Chosen:** explicit `--unit` — graft already knows its issue at every tick site, and the sentry region's posture is explicit-flag-only over ambient channels (the clock seam precedent). Graft's heartbeat call sites gain `--unit <issue>` in all modes; under the sequential executor this yields one member file, which is harmless (see back-compat scenario).

**Verdict shape extension (additive, back-compatible).**

```
RECORD DerailmentVerdict:                  # existing fields unchanged
  signal, severity, evidence
  scope: "run" | "member"                  # NEW, optional; absent ⇒ "run" (legacy readers unaffected)
  member: <issue>                          # NEW, present iff scope == "member"

# scope:"member" is emitted on: the new member-stall verdict, and on
# fix-review-thrash / repeated-identical-failure verdicts whose evidence already
# names a single issue (additive annotation; their trigger math is untouched).
```

**New pure predicate.**

```
evalMemberStall(inflight, memberBeats, nowMs, th) -> [DerailmentVerdict]
  # inflight:    [{ issue, last_build_start_ts }] — derived from events (build-start)
  #              minus ledger outcomes; both surfaces orchestrator-written
  # memberBeats: { issue -> iso | null } — heartbeat.<issue> contents (null if absent)
  # per member:  age = nowMs - max(parse(memberBeats[issue]), parse(last_build_start_ts))
  #              age > th.stall_window_secs  ->  { signal: "wall-clock-runaway",
  #                severity: "trip", scope: "member", member: issue,
  #                evidence: { heartbeat_age_secs, source: "heartbeat.<issue>" | "build-start" } }
  # unparseable/absent on BOTH inputs -> no verdict for that member (fail toward run-level supervision)
```

**Decision — fleet evaluation is auto-detected, no new flag.** Options: a `--fleet` flag on `sentry check`; fire member evaluation whenever member evidence (in-flight members from events + any `heartbeat.*` files) exists.
**Chosen:** auto-detect — the evidence's presence *is* the signal that a fleet is running; a flag would be one more thing the orchestrator prose can forget, and runs with no member evidence are byte-identical to today by construction.

**Decision — in-flight derivation.** Options: ledger `admitted` minus `outcomes` (admission ≠ dispatch — wrongly counts queued-not-launched members); `build-start` events minus terminal ledger outcomes.
**Chosen:** `build-start` events minus terminal `outcomes` — dispatch is what starts a member's liveness obligation, and using the build-start timestamp as the age baseline closes the never-ticked-member hole (a member that dies before its first tick still ages from dispatch).

**Decision — member staleness window.** Options: a new `sentry.member_stall_window_secs`; reuse `sentry.stall_window_secs` (default 900s).
**Chosen:** reuse — members tick through the same graft call sites the run-level window was calibrated against, so the false-positive tradeoff is the same one already accepted; a member-scoped false positive is also cheap (park with WIP preserved, resumable), unlike the run-scoped abort it replaces. The OUT-OF-SCOPE extension point stands if calibration says otherwise.

## 4. HOW — Behavior

**Aggregation — member trips cap at `pause`.** One sentence: a member-scoped trip makes the fleet response subtractive (park that member), never the run-scoped kill.

```
PROCEDURE evaluateDerailment (delta only):
  1. existing run-scoped predicates unchanged (budget, run wall-clock, scope-drift,
     forbidden-side-effect); thrash/repeated-failure verdicts gain scope/member annotation
  2. append evalMemberStall verdicts (scope: "member")
  3. intervention roll-up:
     run-scoped trips    -> SIGNAL_TRIP_INTERVENTION ladder-max, unchanged
     member-scoped trips -> contribute at most "pause" to the ladder-max
                            (a member trip NEVER escalates to run "abort" by itself)
  4. tripped := any trip, unchanged; payload adds nothing top-level beyond verdict fields
```

**Decision — member-stall maps to `pause`, not `abort`.** Today `wall-clock-runaway` → `abort` (the whole run is runaway). At member scope the run is *not* runaway — one member is — and the existing handling table already defines `pause` as "park implicated issue(s), continue queue". Options: keep member stall → abort (kills N−1 healthy builds); map member-scoped trips to pause.
**Chosen:** pause — subtractive, bounded, consistent with the shipped pause semantics; and the run-scoped abort story stays coherent by construction: all members stalled ⇒ nothing ticks the run file ⇒ the *run-scoped* `wall-clock-runaway` trips and aborts exactly as today.

**Consult site — the await-all gate.** The parallel executor's await-all gate is the only component awake while N members are in flight — between-units boundaries don't exist mid-flight, which is precisely where a member stalls. The gate's poll loop gains the fleet consult:

```
PROCEDURE await_all_gate (delta only — inside the existing poll loop):
  1. each poll iteration, run the canonical between-units checkpoint
     (beep-boop "The interrupt", by reference — budget check, effects check,
     `faff sentry check --json --run-dir <dir>`, emit the sentry-checkpoint event)
  2. on a member-scoped pause verdict for an in-flight member:
     a. confirm the member boundary: its subagent has returned, or its liveness is
        dead per the verdict (heartbeat.<issue> AND build-start both older than the window)
     b. park the member: commit worktree WIP (park-protocol shape), post the park
        comment citing the verdict evidence, apply the park label via the label op,
        record ledger outcome "parked" (orchestrator write), free the slot
     c. a collision-chain's undispatched remainder parks per the existing
        "in-run blocker did not merge" rule
  3. on intervention "abort" (run-scoped): existing mint-scoped handling table, unchanged
     (L4 acts — `faff sentry abort`; non-L4 logs + surfaces)
  4. healthy members: keep polling to terminal outcomes, unchanged
```

**Decision — member-park is orchestrator housekeeping at every level; run-abort stays mint-scoped.** Options: gate member-park behind L4 like abort; treat it as the executor's own stall-recovery housekeeping.
**Chosen:** every level — parking a liveness-dead member is *recording reality plus preserving WIP* (the same thing an orchestrator already does for a silently-dead subagent), not an exercise of corrective authority over live work; it is fully reversible (re-run graft resumes from the branch + draft PR). The authority-laddered acts — run-scoped `abort` — keep the existing mint-scoped table untouched. A live-but-slow member is protected by step 2a: pause acts only at a member boundary, never by interrupting a running agent.

**Decision — consult cadence in the poll loop.** Options: a separate timer; every poll iteration.
**Chosen:** every poll iteration — `sentry check` is pure and local (file reads + one budget child call; FAFF-352 settled the same question for between-units cadence), and the poll interval already bounds it. No new schedule to drift.

**Observability.** Each gate consult emits the FAFF-352 `sentry-checkpoint` event with the payload verbatim — member verdicts ride inside `data.verdicts` (additive; the payload still carries no top-level `forbidden_side_effect` key, preserving FAFF-352's constraint). `faff audit`'s supervision block needs no change (it renders the payload it is given).

**Edge cases and error handling.**

- Member file exists for an issue with no `build-start` event (stale file from a prior crash/re-run) → ignored; only in-flight members are evaluated.
- Member file absent, build-start fresh → no verdict (member simply hasn't ticked yet; ages from dispatch thereafter).
- Member file unparseable/blank → treated as null, falls back to the build-start baseline (consistent with FAFF-355's silent-null direction).
- Member ticks after being declared stalled and parked → the park stands (status monotonicity); a late terminal token is reconciled against the ledger per the executor's existing reconcile rule — recording reality wins.
- Ledger unreadable → the shipped FAFF-425 indeterminate path, unchanged (exit 3, fail closed; no member evaluation on a faulted surface).
- No member evidence at all (sequential run, legacy run, interactive graft) → member evaluation contributes nothing; payload byte-equivalent to today.

**Failure modes.**

- **The failure:** false-positive member stalls (a member legitimately quiet past the window — e.g. a long CI wait between ticks). **How you'd know:** parked members whose WIP/PR was minutes from green; a rising `over-cautious-parks` calibration count. **What it means:** narrow — first via graft tick placement (its call sites already straddle the long steps), then the OUT-OF-SCOPE member-window knob. The response is deliberately cheap to be wrong about: park-with-WIP, not abort.
- **The failure:** a member ticking its own file masks only *its own* stall — a subagent alive enough to tick is by definition not liveness-dead, but a runaway-yet-ticking member never trips member-stall. **How you'd know:** thrash/repeated-failure/budget trips (all untouched) catch runaway-with-output; a ticking member producing nothing terminal eventually hits the run-elapsed ceiling. **What it means:** proceed — liveness was never the runaway detector; the signal set is complementary by design.
- **The failure:** hostile member-file content (forged timestamps, garbage) — a member can *refresh* its own liveness (identical to today's power of ticking the shared file) but must not be able to flip any run-scoped trip or another member's verdict. **How you'd know:** the AC5-style selftest extension (hostile member evidence cannot suppress a budget/run-wall-clock trip, cannot emit a verdict for a different member). **What it means:** proceed — pinned by test.

**Anti-pattern:** giving Sentry (or the fleet path) any write — a fleet-status file, a member-verdict cache, a ledger annotation. Why: `sentry check` report-only is the read-only invariant the un-subvertability story rests on; the orchestrator acts, Sentry only reads.

**Anti-pattern:** acting on a member-scoped verdict by interrupting a live subagent. Why: member interventions are boundary-only (ADR-0039 constraint 2 at member scope); a live member is either healthy (keep polling) or will be caught at its boundary.

## 5. Scenarios

```
Given a parallel run with three in-flight members, two ticking heartbeat.<issue> files
  and one whose member file and build-start are both older than stall_window_secs
When `faff sentry check --json --run-dir <dir>` runs
Then the payload carries one wall-clock-runaway verdict with scope "member" naming that
  issue, intervention is "pause", and no run-scoped abort fires (the run file is fresh)
```

```
Given the same run with ALL members silent past the window (run heartbeat file stale)
When `faff sentry check` runs
Then the run-scoped wall-clock-runaway verdict trips and intervention is "abort" — today's
  kill-switch behaviour, preserved
```

```
Given a run with no member heartbeat files and no build-start events (sequential/legacy)
When `faff sentry check --json` runs
Then the payload is byte-equivalent to the pre-change output for the same surface
```

```
Given an L4 parallel run whose gate consult returned a member-scoped pause for a
  liveness-dead member
When the await-all gate handles it
Then that member is parked (WIP committed, park comment citing the verdict, label applied,
  ledger outcome "parked") and every healthy member still reaches its own terminal outcome
```

Assertion: no sentry code path writes any file in fleet evaluation (report-only preserved; exit 0/3 semantics unchanged).
Assertion: hostile member-file content cannot flip a run-scoped trip to continue, and cannot produce a verdict attributed to a different member.
Assertion: `faff heartbeat <dir> --unit X` leaves `run-ledger.json` byte-identical (the FAFF-355 invariant extended to the member tick).

## 6. DESIGN DECISION RATIONALE

- **Where does member liveness live?** Shared multi-section file (re-imports the RMW race) vs ledger/event timestamps only (no tick signal at all) vs per-member single-value files. **Chosen:** `heartbeat.<issue>` per-member files — FAFF-355's named extension point; single-writer by construction.
- **What does `--unit` write?** Member file only (new read seam for run liveness) vs both files. **Chosen:** both — run-level readers stay untouched; concurrent run-file ticks are safe as atomic scalar replaces.
- **How does the member identify itself?** Ambient env vs explicit flag. **Chosen:** `--unit <issue>` at graft's tick sites — explicit over ambient, per the sentry region's own seam posture.
- **How does fleet evaluation switch on?** Flag vs evidence auto-detect. **Chosen:** auto-detect; absence of evidence degrades to today's behaviour byte-for-byte.
- **What is "in-flight"?** admitted−outcomes vs build-start−outcomes. **Chosen:** build-start−outcomes, with build-start as the age baseline (closes the never-ticked hole).
- **Member window?** New knob vs reuse `stall_window_secs`. **Chosen:** reuse; extension point named if calibration disagrees.
- **Member trip → which intervention?** abort (kills the fleet) vs pause. **Chosen:** pause = park-the-member; all-members-stalled still aborts via the run-scoped predicate, so the kill-switch story is preserved by construction.
- **Who acts, at what level?** Member-park L4-gated vs every-level housekeeping. **Chosen:** every level for member-park (recording a dead member + preserving WIP, reversible); run-abort keeps the mint-scoped table.
- **Consult cadence in the await gate?** Timer vs per poll iteration. **Chosen:** per iteration — pure/local/cheap, bounded by the poll interval (the FAFF-352 cadence answer, applied to the one new site).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** FAFF-355 (dedicated single-value heartbeat file) is merged before this build starts — the run heartbeat file, the tmp+rename idiom, the overlay read seams, and the ledger's return to a single orchestrator writer are this design's substrate. Validation before build: `.faff/runs/<run-id>/heartbeat` is the tick's write target in `bin/lib/heartbeat.js`, and the parallel executor SKILL.md no longer carries its "unresolved" multi-writer caveat. (Tracker edge: FAFF-327 is blockedBy FAFF-355, in-queue this run — serialise, don't park.)
- **Assumes:** FAFF-352 (sentry checkpoint wiring) is merged before this build starts — the canonical between-units checkpoint procedure and the `sentry-checkpoint` event type are what the await-all gate consult references and emits. Validation before build: `EVENT_TYPES` includes `sentry-checkpoint`; beep-boop's "The interrupt" section carries the full procedure (effects bridge + event emission). If only partially landed, park this build citing the missing half — do not inline a substitute procedure.

## 8. DONE — Definition of Done

### From WHAT (tick + files)
- [ ] `faff heartbeat <dir> --unit X --json` writes `heartbeat.X` and the run heartbeat file (both atomic tmp+rename, single-value ISO+newline), reports `"unit":"X"`, and leaves `run-ledger.json` byte-identical
- [ ] Without `--unit`, behaviour and output are unchanged from post-FAFF-355 main (test-asserted)
- [ ] Graft's heartbeat call sites pass `--unit <issue>`; the parallel executor's BuildDispatch prose notes the member tick

### From WHAT/HOW (evaluator)
- [ ] `evalMemberStall` pure core + selftest table: stalled member trips (member file baseline and build-start baseline); fresh member no-verdict; absent-both no-verdict; non-in-flight member file ignored; all-stalled ⇒ run-scoped abort still trips
- [ ] Verdict `scope`/`member` fields emitted on member-stall and annotated on thrash/repeated-failure; absent on run-scoped verdicts; trigger math of existing predicates unchanged (selftest)
- [ ] Aggregation: member-scoped trips contribute at most `pause`; run-scoped ladder unchanged (selftest)
- [ ] A run surface with no member evidence produces byte-equivalent `sentry check --json` output (test-asserted)
- [ ] AC5 extension: hostile member-file content cannot suppress a run-scoped trip nor attribute a verdict to another member (selftest)
- [ ] `faff sentry check` performs no writes on any fleet path; exit 0/2/3 semantics unchanged

### From HOW (orchestrator prose)
- [ ] Parallel executor SKILL.md: await-all gate runs the canonical checkpoint by reference each poll iteration and carries the member-park procedure (boundary confirm → WIP commit → park comment with verdict evidence → label op → ledger outcome → free slot); no duplicated checkpoint block (`faff validate-adapters` clean)
- [ ] Run-scoped abort handling table untouched (mint-scoped); member-park documented as every-level housekeeping with the boundary-only rule stated
- [ ] Sequential executor SKILL.md untouched
- [ ] `sentry-checkpoint` events emitted at gate consults carry member verdicts in `data.verdicts` with no top-level `forbidden_side_effect` key (test-asserted)

### From WHY/HOW (docs, same PR)
- [ ] bin/faff USAGE (heartbeat + sentry) and `docs/guide/cli.md` rows describe `--unit`, member-scoped verdicts, and the pause-cap roll-up
- [ ] ADR authored at graft time (via the configured adr producer) recording the fleet authority/state model as an extension of ADR-0039 (member-scoped pause = subtractive park at boundaries; abort stays run-scoped and mint-gated)

### Tests
- [ ] `faff sentry --selftest` and `faff heartbeat --selftest` extended per above, all passing
- [ ] `test/sentry.test.mjs` fleet fixture: run dir with N member files (one stale) → member-scoped pause end-to-end via runCli; injected `--now-ms` (FAFF-301 pattern, no time-of-day flake)
- [ ] `test/heartbeat.test.mjs`: `--unit` file pair + ledger-byte-identical assertions

**Integration smoke test:**

```
1. Mint a run dir + running-owner ledger; append build-start events for X and Y
2. `faff heartbeat <dir> --unit X`; write heartbeat.Y with a timestamp older than the window
3. `faff sentry check --json --run-dir <dir> --now-ms <pinned>`
     -> one verdict { signal: wall-clock-runaway, scope: member, member: Y }, intervention "pause"
4. Overwrite heartbeat.X stale too; re-run with the run file also stale
     -> run-scoped wall-clock-runaway, intervention "abort"
5. Assert run-ledger.json bytes unchanged throughout; no new files beyond the two heartbeat files
```

## Already shipped against this surface

Related Done work — foundation, none of it supersedes this premise (no fleet-scoped code exists anywhere in `bin/lib/*.js` or the executor/beep-boop skills; verified 2026-07-11):

- FAFF-49 / ADR-0034 — per-run derailment detection + the hard kill-switch (the evaluator this extends).
- FAFF-278 / ADR-0039 — the spike that settled the authority model and *deferred* fleet supervision behind the heartbeat-file fix; this ticket is its costed follow-up 3.
- FAFF-312 — wired the sentry consult + run-done governance into beep-boop's checkpoint prose (the consult exists; FAFF-352 adds its event/bridge plumbing).
- FAFF-425 — fail-closed `indeterminate` on sentry/budget read faults (inherited unchanged by the fleet path).
- FAFF-106 + FAFF-373 — effects ledger and the corrective-integrity fail-safe gate (why fleet correctives stay out of scope).

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

### Right-sized? (principle 4)

Borderline-large but coherent as one unit: the CLI half (member tick + member predicate + roll-up) and the prose half (await-gate consult + member-park) are load-bearing on each other — member verdicts with no consumer are dead payload, and a member-park procedure with no member verdicts has nothing to act on. Splitting them would ship one dead half. The slice holds 1–3 days because every hard decision arrives pre-closed by FAFF-355/352/ADR-0039; watch the fleet fixture test during build (the same keep-it-deterministic line as FAFF-355's concurrency test — assert invariants, never schedules).

### Workstream fit? (principles 1 + 5)

No issues. FAFF-327 sits in *T3 — supervision stands alone* — the outcome this ticket exists to make true — with its full prerequisite set drawn (blockedBy FAFF-352 + FAFF-355).

### Deps surfaced? (principle 6)

The two load-bearing edges exist and are honest (352 external-not-eligible, 355 in-queue-serialised). Two soft overlaps worth surfacing, no new edges drawn here (edge-drawing is the human's): (a) **FAFF-355 rewrites the exact parallel-executor SKILL.md region (:41–47) this spec then edits** — the blockedBy edge already serialises the builds, but the second build must re-verify line anchors rather than trust this spec's numbers; (b) **FAFF-345** (Backlog) also edits both executor SKILL.md files — suggest a *related* FAFF-327 ↔ FAFF-345 link so conflict analysis can serialise if both go eligible.

### Risk profile? (principle 7)

The novel element — member-liveness under real concurrency — is de-risked upstream: FAFF-355 ships the repo's first spawn-based concurrency test and the atomic single-value idiom this reuses; the member predicate itself is a pure core with an injected clock (the FAFF-301 pattern). The residual unknown is behavioural, not mechanical: whether the reused 900s window false-parks slow members — deliberately made cheap to be wrong about (park-with-WIP, resumable) and observable (calibration `over-cautious-parks`). Live-run validation of the whole supervision story is already its own ticket shape (the FAFF-328 precedent); no spike needed here.

confidence: high

spec-review: approve
