# FAFF-286 — ADR + env generative-surface eval coverage

_Folded with the human Resolution comment (2026-07-02), three parts:
(1) env-compose gets **no** judgement eval — declared `judgement_seam: none`;
(2) keep **one** eval KIND for the ADR-writing skill — `adr-gloss`;
(3) do **not** split the ticket._

## WHY

Two lighter generative surfaces grouped:

- `faffter-noon-adr` authors the Nygard ADR body (Context/Decision/Consequences) — it must
  capture the settled decision and its **real** consequences without fabricating rationale.
  No eval coverage today.
- `faffter-noon-env-compose` provisions a local stand-in. Its provisioning mechanics are already
  deterministically tested; the only judgement-ish sliver (does the stood-up env match the proposed
  architecture) is **not load-bearing enough to grade** (human Resolution). It is currently an
  advisory `UNDECLARED` (a registry slot skill with no `judgement_seam:` key).

## WHAT

- **ADR:** one rubric-coverage `KIND` (`adr-gloss`) over the ADR body — the settled decision, the
  trade-off actually made, and the real consequences appear; boilerplate / fabricated rationale
  does not.
- **Env:** resolve to **declared-deterministic** — `faffter-noon-env-compose` declares
  `judgement_seam: none` (provisioning is deterministically tested; the fit-reading is too thin to
  warrant a frontier KIND). This clears its `UNDECLARED` advisory with **no registry row**.
- **No split** — both surfaces land in this one ticket.

## HOW

- **KIND id:** `adr-gloss` (distinct from `gloss`, faffidavit-rendering's one-line issue synthesis).
- **Oracle shape:** collection-level rubric coverage (the `architecture`/`shaping` oracle). The
  envelope carries `env.adr` (the ADR body sections, a `{id: text}` map or flat array); `grade()`
  delegates to `gradeCoverage(env.adr, c.oracle.gloss_rubric)` — **NO new grade math**. `validateCase`
  routes `adr-gloss` to the `gloss_rubric` field. NOT in `CLOSED_SET_KINDS`.
- **Registry:** `eval/seam-registry.json` gains `"adr-gloss": { "surface": "faffter-noon-adr",
  "status": "covered" }`. **No env row** — env is declared-deterministic. The grader's
  `KINDS === registry-keys` invariant holds because only `covered`/`designed` KINDs are registry
  keys; a `none`/deterministic surface is declared purely in frontmatter, never a KIND key.
- **Frontmatter:** `faffter-noon-adr/SKILL.md` gains `judgement_seam: adr-gloss`;
  `faffter-noon-env-compose/SKILL.md` gains `judgement_seam: none`.
- **Fixtures (`eval/cases/adr-gloss-*.json`):** ≥2 — a settled decision (with rationale + a rejected
  alternative) whose sound ADR body must include the decision + the real consequence + the rejected
  alternative, and must avoid boilerplate/fabricated rationale.

## Scenarios

1. **A sound ADR covers decision + consequence.** `adr-gloss-001` (decision: "use Postgres, reject
   SQLite for concurrency") → an ADR naming all three concept-sets scores 1.0 PASS; one omitting the
   rejected alternative → PARTIAL. Born-verifiable via `node --test`.
2. **Boilerplate is penalised.** `adr-gloss-002` with a `must_avoid` boilerplate set → an ADR padded
   with "best practice / it depends / TBD" drops below 1.0.
3. **Env declares deterministic, cleanly.** `faff validate-adapters` no longer prints `UNDECLARED
   faffter-noon-env-compose`; its `judgement_seam: none` reconciles (owns no registered KIND) and
   `adr-gloss` reports covered.

## DONE

### Autonomous core (lint- + `node --test`-checkable)
- [ ] `adr-gloss` added to `KINDS`; `grade()` branch delegating to `gradeCoverage`; `validateCase`
      `gloss_rubric` arm extended; grader loads clean (registry consistency assertion passes).
- [ ] `eval/seam-registry.json` gains `"adr-gloss"` covered row (no env row).
- [ ] `faffter-noon-adr/SKILL.md` declares `judgement_seam: adr-gloss`;
      `faffter-noon-env-compose/SKILL.md` declares `judgement_seam: none`.
- [ ] ≥2 `eval/cases/adr-gloss-*.json` validate.
- [ ] `faff validate-adapters` exits 0 (no C1 miss, env `UNDECLARED` cleared, adr-gloss C2 satisfied);
      `node --test test/eval-grader.test.mjs` green.

### Human-only (CI-EXCLUDED)
- [ ] Human-supervised frontier baseline recorded for `adr-gloss`. Cannot be satisfied autonomously.

## Notes

- The env fit-reading KIND-or-none and the potential split were the two open Punts on the attached
  spec; the human Resolution settles both: **none**, and **no split**. This spec is folded to match.
