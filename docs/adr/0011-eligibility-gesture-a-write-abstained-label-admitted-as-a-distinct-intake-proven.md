# ADR 0011 — eligibility-gesture: a write-abstained label admitted as a distinct intake-provenance basis

- **Status:** Accepted
- **Date:** 2026-06-23
- **Issue:** FAFF-223

## Context

The provenance family (FAFF-212/217/218) hardened the *machine* side: an agent must prove its work entered through the front door before it is auto-built. The human side never closed. A human who creates a ticket directly in the tracker — the encouraged control surface (FAFF-19) — is the one case faff has no creation hook for, so it can auto-stamp no provenance at birth. Under `intake_gate: block`, the only remedy faff offered was `faff intake-record <ISSUE> --via backfill` — a *CLI gesture*. That turns a migration tool into a steady-state human ceremony and violates the family's governing rule: **provenance burden lives machine-side; the human's control surface stays native-tracker, zero-CLI.**

Two axes are deliberately kept separate by 212/218: *eligibility* ("may this be auto-built?", the `faff-automate`/`faff-automation-hold` axis) and *intake* ("did this enter through the front door?"). The pressure here is to let a human's existing tracker gesture satisfy intake without typing a command — while not eroding that separation into a single undifferentiated "human sanction" signal that a reviewer can no longer read in the audit trail.

The enabling fact comes from FAFF-218 (ADR 0009): the faff CLI now *write-abstains* on `faff-automate` (it is `tracker_owned: true`; the CLI refuses to add or remove it). So a present `faff-automate` proves a human toggled it in the tracker UI — by construction, not by honour system.

## Decision

Admit a human-set `faff-automate` as intake provenance via a **new, distinctly-named intake-provenance basis — `eligibility-gesture`** — rather than by merging the eligibility and intake verdicts.

- `intakeVerdict` gains one branch: with no recorded marker and no `faff-jot-intake` label, a `faff-automate` in the label set yields `{ satisfied: true, basis: "eligibility-gesture" }`.
- **Precedence is strongest-evidence-first:** a recorded marker (`jot`/`backfill`/`fast_track`) > `grandfathered-label` > `eligibility-gesture`. The recorded marker still wins, and a `faff-jot-intake`-labelled migration ticket still surfaces its `warn`.
- **`eligibility-gesture` carries no `warn`.** Unlike `grandfathered-label` — a spoofable legacy bridge — a write-abstained `faff-automate` is trustworthy by construction (FAFF-218), so it is a clean pass.

Rejected: merging eligibility into intake (Option A) — it collapses the two axes and leaves an illegible audit trail. The distinct basis name is the whole point: a reviewer can tell label-derived intake from a real front-door jot marker.

This decision is the basis itself. It is paired in the same slice with an `--interactive` bypass on `intakecheck` (the human at the keyboard is the sanction; autonomous graft is unchanged), but that bypass is a mechanical flag, not an architecturally-significant cross-slice rule — the durable rule recorded here is *the new basis*.

## Consequences

- **A human creates work in the tracker and (if they want it automated) toggles `faff-automate` — and that is sufficient intake provenance.** No CLI, ever, on the human path; the zero-CLI-human-surface rule (FAFF-19) is restored.
- **The two axes stay distinct.** Eligibility computation (`faff eligible`) is untouched; intake reads the label only as *evidence*. The audit trail stays legible because the basis is named distinctly from `jot`/`backfill`.
- **Load-bearing on FAFF-218 (ADR 0009).** The basis is sound *only because* the CLI write-abstains on `faff-automate`. If that write-abstention regressed, `eligibility-gesture` would become agent-spoofable — exactly the FAFF-209 failure the intake marker was built to close. Any future change to `tracker_owned` on `faff-automate` must re-evaluate this basis.
- **Composes forward with FAFF-220's `initiated` field (now merged).** The human-gesture path stays marker-absent-but-accepted: it derives provenance live from the label and writes no synthetic marker (writing one would itself be a machine ceremony contradicting zero-CLI). FAFF-220's interactive-presence stamp of `initiated: interactive` operates at the marker level and is neither blocked nor pre-empted here.
- **No dedicated "human-sanctioned" write-abstained label is added.** A human who wants provenance without automating is self-contradictory — not automated ⇒ no autonomous consumer ⇒ the intake gate never fires — so the case needs no mechanism.
- **Future intake bases follow the same shape:** admit new human-trust signals as distinctly-named bases, never by collapsing into an existing verdict, so the basis string stays a legible audit record.
