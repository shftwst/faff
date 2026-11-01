# FAFF-1434: Beep-boop's build-queue admission calls faff graft admit instead of its own prose chain

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1434.

> Amended 2026-11-01 by two operator decisions (human, binding), after an independent review of PR #1175. (1) Beep-boop's admission call passes no `--wave`, so each call takes the run's next consult ordinal and mints a fresh correlation id (section 3). (2) validate-adapters' capture-wiring and capture-same-command lints count a real `faff graft admit … --run-dir` invocation as wiring `next` and `eligible` only, never a kernel another skill drives itself (section 6).

## 1. WHY

Beep-boop's step 4 (build queue assembly, `faff-beep-boop/SKILL.md` lines 200–240) decides build admission in its own prose. It runs a `faff next` consult, then a live-thread re-scan and the automation-routing verdict, then a claim-before-admit re-read, then a `faff admissible --lights-out` filter, and wraps the `next` and `eligible` consults in `faff decision-capture decide` / `action` calls. Graft Step 2 makes the same decision through `faff graft admit` since FAFF-1414 (#1166). Two homes for one decision can drift, and the post-fix corpus grading showed they did: 14 In Review `next` records skipped by prose, and 7 FAFF-1318 records refused after `next` said `graft`.

This ticket makes beep-boop call the same command, so build admission has one home. The judgement steps (the live-thread re-scan, the routing verdict, the resolve-attempt and the endgame landing resume) stay in beep-boop.

**Two corrections to the ticket, found by replaying the corpus at prep.**

- **The action-marker exceptions are 21, not 4.** The ticket lists two capture-join records and two mis-tokened markers. Joining every one of the corpus's 52 `next`/`eligible` action markers to its base record (rule in section 4.3) gives 31 that match FAFF-1414's marker table and 21 that cannot: 5 orphans with no base record, 2 `eligible` markers with no `next` record before them, 8 whose correlation id belongs to a different kernel or issue, the 2 capture-join records, and 4 FAFF-1318 markers that record the old prose's action where the chain now says `inadmissible`. The replay in section 4.3 pins all 21 by correlation id and sequence number.
- **A stale build claim on an In Review issue must not rebuild.** FAFF-1414 ratified that a held but stale build-claim ref gives `proceed`, so graft Step 5 reclaims a crashed worker's issue. That is right for `In Progress`. For `In Review` a PR is already open: a rebuild would open a second branch and PR beside it. The designed recovery for a stranded In Review PR is beep-boop's endgame landing resume. Beep-boop therefore sends an In Review `proceed` to the endgame check, never to a build (section 6).

### Design principles

- **One admission home.** Every build-queue admission, in every mode (full pipeline, `--phases build`, explicit list, wave re-entry), passes `faff graft admit --mode autonomous`. Beep-boop shells no `faff next`, `faff eligible` or `faff admissible` for admission.
- **The last gate runs immediately before the append.** A final `faff graft admit` call, on a fresh live read and the spec as it stands after the re-scan, verdict and any resolve-attempt, always runs just before appending to `admitted`. The claim check is therefore as fresh as today's claim-before-admit re-read, and admissibility grades the spec that will be built.
- **No caller surface in the command.** `faff graft admit` is unchanged: no new flag, disposition or field. Beep-boop's buckets are a table in its own prose.
- **Fail closed.** A non-zero exit is never admitted.
- **Commissaire gains nothing.**

### Reference context

- `plugin/skills/faff/bin/lib/graft-admit.ts` — `admit()` (the chain: tracker reachability, eligibility, `next`, the claim check on `in-progress`/`in-review`, `next`'s spec routing, the intake guard, admissibility), the `Disposition` union, and `writeMarkers()` (the marker table).
- `faff-graft/SKILL.md` lines 81–98 — graft Step 2's facts block and routing table. Beep-boop builds its facts the same way.
- `faff-beep-boop/SKILL.md` step 4 (lines 200–240), step 8 (lines 260–291), explicit-list mode (lines 490–504).
- `verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl` — 40 `next` and 23 `eligible` base records, 39 `next` and 13 `eligible` action markers.
- `test/graft-admit-replay-in-review.test.mjs` — FAFF-1414's replay of the 14 In Review records; its facts builder and expectations are reused.
- `plugin/skills/faff/bin/lib/validate-adapters.js` — `SKILL_LINE_BASELINE["faff-beep-boop"]` (682) and `ANCHOR_PHRASES["faff-beep-boop"]`. None of the anchor phrases is in step 4.

### Already shipped against this surface

- FAFF-1414 (Done, #1166): built `faff graft admit` and wired graft Step 2; its spec deferred beep-boop to this ticket. It does not touch `faff-beep-boop/SKILL.md`.
- FAFF-1412 (Done): `faff drain-filter`, a runner pre-check before a drain starts. It does not decide admission inside a drain.
- FAFF-1435 (Done, #1168): `faff run summary` renders the buckets this ticket routes into. The buckets are unchanged.

None of these wires beep-boop to the command, so the premise holds.

## 2. OUT OF SCOPE

- **`faff graft admit` itself.** No change to the command, its flags, dispositions or marker table.
- **Prep-routing consults.** The prep-queue membership consult (step 2) and step 8's per-item consult for newly unblocked issues keep `faff next`. They decide whether an issue goes to narrow prep, not whether it is built; every build admission still passes step 4's call (step 8.4 re-runs step 4).
- **The judgement steps.** The live-thread re-scan, the automation-routing verdict and its cache, the resolve-attempt and the endgame stranded-In-Review landing resume stay in prose, unchanged except for where they are entered.
- **A pre-existing ordering gap, unchanged.** A Todo issue with a `medium` spec gets `needs-human` from `next` before the re-scan runs, so a human's resolving comment is not seen at step 4. That is today's order too; this ticket keeps it.
- **Run summary rendering, the run ledger schema and `runcheck`.** Unchanged: every disposition maps to an existing bucket and ledger write.
- **Commissaire.** Nothing is added to `faff commissaire` or any `commissaire*` module.

## 3. WHAT

### Interface

Per candidate, after a live `get_issue` read at assembly, beep-boop runs (twice for a candidate that clears the verdict; section 4.1):

```bash
# facts: {issue, status (the normalised `faff next --status` enum), labels: [<labels from this read>],
#         spec: {found, confidence: none|low|medium|high}, externally_blocked (an open blocker not in this run's queue),
#         claimed_at (latest transition INTO In Progress, else null),
#         tracker: {mode: tracker|git-only, configured, pinned, reachable}}
printf '%s' "$facts_json" | "$faff" graft admit --mode autonomous --facts - \
  --spec-file "$run_dir/<ISSUE>/admit-spec.md" --run-dir "$run_dir" --json
```

- Before any filesystem write, beep-boop checks the issue key from the tracker read against the identifier shape `faff graft admit` itself enforces (`^[A-Za-z][A-Za-z0-9]*-[0-9]+$`). A key that fails routes out as `admit-errored:issue-key` with no write and no call, so an untrusted key never becomes a path.
- `admit-spec.md` holds the candidate's current spec body. Before every call beep-boop deletes the previous file, then writes the spec it is about to admit; it writes none when no spec was found. A failed write leaves no file, so the command exits 2 (`spec-file-unreadable`) and the candidate routes out as `admit-errored`: a stale spec file can never be graded in place of the refreshed one.
- `--mode autonomous` always: beep-boop is the automated runner and reads no per-candidate mode signal.
- `--run-dir` makes the command write the `next`, `eligible` and `claim-verdict` decision captures itself. No `--wave` is passed: each call takes the run's next consult ordinal, so the first call, the final call and graft's Step 2 call mint distinct correlation ids (`…/next/1`, `/2`, `/3`). An explicit wave would give all three the same id, and only one of them would grade. Beep-boop runs no `decision-capture decide` driver and no `next`/`eligible` `action` call at step 4.

### Dispositions to buckets

| `disposition` | Beep-boop action |
|---|---|
| `proceed`, status not `in-review` | Live-thread re-scan, then the routing verdict, then the final call; admit on its `proceed` (section 4.1) |
| `proceed`, status `in-review` | The endgame landing check; if it does not resume, `claimed-by-peer` |
| `claimed-by-peer` | Status `in-review`: the endgame landing check, falling through to "Claimed by peer". Otherwise "Claimed by peer" |
| `inadmissible` | Routed out `inadmissible:<reason>` |
| `ineligible` | On-hold (today's `skip-ineligible`) |
| `blocked` | On-hold, reason `intake:<reason>` |
| `needs-prep` | Full pipeline: the prep queue (narrow prep). `--phases build`: Surfaced (prep deferred to primary) |
| `needs-human` | Routed out with `reason` |
| `excluded` | Dropped from the queue (today's `blocked`/`done`/`none`) |
| non-zero exit | Routed out `admit-errored:<reason>`, never admitted |

Every routed-out or claimed-by-peer candidate gets `faff run-ledger record-declined` as today, with `observed_at` captured immediately before the at-assembly read.

## 4. HOW

### 4.1 Step 4, per candidate

```
PROCEDURE admit_candidate(issue):
  out := admission_call(issue)                   # observed_at, one live read, facts, spec file, the call
  IF out is a non-zero exit: route out "admit-errored:<reason>"; record-declined; RETURN
  IF out.disposition != proceed OR facts.status == in-review: route per section 3's table; RETURN
  live-thread re-scan                            # unchanged prose (narrow prep on a Resolution/Challenge)
  routing verdict on the current spec            # unchanged prose (cache or inline)
  non-admitted verdicts route as today           # resolve-attempt for needs-decision-first
  out := admission_call(issue)                   # the final call, always: fresh observed_at, read, facts, spec file
  IF out is a non-zero exit: route out "admit-errored:<reason>"; record-declined; RETURN
  IF out.disposition != proceed OR facts.status == in-review: route per section 3's table; RETURN
  append to admitted; write the sibling snapshot # unchanged prose, nothing in between
```

- The final call is the last gate: nothing runs between it and the append, so neither a peer's claim nor a spec change can slip in after it. It runs exactly once per candidate that clears the verdict, so an admitted candidate costs two calls and two live reads, the same read count as today's assembly read plus claim-before-admit re-read.
- Each call writes its own decision captures under a fresh consult correlation id, so an admitted candidate leaves two `next`/`eligible` consult pairs in the corpus.
- Under `--phases build` a stale re-scan routes the candidate to Surfaced as today, and the final call does not run.

### 4.2 The other call sites

- **Explicit-list mode.** After the cancelled, archived and missing-issue skips, each listed issue goes through 4.1, and the re-scan moves behind `proceed`. A `needs-prep` disposition runs the explicit-list prep path (the `faff-prep` skill, autonomous). `next` gives `prep` for two cases: no spec (today's "spec missing" bullet, unchanged) and a `faff-awaiting-spec-review` hold, which today is queued for build and routed out at the verdict and now goes to prep, whose resume re-runs only the held review (row 49). A present `low` or `medium` spec gets `needs-human` and is routed out, the bucket today's verdict gives it.
- **Wave re-entry.** Step 8.4 re-runs step 4, so it runs 4.1 with a live read at that re-entry. Step 8's own `faff next` consult for newly unblocked items is unchanged (section 2).
- **The endgame landing check** keeps its eight steps unchanged. Only its entry sentence changes: it runs from `claimed-by-peer` or `proceed` with status `in-review`, instead of "before defaulting an In Review issue to claimed-by-peer".

### 4.3 The corpus replay

`test/graft-admit-replay.test.mjs` replays `verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl`, with a committed sidecar `test/fixtures/graft-admit/corpus-facts.json`:

- **Kernel replay.** Each of the 40 `next` base records reproduces its recorded verdict through `nextStep(normalised_inputs)`, and each of the 23 `eligible` base records through `automationEligible(labels, automationDefault, trackerPresent)`, called from the committed emit.
- **Disposition replay.** Each `next` record's facts are built as FAFF-1414's in-review replay builds them (status, spec confidence, and `faff-automate`, `faff-parked` and `faff-awaiting-spec-review` labels from the record's booleans), with no build-claim ref and the sidecar's admissible fixture spec, except FAFF-1318, which gets the sidecar's stand-in spec that the floor refuses (recording FAFF-1318's real refusal). Each runs through `faff graft admit --mode autonomous --facts - --now <record ts>`. The disposition equals the recorded verdict mapped `graft→proceed`, `prep→needs-prep`, `needs-human→needs-human`, for 19 records. The other 21 are the sidecar's intended divergences, by correlation id: the 14 In Review records (FAFF-1414's list, expected `claimed-by-peer`) and the 7 FAFF-1318 `next` base records, one in each of runs `…162841-…36511a`, `…185215-…1456d4`, `…185806-…620a46`, `…190707-…906233`, `…191213-…fe15ad`, `…191711-…7a746f` and `…192721-…c7df54` (expected `inadmissible`). These count base records, not action markers; the marker classes below are a separate tally. The two capture-join records (FAFF-1293 and FAFF-1249 `next/1` in `…162841-…36511a`) are Backlog with no spec and a recorded `prep` verdict, so they replay cleanly to `needs-prep` and sit among the 19; only their action markers diverge.
- **Action-marker replay.** Each of the 52 `next`/`eligible` markers joins the base record with the same correlation id, kernel and issue. Its expected action is the marker table in `graft-admit.ts` `writeMarkers()` applied to the disposition of the nearest earlier `next` record (by `seq`) for the same run and issue. 31 markers match. The sidecar lists the other 21 by correlation id and `seq`, each with a class:
  - `orphan` (5): no base record with that correlation id — FAFF-1016 in `…031227-fly-l3`; FAFF-1306 `next` and `eligible` in `…025421-…1f19c0` and in `…032405-…88c035`.
  - `no-next-record` (2): FAFF-1351 in `…165441-…c8818e`; FAFF-1306 `eligible/2` in `…030828-…9fd3e4`.
  - `mis-joined` (8): the correlation id names a different kernel or issue — FAFF-1199 `next/1` in `…065425-…d4c19d` and FAFF-1249 `next/3` in `…162841-…36511a` (both `eligible` markers); FAFF-1318 seq 8 in `…191213-…fe15ad`; and five markers in `…191711-…7a746f` carrying `FAFF-1205/eligible/1` (FAFF-1318 seqs 13 and 14, FAFF-1292 seq 15, FAFF-1207 seq 16, FAFF-1205 seq 17).
  - `capture-join` (2): FAFF-1293 and FAFF-1249 `next/1` in `…162841-…36511a`, recorded `prep`, marked `graft` after narrow prep.
  - `intended-divergence` (4): the FAFF-1318 `next` markers in `…162841-…36511a`, `…185215-…1456d4`, `…190707-…906233` and `…192721-…c7df54`.
- The test fails if any marker is unclassified, if a listed exception actually matches, or if any listed correlation id is absent from the corpus. It is an ordinary `node --test` case and gates nothing beyond the test run.

### 4.4 Rule inventory

Rows keep FAFF-1414's numbers; rows 39 onward are new. "Agent" means the rule stays in the shortened prose.

| # | Prose rule (beep-boop source) | Behaviour after | Covering test | Disposition |
|---|---|---|---|---|
| 7 | `next` routing per token (step 4 "Gate eligibility") | section 3 table; `next`'s `blocked`/`done`/`none` arrive as `excluded` | disposition replay | changed: `excluded` names next's `blocked`, avoiding the intake token clash |
| 8 | `--blocked` carries external blockers only (step 4) | `externally_blocked` fact | — | kept (agent) |
| 11 | Labels and status come from a read taken at assembly (step 4, step 8.4) | facts from the one live read | — | kept (agent) |
| 17 | Base records captured in-kernel via the `decide` driver (step 4 capture) | the command captures in-process | marker replay | changed: no driver |
| 18 | `next` marker is the action actually taken (step 4 capture) | marker table | marker replay | kept |
| 19 | `eligible` marker only on admit or eligibility refusal (step 4 capture) | marker table; a `proceed` the verdict later routes out keeps `eligible` | marker replay | changed: section 6 |
| 26 | No per-candidate mode signal (admissibility filter) | always `--mode autonomous` | prose test | kept |
| 27 | Inadmissible → routed out, never parked, not admitted (admissibility filter) | `inadmissible` row | disposition replay | kept |
| 28 | Admissibility warnings surface, never gate (admissibility filter) | `warnings[]` logged | — | kept (agent) |
| 29 | Claim-before-admit: peer `In Progress`/`In Review`/`Done` → `claimed-by-peer`, not admitted, not parked (step 4) | command's claim check, on both calls, the final one immediately before the append; `Done` via `excluded` | disposition replay (14 records) | changed: own build-claim ref proceeds; stale ref proceeds for `in-progress` |
| 30 | The claim re-read also refreshes the eligibility label (step 4) | one facts object | — | kept (agent) |
| 31 | Graft's Step 5 claim stays the backstop (step 4) | unchanged | — | kept |
| 32 | Declined candidates get `record-declined`, never `admitted` (step 4 ledger) | unchanged | — | kept (agent) |
| 34 | Beep-boop admission runs no intake guard | the command runs it after eligibility; an eligible candidate carries `faff-automate`, which `intakeVerdict` accepts as the `eligibility-gesture` basis under every gate mode | `test/graft-admit.test.mjs` (eligible under `intake_gate: block` is never `blocked`) | changed: warnings only, no outcome changes; the `blocked` row is defensive |
| 37 | Order: `next`, re-scan and verdict, claim, admissibility (step 4) | admit first; re-scan and verdict on `proceed` | prose test | changed: buckets differ only for candidates failing several gates |
| 39 | Eligibility reads `faff-automate` only (step 4) | the command's eligibility kernel | kernel replay | kept |
| 40 | Re-scan runs on the `graft`-eligible set (step 4) | re-scan runs on the `proceed` set | — | changed: candidates failing claim or admissibility skip the re-scan |
| 41 | The same re-read runs at wave re-entry (step 4, step 8.4) | 8.4 re-runs 4.1 | — | kept (agent) |
| 42 | Endgame check runs before defaulting In Review to `claimed-by-peer` (step 4) | runs from `claimed-by-peer` or `proceed` with status `in-review` | prose test | changed: a stale In Review claim resumes landing, never rebuilds |
| 43 | Admissibility binary or shell failure → fail-safe routed out (admissibility filter) | any non-zero exit → `admit-errored:<reason>` | prose test | changed: one token for every exit-2 cause |
| 44 | This is the primary call-site; graft's Step 2 is the backstop (admissibility filter) | unchanged | — | kept (agent) |
| 45 | — (new) | a final admission call immediately before the append | prose test | new |
| 46 | `observed_at` captured immediately before the at-assembly read (step 4 ledger) | captured before each call's facts read | — | kept (agent) |
| 47 | Explicit list re-scans before queueing (explicit-list mode) | admission first, re-scan on `proceed` | prose test | changed: same as 37 |
| 48 | Not automation-eligible is excluded, as defence in depth (step 4 last paragraph) | `ineligible` | disposition replay | kept |
| 49 | Explicit list queues every issue with a present spec for build (explicit-list mode) | `needs-prep` for a `faff-awaiting-spec-review` hold goes to prep; `needs-human` for a `low`/`medium` spec routes out | prose test | changed: a held review resumes through prep instead of being routed out |

### 4.5 Edge cases

- **Explicit list naming an In Review issue.** `claimed-by-peer` (no ref) or `proceed` (stale ref) → the endgame check, which is today's path for the 14 In Review records.
- **Stale `In Progress` claim.** `proceed`, re-scan, verdict, admit; graft Step 5's `acquire` reclaims it. This is FAFF-1414's ratified behaviour, newly reached from beep-boop.
- **Claim store unreachable, tracker unreachable, malformed facts, unreadable spec file.** Exit 2 → `admit-errored:<reason>`.
- **`$FAFF_SESSION_ID` unset.** The command treats no claim as the caller's own, so a held live ref gives `claimed-by-peer`. That is the safe direction.
- **Capture off or no run dir.** The command writes no capture; admission is unchanged.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the decision corpus record run-20261026-213652-beepboop-list-31f750/FAFF-1403/next/1 (status in-review, spec high, eligible) as a facts object with no build-claim ref
When faff graft admit --mode autonomous --facts - --json runs with an admissible spec file
Then it exits 0, disposition is "claimed-by-peer", and kernels.next.step is "graft"
```

```
Given the facts of corpus record run-20261026-031227-fly-l3/FAFF-1385/next/1 (status backlog, spec high, eligible) and an admissible spec file
When faff graft admit --mode autonomous --facts - --json runs
Then it exits 0 and disposition is "proceed"
```

```
Given the facts of corpus record run-20261027-191711-beepboop-list-7a746f/FAFF-1205/next/1 (status in-review, spec none, eligible)
When faff graft admit --mode autonomous --facts - --json runs
Then disposition is "claimed-by-peer" and kernels.next.step is "prep"
```

```
Given the tree on this branch
When faff validate-adapters runs
Then it exits 0 with no RATCHET finding for faff-beep-boop
```

## 5. DESIGN DECISION RATIONALE

- **Admit first, judge second.** The command is a cheap pure read; the re-scan fetches comments per candidate. Running the command first skips the re-scan for every candidate a gate refuses anyway.
- **A final call instead of moving the command last.** Today the claim re-read and admissibility run after the verdict, so they see the latest claim and the refreshed spec. Calling the command again, unconditionally, just before the append keeps both guarantees without splitting the command, and the first call still spares the re-scan for candidates a gate refuses.
- **Buckets in prose.** The disposition-to-bucket mapping is beep-boop's vocabulary; putting it in `faff graft admit` would give the command a caller-specific surface.
- **What the scenarios pin.** The four `faff graft admit` scenarios already hold on `main`: they pin the command behaviour this wiring relies on, so a later change to the command cannot silently re-route beep-boop. The SKILL.md scenario is the one that fails before this change and passes after it.
- **`admit-errored` instead of `inadmissible` for exit 2.** Exit 2 covers an unreachable tracker or claim store and malformed facts, not only an admissibility failure. One honest token keeps the morning brief from blaming the spec. Neither is ever admitted.

## 6. DECISIONS AND ASSUMPTIONS

- **Chosen:** a `proceed` whose facts say `in-review` goes to the endgame landing check, never to a build; if the check does not resume, the candidate is `claimed-by-peer`. A stale `in-progress` claim still proceeds to a build (FAFF-1414's ratified decision). This narrows FAFF-1414's stale-ref decision for one status, in the conservative direction: an open PR is resumed or left, never rebuilt beside.
- **Chosen:** a final `faff graft admit` call always runs immediately before the append, and only its `proceed` admits.
- **Chosen:** decision-capture markers follow the command's table. A `proceed` the routing verdict later routes out keeps its `next: graft` and `eligible: eligible` markers: those record the action the `next` and eligibility gates took, and the routing verdict is a different decision the corpus does not capture. Today's rule wrote no `eligible` marker in that case; row 19 records the change. The same holds for a `proceed` with status `in-review` that beep-boop sends to the endgame check: its `next: graft` marker records the gate's pass, and a later corpus replay classifies it as an `endgame-from-proceed` class, not a mismatch.
- **Chosen:** prep-routing consults (step 2, step 8's newly unblocked items) keep `faff next` (section 2).
- **Chosen:** any non-zero exit routes out as `admit-errored:<reason>` (section 5).
- **Chosen (operator, 2026-11-01):** removing step 4's drivers leaves `next` and `eligible` with no `decide --export` driver in any skill, which validate-adapters' capture-wiring (FAFF-1009) and capture-same-command (FAFF-1394) lints refuse. Both lints count a real `faff graft admit` invocation that passes `--mode`, `--facts` and `--run-dir <dir>` in one command, in a fenced block or a code span, as wiring `next` and `eligible`, because the command captures them in-process under consult ids it mints itself. The route covers those two kernels only, never `claim-verdict` (faff-tidy drives it itself), and only while the command's non-comment code calls `mintConsultCorrelationId` and captures them. A covered kernel that some skill also drives with its own `decide --export` fails the lint, so the route never hides a driver.
- **Assumes:** step 4's query stays constrained to Todo, so a non-Todo status reaches 4.1 only through the live re-read (a status moved since the query) or explicit-list mode.

## 7. DONE

### From WHY
- [ ] Beep-boop step 4, explicit-list mode and wave re-entry run admission through `faff graft admit --mode autonomous`, and none of them shells `faff next`, `faff eligible` or `faff admissible` for admission.
- [ ] `faff graft admit` (`graft-admit.ts` and its emit) is unchanged by this PR.
- [ ] `faff commissaire` and every `commissaire*` module are unchanged by this PR.

### From WHAT and HOW
- [ ] Step 4 maps every disposition and a non-zero exit to the bucket in section 3's table.
- [ ] A `proceed` with status `in-review` enters the endgame landing check and is never dispatched to a build.
- [ ] Step 4 runs a final `faff graft admit` call on a fresh live read and the current spec immediately before every append to `admitted`, and appends only on its `proceed`.
- [ ] Step 4 deletes the previous `admit-spec.md` before writing the next one, so a failed write routes the candidate out as `admit-errored`.
- [ ] An issue key that fails `^[A-Za-z][A-Za-z0-9]*-[0-9]+$` routes out as `admit-errored:issue-key` before any filesystem write or call.
- [ ] Step 4 runs no `decision-capture decide` driver and no `next`/`eligible` `action` call; the run-level kernel capture notes elsewhere in the skill are unchanged.
- [ ] Routed-out and claimed-by-peer candidates still get `faff run-ledger record-declined` with a per-candidate `observed_at`.

### Rule inventory
- [ ] Every line the PR deletes from `faff-beep-boop/SKILL.md` maps to a row in section 4.4; the PR description lists the mapping by row number.
- [ ] `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered to the count measured after the branch is rebased on `main`, so a sibling that changed it first (FAFF-1436) is absorbed, not overwritten.
- [ ] `ANCHOR_PHRASES["faff-beep-boop"]` is unchanged and `faff validate-adapters` reports no RATCHET.

### Corpus replay
- [ ] `test/graft-admit-replay.test.mjs` reproduces all 40 `next` and 23 `eligible` base verdicts through the kernels.
- [ ] The disposition replay gives the mapped verdict for 19 `next` records, `claimed-by-peer` for the 14 In Review records and `inadmissible` for the 7 FAFF-1318 records, each listed by correlation id in `test/fixtures/graft-admit/corpus-facts.json`.
- [ ] The action-marker replay matches 31 markers and classifies the other 21 exactly as section 4.3 lists, failing on an unclassified marker, a listed exception that matches, or a missing correlation id.
- [ ] `TEST_FILE_COVERAGE["graft"]` in `lint-cli-coverage.js` also names `test/graft-admit-replay.test.mjs`, and `lint-cli-coverage` passes.

### Tests
- [ ] `test/beep-boop-admission-prose.test.mjs` asserts that step 4 and explicit-list mode call `faff graft admit --mode autonomous`, contain no `faff next`, `faff eligible` or `faff admissible` invocation and no `--kernel next`/`--kernel eligible` driver, name all eight dispositions and the non-zero exit, route `proceed` with `in-review` to the endgame check, and carry the final-call rule.
- [ ] The capture lints exempt `next` and `eligible` through the in-process route only for a real invocation with `--run-dir`, read from non-comment code, never `claim-verdict`, and fail when a covered kernel has its own driver; a test covers each bypass.
- [ ] Repeated `faff graft admit --run-dir` calls for one issue, with capture on and alongside a counter-based consult, mint distinct consult correlation ids, and every decision grades.
- [ ] No `--selftest` case is added in any module.
- [ ] `faff gates run` passes.

## Methodology critique

_Agile-delivery lens (faffter-dark-methodology-agile-delivery)._

- **Right-sized?** Yes. One caller rewired to an existing command, one replay test with a sidecar, one prose test, no new module. The split from FAFF-1414 kept the command and its first caller apart; this is the second caller.
- **Workstream fit?** The prose-to-code extraction lane (FAFF-1396, FAFF-1414, FAFF-1435, FAFF-1436), and the 2026-10-22 review's goal of one home per decision.
- **Deps surfaced?** Blocked by FAFF-1414 (Done). PR #1169 (FAFF-1436, unmerged) edits `faff-beep-boop/SKILL.md` step 8.1 (line 267) next to step 8.4 and changes the same `SKILL_LINE_BASELINE` line. That is a textual overlap, not an ordering constraint: either ticket can land first, and the second rebases and re-measures its baseline (the DONE item says so), so no `blocks` edge is drawn. FAFF-1437 (unprepped) will edit the run-ledger and run-close prose and the same baseline line, not step 4.
- **Risk profile?** Moderate. Admission is a gate; the behaviour changes are named in rows 19, 29, 34, 37, 40, 42, 43 and 49, and none admits a candidate today's prose refuses except a stale `In Progress` claim, which FAFF-1414 ratified.

confidence: high
spec-review: accept (human)
build-tier: complex