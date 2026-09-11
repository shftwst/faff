# Gate 1 carry-forward: backlog triage against master v5

**Status:** sections 4, 5, the mechanical half of 7, and the safe core of 8 applied to the tracker 2026-09-06. FAFF-740 narrowed 2026-09-07. Section 6 remains proposed. See the addendum at the foot of this document for what moved afterwards.
**Date:** 2026-09-06, addendum 2026-09-11
**Scope:** every live FAFF ticket (Backlog, Todo, In Progress, In Review) pulled 2026-09-06, mapped to [master v5](v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) and the [v5 plot input](v5/FAFF-PLOT-INPUT-v5.md).
**Live set:** 130 tickets at pull time. FAFF-1013 shipped during the pass; FAFF-1015, FAFF-1016 and FAFF-1017 were filed after it. Working set for admission is therefore 129 plus 3 unassessed.
**Repository read at:** `origin/main` `3910417c`. The local branch `chore/adversarial-max-tokens-15k` (`bff6ac1b`) was 20 commits behind; anything verified against the worktree alone can be wrong.
**Method:** 11 parallel classification agents over batches of 12, each reading the ticket in Linear and verifying its premise against the repo, then an adversarial pass over every proposed cancellation, then four cross-cutting lenses (cluster supersession, stale-as-written, critical path, tracker hygiene) with their own adversarial verification.
**Supersedes for triage purposes:** [Phase 0 carry-forward v2](phase-0-ticket-carry-forward-v2.md), whose 131-ticket live set is a 2026-08-12 snapshot. Only 47 of today's 130 tickets appear in it, and three tickets it lists as live (FAFF-12, FAFF-216, FAFF-392) were cancelled on 2026-08-19.
**Tracker was read-only during the triage itself.** The writes listed in section 10 were made afterwards, on explicit operator instruction, section by section.

## Decision

| Disposition | Count | State |
|---|---:|---|
| Closed Cancelled | 5 | applied 2026-09-06 |
| Closed Done, spent umbrellas whose children shipped | 2 | applied 2026-09-06 |
| Held behind a gate rather than cancelled | 1 | FAFF-611, left in Backlog |
| Keep, B1 now | 20 | proposed |
| Keep, B2 next | 25 | proposed |
| Keep, B3 later | 41 | proposed |
| Keep, B4 held behind a gate | 35 | proposed |
| Shipped during the pass | 1 | FAFF-1013 |
| Filed after the pull, unassessed | 3 | FAFF-1015, 1016, 1017 |
| **Total** | **132** | |

Cutting across the keeps: **14 must be rewritten down to a residual before admission** (section 5), and **55 need a tracker record repaired** before they can be picked up honestly (section 7).

The cancel rate is 5 per cent. That is the honest number and it is the first finding: **this backlog is not full of dead tickets, it is full of tickets whose premise died while a clause of their scope survived.** Sixteen cancellations were proposed on the first pass and fourteen were overturned by an adversarial reviewer who opened the cited artefact and found a live residual every time. Handing any of those to a build agent as "keep" would have it build the stale scope. The correct instruction is `rewrite`, and that class is characterised in section 5.

The second finding is larger than any ticket. See section 2.

## 1. What changed since carry-forward v2

Phase 0A, Phase 0B, Phase 1 and the first Phase 2A slice are substantially delivered. 151 distinct tickets merged to `origin/main` in the 21 days from 2026-08-16.

| v5 deliverable | Ticket | State |
|---|---|---|
| Nine-scenario Phase 0 reference matrix and common audit bundle | FAFF-822 | Done |
| Recovery-bundle recovery semantics | FAFF-845 | Done |
| State-authority map | FAFF-825 | Done |
| Cutover-slice selection, adopted as ADR-0122 | FAFF-944 | Done |
| Decision-capture instrumentation | FAFF-947, 954, 956, 960, 989, 1009 | Done |
| Coordination-fidelity study | FAFF-826, 949 | Done |
| External Commissaire protocol proof | FAFF-828 | Done |
| Standalone `commissaire` CLI, ADR-0123 | FAFF-999, 1000 | Done |
| Published external-verification protocol v0.1 | FAFF-743 | Done |
| Inspectable Fly.io L3 production run | FAFF-734 | Done |

Every acceptance gate that was meant to admit that work is still in Backlog.

## 2. The governing constraint: the delivery decision of 2026-09-04

On 2026-09-04 the maintainer applied a `paused` label to eleven tickets in a single edit and recorded the reason in a comment on each, and in FAFF-999's description:

> Ship the separate CLI for the current single-operator use and defer the V5 evidence-gating ceremony (Phase 2B comparison, Gate 1/2, outward-claim proofs) until a second Commissaire consumer actually exists.

This is a legitimate call and this document does not reopen it. Everything below is prioritised **inside** it. Three facts about it matter for planning.

**The label does nothing mechanically.** `paused` is absent from `CONTROL_LABELS` in `plugin/skills/faff/bin/lib/labels.js`, so `labelOp` rejects it and no CLI path can set or clear it. No read path consults it: `eligible.js` keys only on `faff-automation-hold` and `faff-automate`. It is a human-facing marker applied through the Linear UI. It carries no label description, alone among the control labels.

**It caught four tickets that are not gates.** Seven of the eleven are the human acceptance gates (FAFF-824, 827, 829, 831, 832, 974, 790). The other four are delivery work: FAFF-588, FAFF-740, FAFF-830, FAFF-629. FAFF-588 and FAFF-740 are the only two prerequisites of FAFF-824, the Phase 0B acceptance gate, so pausing them pauses the gate they exist to open.

**The reopen condition is prose only.** "The moment Commissaire is published or a second consumer onboards" appears in ticket comments. No ADR records the pause, no amendment to master v5 records it, and nothing will check the trigger. Recommendation: write it as an ADR with a named trigger, or amend master v5's open-decisions table. That is the difference between a deferral and a thing that quietly never happens.

### The gate that was bypassed

```
   recorded in Linear                     what actually happened
   ------------------                     ----------------------
   FAFF-827 ──blocks──▶ FAFF-828          FAFF-828 Done 2026-09-02 20:26 UTC
   (accept Phase 1 extraction)            FAFF-827 has never left Backlog
                                          `paused` applied 2026-09-04 17:41 UTC
```

FAFF-827's gate result reads "Accept: Phase 2A may begin after Phase 0B also accepts". Neither FAFF-827 nor FAFF-824 ran. Two days later FAFF-999 moved an entrypoint onto PATH (`plugin/skills/faff/bin/commissaire`), which is exactly the change class FAFF-827's compatibility-and-rollback bullet governs, and flipped ADR-0122 and ADR-0123 to Accepted. The pause was applied after the bypass, so it did not authorise it.

**Remedy: narrow FAFF-827, do not cancel it and do not sign it as-is.** Its evidence splits cleanly.

| Half | State | Action |
|---|---|---|
| Map and characterisation: owner and durable fact per step, identities, writers, readers, integrity classes, retained semantics | Satisfied by `STATE-AUTHORITY-MAP-v5.md`, `CUTOVER-SLICE-SELECTION-v5.md`, ADR-0122 | Accept retroactively on the artefacts as they stand |
| Extraction safety over the shipped slice: no second canonical history, slice stays behind the `faff` surface, entrypoint moves carry generated-artifact, install, compatibility and rollback evidence | Never checked, against a slice that has shipped | Run it post hoc against `881f4a25`, `43a4806e`, `714c113b` |
| "Phase 2A may begin after Phase 0B also accepts" | Spent | Strike |

Signing a gate whose evidence was never assembled is the false-green the programme exists to prevent. Cancelling it leaves a shipped entrypoint move unchecked.

### Delivery risk

The matching row in master v5's risks table is **"Autonomous production outruns review. Early signal: review queue and rework rise. Response: reduce parallel build work and clear the evidence queue."** Two adjacent rows are also live, and their prescribed responses differ:

- **"Self-certified L4: one lineage authors, judges, and controls effects. Response: narrow the claim or add a stronger boundary."** FAFF-828 banked its proof as 272 lines of `test/commissaire.test.mjs` inside faff's own suite. `git ls-tree origin/main verification/` returns nothing matching `828`, `second-producer` or `external-producer`. FAFF-360 is the only live ticket capable of producing an independent producer.
- **"Coordinator is built from missing-data evidence. Response: improve instrumentation or fail the coordination question."** `verification/reports/FAFF-826-coordination-fidelity/decision-corpus.jsonl` is 0 lines and `result.json` says `record_count: 0, null_result: true`. The instrumentation blockers are all closed. **No live ticket owns collecting the corpus.** FAFF-949, which did, was closed Done on 2026-08-31 having only enabled the capture flag.

That last one is a gap, not a ticket. It needs filing.

## 3. The critical path

```
  FAFF-360 ───▶ FAFF-829 ───▶ FAFF-830 ───▶ FAFF-831 ──┐
  second        accept 2A     run the       accept 2B   │
  consumer                    comparison                ├──▶ FAFF-832
                                                        │    Gate 1
  FAFF-974 ─────────────────────────────────────────────┘
  accept fidelity  (unblocked on the record; corpus is 0 bytes in fact)

  FAFF-588 ─┐
            ├──▶ FAFF-824   accept Phase 0B
  FAFF-740 ─┘

  FAFF-827 ───▶ [FAFF-828 already Done]   gate bypassed, see section 2
```

| Ticket | Startable today | Single next act |
|---|---|---|
| FAFF-360 | By a human, yes | Run `/faff-prep`. Its Acceptance section reads "To be determined during prep". Both named dependencies shipped: FAFF-350 merge-gate `3f82c022`, FAFF-977 secret-free `commissaire audit verify` `5e9eafab` |
| FAFF-829 | No | Build FAFF-360. Its first evidence bullet has no artefact anywhere in `verification/` |
| FAFF-830 | No | Nothing until 829. Its own pause comment calls it "the largest evidence to produce evidence item". Cost XL |
| FAFF-831 | No | Nothing until 830 |
| FAFF-974 | No, despite reading unblocked | Collect and commit a confirmatory decision corpus. The only real data is an 11-decision batch posted as a comment on 2026-09-01 that says of itself "pilot/diagnostic; not a gate result" |
| FAFF-832 | No | Both upstream gates |
| FAFF-824 | Nearly, on the facts | Close FAFF-588 (its three asks are satisfied in-repo) and narrow FAFF-740 to Phase 0 release claims per carry-forward v2 |
| FAFF-827 | Yes, as a human act | Narrow per section 2 |

**Is FAFF-360 still required evidence for FAFF-829?** Yes, and more than before. FAFF-828 shipped the facade, a design spec and unit tests. It did not supply "a real producer outside current scheduling and skills". Its own Required-fixtures list (pass, seeded governance block, stale evidence, effect mismatch, killed producer, forged record, replay) has no banked run evidence in the tree. FAFF-828 was closed on implementation, not on the fixtures it declared. Without FAFF-360, FAFF-829 could only ever be accepted "narrow", limited to protocol sufficiency under a producer faff wrote itself.

## 4. Cancellations

Cancellation was evidence-gated. Six grounds were admissible: shipped or superseded, duplicate, dead premise, contradicts an accepted v5 decision **and** retains no value under any of the three permitted outcomes, abandoned external substrate, speculative pre-Gate-2 construction with zero retained value. Distance from the current horizon was explicitly not a ground, because master v5 says held work "remains valid backlog".

### 4a. Applied 2026-09-06

Eight candidates went to a final adjudication, one independent high-effort adjudicator each, every one required to open the cited artefacts itself. Seven closures were executed. The adjudicators also refuted several claims from the earlier passes; those corrections are recorded in the closing comment on each ticket.

| Ticket | Closed as | Ground | Proving artefact |
|---|---|---|---|
| **FAFF-991** L4 lights-out park re-entry | **Done** | Empty umbrella, all four acceptance criteria shipped | FAFF-992 `5d8d8f73` PR #863, FAFF-993 `d197d1f9` PR #867. `park-reconsider.js`, `lights-out.js:1297`, `park.md:55-62`, `kernel.md:315` |
| **FAFF-946** judge trail plus flip L4 | **Done** | Trail shipped; the flip half was decided the other way and shipped inverted | FAFF-994 `1515b7b7` PR #850, FAFF-995 `f788125c` PR #854, which states "This is not a floor removal" |
| **FAFF-920** review-bench thinking-budget | Cancelled | Shipped inside its sibling's PR, 3.5 hours after filing | `run-bench.mjs:64,155`, `README.md:112,210-213`, commit `31f88217` PR #760 |
| **FAFF-22** fused provider-wrapper | Cancelled | Dead premise: the two-slot cost was removed. All three open questions closed | FAFF-109 `b5f2dd9e` PR #53; `kernel.md:133,418,438,460`; `skills.md:96-102`; `validate-adapters.js:403-425` |
| **FAFF-543** claude-box worktree | Cancelled | Superseded, not duplicate. Verification discharged twice | FAFF-527 `dc6bc9f2` PR #421, FAFF-820 PR #701 |
| **FAFF-649** claude-box CI image | Cancelled | Acceptance criterion refuted, not deferred | The Actions runner bind-mounts `/var/run/docker.sock` into every Linux job container (`ContainerInfo.cs:57`); ADR-0095 names FAFF-649 as non-normative |
| **FAFF-799** why FAFF-757 lacked the label | Cancelled | Purpose decided the other way; evidence has aged out | FAFF-889 `fce0da39` PR #743; `faff-graft/SKILL.md:278` |

Both umbrellas closed Done rather than Cancelled on the operator's convention: a parent whose children shipped rolls up from them. FAFF-946 carries the caveat that its second half shipped inverted.

**Preconditions executed before the state changes, so nothing was lost:**

- FAFF-542's description now carries FAFF-543's two host-mount rejection grounds. It previously held only the conclusion, not the reasoning.
- FAFF-800 received the FAFF-757 incident record and a re-cut warning: FAFF-889 superseded two of its three candidate designs and its hard constraint, so it must not be prepped against its current candidate list.
- The `blocks` edge FAFF-799 to FAFF-800 was released **before** the close. FAFF-800's `blockedBy` is now empty.
- The FAFF-22 wrapper-maintenance caveat, recorded nowhere else, is preserved in its closing comment. It still wants a one-sentence home in `docs/guide/skills.md`.

`duplicateOf` was deliberately left null on all seven. None is a duplicate: they are spent umbrellas, dead premises, and supersessions.

**Two residuals recorded but unowned.** FAFF-946's per-round and per-lens objection history is unshipped and no live ticket carries it, since `judge-trail.js` `collectObjections` persists only the latest round. FAFF-1007's acceptance line, "lands before FAFF-993's autonomous re-open ships", is now factually stale because that seam shipped first, and should be re-cut.

### 4b. Held, not cancelled

**FAFF-611** multi-package release-please config. Proposed for cancellation and rejected on the evidence. `verification/evidence/README.md:38` on main names FAFF-611 by identifier as the owner of per-unit release plumbing; the shipped Agent Delivery Evidence spec (v0.1 and v0.2) is still hand-versioned in a Markdown table with no independent tag series; and a dated human decision of 2026-08-19 already ruled "keep parked" on exactly this evidence. The cancellation ground was also refuted: the surviving scope is two release-please path keys inside one repository, not a package or repository split, so master v5's non-goal does not reach it. Left in Backlog with `faff-automation-hold` intact.

## 5. The rewrite class: no longer relevant as written

### Applied 2026-09-06: notices posted, bodies deliberately not rewritten

All 14 tickets in this class carry a `Stale as written. Do not prep against the current body.` comment as of 2026-09-06, verified byte-exact against source. **No body was rewritten and no state was changed.**

That was a deliberate reversal of the original recommendation, on evidence. A drafting pass produced a full replacement body for each of the 14, and an independent adversarial audit of each draft found that **13 of 14 dropped live, unbuilt, unowned scope**. Examples:

- **FAFF-800** kept the `eligible_ids()` fly-runner pre-check as prose but gave it zero acceptance rows, so a build agent could satisfy every criterion and leave the originating defect in place.
- **FAFF-74** silently dropped the legacy-key migration decision (`slots:` to `capabilities:`, loud error on the legacy key, never a silent default). Nothing on main records that intent, so the rewrite would have been its only casualty.
- **FAFF-855** deleted the backoff half arguing `TRANSPORT_RETRY` covers it, when `isRateLimited` is deliberately excluded from `isTransientTransport` so that retry never fires on a 429.
- **FAFF-925** cancelled the ticket and lost both jq fix directions while its own must-preserve list claimed all four items were carried.

The lesson generalises: a rewrite destroys the original text, and even a careful agent working from a verified brief lost something 13 times in 14. A comment removes the build-the-dead-scope hazard at zero risk and leaves the re-cut to prep time, when someone has the codebase in front of them. Each comment carries the verified residual, the audit's dropped-scope findings, what is recorded nowhere else, and the field changes the re-cut needs.

Recommended action recorded per ticket: 12 rewrite, 2 rehome-residual-then-cancel (FAFF-419, FAFF-925). FAFF-683 flipped from ratify-and-close to rewrite, because the rule it would have recorded is already written down and the real defect is that the shipped drain does not honour it.

### Corrections this pass made to the sections above

The drafting agents checked the triage briefs against `origin/main` and refuted several claims made earlier in this document. The material ones:

| Claim earlier in this document | Correction |
|---|---|
| The `paused` label was applied in one bulk edit with the reason only in prose (section 2) | FAFF-588's parking comment names an explicit reopen trigger: "the moment Commissaire is published or a second consumer onboards". Both have since fired (FAFF-999 Done, FAFF-828 Done), so that pause is stale by its own terms |
| Nine autonomous prep passes were burned on one 429 fault owned by FAFF-855 (section 7) | Wrong. The parks were an unset API key (`DUMMY_API_KEY`, exit 7) and empty content, not rate limits. FAFF-855's fix would have prevented none of them |
| FAFF-925's two named root causes are both closed (section 5) | Only one. The jq cause is still open, proved by a masked-PATH control run at 33/38 |
| FAFF-419's shipped sub-levers are FAFF-882 and FAFF-903 (section 5) | Those are not its children. Its children are FAFF-485, 486 and 487, and FAFF-485 (MCP payload trim) is the one that shipped |
| FAFF-73's Done criterion is entirely unbuilt (section 5) | Half shipped: the two-sink split is live via `faff dod split` and FAFF-473 |
| FAFF-800 would be built wrong today (section 5) | Overstated. It carries `faff-automation-hold`, a hard exclude at every gate, so no drain would admit it. The exposure is an interactive `/faff-prep` |

Two facts also moved during the pass: `origin/main` advanced to `fd1e9788`, and FAFF-360 was split, so the Gate 1 chain in section 3 is now FAFF-360 to **FAFF-1018** to FAFF-829.

### The class, as originally characterised


This is the largest actionable class and the one a build agent will get wrong. Each ticket's motivation has been overtaken while a clause of its scope survives. Four sub-shapes, and they need different handling.

**A shipped mechanism orphans an obligation (the most common and most dangerous).** A sibling shipped the contract, flag or field, and its own accepted spec names this ticket as the surviving consumer of the leftover. Then the sibling closed. The residual has a written owner that is Done. These must be rewritten, never cancelled: cancelling destroys the last live pointer to a recorded obligation.

| Ticket | What actually survives |
|---|---|
| **FAFF-588** | The convention shipped. Only one case is actually published (`2026-08-12-fly-l3-faff-472`, verdict does-not-support); `results/2026-08-30-l4-p1-link-shortener-faff-499/README.md` says "REGISTERED and FROZEN, awaiting execution" and its 2026-08-29 twin declares itself unpublishable. `README:22` assigns publication to "the case ticket that produces them", and that ticket (FAFF-499) is Done, so the obligation has no owner. Rewrite to: execute and publish the frozen case |
| **FAFF-73** | FAFF-859 `4302fd58` PR #709 shipped declaration only: `config.js:250-257,528-533` give `container: shared\|own` and `host: local\|remote`. There is no `object_store: separate`, no `deny_read`, no loader rejection. FAFF-73's actual Done criterion is unbuilt and its claimed absorbers (FAFF-276, FAFF-834) are Done. Rewrite to the loader-enforcement half |
| **FAFF-29** | ADR-0031 Consequences: "FAFF-29 builds local-dev ergonomics on top of this contract rather than duplicating it". FAFF-30's spec:136: "v1 = contract + compose producer + seeding; NOT FAFF-29 ergonomics". Rewrite to the ergonomics layer |
| **FAFF-33** | One deferral survives, named in a Done spec: `records/specs/2026-07-01-FAFF-311-...:27` "Env-reuse across collision-group members, deferred as a v1 non-goal (state-contamination risk)". Rewrite to that single question |
| **FAFF-800** | **Highest stakes: it sits in an active-horizon project and must not be admitted as written.** FAFF-889 invalidated two of its three candidate designs and its entire Hard-constraints section, which is written against ADR-0098 label-based fencing. `faff build-claim release-if-stale` is a better substrate than the design it was written on, so the rewrite makes it easier |

**A decision already made but never recorded.** Nothing left to build, only to ratify. Handing these to a build agent produces an ADR arguing for a world that already exists.

| Ticket | State |
|---|---|
| **FAFF-683** | Decision 1 settled at `operations/ci/l4-watcher.yml:19-23`. Decision 2 is de facto answered by `faff-beep-boop` section 0a:140 but never stated, and the FAFF-858 spec put resume out of scope, so the mid-run-PRD-edit hole stays unrecorded. Ratify in prose or an ADR and close |
| **FAFF-249** | Four of five bullets settled in shipped code. One residual and this ticket is its only carrier: `faff-plot/SKILL.md:174` still advertises "structural (default)" twenty-three lines above `:51`'s contradicting default. Rewrite to an ADR ratifying the shipped lineup |

**Framing dead, capability absent.** The cost or vocabulary the ticket was written to solve was removed, but the artefact it wanted was never built. Rewrite retaining the artefact, delete the motivation. Members: **FAFF-71** (rewrite to the three role-assignment decisions in v5 lane vocabulary; drop the four-role rename), **FAFF-393** (rewrite to the incident-record artefact and its home), **FAFF-602** (rewrite to the in-repo core plus plugin split, distribution left to FAFF-729; strike the market-window rationale).

**Same shape, from the reconciliation set.** **FAFF-855** is stale on all three of its own fix directions: direction 3 is done, direction 1 is now forbidden doctrine (`faffter-dark-spec-review/SKILL.md:55,215`), and the operator-override sibling FAFF-890 was cancelled on 2026-08-19. One sentence survives: per-backend concurrency cap with backoff. **FAFF-925** names six failures whose two root causes are both closed, while a hermetic run today fails on a different case (`test/faff-734-external-verification-case.test.mjs`). **FAFF-74** and **FAFF-419** are the runners-up.

Two structural observations behind this whole class:

1. **One commit can gut several tickets at once, silently.** `fce0da39` killed FAFF-799 and invalidated most of FAFF-800. Nothing recorded either effect. The same pattern: FAFF-109 to FAFF-22, FAFF-859 to FAFF-73, FAFF-918 to FAFF-920. A "which live tickets does this diff invalidate?" step at merge time would catch them.
2. **`Done` is where residuals go to be orphaned.** FAFF-276, FAFF-834, FAFF-527, FAFF-499, FAFF-584, FAFF-311, FAFF-30 and FAFF-859 all carry a written forward-reference to a live ticket's residual. Nothing verifies those references still resolve.

Both are worth a `/faff-jot` in their own right.

## 6. What a runner can build

**Nothing, until a human clicks.** `.faffrc.yaml:25` sets `automation_default: opt-in`. `eligible.js:20-25` hard-excludes `faff-automation-hold`, explicitly includes `faff-automate`, and returns false for unlabelled tickets under opt-in with a tracker present. ADR-0009 makes the label CLI write-abstain: `labelOp` returns `{refused: true}` for any tracker-owned label, so no autonomous path can add `faff-automate`. Of the 20 B1-now items, four carry `faff-automate` and all four are excluded anyway: FAFF-745 also carries the hold, and FAFF-931, FAFF-966 and FAFF-969 are `faff-parked` on real needs-human verdicts.

The queue below is what a runner can take immediately after those clicks. All twelve verified live against `origin/main`.

| # | Ticket | Cost | Uncertainty it retires |
|---:|---|---|---|
| 1 | **FAFF-997** regions selftest discards a failing member's output | S | A red 104-member battery names no failing sub-check, so every CI red costs a human reproduction |
| 2 | **FAFF-985** adversarial review deadline exceeds the heartbeat window | S | Every foreground merge claims a review vector it did not exercise. `config.js:473` `operationDeadlineSecs` 3600 against a 900s stall window at `config.js:98`. This is the overclaim Phase 0B forbids |
| 3 | **FAFF-901** harden `bundle.js` git spawnSync against network hang | S | 27 `spawnSync(` calls, zero matches for `timeout\|killSignal\|AbortSignal`, on the recovery-bundle publication path Phase 0A depends on |
| 4 | **FAFF-1002** local UNIT rung is a >600s monolith | M | The runner cannot complete its own gate ladder in one foreground turn. `gates.js:568` still strips `--test-shard` for the LOCAL rung; FAFF-987 sharded CI only. Highest unlock: it de-risks everything behind it |
| 5 | **FAFF-1007** park-reconsider-classification grader has no eval cases | M | An ungraded closed-set classifier now gates a live autonomous unpark path. Its acceptance said it had to land before FAFF-993, which merged first. The inversion is live |
| 6 | **FAFF-939** faff-plot autonomous ignition ordering | S | A literal read mints an orphan run ledger before the refuse branch's zero-writes guarantee fires. Prose-only fix to a published autonomy guarantee |
| 7 | **FAFF-881** sandbox test flakiness trips post-merge verification | M | `post-merge-check` reports `verified-fail` on every shipped issue, so a genuine regression is indistinguishable from standing noise |
| 8 | **FAFF-880** init-interactive downgrade guard is staleness-blind | M | A provably-dead L3 run blocked a real interactive graft; unblocking took five hand-written `record-outcome` calls. Its prerequisite FAFF-889 is Done |
| 9 | **FAFF-983** no sanctioned merge path for a non-graft PR | M | An agent has no honest way to land a docs or ADR PR; the observed workaround was borrowing another ticket's AC checklist |
| 10 | **FAFF-975** inflightcheck owner-scope clobber | M | Two interactive sessions share scope `"local"`, so one session's `--close` wipes a peer's stranded-detection net |
| 11 | **FAFF-982** concurrent L3 runs double-admit the same issue | L | Two runs each burned a complete build of FAFF-980 and left the tracker actively lying. Largest item, ranked last on cost |

Dropped from the queue, with reasons: FAFF-1013 already shipped (`3910417c`); FAFF-740, FAFF-745, FAFF-458 and FAFF-683 carry `faff-automation-hold`; FAFF-931, FAFF-966 and FAFF-969 are parked on real verdicts; FAFF-588 and FAFF-827 are tracker acts, not builds; FAFF-799 and FAFF-991 were closed on 2026-09-06 per section 4a.

For the three parked tickets the unblocking act is cheap and specific: a human ratification comment on the standing objection. FAFF-998 `4a08fcb7` shipped exactly that path. The autonomous unpark FAFF-993 shipped is git-only and will not touch a tracker park.

**Sequencing note for the eval work.** FAFF-1007 and FAFF-931 are the same shape (register a KIND, add cases, thread roughly six files of eval-infra wiring). Build them as one pass. Both should follow FAFF-1002, since their acceptance is "full CI suite green" and they would otherwise hit the same 600-second wall.

## 7. Tracker reconciliation

### Applied 2026-09-06: the mechanical half

Every class below was re-verified against live state before anything was touched, and that re-verification materially corrected this section. Of 68 claimed class members, 51 held; the rest were wrong. The two largest errors were in this document's own favour, and both are recorded rather than quietly fixed:

- **Three of six claimed dead edges were not dead.** FAFF-328 to FAFF-517, FAFF-1010 to FAFF-1011, and FAFF-41 to FAFF-72 all point at live Backlog tickets. The triage misread "deferred by ADR" (FAFF-517, "do not schedule") as terminal. Deferred is not terminal, and those edges are load-bearing.
- **Five of eight claimed plot-label defects were not defects.** FAFF-516 does carry a `V5` anchor, and four others were misread.

**The wider sweep found nearly three times what the claimed list held.** The per-batch agents keyed on recently-touched tickets, so the biggest cluster sat on an older ticket no batch owned.

| Applied | Detail |
|---|---|
| **FAFF-740: seven dead `blockedBy` edges released** | FAFF-732, 734, 735, 739, 741, 742, 743, every one Done on 2026-08-08 or 08-09. FAFF-740 had carried a full blocker set for four weeks while being fully unblocked, and it blocks FAFF-824 (Accept Phase 0B). This dead cluster was stalling a live Gate 1 chain on the graph |
| FAFF-878: one dead edge released | FAFF-907 Done 2026-08-28. Its other blocker FAFF-731 is live and was left alone |
| FAFF-962: one dead edge released | FAFF-961 Done 2026-09-01. Satisfied normally, not bypassed |
| FAFF-827 and FAFF-683: dead `blocks` edges released | Targets FAFF-828 and FAFF-606 both Done. FAFF-827 carries a comment stating the removal is hygiene and explicitly not acceptance of the bypassed gate |
| Four zero-label tickets labelled | FAFF-1019, FAFF-937, FAFF-901, FAFF-902 now carry `faff` plus a type label |

**The zero-label premise was also partly wrong**, and the correction is worth keeping. Those tickets were described as "invisible to every label-filtered sweep including `faff eligible` and the tidy pass". Two of three claims are false: `eligible.js:18-26` is a pure function over labels handed to it, not a sweep, and `faff-tidy/SKILL.md:36` states tidy's scope is every active issue and "never inherits another skill's already-filtered surface". Only the `label:faff` roadmap query genuinely misses them. The real gap is larger and different: of 126 non-terminal issues, 35 lack the `faff` label, and these four were only the zero-label corner of it.

### Not applied, and why

| Class | Verified | Why it is not mechanical |
|---|---|---|
| Prose blockers in ticket bodies | 13 of 13 real | Body edits. After section 5, a body edit gets a higher bar than a relation removal |
| Moved repo-path citations | 6 of 7 real | Body edits. FAFF-745 correctly dropped: `docs/prdr/` is still the shipped product default, not a dead path |
| Never-committed `design/*.md` citations | 5 of 5 real | Three have no successor and need a decision: re-derive the design, or downgrade the ticket to idea capture |
| Contradictory eligibility labels | 7 of 7 real | **Advisory only, by design.** `faff-automate` and `faff-automation-hold` are `tracker_owned: true` in `labels.js`; the CLI refuses them (FAFF-218) and so must any agent. One click each, in the Linear UI |
| Incoherent plot labels | 3 of 8 claimed, plus 6 found | Which label is wrong is a product judgement in most cases |
| Repeat-park thrash | Re-derived from scratch | The original claim was refuted. The true cause is a placeholder backend config (`https://some-where/v1` with `DUMMY_API_KEY`), not rate limits, and it cost six parks across four tickets |

One correction worth acting on: the note that openrouter refs belong under `adversarial.spec_review` rather than `adversarial.spec_judge` is **structurally true but its remedy inverts the design**. Commit `8f026f6f` added `spec_judge.refs` deliberately, with the committed comment "`refs` MUST name a backend NOT in the refuter `refs:` above (a distinct, higher-authority identity)". Moving them would disqualify the judge, which is the exact failure FAFF-966's park recorded. Do not action it as written.

### The original class table


Fifty-five of the 130 live tickets were flagged as needing reconciliation. That is 42 per cent, and it is itself the finding. The flags collapse into classes that can be fixed in sweeps.

| Class | Members | Cost of leaving it |
|---|---|---|
| **Dead `blockedBy` / `blocks` edges at Done or Canceled tickets** | FAFF-827 to Done FAFF-828; FAFF-1007 to Done FAFF-992; FAFF-683 to Done FAFF-606; FAFF-328 to deferred FAFF-517; FAFF-962 to Done FAFF-961; FAFF-1010 to FAFF-1011; FAFF-41 to FAFF-72 | Tickets read blocked and are picked over |
| **Prose blockers with no tracker edge, all now cleared** | FAFF-629, 613, 612, 610, 636, 480, 769, 330, 486, 674, 931, 543 | Eleven of twelve are unblocked today and read as blocked |
| **Dead provenance pointers at tickets cancelled in the 2026-08-19 cull** | FAFF-452 (title ends `(FAFF-413)`), 489 (only relation is Canceled FAFF-37), 388, 13, 450, 879, 773, 612 | Prep hunts a Canceled shell with no successor named |
| **Contradictory eligibility labels: `faff-automate` and `faff-automation-hold` together** | FAFF-412, 602, 610, 611, 674, 745, 769 | `eligible.js:20` silently resolves hold-wins. The operator made a crank-up gesture the runner ignores, with no diagnostic |
| **Incoherent V5 plot labels** | FAFF-629 (`Conditional` and `Required`), 769 (`V5/Required/Phase 0` on routine maintenance), 516 and 862 (phase label, no `V5` anchor), 790 (`V5/Required`, no phase), 412 and 800 (orphan `Optional`), 855 (`Human-task` on a code fix) | Six of twelve V5-labelled tickets have a coherence defect, in the classification the roadmap is keyed off |
| **Citations to repo paths moved by FAFF-754** | FAFF-740, 688, 330, 460, 674, 506, 745 | Four are inside a DoD or acceptance criterion. A build agent that follows them literally ships a file nothing reads |
| **Citations to `design/*.md` files never committed** | FAFF-360, 13, 506, 390, 15 | FAFF-506 has recorded its own missing prerequisite since 2026-07-14 and cycled Backlog to Todo to In Progress to Todo to Backlog without it being resolved |
| **Repeat-park thrash on one shared cause** | FAFF-931, 966, 969 | Nine autonomous prep passes burned on one config fault: primary `spark-qwen-3-8` host unresolvable, fallback returning `content: null`. Owner is FAFF-855, itself mis-triaged |
| **Superseded but unlinked** | FAFF-946, 543, 73, 316 | No `duplicateOf` edge to the ticket that shipped the outcome |
| **Zero-label tickets** | FAFF-946, 991, 937, 901, 902 | Invisible to every label-filtered sweep including `faff eligible`. FAFF-901 is B1-now |
| **Un-homed backlog** | 54 of 130 have no project | With no container, every field has to be carried per ticket, and each carried field is a place drift starts |

**Suggested sweep order.** Each shrinks the next, and steps 1 to 6 need no product judgement.

1. Dead edges plus prose blockers together. This alone unblocks twelve tickets including FAFF-740 on the Gate 1 spine.
2. Remove `paused` from FAFF-588 and FAFF-740. With step 1 done the Phase 0B gate is genuinely reachable.
3. Repair the `.faffrc` adversarial chain, then bulk-unpark FAFF-931, 966, 969. Note the operator's own finding on FAFF-969: the openrouter refs were added under `adversarial.spec_judge`, not `adversarial.spec_review`, so the `spec_review` consumer still falls back to the broken chain.
4. Label edits: eligibility contradictions, the plot-label schema, the five zero-label tickets.
5. Path and design-doc citations.
6. Close the superseded, sever the dead pointers.
7. The structural re-home (section 8) and the ADR-0114 versus FAFF-517 decision.

One product improvement falls out of class four: `faff eligible` should emit a contradiction diagnostic rather than silently resolving hold-wins. The current behaviour hides the operator's own mistake from the operator, which is the fail-quiet class faff exists to eliminate.

## 8. Project structure

### Applied 2026-09-06: two retirements, and this section largely did not survive verification

A five-lens survey re-derived the project graph from live data before anything was touched. **Most of what this section claimed was wrong**, and the corrections matter more than the two edits that survived.

**Applied.** Two projects retired to Completed, both `*Planned by /faff-plot, 2026-07-14.*` so the human-curated floor does not apply, both drained with zero live members, both with their stated done-signal met, and a status move preserves the description so nothing is lost:

- *Self-starting plans, the run decides when to plan and when the PRD is covered*. Four members Done, including FAFF-499, its own whole-loop proof.
- *Top of the loop, an admissible PRD becomes a drainable backlog, unattended*. Seven members Done, including FAFF-492, its named capture record.

### What the survey corrected

| This section claimed | Live data |
|---|---|
| ~15 In Progress projects | **20.** The earlier figure was a page-one-only read. 71 projects total, 1,018 issues, 126 non-terminal |
| 13 thematic shells hold live work | **24 projects hold live work, at least 17 thematic.** The collapse plan named 13 and said nothing about the rest |
| Moving *Faff learns from being run* to Backlog "correctly re-bands eight tickets in one edit" | **False, and self-undoing.** Nothing derives a band or eligibility from project status: `eligible.js:19` is a pure function of labels, `automation_default` and tracker presence, and `next.js:34` reads the issue's status, not the project's. Worse, `faff project-next --current planned --total 26 --active 0 --done 18` returns `advance / started`, and tidy applies that without prompting. The edit undoes itself on the next tidy pass. It is also seven tickets, not eight |
| FAFF-450's park governs the other seven tickets | **Overstated.** It governs FAFF-450 and reaches FAFF-451 and FAFF-453 through blocker edges. Only FAFF-450 carries `faff-parked`. Five of eight are not covered |
| Pause *Unbundling* behind Gate 2 | **Gate 2 does not exist.** The tracker holds only FAFF-832 (Gate 1) and no faff project carries any milestone. A pause behind an unrepresented gate has no exit condition |
| Five drained shells | **Twelve are drained**, but only two or three are safe to act on. T4 and *Faff is portable* hit the human-curated floor; *SuperDomestique and Commissaire coexist* is drained but its outcome was never shaped, so retiring it closes something never delivered |
| Collapse the routing shells into one outcome | **They do not converge.** Four written decisions say the split is deliberate, including *Cost-aware model and transport routing*: "This project provides the static, configurable levers; the sibling project makes them adaptive. Distinct outcomes." The real split is a rate lever and a volume lever |

### The human-curated-structure floor, now established

The methodology says only faff-authored topology may be restructured directly; human-curated structure stays propose-and-confirm. That determination had never been made, so every proposal in this section was ungated. It now is, and two findings are worth keeping:

- **The V5 projects created on 2026-08-16 were not authored by `/faff-plot`.** None carries the provenance line, none uses plot's container template, the epics were created 27 minutes *before* their own containers (inverting plot's top-down order), and they have no `.faff/provenance` records. The pass that did produce plot-authored outcome projects ran on 2026-08-07 and stamped every one.
- **Linear's `creator` field is useless for this.** Every project and initiative in the workspace reads `alec@shftwst.dev`, including ones proven by log-and-id match to be plot output, because faff writes through the operator's token. Reading authorship from it returns "all human" and would freeze the entire tracker.

A warning recorded by the same lens: do not stamp `planned by /faff-plot` onto unmarked projects to close the gap. That would fabricate the evidence the floor depends on and permanently convert human-curated structure into apparently-actionable topology.

### The original proposal


Twenty projects are In Progress. Under the agile-delivery lens a project grouped by capability, layer or theme rather than by a shippable outcome is a structural-category error: you cannot sequence inside it, because "done" for the project is undefined.

**Five are drained.** Every member ticket is Done. Retiring them moves no live work: *SuperDomestique and Commissaire coexist without ambiguity* (FAFF-738), *T4 affidavits become attestations* (9 of 9), *Self-starting plans* (4 of 4), *Top of the loop* (7 of 7), *Faff is portable* (FAFF-430). Seven more empty containers sit in Backlog status.

**Two keep their shape.** *Outward L4 evidence is reproducible and honestly bounded* (7 live) and *A current unattended run survives executor loss at safe boundaries* (6 live) are outcome-shaped and map to v5 Phase 0A and 0B. They are the only two whose name states a condition you can observe becoming true.

**Thirteen shells hold work and should be re-homed, not retired.** Four containers per outcome is the recurring shape, and it is why 41 per cent of tickets ended up in none of them.

| Outcome | Collapse these | Tickets |
|---|---|---|
| The loop runs under a harness that is not Claude Code | Harness portability L2/L3 anywhere; Harness-agnostic runtime; Run faff on other harnesses; Harness portability claims match demonstrated support | 613, 650, 674, 697, 773, 879, plus 480 which is currently misfiled |
| Judgement quality is measured, not assumed | Skill-behaviour harness; Eval cases graded against a real local model in CI | 636, 637, 638, 688, 693, 731, 878, 167, 168 |
| Routing decides on measured cost and quality | Cost-aware model and transport routing; Outcome-based routing; Tracker access is token-cheap; Skill prompts are lean | 423, 501, 452, 458, 459, 460, 461, 176, 177, 119, 419, 486 |
| Not In Progress at all | Faff learns from being run | 13, 28, 393, 449, 450, 451, 453, 454. Its root ticket FAFF-450 carries an explicit human park: "Automated self-learning is not a current product priority". Moving the project to Backlog correctly re-bands eight tickets in one edit |
| Paused behind Gate 2 | Unbundling: evidence, checks, lints | 602, 610, 611. Packaging and marketplace work, which FAFF-829's own gate text says it does not authorise |

Three pre-v5 shells hold one straggler each: *T5 proven in anger* (FAFF-316), *T3 supervision stands alone* (FAFF-328), *Graft evidence is tamper-evident end-to-end* (FAFF-517). T0, T1 and T2 are Completed and T4 is drained, so the T-series is one straggler from extinction. Fold the three into the two surviving v5 outcome projects.

Net: 20 In-Progress projects becomes 7, and the 54 un-homed tickets get somewhere to land.

## 9. Two findings that are not tickets yet

**The unowned corpus.** FAFF-974 cannot be accepted because the coordination-fidelity corpus is empty, and no live ticket owns filling it. FAFF-949 owned it and closed Done having only enabled the capture flag. Either file the collection ticket or record on FAFF-974 that the coordination question will be answered "insufficient evidence", which master v5 explicitly permits.

**Split-and-orphan.** faff splits a ticket, builds the halves, and never closes the parent or the sibling whose code rode along in the other half's PR. Three confirmed instances in 35 days: FAFF-991, FAFF-946, FAFF-920. FAFF-920's code landed in FAFF-918's own commit on the day it was filed. This is a repeatable defect in the split-and-close loop, not three coincidences.

Both are `/faff-jot` candidates. Neither was filed by this pass, which was read-only.

## 10. How to act on this

Read this section before touching the tracker.

**Re-verify first.** This is a 2026-09-06 snapshot of a backlog moving at roughly seven merged tickets a day. Regenerate the live set before admitting anything, exactly as carry-forward v2's own exit test instructs. FAFF-1013 shipped mid-pass and FAFF-1015, FAFF-1016 and FAFF-1017 were filed after it and are unassessed.

**Verify against `origin/main`, never the worktree.** The local branch was 20 commits behind during this pass. A naive `git log --grep` on a stale checkout reads shipped work as unbuilt.

**Order of operations.**

1. Apply section 7's sweep steps 1 to 3. These are mechanical, need no product judgement, and unblock the Gate 1 spine.
2. Applied 2026-09-06: the seven closures in section 4a are done, with their preconditions executed first (FAFF-542 carries FAFF-543's rejection reasoning, FAFF-800 carries FAFF-799's incident record, and the FAFF-799 blocks-edge was released before the close).
3. Applied 2026-09-06: FAFF-611 was adjudicated and held rather than cancelled, per section 4b.
4. Applied 2026-09-06: all 14 section 5 tickets carry a stale-as-written notice, so a prep pass is warned before it reads the body. The re-cut itself is deliberately left to prep time, with the verified residual and the audit's dropped-scope findings recorded in each ticket's comment. Do not rewrite a body from the drafts alone: 13 of 14 dropped live scope.
5. Narrow FAFF-827 per section 2 and run the post-hoc extraction-safety check against what shipped.
6. Applied 2026-09-06: FAFF-991 was closed Done rather than left ranked B1-now. No action outstanding.
7. File the two gaps in section 9.
8. Apply section 8's project changes last, since re-homing is easiest once the dead edges are gone.

**What this pass deliberately did not do.** It did not reopen the 2026-09-04 delivery decision to pause the V5 evidence ceremony. It did not rewrite a single ticket body. It did not manufacture cancellations to hit a rate: sixteen were proposed, fourteen were adversarially overturned, and the two that survived were joined by five more found by later sweeps the per-batch agents could not run.

**Tracker writes made on 2026-09-06.** Seven closures (FAFF-991 and FAFF-946 Done; FAFF-920, 22, 543, 649, 799 Cancelled), one relation released (FAFF-799 blocks FAFF-800), one description edit (FAFF-542, carrying FAFF-543's rejection grounds), and 16 comments (7 closing comments, the FAFF-800 inheritance note, and 14 stale-as-written notices, two of which landed on tickets that also received one of the other kinds). Everything else in this document remains proposed.

## 11. Live-set disposition index

Every live ticket appears once. `Unlock` is 1 to 5, how much other work it releases. `Cost` is S, M, L, XL. `recon` means the tracker record must be repaired before admission. `cancel-overturned` means a cancellation was proposed and adversarially rejected, so the ticket carries a stale-scope risk even though it survives.

### B1 now (20)

| Ticket | v5 tag | Unlock | Cost | Flags | Title |
|---|---|---:|---|---|---|
| FAFF-458 | P1-fidelity | 4 | M | recon | Routing-decision telemetry — record the arm per issue + join it to the outcome |
| FAFF-740 | P0B-evidence | 4 | L | recon | Connect every public claim to its evidence |
| FAFF-745 | P0B-evidence | 4 | M | recon | `faff-plot` publishes accepted PRDR branches |
| FAFF-827 | P1-map | 4 | M | recon | Accept Phase 1 extraction and cutover evidence |
| FAFF-931 | P0B-evidence | 4 | M | recon | Spec-review judge: register the LLM-judgement eval seam (grader KIND + eval case + registry row |
| FAFF-1002 | RUNNER-DEFECT | 4 | M | - | Local `faff gates run` UNIT rung is a >600s monolith — shard the local rung too |
| FAFF-880 | P0A-recovery | 3 | M | - | init-interactive downgrade guard is staleness-blind: a crashed L3 run blocks a fresh interactiv |
| FAFF-881 | RUNNER-DEFECT | 3 | M | - | Sandbox test-suite flakiness trips post-merge verification every run |
| FAFF-901 | P0A-recovery | 3 | S | - | Harden bundle.js git spawnSync calls against network hang (repo-wide) |
| FAFF-966 | P0A-recovery | 3 | M | - | beep-boop dispatches a build lane with no events.jsonl genesis; merge-gate anchor fails |
| FAFF-982 | RUNNER-DEFECT | 3 | L | - | Concurrent L3 runs double-admit the same issue; loser's tracker park not reconciled on reclaim |
| FAFF-983 | RUNNER-DEFECT | 3 | M | - | No sanctioned merge path for a non-graft (docs / ADR / governance) PR |
| FAFF-1007 | RUNNER-DEFECT | 3 | M | recon | park-reconsider-classification grader: eval cases + case-backed wiring (FAFF-992 follow-up) |
| FAFF-683 | n/a | 2 | S | recon,cancel-overturned | Cron reference workflow: decide the target repo and the §0a-on-resume rule |
| FAFF-939 | RUNNER-DEFECT | 2 | S | - | faff-plot --autonomous ignition: gate the standalone self-mint on a non-refuse run-start verdic |
| FAFF-969 | RUNNER-DEFECT | 2 | M | recon | Split adr.mode: ADR recording unconditional, dial only supersession |
| FAFF-975 | RUNNER-DEFECT | 2 | M | - | faff inflightcheck: two interactive sessions share owner-scope "local" and clobber each other's |
| FAFF-985 | RUNNER-DEFECT | 2 | S | - | Adversarial review deadline exceeds heartbeat/turn window — Phase-2 never runs in a foreground  |
| FAFF-997 | RUNNER-DEFECT | 2 | S | - | regions selftest driver discards a failing member's output — undiagnosable CI |
| FAFF-588 | n/a | 1 | S | cancel-overturned | Commit external-verification results in-repo |

### B2 next (25)

| Ticket | v5 tag | Unlock | Cost | Flags | Title |
|---|---|---:|---|---|---|
| FAFF-360 | P2A-commissaire | 4 | L | recon | Second-consumer demo — bare Claude Code + governance layer on a non-faff repo |
| FAFF-829 | GATE-accept | 4 | M | recon | Accept the Phase 2A external Commissaire proof |
| FAFF-176 | ROUTINE | 3 | S | - | Compare 3rd-party Linear-compatible CLI coverage against the logged call set |
| FAFF-328 | GATE-accept | 3 | M | recon | Live-run validation of Channel A corrective authority |
| FAFF-731 | P0B-evidence | 3 | M | recon | Eval refutation-spec: fan a case into four independent lens passes instead of one collapsed pro |
| FAFF-824 | P0B-evidence | 3 | M | recon | Accept Phase 0B outward evidence baseline |
| FAFF-855 | RUNNER-DEFECT | 3 | M | recon | Spec-review lens fan-out 429s the free-tier adversarial backends, cap per-backend concurrency o |
| FAFF-962 | P0B-evidence | 3 | L | - | not-yet-reachable verification tier + deferred-with-obligation carrier (project PRD-coverage) |
| FAFF-974 | GATE-accept | 3 | S | recon | Accept Phase 1 coordination-fidelity evidence for Gate 1 |
| FAFF-996 | RUNNER-DEFECT | 3 | L | - | Autonomous adjudication of a build-review critical — bounded reviewer↔author round-trip + judge |
| FAFF-1010 | RUNNER-DEFECT | 3 | L | recon | Harden spec/code-review prompting to shrink reviewer output and prevent truncated/empty respons |
| FAFF-316 | P0B-evidence | 2 | M | recon | Frontier adversarial audit of the L4 trust-critical gates (residual) |
| FAFF-674 | P0B-evidence | 2 | S | recon | A repo-local faff install is invisible to codex too |
| FAFF-693 | P0B-evidence | 2 | M | recon | Widen the single- and two-case eval fixtures for grouping, resolved-elsewhere, holdout-exercise |
| FAFF-790 | P0B-evidence | 2 | S | - | Proof: topologically-separated evaluator on an ephemeral Fly machine (reference, not framework) |
| FAFF-800 | P0A-recovery | 2 | M | recon | Runner targeted drains admit orphaned In Progress work once the claim is verifiably stale |
| FAFF-862 | P0B-evidence | 2 | M | - | Post-merge audit-heal — backfill merge-record.json on an unsanctioned UI merge |
| FAFF-866 | RUNNER-DEFECT | 2 | S | - | Flaky test: sentry-poller andon-pump (FAFF-472) times out under CI load |
| FAFF-902 | RUNNER-DEFECT | 2 | S | - | Spike: version/build handshake for L4 guardrail preflight (stale-backing-module residual) |
| FAFF-925 | RUNNER-DEFECT | 2 | S | recon | Six pre-existing sandbox test failures pollute every build's local gate ladder |
| FAFF-933 | P1-fidelity | 2 | M | recon | Run ledger/economics under-reports a resumed run's cost (drops earlier epochs) |
| FAFF-937 | P0B-evidence | 2 | M | - | Eval sweep + baseline accept for the FAFF-936 PRD-goals refuter deferral (fixtures 015/016) |
| FAFF-1003 | RUNNER-DEFECT | 2 | M | - | Interactive entry point for the spec-review judge — adjudicate parked specs' standing objection |
| FAFF-1006 | RUNNER-DEFECT | 2 | S | - | spec-review/code-review outage-hold cap: add a `never` value (hold-and-retry a transient outage |
| FAFF-688 | ROUTINE | 1 | S | recon | Record the two-flip worst case in the grouping control band |

### B3 later (41)

| Ticket | v5 tag | Unlock | Cost | Flags | Title |
|---|---|---:|---|---|---|
| FAFF-832 | GATE-accept | 5 | S | - | Gate 1: decide governance value and coordination value independently |
| FAFF-830 | P2B-comparison | 4 | XL | - | Run the matched governed-execution and strong one-shot comparison |
| FAFF-459 | OFF-ROADMAP | 3 | M | - | Shared learned.yaml carrier — committed learned-config layer under the ratchet |
| FAFF-460 | OFF-ROADMAP | 3 | M | recon | Recommender + promotion gate — faff routing recommend (read-only) |
| FAFF-831 | GATE-accept | 3 | S | - | Accept the Phase 2B controlled-comparison evidence |
| FAFF-104 | OFF-ROADMAP | 2 | L | recon | Secret-store / injection mechanism — producer behind the lane→secret matrix |
| FAFF-128 | OFF-ROADMAP | 2 | M | recon | Methodology consumes grounding as an advisory datapoint (never an override) |
| FAFF-167 | OFF-ROADMAP | 2 | M | - | Eval-in-CI: in-runner tiny-model smoke + nightly Tailscale-27B lanes (never hit real Claude) |
| FAFF-168 | OFF-ROADMAP | 2 | M | recon | Productionise the local-LLM plumbing smoke lane — drive the real tidy prose |
| FAFF-177 | ROUTINE | 2 | L | - | Swap Linear MCP for a Linear-compatible CLI in faff's tracker access |
| FAFF-451 | OFF-ROADMAP | 2 | M | recon | Repo-map carrier for prep — a committed conventions/repo-map doc prep consults and proposes upd |
| FAFF-486 | OFF-ROADMAP | 2 | M | recon | Context lifetime reduction — subagent isolation, compaction cadence, tokens-not-transcripts |
| FAFF-516 | P0B-evidence | 2 | S | recon | Decide the FAFF_INTEGRITY_BOUNDARY attestation channel for --init engine cages |
| FAFF-542 | OFF-ROADMAP | 2 | M | - | [claude-box] Cage must involuntarily git-checkpoint the build worktree on an interval |
| FAFF-636 | OFF-ROADMAP | 2 | S | recon | Cross-model eval comparison: read-only Sonnet run + per-kind diff script |
| FAFF-637 | OFF-ROADMAP | 2 | M | - | Per-kind model-tier crank-down: route each judgement kind by its delta |
| FAFF-650 | RUNNER-DEFECT | 2 | M | recon | Concurrent claude-box instances stop clobbering each other's state (external dependency) |
| FAFF-726 | OFF-ROADMAP | 2 | M | - | Spike: is a fly Sprite a viable faff runner substrate (admission gate? cost?) |
| FAFF-769 | ROUTINE | 2 | M | recon | Strip literal operational paths from SKILL.md + enforce the no-literal-path lint |
| FAFF-773 | OFF-ROADMAP | 2 | S | - | Accept harness-native model identifiers across in-harness model lanes |
| FAFF-878 | P0B-evidence | 2 | M | - | Recalibrate refutation-spec after the four-lens eval matches production |
| FAFF-33 | n/a | 1 | S | cancel-overturned | Cache-vs-rebuild policy for twins / datasets / provisioned envs |
| FAFF-41 | OFF-ROADMAP | 1 | M | recon | Adversarial build-stage behaviour — what the breaking member concretely runs |
| FAFF-71 | n/a | 1 | M | cancel-overturned | Reconcile the four roles with the lane model + capability→role binding |
| FAFF-74 | ROUTINE | 1 | M | recon | Vocabulary migration — slot → capability / step / skill / strategy |
| FAFF-249 | n/a | 1 | S | cancel-overturned | Methodology lineup: structural baseline, agile default, waterfall demoted; critical-path & Shap |
| FAFF-388 | OFF-ROADMAP | 1 | M | recon | Data-migration policy — a defined, enforced change-class for autonomous schema migrations |
| FAFF-412 | ROUTINE | 1 | M | recon | Configurable first-pass code-review model — senior same-family review lane |
| FAFF-480 | OFF-ROADMAP | 1 | M | recon | Route the eval lane (models.eval / eval driver) to another harness / external model |
| FAFF-489 | OFF-ROADMAP | 1 | L | - | Auto-revert mechanics for a post-merge verification failure (FAFF-385 seam b) |
| FAFF-506 | P0B-evidence | 1 | M | recon | Add B9 (real external tracker via GitHub Issues) to the external-verification behaviours rubric |
| FAFF-613 | OFF-ROADMAP | 1 | M | recon | B10 harness-portability behaviour in the external-verification rubric + codex run |
| FAFF-629 | P0B-evidence | 1 | XL | recon | Holdout error-rate production run — live agentic lane (the honest end-to-end sensitivity number |
| FAFF-638 | OFF-ROADMAP | 1 | M | - | Per-kind model tagging in baseline lineage for heterogeneous gating |
| FAFF-653 | OFF-ROADMAP | 1 | M | - | A one-shot cage launch costs seconds, not tens of seconds (external dependency) |
| FAFF-851 | P0B-evidence | 1 | M | - | Fly 6PN substrate branch in faffter-noon-transport-private-network (cross-machine transport ins |
| FAFF-879 | OFF-ROADMAP | 1 | M | - | Add Codex CLI as a one-shot adversarial-review backend |
| FAFF-921 | ROUTINE | 1 | S | - | Strip model boundary/control tokens from OpenAI-compatible adversarial-review content (generic, |
| FAFF-955 | RUNNER-DEFECT | 1 | S | - | Spec-review approve integrity: session-end Stop-hook backstop (audit that a retained approve ha |
| FAFF-988 | ROUTINE | 1 | S | - | Add a positive tail-lock assertion for the review-verdict gateway slice boundary |
| FAFF-1014 | ROUTINE | 1 | S | - | Make the capture-wiring lint order-aware (require decide --export before the consult) |

### B4 held (35)

| Ticket | v5 tag | Unlock | Cost | Flags | Title |
|---|---|---:|---|---|---|
| FAFF-70 | P5-product | 3 | M | - | Capability + step + invocation config schema |
| FAFF-72 | P5-product | 3 | L | - | Resolution + validation in the loader |
| FAFF-450 | OFF-ROADMAP | 3 | L | - | Retrospective synthesis engine — micro + batch retro that authors learning proposals (folds FAF |
| FAFF-13 | OFF-ROADMAP | 2 | XL | recon | Self-improvement & tailoring — what faff learns from being run (single- and cross-project) |
| FAFF-15 | P4-second-use | 2 | L | recon | Tracker inference — infer the board's real statuses/hierarchy/labels (input-side tracker_adapto |
| FAFF-20 | OFF-ROADMAP | 2 | L | - | Release-increment grouping & sequencing — order shippable value-increments (agile, opt-in) |
| FAFF-73 | n/a | 2 | M | cancel-overturned | Isolation as a first-class declared field |
| FAFF-330 | OFF-ROADMAP | 2 | M | recon | Thin local-docs/ADRs grounding occupant — first optional occupant |
| FAFF-419 | OFF-ROADMAP | 2 | L | recon | Context-volume reduction — action the 85% cost lever (trim MCP payloads + context lifetime) |
| FAFF-423 | OFF-ROADMAP | 2 | L | recon | Local-engine lane values v2 — agentic-loop transport for tool-needing producers |
| FAFF-449 | OFF-ROADMAP | 2 | M | - | Calibration Class-1 loop — auto appetite-pin on the repeat-park threshold (learned.yaml) |
| FAFF-452 | OFF-ROADMAP | 2 | XL | recon | Outcome-based routing — route model/transport/harness on observed cost·quality |
| FAFF-517 | OFF-ROADMAP | 2 | L | recon | Lane-launcher read-only-mounts the integrity dirs + FAFF_INTEGRITY_BOUNDARY attest |
| FAFF-528 | OFF-ROADMAP | 2 | M | - | PRD-authoring DX — an assisted loop to reach an admissible PRD |
| FAFF-612 | OFF-ROADMAP | 2 | L | recon | Matrix build-fleet mode — per-issue dispatched jobs with digest-custody over artifacts |
| FAFF-729 | P5-product | 2 | S | - | Decide faff's external distribution strategy across its packagable parts |
| FAFF-25 | OFF-ROADMAP | 1 | L | - | Consolidate adversarial/oblivious occupants onto the strategy mechanism |
| FAFF-28 | OFF-ROADMAP | 1 | M | - | Build-vs-buy decisioning under no-self-provision (+ human procurement escalation) |
| FAFF-29 | n/a | 1 | S | cancel-overturned | Local-first running of complex multi-service systems on factory-controlled compute |
| FAFF-39 | OFF-ROADMAP | 1 | M | - | Release scheduling policy — automated cut vs methodology-determined value chunks |
| FAFF-75 | P5-product | 1 | S | - | Skill-as-shell — config/skill-body boundary, skill tiers, cross-cutting placement |
| FAFF-119 | OFF-ROADMAP | 1 | S | recon | Caching-friendly prompt ordering + documented convention |
| FAFF-331 | OFF-ROADMAP | 1 | S | - | Wire pick-ordering to grounding (follow-up to FAFF-128 v1) |
| FAFF-389 | P5-product | 1 | L | - | Multi-repo delivery — design-settle a factory spanning repos / cross-repo changes |
| FAFF-390 | P5-product | 1 | M | recon | Team identity model — who initiated, owns, and is authorized (design for team-mode) |
| FAFF-393 | n/a | 1 | S | cancel-overturned | Incident → postmortem loop — detection to incident record to root-cause to learning input |
| FAFF-453 | OFF-ROADMAP | 1 | L | recon | Verification & product-self capital — incidents→eval fixtures + faff files improvement tickets  |
| FAFF-454 | OFF-ROADMAP | 1 | M | - | Cross-project seeding — ~/.faff/priors schema-allowlist → onboard writes learned defaults into  |
| FAFF-461 | OFF-ROADMAP | 1 | L | - | Supervised-window graduation — admit Class-1 auto-revert after a measured window (fail-safe dir |
| FAFF-501 | OFF-ROADMAP | 1 | L | - | Validate the grounding-at-prep cost hypothesis — A/B + observational study |
| FAFF-509 | OFF-ROADMAP | 1 | M | - | RFC: capture & persist far-future ideas outside the tracker |
| FAFF-602 | n/a | 1 | L | cancel-overturned | skill-lint — extract validate-adapters' generic checks as a linter for the Agent Skills open st |
| FAFF-610 | P5-product | 1 | L | recon | governance-check as a standalone marketplace Action consuming the Agent Delivery Evidence spec |
| FAFF-697 | OFF-ROADMAP | 1 | S | recon | Provider safety posture blocked faff's adversarial/security work under codex |
| FAFF-1011 | OFF-ROADMAP | 1 | M | recon | Instrument faff's review LLM calls through agentgateway → langfuse for request/response observa |

### Closed 2026-09-06 (7)

| Ticket | Closed as | Title |
|---|---|---|
| FAFF-991 | Done | L4 lights-out has no autonomous re-entry for a needs-human park; resume skips parks |
| FAFF-946 | Done | Durable spec-review judgement audit trail + flip L4 to full judge-trust |
| FAFF-920 | Cancelled | review-bench: support --thinking-token-budget so the reasoning-budget lever is tunable on the bench |
| FAFF-22 | Cancelled | Fused provider-wrapper authoring mode (faffter-dark-authoring-adaptors) |
| FAFF-543 | Cancelled | [claude-box] Build worktree lives in container-local ~/.faff and dies with the container |
| FAFF-649 | Cancelled | A claude-box image that passes the CI admission criteria — one worked cage |
| FAFF-799 | Cancelled | Establish why FAFF-757's active machine claim carried no faff-claimed label |

### Held, not closed (1)

- FAFF-611 multi-package release-please config for extracted units. Left in Backlog behind the package-extraction decision. See section 4b.

### Shipped during the pass (1)

- FAFF-1013 merge-gate defaults to execute (the irreversible merge) when no mode flag is given (merged as `3910417c`, PR #872)

### Filed after the pull, unassessed (3)

- FAFF-1015, FAFF-1016, FAFF-1017. All Backlog, all Commissaire-facade follow-ups. Triage them before the next admission round.

**Total: 130 classified, of which 7 are now closed, plus 3 unassessed.**

---

## Addendum, 2026-09-11

### FAFF-740 narrowed, 2026-09-07

Out of sequence with the rest of section 5, because the operator asked for this one ticket specifically. Read against `origin/main` at `84f378dc`.

FAFF-740 was the highest-value find in the whole pass: seven dead `blockedBy` edges, every blocker Done since August, on the one ticket standing between the repo and FAFF-824 (Accept Phase 0B). Releasing the edges was not enough, because its substance had also moved:

- The seven upstreams delivered about half of its original five clauses. **FAFF-659, never a declared blocker, closed two of them outright** on 2026-08-11 (broken-link detection and site navigation).
- The substrate it was written to extend has decayed. FAFF-732's claim ledger pins `source_commit` to `5120f548`, which predates every one of its own upstreams; three of its evidence pointers now name paths FAFF-754 deleted, and every README source anchor was killed by FAFF-739's rewrite the next day.
- **CI cannot see any of that.** The validator reads through `git show <source_commit>:<path>` and never touches the working tree, so `test/public-trust-claims.test.mjs` passes and will keep passing. `README.md` sends public readers to an audit that CI reports as clean while three of its pointers name deleted files.

The ticket was re-titled **"Connect the Phase 0 release claims to live evidence"** and narrowed to four verified defects plus five deterministic build items, per carry-forward v2's split-or-narrow instruction. Nine remainder items (R1 to R9) are named precisely enough to file and none blocks Phase 0. The standing `reject-approach` verdict is kept standing rather than discharged: three of its six objections are gone, but that is an argument, not a review, so a fresh spec and a fresh adversarial review gate any build.

Two corrections to this document fell out of it. FAFF-743 and FAFF-734 went Done on 2026-08-18 and 08-19, not 08-08/09 as section 7 said, so "all seven within days" was wrong for two of them. And section 7's path-citation class mapped `docs/evidence/**` to a root-level `evidence/`, which does not exist; the real target is `verification/evidence/`. That wrong mapping was never applied, because the body edits were deferred.

The same pattern held as in section 5: the first draft over-claimed delivery twice (inventing an artefact reverse index that does not exist) and dropped three items including the source-text drift oracle. The audit produced twelve fixes, and the fix-applier correctly overrode one of them on a miscount.

### What moved between 2026-09-07 and 2026-09-11

Verified on `origin/main` `a216aba4` and the live tracker. Every change this pass made is intact.

| Movement | Note |
|---|---|
| **FAFF-1022 Done** | Collects the pre-fix decision-capture pilot corpus for FAFF-826. This closes one of the two gaps section 9 recorded as owned by nothing |
| **FAFF-1021 filed** | "Run the already-shipped / premise-superseded scan in interactive prep, not just autonomous". This is the stale-as-written class of section 5 turned into a mechanism rather than a one-off sweep |
| **FAFF-1018 In Review**, split into FAFF-1029 and FAFF-1030 | The Gate 1 spine head is moving. FAFF-1018 blocks FAFF-829 |
| **FAFF-1024 to FAFF-1028 filed** | Five V5 trust defects from a governance audit: delegation unenforceable, effects check blind to off-ledger effects, sentry consults leaving no audit event, turncheck accepting a self-declared disposition, record-outcome terminating a live drain owner. More consequential than anything this triage surfaced |

All seven human acceptance gates remain Backlog and `paused`. The 2026-09-04 delivery decision still governs.

### Still open from this pass

1. **Seven eligibility-label contradictions** (FAFF-412, 602, 610, 611, 674, 745, 769) carry both `faff-automate` and `faff-automation-hold`. Hold wins silently, so the operator's crank-up gesture is ignored with no diagnostic. Both labels are `tracker_owned`, so this is a tracker-UI action only.
2. **Section 7 body edits**: 13 prose blockers naming closed blockers, 6 moved-path citations, 5 never-committed `design/*.md` citations. Deferred deliberately after the section 5 result.
3. **Section 8 re-homing**: 17 thematic shells and 10 further drained projects. Most of the original plan was refuted; the remainder needs operator decisions.
4. **FAFF-740's R1 to R9** are unfiled.
5. **FAFF-22's wrapper-maintenance caveat** is preserved in its closing comment and still wants a home in `docs/guide/skills.md`.
6. **FAFF-1015, FAFF-1016, FAFF-1017** were filed after the pull and have never been triaged.
7. **Two unfiled jots**: the split-and-orphan defect (a parent splits, both halves ship, the parent is never closed, three instances in 35 days), and the absence of any merge-time "which live tickets does this diff invalidate?" step.
