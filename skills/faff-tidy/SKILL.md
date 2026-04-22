---
name: faff-tidy
description: "Groom the backlog in both directions — find problems (dupes, vague tickets, stale blockers, dead weight) and promote ready issues to Todo. Trigger for: 'tidy' / 'clean up' / 'backlog' / 'groom' / 'mess'."
---

# Faff — Tidy

> **Next step:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-workit ISSUE-XX` to start building an issue that's prepped

Tidy the backlog. Looks both ways in one pass:

- **Down:** find the mess — dupes, vagueness, dead weight, stale specs, stale blockers, aging issues, orphans, uncategorised, splittable, blocked
- **Up:** find issues that are actually ready and promote them to Todo, are parallelisable, or done

## Chat naming

**On invocation (interactive mode only):** clear the chat name with a bare `/rename` — tidy operates across the whole backlog, not a single issue, so any previous name becomes misleading.

In autonomous mode (under `/faff-beep-boop --full`), skip the rename — beep-boop owns the chat name.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared CLAUDE.md `Project Tracking` / Planning Skills expectations, the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol.

## Process

Query all backlog issues from the issue tracker. **Exclude cancelled and archived per the shared rule.** Sort each into one of three buckets:

### 1. The mess (needs action)

- **Dupes:** Two issues covering the same work
- **Vagueness:** Issues with no clear deliverable — what even is this?
- **Too broad:** Single issues spanning multiple domains that should be split
- **Too big:** Single issues spanning too much effort that could be split
- **Premature:** Issues depending on work or decisions that don't exist yet
- **Stale:** Issues with stale specs/acceptance criteria
- **Unblocked:** Issues blocked by something already Done/Cancelled
- **Missing deps:** Issues that clearly need something not listed in their blockers
- **Dead weight:** Merged/cancelled issues still cluttering the backlog
- **Aging:** Old issues that are likely never be worked upon
- **Not needed:** Issues that are not needed any longer
- **Orphaned:** Issues without a parent project, or sub-issues with a Done/Cancelled parent issue
- **Uncategorised:** Issues that don't belong to any categorisation/grouping/tagging mechanism, or that are clearly grouped incorrectly
- **Stale park label:** Issues still carrying the `parked-by-faff` label (or tracker equivalent) that fall into either of two sub-cases:
  - **State moved on:** issue is now In Progress, In Review, Done, Cancelled, or Archived. The label exists so `/faff-wtf` surfaces work that needs human attention; once a human has picked it up, merged it, or killed it, the label is noise.
  - **Park reason no longer applies:** read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`. The park is invalid if (a) the reason matches a pattern now forbidden by the autonomous contract (session compaction, context length, topic-keyword match on a spec-closed decision, edits to files that only take effect after merge like CI/IaC/Dockerfile/netlify.toml), (b) the reason cited a specific blocker issue ID and that blocker is now Done/Merged/Cancelled, or (c) the reason cited a spec punt and the spec has since been updated to close that punt with a `Chosen:`/`Decision:` marker.

For each, state the problem and recommend a specific action (split, merge, archive, update deps, clarify, promote, flag, tag, reparent).

### 2. Ready to pick up (promote to Todo)

An issue is ready when:
- Nothing is blocking it (or blockers are already Done)
- You can tell what "done" looks like
- The deliverable is concrete, not hand-wavy
- No big architectural questions to answer first
- Not a dupe of something else
- Categorised and/or belongs to a milestone
- Has a spec (per the shared **Spec discovery** rule — comments, description, or committed `docs/` all count)

### 3. Almost ready (flag)

Issues that are close but need one small thing — a blocker that's still In Progress, one unresolved question, an unclear acceptance criterion, solid information in ticket but no spec in any of the discovery locations (comments / description / docs).

## Output and chaining

Present findings grouped by bucket. Skip any bucket with no findings.

After presenting, drive action via yes/no gates (never passive suggestions):

- **Mess fixes:** "Apply the recommended actions for the mess? (y/n, or 'pick' to choose per issue)". On confirm, apply them.
- **Almost-ready → prep:** "N issues are almost ready — missing a spec. Run `/faff-prep` on all / pick some / skip? (all/pick/skip)". On `all` or `pick`, invoke `/faff-prep` via the Skill tool for the chosen issues.
- **Ready → promote:** "N issues are ready for Todo. Promote all / pick some / skip? (all/pick/skip)". On confirm, move them.
- **After promotion → build:** "Start building one of these now via `/faff-workit`? (y/n)". On confirm, ask which and invoke.

Every chain point is an explicit gate. No "you should run" language.

## Autonomous Mode

When invoked autonomously (e.g. by `/faff-beep-boop` in `--full` mode), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

**Auto-actions (applied without prompting):**
- **Auto-archive dead weight:** merged or cancelled issues still sitting in the backlog. Move to archive/closed state as the tracker supports.
- **Auto-reparent obvious orphans:** a sub-issue whose parent is Done, Cancelled, or Archived. Reparent to the grandparent if one exists; otherwise remove the parent link.
- **Auto-remove stale `parked-by-faff` labels.** Remove the label in two cases:
  1. **State moved on:** issue is now In Progress, In Review, Done, Cancelled, or Archived. The label's only consumer is `/faff-wtf`; once a human has picked up, merged, or killed the issue, the label just adds noise.
  2. **Park reason no longer applies and can be cleanly verified.** Read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`. Auto-remove when exactly one of these holds:
     - The reason matches a pattern **now forbidden** by the autonomous contract (any of: session compaction, context length, too-many-turns, topic-keyword match on a spec-closed decision, edits to files that only take effect after merge like `netlify.toml` / `.github/workflows/*.yml` / `Dockerfile` / `package.json` dep bumps / IaC / migration SQL files that weren't executed pre-merge). These parks were never valid under the current rules — clear without prompting.
     - The reason cited a specific blocker issue ID and that blocker is now Done, Merged, or Cancelled — live-fetch the blocker state from the tracker, don't rely on cached data.
     - The reason cited a spec punt (`Punt:`, `needs human`, `TBD`, "or X if Y") and the spec now closes that same topic with a `Chosen:` / `Decision:` marker per the **Spec Format Contract**.
  3. **Do not remove** when the park reason is subjective ("architectural change needed", "scope unclear"), vague, or missing. Those are judgement calls — leave the label on and log the finding as "stale park label — needs human" for the next `/faff-wtf`.

  For every auto-removal, log the issue id, original park reason, and the specific rule that invalidated it to `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`. Post a tracker comment noting the removal and the reason.

**Log-only (no tracker changes in autonomous mode):**
- Dupes, vagueness, too broad, too big, premature, stale, unblocked-by-done, missing deps, aging, not needed, uncategorised

Record each finding in `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md` with the issue id, category, and recommended action. These surface in the morning via `/faff-wtf` for human review.

**Never in autonomous mode:** auto-split, auto-merge tickets, delete issues, restructure labels, or change project assignments.

**Return to caller (beep-boop):** `{ archived: N, reparented: N, park_labels_cleared: N, logged: N, findings_path: .faff/logs/… }`.

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Fix the mess first, then promote — a ready issue that's actually a dupe shouldn't get promoted
