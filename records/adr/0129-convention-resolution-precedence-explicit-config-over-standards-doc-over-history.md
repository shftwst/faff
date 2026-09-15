# ADR 0129 — Convention resolution precedence: explicit config over standards doc over history-inferred over faff default

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-09-13
- **Issue:** FAFF-1041

## Context

`faff conventions get <key>` (ADR-0128) has multiple possible signal sources for a single stylistic convention — an operator's explicit `.faffrc conventions.<key>` override, a repo's own standards doc, a pattern inferred from git history, and faff's own hardcoded default. These sources can disagree (a repo's `CONTRIBUTING.md` says one thing, its actual commit history shows another; an operator overrides what the docs say). A resolver with no fixed precedence would be non-deterministic in practice — the "which source wins" call would have to be re-litigated, or worse, silently vary, at every consumption site.

A second, related risk is over-eager inference: a noisy or roughly-even split in git history is not a signal a repo actually has a convention — adopting a guess there risks flipping to a grammar the repo's own CI then rejects, which is worse than keeping today's default.

## Decision

Resolution runs a fixed, ordered fallthrough — **explicit config > standards doc > history-inferred (above a dominance threshold) > faff default**:

1. **Explicit** — `faff config get conventions.<key>` set → `{ value, source: explicit, confidence: high }`. An operator's config is stated intent and always wins.
2. **Documented** — a fixed-order standards-doc walk (`CONTRIBUTING*`, `AGENTS.md`, `CONVENTIONS*`, `.github/PULL_REQUEST_TEMPLATE*`, `.github/*commit*`, `docs/**/{contributing,style}*`); the first file with a confident, unambiguous statement of `<key>`'s scheme wins, citing the file. An ambiguous or conflicting doc statement is treated as no-signal and falls through — never adopted as a guess.
3. **Inferred** — only once docs are silent, study `history_window` (default 200) commits; adopt the dominant scheme only when its share is ≥ `history_dominance` (default 0.7) over a minimum sample floor (~20), with `confidence: high` at ≥0.85 share else `medium`. Below the threshold: fall through to default with `confidence: low`, recording the ambiguity rather than guessing.
4. **Default** — faff's current hardcoded value, `confidence: low`. The floor: a repo that documents nothing and shows no clear history behaves byte-identically to today.

Both `history_window` and `history_dominance` are exposed as tunable `.faffrc conventions.*` knobs (unvalidated defaults at ship time, revisited against calibration data), never hardcoded inside the resolver.

This precedence composes with, and is always overridden by, a **discovered CI gate**: where `faff gates discover` already fixes a convention as an enforced check (e.g. a Conventional-Commits PR-title check), that gate is authoritative and this resolver must return the gate-conformant value regardless of what history infers — style discovery never re-infers or overrides a real gate.

## Consequences

- Every future convention added under this CLI inherits this same four-tier fallthrough rather than each convention getting a bespoke precedence rule — a new convention's resolver is "which four sources, in this order," not a new design.
- The "never adopt a guessed convention" principle is structural (the dominance threshold + sample floor), not a per-call judgement call a consumption site could get wrong — a wrong-but-confident adoption fails toward the default, not toward whichever value the last inference run happened to compute.
- A future change to the threshold defaults (200 / 0.7) is a config-value tune, not a resolver redesign, because the knobs are already externalized to `.faffrc conventions.*`.
- Any future stylistic convention that is *also* subject to a discoverable CI gate must route through the same gate-beats-style rule this ADR establishes, rather than re-deriving the boundary independently.
