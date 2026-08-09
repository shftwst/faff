# FAFF-240 — faff-map eval coverage (`roadmap` grader KIND)

_Resolution folded 2026-07-02: black-box eval, NOT a live-driver (the ADR-0004 lane). Feed a fixed seeded tracker fixture into faff-map's synthesis and score the output (chains, horizon ordering, gate-fireability) against a rubric answer key — no live model in the grading path. Reuse the existing seeded-tracker fixture substrate; a richer fixture only if a real gap shows up._

## WHY

`faff-map` synthesises the strategic roadmap: horizons/ordering, dependency-chain identification, and whether trigger gates can actually fire, over a tracker. Its structural floor (cycle/ghost-project detection) is deterministic and tested, but the **synthesis judgement** — does it identify the right chains and correctly read gate fireability over a seeded tracker — has no judgement-eval coverage. It joins the per-skill judgement-eval coverage family.

## WHAT

A grader `KIND` (`roadmap`) that scores faff-map's roadmap synthesis over a **seeded-tracker fixture** by collection-level rubric coverage: are the horizon groupings and dependency chains named, and is each trigger gate's fireability read correctly? This is the black-box lane — a fixed made-up roadmap in, an expected answer key (must-include / must-avoid concept sets) out. No live driver.

## HOW

- **KIND id:** `roadmap`. Added to `KINDS`; NOT in `CLOSED_SET_KINDS` (generative, multi-valued).
- **Oracle shape:** collection-level rubric coverage — the exact `architecture`/`specqual` precedent. The envelope carries `env.roadmap` = the synthesised roadmap's named chains + gate-readings (a `{id: text}` map OR a flat array). `grade()` delegates **byte-for-byte to `gradeCoverage`** (no new grade math): each `must_include` synonym-set is one check that passes if ANY item matches; each `must_avoid` one check that passes if NO item matches. PARTIAL on `[0,1)`, PASS on `1`, vector signature. A missing/garbage `env.roadmap` → empty collection → low score, never a crash.
- **Oracle field:** the existing `gloss_rubric` field (joins the architecture/specqual arm of `validateCase`'s exclusivity check).
- **FIXTURE_SHAPE:** `roadmap: ["issues"]` — a seeded tracker fixture (the `ordering`/`dupe` `issues[]` backlog shape, enriched with `blockedBy` edges + trigger-gate markers). `validateCase` asserts the field is present.
- **Registry:** `eval/seam-registry.json` gains `"roadmap": { "surface": "faff-map", "status": "covered" }` (grader asserts KINDS === registry keys — moved together).
- **Frontmatter:** `faff-map/SKILL.md` gains `judgement_seam: roadmap` (validate-adapters C1 reconciliation).
- **Fixtures (`eval/cases/roadmap-*.json`):** ≥2 — a seeded tracker whose correct synthesis names the A→B→C dependency chain and reads a blocked gate as un-fireable; `must_avoid` the anti-pattern (declaring a gate fireable when its upstream is unbuilt).

## Scenarios

1. **The dependency chain is identified.** `roadmap-001` (a tracker with a clear A blocks B blocks C spine) — an envelope naming the chain + spine concepts scores 1.0 PASS; one missing it PARTIAL.
2. **An un-fireable gate is read correctly.** `roadmap-002` (a trigger gate whose upstream is unbuilt) with `must_avoid: ["ready to fire","fireable now"]` — a synthesis that declares it fireable drops below 1.0.
3. **Lint sees coverage.** `faff validate-adapters` reports `roadmap` covered and `faff-map`'s `judgement_seam` reconciles.

## DONE

### Autonomous core (lint- + `node --test`-checkable)
- [ ] `roadmap` added to `KINDS`; `grade()` branch delegating to `gradeCoverage` over `env.roadmap`; `validateCase` `gloss_rubric` arm + `FIXTURE_SHAPE` `["issues"]` entry; grader loads clean.
- [ ] `eval/seam-registry.json` gains `"roadmap": { "surface": "faff-map", "status": "covered" }`.
- [ ] `faff-map/SKILL.md` declares `judgement_seam: roadmap`.
- [ ] ≥2 `eval/cases/roadmap-*.json` validate, covering chain-identification + a gate-fireability reading.
- [ ] `faff validate-adapters` exits 0; `node --test test/eval-grader.test.mjs` green.

### Human-only (CI-EXCLUDED)
- [ ] Human-supervised frontier baseline recorded. Cannot be satisfied autonomously — non-blocking follow-up, not a merge AC.

## Punt / Assumes

- **Resolved (was Punt):** black-box rubric-coverage KIND vs live-driver — the human Resolution settled it as **black-box** (ADR-0004 lane).
- **Assumes:** faff-map's synthesis prose is reducible to a coverage collection (named chains + gate-readings) the mechanical rubric scores — the same assumption `architecture`/`specqual` already ship on.
