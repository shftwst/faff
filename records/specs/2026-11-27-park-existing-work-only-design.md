# Recover a parked build with or without an existing PR

A unit can park before opening a PR. Commit its existing work and draft its PR when present. The interactive recovery offer must also work for a pre-PR build. Keep the existing spec, structural, later-lookup and unattended routes.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Every faff skill that can park` | The shared protocol still applies to each caller. | test/park-finalize.test.mjs | kept |
| `Preserve WIP and flip the PR to draft` | Preserve existing work and draft an existing PR. Keep a pre-build park free of fabricated work. | test/park-verdict.test.mjs | kept |
| `the terminal line names the exact re-invoke command` | Retain all interactive return paths and the unattended no-offer rule. | test/park-finalize.test.mjs | kept |
