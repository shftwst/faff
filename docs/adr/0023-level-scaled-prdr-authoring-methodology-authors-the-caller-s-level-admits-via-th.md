# ADR 0023 — Level-scaled PRDR authoring: methodology authors, the caller's level admits via the single FAFF-255 gate

- **Status:** Accepted
- **Date:** 2026-06-27
- **Issue:** FAFF-251

## Context

FAFF-245 shipped the PRDR record (`faff prdr new/supersede/validate`) and FAFF-255 shipped its two-gate admission (`faff prdr admit`), but both are deliberately authoring-agnostic: nothing fills a project's `## Definition of done`. For lights-out (L4) the machine must derive a project's delegated ends itself, yet a project DoD must remain trustworthy at L3 (a human still on the loop) and safe at L4 (no human at all).

Two pulls had to be reconciled: (1) **who decomposes** a human PRD into project-level delegated ends — this is a methodology judgement (an agile MVP cut, a Shape-Up bet), not orchestration plumbing; and (2) **who is allowed to commit** that authored DoD as live — which differs by autonomy level (a human ratifies at L3; the run self-admits at L4). Folding admission logic into the authoring path would have duplicated FAFF-255 and let the author grade its own homework.

## Decision

PRDR authoring is a single **`methodology` named output, `prdr-author`**, that authors but never admits, and the **authored artifact is identical at every level — only the admitter changes**.

- `prdr-author` derives one `AuthoredPrdr {decision, definition_of_done, container, prd_goal, provenance: "loop", status: "Proposed"}` from a container's `{outcome, child_specs, target}`, scaling the DoD ambition to the FAFF-40 `target` (resolution order `explicit > inherited > methodology-default`), and writes it via `faff prdr new --provenance loop --status Proposed`. It performs **no admission** and never writes the tracker.
- **The caller's level routes the `Proposed` PRDR to admission** (gateway → *Authored-PRDR level-scaling*): **L3** (`/faff-plot` at project creation, `/faff-jot`, on-demand in `/faff-tidy`) surfaces it for human ratification (the human flips `Status: Accepted` in the tracker — FAFF-255's gesture); **L4** (the lights-out runner) routes it through `faff prdr admit` carrying the FAFF-256 (upper) + FAFF-257 (lower) verdicts and self-Accepts only within 255's two gates + FAFF-222 containment + the appetite floor.
- **Manual changes are authoritative:** `prdr-author` re-reads any human-set DoD before (re)proposing and never clobbers it (resolution `human-set > methodology-default`).
- **Fail-safe:** low confidence yields a thin DoD flagged needs-human; an L4 self-define is never vacuous.

## Consequences

- Admission stays single-sourced in FAFF-255 — there is exactly one gate, exercised identically by a human (L3) and the runner (L4); the level is just the admitter, never a second admission codepath.
- A methodology swap re-homes the decomposition opinion cleanly: the structural default authors a child-derived completion bar, the agile lens scales it to the thinnest target-funded slice, and an unanswered `prdr-author` simply means the human authors the DoD directly (Optional output, graceful degradation).
- `prdr-author` is bounded by the leash by construction: every authored PRDR still enters through 255's two gates + FAFF-222 containment + the appetite floor, so the authoring path adds no new way to escape the box.
- Because authoring is read-only and never admits, the build agent cannot self-approve its own delegated ends — the lane isolation that makes lights-out trustworthy is preserved.
