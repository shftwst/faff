# What is durable, and what is still missing

Answering "what needs to be made durable, how, and where" for this case.

## Where durable evidence lives

- Durable, committed: `verification/external-verification/results/2026-08-29-l4-p1-link-shortener-faff-499/`. Git tracks this whole tree, including `evidence/` (the `.gitignore` re-includes `results/**/evidence/`). Verified: all 22 files stage cleanly.
- Scratch, never committed: the top-level `evidence/` bundle. It was a landing spot for artifacts pulled from the external SUT repo. Nothing there is citable; it stays gitignored.

So the rule is simple: anything a reader must be able to check lives under the case, not under top-level `evidence/`.

## What is now durable (done)

Curated, load-bearing artifacts copied into `results/<case>/evidence/`:

- `run-ledger.json`, `events.jsonl`, `summary.md`: run identity, L4 guardrails, timeline, `converged/both-dry`.
- `plot-decompose.log.md`: proves `run-start plan/coverage-thin` then converge in one run (SC-1, SC-2).
- `roadmap.md`, `prdr-0001.md`, `prd.md`, `specs/`: the skeleton, the loop-Accepted PRDR, the PRD, the drained specs (SC-1 to SC-4).
- `holdout/`, `custody/`: code-blind holdout verdicts and merge records (the merge heads ground the subject commit).
- `outward-guard-negative-20260830.md`: the self-directed refusal write-up (SC-5).
- `run-start-selftest.txt`, `run-outward-selftest.txt`, `assert-harness-output.txt`: the live check captures (SC-6 and the objective checks). Harness verdict captured GREEN.
- The assertion harness itself: `verification/external-verification/assert-p1-top-of-loop.sh` (already tracked).

## What is deliberately NOT copied

- The delivered application source. The subject repo at its pinned commit is the durable record; duplicating the code here adds no integrity. The merge head grounds it instead.
- The 2.5 MB raw `run.log` and the cost-run transcripts (hundreds of MB). Out of scope for a behavioural verification; `events.jsonl` plus `summary.md` carry the signal. Cost is a separate concern.

## What is still missing to publish this as a valid case

Ordered by how much they block.

1. Subject repo: RESOLVED. Pushed to https://github.com/shftwst/faff-sut-p1-link-shortener-l4 at commit `0e3b7be379a7413a50e82dcf608607405999b3c3`, which matches the tleugm merge head. The grounding commit now resolves for a reader.
2. `report.json` (the machine record) is not written yet. The `report.md` scaffold exists; the JSON companion, schema-validated, is required. Fields to fill are the MISSING tokens in `report.md`.
3. Immutable revisions, still MISSING: the SUT repo slug; the SuperDomestique (faff) commit the cage ran; the harness version; the served model id (session model was claude-opus-4-8, exact served id may be "not exposed"); the runtime versions (node, docker); the secret names.
4. Hashes to compute at publish: the scaffolder and the assertion harness, plus every file now under `evidence/` (record each in `report.json`).
5. A case validator. The precedent ships `tools/validate.mjs` that reuses the shared subset validator and cross-checks `revisions.subject.commit` against the merge head and README/JSON agreement. Add the equivalent, or run the shared validator, before publishing.

## The freeze problem (the honest ceiling)

The run executed on 2026-08-29, before this record existed. The protocol requires freeze-before-execute. Registering now is retrospective, so the hypothesis was frozen with the result known. Consequence: this case cannot honestly reach `supports-hypothesis` on the strength of the 29 Aug run alone; the main result caps at `inconclusive`, with the retrospective registration recorded as a deviation.

Two ways forward:

- Publish this as an honest retrospective `inconclusive` case (all criteria pass, evidence incomplete, freeze compromised). Useful as a record, but not a citable positive proof.
- Freeze these criteria now (the FAFF-499 acceptance already is them), then run one fresh lights-out proof against the pinned SUT and publish that as `supports-hypothesis`. This is the only path to a clean positive result.
