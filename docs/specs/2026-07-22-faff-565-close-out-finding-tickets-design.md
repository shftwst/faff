# Spec: Close out the three finding tickets whose fixes have already merged (FAFF-565)

> Spec: faffter-dark-nlspec · 2026-07-22 · interactive · confidence: high. Full spec on Linear FAFF-565.

This spec directs the disposition of the three still-open finding tickets from the 2026-07-18 p2-task-api run (FAFF-550, FAFF-551, FAFF-552), and settles the disposition convention that FAFF-569 (the durable catch-mechanism ticket) will adopt. Audience: the build agent executing the tracker writes, and human reviewers checking the convention choice. This is a process/tracker-ops ticket — the deliverable is tracker state plus one recorded convention, not code.

## 1. WHY — Problem and Principles

**Load-bearing model:** a finding ticket left open after its fix merges elsewhere is a false signal that every faff read (wtf, map, next, tidy) repeats until someone closes the loop. Closing the loop means two things at once: end the ticket's "open urgent work" status, and leave a visible pointer from the finding to the shipped fix so future readers don't re-derive it.

**Problem:** three finding tickets from the 2026-07-18 run stayed open while their fixes shipped under different ticket numbers. The 2026-07-20 L4-capabilities audit was actively misled ("two urgent gate-integrity bugs unfixed" while the fixes were on main). Stale urgent tickets poison every read until dispositioned.

**Scope has narrowed since the ticket was filed.** Live tracker state (fetched 2026-07-22):

| Ticket | Live state | Remaining work |
|---|---|---|
| FAFF-552 | Done (2026-07-20), PR #440 attached, Done children FAFF-558 (PR #431) and FAFF-560 (PR #432) | At most a close-out comment (decision below) |
| FAFF-551 | Done (2026-07-20), carries an explicit "Superseded — shipped as..." comment with a deliverable-to-PR table (#433/#434/#435) | None likely (decision below) |
| FAFF-550 | **Still open** — Backlog, High, zero comments, no PR attachments | The real delta: verify, link, close |

**Design principles:**

- **Status monotonicity.** Never move a Done issue backward. FAFF-551 and FAFF-552 stay Done regardless of what this spec adds.
- **Visibility over tidiness.** Linear's Duplicate state is cancelled-category, which faff's gateway rule ("ignore cancelled and archived") makes invisible to every faff read. A finding that was real and got fixed is completed work — it should stay readable, not vanish.
- **Skimmable comments.** Every human-facing comment this spec mandates uses lists/tables, not run-on prose.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` (~486–700) | FAFF-545's worktree-aware land mechanism — the fix FAFF-550's verification rests on |
| `test/merge-gate-local.test.mjs` | Asserts the exact FAFF-550 symptom is gone (line 255: peer worktree clean post-merge) |
| Commit `7330d00` / PR #430 | The FAFF-545 fix merge |
| FAFF-569 (Backlog) | Will adopt the convention this spec records |

## 2. OUT OF SCOPE

- **The durable catch mechanism** — detecting future finding tickets left open after fixes merge elsewhere. Why: FAFF-569 owns it, including its open questions (read-side vs write-side, match keys). Extension point: FAFF-569, which receives this spec's convention comment as input.
- **Reopening or restating FAFF-551 / FAFF-552 history** — both are Done with adequate trails. Why: monotonicity; the work already happened. Extension point: none needed.
- **New repro tooling for the staged-deletions symptom** — no scripted repro fixture is built here. Why: the existing test suite already asserts the exact symptom (see verification decision). Extension point: `test/merge-gate-local.test.mjs` if stronger evidence is ever wanted.
- **Any code or docs change in the repo** — the convention is recorded in the tracker (decision below), so the build phase produces tracker writes only, no PR-worthy diff beyond what graft's process requires.

## 3. WHAT — Vocabulary and the convention

**Vocabulary:**

| Term | Definition |
|---|---|
| Finding ticket | An issue filed to report a defect observed during a run, before any fix exists |
| Resolver | The ticket(s)/PR(s) under which the fix actually shipped |
| Disposition | The terminal tracker state plus the comment trail that links finding to resolver |

**The disposition convention (the open question the ticket asks this spec to settle).** Two candidate shapes: mark the finding Duplicate-of the resolver, or close it Done with a comment trail. Constraints that decide it:

- Duplicate is cancelled-category in Linear, so a Duplicate finding disappears from every faff surface — completed real work becomes invisible.
- Linear's duplicate-of relation points at exactly one issue; FAFF-551 and FAFF-552's resolvers were multiple tickets/PRs, so duplicate-of cannot even express that shape.
- De facto precedent exists: FAFF-551 and FAFF-552 were already closed Done with comment trails, and FAFF-551's "Superseded" comment (deliverable → shipped-by → merge-SHA table) is a working template.

**Chosen:** close finding tickets **Done with a comment trail, never Duplicate**, as a two-case rule:

1. **Fix shipped under the finding's own decomposition** (splits/children, as with FAFF-551, FAFF-552): close Done; the comment trail lists each deliverable → resolver ticket → PR/merge-SHA (FAFF-551's Superseded comment is the template).
2. **Fix shipped under an unrelated ticket** (independent report of the same defect, as with FAFF-550 vs FAFF-545): close Done; the comment trail names the resolver ticket + PR + merge SHA, states the relationship ("independent report of the same defect, fix shipped under X"), and cites the verification evidence that the symptom is gone.

In both cases the finding stays visible as completed work and the pointer is one comment, not an archaeology exercise.

**Where the convention is recorded.** Candidates: a comment on FAFF-569, a docs/ note, or an ADR (`docs/adr/`). **Chosen:** a comment on FAFF-569. Rationale: FAFF-569 is where the convention gets adopted and mechanised — recording it there puts it exactly where its consumer will read it; the convention is provisional until FAFF-569 builds the mechanism, at which point an ADR (via `faff adr new` at that ticket's graft time) is the right durable home. A repo artifact now would outrun the mechanism it describes. This choice also means this ticket's build phase is pure tracker writes.

## 4. HOW — Per-ticket actions

**FAFF-551 (Done).** Its Superseded comment already exceeds what the convention requires — it is the template. **Chosen:** no further action on FAFF-551.

**FAFF-552 (Done).** Its pointers exist but are scattered: PR #440 attached to the ticket, PRs #431/#432 attached to its Done children FAFF-558/FAFF-560, plus a review-findings comment. **Chosen:** add one short close-out comment consolidating the resolution in one skimmable place — cheap, and makes "carries a visible pointer" checkable by reading a single comment. Shape:

```
## Close-out — resolved across three PRs
- Baseline survives compaction — FAFF-558, PR #431
- Owning-session attribution — FAFF-560, PR #432
- Residual: baseline persists measure_session_id — this ticket, PR #440 (ded1c65)
```

**FAFF-550 (open — the real work).** Three steps, in order:

```
PROCEDURE disposition_FAFF_550:
  1. Verify the staged-deletions symptom is gone on main:
     a. Confirm commit 7330d00 (PR #430, FAFF-545) is an ancestor of main
     b. Run the merge-gate local test suite (test/merge-gate-local.test.mjs);
        the load-bearing assertion is "peer worktree must report a clean
        status post-merge" (git status --porcelain empty in the peer)
     c. Read merge-gate.js worktree handling (~486-700) to confirm the
        mechanism covers the reported path: base checked out in one clean
        peer -> merge --ff-only inside that peer (git refreshes index/tree,
        bypassing the staged-deletions cause); dirty peer -> refuse;
        >1 peer -> refuse
  2. Write the close comment per convention case 2 (unrelated-resolver shape):
     - Resolver: FAFF-545, PR #430, merge SHA 7330d00
     - Relationship: independent report of the same defect (FAFF-550 = symptom
       report from the p2-task-api run; FAFF-545 = root-cause report from an
       external-verification SUT, fix shipped under it) - not parent/child
     - Evidence: the test assertion from step 1b, cited by file and assertion text
  3. Move FAFF-550 to Done (not Duplicate, per convention)
```

**Verification method decision.** The current environment is a single-worktree checkout, so the symptom cannot be live-reproduced here; the alternatives are (a) existing test-suite assertions plus code reading, or (b) building a scripted repro (repo + peer worktree fixture). **Chosen:** existing test suite plus code reading. The test added in the FAFF-545 commit asserts the exact symptom (clean peer status post-merge) plus the refuse paths; a bespoke repro would duplicate that fixture for no added signal.

**Record the convention on FAFF-569.** Add a comment stating the two-case rule from the WHAT section verbatim (table form), citing FAFF-551's Superseded comment as the case-1 template and FAFF-550's close comment as the case-2 template, and noting the Duplicate-state invisibility constraint as the reason Duplicate is never used.

**Make the FAFF-569 dependency a graph edge (methodology critique, deps-surfaced finding).** The issue framing says the convention is settled "so FAFF-569 can adopt it" — a load-bearing dependency that currently lives only in prose. **Chosen:** in the same build step as the convention comment, add the explicit blocker relation **FAFF-565 blocks FAFF-569**, so FAFF-569 cannot be pulled ready before the convention lands. Once FAFF-565 reaches Done the edge reads as satisfied (the gateway's satisfied-blockers rule), so it costs nothing downstream — it exists purely to order the two tickets while both are open.

**Failure mode — the test passes but the symptom wasn't fully that mechanism.** The verification rests entirely on FAFF-545's artifacts (nothing anywhere names FAFF-550); if the staged-deletions symptom had a second trigger the test fixture doesn't cover, closing FAFF-550 buries it. How you'd know: the symptom reappears in a later run's merge-gate step. What it means: file a new finding ticket linking back to FAFF-550 for history — do not reopen it (monotonicity); this is acceptable residual risk, not a reason to hold FAFF-550 open on speculation.

**Anti-pattern:** marking FAFF-550 Duplicate-of FAFF-545 because the relation "fits" this one case. Why: it makes the completed finding invisible to every faff read, and it sets a precedent the multi-resolver case can never follow — the convention would fork on day one.

## 5. Scenarios

The tracker writes themselves are trivial; two objectives clear the complexity bar.

```
Given main includes commit 7330d00 (the FAFF-545 merge-gate fix)
When the merge-gate local test suite runs
Then the peer-worktree test passes its clean-status assertion
     (git status --porcelain empty in the peer post-merge),
     and this result is cited as evidence in FAFF-550's close comment
```

```
Given the three finding tickets after the build phase completes
When any faff read surfaces open urgent work (wtf, map, next, tidy)
Then none of FAFF-550, FAFF-551, FAFF-552 appears,
     and all three remain visible as completed (Done) work - none is
     in a cancelled-category state
```

- The FAFF-569 convention comment must state both cases of the rule and name a concrete template ticket for each case (FAFF-551 for case 1, FAFF-550 for case 2).

## 6. Design decision rationale

**Duplicate-of link vs Done-with-comment-trail?** Duplicate is native and low-effort but cancelled-category (invisible to faff reads) and single-target (cannot express multi-resolver findings). Done-with-trail costs one comment and keeps the work visible; precedent already set by FAFF-551/FAFF-552. **Chosen:** Done with comment trail, never Duplicate — stated as a two-case rule so FAFF-569 can adopt it mechanically.

**Where to record the convention — FAFF-569 comment vs docs note vs ADR?** A docs note or ADR is durable but premature: the mechanism the convention serves isn't built yet, and an ADR written now would be revised at FAFF-569's graft anyway. **Chosen:** comment on FAFF-569, with an explicit pointer that FAFF-569's graft should promote it to an ADR if it survives contact with the mechanism. Temporal anchor: at the time of writing FAFF-569 is Backlog with its own open questions unresolved.

**FAFF-551 residual action?** Its existing comment is the convention's template — adding more would be noise. **Chosen:** none.

**FAFF-552 residual action?** Pointers exist but span an attachment, two child tickets, and a review comment. **Chosen:** one consolidating close-out comment, because "visible pointer" should be satisfiable by reading one comment.

**FAFF-550 verification — existing tests vs scripted repro?** The FAFF-545 test suite already asserts the exact symptom and the refuse paths; the environment can't live-reproduce regardless (single worktree). **Chosen:** existing test suite run plus code reading of the merge-gate worktree path; a fresh repro fixture would add cost without signal.

## 7. Open questions and assumptions

**Open questions:** none — all decisions above are closed.

**Assumptions:**

- **Assumes:** FAFF-569 exists and is open to receive the convention comment. Validation: fetch FAFF-569 before writing; if it has been cancelled or absorbed elsewhere, park with a note rather than inventing a fallback home — the convention's consumer moving is a human-routing question.
- **Assumes:** the live tracker state fetched 2026-07-22 (FAFF-551/FAFF-552 Done, FAFF-550 open Backlog/High with zero comments) still holds at build time. Validation: re-fetch all three tickets first; if FAFF-550 has meanwhile been closed or commented, reconcile against the convention instead of blindly writing.

## 8. DONE — Definition of done

### From WHY (the false-signal problem)
- [ ] No faff read of open urgent work surfaces FAFF-550, FAFF-551, or FAFF-552
- [ ] FAFF-551 and FAFF-552 remain Done — no status moved backward

### From WHAT (the convention)
- [ ] FAFF-569 carries a comment stating the two-case Done-with-comment-trail rule, the never-Duplicate constraint with its invisibility rationale, and the two template tickets (FAFF-551 case 1, FAFF-550 case 2)
- [ ] FAFF-569 is blocked-by FAFF-565 — the convention dependency is an explicit graph edge, not prose (satisfied automatically once this ticket lands Done)

### From HOW (per-ticket actions)
- [ ] FAFF-552 carries one close-out comment listing FAFF-558/PR #431, FAFF-560/PR #432, and its own PR #440
- [ ] FAFF-551 has no new writes
- [ ] FAFF-550 is Done (not Duplicate/cancelled-category)
- [ ] FAFF-550's close comment names FAFF-545 + PR #430 + merge SHA 7330d00, states the independent-report relationship, and cites the peer-worktree clean-status test assertion as evidence
- [ ] The merge-gate local test suite was actually run on main during the build and passed — the comment cites a real run, not the test's existence

### From HOW (failure mode)
- [ ] The close comment on FAFF-550 does not overclaim: it scopes the evidence to the peer-worktree mechanism the tests cover

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Fetch FAFF-550, FAFF-551, FAFF-552, FAFF-569
  2. ASSERT FAFF-550.state == Done AND state.category != cancelled
  3. ASSERT FAFF-550.comments contains ["FAFF-545", "#430", "7330d00"]
  4. ASSERT FAFF-552.comments contains ["#431", "#432", "#440"]
  5. ASSERT FAFF-569.comments contains the two-case rule text
  6. ASSERT FAFF-569.blockedBy contains FAFF-565
  7. ASSERT FAFF-551 unchanged since 2026-07-20
```

confidence: high
spec-review: approve

## Methodology critique

**Methodology:** faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)** — No issues. After the live-state narrowing (FAFF-551/552 already dispositioned), the remaining work — one evidence-backed close, two comments, and a test-suite run for verification — sits comfortably inside a single sub-day unit. It is near the small end, but the pieces always ship together (the convention comment on FAFF-569 is derived from doing the closes; splitting it out would fragment one act of judgement into two tickets), so no split and no merge candidate. The spec's build-time re-fetch of all three tickets also guards against the scope narrowing further mid-build, which keeps the sizing honest.

**Workstream fit? (principles 1 + 5)** — Minor observation, no action required. The ticket bundles two things: tracker-ops execution (close/annotate the finding tickets) and a convention decision (disposition rule, recorded on FAFF-569). That is technically two outcomes, but they are cohesive here — the convention only becomes settleable *by* doing the closes, and the spec correctly parks it as a comment on FAFF-569 rather than promoting it to a doc/ADR before the mechanism exists. If the convention had been the primary deliverable, it would want its own outcome-named home; as a by-product it belongs where the spec puts it.

**Deps surfaced? (principle 6)** — One finding. The issue text says the disposition convention is settled "so FAFF-569 can adopt it", and the spec's fourth deliverable writes that convention onto FAFF-569 — yet FAFF-569 is linked only as "related", not as blocked. If the durable-mechanism work genuinely takes the convention as input, that is a load-bearing dependency living in prose: FAFF-569 could be pulled ready before the convention lands, and its author would either re-derive the disposition rule or guess. Recommend adding an explicit blocker link (FAFF-565 blocks FAFF-569); if FAFF-569 can in fact proceed without it, the "so FAFF-569 can adopt it" framing in this issue should soften to match. The other dependency in play — FAFF-545's merged fix as the evidence base for closing FAFF-550 — is already terminal, so it correctly needs no live blocker edge; the close comment's PR/SHA pointers are the right way to carry it.

**Risk profile? (principle 7)** — No issues. Build phase is pure tracker writes: reversible, no code diff, no novel integration, so nothing warrants a de-risking spike. The one judgement-bearing claim — that FAFF-550's staged-deletions symptom is actually gone — is de-risked appropriately for the environment: the spec acknowledges live reproduction is impossible in a single-worktree setup and substitutes the exact-symptom test assertion plus a targeted code read, run at build time rather than trusted from prep time. The Done-with-comment-trail convention (never Duplicate/cancelled-category) also keeps every disposition visible to future faff reads, which is the low-risk end of the disposition space.
