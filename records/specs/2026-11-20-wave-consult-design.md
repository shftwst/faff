# Consult the run-termination kernel at a wave boundary

The caller supplies the effective lifecycle mode, checkpoint budget, methodology policy, and the PRD already in scope. The command reads the named run, derives git-only queue and checklist inputs, and calls the existing run-termination kernel. The caller owns tracker reads, the stall counter, and the action actually taken. The consult records its decision and gives the caller the correlation ID for that later action. No action is inferred from the verdict.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Wave-boundary stop. Use the saved mode` | changed: Preserve tracker opt-out and the git-only consult at drain. |
| `The faff run-done consult` | changed: Compose the checkpoint, local runcheck, fresh queue, PRD and methodology before calling the existing kernel. |
| `Non-convergence backstop (convergence loop only` | changed: Keep the admission-based threshold with the ledger owner. Local checklist and queue failures carry distinct warnings. |
| `Capture the wave-boundary decisions` | changed: Capture both consults in-process and record the later action using the exact returned ID. |
| `Always wave-loops until queue stability.` | changed: Link the executor summary directly to step 8. |
