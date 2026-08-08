# FAFF-749 — Relocation slice 1: build lane returns AC/review evidence; dispatcher persists + digest-verifies

> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: medium · spec-review: approve. Full spec on Linear FAFF-749.

This document is the build spec for **FAFF-749** — slice 1 of the ADR-0077 write-authority relocation epic (FAFF-748). It targets the **dispatched/autonomous build lane only**: the concurrency-executor → build-subagent cut. It is written for the build agent implementing the change and for the human reviewers gating it. It is a prose-skill change (two executor `SKILL.md`s + the gateway concurrency-slot contract + graft's return-values section) plus a small mechanical test delta; whether a thin CLI affordance is added is decided below (it is not required).

## 1. WHY — Problem and Principles

**The load-bearing model.** Trust in a `.faff/runs/<id>/` evidence artifact comes from *who could have written it*, not from what it says (ADR-0077). Today the build subagent — the untrusted party across the dispatch cut — writes the very files that judge its own work (`ac-checklist.json`, `review-verdict.json`) and the dispatcher reads them back off disk as gate evidence. This slice moves the **writer of record** for those two files to the trusted side: the lane now *returns* their content in its terminal payload, and the dispatcher verifies the returned copy against what landed on disk, persists it as the orchestrator-authored copy, and parks the unit if the two disagree. It does **not** yet make the dispatcher the *sole* writer (the lane still writes in-lane too), because the merge that consumes those files still runs inside the lane until slice 2 (FAFF-750).

**Problem statement.** The dispatched build lane authors and writes its own AC/review verdicts, and nothing detects a mutation of those files between the lane writing them and the dispatcher consuming them. This slice adds the return plumbing and a tamper-between-write-and-return point check, so a divergence between the returned evidence and the on-disk copy parks the unit instead of being silently trusted.

**Design principles.**

- **Honest scope — writer, not author.** For `ac-checklist.json` and `review-verdict.json` the lane still *authors* the content it returns; the dispatcher persisting it changes the **writer**, not the **author**. This check catches third-party mutation (a concurrent lane, a detached process, a post-write edit) between the lane's write and the dispatcher's read. It does **not** catch a lying lane that authors both copies identically — content-independence comes only from the trusted-side code-blind holdout gate (ADR-0077 Decision item 1). Any prose or AC that implies content-trust is wrong and must be rejected.
- **The transitional copy is real, not incidental.** The merge still runs in-lane (graft Step 10) and the per-PR anchor is still committed in-lane (graft Step 9b), and both consume the lane's on-disk copy *before* the lane returns. So the dispatcher-persisted copy cannot feed the in-lane merge or the in-lane anchor this slice; it is authoritative for the orchestrator's post-return reconciliation/audit and is the seam slice 2 rewires. Do not claim the dispatcher copy is what the in-lane merge/anchor consume today.
- **Do not widen the custody bracket.** The check is a per-issue *point comparison*, not a new member of the continuous run-grain integrity-digest chain (obligation 5). Adding per-issue members to the bracket is FAFF-751; conflating them re-introduces the exact re-baselining bookkeeping ADR-0077 Decision 6 defers.
- **The `TerminalToken` record stays `{ issue, outcome, pr }`.** The evidence rides *alongside* it as a separate return field (the `discovered_scope` precedent), never as a new field on the token — preserving the "no token/spend field, ever" invariant both executors assert.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` (Step 8 ~L337, Step 9 ~L410, Return values ~L590) | Skill prose | Lane writes the two files in-lane and returns the terminal token; this slice adds the returned evidence payload |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` (step 3, bracket note ~L34) | Skill prose | Sequential dispatcher: reconcile-then-record on return; gains verify + persist |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (step 3, obligation-5 chain ~L83) | Skill prose | Parallel dispatcher: per-return handling within a wave; gains verify + persist |
| `plugin/skills/faff/SKILL.md` → *The `concurrency` slot contract (fixed)* (~L1111, obligation 5 ~L1121) | Skill prose | Home of the shared rule; gains obligation 6 |
| `plugin/skills/faff/bin/lib/merge-gate.js` `readAcComplete`/`readReviewVerdict` (~L333/344) | JavaScript | In-lane merge consumer of the two files — must keep passing unchanged |
| `plugin/skills/faff/bin/lib/integrity-digest.js` (`hash`/leaf sha256, `snapshotMember` ~L101) | JavaScript | Provides the leaf-hashing primitive the point check reuses |
| `docs/adr/0077-...evidence-writes-cross-to-the-trusted.md` (Decision, item 1) | ADR | Governing decision; the honest-scope carve-out |
| `docs/adr/0078-digest-custody-bracket-as-concurrency-contract-obligation-5.md` + FAFF-520 spec | ADR/spec | The exit-1 park path this slice reuses |

**Scope statement.** This slice sits at the concurrency executor → build subagent boundary; it changes what the lane returns and what the dispatcher does with it on return, and nothing else in the build flow.

## 2. OUT OF SCOPE

- **Moving the merge locus / `merge-record.json` / the post-merge tail** — *Why:* the merge still runs in-lane this slice; moving it is a separate contract change. *Extension point:* FAFF-750 relocates `faff merge-gate` (and with it `merge-record.json` + `post-merge-verification.json`) to the trusted side; at that point the dispatcher-persisted copy becomes the merge's input directly.
- **Adding the per-issue members to the run-grain custody bracket** — *Why:* they are still legitimately lane-written mid-dispatch, so bracketing them now demands re-baselining the relocation deletes (ADR-0077 Decision 6). *Extension point:* FAFF-751 adds `ac-checklist.json`/`review-verdict.json` to `correctiveIntegrityDirs(runDir, issue)`'s bracketed set once their writes have relocated.
- **The holdout artifact's trusted-side spawner treatment** — *Why:* `holdout.json` gets the full FAFF-384 code-blind treatment, a heavier move than the AC/review return. *Extension point:* the ADR-0077 relocation item's holdout leg (tracked separately under FAFF-748).
- **Trusted-side re-derivation of AC/review content** — *Why:* out of the ADR's stated scope; the lane remains the author. *Extension point:* a later ADR-0077 follow-up mandating trusted-side re-derivation.
- **Interactive top-level graft (L2)** — *Why:* it has no dispatch cut above it; the human session is the trusted side and writes every class directly (ADR-0077 carve-out). *Extension point:* none — this is a carve-out by construction, and interactive graft is not invoked through a concurrency executor.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Returned evidence | The AC-verification result and reviewer extraction JSON the lane returns in its terminal payload, alongside the `TerminalToken`. |
| In-lane copy | `<run-dir>/<issue>/ac-checklist.json` and `.../review-verdict.json`, written by the lane at graft Steps 8/9 (unchanged this slice). |
| Persisted copy | The same run-dir path, re-written by the **dispatcher** from the verified returned payload — the orchestrator-authored copy of record after return. |
| Evidence point check | The dispatcher's per-issue comparison of returned bytes vs the in-lane on-disk copy (leaf sha256), distinct from the obligation-5 run-grain bracket. |

**Type definitions.**

```
RECORD TerminalToken:              # UNCHANGED this slice
  issue:   IssueId
  outcome: BuildBucket             # shipped|superseded|pr-open|parked|errored (+ pre-worktree skips)
  pr:      PrRef | null

RECORD EvidenceReturn:             # NEW — returned ALONGSIDE the token, one per member
  issue:        IssueId
  ac_checklist: { present: bool, body: { all_verified: bool } | null }
      # body is the exact object the lane wrote to <issue>/ac-checklist.json;
      # present:false ⇒ body:null ⇒ the lane wrote no ac-checklist.json this build
  review_verdict: { present: bool, body: { signal, findings } | null }
      # body is the exact object the lane wrote to <issue>/review-verdict.json;
      # present:false ⇒ body:null (e.g. retry-later deliberately writes none; early park/errored)

  CONSTRAINT present == false  ⟺  body == null
  CONSTRAINT for each member returned by a chain, exactly one EvidenceReturn
```

**Interfaces.**

- **Lane → dispatcher (return channel).** `EvidenceReturn` travels on the same structured terminal-return channel as the `TerminalToken` (the Agent-tool final result the dispatcher already reads for the token) — **never** the free-text transcript. The existing "never parse the subagent transcript" rule is about narration; the token and this payload are the sanctioned structured return.
- **Dispatcher verify+persist.** For each of the two files, the dispatcher reads the in-lane on-disk copy, compares presence and (when present) leaf sha256 against the `EvidenceReturn` field, then on agreement persists the returned body to the run-dir path as the orchestrator-authored copy and records an `evidence_persisted` provenance entry on the ledger; on disagreement it parks (below).
- **Consumers unchanged.** `merge-gate.js` `readAcComplete`/`readReviewVerdict`, the Step-9b anchor byte-copy, and `governance-check`'s `merge_floor` leg all keep reading `<run-dir>/<issue>/*.json`; on the pass path the persisted copy is byte-identical to what they already read, so no consumer changes.

**Design decisions** are collected in §6; each carries its canonical marker there.

## 4. HOW — Behavior

**Overview.** The lane's behaviour up to and including its in-lane merge is unchanged. The lane additionally *returns* the two evidence bodies. The dispatcher, on each subagent return — **after** the existing obligation-5 run-grain bracket verify and **before** reconciling the token or recording anything — runs the evidence point check per member, then persists on pass or parks on fail.

**Lane side (graft Return values).** Alongside the terminal token(s), graft returns one `EvidenceReturn` per member. Each field mirrors exactly what the lane wrote in-lane: if Step 8 wrote `ac-checklist.json`, `ac_checklist.present = true` and `body` is those bytes' object; if a terminal state wrote no `review-verdict.json` (e.g. `retry-later`, or an early `parked`/`errored` before review), `review_verdict.present = false`. The lane keeps its Step-8/9 in-lane writes verbatim (the in-lane merge at Step 10 and the anchor at Step 9b still need them). `EvidenceReturn` is a **separate return field**, not a new key on `TerminalToken`.

**Dispatcher side — verify, then persist or park.** Behaviour summary: on return the dispatcher confirms the lane's returned evidence still matches what is on disk, promotes the returned copy to orchestrator-authored, and refuses to consume a unit whose evidence diverged.

```
PROCEDURE on_subagent_return(unit, token, evidence):     # per member
  1. Run the obligation-5 run-grain bracket verify (unchanged).
     IF exit != 0: run the shared bracket park (obligation 5) — STOP.   # existing behaviour
  2. FOR file IN { ac_checklist -> <issue>/ac-checklist.json,
                   review_verdict -> <issue>/review-verdict.json }:
     a. disk_present := file exists on disk
     b. IF evidence[file].present != disk_present:
          PARK(unit, "evidence-return mismatch — <issue>/<file> (presence disagreement)")  # STOP
     c. IF disk_present:
          IF leaf_sha256(returned body serialized) != leaf_sha256(on-disk bytes):
            PARK(unit, "evidence-return mismatch — <issue>/<file> (returned copy ≠ on-disk copy)")  # STOP
  3. Persist: for each present file, (re)write the run-dir path from the returned body
     (orchestrator-authored copy of record) and append an `evidence_persisted`
     entry { issue, ac_sha256?, review_verdict_sha256? } to the ledger via the
     mandatory re-baseline write sequence (obligation 5).
  4. Reconcile token vs ground truth and record the ledger bucket (unchanged).
```

- **PARK** reuses the **FAFF-520 exit-1 park path verbatim**: cause string as above, standard `faff-parked` label + park comment, ledger bucket `parked`, and an entry appended to the top-level `integrity_tampered` array `{ issue, paths }` (paths = the diverged file(s)). Do not consume the unit's run-dir evidence.
- **Serialization for the hash — return raw bytes, do not re-serialize.** Compare the returned bytes against the on-disk bytes with the same leaf sha256 the digest tool uses. The lane MUST return the file's **raw bytes** (what it wrote), not a parsed-then-re-serialized object: a re-serialization that differs in key order / whitespace / escaping would fail the byte-exact compare and park a clean build as `integrity_tampered` — a false tamper signal from benign serialization instability. Mandating the raw-bytes path keeps the tamper channel clean (a mismatch then means a genuine divergence, never a serializer quirk).

**Where the shared rule lives.** The dispatcher rule is added to the gateway `concurrency` slot contract as **obligation 6** ("persist + verify returned per-issue evidence"), taking the contract from five obligations to six. Both executors *refer back* (dedup rule); neither restates it. Each executor carries only its placement prose:

- **Sequential** (`faffter-noon-concurrency-sequential`, step 3): after the obligation-5 verify on return and before reconcile-then-record, run obligation 6 for the unit's member.
- **Parallel** (`faffter-dark-concurrency-parallel`, step 3 / obligation-5 chain): on each subagent return within the wave, after the per-return bracket verify and before consuming the token, run obligation 6 for that member.

**Edge cases and error handling.**

- **Legitimately-absent evidence.** Pre-worktree skips (`ineligible`/`blocked`/`inadmissible`), `retry-later` (writes no `review-verdict.json` by design), and early `parked`/`errored` all yield `present:false` for the missing file(s); the presence-agreement check passes when disk also lacks them. No park, no persist for an absent file.
- **Missing `EvidenceReturn` entirely** on a terminal state that wrote evidence on disk → presence disagreement (returned-absent vs disk-present) → park. A structurally malformed `EvidenceReturn` (e.g. `present:true, body:null`) is treated the same — park; the dispatcher never guesses a body.
- **Chain members.** One `EvidenceReturn` per member, checked independently; a mismatch parks only that member (the chain's undispatched remainder follows the existing in-run-blocker rule).
- **Lost baseline / compaction** is handled by obligation 5 unchanged; obligation 6 adds no new baseline (it holds nothing across the bracket — it is a point check at return).

**Failure modes.**

- **The failure:** the point check gives a false sense of content-trust. *How you'd know:* a review/AC verdict that is wrong-but-self-consistent (lane authored both copies identically) sails through and merges. *What it means:* expected and named — this slice never claimed content-trust; the residual is closed only by the holdout gate. Proceed; do not widen the claim.
- **The failure:** the transitional split misleads a reader into thinking the dispatcher copy feeds the in-lane merge/anchor. *How you'd know:* a reviewer asks "so the anchor is now dispatcher-written?" and the prose can't answer no cleanly. *What it means:* narrow the prose — the persisted copy is authoritative for post-return orchestrator use only until slice 2.
- **The failure:** over-scoping the park to the whole wave. *How you'd know:* a single unit's evidence divergence halts otherwise-healthy in-flight builds. *What it means:* the park is deliberately unit-scoped (see §6 D4); the run-grain bracket independently guards shared-substrate tamper with its own halt-and-drain.

**Anti-patterns.**

- **Anti-pattern:** adding `ac-checklist.json`/`review-verdict.json` to the obligation-5 bracket member set. Why: that is FAFF-751; doing it here re-introduces the re-baselining ADR-0077 Decision 6 defers and false-flags legitimate mid-dispatch lane writes.
- **Anti-pattern:** removing the lane's in-lane Step-8/9 writes. Why: the in-lane merge (Step 10) and anchor (Step 9b) still read them this slice; removing them fails the merge closed.
- **Anti-pattern:** widening `TerminalToken` with the evidence. Why: it breaks the "no token/spend field, ever" invariant both executors assert; return `EvidenceReturn` as a sibling field.
- **Anti-pattern:** treating the returned copy as trusted content because it was digest-verified. Why: custody detection cannot launder authorship (the ADR-0061 lying-attestation failure).

## 5. Scenarios

```
Given a dispatched build subagent that verified ACs and produced a review pass
When it returns its terminal payload
Then it carries an EvidenceReturn { ac_checklist.present:true, review_verdict.present:true }
     alongside the unchanged TerminalToken{ issue, outcome, pr }
```

```
Given the lane's returned ac-checklist body byte-matches <issue>/ac-checklist.json on disk
When the dispatcher runs the obligation-6 point check on return
Then the check passes, the dispatcher persists the returned copy to the run-dir path,
     records an evidence_persisted ledger entry, and reconciles the token normally
```

```
Given the on-disk <issue>/review-verdict.json was mutated after the lane wrote it,
      so it no longer matches the review_verdict body the lane returned
When the dispatcher runs the obligation-6 point check on return
Then the unit is parked via the FAFF-520 exit-1 path (faff-parked label, park comment,
     ledger bucket parked, an integrity_tampered entry naming <issue>/review-verdict.json),
     the unit's run-dir evidence is not consumed by any POST-return orchestrator decision
```
Note on slice-1 scope: the in-lane merge (graft Step 10) runs *before* the lane returns, so w.r.t. that merge this point check is **detective, not preventive** — a mutation in the write→merge window is caught post-hoc (obligation 5's merged-PR park comment names both the paths and the merged PR), not prevented. Full prevention w.r.t. the merge arrives only in slice 2 (FAFF-750), when the merge locus moves above the cut.

```
Given a retry-later terminal state that deliberately wrote no review-verdict.json
When the dispatcher runs the point check with EvidenceReturn.review_verdict.present:false
Then presence agrees with disk (both absent), no park and no persist occur for that file,
     and the outcome records as parked + review_outage_pending unchanged
```

```
Given a dispatched build whose evidence passed the obligation-6 point check and was persisted
When faff merge-gate (in-lane, Step 10), the Step-9b anchor byte-copy, and governance-check's
     merge_floor leg subsequently read <run-dir>/<issue>/*.json
Then all read byte-identical content and their existing pass/fail behaviour is unchanged
```

- The point check MUST use the same leaf sha256 primitive as `integrity-digest`, and MUST NOT add the per-issue files to the run-grain bracket member set.
- A per-issue evidence mismatch under the parallel executor MUST park only that unit and MUST NOT halt-and-drain the wave.

## 6. Design Decision Rationale

**How does the lane hand the evidence to the dispatcher?**
- *Widen `TerminalToken`* — rejected: breaks the invariant both executors assert; the token stays a scheduling primitive.
- *Separate return field alongside the token* (the `discovered_scope` precedent) — chosen.
- **Chosen:** the lane returns an `EvidenceReturn` field alongside the unchanged `TerminalToken{issue,outcome,pr}`, on the same structured return channel. Keeps the token narrow, matches an existing pattern, and rides the trusted return channel rather than the transcript.

**What is the transitional authoritative-copy story while merge is still in-lane?**
- *Dispatcher becomes sole writer now* — rejected: the in-lane merge (Step 10) and the Step-9b anchor both need the file on disk *before* the lane returns, so a dispatcher-only write cannot feed them until the merge moves (slice 2).
- *Two copies, split by consumer and time* — chosen.
- **Chosen:** the lane keeps its in-lane Step-8/9 writes (consumed by the in-lane merge and anchor, unchanged); the dispatcher verifies the returned copy against that on-disk copy, then re-writes the run-dir path from the returned body as the orchestrator-authored copy with an `evidence_persisted` ledger entry. **Honest framing of the persist step (slice 1):** the dispatcher-persisted copy has **no concrete slice-1 reader** — the in-lane merge (Step 10) reads the lane copy pre-return, the anchor (Step 9b) byte-copies the lane copy to git pre-return, and `governance-check` re-validates that committed *anchor*, not the live run-dir; run-end reconciliation keys off git ground truth, not this file's content. The persist is therefore **seam-plumbing for slice 2** (where the dispatcher copy becomes the merge's direct input once the merge moves above the cut), plus the return-side tamper detection that *is* live in slice 1. It is deliberately built now so slice 2 is a locus move, not a new write path. Presence is keyed off disk reality (returned present/absent must agree with on-disk), not the outcome enum — so absent-by-design states need no enumeration. *(decides: architecture)* — a reviewer should confirm this honest narrowing; the alternative is to defer the persist wholly to slice 2 and ship slice 1 as return + detect only.

**How is the returned evidence verified — and how does that stay clear of FAFF-751?**
- *Add the two files to the obligation-5 run-grain bracket* — rejected: that is FAFF-751 and re-introduces deferred re-baselining (ADR-0077 Decision 6).
- *Per-issue point comparison at return, reusing leaf sha256* — chosen.
- **Chosen:** a per-issue point check comparing the returned body's serialized bytes against the on-disk copy via the existing `integrity-digest` leaf sha256 primitive; no new bracket member, no continuous chain, **no new integrity-digest CLI surface required** (a thin additive `hash` affordance is acceptable if the builder finds the primitive unergonomic, but is not part of this slice's deliverable).

**What happens on a mismatch, and at what scope?**
- *New bespoke park path* — rejected: duplicates FAFF-520's mechanics.
- *Reuse the FAFF-520 exit-1 park path, unit-scoped* — chosen.
- **Chosen:** a mismatch (presence disagreement or byte divergence) parks via the FAFF-520 exit-1 path — cause naming the evidence-return mismatch, `faff-parked` + comment, ledger bucket `parked`, `integrity_tampered` array entry, evidence not consumed. The park is **unit-scoped**: the parallel executor does not halt-and-drain the wave on a per-issue evidence mismatch. The residual this leaves is precise: a lane mutating a **sibling's** per-issue evidence dir (a lane escaping its own issue boundary) is *not* in the obligation-5 run-grain bracket (that membership is FAFF-751) and is caught only victim-side as that sibling's unit-park, with the tampering lane itself unflagged and the wave continuing. Unit-scope is nonetheless the right call: obligation 5's own parallel tamper response also cannot stop in-flight merges (it halts only *new* dispatches), so escalating to a wave halt buys little, while over-scoping a single mismatch into a wave halt is a real denial-of-service amplifier. *(decides: security)* — the wave-scope posture is a defensible choice a reviewer may want to confirm.

**Where does the shared rule live?**
- *Copy the rule into both executors* — rejected: violates the dedup / `validate-adapters` duplicated-block rule.
- *One gateway obligation, both executors refer back* — chosen (mirrors how obligation 5 landed).
- **Chosen:** add obligation 6 to the gateway `concurrency` slot contract (five → six obligations); both executors refer back and carry only placement prose; graft's Return values section documents the widened return. Matches ADR-0077 Decision 8's landing-surface guidance (one operative shared rule, referenced not copied).

**Assumes — FAFF-520 obligation-5 bracket and its exit-1 park path are landed.** The point check runs after the run-grain verify and reuses its park mechanics + `integrity_tampered` array. *Validation:* confirm obligation 5 exists in `plugin/skills/faff/SKILL.md` and both executors implement snapshot/verify with the exit-1 park (cause/label/comment/bucket/array) before building.

**Assumes — the ADR-0077 gateway write-authority paragraph and `integrity-digest` leaf hashing exist as described.** *Validation:* confirm `plugin/skills/faff/SKILL.md` → *Run-artifact write authority* still names the evidence class + dispatch cut, and `integrity-digest.js` still exposes leaf sha256 hashing (`snapshotMember`/`hash`); a shift is a re-check of the primitive names, not a redesign.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. Two Chosen decisions carry a `(decides: …)` reviewer flag rather than a punt: the transitional two-copy narrowing (architecture) and the unit-scoped park (security). Both are resolved decisively above; the flags mark them for a confirming glance, not for a build-blocking decision.

**Assumptions** (both collected from §6, each with its validation instruction):

- **FAFF-520 obligation-5 bracket + exit-1 park path are landed** — validate by reading the gateway obligation 5 and both executors' bracket prose before building.
- **ADR-0077 write-authority paragraph + `integrity-digest` leaf hashing present** — validate by confirming the gateway write-authority section and the `integrity-digest.js` hashing primitive names.

## 8. DONE — Definition of Done

### From WHY
- [ ] Prose (gateway obligation 6 + both executors + graft) states the honest limit: the dispatcher becomes the **writer**, not the author; no text implies content-trust from the point check.
- [ ] Prose states the transitional split plainly: the in-lane merge (Step 10) and Step-9b anchor consume the lane's on-disk copy; the dispatcher-persisted copy is authoritative for post-return orchestrator use only, until slice 2.

### From WHAT (types and interfaces)
- [ ] The lane returns an `EvidenceReturn { issue, ac_checklist{present,body}, review_verdict{present,body} }` per member, alongside an **unchanged** `TerminalToken{issue,outcome,pr}` (invariant text preserved in both executors).
- [ ] `EvidenceReturn` travels on the structured terminal-return channel, not the transcript; graft's Return values section documents it as a field beside the token (the `discovered_scope` precedent).
- [ ] `present == false ⟺ body == null` holds in the returned shape; a chain returns exactly one `EvidenceReturn` per member.

### From HOW (behaviour)
- [ ] On return, the dispatcher runs the obligation-6 point check **after** the obligation-5 run-grain verify and **before** reconciling the token or recording any outcome.
- [ ] On agreement, the dispatcher persists the returned body to `<run-dir>/<issue>/*.json` as the orchestrator-authored copy and appends an `evidence_persisted { issue, ac_sha256?, review_verdict_sha256? }` ledger entry via the obligation-5 re-baseline write sequence.
- [ ] The point check uses the `integrity-digest` leaf sha256 primitive and does **not** add the per-issue files to the run-grain bracket member set.
- [ ] The rule lives as gateway obligation 6; both executors refer back with placement prose only (no restated block — passes `faff validate-adapters` duplicated-block lint); the contract's obligation count reads six.

### From HOW (edge cases)
- [ ] A byte divergence between returned and on-disk copy parks via the FAFF-520 exit-1 path (cause names the file, `faff-parked` label, park comment, bucket `parked`, `integrity_tampered` entry `{issue,paths}`), evidence not consumed.
- [ ] A presence disagreement (returned-present vs disk-absent, or vice versa) parks the same way; a legitimately-absent file (`present:false` matching disk-absent) neither parks nor persists.
- [ ] Under the parallel executor a per-issue evidence mismatch parks only that unit and does not halt-and-drain the wave.

### From consumers (regression)
- [ ] `merge-gate.js` `readAcComplete`/`readReviewVerdict`, the Step-9b anchor byte-copy, and `governance-check`'s `merge_floor` leg read byte-identical content on the pass path; their existing tests stay green with no source change.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the point check is mechanical sha256/presence). If the builder discovers one, register its grader `KIND` + ≥1 eval case + the seam-registry row in this ticket. *(Per the eval-sweep gate: this posture change lands behind the eval sweep before merge — a process gate on the epic, tracked outside this DONE list.)*

**Integration smoke test.**
```
1. Dispatch one build subagent (autonomous) for an issue that reaches `shipped`.
2. Confirm its return carries EvidenceReturn with both files present, token unchanged.
3. Confirm the dispatcher's point check passes and an evidence_persisted ledger entry appears.
4. Mutate <issue>/review-verdict.json on disk before the dispatcher's check in a test double;
   confirm the unit parks via the FAFF-520 exit-1 path with an integrity_tampered entry.
5. Re-run the existing merge-gate/anchor/governance-check tests; confirm all green.
```

confidence: medium
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
