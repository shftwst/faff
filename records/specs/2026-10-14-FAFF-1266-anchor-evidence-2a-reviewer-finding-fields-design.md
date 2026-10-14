# Reviewer finding fields, one finding_id helper, and the title-stability eval (FAFF-1266)

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1266.

This spec is for the build agent picking up FAFF-1266, slice 2a of the FAFF-1257 split under FAFF-1255, and for its reviewers. It narrows the approved FAFF-1257 design to three things: the two code reviewers emit `title`, `location` and `action` per finding, one pure helper computes a finding's cross-round identity, and a live eval measures whether that identity holds between two independent review passes. FAFF-1268 (2b, the code-review collator) ships only if this eval clears its bar, so the eval's mechanics and its recorded result are specified exactly.

## 1. WHY

**The idea the rest depends on.** The 2b collator merges code-review findings across rounds by `finding_id = <file>::<normalised title>`. That only works if a reviewer gives the same defect the same title on two independent passes. This slice gives the identity rule one code home, makes both reviewers emit the fields it reads, and measures title stability on fixtures before anything is built on top of it.

**Problem.** Today the reviewers' `faff-contract:review-verdict` blocks carry only `location_present` and `action_present` per finding, so nothing machine-readable names a finding. The identity rule exists only as prose (`faffter-dark-adversarial-review/SKILL.md` "the `escalated_criticals[]` additive block", `faff-graft/SKILL.md` Step 9 dialogue item 1), and the graft agent derives `finding_id` by hand for the build-review dialogue records that `build-review-churn.js`, `build-review-convergence.js` and `build-judge-evidence.js` read. After this slice the rule is one function, the readers use it, and there is a measured answer to "are titles stable enough to merge on?"

### Design principles

- **Additive to every gate.** `faff contract review-verdict` keeps ignoring the new keys (verified: `computeReviewVerdict` builds each finding from known keys only, exit 0 with `title`/`location`/`action` present). `faff merge-gate`, the review floor and the dialogue loop's termination behave the same for any record whose stored `finding_id` already follows the rule. The one deliberate change: a critical with neither a title nor a stored id now counts as standing instead of being ignored.
- **Measure before merging on it.** Nothing in this slice merges findings. The eval is the gate for FAFF-1268.
- **2a ships whole whatever the eval says.** The fields and the helper have consumers here (the eval and the dialogue readers), so a below-bar result withholds 2b's collator, not this slice. This settles FAFF-1257 round-1 objection 5 (a half-landed producer change on an eval park).

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-review/SKILL.md` "Contract artifact", `## Findings` heading shape | Markdown | Gains `title`, `location`, `action`; frontmatter `judgement_seam` gains the new KIND |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` "Contract artifact", "the `escalated_criticals[]` additive block" | Markdown | Gains the same fields on Phase-1 and folded Phase-2 findings; its prose identity rule points at the helper |
| `bin/lib/build-review-churn.js` `standingCriticalIds` (region factory) | CJS JS | Reads `finding_id`; reused by `build-review-convergence.js` |
| `bin/lib/build-judge-evidence.js` `collectAdjudicationSet`, `findLastKnownFinding`, `latestRebuttalFor` (region factory) | CJS JS | Reads `finding_id` and `author_replies[].finding_ref`; feeds `build-judge-casefile.js` |
| `bin/lib/build-judge-casefile.js` `assembleBuildCaseFiles` (region factory) | CJS JS | Derives the diff file with `location.split(":")[0]` |
| `bin/lib/contract-defs.js` `computeReviewVerdict` | CJS JS | Ignores the new keys; unchanged here (2b adds pass-through) |
| `faff-graft/SKILL.md` Step 9 dialogue item 1 (line ~498) | Markdown | Hand-derivation sentence replaced; line-neutral |
| `eval/run-live-evals.mjs` `LIVE_KINDS`, `runLiveCase`, `main` | ESM JS | Gains the `finding-identity` adapter, a per-rep `detail` carry and `--model`/`--effort` |
| `eval/live-driver.mjs` `makeLiveDriver`, `makeLiveModel`, `driveVerdictBuildCase` | ESM JS | Template for the new driver; `makeLiveModel` spawns one isolated `claude -p` per call |
| `eval/cli-driver.mjs` `loadReviewVerdictProse`, `VERDICT_BUILD_INSTRUCTION` | ESM JS | Template for the new rubric loader and instruction |
| `eval/grader.mjs` `KINDS`, `CLOSED_SET_KINDS`, `predictedSet`; `eval/seam-registry.json` | ESM JS, JSON | KIND and registry row |
| `eval/run-evals.mjs` `resolveEvalModel`, `resolveEffort`, `aggregateKind` | ESM JS | Model and effort pinning; per-kind accuracy is the mean of case accuracies |
| `eval/README.md` "Re-baseline runbook" point 1, ADR-0004 | Markdown | A `claude -p` eval never runs nested in an agent session |

**Scope.** This slice sits at the reviewer output and the dialogue-loop readers; the run dir, anchors, writers and merge gate are untouched.

## Already shipped against this surface

- **FAFF-996** (Done): the build-review dialogue loop, its `finding_id` prose rule, and the churn, convergence and judge readers. This slice gives that rule one code home; it does not change the loop's rules.
- **FAFF-1146** (Done): per-finding `severity`, `disposition`, `source`, `refutation`, `model`. The new fields sit beside them under the same optional, non-gating posture.
- **FAFF-155** (Done): the `verdict-build` live-driver lane over `faffter-noon-review`. The new eval reuses its driver core, runner and case layout.

None of these delivers the premise; it still holds.

## 2. OUT OF SCOPE

- **Recording review rounds, the code-review collator, `review-verdict.json` and `ac-checklist.json` writers, the review normaliser pass-through.** Why: FAFF-1268 (2b), gated on this eval. Extension point: 2b requires `bin/lib/finding-id.js` (`assignFindingIds`) from its collator.
- **Spec-review collation, the carried comment and digest.** Why: FAFF-1267 (2c). Extension point: none needed from this slice.
- **Measuring Phase-2 titles of `faffter-dark-adversarial-review`.** Why: this repo's `review` slot is `faffter-dark-adversarial-review`, but its Phase 1 is delegated to `faffter-noon-review` (its SKILL, "Phase 1: Standard review"), so the eval measures Phase 1 exactly. Phase 2 runs only after a Phase-1 `pass`, which ends Step 9 outside the autonomous dialogue loop, so a Phase-2 finding reaches more than one recorded round only inside that loop, whose ids are already title-derived today. Extension point: a second `LIVE_KINDS` entry driving `review-call.mjs` with the Phase-2 prompt over the same fixtures; see the assumption in section 7.
- **Changing what the dialogue loop treats as churn or convergence.** Why: FAFF-996's semantics stand; only where the id comes from changes.
- **Adding the new KIND to the frontier baseline gate (`eval/baselines/frontier.json`).** Why: a live-lane KIND has no black-box cases, like `verdict-build`. Extension point: a later live-baseline ticket.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Finding id | `findingId(finding, round, index)`: the cross-round identity of a code-review finding |
| Pass | One independent reviewer run over a fixture: its own `claude -p` process with a fresh config dir and no shared context |
| Defect finding | In one pass, the finding the eval compares: the highest-severity finding whose normalised path equals the fixture's `defect_file` |
| Stable fixture | Both passes produce a defect finding and the two ids are equal |

### Finding identity

```
MODULE bin/lib/finding-id.js        # region:governance, pure, requires nothing
  FUNCTION normaliseFindingPath(location) -> String
    1. Not a string or blank -> ""
    2. Trim; keep the text before the first whitespace
    3. Replace "\" with "/"; strip one leading "./"; then strip one leading "a/" or "b/" (git diff prefix)
    4. Cut at the first ":" that is followed by a digit (drops ":12", ":12-20", ":12:5")
  FUNCTION normaliseFindingTitle(title) -> String
    1. Not a string -> ""
    2. Replace every C0/C1 control character (U+0000-U+001F, U+007F-U+009F) with a space; remove backticks;
       lowercase; collapse whitespace runs to one space; trim
    3. Strip trailing ".", ":" or ";"
  FUNCTION findingId(finding, round, index) -> String
    file = normaliseFindingPath(finding.location); title = normaliseFindingTitle(finding.title)
    IF title AND file -> file + "::" + title
    IF title          -> "nolocation::" + title
    ELSE              -> "round-" + round + "#" + index          # never merges
  FUNCTION assignFindingIds(findings, round) -> List<String>     # same order as findings
    ids = findingId for each (finding, round, i)
    a later duplicate of an earlier id in the same list gets "#2", "#3", ... in input order
  FUNCTION readerFindingIds(findings, round) -> List<{ id: String, stored: String | null }>   # the dialogue readers' accessor
    base_i = findingId(f, round, i)       IF normaliseFindingTitle(f.title) non-empty
           = f.finding_id                 ELIF f.finding_id is a non-empty string
           = "round-" + round + "#" + i   ELSE                                  # never null
    ids = the base ids with the same "#2", "#3" suffixing as assignFindingIds
    stored = f.finding_id when it is a non-empty string, else null              # the alias a reply may cite
```

**Chosen:** a new module `bin/lib/finding-id.js` in `region:governance`. Why: the 2b collator lives in governance and the dialogue readers are factory; factory requiring governance is the legal direction for `faff regions check`, and a module of its own means neither FAFF-1267 nor FAFF-1268 has to own it. The FAFF-1257 note that "whichever of 2b or 2c lands first creates `evidence-collate.js`" is unchanged; that module requires this one.

**Chosen:** the path normaliser strips a git-diff `a/`/`b/` prefix and the title normaliser drops backticks and trailing punctuation, beyond the prose rule. Why: reviewers read unified diffs (`diff --git a/x b/x`) and wrap identifiers in backticks inconsistently; both are drift sources the eval would otherwise charge to the model. Every existing fixture id (`foo.js::t`, `a.js::x`, `spec-judge-casefile.js::admitrollup untouched`) is unchanged by the extra steps.

### Reviewer contract fields

Both review occupants add three optional strings per finding in their `faff-contract:review-verdict` block:

```
RECORD FindingFields (added beside location_present, action_present, severity, ...):
  title?: String      # the [title] part of the finding's "### [category]: [title]" heading, without the category
  location?: String   # "path[:line]", the file the defect is in; omitted when the finding names no file
  action?: String     # the concrete fix, one sentence; omitted when there is none
  CONSTRAINT location_present == (location is present); action_present == (action is present)
```

Title guidance both SKILLs state once, beside the field: name the defect and the symbol it is in, in a short noun phrase; no line numbers, severity words or category. `location` names the file as it appears in the repo, not the diff header. In `faffter-dark-adversarial-review` this applies to Phase-1 findings and folded Phase-2 findings alike; `escalated_criticals[]` keeps its shape. Its sentence "graft derives `finding_id` from them (...)" becomes a pointer: `finding_id` is computed by `findingId` in `bin/lib/finding-id.js`.

### Dialogue-loop readers

| Reader | Change |
|---|---|
| `build-review-churn.js` `standingCriticalIds(findings, round)` (and through it `build-review-convergence.js` and `computeCriticalFreeLatestFloor`) | Identity of each critical finding is its `readerFindingIds(findings, round)` id. `computeChurn(prev, curr, prevRoundNumber)` gains an optional fourth argument `currRoundNumber`, which the CLI fills from `roundNumberFromPath(currPath)`; when a round number is absent (existing direct callers and tests), the round token is the literal `prev` or `curr`, which keeps the two rounds' fallback ids distinct. `build-review-convergence.js` passes each record's 1-based position, and `computeCriticalFreeLatestFloor` the latest file's number |
| `build-judge-evidence.js` `collectAdjudicationSet`, `findLastKnownFinding`, the `reappearedLater` check | Compare findings by their `readerFindingIds` id; the emitted adjudication entries carry that id as `finding_id` |
| `build-judge-evidence.js` `latestRebuttalFor` and the withdrawal scan | A reply's `finding_ref` matches a finding when it equals the finding's reader id or its `stored` alias, so a reply written against a hand-derived id still reaches its finding |
| `build-judge-casefile.js` `assembleBuildCaseFiles` | The diff file for `extractDiffForFile` is `normaliseFindingPath(location)` instead of `location.split(":")[0]` |

`faff-graft/SKILL.md` Step 9 dialogue item 1 changes in place (line-neutral): round records keep each escalated critical's `location` and `title` from `escalated_criticals[]`; `finding_id` is computed by the readers with `readerFindingIds`; an author reply's `finding_ref` copies an id from the `curr_critical_ids` that `faff build-review-churn` printed for that round.

**Chosen:** readers recompute the id from `title` and `location` when a title is present, fall back to the stored `finding_id`, and otherwise give the finding a round-scoped id that never matches another round. Why: a hand-derived id that drifts from the rule is the failure FAFF-1257 named ("agent-computed ids drift with the agent"); the stored fallback keeps every existing round record and test fixture working unchanged; and an id is never null, so an untitled, id-less critical always counts as standing. Today such a critical contributes nothing to `standingCriticalIds`, so `computeCriticalFreeLatestFloor` reads it as critical-free: a fail-open this change closes. The round-scoped id makes `faff build-review-churn` report churn when that finding recurs, which stops the loop and sends it to the judge or a park: the safe direction.

**Chosen:** the readers apply the same-round `#k` suffixing as `assignFindingIds`. Why: two distinct criticals in one round that normalise to the same file and title must stay two standing criticals and two case files; collapsing them would undercount the standing set and let one rebuttal stand for both.

This switch does not depend on the eval. The dialogue loop already keys on ids derived from the same titles by the same rule; only who computes them moves from the agent to code, so title stability affects the loop identically before and after.

### The title-stability eval

**Chosen:** a live-lane KIND, `finding-identity`, on surface `faffter-noon-review`, run by `eval/run-live-evals.mjs`. Why: it is the existing runner for multi-input fixtures over the real review rubric (`verdict-build` precedent), it already isolates each `claude -p` call, and its per-kind accuracy is exactly the share of stable fixtures when each case runs one rep.

Fixture layout, one file per fixture:

```
FILE eval/cases-live/finding-identity-<NNN>.json      # NNN = 001..; at least 10 files
RECORD FindingIdentityCase:
  id: "finding-identity-<NNN>"
  kind: "finding-identity"
  reps: 1                           # one rep = one pair of passes; never escalates
  note: String                      # the planted defect and why it is unambiguous
  question: String
  fixture:
    version: 1
    change_summary, spec, diff, test_results: String   # the BuildFixture fields verdict-build uses
    diff_b?: String                 # optional second-pass diff: the same defect with an unrelated hunk added above it
    defect_file: String             # repo-relative path of the one planted defect
  oracle: { closed_set: ["stable"] }
  CONSTRAINT the diff touches at least two files; the defect sits in defect_file only
  CONSTRAINT at least 3 cases carry diff_b
```

Fixture mix: one planted defect each, spread across the review passes (a missed AC, an off-by-one, a wrong exit code, an unhandled error path, an unvalidated path argument, a secret written to a log, scope creep, a missing test for a stated AC, a wrong comparison, an unreleased resource). `diff_b` mimics a later round that did not touch the defect: line numbers shift and context grows.

The measured surface is `faffter-noon-review`, which is also Phase 1 of `faffter-dark-adversarial-review`, this repo's configured `review` slot.

How one rep runs:

```
PROCEDURE driveFindingIdentityCase(case, ctx):                 # eval/live-driver.mjs
  1. pass A: runSkill({skill: "faff-graft", driver: findingIdentityLiveDriver(model, fixture with diff)})
  2. pass B: the same with diff_b when present, else diff; a second runSkill call, so a second
     makeLiveModel spawn with its own mkdtemp CLAUDE_CONFIG_DIR and empty working directory;
     nothing from pass A is passed in. The prompt builder is a pure function of (fixture, pluginDir,
     caseId) and ignores the harness tracker, and makeLiveDriver only reads the tracker (listIssues)
     and writes DecisionRecord buckets, so no pass can observe another through shared harness state
  3. each pass's envelope: { case_id, signal, findings: [ {title, location, action, severity}, ... ] }
     parsed with parseJudgementEnvelope; a parse failure throws (the runner records an errored rep)
  4. ids = assignFindingIds(findings, 1) per pass, imported from plugin/skills/faff/bin/lib/finding-id.js
  5. defect finding per pass = among findings with normaliseFindingPath(location) == defect_file,
     the highest severity (critical > major > minor > observation > absent), ties to the first emitted
  6. outcome = "undetected" if either pass has no defect finding
             | "stable"   if the two defect findings' ids are equal
             | "drifted"  otherwise
  7. return { env: { "finding-identity": outcome }, tokens, detail: { outcome, id_a, id_b, title_a, title_b } }
```

The prompt is the review rubric plus the contract fields, then the fixture, then an instruction to emit only one `faff-eval:judgement` block of the shape in step 3. `loadReviewFindingProse(pluginDir)` in `eval/cli-driver.mjs` slices the gateway `### Review verdict (fixed)` contract (as `loadReviewVerdictProse` does) and `faffter-noon-review/SKILL.md` from `## The five review passes` up to `## Appetite integration`, so the Contract artifact guidance the build adds is in the prompt; both anchors fail loud if moved.

Grading and the bar:

```
grader: KINDS and CLOSED_SET_KINDS gain "finding-identity"; predictedSet reads env["finding-identity"]
        as a one-element set (missing -> [] -> FAIL; any other token verbatim -> FAIL)
seam-registry.json: "finding-identity": { surface: "faffter-noon-review", status: "designed" }
faffter-noon-review frontmatter: judgement_seam: verdict-revert, verdict-build, finding-identity
rate = summary.per_kind["finding-identity"].accuracy        # mean of 0/1 case accuracies = stable / fixtures
pass = fixtures >= 10 AND rate >= 0.90                       # "undetected" and errored reps count as not stable
```

Runner changes in `eval/run-live-evals.mjs`: the `finding-identity` `LIVE_KINDS` entry; `runLiveCase` keeps an adapter-returned `detail` on the rep result; `main` takes `--model` and `--effort`, resolved with `resolveEvalModel` and `resolveEffort` from `run-evals.mjs` and passed to `frontierOpts`, and prints them; for this kind `main` also writes `eval/report/finding-identity-result.json`:

```
RECORD FindingIdentityResult:
  kind: "finding-identity"; commit: String (git rev-parse HEAD); run_at: ISO-8601
  model: String; effort: String | "inherit"
  fixtures: Integer; stable: Integer; drifted: Integer; undetected: Integer; errored: Integer
  rate: Number (0..1, 2 dp); bar: 0.9; pass: Boolean
  cases: List<{ id, outcome: "stable"|"drifted"|"undetected"|"errored", id_a?, id_b? }>
```

### Running it and recording the result

**Chosen:** the frontier run is an operator step in a plain terminal, after the PR's CI is green, not a step the graft agent runs. Why: `eval/README.md` point 1 and ADR-0004 forbid running a `claude -p` eval nested inside an agent session (quota and `~/.claude.json` races), and graft is an agent session. The build agent ships the eval and its mocked tests; the PR body carries the command below.

```
PROCEDURE record_title_stability():            # operator, plain shell, PR head or merge commit checked out
  1. node eval/run-live-evals.mjs --kind finding-identity        # model and effort from eval.model / eval.effort
  2. Copy eval/report/finding-identity-result.json to eval/baselines/finding-identity-result.json and land it
     on main through a normal human-reviewed PR (the record of authority)
  3. Post a tracker comment on FAFF-1266 headed "## Title-stability eval result": one line
     "<stable>/<fixtures> stable (<rate>), bar 0.90: PASS|FAIL", the PR link, then a fenced block tagged
     faff-eval:finding-identity-result holding the same JSON verbatim (the notification)
  4. On FAIL also comment on FAFF-1255 and FAFF-1268 with the same line (the parent's rule)
  5. Move FAFF-1266 to Done only after steps 2 and 3; if the merge moved it to Done, set it back to In Review until then
```

So the pending step is visible on the tracker, the build agent posts a comment on FAFF-1266 when it opens the PR: "Awaiting operator run: `node eval/run-live-evals.mjs --kind finding-identity`; FAFF-1268 stays blocked until the committed result lands."

FAFF-1268 gates on the committed file, never on the comment: it builds its collator only when `eval/baselines/finding-identity-result.json` exists on its base branch with `pass: true`, `fixtures >= 10` and a `commit` that is an ancestor of its base. This is the interface 2b assumes.

**Chosen:** the committed result file is the authority and the tracker comment is the notification. Why: a tracker comment is input any session with tracker access can write, so it cannot unblock a build on its own; a file on the protected base branch got there through human PR review, the same way `eval/baselines/frontier.json` does. The file proves who accepted the result, not that the run happened; forging the run itself would mean a human approving a fabricated baseline PR.

## 4. HOW

### Build order

1. `bin/lib/finding-id.js` with unit tests and a `--selftest`-style fixture list in the module, as `build-review-churn.js` does.
2. The three dialogue readers and the graft SKILL sentence; existing churn, convergence, judge-evidence and casefile tests must pass unchanged.
3. The two review SKILL edits and the frontmatter `judgement_seam` change.
4. The eval: rubric loader, instruction, live driver, adapter, grader arm, registry row, runner flags and result file, at least 10 fixtures, mocked tests.
5. PR; after merge-ready CI, the operator run and record.

### Edge cases

- **A finding with a title but no location:** `nolocation::<title>`; the eval never selects it as a defect finding (no path), so a reviewer that drops locations shows up as `undetected`.
- **Two findings in one pass compute the same id:** `assignFindingIds` suffixes the later one `#2`; the defect finding is still the highest-severity one in the file.
- **A dialogue record whose stored `finding_id` disagrees with its own title and location:** readers use the computed id, and a reply citing the stored id still matches through the `stored` alias, so no rebuttal is lost mid-loop.
- **A dialogue critical with neither title nor stored id:** it gets `round-<n>#<i>`, counts as standing, fails the critical-free-latest floor unless the judge overturns it, and churns if it recurs.
- **Location given as an absolute path or with a different root:** not normalised; the ids differ and the fixture scores `drifted`. That is a real 2b risk the eval should see.
- **A pass emits `signal: pass` with no findings:** `undetected`.

### Failure modes

- **Titles drift between passes.** How you'd know: rate below 0.90, with `title_a`/`title_b` in the detail showing paraphrase. What it means: FAFF-1268 withholds its collator; a follow-up could tighten title guidance and re-run, since the fixtures and runner stay.
- **The fixtures are too easy.** One obvious defect per fixture may give titles a single natural name, overstating stability on real reviews where findings are subtler. How you'd know: anchored findings in 2b's output share a location across consecutive rounds but carry different ids. What it means: proceed; the 2b collator keeps every occurrence, so drift duplicates findings rather than losing them.
- **Ten fixtures is a small sample.** One drift is 0.90, two is 0.80. How you'd know: a borderline result. What it means: the bar is the ticket's; the record keeps the per-case outcomes so a borderline run can be re-run on the same commit and both results posted.

**Anti-pattern:** letting the model emit `finding_id`. Why: the eval measures the helper over model-chosen titles and locations; a model-supplied id would measure the model's arithmetic instead.

**Anti-pattern:** running the frontier eval from the graft session, or from any `claude -p` child. Why: ADR-0004's nested-run race, and a result produced inside the build is not independent of it.

## Scenarios

```
Given a dialogue round record whose critical finding has location "./a.js:14", title "Missing `null` check." and a stored finding_id "a.js::missing null check"
When faff build-review-churn compares it with a prior round holding the same finding at "a.js:9"
Then churn is false and curr_critical_ids is ["a.js::missing null check"]
```

```
Given findings [{location: "b/src/x.js:3", title: "Leaks fd"}, {location: "src/x.js:40", title: "leaks  FD"}, {title: ""}] in round 2
When assignFindingIds runs
Then it returns ["src/x.js::leaks fd", "src/x.js::leaks fd#2", "round-2#2"]
```

```
Given a finding-identity case whose mocked pass A names the defect "Off-by-one in pageCount" at "lib/page.js:12"
  and whose mocked pass B names it "off-by-one in  pageCount." at "./lib/page.js:15"
When runLiveEvals runs the kind with that mock model
Then the case outcome is stable, per_kind accuracy is 1.00, and the result file lists id_a == id_b
```

```
Given ten mocked cases of which two drift
When the runner writes finding-identity-result.json
Then rate is 0.80 and pass is false
```

- No test under `test/` spawns `claude` for this kind; every eval test injects a mock model.

## 6. DESIGN DECISION RATIONALE

- **Where does the helper live?** Inside `evidence-collate.js` (FAFF-1257's plan) would make 2a create a module 2b and 2c also claim. **Chosen:** its own governance module that `evidence-collate.js` requires.
- **Do readers trust the stored id or recompute?** Trusting keeps hand-derivation; recomputing always breaks title-less records; a null id fails open. **Chosen:** recompute when a title exists, else the stored id, else a round-scoped id; replies match either the computed id or the stored alias.
- **Gate the reader switch on the eval?** The switch changes who computes the id, not what it is computed from. **Chosen:** ship it in this slice regardless of the eval.
- **How does an author reply learn the id?** A new `faff finding-id` CLI, or the churn output the loop already runs. **Chosen:** churn's `curr_critical_ids`, so no new command.
- **Which harness?** Black-box `run-evals.mjs` (one prompt, one answer per rep) or the live lane. **Chosen:** the live lane; its adapter can make two calls per rep and import the shipped helper.
- **How are two passes made independent?** Two reps of one call each, compared afterwards, or two calls inside one rep. **Chosen:** two calls inside one rep; the comparison stays inside the graded unit and the runner's per-kind accuracy is the bar's rate with no new aggregation.
- **What counts as the defect finding?** Any finding, all findings, or one per pass. **Chosen:** the highest-severity finding in `defect_file`; comparing whole finding sets would charge incidental extra findings to title stability.
- **How is an undetected defect scored?** Excluded or counted against. **Chosen:** counted against, and reported separately, so a reviewer that misses the defect cannot raise the rate.
- **Who runs the frontier eval?** The build agent or the operator. **Chosen:** the operator, per ADR-0004.
- **Where is the result recorded?** ADR-0004 addendum, the ticket, or a committed file. **Chosen:** a committed `eval/baselines/finding-identity-result.json` that FAFF-1268 gates on, plus a structured comment on FAFF-1266 (the ticket's instruction) as the notification.
- **Extra normalisation beyond the prose rule?** **Chosen:** strip `a/`/`b/`, backticks and trailing punctuation; existing ids are unaffected.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** Phase-2 findings recur across recorded Step 9 rounds only inside the autonomous dialogue loop, so the Phase-1 measurement covers what FAFF-1268 merges outside it. Validation: `faff-graft/SKILL.md` Step 9 routes a Phase-1 `pass` straight to Step 9b except on the dialogue arm; FAFF-1268's failure mode (anchored findings sharing a location across overlapping rounds with different ids, tagged `source: "adversarial"`) is the observable if this is wrong.
- **Assumes:** the operator can run `claude -p` against the frontier with forwarded credentials, as the `verdict-build` and `reconciliation` live baselines did (ADR-0004 addenda). Validation: `node eval/run-live-evals.mjs --kind finding-identity --only finding-identity-001` succeeds before the full run.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] `faff contract review-verdict` exits 0 on a block whose findings carry `title`, `location` and `action`, with output identical to the same block without them
- [ ] `test/build-review-churn.test.mjs`, `test/build-judge-evidence.test.mjs` and `test/build-judge-casefile.test.mjs` pass with no fixture edits

### From WHAT
- [ ] `test/finding-id.test.mjs` covers: `./`, `a/`/`b/`, backslash and `:line`, `:line-line`, `:line:col` stripping; whitespace-suffixed locations; title control-character, backtick, case, whitespace and trailing-punctuation normalisation; the `nolocation::` form; the `round-<n>#<index>` form; `#2`/`#3` same-round suffixes; `readerFindingIds` precedence (computed, then stored, then `round-<n>#<i>`), suffixing, and the `stored` alias
- [ ] `faff regions check` passes with `finding-id.js` in governance and the three factory readers requiring it
- [ ] The scenarios above for churn and `assignFindingIds` pass as tests
- [ ] `build-judge-casefile.js` extracts the diff for a `./`-prefixed location (new test case)
- [ ] Both review SKILL "Contract artifact" sections show `title`, `location`, `action` with the title guidance; `faffter-noon-review` frontmatter declares `finding-identity`; `faff validate-adapters` passes
- [ ] `test/build-review-churn.test.mjs` gains cases: two same-round criticals with equal normalised titles in one file count as two standing ids; an untitled, id-less critical counts as standing and `computeCriticalFreeLatestFloor` returns false for it
- [ ] `test/build-judge-evidence.test.mjs` gains a case: a rebuttal whose `finding_ref` is the stored id of a finding whose computed id differs is still found by `latestRebuttalFor` and lands in the case file
- [ ] `faff-graft/SKILL.md` Step 9 dialogue item 1 points at `readerFindingIds` and the churn ids, and the file stays at or under its 960-line baseline

### From HOW (eval)
- [ ] `finding-identity` is in `eval/grader.mjs` `KINDS` and `CLOSED_SET_KINDS`, in `eval/seam-registry.json` (surface `faffter-noon-review`, status `designed`), and in `LIVE_KINDS`; `test/eval-grader.test.mjs` and the registry consistency check pass
- [ ] At least 10 `eval/cases-live/finding-identity-*.json` files, each with `reps: 1`, a `defect_file` the diff touches, a diff touching at least two files, and at least 3 with `diff_b`
- [ ] A mocked test drives every fixture through `driveFindingIdentityCase` and asserts, per case, exactly two model calls, each made through its own model invocation, and that the second call's prompt contains none of the first call's mock output text (pass B never sees pass A's findings)
- [ ] A test calls the finding-identity driver with a tracker stub that throws on every method except `listIssues`, and the prompt is byte-identical across two calls with the same fixture
- [ ] The mocked scenarios above (stable case, 2-of-10 drift giving `pass: false`) pass, and `finding-identity-result.json` matches the FindingIdentityResult shape
- [ ] `run-live-evals.mjs --model X --effort Y` passes both to the frontier options (asserted through the pure option builder, no spawn)

### Eval coverage
- [ ] The KIND, its fixtures and its registry row ship in this ticket (above)
- [ ] When the PR opens, an "Awaiting operator run" comment with the command is on FAFF-1266
- [ ] Operator step, not a build gate: `eval/baselines/finding-identity-result.json` from the frontier run is on main through a reviewed PR, and the result comment (`## Title-stability eval result` with the `faff-eval:finding-identity-result` block) is posted on FAFF-1266 before the ticket moves to Done; a FAIL is also posted on FAFF-1255 and FAFF-1268

### Integration smoke test

```
PROCEDURE smoke():
  1. Write two dialogue round records to a temp build-review dir: round 1 with a critical at "./a.js:3" titled "Leaks fd",
     round 2 with the same critical at "a.js:30" titled "leaks FD" plus a stored finding_id "wrong"
  2. faff build-review-churn --prev round-1 --curr round-2 -> churn false, ids ["a.js::leaks fd"]
  3. node --test test/eval-run-live-evals.test.mjs with the mock model -> the finding-identity cases grade stable
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. Three parts (the helper with its reader switch, the two reviewer SKILL edits, the eval with 10 fixtures) share one purpose: give `finding_id` one home and measure it. The reader switch is small and is what makes the helper load-bearing even if the eval fails, so splitting it out would leave a helper with no consumer.

**Workstream fit?** No issues. The ticket sits under FAFF-1257 and FAFF-1255 with its 2b and 2c siblings, and its outcome (a measured merge key for review findings) is the one 2b needs.

**Deps surfaced?** No issues. FAFF-1268 is already linked as blocked by FAFF-1266. This slice needs nothing from FAFF-1256, because it touches no v0.3 schema, so no blocker link is owed.

**Risk profile?**
- **What's there:** The ticket cannot close inside an autonomous build. The frontier run is an operator step, because ADR-0004 forbids a nested `claude -p` eval, and FAFF-1268 waits on its committed result.
- **Why:** If nobody runs the eval after merge, FAFF-1268 stays blocked with no signal saying why.
- **What to do:** At merge, leave FAFF-1266 in In Review rather than Done, with the operator command in the PR body, so `/faff-wtf` shows it as waiting on a human step.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-3 minors fixed, not re-reviewed)