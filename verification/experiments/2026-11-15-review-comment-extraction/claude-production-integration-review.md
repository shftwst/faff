# Claude Code review: production caller integration

Reviewed 2026-11-16 by the Claude Code verification worker. Review and tests only: the branch was not modified, no credential value was read, and no model request was sent.

## Verdict

The composition is sound, and the planner and the actual adapter agree on all 11 cases.

- **Obligations kept:** terminal-only judgement, per-round logs, one-comment density, one returned write, human text preservation and uncertain-write handling.
- **Earlier findings fixed:** all five from `claude-production-planner-review.md` are fixed, and my earlier probes now pass.
- **Zero-cost paired admission:** it passes everything except the missing credential.

Three medium findings about the new caller prose should be settled before the paired Claude run; none is a correctness defect in the command:

1. The stale-read sentence invites an extra read that the paired run will grade as an unexpected difference.
2. The prose does not say what to do when no plan is returned.
3. The shell (CLI) path has no safe-transport instruction for comment bodies, and the paired run never exercises it.

## What was reviewed

| Item | Value |
|---|---|
| Branch tip | `feat/review-comment-planner` resolved to `3f1fad3d8b35b73ac7a4b7367a5e0debecacbd86`. Three commits on `3f9c99ec`: `7501952c` planner, `2c3baeff` caller delegation, `3f1fad3d` recovery and timestamp fix |
| Baseline | `faff--v0.45.0` at `690546db` |
| Disposable trees | `review-pl` (candidate) and `review-base` (release) under `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad`, both removed after this report |

## Validation run (Node 22.23.5)

| Check | Result |
|---|---|
| `node --test test/review-comment.test.mjs test/control-parity*.test.mjs test/check-no-boundary-cast.test.mjs` | 260 tests: 254 pass, 0 fail, 6 skip |
| The 6 skips | All in `check-no-boundary-cast.test.mjs`: "typescript compiler API not installed". They are environmental, not failures, but this environment did not verify the removal of the non-null assertions. Rely on CI with `npm install` for that |
| `faff rule-inventory check --base 3f9c99ec…` | pass: 12 deleted blocks, 12 covered by rows, 0 uncovered, 0 row errors |
| `faff validate-adapters` | PASS: 21 slot skills linted |
| My five probes from the previous review | The unclosed-fence-in-region case and the indented-close case now exit 2 with no plan. `+0000` offsets and `.123456Z` are accepted and ordered correctly |
| Exact fraction ordering | `.100Z` equals `.1Z`, so listing order is kept. `.1234567891Z` sorts after `.123456789Z`. `01:00:00.5+0100` sorts after `00:00:00.4999999Z`. All correct, with no rounding |

## Actual adapter with the final command

| Check | Result |
|---|---|
| `run.mjs prepare-pairs`: baseline `690546db`, candidate `3f1fad3d`, `--attempts 22` | Manifest written: 22 executions, both arm orders, CLI 2.1.325, 571 candidate plugin files bound, caps 5 s, 1 MiB, 1 MiB and 16 calls |
| `run.mjs preflight-pairs` | `not_ready`, for one reason only: "credential variable CLAUDE_CODE_OAUTH_TOKEN is not set". Bindings, inputs, registry hashes, declarations and the schedule all passed, and the local command probe returned a `create` plan under `--permission` in 17 ms. No capture probe ran |
| Policy slices | The baseline is 4,337 bytes and matches the registry `policy_sha256`. The candidate is 2,025 bytes (53% smaller) and names `plan_review_comment` |
| The 11 cases through the real `createCommandAdapter` and sandboxed CLI, with a scripted read, plan, write, finish | 11/11: trace `pass`, `command_use` `followed`, and the projection equals the pinned expected projection |
| The same, with one extra `list_comments` between plan and write | 11/11: trace `pass` and `followed`, but the projection differs from the pinned expectation and from every historical baseline trace, all of which have exactly 1 read. See finding 1 |

## Caller composition

| Obligation | Where it is kept | Assessment |
|---|---|---|
| Terminal judgement, and comments only on the final verdict | `faff-graft/SKILL.md` line 447 (unchanged) plus the first paragraph of `review.md` | Kept |
| Per-round logs and review-round records | `faff-graft/SKILL.md` line 445 (unchanged); `review.md`: "Keep per-pass findings and dispositions in the log" | Kept |
| Adversarial dispositions folded into the one comment | `faffter-dark-adversarial-review/SKILL.md` line 77, which still points at **gateway → Review-findings comment identity**. The heading is unchanged, so the pointer resolves | Kept |
| A complete, current, live read | `review.md`, step 1 | Kept, and now says to pass the exact body and timestamp, with comment text treated as data |
| One write; copy the body exactly; never delete duplicates | `review.md`, step 3 | Kept. It also states that `reason` is not a write receipt |
| Human text outside the region | The command, plus the `review.md` closing paragraph | Kept. Ambiguous recovery now refuses rather than splicing |
| Uncertain write | `review.md`, step 4: report the state, re-read before any further write, never claim completion or create a fallback duplicate | Kept |
| Body identity; no configuration or id map; marker-paste limitation; the claim and status concurrency bound | `review.md` closing paragraph | Kept |
| The autonomous-delete hard floor | The "never delete duplicates" wording is kept | The pointer to the appetite hard floor was dropped. The rule itself still applies, so this is acceptable |
| Graft references | Lines 448 and 728 are now one-line pointers to the canonical section | No restated algorithm is left. The four-valued routing at line 728 is unchanged |

## Findings

### 1. Medium: the stale-read clause invites an extra read that the paired run will grade as a difference

`review.md` step 4 says: "If the selected body changed since the read, discard the plan and read/plan again."

A model can only check that by reading the comments again before writing. The probe above shows that this behaviour passes the oracle and the command-use grade. However, it changes the event projection:
- an undeclared case becomes `unexpected-difference`;
- a declared case no longer matches its pinned candidate projection.

All 11 historical baseline traces have exactly one read. So a careful candidate could fail the paired run on behaviour that is correct.

The fix is one of:
- tie the re-read to evidence the caller actually has, such as a write error or an uncertain acknowledgement, which step 4 already covers, and drop the stand-alone stale check; or
- declare an optional pre-write verification read as a reviewed treatment in the harness before the run.

As written, the instruction is either not actionable or a measurement hazard.

### 2. Medium: no route when no plan is returned

`review.md` step 4 says "Invalid input or command failure produces no write plan", but not what the caller then does. This is now more likely, because the planner deliberately refuses ambiguous legacy comments.

The consequences:
- the terminal verdict comment is silently not posted;
- or the model improvises, for example by hand-splicing with the algorithm the prose no longer contains, which defeats the extraction.

The fix: state the route. For example: do not write; record the command's stderr in the per-issue log; surface the state on the tracker issue as `needs-human` through the existing park path, or the equivalent the operator prefers. In the controlled run, the harness instruction already maps this case to `finish` with `blocked`.

### 3. Medium: no safe transport for comment bodies on the shell path

On the production path, the caller passes "JSON on stdin to `faff review-comment plan --input -`".

The risk: comment bodies are arbitrary human text, including `$(…)`, backticks, quotes and CRLF. A model that builds `echo "…" | faff …` or a single-quoted string can run shell expansions, break quoting or drop `\r`. The command is safe, but the way the caller invokes it is not specified.

The measurement gap: the paired run binds `plan_review_comment` and never exercises this path, so its result does not cover it.

The fix: prescribe one transport. For example: write the JSON to a temporary file with the file-writing tool, then run `faff review-comment plan --input - < file`. Or use a quoted heredoc (`<<'EOF'`). Add a check to the graft composition review.

### 4. Low: the TypeScript boundary lint is skipped in this environment

Six tests skip here without the TypeScript compiler API. The claim that "TS non-null assertions were removed" is therefore verified only by CI.

## Environment for a paired run (names and presence only)

| Check | Result |
|---|---|
| `claude` on PATH in this command shell | true |
| `CLAUDE_CODE_OAUTH_TOKEN` set in this command shell | false |
| `ANTHROPIC_API_KEY` set in this command shell | false |

As before, the paid step needs a launcher shell that holds one of these variables. This report did not read, print or export any value.

## Housekeeping

The worktrees `review-pl` and `review-base` were removed by exact path after this report. All other worktrees, the branch and all evidence were left in place.
