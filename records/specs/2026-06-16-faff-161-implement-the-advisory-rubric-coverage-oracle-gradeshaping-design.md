# FAFF-161 — Advisory rubric-coverage oracle (`gradeShaping` / `gradeDecomposition`)

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Source: Linear FAFF-161 comment 6dc29e64-a386-4b47-8dcf-d1d6f57f5313.

**Methodology: faffter-dark-methodology-agile-delivery**

This is the nlspec design document for FAFF-161, for the build agent and human reviewers. It is the **build** of the generative-grading oracle whose **policy** FAFF-150 settled (advisory rubric-coverage — FAFF-150 §7/§9 **Chosen**, human decision 2026-06-15). The oracle policy is closed; this is a defined implementation, not an open product question.

## Provenance & prior art

- **FAFF-150** (MERGED, blocker) — settled the oracle policy: *advisory rubric-coverage, the `gradeGloss` model* — a mechanical `must_include`/`must_avoid` coverage fraction plus, for decomposition, structural assertions (*every proposed epic links to a parent project*, *no branch recurses past first-slice*, *dep links form a DAG*); any LLM judge strictly advisory per ADR-0004. Shipped the isolatable `modedetect` kind; carved THIS build to a follow-up (FAFF-150 §8).
- **FAFF-142 / FAFF-140** (Done) — `gradeGloss` + the synonym-set rubric this mirrors (`entryMatches`).
- **FAFF-147** (Done) — `gradeSplittable`: the synonym-folding + structural-set precedent.
- **FAFF-158** (Done, related) — the shared `makeLiveDriver` seam this extends (NOT re-cuts) for the live builders.
- **ADR-0004** — the load-bearing reported metric is mechanical; an LLM "is it good?" judge is advisory only, never the reported coverage.

## WHY

Jot/plot **ticket shaping** (a brief → a ticket-boundary set) and plot **decomposition** (a brief → an initiatives/projects/first-slice-epics tree) are pure generative judgement and entirely untested — yet they decide how every piece of new work enters the pipeline. FAFF-150 shipped graded coverage for the one isolatable surface (mode detection) and settled the oracle policy for these two generative surfaces, but deferred their build because a generative output has many valid forms (no exact-match oracle) and the policy call had to land first. That call is made. This ticket makes the two generative surfaces **measurable** under the agreed bar — mechanical coverage fraction + (for decomposition) structural assertions — so jot/plot generation gains an accuracy/flakiness signal like every other judgement surface, without ever putting an LLM on the load-bearing grading path.

## WHAT

Two new judgement-eval **kinds**, mirroring `gloss`, plus the live-driver parameterisation for faithful generative grading.

1. **`gradeShaping`** — a `gloss`-style mechanical coverage oracle over the model's emitted ticket-boundary set (`env.shaping`). Reported coverage = `must_include`/`must_avoid` synonym-set pass fraction. No structural assertions (shaping has no tree).
2. **`gradeDecomposition`** — the same coverage fraction over the emitted decomposition tree (`env.decomposition`), **ANDed with** three deterministic structural assertions evaluated mechanically over the tree: every proposed epic links to a parent project; no branch recurses past first-slice; dep links form a DAG (no cycle).
3. **Live-driver parameterisation** — two new prompt builders + two thin `makeLiveDriver` wrappers (`shapingLiveDriver` / `decompositionLiveDriver`), symmetric with the FAFF-158 routing wrapper. The shared core is **extended, not re-cut**.
4. **CLI black-box lane wiring** — `criteriaFor` + `modeInstructionFor` + `renderFixturePrompt` branches + two ENV instructions.
5. Two example cases per kind in `eval/cases/`, with hand-authored `must_include`/`must_avoid` oracles.

**Any LLM judge stays strictly advisory** — never the reported metric, never gates a grade.

## HOW (build notes)

- Add `shaping` + `decomposition` to `KINDS`, NOT `CLOSED_SET_KINDS` (generative, multi-valued — the `gloss`/`splittable` posture). Both carry their oracle in the existing `gloss_rubric` field.
- The decomposition **structural assertions** are a deterministic checker `structuralChecks(tree)`; the boolean vector appends to the coverage vector before computing the score.
- **Coverage is collection-level** (`gradeCoverage`): a generative output is a SET of many ticket glosses, so a must_include concept-set is covered if it appears in ANY item (per SCENARIO 1), not in EVERY item — distinct from `gradeGloss`'s single-gloss cross-product. `entryMatches` synonym folding reused verbatim; `gradeGloss` itself unchanged.
- Live: `buildShapingPrompt` / `buildDecompositionPrompt` fold jot/plot's verbatim rubric (anchored-slice, fail-loud) + the brief + the ENV instruction; thin wrappers over `makeLiveDriver`.

## DONE

- `shaping` + `decomposition` in `KINDS`; not in `CLOSED_SET_KINDS`.
- `validateCase` requires `oracle.gloss_rubric` for both kinds.
- `gradeShaping` / `gradeDecomposition` + `structuralChecks` (parent-link, stop-rule, DAG); each assertion in the vector.
- `grade()` routes both to PARTIAL/PASS-on-1 with a vector signature.
- Missing/malformed envelope/tree → clean low score, distinct signature, never a crash.
- `buildShapingPrompt` / `buildDecompositionPrompt` + `shapingLiveDriver` / `decompositionLiveDriver` as thin `makeLiveDriver` wrappers (core extended, not re-cut).
- `loadShapingProse` / `loadDecompositionProse` (anchored-slice, fail-loud) + two ENV instructions + the CLI branches.
- 2 example cases per kind; the decomposition dry-smoke exercises both a valid tree and structural-violation trees.
- A model-free dry-smoke test per kind (mock model → live wrapper → recorded bucket → grade).
- Existing kind baselines unchanged (additive only).
- `node --test` green; `eval/` still excluded.

## OUT OF SCOPE

- The **measured frontier baseline** (real `claude -p` reps, recorded accuracy/flakiness numbers) — a human-supervised follow-up, recorded out-of-band (FAFF-131/156/158 pattern). This ticket ships the oracle + drivers + dry-smoke.
- Wiring jot/plot into a real FAFF-93 harness seam end-to-end (a real jot/plot ThreadFixture/brief port is the live-run follow-up).
- A deterministic tree-oracle for decomposition (rejected by FAFF-150 §7 — advisory rubric-coverage is the standing bar).

---

> **Punt: per-case rubric authoring.** The exact `must_include`/`must_avoid` concept-sets for each example case are hand-authored human-oracle judgement. Authored inline by the build per the `gloss-001`/`gloss-002` precedent (resolved at high appetite).

> **Assumes:** the shipped jot/plot/intake SKILL.md carry a shaping rubric and a decomposition stop-rule/dep-rule prose section that `loadShapingProse`/`loadDecompositionProse` can anchor-slice. **Validated at build:** existing stable headers (jot §3→§4; plot §2→§4) suffice — no additive doc edit needed.

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" }
  ]
}
```
