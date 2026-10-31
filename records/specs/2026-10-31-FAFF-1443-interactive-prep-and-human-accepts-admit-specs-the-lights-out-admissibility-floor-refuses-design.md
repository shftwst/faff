*Agent-written (Claude Code): FAFF-1443 spec, produced by interactive prep for the operator. Revised after spec-review rounds 1–2.*

# FAFF-1443: Show the lights-out admissibility result on every attached spec, and make the producers write scenarios both counters read

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1443.

This spec is for the build agent and its reviewers. It closes the gap that let FAFF-1431's spec reach Todo through a human accept while `faff admissible --lights-out` refused it. Two changes: `faff prep attach` computes the admissibility verdict on every stage and records it on the spec, and both bundled `spec` producers state one scenario format that every scenario counter reads.

## 1. WHY

**The load-bearing idea:** the admissibility check must run where every spec passes, mechanically, not at the producer's discretion. Every attach already goes through `faff prep attach`.

**Problem.**
- FAFF-1431's spec (`records/specs/2026-10-29-FAFF-1431-…-design.md`) has 9 Scenarios units. 8 are bullets of the form `- **Given** … **when** … **then** …`. On `main` today:
  - `faff admissible --lights-out` refuses it: `0 born-verifiable scenario(s) (need >=1)`.
  - `faff dod classify` classes those 8 as `prose`, so only 3 of the spec's criteria were judgeable at the holdout, which returned `needs-human`.
- The ticket's diagnosis ("Given, When and Then must be on separate lines") is close but not exact. Probing the two counters on `main`:

| Unit form | `dod classify` class | `admissible` R1 count |
|---|---|---|
| `- **Given** a, **when** b, **then** c` (FAFF-1431) | prose | 0 |
| `- Given a When b Then c` | scenario | 0 |
| `**Given** a` / `**When** b` / `**Then** c` on separate lines | scenario | 0 |
| `Given a` / `When b` / `Then c` on separate lines, plain or fenced | scenario | 1 |

  `classifyCriterion` needs a capitalised `Then` anywhere in the unit (`admissibility.js` l. 50). `parseScenarios` (R1) counts a line that *starts* with `Given` (l. 569), so a bullet or bold prefix hides it. Only the plain, line-per-keyword form satisfies both.
- The producer self-review already runs `faff admissible` (FAFF-1293, `faffter-noon-spec/SKILL.md` l. 85), but it reads only `warnings[]`, never the refusal itself, and it is a prose step. FAFF-1431 was produced after FAFF-1293 shipped and still went through.
- Interactive prep and the human accept never call `faff admissible`, so nothing showed the refusal before Todo.

### Design principles

**Never weaken a gate.** `classifyCriterion` and `parseScenarios` stay byte-identical: no form that is refused today becomes admissible. The fix makes producers write the form both counters read, and makes the verdict visible.

**The human accept stays a human accept.** At an interactive promotion the result is shown and recorded; it never refuses the human. The automated path already refuses an inadmissible spec at build (beep-boop's admissibility filter and `faff graft admit`), and FAFF-1423 adds the refusal at autonomous promotion.

**Mechanical, not prose.** The verdict is computed in `faff prep attach`, the one command every attach path calls, and written as a retained line beside `build-tier:`, the same way the tier is.

### Reference context

- `plugin/skills/faff/bin/lib/prep-attach.ts`: `stage` l. 203, `applyTier` l. 159 (the retained-line pattern to copy), `PrepExtras` l. 22, `StageMarker` l. 28, `emit` l. 334. TypeScript, layout d (ADR-0132): commit the `.js` emit and `build-manifest.json`.
- `plugin/skills/faff/bin/lib/admissibility.js` (legacy JS, exported): `admissibleVerdict(specText, true)` l. 778, `scenariosProseAdvisory` l. 754 (or `dodClassify` l. 297 filtered to `source:"scenarios"`, `class:"prose"`).
- `plugin/skills/faff-prep/SKILL.md` _Stage and attach_ l. 61–70. `SKILL_LINE_BASELINE["faff-prep"]` is 664 (`validate-adapters.js` l. 65), zero headroom.
- `plugin/skills/faffter-noon-spec/SKILL.md` _Scenarios_ l. 57–73 and _Self-review_ l. 85; `plugin/skills/faffter-dark-nlspec/SKILL.md` §5 l. 126–155 (inherits the noon self-review, l. 238).
- `test/prep-attach.test.mjs`, `test/admissible.test.mjs`; `docs/guide/cli.md` l. 109 (`prep attach` row).

### Already shipped against this surface

- **FAFF-1293** (#1151): the `scenarios-prose advisory` warning and the producer self-review step that reads it. This ticket keeps both, and adds the mechanical check the prose step did not guarantee.
- **FAFF-1406**: `faff prep attach`, the single stage command this ticket extends.
- **FAFF-224 / FAFF-1072**: the `faff admissible` gate and its build-time call sites (unchanged).

The premise holds: no Done ticket shows the verdict at attach or fixes the producer format.

## 2. OUT OF SCOPE

- **Aligning the two counters.** `parseScenarios` and `classifyCriterion` disagree in both directions (a bulleted `Given … Then …` is a scenario to classify but 0 to R1; a `Given` line with no `Then` counts 1 to R1 but is prose to classify). Aligning them changes the gate both ways, so it needs its own decision. **Extension point:** R1 counting `dodClassify` scenario-class units. Recommend a separate ticket.
- **Refusing autonomous promotion of an inadmissible `faff-automate` issue.** That is FAFF-1423. It can read the field and line this ticket adds.
- **Rewriting FAFF-1431's committed spec.** It is merged history.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| admissibility result | `admissibleVerdict(text, true)` over the stamped spec text, plus the ids of Scenarios units `dod classify` classes `prose`. |
| admissibility line | The retained line `admissibility: …` that stage writes directly after the `build-tier:` line. |
| stageable spec | A spec file with an H1, a `confidence: high` line, a valid `faff-contract:spec-readiness` block and a DONE section with one concrete item (`` - [ ] `faff x` exits 0 ``), so stage returns `ready-to-post` and R2a/R2b pass. |

### Interface

**`faff prep attach --spec` (stage).** On the `ready-to-post` and `attached` tokens, the JSON result gains:

```
"admissibility": { "admissible": <bool>, "reasons": [<string>…], "scenarios_prose": ["scenarios:<n>"…] }
```

- The token, exit code and every existing field are unchanged. The result never changes a token.
- `invalid`, `needs-judgement`, `errored` and the `--confirm` / `--park` results carry no `admissibility` key.
- Text mode appends `; admissibility: <line value>` inside the existing parenthesised details.
- The marker `.faff/prep/<ISSUE>.json` records the same `admissibility` object.

**The admissibility line.** Exactly one, outside fences, directly after `build-tier:`, replaced on every stage (never duplicated):

| Result | Line |
|---|---|
| admissible, no prose units | `admissibility: admissible` |
| admissible, prose units | `admissibility: admissible — prose scenarios: scenarios:2, scenarios:5` |
| refused | `admissibility: refused — R1.scenarios (0 of 3 units count)` (each failing check id, joined by `, `), then `; prose scenarios: …` when there are any |
| refused, no Scenarios units | `admissibility: refused — R1.scenarios (no Scenarios units)` |
| any fault while computing | `admissibility: unknown — check failed` |

R1 carries a count so a spec with no scenarios (legitimate for a human-built ticket, refused only for automation) reads differently from a format defect where units exist but none count. `<k> of <m>` is R1's count against the number of Scenarios units `dod classify` formed.

The line carries only fixed vocabulary: the verdict word, failing check ids from `checks[].id` (`R1.scenarios`, `R2a.done-present`, `R2b.done-concrete`, or `unparseable` for the fail-safe refusal) and `scenarios:<n>` unit ids. It never interpolates spec-derived text, so a spec cannot forge a verdict inside the line (R2b's reason quotes DONE item text; that stays in the JSON `reasons` only). It is capped at 300 characters, ending `…` when cut.

**Stability and fail-closed types.** The object always has exactly three keys with fixed types on every path: `admissible` a boolean, `reasons` an array of strings, `scenarios_prose` an array of strings. `admissible` is `true` only when `admissibleVerdict` returned `true` and the prose-unit collection did not throw. Any fault (a throw from `dodClassify` or anywhere in the helper) gives `admissible: false`, `reasons` containing `admissibility check failed: <message>`, `scenarios_prose: []`, and the `unknown` line. `docs/guide/cli.md` lists the keys and types, and a test pins them on the success, refused and fault paths, so FAFF-1423 can refuse on `admissible !== true` without a null guard.

**Producer scenario format** (both `faffter-noon-spec` and `faffter-dark-nlspec`). Each behavioural scenario is its own fenced block (plain or `holdout`), one step per line, each line starting with a capitalised `Given`, `When`, `Then` or `And`, with no bullet and no bold. The skills name the forms the counters do not read (bulleted, bold, lowercase `then`). Assertion bullets for non-functional objectives are unchanged.

**Producer self-review.** The deterministic check also reads `admissible` and `reasons`: an R1 refusal while the Scenarios section has at least one unit is a `major` finding (a format defect). An R1 refusal with no Scenarios units is noted in the review record only, since a spec may legitimately have none.

**`faff-prep/SKILL.md`.** _Stage and attach_ names the admissibility line beside the tier line, and gains one bullet: on any interactive move to Todo, including a human accept, read `admissibility` from `.faff/prep/<ISSUE>.json`, print it, and when it is refused or names prose scenarios, offer revise the scenarios (recommended), promote anyway, or leave in Backlog. A human may promote an inadmissible spec; the retained line records that on the spec. Autonomous prep does not act on it.

Promote only a spec whose marker reads `attached: true` with an `admissibility` object: the posted comment and the marker then describe the same bytes. A marker that is not attached, or has no `admissibility`, means the local spec differs from what was posted, so stage, post and confirm again before printing and promoting; the human accepts the comment that matches the printed line.

**Why the human accept sees it without relying on a prose step.** The line is written at the first stage, which happens the instant the producer returns, so it is already in the tracker comment the human reads and accepts. Every later re-post re-stages (and an un-staged re-post is refused at graft by `faff spec commit`'s sha check), so the posted line always matches the posted spec. The marker read above is the convenience that prints it; visibility does not depend on it.

### Where the code lives

| File | Change |
|---|---|
| `bin/lib/prep-attach.ts` (+ emit, `build-manifest.json`) | `applyAdmissibility` helper beside `applyTier`; stage calls it after the tier; result and marker fields; text-mode detail |
| `faffter-noon-spec/SKILL.md`, `faffter-dark-nlspec/SKILL.md` | canonical scenario-format rule; noon self-review reads the refusal |
| `faff-prep/SKILL.md` | the line in _Stage and attach_ and the one interactive bullet |
| `bin/lib/validate-adapters.js` | `faff-prep` baseline +1 with its comment entry, only if the bullet cannot be made line-neutral |
| `docs/guide/cli.md` | `prep attach` row: the `admissibility` field and line |
| `test/prep-attach.test.mjs`, new `test/spec-producer-scenario-format.test.mjs`, `test/fixtures/…` | §4.5 |

## 4. HOW

### 4.1 Procedure

1. In `stage`, after `applyTier`, call `applyAdmissibility(text)`. It computes the verdict over the text with any existing `admissibility:` lines removed, removes every line outside fences that starts with `admissibility:` (a line-start match, so a DONE item or prose that merely contains the word is untouched), and inserts one after the `build-tier:` line.
2. Carry `admissibility` into `common` only for the two success returns, and onto the marker before its final write.
3. Run every check on the final text: `sha256` and `body_path` are computed after the line is written, so `faff spec commit` and `--confirm` see the same bytes.

### 4.2 Decisions

- **Chosen:** compute in `faff prep attach` stage, advisory, token unchanged. Every attach path (Scenario A and B, autonomous Path 1 and 2, every re-post including the human accept's re-stage) already calls it, so the verdict cannot be skipped by a prose step. Alternative rejected: a prose `faff admissible` call in faff-prep, which is exactly the kind of step that failed for FAFF-1431.
- **Chosen:** at an interactive promotion or human accept, surface and record, never refuse. The operator's accept is the operator's call. The automated path already refuses at build, and FAFF-1423 adds the autonomous-promotion refusal. Alternative rejected: blocking the human, which would make the accept a non-accept.
- **Chosen:** fix the producers, leave both counters byte-identical. Widening either counter to the one-line or bulleted form would admit specs refused today, which weakens the floor (the ticket's first open question). Alternative rejected: accepting the one-line form in `classify` or R1.
- **Chosen:** a retained spec line, not only the marker. The marker is local and transient; the line travels with the tracker spec and the committed `docs/specs` file, so reviewers, `/faff-wtf` and FAFF-1423 can read it.
- **Chosen:** the line carries only check ids and unit ids, never spec text. A retained line built from spec content could be made to read as a different verdict.
- **Assumes:** every re-post goes through `faff prep attach` stage, as _Stage and attach_ requires ("stage again before every re-post"). Visibility at accept does not depend on this (the first stage already wrote the line); only freshness after an edit does, and an un-staged edit is refused at graft.

### 4.3 Docs

- `docs/guide/cli.md` `prep attach` row: the `admissibility` object on `ready-to-post` / `attached`, the retained line, and that it never changes a token.

### 4.4 Edge cases

- **Re-stage.** Staging an already-staged file leaves exactly one admissibility line, with the same value when the text is otherwise unchanged.
- **The line itself.** The line sits after the confidence line, which `scenariosBoundaryStop` treats as the end of Scenarios, and it is not a `- [ ]` item, so it changes neither counter, the DONE parse, the readiness fold nor `extractSpecFeatures`. A test pins that `faff tier` and `faff admissible` give the same result with and without the line.
- **A `admissibility:` line inside a fence** is content and is left alone, as `applyTier` does for `build-tier:`.
- **No `build-tier:` line** cannot happen after `applyTier`, which always inserts one.
- **Git-only.** `attached` carries the field, and `.faff/specs/<ISSUE>.md` carries the line.

### 4.5 Tests (in `test/` only, `node --test`, no new `--selftest` cases)

- `test/prep-attach.test.mjs`: every scenario below; the line count and value on re-stage; no `admissibility` key on `invalid` and `needs-judgement`; text-mode output names the line value; `spec_sha256` matches the file bytes including the line.
- A fixture copy of FAFF-1431's committed spec, staged with `--extraction`: `admissible:false`, the R1 reason, and 8 ids in `scenarios_prose`.
- `test/spec-producer-scenario-format.test.mjs`: for each of the two producer SKILL.md files, extract the fenced scenario example(s) from its Scenarios section, build a minimal spec around them, and assert every unit classifies `scenario` and R1 counts one per example. Negative pins: the FAFF-1431 bullet form classifies `prose` with R1 0, so widening either counter later is a visible, deliberate test change.
- `faff tier` and `faff admissible` on a spec with and without the admissibility line give identical output.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a stageable spec whose Scenarios section is three bullets written "- **Given** x, **when** y, **then** it exits 1."
When `faff prep attach --issue FAFF-9001 --spec S --mode interactive --root R --json` runs
Then it exits 0 with token "ready-to-post"
And admissibility.admissible is false and admissibility.reasons contains "0 born-verifiable scenario(s) (need >=1)"
And admissibility.scenarios_prose lists three ids
And S contains exactly one line "admissibility: refused — R1.scenarios (0 of 3 units count); prose scenarios: scenarios:1, scenarios:2, scenarios:3"
```

```
Given the same stageable spec with its Scenarios rewritten as one fenced block of plain "Given", "When" and "Then" lines
When the same stage command runs
Then it exits 0 with token "ready-to-post"
And admissibility is {"admissible": true, "reasons": [], "scenarios_prose": []}
And S contains exactly one line "admissibility: admissible"
```

```
Given a stageable spec already staged once, so it carries an admissibility line
When the same stage command runs on it a second time
Then S still contains exactly one line starting "admissibility:"
And .faff/prep/FAFF-9001.json records the same admissibility object as the JSON result
```

```
Given a stageable spec whose Scenarios are three FAFF-1431-style bullets and whose DONE section adds a vague item "- [ ] admissibility: admissible, works correctly"
When the stage command runs with --json
Then admissibility.reasons contains an R2b reason quoting the DONE item
And S contains exactly one line starting "admissibility:", and it is "admissibility: refused — R1.scenarios (0 of 3 units count), R2b.done-concrete; prose scenarios: scenarios:1, scenarios:2, scenarios:3"
```

```
Given a stageable spec with its confidence line removed
When the stage command runs with --json
Then the token is "invalid"
And the JSON result has no "admissibility" key
```

## 5. DESIGN DECISION RATIONALE

- **Stage, not prose.** FAFF-1293 already asked the producer to run the check, and FAFF-1431 still went through. A command every path calls is the only place the check cannot be skipped.
- **Advisory for the human.** Refusing the human would make "human accept" mean nothing, and the automated path is already protected at build. Recording the result on the spec keeps the human's choice visible.
- **Producers, not counters.** Both counters already accept the plain line-per-keyword form; the defect is producers writing other forms. Fixing the producers costs no gate strength.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

- **Assumes:** every re-post goes through stage (§4.2). If a session edits and re-posts without staging, the line is stale; `faff spec commit` already refuses a posted spec whose sha differs from the marker, so the miss is caught at graft.
- The counter-alignment ticket (§2) is recommended, not filed here.

### Dependencies

- **FAFF-1423 builds on this ticket.** It should refuse autonomous promotion by reading the `admissibility` object this ticket adds, not by calling `faff admissible` a second time. Recommend a tracker relation with FAFF-1443 first. The two do not merge: FAFF-1423 is a refusal on the autonomous path; this ticket is visibility on every path plus the producer fix.

## 7. DONE

### From WHY
- [ ] Staging FAFF-1431's committed spec (fixture, with `--extraction`) prints `admissibility.admissible: false`, the R1 reason, and 8 `scenarios_prose` ids.

### From WHAT
- [ ] `faff prep attach --spec … --json` prints an `admissibility` object with `admissible` (boolean), `reasons` and `scenarios_prose` (string arrays) on `ready-to-post` and `attached`, and on no other token.
- [ ] A fault while computing (a forced `dodClassify` throw in a test) gives `admissible: false`, a `reasons` entry starting `admissibility check failed:`, `scenarios_prose: []` and the line `admissibility: unknown — check failed`; the stage token is unchanged.
- [ ] A spec with no Scenarios units gets `admissibility: refused — R1.scenarios (no Scenarios units)`; a spec with three uncounted units gets `R1.scenarios (0 of 3 units count)`.
- [ ] The staged spec carries exactly one `admissibility:` line directly after `build-tier:`, in the formats of the §3 table, built only from the verdict word, check ids and unit ids, capped at 300 characters.
- [ ] The stage token and exit code are the same as on `main` for every input in `test/prep-attach.test.mjs`.
- [ ] The marker `.faff/prep/<ISSUE>.json` records the `admissibility` object.
- [ ] Both producer SKILL.md files state the canonical scenario format and name the bulleted, bold and lowercase forms as unread.
- [ ] `faffter-noon-spec/SKILL.md`'s self-review treats an R1 refusal with at least one Scenarios unit as a `major` finding.
- [ ] `faff-prep/SKILL.md` _Stage and attach_ names the admissibility line and says interactive prep promotes only on an attached marker (re-staging, re-posting and confirming otherwise), reads the line from the marker and prints it before any move to Todo, including a human accept, and offers revise, promote anyway or leave in Backlog.

### From HOW
- [ ] `classifyCriterion` and `parseScenarios` in `admissibility.js` are unchanged (`git diff` shows no edit to either).
- [ ] `faff tier` and `faff admissible --lights-out` print the same output for a spec with and without the admissibility line.
- [ ] `prep-attach.ts` is rebuilt; the committed `.js` emit and `build-manifest.json` match (`node scripts/build-manifest.js check` passes).
- [ ] `docs/guide/cli.md`'s `prep attach` row documents the field, its three keys and the line.
- [ ] A test pins the `admissibility` key set (`admissible`, `reasons`, `scenarios_prose`).
- [ ] `faff validate-adapters` passes; any `faff-prep` baseline change is +1 at most and carries its comment entry.

### Tests
- [ ] The §4.5 cases exist in `test/prep-attach.test.mjs` and `test/spec-producer-scenario-format.test.mjs` and pass under `node --test`; no `--selftest` case is added.
- [ ] The PR diff touches no `commissaire*` file.
- [ ] `faff gates run` passes.

**Integration smoke test:**
```bash
faff prep attach --issue FAFF-9001 --spec <three-bullet spec> --mode interactive --root <tmp> --json
# EXPECT token "ready-to-post", admissibility.admissible false, one "admissibility: refused" line in the spec
```

confidence: high
build-tier: complex
spec-review: accept (human)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. One helper and two result fields in `prep-attach.ts`, format rules in two producer skills, one prep bullet, tests and a docs row. About a day.
- **Workstream fit?** No issues. A quality-in gap on the prep path, sibling to FAFF-1423.
- **Deps surfaced?** FAFF-1423 should build on this ticket: it can refuse autonomous promotion on the same `admissibility` field instead of calling `faff admissible` again. Recommend relating them, with FAFF-1443 first; they should not merge, because FAFF-1423 is a refusal on the autonomous path and this ticket is visibility on every path plus the producer fix. No conflict with open PRs #1169 and #1170.
- **Risk profile?** Low. The new line is advisory and changes no token; the only behaviour change a human sees is a printed line and one offer at promotion.
