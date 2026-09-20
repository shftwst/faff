# Spec: FAFF-1047 — Audit governance-check `discover` step for the FAFF-1038 errexit-abort shape

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1047.

This is a buildable nlspec for FAFF-1047, addressed to the build agent that will apply the fix and to the human reviewers gating it. It is deliberately tight: the ticket is a single-line shell audit with a known-good fix pattern already shipped by FAFF-1038, and the exploration has already settled the one open question (reachability). The spec's job is to record why the bug is real, name the exact fix, and specify a negative fixture that fails before the fix and passes after.

## 1. WHY — Problem and Principles

**The load-bearing model:** under `set -euo pipefail`, a `while` loop's exit status is the status of its *last executed iteration's body*, and a command substitution assignment `X="$(pipeline)"` inherits that status through `pipefail` — so if the loop's final iteration ends on a failed test, the assignment itself trips errexit and aborts the step before any later line runs. This is the identical mechanism FAFF-1038 fixed at `.github/workflows/validate.yml:256`, whose own fix comment states the goal plainly: append `|| true` "so the assignment itself never trips errexit and every line below stays reachable."

**Problem statement.** The `.github/actions/governance-check/action.yml` "Discover carried run dirs" step (id `discover`, lines 143–164) captures its result at line 150 with an unguarded command substitution whose terminating pipeline stage is `while read -r d; do [ -n "$d" ] && [ -d "$d" ] && echo "$d"; done`. When the alphabetically-last changed run-dir path is a *deletion* — present in `git diff --name-only` but absent on disk at HEAD — the loop's final iteration fails its `[ -d "$d" ]` test, the loop's exit status is that non-zero, `pipefail` propagates it, and `set -e` aborts the step before the `dirs`/`found` outputs are written. The fix guards the capture so trailing lines stay reachable, exactly as FAFF-1038 did for its sibling site.

**Design principle — preserve the current filtered output, change only the abort.** The `[ -d "$d" ]` test already does the intended work: it filters deleted run dirs out of `DIRS` ("not carried anymore", per the step's own header comment at lines 135–138). The fix must not alter which directories end up in `DIRS`; it must only stop the trailing non-zero status from aborting the step. On the trigger input the step must emit the *same* filtered `DIRS` (existing dirs only) and the correct `found` boolean it would emit if it never aborted.

**Design principle — neutralise only the benign status, and know which status that is.** The only realistic non-zero exit from the line-150 pipeline is the while-loop's final-iteration test failure; `printf` of a shell variable, `awk` field parsing, and `sort` do not meaningfully fail on this input, and the genuinely fallible command — `git diff` — is already captured separately and guarded on line 149. So terminating the line-150 pipeline with `|| true` masks nothing an operator would want to see abort the check.

| System | Language | Relevance |
|---|---|---|
| `.github/actions/governance-check/action.yml` (lines 143–164) | Bash-in-YAML (composite action) | The audit target; the `discover` step to fix |
| `.github/workflows/validate.yml` (lines ~253–279) | Bash-in-YAML (workflow) | The sibling FAFF-1038 fixed; the fix-pattern precedent |
| `test/gates-ci-macos-guard.test.mjs` | Node `--test` .mjs | The FAFF-1038 negative-fixture harness this spec's test mirrors |
| `plugin/skills/faff/bin/lib/gates.js` (`extractRunCommandsWithContext`) | JS | Extracts the real step body from the YAML so the fixture exercises shipped text |

**Scope.** A one-line hardening of one composite-action step plus one negative fixture; it touches no CLI verb, no governance invariant, and no other step in the file.

## 2. OUT OF SCOPE

- **The `discover-anchors` step (lines 174–193).** Excluded — its line-186 capture pipes into `node "$BIN" governance-check --derive-anchor-dirs`, a different terminating stage with no trailing `while`-loop test, so it does not have this shape. Extension point: if a future audit finds a distinct abort shape there, it gets its own ticket. (FAFF-568 already owns that step's discovery concern.)
- **A class-wide errexit guard across all `.github/` captures.** Excluded — the ticket's own `grep -rnE '=\$\(.*\|.*grep' .github/` confirmed `validate.yml:256` was the only *other* instance of the exact capture shape, and FAFF-1038 fixed it. This is the one remaining candidate, audited individually rather than behind a speculative blanket guard. Extension point: none needed; the class is now empty.
- **The other bash steps in `action.yml`** (`check-binary`, `use-in-checkout`, `fetch-pinned`, `derive-issue`, `anchor-missing`, `on-missing`, `governance-check`). Excluded — none capture a `while`-loop's status into an assignment under errexit; `derive-issue` (line 207) already guards its `grep | head` capture with `|| true`, and the final `governance-check` step deliberately runs under `set -uo pipefail` *without* `-e` and observes `$CODE` by hand. Extension point: none.
- **The CLI `governance-check` verb behaviour.** Excluded — the bug and fix are entirely in the action's shell wrapper; the verb's inputs and outputs are unchanged.

## 3. WHAT — The change surface

**Vocabulary.**

| Term | Definition |
|---|---|
| the capture | The line-150 assignment `DIRS="$(printf … \| awk … \| sort -u \| while read -r d; do … done)"` |
| trigger input | A base…head diff whose alphabetically-last changed `<artifacts-path>/<run>` path is a deletion — absent on disk at HEAD |
| the trailing lines | Lines 154–164: the heredoc that writes the multiline `dirs` output and the `if [ -n "$DIRS" ]` that writes `found=true|false` |

**The current capture (line 150), verbatim:**

```
DIRS="$(printf '%s\n' "$CHANGED" | awk -F/ -v p="$ARTIFACTS_PATH" 'NF>=2 {print p"/"$2}' | sort -u | while read -r d; do [ -n "$d" ] && [ -d "$d" ] && echo "$d"; done)"
```

**The two outputs the step must always write** (lines 154–164), which the abort currently skips on the trigger input:

- `dirs` — a multiline heredoc (`GOVDIRSEOF`) of the filtered, existing run dirs.
- `found` — `true` when `DIRS` is non-empty, else `false`.

**Design decision — how to guard the capture.** Two viable shapes:

- Append `|| true` to close the command substitution's pipeline: `… done || true)"`. Minimal, one token, identical to FAFF-1038's shipped pattern, and the ticket names this pattern explicitly.
- Restructure the loop body from an AND-list to an `if`: `while read -r d; do if [ -n "$d" ] && [ -d "$d" ]; then echo "$d"; fi; done`, so the body — and thus the loop's final status — is always 0. Correct, but a larger edit that diverges from the established precedent for no behavioural gain.

**Chosen:** append `|| true` to the line-150 pipeline (`… done || true)"`), matching FAFF-1038's shipped fix pattern. It is the smallest change that keeps the trailing lines reachable and leaves the filtered `DIRS` content untouched (the `|| true` runs only when the pipeline is non-zero and emits nothing to stdout).

## 4. HOW — Behaviour

**The fix.** Change line 150's capture so its command substitution can never exit non-zero from the loop's final-iteration test:

```
DIRS="$(printf '%s\n' "$CHANGED" | awk -F/ -v p="$ARTIFACTS_PATH" 'NF>=2 {print p"/"$2}' | sort -u | while read -r d; do [ -n "$d" ] && [ -d "$d" ] && echo "$d"; done || true)"
```

The `|| true` binds to the whole `printf | awk | sort | while` pipeline. When `pipefail` would otherwise surface the while-loop's non-zero final status, `|| true` substitutes 0; the command substitution exits 0; the `DIRS=` assignment succeeds; and lines 154–164 run. When the pipeline already exits 0 (empty `CHANGED`, or a last-processed dir that exists), `|| true` never fires and nothing changes.

**Behaviour by input, after the fix:**

```
PROCEDURE discover (post-fix):
  1. CHANGED = git diff --name-only base head -- artifacts-path   # already `|| true`-guarded (line 149)
  2. DIRS    = for each unique <artifacts-path>/<run> in CHANGED, keep it iff it exists on disk
               # `|| true` ensures the capture exits 0 regardless of the last iteration's test
  3. write `dirs` heredoc = DIRS                                  # always reached
  4. write `found` = (DIRS non-empty)                            # always reached
```

- Empty `CHANGED` (no artifacts in the diff): while body never runs → capture exits 0 → `DIRS=""`, `found=false`. Unchanged by the fix.
- Last changed dir present on disk: final iteration succeeds → capture exits 0 → `DIRS` lists existing dirs, `found=true`. Unchanged.
- **Trigger input** — last changed dir is a deletion (absent at HEAD): pre-fix, the final `[ -d ]` fails, the capture exits non-zero, and `set -e` aborts before line 154. Post-fix, `|| true` neutralises the status → the step emits the correctly-filtered `DIRS` (deleted dir already excluded by `[ -d ]`) and the correct `found`. **This is the only sub-case the fix changes.**

**Anti-pattern:** removing the `[ -d "$d" ]` test to "simplify". Why: that test is the intended filter that drops PR-deleted run dirs ("not carried anymore"); removing it would let a stale, deleted run dir back into `DIRS` — a correctness regression, not a cleanup. The fix keeps the filter and only neutralises its trailing status.

**Anti-pattern:** guarding by wrapping the assignment as `DIRS="$(…)" || true`. Why: `set -e` does not treat a failed simple assignment-with-command-substitution the same as a compound, and the idiom that reliably works here (and that FAFF-1038 shipped) is neutralising *inside* the substitution so the RHS exits 0. Keep the `|| true` inside the `$( … )`.

**Failure mode — the fix masks a genuine pipeline failure.** The risk in appending `|| true` is swallowing a real error from `git`/`awk`/`sort`. How you'd know: `DIRS` would come back empty or wrong on an input where it should be populated, and the fixture's positive assertions (below) would fail. What it means: proceed — `git diff` is already captured and guarded on line 149, and the residual pipeline (`printf` of a variable, `awk` parse, `sort`) has no realistic non-zero path on this input other than the while-loop status the fix targets. This matches FAFF-1038's own reasoning for the identical token.

## 5. Scenarios — born-verifiable objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The one objective above the complexity bar is the reachability claim made concrete: the step must survive the trigger input. A holdout reserves a second concrete instantiation for the code-blind evaluator.

```
Given a base…head diff under artifacts-path whose alphabetically-last changed run-dir
      path is a deletion (absent on disk at HEAD) and at least one earlier changed
      run-dir path that exists on disk
When the real `discover` step body is executed under `bash -eo pipefail`
Then the step exits 0 (no errexit abort),
 and GITHUB_OUTPUT's `dirs` heredoc contains exactly the existing run dir(s), excluding the deleted one,
 and GITHUB_OUTPUT's `found` is `true`
```

- The pre-fix body, exercised over the same trigger input, MUST reproduce the regression: a non-zero exit with the `dirs`/`found` outputs never written (the "remove the guard, it reddens" demonstration, mirroring FAFF-1038's AC7).

## 6. Design Decision Rationale

**How to guard the line-150 capture?**
- *Append `|| true` to the pipeline* — pro: one token, exact FAFF-1038 precedent, zero behavioural change to `DIRS`; con: reads as a blanket status-swallow unless the adjacent comment explains it.
- *Restructure the while body to an `if`* — pro: makes the loop's zero-status structural rather than masked; con: larger diff, diverges from the shipped pattern, no behavioural gain.
- **Chosen:** append `|| true`, accompanied by a short inline comment (in the FAFF-1038 style) naming why the neutralisation is safe here, so the next reader doesn't mistake it for hiding a real error.

**How to test — extract the real body, or assert on a copy?**
- *Extract the shipped step body from `action.yml` via `extractRunCommandsWithContext` and run it under bash* — pro: the fixture exercises whatever the file actually ships, so a future edit is caught; con: the harness must substitute the `${{ inputs.artifacts-path }}` / `${{ github.event.pull_request.base.sha }}` / `${{ …head.sha }}` templating and stub `git` on PATH. `extractRunCommandsWithContext` captures step bodies by `- name:` even without a `jobs:` block, so filtering the returned records by `step_name === "Discover carried run dirs"` yields this step's lines (verified by reading the extractor).
- *Hand-copy the line into the test* — pro: no templating/stub plumbing; con: the copy silently desyncs from the shipped step, exactly the failure FAFF-1038's fixture was written to avoid.
- **Chosen:** extract the real body FAFF-1038-style (mirror `test/gates-ci-macos-guard.test.mjs`), substituting the `${{ }}` placeholders with test values and stubbing `git diff --name-only` to emit the synthetic diff. The fixture asserts both directions (fixed body passes; a mechanically-reconstructed pre-fix body reddens).

## 7. Open Questions and Assumptions

**Open Questions.** None — reachability is settled (the trigger input is a pure-cleanup PR that deletes the alphabetically-last carried run dir; concrete and real), and the fix pattern is fixed by FAFF-1038 precedent.

**Assumptions.** None requiring human resolution. The one external dependency — that `extractRunCommandsWithContext` can pull this composite-action step body by name — was verified against `plugin/skills/faff/bin/lib/gates.js` during exploration, not assumed.

## Already shipped against this surface

- **FAFF-1038 (Done, 2026-09-13, PR #889, commit 86c66db2)** — fixed the *sibling* capture at `validate.yml:256` and explicitly named this `governance-check:150` site as out-of-scope. Established the `|| true` fix pattern and the negative-fixture harness this ticket reuses. Does **not** touch `action.yml`; the line-150 shape is still unguarded → this ticket's premise holds.
- **FAFF-924 (Done)** — split governance-check binary resolution into condition-gated steps. Same file, unrelated concern (binary resolution `check-binary`/`use-in-checkout`/`fetch-pinned`), not the `discover` capture.
- **FAFF-913 (Done)** — sanitized GitHub Actions annotations for governance-check. Same file, unrelated concern.
- **FAFF-568 (Done)** — anchor-dirs discovery (`discover-anchors`, adjacent step). Different terminating pipeline stage, no `while`-loop-into-assignment shape; not the line-150 site.

None of these fixed the line-150 errexit shape — the premise is load-bearing.

## 8. DONE — Definition of Done

### From WHY
- [ ] The `discover` step no longer aborts (errexit) on the trigger input where the alphabetically-last changed run-dir path is a deletion; it runs to completion and writes both outputs.

### From WHAT / HOW (the fix)
- [ ] `action.yml` line 150's capture closes its command substitution so it can never exit non-zero from the while-loop's final-iteration test (`… done || true)"` or equivalent), with an inline comment naming why the neutralisation is safe (FAFF-1038 style).
- [ ] The filtered `DIRS` content is unchanged: deleted (absent-on-disk) run dirs remain excluded; existing run dirs remain included.

### From HOW (behaviour by input)
- [ ] Empty `CHANGED` still yields `dirs` empty and `found=false`.
- [ ] Last-changed-dir-present still yields the existing dirs in `dirs` and `found=true`.
- [ ] Trigger input (last-changed-dir deleted, ≥1 earlier existing dir) yields exit 0, `dirs` = the existing dir(s) only, `found=true`.

### From Scenarios (negative fixture)
- [ ] A new test (e.g. `test/faff-1047-governance-check-discover-guard.test.mjs`), in the `test/gates-ci-macos-guard.test.mjs` style, extracts the real "Discover carried run dirs" step body from `action.yml` via `extractRunCommandsWithContext`, substitutes the `${{ }}` templating, stubs `git diff --name-only` to emit the synthetic trigger diff, and runs the body under `bash -eo pipefail`.
- [ ] The fixture asserts the fixed body exits 0 and emits the correct `dirs`/`found` for the trigger input, AND that a mechanically-reconstructed pre-fix body reproduces the regression (non-zero exit, outputs unwritten).
- [ ] The pure-cleanup-only holdout case (single deletion, `dirs` empty, `found=false`, exit 0) is covered.

### Integration smoke test
```
1. Write a temp dir containing one real run dir: <tmp>/.faff/runs/aaa-run/
2. Stub `git` on PATH so `git diff --name-only BASE HEAD -- .faff/runs`
   prints two lines:  .faff/runs/aaa-run/run-ledger.json   (exists)
                      .faff/runs/zzz-deleted/run-ledger.json (absent — sorts last)
3. Run the extracted `discover` body under bash -eo pipefail with
   ARTIFACTS_PATH=.faff/runs, BASE/HEAD set, GITHUB_OUTPUT=<tmp>/out
4. Assert exit 0; parse <tmp>/out: `dirs` contains only .faff/runs/aaa-run,
   `found=true`.
```

confidence: high
build-tier: standard
spec-review: approve
