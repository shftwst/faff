---
name: faff-wtf
description: "Brief on what shipped, what is blocked, what to work on next and what an unattended run parked. Use for catch me up, current focus or what happened."
---

# Faff — WTF (Where To Focus)

> **Next steps:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-graft ISSUE-XX` to start building

Pull current state from your issue tracker and git, figure out what matters, tell you what to do.

## Configuration

**Load the kernel first.** If `faff/references/kernel.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. Do **not** Read `faff/SKILL.md` (the bare-`/faff` routing gateway — a specific-skill entry never needs it). Then Read the lane references wtf consumes: `faff/references/tracker.md`, `faff/references/methodology.md` — wtf is interactive-only and never Reads `faff/references/autonomous.md` (it surfaces calibration via the Calibration log in `faff/references/methodology.md`, which wtf Reads, carrying no autonomous-contract prose). wtf displays the **fixed automation-routing + spec-readiness contracts**; it falls back to git-only mode only when no tracker connector resolves **per gateway → Tracker availability resolution** (honour a `tracking.tracker` pin, discover before concluding absence — never infer git-only from an immediately-invisible tool list).

**Ordering is delegated.** Anywhere this skill suggests, ranks, or recommends work (Coming Up, Today's Focus, Ready to pick up, build-queue independents, parked-overnight triage), it renders the order the configured `methodology` slot's `pick-ordering` returns (gateway → **Ordering & judgement delegation**). `/faff-wtf` states no ordering of its own; the thematic default supplies priority + chainable unlock value when no methodology is set.

**Methodology transport.** Each `methodology` output `/faff-wtf` requests (`pick-ordering`, `standup-digest`, and `backlog-diagnostics` when no tidy ran this pass) is dispatched as a **producer subagent** (gateway → **Sibling-skill invocation → Producer dispatch**) resolving the `methodology` dispatch lane. Per gateway → **The `methodology` slot → Transport** they share **one batched dispatch per render pass**; if `/faff-wtf` is ever itself a subagent, the call runs **in-context** (single-level nesting).

**Reflect newly unlocked potential.** When summarising recently completed work, explicitly call out what each shipped issue **unblocked** — issues whose blockers cleared in the last 24-48 hours and are now ready (or one step closer to ready). This belongs in "Recently Completed" alongside the ship list, and these unlocked issues are flagged as *just-realised* potential (annotated "just unlocked by …") so the human/automation notices them — where they land in "Coming Up" / "Today's Focus" / "Ready to pick up" is the methodology's `pick-ordering` call, not wtf's.

## Always pull fresh

Every invocation re-fetches the whole picture live per the shared **Always pull fresh** rule (gateway): every milestone, every In Progress / Blocked / Recently Completed / Coming Up issue, every blocker link, status field, and recent-activity timestamp. A briefing built on a partial or cached fetch is silently wrong, and the human acts on it.

## What it does

**Rendering rules.** Every issue surfaced in any section below uses the synthesis contract (gateway → **Rendering → `rendering_adaptor`**) — tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. Build-queue and prep-queue sections render as the queue partition grid (`rendering_adaptor` slot, default `faffidavit-rendering` — form (c)). Cycles render as the cycle bracket / cycle box form. Structural diagnostics findings and calibration signals are pulled from the most recent `.faff/logs/YYYY-MM-DD/HHMMSS-tidy*.md` files; if none exists in the current pass, wtf runs the structural-diagnostics computation inline (same logic, same output location). When a `methodology` slot is configured, a `### Methodology findings` section sits after `### Today's Focus` (display convention: gateway → **The `methodology` slot**).

**Two lanes, daily-driver first.** Sections 1–7 are the **L1 answer**: what shipped, what's stuck, your parked loose ends, and the 2–3 things to do today, plus a backlog-health read (methodology, structural diagnostics, calibration) drawn from tidy's cache. One section, the **automation preview** (§5b), answers a *different* question: is it worth handing the queue to `/faff-beep-boop`? It renders after the focus answer and never displaces it.

Run through these sections in order:

### 1. Timeline Check
- Read tracker/project config from `.faff/config.yaml` (`tracking`); milestones are always fetched live, never from config
- **Always re-fetch milestones and their completeness live** — never rely on cached snapshots or values written into `.faff/config.yaml`. Source of truth is the tracker. Call whichever tracker MCP is configured (use its list-milestones equivalent — autodetect from the available MCP, don't hardcode) per project / workstream id to pull current milestone target dates and progress percentages.
- Calculate where we are relative to milestone target dates
- Flag if any milestone is at risk based on remaining work vs time
- Render one table per project with columns `Milestone | Target | Progress` (see Output Format)

### 2. Issue Tracker State
- **In Progress:** Issues currently being worked on
- **Blocked:** Issues that are blocked and why
- **Recently Completed:** Issues closed since last briefing (last 24-48 hours). For each, list any issues it just **unblocked** (dependents whose last remaining blocker was this one). These newly-unlocked issues are the freshly-realised potential of the recent shipping.
- **Coming Up:** Next unstarted issues to surface, ordered per the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**). Issues unblocked in the last 24-48 hours are annotated as just-realised potential so they're easy to spot.

Query across every team in the resolved team-set (`tracking.teams`, legacy `tracking.team_key` as a one-team set — resolve via `faff config get --json tracking.teams`, falling back to `tracking.team_key`) in one pass, unioned with the project scope from `.faff/config.yaml` (`tracking.project_id`); honour "always pull fresh" per team (gateway → **Always pull fresh**). Exclude cancelled and archived per the shared rule.

### 3. Git Activity
- **Recent Commits:** Last 24-48 hours of commits on active branches
- **Open PRs:** Any PRs awaiting review or merge
- **Branch Status:** Active feature branches and their state
- **CI Status:** Any failing builds or checks

### 4. Parked work (any source)

Surface every issue faff has parked — whether by an overnight `/faff-beep-boop` run **or** interactively (a manual `/faff-prep` / `/faff-graft` that hit low confidence, an unresolved punt the user chose to leave, or a build-time ambiguity). The manual user parks too (L1 prep, L2 build), and that work must resurface here — not only beep-boop's.

**The `faff-parked` label is the spine of this section, not the run logs.** Every park — autonomous or interactive — applies the `faff-parked` label per the shared **Park / Unpark protocol** (gateway), so the tracker query catches them all regardless of how they were parked:

- **Tracker query for issues tagged `faff-parked`** (or the tracker's equivalent label) — the authoritative source; covers interactive *and* autonomous parks.
- The most-recently-modified `.faff/runs/*/summary.md` (if any run logs exist) — used only to enrich autonomous parks with a log path. Pick by mtime, not name — run-id mint formats vary and are not load-bearing here. Use `Bash(ls -t "$PWD/.faff/runs/" 2>/dev/null)` to check for existence — do **not** use Glob, which silently misses dot-prefixed directories in some environments (e.g. Docker containers). A missing or unreadable run-log directory **never** suppresses this section — the label query still runs.

For each parked issue, surface:
- Issue id and title
- One-line cause summary pulled from the tracker park comment (or the log, when present)
- How to unpark it — re-run the relevant skill per the gateway **Unpark protocol** (re-`/faff-prep` for a spec-level park, re-`/faff-graft` for a build-level park)
- Path to the full log in `.faff/runs/…` when the park was autonomous

Skip this section entirely if there are no parked issues (no `faff-parked`-labelled issues and no parked items in run logs).

### 4c. Awaiting review — adversarial outage

Surface every issue tagged `faff-awaiting-review` via a **live tracker label query** (this label is not `faff-parked`'s query above and is easy to miss otherwise — wtf's parked query is scoped to `faff-parked` only). **Distinct from Parked work above:** this is not a human park — it means the built work is durable (branch pushed) and the review is waiting on a **machine** (the provider) to recover, auto-resuming on the next `/faff-beep-boop` drain with no rebuild. For each: issue id + title, the outage-retry attempt count (`n`/`graft.review_outage_retry_limit`), and a note that no action is needed — it self-resolves next drain, or escalates to an ordinary park after the retry bound. Skip the section if none.

### 4c-bis. Awaiting spec-review — adversarial outage

The prep-altitude twin of §4c above. Surface every issue tagged `faff-awaiting-spec-review` via a **live tracker label query** (a distinct label + query from `faff-awaiting-review`'s §4c — the two altitudes stay separable). **Distinct from Parked and §4c above:** not a human park, and not a stalled *build* — the spec is attached and durable on the tracker, review has not concluded, and the outage is waiting on a **machine** (the spec-review provider) to recover, auto-resuming on the next `/faff-beep-boop` drain with no re-spec. For each: issue id + title, the held-drain attempt count (`n`/`prep.spec_review_outage_hold_limit`), and a note that no action is needed — it self-resolves next prep drain, or escalates to an ordinary park past the hold limit. Skip the section if none.

### 4d. ADR supersession proposals awaiting ratification

Surface every **propose-only** ADR-admission candidate recorded by an autonomous `faff-graft` Step 3b run — a **loop-authored** ADR proposing to supersede a **human/legacy-provenance** ADR, which the admit gate correctly refused to auto-write (guardrails ratify only by human gesture; the loop never self-ratifies). Read `.faff/adr-proposals/*.json` (one file per candidate, keyed by the new ADR's number; written by graft, never by `/faff-wtf`). **Distinct from Parked / Awaiting-review above:** this isn't a stalled issue — the build that authored the proposing ADR already shipped; the proposal is a standing, git-native artifact (an ADR pair, not a tracker issue) waiting on a **ratification gesture**, not a build retry.

For each entry with `disposition: propose-only`: surface the new ADR (number + title) and the old ADR it proposes to supersede (number + title), the recorded `why`, and the issue that authored it. Offer a yes/no gate: **"Ratify supersession of ADR-`<old>` by ADR-`<new>`? (y/n)"**. On confirm, run `faff adr supersede <old> --by <new>` (the shipped mechanical linker — no new write mechanics), then delete the now-resolved `.faff/adr-proposals/<new>.json`. On deny, leave the file — it resurfaces on the next `/faff-wtf` pass unchanged. This is the **only** place a human ratifies a loop-over-human ADR supersession; the admit gate never asks elsewhere.

`disposition: reject` entries are informational only (the admit gate's own gates — challenge, by-level, ratchet — already refused these; there is nothing to ratify) — mention a one-line count ("N supersession(s) refused by the admit gate — see the log") rather than itemising, unless appetite is `high`/`full` (prominent) per the gateway's appetite-graded-surfacing rule. Skip the section entirely if `.faff/adr-proposals/` is absent or empty.

### 5. Today's Focus
Based on the above, recommend 2-3 specific things to focus on today, **selected and ordered per the configured methodology's `pick-ordering`** (gateway → **Ordering & judgement delegation**; the thematic default orders by priority → chainable unlock value):
- **Never suggest cancelled or archived** issues or projects as candidates (shared rule)
- Surface issues unblocked in the last 24-48 hours as freshly in play — recent shipping has just put them in reach (their order is the methodology's `pick-ordering` call)
- Flag if something blocked needs attention first
- Note any dependencies that are about to unblock downstream work — call out the size of the chain that would open up

(The value-chains view — which ready issue ships the most downstream value if delegated — lives in the **automation preview**, §5b, not here. Today's Focus stays the L1 answer: a short, ordered list of what *you* pick up next.)

### 5a. Methodology findings (rendered only when a `methodology` skill is configured)

Request the `standup-digest` output from the configured `methodology` skill and render what it returns. The digest carries a WIP status, an optional sequencing diagnosis, and the top structural findings — the methodology decides their content; faff-wtf only places and trims them.

- **WIP coupling.** When the digest reports WIP at cap, `### Today's Focus` recommends **completion of in-flight only** — no new starts. Below cap, allow up to the digest's remaining-headroom count of new starts.
- **Highlight, not firehose.** Render at most two structural findings here, ordered by the digest's severity. If more exist, end with "(more in `/faff-tidy`)".

Skip the entire `### 5a` subsection if no `methodology` skill is configured.

### 5b. Automation preview — is it worth firing `/faff-beep-boop`? (always render)

The **L3 delegation view**: which lever ships the most downstream value, and what an unattended run would pick up right now (computed per the **Automation-routing verdict (fixed)**, gateway). It answers a different question from Today's Focus above and never displaces it. **Always present** — even with empty queues, render the headers with "(none)" so the human can see at a glance whether a run is worth kicking off.

**Value chains to unlock (rendered when any ready issue has chainable unlock value ≥ 2).** Surface the **chains** so you can see which lever ships the most downstream value. For each ready (or about-to-be-ready) issue that gates others, render the chain it opens, not just a count:

```
SHF-12  add auth-token service        →  unlocks SHF-18 → SHF-19 → SHF-23   (3 issues, all currently blocked only by SHF-12)
SHF-40  extract the billing client    →  unlocks SHF-41, SHF-42             (2 issues, parallel once SHF-40 ships)
```

Render the head issue (the one to build now), an arrow, then the transitive dependents in dependency order (a chain `A → B → C`) or as a flat set when they fan out in parallel. Note how many of the chain are blocked **only** by the head (would all become ready the moment it ships) versus still gated by other work — computed over live blocker edges only (gateway → **Satisfied blockers — edges to terminal work**); a satisfied edge to a Done target is never "still gated". **Cross-team edges are first-class:** since §2's fetch already unions every configured team into one graph, a chain whose head sits in one team and whose dependents sit in another (a PRODUCT feature unblocked by an IDEAS spike) renders as the SAME single chain — never split into a per-team view. Order the chains via the configured methodology's `pick-ordering` over the chain heads (gateway → **Ordering & judgement delegation**). Skip the block when nothing has unlock value ≥ 2 (an objective render-gate on a fact).

**Build queue (verdicts admitted: `fire-and-forget` + `likely-fire`).** Renders as the queue partition grid (`rendering_adaptor` slot, default `faffidavit-rendering` — form (c)). Independents are ordered per the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**). Collision groups are serialised within themselves and placed by their lead issue's position in that same `pick-ordering`.

**Needs your call before automation can pick up.** Renders the four non-admitted verdicts in this order: `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked`. Each issue carries the synthesis gloss + a one-line diagnosis (the Punt being asked, the named gap, the cycle visualised, or the repeat-park count and root-cause class). `needs-decision-first` has **two causes** — name which one in the diagnosis: a spec `**Punt:**` (show the decision being asked), or a retained `confidence: medium` rating (prep attached the spec for review rather than auto-building — show the rating explicitly and the area the spec was thin on). A medium-confidence spec with no open punt would otherwise render with an empty diagnosis; surfacing the rating is the whole point — it tells the human "give this a once-over" even when there's no single decision to make. **Group `needs-decision-first` by the punt's `(decides: <owner>)` tag** (gateway → Spec readiness → Punt ownership) so each reader sees their own decision queue: closed-vocab tokens (`architecture`, `product`, `qa`, `security`) alphabetically, then free-form handles alphabetically, then `(unowned)` last; within each group preserve the methodology `pick-ordering`. Untagged punts, `any`-tagged punts, and retained `confidence: medium` items fall into `(unowned)`; an issue carrying multiple punts that span different owners repeats under each relevant group, showing the specific punt for that group. `repeat-parked` ⚠ is rendered prominently — pattern parks are the strongest signal the human needs to act.

**Prep queue (drained by default `/faff-beep-boop` full pipeline).** Backlog/pre-Todo issues unblocked (or blocked only by in-queue work), with no discoverable spec or a stale/superseded spec flagged by tidy. List as flat bullets — no conflict analysis needed at prep stage. Apply the synthesis contract for the gloss.

### 5c. Structural diagnostics (always render — at least the status line)

Read the most recent tidy log (`.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`) for `backlog-diagnostics` findings. If no tidy ran this pass, request the `backlog-diagnostics` output from the configured methodology skill (default `faffter-noon-methodology-thematic`) — when it fires it joins the pass's batched methodology dispatch (**Methodology transport** above). Render a one-line status if all clean (`Structural diagnostics: clean ✓`); otherwise render the findings in the format that output defines.

Repeat-parks, orphaned+repeat-parked, and **chain-gap** findings (any sub-type — sub-ticket / upstream / downstream / peer) additionally surface in `### Heads up` so the user sees the urgent patterns prominently, not just in the diagnostics dump. Chain gaps are first-class Heads-up material: when a ticket's spec references work no ticket tracks, picking up the ticket leaves the broader purpose unfulfilled with no breadcrumb for what's next. Tag each Heads-up chain-gap entry with the sub-type so the human can scan-read.

### 5d. Calibration signals (rendered only when threshold crossed)

Read `.faff/calibration/` summary (computed by tidy if it ran, otherwise inline) and surface any signals that crossed the threshold (≥4 events of the same root-cause class in the last 14 days). See gateway → **Autonomous Mode Contract → Calibration log**.

Each signal renders as a paragraph with the count, pattern, period, and three suggested next actions. Signals are advisory — the user decides whether to act.

Skip this section entirely if no signals crossed the threshold.

### 6. Risks and Flags
- Anything overdue or slipping
- Approaching milestone deadlines
- Items that have been in progress too long without movement

### 7. Ready to pick up (lightweight tidy)
Quick scan for backlog issues that are now unblocked, well-prepped, and ready to pick up. Order via the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**) and mention the top 1-2 candidates. Issues unblocked within the last 24-48 hours by recent shipping are annotated as just-appeared leverage.

## Chaining

All hand-offs are yes/no gates (or short-choice where a real branch exists). No passive "run /faff-*" language.

After presenting the output:

- **Picked a focus item:** "Picking up ISSUE-XX. Prep now via `/faff-prep`? (y/n)" — on confirm, invoke the `faff-prep` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**). If the issue already has a spec, the gate becomes "Start building now via `/faff-graft`? (y/n)".
- **Multiple picked:** invoke the `faff-prep` skill (or `faff-graft` if already prepped) via the Skill tool on the first; note the rest for later.
- **"Done" reported by user:** move the issue to Done (no further chain).
- **"Blocked" reported by user:** mark blocked, ask the blocking reason.
- **"Reprep" or "update the spec":** yes/no "Re-prep via `/faff-prep`? (y/n)".
- **Full groom:** "Run a full groom via `/faff-tidy`? (y/n)".
- **Parked overnight issue:** for each, offer three-way choice "open log / re-run `/faff-prep` / leave parked (log/reprep/leave)". On `log`, print the log file contents. On `reprep`, invoke the `faff-prep` skill via the Skill tool. On `leave`, move on.
- **Ready to pick up candidate:** yes/no "Promote to Todo? (y/n)".
- **Build queue non-empty:** yes/no "Build queue has N issues (M independents, K collision groups), plus P prep candidates. Run `/faff-beep-boop` (full pipeline — tidy + prep + build)? (y/n)". On confirm, invoke the `faff-beep-boop` skill via the Skill tool. On deny, move on.
- **Prep queue non-empty with build queue empty:** yes/no "Nothing ready to build, but N prep candidates. Run `/faff-beep-boop` (default full pipeline) to drain the prep queue (will also build anything that lands at confidence: high)? (y/n)".

Keep the tracker in sync with reality. No one starts building without a spec.

## Output Format

Follow the configured `rendering_adaptor` table-vs-definition-list rule (gateway → **Rendering → `rendering_adaptor`**). Keep the brief concise and scannable.

If a methodology skill is configured, start with `Methodology: [skill-name]`. Then use `## What's up: [date]` and, when applicable, **[Y] days to [next milestone]**.

Render these sections in order, using the numbered phases above for their content and gates:

| Section | Content and form |
|---|---|
| Milestones | One table per project: `Milestone \| Target \| Progress`, with ID/name, YYYY-MM-DD and percentage from the live tracker. |
| Shipped | Issue glosses plus newly unlocked issues and their glosses. |
| In progress | Issue gloss and status. |
| Blocked | Issue gloss and blocker reason. |
| Parked work | All park sources; gloss, cause, unpark route and autonomous log path when present. Include the applicable follow-up offer for each manual and autonomous park. |
| Awaiting review (adversarial outage) | Build review wait, attempt n/N, next-drain auto-resume and no action needed. |
| Awaiting spec-review (adversarial outage) | Durable spec review wait, held drain n/N, next-prep-drain auto-resume and no action needed. |
| ADR supersession proposals awaiting ratification | New/old ADR numbers and titles, authoring issue, why and the ratification gate. Refusals follow appetite-graded surfacing. |
| Do this | Two or three methodology-ordered focus items, issue gloss, priority source, unlock consequence and "just unlocked by" annotation where applicable. Respect WIP/headroom. |
| Methodology findings | Configured lens only; WIP, optional sequencing diagnosis and at most two severity-ordered structural findings; link excess to `/faff-tidy`. |
| Heads up | Repeat-parks, orphaned repeat-parks, chain gaps tagged by sub-type, and risks/deadlines. Report actions only when the source records them. |
| Automation preview | Value chains when the threshold is met; Build queue; Needs your call grouped/diagnosed as Phase 5b specifies; Prep queue. |
| Structural diagnostics | Clean status line or the full findings in the methodology's defined form. |
| Calibration signals | Threshold-crossed signals only, each with count, pattern, period and three suggested actions. |
| Ready to pick up | Top one or two methodology-ordered candidates, gloss, readiness reason and applicable unlock annotations. Include "Promote to Todo? (y/n)" for each candidate. |

Omit empty optional sections. Always render the automation preview with `(none)` under empty subsections; even with no work, show `Build queue: (none)` and `Prep queue: (none)`. Always render at least the structural-diagnostics status line. Finish with the applicable Chaining offers. Check every surfaced parked item and Ready-to-pick-up candidate has its offer; include start/build/prep and ADR ratification gates when applicable. Check Chaining's full-groom offer as well. Offers never claim an action has already occurred.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop`), follow the shared autonomous contract (see the sibling `faff/references/autonomous.md`) and these specifics:

**Output:** a plain ready-queue list — issue id, title, readiness flag (`ready` or `needs-prep`). No focus recommendation, no "Do this", no "Heads up", no chat-style prose.

**Return to caller (beep-boop):** `{ ready: [...], needs_prep: [...], blocked: [...], verdicts: { fire_and_forget: [...], likely_fire: [...], needs_decision_first: [...], gap_blocked: [...], circular_blocked: [...], repeat_parked: [...] }, structural_diagnostics_findings: N, calibration_signals: N }`.

**No chaining gates in autonomous mode** — beep-boop decides what to do with the queue. No remediation offers for parked issues either; triage is the human's job, not beep-boop's.

Log the query results and the returned lists to `.faff/logs/YYYY-MM-DD/HHMMSS-wtf.md`. This narrative `HHMMSS-wtf.md` write is subject to the gateway logging gate (skip the narrative write when `logging: essential`).

## Notes

- Don't over-query — pull what's needed, synthesize, present
- If the project's ambient context (e.g. `CLAUDE.md`) states working-pattern or scheduling preferences, respect them when timing recommendations — faff keeps no separate config channel for this; the human's stated preference is the source.
- WIP recommendations are human-facing only. Autonomous in-flight work (issues `/faff-beep-boop` is currently building or has a PR open for) does not count against the human's WIP cap — the human reviews one PR at a time.
