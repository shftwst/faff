# FAFF-278 — Sentry (2) spike: corrective-intervention authority model

> Spec: faffter-dark-nlspec · 2026-07-03 · interactive · confidence: high. Full spec on Linear FAFF-278.

This spec scopes a **spike**: a bounded, human-supervised investigation whose deliverable is a **recorded decision** (one ADR: GO / GO-narrow / NO-GO on corrective authority, plus the fleet and watcher-audit calls) — not a committed feature. It mirrors the FAFF-263 spike shape (question → method → decision criteria → ADR, Accepted on human sign-off; ADR-0029 is the precedent deliverable). Audience: the investigating agent and human reviewers.

## 1. WHY — problem and principles

**The load-bearing model.** Sentry's shipped hard stop is un-subvertable *by construction*: the supervised build subagent returns only a terminal token and has no write-path to the orchestrator surface Sentry reads, so declining the next dispatch (plus stopping the in-flight task) is a channel the watched agent cannot touch. *Correct* — re-park, re-spec, constrain-and-continue — appears to require writing back **into** the supervised lane, which reopens exactly that subversion surface. But faff already performs every redirect-shaped act safely today (mid-build respec, park→re-enter, abort→resume) — and all of them happen **while the supervised agent is not running**, through orchestrator-lane artifacts. The spike's central hypothesis is therefore: **corrective authority = stop (shipped, un-subvertable) + a machine-authored corrective input consumed at the next dispatch — never a live write into a running lane.** What remains genuinely open is whether that machine-authored input can be trusted, how far it may go, and what it does to the fleet and watcher-audit models.

**Problem.** The Sentry split deferred three research-shaped questions (the corrective-redirect channel, per-run vs fleet supervision, who-watches-the-watcher) because they carry real architecture/safety risk. Until they're answered with evidence, "hands-off self-correcting L4" has no honest design, and the run-governance model treats every derailment as a stop. This spike answers them — or finds that no channel is safe at v1, which ships stop-only and is an equally valid outcome.

**Design principles** (would reject an otherwise-valid investigation):

- **The constraint checklist is the bar, not vibes.** Every candidate channel is judged against the 13 source-extracted constraints (from ADR-0034, the Sentry-1 spec, the concurrency executors, the trusted-spec carve-out, and the sentry tests) — un-subvertable channel, closed input allowlist, isolation co-binding, resumable state, consume-don't-re-derive, the machine-authored-spec trust gap, the fleet write-contention punt, assert-don't-implement, watcher un-audited. A channel that fails any constraint is refuted with the constraint cited.
- **A negative result is a deliverable.** "No corrective channel is safe at v1 → ship stop-only" is a complete, recordable spike outcome, exactly as the ticket frames it.
- **Evidence over argument.** The verdict rests on a recorded refutation log + a mechanical probe, per the spike-ADR house shape (decisive risk examined, narrow boundary preferred over binary, caveats + costed follow-ups named).

**Reference context:**

| Surface | Location | Relevance |
|---|---|---|
| The un-subvertability argument | `docs/adr/0034-…md` (Proposed) | The claim a redirect must not break; names the correct/redirect deferral + the isolation co-binding revisit trigger |
| Shipped Sentry | `plugin/skills/faff/bin/faff` (`cmdSentry` ~L8778–9130); `test/sentry.test.mjs` | Ladder pinned `continue\|pause\|abort` (AC6 asserts no `correct` path); AC5 asserts no subagent-shaped input flips a verdict; `abort` → `aborted-resumable`, no terminal outcome |
| Dispatch/isolation model | `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md`, `faffter-dark-concurrency-parallel/SKILL.md` | Subagent-per-build, terminal-token-only return, resume-from-ledger; in-flight control verb is TaskStop + decline-next-dispatch — nothing finer; fleet write-contention punt |
| Redirect-shaped precedents | `plugin/skills/faff-graft/SKILL.md` (respec, park), gateway Park/Unpark protocol | The existing machine-amends-spec path parks rather than proceeds on any open decision |
| Trusted-spec carve-out | `plugin/skills/faff/SKILL.md` → Untrusted input | Trust flows from the human-gated tracker; a machine-authored amendment has no such provenance — the gap the spike must close or respect |
| Spike precedent | FAFF-263 → `docs/adr/0029-…md` | The deliverable shape: measured decisive risk, narrow boundary, caveats, costed follow-ups, human sign-off |
| Effects ledger | `docs/specs/2026-06-30-faff-106-…md`, `faff effects` | The actual forbidden-side-effect signal producer (the Sentry-1 text mis-attributes this to FAFF-42 — corrected by this spike's ADR) |

**Scope:** the L4 supervision layer's authority model — the design decision above Sentry-1's shipped detection/stop and beside the run-governance wiring (FAFF-312, which owns the dispatch-boundary branch a `correct` rung would eventually land in).

## 2. OUT OF SCOPE

- **Building the corrective mechanism** — this spike decides; a GO/GO-narrow verdict yields follow-up build ticket(s) costed in the ADR. Extension point: the `SIGNAL_TRIP_INTERVENTION` map + the dispatch-boundary handling branch (FAFF-312's mint-scoped procedure) + `test/sentry.test.mjs` AC6 (the ladder guard a `correct` rung must consciously extend).
- **Real-side-effect rollback** — undo is FAFF-37's territory; a redirect never claims to reverse escaped effects.
- **Resolving the fleet write-contention punt** — the parallel executor's multi-writer heartbeat/outcome hazard is a named extension (dedicated single-value heartbeat file); the spike only decides whether fleet supervision is admissible *before* that fix (expected: no).
- **Changing Sentry-1 behaviour** — detection, thresholds, and the shipped stop path stay untouched; probe fixtures/tests may be added but no production intervention code lands from this ticket.
- **The run-governance wiring** — budget demotion, run-done-as-terminator, and the sentry consult loop are FAFF-312's slice.

## 3. WHAT — the investigation

**Vocabulary:**

| Term | Definition |
|---|---|
| Corrective input | A machine-authored artifact that changes what the *next* dispatch of a unit does (a constraint annotation, a park with cause, a respec trigger) |
| Subtractive input | A corrective input that only *narrows* the supervised agent's mandate (park, de-scope, forbid a surface, tighten a threshold) |
| Additive input | A corrective input that *changes the WHAT* (amends the spec's intent, adds scope, redirects the goal) |
| Live write-back | Any channel that delivers input into a supervised lane **while it runs** |
| Refutation log | The per-channel record of survive/refute verdicts with the violated constraint cited |

**The candidate-channel set** (closed enumeration — every channel is built from shipped surfaces; the spike evaluates these four, not an open search):

```
CHANNEL A — stop-and-redispatch with amended mandate
  abort (shipped, un-subvertable) → Sentry/orchestrator authors a corrective
  input into orchestrator-lane artifacts (park comment, constraint annotation,
  respec trigger) → normal resume-from-ledger re-entry consumes it.
  All writes happen while the supervised agent is dead.

CHANNEL B — boundary-consulted constraint file
  constrain-and-continue WITHOUT stopping: the orchestrator/graft prose reads a
  constraint artifact at its own existing checkpoints (dispatch boundaries,
  gate points); the in-flight subagent is never written to — it discovers
  narrowed authority at its next checkpoint.

CHANNEL C — live write-back into the supervised lane
  message/steer the running subagent directly. Included as the expected-reject
  baseline: it is the definition of reopening the subversion surface.

CHANNEL D — tracker-mediated human relay (control)
  Sentry parks + surfaces; a human authors the corrective input. The existing
  safe path — the bar any machine channel must beat on latency/autonomy
  without losing on trust.
```

**The trust rule under test** (the machine-authored-mandate hypothesis): the trusted-spec carve-out covers human-gated content only, so a machine-authored corrective input needs its own provenance argument. The hypothesis the spike must confirm or refute: **subtractive inputs are safe-direction machine-authorable** (they can only reduce the supervised agent's authority, mirroring the write-abstention template where safety comes from what the machine structurally cannot do); **additive inputs are not** (a machine-amended WHAT has no human-gated provenance → park for a human, exactly as graft's respec already does on any open decision).

**The three decisions the spike must record** (these are the spike's *outputs*, framed with criteria below — not open punts in this spec):

1. **Corrective-redirect channel** — which channel(s) survive, at what authority width (the subtractive/additive boundary), or NO-GO → stop-only stands.
2. **Per-run vs fleet supervisor** — admissible criterion: fleet supervision requires zero new write-paths into shared mutable state while the write-contention punt stands; otherwise per-run now, fleet deferred behind that fix.
3. **Who-watches-the-watcher** — the failure-mode register (false-positive kill, missed derailment, wedged/dead watcher) with the v-next audit/bounding disposition per mode; criterion: every watcher failure must fail *open-to-human* (visible, resumable), never silent. Shipped precedents to compose: report-only posture, owner-emitted liveness state audited by an independent hook, and the no-supervised-input-flips-the-verdict test shape.

## 4. HOW — spike method

Three passes, then the ADR. Human-supervised throughout (like FAFF-263: "build" = run the investigation; no auto-merge).

**Pass 1 — threat-model each channel against the constraint checklist.** For each of A–D: who writes what, when, through which artifact; which constraint(s) it violates or satisfies; verdict survive/refute with the constraint cited. Output: the refutation log (a `docs/`-committed spike log or ADR appendix).

**Pass 2 — adversarial refutation of the survivors.** Prompt an independent model (the shipped adversarial-review engine, with its fallback chain configured) to break each surviving channel: forge the corrective input, influence Sentry's decision inputs from the supervised lane, wedge the run unresumably, escalate a subtractive input into additive effect. A channel survives only if the refuter finds no unmitigated break. An inconclusive pass (provider down through the chain) is **not** survival — rerun or record needs-human, mirroring the house rule that a skipped skeptic never counts as a pass.

**Pass 3 — mechanical probe of the leading channel.** On a forced-abort fixture (the existing sentry test shape):

```
PROCEDURE probe_leading_channel(fixture_run):
  1. Trip sentry → abort → assert ledger aborted-resumable, WIP on branch,
     no terminal outcome (the shipped guarantees still hold under redirect)
  2. Author a SUBTRACTIVE corrective input via the channel's artifact
  3. Re-enter via normal resume-from-ledger → assert the re-dispatched unit's
     mandate reflects the constraint
  4. AC5-style assertion: no subagent-shaped/foreign input can author or alter
     the corrective input — the authoring path reads only the closed
     orchestrator-surface allowlist
  5. Attempt an ADDITIVE input through the same path → assert it routes to
     park/needs-human, never to a proceeding re-dispatch
```

Probe artifacts (fixtures/tests) may land in `test/`; they assert current behaviour plus the probed path and must not change shipped Sentry semantics (AC6's no-`correct` pin stays until a build ticket consciously extends it).

**The ADR.** One record (via `faff adr new` at graft time; renumber at branch time): the verdict (GO / GO-narrow / NO-GO) per decision, the surviving channel + its authority boundary, the fleet call, the watcher failure-mode register + audit disposition, honest caveats, and costed follow-up ticket(s). It also corrects the standing mis-reference: the forbidden-side-effect signal producer is the effects ledger (FAFF-106's `faff effects`), while FAFF-42/the container is the blast-radius boundary the isolation claim is co-bound to. Status `Proposed` until the human signs it `Accepted` (the FAFF-263 gesture).

**Failure modes (of the spike itself):**

- **The refuter rubber-stamps.** An adversarial pass that finds nothing may mean a safe channel or a weak refuter. How you'd know: zero findings across all channels including the planted-reject baseline (channel C). Channel C is the canary — a refuter that passes C is invalid; rerun with a different backend.
- **The probe proves the fixture, not the model.** A green probe on a fixture doesn't establish the channel under a real derailed run. Meaning: the ADR's verdict is *provisional* GO — name the live-run validation as a costed follow-up, don't overclaim (the spike-ADR house shape).
- **The subtractive/additive line doesn't hold.** A "subtractive" constraint could smuggle additive effect (constrain everything except the attacker's goal). How you'd know: pass 2 is explicitly prompted to attempt the escalation. Meaning: narrow the GO further (e.g. park-only corrective authority) or NO-GO.

**Anti-pattern:** letting the spike drift into building Sentry-2. Why: the timebox exists because the *decision* is the deliverable; mechanism-building without the recorded verdict inverts the risk-first order.
**Anti-pattern:** treating "no safe channel found" as spike failure and iterating past the timebox. Why: stop-only is a valid, shippable answer — the ticket says so.

**Timebox / stop rule:** stop when the three decisions are answered with recorded evidence (refutation log + probe results), not when a mechanism is "good". A NO-GO on any question is a complete answer for it.

## 5. SCENARIOS

```
Given the four candidate channels and the constraint checklist
When  passes 1–2 complete
Then  every channel has a recorded survive/refute verdict citing the
      constraint(s) it fails, and channel C (live write-back) is refuted —
      a pass on C invalidates the refuter and forces a rerun

Given the leading surviving channel and a forced-abort fixture
When  the mechanical probe runs
Then  abort's shipped guarantees hold (aborted-resumable, WIP committed, no
      terminal outcome), a subtractive corrective input reaches the
      re-dispatched unit's mandate, an additive input routes to
      park/needs-human, and no subagent-influenced input can author either

Given the evidence from all three passes
When  the ADR is authored
Then  it records a verdict per decision (channel + authority boundary, fleet,
      watcher-audit), corrects the FAFF-42/FAFF-106 attribution, names
      caveats + costed follow-ups, and is Accepted only on human sign-off
```

Assertions:
- No shipped Sentry behaviour changes: the intervention ladder remains `continue | pause | abort` and its no-`correct` test still passes at spike end.
- The spike lands via a docs(+tests) PR only — no production intervention code.

## 6. DESIGN DECISION RATIONALE

**Spike shape — measurement corpus or threat-model + probe?** FAFF-263 measured against a corpus because its risk was statistical (false-pass rate); this risk is structural (a subvertible channel). A corpus doesn't exist for "channels"; a threat-model alone is argument, not evidence. **Chosen:** threat-model against the extracted constraint checklist + adversarial refutation + a mechanical probe — the same evidence-over-argument bar in the form this risk actually takes.

**Open search or closed candidate set?** An open "design the channel" spike never terminates. Every redirect-shaped act faff performs safely today already flows through orchestrator-lane artifacts, so the realistic channels are enumerable from shipped surfaces. **Chosen:** the closed four-channel set (stop-and-redispatch · boundary-consulted constraints · live write-back as reject-baseline · human relay as control); the ADR may note out-of-set ideas as follow-ups, the spike evaluates these four.

**Are the three research questions Punts?** A spike spec that punts its own question can never rate high and would park — wrong for a ticket whose deliverable *is* the answered question. FAFF-263's precedent: the spec closes the *method* decisions and frames the research questions as decisions-to-make with explicit criteria. **Chosen:** the same — method Chosen here, the three answers are the spike's recorded outputs.

**Who refutes?** Self-review by the authoring context is self-grading. **Chosen:** the shipped adversarial-review engine (different model, fallback chain configured) as pass-2 skeptic, with channel C as the planted canary; an inconclusive/skipped skeptic never counts as survival.

**How is the trust gap framed?** The trusted-spec carve-out cannot cover machine-authored amendments without abandoning its by-construction provenance argument. **Chosen:** test the subtractive/additive hypothesis — subtractive machine authorship (authority can only shrink; the write-abstention safety template) vs additive requiring human-gated provenance. The spike confirms, narrows, or refutes it; it does not silently widen the carve-out.

**Fleet criterion?** The multi-writer contention punt is real, unresolved, and outside this ticket. **Chosen:** fleet supervision is admissible only with zero new write-paths into shared mutable state while that punt stands; expected outcome is per-run-now with fleet as a costed follow-up behind the heartbeat-file fix — but the criterion, not the expectation, is what binds.

**Watcher-audit criterion?** No shipped machinery audits Sentry; inventing a full watcher-of-watchers regresses into infinite regress. **Chosen:** the spike registers the failure modes and disposes each against "fails open-to-human, never silent", composing shipped precedents (report-only posture, owner-emitted liveness audited by an independent hook, no-supervised-input tests); any heavier mechanism is a costed follow-up, not a spike deliverable.

**One ADR or three?** The three decisions share one authority model and one evidence base. **Chosen:** one ADR covering all three verdicts (matching the ticket's single decision-to-make framing), with the FAFF-42/FAFF-106 correction folded in.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none in this spec — the three research questions are the spike's framed outputs (section 3), each with a decision criterion; the method decisions are all closed above.

**Assumptions:**

- **Assumes:** the shipped Sentry surface is as explored — ladder pinned without `correct` (guarded by test), abort leaves `aborted-resumable` + no terminal outcome, AC5 no-foreign-input holds. Validate before starting: run `faff sentry check --selftest` + `node --test test/sentry.test.mjs`.
- **Assumes:** the adversarial-review engine is invocable standalone for pass 2 with a working fallback chain (`review-call.mjs` + `faffter_dark.adversarial.fallbacks`). Validate: resolve the chain via `faff config get` and dry-run one call before the pass; a fully-down chain pauses the spike rather than skipping the skeptic.
- **Assumes:** the subagent isolation model is as ADR-0034 describes (terminal-token-only return, no orchestrator write-path) — the ground every threat-model verdict stands on. Validate: re-read the concurrency executors' dispatch prose + the AC5 test before pass 1; if isolation has weakened, the spike's first finding is that ADR-0034's revisit trigger has fired, which reframes everything.

## 8. DONE

### From WHY / WHAT
- [ ] All four candidate channels have recorded survive/refute verdicts in the refutation log, each citing the constraint(s) at issue; channel C is refuted (canary held).
- [ ] The subtractive/additive trust hypothesis has an explicit confirmed / narrowed / refuted disposition backed by the pass-2 record.

### From HOW (passes)
- [ ] Pass-2 adversarial refutation ran with an independent backend (no skipped-skeptic survivals; inconclusive reruns recorded).
- [ ] The mechanical probe ran on a forced-abort fixture: shipped abort guarantees held, a subtractive input reached the next dispatch's mandate, an additive input routed to park/needs-human, and the AC5-style no-foreign-authorship assertion passed.
- [ ] No shipped Sentry semantics changed: the intervention-ladder test (no `correct` path) still passes; the spike PR is docs + test-fixtures only.

### From HOW (the ADR)
- [ ] One ADR recorded at graft (`faff adr new`, renumbered at branch time) with: verdict per decision (channel + authority boundary · per-run-vs-fleet · watcher failure-mode register + audit disposition), caveats, and costed follow-up tickets; status `Proposed` pending human sign-off to `Accepted`.
- [ ] The ADR corrects the side-effect-definition attribution (effects ledger FAFF-106 as producer; FAFF-42/container as the co-bound isolation boundary).

### Eval seam
- [ ] Seam disposition declared: the spike reuses the shipped adversarial engine and adds no new LLM-judgement seam — `judgement_seam: none`, no new grader KIND.

### Scenarios
- [ ] All section-5 scenarios pass; both assertions hold.

### Integration smoke test

```
1. node --test test/sentry.test.mjs            → all pass (ground truth intact)
2. run pass 1 on channel C                     → refuted, constraint cited
3. probe fixture: sentry abort → subtractive input → resume  → mandate narrowed, ledger clean
4. probe fixture: additive input via same path → parked/needs-human, no re-dispatch
5. faff adr validate                           → new ADR conformant
```

confidence: high
spec-review: approve
