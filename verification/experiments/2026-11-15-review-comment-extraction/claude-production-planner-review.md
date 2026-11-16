# Claude Code review: production review-comment planner

Reviewed 2026-11-16 by the Claude Code verification worker. Review and tests only: the branch was not modified, no credential was inspected, and no model request was sent.

## Verdict

The planner is well built, and it implements the seven operator decisions as recorded. All 11 development cases pass both directly and through the sandboxed harness adapter. Repeated updates are byte-stable, and registration, emit and lints are in order.

Three issues should be settled before the caller prose switches to this command:

- **High:** an unclosed fence inside an existing managed region deletes human text after the region.
- **Medium:** Jira timestamps are rejected, so planning fails on every Jira issue that has a timestamped comment.
- **Medium (operator decision):** an indented close marker leads to the same loss of human text.

The four boundary choices are now adopted as implementation choices rather than operator decisions. Finding 1 comes from one of them, so they need the operator's sign-off.

## What was reviewed

| Item | Value |
|---|---|
| Branch | `feat/review-comment-planner`, tip resolved to `7501952c58b0d52c3fdf8cb0f48b657df04cf989` (not the older `b0c6544c`) |
| Parent | `3f9c99eca37aca6d3a83a0a6e9e70e647808b3e4`; one commit, 13 files |
| Release | Tag `faff--v0.45.0` points at `690546db` |
| Review tree | Disposable detached worktree at `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-pl`. Unseen cases are in `…/scratchpad/planner-probe/probe.mjs`, outside the branch |

## Validation run (Node 22.23.5)

| Check | Result |
|---|---|
| `node --test test/review-comment.test.mjs` | 72 tests: 72 pass, 0 fail, 0 skip |
| `node --test test/review-comment.test.mjs test/control-parity*.test.mjs` | 243 tests: 243 pass, 0 fail, 0 skip (matches the expected 243) |
| `faff regions check` | PASS (exit 0) |
| `faff lint-cli-coverage` | PASS, 153 subcommands |
| `faff lint-cli-doc` | PASS, 153 subcommands documented |
| Registration | `bin/faff` lazy loader and `COMMANDS` entry; `regions.js` factory and `REGION_SELFTEST_ARGV: null`; `TEST_FILE_COVERAGE` points at `test/review-comment.test.mjs`; `tsconfig.json` include; `docs/guide/cli.md` row |
| Build manifest | The SHA-256 values of `review-comment.ts`, `review-comment.js` and `tsconfig.json` match their entries |
| Emit | Recompiled into a scratch directory with a local TypeScript 5.5.4 (from `website/node_modules`; the lock pins 5.9.3, and `npm install` was avoided to keep off the network). The emitted `review-comment.js` is byte-identical to the committed file. Type checking itself was not completed: 5.5.4 rejects two newer compiler options and lacks `@types/node`. Treat this as an emit check only |
| Production imports | Only `node:crypto` and `node:fs`; nothing under `eval/` |
| ADR 0142 | All seven decisions match `policy-decisions.json` word for word, and it says boundary validation is not an operator decision |
| Through the harness adapter, permission-sandboxed (`--permission` selected) | 11/11 registry cases give the exact expected body and reason |

## Unseen cases run

| Case | Result |
|---|---|
| Repeated updates with closed fences in the prefix, in the replacement (nested 4- and 3-backtick) and in the suffix (tilde fence holding an open-marker line), CRLF on marker lines; three runs, the last with a new body | Byte-stable: the prefix and suffix are kept exactly, and the same target is chosen |
| Replacement `x\r`, `\nx`, or empty, applied twice | Stable |
| Unclosed fence in the human prefix above the markers | `create`. Acceptable: there is no match, so nothing is lost |
| Trailing NBSP, form feed or U+2028 after the open marker | Still a marker (JavaScript `trimEnd`). Consistent with "trailing whitespace ignored" |
| The same instant written with different offsets | Listing order kept |
| `t`/`z` in lower case, `-00:00`, year `0050` | Accepted and ordered correctly |
| 2,000 duplicate complete pairs | First listed; `reconciled`; 37 ms |

## Findings

### 1. High: an unclosed fence inside an existing region deletes human text after the region

Repro (`planner-probe/probe.mjs`, case 1). The comment is a managed region whose content has an unclosed fence, with human steering text after the close marker:

```
Human prefix
<!-- faff-review-findings:ISS-1 -->
Verdict: old
```js
const x = 1;
<!-- /faff-review-findings:ISS-1 -->

Human steering after the region
```

The plan is `update`/`updated`, with body `Human prefix\n<!-- faff-review-findings:ISS-1 -->\nnew\n<!-- /faff-review-findings:ISS-1 -->`. The steering text is gone.

Cause: the unclosed fence makes the close marker fenced text, so the comment is treated as open-only, and the open-only rule replaces from the open marker to the end of the body.

Why it matters:
- The new replacement check stops this planner from writing such a region, but comments written by the current prose have no such check. A truncated or carelessly closed code block in old findings is enough.
- `review.md` says "Never discard text outside the faff-owned region". None of the seven decisions settles this case: decision 5 says fenced lines are not markers, and the unclosed-fence-to-end reading is one of the implementer's boundary choices.

Suggested fix, for the operator to choose:
- when a matching comment has an unclosed fence after its open marker, refuse (exit 2, no plan) rather than splice to the end; or
- end an unclosed fence at the next line that is exactly the current issue's close marker.

Add a regression case for each direction:
- a fence opened in the region and closed only in the suffix;
- a fence opened in the region and never closed.

### 2. Medium: Jira timestamps are rejected

Repro: `created_at: "2026-11-16T01:34:23.123+0000"` exits 2 with "created_at must be RFC 3339 with at most three fractional digits". `.123456Z` is rejected the same way.

Jira is a supported tracker (`plugin/skills/faff/references/tracker.md`). Jira's REST API conventionally returns offsets without a colon, as above. That was not checked against a live connector. If so, every Jira issue with a timestamped managed comment gets no plan, and the review-findings comment is never written. It fails safely, with no wrong write, but it is a functional regression from the prose path.

Choose one, and record it in the spec:
- accept `±hhmm` offsets and more fractional digits, truncating to milliseconds for ordering;
- or make timestamp normalisation an explicit caller obligation in the reduced prose, with a test.

### 3. Medium, operator decision: an indented close marker also drops human text

Repro (`probe.mjs`, case 2): the body `open\nold\n  close\nHuman text after` gives `open\nnew\nclose`, so `Human text after` is lost.

This follows the recorded decisions exactly. Decision 1 says leading whitespace disqualifies a marker, and the open-only rule in `review.md` treats open to end as the region. So it is not an implementation defect.

It is worth raising with the operator together with finding 1. A human re-indenting the close marker, or a renderer adding spaces, deletes their text. A narrow guard would refuse when a line after the open marker equals the close marker once leading whitespace is stripped. That would be a new decision.

### 4. Low, governance: the boundary choices were adopted without operator decisions

`planner-boundaries.md` and `records/specs/2026-11-16-review-comment-extraction.md` now call these "implementation choices, not additional operator decisions". The choices are:
- rejecting a replacement that contains a marker;
- the unclosed-fence rule;
- rejecting duplicate ids;
- the strict timestamp format.

ADR 0142 is careful to exclude them, which is transparent. However, two of these choices change outcomes, not just input validation:
- the unclosed-fence rule decides which comments match, and causes finding 1;
- the timestamp rule causes finding 2.

They should go to the operator before ticket 3 relies on them.

### 5. Low: build and input robustness

- The emit was checked with TypeScript 5.5.4, not the locked 5.9.3. Rely on CI `npm run build` for the type check.
- `readInput` uses `readSync(0)`. On a non-blocking stdin (some parent processes, especially on macOS), Node can throw `EAGAIN`. That fails safely (exit 2) but would look like invalid input. It does not occur under the harness's `spawnSync` pipe.

## Not findings (checked)

- **Close before open:** `create`, as `review.md` says.
- **Foreign close marker before own open:** `update`.
- **Quoted, inline and indented open markers:** not markers.
- **Fences:** 3-space indented fences count; 4-space indented ones are ordinary text; closing length and info-string rules hold.
- **Complete-pair preference** comes before timestamps; `reconciled` whenever more than one comment matches.
- **Ordering:** missing or null timestamps sort last; ties keep listing order; authorship is ignored.
- **Digest:** `expectedDigest` hashes the original UTF-8 body.
- **Input checks:** duplicate and escaped-duplicate JSON keys, lone surrogates, `1e999`, invalid UTF-8 and more than 1 MiB of input each exit 2 with empty stdout.
- **Purity:** the input object is not mutated.

## Housekeeping

The disposable worktree `review-pl` and the scratch output `tsout` are kept for a likely follow-up review. Remove them with `git worktree remove --force /tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-pl`.
