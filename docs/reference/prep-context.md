# Prep round context composition

`faff prep-context --issue ISSUE --root DIR [--run-dir DIR] --resolutions-file FILE|-`

This local composition prepares the scratch context for one review round. Invoke
it again at the start of every round, immediately before dispatch. It reads no
tracker and runs no model. It does not write the decisions register or decide a
review verdict.

The input file or stdin contains the existing `RatifiedTrackerResolution[]`
accepted by `ratified-scope --fold-resolutions`. The caller remains responsible
for the same-turn fetched comments, post-spec scope, live intent marker/status,
automation author exclusion, topic/Chosen extraction and latest-topic selection.
Pass `[]` in git-only mode. This command neither establishes human provenance nor
resolves missing/tied timestamps. Input is bounded to one MiB.

| Result | Meaning |
|---|---|
| Exit 0, `ready` | Fresh assembled context, optionally folded with the existing inert renderer; `file` and `sha256` identify it |
| Exit 3, `absent` | Legitimately empty assembly and resolution set; stale context removed |
| Exit 2, `needs-human` | Assembly source read failed; stale context removed and no fold attempted. Do not dispatch with fabricated empty context |
| Exit 2, `failed` | Input or scratch operation failed; do not use an earlier file as this round's successful output |

JSON stdout includes `assembly_exit`, `warnings` and `diagnostic`. An argument or
input-file read failure instead reports stderr and exits 2. Append every returned
warning to the round audit log. Successful assembly writes the existing
`ratified-scope.stderr` scratch file too. A malformed or oversized resolution
array adds no fold; a valid assembly may already have refreshed the scratch file.

Scratch uses the existing `spec-review-dir` resolver. Supply the run directory
explicitly; no latest-run discovery or ambient run-directory lookup occurs.
The optional PRD container comes only from that run's ledger. Missing or unreadable
ledgers retain the existing shell's no-container fallback; unreadable or invalid
container data also produces a warning. Assembly itself always runs for valid
invocations, including when no container resolves.

Existing source limits are retained. `ratified-scope --validate` accepts the
assembled sections but currently rejects a resolutions-only context even though
`--fold-resolutions` explicitly produces that form after empty assembly. The
composition does not change that validator. Raw-comment extraction grammar and
timestamp tie policy remain with the caller.
