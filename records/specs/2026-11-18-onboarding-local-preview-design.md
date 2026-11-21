# Preview the complete local onboarding overlay

Local onboarding currently previews tracking and the bundle pin independently, then writes them in sequence. The new option composes the same two surgical transforms in one `config init --local --pin-local-bundle` call. Dry-run prints the complete overlay and writes nothing. After the existing confirmation, apply compares the recomputed bytes with the retained preview file through `--expect-preview`. A visible intervening edit that changes the result, an unreadable preview or a conflicting bundle value refuses before writing. Without a conflict, the resulting file is byte-identical to the previous two-write sequence.

The option is scoped to local init and refuses `--force`. Explicit first-run, decline-stub, legacy-file and label-prefix decisions stay in their current branches. The standard writer, MCP discovery, native templates and both ensurers retain their existing roles. The preview stores no tracker data beyond the already-confirmed config values.

## Measurement

Compared with `a3fa5446`, the onboarding prompt shrinks by 1,093 bytes, about 272 estimated tokens. For a fresh local overlay, the two original preview commands and two writes returned 341 bytes of stdout. The combined preview and one write returned 202 bytes. Across 25 interleaved fixture iterations per arm on Node 22, the median CLI time fell from 110.8 to 56.7 ms. Every resulting overlay matched the original sequence byte for byte. The benchmark excludes human confirmation, MCP discovery, and ensurers. No tracker or provider was contacted.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `discover native templates (propose + confirm) → preview → confirm → write config` | Config writes once in either mode. Template confirmation remains separate. | test/onboard-local.test.mjs | changed: compose local changes before writing |
| `Assemble a single faff config init call with one` | The caller still passes one set per confirmed value. | test/onboard-local.test.mjs | changed: share the entry point |
| `Only keys this flow detects` | The same tracking key set applies. Project ID and unconfirmed keys remain omitted. | test/onboard-local.test.mjs, test/config-set.test.mjs | kept |
| `run the same command with --dry-run and show the human the exact` | Standard preview stays the existing writer. Local preview now includes both changes. | test/onboard-local.test.mjs | changed: show the exact final local overlay |
| `The writer is surgical and round-trip-verified` | Apply keeps the config writers' parsing, verification and write target. | test/onboard-local.test.mjs | kept |
| `--set tracking.tracker=linear` | Confirmed values still use the same set arguments. | test/onboard-local.test.mjs | changed: remove duplicated example |
| `Local mode: two writes, both --local` | New local option applies both overlays in the same file without ever writing the base. | test/onboard-local.test.mjs | changed: one composed write |
| `Dry-run both before one confirm` | One exact preview, one operator confirmation, one matching apply. The local report keeps the overlay and settings paths. | test/onboard-local.test.mjs | changed: compare the confirmed overlay before writing |
| `config set bundle_store local --local` | The new flag reuses the scalar merge logic for the local pin. | test/onboard-local.test.mjs | changed: remove the obsolete second write example |
| `Example shape (values illustrative):` | The shared command description covers the same argument shape. | test/onboard-local.test.mjs | changed: remove the example heading |
