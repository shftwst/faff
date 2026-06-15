# faff-prep judgement-eval coverage — confidence, decision-markers, live-thread reconciliation

> Spec: faffter-dark-nlspec · 2026-06-15 · interactive · confidence: high. Full spec on Linear FAFF-146.

This is the buildable spec for FAFF-146 (parent epic FAFF-145), addressed to the build agent that will extend the `eval/` judgement-eval harness, and to the human reviewers who gate it. faff-prep is the pipeline's spec gate: its reconciliation and confidence judgement decide what is safe to build unattended, yet none of that judgement is tested today. This spec adds judgement-eval cases plus human oracles for prep's three judgement surfaces, each routed to the lane that can measure it faithfully.

## 1. WHY — Problem and Principles

**Problem statement.** faff-tidy's six judgement kinds (dupe, vague, stale, superseded, ordering, gloss) are covered by the `eval/` harness and measured stable on the frontier (ADR 0004), but faff-prep's three judgement surfaces — confidence rating, decision-marker classification, and live-thread reconciliation — have zero eval coverage. Because prep is the gate that decides promote/retain/park and whether a spec is out-of-date, an undetected drift in its judgement silently corrupts every downstream unattended build. This change adds cases and oracles for all three surfaces so a regression in prep's judgement is caught by the same deterministic-grade net that already guards tidy.

**Design principles.**

**Eval only the genuine judgement, never the deterministic seam.** faff already validates the mechanical layer in `faff contract spec-readiness` (`plugin/skills/faff/bin/faff`, `computeSpecReadiness`): the marker-enum-to-class map (`MARKER_CLASS = { chosen: "closed", punt: "open", assumes: "external" }`), confidence-token membership in `{high, medium, low}` (fail-loud, no coerce), `markers_valid` + violation count, and the `> Spec:` provenance regex. This spec must not re-test any of that. The genuine judgement — the only thing worth an eval — is the act of *assigning* a marker to a section, *assigning* a confidence level to a spec, and *classifying* a post-spec comment as Challenge / Resolution / Context / Noise. An eval case that would still pass if the model's judgement were random but the deterministic validator ran is mis-aimed and must be rejected.

**Match each surface to a faithful lane; do not force one lane onto all three.** The harness has two lanes with different faithfulness, verified in `eval/cli-driver.mjs` and `eval/live-driver.mjs`. The black-box lane (`makeCliDriver`) loads skill prose verbatim and asks the model to "run the judgement pass internally" — it measures *model + extracted-rubric + fixture*, and does NOT invoke the orchestrated skill (see the header comment and `renderFixturePrompt`, cli-driver.mjs:121-140). That is sufficient for an *isolatable* classification surface, where the judgement is a pure function of (rubric, input). It is NOT sufficient for an *execution-entangled* surface, where the judgement depends on skill seams — reading the spec comment, ordering the thread relative to it. The live-driver (`liveDriver` in live-driver.mjs) exercises the real seams via `runSkill` (FAFF-135). Routing a surface to the wrong lane produces a number that looks like coverage but measures the wrong thing.

**The frontier baseline is the standing gate; local is a property-kind convenience only.** ADR 0004 measured local (`qwen3.6:27b-mlx`) matching frontier on the four single-issue-property kinds but failing and flaky on the two relational kinds (dupe 0.40 accuracy / 0.50 stability; superseded 0.50 / 0.70). The standing regression gate for every surface here is the frontier driver. Local-direct is offered only as an optional breadth sweep for the isolatable classification surfaces, and must not be used to gate any relational or reconciliation judgement.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | Node ESM | Deterministic grader; `KINDS`, `CLOSED_SET_KINDS`, `grade()`, `aggregateCase()` — extended with the new kinds |
| `eval/cli-driver.mjs` | Node ESM | Black-box driver + verbatim prose loaders (`loadTidyJudgementProse` pattern) — the lane for the two classification surfaces |
| `eval/live-driver.mjs` | Node ESM | Live driver (`runSkill`, FAFF-135), currently hardcoded to faff-tidy — must be parameterised for prep reconciliation |
| `eval/envelope.mjs` | Node ESM | `parseJudgementEnvelope()` — strict tag + classify fallback, compliant/noncompliant format flag |
| `eval/run-evals.mjs` | Node ESM | Orchestrator; `loadCases()`, `runEvals()`, K=20 base + escalation to 50 |
| `eval/cases/*.json` | JSON | Existing tidy-shaped fixtures (`{id, kind, fixture:{issues}, question, oracle}`) |
| `plugin/skills/faffter-dark-nlspec/SKILL.md` (lines 194-205) | Markdown | Confidence rubric (high/medium/low) — the verbatim source for the confidence-classification rubric |
| `plugin/skills/faff/SKILL.md` (Spec readiness) | Markdown | Decision-marker dialect (`**Chosen:**`/`**Punt:**`/`**Assumes:**`) — the verbatim source for the marker-classification rubric |
| `plugin/skills/faff-prep/SKILL.md` (Step 2a, lines 176-182) | Markdown | Live-thread reconciliation rubric (Challenge/Resolution/Context/Noise) — the verbatim source for the reconciliation lane |

**Scope statement.** This sits inside `eval/` as new judgement kinds and (for reconciliation) a parameterised live-driver lane; it does not touch prep's runtime prose or the `faff contract` CLI.

## 2. OUT OF SCOPE

- **Re-testing the deterministic spec-readiness contract** — what's excluded: marker→class mapping, confidence-token validity, `markers_valid`/violations, provenance regex. Why excluded: already covered by `computeSpecReadiness` and its self-test in `plugin/skills/faff/bin/faff`; re-asserting it here is double-coverage. Extension point: if that contract grows a new field, extend `test/` unit tests against `bin/faff`, not `eval/`.
- **Pick-ordering and synthesis-gloss judgement** — what's excluded: the existing `ordering` and `gloss` kinds. Why excluded: ADR 0004 already measures them on the frontier (ordering 1.00, gloss 0.97). Extension point: `eval/cases/ordering-*.json` / `gloss-*.json` if those need widening.
- **faff-tidy's classification kinds (dupe/vague/stale/superseded)** — what's excluded: the four tidy closed-set kinds. Why excluded: shipped and measured. Extension point: ADR 0004's "widen relational fixtures" follow-up, not this issue.
- **Live, full-run measurement and a new ADR** — what's excluded: actually running ~K=20 frontier reps and recording the numbers in an ADR addendum. Why excluded: that is the human-supervised run job (the FAFF-131 pattern), separate from authoring the cases + oracles + grader wiring. This spec records *one frontier baseline per surface* as the deliverable; the standing measurement run is a follow-up. Extension point: `docs/adr/0004-*.md` addendum or a new ADR, run via `node eval/run-evals.mjs`.
- **Prep's interactive build-gate prose and routing-verdict mapping** — what's excluded: the `confidence: medium → needs-decision-first` routing and the iterate/build/park gate. Why excluded: those are deterministic mappings (`bin/faff` `nextStep`/routing) and prose, not judgement. Extension point: `faffidavit-routing` tests.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Surface | One of prep's three judgement points: confidence rating, decision-marker classification, live-thread reconciliation |
| Isolatable surface | A judgement that is a pure function of (rubric, input) and needs no skill seams — gradable on the black-box lane |
| Execution-entangled surface | A judgement that depends on skill seams (reading the spec comment, ordering the thread against it) — needs the live-driver lane |
| Classification half | The two isolatable surfaces (confidence + marker classification), shipped on the black-box lane |
| Reconciliation half | The live-thread reconciliation surface, shipped (or deferred) on the live-driver lane |
| Per-section judgement | A confidence or marker call attached to one identified spec section, scored per-section |
| Per-comment judgement | A Challenge/Resolution/Context/Noise label attached to one identified thread comment, scored per-comment |

**The existing case schema (verbatim, `eval/cases/*.json`).** A case today is `{ id, kind, fixture: { version, issues: [...] }, question, oracle: { closed_set | ordering | gloss_rubric } }`. The fixture is a backlog of tracker issues. `validateCase` (grader.mjs:17-27) requires the oracle to populate exactly one field, selected by kind: `ordering`→`ordering`, `gloss`→`gloss_rubric`, everything else→`closed_set`.

**Type definitions — the new kinds and their oracles.**

```
ENUM Kind  # extends grader.mjs KINDS
  ... existing: dupe | vague | stale | superseded | ordering | gloss
  confidence       # NEW — isolatable, black-box lane
  marker           # NEW — isolatable, black-box lane
  reconciliation   # NEW — execution-entangled, live-driver lane

# --- Confidence surface ---
# The fixture is a SPEC BODY, not a backlog. One spec → one confidence level.
RECORD ConfidenceCase:
  id: String
  kind: "confidence"
  fixture: SpecFixture          # see SpecFixture below
  question: String              # e.g. "Rate this spec's confidence: high, medium, or low?"
  oracle: { closed_set: [ Level ] }   # exactly one of {"high","medium","low"}

ENUM Level: high | medium | low

# --- Decision-marker surface ---
# The fixture is a SPEC BODY whose decision sections are identified by stable section keys.
RECORD MarkerCase:
  id: String
  kind: "marker"
  fixture: SpecFixture          # carries `sections: [ {key, text} ]` — the decision sections to classify
  question: String              # e.g. "Classify each decision section as chosen, punt, or assumes."
  oracle: { closed_set: [ "<section-key>:<class>", ... ] }   # one entry per section; class ∈ {chosen,punt,assumes}

# --- Reconciliation surface (live-driver) ---
# The fixture is an ISSUE + SPEC + a comment THREAD posted after the spec comment.
RECORD ReconciliationCase:
  id: String
  kind: "reconciliation"
  fixture: ThreadFixture        # see ThreadFixture below
  question: String              # e.g. "Classify each comment posted after the spec: Challenge/Resolution/Context/Noise."
  oracle: { closed_set: [ "<comment-id>:<label>", ... ] }   # one per comment; label ∈ {challenge,resolution,context,noise}
```

```
# Prep surfaces need spec text + threads — the tidy `issues[]` fixture cannot carry them.
RECORD SpecFixture:
  version: 1
  spec_body: String             # the spec markdown the judgement reads (confidence) ...
  sections: [ DecisionSection ] # ... or the identified decision sections (marker). Present per kind.

RECORD DecisionSection:
  key: String                   # stable id used in the marker oracle (e.g. "auth-strategy")
  text: String                  # the section's prose, including any options/tradeoff

RECORD ThreadFixture:
  version: 1
  issue: { id, title, description }
  spec_comment: { id, posted_at, body }     # the anchor — everything AFTER it is in scope
  thread: [ Comment ]                       # comments in chronological order
RECORD Comment:
  id: String
  posted_at: Timestamp          # used only to confirm "after the spec comment"; ordering is positional in the fixture
  author: String
  body: String
```

**Design decision — fixture envelope for prep's non-backlog surfaces.** The existing fixture is `{version, issues:[...]}`. Confidence and marker surfaces need a spec body / decision sections; reconciliation needs an issue + spec + thread. Two options: (a) overload `issues[]` by encoding spec text into a synthetic issue, or (b) let `fixture` carry kind-appropriate shapes (`spec_body` / `sections` / thread fields) and relax the schema so the harness reads the shape the kind expects. Option (a) is a coercion that would corrupt the meaning of `issues` and confuse the verbatim drivers. **Chosen:** kind-tagged fixture shapes — `fixture` stays an opaque object and each driver reads the fields its kind needs (`spec_body`, `sections`, or `issue`+`spec_comment`+`thread`); `validateCase` gains a per-kind fixture-shape check alongside the existing oracle check. Rationale and rejected alternative in Design Decision Rationale.

**Design decision — confidence oracle: closed-set, exact match.** The confidence judgement picks one of three ordered levels. Grade as a single-element `closed_set` over `{high, medium, low}` with set-equality (the existing `CLOSED_SET_KINDS` path), scoring the *judgement of which level*, not the token's validity (that's the deterministic contract's job). Distance-tolerant grading (medium-vs-high as "half right") was considered and rejected: the gate behaviour forks hard at each boundary (high→promote, medium→retain, low→park), so a near-miss is a real miss. **Chosen:** exact single-element closed-set over `{high, medium, low}`, graded by `setEqual`.

**Design decision — marker oracle: per-section closed-set of `key:class` pairs.** A spec has several decision sections, each independently classifiable. One-classification-per-case throws away the per-section signal and makes a case pass when the model gets the easy section right and the hard one wrong. **Chosen:** per-section closed-set whose members are `"<section-key>:<class>"` strings (e.g. `["auth-strategy:chosen", "rate-limit:punt"]`), graded by set-equality — a model output that mislabels one section fails the set. The class vocabulary is `{chosen, punt, assumes}`, matching the dialect in `faff/SKILL.md`. A multi-option section the spec left with no marker is encoded `"<key>:none"`, exercising the "missing marker = invalid" judgement.

**Design decision — reconciliation oracle: per-comment closed-set of `id:label` pairs.** Each post-spec comment gets exactly one of Challenge/Resolution/Context/Noise. **Chosen:** per-comment closed-set whose members are `"<comment-id>:<label>"` strings, label ∈ `{challenge, resolution, context, noise}`, graded by set-equality. This mirrors the marker encoding (per-unit `id:class` pairs into a closed set) so the grader reuses the `CLOSED_SET_KINDS` path for all three new kinds. Authoring responsibility for these labels is an Open Question (below).

## 4. HOW — Behavior

**Architecture and approach.** Two of the three surfaces (confidence, marker) ride the existing black-box lane; reconciliation rides the live-driver lane. All three grade through the closed-set path, so the grader change is small; the lane work is where they diverge.

**Classification half — black-box lane (confidence + marker).** The proven faff-tidy pattern is: a verbatim prose loader anchored on stable headers (`loadTidyJudgementProse`, cli-driver.mjs:69-87), folded into the prompt, with the model emitting a `faff-eval:judgement` envelope that the closed-set grader scores. We extend that pattern, not replace it.

```
PROCEDURE grade_classification_half:
  CONFIDENCE:
    1. Add loadConfidenceRubricProse(pluginDir):
       - reads plugin/skills/faffter-dark-nlspec/SKILL.md
       - extracts the "## Confidence self-rating" section verbatim (anchor START = "## Confidence self-rating",
         END = the next "## " header), fail-loud if either anchor moves (the loadTidyJudgementProse contract)
    2. The eval prompt = rubric prose + the SpecFixture.spec_body + the envelope instruction.
       The envelope carries { "case_id", "confidence": "<high|medium|low>" }.
    3. grade(): closed_set kind, predicted = [env.confidence], oracle.closed_set = ["<level>"], setEqual.

  MARKER:
    1. Add loadMarkerDialectProse(pluginDir):
       - reads plugin/skills/faff/SKILL.md
       - extracts the decision-marker bullet from the "Spec readiness (fixed)" section verbatim
         (anchor on the stable "**Decision markers**" lead), fail-loud if it moves
    2. The eval prompt = dialect prose + the fixture's `sections[]` (key + text) + the envelope instruction.
       The envelope carries { "case_id", "markers": { "<section-key>": "chosen|punt|assumes|none", ... } }.
    3. grade(): map env.markers to ["<key>:<class>", ...]; oracle.closed_set is the same shape; setEqual.
```

**Reconciliation half — live-driver lane.** The live-driver (`liveDriver`, live-driver.mjs:74-92) is hardcoded to faff-tidy: `buildJudgementPrompt` always asks "Run faff-tidy's judgement pass…" (line 43) and records only `CLOSED_SET_KINDS` + `ordering` buckets. To cover reconciliation faithfully, it must be parameterised.

```
PROCEDURE drive_reconciliation(ctx, fixture):
  Behaviour summary: read the spec comment + the thread through the harness tracker seam,
  prompt the model with prep's REAL reconciliation rubric, and record per-comment labels
  as a DecisionRecord bucket the grader can score the same way as the classification half.

  1. Parameterise buildJudgementPrompt: take a `skill` + a `promptBuilder` so the hardcoded
     "Run faff-tidy's judgement pass…" string is one option among several. Add a prep builder:
       - loads prep's reconciliation rubric verbatim (loadReconciliationProse anchored on
         faff-prep/SKILL.md "Step 2a" Challenge/Resolution/Context/Noise bullets)
       - renders the issue + spec_comment + thread, instructing: "classify each comment posted
         AFTER the spec comment as Challenge/Resolution/Context/Noise"
       - reuses EVAL_MODE_INSTRUCTION, with a reconciliation-shaped envelope:
         { "case_id", "reconciliation": { "<comment-id>": "challenge|resolution|context|noise", ... } }
  2. drive(ctx): read the thread via ctx.tracker (records a trackerRead seam), build the prep prompt,
     call model(prompt), parse the envelope, and ctx.record.recordBucket("reconciliation", labelPairs)
     where labelPairs = ["<comment-id>:<label>", ...].
  3. The test calls runSkill({ skill: "faff-prep", tracker, repo, driver }) — the seam-faithful path.
```

**Coercion / fail-safe behaviour.** The deterministic confidence-token validator is out of scope, but the *judgement* surface must still exercise the fail-safe boundary: a confidence case where the spec is genuinely ambiguous, and a malformed-output case where the model emits a confidence token outside `{high, medium, low}`.

```
PROCEDURE handle_malformed_confidence(env):
  1. parseJudgementEnvelope already classifies output as compliant / noncompliant / errored (envelope.mjs).
  2. IF env.confidence is absent or not in {high,medium,low}:
     a. The closed-set grade is a clean FAIL (setEqual against the oracle level fails) — NOT a crash.
     b. The rep's signature is the (sorted) predicted set, so a malformed token shows as a distinct
        signature and correctly LOWERS stability (it is judgement disagreement, not a parse success).
  3. We do NOT coerce a bad token to a level (FAFF-76 Decision 3: spec-readiness has no safe coerce
     target). The eval observes the bad token as a fail; it does not paper over it.
```

**Anti-pattern:** encoding a confidence case so the model only has to echo the spec's own `confidence:` line. Why: that tests reading, not judging — the fixture spec body must NOT contain a confidence line; the model must derive the level from the rubric against the spec content.

**Anti-pattern:** grading reconciliation on the black-box lane by pasting the thread into a self-contained prompt. Why: reconciliation is execution-entangled (it depends on the spec-comment anchor and the seam that fetches comments-after-it); the black-box lane measures model+rubric+fixture and would report a faithfulness it doesn't have. Route it through `runSkill`.

**Anti-pattern:** adding a new envelope field per kind without teaching `parseJudgementEnvelope`/grader about it. Why: the envelope's strict-or-classify fallback (envelope.mjs) keys on a valid `case_id` object; a new top-level field (`confidence`, `markers`, `reconciliation`) parses fine as JSON but the grader must read it — wire both ends together or the rep errors.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a confidence case whose spec body has significant unresolved unknowns and a Punt with no human answer
When the frontier driver runs the confidence judgement against the verbatim rubric
Then the emitted envelope's confidence is "low" and the closed-set grade is PASS against oracle ["low"]
```

```
Given a marker case with three decision sections (one closed pick, one open either/or, one external dependency)
When the model classifies each identified section
Then the envelope's markers map to ["<key1>:chosen", "<key2>:punt", "<key3>:assumes"] and set-equality PASSES
```

```
Given a marker case with a multi-option section that concludes with no canonical marker
When the model classifies that section
Then it is labelled "none" and the oracle records "<key>:none" — exercising the missing-marker judgement
```

```
Given a reconciliation thread fixture with one comment that contradicts a spec decision, one that answers a Punt, one relevant-but-non-blocking note, and one "+1"
When the live-driver runs faff-prep's reconciliation pass through runSkill (tracker + repo seams real)
Then the recorded "reconciliation" bucket maps to [challenge, resolution, context, noise] per comment and set-equality PASSES
```

```
Given a confidence case where the model emits a token outside {high, medium, low}
When the rep is graded
Then it scores a clean FAIL (no coercion), carries a distinct signature, and lowers stability — not a crash
```

Non-functional assertions:

- Each new kind has ≥2 cases (the existing 2/kind convention; relational/thread cases are thin at 1 and ADR 0004 already flagged it).
- A frontier baseline is recorded per surface (the standing gate); local-direct is run, if at all, only on confidence + marker.
- The deterministic spec-readiness contract is not re-asserted by any new case.

## 6. DESIGN DECISION RATIONALE

**Should reconciliation split into its own follow-up child, shipping confidence + marker classification now?** This is the headline open question, and it is a defensible engineering call, not a product call.

- *Option A — single slice, all three surfaces here.* Pro: one ticket, complete prep coverage. Con: reconciliation is net-new live-driver wiring (parameterise the hardcoded skill, build a prep-shaped prompt + reconciliation envelope, teach the grader the new bucket, author the harder thread oracle) — heavier and on a different lane (live-driver via `runSkill`) than the two black-box surfaces. ADR 0004 explicitly keeps the live-driver "in reserve… not the standing mechanism," so leaning on it is a deliberate step, not a default.
- *Option B — split: ship confidence + marker on the proven black-box lane now; reconciliation as a follow-up child.* Pro: the two isolatable surfaces extend a proven, low-risk pattern (`loadTidyJudgementProse` + closed-set grade) and land fast; reconciliation's live-driver work is isolated where it can be specced and oracle-authored deliberately. Con: prep coverage is complete only after the follow-up.

**Chosen:** Split into two slices — ship confidence + marker classification on the black-box lane in this issue, and carve reconciliation into a follow-up child under FAFF-145. Rationale: the lanes genuinely differ (black-box vs `runSkill` live-driver), the appetite for *this* slice is satisfied by the two isolatable surfaces that reuse a measured pattern, and the reconciliation oracle-authoring question (below) is unresolved — bundling it would block the safe, fast 80% on the uncertain 20%. The follow-up child inherits this spec's reconciliation design (the live-driver parameterisation and the per-comment `id:label` oracle), so no design is lost. This spec specifies all three so the design is coherent; the *build* deliverable for FAFF-146 is the classification half plus the reconciliation design + the carved follow-up.

**Fixture envelope (chosen above):** kind-tagged fixture shapes over overloading `issues[]`. Options: overload `issues[]` with synthetic spec-text issues (rejected — corrupts the meaning of `issues`, breaks the verbatim drivers that JSON-stringify the backlog) vs. let `fixture` carry per-kind shapes with a per-kind validation branch (chosen — clean, and the drivers already read kind-specific fields). **Chosen:** per-kind fixture shapes.

**Confidence grading (chosen above):** exact single-element closed-set over `{high, medium, low}`; distance-tolerant rejected because the gate forks hard at each boundary.

**Marker grading (chosen above):** per-section `key:class` closed-set; one-per-case rejected for discarding the per-section signal.

**Reconciliation grading (chosen above):** per-comment `id:label` closed-set, mirroring marker encoding to reuse the `CLOSED_SET_KINDS` path.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

**Punt: who authors the reconciliation human oracle — and is it produced in this slice or the follow-up child?** The Challenge/Resolution/Context/Noise label set per thread is a human judgement (the oracle is the ground truth the eval grades against). Options: (a) the spec author hand-labels each fixture comment now, inline with this spec; (b) a human reviewer authors the labels when the follow-up child is built; (c) two independent labellers reconcile disagreements (highest-fidelity, heaviest). Because the Chosen slice-split defers reconciliation to a follow-up child, the labels are not needed for *this* issue's build — but the authoring policy (who, single vs. double-labelled) must be settled before the child ships, and a one-or-two-labeller call has cost/fidelity tradeoffs a human should own. **Punt: a human picks the reconciliation oracle-authoring policy (single-author vs. double-labelled-reconciled) when the reconciliation follow-up child is scheduled.**

**Assumptions.**

**Assumes: the live-driver can be parameterised to drive faff-prep via `runSkill` without a harness redesign.** Validation: before building the reconciliation follow-up, confirm `runSkill` (test/helpers/skill-harness.mjs) accepts `skill: "faff-prep"` and that `ctx.record.recordBucket` accepts an arbitrary bucket name (verified: skill-harness.mjs:110 `recordBucket(name, issues)` is name-agnostic; live-driver.mjs:88 already records named buckets). If `runSkill` is faff-tidy-coupled beyond the prompt string, the follow-up's scope grows.

**Assumes: the three rubric sources expose stable section anchors for verbatim extraction.** Validation: confirm the loaders' START/END anchors exist before relying on them — `## Confidence self-rating` in `faffter-dark-nlspec/SKILL.md` (verified present, lines 194-205), the `**Decision markers**` bullet in `faff/SKILL.md` "Spec readiness (fixed)" (verified present), and the Step 2a Challenge/Resolution/Context/Noise bullets in `faff-prep/SKILL.md` (verified present, lines 176-182). Each loader must fail-loud if its anchor moves, per the `loadTidyJudgementProse` contract.

## 8. DONE — Definition of Done

### From WHY (principles)
- [ ] No new case re-tests the deterministic spec-readiness contract (marker→class map, token validity, `markers_valid`, provenance regex)
- [ ] Each surface is routed to its faithful lane: confidence + marker on black-box, reconciliation on the live-driver
- [ ] The frontier driver is the recorded standing gate for every surface; local-direct, if run, is used only on confidence + marker

### From WHAT (types and oracles)
- [ ] `KINDS` in `eval/grader.mjs` includes `confidence`, `marker`, `reconciliation`; all three are in `CLOSED_SET_KINDS`
- [ ] `validateCase` accepts the per-kind fixture shapes (`spec_body` / `sections` / `issue`+`spec_comment`+`thread`) and still enforces exactly-one oracle field
- [ ] Confidence oracle is a single-element `closed_set` over `{high, medium, low}`, graded by `setEqual`
- [ ] Marker oracle is a closed-set of `"<section-key>:<class>"` pairs (class ∈ chosen/punt/assumes/none), graded by `setEqual`
- [ ] Reconciliation oracle (design) is a closed-set of `"<comment-id>:<label>"` pairs (label ∈ challenge/resolution/context/noise), graded by `setEqual`

### From HOW (classification half — black-box)
- [ ] `loadConfidenceRubricProse` extracts the confidence section verbatim from `faffter-dark-nlspec/SKILL.md`, fail-loud on missing anchors
- [ ] `loadMarkerDialectProse` extracts the decision-marker dialect verbatim from `faff/SKILL.md`, fail-loud on missing anchors
- [ ] The confidence envelope carries `{ case_id, confidence }`; the marker envelope carries `{ case_id, markers: {key: class} }`; `grade()` reads both into the closed-set path
- [ ] ≥2 cases each for `confidence` and `marker` exist under `eval/cases/`
- [ ] `node eval/run-evals.mjs --only <confidence-case> --reps 2` and `--only <marker-case> --reps 2` smoke clean on the frontier driver

### From HOW (reconciliation half — live-driver, design + carved follow-up)
- [ ] `buildJudgementPrompt` is parameterised so the faff-tidy prompt string is one builder among several; a prep reconciliation builder is specified
- [ ] The reconciliation design records each comment label via `ctx.record.recordBucket("reconciliation", labelPairs)` through `runSkill({ skill: "faff-prep", ... })`
- [ ] A follow-up child under FAFF-145 captures the reconciliation build (live-driver wiring + oracle authoring), inheriting this spec's design

### From HOW (coercion / fail-safe)
- [ ] A confidence case with a malformed/out-of-enum token scores a clean FAIL (no coercion), carries a distinct signature, and lowers stability — verified it does not crash the grader

### From SCENARIOS
- [ ] Each Given-When-Then scenario has a corresponding case + oracle in `eval/cases/`

**Integration smoke test.**

```
PROCEDURE smoke_classification_half:
  1. Author eval/cases/confidence-001.json (oracle ["medium"]) and marker-001.json
     (oracle ["<key>:chosen", ...]) with the per-kind fixture shapes.
  2. Add the two kinds to KINDS + CLOSED_SET_KINDS; add the two prose loaders; wire grade().
  3. Run: node eval/run-evals.mjs --only confidence-001 --reps 2
     EXPECT: parses a faff-eval:judgement envelope, grades a closed-set score (no crash),
             writes eval/report/latest.json with per_kind.confidence present.
  # If this one path connects, the classification half's plumbing is wired.
```

confidence: high

---

## Methodology critique

Lens: `faffter-dark-methodology-agile-delivery` (`issue-critique`).

- **Right-sized? — resolved by the spec's split.** As originally scoped (all three surfaces in one ticket), FAFF-146 bundled two genuinely independent concerns on two different harness lanes (black-box classification vs. `runSkill` live-driver). The spec's **Chosen** slice-split fixes this: the two isolatable classification surfaces ship here on a proven pattern, and reconciliation is carved into a follow-up child. **What to do:** file the reconciliation follow-up child under FAFF-145 (it inherits this spec's reconciliation design) so the deferred surface isn't lost — this is the one outstanding action.
- **Workstream fit? — No issues.** Cleanly under the FAFF-145 epic and the "Skill-behaviour harness" project; outcome-named (prep judgement coverage) and cohesive with the FAFF-130/131 eval line.
- **Deps surfaced? — No hard blocker for this slice.** The classification half leans only on the shipped black-box pattern (FAFF-130, Done). The reconciliation follow-up will depend on the FAFF-135 live-driver (Done but faff-tidy-coupled); that dependency belongs on the carved child, not this slice — no missing blocker link here.
- **Risk profile? — well-placed.** The novel-integration risk (parameterising the live-driver for faff-prep) lives entirely in the deferred reconciliation half; this slice reuses a measured, stable pattern. The split is itself the de-risking move, so no separate spike is warranted.
