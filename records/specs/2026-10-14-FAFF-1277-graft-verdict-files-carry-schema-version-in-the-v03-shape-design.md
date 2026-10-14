# FAFF-1277: Graft's verdict files carry schema_version in the v0.3 shape

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1277.

This spec is for the build agent and the human reviewer of FAFF-1277, a child of the anchor-evidence epic FAFF-1255. It moves the two remaining graft hand-writes, `ac-checklist.json` and `review-verdict.json`, onto CLI writers that stamp `schema_version` and emit the v0.3 shape, so a freshly minted graft anchor validates as `pass` before FAFF-1261 turns the mint warning into a refusal.

## 1. WHY

**The load-bearing model.** `faff evidence validate` calls an anchor `legacy` only when no evidence document in it carries `schema_version`. Since FAFF-1258, `run-ledger.json` and `build-progress.json` always carry it, so any other file left in the pre-v0.3 shape makes the whole anchor `fail`. An anchor passes only when every file graft writes comes from a writer that stamps and validates. Two files still have no writer at all: graft Step 8 hand-serialises `ac-checklist.json` and Step 9 hand-writes `review-verdict.json`. The third, `spec-review-verdict.json`, already has `faff evidence write spec-review-verdict` (FAFF-1267).

**Problem.** The FAFF-1274 and FAFF-1224 anchors are mixed and listed in `MIXED_ANCHORS` (`test/evidence-validate.test.mjs`); every later graft PR must add a row, and FAFF-1261 would refuse every graft anchor. This change adds the two missing writers, points graft at them, and makes the test refuse a new mixed anchor.

**Why the third file was mixed too.** The FAFF-1274 and FAFF-1224 `spec-review-verdict.json` files carry `conformant` and `violations`, which is `faff contract spec-review-verdict` stdout: the old Step 9b. The repo's graft SKILL already pipes the comment to the writer, and the writer accepts the FAFF-1274 comment (checked: a reconstructed comment with digest `06d02534…` writes a file that validates `pass`). The harness loaded `~/.claude/skills/faff-graft/SKILL.md`, a stale copy (dated 2026-10-10) that has no `faff evidence write` line, rather than the repo's symlinked skill. No code change fixes a stale copy; see Assumptions.

**Design principles.**

- **One writer per file, in code.** No SKILL step serialises an evidence document by hand. The writer owns key order, `schema_version`, null-fill and validation; the SKILL builds the input and pipes it.
- **Honest about missing history.** Code-review rounds are not recorded until FAFF-1268. The interim file says so (`round_history: "terminal-only"`) rather than looking like a clean one-round review.
- **Fail closed, not open.** A writer refusal writes nothing, so the merge floor reads the file as missing and refuses, exactly as a missing hand-written file does today.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/evidence.js` | `faff evidence write spec-review-verdict`, `guardWriterPaths`, `writeEvidenceFile`, `anchoredSpecReview`; the new writers go beside them |
| `plugin/skills/faff/bin/lib/finding-id.js` (FAFF-1266) | `assignFindingIds(findings, round)` gives each finding its id |
| `plugin/skills/faff/bin/lib/contract-defs.js` `computeReviewVerdict` | Read by `merge-gate.readReviewVerdict` and governance-check; flags `null` severity/source/disposition as violations today |
| `plugin/skills/faff/bin/lib/merge-gate.js` `readAcComplete` | Reads `all_verified` and cross-checks `criteria`; ignores extra keys |
| `verification/evidence/v0.3/schema/` and its byte-identical copy `plugin/skills/faff/contracts/evidence-v0.3/schema/` | `ac-checklist`, `review-verdict-anchored`, `run-event` schemas |
| `plugin/skills/faff/bin/lib/governance-profile.js` `DELIVERY_PROFILE.event_types` | Registry for the new `evidence-terminal-only` event |
| `plugin/skills/faff-graft/SKILL.md` Step 8, Step 9 (terminal verdict and the park paths), Step 9b | The hand-writes this replaces |
| `plugin/skills/faff/bin/lib/evidence-readiness.js` `WRITER_TICKETS` | The readiness criterion's list of writer tickets |
| `test/evidence-validate.test.mjs` `MIXED_ANCHORS` | The committed-anchor test this tightens |

**Scope.** The writer half of FAFF-1255 slice 2 that does not depend on cross-round finding identity. Round recording and collation stay with FAFF-1268.

## 2. OUT OF SCOPE

- **Recording each code-review round and collating rounds on `finding_id`** (`faff evidence record-review-round`, the bare `faff evidence write review-verdict`, the "do not stamp `fixed` when the final round parked" rule, carrying `review-rounds/` across resume). Why: needs the reviewer-carried ids of FAFF-1276. Extension point: FAFF-1268 adds the bare form beside `--terminal-only` in `evidence.js` and switches graft Step 9 from `--terminal-only` to it.
- **Passing `finding_id`, `occurrences` and the other collation fields through `computeReviewVerdict`'s output and `contracts/review-verdict.schema.json`.** Why: no consumer reads them from the contract output; the anchored file is validated by the v0.3 schema. Extension point: FAFF-1268, with the collator.
- **`review-verdict.json` with `signal: "unavailable"`** (the outage-exhausted needs-human park). Why: the v0.3 schema has no `unavailable` signal, and a parked issue never reaches Step 9b, so this file is never in a per-PR anchor. It stays the raw contract block. Extension point: FAFF-1268's park-path minor ("the writer must handle both").
- **Mint refusal.** Why: FAFF-1261, which this issue blocks.
- **Closed `data` schemas per event type.** Why: FAFF-1260. Whichever of FAFF-1260 and FAFF-1277 lands second registers `evidence-terminal-only` in the other's structure.
- **Repairing the two committed mixed anchors.** Why: anchors are immutable. They keep their `MIXED_ANCHORS` rows.
- **Refreshing stale global skill copies.** Why: environment, not repo code. See Assumptions.

## 3. WHAT

### Boundary with FAFF-1268

**Chosen:** move `faff evidence write ac-checklist`, `faff evidence write review-verdict --terminal-only` (with its `evidence-terminal-only` event), the `null`-as-absent normaliser change, and the graft Step 8 and Step 9 writer calls from FAFF-1268 to FAFF-1277. FAFF-1268 keeps round recording, the collating bare form, the contract pass-through of collation fields, the `unavailable` park write and the resume carry. Why: none of the moved pieces needs a stable cross-round id, and without them every graft anchor fails at FAFF-1261. The product owner confirmed this boundary on 2026-10-14: FAFF-1268's description records it, and FAFF-1277 blocks FAFF-1268.

### `faff evidence write ac-checklist --run-dir D --issue I`

```
INPUT (stdin JSON):
  all_verified: Boolean
  criteria?: List<{ ac: String, verified: String, passed: Boolean }>

OUTPUT D/I/ac-checklist.json (schema v0.3 ac-checklist):
  schema_version: 1
  all_verified: Boolean
  criteria?: List<{ ac, verified, passed }>     # key omitted only when the input omits it

WRITER-ONLY CONSTRAINTS (exit 1, nothing written):
  criteria present and [] or null               # zero-AC input omits the key instead
  criteria present and all_verified != every(criteria.passed)
```

Unknown input keys (including legacy `ac_complete`) are dropped. Strings pass through `redactKnownSecrets`.

### `faff evidence write review-verdict --terminal-only --run-dir D --issue I`

```
INPUT (stdin JSON): the terminal review-verdict block graft already builds at Step 9
  signal: "pass" | "fail" | "needs-human"
  findings: List<{ title?, location?, action?, location_present?, action_present?, severity?,
                   source?, model?, disposition?, refutation?, disposition_rationale? }>
  adversarial_outcome?: "chain-outage-skipped"

OUTPUT D/I/review-verdict.json (schema v0.3 review-verdict-anchored):
  schema_version: 1
  signal
  adversarial_outcome?                          # present only when the input carries it
  rounds_total: 1
  round_history: "terminal-only"
  findings: per input finding i, in input order:
    finding_id: assignFindingIds(findings, 1)[i]
    title, location, action: String | null
    location_present, action_present: Boolean   # input value coerced with !!
    severity, source, model, disposition, refutation, disposition_rationale: value | null
    first_round: 1, last_round: 1
    occurrences: [{ round: 1, title, location, severity, disposition }]
```

- Refuses (exit 1) when `D/I/review-rounds/` holds any `round-*.json`, so it cannot overwrite a collated history once FAFF-1268 records rounds.
- Refuses (exit 1) on `signal: "unavailable"`, naming the raw-block park path.
- Every refusal and parse-failure message names the file, key path and rule, never an input value (the `sanitiseDisplay` discipline `evidence.js` already applies), so a secret in stdin never reaches stderr.
- Bare `faff evidence write review-verdict` without `--terminal-only` exits 2 with a usage line saying round collation is not yet available.

**Chosen:** add optional `adversarial_outcome` (`enum: ["chain-outage-skipped"]`) to `review-verdict-anchored.schema.json` (both copies), declared after `signal`. Why: faff-beep-boop reads it from the run-dir `review-verdict.json` to fill `review_adversarial_skipped`; dropping it would silently misreport an outage-skipped merge, and keeping it unschemaed would fail validation. v0.3 is still draft, so the edit is in place.

### The `evidence-terminal-only` event

Once its input passes validation, and before the file is written, the `--terminal-only` writer appends one event to `D/events.jsonl` through the events library: `type: "evidence-terminal-only"`, issue-scoped to `I`, `data: { issue: I, writer: "faff evidence write review-verdict --terminal-only" }`. The type joins `DELIVERY_PROFILE.event_types` and `issue_scoped_types` and the `type` enum of `run-event.schema.json` (both copies). If FAFF-1260 has landed, also add its closed `data` schema `{issue, writer}`.

**Chosen:** emit the event even though every graft run uses `--terminal-only` until FAFF-1268. Why: the parent design pairs `round_history` with a hash-chained event so a file edit alone cannot hide the missing history; dropping it would re-open a closed parent decision.

### Normaliser

**Chosen:** in `computeReviewVerdict`, a finding's `severity`, `disposition` or `source` that is `null` is treated as absent (no violation, not copied). Why: the writer null-fills these keys, and `faff contract review-verdict` would otherwise report every writer-produced file as non-conformant. Signal routing and the `location_present`/`action_present` checks are unchanged.

### Committed-anchor test

**Chosen:** freeze `MIXED_ANCHORS` with a literal run-timestamp cutoff, `MIXED_CUTOFF`, set to the timestamp of the FAFF-1277 graft run id (`run-YYYYMMDD-HHMMSS-…`). Rules per git-tracked anchor directory:

```
ts := the YYYYMMDD-HHMMSS part of the run directory name
IF rel in MIXED_ANCHORS: status = fail, failing files = the listed set, and ts <= MIXED_CUTOFF
ELSE IF status = pass: ok
ELSE IF status = legacy AND ts <= MIXED_CUTOFF: ok (exit-code checks as today)
ELSE: test fails, naming the anchor and its failing files
Also: every MIXED_ANCHORS key has ts <= MIXED_CUTOFF
```

Why: a new mixed anchor now fails the test, and adding a row for it also needs a visible cutoff edit. One allowance is intended: a graft run that started before the FAFF-1277 graft run (for example FAFF-1260, building in parallel) minted its anchor with the old CLI, so it may be listed with its failing files. Any run started after the cutoff has the writers and must pass; a later row needs a reviewed cutoff change, never a quiet list edit.

## 4. HOW

```
PROCEDURE build:
  1. evidence.js: add anchoredAcChecklist, anchoredTerminalReview and their writer-only checks;
     route `faff evidence write <name>` to spec-review-verdict | ac-checklist | review-verdict;
     each writer: guardWriterPaths -> parse stdin (parse failure exit 1) -> redactKnownSecrets
     -> normalise -> validate against the bundled schema named by the anchor manifest
     -> writer-only checks -> writeEvidenceFile (two-space JSON, trailing newline, atomic).
     Update USAGE and the selftest.
  2. review-verdict --terminal-only: append the event first, then write the file. An append failure
     exits 2 with no file written. A crash between the two leaves the trace without the file, which
     the merge floor already reads as missing (fail closed). The events library appends one line
     under its lock with one appendFileSync and repairs a crashed holder's torn tail on the next
     append, so the only torn-tail case is a crash, and it never pairs with a written file.
  3. Schemas: adversarial_outcome in review-verdict-anchored; evidence-terminal-only in run-event's
     type enum; both trees byte-identical. Add a valid example variant only if the examples test needs one.
  4. governance-profile.js: register the event type (event_types, issue_scoped_types).
  5. contract-defs.js computeReviewVerdict: null-as-absent for severity, disposition, source.
  6. evidence-readiness.js: add FAFF-1277 to WRITER_TICKETS.
  7. faff-graft/SKILL.md:
     a. Step 8: replace the hand-serialisation sentences with: build {all_verified, criteria}
        (criteria omitted for zero AC) and pipe it to `faff evidence write ac-checklist --run-dir
        "$run_dir" --issue <ISSUE>`; a non-zero exit is logged and leaves no file (the merge
        floor fails closed).
     b. Step 9 terminal verdict, the needs-human park, and the build-review hold-limit park: pipe
        the dispositions-folded block to `faff evidence write review-verdict --terminal-only`.
        The unavailable-exhausted park keeps writing the raw block.
     c. Step 9b's spec-review sentence is unchanged.
     Keep the file at or under its SKILL_LINE_BASELINE (960); replace sentences, do not add paragraphs.
  8. test/evidence-validate.test.mjs: MIXED_CUTOFF and the rules above.
  9. New tests (below), then dogfood: this build writes its own ac-checklist, review-verdict and
     spec-review-verdict through the worktree's CLI (`<worktree>/plugin/skills/faff/bin/faff`),
     because the `faff` on PATH resolves to the main checkout, which lacks the new writers until merge.
```

**Edge cases.**

- Zero-AC issue: input `{all_verified: true}` writes `{schema_version: 1, all_verified: true}`; `readAcComplete` returns true. The writer cannot tell a zero-AC issue from withheld criteria; neither can today's hand-write. The criteria come from graft's per-AC source (the same one the PR-body checklist uses), and the parent design keeps the omitted key as the zero-AC form because `readAcComplete` fails `[]` and `null` closed.
- `criteria: []`: refused, exit 1. Graft must omit the key instead.
- A finding with no title: `finding_id` is `round-1#<i>` from the helper; duplicates are suffixed by the helper.
- A `needs-human` block with zero findings is already a contract violation at Step 9; the writer does not re-check it, since the schema allows it and the floor routes on `signal`.
- Run dir in the main checkout while graft runs in a worktree: `guardWriterPaths` already accepts both roots.
- `EvidenceReturn` (dispatched lanes) and the governance-check integrity re-hash compare raw bytes, so the writer's two-space format changes nothing for them.

**Anti-pattern:** having graft keep a fallback hand-write when the writer refuses. Why: a fallback recreates the mixed anchor this ticket removes; a missing file already fails the floor closed.

**Anti-pattern:** stamping `rounds_total` from the number of review passes graft remembers. Why: no round records back it; `terminal-only` with `rounds_total: 1` is the documented honest form.

**Failure mode.** The stale-skill problem recurs: a harness keeps loading an outdated graft SKILL, so the writers exist but are not called. How you'd know: a new anchor fails the tightened committed-anchor test in CI, and `faff evidence-readiness` counts the warning. What it means: refresh the skill install; do not add a `MIXED_ANCHORS` row.

## 5. Scenarios

```
Given a run dir with a minted ledger and events chain, a build-complete checkpoint, and a carried
  ## Spec-review evidence comment
When ac-checklist, review-verdict --terminal-only and spec-review-verdict are written through the
  writers and `faff events anchor` mints the per-PR anchor
Then `faff evidence validate <anchor>` reports pass with every file ok
  and events.jsonl in the anchor holds one evidence-terminal-only event for the issue
```

```
Given a git-tracked anchor whose run timestamp is after MIXED_CUTOFF and whose review-verdict.json lacks schema_version
When test/evidence-validate.test.mjs runs
Then the committed-anchor test fails naming that anchor and review-verdict.json
```

```
Given a terminal review block with signal pass and adversarial_outcome "chain-outage-skipped"
When it is piped to faff evidence write review-verdict --terminal-only
Then the written file validates against review-verdict-anchored and still carries adversarial_outcome
  and merge-gate's readReviewVerdict returns "pass"
```

## 6. DESIGN DECISION RATIONALE

- **Which FAFF-1268 writers move here?** Moving everything waits on FAFF-1276; moving nothing leaves every anchor failing. **Chosen:** move the pieces that need no cross-round id (ac-checklist writer, terminal-only review writer and event, normaliser null tolerance, graft calls); FAFF-1268 keeps collation.
- **Interim review-verdict shape: terminal-only, or a new "single" history value?** A new enum value widens the schema for a temporary state. **Chosen:** `--terminal-only`, the parent's documented form for "earlier rounds not recorded", which is literally true until FAFF-1268.
- **Emit `evidence-terminal-only` on every run?** It is noisy until FAFF-1268. **Chosen:** emit; the parent design made the event the tamper-evident half of the honesty rule.
- **`adversarial_outcome`: drop, or schema it?** Dropping breaks beep-boop's outage annotation. **Chosen:** add it as an optional enum to the draft v0.3 schema.
- **`unavailable` park file: writer, or raw?** The schema has no `unavailable` and the file never reaches a per-PR anchor. **Chosen:** raw, left to FAFF-1268.
- **How to stop silent `MIXED_ANCHORS` growth?** A count assertion is as easy to edit as the list. **Chosen:** a run-timestamp cutoff, so a new row needs a dated, visible change and post-cutoff anchors must pass.
- **Null tolerance in the normaliser now, or with FAFF-1268?** **Chosen:** now; the writer null-fills, so the contract would otherwise flag every file this ticket writes.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumes:** the harness that runs later graft builds loads the repo's `plugin/skills/faff-graft/SKILL.md` (through the `scripts/link-skills.sh` symlinks), not a stale copy. Validation: `grep -c "faff evidence write" ~/.claude/skills/faff-graft/SKILL.md` is non-zero, or `~/.claude/skills/faff-graft` is a symlink into the repo. On 2026-10-14 it was a stale copy without the line.

**Assumes:** FAFF-1261 has not landed, so v0.3 is still draft and editable in place. Validation: `verification/evidence/README.md` lists `v0.3/` as `draft`.

**Assumes:** `faff holdout record` (FAFF-1259) already writes a conforming `holdout.json` when a holdout runs. Validation: `faff evidence validate` on an anchor with a recorded holdout reports `holdout.json: ok`.

## 8. DONE

### From WHY
- [ ] The FAFF-1277 graft's own per-PR anchor validates as `pass` with `faff evidence validate`.
- [ ] `MIXED_ANCHORS` keeps its committed rows and gains none for anchors after `MIXED_CUTOFF`.

### From WHAT
- [ ] `faff evidence write ac-checklist` writes `schema_version: 1`, omits `criteria` for zero-AC input, refuses `criteria: []`, `null`, and an `all_verified` that disagrees with the criteria (exit 1, nothing written).
- [ ] `faff evidence write review-verdict --terminal-only` writes `rounds_total: 1`, `round_history: "terminal-only"`, every finding key null-filled, `finding_id` from `assignFindingIds`, one occurrence per finding; the output validates against the bundled schema.
- [ ] It keeps `adversarial_outcome`, drops other unknown keys, and refuses `unavailable` and a run dir with any `review-rounds/round-*.json`.
- [ ] Bare `faff evidence write review-verdict` exits 2 with a usage line.
- [ ] `review-verdict-anchored.schema.json` declares optional `adversarial_outcome` and `run-event.schema.json` lists `evidence-terminal-only`; both schema trees stay byte-identical.
- [ ] `evidence-terminal-only` is in `DELIVERY_PROFILE.event_types` and `issue_scoped_types`.
- [ ] `computeReviewVerdict` reports no violation for a `null` severity, disposition or source, and routes on `signal` unchanged.
- [ ] `WRITER_TICKETS` includes FAFF-1277.
- [ ] The committed-anchor test enforces the `MIXED_CUTOFF` rules, and a fixture anchor dated after the cutoff with a mixed file fails it.

### From HOW
- [ ] Every writer refuses a bad `--issue` or a `--run-dir` outside `.faff/runs/` with exit 2 and writes nothing.
- [ ] A known secret in a criterion's `verified` text or a finding's `disposition_rationale` is written as `[REDACTED]`.
- [ ] A successful terminal-only write appends exactly one `evidence-terminal-only` event before the file lands; a failed append (forced in a test) exits 2 and leaves no `review-verdict.json`.
- [ ] graft Step 8 and the Step 9 terminal, needs-human and hold-limit writes call the writers; no SKILL text hand-serialises either file; `faff validate-adapters` passes.
- [ ] `node --test test/evidence-validate.test.mjs test/evidence-v0.3.test.mjs` and the new writer tests pass; `faff evidence --selftest` passes.

### Integration smoke test

```
1. In a temporary git repo: faff run-ledger init-interactive --issue FAFF-1 -> $run_dir
2. faff build-progress write $run_dir FAFF-1 --build-complete --diff-hash <h> --branch b
3. echo '{"all_verified":true,"criteria":[{"ac":"a","verified":"Verified: t","passed":true}]}'
   | faff evidence write ac-checklist --run-dir $run_dir --issue FAFF-1
4. echo '{"signal":"pass","findings":[{"title":"x","location":"a.js:1","location_present":true,
   "action_present":true,"severity":"minor","source":"standard","disposition":"fixed"}]}'
   | faff evidence write review-verdict --terminal-only --run-dir $run_dir --issue FAFF-1
5. A collate-evidence --comment body | faff evidence write spec-review-verdict --run-dir $run_dir --issue FAFF-1
6. faff events anchor --run-dir $run_dir --issue FAFF-1 --dest <dest>
7. faff evidence validate <dest> --json -> status "pass"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** No issues. Two small writers, two schema edits, one event type, one test rule and three SKILL sentences, all serving one outcome (a graft anchor that passes). About two days; splitting the writers apart would ship an anchor that still fails.
- **Workstream fit? (principles 1 and 5)** No issues. A child of FAFF-1255, whose outcome is enforceable anchor evidence.
- **Dependencies surfaced? (principle 6)** Resolved. FAFF-1268 extends this ticket's `faff evidence write review-verdict`, so FAFF-1277 now blocks FAFF-1268; FAFF-1260 shares the run-event type list and is now linked as related (product-owner decision, 2026-10-14).
- **Risk profile? (principle 7)** One environmental risk: the harness has loaded a stale global copy of the graft SKILL, so the new writer calls can go unused after merge. The spec names it as an assumption with a check; refreshing the install is a small step outside the repo.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-1 major resolved by product-owner decision, minors fixed, not re-reviewed)

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
