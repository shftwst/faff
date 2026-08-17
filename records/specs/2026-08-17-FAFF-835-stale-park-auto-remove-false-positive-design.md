# Stale-park auto-remove must not strip a faff mid-build park at In Progress

> Spec: faffter-dark-nlspec · 2026-08-16 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-835.
>
> Revised on 2026-08-16 — spec-review (architectural, minor): corrected the park-state model. The In-Progress + faff-parked issue is one of two faff-park classes (no-PR mid-build park → step 6a; post-PR held-in-draft park, the FAFF-724/784 class → step 5), not a single "draft-PR mid-build park". Added the externally-set In-Review edge case + scenario + test. The predicate design is unchanged.

This spec addresses FAFF-835, a latent bug in faff-tidy's autonomous mode: the "state moved on" auto-remove rule strips the `faff-parked` label from an issue that is validly parked mid-build. The audience is the build agent implementing the fix and the human reviewers gating it. It is buildable from this document plus the repository.

## 1. WHY, problem and principles

**The idea the fix turns on.** An issue carrying `faff-parked` at `In Progress` was put there by faff itself, not a human: faff claims (`In Progress`), builds, and then parks without reverting the claim, and faff never advances an issue to `In Review` on its own (verified: no faff skill transitions to `In Review` — it only detects an externally-set one). Prep-time parks (open punt, low confidence) and structural parks (gap, cycle) happen before any build, while the issue is still at `Backlog` or `Todo`; the retry-later release moves the issue to `Todo` and tags `faff-awaiting-review`, not `faff-parked`. So a `faff-parked` + `In Progress` issue is one of two faff-park classes, and both keep the label doing real work (it keeps the issue out of the eligible pool — `faff next --parked` returns `needs-human`):

- **No-PR mid-build park** — a graft mid-build ambiguity park (the `parked` return during Step 7 build, `plugin/skills/faff-graft/SKILL.md` line 627) or a review `needs-human` handoff, both of which fire *before* the single PR-creation point (Step 9b) and so leave **no PR**.
- **Post-PR held-in-draft park** — a park that fires *after* a PR exists (`pr-open-for-human`: CI-red, holdout-block, no-CI-coverage, delivery not-ready), which flips the existing PR to draft (Park protocol step 1). The two motivating tickets are this class: **FAFF-724** (draft PR #631) and **FAFF-784** (PR #662 held in draft).

Case 1 of the stale-park sweep assumes the opposite of both: that `In Progress` always means a human took the issue over and the label is now noise. That assumption is wrong for both faff-park classes.

**Problem statement.** Autonomous faff-tidy's case-1 rule strips `faff-parked` from any issue at `In Progress` / `In Review` / `Done` / `Cancelled` / `Archived`, with no carve-out. For an issue parked mid-build (still at `In Progress`, draft PR preserved), stripping the label returns a genuinely-stuck build to the buildable pool, so the next beep-boop pass re-picks blocked work. The fix narrows case 1 so it does not strip when the `In Progress` issue shows evidence of an active faff mid-build park.

**Design principles.**

**Never auto-strip on ambiguity.** The sweep already refuses to strip a park whose reason is subjective (case 3). The same restraint governs here: when the signals cannot cleanly classify an `In Progress` + `faff-parked` issue as either a live mid-build park or a genuine human takeover, leave the label on and surface it for a human, never strip. A false strip re-queues blocked work; a false retain only leaves a human to look. The costs are not symmetric, so the safe direction is retain-and-surface.

**Do not rely on `faff-claimed` for this decision.** `faff-claimed` is the discriminator for the separate stale-claim reclaim (monotonicity carve-out 2), but graft clears `faff-claimed` on every terminal disposition of a build, including a `needs-human` mid-build park (`plugin/skills/faff-graft/SKILL.md` line 412). A parked-mid-build issue therefore does not reliably carry `faff-claimed`, so it cannot be the signal for the stale-park sweep. Clearing it on park is deliberate: it stops the stale-claim reclaim from yanking a validly-parked issue back to `Todo` once its claim ages out. The two rules want opposite things from the label, which is exactly why this fix uses a different signal.

**Do not add a new sanctioned backward move.** The status-monotonicity guard (`plugin/skills/faff/SKILL.md` lines 628 to 630) permits exactly two `In Progress -> Todo` carve-outs. Option (b), moving parked-mid-build issues off `In Progress` on park, would need a third sanctioned backward move and a change to the shared Park protocol. The chosen fix stays inside the tidy rule and adds no carve-out.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-tidy/SKILL.md` (lines 277 to 284) | Prose SKILL | The autonomous auto-remove rule; case 1 at line 278 is the bug locus |
| `plugin/skills/faff-tidy/SKILL.md` (lines 68 to 70) | Prose SKILL | Interactive mirror; surfaces only, never strips |
| `plugin/skills/faff/bin/lib/claim-verdict.js` | Node CLI lib | The pure-predicate pattern this fix mirrors (age + TTL -> verdict, no tracker read) |
| `plugin/skills/faff/bin/faff` (lines 28, 137) | Node dispatcher | Where a new CLI command is required and dispatched |
| `plugin/skills/faff/bin/lib/regions.js` (lines 115, 294) | Node CLI lib | Region tag + selftest args registry for CLI commands |
| `plugin/skills/faff/bin/lib/next.js` | Node CLI lib | `faff next --parked` returns `needs-human`, the reason the label keeps work out of the pool |
| `docs/guide/cli.md` (line 51) | Docs | CLI reference table; `lint-cli-doc` enforces a row per command |
| `plugin/skills/faff/bin/lib/lint-cli-coverage.js` | Node CLI lib | Maps each command to a covering test file |
| `test/faff-tidy.test.mjs` (from line 113) | Node test | Existing stale-park test (Scenario B); the new cases sit alongside it |

**Scope statement.** This sits inside faff-tidy's autonomous auto-action set, one rule among the stale-label sweeps, and adds one pure CLI predicate that the rule consumes.

## 2. Out of scope

- **The Park protocol and status-on-park behaviour.** Excluded because option (a) is chosen over option (b); a mid-build park still stays at `In Progress`. Why excluded: changing it needs a new sanctioned backward move. Extension point: `plugin/skills/faff/SKILL.md` "Park protocol (shared)" and the monotonicity guard, if a future issue revisits option (b).
- **The stale-claim reclaim (carve-out 2) and its `faff-claimed` signal.** Excluded because it is a different question (is a claim dead) with a different signal. Why excluded: this fix must not change reclaim behaviour. Extension point: `plugin/skills/faff-tidy/SKILL.md` line 288 and `claim-verdict.js`.
- **Case 2 and case 3 of the sweep.** Excluded; only case 1's `In Progress` trigger is wrong. Why excluded: cases 2 and 3 are unaffected by this bug. Extension point: the same rule block, lines 279 to 283.
- **Interactive tidy behaviour.** Excluded from any behaviour change; it surfaces, it never strips. Why excluded: the bug is autonomous-only. Extension point: lines 68 to 70, wording alignment only (see HOW).
- **git-only mode.** Excluded; with no shared tracker there is no autonomous stale-park sweep of this shape and no draft-PR seam. Why excluded: the sweep is tracker-dependent. Extension point: the git-only notes already present in the tidy autonomous section.

## 3. WHAT, vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| no-PR mid-build park | A graft mid-build ambiguity `parked` return (Step 7) or a review `needs-human` handoff; fires before PR creation (Step 9b), so it leaves `faff-parked` + `In Progress` and **no PR** |
| post-PR held-in-draft park | A `pr-open-for-human` park (CI-red, holdout-block, no-CI-coverage, delivery not-ready) that flips the existing PR to draft; leaves `faff-parked` + `In Progress` + an **open draft PR** (the FAFF-724 / FAFF-784 class) |
| human takeover | A person moving a previously-parked (prep-time or structural) issue to `In Progress` themselves; here the `faff-parked` label is genuinely stale noise |
| state-moved-on strip | Case 1's auto-removal of `faff-parked` because the issue's status implies the park is over |
| park-comment class | Whether the most-recent faff park comment on the issue describes a build-level park (`build`) or a prep-time / structural / other park (`nonbuild`), or none is found (`none`) |

**The predicate.** A new pure CLI command, `faff park-verdict`, mirrors `claim-verdict`: it reads no tracker and no clock, taking only inputs the caller resolved from the tracker, and returns a verdict.

```
COMMAND faff park-verdict:
  --status        one of: backlog | todo | in-progress | in-review | done | cancelled | archived
  --draft-pr      present | absent          # an OPEN DRAFT PR linked to the issue
  --park-comment  build | nonbuild | none   # class of the most-recent faff park comment
  --human-takeover true | false             # human status-move or human comment AFTER the park comment
  --selftest                                # drives the case table; no tracker, no clock

OUTPUT (stdout JSON): { "verdict": "protect" | "strip-ok" | "surface" | "n/a" }
```

Verdict meanings:

| Verdict | Meaning for case 1 |
|---|---|
| `protect` | Live faff mid-build park; the label is still doing work; do not strip |
| `strip-ok` | State genuinely moved on (merged, killed, under review, or a clean human takeover); case-1 strip is safe |
| `surface` | Signals cannot classify cleanly; leave the label, log as "stale park label, needs human" for the next `/faff-wtf` |
| `n/a` | Status is `backlog` / `todo`; case 1's "state moved on" trigger does not apply |

**Design decision, the discriminating signals.** Two faff-park classes need protecting, and each has its own signal. The **post-PR held-in-draft park** (the FAFF-724 / FAFF-784 class) is caught by an **open draft PR** linked to the issue — its own preserved artifact. The **no-PR mid-build park** has no PR to key on, so it is caught by the **park-comment class** (a build-level park reason) plus the **human-takeover flag** (no human action since the park). A bare WIP branch is deliberately *not* a protect signal on its own, because a human takeover can also leave a branch named for the issue, so the branch alone cannot separate the two. **Chosen:** open-draft-PR presence (covers the post-PR class) plus park-comment class and human-takeover flag (cover the no-PR class), not `faff-claimed` and not a bare branch check. Rationale in section 6.

## 4. HOW, behaviour

**Architecture and approach.** Two pieces. First, a new pure predicate `faff park-verdict` in `plugin/skills/faff/bin/lib/park-verdict.js`, wired into the dispatcher and the CLI docs, mirroring `claim-verdict.js` in shape and testability. Second, a narrowed case-1 rule in `plugin/skills/faff-tidy/SKILL.md` that, for an `In Progress` + `faff-parked` issue, resolves the predicate's inputs from the tracker, calls `faff park-verdict`, and acts on the verdict. Tidy owns every tracker read; the CLI stays pure. This is the same split as `faff next` and `faff claim-verdict`.

**The predicate function.** Behaviour summary: given a status and three resolved signals, decide whether case 1 may strip `faff-parked`.

```
FUNCTION park_verdict(status, draft_pr, park_comment, human_takeover):
  1. IF status IN { backlog, todo }:            RETURN "n/a"        # case 1 does not fire
  2. IF status IN { done, cancelled, archived }: RETURN "strip-ok"  # terminal; label is noise
  3. IF status == in-review:                     RETURN "strip-ok"  # review under way; label is noise
  4. # status == in-progress — the disputed case
  5. IF draft_pr == present:                     RETURN "protect"   # post-PR held-in-draft park artifact
  6. IF park_comment == build:
       a. IF human_takeover == false:            RETURN "protect"   # mid-build park, no PR opened yet
       b. ELSE:                                  RETURN "surface"   # faff park then human acted — ambiguous
  7. IF park_comment == nonbuild AND human_takeover == true:
                                                 RETURN "strip-ok"  # classic human takeover of a pre-build park
  8. RETURN "surface"                                                # anything else: cannot classify, do not strip
```

Notes on the boundary choices:

- Step 2 and step 3 preserve the parts of case 1 that were never buggy. A `Done` / `Cancelled` / `Archived` / `In Review` issue that still carries `faff-parked` has genuinely moved on, so `strip-ok` matches today's behaviour.
- Step 5 protects the **post-PR held-in-draft park** class (FAFF-724 / FAFF-784). An open draft PR linked to the issue is that park's own preserved artifact; a person actively working the issue would push and un-draft, so a still-draft PR means faff parked it and no human resumed it.
- Step 6a protects the **no-PR mid-build park** class, which by construction has no PR (a mid-build ambiguity park fires before Step 9b PR creation; Park protocol step 1 flips a PR to draft only when one already exists). Its signal is the build-class park comment with no human action after it.
- Step 8 is the ambiguity fail-safe: when signals are missing or inconsistent, return `surface` so tidy leaves the label and logs a needs-human finding, never an auto-strip.

**How tidy resolves the inputs (in the autonomous rule prose).** Behaviour summary: for each `In Progress` + `faff-parked` issue, gather the three signals from the live tracker, then let the predicate decide.

```
PROCEDURE tidy_case1(issue):
  1. Confirm issue carries faff-parked and re-read its live status.
  2. draft_pr := does the issue have an OPEN DRAFT PR linked?
       Linear: linked PR attachment in draft; GitHub connector: gh pr view --json isDraft,state.
  3. park_comment := class of the most-recent faff park comment on the issue.
       build    if the reason describes a mid-build / blocked-on-external / resume-preserved park;
       nonbuild if it describes a prep-time punt, low confidence, gap, or cycle park;
       none     if no faff park comment is found.
  4. human_takeover := is there a human status-move to In Progress, or a human (non-faff) comment,
       time-stamped AFTER the most-recent faff park comment?
  5. verdict := faff park-verdict --status in-progress --draft-pr <draft_pr>
                --park-comment <park_comment> --human-takeover <human_takeover>
  6. CASE verdict:
       protect  -> do NOT strip; leave faff-parked; log "valid mid-build park, label retained".
       strip-ok -> faff label remove <issue> faff-parked + descriptor write; log + tracker comment (as today).
       surface  -> leave faff-parked; log "stale park label — needs human" for the next /faff-wtf.
```

**Edge cases and error handling.**

- Connector cannot report draft-PR state (explicit no-capability): treat `draft_pr` as `absent` and lean on the park-comment and human-takeover signals; if that yields `surface`, leave the label. Never assume `present` and never assume `absent` guarantees a human takeover.
- No faff park comment found (`park_comment == none`) at `In Progress`: predicate returns `surface` at step 8; leave the label.
- Terminal or in-review statuses still return `strip-ok`; the fix does not make the sweep more conservative for those.
- **Externally-set `In Review` with a draft PR:** a tracker/GitHub integration may auto-move an issue to `In Review` on PR-open while it still carries `faff-parked` and an open draft PR. Step 3 returns `strip-ok` for `in-review` unconditionally. This is defensible under faff's own model — faff never sets `In Review` itself, so an `In-Review` issue is genuinely past faff's control (a human or an integration moved it) and the `faff-parked` label is now the noise the sweep exists to clear; the strip removes only the label, never the draft PR. Called out as a known, low-risk case and covered by a scenario.
- git-only mode: no shared tracker and no PR seam, so this autonomous sweep does not run there; the predicate is still callable and selftestable.

**Failure modes.**

- **The park-comment class is a judgement read, and it could be misread.** How you would know: a mid-build park comment classed as `nonbuild` plus a human comment after it would return `strip-ok` and re-queue a blocked build, the exact FAFF-835 symptom on a different signal. What it means: the draft-PR check is evaluated first (step 5 fires before the park-comment branch), so any park that preserved a PR is protected regardless of comment classification; the park-comment class only decides the no-PR case. This is a narrow residual risk, not a reason to abandon.
- **A human genuinely took over an issue whose PR is still draft.** How you would know: an `In Progress` issue with a draft PR that a person is actually editing would be wrongly protected and never re-promoted by the sweep. What it means: acceptable and self-correcting; the human is already on the issue, `/faff-wtf` still shows it as parked, and un-drafting the PR removes the protect signal on the next pass. A false retain costs a look, not a wrong build.

**Anti-pattern:** keying the decision on `faff-claimed`. Why: graft clears it on the mid-build park, so it is absent exactly when this rule needs it, and reusing it would also collide with the stale-claim reclaim fence.

**Anti-pattern:** treating any branch named for the issue as a protect signal. Why: a human takeover can leave the same branch shape, so a bare branch cannot separate the two cases and would suppress legitimate strips.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an issue at In Progress carrying faff-parked with an open draft PR (a faff mid-build park)
When autonomous faff-tidy runs its stale-park sweep
Then faff park-verdict returns protect and the faff-parked label is NOT removed
```

```
Given an issue at In Progress carrying faff-parked, no draft PR, whose most-recent faff park comment is a prep-time/nonbuild park, and a human comment post-dates that park
When autonomous faff-tidy runs its stale-park sweep
Then faff park-verdict returns strip-ok and the faff-parked label is removed
```

```
Given an issue that is Done or Cancelled but still carries faff-parked
When autonomous faff-tidy runs its stale-park sweep
Then faff park-verdict returns strip-ok and the faff-parked label is removed, unchanged from today
```

```
Given an issue externally moved to In Review that still carries faff-parked and an open draft PR
When autonomous faff-tidy runs its stale-park sweep
Then faff park-verdict returns strip-ok (faff never sets In Review itself; the label is now noise) and the faff-parked label is removed while the draft PR is untouched
```

- The `faff park-verdict --selftest` table must pass with no tracker and no system clock consulted, matching the `claim-verdict --selftest` contract.

## 6. Design decision rationale

**Which option: (a) narrow case 1, or (b) move parked-mid-build issues off In Progress?**
Option (a): keep the mid-build park at `In Progress`, narrow the tidy strip. Pros: reuses existing signals (draft PR, park comment), stays inside the tidy rule, adds no sanctioned backward move. Cons: the strip decision now depends on reading signals correctly.
Option (b): on a mid-build park, move the issue off `In Progress` so "state moved on" stays true. Pros: the case-1 signal becomes honest by construction. Cons: needs a third sanctioned `In Progress -> Todo` carve-out in the monotonicity guard, changes the shared Park protocol, and widens blast radius well past the tidy rule.
**Chosen:** option (a). It is contained to the tidy rule and one predicate, and it avoids a new backward move the guard currently forbids.

**Pure prose, or a deterministic predicate?**
Prose-only: narrow the case-1 condition in the SKILL text. Pros: smallest diff. Cons: the strip/protect classification stays untested prose, unlike the analogous stale-claim reclaim, which already has a pure predicate.
Predicate: add `faff park-verdict`. Pros: deterministic, selftestable boundary table, unit-coverable, consistent with `claim-verdict` powering the sibling reclaim. Cons: one new CLI command to wire and document.
**Chosen:** the predicate. Tidy already pairs a pure predicate with a tracker-owning rule for the reclaim; this keeps the two stale-label decisions symmetrical and covered by tests.

**Which signal discriminates a mid-build park from a human takeover?**
`faff-claimed`: rejected. graft clears it on the mid-build park (`faff-graft/SKILL.md` line 412), so it is absent when needed, and reusing it collides with the reclaim fence that depends on its clearing.
Bare WIP branch: rejected as a sole signal. A human takeover can leave the same branch shape.
Draft PR plus park-comment class plus human-takeover flag: chosen — each covers one faff-park class. The open draft PR is the post-PR held-in-draft park's own preserved artifact (checked first, at step 5); the park-comment class plus human-takeover flag cover the no-PR mid-build park (step 6a), which has no PR to key on.
**Chosen:** open-draft-PR presence (post-PR class) plus park-comment class and human-takeover flag (no-PR class).

**New command, or extend `faff next`?**
Extend `faff next`: rejected; `next` computes the legal next step from status/spec/eligibility, a different question from park validity, and overloading it would blur that.
New `faff park-verdict`: chosen; a focused pure predicate, same as `claim-verdict` sitting beside `next` rather than inside it.
**Chosen:** a new `faff park-verdict` command.

At the time of writing, the connector surfaces faff-tidy already uses (Linear MCP, the GitHub `gh` CLI) expose draft-PR state, so the draft-PR signal is available without new connector work.

## 7. Open questions and assumptions

**Open questions.** None. The option call, the signal, and the predicate shape are all decided above.

**Assumptions.**

- **Assumes:** the active connector can report whether an issue has an open draft PR. Validation: for the GitHub connector, confirm `gh pr view <pr> --json isDraft,state` returns `isDraft`; for Linear, confirm a linked PR attachment exposes draft state. If neither is available, the build agent treats `draft_pr` as `absent` per the edge-case rule and the predicate falls back to the park-comment and human-takeover signals.
- **Assumes:** the faff park comment posted by the Park protocol (`plugin/skills/faff/SKILL.md` "Park protocol (shared)" step 2) is present on a faff-parked issue and its reason line is readable well enough to class as `build` vs `nonbuild`. Validation: re-read the Park protocol short-comment rule and the graft mid-build park comment text before implementing the classification, and confirm the existing case-2 / case-3 rules already read this same comment.

## 8. DONE, definition of done

### From WHY
- [ ] An autonomous faff-tidy run no longer removes `faff-parked` from an `In Progress` issue that has an open draft PR linked.
- [ ] The change adds no new `In Progress -> Todo` backward move and does not edit the monotonicity guard or the Park protocol.

### From WHAT (predicate interface)
- [ ] `faff park-verdict` accepts `--status`, `--draft-pr`, `--park-comment`, `--human-takeover`, `--selftest` and emits `{ "verdict": ... }` JSON.
- [ ] The command reads no tracker and no system clock (pure), matching the `claim-verdict` contract.
- [ ] The verdict domain is exactly `protect | strip-ok | surface | n/a`.

### From HOW (predicate behaviour)
- [ ] `backlog` / `todo` return `n/a`.
- [ ] `done` / `cancelled` / `archived` / `in-review` return `strip-ok`.
- [ ] `in-progress` with `--draft-pr present` returns `protect`.
- [ ] `in-progress`, `--draft-pr absent`, `--park-comment build`, `--human-takeover false` returns `protect`.
- [ ] `in-progress`, `--draft-pr absent`, `--park-comment build`, `--human-takeover true` returns `surface`.
- [ ] `in-progress`, `--draft-pr absent`, `--park-comment nonbuild`, `--human-takeover true` returns `strip-ok`.
- [ ] All other `in-progress` input combinations return `surface`.

### From HOW (tidy rule)
- [ ] `plugin/skills/faff-tidy/SKILL.md` case 1 (line 278) is narrowed: for an `In Progress` + `faff-parked` issue it resolves draft-PR / park-comment / human-takeover from the tracker, calls `faff park-verdict`, and strips only on `strip-ok`; `protect` retains the label, `surface` retains and logs "needs human".
- [ ] The interactive mirror (lines 68 to 70) is reworded so its "state moved on" definition references the same mid-build-park nuance; no interactive behaviour change (it still surfaces, never strips).
- [ ] The gateway unpark-protocol summary (`plugin/skills/faff/SKILL.md` line 845) still defers to the tidy rule and does not contradict the narrowed condition.

### From HOW (wiring and docs)
- [ ] `faff park-verdict` is required and dispatched in `plugin/skills/faff/bin/faff` (alongside the line 28 / 137 pattern).
- [ ] `regions.js` carries the `park-verdict` region tag and its `--selftest` args entry (lines 115, 294 pattern).
- [ ] `docs/guide/cli.md` has a `park-verdict` row (so `lint-cli-doc` passes).
- [ ] `lint-cli-coverage.js` maps `park-verdict` to its covering test file (so `lint-cli-coverage` passes).

### From SCENARIOS (tests)
- [ ] `faff park-verdict --selftest` drives the boundary table and passes with no tracker / no clock consulted.
- [ ] `test/faff-tidy.test.mjs` adds: In Progress + faff-parked + draft PR is NOT stripped (no `removeLabel` mutation); In Progress + faff-parked + nonbuild park + human activity IS stripped (`removeLabel` mutation captured); In Progress + faff-parked + build park + no PR + no human activity is NOT stripped; externally-set In Review + faff-parked + draft PR IS stripped (label removed, draft PR untouched).

**Integration smoke test.**

```
1. Seed a fixture issue: state In Progress, labels [faff-parked], a linked open draft PR.
2. Run faff park-verdict --status in-progress --draft-pr present --park-comment build --human-takeover false
   -> expect { "verdict": "protect" }.
3. Run the faff-tidy harness over the fixture (as Scenario B does).
4. Assert NO removeLabel(faff-parked) mutation was attempted and the issue still carries faff-parked.
```

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (`issue-critique`)._

**Right-sized?** No issues. The ticket bundles one pure predicate, its wiring (dispatcher, region registry, CLI docs row, coverage-lint mapping), a narrowed tidy rule, and matching tests, but all four pieces are needed to deliver one observable fix: the predicate produces no behaviour change until it's wired and consumed, and the rule change has nothing to call without the predicate. Splitting either half out would leave the other undeliverable, so the "complex" build tier reflects genuine, cohesive scope rather than an unsplit epic.

**Workstream fit?** No issues. Standalone Backlog, no project, is the right home for a self-contained bug fix that converges on one outcome (case 1 of the stale-park sweep no longer strips a validly-parked build). The labels (`faff`, `Bug`, `faff-jot-intake`) are tracker taxonomy, not a workstream grouping.

**Deps surfaced?** No issues. FAFF-724 and FAFF-784 are named as the motivating evidence, not prerequisite work; the fix is self-contained. Both are already linked `relates-to`, which makes the connection explicit for automation.

**Risk profile?** No issues. This changes autonomous production behaviour (the unattended stale-park sweep) and leans on connector-reported draft-PR state that can differ between Linear and GitHub, which would normally warrant a de-risking spike. Here that de-risking happened during spec authoring rather than being deferred: the option call, the predicate-over-prose call, and the signal choice all went through spec review and landed at `confidence: high` with no open questions; the predicate is a pure, selftestable boundary table; and the fail-safe direction is explicit (ambiguous signals surface rather than strip). No further spike is warranted before build.

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
