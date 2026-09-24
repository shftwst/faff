# Spec: prd-readiness grader — eval cases + case-backed wiring (FAFF-1095)

> Spec: faffter-dark-nlspec · 2026-09-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1095.

This is the buildable spec for **FAFF-1095**. Audience: the build agent that will flip the `prd-readiness` grader KIND from `designed` to `covered`, and the human reviewers who gate it. It assumes the reader knows the faff eval harness at the level the explore findings describe; it does not re-teach the harness.

## 1. WHY — Problem and Principles

**The load-bearing model.** A grader KIND is *case-backed* when at least one committed eval case exercises it and the harness can grade that case end-to-end. `prd-readiness` is registered as a closed-set KIND and backs the L4 run-start gate — the gate that pipes faffter-noon-prd's block to `faff contract prd-readiness` to admit or refuse a lights-out run. Yet it has zero cases. So a closed-set judgement that decides *whether an autonomous run may start* is itself ungraded. This ticket makes it graded.

**Problem statement.** The `prd-readiness` seam is wired into production but unmeasured: no case proves the grader scores its verdict correctly. This change adds cases plus the cli-driver wiring the harness needs to drive them, and flips the seam-registry status to `covered` so the coverage claim is true.

**Design principles.**

**Follow the FAFF-1007 precedent, minus the arm it needed.** FAFF-1007 (park-reconsider-classification, PR #932) is the direct sibling: same "flip designed→covered, add cases + wiring" shape. Copy its cli-driver single-verdict pattern and its oracle-triage deferral. The one deliberate divergence: FAFF-1007 needed its own `env.reconsider` grader arm; `prd-readiness` already rides the shared `env.verdict` arm, so **no grader-arm edit is made here**. Re-proposing a grader arm is a regression against this principle.

**The judge input is the PRD document and nothing else.** faffter-noon-prd is code-blind: its only input is the PRD document. The fixture carries exactly one field, and the rendered prompt shows the PRD body, never a tidy-style fallback.

**Verdict enum is settled and binary.** `prd-readiness` emits exactly `admissible` or `not-ready`. `admissible` is the PASS value (stop-conditions verifiable → admit the run); `not-ready` refuses/escalates. There is no third value and no `needs-human` for this KIND. The grader reads only `env.verdict`, never the `reason`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | JS (ESM) | `KINDS`/`CLOSED_SET_KINDS`/shared verdict arm (already have prd-readiness); `FIXTURE_SHAPE` gets one new entry |
| `eval/cli-driver.mjs` | JS (ESM) | needs a prd-readiness arm in `modeInstructionFor`, `renderFixturePrompt`, `criteriaFor` + a prose loader |
| `eval/seam-registry.json` | JSON | the `designed`→`covered` status flip |
| `plugin/skills/faffter-noon-prd/SKILL.md` | Markdown | the rubric prose `criteriaFor` extracts; the anchor source |
| `eval/cases/prep-architecture-trigger-001.json` | JSON | the single-verdict case shape to mirror |
| `test/eval-cli-driver.test.mjs`, `test/oracle-triage.test.mjs`, `test/seam-registry.test.mjs`, `test/eval-grader.test.mjs` | JS | the gating assertions that must go green |
| `eval/calibration/oracle-triage.json`, `eval/README.md` | JSON/MD | the deferral record and derived numbers |

**Scope statement.** This sits in the eval-coverage lane: it closes one seam-registry coverage gap without touching the production PRD gate or its contract.

## 2. OUT OF SCOPE

- **A new grader arm for prd-readiness** — Why excluded: it already rides the shared `env.verdict` closed-set arm in `eval/grader.mjs` (the `case "routing": case "spec-verdict": case "prd-readiness": case "prep-architecture-trigger":` block). Extension point: none needed; if the verdict source ever changes, that arm in `eval/grader.mjs` is where it would move.
- **Recording/accepting the frontier baseline value** — Why excluded: baseline capture is a human-supervised sweep, deferred to FAFF-614 (the operator-owned re-baseline runbook). Extension point: `eval/baselines/frontier.json` gains a `per_kind` row for `prd-readiness` under FAFF-614.
- **Any change to faffter-noon-prd or the `faff contract prd-readiness` validator** — Why excluded: the production gate and contract are correct; this ticket only measures the seam. Extension point: `plugin/skills/faffter-noon-prd/SKILL.md` and `contract-defs.js` for future rubric/verdict changes.
- **Grading the `reason` field** — Why excluded: the grader reads only `env.verdict`. Extension point: a future KIND or a widened arm in `eval/grader.mjs` if `reason` ever becomes gate-decisive.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| case-backed (`covered`) | A KIND with ≥1 case in `eval/cases/` that the harness can drive and grade |
| `designed` | A KIND registered with zero cases; wired for the live lane only |
| single-verdict arm | A cli-driver pattern where the judge emits one closed-set verdict on `env.verdict` |
| anchor | A section-heading string in a SKILL that `extractSection` uses to slice rubric prose |

**Fixture shape (new `FIXTURE_SHAPE` entry).**

```
FIXTURE_SHAPE["prd-readiness"] = ["prd_body"]
# validateCase then asserts fixture.prd_body is present
```

**Eval case record.**

```
RECORD PrdReadinessCase:
  id: String                     # e.g. "prd-readiness-001"
  kind: "prd-readiness"          # literal
  fixture:
    version: 1
    prd_body: String             # the PRD markdown the judge reads (the ONLY input)
  question: String               # the case prompt
  oracle:
    closed_set: ["admissible"] | ["not-ready"]   # the human oracle; single-element
```

**cli-driver surfaces (new).**

```
CONST PRD_READINESS_INSTRUCTION: String
  # asks for ONLY a fenced faff-eval:judgement block:
  #   { "case_id": "<ID>", "verdict": "admissible|not-ready" }

FUNCTION loadPrdReadinessProse(pluginDir) -> String
  # extractSection(prdSkillMd, START, END, "loadPrdReadinessProse")
  # START = "\n## The rubric (the LLM applies this)\n"
  # END   = "## Output (the contract artifact)"
```

**Design decisions.**

**How many cases?** Options: 2 (bare minimum for the ≥2-per-kind convention) vs 4 (matches the FAFF-1007 precedent and exercises both `not-ready` reasons). 4 gives two `admissible` and two `not-ready`, and lets the two `not-ready` cases exercise `no-stop-conditions` and `ambiguous-stop-conditions` separately (the `reason` is not graded, but shaping the cases this way makes the closed-set boundary sharper). **Chosen:** 4 cases — 2 `admissible`, 2 `not-ready`.

**The fixture field name.** Options: `prd_body` (descriptive, matches the "PRD document" input) vs a generic `document`/`body`. **Chosen:** `prd_body` — `validateCase` keys off it, and it reads unambiguously against the code-blind single-input rule.

**The `criteriaFor` prose anchors.** The loader must slice exactly the rubric section. **Chosen:** START `"\n## The rubric (the LLM applies this)\n"`, END `"## Output (the contract artifact)"` — each verified to occur exactly once in `faffter-noon-prd/SKILL.md`. (See Assumptions for the build-time re-verification.)

## 4. HOW — Behavior

**Architecture and approach.** Six edit sites, all mechanical against the FAFF-1007 / prep-architecture-trigger precedent, plus four new case files. Nothing touches the grader's scoring math.

**Behavior summary — the grader path.** With the fixture entry and the cli-driver arm in place, the harness renders the PRD body + rubric prose to the judge, the judge emits `env.verdict`, and the shared closed-set arm turns it into `[String(env.verdict)]` for scoring against the oracle's `closed_set`. No new grade math.

```
PROCEDURE wire_prd_readiness:
  1. eval/grader.mjs — FIXTURE_SHAPE: add "prd-readiness": ["prd_body"]
     (do NOT touch KINDS, CLOSED_SET_KINDS, or the shared env.verdict arm)
  2. eval/cli-driver.mjs:
     a. add CONST PRD_READINESS_INSTRUCTION (single faff-eval:judgement block)
     b. modeInstructionFor: add `if (kind === "prd-readiness") return PRD_READINESS_INSTRUCTION;`
     c. renderFixturePrompt: add `if (c.kind === "prd-readiness")` branch rendering c.fixture.prd_body
     d. criteriaFor: add `if (kind === "prd-readiness") return loadPrdReadinessProse(pluginDir);`
     e. add loadPrdReadinessProse + its START/END anchor constants
  3. eval/seam-registry.json — prd-readiness.status: "designed" -> "covered"
  4. eval/cases/ — add prd-readiness-001..004.json
  5. update the gating tests + README (see Scenarios + DONE)
```

**Behavior summary — the counts.** Several tests pin integer assertions (anchor counts, case-backed-kind count, `cases.length`). These are deltas: each rises by the fixed amount below. The absolute post-values in this spec are the origin/main baseline from the findings; the builder branches off main and reads the *actual* pre-value at each site, then sets post = pre + delta.

| Site | Delta |
|---|---|
| `eval/cases/*.json` files | +4 |
| case-backed kinds | +1 (add prd-readiness) |
| start-anchor count assertion | +1 |
| end-anchor count assertion | +1 |
| `eval-grader.test.mjs` `cases.length` | +4 |
| README case count | +4 |
| README kind count | +1 |
| README base reps (cases × 20) | + (4 × 20) |
| README worst reps (cases × 50) | + (4 × 50) |

**Edge cases and error handling.**

- **Anchor drift** — if either anchor string no longer occurs exactly once in the PRD SKILL, `extractSection` fails loud (the `loadPrdReadinessProse` label surfaces in the error). Terminal at build time; the builder re-picks the anchor. This is the intended fail-loud behaviour, not a bug to swallow.
- **Missing `prd_body`** — `validateCase` throws when a prd-readiness fixture lacks `prd_body`. Terminal; caught by the case-loading tests.
- **Number-formatting** — README values ≥ 1000 render with a thousands separator via `toLocaleString`. The builder writes the comma form (e.g. `1,900`) to match.

**Anti-pattern:** adding a bespoke grader arm or a new `predictedSet` case for prd-readiness. Why: it already rides the shared `env.verdict` arm; a second arm is dead duplication and diverges from the FAFF-1007 lesson.

**Anti-pattern:** using `scope_kinds` in `oracle-triage.json` to account for prd-readiness. Why: this KIND stays ungated until the FAFF-614 human sweep; it belongs in the `remaining_kinds` deferral, exactly as FAFF-1007 placed park-reconsider-classification.

**Failure modes.**

- **The cases don't discriminate.** The failure: all four cases could be so easy the grader passes them regardless of whether the wiring is correct, so `covered` overstates real coverage. How you'd know: swapping an oracle (e.g. flip an `admissible` case's oracle to `not-ready`) does not change the graded result, or the frontier accuracy (when FAFF-614 measures it) sits suspiciously at 1.00. What it means: narrow — sharpen the `not-ready` cases toward genuinely ambiguous stop-conditions so the boundary is exercised, not just the extremes.
- **A count assertion is set from the wrong pre-value.** The failure: this branch's integers differ from origin/main, so a post-value copied verbatim from this spec could be off. How you'd know: the specific `assert.equal` fails with a one-off mismatch. What it means: proceed after re-reading the actual pre-value in the tree and applying the delta (this is why the deltas, not the absolutes, are load-bearing).

## 5. Scenarios — main objectives (born-verifiable)

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the prd-readiness fixture entry and cli-driver arm are in place
When the harness drives an admissible prd-readiness case
Then the judge emits { verdict: "admissible" } and the grader scores it PASS against oracle.closed_set == ["admissible"]
```

```
Given a not-ready prd-readiness case whose PRD has no verifiable stop-conditions
When the harness drives it
Then the graded verdict is "not-ready" and matches oracle.closed_set == ["not-ready"]
```

- The full test suite (`eval-cli-driver`, `oracle-triage`, `seam-registry`, `eval-grader`) passes with the updated counts.
- `criteriaFor("prd-readiness")` returns the rubric prose sliced by the two anchors, not a fallback.
- `instructionFor("prd-readiness")` returns `PRD_READINESS_INSTRUCTION` exactly (a dedicated pin, since many kinds share the generic `"verdict"` containment check).

## 6. Design Decision Rationale

**How many cases?** Options: 2 vs 4. 2 satisfies the ≥2-per-kind test but under-exercises the `not-ready` space; 4 matches the FAFF-1007 count and covers both `not-ready` reasons. **Chosen:** 4 (2 admissible / 2 not-ready) — proportionate to the precedent, sharper boundary.

**Fixture field name.** Options: `prd_body` vs generic `body`/`document`. `prd_body` self-documents the single code-blind input. **Chosen:** `prd_body`.

**criteriaFor anchors.** Options: the rubric-section anchors (START `## The rubric…`, END `## Output (the contract artifact)`) vs a wider slice including Inputs. The rubric section is what the judge applies; a wider slice leaks non-rubric prose. **Chosen:** the two rubric-section anchors, each verified unique. At time of writing both strings occur exactly once in `faffter-noon-prd/SKILL.md`.

**oracle-triage accounting.** Options: `scope_kinds` (claims this spike triaged it) vs `remaining_kinds` (defers to FAFF-614). prd-readiness is not measured here; claiming a scope would be false. **Chosen:** extend the existing FAFF-614 `remaining_kinds` deferral, mirroring FAFF-1007.

**frontier baseline.** Options: capture the baseline now vs defer. Baseline capture is a human-supervised sweep. **Chosen:** defer to FAFF-614; no `per_kind` row for prd-readiness in `eval/baselines/frontier.json` in this ticket.

**Grader arm.** Options: add a prd-readiness arm vs reuse the shared `env.verdict` arm. It already rides the shared arm (verified in `eval/grader.mjs`). **Chosen:** no grader-arm edit — the deliberate simplification versus FAFF-1007.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.**

- **Assumes:** the two `criteriaFor` anchor strings each occur exactly once in `plugin/skills/faffter-noon-prd/SKILL.md`, i.e. the SKILL section headings are the anchor source. Validate: at build time, `grep -c` each anchor string against the SKILL; both must return 1 before wiring `loadPrdReadinessProse`. If either is not unique, adjust the anchor to a unique nearby heading.
- **Assumes:** the exact integer pre-values for each count assertion match the working tree branched off `main` (the findings' absolutes are the origin/main baseline; this development branch differs). Validate: read each assertion's current value in the tree and apply the delta from the HOW counts table, rather than pasting this spec's absolutes.
- **Assumes:** `eval/cases/prep-architecture-trigger-001.json` remains the representative single-verdict case shape to mirror. Validate: open it and confirm the `{ id, kind, fixture:{version,…}, question, oracle:{closed_set:[…]} }` shape before authoring the four cases.

## 8. DONE — Definition of Done

### From WHY
- [ ] `prd-readiness` seam-registry status is `covered` (was `designed`), and the coverage claim is true (≥1 gradeable case exists).

### From WHAT (types and interfaces)
- [ ] `eval/grader.mjs` `FIXTURE_SHAPE` has `"prd-readiness": ["prd_body"]`; `KINDS`, `CLOSED_SET_KINDS`, and the shared `env.verdict` arm are unchanged.
- [ ] Four cases exist: `eval/cases/prd-readiness-001..004.json`, each `{ id, kind:"prd-readiness", fixture:{version:1, prd_body}, question, oracle:{closed_set} }`; two oracles `["admissible"]`, two `["not-ready"]`.

### From HOW (behaviour — cli-driver)
- [ ] `PRD_READINESS_INSTRUCTION` exists and asks for exactly one `faff-eval:judgement` block `{ "case_id", "verdict":"admissible|not-ready" }`.
- [ ] `modeInstructionFor` returns it for `kind === "prd-readiness"`.
- [ ] `renderFixturePrompt` has a `c.kind === "prd-readiness"` branch that renders `c.fixture.prd_body` (not the tidy fallback).
- [ ] `criteriaFor` returns `loadPrdReadinessProse(pluginDir)` for prd-readiness; the loader slices with START `"\n## The rubric (the LLM applies this)\n"` / END `"## Output (the contract artifact)"`.

### From HOW (tests + records)
- [ ] `test/eval-cli-driver.test.mjs`: `ANCHOR_REGISTRY` gains `PRD_READINESS_PROSE_START: { skill: "faffter-noon-prd", end: "PRD_READINESS_PROSE_END" }`; start-anchor and end-anchor count assertions each +1; `READ_FIELD` gains `"prd-readiness": "verdict"`; case-backed-kind count +1 with its message updated; prd-readiness removed from the "deliberately unarmed" comment; a dedicated test pins `instructionFor("prd-readiness") === PRD_READINESS_INSTRUCTION`.
- [ ] `test/oracle-triage.test.mjs`: `FAFF_1095_KINDS = new Set(["prd-readiness"])` added and unioned into `TARGET_KINDS`.
- [ ] `eval/calibration/oracle-triage.json`: `meta.remaining_kinds` includes `"prd-readiness"` (alongside `"park-reconsider-classification"`); the `meta.follow_ups.remaining_kinds` string names prd-readiness so its target-kind tokens equal `remaining_kinds` exactly; still under the FAFF-614 deferral.
- [ ] `test/seam-registry.test.mjs`: `"prd-readiness"` dropped from the `designed`-set literal.
- [ ] `test/eval-grader.test.mjs`: `cases.length` +4; `"prd-readiness"` added to the ≥2-per-kind list.
- [ ] `eval/README.md`: case count +4, kind count +1, base reps + (4×20), worst reps + (4×50), gate/gap figures recomputed; values ≥1000 written with the `toLocaleString` comma form; the Proportionate gate, Running it, and Re-baseline runbook sections updated.

### From HOW (edge cases)
- [ ] Building against a working tree branched off `main`: each count assertion is set from the tree's actual pre-value plus the delta, not the spec's absolute.
- [ ] `eval/baselines/frontier.json` has no `per_kind` row for prd-readiness (deferred to FAFF-614).

### Eval coverage
- [ ] This same ticket registers the grader `KIND` coverage (already-registered KIND flipped to `covered`), ≥1 (here 4) eval cases, and the seam-registry row — all autonomous-doable. Baseline acceptance is FAFF-614, not required here.

### CI
- [ ] Full CI green: `test/eval-cli-driver.test.mjs`, `test/oracle-triage.test.mjs`, `test/seam-registry.test.mjs`, `test/eval-grader.test.mjs`, and `faff validate-adapters` all pass.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. node --test test/eval-cli-driver.test.mjs test/oracle-triage.test.mjs \
       test/seam-registry.test.mjs test/eval-grader.test.mjs
  2. EXPECT: all pass — anchor counts, READ_FIELD, case-backed count,
     cases.length, designed-set, and remaining_kinds all reflect prd-readiness
  3. faff validate-adapters
  4. EXPECT: frontmatter<->registry reconciliation clean; prd-readiness now covered
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
