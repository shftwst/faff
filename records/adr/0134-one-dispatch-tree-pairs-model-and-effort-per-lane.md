# ADR 0134 — One dispatch tree pairs model and effort per lane

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-06
- **Issue:** FAFF-1197
- **Supersedes (in part):** ADR-0050, only its prep-boundary exclusion (no effort on `spec`, `spec_review`, `prep_explore`, `architecture` and `adr`) and its parallel-tree shape (`models:` and `effort:` as two trees). The closed vocabularies with fail-loud reads, `inherit` omitting the parameter, the inline/subagent boundary, compose-not-subsume with the `adversarial` block, eval outside the surface (ADR-0133) and ADR-0108's no-effort-by-confidence rule stay in force.

## Context

ADR-0050 gave effort to `build`, `methodology` and `intake` only, in a second tree (`effort:`) beside `models:`. Its premise was that the prep lanes must stay pinned to a capable model and effort, because a thin spec poisons every build that follows.

Two things have since weakened that premise.

- **Evidence.** On the three hardest refutation-spec eval cases, `claude-opus-5-5` passed 15 of 15 at low effort, 9 of 15 at medium and 4 of 15 at high, and the CLI's default effort differs by model (high for `claude-opus-5`, medium for `claude-opus-5-5`). The write-up is `records/spikes/2026-10-03-opus-5-5-pragmatism/results.md`. Lower effort on a prep lane can be the better setting, so the exclusion removes a lever that matters.
- **The pin was weaker than it looked.** `inherit` follows the session model, so it never guaranteed a capable model (FAFF-1161). Leaving effort off the prep lanes did not make them safe.

Two parallel trees that only three lanes populate on both sides also make a lane's model and effort hard to read, set and migrate together.

## Decision

One `dispatch:` tree holds a node per subagent-dispatched lane: `build`, `prep_explore`, `spec`, `spec_review`, `methodology`, `intake`, `architecture` and `adr`. Each node carries two independent fields, `model` and `effort`, in block form. `build` also takes `by_tier.<tier>` nodes (model and effort) and `by_confidence.<confidence>` nodes (model only).

- **Each field resolves on its own.** A non-empty `dispatch:` value wins at its position, otherwise the matching `models:` or `effort:` value applies, otherwise `inherit`. Positions are overlaid one by one and the existing chains then run once, so the most specific position wins whichever tree set it.
- **`faff dispatch resolve <lane>`** returns both fields. The overlay is applied by the resolvers (`dispatch resolve`, `models build-for`, `effort build-for`, `engine call`). `faff config get` stays a raw read.
- **Fail loud.** Every `dispatch:` value is checked against a closed vocabulary, and the whole tree is validated on each resolve. An off-vocabulary token, an unknown lane or field, `engine:<name>` outside `methodology` and `intake`, effort under `by_confidence` and an inline `{...}` map all exit 2.
- **No registry defaults.** `DEFAULTS` carries no `dispatch.*` entry, because a default would count as set and stop a position falling through to the old tree.
- **Additive.** The old `models:` and `effort:` trees keep working. FAFF-1198 rewires the skill dispatch sites, migrates this repository's config and removes the old trees.

What stands from ADR-0050 and its neighbours:

- Closed vocabularies with fail-loud reads, and `inherit` omitting the parameter, so the no-config path is byte-identical.
- The inline/subagent boundary: `review` and `ship` have no Agent-tool dispatch to carry a parameter and get no node.
- Compose-not-subsume: the adversarial judge's tuning stays in its own `adversarial` block.
- Eval is not a dispatch lane. Its settings live in `eval.model` and `eval.effort` (ADR-0133), and `dispatch.eval.*` exits 2.
- No effort by confidence (ADR-0108): `dispatch.build.by_confidence.<c>.effort` exits 2 and points at `by_tier`.

## Consequences

- Effort is tunable on every dispatch lane, and a lane's model and effort sit side by side in one place.
- Between this change and FAFF-1198, `dispatch:` values for the lanes other than `build` and the engine-valued lanes are accepted and echoed in the run banner but not yet read at the skill dispatch sites. The banner marks those lines. If FAFF-1198 is cancelled, a replacement ticket for the dispatch-site rewiring comes first.
- The prep boundary is no longer enforced by omission. Down-tuning a prep lane is an explicit, visible setting, and its effect is measurable with `faff economics --by effort` and the eval pass rates.
- Engine capability checks (graded-effort family, `reasoning_off`, the `xhigh` and `max` clamp) stay in `resolveEngineForLane`, which names the `dispatch:` key a value came from.
- The dispatch vocabulary, validator and overlay live in `config.js` and the verb in `lib/dispatch.js`, which avoids an import cycle with `effort.js`.
- Reading `dispatch:` with `faff config get` at a new call site skips the overlay and the old-tree fallback. New call sites use `faff dispatch resolve`.
