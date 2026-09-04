# FAFF-1001 — close the interactive-graft anchor-strand window

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1001.

This is the buildable spec for FAFF-1001, a bug: an interactive `/faff-graft` that opens a PR at Step 9b and then dies before committing the governance anchor strands an open, review-passed PR that `faff merge-gate` refuses with `anchor-missing`. The audience is the build agent that will implement the fix and the human reviewer gating this spec. The change is a reordering inside one skill step plus its regression tests. It is small on purpose.

## 1. WHY — problem and principles

**The load-bearing model.** `faff merge-gate` never trusts the live run-ledger for the merge decision. It trusts one thing: an immutable per-PR anchor committed to the branch and pinned to the PR head sha (`resolveAnchorLevel` in `plugin/skills/faff/bin/lib/merge-gate.js`, line 338). So the single invariant that keeps a review-passed PR mergeable is "a PR exists only if its head already carries the committed anchor". Step 9b breaks that invariant by opening the PR first and committing the anchor second. Close the gap by making the anchor commit and push happen before `gh pr create`, so the ordering itself guarantees the invariant.

**Problem statement.** Today Step 9b runs `gh pr create` (line 470 of `plugin/skills/faff-graft/SKILL.md`) strictly before it mints, commits, and pushes the anchor (line 493), so a crash in that window leaves an open PR whose head has no anchor, and `merge-gate` fails closed with `anchor-missing`. Recovery currently needs manual anchor surgery (a scratch worktree, `faff events anchor`, commit, push, then `faff merge-gate --execute`), as happened on 2026-09-04 with run `run-20260904-170809-graft-FAFF-913` and PR #856. This change reorders Step 9b so the anchor is on the branch head before the PR is ever opened, which removes the window entirely.

**Design principles.**

**The anchor stays an immutable pre-merge snapshot.** The committed anchor must remain an `outcomes:{}` snapshot taken before the merge. The Step 10 terminal ledger close (`run-ledger record-outcome`, line 725) writes the live ledger only and must keep landing after the anchor. Any implementation that folds the terminal outcome into the anchor commit is rejected, because it would fabricate a terminal outcome into a snapshot that must predate the merge.

**Never fabricate a passing floor.** The anchor may only byte-copy the review and AC artifacts that Steps 8 and 9 actually wrote. The fix must not synthesize `review-verdict.json` or `ac-checklist.json`, and must not run in any state where Step 9 did not return `pass`. Step 9b is already reached only after a review `pass`, so this principle is a guard on the reorder, not new behaviour.

**Touch only this run's own substrate.** The reorder acts on the current run's run-dir and the current feature branch. It must not read, resolve, or mutate any other run's ledger or any foreign session's PR.

**Reference context.**

| File | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` | skill prose | Step 9b (the reorder), Step 10 terminal close; kept byte-identical to the linked copy under `~/.claude/skills/faff-graft/SKILL.md` |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveAnchorLevel` (line 338), the fail-closed reader whose `anchor-missing` refusal this fix prevents |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `mintIssueAnchor` (line 1330), the byte-copy the anchor commits; unchanged by this fix |
| `plugin/skills/faff/bin/lib/run-ledger.js` | JavaScript | `buildInteractiveLedger` / `applyTerminalOutcome`; unchanged by this fix |
| `test/run-ledger-init-interactive.test.mjs` | JavaScript (node:test) | closest E2E harness; the new crash-timing test lands here |

**Scope statement.** The change sits at the PR-open boundary of graft's build loop, between review `pass` (Step 9) and the merge-confidence gate (Step 10), and applies to both interactive and autonomous grafts because both run the same Step 9b. A dispatched build lane stops at `pr-ready` (Step 10's dispatch-cut split) but still runs Step 9b to open the PR and anchor, so it inherits the reorder for free; no separate change is needed for the dispatched path.

## 2. OUT OF SCOPE

- **Interactive resume / landing re-entry (the FAFF-1001 "Direction 1" idea).** Excluded. Why: the structural reorder makes a review-passed PR carry its anchor before it exists, so `merge-gate` resolves `ok` and the operator finishes by running the gate or merging at the forge, with no anchor surgery. A full "re-invoke `/faff-graft <issue>`, detect the crashed run, re-anchor, close the ledger, re-enter the landing loop" path is a much larger surface for a pain the reorder already removes. Extension point: if the cheap-resume ergonomics are later wanted, add an interactive branch in Step 3 of `plugin/skills/faff-graft/SKILL.md` mirroring the autonomous resume-at-review check (line 186), detecting the newest `run-*-graft-<issue>` run-dir with `owner.status:"running"` and a matching open in-review PR, gated on `review-verdict.json` being `pass` and `ac-checklist.json` `all_verified`, and re-entering the endgame-only landing loop (line 517) without the `bundle_store`/landing-claim machinery beep-boop requires.

- **Re-invoking `/faff-graft <issue>` on an already-open PR.** Excluded. Why: interactive re-entry through Step 3's worktree-reuse path would re-run the build ladder and then fail at `gh pr create` because a PR already exists. That limitation predates this bug and is not what strands the anchor. Extension point: the same Step 3 interactive branch noted above would short-circuit re-entry once a PR is detected.

- **Any change to `mintIssueAnchor`, `resolveAnchorLevel`, or the merge floor.** Excluded. Why: the anchor artifact and its reader are already correct; the defect is purely the order in which graft prose calls them. Extension point: none needed.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| stranding window | the interval in Step 9b during which an open PR exists but its head carries no committed anchor |
| anchor | the immutable per-PR governance snapshot at `.faff/anchors/<basename(run_dir)>/<issue>/`, committed to the branch and read by `merge-gate` pinned to the PR head sha |
| anchor-before-PR order | the corrected Step 9b sequence in which the anchor is committed and pushed before `gh pr create` runs |

**No new types, records, or CLIs.** The fix introduces no schema, no flag, and no verb. `faff events anchor`, `faff run-ledger record-outcome`, and `resolveAnchorLevel` keep their current signatures and behaviour. The only edited artifact is the Step 9b prose of `plugin/skills/faff-graft/SKILL.md`, plus tests.

**The Step 9b sequence, before and after.**

```
BEFORE (stranding window between 2 and 4):
  1. compose + sanitize + check PR body -> safe.md
  2. gh pr create --body-file safe.md          # PR now open
  3. transition_to_in_review(issue)
  4. faff events anchor -> git add -> commit -> push   # anchor lands here
  5. faff bundle publish
  6. -> Step 10 (gate; then terminal record-outcome)

AFTER (no window; PR exists only once the anchor is on the pushed head):
  1. compose + sanitize + check PR body -> safe.md
  2. faff events anchor -> git add -> commit -> push   # anchor + branch head first
  3. faff bundle publish                                # anchor-derived; PR-agnostic
  4. gh pr create --body-file safe.md                  # opens at the anchor-carrying head
  5. transition_to_in_review(issue)
  6. -> Step 10 (gate; then terminal record-outcome, unchanged position)
```

## 4. HOW — behaviour

**Architecture and approach.** Move the existing anchor block (the `faff events anchor` call, the `git add`/commit, and the push) and the adjacent `faff bundle publish` call from after `gh pr create` to before it, keeping every command and its arguments byte-for-byte. The anchor is already PR-agnostic: it is keyed on `run_dir` and `issue` (`mintIssueAnchor`, line 1330 of `events.js`) and copies `events.jsonl`, `run-ledger.json`, and whichever merge-floor files exist (`ac-checklist.json`, `review-verdict.json`, and the L4 files). None of those inputs depend on the PR, and the PR body composed at the top of Step 9b does not depend on the anchor, so the two blocks commute and the reorder is behaviour-preserving apart from closing the window.

**Push configuration.** Two push configurations must both end with the anchor on the head before the PR opens.

```
PROCEDURE step_9b_anchor_first(issue, run_dir, safe_body):
  1. anchor = faff events anchor --run-dir run_dir --issue issue
             --dest .faff/anchors/<basename run_dir>/<issue>/
  2. git add .faff/anchors/... ; git commit          # the anchor commit
  3. git push                                          # push branch + anchor commit; NO PR yet
     # graft.push_at_build_complete ON: Step 8b already pushed the build commits,
     #   so this push carries only the incremental anchor commit.
     # graft.push_at_build_complete OFF: this is the branch's first push and carries
     #   the build commits AND the anchor commit together.
  4. faff bundle publish --run-dir run_dir --boundary-kind issue-merge-floor
             --boundary-key issue                      # anchor-derived, PR-agnostic
  5. gh pr create --body-file safe_body                # PR opens at the pushed anchor head
  6. transition_to_in_review(issue)
```

**CI fires once, on the anchor-carrying head.** Step 9b's current note that "CI fires here for the first time" relies on the property that a branch push with no PR does not trigger CI (the same property Step 8b's early push already depends on). Under the reorder the anchor push at step 3 above carries no PR, so it does not fire CI, and `gh pr create` at step 5 fires CI once, against the exact head `merge-gate` will pin the anchor to. This preserves the "CI fires once, on PR-open" property and improves it: the gated head and the CI head are now the same commit by construction.

**The terminal ledger close is unchanged and stays after the anchor.** Step 10's `run-ledger record-outcome` (line 725) still writes the live ledger only, after the committed anchor, so the anchor remains an `outcomes:{}` pre-merge snapshot. A crash after `gh pr create` but before Step 10 leaves `owner.status:"running"` on the live ledger, which is the designed owning-session backstop that surfaces a half-done build. That backstop marker is cosmetic to the merge decision, because `merge-gate` reads the anchor, not the live ledger.

**Idempotency of a re-run anchor.** The anchor dest is deterministic, so a second `faff events anchor` overwrites identically. The follow-on `git commit` must tolerate a "nothing to commit" result rather than failing the step, so that a benign re-run (for example a retried Step 9b) does not error on an unchanged tree. This tolerance must be **narrow**: it matches only the nothing-to-commit signal (an unchanged tree), never a blanket `|| true`. A genuine commit failure — a pre-commit hook rejection, a partial or failed `git add`, or any non-zero exit that is not the nothing-to-commit case — must still abort Step 9b **before** `gh pr create`, exactly like the anchor CLI error case below. A broad swallow that masks a real commit failure would let the PR open anchor-less and re-open the very strand this fix closes.

**Edge cases.**

- **Git-only mode.** Step 9b is already a no-op in git-only mode (no remote, no PR). The reorder does not change this; git-only proceeds straight to Step 10 as today.
- **Anchor CLI error (`no-events`, `dest-mkdir`).** These already stop Step 9b before the PR under the current order and continue to stop it before `gh pr create` under the new order, which is the safer failure: no PR is opened when the anchor cannot be minted.
- **PR-body sanitizer failure.** The body checks (`pr-body sanitize` / `pr-body check`) run before both the anchor and the PR and still stop the step on a non-zero exit, unchanged.

**Failure modes.**

- **The reorder is silently reverted by a later edit.** The failure: a future change to Step 9b puts `gh pr create` back ahead of the anchor commit, reopening the window without any test noticing. How you'd know: a review-passed PR comes back from `merge-gate` as `anchor-missing` in the field, or the crash-timing test below fails. What it means: re-assert the ordering; the regression test is the guard that keeps this from shipping.
- **A repo whose CI fires on a no-PR branch push.** The failure: if a repo's CI triggers on plain branch pushes, the anchor push at step 3 fires CI before the PR exists. How you'd know: a CI run appears against the branch head with no associated PR. What it means: proceed, not abandon. The head that CI runs against is still the anchor-carrying head, so the gated commit is correct; the only cost is an earlier or extra CI run, which is not a correctness problem.

**Anti-pattern:** folding `run-ledger record-outcome` into the anchor commit to "make it all atomic". Why: the anchor must be an `outcomes:{}` snapshot taken before the merge, and the terminal outcome is only known at Step 10; committing an outcome into the anchor fabricates a terminal state into a pre-merge snapshot, which `test/run-ledger-init-interactive.test.mjs` line 180 exists to forbid.

**Anti-pattern:** adding an interactive resume path in this ticket. Why: it is out of scope (section 2), and bundling it would enlarge a small structural fix into a landing-loop re-entry design.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The main objective is that a crash right after the PR opens no longer strands the anchor.

```
Given an interactive L2 run-dir minted for the issue, with review-verdict.json = pass and ac-checklist.json all_verified
When Step 9b commits and pushes the anchor and then opens the PR, and the session dies immediately after gh pr create (before Step 10's terminal ledger close)
Then resolveAnchorLevel against the PR head sha returns { level: "L2", status: "ok" } even though the live ledger is still owner.status:"running" with outcomes:{}
```

- The Step 9b sequence commits and pushes the anchor before any `gh pr create` invocation, in both `graft.push_at_build_complete` on and off configurations.

## 6. Design decision rationale

**Which approach closes the strand: interactive resume, anchor-before-PR, or both?**
- Interactive resume path: recovers an already-stranded PR by re-invoking graft. Con: large surface (Step 3 detection, run-dir matching, floor gating, landing re-entry) for a pain the structural fix removes; only helps a PR already stranded under the old order, and the historical incident is already recovered.
- Anchor-before-PR reorder: makes the strand impossible for every future run with a byte-preserving reorder of one step. Con: does not retroactively fix a PR already stranded, but such a PR now needs only a normal `merge-gate` run or a forge merge, not surgery.
- Both: the reorder plus the resume path. Con: the resume path adds no coverage the reorder leaves open for future runs.

**Chosen:** anchor-before-PR reorder. It is the smallest change that closes the window, and it removes the incident's manual-surgery recovery.

**Exactly where does the anchor go, and does the ledger close move with it?**
- Options: (i) anchor commit and push strictly before `gh pr create`, terminal `record-outcome` unchanged at Step 10; (ii) also fold `record-outcome` into the anchor commit for "atomicity".
- Option (ii) is rejected: it fabricates a terminal outcome into a snapshot that must predate the merge, breaking the immutable-pre-merge-snapshot invariant that `test/run-ledger-init-interactive.test.mjs` line 180 guards.

**Chosen:** anchor commit and push strictly before `gh pr create`; the terminal `record-outcome` stays at Step 10, after the anchor.

**How does the fix stay safe (idempotent, no fabricated floor, own-run-only)?**
- The anchor byte-copies only the review and AC artifacts Steps 8 and 9 already wrote, and Step 9b runs only after review `pass`, so no passing floor is ever synthesized. The reorder reads and writes only this run's run-dir and the current branch, never a foreign run or session. A re-run anchor overwrites a deterministic dest and its commit tolerates "nothing to commit".

**Chosen:** rely on the existing anchor's real-artifact byte-copy, scope the reorder to the current run and branch, and make the anchor commit tolerant of an unchanged tree.

**Is any interactive re-entry / resume shipped in this ticket?**
- Options: ship a minimal interactive resume now, or defer it.
- Deferring keeps the fix small and is sufficient because the reorder means a crashed run's PR already carries its anchor and merges through the normal gate.

**Chosen:** defer the interactive resume path to a future ticket, with the extension point recorded in section 2. At the time of writing, interactive graft has no resume path and none is added here.

## 7. Open questions and assumptions

**Open questions.** None.

**Assumptions.** None beyond the confirmed codebase state. The Step 9b `git add`/commit/push plumbing, the anchor CLI, and the merge-gate reader are all present and unchanged; the build agent should confirm the current Step 9b order in `plugin/skills/faff-graft/SKILL.md` (PR create ahead of the anchor commit) before reordering, and keep the file byte-identical to its linked copy under `~/.claude/skills/faff-graft/SKILL.md`.

## 8. DONE — definition of done

### From WHY
- [ ] No stranding window remains: in Step 9b of `plugin/skills/faff-graft/SKILL.md`, the anchor `faff events anchor` call plus its `git` commit and push appear strictly before any `gh pr create` invocation.

### From WHAT (sequence)
- [ ] The `faff bundle publish` call moves with the anchor block to before `gh pr create`, keeping its existing arguments.
- [ ] `transition_to_in_review` remains after `gh pr create`.
- [ ] No new CLI, flag, or schema is introduced; `faff events anchor`, `resolveAnchorLevel`, and `run-ledger record-outcome` are unchanged.

### From HOW (behaviour)
- [ ] Both `graft.push_at_build_complete` on and off end with the anchor commit on the pushed head before the PR opens.
- [ ] The Step 10 terminal `run-ledger record-outcome` stays after the anchor; the committed anchor's `run-ledger.json` still reads `outcomes:{}`.
- [ ] A re-run of the Step 9b anchor commit on an unchanged tree does not fail the step ("nothing to commit" tolerated).
- [ ] Git-only mode behaviour is unchanged (Step 9b remains a no-op there).

### From Scenarios (tests)

**Division of labour — the two guards test different things, and both are required.** The crash-timing E2E below exercises `resolveAnchorLevel`'s committed-anchor read, which is behaviour this ticket does **not** change (merge-gate.js / events.js are out of scope, section 2). That E2E therefore passes identically whether or not Step 9b actually commits the anchor before `gh pr create` — it validates the **relied-on invariant** ("a committed anchor at the PR head resolves `ok`"), not the reorder. The reorder itself — the one thing this ticket changes — is guarded only by the mechanical order lint. Shipping the E2E without the lint would leave the named failure mode ("reorder silently reverted by a later edit") undefended.

- [ ] A new crash-timing E2E test in `test/run-ledger-init-interactive.test.mjs` (or a new sibling `test/graft-anchor-before-pr.test.mjs`): mint an interactive L2 run, seed the `pass` floor, mint and commit the anchor, capture that commit sha as the PR head, run no terminal `record-outcome`, and assert `resolveAnchorLevel(repo, null, runDir, ISSUE, headSha)` returns `{ level: "L2", status: "ok" }` while the live ledger is still `owner.status:"running"` with `outcomes:{}`. (Validates the relied-on invariant, not the reorder.)
- [ ] A test asserting the committed anchor's `run-ledger.json` is an `outcomes:{}` snapshot at the moment the PR head is captured (the holdout scenario), reusing the immutability assertions already present at `test/run-ledger-init-interactive.test.mjs` line 180.
- [ ] A **mechanical order lint** — not a review-only check — asserting that in Step 9b of `plugin/skills/faff-graft/SKILL.md` the `faff events anchor` commit appears at a byte offset strictly before any `gh pr create` invocation. Model it on the existing `faff validate-adapters` anchor-phrase lints (see `plugin/skills/faff-graft/SKILL.md` line ~321) and wire it into the same CI gate, so a future edit that reintroduces `gh pr create` ahead of the anchor fails CI rather than passing on the unchanged E2E. This lint is the reorder's only change-specific regression guard.
- [ ] A test that a **genuine** anchor-commit failure (a non-zero `git commit` exit that is *not* the nothing-to-commit case — for example a pre-commit hook rejection) aborts Step 9b before `gh pr create`, so a masked commit failure can never open an anchor-less PR. (Guards the narrow-tolerance requirement from HOW.)

### Manual / integration
- [ ] Run a real interactive `/faff-graft` on a scratch issue to review `pass`, kill the session immediately after `gh pr create` returns, then run `faff merge-gate` against the open PR and confirm it resolves `ok` (no `anchor-missing`) with no manual anchor surgery.
- [ ] Confirm CI fires once, on the anchor-carrying PR head, in a `graft.push_at_build_complete: off` repo.

**Integration smoke test.**

```
PROCEDURE smoke_anchor_before_pr:
  1. Mint an interactive L2 run for a scratch issue; build to review pass.
  2. At Step 9b, mint + commit + push the anchor; record HEAD as head_sha.
  3. Open the PR (gh pr create) at head_sha; do NOT run Step 10 record-outcome.
  4. Assert resolveAnchorLevel(repo, null, run_dir, issue, head_sha) == { level:"L2", status:"ok" }.
  5. Assert the committed anchor run-ledger.json has outcomes == {}.
  # If step 4 passes with the ledger still "running", the PR is mergeable without surgery — plumbing connected.
```

confidence: high
build-tier: standard

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
