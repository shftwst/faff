# ADR 0052 — CLI module layout: layered region-aligned modules behind a thin entrypoint

- **Status:** Proposed
- **Date:** 2026-07-10
- **Issue:** FAFF-441

## Context

`plugin/skills/faff/bin/faff` is a single 16,659-line CommonJS file holding all 53 CLI
subcommands and the deterministic machinery behind faff's gates. The adversarial-review
context rule (ADR-relevant: FAFF-183) assembles review context as the gateway `SKILL.md`
plus **every touched file**, so any diff touching `bin/faff` ships all ~261k tokens of it —
which exceeds every phase-2 reviewer window in the fallback chain. The L4 second-opinion
gate is therefore structurally unavailable for exactly the file carrying most of faff's
governance code, and the file is unnavigable for humans.

ADR 0042 partitioned the file into machine-tagged regions (`shared-infra` / `governance` /
`factory` / dispatch shell) with a one-way direction invariant, and explicitly predicted its
own evolution: "if the file is ever modularised, the lint retires in favour of real module
imports." This ADR records the modularisation ADR 0042 anticipated. Two questions the split
must settle: **the module boundary shape** (per-subcommand surfaces vs layered span-aligned
modules) and **where the dispatch shell / path anchors / self-respawn constant live** so that
behaviour stays byte-identical across both install shapes (symlink and `CLAUDE_PLUGIN_ROOT`
copy).

## Decision

`plugin/skills/faff/bin/faff` stays the single shebang CommonJS entrypoint, reduced to the
**dispatch shell only** — the `COMMANDS` registry, `USAGE`, `main()`, the `require.main`
gate, and a three-name export tail. All other code moves verbatim into `.js` CommonJS
modules under `plugin/skills/faff/bin/lib/`, `require()`d eagerly from the entrypoint.

- **Boundary shape — layered, region-aligned modules.** Modules align to the ADR-0042 region
  banner spans (not one-module-per-subcommand): the boundary the codebase already
  machine-enforces, keeping each region's future extraction unit intact. Handlers physically
  mislocated in today's banner spans move to content-matching homes; the builder traces
  `function cmd*` bodies, never banner ranges alone. No module exceeds ~3,000 lines.
- **`shared-infra.js` is the single dependency-root** and the one home for path anchoring —
  it exports `HERE` (`path.resolve(__dirname, "..")`, identical value to today's `__dirname`
  from one level deeper) and `ENTRYPOINT` (`path.resolve(__dirname, "..", "faff")`). All
  former `path.resolve(HERE, …)` consumers and both `__filename` self-respawn sites import
  from it, so the anchors are correct under both install shapes.
- **Cross-module imports are destructured, eager, and acyclic**, honouring the ADR-0042
  direction invariant. Destructured (not namespace-object) requires keep every cross-module
  reference visible to the direction lint, which is repointed to scan the union of the
  entrypoint plus every `lib/*.js` — so the guard keeps enforcing the same invariant over the
  module set rather than going vacuous against a thin entrypoint.
- **`cmdRegions` receives `COMMANDS` by injection at dispatch** (the entrypoint requires
  `regions.js`; a back-require would be a cycle), so the dispatch shell stays whole in the
  entrypoint without a `shell.js` module.
- **Module format is `.js` CommonJS** (no `package.json` ⇒ `.js` is CJS): plain synchronous
  `require()` from the extensionless CJS entrypoint, zero interop risk, dependency-free
  preserved (`node:` builtins only, no bundler, no build step).

Correctness is proven mechanically by the byte-identical parity harness
(`scripts/verify-split-parity.mjs`, FAFF-440/442), not by inspection.

## Consequences

- Review cost becomes proportional to *diff* size, not *file* size: a one-module diff ships
  ~1–3k lines plus the thin entrypoint, well inside every phase-2 reviewer window — the L4
  second-opinion gate is restored for CLI changes by construction.
- **Supersedes in part ADR 0042's single-file constraint** — the modularisation that ADR
  predicted. ADR 0042's `regions` text lint is repointed (not retired) in this change so no
  guard goes vacuous; its formal retirement in favour of require-graph enforcement, and ADR
  0042's own **Status flip**, ride a dedicated follow-up ticket (a surface change, out of this
  pure-move PR's scope). Until then ADR 0042 stays **Proposed** and its direction invariant
  keeps being enforced.
- The governance modules under `bin/lib/` become the concrete extraction unit ADR 0042's
  extraction topology assumed — physical package extraction is now a directory move.
- Every module load is eager at entrypoint start, so any wiring fault (missing export, cycle,
  typo) faults every subcommand loudly and is caught on the parity matrix's first row —
  matching today's whole-file-parsed-up-front semantics.
- Accepted cost: ~40 sibling files under `bin/lib/` replace one navigable-by-search file; the
  trade buys human navigability and reviewability. The dependency-free, single-entrypoint,
  both-install-shape properties are unchanged.
