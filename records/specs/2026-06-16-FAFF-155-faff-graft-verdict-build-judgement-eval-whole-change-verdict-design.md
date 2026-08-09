# faff-graft verdict-build judgement-eval — whole-change verdict over a real build (live-driver)

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-155.

This is the buildable spec for FAFF-155 (parent epic FAFF-145), addressed to the build agent extending the `eval/` judgement-eval harness, and to the human reviewers who gate it. FAFF-148 (PR #90, merged) shipped the *isolatable* half of the review-verdict surface — the revert-test classification of described findings (`verdict-revert`, black-box lane) — and **designed + carved** the *execution-entangled* half: the whole-change verdict over a real build. This issue completes that carved half: a live-driver that drives the `review` slot's `pass`/`fail`/`needs-human` judgement over a real change through the FAFF-93 harness, recording the `verdict-build` bucket the grader already knows. It is the third live-driver sibling, after FAFF-158 (routing) and FAFF-154 (reconciliation), and is built by mirroring them exactly.

## Already shipped against this surface

The harness this spec extends is shipped; the `verdict-build` kind is **registered but unexercised** (no prompt builder, no live-driver wrapper, no runner, no case, no `criteriaFor` wiring). Premise **holds** — these are reader context, not superseding work.

- **FAFF-148** (PR #90, Done) — shipped `verdict-revert` (black-box) + **this issue's inherited design**: the `verdict-build` kind in `KINDS`/`CLOSED_SET_KINDS`, the single whole-change `{pass,fail,needs-human}` oracle, and the live-driver-host Punt. This spec realises that design.
- **FAFF-158** (PR #92, Done) — extracted the shared `makeLiveDriver` core and wrote `routingLiveDriver` over it. **This issue adds a fourth wrapper over that same core** — it does not re-cut the seam.
- **FAFF-154** (PR #95, Done) — `reconciliationLiveDriver` + `driveReconciliationCase` runner + `cases-live/` + dry-smoke. **This is the structural template to mirror** (driver-config `fixture`, the `driveXCase` runner, `cases-live/`, the model-free dry-smoke). It also set the **single-author oracle** precedent for the carved children.
- **FAFF-135** (Done) — the live-driver via `runSkill`; **FAFF-158 already generalised it** (the faff-tidy hardcoding FAFF-148's spec warned about is gone), so the parameterisation FAFF-148 assumed this child would author **already exists** — this child only adds a wrapper.
- **FAFF-131 / FAFF-156** (Done) — the frontier-baseline pattern (ADR 0004): the measured `claude -p` reps are human-supervised, recorded out-of-band, never faked in CI. The standing baseline for this surface follows that pattern and is carved out.

## 1. WHY — Problem and Principles

**Problem statement.** The review slot's whole-change verdict — `pass` (auto-merge on green CI) / `fail` (iterate) / `needs-human` (flip to draft + park) — is a direct L2/L3 ship/iterate/escalate chokepoint, yet it has **zero execution-faithful eval coverage**: FAFF-148 covered only the isolatable revert-test classification of *described* findings on the black-box lane, which measures model+rubric+fixture and does not run the orchestrated skill over a real change. This change drives the *real* review judgement over a real diff/spec through `runSkill`, recording the `verdict-build` bucket so a regression in the whole-change verdict is caught by the same deterministic-grade net that already guards tidy/routing/reconciliation.

**Design principles.**

**Reuse the `makeLiveDriver` seam — never re-cut it.** FAFF-158 extracted the generic live-driver core precisely so a third (now fourth) execution-entangled surface is a *thin wrapper*, not a copy-paste of the `listIssues → buildPrompt → parseEnvelope → recordBucket` body. The header comment on `makeLiveDriver` (live-driver.mjs:140-142) already **names FAFF-155** as the wrapper that extends it. A `verdictBuildLiveDriver` that does anything other than configure `makeLiveDriver` is non-conformant.

**Eval only the genuine judgement, never the deterministic seam.** The mechanical layer — `signal` enum membership, malformed→`needs-human` coercion, the `fail`/`needs-human`-carry-≥1-finding rule — lives in `computeReviewVerdict` (`plugin/skills/faff/bin/faff`) and is already self-tested. This spec must not re-test any of it. The genuine judgement is the act of *assigning* a `pass`/`fail`/`needs-human` verdict to a real change.

**Faithful at the seam, fixture rides the config.** Mirroring both siblings: the harness exposes no review-fixture port, so the build/diff/spec/test-results fixture is passed as a **driver config field** (exactly as `reconciliationLiveDriver` and `routingLiveDriver` take `fixture`), and the driver still issues a `listIssues` seam-read so the run is seam-faithful at the harness boundary. This is the verified pattern, not a harness redesign.

**The measured frontier baseline is human-supervised — never run autonomously.** Per FAFF-131/156 (ADR 0004) and exactly as FAFF-154/158 did: the build ships the **model-free dry-smoke** (mock model → driver → recorded bucket → the existing grade path) plus the design; the standing `claude -p` baseline is a carved, human-supervised follow-up, recorded out-of-band.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/live-driver.mjs` | Node ESM | `makeLiveDriver` core + `reconciliationLiveDriver`/`routingLiveDriver`/`driveReconciliationCase` — the seam to extend and the wrappers to mirror |
| `eval/grader.mjs` | Node ESM | `verdict-build` already in `KINDS`/`CLOSED_SET_KINDS`; `validateCase` already accepts the single-element `{pass,fail,needs-human}` closed-set |
| `eval/cli-driver.mjs` | Node ESM | `loadReviewVerdictProse` (FAFF-148, already present) — the verbatim review-verdict rubric loader this driver reuses unchanged |
| `eval/run-evals.mjs` | Node ESM | `loadCases()` (black-box sweep — must NOT pick up the live case) + `loadLiveCases()` (the `cases-live/` loader) |
| `eval/cases-live/reconciliation-*.json` | JSON | The committed live-case shape to mirror for `verdict-build-*.json` |
| `test/eval-reconciliation-drysmoke.test.mjs` | Node ESM | The dry-smoke + runner test to mirror (lane-separation + PASS/FAIL/fail-safe halves) |
| `test/helpers/skill-harness.mjs` | Node ESM | `runSkill({ skill, tracker, repo, driver })`; `recordBucket(name, items)` is name-agnostic |
| `plugin/skills/faffter-noon-review/SKILL.md` + `plugin/skills/faff/SKILL.md` | Markdown | The verbatim verdict rubric + the gateway's fixed three-state contract `loadReviewVerdictProse` folds |
| `plugin/skills/faff/bin/faff` (`computeReviewVerdict`) | Node | The DETERMINISTIC layer — out of scope, named so it isn't re-tested |

**Scope statement.** This sits inside `eval/` as the live-driver wrapper + runner + a committed `cases-live/` fixture + a model-free dry-smoke for the already-registered `verdict-build` kind; it does not touch the review slot's runtime prose, the `faff contract` CLI, or the grader's verdict-build logic (already present).

## 2. OUT OF SCOPE

- **The measured frontier baseline (real `claude -p` reps + an ADR number)** — excluded. Why: recording the standing baseline is human-supervised (FAFF-131/156 pattern); an autonomous run cannot do it without faking it. Extension point: a carved `faff-automation-hold` follow-up child under FAFF-145, recorded out-of-band, mirroring FAFF-154/158.
- **Re-cutting or re-parameterising the live-driver core** — excluded. Why: FAFF-158 already extracted `makeLiveDriver`; this is a wrapper. Extension point: `makeLiveDriver` if a genuinely new core capability is needed (none is).
- **Re-testing the deterministic review-verdict contract** — excluded: the `signal` enum, the malformed→`needs-human` coercion, the ≥1-finding rule. Why: covered by `computeReviewVerdict` + its self-test. Extension point: `test/` unit tests against `bin/faff`.
- **The `verdict-revert` black-box surface** — excluded: shipped by FAFF-148. Extension point: `eval/cases/verdict-revert-*.json`.
- **The routing / reconciliation / confidence / marker surfaces** — excluded: their own tickets. Extension point: those tickets.
- **The delivery-outcome verdict (`shipped`/`not-ready`/`failed`)** — excluded: the ship slot's mirror verdict. Extension point: a future ship-verdict eval ticket under FAFF-145.
- **Driving the review slot via a full faff-graft Step-9 host** — excluded (see the host Chosen in §3). Why: the seam-faithful sibling pattern passes the fixture directly and issues a `listIssues` seam-read; a full graft-driven host is heavier with no faithfulness gain at this lane. Extension point: a later issue needing end-to-end graft-host fidelity.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Review verdict | One of `pass` / `fail` / `needs-human` assigned to a whole change by the `review` slot |
| Whole-change verdict | The single verdict over an entire diff (vs a per-finding call) — `verdict-build`'s judgement |
| Execution-entangled surface | A judgement that depends on real skill seams (a real diff/spec/test-results through `runSkill`) — needs the live-driver lane |
| `makeLiveDriver` core | The generic `listIssues → buildPrompt → parseEnvelope → recordBucket` seam (FAFF-158); each live surface is a thin config of it |
| BuildFixture | The diff/spec/test-results bundle a `verdict-build` case carries, passed as a driver-config field |
| Dry-smoke | The model-free CI test: a mock model emits a fixed envelope → driver → recorded bucket → the existing grade path; zero spawned processes |
| Frontier baseline | The standing `claude -p` rep measurement — human-supervised, recorded out-of-band, carved out |

**The already-registered grader contract (verbatim, no change needed).** `verdict-build` is in `KINDS` and `CLOSED_SET_KINDS`. `validateCase` already accepts a single-element `{pass,fail,needs-human}` `closed_set` for it. `predictedSet` has **no** `verdict-build` branch, so it falls to the `default` (reads `env.classifications[kind]`) — wrong for a single-verdict surface. This is the one grader touch: `verdict-build` reads `env.verdict` (the routing analogue — one verdict → a one-element set), so it joins the `routing`/`modedetect` arm of `predictedSet`.

**Type definitions.**

```
# verdict-build is ALREADY in ENUM Kind (grader.mjs). No KINDS change.

# The live case (mirrors cases-live/reconciliation-*.json), loaded by loadLiveCases(), NOT loadCases().
RECORD VerdictBuildCase:
  id: String                    # "verdict-build-NNN"
  kind: "verdict-build"
  fixture: BuildFixture         # passed to the driver as a config field (the sibling pattern)
  question: String              # e.g. "Review this change against its spec and return the verdict."
  oracle: { closed_set: [ Verdict3 ] }   # exactly one of {"pass","fail","needs-human"} — single-author

ENUM Verdict3: pass | fail | needs-human

# The diff/spec/test-results bundle. Self-contained prose the model reviews — NOT a real git worktree
# (see the fixture-shape Chosen below). version is the standard fixture-version stamp.
RECORD BuildFixture:
  version: 1
  change_summary: String        # one-line frame: what the change does
  spec: String                  # the (excerpted) committed spec the change is reviewed against
  diff: String                  # the unified-diff text of the change
  test_results: String          # the test outcome the reviewer reads (e.g. "all 14 pass" / "2 failing: …")
```

**The envelope (already routing-shaped).** The driver records a single-element `verdict-build` bucket; the model emits `{ "case_id": "<ID>", "verdict": "pass|fail|needs-human" }` — the **same `env.verdict` field routing uses**, so the grader's verdict-build branch reads it unchanged once added to `predictedSet`.

**Design decision — fixture shape: a self-contained described diff, not a real built git worktree.** **Chosen:** the described bundle (option b), passed as the driver-config `fixture`, with the driver issuing the `listIssues` seam-read for seam-faithfulness — exactly how `routingLiveDriver` and `reconciliationLiveDriver` ride the lane.

**Design decision — oracle: single whole-change closed-set over `{pass,fail,needs-human}`, single-author.** **Chosen:** single-element `closed_set` over `{pass,fail,needs-human}`, single-author, graded by `setEqual`.

**Design decision — the runSkill review-host: direct-over-fixture, not a full faff-graft Step-9 host.** **Chosen:** direct-over-fixture (option b), `skill: "faff-graft"` as the provenance tag (review is faff-graft's Step-9 phase). Punted on FAFF-148 only because the child wasn't scheduled; with the child now in build and the sibling pattern established, it is a settled engineering call, not a human product call — so **Chosen**, not re-Punted.

## 4. HOW — Behavior

**Architecture and approach.** A fourth thin wrapper over `makeLiveDriver` (`verdictBuildLiveDriver`), a `driveVerdictBuildCase` runner mirroring `driveReconciliationCase`, a `buildVerdictBuildPrompt` builder reusing the existing `loadReviewVerdictProse` rubric, one committed `cases-live/verdict-build-001.json`, the one-line grader touch (verdict-build joins the `env.verdict` arm of `predictedSet`), and a model-free dry-smoke. No `makeLiveDriver` change, no new core.

**The prompt builder (mirrors `buildRoutingPrompt`).**

```
PROCEDURE buildVerdictBuildPrompt(fixture, { pluginDir, caseId }):
  1. rubric = pluginDir ? loadReviewVerdictProse(pluginDir) (REUSED, unchanged) : "" (improvise control)
  2. render { change_summary, spec, diff, test_results } from the fixture
  3. append VERDICT_BUILD_INSTRUCTION (new const, mirroring ROUTING_MODE_INSTRUCTION)
```

**The live-driver wrapper (mirrors `routingLiveDriver` exactly).**

```
PROCEDURE verdictBuildLiveDriver({ model, fixture, pluginDir, caseId }):
  1. guard: model is a function; fixture has { spec, diff }, else throw
  2. return makeLiveDriver({
       model, skill: "faff-graft", pluginDir, caseId,
       buildPrompt: (ctx, opts) => buildVerdictBuildPrompt(fixture, opts),
       readEnvelope: (env) => [{ name: "verdict-build",
                                 items: env.verdict == null ? [] : [String(env.verdict)] }],
     })
```

**The runner (mirrors `driveReconciliationCase`).**

```
PROCEDURE driveVerdictBuildCase(evalCase, { runSkill, tracker, repo, model, pluginDir }):
  1. guard: evalCase.kind === "verdict-build" && evalCase.fixture; runSkill is a function; else throw
  2. driver = verdictBuildLiveDriver({ model, fixture: evalCase.fixture, pluginDir, caseId: evalCase.id })
  3. record = await runSkill({ skill: "faff-graft", tracker, repo, driver })
  4. return { record, bucket: record.buckets["verdict-build"] ?? [] }
```

**The grader touch (one line).** `verdict-build` joins `case "routing":` in `predictedSet` (`eval/grader.mjs`) — reads `env.verdict`, the routing analogue (one verdict → a one-element set). No eval-side coercion.

**Lane separation (the FAFF-154 property).** The case lives in `eval/cases-live/`, loaded by `loadLiveCases()`, provably **not** picked up by `loadCases()`'s black-box sweep.

## 5. SCENARIOS — born-verifiable main objectives

- A clean diff implementing its spec with all tests passing → model "pass" → bucket `["pass"]` → setEqual PASSES.
- A revert-reversible defect → model "fail" → bucket `["fail"]` → PASSES.
- An effect that persists after revert → model "needs-human" → bucket `["needs-human"]` → PASSES.
- The committed case is NOT among `loadCases()` kinds — reached only via `loadLiveCases()` + `driveVerdictBuildCase`.
- An out-of-enum/missing verdict → clean FAIL (no eval-side coercion), verbatim/empty bucket, distinct signature, no crash.

Non-functional assertions:

- The build reuses `makeLiveDriver` (a wrapper, ≤ the size of `routingLiveDriver`) — it does not re-cut the core.
- The build reuses the existing `loadReviewVerdictProse` rubric loader unchanged.
- A model-free dry-smoke proves the envelope→bucket→grade wiring with zero spawned processes; the measured frontier baseline is the carved human-supervised follow-up.
- The deterministic review-verdict contract (`computeReviewVerdict`) is not re-asserted by any new case.

## 6. DESIGN DECISION RATIONALE

- **Fixture shape:** Option B (described bundle via driver config). Rejected Option A (real `seedRepo` worktree + `git diff`) for adding machinery with no measurement gain.
- **Oracle authoring:** single-author. Not re-Punted — the family already settled it (FAFF-154).
- **Real-build oracle granularity:** single-element `closed_set` over `{pass,fail,needs-human}`, exact `setEqual`. Distance-tolerant grading rejected (a near-miss is a real miss given the hard fork).
- **runSkill review-host:** direct-over-fixture (`runSkill({ skill: "faff-graft", driver })`), mirroring both siblings. Settled as engineering, not Punted.
- **Frontier baseline:** carve to a `faff-automation-hold` follow-up child under FAFF-145, recorded out-of-band.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Punt: the measured `verdict-build` frontier baseline (real `claude -p` reps + the ADR 0004 addendum number) needs a human-supervised run — it is not produced by this autonomous build.** A human runs and records it when the carved `faff-automation-hold` follow-up child is scheduled. (Mirrors the identical Punt FAFF-154 and FAFF-158 carried.)

**Assumptions** (all verified): `makeLiveDriver` accepts a fourth wrapper with no core change; `loadReviewVerdictProse` is reusable unchanged; `runSkill` accepts `skill: "faff-graft"` and `recordBucket` is name-agnostic; the grader needs exactly one touch — `verdict-build` joins the `env.verdict` arm of `predictedSet`.

## 8. DONE — Definition of Done

- `verdictBuildLiveDriver` is a thin wrapper over `makeLiveDriver` — the core is reused, not re-cut or re-parameterised.
- No new case re-tests the deterministic review-verdict contract.
- The fixture rides the driver config; the driver issues a `listIssues` seam-read.
- The committed `eval/cases-live/verdict-build-001.json` carries a `BuildFixture` and a single-element `{pass,fail,needs-human}` `closed_set` oracle.
- `validateCase` accepts the case unchanged.
- `predictedSet` reads `env.verdict` for `verdict-build` — the one grader change.
- `buildVerdictBuildPrompt` folds the reused `loadReviewVerdictProse` rubric + rendered change material + a `VERDICT_BUILD_INSTRUCTION`.
- `verdictBuildLiveDriver` configures `makeLiveDriver` with `skill: "faff-graft"`; guards a missing model / malformed fixture.
- `driveVerdictBuildCase` binds the fixture into the wrapper, drives `runSkill({ skill: "faff-graft" })`, returns `{ record, bucket }`.
- The committed case is reached only via `loadLiveCases()` + `driveVerdictBuildCase`, provably NOT in `loadCases()`.
- A malformed/out-of-enum or missing verdict scores a clean FAIL (no eval-side coercion), records the verbatim/empty bucket, carries a distinct signature, does not crash.
- A model-free dry-smoke (`test/eval-verdict-build-drysmoke.test.mjs`) drives PASS on the correct verdict and clean-FAIL on a wrong one, zero spawned processes.
- A `faff-automation-hold` follow-up child under FAFF-145 captures the human-supervised `verdict-build` frontier-baseline run.

confidence: high
