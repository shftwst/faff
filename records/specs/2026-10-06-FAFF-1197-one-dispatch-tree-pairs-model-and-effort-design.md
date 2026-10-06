# FAFF-1197: One `dispatch:` tree pairs model and effort for every subagent-dispatched lane

> Spec: faffter-dark-nlspec · 2026-10-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1197.
>
> Revised 2026-10-05 after spec-review rounds 1 and 2: the overlay deep-copies nested matcher maps, the validator applies to leaf keys only, the additive window to FAFF-1198 is guarded by a banner annotation and a pre-merge check (human decision), engine errors name the source key by a direct config check, the overlay refuses a non-map old-tree parent, and whole-tree validation is stated for all four resolvers. Round 2's objections were applied and the spec was accepted by the human reviewer.

This spec is for the build agent implementing FAFF-1197 and for the humans reviewing it. It adds a single `dispatch:` config tree where each subagent-dispatched lane carries its model and its reasoning effort side by side, a `faff dispatch resolve` verb that returns both, and an ADR that supersedes ADR-0050 in part. The change is additive: the old `models:` and `effort:` trees keep working, and FAFF-1198 removes them later.

## 1. WHY

**The idea the rest turns on.** Today a lane's model and its effort live in two parallel trees (`models.<lane>` and `effort.<lane>`) that only three lanes populate on both sides. This ticket gives every subagent-dispatched lane one node, `dispatch.<lane>`, with two independent fields, `model` and `effort`. Each field resolves on its own: a value under `dispatch:` wins at its position, otherwise the matching old-tree value applies, otherwise `inherit`. `inherit` means "omit the parameter", so a repo with no `dispatch:` block dispatches byte-for-byte as it does today.

**Problem.** ADR-0050 gave effort to only `build`, `methodology` and `intake`, on the premise that prep lanes must stay "pinned to a capable model/effort". Evidence now cuts the other way: on the three hardest refutation-spec eval cases, claude-opus-5-5 passed 15/15 at low effort, 9/15 at medium and 4/15 at high, and the CLI's default effort differs by model (high for claude-opus-5, medium for claude-opus-5-5), per `records/spikes/2026-10-03-opus-5-5-pragmatism/results.md`. The pin is also weaker than it looks: `inherit` follows the session model, so it never guaranteed a capable model (FAFF-1161). This ticket makes effort tunable on every dispatch lane and puts model and effort in one place.

### Design principles

**No-config is byte-identical.** With no `dispatch:` key anywhere, every resolver, the banner and every dispatch produce exactly today's output. Any implementation that changes the no-config path is wrong.

**Fail loud, never silently inherit.** Every `dispatch:` value is checked against a closed vocabulary. An off-vocabulary token, an unknown lane, an unknown field or an unparsed inline map exits 2 naming the problem. This is the FAFF-50 / FAFF-315 rule the old trees already follow.

**Each field resolves independently.** A node that sets only `effort` still resolves `model` down the rest of the chain, and the reverse. Model and effort are paired in the file, not coupled in resolution.

**Resolvers, not raw reads, carry the new tree.** The overlay lives inside faff's resolvers (`faff dispatch resolve`, `faff models build-for`, `faff effort build-for`, the engine-lane resolver). `faff config get <key>` stays a plain key read.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` `DEFAULTS` (models.* lines ~192-207, effort.* ~215-217) | JavaScript | The flat dotted-key registry; gets no `dispatch.*` entries (see the defaults decision) |
| `config.js` `MODEL_LANE_VOCAB` / `validateModelLane` (~349-381) | JavaScript | Closed model vocabulary and the `engine:` allowlist (`ENGINE_CALL_LANES = ["methodology","intake"]`, ~388) the new validator reuses |
| `config.js` `EFFORT_LANE_VOCAB` / `validateEffortLane` (~571-591) | JavaScript | Closed effort vocabulary; today fails loud on `effort.spec`, `effort.eval` and similar |
| `config.js` `resolveBuildModel` / `resolveBuildModelForTier` / `resolveBuildModelForIssue` / `cmdModels` (~2984-3085) | JavaScript | The build-model chain the overlay feeds |
| `plugin/skills/faff/bin/lib/effort.js` `resolveBuildEffort` / `cmdEffort` | JavaScript | The build-effort chain the overlay feeds; the module shape the new verb copies |
| `config.js` `resolveEngineForLane` (~491-560) and `lib/engine.js` (~189, ~326) | JavaScript | Engine-lane model and effort resolution, family capability checks, xhigh/max clamp |
| `config.js` `config resolved` banner (~2884-2931) | JavaScript | Echoes non-default lanes; gains `dispatch` lines |
| `config.js` `WRITABLE_NAMESPACES` (~1374) and `cmdConfigSet` validators (~1572), `config get` validators (~2689) | JavaScript | Namespace guard and read/write validation seams |
| `lib/shared-infra.js` `parseYamlSubset` / `scalar()` (~340-460) | JavaScript | Parses nested block maps at any depth; a YAML flow map `{ model: opus }` is returned as a plain string |
| `records/adr/0050-…`, `records/adr/0108-…` | Markdown | ADR-0050 is partly superseded; ADR-0108 forbids an effort-by-confidence key |
| `plugin/skills/faff/bin/faff` `COMMANDS` (`models` ~266, `effort` ~284), `lib/cli-surface.js`, `docs/guide/cli.md` | JavaScript, Markdown | Where a new verb registers and is documented |

**Scope.** This sits in the "Cost-aware model & transport routing" project as the config and CLI half of the consolidation; FAFF-1198 is the prose, migration and removal half.

## Already shipped against this surface

- **FAFF-416** (Done): per-slot model and effort routing; added the `effort:` tree for build, methodology and intake, recorded in ADR-0050.
- **FAFF-417** (Done): the build-tier bucket; added `models.build_by_tier` and `effort.build_by_tier`, recorded in ADR-0108.
- **FAFF-422** (Done): `engine:<name>` values on the methodology and intake model lanes.
- **FAFF-705** (Done): graded effort on engine lanes, checked against the engine family's capability.
- **FAFF-1158** (Done): interactive producers are dispatched as subagents so model and effort config can apply to them.

None of these consolidated the two trees; the premise of this ticket still holds.

## 2. OUT OF SCOPE

- **Rewiring skill dispatch sites to `faff dispatch resolve`.** Why: the human decision puts the prose sweep in FAFF-1198. Extension point: the Producer dispatch paragraph in `plugin/skills/faff/references/kernel.md` (~339), `faff-prep/SKILL.md` (~406), `faff-graft/SKILL.md` (~327), the two concurrency executors and `faff-beep-boop/SKILL.md` (~247).
- **Removing `models:` / `effort:` and migrating this repo's `.faffrc.yaml`.** Why: FAFF-1198 does both with no compatibility period. Extension point: `DEFAULTS`, `MODEL_LANE_VOCAB`, `EFFORT_LANE_VOCAB`, `WRITABLE_NAMESPACES`.
- **A `validate-adapters` lint for stale `models.<lane>` / `effort.<lane>` prose.** Why: FAFF-1198 owns it. Extension point: `faff validate-adapters`.
- **Documenting `dispatch:` in `.faffrc.example.yaml`.** Why: see the example-file decision below; it becomes the documented surface when FAFF-1198 makes it the only one. Extension point: the `models:` block at `.faffrc.example.yaml` ~119-127.
- **The stale kernel.md sentence that non-inherit effort on an engine lane is "refused at dispatch"** (kernel.md ~172; stale since FAFF-705). Why: kernel prose belongs to the FAFF-1198 sweep. Extension point: kernel.md "Model lanes" rules paragraph.
- **The eval lane.** Why: human decision; eval is not a dispatch lane. Its settings live in their own `eval:` block (`eval.model`, `eval.effort`), moved there with the `claude-opus-5-5` eval baseline. Extension point: `eval/run-evals.mjs`, `eval.model`, `eval.effort`.
- **Whether `inherit` should keep following the session model** (FAFF-1161). Why: a separate contract decision that does not block this ticket. Extension point: FAFF-1161.
- **Unifying the tier-absent behaviour of the model and effort build chains.** Why: today the model chain skips the whole tier matcher when no tier is given, while the effort chain still consults `by_tier.default`; changing either is a behaviour change outside this ticket. Extension point: `resolveBuildModelForTier` and `resolveBuildEffort`.
- **Inline lanes (`review`, `ship`) and the adversarial judge.** Why: they have no Agent-tool dispatch to carry a parameter; the judge's tuning lives in its own `adversarial` block (ADR-0050's compose-not-subsume rule, unchanged). Extension point: the `adversarial` config block.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| dispatch lane | One of the eight subagent-dispatched lanes: `build`, `prep_explore`, `spec`, `spec_review`, `methodology`, `intake`, `architecture`, `adr`. |
| dispatch node | `dispatch.<lane>`: a block map with optional fields `model` and `effort`. |
| build matcher | `dispatch.build.by_tier.<tier>` or `dispatch.build.by_confidence.<confidence>`: a per-issue node under the build lane. |
| old tree | The existing `models:` and `effort:` config trees. |
| overlay | Resolution rule: at each position, a non-empty `dispatch:` value wins over the old-tree value at the matching position. |
| inherit | Omit the parameter at dispatch. The default for both fields everywhere. |

### Config shape

```
RECORD DispatchNode:                 # dispatch.<lane>, block form only
  model:  ModelToken?                # absent = fall through
  effort: EffortToken?               # absent = fall through

RECORD BuildDispatchNode extends DispatchNode:   # dispatch.build only
  by_tier:       Map<TierKey, DispatchNode>?           # TierKey = default | mechanical | standard | complex (keys lower-cased on read)
  by_confidence: Map<ConfKey, ModelOnlyNode>?          # ConfKey = default | high | medium | low (lower-cased on read)

RECORD ModelOnlyNode:
  model: ModelToken?                 # an `effort` field here fails loud (ADR-0108)

ENUM ModelToken  = inherit | sonnet | opus | haiku | fable | engine:<name>
  CONSTRAINT engine:<name> legal only on dispatch.methodology.model and dispatch.intake.model
  CONSTRAINT engine:<name> must resolve in the merged backends:/engines: namespace (validateEngineRef)
ENUM EffortToken = inherit | low | medium | high | xhigh | max

CONSTRAINT top-level keys under dispatch: ⊆ the eight dispatch lanes      # eval included in the refusal
CONSTRAINT fields under a node ⊆ {model, effort} (+ by_tier, by_confidence on build only)
```

Example (block form; this is the form the docs and ADR show):

```yaml
dispatch:
  spec:
    effort: low
  build:
    model: sonnet
    by_tier:
      complex:
        model: opus
        effort: high
    by_confidence:
      medium:
        model: opus
```

**Unparsed inline maps.** The YAML subset's `scalar()` only `JSON.parse`s a `{…}` value; a YAML flow map such as `{ model: opus, effort: high }` is kept as the literal string. Any `dispatch:` position that should be a map but holds a string starting with `{` fails loud with a message telling the operator to use block form. A strict-JSON value (`{"model":"opus"}`) parses to a map and is accepted like block form.

### Decisions on the shape

**Tree shape and form.** Options: keep two trees and add effort keys; one tree with block-form nodes; one tree with flow-map nodes. Flow maps do not parse with the shared YAML subset, and extending the parser is out of proportion here. **Chosen:** one `dispatch:` tree of block-form nodes, as typed above.

**Unparsed flow map at a dispatch position.** Options: tolerate and treat as unset; fail loud. Tolerating would make the ticket's own original example silently do nothing. **Chosen:** fail loud (exit 2) wherever a dispatch position holds a string beginning with `{`, naming the key and saying "use block form".

**Effort under `by_confidence`.** ADR-0108 states in writing that no `effort.build_by_confidence` key is ever created, because confidence is a near-constant signal (128/134 rated specs say `high`). **Chosen:** `by_confidence` nodes take `model` only; `dispatch.build.by_confidence.<c>.effort` fails loud citing ADR-0108. ADR-0108 stands unchanged.

**Registry defaults.** Options: add `dispatch.<lane>.model: inherit` and `.effort: inherit` to `DEFAULTS`; add none. A registry default would count as "set" and stop the overlay from falling through to the old tree. **Chosen:** no `dispatch.*` entries in `DEFAULTS`; absence means fall through, and `inherit` is the chain's floor exactly as today. `faff config get dispatch.<lane>.<field>` on an unset key therefore exits 3 like any unregistered absent key.

**The old `effort:` tree.** Options: open `effort.spec` and the other four new lanes in the old tree too; leave the old tree's vocabulary as is. FAFF-1198 deletes the old tree with no compatibility period, so widening it only creates keys to migrate. **Chosen:** the old tree's legal keys are unchanged; `effort.spec`, `effort.spec_review`, `effort.prep_explore`, `effort.architecture` and `effort.adr` still exit 2, and the message now names `dispatch.<lane>.effort` as the place to set it. `effort.eval` still exits 2 with "eval is not a dispatch lane".

### CLI surface

```
faff dispatch resolve <lane> [--tier <tier>] [--confidence <conf>] [--root DIR]
faff dispatch --selftest

stdout (exit 0): one line of JSON  {"model":"<ModelToken>","effort":"<EffortToken>"}
exit 2: usage fault, unknown lane (eval included), --tier/--confidence on a non-build lane,
        or any invalid value anywhere in the dispatch tree or the lane's old-tree chain
```

**Flags on non-build lanes.** Options: ignore `--tier`/`--confidence` on other lanes; refuse them. Ignoring would hide a caller bug. **Chosen:** `--tier` and `--confidence` are legal only with `build`; on any other lane they exit 2.

**Validation scope per call.** Options: validate only the requested lane; validate the whole `dispatch:` tree on every call. A typo'd lane (`dispatch.biuld`) is never requested, so per-lane validation would leave it silent forever. **Chosen:** every caller of `effective_view` validates the whole `dispatch:` tree up front (mirrors the matchers' "validate every configured leaf" rule), then the requested lane's old-tree chain. That is all four resolvers: `faff dispatch resolve`, `faff models build-for`, `faff effort build-for` and `faff engine call`, so a typo anywhere under `dispatch:` makes each of them exit 2, consistent with the fail-loud principle.

**Module placement.** The overlay is needed by resolvers in `config.js`, and `effort.js` already requires `config.js`, so an overlay in a new module that `config.js` requires would create a cycle. **Chosen:** the dispatch vocabulary, validator and overlay function live in `config.js` and are exported; the verb (`cmdDispatch`, its selftest and its `DISPATCH_SPEC`) lives in a new `lib/dispatch.js` in the factory region, shaped like `lib/effort.js`.

**CLI-surface classification.** `models` and `effort` both have a single `build-for` second token and take the `flat` default in `lib/cli-surface.js`. **Chosen:** `dispatch` follows the same precedent (no `DISPATCH_SURFACES` entry); register it in `COMMANDS` and add its `docs/guide/cli.md` row so `lint-cli-doc` passes.

**Namespace registration.** **Chosen:** add `dispatch` to `WRITABLE_NAMESPACES`; `RECOGNISED_NAMESPACES` picks it up by derivation, so the known-key lint accepts it.

## 4. HOW

### Overlay and per-field resolution

Behaviour summary: build an effective view where each `dispatch:` value replaces the old-tree value at the same position, then run today's chains unchanged over that view.

| `dispatch:` position | Old-tree position it overlays |
|---|---|
| `dispatch.<lane>.model` | `models.<lane>` |
| `dispatch.<lane>.effort` | `effort.<lane>` (exists only for build, methodology, intake; the other five lanes have no old position) |
| `dispatch.build.by_tier.<t>.model` | `models.build_by_tier.<t>` |
| `dispatch.build.by_tier.<t>.effort` | `effort.build_by_tier.<t>` |
| `dispatch.build.by_confidence.<c>.model` | `models.build_by_confidence.<c>` |

**Precedence between trees.** Options: consult the whole dispatch chain first, then the whole old chain; or overlay per position and run one chain. Whole-tree-first lets `dispatch.build.model: sonnet` silently beat a more specific `models.build_by_tier.complex: opus` during migration. **Chosen:** overlay per position, then run the existing chain once, so the most specific position wins regardless of which tree set it, and the dispatch tree wins only where both set the same position.

```
PROCEDURE effective_view(cfg):
  1. Validate the whole dispatch: tree (see validate_dispatch_tree); any finding → error
  2. Deep-copy cfg.models and cfg.effort, including the nested matcher maps (models.build_by_tier,
     models.build_by_confidence, effort.build_by_tier), so no write in step 3 reaches the loaded config
  3. FOR each row of the overlay table where the dispatch value is non-empty:
       IF the old-tree parent of that position exists but is not a map (for example a scalar
       models.build_by_tier: opus) → error naming the old-tree key: the dispatch leaf would be unreachable
       write the dispatch value into the copy at the old-tree position
       (for the five new effort lanes, write into effort.<lane> in the copy only)
  4. RETURN the copy                       # no dispatch: key → copy equals cfg

PROCEDURE resolve_dispatch(cfg, lane, tier?, conf?):
  1. IF lane ∉ dispatch lanes → error "<lane> is not a dispatch lane" (eval: "eval is not a dispatch lane")
  2. IF (tier or conf given) AND lane ≠ build → usage error
  3. view := effective_view(cfg)
  4. IF lane = build:
       model  := resolveBuildModelForIssue(view, tier, conf)    # tier → confidence → scalar → inherit, unchanged
       effort := resolveBuildEffort(view, tier)                 # by_tier.<t> → .default → effort.build → inherit, unchanged
  5. ELSE:
       model  := view.models.<lane> if non-empty, else DEFAULTS["models.<lane>"]   # "inherit"
       effort := view.effort.<lane> if non-empty, else "inherit"
       IF model starts with "engine:": validateEngineRef(cfg, model) → error on failure
  6. Validate each result against its closed vocabulary → error on failure
  7. RETURN { model, effort }
```

The existing `validateEffortLane` must not run on the view's `effort.spec` (and siblings), since it rejects those keys by design; step 6 validates the resolved token against `EFFORT_LANE_VOCAB["effort.build"]`, which is the same five levels plus `inherit`.

**Tier-absent behaviour is preserved per field.** With no `--tier`, the model chain skips the tier matcher entirely, while the effort chain still uses `by_tier.default`. Both are today's behaviour and stay as they are (see Out of scope).

### Who consumes the overlay in this ticket

| Caller | Change | Effect during the additive phase |
|---|---|---|
| `faff dispatch resolve` (new) | Calls `resolve_dispatch` | Full overlay for every lane |
| `faff models build-for` (`cmdModels`) | Passes `effective_view(cfg)` to `resolveBuildModelForIssue` | `dispatch.build.*.model` live for every build dispatch |
| `faff effort build-for` (`cmdEffort`) | Passes `effective_view(cfg)` to `resolveBuildEffort` | `dispatch.build.*.effort` live for every build dispatch |
| `resolveEngineForLane` (`faff engine call`) | Reads `models.<lane>` and `effort.<lane>` from `effective_view(cfg)` | Engine lanes honour `dispatch.methodology` / `dispatch.intake`, with the identical allowlist, `validateEngineRef`, graded-family check, `reasoning_off` refusal and xhigh/max clamp |
| `faff config get <key>` | Validates `dispatch.*` keys; no overlay | Raw read, as today |
| Producer and explore dispatch sites (skill prose) | None in this ticket | Still read `faff config get models.<lane>` / `effort.<lane>`; `dispatch.<lane>` values for `prep_explore`, `spec`, `spec_review`, `methodology`, `intake`, `architecture`, `adr` take effect at those sites once FAFF-1198 rewires them |

**Raw reads versus resolvers.** Options: make `faff config get models.<lane>` return the overlaid value so producer lanes go live now; keep `config get` raw and accept a window where producer-lane `dispatch:` values are not yet read by skill prose. Overlaying inside `config get` would make it report a value the key does not hold, and the window closes when FAFF-1198 lands. **Chosen:** keep `config get` raw; the overlay is applied only by the four resolvers above. The `docs/guide/cli.md` row for `dispatch resolve` says which callers read the tree today, and FAFF-1198 updates that sentence.

**Engine capability checks.** **Chosen:** `faff dispatch resolve` returns the configured effort for an engine-valued lane without the family capability check; that check stays solely in `resolveEngineForLane`, so a graded effort on an ollama engine still fails loud at `faff engine call`, with one home for the rule. The error text in `resolveEngineForLane` names the key the value came from, and the clamp note in `engine.js` (~326-329) does the same. No provenance needs to travel through the overlay: the source is `dispatch.<lane>.<field>` when the loaded config (not the view) holds a non-empty value there, else the old-tree key.

### Validation

```
PROCEDURE validate_dispatch_key(key, value):        # chained into config get (~2689) and config set (~1572)
  1. IF key does not start with "dispatch." → return null (not this validator's key)
     IF the value at key is a map (a node read such as dispatch.build) → return null; only leaf keys are validated here,
     and validate_dispatch_tree covers every leaf beneath the node
  2. Split into lane / rest
  3. lane = "eval" → "eval is not a dispatch lane (use eval.model / eval.effort)"
     lane ∉ dispatch lanes → "unknown dispatch lane <lane>; legal: <eight lanes>"
  4. rest = "model":  value ∈ ModelToken vocab;
                      engine:<name> only when lane ∈ {methodology, intake}, else name the allowlist
  5. rest = "effort": value ∈ EffortToken vocab
  6. lane = build AND rest = "by_tier.<t>.model|effort":    same vocab as 4 (no engine) / 5
  7. lane = build AND rest = "by_confidence.<c>.model":     same vocab as 4 (no engine)
  8. lane = build AND rest = "by_confidence.<c>.effort":    "no effort by confidence (ADR-0108); use dispatch.build.by_tier"
  9. any other rest → "unknown dispatch field <rest>; legal: model | effort (+ by_tier, by_confidence on build)"
 10. value is a string beginning with "{" → "dispatch.<…> holds an inline map the config parser cannot read; use block form"

PROCEDURE validate_dispatch_tree(cfg):              # used by effective_view
  Walk every leaf under cfg.dispatch; apply validate_dispatch_key to each.
  A non-map where a node is expected (a lane node, by_tier, by_confidence or a matcher node) is a finding:
    a string beginning with "{" → "dispatch.<path> holds an inline map the config parser cannot read; use block form"
    any other non-map         → "dispatch.<path> must be a block map of model / effort"
  Return the first finding (or all, joined).
```

`config get` on an engine value also runs `validateEngineRef`, extending the existing `/^models\./` check (~2694) to `dispatch.(methodology|intake).model`. `config set` runs `validate_dispatch_key` but not `validateEngineRef`, matching the existing rule that a first `set` cannot yet have a complete engine.

`faff config get dispatch.build` (a map) behaves as any map read does today: the leaf-key validator does not apply to a node read (step 1), and `--json` gives structured output. No change.

### Run banner

`faff config resolved` keeps every existing line unchanged and appends, only when set:

```
dispatch <lane>: model=<m> effort=<e>          # print only the fields that are set
dispatch build.by_tier.<t>: model=<m> effort=<e>      # all tiers: default, mechanical, standard, complex
dispatch build.by_confidence.<c>: model=<m>           # default, high, medium only (low is inert, same rule as today)
```

Every `dispatch <lane>` line for a lane other than `build` ends with ` (not yet read at subagent dispatch sites; FAFF-1198)`, because until FAFF-1198 rewires those sites only `faff dispatch resolve` and the engine-lane resolver read the value. The one exception is `methodology` or `intake` when the lane's effective model is an `engine:` value: `faff engine call` already reads it, so that line carries no annotation.

**The additive window between this ticket and FAFF-1198.** Options: (a) annotate producer-lane banner lines as not yet read, and re-check before merge that FAFF-1198 is still open, refusing to merge if it was cancelled; (b) overlay inside `faff config get` so every lane goes live now; (c) the merge-time re-check alone. **Chosen:** (a) (human decision, 2026-10-05): the window stays visible in the banner, and a cancelled follow-up blocks the merge instead of leaving values silently unread.

The banner echoes raw `dispatch:` values (not the overlay) next to the existing `model …` / `effort …` lines, so a repo mid-migration sees both sources. With no `dispatch:` key the banner is byte-identical.

### ADR

**ADR shape.** **Chosen:** a new ADR, numbered at graft time by the `adr` producer, titled along the lines of "One dispatch tree pairs model and effort per lane, supersedes ADR-0050 in part". Its header carries `**Supersedes (in part):** ADR-0050` naming exactly what is retired: the prep-boundary exclusion (no effort on `spec`, `spec_review`, `prep_explore`, `architecture`, `adr`) and the parallel-tree shape. It records what stands: closed vocabularies with fail-loud reads, `inherit` omits the parameter, the inline/subagent boundary, compose-not-subsume with the `adversarial` block, eval outside the surface, and ADR-0108's no-effort-by-confidence rule. Context cites the eval evidence above and FAFF-1161. ADR-0050 gains an `**Amended:**` header line pointing to the new ADR, following the ADR-0071/ADR-0072 precedent; its Status is not flipped.

### Failure modes

- **The overlay leaks into the no-config path.** How you'd know: `test/models-config.test.mjs`, `test/effort-config.test.mjs`, `test/models-effort-by-tier.test.mjs` or `test/engine-call.test.mjs` change output with no `dispatch:` key, or the banner gains a line. What it means: a bug; the copy step or the "non-empty" check is wrong.
- **Operators set producer-lane `dispatch:` values before FAFF-1198 and see no effect.** How you'd know: `data.effort` on producer dispatch events stays unset while the banner shows `dispatch spec: effort=low`. What it means: expected in the additive window, and the banner annotation says so; FAFF-1198 closes it. If FAFF-1198 is cancelled after this merges, file a replacement ticket for its dispatch-site rewiring before anything else; the annotation keeps the gap visible until then.
- **Per-lane effort does not save cost or hold quality outside the eval cases.** How you'd know: `faff economics --by effort` and eval pass rates after tuning. What it means: the surface is still correct; the tuning values are the operator's call, not this ticket's.

**Anti-pattern:** reading `dispatch:` with `faff config get` at a new call site. Why: it skips the overlay and the old-tree fallback; use `faff dispatch resolve`.

**Anti-pattern:** adding `dispatch.*` keys to `DEFAULTS`. Why: a default counts as set and blocks fall-through to the old tree.

**Anti-pattern:** a second copy of the engine capability checks in the dispatch verb. Why: two homes drift; `resolveEngineForLane` owns them.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose config sets only dispatch.spec.effort: low
When `faff dispatch resolve spec` runs
Then stdout is {"model":"inherit","effort":"low"} and exit is 0
```

```
Given models.build_by_tier.complex: opus and dispatch.build.model: sonnet
When `faff dispatch resolve build --tier complex` runs
Then model is "opus" (the more specific position wins across trees) and effort is "inherit"
```

```
Given models.methodology: engine:local and dispatch.methodology.effort: high, where engines.local is an ollama engine
When `faff engine call --lane methodology …` runs
Then it exits 2 with the graded-effort capability refusal naming dispatch.methodology.effort
```

```
Given dispatch.build.by_confidence.medium.effort: high
When `faff dispatch resolve build` or `faff config get dispatch.build.by_confidence.medium.effort` runs
Then each exits 2 with a message naming ADR-0108 and dispatch.build.by_tier
```

- With no `dispatch:` key, the output of `faff config resolved`, `faff models build-for` (every flag combination the existing tests cover), `faff effort build-for` and `faff engine call` is byte-identical to the pre-change output.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Tree shape and form | Two trees plus new effort keys; one tree, block nodes; one tree, flow-map nodes (unparseable) | **Chosen:** one tree, block nodes |
| Unparsed flow map at a dispatch position | Treat as unset; fail loud | **Chosen:** fail loud, "use block form" |
| Effort under `by_confidence` | Allow (would supersede ADR-0108 in part); model only | **Chosen:** model only, per ADR-0108's written rule |
| Registry defaults for `dispatch.*` | Add `inherit` defaults; add none | **Chosen:** none, so absence falls through |
| Old `effort:` tree | Widen to the five new lanes; leave as is with a pointer | **Chosen:** leave as is; error names `dispatch.<lane>.effort` |
| `--tier` / `--confidence` on non-build lanes | Ignore; refuse | **Chosen:** refuse (exit 2) |
| Validation scope per resolve | Requested lane only; whole tree | **Chosen:** whole tree, so typo'd lanes surface |
| Module placement | All in a new module (import cycle); overlay in `config.js`, verb in `lib/dispatch.js` | **Chosen:** overlay in `config.js`, verb in `lib/dispatch.js` |
| CLI-surface classification | `DISPATCH_SURFACES` entry; flat default like `models`/`effort` | **Chosen:** flat default, following `models`/`effort` |
| Namespace registration | Read-only namespace; writable | **Chosen:** add `dispatch` to `WRITABLE_NAMESPACES` |
| Precedence between trees | Whole dispatch chain first; per-position overlay then one chain | **Chosen:** per-position overlay |
| Raw reads versus resolvers | Overlay inside `config get`; overlay only in resolvers | **Chosen:** resolvers only; producer lanes go live with FAFF-1198 |
| Engine capability checks | Duplicate in `dispatch resolve`; keep in `resolveEngineForLane` | **Chosen:** keep in `resolveEngineForLane` only |
| `.faffrc.example.yaml` | Document `dispatch:` now; document with FAFF-1198 | **Chosen:** with FAFF-1198 (below) |
| ADR shape | Amend ADR-0050 in place; new ADR superseding in part | **Chosen:** new ADR, ADR-0050 gets an `**Amended:**` back-pointer |

**Documenting `dispatch:` in `.faffrc.example.yaml`.** Documenting it now would invite operators to set producer-lane values that skill prose does not yet read, and the example would carry both trees for one release. `configSetSelftest` only requires example keys to be writable, not the reverse, so leaving it out passes. **Chosen:** do not add `dispatch:` to `.faffrc.example.yaml` in this ticket; FAFF-1198 replaces the `models:` block with it.

Temporal anchor: at the time of writing, the shared YAML subset parser does not parse YAML flow maps; if it ever does, the "use block form" refusal can be relaxed.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The human closed the key name, lane list, vocabularies, defaults, additive sequencing, eval exclusion and the ADR requirement; ADR-0108 settles effort by confidence.

**Assumptions:**

- **Assumes:** FAFF-1198 follows this ticket and rewires the skill dispatch sites to `faff dispatch resolve`. Validation: confirm FAFF-1198 is still open and blocked by FAFF-1197 before starting (true when this spec was written, 2026-10-05), and again immediately before merge; if it has been cancelled at either point, stop and surface it instead of merging, because the producer-lane half of this surface would stay unread indefinitely.

## 8. DONE

### From WHY
- [ ] With no `dispatch:` key, `faff config resolved`, `faff models build-for`, `faff effort build-for` and `faff engine call` produce byte-identical output to before (existing test suites pass unchanged except where listed below).
- [ ] `faff dispatch resolve <lane>` returns a settable effort for all eight lanes, including `spec`, `spec_review`, `prep_explore`, `architecture` and `adr`.

### From WHAT (shape and validation)
- [ ] `dispatch` is in `WRITABLE_NAMESPACES`; `faff config set dispatch.spec.effort low` writes a block-form node and exits 0.
- [ ] `faff config get` and `faff config set` exit 2 for: an off-vocabulary model or effort token; `engine:<name>` on any lane other than methodology/intake; an unknown lane; `dispatch.eval.*` ("eval is not a dispatch lane"); an unknown field; `dispatch.build.by_confidence.<c>.effort` (message names ADR-0108); a dispatch position holding a `{…}` string (message says "use block form").
- [ ] `faff config get dispatch.methodology.model` with `engine:<name>` runs `validateEngineRef` and exits 2 on a dangling name.
- [ ] No `dispatch.*` key appears in `DEFAULTS`; `faff config get dispatch.spec.effort` on an unset key exits 3.
- [ ] `effort.spec`, `effort.spec_review`, `effort.prep_explore`, `effort.architecture` and `effort.adr` still exit 2 and the message names `dispatch.<lane>.effort`; `effort.eval` exits 2 saying eval is not a dispatch lane. `test/effort-config.test.mjs`'s two "HARD EXCLUSION" tests are retitled and their comments and message assertions updated to this rule.
- [ ] `faff dispatch resolve` refuses `--tier`/`--confidence` on non-build lanes and an unknown or `eval` lane (exit 2).

### From HOW (resolution)
- [ ] Overlay precedence: `models.build_by_tier.complex: opus` plus `dispatch.build.model: sonnet` resolves `--tier complex` to model `opus`; `dispatch.build.by_tier.complex.model: haiku` added on top resolves to `haiku`.
- [ ] Field independence: a node with only `effort` resolves `model` from the rest of the chain, and the reverse.
- [ ] Tier-absent behaviour unchanged per field: with no `--tier`, model skips `by_tier` entirely; effort still uses `by_tier.default`.
- [ ] `faff models build-for` and `faff effort build-for` honour `dispatch.build.*` through the overlay.
- [ ] `faff engine call --lane methodology|intake` honours `dispatch.<lane>.model` and `dispatch.<lane>.effort`, with unchanged allowlist, engine-reference, graded-family, `reasoning_off` and clamp behaviour; error and clamp messages name `dispatch.<lane>.<field>` when the loaded config sets it there, else the old-tree key.
- [ ] Every caller of `effective_view` validates the whole `dispatch:` tree: a typo'd lane elsewhere makes `faff dispatch resolve`, `faff models build-for`, `faff effort build-for` and `faff engine call` exit 2.
- [ ] A dispatch leaf over a non-map old-tree parent (for example `models.build_by_tier: opus` with `dispatch.build.by_tier.complex.model: haiku`) exits 2 naming the old-tree key.
- [ ] A `{…}` string at a node position (for example `dispatch.spec: { effort: low }`) exits 2 with the "use block form" message naming the node.
- [ ] `faff config resolved` prints `dispatch …` lines only for set values, in the formats above, with `by_confidence.low` suppressed, and every non-build `dispatch <lane>` line carries the "not yet read at subagent dispatch sites; FAFF-1198" annotation, except `methodology` / `intake` when their effective model is an `engine:` value.
- [ ] The overlay never mutates the loaded config: a test resolves with dispatch matcher leaves over old-tree matcher leaves twice in one process and asserts the loaded config is unchanged and both results agree.
- [ ] `faff config get dispatch.build` (a node) behaves as before; only leaf keys are validated.
- [ ] Immediately before merge, FAFF-1198 is confirmed open and blocked by FAFF-1197; if it is not, the build stops and surfaces it instead of merging. This criterion is recorded as verified in graft's acceptance-criteria checklist like every other DONE item, which is the merge-time record of the check.

### From HOW (surface and records)
- [ ] `dispatch` registered in `COMMANDS`; `lib/dispatch.js` exports `cmdDispatch`, `dispatchSelftest` and its arg spec; `faff dispatch --selftest` covers the overlay table, the vocab refusals and the build chain.
- [ ] `docs/guide/cli.md` has a `dispatch resolve` row (passes `faff lint-cli-doc`) stating which callers read the tree today; the `engine call` row drops the stale "non-inherit effort is refused" clause and names `dispatch.<lane>.effort`; the `config` row mentions `dispatch` in what `resolved` echoes.
- [ ] `test/scaffolder-cli-surface-drift.test.mjs` validates `dispatch.*` keys found in scaffolder here-docs with the new validator, and its verb-classification check passes with `dispatch` added.
- [ ] `faff config defaults --selftest` and the config-set selftest pass with the new namespace.
- [ ] New ADR committed with `**Supersedes (in part):** ADR-0050` scoped as described; ADR-0050 carries an `**Amended:**` back-pointer.

### Integration smoke test

```
1. In a temp repo, write .faffrc.yaml:
     dispatch:
       spec:
         effort: low
       build:
         by_tier:
           complex:
             model: opus
             effort: high
2. faff dispatch resolve spec                       → {"model":"inherit","effort":"low"}, exit 0
3. faff dispatch resolve build --tier complex       → {"model":"opus","effort":"high"}, exit 0
4. faff models build-for --tier complex             → opus
5. faff effort build-for --tier complex             → high
6. faff config resolved                             → includes "dispatch spec: effort=low" and
                                                      "dispatch build.by_tier.complex: model=opus effort=high"
7. Remove the dispatch: block; steps 4-6 match the pre-change output exactly.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** Larger than the 1-3 day norm, but splitting it would not get value shipped any sooner. The spec covers a lot: a validator, an overlay, a new verb, rewiring three resolvers, the banner, an ADR and test retitles, which is consistent with the `complex` tier. The obvious cut is between (a) the tree, validation and `faff dispatch resolve`, and (b) feeding the overlay into `models build-for`, `effort build-for` and `engine call`; half (a) alone changes no dispatch, and half (b) needs (a). The pairing that matters is FAFF-1197 with FAFF-1198. What to do: keep it as one ticket, and hold the scope to section 8 so it does not grow towards the FAFF-1198 prose sweep.

**Workstream fit?** It fits: it delivers the config and CLI half of the outcome-led project "Cost-aware model & transport routing". End-user value is split across two tickets: between the merges, `dispatch:` values for producer lanes are accepted, shown in the banner and ignored, so only the build and engine lanes take effect. The spec handles this by leaving the example file out and naming the window as an expected failure mode. What to do: put FAFF-1198 next in the queue once this lands; if it slips, revisit the decision to keep `config get` a raw read.

**Deps surfaced?** FAFF-1198 is correctly linked as blocked, and FAFF-1161 is correctly related, non-blocking and out of scope. Two small gaps were found and corrected in this spec at prep: the eval write-up is on `main`, not on another branch, and FAFF-1160 is already closed as a duplicate, so the out-of-scope bullet about closing it was removed.

**Risk profile?** Moderate, and well de-risked. The main risk, the overlay leaking into the no-config path, is answered by a byte-identical acceptance criterion across four existing test suites and step 7 of the smoke test. The second, precedence across the two trees during migration, is settled by per-position overlay with a scenario and a holdout. No spike is needed. What to do: run the byte-identical checks first in the build; if they hold, everything after them is additive.

confidence: high
build-tier: complex
spec-review: accept (human, after round 2)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```

