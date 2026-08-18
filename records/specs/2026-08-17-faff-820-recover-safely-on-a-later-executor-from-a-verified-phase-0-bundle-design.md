# FAFF-820: recover safely on a later executor from a verified Phase 0 bundle

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-820.

This spec describes the recovery verb that lets a *fresh* executor, one with no copy of the original run's local directory, pick up an unattended run after the original executor was lost at a published safe boundary. It builds directly on FAFF-819 (Phase 0 recovery bundle publish plus fail-closed verify), which already shipped the produce-and-verify half in `plugin/skills/faff/bin/lib/bundle.js`.

## 1. Why: problem and principles

**The load-bearing idea.** A published bundle plus the git-remote store is a *portable, independently-verifiable snapshot of a run at one safe boundary*. Recovery is therefore a reconstruction problem, not a live-handoff problem: the fresh executor fetches the snapshot, proves it is genuine, rebuilds the run directory the existing resume machinery already knows how to read, and then the *shipped* resume path decides per issue whether to continue or park. Nothing new re-executes a protected effect; the recovery verb only materialises verified evidence and reports what it found.

**Problem statement.** Today `faff lights-out --resume <run-id>` (`resumeLightsOut` at `lights-out.js` line 1088) refuses unless `.faff/runs/<run-id>/run-ledger.json` exists locally, so a run whose executor and local directory are both gone cannot be resumed. FAFF-819 publishes a verifiable bundle at each safe boundary but stops at verify. This ticket adds the step that turns a verified bundle back into a local run directory on any executor, so the run can continue or park with a founded reason instead of being abandoned.

**Design principles.**

- **Consume only a CLEAN bundle.** FAFF-819's six-value verdict ladder (`classifyBundle`, `bundle.js` line 212: CLEAN, STALE, MISSING, MALFORMED, TAMPERED, VERIFICATION_UNAVAILABLE) is the sole admission gate. Any verdict other than CLEAN produces an explicit refused disposition, never a partial reconstruction.
- **Never trust a recorded claim about a protected effect.** The house pattern `reconcile-recover.js` follows: re-run `verifyPostMerge` against live forge state rather than trust a `merge-record.json` that says `merged:true`. A shipped issue whose merge cannot be proven from bundle bytes parks, never skips.
- **Reconstruct only what the bundle proves.** A live shell, running container, uncommitted worktree, or per-issue build state that is not in the seven-member set is not claimed as recovered.
- **Fail closed on any ambiguity.** Unknown or ambiguous effect state, an unresolvable liveness question, or two equally-recent candidate bundles all resolve to park or refuse.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/bundle.js` | FAFF-819 produce plus verify: `verifyBundleIdentity`, `classifyBundle`, `resolveBundleStore`, `listBoundaries`, the two store occupants. Reused verbatim. |
| `plugin/skills/faff/bin/lib/resume.js` | Pure resume cores: `classifyReEnterable`, `reconstructResumePlan`, `resolveShippedDivergence`. The reconstructed run directory is handed to these unchanged. |
| `plugin/skills/faff/bin/lib/lights-out.js` | `resumeLightsOut` (line 1088): the existing local resume path that must stay available for runs whose local directory is present. |
| `plugin/skills/faff/bin/lib/reconcile-recover.js` | FAFF-797 recover verb: the detect then gate then write then report shape, and the pure-core-behind-a-thin-shell split this verb mirrors. |
| `plugin/skills/faff/bin/lib/effects.js` | `computeEscapes` (line 84): observed-minus-declared per issue and step, the escaped-effect primitive recovery reuses over the anchor's `declared-effects.jsonl`. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | `computeBundleVerdict` is the template for the new recovery-disposition verdict. |

## 2. Out of scope

- **Continuing the run (the owner-epoch write).** Recovery reconstructs and previews; it does not bump `owner.epoch`, write `owner.status`, or re-admit work. Why: keeps continuation in the shipped `resumeLightsOut` path, avoids a fourth external writer of `owner.status` (precedents ADR-0056, ADR-0057, ADR-0098, ADR-0115). Extension: after `faff bundle-recover` reports `reconstructed`, run `faff lights-out --resume <run-id>` against the now-present directory.
- **The cross-box recovery-claim mutex (FAFF-863).** Preventing two executors from *continuing* the same recovered run concurrently is scoped to FAFF-863 (a write-once recovery-claim ref at the continuation boundary), not this verb. Why: this verb is read-only and cannot itself double-continue; the mutex belongs where owner state is actually written. Extension: FAFF-863.
- **Live-forge re-derivation of merge state (skip-as-proven-merged).** Recovery makes no forge call and cannot skip a shipped issue as proven-merged. Why: merge-evidence acceptance is FAFF-823's job (which this ticket unblocks); staying offline matches `bundle.js`'s checkout-free verify posture. Extension: FAFF-823 adds forge re-derivation, FAFF-845 adds the merge pointer.
- **Adding bundle members (`merge-record.json`, `landing-progress.json`).** Recovery reads exactly FAFF-819's seven-member set. Why: FAFF-845 enriches the bundle (its member set now includes `landing-progress.json`) and depends on this ticket's read contract, not the reverse; FAFF-842 is the consumer that needs `landing-progress.json` in the bundle. Extension: `mintIssueAnchor` (`events.js` line 1197) and `REQUIRED_MEMBERS` (`bundle.js` line 30).
- **A third-party object-store occupant.** Only FAFF-819's two occupants (`local`, `git-remote`) are supported.

## 3. What: types and decisions

**Vocabulary.** *Recovering executor*: a fresh executor with no `.faff/runs/<run-id>/` for the target run, invoking `faff bundle-recover`. *Cross-run discovery-by-issue*: finding the most recent verified bundle for an issue across all runs, because the recovering executor does not know which run last touched it. *Reconstruction*: writing the bundle's members back into a local `.faff/runs/<run-id>/` and `.faff/anchors/<run-id>/<boundary-key>/` layout. *Recovery disposition*: the verb's machine-checkable outcome (`reconstructed`, `noop-already-present`, or `refused`) with reason and source bundle identity.

**The recovery-disposition record.**

```
RECORD RecoveryDisposition:
  verb: "bundle-recover"
  disposition: Enum{reconstructed, noop-already-present, refused}
  bundle_verdict: Enum{CLEAN, STALE, MISSING, MALFORMED, TAMPERED, VERIFICATION_UNAVAILABLE}
  bundle_identity: BundleIdentity | null
  run_id: String
  run_dir: String | null
  boundary_kind: Enum{issue-merge-floor, run-close}
  reason: String
  resume_preview: ResumePlan | null
  candidates_considered: Int
  CONSTRAINT disposition == "refused"  IFF  bundle_verdict != "CLEAN" OR discovery/ambiguity refused
  CONSTRAINT disposition == "reconstructed"  =>  run_dir != null AND resume_preview != null
```

`BundleIdentity` is FAFF-819's shape unchanged: `{run_id, run_segment_id, boundary_kind, boundary_key, boundary_seq}`. `ResumePlan` is `reconstructResumePlan`'s shape unchanged (`skip`, `continue_review`, `continue_from_push`, `redispatch`, `park`, `terminal`, `drain_remainder`).

**CLI surface.** `faff bundle-recover --issue ISSUE-ID [--run-id ID] [--root DIR] [--dry-run] [--json] [--selftest]`. `--run-id` narrows discovery to one run; `--dry-run` does discover plus verify plus resume-preview and prints the disposition without writing the run directory.

**Verb name and placement. Chosen:** a top-level `bundle-recover` verb, region `factory`, in a new `plugin/skills/faff/bin/lib/bundle-recover.js` reusing `bundle.js`'s exports; wired as one require plus one `COMMANDS` entry in `bin/faff`, one `docs/guide/cli.md` row (CI-checked by `faff lint-cli-doc`), one `REGION_SELFTEST_ARGV` entry in `regions.js`. Follows the `reconcile` (read-only) / `reconcile-recover` (the write) precedent.

**Cross-run discovery mechanism. Chosen:** discovery is store-specific and reuses each occupant's primitives.

| Store | Discovery mechanism | Scope |
|---|---|---|
| `git-remote` | `git ls-remote origin 'refs/faff/bundles/*/seg-*/<ISSUE>'` enumerates every run's boundary ref for the issue; each candidate verified through `verifyBundleIdentity`. Reuses the `ls-remote` glob idiom in `gitRemoteBundleStore.listBoundaries` (`bundle.js` line 474), widened from one run to all. | Off-box: works from any box that can reach the remote. |
| `local` | Scan `.faff/bundles/*/seg-*/<ISSUE>/` under the root, verifying each. | Same-box only: survives run-directory pruning, does not cross boxes. |

**Most-recent selection and ambiguity. Chosen:** `boundary_seq` is monotonic only within a `(run_id, run_segment_id)` segment, so it cannot order cross-run candidates. Among candidates that verify CLEAN, select the one with the latest `last_safe_boundary.ts` (read only after CLEAN); break an exact tie with the sortable timestamp prefix in `run_id` (`run-YYYYMMDD-HHMMSS-...`). Two indistinguishable CLEAN candidates refuse with an ambiguity reason. If every candidate is non-CLEAN, refuse carrying a representative verdict (prefer STALE, which names a superseding boundary).

**Selection ordering is best-effort, not correctness-bearing.** `last_safe_boundary.ts` is the anchor chain-head file's mtime on the *original* executor's box (`bundle.js` line 144), and the `run_id` prefix is that box's wall clock; neither is monotonic across boxes, so cross-box clock skew could in principle misorder two genuinely-distinct CLEAN candidates. This is deliberately tolerated: recovery safety does **not** rest on picking the truly-latest boundary. Every consequence of a wrong pick is bounded by the two fail-closed gates that do carry correctness, the CLEAN-only admission gate and the unproven-merge / escaped-effect park defaults, so a suboptimal pick costs redundant work or a park, never a bad accept. The exact-tie refusal is a belt-and-braces guard against a bit-identical ambiguity (two candidates the ordering genuinely cannot separate), not a skew detector, and is not load-bearing for safety. If a future cross-box scenario needs a truly-monotonic order, a bundle-carried monotonic counter is the extension point; it is out of scope here.

**Off-box recovery requires the git-remote store. Assumes:** off-box recovery requires `bundle_store: git-remote` (top-level config key from FAFF-861, `config.js` line 84). Validation before build: confirm `resolveBundleStoreName(root)` returns `git-remote` in the target deployment; local-store recovery is valid only for the same-box case.

**Verification before consume. Chosen:** reuse `verifyBundleIdentity` (`bundle.js` line 589); consume only CLEAN. Every non-CLEAN verdict maps to an explicit refused disposition:

| Verdict | Disposition | Terminal or retryable |
|---|---|---|
| CLEAN | reconstruct (or `noop-already-present` if identical run directory exists) | proceeds |
| STALE | refused, reason names `superseded_by` | terminal for this bundle; recover the superseding boundary |
| MISSING | refused | terminal for this identity |
| MALFORMED | refused | terminal |
| TAMPERED | refused | terminal, escalate |
| VERIFICATION_UNAVAILABLE | refused | retryable (store unreachable) |

**Projection reconstruction. Chosen:** from the CLEAN bundle's members, write exactly three targets: `ledger_snapshot` bytes to `.faff/runs/<run-id>/run-ledger.json` verbatim; the `anchors` member's `files` map to `.faff/anchors/<run-id>/<boundary-key>/` verbatim (restoring `events.jsonl`, `chain-head.json`, `run-ledger.json`, and when present `declared-effects.jsonl` + `effects-chain-head.json`); the anchor's `events.jsonl` copy to `.faff/runs/<run-id>/events.jsonl`. Deliberately not written and not claimed as recovered: any live shell or container, git worktree, per-issue build directory or checkpoint (`build-progress.json`, `review-progress.json`) absent from the anchor member, any uncommitted change. Anything the `artifact_manifest` lists but absent from the members is treated as not recovered, so an issue with no reconstructable pushed-branch evidence cannot reach the resume path's `continue_from_push` bucket and instead redispatches or parks.

**Resume-versus-park decision. Chosen:** after reconstruction, run the shipped `reconstructResumePlan` (`resume.js` line 83) over evidence gathered from the reconstructed directory, as `resumeLightsOut` does. There is no live heartbeat: `readHeartbeatFile` yields nothing, `runIsHeld` is false, and `classifyReEnterable` (`resume.js` line 53) reads owner state from the reconstructed `ledger_snapshot` (a killed run's `owner.status: running` with `held:false` classifies as `dead-running`, re-enterable). The verb computes the plan read-only as `resume_preview` and does not write the ledger; the continuation is the follow-on `faff lights-out --resume`.

**Protected-effect merge safety. Chosen:** the bundle carries no PR or merge-sha pointer (`merge-record.json` is not a member; `mintIssueAnchor` at `events.js` line 1197 copies `ac-checklist.json`, `review-verdict.json`, `holdout.json`, `build-progress.json`, but not `merge-record.json`). The reconstructed directory therefore has no `merge-record.json`, so `gatherResumeEvidence` (`lights-out.js` line 1244) reads a null `recorded`, `observeForgeMerge` (`lights-out.js` line 1279) short-circuits with no `gh` call, and `resolveShippedDivergence` (`resume.js` line 117) sees no proof of merge and parks the shipped issue. A shipped issue whose merge cannot be proven from bundle bytes parks (never skips); the verb repeats no protected effect and makes no forge call. Enabling skip-as-proven-merged is FAFF-823's job; when FAFF-845 adds a merge pointer, the same reused evidence gatherer re-derives against the forge.

**Escaped-effect check. Chosen:** over the reconstructed anchor's `declared-effects.jsonl`, run `computeEscapes` (`effects.js` line 84). Any observed-minus-declared escape, or a declared effect that cannot be shown resolved, marks the affected issue for park in the resume preview, so ambiguous effect state parks for reconciliation.

**Idempotency. Chosen:** reuse the write-once rule the local store applies (`localExistingBundleResult`, `bundle.js` line 310). If the target `run-ledger.json` exists and its bytes equal the bundle's `ledger_snapshot`, the disposition is `noop-already-present` (exit 0); if it exists with different bytes, refuse with an identity-conflict reason rather than overwrite.

**Recovery-disposition contract. Chosen:** add `computeRecoveryDispositionVerdict` (pure) plus `contractRecoveryDispositionVerdict` (schema wrapper) to `contract-defs.js`, mirroring `computeBundleVerdict`, with a JSON Schema at `plugin/skills/faff/contracts/recovery-disposition.schema.json`. A malformed or out-of-enum disposition coerces to `refused` (never `reconstructed`), the same never-guess-green posture `computeBundleVerdict` applies.

**Cross-box liveness. Chosen:** this verb relies on the operator's killed-executor guarantee (recovery is only invoked for a genuinely-lost executor) and adds no liveness machinery of its own, because it is read-only and cannot double-continue: it writes no owner state, and the continuation that does write owner state is the separate `faff lights-out --resume`. The write-once recovery-claim ref that prevents two executors *continuing* the same run concurrently is scoped to FAFF-863, gated at that continuation boundary, not here. A fresh box cannot read the original box's heartbeat, so this verb never attempts to prove liveness itself; it reasons only from `last_safe_boundary.ts` and the owner status recorded in `ledger_snapshot`.

## 4. How: behaviour

The verb is a thin impure shell over pure cores, matching `reconcile-recover.js`: resolve, discover, verify, select, reconstruct, preview, report. Every read-only step reuses a shipped primitive.

```
PROCEDURE bundle_recover(issue, run_id?, root, dry_run):
  1. store <- resolveBundleStore(root)
  2. candidates <- discover_by_issue(store, issue, run_id?)
  3. IF empty: RETURN refused(MISSING, "no bundle for <issue> in the <store> store")
  4. FOR each candidate: v <- verifyBundleIdentity(candidate,{root,store});
       record {identity, verdict, ts: last_safe_boundary.ts if CLEAN}
  5. clean <- candidates where verdict == CLEAN
  6. IF clean empty: RETURN refused(prefer STALE else representative verdict, "no CLEAN bundle; verdicts seen: ...")
  7. chosen <- latest last_safe_boundary.ts, run_id-prefix tiebreak
       IF indistinguishable tie: RETURN refused(CLEAN, "two equally-recent CLEAN bundles; refusing to guess")
  8. run_dir <- <root>/.faff/runs/<chosen.run_id>; existing <- idempotency_check(run_dir, chosen)
       IF conflict: RETURN refused("a different run-ledger.json already exists")
       IF match: RETURN noop_already_present(chosen, run_dir, preview_resume(run_dir))
  9. IF dry_run: materialise into a scratch dir (mirroring classifyBundle's withTempDir), preview, discard;
       RETURN reconstructed_preview(chosen, plan)   # real root untouched
 10. reconstruct_projection(chosen, run_dir, root)   # write the three targets, write-once
 11. plan <- preview_resume(run_dir, root)            # reconstructResumePlan, read-only
 12. RETURN reconstructed(chosen, run_dir, plan)
```

`preview_resume` gathers evidence from the reconstructed directory the same way `resumeLightsOut` does, runs `classifyReEnterable` and `reconstructResumePlan`, folds in any `computeEscapes` escape as an extra park, and writes nothing.

**Edge cases.** *Store unreachable*: `verifyBundleIdentity` returns VERIFICATION_UNAVAILABLE, refused-retryable; unreachable discovery is likewise refused-retryable, never an empty "no bundle". *STALE chosen*: names the `superseded_by` boundary. *run-close boundary*: `boundary_key: "run-close"` is not surfaced by an issue query, reached via `--run-id`; reconstruction writes the directory, the preview over a done ledger classifies `done-clean`, disposition is `reconstructed` with "nothing to resume". *Malformed reconstructed anchor*: unreachable after a CLEAN verdict; on a write fault, refuse rather than leave a half-written directory.

**Anti-patterns.** Re-deriving merge state by calling the forge inside this verb (that is FAFF-823's scope and breaks the offline-verify posture). Overwriting an existing local run directory to "refresh" it (a diverging directory is an identity conflict that must surface).

## 5. Scenarios

- **Given** a run reached an issue's merge floor, its bundle was published to the git-remote store, and the executor and its local run directory are then gone; **when** a fresh executor runs `faff bundle-recover --issue <ISSUE>` on a box with no `.faff/runs/<run-id>/`; **then** the verb proves the bundle CLEAN, writes `run-ledger.json`, the anchor directory, and `events.jsonl` under a reconstructed run directory, and reports `disposition: reconstructed` with a resume preview.
- **Given** a shipped issue in the reconstructed ledger whose merge cannot be proven from bundle bytes; **when** the resume preview is computed; **then** that issue lands in the `park` bucket with an unproven-merge reason, and no merge is repeated.
- **Given** the same bundle already recovered to the same root; **when** `faff bundle-recover` runs again for the same issue; **then** it reports `disposition: noop-already-present` and writes nothing new.
- **Given** a killed-executor fixture (a run driven to an issue-merge-floor boundary with a second issue left in flight and never anchored, its bundle published and its local run directory removed); **when** bundle-recover runs against a fresh root; **then** the in-flight, un-anchored issue never appears as skip or continue in the resume preview, proving partial work cannot become accepted.
- The disposition MUST be `refused` for every bundle verdict other than CLEAN, with the verdict and cause echoed.
- Two equally-recent CLEAN bundles for the same issue across different runs MUST produce a `refused` ambiguity disposition, never a silent pick.

## 6. Assumptions and follow-ups

**Assumes: off-box recovery runs with `bundle_store: git-remote`.** The local store does not cross boxes. Validation before build: confirm `resolveBundleStoreName(root)` (`bundle.js` line 504) returns `git-remote`; if `local`, the fixture must exercise the git-remote path (a scratch bare repo, as `bundle.js`'s selftest does at line 811).

**Assumes: `run_id` carries a sortable timestamp prefix** (`run-YYYYMMDD-HHMMSS-...`). Validation before build: confirm the run-id minting format still produces that prefix; if it changes, the tiebreak must move to another stable key.

**Follow-up FAFF-863 (cross-box continuation mutex).** The cross-box double-continue concern is resolved for this verb (see the cross-box liveness Chosen above) and carried forward as FAFF-863: a write-once recovery-claim ref gating the continuation boundary. This verb ships without it, correctly, because it never continues.

**ADR promotion intent.** If, during build, the design changes so that `bundle-recover` itself writes `owner.status` or bumps `owner.epoch` (rather than delegating to `faff lights-out --resume`), that introduces a fourth exception to "only the run's own agents write owner.status" and requires its own ADR in the ADR-0056 / ADR-0115 lineage. As specified (reconstruct-and-preview only), no new ADR is needed; this note records the intent so graft commits an ADR only if the write boundary moves.

## 7. Definition of done

- [ ] `faff bundle-recover --issue <ISSUE>` reconstructs a run directory on a root with no prior `.faff/runs/<run-id>/`, from a git-remote bundle, and reports `reconstructed`.
- [ ] Only a CLEAN bundle is consumed; every other verdict yields `refused` with the verdict echoed. No forge call is made by the verb, and the killed-executor fixture pins this with an oracle (a `gh`-less PATH, or a spawn spy that asserts no `gh` process is started) so the invariant is verified, not merely asserted.
- [ ] The recovery-disposition record matches the schema; `disposition == refused` iff `bundle_verdict != CLEAN` or a discovery/ambiguity refusal, enforced by `computeRecoveryDispositionVerdict` and its JSON Schema.
- [ ] `--dry-run` prints the disposition and writes no run directory; `--json` emits the contract shape; `--selftest` drives the pure cores.
- [ ] The verb is wired as one require plus one `COMMANDS` entry in `bin/faff`, one `docs/guide/cli.md` row passing `faff lint-cli-doc`, one `REGION_SELFTEST_ARGV` entry, region `factory`.
- [ ] Cross-run discovery: git-remote enumerates `refs/faff/bundles/*/seg-*/<ISSUE>` and verifies each; local scans `.faff/bundles/*/seg-*/<ISSUE>/`.
- [ ] Selection picks the latest `last_safe_boundary.ts`, tiebreaks on the `run_id` prefix, refuses on an exact tie. This ordering is best-effort (the two timestamps are per-box, not cross-box monotonic); a suboptimal pick is bounded to redundant work or a park by the CLEAN-only and park-default gates, never a bad accept.
- [ ] Reconstruction writes `run-ledger.json`, the anchor directory, and `events.jsonl`; it claims no shell, container, worktree, or per-issue build state absent from the members.
- [ ] A shipped issue with no bundle-provable merge parks in the resume preview; no protected effect is repeated. Any `computeEscapes` escape parks the affected issue.
- [ ] Repeated recovery is `noop-already-present` on a byte-identical ledger and `refused` on a divergent one; no overwrite.
- [ ] A STALE candidate reports `superseded_by`; VERIFICATION_UNAVAILABLE reports refused-retryable; MISSING with no candidate reports refused; a run-close bundle reconstructs and previews "nothing to resume".
- [ ] Killed-executor fixture: drives a run to an issue-merge-floor boundary with a second issue in flight and un-anchored, publishes the bundle to a scratch bare git-remote, removes the local run directory, recovers against a fresh root; the un-anchored in-flight issue never appears as skip or continue, a second recovery is idempotent, and the no-forge-call oracle above holds throughout.

No new LLM-judgement seam (the disposition is deterministic over bundle bytes), so no grader registration is required.

confidence: high
build-tier: complex
spec-review: approve
