# Share planning graph facts

`faff planning-graph` computes cycle membership and distinct transitive unlock counts over supplied active IDs and live blocker edges. The methodology slot uses the CLI for graph facts, then applies its existing priority, creation-time and judgement rules. Map and tidy continue to consume one methodology diagnostic per pass. The agile lens uses the same structural floor. External blockers remain outside the walk, so graph results cannot clear queue eligibility. Tracker reads, status classification, ghost-pointer checks, break recommendations and topology changes keep their current owners.

Each cyclic component returns all its `members` and one `witness`, a closed sequence of declared blocker edges. A component can include members outside that witness. Map uses all members for its chain check. Rendering depicts the actual witness and names other members. Routing uses full membership. The supplied graph remains the source for reviewing candidate break edges.

The SCC traversal is shared directly with #1234. Build queue partitioning still chooses edges and ordering under its own contract. The graph input edge tuple matches #1233's `live_edges`. Pass only edges sourced at the active IDs being described, since the tracker batch may also include terminal sources for status resolution. This also works with current connector-neutral live observations.

## Measurement

Compared with the #1234 head `cc9eb639`, prompts shrink by 2,382 bytes, about 589 tokens by the repository's characters-divided-by-four estimate. Modes can run together for a batch that needs both results. A 120-issue fixture using #1233's executable output passed 4,753 bytes of graph input for cycles alone, with 147 bytes of output. Unlock counts for 20 roots used 4,893 input bytes and 270 output bytes. The combined call used 4,893 input bytes and returned 415 bytes. Across 25 fresh Node 22 invocations per variant, the median times were 38.5, 38.5 and 39.0 ms respectively. CLI I/O can exceed the static prompt savings, depending on graph size and harness transport. In particular unlock counting walks the reachable graph per root, so restricted roots avoid unnecessary work.

Executable tests cover the diagnostic-to-map and unlock-to-ranking projections. The overlap check used actual #1233 and rank 10 executables, then validated an extracted `circular-blocked` outcome using the existing routing validator. Thirty-two synthetic build queues produced byte-identical partition output against #1234. No live tracker, native agent or hosted timings were collected.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `After the diagram, write one summary line.` | Map's summary uses overlap with full membership from the same diagnostic used in Phase 7. | test/planning-graph.test.mjs | changed: consume explicit member IDs from the CLI |
| `Name the member issue IDs in cycle order and recommend the concrete break action` | Map renders the witness in edge order, names remaining cyclic members and retains its recommendation. | test/planning-graph.test.mjs | changed: avoid treating all members as one edge path |
| `blocker graph cycles of any length, computed over the full active-issue graph` | Tidy consumes the same structural floor with self-loops and arbitrary cycle length. | test/planning-graph.test.mjs | changed: detect via the shared CLI |
| `The baseline every pass depends on; two of its findings feed the routing verdict` | Backlog diagnostics still always runs with cycles and ghost pointers. | test/planning-graph.test.mjs | changed: mechanics in the structural floor |
| `The routing_adaptor assigns the Automation-routing verdict from backlog-diagnostics` | Routing still uses cycle and ghost-pointer findings, with cycle IDs taken from all component members. | test/planning-graph.test.mjs | changed: read members from the structural floor |
| `Every backlog-diagnostics must detect cycles and ghost-project pointers` | Every lens composes the floor. Other required and optional named outputs retain their scope. | test/planning-graph.test.mjs | changed: shared executable traversal |
| `Composes the shared structural/topology floor for the mandatory graph floor` | Agile composes the floor and retains its own diagnostic categories. | | changed: refer to the canonical call |
| `Compose the methodology-agnostic cycle + ghost-project structural/topology floor` | Thematic composes the same floor, which now specifies the executable. | | changed: refer to the canonical call |
| `Order by priority (issue-level or inherited from any ancestor), then chainable unlock value` | Thematic keeps priority and age. The CLI counts distinct downstream issues over live edges. | test/planning-graph.test.mjs | changed: move transitive counting to the CLI |
| `Detect backlog structure: dep cycles, ghost-project pointers, repeat-park patterns, splittable specs and chain gaps` | Thematic always runs the structural floor and adds repeat-parks, splittable specs, chain gaps and combined orphan findings. | | changed: refer to the floor and detection table |
| `Cycle + ghost-project detection is the shared structural (topology) floor` | Cycle detection is shared by thematic and agile. Other categories stay in thematic's table. | test/planning-graph.test.mjs | changed: refer to the floor and detection table |
| `Tarjan / DFS-with-coloring pass over the full active-issue blocker graph` | A shared SCC traversal detects every cycle over the supplied active IDs. | test/planning-graph.test.mjs | changed: replace the model traversal with the CLI |
| `The cycle + ghost-project findings feed the automation-routing contract` | Findings pass through to the routing adaptor. | test/planning-graph.test.mjs | changed: centralise the shared rule |
