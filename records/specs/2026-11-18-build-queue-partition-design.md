# Partition the admitted build queue

One local command accepts the build-ready set for a wave. The caller supplies normalized repo-relative scopes, named surfaces, meaningful subsystem tags, live blockers, judged producer/consumer matches and explicit human overrides. The command groups work and orders dependencies. Tracker discovery and reads, semantic extraction, admission, priority and execution stay with their existing owners.

The command returns every admitted ID exactly once in the existing `independents` and `groups` shapes. A group may have no directional dependencies. When dependencies form a cycle, the command orders that component by ticket ID and still honours the edges entering and leaving it. Both cycle lists remain visible. The inferred-only list belongs in the run summary. The broader list identifies cases where a legal order is impossible. The existing executor blocker gate still consumes only declared blockers.

The CLI returns one witness for each structural link that joins two components, so a dense overlap does not produce a quadratic report. It preserves distinct quotes for accepted and audit-only inferences. Duplicate declared or file, directory and surface matches already caught by the other rules are omitted. Normalized path matching remains case-sensitive and compares complete path segments. A named directory overlaps its descendants, including another named directory, and a file at the exact directory path. An ancestor directory inferred from two filenames is never a fact. Stable ticket ID order breaks ties within the CLI result. Methodology still orders independents and group leads.

## Measurement

At base `b4b86788`, the beep-boop prompt was 154,055 bytes and 38,180 estimated tokens. The updated prompt is 148,918 bytes and 36,910 estimated tokens, a reduction of 5,137 bytes and 1,270 estimated tokens using the repository's characters-divided-by-four estimate. The command runs once per nonempty wave, including an explicit-list wave.

| Synthetic wave | Issues | JSON input bytes | JSON output bytes | Median wall time | p95 wall time |
|---|---:|---:|---:|---:|---:|
| Mixed | 12 | 1,641 | 703 | 40.8 ms | 47.5 ms |
| Mixed | 100 | 12,680 | 5,276 | 45.3 ms | 61.4 ms |
| Dense exact overlap | 100 | 12,590 | 7,774 | 41.9 ms | 43.3 ms |

Local timings include Node 22 process startup and parsing, with 15 fresh processes per row. The small wave's input and output amount to about 587 estimated tokens if both enter model context. The 100-issue cases can exceed the static savings on a pass that retains the full payload. The original skill already handled the underlying facts and partition in context. No provider token, end-to-end latency, or spend reduction is established.

Executable tests assert group membership, stable ordering under permutation, path boundaries, cycle order, ignored external edges and audit-only inference. A single independent Claude session read the candidate section, assembled the supplied synthetic wave and called the shipped executable. A replay of its exact 2,364-byte input produced the same four independent issues and two ordered groups, with the inferred cycle, two ambiguous matches and the human override accounted for. Both executor units were projected without launching workers. The prompt subsequently clarified that only declared blockers feed the existing executor gate. The command and tested partition did not change.

No baseline model arm ran. These checks do not establish equivalence of model-derived facts, methodology decisions, tracker freshness or live executor launch behaviour. The verification inputs and transcripts stay outside the commit.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Before the build pass, partition the ready set into` | Components project to independent IDs and ordered groups. | test/build-queue-partition.test.mjs | kept |
| `conflict analysis is the mechanism that handles` | Prompt retains in-wave serialization and existing dependency gates. | test/build-queue-partition.test.mjs | changed: moved mechanical grouping into the CLI |
| `Heuristics — issues are considered likely to collide` | Explicit facts define the same grouping inputs. | test/build-queue-partition.test.mjs | changed: the command owns fixed tests |
| `Their specs name one or more of the same files` | Equality on normalized full file paths. | test/build-queue-partition.test.mjs | kept |
| `Same directory at full-path granularity` | Match the deepest shared directory actually supplied. Distinct files alone do not conflict. | test/build-queue-partition.test.mjs | kept |
| `Named shared module / util / symbol` | Compare supplied names exactly. Spec interpretation remains caller-owned. | test/build-queue-partition.test.mjs | kept |
| `One issue declares another in-queue issue as a blocker` | Live directed blockers join components and precede consumers. | test/build-queue-partition.test.mjs | kept |
| `Shared scope tag / label` | Compare supplied subsystem tags exactly. | test/build-queue-partition.test.mjs | kept |
| `Inferred producer→consumer dependency` | Firm matches produce a directed ordering edge unless excluded. | test/build-queue-partition.test.mjs | kept |
| `When in doubt, serialise. Parallelism is a speedup` | Caller supplies uncertain collision pairs. Ambiguous inferred dependency stays audit-only. The executor's rebase remains. | test/build-queue-partition.test.mjs | changed: split conservative collision from audit-only inference |
| `Output of conflict analysis:` | JSON output is the CLI contract. | test/build-queue-partition.test.mjs | kept |
| `"independents": ["ISSUE-A", "ISSUE-B", "ISSUE-C"]` | Preserve existing executor partition shape and audit list. | test/build-queue-partition.test.mjs | kept |
| `Log the partition and the reasoning` | Prompt logs ordered units, witness and inference evidence. | test/build-queue-partition.test.mjs | changed: CLI supplies a bounded witness set |
| `serialise a real producer→consumer dependency` | CLI supplies dependency order. Methodology owns value ordering. No tracker mutation. | test/build-queue-partition.test.mjs | changed: separated scheduling facts from judgement |
| `over the already-assembled build-ready set` | Command runs after admission and has no path to add or remove a candidate. | test/build-queue-partition.test.mjs | kept |
| `1. Extract signals per issue.` | Prompt retains producer and consumer extraction. | | changed: condensed caller responsibilities |
| `the issue creates a nameable surface` | Prompt retains WHAT/HOW and Chosen inputs plus representative surface types. | | changed: condensed extraction guidance |
| `the issue depends on a surface it doesn't create` | Prompt retains Assumes and spec evidence. | | changed: condensed extraction guidance |
| `against the produces-signals of every other in-queue issue` | Caller classifies by ticket ID or paraphrase. CLI ignores external and rejects self matches. | test/build-queue-partition.test.mjs | changed: split matching from mechanical filtering |
| `already declares B a blocker (heuristic 4 serialises it)` | Suppress redundant inferred dependency against declared edges and file, directory or symbol matches. | test/build-queue-partition.test.mjs | kept |
| `Classify the match: firm` | Prompt retains both classes and original signal thresholds. | | changed: condensed classification guidance |
| `Fold into the partition.` | CLI composes graph edges. | test/build-queue-partition.test.mjs | kept |
| `place the pair in a collision group, producer before consumer` | Topological order within the connected component. | test/build-queue-partition.test.mjs | kept |
| `ambiguous → do not serialise` | Audit-only disposition. | test/build-queue-partition.test.mjs | kept |
| `Edge cases:` | CLI tests cover cycles, external records and human overrides. | test/build-queue-partition.test.mjs | kept |
| `Cycle (A↔B consume each other, over the inferred edges)` | Collapse firm inferred cycles by ticket ID and report them for the summary. | test/build-queue-partition.test.mjs | kept |
| `Producer not in the build-ready set:` | No external-edge partitioning. Admission and chain-gap handling stay upstream. | test/build-queue-partition.test.mjs | kept |
| `Inferred dep contradicts a human "not blocked" signal` | Directional human override surfaces the quote without scheduling the inference. | test/build-queue-partition.test.mjs | kept |
| `Record every firm and ambiguous inference (with quoted evidence)` | Prompt logs and passes inference dispositions and cycle lists to the existing summary. Executor inputs distinguish dependencies from evidence. | test/build-queue-partition.test.mjs | changed: data replaces hand-written partition and audit shape |
