# Run a complete spec review in one call

A caller can hand the normal four-lens pass to the bundled CLI. Preserve the supplied context paths, independent requests, backend pin, cache strategy and returned contract. A timeout returns to the existing prep hold. Partial and custom reviewers retain their existing paths.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Spec-review turn-budget hand-back (turn-budget hold). The healthy-slow twin of the` | changed: Prep passes its configured budget to the bundled caller. The transport supervisor returns 124; prep retains its existing retry and hold policy. |
| `Dispatch the lenses via fan-out.mjs's resolved strategy, never a per-lens loop.` | changed: Dispatch uses the existing fan-out transport and configured scheduling strategy. |
| `Prepare the requests once. Resolve $faff per the shared executable rule. Run "$faff"` | changed: The full-set command prepares one batch. The explicit-lens path keeps the supplied order and context spellings. |
| `- Exit 0 gives {round, strategy, backends_path, requests_path}. Set $backends_json` | changed: The full-set command passes the descriptor to fan-out and then passes the result file to the recorder. |
| `- Exit 2 or 3, or a missing or malformed descriptor, means no fan-out. Use` | changed: Preparation faults use no-results with the existing round. A timeout hands back to prep before result recording. |
| `Each request uses its lens's own system prompt and the same spec, context and` | changed: The existing assembler owns the per-lens brief, shared input and raw capture. |
| `- Wire shape. review-call.mjs places the byte-identical shared context+spec block in` | changed: The existing review-call payload keeps the shared spec and context before each lens brief. |
| `- fan-out.mjs returns a JSON array of LensResult in request order. Read its ttftMs` | changed: The recorder reads the same ordered timings. |
| `- Configure the refuter backend to a model structurally different from the spec` | changed: The slot retains the independent refuter requirement. |
| `In-band prefill-cache self-check (advisory, prime-then-parallel only). The` | changed: The recorder computes the advisory from time to first byte for the resolved strategy. |
| `### Record results and aggregate` | changed: The recorder still aggregates complete sets. Partial votes go to the existing aggregator. |
| `On a successful fan-out, run "$faff" spec-review record-results --dir "$pin_dir"` | changed: The complete-set command supplies the existing recorder with its round and files. Partial calls retain the file flags and ordered subset. |
| `Partial lens batches, including outage retries. Add --receipts-only to record this` | changed: Partial retries still use receipts-only. The caller now receives the prior full-set entries for any swing-capable outage. |
| `The command passes raw served stdout and its truncation flag to the existing parser,` | changed: The same recorder owns serving identity, raw output, errors and pin capture. Prep owns the round record. |
| `Forward the single fenced block from complete-set record-results or the caller's` | changed: Both paths forward the fenced verdict unchanged. |
