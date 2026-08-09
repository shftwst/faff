# FAFF-241 — faffter-noon-spec eval coverage (spec generation quality)

## WHY

`faffter-noon-spec` is the default `spec` producer and gates most builds, yet it is only covered **indirectly**: the `confidence` KIND scores its self-rating (not the spec body), and `shaping`/`decomposition` cover jot/plot, not spec generation. Nothing evaluates whether a *generated* lite-nlspec is actually good — the WHY/WHAT/HOW/DONE arc present and coherent, ACs testable (not vague), HOW buildable.

## WHAT

A grader `KIND` that judges a generated spec body against the lite-nlspec quality bar via rubric coverage: the four arc sections present, acceptance criteria phrased testably, HOW naming a concrete approach (no hand-waving). Distinct from `confidence` — this grades the **body**, not the self-rating.

## HOW

- **KIND id:** `specqual`.
- **Oracle shape:** collection-level rubric coverage (the `shaping` oracle). Envelope carries `env.specqual` = the generated spec's sections (a `{id: text}` map). `grade()` delegates to `gradeCoverage(env.specqual, c.oracle.gloss_rubric)`; `validateCase` routes `specqual` to the `gloss_rubric` field. NOT in `CLOSED_SET_KINDS`. (Reads the spec body, so it is the `confidence` complement — confidence reads `spec_body` for a level, specqual reads the generated output for quality.)
- **FIXTURE_SHAPE:** `"specqual": ["issue"]` — the issue + explore findings the producer specs from (the driver renders the producer's own rubric read verbatim from `faffter-noon-spec/SKILL.md`).
- **Registry entry:** `"specqual": { "surface": "faffter-noon-spec", "status": "covered" }`. `faffter-dark-nlspec` declares it too as the `spec`-slot sibling.
- **Frontmatter:** `faffter-noon-spec/SKILL.md` adds `specqual` to its `judgement_seam` (→ `confidence, marker, specqual`); `faffter-dark-nlspec/SKILL.md` likewise.
- **Fixtures (`eval/cases/specqual-*.json`):** ≥2 — an issue whose sound generated spec must include the arc anchors (`must_include: [["why"], ["what"], ["how"], ["done","acceptance"]]`) and testable-AC signals, and must avoid vagueness anti-patterns (`must_avoid: ["as appropriate","handle it","some way","TBD","etc."]`).

## Scenarios

1. **A coherent spec covers the arc.** `specqual-001` (a well-scoped issue) with `must_include` over the four arc sections + a testable-AC token → an envelope whose generated spec carries all four sections + a concrete AC scores 1.0 PASS; one missing HOW or with a vague AC PARTIAL. Born-verifiable via `node --test`.
2. **Vagueness is penalised.** `specqual-002` with `must_avoid: ["as appropriate","handle it"]` → a hand-wavy spec drops below 1.0.
3. **Lint sees coverage.** `faff validate-adapters` reports `specqual` covered and both spec producers' `judgement_seam` reconcile.

## DONE

### Autonomous core (lint- + `node --test`-checkable)
- [ ] `specqual` added to `KINDS`; `grade()` branch delegating to `gradeCoverage`; `validateCase` `gloss_rubric` arm + FIXTURE_SHAPE entry added; grader loads clean.
- [ ] `eval/seam-registry.json` gains `"specqual": { "surface": "faffter-noon-spec", "status": "covered" }`.
- [ ] `faffter-noon-spec` (and `faffter-dark-nlspec` as sibling) declare `judgement_seam` including `specqual`.
- [ ] ≥2 `eval/cases/specqual-*.json` validate, covering arc-coverage + a vagueness anti-pattern.
- [ ] `faff validate-adapters` exits 0; `node --test test/eval-grader.test.mjs` green.

### Human-only (CI-EXCLUDED)
- [ ] Human-supervised frontier baseline recorded. Cannot be satisfied autonomously.

## Punt / Assumes

- **Assumes:** distinguishing from `confidence` is clean — `confidence` grades the self-rating level (`oracle.closed_set`), `specqual` grades the body (`oracle.gloss_rubric`); different oracle fields, different envelope fields, no overlap.
- **Assumes:** spec-specific fixtures (not reused decomposition/shaping ones) — the arc-coverage rubric is spec-shaped, so authoring fresh `specqual-*` fixtures is cleaner than retrofitting jot/plot fixtures.

**Confidence (autonomous core): high** — a mechanical reuse of `gradeCoverage`; the confidence-distinction and fixture-authoring are both clear-cut. Only the human baseline remains (a Punt below, not a blocker).
