# FAFF-474 — Live-lane `LIVE_KINDS` holdout adapter: drive the real evaluator agentically against a docker env

> Spec: faffter-dark-nlspec · 2026-07-13 · autonomous · confidence: medium. Full spec on Linear FAFF-474.

This spec defines the eval-harness work for FAFF-474: the named live-lane follow-up FAFF-317 carved out of scope. It registers a new agentic-driven kind in `eval/run-live-evals.mjs`'s `LIVE_KINDS` that stands up a real docker env and drives the real `faffter-noon-evaluate` judging rubric against it, instead of a static recorded fixture — closing the "residual seam" FAFF-317's Failure modes named. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model.** FAFF-317 measures the evaluator's exercise judgement — *derive which evidence bears on a criterion, interpret it, classify met/unmet* — against **recorded, static** env-surface fixtures (raw request→response transcripts a human authors up front). That is a black-box, deterministic, offline lane: fast, zero-flake, but the model is handed a pre-recorded catalog and never issues a real request itself. FAFF-317's own spec named the ceiling on that approach explicitly (Failure modes, "The residual seam"): *"a single-prompt black-box cannot measure agentic command derivation-and-execution (the model choosing and running curl itself)."* This ticket is that residual seam's fix — a **live** kind where the evaluator actually runs against a **live** container it must probe for itself.

**Problem statement.** Every registered `LIVE_KINDS` adapter today (`reconciliation`, `routing`, `verdict-build`) shares one model primitive: `makeLiveModel` (`eval/live-driver.mjs:184-197`) spawns `claude -p` as a **single-shot completion** — one prompt string in, one text blob out, no tool access, no multi-turn. That is sufficient for a judgement that only needs to *read* a rendered fixture and emit a classification. It is **structurally insufficient** to drive a live env: the real `faffter-noon-evaluate` procedure (`plugin/skills/faffter-noon-evaluate/SKILL.md` → *How it evaluates*) is itself an agentic loop — classify the DoD, then for each born-verifiable criterion *derive* an exercise command from the criterion text and *execute* it against the env's endpoint, treating the response as data. A one-shot completion cannot issue that request and observe the real reply mid-judgement. No amount of prompt engineering over the existing `ctx.model(prompt) -> text` contract closes this gap; a different invocation primitive is needed.

**Design principles.**

**Reuse the provisioning and grading halves; the driving half is the only new surface.** The env-provisioning mechanics are already real and deterministic (`faff env compose-gen|up|seed|down`, `plugin/skills/faff/bin/lib/env.js`) and a docker-fixture pattern already proves the plumbing end-to-end (`test/holdout-evaluate-integration.test.mjs` + `test/helpers/holdout-exercise.mjs`, a real `hashicorp/http-echo` container with a scripted, non-agentic exerciser). The grading math is already proven for this exact judgement surface (`holdout-exercise`'s closed-set `key:class` pairs via `pairsOf`, FAFF-317). Building either of those again from scratch would be waste; only the agentic-driver seam is genuinely novel.

**Zero new grade math, again.** The new kind reuses the `holdout-exercise` closed-set grading shape verbatim (criterion-key → `met|unmet|needs-human`) so a recorded-lane and live-lane score are directly comparable — the whole point of carving this lane out was to see whether the recorded lane's near-ceiling score holds up against a real, unaligned, self-probed env.

**Human-supervised, never CI — same posture as every sibling kind.** `eval/` is excluded from `node --test` / CI (`eval/README.md`); every existing `LIVE_KINDS` entry's real model call only fires from the CLI `main()`, and tests inject a mock. This kind is no different, and is *more* expensive per rep (docker up/seed/teardown plus an agentic session, not one completion call) — it stays strictly human-supervised, and the existing `BASE_REPS`/`MAX_REPS`/escalation loop is reused unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/run-live-evals.mjs` | JS (ESM) | `LIVE_KINDS` (:72-119) — reconciliation/routing/verdict-build only; the exact extension point this ticket targets; `runLiveCase`/`runLiveEvals` (:124-159) — the rep-loop + escalation this kind must not duplicate |
| `eval/live-driver.mjs` | JS (ESM) | `makeLiveModel` (:184-197) — the one-shot completion primitive every existing kind uses; the gap this ticket cannot reuse as-is for the driving half |
| `eval/grader.mjs` | JS (ESM) | `KINDS`/`CLOSED_SET_KINDS`, `pairsOf`, the `holdout-exercise` `predictedSet` arm — the grading path this ticket reuses unchanged |
| `docs/specs/2026-07-12-FAFF-317-...md` | prose | §2 OUT OF SCOPE names this exact ticket; Failure modes → "The residual seam" states the trigger condition; §6 D1 states why the live lane was carved out |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | prose | The judged rubric (`judgement_seam: holdout, holdout-exercise`) — *How it evaluates* is the agentic procedure this kind must actually run, not paraphrase |
| `plugin/skills/faffter-noon-env-compose/SKILL.md` + `plugin/skills/faff/bin/lib/env.js` | prose + JS | `faff env compose-gen/up/seed/down` — the already-deterministic, already-tested docker provisioning this ticket calls, never re-implements |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | JS (ESM) | The FAFF-384 production spawner. Ships the envelope/attestation logic but explicitly requires an injected `spawnFn` for "the agentic-engine launch" (`:170-171`, comment: *"no real default here... the CLI path requires an injected/host-provided spawn"*) — the **same missing primitive** this ticket needs for the eval harness, in a different consumer (production merge-gate dispatch vs. eval measurement) |
| `test/holdout-evaluate-integration.test.mjs` + `test/helpers/holdout-exercise.mjs` | JS | The docker-gated plumbing proof (up/waitReady/down against a real `hashicorp/http-echo` container) — reusable as the eval-case fixture family's starting point |
| ADR-0041 (multi-cage isolation ladder) | prose | Confirms v1 runs everything inside one human-launched cage; a *nested* agentic engine (FAFF-380, Done — external) is the precondition this ticket's driver assumes is available when run for real |

**Scope statement.** This is the eval-coverage slice of project "T4 — affidavits become attestations" — the same project FAFF-317/384/309/311/275 all landed in. It measures the shipped evaluator against a real env; it never changes evaluator or env-slot behaviour, and it does not wire anything into the production merge-gate dispatch path.

## 2. OUT OF SCOPE

- **Whether FAFF-317's stated trigger condition has actually fired.** FAFF-317's Failure modes named the fund-this-now signal as *"the recorded lane baselines near-ceiling while real evaluator runs still misjudge"* — but the `holdout`/`holdout-exercise` frontier baseline has never been recorded (FAFF-317 explicitly left baseline recording as a human-supervised follow-up, not required by its own DONE). This ticket does not gate on running that baseline first (see §6 D5, §7); it only builds the extension point FAFF-317 named. Extension point: the standing frontier-baseline follow-up flow (same one FAFF-317 deferred).
- **The concrete `spawnFn` for `evaluate-call.mjs`'s production dispatch.** FAFF-384's spawner already ships the envelope/attestation/exit-code logic and explicitly injects the agentic-engine launch — it is unfilled today (no `lane-boundary.json` promise is ever produced yet, so that branch is dead code in practice). This ticket's agentic-driver primitive is built **for the eval harness only**; whether it is later reused (or a different implementation is built) to fill `evaluate-call.mjs`'s injection point is a separate ticket's call — wiring it into the merge-gate/beep-boop §10b production path is explicitly not this ticket's job. Extension point: a follow-up against `evaluate-call.mjs`'s `spawnFn`.
- **The physical bounded-nested-engine cage.** External dependency (FAFF-380, Done — closed by claude-box shipping the capability). This ticket assumes it is available when the live kind is actually run for real; it builds no container/sandbox itself.
- **Env-provisioning mechanics.** `faff env compose-gen/up/seed/down` is already real, deterministic, and tested — read and called, never re-implemented or edited. Extension point: FAFF-30/its own tickets.
- **Code-blindness / spawner-attestation enforcement inside this harness.** FAFF-384's spawner-attested `code_blind` exists to defeat an *adversarial* judged party at a real merge gate. An eval-harness rep is not an adversarial setting — the case author controls the fixture and already knows the oracle — so this ticket does not require or emit `spawner_attested`/`attestation` fields; it drives the evaluator's judging rubric directly (mirroring how `reconciliation`/`routing`/`verdict-build` drive their skills' rubrics directly, never through a production cage). Extension point: FAFF-384's own ticket if eval-harness code-blindness enforcement is ever wanted.
- **`faffter-noon-evaluate` / `faffter-noon-env-compose` SKILL.md behaviour changes.** Read, not edited.
- **Baseline recording/acceptance.** Human-supervised `claude -p`(-class) runs; never required by this ticket's DONE (the nlspec eval-coverage rule FAFF-317 already established).
- **Re-sourcing KINDS from the registry.** Already named out of scope in `grader.mjs` (:216).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Agentic drive | A model invocation that can issue real requests against a live endpoint and observe the real response mid-judgement — distinct from a one-shot completion |
| Env fixture | A small, disposable containerised stand-in (e.g. an `hashicorp/http-echo`-class image) an eval case stands up fresh per rep, with an author-controlled ground truth |
| `holdout-live` | The new `LIVE_KINDS` entry this ticket registers |

**New `LIVE_KINDS` adapter (registered per the existing shape, `run-live-evals.mjs:44-55`):**

```
holdout-live: {
  loader() -> Array<HoldoutLiveCase>          # eval/cases-live/holdout-live-*.json
  async driveCase(evalCase, { runSkill, tracker, repo, model, repIndex }) -> { env, tokens }
}

RECORD HoldoutLiveCase:
  id: String
  kind: "holdout-live"
  fixture: {
    image: String                # e.g. "hashicorp/http-echo" or a small purpose-built image
    args: List<String>           # container launch args (deterministic ground truth baked in)
    port: Int
    health_path: String
  }
  spec_dod: List<Criterion>      # identical shape to holdout / holdout-exercise: {key, class, text}
  oracle:
    closed_set: List<"<criterion-key>:<met|unmet|needs-human>">   # SAME shape as holdout-exercise
```

**`driveCase` contract** — normalises to the SAME `{ env, tokens }` shape every sibling adapter returns, so `runLiveCase`'s grading call is unchanged: `env["holdout-exercise"]` — reusing the **existing** closed-set field name (not a new one), so the grader needs no new `predictedSet` arm (see §6 D3).

**Design decision — new kind vs extending `holdout-exercise`.** **Chosen:** a new kind `holdout-live`, sharing `holdout-exercise`'s grading arm and `FIXTURE_SHAPE`-equivalent oracle shape but its own case family and loader (rationale in §6, D3) — mirrors FAFF-317's own D2 (new kind, not overloading an existing one, when the fixture *articulation* differs even though the judgement surface is identical).

**Design decision — the agentic-drive primitive.** **Punt** — see §6 D1; a build-time spike resolves the concrete mechanism, not this spec.

**Design decision — env fixture richness for v1.** **Chosen:** reuse the `test/holdout-evaluate-integration.test.mjs` docker-fixture pattern (a tiny single-endpoint image whose response body is the author-controlled ground truth) rather than a full architecture-proposal-driven multi-service env (rationale in §6, D2).

## 4. HOW — Behavior

**Architecture.** Four touch points: the new agentic-drive primitive (the one genuinely new module), the docker-fixture helper (extracted/reused, not reinvented), the `LIVE_KINDS` registration, and cases + tests (mocked, mirroring every sibling kind).

**Agentic-drive primitive (new — the punted piece, `eval/live-driver.mjs` sibling or a new `eval/live-agent-driver.mjs`):**

```
PROCEDURE drive_holdout_live_rep(fixture, spec_dod, envHandle, model_or_agent):
  1. Stand up the container from `fixture` (image/args/port), wait for health (mirror
     test/holdout-evaluate-integration.test.mjs's up()/waitReady()/down() helpers — extract
     them to a shared eval/ helper rather than duplicating, since both the test and this
     driver need the identical up/wait/down shape)
  2. Build the evaluator's real rubric prompt via the EXISTING loadHoldoutJudgementProse
     (cli-driver.mjs, already extracted for holdout/holdout-exercise — reused verbatim, not
     re-cut) + spec_dod + the live endpoint
  3. Invoke the agentic-drive primitive (mechanism per the resolved Punt D1) so the model
     itself issues requests against the endpoint and derives each criterion's met/unmet
     (or needs-human, fail-closed on no bearing surface) — never a scripted/hardcoded
     exerciser (that would defeat the point: FAFF-317's own docker-gated integration test
     already proves scripted-exercise plumbing; this ticket proves the MODEL can do the
     deriving)
  4. Tear the container down on every exit path (success, error, timeout) — mirrors the
     env-compose "teardown on every path" invariant and the integration test's `finally`
  5. Return { env: { "holdout-exercise": {<criterion-key>: <class>} }, tokens }
```

**`LIVE_KINDS` registration (`eval/run-live-evals.mjs`):**

```
PROCEDURE register_holdout_live:
  1. Append "holdout-live" entry to LIVE_KINDS: { loader, driveCase }
  2. loader(): read eval/cases-live/holdout-live-*.json, filter c.kind === "holdout-live"
  3. driveCase: calls drive_holdout_live_rep per rep, catches errors into erroredRep
     (mirrors runLiveCase's existing catch — an adapter/model error lowers stability,
     never crashes the run)
```

**Cases (`eval/cases-live/holdout-live-00{1,2}.json`):** mirror `holdout-exercise`'s case design intent (≥1 distractor endpoint/path, a criterion needing correlated evidence, a prose criterion pinned `needs-human`, a "trap" — a response that *claims* success while a different observable signal shows failure) but expressed as **live container behaviour** instead of static recordings, so the model must actually issue the request rather than read a transcript.

**Tests (deterministic, `node --test`, zero model/docker spawns):** the loader, the `driveCase` normalisation, and the `LIVE_KINDS` registration are unit-testable with an injected mock agentic-drive function and a mock/stubbed container lifecycle (never a real `docker run`) — mirroring exactly how `reconciliation`/`routing`/`verdict-build` inject a mock `model` today. Only the CLI `main()` path (human-supervised) touches a real container or a real model.

**Failure modes.**

- **The agentic-drive primitive never lands** (Punt D1 resolves to "infeasible without new infra"). *How you'd know:* the build-time spike can't produce a tool-capable, scriptable invocation that returns structured output reliably. *What it means:* fall back to the documented default (§6 D1) — a bounded multi-turn completion loop (host executes the model's requested command, feeds the real response back, repeats) — which reuses the existing one-shot completion primitive without new tool-use infra, at the cost of a narrower "agentic" claim (host-mediated, not the model's own tool call).
- **Docker-in-eval flakiness.** Standing a container up per rep (times `BASE_REPS`→`MAX_REPS` escalation, times case count) is slower and flakier than reading a static fixture. *How you'd know:* rep-to-rep container-health timeouts inflate `erroredRep` counts unrelated to judgement quality. *What it means:* this is why the kind stays strictly human-supervised (never CI) and why a small, fast image (`http-echo`-class) is Chosen over a heavier multi-service stand-in for v1.
- **Premature investment if the trigger never fires.** See §6 D5 / §7 — building this before the recorded lane's baseline is even recorded risks funding a lane nothing yet shows is needed.

## 5. SCENARIOS

```
Given a holdout-live case whose container returns a body claiming success while a
      distinct health-check field shows failure (the trap, expressed live rather than recorded)
When the case is driven and the agentic drive classes that criterion "met"
Then the grade is FAIL — believing the live claim over the live counter-signal is the
     measured miss, exactly as holdout-exercise's recorded trap measures the same failure mode
```

```
Given a born-verifiable criterion with no endpoint/path the fixture container serves
When the drive classes it anything but "needs-human"
Then the grade is FAIL — fail-closed is pinned by the oracle, unchanged from holdout-exercise
```

```
Given the new "holdout-live" LIVE_KINDS entry
When eval/run-live-evals.mjs loads LIVE_KINDS
Then it normalises driveCase's return to the same { env, tokens } shape every sibling
     adapter returns, and grade(evalCase, env) runs the EXISTING holdout-exercise
     predictedSet arm unchanged (no new grade math)
```

Assertions: no new grade math (`holdout-live` grades via the existing `holdout-exercise` `predictedSet` arm / `pairsOf`/`setEqual` only); the adapter conforms to the documented `{loader, driveCase}` shape; `node --test` stays model-spawn-and-docker-spawn-free (only the CLI `main()` touches either).

## 6. DESIGN DECISION RATIONALE

**D1 — What is the agentic-drive invocation mechanism?** Options: (a) a true tool-capable agent session (e.g. the Claude Agent SDK's programmatic loop, or `claude -p` with a restricted tool allowlist scoped to the env's endpoint) that issues its own HTTP calls; (b) reuse/adapt `evaluate-call.mjs`'s injectable `spawnFn` contract with a new concrete implementation, shared with production dispatch; (c) a host-mediated multi-turn completion loop — the model requests a command in structured text, the host (not the model) executes it and feeds the raw response back as the next completion's input, repeated up to N turns — which needs no new tool-use infra, only reuses `makeLiveModel`'s existing completion primitive in a loop. **Punt:** this is a genuine build-time architecture question, not resolvable from prose alone — it depends on what tool-use surface is practically scriptable/non-interactive at build time, and whether (b)'s shared-primitive reuse is worth coupling this ticket to `evaluate-call.mjs`'s unrelated trust/attestation concerns (§2 explicitly keeps them decoupled). **Recommended default if the spike stalls:** (c) — it is the lowest-new-infra option, it is honestly *less* agentic than the SKILL.md's real procedure (a host-mediated loop vs. the model's own tool call), and that honesty should be recorded in the kind's own doc-comment if it's what ships. A build-time spike (timeboxed) should resolve this before the rest of the ticket is built, and record its outcome as a `**Chosen:**` in the implementation.

**D2 — How rich does the env fixture need to be for v1?** Options: (a) one or more tiny, single-response images (`hashicorp/http-echo`-class — verified: it serves one fixed `-text` body on its one `-listen` port, no per-path differentiation) — matches the existing docker-gated integration test precedent exactly, fast, simple to author; (b) a small purpose-built multi-endpoint fixture image closer to `holdout-exercise`'s distractor/trap richness. **Chosen:** (a) for v1, composed as **multiple small containers** (one `http-echo`-class container per logical "endpoint" a criterion needs, each on its own port with its own fixed response) rather than one multi-path container — `http-echo` cannot itself differentiate by path, so a distractor or a trap has to be a *separate* container/port standing in for a separate endpoint, not a route on one. This keeps the fixture family genuinely simple (no custom image to build) at the cost of one container per endpoint instead of one container total. **Punt:** whether that composition is rich enough to measure genuine *derive* ambiguity (vs. just *interpret*, the FAFF-284 gap FAFF-317 already closed) should be reassessed once the first cases are authored — if stacking fixed-response containers can't produce a case with real ambiguity, escalate to (b), a small purpose-built image, as a fast follow.

**D3 — Grading: new field vs. reuse `holdout-exercise`'s?** Reusing the exact `env["holdout-exercise"]` field name and grading arm (rather than inventing `env["holdout-live"]`) means the live kind's score is **directly comparable, no normalisation needed**, against the recorded kind's score — which is the entire point of building this (measuring whether the recorded lane's near-ceiling holds up live). **Chosen:** reuse verbatim; zero new grade math, consistent with FAFF-317's own D1/D3 pattern.

**D4 — Relationship to `evaluate-call.mjs`'s unfilled `spawnFn`.** Both this ticket and FAFF-384's production spawner need "a thing that launches an agentic evaluator against a live endpoint." **Chosen:** build this ticket's agentic-drive primitive scoped to the eval harness only, explicitly not wired into `evaluate-call.mjs`. The two consumers have different trust requirements (eval measurement has no adversarial party to defeat; production dispatch must spawner-attest code-blindness) and different cadences (human-supervised eval reps vs. a real per-issue merge gate) — coupling them now would import production trust machinery into a controlled measurement harness for no benefit. **Note for a human, not a gate:** if D1's spike lands on a genuinely reusable primitive, a follow-up ticket filling `evaluate-call.mjs`'s `spawnFn` from it is a natural, cheaper next step than building that primitive twice — flagged here so it's visible, not lost in this ticket's prose.

**D5 — Should this be built now, or should the recorded-lane baseline be run first?** FAFF-317 named an explicit trigger for funding this ticket ("the recorded lane baselines near-ceiling while real evaluator runs still misjudge") — and that baseline has never been run. **Assumes:** proceeding now is still reasonable because (a) the ticket is already filed as `faff-chain-gap-fill` + `faff-automate` with `appetite: high`, (b) the agentic-drive primitive (D1) is the long lead-time item and de-risking it doesn't require the baseline to exist first, and (c) once both this kind and a recorded baseline exist, the comparison FAFF-317 wanted becomes possible in either order. **Validation:** a human reviewing this spec at `medium` confidence should explicitly confirm this sequencing call — building the harness before checking whether the trigger fired is a legitimate bet on infrastructure lead time, not a free one, and it is exactly the kind of call this ticket's medium rating exists to surface (see the Methodology critique below).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:**

- **Punt (D1):** the concrete agentic-drive invocation mechanism — true tool-capable agent session vs. a shared `evaluate-call.mjs`-style spawner vs. a host-mediated completion loop. Resolve via a timeboxed build-time spike; default to the host-mediated loop if the spike stalls (§6 D1).
- **Punt (D2):** whether a single-image `http-echo`-class fixture family is rich enough to measure genuine derive-ambiguity, or needs to escalate to a multi-service family after the first cases are authored (§6 D2).

**Assumptions:**

- **Assumes:** proceeding with this ticket now, ahead of the recorded-lane (`holdout`/`holdout-exercise`) frontier baseline actually being recorded, is an acceptable sequencing bet given the ticket's chain-gap-fill provenance and high appetite (§6 D5). A human should confirm this explicitly rather than the ticket silently assuming it.
- **Assumes:** FAFF-380's externally-tracked bounded-nested-engine capability (closed 2026-07-11) is actually available in whatever environment a human runs this kind's real `main()` from — this ticket cannot verify an external dependency's runtime availability; a failed real run surfaces as a loud, named error (engine-unreachable), never a silent skip.
- **Assumes:** `plugin/skills/faffter-noon-evaluate/SKILL.md`'s exercise-step/met-unmet/prose-rule anchors stay stable (the existing `loadHoldoutJudgementProse` loader this ticket reuses is already fail-loud on a moved anchor, per FAFF-317).

## 8. DONE — Definition of Done

### From WHY
- [ ] A new agentic-drive primitive exists (module + tests) implementing whichever mechanism the build-time D1 spike resolves on, with its choice recorded as a `**Chosen:**` note in the module's own header comment
- [ ] The chosen mechanism is documented as reusable-or-not for `evaluate-call.mjs`'s `spawnFn` (D4) — a one-paragraph note is sufficient; wiring it there is explicitly not required

### From WHAT
- [ ] `LIVE_KINDS.holdout-live = { loader, driveCase }` registered in `eval/run-live-evals.mjs`, matching the documented adapter shape
- [ ] `driveCase` normalises to `{ env: { "holdout-exercise": {...} }, tokens }` — the existing grading field name and arm, no new grader code
- [ ] `eval/cases-live/holdout-live-001.json` (+ `-002.json`) exist: each carries a `fixture` (image/args/port/health_path), `spec_dod`, and a closed-set oracle; at least one case's fixture expresses a distractor and a trap live rather than recorded

### From HOW
- [ ] The docker up/wait/teardown lifecycle is a **shared helper** (extracted from or reused by both `test/holdout-evaluate-integration.test.mjs` and this driver) — not duplicated
- [ ] `loadHoldoutJudgementProse` (existing, FAFF-317) is reused verbatim for the rubric text — not re-extracted
- [ ] Teardown runs on every exit path (success, model error, container-health timeout)
- [ ] Mocked tests: the loader, `driveCase`'s normalisation, and the registration shape are covered with an injected mock agentic-drive function and a stubbed container lifecycle — zero real docker/model spawns in `node --test`
- [ ] `node --test` stays green with zero docker/model spawns from `eval/` imports (mirrors every sibling `LIVE_KINDS` entry)

### Eval coverage
- [ ] The `LIVE_KINDS` entry + its adapter + ≥2 cases land in this ticket (autonomous-doable); recording/accepting a real frontier baseline against a live docker env is the separate human-supervised step, not required here (mirrors FAFF-317's own DONE-exemption)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Import eval/run-live-evals.mjs → LIVE_KINDS.holdout-live is present with {loader, driveCase}
  2. loader() → both cases load and validate against the documented HoldoutLiveCase shape
  3. driveCase(case, { ...ctx, model: mockAgenticDrive }) → returns { env, tokens } in the
     documented shape (mock never touches docker or a real model)
  4. grade(case, { "holdout-exercise": <the oracle map> }) → PASS
     grade(case, { "holdout-exercise": <trap key flipped to "met"> }) → FAIL
  5. node --test → zero docker/model spawns, all green
```

## Already shipped against this surface

Five siblings in the same holdout-evaluator chain are Done, none of them delivering this ticket's specific ask (a live-lane `LIVE_KINDS` adapter) but each shipping a piece this spec reuses or relates to:

- **FAFF-317** (Done) — shipped the recorded-lane `holdout-exercise` kind + the grading path this ticket reuses verbatim (§6 D3). It is the ticket that named this one out of scope.
- **FAFF-384** (Done) — shipped the production `evaluate-call.mjs` spawner (envelope/attestation logic), explicitly leaving its agentic-engine `spawnFn` as an unfilled injection point — the same missing primitive this ticket needs, for a different consumer (§2, §6 D4).
- **FAFF-309 / FAFF-311** (Done) — wired the holdout evaluator into the production per-run and per-issue delivery gates. Unrelated to the eval-measurement harness this ticket extends; no overlap.
- **FAFF-275** (Done) — shipped the `holdout:` marker + `faff dod split`. Unrelated to this ticket's surface.
- **FAFF-380** (Done, external) — claude-box's bounded nested engine, the cage precondition this ticket's real (human-supervised) runs assume is available (§7 Assumes).

None of these substantially deliver FAFF-474's premise — the extension point they collectively left (`eval/run-live-evals.mjs` `LIVE_KINDS`) is still empty of any agentic/docker-driven kind. Premise still holds; proceeding per §1-§8 above.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** the ticket bundles one genuinely novel concern (the agentic-drive primitive, D1) with two well-understood reuse concerns (docker-fixture lifecycle, grading-shape registration). The novel concern is the entire reason this can't be a confident `high`-rated 1-3 day slice — a build-time spike with an unresolved outcome is exactly the kind of unknown a spec should surface, not paper over with a forced estimate. Recommend the build treats D1's spike as its own timeboxed first sub-step with an explicit go/no-go before committing to the rest of the ticket, rather than discovering mid-build that no tool-capable invocation is practically scriptable.
- **Value × risk (P2 + P7):** this is a **novel-integration risk** ticket by construction (a new invocation primitive against live infra, human-supervised only) — correctly de-risked here by making the fallback (a host-mediated completion loop) explicit rather than leaving "figure it out" implicit, and by explicitly declining to couple to `evaluate-call.mjs`'s production trust machinery (D4), which would have doubled the surface at risk. The sequencing question (D5) is the sharper risk finding: this ticket proceeds *ahead of* the very trigger condition FAFF-317 named for funding it. That is not wrong — chain-gap-fill discoveries with `faff-automate` + high appetite are meant to proceed — but it is a real value-sequencing call a human should see named plainly, not buried in prose. This is the confidence-`medium` finding, not a park reason: the architecture is soundly reasoned even where it is genuinely unresolved.
- **Surfaced deps (P6):** correctly built on Done siblings (FAFF-317 grading precedent, FAFF-384 spawner precedent even though decoupled, FAFF-380 external cage) with no missing blocker edges — FAFF-380 already carries a real `blockedBy`-shaped edge in the graph (closed), and this ticket's own env/evaluator reuse needs no new edge since both are Done. One finding: if D1's spike does produce a reusable primitive, the natural `evaluate-call.mjs` follow-up (D4) exists only as spec prose here — when this ships, file that follow-up and link it, exactly as FAFF-317 did for this ticket, so the chain stays tracker-visible.
- **Workstream fit (P1 + P5):** lands in "T4 — affidavits become attestations," the same outcome project as every ticket in this chain. Cohesive; no rehome.

confidence: medium

spec-review: approve
