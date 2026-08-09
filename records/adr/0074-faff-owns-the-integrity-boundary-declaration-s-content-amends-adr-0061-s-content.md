# ADR 0074 — faff owns the integrity-boundary declaration's content — amends ADR-0061's content-origin split

- **Status:** Proposed
- **Date:** 2026-07-16
- **Issue:** FAFF-514
- **Amends:** ADR-0061 — adds the content-origin/boundary-origin split below; every ADR-0061 consequence still binds (this is an amendment, not a supersession).

## Context

ADR-0061 established that corrective-artifact integrity is *asserted*, never cryptographically enforced: under a shared uid faff cannot stop a same-uid build lane from forging a corrective artifact, so the only trust channel is an outer-layer, launch-time `FAFF_INTEGRITY_BOUNDARY=<version>:<dir1>,<dir2>,…` declaration read from pid-1's environ (FAFF-325 shipped that reader). ADR-0061's rule "faff asserts the boundary, it never creates it" forbade any consumer inventing a second trust signal or a second hand-written dir list.

Two facts made the *content* of that declaration a drift hazard:

- The dir set is defined in exactly one place in faff (`correctiveIntegrityDirs`), but every consumer that composed the declaration hand-wrote the dir names — and FAFF-466 adding `events.jsonl` to the detection surface is that drift happening once already (a consumer's hardcoded list silently omitted the new dir).
- The declaration is hand-written by a human at cage launch — the one L4 preflight leg faff cannot satisfy itself.

The question ADR-0061 did not answer: **who owns the declaration's content** — the dir-set schema and version token — as opposed to who creates the *boundary* (the mount) and who *sets* the declaration (the launcher)?

## Decision

**faff is the single source of truth for the declaration's CONTENT; the cage/launcher remains the single source of its TRUTH.** The two authorities split cleanly:

| Authority | Owner | Mechanism |
|---|---|---|
| **Content** — the (version, dir-set) the declaration must carry | **faff** | the new `faff integrity-boundary` emitter, derived from `correctiveIntegrityDirs` (never a second list) |
| **Boundary** — the read-only mount that makes the dirs actually protected | the cage (FAFF-517) | unchanged; faff never provisions it |
| **Declaration** — exporting the value into pid-1 environ | the launcher (human today, cage later) | unchanged; faff never sets it |

The emitter (`faff integrity-boundary`) prints the canonical declaration content so a consumer *shells* it rather than hard-coding dir names: default (launch grain) `v1:<abs-root>/.faff/runs` (the stable ancestor the coverage math accepts — per-run paths can't be named at cage launch); `--run-dir` (per-run grain) the exact `correctiveIntegrityDirs` set. **It never reads or validates pid-1 environ** — origin and reader stay separate authorities, so ADR-0061's assert-don't-implement boundary is untouched: faff still never provisions a mount, never sets the declaration, never verifies `:ro` is real.

**Two sub-decisions this amendment records:**

- **No declared==expected equality assertion.** A too-narrow declaration is already caught by the reader's coverage check (`dir-mismatch`), and with an ancestor-shaped canonical print future dirs under the ancestor are auto-covered. An equality check would additionally reject *over-broad* declarations — which reverses ADR-0061's explicit stance ("a declaration of `/` is not a code bug here… faff trusts the launcher's claim") and would break every honest hand-written declaration that names, say, the repo root. Coverage-only (⊇) stands.
- **The version token is provenance, not a gate.** No version gating exists anywhere in the reader (`v1` appears only in fixtures). faff owns an exported constant `INTEGRITY_BOUNDARY_VERSION = "v1"`, emits it, and the reader stays ungated (an arbitrary hand-written token still asserts — regression-tested). Bump the constant only if the *meaning* of the canonical print changes incompatibly; a dir-set addition under the ancestor is not a bump.

**Open, named (not decided here):** every claude-box engine-mode cage passes `--init`, whose root-owned `docker-init` pid-1 environ faff cannot read (an honest declaration there trips `env-injection`). The pid-1 *channel* decision for engine cages is FAFF-516 (blocking the cage-side mount, FAFF-517). This emitter is channel-agnostic — it owns content, not channel — and is correct under every FAFF-516 resolution.

## Consequences

- **A future dir-set addition is a faff-only change** (edit `correctiveIntegrityDirs`; every emitter consumer re-derives), with zero cage change — the FAFF-466 drift class is closed for consumers that shell the emitter.
- **The trust boundary is unchanged.** The reader's trust math (`correctiveIntegrityProbe` / `integrityGate` / `parseIntegrityDeclaration`) ships byte-identical; the only reader-side touch is the `no-declaration` remedy string naming the emitter as the composer.
- **Attestation, not a switch — inherited.** The declaration must only ever be exported as a *consequence* of the protection existing (the read-only mount). The emitter must not be used to fabricate a bare unconditional `export` without the mount — that produces a lying attestation, strictly worse than an honest REFUSE. faff ships no default/fallback declaration anywhere.
- **Textual-path consistency.** Coverage is textual prefix math, not realpath — the cli.md row documents "invoke the emitter against the same path the run will use"; a symlinked checkout that resolves differently fails closed at merge as `dir-mismatch`, honest.
- **ADR-0061 gains an `**Amended:**` forward-pointer** to this ADR; its Status and every consequence are otherwise unchanged.
