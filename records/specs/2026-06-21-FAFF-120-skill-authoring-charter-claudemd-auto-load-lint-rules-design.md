# Spec — Skill-authoring charter + CLAUDE.md auto-load + lint rules

*Spec by /faff-prep (autonomous, run 2026-06-12-beep-boop-133455, faffter-noon-spec); scope resolved by interactive prep 2026-06-12.*

## WHY

The lean / deduplicated / skimmable ethos (FAFF-114–119) is today a one-time scrub with no durable home and nothing stopping it rotting. Make it a standing, self-enforcing standard: one committed source-of-truth doc, auto-loaded into every Claude Code session in this repo, with the machine-checkable subset wired into the existing `faff validate-adapters` CI gate. Keystone of the workstream.

## WHAT

**Scope (in)**

1. **Charter doc** at `docs/reference/skill-authoring.md` — single home for the ethos, written *as* the ethos (terse, bulleted, factual; its own worked example). Covers the lintable rules (so it explains what the tool enforces) and the unlintable taste/skimmability guidance.
2. **Auto-load**: repo-root `CLAUDE.md` referencing the charter, so every Claude Code session in this repo gets the ethos by construction.
3. **Mechanical lint** added to `faff validate-adapters` over all `SKILL.md` files: stray non-load-bearing `FAFF-NN` / transcript / retrospective phrases; per-file line cap; paragraph-length heuristic (nudge bullets over prose). Wired into the existing `validate.yml` `validate-adapters` step (no new CI step).
4. `faffter-dark-authoring-adaptors` SKILL.md gains a pointer to the charter as the standard new slot skills are written *to*.

**Scope decision (interactive prep, 2026-06-12) — keep whole, was blocked on FAFF-115:**

- **No split.** The duplicated-block detector stays **in scope** — not carved into a follow-up.
- FAFF-115 (single-source shared-prose home) was the blocker; it is now **Done** (PR #117), so FAFF-120 builds as one whole unit (charter + root `CLAUDE.md` + all lint rules incl. dedup detection).
- **Calibration Punts** (per-file line/paragraph caps, stray-marker `FAFF-NN` allowlist) calibrated at build time against the post-cleanup tree.

**Acceptance criteria**

- `docs/reference/skill-authoring.md` committed (not in gitignored `design/`, not in any `SKILL.md`), terse/bulleted.
- Root `CLAUDE.md` exists, references the charter. It is faff's **contributor guidance**, NOT faff config — no FAFF-50 collision (CLI still reads config only via `faff config`; this CLAUDE.md is never a config source).
- `faff validate-adapters` runs the new lint rules, exits non-zero on a violation, current tree passes; failures print specific `FAIL <name> (<category>) ✗ <label>` messages.
- CI green via the existing `validate-adapters` step.

## HOW

- **Charter** → new `docs/reference/skill-authoring.md` (sibling to `records/adr/`, `records/specs/`; `docs/` tracked, only `design/` gitignored).
- **Auto-load** → new repo-root `CLAUDE.md`. Reference the charter rather than inline it (keeps single-source).
- **Lint** → extend `cmdValidateAdapters` in `plugin/skills/faff/bin/faff`. It already iterates every dir with a `SKILL.md` and emits `FAIL <name> (<category>) ✗ <label>` with non-zero exit — new rules slot into that loop. Stray-marker rule needs a conservative allowlist (FAFF-NN is sometimes load-bearing in prose).
- **CI** → already covered by `.github/workflows/validate.yml` `validate-adapters` step; no new step.
- **Tests** → add `test/validate-adapters.test.mjs` per ADR 0002 `node --test` convention: crafted bad SKILL.md fails each rule, real tree passes.
- **Cross-ref** → one line in `faffter-dark-authoring-adaptors/SKILL.md` pointing the Author face at the charter.
- **Punt:** stray-marker false positives — tune the allowlist so the current tree passes; if not cheaply low-FP, ship line-cap + paragraph rules and defer stray-marker.

## DONE

- `docs/reference/skill-authoring.md` + root `CLAUDE.md` committed; CLAUDE.md references the charter.
- `node plugin/skills/faff/bin/faff validate-adapters` exits 0 on current tree, non-zero (specific message) on a crafted bad SKILL.md.
- `node --test test/validate-adapters.test.mjs` passes.
- `faffter-dark-authoring-adaptors/SKILL.md` cites the charter.
- CI `validate` workflow green.

## Confidence self-rating: **medium**
