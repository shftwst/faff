# ADR 0128 — Repo-convention discovery as a deterministic CLI + contract

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-09-13
- **Issue:** FAFF-1041

## Context

faff hardcodes its own stylistic opinions — branch naming (`<issue>-<slug>`), Conventional-Commits commit-message grammar, and PR-title shape — and imposes them on every repo it grafts into. Dropped into a repo with its own documented or evident conventions, this makes faff feel like a foreign body and papercuts every graft.

faff already runs two other read-only "repo archaeology" passes that solve the analogous problem for other axes: `faff profile mine` (infra) and `faff gates discover` (enforced CI checks, `.github/workflows`). Both share a shape — deterministic, read-only, evidence-bearing, emitting a `faff-contract:*` block the orchestrator validates and caches to `.faff/*.json`, overlaid by `.faffrc`. No equivalent existed for the *stylistic* conventions faff assumes.

## Decision

Add `faff conventions` as a third leaf of the repo-archaeology family, in a new `plugin/skills/faff/bin/lib/conventions.js` mirroring `profile.js`'s shape:

- `faff conventions mine [--json] [--root DIR]` — deterministic, read-only. Scans standards docs (`CONTRIBUTING*`, `AGENTS.md`, `CONVENTIONS*`, `.github/` templates, `docs/**/{contributing,style}*`) then git history, and emits one `faff-contract:conventions` block. No network/install/subprocess beyond `git`; writes no files (the miner never writes — the orchestrator does, exactly as `profile mine` leaves the cache write to graft).
- `faff conventions get <key> [-d DEFAULT] [--json]` — the single resolver every consumption site calls, applying the full precedence (ADR-0129) and always exiting 0 with a value (never "unset" — the default is the floor).
- `faff conventions show` — prints the effective `ConventionSet` (`.faff/conventions.json` ⊕ `.faffrc conventions:`), exit 3 when never mined.
- `faff conventions --selftest` — exercises the precedence + threshold table in-process.

The record cache lives at `.faff/conventions.json` (gitignored, same as `.faff/infra-profile.json`), auto-mined when absent and refreshable on demand via `mine`. `get` is the only entry point a consumption site (graft's branch/commit/PR-title sites) is allowed to call — no site hand-reads `.faffrc` or a standards doc to resolve a convention itself (the CLI-only-config rule, and the deterministic-tool tenet: same input, same output, testable in isolation from any skill prose).

This establishes the pattern and resolver every future convention-consumption site builds on, which is why it is architecturally significant enough to record here rather than only in the spec.

## Consequences

- A new stylistic-convention axis exists alongside the infra and CI-gate axes; a future convention (e.g. changelog format, test-file naming) extends this same CLI + contract rather than inventing a fourth shape.
- Every graft consumption site that previously hardcoded a convention string (branch naming at Step 3; commit-subject grammar at Steps 4 / 4c / the merge-time ADR renumber) now calls `faff conventions get <key>` instead — a hardcoded string reappearing at any of those sites is a regression against this decision.
- `faff gates discover` stays authoritative for *enforced* conventions (sign-off, a CI-checked PR-title format); this CLI only ever resolves the non-gated stylistic layer and must never re-infer something a discovered gate already fixes (see ADR-0129 for the precedence that encodes this).
- The cache is read-only infrastructure: a corrupt or stale `.faff/conventions.json` degrades to a fresh `mine`, never a hard failure — the CLI has no persistent state to migrate.
