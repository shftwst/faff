# External-verification report

Status: REGISTERED, FROZEN, PRE-RUN. The sections down to and including Procedure are frozen and must not be edited after this case is committed. Everything marked CAPTURE is filled after the run. See README.md for the run-and-fill steps.

## Experiment

- Identity: EVP-L4-P1-0002
- Synthetic: false
- Title: L4 lights-out whole-loop proof on the P1 link-shortener (trigger to plan to converge to drain)
- Registered at: 2026-08-30T14:00:00Z
- Completed at: CAPTURE (ISO 8601, on completion)
- Published at: CAPTURE (ISO 8601, on publish)
- Publication: revision 1, `reports/0001.json`, status original

## Hypothesis

One manually-ignited L4 lights-out run, with no planning instruction, against a greenfield PRD with thin coverage, plans the work, converges when the PRD is covered, drains and ships the first slice, and refuses when the target is self-directed, all in a single run.

- Unit of claim: one L4 lights-out run against the pinned P1 link-shortener subject.
- Decision rule: every success criterion is decided by an objective check. The main result is supports-hypothesis only when all criterion outcomes are pass, none unresolved, required evidence complete, and no protocol-stage failure. No criterion is judgement-dependent.
- Planned variations: none.

### Success criteria

| ID | Statement | Judgement-dependent |
|---|---|---|
| SC-1 | With no planning instruction, `faff run-start` returns `plan/coverage-thin` and the run writes an initiative to project to first-slice-epic skeleton. | no |
| SC-2 | After decompose, coverage re-reads covered and `faff run-start` returns `drain/prd-covered`, in the same run. | no |
| SC-3 | The existing drain builds and ships the first slice with no human-authored write. | no |
| SC-4 | The run ends `converged/both-dry`, disposition clean, `faff prdr coverage` satisfied. | no |
| SC-5 | An ignition resolved to faff's own repo yields `run-outward.outward=false` and `run-start` `refuse/self-directed`, with zero writes. | no |
| SC-6 | Inadmissible, ambiguous, no-target, and unmeasurable coverage each resolve to `refuse`, never to `plan` (`faff run-start --selftest`). | no |

## Environment

- Runner class: claude-box cage, nested rootless docker (dind-in-cage)
- Trigger: manual `faff lights-out` mint then `/faff:faff-beep-boop` drain (two cages)
- Runtime versions: CAPTURE (node, docker, faff at run time)
- Configuration (non-secret allowlist): `tracking.tracker: none` (git-only pin), `budget.tokens: 30000000`, adversarial review + spec_review engines, `FAFF_RUN_HEARTBEAT_STALE_SECS=7200`
- Secrets present (name only): CAPTURE (adversarial engine key names via `.env.claude-box`)

## Immutable revisions

- Subject repository: PIN AT EXECUTE (SUT repo slug) at PIN AT EXECUTE (final main head after the run)
- SuperDomestique repository: `shftwst/faff` at `13fb3239f042970cfa83aeb80681217949746f46` (planned; confirm the exact commit the cage ran)
- Harness: claude-box plus `assert-p1-top-of-loop.sh`, SHA-256 `3e19e987c9687077e52179a64564cb0163930a8377f319c978bdbd451295e1b7`
- Model: provider anthropic, serving model id `claude-opus-4-8` (confirm served id, or "not exposed")
- Protocol: v0.1 at `verification/external-verification/protocol/v0.1/README.md`, SHA-256 `2082af1f485d3b938eabf8cd80480b2384cf411d93d72b2b93c86050638681a8`

## Inputs

| Role | Path or URL | Media type | SHA-256 |
|---|---|---|---|
| PRD (frozen input) | `evidence/prd.md` | text/markdown | `1a7ad6627d14f369f2e176cb40276f277b5446bccc3e8a7f4f7290a49cf3d7a7` |
| runbook generator | `verification/external-verification/scaffold-p1-link-shortener.sh` | text/x-shellscript | `ae2016e429092a6de675ef5e0a36e2631b43ad38c3892a90ed1d980052d01674` |
| assertion harness | `verification/external-verification/assert-p1-top-of-loop.sh` | text/x-shellscript | `3e19e987c9687077e52179a64564cb0163930a8377f319c978bdbd451295e1b7` |

The runbook is `RUNBOOK.md`, generated into the SUT by the scaffolder above. Pinning the scaffolder pins the runbook. Same PRD and runbook as the 2026-08-29 run.

## Procedure

1. Scaffold the SUT via `scaffold-p1-link-shortener.sh`; confirm git-only via `faff tracker probe`.
2. Author and make admissible the SUT root PRD (`evidence/prd.md`, unchanged from the 29 Aug run).
3. Cage 1: `env -u FAFF_RUN_DIR` then `faff lights-out --check` (confirm 8/8 armed) then `faff lights-out --json` to mint the armed L4 ledger.
4. Cage 2: `/faff:faff-beep-boop` with `FAFF_RUN_DIR` forwarded; run-start plans, plot decomposes, the run falls through to prep and build in the same pass, gates and holdout run, epics merge.
5. Read the exit contract: `faff disposition --run-dir "$run_dir"`.
6. Run `assert-p1-top-of-loop.sh` with cwd = SUT for SC-1 to SC-4 and SC-5.
7. Run `faff run-start --selftest` for SC-6.

## Objective checks

Oracle and expected are frozen; observed and verdict are CAPTURE.

| ID | Oracle | Expected | Observed | Verdict |
|---|---|---|---|---|
| OC-1 | `plot-decompose.log.md` run-start line + roadmap presence | `plan/coverage-thin`, skeleton written | CAPTURE | CAPTURE |
| OC-2 | `assert-p1-top-of-loop.sh` AC2 | loop PRDR Accepted | CAPTURE | CAPTURE |
| OC-3 | run summary + `assert` AC3 | first slice shipped, no human write | CAPTURE | CAPTURE |
| OC-4 | `run-ledger.json` + disposition | `converged/both-dry`, clean, coverage satisfied | CAPTURE | CAPTURE |
| OC-5 | `run-outward` then `run-start`, cwd = faff repo | `outward:false`, `refuse/self-directed`, zero writes | CAPTURE | CAPTURE |
| OC-6 | `faff run-start --selftest` | `RESULT: PASS (0 failed)` | CAPTURE | CAPTURE |

## Subjective judgements

None. Every criterion is objective.

## Observations

CAPTURE.

## Outputs

CAPTURE (roadmap, PRDR, run ledger, events, summary, holdout verdicts, merge records, harness output, with SHA-256 each).

## Deviations

CAPTURE (record any human touch, e.g. a reviewer-pool repair, and any post-registration change; "none" if none).

## Redactions

CAPTURE.

## Criterion outcomes

CAPTURE (one row per SC-1 to SC-6, each with its deciding OC).

## Result

Main result: CAPTURE (supports-hypothesis, does-not-support, inconclusive or protocol-failure)

- Evidence complete: CAPTURE

## First failure

CAPTURE ("none" unless a stage failed).

## Claim assessments

### Reproducibility

- Result: not-evaluated
- Independent operator: false
- Rationale: single operator; no independent re-analysis planned for this run.

### Repeatability

- Result: not-evaluated
- Executions: 1
- Tolerance: none predeclared
- Rationale: one run; repeatability is a separate, later assessment.

### Generalisation

- Result: not-evaluated
- Axes: none
- Population: the P1 link-shortener subject only
- Aggregation: none
- Rationale: one subject, no varied axes.

## Limitations

- Bounded to one run against one subject.
- SC-6 rests on the CLI decision-table selftest for its rungs, not a live ignition per rung.
