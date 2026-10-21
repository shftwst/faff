# FAFF-1360: A DoD item checked by a test file or an internal function call goes to the test floor, not the code-blind holdout

> Spec: faffter-dark-nlspec · 2026-10-21 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1360.

*Revision 3, 2026-10-21: applies spec-review rounds 1 and 2. Round 1: the empty-judged-set edge case cites the holdout-verdict derivation and is pinned by ac-17; `maskCodeSpans` replaces a pre-existing sentinel byte; follow-ups point to FAFF-1361, FAFF-1362, FAFF-1363 and FAFF-1364. Round 2: `holdout-record.js` comes into scope, because the writer accepted a `meets-spec` block with `criteria: []` that the contract refuses; the writer now refuses any block whose aggregate disagrees with `deriveHoldoutAggregate`, which moves into `holdout-record.js` (ac-18). The export signal is narrowed to module-export wording, with two data-export phrasings pinned as null; the counts are re-measured. One decision added (where the derivation lives).*

*Review closed by operator decision, 2026-10-21, after round 3 (not converging, objections 4, 5, 6 with churning lenses). Two round-3 items were applied: a sentence stating that the schema check refuses a verdict outside met, unmet and needs-human, and a scenario for the writer refusal. The other round-3 objections were refuted against the code or were already addressed in the tracker.*

This spec covers FAFF-1360 for the build agent and its human reviewers. It changes how `faff dod classify` assigns a verification tier to DONE items, makes `faff holdout record` refuse an aggregate its criteria do not derive, adds one advisory to `faff admissible`, and updates three skill prompts. It adds no new tier, no new output field and no new contract value.

## 1. WHY

**Main idea.** `faff dod classify` gives every DoD criterion a `verification_tier`, and the tier alone decides who checks it: `running-stack` goes to the code-blind holdout, `integration` to the review and merge test floor, `delegated` to the AC checklist. The holdout sees only the spec and the running system. This change adds one step to the tier resolver: a non-prose DONE item that names a repository test file, or that says a symbol is exported, is `integration`. The holdout then stops being asked to judge criteria it has no way to observe.

**Problem.** In FAFF-1354, all 7 scenarios were met, but the holdout aggregate was `needs-human`. Two DONE items caused it. `done:3` asks that `test/faff-1353-write-core-issue-scoped.test.mjs` and `test/events.test.mjs` pass. `done:8` asks that `reportAppendFailure` write a given note when called with `{code: "EVENTS_LOCKED", message: "m"}`, and that `reportAppendFailure` and `lineSafe` be exported. Both classify as `assertion`, so both get the `running-stack` default. The evaluator cannot read test files or call internal functions, so it records both as `needs-human`, and one `needs-human` sets the aggregate. After this change both go to the review and merge test floor. That floor runs the build's own tests, and graft's Step 8 AC checklist already lists every DONE item, so neither item is left without a verifier.

Both items are `assertion` only because their text contains an angle-bracket placeholder (`- <violation>` in `done:3`, `journal append failed: <message>` in `done:8`), which `prdHasComparator` reads as a comparator. Without the placeholder they would be prose and already `delegated`. This spec does not change that comparator rule (see section 2 and section 6). The new step is needed anyway, because a DONE item such as "`test/x.test.mjs` MUST pass" is an assertion by design and would hit the same problem.

### Design principles

**A false match costs more than a miss.** A DONE item wrongly routed to `integration` leaves the holdout's judged set, which weakens verification. A DONE item the rule misses stays `running-stack` and fails closed to `needs-human`, which is today's behaviour. The `INTEGRATION_TIER_MARKERS` comment in `admissibility.js` states the same rule. So each signal must name something the code-blind evaluator can never observe, and the signal list grows only from real misses.

**DONE items only.** A Scenarios unit is the holdout's own material. The new step never changes a Scenarios unit's tier.

**Classify is the only place a tier is decided.** The evaluator, the holdout record writer and graft's skip gate already read tiers from `faff dod classify`. None of them gets its own copy of the rule.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript | `resolveVerificationTier`, `TIER_VERIFIER`, `dodClassify`, `admissibleVerdict`, `proseDoneAdvisory`, `dodSelftest`. The tier and advisory changes go here. |
| `plugin/skills/faff/bin/lib/holdout-record.js` | JavaScript | Governance region. Puts every `integration` and `delegated` row in `delegated[]` with its verifier, and refuses an evaluator block whose judged ids differ from classify's `running-stack` ids. Changed: it becomes the home of `deriveHoldoutAggregate` and refuses a block whose aggregate the criteria do not derive (section 4). |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | Factory region. `computeHoldoutVerdict` already refuses `aggregate is "X" but criteria derive "Y"`. Changed: it imports `deriveHoldoutAggregate` from `holdout-record.js` instead of defining it, and keeps exporting it. |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | Markdown prompt | Judges only `running-stack` criteria. One sentence about "no exposed surface" changes. |
| `plugin/skills/faff-graft/SKILL.md` | Markdown prompt | Step 8 builds the AC checklist from every `done` criterion; the holdout skip gate reads `judged_count` and `integration_count`. Unchanged. |
| `plugin/skills/faffter-noon-spec/SKILL.md`, `plugin/skills/faffter-dark-nlspec/SKILL.md` | Markdown prompt | The DONE authoring guidance for spec producers. One sentence each. |
| `records/adr/0140-the-code-blind-holdout-judges-only-machine-checkable-criteria.md` | ADR | States that delegated and `integration` criteria leave the judged set and the aggregate. This change applies that decision to more DONE items. |

**Scope.** This ticket narrows the holdout's judged set for one kind of DONE item. It is one of the fixes FAFF-1270 (the proving run) needs, beside FAFF-1292, FAFF-1293 and FAFF-1359.

## 2. OUT OF SCOPE

- **The angle-bracket placeholder read as a comparator.** `prdHasComparator` treats any `<` or `>` as a comparator, so a placeholder such as `<issue>` makes a DONE item an assertion. Measured over `records/specs/*.md` and `docs/specs/*.md` on 2026-10-21, 570 of 1110 DONE assertions are assertions only because of a `<word>` placeholder. Fixing it would move about half of all DONE assertions from the holdout to the AC checklist. That is a separate trust decision, and `classifyCriterion` is shared with `faff admissible`. Extension point: `prdHasComparator` in `admissibility.js`; tracked as FAFF-1361.
- **An author-declared `integration:` prefix on DONE items.** Scenarios bullets already accept it; DONE items do not. It would cover internal-call items the rule misses (for example "called with X, `fn` returns Y" with no export clause). Extension point: the DONE loop in `dodClassify`, where `markerTiers.push(null)` runs today; tracked as FAFF-1362.
- **Splitting a mixed DONE item automatically.** Splitting would change DONE ids and the AC checklist rows built from them. Extension point: none needed while the authoring rule in section 4 holds.
- **Scenarios units that name a test file.** 64 of 4221 Scenarios units in committed specs name one. Flagging those at spec review is tracked as FAFF-1364, a sibling of FAFF-1293 (whose acceptance covers only prose units). Extension point: the spec-review lenses.
- **Reporting "could not reach" apart from "needs a human" (FAFF-1292).** Both are wanted. This ticket removes code-only DONE items from the judged set. A born-verifiable criterion the environment exposes no surface for still ends `needs-human`, and FAFF-1292 owns how that is reported. Extension point: the evaluator's no-surface backstop.
- **The live FAFF-1354 holdout re-run.** It needs a built FAFF-1354 and a running environment, and FAFF-1354 is blocked by FAFF-1359. This ticket proves the same outcome with `faff holdout record` over the FAFF-1354 DoD (section 8). Extension point: the FAFF-1354 build, then FAFF-1270.
- **The `dod classify` row in `docs/guide/cli.md`.** It does not describe tiers today. Leave it unchanged.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| code-surface DONE item | A DONE item whose class is `scenario` or `assertion` and whose text names a repository test file or a symbol exported from a module. The code-blind evaluator cannot observe either one. |
| code-surface signal | The reason an item is a code-surface DONE item: `test-file` or `export`. |
| mixed item | A code-surface DONE item that also names CLI or HTTP behaviour, such as FAFF-1354's `done:3`, which also says `faff events append` exits 1. |

### The two signals

The signals are pure functions of the criterion text after the leading `[ac-N] ` is removed (`dodClassify` already passes that text).

```
CONSTANT TEST_FILE_TOKEN_RE =
  /[\w.-]+(?:\.test|\.spec|_test|_spec)\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|swift|sh|bats)\b|\btest_\w+\.py\b/
  # a file name with a test infix and a source-file extension: events.test.mjs, store_test.go,
  # user.spec.ts, user_spec.rb, test_limits.py. A host such as app.test.internal does not match,
  # because "internal" is not a listed extension. A directory alone (test/fixtures/x.json) does not match.

CONSTANT IDENT_RE = /^[A-Za-z_$][\w$]*$/      # a plain identifier, no dot, slash or parenthesis

CONSTANT SOURCE_FILE_RE = /^[\w.\/-]+\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|swift|sh|bats)$/   # same extension list

FUNCTION maskCodeSpans(text) -> String:
  # first replace every U+0001 already in text with a space, so only this function can produce the sentinel
  # replace each backticked span with a token: ID when its content matches IDENT_RE,
  # SRC when it matches SOURCE_FILE_RE, else CODE
  RETURN text with each `...` span replaced by " \u0001ID\u0001 ", " \u0001SRC\u0001 " or " \u0001CODE\u0001 "

LET ID   = "\u0001ID\u0001"
LET SRC  = "\u0001SRC\u0001"
LET IDS  = ID + "(?:\s*(?:,|and)\s*" + ID + ")*"           # one identifier, or a list joined by commas or "and"

CONSTANT EXPORT_CLAUSE_RES = [                               # module export only; each needs a code-shaped context
  /(?:^|[.;:!?]\s+)export\s+ID/i,                           # imperative at clause start: "Export `fn` and `g` for the unit tests"
  /\bexported\s+ID\s*(?:'s\b|(?:function|method|class|constant|helper|symbol)\b)/i,
                                                             # "the exported `fn`'s parameter", "the exported `fn` helper"
  /IDS\s+(?:is|are)\s+exported\s+from\b/i,                  # "`a` and `b` are exported from `lib/x.js`"
  /SRC\s+exports?\s+ID/i,                                    # "`effects-reconcile.js` exports `sanitizeDetail`"
]
  # Data-export wording does not match: "export" as a noun after another word ("the CSV export `path`"),
  # "is exported to/into ...", and "the exported `summary` field" all lack the module context above.

FUNCTION codeSurfaceSignal(text) -> "test-file" | "export" | null:   # pure, exported
  1. IF TEST_FILE_TOKEN_RE matches text: RETURN "test-file"
  2. LET m = maskCodeSpans(text)
  3. IF any EXPORT_CLAUSE_RES entry matches m: RETURN "export"
  4. RETURN null
```

Expected values (each is a selftest case):

| Input text | Result |
|---|---|
| FAFF-1354 `done:3` (Appendix A) | `test-file` |
| FAFF-1354 `done:8` (Appendix A) | `export` |
| "`pkg/store_test.go` MUST pass" | `test-file` |
| "`parseLimit` and `formatLimit` are exported from `lib/limit.js`, and `parseLimit` MUST reject a negative limit" | `export` |
| FAFF-1137 `done:5`, "The exported `runShardedRung`'s new `concurrency` parameter defaults to single-wave ..." | `export` |
| "the `summary` field is exported to the CSV" | null (data export: "exported to", not "exported from") |
| "The CSV export `path` MUST default to stdout" | null (data export: "export" is a noun after "CSV", not a clause-start verb) |
| "`faff export` MUST write `out.json`" | null (the word sits inside the code span) |
| "the CSV export `report.csv` MUST have a header row" | null (`report.csv` is not a plain identifier) |
| "the service MUST answer 200 on `http://app.test.internal/healthz`" | null |
| a DONE item whose raw text holds U+0001, `ID`, U+0001 followed by " is exported from x" and no backticked identifier | null (a pre-existing sentinel byte is replaced before masking) |
| "`faff events append` MUST exit 1 on an empty issue" | null |

### Tier resolution (changed)

```
FUNCTION resolveVerificationTier(text, markerTier, criterion) -> Tier:
  1. IF markerTier: RETURN markerTier                                         # unchanged
  2. IF criterion AND criterion.source == "done" AND criterion.class == "prose":
       RETURN "delegated"                                                     # unchanged (FAFF-1291)
  3. IF criterion AND criterion.source == "done" AND codeSurfaceSignal(text) != null:
       RETURN "integration"                                                   # NEW (FAFF-1360)
  4. IF lowercased text contains any INTEGRATION_TIER_MARKERS entry:
       RETURN "integration"                                                   # unchanged (FAFF-961)
  5. RETURN "running-stack"
```

`TIER_VERIFIER` is unchanged, so a code-surface DONE item gets `verifier: "review-merge-floor"`. The `dodClassify` output shape is unchanged: `verification_tier_counts`, `judged_count`, `integration_count` and `delegated_count` change in value only. Step 3 needs the `criterion` argument. The existing selftest calls `resolveVerificationTier(text, null)` without one, and those calls keep today's result.

### The code-surface advisory (new, advisory only)

`faff admissible` gains one warning, built the same way as the prose-DONE advisory (FAFF-304): from `dodClassify`, with no second parser, and never changing `admissible`.

```
CONSTANT MIXED_SURFACE_RE = /\b(?:exits?|exited|exit code|exit status|stdout|stderr|https?)\b/i
  # advisory only: a broad match here costs a warning line, never a tier change

FUNCTION codeSurfaceAdvisory(specText) -> { count, items, mixed } | null:   # pure, exported
  1. TRY classified = dodClassify(specText) CATCH: RETURN null
  2. items = classified.criteria where source == "done"
             AND verification_tier == "integration" AND codeSurfaceSignal(text) != null
  3. IF items is empty: RETURN null
  4. mixed = items where MIXED_SURFACE_RE matches text
  5. RETURN { count: items.length, items, mixed }

FUNCTION renderCodeSurfaceWarning(adv) -> String:   # pure, exported
  # each item: whitespace collapsed, trimmed, first 50 characters, joined by " | " (as renderProseDoneWarning)
  s = "code-surface advisory: " + adv.count + " DONE item(s) name a repository test file or an exported symbol"
      + " and go to the review/merge test floor, not the holdout: " + items
  IF adv.mixed is not empty:
    s += "  (" + adv.mixed.length + " also name CLI or HTTP behaviour; state that behaviour as its own DONE item"
         + " so the holdout judges it: " + mixed items + ")"
  RETURN s
```

`admissibleVerdict` pushes this line into `warnings` right after the prose-DONE advisory lines, in the lights-out branch only, as the prose-DONE advisory does today.

## 4. HOW

### Flow

1. `dodClassify` builds criteria exactly as today. DONE items still push a null marker tier.
2. The tier post-pass calls `resolveVerificationTier(c.text, markerTiers[i], c)` as today, and the new step 3 tiers code-surface DONE items `integration`.
3. Every consumer picks up the new tier; only the record writer changes, and that change (below) does not depend on the tier:
   - the evaluator leaves `integration` criteria out of its judged set (`faffter-noon-evaluate/SKILL.md`, "Leave the delegated criteria out");
   - `faff holdout record` writes them to `delegated[]` with `verifier: "review-merge-floor"` and requires the evaluator block to omit them;
   - graft's skip gate counts them in `integration_count`;
   - graft Step 8 still lists them on the AC checklist, because it takes every `done` criterion.
4. `faff admissible --lights-out` reports them in the code-surface advisory, and calls out mixed items.

### The mixed-item authoring rule

A mixed item tiers `integration` as a whole. The holdout no longer judges its CLI or HTTP half; the AC checklist and the test floor still cover it. To keep that half in front of the holdout, the author states it as its own DONE item. Two places carry this rule:

- The code-surface advisory names every mixed item (section 3).
- Both spec producers get one sentence in their DONE guidance, placed after the "Each item concrete enough to write a test against" rule in `faffter-noon-spec/SKILL.md` section 4 and after the "Each item must be concrete enough to write a test against" paragraph in `faffter-dark-nlspec/SKILL.md` section 8:

  > Put a check the running system cannot show (a repository test file passing, a symbol being exported) in its own DONE item, apart from any CLI or HTTP behaviour. `faff dod classify` sends such an item to the review/merge test floor, so behaviour stated in the same item is not judged by the holdout.

For FAFF-1354, the split form of `done:3` is two items: "`test/faff-1353-write-core-issue-scoped.test.mjs` and `test/events.test.mjs` pass unmodified." (prose, so `delegated`) and "`faff events append` with `{"phase":"run","type":"decision-capture","issue":""}` still exits 1 with one `- <violation>` stderr line per violation." (an assertion with no code-surface signal, so `running-stack`).

### The record writer refuses an aggregate its criteria do not derive

Moving criteria out of the judged set makes `criteria: []` a normal evaluator block (see the empty-judged-set edge case). Today `faff holdout record` accepts a block with aggregate `meets-spec` and `criteria: []` over a spec with `judged_count` 0 and writes it as `meets-spec`, while `faff contract holdout-verdict` refuses the same block with `aggregate is "meets-spec" but criteria derive "needs-human"`. Verified on `f711e6bf`: `buildHoldoutRecord` returns `ok: true`, `aggregate: "meets-spec"` for that block. The writer must refuse it, using the contract's derivation, not a second copy.

`deriveHoldoutAggregate` cannot be imported by `holdout-record.js` where it lives now. `holdout-record.js` is in the governance region, `contract-defs.js` is in the factory region, and `faff regions check` forbids a governance file requiring a factory file (ADR-0042; `regions.js`: "a residual violation is fixed by moving the code, never by silencing the lint"). `contract-defs.js` already requires `holdout-record.js` for `delegationViolations` (FAFF-1291), so the legal direction is the other way. The function therefore moves:

```
IN holdout-record.js (governance):
  FUNCTION deriveHoldoutAggregate(verdicts) -> Aggregate:     # moved verbatim from contract-defs.js, body unchanged
    IF any verdict == "needs-human": RETURN "needs-human"
    IF verdicts is empty:            RETURN "needs-human"     # nothing judged
    IF every verdict == "met":       RETURN "meets-spec"
    IF every verdict == "unmet":     RETURN "fails"
    RETURN "gaps"
  export it from module.exports

IN contract-defs.js (factory):
  delete the local definition; extend the existing line to
    const { delegationViolations, deriveHoldoutAggregate } = require("./holdout-record")
  keep deriveHoldoutAggregate in module.exports, so every existing importer is unchanged

IN buildHoldoutRecord, after the judged-id check and before holdoutRecordViolations(redacted):
  1. LET verdicts = redacted.criteria mapped to .verdict
  2. IF every verdict is one of met | unmet | needs-human:            # same guard computeHoldoutVerdict uses
       LET expected = deriveHoldoutAggregate(verdicts)
       IF redacted.aggregate != expected:
         refusals.push('aggregate is "' + redacted.aggregate + '" but criteria derive "' + expected + '"')
  3. existing flow: any refusal -> failClosed(...), which writes aggregate needs-human, criteria [],
     violations prefixed "holdout record refused: ", and the CLI exits 1, as for every other refusal
```

A verdict outside `met`, `unmet` and `needs-human` skips step 2, but the block is still refused: `holdoutRecordViolations` runs next and the anchored schema allows only those three verdicts, so no record whose aggregate disagrees with its criteria is written by either route.

The writer still never rewrites `aggregate`, `verdict` or `evidence_present`: a disagreeing block is refused, not corrected. Update the `holdout-record.js` header comment ("it never recomputes `aggregate` ...") to say that the writer refuses an aggregate the criteria do not derive and never rewrites one. A record the writer now refuses would have been written and then rejected by `computeHoldoutVerdict` at every gate that re-validates it (`readHoldout`, `faff holdout verdicts`), so a merge was already blocked; the change moves the refusal to write time and makes the stored record say why.

Existing tests: `test/holdout-record.test.mjs` "library: the writer never recomputes aggregate, verdict or evidence_present" asserts that a block with aggregate `fails` and one `met` criterion is written as `fails`. It must change: the same block is now refused, `ok` is false, the record's `aggregate` is `needs-human`, and its violations include `holdout record refused: aggregate is "fails" but criteria derive "meets-spec"`. Rename the test to say the writer refuses, never rewrites. Prototyped on a copy of `f711e6bf`: every other case in `test/holdout-record.test.mjs`, all of `test/holdout-delegation.test.mjs` and `test/evaluate-call.test.mjs`, `faff holdout --selftest`, `faff contract --selftest` and `faff regions check` pass unchanged.

### Text edits outside the resolver

- `admissibility.js`: the FAFF-961 tier comment block above `isIntegrationFenceOpen` lists the code-surface step and its place in the precedence. The `resolveVerificationTier` header comment names step 3. The DONE-loop comment "DONE items carry no tier marker (mirrors the holdout-literal rule); keyword/default still applies below" also names the code-surface step.
- `faffter-noon-evaluate/SKILL.md`, "Classify the DoD" bullet: replace the last sentence ("A criterion with no exposed surface is not integration-tier ... exactly as before.") with: "Classify alone decides the tier. A DONE item that names a repository test file or an exported symbol is `integration`; any other criterion with no exposed surface stays `running-stack` and falls through to the exercise step's fail-closed `needs-human` backstop."
- No eval case is needed. No LLM-judgement seam changes: the evaluator still reads the tier from classify, and the sentence above describes that routing, not a judgement.

### Edge cases

- **A prose DONE item that names a test file** (FAFF-1354 `done:9`) stays `delegated`. Step 2 runs before step 3.
- **A `holdout:`-prefixed DONE item** stays literal with `holdout: false` and its stderr advisory, as today. Step 3 still reads its text, so it can be `integration`.
- **A test-file token with a line range**, such as `test/decision-capture.test.mjs:172-215`, matches: the `\b` after the extension sits before the colon.
- **A spec whose only non-prose items are code-surface DONE items** gets `judged_count` 0 and `integration_count` above 0. Graft does not skip the holdout, and the evaluator emits `criteria: []`, which rolls up to `needs-human`: the holdout-verdict derivation gives `needs-human` when nothing was judged at all (`faff contract holdout-verdict --describe`), never a vacuous `meets-spec`. The record writer enforces the same derivation (see the writer subsection above), and ac-17 pins it. Before this change the same spec reached `needs-human` through the judged items, so the outcome does not change. Whether graft should skip the holdout on such specs is tracked as FAFF-1363 and is not part of this ticket.
- **Explicit `integration` fence or prefix** still wins at step 1. Scenarios units are unaffected because step 3 checks `source == "done"`.

### Failure modes

- **The rule misses an unobservable DONE item.** Example: "called with `{...}`, `fn` writes a note" with no export clause and no test file. How you would know: a holdout record shows `needs-human` on a `done:N` id with a "no surface" reason. What it means: proceed; add the observed phrasing to the signal list as its own ticket, the way `INTEGRATION_TIER_MARKERS` grows.
- **The rule catches an observable DONE item.** How you would know: a `delegated[]` row with `review-merge-floor` whose text describes only CLI or HTTP behaviour. On 2026-10-21 (revision 3 rule, 886 files under `records/specs` and `docs/specs`) the rule matched 55 of 1120 non-prose DONE items; 54 matched on a `*.test.mjs` file name and 1 on an export clause, and 15 of the 55 were mixed items. What it means: if a pure-behaviour item turns up, narrow the pattern that matched it.
- **A DONE item names a test file as data, not as a check.** A spec for a tool that handles test files (a test runner, `faff gates`) can have a DONE item such as "`faff gates shard` puts `test/a.test.mjs` in shard 2", which the holdout could observe. The rule routes it to `integration`. How you would know: the code-surface advisory lists an item whose test-file name is an input or an output, not something to pass. What it means: proceed; behaviour the holdout should judge belongs in the Scenarios section, which the rule never touches.
- **Authors keep writing mixed items.** How you would know: the code-surface advisory's mixed clause keeps appearing in graft admissibility logs. What it means: the CLI half is still covered by the AC checklist and the test floor; the holdout's coverage is thinner. Proceed, and consider the author-declared marker in section 2.

**Anti-pattern:** matching the bare words "test", "unit test", "called with" or "function". Why: CLI items use those words ("when `faff x` is called with `--json`"), and each such match removes an observable criterion from the holdout.

**Anti-pattern:** reading `oracle_less` to pick the tier. Why: `oracle_less` is an advisory with a broad observable-token list (`/` and `file` count as observables), and it was false for both FAFF-1354 items.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a file holding the FAFF-1354 Scenarios and Done sections exactly as in Appendix A
When `faff dod classify --spec <that file> --json` runs
Then it exits 0
  And criteria done:3 and done:8 have verification_tier "integration" and verifier "review-merge-floor"
  And criteria scenarios:1 to scenarios:7 have verification_tier "running-stack" and verifier "holdout"
  And judged_count is 7, integration_count is 2 and delegated_count is 15
```

```
Given a spec file whose "## Scenarios" section holds the bullet "- `test/a.test.mjs` MUST pass"
  and whose "## 8. DONE" section holds "- [ ] `faff events append` MUST exit 1 on an empty issue"
When `faff dod classify --spec <that file> --json` runs
Then both criteria have verification_tier "running-stack" and verifier "holdout"
```

```
Given the Appendix A file saved as spec.md in a scratch git repository
  and an evaluator block on stdin with aggregate "meets-spec", code_blind true, violations [], and criteria scenarios:1 to scenarios:7,
  each with text, holdout, class "scenario", verdict "met", evidence_present true, non-empty exercised, expected and observed,
  evidence_ref null and reason null
When `faff holdout record --issue FAFF-1354 --spec spec.md` runs
Then it exits 0
  And .faff/holdout/FAFF-1354.json has aggregate "meets-spec" and 7 criteria
  And its delegated array has 15 rows, where done:3 and done:8 have verification_tier "integration" and verifier "review-merge-floor"
```

```
Given a spec file whose only non-prose criterion is the DONE item "- [ ] `pkg/store_test.go` MUST pass", saved as spec.md in a scratch git repository,
  and an evaluator block on stdin with aggregate "meets-spec", code_blind true, violations [] and criteria []
When `faff holdout record --issue FAFF-9 --spec spec.md` runs
Then it exits 1
  And .faff/holdout/FAFF-9.json has aggregate "needs-human" and criteria []
  And its violations include 'holdout record refused: aggregate is "meets-spec" but criteria derive "needs-human"'
```

## 6. DESIGN DECISION RATIONALE

**Classifier rule or author-declared marker?** A DONE-level `integration:` marker puts the call on the author, like the FAFF-1293 precedent, but it leaves FAFF-1354's spec and every existing spec unchanged until someone edits them, and it relies on each producer remembering it. A classifier rule fixes specs as written, but it must be narrow, because a false match weakens verification. Fixing the placeholder comparator was also considered: it would make FAFF-1354's two items prose, so `delegated`, but it would not help "`test/x.test.mjs` MUST pass" and it would move about 570 other items. **Chosen:** a narrow classifier rule, with the marker left as the extension in section 2. The rule follows the `INTEGRATION_TIER_MARKERS` pattern already in the module: a short, phrase-specific list grown from real misses.

**Which tier?** `delegated` names the AC checklist as verifier and is reserved for prose DONE items (ADR-0140). `integration` names the review and merge test floor, which runs the build's own tests. A test file passing and an exported function behaving as stated are both checked by those tests. **Chosen:** `integration`, verifier `review-merge-floor`, as the ticket proposes. The item stays on the AC checklist either way. No new ADR is needed: ADR-0140 already decides that `integration` criteria leave the judged set, and this change only decides which DONE items are `integration`.

**Which signals?** Candidates were: a test-file token, an export clause, a backticked call expression (`fn(`), the phrase "called with", and the words "unit test". The last three match CLI items ("`faff x` is called with `--json`", "`ok(1)`" in output). **Chosen:** two signals, a test-file name with a source-file extension and a module-export clause naming a plain identifier. The export clause needs a code-shaped context (an imperative "Export" at clause start, "exported from", a source file as subject, or "the exported `fn`'s"), because "exported to the CSV" and "the CSV export `path`" describe data a holdout can observe. Both signals appear in the motivating case, and on 2026-10-21 they matched 55 of 1120 non-prose DONE items in committed specs: 54 on a `*.test.mjs` file name and 1 on an export clause (FAFF-1137's "the exported `runShardedRung`").

**DONE items only, or Scenarios units too?** 64 Scenarios units in committed specs name a test file, but a Scenarios unit is the holdout's own material and no verifier other than the holdout receives it by id (ADR-0140). **Chosen:** DONE items only. Scenarios units that name test files belong to spec review (FAFF-1364).

**Mixed items: split automatically, or require authors to state halves separately?** Splitting at classify time changes DONE ids and the AC checklist rows keyed on them. Leaving a mixed item `running-stack` guarantees `needs-human`, because the evaluator cannot confirm the test half, which is the defect this ticket removes. **Chosen:** a mixed item tiers `integration` as a whole; the advisory names it, and both spec producers tell authors to state the halves as separate DONE items. The cost is that the holdout no longer judges a mixed item's CLI half until the author splits it. In practice the evaluator could not have returned `met` for such an item, so the loss is a possible `unmet` signal, and the AC checklist and test floor still cover the CLI half.

**Where in the precedence?** After the explicit marker, so an author's marker always wins. After the prose-DONE rule, so prose items keep their `delegated` route (FAFF-1291 put prose-DONE before keyword matching for the same reason). Before or after the keyword list makes no difference, since both give `integration`. **Chosen:** a new step 3, between the prose-DONE rule and the keyword list.

**Where does the mixed-item warning go?** Options: a stderr line from `dodClassify` (like the `holdout:` DONE advisory), or a `faff admissible` warning (like the FAFF-304 prose-DONE and FAFF-812 oracle-less advisories). `dodClassify` runs inside the evaluator and the record writer, where a warning reaches no author. **Chosen:** a `faff admissible` warning, built from `dodClassify` output, plus the producer guidance sentence.

**How is the FAFF-1354 re-run outcome proven?** The live re-run needs a built FAFF-1354, which is blocked by FAFF-1359. The re-run's verdict is determined by classify's judged set and the writer's id check, and both run without an environment. **Chosen:** prove it with `faff holdout record` over the FAFF-1354 DoD and an all-met block for its 7 scenarios. The live re-run stays with FAFF-1354 and FAFF-1270.

**Where does the aggregate derivation live once the writer needs it?** Options: the writer requires `contract-defs.js` (refused by `faff regions check`, and a require cycle, since `contract-defs.js` requires `holdout-record.js`); a second copy of the five-line derivation in the writer (two copies that can drift, which the round-2 review ruled out); or move the function into `holdout-record.js` and import it back into `contract-defs.js`. **Chosen:** move it, as FAFF-1291 did for `delegationViolations`. One copy, the legal require direction, and `contract-defs.js` keeps exporting the name.

**Change the placeholder comparator rule here?** It is the reason these two items are assertions at all, but changing it alters about half the DONE assertions in committed specs and `faff admissible`'s shared rule. **Chosen:** leave `prdHasComparator` and `classifyCriterion` unchanged; section 2 records the measurement in FAFF-1361.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions**

- **Assumes:** graft Step 8 builds `ac-checklist.json` from every `done` criterion of `faff dod classify --spec <spec> --issue <ISSUE> --json`, whatever its tier, and `faff holdout record` writes `integration` rows to `delegated[]` with verifier `review-merge-floor`. Validation: before starting, read `plugin/skills/faff-graft/SKILL.md` Step 8 ("Source": "its `done` criteria in order") and the `DELEGATED_TIERS` and `DELEGATED_VERIFIER_FOR_TIER` constants in `holdout-record.js`, and run `node --test test/holdout-delegation.test.mjs` (its ac-9 case writes an `integration` DONE row). If either has changed, stop and report, because routing an item to `integration` is safe only while it stays on the AC checklist.

## 8. DONE

### From WHY
- [ ] [ac-1] `faff dod classify --spec <the Appendix A file> --json` exits 0 and gives `done:3` and `done:8` `verification_tier` `integration` and `verifier` `review-merge-floor`, gives `scenarios:1` to `scenarios:7` `running-stack`, and reports `judged_count` 7, `integration_count` 2 and `delegated_count` 15.
- [ ] [ac-2] `faff holdout record --issue FAFF-1354 --spec <the Appendix A file>`, given an all-met block for `scenarios:1` to `scenarios:7` only, exits 0 and writes `aggregate` `meets-spec` with 15 `delegated` rows, `done:3` and `done:8` among them with verifier `review-merge-floor`.

### From WHAT (signals and tiers)
- [ ] [ac-3] `codeSurfaceSignal`, `codeSurfaceAdvisory` and `renderCodeSurfaceWarning` are exported from `admissibility.js`, and `codeSurfaceSignal` returns the value in every row of the expected-values table in section 3.
- [ ] [ac-4] `resolveVerificationTier` follows the five-step order in section 3: an explicit marker still wins; a prose DONE item naming a test file stays `delegated`; a Scenarios unit naming a test file stays `running-stack`; a call with no `criterion` argument returns what it returns today.
- [ ] [ac-5] An assertion-class DONE item naming only CLI behaviour, "`faff events append` MUST exit 1 on an empty issue", is `running-stack` with verifier `holdout`.
- [ ] [ac-6] On the Appendix A file, `counts` is still `{scenario: 7, assertion: 2, prose: 13}`, `holdout_counts` is still `{holdout: 2, visible: 20}`, `oracle_less_count` is still 0, and every criterion other than `done:3` and `done:8` has the same `verification_tier` as before (`running-stack` for `scenarios:1` to `scenarios:7`, `delegated` for the other 13 DONE items).

### From WHAT (advisory)
- [ ] [ac-7] `faff admissible --lights-out --json` on the Appendix A file exits 0 with exactly one warning beginning `code-surface advisory: 2 DONE item(s)`, and that warning's mixed clause counts 1 item. On `ADMISSIBLE_GOOD` it adds no code-surface warning, and without `--lights-out` it adds none.

### From HOW (text edits)
- [ ] [ac-8] The "Classify the DoD" bullet in `faffter-noon-evaluate/SKILL.md` ends with the replacement sentence given in section 4, and no longer contains "A criterion with no exposed surface is not integration-tier".
- [ ] [ac-9] `faffter-noon-spec/SKILL.md` section 4 and `faffter-dark-nlspec/SKILL.md` section 8 each contain the authoring sentence given in section 4.
- [ ] [ac-10] The FAFF-961 tier comment block, the `resolveVerificationTier` header comment and the DONE-loop marker comment in `admissibility.js` each name the code-surface step.

### From HOW (edge cases)
- [ ] [ac-11] A DONE item "holdout: `x.test.mjs` MUST pass" keeps its literal text and `holdout: false` and is `integration`.
- [ ] [ac-12] "`test/decision-capture.test.mjs:172-215` MUST pass" as a DONE item is `integration`.

### From HOW (tests and build hygiene)
- [ ] [ac-13] `faff dod --selftest` includes FAFF-1360 checks for ac-3, ac-4, ac-5, ac-11 and ac-12, and `faff dod --selftest` and `faff admissible --selftest` both print `ok`.
- [ ] [ac-14] `test/faff-1360-code-surface-done-tier.test.mjs` covers ac-1, ac-2, ac-5 and ac-7 and the four scenarios in section 5 by spawning the CLI, using `test/fixtures/faff-1360/faff-1354-dod.md`, which is byte-identical to the Appendix A block content.
- [ ] [ac-15] `test/dod.test.mjs` and `test/holdout-delegation.test.mjs` pass unmodified. `test/holdout-record.test.mjs` passes with exactly one test changed: "library: the writer never recomputes aggregate, verdict or evidence_present" now asserts the refusal described in section 4.
- [ ] [ac-16] `faff validate-adapters` and `faff regions check` exit 0.
- [ ] [ac-17] `faff holdout record` over a spec whose only non-prose criterion is a code-surface DONE item (`judged_count` 0, `integration_count` 1), given an evaluator block with `criteria: []` and aggregate `needs-human`, exits 0 and writes `aggregate` `needs-human`; the same block with aggregate `meets-spec` exits 1 and writes a fail-closed record with `aggregate` `needs-human` whose violations include `holdout record refused: aggregate is "meets-spec" but criteria derive "needs-human"`. Covered in `test/faff-1360-code-surface-done-tier.test.mjs`.
- [ ] [ac-18] `deriveHoldoutAggregate` is defined only in `holdout-record.js` and exported from it; `contract-defs.js` has no local definition, imports it from `holdout-record.js`, and still exports it. `buildHoldoutRecord` refuses a block whose aggregate differs from `deriveHoldoutAggregate` over the verdicts of its criteria (for example aggregate `fails` with one `met` criterion), and `holdoutRecordSelftest` has a case for it. `faff contract --selftest` and `faff holdout --selftest` pass.

### Integration smoke test

```
1. fixture := test/fixtures/faff-1360/faff-1354-dod.md            # Appendix A content
2. classify := faff dod classify --spec fixture --issue FAFF-1354 --json
   ASSERT exit 0
   ASSERT tier(done:3) == tier(done:8) == "integration"
   ASSERT every scenarios:N is "running-stack"
   ASSERT judged_count == 7
3. block := { aggregate: "meets-spec", code_blind: true, violations: [],
              criteria: [ met(scenarios:1) .. met(scenarios:7) ] }
4. echo block | faff holdout record --issue FAFF-1354 --spec fixture      # in a scratch repo
   ASSERT exit 0
   ASSERT .faff/holdout/FAFF-1354.json aggregate == "meets-spec"
5. faff admissible --lights-out --spec fixture --json
   ASSERT exit 0 AND one warning starts "code-surface advisory: 2 DONE item(s)"
```

## 9. APPENDICES

### Appendix A: the FAFF-1354 DoD fixture

The Scenarios and Done sections of the FAFF-1354 spec ("a suppressed capture names the rule that refused it", attached to FAFF-1354, 2026-10-20), verbatim, with the sections between them left out. Commit the content between the outer `~~~~` fence lines as `test/fixtures/faff-1360/faff-1354-dod.md`. Today's `faff dod classify` gives this file `judged_count` 9 (`scenarios:1` to `scenarios:7`, `done:3`, `done:8`), `integration_count` 0 and `delegated_count` 13, the same as the full FAFF-1354 spec.

~~~~markdown
## 5. Scenarios

Shared setup for every scenario: a scratch directory initialised as a git repository, containing `.faff/config.yaml` whose two lines are `capture:` and `  decision_kernel: on`, and an empty directory `.faff/runs/run-1` (create it first; `faff events append` does not create the run directory). Then mint one `run-start` row into it with `echo '{"phase":"run","type":"run-start"}' | faff events append --run run-1 --ts 2026-01-01T00:00:00Z`. Commands run from the scratch directory. "The capture line" means a stderr line beginning `faff decision-capture`.

```
Given the shared setup, FAFF_RUN_DIR=<abs path of .faff/runs/run-1>,
  FAFF_DECISION_CORRELATION_ID=run-1/x/next/1, and FAFF_DECISION_ISSUE unset
When `faff next --status todo --spec high` runs
Then it exits 0 and prints the same stdout as the same command in a copy with decision_kernel: off
  And stderr has exactly one capture line, ending
    "capture suppressed: decision-capture event for kernel next refused by the issue-scoped rule: type 'decision-capture' is issue-scoped but missing required field 'issue'"
  And the last line of .faff/logs/decision-capture.jsonl parses as JSON with note "degraded-capture",
    run "run-1", event_type "decision-capture", kernel "next", rules ["issue-scoped"]
  And events.jsonl is byte-identical to before the command
```

```
Given the shared setup with FAFF_RUN_DIR set and neither FAFF_DECISION_CORRELATION_ID nor FAFF_DECISION_ISSUE set
When `faff next --status todo --spec high` runs
Then it exits 0
  And stderr has two capture lines: the first contains "empty correlation_id", the second contains "capture suppressed: decision-capture event for kernel next"
```

```
Given the shared setup
When `faff decision-capture record --run run-1 --issue "" --kernel <2000 copies of "k">` runs
  with stdin {"normalised_inputs":{},"selected_action":"graft"}
Then it exits 0 with empty stdout
  And the note's reason is at most 1024 UTF-8 bytes and ends with "...[truncated]"
  And the text after the capture line's prefix equals the note's reason
```

```
Given the shared setup
When `faff decision-capture record --run run-1 --issue "" --kernel "bad<newline>kernel"` runs,
  where <newline> is a literal line feed inside the argument, with stdin {"normalised_inputs":{},"selected_action":"graft"}
Then it exits 0 with empty stdout
  And stderr has exactly one capture line, and it contains "for kernel bad kernel refused by the issue-scoped rule"
  And no stderr line begins with "kernel refused by"
  And the last note has kernel "bad kernel" and a reason containing no line feed
```

```holdout
Given the shared setup, FAFF_RUN_DIR=<abs path of .faff/runs/run-1>,
  FAFF_DECISION_CORRELATION_ID=run-1/FAFF-7/claim-verdict/1, and FAFF_DECISION_ISSUE exported as the empty string
When `faff claim-verdict --claimed-at 2026-01-01T00:00:00Z --now 2026-01-05T00:00:00Z --ttl-hours 24` runs
Then it exits 0 and stdout is exactly {"verdict":"stale","age_secs":345600,"ttl_secs":86400}
  And stderr has exactly one capture line, containing "capture suppressed: decision-capture event for kernel claim-verdict refused by the issue-scoped rule"
  And the last line of .faff/logs/decision-capture.jsonl has kernel "claim-verdict", event_type "decision-capture" and rules ["issue-scoped"]
  And .faff/runs/run-1/events.jsonl still holds exactly one line
```

```holdout
Given the shared setup, FAFF_RUN_DIR=<abs path of .faff/runs/run-1>,
  FAFF_DECISION_CORRELATION_ID=run-1/FAFF-7/eligible/1, and FAFF_DECISION_ISSUE exported as the empty string
When `faff eligible --label faff-automate --label bug` runs
Then it exits 0 and stdout is exactly the line `true`
  And stderr has exactly one capture line, containing "capture suppressed: decision-capture event for kernel eligible refused by the issue-scoped rule"
  And the last line of .faff/logs/decision-capture.jsonl has kernel "eligible", event_type "decision-capture" and rules ["issue-scoped"]
  And .faff/runs/run-1/events.jsonl still holds exactly one line
```

## 8. Done

### From why
- [ ] A refused capture's stderr line and note name the event type, the kernel and the rule, in the format in section 3.

### From what
- [ ] Every `EVENT_SCHEMA` error thrown by `appendRecordUnderLock` has `rules`: `["issue-scoped"]` for an empty issue with a valid payload, `["payload-schema"]` for a good issue with a bad payload under the delivery profile, and `["issue-scoped","payload-schema"]` when both fail. `message`, `violations` and `code` are byte-identical to before for the same inputs.
- [ ] `test/faff-1353-write-core-issue-scoped.test.mjs` and `test/events.test.mjs` pass unmodified, and `faff events append` with `{"phase":"run","type":"decision-capture","issue":""}` still exits 1 with one `- <violation>` stderr line per violation.
- [ ] `lineSafe` unit cases: `"a\nb\tc"` gives `"a b c"`; `a`, U+2028 LINE SEPARATOR, `b` gives `"a b"`; `"a\u0085b"` gives `"a b"`; a 1024-byte ASCII string is returned unchanged; a 2000-byte ASCII string gives 1010 bytes plus `...[truncated]` (1024 bytes); a string of 600 copies of `é` (1200 bytes) gives at most 1024 bytes, no U+FFFD, and ends `...[truncated]`.
- [ ] A suppressed capture's note has exactly the keys `ts, run, note, reason, event_type, kernel, rules`, in that order; every other degraded-capture note has exactly `ts, run, note, reason`.
- [ ] `docs/guide/cli.md`'s `decision-capture` row carries the suppressed-capture sentence and the exit-code justification.

### From how
- [ ] The three sites (`record`, in-kernel, `action`) each produce the suppression reason for an empty issue, with event types `decision-capture`, `decision-capture`, `decision-capture-action`.
- [ ] A non-schema append failure still produces `journal append failed: <message>`: called with `{code: "EVENTS_LOCKED", message: "m"}`, `reportAppendFailure` writes a note whose reason is `journal append failed: m` and which has no `event_type` key. Export `reportAppendFailure` and `lineSafe` for the unit tests, as `effects-reconcile.js` exports `sanitizeDetail`.
- [ ] Each existing degraded-capture reason (config read, stdin, shape, run dir, chain head, empty correlation) is unchanged in text when it contains no control characters and is under 1024 bytes; `test/decision-capture.test.mjs:172-215`, `test/faff-989-decision-capture-driver.test.mjs` and `test/faff-1009-decision-capture-tier-wiring.test.mjs:138-176` pass unmodified.
- [ ] The comment at `decision-capture.js:454-458` no longer says the append always happens; it names the empty-issue half as decided by the write core and the empty-`correlation_id` half as deferred.
- [ ] `decision-capture.js` contains no test of `issueVal === ""` and no match on violation text to pick a rule.

### From edge cases
- [ ] With both `FAFF_DECISION_CORRELATION_ID` and `FAFF_DECISION_ISSUE` unset, `faff next` writes the empty-correlation note before the suppression note.
- [ ] The visible scenarios in section 5 pass as integration tests that spawn the CLI, including the `--kernel` line-feed scenario.
- [ ] For every kernel that calls `captureDecision` with `process.env.FAFF_DECISION_ISSUE || ""` (`next`, `project-next`, `claim-verdict`, `eligible`, `park-verdict`), a run with `FAFF_DECISION_ISSUE` unset, capture on, exits with the same code and prints the same stdout as with capture off.
- [ ] With capture off, no stderr capture line and no note are written on any of the paths above.
~~~~

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)**
- What's there: revision 3 is still about 1 to 2 days of work. The new piece is a writer change: `deriveHoldoutAggregate` moves from `contract-defs.js` into `holdout-record.js` (governance region), `buildHoldoutRecord` refuses an aggregate its criteria do not derive (about 6 lines), and one existing test in `test/holdout-record.test.mjs` reverses its assertion. Section 4 says this change "does not depend on the tier". On its own it is well under a day, so it is not a split candidate. It also belongs here: this ticket makes `criteria: []` a normal evaluator block, and the writer today accepts a `meets-spec` block of that shape. Shipping the tier rule without the guard would widen that hole. The ticket itself has not caught up. FAFF-1360's description and "Done when" still cover only the classifier: they mention no governance-region change, no moved function and no reversed test invariant, and they still list the live FAFF-1354 re-run, which the spec has moved to FAFF-1354 and FAFF-1270.
- Why it matters: anyone sizing or reviewing from the ticket expects a classifier change. A diff that also changes the record writer's refusal rules and a governance test will look like scope creep at code review, even though the spec justifies it.
- What to do: keep the ticket as one unit. Add one line to its description naming the writer refusal (ac-17, ac-18). Change the third "Done when" bullet to the offline `faff holdout record` proof, with the live re-run carried by FAFF-1354.

**Workstream fit? (principles 1 + 5)**
- What's there: FAFF-1360 still has no project. The cluster it belongs to has grown, and none of it has a project either:
  - FAFF-1292, FAFF-1293 and FAFF-1359, which serve the FAFF-1270 proving run;
  - FAFF-1361 (placeholder comparator), FAFF-1362 (DONE-item `integration:` prefix), FAFF-1363 (graft skip when nothing is judged) and FAFF-1364 (Scenarios units naming a test file), all now filed.
  
  Together they work toward one outcome: "a working feature's holdout verdict comes back meets-spec, and anything else names a real gap."
- Why it matters: nine tickets with no project can't be sequenced as a group. Nothing shows which of the four new follow-ups the proving run actually needs and which are refinements for later.
- What to do: run the rehoming pass over this cluster and propose one outcome-led home, with FAFF-1270 as its done-bar. This does not block building FAFF-1360.

**Deps surfaced? (principle 6)**
No issues. I checked the tracker:
- Every out-of-scope handoff now points at an existing Backlog ticket related to FAFF-1360: the placeholder comparator (FAFF-1361), the author `integration:` prefix (FAFF-1362), graft skipping a spec with nothing judged (FAFF-1363) and test-file Scenarios units (FAFF-1364).
- FAFF-1364 is a sibling of FAFF-1293 and is related to it. That closes the earlier gap where FAFF-1293's acceptance covered only prose units.
- `blocks FAFF-1354` is in place, and FAFF-1270 depends on this work through FAFF-1354.

One leftover pointer: section 6's last decision still says the comparator measurement is recorded "for a separate ticket", which could name FAFF-1361. It is cosmetic, because section 2 already points there.

**Risk profile? (principle 7)**
No issues. The classifier rule follows the existing `INTEGRATION_TIER_MARKERS` pattern. It has a measured footprint (55 of 1120 non-prose DONE items) and a stated way to detect and narrow a false match. The export signal is narrowed, with data-export phrasings pinned as null. The writer change is the riskier part, since it is a governance-region edit that reverses a stated invariant. That risk is contained:
- the writer refuses a disagreeing block and never rewrites it;
- a record it now refuses would already have been rejected by `computeHoldoutVerdict` at every gate that re-checks it;
- the move keeps one copy of the derivation and the require direction `faff regions check` allows;
- the spec says it was prototyped on `f711e6bf` with the related suites, selftests and `faff regions check` passing.

The live re-run still waits on FAFF-1359, but the offline proof gets this ticket's part of the risk out of the way early.

confidence: high
build-tier: complex
spec-review: accept (operator, 2026-10-21; round 3 returned reject-approach without converging: two minor items applied, the rest refuted or already addressed)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
