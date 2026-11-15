# Claude Code review: paired harness final delta and planner boundaries

Reviewed 2026-11-15 by the Claude Code verification worker. Review and tests only: no implementation edits, no credential read, no model request.

## Verdict

- **Harness:** no must-fix case. The patch is fit to commit. Every item from `claude-paired-harness-review.md` is addressed, and I found no false pass, admission bypass, or evidence or accounting gap.
- **`planner-boundaries.md`:** it is consistent with the adapter, the fixtures and the seven recorded decisions. However, four of its rules are new semantic choices. Record them as operator decisions before the production planner is written. This blocks the production implementation, not this harness commit.

## Correction to my previous review

My earlier statement that the tests could not see the strict-comparison problem was wrong for `runCommandPairs`. Its `pairedDriver` test helper already returned `observed_runtime_sha256` from `captureBody` for each arm. The two assertions I cited (`comparison.status` `pass` and `fail`, at the old lines 258 and 263) belong to the older `runPairs` helper, which reports no runtime. The underlying gap was real: in a real run, every pair in the raw strict comparison was `unpaired-runtime` and no events were compared. This patch now addresses it and pins it with assertions.

## What was reviewed

| Item | Value |
|---|---|
| Patch | `paired-final-review.patch`, 84,263 bytes, SHA-256 `c22121d3226bf5f0ab734bdbf259865ca87589934a6f4bc609dca89617f7556d` |
| Base | `ba93d04b` |
| Review tree | Fresh detached worktree: `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-wt6`. The patch applied cleanly |
| Delta from the previous patch | `paired.mjs`: derived comparison, `arm_totals`, fixtures passed to the declaration check. `treatments.mjs`: `expectedProjection`, `candidate_projection_sha256`. `proxy.mjs`: a static runtime check on later turns. `run.mjs`: per-field counts of the requests that reported each token value. `intended-differences.json`: four projection pins. `PAIRED-RUNS.md`. Tests. `command-use.mjs` and `tool-server.mjs` are unchanged |
| `planner-boundaries.md` | Inside the patch, at `verification/experiments/2026-11-15-review-comment-extraction/planner-boundaries.md`. There is no separate copy in this directory |

## Validation run

| Command (in the review tree) | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `node --test test/control-parity-treatment.test.mjs` | 6 | 6 | 0 | 0 |
| `node --test test/control-parity-run.test.mjs` | 39 | 39 | 0 | 0 |
| `node --test test/control-parity-claude.test.mjs` | 49 | 49 | 0 | 0 |
| `node --test test/control-parity-command.test.mjs` | 15 | 15 | 0 | 0 |
| `node --test test/control-parity-command-use.test.mjs` | 13 | 13 | 0 | 0 |
| `node --test test/control-parity*.test.mjs` | 170 | 170 | 0 | 0 |

The pinning assertions are in `test/control-parity-run.test.mjs`:
- line 425: exactly 11 `unpaired-runtime` entries in the raw comparison;
- line 426: the derived comparison contains `event-differs`;
- lines 430-431: per-arm totals and contributing-request counts.

## Probes (local, no model calls)

| Probe | Result |
|---|---|
| `validateDeclarations` on the real committed files, now with fixtures | Accepted: 4 entries. Each `candidate_projection_sha256` equals the expected projection built from the registry and fixture |
| The new proxy rule replayed over every historical request: 19 request directories, 74 requests, hashing every field except `messages` and `metadata.user_id` | All 16 paid (forward-mode) attempts had one static runtime across every turn, including the 4-turn attempts, so there would be no false `runtime-changed` stop. Changes appeared only in the three zero-cost capture probes, where the CLI retried with fewer tools or changed `thinking` after a refusal. The rule does not apply in capture mode, so readiness is unaffected |
| Same replay across attempts | Within each run, every attempt had the same static runtime hash (one hash for the 2026-11-15 measurement, another for the 2026-11-14 calibration) |
| Derived comparison gating | It is produced only when every planned execution has `runtime_matches_readiness === true`. Any `not-run` execution leaves `unavailable`, and saved traces keep their raw runtime hashes |
| Extra candidate read on a declared case | `classifyPair` now requires the candidate projection to equal the pinned expected projection, so an extra read can no longer be waived as `declared-change`. Last review's probe gave `declared-change` for this case; that path is closed |

## Planner boundaries review

**Consistent with the harness and the data:**

| Rule | Check |
|---|---|
| Invalid input exits 2 with empty stdout | The adapter maps any non-zero exit to `command-exit`, which grades `command-error`, a candidate failure |
| One plan plus a trailing newline | `parseStrictJson` and `JSON.parse` accept trailing whitespace |
| 1 MiB input cap before parsing | Matches the adapter's 1 MiB stdin cap |
| No configuration, network, credential or clock lookup | Matches the sandbox, which has an empty environment and no access to files beyond the copied `plugin/` |
| Close-before-open disqualifies | Already in `review.md` ("the first marker line must be the open marker") |
| CR on a marker line rewritten; suffix LF and later bytes kept | Matches the `line-ending-normalisation` and `splice-newline-framing` decisions and the `crlf-outside-region` expected body (`…-->\n\r\nTrailing note`). Also matches the trailing-tab case in `indented-and-trailing-whitespace` |
| `reconciled` when more than one structural match, including those excluded by complete-pair preference | Matches `review.md`, step 4 (more than one match leads to reconcile) |
| Timestamps and IDs | All 11 fixtures have unique comment ids. Every `created_at` value is absent or valid RFC 3339 with at most three fractional digits. All issue ids (`ISS-101` to `ISS-111`) pass the issue-id rule |

**Operator decisions needed before the production planner.** These rules go beyond the seven recorded decisions and the prose. Ticket 1 asks for unresolved boundaries to be frozen without silently broadening the seven decisions. Each should be recorded in `policy-decisions.json` (and the planned ADR) by the operator, not settled inside an implementation document:

1. **Replacement text containing a structural marker is rejected.**
   - What changes: the baseline prose would write such a body; the planner refuses, so no write happens.
   - Example: a review finding that quotes the marker on its own line, outside a fence, would make the operation fail.
   - Open dependency: no grading rule exists yet for the blocked outcome that should follow, since `command_use` requires `completed`.
2. **An unclosed fence makes everything after it fenced text.**
   - Example: a stray ```` ``` ```` in human text above a genuine open marker hides that marker, giving no match and a new duplicate comment.
   - Context: this is a defensible reading, but it changes which comments match, and the `fenced-marker-text` decision names fence characters only.
3. **Duplicate comment ids are invalid input, not a selection case.** This resolves the open ticket 1 item and matches the adapter's single-target check. It needs recording as decided.
4. **Strict timestamp format.**
   - The rule: RFC 3339 with a colon in the offset, at most three fractional digits, no leap seconds.
   - Why it matters: the model passes the tracker's raw `created_at`. A tracker that returns, for example, `+0000` offsets or microsecond precision would make every planner call fail on that tracker.
   - Decide whether the caller normalises timestamps, or whether the planner accepts a wider format. The 11 fixtures do not exercise this, so the harness cannot detect it.

The remaining refinements to the fence grammar (up to three leading spaces, closing-fence length, no backtick in a backtick info string) are standard Markdown fence behaviour within the recorded fenced-text decision. Recording them with item 2 keeps the decision record complete.

## Advisories (carried or new, none blocking)

- **The derived strict comparison will report `fail` on a correct run.** Its status is expected to be `fail` (`event-differs` on the declared cases, plus the baseline's own obligation failures) even when `report.status` is `complete`. `comparison_note` says the raw comparison keeps `unpaired-runtime`; adding one sentence that the derived comparison fails by design on declared changes would prevent misreading.
- **`max_tokens` is part of the later-turn check.** A CLI that lowers `max_tokens` on a later turn would stop the attempt as `runtime-changed`. It fails closed, and no historical paid attempt did this.
- **No `blocked` grading rule yet.** It is still undefined, and planner boundaries item 1 makes it reachable in production.

## Housekeeping

There are six scratch review worktrees (`review-wt` to `review-wt6`) under `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad`. `git worktree prune` cleans them up once the scratchpad is cleared.
