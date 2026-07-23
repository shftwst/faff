# Architecture: agent lanes

Faff operates across three segregated executor lanes with controlled visibility:

| Lane | Role | Sees | Doesn't see |
|---|---|---|---|
| **Orchestrator** | Pipeline sequencing, external interface (tracker, human, reporting) | Tracker, docs, codebase (read) | — |
| **Implementor** | Architecture, spec interpretation, code, tests | Codebase (read/write), spec | Tracker, human dialogue |
| **Evaluator** *(L4, lights-out)* | Quality control from business-value perspective | Spec, running environment | Codebase |

Isolation is by design — the implementor can't mark its own homework, and the evaluator can't be biased by implementation approach. The evaluator lane is the **L4 lights-out lane**: it runs under `faff lights-out`, where the code-blind holdout evaluator judges the work against a spec it never saw and its verdict gates the merge — though today "a spec it never saw" is an **attested** (compliance) property, not a physically enforced one: the evaluator currently runs inline and *can* read the repo. Not every enforcement leg is wired end-to-end yet — the `evaluator-preflight` assert-in is built but not yet called from the live holdout dispatch (see [CLI reference](cli.md)) — but the lane ships and runs on the lights-out path.
