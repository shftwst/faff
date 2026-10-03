# FAFF-1168 — where emitted JavaScript lives (layout spike)

> Spec: faffter-dark-nlspec · 2026-10-03 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1168.
> build-tier: complex

FAFF-1168 is a one-day spike. Its deliverable is a recorded decision, not shipped code: no production code lands. The spec defines the decision to reach, the experiment that reaches it, and the evidence the decision note must carry.

## WHY

One file, `plugin/skills/faff/bin/faff`, is the single entrypoint for every way faff is installed. It is `#!/usr/bin/env node` CommonJS with no `package.json`, and eagerly `require("./lib/X")`s every subcommand module with extensionless specifiers. Node resolves `require("./x")` to `x.js`, never `x.ts`. When some `bin/lib/*.js` modules become `.ts` source compiled to JavaScript, the emitted `.js` must land where this one entrypoint keeps working for all four install paths, with adopters needing no TypeScript, no loader, and no Node version beyond today's floor.

Principles the chosen layout must satisfy:

- Adopters stay on plain JavaScript — the marketplace copy and the pinned governance action run with no TypeScript dependency, no loader, no Node bump above today's Node 20.
- One entrypoint, every path — a single `bin/faff` serves all four paths, no per-path wrapper.
- Committed emit, checked fresh in CI — generated output is committed and its freshness checked (consumed by FAFF-1171). A layout with no committed emit is ruled out before the experiment.
- The spike lands no production code — disposable scratch build, revert everything but the decision note.

## The four install paths

1. dev symlink — `scripts/link-skills.sh` symlinks `bin/faff` into `~/.local/bin/`; the only source lane (can run `.ts` on dev Node 22.18+).
2. marketplace copy — the root manifest's `source: ./plugin` copy, run under `CLAUDE_PLUGIN_ROOT` on adopter Node 20.
3. in-checkout — `node plugin/skills/faff/bin/faff <sub>`.
4. pinned governance action — `.github/actions/governance-check/action.yml`, in-checkout or fetched binary; consumer provides Node.

## The candidate layouts

Candidate (c), no committed emit, is eliminated before the run by the committed-emit principle. The spike runs:

- (a) emit beside source; `bin/faff` prefers `.ts` when Node strips, else `.js`; ships `.ts` in the copy. Risk: an unconverted `.js` importer that resolves `./x.ts` fails on adopter Node 20.
- (b) emit to a `dist/` tree the manifest, link script and release workflow point at; the whole `bin/lib` passes through `tsc` with `allowJs`. The carried default if the spike is skipped.
- (d) emit beside source under the old `.js` name; importers unchanged (extensionless `require("./x")` already resolves the emit); tests import `.ts` directly for the source lane. Thinnest; relaxes the "importers name `.ts`" line.

## The experiment

Convert `producer-auth.js` (a 185-line leaf, required extensionless only by `commissaire.js`) to `.ts` once. For each surviving layout, build the emit it prescribes into a scratch directory, assemble each install path, and run the probe `faff commissaire --selftest` (oracle: exit 0 and `commissaire selftest: ok`) under that path's Node version. Adopter paths run on Node 20; the dev symlink source lane on dev Node. Record a matrix cell per (layout, path): exact command, Node version, pass or fail, note.

## Selecting the winner

1. Discard any layout with a fail on an adopter path on Node 20.
2. Discard any layout that needs a per-path entrypoint or wrapper.
3. Among survivors, prefer the smallest standing production surface, tie-break toward least-changed importers and entrypoint.
4. One survivor is the choice; a genuine residual tie escalates to the maintainer in the ADR (status: proposed).

## Where the decision is recorded

**Chosen:** a new ADR, `records/adr/<next>-<slug>.md`, cross-linked by one line from the v5 addendum's decision 1 "Taken" note. The addendum is a draft point-in-time record; a load-bearing sub-decision that FAFF-1170 and FAFF-1171 must cite belongs in the durable ADR log alongside ADR-0122 and ADR-0123.

## DONE

- A decision names one chosen layout among (a), (b), (d), with (c) recorded as rejected by the committed-emit principle, and keeps one `bin/faff` serving all four paths.
- The ADR exists at the next free number, cross-linked from the addendum, and asserts the four constraints true; it names which FAFF-1170 and FAFF-1171 decisions it feeds.
- `producer-auth.js` was converted once and `commissaire --selftest` was the probe; the ADR carries a matrix with exact command and Node version per cell; adopter paths ran on Node 20; the ADR states which path shapes were real and which scratch-simulated.
- After the spike the working tree holds only the ADR and the addendum cross-link; no `tsconfig`, build script, `package.json`, or committed `.ts` remains.

## Key assumptions

- **Assumes:** dev Node 22.18+ for the source lane (else record the source-lane cell as environment-blocked, not a layout failure).
- **Assumes:** a Node 20 runtime for the adopter paths; the decision cannot be trusted without it.
- **Assumes:** a TypeScript compiler runnable disposably; if it cannot run offline, record the blocker rather than land a dependency.

confidence: high
spec-review: approve (architectural, infosec, QA — single-pass)
