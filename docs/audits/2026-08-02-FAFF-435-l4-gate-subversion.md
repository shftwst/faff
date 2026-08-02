# FAFF-435 frontier audit — hardened L4 gate subversion

This audit was run from the Codex subscription seat using OpenAI GPT-5.6-sol against commit `7f9513c66f6ff16e58bdbbc943acb0eba18fb4b0`. It is the portable successor to FAFF-316's Claude/Fable 5 audit. Three fresh contexts divided the source surface; that separation limits shared context, but is not multi-model or statistical independence.

## Result

**`mechanical-subverted`**. L4 must remain preview-labelled. FAFF-351 is not unblocked.

Four findings are dispositioned to **FAFF-690**:

| Finding | Severity | Gate | Result |
|---|---|---|---|
| F1 | Critical | merge-floor / holdout | A writable `run-ledger.json` can be changed from `L4` to `L1`; merge-gate then omits the holdout and treats absent integrity as allowed. |
| F2 | Major | merge-floor | The fixed `integrity-floor` contract does not consume its `integrity` input, so its selftest can report a false pass. |
| F3 | Major | merge-floor | The already-merged PR path writes issue-scoped successful merge evidence without evaluating AC, review, holdout or integrity. |
| F4 | Major | runcheck | A malformed owned ledger makes the Stop hook silently return success, suppressing the completion backstop. |

The sharpest result is F1. `resolveGateLevel` trusts a valid ledger level when no explicit flag is supplied. That same resolved level decides whether holdout is read and whether unasserted integrity refuses. The existing regression test calls the unguarded case a residual caller-discipline gap; under the L4 attacker model, the caller and ledger share the writable run substrate, so discipline is not a boundary.

## Attacks that held

- Malformed, stale, foreign and non-code-blind holdout evidence refuses while the run remains L4.
- Unknown recipes, non-adversarial occupants and advisory gate fallback refuse dial coherence.
- Unreachable lights-out guardrails and unsafe worktree placement refuse launch.
- Sentry consult timeout, malformed output and unknown exits are not treated as all-clear.
- Budget malformed deadlines, unobservable cost fleets and estimate-only L4 metering surface or refuse according to the declared posture.

## Evidence boundary

The machine report is [`2026-08-02-FAFF-435-l4-gate-subversion/audit-report.json`](2026-08-02-FAFF-435-l4-gate-subversion/audit-report.json). Validate it with:

```sh
node docs/audits/tools/faff-435/validate-report.mjs docs/audits/2026-08-02-FAFF-435-l4-gate-subversion/audit-report.json
node docs/audits/tools/faff-435/validate-report.mjs --selftest
```

Broad test execution was not counted as clean evidence: this host's legacy-config fixture, Node 26 behaviour, global signing and sandbox worktree permissions contaminated several integration tests. The findings above are source-grounded and mechanically represented; FAFF-690 adds direct attack regressions before the audit is rerun.

FAFF-435 attacks subversion *of* the gates. FAFF-566 continues to own injection *through* trusted content.
