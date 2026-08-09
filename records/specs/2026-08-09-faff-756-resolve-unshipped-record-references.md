# FAFF-756: Resolve tracked references to design, RFC, and report records that are not shipped

> Spec: faffter-noon-spec · 2026-08-09 · interactive · confidence: high. Full spec on Linear FAFF-756.

## Why

Tracked code, skills, architecture notes, ADRs, specs, and audits refer to design, RFC, and report files that are absent from the shipped repository. Some are active dependencies; others are historical provenance. Treating both groups alike would either leave current guidance broken or rewrite history.

## What

- Redirect maintained skill and source comments away from absent `design/*.md` targets.
- Remove maintained documentation dependencies on the two unshipped reports.
- Restore `docs/rfc/rfc-governance-tamper-evidence.md` as the tracked design input its implementation records describe.
- Add one reference register that gives every inventoried target an explicit disposition while retaining historical citations.

## Boundaries

- Do not change runtime, CLI, workflow, route, or configuration behaviour.
- Do not bulk-rewrite immutable historical records.
- Do not commit the stale tracker filing plan, the unverified landscape research, or unrelated ignored RFC drafts.
- Do not add literal-prose tests.

## Done

- [ ] Maintained skills, source comments, and architecture documentation no longer depend on absent targets.
- [ ] The tamper-evidence RFC is tracked and links only to shipped companions.
- [ ] Every inventoried target has an explicit disposition in the reference register.
- [ ] Historical citations remain intact and interpretable.
- [ ] Repository searches find no absent-path dependency in maintained executable prose or source comments.
- [ ] Existing documentation and adapter checks pass.
- [ ] The implementation contains no functional code change.

confidence: high

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen", "decision": "Repair active references while preserving historical citations." },
    { "marker": "chosen", "decision": "Restore the tamper-evidence RFC as tracked design rationale." },
    { "marker": "chosen", "decision": "Leave stale planning and unverified research reports unshipped." }
  ]
}
```
