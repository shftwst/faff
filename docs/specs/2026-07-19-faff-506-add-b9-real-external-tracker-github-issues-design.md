# FAFF-506 — B9: faff operates against a real external issue tracker (first light: GitHub Issues)

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: medium. Full spec on Linear FAFF-506.

This spec defines two artifacts for the external-verification suite: (a) a new behaviour **B9 — faff operates against a real external issue tracker** added to the behaviours rubric, and (b) a documented, repeatable way to instrument B9 by pointing an existing SUT rung at GitHub Issues via a `tracking:` overlay. The audience is the build agent authoring the docs + runbook, and the human operator who will later run the B9 pass and score it. Nothing here builds product code — the deliverable is design-doc edits plus a runbook and a config-overlay snippet.

## 1. WHY — Problem and Principles

**The load-bearing model.** The external-verification suite scores faff against a *behaviours rubric* (B1–B8): each row is a faff capability under test, scored on one basis — "did the behaviour occur, and did faff respect its boundary." "Which tracker" is a **separate column** of the rung table, and every rung today is **git-only**. So faff's headline "works with Linear, GitHub Issues, Jira, or any tracker exposed via MCP" claim is asserted but never *exercised* in the suite. Driving a real tracker is not a new product to build — it is a **missing behaviour** the rubric never scores.

**Problem statement.** faff's tracker-agnostic control plane (issue read/write, label ops, status transitions, PR↔issue linking) is the exact path git-only mode stubs out, and it has zero suite coverage. This change folds that path in as **B9** and gives it a first, minimal instrument against GitHub Issues, so the tracker-agnostic claim becomes a scoreable behaviour instead of an untested assertion.

**Design principles.**

- **The tracker adapter is the subject; the product is not.** B9 scores whether faff drove the *tracker* correctly, not whether the SUT product was built well. The instrument must therefore reuse an existing rung's minimal brief and add the least product confound possible — anything richer green-washes the adapter signal.
- **Boundary-respect is half the score, exactly as B1–B8.** B9 passes only if faff both *performed* the tracker operations and *respected the tracker-ownership boundary* — most concretely, faff must refuse to write the eligibility labels (`faff-automate` / `faff-automation-hold`) itself (tracker-owned; the `faff label` op exits non-zero on them), never fabricate issue state, and only move status through the sanctioned lifecycle. A run that "worked" but wrote an eligibility label is a **fail**.
- **Observe the new adapter path before firing it blind.** A tracker adapter exercised for the first time against a live external forge is precisely the boundary you want to *watch*, per the suite's own "run at L2–L3 first so you observe the boundary rather than discover it" convention.

**Scope statement.** This sits entirely inside the external-verification harness (`design/` brief + `docs/external-verification/`); it changes no faff CLI or skill code.

## 3. WHAT — the rubric row, the framing, the overlay

### B9 — the behaviours-rubric row

Added to `design/faff-external-verification-brief.md` §3, same shape as B1–B8. Behaviour: Operate against a real external issue tracker (issue read + write, label ops, status transitions, PR↔issue linking through the tracker adapter). Capability under test: tracker adapter (git-only-stubbed control-plane path), tracker-owned-label refusal.

### The overlay

**Config surface.** A `tracking:` block layered onto the chosen rung's `.faffrc.yaml`: `tracker: github`, `repo: <org>/<throwaway>`, `git_host: github`, and `automation_default` DROPPED (falls back to opt-in so eligibility lives on the GitHub issues as the faff-automate label).

## 4. HOW — behaviour

**Chosen rung:** P1 (link-shortener) as the first B9 instrument. **Chosen:** a documented overlay + a runbook (`docs/external-verification/b9-github-tracker-overlay.md`), no new scaffold script. **Chosen:** L2/L3 first. **Chosen:** drop `automation_default`.

## 8. DONE — Definition of Done

- B9 row in brief §3; brief states the scoring basis + boundary.
- README notes any git-only rung can be re-run in a `tracker: github` overlay to instrument B9, and links the overlay runbook.
- `docs/external-verification/b9-github-tracker-overlay.md` documents prerequisites, the exact `.faffrc.yaml` `tracking:` patch, seeding the first issue, the L2/L3 drive steps, the observation surface, and the B9 scoring checklist; targets P1, names P2 as second rung; states first failure taken back through `/faff-jot`.
- No faff CLI/skill source file modified. No secrets committed.

confidence: medium
spec-review: approve
