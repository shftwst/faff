# Compact spec author diagnostics

Both shipped spec producers inherit one draft check. It uses `faff admissible --author-diagnostics` to read the draft and return actionable Scenarios and DONE feedback. It uses the existing Scenarios classifiers, R1 condition and human-marker checks. Overlapping Scenarios reasons count as one finding. Reasons from disjoint warning sets remain separate. Missing Scenarios units are a note to the author. The existing lights-out admission output remains the gate, and tests verify identical DONE check details in both modes.

The gateway now gives both producers one specification for the final readiness fence. Producers still declare the decisions and confidence they authored. Prep still validates the envelope and supplies provenance. Missing, malformed and conflicting blocks retain their existing dispositions. Author review, raters, scanner decisions and attachment rules stay with their existing owners.

## Measurement

Compared with `a3fa5446`, the two producer prompts and shared kernel shrink by 3,194 bytes, about 796 tokens by the repository's characters-divided-by-four estimate. Both paths make one command call. On the same 262-byte fixture, the old gate-shaped stdout was 1,534 bytes and the new author output was 77 bytes. Twenty-five interleaved cold Node 22 calls per mode had medians of 36.9 and 36.1 ms respectively. Startup dominates and these timings do not establish a latency improvement. Sixteen old and new gate calls produced identical exits, stdout and stderr across two modes and eight fixtures. No provider or tracker calls were made.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Deterministic Scenarios check (first, before the reviewer pass)` | Both producers use compact diagnostics before review. R1 distinguishes absent units from a format finding. Scenarios findings use real unit IDs. R2c through R2e use shared checks and remain major. The author applies edits, retries once and logs unresolved findings or failure. | test/admissible.test.mjs | changed: consume structured author diagnostics |
| `The producer emits, the consumer parses.` | Gateway owns the producer envelope and prep remains the deterministic consumer. | test/prep-attach.test.mjs, test/contract-golden.test.mjs | changed: add the producer rules to their shared home |
| `Declare the actual markers and confidence token you authored` | Both producers use the canonical gateway block for provenance, marker order, shape, missing and malformed handling. | test/prep-attach.test.mjs | changed: reference the shared contract |
| `decisions lists each non-trivial decision section's canonical marker in order` | The canonical block keeps decision order, abstains with `none` for missing markers and omits provenance. | test/contract-golden.test.mjs | kept |
| `a present-but-malformed block fails loud downstream` | The shared contract requires one final valid JSON fence. Prep owns fallback on absence and fails on malformed or duplicate blocks. | test/prep-attach.test.mjs | changed: issue the requirement in the canonical block |
| `"confidence": "<your confidence token:` | The shared example gives the same two top-level keys. The allowed confidence values remain in the rating contract. | test/contract-golden.test.mjs | changed: show the shared shape inline |
| `Do not include provenance_present` | Prep alone adds provenance when staging the spec. | test/prep-attach.test.mjs | kept |
