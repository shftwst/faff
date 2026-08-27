# nlspec — FAFF-895: per-issue merge-floor custody verdict on the interactive `--pr` L4 path

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-895.
> build-tier: complex

This spec is the buildable artifact for FAFF-895, a feature/investigation ticket that closes the remote-backed sibling of the gap FAFF-892/893 closed on the interactive `--local` path. Its audience is the build agent that will implement the change and the human reviewers who gate it. FAFF-895 confirms — then closes — the same L4 merge-floor corrective-integrity gap on the interactive, remote-backed `--pr` merge path: it broadens FAFF-893's interactive custody-stamp producer so the stamp is also produced and threaded on the top-level interactive `--pr` L4 merge, honestly labelled as a self-consistency stamp, reusing the same primitives. The investigation half is already discharged in this spec's WHY: the gap is confirmed by reading the merge-floor code, and it does **not** collapse to a no-op.

## 1. WHY — problem and principles

**The load-bearing model.** faff's merge floor at L4 needs an integrity basis before it lets a merge land. The historical basis is `mount-asserted` (a trusted cage stamps `FAFF_INTEGRITY_BOUNDARY`); on an ordinary interactive top-level graft session that boundary is honestly absent by design (ADR-0073), so `resolveIntegrity` falls to `unasserted-refuse` and `decideFloor` refuses at L4. FAFF-892 widened the floor to admit a second basis, `digest-verified` (ADR-0118), and FAFF-893 manufactured the `digest-verified` verdict on the interactive `--local` path. Crucially, **FAFF-892's widening lives in `resolveIntegrity` / `buildMergeFloorDigestVerify` inside `merge-gate.js`, which are shared by both merge branches** — `cmdMergeGate` (the `--pr` path) and `cmdMergeGateLocal` (the `--local` path) each call `buildMergeFloorDigestVerify(runDir, issue, custodyPathArg, custodyShaArg)` then `resolveIntegrity(runDir, issue, level, mfDigestVerify)` identically. So the *consumer* half is already path-agnostic; only the *producer* half (FAFF-893's graft sub-step + ship pass-through) was scoped to `--local`.

**Problem statement.** A runbook-correct interactive **`--pr`** L4 run with honest-absent `FAFF_INTEGRITY_BOUNDARY` and clean evidence cannot merge: the top-level interactive graft merge on a repo *with* a remote ships via `faff merge-gate --pr … --execute`, which runs the identical level-keyed integrity leg, but nothing on the `--pr` orchestration path produces or threads a custody verdict, so the floor sees no `digest-verified` basis and refuses — exactly as `--local` did before FAFF-893. FAFF-895 has the top-level interactive `--pr` L4 session snapshot its own forge surface, verify-and-record a custody verdict, and thread the retained sha256 into the ship producer's `--pr` merge-gate invocation, so FAFF-892's already-landed, path-agnostic fold admits it.

**The gap is confirmed, not assumed (the investigation half of the ticket).** Reading `plugin/skills/faff/bin/lib/merge-gate.js`: `cmdMergeGate` (PR path) evaluates custody (line ~1119), builds the merge-floor digest verify union (line ~1148), and resolves integrity keyed on the anchor `level` (line ~1149) — the same three calls `cmdMergeGateLocal` makes. With no `--custody-verdict` flags, `buildMergeFloorDigestVerify` returns `{held:false}`, the fold reaches the unasserted branch, and at L4 `resolveIntegrity` yields `unasserted-refuse` → `decideFloor` refuses. The `--pr` path therefore does **not** admit differently; the gap is real and the ticket does not collapse to a no-op. The producer-side carve-outs that leave it open are explicit in prose today: graft's _Interactive custody stamp sub-step_ says "skip … on `--pr` — nothing consumes it there", and faffter-noon-ship step 3 says "the `--pr` invocation above passes no custody flags." Both statements are now stale — the PR-path consumer exists (FAFF-892) — and are what this ticket corrects.

**Design principle — the two custody bases are never conflated.** The verdict FAFF-895 threads on the `--pr` path is a self-consistency stamp, identical in meaning to FAFF-893's `--local` stamp: the same trusted graft session that wrote the evidence attests, right now, that its own forge surface is internally consistent against a manifest it just took. It is **not** the dispatched detective-custody boundary (gateway obligations 5 to 7), and the local-vs-remote *merge mechanism* (`gh pr merge` vs a local base-ref move) does not change the trust model — on interactive top-level graft the human-supervised session is the trusted side (ADR-0077) whether or not the repo has a remote. The verdict must never be fed through `FAFF_INTEGRITY_BOUNDARY` and never be labelled detective custody. Reject any implementation that blurs the two.

**Design principle — no new code, compose the shipped primitives.** The verify-and-record shell (`integrity-digest snapshot --issue` → `verify --record-result`), the canonical `custody-verdict.json` path, the atomic write, the pure `computeCustodyVerdictAdmission` admission gate, and the `--pr`-path consumption in `merge-gate.js` are all already landed and already path-agnostic. FAFF-895 broadens two SKILL.md prose loci and adds a test; it changes no code in `integrity-digest.js`, `merge-gate.js`, `corrective-integrity.js`, or `contract-defs.js`, exactly as FAFF-893 changed none.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (Node) | `cmdMergeGate` (the `--pr` branch) already parses `--custody-verdict` / `--custody-verdict-sha256`, calls `evaluateCustody`, then `buildMergeFloorDigestVerify` + `resolveIntegrity` keyed on `level` — the identical consumer the `--local` branch uses. Not modified by this ticket; it is the proof the gap is threading-only. |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JavaScript (Node) | `snapshot --issue` builds the seven-entry manifest; `verify --record-result` (`verifyAndRecord`) atomically writes `custody-verdict.json` and returns the persisted `verdict_sha256`. Composed as-is; not modified. |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | JavaScript (Node) | `correctiveIntegrityDirs(runDir, issue)` returns the seven-member per-issue surface (member-count contract lines ~205-211: `correctiveIntegrityDirs(runDir, issue) -> 7`). |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (Node) | `computeCustodyVerdictAdmission` admits only an exact valid clean record whose bytes hash to the retained sha256. Reused; not modified. |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | Step 10 top-level branch hosts the _Interactive custody stamp sub-step_; its gate is broadened here from `--local` to the top-level interactive L4 path (`--local` **or** `--pr`). |
| `plugin/skills/faffter-noon-ship/SKILL.md` | Skill prose | The default `ship` producer; step 3 invokes `faff merge-gate --pr … --execute` (remote) and `--local … --execute` (git-only). Its custody-flag pass-through is broadened to the `--pr` invocation. |
| `records/specs/2026-08-20-faff-893-per-issue-merge-floor-custody-verdict-design.md` | Spec | The `--local` sibling this mirrors; its OUT OF SCOPE names FAFF-895's exact extension point (the `--pr` branch / ship step-3 PR invocation). |

**Scope statement.** FAFF-895 sits at the interactive top-level graft merge locus (Step 10) and its downstream `ship` producer, on the remote-backed `--pr` L4 path — the sibling of FAFF-893's git-only `--local` locus. It produces one artifact (`custody-verdict.json`) and threads one pair of flags on the `--pr` invocation; it does not touch the merge-floor decision (FAFF-892, landed) or `merge-gate.js` at all.

## 2. OUT OF SCOPE

- **Any change to `merge-gate.js` or the merge-floor fold.** What's excluded: widening, re-keying, or re-pathing the integrity leg. Why excluded: FAFF-892 already landed a path-agnostic fold that the `--pr` branch already calls; the `--pr` consumer needs nothing added. Extension point: none — this is the finding that keeps the ticket to prose + a test.
- **The dispatched-lane / concurrency-executor custody producer.** What's excluded: emitting `lane-boundary.json` for a build lane and running `verify --record-result` on a dispatched merge. Why excluded: that is detective custody with a different trust model and locus (obligations 5 to 7), tracked separately as FAFF-894. Extension point: the concurrency executor / dispatched build lane.
- **The `--local` producer itself.** What's excluded: re-implementing or duplicating FAFF-893's `--local` sub-step. Why excluded: this ticket broadens the *existing* sub-step's gate to cover both modes, not a parallel second sub-step. Extension point: the shared sub-step in graft Step 10.
- **The real mount / `FAFF_INTEGRITY_BOUNDARY` assertion (FAFF-517).** What's excluded: standing up an actual asserting cage on the remote-backed path. Why excluded: the interactive path is honest-absent by design; the digest basis is the fallback, not a replacement for the mount. Extension point: FAFF-517.
- **L1–L3 and dispatched `--pr` merges.** What's excluded: producing the stamp at lower levels or under a dispatch cut. Why excluded: the digest basis is only consumed by the L4 integrity leg, and a dispatch cut moves custody to the detective-custody world above. Extension point: none.

## 3. WHAT — vocabulary, types, and the CLI round-trip

**Vocabulary.**

| Term | Definition |
|---|---|
| Forge surface (per-issue) | The seven paths `correctiveIntegrityDirs(runDir, issue)` returns: the shared run-level members plus the per-issue evidence files (`corrective/`, `run-ledger.json`, `ac-checklist.json`, `review-verdict.json`, `holdout.json`, `merge-record.json`, `post-merge-verification.json`). |
| Custody verdict | The `custody-verdict.json` record at `<run-dir>/<issue>/custody-verdict.json`, written atomically by `verifyAndRecord`, classified `clean` / `tamper` / `verification-unavailable`. |
| Self-consistency stamp | The interactive-path meaning of a `clean` custody verdict: the same trusted session attests its own forge surface is internally consistent against a manifest it just took. Identical on `--local` and `--pr`; distinct from detective custody. |
| `digest-verified` basis | The integrity-floor basis FAFF-892's landed fold admits when a retained, matching, clean custody verdict is presented — the same fold on both merge branches. |
| Retained sha256 | The exact sha256 of the persisted `custody-verdict.json` bytes, returned by `verify --record-result --json` as `verdict_sha256`, held in the graft session's memory and handed to `merge-gate`. |
| `--pr` path | The remote-backed interactive top-level merge: graft/ship ship via `faff merge-gate --pr <n> … --execute` when the repo has a remote (`merge-gate --local` refuses on a repo with a remote). The mode is selected by remote presence, not by the custody step. |

**The persisted record (defined by FAFF-784, reproduced for the build agent — unchanged by this ticket).**

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

**The two-call round-trip FAFF-895 composes (identical to FAFF-893, zero code change).**

```
# 1. snapshot the seven-entry per-issue surface, capture the manifest in-session
manifest = $(faff integrity-digest snapshot --run-dir <run-dir> --issue <ISSUE-XX>)

# 2. verify against the held manifest and atomically record the verdict; capture the retained sha
result = $(faff integrity-digest verify \
            --run-dir <run-dir> \
            --manifest -            # the held manifest via stdin \
            --issue-context <ISSUE-XX> \
            --merge-state pre-merge \
            --record-result <run-dir>/<ISSUE-XX>/custody-verdict.json \
            --json)
# result.classification, result.verdict_path, result.verdict_sha256
```

**The `merge-gate` hand-off (flags already parsed on the `--pr` branch — the only new thing is that ship passes them there).**

```
faff merge-gate --pr <n> --issue <ISSUE-XX> --run-dir <run-dir> --level <level> \
  --custody-verdict <run-dir>/<ISSUE-XX>/custody-verdict.json \
  --custody-verdict-sha256 <result.verdict_sha256> \
  --execute --merge-args "--squash --delete-branch"
```

**Design decision — one broadened sub-step, or a second `--pr`-specific sub-step?** Options:

| Option | What it means | Verdict |
|---|---|---|
| (a) broaden the existing graft sub-step's gate from `--local` to "top-level interactive L4, non-dispatched — `--local` or `--pr`" | One producer, one honest-labelling paragraph, gate keys on level + non-dispatch, not on merge mechanism | Chosen |
| (b) add a parallel `--pr`-specific sub-step beside the `--local` one | Duplicated prose and duplicated honest-labelling, two things to keep in sync | Rejected |
| (c) move production into `merge-gate.js` so it self-produces on `--pr` | Epistemically empty (a one-shot process holds no prior manifest) and would be a code change | Rejected |

**Chosen:** option (a) — broaden the single sub-step. The custody production is mode-agnostic (it snapshots the same run-dir forge surface regardless of how the merge lands), so gating it on "top-level interactive L4, non-dispatched" and letting graft thread the flags onto whichever `merge-gate` invocation ship makes (`--pr` or `--local`) is the minimal, dedup-respecting change. Rationale: the house skimmability/dedup rule favours one paragraph over two; the trust model is identical across the two merge mechanisms, so a second sub-step would only restate it.

**Design decision — does the `--pr` merge admit differently, making this a no-op?** Options: (i) the `--pr` path admits on a different basis or path and needs no producer (ticket collapses); (ii) the `--pr` path runs the same level-keyed integrity leg and needs the producer. Reading `cmdMergeGate` shows it calls the identical `buildMergeFloorDigestVerify` + `resolveIntegrity(runDir, issue, level, …)` the `--local` branch calls, with no `--pr`-specific integrity relaxation. **Chosen:** (ii) — the gap exists and the producer is required; the ticket does not collapse. This closes the ticket's first open question as a code-grounded fact, not a punt.

## 4. HOW — behaviour

**Architecture and approach.** On the top-level interactive (non-dispatched) graft path at L4, Step 10 runs the merge locus in-session. After Steps 8 and 9 have written the AC checklist and review verdict (per-issue members of the seven-entry surface), and only at L4 with no dispatch cut, graft snapshots the surface, verifies-and-records a custody verdict, and captures the retained sha256. It then hands `--custody-verdict` and `--custody-verdict-sha256` to the `ship` producer, which forwards them **on whichever `merge-gate` invocation it makes** — `--pr` when the repo has a remote, `--local` when git-only. FAFF-892's landed, path-agnostic integrity leg reads the verdict and, on a clean admission against the retained sha, admits the `digest-verified` basis so `decideFloor` no longer refuses.

**When the custody step runs (the broadened gate).**

```
PROCEDURE interactive_custody_step(run_dir, issue, level, dispatch_cut):
  # Runs inside graft Step 10 top-level branch, before the ship hand-off.
  1. IF dispatch_cut is in effect (EvidenceReturn path) → SKIP   # dispatched custody is FAFF-894's world
  2. IF level != L4 → SKIP                                       # the digest basis is only consumed by the L4 integrity leg
  3. # NOTE: no --local/--pr gate — production is mode-agnostic; the mode is settled later by remote presence
  4. Ensure Steps 8 and 9 have written ac-checklist.json and review-verdict.json  # surface members exist
  5. manifest := integrity-digest snapshot --run-dir run_dir --issue issue
  6. result := integrity-digest verify --run-dir run_dir --manifest manifest \
                 --issue-context issue --merge-state pre-merge \
                 --record-result <run_dir>/<issue>/custody-verdict.json --json
  7. Retain result.verdict_sha256 in-session
  8. Pass --custody-verdict <result.verdict_path> and --custody-verdict-sha256 <result.verdict_sha256>
     to the ship producer alongside the existing --pr|--local/--issue/--run-dir/--level args
```

**Ship producer threading (broadened to the `--pr` invocation).**

```
PROCEDURE ship_merge(args):
  # faffter-noon-ship step 3
  1. Read the existing --pr|--local/--issue/--run-dir/--level args
  2. IF graft passed --custody-verdict and --custody-verdict-sha256:
       forward BOTH, unchanged, on the merge-gate invocation — whether it is --pr or --local
  3. Invoke either:
       faff merge-gate --pr <n> --issue <ID> --run-dir <dir> --level <level> \
         [--custody-verdict <path> --custody-verdict-sha256 <sha>] --execute --merge-args "--squash --delete-branch"
     or (git-only):
       faff merge-gate --local --issue <ID> --run-dir <dir> --level <level> \
         [--custody-verdict <path> --custody-verdict-sha256 <sha>] --execute
  4. The producer never mints, re-hashes, or inspects the verdict — it only relays the two flags.
```

**Behaviour summary.** The step manufactures a sha256-pinned self-consistency stamp of the per-issue forge surface at pre-merge time and carries its digest to whichever merge interlock ship invokes, so the merge floor has a `digest-verified` basis to admit on the remote-backed `--pr` path exactly as it already does on `--local`.

**Ordering.** The custody step runs after Steps 8 and 9 (so the AC checklist and review verdict are on disk and part of the snapshotted surface) and before the ADR-accept sub-step and the effects declare, so the verdict captures the surface as it stands at the moment graft commits to merging — identical to FAFF-893's ordering. It runs alongside, and independently of, the L4 holdout gate; a non-`meets-spec` holdout still blocks the merge on its own leg.

**Edge cases and error handling.**

| Condition | Behaviour |
|---|---|
| `verify --record-result` returns exit 0 (`clean`) | Retain `verdict_sha256`; thread both flags; proceed to hand-off. |
| Exit 1 (`tamper`) | The verdict records `tamper`; still thread the flags. `computeCustodyVerdictAdmission` admits only `clean`, so the `--pr` floor refuses. Treat as a merge-floor refusal, not a crash. |
| Exit 2 (`verification-unavailable` or record failure) | The verdict, if written, records `verification-unavailable`; if nothing persisted, no verdict file exists. Either way admission refuses (absent or non-clean). Surface the blocker; do not merge. |
| Snapshot fails (surface member unreadable) | `verify` degrades classification to `verification-unavailable`; the floor refuses. |
| `--custody-verdict` bytes altered after recording | Admission sees a digest mismatch against the retained sha and refuses. |
| Repo has a remote (merge is `--pr`) but graft threaded no flags | The `--pr` floor sees `{held:false}` → `unasserted-refuse` at L4 → refuses. This is precisely today's gap, and precisely what threading the flags closes. |
| Not L4, or a dispatch cut in effect | The custody step is skipped entirely; no verdict, no flags — byte-for-byte today's behaviour. |

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure: the `--pr` floor keys on something the `--local` floor does not.** The whole ticket rests on `cmdMergeGate` and `cmdMergeGateLocal` sharing the fold. How you'd know: a clean `custody-verdict.json` with a matching retained sha is threaded, and `faff merge-gate --pr … --execute` still returns `refuse` with an integrity-basis blocker at L4. What it means: the two branches have diverged since this spec was written — re-diff `resolveIntegrity`/`buildMergeFloorDigestVerify` call sites before assuming the producer is wired wrong.
- **The failure: the self-consistency stamp is mistaken for detective custody on the remote path.** A reader assumes the remote `gh pr merge` makes the stamp a cross-lane custody boundary. How you'd know: the verdict is fed through `FAFF_INTEGRITY_BOUNDARY`, or the prose calls the `--pr` stamp a custody boundary. What it means: the two-basis discipline (ADR-0061 / ADR-0114 / ADR-0118) is violated; correct the wording to self-consistency stamp. The merge mechanism does not change the trust model.
- **The failure: the stamp adds no admission a presence check did not already give.** On the interactive path the surface is written and read by the same session, so a `clean` verdict is nearly always obtainable — it is an admission key, not a security signal. How you'd know: the only observable effect is `decideFloor` flipping from refuse to admit on `--pr`. What it means: proceed with the honest framing; this is a structural unblock of the remote path, not a security gain, and the spec says so on purpose.

**Anti-patterns.**

- **Anti-pattern:** adding a second `--pr`-specific custody sub-step. Why: the production is mode-agnostic; duplicating it duplicates the honest-labelling prose and creates two things to keep in sync.
- **Anti-pattern:** editing `merge-gate.js` to make the `--pr` path admit the digest basis. Why: it already does (FAFF-892); the only missing half is the producer threading the flags.
- **Anti-pattern:** having `merge-gate` self-snapshot and self-verify on `--pr`. Why: a one-shot process holding no prior manifest detects nothing `resolveIntegrity` / `readAcComplete` do not already check — it degenerates to a file-exists check dressed as custody.
- **Anti-pattern:** reading the verdict at admission with a bare path read instead of `computeCustodyVerdictAdmission` against the retained sha. Why: a writable-path read admits a swapped file; the retained-sha pin is the whole point.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an interactive, non-dispatched L4 --pr graft run on a repo with a remote, with clean evidence
  (ac-checklist.json all-verified, review-verdict pass) and honest-absent FAFF_INTEGRITY_BOUNDARY
When graft Step 10 top-level branch runs the broadened custody step before the ship hand-off
Then a custody-verdict.json exists at <run-dir>/<ISSUE-XX>/custody-verdict.json, classification "clean",
  and its verdict_sha256 is threaded to the ship producer's faff merge-gate --pr invocation
```

Non-functional assertions:

- The digest verdict is never passed to `correctiveIntegrityProbe`, `integrityGate`, or the pid-1 environ read; the mount probe's inputs on the `--pr` path are byte-identical to today.
- `integrityGate` (corrective-integrity.js), `integrity-digest.js`, and `merge-gate.js` bytes are unchanged by this ticket.
- The `--pr` custody verdict is admitted only via `computeCustodyVerdictAdmission` with a caller-retained sha256; no writable-path-trusted verdict is ever admitted.
- The `--local` path's behaviour (FAFF-893) is byte-for-byte unchanged — the same sub-step now simply also fires when the merge is `--pr`.

## 6. Design decision rationale

**Does the `--pr` L4 merge actually hit the gap, or does it admit differently?** Options: it collapses to a no-op (PR path admits on another basis), or it needs the producer. `cmdMergeGate` calls the identical `buildMergeFloorDigestVerify` + level-keyed `resolveIntegrity` as `cmdMergeGateLocal`, with no `--pr`-specific integrity relaxation, so with no custody flags it yields `unasserted-refuse` at L4. **Chosen:** the gap exists and the producer is required — grounded in the merge-gate source, not assumed. This closes the ticket's first open question.

**One broadened sub-step vs a second `--pr` sub-step.** A parallel sub-step duplicates the mode-agnostic production and the honest-labelling prose. **Chosen:** broaden the existing gate to "top-level interactive L4, non-dispatched" and thread onto whichever `merge-gate` invocation ship makes — one producer, one honest paragraph, keyed on level and non-dispatch rather than on merge mechanism.

**Where does the verdict come from on `--pr`?** The same graft Step 10 top-level branch + ship step-3 invocation as `--local` — FAFF-893's OUT OF SCOPE named exactly this locus ("the `--pr` branch … / the ship step-3 PR invocation"). **Chosen:** reuse the FAFF-893 locus and the two-call `snapshot → verify --record-result` compose verbatim; no new subcommand. This closes the ticket's second open question.

At the time of writing, FAFF-892 (the fold) and FAFF-893 (the `--local` producer) are both landed (Done), so unlike FAFF-893 — which had to validate its admits-scenario against an unlanded fold — FAFF-895's `--pr` admit scenario is exercisable end to end today.

## 7. Open questions and assumptions

**Open Questions.** None. The ticket's two open questions are both closed by reading the merge-floor source: (1) the gap exists on `--pr` L4 (the PR branch runs the identical level-keyed integrity leg); (2) the producer locus is the same graft Step 10 + ship step-3 invocation as `--local`. Both are recorded as `**Chosen:**` decisions in section 6, grounded in code, not left as punts.

**Assumptions.**

- **Assumes:** FAFF-892's merge-floor fold is landed and path-agnostic — `cmdMergeGate` (PR) and `cmdMergeGateLocal` both call `buildMergeFloorDigestVerify` + `resolveIntegrity`. Validate: confirm both call sites in `merge-gate.js` (around lines 1148-1149 for `--pr`, 940-941 for `--local`) still share the fold; FAFF-892 is Done (PR #739).
- **Assumes:** FAFF-893's `--local` interactive custody-stamp sub-step is landed in `faff-graft/SKILL.md` and `faffter-noon-ship/SKILL.md`. Validate: grep for the _Interactive custody stamp sub-step_ heading in graft and the _Custody-flag pass-through_ paragraph in ship; FAFF-893 is Done (PR #738).
- **Assumes:** the FAFF-784 primitives are reusable as-is — `snapshot --issue`, `verify --record-result` (`verifyAndRecord`), the canonical `custody-verdict.json` path, and `computeCustodyVerdictAdmission`. Validate: the round-trip is exercised green by `test/faff-893-custody-stamp.test.mjs`, and `correctiveIntegrityDirs(runDir, issue) -> 7` (member-count contract).
- **Assumes:** the top-level interactive merge on a repo with a remote ships via `faff merge-gate --pr … --execute` (ship step 3), and `merge-gate --local` refuses on a repo with a remote. Validate: `merge-gate.js` `cmdMergeGateLocal` refuses when `gitRemoteEmpty` is not `true`; ship step 3 selects `--pr` vs `--local` on remote presence.

## 8. DONE — definition of done

### From WHY
- [ ] A runbook-correct interactive, non-dispatched L4 `--pr` run with honest-absent `FAFF_INTEGRITY_BOUNDARY` and clean evidence produces a `custody-verdict.json`, threads its retained sha to `faff merge-gate --pr … --execute`, and (with FAFF-892 landed) reaches `merge-ok` — previously refused.
- [ ] The graft/ship prose that said the `--pr` path consumes / passes no custody flags is corrected; the SKILL.md states the `--pr` stamp is a self-consistency stamp, not detective custody, and never routes it through `FAFF_INTEGRITY_BOUNDARY`.

### From WHAT (types and CLI round-trip)
- [ ] `custody-verdict.json` is written at exactly `<run-dir>/<ISSUE-XX>/custody-verdict.json` via `verify --record-result` (never hand-written), `merge_state_at_verification: "pre-merge"`.
- [ ] The retained sha256 handed to `merge-gate --pr` is the `verdict_sha256` returned by `verify --record-result --json`, not a re-hash.

### From HOW (behaviour)
- [ ] The graft _Interactive custody stamp sub-step_ gate is broadened from `--local` to "top-level interactive L4, non-dispatched" (fires on `--pr` too); it remains skipped at L1–L3 and under a dispatch cut.
- [ ] The `ship` producer forwards `--custody-verdict` / `--custody-verdict-sha256` unchanged on its `merge-gate --pr` invocation whenever graft passed them, and omits them when it did not; the stale "the `--pr` invocation above passes no custody flags" carve-out is removed.
- [ ] The `--local` path (FAFF-893) behaviour is unchanged; the single sub-step now covers both merge mechanisms.

### From HOW (edge cases and failure modes)
- [ ] A `tamper` / `verification-unavailable` classification, an absent verdict, or a post-record byte alteration all yield a non-clean or non-matching admission so the `--pr` floor refuses.
- [ ] No code change is made to `integrity-digest.js`, `merge-gate.js`, `corrective-integrity.js`, or `contract-defs.js` (composition + prose only).

### Integration smoke test

```
PROCEDURE smoke_interactive_L4_pr_custody:
  1. Stand up an interactive non-dispatched L4 --pr run (repo with a remote) with clean ac-checklist +
     review-verdict and honest-absent FAFF_INTEGRITY_BOUNDARY (no lane-boundary.json)
  2. Run graft Step 10 to the ship hand-off
  3. ASSERT <run-dir>/<ISSUE-XX>/custody-verdict.json exists, classification == "clean"
  4. ASSERT the ship producer's faff merge-gate --pr invocation received --custody-verdict <that path>
     and --custody-verdict-sha256 <verdict_sha256>
  5. ASSERT faff merge-gate --pr … --execute admits on the digest-verified basis and merges (exit 0, merge-ok)
  6. ASSERT the same run with no flags threaded, and with a mutated verdict, both refuse
```

confidence: high
spec-review: approve

## Methodology critique

_Agile-delivery lens (`issue-critique`) — advisory; written for the next `/faff-wtf`, does not gate promotion._

- **Right-sized? No issues.** One cohesive 1–3-day unit: broaden a single graft sub-step gate + the ship pass-through to the `--pr` invocation, plus a test. The two prose loci are two halves of one thread (produce → forward) that always ship together — a split would strand a producer with no consumer, so merge-not-split is correct. No code change (the consumer half is FAFF-892, landed).
- **Workstream fit? No issues.** Sits squarely in the project "A current unattended run survives executor loss at safe boundaries" — it closes the remote-backed sibling of the L4 merge-floor integrity gap FAFF-892/893 closed for `--local`.
- **Deps surfaced? No issues.** FAFF-892 (fold) and FAFF-893 (`--local` producer) are both Done and linked related-to; correctly not modelled as blockers (already landed). FAFF-894 (dispatched-lane custody) is explicitly out of scope, not an implicit dep.
- **Risk profile? No issues.** No novel integration and no external dependency — reuses landed primitives with zero code change; the only new surface is prose + a CLI-level test. No de-risking spike warranted.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
