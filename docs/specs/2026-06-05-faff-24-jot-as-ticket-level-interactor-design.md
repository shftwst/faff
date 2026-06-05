# Spec — Jot as ticket-level interactor (FAFF-24)

> Source: faff-prep, interactive · `faffter-noon-spec` · attached to FAFF-24 as a comment 2026-06-04.

`confidence: high` — clean-context self-review returned PASS (0 blocker/major; one minor — edge-case ACs — folded in).

---

## WHY
`/faff-jot` is new-work-only today (greenfield / single-item, both from idle). There's no conversational entry point to *shape or gate an existing ticket* — notably to freeze/thaw the automation-hold (**FAFF-23, shipped**) on a ticket you name. Extend jot: **`/faff-jot ISSUE-XX` = the existing-ticket interactor**, first operation freeze/thaw, narrow remit — so jot becomes "the human's ticket-shaping front door, new **or** existing."

**Principles:** narrow remit — **shaping & eligibility only** (freeze/thaw, re-scope, re-home, split/merge intent); never speccing (prep), grooming (tidy), building (graft). Extends jot's pipeline-entry identity, not a grab-bag.

**Out of scope** (extension points): v1 ships **freeze/thaw only**; re-scope / re-home / split-merge-intent are the named direction but **deferred** (each later reuses the methodology `ticket-shaping` output); no in-place edit of title/description/status; jot stays **interactive-only** (no autonomous invocation).

## WHAT
**Chosen:** three-way mode detection — an **issue-id argument** routes to the existing-ticket interactor; **no argument** → today's greenfield/single-item fork (unchanged). The arg's presence is the unambiguous switch (no "new or existing?" gate needed).

**Chosen:** freeze = add the `automation-hold` label; thaw = remove it. Reuses FAFF-23's primitive; human-gated by the interactive choice (jot is interactive-only).

**Chosen:** jot-freeze/thaw and tidy's lift-hold are **complementary entry points to the same label primitive**, by context — jot is *ticket-centric* ("freeze/thaw this ticket I named"); tidy is *grooming-batch* ("lift holds across the On-hold items I'm reviewing"). Same add/remove, both human-gated, cross-referenced. No canonical-owner conflict. (Terminology: tidy says "lift", jot says "thaw" — both remove the label.)

**Assumes:** FAFF-23 (automation-hold label + rule) is shipped on `main` (it is — merged this session); jot runs orchestrator-lane with full tracker write (it creates tickets today), so label mutation on an existing ticket is within-lane.

## HOW
- **Dispatch:** at jot's mode-detection step, **first** check for an issue-id argument → existing-ticket interactor; else → today's greenfield/single-item detection (unchanged).
- **Interactor:**
  1. Load the ticket (title / description / labels / status / spec-comments). Not-found → error; cancelled/archived → refuse (shared **Ignore cancelled and archived** rule).
  2. Present a **shaping/gating menu** — **not** a re-run of discovery. v1: freeze/thaw, by current hold state.
  3. freeze → add `automation-hold` (+ an optional one-line reason comment); thaw → remove it. Immediate on the interactive choice (the choice is the confirm); logged.
  4. No spec, no build, no re-discovery.

## DONE
1. `/faff-jot ISSUE-XX` (issue-id arg) routes to the existing-ticket interactor; no-arg jot is unchanged (greenfield/single-item).
2. The interactor loads the ticket; refuses cancelled/archived; errors on not-found; does **not** re-run discovery.
3. v1 menu offers **freeze** (add `automation-hold`) / **thaw** (remove it) by current hold state; immediate on interactive choice; logged. Edge cases handled: **thaw of a never-held ticket → no-op + inform**; **freeze of an already-held ticket → no-op + inform**.
4. Uses the FAFF-23 label primitive; **thaw does not auto-promote** (just rejoins normal eligibility).
5. The jot↔tidy overlap is documented in both skills (jot = ticket-centric entry, tidy = grooming-batch entry; same primitive; both human-gated; cross-referenced).
6. Remit is shaping/eligibility only — the skill explicitly excludes speccing/grooming/building (defers to prep/tidy/graft).
7. Out-of-scope stated: re-scope/re-home/split-merge intent deferred (extension; reuse `ticket-shaping`); no in-place title/description/status edit; jot stays interactive-only.
8. no-arg jot path unchanged (regression check).

---

### Self-review (clean-context subagent) — PASS
Codebase fit ✓ (jot orchestrator lane has tracker write; FAFF-23 on origin/main); Assumes valid ✓; scope locked to v1 freeze/thaw ✓; jot-thaw vs tidy-lift coherent (complementary, not redundant) ✓; no missing surface. One **minor** — formalize the no-op edge cases as ACs → folded into DONE 3.

*Markers: 3× `**Chosen:**`, 1× `**Assumes:**`, 0 `**Punt:**`. Marker validation: pass. Builds on shipped FAFF-23.*
