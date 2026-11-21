# Supervision prose reduction

Keep checkpoint placement, Stop-hook ownership and executor return handling at their call sites. The heartbeat, budget meter and concurrency contract define the underlying behaviour.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `At each between-units checkpoint (below), call faff run checkpoint (see _The interrupt_).` | changed: the checkpoint owns the budget check and ceiling route |
| `Token accounting. Tokens are this-run's spend: the orchestrator transcript (keyed off` | changed: keep session attribution, the baseline and estimate reporting at the checkpoint |
| `Refresh the heartbeat across the WHOLE graft lifecycle, not just at issue boundaries —` | changed: keep both tick owners, their timing and the source of liveness |
| `The hook reads this owner record but never writes it — only the run's own agents (the` | changed: retain read-only local hook and owner close |
| `Step 11 is agent-run, so it shares the failure mode it guards against — a non-compliant` | changed: keep registration, supported hooks, purpose and user notice |
| `Ownership + liveness gate. The Stop hook is registered globally and fires on every` | changed: retain owned and recovery blocking, live foreign silence, stale and legacy warnings |
| `The subagent runs faff-graft autonomously in its own context (own worktree, build, gates,` | changed: the concurrency contract owns bucket mapping; preserve the worker boundary, return shape and evidence source |
| `Refresh only through faff heartbeat "$run_dir" --unit <issue>, never a hand-rolled ledger` | changed: keep the exact per-member tick, shared and individual sidecars and write authority |
| `outcome (the recorded ledger bucket) is one of the five build buckets (shipped /` | changed: retain bucket ownership, dispatch cut, PR identity and supersession evidence |
| `Heartbeat ownership follows the single active writer. The blocked orchestrator refreshes` | changed: keep the heartbeat writer on each side of dispatch |
