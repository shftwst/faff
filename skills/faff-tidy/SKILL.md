---
name: faff-tidy
description: "Groom the backlog in both directions — find problems (dupes, vague tickets, stale blockers, dead weight) and promote ready issues to Todo. Trigger for: 'tidy' / 'clean up' / 'backlog' / 'groom' / 'mess'."
---

# Faff — Tidy

> **Next step:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-workit ISSUE-XX` to start building an issue that's prepped

Tidy the backlog. Looks both ways in one pass:

- **Down:** find the mess — dupes, vagueness, dead weight, stale specs, stale blockers, aging issues, orphans, uncategorised, splittable, blocked
- **Up:** find issues that are actually ready and promote them to Todo, are parallelisable, or done

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared CLAUDE.md `Project Tracking` / Planning Skills expectations, the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol.

**Consuming-project CLAUDE.md is context.** Read the consuming project's `CLAUDE.md` (and any docs it points at) before tidying. Treat it as clues to organisation and current workstream priority — what areas the project cares about right now, what's been deprioritised, naming conventions for groupings. Use this to inform priority calls when ordering ready/promotion suggestions and to spot mis-grouping in "Uncategorised".

**Cancelled work is noise — ignore it entirely.** Do not surface cancelled entities — issues, or whatever the tracker calls higher-level groupings — in any summary, finding, or bucket. The only exception: if a **cancelled ancestor** (parent, grandparent, or any higher-level container, regardless of what the tracker calls it) still has **non-cancelled descendants**, ask the human (interactive) or log for human review (autonomous) whether those descendants should be cancelled too. Never auto-cancel.

**Never offer to add labels.** Labelling is `/faff-prep`'s job. Tidy does not suggest, apply, or chain into label changes — not for "Uncategorised", not for spec health, not anywhere. If categorisation is genuinely missing, flag the issue for `/faff-prep` instead.

**Description ≠ spec.** A populated issue description is **not** a spec. Spec discovery means a real spec exists per the shared **Spec discovery** rule (canonical tracker comment, committed `docs/superpowers/specs/…`, or equivalent). Never suggest promoting an issue to Todo on the strength of a description alone — that's a `/faff-prep` candidate, not a ready issue.

## Process

**Tidy acts. It does not just list.** Any finding with a mechanical, unambiguous fix is applied — not reported as an observation for the human to do later. "X, Y, Z reference cancelled blocker W" is not a finding to surface; it is an instruction to strip the references. Surfacing cascading cancellations as prose in a summary, with no action taken, is the failure mode to avoid.

Query all backlog issues from the issue tracker. **Exclude cancelled and archived per the shared rule.** Sort each into one of three buckets:

### 1. The mess (needs action)

- **Dupes:** Two issues covering the same work
- **Vagueness:** Issues with no clear deliverable — what even is this?
- **Too broad:** Single issues spanning multiple domains that should be split
- **Too big:** Single issues spanning too much effort that could be split
- **Premature:** Issues depending on work or decisions that don't exist yet
- **Spec health** — run the shared **Spec discovery** rule per active issue, then classify:
  - **Overlooked:** A spec exists but not in a canonical discovery location — e.g. draft in an old comment thread, a markdown file on a stale branch, an unlinked document. Or: the issue is in Todo (past the prep gate) but spec discovery finds nothing at all. **Action (mechanical):** move/link the spec to a canonical location (tracker comment or `docs/superpowers/specs/…`) so prep and workit can find it. If no spec exists anywhere but the issue is in Todo, demote the issue back to Backlog and flag for `/faff-prep` — crossing the prep gate without a discoverable spec is a broken state.
  - **Stale:** Spec's design decisions no longer hold against the current codebase — deps listed in the spec have since shipped with different shapes, architecture has moved on, files the spec names have been renamed/deleted, or the spec predates a significant refactor. **Action:** in interactive mode, surface for `/faff-prep` in refresh mode. In autonomous mode, follow `/faff-prep` autonomous stale-refresh rules (refresh only if the original design still holds; else park).
  - **Superseded:** Another ticket has since shipped that changes the approach this spec assumes — e.g. the spec planned to extend module X, but a subsequent PR replaced X with module Y. The spec is not just stale; its premise is wrong. **Action:** flag for human re-prep or cancellation (the work may no longer be wanted, or may need a completely different plan). Do not auto-refresh — the new direction requires human judgement.
- **Dead references to cancelled/archived work (mechanical cleanup — strip the links).** Any active issue carrying a blocker / blockedBy / parent / sub-issue / related / dependency pointer to a cancelled or archived issue. The reference is always dead — a cancelled issue cannot unblock, parent, or depend on anything. Action: remove the link from the active issue. This is not a judgement call and is applied in both interactive and autonomous modes. Whether the active issue itself is still wanted after cleanup is a **separate** question (see "Orphaned by cascade" below).
- **Orphaned by cascade:** Active issues whose rationale depended on a chain of now-cancelled work — e.g. "cost metric + alert on observability stack" when all four observability issues were cancelled in a mass sweep. After dead-reference cleanup these issues have no remaining justification. Flag for human judgement (cancel / redirect / leave as-is). Do not auto-cancel; the call belongs to the human.
- **Unblocked:** Issues whose only remaining blockers are Done. After confirming the blocker actually produced what was needed, remove the (now-satisfied) blocker link and re-evaluate readiness.
- **Missing deps:** Issues that clearly need something not listed in their blockers
- **Dead weight:** Merged/cancelled issues still cluttering the backlog
- **Aging:** Old issues that are likely never be worked upon
- **Not needed:** Issues that are not needed any longer
- **Orphaned:** Issues without a parent project, or sub-issues with a Done/Cancelled parent issue
- **Descendants of cancelled ancestors:** Active issues with any cancelled ancestor in the chain (immediate parent or further up — whatever container types the tracker uses). Surface for human decision: cancel them, reparent them, or leave standalone. Never auto-cancel.
- **Uncategorised:** Issues that are clearly mis-grouped against the consuming project's CLAUDE.md / docs (wrong parent, wrong ancestor, wrong grouping). Surface as a flag for `/faff-prep` — **never propose labels here**.
- **Stale park label:** Issues still carrying the `parked-by-faff` label (or tracker equivalent) that fall into either of two sub-cases:
  - **State moved on:** issue is now In Progress, In Review, Done, Cancelled, or Archived. The label exists so `/faff-wtf` surfaces work that needs human attention; once a human has picked it up, merged it, or killed it, the label is noise.
  - **Park reason no longer applies:** read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`. The park is invalid if (a) the reason matches a pattern now forbidden by the autonomous contract (session compaction, context length, topic-keyword match on a spec-closed decision, edits to files that only take effect after merge like CI/IaC/Dockerfile/netlify.toml), (b) the reason cited a specific blocker issue ID and that blocker is now Done/Merged/Cancelled, or (c) the reason cited a spec punt and the spec has since been updated to close that punt with a `Chosen:`/`Decision:` marker.

For each, state the problem and recommend a specific action (split, merge, archive, update deps, clarify, promote, flag for `/faff-prep`, reparent). **Never recommend label changes** — that's `/faff-prep`.

### 2. Ready to pick up (promote to Todo)

An issue is ready when:
- Nothing is blocking it (or blockers are already Done)
- You can tell what "done" looks like
- The deliverable is concrete, not hand-wavy
- No big architectural questions to answer first
- Not a dupe of something else
- **Has a real spec** per the shared **Spec discovery** rule (canonical tracker comment, committed `docs/superpowers/specs/…`, or equivalent). A populated description is **not** a spec — issues with only a description are **never** ready; they go to "Almost ready" for `/faff-prep`.

**Order ready issues by priority, then by chainable unlock value.** Once the readiness gate is passed, rank promotion candidates with this lexicographic order:

1. **Priority** is king. Priority can live on the issue itself or on any ancestor (parent, grandparent, or higher — whatever the tracker calls those containers) — **respect both**. If the issue has explicit priority, use it; otherwise inherit from the nearest ancestor that does. When the consuming project's CLAUDE.md highlights a current workstream, weight issues in that workstream higher.
2. **Chainable unlock value** breaks ties (and matters even more in automation). Within a priority band, prefer issues that unblock the most downstream work — count direct + transitive dependents (issues whose blockers list this one, recursively). An issue that unlocks a chain of five others beats an isolated issue of the same priority. This is especially important for `/faff-beep-boop`: shipping the unlocking issue first means the next autonomous pass has more ready candidates to chew through.

Present ready issues in this order so the human (or `/faff-beep-boop`) picks up the right thing first.

### 3. Almost ready (flag)

Issues that are close but need one small thing — a blocker that's still In Progress, one unresolved question, an unclear acceptance criterion, **or solid info in the description but no spec in any canonical discovery location** (description alone never counts — those go here, for `/faff-prep`).

### 4. Stuck in prep — needs human decision

Issues currently carrying the `parked-by-faff` label (or tracker equivalent) where the park is **still valid** — i.e. the autonomous-mode auto-removal rules above did **not** clear it, because the park reason is genuinely subjective or judgement-bound: an architectural call to make, scope to decide, a punt the spec didn't close, an explicit "needs human" marker. These are real blockers on a human, not noise.

For each, read the park reason from the tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md` and surface it concisely so the human knows what decision is being asked of them.

**Order this bucket the same way as Ready** — priority first (issue or any ancestor, respect both), then chainable unlock value (how much downstream work resolving this would unblock). A parked issue that's gating a chain of five others should be top of the human's attention list, especially in autonomous runs where unblocking it lets `/faff-beep-boop` chew through the chain on the next pass.

## Output and chaining

Present findings grouped by bucket. Skip any bucket with no findings.

After presenting, drive action via yes/no gates (never passive suggestions):

- **Mess fixes:** "Apply the recommended actions for the mess? (y/n, or 'pick' to choose per issue)". On confirm, apply them.
- **Stuck-in-prep → resolve:** "N issues are parked waiting on a human decision, ordered by priority then chainable unlock value. Walk through them now? (y/n, or 'pick')". On confirm, present each with its park reason and the decision being asked, then offer to remove the park label / re-run `/faff-prep` once the human commits to a direction.
- **Almost-ready → prep:** "N issues are almost ready — missing a spec. Run `/faff-prep` on all / pick some / skip? (all/pick/skip)". On `all` or `pick`, invoke `/faff-prep` via the Skill tool for the chosen issues.
- **Ready → promote:** "N issues are ready for Todo, ordered by priority then chainable unlock value. Promote all / pick some / skip? (all/pick/skip)". On confirm, move them.
- **After promotion → build:** "Start building one of these now via `/faff-workit`? (y/n)". On confirm, ask which (default to top of the priority + unlock-value order) and invoke.

Every chain point is an explicit gate. No "you should run" language.

## Autonomous Mode

When invoked autonomously (e.g. by `/faff-beep-boop` in its default full-pipeline mode), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

**Auto-actions (applied without prompting):**
- **Auto-strip dead references to cancelled/archived issues.** For every active issue, remove any link — blocker, blockedBy, parent, sub-issue, related, dependency — pointing at a cancelled or archived issue. This is mechanical and always safe; a cancelled issue cannot block or depend on anything. Post a single consolidated tracker comment per cascade (e.g. "After SHF-114 was cancelled, stripped blocker references from SHF-115/116/117/118/119"). Log every stripped link with the active issue id, the dead target id, and the link type.
- **Auto-canonicalise overlooked specs.** When the **Spec discovery** rule finds a spec in a non-canonical location (old comment thread, stale branch, unlinked document), copy it to the canonical location — tracker comment on the issue, or `docs/superpowers/specs/…` if a feature branch exists for the issue. Log the move. If an issue is in Todo with no spec at any discovery location, demote to Backlog and log as "broken prep gate — no spec found"; do not invoke `/faff-prep` from tidy (that's `/faff-beep-boop`'s prep queue job in the default full pipeline).
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

**Prep-queue candidates (handed to `/faff-beep-boop`'s prep queue in the default full pipeline; log-only otherwise):**
- **Stale specs** — tag the issue so `/faff-beep-boop` (default full pipeline) picks it up during the prep queue drain. Prep's autonomous stale-refresh path decides the outcome: if the original design still holds → `refreshed` (stays Todo, becomes a build candidate); if an architectural change is needed → park. If prep refreshes to `confidence: high`, the issue automatically enters the build queue in the same run — a stale-spec issue can be refreshed and shipped in a single overnight pass with no human in the loop.
- **Superseded specs** — tag the issue so the prep queue picks it up as a **fresh-spec** candidate (not a refresh — the original premise is wrong). Prep's autonomous fresh-spec path gates on confidence: `confidence: high` → `promoted` (enters build queue); `medium`/`low` → park for human attention. This is the same loop: if high-confidence fresh spec lands, beep-boop builds it in the same run; otherwise it's surfaced for the morning.
- In ready-queue mode (`/faff-beep-boop --ready`) or in tidy invoked standalone, these become log-only — no prep queue is running to hand them to. Log as "needs refresh" / "needs fresh-spec" so the next default `/faff-beep-boop` run or interactive `/faff-prep` picks them up.

**Log-only (no tracker changes in autonomous mode):**
- Dupes, vagueness, too broad, too big, premature, unblocked-by-done, missing deps, aging, not needed, uncategorised (mis-grouping flagged for `/faff-prep`, never as a label suggestion)
- **Orphaned-by-cascade** — active issue whose rationale depended on a now-cancelled chain — surface for human judgement on cancel / redirect, never auto-cancel
- **Descendants of cancelled ancestors** — active issues under any cancelled ancestor in the tracker hierarchy — surface for human decision (cancel / reparent / leave), never auto-cancel
- **Stuck in prep (still-valid parks)** — issues whose park label survived auto-cleanup because the park reason is subjective/judgement-bound. Log each with: issue id, park reason, priority (issue or ancestor), and chainable unlock count. Sort the log by priority then unlock count so `/faff-wtf` and the morning human reviewer see the highest-leverage decisions first.

Record each finding in `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md` with the issue id, category, and recommended action. These surface in the morning via `/faff-wtf` for human review.

**Never in autonomous mode:** auto-split, auto-merge tickets, delete issues, add/remove/restructure labels (that's `/faff-prep`'s domain), change ancestor/grouping assignments, auto-cancel descendants of cancelled ancestors, or promote an issue to Todo on the strength of a description alone.

**Return to caller (beep-boop):** `{ archived: N, reparented: N, refs_stripped: N, park_labels_cleared: N, logged: N, findings_path: .faff/logs/… }`.

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Fix the mess first, then promote — a ready issue that's actually a dupe shouldn't get promoted
- Cancelled work is invisible to tidy except for the "non-cancelled descendants of cancelled ancestors" prompt
- Description ≠ spec. Ever.
- Labels are `/faff-prep`'s job. Tidy never proposes them.
- Promotion order = readiness gate → priority (issue-level OR any ancestor, respect both) → chainable unlock value (how much downstream work it unblocks; matters most for automation)
- Same priority + unlock-value ordering applies to the "Stuck in prep — needs human decision" bucket — surface the highest-leverage parks first
