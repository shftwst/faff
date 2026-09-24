# Spec: Fan the refutation-spec eval into four independent lens passes

> Spec: faffter-dark-nlspec · 2026-09-24 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-731.

**Artifact:** buildable spec for **FAFF-731** — rework the `refutation-spec` eval so a case is refuted by four *independent* per-lens passes, not one collapsed prompt. **Audience:** the build agent (implements against `eval/cli-driver.mjs` and its test), and human reviewers gating the one Punt. This ticket is STRUCTURE-only and blocks FAFF-878.

## 1. WHY — Problem and Principles

**The load-bearing model.** Production's spec-review runs each review lens as an *isolated* model pass with its own "break this spec" system prompt, and that isolation is the whole mechanism: four separate contexts decorrelate the lenses' blind spots. The eval that is supposed to measure this instead asks *one* model, in *one* completion, to play all four lenses at once — which re-correlates exactly the blind spots the design exists to separate. The eval measures a structure production never runs.

**Problem statement.** On `origin/main` the `refutation-spec` eval collapses all four lenses into a single `claude -p` prompt (`REFUTATION_SPEC_MODE_INSTRUCTION` + one summary rubric → one `faff-eval:judgement` block). FAFF-730's dogfood evidence isolates that collapse as the defect: infosec fire-rate on the required catch (case 007) is 30% collapsed vs 100% independent — same model, only structure changed. This ticket fans a case into one sub-pass per lens so the eval structurally mirrors production, then rolls the four refutations up with production's own deterministic aggregator.

**Design principles.**

**Independence is the thing under test — mirror it, do not summarise it.** The eval must spawn one real pass per enabled lens, each fed the full production `refute-<lens>.md` brief. A single pass enumerating lenses, or a lens fed a shortened "restraint" clause, reproduces the anti-pattern the eval is meant to catch. This is the exact rule `faffter-dark-spec-review/SKILL.md` states ("Run one pass per enabled lens — never a single pass enumerating all lenses to save tokens").

**Measure production's real deterministic code, not a re-implementation.** The parse and roll-up steps are the same deterministic code paths production ships (`parse-refutation.mjs`, `aggregate.mjs`). The eval reuses them by import, never a second copy — a divergent copy would silently drift and the eval would stop measuring production.

**Blast radius stops at the driver.** `run-evals.mjs`, `grader.mjs`, and the 16 case files are agnostic to how many model calls produced `env.objections`. The fan-out must still hand back exactly one merged `{ case_id, objections: [...] }` envelope, so those three stay untouched.

**No vestigial second path.** The collapsed-prompt code for this kind becomes dead once the fan-out lands. Dead code that describes a disproven structure is a trap for the next reader; it is removed in the same commit, not left behind guarded by a stale test.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/cli-driver.mjs` | JS (ESM) | Holds the collapsed state; the fan-out lives here (`makeCliDriver`, `buildInvocation`) |
| `test/eval-cli-driver.test.mjs` | JS (node:test) | Gates driver shape + the anchor registry; several assertions must be rewritten |
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` | JS (ESM) | `parseRefutation(content, lens)` — reused by import |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | JS (ESM) | `aggregate(refutations, nEnabled)` → `{ verdict, objections:[{lens,severity}] }` — reused by import |
| `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,methodology,qa}.md` | Markdown | The real per-lens system prompts; loaded verbatim as each sub-pass brief |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown | States the independence rule the eval currently violates |
| `eval/run-evals.mjs`, `eval/grader.mjs` | JS (ESM) | Consumers held invariant — read the merged envelope only |

**Scope statement.** This changes only the `refutation-spec` transport inside the eval driver; it is one branch of `makeCliDriver`'s closure, upstream of the grader and downstream of the case loader.

## 2. OUT OF SCOPE

- **Measuring production's adversarial backend chain.** The eval keeps `claude -p` against `models.eval` (opus). Whether the eval should instead measure the `adversarial.refs` chain (`spark-qwen-3-8` → openrouter-deepseek variants) that production actually runs is a second, orthogonal fidelity axis. Extension point: a new driver preset alongside `frontierOpts`/`localOpts` in `eval/cli-driver.mjs`, wired to `review-call.mjs`'s chain; owned by the Punt in section 7 and coupled to FAFF-878's calibration.
- **Accepting/recording the new frontier baseline.** The structure change moves the current numbers (0.806 acc / 0.814 stab). Recording a baseline is a human-supervised step, never gated by autonomous DONE. Extension point: FAFF-878 (the recalibration owner); this ticket only marks the prior baseline stale (see section 8).
- **The grader, the oracle format, and the 16 case files.** Agnostic to fan-out; the merged envelope shape is preserved. Extension point: `eval/grader.mjs` `refutation-spec` arms + `eval/cases/refutation-spec-*.json` — no change here.
- **The production spec-review skill itself.** This mirrors production; it does not modify `refute-<lens>.md`, `build-lens-requests.mjs`, `fan-out.mjs`, or `review-call.mjs`. Extension point: the `faffter-dark-spec-review` plugin skill, under its own tickets.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Lens | One of `architectural`, `infosec`, `methodology`, `QA` — an isolated refuter with its own `refute-<lens>.md` brief |
| Sub-pass | One `claude -p` invocation for one lens, against the shared spec |
| Fan-out | Replacing the single collapsed pass with N sub-passes (N = enabled lenses = 4) |
| Merged envelope | The single `faff-eval:judgement` JSON block the driver returns after aggregating the sub-passes |
| Refuter markdown | The `### [severity]: title` body format `refute-<lens>.md` instructs the model to emit, and `parse-refutation.mjs` parses |

**Type notation.**

```
RECORD SubPassResult:                # one per lens, before aggregation
  lens: Lens                         # the lens this pass covered
  rawText: String                    # the sub-pass's stdout (refuter markdown)
  parsed: Refutation                 # parseRefutation(rawText, lens)

# Refutation / aggregate() output — OWNED by production, imported not redefined:
#   parseRefutation(content, lens) -> Refutation { lens, objections:[{severity,...}], outcome }
#   aggregate(refutations, nEnabled) -> { verdict, objections:[{lens, severity}] }
#     severity mapping: critical->blocker, major->major, minor->minor, observation->dropped

RECORD MergedEnvelope:               # what the driver returns as rawText, then re-serialised
  case_id: String                    # evalCase.id verbatim
  objections: Array<{ lens: Lens, severity: "minor"|"major"|"blocker" }>   # = aggregate(...).objections
```

The driver's returned `rawText` is one fenced block tagged exactly `faff-eval:judgement` wrapping `MergedEnvelope` — byte-shape-identical to today's collapsed output, so `run-evals.parseJudgementEnvelope` and `grader.predictedSet` need no change. The merged envelope drops `aggregate()`'s `verdict` field (the grader's `refutation-spec` arm reads `objections` only).

**Design decisions (rationale in section 6; collected in section 7).**

- Fan-out placement. **Chosen:** a `refutation-spec` branch inside `makeCliDriver`'s closure, delegating to an injectable fan-out function.
- Parse/roll-up reuse. **Chosen:** import production `parseRefutation` + `aggregate`; never reimplement.
- Brief content. **Chosen:** the full `refute-<lens>.md` body per lens — that fidelity is the point; not a restraint sub-clause.
- Sub-pass transport. **Chosen:** `claude -p` on `models.eval` with the brief prepended into the prompt string; no dependency on a `claude -p --system` flag.
- Dead collapsed-path code. **Chosen:** remove it (mode instruction, `renderFixturePrompt` arm, `criteriaFor` arm, prose anchors) and rewrite the two shape tests in the same commit.
- Measured model axis. **Punt:** keep opus/`models.eval` (structure-only) or measure the production `adversarial.refs` chain — needs human (decides: qa). See section 7.

## 4. HOW — Behavior

**Architecture and approach.** Today the `refutation-spec` path is: `cliDriver` → `buildEvalPrompt(case, criteriaFor("refutation-spec"))` → one `spawnSync claude -p <one prompt>` → one `{rawText}`. The fan-out replaces the middle for this kind only:

```
cliDriver(evalCase, repIndex):
  IF evalCase.kind == "refutation-spec":
     return fanRefutationSpec(evalCase, { spawnFn, systemDir, opts, cfgDir })   # NEW branch
  ELSE:
     <unchanged: buildEvalPrompt -> buildInvocation -> spawnSync -> return {rawText, tokens}>
```

`fanRefutationSpec` is factored so the spawn is injected (mirroring `review-call.mjs`'s I/O-injection pattern), letting the structural test assert the four-pass shape with canned stdout and zero paid reps.

```
PROCEDURE fanRefutationSpec(evalCase, { spawnFn, systemDir, opts, cfgDir }):
  1. spec  <- evalCase.fixture.spec            # verbatim — MUST preserve any embedded `## Methodology critique`
  2. FOR EACH lens IN ["architectural","infosec","methodology","QA"]:
     a. brief   <- readFileSync(join(systemDir, `refute-${lens.toLowerCase()}.md`))   # real production brief
     b. prompt  <- `${brief}\n\nSpec:\n${spec}`                                        # brief drives output format
     c. inv     <- buildInvocation(opts, prompt, cfgDir)                               # same claude -p / models.eval / isolation
     d. res     <- spawnFn(inv.bin, inv.args, { env, cwd, encoding:"utf8", maxBuffer })
        IF res.error THROW `cli driver (${inv.bin}) lens=${lens}: ${res.error.message}`
     e. parsed  <- parseRefutation(res.stdout ?? "", lens)                             # production parser
     f. collect { lens, rawText: res.stdout, parsed }
  3. rolled  <- aggregate(collected.map(c => c.parsed), 4)                             # production roll-up, nEnabled=4
  4. envelope <- { case_id: evalCase.id, objections: rolled.objections }
  5. rawText  <- "```faff-eval:judgement\n" + JSON.stringify(envelope) + "\n```"
  6. RETURN { rawText, tokens: estimateTokens(join(all sub-pass stdouts)) }
```

**Isolation.** Each sub-pass reuses the existing per-rep `cfgDir` + `buildInvocation` env wiring (`CLAUDE_CONFIG_DIR`, clean cwd). The four sub-passes are independent completions — that independence is the structural fidelity, and it holds whether they share the rep's `cfgDir` or get one each; sharing the rep `cfgDir` is simplest and does not couple the completions.

**Methodology critique survives the fan-out.** The spec string is passed verbatim to every sub-pass, so case `refutation-spec-003`'s embedded `## Methodology critique` block reaches the methodology sub-pass exactly as `refute-methodology.md` expects. No special-casing.

**systemDir source.** `systemDir` resolves to `plugin/skills/faffter-dark-spec-review/` (the canonical location; the `eval/review-bench/lenses/refute-*.md` copies are byte-identical — verified — so either resolves identically, but pointing at the production plugin dir keeps the eval measuring the shipped brief).

**Removing the collapsed path (same commit).** Once the branch above is in, these `refutation-spec` artifacts in `eval/cli-driver.mjs` are unreachable and are deleted: `REFUTATION_SPEC_MODE_INSTRUCTION`; the `refutation-spec` arms of `modeInstructionFor` / `renderFixturePrompt` / `criteriaFor`; `loadRefutationSpecProse` + `REFUTATION_SPEC_PROSE_START` / `REFUTATION_SPEC_PROSE_END`. Deleting the two prose anchor consts drops one anchor-registry row and decrements both counts (start 31→30, end 30→29 on the origin/main baseline — read the actual pre-values in the tree and apply the −1/−1 deltas). The `refutation-code` path is untouched.

**Failure modes.**

- **The failure:** the four sub-passes are not actually independent — e.g. a shared process leaks one lens's context into the next, re-correlating them. **How you'd know:** the structural test asserts four distinct `spawnFn` calls with four distinct briefs; and the infosec-catch fire-rate on case 007 would sit at the collapsed ~30%, not ~100%, when re-measured. **What it means:** proceed only if the structural test proves four independent invocations; a low case-007 fire-rate at re-baseline means the fan-out did not decorrelate.
- **The failure:** a sub-pass emits output `parse-refutation.mjs` cannot parse, so its lens silently contributes no objection and the merged envelope under-counts. **How you'd know:** `parseRefutation` returns an unavailable/empty refutation; `aggregate`'s `nEnabled=4` majority math reflects a missing vote. **What it means:** proceed — this is production's own behaviour under an unavailable lens (aggregate handles it deterministically), so measuring it is correct.
- **The failure:** re-baseline is read as "the fan-out regressed accuracy" when the number simply moved because the structure changed. **How you'd know:** the delta is on cases where independence should help (required-infosec catches), not uniform noise. **What it means:** defer the judgement to FAFF-878; this ticket does not accept a baseline.

**Anti-pattern:** re-implementing `aggregate`'s roll-up inside the eval. Why: a second copy drifts from production and the eval stops measuring the code production runs — import it.

**Anti-pattern:** feeding a sub-pass a shortened "just check infosec, briefly" restraint clause instead of the full `refute-infosec.md`. Why: FAFF-730's closed PR #561 proved restraint injection craters required catches (case 007 0.80→0.28) — the full production brief is the fidelity.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refutation-spec case with a spec fixture
When the eval driver runs the case
Then it spawns exactly four claude -p sub-passes, one per lens, each prompt containing that lens's own refute-<lens>.md brief and the shared spec
```

```
Given four sub-passes have returned refuter markdown
When the driver aggregates them
Then it returns exactly one `faff-eval:judgement` block of shape { case_id, objections:[{lens,severity}] }, produced by the imported production aggregate(), with no code change required in run-evals.mjs or grader.mjs
```

- The four-independent-passes structure is asserted deterministically via the injected `spawnFn` call count (== 4) and per-call brief identity — no paid model reps in the gating test.

## 6. Design Decision Rationale

**How is the fan-out placed — driver-internal branch, or run-evals kind-aware fan-out?** A driver branch keeps `run-evals.mjs`, `grader.mjs`, and the cases untouched; a run-evals fan-out would leak lens-shape into the case runner and change its `driver(evalCase,repIndex)->{rawText}` contract, touching every driver preset. **Chosen:** driver branch, delegating to an injectable `fanRefutationSpec` — minimal blast radius, and the seam is testable.

**Reuse production `parse-refutation.mjs` + `aggregate.mjs`, or reimplement?** Reuse means the eval measures the exact deterministic parse/roll-up production ships; reimplement means a second copy that drifts. **Chosen:** reuse by import.

**Full `refute-<lens>.md` body per sub-pass, or a restraint sub-clause?** The full body is the identical adversarial system prompt production runs; a restraint clause re-introduces the summary the eval is meant to escape and was disproven by FAFF-730. **Chosen:** the full production body.

**Sub-pass transport — prepend the brief into the `claude -p` prompt, or rely on a `claude -p --system` flag?** Prepending mirrors how `buildEvalPrompt` already prepends `criteriaFor` output and depends on no unverified CLI flag; content fidelity (the brief text) is what matters, not the system-vs-user turn. **Chosen:** prepend the brief into the prompt string.

**The now-dead collapsed-path code — keep it or remove it?** Keeping leaves a vestigial description of the disproven structure; removing deletes the dead artifacts and rewrites the two shape tests in the same commit. **Chosen:** remove — the repo's code-smell standard forbids dead/duplicative paths, and a stale test guarding disproven code is a trap. Cost: rewrite the ~L427 and ~L488-495 tests, drop the `REFUTATION_SPEC_PROSE` registry row, decrement the anchor counts.

**Structural test without paid reps — how?** **Chosen:** factor `fanRefutationSpec` to take an injected `spawnFn`, so a test passes a fake returning canned refuter markdown and asserts four calls, per-lens brief identity, and the merged envelope — deterministically, no model spend.

**The new frontier baseline — re-baseline here or defer?** **Chosen:** defer recording/accepting the baseline to FAFF-878 (the recalibration owner); this ticket only flags the prior 0.806/0.814 baseline as stale. Recording a baseline is a human-supervised step, and the delta interpretation couples to FAFF-878's calibration.

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt:** Does this eval keep measuring opus via `claude -p`/`models.eval` (STRUCTURE-only, this ticket), or should it measure the actual `adversarial.refs` backend chain production runs (`spark-qwen-3-8` → openrouter-deepseek variants) via `review-call.mjs`? — needs human (decides: qa). Two orthogonal fidelity axes exist — STRUCTURE (collapsed→four-independent, owned here) and MODEL (measured backend). This ticket deliberately owns STRUCTURE only and does not silently change the measured model; the MODEL axis couples to FAFF-878's calibration and to whether the frontier baseline stays a valid comparison point. Recommended resolution: defer to FAFF-878. This is the sole reason confidence is `medium`.

**Assumptions.**

- **Assumes:** `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,methodology,qa}.md` exist and are the real per-lens system prompts. Validation: verified on `origin/main` HEAD `11327730` — all four present and byte-identical to the `eval/review-bench/lenses/` copies. Build agent re-checks the four files before wiring `systemDir`.
- **Assumes:** production `parseRefutation(content, lens)` and `aggregate(refutations, nEnabled)` are importable from `plugin/skills/faffter-dark-spec-review/{parse-refutation,aggregate}.mjs` and emit `{ verdict, objections:[{lens,severity}] }`. Validation: verified; import and unit-smoke before relying on it.
- **Assumes:** `claude -p <prompt>` accepts a prompt string carrying the full `refute-<lens>.md` body + spec within `maxBuffer`/arg limits, as the collapsed path already passes a rubric+spec prompt the same way. Validation: the collapsed path already does this; no new limit is introduced.

## 8. DONE — Definition of Done

Branch off `origin/main` (HEAD `11327730`); the local checkout is stale.

### From WHY
- [ ] The `refutation-spec` eval spawns one model pass per enabled lens (four), not one collapsed pass — asserted structurally.
- [ ] `run-evals.mjs`, `grader.mjs`, and `eval/cases/refutation-spec-*.json` are byte-unchanged.

### From WHAT (types and interfaces)
- [ ] The driver returns exactly one `faff-eval:judgement` block of shape `{ case_id, objections:[{lens,severity}] }` for a `refutation-spec` case.
- [ ] `objections` is produced by the imported production `aggregate()`; the grader's `refutation-spec` arm reads it unchanged.

### From HOW (behaviour)
- [ ] `fanRefutationSpec` spawns four sub-passes, each prompt = `refute-<lens>.md` body + the verbatim spec.
- [ ] Each sub-pass's stdout is parsed by the imported `parseRefutation(content, lens)`; the four are rolled up by `aggregate(refutations, 4)`.
- [ ] `fanRefutationSpec` takes an injected `spawnFn`, so the structural test drives it with canned stdout and zero paid reps.
- [ ] The spec string reaches every sub-pass verbatim, preserving an embedded `## Methodology critique` (case `refutation-spec-003`).

### From HOW (dead-path removal)
- [ ] `REFUTATION_SPEC_MODE_INSTRUCTION`, the `refutation-spec` arms of `modeInstructionFor`/`renderFixturePrompt`/`criteriaFor`, and `loadRefutationSpecProse` + `REFUTATION_SPEC_PROSE_START`/`_END` are deleted.
- [ ] The `REFUTATION_SPEC_PROSE` anchor-registry row is removed; the start-anchor count assertion goes 31→30 and the end-anchor count 30→29, in the same commit (read the actual pre-values and apply the −1/−1 deltas).
- [ ] `refutation-code` path is untouched.

### From tests
- [ ] `test/eval-cli-driver.test.mjs` line ~427 (`criteriaFor("refutation-spec").startsWith(...)`) and lines ~488-495 (`buildEvalPrompt(refutation-spec)` one-prompt shape) are rewritten to assert the fan-out structure.
- [ ] A new test asserts: four `spawnFn` calls; each carries a distinct `refute-<lens>.md` brief; the merged envelope shape is `{ case_id, objections }`.
- [ ] `test/eval-cli-driver.test.mjs`, the grader tests, and `oracle-triage.test.mjs` are green.

### Eval coverage
- [ ] No new grader `KIND` or seam is introduced (the `refutation-spec` seam already exists); this ticket changes the driver structure, not the judged seam. The prior frontier baseline (0.806 acc / 0.814 stab) is noted stale on the ticket; recording the new baseline is deferred to FAFF-878 and is NOT gated by this DONE.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. case <- load refutation-spec-003 (has embedded ## Methodology critique)
  2. spawnFn <- fake returning 4 canned refuter-markdown stdouts (one raises major infosec)
  3. out <- fanRefutationSpec(case, { spawnFn, systemDir=<spec-review plugin dir>, opts, cfgDir })
  4. ASSERT spawnFn called 4x; the methodology call's prompt CONTAINS "## Methodology critique"
  5. env <- parseJudgementEnvelope(out.rawText)
  6. ASSERT env.case_id == "refutation-spec-003" AND env.objections is an array of {lens,severity}
     AND grader.predictedSet(env, case) runs unchanged
```

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
