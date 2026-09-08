# Coordination-fidelity result (FAFF-826)

This is the first hard input to the v5 Gate 1 coordination decision: whether explicit
coordination would remove a wrong or wasteful divergence, cut orchestration cost, or
improve retry and resume behaviour enough to justify a new loop, new state, and a
migration. The method is fixed in `protocol.md`, written before this result. The Phase 1
deliverable the master RFC names as "the coordination-fidelity protocol and result" is this
directory; see `docs/rfc/rfc-superdomestique-runtime/v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md`.

## Headline

**First non-null result, but the gradeable base is thin.** The corpus now holds 64 captured
records drawn from 14 runs (13 off the Fly.io L3 runner state volume plus one local run). Of
the 63 base decisions, 58 are replayable and 5 are missing-input. Only 6 of those replayable
decisions could actually be graded against the live choice, all of them `eligible`, and all
6 agreed with the shadow coordinator: zero harmless, wasteful, or wrong divergence. The other
52 replayable decisions carry the decision inputs but no captured action marker to join, so
the shadow has nothing to compare its prescribed action against and they are not graded.

So the measurement machinery works and produced a real result, and nothing in it shows the
kernels drifting. It does not yet answer Gate 1 in the affirmative: 6 graded decisions on a
single kernel is too small a base to argue a coordinator would remove a divergence that has
not been observed. The dominant coverage limit is the absent action marker on these runs, not
the kernels. That cause was fixed after this observation window closed: FAFF-1009 (2026-09-05)
wired the kernels to the correlation-id driver and FAFF-1014 (2026-09-06) hardened the lint,
both after the latest run here (2026-09-04). This corpus is therefore pre-fix pilot data;
verification that the fix reaches a live run is tracked by FAFF-1022.

The committed corpus is pinned by its SHA-256 (`755bce9a…1a78ec33`) and 14 run ids in
`manifest.json`. The result reproduces from a clean checkout: recomputing the digest matches
the manifest, and re-running over the committed corpus yields byte-identical corpus-derived
outputs.

## What was measured

| Class | Count |
|---|---|
| Records in the corpus | 64 |
| Base decisions (`decision-capture`) | 63 |
| Action markers (`decision-capture-action`) | 1 |
| Replayable | 58 |
| Missing-input | 5 |
| Uncovered | 0 |
| Graded (action marker present) | 6 |
| Replayable but action-uncaptured (no marker to join) | 52 |
| Divergences (any consequence) | 0 |
| Excluded (version skew) | 0 |
| Excluded (input-uncaptured) | 0 |
| Excluded (replay error) | 0 |
| Excluded (verdict skew) | 0 |

The captured decisions span three kernels: `next` (32), `eligible` (31), and `run-done` (1).

### Divergence matrix

Only `eligible` has a non-zero denominator. Every other in-scope kernel has no graded
decision, because no action marker was captured for it.

| Kernel | Agreement | Harmless | Wasteful | Wrong | Denominator |
|---|---:|---:|---:|---:|---:|
| `eligible` | 6 | 0 | 0 | 0 | 6 |
| `next` | 0 | 0 | 0 | 0 | 0 |
| `run-done` | 0 | 0 | 0 | 0 | 0 |
| `queue-state`, `claim-verdict`, `park-verdict`, `project-next`, `run-outward`, `run-start` | 0 | 0 | 0 | 0 | 0 |

### Why 52 replayable decisions are ungraded

The shadow replays a decision's normalised inputs through the same versioned kernel that
produced the capture, then compares the prescribed action against the recorded
`selected_action`. That comparison needs a `decision-capture-action` marker correlated to the
base record. These 14 runs emitted one such marker in total, so 52 of the 58 replayable
decisions (`next` 27, `eligible` 24, `run-done` 1) have inputs to replay but no recorded live
action to grade against. The 5 missing-input decisions are all `next`, short of the inputs the
replay adapter needs.

## Coverage of the decision-kernel surface

Derived live from the state-authority map and the capture registry:

- **Nine kernels in scope**: the intersection of "instrumented" and "classified
  decision-kernel" (`next`, `eligible`, `run-done`, `queue-state`, `claim-verdict`,
  `park-verdict`, `project-next`, `run-outward`, `run-start`). Each has a real replay adapter.
- **Five commands set aside**, each with a stated reason: `state`, `run-ledger` and
  `decision-capture` are classified decision-kernel by the map but are not pure
  prescribe-an-action predicates (a read-model, a record-mint entry, and the instrumentation
  itself); `tier` and `regions` are instrumented but classified outside decision-kernel by the
  map (software-delivery-policy and harness-and-skill-orchestration).

Every decision-kernel command is either replayed or set aside with a reason. Three of the nine
in-scope kernels (`next`, `eligible`, `run-done`) appear in the corpus; the other six were not
exercised in these runs.

## Orchestration cost

Cost artifacts are present for all 14 runs and joined by `run_id`: across them, 9 parks and 37
retries are recorded, with per-run latency and event counts. Token spend is estimate-only, as
no metered engine-spend records were present in these run artifacts. Per the acceptance
boundary, cost is a recorded observation joined to the corpus, not a content-addressed
reproducible output, so `reproduce` reads it back from `result.json` rather than recomputing
it.

## Which decisions justify a future coordinator?

**Not answerable in the affirmative from this evidence.** No wrong or wasteful divergence is
measured on any kernel, and the 6 graded `eligible` decisions all agreed with the shadow. That
argues nothing is drifting on the one kernel with a gradeable base; it does not argue that a
coordinator is warranted, and the base is too narrow to argue it is not warranted elsewhere.
The honest reading is that the coordination question stays open, now for a specific and fixable
reason: the runs recorded what each decision saw but almost never recorded what it chose.

## Widening the evidence

Every run in this corpus predates the capture-wiring fix, so the 52 action-uncaptured
decisions cannot be recovered here. The gap was the kernels not yet calling the correlation-id
driver: FAFF-989 (2026-09-03) built the driver and the empty-correlation guard, FAFF-1009
(2026-09-05) wired the kernels to it with a fail-closed CI lint, and FAFF-1014 (2026-09-06)
made that lint order-aware. The latest run here is 2026-09-04, so none of them carry the
wiring. The code is fixed; the corpus is not improvable in place.

A decisive result needs fresh runs under the wired code:

1. Produce new runs on code at or past FAFF-1009. A current local checkout picks the fix up
   directly; the Fly.io L3 runner only does once its image is rebuilt on that code, so confirm
   the deployed image before trusting fly-l3 captures. Both checks are tracked by FAFF-1022.
2. Aim for coverage across more of the nine kernels: six were never exercised here, so the
   matrix has a denominator only for `eligible`.
3. Re-export and re-run: `faff decision-capture export --out <dir> --include-anchors`, then
   `faff shadow-fidelity run --corpus <corpus> --out verification/reports/FAFF-826-coordination-fidelity`,
   and read the divergence matrix and the joined cost.

Per FAFF-974's acceptance boundary, that post-fix confirmatory corpus must be kept distinct
from this pre-fix pilot corpus and must not be presented as the confirmatory Gate 1 result.

## How this reproduces

```
faff shadow-fidelity reproduce --dir verification/reports/FAFF-826-coordination-fidelity
```

recomputes the committed corpus's digest, asserts it matches the manifest, re-runs the
analysis, and asserts the corpus-derived outputs (coverage counts, the divergence matrix, the
exclusion and set-aside lists) are byte-identical to the published `result.json`. The
snapshotted cost values are read back from `result.json`, not recomputed: the run artifacts
they come from are gitignored and absent on a clean checkout, so cost is a recorded
observation joined to the corpus, never a content-addressed reproducible output.
