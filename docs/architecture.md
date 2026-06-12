# Architecture: agent lanes

Faff operates across three segregated executor lanes with controlled visibility:

| Lane | Role | Sees | Doesn't see |
|---|---|---|---|
| **Orchestrator** | Pipeline sequencing, external interface (tracker, human, reporting) | Tracker, docs, codebase (read) | — |
| **Implementor** | Architecture, spec interpretation, code, tests | Codebase (read/write), spec | Tracker, human dialogue |
| **Evaluator** *(future, L4)* | Quality control from business-value perspective | Spec, running environment | Codebase |

Isolation is by design — the implementor can't mark its own homework, and (once built) the evaluator can't be biased by implementation approach. **Today only the orchestrator and implementor lanes are active**; the evaluator lane is a documented-but-future L4 capability.
