# Spec judge sequence

## Why

A spec correction can change the evidence for the next proposition. The prep caller needs to resume the same blinded dispatch or advance to the newly corrected spec without reusing a stale reconstruction or ruling.

## What

- Extend the existing judge evidence command with opt-in sequenced assembly and a foreground step. Bind each dispatched proposition to the in-window round records, current spec and freshly rendered case evidence, with an atomic private checkpoint. Preserve the existing roll-up.
- Accept only the configured judge identity selected by prep. Exclude configured or observed refuter identities. Prep keeps the capability comparison and authors the correction. Review transport and contract validation keep their existing owners.
- Reserve each attempt before dispatch. A process that dies before recording a response consumes its attempt. A new prep step can resume once that process exits. This protects against accidental stale reuse in one local scratch directory. The ledger does not establish independent custody.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Assemble the blinded case files` | Keep the existing case builder and owner-only ledger; reopening the same window resumes it. | test/spec-judge-sequence.test.mjs | kept |
| `Dispatch the judge per proposition, two calls each, in fixed ledger order` | Select the first unfinished proposition, then persist a bound phase-one reconstruction and rederive the next case from current evidence. | test/spec-judge-sequence.test.mjs | kept |
| `Resolve the output-token cap once, before either call` | Resolve the same per-judge, shared and default cap before dispatch; refuse changed settings for an active proposition. | test/spec-judge-sequence.test.mjs | kept |
| `only the case file's reconstruction_context` | Send no arguments in phase one, use the prose document and park malformed reconstruction before phase two. | test/spec-judge-sequence.test.mjs | kept |
| `Imperative-scrub the call-1 reconstruction` | Scrub the reconstruction and combine it with freshly blinded arguments for phase two. | test/spec-judge-sequence.test.mjs | kept |
| `Bounded in-turn retry` | The same transport mapping governs each attempt and the CLI retains the per-phase budget across foreground invocations. | test/spec-judge-sequence.test.mjs | changed: expose a transient retry to the caller while preserving bounded continuation |
| `Parse the ruling from call 2's stdout only` | Require exactly one conformant response for the active proposition. Persist its correction handoff and verify the edit before stepping to the next case. | test/spec-judge-sequence.test.mjs | kept |
