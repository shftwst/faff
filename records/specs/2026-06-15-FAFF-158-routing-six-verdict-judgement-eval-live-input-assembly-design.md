# FAFF-158 — routing six-verdict judgement-eval: live input-assembly (live-driver)

> Spec: faffter-dark-nlspec · 2026-06-15 · autonomous · confidence: high. Full spec on Linear FAFF-158.

This is the build spec for FAFF-158, completing the **execution-entangled half** of the `routing` judgement-eval that FAFF-149 carved out. FAFF-149 (MERGED, PR #91) shipped the `routing` kind grading verdict-assignment over a *pre-assembled, hand-authored* fixture-of-findings on the black-box lane. This child assembles the **real** routing inputs (diagnostics + confidence + markers + park-history) across a **live** `runSkill` pass via the FAFF-135 live-driver lane, and — as its load-bearing coordination obligation — generalises the faff-tidy-hardcoded live-driver into a **per-skill parameterisation seam** that the two sibling live-driver children (FAFF-154 prep-reconciliation, FAFF-155 graft verdict-build) later EXTEND rather than re-cut. Audience: the build agent extending `eval/`, and human reviewers checking the seam-generalisation and the live/deterministic scope line.

## Already shipped against this surface

The already-shipped scan (Done tickets in *Skill-behaviour harness*, matched on the `eval/live-driver.mjs` + routing/live-driver surface) found the enabling infrastructure and the inlined-rubric half, none of which assemble routing inputs live — the premise holds:

- **FAFF-149** (MERGED, the blocker — PR #91, commit d257147 on local main) — shipped the `routing` kind: `KINDS`/`CLOSED_SET_KINDS` registration, `predictedSet` reading `env.verdict`, the single-element `setEqual` grade path, `ROUTING_VERDICTS` + `admits()`, `loadRoutingVerdictProse` + `ROUTING_MODE_INSTRUCTION`, six `routing-*.json` cases (one per verdict), and the admission-rule assertion. This child is its explicit §6.D Chosen lane-split follow-up. The kind is **already registered**, so no grader change is needed here.
- **FAFF-135** (Done) — the live-driver for the skill-run harness: `liveDriver` + `buildJudgementPrompt` + `makeLiveModel` over `runSkill` (the FAFF-93 harness). This is the lane FAFF-158 rides and the seam it generalises.
- **FAFF-146** (Done) — already took the **first** generalisation step: its design note states "this is now ONE prompt builder among several; liveDriver takes a `promptBuilder` so the faff-tidy string is no longer the only option", and shipped `buildReconciliationPrompt` + `reconciliationLiveDriver` as the prep counterpart. FAFF-158 completes that generalisation into a single reusable seam, rather than cutting a third bespoke driver.
- **FAFF-131 / FAFF-151** (Done) — the frontier probe + ADR-0004 (and addendum): evals run on frontier as the standing gate; `eval/` is excluded from CI; a real K=20 run is human-supervised. This is the precedent for carving the measured baseline.
- **FAFF-148** (Done) — `verdict-build` is **registered-but-carved** to FAFF-155, naming the live-driver parameterisation as "shared with FAFF-146's reconciliation child" — the same shared-seam call this spec discharges.

No Done ticket assembles routing inputs across a live pass, and no Done ticket has unified the three live-driver builders behind one seam. The work is genuinely uncovered.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-149's `routing` eval grades verdict-assignment from a *hand-authored* fixture, so it never exercises the real input-assembly — reading a spec's confidence + markers, the methodology's `backlog-diagnostics` finding, conflict-analysis independence, and park-history — through the skill-run harness the way `/faff-tidy` / `/faff-beep-boop` actually do. This child adds a **routing live-driver** that assembles those inputs over a live `runSkill` pass and records the assigned verdict as a DecisionRecord bucket the existing `routing` grader scores unchanged. Because two sibling children need the same live-driver, the durable deliverable is a **shared per-skill parameterisation seam**, not a routing special-case.

**Design principles.**

- **Generalise the seam once; the siblings extend, never re-cut (the coordination invariant).** FAFF-158, FAFF-154, and FAFF-155 are three live-driver children off ONE faff-tidy-hardcoded driver. The load-bearing call: factor `liveDriver` into a small generic core — a driver parameterised by `{ skill, promptBuilder, readEnvelope, bucketName }` — so that the routing driver, the (existing) reconciliation driver, and the (future) verdict-build driver are all thin configurations of it. `liveDriver` (tidy) and `reconciliationLiveDriver` (prep) become wrappers over the generic core with no behaviour change. This is the *adoptable, not all-encompassing* tenet applied to the eval harness: one seam, three occupants. **Anti-pattern:** adding a third bespoke `routingLiveDriver` that copy-pastes the listIssues→buildPrompt→parseEnvelope→recordBucket body. Why: it is the exact duplication FAFF-149/148 explicitly told these three children to avoid, and it leaves FAFF-154/155 nothing to extend.
- **Scope to the live ASSEMBLY + the seam; never re-test the assignment judgement or the deterministic precedence.** The verdict-assignment *judgement* (which of the six an assembled fixture implies) is already evalled by FAFF-149's black-box cases. The deterministic precedence (`nextStep` / `faff next --selftest`) and the contract shape-check (`faff contract automation-routing`) are tool-tested. FAFF-158 adds only the *live input-assembly path* feeding the same `routing` kind — it neither re-grades the judgement nor re-tests the deterministic halves.
- **The frontier baseline is a human-supervised follow-up, recorded out-of-band, never faked (the FAFF-131/156 pattern).** Running real `claude -p` reps against the frontier model is recursive-claude-p + `~/.claude.json` config-race + cost territory that an unattended pass cannot reliably perform. As FAFF-149/146/147/148 all did, this spec ships a **model-free dry-smoke** (a mock model → the live-driver → the recorded bucket → the `routing` grade) as the standing CI-free wiring proof, and records the measured frontier baseline as a carved human-supervised follow-up. This bears on whether the eventual build reaches *shipped* vs *PR-open*, not on spec quality.
- **Seam-faithful, not black-box.** The live-driver reads the fixture through the harness tracker port and records at the harness seams (`recordBucket`), so the eval asserts the SAME structured DecisionRecord shape a scripted run does (ADR-0003). The model stays INJECTABLE — CI/tests pass a deterministic mock (zero spawn); `makeLiveModel` returns the real `claude -p` occupant.
- **Anchor rubric loaders on stable headers, fail-loud on drift.** The routing live-driver reuses `loadRoutingVerdictProse` (already anchored on the gateway + adaptor headers). No new loader is added; if one is, it follows the `loadTidyJudgementProse` fail-loud contract.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/live-driver.mjs` | JS (ESM) | The faff-tidy-hardcoded driver to generalise: `liveDriver`, `buildJudgementPrompt`, `reconciliationLiveDriver`, `buildReconciliationPrompt`, `makeLiveModel` |
| `eval/cli-driver.mjs` | JS (ESM) | `loadRoutingVerdictProse`, `ROUTING_MODE_INSTRUCTION`, `buildInvocation`, `forwardCredentials`, `DEFAULT_PLUGIN_DIR` — reused by the routing prompt builder + the real model |
| `eval/grader.mjs` | JS (ESM) | `CLOSED_SET_KINDS` (already contains `routing`), `predictedSet` reading `env.verdict`, `ROUTING_VERDICTS`, `admits` — the grade path, **unchanged** |
| `eval/envelope.mjs` | JS (ESM) | `parseJudgementEnvelope` — the generic envelope; `verdict` passes through unchanged |
| `test/helpers/skill-harness.mjs` | JS (ESM) | `runSkill` + the `{ kind, drive(ctx) }` SkillDriver interface + `recordBucket` — the seam the live-driver records at |
| `test/eval-live-driver.test.mjs` | JS (ESM) | The mock-model live-driver test pattern this extends (zero spawn) |
| `eval/cases/routing-*.json` | JSON | The six inlined-rubric fixtures FAFF-149 shipped — the assembled-finding shape the live path mirrors |

**Scope statement.** A routing live-driver under FAFF-145's *Judgement-eval coverage*, completing FAFF-149's carved execution-entangled half and landing the shared live-driver seam FAFF-154/155 extend.

## 2. OUT OF SCOPE

- **The measured frontier baseline run.** Name: actually running ~K=20 frontier `claude -p` reps and recording the numbers. Why excluded: human-supervised (FAFF-131/156 pattern) — recursive-claude-p + config-race + cost; an unattended run cannot reliably perform it and must not fake it. Extension point: a `records/adr/0004-*.md` addendum or report entry, run via `node eval/run-evals.mjs`; filed as the carved human-supervised follow-up.
- **The FAFF-154 prep-reconciliation live RUN and FAFF-155 verdict-build live RUN.** Name: the sibling children's end-to-end runs (thread fixtures + human oracle for 154; real diff/build measurement for 155). Why excluded: separate tickets. FAFF-158 ships the SEAM they consume + the routing occupant only. Extension point: the generic live-driver core this spec lands — 154 re-points its existing `reconciliationLiveDriver` onto it; 155 adds a `verdictBuildLiveDriver` over it.
- **Any grader / KINDS change.** Name: registering a new kind or grade branch. Why excluded: `routing` is already in `KINDS` + `CLOSED_SET_KINDS` and grades `env.verdict` by single-element set-equality — FAFF-149 shipped it. The live path emits the SAME envelope field. Extension point: none needed — `eval/grader.mjs` is untouched.
- **The deterministic precedence + contract shape-check.** Name: `nextStep` (`faff next`) and `faff contract automation-routing`. Why excluded: pure functions already self-tested (`faff next --selftest`, the automation-routing selftest). Extension point: `bin/faff`.
- **`backlog-diagnostics` DETECTION.** Name: computing cycles / ghost-projects / repeat-park counts. Why excluded: detection is the methodology's job (FAFF-147/152), not the routing assignment. The live fixture *carries* the detection finding (as the black-box cases do); the driver assembles it into the prompt, it does not compute it. Extension point: the methodology slot.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| live input-assembly | Reading the routing-assignment inputs (spec confidence + markers + the `backlog-diagnostics` finding + conflict independence + park-history) through the harness and rendering them into the model prompt across a live `runSkill` pass — vs FAFF-149's hand-authored inline fixture. |
| generic live-driver core | A single parameterised SkillDriver factory `{ skill, promptBuilder, readEnvelope, bucketName }` that `liveDriver` / `reconciliationLiveDriver` / `routingLiveDriver` all configure. The shared seam. |
| routing fixture-of-findings | The assembled assignment inputs: `{ issue, spec:{confidence,markers}, diagnostics, conflict, park_history }` — the same shape as `eval/cases/routing-*.json`, read through the harness rather than inlined into the prompt by hand. |

**Type definitions.**

```
# The generic core (the shared seam). All three live drivers are configurations of it.
RECORD LiveDriverConfig:
  model: (prompt: string) -> Promise<string>   # REQUIRED; inject a mock in CI, makeLiveModel for real
  skill: string                                 # provenance tag on the DecisionRecord (e.g. "faff-prep", "faff-tidy")
  buildPrompt: (ctx, opts) -> string            # per-skill prompt builder (buildJudgementPrompt | buildReconciliationPrompt | buildRoutingPrompt)
  readEnvelope: (env) -> Array<{name, items}>   # per-skill envelope→bucket reducer (one pair, or many for tidy)
  bucketName: string                            # default bucket name a single-pair reducer may omit
  pluginDir: string|null = DEFAULT_PLUGIN_DIR
  caseId: string = "live"

PROCEDURE makeLiveDriver(cfg) -> { kind: "live", drive(ctx) }   # the generic core

# The routing occupant — a thin configuration of the core.
RECORD RoutingFixture:
  issue: { id, title, status }                  # read through ctx
  spec: { confidence: "high"|"medium"|"low", markers: [{ section_key, class }] }
  diagnostics: { in_cycle: bool, ghost_project_or_missing_dep: string|null }
  conflict: { independent: bool, collision_group: string[] }
  park_history: [{ root_cause }]                # >=3 same-class → repeat-parked branch

PROCEDURE buildRoutingPrompt(fixture, { pluginDir, caseId }) -> string
  # folds loadRoutingVerdictProse(pluginDir) (verbatim rubric) + the rendered fixture-of-findings
  # + ROUTING_MODE_INSTRUCTION (asks for exactly one of the closed six in `verdict`)
PROCEDURE routingLiveDriver({ model, fixture, pluginDir, caseId }) -> { kind: "live", drive(ctx) }
  # = makeLiveDriver({ skill: "faff-tidy", buildPrompt: routing,
  #     readEnvelope: env => [{ name: "routing", items: env.verdict ? [String(env.verdict)] : [] }] })
```

**Envelope.** The routing live path emits the SAME field the black-box routing path does: `{ "case_id": "<ID>", "verdict": "<one of the six>" }`. `parseJudgementEnvelope` passes `verdict` through unchanged; the driver records `[verdict]` as a single-element `routing` bucket — which the grader's `predictedSet` (`case "routing": [String(env.verdict)]`) already scores by `setEqual`.

**Design decisions.**

- Parameterisation shape: a config-object factory `makeLiveDriver({ skill, buildPrompt, readEnvelope, bucketName })` vs a positional-arg variant vs a class. **Chosen:** the config-object factory — it matches the existing `liveDriver({ model, pluginDir, caseId })` call style, makes the three occupants self-documenting one-liners, and keeps `recordBucket`'s name-agnosticism (a bucket name is just a string the harness records). See §6.
- Whether the routing live-driver reads the fixture from `ctx` or a passed `fixture` arg. **Chosen:** mirror `reconciliationLiveDriver` exactly — take `fixture` as a config field and still issue a `ctx.tracker.listIssues({})` read so a `trackerRead` seam is recorded (seam-faithful), reading the assembled findings from the passed fixture. This is what the existing reconciliation driver does (the harness exposes no `routingFixture` port yet) and keeps the two siblings symmetric. See §6.
- Whether to register a new eval *kind* or new grader branch. **Chosen:** neither — reuse the registered `routing` kind and its `env.verdict` grade path verbatim. Rationale: FAFF-149 shipped the kind specifically so "that future case validates with no grader change" (grader.mjs comment). See §6.

## 4. HOW — Behavior

**Architecture.** Factor the duplicated live-driver body out of `liveDriver` and `reconciliationLiveDriver` into `makeLiveDriver(cfg)`. The body is identical in shape for all three: read through the tracker seam, build the per-skill prompt, call the injected model, parse the envelope, reduce it to bucket pairs, record each. Each public driver becomes a thin wrapper that supplies its `buildPrompt` / `readEnvelope` / `skill`.

```
PROCEDURE makeLiveDriver({ model, skill, buildPrompt, readEnvelope, bucketName, pluginDir, caseId }):
  1. IF typeof model != "function": THROW "requires a model(prompt) function (mock in CI; makeLiveModel for real)"
  2. RETURN { kind: "live",
       async drive(ctx):
         a. ctx.tracker.listIssues({})                     # records a trackerRead seam (seam-faithful)
         b. const prompt = buildPrompt(ctx, { pluginDir, caseId })
         c. const raw = await model(prompt)
         d. const env = parseJudgementEnvelope(raw, { expectedCaseId: caseId })
         e. for ({name, items} of readEnvelope(env)): ctx.record.recordBucket(name ?? bucketName, items)
     }

# liveDriver (tidy) and reconciliationLiveDriver (prep) re-expressed as wrappers — NO behaviour change:
#  - tidy:  readEnvelope returns one pair PER populated CLOSED_SET_KIND + ordering (multiple buckets)
#  - prep:  readEnvelope returns one { name:"reconciliation", items:[id:label,…] } pair
#  - routing: readEnvelope returns one { name:"routing", items:[verdict] } pair
PROCEDURE routingLiveDriver({ model, fixture, pluginDir, caseId }):
  guard fixture has { issue, spec }  # mirror validateCase's routing FIXTURE_SHAPE
  RETURN makeLiveDriver({ model, skill: "faff-tidy", pluginDir, caseId,
    buildPrompt: (ctx, o) => buildRoutingPrompt(fixture, o),
    readEnvelope: env => [{ name: "routing", items: env.verdict == null ? [] : [String(env.verdict)] }] })
```

**Behavior summary.** A routing live-driver run reads the assembled fixture-of-findings through the harness, prompts the injected model with faff's verbatim routing rubric + the rendered findings, parses the single assigned verdict, and records it as a one-element `routing` bucket the existing grader scores PASS/FAIL against the case oracle.

**Edge cases and error handling.**

- **The tidy driver records multiple buckets; routing/reconciliation record one.** `readEnvelope` returning a *list of {name, items} pairs* expresses both: the multi-bucket tidy case (one pair per `CLOSED_SET_KIND` + `ordering`) and the single-bucket routing/reconciliation cases (one pair). This keeps ONE core for all three without special-casing tidy.
- **Missing / out-of-enum verdict.** `readEnvelope` yields `items:[]` for a missing `verdict` → an empty `routing` bucket → the grader's `setEqual` FAILs cleanly (never throws). An out-of-enum token passes through verbatim → a clean FAIL with a distinct signature (the eval-side fail-safe; deterministic coercion lives in `faff contract automation-routing`, NOT here).
- **Mis-tagged envelope.** `parseJudgementEnvelope`'s classify-fallback recovers a `verdict`-bearing block fenced as ```json (flagged `noncompliant`), exactly as the black-box path.
- **No real spawn on import.** Importing `eval/live-driver.mjs` spawns nothing; only calling `makeLiveModel`'s returned fn spawns `claude -p`. `eval/` stays out of `node --test`.

**Anti-pattern:** widening `makeTrackerPort`'s READ_METHODS or adding a bespoke `routingFixture` harness port. Why: the reconciliation driver already proved a passed-`fixture` arg + a plain `listIssues` seam-read is sufficient; a new port is harness churn FAFF-154/155 would inherit.

## 5. SCENARIOS

```
Given the generic makeLiveDriver core and a routing fixture-of-findings whose inputs imply fire-and-forget
When a routingLiveDriver configured with a MOCK model returning { verdict: "fire-and-forget" } drives runSkill
Then the DecisionRecord carries a single-element `routing` bucket ["fire-and-forget"] recorded at the harness seam, and a trackerRead seam is present
```

```
Given liveDriver (tidy) and reconciliationLiveDriver (prep) re-expressed as wrappers over makeLiveDriver
When the existing FAFF-135/146 live-driver tests run unchanged
Then they still pass — the generalisation is behaviour-preserving (the tidy multi-bucket record and the prep id:label record are unchanged)
```

```
Given a routing live fixture and a mock model returning a wrong-but-in-enum verdict
When the recorded bucket is graded against the case oracle via the existing routing grade path
Then it scores a clean FAIL with a stable distinct signature, with no grader change and no crash
```

```
Constraint: no real claude -p process is spawned by any test in this issue (the frontier baseline is human-supervised, recorded out-of-band).
Constraint: eval/grader.mjs and eval/cases/routing-*.json (the FAFF-149 black-box artefacts) are unchanged by this issue.
```

## 6. DESIGN DECISION RATIONALE

**How to satisfy "coordinate ONE parameterisation refactor, not three"?**
Options: (a) a generic `makeLiveDriver(cfg)` core all three configure; (b) three independent bespoke drivers; (c) a base class with subclass overrides.
**Chosen:** (a) the generic config-object core. Rationale: FAFF-149 and FAFF-148 both explicitly directed the three live-driver children to share one parameterisation; FAFF-146 already started it ("ONE prompt builder among several; liveDriver takes a promptBuilder"). (a) finishes that line — `liveDriver`/`reconciliationLiveDriver` become wrappers, `routingLiveDriver` is a third wrapper, and FAFF-154/155 re-point onto / add a wrapper to the same core. (b) is the named anti-pattern. (c) adds an inheritance layer the functional codebase avoids.

**Per-skill envelope reducer returns pairs, not a flat list?**
Options: single `bucketName` + flat items; or `readEnvelope -> [{name, items}, …]`.
**Chosen:** the pairs form. Rationale: the tidy driver records *multiple* buckets (each `CLOSED_SET_KIND` + `ordering`); routing/reconciliation record one. Pairs express both; a single-bucket reducer returns one pair. This is the only shape that lets ONE core absorb the existing multi-bucket tidy driver — otherwise tidy stays bespoke and the "one seam" goal is missed.

**Read the fixture from `ctx` or a passed arg?**
**Chosen:** a passed `fixture` arg + a `listIssues` seam-read, mirroring `reconciliationLiveDriver`. Rationale: the harness has no routing-fixture port; the reconciliation driver established the passed-fixture + plain-read pattern; symmetry across the two siblings keeps FAFF-154's eventual re-point trivial.

**Register a new kind / grade branch?**
**Chosen:** no — reuse `routing` + `env.verdict`. Rationale: FAFF-149 registered `routing` precisely so the live half "validates with no grader change" (grader.mjs §FAFF-149 comment). The live path emits the identical envelope field.

**Frontier baseline — autonomous or human-supervised?**
**Chosen:** human-supervised, out-of-band, never faked; ship a model-free dry-smoke as the standing wiring proof. Rationale: the FAFF-131/146/147/148/149 precedent — real `claude -p` reps are recursive-claude-p + config-race + cost territory. At time of writing an unattended faff run cannot reliably record a frontier baseline; this is a delivery-state note (PR-open vs shipped), not a spec gap.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. (The lane-split, the seam shape, the grade reuse, and the baseline carve are all settled by the FAFF-149/146/148 precedent and the issue's explicit coordination directive.)

**Assumptions.**

- **Assumes:** `eval/grader.mjs` already registers `routing` in `KINDS` + `CLOSED_SET_KINDS` and grades `env.verdict` by single-element set-equality. Validation: `grep "routing" eval/grader.mjs` shows it in both sets and in `predictedSet`'s switch (verified present at spec time on local main, commit d257147).
- **Assumes:** `recordBucket` is bucket-name-agnostic (records any string name), so `"routing"` needs no harness change. Validation: `test/helpers/skill-harness.mjs` `recordBucket(name, issues)` — confirmed name-agnostic at spec time.
- **Assumes:** `eval/` stays excluded from `node --test` globs, so no test spawns a real model. Validation: the new dry-smoke + wiring tests run under `node --test` with a mock model only; `makeLiveModel` is constructed-not-called in tests.
- **Assumes:** `loadRoutingVerdictProse` + `ROUTING_MODE_INSTRUCTION` (FAFF-149, in `eval/cli-driver.mjs`) are importable by `buildRoutingPrompt`. Validation: both are exported; `buildReconciliationPrompt` already imports the analogous `loadReconciliationProse` from `cli-driver.mjs`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A routing live-driver assembles the routing inputs (issue + spec confidence/markers + diagnostics + conflict + park-history) through the harness and records the assigned verdict as a `routing` bucket.
- [ ] The faff-tidy-hardcoded live-driver is generalised into one shared parameterised core; `liveDriver` and `reconciliationLiveDriver` are re-expressed as wrappers over it with no behaviour change.

### From WHAT (types and interfaces)
- [ ] `makeLiveDriver({ model, skill, buildPrompt, readEnvelope, bucketName, pluginDir, caseId })` exists and returns `{ kind: "live", drive(ctx) }`.
- [ ] `buildRoutingPrompt(fixture, opts)` folds `loadRoutingVerdictProse` (verbatim) + the rendered fixture-of-findings + `ROUTING_MODE_INSTRUCTION`; `pluginDir:null` omits the rubric (the baseline control).
- [ ] `routingLiveDriver({ model, fixture, pluginDir, caseId })` records a single-element `routing` bucket `[verdict]` and guards a missing `model` and a malformed routing fixture (missing `issue`/`spec`).
- [ ] The recorded verdict is the same `verdict` envelope field the existing `routing` grade path reads — `eval/grader.mjs` and `eval/cases/routing-*.json` are unchanged.

### From HOW (behaviour)
- [ ] `readEnvelope` returns `{name, items}` pairs so the multi-bucket tidy driver and the single-bucket routing/reconciliation drivers share the one core.
- [ ] A missing/out-of-enum `verdict` yields an empty/verbatim bucket → a clean grader FAIL, never a throw.
- [ ] Importing `eval/live-driver.mjs` spawns no process; only calling `makeLiveModel`'s returned fn spawns `claude -p`.

### From HOW (edge cases)
- [ ] The existing FAFF-135/146 live-driver tests (`test/eval-live-driver.test.mjs`) pass unchanged against the refactored core.
- [ ] No test in this issue spawns a real `claude -p` process.

### Carved follow-up (NOT done-here — human-supervised)
- [ ] A measured frontier baseline for the routing live-driver is recorded out-of-band (FAFF-131/156 pattern), filed as discovered-scope — explicitly NOT discharged autonomously and NOT faked.

**Integration smoke test:**

```
PROCEDURE dry_smoke_routing_live (model-free, no spawn):
  1. load a routing fixture-of-findings (issue + spec + diagnostics + conflict + park_history) implying e.g. fire-and-forget
  2. driver = routingLiveDriver({ fixture, model: async () => '```faff-eval:judgement\n{ "case_id":"live", "verdict":"fire-and-forget" }\n```' })
  3. rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver })
  4. ASSERT rec.driver == "live" AND rec.buckets.routing == ["fire-and-forget"] AND a trackerRead seam present
  5. grade the bucket against an oracle { closed_set: ["fire-and-forget"] } via the existing routing path → PASS; a wrong verdict → clean FAIL
```

confidence: high

---
> _Provenance: produced autonomously by faff-prep (run 2026-06-15-beep-boop-22-32-30) via the faffter-dark-nlspec spec slot. Premise verified against MERGED blocker FAFF-149 (PR #91, commit d257147 on local main). Confidence self-rated **high**; no open Punts. The "measured frontier baseline" acceptance item is a known human-supervised follow-up (FAFF-131/156 pattern) carved to OUT OF SCOPE — it does not gate the build's deterministic, model-free DONE._
