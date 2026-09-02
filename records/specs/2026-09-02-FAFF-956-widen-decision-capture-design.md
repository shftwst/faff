# Spec: FAFF-956: widen decision-capture to deterministic in-kernel capture across nine kernels

> Spec: faffter-dark-nlspec · 2026-09-02 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-956.

This spec is the buildable design for FAFF-956, which widens the live decision-capture instrumentation past the FAFF-954 core-loop pilot so the FAFF-826 coordination-fidelity study can measure the orchestrator's full decision surface. Audience: the build agent that implements it, and the human reviewers who gate it.

## 1. WHY: problem and principles

**The mechanism this turns on:** capture each decision's normalised inputs and the kernel's verdict *deterministically, inside the kernel CLI itself*, sourced from the kernel's own input object, and capture the orchestrator's actual downstream action *separately*, joined back by a correlation id. The kernel command already holds its parsed inputs and its computed verdict in one place; recording them there makes alias drift impossible by construction, and the CLI never pretends to know what the orchestrator did next.

**Problem.** FAFF-954 wired the two core-loop kernels (`next`, `eligible`) by having skill prose hand-reconstruct `normalised_inputs` before calling `faff decision-capture record`. A recent beep-boop run captured 11 records; 5 fell to `missing-input` because the prose used non-canonical aliases (`hasSpec`/`specPresent` for `spec`, `notEligible`/`eligibility` for `eligible`, `isBlocked` for `blocked`, `issueStatus` for `status`). The replay protocol deliberately does not guess key transformations, so all five dropped to zero denominator, zero agreements, zero divergences. This is capture drift, not decision drift: the shadow could not even compute what the kernel prescribed. Evidence: `.faff/phase1-evidence/20260901T180627Z/export/decision-corpus.jsonl` and `.../analysis/result.json` (the `missing_input_records` array holds the five).

**What this change does.** Move capture of `{normalised_inputs, verdict}` into each kernel's `cmd<Kernel>` choke point, sourced from the kernel's own parsed input object; shrink the prose sites to emitting only the actual action plus a correlation id; and widen from two kernels to nine. Re-collect denominators from a fresh flagged run rather than repairing the old records.

### Design principles

**Forward-correct at source, never post-hoc alias repair.** Recovering the existing lossy records by guessing key transformations is a non-goal (see Out of scope). Retrofitting an alias map after the actions are visible risks outcome-aware normalisation, which is a measurement bias the study cannot tolerate. Fix capture where the inputs are canonical, then re-collect.

**Capture is authority-inert and best-effort.** A kernel command (`faff next`, `faff eligible`, and the rest) is authoritative: its stdout verdict drives real routing. Capture is a side effect that runs after the verdict is computed. It must never change the verdict, the stdout bytes, or the exit code, and must never throw. This is the existing BEST-EFFORT-FAIL discipline in `decision-capture.js`, now invoked from inside the kernels.

**Safe direction only.** An `{inputs, verdict}` record whose action was never captured is honestly "action-uncaptured" and is never counted as agreement. The study must never see manufactured agreement, so an absent or unjoinable action is its own stratum, not a default match.

**One contract source.** The captured `normalised_inputs` key-set is the kernel's own signature, and `KERNEL_REGISTRY.required_inputs` is reconciled to equal that signature. The prose-versus-registry ambiguity (the `next@1` case below) ends.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/decision-capture.js` | JavaScript | `KERNEL_REGISTRY`, `classifyCoverage`, `buildRecord`, best-effort `record` path. Host of the new capture helper and the action-marker verb. |
| `plugin/skills/faff/bin/lib/next.js` … `run-start.js` (nine files) | JavaScript | Each kernel's `cmd<Kernel>` is the capture hook: parsed inputs and computed verdict are both in hand at one line before the final print. |
| `plugin/skills/faff/bin/lib/shadow-fidelity.js` | JavaScript | The consumer. `analyzeCorpus` replays inputs, projects `selected_action`, grades divergence. Must learn the join and the action-uncaptured stratum. |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `appendEventRecord` mints the `{run_id, seq}` envelope and the hash chain both record types append to. Holds a hand-mirrored copy of the decision-capture shape validator (`eventViolations`). |
| `plugin/skills/faff/bin/lib/governance-profile.js` | JavaScript | The delivery profile's `event_types` / `issue_scoped_types` vocabulary. `decision-capture` is registered and issue-scoped; a new action-marker type is registered here. |
| `plugin/skills/faff-graft/SKILL.md` (lines 103-105), `plugin/skills/faff-beep-boop/SKILL.md` (lines 210-212) | Markdown | The FAFF-954 prose sites that hand-reconstruct inputs. These shrink to action-marker emission only. |

**Scope.** One instrumentation mechanism, applied uniformly to nine kernels, feeding the FAFF-826 study. It changes how decisions are captured and consumed, not any authoritative decision itself.

## 2. OUT OF SCOPE

- **Post-hoc repair of the five lossy pilot records**: not recovered, not deleted, not rewritten. They stay in `.faff/phase1-evidence/` as pilot evidence of capture drift and continue to classify `missing-input`. Extension point: none by design; re-collection under the flag replaces them as the live denominator.
- **The two set-aside instrumented non-kernels (`tier`, `regions`) and the three decision-kernels the map excludes (`state`, `run-ledger`, `decision-capture`)**: unchanged. Extension point: `KERNEL_REGISTRY` plus `REPLAY_ADAPTERS` if a later protocol version widens the replay set.
- **Changing any kernel's verdict logic, thresholds, or output schema**: capture reads the verdict, never steers it. Extension point: the individual kernel libs.
- **The FAFF-826 study's grading rules** (`CONSEQUENCE_RULES`), the harmless/wasteful/wrong ladder is ratified separately. Extension point: `shadow-fidelity.js`.
- **A tracker or network round-trip inside capture**: capture reads only the kernel's in-memory inputs and the local run dir.

## 3. WHAT: vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Base record | The deterministic `{normalised_inputs, verdict}` record minted inside the kernel CLI. Carries no action. |
| Action marker | The separate record carrying the orchestrator's actual `selected_action` plus the correlation id. |
| Correlation id | A caller-minted string that ties one action marker to one base record. |
| Action-uncaptured | A base record with no joinable action marker at analysis time. Never counted as agreement. |
| Run-level kernel | A kernel whose decision is per-run, not per-issue (`queue-state`, `run-done`, `run-start`, `run-outward`). |
| Run sentinel | The reserved `issue` value `__run__` stamped on a run-level record's envelope. |

### The nine kernels and their capture identity

| Kernel | Choke point | Verdict source | Envelope `issue` | Action observable at |
|---|---|---|---|---|
| `next` | `cmdNext` `state` object | `nextStep(state)` tuple `[verdict, reason]` | real issue id | beep-boop routing / graft Step 2 |
| `eligible` | `cmdEligible` `{labels, def, trackerPresent}` | `automationEligible(...)` boolean | real issue id | graft eligibility gate |
| `claim-verdict` | `cmdClaimVerdict` positional args | `claimVerdict(...)` | real issue id | claim-before-admit step |
| `park-verdict` | `cmdParkVerdict` positional args | `parkVerdict(...)` | real issue id | park protocol |
| `project-next` | `cmdProjectNext` `state` object | `projectNext(state)` | container id (project/initiative) | container rollup, action-uncaptured by design |
| `queue-state` | `cmdDerive` `{itemKeys, outcomes, terminalStates}` | `deriveQueueState(...)` | `__run__` | read-model, action-uncaptured by design |
| `run-done` | `cmdRunDone` `signals` object | `computeRunDoneVerdict(signals)` | `__run__` | run loop continue/stop |
| `run-outward` | `cmdRunOutward` `(target, self)` | `decideOutward(...)` | `__run__` | run assembly outward adoption |
| `run-start` | `cmdRunStart` normalised `signals` | `deriveRunTrigger(...)` | `__run__` | run-start gate |

`project-next`'s `issue` field carries the real container id (a project or initiative), which is a genuine tracker id, not a sentinel. Only the four run-level kernels use `__run__`.

### Type definitions

```
RECORD DecisionCaptureBase:        # type: "decision-capture" (subtype base)
  kernel: String                    # registry name
  kernel_version: String            # e.g. "next@1"
  normalised_inputs: Object         # the kernel's OWN input object, canonical keys by construction
  verdict: String | Object          # the kernel's computed prescription (NOT the actual action)
  coverage: "replayable" | "non-replayable" | "uncovered"
  missing_inputs: [String]          # non-empty iff non-replayable
  correlation_id: String            # caller-minted; the join key an action marker references
  causation: { seq: Int, sha256: Hex64 }

RECORD DecisionCaptureAction:      # type: "decision-capture-action"
  kernel: String                    # the base record's kernel, for a cheap same-kernel join assertion
  correlation_id: String            # references exactly one base record
  selected_action: String | Object  # the actual downstream action the orchestrator took
  causation: { seq: Int, sha256: Hex64 }

  CONSTRAINT base and marker share correlation_id AND kernel
  CONSTRAINT a base record with coverage != "uncovered" replays; an unjoined base is action-uncaptured
```

The base record replaces the FAFF-954 combined record's `selected_action` field with `verdict` plus `correlation_id`. Storing `verdict` is belt-and-braces: analysis re-derives the prescription by replay and cross-checks it against the stored value to catch version skew or replay drift concretely.

### CLI surfaces

- **In-kernel capture**: no new user-facing flag on any kernel. Each `cmd<Kernel>` calls a shared helper `captureDecision({ kernel, normalised_inputs, verdict, issue })` after computing the verdict and before/after the print. The helper resolves the run from `$FAFF_RUN_DIR`, reads the correlation id from `$FAFF_DECISION_CORRELATION_ID`, gates on `capture.decision_kernel == "on"`, and appends a base record best-effort. Absent env, absent run dir, or disabled flag: silent no-op, exit unchanged.
- **Action marker verb**: `faff decision-capture action --run ID --issue ID|__run__ --kernel NAME --correlates <id> --action <token>`. Appends one `decision-capture-action` record. Same best-effort discipline as `record`.
- **`faff decision-capture record`**: retained for backward compatibility and for any residual manual capture; unchanged shape validation for the legacy combined record so the five pilot records still validate and export.

### Validation and vocabulary surface

The new shapes touch three closed-vocabulary points that must all move together, or a base record fails shape validation and is silently swallowed by best-effort (empty denominators, not a loud error):

- **`governance-profile.js`**: register `decision-capture-action` in the delivery profile's `event_types`, and in `issue_scoped_types` (its `issue` is required; a run-level marker supplies `__run__`).
- **`decisionCaptureViolations` in `decision-capture.js`**: relax the `decision-capture` shape check to accept either the legacy combined shape (`selected_action` present) or the new base shape (`verdict` present, `correlation_id` a non-empty string, `selected_action` absent). Add a validator for the `decision-capture-action` shape.
- **The mirrored copy in `events.js` `eventViolations`**: the same two rules, kept in sync by hand (the module cannot require `decision-capture.js` back; factory-to-governance is the only legal edge, ADR-0042). The existing mirror comment already documents this discipline.

**Contract single-sourcing decision.** **Chosen:** register the new type and update both mirrored validators in the same ticket. Leaving either validator on the old "`selected_action` required" rule silently drops every base record via BEST-EFFORT-FAIL, so the study never sees the widened denominators. A `--selftest` asserts a base record and an action marker both validate under both copies.

**Design decisions.**

- **Where inputs come from.** **Chosen:** the kernel's own parsed input object (`state` / `signals` / the positional bundle), not a prose reconstruction. Canonical keys hold by construction, so `missing-input` from aliasing is impossible for the inputs the CLI controls.
- **Split versus combined record.** **Chosen:** split: a base `{inputs, verdict}` record plus a separate action marker, joined by correlation id. The kernel cannot see downstream, so the action is captured where it is observable and joined later. A combined record forces the CLI to invent an action it cannot know, which is exactly the FAFF-954 coupling that pushed the action into fragile prose.
- **Correlation-id mechanism.** **Chosen:** a caller-minted id passed to the kernel via the environment variable `FAFF_DECISION_CORRELATION_ID`, and quoted back by the action marker's `--correlates`. The caller (orchestrator prose) already knows the issue, kernel, and wave, so it mints a collision-free id such as `<run_id>/<issue>/<kernel>/<wave>` and needs no read-back from the kernel's stdout. An env var, not a per-kernel flag, keeps every kernel's argv and stdout byte-identical (no new flag threaded through nine parsers). The `{run_id, seq}` envelope identity the append already mints is the analyzer's ultimate dedup/order key; the correlation id is the base-to-marker join key layered on top. Rejected: reading the seq back off stderr (reintroduces stdout/stderr coupling to an authoritative command); a purely structural `{run_id, issue, kernel}` join (ambiguous when a kernel fires twice for one issue in a run).
- **Run-level identity.** **Chosen:** the reserved envelope `issue` value `__run__` for the four run-level kernels. It keeps the envelope uniform (the `issue` field stays present) and cannot collide with a tracker id (`FAFF-\d+`, `#\d+`). Rejected: a `--scope run` mode or a new `scope` field (both need the envelope to tolerate a missing issue and the analyzer to special-case it, a larger change for no gain, since the join is by correlation id regardless).
- **`next@1` contract reconciliation.** **Chosen:** make the kernel's declared signature the single source and reconcile `required_inputs` to it. `nextStep`'s `state` object carries seven keys (`status, spec, eligible, parked, blocked, ifEligible, awaitingSpecReview`) but `KERNEL_REGISTRY.next.required_inputs` lists six. Because capture now sources every key from the `state` object, all seven are always present, so a captured `next` record is replayable and input-complete. Reconcile `required_inputs` to include `awaitingSpecReview`, and assert equality against the declared signature in `--selftest` so the two can never drift again.
  - **Consequence on the coverage stratum (must be handled in the same ticket).** `shadow-fidelity.js` derives `optionalInputs("next")` as `declared_signature − required_inputs`; today that yields `["awaitingSpecReview"]`, and its selftest (`shadow-fidelity.js:698`) asserts exactly that. Reconciling `required_inputs` to the full seven makes `optionalInputs("next")` become `[]`. Two follow-ons: (a) **update that selftest** to expect `[]` (a required DoD item below) — leaving it asserts the old value and fails; (b) a legacy `next` record that omitted `awaitingSpecReview` reclassifies from *input-uncaptured/excluded* to *missing-input*. This is **immaterial for the five pilot records** — they are already `missing-input` via key-aliasing, never input-uncaptured — and is *correct* for the new regime, where every `next` base record always carries all seven keys. Scope the backward-compat claim below accordingly: legacy combined records still **read**, and their classification is unchanged *except* a `next` record missing only `awaitingSpecReview`, which now reads `missing-input` rather than input-uncaptured (a stricter, honest stratum, not a regression).
- **Eligibility honesty.** **Chosen:** the `eligible` action marker records `ineligible` only when the candidate was excluded for an eligibility reason (the skip-ineligible routing). A candidate skipped for `claimed-by-peer`, a stale spec, or a resolve-park is not an eligibility exclusion; recording it `ineligible` manufactures a false agreement on the `eligible` kernel. The action marker maps the real disposition: eligible-and-proceeded, or the eligibility skip. Any non-eligibility skip leaves the base record action-uncaptured for the `eligible` kernel.

## 4. HOW: behaviour

### Capture hook inside a kernel

Each `cmd<Kernel>` gains three lines after it has both the input object and the verdict, before returning:

```
PROCEDURE cmdKernel(args):
  ... parse args into `inputs` (the kernel's own object) ...
  verdict = pureKernel(inputs)          # unchanged authoritative computation
  print(verdict)                        # unchanged authoritative stdout
  captureDecision({                     # NEW: side effect only, best-effort
    kernel: "<name>",
    normalised_inputs: inputs,          # canonical keys by construction
    verdict,
    issue: <real id | container id | "__run__">,
  })
  return 0                              # exit code unchanged
```

`captureDecision` is the existing `cmdRecordVerb` best-effort core, refactored to accept an already-built inputs object rather than parsing stdin:

```
PROCEDURE captureDecision({kernel, normalised_inputs, verdict, issue}):
  1. root = findRoot(); IF captureEnabled(root) is false: RETURN            # flag off => no-op
  2. run = basename($FAFF_RUN_DIR); IF unset: bestEffortFail; RETURN        # standalone => no substrate
  3. correlation_id = $FAFF_DECISION_CORRELATION_ID or ""                    # empty => hard-to-join, safe
  4. dir = resolveRunDir(root, run); IF missing: bestEffortFail; RETURN
  5. { coverage, kernel_version, missing_inputs } = classifyCoverage(kernel, normalised_inputs)
  6. causation = chain head of dir/events.jsonl (existing tailReadState); IF none: bestEffortFail; RETURN
  7. data = buildBaseRecord(kernel, kernel_version, normalised_inputs, verdict,
                            coverage, missing_inputs, correlation_id, causation)
  8. IF baseViolations(data): bestEffortFail; RETURN
  9. appendEventRecord(dir, run, { phase: "run", type: "decision-capture", issue, data })
  # every failure path writes a degraded note and returns; NEVER throws, NEVER non-zero
```

**Behaviour summary.** The kernel computes and prints its verdict exactly as today, then records the inputs and verdict as a side effect that cannot fail the command. When the flag is off the helper returns at step 1 before any run-dir or chain I/O.

### Action marker and the join

The orchestrator, once the downstream action is known, emits one marker referencing the same id:

```
FAFF_DECISION_CORRELATION_ID="$run/$issue/next/$wave" faff next --status ...   # base captured here
# ... orchestrator decides and acts ...
faff decision-capture action --run "$run" --issue "$issue" --kernel next \
  --correlates "$run/$issue/next/$wave" --action graft                          # marker here
```

At export both record types stream out of the run's `events.jsonl`. `analyzeCorpus` joins them:

```
PROCEDURE analyze(records):
  bases   = records where type == "decision-capture"
  markers = index of records where type == "decision-capture-action", keyed by correlation_id
  consumed = {}                                            # correlation_ids already joined to a base
  FOR each base with coverage == "replayable" AND kernel in REPLAY_ADAPTERS:
    prescribed = replay(base.normalised_inputs)            # via the versioned kernel
    IF base.verdict present AND project(base.verdict) != project(prescribed): # stored-verdict cross-check, like-for-like
      flag base "verdict-skew" (kernel_version drift or replay drift); count separately, NOT an agreement
      # compare both sides in the SAME projected form; a raw-vs-projected compare would false-flag every record
    marker = markers[base.correlation_id]
    IF marker absent OR marker.kernel != base.kernel OR base.correlation_id in consumed:
      classify base as "action-uncaptured"                 # absent / mismatched / duplicate-id => NOT agreement, NOT divergence
      CONTINUE
    consumed.add(base.correlation_id)                       # first base wins the id; later bases fall to action-uncaptured above
    actual = project(marker.selected_action)
    IF prescribed == actual: agreement++
    ELSE: divergence with gradeConsequence(kernel, prescribed, actual)
  # non-replayable => missing-input (unchanged); uncovered => uncovered (unchanged)
  # legacy combined records (selected_action present, no correlation_id) read as today
```

**Backward compatibility.** A FAFF-954 combined record (has `selected_action`, no `correlation_id`) is still readable: the analyzer treats its `selected_action` as the actual action inline, so the five pilot records keep classifying `missing-input` exactly as they do now. New base records take the join path.

### Edge cases and error handling

- **Flag off**: `captureEnabled` returns false at step 1; no run-dir resolution, no records, kernel output byte-identical to today.
- **Standalone kernel call (no `$FAFF_RUN_DIR`)**: best-effort no-op with a degraded note, exit unchanged. Matches today's "standalone-interactive graft captures nothing" behaviour.
- **Missing correlation id**: base record still minted with `correlation_id == ""`; no marker can join it, so it lands action-uncaptured (safe direction), not a crash.
- **Duplicate correlation id within a run**: two bases share one id: the analyzer joins the marker to the first and flags the collision as action-uncaptured for the rest rather than double-counting. The caller contract is one fresh id per decision.
- **Marker kernel mismatch**: a marker whose `kernel` differs from the base's is not joined (guards a mis-wired prose site).
- **Run-level double capture**: a run-level kernel fired once per wave yields exactly one base record; if prose mistakenly loops it per candidate, the surplus records are visible as inflated run-level counts (see failure modes).

### Failure modes

- **The failure:** in-kernel capture perturbs an authoritative command's stdout or exit code, corrupting real routing. **How you'd know:** a golden byte-comparison of each kernel's stdout and exit for flag-on versus flag-off over the selftest input grid diverges. **What it means:** abandon the in-line hook placement until the side effect is provably inert.
- **The failure:** outcome-aware normalisation creeps in (someone maps old aliases after seeing the actions). **How you'd know:** an alias translation table appears anywhere in the capture path; `normalised_inputs` keys stop matching the kernel's signature. **What it means:** reject the change; capture must read the kernel's own object only.
- **The failure:** correlation ids are not unique per decision, so markers join the wrong base. **How you'd know:** the analysis reports action-uncaptured counts or collision counts above zero on a clean run. **What it means:** narrow the id convention in the prose sites before trusting the denominators.
- **The failure:** a mirrored validator (or the event-type vocabulary) is left on the old rule, so every base record fails shape validation and is swallowed best-effort. **How you'd know:** a flagged run writes zero base records while `.faff/logs/decision-capture.jsonl` fills with "record failed shape validation" degraded notes. **What it means:** the vocabulary and both validators were not moved together; fix before trusting any denominator.
- **The failure:** the widened denominators still read low because actions for `queue-state`/`project-next` are genuinely hard to observe. **How you'd know:** those two kernels stay action-uncaptured while the other seven populate. **What it means:** a valid partial result; those two are input-fidelity-only by design, named as such, not hidden.

**Anti-pattern:** reconstructing `normalised_inputs` in prose before calling capture. Why: it is exactly the aliasing that produced the five missing-input records.

**Anti-pattern:** defaulting an unjoined base record to agreement. Why: it manufactures the agreement the study exists to measure honestly.

## 5. Scenarios: born-verifiable objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the flag capture.decision_kernel is "on" and $FAFF_RUN_DIR is set
When a run exercises all nine kernels through their CLIs
Then every base record for inputs the CLI controls is coverage "replayable"
  And the analysis reports zero missing-input records for those kernels
```

```
Given a base record whose inputs prescribe `graft`
When the joined action marker records `selected_action: prep`
Then the analysis records one divergence (prescribed graft, actual prep), graded per the next rule
  And never an agreement
```

```
Given a candidate skipped for claimed-by-peer (not an eligibility exclusion)
When the eligible action marker is emitted
Then it does not record `ineligible`
  And the eligible base record is action-uncaptured, not a false agreement
```

```
Given a base record minted with an empty correlation id
When the analysis runs with no matching action marker
Then the record classifies action-uncaptured
  And the run does not error
```

## 6. Design decision rationale

**Capture inputs in prose or in the kernel?** Options: keep the FAFF-954 prose reconstruction (aliasing risk, the five failures); move capture into the kernel CLI (canonical keys by construction). **Chosen:** in-kernel capture. It removes the only source of the missing-input failures for CLI-controlled inputs.

**One record or two?** Options: one combined `{inputs, action}` record (couples the action into the CLI, which cannot see it); a split base plus action marker joined by id. **Chosen:** split. The CLI records only what it can know deterministically; the action is captured where observable.

**How to join?** Options: env-var caller-minted id (no read-back, byte-identical stdout); stderr seq echo (couples an authoritative command's stderr); structural `{run_id, issue, kernel}` (ambiguous on repeat firing). **Chosen:** env-var caller-minted id, with the `{run_id, seq}` envelope identity as the analyzer's dedup key.

**Run-level identity?** Options: `__run__` sentinel issue (uniform envelope, no schema change); `--scope run` / new field (envelope and analyzer changes for no gain). **Chosen:** the `__run__` sentinel.

**Store the verdict in the base record?** Options: omit it (analysis re-derives by replay anyway); store it (cross-check against replay to surface version skew). **Chosen:** store it. Cheap belt-and-braces, and item 3 of the ticket names the base as "input+verdict".

At the time of writing, the shadow-fidelity analyzer reads `d.selected_action` directly; this ticket updates it to the join model and keeps the legacy combined-record read for the five pilot records.

## 7. Open questions and assumptions

**Open questions.** None blocking. Every architecture choice above is settled by the operator's decision and the live evidence.

**Assumptions.**

- **Assumes:** shadow-fidelity.js is the sole consumer of the record shape and is updated within this ticket. Validate: grep for readers of `type === "decision-capture"` and `data.selected_action`; the only consumer is `shadow-fidelity.js` (plus `decision-capture.js`'s own list/export). If another consumer exists, extend it in the same ticket.
- **Assumes:** the four run-level kernels are invoked by orchestrator prose that can set an env var and later emit a marker. Validate: confirm `run-done`, `queue-state`, `run-start`, `run-outward` are called from skill prose (beep-boop / graft / run loop), not only from inside another faff command where no prose can emit the marker. Where a run-level kernel is invoked internally with no prose surface, its base record is action-uncaptured by design (acceptable, named in the scope table).

## 8. DONE: definition of done

### From WHY
- [ ] A fresh run with `capture.decision_kernel: on` over the nine kernels produces zero `missing-input` records for inputs the CLI controls (the five-failure class is closed).
- [ ] The five FAFF-954 pilot records under `.faff/phase1-evidence/` are neither deleted nor rewritten and still classify `missing-input`.

### From WHAT (types and interfaces)
- [ ] Base record matches `DecisionCaptureBase` (has `verdict` and `correlation_id`, no `selected_action`).
- [ ] Action marker matches `DecisionCaptureAction` (`type: "decision-capture-action"`, has `correlation_id` and `selected_action`).
- [ ] `KERNEL_REGISTRY.next.required_inputs` includes `awaitingSpecReview`, and a `--selftest` asserts every registry entry's `required_inputs` equals its kernel's declared signature key-set.
- [ ] Envelope `issue` is `__run__` for `queue-state`, `run-done`, `run-start`, `run-outward`; a real container id for `project-next`; a real issue id for `next`, `eligible`, `claim-verdict`, `park-verdict`.
- [ ] `faff decision-capture action --run --issue --kernel --correlates --action` appends one marker, best-effort, exit 0 on every failure path.
- [ ] `decision-capture-action` is registered in the delivery profile's `event_types` and `issue_scoped_types`.
- [ ] Both mirrored validators (`decisionCaptureViolations` in `decision-capture.js` and the copy in `events.js` `eventViolations`) accept the base shape (`verdict` + `correlation_id`, no `selected_action`) and the legacy combined shape, and validate the action-marker shape; a `--selftest` asserts both records pass both copies.

### From HOW (behaviour)
- [ ] Each of the nine `cmd<Kernel>` calls `captureDecision` after computing its verdict, sourcing `normalised_inputs` from the kernel's own input object.
- [ ] With the flag off, each kernel's stdout bytes and exit code are byte-identical to the pre-change build and zero records are written.
- [ ] `captureDecision` never throws and never returns non-zero; every failure writes a `.faff/logs/decision-capture.jsonl` degraded note.
- [ ] `analyzeCorpus` joins base and marker by `correlation_id` (plus a same-kernel check), grades a joined divergence, and classifies an unjoined base as `action-uncaptured`.
- [ ] A joined divergence (inputs prescribe `graft`, marker records `prep`) is recorded as one divergence, never an agreement.
- [ ] The `eligible` action marker records `ineligible` only for the eligibility skip; a `claimed-by-peer` / stale-spec / resolve-park skip does not.

### From HOW (edge cases)
- [ ] A standalone kernel call with no `$FAFF_RUN_DIR` captures nothing and exits unchanged.
- [ ] A base record with an empty or duplicate correlation id classifies `action-uncaptured`, never a crash and never a double-count.
- [ ] Legacy combined records (no `correlation_id`) still read and classify as today.

### From WHAT (consumer)
- [ ] `shadow-fidelity.js` selftest covers the join, the action-uncaptured stratum, the legacy-record read, and a constructed divergence.
- [ ] The `shadow-fidelity.js:698` selftest expectation is updated: `optionalInputs("next")` now equals `[]` (the 6→7 reconciliation removed the sole optional key). No other kernel's `optionalInputs` changes.
- [ ] `analyzeCorpus` tracks consumed correlation ids so a duplicate id joins only the first base and later bases fall to `action-uncaptured` — never a double-count (matches the born-verifiable "never a double-count").
- [ ] `analyzeCorpus` cross-checks a base record's stored `verdict` against the replayed prescription and flags a mismatch as `verdict-skew` (counted separately, never an agreement); a selftest constructs one skew case.

**Integration smoke test.**

```
1. Set capture.decision_kernel: on; set $FAFF_RUN_DIR to a run dir with a genesis events.jsonl.
2. FAFF_DECISION_CORRELATION_ID="$run/FAFF-1/next/1" faff next --status todo --spec high ...
3. faff decision-capture action --run "$run" --issue FAFF-1 --kernel next --correlates "$run/FAFF-1/next/1" --action graft
4. faff decision-capture export --out /tmp/out ; faff shadow-fidelity run over /tmp/out
5. Assert: the next base record is replayable, the marker joins it, and the pair is agreement or a graded divergence.
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
