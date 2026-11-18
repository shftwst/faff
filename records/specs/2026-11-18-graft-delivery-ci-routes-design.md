# Graft delivery and no-CI routing

Shorten the dispatcher handoff, the three delivery outcomes and the empty-check branches. The floor, authority, effect ordering, collision handling and CI-red procedure retain their original text.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Dispatch-cut split (who runs the merge). Whether this graft runs the merge locus at all keys on the` | changed: preserve the caller, evidence, permitted actions and return. |
| `- shipped → merged/deployed. (Autonomous mode only — see the autonomous mirror below for the full` | changed: preserve the caller, evidence, permitted actions and return. |
| `- not-ready:<reason> → the merge was deferred without merging — either the producer's` | changed: preserve the caller, evidence, permitted actions and return. |
| `- failed:<reason> → merge conflict or deploy error (or an unmappable result coerced to failed).` | changed: preserve the caller, evidence, permitted actions and return. |
| `- No CI coverage (no-ci-coverage): the applicable-checks set is empty — no PR-triggered check ran` | changed: preserve the caller, evidence, permitted actions and return. |
| `- Autonomous: do not merge. Flip the PR to draft and park needs-human per the shared protocol` | changed: preserve the caller, evidence, permitted actions and return. |
| `- Interactive: require an explicit confirm distinct from the normal "merge now?" — yes/no "No CI` | changed: preserve the caller, evidence, permitted actions and return. |
| `- Post-merge-only validation (a diff whose only check is push/merge-triggered, e.g. a new on: push` | changed: preserve the caller, evidence, permitted actions and return. |
