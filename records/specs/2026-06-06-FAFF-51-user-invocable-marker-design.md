# FAFF-51 — Mark internal slot skills user-invocable: false

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high. Full spec on Linear FAFF-51.

## WHY
The 15 internal slot skills (adaptors/producers/methodologies/concurrency) appear in the
user `/` menu as if they were commands. They are invoked by faff skills via the Skill tool,
not chosen by a human. Hide them; keep the 9 `faff-*` commands and the authoring dev tool visible.

## WHAT / HOW
- Add `user-invocable: false` frontmatter (native Claude Code field: hides from `/` menu,
  preserves Skill-tool invocation) to the 15 skills in the CLI's `REGISTRY`. NOT
  `disable-model-invocation` (that would block faff from invoking the slot).
- Reword their "Invokable standalone" descriptions (standalone use is now a `faff` CLI concern).
- `faffter-dark-authoring-adaptors` stays user-facing (already in the CLI `SKIP` set).
- Extend `validate-adapters` (skills/faff/bin/faff): assert every REGISTRY skill carries the
  marker, and every user-facing skill (9 `faff-*` commands + authoring-adaptors) does NOT.
  Runs in the FAFF-48 `validate.yml` CI gate. Dependency-free frontmatter regex; no new subcommand.

## DONE
- [x] 15 REGISTRY skills carry `user-invocable: false`.
- [x] 9 `faff-*` commands + authoring-adaptors do not.
- [x] validate-adapters asserts both; fails on drift (verified: missing-on-slot, present-on-command, present-on-devtool).
- [x] Runs in FAFF-48 CI; validate-adapters still PASS.
- [x] Diff limited to the 15 SKILL.md + skills/faff/bin/faff (+ this spec).
