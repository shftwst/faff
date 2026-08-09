# FAFF-54 — CI guard: skills must reference the rendering pass

> Spec (faff-prep · faffter-dark-nlspec · 2026-06-06, confidence: high)

## WHY
FAFF-53 wired every faff skill's human-facing output through the `rendering_adaptor`, but nothing **enforces** it — a future skill or edit could add a tracker/terminal emit without the rendering pass and drift back to dense, un-skimmable output. Add a CI guard.

**Grounding (verified on current main):** all 9 `faff-*` user-command skills reference the renderer post-FAFF-53 (`faff` 8, `faff-prep` 4, `faff-wtf` 3, the rest ≥1). So the guard passes today and locks the state in.

## WHAT / HOW — extend `validate-adapters` (skills/faff/bin/faff)
- Add a check: **every `faff-*` user-command skill's `SKILL.md` must reference the rendering pass** (`rendering_adaptor`, or the gateway *Rendering* / Universal-routing rule). **Fail** any `faff-*` command that lacks it.
- **Chosen: a conservative reference-presence check**, not NLP. It asserts the skill *documents* routing through the renderer; it does **not** prove the skill routes *every* emit at runtime (that's unlintable — same class of limit as FAFF-57). This is the honest mechanical form of the ticket's "heuristic" caveat: it catches a skill that drops the rule entirely, which is the realistic drift.
- **Chosen: scope = the `faff-*` user commands** (the emitters). Slot skills are excluded — producers emit to the consuming faff-* skill which renders; `faffidavit-rendering` *is* the renderer. (This extends the existing `faff-*` scan already in `validate-adapters` from FAFF-50/51.)
- Runs in the FAFF-48 `validate.yml` gate (which already invokes `validate-adapters`) — no workflow change needed.

**Assumes:** every `faff-*` command emits human-facing output (true today — none are read-only), so requiring the reference has no false positives. If a genuinely non-emitting faff command is ever added, exempt it explicitly.

## DONE
- [ ] `validate-adapters` fails if any `faff-*` user-command skill lacks a rendering-pass reference; passes on the current tree (all 9 reference it).
- [ ] Check is conservative reference-presence; the runtime-routing limit is noted in the code comment.
- [ ] Runs inside the existing `validate.yml` gate (no workflow edit).
- [ ] A negative test (strip the reference from a temp skill copy → FAIL) is demonstrated at build.
- [ ] Diff limited to `skills/faff/bin/faff`.

---
**Self-review:** confirmed all 9 commands currently reference the renderer (lint passes + locks state); confirmed the check extends the existing `faff-*` scan. The honest limit (presence ≠ runtime routing) is the same boundary as FAFF-57 and is stated, not hidden. No Punts → high.

## Methodology critique (faffter-dark-methodology-agile-delivery · issue-critique)
- **Right-sized?** Yes — one check added to an existing lint loop. No split.
- **Value × risk?** Medium value (drift-guard that keeps FAFF-52/53 honest), low risk (additive lint; passes today). Pairs with the FAFF-50/51 lints already there.
- **Deps surfaced?** relatedTo FAFF-52/53 (the contract + wiring this guards), FAFF-48 (the CI host). No blocker — buildable now.

confidence: high
