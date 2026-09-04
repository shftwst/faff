# Spec: FAFF-913, surface the genuine governance-check failure as a sanitized GitHub Actions annotation

> Spec: faffter-dark-nlspec · 2026-09-01 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-913.

**Refreshed 2026-09-01 — folds the 2026-08-27 spec-review `reject-approach` objections** (the standing park directly above this spec). Changes, each annotated inline where it lands:
- **infosec (major):** `escapeWorkflowData` now also neutralises the `::` workflow-command delimiter (`::`→`%3A%3A`), not only `%`/`\r`/`\n`. A PR-controlled `run_id`/issue/reason value carrying a literal `::` can no longer mangle the `::error::` line or open a second same-line workflow command. A `::`-bearing smoke assertion is added (smoke step 7).
- **architectural (major):** the headline WHY DoD's end-to-end reach (a failing `merge_floor` PR *lands* a job-level annotation) is now resolved as a **named + validated `**Assumes:**`** on `action.yml`'s shell streaming the verb's stdout through unmodified — that file is FAFF-924's scope, so this spec depends on the pass-through rather than editing it. Validated against the current `action.yml` (§6).
- **QA (major):** a `--json` + `GITHUB_ACTIONS=true` smoke step (smoke step 9) gives the "`--json` output is valid single-object JSON in CI or locally" DoD item a real observation and guards against a build hoisting the annotation call above the `if (json)` branch.
- **architectural (minor):** the `GITHUB_ACTIONS` renderer gate is now a **validated-by-observation DoD item**, not a bare assumption — the smoke test exercises the gate in both positions (set → annotations present; unset → none).
- **QA (minor):** the relationship between smoke step-8's byte-identical check and the golden-fixture DoD item is now stated explicitly (they are complementary, not redundant).

**Re-slice, stated up front (2026-08-27).** A human re-sliced this ticket: FAFF-913 now owns **only** the low-risk renderer/docs half. The `Resolve faff binary` composite-action step-split — the confusable script-source-preview fix, whose whole premise rested on the unverified "a skipped `if:` step emits zero log output" platform assumption — moved out to [FAFF-924](https://linear.app/shftwst/issue/FAFF-924) and stays parked there until a scratch-workflow run proves it. This spec drops that half entirely (its WHAT section, its scenarios, and its DoD items) and folds the review findings recorded against the previous spec: sanitize PR-controlled workflow-command data, pin stdout as the explicit annotation-stream contract, and add golden fixtures proving the two existing renderers stay byte-identical. Nothing here depends on FAFF-924's *edits* to `action.yml`; it depends only on that file's already-shipped stdout pass-through (§6 Assumes), and FAFF-924 does not depend on this — they are independent.

This spec addresses the retained half of FAFF-913: a required `governance-check` run that fails for a real, correctly-enforced reason (most concretely a `merge_floor` refusal) surfaces that reason only in the step summary and a separate PR bot comment — never in the job's `::error::` annotation, the one surface GitHub puts in front of a required-check failure. This is an observability change to the `governance-check` binding: it adds a diagnostic annotation renderer and a docs entry. It changes nothing about what governance-check enforces.

## 1. WHY, Problem and principles

When a required `governance-check` job fails, GitHub directs the reader to the job's **error annotations** (the Checks tab, the PR "some checks were not successful" banner). GitHub only turns *runtime* output starting with `::error::` into such an annotation. `governance-check` today emits none: its genuine failure reason (for the motivating case, PR #754's `merge_floor` leg refusing an anchor whose `review-verdict.json` signal was `unavailable`) lived only in `$GITHUB_STEP_SUMMARY` and in a PR bot comment posted ten minutes earlier on an older commit. Both were correct; neither is where a required-check failure naturally directs attention. The result was a real misdiagnosis: an experienced engineer on this repo read the failure as a binary-resolution bug that did not exist.

This spec makes the genuine failure impossible to miss, by emitting it as a proper job-level `::error::` annotation, while keeping local and `--json` output byte-for-byte unchanged.

**The verb owns rendering, not the composite action's shell.** `governance-check.js` already documents this invariant for its two existing renderers (`renderGovernanceCheckText`, `renderGovernanceCheckSummaryMd`): the verb owns rendering, so local and CI never drift. The new diagnostic annotation output is added as a **third renderer in the same file**, never as bash string-matching over the verb's stdout inside `action.yml`.

**`--json` stdout stays pure JSON.** Nothing outside the verdict payload may be interleaved into `--json` output. A caller parsing it must never see a stray `::error::` line.

**Annotation data is untrusted and must be sanitized.** The strings spliced into a `::error::` line — run ids, issue ids, and per-leg reason text — originate from PR-authored artifacts (`chain-head.json`, `events.jsonl`, hand-committed anchor dirs). A `::error::` line is a GitHub *workflow command*; an unsanitized newline, percent, **or `::` delimiter** in the data would let a crafted anchor mangle the annotation or inject a second workflow command into the runner's command stream (an annotation-injection vector). Every data value is escaped — including the `::` command delimiter, which is *not* in GitHub's published data-escape table and must therefore be handled explicitly — before it is emitted.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governance-check.js` | JavaScript | Owns `evaluateMergeFloorLeg`, `buildReasons`, and both existing renderers; the new annotation renderer + its `cmdGovernanceCheck` call site land here. |
| `docs/guide/governance-check.md` | Markdown | Operator-facing guide; gets a new "Failure modes worth knowing about" entry. |

This sits inside `governance-check`, the required-status-check binding documented in `docs/guide/governance-check.md`. It is an observability and documentation change to that binding, not a change to what it enforces.

## 2. OUT OF SCOPE

- **The `Resolve faff binary` step-split / script-source-preview fix.** Moved to [FAFF-924](https://linear.app/shftwst/issue/FAFF-924) by the 2026-08-27 human re-slice; it stays parked there on the "a skipped `if:` step emits zero log output" scratch-workflow verification. Not touched here. Extension point: `.github/actions/governance-check/action.yml`, owned by FAFF-924. **This spec reads, but does not modify, that file** — it relies only on the file's already-shipped stdout pass-through (§6 Assumes), a property FAFF-924's restructuring must preserve.
- **Binary-resolution hardening** (resolving `$BIN` against an absolute `$GITHUB_WORKSPACE`, defaulting `faff-version` to a pinned sha). The investigation found no binary-resolution defect; resolution already works identically for graft and non-graft PRs. Belt-and-braces at best. Extension point: the `Resolve faff binary` logic, if a genuine defect is ever found.
- **The PR bot's landing comment** (`faff merge-gate --check-only`'s plain-English blocker summary). A separate, already-working code path in `merge-gate.js` that already states the same blocker in prose; nothing about it is broken. Extension point: wherever the bot comment is posted, if the two surfaces should ever be unified.
- **Automatically detecting or blocking a hand-authored anchor commit that lacks a review verdict** (a pre-commit hook, a PR-template check, a graft-side guard). This spec makes the existing, correct refusal diagnosable after the fact; preventing the mistake before the commit is a different, larger change. Extension point: `faff-graft`'s review step, or a new git hook, in a future issue.

## 3. WHAT, Vocabulary and interface

| Term | Definition |
|---|---|
| Runtime output | Log lines a step actually produces while executing. Only runtime output starting with `::error::`/`::warning::` is parsed by GitHub into a Checks-tab annotation. |
| Workflow command | A runner-interpreted line of the form `::name key=val::data`. `::error::<message>` is one; its `<message>` data must be escaped so an embedded newline, percent, or `::` cannot mangle the line or inject a second command. |
| Annotation stream | The stdout stream. The annotation renderer writes with `console.log`, exactly as `renderGovernanceCheckText` does — GitHub reads workflow commands from the step's stdout. This is the pinned contract the smoke test asserts against. |

### New renderer: `renderGovernanceCheckAnnotations(verdict)`

Added to `plugin/skills/faff/bin/lib/governance-check.js`, alongside the existing `renderGovernanceCheckText` / `renderGovernanceCheckSummaryMd`. It writes to **stdout via `console.log`** — the same stream as the text renderer, and the stream GitHub scans for workflow commands.

```
FUNCTION renderGovernanceCheckAnnotations(verdict):
  # CI-only: a `::error::` line is meaningless noise outside an Actions runner.
  IF process.env.GITHUB_ACTIONS != "true": RETURN
  IF verdict.pass: RETURN

  FOR reason IN verdict.reasons:              # document order, verbatim source data
    console.log("::error::faff governance-check: " + escapeWorkflowData(reason))

  # Detect on the STRUCTURED leg result, never by sniffing the free-text reason:
  # verdict.runs[].legs.merge_floor.pass is the same field buildReasons reads, so
  # this can't drift from what actually failed.
  IF any run IN verdict.runs has legs.merge_floor.pass == false:
    console.log(
      "::error::faff governance-check: " + escapeWorkflowData(
        "merge_floor failures need recorded evidence (ac-checklist / review "
        + "verdict / holdout) before landing by hand. See "
        + "docs/guide/governance-check.md, or land the issue through "
        + "/faff-graft's review step instead."))
```

### Data sanitization: `escapeWorkflowData(s)`

A small local helper applied to **every** value spliced into a `::error::` message. It implements GitHub's documented workflow-command *data* escaping — percent first (so the escapes themselves are not double-escaped), then the two line terminators — **and additionally neutralises the `::` command delimiter**, which GitHub's published data-escape table does *not* cover (its table is exactly `%`/`\r`/`\n`), so a defensive implementation must add it by hand:

```
FUNCTION escapeWorkflowData(s):
  RETURN String(s)
    .replaceAll("%",  "%25")     # percent FIRST, so the %-escapes below are not double-escaped
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll("::", "%3A%3A")  # NEW (infosec fold): the `::` workflow-command delimiter.
                                 # MUST run after the %-escape (it introduces `%3A`, which must
                                 # NOT be re-percent-escaped). Renders losslessly as `%3A%3A`;
                                 # leaves single colons in legitimate reason text (e.g.
                                 # "review-verdict: unavailable") readable, while guaranteeing no
                                 # literal `::` survives in the data on the same physical line.
```

**Why `::` needs explicit handling (the infosec finding, resolved).** With `\n`→`%0A`, every emitted annotation is already a single physical line, so cross-line injection (a data newline opening a fresh `::command::`) is closed. The residual vector is *same-line*: a literal `::` inside the data is the workflow-command delimiter, and relying on the runner's "one command per line, the rest is data" parse to treat a later `::` as inert is an *unspecified-parser* assumption. Escaping `::`→`%3A%3A` removes that reliance entirely and closes annotation-mangling defensively — it deliberately goes beyond GitHub's published data table, which (as the reviewer noted) covers only the three characters already handled and would not by itself close this.

The remediation-hint string is a fixed literal and carries none of these characters, but it is escaped through the same helper so no future edit can reintroduce an unescaped value on that path. The verdict-reason strings carry the PR-controlled run/issue/reason data and are the real target.

### Call site in `cmdGovernanceCheck`

Called after the existing `--summary-md` write and before the function returns, guarded on the same `json`/`pass` flags that already select between the JSON and text paths:

```
if (json) console.log(JSON.stringify(verdict));
else renderGovernanceCheckText(verdict);
if (summaryMdPath) { ...append renderGovernanceCheckSummaryMd... }
if (!json && !verdict.pass) renderGovernanceCheckAnnotations(verdict);   # NEW
return pass ? 0 : 1;
```

`--json` output is unaffected: annotations only ever ride the non-`json` path, matching the existing `if (json) ... else renderGovernanceCheckText(...)` split. The `!json` guard on the call site is load-bearing and is directly observed by smoke step 9 (a build that hoisted the annotation call above / outside the `if (json)` branch would interleave a `::error::` line into `--json` stdout and fail that step).

**Anti-pattern:** parsing `governance-check`'s stdout inside `action.yml`'s bash to build the `::error::` annotation, instead of adding a JS renderer. Why: it duplicates rendering logic the verb already owns (`buildReasons`, `verdict.reasons`), reopening the local/CI drift the file's own header comment on the summary-md renderer warns against.

**Anti-pattern:** splicing raw run/issue/reason strings into the `::error::` line without `escapeWorkflowData`. Why: a PR-controlled value containing a newline, `%`, or `::` can mangle the annotation or inject a second workflow command into the runner's stream.

## 4. HOW, Behaviour

### Docs: name the failure mode

`docs/guide/governance-check.md`'s existing "Failure modes worth knowing about" section gains one entry, alongside the two already there (snapshot divergence, `on-missing: pass` fail-open):

> **A hand-authored PR carrying an anchor without a passing review verdict.** A PRESENT anchor is gated fail-closed regardless of `on-missing`. If you commit `.faff/anchors/**` for an issue by hand (`gh pr create`, not `/faff-graft`), `merge_floor` fails until that anchor also carries a `review-verdict.json` whose signal is `pass`. The failing job's `::error::` annotation now names the exact leg and issue; get a review verdict recorded before landing by hand — for example by running the issue through `/faff-graft`'s review step — or don't commit an anchor for work that hasn't been reviewed.

### Edge cases

- **`GITHUB_ACTIONS` unset (local `faff governance-check` run).** No `::error::` lines are printed, even when the verdict fails; local output is unchanged from today (plain `console.log` text via `renderGovernanceCheckText`).
- **`--json` flag set.** stdout stays valid single-object JSON with no interleaved annotation lines, in CI or locally.
- **A reason string carrying a newline, `%`, or `::`** (crafted anchor id, multi-line reason, an embedded `::warning::`-looking substring). It is escaped by `escapeWorkflowData` (`%0A`/`%25`/`%3A%3A`) and rides a single `::error::` line; it cannot open a second workflow command.
- **A large `verdict.reasons` list.** GitHub caps how many annotations it visibly surfaces per step; if that cap is hit, every reason is still present in the console text and the job summary. The annotation set is a diagnostic aid layered on the existing renderers, not a replacement record.

### Failure modes, how the approach could be wrong

- **The failure:** GitHub's workflow-command escaping needs a character or sequence this helper still misses, so some crafted value breaks out of the `::error::` line.
- **How you'd know:** the smoke test feeds a reason string containing `\n`, `%`, and `::` and asserts the captured stdout holds exactly one `::error::` line for it, with `%0A`/`%25`/`%3A%3A` present and no bare newline and no second `::`-delimited command.
- **What it means:** if a value ever escapes, extend `escapeWorkflowData` (the call sites do not change) — for the published data chars, to GitHub's current data-escaping table; for a new *delimiter* sequence, by the same explicit-neutralisation pattern used for `::`.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a PR carries a governance anchor whose review-verdict.json signal is not
  "pass" (missing, "unavailable", "needs-human", or "fail"), and GITHUB_ACTIONS=true
When the `governance-check` verb runs and the merge_floor leg fails
Then stdout includes one `::error::faff governance-check: <reason>` line per entry
  in verdict.reasons (naming the run/anchor id, the issue, and the exact cause,
  verbatim escaped source data), plus exactly one trailing remediation line pointing
  at docs/guide/governance-check.md and /faff-graft's review step
```

```
Given a failing verdict whose reason data contains a newline, a percent sign, and
  a literal `::`, and GITHUB_ACTIONS=true
When renderGovernanceCheckAnnotations runs
Then that reason rides a single `::error::` line with the newline rendered as %0A,
  the percent as %25, and the `::` as %3A%3A — no second workflow command is emitted
```

- The plain-text and `--summary-md` renderers (`renderGovernanceCheckText`, `renderGovernanceCheckSummaryMd`) MUST remain byte-identical to their current output for the same verdict; the annotation renderer is additive only, proven by a golden fixture.
- `faff governance-check ... --json` output MUST remain valid, single-object JSON with no other stdout content, in CI or locally.
- A local (non-CI) failing `faff governance-check` run MUST print zero `::error::`-prefixed lines.

## 5. Design decision rationale

**Where to surface the real, actionable failure.**

| Option | Pros | Cons |
|---|---|---|
| Leave it in the step summary and PR bot comment only (status quo) | Zero cost | The actual gap FAFF-913 exposes; neither surface is where a required-check failure directs attention |
| Parse `governance-check`'s stdout in `action.yml`'s bash to build the annotation | No JS change | Duplicates rendering logic the verb owns; reopens the local/CI drift the file's own comments guard against |
| **Chosen:** a third renderer in `governance-check.js`, gated on `GITHUB_ACTIONS` and `!json`, called from `cmdGovernanceCheck` | Reuses `verdict.reasons` verbatim, already correct and tested; keeps "verb owns rendering" intact; local and `--json` behaviour untouched by construction; testable by setting `GITHUB_ACTIONS` in the smoke test | New pattern: first `::error::` emission in the JS lib |

**How to keep PR-controlled annotation data safe.**

| Option | Pros | Cons |
|---|---|---|
| Splice reason strings raw | Simplest | Annotation-injection: a newline/`%`/`::` in a crafted anchor id mangles the line or opens a second workflow command (the recorded infosec finding) |
| Escape only GitHub's published data table (`%`/`\r`/`\n`) | Matches the toolkit's `escapeData` | Leaves the `::` delimiter unescaped — the exact same-line injection/mangle the infosec lens flagged; the published table by construction does not cover it |
| Strip offending characters out | No injection | Silently mangles legitimate reason text; lossy in the log |
| **Chosen:** percent-escape `%`→`%25`, `\r`→`%0D`, `\n`→`%0A` **and** neutralise the delimiter `::`→`%3A%3A` via `escapeWorkflowData`, applied to every spliced value | GitHub's own data-escaping *plus* explicit delimiter neutralisation; lossless (renders as `%0A`/`%3A%3A`); closes both the cross-line and same-line vectors; one helper, one call path | Requires escaping the fixed literal too (cheap) and one non-table escape (`::`) that must be documented as deliberate |

**Which stream the renderer writes to.**

| Option | Pros | Cons |
|---|---|---|
| Leave the stream unstated (previous spec) | — | The recorded QA finding: the smoke test asserted on captured stdout but nothing pinned the stream, so the test could pass/fail independent of correctness |
| **Chosen:** stdout via `console.log`, stated as the annotation-stream contract | Same stream as the existing text renderer, and the stream GitHub scans for workflow commands; the smoke test's stdout capture is now a valid assertion by contract | None material |

**Scope of the remediation hint.**

| Option | Pros | Cons |
|---|---|---|
| A hint for every leg | Maximally helpful | Fragile per-leg text lookup for legs the evidence never showed as opaque; the existing per-leg detail strings are already specific |
| No hint at all, just raw reasons | Simplest | Leaves the diagnosability gap: a `merge_floor` "review-verdict unavailable" reason doesn't say what to do |
| **Chosen:** a single trailing hint, emitted once, only when a `merge_floor` reason is present | Proportionate to the evidence (this ticket's failure was `merge_floor`); no per-leg table; other legs' detail text is already actionable | No remediation text for completeness/budget/liveness/integrity failures (acceptable — none showed as hard to diagnose) |

## 6. Open questions and assumptions

**Open Questions**

- **Punt:** should the same remediation text also be added to the PR bot's `faff merge-gate --check-only` landing comment, so the two surfaces say the identical thing? (decides: product). Low priority; both surfaces already state the blocker correctly today.

**Assumptions**

- **Assumes:** `GITHUB_ACTIONS=true` is set unconditionally by every GitHub Actions runner (hosted and self-hosted) for a job's duration, and is not a variable a caller's local shell would coincidentally export. Validation: documented default runner behaviour; **directly exercised by the smoke test, which toggles the variable and asserts both positions** (set → annotations present, unset → none) — so the renderer-gate is validated by observation, not merely assumed (see DoD "renderer-gate observed in both positions").
- **Assumes:** GitHub parses runner workflow commands from the step's **stdout** stream (the stream `console.log` writes). Validation: documented; the existing `renderGovernanceCheckText` already relies on stdout for its human output, so this is the same stream the verb already uses.
- **Assumes (shell pass-through — architectural fold):** the composite action's `Run governance-check` step invokes the verb with its **stdout flowing unredirected to the step's job log** — not captured into a shell variable, piped through a filter, or redirected — so a `::error::` line the verb writes reaches GitHub's runner as a workflow command and lands as a job annotation. **Validated against the current file:** `.github/actions/governance-check/action.yml`'s `Run governance-check` step runs `node "$BIN" governance-check "${ARGS[@]}" --summary-md "$GITHUB_STEP_SUMMARY"` followed by `CODE=$?` — stdout is neither captured (`$(...)`), piped, nor redirected; only the exit code is read. `--summary-md` writes the summary renderer to the `$GITHUB_STEP_SUMMARY` *file*, a separate stream, leaving stdout free for the annotation renderer. This file is FAFF-924's scope to *restructure* (the `Resolve faff binary` step-split); this spec does not edit it and depends only on the pass-through above, which FAFF-924's restructuring must preserve. If a future `action.yml` change ever captured or filtered the verb's stdout, the end-to-end annotation would silently stop landing even though the verb still emits it — the smoke test proves *emission* (in-process, stdout-capture), and this validated Assumes carries *delivery*.

## 7. Definition of Done

### From WHY
- [ ] The `governance-check` **verb emits** a job-level `::error::` annotation to stdout for a failing `merge_floor` leg (any non-`pass` `review-verdict`, or any other gating leg), naming the run/anchor id, issue, and exact cause — not only a step summary and a separate PR comment (proven by the smoke test's stdout capture). **End-to-end delivery** (the annotation *lands* on the job) holds under the validated §6 shell-pass-through Assumes on `action.yml` — the verb's stdout is streamed unredirected to the job log — which this spec does not re-implement (FAFF-924 owns that file) but names and validates.

### From WHAT
- [ ] `renderGovernanceCheckAnnotations(verdict)` exists in `plugin/skills/faff/bin/lib/governance-check.js`, writing to stdout via `console.log`, emitting one `::error::faff governance-check: <reason>` line per entry in `verdict.reasons`, in document order.
- [ ] Every value spliced into a `::error::` line passes through `escapeWorkflowData`, which percent-escapes `%`→`%25`, `\r`→`%0D`, `\n`→`%0A` **and** neutralises the delimiter `::`→`%3A%3A` (the `::` replacement runs after the `%`-escape so its introduced `%3A` is not double-escaped).
- [ ] Annotation emission fires only when `process.env.GITHUB_ACTIONS === "true"`, `!verdict.pass`, and the `--json` flag is not set.

### From HOW (behaviour)
- [ ] A single trailing remediation `::error::` line is emitted exactly once per invocation, regardless of how many runs or anchors have a failing `merge_floor` leg, pointing at `docs/guide/governance-check.md` and `/faff-graft`'s review step.
- [ ] `docs/guide/governance-check.md`'s "Failure modes worth knowing about" section names the hand-authored-anchor-without-review-verdict scenario and its fix.

### From HOW (edge cases)
- [ ] A local (`GITHUB_ACTIONS` unset) failing `faff governance-check` run prints zero `::error::`-prefixed lines.
- [ ] `faff governance-check ... --json` output is valid, single-object JSON with no interleaved annotation text, in CI or locally — **observed** by smoke step 9 (`--json` + `GITHUB_ACTIONS=true`: stdout `JSON.parse`s to a single object; zero `::error::` lines).
- [ ] The `GITHUB_ACTIONS` renderer gate is **observed in both positions** by the smoke test — set → the `::error::` lines appear; unset → none — so the CI-detection gate is validated by observation, not left as a bare assumption (architectural-minor fold).
- [ ] A golden fixture captures `renderGovernanceCheckText` and `renderGovernanceCheckSummaryMd` output for a representative failing verdict and asserts both are byte-identical to the committed golden. **Relationship to smoke step 8 (stated to avoid overlap):** the golden fixture is the *regression oracle against committed bytes* (catches drift across commits); smoke step 8 is a *same-run additive-only check* that emitting annotations in the current process did not perturb the text renderer's stdout (catches an in-process side effect the committed golden cannot see). Complementary, not redundant — the golden guards the persisted contract, step 8 guards the live no-side-effect property.

### Integration smoke test
```
PROCEDURE smoke_test:
  1. Build a tmp anchor dir for issue "FAFF-1" with ac-checklist.json complete and
     review-verdict.json { signal: "unavailable" } (mirrors PR #754's real shape).
  2. Set GITHUB_ACTIONS=true in the test process env.
  3. Run cmdGovernanceCheck(["--anchor-dir", tmpAnchorDir, "--issue", "FAFF-1"]),
     capturing stdout (the pinned annotation stream).
  4. Assert exit code 1.
  5. Assert captured stdout contains a line matching
     /^::error::faff governance-check: .*FAFF-1.*merge_floor.*review-verdict/.
  6. Assert captured stdout contains exactly one trailing line matching
     /^::error::faff governance-check: merge_floor failures need recorded evidence/.
  7. Feed a verdict whose reason data contains "\n", "%", and "::"; assert the
     captured stdout renders them as %0A, %25, and %3A%3A on a single ::error:: line
     (no bare newline; no second ::-delimited command; the only line-leading `::` is
     the intended `::error::` prefix).
  8. Re-run step 3 with GITHUB_ACTIONS unset; assert stdout contains no "::error::"
     lines and is byte-identical to renderGovernanceCheckText output (the same-run,
     no-side-effect check; the committed golden fixture is the separate cross-commit
     regression oracle — see the DoD golden-fixture item).
  9. Re-run step 3 with GITHUB_ACTIONS=true AND the --json flag set; assert exit code
     1, that captured stdout JSON.parses to exactly one object, and that it contains
     zero "::error::" lines — proving --json stays pure JSON and guarding against a
     build that hoisted the annotation call above/outside the `if (json)` branch.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Principle 4 (right-sized) — still clean after the fold.** The 2026-08-27 human re-slice split off the `Resolve faff binary` step (FAFF-924); this ticket is the renderer + sanitization + docs + golden fixtures. The 2026-09-01 review-objection fold (add `::` escaping, a shell-pass-through Assumes, a `--json`/CI smoke step, two DoD clarifications) hardens the *same* single unit against one JS file and one docs file — it adds no independent second concern and does not re-cross the FAFF-924 boundary. Still a single 1–2 day unit.

**Principle 7 (risk-aware) — the residual injection risk is now closed.** The prior spec's own architectural objection (the unverified skipped-`if:` platform assumption) lives entirely in FAFF-924. This ticket's assumptions (`GITHUB_ACTIONS` set in CI; workflow commands read from stdout; the action streams the verb's stdout unredirected) are standard/documented runner behaviour, and the third is now *validated against the live `action.yml`* rather than assumed — no scratch-branch run required. The infosec `::`-delimiter gap the last review flagged is folded (escape + `::`-bearing smoke assertion).

**Principle 6 (surfaced deps) — clean.** FAFF-924 is named as the sibling that owns `action.yml`'s step-split; the dependency is now explicit and one-directional (this spec *reads* the file's pass-through, does not edit it). The remaining out-of-scope items (binary-resolution hardening, PR-bot unification, the anchor-commit guard) are named extension points, not silent drops.

**Principle 1+5 (workstream fit) — unchanged.** The issue carries no project/workstream; under the project-less-Backlog default that is not a fault at prep time, but this diagnosability work on `governance-check` likely belongs alongside the other governance-check hardening tickets in whatever outcome-led home eventually tracks them.

**Recommended action.** None — the re-slice delivered the split, and the 2026-09-01 fold closed the standing review objections. Ship the renderer half.

confidence: high
build-tier: complex
