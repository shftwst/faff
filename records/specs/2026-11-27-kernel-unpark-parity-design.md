# Keep the shared unpark rule in the kernel

Reduce text loaded by workers without a new reference read. The section keeps its heading and covers the following cases.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Parking is reversible by design` | Label and human-resolution comment define a park, with skill re-entry and stale-reason clearing as recovery paths. | test/kernel-unpark-guidance.test.mjs | kept |
| `Reason resolved → re-enter.` | Reinvoke the relevant skill. | test/kernel-unpark-guidance.test.mjs | kept |
| `Spec-level park (open Punt:, ambiguous decision` | Human answer, three spec causes, prep refresh, rerating, high-confidence promotion and label clearing. | test/kernel-unpark-guidance.test.mjs | kept |
| `Build-level park (mid-build ambiguity flipped the PR to draft)` | Graft resumes using the existing run artifacts and draft PR. | test/kernel-unpark-guidance.test.mjs | kept |
| `resolve the gap/cycle (file the missing ticket, break the edge)` | File a missing ticket or break the cycle before tidy routes it. | test/kernel-unpark-guidance.test.mjs | kept |
| `Reason no longer applies → auto-clear.` | Tidy's state checks, strip-ok gate, control-label provisioning and invalid-reason cases remain. | test/kernel-unpark-guidance.test.mjs | kept |
| `The label is the contract.` | Label removal and logging restore routing. Git-only clearing respects marker and ledger authority, human and legacy parks, and the detailed park-lane contract. | test/kernel-unpark-guidance.test.mjs | kept |
