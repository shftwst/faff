# FAFF-186 — Copy `.faffrc.yaml` into graft worktrees

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-186.

A one-line `WorktreeCreate` hook fix + a regression test so autonomous builds honour the repo's `.faffrc.yaml` instead of silently falling back to config defaults.

## Why

`plugin/skills/faff-graft/setup-worktree.sh` copies gitignored config (`.env*`, `.claude/settings.local.json`) into a new worktree but **not `.faffrc.yaml`** — which is gitignored, so every graft worktree lacks it and `faff config` resolves to **defaults** during the build (confirmed FAFF-183: worktree `slots.review`=`faffter-noon-review` vs main's configured `faffter-dark-adversarial-review`). Every autonomous build silently ignores `.faffrc`. Compounds FAFF-182.

## What

- **Chosen:** add `.faffrc.yaml` to the hook's copy loop. Reuses the existing existence-guarded `cp`.
- **Chosen:** copy **only** the canonical `.faffrc.yaml` — never legacy `.faffrc`/`.faffrc.yml` (the resolver errors on those; propagating would inject the error into every worktree).
- **Chosen:** regression test asserts the copy list contains `.faffrc.yaml` and excludes the legacy names.

## Out of scope

- FAFF-182 (slot-dispatch resolver — orthogonal). The `.faff/` directory (worktree gets its own).

## DONE

- [x] `setup-worktree.sh` copy loop includes `.faffrc.yaml` (canonical only).
- [x] Regression test: copy list includes `.faffrc.yaml`, excludes bare `.faffrc`/`.faffrc.yml`.
- [x] `node --test` green; `validate-adapters` clean.

confidence: high
