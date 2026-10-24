# Coordination-fidelity protocol, version 2: the post-fix stratum (FAFF-974, FAFF-1174)

This version is written and committed before any post-fix record is graded. It
inherits version 1 (`protocol.md`) unchanged except where a section below
amends it. Version 1 was written before the pilot was read; the pilot was then used
to repair capture (FAFF-1009, FAFF-1014, FAFF-1394), so its records are pilot
evidence and never enter this stratum.

## What is inherited unchanged from version 1

- The nine in-scope kernels and the set-aside list, derived from the map and the
  registry on every run.
- Kernel versions and the version-skew rule. Every in-scope kernel is still `@1`.
- Input requirements and the input-uncaptured rule, including the `run-done`
  default-ladder assumption.
- The action-normalisation rules.
- The coverage classes: replayable, missing-input, uncovered.
- The orchestration-cost method, and its snapshot into `result.json`.
- Reproduction by `faff shadow-fidelity reproduce`.

## Consequence table: ratified

The version 1 consequence table is ratified as written by the human sitter of
FAFF-974 on 2026-10-24. At that date no post-fix run had started, because the
window below had not opened, so no result from this stratum had been read.

## Gradeable kernels

Seven of the nine in-scope kernels take an action marker and can be graded:
`next`, `eligible`, `claim-verdict`, `park-verdict`, `run-start`,
`run-outward`, `run-done`.

`queue-state` and `project-next` are Tier 2 kernels. They mint a base record and
take no action marker, so their graded denominator is zero by design. The report
lists them as "not gradeable by design", separately from a gradeable kernel that
happened to see zero decisions.

## Strata

Records are reported in four strata. They are never pooled.

| Stratum | Source | Status |
|---|---|---|
| S0, September pilot | the committed 64-record corpus, runs 2026-09-01 to 2026-09-04 | pilot, already published |
| S1, October pilot | every run before the inclusion start below, including the runs used to diagnose FAFF-1394 | pilot, not graded for this gate |
| S2, post-fix local | included runs on the operator's machine | confirmatory |
| S3, post-fix Fly | included runs on `fly-ci-l3-runner` | confirmatory |

S2 and S3 are reported separately and also together. Agreement in one does not
stand in for the other.

## Observation window and inclusion

- **Start:** the publish time of the first faff release containing FAFF-1394
  (#1115 and #1117), expected to be v0.43.0. A run is included only if it started
  after that time.
- **Version check:** each included run's plugin version is recorded in
  `runs.md` beside the corpus. Locally this is `faff --version` at run start; on
  Fly it is the version the runner's install step logged. A run whose version
  cannot be established is excluded and listed with the reason.
- **Capture on:** the run had `capture.decision_kernel: on`. A run with capture off
  is excluded and listed.
- **Whole runs only:** a run that crashed or was aborted is included up to its last
  event; it is not dropped for being incomplete. A run that was started only to
  test instrumentation, and is labelled so in `runs.md` before it starts, is
  excluded.
- **End:** the stopping rule below, or **2026-10-31 23:59 local**,
  whichever comes first.

## Stopping rule

Collection stops at the first of:

1. at least **14** included runs in S2 and S3 together, at least **4** of them in
   S3, **and** every one of the seven gradeable kernels has at least one joined
   pair (a base record with a matching action marker);
2. **30** included runs;
3. the end date above.

If collection stops by 2 or 3 with a gradeable kernel still at zero, that kernel
is reported as zero-denominator. The gate can then narrow to the kernels with
evidence; it is not a reason to keep collecting.

## No peeking

Until collection stops, the only permitted check is a count of joined pairs per
kernel and run, read from `events.jsonl` without replaying anything. Running
`faff shadow-fidelity run` on these records, or reading agreement or divergence,
before collection stops breaks this protocol. If that happens, it is recorded in
the report and the affected records move to pilot.

## Cost and recovery

Where the analyser cannot join cost or recovery data for a run, the report says
"unavailable" for that run and names the reason. It never reports zero. The S0
finding, that the cost snapshot did not join the runner's `state/streams` shape,
is checked before the S3 result is generated and recorded either as fixed or as
a known gap.

## What the report must state

These follow from FAFF-974's required evidence:

- raw counts and per-kernel denominators for each stratum;
- replayable, uncovered and missing-input counts kept separate;
- version skew, input exclusions, replay errors and zero-denominator kernels
  listed;
- a statement that the shadow comparison caused no assignment, tracker mutation,
  protected effect, merge, canonical decision or durable-writer cutover;
- which decisions, if any, have enough evidence to justify a future bounded
  coordinator, with negative, null and inconclusive findings kept.
