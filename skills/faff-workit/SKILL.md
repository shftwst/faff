---
name: faff-workit
description: "Start building an issue — checks the spec exists, sets up a worktree, commits the spec to the feature branch, and gets out of your way. Trigger for: 'workit ISSUE-XX' / 'start ISSUE-XX' / 'pick up ISSUE-XX' / 'let me build'."
---

# Faff — Workit

> **Prerequisite:** `/faff-prep ISSUE-XX` (spec must exist on the issue)

Set you up to build. Checks the spec exists, creates a worktree, commits the spec to the feature branch, and gets out of your way.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared CLAUDE.md `Project Tracking` / Planning Skills expectations, the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol. Workit consults the `plan`, `review`, and `ship` Planning Skill slots.

### Worktree Hook

Workit needs a `WorktreeCreate` hook to set up worktrees. On first use, check `.claude/settings.json` for a WorktreeCreate hook. If none exists:

1. Check if a project-specific wrapper exists at `scripts/setup-worktree.sh` — if so, register that
2. Otherwise, register the generic hook bundled with the faff skill:

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/skills/faff-workit/setup-worktree.sh\""
      }
    ]
  }
}
```

Tell the user what you're adding and why. If they have a project-specific setup script, suggest they create a wrapper at `scripts/setup-worktree.sh` that calls the generic one then adds their extras.

## Input

The user may provide an issue identifier, OR invoke with no arguments.

**When no arguments are provided:**
1. Check the current git branch name for a ticket pattern (e.g., `ISSUE-69-some-description` or `PROJ-123-feature`)
2. Extract the issue ID from the branch name
3. If found, use that as the issue identifier — no need to ask the user
4. If no ticket pattern found, ask the user for an issue identifier

## Process

**Step 0: Create step-by-step todos (mandatory — interactive and autonomous)**

Before starting any work, use `TodoWrite` to create one todo per numbered step below — one todo per step, in order. Mark each `in_progress` when starting it and `completed` the moment it finishes. This is the forcing function that stops review, AC verification, or any other late step from being dropped when the build phase becomes a habit loop.

Minimum todo set:

- Step 1: Get issue details
- Step 2: Check prep gate
- Step 3: Check for existing worktree
- Step 4: Commit spec to feature branch
- Step 5: Move to In Progress
- Step 6: Present spec and choose path (interactive) / proceed to build (autonomous)
- Step 7: Build
- Step 8: AC verification
- Step 9: Review phase
- Step 10: Merge-confidence gate
- Step 11: Post-PR checks (interactive) / auto-merge on green (autonomous)

Do not collapse these into one "implement the feature" todo. Every numbered step below, especially 8 / 9 / 10, must be a discrete todo that's visibly ticked off. Skipping a step without ticking its todo is a process failure.

**Step 1: Get Issue Details**

Query the issue tracker for the issue. If cancelled or archived per the shared rule, refuse and stop. Otherwise extract:
- Issue identifier
- Title
- Current status
- Suggested branch name (if the tracker provides one)

If the issue doesn't exist, tell the user and stop.

**Step 2: Check prep gate**

Check the issue for an attached spec. Follow the shared **Spec discovery** rule in `skills/faff/SKILL.md` — look in tracker comments, the main description/body, and committed `docs/` paths. A hit in any of those counts as the spec.

- **Spec exists:** Issue is prepped. Proceed to step 3.
- **No spec (none of the three sources):** In interactive mode, yes/no gate: "No spec found in comments, description, or docs. Run `/faff-prep ISSUE-XX` first? (y/n)". On confirm, invoke `/faff-prep` via the Skill tool. On deny, stop.

The gate ensures no one starts building without a validated spec.

**Step 3: Check for Existing Worktree**

Run `git worktree list` and check if a worktree for this issue already exists (match on the issue ID in the path).

If a worktree already exists:
- Verify the checked-out branch matches the expected branch name. Warn if not.
- Tell the user the worktree exists and open it.
- Skip to step 5 (status update). Spec was already committed on first workit.

If no worktree exists:
- Use the `EnterWorktree` tool with the branch name as the worktree name
- The `WorktreeCreate` hook (`setup-worktree.sh`) will automatically:
  - Create the git worktree
  - Copy gitignored config files (.env, etc.)
  - Run the project's setup command if one exists

**Step 4: Commit spec to feature branch**

Pull the spec content from the issue tracker and commit it to the feature branch. This is the first commit on the branch — the spec ships with the code it describes.

Location example:
- Spec → `docs/superpowers/specs/YYYY-MM-DD-<issue-id>-<slug>-design.md`

Derive `<slug>` from the issue title (lowercase, hyphens, no special chars). Use today's date for `YYYY-MM-DD`.

Commit message: `docs(<issue-id>): add spec for <issue title>`

This commit happens once. If the user re-runs workit on the same issue (existing worktree), skip this step.

**Step 5: Move to In Progress**

If the issue is not already In Progress, transition it.

**Step 6: Present spec and choose path**

Validate the spec's freshness against the current codebase. Then present a summary of the spec — design approach, key decisions, acceptance criteria — and offer a three-way choice (all branches invoke via the Skill tool on confirm):

- **build** — proceed to Step 7 (build loop)
- **review** — walk through the spec in detail before starting, then return here
- **reprep** — something changed; invoke `/faff-prep ISSUE-XX` in respec mode via the Skill tool

**Step 7: Build**

Implementer chooses execution strategy. If a `plan` slot is configured in CLAUDE.md Planning Skills, optionally invoke it first to produce a step-by-step plan. Otherwise, build directly from the spec.

During the build, if a decision arises that the spec doesn't resolve:
- **Interactive mode:** ask the user.
- **Autonomous mode:** see _Autonomous Mode_ below (invoke `/faff-prep` respec; if still ambiguous, park).

**Step 8: AC verification (mandatory)**

Before the PR is considered done, every acceptance criterion must be verified.

For each AC in the spec:
1. Identify or write an automated test covering it.
2. Run the test — it must pass.
3. If the AC requires live exercise (HTTP endpoint shape, CLI behaviour, filesystem side-effect, deployed service check), run the actual command (curl / bash / a real binary invocation) and capture the result.

The PR description must include an AC checklist:

```markdown
## Acceptance Criteria
- [x] AC 1 — <description>
      Verified: `test/foo.test.ts::test_ac1` — passing
- [x] AC 2 — <description>
      Verified: `curl -s https://api.example.com/foo | jq .status` → `"ok"`
- [ ] AC 3 — <description>
      **Needs human verification:** requires visual inspection of layout
- [ ] AC 4 — <description>
      **Needs human verification:** requires production auth credentials
```

Tick each box as its verification passes, with a one-line note (test file reference, or command + observed result). ACs that cannot be auto-verified (visual, subjective, auth-required) remain unchecked with an inline note explaining why.

This step runs in **both** interactive and autonomous modes.

**Step 9: Review phase (mandatory — interactive and autonomous)**

Runs after AC verification, before the merge-confidence gate. **This step is non-negotiable and runs in both interactive and autonomous modes.** Do not skip it on the assumption that the user will review manually, or because the build "felt clean", or because tests passed and the PR is already open. The review is the senior-engineer stand-in — it catches scope creep, spec misreadings, and human-judgement items that the test suite can't. In interactive mode it also produces the comment the user reads when deciding whether to merge; without it, the user has nothing to decide against.

If this step is reached without being in the todo list, **stop and add it**, then run it before proceeding to Step 10 or 11.

- If `review` slot is configured in CLAUDE.md Planning Skills, invoke it.
- Otherwise, perform the faff built-in review (faff-workit playing the senior-engineer role):
  - Read the full diff
  - Confirm every AC in the spec has a corresponding test reference
  - Scan for obvious bugs (unused vars, commented-out blocks, uncaught promises, mismatched async/sync, leftover debug prints)
  - Sanity-check the change is within spec scope (no out-of-scope refactors smuggled in)
  - Judge whether any decision in the diff requires human judgement that the spec didn't anticipate (product UX calls, security posture, irreversible external effects — see the Autonomous Mode Contract in `skills/faff/SKILL.md`)

The review must return one of three signals:

| Signal | Meaning | Autonomous action |
|---|---|---|
| `pass` | Diff matches spec, ACs covered, no flagged items. | Proceed to merge-confidence gate. Merge on green CI. |
| `fail` | Fixable issues — failing tests, missing coverage, obvious bugs, scope creep. | Iterate autonomously: fix the flagged items, re-run tests, re-run review. Loop until `pass` or `needs-human`. |
| `needs-human` | Genuine human judgement required — product call, security/privacy concern, irreversible side effect outside the PR flow, spec gap that respec couldn't close. | Flip PR to draft. Park per the shared park protocol. Do not auto-merge. |

`needs-human` is reserved for things the merge-confidence gate can't catch. If `git revert` on the merge commit fully undoes the change, it is not `needs-human` — it is `pass` or `fail`. See the gateway's Autonomous Mode Contract for the full rule on what escalates vs. what proceeds.

Append the review result to the PR as a comment. Record the signal, flagged items, and (for `needs-human`) the specific reason.

This step runs in **both** interactive and autonomous modes.

**Step 10: Merge-confidence gate**

Merge happens only when **all three** conditions hold:

1. Every AC has a passing automated verification (Step 8 — all boxes that can be auto-ticked, are)
2. CI is green
3. Review step (Step 9) returned `pass`

**Decision:**

- **All three hold:**
  - If `ship` slot configured → invoke it as the delivery mechanism.
  - Otherwise → vanilla `gh pr merge`.
- **Review returned `fail`:** iterate autonomously (fix flagged items, re-run tests, re-run review). This is not a park — it's a loop.
- **Review returned `needs-human`:** flip PR to draft, park per the shared protocol. Leave the PR open with the AC checklist, review comment, and CI status visible.
- **CI failed:** in autonomous mode, one iteration attempt (if the failure looks fixable from the logs); otherwise park. In interactive mode, ask per Step 11.

In **interactive mode**, this gate fires when the user confirms "merge now" at post-PR time (Step 11). In **autonomous mode**, it fires automatically at the end of the build flow.

**Step 11: Post-PR checks (interactive)**

**Prerequisite check:** before running this step, verify Steps 8 and 9 have both been ticked off in the todo list. If either is missing, run the missing step now — do **not** offer a merge gate on top of skipped verification or review. This is the last line of defence against the review-skipped failure mode: even if the build loop dropped Step 9, this check must catch it before any "merge now?" prompt fires.

After the PR is posted, wait for CI builds to complete **synchronously in the same turn**. Based on result and the gate in Step 10:

- **Gate passes (auto-mergeable):** yes/no "All three gate conditions pass (ACs verified, CI green, review `pass`). Merge now? (y/n)". On confirm, invoke the ship path. On deny, leave PR open.
- **Gate fails on CI:** "CI failed. Iterate on this PR? (y/n)". On confirm, keep going. On deny, yes/no "Pick next ticket via `/faff-wtf`? (y/n)".
- **Gate fails on review (`fail` or `needs-human`) or unverified AC:** surface the failing condition(s). Yes/no "Address and iterate? (y/n)". On confirm, iterate. On deny, leave for human.

All subsequent chain points are yes/no gates (never passive "run /faff-wtf").

### How to actually wait for CI

**Never say "I'll check CI once it reports" and end the turn.** Turns don't resume on their own — the user has to prompt you again, which defeats the point. Either you wait synchronously in-turn, or you tell the user CI is running and hand back control explicitly (without any promise to check later).

Correct patterns:

- **Block synchronously (preferred):** `gh pr checks <pr> --watch --interval 15` — blocks until all checks reach a terminal state, then exits with non-zero on failure. Wrap in `Bash` with a generous `timeout` (CI runs routinely take 5–15 minutes; allow 600000ms / 10 minutes at minimum, up to the Bash tool's max). If checks legitimately take longer than the tool max, poll in a loop: `gh pr checks <pr>` every 30–60s via `Bash`, until output shows no `pending` / `in_progress`.
- **Hand back cleanly:** "CI is running. I'm stopping here — re-invoke `/faff-workit` or say 'check CI' when you want me to poll." This is the only acceptable way to exit without a CI result. Do **not** pair this with "I'll check once it reports" — you won't.

Forbidden patterns:

- "Waiting on CI. I'll check once it reports." — you can't. The turn is over.
- "Checking CI in the background." — there is no background.
- Ending the turn without a CI terminal state AND without an explicit handoff.

If a CI wait is taking long enough that blocking the turn feels wasteful, **prefer the explicit handoff** over a fake promise. Surprising the user with silence is worse than telling them you're stopping.

**Step 12: Post workit checks**

After build is complete and PR has been raised, offer a yes/no gate:

> "Pick next ticket via `/faff-wtf`? (y/n)"

On confirm, invoke `/faff-wtf` via the Skill tool. On deny, stop cleanly.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop`), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

**Entry:** assumes issue exists, is not cancelled/archived, has a valid spec, and a dedicated worktree is already prepared (beep-boop handles worktree management per-issue to support parallel runs).

**Flow:**
1. Skip Step 6's build/review/reprep choice. Proceed directly to build (Step 7).
2. During Step 7, if a decision arises that the spec doesn't resolve, invoke `/faff-prep` in respec mode. If respec returns `parked` → park this issue (WIP commit + draft PR + tracker note + log) and return to caller.
   - Before invoking respec, apply the gateway's "spec-closed decisions stay closed" rule (see `skills/faff/SKILL.md` Autonomous Mode Contract) — parse for `Chosen:` / `Decision:` / `Punt:` markers, not topic keywords. Only invoke respec when the spec has a real punt, missing external dependency, or cost/irreversibility trigger.
3. After build, run Step 8 (AC verification) — mandatory.
4. Push the branch and open the PR as a **regular (non-draft) PR**. Regular PRs are the default in autonomous mode; the review step decides whether to keep it that way or flip to draft.
5. Run Step 9 (review phase). Act on the three-valued signal:
   - `pass` → proceed to Step 10 merge-confidence gate.
   - `fail` → iterate: fix flagged items, re-run tests, re-run review. Loop until `pass` or `needs-human` (cap at 3 iterations; if still `fail` after 3, treat as `needs-human`).
   - `needs-human` → flip PR to draft, park per the shared protocol. Return `pr-open-for-human`.
6. Run Step 10 (merge-confidence gate) automatically:
   - **All three conditions hold:** wait for CI to reach a terminal state (`gh pr checks --watch`), then invoke ship path on green (configured `ship` skill or `gh pr merge`). Return `shipped`.
   - **CI failed:** one fix attempt if the failure is obvious from the logs; otherwise flip to draft, park. Return `pr-open-for-human`.
7. Any unrecoverable error → park and return `errored`.

**Bash discipline during build.** Workit is where most `Bash` calls happen (tests, lints, build commands, `gh` calls, git operations) — and most of those touch *another* worktree's path, which is the single biggest source of regressions. Apply the gateway's **decompose, don't wrap** rule strictly (see `skills/faff/SKILL.md` → **Bash command hygiene**). The mechanical reminders, restated here so the rule is visible at point of use:

- **Rule 0:** never `grep`/`rg`/`find`/`ls`/`cat`/`head`/`tail`/`sed`/`awk`/`echo >` via `Bash`. Use `Grep`/`Glob`/`Read`/`Edit`/`Write`. They never trip approval.
- **Rule 0.5:** never `cd` via `Bash`, **especially never `cd <dir> && git ...`** — the sandbox flags this as a "bare-repository-attack" pattern by name. Use `git -C <dir> ...` for git, or pass absolute paths.
- **Rule 0.6:** never shell-parse a file. No `awk file`, `sed file`, `jq file`, `cat file | …`. Use `Read` (with `offset`/`limit`) or `Grep`.
- **No `&&`-chains, `;`-chains, `|`-pipelines, `$(...)`, backticks, `$((...))`, process substitution, heredoc-to-interpreter, or multi-step shell.** One atomic binary invocation per `Bash` call; chain via separate tool calls.

The canonical trap to watch for during build: `cd /path/to/other-worktree && git show HEAD:file | head -80` violates Rule 0, Rule 0.5, **and** the `&&`/pipeline ban in a single line. The fix is one atomic call: `git -C /path/to/other-worktree show HEAD:file` (no `head` — let Bash return the output, truncate in your own context). A single approval prompt here halts the whole beep-boop run; the cost of shell cleverness is always higher than the cost of an extra tool call.

**Park protocol:** shared — see `skills/faff/SKILL.md`. Summary: WIP commit, **flip PR to draft**, tracker comment with cause, `parked-by-faff` tag, `.faff/logs/…` entry. (Draft status is the signal that a human needs to look — non-draft PRs are fair game for auto-merge.)

**Return values to caller (beep-boop):**
- `shipped` — all three gate conditions held, PR merged (unblocks chained issues)
- `pr-open-for-human` — review returned `needs-human`, or CI failed unrecoverably — PR is draft, awaiting human
- `parked` — mid-build ambiguity that respec couldn't resolve, or missing prerequisites
- `errored` — unexpected failure (MCP outage, worktree dirty, etc.)

Log the full per-issue trace to `.faff/runs/<run-id>/ISSUE-XX/workit.md` (beep-boop provides the run-id directory; when invoked outside beep-boop, use `.faff/logs/YYYY-MM-DD/HHMMSS-workit-ISSUE-XX.md`).

## Notes
- Don't ask for confirmation before creating the worktree — the user said the issue ID, that's the intent.
- The prep gate is non-negotiable. Even quick fixes benefit from a lightweight prep pass.
- The spec is committed to the feature branch, not main. It only reaches main when the PR merges.
- Any detailed implementation plans produced during the work are the implementer's concern — may commit alongside code (e.g. `docs/superpowers/plans/`), or not. Faff-workit doesn't prescribe this.
- AC verification is not optional. A PR without a ticked-or-explained AC checklist is not complete.
