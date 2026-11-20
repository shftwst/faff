# Record L4 spec-review results

The caller already has either an ordered fan-out response or an explicit failure to produce a batch. `faff spec-review record-results` consumes those facts and emits the existing aggregate contract. It checks the expected lens set, runs the existing parser and aggregates full sets, retains served transcripts, and records the lowest actual serving backend index using the prepared chain. The command leaves lens selection, review, transport, retry dispatch and the prep round record in their existing owners.

The recorder takes the round from preparation and pairs each exit-0 header against the model in its indexed backend. An invalid batch refuses without emitting a verdict. A serving identity fault retains the transcript and records the capture failure without replacing an existing pin. The exclusive transcript filenames preserve both the first attempt and same-round retries. A batch that never ran records config-fault for every enabled lens and captures the empty served set.

A partial batch returns refutation entries only. Prep retries only outaged lenses. The baseline caller may carry previously served entries when computing the next verdict, so the CLI refuses to publish a partial aggregate and leaves that assembly with the caller.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Keep the prepared backend file for pin capture` | changed: the recorder uses the prepared backend file for capture |
| `Mark every enabled lens unavailable, kind config-fault` | changed: explicit no-results records the same unavailable entries and the empty served set |
| `Pin capture (after aggregation, EVERY round, unconditional)` | changed: the recorder captures once after aggregation for a complete result or explicit no-results |
| `idempotent on the pin itself` | changed: the existing pin writer preserves the original pin and writes each served identity |
| `write no pin or served-<n>.json` | changed: the recorder uses the original empty-served capture |
| `The unconditional capture call` | changed: the recorder derives the winner and calls the existing capture helper |
| `prep reads the occupant-written served-<n>.json` | changed: prep reads the same sidecar from the recorder |
| `ttftMs is the time to the child's first observed byte` | changed: the caller still reads TTFT for its advisory and passes the full batch to the recorder |
| `A non-zero fan-out.mjs exit` | changed: a failed fan-out becomes an explicit no-results batch |
| `Per-lens outcome (the helper's exit decides` | changed: the recorder applies the transport exit mapping |
| `Map each LensResult.exit` | changed: the recorder classifies the supplied exit without invoking a model |
| `\| exit \| meaning \| lens outcome \|` | changed: the recorder implements the exit mapping |
| `findings returned \| run the bundled` | changed: the recorder passes served output to the original parser |
| `persistent transport failure / rate-limited` | changed: exits 5 and 12 stay unavailable/infra-configured |
| `total wall-clock deadline elapsed before any backend produced findings` | changed: exit 8 stays unavailable/infra-configured |
| `default-host down / unsupported provider / model-not-served / auth failed` | changed: those exits remain unavailable/config-fault |
| `an unavailable lens feeds the transport floor` | changed: the existing aggregate receives unavailability unchanged |
| `Parsing an exit-0 lens (deterministic, not prose)` | changed: the recorder invokes the same parsing logic |
| `pass --truncated iff this lens's LensResult.truncated is true` | changed: the recorder passes the boolean directly |
| `record the parser's STDOUT verbatim` | changed: the recorder passes the parser's same entry to the aggregate |
| `Write the parser's stderr diagnostic` | changed: served transcripts retain raw stdout and the deterministic parser diagnostic in separate sections |
| `Reuse the self-contained, zero-dependency` | changed: the recorder imports the existing parser |
| `Per-lens transcript (audit trail)` | changed: the recorder writes the per-lens audit file |
| `Write each served lens's raw review-call.mjs stdout` | changed: the recorder saves served stdout without trimming and leaves the prep round record alone |
| `Append each served lens's LensResult.stderr under a separate heading` | changed: the recorder appends transport stderr under its own heading |
| `Do not clobber a retained transcript within a round` | changed: the recorder claims each attempt filename with exclusive create |
| `the majority/severity gate (deterministic)` | changed: the existing aggregate remains the gate |
| `Collect one JSON array of per-lens refutations` | changed: the recorder supplies full arrays to the existing aggregate and leaves partial batch assembly with the caller |
| `"predicted_consequence": "…", "spec_anchor": "…"` | changed: the existing parser and aggregate still carry the same entry fields |
| `Each objection carries the enrichment fields` | changed: the parser and aggregate still transfer those fields |
| `they never change the majority/severity gate` | changed: the aggregate is unchanged |
| `model may be sourced from the transport-prepended header` | changed: the parser uses the actual header and the recorder checks it against the exact prepared chain |
| `aggregate.mjs --n <count of enabled lenses>` | changed: the recorder supplies the full lens count to the same aggregate function and the partial caller supplies its own enabled count |
| `Supply exactly one refutation entry per enabled lens` | changed: the recorder validates the ordered batch before recording or aggregating |
| `The rule it applies to a consistent set, in order` | changed: the recorder uses the original aggregation order |
| `any config-fault unavailable lens` | changed: the original aggregate handles config-fault and transient swing cases |
| `any critical objection → reject-approach` | changed: the original aggregate applies the critical veto |
| `a strict majority of enabled lenses refuted` | changed: the original aggregate counts the same ordered lens set |
| `at least one non-critical refutation` | changed: the original aggregate computes revise for a minority |
| `5. Clean — all clear → approve.` | changed: the original aggregate approves a clean full batch |
| `an observation is advisory and never gates` | changed: the original aggregate excludes observations from gating objections |
| `emits the producer's single output` | changed: the recorder publishes the block for a full batch and the partial caller still publishes its own aggregate |
