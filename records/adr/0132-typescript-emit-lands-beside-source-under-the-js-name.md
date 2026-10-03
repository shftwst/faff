# ADR 0132 — TypeScript emit lands beside source under the `.js` name (layout d)

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-03
- **Issue:** FAFF-1168

## Context

The v5 TypeScript foundation (addendum decision 1, option b, taken 2026-10-03) converts `bin/lib` modules to TypeScript source compiled to JavaScript, starting with the Commissaire cluster. The open question that blocks the first conversion (FAFF-1170): where does the emitted JavaScript live so one `plugin/skills/faff/bin/faff` keeps working across all four install paths, with adopters needing no TypeScript, no loader, and no Node version beyond today's floor (Node 20)?

`bin/faff` is CommonJS with no `package.json` and eagerly `require("./lib/X")`s every module with **extensionless** specifiers. Node resolves `require("./x")` to `x.js`, never `x.ts`. Three candidate layouts were scored (a fourth, no committed emit, was eliminated before the experiment by the committed-emit-checked-in-CI principle that FAFF-1171 depends on):

- **(a)** emit beside source; `bin/faff` prefers `.ts` when Node can strip types, else `.js`; importers name `./x.ts`.
- **(b)** emit to a `dist/` tree the manifest, link script and release workflow point at; the whole `bin/lib` passes through `tsc` with `allowJs` so even unconverted importers get their specifiers rewritten.
- **(d)** emit beside source under the **old `.js` name**; importers unchanged (extensionless `require("./x")` already resolves the emit); tests import `.ts` directly for the source lane.

## Decision

Adopt **layout (d)**: the TypeScript compiler emits each converted module's JavaScript beside the source under the same basename (`producer-auth.ts` → `producer-auth.js`), importers keep their existing extensionless `require("./producer-auth")`, and the committed `.js` emit is what every install path runs. The dev source lane runs `.ts` only where a test imports it explicitly; ordinary extensionless requires resolve the committed `.js`.

This relaxes the FAFF-101 project's provisional "importers name `.ts`" definition-of-done line. The experiment shows that line is not merely relaxable but actively harmful: naming `.ts` is exactly what breaks adopters.

### Evidence

A resolution experiment on real runtimes (the layout question turns on Node's module resolver, which is indifferent to whether a `.js` was hand-staged or `tsc`-produced):

| require form | Node 24.15 (dev source lane) | Node 20.20 (adopter path) |
|---|---|---|
| extensionless `require("./x")`, `.js` emit present | resolves, exit 0 | resolves, exit 0 |
| `require("./x.ts")` (layout a's importer) | resolves via type-strip, exit 0 | **fails `MODULE_NOT_FOUND`, exit 1** |
| extensionless `require("./x")`, both `x.js` and `x.ts` present | `.js` wins | `.js` wins |

Commands: `node imp-extensionless.js` and `node imp-dotts.js` against a branded-type leaf fixture plus its `.js` emit; the adopter cells ran in a `node:20` container (`node:20.20.2`), the dev cells on native Node 24.15.0. The `.js`-wins-precedence cell ran on Node 20.

- **Layout (a) is disqualified** by selection-ranking step 1 (a fail on an adopter path on Node 20): an unconverted `.js` importer that resolves `./producer-auth.ts` crashes on Node 20.
- **Layouts (b) and (d) both pass** on both runtimes (extensionless require resolves the `.js` emit).
- **(d) beats (b)** on selection-ranking step 3 (smallest standing production surface, tie-break to least-changed importers and entrypoint): (d) changes no importer and no entrypoint and adds no tree, where (b) adds a `dist/` tree plus manifest, link-script and release-workflow repointing and a whole-`bin/lib` `allowJs` pass.

### What this constraint buys and costs

The four constraints hold for (d): adopters run plain JavaScript (the committed `.js`, no loader, Node 20 unchanged); one `bin/faff` serves every path unchanged; it is compatible with a committed-emit CI freshness check; and no Node floor moves for adopters.

The cost, and the reason FAFF-1171 and FAFF-1172 are not optional: because extensionless requires resolve the committed `.js`, the dev box runs **stale emit** if a `.ts` edit is not rebuilt. The freshness gate (FAFF-1171, fail CI on a stale committed emit) and the `faff doctor` stale-emit check (FAFF-1172) are the safety net that makes (d) safe.

## Consequences

- **FAFF-1170** converts `producer-auth` and lands the toolchain under layout (d): `tsc` emits `producer-auth.js` beside `producer-auth.ts`, `commissaire.js` keeps `require("./producer-auth")` unchanged, the emit is committed.
- **FAFF-1171** gains teeth it must have under (d): `tsc --noEmit` plus `npm run build` plus `git diff --exit-code` on the emit paths, on a Node 22+ runner, so a stale committed emit fails CI.
- **FAFF-1169** must treat a `.ts`+`.js` pair as one module (the `.ts` is the source, the `.js` the emit) and count one require edge, not two.
- The FAFF-101 project definition-of-done line "their importers' require lines name `.ts`" is **struck**; importers stay extensionless.

### What the spike proved versus what FAFF-1170 re-checks

Proved on real runtimes: the module-resolution behaviour that decides all four install paths (Node 20 refuses `.ts`; extensionless resolves `.js`; `.js` wins a `.js`/`.ts` tie). Not performed here, deferred to FAFF-1170 which does the real conversion anyway:

- A real `tsc` emit of `producer-auth.ts`. `npx typescript` had no network in this environment; per the spec's assumption the blocker is recorded rather than a dependency landed. The resolution decision does not depend on it (Node's resolver is indifferent to how the `.js` was produced), but FAFF-1170 must confirm a real `tsc` emit under `erasableSyntaxOnly` + `rewriteRelativeImportExtensions` is byte-stable.
- Per-path shell assembly (symlink / marketplace copy / in-checkout / governance action) with `faff commissaire --selftest` as the probe. Each path reduces to the same resolver behaviour proved above; FAFF-1170 re-confirms them on the real converted module as its acceptance.

## Status note

`Proposed`. FAFF-1170 (the first real conversion) is the acceptance that flips it, or narrows it if a real `tsc` emit surfaces a resolution wrinkle the hand-staged fixture did not.
