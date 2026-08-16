# Spec — FAFF-814: Eager, containment-gated discovered-scope jotting at L4 (keep the run-dir file)

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high · build-tier: complex · spec-review: approve. Full spec on Linear FAFF-814.

This spec is for the build agent implementing FAFF-814 and the human reviewers of that PR. It changes **when** the orchestrator files execution-discovered scope at L4 — from batched at the wave boundary to eager on each build's return — while keeping every existing safety (the run-dir record, the containment gate, serial-filing dedup) intact. It edits prose in `faff-beep-boop/SKILL.md`; no new CLI primitive is introduced.

## 1. WHY

**The load-bearing model.** Discovered scope has two separable moments today: the **implementor records** it to a run-dir file the instant it is found (during build), and the **orchestrator files** it (auto-creates a ticket) later, in a batch, at the wave boundary (step 8.0) or end of run (step 10). This change decouples those two moments *at L4 only*: recording stays where it is, but filing moves forward to the moment each build returns. Nothing about *what* gets filed or *how it is gated* changes — only *when*.

**Problem.** The batch-at-boundary timing exists to serve the L3 human-confirmation posture: discovered scope is reported out the back of a run for a human to crank up before it becomes live work. At L4 that gate is already gone — appetite is forced `full`, so beep-boop auto-creates without a human, and the scope authority is the PRD boundary, not a person. So deferring the filing to the boundary buys nothing at L4, and it opens a real failure window: an interrupted-then-abandoned run strands recorded-but-unfiled scope in a dead run dir, because a fresh run globs its *own* run-id, never the dead one's. Filing eagerly on each build's return closes that window and feeds the convergence loop sooner.

**Design principles** (reject an implementation that violates these):

- **Lane preservation is absolute.** The build subagent still only *records* to its file and returns; it never writes the tracker. Eager filing happens in the **orchestrator lane**, on the build's return, exactly as the batch filing does today. An implementation that lets the build subagent create a ticket is a defect (this is the FAFF-221 "third autonomous create path = fail" invariant).
- **Additive on the run-dir file, never a replacement.** The run-dir `discovered-scope.json` is the durable-at-discovery record, the on-disk ground truth the orchestrator reconciles the return against, and the resume input. Eager jotting is layered *on top of* it; the file is never dropped.
- **Serial filing is the concurrency contract.** The orchestrator files one build's scope at a time. That serialisation — not a lock — is what makes fuzzy search-before-create race-safe under parallel builds.
- **L1–L3 is frozen.** Only the L4 path changes timing. The attended-level file-and-defer / human-confirmed path is byte-unchanged.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` — step 7 (wave drain), step 8.0, step 10 | Skill prose | The orchestrator loop this spec edits; step 10 sub-steps 2–7 are the reused filing mechanism |
| `plugin/skills/faff-graft/SKILL.md` — "Discovered scope (record, never file)" | Skill prose | The implementor's record-only contract and the `discovered-scope.json` schema (unchanged) |
| `faff contain` — `plugin/skills/faff/bin/lib/contain.js` | CLI (pure) | Containment classifier: exit 0 contained / 3 outward / 2 usage. Chokepoint #1 |
| `faff self-intake` — `plugin/skills/faff/bin/lib/self-intake.js` | CLI | `outward → outward-self-intake` reclassifier (same-team/repo gate) |
| `faff intake-record --via jot --initiated autonomous` | CLI | Provenance stamp applied to each auto-created ticket |
| Gateway `### Appetite for destruction` — `plugin/skills/faff/SKILL.md` | Skill prose | The `Execution-discovered auto-create` + `Outward / new-root` (hard-floor) appetite rows |

**Scope statement.** This is the discovered-scope facet (item 4) of the emergent-decomposition decision — the ADR-promotion-intent banked on FAFF-809 ("L4 decomposition is emergent on the wave loop; ticket size is never a park reason"). It is one of four sibling implementers (FAFF-809 up-front, FAFF-810 reactive re-slice, FAFF-814 this, FAFF-499 umbrella).

## 2. OUT OF SCOPE

- **A stable structural dedup key** — the ADR item 4 explicitly names "search-before-create; stable structural key is the *later hardening*." v1 keeps the existing fuzzy title/surface search-before-create; a same-scope-different-words near-duplicate is accepted (self-healed by tidy). *Extension point:* the dedup sub-step (step 10 sub-step 4) is where a future key-based match would slot in.
- **Continuous per-item build scheduling.** Build *scheduling* stays wave-based; only *filing* goes eager. The continuous scheduler is the ADR's deferred future optimisation. *Extension point:* step 6/7 (build pass / wave drain).
- **L1–L3 behaviour.** Untouched — the attended file-and-defer / human-crank-up path stays. *Extension point:* the L4 conditional guarding the eager path.
- **Changing what is filed or the containment vocabulary.** The `faff contain` / `faff self-intake` classifiers and the appetite table are re-invoked, not modified.
- **The graft record schema.** `discovered-scope.json`'s shape is unchanged; graft continues to leave `containment: null`.

## 3. WHAT — vocabulary, types, interfaces

**Vocabulary — two orthogonal axes** (do not conflate; both already exist):

| Term | Axis | Set | Assigned by |
|---|---|---|---|
| `confidence` | Is the item real, separable work? | `concrete` \| `vague` | graft (the implementor), at record time |
| `containment` | Does it trace to a human-sanctioned ancestor within the mandate? | `contained` \| `outward-new-root` \| `outward-self-intake` \| `null` | orchestrator, stamped via `faff contain` at file time (graft leaves `null`) |

The ticket's shorthand maps onto these exactly: **"contained + concrete → auto-create"** ≡ `containment == contained` AND `confidence == concrete`; **"outward-new-root / vague → surface-only"** ≡ `containment` outward (any) OR `confidence == vague`.

**The record (unchanged, for reference):**

```
RECORD DiscoveredScopeEntry:               # .faff/runs/<run-id>/<issue>/discovered-scope.json (JSON array, appended)
  title: string
  description: string
  relationship: "blocker" | "blocked-by" | "peer" | "none"   # to the built issue
  source: "build" | "review" | "post-merge" | "ci-triage" | "orchestrator"
  source_ref: string                        # spec line / review finding / *.json ref
  confidence: "concrete" | "vague"          # graft-assigned; vague is only ever surfaced
  containment: "contained" | "outward-new-root" | "outward-self-intake" | null   # orchestrator stamps at file time
```

**The filing mechanism (existing step-10 sub-steps, reused verbatim by the eager path):**

```
PROCEDURE file_one_scope_file(entry_file, run_id, mandate):   # step-10 sub-steps 2-7, per file
  2. Containment check — faff contain <mandate> (--parent P | --root) --ancestry A --record <run-id> --phase run
       exit 3 (outward) → surface-only (sub-step 6); exit 0 (contained) → appetite gate
       (confidence == vague → skip entirely; surface in the run summary)
       (an outward item may be reclassified via `faff self-intake <mandate> --target {team,repo} --record <run-id> --phase run`;
        exit 0 + concrete → outward-self-intake, rejoin the appetite gate)
  3. Appetite gate — Execution-discovered auto-create row (gateway table). At L4 appetite is `full` ⇒ every concrete
       contained item files (pass-through). Outward/new-root is NEVER filed at any level incl full (hard floor).
  4. Dedup (search-before-create) — fuzzy match title/surface + relationship target against OPEN tickets,
       INCLUDING faff-chain-gap-fill and faff-jot-intake buckets. Skip + count duplicates.
  5. File — create via the faff-chain-gap-fill recipe (Backlog); stamp faff intake-record <new> --via jot --initiated autonomous.
  6. Outward-new-root — create nothing; surface in the run summary + post a comment on the mandate issue.
  7. Record — increment the ledger's discovered_scope_filed; append to .faff/runs/<run-id>/discovered-scope-filed.md.
```

The eager path introduces **no new** sub-steps. Its whole change is *when* `file_one_scope_file` is invoked and *over which files*.

## 4. HOW — behaviour

**Where eager filing hooks in.** Today `file_one_scope_file` runs in two batch passes: step 8.0 (this wave's files) and step 10 (all residual files). The edit adds a third invocation site: **step 7 (Wave drain), on each build's return**, guarded by an L4 conditional.

```
PROCEDURE on_build_return(built_issue, run_id, mandate, level):   # step 7 wave-drain, per return, orchestrator lane
  1. The build subagent has returned its result, including
       discovered_scope: { concrete: N, vague: N, path: .faff/runs/<run-id>/<built_issue>/discovered-scope.json }
     (path absent when it captured nothing → nothing to do).
  2. Reconcile the returned counts against the on-disk file at `path` (the file is ground truth; a mismatch is logged,
     the file wins). This is the existing between-units checkpoint, extended.
  3. IF level != L4:  return.                     # L1-L3 + opted-out: filing stays at step 8.0 / step 10, byte-unchanged
  4. IF path is absent OR file has no concrete item:  return.   # nothing eager to file; vague items surface at the boundary as today
  5. Eagerly file THIS build's file NOW, serially (never concurrently with another build's filing):
       file_one_scope_file(path, run_id, mandate)   # sub-steps 2-7 above
       Increment a per-wave eager-filed counter for each create, so step 8.0's filed_this_wave reflects it.
  6. Continue the wave (aggregate the return, launch/await the next unit).
```

**Serialisation.** In parallel-build mode the orchestrator may await several builds, but step 5's `file_one_scope_file` invocations are run **one at a time** in return order. So when build2's return is filed, build1's ticket is already created and committed — build2's search-before-create (sub-step 4) sees it and dedups. This is the entire race-safety argument: filing is serial even when building is parallel.

**Behaviour summary.** At L4, a `contained + concrete` discovery becomes a Backlog ticket at (or very near) its build's return, not at the next wave boundary; `outward-new-root` and `vague` discoveries behave exactly as at the boundary (surface-only, never auto-created); the run-dir file is written and kept throughout.

**The wave-boundary passes become a reconcile + backstop.**

- **Chosen: keep step 8.0 and step 10 running at L4 as a reconcile/backstop dedup pass** (resolves the ticket's open question 1). With eager filing, by the time step 8.0 runs, this wave's concrete-contained items are already filed; the boundary pass re-globs the same files and, via the *unchanged* search-before-create (sub-step 4), finds them already tracked and skips them — so it self-heals a missed eager fire (e.g. a build whose return was filed before a crash mid-wave) without double-creating. Rationale: the run-dir file already gives the boundary the full set at zero extra read cost, and the dedup pass is the belt to the eager path's braces; removing it would trade a cheap idempotent backstop for a stranding risk. Vague items still surface here (they were never eagerly filed).
- **`filed_this_wave` accounting (observability, not correctness).** Step 8.0's `filed_this_wave` diagnostic (wave log + runaway-cap report) counts *new concrete items filed*. With eager filing, this wave's concrete-contained items are already filed at step 7, so step 8.0's dedup skips them and `filed_this_wave` would read ~0 even though scope *was* filed this wave — a diagnostic understatement. Fix: `filed_this_wave := eager-filed-this-wave (step 7 counter) + boundary-filed-this-wave (step 8.0)`, so the per-wave diagnostic reflects real filings. Correctness is unaffected — the runaway / no-progress reset keys on *admissions*, not filings — so this is an observability repair, not a gate change.

**Edge cases / error handling.**

- **Missing file / zero concrete** → no-op (procedure step 4).
- **`faff contain` non-zero-non-3 (usage, exit 2)** → treat as *not contained*, surface-only; log loudly. Never fail-open to auto-create (fail-closed matches the hard floor).
- **Dedup ambiguity** → prefer skipping (a near-duplicate self-heals via tidy) over double-creating; the count is reported.
- **A build return arriving during another build's eager filing (parallel mode)** → queue it; filing is strictly serial.
- **Interrupted run** → any build whose return was reached has its scope already filed (the window this closes); any build not yet returned still has its run-dir file for a resume/backstop to pick up.

**Failure modes — how the approach could be wrong, and how you'd notice.**

- **The failure:** fuzzy search-before-create is weaker than a structural key, so the eager path *plus* the boundary backstop could still admit a same-scope-different-words near-duplicate. **How you'd know:** two open `faff-chain-gap-fill` tickets describing the same discovered work in one run's `discovered-scope-filed.md`. **What it means:** accepted cost (ADR item 4) — self-healed by tidy; the deferred structural key (OUT OF SCOPE) is the hardening, not a v1 blocker.
- **The failure:** the L4→appetite-`full` coupling is assembled from two places (gateway appetite table + non-optional convergence), not a single asserted invariant, so a future appetite refactor could silently make the eager gate stop firing. **How you'd know:** at L4, `discovered_scope_filed` stays 0 despite concrete-contained discoveries in the run-dir files. **What it means:** proceed, but the DONE checklist asserts the L4 eager-file behaviour directly so a regression is caught by test, not by the inferred coupling.

**Anti-pattern:** letting the build subagent file eagerly to shave the return hop. Why: it breaks lane preservation (the FAFF-221 invariant) and the serial-filing race-safety, and it puts a tracker write in the code-blind build lane.

**Anti-pattern:** deleting the run-dir file after an eager file. Why: it is the resume input and the reconcile ground truth; eager filing is additive.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run where a build records a `contained` + `concrete` discovery to its run-dir discovered-scope.json
When the build returns to the orchestrator (step 7 wave drain)
Then a Backlog ticket is created at/near that return (not deferred to the wave boundary),
  stamped `faff intake-record --via jot --initiated autonomous`, and the ledger's discovered_scope_filed increments
```

```
Given an L4 run where a build records an `outward-new-root` discovery and, separately, a `vague` one
When the build returns
Then neither is auto-created — the outward item is surfaced and a comment is posted on the mandate issue,
  the vague item is surfaced only; both remain visible in the run summary
```

```
Given an L1/L2/L3 (or opted-out) run with the same contained+concrete discovery
When the build returns
Then NO eager ticket is created — filing occurs only at step 8.0 / step 10 exactly as before this change
```

- Assertion: in every case above, the run-dir `discovered-scope.json` is present and unmodified-by-deletion after filing.
- Assertion: in no case does the build subagent perform a tracker write.

## 6. Design decision rationale

**Where does eager filing live — a new mechanism, or the existing sub-steps?**
Options: (a) author a fresh eager-filing routine; (b) invoke the existing step-10 sub-steps 2–7 from the new return-site. **Chosen: (b) reuse sub-steps 2–7 unchanged, add only a new invocation site in step 7.** Rationale: containment, appetite, dedup, provenance, and ledger recording must be byte-identical to the batch path or the two paths drift; the only real change is timing.

**How is the parallel-build double-create race prevented?**
Options: a structural dedup key + optimistic create; a lock around create; serial filing. **Chosen: serial orchestrator filing + the existing fuzzy search-before-create.** Rationale: the orchestrator already owns the filing lane; serialising the file step (not the build step) makes each later search see all earlier creates with no new primitive. The structural key is the later hardening (OUT OF SCOPE), not needed for correctness given serial filing.

**Keep or drop the wave-boundary / end-of-run passes at L4?**
Options: drop them at L4 (eager fully replaces batch); keep them as a backstop. **Chosen: keep them as a reconcile + backstop dedup pass.** Rationale: the run-dir file gives the boundary the full set for free; the unchanged search-before-create makes the pass idempotent (already-filed items skip), so it is a cheap belt that self-heals a missed eager fire and still surfaces vague items — resolving the ticket's open question 1.

**Gate the eager path on containment, or on appetite?**
**Chosen: gate on containment + confidence (the PRD boundary), with the appetite sub-step preserved as a pass-through.** Rationale: at L4 the scope authority is the PRD boundary, not appetite; keeping sub-step 3 in the reused mechanism means the batch and eager paths share one gate ladder, and at L4's forced `full` the appetite gate is a no-op for contained+concrete.

## 7. Open questions and assumptions

**Open questions:** none blocking. (Ticket open question 1 — the wave-boundary backstop — is resolved as **Chosen** in §4/§6. Ticket open question 2 — the stable structural dedup key — is deferred to OUT OF SCOPE per ADR item 4.)

**Assumptions:**

- **Assumes:** at L4 the appetite dial resolves to `full`, so step-10 sub-step 3 files every concrete-contained item (a pass-through for the eager path). *Validate:* confirm the gateway `Execution-discovered auto-create` row's `full` column + L4's non-optional convergence still couple this way. If a future refactor decouples them, the eager gate must read containment+concrete directly rather than routing through the appetite sub-step.
- **Assumes:** graft continues to record `containment: null` and never files; the orchestrator stamps `containment` via `faff contain` at file time. *Validate:* `faff-graft/SKILL.md` "Discovered scope (record, never file)" is unchanged by this work.
- **Assumes:** the run-level `level` is readable from the run ledger (`level: "L4"`) at the wave-drain return site, so the L4 conditional (procedure step 3) can branch. *Validate:* the orchestrator already reads `level` for convergence gating in the same loop.

## 8. DONE — definition of done

### From WHY
- [ ] At L4, a build that records a `contained` + `concrete` discovery has its ticket created at/near the build's return (step 7 wave drain), not deferred to the wave boundary.
- [ ] The abandoned-run stranding window is closed: a returned build's scope is filed before the next wave boundary.

### From WHAT / HOW (behaviour)
- [ ] `outward-new-root` items stay surface-only at L4 (never auto-created), with a comment posted on the mandate issue.
- [ ] `vague` items stay surface-only at L4 (never auto-created).
- [ ] The run-dir `discovered-scope.json` is still written and is not deleted after filing (durable belt / audit / reconcile / resume).
- [ ] The build subagent performs no tracker write — eager filing is in the orchestrator lane only.
- [ ] Eager filing invokes the existing step-10 sub-steps 2–7 (containment → appetite → dedup → file → surface → record); no new filing sub-step is introduced.
- [ ] Each eager-filed ticket is stamped `faff intake-record --via jot --initiated autonomous` and increments `discovered_scope_filed`.

### From HOW (concurrency / edge)
- [ ] Two parallel builds discovering the same contained+concrete scope produce exactly one ticket (serial orchestrator filing + search-before-create dedup).
- [ ] `faff contain` usage/error (exit 2) fails closed to surface-only, never auto-create.
- [ ] The wave-boundary (step 8.0) and end-of-run (step 10) passes still run at L4 and are idempotent against already-eager-filed items (no double-create); vague items still surface there.
- [ ] The per-wave `filed_this_wave` diagnostic counts eager fires (step 7) as well as boundary fires (step 8.0), so the wave log and runaway-cap report reflect scope actually filed this wave (observability, not correctness).

### From "L1–L3 frozen"
- [ ] L1–L3 (and opted-out) behaviour is byte-unchanged — no eager ticket is created at attended levels; filing stays at step 8.0 / step 10.

### Integration smoke test
```
Run a scripted L4 wave with one build whose returned discovered-scope.json holds one contained+concrete item:
  assert a Backlog faff-chain-gap-fill ticket exists after the build return and before step 8 runs;
  assert discovered_scope_filed == 1; assert the run-dir file still exists;
  assert re-running step 8.0 over the same file creates no second ticket (idempotent backstop).
```

confidence: high
build-tier: complex
spec-review: approve (round-1 revise — architectural minor: `filed_this_wave` diagnostic drift — resolved in-place §4 + DONE)

---

## Already shipped against this surface

Done tickets on this surface — related context, none supersede FAFF-814's premise (eager per-build-return filing at L4 is new timing behaviour):

- **FAFF-221** — Wire containment at the autonomous filing chokepoints + outward-new-root surfacing. Establishes the `faff contain` containment gate (contained/outward) and the surface-only routing this spec reuses at the eager site.
- **FAFF-87** — Within-run convergence loop; drains execution-discovered scope same-run (L4). The loop this change reschedules filing *within* (eager on return vs batched at the boundary).
- **FAFF-540** — `--converge no_progress_waves` reset by unbuildable auto-filed intake/chain-gap tickets. Watch-item: eager filing must not perturb the convergence no-progress counting (same `filed_this_wave` accounting — see §4).
- **FAFF-541** — Orchestrator-lane coarser-mandate containment asymmetry documented in beep-boop chokepoint prose.
- **FAFF-219 / FAFF-222 / FAFF-354 / FAFF-217** — `faff contain` primitive, container-level mandates, ancestry hardening, provenance schema. Foundational primitives this spec reuses unmodified.

---

## Methodology critique

`Methodology: faffter-dark-methodology-agile-delivery`

Per-issue agile-delivery lens on FAFF-814, across the four `issue-critique` axes.

### Right-sized (principle 4)

No issues. The change is a single, coherent concern — move the *timing* of L4 discovered-scope filing forward to the build's return — confined to prose in one file (`faff-beep-boop/SKILL.md`, step 7), reusing the existing step-10 sub-steps 2–7 with no new CLI primitive. The "keep the backstop passes" half of the spec is preserve-existing-behaviour, not a second deliverable. This is a clean 1–3 day unit; nothing to split, nothing to merge.

### Workstream fit (principles 1 + 5)

**What's there.** FAFF-814 is one of four siblings (FAFF-809 up-front, FAFF-810 reactive re-slice, FAFF-814 this, FAFF-499 whole-loop umbrella) that all converge on a single outcome — "L4 decomposition is emergent on the wave loop." That outcome is currently carried by *related-to* links between peer tickets and an umbrella *ticket* (FAFF-499), not by an outcome-led container that owns all four.

**Why it matters.** A shared outcome expressed as peer cross-links rather than a workstream can't be sequenced or measured as a unit: there's no single "done" for the emergent-decomposition change, and the four facets can be pulled independently even though they only deliver value together.

**What to do.** Confirm whether an outcome-led project ("Emergent L4 decomposition on the wave loop") holds all four; if the umbrella is only FAFF-499-the-ticket, consider promoting the outcome to a container so the four facets sequence and complete against one done-bar.

### Surfaced deps (principle 6)

**What's there.** FAFF-814's WHY leans directly on FAFF-809 — its scope statement calls this "the discovered-scope facet (item 4) of the ADR-promotion-intent *banked on FAFF-809*." The edit lands in the step 6/7 wave-loop region of `faff-beep-boop/SKILL.md`, the same loop the sibling behaviours (809, 810) most plausibly touch. All four links are *related-to*; none are `blocker`/`blockedBy`.

**Why it matters.** Related-to is invisible to sequencing and to automation routing, which read only the blocker graph. Two load-bearing deps are hidden: (1) a *logical* dep — 814's rationale rests on the ADR intent FAFF-809 owns; if that decision moves or the ADR isn't promoted, 814's premise dissolves. (2) a *file-region* dep — concurrent prose edits to the same step 6/7 region will conflict, and at L4 the loop can auto-create and build siblings without a human to serialise them.

**What to do.** Encode the load-bearing edges explicitly: at minimum FAFF-814 `blockedBy` FAFF-809, and a sequencing link (or explicit "must land serially" note) among the same-file siblings.

### Risk profile (principle 7)

No issues. The one genuinely novel element — the serial-filing race-safety claim under parallel builds — is de-risked in-spec: it is pinned as the `holdout` scenario (scenario 3), and the wave-boundary/end-of-run passes are kept as an idempotent backstop belt. The two named failure modes are each surfaced with a detection signal and an accepted-cost or direct-DoD-assertion mitigation. No separate de-risking spike is warranted.

> Note (autonomous prep): the methodology critique is advisory and does not gate a confidence-high promotion; the `methodology` lens is not in this L3 run's selected spec-review lens set. The surfaced-deps finding (encode FAFF-814 blockedBy FAFF-809; sequence same-file siblings) is carried to `/faff-wtf` for the human.

---

*Spec-review (spec_review slot, faffter-dark-spec-review, single-pass L3, lenses architectural/infosec/QA): round 1 `revise` — architectural `minor` (`filed_this_wave` diagnostic drift under eager filing); resolved in-place (§4 accounting fix + DONE item). Round 2 `approve` (churn: false, converging). Both gates pass: confidence `high` + spec-review `approve`.*
