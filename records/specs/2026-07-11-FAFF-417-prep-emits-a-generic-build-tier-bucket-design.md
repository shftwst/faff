# FAFF-417 — Prep emits a generic build-tier bucket as the per-ticket model+effort routing signal

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-417.

This spec defines the work for FAFF-417: at prep time, derive a model-agnostic `build-tier` (`mechanical | standard | complex`) from the attached spec's mechanical structure, retain it durably on the spec, and let per-issue build dispatch route model + effort on it. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model:** the tier is a *deterministic, prep-time classification of the spec artifact itself* — a pure function over mechanically-extracted spec features — not a judgement self-rating. FAFF-411 proved the self-rated `confidence` line is a near-constant (128/134 specs say `high`; r = −0.15 vs diff size) while mechanical spec-structure signals predict build shape (`spec_lines → lines_changed` r = 0.557, `done_items` r = 0.346, `scenario_count` r = 0.338). So the routing signal must be computed *from* the spec by a tool, not asked *of* the spec producer.

**Problem:** per-ticket model+effort routing exists only as `models.build_by_confidence` (FAFF-334), keyed on a signal FAFF-411 showed carries almost no information; `effort.build` (FAFF-416) is a per-run scalar with its per-issue matcher explicitly deferred to this ticket (ADR-0050). This change mints the evidence-backed per-ticket signal and the matchers that consume it.

**Design principles:**

- **Deterministic-tools-over-prose.** The tier is computed by a pure CLI resolver, never estimated by an LLM. Same spec + same params ⇒ same tier, always.
- **Generic by design.** The tier names a shape class, not a model. All tier→{model, effort} mapping lives in `.faffrc`; a model-mix change never invalidates stamped tiers.
- **Coarse on purpose.** Best predictor r ≈ 0.56 (~31% of variance): enough to *rank* into three buckets, not to predict size. Exactly three tiers, never more.
- **Byte-for-byte off.** With no `*_by_tier` config, dispatch is unchanged — the FAFF-334/FAFF-315/FAFF-416 posture verbatim.
- **Routing-only.** The tier never gates promotion, parking, or merge. The low-confidence-parks-at-prep invariant is untouched; every tier builds.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/config.js` | `resolveBuildModel` (FAFF-334 fallback chain, fail-loud leaf validation) — the resolver pattern to mirror; `EFFORT_LANE_VOCAB` + prep-boundary hard exclusion (FAFF-416); `config resolved` run-banner echo |
| `plugin/skills/faff/bin/lib/labels.js` | `CONTROL_LABELS` — 5 boolean presence-flags; no value-carrying label precedent (why the tier is not a label) |
| `docs/spikes/2026-07-10-faff-411/tier.mjs` | Pure `tier()`/`tierScore()` scratch — the classifier mechanism to port (weighted-linear score, two cut points, confidence prior) |
| `docs/spikes/2026-07-10-faff-411/RESULTS.md` + `analyze-output.json` + `analyze.mjs` | Calibration evidence, per-issue corpus rows (n=151), and the canonical feature-extraction regexes |
| `docs/adr/0050-per-lane-effort-routing-mirrors-the-model-lanes-and-stops-at-the-prep-boundary.md` | Defers the per-issue effort matcher to FAFF-417; pins the prep boundary this spec preserves |
| `plugin/skills/faff-prep/SKILL.md` | Retained-line convention (`confidence:` :397–400, `spec-review: approve` :135) and the attach sites that will stamp the tier |
| `plugin/skills/faff-beep-boop/SKILL.md` (:174) | Partition-entry annotation — the sole per-issue signal channel to build dispatch |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md`, `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | Per-issue `build-for` resolution at dispatch; collision-chain most-demanding-member rule |

**Scope:** this is the prep→build routing seam of the economics workstream (FAFF-334 → FAFF-415/416 → this → FAFF-413 tuning).

## 2. OUT OF SCOPE

- **A `build-tier` label family** — no value-carrying label precedent; labels churn on re-spec and need ensure-before-tag provisioning. *Extension point:* `CONTROL_LABELS` in `labels.js` (3 manifest entries) if humans later want tracker-board filtering.
- **Self-tuning of weights/cuts against live outcomes** — FAFF-413 owns it. *Extension point:* the `params` argument of `tier()`; the baked defaults are the seed it tunes.
- **Per-issue cost telemetry** — blocked on FAFF-415/418 (token proxy is run-averaged); the "is cheaper net-cheaper?" question stays open. *Extension point:* FAFF-415 event fields.
- **Forward Sonnet-vs-Opus A/B** — FAFF-411 Phase 2, needs a live window.
- **Effort/model routing for non-build lanes** — ADR-0050's prep-boundary pin stands; `*_by_tier` keys exist for the build lane only. *Extension point:* `EFFORT_LANE_VOCAB`.
- **Build-time feature tiering** (`modules`, `dep_count`, `test_coverage`, full `file_count`/`lines_changed` actuals) — not extractable at prep; RESULTS.md shows `files_changed` is unpredictable from any spec signal (all |r| < 0.09), so estimating them would fabricate signal. *Extension point:* FAFF-413's post-build tuning loop.
- **Failure-outcome prediction** — survivorship-blocked (140 shipped / 6 parked corpus); forward window per RESULTS.md.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| build-tier | `mechanical \| standard \| complex` — a shape class of the specced work, derived from the spec artifact |
| retained line | A durable `key: value` line kept verbatim on the attached spec (house precedent: `confidence:`, `spec-review:`) |
| matcher | An optional `.faffrc` map from a per-issue signal to a per-lane value, with fail-loud leaf validation (precedent: `models.build_by_confidence`) |
| partition entry | The per-issue record beep-boop hands the concurrency executor; carries per-issue routing annotations |

**Signal carrier.** The tier is stamped as a retained line on the attached spec, adjacent to `confidence:`:

```
build-tier: standard
```

**Chosen:** retained line only — no label family, no new tracker field. Rationale: the only consumer channel (partition-entry annotation → executor) already reads the attached spec, so the line costs zero new tracker reads; a label family would mint faff's first value-carrying label (3 manifest entries, provisioning, re-spec mutation churn) for no consumer. Inspectability holds: the line is visible on the tracker comment, `faff tier --json` exposes score + features, and the run banner + dispatch log echo the resolved routing.

**Computation locus.** faff-prep computes the tier at every attach/reattach site by invoking the deterministic resolver on the produced spec — the producer never self-rates a tier.

**Chosen:** prep-side deterministic CLI at attach time (`faff tier`), recomputed on every attach, reattach, and Path-3 refresh. Rationale: FAFF-411's headline is that producer self-ratings are uninformative; the deterministic-tools-over-prose tenet puts the classification in the CLI. Recompute-on-refresh keeps the line honest as the spec changes.

**Types:**

```
RECORD TierFeatures:                # extracted from the attached spec markdown
  spec_lines: int                   # full attached-spec line count
  done_items: int                   # count of `- [ ]` / `- [x]` checklist lines
  scenario_count: int               # count of Given-line starts
  confidence: string?               # retained confidence token; absent/unparseable => default prior
  gate_history: int?                # prior park/needs-human count; optional, omitted => no contribution

RECORD TierParams:
  w: Map<feature, weight>           # generic: score = Σ w[k] * features[k]
  confidence_adj: { high, medium, low, default }
  cut: { mechanical, standard }     # score <= mechanical => mechanical; <= standard => standard; else complex

FUNCTION tier(features, params) -> 'mechanical' | 'standard' | 'complex'   # pure
FUNCTION tierScore(features, params) -> number                             # pure, for --json inspectability
FUNCTION extractSpecFeatures(specText) -> TierFeatures                     # pure over the markdown text
```

**Config keys (all optional; absent ⇒ today's behaviour byte-for-byte):**

```
models:
  build_by_tier:            # values: closed build Agent-token set + inherit (same vocab as models.build)
    default: <token>
    mechanical: <token>
    standard: <token>
    complex: <token>
effort:
  build_by_tier:            # values: inherit | low | medium | high | xhigh | max (EFFORT vocab)
    default: <level>
    mechanical: <level>
    standard: <level>
    complex: <level>
```

**CLI surfaces:**

- `faff tier <spec-file> [--gate-history N] [--json]` — prints the bare tier token; `--json` prints `{ tier, score, features }`. Exit 0; exit 2 on usage/missing file/invalid flag. Read-only, pure.
- `faff models build-for [<confidence>] [--tier <tier>] [--confidence <conf>]` — extends the FAFF-334 command; the bare positional form stays byte-for-byte compatible.
- `faff effort build-for [--tier <tier>]` — new; resolves the per-issue build effort.

Each new/extended command follows the house 6-touchpoint pattern (lib fn + selftest, require, `COMMANDS`, `REGION_MAP`, `REGION_SELFTEST_ARGV`, `docs/cli.md` row).

## 4. HOW — Behavior

### Classifier mechanism

The wired classifier ports `tier()`/`tierScore()` from `docs/spikes/2026-07-10-faff-411/tier.mjs` into a new `bin/lib/tier.js` factory region, with one deliberate generalisation: the score iterates `params.w` keys (`score = Σ w[k]·features[k]`) instead of hardcoding the six diff-feature names, so the prep-native and (future, FAFF-413) build-native parameterisations share one pure action surface. Confidence prior and two-cut bucketing are ported verbatim in shape.

**Chosen:** weighted-linear score + two cut points over the *spec-native* feature vector `{spec_lines, done_items, scenario_count}` + confidence prior + optional gate-history prior — not a complexity×risk matrix, not a dominant-axis rule. Rationale: a matrix needs per-axis judgement ratings the spike showed are uninformative; a dominant-axis rule discards the additive evidence of three correlated-but-distinct predictors; the weighted-linear + tertile-cuts mechanism is the spike's calibrated, tested seed. The diff-shape features (`file_count`, `lines_changed`, `modules`, `dep_count`, `test_coverage`) are post-hoc actuals — feeding prep-time *estimates* of them would fabricate signal RESULTS.md explicitly shows doesn't exist (`files_changed` unpredictable from any spec signal).

**Feature extraction** reuses the corpus extraction rules byte-for-byte so calibration and runtime measure the same thing (`analyze.mjs` :224–226):

```
spec_lines     = specText.split('\n').length            # full attached spec text
scenario_count = count of /^\s*[-*]?\s*(Given|GIVEN)\b/gm
done_items     = count of /^\s*-\s*\[[ x]\]/gm
confidence     = retained confidence line (unparseable => absent, never promoted to high)
```

### Calibration of the shipped default params

**Chosen:** derive the baked `DEFAULT_PREP_PARAMS` from the committed corpus (`analyze-output.json`, per-issue `rows`, nulls filtered) by a stated deterministic procedure — not hand-picked numbers:

1. Over rows with non-null spec features: `w[k] = r_k / p50_k` — corpus correlation (spec_lines 0.557, done_items 0.346, scenario_count 0.338) divided by the corpus median of that feature (median-normalised so no unit dominates).
2. `cut.mechanical` / `cut.standard` = p33 / p66 of the composite score over the corpus (tertile cuts, exactly the spike's method).
3. Priors preserve `tier.mjs`'s proportions of the cut span (`span = cut.standard − cut.mechanical`; tier.mjs: 8/14, span 6): `confidence_adj = { high: 0, medium: 0.5·span, low: 1.33·span, default: 0.5·span }`; `w.gate_history = 0.83·span` per prior gate failure. These remain **un-tuned judgement priors** (RESULTS.md's explicit caveat) — FAFF-413 owns tuning them; mark them as such in code comments.

Bake the resulting constants as literals with a provenance comment (procedure + source file + n); commit a `node --test` that re-derives them from `analyze-output.json` (a repo file — hermetic) and asserts each bucket holds 20–47% of the n≈148 corpus, so a silent recalibration drift fails CI.

**Anti-pattern:** reading "calibrated seed" as "all params are data-backed". Why: only the three feature weights and the cut points are corpus-derived; the confidence/gate-history priors are guesses FAFF-413 must treat as un-tuned.

### Prep stamping

At every attach site in faff-prep (autonomous Path-2 Step 3, the interactive attach, Path-3 refresh reattach): after the provenance stamp, run `faff tier <spec-file> [--gate-history N]` (N = the issue's prior park/needs-human count when the prep context has it; omit otherwise) and write/refresh the retained `build-tier:` line adjacent to `confidence:`. A refresh recomputes — never carries a stale tier forward. Tier stamping happens **after** the confidence gate has routed (a `low` spec parks before stamping matters); the tier changes no gate outcome.

### Resolution chain (dispatch)

**Chosen:** layer over FAFF-334, never subsume it. `models.build_by_confidence` stays shipped and untouched; the tier matcher slots in ahead of it. Precedence, first hit wins:

```
PROCEDURE resolve build model (tier?, conf?):
  1. IF models.build_by_tier configured AND tier present:
       build_by_tier.<tier> -> build_by_tier.default -> fall through
     (tier ABSENT => skip the tier matcher entirely — never guess a tier)
  2. IF models.build_by_confidence configured AND conf present: FAFF-334 chain verbatim
  3. models.build (scalar) -> "inherit"

PROCEDURE resolve build effort (tier?):
  1. IF effort.build_by_tier configured AND tier present:
       build_by_tier.<tier> -> build_by_tier.default -> fall through
  2. effort.build (scalar, FAFF-416) -> "inherit"
```

Rationale for layering: ADR-0050 explicitly left the per-issue effort matcher for this ticket on the FAFF-334 pattern; ripping out a shipped, validated confidence matcher would break existing configs for no gain, and the tier (which already folds confidence in as a prior) is simply the better-informed key that outranks it when both are set.

**Chosen:** the effort matcher is keyed by **tier**, superseding ADR-0050's sketch key (`effort.build_by_confidence`). Rationale: ADR-0050 pinned the *pattern* ("on the same pattern as models.build_by_confidence"), not the key; FAFF-411 has since shown confidence is a near-constant. Minting a new confidence-keyed matcher today would build on a dead signal. Record this in the ADR this ticket produces; no `effort.build_by_confidence` key is ever created.

Both matchers validate **every configured leaf up-front** at first resolution (mirror `resolveBuildModel`): an invalid token anywhere ⇒ exit 2 naming the legal set — fail-loud, no silent inherit, no dormant typo. `faff config resolved` echoes every configured `*_by_tier` leaf (all tiers build, so no inert-leaf suppression — unlike FAFF-334's `low` leaf).

### Consumer wiring (prose changes)

- **beep-boop SKILL.md (step 6):** when any `*_by_tier` matcher is configured, annotate each partition entry with the spec's retained `build-tier` (read from the already-read spec — no new tracker read), beside the existing confidence annotation.
- **Both executor SKILL.mds:** at dispatch, resolve `faff models build-for --tier <tier> --confidence <conf>` and `faff effort build-for --tier <tier>` per issue; stamp the resolved values into the `BuildDispatch` and the run log (never silent). A **collision-chain is one subagent = one model/effort param**: resolve to the **most-demanding member — the highest tier** (`complex` > `standard` > `mechanical`), so no chained member is under-served. All matchers absent ⇒ the existing once-per-run scalar path, byte-for-byte.

### Edge cases

- Missing/unparseable `confidence` line ⇒ `confidence_adj.default` (never treated as `high`).
- Legacy spec with no `build-tier:` line while a `*_by_tier` matcher is configured ⇒ skip the tier matcher, fall through the chain, log the fall-through — never guess.
- Tiny/empty spec ⇒ low score ⇒ `mechanical` (correct: there is almost nothing to build).
- `faff tier` on a missing file / non-numeric `--gate-history` ⇒ exit 2 usage.
- Duplicate `build-tier:` lines after a refresh ⇒ the stamping step replaces the existing line, never appends a second.

### Failure modes

- **The priors mislead.** confidence/gate-history adjustments are un-tuned guesses. *How you'd know:* FAFF-413's tuning pass (or `faff economics --by effort`) shows tier↔outcome mismatch concentrated on prior-driven boundary crossings. *Meaning:* retune params; coarse buckets bound the damage — never widen to more buckets to compensate.
- **Spec-style drift breaks calibration.** A producer prose change (leaner/fatter specs) shifts the feature distribution, skewing tiers. *How you'd know:* run-ledger tier distribution drifts far from ~thirds. *Meaning:* recalibrate cuts against a fresh corpus window (the committed derivation test makes this a one-file change).
- **The routing benefit may not exist.** Per-issue cost attribution is blocked (run-averaged proxy), so "cheaper tier ⇒ net cheaper" is unproven. *How you'd know:* FAFF-415/418 telemetry once per-issue attribution lands; until then, gate-failure/rework rates by tier. *Meaning:* if cheap-tier rework erases the saving, flip the matchers off (config-only) — the signal remains useful as inspection metadata.

## 5. Scenarios

```
Given a spec file with known text and a retained confidence line
When `faff tier <file>` runs twice
Then both runs print the same tier token, and `--json` exposes {tier, score, features}
```

```
Given models.build_by_tier and effort.build_by_tier configured, and an issue whose attached spec retains `build-tier: mechanical`
When the executor dispatches that issue
Then the BuildDispatch carries the mechanical-mapped model token and effort level, both echoed in the run log
```

```
Given both models.build_by_tier and models.build_by_confidence configured, and an issue with both retained lines
When the build model resolves
Then the tier matcher wins; and given an issue with no build-tier line, the confidence matcher resolves instead (logged fall-through)
```

```
Given an invalid model token in any models.build_by_tier leaf (including a leaf whose tier never dispatches)
When the first per-issue resolution runs
Then it exits 2 naming the legal set — no silent inherit
```

Assertions (non-functional):

- With no `*_by_tier` keys configured, dispatch behaviour is byte-for-byte identical to today (scalar/confidence paths untouched).
- The baked default params bucket the committed n≈148 corpus into three buckets of 20–47% each (derivation test in CI).
- The tier changes no promotion/park/merge outcome anywhere.

## 6. Design decision rationale

- **Signal carrier: retained line vs label vs both?** Label family: tracker-visible but mints a value-carrying-label precedent, needs provisioning + re-spec churn, and no consumer reads labels at dispatch. Retained line: zero new reads, house precedent, spec-adjacent. **Chosen:** retained line only (labels stay an extension point).
- **Who computes: producer self-rating vs prep-side tool?** Self-rating is the exact failure FAFF-411 measured. **Chosen:** deterministic CLI at attach.
- **Bucketing: matrix vs dominant-axis vs weighted-linear?** **Chosen:** weighted-linear + tertile cuts on spec-native features (the spike's mechanism, honest about what's extractable at prep).
- **Calibration: hand-picked vs derived?** **Chosen:** stated derivation from `analyze-output.json`, baked with provenance + CI re-derivation test.
- **FAFF-334: subsume vs layer?** Subsuming breaks shipped configs and deletes a working fallback. **Chosen:** layer, tier outranks confidence.
- **Effort matcher key: confidence (ADR-0050 sketch) vs tier?** **Chosen:** tier — the sketch predates the spike's evidence; pattern preserved, key upgraded, recorded in this ticket's ADR. (At the time of writing, no `effort.build_by_confidence` key exists anywhere — nothing to migrate.)
- **Collision-chain resolution?** One subagent, one param. **Chosen:** highest tier in the chain (most-demanding member), mirroring FAFF-334's lowest-confidence rule.

## 7. Open questions and assumptions

**Open questions:** none — all three ticket questions are closed above (carrier: retained line; boundaries: weighted-linear + tertile cuts; FAFF-334: layered, not subsumed).

**Assumptions:**

- **Assumes:** the FAFF-411 spike deliverables are committed and stable at `docs/spikes/2026-07-10-faff-411/` (`tier.mjs`, `RESULTS.md`, `analyze.mjs`, `analyze-output.json` with per-issue `rows` carrying `spec_lines`/`done_items`/`scenario_count`). *Validate:* files exist; `node -e` over `analyze-output.json` shows 151 rows with those fields.
- **Assumes:** FAFF-416's effort plumbing is shipped — `effort.build` key, `EFFORT_LANE_VOCAB` validation, `BuildDispatch.effort` + reasoning-effort arg in both executors. *Validate:* `grep effort.build plugin/skills/faff/bin/lib/config.js` and `grep effort plugin/skills/faffter-*concurrency*/SKILL.md`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A freshly-prepped issue's attached spec carries a retained `build-tier: mechanical|standard|complex` line computed by the CLI, not by producer self-rating.
- [ ] With no `*_by_tier` config, `faff models build-for high` and the executors' dispatch behave byte-for-byte as before this change (existing selftests still pass unmodified).

### From WHAT (types and interfaces)
- [ ] New `bin/lib/tier.js` factory region exports pure `tier()`, `tierScore()`, `extractSpecFeatures()`; a repeated-call test proves same input ⇒ same output.
- [ ] Extraction regexes are byte-identical to `analyze.mjs` :224–226 (asserted by test against shared fixture strings).
- [ ] `models.build_by_tier.*` and `effort.build_by_tier.*` leaves validate up-front against their vocabs; an invalid token in any leaf exits 2 naming the legal set at first resolution.
- [ ] `faff config resolved` echoes every configured `*_by_tier` leaf.
- [ ] `faff tier`, extended `faff models build-for` (positional form unchanged), and new `faff effort build-for` each carry the 6 house touchpoints, including a `docs/cli.md` row (same PR — docs never go stale).

### From HOW (behaviour)
- [ ] `faff tier <spec-file>` prints the bare token; `--json` prints `{tier, score, features}`; exit 2 on missing file / bad flags.
- [ ] Baked `DEFAULT_PREP_PARAMS` carry a provenance comment (derivation procedure + source + n); a committed `node --test` re-derives them from `analyze-output.json` and asserts the 20–47%-per-bucket corpus split; priors are comment-flagged un-tuned.
- [ ] Precedence tests: tier matcher outranks confidence matcher; absent tier skips the tier matcher (logged fall-through); absent matchers hit scalar/inherit.
- [ ] faff-prep SKILL.md: all attach/reattach/refresh sites stamp (replace, never duplicate) the `build-tier:` line via `faff tier`; refresh recomputes.
- [ ] beep-boop SKILL.md step 6: partition entries annotated with the retained tier when a `*_by_tier` matcher is configured — no new tracker read.
- [ ] Both executor SKILL.mds: per-issue `faff models build-for --tier … --confidence …` + `faff effort build-for --tier …` at dispatch; collision-chain resolves to the highest tier; resolved values recorded on `BuildDispatch`/run log.
- [ ] ADR recorded: tier signal + layering over FAFF-334 + tier-keyed effort matcher superseding ADR-0050's sketch key + prep boundary preserved.

### From HOW (edge cases)
- [ ] Missing confidence line ⇒ default prior (test proves never `high`).
- [ ] Legacy spec without `build-tier:` + matcher configured ⇒ fall-through, logged, never guessed.

No LLM-judgement seam is introduced or changed (the classifier is deterministic; prep's judgement surface is untouched), so no eval-coverage DONE item applies.

**Integration smoke test:**

```
1. Write a fixture spec file with known features + `confidence: high`
2. faff tier fixture.md            => prints e.g. "mechanical"; append `build-tier: mechanical`
3. Set models.build_by_tier.mechanical + effort.build_by_tier.mechanical in a temp rc
4. faff models build-for --tier mechanical --confidence high  => the by_tier token
5. faff effort build-for --tier mechanical                    => the by_tier level
6. Unset both matchers; rerun 4–5                             => scalar/inherit values, unchanged from today
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **(P4 right-sizing, diagnosis: the ticket bundles signal emission and consumption, action: keep together, split line named)** — emission (`faff tier` + retained line) without a consumer is an inert label; consumption reuses the shipped FAFF-334 resolver pattern, so the bundle is one coherent increment. If the build stalls, the natural split is emission first (tier.js + CLI + prep stamping), matchers second — the spec's sections already partition that way.
- **(P6 surfaced deps, diagnosis: downstream tuning dependency lives in prose only, action: draw the edge)** — FAFF-411 (blockedBy) is Done, satisfied. FAFF-413 depends on this ticket's `tier()` action surface but only prose says so; draw the FAFF-417 → FAFF-413 relation in the tracker so `faff next`/map agree with prep (the deps-in-prose-not-edges hazard).
- **(P7 risk-aware, diagnosis: risk already spiked down, action: none)** — FAFF-411 was the de-risking spike; residual risk (un-tuned priors, r≈0.56 ceiling) is bounded by the three-bucket cap, the `--json` inspectable score, and config-off reversibility. No further spike warranted.
- **(P2 value×risk, diagnosis: value realises only when a matcher is configured, action: make adoption visible)** — the run-banner echo + cli.md rows make the knob discoverable; sequencing after the curated cohorts (per the ticket) is the right value order — routing before evidence would have guessed weights FAFF-411 has now measured.
- **(P1+P5 workstream fit, diagnosis: none)** — sits squarely in the routing/economics stream (FAFF-334 → 415/416 → 417 → 413); no rehoming needed.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

spec-review: approve
