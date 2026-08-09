# FAFF-282 — spec-review verdict eval coverage (`spec-verdict` grader KIND)

## WHY

The spec-review verdict (`faff-contract:spec-review-verdict`) **gates prep→build admission** — the scariest unguarded seam in the suite. Both occupants (`faffter-noon-spec-review` single-pass 4-lens; `faffter-dark-spec-review` per-lens refuters + majority/severity aggregation) emit a verdict but had zero judgement-eval coverage. A wrong `approve` on a broken spec admits a bad build unattended.

## WHAT

A single grader `KIND` — `spec-verdict` — that, given a spec fixture, exercises whether the reviewer assigns the correct fixed verdict from the contract enum `{approve, revise, reject-approach, needs-human}`. Clean specs → `approve`; specs with a planted architectural/infosec/methodology/QA defect → the correct non-approve verdict. The verdict is a single closed value, so it reuses the existing closed-set oracle (the `routing`/`modedetect`/`verdict-build` shape) — no new grade math.

**One aggregate verdict KIND, not one per lens** (human Resolution, 2026-07-02). Spec-review runs four lenses but produces **one** final call; grade that single final call, the same way the existing build/routing verdict evals work. Not four separate per-lens eval kinds.

**Out of scope:** whether the adversarial refuter actually *catches a planted flaw* (catch-rate / false-positive behaviour) — that stays in FAFF-283's own dimension, kept disjoint to avoid double-coverage.

## HOW

- **KIND id:** `spec-verdict` (distinct from the review-slot `verdict-build`, a code-review verdict over a diff; this is a spec-stage verdict over a spec body).
- **Oracle shape:** single-element closed-set (`setEqual`). The envelope carries `env.verdict`; `predictedSet` gains a one-line `case "spec-verdict"` arm returning `[String(env.verdict)]` (joins the `routing`/`verdict-build` arm — the SAME field). Added to `KINDS` and `CLOSED_SET_KINDS`. An out-of-enum token passes through verbatim → clean FAIL with a distinct signature (the eval-side fail-safe; the deterministic coercion stays in `faff contract spec-review-verdict`).
- **FIXTURE_SHAPE:** `"spec-verdict": ["spec_body"]` — the fixture carries the spec body under review (the `confidence` precedent). `validateCase` asserts it is present.
- **Registry entry:** `"spec-verdict": { "surface": "faffter-noon-spec-review", "status": "covered" }`. `faffter-dark-spec-review` is the slot sibling — it declares `judgement_seam: spec-verdict` honestly via the FAFF-281 slot-sibling relaxation (same `spec_review` slot type, no own row).
- **Frontmatter:** `faffter-noon-spec-review/SKILL.md` gains `judgement_seam: spec-verdict`; `faffter-dark-spec-review/SKILL.md` likewise.
- **Fixtures (`eval/cases/spec-verdict-*.json`):** 3 — a clean spec → `approve`; an architectural-blocker spec (design wrong, scope right) → `reject-approach`; an SSRF-hole spec → `needs-human` (an infosec blocker is a threat call the L1–L3 map routes to `needs-human`). Oracles keyed to the reviewer's deterministic severity→verdict map.

## DONE

### Autonomous core (lint- + `node --test`-checkable)
- [x] `spec-verdict` added to `KINDS` + `CLOSED_SET_KINDS`; `predictedSet` arm + `FIXTURE_SHAPE` entry added; grader loads without a KINDS-drift throw.
- [x] `eval/seam-registry.json` gains `"spec-verdict": { "surface": "faffter-noon-spec-review", "status": "covered" }`.
- [x] both `faffter-noon-spec-review` and `faffter-dark-spec-review` SKILL.md declare `judgement_seam: spec-verdict`.
- [x] 3 `eval/cases/spec-verdict-*.json` validate (`validateCase`) and cover approve + a non-approve + needs-human.
- [x] `faff validate-adapters` exits 0 (no seam mismatch, no C1/C2 miss); `node --test test/eval-grader.test.mjs` green.

### Human-only (CI-EXCLUDED — not required by the lint)
- [ ] Human-supervised frontier baseline recorded (real `claude -p` reps → per-kind accuracy/stability into ADR-0004). Cannot be satisfied autonomously; non-blocking follow-up.

## Resolution

The medium-confidence spec's two open Punts (one-aggregate-KIND vs per-lens; refuter-behaviour-here vs FAFF-283) are **resolved by the human Resolution comment**: one aggregate `spec-verdict` KIND; refuter catch-rate stays in FAFF-283. No design ambiguity remains for the autonomous core.
