# External-verification report

RETROSPECTIVE SCAFFOLD, not yet a published case. The run executed on 2026-08-29 before this record was registered, so the freeze-before-execute principle is not met. See Deviations and GAPS.md. Tokens marked MISSING are the outstanding data.

## Experiment

- Identity: EVP-L4-P1-0001
- Synthetic: false
- Title: L4 lights-out whole-loop proof on the P1 link-shortener (trigger to plan to converge to drain)
- Registered at: 2026-08-30T13:30:00Z (retrospective, see Deviations)
- Completed at: 2026-08-29T16:51:43Z
- Published at: 2026-08-30T13:30:00Z
- Publication: revision 1, `reports/0001.json`, status original

## Hypothesis

One manually-ignited L4 lights-out run, with no planning instruction, against a greenfield PRD with thin coverage, plans the work, converges when the PRD is covered, drains and ships the first slice, and refuses when the target is self-directed, all in a single run.

- Unit of claim: one L4 lights-out run against the pinned P1 link-shortener subject.
- Decision rule: every success criterion is decided by an objective check. The main result is supports-hypothesis only when all criterion outcomes are pass, none unresolved, required evidence complete, and no protocol-stage failure.
- Planned variations: none.

### Success criteria

| ID | Statement | Judgement-dependent |
|---|---|---|
| SC-1 | With no planning instruction, `faff run-start` returns `plan/coverage-thin` and the run writes an initiative to project to first-slice-epic skeleton. | no |
| SC-2 | After decompose, coverage re-reads covered and `faff run-start` returns `drain/prd-covered`, in the same run. | no |
| SC-3 | The existing drain builds and ships the first slice with no human-authored write. | no |
| SC-4 | The run ends `converged/both-dry`, disposition clean, `faff prdr coverage` satisfied. | no |
| SC-5 | An ignition resolved to faff's own repo yields `run-outward.outward=false` and `run-start` `refuse/self-directed`, with zero writes. | no |
| SC-6 | Inadmissible, ambiguous, no-target, and unmeasurable coverage each resolve to `refuse`, never to `plan`. | no |

## Environment

- Runner class: claude-box cage, nested rootless docker (dind-in-cage)
- Trigger: manual `faff lights-out` mint then `/faff:faff-beep-boop` drain (two cages)
- Runtime versions: MISSING (node, docker, faff version at run time)
- Configuration (non-secret allowlist): `tracking.tracker: none` (git-only pin), `budget.tokens: 30000000`, adversarial review + spec_review engines nvidia-glm and gemini-gemma, `FAFF_RUN_HEARTBEAT_STALE_SECS=7200`
- Secrets present (name only): adversarial engine keys via `.env.claude-box` (names MISSING)

## Immutable revisions

- Subject repository: `shftwst/faff-sut-p1-link-shortener-l4` (https://github.com/shftwst/faff-sut-p1-link-shortener-l4) at `0e3b7be379a7413a50e82dcf608607405999b3c3` (final main head, tleugm merge)
- SuperDomestique repository: `shftwst/faff` at MISSING (faff commit the cage ran)
- Harness: claude-box + faff CLI, version MISSING
- Model: provider anthropic, serving model id MISSING (session model was claude-opus-4-8; exact served id not exposed)
- Protocol: v0.1 at `verification/external-verification/protocol/v0.1/README.md`, SHA-256 `2082af1f485d3b938eabf8cd80480b2384cf411d93d72b2b93c86050638681a8`

## Inputs

| Role | Path or URL | Media type | SHA-256 |
|---|---|---|---|
| PRD | `docs/prd/link-shortener.md` (bundle copy) | text/markdown | `1a7ad6627d14f369f2e176cb40276f277b5446bccc3e8a7f4f7290a49cf3d7a7` |
| BRIEF | `BRIEF.md` (SUT) | text/markdown | MISSING (not in bundle) |
| scaffolder | `verification/external-verification/scaffold-p1-link-shortener.sh` | text/x-shellscript | MISSING (compute at publish) |
| assertion harness | `verification/external-verification/assert-p1-top-of-loop.sh` | text/x-shellscript | MISSING (compute at publish) |

## Procedure

1. Scaffold the SUT via `scaffold-p1-link-shortener.sh`; confirm git-only via `faff tracker probe`.
2. Author and make admissible the SUT root PRD (`docs/prd/link-shortener.md`).
3. Cage 1: `faff lights-out --check` then `faff lights-out --json` to mint the armed L4 ledger.
4. Cage 2: `/faff:faff-beep-boop` with `FAFF_RUN_DIR` forwarded; run-start plans, plot decomposes, the run falls through to prep and build in the same pass, gates and holdout run, epics merge.
5. Read the exit contract: `faff disposition --run-dir "$run_dir"`.
6. Run `assert-p1-top-of-loop.sh` with cwd = SUT for the born-verifiable criteria.
7. Run the self-directed negative (`run-outward` then `run-start`, cwd = faff's own repo) for SC-5.

## Objective checks

| ID | Oracle | Expected | Observed | Verdict | Evidence |
|---|---|---|---|---|---|
| OC-1 | `plot-decompose.log.md` run-start line + roadmap presence | `plan/coverage-thin`, skeleton written | `plan (coverage-thin)`, roadmap with 1 initiative, 1 project, 3 epics, deps | pass | `evidence/plot-decompose.log.md`, `evidence/roadmap.md` |
| OC-2 | `assert-p1-top-of-loop.sh` AC2 | loop PRDR Accepted | 1/1 loop PRDR Accepted/loop | pass | `evidence/prdr-0001.md` |
| OC-3 | run summary + `assert` AC3 | first slice drained, no human write | 3 epics shipped lights-out; first-slice spec present | pass | `evidence/summary.md`, `evidence/specs/` |
| OC-4 | `run-ledger.json` + disposition | `converged/both-dry`, clean, coverage satisfied | stop_reason `converged/both-dry`, disposition clean, coverage 5/5 | pass | `evidence/run-ledger.json` |
| OC-5 | `run-outward` then `run-start`, cwd = faff repo | `outward:false`, `refuse/self-directed`, zero writes | as expected, `.faff/runs` unchanged | pass | `evidence/outward-guard-negative-20260830.md` |
| OC-6 | `faff run-start --selftest` | PASS on all refuse rungs | `RESULT: PASS (0 failed)` | pass | `evidence/run-start-selftest.txt` (MISSING: capture) |

## Subjective judgements

None. Every criterion is objective.

## Observations

- The run parked once at 13:28 on a code-review backend-pool outage, escalated `product-incomplete`, then resumed after a config-only repair and completed clean at 16:51. This is an infrastructure touch, not a criterion failure.
- Plan and drain occurred in one unbroken run, counter to the earlier two-cycle expectation (Finding 6 on FAFF-499).

## Outputs

| Role | Path or URL | Media type | SHA-256 |
|---|---|---|---|
| run write-up | `evidence/REPORT.md` | text/markdown | `73ec59bfe5027dc8ca018ad2d54e9cea4a59a097aa37ae6179ca9db73f069ec7` |
| roadmap | `evidence/roadmap.md` | text/markdown | `f5330ffda998d3e93d2830465f33202a8385e0f4587af0d886785dbb1b385d06` |
| PRDR | `evidence/prdr-0001.md` | text/markdown | `0d2bed8a27302b28b98a5e071e313cdd078283c5fb12a3d6e42fc0cfed7e3b11` |

## Deviations

- Registration is retrospective: the run executed on 2026-08-29 before this record existed, so the hypothesis and criteria were frozen after the result was known. Freeze-before-execute is not met. A clean case requires freezing these criteria and running a fresh proof.
- One mid-run human infrastructure touch (reviewer-pool config repair plus relaunch, epoch 1). SC-3's "no human-authored write" holds for the first-slice Backlog to Todo transition, not for the whole run.
- SC-6 is proven by the CLI decision-table selftest, not by a live cwd-resolved ignition.

## Redactions

None.

## Criterion outcomes

| Criterion | Outcome | Deciding record | Unresolved reason |
|---|---|---|---|
| SC-1 | pass | OC-1 | |
| SC-2 | pass | OC-2 | |
| SC-3 | pass | OC-3 | |
| SC-4 | pass | OC-4 | |
| SC-5 | pass | OC-5 | |
| SC-6 | pass | OC-6 | |

## Result

Main result: inconclusive

- Evidence complete: false

Rationale: every criterion passes, but required evidence is incomplete (immutable revisions, runtime versions, several hashes, and the co-located evidence subtree are MISSING), and registration is retrospective. Under the protocol, incomplete required evidence forces inconclusive, never supports-hypothesis, until the gaps in GAPS.md are closed.

## First failure

None (no stage hard-failed; the record is incomplete, not failed).

## Claim assessments

### Reproducibility

- Result: not-evaluated
- Independent operator: false
- Rationale: no second operator has re-analysed the pinned inputs.

### Repeatability

- Result: not-evaluated
- Executions: 1
- Tolerance: none predeclared
- Rationale: a single run.

### Generalisation

- Result: not-evaluated
- Axes: none
- Population: the P1 link-shortener subject only
- Aggregation: none
- Rationale: one subject, no varied axes.

## Limitations

- Bounded to one run against one subject.
- Registration is retrospective, so the freeze principle is compromised; this record cannot reach supports-hypothesis on the strength of the 29 Aug run alone.
- SC-6 rests on the CLI selftest for two of its rungs.
