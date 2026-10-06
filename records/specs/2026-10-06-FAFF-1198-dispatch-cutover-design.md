# FAFF-1198: Every dispatch site resolves through `faff dispatch resolve`; `models:` and `effort:` fail loud

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1198.

This spec is for the build agent implementing FAFF-1198 and for the humans reviewing it. It is the removal and prose-sweep half of the `dispatch:` consolidation that FAFF-1197 (merged, PR #1008) started: every skill dispatch site moves to one `faff dispatch resolve <lane>` call, the `models:` and `effort:` config trees are deleted with no compatibility period, this repository's `.faffrc.yaml` moves to `dispatch:`, and a `validate-adapters` lint stops the old keys coming back into skill prose.

## 1. WHY

**The idea the rest turns on.** After FAFF-1197, a lane's model and effort can come from two places: the `dispatch:` tree (read by `faff dispatch resolve`) and the old `models:` / `effort:` trees (read by `faff config get` at most skill dispatch sites), joined by an overlay. This ticket deletes the old trees and the overlay, so `dispatch.<lane>.<field>` becomes the only place a lane's model or effort can be set, and `faff dispatch resolve <lane>` becomes the only way a skill reads it. A resolved effort is applied only where a transport can carry it (`faff engine call` on the engine lanes); the Claude Code Agent tool has no effort parameter, so on Agent-dispatched lanes the effort is recorded, visibly marked as not applied (human decision, 2026-10-06). Any read of an old key, and any config file that still holds an old block, exits 2 naming the exact `dispatch.` replacement.

**Problem.** Today most producer dispatch sites still run `faff config get models.<lane>` and `effort.<lane>`, so a `dispatch.spec.model: haiku` is accepted, shown in the banner with a "not yet read" note, and ignored. While both trees stay readable, keeping them in step depends on discipline. This change makes `dispatch:` the single source, and the human has confirmed nobody uses the `effort:` tree, so dropping the old keys costs nothing to migrate.

### Design principles

**One read path.** Every subagent dispatch site resolves its lane with `faff dispatch resolve <lane>` and nothing else. An implementation that leaves any skill reading `faff config get models.*`, `effort.*` or `dispatch.*` for a dispatch is wrong.

**Fail loud, never silently ignore.** An old key read, an old key write, or an old block left in a config file exits 2 (or, in `faff config check`, is an error finding), and the message names the `dispatch.` key to use. A config whose `models:` block is silently skipped would dispatch on `inherit` without telling anyone.

**Effort is applied where a transport carries it, and recorded honestly elsewhere.** The Agent tool's parameters are `description`, `prompt`, `subagent_type`, `model` and `isolation`; none carries effort. A non-`inherit` effort on an Agent-dispatched lane is never silently dropped and never reported as applied: the run log and the run banner say it was not applied, and no event in `events.jsonl` carries it (human decision, 2026-10-06).

**Same answers, new tree.** For any config expressed in `dispatch:` form, `faff dispatch resolve` returns what it returns today. The fallback chains and the tier-absent behaviour that FAFF-1197 documented are kept per field.

**Prose shrinks.** The sweep replaces three resolution branches per site with one call and a pointer to the gateway's Producer dispatch paragraph. No touched skill or `kernel.md` grows past its pre-change line count: the longer dispatch rule is paid for by shortening the per-site prose it replaces.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` `DEFAULTS` (models.* ~191-205, effort.* ~213-215) | JavaScript | Old-tree defaults to delete; `eval.model` / `eval.effort` (~221-222) stay |
| `config.js` `MODEL_LANE_VOCAB`, `MOVED_KEYS`, `movedKeyError`, `validateModelLane` (~353-410) | JavaScript | Old-key vocabulary and the eval "moved to" error this ticket generalises |
| `config.js` `EFFORT_LANE_VOCAB`, `validateEffortLane` (~603-626) | JavaScript | Old effort vocabulary and its "set it at dispatch.<lane>.effort" pointer |
| `config.js` `validateDispatchKey`, `validateDispatchTree`, `dispatchOverlayRows`, `effectiveView`, `laneSourceKey` (~631-800) | JavaScript | Dispatch validator (kept) and the overlay (deleted) |
| `config.js` `resolveEngineForLane` (~518-595), `engine.js` (~25, ~320-329) | JavaScript | Engine-lane resolution and the effort clamp message |
| `config.js` `resolveBuildModel`, `resolveBuildModelForTier`, `resolveBuildModelForIssue`, `cmdModels`, `modelsSelftest` (~3240-3400) | JavaScript | Build-model chain to rewrite against `dispatch.build.*`; verb to delete |
| `plugin/skills/faff/bin/lib/effort.js` `resolveBuildEffort`, `cmdEffort` | JavaScript | Build-effort chain to move; verb to delete |
| `plugin/skills/faff/bin/lib/dispatch.js` `resolveDispatch` | JavaScript | The single resolver every site will call |
| `plugin/skills/faff/bin/lib/backends.js` `fleetEngineBackends` (~226-247) | JavaScript | Walks `models:` for `engine:` refs feeding the budget, lights-out and economics unmetered-spend refusals |
| `config.js` `WRITABLE_NAMESPACES` (~1584), example-file drift check (~1952-1960), `knownKeyLint` / `computeConfigCheck` (~2273-2376), banner and `printDispatchBanner` (~3103-3227) | JavaScript | Namespace guard, config check and run banner |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (HANDREAD loop ~1001-1018, prose-default loop ~1049-1100, `SKILL_LINE_BASELINE` ~65, `KERNEL_LINE_BASELINE`) | JavaScript | Home and template for the new lint; line caps the sweep must respect |
| `plugin/skills/faff/references/kernel.md` (config shape ~86-99, transport row ~146, "Model & effort selection" ~160-174, Producer dispatch ~339) | Markdown | The gateway home for the dispatch rule every site points to |
| `records/adr/0134-…`, `records/adr/0108-…` | Markdown | ADR-0134 already records this removal; ADR-0108 (no effort by confidence) stands |
| FAFF-70 (related, non-blocking) | Tracker | May later absorb `dispatch.<lane>` into its role invocation; no change here |

**Scope.** This closes the "Cost-aware model & transport routing" project's dispatch consolidation: FAFF-1197 added `dispatch:` and its verb, and FAFF-1198 makes them the only surface.

## Already shipped against this surface

- **FAFF-1197** (Done, PR #1008): the `dispatch:` tree, `faff dispatch resolve`, the overlay and ADR-0134. Its section 2 OUT OF SCOPE lists this ticket's work.
- **PR #1006** (merged): moved eval to `eval.model` / `eval.effort`; `models.eval` and `effort.eval` already exit 2 through `MOVED_KEYS`. Nothing about eval is left to remove here.

## 2. OUT OF SCOPE

- **Historical records.** `records/` and `.faff/anchors/` keep the old key names they were written with. Why: they record what was true at the time (human decision). Extension point: none.
- **An automatic migrator (`faff config migrate` or similar).** Why: the human decided on no compatibility period, and the fail-loud message names the replacement for each leaf, which is enough for the handful of keys an adopter could hold. Extension point: the legacy-tree check (`legacy_tree_error` below) already computes every replacement pair.
- **`faff config unset`** (FAFF-1201, merged in PR #1011). Why: human decision, 2026-10-06; a general writer verb that ships on its own. Extension point: FAFF-1201. This ticket uses it (section 7).
- **Applying effort on Agent-dispatched lanes.** Why: the Agent tool has no effort parameter (human decision, 2026-10-06: record-only). Extension point: step 3 of the dispatch rule in `kernel.md` Producer dispatch, and the banner note, if the harness gains a parameter or a lane moves to a `claude -p` spawn.
- **Choosing effort values for any lane.** Why: picking values is the operator's tuning call. Extension point: `faff config set dispatch.<lane>.effort`.
- **Whether `inherit` should keep following the session model** (FAFF-1161). Why: a separate contract decision. Extension point: FAFF-1161.
- **Unifying the tier-absent behaviour of the model and effort build chains.** Why: a behaviour change FAFF-1197 also left alone. Extension point: the build-model and build-effort chains in section 4.
- **Inline lanes (`review`, `ship`) and the adversarial judge.** Why: no Agent-tool dispatch carries a parameter; the judge's tuning stays in the `adversarial` block (ADR-0050 compose-not-subsume, unchanged). Extension point: the `adversarial` config block.
- **`events.js`, `economics.js`, `harness.js` model-identity fixtures (~622-679, ~1075-1079) and `budget.js`'s reader of `rec.effort`.** Why: they read event payloads, spend records or test-only shapes, not config, and the run-log-only decision in section 4 needs no event change. Extension point: none.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| dispatch lane | One of the eight subagent-dispatched lanes: `build`, `prep_explore`, `spec`, `spec_review`, `methodology`, `intake`, `architecture`, `adr`. |
| legacy tree | Any top-level `models:` or `effort:` key in either config file (`.faffrc.yaml` base or `.faffrc.local.yaml` overlay), empty or not: a bare header with no leaves still counts. The remedy is always the whole-block `faff config unset models` / `faff config unset effort`, with `--local` for the overlay. |
| removed key | Any dotted key under `models.` or `effort.` other than `models.eval` and `effort.eval`, which keep their existing eval message. |
| replacement key | The `dispatch.` key a removed key maps to (table below). |

### Removed key to replacement key

| Removed key | Replacement key |
|---|---|
| `models.<lane>` (any of the eight lanes) | `dispatch.<lane>.model` |
| `effort.<lane>` (any of the eight lanes, including the five that were never legal) | `dispatch.<lane>.effort` |
| `models.build_by_confidence.<c>` | `dispatch.build.by_confidence.<c>.model` |
| `models.build_by_tier.<t>` | `dispatch.build.by_tier.<t>.model` |
| `effort.build_by_tier.<t>` | `dispatch.build.by_tier.<t>.effort` |
| `models`, `effort`, `models.build_by_confidence`, `models.build_by_tier`, `effort.build_by_tier`, or any other `models.*` / `effort.*` | the `dispatch:` tree (message names `dispatch.<lane>.model` / `dispatch.<lane>.effort`) |
| `models.eval`, `effort.eval` | unchanged: `eval.model`, `eval.effort` (ADR-0133) |

`<c>` and `<t>` are copied through lower-cased; validity of the bucket name is left to the dispatch validator once the operator sets the replacement.

### Error shapes

```
removed_key_error(key) -> string | null
  "config <key>: removed; set <replacement key> instead (ADR-0134)"

legacy_tree_error(layers) -> string | null      # layers: [{ file, local, doc }] for the base and the overlay
  "<file> still holds the removed <models:|effort:> tree (ADR-0134); set
   <replacement key> for each of <removed key>, ..., then run `faff config unset <models|effort>[ --local]`"
  # one sentence per (file, tree), base before overlay, models before effort;
  # --local is added exactly when the file is .faffrc.local.yaml
  # an empty or leafless block omits the "set ..." clause:
  #   "<file> still holds the removed <models:|effort:> tree (ADR-0134); run `faff config unset <models|effort>[ --local]`"
```

### Decisions on the shape

**How old-key reads and writes fail.** Options: leave the old keys as unknown namespaces (generic "unknown config namespace" from `config set`, exit 3 from `config get`); generalise `MOVED_KEYS` into a removed-key function that maps every old key to its replacement. Exit 3 on a stale `config get models.spec` looks like "unset" to a caller and would dispatch on `inherit`. **Chosen:** replace `MOVED_KEYS` / `movedKeyError` with `removed_key_error(key)`, which keeps the two eval entries' existing message and maps every other removed key per the table. `faff config get` and `faff config set` call it first (before the namespace check in `set`) and exit 2 with its message, whether or not the key is set. It applies to `get` and `set` only, never to `faff config unset`: removing `models` or `effort` is the fix, so FAFF-1201's verb must accept those keys (requirement on FAFF-1201, checked in section 7).

**A config file that still holds a legacy tree.** Options: throw from `loadConfig`; check in each resolver; ignore the block. Throwing from `loadConfig` would also break `faff config set` and `faff config check`, the two tools an operator needs to fix it. Ignoring breaks the fail-loud principle. **Chosen:** the CLI entry points (`faff dispatch resolve`, `faff engine call`, `faff config resolved`, `faff config check`) read the base and overlay files separately, the way `cmdConfigCheck` already does, and pass the layers to `legacy_tree_error`, so the message names the file and the exact `faff config unset` command. The resolvers (`resolveDispatch`, `resolveEngineForLane`) exit 2 with that message. As a backstop for in-process callers that hold only the merged config, the resolvers also refuse a merged `models:` / `effort:` key, naming both unset commands. `faff config resolved` prints it in the existing `dispatch: INVALID` banner line, the same convention FAFF-1197 set for an invalid `dispatch:` tree. `faff config check` reports an `error`-severity finding with the same message for each file that holds a legacy tree (replacing the generic "unrecognised top-level key" warning for those two keys), so `config check` exits 1. `loadConfig`, `faff config get` of non-removed keys and `faff config set` keep working.

**The `faff models build-for` and `faff effort build-for` verbs.** Options: keep them reading `dispatch.build.*`; remove them. Their only callers are the two concurrency executors and graft Step 7, all of which this sweep moves to `faff dispatch resolve build --tier <t> --confidence <c>`, which returns both fields in one call. Keeping them leaves two more read paths to keep in step, which is the problem this ticket exists to solve. **Chosen:** remove both verbs: `cmdModels`, `modelsSelftest`, `cmdEffort`, the `COMMANDS` entries in `plugin/skills/faff/bin/faff`, the `regions.js` factory-region and selftest entries, the `scripts/verify-split-parity.mjs` entry, and the `docs/guide/cli.md` rows. `lint-cli-coverage`, `lint-cli-doc` and `test/cli-coverage.test.mjs` must pass afterwards. The bare positional `faff models build-for <confidence>` form goes with them.

**Where the build chains live once the overlay is gone.** The overlay sat in `config.js` because `effort.js` requires `config.js`. With the overlay and both verbs gone, `effort.js` would hold one function. **Chosen:** move the build-effort chain into `lib/dispatch.js` and delete `effort.js` (and its `regions.js` entries); rewrite the build-model chain in place in `config.js` (it is exported and `dispatch.js` already imports it). `dispatch.js` stays in the factory region.

**Old-tree vocabulary tables.** **Chosen:** `MODEL_LANE_VOCAB` and `EFFORT_LANE_VOCAB` (keyed by old key names) become one Agent-token list (`inherit | sonnet | opus | haiku | fable`) and the existing `EFFORT_LEVELS_WITH_INHERIT`; `validateModelLane`, `validateEffortLane`, `ENGINE_LANE_KEYS` and the old-tree branches of the `config get` engine-ref check are deleted. `validateDispatchKey` and `validateDispatchTree` are unchanged apart from reading the renamed lists.

### Repository config after migration

| Key in this repo's `.faffrc.yaml` | Value |
|---|---|
| `dispatch.prep_explore.model` | `sonnet` |
| `dispatch.adr.model` | `sonnet` |
| `dispatch.build.by_confidence.high.model` | `sonnet` |
| `eval.model`, `eval.effort` | unchanged |
| `models:` block | removed |

**Which old values to migrate.** The old block also sets seven lanes and `build_by_confidence.default` / `.medium` to `inherit`. With no `dispatch.*` registry defaults, an absent position resolves to `inherit` through the same chain, so those leaves change nothing. **Chosen:** migrate only the three non-`inherit` values above, written with `faff config set`.

**Removing the old block.** `faff config set` cannot remove a map, and the CLI-only rule (kernel.md ~62) forbids an agent hand-writing an rc file. The human split the removal verb into FAFF-1201 (human decision, 2026-10-06), now merged in PR #1011. This repo's block is removed with `faff config unset models`, and `legacy_tree_error` names the same command to adopters. The dependency is recorded in section 7.

## 4. HOW

### Resolution reads `dispatch:` directly

Behaviour summary: delete the overlay; each resolver checks for legacy trees, validates the whole `dispatch:` tree, then walks `dispatch.*` with the same per-field fallback chains the overlay produced.

```
PROCEDURE prepare(cfg):                          # first step of every resolver
  1. err := legacy_tree_error(cfg);   IF err → error(err)          # exit 2
  2. err := validateDispatchTree(cfg); IF err → error(err)         # exit 2, unchanged rule
  3. RETURN cfg.dispatch or {}

PROCEDURE pick(map, key):                        # keys compared lower-cased and trimmed
  RETURN map[key].field if map is a block map, map[key] is a block map and the field is non-empty, else null

PROCEDURE resolve_build_model(d, tier?, conf?):
  1. IF tier given:
       m := pick(d.build.by_tier, tier).model ?? pick(d.build.by_tier, "default").model
       IF m → RETURN m
     # tier absent: the tier matcher is skipped for model (unchanged)
  2. m := pick(d.build.by_confidence, conf).model ?? pick(d.build.by_confidence, "default").model
     # conf absent or unknown routes to "default" (unchanged)
     IF m → RETURN m
  3. RETURN d.build.model if non-empty, else "inherit"

PROCEDURE resolve_build_effort(d, tier?):        # moves to lib/dispatch.js
  1. e := pick(d.build.by_tier, tier).effort ?? pick(d.build.by_tier, "default").effort
     # tier absent still consults by_tier.default for effort (unchanged)
     IF e → RETURN e
  2. RETURN d.build.effort if non-empty, else "inherit"

PROCEDURE resolve_dispatch(cfg, lane, tier?, conf?):
  1. lane checks and the --tier/--confidence-on-non-build refusal, unchanged
  2. d := prepare(cfg)
  3. IF lane = build: RETURN { model: resolve_build_model(d, tier, conf), effort: resolve_build_effort(d, tier) }
  4. model  := d.<lane>.model  if non-empty, else "inherit"
     effort := d.<lane>.effort if non-empty, else "inherit"
  5. IF model starts with "engine:": validateEngineRef(cfg, model) → error "dispatch.<lane>.model: <reason>"
  6. RETURN { model, effort }
```

Each field resolves independently: a `by_tier.complex` node holding only `effort` lets `model` fall through to `by_tier.default`, then `by_confidence`, then the scalar. This matches what the FAFF-1197 overlay produced, because the overlay wrote only the fields that were set.

`resolveEngineForLane(cfg, lane)` calls `prepare(cfg)`, then reads `dispatch.<lane>.model` and `dispatch.<lane>.effort` in place of the overlaid `models.<lane>` / `effort.<lane>`. Its allowlist, `validateEngineRef`, graded-family, `reasoning_off` and clamp checks are unchanged. Error and clamp text names `dispatch.<lane>.model` / `dispatch.<lane>.effort` literally, so `laneSourceKey` is deleted along with `effectiveView` and `dispatchOverlayRows`; `engine.js` (~25, ~320, ~329) uses the literal key.

`faff config get dispatch.<lane>.<field>` stays a raw read with no registry default (exit 3 when unset), unchanged from FAFF-1197.

### Budget fleet-engine discovery

`fleetEngineBackends` (`backends.js` ~226-247) walks `dig(cfg, "models")` for `engine:` values. It feeds `unmeteredFleetEngines`, which `faff budget check`, `lights-out.js` (~988) and `economics.js` (~1118, ~1264) use to refuse a dollar ceiling when an engine's spend cannot be observed. Once lanes live under `dispatch:`, a `dispatch.methodology.model: engine:x` is invisible to this walk and the ceiling would wrongly report "under budget". (This gap already exists for `dispatch:`-set engines since FAFF-1197.)

**Chosen:** `fleetEngineBackends` walks `dig(cfg, "dispatch")` with the same recursive walker. Its selftest (~589-602), `test/backends.test.mjs` (~455, ~474) and `test/budget.test.mjs` (~1649, ~1714, ~1732, ~1800) move their fixtures to `dispatch: { methodology: { model: "engine:…" } }`.

### Run banner

`faff config resolved` prints the `legacy_tree_error` message in the existing `dispatch: INVALID` line format when a legacy tree is present. It then prints `dispatch …` lines as `printDispatchBanner` does today, with these changes: the old `model <lane>`, `model build_by_*`, `effort <lane>` and `effort build_by_tier.*` lines (~3103-3148) are deleted; the `data.models` fallback used to work out an engine lane's effective model is deleted; and the ` (not yet read at subagent dispatch sites; FAFF-1198)` annotation is replaced by ` (effort recorded, not applied: Agent tool)` on any line that sets a non-`inherit` effort for an Agent-dispatched lane. Every lane is Agent-dispatched except `methodology` and `intake` when their model is `engine:<name>`; `build.by_tier.<t>` lines count as the `build` lane.

**Chosen:** the banner is dispatch-only and states the record-only status, because the old lines would echo keys every resolver now refuses, and an unannotated `effort=low` would claim an effect that does not happen.

### Skill prose sweep

Behaviour summary: one home for the dispatch rule (the gateway's Producer dispatch paragraph in `kernel.md`), and each site names its lane and points there.

The rule, stated once in `kernel.md` → **Sibling-skill invocation → Producer dispatch**, replacing the current "Model + effort" sentences:

```
RULE dispatch_lane(lane, tier?, conf?):
  1. Run `faff dispatch resolve <lane>` (build: add --tier / --confidence when known)
  2. Exit 2 → fail loud, do not dispatch (never a silent session-model fallback)
  3. Agent-tool dispatch: model ≠ inherit → the `model` param; inherit → omit it.
     Effort is not applied (the Agent tool has no effort parameter). effort ≠ inherit → write
     "<lane>: effort <level> (not applied: Agent tool)" to the run log; no event carries it, and
     neither the dispatcher nor the subagent tags data.effort. inherit → record nothing
  4. model = engine:<name> (methodology / intake only) → the `faff engine call --lane <lane>` fork,
     which applies the lane's effort itself and refuses an effort the engine family cannot carry
  5. Record the resolved model on the run log where the site already records one
```

Two stale kernel sentences are deleted: the one saying no `effort.spec` / `effort.spec_review` / `effort.architecture` lane exists because those producers are pinned, and "On an engine lane the effort must be `inherit` (the CLI refuses the combination)" (stale since FAFF-705).

**Effort on Agent-dispatched lanes.** Options: pass an effort argument (none exists on the Agent tool); refuse a non-`inherit` effort on those lanes; record it as not applied. Refusing would make the eight-lane `dispatch:` tree from ADR-0134 unusable for effort on most lanes; passing is impossible. **Chosen:** record-only (human decision, 2026-10-06). Every Agent-dispatched site (every producer lane, `prep_explore`, `adr` and the build dispatches) follows step 3 above; only the engine fork applies effort. With no `dispatch:` effort set, nothing is recorded and the dispatch is unchanged.

**Where unapplied effort is recorded.** `faff economics --by effort` buckets spend by `data.effort` event tags, so tagging an unapplied `low` would report a saving that never happened, and `agent-dispatch` events exist only for clustered fan-outs, so most single producer dispatches have no event to carry a tag. **Chosen:** run log only (human decision, 2026-10-06). An unapplied effort goes to the run log and the `config resolved` banner note, never into `events.jsonl`; `events.js` and `economics.js` are unchanged. `economics --by effort` then reflects only effort that was really applied (engine lanes, priced from `engine-spend.jsonl`), and Agent-lane spend falls in `(none)` by absence.

Per-site edits (each replaces the site's `faff config get` text with "resolve the `<lane>` dispatch lane (gateway → Producer dispatch)" or the build form below):

| Site | Lane(s) |
|---|---|
| `plugin/skills/faff/references/kernel.md` config shape (~86-99) | Replace the `models:` and `effort:` blocks with a short `dispatch:` block; keep the `eval:` line |
| `kernel.md` transport row (~146) | "no `dispatch.transport` lane" |
| `kernel.md` "Model & effort selection" (~160-174) | Retitle to `dispatch:`; describe lanes as `dispatch.<lane>`, the build matchers as `dispatch.build.by_tier` / `by_confidence`, resolution as `faff dispatch resolve`; one paragraph replaces the separate effort-lanes paragraph |
| `kernel.md` Producer dispatch (~339) | The rule above |
| `plugin/skills/faff/references/methodology.md` (~104) | `methodology` |
| `faff-prep/SKILL.md` (~49, ~120, ~324, ~406, ~425) | `methodology`, `spec_review`, `architecture`, `prep_explore` (explore and clean-context verify), `spec` |
| `faff-jot/SKILL.md` (~52, ~60) | `intake`, `methodology` |
| `faff-plot` (~17, ~127), `faff-map` (~29), `faff-tidy` (~87), `faff-wtf` (~18) | `methodology` |
| `faff-graft/SKILL.md` Step 4b (~260) | `adr` |
| `faff-graft/SKILL.md` Step 7 (~327) | `build`: `faff dispatch resolve build --tier <tier> --confidence <conf>` from the spec's retained lines (each flag omitted when its line is absent); model applied, effort recorded per step 3 |
| `faff-beep-boop/SKILL.md` (~247) | Partition annotation (below) |
| `faffter-noon-concurrency-sequential` (~32), `faffter-dark-concurrency-parallel` (~39, ~43) | `build` (below) |

**Build-lane resolution in the executors.** Today each executor has three branches: a once-per-run `config get models.build` / `effort.build`, a per-issue `models build-for <conf>` when the confidence matcher is set, and a per-issue tier pair when either tier matcher is set. **Chosen:** one branch: for every unit, run `faff dispatch resolve build` with `--tier` and `--confidence` taken from the partition entry (each flag omitted when the entry lacks it), and stamp the returned `model` and `effort` into that unit's `BuildDispatch`. The `model` becomes the Agent-tool param; the `effort` is written to the run log per step 3 of the rule, never passed. The sweep deletes the executors' existing instruction that the build subagent tags its `data.effort` event with the resolved effort, which today reports effort that was never applied. The resolver is pure and local, so per-unit calls cost nothing, and with no matcher configured the answer equals the old per-run scalar.

**Collision chains.** A chain is one subagent, so one pair. **Chosen:** call `faff dispatch resolve build` once per chain with the chain's highest tier (`complex` > `standard` > `mechanical`) and lowest confidence (`medium` outranks `high`), keeping today's most-demanding-member rule for both keys in one call.

**Partition annotation in beep-boop.** **Chosen:** always annotate each partition entry with the spec's already-read `confidence` and `build-tier`, instead of only when a matcher is configured, so the executor needs no config check before resolving. No new tracker read: both values come from the spec the routing verdict already read.

### `validate-adapters` lint

Behaviour summary: fail CI when skill prompt text names a removed key or a removed verb, or reads `dispatch:` with `faff config get` instead of `faff dispatch resolve`.

```
RULE removed-dispatch-key (FAFF-1198):
  files: every <skillsDir>/*/SKILL.md, plus every *.md under <skillsDir>/*/references/
  pattern A: (?<![\w.$-])(models|effort)\.(build_by_confidence|build_by_tier|build|prep_explore|spec_review|spec
             |methodology|intake|architecture|adr|<lane>|<slot>)(?!\w)
  pattern B: faff (models|effort) build-for
  pattern C: faff config get\s+`?dispatch\.          # human decision, 2026-10-06
  on match: failed = true
            print "FAIL  <name> (removed dispatch key)"
            print "        ✗ line <n>: <match> was removed; use <replacement key> / faff dispatch resolve (FAFF-1198)"
            # pattern C message: "<match>: dispatch sites read dispatch: through faff dispatch resolve (FAFF-1198)"
```

**Lint scope.** Options: SKILL.md only (the ticket's words); SKILL.md plus `references/`. `kernel.md` and `methodology.md` are runtime prompt text read by every skill and today hold most of the old keys. **Chosen:** scan SKILL.md and every `references/*.md`.

**Lint exemptions.** `eval.model`, `eval.effort` and `dispatch.<lane>.model` / `.effort` do not match pattern A (the lookbehind refuses a preceding `.` or word character, and `eval` is not in the lane list); the closing `(?!\w)` rather than `\b` lets the `<lane>` and `<slot>` placeholders match; `data.effort` and `engine.effort` likewise do not match. Pattern C matches only a `faff config get` read of a `dispatch.` key, so prose naming `dispatch.<lane>.model` or `faff config set dispatch.…` stays legal. **Chosen:** no line-level exemption. Prompt text states the rule forward (skill-authoring standard: no changelog in the prompt), so it never needs to name a removed key; the CLI error messages carry the old-to-new mapping.

The rule lives beside the FAFF-191 prose-default loop and copies its shape. Tests go in a new `test/validate-adapters-removed-dispatch-key.test.mjs` using the `runOnFixture` pattern.

### Config surface

- `DEFAULTS`: delete every `models.*` and `effort.*` entry; `eval.*` stays.
- `WRITABLE_NAMESPACES`: drop `models` and `effort` (`dispatch` stays). Update the `mergeConfigPath` fixture that uses `models.build` (~1855-1859) to a `dispatch.` key.
- `.faffrc.example.yaml`: replace the `models:` block (~108-125) with a commented `dispatch:` block showing a scalar lane (`spec: effort: low`), an engine-valued `methodology.model`, and `build` with one `by_tier` and one `by_confidence` node; update the "v1: models.methodology / models.intake only" comment (~176) to `dispatch.methodology.model / dispatch.intake.model`. The namespace drift check (~1952-1960) must pass.
- `config.js` ~480: the anthropic-provider refusal names `dispatch.<lane>.model` instead of `models.<lane>`.
- `config get` validator chain (~2903) and engine-ref check (~2908): drop the old-tree validators and the `^models\.` branch.
- Config-check known-key list and selftests (~2928-3006), including the `faff config defaults --selftest` block that hard-codes `models.*` / `effort.*` and calls `validateModelLane`, `validateEffortLane` and `movedKeyError`: drop old-key entries; add the legacy-tree finding and `removed_key_error` cases.
- `docs/guide/cli.md`: delete the `models build-for` (~158) and `effort build-for` (~160) rows; the `dispatch resolve` row (~161) says every subagent dispatch site reads it and that effort is applied only on engine lanes; the `config` row (~30) says `resolved` echoes `dispatch` lines only.
- `review-iteration-cap.js` comments (~11, ~27, ~67) that cite "parity with models build-for" cite `dispatch resolve` instead.
- `test/scaffolder-cli-surface-drift.test.mjs` `faffrcFindings` (~224, ~227): the `models.` / `effort.` branches become a `dispatch.` branch validated by `validateDispatchKey`.

### Tests

Roughly twelve files and about 220 references move. `test/models-config.test.mjs`, `test/models-effort-by-tier.test.mjs` and `test/effort-config.test.mjs` are rewritten as `dispatch resolve build` chain tests over `dispatch:` fixtures (or folded into `test/dispatch-config.test.mjs`), keeping every case they cover today that still has a `dispatch:` equivalent. `test/dispatch-config.test.mjs` drops its overlay and old-tree cases and gains the removed-key and legacy-tree cases. `test/engine-call.test.mjs`, `test/config-set.test.mjs`, `test/backends.test.mjs`, `test/budget.test.mjs` and the `engine.js` / `engine-codex.js` / `backends.js` / `dispatch.js` selftests move their fixtures to `dispatch:`.

**Build order.** Port the old chain suites to `dispatch:` form first and run them green against the pre-deletion code, where the FAFF-1197 overlay is still the oracle. Only then delete the overlay and the old trees, and rerun the same ported suites unchanged.

**Anti-pattern:** keeping a small adapter that rebuilds `models:` / `effort:` shapes from `dispatch:` so the old chain functions run unchanged. Why: that is the overlay again under another name; the chains read `dispatch.*` directly.

**Anti-pattern:** reading `faff config get dispatch.<lane>.<field>` at a dispatch site. Why: it skips the build chains, the whole-tree validation and the legacy-tree check; sites use `faff dispatch resolve`.

### Failure modes

- **A dispatch site is missed and still runs `faff config get models.<lane>`.** How you'd know: the new lint fails CI on the SKILL.md or reference line; at runtime the call exits 2 naming the replacement. What it means: fix the site; the lint is the guard.
- **The rewritten chains disagree with the FAFF-1197 overlay on some config.** How you'd know: the moved chain tests (every tier, confidence and tier-absent combination the old suites covered, expressed in `dispatch:` form) produce a different pair. What it means: a bug in the rewrite; the old overlay's results are the oracle.
- **A legacy `models: methodology: engine:x` config hides an engine from the budget ceiling.** How you'd know: `faff budget check` reports under budget with no `telemetry: none` refusal. What it means: acceptable, because the same config makes `faff engine call` exit 2 (and `faff config resolved` flags it INVALID), so no engine spend can happen; no extra check is added to the governance side.
- **Operators read a recorded effort as an applied one.** How you'd know: `faff economics --by effort` shows a `low` bucket for Agent-dispatched lanes, or the banner shows `effort=low` without the note. What it means: a site still tags `data.effort` for an Agent dispatch, or the banner note is missing; both are covered by DONE items.
- **Executors behave differently with the tier matcher set and an issue lacking a tier.** How you'd know: an issue with no `build-tier:` line now gets `dispatch.build.by_tier.default.effort` where the old per-run `effort.build` read did not consult the matcher. What it means: expected; it is the tier-absent rule FAFF-1197 documented for `dispatch resolve`, now applied at every site.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose .faffrc.yaml sets dispatch.spec.effort: low and nothing else for spec
When faff-prep dispatches its spec producer as an Agent-tool subagent inside a run
Then the dispatch carries no model parameter and no effort argument
And the run log contains "spec: effort low (not applied: Agent tool)"
And no event in events.jsonl for this dispatch carries data.effort
And `faff config resolved` prints "dispatch spec: effort=low (effort recorded, not applied: Agent tool)"
```

```
Given dispatch.build.by_tier.complex.model: opus and dispatch.build.by_confidence.medium.model: sonnet
When `faff dispatch resolve build --tier complex --confidence medium` runs
Then stdout is {"model":"opus","effort":"inherit"} and exit is 0
```

```
Given a .faffrc.yaml that still holds models: { prep_explore: sonnet }
When `faff dispatch resolve prep_explore` runs
Then it exits 2 and the message names models.prep_explore -> dispatch.prep_explore.model
And `faff config resolved` prints a `dispatch: INVALID` line carrying the same mapping
And `faff config check` exits 1 with an error finding carrying the same mapping
```

```
Given any config
When `faff config get effort.build_by_tier.complex` or `faff config set models.spec opus` runs
Then each exits 2 naming dispatch.build.by_tier.complex.effort or dispatch.spec.model respectively
```

```
Given dispatch.methodology.model: engine:local, a telemetry: none engine "local", and a dollar budget ceiling with no budget.allow_unmetered entry
When `faff budget check` runs
Then it refuses the ceiling naming engine "local" as unmetered
```

```
Given a .faffrc.yaml whose only legacy content is an empty `effort:` header
When `faff dispatch resolve spec` runs
Then it exits 2 naming .faffrc.yaml and `faff config unset effort`, with no "set ..." clause
And after `faff config unset effort` it exits 0
```

- `faff models build-for` and `faff effort build-for` are unknown commands (non-zero exit, usage listing without them).
- `faff validate-adapters` passes on this repository after the sweep, and a fixture SKILL.md containing `faff config get models.spec` fails it with `(removed dispatch key)`.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| How old-key reads and writes fail | Unknown namespace (exit 3 on get); removed-key map | **Chosen:** removed-key map, exit 2 naming the replacement |
| Legacy tree in a config file | Throw from `loadConfig`; check in each resolver plus `config check`; ignore | **Chosen:** resolvers, `config resolved` and `config check` |
| `models build-for` / `effort build-for` | Keep reading `dispatch:`; remove | **Chosen:** remove; `dispatch resolve build` replaces both |
| Where the build chains live | Keep `effort.js`; fold the effort chain into `dispatch.js` | **Chosen:** effort chain into `dispatch.js`, `effort.js` deleted, model chain stays in `config.js` |
| Old-tree vocabulary tables | Keep keyed by old names; collapse to token lists | **Chosen:** collapse; old validators deleted |
| Which old values to migrate | All leaves including `inherit`; non-`inherit` only | **Chosen:** non-`inherit` only, since absence resolves to `inherit` |
| Budget fleet-engine discovery | Walk `models:`; walk `dispatch:` | **Chosen:** walk `dispatch:` |
| Run banner | Keep old lines beside dispatch lines; dispatch-only | **Chosen:** dispatch-only, annotation removed |
| Effort on Agent-dispatched lanes | Pass (impossible); refuse; record as not applied | **Chosen:** record-only (human decision, 2026-10-06) |
| Where unapplied effort is recorded | Event tag; run log only | **Chosen:** run log only; events and economics unchanged (human decision, 2026-10-06) |
| Executor build resolution | Three branches; one per-unit `dispatch resolve build` | **Chosen:** one per-unit call |
| Collision chains | Separate rules per key; one call with highest tier and lowest confidence | **Chosen:** one call |
| Beep-boop partition annotation | Conditional on matcher config; always | **Chosen:** always |
| Lint scope | SKILL.md only; SKILL.md plus `references/` | **Chosen:** plus `references/` |
| Lint exemptions | `.example`-style line exemptions; none | **Chosen:** none; the pattern already excludes eval and dispatch keys |
| ADR | New ADR; none | **Chosen:** none, see below |

The removal verb is not a decision here: FAFF-1201 owns it (human decision, 2026-10-06; see section 7).

**ADR.** ADR-0134 already decides that FAFF-1198 rewires the sites, migrates this repo's config and removes the old trees, and `records/` stays unchanged by human decision. **Chosen:** no new ADR and no edit to ADR-0134; the decisions above are implementation detail within ADR-0134's decision.

Temporal anchor: at the time of writing the Claude Code Agent tool's parameters are `description`, `prompt`, `subagent_type`, `model` and `isolation`; if an effort parameter is added, step 3 of the dispatch rule and the banner note are the places to change.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The human closed effort on Agent-dispatched lanes (record-only, dispatcher-emitted tag), the removal verb (FAFF-1201, merged), lint pattern C and empty-header handling on 2026-10-06.

**Assumptions:**

- **Assumes:** `faff config unset <dotted.key> [--local]` exists (FAFF-1201). It removes a whole map subtree such as `models` or `effort` from the base or, with `--local`, the overlay, and FAFF-1198's `removed_key_error` must not apply to it. Validation: met; FAFF-1201 merged in PR #1011 (2026-10-06). `unset` exits 3 for an absent key ("already gone"), which callers may treat as success. Before the sweep, confirm in a temp repo that `faff config unset models` and `faff config unset effort --local` remove those blocks (including an empty header) once `removed_key_error` is in place.

## 8. DONE

### From WHY
- [ ] No SKILL.md or `references/*.md` under `plugin/skills/` names a removed key or `faff models|effort build-for`; `faff validate-adapters` passes on the repository.
- [ ] Setting `dispatch.spec.model: haiku` changes the model faff-prep's spec producer dispatch runs on.
- [ ] Setting `dispatch.spec.effort: low` is never silently dropped: faff-prep's spec dispatch writes `spec: effort low (not applied: Agent tool)` to the run log, and the banner line carries `(effort recorded, not applied: Agent tool)`.
- [ ] Setting `dispatch.methodology.effort` with `dispatch.methodology.model: engine:<name>` on a graded-effort engine is applied by `faff engine call`, and the banner line carries no note.

### From WHAT (removed keys and config shape)
- [ ] `faff config get` and `faff config set` (never `faff config unset`) exit 2 for `models.<lane>`, `effort.<lane>` (all eight lanes), `models.build_by_confidence.<c>`, `models.build_by_tier.<t>`, `effort.build_by_tier.<t>`, bare `models` and `effort`, each naming the replacement key from the table; `models.eval` / `effort.eval` keep their eval message. This holds whether or not the key is set.
- [ ] `DEFAULTS` holds no `models.*` or `effort.*` entry; `eval.model` and `eval.effort` are unchanged.
- [ ] `WRITABLE_NAMESPACES` excludes `models` and `effort`; the `.faffrc.example.yaml` drift check passes with the new `dispatch:` block.
- [ ] `.faffrc.example.yaml` documents `dispatch:` (scalar lane, engine-valued methodology, build `by_tier` and `by_confidence`) and has no `models:` or `effort:` block.
- [ ] The engines anthropic-provider message names `dispatch.<lane>.model`.
- [ ] `effort.js`, `cmdModels`, `modelsSelftest`, `cmdEffort` and their `COMMANDS`, `regions.js` and `verify-split-parity` entries are gone; `lint-cli-coverage`, `lint-cli-doc` and `test/cli-coverage.test.mjs` pass.
- [ ] This repo's `.faffrc.yaml` holds `dispatch.prep_explore.model: sonnet`, `dispatch.adr.model: sonnet` and `dispatch.build.by_confidence.high.model: sonnet`, no `models:` block, and the unchanged `eval:` block; `faff config check` reports no error on it.
- [ ] This repo's `models:` block is removed with `faff config unset models`.

### From HOW (resolution)
- [ ] `effectiveView`, `dispatchOverlayRows` and `laneSourceKey` are deleted; `faff dispatch resolve` and `resolveEngineForLane` read `dispatch.*` directly.
- [ ] Build-model chain: with a tier, `by_tier.<t>.model` → `by_tier.default.model` → `by_confidence.<c>.model` → `by_confidence.default.model` → `dispatch.build.model` → `inherit`; with no tier the `by_tier` steps are skipped; an absent or unknown confidence uses `by_confidence.default`.
- [ ] Build-effort chain: `by_tier.<t>.effort` → `by_tier.default.effort` → `dispatch.build.effort` → `inherit`, with `by_tier.default` consulted when no tier is given.
- [ ] Field independence: a `by_tier.complex` node with only `effort` set resolves `model` from the rest of the chain.
- [ ] Every chain case the old `models-config`, `models-effort-by-tier` and `effort-config` suites covered has a `dispatch:`-form equivalent that passes.
- [ ] A legacy tree in either config file makes `faff dispatch resolve` and `faff engine call` exit 2 naming the file, every set leaf with its replacement, and `faff config unset <models|effort>` (with `--local` exactly when the file is `.faffrc.local.yaml`); running the named command clears the error; `faff config resolved` prints it as a `dispatch: INVALID` line; `faff config check` exits 1 with an error finding per file; `faff config set dispatch.…` still works with the legacy tree present.
- [ ] `faff engine call --lane methodology|intake` honours `dispatch.<lane>.model` / `.effort` with unchanged allowlist, engine-ref, graded-family, `reasoning_off` and clamp behaviour, and its messages name `dispatch.<lane>.<field>`.
- [ ] `fleetEngineBackends` finds `engine:` values under `dispatch:`; `faff budget check` refuses a ceiling when `dispatch.methodology.model` points at a `telemetry: none` engine with no waiver.
- [ ] `faff config resolved` prints only `dispatch …` lines for model and effort, with no "not yet read" annotation; a non-`inherit` effort on an Agent-dispatched lane carries `(effort recorded, not applied: Agent tool)`, and an engine-valued methodology or intake line carries no note.
- [ ] No dispatch site writes an unapplied effort into `events.jsonl`: the dispatch rule, both executors and graft Step 7 contain no instruction to tag `data.effort` for an Agent dispatch (the executors' existing build-subagent tag is deleted). `events.js` and `economics.js` are unchanged.
- [ ] An empty `models:` or `effort:` header in either file is a legacy tree: resolvers exit 2 naming the file and the whole-block `faff config unset` command (`--local` for the overlay), and `faff config check` reports it.
- [ ] Build order: the old chain suites are ported to `dispatch:` form and run green against the pre-deletion code before the overlay is deleted.

### From HOW (prose sweep and lint)
- [ ] `kernel.md` Producer dispatch states the single dispatch rule (resolve, exit 2 fails loud, model as the Agent param, effort recorded as not applied on Agent dispatches, engine fork applies it); the "producers are pinned" and "effort must be inherit on an engine lane" sentences are gone.
- [ ] Every site in the per-site table resolves through `faff dispatch resolve <lane>`, passes the model and records a non-`inherit` effort per the rule; `prep_explore` covers both the explore and the clean-context verify dispatch.
- [ ] Both executors resolve each unit with one `faff dispatch resolve build [--tier] [--confidence]` call; a collision chain uses its highest tier and lowest confidence.
- [ ] faff-beep-boop always annotates partition entries with `confidence` and `build-tier`.
- [ ] graft Step 7 uses one `faff dispatch resolve build --tier <t> --confidence <c>` call; Step 4b resolves the `adr` lane.
- [ ] The `removed dispatch key` lint scans SKILL.md and `references/*.md`, fails on patterns A, B and C, and passes on `eval.model`, `eval.effort`, `dispatch.spec.model`, `data.effort` and `faff config set dispatch.spec.effort low`; `test/validate-adapters-removed-dispatch-key.test.mjs` covers positive, negative and reference-file cases, including a pattern C positive (`faff config get dispatch.spec.model`) and negative (`faff dispatch resolve spec`).
- [ ] No touched file grows past its pre-change line count as counted by `wc -l` (graft 954, prep 622, beep-boop 776, kernel 467; `validate-adapters` counts one more line per file, so its caps read 955, 623, 777 and 468); no baseline is raised. The longer dispatch rule is paid for by shortening the per-site prose it replaces (three resolution branches per site become one call). Every paragraph stays under `PARA_WORD_CAP`.
- [ ] `docs/guide/cli.md` has no `models build-for` or `effort build-for` row; the `dispatch resolve` row says every subagent dispatch site reads it.
- [ ] `records/` and `.faff/anchors/` are unchanged.

### Integration smoke test

```
1. In a temp repo, faff config set:
     dispatch.spec.effort low
     dispatch.build.by_tier.complex.model opus
     dispatch.build.by_tier.complex.effort high
     dispatch.build.by_confidence.medium.model sonnet
2. faff dispatch resolve spec                                      → {"model":"inherit","effort":"low"}
3. faff dispatch resolve build --tier complex --confidence medium  → {"model":"opus","effort":"high"}
4. faff dispatch resolve build --confidence medium                 → {"model":"sonnet","effort":"inherit"}
5. faff config resolved   → "dispatch spec: effort=low (effort recorded, not applied: Agent tool)"; no "model"/"effort" lane lines
6. faff config get models.spec                                     → exit 2, names dispatch.spec.model
7. faff models build-for                                           → unknown command
8. Append "models:\n  adr: sonnet" to .faffrc.yaml
9. faff dispatch resolve spec   → exit 2, names .faffrc.yaml, models.adr -> dispatch.adr.model and `faff config unset models`
10. faff config resolved        → a "dispatch: INVALID" line with the same mapping
11. faff config check           → exit 1 with the same mapping
12. faff config unset models    → exit 0; step 9 now succeeds
13. In the faff checkout: faff validate-adapters → exit 0
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** It is past the 1-3 day norm, and the `complex` tier fits. With `faff config unset` split out into FAFF-1201, what remains has to land as one change. Sweeping the prose without removing the old keys leaves two read paths, and removing the keys without the sweep breaks every site at exit 2. Section 2 now agrees with section 4 on what changes in `events.js` and `economics.js`. No issues.

**Workstream fit?** It fits. The ticket closes the dispatch consolidation in "Cost-aware model & transport routing". It delivers one read path, `dispatch.<lane>.model` taking effect at every site, effort applied on engine lanes, and unapplied effort reported honestly in the `(none)` bucket. Applying effort on Agent-tool lanes is recorded as open on FAFF-423. One leftover: the old executors stamped build effort without applying it, so historical `economics --by effort` figures for the build lane may still overstate savings. What to do: if that history matters for tuning, file a small follow-up. It does not block this ticket.

**Deps surfaced?** FAFF-1201 (PR #1011) and FAFF-1197 (PR #1008) are both Done, so nothing blocks this ticket. FAFF-70, FAFF-1161 and FAFF-423 are linked as related, and the description now opens with a pointer to the spec. No issues.

**Risk profile?** Moderate, and well de-risked. The hard cutover is guarded at runtime by exit 2 and in CI by the removed-key lint. The planned pattern for raw `faff config get dispatch.` reads covers the remaining way to skip `faff dispatch resolve`. The ported chain suites, run green against the overlay before it is deleted, keep a test oracle in place. Counting empty legacy headers (`models:` with no leaves) as legacy matches FAFF-1201, which already removes a null leaf. Three things are still to confirm or watch:
- **Unapplied effort stays out of the event stream.** By human decision it is recorded in the run log and the banner only, so `economics --by effort` reports only effort that was really applied (engine lanes). Check that the sweep deletes the executors' existing build-subagent `data.effort` tag, which over-reports today.
- **Line caps.** The longer step 3 of the dispatch rule has to fit within the stated `wc -l` caps.
- **Build order.** Ported suites first, then the deletions, then the sweep.

What to do: build in the order the spec sets (ported suites first, then the deletions, then the sweep), and pay for the longer dispatch rule by shortening the per-site prose it replaces.

confidence: high
build-tier: complex
spec-review: accept (human, after round 4: fix the named minors and build)

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
