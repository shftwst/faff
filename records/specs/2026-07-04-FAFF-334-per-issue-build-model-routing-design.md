# FAFF-334 — Per-issue build-model routing: choose `models.build` by spec confidence, not per-run

> Spec: faffter-dark-nlspec · 2026-07-04 · autonomous · confidence: high.

This is a **build spec** (not a spike): extend the shipped `models.build` lane (FAFF-315) from a single per-run scalar into a per-issue matcher, so the safe build model is chosen automatically per issue from the spec's retained confidence — without hand-editing `.faffrc` before every run to match the hardest ticket in the queue. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**The load-bearing model:** `models.build` is resolved **once per run** at queue-assembly time and stamped identically into every `BuildDispatch` (both concurrency executors, `faffter-noon-concurrency-sequential/SKILL.md:30` and `faffter-dark-concurrency-parallel/SKILL.md:31`). But the *right* build model is a per-issue property, not a per-run one: on a thin / medium-confidence spec the build subagent runs spec-gap **resolve-attempts** (it infers answers from codebase conventions) and its **first-pass structural self-review runs inline on `models.build`** — both degrade on a weaker model. A cheap model is safe for high-confidence mechanical issues and risky for thin, design-heavy ones, and the same queue routinely holds both.

**Problem:** the single per-run `models.build` forces one model across a mixed-confidence queue, so a human must hand-edit the rc to the hardest ticket before each run or accept a too-cheap model on the risky ones. This change keys the build model off the confidence the spec **already carries**, resolved per issue at dispatch, so no rc churn is needed.

**Design principles:**

- **Unset / scalar ⇒ byte-for-byte today.** With no matcher configured, resolution stays exactly as FAFF-315 shipped — resolved once per run, no per-issue tracker read, no new consult. A missing key is never a park reason and never a behaviour change (the gateway slot/model rule).
- **Never make `models.build` itself a map.** The FAFF-315 resolver reads `models.build` expecting a scalar Agent-token; a map value there returns `[object Object]` from `faff config get` and would silently break it. The matcher therefore lives in a **sibling** key, purely additive.
- **CLI-only resolution, fail-loud on invalid.** Every value still resolves through the `faff` CLI against the **same closed Agent-token set** (`MODEL_LANE_VOCAB`); an off-vocabulary token in the matcher fails loud exactly as `models.build` does today — never a silent inherit (the FAFF-50 / dropped-slot principle).
- **Deterministic lookup is a tool, not prose.** The fallback chain + token validation is a same-input-same-output computation; it belongs in a tested CLI resolver, not duplicated as fiddly prose across two SKILL.mds (governing principle: deterministic-tools-over-prose; and the dedup rule).

**Reference context:**

| System | Where | Relevance |
|---|---|---|
| Per-run `models.build` resolution | `faffter-noon-concurrency-sequential/SKILL.md:30`, `faffter-dark-concurrency-parallel/SKILL.md:31` — resolve `faff config get models.build` once/run, stamp into every `BuildDispatch` | The exact resolution point this change moves from per-run to per-issue |
| Config registry + defaults | `bin/faff` `DEFAULTS` :296–298, `config resolved` echo, `config defaults --selftest` :799–809 | Where the new sibling key registers, self-tests, and shows in the run banner |
| Token vocabulary + validation | `bin/faff` `MODEL_LANE_VOCAB` :305–308, `validateModelLane()` :309–313, read-time enforcement :785 | The closed Agent-token set the matcher values reuse; currently keyed by **exact** key, so it must be extended to cover the matcher leaves |
| YAML-subset parser | `bin/faff` `parseYamlSubset` + `parseSeq` (nested maps parse natively post-FAFF-262); `dig()` dotted access | A nested `models.<key>.<leaf>` map round-trips through `faff config get` (verified empirically) — no parser change |
| Retained confidence extraction | `bin/faff:4316` `/confidence:\s*\**\s*(high|medium|low)\b/i`; retained `confidence:` + `spec-review:` lines written by faff-prep on attach | The per-issue routing key; the spec already carries it as durable provenance |
| Concurrency partition payload | gateway `concurrency` slot input `{ independents, groups }`; beep-boop assembly already reads each spec's confidence and passes `--spec <conf>` to `faff next` for the routing-verdict gate | The orchestrator **already holds** each issue's confidence at assembly — the carrier this change extends |
| Tests | `test/models-config.test.mjs` (FAFF-315 cases: defaults, valid/invalid token exit-2, `config resolved` echo) | The test surface the matcher + resolver cases extend |
| FAFF-315 spec | `records/specs/2026-07-03-FAFF-315-per-lane-model-selection-design.md:112` | Names this ticket by design: "per-issue routing is a future rung on the same key (`models.build` grows a matcher), not a redesign" |

**Scope statement:** the first per-issue rung on the `models.build` lane, sitting on top of the shipped FAFF-315 per-run surface and below the deferred FAFF-69/70 capability/invocation schema — a matcher, not a redesign.

## 2. OUT OF SCOPE

- **Making `models.build` itself a map / removing the scalar.** Excluded — it would break the FAFF-315 scalar resolver. Extension point: the matcher lives in the sibling `models.build_by_confidence` key; the scalar `models.build` stays the default.
- **Change-surface and spec-review-verdict routing dimensions.** Excluded from v1 — routing on `confidence` alone satisfies every AC. Extension point: additional keys in the same `models.build_by_confidence` map, added when per-lane fidelity is measured (FAFF-129/319/321).
- **The FAFF-69/70 capability / invocation (`role.invocation[mode].engine`) schema.** Excluded — deferred per ADR-0038; this rung migrates onto it later as a rename, not a redesign. Extension point: the FAFF-69 role DSL.
- **Per-issue models for `prep_explore` / `eval` or any Skill-tool-inline slot.** Excluded — those lanes have no per-issue confidence signal at their dispatch and inline slots can't take a model at all (FAFF-315). Extension point: each lane's own dispatch prose.
- **Calibrating the confidence→model thresholds against measured fidelity.** Excluded — FAFF-129/319/321 own "measure before assigning"; this ticket only makes the assignment *expressible*. Extension point: the measurement tickets feed recommended default maps.

## 3. WHAT — Vocabulary, Config Surface, and Wiring

**Vocabulary:**

| Term | Definition |
|---|---|
| build lane | The build-subagent dispatch point (both concurrency executors) that consumes an Agent-tool `model` param |
| Agent-token | The closed `model` vocabulary: `inherit` \| `sonnet` \| `opus` \| `haiku` \| `fable` (`MODEL_LANE_VOCAB`) |
| matcher | The optional `models.build_by_confidence` map: a `default` plus confidence-keyed overrides |
| retained confidence | The `high`\|`medium`\|`low` token on the spec's retained `confidence:` line (bin/faff:4316 regex) |

**The config surface** (documented in the gateway `models:` schema block, extending FAFF-315):

```
models:
  build: opus                    # scalar Agent-token — the per-run default (UNCHANGED; still valid alone)
  build_by_confidence:           # OPTIONAL matcher; absent ⇒ resolve models.build once/run, byte-for-byte today
    default: opus                # used when an issue's confidence has no explicit key
    high: sonnet                 # a high-confidence (mechanical) spec ⇒ the cheap lane
    medium: opus                 # a medium / thin spec ⇒ the richer model
```

RECORD `models.build_by_confidence` (all keys optional):

```
RECORD BuildByConfidence:
  default: Agent-token    # optional; falls through to scalar models.build, then inherit
  high:    Agent-token    # optional; used for a retained confidence: high spec
  medium:  Agent-token    # optional; used for a retained confidence: medium spec
  # `low` never dispatches (a low spec is parked at prep) — a low: key is inert, tolerated not honoured
  CONSTRAINT every value ∈ MODEL_LANE_VOCAB (else fail-loud at read, exit 2)
```

- **Chosen:** the matcher is a **sibling map** `models.build_by_confidence`, not a reshaping of `models.build` (rationale §6).
- **Chosen:** matcher values reuse the **closed Agent-token set** with the same fail-loud validation as `models.build` — extend `MODEL_LANE_VOCAB` coverage to the matcher leaves so an invalid token exits 2 naming the value + legal set at read time (bin/faff:785).

**The resolver** — a small deterministic CLI subcommand `faff models build-for <confidence>` owns the lookup + fallback + validation (rationale §6). It is **pure** (no tracker call — the confidence is passed in) and prints the resolved token (or nothing / `inherit` for the omit-param case):

```
faff models build-for high     → sonnet   (from build_by_confidence.high)
faff models build-for medium   → opus     (from build_by_confidence.medium)
faff models build-for <absent> → default → scalar models.build → inherit
```

**The dispatch wiring** (both concurrency executors, prose):

- When `models.build_by_confidence` is **absent** → resolve `faff config get models.build` **once per run** and stamp into every `BuildDispatch` — FAFF-315's path, byte-for-byte (no per-issue read, no partition-payload change).
- When it is **present** → the confidence rides the **partition payload** the orchestrator already produces: beep-boop assembly already reads each spec's confidence for the routing-verdict gate (`--spec <conf>` → `faff next`), so it **annotates each partition entry** with that already-known `confidence` (no new tracker read). The executor then, per issue at `BuildDispatch` assembly, resolves `faff models build-for <that entry's confidence>` and stamps the per-issue token into that issue's `BuildDispatch`. `inherit` ⇒ omit the Agent-tool `model` param, exactly as today.

**Why the payload, not an executor tracker read:** the `faff` CLI is pure (no tracker call) and the executor is a mechanism slot that should not grow an MCP dependency; the orchestrator already holds the confidence one step earlier. Carrying it in the payload is the minimal, lane-honest change — the tracker read stays where it already happens.

**Design decisions (rationale in §6):**

- **Chosen:** route on `confidence` alone at v1 (not `× spec-review verdict × change-surface`).
- **Chosen:** sibling `models.build_by_confidence` map; `models.build` scalar stays the default.
- **Chosen:** a `faff models build-for` resolver owns the fallback + validation; executors call it.
- **Chosen:** per-issue tracker read happens **only** when the matcher is configured (zero cost otherwise).

## 4. HOW — Behaviour

**Resolution at a build dispatch point:**

```
PROCEDURE resolve_build_model(issue):
  1. IF no build_by_confidence key is set:            # matcher absent
     a. RETURN resolve once/run: `faff config get models.build`   # FAFF-315 path, byte-for-byte
  2. # matcher present → per issue
     conf := `issue`'s confidence from the partition-payload entry
             (orchestrator-annotated at assembly; the same value it computed for the routing gate);
             absent/unparseable ⇒ treat as the map's `default` bucket
     RETURN `faff models build-for <conf>`
```

```
PROCEDURE `faff models build-for <conf>`:      # pure, no tracker call
  1. token := build_by_confidence.<conf>
             ?? build_by_confidence.default
             ?? models.build (scalar)
             ?? "inherit"
  2. IF token ∉ MODEL_LANE_VOCAB: FAIL LOUD (exit 2, name value + legal set)  # never a silent inherit
  3. PRINT token   # "inherit" ⇒ caller omits the Agent-tool model param (today's dispatch)
```

**Behaviour summary:** the matcher's presence is the single switch between per-run (today) and per-issue resolution; when present, each issue's build model is a pure function of its retained confidence and the map, computed by the CLI so the two executors share one tested implementation.

**Edge cases (explicit precedence):**

- Matcher absent ⇒ per-run scalar resolution, no per-issue read (backward compatible).
- Confidence key present but no matching leaf ⇒ `default` ⇒ scalar `models.build` ⇒ `inherit` (documented fallback chain).
- Spec with no parseable `confidence:` line ⇒ routed as the `default` bucket (mirrors bin/faff:4319's "no confidence line" tolerance; the resolver never guesses `high`).
- `low` confidence ⇒ never reaches build (parked at prep); a `low:` key is inert.
- Invalid Agent-token anywhere in the matcher ⇒ fail-loud at read (exit 2), surfaced as a normal dispatch failure (park/errored), never a silent downgrade.
- Only `high` and `medium` are the meaningful routed buckets (the two confidences that reach the build queue).

**Failure modes — how the approach could be wrong, and how you'd notice:**

- **The confidence signal is the wrong routing key** (a mechanical high-confidence spec still needs a strong model, or vice-versa). How you'd know: measured per-lane fidelity (FAFF-129/319/321) shows the cheap lane failing on high-confidence issues. What it means: the map's *values* are recalibrated (config-only), or the routing gains a dimension (the OUT-OF-SCOPE extension point) — the mechanism stands; only the thresholds move. Named, not built here.
- **Per-issue confidence isn't reliably readable at dispatch.** How you'd know: the executor can't find a retained `confidence:` for a queued issue. What it means: the resolver falls back to the `default` bucket (fail-safe to the richer configured default), never crashes — the same tolerance bin/faff:4319 already applies.

**Anti-pattern:** making `models.build` a map for symmetry. Why: `faff config get models.build` then returns `[object Object]` and silently breaks the FAFF-315 scalar resolver — the sibling key exists precisely to keep the scalar path untouched.

**Anti-pattern:** duplicating the fallback+validation chain as prose in both concurrency SKILL.mds. Why: it is a same-input-same-output computation (a tool's job) and two prose copies drift; the `faff models build-for` resolver is the single tested home.

## Scenarios

```
Given .faffrc with models.build_by_confidence: { high: sonnet, medium: opus }
  and two Todo issues in one run, one spec retained confidence: high, one confidence: medium
When the concurrency executor assembles their BuildDispatches
Then the high issue's dispatch carries model: "sonnet" and the medium issue's carries model: "opus"
     — different build models in the same run with no rc edit between them
```

```
Given no models.build_by_confidence block (models.build: opus scalar, or unset)
When any build dispatch fires
Then resolution is once-per-run exactly as FAFF-315 (scalar opus, or model param omitted when unset) — byte-for-byte today
```

```
Given models.build_by_confidence: { high: gpt-5 }   (not an Agent-token)
When the resolver evaluates a high-confidence issue
Then it fails loud naming "gpt-5" and the legal set — no silent inherit
```

```
Given models.build_by_confidence: { high: sonnet }   (no default, no scalar models.build)
When a medium-confidence issue resolves
Then build-for medium falls through: medium(absent) → default(absent) → models.build(absent) → inherit (param omitted)
```

Non-functional assertion: with `models.build_by_confidence` unset, no new `faff config get` failures, no per-issue tracker reads added, and zero behaviour change vs FAFF-315.

## 6. DESIGN DECISION RATIONALE

**Sibling map or reshape `models.build` into a map?** A map *at* `models.build` reads tidiest but `faff config get models.build` then returns `[object Object]` (verified empirically) and silently breaks the shipped FAFF-315 scalar resolver — a backward-compat trap. **Chosen:** a sibling `models.build_by_confidence` map with the scalar `models.build` as the terminal default; the scalar path is 100% untouched and the matcher is purely additive.

**Route on confidence alone, or confidence × verdict × surface?** The AC allows the verdict as optional. But build-admission already requires `spec-review: approve`, so every issue that reaches the build queue carries the same verdict — it adds no routing signal at v1; and `low` never builds, so only `high`/`medium` route. Change-surface wants measured thresholds (FAFF-129/319/321) before it earns a dimension. **Chosen:** `confidence` alone at v1; the map is open to future keys without a redesign. (**Punt:** the extra dimensions, deferred to measurement; non-blocking.)

**New `faff models build-for` subcommand, or inline prose resolution like FAFF-315?** FAFF-315 chose "no new subcommand" for a single scalar read. This is a multi-key fallback chain + closed-token validation — a same-input-same-output computation that governing-principle #1 assigns to a deterministic tool, and duplicating it across two concurrency SKILL.mds would drift and violate the dedup rule. **Chosen:** a small pure resolver rides the existing config machinery (reuses `dig`, `DEFAULTS`, `validateModelLane`); the executor prose stays a one-liner. Proportionate: the surface has grown past the scalar-read line FAFF-315 sat on.

**Where does the per-issue confidence come from — a fresh executor tracker read, or the partition payload?** The `faff` CLI is pure (no tracker call, an invariant) and a fresh executor-side MCP read per issue adds latency and grows a mechanism slot's dependencies. The orchestrator **already** reads each spec's confidence at assembly (it passes `--spec <conf>` to `faff next` for the routing-verdict gate). **Chosen:** annotate the concurrency partition entries with that already-known `confidence` and pass it into the pure `build-for` resolver — the minimal carrier change, no new tracker read, and the tracker access stays where it already is.

**Where it lands relative to FAFF-69/70.** The FAFF-315 spec (:112) and ADR-0038 frame this as a rung on the same `models.build` key that later migrates onto the FAFF-69 role DSL as a rename. **Chosen:** build it on the current `models:` surface now (the OUT-OF-SCOPE section marks the migration seam); it does not need the capability schema first.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:**

- **Punt:** the exact routing signal beyond v1 — `confidence` alone (built) vs `confidence × spec-review-verdict × change-surface`. Needs per-lane fidelity **measured** (FAFF-129/319/321) to calibrate thresholds before adding a dimension. Non-blocking: v1 ships confidence-keyed and the map is open to more keys.

**Assumptions:**

- **Assumes:** `models.build_by_confidence.<leaf>` nested-map keys round-trip through `faff config get` (dotted `dig()`). Validation: verified empirically during prep (`faff config get models.build_by_confidence.high → sonnet`); re-run the parser selftest before wiring.
- **Assumes:** `MODEL_LANE_VOCAB` / `validateModelLane` is keyed by exact key (`models.build`, `models.prep_explore`) and does **not** currently cover `models.build_by_confidence.*`. Validation: grep bin/faff:305–313 before extending — the build must add the matcher leaves to read-time validation.
- **Assumes:** `BuildDispatch` is prose-defined only in the two concurrency SKILL.mds (:30/:31) with no CLI struct to migrate. Validation: grep before editing.
- **Assumes:** the beep-boop orchestrator already parses each issue's `confidence:` at queue assembly (for the `faff next --spec` routing gate), so it can annotate the partition entries without a new read. Validation: confirmed by the explore pass; re-check the assembly step before wiring the payload field.

## 8. DONE — Definition of Done

### From WHAT (config surface)
- [ ] `models.build_by_confidence` parses as a nested map; `faff config get models.build_by_confidence.{default,high,medium}` each resolve their leaf; `config resolved` echoes the map when set (non-default visible in the run banner).
- [ ] Every matcher value is validated against `MODEL_LANE_VOCAB`; an invalid token fails loud at read (exit 2 naming the value + legal set); `config defaults --selftest` covers the matcher leaves.
- [ ] Scalar `models.build` alone still resolves to its Agent-token (unchanged); the gateway `models:` schema block documents the sibling matcher + fallback chain.

### From WHAT (resolver)
- [ ] `faff models build-for <confidence>` resolves `build_by_confidence.<conf> → .default → models.build → inherit`, prints the token (or `inherit`), and is pure (no tracker call).
- [ ] `faff models build-for` fails loud on an invalid resolved token; an absent/unknown confidence routes to the `default` bucket.

### From HOW (dispatch wiring)
- [ ] When the matcher is set, the beep-boop assembly annotates each concurrency partition entry with its already-computed `confidence`; the executor consumes it (no new executor-side tracker read).
- [ ] Both concurrency executors: matcher **absent** ⇒ resolve `models.build` once per run and stamp identically (byte-for-byte FAFF-315, no per-issue read); matcher **present** ⇒ per issue, resolve `faff models build-for <entry confidence>`, stamp the per-issue token, `inherit` ⇒ omit the param.
- [ ] Two same-run issues of different retained confidence resolve to different build models with no rc edit between them.
- [ ] The resolved per-issue model is recorded per issue (BuildDispatch + run log / ledger line) — never silent.

### From HOW (backward compat)
- [ ] With `models.build_by_confidence` unset: build dispatch is unchanged, partition payload unchanged, full `node --test` suite green, `validate-adapters` green, no per-issue tracker reads added.
- [ ] `test/models-config.test.mjs` gains cases: matcher-leaf resolution + `config resolved` echo; invalid matcher token exit-2; `faff models build-for` fallback precedence (`<conf> → default → scalar → inherit`); scalar `models.build` alone still resolves byte-for-byte.

**Eval coverage:** not applicable — per-issue model *selection* is mechanical plumbing (deterministic lookup + parameter pass-through); it introduces no new LLM-judgement seam. (The judgement quality of the models *chosen* per confidence bucket is FAFF-129/319/321's measurement domain.)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. echo models: { build: opus, build_by_confidence: { high: sonnet, medium: opus } } into a temp .faffrc copy
  2. faff config get models.build_by_confidence.high → "sonnet"; config resolved shows the map
  3. faff models build-for high → "sonnet"; build-for medium → "opus"; build-for low → default/scalar/inherit chain
  4. faff models build-for high with build_by_confidence.high: gpt-5 → exit 2 naming gpt-5 + legal set
  5. remove build_by_confidence → build-for <any> == faff config get models.build (byte-for-byte); node --test green
  6. grep both concurrency SKILLs → per-issue resolution prose gated on models.build_by_confidence presence
```

confidence: high
spec-review: approve
