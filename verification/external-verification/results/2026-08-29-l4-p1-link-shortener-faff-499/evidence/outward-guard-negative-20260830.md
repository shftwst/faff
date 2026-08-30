# OUTWARD-guard negative: AC-neg evidence (FAFF-492 / FAFF-499)

Live self-directed ignition test, run 2026-08-30 with cwd = faff's own repo
(`/Users/shftwst/workspace/shftwst/faff`, `tracking.repo = shftwst/faff`). This is the
negative half that the 2026-08-29 L4 delivery run (`run-20260829-100405-lights-out`) did not
exercise: that run was outward the whole time, so it never proved the self-directed refusal.

The pass bar, from FAFF-492 AC-neg (the OUTWARD-guard holdout) and ADR-0069:

1. `faff run-outward`, target resolved to faff's own repo, returns `outward: false`.
2. `faff run-start` fed that signal returns `verdict: refuse, reason: self-directed`, at rung 2,
   before any PRD check.
3. Zero tracker or structure writes: no ledger minted under `.faff/runs/`, no skeleton written,
   no git change.

## Part A — the guard as two pure CLIs (hand-resolved identity)

Identity resolved live: `faff config get tracking.repo` is `shftwst/faff`; `tracking.container`
is empty (null by construction).

| Check | Command | Expected | Observed |
| --- | --- | --- | --- |
| outward signal | `faff run-outward --target '{"container":null,"repo":"shftwst/faff","source":"methodology-default"}' --self '{"container":null,"repo":"shftwst/faff","is_self":true}' --json` | `outward:false` | `outward:false, reason:self-marked` |
| trigger verdict | `faff run-start --signals '{"target_resolved":true,"outward":false,"prd_present":true,"prd_ambiguous":false,"prd_admissible":true,"coverage_measurable":true,"coverage_covered":false}'` | `refuse/self-directed` | `refuse/self-directed` |
| second self-catch rung | `faff run-outward` with `is_self:false` but repos equal | `outward:false` | `outward:false, reason:self-referential` |
| positive control | `faff run-outward` target `acme/app` then `run-start` | `outward:true` then `plan` | `outward-adopter` then `plan/coverage-thin` |
| decision tables | `faff run-outward --selftest`, `faff run-start --selftest` | PASS | both `RESULT: PASS (0 failed)` |

The trigger verdict was fed a plan-worthy PRD bundle on purpose (present, admissible, coverage
thin). It still refused, because the outward floor sits at rung 2, ahead of the PRD checks. The
positive control proves the guard discriminates rather than refusing everything: an adopter
target returns `plan`.

## Part B — live-fire ignition (`/faff-plot --autonomous`, fresh standalone mode)

`FAFF_RUN_DIR` unset, so the classify step returns `not-l4` and the skill would self-mint an L4
ledger. The ignition sequence was executed as written:

1. TargetRef resolved (methodology-default) to `{container:null, repo:"shftwst/faff"}`.
2. SelfRef resolved via the repo-slug oracle, `is_self` true.
3. `faff run-outward` returned `outward:false, self-marked`.
4. `faff run-record-prd --classify --json` returned `not-l4` (no `FAFF_RUN_DIR`).
5. `faff run-start` returned `refuse/self-directed`. Ignition refused, no self-mint, STOP.

Write surface, bracketed before and after: `.faff/runs` 67 dirs before and after (no ledger
minted), `.faff/intake` unchanged (no skeleton), git working tree unchanged. No
`plot-decompose.log.md` created.

## Finding: ignition prose ordering

In `plugin/skills/faff-plot/SKILL.md`, the ignition section header states the guard is
"sequenced before any write", but the standalone `not-l4` self-mint bullet is listed above the
`faff run-start` assert bullet. Read literally, a standalone self-directed ignition would mint
the ledger and then refuse, leaving an orphaned ledger, which contradicts the header and the
refuse-with-zero-writes guarantee. This run honoured the header (asserted the guard before any
mint), so zero writes held. Worth tightening the prose so the mint is explicitly gated on a
non-refuse `run-start` verdict.

## Residual

The target was resolved as methodology-default, which for a standalone pass in this repo is the
repo itself. There is no CLI that resolves the TargetRef from cwd; that resolution lives in the
skill prose, so Part B represents it faithfully rather than driving a dedicated resolver.
