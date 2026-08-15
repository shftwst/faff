# FAFF-784 — Require recorded custody at the dispatcher merge gate

> Spec: faffter-dark-nlspec · 2026-08-15 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-784.
> Revised on 2026-08-12 — human resolved the enforcement, merge-ordering, and shared-UID trust decisions; adversarial review moved incident state outside the failed manifest and narrowed the mechanical guarantee to the sanctioned merge gate.
> Re-rated on 2026-08-12 (narrow-prep, autonomous) — folded the human Decisions-register ratification "Custody verdict enforcement for dispatched merges under a shared UID" (posted after this spec). It endorses the direction the spec already carries; every decision stays closed. Held at medium pending a human's pre-build weigh-in on this security-critical merge-gate work.
> Re-rated on 2026-08-15 (narrow-prep, autonomous) — human posted "accepted, unparked", removed the `faff-parked` label, and fired `/faff-beep-boop FAFF-784`. That weigh-in discharges the sole reason the spec was held at medium. Promoted to **high**; no decision changed, and the retained `spec-review: approve` is reconciled through the live thread (the acceptance changes no reviewed decision).

This specification replaces the earlier FAFF-784 designs. It defines the first enforcement slice: trusted-side verification atomically records a per-issue custody verdict, and no dispatched merge can pass the sanctioned dispatcher merge gate without the exact valid clean record.

## WHY — Problem and principles

The mechanically enforceable boundary in this slice is the dispatcher-run merge gate. After a dispatched lane terminates, `integrity-digest verify` atomically writes a custody verdict outside the manifest being checked. `faff merge-gate` then requires the exact recorded bytes before permitting a dispatched merge.

The current sequential executor is prose. It instructs the dispatcher to verify custody and not consume compromised evidence, but prose cannot mechanically prevent a model from reading, reconciling, or scheduling after a failure. FAFF-784 closes the highest-impact bypass now: a recorded non-clean, missing, malformed, replaced, or identity-mismatched verdict cannot pass the sanctioned merge gate.

- **Mechanical scope is merge prevention.** This slice guarantees that the sanctioned dispatcher merge gate refuses without a valid pinned clean verdict. Pre-merge evidence-consumption and scheduling order remains a model-compliance rule until a later executable dispatcher boundary exists.
- **Outside the failed manifest.** The verdict cannot live in `run-ledger.json`: a failed custody check makes the existing verify-before-ledger-write sequence refuse that write. The verdict occupies a dedicated per-issue path outside the manifest being verified.
- **Every verification result is recorded when recording remains possible.** Clean, tamper, and verification-unavailable results use one atomic command. Absence never means clean.
- **Fail closed without conflation.** Exit `1` records tamper. Exit `2`, malformed verification output, and verification execution failures record verification unavailable when possible. Both block merge, but only exit `1` with valid changed paths claims tamper.
- **Structural trust, not authorship.** The orchestrator and build lane share a UID. The design relies on structural timing: the lane has terminated, trusted-side control atomically overwrites the verdict, the dispatcher retains its digest, and merge-gate rereads those exact bytes. This is detection and byte continuity, not cryptographic process identity.
- **No fictional rollback.** A pre-merge non-clean result blocks merge. If the PR is already merged when the verdict is observed, the durable verdict makes the run `needs-attention`; it does not pretend the merge was prevented or automatically reversible.

### Reference context

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/integrity-digest.js` | Existing snapshot and verification implementation; gains atomic result recording |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Sole sanctioned merge path; enforces required custody |
| `plugin/skills/faff/bin/lib/merge-fence.js` | Continues to deny raw remote and local merges |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Home for pure custody-verdict validation |
| `plugin/skills/faff/bin/lib/disposition.js` | Reads per-issue verdict files for durable attention state |
| `.faff/runs/<run-id>/lane-boundary.json` | Existing structural declaration from which merge-gate identifies a dispatched build lane |
| `.faff/runs/<run-id>/<issue>/custody-verdict.json` | New verification result outside the manifest being checked |

## Already shipped against this surface

Related tamper-evidence work already Done in the "Graft evidence is tamper-evident end-to-end" project — context for the implementer; none of it supersedes this slice:

- **FAFF-518** — `integrity-digest snapshot/verify`, the verdict primitive this slice extends with atomic `--record-result`.
- **FAFF-520** — concurrency executors bracket each dispatch with integrity-digest and park tampered evidence. Mechanised the park for the **parallel** lane only; the **sequential** merge-gate binding here is the open delta.
- **FAFF-748 / FAFF-749 / FAFF-750 / FAFF-751** — the ADR-0077 relocation (merge locus and evidence writes moved above the dispatch cut; lane returns evidence, dispatcher persists and digest-verifies it). Satisfied prerequisites, not the custody-at-merge binding.
- **FAFF-564 / FAFF-568** — events.jsonl hash chain plus governance-check anchoring. Adjacent, not superseding.
- **FAFF-720** (Done 2026-08-13) — tamper-evident audit at the PR boundary / run-level anchor. Adjacent audit-anchoring concern, not the per-issue custody-at-merge binding; the relationship stays an Open-questions cross-reference, not a supersession.

Premise still holds (re-verified 2026-08-15 against the project's Done set): no Done sibling binds dispatched sequential merge admission to a recorded per-issue custody verdict.

## OUT OF SCOPE

- **Executable dispatcher-boundary enforcement** — This slice does not mechanically stop a prose executor from consuming returned evidence, reconciling a token, or scheduling later work after a non-clean result. A follow-on issue will introduce an executable return-handler boundary that owns verification, evidence admission, token reconciliation, and scheduling.
- **Validated benign or rejected dispositions** — Every non-clean verdict blocks. A follow-on issue will define resolution authority, a validated disposition schema, and whether a narrowly accepted result may continue.
- **Authorship attestation and documentation alignment** — No field or event proves which same-UID process authored a file. A follow-on issue will align ADR-0077, event-fold language, and governance documentation with this honest limit.
- **Cryptographic or operating-system isolation**, **parallel-executor adoption**, **automatic rollback/reopen**, and **protected-member/digest changes** are separate work.

## WHAT — Vocabulary, types, and interfaces

### Custody verdict

```text
ENUM CustodyClassification:
  clean
  tamper
  verification-unavailable

ENUM MergeStateAtVerification:
  pre-merge
  post-merge

RECORD CustodyVerdict:
  schema_version: 1
  run_id: RunId
  issue: IssueId
  classification: CustodyClassification
  paths: List<RunRelativePath>
  detail: String
  verified_at: Timestamp
  merge_state_at_verification: MergeStateAtVerification

CONSTRAINT classification == tamper IMPLIES paths is non-empty
CONSTRAINT classification != tamper IMPLIES paths is empty
CONSTRAINT detail is bounded
CONSTRAINT no authorship or actor field is present
```

Canonical location:

```text
<run-dir>/<issue>/custody-verdict.json
```

The file is not added to the manifest verified by the invocation that creates it.

**Chosen:** Record one versioned custody verdict per dispatched sequential return at a canonical per-issue path outside the manifest being verified.

### Verify-and-record CLI

Extend the existing command with this exact interface:

```text
faff integrity-digest verify
  --run-dir <run-dir>
  --events
  --manifest -
  --issue-context <issue>
  --merge-state <pre-merge|post-merge>
  --record-result <run-dir>/<issue>/custody-verdict.json
  --json
```

`--issue-context` identifies the returned unit without changing the run-grain manifest selection. The command validates the canonical path, verifies the protected manifest, classifies the result, atomically overwrites the verdict through a sibling temporary file and rename, hashes the exact persisted bytes, and returns `classification`, `verdict_path`, `verdict_sha256`, and verification detail.

Exit `0` means clean; exit `1` means valid tamper with changed paths; exit `2` means verification unavailable or inability to record. If verification is unavailable but recording remains possible, the command records `verification-unavailable` before exit `2`. No validation, interruption, or filesystem failure may produce a clean result.

**Chosen:** Extend `integrity-digest verify` with atomic `--record-result`, rather than split verification and recording across prose or a second command.

### Deterministic validator

Merge admission validates the required path, expected SHA-256, run identity, and issue identity against the exact verdict bytes. It refuses absent, unreadable, malformed, unknown-version, digest-mismatched, identity-mismatched, tamper, and verification-unavailable records. Only exact valid clean is admitted.

**Chosen:** Bind merge admission to exact verdict bytes using path, digest, run identity, and issue identity.

### Dispatched-context detection

Merge-gate derives whether custody is required from the canonical parser for existing `lane-boundary.json`, not from caller flags or a possibly suspect ledger flag. A valid dispatched boundary requires custody. A present boundary that is malformed or indeterminate refuses. Interactive top-level graft has no dispatch cut and retains existing behavior.

**Chosen:** Derive the requirement from canonical lane-boundary state, so omission of custody flags on a dispatched merge refuses without trusting a ledger flag.

### Merge-gate interface

The sequential dispatcher passes:

```text
faff merge-gate
  --pr <pr>
  --issue <issue>
  --run-dir <run-dir>
  --level <level>
  --custody-verdict <canonical-path>
  --custody-verdict-sha256 <digest-returned-by-verify-and-record>
  --execute
```

The local/git-only form carries the same custody arguments. For a dispatched merge, omitted custody arguments or any invalid/non-clean verdict refuses. `merge-fence` continues to deny raw `gh pr merge` and raw local base merges.

**Chosen:** Make custody mandatory for structurally detected dispatched merges on every merge-gate path, with no caller-controlled opt-out.

### Durable disposition and authorship semantics

`faff disposition` scans canonical per-issue verdict files directly. Tamper, verification unavailable, malformed present records, and identity mismatch produce `needs-attention`; valid clean adds no attention item. Missing alone does not retroactively mark legacy/interactive runs, while new dispatched merges synchronously refuse missing state.

The schema has no author, actor, signer, or trusted-writer field. The digest establishes byte continuity from verify-and-record to merge-gate, not authorship.

**Chosen:** Derive custody-related `needs-attention` directly from present verdict files and enforce missing files at the structurally detected dispatched merge boundary.

**Chosen:** Claim structural timing, classification, and byte continuity only; make no same-UID authorship claim.

## HOW — Behavior

```text
untrusted lane terminates
          |
          v
verify --record-result
          |
     atomic verdict
          |
          +---- exact SHA retained by dispatcher
          |
          v
dispatcher merge-gate
          |
          +---- lane-boundary says dispatched?
          |             |
          |            yes
          |             |
          |      require path + SHA
          |             |
          +------ valid exact clean? ------ no --> refuse
                        |
                       yes
                        |
                 existing merge floor
```

The rejected circular dependency is removed:

```text
Manifest being verified              Verification output
───────────────────────              ───────────────────
run-ledger.json                      custody-verdict.json
corrective/                          outside this manifest
events.jsonl
```

### Sequential model-compliance ordering

The sequential prompt continues to require verify-and-record immediately after return, before consuming returned evidence, reconciling the token, scheduling dependent work, or entering normal merge processing. This ordering is normative model-compliance prose. FAFF-784 does not claim executable prevention of those earlier actions; its mechanical guarantee begins at merge.

**Anti-pattern:** Describing pre-consumption ordering as mechanically enforced by this slice.

**Anti-pattern:** Running plain `verify` and writing a verdict later, updating the suspect ledger after failed verification, or re-snapshotting a non-clean state and continuing.

### Merge-gate ordering

Merge-gate first parses lane-boundary state. A dispatched context requires exact custody path/digest validation and refuses every missing, malformed, replaced, identity-mismatched, tamper, or unavailable state. Only then does it evaluate existing integrity, AC, review, CI, holdout, head-SHA, and collision gates.

Custody validation applies to check-only and execute; remote and local/git-only; ordinary unmerged and already-merged paths. An already-merged PR with invalid/non-clean required custody reports `merged: true` but never an unqualified `merge-ok`.

### Bypass and interruption behavior

| Condition | Mechanical result |
|---|---|
| Dispatched merge omits custody flags | Refuse |
| Missing, truncated, malformed, or replaced verdict | Refuse |
| Verdict from another run/issue | Refuse |
| Tamper or verification unavailable | Refuse |
| Verify stops before atomic rename | No new valid result; refuse |
| Caller tries raw remote/local merge | Merge-fence denies |
| Interactive top-level merge, no dispatch boundary | Existing behavior |

### Post-merge behavior

An already-merged PR plus a non-clean verdict produces three simultaneous facts: forge state remains merged, merge admission is not reported clean, and `faff disposition` reports `needs-attention`. No rollback or reopen is implied.

### Honest boundary

Mechanically enforced here: atomic verdict production, exact-byte and identity comparison, dispatched-context detection, fail-closed sanctioned merge admission, existing raw-merge denial, and disposition of present non-clean verdicts.

Still model compliance: immediate verification, no earlier evidence consumption/reconciliation/scheduling, and no later untrusted lane before the associated merge.

Not guaranteed: cryptographic authorship under shared UID, protection from unrelated same-UID races, or forge-side prevention without branch protection.

## Scenarios

- Given a dispatched run whose protected member changed, when verify runs with `--record-result`, then it atomically records tamper with changed paths and exits `1`.
- `[HOLDOUT]` Given an otherwise merge-eligible dispatched run that omits custody arguments, merge-gate derives dispatch context from lane-boundary state and refuses before merge execution.
- Given a verdict replaced after recording, merge-gate detects the retained-digest mismatch and refuses.
- Given verification cannot establish clean or tamper, verify records verification unavailable where possible, exits `2`, and merge-gate refuses without reporting tamper.
- Given an already-merged PR and a non-clean verdict, the merged fact remains visible, clean admission is refused, disposition reports needs-attention, and no rollback occurs.
- No custody artifact may assert authorship; raw remote and local merge attempts remain denied by merge-fence.

## Design decision rationale

**Chosen:** Mechanically guarantee sanctioned merge refusal; retain earlier dispatcher ordering as model compliance and defer executable return handling.

**Chosen:** Persist `custody-verdict.json` outside the manifest being verified, because the suspect ledger cannot legally receive an incident after failed verification.

**Chosen:** Use one atomic `integrity-digest verify --record-result` operation to avoid an interruption and judgment gap.

**Chosen:** Derive the requirement from canonical lane-boundary state because caller flags can be omitted and a ledger rollout flag may be suspect.

**Chosen:** Pass exact persisted SHA-256 and refuse mismatches because path and identity alone do not bind content.

**Chosen:** Record verification unavailable where possible and refuse it without calling it tamper.

**Chosen:** Require custody only when canonical lane-boundary state identifies a dispatched merge; never fabricate clean state for legacy/interactive runs.

**Chosen:** Make disposition read present per-issue verdict files directly because writing the failed ledger is illegal.

**Chosen:** Claim detection and byte continuity only, never authorship.

## Open questions and assumptions

None. The three load-bearing calls the first autonomous pass parked on — must sequential tamper handling be mechanised, may a merge proceed while a tamper verdict is unresolved, and prevent-vs-detect under a shared UID — were resolved by the human and are ratified by the Decisions-register entry "Custody verdict enforcement for dispatched merges under a shared UID". This spec carries that direction; nothing here is left open.

## DONE — Definition of Done

- [ ] A dispatched merge cannot pass the sanctioned merge gate without an exact valid clean custody verdict.
- [ ] The specification and implementation do not claim mechanical evidence-consumption or scheduling prevention.
- [ ] `integrity-digest verify` accepts issue context, merge state, and canonical result arguments; atomically writes schema-version-1 clean/tamper/unavailable results; and returns the exact persisted SHA-256.
- [ ] Exit `0` requires a complete valid clean record; exit `1` requires valid tamper with non-empty paths; exit `2` records unavailable when possible. Recording failure never returns clean or leaves a partial target.
- [ ] Non-canonical, out-of-run, and issue-mismatched result paths refuse.
- [ ] No verdict field asserts authorship.
- [ ] The pure validator admits only exact valid clean and refuses all absent, unreadable, malformed, unknown-version, digest-mismatched, identity-mismatched, and non-clean records.
- [ ] Merge-gate derives the custody requirement from canonical lane-boundary state; malformed/indeterminate dispatched boundaries refuse; legacy/interactive behavior remains unchanged.
- [ ] Dispatched merge with omitted custody arguments refuses.
- [ ] Custody validation covers check-only, execute, remote, local/git-only, unmerged, and already-merged paths.
- [ ] Existing AC, review, CI, holdout, head-SHA, integrity, and collision gates remain intact.
- [ ] Raw remote/local merge remains denied by merge-fence.
- [ ] Fault injection around atomic rename never produces clean success without complete digest-matching bytes.
- [ ] `faff disposition` reads present verdicts without a ledger flag; tamper, unavailable, malformed, and identity mismatch produce needs-attention even for shipped/Done outcomes; legacy absence preserves prior behavior.

### Integration smoke test

1. Create an otherwise merge-eligible dispatched run whose lane-boundary declares the cut.
2. Snapshot protected members, modify `run-ledger.json`, and terminate the lane.
3. Invoke verify with canonical `--record-result`; assert exit `1`, atomic tamper record, named path, and returned digest.
4. Invoke merge-gate with path/digest; assert refusal and no merge execution.
5. Invoke merge-gate with custody arguments omitted; assert dispatch-derived refusal.
6. Attempt equivalent raw remote/local merge; assert merge-fence denial.
7. Invoke disposition; assert needs-attention from the verdict file.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized:** This is one coherent 1–3 day enforcement slice: atomic verdict creation, dispatch-derived requirement, exact-byte admission, merge-gate refusal, bypass denial, and post-merge visibility. A general executable dispatcher would be a separate architectural ticket.
- **Workstream fit:** Home it in "Graft evidence is tamper-evident end-to-end"; the observable result is that detected custody compromise cannot silently merge.
- **Dependencies:** FAFF-750 is a satisfied prerequisite because it moved merge above the dispatch cut. FAFF-690 is the established no-authorship precedent. The later disposition-authority slice depends on this verdict identity/storage contract; the authorship/docs slice is independent.
- **Risk:** The prompt-driven executor cannot mechanically enforce every earlier evidence read. This spec deliberately narrows its promise to the independently testable merge chokepoint.

## Self-review findings and resolutions

- **Blocker:** The first revision wrote incident state into a ledger whose failed custody check forbids that write. Resolved by moving the verdict outside the verified manifest.
- **Blocker:** A later revision claimed mechanical prevention of evidence consumption despite a prose executor. Resolved by narrowing the guarantee to sanctioned merge refusal.
- **Major:** Separate verify/record operations retained interruption and judgment gaps. Resolved with atomic `verify --record-result`.
- **Major:** Caller flags could be omitted. Resolved by deriving required custody from canonical lane-boundary state.
- **Major:** Path/identity alone permitted replacement. Resolved with exact-byte digest pinning.
- **Major:** Raw merge could bypass the gate. Resolved by retaining merge-fence and testing remote/local bypasses.
- **Minor:** Missing verdicts cannot identify every legacy run retrospectively. Retained as an honest rollout limit; dispatched merges refuse synchronously.

All blocking and major findings were applied and resolved in the spec above. At production the mandatory review's surfaced-blockers rule held the producer's self-rating at `confidence: medium` despite closed decisions; that caution was an in-loop-human gate ("a human should weigh in before an unattended build"), not an unresolved spec defect. The 2026-08-15 re-rate (below) records the human discharging that gate, which is why confidence now stands at high.

## Live-thread reconciliation (narrow-prep re-rate, 2026-08-12)

The human Decisions-register entry "Custody verdict enforcement for dispatched merges under a shared UID" was posted after this spec was last revised. Its `**Chosen:**` — a dispatched merge must present an exact, valid, clean per-issue custody verdict; `integrity-digest verify` atomically records that verdict outside the checked manifest; `merge-gate` derives the requirement from canonical lane-boundary state and binds admission to the exact recorded bytes by SHA-256 — matches the direction this spec already carries in full. It ratifies the enforcement, merge-ordering, and shared-UID trust decisions rather than opening or changing any of them.

Re-rate outcome (2026-08-12): confidence **held at medium** — not an open-decision hold (every decision is `**Chosen:**` and human-ratified) but a deliberate human-in-the-loop gate before an unattended build of security-critical merge-gate work whose design took two blocker-level corrections in adversarial review.

## Live-thread reconciliation (narrow-prep re-rate, 2026-08-15)

Post-spec comment scan (newest-first) found one substantive human comment after the 2026-08-12 re-rate: **`accepted, unparked`** (2026-08-15), authored by the repo owner, alongside removal of the `faff-parked` label — and the same operator immediately fired `/faff-beep-boop FAFF-784`. Classification: **Resolution**. The retained-medium's sole documented meaning across every prior pass was "a human should weigh in before an unattended build" (the human-in-the-loop gate on security-critical merge-gate custody). The human has now weighed in and accepted, and chose the autonomous-build unpark path (comment the decision, re-run `/faff-beep-boop`) over the interactive-supervision path.

Re-rate outcome (2026-08-15): confidence **promoted to high**. The gate that alone kept the spec at medium is discharged by the human's explicit acceptance; no `**Chosen:**` decision is opened or changed, so this is a control-surface re-rate under gateway Live-thread reconciliation, not a producer re-rating past its own blocker-downgrade rule. The retained `spec-review: approve` stands, reconciled through this live-thread scan: the acceptance changes no reviewed decision, so no adversarial re-review of an unchanged approach is warranted. Routing verdict on the refreshed spec: `fire-and-forget`.

spec-review: approve

build-tier: complex

confidence: high

```faff-contract:spec-readiness
{
  "confidence": "high",
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
    { "marker": "chosen" }
  ]
}
```
