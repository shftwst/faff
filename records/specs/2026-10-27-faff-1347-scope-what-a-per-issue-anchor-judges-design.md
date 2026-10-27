# FAFF-1347: Scope what a per-issue anchor judges, keep what it attests

> Spec: faffter-dark-nlspec · 2026-10-21 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1347.

*Revision 5 is a refresh, not a redraft. The writer fix this spec orders first shipped as FAFF-1353, and its `**Assumes:**` is validated on `main`. The `blocks` edge was re-pointed from FAFF-1348 to FAFF-1353 by operator decision on 2026-10-20. Codebase citations were re-verified against `abd65009`. No decision changed. Confidence stays `medium`: revision 4 set it from the self-review's blocker cap, not from the writer assumption, and this refresh does not re-run that self-review. The self-review findings at the end are revision 4's record.*

*Revision 6 applies spec-review round 4 (reject-approach by majority: one infosec major, three minors), including the operator's decision of 2026-10-20 on unadmitted issue claims. A row claiming an issue the run ledger does not admit is now judged in every anchor; the two new profile keys are optional; `anchor-run`'s run-dir judgement gains a legacy cutoff at FAFF-1353's merge; and `resolve_scope` names a missing or unparseable ledger. Every other decision is unchanged.*

*Revision 7 closes the review. Spec-review round 5 returned reject-approach at the iteration cap with three majors. The QA major was a real defect and is fixed: the legacy cutoff now reads the run's first `run-start` row, which is seq 1 in every real mint, and its test fixture uses that shape. The clock-skew caveat is stated. The architectural major (rows of an issue whose PR never lands are judged by no trusted gate) and the infosec major (the corroborations compare PR-written bytes with PR-written bytes) are recorded as residuals accepted by operator decision of 2026-10-21. No other decision changed.*

This document specifies the design for FAFF-1347. Its audience is the build agent that will implement it and the human reviewers who own the enforcement programme around it. It is a high-level design: it fixes the decisions and the observable behaviour, not the code.

Every codebase claim below was verified against commit `abd6500977fee2987444efcc2e26d5f7ff3011d5` on `main` (the tree at the time of writing; `git merge-base --is-ancestor abd65009 HEAD` succeeds). Line numbers are that commit's. This spec is the seventh revision; it folds in five spec-review rounds, three operator decisions (the round-3 open question, the unadmitted-issue rule and the round-5 accepted risks), and the deferral of the writer residue to **FAFF-1353** (Done, `abd65009`), which `blocks` this ticket as a real tracker edge.

---

## 1. WHY: Problem and Principles

**The load-bearing model: a per-issue anchor has two different units, and one function currently serves both with one answer.** An anchor minted at `.faff/anchors/<run-id>/<ISSUE>/` carries a tamper-evident copy of the run's event chain plus that one issue's evidence files. The chain is prev-hash linked from genesis and `chain-head.json` attests the whole file, so the *integrity* unit is necessarily the **run**: you cannot prove a subset of a hash chain without re-minting it. But the *conformance* unit, the question "is this evidence good enough to land this PR", is necessarily the **issue**, because that is the unit the merge gate judges. Today `validateAnchorDir` judges every line of the copied file, so a malformed row about an unrelated issue reads as a defect in the anchor of every issue in the run.

### Problem statement

`mintIssueAnchor` (`events.js:1608`) byte-copies the entire run event chain into each per-issue anchor, and `faff evidence validate` judges every line of that copy with no notion of which issue the anchor is for. In a single-issue graft run the run and the issue coincide and nothing is visibly wrong; in a multi-issue `beep-boop` run one malformed event anywhere in the run makes every issue in that run report the same violations. This specification scopes the *judgement* to the anchored issue while leaving the copied chain and its run-level witness byte for byte unchanged, and gives the whole-file judgement a run-level home so nothing stops being judged.

### The measured defect

Measured against the read-only fixture run `run-20261018-174517-beepboop-list-2710a1`, a four-issue `beep-boop` run. A throwaway anchor for FAFF-1132 was minted into a scratch directory; the anchored `events.jsonl` is byte-identical to the live run chain (`cmp` reports identical), 53 lines, `head_seq` 52, `schema_floor` 2. `faff evidence validate <anchor> --require-evidence-schema` exits 1 with 14 violations, every one reading `line N: type 'decision-capture' is issue-scoped but missing required field 'issue'`.

What those 53 lines are:

| Row group | Count | Judged today | Should be judged by FAFF-1132's anchor |
|---|---|---|---|
| Rows whose `issue` is `FAFF-1132` (`issue-admitted`, `build-start`, `issue-outcome`) | 3 | yes | yes |
| Rows legitimately run-scoped by type (`ledger-write` x14, `run-start`, `runner-identity`, `sentry-checkpoint`, `run-end`) | 18 | yes | yes |
| Rows about other issues (FAFF-933, FAFF-1079, FAFF-1110, FAFF-1111, FAFF-1122, FAFF-769) | 18 | yes | **no** for the 10 rows of issues the run ledger admits (FAFF-933, FAFF-1079); yes for the 8 `prep-start` and `park` rows of FAFF-1110, FAFF-1111, FAFF-1122 and FAFF-769, which it does not (see the unadmitted-issue decision) |
| Rows of an issue-scoped type carrying `issue: ''`, attributable to no issue at all | 14 | yes | **no** |

So 21 of 53 rows are FAFF-1132's business and 32 are not. The `decision-capture*` corpus for this run is 18 rows: 14 carrying `issue: ''`, every one a `next` or `eligible` kernel (orchestrator-level decisions), and 4 conforming rows all carrying `FAFF-933`. The writer therefore produces conforming rows when its environment is set and non-conforming ones when it is not.

### Scope cannot be a time window

The ticket says the 14 malformed rows were written "before that build began". That holds for ten of them. Four (lines 45 to 48, `seq` 44 to 47) were written after FAFF-1132's `build-start` at `seq` 43 and before its `issue-outcome` at `seq` 50. They are still orchestrator-written rows belonging to no issue. Scope must come from attribution, never from position in the file.

### The enforcement is live today, and there is no flip to hold

Earlier iterations of this spec, and the round-3 open question, framed the defect as latent pending an `evidence-schema: require` switch-on. **That framing is wrong and is corrected here.** Two separate mechanisms are in play and only one of them is switchable.

| Mechanism | Switchable | Does it block a PR today |
|---|---|---|
| The CI action's evidence-schema legs (`.github/actions/governance-check/action.yml`) | Yes, via the `evidence-schema` input, default `report`. `.github/workflows/governance.yml` sets no value, so `report` applies | No. Under `report` a schema finding is a warning annotation; the base-commit leg sets `verdict=fail` only when the validator result is fail **and** the mode is `require` |
| `test/evidence-validate.test.mjs` | No. It is a committed test | **Yes.** It walks git-tracked anchor directories and requires every anchor whose run timestamp postdates `MIXED_CUTOFF = "20261014-142628"` (line 45) to validate. A failure fails a unit shard, and the `validate` required check's first step requires every unit shard to have passed |

The fixture run is `20261018-174517`, which postdates the cutoff. So a non-conforming anchor fails a required check **today**, with nothing to turn on. The enforcement weakening this design performs therefore lands with the code, not with a configuration change, which is the whole reason the writer residue has to be closed first rather than later (see the ordering decision below).

### The consequence on record, re-measured

The ticket's "Consequence on record" says PR #1092 is code-complete and unlandable, left open as standing evidence. Two corrections, both measured.

**The mechanism in that wording is wrong.** `governance-check` *passes* on #1092: the workflow sets no `evidence-schema` input, so a schema finding there is a warning only. The blockage was the `validate` required check via the unit shards, driven by the committed test above, not by a governance evidence-schema gate.

**The PR is no longer open.** As of commit `ba922f21` it has landed on `main` as `feat(judge-trail): bound the per-round objection blob with a measured write-cap (FAFF-1132) (#1092)`. `git diff e86dd495..ba922f21 -- .faff/anchors` shows it added **no anchor**: the only anchor in that range belongs to FAFF-1291. So it landed by the one recovery this defect leaves available, which is to not commit the anchor at all. That is the third reproduction of that recovery today and the first on `main`.

**This reframes the cost, not the defect.** The defect's real price is not a stuck PR; it is that the only way past it discards the evidence anchor the whole anchored-evidence programme exists to produce. A ticket whose symptom is "one malformed row makes every issue unlandable" has, in practice, been paid for in lost evidence rather than in blocked merges.

### Design principles

**Presence and judgement are separable, and only judgement may be scoped.** Every row stays in the file and stays hashed, because the chain's value is that it is complete and contiguous. What changes is which rows a conformance verdict is computed over. Any design that drops, filters or re-chains the copied bytes is rejected on this principle alone.

**No issue's gate may be held hostage by another issue's row.** A merge gate for one issue that fails because of a row about a different issue is not reporting a fact about the work under review. This is the principle the defect violates.

**Nothing stops being judged.** Scoping the per-issue verdict creates a residue of rows no per-issue anchor claims. If that residue goes unjudged the defect becomes invisible rather than fixed, which is worse than the status quo.

**A narrowing input must be corroborated, never trusted.** The verdict is narrowed by data the PR authors. Every anchor a PR *adds* is wholly PR-authored, including its `chain-head.json`; only anchors committed at the merge base are protected, by the action's immutability check. So any field that decides what gates must be cross-checked against independent evidence in the same anchor, and must fail closed to the unscoped whole-file judgement when the cross-checks disagree.

**The scope rule is data already in the repository, not a new vocabulary.** `DELIVERY_PROFILE.issue_scoped_types` (`governance-profile.js:140-148`) is already the single source of truth for which event types require an `issue`, is already what `events.js` derives its issue-scoped set from, and is already the rule generating the violation being reported. A second list is a divergence waiting to happen.

**Decision-capture is best-effort and stays best-effort.** The shipped invariant is that a capture-path defect never changes an authoritative kernel's exit code or stdout. Nothing here weakens it, and nothing here touches the writer: the writer fix is FAFF-1353's (Done), and `decision-capture.js` is FAFF-1354's (slice 2 of FAFF-1348).

### Reference context

| File | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `issueScopedViolations` (160), `eventViolations` (206-220), `eventsLedgerFold` (845), `mintIssueAnchor` (1620), the `anchor` and `anchor-run` branches (1300, 1400), `warnOnEvidenceSchema` (1587), `appendRecordUnderLock` (618) |
| `plugin/skills/faff/bin/lib/evidence.js` | JavaScript | `LINE_VALIDATORS` (47), `validateJsonlFile` (127), `validateAnchorDir` (433), `checkAnchorDir` (495), `exitCodeFor` (518), `sanitiseDisplay` |
| `plugin/skills/faff/bin/lib/governance-profile.js` | JavaScript | `DELIVERY_PROFILE.issue_scoped_types` (140-148), the `__run__` sentinel convention (145-147), `PROFILE_TOP_ARRAY_KEYS` (213) and `validateProfileShape` (225) |
| `plugin/skills/faff/bin/lib/governance-check.js` | JavaScript | `deriveAnchorDirs` (354), `evaluateRunDir` (498), `buildReasons` (549), `escapeWorkflowData` (626), the `--run-dir` CLI path (769) |
| `plugin/skills/faff/bin/lib/decision-capture.js` | JavaScript | `KERNEL_REGISTRY` (45), the four run-level kernels' sentinel writers, `captureDecisionCore` (440) and the `issueVal` fallback (462). Read-only here: this file is FAFF-1354's (slice 2 of FAFF-1348) |
| `.github/actions/governance-check/action.yml` | GitHub Actions | the head `Run governance-check` step (305) and the base-commit `Evidence schema (base commit)` step (395) |
| `test/evidence-validate.test.mjs` | JavaScript | `MIXED_CUTOFF` (45) and the tracked-anchor walk that makes the gate live |

### Scope statement

This sits at the seam between the anchor mint (`faff events anchor`, `faff events anchor-run`) and the evidence validator that judges an anchor, and it changes neither the chain format nor the witness format.

---

## 2. OUT OF SCOPE

- **Hardening the `decision-capture` write path so an unattributable row cannot be written.** Excluded because **FAFF-1353** (Done, `abd65009`) shipped it, making the write core refuse any issue-scoped record with an absent, null or empty `issue`, and `blocks` this ticket, so the ordering is enforced by the tracker rather than remembered. FAFF-1348, its parent, also blocks FAFF-1346, which is how the two consumers of the writer fix are kept from answering the question differently. Extension point: `captureDecisionCore` in `decision-capture.js`, at the `issueVal` fallback (line 462) immediately before the append. The measured cause, which FAFF-1348's scope depended on, is kept in the companion review-record comment.

- **Whether a non-conforming anchor refuses at mint time, and whether `merge-gate` surfaces "the anchor you have cannot pass CI" as its own refusal reason.** Excluded because that is the severity half, owned by FAFF-1346 and partly in review as FAFF-1261. FAFF-1347 decides what the anchor's event scope and integrity unit are; FAFF-1346 decides what happens when an anchor fails. Extension point: the `anchor` branch in `events.js` after `warnOnEvidenceSchema` (line 1587); the agreement points have their own section below.

- **Setting `evidence-schema: require` in `.github/workflows/governance.yml`.** Excluded because the CI action's mode belongs to the enforcement programme, FAFF-1270's proving runs and FAFF-1261. Note that this is *not* the gate that makes the defect bite today (see WHY), so it is no longer an ordering constraint this ticket turns on. Extension point: the `with:` block of the `faff governance-check` step.

- **Changing the `issue` field's type in the v0.3 event schemas.** Excluded because `{"type": "string"}` is what lets `""` through the v0.3 payload check (the write core now refuses it separately, by FAFF-1353), and tightening it was one of FAFF-1348's candidate mechanisms rather than this ticket's. Extension point: `plugin/skills/faff/contracts/evidence-v0.3/schema/events/decision-capture.schema.json` and its siblings.

- **Retrofitting anchors already committed on `main`.** Excluded because the base-commit evidence leg validates a PR's anchors with the CLI archived from the PR's base commit, so once this fix is on `main` every later PR is judged by the fixed validator with no anchor rewritten; and rewriting a committed anchor is exactly what the action's immutability check refuses. The committed test is likewise satisfied without any retrofit, because no tracked anchor postdating the cutoff carries an unattributable row today (measured: zero). Extension point: none is wanted. The design's point is that no committed bytes change.

- **Strengthening `faff-beep-boop`'s handling of a non-zero `anchor-run` exit.** Excluded as a separate concern. The call site at `faff-beep-boop/SKILL.md:446` logs a non-zero exit and the close proceeds; what it does commit, it commits only on exit 0, which is the property this design relies on. Extension point: that same bullet.

---

## 3. WHAT: Vocabulary, Types, and Interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Anchored issue | The one issue a per-issue anchor directory is for. Proposed by the directory's `chain-head.json` `issue` field, and accepted only once corroborated. |
| Integrity unit | The span of bytes a hash chain and its witness prove. For an anchored chain this is, and remains, the whole run. |
| Conformance unit | The span of rows a schema verdict is computed over. Today the whole file; after this change, the anchored issue's scope. |
| Issue-scoped type | An event type listed in `DELIVERY_PROFILE.issue_scoped_types`, for which `issue` is a required non-empty field. |
| Run-scoped type | Any event type in `DELIVERY_PROFILE.event_types` that is not issue-scoped: `run-start`, `ledger-write`, `sentry-checkpoint`, `agent-dispatch`, `runner-identity`, `run-resume`, `run-claim-abandoned` and the rest. |
| Run subject sentinel | The literal `issue` value `__run__`, written by the four run-level decision kernels so an issue-scoped *type* can carry an honest run-level *subject*. |
| Run-level decision kernel | One of `queue-state`, `run-start`, `run-done`, `run-outward`: the four `KERNEL_REGISTRY` kernels that pass `issue: "__run__"` in code. |
| Unattributable row | A row of an issue-scoped type whose `issue` is absent, null or the empty string. It belongs to no issue and is not the sentinel. All 14 malformed rows in the fixture are of this kind. |
| Admitted issue set | The union of `admitted` and the `outcomes` keys in the anchor's byte-copied `run-ledger.json`: the issues the run ledger admits. |
| Unadmitted-issue row | A row of an issue-scoped type whose `issue` is whitespace-only, or a non-empty value that is not the anchored issue and not in the admitted issue set. It belongs to no issue, so every per-issue anchor in the run judges it. |
| Bound ledger | An anchor whose chain carries a `ledger-write` row whose `data.ledger_sha256` equals the SHA-256 of the anchor's own byte-copied `run-ledger.json`. The hash-match core `eventsLedgerFold` already computes. |
| Issue scope | The set of rows a per-issue anchor's conformance verdict is computed over: the anchored issue's own rows, plus every run-scoped row, plus every corroborated sentinel row, plus every unadmitted-issue row. |
| Scope residue | The rows of a run that fall in no issue's scope: other issues' rows, which fall in *their* issue's scope, and unattributable rows, which fall in nobody's. |

### Types

```
RECORD EventRow:                      # one physical line of events.jsonl, unchanged by this spec
  schema: Integer                     # 1 or 2
  run_id: String                      # non-empty
  seq: Integer
  ts: Timestamp
  prev: Hex64?                        # required when schema = 2
  phase: Phase
  type: EventType
  issue: String?                      # required non-empty when type is issue-scoped
  data: Object

ENUM RowScope:                        # NEW: the classification this spec introduces
  OWN                                 # issue-scoped type, issue equals the accepted anchored issue
  RUN                                 # run-scoped by type, OR a corroborated sentinel row
  OTHER_ISSUE                         # issue-scoped type, issue is a different issue id in the admitted issue set
  UNADMITTED_ISSUE                    # issue-scoped type, issue is whitespace-only or a non-empty value
                                      # the admitted issue set lacks; judged in scope in every anchor
  UNATTRIBUTABLE                      # issue-scoped type, issue absent/null/empty
                                      # an uncorroborated sentinel row classifies UNATTRIBUTABLE

  CONSTRAINT every row classifies into exactly one RowScope
  CONSTRAINT classification reads only `type`, `issue`, (for a sentinel row) `data.kernel`
             and the admitted issue set, and never `seq`, `ts` or position in the file

ENUM ScopeRefusal:                    # NEW: closed set of literals; never carries a proposed value
  witness-absent                      # no chain-head.json, or unparseable
  issue-absent                        # chain-head.json carries no non-empty `issue`
  issue-malformed                     # the proposed issue fails the path-safety token shape
  ledger-unavailable                  # no run-ledger.json in the anchor, or unreadable or unparseable
  ledger-disagrees                    # the proposed issue is not in the anchor's run-ledger issue set
  chain-silent                        # no row in the chain carries the proposed issue
  path-disagrees                      # the anchor directory's basename is not the proposed issue

RECORD ScopedFileReport:              # the per-file entry evidence validation already emits,
  path: String                        # extended with the scope fields, never replacing them
  status: ok | fail | legacy | unschemaed
  violations: List<String>            # gating violations
  scope: String?                      # the accepted anchored issue; null when no narrowing applied
  scope_refusals: List<ScopeRefusal>  # empty when narrowing applied
  out_of_scope_rows: Integer?         # count of OTHER_ISSUE rows skipped
  unadmitted_issue_rows: Integer?     # count of UNADMITTED_ISSUE rows judged; never folded into out_of_scope_rows
  unattributable_rows: Integer?       # count of UNATTRIBUTABLE rows
  unattributable_gating: Boolean?     # true when the single-issue closure applied (see HOW)

  CONSTRAINT status is fail IFF violations is non-empty
  CONSTRAINT scope is null IFF scope_refusals is non-empty
  CONSTRAINT unattributable_rows > 0 makes status fail only when unattributable_gating is true
  CONSTRAINT an UNADMITTED_ISSUE row's violations are always gating, as an OWN row's are
  CONSTRAINT every string reaching a report, a renderer, `--summary-md` or a workflow
             annotation passes sanitiseDisplay first, and escapeWorkflowData additionally
             when it reaches a workflow command. This binds the per-line violation text of
             BOTH legs, not only this record's own fields.
```

Scoped classification applies to `events.jsonl` inside a per-issue anchor directory and to nothing else. Every other manifest file is already per-issue by construction and is judged exactly as today.

### Decision: the integrity unit stays the run, not the issue

| Option | What it attests | What it costs |
|---|---|---|
| Keep the run-level chain and witness, scope only the verdict | The run happened as recorded, contiguous from genesis; the anchored issue's evidence conforms | The anchor carries rows irrelevant to the PR reviewing it, and a reader must consult the scope rule to know which rows were judged |
| Mint a genuine per-issue chain with its own head | This issue's rows, as a standalone chain | Destroys the run-level proof. A re-chained subset mints `prev` links for adjacencies that never occurred, `walkPhysicalChain` assumes contiguity from genesis, `eventsLedgerFold` assumes the `ledger-write` rows are present, and every reader of `chain-head.json` (`verifyChain`, `governance-check`'s integrity leg, `bundle-seal-core.js`, `evidence-readiness.js`, `commissaire.js`, `run-ledger.js`) needs second witness semantics |
| Keep the chain but filter the copy without re-chaining | Nothing coherent | The witness no longer matches the bytes and the chain reports `broken`. Not a candidate |

**Chosen:** Keep the run-level chain and witness untouched, and scope only the conformance verdict. The honest statement of what a per-issue anchor is becomes: a run-scoped tamper-evident chain, witnessed whole, presented under one issue's name, with that issue's conformance judged against the rows attributable to it. The accepted cost is that the integrity unit and the conformance unit differ, and the anchor's report must say so rather than leave a reader to infer it.

### Decision: what "in scope for one issue" means

**Chosen:** A row is in the anchored issue's scope when its `type` is **not** in `DELIVERY_PROFILE.issue_scoped_types` (run-scoped by type, in scope for every issue in the run), or when its `type` **is** in that list and its `issue` equals the accepted anchored issue. `DELIVERY_PROFILE.issue_scoped_types` is the sole source of the membership list: no second list, no new vocabulary, and the list is already what generates the violation being reported.

### Decision: the run subject sentinel, and what binds a row to it

The `__run__` sentinel already exists and is already written: `queue-state.js:192`, `run-start.js:113`, `run-done.js:205` and `run-outward.js:122` each pass `issue: "__run__"`, and `governance-profile.js:145-147` documents it as how an issue-scoped type carries a run-level subject so `issue` is always present. The scope rule has to name it, because under a bare equality test a sentinel row would land in the residue, which is wrong: it is a run-level fact every issue's anchor legitimately carries.

But the sentinel as a bare string is a value any row can claim. An actor who can rewrite `events.jsonl` can change an unattributable row's `issue` from `""` to `__run__`, moving it from the residue into the always-in-scope run set, and the advisory count that keeps the residue visible drops to zero. Removing the sentinel is not available: it is pre-existing house convention and four shipped writers depend on it.

**Chosen:** A row whose `issue` equals the sentinel classifies `RUN` only when its `data.kernel` is one of the run-level decision kernels; otherwise it classifies `UNATTRIBUTABLE` and is treated as residue. Both the sentinel literal and the run-level kernel names are read from the active governance profile, as two new **optional** array-of-strings keys (`run_subject_sentinels`, `run_level_decision_kernels`). `DELIVERY_PROFILE` carries them as `run_subject_sentinels: ["__run__"]` and `run_level_decision_kernels: ["queue-state", "run-start", "run-done", "run-outward"]`. When a profile omits either key, the classifier reads that key from `DELIVERY_PROFILE`, never from a literal at the classifier. They are not added to `PROFILE_TOP_ARRAY_KEYS`, whose loop in `validateProfileShape` (`governance-profile.js:232-235`) reports `missing required key` for every member. Instead a separate optional-keys list joins the closed top-level vocabulary (`allowedTop`, line 228) and is checked only when a key is present, which must then be an array of strings. So an override profile that predates the keys still validates and `activeProfile` still returns it, rather than every governance command exiting 2 on a key the profile never heard of. The array-of-strings shape is chosen because it is the shape every other top-level profile key already has, so the closed-vocabulary validator extends by one entry each rather than gaining a new leaf type, and because it makes the single-sourcing testable: an override profile that renames the sentinel changes the classification with no validator edit.

### Decision: rows belonging to another issue in the same run

**Chosen:** Out of scope for this anchor's verdict, not reported as violations, still physically present and still hashed. This is the direct fix: FAFF-1132's gate stops reporting FAFF-933's rows as FAFF-1132's problem. The rows remain judged, by FAFF-933's own anchor where they are in scope, so nothing is lost. The report carries their count so a reader can see judgement was narrowed rather than silently skipped.

### Decision: rows claiming an issue the run ledger does not admit

The previous decision skips a row because it is another issue's business. A row's `issue` value is writer-authored, and in an anchor a PR adds it is PR-authored, so "another issue's" must be established, not read off the row. Without that, a non-conforming row carrying `issue: "FAFF-9999"` (admitted nowhere) or `issue: " "` (whitespace-only, which the write core's `issueScopedViolations` accepts, since it refuses only absent, null and `""`) classifies `OTHER_ISSUE` in every anchor, is judged by no trusted gate, and is reported as a healthy-looking `out_of_scope_rows` increment.

**Chosen:** operator decision, 2026-10-20. A row counts as another issue's only when the run ledger admits that issue. A row of an issue-scoped type whose `issue` is whitespace-only, or a non-empty value the run ledger does not admit, belongs to no issue, so every per-issue anchor in the run judges it; it fails an anchor only if the row is non-conforming. In `classify_row` it is `UNADMITTED_ISSUE`, judged exactly like an in-scope row and counted in its own `unadmitted_issue_rows`, never in `out_of_scope_rows`. The admitted issue set is the one `resolve_scope` already reads for ledger agreement. The rationale is the operator's ratified wording, "rows belonging to another issue in the same run": a row whose issue the run never admitted does not belong to another issue in the run, and its claim is exactly the kind of narrowing input the principle "a narrowing input must be corroborated, never trusted" forbids accepting bare. The row itself is not trimmed or rewritten; the whitespace test reads the value as written.

The cost, stated honestly. A malformed unadmitted-issue row fails every anchor in the run, which is acceptable because it belongs to no issue and so has no single anchor to land in; a conforming one costs nothing. Measured on the fixture: 8 of the 18 other-issue rows are `prep-start` and `park` rows for FAFF-1110, FAFF-1111, FAFF-1122 and FAFF-769, which the ledger does not admit (its set is FAFF-933, FAFF-1079, FAFF-1132). All 8 conform, so the fixture's verdicts are unchanged, but a future malformed prep-pass row for a parked, never-admitted issue now fails every anchor of its run. The residual: on an unbound ledger the admitted set is PR-authored, so admitting a phantom issue moves a junk row back to `OTHER_ISSUE`; that is the same unbound-ledger weakening the decision on rows attributable to no issue accepts, and on a bound ledger the edit breaks the fold.

### Decision: rows attributable to no issue

This is the subtle one, and getting it wrong either reintroduces the defect or weakens a live gate.

| Treatment | Effect on the defect | Effect on strength |
|---|---|---|
| Gate on it in every per-issue anchor | Reintroduces the exact symptom: one malformed row again makes every issue in the run unlandable | Preserves today's strength, at the cost of holding every issue hostage to a row about none of them |
| Advisory in every per-issue anchor | Closes the defect | Strictly weaker than today for every anchor, including the single-issue graft run where there is no other issue to hold hostage |
| Advisory only where another issue could be held hostage | Closes the defect | Preserves today's strength wherever the hostage argument does not apply |

**Chosen:** An unattributable row gates when the anchor's ledger is **bound** and names **exactly one** issue; otherwise it is advisory, counted and reported but not gating. The reasoning is that the hostage argument is what justifies not gating, and it only exists when a second issue exists: where the ledger names one issue there is nobody to take hostage, so today's strength is preserved for the ordinary graft run. Where it names several, an attribution failure is a run-level defect about the orchestrator's writer, and a defect belongs to the gate whose unit it is a defect of.

The boundness qualifier is load-bearing and is not a detail. The cardinality is read from the anchor's byte-copied `run-ledger.json`, which a PR authors like every other byte of an anchor it adds. Unbound, a PR could add a phantom admitted issue and flip its own run's unattributable rows from gating to advisory with no chain tampering at all. Bound, the same edit changes the ledger's hash and so breaks the `ledger-write` row's recorded `ledger_sha256`, which the integrity leg already fails on (FAFF-958's refusal is this same fold). To win, an actor must re-chain `events.jsonl` from genesis to mint a fresh `ledger-write` row and recompute `chain-head.json`, which is the wholesale-forgery residual this design accepts and names rather than claims to close.

The converse is accepted openly: a genuinely single-issue anchor minted at graft Step 9b before the run has written any `ledger-write` row (`events.js:1322-1329` says that is a legitimate state) has an unbound ledger, so its unattributable rows are advisory where today they gate. That window is narrow, it is closed by FAFF-1353 having landed first (Done, `abd65009`), and buying it back would mean gating off bytes the PR authors.

### Decision: where the anchored issue comes from, and what corroborates it

A scoped validator needs to know which issue it is validating for, and the way it learns that is constrained by a call site this specification cannot change. The CI base-commit leg runs `evidence validate "$d" --require-evidence-schema --json` with no `--issue`, using the CLI archived from the PR's base commit (`action.yml:525`). A design requiring a new flag at that call site could never be adopted by the leg that matters, because the base-commit CLI by definition predates the change.

So the anchor must be self-describing, and the field it describes itself with is PR-authored. Before this change `chain-head.json`'s `issue` was effectively cosmetic: `verifyChain`'s witness cross-check compares `head_sha256`, `line_count` and `schema_floor` only, and `governance-check` read `issue` for display. Promoting it to a gating input without a cross-check hands the PR the one knob that narrows what judges it.

**Chosen:** The proposed anchored issue is read from the anchor's own `chain-head.json` `issue` field and **accepted only when all four corroborations hold**; any failure records the matching `ScopeRefusal` literal, applies no narrowing, and judges the file whole-file exactly as today.

1. **Token shape.** The proposed issue is a non-empty bare token matching the path-safety shape already used by `evidence.js:539` and `heartbeat.js:490` (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, no `..`), and is not the sentinel. This test exists to keep traversal segments and control characters out of a value that becomes a comparison key and a report string. It deliberately does **not** use the strict tracker shape at `ac-id.js:11` (`^[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*$`): the repository carries both shapes for different jobs, the strict one is an identity rule for tracker ids and the permissive one a path guard, and binding narrowing to the strict shape would refuse narrowing to every adopter whose ids are shaped differently. Identity is established by test 4, not by a regex.
2. **Ledger agreement.** The proposed issue appears in the anchor's own byte-copied `run-ledger.json` issue set, the union of `admitted` and the `outcomes` keys, which is the same set `anchor-run` derives its mint loop from (`events.js:1439-1441`). An anchor with no `run-ledger.json`, or one that is unreadable or unparseable, has no issue set: it records `ledger-unavailable` and does not narrow.
3. **Chain agreement.** At least one row in the anchored chain carries that exact `issue`. An admitted-but-never-dispatched issue has no such row and so does not narrow; that is a deliberate fail-closed outcome, not a gap.
4. **Path agreement, unconditionally.** The validated directory's own basename equals the proposed issue. This test is unconditional. Earlier iterations applied it only when the basename looked issue-shaped, which was wrong under both of the repository's shapes: under the strict shape a non-issue-shaped basename made the test abstain, and an abstention is a silent pass, so a PR could commit its anchor at `.faff/anchors/<run>/notanissue/` and point `issue` at another admitted issue of the same run whose rows conform; under the permissive shape the condition admits nearly every basename and so filters nothing while implying it does. `deriveAnchorDirs` (`governance-check.js:354-388`) validates traversal segments, a depth floor of three and realpath containment, and never issue-id shape, so nothing upstream supplies the guarantee the condition assumed.

What an actor can and cannot do after this. Pointing `issue` at a different admitted issue of the same run fails test 4, because the committed path still names the real issue. Committing the anchor under the other issue's name makes it that issue's anchor, and the PR's own issue then has no anchor, which the merge floor refuses as anchor-missing. Editing the ledger to admit a phantom issue breaks the bound-ledger fold (see the previous decision). The honest limit, stated rather than hidden: these corroborations are a self-consistency check among several PR-authored values plus the chain, so an actor who rewrites `events.jsonl` wholesale, re-chains it from genesis, rehashes `run-ledger.json` into a fresh `ledger-write` row and recomputes `chain-head.json` can produce a coherent forged anchor. That residual predates this spec and is not widened by it.

### Decision: how the scope fields and the per-line detail reach the renderers

There is a carrier problem the earlier iterations did not name. `checkAnchorDir` (`evidence.js:495-511`) is the only path from `validateAnchorDir` to the warn-only mint check and to `governance-check`'s anchor leg, and it is contractually reductive: it keeps paths, statuses and violation *counts*, drops violation text and exception messages, and filters out every per-file entry whose `status` is `ok`. A correctly narrowed, passing anchor produces exactly that shape, so its scope fields would be dropped by the existing carrier.

**Chosen:** `checkAnchorDir` keeps its reduction for violation text and keeps dropping exception messages, and gains exactly one addition: the per-file scope block (`scope`, `scope_refusals`, the three counts, `unattributable_gating`) survives the fold for an `events.jsonl` entry whichever status it carries, as typed values and closed-set literals only. Every string it carries passes `sanitiseDisplay` at the boundary. The per-line violation detail of both legs (line number, event type, `issue` value) is sanitised the same way before entering a report, a renderer or `--summary-md`, and additionally passes `escapeWorkflowData` (`governance-check.js:626`) before entering a workflow command, because a PR-authored `issue` value carrying a literal `::` or a control character would otherwise mangle an `::error::` line or open a second same-line workflow command. `escapeWorkflowData` already exists and is already applied to the annotation path, so this is a stated requirement rather than new machinery. Named output channels: the run-dir leg's `detail` string and the JSON verdict for the CLI path, and stderr for `anchor-run`'s self-verify report.

---

## 4. HOW: Behaviour

### Architecture and approach

Three pieces change, and the mint is not one of them.

**The validator gains a scope classification for `events.jsonl` inside an anchor directory.** Validation remains whole-file in that every line is still parsed and classified; what changes is which classifications contribute gating violations. Because `checkAnchorDir` and `exitCodeFor` already derive status and exit code from the per-file violation lists, scoping the violations scopes the exit code with no change to either.

**`governance-check`'s run-dir path gains an `evidence_schema` leg.** `evaluateRunDir` (`governance-check.js:498-545`) already returns a `legs` object whose gating members decide `pass`, and `buildReasons` already renders one reason per failing gating leg. The whole-file, every-row-gating judgement goes there, gating when `--require-evidence-schema` is passed and report-only otherwise, mirroring how the existing anchor-dir evidence leg behaves. It is reached by two call sites that already exist: the action's head `Run governance-check` step, which passes `--run-dir` for every discovered run dir, and `anchor-run`'s self-verify spawn.

**The mint does not change.** `mintIssueAnchor` keeps its verbatim byte-copy of `events.jsonl` (line 1626), keeps copying `run-ledger.json` and `declared-effects.jsonl` unfiltered, and keeps computing `chain-head.json` and `effects-chain-head.json` over the unfiltered buffers. Every witness value keeps meaning exactly what it means today.

### Behaviour summary

The scoped verdict answers "does the evidence for *this issue* conform". The run-dir verdict answers "does every row in this run conform". Both read the same chain through the same classifier; they differ only in whether narrowing is on.

```
PROCEDURE classify_row(row, accepted_issue, admitted_issues, issue_scoped_types, sentinels, run_level_kernels):
  # admitted_issues = ledger.admitted UNION keys(ledger.outcomes), the set resolve_scope reads
  # sentinels and run_level_kernels: the active profile's keys, else DELIVERY_PROFILE's
  1. IF row.type is NOT in issue_scoped_types:
     a. Return RUN                      # run-scoped by type, in scope for every issue
  2. IF row.issue is in sentinels:
     a. IF row.data.kernel is in run_level_kernels: Return RUN
     b. Return UNATTRIBUTABLE           # an unbound sentinel claim is residue, not run-scope
  3. IF row.issue is absent, null or empty:
     a. Return UNATTRIBUTABLE
  4. IF row.issue equals accepted_issue:
     a. Return OWN
  5. IF row.issue is whitespace-only, OR row.issue is NOT in admitted_issues:
     a. Return UNADMITTED_ISSUE         # belongs to no issue; judged in every anchor
                                        # the row is read as written, never trimmed
  6. Return OTHER_ISSUE
```

```
PROCEDURE resolve_scope(anchor_dir, chain_records, ledger):
  1. Read chain-head.json in anchor_dir
     a. absent or unparseable          -> refuse witness-absent
     b. no non-empty `issue`           -> refuse issue-absent
  2. Let proposed = chain-head.issue
     a. proposed fails the path-safety token shape, or is a sentinel -> refuse issue-malformed
  3. Read run-ledger.json in anchor_dir
     a. absent, unreadable or unparseable                               -> refuse ledger-unavailable
     b. proposed is not in (ledger.admitted UNION keys(ledger.outcomes)) -> refuse ledger-disagrees
  4. IF no record in chain_records carries issue == proposed            -> refuse chain-silent
  5. IF basename(anchor_dir) != proposed                                -> refuse path-disagrees
  6. Return { accepted: proposed, refusals: [] }
  # Any refusal returns { accepted: null, refusals: [<every literal that applied>] }.
  # A null acceptance means NO narrowing: the caller judges whole-file, as today.
```

```
PROCEDURE ledger_is_bound(anchor_dir, chain_records):
  1. Find the LAST record whose type is ledger-write; absent -> Return false
  2. Read anchor_dir/run-ledger.json bytes; absent or unreadable -> Return false
  3. Return that record's data.ledger_sha256 == sha256 of those bytes
  # This is eventsLedgerFold's hash-match core, reused, never a forked comparison.
```

```
PROCEDURE validate_anchor_events(anchor_dir):
  1. Parse every physical line of events.jsonl, tolerating a torn final line as today
  2. scope = resolve_scope(anchor_dir, parsed_records, anchor_dir/run-ledger.json)
  3. IF scope.accepted is null:
     a. Judge every row exactly as today, every violation gating
     b. Emit the report with scope null, scope_refusals = scope.refusals, no counts
     c. Return
  4. single_issue = ledger_is_bound(...) AND the ledger issue set has exactly one member
  5. FOR each parsed line:
     a. does not parse as JSON -> a gating violation regardless of scope
        (an unparseable row has no type and no issue, so it cannot be classified out)
     b. classify per classify_row
     c. OWN or RUN       -> run today's per-line validation; append violations as gating
     d. UNADMITTED_ISSUE -> increment unadmitted_issue_rows; run today's per-line validation
                            and append its violations as gating, exactly as for OWN
     e. OTHER_ISSUE      -> increment out_of_scope_rows; contribute no violations
     f. UNATTRIBUTABLE   -> increment unattributable_rows; run today's per-line validation
                            and append its violations as gating IF single_issue, else
                            contribute no violations
  6. Emit the report with scope, empty scope_refusals, all three counts, and
     unattributable_gating = single_issue
```

```
PROCEDURE run_dir_evidence_schema_leg(run_dir, require_evidence_schema):
  1. Judge run_dir/events.jsonl WHOLE-FILE: every row parsed, every row gating,
     no scope narrowing, through the same classifier with narrowing off,
     except under the legacy cutoff in step 1a
     a. IF the run's first run-start row (lowest seq of type run-start; seq 1 in every real
        mint, after the ledger-write at seq 0) carries a ts that precedes 2026-10-20T17:51:18Z
        AND run_dir/run-ledger.json's admitted issue set has more than one member:
        a row of an issue-scoped type whose issue is absent, null or empty is
        counted and reported as advisory, not gating
        # no run-start row, an unparseable chain, or an unreadable ledger: no relief
  2. Build detail: a count of violating lines, plus up to a bounded number of
     per-line entries (line number, event type, issue value), each value through
     sanitiseDisplay, and through escapeWorkflowData when it reaches a workflow command
  3. Return { pass, detail } as a gating leg when require_evidence_schema, else report-only
     (the same posture the existing anchor-dir evidence leg takes)
```

```
PROCEDURE anchor_run_self_verify(dest_subdir, level):
  1. Run today's governance-check self-verify on dest_subdir, unchanged
  2. ADDITIONALLY spawn governance-check over the run dir with the evidence-schema
     leg gating (legacy cutoff included), and report its per-line detail to stderr
  3. IF it exits non-zero:
     a. Wipe the whole dest tree, as every other anchor-run failure path already does
     b. Exit non-zero, so nothing partial reaches the orchestrator's commit step
```

### Decision: which command carries the whole-file judgement, and what to call it

| Option | Fit |
|---|---|
| A new `evidence_schema` leg on `governance-check`'s run-dir path | The run dir is the whole-file unit. `evaluateRunDir` already has a `legs` object, a gating-leg-to-`pass` fold and a reason renderer, and two existing call sites already reach it. No new verb, no new call-site dependency |
| `faff events anchor-run` self-verify alone | Its preconditions and all-or-nothing wipe are exactly right for run close, but it is one prose call site under one lifecycle signal, so it cannot be the whole story |
| A new run-level verb | Duplicates `anchor-run`'s preconditions and cleanup for no gain |
| The per-issue `faff events anchor` | Wrong unit. Running a whole-file judgement per issue is what the defect *is* |
| The CI base-commit leg | Wrong unit. It sees committed per-issue anchor directories, not run dirs, and it is the leg that must stop seeing other issues' rows |

**Chosen:** the `evidence_schema` leg on `evaluateRunDir`, reached by the action's head step and by `anchor-run`'s self-verify, and described as a **run-close and local-feedback check, not a trusted gate**. Three measured facts force that wording rather than the stronger claim earlier iterations made.

- `.faff/.gitignore:2` is `/*` with `!/anchors/` among the carve-outs, and `git ls-files .faff/runs` returns zero files against 2887 tracked files under `.faff/anchors`. No run dir is committed in this repository, so the head step discovers none and the leg cannot fire in faff's own CI at all.
- For an adopter who does carry run dirs, the head step runs the **in-checkout** binary (`action.yml:101-124`, default `plugin/skills/faff/bin/faff`), which the PR authors. A PR can edit it. The same is true of `anchor-run`'s self-verify, which spawns the local CLI from the checkout.
- The only leg that runs a binary the PR does not control is the base-commit evidence leg, and it validates **anchor dirs**, not run dirs.

So the whole-file judgement of the residue is never a security control. What it genuinely is: the check that stops a git-only run committing a poisoned anchor set, because `anchor-run` stages and commits only on exit 0 (`faff-beep-boop/SKILL.md:446`), and the fast local signal that tells an operator a run wrote rows no issue can claim. The trusted, PR-blocking judgement of anchored evidence remains the base-commit leg over committed per-issue anchor dirs, which this change makes scoped, plus the committed tracked-anchor test, which this change leaves judging the same bytes it judges today.

### Decision: `anchor-run`'s self-verify spawn, and the ordering rationale it contradicted

Making the spawn gate on the evidence schema has a landing consequence: a git-only multi-issue run whose chain carries an unattributable row fails `anchor-run` at run close and commits no anchor. Earlier iterations both required that spawn unconditionally and justified landing early with "the evidence-schema leg is report-only today, so this fix changes no verdict on landing". Those cannot both stand. The two ways out are to condition the spawn on the enforcement setting, or to retract the rationale.

**Chosen:** retract the rationale and keep the spawn unconditional. The rationale was false for a second and more basic reason, which `note-1420` on the ticket is the correction of record for: there is no enforcement flip to sequence against, because the live gate is a committed test (see WHY), not a switchable input. A spawn conditioned on a setting that does not govern the live gate would be conditioned on the wrong thing. And the parking harm the rationale was protecting against is foreclosed by ordering that the tracker now enforces: FAFF-1353 `blocks` FAFF-1347 and is Done, so by the time this lands the writer cannot emit an unattributable row, and, for a run whose genesis `run-start` postdates the legacy cutoff below, the run that fails `anchor-run` at run close is a run whose chain is genuinely broken. Stated plainly, so no reader reconstructs the retracted claim: **this change does alter verdicts on landing.** It narrows what a per-issue anchor's schema verdict is computed over, and it makes a git-only run-close mint refuse a chain it accepts today.

A run started before FAFF-1353 reached `main` and closed after this lands carries honest unattributable rows written by the old writer; the fixture run's 14 are exactly that shape. Judged gating at run close, such a run loses its anchor, which is the lost-evidence cost this ticket exists to remove.

**Chosen:** keep the spawn unconditional and add a legacy cutoff at the run-dir leg. When a run's first `run-start` row carries a `ts` before FAFF-1353's merge to `main` (commit `abd65009`, merged `2026-10-20T17:51:18Z`) and its `run-ledger.json` admits more than one issue, its unattributable rows (absent, null or empty `issue`) are reported as advisory at that leg rather than gating. Every other row, and every row of a run whose first `run-start` postdates the cutoff or whose `run-start` row or ledger cannot be read, gates as specified above. The cutoff reads the first `run-start` row wherever it sits, not the row at seq 0: every real mint writes a `ledger-write` at seq 0 and its `run-start` at seq 1, as the comment above `emitGenesisRunStart` in `events.js` records. The precedent is `MIXED_CUTOFF` in `test/evidence-validate.test.mjs:45`, which frees anchors from runs that predate the writers that made them conform and requires every later run to pass; this cutoff applies the same rule to the writer FAFF-1353 fixed. The cutoff is one committed value beside the leg, and moving it is a reviewed change. It reads a writer-authored timestamp, which is acceptable because the run-dir leg is not a trusted gate, and backdating a `run-start` row means re-chaining from genesis, the wholesale-forgery residual this spec already names. That timestamp is also best-effort: the `events.js` header says sandbox clocks are unreliable, so honest clock skew near the cutoff can grant or deny the relief. The cost is a wrong signal on a local, untrusted leg, never a CI bypass. A single-issue legacy run gets no relief, because no other issue is held hostage there.

### Decision: one shared scope predicate, and where it lives

If a mint-time refusal judges a per-issue anchor whole-file while CI judges it scoped, the two disagree on every multi-issue run, and the refusal parks runs CI would pass. FAFF-1261, already in review, adds exactly such mint-time refusals.

**Chosen:** the classification is a single named export of `events.js`, consulted by the scoped per-issue verdict, by the run-dir whole-file leg (the same export with narrowing off) and by any mint-time check that judges a per-issue anchor's `events.jsonl`. `events.js` is the home because it already owns `eventViolations` and the profile read, `evidence.js` already requires it (`evidence.js:26`), and `governance-check.js` already requires it (`governance-check.js:43`), so both consumers reach it without a new require edge and without `governance` requiring `factory`, which `faff regions check` enforces mechanically. One predicate, two configurations.

### Decision: whether to change the orchestrator's export instruction

The obvious reading of the measured cause is that the orchestrator ran the `next` and `eligible` kernels with capture on but without exporting `FAFF_DECISION_ISSUE`, so the writer's `process.env.FAFF_DECISION_ISSUE || ""` fallback produced `""`. The obvious fix is to make the orchestrator export it.

**That fix is already written.** `faff-beep-boop/SKILL.md` instructs `eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel <k> [--wave <w>] --export)"` before each core-loop consult and names `next` and `eligible` literally; `faff-graft/SKILL.md` carries the same instruction. The fixture run did not follow its own instruction for most candidates and did follow it for FAFF-933, whose conforming rows carry a real issue id.

**Chosen:** no change to the orchestrator's export instruction, because the instruction already exists and was already ignored. Prose-level instruction is not a control for this defect: it was in place and the run produced 14 non-conforming rows anyway. Stating this plainly forecloses a build agent "fixing" the ticket by editing skill prose that is already correct.

### Decision: the writer residue's home and ordering

| Option | Effect |
|---|---|
| Hold this change until the residue has a PR-blocking home | Keeps today's strength, costs the defect's continued price in lost anchors |
| Accept a knowingly weaker trusted gate for the multi-issue residue, indefinitely | Closes the defect, leaves a live gate permanently weaker with nothing scheduled to restore it |
| Close the residue at the writer, first, and enforce the order in the tracker | Closes the defect and restores the strength at source, where a row that cannot conform is never written |

**Chosen:** hold the stricter enforcement and close the residue at the writer. FAFF-1353 (Done, `abd65009`) shipped the writer fix, a write-core refusal of any issue-scoped record with an absent, null or empty `issue`, and `blocks` FAFF-1347 through the edge the operator re-pointed from FAFF-1348 on 2026-10-20, so the ordering is a tracker edge rather than a note in a spec. FAFF-1348 also blocks FAFF-1346. The argument for this order is the one the enforcement correction above supplies: because the live gate is a committed test rather than a switchable input, the weakening this design performs for multi-issue runs lands with the code. There is no window in which it is harmless and no switch whose flip could be timed around it. Closing the writer first is therefore the only sequence in which the weaker multi-issue leg is never the project's actual posture.

**Assumes:** FAFF-1353 lands before this change, such that no conforming writer can emit a row of an issue-scoped type with an absent, null or empty `issue`. *Validation:* before starting, confirm FAFF-1353 is Done and that `git log` on `main` carries its change to the `decision-capture` write path; then confirm mechanically that appending an issue-scoped record with `issue: ""` through the write path is refused. If it is not, stop and report rather than proceeding, because the multi-issue advisory treatment specified above is sound only behind that closure. Validated 2026-10-20 at `abd65009`: `faff events append` of `{"phase":"run","type":"decision-capture","issue":""}` and of the same record with `"issue":null` both exit 1 with `type 'decision-capture' is issue-scoped but missing required field 'issue'`; `FAFF_RUN_DIR=<run> faff next --status todo --spec high` with capture on and no `FAFF_DECISION_ISSUE` exits 0 and writes no row; and `faff events validate` on that run's `events.jsonl` exits 0.

### Decision: what PR #1092 needs from this ticket

**Chosen:** nothing. It has landed, at commit `ba922f21`, carrying no evidence anchor. The recovery that let it land is the one this defect leaves available and is worth recording for the next PR that hits this: because the base-commit evidence leg archives the CLI from `pull_request.base.sha`, a PR whose anchor carries another issue's malformed rows is judged by the fixed validator as soon as it is rebased onto a `main` containing this fix, with no anchor re-mint and no committed bytes changed. That property is what makes a validator-side spine recoverable where a mint-side fix would not be.

### Edge cases and error handling

**An anchor with no usable `chain-head.json`.** Fall back to today's unscoped whole-file judgement, record `witness-absent` or `issue-absent`, emit no counts. An anchor that cannot say which issue it is for gets no narrowing. `governance-check` already treats an absent witness as `witness-absent` and fails closed, so this matches established behaviour.

**A corroboration that fails.** Same posture: no narrowing, whole-file judgement, the matching closed-set literals in `scope_refusals`. Every refusal is fail-closed by construction, so no corroboration choice can open a hole; the cost of a wrong choice is only lost narrowing.

**A corroborated issue with zero `OWN` rows.** Cannot arise: chain agreement is one of the corroborations, so an issue with no rows in the chain never narrows.

**An unparseable line.** A gating violation in both verdicts. It carries no type and no issue, so it cannot be classified out, and classifying it as residue would let a corrupt line hide behind the narrowing.

**A torn final line.** Tolerated exactly as today in both verdicts. `computeChainHead` already hashes a torn tail as-is and `validateJsonlFile` already tolerates it.

**A single-issue graft run with a bound ledger.** Every row is `OWN`, `RUN` or a gating unattributable row, so the scoped verdict and the whole-file verdict agree. Today's behaviour is preserved exactly for the common case.

**A single-issue graft run with no `ledger-write` row yet.** The ledger is unbound, so unattributable rows are advisory. Named here as the one legitimate case where this design is weaker than today, accepted with the reasoning in the decision above.

**A non-delivery governance profile.** The classification reads `issue_scoped_types`, the sentinel list and the run-level kernel list from the active profile, as `eventViolations` already does, so an override profile scopes by its own lists. An override that omits `run_subject_sentinels` or `run_level_decision_kernels` uses `DELIVERY_PROFILE`'s value for the omitted key.

**The run-dir leg finding violations under `anchor-run`.** `anchor-run` reports the per-line detail to stderr, wipes the whole `dest` tree and exits non-zero: the same all-or-nothing posture its existing mint-failure and self-verify-failure paths take, so a partial set never reaches the orchestrator's commit step.

### Failure modes

**The narrowing hides a real defect in the anchored issue's own evidence.** If the classification is wrong in the `OWN` direction, a true violation stops gating and the anchor passes when it should not. *How you would know:* a fixture anchor whose own rows carry known violations must still fail the scoped verdict, and the scoped and unscoped verdicts must be identical for a single-issue run with a bound ledger. *What it means:* this is the one way the fix is worse than the status quo, so if either signal fails, abandon the narrowing rather than relax the test.

**The corroboration is too strict and nothing narrows.** If one of the four tests fails routinely on the ordinary graft Step 9b path, every anchor falls back to whole-file and the defect is unfixed while the code says it is fixed. The most plausible offender is ledger agreement, because a Step-9b anchor's byte-copied ledger is a mid-run snapshot. *How you would know:* a report over the fixture run's anchors shows `scope` null and a non-empty `scope_refusals` where narrowing was expected. *What it means:* fix the corroboration, never silently drop it; a narrowing with no corroboration is the round-1 defect restored.

**The residue goes unjudged in practice.** The whole-file leg cannot fire in this repository at all, and where it can fire it runs PR-authored code. *How you would know:* an anchor report in a multi-issue run shows a non-zero `unattributable_rows` count that no leg anywhere turned into a failure. *What it means:* proceed, and rely on the ordering rather than on the leg. The advisory count in every per-issue report is what keeps the residue visible, and FAFF-1353 is what stops it being produced. Do not compensate by making the per-issue leg gate on residue in a multi-issue anchor; that reintroduces the defect.

**The `__run__` kernel binding is wrong about some legitimate writer.** If a fifth writer passes the sentinel with a kernel name not in the profile list, its rows classify `UNATTRIBUTABLE` and a run that is fine starts reporting residue. *How you would know:* the advisory count is non-zero for a run whose chain contains no empty-`issue` row at all. *What it means:* add the kernel to the profile list, which is the single-sourced point the design put it at for exactly this.

**Anti-pattern:** Filtering the bytes `mintIssueAnchor` writes, in any form, including "filter but recompute the witness over the filtered buffer". Why: a re-chained subset mints `prev` links for adjacencies that never occurred, so the witness attests a run that never happened, and `eventsLedgerFold` assumes the `ledger-write` rows are present, so a filtered copy breaks the ledger-fold precondition `anchor-run` itself depends on.

**Anti-pattern:** A second list of issue-scoped event types, or a hard-coded `"__run__"` or run-level kernel name at the validator. Why: the profile is the single source of truth, `governance-profile.js` carries a committed convention that a run-scoped event stays out of `issue_scoped_types`, `outcome_required_types` and `sentry.progress.forward_types`, and a hard-coded copy is invisible to the override test that is the only mechanical check of single-sourcing.

**Anti-pattern:** Accepting `chain-head.json`'s `issue` as the narrowing input without all four corroborations, or making any corroboration conditional on a shape test. Why: the field is PR-authored, it was cosmetic before this change, and a conditional corroboration abstains silently, which is a pass.

**Anti-pattern:** Adding a required `--issue` flag to `faff evidence validate` as the way the scoped verdict learns its subject. Why: the CI base-commit leg invokes `evidence validate "$d" --require-evidence-schema --json` with no such flag, using the CLI archived from the PR's base commit, which by definition predates this change. A flag-based design can never be adopted by the leg that matters.

**Anti-pattern:** Describing the run-dir leg as a trusted gate, in code comments, reasons or docs. Why: it runs the in-checkout binary, which the PR authors, and it cannot fire at all in this repository.

**Anti-pattern:** Touching `decision-capture.js`. Why: the file is FAFF-1354's (slice 2 of FAFF-1348); two tickets changing the same write path is how they end up disagreeing.

**Anti-pattern:** Specifying whether a non-conforming anchor refuses at mint, or what `merge-gate` says about it. Why: that is FAFF-1346's decision.

---

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a multi-issue beep-boop run whose event chain carries rows for four issues,
  18 run-scoped rows and 14 rows of an issue-scoped type with an empty issue field
When a per-issue anchor is minted for one of those issues and validated with
  --require-evidence-schema
Then the validation passes, reports that issue as its scope with an empty
  scope_refusals list, and reports non-zero out-of-scope and unattributable counts
  with unattributable_gating false
```

```
Given the same multi-issue run
When a per-issue anchor is minted for each of its issues and each is validated
Then every one passes, and no issue's verdict changes when a different issue's
  rows are made non-conforming
```

```
Given a two-issue run whose ledger admits FAFF-A and FAFF-B, and whose chain
  carries one non-conforming row of an issue-scoped type with issue FAFF-9999,
  which the ledger does not admit
When a per-issue anchor is minted for each issue and each is validated with
  --require-evidence-schema
Then both validations fail on that row, and each reports it under
  unadmitted_issue_rows, not out_of_scope_rows
And when the same row is made conforming, both validations pass, each still
  counting it under unadmitted_issue_rows
```

```
Given the same two-issue run, with the non-conforming row's issue set to a
  single space instead of FAFF-9999
When each per-issue anchor is validated with --require-evidence-schema
Then both validations fail on that row and report it under unadmitted_issue_rows
```

```
Given a per-issue anchor whose own issue's rows carry a schema violation
When it is validated with --require-evidence-schema
Then the validation fails and names that violation, the narrowing having changed
  nothing about it
```

```
Given a single-issue run whose chain carries no ledger-write row and one row of an
  issue-scoped type with an empty issue
When its anchor is validated with --require-evidence-schema
Then the validation passes, unattributable_gating is false, and unattributable_rows
  is 1
```

```
Given a two-issue anchor whose chain-head.json issue is edited to name the other
  admitted issue of the same run, the directory keeping its original name
When it is validated with --require-evidence-schema
Then no narrowing is applied, scope is null, scope_refusals contains path-disagrees,
  and the verdict is the whole-file verdict the unscoped validator produces
```

```
Given a per-issue anchor whose byte-copied run-ledger.json is edited to admit a
  phantom second issue, while the chain's last ledger-write row is left unchanged
When the anchor is validated and its integrity leg is evaluated
Then the ledger fold reports a mismatch, so the cardinality edit buys no change in
  how unattributable rows are treated
```

```
Given a per-issue anchor directory whose chain-head.json has been removed
When it is validated with --require-evidence-schema
Then every row is judged with no narrowing, scope is null, scope_refusals contains
  witness-absent, and the verdict matches the unscoped validator's
```

```
Given a run chain in which the only issue-scoped-type row with a non-issue subject
  carries the __run__ sentinel and a data.kernel of run-done
When a per-issue anchor of that run is validated
Then it reports zero unattributable rows, and the sentinel row contributes its own
  gating violations like any run-scoped row
```

```
Given the same chain with the sentinel row's data.kernel changed to next
When the same anchor is validated
Then that row classifies as unattributable and is counted, not treated as run-scoped
```

```
Given a run dir whose events.jsonl carries a row of an issue-scoped type with an
  empty issue field
When faff governance-check runs over that run dir with --require-evidence-schema
Then the evidence_schema leg fails, the verdict's reasons name the leg and the
  offending line numbers, and the exit code is non-zero
```

```
Given the same run dir
When faff events anchor-run mints and self-verifies that run's anchors
Then it exits non-zero, reports the offending line numbers to stderr, and leaves no
  dest tree behind
```

- The byte-copied `events.jsonl` in a per-issue anchor MUST remain byte-identical to the run's `events.jsonl`, and `chain-head.json`'s `head_seq`, `head_sha256`, `line_count` and `schema_floor` MUST be unchanged from the values today's mint produces for the same run.
- The scope classification MUST read only a row's `type`, `issue` and `data.kernel`, plus the admitted issue set, never its `seq`, `ts` or position in the file.
- A `scope_refusals` entry MUST be one of the seven closed-set literals and MUST never embed a proposed or chain-authored value.
- The set of issue-scoped event types, the sentinel literal and the run-level kernel names the classification consults MUST be the active governance profile's own keys, or `DELIVERY_PROFILE`'s for an optional key the profile omits, such that an override profile changes the classification with no edit to the validator.

---

## 6. Design decision rationale

**Should the anchored chain be filtered, or the verdict scoped?** Filtering was the ticket's framing of a per-issue chain and it is the option this specification rejects most firmly. A filtered copy either keeps the original witness, in which case the witness no longer matches the bytes and the chain reports `broken`, or gets a re-minted witness, in which case `prev` links are minted for adjacencies that never occurred. **Chosen:** scope the verdict. The integrity unit stays the run, the conformance unit becomes the issue, and the report says so.

**Where does "in scope" come from?** Position in the file was considered and rejected on measurement: four of the fixture's 14 malformed rows were written after the anchored issue's `build-start` and before its `issue-outcome`. **Chosen:** attribution via `DELIVERY_PROFILE.issue_scoped_types` plus the corroborated sentinel, which is a closed membership list, already single-sourced, and already the rule generating the violation.

**Can the sentinel be trusted as a bare string?** No: a row can claim it, and claiming it moves a residue row into the always-in-scope set. Removing it is not available, because it is pre-existing house convention with four shipped writers. **Chosen:** bind the claim to the writer's identity by requiring the row's `data.kernel` to be a run-level decision kernel, with both lists in the profile so the binding is overridable and testable.

**What happens to a row attributable to no issue?** Gating in every per-issue anchor reproduces the ticket's exact symptom. Advisory in every anchor weakens a live gate even where no hostage exists. **Chosen:** advisory where another issue exists to be held hostage, gating where the bound ledger names exactly one issue. The boundness qualifier is what stops the cardinality being a PR-authored knob, and the self-review record of an earlier iteration asserted the cardinality was a property of the run rather than of the bytes, which was wrong for an unbound ledger and is corrected here in the body rather than only in a review note.

**How does the validator learn which issue it is validating for, and why is the field alone not enough?** A `--issue` flag cannot work, because the CI base-commit leg's invocation is fixed in the CLI archived from the PR's base commit. The field alone cannot work either, because every anchor a PR adds is wholly PR-authored and the field was cosmetic before this change, so trusting it hands the PR the knob that narrows what judges it. **Chosen:** read the field, corroborate it four ways, and fail closed to the whole-file judgement on any disagreement, with the path-agreement test unconditional because its earlier shape condition abstained silently under the strict issue-id shape and filtered nothing under the permissive one.

**Which of the repository's two issue-id shapes governs the token test?** At the time of writing `ac-id.js:11` carries a strict tracker shape and `evidence.js:539` a permissive path-safety token shape, and both are current for different jobs. **Chosen:** the permissive path-safety shape, because the test's job is to keep traversal and control characters out of a value that becomes a key and a report string, while identity is established by path agreement. Binding narrowing to the strict shape would deny the fix to every adopter whose ids are shaped differently, for no soundness gain.

**Which command carries the whole-file judgement?** `anchor-run`'s self-verify has the right preconditions and the right all-or-nothing wipe but only one prose call site; a new verb duplicates it; the per-issue anchor is the wrong unit; the base-commit leg sees anchors, not run dirs. **Chosen:** an `evidence_schema` leg on `evaluateRunDir`, reached by the action's head step and by `anchor-run`'s self-verify, and called a run-close and local-feedback check rather than a trusted gate, because `.faff/runs/` is gitignored with zero tracked files here and because both call sites execute the in-checkout binary the PR authors.

**Does this change verdicts when it lands?** Yes, and an earlier iteration claimed otherwise while also requiring an unconditional gating self-verify spawn, which was internally contradictory. **Chosen:** retract the no-landing-change rationale and keep the spawn unconditional. The rationale rested on an enforcement flip that does not exist, and the early-parking harm it guarded against is foreclosed by FAFF-1353 blocking this ticket.

**Should the writers be hardened here?** At the time of writing `decision-capture` is contractually best-effort: the empty-`correlation_id` path notes loudly and appends anyway, with a committed comment deferring suppression as a separate contract change, and `captureDecision` wraps its core so a capture defect never surfaces to an authoritative kernel. **Chosen:** no writer change in this ticket. FAFF-1353 closed the write path and blocks this ticket, so the question of whether to suppress a non-conforming append or keep writing the ungradeable row is decided there, once, rather than twice.

**Should the orchestrator's export instruction change?** **Chosen:** no. The instruction already exists in `faff-beep-boop/SKILL.md` and `faff-graft/SKILL.md`, names both affected kernels, and was ignored by the fixture run while being honoured for FAFF-933. Prose is not a control for this.

**What does PR #1092 need?** **Chosen:** nothing. It landed at `ba922f21` with no anchor, which is the recovery this defect leaves and the measure of its real cost.

---

## Agreement points with FAFF-1346

FAFF-1346 owns the severity half: whether `faff events anchor` refuses at mint when its evidence schema check fails, and whether `merge-gate` surfaces "the anchor you have cannot pass CI" as its own refusal reason. FAFF-1347 owns the event scope and integrity unit. FAFF-1346 is blocked by FAFF-1348; FAFF-1347 is blocked by FAFF-1353 (Done), the writer slice of FAFF-1348. These are the places the two must agree.

**Both tickets' premise about PR #1092 is out of date, and FAFF-1346 should not inherit it.** The PR has landed at `ba922f21`, carrying no anchor. `governance-check` passed on it throughout; the required check it failed was `validate`, via the unit shards, driven by the committed tracked-anchor test. Neither ticket should carry it as a blocking dependency or as justification for urgency.

**The enforcement is a committed test, not a switchable flip.** `test/evidence-validate.test.mjs:45`'s `MIXED_CUTOFF` gate is live on a required check today. A fix cannot be scoped as "before the enforcement flip", and FAFF-1346 should not state it that way either.

**A mint-time refusal must use the scoped predicate for a per-issue anchor.** If FAFF-1346's refusal judges a per-issue anchor's `events.jsonl` whole-file while CI judges it scoped, the two disagree on every multi-issue run and the refusal parks runs CI would pass. The classification is a single shared export of `events.js` for exactly this reason.

**Scoped validation narrows what a mint-time refusal fires on.** After this lands, a per-issue anchor of a multi-issue run no longer reports another issue's malformed row as its own, so a mint-time refusal keyed to the per-issue verdict stops firing on the fixture case. That is the intended narrowing.

**Unattributable rows are non-gating at the per-issue leg in a multi-issue anchor, and gating when the bound ledger names one issue.** FAFF-1346 must take the same rule, or the narrowing is undone at a different site and one malformed row again blocks every issue in the run.

---

## Already shipped against this surface

Nothing shipped scopes an anchor's events. The adjacent work:

| Ticket | State | Relevance |
|---|---|---|
| FAFF-1260 | Done | Closed payload schemas for every event type and effect kind: the source of the issue-scoped required-field rule now firing, and of the `issue` typing that lets `""` through the write path |
| FAFF-1256 | Done | The v0.3 evidence schemas, manifest and validator extensions |
| FAFF-1263 | Done | Warn-only schema check at mint: why `faff events anchor` exits 0 today |
| FAFF-568 | Done | Anchored and verified the `events.jsonl` hash chain in `governance-check` |
| FAFF-958 | Done | The ledger-fold drift refusal whose hash-match core the bound-ledger test reuses |
| FAFF-796 | Done | `faff events anchor-run` and the run-level anchor, per ADR 0109 |
| FAFF-1278 | Done | CI trust for anchored evidence: the base-commit `governance-check` leg this design's recovery story depends on |
| FAFF-1155 | Done | Made `ac-checklist.json` and `review-verdict.json` required at the per-PR anchor |
| FAFF-1009, FAFF-956 | Done | Wired the decision-capture kernels and added the loud empty-`correlation_id` note, deliberately continuing to append. Neither addressed an empty `issue` |
| FAFF-1353 | **Done (`abd65009`, PR #1094), blocks this ticket** | The writer fix: the write core refuses any issue-scoped record with an absent, null or empty `issue`, on every path. This ticket's advisory multi-issue treatment is sound only behind it |
| FAFF-1348 | Open, slice 2 only (FAFF-1354) | Parent of FAFF-1353. FAFF-1354 makes a suppressed `decision-capture` name the event type, kernel and rule that refused it, with no exit-code change. Still blocks FAFF-1346 |
| FAFF-1261 | In Review | Slice 6: refuse to mint or merge anchors that fail their schema. Carries no event scoping; FAFF-1346's half |
| FAFF-1270 | Todo | The evidence-readiness proving runs, and one owner of the CI action's `evidence-schema` mode |
| FAFF-1346 | Backlog | The severity half, blocked by FAFF-1348 |

---

## 7. Open questions and assumptions

### Open questions

None. The one blocking open question earlier iterations carried, whether to accept a weaker trusted gate for the multi-issue residue or hold enforcement until the residue had a PR-blocking home, has been decided by the operator and is recorded above as the writer-residue ordering decision. The non-blocking question earlier iterations carried, whether to suppress a non-conforming `decision-capture` append or keep writing the ungradeable row, is no longer this spec's to carry: FAFF-1353 closed the write path and blocks this ticket, and the remaining `decision-capture.js` reporting work is FAFF-1354's.

### Assumptions

**Assumes:** FAFF-1353 lands before this change, such that no conforming writer can emit a row of an issue-scoped type with an absent, null or empty `issue`. *Validation:* confirm FAFF-1353 is Done and that `main` carries its change to the `decision-capture` write path, then confirm mechanically that appending such a record through the write path is refused. If it is not, stop and report rather than proceeding. Validated 2026-10-20 at `abd65009`: `faff events append` of `{"phase":"run","type":"decision-capture","issue":""}` and of the same record with `"issue":null` both exit 1 with `type 'decision-capture' is issue-scoped but missing required field 'issue'`; `FAFF_RUN_DIR=<run> faff next --status todo --spec high` with capture on and no `FAFF_DECISION_ISSUE` exits 0 and writes no row; and `faff events validate` on that run's `events.jsonl` exits 0.

---

## 8. DONE: Definition of Done

### From WHY

- [ ] For a fixture reproducing the four-issue run's shape, a per-issue anchor minted for any one of its issues passes `faff evidence validate <anchor> --require-evidence-schema` with exit 0, where the unscoped validator exits 1 with one violation per unattributable row. Coverage: a new `test/faff-1347-anchor-event-scope.test.mjs`, building its fixture through `test/helpers/evidence-anchor-fixtures.mjs`, never by reading or writing a live run directory.
- [ ] Each of a multi-issue run's per-issue anchors passes independently, and no anchor's exit code changes when a different issue's rows are made non-conforming. Coverage: the same new test file.

### From WHAT (types and scope classification)

- [ ] A row whose `type` is not in the active profile's `issue_scoped_types` classifies run-scoped and contributes gating violations in every per-issue anchor. Coverage: the new test file, plus a case in `test/evidence-validate.test.mjs`.
- [ ] A row of an issue-scoped type whose `issue` is the sentinel and whose `data.kernel` is one of the profile's run-level decision kernels classifies run-scoped. Coverage: the new test file.
- [ ] The same row with a `data.kernel` outside that list classifies unattributable and is counted, not treated as run-scoped. Coverage: the new test file.
- [ ] A row of an issue-scoped type whose `issue` equals the accepted anchored issue contributes gating violations. Coverage: the new test file.
- [ ] A row of an issue-scoped type whose `issue` is a different issue id in the admitted issue set contributes no violations and increments `out_of_scope_rows`. Coverage: the new test file.
- [ ] A row of an issue-scoped type whose `issue` is a non-empty value outside the admitted issue set (`FAFF-9999`), or whitespace-only (`" "`, `"\t"`), classifies `UNADMITTED_ISSUE` in every per-issue anchor of a two-issue run: it increments `unadmitted_issue_rows` and never `out_of_scope_rows`, its violations gate whether or not the ledger is bound, a non-conforming such row fails both issues' anchors, and the same row made conforming passes both. Coverage: the new test file, one case per value.
- [ ] `unadmitted_issue_rows` survives `checkAnchorDir` with the other scope fields and appears in `governance-check`'s text renderer, `--summary-md` and `--json` output. Coverage: `test/evidence.test.mjs` and `test/governance-check.test.mjs`.
- [ ] A row of an issue-scoped type whose `issue` is absent, null or empty increments `unattributable_rows`, and contributes gating violations if and only if the ledger is bound and names exactly one issue. Coverage: the new test file, with one case per combination of boundness and cardinality.
- [ ] `run_subject_sentinels` and `run_level_decision_kernels` are optional array-of-strings keys of the governance profile, in `validateProfileShape`'s closed top-level vocabulary but not in `PROFILE_TOP_ARRAY_KEYS`; `DELIVERY_PROFILE` carries `["__run__"]` and `["queue-state", "run-start", "run-done", "run-outward"]`; and an override profile that renames the sentinel or drops a kernel changes the classification with no edit to the validator. Coverage: a profile-override test following the existing pattern in `test/events.test.mjs`, plus a `validateProfileShape` case for each new key of the wrong type (refused) and each new key absent (accepted).
- [ ] An override profile file that predates the two keys still passes `validateProfileShape` with no violations, `activeProfile` returns it without throwing, and the classifier then uses `DELIVERY_PROFILE`'s sentinel and kernel values. Coverage: the same profile-override test, using a copy of `DELIVERY_PROFILE` with both keys deleted.
- [ ] Adding an event type to `issue_scoped_types` changes the classification with no edit to the validator. Coverage: the same profile-override test.
- [ ] The classification ignores `seq`, `ts` and file position: reordering a chain's rows, with `prev` links and the witness recomputed so the chain still verifies, changes no verdict. Coverage: the new test file.
- [ ] `scope_refusals` entries are drawn from the seven closed-set literals only, and a `chain-head.json` `issue` carrying a control character or a `::` sequence produces `issue-malformed` with no part of the proposed value in the rendered output. Coverage: the new test file.

### From WHAT (the integrity unit)

- [ ] A per-issue anchor's `events.jsonl` is byte-identical to the run's `events.jsonl` after the change. Coverage: `test/events-chain.test.mjs`.
- [ ] `chain-head.json`'s `head_seq`, `head_sha256`, `line_count` and `schema_floor` are unchanged from the values today's mint produces for the same run. Coverage: `test/events-chain.test.mjs`, and `test/effects-chain.test.mjs` for the effects witness.
- [ ] `run-ledger.json` and `declared-effects.jsonl` remain byte-copied unfiltered, and `effects-chain-head.json` remains computed over the unfiltered effects buffer. Coverage: `test/effects-chain.test.mjs`.
- [ ] `faff events verify` and `governance-check`'s integrity leg report the same verdict for an anchor minted before and after the change. Coverage: `test/events-chain.test.mjs`.

### From WHAT (resolving and corroborating the anchored issue)

- [ ] The scoped verdict resolves its proposed issue from the anchor's `chain-head.json` `issue` field, with no new flag at any call site, and `faff evidence validate <dir> --require-evidence-schema --json` run with no `--issue` produces the scoped verdict. Coverage: the new test file, and `test/faff-1278-governance-check-base-commit-leg.test.mjs`.
- [ ] Each of the seven refusal literals, triggered in isolation, produces no narrowing, a null `scope`, exactly that one literal in `scope_refusals`, and a verdict identical to the unscoped validator's over the same bytes. For `ledger-unavailable` there are three cases: `run-ledger.json` absent, unreadable, and not valid JSON; none reports `ledger-disagrees`. Coverage: the new test file, one case per literal.
- [ ] The path-agreement corroboration applies to every anchor directory regardless of basename shape: an anchor at `<anchors>/<run>/notanissue/` whose `chain-head.json` names a real admitted issue of the run is judged whole-file. Coverage: the new test file.
- [ ] The token-shape corroboration uses the path-safety token shape, and a lowercase or dotted bare-token issue id that agrees with its directory basename, its ledger and its chain narrows successfully. Coverage: the new test file.
- [ ] An anchor directory with no `chain-head.json`, or whose `chain-head.json` carries no usable `issue`, is judged whole-file with every row gating. Coverage: the new test file, and a case in `test/evidence-validate.test.mjs`.

### From WHAT (how the fields reach the renderers)

- [ ] `checkAnchorDir` carries the per-file scope block for an `events.jsonl` entry whatever its status, including `ok`, while still dropping violation text and exception messages. Coverage: a case in `test/evidence.test.mjs` asserting both halves.
- [ ] The scope identity, the refusal literals and the residue counts appear in `governance-check`'s text renderer and its `--summary-md` output, not only in `--json`. Coverage: `test/governance-check.test.mjs`.
- [ ] Every per-line violation detail string of both legs passes `sanitiseDisplay`, and passes `escapeWorkflowData` before entering a workflow command: a judged row whose `issue` value is `FAFF-1::error::injected` produces no `::` sequence in the annotation output and appears nowhere verbatim in the text or `--summary-md` output. Coverage: the new test file and `test/governance-check.test.mjs`.

### From HOW (the run-dir whole-file judgement)

- [ ] `governance-check --run-dir <dir> --require-evidence-schema` fails when the run's `events.jsonl` carries a row of an issue-scoped type with an empty `issue`, with the leg named in the verdict's reasons alongside the offending line numbers, and the same invocation without the flag is report-only and exits 0. Coverage: `test/governance-check.test.mjs` and the `evaluateRunDir` selftest cases in `governance-check.js`.
- [ ] The leg's per-line detail reaches the leg's `detail` string and the `--json` verdict, and `anchor-run`'s self-verify reports it to stderr. Coverage: `test/governance-check.test.mjs` and the `anchor-run` selftest cases.
- [ ] `faff events anchor-run` spawns the run-dir judgement with the evidence-schema leg gating, and on a non-zero exit wipes the whole `dest` tree and exits non-zero. Coverage: the `anchor-run` selftest cases, matching the existing wipe-on-failure assertions.
- [ ] Given a run chain whose only non-issue subject is a corroborated sentinel row, `anchor-run` exits 0 and mints every issue's anchor. Coverage: the same selftest cases.
- [ ] Legacy cutoff at the run-dir leg: a two-issue run minted the way real mints are (`ledger-write` at seq 0, `run-start` at seq 1) whose `run-start` `ts` is `2026-10-20T17:51:17Z` and whose chain carries one row of an issue-scoped type with an empty `issue` passes `governance-check --run-dir <dir> --require-evidence-schema`, reporting the row as advisory, and `anchor-run` exits 0 and mints both anchors. The same run with its `run-start` `ts` at `2026-10-20T17:51:18Z` or later fails both, as does a single-issue run with the earlier `ts`, and a legacy two-issue run whose only violation is a non-conforming row with a non-empty `issue` still fails. Coverage: `test/governance-check.test.mjs` and the `anchor-run` selftest cases.
- [ ] `anchor-run`'s existing refusals are unchanged: a missing `ledger-write` event exits 1, an `eventsLedgerFold` mismatch exits 1, a missing `events.jsonl` exits 3, and a mint failure wipes `dest`. Coverage: the existing `anchor-run` selftest cases, re-run unmodified.

### From HOW (one shared predicate)

- [ ] The classification is a single named export of `events.js`, and both the per-issue scoped verdict and the run-dir whole-file leg reach it through that one export. Asserted by substitution over an explicit fixture: a chain of three parsed rows, one conforming `OWN` row, one conforming run-scoped row, and one non-conforming `OTHER_ISSUE` row at a known line number. The scoped verdict reports no gating line numbers; the same path with narrowing off reports exactly that one line number; and when the export is replaced with a double that returns `OWN` for every row, the scoped verdict reports that same one line number too. A build with a second divergent classifier on either path fails at least one of the three.
- [ ] The run-dir leg is that same export with narrowing off, not a second classifier: for one fixture buffer, the scoped and unscoped reports differ only in the violation set and the scope fields. Coverage: the new test file.

### From HOW (existing refusals and warn-only behaviour preserved)

- [ ] `faff events anchor`'s `--issue` shape validation, the FAFF-958 ledger-fold drift refusal, and the FAFF-1155 floor-incomplete exit 3 are unchanged. Coverage: `test/events-anchor-genesis-guard.test.mjs` and `test/faff-1155-anchor-floor-required.test.mjs`, re-run unmodified.
- [ ] The post-mint `warnOnEvidenceSchema` check remains warn-only and still never changes the exit code, now reporting the scoped verdict. Coverage: `test/faff-1263-evidence-warn-only-mint.test.mjs`.
- [ ] `faff events append` still refuses an issue-scoped type with no `issue`, unchanged. Coverage: `test/events.test.mjs`.
- [ ] No file under `decision-capture`'s write path is modified by this change, and `decision-capture`'s best-effort posture is unchanged: no kernel's exit code or stdout changes. Coverage: `test/decision-capture.test.mjs` and `test/decision-capture-wiring.test.mjs`, re-run unmodified.
- [ ] Every git-tracked anchor still passes the committed tracked-anchor walk, with no change to `MIXED_CUTOFF` and no addition to `MIXED_ANCHORS`. Coverage: `test/evidence-validate.test.mjs`, re-run unmodified.

### From HOW (edge cases)

- [ ] An unparseable line is a gating violation in both the scoped and the whole-file verdict. Coverage: the new test file.
- [ ] A torn final line is tolerated in both verdicts. Coverage: `test/evidence-validate.test.mjs`.
- [ ] For a single-issue graft run with a bound ledger, the scoped verdict and exit code are identical to the unscoped validator's for the same anchor. Coverage: the new test file.
- [ ] An anchor whose own issue's rows carry a violation still fails, the narrowing having changed nothing about it. Coverage: the new test file.

### Eval coverage

No LLM-judgement seam is introduced or changed: the classification is a pure function of two record fields plus one data field against committed profile lists, the corroborations are string and set comparisons plus one hash comparison, and the run-dir leg is the existing validator with narrowing off. No grader `KIND`, eval case or seam-registry row is required.

### Integration smoke test

```
PROCEDURE smoke():
  1. Build a two-issue run fixture whose chain carries, for issue A and issue B:
     a. A's own rows and B's own rows
     b. run-scoped rows by type
     c. one row of an issue-scoped type with an empty issue field
     d. one row of an issue-scoped type carrying the sentinel with a run-level kernel
     e. a final ledger-write row whose data.ledger_sha256 is the hash of the
        fixture's run-ledger.json, so the fold matches and anchor-run's own
        precondition is satisfied
  2. Mint a per-issue anchor for A, and one for B
  3. Validate each with --require-evidence-schema:
     a. Both exit 0
     b. Each reports its own issue as its scope with empty scope_refusals, a
        non-zero out-of-scope count, an unattributable count of exactly 1, and
        unattributable_gating false
  4. Confirm each anchored events.jsonl is byte-identical to the run's, and each
     chain-head.json matches the pre-change witness values
  5. Run governance-check over the run dir with --require-evidence-schema:
     a. It exits non-zero, names the evidence_schema leg and the empty-issue line
  6. Run anchor-run over the same fixture:
     a. It exits non-zero and leaves no dest tree
  7. Remove the empty-issue row and re-chain the fixture from genesis, then
     RE-WRITE the final ledger-write row's data.ledger_sha256 to the hash of the
     unchanged run-ledger.json and re-chain again, so the fold still matches.
     Without that refresh the re-chain breaks the fold and anchor-run fails for a
     reason unrelated to what this step tests
  8. Re-run anchor-run:
     a. It exits 0 and mints both issues' anchors
```

---

## Self-review findings and resolutions

Revision 4's self-review findings (one blocker, five majors, four minors, every one resolved in the spec body) are kept in the companion comment headed "FAFF-1347 spec: revision 4 self-review record", to fit Linear's comment size limit. The residuals below are current.

**Not dismissed, recorded as residual.** Four things this design does not close and does not claim to. First, an actor who rewrites `events.jsonl` wholesale, re-chains from genesis, rehashes `run-ledger.json` into a fresh `ledger-write` row and recomputes `chain-head.json` can produce a coherent forged anchor; that residual predates this spec. The corroborations do not close it either: they compare bytes the PR writes with other bytes the PR writes, so an actor who controls the whole anchor satisfies all four, and because that actor writes every row, making the other issues' rows conform too costs nothing extra. Accepted by operator decision of 2026-10-21 (spec-review round 5). Second, the run-dir whole-file leg cannot fire in this repository at all (`.faff/.gitignore:2` is `/*`; `git ls-files .faff/runs` is empty against 2887 tracked anchor files), so the residue's visibility here rests on the advisory counts and its non-production rests on FAFF-1353. Third, an early Step-9b anchor with no `ledger-write` row treats unattributable rows as advisory where today they gate, which is a real if narrow weakening, accepted because buying it back would mean gating off bytes the PR authors. Fourth, the rows of an admitted issue whose own PR never lands, so whose own anchor is never committed, are judged by no trusted gate: they sit in the other issues' anchors as other-issue rows. Accepted by operator decision of 2026-10-21 (spec-review round 5): judging them inside another issue's anchor is the hostage-taking this spec removes, and they describe work that never reached `main`.

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "chosen" } ] }
```

build-tier: complex
spec-review: accept (operator, 2026-10-21; round 5 returned reject-approach at the iteration cap: QA major fixed in revision 7, architectural and infosec majors accepted as risk)