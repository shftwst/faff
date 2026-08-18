# Decisions register

Human-ratified precedents that faff's autonomous resolve-attempt may cite when a spec punts a decision this register has already settled. One `##` section per decision; each carries `Chosen`, `Rationale`, `Scope`, `Matches` (semicolon-separated), and `Date`. See `faff decisions match --punt "<topic>"`.

## Cross-box liveness for a read-only recovery verb

- Chosen: A recovery verb that only reconstructs state and previews (writes no owner.status / owner.epoch) relies on the operator's killed-executor guarantee and adds no liveness machinery of its own. The write-once recovery-claim ref that prevents two executors continuing the same run concurrently belongs at the continuation / owner-state-write boundary (faff lights-out --resume), not in the read-only verb.
- Rationale: A read-only reconstruct-and-preview verb structurally cannot double-continue because it never writes owner state, so the distributed mutex belongs where owner state is actually written. Putting it in the read-only verb over-scopes it and adds an unnecessary external owner.status-adjacent writer (a new ADR exception) for a guarantee it does not need.
- Scope: Phase 0 runtime recovery and resume; any verb that reconstructs run state versus one that continues it.
- Matches: cross-box liveness; recovery-claim ref; double-continue; read-only verb liveness; operator killed-executor guarantee
- Date: 2026-08-17
