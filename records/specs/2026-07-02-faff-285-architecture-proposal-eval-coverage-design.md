# FAFF-285 — Architecture-proposal eval coverage

## WHY

`faffter-noon-architecture` (FAFF-27) makes a genuine, high-blast-radius judgement call: it reads the infra profile + brief and **proposes one best-fit architecture** with founded rationale, ADR candidates, and assumptions. A wrong-but-confident architecture choice (or hallucinated ADR candidates / unfounded assumptions) propagates into the whole build. It has no judgement-eval coverage.

## WHAT

A grader `KIND` that scores proposal quality against a rubric: given an infra-profile + brief fixture, does the proposal stay build-biased / production-grade / best-fit, and are the ADR candidates + assumptions well-founded rather than fabricated? This is a rubric-coverage oracle exactly like `gloss`/`shaping` — a collection of concepts that must appear (and anti-patterns that must not), not a closed verdict.

## HOW

- **KIND id:** `architecture`.
- **Oracle shape:** collection-level rubric coverage (the `shaping` oracle). Envelope carries `env.architecture` = the proposal's key sections/claims (a `{id: text}` map or flat array). Add a thin `case "architecture"` branch to `grade()` calling `gradeCoverage(env.architecture, c.oracle.gloss_rubric)` — byte-for-byte the `gradeShaping` pattern (PARTIAL on [0,1), PASS on 1, vector signature). `validateCase` routes `architecture` to the `gloss_rubric` oracle field (extend the `gloss_rubric` want-arm alongside `gloss`/`shaping`/`decomposition`). NOT in `CLOSED_SET_KINDS`.
- **Registry entry:** `"architecture": { "surface": "faffter-noon-architecture", "status": "covered" }`.
- **Frontmatter:** `faffter-noon-architecture/SKILL.md` gains `judgement_seam: architecture`.
- **Fixtures (`eval/cases/architecture-*.json`):** ≥2 — a brief + infra profile whose sound proposal must mention the best-fit concepts (e.g. `["postgres", "durable"]`, `["container", "docker"]`) and must avoid anti-patterns (`must_avoid: ["hand-wave", "TBD", "we could maybe", "microservice"]` where a monolith is the honest best fit) and must not fabricate an ADR candidate the brief gives no basis for.

## Scenarios

1. **A build-biased proposal covers the rubric.** `architecture-001` (a brief needing durable relational storage) with `oracle.gloss_rubric.must_include: [["postgres","relational","rdbms"], ["docker","container"]]` → an envelope whose proposal names Postgres-in-a-container scores 1.0 PASS; one proposing a hand-wavy "some datastore" PARTIAL. Born-verifiable via `node --test`.
2. **A hallucinated assumption is penalised.** `architecture-002` with `must_avoid: ["kafka","event-sourcing"]` (nothing in the brief warrants them) → a proposal that invents an event-sourcing backbone drops below 1.0 (PARTIAL).
3. **Lint sees coverage.** `faff validate-adapters` reports `architecture` covered and the skill's `judgement_seam` reconciles.

## DONE

### Autonomous core (lint- + `node --test`-checkable)
- [ ] `architecture` added to `KINDS`; `grade()` branch delegating to `gradeCoverage`; `validateCase` `gloss_rubric` arm extended; grader loads clean.
- [ ] `eval/seam-registry.json` gains `"architecture": { "surface": "faffter-noon-architecture", "status": "covered" }`.
- [ ] `faffter-noon-architecture/SKILL.md` declares `judgement_seam: architecture`.
- [ ] ≥2 `eval/cases/architecture-*.json` validate, exercising must_include coverage + a must_avoid anti-pattern.
- [ ] `faff validate-adapters` exits 0; `node --test test/eval-grader.test.mjs` green.

### Human-only (CI-EXCLUDED)
- [ ] Human-supervised frontier baseline recorded. Cannot be satisfied autonomously.

## Punt / Assumes

- **Assumes:** the proposal's key claims are extractable into a `{id: text}` collection the coverage oracle reads (the `env.shaping` precedent). Grades the **chosen** architecture only; the proposer/critic boundary and the spec-review architectural lens (FAFF-282) stay out of scope.
- **Assumes:** the rubric dimensions (build-biased / production-grade / best-fit / founded) reduce to synonym-set `must_include`/`must_avoid` entries — the mechanical `gloss`/`shaping` posture, no LLM in the grade path.

**Confidence (autonomous core): high** — a direct, mechanical reuse of the shipped `shaping`/`gradeCoverage` oracle; the only residual is the human-supervised baseline (a Punt below, not a blocker).
