*Agent-written (Claude Code): FAFF-1429 spec, produced by interactive prep for the operator.*

# FAFF-1429: spec commit surfaces the over-withholding advisory and returns the commit-subject scheme

> Spec: faffter-dark-nlspec · 2026-11-05 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1429.

This spec is for the build agent and its reviewers. It restores two behaviours FAFF-1404 lost when graft's Step 4 prose moved into `faff spec commit`: the non-gating over-withholding advisory, and a single resolved `commit_subject` scheme that Steps 4c and 10 reuse.

> **Spec-review state (2026-11-04).** One adversarial round (architectural, infosec, methodology, QA): `revise` with four minors and no major; infosec and QA clear. All four minors are fixed in this text (record authority on `already-committed`, old-record reading, the exact pinned phrases, the baseline procedure). Following the operator's minors-only rule, no second round ran; recommended for accept.

## 1. WHY

**The load-bearing idea:** a command that replaces prose must carry every output the prose produced. `spec commit` computes both values and throws them away.

- **The advisory.** `dodSplit` (`admissibility.js` around line 441) returns `warnings` when the builder view keeps zero born-verifiable scenarios though the full spec had at least one. The deleted Step 4 prose said this advisory "is logged, never blocking". `builderBytes` (`spec-commit.ts` line 114) keeps only `.text`, so the warning reaches no stderr, no `spec-commit.json` and no `graft.md`.
- **The scheme.** Step 4 used to run `scheme=$(faff conventions get commit_subject)` once. `spec commit` now resolves it internally (`deps.commitScheme`, used at line 270) and returns nothing. `faff-graft/SKILL.md` line 161 still says Step 4c and the merge-time ADR renumber "reuse that scheme", and lines 196 and 551 say "the scheme Step 4 already resolved". An agent following the prose has no value to reuse.
- The practical impact of the scheme gap is small, because `.faff/conventions.json` caches the resolution. The prose is still wrong, and an agent may re-mine or guess.

### Reference context

- `plugin/skills/faff/bin/lib/spec-commit.ts`: `SpecResult` (line 22), `SpecCommitRecord` (line 36), `builderBytes` (line 114), `runSpecCommit` (line 218), `emit` (line 321); the committed `.js` emit beside it.
- `plugin/skills/faff/bin/lib/admissibility.js`: `dodSplit`, its `warnings` array.
- `plugin/skills/faff/bin/lib/conventions.js`: `commit_subject` values `conventional` and `bare-imperative`.
- `plugin/skills/faff-graft/SKILL.md`: Step 4 (lines 159–172), Step 4c (line 196), Step 10's ADR-collision guard (line 551).
- `test/spec-commit.test.mjs` (25 tests, real temp git repos); `docs/guide/cli.md` line 112.

### Already shipped against this surface

- FAFF-1404 (`faff spec commit` / `faff spec verify`, #1152): the command this extends. Its byte-for-byte commit, `needs-judgement` paths and record shape are unchanged apart from the additions below.

## 2. OUT OF SCOPE

- Changing the over-withholding rule itself, or making it gate.
- `spec verify`.
- How `conventions get` resolves or caches the scheme.

## 3. WHAT

### 3.1 The advisory

- `builderBytes` returns the `dodSplit` warnings beside the bytes.
- `SpecResult` gains `warnings?: string[]`, present only when non-empty, on `committed` and `already-committed`.
- `SpecCommitRecord` gains `warnings: string[]`, present and possibly empty on every record this version writes.
- Each warning is printed to stderr as `spec commit <ISSUE>: warning: <text>`, in JSON mode and text mode alike. Stdout keeps its current single line.
- Warnings never change the token or the exit code.
- **Chosen:** surface on all three channels (stderr, the JSON result, the record). Rationale: the deleted prose logged the advisory; stderr reaches an interactive operator, the result reaches the skill, and the record survives the turn for `graft.md` and audits.

### 3.2 The scheme

- `SpecResult` gains `commit_subject_scheme` (`conventional` or `bare-imperative`) on `committed` and `already-committed`.
- `SpecCommitRecord` gains `commit_subject_scheme`, the value the commit subject was built from (on `already-committed` with no record yet, the value resolved now).
- The scheme is resolved once per `spec commit` call, through the existing `deps.commitScheme`, and the same value builds the subject and fills both fields.
- **Chosen:** return the scheme from `spec commit` and have Steps 4c and 10 read it from `<run-dir>/<ISSUE>/spec-commit.json`, rather than have each step call `faff conventions get commit_subject`. Rationale: it keeps the original "resolved once, never re-mined" guarantee the prose states, and Step 10 runs turns later, when only the record is to hand.
- **Chosen:** when the record has no `commit_subject_scheme` (a build whose Step 4 ran on an older faff), the step calls `faff conventions get commit_subject` once and uses that. Rationale: a resumed build must not stall on a field an older version never wrote.

### 3.3 Graft prose

- Step 4 (line 161): the sentence says `spec commit` returns the scheme it used as `commit_subject_scheme` and records it in `spec-commit.json`, and that `warnings`, when present, are logged to `graft.md` and never gate.
- Step 4 table: `committed`, `already-committed` → "Log any `warnings` to `graft.md`. Continue to Step 5."
- Step 4c (line 196) and Step 10 (line 551): "the scheme Step 4 already resolved" becomes "the `commit_subject_scheme` in `<run-dir>/<ISSUE>/spec-commit.json` (Step 4); if it is absent, `faff conventions get commit_subject`".
- `docs/guide/cli.md` line 112: the `spec commit` row names `warnings` and `commit_subject_scheme`.

## 4. HOW

### 4.1 Edge cases

- **No holdouts.** `dodSplit` with nothing to withhold returns no warnings; `warnings` is absent from the result and `[]` in the record.
- **`already-committed` with an existing record.** The record is not rewritten (current behaviour) and is authoritative: the result's `commit_subject_scheme` is the record's value when the record has one, and the freshly resolved value only when it does not. So a convention changed between runs never makes the result disagree with the commit in HEAD. `warnings` is computed by this call.
- **A record from an older faff.** It has neither field. A reader treats a missing `warnings` as "not recorded", not as "none"; a missing `commit_subject_scheme` takes the §3.2 fallback.
- **Not valid UTF-8.** `builderBytes` already throws when withholding would alter the bytes; unchanged, and no warnings are emitted on that path.
- **Prose growth.** Graft grows by a few words. Run `faff validate-adapters` and `faff prose-size` on the branch; for `faff-graft` only, set `SKILL_LINE_BASELINE` to the measured line count if it rose, and `prose-baseline.json` to the measured byte count if it rose. Lower either with `faff prose-size baseline --lower` if it fell. Name both numbers in the PR description.

### 4.2 Tests (in `test/` only, `node --test`, no new `--selftest` cases)

Extend `test/spec-commit.test.mjs`:

- an over-withholding spec: `committed` result has one `warnings` entry starting `over-withholding advisory`; the record's `warnings` holds the same; stderr has `spec commit EX-3: warning: over-withholding advisory`; the exit is 0;
- a spec with born-verifiable scenarios left in the builder view: no `warnings` key in the result, `warnings: []` in the record, nothing on stderr;
- `commit_subject_scheme` is `conventional` by default and `bare-imperative` when the repo's conventions resolve to it, and the commit subject matches it in each case;
- `already-committed` returns `commit_subject_scheme` and `warnings` without rewriting an existing record, and returns the record's scheme when the conventions resolve differently on the second run.

A static pin on `faff-graft/SKILL.md`: the phrases "Step 4 already resolved, never re-mined" (line 196 today) and "scheme resolved at Step 4" (line 551 today) are gone, and Steps 4c and 10 each name `commit_subject_scheme`. The pin fails on the unmodified file.

## Scenarios

```
Given a git worktree, a run dir, and a captured spec whose only Scenarios-section criterion is a holdout
When `faff spec commit --issue EX-3 --title "add a thing" --spec <file> --worktree <wt> --run-dir <rd> --json` runs
Then it exits 0 with token "committed"
And its JSON has a "warnings" array whose one entry starts with "over-withholding advisory"
And stderr has a line starting "spec commit EX-3: warning: over-withholding advisory"
And <rd>/EX-3/spec-commit.json has the same "warnings" array
```

```
Given a git worktree with no conventions override, a run dir, and a captured spec with one non-holdout scenario
When `faff spec commit --issue EX-3 --title "add a thing" --spec <file> --worktree <wt> --run-dir <rd> --json` runs
Then its JSON has "commit_subject_scheme" "conventional" and no "warnings" key
And the commit at HEAD has the subject "docs(EX-3): add spec for add a thing"
And <rd>/EX-3/spec-commit.json has "commit_subject_scheme" "conventional" and "warnings" []
```

```
Given the same worktree after that commit
When the same `faff spec commit … --json` runs again
Then it exits 0 with token "already-committed" and "commit_subject_scheme" "conventional"
And <rd>/EX-3/spec-commit.json is byte-identical to before
```

## 5. DESIGN DECISION RATIONALE

- Returning the scheme costs one field and keeps the guarantee the prose already promises; resolving per step would mean editing that promise away.
- The fallback covers only records written before this change; new records always carry the field.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

- **Assumes:** `dodSplit` emits only the one over-withholding warning today; the pass-through is generic, so a future warning surfaces the same way.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Step 4c and the merge-time ADR renumber reuse that scheme` | `spec commit` returns and records `commit_subject_scheme`; Step 4 names it | test/spec-commit.test.mjs | kept |
| `committed, already-committed \| Continue to Step 5.` | `spec commit` returns `warnings`; the Step 4 row logs them to `graft.md` | test/spec-commit.test.mjs | kept |
| `scheme Step 4 already resolved, never re-mined` | Step 4c reads `commit_subject_scheme` from `spec-commit.json`, with the `faff conventions get commit_subject` fallback | test/spec-commit.test.mjs | kept |
| `commit_subject scheme resolved at Step 4` | Step 10 reads `commit_subject_scheme` from `spec-commit.json`, with the `faff conventions get commit_subject` fallback | test/spec-commit.test.mjs | kept |

## 7. DONE

### From WHAT
- [ ] `spec commit` prints each `dodSplit` warning to stderr, returns them as `warnings`, and records them in `spec-commit.json`, with token and exit unchanged.
- [ ] `spec commit` returns and records `commit_subject_scheme`, the value its commit subject was built from.
- [ ] `faff-graft/SKILL.md` Steps 4c and 10 read `commit_subject_scheme` from `spec-commit.json`, with the `faff conventions get commit_subject` fallback, and Step 4 logs `warnings`.
- [ ] `docs/guide/cli.md`'s `spec commit` row names both fields.

### Tests
- [ ] `test/spec-commit.test.mjs` passes under `node --test`, with the cases in §4.2.
- [ ] `npm run build` leaves the committed `spec-commit.js` and `build-manifest.json` matching the `.ts`.

confidence: high
build-tier: standard
admissibility: admissible
spec-review: accept (human, after round 1)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. Two small additions to one command, three prose edits and four tests: well under a day.
- **Workstream fit?** No issues. A follow-up to FAFF-1404 found by the FAFF-1428 audit.
- **Deps surfaced?** None blocking. FAFF-1428 (rule-inventory check) is the guard that would have caught this; it does not need to land first.
- **Risk profile?** Low. Additive fields; no token, exit or gate changes.
