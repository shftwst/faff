# FAFF-1243: Spec-review eval cases leave DONE empty, so a strict QA lens is marked wrong for objecting

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1243.

This spec is for the build agent implementing FAFF-1243 and for the humans reviewing it. Twelve `refutation-spec` eval fixtures end their spec with a bare `DONE:` label followed straight by `## Scenarios`, so by faff's own spec grammar they have no DONE section. This ticket gives each of them a real DONE list, turns refutation-spec-006's missing happy path into an expected QA objection, records that oracle change in the oracle triage, and adds a cheap structural test so an empty DONE cannot come back. The Opus re-baseline that follows is operator-owned and stays out of the build.

## 1. WHY

**The idea the rest turns on.** A `refutation-spec` fixture is the spec the four refuter lenses read verbatim (`eval/cli-driver.mjs` `fanRefutationSpec`). Any flaw in the fixture text is a flaw the lenses are entitled to find. An empty DONE is such a flaw: the QA brief (`plugin/skills/faffter-dark-spec-review/refute-qa.md`) asks whether each DONE criterion is decidable, and a spec with no DONE criteria fails that question. So on a case meant to be clean, a strict QA lens that objects is right and the oracle marks it wrong. The fix is in the fixtures, not the lens: give each fixture a DONE list that says only what the spec already says, so the planted flaw (or its absence) is the only thing left to find.

**Problem.**

- Status quo: refutation-spec-005 to 016 end the prose with ` DONE:` and then `## Scenarios`; 011 to 016 then carry a `## Ratified scope` block.
- Pain: GLM 5.3's QA lens raises a blocker for the empty DONE on clean cases (010: 54 of 61 graded runs; 006: 62 of 97; also 005, 011, 013, 015, where it costs 015 most of its points). Opus 5.5 does not, so the committed baseline rewards leniency on a flaw the fixtures never meant to plant.
- Second gap: refutation-spec-006 (password reset) has no scenario asserting that a valid token resets the password. GLM's QA lens objects in 32 further runs; that is a real catch the oracle (`closed_set: []`) marks wrong.
- This change: real DONE lists in 12 fixtures, a QA-expected oracle on 006, the triage and test updates that oracle change requires, and a structural regression test.

### Design principles

**The DONE list adds no guarantee.** Every DONE item restates one scenario the fixture already has, as a pass/fail check. No item states behaviour that is not already in a scenario, so the DONE list cannot repair a planted flaw, add a security property, or open an acceptance gap (a DONE item with no matching scenario, which `refute-qa.md` names as an objection).

**Planted flaws stay exactly as visible as before.** For planted cases the fixture's WHY/WHAT/HOW and scenarios are untouched apart from removing the dangling label; where a scenario asserts the flawed behaviour, its DONE item asserts it too.

**Smallest fixture diff.** Only the tail of each `spec` string changes. The inline `WHY:` / `WHAT:` / `HOW:` labels stay, the `question` field is untouched, and only 006's `oracle` and `_comment` change.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `eval/cases/refutation-spec-005.json` to `-016.json` | JSON | The 12 fixtures with the bare `DONE:` tail |
| `eval/cases/refutation-spec-001.json` to `-004.json` | JSON | Inline `DONE: <text>`; unchanged (decision below) |
| `eval/grader.mjs` `validateCase` (:421-457), `predictedSet` refutation-spec arm (:751-755), `grade` (:885-908) | JavaScript | Oracle grammar (`closed_set` xor `lens_bounds`) and scoring; unchanged |
| `plugin/skills/faffter-dark-spec-review/refute-qa.md` | Markdown | QA brief: born-verifiable DONE, scenario coverage, acceptance gap; unchanged |
| `eval/calibration/oracle-triage.json` (006 entry, `meta.class_counts`, `meta.extensions`, `meta.follow_ups`, `meta.method`) | JSON | 006's triage entry flips from `sound` to `oracle-defect` |
| `test/oracle-triage.test.mjs` (FAFF-615 `resolved_by` test, last test in file) | JavaScript (`node:test`) | Generalised to accept a FAFF-1243 resolution |
| `test/eval-grader.test.mjs` "all eval/cases load and validate" (:740-791) | JavaScript (`node:test`) | Neighbour for the new structural test; case count stays 95 |
| `eval/README.md` re-baseline runbook point 3 (:192-221) | Markdown | One clause: in-place fixture edits also need a `--kind` re-baseline |
| `records/specs/2026-08-03-faff-615-correct-eval-oracles-design.md`, `records/adr/0094-lens-bounds-oracle-shape-for-judgement-eval-closed-set-kinds.md` | Markdown | Precedent for in-place oracle edits, triage `resolved_by`, and closed vs bounded oracles |
| `records/spikes/2026-10-08-glm-5-3-refutation/` (`results.md`, `simulate-faff-1243.jq`) | Markdown, jq | The evidence and the projected effect |

**Scope.** Fixture text and one oracle under `eval/cases/`, the triage artifact and its test, one new structural test, and one README clause. No grader, driver, lens brief or parser change.

## 2. OUT OF SCOPE

- **The Opus refutation-spec re-baseline.** Why: `eval/README.md` :154-156 makes the frontier sweep operator-owned ("no agent session may run it"), and the nlspec DONE rule keeps recording a baseline out of the build. Extension point: the follow-up Human-task ticket in section 4 (Re-baseline hand-off).
- **Changing the QA lens or the refutation parser to accept an empty DONE.** Why: the ticket excludes it; the lens is right. Extension point: `refute-qa.md`, `parse-refutation.mjs`.
- **GLM's infosec lens over-firing on 010.** Why: a model weakness the case exists to catch, not a fixture defect (results.md, "Why spec-006 and spec-010 score near zero", item 3). Extension point: the infosec brief `refute-infosec.md` or a model-specific calibration ticket.
- **Fixtures 001 to 004.** Why: none has an empty DONE (decision below). Extension point: those case files.
- **Adding scenarios or DONE items for HOW constraints no scenario covers** (for example 006's constant-time compare, 010's build-lane-read-only path). Why: that adds guarantees and changes what the lenses weigh; `refute-qa.md` treats a missing regression check for described behaviour as an `observation`. Extension point: the individual case files, as a separate fixture-widening ticket.
- **Adding a happy-path scenario to 006.** Why: the missing happy path is now 006's planted QA gap. Extension point: none intended.
- **A CI guard pinning oracle values or hashing case contents.** Why: the repo deliberately has none (FAFF-615 spec :229). Extension point: `test/eval-grader.test.mjs`.
- **Re-running GLM 5.3.** Why: a paid model run, and the projection is context only. Extension point: `records/spikes/2026-10-08-glm-5-3-refutation/launch.sh`.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Tailed fixture | One of refutation-spec-005 to 016, whose `fixture.spec` contains the exact substring ` DONE:\n## Scenarios` |
| Bare `DONE:` label | A `DONE:` with nothing but spaces or tabs after it on its line |
| DONE section | A line that is exactly `## DONE`, plus every following line up to the next line starting `## ` or the end of the string |
| Checklist item | A line matching `^- \[ \] \S` |

### Fixture shape after the change

```
RECORD tailed fixture spec (after):
  <inline WHY:/WHAT:/HOW: prose, unchanged, ending at the HOW text's last character>
  "\n## Scenarios\n"
  <scenario lines, unchanged>
  "\n\n## DONE\n"
  <checklist items, one per scenario line, joined by "\n">       # exact text in Appendix A
  [ "\n\n## Ratified scope\n" <block, unchanged> ]                # 011 to 016 only
  CONSTRAINT no bare DONE: label anywhere in the string
  CONSTRAINT the DONE section comes after ## Scenarios and before ## Ratified scope
```

- The `## DONE` heading follows the fixture's own `## Scenarios` style (no blank line after the heading).
- The exact DONE items for each of the 12 fixtures are in Appendix A; the builder copies them, it does not write its own.

### refutation-spec-006 oracle and comment

```
oracle:   { "closed_set": ["QA"] }
_comment: "PLANTED QA GAP ON A SOUND SECURITY SPEC (FAFF-1243). The reset design follows best practice on every point (32-byte CSPRNG token, only its SHA-256 hash stored, 15-minute TTL, single-use, constant-time compare, raw token never logged), so infosec must NOT object: the case still tests that a trigger-happy infosec lens does not cry wolf on a sound security-adjacent spec. But neither the scenarios nor the DONE list assert the main behaviour, that a valid unexpired token resets the password, so QA must object above minor (the central behaviour cannot be decided). closed_set [\"QA\"]: exactly QA; an infosec, architectural or methodology objection above minor FAILs the case."
```

### Oracle triage entry for refutation-spec-006

```
RECORD triage entry (refutation-spec-006), fields after the change:
  case_id, kind, grader_shape:  unchanged
  class:          "oracle-defect"                  # was "sound"
  triage_ticket:  "FAFF-319"                       # unchanged: first-author provenance
  resolved_by:    "FAFF-1243"                      # new
  rationale:      must contain "2026-10-08-glm-5-3-refutation"; > 40 chars; unique; no generic-deferral wording
  proposed_fix:   "closed_set [\"QA\"]: QA must object above minor; an infosec, architectural or methodology objection above minor still FAILs, so the case keeps guarding against infosec crying wolf."

RECORD meta.extensions[] (new record):
  ticket:            "FAFF-1243"
  date:              <build date, YYYY-MM-DD>
  source:            "records/spikes/2026-10-08-glm-5-3-refutation/results.md"
  resolved_case_ids: ["refutation-spec-006"]
  note:              one or two sentences: empty DONE fixed in 005-016 (a fixture defect, no oracle change); 006 oracle moved from [] to [QA] for the missing happy path; zero model reps run by this artifact
```

Suggested rationale text (the builder may tighten it but must keep the spike path):

> The GLM 5.3 refutation spike (records/spikes/2026-10-08-glm-5-3-refutation/results.md) showed the closed_set [] oracle marking a real catch wrong: none of 006's scenarios asserts the main behaviour, that a valid unexpired token resets the password, and GLM's QA lens said so in 32 runs beyond its empty-DONE objections. FAFF-1243 keeps that gap planted (the new DONE list mirrors the scenarios and omits the happy path) and makes a QA objection the expected answer, while infosec, architectural and methodology must still stay quiet on a sound reset design.

Other triage meta fields:

- `class_counts`: `sound` 40 to 39, `oracle-defect` 9 to 10.
- `method`: append one clause saying the `resolved_by: "FAFF-1243"` entry was settled against the GLM 5.3 spike captures, still with zero reps run by the artifact.
- `follow_ups.rebaseline_faff_1243`: the follow-up ticket id plus a short description (section 4, Re-baseline hand-off). `paid_model_reps` stays `0`.

### Structural test helper

```
FUNCTION doneSectionProblems(spec) -> list of strings       # local to the test file
  problems = []
  IF spec matches /DONE:[ \t]*(\r?\n|$)/: problems += "bare DONE: label"
  s = index of the first line exactly "## Scenarios"
  IF s exists:
    d = index of the first line exactly "## DONE" after s
    IF d missing: problems += "no ## DONE section after ## Scenarios"
    ELSE:
      section = lines after d up to the next line starting "## " or end
      IF no line in section matches /^- \[ \] \S/: problems += "## DONE section has no checklist item"
      r = index of the first line exactly "## Ratified scope"
      IF r exists AND r < d: problems += "## DONE section comes after ## Ratified scope"
  RETURN problems
```

## 4. HOW

### Fixture edits

```
PROCEDURE fix_tailed_fixture(file, done_items):
  1. Read the file as text. Do NOT re-serialise the JSON: refutation-spec-014.json and
     oracle-triage.json do not round-trip through JSON.stringify(x, null, 2), so a rewrite adds noise.
  2. In the "spec" value, replace the one occurrence of " DONE:\n## Scenarios" (JSON-escaped:
     " DONE:\\n## Scenarios") with "\n## Scenarios" ("\\n## Scenarios").
  3. IF the spec contains "\n\n## Ratified scope":
       insert "\n\n## DONE\n" + join(done_items, "\n") immediately before it
     ELSE:
       append "\n\n## DONE\n" + join(done_items, "\n") at the end of the spec string
  4. Parse the file afterwards and check: no bare DONE: label; doneSectionProblems(spec) is empty.
```

- 006 additionally gets the oracle and `_comment` from section 3.
- No other field changes in any case file.

### How each planted case keeps its flaw

| Case | Planted flaw (from `_comment`) | Why the DONE list does not hide or repair it |
|---|---|---|
| 006 | QA: no happy-path scenario | Items mirror the three scenarios (used or expired token rejected, raw token not logged, reset invalidates sessions); none asserts that a valid token resets the password |
| 007 | infosec: build lane writes the corrective note the orchestrator applies verbatim (forge surface) | Items restate the build-lane write and verbatim apply; no integrity, signature or read-only item |
| 008 | infosec: appetite elevated from a persisted ledger field with no liveness gate | Items restate the three level mappings; no item mentions run liveness |
| 009 | infosec: self-attested `code_blind` | Items restate "evaluator sets true, gate accepts" and "false rejected"; nothing derives blindness from the spawner |
| 012 | infosec: bearer token logged verbatim, unvalidated `lock_id` unlink, no auth | Items restate the two unlink scenarios; no item on logging, validation or auth |
| 014 | infosec: unvalidated `?probe_file` read | Items restate all three scenarios, including the `/etc/hostname` read; no allow-list item |
| 016 | infosec: bearer token logged verbatim, unvalidated `render_path` unlink | Items restate the three scenarios, including the purge unlink; no logging or validation item |

Clean cases (005, 010, 011, 013, 015) get one item per scenario, so every scenario has a DONE item and every DONE item has a scenario: no empty DONE and no acceptance gap for a strict QA lens.

### Oracle triage test

Generalise the last test in `test/oracle-triage.test.mjs` from FAFF-615 only to a small table, keeping every FAFF-615 assertion as strong as today:

```
RESOLUTIONS = {
  "FAFF-615":  /20260803-012238/,                      # the operator sweep run id (unchanged)
  "FAFF-1243": /2026-10-08-glm-5-3-refutation/,        # the GLM 5.3 spike record
}
TEST "FAFF-615/FAFF-1243 resolved_by names a known resolution, cites its evidence, and matches that extension's case list exactly":
  FOR ticket in RESOLUTIONS:
    rec = meta.extensions record with this ticket      # must exist
    ASSERT rec.resolved_case_ids is a non-empty list
  FOR entry with resolved_by != null:
    ASSERT resolved_by is a key of RESOLUTIONS
    ASSERT entry.rationale matches RESOLUTIONS[resolved_by]
  FOR ticket in RESOLUTIONS:
    ASSERT { entries with resolved_by == ticket } == set(rec.resolved_case_ids)   # both directions
```

- The `triage_ticket` allowlist test does not change: 006 keeps `triage_ticket: "FAFF-319"`.
- Update the comment above the test to say FAFF-1243 added the second resolution.

### Structural regression test

In `test/eval-grader.test.mjs`, directly after "all eval/cases load and validate", add one test with the `doneSectionProblems` helper from section 3:

1. Negative controls: the helper reports problems for `"WHY: x. DONE:\n## Scenarios\n- y"` (bare label and no DONE section) and for `"WHY: x.\n## Scenarios\n- y\n\n## DONE\n\n## Ratified scope"` (no checklist item).
2. Positive control: it reports none for `"WHY: x.\n## Scenarios\n- y\n\n## DONE\n- [ ] y holds"`.
3. Over `loadCases()` filtered to `kind === "refutation-spec"`: every case's `doneSectionProblems(c.fixture.spec)` is empty (report the case id and problems on failure), and at least 12 cases contain a `## Scenarios` line, so the check cannot pass vacuously.

The case count assertion (95) does not change: no case is added or removed.

### README clause

`eval/README.md` runbook point 3, the sentence starting "When a change moves the *scoring* of a couple of kinds without touching any case id (correcting an oracle, like FAFF-615)": extend the parenthesis to "(correcting an oracle, like FAFF-615, or editing a fixture's text in place, like FAFF-1243)". `--resume` cannot see in-place text edits either, so the same `--kind` advice applies. No other doc lists the cases or the fixture layout (checked: `eval/README.md` :39 gives only the count, which is unchanged).

### Re-baseline hand-off

The committed `eval/baselines/frontier.json` `per_kind["refutation-spec"]` row (accuracy 0.904, captured 2026-10-05) is stale from the moment this merges: the prompt text of 12 cases and one oracle changed. It stays stale until the operator re-runs it, as FAFF-615 was followed by FAFF-711.

The follow-up is the existing FAFF-937, not a new ticket. FAFF-937 is the same scoped `--kind refutation-spec` re-baseline, still pending for fixtures 015 and 016, which this ticket edits; a second ticket would pay for the same sweep twice. At prep, FAFF-937 was made blocked by FAFF-1243 and FAFF-1236, labelled Human-task, and given a comment carrying the hand-off below. The build records FAFF-937 in `meta.follow_ups.rebaseline_faff_1243` and links it in the PR body.

- **Ticket:** FAFF-937 (faff, Tech, Human-task). Not automation-eligible.
- **Hand-off (posted on FAFF-937):**
  - Why: FAFF-1243 edited 12 refutation-spec fixtures in place (real DONE lists) and moved refutation-spec-006's oracle to `closed_set: ["QA"]`. The committed `refutation-spec` row in `eval/baselines/frontier.json` predates both.
  - Preconditions: FAFF-1236's measurement has run first, against `main` at the commit before FAFF-1243 merged (otherwise its diff mixes the severity-sentence effect with these fixture edits); FAFF-1243 merged on `main`; a plain terminal, never under `claude -p` (`eval/README.md` runbook point 1); the run prints model `claude-opus-5-5` and effort `medium`, matching `frontier.json` `meta`.
  - Command: `node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json --kind refutation-spec`. Start fresh; use `--resume` only to continue this same run after an interruption, never a scoped progress file from before FAFF-1243.
  - Cost: 16 cases, 20 base reps escalating to 50, four lens calls per rep: about 1,280 to 3,200 `claude -p` calls.
  - Done when: only the `refutation-spec` row of `frontier.json` changes; the commit records the run id; the PR notes refutation-spec-006's per-case score from `judgements.jsonl`.
  - Expected direction, context only and not a gate: GLM high projected to about 0.82 on spec review; Opus may lose 006 under the new oracle (about 0.84 overall at worst). If Opus's QA lens rates the missing happy path minor or below in most reps, file a follow-up to decide between sharpening 006's plant and reverting its oracle, rather than editing this row by hand.

### Edge cases

- 005's scenario block ends with the plain line "Unit test in test/eligible.test.mjs mirroring next's --json test."; the DONE section goes after that line, and that line gets its own DONE item.
- 011 and 013 share identical spec prose up to the Ratified scope block; their DONE lists are identical too.
- The bare-label regex also matches `DONE:` at the very end of the string, so a fixture truncated after the label still fails.
- 001 to 004 pass the structural test unchanged: none has a `## Scenarios` line, and each `DONE:` has text after it on the same line.

### Failure modes

- **The DONE list becomes a new objection target.** A lens might object to the mixed inline-label plus heading layout, or QA might claim a HOW constraint has no DONE item. How you'd know: in the re-baseline `judgements.jsonl`, above-minor objections on clean cases whose `spec_anchor` is `done` or whose claim cites the DONE list. What it means: narrow; adjust the wording in a follow-up. An empty DONE is still the worse fixture.
- **Opus's QA lens treats 006's missing happy path as minor.** `refute-qa.md` reserves `major` for a main behaviour no test can decide, and a lens may read "reset invalidates sessions" as implying a reset happened. How you'd know: the re-baseline gives 006 a low score with QA objections at `minor` or `observation`. What it means: the plant is too subtle for the calibrated brief; the follow-up decides between sharpening the plant and reverting the oracle. It does not invalidate the empty-DONE fix.
- **The GLM projection does not hold.** The projection re-scores old runs on the old prompt text. How you'd know: a future GLM run on the new fixtures. What it means: context only; nothing in this build depends on it.

**Anti-pattern:** writing DONE items that state what a correct design would guarantee (for example "the token is compared in constant time" on 006, or "the path is validated" on 014). Why: on clean cases it adds guarantees and acceptance gaps; on planted cases it repairs or hides the flaw.

**Anti-pattern:** re-serialising case files with `JSON.stringify`. Why: 014 and the triage artifact do not round-trip, so the diff would bury the real change.

## Scenarios

```
Given the 16 refutation-spec case files after the change
When the new structural test in test/eval-grader.test.mjs runs
Then doneSectionProblems returns no problems for every case
And at least 12 cases contain a "## Scenarios" line
```

```
Given the spec "WHY: x. DONE:\n## Scenarios\n- y"
When doneSectionProblems runs
Then it reports both "bare DONE: label" and "no ## DONE section after ## Scenarios"
```

```
Given refutation-spec-006 loaded from eval/cases
When grade() runs with objections [{lens:"QA", severity:"major"}]
Then it returns PASS
And with [{lens:"QA", severity:"major"}, {lens:"infosec", severity:"major"}] it returns FAIL
And with [] it returns FAIL
```

```
Given oracle-triage.json with 006 resolved_by "FAFF-1243" and a FAFF-1243 extension record listing only refutation-spec-006
When test/oracle-triage.test.mjs runs
Then every test passes
And removing refutation-spec-006 from that record's resolved_case_ids makes the resolved_by test fail
```

- Every DONE item in Appendix A restates a scenario of the same fixture; none states a security property, validation step or happy path that the fixture's scenarios do not.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Where the DONE section goes | Fill the inline `DONE:` label with text; a `## DONE` section after `## Scenarios` | **Chosen:** `## DONE` after `## Scenarios`, before `## Ratified scope` |
| What the DONE items say | Mirror the scenarios; mirror scenarios plus HOW constraints; a full house-style `### From WHY/WHAT/HOW` list | **Chosen:** one item per existing scenario line, nothing else |
| Inline `WHY:` / `WHAT:` / `HOW:` labels | Keep; convert to headings | **Chosen:** keep |
| Fixtures 001 to 004 | Convert to the same layout; leave | **Chosen:** leave unchanged |
| 006 oracle shape | `lens_bounds { must_object: [QA] }`; `closed_set: ["QA"]` | **Chosen:** `closed_set: ["QA"]` |
| 006 tolerated extra lenses | Allow architectural and methodology in `may_object`; none | **Chosen:** none |
| Triage record for 006 | Leave `sound`; flip to `oracle-defect` with `resolved_by: "FAFF-1243"` and generalise the FAFF-615 test | **Chosen:** flip and generalise |
| Structural test | A new test file; one test beside the case-load test in `test/eval-grader.test.mjs` | **Chosen:** beside the case-load test |
| Docs | No change; one clause in the runbook | **Chosen:** one clause in `eval/README.md` runbook point 3 |
| Re-baseline | Run it in the build; hand it to the operator via a follow-up ticket | **Chosen:** operator follow-up ticket, id recorded in `meta.follow_ups` |

**DONE placement.** The house layout puts Scenarios before DONE (`faffter-dark-nlspec` sections 5 and 8; FAFF-1238's spec), and `refute-qa.md` checks decidable DONE items, not numbering, so a plain `## DONE` heading suffices. Filling the inline label instead would leave DONE before the scenarios it should mirror and keep the fixtures out of the house layout the ticket asks for.

**Mirror the scenarios only.** It makes "adds no guarantee" and "does not repair the plant" true by construction rather than by judgement, and it closes the acceptance-gap question both ways. Adding HOW constraints would put DONE items with no scenario on every clean case, which `refute-qa.md` lists as an objection, and on planted cases it invites wording that hides the flaw. A full `### From ...` list is heavier than a fixture needs and changes more prompt text.

**Inline labels stay.** Minimal diff: only the tail changes, which keeps the before and after comparison about DONE alone. 001 to 004 use the same inline labels, so the corpus stays consistent.

**001 to 004 stay.** 001 and 002 have a non-empty inline DONE. 003's spec must keep its verbatim `## Methodology critique` block (FAFF-731), and its inline DONE is not empty. 004's vague DONE ("feels clearer") is its planted QA flaw and must not be fixed. None of them has the defect this ticket fixes.

**`closed_set: ["QA"]` over `lens_bounds`.** Both grade identically here (with no `may_object`, the lens_bounds check reduces to set equality). ADR-0094's consequences keep `closed_set` "wherever a case genuinely has one exact answer" and reserve `lens_bounds` for cases where extra objections are legitimate; 004, the other single-lens QA plant, uses `closed_set: ["QA"]`; and the 006 triage entry's `grader_shape` ("closed-set: ...") stays accurate. This departs from the orchestrator's suggested `lens_bounds` shape for those reasons; the behaviour is the same.

**No tolerated extras.** 006's purpose is that infosec must not cry wolf, and ADR-0094 warns that a lazy `may_object` neuters the over-firing guard. The spec is a sound, right-sized design with no methodology critique attached, so there is no grounded architectural or methodology objection to tolerate. FAFF-615 made the same call for 004 (spec :211): keeping it strict costs at most a low score in the re-baseline, which is visible and recoverable; widening wrongly blinds the case for good.

**Triage flip.** The triage test requires every case to be classed, and 006's current `sound` rationale says `[]` is correct, which is now false. FAFF-615 set the pattern: class `oracle-defect` with `proposed_fix`, `triage_ticket` kept at first-author provenance, `resolved_by` naming the resolving ticket, and an extension record whose case list the test pins both ways. Generalising the test to a table keeps that anchor for each resolution instead of loosening it to "any FAFF ticket".

**Structural test beside the case-load test.** `test/eval-grader.test.mjs` already imports `loadCases` and owns disk-case validation; one more test there needs no new file or import. The negative controls and the at-least-12 floor stop it passing vacuously.

**Runbook clause.** The operator's follow-up runs this exact runbook, and point 3 currently justifies `--kind` by oracle-only changes. One clause makes the runbook cover in-place fixture edits without adding a section.

**Re-baseline as a follow-up.** `eval/README.md` :154-156 forbids any agent session from running the sweep; FAFF-615 and FAFF-731 left it to the operator; FAFF-615's methodology critique asked for the follow-up to be a tracked ticket rather than prose. Recording the id in `meta.follow_ups` matches how FAFF-711 is recorded there.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** the GLM 5.3 numbers quoted here (about 0.82 high, about 0.71 low, 006 rising from 2% to about 40% at high effort) are a simulation: `simulate-faff-1243.jq` re-scores the 2026-10-08 runs on the old prompt text by dropping empty-DONE QA objections and requiring exactly QA on 006. The real effect on GLM and on Opus is only known after a re-run on the new fixtures. Validation: none needed for the build; nothing in DONE depends on these numbers.
- **Assumes:** FAFF-937 stays open and unstarted until FAFF-1243 merges. Validation: graft checks FAFF-937's status before opening the PR; if it was run and closed in the meantime, graft files a new Human-task ticket with the same hand-off text instead.

## 8. DONE

### From WHY
- [ ] No `eval/cases/refutation-spec-*.json` `fixture.spec` contains a bare `DONE:` label (regex `/DONE:[ \t]*(\r?\n|$)/` matches nothing)
- [ ] refutation-spec-005 to 016 each have a `## DONE` section after `## Scenarios` whose items are exactly the Appendix A text for that case
- [ ] In 011 to 016 the `## DONE` section ends before `## Ratified scope`, and the Ratified scope block is byte-identical to before

### From WHAT
- [ ] refutation-spec-006's `oracle` is `{"closed_set": ["QA"]}` and its `_comment` is the section 3 text; its `question` and the rest of its spec are unchanged apart from the tail edit
- [ ] refutation-spec-001 to 004 are byte-identical to before
- [ ] In every case file only `fixture.spec` changes (plus `oracle` and `_comment` on 006); `git diff` shows no reformatting of other lines
- [ ] `oracle-triage.json`: 006 has `class: "oracle-defect"`, `triage_ticket: "FAFF-319"`, `resolved_by: "FAFF-1243"`, a `proposed_fix`, and a rationale citing `2026-10-08-glm-5-3-refutation`; `meta.extensions` has a FAFF-1243 record with `resolved_case_ids: ["refutation-spec-006"]`; `class_counts` reads `sound: 39`, `oracle-defect: 10`; `meta.method` mentions the FAFF-1243 resolution; `meta.follow_ups.rebaseline_faff_1243` names the follow-up ticket id; `paid_model_reps` is `0`

### From HOW
- [ ] The resolved_by test in `test/oracle-triage.test.mjs` is table-driven over FAFF-615 and FAFF-1243 as in section 4, and it fails if refutation-spec-006 is removed from the FAFF-1243 record (checked by hand once and noted in the PR)
- [ ] `test/eval-grader.test.mjs` has the structural test with both negative controls, the positive control, the all-cases check and the at-least-12 floor; the case-count assertion still reads 95
- [ ] `grade()` on refutation-spec-006 returns PASS for `[QA major]`, FAIL for `[QA major, infosec major]`, FAIL for `[]` (command and output in the PR body)
- [ ] `eval/README.md` runbook point 3 carries the FAFF-1243 clause
- [ ] `node --test test/eval-grader.test.mjs test/oracle-triage.test.mjs test/eval-readme-freshness.test.mjs` passes, and no eval that calls a model was run
- [ ] FAFF-937 is open, blocked by FAFF-1243 and FAFF-1236, carries the section 4 hand-off comment, and is linked in the PR body and in `meta.follow_ups.rebaseline_faff_1243`

### Integration smoke test

```
1. node --test test/eval-grader.test.mjs test/oracle-triage.test.mjs        -> all pass
2. node --input-type=module -e: loadCases() -> filter kind refutation-spec -> print id + doneSectionProblems(spec)
                                                                             -> 16 lines, every list empty
3. node --input-type=module -e: grade(case006, {objections:[{lens:"QA",severity:"major"}]})
                                                                             -> PASS
4. git diff --stat eval/cases                                                -> exactly 12 files changed (005 to 016)
```

## Appendix A: exact DONE items per fixture

Each block is the text inserted after `## DONE\n`. Backticks and quotes are literal fixture text; JSON-escape the double quotes when editing.

**refutation-spec-005** (clean)
```
- [ ] `faff eligible --label faff-automate --json` prints {"eligible":true}
- [ ] `faff eligible` with an unknown flag exits 2
- [ ] test/eligible.test.mjs has a --json test mirroring next's --json test, and it passes
```

**refutation-spec-006** (planted QA gap: no happy path)
```
- [ ] A used token is rejected, and a token past its 15-minute TTL is rejected
- [ ] A test asserts that the raw token never appears in logs
- [ ] A reset invalidates the user's existing sessions
```

**refutation-spec-007** (planted infosec)
```
- [ ] A corrective note the build lane writes to `.faff/runs/<run-id>/<issue>/corrective-note.json` is read by the orchestrator at the next dispatch boundary and its correction applied verbatim on re-dispatch
- [ ] An absent corrective note is a no-op on re-dispatch
```

**refutation-spec-008** (planted infosec)
```
- [ ] A ledger at `$FAFF_RUN_DIR/run-ledger.json` with `owner.level: L4` yields `appetite: full`
- [ ] A ledger with `owner.level: L3` yields `appetite: high`
- [ ] A missing ledger yields `appetite: high`
```

**refutation-spec-009** (planted infosec)
```
- [ ] A verdict the evaluator emits with `code_blind: true` is accepted by the merge gate as code-blind
- [ ] A verdict with `code_blind: false` is rejected by the merge gate
```

**refutation-spec-010** (clean)
```
- [ ] A correction the build lane returns on its terminal token is recorded by the orchestrator to `.faff/runs/<run-id>/<issue>/corrective-note.json`, and the integrity probe gates its consumption
- [ ] An unasserted integrity boundary degrades to reconcile-only, and the correction is not applied
- [ ] An absent note is a no-op
```

**refutation-spec-011** and **refutation-spec-013** (clean; identical)
```
- [ ] A healthy process (self-check passed within the interval) returns `{status:"ok", region:<REGION>}` with HTTP 200
- [ ] An unhealthy process (self-check failed or stale) returns `{status:"degraded", region:<REGION>}` with HTTP 503
- [ ] A process started with an empty or unset `REGION` refuses to start and never serves `/health`
```

**refutation-spec-012** (planted infosec)
```
- [ ] A POST to `/admin/reset-lock` with a known `lock_id` unlinks `.faff/locks/<lock_id>` and returns 200
- [ ] A POST for an absent lock is a no-op and returns 200
```

**refutation-spec-014** (planted infosec)
```
- [ ] A healthy process returns `{status:"ok", region:<REGION>}` with HTTP 200
- [ ] An unhealthy process returns `{status:"degraded", region:<REGION>}` with HTTP 503
- [ ] A request with `?probe_file=/etc/hostname` returns that file's contents in the `probe` field
```

**refutation-spec-015** (clean)
```
- [ ] `GET /abc123` for a stored code returns a 302 redirect to the stored destination
- [ ] `GET /abc123` for an unknown code returns 404
- [ ] A code failing the `^[A-Za-z0-9]{1,12}$` allow-list returns 404 without a store lookup
```

**refutation-spec-016** (planted infosec)
```
- [ ] `GET /abc123` for a stored code returns a 302 redirect to the stored destination
- [ ] `GET /abc123` for an unknown code returns 404
- [ ] `POST /admin/purge` with a `render_path` unlinks that cached render and returns 200
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** No issues. About one day: tail edits to 12 fixtures, one oracle, one triage entry, two tests, one README clause. The 006 oracle change edits the same fixture tail and rides the same operator re-baseline, so splitting it would cost a second 1,280 to 3,200-call sweep for no earlier value.
- **Workstream fit (P1 + P5):** No issues. Project-less default landing; the outcome is in the title.
- **Surfaced dependencies (P6):** three gaps, all closed at prep.
  - FAFF-878's acceptance said 006 stays quiet and "do not change the established oracles". Linked as related, blocked by FAFF-937, with a comment recording that 006 now expects exactly QA (an answer correction the operator agreed, not score-tuning) and 010 must still stay quiet.
  - FAFF-937 was already the same scoped `--kind refutation-spec` re-baseline (pending for 015/016, which this ticket edits). Reused as the follow-up instead of filing a duplicate: blocked by FAFF-1243 and FAFF-1236, labelled Human-task, hand-off posted as a comment. Section 4 and DONE now name FAFF-937.
  - FAFF-1236 diffs a scoped Opus run against the current frontier row; run after this merges, its result would mix the severity-sentence effect with these fixture edits. FAFF-937 is blocked by FAFF-1236, and the hand-off says FAFF-1236 runs against `main` at the commit before FAFF-1243 merged.
  - FAFF-1240, FAFF-1204 and FAFF-1239 are independent.
- **Risk profile (P7):** the 006 oracle risk lands after merge. If Opus's QA lens rates the missing happy path minor, `main` carries an oracle Opus fails until a follow-up. Mitigation, operator-owned and optional: a scoped `node eval/run-evals.mjs --driver frontier --only refutation-spec-006` (no `--update-baseline`, about 80 to 200 calls) before the full sweep; recorded in the FAFF-937 hand-off. The empty-DONE fix itself is low risk.

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
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
