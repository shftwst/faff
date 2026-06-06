---
name: faff-graft
description: "Start building an issue — checks the spec exists, sets up a worktree, commits the spec to the feature branch, and gets out of your way. Trigger for: 'graft ISSUE-XX' / 'start ISSUE-XX' / 'pick up ISSUE-XX' / 'let me build'."
---

# Faff — Graft

> **Prerequisite:** `/faff-prep ISSUE-XX` (spec must exist on the issue)

Set you up to build. Checks the spec exists, creates a worktree, commits the spec to the feature branch, and gets out of your way.

## Configuration

**Load the gateway first.** This skill is usually entered directly (slash command or delegated slot), so the gateway is **not** automatically in context. If the sibling `faff/SKILL.md` isn't already loaded this turn, **Read it now** — it holds the fixed contracts and shared rules this skill applies: the shared `.faffrc` configuration (`tracking` / `slots`), the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, the park protocol, and the **fixed review-verdict, spec-readiness, and delivery-outcome contracts** graft branches on. Loading it here means any slot graft delegates to inherits these ambiently. Graft consults the `review`/`review_adaptor` and `ship`/`ship_adaptor` slots.

### Worktree Hook

Graft owns the worktree *mechanism*; the *policy* (location `~/.faff/worktrees/<repo>/<branch>` by default, overridable via `.faffrc` `worktree_root`; branch-off-HEAD naming, config-copy, install-skip, per-issue isolation, cleanup-is-housekeeping) is single-sourced in the gateway → **Worktree policy**. This section just registers the hook that enacts it.

Graft needs a `WorktreeCreate` hook to set up worktrees. On first use, check `.claude/settings.json` for a WorktreeCreate hook. If none exists:

1. Check if a project-specific wrapper exists at `scripts/setup-worktree.sh` — if so, register that
2. Otherwise, register the generic hook bundled with the faff skill:

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/skills/faff-graft/setup-worktree.sh\""
      }
    ]
  }
}
```

Tell the user what you're adding and why. If they have a project-specific setup script, suggest they create a wrapper at `scripts/setup-worktree.sh` that calls the generic one then adds their extras.

## Rendering

All human-facing output this skill emits — PR bodies, human-facing summaries, and park **comments**, plus any terminal summaries — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). In particular, enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule), so descriptions and comments are as skimmable as terminal output. Carve-outs (skill source files, `.faff/` logs) are exempt.

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

Check the issue for an attached spec. Follow the shared **Spec discovery** rule in the sibling `faff/SKILL.md` — look in tracker comments, the main description/body, committed `docs/` paths, and (git-only mode) the `.faff/specs/<issue-id>.md` store. A hit in any of those counts as the spec.

- **Spec exists:** Issue is prepped. Proceed to step 3. Per the shared Spec discovery rule, a hit in the description/body only counts when it is an actual formalised spec — a plain description, however well-defined, is **not** a spec.
- **No spec (none of those sources):** In interactive mode, yes/no gate: "No spec found in comments, description, docs, or the git-only store. Run `/faff-prep ISSUE-XX` first? (y/n)". On confirm, invoke `/faff-prep` via the Skill tool. On deny, stop.

The gate ensures no one starts building without a validated spec. Per the shared **Spec discovery** rule, **a description is never a spec**: if the only thing resembling a spec is the ticket description, treat it as "no spec" and route to `/faff-prep`. Never build straight from a description, and never skip prep because it "reads clear".

**Automation hold (interactive).** If the issue carries the `faff-automation-hold` label (gateway → **Automation hold**), warn — "this ticket is held from automation; proceeding interactively, and the hold stays until you remove it" — then continue. Interactive graft is never blocked by the hold, and graft never removes the hold label. (Autonomous graft instead refuses a held issue — see Autonomous Mode.)

**Step 3: Check for Existing Worktree**

(Worktree layout and rules: gateway → **Worktree policy**. Worktrees live at `~/.faff/worktrees/<repo>/<branch>` by default, overridable via `.faffrc` `worktree_root`.)

Run `git worktree list` and check if a worktree for this issue already exists (match on the issue ID in the path).

If a worktree already exists:
- Verify the checked-out branch matches the expected branch name. Warn if not.
- Tell the user the worktree exists and open it.
- Skip to step 5 (status update). Spec was already committed on first graft.

If no worktree exists:
- Use the `EnterWorktree` tool with the branch name as the worktree name
- The `WorktreeCreate` hook (`setup-worktree.sh`) will automatically:
  - Create the git worktree
  - Copy gitignored config files (.env, etc.)
  - Run the project's setup command if one exists

**Step 4: Commit spec to feature branch**

Pull the spec content from wherever Step 2's **Spec discovery** found it — a tracker comment, the committed docs path, or (git-only mode, no tracker MCP) the `.faff/specs/<issue-id>.md` store faff-prep wrote — and commit it to the feature branch. This is the first commit on the branch — the spec ships with the code it describes. (In git-only mode the `.faff/specs/` file is the source; committing it here is what moves the spec into the repo, so the "ships with the PR" property holds with or without a tracker. Note `.faff/specs/` lives in the **main checkout**, not this worktree — so capture the spec content back at Step 2, before the worktree exists, and write that captured content here rather than re-reading the file from inside the worktree.)

Resolve and create the target directory mechanically with the bundled resolver (see the gateway's **Spec docs location**):

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
dir=$("$faff" config spec-docs-path --create)
```

This reads `tracking.spec_docs_path` from `.faffrc` and, when unset, applies the default rule (`docs/specs` if `docs/` exists, else `doc/specs` if `doc/` exists, else creates `docs/` and uses `docs/specs`). Commit the spec to:

- `$dir/YYYY-MM-DD-<issue-id>-<slug>-design.md`

Derive `<slug>` from the issue title (lowercase, hyphens, no special chars). Use today's date for `YYYY-MM-DD`.

Commit message: `docs(<issue-id>): add spec for <issue title>`

This commit happens once. If the user re-runs graft on the same issue (existing worktree), skip this step.

**Step 5: Move to In Progress**

If the issue is not already In Progress, transition it.

**Step 6: Present spec and choose path**

Validate the spec's freshness against the current codebase. Then present a summary of the spec — design approach, key decisions, acceptance criteria — and offer a three-way choice (all branches invoke via the Skill tool on confirm):

- **build** — proceed to Step 7 (build loop)
- **review** — walk through the spec in detail before starting, then return here
- **reprep** — something changed; invoke `/faff-prep ISSUE-XX` in respec mode via the Skill tool

**Step 7: Build**

Implementer chooses execution strategy. Build directly from the spec.

During the build, if a decision arises that the spec doesn't resolve:
- **Interactive mode:** ask the user.
- **Autonomous mode:** see _Autonomous Mode_ below (invoke `/faff-prep` respec; if still ambiguous, park).

If the build reveals concrete, separable work this PR shouldn't absorb (an unforeseen seam, an untracked dependency), **record it** as discovered scope (see Step 9 → _Discovered scope_) and carry on — don't expand this PR to cover it, and don't park for it.

**Step 8: AC verification (mandatory)**

Before the PR is considered done, every acceptance criterion must be verified.

**Find the project's test command first — don't guess the runner.** Resolve it once from what the repo actually uses, in this order: the consuming project's `CLAUDE.md` (if it documents a test / lint command), then `package.json` scripts (`test`, `lint`), a `Makefile` target, `pyproject.toml` / `pytest.ini` / `tox.ini`, `Cargo.toml`, `go.mod`, or the CI config (`.github/workflows/*` — whatever it invokes is the source of truth). Record the exact command(s) in the log and PR so the verification is reproducible. If no runner can be found at all, that's a `needs-human` signal for Step 9 — not a silent skip or an assumed `npm test`.

For each AC in the spec:
1. Identify or write an automated test covering it.
2. Run the test with the resolved command — it must pass.
3. If the AC requires live exercise (HTTP endpoint shape, CLI behaviour, filesystem side-effect, deployed service check), run the actual command (curl / bash / a real binary invocation) and capture the result.

After the per-AC tests pass, run the **full suite + lint once** with the resolved command before opening the PR. A green per-AC test doesn't prove you didn't break something elsewhere; the full run is the local backstop before CI.

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

Runs after AC verification, before the merge-confidence gate. **This step is non-negotiable and runs in both interactive and autonomous modes.** Do not skip it on the assumption that the user will review manually, or because the build "felt clean", or because tests passed and the PR is already open. The review is the senior-engineer stand-in — it catches scope creep, spec misreadings, and human-judgement items that the test suite can't. In interactive mode it also produces the comment the user reads when deciding whether to merge; without it, the user has nothing to decide against. (Step 0 forces this into the todo list; Step 10's gate makes merge impossible without a `pass`, and Step 11 verifies it before any merge prompt — so a skipped review can't reach `main`.)

Invoke the `review` slot, passing the diff (`git diff main...HEAD`), the spec, the test results, and the Step 8 AC checklist. The slot's default is `faffter-noon-review`; the review's passes and how it arrives at a verdict are that skill's concern, not faff-graft's. faff-graft owns only the sequencing around the result.

The review returns one of three signals. The verdict vocabulary, their semantics, and the revert test below are the **fixed review-verdict contract** in the gateway; the `review_adaptor` slot (default `faffidavit-review`) owns the envelope they arrive in. faff-graft branches on the verdict; it does not redefine it. If a delegated reviewer returns something off-envelope, normalise via `review_adaptor` first (a malformed verdict coerces to `needs-human`, never `pass`):

| Signal | Meaning | Autonomous action |
|---|---|---|
| `pass` | Diff matches spec, ACs covered, no flagged items. | Proceed to merge-confidence gate. Merge on green CI. |
| `fail` | Fixable issues — failing tests, missing coverage, obvious bugs, scope creep. | Iterate autonomously: fix the flagged items, re-run tests, re-run review. Loop until `pass` or `needs-human`. |
| `needs-human` | Genuine human judgement required — product call, security/privacy concern, irreversible side effect outside the PR flow, spec gap that respec couldn't close. | Flip PR to draft. Park per the shared park protocol. Do not auto-merge. |

`needs-human` is reserved for things the merge-confidence gate can't catch. The revert test (if `git revert` on the merge commit fully undoes the change, it is not `needs-human` — it is `pass` or `fail`) is part of the fixed review-verdict contract in the gateway. See the gateway's Autonomous Mode Contract for the full rule on what escalates vs. what proceeds.

Append the review result to the PR as a comment. Record the signal, flagged items, and (for `needs-human`) the specific reason.

If the review names concrete, separable **out-of-scope** work — not a fixable defect in this diff — record it as discovered scope (see below) rather than looping on it. `fail` is for fixable items; out-of-this-PR follow-ups are discovered scope, not a review failure.

This step runs in **both** interactive and autonomous modes.

### Discovered scope (record, never file)

While building and reviewing, graft often surfaces **concrete, separable work this PR should not absorb** — a seam the spec didn't foresee, an untracked dependency an AC exposed, a real out-of-scope concern the review flagged. The implementor lane **cannot create backlog tickets** (gateway → **Agent Lanes**); it **records** these so the orchestrator files them (autonomous: `/faff-beep-boop` after the build pass; interactive: via the gate in Step 12). This is bottom-up source (b) — see `design/planning-loop.md`.

**What qualifies** — concrete, nameable, separable from this PR: a follow-up the build revealed is also needed, a prerequisite the spec assumed but no ticket tracks, a review finding that names real out-of-this-PR work. **What does not:** fixable-in-PR items (those loop via review `fail`), unverifiable ACs (human-verify flags, not new work), and vague impressions ("logging's inconsistent") — record those as `confidence: vague`, which only ever surface, never auto-file.

**Capture** — append to `.faff/runs/<run-id>/ISSUE-XX/discovered-scope.json` (outside beep-boop: `.faff/logs/YYYY-MM-DD/HHMMSS-graft-ISSUE-XX-discovered-scope.json`) during **Step 7 (build)** and **Step 9 (review)**. One array entry per item:

```json
{ "title": "...", "description": "...", "relationship": "blocker|blocked-by|peer|none",
  "source": "build|review", "source_ref": "spec line / review finding", "confidence": "concrete|vague" }
```

`relationship` is to the issue being built (`blocker` = the discovered work must land first; `blocked-by` = it follows this PR; `peer` = parallel in the same workstream; `none` = independent). Recording is cheap and side-effect-free — it never blocks, loops, or parks the current build.

**Step 10: Merge-confidence gate**

Merge happens only when **all** conditions hold:

1. Every AC has a passing automated verification (Step 8 — all boxes that can be auto-ticked, are)
2. CI is green
3. Review step (Step 9) returned `pass`

**Decision:**

- **All three hold (integrity floor passed):** these three conditions *are* the integrity floor — assert them here; this floor is **non-delegable** and is never re-run or weakened inside the `ship` producer or its adaptor. Then hand off to the `ship` producer (configured occupant, or the default `faffter-noon-ship`, which runs `gh pr merge`); map its native result through `ship_adaptor` (default `faffidavit-ship`) to the fixed delivery outcome, and **route on that** (a result the adaptor can't map coerces to `failed`, never `shipped` — gateway → _Delivery outcome_):
  - `shipped` → merged/deployed. The worktree becomes eligible for cleanup (housekeeping, per gateway → **Worktree policy**) — the `ship` producer never touches it. Chained issues unblock. Done.
  - `not-ready:<reason>` → the producer's deploy-readiness tier deferred the merge (only a deploy-capable producer yields this; the default never does). Leave the PR open and mergeable, record the reason, and park as **retry-later** — not a defect, not `needs-human`.
  - `failed:<reason>` → merge conflict or deploy error (or an unmappable result coerced to `failed`). Treat as a post-build failure: autonomous → one fix attempt if obvious from the error, else park; interactive → surface and ask per Step 11.
  - **Under concurrent execution** (the `faffter-dark-concurrency-parallel` executor): merges are serialised and rebase-revalidated — before handing to the `ship` producer, rebase (or merge `main`) onto the PR branch and **re-confirm CI green on the rebased head**. A green that predates `main` moving is stale and must not merge. See that skill's _Rebase-before-merge_. (Sequential execution needs no rebase — each build already sees the prior merge.)
- **Review returned `fail`:** iterate autonomously (fix flagged items, re-run tests, re-run review). This is not a park — it's a loop.
- **Review returned `needs-human`:** flip PR to draft, park per the shared protocol. Leave the PR open with the AC checklist, review comment, and CI status visible.
- **CI failed:** first separate a flaky/infra failure from a real defect — **re-run the failed checks once** with no code change (re-trigger, then `gh pr checks <pr> --watch`). If they pass on the clean re-run, it was transient: proceed to the merge gate and **do not** spend the autonomous fix attempt on it. If they fail the same way again, it's real: in autonomous mode, one iteration attempt (if the failure looks fixable from the logs); otherwise park. In interactive mode, ask per Step 11. (Persistent infra failures unrelated to the diff — runner outages, missing secrets — park as `errored`, not as a code defect.)

In **interactive mode**, this gate fires when the user confirms "merge now" at post-PR time (Step 11). In **autonomous mode**, it fires automatically at the end of the build flow.

**Step 11: Post-PR checks (interactive)**

**Prerequisite check:** before running this step, verify Steps 8 and 9 have both been ticked off in the todo list. If either is missing, run the missing step now — do **not** offer a merge gate on top of skipped verification or review. This is the last line of defence against the review-skipped failure mode: even if the build loop dropped Step 9, this check must catch it before any "merge now?" prompt fires.

After the PR is posted, wait for CI builds to complete **synchronously in the same turn**. Based on result and the gate in Step 10:

- **Gate passes (auto-mergeable):** yes/no "All three gate conditions pass (ACs verified, CI green, review `pass`). Merge now? (y/n)". On confirm, hand off to the `ship` producer, map its result through `ship_adaptor`, and route on the resulting outcome (per Step 10). On deny, leave PR open.
- **Gate fails on CI:** "CI failed. Iterate on this PR? (y/n)". On confirm, keep going. On deny, yes/no "Pick next ticket via `/faff-wtf`? (y/n)".
- **Gate fails on review (`fail` or `needs-human`) or unverified AC:** surface the failing condition(s). Yes/no "Address and iterate? (y/n)". On confirm, iterate. On deny, leave for human.

All subsequent chain points are yes/no gates (never passive "run /faff-wtf").

### How to actually wait for CI

**Never say "I'll check CI once it reports" and end the turn.** Turns don't resume on their own — the user has to prompt you again, which defeats the point. Either you wait synchronously in-turn, or you tell the user CI is running and hand back control explicitly (without any promise to check later).

Correct patterns:

- **Block synchronously (preferred):** `gh pr checks <pr> --watch --interval 15` — blocks until all checks reach a terminal state, then exits with non-zero on failure. Wrap in `Bash` with a generous `timeout` (CI runs routinely take 5–15 minutes; allow 600000ms / 10 minutes at minimum, up to the Bash tool's max). If checks legitimately take longer than the tool max, poll in a loop: `gh pr checks <pr>` every 30–60s via `Bash`, until output shows no `pending` / `in_progress`.
- **Hand back cleanly:** "CI is running. I'm stopping here — re-invoke `/faff-graft` or say 'check CI' when you want me to poll." This is the only acceptable way to exit without a CI result. Do **not** pair this with "I'll check once it reports" — you won't.

Forbidden patterns:

- "Waiting on CI. I'll check once it reports." — you can't. The turn is over.
- "Checking CI in the background." — there is no background.
- Ending the turn without a CI terminal state AND without an explicit handoff.

If a CI wait is taking long enough that blocking the turn feels wasteful, **prefer the explicit handoff** over a fake promise. Surprising the user with silence is worse than telling them you're stopping.

**Step 12: Post graft checks**

After build is complete and PR has been raised:

- **Discovered scope (only if `concrete` items were recorded in Step 9 → _Discovered scope_):** list them and offer a yes/no gate — "Found N out-of-scope item(s) while building: [titles]. File as Backlog tickets? (y/n)". On confirm, file each per the `faff-chain-gap-fill` recipe (see `/faff-tidy` → _Chain gaps_): status `Backlog`, tag `faff-chain-gap-fill`, the recorded relationship link, and a "discovered during build of ISSUE-XX" provenance line + back-link. On deny, leave them in `discovered-scope.json` for a later pass. `vague` items are listed for awareness only — never offered for filing. (Interactive use has no orchestrator above graft, so the human confirming *is* the orchestrator authorising the file; autonomous runs file via beep-boop instead, never here.)
- **Next ticket:** yes/no "Pick next ticket via `/faff-wtf`? (y/n)". On confirm, invoke `/faff-wtf` via the Skill tool. On deny, stop cleanly.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop`), follow the shared autonomous contract (see the sibling `faff/SKILL.md`) and these specifics:

**Entry:** assumes issue exists, is not cancelled/archived, **is not held** (gateway → **Automation hold**), has a valid spec, and a dedicated worktree is already prepared (per-issue worktree isolation per the gateway → **Worktree policy**; the `concurrency` slot relies on it for parallel runs).

**Automation-hold backstop (first).** A held issue should never reach autonomous graft — prep/tidy won't promote it, so it never enters the build queue. As the build chokepoint, graft nonetheless re-checks: if the issue carries the `faff-automation-hold` label, **refuse to build** — skip without starting, do not commit the spec or open a worktree, and return a skip (the orchestrator records it as held, not built; never `parked`, never a build attempt). Never remove the hold label.

**Flow:**
1. Skip Step 6's build/review/reprep choice. Proceed directly to build (Step 7).
2. During Step 7, if a decision arises that the spec doesn't resolve, run resolve-attempt first (see Resolve-attempt before park section below). If resolve-attempt proceeds, log to `.faff/runs/<run-id>/ISSUE-XX/resolve-attempt.md` and write the audit-trail tracker comment, then continue. If resolve-attempt fails, invoke `/faff-prep` respec. If respec is still ambiguous, park.
   - Before invoking respec, apply the gateway's "spec-closed decisions stay closed" rule (see the sibling `faff/SKILL.md` Autonomous Mode Contract) — parse for `Chosen:` / `Decision:` / `Punt:` markers, not topic keywords. Only invoke respec when the spec has a real punt, missing external dependency, or cost/irreversibility trigger.
3. After build, run Step 8 (AC verification) — mandatory.
4. Push the branch and open the PR as a **regular (non-draft) PR**. Regular PRs are the default in autonomous mode; the review step decides whether to keep it that way or flip to draft.
5. Run Step 9 (review phase). Act on the three-valued signal:
   - `pass` → proceed to Step 10 merge-confidence gate.
   - `fail` → iterate: fix flagged items, re-run tests, re-run review. Loop until `pass` or `needs-human` (cap at 3 iterations; if still `fail` after 3, treat as `needs-human`).
   - `needs-human` → flip PR to draft, park per the shared protocol. Return `pr-open-for-human`.
6. Run Step 10 (merge-confidence gate) automatically:
   - **All three conditions hold:** wait for CI to reach a terminal state (`gh pr checks --watch`), then on green hand off to the `ship` producer (configured occupant or the default `faffter-noon-ship`) and map its native result through `ship_adaptor` (default `faffidavit-ship`) to the delivery outcome, then to a caller-facing return: `shipped` → `shipped` (worktree eligible for cleanup, chained issues unblock); `not-ready:<reason>` → park retry-later, return `pr-open-for-human`; `failed:<reason>` (including an unmappable result coerced to `failed`) → one fix attempt if obvious from the error, else park, return `pr-open-for-human`.
   - **CI failed:** one fix attempt if the failure is obvious from the logs; otherwise flip to draft, park. Return `pr-open-for-human`.
7. Any unrecoverable error → park and return `errored`.

**Discovered scope** captured during Steps 7/9 stays in `.faff/runs/<run-id>/ISSUE-XX/discovered-scope.json` and is reported in the `discovered_scope` return field. graft **never files** it — beep-boop's file-discovered-scope step does, after the build pass (gateway → **Agent Lanes**). This is independent of the terminal outcome: a `shipped`, `pr-open-for-human`, or `parked` issue can all carry discovered scope.

### Resolve-attempt before park

In autonomous mode, before parking on `needs-decision-first` / `gap-blocked` / `circular-blocked` verdicts (read from `.faff/runs/<run-id>/automation-verdicts.md` if available, otherwise compute inline per gateway → **Automation-routing contract**), run a **resolve-attempt** as specified in gateway → **Autonomous Mode Contract → Resolve-attempt before park**.

Behaviour per verdict (full rules in gateway):

- `needs-decision-first` — re-read the Punt section, check codebase conventions, check spec-internal `Chosen:` markers, check related shipped issues. Proceed if a single clear answer falls out with high confidence; park if multiple defensible answers or the choice is architectural.
- `gap-blocked` — determine whether the named external dep is load-bearing or precautionary. Proceed if precautionary; park if load-bearing.
- `circular-blocked` — determine whether one cycle edge is defensive-not-load-bearing. Proceed by serialising the remaining edges if so; park if every edge is load-bearing.

`repeat-parked` gets **no** resolve-attempt — the pattern itself is the signal. Always park.

**Bounded.** Read at most 3 files outside the spec's named scope. Beyond that → park.

**Audit trail (always).** When a resolve-attempt proceeds, write a tracker comment on the issue using this format:

> _Faff autonomous resolve-attempt:_ The spec flagged this as `[verdict + marker]` but [the reasoning from codebase / spec / context]. Proceeding with [the inferred answer]. **If this is wrong, comment on this PR before merge and faff will re-park.**

Also write `.faff/runs/<run-id>/ISSUE-XX/resolve-attempt.md` capturing: original marker, files inspected, reasoning, inferred answer.

**Calibration write.** If the PR is subsequently flipped to draft by a human comment, or reverted post-merge within 7 days, write to `.faff/calibration/wrong-inferences/<ISSUE-ID>.md` (or `.faff/calibration/post-merge-reverts/<ISSUE-ID>.md`) per gateway → **Autonomous Mode Contract → Calibration log**. This is the calibration evidence loop.

**What this does NOT do.** Does not bypass existing safety boundaries. Side-effects-outside-PR-flow still park unconditionally. Destructive operations still park unconditionally.

**Park protocol:** shared — see the sibling `faff/SKILL.md`. Summary: WIP commit, **flip PR to draft**, tracker comment with cause, `faff-parked` tag, `.faff/logs/…` entry. (Draft status is the signal that a human needs to look — non-draft PRs are fair game for auto-merge.)

**Return values to caller (beep-boop / the `concurrency` slot):**
- `shipped` — all three gate conditions held, PR merged (unblocks chained issues)
- `pr-open-for-human` — review returned `needs-human`, CI failed unrecoverably, or the delivery outcome (the `ship` producer's result via `ship_adaptor`) was `not-ready` (deploy-readiness deferred, retry-later) / `failed` (merge or deploy error, or an unmappable result coerced to `failed`) — PR awaiting human
- `parked` — mid-build ambiguity that respec couldn't resolve, or missing prerequisites
- `errored` — unexpected failure (MCP outage, worktree dirty, etc.)

Alongside the terminal token, graft reports **discovered scope** — it never files it (that's the orchestrator's job):

- `discovered_scope: { concrete: N, vague: N, path: .faff/runs/<run-id>/ISSUE-XX/discovered-scope.json }`

The four terminal tokens and the ledger-bucket mapping are **unchanged**; `discovered_scope` is an additional field beep-boop reads in its file-discovered-scope step (gateway → **Agent Lanes**: the implementor records, the orchestrator files). When graft captured nothing, `concrete` and `vague` are `0` and the file is absent.

**Ledger bucket mapping.** These caller-facing returns map onto the run-ledger terminal buckets the `concurrency` slot records: `shipped`→`shipped`, **`pr-open-for-human`→`pr-open`**, `parked`→`parked`, `errored`→`errored`. The slot writes the ledger *bucket*, not the raw return token, or `runcheck` flags an invalid outcome.

Log the full per-issue trace to `.faff/runs/<run-id>/ISSUE-XX/graft.md` (beep-boop provides the run-id directory; when invoked outside beep-boop, use `.faff/logs/YYYY-MM-DD/HHMMSS-graft-ISSUE-XX.md`).

## Notes
- Don't ask for confirmation before creating the worktree — the user said the issue ID, that's the intent.
- The prep gate is non-negotiable. Even quick fixes benefit from a lightweight prep pass.
- The spec is committed to the feature branch, not main. It only reaches main when the PR merges.
- Any detailed implementation plans produced during the work are the implementer's concern — may commit alongside code (e.g. `docs/superpowers/plans/`), or not. Faff-graft doesn't prescribe this.
- AC verification is not optional. A PR without a ticked-or-explained AC checklist is not complete.
