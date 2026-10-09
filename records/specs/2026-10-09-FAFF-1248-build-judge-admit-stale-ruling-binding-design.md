# FAFF-1248: build-judge --admit can read a stale ruling from an earlier assembly as an OVERTURN for a different finding

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1248.

This spec is for the build agent implementing FAFF-1248 and for the humans reviewing it. `faff build-judge-evidence --admit` falls back to `ruling-<case_id>.json` on disk for any ledger entry without an inline ruling, and nothing ties that file to the finding the entry now names. Case ids are positional and `--assemble` never deletes old ruling files, so a ruling from an earlier assembly can be read as the ruling for a different finding. This ticket stamps every ruling file with what it was made on, makes `--admit` reject a file that does not match, and clears old ruling files whenever `--assemble` starts. It is written against `main` at a84dedbe and ships before FAFF-1246.

## 1. WHY

**The idea the rest turns on.** A ruling is only valid for the exact case it was made on. Today the file name (`ruling-f-01.json`) is the only link between a ruling and a ledger entry, and `f-01` means "the first finding in this assembly", which changes from one assembly to the next. The fix gives every ruling file a binding (the finding, the diff, the case content and the run it was made on) and makes `--admit` use a file only when its binding matches the entry reading it.

**Problem.**

- `caseId(i)` (`plugin/skills/faff/bin/lib/build-judge-casefile.js` :45) numbers cases by position: `f-01`, `f-02`, ...
- `dispatchJudgeRulings` (`build-judge-evidence.js` :345-347) writes the bare verdict to `ruling-<cid>.json`. `cmdAssemble` (:420-533) never deletes ruling files, so files from an earlier assembly survive in the judge dir.
- `cmdAssemble` writes an all-`pending` ledger before dispatch (:485) and the final ledger only after the whole loop (:526). A call killed mid-dispatch (graft's 600s Bash cap, FAFF-1246) leaves entries with `ruling: null` on disk.
- `cmdAdmit` (:549-559) reads `ruling-<cid>.json` for every non-parked entry with no inline ruling, with no check of which finding it belongs to.
- So: assembly A rules `f-01` (finding `a.js::x`) OVERTURN; a later assembly B over a different adjudication set puts finding `b.js::y` at `f-01` and is killed before ruling it; `--admit` reads A's OVERTURN as B's ruling. `computeCriticalFreeLatestFloor` (:362-379) keys on the ledger entry's `finding_id` plus that same rulings map, so the floor passes too. That is a fail-open admit.

This change binds rulings to their case and fails closed on any mismatch.

### Design principles

**Fail direction stays park.** A ruling file that cannot be shown to belong to its entry is treated exactly like a missing one: `--admit` exits 2, the outcome graft already parks on.

**The ledger is the record.** An inline `entry.ruling` is written by the same `--assemble` run that wrote the entry, so it stays trusted as today. Only the on-disk fallback needs the binding.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/build-judge-evidence.js`: `dispatchJudgeRulings` (:333-353), `cmdAssemble` (:420-533), `cmdAdmit` (:535-575) | JavaScript (CJS) | The file this ticket changes |
| `plugin/skills/faff/bin/lib/build-judge-casefile.js`: `caseId` (:45), `assembleBuildCaseFiles` (:98-199), `sha256Text` (:201), `admitBuildRollup` (:216-274) | JavaScript (CJS) | Ledger entry shape; unchanged |
| `faff contract build-judge-verdict --describe` | CLI | The verdict's own `finding_id` is model-written; Phase 2's context carries no finding id, so it cannot serve as the binding |
| `test/build-judge-evidence.test.mjs`: the dispatch test (:217-236), `writeLedgerAndRulings` and the `cmdAdmit` tests (:427-475) | JavaScript (`node:test`) | Home of the new tests; two `cmdAdmit` fixtures change |
| `docs/guide/cli.md` (:169) | Markdown | The `build-judge-evidence` row |

**Scope.** `build-judge-evidence.js` (stamp, sweep, admit check), tests and one docs clause. No graft, config or resume change. `build-judge-casefile.js` and `review-call.mjs` are unchanged.

## 2. OUT OF SCOPE

- **Tamper resistance.** The binding is a guardrail against accidental cross-assembly reuse, not a tamper boundary. Every binding input lives in the same same-uid-writable judge dir, so a deliberate forger could recompute a matching binding. No later ticket should cite it as proof that a ruling is authentic.
- **Recomputing `case_sha` from disk.** `case_sha` hashes the compact in-memory case file, not the pretty-printed `case-<cid>.json` bytes. Only `cmdAssemble` computes it; a future consumer that wants to verify against the on-disk file must hash the same compact form.

- **Resuming a partial judge pass, the per-call budget and the graft loop.** Why excluded: FAFF-1246, which builds on this ticket and narrows the sweep below to an identity mismatch. Extension point: `cmdAssemble`'s pre-dispatch block.
- **The retry-limit config key.** Why excluded: FAFF-1245. Extension point: `cmdAssemble` :515-516.
- **Persisting the ledger per case.** Why excluded: FAFF-1246; this ticket makes a kill mid-dispatch fail closed, not resumable.
- **Sweeping stale `case-*.json` files.** Why excluded: `--admit` never reads them, so they carry no admit risk. Extension point: the sweep helper added here.
- **A ledger that is stale relative to the round records** (assemble not re-run after a new round). Why excluded: pre-existing and not a ruling-binding issue; the critical-free-latest floor already vetoes a new standing critical. Extension point: `cmdAdmit`.

## 3. WHAT

### Ledger entry addition

```
RECORD BuildJudgeLedgerEntry (existing fields unchanged) +:
  case_sha: String     # sha256Text(JSON.stringify(caseFiles[cid])); "" for an entry parked at assemble (no case file)
```

- **Chosen:** compute `case_sha` in `cmdAssemble` from the case files `assembleBuildCaseFiles` returns, leaving the pure assembler unchanged. `JSON.stringify` of a case file is deterministic because the assembler builds it in fixed key order. `sha256Text` is already exported from `build-judge-casefile.js`.
- `admitBuildRollup` ignores extra entry fields.

### Binding

```
RECORD Binding:
  finding_id: String
  pre_ruling_diff_sha: String
  case_sha: String
  run_id: String

ruling-<case_id>.json = { ...BuildJudgeVerdict, binding: Binding }     # verdict fields stay top-level

PURE FUNCTION bindingFor(ledger, cid) -> Binding:
  entry = ledger.entries[cid]
  RETURN { finding_id: entry.finding_id, pre_ruling_diff_sha: entry.pre_ruling_diff_sha,
           case_sha: entry.case_sha, run_id: ledger.run_id }

PURE FUNCTION bindingMatches(binding, ledger, cid) -> Boolean:
  entry = ledger.entries[cid]
  binding is a non-null object
  AND binding.finding_id, .pre_ruling_diff_sha and .case_sha are strings equal to entry's same-named fields (also strings)
  AND binding.run_id is a string equal to ledger.run_id
```

- **Chosen:** bind on all four fields, not only `finding_id`. A rebuttal-only round keeps the `finding_id` and the diff but changes the case (`graft.review_rebuttal_round_cap` defaults to 1); the acceptance-criteria and repository-evidence inputs can change too; `run_id` feeds `orderSeed`, which decides the A/B coin swap.
- **Chosen:** a top-level `binding` key spread after the verdict fields, not an envelope. Spreading last means faff's stamp always overwrites any `binding` key the model put in its verdict. Keeping the verdict top-level leaves every reader of `ruling.outcome` working, including the existing dispatch test (:234).
- Export `bindingFor` and `bindingMatches` for the tests.

## 4. HOW

### Stamping at dispatch

```
dispatchJudgeRulings, per dispatched cid (replacing :345-347):
  IF result.ruling:
    write ruling-<cid>.json = JSON of { ...result.ruling, binding: bindingFor(ledger, cid) }
```

`entry.ruling` in the ledger stays the bare verdict, as today.

### Stamping `case_sha` and sweeping at `--assemble`

```
cmdAssemble, after assembleBuildCaseFiles (:471-473) and the outDir mkdir (:475-476):
  1. FOR cid IN ledger.order: entry.case_sha = caseFiles[cid] ? sha256Text(JSON.stringify(caseFiles[cid])) : ""
  2. sweepStaleRulings(outDir)
  3. write case files and the ledger as today (:478-485)

PROCEDURE sweepStaleRulings(outDir):
  FOR name IN readdir(outDir) matching /^ruling-.+\.json$/ OR name == "admit-result.json":
    unlink; ignore ENOENT; on any other error write one stderr warning line and continue
```

- **Chosen:** sweep unconditionally. Today every `--assemble` builds a fresh ledger and re-dispatches every case, so no earlier ruling or admit result can be valid for it. `admit-result.json` goes too, so a stale admit outcome never sits beside a fresh ledger.
- **Chosen:** the sweep is best-effort. The binding check at `--admit` is what guarantees safety; the sweep only keeps the judge dir honest to read. A failed unlink must not stop the judge.
- The sweep runs only once `--assemble` has passed argv, round-record and input-file validation and created `outDir`. The early exits (usage, unreadable `--dir`, malformed round record) leave the judge dir untouched, as today.

**Anti-pattern:** relying on the sweep alone. Why: FAFF-1246 makes the sweep conditional (a resumed pass keeps its rulings), and a sweep can fail; the binding is the guard that holds in every case.

### Binding at `--admit`

```
cmdAdmit, per cid in ledger.order (replacing :549-559):
  entry parked          -> rulings[cid] = null                                    (as today)
  entry.ruling non-null -> rulings[cid] = entry.ruling                            (as today)
  ELSE read ruling-<cid>.json:
     unreadable / malformed -> stderr + exit 2                                    (as today)
     NOT bindingMatches(file.binding, ledger, cid)
        -> stderr "faff build-judge-evidence --admit: ruling-<cid>.json is not bound to this ledger entry
                   (finding_id/pre_ruling_diff_sha/case_sha/run_id); treated as missing" ; exit 2
     ELSE rulings[cid] = the file's object without its binding key
```

- **Chosen:** a mismatched or missing binding is a missing ruling: exit 2, no `admit-result.json` written. That is today's missing-ruling outcome, and graft's judge paragraph (`faff-graft/SKILL.md` :504) already makes park the default on any unresolved state. No new exit code.
- The `binding` key is stripped before `admitBuildRollup` and `computeCriticalFreeLatestFloor` see the ruling, so both stay unchanged.

### Docs

`docs/guide/cli.md` :169: add one clause: every `ruling-<case_id>.json` carries a `binding` (`finding_id`, `pre_ruling_diff_sha`, `case_sha`, `run_id`); `--assemble` clears earlier `ruling-*.json` and `admit-result.json` before writing its ledger; `--admit` treats a ruling file whose binding does not match its ledger entry as missing (exit 2). Update the file header comment (:6-21) to match.

### Edge cases

- **Ruling files written before this ticket** have no `binding`, so `--admit` treats them as missing. Only a judge dir left mid-pass across the upgrade is affected, and it fails closed.
- **Entry parked at assemble** (`case_sha: ""`, `pre_ruling_diff_sha: ""`). `--admit` never reads a ruling for it.
- **An inline ruling and a mismatched file for the same entry.** The inline ruling wins; the file is never read.

### Merge point with FAFF-1245

FAFF-1245 edits `cmdAssemble`'s retry-limit parse and the `dispatchDeps` block (:515-523). This ticket edits :471-485 (stamp and sweep), `dispatchJudgeRulings` and `cmdAdmit`, and does not touch :515-523, so the two are independent; whichever lands second may see a textual conflict near :515 only if the surrounding context shifted. Resolve by keeping both changes.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a judge dir whose ledger.json lists f-01 for finding "b.js::y", resolution "pending", ruling null
And a ruling-f-01.json left by an earlier assembly with outcome OVERTURN and a binding naming finding "a.js::x"
When --admit runs
Then it exits 2, writes no admit-result.json, and stderr says ruling-f-01.json is not bound to this ledger entry
```

```
Given --assemble has ruled f-01 OVERTURN for finding "a.js::x"
And the round records are replaced so f-01 is now finding "b.js::y"
When --assemble runs again with a fake runReviewCall that throws on its first call
Then that call sees no ruling-*.json and no admit-result.json in the judge dir, and a following --admit exits 2
```

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Where `case_sha` is computed | In `assembleBuildCaseFiles`; in `cmdAssemble` | **Chosen:** `cmdAssemble` |
| Binding fields | `finding_id` only; + diff sha; + case sha and run id | **Chosen:** all four |
| Binding shape | Envelope `{binding, ruling}`; top-level key spread after the verdict | **Chosen:** top-level key, spread last |
| Mismatch at `--admit` | New exit code; treat as missing (exit 2) | **Chosen:** treat as missing |
| Sweep | None (binding only); conditional; unconditional | **Chosen:** unconditional |
| Sweep failure | Fail loud; best-effort warning | **Chosen:** best-effort |
| Inline ledger ruling | Also require a binding; trust as today | **Chosen:** trust as today |

**`case_sha` in `cmdAssemble`.** The assembler stays a pure function with its own tests untouched, and FAFF-1246 needs the same hash at the same point for its resume identity.

**All four fields.** See WHAT. `finding_id` alone misses a rebuttal-only round; the diff sha alone misses changed acceptance criteria; `run_id` changes the A/B presentation.

**Top-level key.** An envelope would change every reader for no safety gain; `--admit` strips the key before the roll-up.

**Treat as missing.** It reuses the fail-closed path graft already parks on, so no caller changes.

**Unconditional sweep.** Today's `--assemble` always starts fresh, so every earlier ruling is stale by definition. Doing it now closes the hazard twice (no stale file, and no match if one survives).

**Best-effort sweep.** Safety comes from the binding; stopping the judge on a failed unlink would turn a tidy-up into a park.

**Trust the inline ruling.** It is written by the same run that wrote the entry it sits in, so it cannot belong to another assembly.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** nothing outside `build-judge-evidence.js` reads build-side `ruling-*.json` files. Validation: `grep -rn "ruling-" plugin/skills/faff/bin/lib` shows only `build-judge-evidence.js` plus `spec-judge-evidence.js` and `judge-trail.js`, and the latter two read spec-review judge dirs only (`judge-trail.js` collects `<issue>/spec-review/judge/`).

## 8. DONE

### From WHY
- [ ] The stale-OVERTURN reproduction (first scenario) exits 2 and does not admit
- [ ] `build-judge-casefile.js`, `review-call.mjs`, every `SKILL.md` and `config.js` are unchanged in the diff

### From WHAT
- [ ] Every ledger entry written by `--assemble` carries `case_sha`: the sha256 of its case file's JSON, or `""` for an entry parked at assemble
- [ ] Every `ruling-<cid>.json` written by `--assemble` carries a top-level `binding` with `finding_id`, `pre_ruling_diff_sha` and `case_sha` equal to its ledger entry's and `run_id` equal to the ledger's; `outcome`, `rationale`, `product_gap_citation` and `finding_id` stay top-level (the dispatch test at :217-236 additionally asserts the binding)
- [ ] A fake verdict that itself carries `binding: { finding_id: "evil" }` is written with faff's binding, not the model's
- [ ] `build-judge-evidence.js` exports `bindingFor` and `bindingMatches`; unit tests cover a full match, each of the four fields mismatching, a missing binding, a non-object binding, and a non-string entry field

### From HOW (sweep)
- [ ] A second `--assemble` over a changed adjudication set removes every earlier `ruling-*.json` and `admit-result.json` before its first `runReviewCall` call (second scenario)
- [ ] A sweep that cannot unlink a file writes one stderr warning and `--assemble` carries on
- [ ] An `--assemble` that exits early (usage error, malformed round record) leaves existing ruling files in place

### From HOW (`--admit`)
- [ ] A ruling file with no `binding` makes `--admit` exit 2 with the "not bound" stderr line
- [ ] A ruling file whose binding matches is used, and `admitBuildRollup` receives it without the `binding` key
- [ ] An entry with an inline `ruling` is used as today even when its ruling file is missing or mismatched
- [ ] The two `cmdAdmit` fixtures that read rulings from disk (:437-450, :463-475) carry `pre_ruling_diff_sha` and `case_sha` on the entry, `run_id` on the ledger and a matching `binding` on the ruling, and still exit 0 and 1 respectively
- [ ] Every other existing test in `test/build-judge-evidence.test.mjs` and `test/impure/build-judge-deadline.test.mjs` passes unchanged

### From HOW (docs)
- [ ] `docs/guide/cli.md` :169 carries the binding, sweep and treated-as-missing clause; the file header comment matches
- [ ] `npm test` and `faff validate-adapters` pass

### Integration smoke test

```
1. round-1: one standing critical "a.js::x"; --assemble with OVERTURN fakes -> ruling-f-01.json bound to a.js::x
2. --admit -> exit 0, admit true
3. replace round records: one standing critical "b.js::y"; --assemble with a fake that throws on its first call -> exit 2
4. judge dir: no ruling-*.json, no admit-result.json; ledger f-01 is "b.js::y", pending, ruling null
5. --admit -> exit 2 ("missing" ruling); no admit
6. copy step 1's ruling file back in as ruling-f-01.json; --admit -> exit 2 ("not bound"); no admit
```

## Methodology critique

*(agile-delivery lens)*

- **Right-sized?** No issues.
  - It is one 1 to 3 day unit with one outcome: `--admit` never treats a ruling from another assembly as valid. The code change stays inside `build-judge-evidence.js`, with tests and one docs clause.
  - The stamp, the sweep and the admit check are one safety fix. None of them ships value alone, so there is nothing to split.
  - It was already split out of FAFF-1246, so it is not a merge candidate.
  - One small observation. FAFF-1246 will rework the unconditional sweep added here into an identity-mismatch sweep, so those few lines get touched twice. That is acceptable. The sweep is cheap, it covers the judge dir in the gap if FAFF-1246 slips, and the spec says outright that safety comes from the binding, not the sweep.

- **Workstream fit?** No issues for this ticket. Having no project is the correct default landing for a bug fix.
  - One cluster is worth noting. FAFF-1244 (merged), FAFF-1245, FAFF-1246, FAFF-1248 and FAFF-1249 have no project and all serve one outcome: "graft's build judge finishes or parks safely within one foreground call".
  - **Why it matters:** with no container, there is no single "done" for that outcome, and the chain is visible only through blocker links.
  - **What to do:** consider the cluster in the next rehoming pass (`/faff-plot rehome`). Nothing needs to change for this ticket.

- **Deps surfaced?** One minor gap.
  - **What's there:** the spec's "Merge point with FAFF-1245" says both tickets edit `cmdAssemble` in the same file. It also says the two are independent and that a conflict near :515 would be textual only, resolved by keeping both changes. Linear has no relation between FAFF-1245 and FAFF-1248. The blocks link to FAFF-1246 is declared, and FAFF-1244, which the spec builds on (`main` at a84dedbe), is merged.
  - **Why it matters:** a parallel build pass that reads only the blocker graph cannot see that these two touch the same function. It may run them at the same time and hit an avoidable rebase.
  - **What to do:** add a "related" link between FAFF-1245 and FAFF-1248. A blocker link would be wrong because neither needs the other's output.
  - The spec's only assumption holds: `judge-trail.js` collects only `<issue>/spec-review/judge/` (`listIssueScratchDirs`), so no other code reads build-side `ruling-*.json`.

- **Risk profile?** No issues.
  - Nothing here is novel or external. Every new mismatch path fails closed into today's exit-2 park.
  - The one failure mode is a false park, not a false admit. The stamp, the ledger and the inline ruling all come from the same `--assemble` run, so a false park would need a mismatch inside one run. The DONE list's fixture and unit cases cover that.
  - FAFF-1248 is High priority and has no blockers, while FAFF-1246 depends on both its binding and its `case_sha`. Shipping it first, ahead of FAFF-1245, matches value-by-risk ordering. No de-risking spike is needed.

**Applied at prep:** FAFF-1245 and FAFF-1248 are now linked as related, so a build pass can see they touch the same function.

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
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
