# Prepare build dispatches

Both concurrency executors pass an ordered partition unit to `faff dispatch prepare-build`. The command binds the run identity, resolves one model and log-only effort for the unit, and sets the Agent launch mode. Each executor verifies corrections before launch. The shared worker instructions in the L4 reference are read once per executor and stamped into each worker prompt.

The CLI reads JSON from stdin and emits the handoff after validating the complete unit and dispatch configuration. The executable cases are in `test/dispatch-prepare-build.test.mjs`. They compare the prepared output to the existing resolver and check failure before dispatch.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` \| `dispatch.build` \| Concurrency build agents and graft Step 7's bare executor; resolve per unit with `dispatc `` | changed: both concurrency executors use the prepared handoff, and bare graft still uses the build resolver |
| `` Every dispatch site calls `faff dispatch resolve <lane>`, never `config get dispatch.*`: the resolver owns pre `` | changed: both commands share the same config validation and resolver |
| `` Every concurrency unit is dispatched as a **build subagent** (Agent/Task tool), never run inline via the Skill `` | changed: the parallel executor retains one Agent per independent or ordered chain |
| `` Dispatch these builds in the background (**`run_in_background`** default/true) to keep N in flight, unlike the `` | changed: the CLI sets background on parallel builds, and the executor still waits for all |
| `` **Explicit review target.** Because each dispatched build runs in its own worktree while the harness session's `` | changed: the shared Build worker prompt contains the original resolution and guard clause |
| `` Each carries a `BuildDispatch` in its prompt — `{ issues, run_id, run_dir, session_id, mode_signal: "autonomou `` | changed: the command constructs the same ordered BuildDispatch and binds the run explicitly |
| `` **Foreground-to-terminal dispatch clause.** Every dispatch prompt also stamps: *"Foreground-to-terminal: run e `` | changed: the shared prompt supplies the worker clauses and the CLI resolves the chain model and log-only effort |
| `` **`constraints` (optional):** immediately before dispatching a unit that is being RE-dispatched after a Sentry `` | changed: the parallel executor keeps its corrective check, verified constraint and park rules |
| `` 2. For each unit in that flattened order — an independent issue, or a whole collision group as one serial chai `` | changed: the CLI builds the handoff and the sequential executor keeps its foreground block, custody manifest, correction outcomes and PR-ready return |
