# nlspec — FAFF-893: per-issue merge-floor custody verdict on the interactive `--local` L4 path

> Spec: faffter-dark-nlspec · 2026-08-20 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-893.
> build-tier: complex

This spec is the buildable artifact for FAFF-893, an Urgent feature/orchestration ticket that unblocks FAFF-892. Its audience is the build agent that will implement the change and the human reviewers who gate it. FAFF-893 makes the interactive (non-dispatched) `--local` L4 build path produce, persist, and hand onward a per-issue custody verdict over the seven-entry forge surface, so that FAFF-892's widened merge-floor integrity leg can admit a `digest-verified` basis and let a runbook-correct L4 local run merge. This ticket only produces and threads the verdict; FAFF-892 consumes it.

## 1. WHY — problem and principles

**The load-bearing model.** faff's merge floor at L4 needs an integrity basis before it will let a merge land. The historical basis is `mount-asserted`: a trusted cage stamps `FAFF_INTEGRITY_BOUNDARY` and the floor reads it. On the ordinary interactive `--local` L4 path there is no cage and no dispatch cut, so `FAFF_INTEGRITY_BOUNDARY` is honestly absent by design (ADR-0073), `resolveIntegrity` falls to `unasserted-refuse`, and `decideFloor` refuses. FAFF-892 widens the integrity leg to accept a second basis, `digest-verified`, mirroring how `foldCorrectiveAuthority` already admits a non-mount basis (ADR-0114). FAFF-893's job is to manufacture the `digest-verified` verdict object that FAFF-892's fold keys on, over the seven-entry per-issue forge surface `correctiveIntegrityDirs(runDir, issue)`, sha256-pinned, and hand the retained hash to `merge-gate` on the `--local` invocation.

**Problem statement.** Today a runbook-correct interactive `--local` L4 run with clean evidence and honest-absent `FAFF_INTEGRITY_BOUNDARY` cannot merge, because the only integrity basis the floor recognises (`mount-asserted`) is permanently unreachable in-session. FAFF-893 has the interactive top-level graft session snapshot its own forge surface, verify-and-record a custody verdict, and thread the retained sha256 into `merge-gate --local`. With FAFF-892 landed, the floor then admits on the `digest-verified` basis and the merge proceeds.

**Design principle — the two custody bases are never conflated.** The verdict FAFF-893 produces on the interactive path is a self-consistency stamp: the same trusted graft session that wrote the evidence attests, right now, that its own forge surface is internally consistent against a manifest it just took. It is not the dispatched detective-custody boundary (gateway obligations 5 to 7), which exists to catch an untrusted dispatched lane mutating evidence between an orchestrator's snapshot and its consumption. On interactive top-level graft there is no untrusted party: ADR-0077 rules the human-supervised session is the trusted side. The spec, and the SKILL.md prose it lands, must state this distinction in words and never let a reader treat the interactive stamp as detective custody. Reject any implementation that blurs the two.

**Design principle — no security theatre, no boundary env var.** The interactive verdict must never be fed through `FAFF_INTEGRITY_BOUNDARY` and must never be presented as security-load-bearing (ADR-0061 / ADR-0073 / ADR-0114 two-basis non-conflation). It is produced only by the existing `integrity-digest verify --record-result` primitive, and admitted only by the existing `computeCustodyVerdictAdmission` against a caller-retained sha256, never a bare read of a writable path. Any uncertainty (tamper, verification-unavailable, digest mismatch, identity mismatch) yields a non-clean verdict that FAFF-892's fold refuses.

**Design principle — reuse the landed FAFF-784 primitives verbatim.** The verify-and-record shell, the canonical `custody-verdict.json` path, the atomic write, and the pure admission gate are already in `integrity-digest.js` and `contract-defs.js`. FAFF-893 composes them; it changes none of them.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JavaScript (Node) | `snapshot --issue` builds the seven-entry manifest; `verify --record-result` (`verifyAndRecord`, lines 234 to 308) is the atomic verify-and-record primitive that writes `custody-verdict.json` and returns the exact persisted sha256. Composed as-is; not modified. |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | JavaScript (Node) | `correctiveIntegrityDirs(runDir, issue)` returns the seven-member per-issue surface (member-count contract at lines 162 to 165). |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (Node) | `--local` branch already parses `--custody-verdict` / `--custody-verdict-sha256` (spec line 33) and passes them to `evaluateCustody` (line 881). On the interactive path `evaluateCustody` returns `{required:false}` and ignores them; FAFF-892 adds the second consumer that reads the same verdict. Not modified by this ticket. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (Node) | `computeCustodyVerdictAdmission` (line 860) admits only an exact valid clean record whose bytes hash to the retained sha256. Reused; not modified. |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | Step 10 top-level branch is the sole in-session merge locus and the landing site for the snapshot to verify-to-record composition. |
| `plugin/skills/faffter-noon-ship/SKILL.md` | Skill prose | The default `ship` producer; step 3 invokes `faff merge-gate --local ... --execute`. Needs the two custody flags added to its pass-through and its `--local` invocation. |

**Scope statement.** FAFF-893 sits at the interactive top-level graft merge locus (Step 10) and its downstream `ship` producer, on the git-only `--local` L4 path. It produces one artifact (`custody-verdict.json`) and threads one pair of flags; it does not touch the merge-floor decision, which is FAFF-892's.

## 2. OUT OF SCOPE

- **The dispatched-lane custody producer wiring.** What is excluded: emitting `lane-boundary.json` for a BUILD lane and running `integrity-digest verify --record-result` on the dispatched build path. Why excluded: FAFF-784's admission mechanism shipped in code, but no SKILL.md produces the verdict or emits `lane-boundary.json` for a build lane, so the dispatched custody gate is dormant on the emit side. That gap is a distinct detective-custody boundary (obligations 5 to 7), not the interactive self-consistency stamp this ticket produces, and it must not be conflated with it. Extension point: a sibling ticket that wires the concurrency executor / dispatched build lane to emit `lane-boundary.json` and call `verify --record-result`. Recommend filing it as a separate ticket; it should not ship inside FAFF-893 because the two producers have different trust models and different landing loci.
- **FAFF-892's merge-floor fold itself.** What is excluded: widening the integrity leg so `decideFloor` admits the `digest-verified` basis. Why excluded: FAFF-893 produces and threads the verdict; FAFF-892 consumes it. Extension point: `resolveIntegrity` / the integrity floor leg in `contract-defs.js` and `merge-gate.js`, owned by FAFF-892.
- **The real mount and `FAFF_INTEGRITY_BOUNDARY` assertion (FAFF-517).** What is excluded: standing up an actual asserting cage. Why excluded: the interactive path is honest-absent by design; the digest basis is the fallback, not a replacement for the mount. Extension point: FAFF-517.
- **The parallel / concurrency executor path.** What is excluded: producing the verdict inside the `faffter-dark-concurrency-parallel` executor's dispatched merge. Why excluded: under a dispatch cut the merge locus moves to the trusted dispatcher (obligation 7), which is the dispatched-custody world above; this ticket is the non-dispatched top-level path only.
- **The interactive PR path at L4 (`--pr`, remote-backed).** What is excluded: producing a digest verdict on the remote-backed L4 merge. Why excluded: the issue scopes FAFF-893 to `--local`. The same integrity-basis gap may exist on the PR path at L4; flag it as a related concern for a follow-up rather than silently assuming it is covered. Extension point: the `--pr` branch of `evaluateCustody` / the ship step-3 PR invocation.

## 3. WHAT — vocabulary, types, and the CLI round-trip

**Vocabulary.**

| Term | Definition |
|---|---|
| Forge surface (per-issue) | The seven paths `correctiveIntegrityDirs(runDir, issue)` returns: the shared run-level members plus the per-issue evidence files, per the member-count contract (`correctiveIntegrityDirs(runDir, issue) -> 7`). |
| Custody verdict | The `custody-verdict.json` record at `<run-dir>/<issue>/custody-verdict.json`, written atomically by `verifyAndRecord`, classified `clean` / `tamper` / `verification-unavailable`. |
| Self-consistency stamp | The interactive-path meaning of a `clean` custody verdict: the same trusted session attests its own forge surface is internally consistent against a manifest it just took. Distinct from detective custody. |
| Detective custody | The dispatched-path meaning of a custody verdict: a trusted dispatcher detects whether an untrusted lane mutated evidence between snapshot and consumption. Not produced by this ticket. |
| `digest-verified` basis | The integrity-floor basis FAFF-892 admits when a retained, matching, clean custody verdict is presented. FAFF-893 produces the verdict this basis keys on. |
| Retained sha256 | The exact sha256 of the persisted `custody-verdict.json` bytes, returned by `verify --record-result --json` as `verdict_sha256`, carried in the graft session's own memory and handed to `merge-gate`. |

**The persisted record (already defined by FAFF-784, reproduced for the build agent).**

```
RECORD CustodyVerdict:              # at <run-dir>/<issue>/custody-verdict.json, written atomically
  schema_version: 1                 # immutable
  run_id: String                    # basename(run-dir)
  issue: String                     # the issue id; matches <issue> in the path
  verified_at: Timestamp            # ISO 8601, set at record time
  merge_state_at_verification: "pre-merge" | "post-merge"
  classification: "clean" | "tamper" | "verification-unavailable"
  paths: List<String>               # tampered sub-paths ([] when clean)
  detail: String                    # human-readable, capped at CUSTODY_DETAIL_MAX

  CONSTRAINT no authorship/actor field is ever present (admission rejects unexpected fields)
  CONSTRAINT only classification == "clean" is admissible
```

**The two-call round-trip FAFF-893 composes (zero code change to `integrity-digest.js`).**

```
# 1. snapshot the seven-entry per-issue surface, capture the manifest in-session
manifest = $(faff integrity-digest snapshot --run-dir <run-dir> --issue <ISSUE-XX>)

# 2. verify against the held manifest and atomically record the verdict; capture the retained sha
result = $(faff integrity-digest verify \
            --run-dir <run-dir> \
            --manifest <manifest, via stdin '-' or a temp file> \
            --issue-context <ISSUE-XX> \
            --merge-state pre-merge \
            --record-result <run-dir>/<ISSUE-XX>/custody-verdict.json \
            --json)
# result.classification, result.verdict_path, result.verdict_sha256
```

**The `merge-gate` hand-off (flags already parsed on the `--local` branch).**

```
faff merge-gate --local --issue <ISSUE-XX> --run-dir <run-dir> --level <level> \
  --custody-verdict <run-dir>/<ISSUE-XX>/custody-verdict.json \
  --custody-verdict-sha256 <result.verdict_sha256> \
  --execute
```

**Design decision — where the verdict is produced (the merge locus).** Options:

| Locus | What it means | Custody strength | Verdict |
|---|---|---|---|
| (a) graft Step 10 top-level branch composes snapshot to verify --record-result, threads flags through ship | Same session that wrote evidence snapshots, verifies, records, then hands the retained sha to merge-gate | Self-consistency over the same actor's own writes | Chosen |
| (b) merge-gate self-snapshot-then-self-verify, unconditional | A one-shot standalone process snapshots and verifies itself with no manifest held across anything | Epistemically empty: detects nothing `resolveIntegrity` / `readAcComplete` do not already check | Rejected |
| (c) extend `evaluateCustody` / FAFF-892's fold to run at L4 unconditionally | A merge-gate-side admission policy | Still needs (a) to actually produce the verdict | Out of scope (FAFF-892) |
| (d) new `faff` subcommand wrapping snapshot+verify+record atomically | Same custody strength as (a); pure ergonomics | Optional; the two-call compose already works with zero code | Documented alternative |

**Chosen:** locus (a) — the graft Step 10 top-level branch composes the existing `snapshot --issue` to `verify --record-result` round-trip and threads `--custody-verdict` / `--custody-verdict-sha256` through the `ship` producer into the existing `merge-gate --local --execute` call. Rationale: the graft session holds the manifest in its own context between snapshot and verify, which is exactly the self-consistency claim being made; it requires zero code change to `integrity-digest.js`; and it lands the honest labelling in the SKILL.md prose where a human reads it.

**Design decision — one atomic subcommand vs the two-call compose.** Options: (i) two CLI calls (`snapshot` then `verify --record-result`) composed in the SKILL.md prose, zero new code; (ii) a thin new `faff` subcommand that runs snapshot, verify, and record in one process. The only edge (ii) buys is closing a same-session interrupt gap between the two calls. On the interactive top-level path the two calls run back to back inside one trusted session with no untrusted party between them, so that gap is low-risk.

**Chosen:** the two-call compose (option i) for v1 — it works end to end today with no code change and keeps the mechanism auditable as two named CLI invocations. A thin atomic wrapper is the documented extension point if a future path needs the interrupt gap closed (for example a dispatched producer, where FAFF-784's no-judgement-gap rationale bites harder).

## 4. HOW — behaviour

**Architecture and approach.** On the interactive (non-dispatched) top-level graft path, Step 10 runs the merge locus in-session. After Steps 8 and 9 have written the AC checklist and the review verdict (the per-issue evidence that forms part of the seven-entry surface), and only on the L4 `--local` path, graft takes a snapshot of the surface, verifies-and-records a custody verdict, and captures the retained sha256. It then hands `--custody-verdict` and `--custody-verdict-sha256` to the `ship` producer, which forwards them on its `faff merge-gate --local ... --execute` invocation. FAFF-892's widened integrity leg reads the verdict and, on a clean admission against the retained sha, admits the `digest-verified` basis so `decideFloor` no longer refuses.

**When the custody step runs.**

```
PROCEDURE interactive_custody_step(run_dir, issue, level, mode):
  # Runs inside graft Step 10 top-level branch, before the ship hand-off.
  1. IF a dispatch cut is in effect (EvidenceReturn path) → SKIP  # dispatched custody is a different ticket
  2. IF NOT (level == L4 AND git-only --local mode) → SKIP        # verdict is only consumed by FAFF-892's L4 integrity leg
  3. Ensure Steps 8 and 9 have written ac-checklist.json and review-verdict.json  # surface members exist
  4. manifest := integrity-digest snapshot --run-dir run_dir --issue issue
  5. result := integrity-digest verify --run-dir run_dir --manifest manifest \
                 --issue-context issue --merge-state pre-merge \
                 --record-result <run_dir>/<issue>/custody-verdict.json --json
  6. Retain result.verdict_sha256 in-session
  7. Pass --custody-verdict <result.verdict_path> and --custody-verdict-sha256 <result.verdict_sha256>
     to the ship producer alongside the existing --pr/--local/--issue/--run-dir/--level args
```

**Behaviour summary.** The step manufactures a sha256-pinned self-consistency stamp of the per-issue forge surface at pre-merge time and carries its digest to the merge interlock, so the merge floor has a `digest-verified` basis to admit instead of the permanently-absent `mount-asserted` one.

**Ship producer threading.**

```
PROCEDURE ship_local_merge(args):
  # faffter-noon-ship step 3, --local branch
  1. Read the existing --local/--issue/--run-dir/--level args
  2. IF --custody-verdict and --custody-verdict-sha256 were passed by graft:
       forward BOTH, unchanged, on the merge-gate --local invocation
  3. Invoke: faff merge-gate --local --issue <ID> --run-dir <dir> --level <level> \
               [--custody-verdict <path> --custody-verdict-sha256 <sha>] --execute
```

**Ordering.** The custody step runs after Steps 8 and 9 (so the AC checklist and review verdict are on disk and part of the snapshotted surface) and before the ADR-accept sub-step and the effects declare, so that the verdict captures the surface as it stands at the moment graft commits to merging. Under the L4 signal it runs alongside, and independently of, the holdout gate; a non-`meets-spec` holdout still blocks the merge on its own leg.

**Edge cases and error handling.**

| Condition | Behaviour |
|---|---|
| `verify --record-result` returns exit 0 (`clean`) | Retain `verdict_sha256`; thread both flags; proceed to hand-off. |
| Exit 1 (`tamper`) | The verdict records `tamper`; still thread the flags. FAFF-892's admission refuses (only `clean` admits), so the floor refuses and the merge is blocked. Treat as a merge-floor refusal, not a crash. |
| Exit 2 (`verification-unavailable` or record failure) | The verdict, if written, records `verification-unavailable`; if nothing was persisted, no verdict file exists. Either way FAFF-892's admission refuses (absent or non-clean). Surface the blocker; do not merge. |
| Snapshot fails (surface member unreadable) | `verify` degrades classification to `verification-unavailable` per `verifyAndRecord`; the floor refuses. |
| Non-canonical `--record-result` path passed | `verifyAndRecord` refuses before any write (canonical-path check is first). Fix the path; this is a build defect, not a runtime branch. |
| `--custody-verdict` bytes altered after recording | `computeCustodyVerdictAdmission` sees a digest mismatch against the retained sha and refuses. |
| Not L4, or not `--local`, or dispatch cut in effect | The custody step is skipped entirely; no verdict is produced and no flags are threaded. |

**Failure modes — how the approach falls over.**

- **The failure: FAFF-892 never keys on this exact verdict.** FAFF-893 produces and threads the verdict, but the admission it feeds lives in FAFF-892. If FAFF-892 lands a different basis shape (or admits the interactive path on a trusted-session basis instead, see the rationale fork), FAFF-893's verdict is produced but unconsumed and the merge still refuses. How you would know: a clean `custody-verdict.json` exists with a matching retained sha, and `merge-gate --local` still returns `refuse` with an integrity-basis blocker. What it means: the two tickets have not agreed on the basis vocabulary; hold FAFF-893's DONE against FAFF-892's landed fold, not against a mocked admission.
- **The failure: the self-consistency stamp is mistaken for detective custody.** A future reader or FAFF-892 implementer treats the interactive `clean` verdict as if it proved an untrusted lane did not tamper. How you would know: the verdict is fed through `FAFF_INTEGRITY_BOUNDARY`, or the SKILL.md prose describes it as a custody boundary. What it means: the two-basis discipline (ADR-0061 / ADR-0114) has been violated; the prose and any admission wording must be corrected to say self-consistency stamp.
- **The failure: the verdict adds no admission a presence check did not already give.** On the interactive path the surface is written and read by the same session, so a `clean` verdict is nearly always obtainable; it is an admission key, not a security signal. How you would know: the only observable effect of the whole step is that `decideFloor` flips from refuse to admit. What it means: proceed, but keep the honest framing; this is a structural unblock, not a security gain, and the spec says so on purpose.

**Anti-patterns.**

- **Anti-pattern:** having `merge-gate` self-snapshot and self-verify the surface. Why: a one-shot process holding no prior manifest detects nothing that `resolveIntegrity` / `readAcComplete` do not already check; it degenerates to a file-exists check dressed as custody.
- **Anti-pattern:** reading the verdict file at admission time with a bare path read instead of `computeCustodyVerdictAdmission` against a retained sha. Why: a writable-path read admits a swapped file; the retained-sha comparison is the whole point of pinning.
- **Anti-pattern:** producing the verdict on the dispatched path from this ticket's code. Why: that is detective custody with a different trust model and a different locus; conflating them breaks the two-basis discipline and pre-empts the sibling ticket.
- **Anti-pattern:** running the custody step at L1 to L3 or on the `--pr` path. Why: nothing consumes it there in this ticket's scope; it is noise.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an interactive, non-dispatched L4 --local graft run with clean evidence
  (ac-checklist.json all-verified, review-verdict pass) and honest-absent FAFF_INTEGRITY_BOUNDARY
When graft Step 10 top-level branch runs the custody step before the ship hand-off
Then a custody-verdict.json exists at <run-dir>/<ISSUE-XX>/custody-verdict.json,
  classification "clean", and its verdict_sha256 is threaded to merge-gate --local
```

```
Given the clean custody verdict from the scenario above and FAFF-892's widened integrity leg landed
When faff merge-gate --local --custody-verdict <path> --custody-verdict-sha256 <sha> --execute runs
Then the merge floor admits on the digest-verified basis and the merge lands (merge-ok)
```

```
Given a run where the forge surface cannot be fully read at snapshot time
When the custody step runs verify --record-result
Then the recorded classification is verification-unavailable (or no verdict is persisted on total failure)
  and the merge floor refuses rather than admitting a digest-verified basis
```

Non-functional assertions:

- The digest verdict is never passed to `correctiveIntegrityProbe`, `integrityGate`, or the pid-1 environ read; the mount probe's inputs are byte-identical to today.
- `integrityGate` (corrective-integrity.js) and `integrity-digest.js` bytes are unchanged by this ticket.
- The custody verdict is admitted only via `computeCustodyVerdictAdmission` with a caller-retained sha256; no writable-path-trusted verdict is ever admitted.

## 6. Design decision rationale

**Where is the verdict produced?** Options: (a) graft Step 10 top-level branch composes snapshot to verify-and-record and threads the flags; (b) merge-gate self-verifies unconditionally; (c) extend the fold at L4; (d) a new atomic subcommand. Option (b) is epistemically empty (a one-shot with no held manifest detects nothing new). Option (c) is a merge-gate admission policy and belongs to FAFF-892; it still needs a producer. **Chosen:** (a) — the graft session holds the manifest between snapshot and verify, which is exactly the self-consistency claim; zero code change to `integrity-digest.js`; the honest labelling lands where a human reads it.

**One atomic subcommand or the two-call compose?** Options: (i) two CLI calls composed in prose, zero new code; (ii) a thin wrapper closing the same-session interrupt gap. On the interactive top-level path the two calls run back to back inside one trusted session with no untrusted party between them, so the gap is low-risk. **Chosen:** (i) the two-call compose for v1 — it composes end to end today and stays auditable as two named invocations; (ii) is the documented extension point for a path where the interrupt gap matters (a dispatched producer).

**Produce a digest verdict at all, or have FAFF-892 admit the interactive path on a trusted-session basis?** The interactive session is already the trusted side (ADR-0077, FAFF-698 already trusts in-session ac-checklist and review-verdict). An alternative to producing any verdict is for FAFF-892's fold to admit the top-level `--local` path directly on a trusted-in-session basis, which would make FAFF-893 nearly a no-op. Weighing honestly: producing the verdict keeps one uniform custody-artifact vocabulary across the dispatched and interactive paths and keeps merge-gate's admission policy a single `computeCustodyVerdictAdmission` call regardless of who produced the verdict; a trusted-session basis is arguably more honest, since the interactive stamp is security-empty, but it forks the floor's admission logic into a separate code path and a separate basis label. The issue's own framing mandates the digest verdict ("so FAFF-892's widened merge-floor integrity leg can admit the `digest-verified` basis"). **Chosen:** produce the `digest-verified` verdict (the alternative, a trusted-session direct admit, is rejected here for uniform basis vocabulary and a single admission gate), with the explicit caveat that FAFF-892 and FAFF-893 must agree on this: FAFF-892 must widen its integrity leg to key on this verdict shape and label it `digest-verified`, honestly distinct from `mount-asserted`. This cross-ticket agreement is the confidence-capping factor and is tracked as an assumption below.

At the time of writing, FAFF-892 is not yet landed, so the admission side cannot be exercised against real fold code; FAFF-893's merge-admits scenario must be validated against FAFF-892 once it lands, not against a mock.

## 7. Open questions and assumptions

**Open Questions.** None blocking. The one live coordination point (does FAFF-892 admit on the digest-verified basis this ticket produces?) is captured as an assumption with a validation instruction rather than an open punt, because the issue framing already fixes the direction.

**Assumptions.**

- **Assumes:** FAFF-751 has landed, so `integrity-digest snapshot --issue <ID>` yields the seven-entry per-issue manifest. Validate: confirm `correctiveIntegrityDirs(runDir, issue) -> 7` (member-count contract, `corrective-integrity.js` lines 162 to 165) and that `integrity-digest.js` parses `--issue` (spec flags at line 185, snapshot branch builds `buildManifest(runDir, issue, events)`).
- **Assumes:** the FAFF-784 machinery is landed and reusable as-is: `verifyAndRecord` (`integrity-digest.js` 234 to 308), `custodyVerdictPath`, and `computeCustodyVerdictAdmission` (`contract-defs.js` 860). Validate: run the `faff integrity-digest verify --selftest`-covered round-trip, or confirm `merge-gate.js` line 598 already binds `computeCustodyVerdictAdmission`.
- **Assumes:** FAFF-892 widens the merge-floor integrity leg to admit the `digest-verified` basis keyed on this exact custody verdict (a clean record whose bytes hash to the threaded sha), on the `--local` L4 path, honestly distinct from `mount-asserted`. Validate: the merge-admits scenario must pass against FAFF-892's landed fold; until FAFF-892 lands, only the producer half (verdict written, sha threaded, flags forwarded) is exercisable. This is the cross-ticket agreement the two tickets must hold together.
- **Assumes:** `merge-gate --local` already parses and forwards `--custody-verdict` / `--custody-verdict-sha256` into `evaluateCustody` without change. Validate: `merge-gate.js` spec line 33 and the `--local` branch at lines 1012 to 1018. On the interactive path `evaluateCustody` returns `{required:false}` and ignores the flags today; FAFF-892 adds the second consumer.

## 8. DONE — definition of done

### From WHY
- [ ] A runbook-correct interactive, non-dispatched L4 `--local` run with honest-absent `FAFF_INTEGRITY_BOUNDARY` and clean evidence produces a `custody-verdict.json` and, with FAFF-892 landed, reaches `merge-ok` (previously refused).
- [ ] The SKILL.md prose states, in words, that the interactive verdict is a self-consistency stamp and not the dispatched detective-custody boundary, and never routes it through `FAFF_INTEGRITY_BOUNDARY`.

### From WHAT (types and CLI round-trip)
- [ ] `custody-verdict.json` is written at exactly `<run-dir>/<ISSUE-XX>/custody-verdict.json` via `verify --record-result` (never a hand-written file), with `merge_state_at_verification: "pre-merge"`.
- [ ] The retained sha256 handed to `merge-gate` is the `verdict_sha256` returned by `verify --record-result --json`, not a re-hash computed elsewhere.

### From HOW (behaviour)
- [ ] Graft Step 10 top-level branch composes `integrity-digest snapshot --issue` then `verify --record-result` after Steps 8 and 9, before the ship hand-off, only when level is L4 and mode is git-only `--local`.
- [ ] The custody step is skipped under a dispatch cut, at L1 to L3, and on the `--pr` path (no verdict written, no flags threaded).
- [ ] `--custody-verdict` and `--custody-verdict-sha256` are threaded from graft through the `ship` producer onto the `merge-gate --local ... --execute` invocation; the `ship` flag pass-through has a test.

### From HOW (edge cases and failure modes)
- [ ] A `tamper` or `verification-unavailable` classification, an absent verdict, or a post-record byte alteration all yield a non-clean or non-matching admission so the floor refuses (verified with FAFF-892 landed).
- [ ] No code change is made to `integrity-digest.js`, `merge-gate.js`, `corrective-integrity.js`, or the `integrityGate` / `computeCustodyVerdictAdmission` functions in `contract-defs.js` (composition only).

### Integration smoke test

```
PROCEDURE smoke_interactive_L4_local_custody:   # paired with FAFF-892
  1. Stand up an interactive non-dispatched L4 --local graft run with clean ac-checklist + review-verdict
     and honest-absent FAFF_INTEGRITY_BOUNDARY (no lane-boundary.json)
  2. Run graft Step 10 to the ship hand-off
  3. ASSERT <run-dir>/<ISSUE-XX>/custody-verdict.json exists, classification == "clean"
  4. ASSERT merge-gate --local received --custody-verdict <that path> and --custody-verdict-sha256 <verdict_sha256>
  5. With FAFF-892 landed: ASSERT merge-gate --local admits on the digest-verified basis and merges (exit 0, merge-ok)
```

confidence: medium
