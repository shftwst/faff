# Capture checklist (fill after the run)

Do these in order once the run completes. Every artifact goes under `evidence/` in this case, hashed and referenced in `report.md` and `reports/0001.json`. Nothing citable stays in the top-level scratch `evidence/`.

## 1. Pin the immutable revisions

- [ ] SUT repo slug and final main head (the merged head). Cross-check: `revisions.subject.commit` must equal the last epic's `merge-record.json` `head_sha`.
- [ ] The exact `shftwst/faff` commit the cage ran (confirm against the planned `13fb3239…`).
- [ ] Confirm the served model id, or record "not exposed".
- [ ] Runtime versions: node, docker, faff.

## 2. Copy evidence into `evidence/`

- [ ] `run-ledger.json`, `events.jsonl`, `summary.md` (from the run dir / run-summary).
- [ ] `plot-decompose.log.md` (proves OC-1 plan and OC-2 converge in one run).
- [ ] `roadmap.md` (the `.faff/intake/*roadmap*.md`), `prdr-0001.md` (the loop PRDR), the drained `specs/`.
- [ ] `holdout/` verdicts and `custody/` merge records.
- [ ] `assert-harness-output.txt` (run `assert-p1-top-of-loop.sh` with cwd = SUT and save stdout).
- [ ] `run-start-selftest.txt` (`faff run-start --selftest`).
- [ ] `outward-guard-negative.md` (the SC-5 self-directed check, run from faff's own repo, with the before/after `.faff/runs` count).

Do not copy: the raw run.log, cost transcripts, or the delivered app source. The subject commit grounds the code.

## 3. Fill `report.md`

- [ ] Every CAPTURE token: completed_at, published_at, runtime versions, secret names, the OC observed and verdict cells, observations, outputs (with SHA-256), deviations (record any human touch such as a reviewer-pool repair), criterion outcomes, main result, evidence complete, first failure.
- [ ] Main result is supports-hypothesis only if all six SC pass, none unresolved, evidence complete, and no stage failed.

## 4. Machine record and validation

- [ ] Write `reports/0001.json` to agree with `report.md` on hypothesis, main result, and every evidence path and hash. Use the retrospective case and the synthetic example as shape references.
- [ ] Validate against the schema (`plugin/skills/faff/contracts/validate-schema.mjs` against `protocol/v0.1/schema/experiment-report.schema.json`), and add or adapt a `tools/validate.mjs` case validator like the precedent for the subject-commit and README/JSON cross-checks.
- [ ] Commit as the published result, and add a row to the parent `verification/external-verification/README.md` results table.
