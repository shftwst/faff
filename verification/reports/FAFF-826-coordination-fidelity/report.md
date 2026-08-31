# Coordination-fidelity result (FAFF-826)

This is the first hard input to the v5 Gate 1 coordination decision — whether explicit
coordination would remove a wrong or wasteful divergence, cut orchestration cost, or
improve retry and resume behaviour enough to justify a new loop, new state, and a
migration. The method is fixed in `protocol.md`, written before this result. The Phase 1
deliverable the master RFC names as "the coordination-fidelity protocol and result" is this
directory; see `docs/rfc/rfc-superdomestique-runtime/v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md`.

## Headline

**Null result: no captured decisions in the observation window.** Decision capture is off
by default, and it was not enabled for the runs the committed corpus was drawn from, so the
bundle holds zero records. The study makes no fidelity claim, and — as the acceptance
boundary requires — it does not dress an empty set up as agreement or as coordination
value. This is a first-class outcome, not a failure: it says the measurement machinery is
in place and correct, and the evidence to feed Gate 1 has simply not been collected yet.

The committed corpus is empty, pinned by the well-known SHA-256 of zero bytes
(`e3b0c442…7852b855`). The result reproduces from a clean checkout: recomputing the digest
matches the manifest, and re-running over the committed corpus yields byte-identical
corpus-derived outputs.

## What was measured

| Class | Count |
|---|---|
| Records in the corpus | 0 |
| Replayable | 0 |
| Missing-input | 0 |
| Uncovered | 0 |
| Divergences (any consequence) | 0 |
| Excluded (version skew) | 0 |
| Excluded (input-uncaptured) | 0 |
| Excluded (replay error) | 0 |

The divergence matrix — decision kind against consequence, with denominators — is empty
across all nine in-scope kernels (`next`, `eligible`, `run-done`, `queue-state`,
`claim-verdict`, `park-verdict`, `project-next`, `run-outward`, `run-start`), because there
were no replayable records to compare.

## Coverage of the decision-kernel surface

Even with an empty corpus, the study confirms the surface it *would* measure, derived live
from the state-authority map and the capture registry:

- **Nine kernels in scope** — the intersection of "instrumented" and "classified
  decision-kernel". Each has a real replay adapter and would be compared like any other.
- **Five commands set aside**, each with a stated reason and a captured count of zero:
  - `state`, `run-ledger`, `decision-capture` — classified decision-kernel by the map but
    not pure prescribe-an-action predicates (a read-model, a record-mint entry, and the
    instrumentation itself), so they contribute nothing to any divergence tally.
  - `tier`, `regions` — instrumented but classified outside decision-kernel by the map
    (software-delivery-policy and harness-and-skill-orchestration), so they are counted if
    captured and set aside as non-coordinator-transition decisions.

There is no uninstrumented gap on the replayable surface: every decision-kernel command is
either replayed or set aside with a reason.

## Orchestration cost

No cost was joined, because there were no records to join to runs. The cost readers
(intervention, retry, resume, latency, token spend) are wired and would snapshot from the
existing run artifacts when a corpus carries records; with an empty corpus the snapshot is
empty and the artifacts-present flag is false.

## Which decisions justify a future coordinator?

**None yet — on the strength of evidence.** With zero captured decisions there is no
measured wrong or wasteful divergence, no measured orchestration cost, and no measured
retry or resume problem for any of the nine kernels. Nothing here argues *for* building a
coordinator, and — just as importantly — nothing here argues that the kernels are drifting.
The honest reading is that Gate 1 cannot be answered from evidence until decisions are
captured.

This is the expected first state. The measurement is not the coordinator; it is the
instrument that tells us whether one is warranted. The next move is to collect evidence,
not to build.

## Collecting the evidence

To turn this null result into a real fidelity measurement:

1. Enable decision capture for a representative set of runs (`capture.decision_kernel: on`).
   Capture is read-only and off by default; it changes no action and can be disabled again
   without touching any decision.
2. Export the accumulated captures into a bundle
   (`faff decision-capture export --out <dir>`), and commit the resulting
   `decision-corpus.jsonl` and `manifest.json` into this report directory, replacing the
   empty corpus.
3. Ratify or amend the per-kernel consequence rules in `protocol.md` (the wasteful-versus-
   wrong boundary) before reading any result.
4. Re-run `faff shadow-fidelity run --corpus <committed corpus> --manifest <committed
   manifest> --out verification/reports/FAFF-826-coordination-fidelity`, and read the
   divergence matrix and the joined cost.

Until then, the fidelity question stays open, and this report says so plainly rather than
implying a clean bill of health the evidence does not support.

## How this reproduces

```
faff shadow-fidelity reproduce --dir verification/reports/FAFF-826-coordination-fidelity
```

recomputes the committed corpus's digest, asserts it matches the manifest, re-runs the
analysis, and asserts the corpus-derived outputs (coverage counts, the divergence matrix,
the exclusion and set-aside lists) are byte-identical to the published `result.json`. The
snapshotted cost values are read back from `result.json`, not recomputed — the run
artifacts they come from are gitignored and absent on a clean checkout, so cost is a
recorded observation joined to the corpus, never a content-addressed reproducible output.
