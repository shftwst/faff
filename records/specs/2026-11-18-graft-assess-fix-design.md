# Assess a landing fix from its original and subsequent observations

Graft saves the original landing result before dispatching the implementor. With autofix enabled, land captures sorted, distinct failing check names from every page of the check runs for a regression head. A different triage head or failed observation is an error. The ordinary land call keeps its existing output.

The read-only assessor binds observations to the same issue and PR and checks a terminal result against the pushed SHA. Its actions drive the existing checkpoint writer and landing loop. Recording accepts an array so names containing commas survive. The implementor, budget, shadow handoff, ship review and merge authority stay with their existing owners.

## Rule inventory

| Prose rule | Command behaviour or caller obligation | Covering test | Disposition |
|---|---|---|---|
| `# one foreground call` | Use --fix-checks during autofix to capture a regression snapshot. | test/land.test.mjs | kept |
| `replaces leave_for_human (the existing` | Off still parks without attempting a fix. | | changed: keep the existing off route in step 1. |
| `PROCEDURE handle_fixable_state(issue, pr, run_dir, state, autofix)` | The caller checks the cap before repair and after recording. Assessment chooses the action. | test/land-assess-fix.test.mjs | kept |
| `run_fix_cycle(ctx: FixContext) -> FixResult` | The admitted implementor still diagnoses, edits and pushes. | | changed: state its inputs, boundaries and returns in step 2. |
| `same_class(kind, pre_head, post_head, post_state)` | Repeated conflicts or overlapping regression failures count. | test/land-assess-fix.test.mjs | kept |
| `observe_to_terminal(pr, run_dir, issue)` | Pending repeats the observation; the deadline leaves the checkpoint alone. | test/land-assess-fix.test.mjs | kept |
| `record_failed_cycle calls faff landing-progress` | Use the original checkpoint and count each failed attempt once. Preserve exact check names. | test/land-assess-fix.test.mjs | kept |
| `Merge-time boundary, unchanged.` | Only the landing loop can hand a ready PR to ship. | | changed: retain the merge floor in the continue row. |
| `recording a failed cycle before CI reaches a terminal state` | Pending produces observe-again. | test/land-assess-fix.test.mjs | kept |
| `a fourth time to see if it clamps` | Hard-park at three before another repair. | test/landing-progress.test.mjs | kept |
