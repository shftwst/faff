# L4 lights-out whole-loop proof, P1 link-shortener (FAFF-499) — registered, pre-run

Status: REGISTERED and FROZEN, awaiting execution. This is the clean, freeze-before-execute companion to the retrospective backup at `../2026-08-29-l4-p1-link-shortener-faff-499/`. It is the one that can reach `supports-hypothesis`.

## The freeze rule (read first)

`report.md` down to and including Procedure is frozen: the hypothesis, the six success criteria, the decision rule, the inputs, and the procedure. Once you commit this case, do not edit those sections. Changing a frozen field opens a new experiment identity, it does not amend this one. Committing this case is the registration act, so commit it before you run.

## How to run and fill it

1. Commit this case as-is (registration). Do this before executing.
2. Execute the run yourself: scaffold the SUT, author the same PRD (`evidence/prd.md`), and run per `report.md` Procedure. Same PRD and runbook as the 29 Aug run.
3. Capture the evidence into `evidence/` and fill the CAPTURE fields in `report.md`, per `CAPTURE-CHECKLIST.md`.
4. Write `reports/0001.json` (the machine record) to agree with `report.md`, validate it, then commit as the published result.

## What is already pinned

- The frozen PRD input (`evidence/prd.md`), the runbook generator, and the assertion harness, all by SHA-256 in `report.md`.
- The planned SuperDomestique revision (`shftwst/faff` at `13fb3239…`). Confirm the exact commit the cage ran at execute time.

## What only you can supply

- A durably reachable SUT repo. The single biggest reason the retrospective case is not publishable is that its subject commit lived in a throwaway worktree. Push the SUT to a durable remote and record its slug and final commit here, or the case cannot be verified.
- The run itself, and the post-run capture.

The assertion harness these criteria are checked with is `../../assert-p1-top-of-loop.sh`.
