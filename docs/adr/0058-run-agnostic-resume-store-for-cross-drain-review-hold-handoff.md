# ADR 0058 — Run-agnostic resume store for cross-drain review-hold handoff

- **Status:** Proposed
- **Date:** 2026-07-12
- **Issue:** FAFF-403

## Context

FAFF-402 and FAFF-329 already give graft two per-issue checkpoint files — `build-progress.json` and `review-progress.json` — that make a build/review resumable *within a run*: they live at `<run-dir>/<ISSUE-ID>/`, and a re-dispatched build subagent inside the **same run** reads them to skip a completed build or a passed review Phase-1.

FAFF-403's retry-later hold is different in one load-bearing way: the hold must survive to the **next** `/faff-beep-boop` drain, which is very often a different run entirely (a different run-id, possibly hours or a day later, possibly triggered by a different invocation). `$run_dir` is fresh every run by construction — nothing in the existing checkpoint design anticipates a checkpoint outliving its run directory. Two ways to close that gap: (a) have the resuming run scan `.faff/runs/*/` for the newest checkpoint belonging to the held issue, or (b) copy the checkpoints out to one canonical, run-independent location at hold time, and copy them back in at resume time.

Option (a) inherits every ordering hazard already known to affect `.faff/runs/`: run-id mint formats have varied over time (mtime-ordering across mixed formats is not reliably chronological — precisely the reason `/faff-wtf`'s log-enrichment step already picks by mtime rather than name-sort), and an unbounded scan of every run directory ever created is wasted work on every single resume. There is also a precedent for exactly the alternative: `.faff/holdout/<ISSUE-ID>.json` already exists as a run-agnostic, per-issue artifact outside any run directory, precisely because holdout verdicts also need to outlive the run that produced them.

## Decision

**Chosen:** a run-agnostic resume store at `.faff/resume/<ISSUE-ID>/`, mirroring the run-dir checkpoint layout file-for-file (`build-progress.json`, `review-progress.json`), following the `.faff/holdout/<ISSUE-ID>.json` precedent rather than a run-directory scan.

Mechanically this is two copy operations at fixed points, no new CLI subcommand:

- **Stash, at the moment the retry-later disposition holds an issue** (graft Step 9): `mkdir -p .faff/resume/<ISSUE-ID>/` then copy both checkpoint files from `<run-dir>/<ISSUE-ID>/` into it.
- **Carry-forward, at the moment a later drain resumes the held issue** (graft Step 3): copy both files from `.faff/resume/<ISSUE-ID>/` into the *new* run's `<run-dir>/<ISSUE-ID>/`, then proceed through the existing FAFF-402/FAFF-329 resume logic completely unmodified — those verbs never learn about the resume store; they only ever read `<run-dir>/<ISSUE-ID>/`.
- **Clear, at any terminal disposition of a resumed review** (shipped, fail, needs-human, or a repeat hold that stashes fresh copies): `rm -rf .faff/resume/<ISSUE-ID>/`.

The fallback is **gated on the `faff-awaiting-review` label**, never attempted unconditionally: Step 3 only consults the resume store when the run-dir checkpoint is absent *and* the issue carries that label. An ordinary fresh issue (no label) never pays the extra filesystem read, and a resume-store hit with the label removed by hand is deliberately never consulted — the label is the sole switch. Because both files are read through the **same** `faff build-progress read` / `faff review-progress read` CLI verbs regardless of which directory they live in, no new read path was written for this — the mirrored layout is what makes that possible.

## Consequences

- Zero new CLI surface: the resume store is a copy destination, not a new subcommand, so there is nothing here for `faff validate-adapters` or the CLI-coverage tests to certify beyond what FAFF-402/329 already certify.
- The store is a **hint, never authoritative** — exactly like the run-dir checkpoints it mirrors. A stale or corrupted store still runs through the same diff-hash / branch-existence validation as an in-run checkpoint before it's trusted (git/PR truth wins on any disagreement); a mismatch discards the store and falls back to a full rebuild, so a lost or bad `.faff/resume/` entry costs a wasted rebuild, never a wrong resume.
- `.faff/` is already gitignored, so the store needs no new ignore rule and never leaks into a commit.
- This establishes `.faff/resume/<ISSUE-ID>/` as a second run-agnostic per-issue store alongside `.faff/holdout/<ISSUE-ID>.json`. A future third case needing the same cross-run-survival property should reuse this precedent (mirrored-layout copy, label-gated fallback) rather than inventing a third pattern or reopening the run-directory-scan option this ADR rejected.
- The store's lifecycle is coupled to the `faff-awaiting-review` label by construction: `/faff-tidy`'s stale-label auto-clear (removing the label when the issue moves to In Review/Done/Cancelled) must also clear the orphaned store directory, or a cleared label leaves dead files behind indefinitely.
