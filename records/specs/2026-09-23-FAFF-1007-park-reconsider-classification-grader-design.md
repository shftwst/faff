# Spec — FAFF-1007: park-reconsider-classification grader, eval cases and case-backed wiring

> Spec: faffter-dark-nlspec · 2026-09-23 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1007.

> Revised 2026-09-23 — sharpened the oracle-triage widening (QA spec-review objection): the prescription now covers all three fields the tests read (`TARGET_KINDS`, the top-level `meta.remaining_kinds` array, and the `meta.follow_ups.remaining_kinds` string), so `test/oracle-triage.test.mjs` goes green.

**Artifact:** a buildable spec for FAFF-1007. **Audience:** the build agent that will land the change, plus human reviewers gating it. This spec turns the `park-reconsider-classification` grader KIND from `designed` to `covered` by adding its eval cases and completing the case-backed harness wiring that FAFF-992 registered but deferred.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff's eval harness proves an LLM-judgement seam is trustworthy by grading it against fixed cases: a KIND must appear in the grader, the CLI driver must know how to prompt for and read its verdict, and the seam-registry must record it as `covered`. Today `park-reconsider-classification` is half-registered: the KIND exists, but nothing grades it. An ungraded closed-set classifier is running in production (FAFF-993, shipped 2026-09-05) deciding whether a parked issue may be autonomously re-opened. If it ever marks a scope, taste, or architecture park `machine`, faff will silently re-open a park that only a human should close. This spec closes that exposure by wiring the grader end to end and adding cases whose gate fails loud on exactly that mistake.

**Problem statement.** The KIND is registered (grader `KINDS`/`CLOSED_SET_KINDS`, seam-registry at `designed`, faff-prep frontmatter) but has no cases and no case-backed harness arms, so the live classifier is ungraded. That gap lets a scope/taste/architecture park be scored `machine` with nothing catching it. This change lands the cases plus every missing harness arm and flips the KIND to `covered`.

**Design principles.**

- **Fail-safe on the safety property.** The one property the gate must enforce is: no scope, taste, or architecture case is ever assigned `machine`. Any wiring that would let such a case grade green is wrong, even if all other tests pass.
- **Mirror the single-verdict precedent, do not invent shape.** `park-reconsider-classification` is a single-scalar closed-set kind exactly like `prep-architecture-trigger`, `routing`, `verdict-build`, `spec-verdict`, and `prd-readiness`. Every arm added here mirrors the `prep-architecture-trigger` analogue on the same surface (faff-prep). No new pattern is introduced.
- **One home for the rubric prose.** The grader's criteria prose loads from `plugin/skills/faff/references/park.md` (the reconsider-classification rubric), not from faff-prep's SKILL.md. Do not duplicate the rubric into the loader or the cases.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | JS (mjs) | `FIXTURE_SHAPE` and `predictedSet()` need this kind's arm |
| `eval/cli-driver.mjs` | JS (mjs) | three dispatch ladders (`modeInstructionFor`, `renderFixturePrompt`, `criteriaFor`) need an arm |
| `eval/seam-registry.json` | JSON | the KIND's row flips `designed` -> `covered` |
| `eval/calibration/oracle-triage.json` | JSON | scope/honesty ledger the oracle-triage test drives |
| `eval/README.md` | Markdown | derived case/kind counts must stay fresh |
| `plugin/skills/faff/references/park.md` | Markdown | the reconsider-classification rubric the criteria loader extracts |
| `plugin/skills/faff-prep/SKILL.md` | Markdown | already declares the kind in `judgement_seam` frontmatter (no edit) |
| `eval/cases/prep-architecture-trigger-001.json`, `eval/cases/routing-001.json` | JSON | case-shape templates |

**Scope statement.** This sits in faff's eval harness (`eval/`), extending the case-backed grading path that already gates every other closed-set judgement seam.

## 2. OUT OF SCOPE

- **Recording or accepting the frontier baseline value.** Excluded: baseline capture is a separate human-supervised re-baseline event, not autonomous eval-coverage work. Extension point: the FAFF-614 re-baseline sweep, which adds a `frontier.json` `per_kind` row for this kind.
- **Any change to the production classifier (FAFF-993 write side).** Excluded: this ticket grades the existing behaviour; it does not alter how parks are classified. Extension point: `park-reconsider.js` / `park-history.js` if the rubric itself ever changes.
- **The rubric prose in `park.md`.** Excluded: the rule is already written (FAFF-992). This ticket reads it, it does not edit it. Extension point: the `### Reconsider classification and the park-versus-hold boundary (FAFF-992)` section of `park.md`.
- **Grader `KINDS` / `CLOSED_SET_KINDS` membership.** Excluded: FAFF-992 already added the kind to both (`KINDS.length === 37`). Extension point: none needed; leave as is.
- **faff-prep `judgement_seam` frontmatter.** Excluded: already declares the kind. Extension point: `plugin/skills/faff-prep/SKILL.md` line 4 if the seam set changes.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| KIND | An LLM-judgement seam the eval harness grades, keyed by a stable string id |
| closed-set kind | A kind whose verdict is one value from a fixed small set; graded by set-equality |
| case-backed kind | A kind with eval cases the driver can prompt for and read a verdict from |
| `covered` | seam-registry status meaning the kind has cases and full harness wiring |
| reconsider disposition | The `{human, machine}` verdict this classifier assigns to a park |

**The verdict shape (unchanged from FAFF-992).** Closed-set values are exactly `{human, machine}`. `human` = a scope, taste, or architecture judgement call, or any cause the classifier cannot positively prove machine-checkable (in doubt -> `human`; legacy or no-park-subobject -> `human`, fail-safe). `machine` = only when the cause is provably machine-checkable and cites a single external repo-root config file (`cited_input {kind:"config-file", ref, keys?, fingerprint}`); a backend, multi-file, or env-var cause downgrades to `human` at write time.

**Case fixture shape.** Mirrors `prep-architecture-trigger-001.json` / `routing-001.json`:

```
RECORD Case:
  id: String                       # e.g. "park-reconsider-classification-001"
  kind: "park-reconsider-classification"
  fixture: RECORD:
    version: 1
    issue: Object                  # the parked issue
    park:  Object                  # the park sub-object (root_cause_class, reason, cited_input_candidate)
  question: String                 # the classifier prompt (identical across the four cases)
  oracle: RECORD:
    closed_set: ["human"] | ["machine"]   # the graded-correct verdict, one value
```

**Grader arms.**

- `FIXTURE_SHAPE` gains one row: `"park-reconsider-classification": ["issue", "park"]`. Adding it turns on `validateCase`'s fixture-shape guard for this kind (fixtures must carry an `issue` and a `park`).
- `predictedSet()` gains one arm reading the single scalar `env.reconsider`, joining the single-verdict precedent block:
  `case "park-reconsider-classification": return env.reconsider == null ? [] : [String(env.reconsider)];`
  Without it the switch falls to `default`, which reads `env.classifications[c.kind]` (the wrong, multi-label shape).

**CLI-driver arms (three ladders, all mirroring the `prep-architecture-trigger` analogue).**

1. `modeInstructionFor(kind)`: a `PARK_RECONSIDER_CLASSIFICATION_INSTRUCTION` constant asking for only a fenced `faff-eval:judgement` block of shape `{ "case_id": "<ID>", "reconsider": "human|machine" }`, plus a dispatch line `if (kind === "park-reconsider-classification") return PARK_RECONSIDER_CLASSIFICATION_INSTRUCTION;`. `instructionFor` wraps `modeInstructionFor` and inherits it.
2. `renderFixturePrompt(c, judgementProse)`: an `if (c.kind === "park-reconsider-classification")` branch rendering the issue plus the park sub-object (not the generic tidy fallback).
3. `criteriaFor(kind, pluginDir)`: `if (kind === "park-reconsider-classification") return loadParkReconsiderProse(pluginDir);` plus a `loadParkReconsiderProse` loader mirroring `loadPrepArchitectureTriggerProse`.

**The criteria loader anchors.** `loadParkReconsiderProse` extracts from `plugin/skills/faff/references/park.md` (not faff-prep). Both anchors were counted against the working tree and occur exactly once:

```
PARK_RECONSIDER_PROSE_START = "\n### Reconsider classification and the park-versus-hold boundary (FAFF-992)\n"
PARK_RECONSIDER_PROSE_END   = "\n### The git-only Unpark contract (FAFF-993)\n"
```

**Design decision — extractSection anchors.** The rubric section is bracketed by its own heading and the next `###` heading in `park.md`. Both strings verified unique (one match each) in the newline-delimited form `extractSection` requires. **Chosen:** START `"\n### Reconsider classification and the park-versus-hold boundary (FAFF-992)\n"`, END `"\n### The git-only Unpark contract (FAFF-993)\n"`.

**Design decision — how many cases ship.** Options: (i) the four recovered FAFF-992 drafts as-is; (ii) widen with more. The four cover the safety property directly (three `human`: architecture, scope, taste; one `machine`: config-fault) and satisfy both the `>=2 cases per kind` convention and the gate's need for scope/taste/architecture `human` cases. Widening adds cost without sharpening the gate. **Chosen:** ship the four recovered drafts.

**Design decision — frontier baseline row now or defer.** Options: (i) add a `frontier.json` `per_kind` baseline row in this ticket; (ii) defer to the FAFF-614 re-baseline sweep. Adding a baseline is a human-supervised accept step, not autonomous eval-coverage work, and the README derived-facts math assumes no new frontier row lands here. **Chosen:** defer the frontier baseline row to FAFF-614.

**Design decision — oracle-triage widening path.** `test/oracle-triage.test.mjs` reads two distinct `meta` fields: the top-level `meta.remaining_kinds` (an array, currently `[]`) that the honest-scope test unions with `meta.scope_kinds` and asserts equals `TARGET_KINDS`, and `meta.follow_ups.remaining_kinds` (a string naming a ticket) that the deferral-is-priced test parses. A newly `covered` but ungated kind (no `frontier.json` `per_kind` row) must be in `TARGET_KINDS` or the not-stale test fails; adding it to `TARGET_KINDS` then forces the honest-scope union to gain it too. Options: (i) a full `meta.scope_kinds` entry with a per-case triage entry for each of the four cases — the per-kind set-equality test iterates `scope_kinds`, so this path additionally requires authoring four triage entries; (ii) list the kind in `meta.remaining_kinds` (the deferred, un-triaged bucket) — the set-equality test does not touch `remaining_kinds`, so no triage entries are owed. Path (ii) keeps this ticket to eval-coverage wiring and folds the oracle-triage-plus-baseline work into the same FAFF-614 re-baseline ticket that owns the deferred frontier row. **Chosen:** widen `TARGET_KINDS` (a new `FAFF_1007_KINDS` set unioned in, mirroring `FAFF_816_KINDS`), add `"park-reconsider-classification"` to the top-level `meta.remaining_kinds` array, and set `meta.follow_ups.remaining_kinds` to a string naming FAFF-614 whose only target-kind token is `park-reconsider-classification`; author **no** `scope_kinds` per-case triage now.

## 4. HOW — Behavior

**Approach.** The change is additive wiring plus data. No behaviour of the production classifier changes; the harness learns to grade it. The build agent lands: one `FIXTURE_SHAPE` row, one `predictedSet` arm, three CLI-driver arms plus one loader, one seam-registry status flip, four case files, the gating-test updates, and the README freshness figures. Once the three driver ladders and the grader arms are all present, `buildEvalPrompt` and `grade()` inherit correctness.

**The four cases (recovered FAFF-992 drafts, use verbatim as the starting corpus).**

```
PROCEDURE author_cases():
  case 001 (human/architecture):
    issue PROJ-301 "Choose the storage engine for the v1 ledger"
    park { root_cause_class: "punt-not-closed",
           reason: "...storage-engine choice (postgres vs sqlite) open as an architectural
                    tradeoff. No config file settles it; a human must call it.",
           cited_input_candidate: null }
    oracle.closed_set: ["human"]

  case 002 (human/scope):
    issue PROJ-302 "Add multi-tenant billing"
    park { root_cause_class: "gap",
           reason: "scope balloons into multi-tenant billing, out of milestone;
                    keep-or-defer is a product decision.",
           cited_input_candidate: null }
    oracle.closed_set: ["human"]

  case 003 (human/taste):
    issue PROJ-303 "Rename the public API surface"
    park { root_cause_class: "spec-ambiguous-external",
           reason: "three equally-valid naming schemes; taste call, no ground truth
                    in any external input.",
           cited_input_candidate: null }
    oracle.closed_set: ["human"]

  case 004 (machine/config-fault):
    issue PROJ-304 "Prep the spec for the resume-reconsider feature"
    park { root_cause_class: "other",
           reason: "spec-review parked needs-human because adversarial reviewer max_tokens
                    in the committed review config was too low, truncating every lens;
                    fix is an operator edit to that single repo-root config file.",
           cited_input_candidate: { kind: "config-file", ref: ".faffrc.yaml",
                                    keys: ["adversarial.spec_review.max_tokens"] } }
    oracle.closed_set: ["machine"]

  question (identical on all four):
    "Classify this park's reconsider disposition. Answer `machine` ONLY if the cause is
     machine-checkable and cites a single external config file whose content change would
     resolve it; answer `human` for a scope, taste, or architecture judgement call."
```

**Gating-test edits (each named test must go green).**

```
PROCEDURE wire_tests():
  test/eval-cli-driver.test.mjs:
    - READ_FIELD map: add "park-reconsider-classification": "reconsider"
    - "FAFF-669 ... instruction declares the key" (line 676): caseBackedKinds 30 -> 31;
      instructionFor output must contain JSON-quoted "reconsider"
    - "no non-exempt case-backed kind rides the tidy fall-through" (691-716):
      passes only when all three driver ladders are armed alongside predictedSet + READ_FIELD

  test/oracle-triage.test.mjs (a NEW ungated kind must be declared; three tests gate it):
    - TARGET_KINDS (~line 43): add a FAFF_1007_KINDS = new Set(["park-reconsider-classification"])
      and union it in, mirroring FAFF_816_KINDS. Required by the not-stale test (~85-95):
      an ungated case-kind absent from TARGET_KINDS fails loud.
  eval/calibration/oracle-triage.json (the data the tests read):
    - meta.remaining_kinds (top-level ARRAY, currently []): add "park-reconsider-classification".
      This is what the honest-scope test (~75-77) unions with meta.scope_kinds to equal TARGET_KINDS,
      and it keeps scope_kinds and remaining_kinds disjoint (no scope_kinds entry is added).
    - meta.follow_ups.remaining_kinds (a STRING, currently absent): set it to a string naming FAFF-614
      whose only target-kind token is "park-reconsider-classification" (e.g. "FAFF-614
      (park-reconsider-classification frontier baseline + oracle triage deferred to the operator
      re-baseline sweep)"). Required by the deferral-is-priced test (~100-107): a non-empty
      remaining_kinds owes a follow_ups.remaining_kinds string matching /FAFF-\d+/ whose kind-tokens
      equal remaining_kinds exactly.
    - Do NOT add a meta.scope_kinds entry: the per-kind set-equality test (~110-119) iterates
      scope_kinds only, so a remaining-kind owes no per-case triage entries.

  test/seam-registry.test.mjs:
    - "seed is truthful" derives want=covered from disk filenames -> forces the registry flip
    - designed-set literal (line 50): DROP "park-reconsider-classification" from the array

  test/eval-grader.test.mjs:
    - "all eval/cases load and validate" (line 782): cases.length 87 -> 91
    - ">=2 cases per kind" convention list (line 788): add "park-reconsider-classification"
```

**seam-registry flip.** The current row (`{ "surface": "faff-prep", "status": "designed" }`) becomes `"status": "covered"`, matching the same-surface `prep-architecture-trigger` covered row.

**eval/README.md freshness (derived by `deriveFacts`, checked by `test/eval-readme-freshness.test.mjs`).** With four new cases and no new frontier `per_kind` row:

| Fact | Before | After |
|---|---|---|
| case_count | 87 | 91 |
| kind_count | 30 | 31 |
| base_total | 1740 | 1820 |
| worst_total | 4350 | 4550 |
| gate_gap | 1 | 2 |

Correct the "Re-baseline runbook" (~line 153), "Running it" (~line 103), and the rep-count figures (~lines 221-222). Figures >= 1000 render with a comma via `toLocaleString` (`1,820`, `4,550`).

**Anti-pattern:** adding `predictedSet` + `READ_FIELD` without arming the three CLI-driver ladders. Why: the "no non-exempt case-backed kind rides the tidy fall-through" test fails loud, and the classifier would be prompted with the generic tidy fallback rather than the issue-plus-park render.

**Anti-pattern:** loading the criteria prose from `faff-prep/SKILL.md`. Why: the reconsider rubric lives in `park.md`; the faff-prep frontmatter only declares the seam membership.

**Failure modes.**

- **The failure:** the grader arm is wired but the four cases do not actually exercise the safety property (e.g. a `human` case's park reason is ambiguous enough that `machine` is defensible), so the gate would not catch a genuine mis-classification. **How you'd know:** flipping case 001/002/003's oracle to `["machine"]` in a scratch run does not turn the gate red, or a manual `machine` prediction on them grades green. **What it means:** narrow — sharpen the offending case's park `reason` until only `human` is defensible before landing.
- **The failure:** `extractSection` silently loads the wrong slice because an anchor is not unique or the heading text drifts. **How you'd know:** `loadParkReconsiderProse` returns prose that does not start at the reconsider-classification heading, or the driver's anchor-uniqueness check fails. **What it means:** proceed only after re-confirming both anchors match exactly once in `park.md` (verified at spec time; re-verify if `park.md` changed since).

## 5. Scenarios — born-verifiable main objectives

```
Given the four park-reconsider-classification cases are loaded and the harness is fully wired
When the eval grader scores each case against its oracle
Then each case grades on the single scalar `env.reconsider` via predictedSet + setEqual
```

```
Given a scope, taste, or architecture case (001, 002, or 003)
When that case is predicted `machine`
Then the gate FAILS (set-equality against oracle ["human"] does not hold)
```

```
Given the full CI eval suite
When it runs after this change
Then the FAFF-669 arming guard, FAFF-670 oracle-triage, eval-readme-freshness,
     seam-registry, and eval-grader tests are all green
```

- The seam-registry records `park-reconsider-classification` at status `covered`, derived-from-disk and asserted truthful.

## 6. Design Decision Rationale

**How many eval cases ship?** Options: the four recovered FAFF-992 drafts, or a wider corpus. The four already span the three `human` judgement kinds (architecture, scope, taste) that the safety property must protect plus one `machine` config-fault positive, and satisfy the `>=2 per kind` convention. **Chosen:** the four recovered drafts — they cover the gate's failure surface with no redundant cost.

**Add a frontier baseline row now, or defer?** Options: capture the baseline in this ticket, or defer. Baseline capture is a human-supervised accept step (FAFF-614 territory), and the README freshness math assumes no new frontier row lands here. **Chosen:** defer to the FAFF-614 re-baseline sweep — keeps this ticket fully autonomous-doable.

**Which extractSection anchors for `loadParkReconsiderProse`?** Options: raw headings, or newline-delimited headings. `park.md` uses `extractSection`, which takes the first match silently, so anchors must be unique in newline form. Both chosen anchors match exactly once. **Chosen:** START `"\n### Reconsider classification and the park-versus-hold boundary (FAFF-992)\n"`, END `"\n### The git-only Unpark contract (FAFF-993)\n"`.

**Oracle-triage widening: `scope_kinds` or `remaining_kinds`?** The kind must enter `TARGET_KINDS` (a newly ungated case-kind absent from it fails the not-stale test), and `TARGET_KINDS` must equal `meta.scope_kinds ∪ meta.remaining_kinds`. Options: put the kind in `scope_kinds` (the per-kind set-equality test then owes four triage entries), or in the top-level `meta.remaining_kinds` array (that test never touches remaining_kinds, so no triage entries are owed). The remaining_kinds path keeps this ticket to eval-coverage wiring and folds oracle-triage plus baseline into the same FAFF-614 re-baseline ticket that owns the deferred frontier row. **Chosen:** widen `TARGET_KINDS`, add the kind to the top-level `meta.remaining_kinds` array, and set `meta.follow_ups.remaining_kinds` to a FAFF-614 string whose only kind-token is `park-reconsider-classification` — the cheapest path that leaves all three oracle-triage tests green. At the time of writing FAFF-614 is the re-baseline home; revisit if that ticket is retired or split.

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision is closed.

**Assumptions.**

- **Assumes:** the four recovered FAFF-992 draft case bodies (commit `181085a0~1`) exist and are recoverable verbatim. Validation: before authoring, confirm the four files' content matches the reasons/oracles transcribed in section 4; if a draft cannot be recovered, author the case from the section-4 transcription (it is complete).
- **Assumes:** `FAFF-614` is the live re-baseline ticket that will own this kind's frontier baseline row and oracle triage. Validation: confirm FAFF-614 is open and scoped to re-baseline before naming it in `meta.follow_ups.remaining_kinds`; if retired or split, name its successor.

## 8. DONE — Definition of Done

### From WHY
- [ ] The live classifier's KIND is graded: no scope/taste/architecture case can grade green when predicted `machine`.

### From WHAT (types and interfaces)
- [ ] `eval/grader.mjs` `FIXTURE_SHAPE` has `"park-reconsider-classification": ["issue", "park"]`.
- [ ] `eval/grader.mjs` `predictedSet()` has the arm `case "park-reconsider-classification": return env.reconsider == null ? [] : [String(env.reconsider)];`.
- [ ] Four case files `eval/cases/park-reconsider-classification-00{1,2,3,4}.json` exist, each with `kind`, `fixture:{version:1, issue, park}`, the shared `question`, and `oracle.closed_set` (001/002/003 = `["human"]`, 004 = `["machine"]`).
- [ ] Grader `KINDS`/`CLOSED_SET_KINDS` are unchanged (`KINDS.length === 37`); faff-prep `judgement_seam` frontmatter unchanged.

### From WHAT (CLI-driver arms)
- [ ] `modeInstructionFor` returns a `PARK_RECONSIDER_CLASSIFICATION_INSTRUCTION` asking for only a fenced `faff-eval:judgement` block `{ "case_id", "reconsider": "human|machine" }`; `instructionFor` output for the kind contains the JSON-quoted `"reconsider"` key.
- [ ] `renderFixturePrompt` has a `park-reconsider-classification` branch rendering the issue plus the park sub-object (not the tidy fallback).
- [ ] `criteriaFor` returns `loadParkReconsiderProse(pluginDir)` for the kind, and `loadParkReconsiderProse` extracts the `park.md` section between the two chosen anchors.

### From HOW (registry and freshness)
- [ ] `eval/seam-registry.json` row for the kind reads `"status": "covered"`.
- [ ] `test/oracle-triage.test.mjs` `TARGET_KINDS` includes the kind (via a `FAFF_1007_KINDS` set unioned in). `eval/calibration/oracle-triage.json`: `"park-reconsider-classification"` added to the top-level `meta.remaining_kinds` array, and `meta.follow_ups.remaining_kinds` set to a FAFF-614 string whose only target-kind token is `park-reconsider-classification`; no `meta.scope_kinds` per-case entry added.
- [ ] `eval/README.md` derived figures updated: case_count 91, kind_count 31, base_total 1,820, worst_total 4,550, gate_gap 2 (runbook ~153, running-it ~103, rep counts ~221-222).

### From HOW (gating tests green)
- [ ] `test/eval-cli-driver.test.mjs`: `READ_FIELD` has `"park-reconsider-classification": "reconsider"`; `caseBackedKinds.length === 31`; both FAFF-669 arming tests pass.
- [ ] `test/oracle-triage.test.mjs`: the not-stale, honest-scope (union `scope_kinds ∪ remaining_kinds == TARGET_KINDS`, disjoint), and deferral-is-priced tests all pass with the `TARGET_KINDS` + top-level `meta.remaining_kinds` + `meta.follow_ups.remaining_kinds` widening.
- [ ] `test/seam-registry.test.mjs`: seed-truthful passes and the designed-set literal (line 50) no longer contains `"park-reconsider-classification"`.
- [ ] `test/eval-grader.test.mjs`: `cases.length === 91`; `>=2 cases per kind` list includes the kind.
- [ ] Full CI eval suite green (FAFF-669 arming guard, FAFF-670 oracle-triage, eval-readme-freshness, seam-registry, eval-grader).

### Eval coverage
- [ ] The `park-reconsider-classification` seam is registered `covered`: KIND (pre-existing) + 4 cases + seam-registry row, all in this ticket. Frontier baseline recording is deferred to FAFF-614 and is not required by this DONE.

### Integration smoke test
```
PROCEDURE smoke():
  1. Load eval/cases/park-reconsider-classification-002.json (scope/human)
  2. buildEvalPrompt(case) -> prompt contains the issue + park render and asks for
     a faff-eval:judgement block with a "reconsider" field
  3. Feed env { reconsider: "machine" } to grade()
  4. ASSERT the case grades FAIL (predictedSet -> ["machine"], oracle ["human"], setEqual false)
  5. Feed env { reconsider: "human" } to grade()
  6. ASSERT the case grades PASS
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
