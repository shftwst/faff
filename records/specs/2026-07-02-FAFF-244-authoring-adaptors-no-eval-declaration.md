# FAFF-244 — faffter-dark-authoring-adaptors eval coverage

_Folded with the human Resolution comment (2026-07-02): this surface resolves to a
**NO-EVAL declaration**, not a frontier eval KIND._

## WHY

`faffter-dark-authoring-adaptors` is the author/validate dev tool for slot occupants. Its
conformance surface — does a hand-written adaptor carry the correct refer-back prose, avoid
duplicated shared prose, and map onto the fixed gateway contract — is **already checked
deterministically** by `faff validate-adapters` (structural half) plus the skill's own Validate
face. The residual semantic-prose judgement (maps-onto-not-redefines, stays-in-lane) is
low-frequency and caught by human review.

Per the human Resolution: that residual sliver is **not load-bearing enough to warrant a frontier
eval**. Resolve by declaring the surface `judgement_seam: none` — a deliberate "covered by
deterministic lint, not graded" entry that satisfies the FAFF-281 coverage lint (it distinguishes
"no seam" from an "unguarded seam").

## WHAT

- `plugin/skills/faffter-dark-authoring-adaptors/SKILL.md` frontmatter gains `judgement_seam: none`.
- **No** grader KIND, **no** `eval/cases/` fixture, **no** `eval/seam-registry.json` row.
- Mirrors FAFF-286's `faffter-noon-env-compose` declared-deterministic treatment exactly
  (frontmatter-only `none`, no registry row).

## HOW

- One-line frontmatter addition, sibling to `name`/`description`.
- `reconcileSeam` reads `none`, sees the surface owns no registered KIND → passes
  ("judgement_seam: none — owns no registered KIND"). Since the surface is neither a REGISTRY
  occupant nor a registry surface, it never appeared as a C1 `UNDECLARED`/`FAIL` line; the `none`
  declaration records the intent explicitly rather than leaving the key absent.

## DONE

### Autonomous core (lint- + `node --test`-checkable)
- [ ] `faffter-dark-authoring-adaptors/SKILL.md` declares `judgement_seam: none`.
- [ ] No grader KIND / no eval case / no registry row added.
- [ ] `faff validate-adapters` exits 0 (reads the surface as declared no-seam, not an unguarded seam).
- [ ] `node --test test/eval-grader.test.mjs` green (no KIND change — untouched-green).

### Human-only (CI-EXCLUDED)
- [ ] None — there is no KIND, so no frontier baseline is owed.

## Notes

- No frontier eval by design. The prompt-size census is an advisory ceiling (not exact-match), so
  the one-line frontmatter addition needs no `eval/baselines/prompt-size.json` update — the same as
  FAFF-286's env-compose/adr frontmatter edits.
