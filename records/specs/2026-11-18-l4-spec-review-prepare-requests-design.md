# Prepare L4 spec-review requests

The L4 reviewer delegate resolved configuration, pin preference, reputation, round and argv through a shell recipe before calling the shared fan-out. `faff spec-review prepare-requests` reads the same configuration once, reuses the existing resolvers and assembler, and writes two private files and a compact descriptor. The assembled backend array indexes are the same ones the caller later passes to pin capture.

Lens selection and context discovery stay with the caller. The command takes an ordered lens subset when a retry re-runs a lens, preserves named context order and appends the ratified scope when present. The caller still runs the existing fan-out, parses and aggregates each response, and records the actual served reviewer. Review policy and actual backend calls are outside preparation.

Executable tests exercise default and overridden settings, byte-for-byte request assembly, explicit per-consumer chain ordering, reputation fallback, pinned retry subsets, corrupt pins and missing configuration. Invalid or missing preparation fails closed to the existing unavailable-lens route. The caller still attempts no-lens capture for those rounds.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Dispatch the lenses via fan-out.mjs's resolved strategy` | changed: the caller resolves the sibling helper and uses the prepared dispatch strategy for the existing single fan-out |
| `Resolve the chain mechanically through the reviewer-pin` | changed: the prepare command calls the original pin resolver and applies the existing unpinned reputation filter |
| `backends_json=$(mktemp)` | changed: the prepare command owns both private output files, setting resolution, reputation diagnostics and round-based request assembly, while the caller still invokes the shared fan-out |
| `already resolved for raw-body capture; never re-derive it` | changed: pin capture uses the same round returned by the prepare command |
| `round's number (already resolved above via spec-review-window --next-round)` | changed: recording uses the previously resolved round from preparation |
| `Each LensRequest.argv carries exactly what the old per-lens` | changed: the original assembler builds every request using the resolved settings |
| `make review-call.mjs retain each backend's raw response body` | changed: the command passes the same raw directory, lens and round through the original assembler |
| `the files the spec names as --context` | changed: the caller passes the same context paths and the original assembler emits them in order |
| `Ratified-scope block (when prep assembled one)` | changed: the command appends the same scope file to the shared context when it exists |
| `holds the primary-first JSON array` | changed: the descriptor points fan-out and pin capture to the same post-filter backend array |
| `there is no chain to call the helper with; treat either as every lens's` | changed: the caller routes both preparation faults to the same config-fault and no-lens capture path |
