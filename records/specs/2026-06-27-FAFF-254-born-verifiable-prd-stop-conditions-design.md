# Spec — FAFF-254: Born-verifiable PRD stop-conditions (machine-checkable done-criteria)

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · re-rated **high** after the 2026-06-27 Resolution closed both Punts. Full spec + Resolution on Linear FAFF-254.

## Resolution — both Punts decided (human, 2026-06-27) → spec re-rated high

**P1 — FAFF-34 evaluator wiring → ship the form-check now; forward interface for the evaluator.**
Build `classifyAcceptanceCriteria` + `faff prd validate --strict` + the Frozen-status freeze precondition now — they make a PRD's stop-conditions machine-checkable *in form* (born-verifiable). The *consumption* path (an evaluator marking the delivered artefact against them) is a documented forward interface FAFF-34 fills later. FAFF-254 ships standalone and does **not** block on the unbuilt evaluator.

**P2 — freeze-immutability depth → record-level (validate-time precondition).**
`prd validate --strict` enforces that a `Frozen` PRD *has* well-formed born-verifiable stop-conditions; it does **not** add a hash-pin / git-level lock. Deeper tamper-evidence is deferred (belongs with the PRDR supersession/authority machinery, FAFF-245/255).

**Build coordination — `prd-readiness` overlap with FAFF-253 (authoritative).**
FAFF-253 already shipped `faff contract prd-readiness` (the *admit-this-run?* admissibility verdict: `admissible`/`not-ready` + `creative_licence`, produced by the deferred LLM run-start validator) + `plugin/skills/faff/contracts/prd-readiness.schema.json`. FAFF-254 **reuses** that contract surface and does **not** define a second `prd-readiness` contract or schema. FAFF-254 owns the *deterministic* `classifyAcceptanceCriteria` classifier + `faff prd validate --strict` (the *is-this-PRD-born-verifiable?* form-check). The deterministic form-check is the forward interface the future run-start gate / evaluator consumes (it computes the `stop_conditions_verifiable` signal the existing verdict carries). **Effect:** the spec's original §3/§8 items that proposed registering a *new* `prd-readiness` contract with a `{criteria_present, all_born_verifiable, criteria, violations}` shape are superseded by this coordination — no second contract is created.

---

## 1. WHY

A PRD is the **definition-of-done = the termination function**: at L4 the loop stops when the immutable PRD's done-criteria are satisfied and the evaluator confirms it. For a loop to *terminate accountably* against a goal it cannot move, that goal's done-criteria must be **born verifiable** — concrete and machine-checkable in form. *Loose on what to build, always tight on when you're finished.*

`faff prd` (FAFF-252) ships a PRD with an `## Acceptance criteria` section, but `faff prd validate` is deliberately lenient — it checks metadata + non-empty body and never checks which sections exist or their shape, so a PRD can be "valid" with a placeholder `_TODO_` for its done-criteria. The `Frozen` status is recorded but not enforced. This change makes the done-criteria **machine-checkable in form** and makes that form a **precondition of freezing**.

**Design principles:**
- **The creative-licence dial applies to features, never to done-ness.** `## Requirements` stays lenient and is never form-checked; `## Acceptance criteria` must validate as born-verifiable.
- **Deterministic checks FORM and PRESENCE — never semantic verifiability.** A string validator confirms a criterion is *shaped* as a scenario or assertion; it cannot judge whether the predicate is *actually* checkable. Semantic verifiability is the evaluator's (FAFF-34) and the human's job.
- **Reuse FAFF-10's two complementary forms.** Behavioural done-criteria → Given-When-Then scenarios; non-functional → assertion/constraint lines. One language, two altitudes.

## 2. OUT OF SCOPE

- The evaluator lane (FAFF-34) itself — not built; this defines only a forward consumption shape.
- Full freeze-immutability / append-only enforcement — this enforces only the born-verifiable done-criteria precondition of freezing, not post-freeze tamper-resistance.
- A `faff prd freeze <container>` transition verb — the freeze precondition is enforced at `validate` time.
- Semantic verifiability judgement — the evaluator's/human's call.
- Changing the lenient default for Draft/Active/Stale — born-verifiable checking is opt-in (`--strict`) or status-triggered (`Frozen`).

## 3. WHAT

**The criterion classifier (the core deterministic primitive)** — a pure function over the `## Acceptance criteria` section text returning a classification per criterion:

```
ENUM CriterionKind: scenario | assertion | prose

FUNCTION classifyAcceptanceCriteria(sectionText) -> List<{text, kind}>:
  # 1. Strip blank lines and italic placeholders (^_.*_$ — e.g. "_TODO._")
  # 2. Split into criteria units: each markdown list item ("- "/"* "/"N.") OR
  #    each Given/When/Then block is one criterion.
  # 3. Classify each unit:
  #      scenario   IF it contains a "Then" keyword line (behavioural)
  #      assertion  ELSE IF an explicit obligation token (\bmust\b / \bmust not\b, case-insensitive)
  #                 OR a comparator (<, >, <=, >=, =, ≤, ≥)
  #      prose      OTHERWISE (loose narrative — NOT born-verifiable)
```

**Reuse FAFF-253's `prd-readiness` contract surface (do not create a second).** The deterministic form-check surfaces through `faff prd validate --strict` (violations + exit code); it is the forward interface that the run-start gate / evaluator (which already consume FAFF-253's `prd-readiness` verdict) read for the `stop_conditions_verifiable` signal.

## 4. HOW

Three layers, smallest blast radius first:
1. **Classifier** — `classifyAcceptanceCriteria(sectionText)` (pure; the testable core).
2. **Section extraction** — `acceptanceSection(prdText)`: find `## Acceptance criteria` (case-insensitive prefix), return the text up to the next `## ` heading or EOF; MISSING if absent.
3. **CLI wiring** — `prdValidate` gains (a) a `--strict` mode that runs the classifier over every PRD, and (b) an always-on `Frozen`-status rule that runs it regardless of `--strict`.

```
PROCEDURE strictCheck(prdText) -> List<violation>:
  section = acceptanceSection(prdText)
  IF section == MISSING: return ["no '## Acceptance criteria' section"]
  criteria = classifyAcceptanceCriteria(section)
  IF criteria empty (only blanks/placeholders):
     return ["acceptance criteria are placeholder-only — no born-verifiable criterion"]
  return one violation per prose criterion:
     "criterion not born-verifiable (loose prose, not a Given/When/Then scenario or MUST/comparator assertion): <first 60 chars>"

PROCEDURE prdValidate(dir, { strict }):
  problems = [ ...existing lenient checks ]          # UNCHANGED
  for each prd p:
    runStrict = strict OR statusIsFrozen(p)          # Frozen always triggers; --strict triggers for all
    IF runStrict: problems += strictCheck(p.text).map(v => `${p.file}: ${v}`)
  return problems
```

- `faff prd validate` → lenient + the Frozen-only rule (exit 1 if any problem).
- `faff prd validate --strict` → lenient + strict for every PRD.

**Template stub born in the right form.** `prdTemplate`'s `## Acceptance criteria` placeholder shows one GWT scenario and one MUST assertion (self-contained — no FAFF-NN ref in the generated artefact), and the still-present italic placeholder is treated as "absent" by the classifier until the author fills it.

**Anti-patterns:** form-checking `## Requirements`; treating a passing strict check as "the criteria are *verifiable*" (it gates FORM only).

**Failure modes (named, accepted):**
- The `MUST`/comparator proxy passes a well-formed but unverifiable assertion ("the UX MUST feel delightful") — accepted: the validator gates form, not truth; semantic verifiability is FAFF-34/human.
- A behavioural criterion phrased without the literal `Then` keyword is misclassified `prose` — narrow; the template stub + docs teach the GWT shape. A widening recogniser is a noted extension point.
- Heading variants (`## Acceptance Criteria`, `## Acceptance criteria (release)`) — matched case-insensitively on the `acceptance criteria` prefix.

## 5. Scenarios (dogfood — FAFF-10's GWT/assertion split applied to this ticket)

```
Given a PRD whose "## Acceptance criteria" is the template placeholder "_TODO._"
When `faff prd validate --strict` runs over it
Then it FAILs with a "placeholder-only — no born-verifiable criterion" violation (exit 1)
```
```
Given a PRD whose acceptance criteria are a Given/When/Then scenario and a "response MUST be < 200ms" assertion
When `faff prd validate --strict` runs over it
Then it passes (exit 0) and classifies the two criteria as scenario and assertion
```
```
Given a PRD whose acceptance criteria contain a loose-prose bullet ("the feature should work well")
When `faff prd validate --strict` runs over it
Then it FAILs with a "not born-verifiable (loose prose ...)" violation naming that criterion
```
```
Given a PRD with Status "Frozen" whose acceptance criteria are loose prose
When the default (lenient) `faff prd validate` runs — no --strict flag
Then it FAILs anyway, because Frozen always triggers the born-verifiable precondition
```
```
Given a PRD with a loose, open "## Requirements" section but born-verifiable "## Acceptance criteria"
When `faff prd validate --strict` runs
Then it passes — the form-check targets only acceptance criteria, never the requirements/feature prose
```

Non-functional assertions:
- The classifier MUST be a pure function of the section text (no filesystem/tracker I/O) so it is unit-testable in isolation.
- `faff prd validate` (no `--strict`) MUST stay backward-compatible for Draft/Active/Stale PRDs — existing FAFF-252 tests pass unchanged; only Frozen-status behaviour is newly stricter.
- `faff validate-adapters` MUST stay green.

## 8. DONE

- [ ] A PRD with a placeholder/loose `## Acceptance criteria` no longer passes the born-verifiable gate (`faff prd validate --strict` exits 1 with a violation).
- [ ] `classifyAcceptanceCriteria(sectionText)` exists as a pure function returning `[{text, kind}]` with `kind ∈ {scenario, assertion, prose}`.
- [ ] A criterion with a `Then` line → `scenario`; with `MUST`/`MUST NOT`/comparator → `assertion`; else → `prose`.
- [ ] Italic placeholders (`^_.*_$`) and blank lines are stripped, not classified.
- [ ] `faff prd validate --strict` runs the classifier over every PRD and FAILs (exit 1) on any missing section / placeholder-only / prose criterion.
- [ ] `faff prd validate` (no flag) FAILs a `Frozen`-status PRD whose acceptance criteria are not born-verifiable, and stays lenient for Draft/Active/Stale.
- [ ] The strict check reads ONLY the `## Acceptance criteria` section; `## Requirements` is never form-checked.
- [ ] Heading match is case-insensitive on the `acceptance criteria` prefix.
- [ ] `prdTemplate`'s `## Acceptance criteria` placeholder shows a self-contained GWT scenario + a MUST assertion (no FAFF-NN ref in the generated artefact), and a fresh `faff prd new` still passes lenient validate but fails `--strict` until filled.
- [ ] `docs/guide/cli.md` documents `faff prd validate --strict` and the Frozen freeze precondition.
- [ ] (Superseded by Resolution build-coordination) No second `prd-readiness` contract/schema is created — FAFF-253's is reused; evaluator-consumption is a documented forward interface.

confidence: high (0 open Punts after the 2026-06-27 Resolution)
