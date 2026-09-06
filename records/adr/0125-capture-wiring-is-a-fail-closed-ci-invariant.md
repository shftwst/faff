# ADR 0125 — Capture-wiring is a fail-closed CI invariant

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-09-06
- **Issue:** FAFF-1009

## Context

A decision-capture kernel becomes gradeable only when its base record carries a real `correlation_id`, and that id has exactly one runtime source: `FAFF_DECISION_CORRELATION_ID`, set by `faff decision-capture decide --export` in orchestrator prose before the kernel consult. If the prose is missing, the base mints an empty id and joins nothing.

FAFF-989 wired only `next` and `eligible` and left seven capture kernels un-wired. There was no mechanical guard on the wiring, so the gap shipped silently and stayed open until FAFF-1009 found it: seven kernels emitting an empty id on every substrate-present run, each ungradeable and each logging a degraded note. The wiring is prose in `SKILL.md` files, one `decide --export` line per site, so nothing but reviewer attention connected a `captureDecision` call site to the prose that feeds it an id. That is the failure mode that let the gap ship.

The question for FAFF-1009 was whether to fix the seven sites and rely on reviewer vigilance to keep them wired, or to make "a capture kernel cannot ship un-wired" a standing check.

## Decision

Every `captureDecision` call site must carry an adjacent `decide --export` for its kernel, and that is enforced by a fail-closed gate in `faff validate-adapters`.

The gate derives the kernel set from source rather than from a prose grep. It parses every `plugin/skills/faff/bin/lib/*.js` for a `captureDecision({ ... kernel: "<k>" ... })` call, reading the kernel argument across newlines so the multi-line `captureDecision({` form is matched (three sites use it: `claim-verdict.js:94`, `park-verdict.js:125`, `eligible.js:89`). A single-line regex would drop those and the gate would fail open on kernels that are in fact wired. The derived set is authoritative, currently the nine.

For each derived kernel, the gate asserts that some `plugin/skills/*/SKILL.md` contains a `decide ... --kernel <k> ... --export` line within 15 lines of a `faff <k>` consult, using a structural token match on a flagged `--kernel <k>`, not a naive substring. It fails closed: a derived kernel with no matching `decide --export` anywhere is a failure and exits 1; a read error on a source file is a hard tooling failure and exits 2, never a pass. This follows the FAFF-581 `lint-cli-coverage.js` precedent of "declared, not grep-guessed" (`lint-cli-coverage.js:10-14`).

The gate asserts presence of the id-minting wiring for all nine, both tiers. It does not assert an action marker, because the mint-and-silence tier has none by design (ADR 0124). The check that the verbs actually join when invoked is proven by a driver-shaped unit test, not by the gate. Paired, the gate and the driver test bound "done" as a CI check, so DONE no longer rests on inspecting a live run.

## Consequences

- A new capture kernel that ships without its `decide --export` wiring reddens CI. "A capture kernel cannot ship un-wired again" is a standing invariant, not reviewer vigilance.
- The gate is a prose-presence oracle. It asserts the wiring is present and adjacent; it does not assert runtime ordering. Whether the id is exported before the consult at run time is a monitorable signal, not something the gate enforces.
- The gate reuses `validate-adapters.js`, which already reads `SKILL.md` files across the skills tree, so it is a new gate-block over an existing traversal rather than new tooling.
- A per-kernel action-token vocabulary check is a possible in-scope addition where the vocabulary is declared as lint data, but it is secondary. The primary defence against token drift is spelling each Tier-1 action token literally at its site, which a human reviews in the diff.
