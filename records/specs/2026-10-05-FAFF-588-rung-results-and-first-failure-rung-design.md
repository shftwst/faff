# FAFF-588: rung results and first failure rung in the external-verification README

> Spec: faffter-dark-nlspec · 2026-10-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-588.

Revised 2026-10-05 after spec-review round 1 (architectural major: row statuses now checked against linked case evidence). Round 2 parked on minors; see the park comment below.

This spec covers FAFF-588 (re-scoped 2026-10-05). It is for the build agent and for human reviewers. The change is documentation plus tests: a rung results table, a derived first failure rung line and two sentences go into `verification/external-verification/README.md`, and one new `node:test` file checks the table and guards the frozen P1 case's pinned inputs. No rung is executed. Every codebase claim below was checked against `origin/main` at `b02fac1b`.

## 1. WHY

**The core idea:** the README already defines success as "the rung at which faff first fails is the binding constraint" (lines 9-10). It also tells operators to "Record the **first failure rung**" (lines 132-133). Nothing records it. This change adds a table with one scored row per rung and a first failure rung value that follows mechanically from that table. A CI test keeps the two consistent, so the value cannot be stated without the evidence that produces it.

**Problem.** No rung from P1 to P6 has a scored outcome a stranger can see. P1's only run is a retrospective backup with main result `inconclusive`, and its frozen re-run is registered but has not been executed. Recording honest values now ("inconclusive", "not-run", "undetermined") turns the suite's success metric from an instruction into a published, checked fact. That is what the Phase 0B gate FAFF-824 asks for when it says "External results, inputs, limitations, and human interventions are banked".

**Design principles**

- **The value is derived, never asserted.** The first failure rung line must equal what the stated rule computes from the table, and each row's status must equal what its linked case evidence says. If either could be hand-edited to disagree with what sits beneath it, it would be the same unbacked claim this ticket exists to remove.
- **Frozen means frozen.** EVP-L4-P1-0002's case README says "Changing a frozen field opens a new experiment identity, it does not amend this one." The guard test makes that cost visible at CI time. It does not paper over it.
- **No protocol change.** The v0.1 report schema's `first_failure` field records the protocol stage that failed within one case (registration, prerequisites, execution, capture, analysis). The suite's first failure rung is a different concept and lives only in the README. The two are never conflated, and the schema is not touched.

**Reference context**

| System | Language | Relevance |
|---|---|---|
| `verification/external-verification/README.md` | Markdown | The file being edited: "### Published cases" (line 24), "## The six rungs" (line 32), "## Scoring" (line 128) |
| `verification/external-verification/results/2026-08-29-l4-p1-link-shortener-faff-499/` | Markdown + evidence | P1 retrospective backup, EVP-L4-P1-0001. `report.md:120` has "Main result: inconclusive". Its README says not to add it to the parent results index |
| `verification/external-verification/results/2026-08-30-l4-p1-link-shortener-faff-499/` | Markdown | EVP-L4-P1-0002, registered and frozen but not executed. `report.md` pins four inputs by SHA-256 |
| `test/external-verification-protocol.test.mjs` | JS (`node:test`) | Style to mirror: in-test pure checker functions, `assert/strict`, `createHash("sha256")`, `REPO = path.join(HERE, "..")`, injected negatives |
| `test/faff-734-external-verification-case.test.mjs` | JS (`node:test`) | Ticket-prefixed test naming; reads committed files only. No assertion touches the README's Published cases table |
| `docs/reference/GLOSSARY.md` | Markdown | Naming decisions: `rung` is reserved for the L1 to L4 ladder and the P-levels are to become `tier`. Execution of that rename belongs to FAFF-74 |

**Scope.** This change sits in the external-verification suite's README and the unit test suite. Product code, the protocol, the scaffolders and case files are not touched.

## 2. OUT OF SCOPE

- **Executing any rung, including EVP-L4-P1-0002.** Why excluded: execution needs a claude-box cage, operator-held secrets, a durable SUT remote and operator attestation, and FAFF-830's prep owns the decision on FAFF-499's treatment. Extension point: the frozen case's README "How to run and fill it" steps. Afterwards that run updates the P1 row under the convention sentence.
- **The matched one-shot control comparison.** Why excluded: FAFF-830 owns it. Extension point: `verification/external-verification/faff-labs/experiments/results/` (`controls.manifest.json`, `controls-baseline.md`).
- **A rung field in the v0.1 report schema.** Why excluded: that is a protocol version change. Extension point: a future `protocol/v0.2/` beside `protocol/v0.1/`.
- **Reconciling `verification/external-verification/results/` with `verification/evidence/`.** Why excluded: a separate layout question. Extension point: a future ticket against both directory READMEs.
- **The bare Claude Code Commissaire capture (FAFF-1018).** Why excluded: it is a second-consumer proof, not a rung. Extension point: the README's "The config-free second consumer" section.
- **Renaming "rung" to "tier" for the P-levels.** Why excluded: the GLOSSARY assigns that sweep to FAFF-74, and the P1 scaffolder's "FIRST FAILURE RUNG" heredoc is frozen. Extension point: the heading and label constants at the top of the new test file, so a rename changes one place.
- **Updating the frozen case's `CAPTURE-CHECKLIST.md` to mention the rung row.** Why excluded: the Definition of done forbids changes to case files. The README convention sentence covers the obligation. Extension point: the checklist of the next registered case.
- **Detecting a rung case directory that exists but is not linked from its row.** Why excluded: case directory naming is not mandated by the protocol, so a name-based match would be guesswork. Extension point: the rung results checker in the new test file.
- **Retiring the frozen-input guard.** Why excluded: the inputs stay load-bearing for reproducibility even after the run. Extension point: the frozen-input test group, removed or moved by a future ticket that registers a successor case, or by FAFF-830 if its prep excludes EVP-L4-P1-0002 outright (that decision also updates the P1 row note).

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| rung | One row of the README's "The six rungs" table: P1 to P5 plus faff-lab (rung 6), in that table's row order. This is the README's existing usage; see "Which word names the P-levels in new prose" under Design decision rationale |
| rung label | `P<N>` for `scaffold-p<N>-<slug>.sh`, and `faff-lab` for `scaffold-faff-lab.sh` |
| rung status | The rung's scored RUNBOOK outcome, taken from one closed set (below) |
| first failure rung | The suite-level value derived from the rung statuses by the rule below. Not the v0.1 `first_failure` stage field |
| case directory | A directory directly under `verification/external-verification/results/` containing a `README.md` |
| case main result | The value on the first line matching `^Main result: (supports-hypothesis\|does-not-support\|inconclusive\|protocol-failure)\s*$` in the case's `report.md`, or in its `README.md` when it has no `report.md`. This is the line the v0.1 report template defines (`report-template.md:96`); `2026-08-29-…/report.md:120` reads `Main result: inconclusive` |
| executed case | A case directory that has a case main result. A registered case whose line still reads `Main result: CAPTURE (…)` (`2026-08-30-…/report.md:109`) is not executed |
| most recent executed case | Among a row's linked executed cases, the one whose directory name sorts last. Case directory names start with their `YYYY-MM-DD` date |
| frozen input | One of the four files whose SHA-256 is pinned in EVP-L4-P1-0002's `report.md` |

### Rung status set (closed)

```
ENUM RungStatus:
  pass          # an executed case scored the rung's RUNBOOK rubric a pass
                # (for P3 and P4, a pass is correct escalation or parking, per "Scoring")
  fail          # an executed case scored the rubric a fail
  inconclusive  # executed, but the case could not decide
                # (v0.1 main result inconclusive or protocol-failure)
  not-run       # no executed case exists for this rung
```

The case main result maps to a rung status as follows: `supports-hypothesis` to `pass`, `does-not-support` to `fail`, and `inconclusive` or `protocol-failure` to `inconclusive`. When a rung has several linked cases, its status is the mapped main result of the most recent executed case. Registered cases that have not been executed may be linked, but they never change the status. A row with no linked executed case is `not-run`. The test enforces all of this (`RUNG_STATUS_UNSUPPORTED`), so a row cannot claim an outcome its linked evidence does not record.

### Rung results section (README)

A new `### Rung results` heading goes inside "## Protocol and results", directly after the Published cases paragraph that ends at README line 30, and before `## The six rungs`.

```
RECORD RungResultsRow:          # one table row; six rows in total
  rung: RungLabel               # P1..P5, faff-lab; must match the script per the label rule
  script: CodeSpan              # byte-identical to the "Script" cell of "The six rungs" at the same row position
  status: CodeSpan<RungStatus>  # one backticked token from the closed set
  cases: "none" | List<Link>    # comma-separated links, each `[`results/<dir>/`](results/<dir>/README.md)`
  note: Text                    # one line

  CONSTRAINT rows in the same order and count as "The six rungs" table
  CONSTRAINT status in {pass, fail, inconclusive} implies cases != "none"
  CONSTRAINT every linked target is results/<dir>/README.md, has no "..", exists on disk,
             and resolves (realpath) inside verification/external-verification/results/
  CONSTRAINT status == mapped main result of the most recent linked executed case,
             or not-run when no linked case is executed
```

Table header: `| Rung | Script | Status | Cases | Note |`.

Today's rows:

| Rung | Status | Cases | Note (substance, builder words it) |
|---|---|---|---|
| P1 | `inconclusive` | both `2026-08-29-…` and `2026-08-30-…` case directories | Retrospective backup of the 2026-08-29 run (EVP-L4-P1-0001), not a published result; frozen re-run EVP-L4-P1-0002 registered, not yet executed |
| P2, P3, P4, P5, faff-lab | `not-run` | `none` | Never run |

Under the table, three items:

1. **First failure rung line**, exactly in the form `**First failure rung:** `<value>``, where `<value>` is a rung label, `none` or `undetermined`. Today it reads `undetermined`.
2. **Derivation rule sentence**, in substance: "The first failure rung is the lowest rung whose status is `fail` while every lower rung is `pass`. It is `none` only when all six rungs pass, and `undetermined` otherwise, so a single P1 pass can never yield `none`."
3. **Convention sentence**, in substance: "Any run of a rung updates its row and the first failure rung line, win or fail, in the same change that publishes its case."

The retrospective P1 case stays out of the Published cases table. The rung results table is a separate index, and the P1 note states plainly that the case is not a published result. That respects the case README's instruction not to cite it as a positive proof or add it to the results index.

### Scoring section (README)

Add one harness-repair sentence (two at most) to "## Scoring". Its substance: before any rung was scored, attempted use alone found that the P2 and P4 runbooks cited `faff prd` verbs that do not exist (FAFF-512, with FAFF-507 closed as its duplicate), and that the `.faffrc.yaml` files scaffolded for P1 to P3 were refused by the L4 preflight (FAFF-513). Defects like these surface only when someone tries to run a rung, which is the argument for running rungs early. Ticket IDs are allowed here: `faff lint-refs` scans only `docs/guide/**` and `plugin/skills/*/SKILL.md`, and this README already cites FAFF-472, FAFF-547 and FAFF-1018.

### New test file

`test/faff-588-external-verification-rungs.test.mjs` is discovered by the existing `unit` job (`node --import ./test/hermetic-env.mjs --test --test-shard=N/4`). It reads committed files only and makes no network calls.

```
INTERFACE (in-file, pure):
  parseTableAfterHeading(markdown, heading) -> { header: List<Text>, rows: List<List<Text>> }
      # throws if the heading is absent or no table follows it
  checkRungResults(readmeText, readCaseFile: (caseDir, fileName) -> Text | null) -> List<Violation>
      # readCaseFile returns null when the file is absent or the case dir does not resolve
      # (realpath) inside verification/external-verification/results/
  caseMainResult(readCaseFile, caseDir) -> MainResult | null      # null = not executed
  deriveFirstFailure(statuses in rung order) -> RungLabel | "none" | "undetermined"

ENUM Violation code (prefix of each message; the message names the offending row or value):
  RUNG_SECTION_MISSING     # heading, table or first failure line absent
  RUNG_ROWS_MISMATCH       # count, order or Script cell differs from "The six rungs"; or label does not match script
  RUNG_STATUS_UNKNOWN      # status not a single backticked token from the closed set
  RUNG_CASE_REQUIRED       # pass, fail or inconclusive with Cases "none" or no link
  RUNG_CASE_MISSING        # link malformed, outside results/, contains "..", escapes results/ by symlink, or target README.md absent
  RUNG_STATUS_UNSUPPORTED  # status differs from the mapped main result of the most recent linked executed case,
                           # or a scored status with no linked executed case
  FIRST_FAILURE_MISMATCH   # line value differs from deriveFirstFailure(statuses)

RECORD FrozenInput:              # four constants in the test
  role: Text                     # "PRD", "P1 scaffolder", "assertion harness", "protocol README"
  path: RepoRelativePath
  sha256: Hex64
```

The four pins (re-hashed on `origin/main` at `b02fac1b`, all matching):

| Role | Repo-relative path | SHA-256 |
|---|---|---|
| PRD | `verification/external-verification/results/2026-08-30-l4-p1-link-shortener-faff-499/evidence/prd.md` | `1a7ad6627d14f369f2e176cb40276f277b5446bccc3e8a7f4f7290a49cf3d7a7` |
| P1 scaffolder | `verification/external-verification/scaffold-p1-link-shortener.sh` | `ae2016e429092a6de675ef5e0a36e2631b43ad38c3892a90ed1d980052d01674` |
| assertion harness | `verification/external-verification/assert-p1-top-of-loop.sh` | `3e19e987c9687077e52179a64564cb0163930a8377f319c978bdbd451295e1b7` |
| protocol README | `verification/external-verification/protocol/v0.1/README.md` | `2082af1f485d3b938eabf8cd80480b2384cf411d93d72b2b93c86050638681a8` |

## 4. HOW

### Rung results check

Summary: parse both README tables by heading, compare them row by row, validate each row against its linked case evidence, then recompute the first failure rung and compare it with the published line.

```
PROCEDURE checkRungResults(readmeText, readCaseFile):
  1. six   = parseTableAfterHeading(readmeText, "## The six rungs")
     rungs = parseTableAfterHeading(readmeText, "### Rung results")
     IF either throws: RETURN [RUNG_SECTION_MISSING]
  2. Trim every cell. Read the Script column of each table by header name, not by position.
  3. IF row counts differ, OR any position i has rungs.Script[i] != six.Script[i]:
       add RUNG_ROWS_MISMATCH (name the first differing position)
  4. FOR each rungs row:
     a. IF the Rung label != labelFor(Script): add RUNG_ROWS_MISMATCH
     b. status = Status cell with surrounding backticks removed;
        IF the cell is not exactly one backticked token in {pass, fail, inconclusive, not-run}:
          add RUNG_STATUS_UNKNOWN
     c. links = every markdown link target in the Cases cell
        IF the Cases cell is neither exactly "none" nor ≥1 link: add RUNG_CASE_MISSING
        IF status in {pass, fail, inconclusive} AND links is empty: add RUNG_CASE_REQUIRED
        FOR each target: IF it does not match results/<one segment>/README.md,
                         OR contains "..", OR readCaseFile(<segment>, "README.md") is null:
                           add RUNG_CASE_MISSING
     d. executed = [(dir, caseMainResult(readCaseFile, dir)) for each linked dir, keeping non-null]
        expected = "not-run" IF executed is empty
                   ELSE mapStatus(main result of the entry with the greatest dir name)
        IF status is in the closed set AND status != expected: add RUNG_STATUS_UNSUPPORTED
  5. The Rung results section runs from the "### Rung results" heading to the next line starting with "#".
     line = the first line in that section matching
            ^\*\*First failure rung:\*\* `([^`]+)`
     IF none is found: add RUNG_SECTION_MISSING
     ELSE IF captured value != deriveFirstFailure(statuses in row order): add FIRST_FAILURE_MISMATCH
  6. RETURN violations

FUNCTION caseMainResult(readCaseFile, dir):
  text = readCaseFile(dir, "report.md") ?? readCaseFile(dir, "README.md")
  m = first line of text matching ^Main result: (supports-hypothesis|does-not-support|inconclusive|protocol-failure)\s*$
  RETURN m ? m.value : null

FUNCTION labelFor(script):
  "scaffold-faff-lab.sh"      -> "faff-lab"
  "scaffold-p<N>-<slug>.sh"   -> "P<N>"
  anything else               -> no label (fails 4a)

FUNCTION deriveFirstFailure(rows in order):
  FOR each row:
    IF status == pass: continue
    IF status == fail: RETURN row.rung
    RETURN "undetermined"          # inconclusive, not-run or unknown blocks the derivation
  RETURN "none"                    # reached only if all six rows pass
```

In the real run, `readCaseFile` resolves `results/<dir>/<file>` under `verification/external-verification/`, takes the realpath, and returns null unless it sits inside the realpath of `results/`. Injection tests pass a stub reader over an in-memory map. Script cells are compared after trimming, with backticks kept, so the comparison is byte-identical in content.

### Frozen-input guard

Summary: re-hash four committed files, and confirm the frozen report still states each pin.

```
PROCEDURE checkFrozenInputs():
  report = read the 2026-08-30 case's report.md
  FOR each FrozenInput:
    1. actual = sha256(raw bytes of path)     # bytes, not utf8-decoded text
    2. IF actual != sha256:
         FAIL "<role> <path> changed (expected <sha256>, got <actual>).
               EVP-L4-P1-0002 is frozen: changing a pinned input opens a new experiment identity
               (register a new case under results/), it does not amend this one.
               Revert the change, or register a successor case and move this guard to it."
    3. IF report does not contain the sha256 string:
         FAIL "<role> pin <sha256> no longer appears in the frozen report.md; frozen sections must not be edited."
```

The report is checked for each hash string only. Hashing `report.md` itself would break when the CAPTURE fields are filled in after the run.

### Edge cases

- **Table formatting.** Leading and trailing pipes, alignment padding and `|---|` separators are all tolerated. No cell in either table contains an escaped pipe today. A future escaped pipe in a Note cell is out of contract and would show up as a column-count mismatch (`RUNG_ROWS_MISMATCH`).
- **Duplicate first failure lines.** Only the first match in the Rung results section counts. A second, disagreeing line is not detected. Acceptable, because review catches it.
- **The faff-lab row in "The six rungs"** has a Tracker cell containing a markdown link with parentheses. Columns are read by header name, so this does not matter.
- **An unknown status** reports `RUNG_STATUS_UNKNOWN` and also makes the derivation `undetermined`. Both violations may appear, which is fine. `RUNG_STATUS_UNSUPPORTED` is not reported for an out-of-set token.
- **A case with both `report.md` and `README.md`** is read from `report.md` only. The Fly.io case (not a rung) keeps its main result in `README.md`, which is why the fallback exists.

### Failure modes

- **The parser is stricter than the prose.** How you'd know: a harmless README edit (rewrapping, alignment) turns the test red. What it means: narrow the parser (more trimming), not the invariants.
- **The guard blocks routine edits.** A FAFF-74 vocabulary sweep or a typo fix in `protocol/v0.1/README.md` or `scaffold-p1-link-shortener.sh` fails CI. How you'd know: the failure message names the re-registration cost. What it means: proceed. Making that cost visible is the point.
- **A rung runs but its row is never updated.** How you'd know: a new `results/<dir>/` for a rung appears in a PR with no matching Rung results diff. The test cannot see an unlinked case (see Out of scope). What it means: review enforces the convention sentence. Once the case is linked, the test does enforce that the status matches it.
- **A linked case is executed but its main result line is reworded.** How you'd know: `RUNG_STATUS_UNSUPPORTED` fires because the case reads as not executed. What it means: restore the template's `Main result:` line form.

**Anti-pattern:** reading the first failure value from `reports/0001.json` `first_failure`. Why: that field records a protocol stage within one case, not a rung, and neither P1 case has a `reports/` directory.

**Anti-pattern:** adding the retrospective P1 case to the Published cases table. Why: its README forbids it, and the rung results table is the place to cite it, with its status.

## 5. Scenarios

```
Given the Rung results table lists P1 pass, P2 fail and the rest not-run
When the first failure rung is derived
Then the value is P2
```

```
Given the Rung results table lists P1 inconclusive and P2 fail
When the first failure rung is derived
Then the value is undetermined, because a lower rung is not pass
```

```
Given the Rung results table lists P1 pass and every other rung not-run
When the first failure rung is derived
Then the value is undetermined, never none
```

```
Given all six rungs are pass
When the first failure rung is derived
Then the value is none
```

```
Given P1's row says `pass` and links only the 2026-08-29 case, whose report.md reads "Main result: inconclusive"
When checkRungResults runs
Then it reports RUNG_STATUS_UNSUPPORTED for P1
```

```
Given a row's status is the out-of-set token `passed`
When the first failure rung is derived
Then the value is undetermined, and RUNG_STATUS_UNKNOWN is reported
```

```
Given a copy of the frozen report.md with one pinned hash string removed
When the frozen-input cross-check runs against that copy
Then it fails, naming the role whose pin is missing
```

```
Given scaffold-p1-link-shortener.sh is edited by one byte
When the unit suite runs
Then the frozen-input test fails, and its message names EVP-L4-P1-0002 and says a changed input opens a new experiment identity
```

- The new test reads committed files only and makes no network request.

## 6. Design decision rationale

**Which word names the P-levels in new prose?**
- `rung` matches the issue's Definition of done ("rung results table", "first failure rung"), the README section it sits beside ("The six rungs"), the Scoring text and the six scaffolder heredocs. The P1 scaffolder heredoc is a frozen input, so it cannot be renamed without re-registration.
- `tier` follows `docs/reference/GLOSSARY.md` "Naming decisions" (rung reserved for L1 to L4). Using it here alone would leave a README that says "tiers" in one section and "rungs" in the next, and it would contradict the ticket's own acceptance wording.

**Chosen:** `rung`. The issue's 2026-10-05 scope is the newer and more specific instruction, and internal consistency of one README outweighs a partial rename. FAFF-74 owns the sweep. The test keeps headings and labels in constants so the sweep changes one place.

**Which statuses does the table allow?**
- Four (`pass`, `fail`, `inconclusive`, `not-run`) cover every state the protocol can produce, plus "no run".
- Adding `registered` would split `not-run` on a fact the Cases column already shows (a linked, unexecuted case). It would also make the derivation rule treat two blocking states differently for no gain.

**Chosen:** the four-status closed set, with the v0.1 main result mapping in the WHAT section.

**How is each row identified?**
- A Script column alone is mechanical but unreadable for "P1 is inconclusive".
- A Rung label alone needs a hidden mapping to the six-rungs table.
- Both columns: Script compared byte for byte with "The six rungs", and Rung derived from Script by a stated rule.

**Chosen:** both columns, `| Rung | Script | Status | Cases | Note |`.

**How are multiple cases per rung shown, and which one sets the status?**
- Status follows the most recent executed case, and unexecuted registered cases are linked for visibility. This gives P1 `inconclusive` with both directories, as the Definition of done requires.
- The alternative, one case per row, would hide the registered re-run.

**Chosen:** comma-separated case links; status follows the most recent executed case.

**How is a status tied to its evidence?**
- Checking only that a link exists lets a row say `pass` beside a case whose report says `inconclusive`.
- Reading the linked case's `Main result:` line, the form the v0.1 template fixes, lets the test recompute the status the same way it recomputes the first failure rung. It reads committed text only and needs no schema change.

**Chosen:** the test derives each row's expected status from its most recent linked executed case and reports `RUNG_STATUS_UNSUPPORTED` on disagreement.

**Can a scored status stand without a case?**
- Allowing `pass` or `fail` with Cases `none` would permit exactly the unbacked claim this ticket removes.
- Requiring a case costs nothing today, because P1 already links two.

**Chosen:** `pass`, `fail` and `inconclusive` require at least one case link; `not-run` may link registered cases or say `none`.

**Where does the derivation rule live, and what does the line look like?**
- README prose states the rule for readers, and the test re-implements it as the enforcement.
- A fixed line form (`**First failure rung:** `<value>``) makes the parse exact.

**Chosen:** the rule in README prose directly under the table, enforced by `deriveFirstFailure` in the test.

**Where does the checker code live?**
- A new module under `plugin/skills/faff/bin/lib/` would be runtime surface with no runtime caller.
- Pure functions inside the test file match `test/external-verification-protocol.test.mjs` (`deriveResult`, `validateReport`, `checkEvidencePath`).

**Chosen:** pure functions inside the test file. Injection tests call them on mutated README text and a stubbed existence check.

**How are the tables parsed?**
- A heading-anchored parse of the first table after an exact heading, with columns read by header name, fails loudly when the heading is missing.
- A whole-file regex for script names would pass if a table were deleted.

**Chosen:** the heading-anchored parse, failing with `RUNG_SECTION_MISSING`.

**Where do the frozen hashes come from?**
- Parsing `report.md` keeps one source, but the report mixes formats (bullets, a table, a case-relative PRD path). If someone edited the report to "fix" a hash, the parse would silently accept the drift.
- Hard-coding the four pins and cross-checking that `report.md` still contains each hash catches both input drift and report edits.

**Chosen:** four hard-coded pins plus a report-contains-hash cross-check.

**One test file or two?**
- Both checks concern the same evidence surface and the same ticket.
- Ticket-prefixed naming matches `test/faff-734-external-verification-case.test.mjs`.

**Chosen:** one file, `test/faff-588-external-verification-rungs.test.mjs`, with a rung results group and a frozen-input group.

**Should the test assert the convention and harness-repair sentences?**
- Asserting prose wording makes harmless rewording fail CI.
- The issue's step 5 lists the invariants, and the sentences are not among them.

**Chosen:** not asserted by the test. Their presence is a Definition of done item checked by review or grep.

## 7. Open questions and assumptions

**Open questions:** none. Every decision above is closed.

**Assumptions:** none. Every file, hash, heading and line reference was verified on `origin/main` at `b02fac1b`.

## Already shipped against this surface

| Ticket | What shipped | Bearing on this spec |
|---|---|---|
| FAFF-743 (PR #715) | Protocol v0.1, report template, schema, synthetic example; README "Protocol and results" section and the `results/<case>/` convention | The results-directory convention is done. This spec adds the rung index beside it |
| FAFF-734 | Fly.io L3 case `results/2026-08-12-fly-l3-faff-472/` and the Published cases row (`does-not-support`) | Not a rung. Stays the only Published cases row |
| FAFF-756 (PR #581) | Retired the broken `design/` brief link; `docs/external-verification/` no longer exists | The original "fix the link" clause is done |
| FAFF-499 | Both P1 case directories: the 2026-08-29 retrospective backup (EVP-L4-P1-0001, `inconclusive`) and the 2026-08-30 frozen registration (EVP-L4-P1-0002, unexecuted) | Supplies P1's row and the four pinned inputs the guard protects |
| FAFF-512, FAFF-513 (FAFF-507 duplicate) | Scaffolder and runbook repairs found by attempted use | Source of the harness-repair sentence |
| FAFF-822 | Phase 0 reference matrix under `verification/evidence/` | Not a rung run; reconciling the two trees is out of scope |
| FAFF-360 | "The config-free second consumer" section | Explicitly not a rung; no row |
| Controls (owner FAFF-830) | `faff-labs/experiments/results/controls.manifest.json`, `controls-baseline.md` | Control comparison is out of scope |

Premise outcome: partially delivered. The issue body was already narrowed to what remains: rung outcomes, the first failure rung, the harness-repair sentence and the freeze guard.

## 8. DONE

### From WHY
- [ ] `verification/external-verification/README.md` publishes a first failure rung value that `deriveFirstFailure` computes from the rung results table (today `undetermined`).

### From WHAT (README content)
- [ ] A `### Rung results` heading sits inside "## Protocol and results", after the Published cases paragraph and before `## The six rungs`.
- [ ] Its table has header `| Rung | Script | Status | Cases | Note |` and six rows whose Script cells equal "The six rungs" Script cells in order.
- [ ] Rung labels are P1, P2, P3, P4, P5, faff-lab.
- [ ] P1 status is `inconclusive`, and its Cases cell links both `results/2026-08-29-l4-p1-link-shortener-faff-499/README.md` and `results/2026-08-30-l4-p1-link-shortener-faff-499/README.md`. Its note says the first is a retrospective backup and not a published result, and that the second is registered and not yet executed.
- [ ] P2, P3, P4, P5 and faff-lab are `not-run` with Cases `none`.
- [ ] The line `**First failure rung:** `undetermined`` is present, followed by the derivation rule sentence (lowest `fail` with every lower rung `pass`; `none` only when all six pass; otherwise `undetermined`).
- [ ] The convention sentence (any run updates its row and the first failure rung line, win or fail, in the same change that publishes its case) is present in the Rung results section.
- [ ] The "## Scoring" section contains the harness-repair sentence, citing FAFF-512 and FAFF-513 and arguing for running rungs early.
- [ ] The Published cases table is unchanged (still one row, the FAFF-472 case).

### From WHAT (test)
- [ ] `test/faff-588-external-verification-rungs.test.mjs` exists, uses `node:test` and `node:assert/strict`, and reads committed files only.
- [ ] `checkRungResults` on the committed README returns no violations, and `caseMainResult` reads `inconclusive` for the 2026-08-29 case and null for the 2026-08-30 case.
- [ ] The four pins in the test equal the four hashes listed in this spec.

### From HOW (rung results check, each injected violation fails)
- [ ] Removing the `### Rung results` heading yields `RUNG_SECTION_MISSING`.
- [ ] Removing the first failure rung line yields `RUNG_SECTION_MISSING`.
- [ ] Deleting a row, swapping two rows, or changing one Script cell yields `RUNG_ROWS_MISMATCH`.
- [ ] Changing a Rung label so it no longer matches its script (P2 to P3) yields `RUNG_ROWS_MISMATCH`.
- [ ] Changing a status to an out-of-set token (`passed`) yields `RUNG_STATUS_UNKNOWN`.
- [ ] Setting a row to `pass` with Cases `none` yields `RUNG_CASE_REQUIRED`.
- [ ] Pointing a case link at a nonexistent `results/<dir>/README.md`, or at a path containing `..`, yields `RUNG_CASE_MISSING`.
- [ ] Changing P1's status to `pass` (or `not-run`) on today's table yields `RUNG_STATUS_UNSUPPORTED`.
- [ ] A stub case whose report reads `Main result: does-not-support`, linked from a row marked `pass`, yields `RUNG_STATUS_UNSUPPORTED`; the same row marked `fail` yields none.
- [ ] A case link whose directory is a symlink resolving outside `results/` yields `RUNG_CASE_MISSING` (stub reader).
- [ ] Changing the first failure rung line to `none` (or `P1`) on today's table yields `FIRST_FAILURE_MISMATCH`.
- [ ] `deriveFirstFailure` returns `P2` for [pass, fail, not-run x4], `undetermined` for [inconclusive, fail, …], `undetermined` for [pass, not-run x5], `none` for six `pass`, and `P1` for [fail, …].

### From HOW (frozen-input guard)
- [ ] The guard re-hashes the four raw files and passes on the committed tree.
- [ ] With one pinned file's hash mismatched (injected through a stubbed reader or a temp copy, never by editing the committed file), the guard fails with a message naming the role, path, EVP-L4-P1-0002 and the new-experiment-identity cost.
- [ ] Removing a pin's hash string from a copy of `report.md` makes the cross-check fail.

### From OUT OF SCOPE (no-change guarantees)
- [ ] `git diff --stat origin/main` touches only `verification/external-verification/README.md` and the new test file (plus the committed spec and run anchor that graft adds). Nothing under `protocol/`, no `scaffold-*.sh`, no file under `results/`, and no `assert-p1-top-of-loop.sh` changes.

### Handoffs (tracker, posted when the PR opens)
- [ ] A comment on FAFF-74 names the rung-to-tier reservation, the constants in the new test file, and the rule that the P1 scaffolder heredoc is a frozen input.
- [ ] A comment on FAFF-830 says its consume-or-exclude decision on EVP-L4-P1-0002 must update the P1 row note and move or remove the frozen-input guard.
- [ ] A comment on FAFF-824 says this change publishes an honest null (P1 `inconclusive`, the rest `not-run`, first failure rung `undetermined`), not the evidence itself.

### Suite
- [ ] `node --import ./test/hermetic-env.mjs --test test/faff-588-external-verification-rungs.test.mjs`, `test/external-verification-protocol.test.mjs` and `test/faff-734-external-verification-case.test.mjs` pass.
- [ ] The full suite passes: `node --import ./test/hermetic-env.mjs --test`.

### Integration smoke test

```
1. On the feature branch, run the new test file → all green.
2. In an in-memory copy of the README text with a stub reader (inside an injection test), give P1 a stub
   case reading `supports-hypothesis` and status `pass`, give P2 a stub case reading `does-not-support`
   and status `fail`, leaving the line at `undetermined` → checkRungResults returns exactly
   FIRST_FAILURE_MISMATCH (derived value is P2).
3. Run the full unit suite → green.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Verdict: build as scoped. Right-sized, in the right project, low technical risk.

- **Right-sized:** no issues. One README edit plus one test file with two groups (rung table checker, frozen-input guard), about one to two days. If review of the parser drags, the guard is the piece to split out.
- **Workstream fit:** no placement issues. The spec deliberately uses `rung` for the P-levels although `docs/reference/GLOSSARY.md` reserves it for L1 to L4; accepted, with the names kept in constants.
- **Dependencies surfaced:** the blocker graph is honest (blocks FAFF-824, nothing blocks this). Two outward handoffs are not encoded on the receiving tickets: FAFF-74's body does not mention the rung-to-tier sweep or the frozen P1 scaffolder heredoc, and FAFF-830's prep does not know its consume-or-exclude decision on EVP-L4-P1-0002 must update the P1 row and move or remove the guard. Action at merge: comment on FAFF-74 and FAFF-830.
- **Risk profile:** low technical risk, no spike. Value risk: the table will read an honest null (P1 `inconclusive`, the rest `not-run`, first failure rung `undetermined`) for some time, which points FAFF-824 toward its "Narrow" outcome; say so when closing. Friction risk: the guard fails CI on any byte change to the four pinned inputs, by design.

confidence: high
build-tier: complex
## Build addendum: maintainer decision 2026-10-05

Spec-review round 2 rejected on three minors after round 1's major was fixed. The maintainer accepted the spec past that reject ("keep the pin, protocol edits go to v0.2; accept and build") and made the three minors build requirements. Where this addendum and the sections above disagree, this addendum wins.

1. **Protocol README pin and its edit path (architectural and methodology minors).** The frozen-input guard keeps pinning `verification/external-verification/protocol/v0.1/README.md` alongside the PRD, P1 scaffolder and assertion harness. Its failure message is role-specific:
   - When the protocol README changes, the message directs the change to a new `protocol/v0.2/` beside v0.1 and says v0.1 stays byte-for-byte frozen. It also names the cost for the other three pinned inputs: changing the PRD, P1 scaffolder or assertion harness opens a new experiment identity, so a successor case must be registered under `results/` and the guard moved to it. This is the same versioning the facade reference uses (FAFF-1175).
   - When any other pinned input changes, the message keeps the section 4 wording: EVP-L4-P1-0002 is frozen, a changed input opens a new experiment identity, revert or register a successor case.
   - The "guard blocks routine edits" failure mode's action is no longer "proceed": a protocol edit goes to `protocol/v0.2/`, and a change to any other pinned input is reverted or re-registered.
   - The FAFF-74 handoff comment also states that the vocabulary sweep must not edit `protocol/v0.1/README.md` in place; protocol wording changes ship as `protocol/v0.2/`. Assumption recorded: FAFF-74's sweep honours that path.
2. **Real symlink fixture (QA minor).** The containment check in the real case reader is exercised against a real filesystem, not only a stub. The reader is built by `makeCaseReader(resultsRoot)`, used for the committed tree with the real `results/` directory. The test builds a temporary directory with a `results/` folder holding one ordinary case, one symlinked case that stays inside `results/`, and one symlink whose target sits outside `results/` with its own `README.md`. The escaping link reads as null and `checkRungResults` reports `RUNG_CASE_MISSING` for it; the inside link reads normally. The temporary directory is removed after the test. "Reads committed files only" applies to the repository: the test writes nothing inside the repo and makes no network request.
3. **Done items affected.** The section 8 item "A case link whose directory is a symlink resolving outside `results/` yields `RUNG_CASE_MISSING` (stub reader)" is met with the real temporary-directory fixture above. The frozen-input guard item gains: a protocol README mismatch yields a message naming `protocol/v0.2/` and the re-registration cost of the other pinned inputs.
