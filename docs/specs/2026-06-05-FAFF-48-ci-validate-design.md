# FAFF-48 — CI: validate contracts + config on PR/push

> Spec producer: faffter-dark-nlspec · 2026-06-05 · autonomous /faff-beep-boop · confidence: high
> Full spec + self-review + methodology critique: Linear FAFF-48 comment (2026-06-05).

## WHY
The bundled `faff` CLI already ships `validate-adapters` (slot-skill contract lint) and
`config` (`.faffrc` resolve/parse), but the only workflow is `release-please.yml` — nothing
runs the validators on PR/push, so a change breaking slot conformance or the config parser
merges unchecked. Wire the existing validators into a CI gate. No new validation logic.

## WHAT
One new file: `.github/workflows/validate.yml`. No CLI/skill changes.
- Triggers: `pull_request` + `push` to `main`.
- Node 20 (`actions/setup-node@v4`), `actions/checkout@v4`. CLI is node-only, zero deps.
- Invoke the bundled bin directly: `node skills/faff/bin/faff …` (no link/symlink step).

## HOW (job steps)
1. checkout.
2. setup-node 20.
3. `node skills/faff/bin/faff validate-adapters` — non-zero fails the job (core gate).
4. Config parse-or-fail: copy `.faffrc.example.yaml` to a loadable name in a temp dir and
   `faff config dump` it; non-zero fails. (Chosen: parse-or-fail, not a new schema-check
   subcommand. The real `.faffrc.yaml` is gitignored/absent in CI, so the committed
   `.example` template is the validatable artefact; "no rc present" (exit 3) is NOT failure.)

## Decisions
- **Chosen:** Node 20 LTS; checkout@v4 / setup-node@v4.
- **Chosen:** invoke `node skills/faff/bin/faff` directly.
- **Chosen:** parse-or-fail config depth via `config dump` on the `.example` template.
- **Chosen:** do NOT run `validate-adapters --configured` (swapped slots live in the
  gitignored `.faffrc.yaml`, absent in CI).
- Out of scope: `runcheck`, release-please, FAFF-12, link-skills smoke-test.

## DONE
- [x] `.github/workflows/validate.yml` triggers on PR + push-to-main.
- [x] Runs `validate-adapters`; non-zero fails.
- [x] Parse-validates `.faffrc.example.yaml` via `config dump`; non-zero fails.
- [x] "No `.faffrc`" not treated as failure.
- [x] Diff limited to the new workflow file (+ this spec).
