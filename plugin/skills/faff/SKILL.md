---
name: faff
description: "Use when invoking /faff without a specific sub-skill, or choosing between planning new work, prioritising, grooming, preparing a ticket, building, onboarding and unattended delivery."
---

# SuperDomestique

Route to the matching skill. With no further context, `/faff` invokes `/faff-wtf`.

## Routing

| Intent | Invoke |
|---|---|
| New project, kick off, idea, new feature, bug report, capture, scope a new thing, spitball | `/faff-jot` |
| Shape an existing ticket or freeze/thaw its automation hold | `/faff-jot ISSUE-XX` |
| Decompose an application-scale idea, plan the whole project, turn an idea into initiatives and projects | `/faff-plot` |
| Where to focus, what to work on, what's happening, catch me up, where are we, the 411, lowdown | `/faff-wtf` |
| Existing roadmap, strategy, workstreams, chains, how the backlog joins up, big picture, walk through the plan | `/faff-map` |
| Tidy, clean up or groom the backlog | `/faff-tidy` |
| Spec, scope or acceptance criteria for an existing ticket | `/faff-prep ISSUE-XX` |
| Work on, start, take on, pick up, build or fire up an existing ticket | `/faff-graft ISSUE-XX` |
| Run overnight, fire and forget, chew through the backlog, unattended | `/faff-beep-boop` |
| Set up/configure faff for this repo, onboard, first run, no faffrc | `/faff-onboard` |

## Routing fallbacks

Invoke a matching sub-skill directly. Jot creates/shapes a feature, bug or idea one level deep; plot creates an application roadmap top-down: initiatives, projects, first-slice epics. Jot can fork to plot at confirmation when scale warrants it. Plot is create-only; jot with an issue ID operates on that existing ticket. Other work skills act on existing tickets.

## What faff is

A level belongs to a workload, not a team: tickets on one board may run at different levels. Slots select stage implementations; appetite controls how far the pipeline proceeds before checking back. Neither changes the level.

| Level | Who runs the loop | Entry and human involvement |
|---|---|---|
| L1, as the loop | Human | wtf/map/tidy/jot/plot/prep assist planning; the human runs each step and writes the code |
| L2, in the loop | Agent | graft builds one issue; present spec, build, review and PR gates for human approval |
| L3, on the loop | Agent unattended | beep-boop drains ready work, parks cases it cannot decide, and accounts for admitted work in the run-ledger |
| L4, out of the loop, preview | Agent unattended | `faff lights-out` is the sole L3-to-L4 entry; adversarial review and isolated code-blind holdout apply |

Mechanical enforcement exists only where a named artifact enforces it. Review quality and human-intent interpretation remain model judgements; the name of a level is not proof of safety.

| Level | Mechanical mechanisms | Model-compliance limits |
|---|---|---|
| L1 | None delegated; the human operates each step | Human responsibility |
| L2 | `prepcheck` Stop hook blocks produced-but-unattached specs; `setup-worktree.sh` + `faff worktree-root` provide isolation; reviewable PR/revert-via-PR flow | Presenting the spec-to-build gate is prose-enforced; review verdicts and AC verification require judgement |
| L3 | Run-ledger + `runcheck` Stop hook refuse dangling admitted work; `faff label` refuses tracker-owned eligibility labels; `faff worktree-prune --issue` scopes cleanup; `faff dod classify` maps prose to needs-human and malformed input away from approve | Park judgement; claim-before-admit is best-effort, not a mutex; fresh gate reads are runtime discipline |
| L4 preview | Fail-closed preflight genuinely probes all eight guardrail contracts by selftest: container isolation, admissibility, spec-review, terminating predicate, budget, observability, kill-switch, holdout. Dial coherence and worktree-isolation floor also apply. `container-check` refuses `not_confirmed`; banner and strict-defaults ledger persist 8/8 enforcement. `merge-gate` rereads holdout meets-spec fail-closed; `merge-fence` hook denies raw `gh pr merge` | Adversarial/holdout detection and per-criterion assessment remain model judgements. `no_execute` and `autonomous_contract` are static invariants; worktree isolation is runtime checked. Preview: the holdout lane has not completed a real end-to-end run; trust-maturity labelling and recipe-by-name vetting are still being formalised |

See `docs/guide/unattended.md` for the lights-out launch surface. Never infer stronger guarantees from a slot swap or appetite setting.

## First run

At interactive entry, if `faff config path` exits 3 (no `.faff/config.yaml`), offer once: `No faff config found. Set up faff for this repo now? (y/n)`.

- **Accept:** invoke `faff-onboard` via the Skill tool using the shared sibling-skill resolution rule; resume the original command with the resulting config.
- **Decline:** using the same already-resolved `"$faff"`, run `config init --set tracking.spec_docs_path=`, then `gitignore-ensure`, then `hooks-ensure`; continue the original command on defaults. Do not re-resolve or hardcode the executable.
- **Autonomous/beep-boop:** proceed silently on defaults. Never offer onboarding or create a config stub without the human.

Declining is not a gate. The stub's sole leaf is the empty `tracking.spec_docs_path`; a keyless `tracking:` block is not writable. Leave `tracking.repo`, `git_host` and `tracker` unset. The stub makes config-path exit 0 so the offer does not repeat. A later deliberate onboard recognises this decline stub and continues detection rather than treating it as completed setup.

The two ensurers are idempotent: ignore `.faff/` and register runcheck/prepcheck Stop hooks, skipping hooks the resolved executable cannot serve. Apply this first-run check once at the shared entry boundary, not as duplicated snippets in each sub-skill.
