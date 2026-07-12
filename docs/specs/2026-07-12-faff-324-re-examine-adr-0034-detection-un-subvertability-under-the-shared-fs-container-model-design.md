# Spec — Re-examine ADR-0034 detection un-subvertability under the shared-fs container model (FAFF-324)

> Spec: producer=faffter-dark-nlspec · date=2026-07-07 · mode=autonomous · confidence=high
> Full spec on the tracker.

**This is a spike.** The deliverable is a *recorded finding*, not a shipped mechanism: does Sentry-1's detection un-subvertability claim (ADR-0034) still hold when the build subagent shares uid + filesystem with the orchestrator's on-disk surface inside the container? The spec below shapes the investigation — the question, the probe plan against the shipped surface, the decision criteria, and what "done" means — it does not pre-decide the answer.

## WHY — the trust question

ADR-0034 claims Sentry-1's detect-and-hard-stop is un-subvertable *by construction*, resting on **two legs**:

1. **Terminal-token context isolation** — the build subagent returns only `{issue, outcome, pr}` and owns no field in Sentry's decision inputs.
2. **The closed-allowlist normalizer (AC5)** — `normalizeSentrySignals` drops any foreign key before a predicate sees it.

The FAFF-278 (Sentry-2) spike found (ADR-0039, costed follow-up 0) that inside the container the build lane **shares uid + fs** with the orchestrator's on-disk artifacts and can **rewrite them**. AC5 is proven to drop *injected stray fields*, but it does not obviously protect the **load-bearing on-disk content** — the ledger `outcomes`, the `owner` liveness fields, the `events.jsonl` records — that the thrash / budget / wall-clock predicates read. A build lane that rewrites that content could, in principle, **suppress a detection signal** (e.g. fake a `shipped` outcome to mask thrash, or refresh a stale heartbeat to mask a runaway).

The question is whether this is a *real* subversion of detection or a bounded one, and whether the corrective-artifact integrity mechanism (FAFF-325) is a **shared precondition** for Sentry-1's detection reads — not just a corrective-authority tax. The output is a disposition for ADR-0034.

**Design principles.**
- **Distinguish the two forgery classes.** *Injected-field forgery* (extra keys in the in-memory signal bundle) is AC5-covered and — in production — not even reachable (the subagent has no arg surface on `sentry check`). *Content forgery* (rewriting the on-disk files `sentry check` reads) is the real surface and is **orthogonal** to AC5. The finding must not conflate them.
- **Read-only, evidence-first.** The investigation reasons about the shipped read paths and demonstrates vectors with hermetic probes; it changes no production behaviour.
- **Reconcile-against-git is the load-bearing bound, so test it per-vector.** ADR-0034/0039 lean on the reconcile-against-git-truth posture + the container boundary to bound the worst case. The finding's core work is checking, *per forgeable vector*, whether a git-truth counterpart actually exists to catch it.

**Out of scope.**
- Building any remediation (wiring `integrityGate` into `sentry check`, a read-only ledger mount, signatures). → a follow-up build ticket if the finding calls for one; this spike only *recommends*.
- Corrective authority / Channel A (FAFF-326), fleet supervision (FAFF-327), live-run validation (FAFF-328).
- Any change to the AC5 normalizer or the `correct`-rung deferral.

## WHAT — the probe surface

The investigation targets the **three on-disk read paths** `cmdSentry` (`sentry check`) consumes and the **four trip predicates** they feed. All references below are to `plugin/skills/faff/bin/faff`.

| On-disk vector (build-lane-writable) | Read path | Predicate suppressed | Git-truth counterpart? |
|---|---|---|---|
| Fake `issue-outcome`/`shipped` event | `sentryReadEvents` → events.jsonl | `evalThrash` (fix-review-thrash) — a shipped issue is skipped | merged-PR / tracker state |
| Delete/rewrite `build-start` / failure events | `sentryReadEvents` → events.jsonl | `evalThrash`, `evalRepeatedFailure` | partial (git shows commits, not attempts) |
| Rewrite `ledger.outcomes` | `readLedger` → child `budget check` → `attemptsFromLedger` | `evalBudgetBreach` (max_attempts) | merged-PR / tracker state |
| Refresh `owner.last_heartbeat` | `readLedger` → `evalWallClock` | wall-clock-runaway (heartbeat staleness) | **none — liveness has no git counterpart** |
| Backdate `owner.started_at` | `readLedger` → `evalWallClock` | wall-clock-runaway (run-elapsed) | **none** |
| Flip `owner.status` running→done | `readLedger` → `evalWallClock` | wall-clock-runaway (only a running owner trips) | partial |

**Key structural observations to confirm during the probe** (each is a claim the finding must verify against the code, not assume):

- **Chosen: AC5 does not cover content forgery.** `normalizeSentrySignals` (bin/faff ~10020) filters the *keys* of the in-memory bundle, but `cmdSentry` (~10265) builds that bundle by reading the on-disk files wholesale (`readLedger`, `sentryReadEvents`, child `budget check`); forged *content* rides through on the allowlisted keys (`events`, `ledger`, `budget`). AC5's second leg addresses a channel (bundle-key injection) that the production subagent cannot even reach (no arg surface — proven by the AC5 test's hostile-args case), while the reachable channel (on-disk rewrite) is addressed only by leg 1 (terminal-token isolation) + the reconcile posture — and terminal-token isolation explicitly does *not* cover on-disk files (ADR-0039). *(decides: architecture)*
- **Chosen: FAFF-373 shipped the policy, not the wiring.** `correctiveIntegrityProbe`/`integrityGate` (bin/faff ~4523) ship a `consumer="detection" → reconcile-only` disposition and a distrust-by-default posture (probe always `asserted:false`), but the gate is a **standalone `corrective-integrity` subcommand** consumed only by `lights-out`'s capability record — it is **not wired into `sentry check`**, and no reconcile-against-git of ledger/event content is implemented anywhere. So `reconcile-only` is a declared disposition with no detection-path consumer today. This is the delta this spike sits in, not a supersession. *(decides: architecture)*
- **Assumes:** the shipped substrate — `sentry check`/`abort` + the six predicates in `bin/faff`, `test/sentry.test.mjs`, and FAFF-373's `corrective-integrity` gate — is the analysis surface. All three are present in the repo (verified at prep).

## HOW — bounded method

A static-analysis-plus-hermetic-probe investigation, **timeboxed to a single focused build session**. No production code path changes.

1. **Enumerate the read paths (static).** Confirm the WHAT table against `cmdSentry` + the six `eval*` predicates: exactly which on-disk fields each predicate reads, and whether any value flows through unnormalised.
2. **Demonstrate each vector (hermetic probe).** For each row, construct a run-dir fixture, forge the on-disk file the way a same-uid build lane could, run `sentry check --run-dir <fixture> --json`, and record whether a genuine trip is suppressed. Reuse the `test/sentry.test.mjs` fixture style (`mkRun`, `--now-ms` clock pin). These probes are the *evidence*, kept hermetic (no network, no real tracker).
3. **Per-vector reconcile analysis.** For each demonstrated suppression, determine whether a git-truth (or tracker) reconcile actually exists that would catch it, and whether any current caller performs that reconcile. The heartbeat/run-elapsed rows are the sharp edge — liveness has no git counterpart — so they get explicit attention.
4. **Apply the decision table** (Scenarios) to route each vector to a disposition, then aggregate to a single ADR-0034 disposition.

**Risks / edge cases.**
- **Over-claiming a break.** A vector is only a real subversion if (a) it suppresses a *trip* and (b) no compensating reconcile catches it *and no other guardrail backstops it* (budget spend/time, run-done floor). The finding must check the backstops before calling any vector a gap — mirroring ADR-0039's who-watches-the-watcher register.
- **Production reachability.** Distinguish "forgeable in principle on a shared fs" from "reachable by the shipped isolation model". The terminal-token return is context isolation; the on-disk rewrite is the fs question. Keep them separate in the write-up.
- **Not re-litigating Sentry-2.** The corrective-authority forge (ADR-0039 precondition) is settled; this spike is strictly the *detection*-leg re-examination.
- **Adjacent surface to consider, not chase.** The budget `tokens` dimension is measured from Claude Code transcripts under `~/.claude/projects/…/*.jsonl` (`measureTokens`, bin/faff ~2597) — also shared-fs-writable in principle, so a transcript rewrite is a further content-forgery vector against `evalBudgetBreach`. The ticket scopes the question to run-ledger *content* (outcomes / attempt counts), so transcripts stay a **named secondary vector**: note whether it widens the finding, but do not let it balloon the spike beyond the ledger/events core.

## Scenarios — the decision table

The investigation's output is a disposition for ADR-0034, chosen deterministically from what the probes + reconcile analysis find:

```
Given every demonstrated content-forgery vector is caught by an existing
     reconcile-against-git-truth path or backstopped by budget/run-done floor
When the per-vector analysis completes
Then the disposition is ACCEPT-BOUNDED for v1 — ADR-0034 is amended with a
     "Re-examination under the shared-fs container model" section recording the
     two-leg claim, the vector table, the per-vector reconcile coverage, and the
     named residual, with no new guard required
```

```
Given at least one demonstrated vector suppresses a trip with no reconcile
     counterpart and no backstop (the heartbeat/wall-clock rows are the
     candidate — liveness has no git truth)
When the per-vector analysis completes
Then the disposition is FOLLOW-UP GUARD — ADR-0034 is amended to record the
     co-binding AND the finding recommends a named follow-up (e.g. wire
     integrityGate detection→reconcile-only into `sentry check`, or a
     targeted liveness-attestation guard), confirming FAFF-325's integrity
     mechanism is a SHARED precondition for detection, not a corrective tax
```

```
Given the shared-fs model defeats the detection claim broadly (multiple
     un-reconcilable trip-suppressions across predicates)
When the per-vector analysis completes
Then the disposition is MATERIAL AMEND — ADR-0034's "un-subvertable by
     construction" claim is downgraded to conditional-on-fs-integrity, and
     the follow-up guard is escalated from recommended to load-bearing
```

- Assertion: whichever disposition lands, the finding **cites the specific `bin/faff` read paths and predicates** and **names FAFF-325/FAFF-373** in its reconcile analysis, so a reviewer can re-run the probes.
- Assertion: the finding explicitly answers the ticket's second sub-question — *is FAFF-325's integrity mechanism a shared precondition for detection?* — yes/no with rationale.

## Sequencing — does this spike need FAFF-325 first?

**Chosen: the investigation proceeds read-only against the shipped surface; it does not require FAFF-325 landed.** The probes forge on-disk fixtures and run the *already-shipped* `sentry check` — no un-forgeable channel is needed to *observe* whether a forged file suppresses a trip. Part of the spike's own question is whether FAFF-325 is a shared precondition, so depending on it would be circular. The ticket's `blockedBy FAFF-325` edge is conservative and bites only if the finding recommends *remediation code* that builds on the integrity mechanism — the finding itself (the ADR-0034 disposition) has no such dependency. *(Recorded as an observation; the edge is left untouched — prep does not modify relations.)* *(decides: architecture)*

## Already shipped against this surface

- **FAFF-373 (Done, PR #277)** — corrective-integrity fail-safe gate. Shipped `correctiveIntegrityProbe`/`integrityGate` with the `detection → reconcile-only` disposition + distrust-by-default posture, and the `corrective_authority: channel-D-only` lights-out capability record. **Does not supersede this spike:** the gate is standalone (consumed only by `lights-out`), is **not wired into `sentry check`**, and implements no actual ledger/event reconcile. It is a strong *input* the finding must account for (the shipped policy direction), not the finding itself.
- **FAFF-278 (Done, ADR-0039)** — the Sentry-2 spike that *raised* this question (costed follow-up 0) while attacking the corrective artifact. It flagged the forge-risk blast radius onto ADR-0034's detection leg but explicitly did not re-examine it — that is this ticket.
- **FAFF-49 (Done, ADR-0034)** — the artifact under re-examination.

Premise verdict: **premise still holds → proceed.** No Done ticket has produced the ADR-0034 detection-leg disposition; FAFF-373 shipped adjacent policy, not this finding.

**Note (as-built at graft time, FAFF-324):** origin/main additionally shipped FAFF-325 (#328, "wire the trusted attestation signal into the corrective-integrity gate + the merge-floor consumer") and FAFF-326 (#329, "Channel A subtractive corrective authority for Sentry") since this spec was written. Both are accounted for as shipped policy in the finding below — see the amendment's "FAFF-325 as shipped" analysis.

## DONE — definition of done (spike)

- A **recorded finding artifact at a named location**: an amendment section on `docs/adr/0034-*.md` headed *"Re-examination under the shared-fs container model (FAFF-324)"*, containing (a) the two-leg claim restated, (b) the forgery-vector table with the confirmed read paths + predicates, (c) the per-vector reconcile/backstop coverage, and (d) the chosen disposition (accept-bounded / follow-up-guard / material-amend) with rationale.
- The finding **explicitly answers** whether FAFF-325's integrity mechanism is a shared precondition for detection (yes/no + rationale).
- Each demonstrated forgery vector is backed by a **reproducible hermetic probe** — either a committed case in `test/sentry.test.mjs` (`mkRun` + `--now-ms` style, no network) or a documented reproduction in the finding sufficient for a reviewer to re-run. (Committed test preferred where a vector warrants a permanent regression guard; a spike does not require production code beyond the ADR amendment.)
- If the disposition is follow-up-guard or material-amend, the finding **names the recommended follow-up** (scope + which read path it must cover) so a human can `/faff-jot` it. This spike does not file the ticket.
- The disposition is **traceable to the decision table**: the finding states which Scenario branch fired and the evidence that selected it.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "chosen" }
  ] }
```
