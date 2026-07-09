# ADR 0050 — Per-lane effort routing mirrors the model lanes and stops at the prep boundary

- **Status:** Proposed
- **Date:** 2026-07-09
- **Issue:** FAFF-416

## Context

FAFF-407 found the two cost levers: **model** (Opus is 82% of spend; cheaper models cut
2–5× per token on mechanical work) and **reasoning effort** (billed as output *and*
compounding into cache at the ~14× amplification). The model lever already shipped as the
per-lane `models:` surface (FAFF-315 scalar, FAFF-334 per-confidence matcher, FAFF-372
producer lanes). FAFF-415 shipped the effort **telemetry** (`data.effort` on dispatch
events + `economics --by effort`). What remained was the effort **control** — a slot could
pick its model but not its reasoning-effort.

Two questions had to be answered without a parallel surface: (1) where does the effort knob
live, and (2) which slots may carry it. The ticket's hard constraint: **prep/spec is not
tunable** — prep runs once and gates the whole downstream pipeline, so a thin/wrong spec
poisons every build that follows; those lanes stay pinned to a capable model/effort.

## Decision

Add an `effort.<lane>` config family that is the **exact effort counterpart to the
`models.<lane>` lanes** — same registry-default mechanics, same CLI-only resolution
(`faff config get effort.<lane>`), same closed-vocabulary fail-loud-at-read validation
(`inherit | low | medium | high | xhigh | max`; an off-vocabulary value exits 2 naming the
legal set, never a silent inherit), same `config resolved` banner echo, and resolved at the
**same dispatch sites** that already resolve the model — stamped alongside it.

An effort lane exists **iff** the corresponding model lane exists **and** the lane is
neither a prep/spec lane nor `eval`. That yields exactly three tunable effort lanes:
`effort.build` (stamped into every `BuildDispatch` by the concurrency executors),
`effort.methodology` and `effort.intake` (the producer-subagent dispatches). Deliberately
**absent**: `effort.spec`, `effort.spec_review`, `effort.prep_explore`,
`effort.architecture` (the prep/spec pin) and `effort.eval` (the frontier-driver's pinned
open-vocab model, not a beep-boop slot).

The **inline / subagent boundary** carries over from `models:` unchanged: `review` and
`ship` run inline inside faff-graft and have no Agent-tool dispatch tag to carry, so they
get no effort lane. The adversarial **judge**'s effort tuning (the FAFF-407 "Opus-high"
target) lives in its own `faffter_dark.adversarial` engine block (`--num-predict` / model)
— `effort:` **composes with, never subsumes** it, the same rule `models:` already states.

`inherit` (every lane's default) omits the effort arg, so the **no-config path is
byte-identical**. The resolved level is also the value the dispatch tags onto its FAFF-415
`data.effort` event, closing the loop config → dispatch → telemetry → `economics --by
effort`.

## Consequences

- The effort surface has **no independent shape to learn** — anyone who knows `models:`
  knows `effort:`. New tunable lanes are added in lockstep with new model lanes, gated on
  the same prep-exclusion rule.
- Tuning is **opt-in and measurable**: a pinned effort is visible in the run banner and its
  spend is attributable via `economics --by effort`, never a silent re-route.
- The prep boundary is enforced by **omission** — there is simply no key to set — so a
  future well-meaning config can't accidentally down-tune the pipeline-gating spec lanes
  through this surface. Lifting the pin later means adding the lane deliberately (and
  revisiting this ADR), not flipping a default.
- FAFF-417 (prep emits a per-ticket build-tier signal) can later drive an
  `effort.build_by_confidence` matcher on the same pattern as `models.build_by_confidence`;
  this ADR leaves `effort.build` a per-run scalar and does not pre-build that matcher.

