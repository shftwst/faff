# Resolve the run's convergence mode

Beep-boop rejects conflicting flags before run creation. Once the run is open, a read-only command uses its actual ledger level, the convergence setting and explicit flag to choose the in-run fold and the wave-boundary consult. Git-only always uses run-done, even when the fold is disabled. The documented JSON invocation reaches the same run-done kernel. Previously that invocation exited 2 because the always-JSON kernel rejected the redundant flag.

The no-progress counter still resets only on an admission and the existing owner keeps the threshold and wave log. Of 490 archived run ledgers inspected, one carried a counter and none of the anchors contained a wave directory. The closed ledger schema has no completed-wave identity. A new writer cannot decide from an old count alone whether replay has already charged the current wave. This change reads the mode without mutating that evidence.

## Rule inventory

| Prose rule | Command behaviour or retained instruction | Covering test | Disposition |
|---|---|---|---|
| `Within-run convergence (--converge / --no-converge). Convergence` | Reject mutually exclusive flags before mint. Reuse one mode for every wave. | test/run-wave-mode.test.mjs | kept |
| `5. Wave-boundary stop. How a wave's empty (or all-parked) build` | Use the run level, effective convergence setting and explicit git-only mode. | test/run-wave-mode.test.mjs | kept |
| `- A lights-out-minted (L4) run — convergence is non-optional: do` | L4 forces filing and run-done regardless of opt-out. | test/run-wave-mode.test.mjs | kept |
| `- A plain L3 run, tracker mode, not opted out (the default): sam` | At L3 the default enables both the fold and the consult. | test/run-wave-mode.test.mjs | kept |
| `- An opted-out L3 run (--no-converge, or convergence.enabled: fa` | Opted-out tracker runs use queue emptiness. Git-only still consults run-done. | test/run-wave-mode.test.mjs | kept |
