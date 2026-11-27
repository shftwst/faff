# Show the existing spec-file operand to spec and routing consumers

The scanner accepts one positional spec path. Quote it so a path containing spaces remains one argument. The rating, routing conditions, scanner and public argument contract stay the same.

## Rule inventory

| Prose rule | Covering test | Disposition |
|---|---|---|
| `no **blocking** open Punt` | test/punt-scan.test.mjs | kept |
| `and reads its structured output` | test/punt-scan.test.mjs | changed: show the complete scanner invocation once and retain separate checks for non-Punt lines |
| `The three levels and the gate each maps to` | test/punt-scan.test.mjs | kept |
| `or the explore findings were ambiguous in places` | test/punt-scan.test.mjs | kept |
