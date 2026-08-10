# Relocation slice 3 — extend the integrity-digest evidence roster to the merge-tail records

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-751.

This spec is for the build agent implementing FAFF-751, the third and final slice of the ADR-0077 relocation (FAFF-748 epic). It is deliberately small and additive. Human reviewers should read it as the closing bookkeeping step that makes the tamper-evidence roster complete and single-sourced, now that slices 1–2 have relocated the writes it depends on.

## 1. WHY — Problem and Principles

**The load-bearing idea.** faff has exactly one resolver that enumerates the run's tamper-evidence roster — `correctiveIntegrityDirs()` in `corrective-integrity.js`. Every consumer that needs "the set of evidence members" (the integrity-digest snapshot/verify bracket, the merge-floor forge-surface probe, the integrity-boundary declaration emitter) derives its member list from that one function, never a second hand-written list. So growing the roster is a change at that single resolver, and it flows to every consumer automatically. This slice adds the last two members ADR-0077 deferred.

**Problem statement.** ADR-0077 defines the evidence roster as `correctiveIntegrityDirs()` *plus* the two merge-tail records `merge-record.json` and `post-merge-verification.json`, which were held out of the resolver because they were written mid-lane, below the dispatch cut, where bracketing them would false-flag or demand bookkeeping the relocation deletes anyway (Decision 7). Slices 1–2 (FAFF-749/FAFF-750) moved the per-issue evidence writer of record and the merge locus above the cut, so those two records are now trusted-side writes. Until they are added to the resolver, the roster stays split across code and a prose caveat in the ADR — the single-source invariant is not yet true.

**Design principles.**

- **One resolver, no second list.** The whole point of `correctiveIntegrityDirs()` is that the evidence roster has exactly one home. The change must extend that function, never introduce a parallel member list in a consumer. This is the standing invariant the module header and ADR-0077 both assert.
- **Additive and byte-identical for untouched shapes.** Mirror the FAFF-466 `--events` precedent: existing call shapes that should not change must return byte-identical results. The base (no-issue) 2-member shape must stay exactly 2; only the per-issue shape grows.
- **Byte-exact, not prefix-preserving.** The two new records are ordinary JSON files written once by the trusted side — they are byte-exact members. Only `events.jsonl` keeps the prefix-preserving carve-out (Decision 5), because the orchestrator legitimately appends to it while lanes are in flight. Do not give the new members any special-casing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | JavaScript (Node) | Home of `correctiveIntegrityDirs()` — the single resolver this slice edits, plus its `--selftest`. |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JavaScript (Node) | `memberRels`/`buildManifest`/`snapshotMember` — the digest bracket that snapshots each member; consumes the resolver unchanged. |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (Node) | `resolveIntegrity(runDir, issue)` — the merge-floor forge-surface probe that requires the boundary declaration to cover the per-issue member set. |
| `test/corrective-integrity.test.mjs` | JavaScript (Node test) | Asserts the resolver's per-issue and events member counts — must be updated. |
| `docs/adr/0077-...trusted.md` | Markdown | Decisions 5/6/7 + the Evidence-class roster definition — the prose caveat this slice resolves. |

**Scope statement.** This closes the ADR-0077 relocation (FAFF-748) by completing the evidence roster; it is the terminal slice, so no downstream relocation work depends on it.

## 2. OUT OF SCOPE

- **The relocations themselves (slices 1–2).** — Excluded. — Why: prerequisites, already shipped (FAFF-749 `086eeba` / PR #568, FAFF-750 `b20b8ab` / PR #588). This slice only becomes correct *because* they landed. — Extension point: n/a (done).
- **The three existing per-issue members (`ac-checklist.json` / `review-verdict.json` / `holdout.json`).** — Excluded from the *code delta*. — Why: they are already returned by `correctiveIntegrityDirs(runDir, issue)` (lines 165–167, added under FAFF-325). ADR-0077 Decision 6's "per-issue members join the bracket when their writes relocate" is satisfied for them by the relocation landing, not by any new resolver line. This slice must not re-add or re-wire them. — Extension point: they are already in the `if (issue)` block; the two new members join them there.
- **Obligation 5's run-grain custody chain, obligation 6's returned-evidence check, and `faff-graft`.** — Excluded. — Why: obligation 5 is fixed run-grain (`--issue`-omitted, always) and never brackets per-issue members; obligation 6 already digest-verifies returned AC/review bytes by leaf sha256. Neither enumerates the resolver, so neither needs editing. — Extension point: gateway `concurrency` obligations 5–7 if the custody grain is ever revisited (not this slice).
- **A new opt-in parameter for the merge-tail members.** — Excluded. — Why: the `events` param exists only because `events.jsonl` is run-grain and detection-consumer-specific; the merge-tail records are ordinary per-issue evidence and belong unconditionally alongside the other three. — Extension point: `opts` on `correctiveIntegrityDirs` if a future member ever needs consumer-scoped opt-in.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Evidence roster | The set of run-artifact paths a downstream trust gate (merge-floor, corrective, detection, digest bracket) treats as tamper-evident input. Single-sourced from `correctiveIntegrityDirs()`. |
| Per-issue member | An evidence path under `<run-dir>/<issue>/…`, returned only when `correctiveIntegrityDirs` is called with an `issue`. |
| Merge-tail records | `merge-record.json` and `post-merge-verification.json`, written by the dispatcher after the lane returns (post-slice-2). Per-issue members. |
| Byte-exact member | A member whose digest is the whole-file sha256 (the default `snapshotMember` branch) — any content change is tampering. Contrast the `events.jsonl` prefix-preserving rule. |

**The resolver — current and target shape.** `correctiveIntegrityDirs(runDir, issue, opts)` returns an ordered array of absolute paths.

```
FUNCTION correctiveIntegrityDirs(runDir, issue, opts):
  dirs = [ runDir/corrective, runDir/run-ledger.json ]            # base, always
  IF issue:
    dirs += [ runDir/issue/ac-checklist.json,                     # existing (FAFF-325)
              runDir/issue/review-verdict.json,                   # existing
              runDir/issue/holdout.json,                          # existing
              runDir/issue/merge-record.json,                     # NEW (this slice)
              runDir/issue/post-merge-verification.json ]         # NEW (this slice)
  IF opts.events == true:
    dirs += [ runDir/events.jsonl ]                               # run-grain, prefix-preserving
  RETURN dirs

  # Member-count contract after this slice:
  #   correctiveIntegrityDirs(runDir)                         -> 2   (UNCHANGED — byte-identical)
  #   correctiveIntegrityDirs(runDir, issue)                  -> 7   (was 5)
  #   correctiveIntegrityDirs(runDir, null, {events:true})    -> 3   (UNCHANGED)
  #   correctiveIntegrityDirs(runDir, issue, {events:true})   -> 8   (was 6)
```

**Design decision — placement.** The two members join the existing `if (issue)` block, unconditionally, immediately after `holdout.json`.
**Chosen:** Append `merge-record.json` and `post-merge-verification.json` inside the existing `if (issue)` block, not behind a new `opts` flag — rationale: they are per-issue evidence-class members exactly like the three already there; the `events` opt-in exists solely for a run-grain, detection-only member, which does not describe these.

**Consumer impact (no consumer code changes required).** Because every consumer derives its member set from the resolver, the two new members flow automatically:

- `integrity-digest.js` `buildManifest(runDir, issue, …)` — a **per-issue** manifest (`grain: "per-issue"`) now snapshots 7 (or 8 with events) members. `snapshotMember` already records an absent member as `{present:false}` and `diffAgainstManifest` already flags appear/disappear, so a member not yet written at snapshot time is handled correctly with no new code.
- `merge-gate.js` `resolveIntegrity(runDir, issue)` — the merge-floor forge-surface probe now requires the boundary declaration to cover the two new per-issue paths. This does not regress: the launch-grain boundary declaration covers the `<root>/.faff/runs` ancestor (so any path under a run dir is covered by construction), and the run-dir-grain declaration is itself emitted from `correctiveIntegrityDirs`, so it grows in lockstep. Coverage is by declared *directory*, not file existence, so a merge-record.json not yet written when the probe runs is still covered.
- `integrityBoundaryDeclaration` (run-dir grain) — emits the two new paths; its round-trip selftest compares against `correctiveIntegrityDirs` directly, so it stays self-consistent with no hardcoded count.
- `corrective.js` — uses `correctiveIntegrityDirs(runDir)[0]` (base, no issue) and the 2-entry base set; **unaffected**.

**Chosen:** Make no edits to any consumer (`integrity-digest.js`, `merge-gate.js`, `corrective.js`) — rationale: they single-source the resolver by design; the member set flows through automatically, which is the entire value of the one-resolver invariant.

## 4. HOW — Behavior

**Approach.** One edit to the resolver body, then propagate the new member-count facts into the three places that assert those counts as literals (the module `--selftest`, the doc comment above the function, and `test/corrective-integrity.test.mjs`), and resolve the now-delivered ADR caveat.

```
PROCEDURE implement_slice_3:
  1. Edit correctiveIntegrityDirs (corrective-integrity.js): inside `if (issue)`, after the
     holdout.json push, add path.join(runDir, issue, "merge-record.json") and
     path.join(runDir, issue, "post-merge-verification.json").
  2. Update the doc comment above the function (currently describes "the three merge-floor
     artifacts" / a 5-entry per-issue shape) to name all five per-issue members and the 7/8 counts.
  3. Update correctiveIntegritySelftest():
       - the `withIssue.length === 5` assertion -> 7, and add includes-checks for the two new members;
       - the additive-events assertions: `correctiveIntegrityDirs(runDir,"FAFF-1").length === 5` -> 7,
         and `withIssueAndEvents.length === 6` -> 8.
     Leave every base/no-issue and dir-coverage assertion unchanged (the wellFormedDecl declares the
     `<runDir>/FAFF-1` directory, which covers the new files, so the asserted/dir-mismatch cases still hold).
  4. Update test/corrective-integrity.test.mjs: the per-issue "5 entries" shape assertion -> 7 with the
     two new members named; the events "6-entry" assertion -> 8. Leave the run-grain (2-entry) and the
     FAFF-466 detection dir-mismatch cases unchanged.
  5. Check test/integrity-digest.test.mjs: its snap/verify helpers already use `--issue FAFF-9 --events`
     and assert round-trip/tamper BEHAVIOUR, not an enumerated member set — the two new members snapshot
     as {present:false} on both sides, so the round-trip stays clean and the file needs NO edit. Update
     only if a specific member-count/member-set assertion is later found (none exists today).
  6. Update ADR-0077: mark Decision 7 delivered and rewrite the Evidence-class roster sentence so the
     roster is single-sourced from correctiveIntegrityDirs() (drop the "plus the two merge-tail records" caveat).
  7. Run the module selftests and the test suite; all green.
```

**Anti-pattern:** Adding the two members behind a new `opts` flag or a second member list in `integrity-digest.js`/`merge-gate.js`. Why: it breaks the single-resolver invariant ADR-0077 and the module header both mandate, and defeats the "flows to every consumer automatically" property this slice relies on.

**Anti-pattern:** Making the two new members prefix-preserving like `events.jsonl`. Why: they are written-once trusted-side JSON; byte-exact is correct, and the prefix rule only exists to tolerate the orchestrator's live appends to `events.jsonl` (Decision 5).

**Edge cases.**

- **Member absent at snapshot.** `merge-record.json`/`post-merge-verification.json` do not exist until the dispatcher's merge tail runs. In a per-issue snapshot taken earlier, `snapshotMember` records `{present:false}`; a later verify against that manifest would legitimately flag `(appeared)` if it then appears mid-bracket. This is existing, correct behaviour — no new handling. (Obligation 5's shipped chain is run-grain and never snapshots these, so the shipped flow is unaffected regardless.)
- **Base/no-issue callers.** Must stay byte-identical (2 entries) — the new members live strictly inside `if (issue)`.
- **Boundary coverage before write.** The forge-surface probe covers by declared directory, not file existence, so a not-yet-written merge-record.json under a covered run dir never produces a `dir-mismatch`.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir and an issue id
When correctiveIntegrityDirs(runDir, issue) is called
Then the returned array has 7 entries and includes <runDir>/<issue>/merge-record.json
     and <runDir>/<issue>/post-merge-verification.json
```

```
Given a run dir with no issue argument
When correctiveIntegrityDirs(runDir) is called
Then the result is byte-identical to before this change (exactly [corrective/, run-ledger.json])
```

- The two new members are byte-exact: their `snapshotMember` record is a whole-file `sha256`, never an `events`-shaped `{length, prefix_sha256}`.
- `events.jsonl` retains its prefix-preserving rule unchanged (a legitimate append still verifies clean).

## 6. Design Decision Rationale

**Where do the two members go — a new opt-in param, or the existing `if (issue)` block?**
Options: (a) unconditional in `if (issue)` alongside the other three per-issue members; (b) behind a new `opts.mergeTail` flag mirroring `opts.events`.
**Chosen:** (a) — the merge-tail records are per-issue, trusted-side, same evidence class as ac-checklist/review-verdict/holdout, and every per-issue consumer wants them. The `events` flag is not a general "new member" pattern; it is a carve-out for a run-grain, detection-only member. A new flag would add surface for no consumer that needs the opt-out.

**Do the three existing per-issue members need any code change ("join the byte-exact bracket")?**
Options: (a) no code change — they are already in the resolver, and the relocation landing is what makes their byte-exact membership sound; (b) additional wiring (e.g. flip obligation 5 to per-issue, add holdout to obligation 6).
**Chosen:** (a) — verified: lines 165–167 already return all three; ADR-0077 frames slice 3 as "a one-line additive change at the single resolver," which is only consistent with the two merge-tail members being the delta. Obligation 5 is fixed run-grain and explicitly `--issue`-omitted, so flipping it is out of scope and out of character for "additive."

**Byte-exact vs prefix-preserving for the new members?**
**Chosen:** byte-exact (the default `snapshotMember` branch) — they are written once by the trusted side; only `events.jsonl` needs the append-tolerant prefix rule (Decision 5). No special-casing.

**Update ADR-0077, or leave the caveat?**
**Chosen:** update it — mark Decision 7 delivered and collapse the Evidence-class roster to just `correctiveIntegrityDirs()`. Leaving "roster is the resolver *plus* the two merge-tail records" stale would contradict the single-source invariant this slice establishes. Mirrors the FAFF-466 pattern, which also settled its ADR framing on landing.

## 7. Open Questions and Assumptions

**Open Questions:** none. Every decision above is closed.

**Assumptions.**

- **Assumes:** slices 1–2 (FAFF-749 evidence-writer relocation, FAFF-750 merge-locus relocation) have landed, so `merge-record.json`/`post-merge-verification.json` are written on the trusted side. Validate: `git log --oneline` shows FAFF-750 (`b20b8ab` / PR #588) and FAFF-749 (`086eeba` / PR #568); the FAFF-751 blocker FAFF-750 is Done. If either were reverted, this slice's premise (trusted-side writes) would not hold — stop and re-check.
- **Assumes:** the three per-issue members `ac-checklist.json` / `review-verdict.json` / `holdout.json` are still present in the `if (issue)` block of `correctiveIntegrityDirs`. Validate: read `corrective-integrity.js:163-169` before editing; if they are absent, the resolver was refactored and this spec's OUT-OF-SCOPE reasoning must be re-derived.

## 8. DONE — Definition of Done

### From WHAT (resolver)
- [ ] `correctiveIntegrityDirs(runDir, issue)` returns 7 entries, including `<runDir>/<issue>/merge-record.json` and `<runDir>/<issue>/post-merge-verification.json`, appended inside the existing `if (issue)` block after `holdout.json`.
- [ ] `correctiveIntegrityDirs(runDir)` (no issue) still returns exactly the 2 base entries — byte-identical to before.
- [ ] `correctiveIntegrityDirs(runDir, issue, {events:true})` returns 8 entries; `correctiveIntegrityDirs(runDir, null, {events:true})` still returns 3.
- [ ] No consumer (`integrity-digest.js`, `merge-gate.js`, `corrective.js`) gained a hand-written member list — the roster is still single-sourced from the resolver.

### From WHAT (member semantics)
- [ ] The two new members are byte-exact: a per-issue `snapshotMember` record for each is a whole-file `sha256`, not an `events`-shaped `{length, prefix_sha256}`.
- [ ] `events.jsonl` retains its prefix-preserving rule (a legitimate append verifies clean; a truncation/prefix-rewrite is flagged).

### From HOW (tests & docs)
- [ ] `correctiveIntegritySelftest()` passes with the updated 7/8 counts and includes-checks for the two new members; base/no-issue and dir-coverage assertions unchanged. (`faff corrective-integrity --selftest` exits 0.)
- [ ] `test/corrective-integrity.test.mjs` per-issue shape assertion updated to 7 (and events to 8) with the two members named; run-grain and detection dir-mismatch cases unchanged.
- [ ] `test/integrity-digest.test.mjs` stays green unchanged (its `--issue FAFF-9` round-trip/tamper cases assert behaviour, not an exact member set; the new members snapshot `{present:false}` on both sides). (`faff integrity-digest --selftest` exits 0.)
- [ ] The doc comment above `correctiveIntegrityDirs` names all five per-issue members and the 7/8 counts.
- [ ] ADR-0077 Decision 7 is marked delivered and the Evidence-class roster sentence is single-sourced to `correctiveIntegrityDirs()` (the "plus the two merge-tail records" caveat removed).
- [ ] Full test suite green.

**Integration smoke test:**
```
node -e 'const {correctiveIntegrityDirs}=require("./plugin/skills/faff/bin/lib/corrective-integrity.js");
  const d=correctiveIntegrityDirs("/tmp/run","FAFF-1");
  assert(d.length===7 && d.some(p=>p.endsWith("FAFF-1/merge-record.json")) && d.some(p=>p.endsWith("FAFF-1/post-merge-verification.json")));'
# plus: faff corrective-integrity --selftest && faff integrity-digest --selftest && faff integrity-boundary --selftest
```

## Already shipped against this surface

Done siblings in the project *Graft evidence is tamper-evident end-to-end* (epic FAFF-748) touching this surface, none of which supersede this slice's premise:

- **FAFF-518** — shipped the `faff integrity-digest` snapshot/verify tool and the prefix-preserving rule this slice relies on. Related, not superseding.
- **FAFF-520** — established the run-grain integrity-digest bracket. Explicitly left per-issue + merge-tail membership to a later slice (ADR-0077 Decision 6). Not superseding.
- **FAFF-466** — added `events.jsonl` to the resolver behind `--events`; the pattern this slice mirrors. Not superseding.
- **FAFF-749 / FAFF-750** — slices 1–2, the prerequisites; relocated the writes so the two merge-tail records are now trusted-side. Enabling, not superseding.

**Premise-superseded gate: premise HOLDS → proceed.** Direct code check confirms `merge-record.json` and `post-merge-verification.json` are absent from `correctiveIntegrityDirs()` (`corrective-integrity.js:158-174`); no Done ticket has added them. The delta is real and un-delivered.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes. A single cohesive concern (complete the evidence roster) landing as a ~two-line resolver change plus its test/selftest/doc updates — well inside a 1-day unit. No independent second concern to split out; it is the terminal slice of FAFF-748, so there is no always-ships-together sibling to merge (slices 1–2 already shipped).
- **Workstream fit?** Yes. Outcome-named project (*Graft evidence is tamper-evident end-to-end*) under epic FAFF-748; the slice is exactly the closing bookkeeping the epic's arc calls for.
- **Deps surfaced?** Yes. The one hard dependency (FAFF-750, and transitively FAFF-749) is an explicit blocker link and is Done — no implicit or unlinked dependency remains.
- **Risk profile?** Low. Additive change to a pure resolver with a directly-shipped precedent (FAFF-466); no novel integration, external dependency, or unvalidated assumption. No de-risking spike warranted.

No issues.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```