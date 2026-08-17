# Landing-command comment for build-complete PRs (FAFF-860)

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-860.

_Revised 2026-08-17 — narrowed to the landing-command comment (Half A) after spec review. The post-merge audit-heal (originally Half B) is split to its own ticket: committing a backfilled merge-record to the protected `main` branch needs a real design call on the durable record target, which is out of scope here. The four earlier Punts were resolved and folded into section 6._

This spec defines one GitHub Actions workflow that removes the friction of landing a build-complete faff PR: remembering that the sanctioned merge step is owed, and gathering the arguments to run it. When a PR goes green, the workflow re-reads the merge floor from the committed anchor and upserts one PR comment carrying the exact, copy-pasteable `faff merge-gate` command (or the blocking reasons). The human copy-pastes and runs it locally. The workflow never performs the merge itself.

## 1. WHY — problem and principles

**The load-bearing model.** The committed in-tree anchor at `.faff/anchors/<run>/<issue>/` is a self-contained, head-SHA-pinned copy of a graft run's merge floor (`ac-checklist.json`, `review-verdict.json`, at L4 `holdout.json`, plus `run-ledger.json`). Anything that can read that directory can re-derive the same merge-ok / refuse verdict `faff merge-gate` reaches, using the same code, without a live run context. This workflow is a thin CI wrapper that hands that anchor directory to the existing `faff merge-gate` verb (in `--check-only` mode) and renders its verdict as a comment. It adds no floor logic of its own.

**Problem statement.** A build-complete faff PR needs a sanctioned local `faff merge-gate … --execute` to land with a full audit trail, but the operator tends to forget it is owed, and reconstructing the command's arguments (run dir, issue, level) is friction. So the operator reaches for the GitHub UI merge button instead. This change makes CI post the ready-to-run command the moment a PR is landable, so the sanctioned path is a copy-paste rather than a recall-and-assemble.

**Design principles.**

**The workflow never merges.** It never invokes the merge verb, `gh pr merge`, or a raw git merge to the base branch, under any trigger, any input, any code path. It only writes a comment. This preserves FAFF-673: the sanctioned merge remains a human action at a real terminal, never something CI can route around. A reviewer must be able to grep the workflow file and its shell and find no merge invocation.

**Reuse the floor, never fork it.** The verdict comes from `faff merge-gate --check-only`, which re-reads the floor through `readAcComplete` / `readReviewVerdict` / `readHoldout` (merge-gate.js:485-503, 606-628). This spec adds no second floor evaluator. This mirrors `governance-check`, which re-reads the identical anchor floor through the identical readers and only reports.

**The anchor is the sole floor source.** The workflow reads the committed in-tree anchor, never the `refs/faff/bundles/…` replica ref. The bundle store is an explicit replica ("never a second lineage"); reading it here would create a second authority for the same fact.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (Node) | The floor readers, `decideFloor`, `fenceHumanFlags`, `resolveAnchorLevel`, `cmdMergeGate` (the `--check-only` path). Reused wholesale. |
| `.github/workflows/governance.yml` + `.github/actions/governance-check/action.yml` | YAML / Bash | Closest prior art: a `GITHUB_TOKEN`-only, `contents: read` workflow that re-reads the anchor floor server-side and reports. This workflow follows its shape (binary resolution, anchor discovery, `--issue` derivation from the head branch). |
| `plugin/skills/faff/bin/lib/governance-check.js` | JavaScript (Node) | Imports the same readers (line 38); `evaluateAnchorDir` (line 244) reads the floor from the anchor leaf via `evaluateMergeFloorLeg(dir, ".", level)` (line 285) — proves the anchor carries the floor files and the readers work against it. |
| `plugin/skills/faff/SKILL.md` (lines 515-527) | Markdown | The review-findings comment-identity idiom: a hidden HTML-comment marker pair for deterministic locate-then-upsert. The landing comment reuses this shape, keyed by PR number. |
| `plugin/skills/faff-graft/SKILL.md` (line 503) | Markdown | Graft Step 10: writes the `faff effects declare … --step merge` before merge-gate, and passes `--pr`/`--issue`/`--run-dir`/`--level` to the ship handoff. The emitted command mirrors this pairing. |
| `.github/workflows/job-surface-probe.yml`, `.github/workflows/deploy-docs.yml` | YAML | Precedents for `workflow` triggers and per-job `permissions`. No workflow in the repo invokes the merge verb (confirmed). |

**Scope statement.** This sits at the boundary between a green faff PR and its sanctioned local merge: it is the reminder-and-fill-in layer around `faff merge-gate`, not a new merge path.

## 2. Out of scope

- **Server-side merging.** Excluded — the human runs merge-gate locally at a real TTY (FAFF-673). Extension point: none intended; a future server-merge would be a separate, deliberately-argued design.
- **Post-merge audit-heal (the merge-record backfill for a UI-merged PR).** Split to its own ticket. Backfilling a `merge-record.json` when a PR was landed through the UI requires a durable record target, and `main` is a protected branch (governance-check is a required check), so a direct `GITHUB_TOKEN` commit-back is rejected; the right target (an off-branch ref, a one-file PR, or a reconcile-side reader) is a design call that deserves its own ticket. Extension point: the follow-up ticket.
- **Reading the bundle store (`refs/faff/bundles/…`).** Excluded — the in-tree anchor is authoritative; the bundle is a replica. Extension point: a bundle-fallback reader would live behind `resolveAnchorLevel`'s existing fallback ladder in merge-gate.js:309-350, not in this workflow.
- **A new App or PAT secret.** Excluded — `GITHUB_TOKEN` covers every read and the single comment write. Extension point: none.
- **Changing `decideFloor` or any reader.** Excluded — this feature is additive CI plumbing. Floor semantics stay in merge-gate.js / contract-defs.js.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Anchor run dir | `.faff/anchors/<run>` — the directory passed as `--run-dir` to merge-gate, so the readers resolve `<anchor-run-dir>/<issue>/*.json`. Committed, present at the PR head. |
| Anchor leaf | `.faff/anchors/<run>/<issue>/` — the per-issue floor snapshot inside the anchor run dir. |
| Graft PR | A PR whose diff carries an `.faff/anchors/<run>/<issue>/` leaf for the PR's own issue. Has a floor. |
| Non-graft PR | A PR whose diff carries no anchor leaf for its issue — the FAFF-673 non-graft signature (a spike, a docs capture, a one-line fix). Has no floor. |
| Landing comment | The single hidden-marker PR comment the workflow upserts. |

**The PR-to-anchor mapping (the one genuinely new piece of logic).** Nothing today maps a bare PR number to its anchor. The workflow derives it from the PR's changed files and head branch:

```
PROCEDURE resolve_anchor(pr):
  files, head_ref := gh pr view <pr> --json files,headRefName
  branch_issue := upcase(first `[A-Za-z]+-[0-9]+` match in head_ref)   # governance-check's derivation
  anchor_leaves := { (run, issue) for each path in files matching `^.faff/anchors/<run>/<issue>/` }
  IF anchor_leaves is empty: RETURN { kind: "non-graft", issue: branch_issue }
  # A PR is one branch = one issue. Select the leaf(s) whose <issue> == branch_issue.
  own_leaves := { (run, issue) in anchor_leaves WHERE issue == branch_issue }
  IF own_leaves is empty:
    FAIL LOUD  # the diff carries anchor(s) for other issues but not this PR's — do not guess
  IF the <run> across own_leaves is not identical: FAIL LOUD  # ambiguous run
  run := the single <run> of own_leaves
  level := run-ledger.json `.level` from the committed anchor (git show <head>:.faff/anchors/<run>/<branch_issue>/run-ledger.json)
  RETURN { kind: "graft", anchor_run_dir: ".faff/anchors/" + run, issue: branch_issue, level, head_sha }
```

The **head branch is the source of truth for the issue** (a faff PR is one branch, one issue); anchor leaves for any other issue riding in the same diff are ignored, and a diff that carries no leaf for this PR's own issue fails loud rather than guessing.

**Why the anchor run dir and not `.faff/runs/<run>`.** The floor readers read `<runDir>/<issue>/*.json` literally (merge-gate.js:485-490, 496-503, 606-613). The live `.faff/runs/` tree is gitignored, so it is absent on a plain CI checkout. Pointing `--run-dir` at the committed anchor run dir is what makes the readers find the floor. `resolveAnchorLevel` independently rebuilds `.faff/anchors/<basename(runDir)>/<issue>/run-ledger.json` (merge-gate.js:310), so `basename(".faff/anchors/<run>")` = `<run>` resolves the same committed ledger either way — the substitution is consistent.

**Landing comment shape.** A hidden marker pair keyed by PR number, mirroring the review-findings idiom (faff/SKILL.md:515-527):

```
<!-- faff-landing:<PR-NUMBER> -->
… rendered body …
<!-- /faff-landing:<PR-NUMBER> -->
```

Body for a **graft PR, floor merge-ok**:

```
Ready to land. Run this locally in a real terminal:

    faff effects declare --run <run> --issue <ISSUE> --step merge <<'EOF'
    [{"kind":"merge","target":"pr:<N>","reversible":true}]
    EOF
    faff merge-gate --pr <N> --issue <ISSUE> --run-dir .faff/anchors/<run> --level <L> \
      --execute --merge-args "--squash --delete-branch"
```

Body for a **graft PR, floor refuse**: the blocker lines from merge-gate's `--check-only --json` output, verbatim, and no run command.

Body for a **non-graft PR** (no anchor leaf for this issue — the FAFF-673 signature): the pre-filled human-override variant, no floor read attempted:

```
No graft floor on this PR (no anchor artifacts). If this is a legitimate non-graft
change, land it yourself in a real terminal:

    faff effects declare --run <run> --issue <ISSUE> --step merge <<'EOF'
    [{"kind":"merge","target":"pr:<N>","reversible":true}]
    EOF
    faff merge-gate --pr <N> --issue <ISSUE> \
      --human-override --interactive --override-reason "<what merged + why no floor applies>" \
      --merge-args "--squash --delete-branch"
```

`<ISSUE>` is derived from the head branch name, so it is filled in. There is no anchor and no run for a non-graft PR, so the command omits `--run-dir` entirely (section 6, "Non-graft command shape") — the human supplies only the `--override-reason`, which is theirs to write by definition.

**Interface consumed (existing, unchanged).**

```
faff merge-gate --pr N --issue ID --run-dir .faff/anchors/<run> [--level L] --check-only --json
  → stdout JSON { verdict: "merge-ok"|"refuse", blockers: [...], ci_state, head_sha, ... }
  → NEVER merges (cmdMergeGate returns at merge-gate.js:1141 before the spawn at :1156)
```

## 4. HOW — behaviour

**Summary.** When a PR's CI and governance checks finish, re-read the floor from the committed anchor and upsert one comment: the ready-to-run command if landable, the blockers if not.

**Trigger.** `workflow_run` on completion of the PR's `validate` (CI) and `governance-check` workflows. `workflow_run` is chosen over `pull_request` so the comment reflects a settled CI outcome, not an in-flight one, and so the workflow has base-repo `GITHUB_TOKEN` write scope. Fork PRs are out of scope — this feature targets same-repo agent PRs.

```
PROCEDURE landing_comment(workflow_run_event):
  1. IF event.conclusion != "success": exit 0        # only comment on a settled-green PR
  2. pr := the PR associated with event.workflow_run (payload pull_requests[0], else resolve by head sha)
     IF no PR: exit 0
  3. m := resolve_anchor(pr)                          # section 3
  4. IF m.kind == "non-graft":
       body := non_graft_override_body(pr, m.issue)
       upsert_landing_comment(pr, body); exit 0
  5. r := faff merge-gate --pr <pr> --issue <m.issue> --run-dir <m.anchor_run_dir> \
            --level <m.level> --check-only --json
  6. IF r.verdict == "merge-ok":
       body := ready_to_land_body(pr, m)              # declare + --execute command, pre-filled
     ELSE:
       body := blocked_body(r.blockers)               # reasons, no command
  7. upsert_landing_comment(pr, body)
```

**`upsert_landing_comment` (locate → create-or-update, per the comment-identity contract).**

```
PROCEDURE upsert_landing_comment(pr, body):
  wrapped := marker_open(pr) + "\n" + body + "\n" + marker_close(pr)
  comments := gh api repos/{repo}/issues/{pr}/comments (paginated)
  matches  := comments where body contains marker_open(pr)
  IF 0 matches: gh api … POST a new comment with wrapped
  IF 1 match:   gh api … PATCH that comment id with wrapped
  IF >1 match:  update the oldest, leave the rest (oldest-wins reconcile — never delete a human's comment)
```

**Anti-pattern:** posting a fresh comment each run. Why: it floods the PR. The marker pair keyed by PR number is the idempotency key — always locate first.

**Anti-pattern:** running `faff merge-gate` without `--check-only`. Why: `--execute` is the merge path. The workflow must pass `--check-only`, which returns the verdict before the spawn (merge-gate.js:1141).

### Auth and permissions

| | This workflow |
|---|---|
| Trigger | `workflow_run` (after CI + governance-check) |
| `contents` | `read` (anchor via checkout + `git show`) |
| `pull-requests` | `write` (upsert the comment) |
| Secret | `GITHUB_TOKEN` only |
| Runs the merge verb | never |

`GITHUB_TOKEN` is sufficient: the anchor is in-tree (contents read via `actions/checkout` with `fetch-depth: 0`, as governance.yml:38 already does); the comment is a standard issues-comment write; `gh pr view` / `gh repo view` (merge-gate.js:1057, 1061) are token-authenticated reads. It never writes to the repo beyond the one PR comment.

### Failure modes

- **The failure:** the workflow points `--run-dir` at `.faff/runs/<run>` (the gitignored live dir) instead of the anchor, so the readers fail-closed to `false`/`missing` and every green PR is reported as refuse. **How you'd know:** the landing comment shows `ac-checklist.json missing/incomplete` on a demonstrably reviewed, green PR. **What it means:** the run-dir substitution is wrong; the fix is to pass the anchor run dir. Guarded by the `resolve_anchor` contract and a DONE item.
- **The failure:** L4 holdout freshness. `readHoldout` requires `holdout.json` mtime to postdate the build checkpoint (merge-gate.js:509-510, 620), read from `build-progress.json`'s `updated_at` field. **What it means:** this is de-risked — graft Step 9b (faff-graft/SKILL.md:468) byte-copies `build-progress.json` into the anchor alongside `holdout.json`, and `governance-check` exercises the identical `readHoldout` against the anchor at the committed level (governance-check.js:141) and is green on L4 PRs today. On a fresh checkout, `holdout.json`'s checkout-time mtime postdates the stored `updated_at`, so the freshness check passes; the only refuse path is `build-progress.json` being absent, which governance-check already covers. Tracked in Assumptions.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a graft PR whose diff carries `.faff/anchors/<run>/<issue>/` for its own issue, and whose CI + governance-check finished green
When the workflow runs
Then it upserts one landing comment containing `faff merge-gate --pr <N> … --run-dir .faff/anchors/<run> … --execute`
  and the preceding `faff effects declare … --step merge`, with <N>, <run>, <issue>, <level> filled in from the PR
```

```
Given a graft PR whose anchor floor does not pass (e.g. review-verdict is not "pass")
When the workflow runs
Then the landing comment lists the merge-gate blocker lines and contains no `--execute` run command
```

```
Given the workflow has already posted a landing comment on a PR
When it runs again on the same PR
Then it updates the existing comment in place (located by `<!-- faff-landing:<N> -->`) rather than posting a second one
```

- The workflow file and its shell contain no invocation of the merge verb, `gh pr merge`, or a raw base-branch merge (the FAFF-673 invariant, greppable).
- The workflow requires only `contents: read` + `pull-requests: write`; it declares no App or PAT secret.

## 6. Design decision rationale

**How does the workflow read the floor — a bespoke reader, or the existing verb?** Options: (a) call the readers directly from a small script; (b) run `faff merge-gate --check-only`. (a) duplicates the assembly of `decideFloor`'s inputs (CI observation, integrity, level resolution) and drifts. (b) reuses the whole verdict, including CI observation and the anchor-level resolution, and `--check-only` provably never merges (returns at merge-gate.js:1141 before the spawn). **Chosen:** (b) `faff merge-gate --check-only --json`. Rationale: one floor authority, and the no-merge guarantee is in the verb, not in our restraint.

**Which directory is `--run-dir`?** Options: the live `.faff/runs/<run>` (graft's convention) or the committed `.faff/anchors/<run>`. The live dir is gitignored and absent on a CI checkout, so its readers fail-closed. **Chosen:** `.faff/anchors/<run>`, for both the CI floor read and the command emitted to the human. Rationale: it is committed and present in any checkout at the PR head; `resolveAnchorLevel` rebuilds the same anchor path from its basename either way (merge-gate.js:310). This diverges from graft Step 10's live-run-dir call deliberately: graft runs mid-build with the live dir present, whereas this workflow runs post-build from a plain checkout.

**How is the PR's issue resolved when the diff carries several anchor leaves?** Options: (a) take any anchor leaf's issue; (b) treat the head branch as the source of truth for the issue and select the matching leaf. A PR is one branch = one issue; an anchor leaf for another issue can ride in a diff (e.g. a run that touched a sibling). **Chosen:** (b) — derive the issue from the head branch, select only the leaf(s) matching it, fail loud if the diff carries no leaf for this PR's own issue or if the matching leaves disagree on `<run>`. Rationale: never emit a merge command computed against an unrelated run's floor; a mismatch is a hard stop, not a guess.

**Comment identity.** **Chosen:** a hidden HTML-comment marker pair keyed by PR number, per faff/SKILL.md:515-527, with oldest-wins reconcile. Rationale: the repo already has this idempotency idiom for review-findings; matching it keeps behaviour and human-edit safety consistent.

**Trigger.** **Chosen:** `workflow_run` after the CI and governance-check workflows complete. Rationale: the comment should reflect a settled CI outcome (`observeCi` in the `--check-only` call then reads a stable head-sha check set), and the PR association is available on the payload. On the overlap with `governance-check` (a required check that re-validates the same floor and reports pass/fail as a status): the landing comment instead hands the operator the pre-filled, copy-pasteable command — a different, complementary artifact, the friction fix a check status cannot be.

**Non-graft command shape.** Options: emit literal `<run>`/`<ISSUE>` placeholders, or derive what is derivable. `<ISSUE>` comes from the head branch name; there is no run or anchor for a non-graft change. **Chosen:** derive `<ISSUE>` from the branch and omit `--run-dir` from the non-graft override command, so the only field the human fills is the `--override-reason`.

## 7. Open questions and assumptions

**Open Questions.** None. (The post-merge audit-heal that raised the harder open questions is split to its own ticket — see Out of scope.)

**Assumptions.**

- **Assumes:** the committed anchor `.faff/anchors/<run>/<issue>/` carries `ac-checklist.json`, `review-verdict.json`, `run-ledger.json`, and at L4 the holdout inputs (`holdout.json` + `build-progress.json`), at the PR head. Validate: on a recent graft PR, `git show <head>:.faff/anchors/<run>/<issue>/ac-checklist.json`. governance-check reading these from the anchor (governance-check.js:141, 285) and passing on L4 PRs is corroborating evidence in code.
- **Assumes:** `workflow_run` fires with the PR association resolvable (payload `pull_requests[]`, or head-sha lookup) for same-repo PRs. Validate: inspect a `workflow_run` payload on a test PR.
- **Assumes:** `GITHUB_TOKEN` on `workflow_run` can write a PR comment with `pull-requests: write`. Validate: a test PR.
- **Assumes:** the operator has the repo checked out at the PR head when they run the emitted command, so `.faff/anchors/<run>` is present locally. Validate: stated in the comment body.

## 8. DONE — definition of done

### From WHY
- [ ] The workflow file and any shell it calls contain no invocation of the merge verb, `gh pr merge`, or a raw base-branch merge (grep-clean).
- [ ] The workflow reads the floor from `.faff/anchors/…`, never from `refs/faff/bundles/…`, and never from the gitignored `.faff/runs/…`.

### From WHAT (mapping and interfaces)
- [ ] `resolve_anchor(pr)` derives the issue from the head branch, selects the matching anchor leaf, returns the anchor run dir `.faff/anchors/<run>` + level (from the committed `run-ledger.json`) + head sha, returns `non-graft` when the diff carries no leaf for the PR's issue, and FAILS LOUD when the diff carries leaves for other issues but none for this one (or the matching leaves disagree on `<run>`).
- [ ] The workflow invokes `faff merge-gate … --run-dir .faff/anchors/<run> --check-only --json` and never with `--execute`.

### From HOW (behaviour)
- [ ] A green graft PR gets one landing comment whose command is `faff merge-gate --pr <N> --issue <ISSUE> --run-dir .faff/anchors/<run> --level <L> --execute --merge-args "--squash --delete-branch"`, preceded by the matching `faff effects declare … --step merge`, all fields filled from the PR.
- [ ] A graft PR whose floor refuses gets a comment listing merge-gate's blocker lines and no run command.
- [ ] A non-graft PR gets the `--human-override --interactive --override-reason` variant with `<ISSUE>` derived from the head branch and no `--run-dir`, and the workflow does not invoke merge-gate for it.
- [ ] The comment is upserted by its `<!-- faff-landing:<N> -->` marker (create on 0, update-in-place on 1, oldest-wins on >1) — a second run does not add a second comment.

### From HOW (auth)
- [ ] The workflow declares `contents: read` + `pull-requests: write` and references no App or PAT secret.

### From failure modes
- [ ] L4 PRs comment correctly (holdout freshness resolves against the anchor's `build-progress.json` + `holdout.json`).

**Integration smoke test.**

```
1. Open a graft PR on a scratch branch carrying `.faff/anchors/<run>/<issue>/` for its issue with a passing floor.
2. Let CI + governance-check finish green → the workflow fires.
3. Assert: exactly one comment with marker `<!-- faff-landing:<N> -->`, body contains
   `--run-dir .faff/anchors/<run>` and `--execute`, no command against `.faff/runs/`, no comment posted twice on re-run.
4. Push a change that makes the floor refuse (or use a non-graft PR); assert the comment updates to blockers /
   the override variant, and no `--execute` command is emitted for the refuse case.
```

confidence: high
