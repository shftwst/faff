# Code-review round records and their collation into review-verdict.json (FAFF-1268)

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1268.

> Revised on 2026-10-15: FAFF-1277 shipped the `ac-checklist` writer, the `--terminal-only` review writer with its `evidence-terminal-only` event, null-as-absent in the normaliser and the Step 8 edit, so they leave this spec. FAFF-1276 changes the interface: the round recorder stores `carried_id` and resolves ids with `resolveRoundChain`. The eval gate now reads FAFF-1276's carried-mode result. Spec-review rounds 3 and 4 added the judge-admit write, the `--prior-dir` handle translation, the corrupt-round exit 2 and the latest-occurrence location. Round 5 allowed `--park needs-human` with no rounds and defined an empty `--prior-dir`.

This spec is for the build agent picking up FAFF-1268, part 2b of the FAFF-1257 split under FAFF-1255, and for its reviewers. Graft records every code-review pass as a round record, and a CLI writer collates the recorded rounds into `review-verdict.json`, including on the two park paths. FAFF-1276 (2a-ii) supplies the finding identity this collation merges on; FAFF-1277 supplied the writer core this slice extends.

## 1. WHY

**The idea the rest depends on.** A code-review finding keeps one id across rounds because each reviewer pass names the previous round's finding it is re-raising (`carried_id`, a `P<k>` handle), and FAFF-1276's `resolveRoundChain` accepts that claim only when it holds. This slice records every Step 9 pass as `review-rounds/round-<n>.json` with the reviewer's `carried_id`, then merges the rounds on the chain-resolved id into one `review-verdict.json`, so a fail, fix, re-review loop anchors every distinct finding with an honest settled outcome.

**Problem.** Since FAFF-1277, graft writes `review-verdict.json` from the terminal pass only (`round_history: "terminal-only"`), so findings raised and fixed in earlier passes leave no durable trace, and the outage park still hand-writes a raw block that is not v0.3-valid. After this slice every pass is recorded, the terminal and park writes collate them, and no SKILL prose serialises `review-verdict.json`. Nothing refuses yet: enforcement at mint is FAFF-1261.

### Design principles

- **The merge gate does not move.** `faff merge-gate` keeps routing on `signal` (`readReviewVerdict`, `merge-gate.js` ~781). New fields are invisible to it.
- **Nothing a reviewer raised is lost.** Every finding from every recorded pass appears in some merged finding's `occurrences`, and two findings from the same pass never merge.
- **A file never claims a settlement the review did not reach.** A finding is stamped `fixed` only when the loop ended in `pass`.
- **Only `resolveRoundChain` decides identity.** A supplied `finding_id` is ignored; a `carried_id` counts only as `resolveRoundChain` accepts it, and a handle is never resolved against a round other than the one the reviewer was shown.
- **Governance code never requires factory code.** The new code lives in `region:governance` (`evidence.js`, `evidence-collate.js`) and requires only `finding-id.js`, `redact.js`, `events.js` and the bundled v0.3 schemas.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `bin/lib/evidence.js` `guardWriterPaths`, `writeEvidenceFile`, `anchoredTerminalReview`, `terminalReviewRefusal`, `writeTerminalReviewVerdict`, `cmdEvidenceWrite`, `WRITERS`, `USAGE` (FAFF-1277) | CJS JS | The writer core reused; the bare form that today exits 2 ("round collation is not available yet") |
| `bin/lib/evidence-collate.js` (FAFF-1267), region governance | CJS JS | Home of the pure `collateReviewRounds` beside the spec-review collator |
| `bin/lib/finding-id.js` `resolveRoundChain`, `resolveCarriedIds`, `normaliseFindingPath` (FAFF-1276, not yet built) | CJS JS | The identity rule this slice calls |
| `bin/lib/redact.js` `redactKnownSecrets`, `resolveKnownSecretValues` | CJS JS | Write-time redaction, as the FAFF-1277 writers apply it |
| `bin/lib/contract-defs.js` `computeReviewVerdict` (~84), `contracts/review-verdict.schema.json` | CJS JS, JSON Schema | Normaliser that gains typed pass-through of the collation fields |
| `contracts/evidence-v0.3/schema/review-round.schema.json`, `review-verdict-anchored.schema.json`, and the byte-identical `verification/evidence/v0.3/` copies | JSON Schema | Round record shape (not a manifest entry) and anchored verdict shape |
| `contracts/evidence-v0.3/evidence-documents.md` (both copies), `docs/guide/cli.md` (~198) | Markdown | The "Until FAFF-1268" paragraph and the writer table row this slice rewrites |
| `faff-graft/SKILL.md` Step 3 resume-store fallback (~201), Step 9 `unavailable` disposition (~508-510), `built-but-not-admitted` hold (~516-519), judge not-admit (~504), "Terminal verdict → a floor artifact" (~526) | Markdown | Every write point this slice changes |
| `faff-beep-boop/SKILL.md` `review_adversarial_skipped` | Markdown | Reads `adversarial_outcome` from `review-verdict.json`; unchanged |
| `bin/lib/validate-adapters.js` `SKILL_LINE_BASELINE` (`faff-graft` 960; the file is 959 lines on 4839e550) | CJS JS | Line cap the SKILL edits must respect |
| `test/evidence-write.test.mjs` | Node test | Holds the bare-form exit-2 test this slice replaces |

**Scope.** This slice sits between the code-review producers and the run dir; the reviewers, the prior-findings list, the mint, governance-check and merge gate are unchanged.

## Already shipped against this surface

- **FAFF-1277** (Done): `faff evidence write ac-checklist`, `faff evidence write review-verdict --terminal-only` with its `evidence-terminal-only` event, null-as-absent in `computeReviewVerdict`, the graft Step 8 writer call and the Step 9 `--terminal-only` call. This slice extends the same `evidence.js` and replaces the Step 9 call.
- **FAFF-1266** (Done): `title`, `location`, `action` per finding, `finding-id.js`, and the title-stability eval whose failure (0.46) led to FAFF-1276.
- **FAFF-1267** (Done): `evidence-collate.js` and the spec-review collator, whose collation shape (`first_round`, `last_round`, `occurrences`) this slice mirrors.
- **FAFF-1146**, **FAFF-1155** (Done): per-finding enrichment fields and the per-PR floor requiring `review-verdict.json`. Unchanged.

None of these delivers the premise; it still holds, narrowed to round recording, collation, the park writes, the normaliser pass-through and the resume carry.

## 2. OUT OF SCOPE

- **The reviewer `carried_id` field, `faff review-prior`, `resolveRoundChain` and the carried-mode eval.** Why: FAFF-1276. Extension point: `finding-id.js` and `review-prior.js`.
- **The `carried_id` property in `review-round.schema.json`.** Why: FAFF-1276 adds it (required, `string | null`). Extension point: this slice only writes it.
- **`write ac-checklist`, the Step 8 edit and the `evidence-terminal-only` event type.** Why: shipped by FAFF-1277. This slice leaves `--terminal-only` in the CLI for manual recovery; graft stops calling it.
- **The build-review dialogue loop's own records** under `<run-dir>/<ISSUE>/build-review/`. Why: they serve the churn, convergence and judge readers. The new `review-rounds/` directory is separate.
- **Mint warnings, mint refusal, governance-check evidence leg.** Why: FAFF-1263 (shipped) and FAFF-1261. Extension point: `validateAnchorDir`.
- **Moving evidence writes to the trusted side of a dispatch cut.** Why: its own follow-up. The writers run wherever graft writes today.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Review pass | One reviewer invocation in graft Step 9, including each dialogue-loop reviewer pass |
| Round record | `<run-dir>/<ISSUE>/review-rounds/round-<n>.json`: one review pass in the v0.3 `review-round` shape |
| Terminal round | The highest-numbered round record |
| Park write | A `review-verdict.json` write on a park arm, whose signal comes from graft rather than from a reviewer's terminal pass |
| Contiguous run | A maximal sequence of round records numbered n, n+1, n+2, ... with no number missing |
| Collator | The pure function that merges round records into one findings list |

### Dependency on FAFF-1276 (2a-ii)

**Assumes:** FAFF-1276 has merged and `finding-id.js` exports `resolveRoundChain(rounds) -> List<List<ResolvedEntry>>`, where `rounds` is `List<{round, findings}>` ascending and each `ResolvedEntry` is `{id, stored, carry, refusal}` (FAFF-1276 spec, section 3, "Identity helper"). `review-round.schema.json` (both copies) has a required per-finding `carried_id: string | null`.

**Chosen:** build step 0 reads `eval/baselines/finding-identity-result.json` on the branch base and continues only when it has `mode: "carried"`, `pass: true`, `fixtures >= 10` and a `commit` that is an ancestor of the base. Otherwise stop before writing code: an autonomous build parks `needs-human` with cause "FAFF-1276 carried-mode finding-identity eval has not passed"; an interactive build surfaces the file's values. Everything this slice ships serves collation, so there is no partial delivery below the bar. This is FAFF-1276's stated gate for FAFF-1268 and keeps the parent rule that the collator never ships unmeasured.

### Schema changes (draft v0.3, edited in place)

Both copies stay byte-identical. Draft edits are allowed until FAFF-1261 freezes v0.3.

```
ReviewRound              + adversarial_outcome: "chain-outage-skipped" | null   # required; the recorder null-fills
ReviewVerdictAnchored.signal  enum + "unavailable"                              # park writes only
ReviewVerdictAnchored    + admitted_by?: "build-judge"                            # optional; judge-admit writes only
```

- The default and `--park` modes validate against the schema the anchor manifest names for `review-verdict.json` (`schemaFor("review-verdict.json")`, which is `review-verdict-anchored.schema.json`), as `--terminal-only` does today.
- `admitted_by` is a new optional, closed property (a one-value string enum), so it is additive under `classifySchemaChange`.
- `ReviewVerdictAnchored.adversarial_outcome` keeps FAFF-1277's shape: optional, present only as `"chain-outage-skipped"`.
- `rounds_total` stays a plain integer. The writer guarantees `rounds_total >= 0` and `1 <= first_round <= last_round <= rounds_total`; the validator subset has no `minimum` keyword, so these are writer-only checks.

**Chosen:** admit `signal: "unavailable"` in the anchored schema so the outage park's file is v0.3-valid. No PR opens on a park, so no per-PR anchor carries it, and `readReviewVerdict` already reads any non-`pass` signal as a refusal. On this slice's own PR the enum widening is not additive under `classifySchemaChange`, so governance-check validates its anchor against the base schema; that anchor is written by main's graft (`--terminal-only`, `pass`) and is valid there.

### CLI surfaces

| Command | Reads | Writes |
|---|---|---|
| `faff evidence record-review-round --run-dir D --issue I [--prior-dir D/I/build-review]` | one `faff-contract:review-verdict` block body, dispositions folded in, on stdin; every existing round record | `D/I/review-rounds/round-<n>.json`, n = highest existing + 1 |
| `faff evidence write review-verdict --run-dir D --issue I` | every round record | `D/I/review-verdict.json` |
| `... write review-verdict ... --park needs-human\|unavailable` | every round record (zero rounds allowed) | `D/I/review-verdict.json` |
| `... write review-verdict ... --judge-admitted` | every round record; `D/I/build-review/judge/admit-result.json` | `D/I/review-verdict.json` |
| `... write review-verdict ... --terminal-only` | unchanged from FAFF-1277 | unchanged |

Any two of `--park`, `--judge-admitted` and `--terminal-only` together exit 2. Exit codes, as for the FAFF-1277 writers: 0 written; 1 input or round record failed validation, nothing written, reason on stderr naming the key path or file and rule, never a value; 2 usage, path-guard, redaction-config or IO fault, nothing written. Every command runs `guardWriterPaths` before any read or write, redacts every string leaf with `redactKnownSecrets` before computing anything from it, and writes keys in schema declaration order, two-space indent, trailing newline.

**Chosen:** the round-record schema is loaded from the bundle by path (`schema/review-round.schema.json`), because it is not an anchor-manifest entry and `schemaFor` resolves only manifest entries.

### Round record

`record-review-round` builds one `ReviewRound` from the block:

```
PROCEDURE record_review_round(block, issueDir, priorDir):
  1. signal must be pass, fail or needs-human; unavailable or anything else -> exit 1 (an outage pass records nothing)
  2. findings must be an array of objects -> else exit 1
  3. Redact every string leaf
  4. existing = every round-<k>.json in review-rounds/, ascending; any unparseable or schema-invalid -> exit 2 naming it
     (a run-dir fault, not a fault in this block)
     n = (highest k, else 0) + 1
  5. FOR each finding, in input order (the order is load-bearing: handle P<k> is the k-th finding of this record):
       carried_id = a non-empty string after trim ? it : null; with --prior-dir, translate_handle (below)
       a supplied finding_id is ignored
       severity, disposition, source: out-of-enum -> null, stderr warning naming the key path and rule, never the value
       location_present, action_present = !!value
       every other documented key null-filled; unknown keys dropped
  6. ids = resolveRoundChain(contiguous run ending at n, i.e. existing rounds n-1, n-2, ... back to the first gap,
                             plus the new round, every finding's finding_id removed)[last]
     finding_id = ids[i].id
  7. adversarial_outcome = "chain-outage-skipped" when the block carries exactly that, else null
  8. Validate against review-round.schema.json -> exit 1
  9. Write a temp file, then link it to round-<n>.json (exclusive create, never replace); EEXIST -> exit 2
```

**Chosen:** a non-string `carried_id` is stored as `null` with a stderr warning; `resolveCarriedIds` already ignores it, and storing it would fail the schema over a soft fault.

**Chosen:** out-of-enum `severity`, `disposition` or `source` is written as `null` with a warning and the write exits 0. The review-verdict contract treats these as soft violations that never block a merge (FAFF-1146), so the recorder must not turn one into a missing round.

### Which prior list a handle names

FAFF-1276's graft Step 9 forwards `faff review-prior --block` from `review-rounds/` for an ordinary pass and from `build-review/` for a dialogue-loop pass. A handle is meaningful only against the list the reviewer was shown.

**Chosen:** for a dialogue-loop pass graft adds `--prior-dir <run-dir>/<ISSUE>/build-review`, and the recorder translates each handle into `review-rounds/`'s numbering before storing it:

```
PROCEDURE translate_handle(carried, priorDir, reviewRoundsDir):
  1. priorDir must realpath inside the issue directory; else exit 2
  2. src = the highest round-<k>.json in priorDir (unparseable -> exit 2; no round file -> carried_id null, stderr warning); its findings in record order,
     the order `faff review-prior` numbers them
  3. carried is not P<j> with 1 <= j <= len(src.findings) -> carried_id null, stderr warning
  4. f = src.findings[j-1]
  5. matches = findings of the highest review-rounds/ record whose normaliseFindingPath(location) and
     normaliseFindingTitle(title) both equal f's, with a non-empty file and title
  6. exactly one match at position i -> carried_id = "P" + i; otherwise null, stderr warning
```

`resolveRoundChain` then validates the translated handle like any other. Why: resolving a `build-review/` handle directly against `review-rounds/` would accept a carry onto whatever finding sits at that position in the same file, a silent wrong merge; dropping the carry instead splits a reworded critical into two merged findings, and under a judge admit or a pass rule 2c would stamp the older wording `fixed` although it was never cleared. Matching on the exact normalised file and title only ever carries onto the same wording of the same finding, so a translation cannot join two defects. Both directories record the same dialogue-loop pass, so the match normally exists; when it does not, the finding is duplicated rather than merged.

### Collation

Summary: re-resolve identity over each contiguous run of recorded rounds, merge every finding on that id, and settle each merged finding honestly.

```
PROCEDURE collateReviewRounds(rounds, terminal_signal, park):   # pure; rounds ascending by round number
  0. ids: split rounds into contiguous runs; for each run, resolveRoundChain(run) with round = the record's
     round number and every finding's stored finding_id removed first; a run's first round has no prior,
     so its carries are refused "no-prior-round"
  1. FOR each finding f in round n, keyed by its resolved id:
     - append { round: n, title, location, severity, disposition } to occurrences
     - first_round = earliest n; last_round = latest n
     - severity = highest seen (critical > major > minor > observation > null)
     - rep = the finding in the round holding the highest severity (ties: latest round)
     - location, location_present = the latest occurrence's (a carried finding may move lines between rounds)
     - action_present = rep's value
     - title, action, source, model = rep's value; where rep's is null,
         the value from the latest round in which that field is non-null; else null
  2. Settled disposition, refutation and rationale per merged finding, first matching rule wins:
     a. NOT park AND last_round = terminal round      -> that round's disposition, refutation, disposition_rationale (a null stays null)
     b. this finding's latest non-null recorded disposition in {refuted, accepted-risk} -> keep it with its refutation and rationale
     c. terminal_signal = "pass" or judge-admitted     -> "fixed"; refutation and rationale null
     d. otherwise                                      -> "open";  refutation and rationale null
  3. Return findings in first-appearance order
```

**Chosen:** the collator re-resolves ids from the stored `carried_id`, `title` and `location`, with every stored `finding_id` removed before the call, following FAFF-1276's resolve-on-read rule. Removing it matters: `readerFindingIds` falls back to a stored id for an untitled finding, which would otherwise keep a carry the re-resolution refused. Why re-resolve at all: round records sit in a run dir the build agent can write, and one function keeps the recorder, the collator and FAFF-1276's readers consistent.

**Chosen:** resolution restarts at a gap in round numbers. Why: a `P<k>` handle in round n names round n-1's list; if round n-1 is missing, resolving against round n-2 would attach the handle to the wrong finding. Restarting refuses those carries, so a gap duplicates findings rather than wrongly merging them.

**Chosen:** rule 2d. When the loop ends in `needs-human` or a park, a finding absent from the terminal round was not re-raised, but the review never cleared the build, so the file says `open` rather than asserting a fix.

**Anti-pattern:** filling `disposition_rationale` for a finding settled by rule 2c or 2d. Why: the graft SKILL forbids inventing rationale the review did not produce.

**Anti-pattern:** merging on stored `finding_id`, or on `carried_id` text, directly. Why: only `resolveRoundChain` decides identity.

### Writer modes for `review-verdict`

| Mode | Precondition | `signal` | Settlement rules | `adversarial_outcome` |
|---|---|---|---|---|
| default | at least 1 round; terminal round signal `pass` or `needs-human` | terminal round's | 2a to 2d | terminal round's, omitted when null |
| `--park needs-human` | none (0 rounds allowed) | `needs-human` | 2b and 2d | terminal round's, omitted when null or no rounds |
| `--park unavailable` | none (0 rounds allowed) | `unavailable` | 2b and 2d | terminal round's, omitted when null or no rounds |
| `--judge-admitted` | at least 1 round; `admit-result.json` parses with `admit: true` | `pass`, plus `admitted_by: "build-judge"` | 2a to 2d, with 2c applying | terminal round's, omitted when null |
| `--terminal-only` | unchanged (FAFF-1277) | | | |

Every mode except `--terminal-only` writes `schema_version: 1`, `round_history: "recorded"` and `rounds_total` = the number of round records collated; a park write never adds a synthetic round. Writer-only checks after the schema: `rounds_total >= 0`, each finding's `1 <= first_round <= last_round <= highest round number`, each occurrence's round inside that range. Error messages:

- default mode, no rounds -> exit 1, "no review rounds recorded; use --park or --terminal-only"
- default mode, terminal round `fail` -> exit 1, "terminal round is fail; the review loop has not finished"
- `--judge-admitted` with no rounds, or with `admit-result.json` missing, unparseable or not `admit: true` -> exit 1
- any round record unparseable or schema-invalid -> exit 1 naming the file

**Chosen:** park writes go through the writer. The outage park (`unavailable`, interactive or autonomous-exhausted) and the hold-limit and judge not-admit parks (`needs-human`) write outside any reviewer pass. `--park` keeps every `review-verdict.json` writer-owned and v0.3-valid, and collates the passes that did run, so a git-only run-level anchor of a parked build shows them. No recorded round is the review's terminal verdict on a park, so rule 2a never applies. Any non-zero park write is logged; the park proceeds, and a missing file fail-closes the merge gate as today.

**Chosen:** a judge admit writes through `--judge-admitted`. Why: on admit the terminal recorded round is the reviewer pass that raised the critical (`needs-human`), yet the build proceeds to a PR and the merge gate needs `signal: "pass"`. The writer checks the admit against the judge's own `admit-result.json` (its realpath must stay inside the issue directory, as for every writer path). This is a consistency check, not a trust boundary: the run dir is writable by the build agent, which can already write `review-verdict.json` directly, and moving evidence writes behind a dispatch cut is out of scope. The check stops graft from claiming an admit the judge did not record, and `admitted_by` records that the pass came from the judge, not the reviewer. The overturned finding keeps the disposition recorded in its round (rule 2a), so the file still shows what the reviewer raised; the rulings themselves stay in the judge trail.

**Chosen:** `terminalReviewRefusal`'s `unavailable` message changes from "the outage park keeps the raw review-verdict block" to name `--park unavailable`.

### Normaliser change

`computeReviewVerdict` and `contracts/review-verdict.schema.json`:

- Per finding, pass through `finding_id`, `title`, `location`, `action` when strings, `first_round` and `last_round` when integers, and `occurrences` when an array of objects.
- At top level, pass through `schema_version` and `rounds_total` when integers, `round_history` when `recorded` or `terminal-only`, `adversarial_outcome` when `chain-outage-skipped`, and `admitted_by` when `build-judge`.
- Pass-through fields are typed in the contract schema (integers, string enums, arrays of closed `{round, title, location, severity, disposition}` objects whose strings may be null), so a mistyped value fails `schemaCheck` rather than slipping through.
- `carried_id` is not passed through, so FAFF-1276's "contract output identical with and without `carried_id`" test still holds.
- `signal`, the location and action violations and the findings-substantiation rule are unchanged.

## 4. HOW

### Build order

0. Read the carried-mode eval result; stop unless it passed (see "Dependency on FAFF-1276").
1. Schema changes in both copies; `evidence-documents.md` (both copies) and the `docs/guide/cli.md` rows.
2. `collateReviewRounds` in `evidence-collate.js` with unit tests.
3. `record-review-round` and the default and `--park` modes in `evidence.js`; replace the bare-form exit-2 test.
4. Normaliser and contract-schema change.
5. Graft Step 3 and Step 9 edits.

### Graft Step 9

```
PROCEDURE graft_step_9_pass():                   # interactive and autonomous, every reviewer invocation
  1. Run the review occupant (forwarding the prior list per FAFF-1276); extract its faff-contract:review-verdict block
  2. Fold this pass's dispositions into the findings (existing rule)
  3. IF signal = unavailable: record nothing; run the existing unavailable disposition
  4. ELSE pipe the block to `faff evidence record-review-round` (add --prior-dir <run-dir>/<ISSUE>/build-review for a dialogue-loop pass)
       exit 1 -> log it; treat as a malformed reviewer block (existing needs-human path)
       exit 2 -> retry once; still 2 -> park with cause "review-round record failed: <stderr line>",
                 naming the writer fault, never a verdict about the work
  5. IF this pass is outside the dialogue loop AND signal in {pass, needs-human}: `faff evidence write review-verdict`
  6. IF signal = fail: fix, re-test, loop
  7. Inside the dialogue loop no pass is terminal; the loop's outcome writes once:
       judge admit                      -> `write review-verdict --judge-admitted`
       judge not-admit or hold-limit    -> `write review-verdict --park needs-human`
       a fix-path pass that returns pass -> step 5's default write, as outside the loop
```

- The "Terminal verdict → a floor artifact" bullet replaces the `--terminal-only` call with the bare writer, and replaces the hand-assembled settled-disposition rules with "the dispositions folded in at step 2 of every pass are what the collator settles from".
- Both outage park arms (interactive, and autonomous with no checkpoint or retries exhausted) run `write review-verdict --park unavailable` instead of writing the raw block.
- A needs-human reached through a recorder exit 1 also uses `--park needs-human`, because its malformed pass is not recorded.
- A non-zero exit from any of these writes is logged and never followed by a hand-write; on the terminal write the FAFF-1155 floor guard then refuses the mint and the existing anchor-refusal park applies.

### Resume carries the rounds

Graft's resume-store restore copies `.faff/resume/<ISSUE>/*.json` (flat) into the fresh run dir, so `review-rounds/` would be lost.

**Chosen:** the retry-later stash and the `built-but-not-admitted` hold stash copy `review-rounds/` recursively into `.faff/resume/<ISSUE>/review-rounds/`, and the Step 3 restore copies it back when present. A resumed review then continues numbering from the highest restored round, and its prior list (`faff review-prior` over the restored directory) is the round the reviewer last saw. A same-run-dir resume needs nothing.

### SKILL caps

Rewrite in place. `faff-graft` may exceed its 960-line baseline only with a `SKILL_LINE_BASELINE` bump carrying a one-clause FAFF-1268 note, and no paragraph may exceed the 200-word cap. `faff-beep-boop` is unchanged: it still reads `adversarial_outcome` from `review-verdict.json`.

### Edge cases

- **Resume at review in a new run dir:** the restored rounds continue numbering and stay one contiguous run.
- **A lost round file** (rounds 1 and 3 present): two contiguous runs; round 3's carries are refused `no-prior-round`; `rounds_total` is 2 and the occurrences show the gap.
- **A finding with a title but no file:** id `nolocation::<title>`; a carry onto it is refused (`no-file`), so it merges across rounds on title alone.
- **A finding with neither title nor location:** id `round-<n>#<index>`; never merges; settles by rule 2c or 2d.
- **Two findings in one round claim the same handle:** the second is refused `claimed-twice` and keeps its computed id.
- **A round file edited after recording:** re-validated on every collation; a schema failure exits 1 naming it from the writer, and exits 2 from the recorder (graft's retry-then-park names the file).
- **Outage or malformed block on the first pass, then park:** `--park unavailable` or `--park needs-human` writes `rounds_total: 0`, `findings: []`; the unrecorded block stays in the graft log.
- **A run dir from before this slice** (no `review-rounds/`, a resumed build): the resumed pass records round 1, so the default mode applies; `--terminal-only` is never needed by graft.
- **Legacy-shaped `review-verdict.json` in the run dir:** replaced by the atomic rename.

### Failure modes

- **A wrong carry merges two defects in one file.** How you'd know: a merged finding whose occurrences describe different defects. What it means: every occurrence is kept, so nothing is lost; tighten FAFF-1276's reviewer wording.
- **Carrying does not transfer from the eval to real builds.** How you'd know: anchored findings sharing a file across consecutive rounds with different ids. What it means: findings are duplicated, never lost; revisit FAFF-1276.
- **Dialogue-loop handles fail to translate.** How you'd know: recorder warnings naming an untranslated handle, and a reworded critical appearing as two merged findings. What it means: `build-review/` and `review-rounds/` drifted apart (a pass recorded in one and not the other); findings are duplicated, never wrongly merged.
- **Writer refusals block PRs.** How you'd know: anchor `floor-incomplete` parks citing `review-verdict.json` after this ships. What it means: fix the writer's normalisation, never restore the hand-write.

## Scenarios

```
Given a code review that failed in round 1 with findings A and B, failed in round 2 with A refuted and new finding C,
  and passed in round 3 with no findings
When graft writes review-verdict.json
Then it carries signal pass, rounds_total 3, round_history recorded, and findings A (refuted, last_round 2),
  B (fixed, first_round 1, last_round 1, disposition_rationale null) and C (fixed)
And faff merge-gate reads the review leg as pass
```

```
Given round 1 failed with a major at "lib/page.js:12" titled "pagecount truncates partial last page with math.floor",
  round 2 failed with a major at "lib/page.js:15" titled "pagecount rounds down a partial last page" and carried_id "P1",
  and round 3 passed
When graft writes review-verdict.json
Then it holds one finding with finding_id "lib/page.js::pagecount truncates partial last page with math.floor",
  two occurrences, last_round 2 and disposition fixed
```

```
Given review-rounds/round-1.json holds findings [minor M at a.js:5, critical C at a.js:40 "leaks fd"],
  build-review/round-1.json holds only [C], and the dialogue-loop pass for round 2 re-raises C reworded with carried_id "P1"
When graft records it with --prior-dir <run-dir>/<ISSUE>/build-review
Then review-rounds/round-2.json stores carried_id "P2" and the finding resolves to "a.js::leaks fd"
```

```
Given a review that failed in round 1 with findings A and B and returned needs-human in round 2 with only A
When graft writes review-verdict.json
Then it carries signal needs-human, A with round 2's disposition, and B with disposition open, not fixed
```

```
Given an autonomous review that failed in round 1 with findings A and B, and in round 2 (a dialogue-loop pass)
  raised only A, refuted, and the dialogue loop then hit its hold limit
When graft runs `faff evidence write review-verdict --park needs-human`
Then the file carries signal needs-human, rounds_total 2, A refuted with its refutation, and B open, never fixed
```

```
Given a dialogue loop whose round 2 raised critical A with signal needs-human, and the build judge overturned A
When graft runs `faff evidence write review-verdict --judge-admitted`
Then the file carries signal pass, admitted_by "build-judge", and A with round 2's recorded disposition
And without admit-result.json reading admit true the same command exits 1 and writes nothing
```

```
Given an autonomous review that recorded one fail round, then hit an exhausted outage
When graft runs `faff evidence write review-verdict --park unavailable`
Then the file carries signal unavailable, rounds_total 1, and round 1's findings with disposition open
And faff merge-gate reads the review leg as unavailable
```

```
Given an autonomous review whose terminal round is pass with adversarial_outcome chain-outage-skipped
When graft writes review-verdict.json
Then the file carries adversarial_outcome "chain-outage-skipped", so beep-boop's review_adversarial_skipped still records the issue
```

```
Given a retry-later hold after two recorded rounds, and a resume into a fresh run dir
When the resumed review passes
Then its round is recorded as round 3 and review-verdict.json collates rounds 1 to 3
```

- The merge decision for any run dir is identical before and after this slice when its evidence carries the same `signal`, `all_verified` and `criteria[].passed`.
- No writer output contains a configured known secret value present in its input.

## 6. DESIGN DECISION RATIONALE

- **Who computes `finding_id`?** The reviewer, the recorder's own title rule, or FAFF-1276's chain. **Chosen:** `resolveRoundChain`, called by the recorder and again by the collator.
- **Collator: trust stored ids or re-resolve?** Stored ids are cheaper; re-resolving matches FAFF-1276's resolve-on-read rule and survives an edited record. **Chosen:** re-resolve.
- **A gap in round numbers?** Resolve straight through, refuse to collate, or restart resolution. **Chosen:** restart; it never mis-merges and never blocks a PR over a lost audit record.
- **Dialogue-loop pass handles?** Resolve them against `review-rounds/`, translate them through `build-review/`, or drop them. **Chosen:** translate through `--prior-dir` by exact file and title; resolving directly mis-merges, and dropping the carry lets rule 2c stamp an uncleared wording `fixed`.
- **How does a judge admit write the file?** Leave it to graft prose, synthesise a passing round, or a writer mode that checks the judge's result. **Chosen:** `--judge-admitted`; a synthetic round would claim a reviewer pass that never ran.
- **Do park arms use the writer?** FAFF-1277 kept the raw outage block and deferred to this ticket. **Chosen:** `--park`, collating the recorded passes and never asserting `fixed`.
- **Admit `unavailable` in the anchored schema?** Without it the outage park cannot write a v0.3 file. **Chosen:** admit it; no PR opens on a park.
- **What does a finding absent from a non-pass terminal round settle to?** **Chosen:** `open`; `fixed` would claim a clearance the review never gave.
- **Out-of-enum values in a reviewer block?** **Chosen:** write `null` and warn; refusing would drop a round over a soft violation.
- **Redaction failure?** **Chosen:** exit 2, nothing written; unredacted text is worse than no file.
- **A recorder IO fault?** **Chosen:** one retry, then a park whose cause names the writer fault.
- **Where do merged descriptive fields come from?** **Chosen:** `location` from the latest occurrence, because a carry may move lines; the rest from the finding in the highest-severity round, with per-field fallback to the latest non-null value, because the occurrence summary does not carry `action`, `source` or `model`.
- **Does graft keep calling `--terminal-only`?** **Chosen:** no; every pass is recorded, so the default or `--park` mode always applies. The CLI mode stays for manual recovery.
- **Below the eval bar?** **Chosen:** do not build; all of this slice serves collation.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1276 is merged as described in "Dependency on FAFF-1276", and its carried-mode result has passed. Validation: `node -e` requiring `finding-id.js` exposes `resolveRoundChain`; `review-round.schema.json` lists `carried_id` as required; `eval/baselines/finding-identity-result.json` has `mode: "carried"` and `pass: true`.
- **Assumes:** v0.3 is still a draft (FAFF-1261 not Done). Validation: FAFF-1261's status. If it is Done, the two schema edits need a v0.4 decision and the build stops.
- **Assumes:** FAFF-1276's graft Step 9 edit has landed (the prior list forwarded from `review-rounds/` for ordinary passes and from `build-review/` for dialogue-loop passes). Validation: `faff-graft/SKILL.md` Step 9 names `faff review-prior`.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] `faff merge-gate` routes identically on `test/merge-gate-local.test.mjs` and every `test/holdout-*.test.mjs` with no fixture edits
- [ ] After a build with two review passes, `faff evidence validate --json` over the minted anchor reports `review-verdict.json` with file status `ok` and `round_history: "recorded"`

### From WHAT
- [ ] `review-round` gains required nullable `adversarial_outcome`; `review-verdict-anchored` admits `signal: "unavailable"` and the optional `admitted_by: "build-judge"`; both copies and the `review-round.example.json` pair stay byte-identical and `test/evidence-v0.3.test.mjs` passes
- [ ] `faff regions check` passes, and no governance module requires `contract-defs.js` or `review-prior.js`
- [ ] `record-review-round`, the default mode and both `--park` modes exit 2 and write nothing for `--issue ../x`, an `--issue` with `/`, and a `--run-dir` outside `.faff/runs/` (including through a symlink)
- [ ] Each exits 1 and writes nothing on invalid input, and identical input against identical run-dir state yields byte-identical output
- [ ] Each replaces a configured known secret in a string field (temp config and env var); a malformed config exits 2 with nothing written
- [ ] `record-review-round` refuses `signal: "unavailable"`, ignores a supplied `finding_id`, stores `carried_id`, resolves an accepted carry to the prior round's id, translates a `--prior-dir` handle to the matching `review-rounds/` handle and stores `null` with a warning when there is no single match, and writes an out-of-enum `severity` as `null` with exit 0 and a stderr warning that does not contain the value
- [ ] Two concurrent `record-review-round` calls never produce the same round number
- [ ] `collateReviewRounds`: a merged finding takes `model` from the latest round where it is non-null when the highest-severity round's finding has `model: null`; a carry across a missing round is refused and yields two merged findings; a stored `finding_id` edited after recording does not change the merge, including for an untitled finding whose carry is refused on re-resolution; a merged finding's `location` is its latest occurrence's
- [ ] `computeReviewVerdict` passes through the listed per-finding and top-level fields, does not pass through `carried_id`, and fails `schemaCheck` on a mistyped pass-through; existing contract golden cases pass unchanged

### From HOW
- [ ] The nine scenarios above pass as tests
- [ ] Default mode with no rounds exits 1 naming `--park`; with a `fail` terminal round exits 1; `--park needs-human` and `--park unavailable` with no rounds each write `rounds_total: 0`, `findings: []`; any two of `--park`, `--judge-admitted` and `--terminal-only` together exit 2
- [ ] The bare-form exit-2 test in `test/evidence-write.test.mjs` is replaced, and every existing `--terminal-only` test passes unchanged except the `unavailable` refusal message
- [ ] `record-review-round` exits 2 naming the file when an existing round record is corrupt, and writes nothing
- [ ] `faff-graft/SKILL.md` Step 9 records every non-`unavailable` pass with `--prior-dir` on dialogue-loop passes, routes a recorder exit 2 to one retry then the "review-round record failed" park, calls the bare writer for a terminal verdict outside the dialogue loop, `--judge-admitted` on a judge admit and `--park` for all three park arms, writes once per dialogue-loop outcome, and no longer calls `--terminal-only` or hand-writes `review-verdict.json`
- [ ] The retry-later and hold stashes carry `review-rounds/`, and the Step 3 restore copies it back
- [ ] `evidence-documents.md` (both copies) and `docs/guide/cli.md` describe the recorded form and `--park`
- [ ] `faff validate-adapters` passes, and `faff-graft` exceeds its line baseline only with a noted FAFF-1268 bump

### Integration smoke test

```
PROCEDURE smoke():
  1. Make a temp repo with .faff/runs/run-x/ and a genesis events.jsonl for ISSUE-1
  2. Record round 1 (fail, finding A at a.js:3 "leaks fd") and round 2 (fail, A reworded at a.js:9 with carried_id "P1"),
     then round 3 (pass); `faff evidence write review-verdict`; expect one finding, two occurrences, fixed
  3. `faff evidence write ac-checklist` with one passed criterion
  4. `faff events anchor` for ISSUE-1 into a temp dest; `faff evidence validate <dest> --json`
     -> review-verdict.json and ac-checklist.json have status ok
  5. `faff merge-gate` floor for ISSUE-1 reads the review leg as pass
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. With the writers FAFF-1277 shipped gone, one concern remains: recording code-review rounds and collating them into `review-verdict.json`, with the graft and resume edits that feed it. That fits a single 1 to 3 day unit, and nothing in it ships value without the collator.

**Workstream fit?** No issues. The ticket sits under FAFF-1257 within the FAFF-1255 anchor-evidence work.

**Deps surfaced?** No issues. FAFF-1276, the one open blocker, is linked, and the spec states its interface as an assumption. FAFF-1279 reaches this ticket only through FAFF-1276. FAFF-1277, FAFF-1266 and FAFF-1256 are Done.

**Risk profile?**
- **What's there:** The build gate is an operator-run frontier eval inside FAFF-1276, and that eval's previous form failed (0.46 against a 0.90 bar).
- **Why:** If the carried-mode result also fails, this ticket cannot build at all, and FAFF-1270 and FAFF-1261 wait behind it.
- **What to do:** Keep the gate as specified (build step 0), and have FAFF-1276's operator post the result on FAFF-1268 as its spec already requires, so a failure surfaces here before a build is attempted.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-5 minors fixed, not re-reviewed)