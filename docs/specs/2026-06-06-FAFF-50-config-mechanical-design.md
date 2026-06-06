# FAFF-50 — Make config access mechanical (CLI-only)

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high (Punt resolved → hard cutover). Full spec on Linear FAFF-50.

## WHY
A configured `.faffrc.yaml` was silently ignored twice — an agent eyeballed a bare-named rc
file (`cat .faffrc`), found nothing (real file is `.faffrc.yaml`), and fell through to defaults.
Fix is mechanical tooling, not prose.

## WHAT / HOW (skills/faff/bin/faff + gateway)
1. **Hard cutover (resolver).** `findConfig` accepts only `.faffrc.yaml`; a legacy `.faffrc` /
   `.faffrc.yml` present → LOUD error naming the fix (exit 2), never a silent default.
   (Chosen: hard cutover + loud error — the ticket's own "loud error, never silent default"
   thesis; faff is 0.1.0 with no external configs to strand.)
2. **`faff config resolved`** — echoes the resolved non-default config (path, appetite, set slots)
   for run banners, so a dropped/overridden slot is visible.
3. **CLI-only config access** — gateway rule: every config read goes through `faff config`,
   never hand-read. Enforced by a conservative `validate-adapters` lint that fails any skill
   SKILL.md that shell-reads `.faffrc*` (cat/head/tail/grep/sed/awk/less). Runs in FAFF-48 CI.

## Decisions
- Chosen: extend validate-adapters (not a new subcommand) for the lint.
- Chosen: hard cutover + loud error for the single filename.
- Lint is conservative (explicit shell-read only) to avoid prose false positives.

## DONE
- [x] Resolver: `.faffrc.yaml` only; legacy name → loud error (tested: .yml + .faffrc both exit 2; .example ignored; no-rc exit 3).
- [x] `faff config resolved` echoes non-default config (tested).
- [x] Gateway states CLI-only config access + single-filename + loud error.
- [x] validate-adapters lint fails a hand-reading skill (tested) and passes the clean tree; runs in FAFF-48 CI.
- [x] Diff limited to skills/faff/bin/faff + faff/SKILL.md.
