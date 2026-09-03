# Spec: FAFF-989 — decision-capture-action markers are never emitted, so the shadow-fidelity corpus is ungradeable

> Spec: faffter-dark-nlspec · 2026-09-03 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-989.

This is a build-ready specification for the FAFF-989 bug fix. Its audience is the build agent that will implement the change and the human reviewers who gate it. It describes what is broken, why the obvious reverts are wrong, which parts of the fix are settled, and which one architectural call must be escalated to a human before build. It does not prescribe the whole mechanism as closed, because one part of it is a genuine product judgement.

## 1. WHY — problem and principles

**The load-bearing model.** Shadow-fidelity grades a decision by joining two records written at different moments. A *base record* is minted inside the kernel CLI the instant a decision kernel (`next`, `eligible`, and their peers) computes its verdict; it carries the kernel's inputs, its verdict, and a `correlation_id` join key, but deliberately no chosen action, because the kernel cannot see what the orchestrator does next. An *action marker* (`decision-capture-action`) is written later by the orchestrator, once the downstream action is known, quoting the same `correlation_id`. The grader (`analyzeCorpus`) indexes markers by `correlation_id`, joins each base to its marker, replays the kernel over the captured inputs, and compares the replayed verdict against the actual action. No marker, or a base whose `correlation_id` is empty, means no join: the base falls into `action_uncaptured` and the matrix denominator for that kernel never increments. Everything below turns on that asymmetry between an always-fired base capture and a never-fired action marker.

**Problem statement.** Base records are being minted on every real kernel call (`.faffrc.yaml:135` sets `capture.decision_kernel: "on"`), but each one carries an empty `correlation_id` and no matching action marker is ever written, so shadow-fidelity places every capture in `action_uncaptured` and grades nothing. The sole runtime source of a non-empty `correlation_id` is the environment variable `FAFF_DECISION_CORRELATION_ID`, which no code anywhere sets, and the only thing that emits an action marker is the `faff decision-capture action` verb, which no code anywhere calls; both live only as prose instructions to the LLM orchestrator in two `SKILL.md` files. This change makes the base-to-marker join actually occur at runtime and proves it with end-to-end coverage, so the FAFF-826 coordination-fidelity study has a gradeable corpus.

### Design principles

**Preserve the base/marker split. Do not fold the action back into the base record.** FAFF-956 split the record precisely because a kernel cannot observe its own downstream action; the combined FAFF-954 shape forced the orchestrator to hand-build the entire record, which reintroduced key-aliasing and produced `missing-input` records that graded nothing. Any implementation that reunites inputs, verdict, and action into a single kernel-minted record reopens that defect and must be rejected at review.

**Capture stays authority-inert and best-effort.** The capture path performs no assignment, no protected effect, and no canonical decision; its only side effect is appending one event. It must never throw to a kernel, never write to a kernel's stdout, and never change a kernel's exit code. Every fix in this spec inherits that constraint. An implementation that makes a kernel's success depend on a capture-path outcome is wrong regardless of what it fixes.

**A base record that cannot be joined is noise, not signal.** The corpus's value is the gradeable subset. An orphaned base record (empty `correlation_id`, or a `correlation_id` no marker ever quotes) contributes nothing to any matrix denominator and dilutes the coverage strata. The fix is judged by whether real runs produce *joined* records, not by whether base records exist.

**A shape change touches two hand-mirrored validators in lockstep.** The `decision-capture` and `decision-capture-action` record shapes are validated by two independent copies kept in sync by hand: `decisionCaptureViolations` / `decisionCaptureActionViolations` in `decision-capture.js` (lines 226-295) and the mirrored `type === "decision-capture"` / `type === "decision-capture-action"` blocks in `events.js` `eventViolations` (lines 292, 340). The direction rule (factory must never require governance back, ADR-0042) forbids sharing one copy. Any change to either record shape updates both copies and the `--selftest` assertions that exercise them.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/decision-capture.js` | Node.js | Owns `captureDecisionCore` (the in-kernel base-capture hook, line 429), `cmdActionVerb` (the marker verb, line 479), `buildBaseRecord`, and both validators. The proximate defect and most of the fix live here. |
| `plugin/skills/faff/bin/lib/shadow-fidelity.js` | Node.js | `analyzeCorpus` (line 252) indexes markers by `correlation_id` (274-286) and joins bases (366-382). The reader is correct as-is; it is the consumer whose denominator must move. |
| `plugin/skills/faff/bin/lib/events.js` | Node.js | Holds the mirrored copies of both validators (292, 340). Any shape change updates them in lockstep. |
| `plugin/skills/faff/bin/lib/governance-profile.js` | Node.js | Registers both event types (117, 122) and marks them issue-scoped (128, 131). Already correct; named so the build agent does not re-add. |
| `plugin/skills/faff-beep-boop/SKILL.md` (line 210), `plugin/skills/faff-graft/SKILL.md` (line 103) | Prose | The only place emission is specified today: they instruct the orchestrator to export `FAFF_DECISION_CORRELATION_ID` and run `faff decision-capture action`. Prose-only, unexercised, uncovered by any test. |
| `records/specs/2026-09-02-FAFF-956-widen-decision-capture-design.md` | Markdown | The design record for the split. Its "Correlation-id mechanism" decision (line 120) is the rationale the fix must respect or consciously revise. |
| `test/decision-capture-wiring.test.mjs` | Node.js test | Exercises the *legacy* `faff decision-capture record` path with an inline `selected_action`. It passes with this bug present, which is why the bug shipped. |

**Scope.** This bug sits at the write-side wiring of the Phase-1 coordination-fidelity instrumentation: the base capture over-fires and the action marker never fires, so the corpus that FAFF-826/949 study and FAFF-974 must accept is empty of gradeable rows. This spec fixes the wiring and its test gap; it does not change what shadow-fidelity computes.

## 2. OUT OF SCOPE

- **`queue-state` and `project-next` captures.** These are run-level and container-level rollups with no single downstream action, so they are `action_uncaptured` by design, not by this defect. Excluded because grading them would require inventing an action that does not exist. Extension point: none intended; if a rollup ever gains a gradeable action, it would be a new registry decision in `decision-capture.js` KERNEL_REGISTRY plus a `shadow-fidelity.js` adapter, not part of this fix.
- **`tier` and `regions` captures.** Both are outside the shadow-fidelity replay set (`REPLAY_ADAPTERS`), so a replayable capture for them is set aside, never graded. Excluded because they are not part of the join this bug breaks. Extension point: `REPLAY_ADAPTERS` in `shadow-fidelity.js`.
- **The shadow-fidelity grader itself.** `analyzeCorpus` already joins markers to bases correctly; verified by reading lines 274-391. Excluded because the reader is not where the bug lives. Extension point: `shadow-fidelity.js` if a future protocol version changes the join key.
- **Recording or accepting the Phase-1 fidelity baseline value (FAFF-974).** That is a downstream, human-supervised acceptance step that consumes the corpus this fix makes gradeable. Excluded because it depends on this fix landing first. Extension point: FAFF-974's own acceptance flow.
- **Turning capture on by default.** The default posture stays off (`capture.decision_kernel` must read exactly `"on"`). Excluded because the default-off gate is a deliberate FAFF-821 stance. Extension point: `.faffrc.yaml` per-repo config.
- **The five legacy pilot records.** The FAFF-954 combined-shape records still read under the backward-compatible validator branch; they are not re-minted or migrated here. Excluded because they are already gradeable through the legacy inline-action path. Extension point: none.

## 3. WHAT — vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Base record | The in-kernel `decision-capture` event: `{kernel, kernel_version, normalised_inputs, verdict, coverage, missing_inputs, correlation_id, causation}`, no `selected_action`. |
| Action marker | The `decision-capture-action` event: `{kernel, correlation_id, selected_action, causation}`, written by the orchestrator once the action is known. |
| Correlation id | The join key. A caller-minted string, canonically `<run>/<issue>/<kernel>/<wave>`, carried into the kernel by `FAFF_DECISION_CORRELATION_ID` and quoted back by the marker's `--correlates`. |
| Orphaned base | A base record with an empty `correlation_id`, or one whose id no marker quotes. It lands `action_uncaptured` and grades nothing. |
| Incidental capture | A base record minted by a kernel call that is not the orchestrator's core-loop consult (for example a `next` call inside another command), where no correlation id was set. Today these are indistinguishable from orphaned deliberate captures. |
| Join | The pairing of one base and one marker by equal `correlation_id` and matching kernel, after which the decision is graded. |

### The two record shapes (unchanged in structure)

```
RECORD DecisionCaptureBase:            # type "decision-capture", minted in-kernel
  kernel: String                       # non-empty; one of the eleven registry names
  kernel_version: String
  normalised_inputs: Object            # canonical keys by construction
  verdict: String | Object             # the kernel's own output; NO selected_action
  coverage: "replayable" | "non-replayable" | "uncovered"
  missing_inputs: Array<String>        # non-empty iff coverage == non-replayable
  correlation_id: String               # the join key; see the open decision on empty
  causation: { seq: Int, sha256: Hex64 }

RECORD DecisionCaptureActionMarker:    # type "decision-capture-action", written by orchestrator
  kernel: String                       # non-empty; must match the base's kernel
  correlation_id: String               # non-empty; quotes exactly one base's id
  selected_action: String | Object     # the real downstream action
  causation: { seq: Int, sha256: Hex64 }
```

The structures do not change. What changes is whether a runtime path actually populates `correlation_id` on the base and actually writes a marker quoting it, plus how an empty `correlation_id` on the base is treated. The seven affected kernels are `next`, `eligible`, `run-start`, `run-outward`, `run-done`, `park-verdict`, `claim-verdict`; the call sites are listed in the explore findings and confirmed present.

### Design decisions in this section

**Preserve the split versus revert to the combined record.** Options: (a) keep FAFF-956's base + marker; (b) revert to the FAFF-954 combined record carrying `selected_action` inline. (b) grades fine in isolation but forces the orchestrator to hand-build the whole record, which is the exact key-aliasing that produced `missing-input` records FAFF-956 fixed (`decision-capture.js:415-419`), and it still cannot let the kernel see its own action.

**Chosen:** keep the base/marker split. Reverting is a regression to a known-worse state, evidenced by git history (`8dd8d00b` introduced the combined record; `4ecf4948` split it to fix the aliasing) and by the FAFF-956 design record's "Split versus combined record" decision.

**Registration and validator shape.** No new event type is introduced and no field is added, so `governance-profile.js` (already registers both types, 117-131) and the two validator copies need no shape change for the split-preserving fix. **Chosen:** leave registration and the validator shapes as they are, unless the empty-correlation-id decision below is resolved in a way that changes the base shape, in which case both mirrored copies and their selftests update in lockstep per the principle above.

## 4. HOW — behaviour

### The mechanism is sound when driven; nothing drives it

Read against the working tree, the join path already works when the inputs exist: set `FAFF_DECISION_CORRELATION_ID` before a kernel call and the base record carries that id (`decision-capture.js:441`); call `faff decision-capture action --correlates <same id>` and a marker is appended (`cmdActionVerb`, 479-529); export streams both out of `events.jsonl`; `analyzeCorpus` joins them and increments the denominator (366-391). There is no defect in the join itself. The defect is that at runtime (1) no code sets the environment variable, so every base carries an empty id, and (2) no code calls the action verb, so no marker exists. Both steps are described only as orchestrator prose and are exercised by no test.

This shapes the fix into three separable parts, two settled and one escalated.

### Part A — prove and lock the join end-to-end (settled)

**Behaviour summary.** Add an integration test that drives the full documented path through the real CLI and asserts the decision is graded, so the wiring is proven to work and can never silently regress to the current orphaned state.

```
PROCEDURE end_to_end_join_test:
  1. Build a scratch root: .faffrc.yaml with capture.decision_kernel "on",
     a run dir with a genesis events.jsonl chain head, the state-authority map copied in.
  2. Set FAFF_RUN_DIR to the run dir and FAFF_DECISION_CORRELATION_ID to "<run>/<issue>/next/1"
     in the child process environment, then spawn the REAL `faff next` kernel with a full
     seven-key input set so it mints a replayable base record IN-KERNEL (not via `record`).
  3. Run `faff decision-capture action --run <run> --issue <issue> --kernel next
     --correlates "<run>/<issue>/next/1" --action <the action next's verdict implies>`.
  4. Run `faff decision-capture export --out <dir>` then
     `faff shadow-fidelity run --corpus <dir>/decision-corpus.jsonl --json`.
  5. ASSERT matrix.next.denominator >= 1 AND the record is NOT in action_uncaptured.
  6. Negative control: repeat with a DIVERGENT --action and assert it surfaces as a
     divergence (harmless/wasteful/wrong), not as manufactured agreement.
```

The test must spawn the in-kernel hook (step 2 sets the env and runs `faff next`), not the legacy `faff decision-capture record` path. This is the exact wiring finding 7 names as having zero coverage, and its absence is why the bug shipped. `test/decision-capture-wiring.test.mjs` is the model for the harness (scratch root, genesis chain, real CLI via `execFileSync`) but must not be mistaken for coverage of this path; it drives `record` with an inline action and passes with the bug present.

**Anti-pattern:** asserting the join by hand-building a base record with a pre-filled `correlation_id` through `faff decision-capture record`. Why: that path is the legacy combined-record path and never exercises the in-kernel `captureDecisionCore` env-var read, which is where the empty-id defect lives.

### Part B — make base records joinable rather than silently orphaned (settled floor, with one escalated extension)

**Behaviour summary.** When a base record would be minted with an empty `correlation_id`, the capture path writes a loud degraded-capture note instead of silently appending an ungradeable orphan, so the ungradeable condition is observable in `.faff/logs/decision-capture.jsonl` rather than discovered only when the study comes back empty.

```
PROCEDURE captureDecisionCore(...):     # additions to the existing hook, best-effort throughout
  ... existing gate, run-dir, coverage, causation steps ...
  correlation_id = $FAFF_DECISION_CORRELATION_ID or ""
  IF correlation_id == "":
     bestEffortFail(root, run,
        "base record has empty correlation_id — no action marker can join it; capture is ungradeable")
     # see the OPEN decision below on whether to ALSO suppress the append
  ... build base record, validate, append ...
```

The note reuses the existing `bestEffortFail` sink (`decision-capture.js:313`), so it inherits the never-throw, never-non-zero discipline. This is observability only. It does not by itself make the corpus gradeable, and the spec does not claim it does. It is the non-controversial floor: an empty-correlation-id capture stops being invisible.

**Anti-pattern:** treating the loud note as the fix. Why: a note that a base is ungradeable does not produce a joined record; Part A's live emission is what makes the corpus gradeable, and Part B only makes its absence visible.

### Part C — make live emission actually happen (scripted driver, in scope)

The action is irreducibly the orchestrator's downstream choice; no single kernel or CLI can derive it, so some orchestrator-driven step is unavoidable. **Chosen (operator, 2026-09-03):** a scripted set-env-then-emit driver in this ticket. The driver mints the correlation id once, exports `FAFF_DECISION_CORRELATION_ID` before the kernel call, and emits the `decision-capture-action` marker with the same id once the action is known, so the two ids cannot disagree and the orchestrator's per-decision steps collapse to one call it is hard to skip. It replaces the two prose blocks in `faff-beep-boop/SKILL.md:210` and `faff-graft/SKILL.md:103` as the emission path (the prose points at the driver rather than re-stating the steps). Incidental non-orchestrator kernel calls that set no correlation id still mint a base, which Part B now surfaces as a loud degraded-capture note rather than a silent orphan.

### Failure modes

- **The failure:** the end-to-end test in Part A passes, but real beep-boop and graft runs still produce no gradeable corpus, because the LLM orchestrator does not reliably follow the `SKILL.md` prose to set the env var and emit the marker. **How you would know:** a real run with capture on produces base records in `events.jsonl` but `shadow-fidelity` reports `action_uncaptured` non-empty and every `matrix.<kernel>.denominator` at zero. **What it means:** Part A proved the mechanism, not the orchestrator's compliance; the Part C decision (harden the emission) is load-bearing and the fix is not truly done until a real run grades at least one decision. This is the strongest argument that Part C cannot be waved through as prose.
- **The failure:** base capture over-fires. `next` and `eligible` are called from paths other than the orchestrator's core-loop consult; with capture on and `FAFF_RUN_DIR` set but no correlation id, each mints an orphaned base. The corpus fills with incidental orphans that no marker will ever join. **How you would know:** the count of `action_uncaptured` records greatly exceeds the count of deliberate consults in the run, and the degraded-capture log (Part B) shows many empty-correlation-id notes. **What it means:** the coverage strata are diluted; whether to gate base capture on correlation-id presence (the open decision below) directly governs whether this failure persists.
- **The failure:** an action marker is written but never joins, because the orchestrator mints the base id and the marker id by two independent prose interpolations that disagree (a stray path segment, a wave off by one). **How you would know:** both a base and a marker exist for the same run and kernel, but `analyzeCorpus` still reports the base `action_uncaptured` because `markers.get(cid)` misses. **What it means:** the id must be derived once and reused, not interpolated twice; the emission design in Part C must make the base id and the marker id the same string by construction, not by two matching format strings.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given capture.decision_kernel is "on", a run dir with a genesis chain, and
      FAFF_DECISION_CORRELATION_ID set to "<run>/FAFF-1/next/1"
When the real `faff next` kernel runs with a full seven-key input set,
     then `faff decision-capture action --kernel next --correlates "<run>/FAFF-1/next/1"
     --action <action>` is run, then the corpus is exported and shadow-fidelity is run
Then matrix.next.denominator is at least 1 and the record does not appear in action_uncaptured
```

```
Given the same setup but the action marker's --action names an action that diverges from
      what replaying `next` over the captured inputs prescribes
When the corpus is graded
Then the decision is counted as a divergence with a consequence class, never as agreement
```

- The base-capture path MUST never change a kernel's exit code or stdout bytes, whether the correlation id is present, empty, or the capture append fails.

## 5. DESIGN DECISION RATIONALE

**Should the fix preserve the base/marker split or revert to the combined record?**
- Keep the split (a): the kernel records what it can see; the orchestrator records the action; joined later. Costs an orchestrator step. Preserves canonical-key inputs.
- Revert to combined (b): one record, grades in isolation. Forces the orchestrator to hand-build the record, reintroducing the FAFF-954 key-aliasing that yields `missing-input`, and still cannot capture the action from inside the kernel.
- **Chosen:** keep the split. (b) is a documented regression; git history (`4ecf4948` split it precisely to fix (b)'s aliasing) and the FAFF-956 design record both foreclose it.

**How should an empty correlation id on a base record be treated?** (decides: architecture)
- Status quo: silently append the orphan. FAFF-956 called an empty id "the safe direction, lands action-uncaptured, never a crash." Safe against crashes, but it is exactly what makes today's corpus ungradeable and it lets incidental captures dilute the strata.
- Loud note, still append (the Part B floor): the orphan is visible in the degraded log but still enters the corpus.
- Gate: when the correlation id is empty, do not append the base at all, so a base record exists only on the orchestrator's deliberate paired path and always carries a joinable id. This reverses FAFF-956's stated "empty id is safe to store" stance and changes the coverage-stratum semantics (fewer, cleaner records), and it interacts with the selftests that currently assert an empty-id base "passes" validation.
- **Chosen:** keep the loud-note-and-append floor (Part B); do not suppress the append. The suppress-the-append gate is deferred as a separate, deliberate FAFF-956 contract-change decision, out of scope here. Rationale (operator, 2026-09-03): keep this a bug fix, not a contract change — the gate reverses a stated contract and touches both hand-mirrored validators plus their selftests, so it earns its own decision rather than riding in on a fix.

**How should live action-marker emission be made reliable?** (decides: architecture)
- Hardened prose plus an eval: keep the `SKILL.md` instructions but add an evaluation that fails when a run produces orphaned bases. Does not code-enforce; relies on the orchestrator.
- Scripted driver: a helper that reduces the orchestrator's set-env-then-emit-marker to fewer, harder-to-skip steps. Cannot emit the marker atomically with the kernel call, because the action is decided only after the kernel returns, so the marker step stays separate however it is packaged.
- Structural post-hoc join: derive the id purely from `{run, issue, kernel, wave}` so a later pass could pair base and marker without an env var. Does not help, because the action is still unknown until the orchestrator writes the marker; it only removes the env-var read-back, which FAFF-956 already solved by caller-minting the id.
- **Chosen:** build a scripted set-env-then-emit driver in this ticket. A helper reduces the orchestrator's "mint an id, export `FAFF_DECISION_CORRELATION_ID`, run `decision-capture action`" to fewer, harder-to-skip steps: it mints the correlation id once, sets the env var before the kernel call, and emits the `decision-capture-action` marker with the same id after the action is known. The action is still supplied by the orchestrator (irreducibly deferred), but the id is derived once and reused, so the base and marker cannot disagree. Rationale (operator, 2026-09-03): prose-only shipped this bug; the strongest available code-enforcement that respects the deferred-action constraint is worth the larger scope. The Part A end-to-end test is the regression guard.

**What is the DONE signal for the wiring?**
- **Chosen:** an end-to-end test that spawns the real in-kernel hook with the correlation env set, calls the action verb, exports, and asserts a graded matrix denominator, plus a divergence negative control. Rationale: finding 7 identifies this exact path as having zero coverage and as the reason the bug shipped; a test on any other path (notably the legacy `record` path) passes with the bug present and is not a valid DONE signal.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Resolved at prep (operator, 2026-09-03)

Both former Punts are closed by operator decision; the rationale is recorded in section 5.

**Empty-correlation-id handling → Chosen: loud note only, gate deferred.** Part B (the degraded-capture note) ships in this ticket and the empty-id base is still appended. Suppressing the append is deferred as a separate, deliberate FAFF-956 contract-change decision — it reverses a stated contract and touches both hand-mirrored validators plus their selftests, so it is not folded into this bug fix.

**Live action-marker emission → Chosen: scripted set-env-then-emit driver, in this ticket.** A helper mints the correlation id once, sets `FAFF_DECISION_CORRELATION_ID` before the kernel call, and emits the `decision-capture-action` marker with the same id after the action is known. The action stays orchestrator-supplied (irreducibly deferred); the id is derived once and reused so base and marker cannot disagree. The Part A end-to-end test is the regression guard, and the acceptance condition below still holds: a real run must grade at least one decision before the ticket is accepted.

### Assumptions

**Assumes: shadow-fidelity's `analyzeCorpus` join is correct as written.** Validation: before building, read `shadow-fidelity.js:274-391` and confirm that a base with a non-empty `correlation_id` and a same-kernel marker quoting that id increments `matrix.<kernel>.denominator` and does not land in `action_uncaptured`. This was verified during exploration; re-confirm because the whole fix rests on it.

**Assumes: `governance-profile.js` already registers `decision-capture-action` as an issue-scoped event type.** Validation: confirm lines 117-131 register both `decision-capture` and `decision-capture-action` in `event_types` and `issue_scoped_types`. Verified during exploration; do not re-add.

**Assumes: `.faffrc.yaml` keeps `capture.decision_kernel: "on"` for the repo where the corpus is gathered.** Validation: confirm `.faffrc.yaml:134-135`. If a run gathers no corpus, check this gate first; a default-off repo mints nothing by design.

## 7. DONE — definition of done

### From WHY
- [ ] A real beep-boop or graft-shaped invocation (correlation env set, action verb called) produces at least one *joined*, graded decision in the shadow-fidelity matrix, not an `action_uncaptured` orphan. (If the Part C decision defers live-run proof, this item is met by the Part A end-to-end test and the failure mode is recorded against the human decision.)

### From WHAT (types and shapes)
- [ ] The base/marker split is preserved; no combined kernel-minted record carrying inputs, verdict, and action is introduced.
- [ ] If and only if the empty-correlation-id gate is adopted, both hand-mirrored validators (`decision-capture.js` and `events.js`) and their `--selftest` cases are updated in lockstep, and `faff validate-adapters` plus both selftests pass.

### From HOW (Part A — the join, settled)
- [ ] A new end-to-end test spawns the real in-kernel hook (a real `faff next` or `faff eligible` with capture on, `FAFF_RUN_DIR` set, and `FAFF_DECISION_CORRELATION_ID` set), then calls `faff decision-capture action --correlates <same id>`, then exports and runs `faff shadow-fidelity`, and asserts `matrix.<kernel>.denominator >= 1` and the record is absent from `action_uncaptured`.
- [ ] The same test includes a divergence negative control: a marker whose `--action` disagrees with the replayed verdict surfaces as a divergence with a consequence class, never as agreement.
- [ ] The test drives the in-kernel `captureDecisionCore` env-var path, not the legacy `faff decision-capture record` inline-action path; a reviewer can confirm the test would fail if `FAFF_DECISION_CORRELATION_ID` were ignored or the action verb never called.

### From HOW (Part B — observability, settled)
- [ ] When a base record would be minted with an empty `correlation_id`, a degraded-capture note naming that condition is appended to `.faff/logs/decision-capture.jsonl` via the existing `bestEffortFail` sink.
- [ ] The note path never throws to the kernel, never writes to the kernel's stdout, and never changes the kernel's exit code; a capture-on kernel run with an empty correlation id is byte-identical on stdout and exit to a capture-off run.

### From HOW (Part C — scripted driver)
- [ ] A scripted set-env-then-emit driver mints the correlation id, exports `FAFF_DECISION_CORRELATION_ID` before the kernel call, and emits the `decision-capture-action` marker with the same id after the action is known; the base id and marker id are the same string by construction (derived once, reused), not two interpolations.
- [ ] The `faff-beep-boop/SKILL.md` and `faff-graft/SKILL.md` emission prose points at the driver rather than re-stating the manual env-export + `decision-capture action` steps.
- [ ] A real run driven through the driver grades at least one decision in the shadow-fidelity matrix (the acceptance condition; if live-run proof is deferred it is stated explicitly, not met by the Part A test alone).
- [ ] The empty-correlation-id gate (suppress the append) is NOT implemented here; it is left as a documented, separate FAFF-956 contract-change decision.

### From failure modes
- [ ] If live-run proof is in scope, a real run with capture on is inspected and the ratio of joined to `action_uncaptured` records is reported, so corpus dilution by incidental captures is visible rather than assumed away.

### Integration smoke test

```
PROCEDURE smoke:
  1. scratch root: .faffrc.yaml capture.decision_kernel "on"; run dir with genesis events.jsonl
  2. env FAFF_RUN_DIR=<run dir> FAFF_DECISION_CORRELATION_ID="<run>/FAFF-1/next/1"
     run: faff next --status todo --spec high --eligible true --parked false
          --blocked false --if-eligible false --awaiting-spec-review false
  3. faff decision-capture action --run <run> --issue FAFF-1 --kernel next
       --correlates "<run>/FAFF-1/next/1" --action graft
  4. faff decision-capture export --out <run dir>/export
  5. faff shadow-fidelity run --corpus <run dir>/export/decision-corpus.jsonl --json
  6. EXPECT matrix.next.denominator >= 1 AND action_uncaptured does not contain this record
  # if this one path grades, the base->marker->export->grade plumbing is connected
```

confidence: high
build-tier: complex
spec-review: approve