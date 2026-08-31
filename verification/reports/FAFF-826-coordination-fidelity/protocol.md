# Coordination-fidelity protocol (FAFF-826)

This protocol is written and committed **before** any result is read. It fixes the
observation window, the inclusion rules, the kernel versions replayed, the input
requirements, the action-normalisation rules, the consequence rules, and the coverage
definitions. Once results exist, this file is not edited to fit them; a genuine change
to the method lands as a new protocol version alongside a fresh result.

The study answers one question for the v5 Gate 1 decision: does the prompt-driven
orchestrator actually follow the deterministic kernels it calls, and where it drifts,
does the drift cost anything a future coordinator would prevent? It never assigns work,
mutates the tracker, performs a protected effect, merges, or makes a canonical decision.
It reads files and calls the real pure kernels, and writes only the files in this report
directory.

## Observation window and the decision set

The decision set is a `decision-capture export` bundle — the committed
`decision-corpus.jsonl` in this directory, pinned by the `corpus_sha256` in
`manifest.json`. The bundle is the whole boundary: the study runs against the committed
corpus, never against live run directories (`.faff/` is gitignored, so those directories
are absent on a clean checkout and cannot be re-exported there). The observation window is
whatever set of runs the committed export was drawn from; `manifest.json` records the
`record_count` and the contributing `run_ids`.

Decision capture is off by default (`capture.decision_kernel` must be set to `on` for a
run to contribute records). If the manifest's `record_count` is zero or near-zero, the
result is a stated null result — "capture was off or sparse for the observation window" —
never dressed up as agreement.

## The nine kernels in scope

The in-scope set is the intersection of two facts about each command: it is instrumented
by the decision-capture registry, and the state-authority map classifies it
`decision-kernel`. Both the in-scope set and the set-aside list are derived from the map
and the registry on every run, so they can never silently drift from either source.

The nine in-scope kernels are `next`, `eligible`, `run-done`, `queue-state`,
`claim-verdict`, `park-verdict`, `project-next`, `run-outward`, and `run-start`. Each is
replayed through its own real exported function; the study imports the kernels and
reimplements none of them.

Three commands the map classifies `decision-kernel` are **set aside**, not backfilled as
gaps, because none is a pure prescribe-an-action predicate the shadow could replay:

- `state` — a read-model producer. It reads the live filesystem and emits an issue's
  resolved state with status, eligibility, and blocked fixed to "unknown", so it returns
  no verdict to compare against a recorded action.
- `run-ledger` — the standalone-interactive mint and outcome-record entry, a record
  writer rather than a decision predicate.
- `decision-capture` — the instrumentation itself, not a decision the shadow would replay.

Two further commands are instrumented by the registry but the map classifies them
outside `decision-kernel`, so they are counted if captured and set aside with a reason:
`tier` (software-delivery-policy) and `regions` (harness-and-skill-orchestration). They
are not coordinator-transition decisions.

Every set-aside command contributes zero to the divergence tally and one line to the
set-aside list. Missing instrumentation is never scored as coordination value; here there
is no missing instrumentation on the replayable surface — every `decision-kernel` command
is either replayed or set aside with a stated reason.

## Kernel versions and the version-skew rule

Each record carries the `kernel_version` decision-capture stamped from the registry.
The study replays a record only through the in-tree function of that same version. Only
`@1` versions exist in the tree today. A record whose `(kernel, version)` the in-tree
kernel no longer exports is a version-skew observation: it is listed and excluded from the
divergence tally, never graded as a divergence. This is what "replay through the same
versioned kernel that produced the capture" means in practice — replaying old inputs
through a newer function would manufacture a meaningless divergence.

## Input requirements and the input-uncaptured rule

The capture classifies each record `replayable` (all required inputs present),
`non-replayable` (a required input missing), or `uncovered` (the kernel is not in the
registry). Only `replayable` records are replayed.

Beyond the required inputs, a kernel may read an **optional** input that changes its
verdict but sits outside its `required_inputs`. A replayable record that omits such an
input would replay through the wrong branch and read as a false divergence. The study
guards against this by deriving each kernel's optional-input set structurally — it
compares the input keys the kernel's own function declares against that kernel's
`required_inputs`, so a future optional input is caught the same way rather than
hardcoded. A record missing any optional input its kernel reads is flagged
`input-uncaptured` and excluded, counted separately.

Across the nine in-scope kernels this yields exactly two cases today:

- `next`'s `awaitingSpecReview` — the next-step function reads seven keys while the
  registry requires six; a spec-review-outage hold routes to prep, so a record whose real
  decision was an outage-hold but whose capture omitted the key would replay as a false
  divergence. Detected directly off the captured inputs (it is an options-object key).
- `run-done`'s `policy` — a methodology-supplied ladder override passed as a second
  argument the record has no slot for, so it cannot be read off the record shape. The
  study treats a `run-done` record as policy-uncaptured **only** when the run's
  methodology is independently known to be non-default (read from the run's config or
  ledger). Absent that signal it assumes the structural-default ladder and records that
  assumption here, so the default-versus-non-default call is a stated rule a human
  ratifies, never a silent guess.

The five kernels the instrumentation widening added (`claim-verdict`, `park-verdict`,
`project-next`, `run-outward`, `run-start`) introduce no new optional-input case; each
one's required-input list is its function's complete read set.

## Action-normalisation rules

For each replayable record the study computes the kernel's prescribed action from the
captured inputs and compares it against the recorded actual action. Both sides are reduced
to one comparable token per kernel, so a prescribed value and a recorded value are
compared like-for-like:

- `next` — the verdict (the first element of the returned verdict/reason pair), e.g.
  `graft`, `prep`, `needs-human`.
- `eligible` — the eligibility boolean, read as `eligible` or `ineligible`.
- `run-done` — the run-done verdict, e.g. `run-complete`, `continue`, `escalate`.
- `queue-state` — the queue-empty and all-parked pair, joined.
- `claim-verdict` — the claim verdict, `live` or `stale`.
- `park-verdict` — the park verdict, e.g. `protect`, `strip-ok`, `surface`, `n/a`.
- `project-next` — the prescribed action and desired state, joined (e.g.
  `advance:started`), or `error` for a malformed rollup.
- `run-outward` — the outward reason token, e.g. `outward-adopter`, `self-marked`.
- `run-start` — the run-trigger verdict, e.g. `plan`, `drain`, `refuse`.

`run-outward` is replayed positionally: its two resolved references collide on the
container and repo keys, so each is passed whole under its own argument name rather than
flattened into one signal bundle. `run-start` is normalize-then-derive: the study
normalises the captured signal bundle externally before calling the derivation, because
the derivation requires an already-normalised bundle.

A record whose replay throws (a malformed timestamp, an out-of-enum status) is listed as a
replay error and excluded, never graded as a divergence.

## Coverage definitions

The study publishes three coverage classes, aligned one-to-one with the capture's own
vocabulary:

- `replayable` — all required inputs present; entered into the comparison.
- `missing-input` — a required input absent (the capture's `non-replayable`); counted with
  its exact missing set, never replayed.
- `uncovered` — the kernel is not in the registry (including a set-aside command's
  records); counted, never a divergence.

## Consequence rules (ratified before results)

For each replayable record, the prescribed action either equals the actual action
(**agreement** — the honest majority outcome for a faithfully-followed kernel) or differs
(**divergence**), graded by material consequence:

- **harmless** — the actual action reached the same durable outcome as the prescribed one
  by an equivalent route, so forcing the kernel verdict would have changed nothing that
  mattered.
- **wasteful** — the actual action added avoidable work or cost (an extra attempt, an
  unnecessary park, a run continued past the point the kernel would have completed it) but
  produced no wrong durable result.
- **wrong** — the actual action risked or produced an incorrect or unsafe durable outcome
  the kernel verdict would have prevented.

The default grading applied per kernel, which a human ratifies or amends before any result
is read:

| Kernel | Graded **wrong** when | Otherwise |
|---|---|---|
| `next` | the kernel prescribed a gate the actual bypassed (needs-human, blocked, skip-ineligible) | wasteful; two terminal no-ops (done/none) that differ are harmless |
| `eligible` | the kernel said ineligible but the ticket was treated as eligible (an ineligible ticket was touched) | wasteful |
| `run-done` | the kernel prescribed escalate but the run continued or completed (a safety floor bypassed) | wasteful |
| `queue-state` | — | wasteful (a read-model pair mismatch is rarely unsafe on its own) |
| `claim-verdict` | the kernel said live but the claim was treated as stale (a still-live claim reclaimed) | wasteful (re-acquiring a genuinely-stale claim a beat early) |
| `park-verdict` | the kernel said protect but the label was stripped | wasteful |
| `project-next` | — | wasteful (container state-coherence, rarely unsafe) |
| `run-outward` | the kernel said inward (self/unresolved) but the run acted outward | wasteful |
| `run-start` | the kernel refused but the run started | wasteful |

These defaults are deliberately conservative on the safety axis: a divergence that could
touch an ineligible ticket, reclaim a live claim, strip a protect label, bypass an
escalation floor, act outward when the target was self-directed, or start a refused run is
graded wrong; everything else that only spent avoidable work is wasteful. The human
confirms or amends this table here before the result is generated.

## Orchestration cost

Operator intervention, retry, resume, latency, and token cost are read from artifacts that
already exist — the run ledger, the parks and disposition records, the run-segment and
resume records, the event timestamps and sequence numbers, and the per-run token spend —
joined to each decision by its run identifier. The study builds no new meter and touches
no producer.

Because those artifacts are gitignored and absent on a clean checkout, cost cannot be
recomputed there. The study therefore snapshots the computed cost values into `result.json`
at analysis time and treats them as frozen. Reproduction asserts byte-identical
corpus-derived outputs (coverage counts, the divergence matrix, the exclusion lists, the
set-aside list) recomputed from the committed corpus, and reads the snapshotted cost values
back from `result.json` unchanged. Cost is a recorded observation joined to the corpus, not
a content-addressed reproducible output.

## Reproduction

From a clean checkout with the committed `decision-corpus.jsonl`, `manifest.json`, and
`result.json`, and no run directories present:

```
faff shadow-fidelity reproduce --dir verification/reports/FAFF-826-coordination-fidelity
```

recomputes the corpus digest, asserts it matches the manifest, re-runs the analysis over
the committed corpus, and asserts the corpus-derived outputs are byte-identical to the
published `result.json`. An identical digest guarantees identical input.
