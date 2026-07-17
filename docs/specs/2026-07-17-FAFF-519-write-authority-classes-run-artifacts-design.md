# Spec — FAFF-519: Write-authority classes for run artifacts

> Spec: faffter-dark-nlspec · 2026-07-17 · interactive · confidence: high. Full spec on Linear FAFF-519.

Decision-spike spec for FAFF-519 (timebox: half a day, no feature build). Audience: the build agent that lands the ruling as prose/ADR, and human reviewers ratifying the architecture call. The deliverable of the build is the **ruling landed** — an ADR, a gateway shared-rule paragraph, a mis-cite correction, and follow-up tickets for the write-site moves the ruling mandates. No write site is relocated in this ticket.

## 1. WHY — Problem and Principles

**The load-bearing model:** trust in a run artifact comes from *who could have written it*, not from what it says — so every `.faff/runs/<id>/` artifact needs an explicit write-authority class, and anything a merge/corrective gate later consumes ("evidence") must be written from the trusted side of the orchestrator→lane dispatch cut, with untrusted lanes returning data for the dispatcher to persist. Artifacts that only aid liveness or resume ("sensor/resume") stay lane-writable, because a dead subagent must leave them behind and a live one must tick them mid-flight.

**Problem statement.** The digest evidence set is already single-sourced (`correctiveIntegrityDirs()`, `plugin/skills/faff/bin/lib/corrective-integrity.js:157`) and declared read-only-to-lanes via `FAFF_INTEGRITY_BOUNDARY` — yet the build lane itself currently writes three of its members (`<issue>/ac-checklist.json`, `<issue>/review-verdict.json`, and the per-issue-gate copy of `<issue>/holdout.json`): the declared forge surface and the actual write sites contradict each other. FAFF-520 (executor digest bracketing) is blocked until the freeze-set semantics are ruled, and FAFF-518's verify code already forward-references "the FAFF-519 write-authority split" (`integrity-digest.js:115`). This spike rules the classes so the contradiction is named debt with a decided direction, not an ambient inconsistency.

**Design principles:**

- **The judged party never writes its own verdict artifact.** This is the shipped FAFF-384 precedent: the *spawner* of the caged evaluator derives `code_blind` and writes `holdout.json`; the inner evaluator never does (`faff-beep-boop/SKILL.md:285`). The ruling generalises that pattern; an implementation that lets the build lane keep authoring gate evidence in an enforced-cut world must be rejected.
- **Detection and prevention are separate authorities, honestly labelled.** The custody digest (`digest-verified`) and the mount assertion (`asserted`) never conflate (ADR-0061/ADR-0074; `integrity-digest.js` header). The class split serves both: it defines what the ro-mount covers *and* what the digest bracket may expect to stay frozen.
- **Rung-0 is a legitimate posture, not an error.** Today's single-session runs (ADR-0073) have no cage; unasserted degrades per consumer (`integrityGate`: corrective→channel-D, detection→reconcile-only, merge-floor→level-branched). The ruling must not break rung-0 operation.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | `correctiveIntegrityDirs()` — the single-sourced evidence roster; probe/gate |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | FAFF-518 custody digest; events.jsonl prefix rule (L114–115, L129–132) |
| `plugin/skills/faff/bin/lib/merge-gate.js` | `writeMergeRecord` (L243), fail-closed evidence re-reads |
| `plugin/skills/faff-graft/SKILL.md` | Current lane-side write sites (Steps 8, 9, 10) |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md`, `faffter-dark-concurrency-parallel/SKILL.md` | Orchestrator-only single-writer rule for `run-ledger.json` + `events.jsonl` (already stated) |
| ADR-0039, ADR-0043, ADR-0061, ADR-0074 | Corrective authority; merge-floor interlock; assert-the-boundary; declaration-content ownership |

**Scope statement.** This sits in the factory-region trust architecture, between FAFF-518 (digest primitive, shipped) and FAFF-520 (executor bracketing, blocked on this) / FAFF-525 (lights-out preflight consumer).

**Mis-cite correction (carry into the ADR).** The ticket cites "ADR-0072 §5"; ADR-0072 is *Container-create follows the PRDR lifecycle* and has no §5. The governing lineage is **ADR-0039** (Channel A corrective authority), **ADR-0061** (assert-don't-implement boundary), **ADR-0074** (faff owns the declaration content), with ADR-0043 (merge-floor interlock) and ADR-0034 (sentry at the orchestrator dispatch boundary) adjacent. The landed ADR must cite these and note the correction, never propagate the mis-cite.

## 2. OUT OF SCOPE

- **Relocating any write site** — why: this is a decision spike; the moves are mandated, then filed as follow-ups. Extension point: `faff-graft/SKILL.md` Steps 8/9/10 + the concurrency executors' dispatch/return contract.
- **The executor digest bracket** — why: that is FAFF-520, unblocked by this ruling. Extension point: the concurrency slot SKILL.mds + `integrity-digest` verify call sites.
- **The real read-only mount** — why: FAFF-517, deferred. Extension point: the outer-layer cage launcher composing `faff integrity-boundary`.
- **Digest-set membership changes** (`merge-record.json`, `post-merge-verification.json`) — why: additive later, after relocation (§HOW). Extension point: `correctiveIntegrityDirs()` — the one resolver.
- **Sentry/heartbeat telemetry changes** — why: already single-writer per member file and explicitly sensor-class; nothing to move.

## 3. WHAT — Vocabulary and the class roster

**Vocabulary:**

| Term | Definition |
|---|---|
| Dispatch cut | The trust boundary an orchestrator crosses when it dispatches an untrusted lane (beep-boop → build subagent; graft/beep-boop → spawned reviewer/evaluator process). |
| Evidence class | Artifacts a downstream gate (merge floor, corrective, detection, reconcile) consumes as trust-bearing input. Write authority: the trusted side of the active cut only. |
| Sensor/resume class | Artifacts whose value is liveness telemetry or crash-resumability. Write authority: the producing lane, single-writer per file. |
| Trusted side | The orchestrating context above the cut: the beep-boop orchestrator, a sanctioned spawner (`evaluate-call.mjs` pattern), or a sanctioned mechanical CLI invoked from that side. |

```
ENUM WriteAuthority: EVIDENCE (trusted-side only) | SENSOR_RESUME (lane-writable, single-writer)
```

**Decision 1 — the two-class split and roster.** Considered a three-class model (evidence / mechanical-CLI-output / sensor) vs two classes. Two suffice: a mechanical CLI's output is evidence whose authority derives from *where the CLI is invoked from*, not a third kind of trust. **Chosen:** two classes, rostered as follows (the evidence roster **is** `correctiveIntegrityDirs()` — never a second hand-written list — plus the two merge-tail records):

| Artifact | Class | Current writer | Compliant today? |
|---|---|---|---|
| `run-ledger.json` | Evidence | Orchestrator (sole writer, both concurrency SKILL.mds) | Yes |
| `events.jsonl` | Evidence | Orchestrator (sole appender) | Yes |
| `corrective/` | Evidence | `faff corrective author`, orchestrator-side (beep-boop `correct` row, ADR-0039) | Yes |
| `<issue>/holdout.json` (per-run phase) | Evidence | `evaluate-call.mjs` spawner, orchestrator-invoked | Yes |
| `<issue>/holdout.json` (per-issue gate) | Evidence | Same spawner, but launched **from inside the graft build lane** (graft Step 10) | **No — moves** |
| `<issue>/ac-checklist.json` | Evidence | Build lane (graft Step 8) | **No — moves** |
| `<issue>/review-verdict.json` | Evidence | Build lane (graft Step 9) | **No — moves** |
| `<issue>/merge-record.json` | Evidence | `faff merge-gate` CLI, invoked from the lane's ship step | Moves with the merge locus |
| `<issue>/post-merge-verification.json` | Evidence (detection-grade, never merge-gating) | `faff post-merge-check`, invoked from graft post-ship | Moves with the merge tail |
| `<issue>/graft.md`, `prep.md`, `park.md`, `resolve-attempt.md`, `ac-verification.md` | Sensor/resume | Lane | Yes |
| `<issue>/discovered-scope.json` | Sensor/resume (lane records; orchestrator files — gateway Agent Lanes rule) | Lane | Yes |
| `<issue>/build-progress.json`, `review-progress.json`, `.faff/resume/<issue>/` | Sensor/resume | Lane | Yes |
| `heartbeat`, `heartbeat.<issue>` | Sensor/resume | Lane via `faff heartbeat` (single-writer per file) | Yes |
| `merge-gate-override.json` | Sensor/resume (record of a TTY-fenced human act) | `faff merge-gate` under human flags | Yes |
| `summary.md`, `conflict-analysis.md`, `slot-validation.md`, `automation-verdicts.md`, `lane-boundary.json` | Evidence (orchestrator-written run bookkeeping) | Orchestrator | Yes |

**Decision 2 — where the cut is, and interactive graft.** The cut is the orchestrator→lane *dispatch*, and the classes bind **only across an active cut**. Interactive graft (L2, top-level) has no cut above it: the human-supervised session *is* the trusted side, so interactive graft legitimately writes every class directly, exactly as today — unasserted boundary at rung-0, `merge-gate --interactive` level-branch unchanged. **Chosen:** classes bind actors relative to the cut; interactive top-level graft sits above it and keeps all current writes; the evidence rule activates only for dispatched lanes (autonomous orchestration).

## 4. HOW — Rulings and consequences

**Decision 3 — the contested per-issue evidence writes must move.** The ticket's lean is **confirmed**, by a forcing function verified in the code: `correctiveIntegrityDirs(runDir, issue)` *already declares* `ac-checklist.json` / `review-verdict.json` / `holdout.json` as the lane's read-only forge surface — a genuinely mounted boundary (FAFF-517) would make today's graft Step 8/9 writes *impossible*, and a custody digest over lane-written evidence proves only "not tampered after the untrusted party wrote it", which is worthless against self-marked homework. **Chosen:** these three write sites move above the cut — the lane returns the AC result, the reviewer's extraction JSON, and (per-issue gate) the holdout dispatch responsibility in its terminal payload; the dispatcher verifies the digest bracket, then persists. This makes FAFF-520's bracket meaningful (the trusted side is the only writer between snapshot and verify). **Scope of the claim (honest):** the relocation buys *custody/write-authority* integrity — the lane can no longer write gate evidence — but for `ac-checklist.json` and `review-verdict.json` the lane still *authors* the verdict content it returns; the dispatcher persisting it changes the writer, not the author. Content-independence comes from the trusted-side code-blind holdout gate; lane-authored review/AC content is an acknowledged residual unless a later follow-up mandates trusted-side re-derivation. Only the holdout artifact gets the full FAFF-384 spawner treatment (the trusted side runs the judge itself and derives the attestation from a provably-withheld launch).

**Decision 4 — the merge locus moves with them.** `faff merge-gate` fail-closes on a missing `ac-checklist.json` (not-verified) and a missing `review-verdict.json` (`missing` ≠ `pass`) — so dispatcher-persisted evidence that lands only *after* lane return cannot feed an in-lane merge: Decision 3 forces the `merge-gate` invocation (the ship handoff, and with it `merge-record.json` + the post-merge tail) to the trusted side of the cut. The alternative (keep merging in-lane) collapses: it either re-grants the lane evidence-write authority or merges on evidence that does not exist yet. This also serialises shared-`main` mutation at the orchestrator — coherent with ADR-0043's single mechanical merge locus. **Chosen:** in the enforced-cut world, lanes end at "gates green, PR ready, evidence returned"; the trusted side digest-verifies, persists evidence, and invokes `faff merge-gate`. Landed here as the ruling plus a filed follow-up build ticket (the relocation is **not** built in FAFF-519); until it lands, today's in-lane sequence remains the sanctioned rung-0 posture.

**Decision 5 — freeze-set semantics for FAFF-520 (refutes byte-exact for events.jsonl).** The ticket's "byte-exact if evidence moves above the cut" holds for every plain evidence member, but **not** for `events.jsonl`: the parallel executor's poll loop legitimately appends orchestrator events (`sentry-checkpoint`) *while* lanes are in flight, so byte-exact would false-flag the orchestrator's own appends. **Chosen:** keep FAFF-518's shipped prefix-preserving rule for `events.jsonl`; all other evidence members are byte-exact across a dispatch bracket once Decision 3/4 land.

**Decision 6 — FAFF-520's interim bracket scope.** Until the relocation ticket lands, the per-issue members are still legitimately lane-written mid-dispatch, so bracketing them would demand re-baselining bookkeeping that the relocation deletes anyway. **Chosen:** FAFF-520 brackets the run-grain set (`correctiveIntegrityDirs(runDir)` + `--events`: `corrective/`, `run-ledger.json`, `events.jsonl`-prefix) byte-exact/prefix now, with per-issue members joining the bracket when their writes relocate — no throwaway bookkeeping.

**Decision 7 — digest-set membership for the merge-tail records.** `merge-record.json` and `post-merge-verification.json` are not in `correctiveIntegrityDirs()` today and appear mid-lane. **Chosen:** defer adding them to the evidence set until the merge locus has moved (Decision 4); then it is a one-line additive change at the single resolver, mirroring the FAFF-466 `--events` pattern.

**Decision 8 — landing surface.** **Chosen:** both — a new ADR states the two-class split, the cut definition, the interactive-graft carve-out, and the mandated relocations (citing ADR-0039/0061/0074 and correcting the ADR-0072 §5 mis-cite); one operative shared-rule paragraph lands in the gateway (`faff/SKILL.md`), referenced (never copied) by the graft and concurrency SKILL.mds per the dedup rule. Rationale: the executors need one referenceable operative rule; the *why* and the rejected alternatives belong in the ADR, not the runtime prompt.

**Failure modes:**

- **The failure:** the relocation follow-up proves oversized (moving ship out of graft ripples through both concurrency slot contracts and the delivery-outcome consumer). **How you'd know:** the follow-up ticket's prep parks or splits. **What it means:** narrow — stage per-artifact (ac-checklist/review-verdict first, merge locus second); the class ruling here stands regardless.
- **The failure:** dispatcher-persisted evidence weakens crash-resume (a lane dies post-review, pre-return, and the verdict data dies with it). **How you'd know:** a resumed drain re-runs review where today it would re-read `review-verdict.json`. **What it means:** proceed — resume-critical copies stay in the sensor/resume store (`.faff/resume/<issue>/`, checkpoints), which is exactly why that class stays lane-writable; evidence is re-derived or re-persisted by the trusted side, never trusted from a lane-writable stash.

**Anti-pattern:** treating `digest-verified` over a lane-written file as trust in its *content*. Why: custody detection starts at snapshot time; it cannot launder authorship (the ADR-0061 lying-attestation failure).

## Scenarios

```
Given the landed gateway paragraph and ADR
When FAFF-520 is prepped
Then it can cite one operative rule naming the run-grain interim bracket (Decision 6)
  and the prefix rule for events.jsonl (Decision 5), with no open write-authority question
```

```
Given the landed ADR
When a reader follows its citations
Then ADR-0039/0061/0074 are cited, ADR-0072 is not cited as governing,
  and the §5 mis-cite is explicitly noted as corrected
```

- The gateway paragraph MUST be one shared-rule paragraph, referenced (not copied) from executor/graft SKILL.mds — `faff validate-adapters` stays green.

## 6. DESIGN DECISION RATIONALE

- **Two classes or three?** Three (splitting out mechanical-CLI outputs) adds vocabulary without adding a distinct trust source — a CLI inherits the trust of its invocation locus. **Chosen:** two classes (Decision 1).
- **Does interactive graft break the model?** No — the classes bind across a cut; top-level interactive graft has none. **Chosen:** carve-out by construction, not by exception list (Decision 2).
- **Confirm or refute the ticket's lean?** Confirmed for the class split and the per-issue moves (forced by the already-declared forge surface + fail-closed merge re-reads); refuted narrowly on byte-exact-for-events (orchestrator mid-flight appends in the parallel executor). **Chosen:** Decisions 3–5 as stated.
- **Land the relocation now or rule-then-file?** A half-day spike cannot restructure the ship handoff safely. **Chosen:** rule here, file the relocation follow-up(s); FAFF-520 proceeds on the interim run-grain bracket (Decision 6). At the time of writing, lanes are same-session subagents (ADR-0073), so no enforced mount makes the current in-lane writes an active vulnerability beyond the known rung-0 posture.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** an outer-layer cage with the real read-only mount (FAFF-517) eventually exists to convert this ruling from custody-detected to mount-prevented. Validation: the build agent checks FAFF-517 is still open/planned and cites it in the ADR's Consequences; nothing in this ticket's deliverable executes against the mount.

## 8. DONE — Definition of Done

### From WHY
- [ ] The landed ADR corrects the ADR-0072 §5 mis-cite and cites ADR-0039/0061/0074 as the governing lineage.

### From WHAT
- [ ] The ADR contains the two-class definition, the cut definition, the interactive-graft carve-out, and the per-artifact roster (evidence roster stated as `correctiveIntegrityDirs()` + the two merge-tail records — no second hand-written list).

### From HOW
- [ ] The ADR mandates the three per-issue write-site moves and the merge-locus move (Decisions 3–4) as follow-up work, explicitly not built in FAFF-519.
- [ ] The ADR records Decision 5 (events.jsonl stays prefix-preserving; other members byte-exact) and Decision 6 (FAFF-520 interim run-grain bracket) so FAFF-520 unblocks without re-litigating.
- [ ] One gateway (`faff/SKILL.md`) shared-rule paragraph states the operative rule; graft/concurrency SKILL.mds reference it without copying; `faff validate-adapters` passes.
- [ ] Follow-up ticket(s) for the mandated relocations are filed with a back-link to FAFF-519. Because "blocks FAFF-520's per-issue bracket expansion but not FAFF-520 itself" is a partial edge the blocker graph cannot encode, the filing step also splits **FAFF-520's per-issue bracket expansion into its own ticket** — the relocation follow-ups block *that* ticket; FAFF-520 proper stays unblocked the moment FAFF-519 lands (per Decision 6).

**Integration smoke test:**
```
1. Read the landed ADR + gateway paragraph
2. Prep FAFF-520 against them
3. Confirm no write-authority question remains open in the 520 prep (the ruling is citable, complete, and consistent with integrity-digest.js's shipped prefix rule)
```

confidence: high
spec-review: approve (after revise iteration 1 — infosec major + architectural minor folded in)
