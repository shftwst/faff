---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-jot to start something new (kick off a project or capture a feature/bug/idea into tickets), /faff-plot to decompose an application-scale idea top-down into a roadmap (initiatives → projects → first-slice epics), /faff-wtf to figure out what to focus on, /faff-map for the strategic roadmap view above /faff-wtf, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-graft to start building, /faff-beep-boop to run the whole suite unattended."
---

# Faff

## What faff is

*Faff* (n.): the tedious palaver around the actual engineering. Writing the tickets, the specs, the test plans, the review write-ups, working out what's even worth doing. The stuff you know you *should* do properly and never get around to. faff does it for you, and then keeps going: stage by stage it takes the faff out of the delivery loop until, if you fancy, the whole thing runs without you. You keep the fun part (thinking about the problem and the architecture) and hand off the part where you'd actually, you know, *write the code*. Because, well, who codes any more anyway?!

Under the hood it's a **harness**: a set of Claude Code skills wrapping the delivery loop (issue → spec → build → review → ship) in fixed contracts and gates. It won't make the model a better engineer. It makes it **safe to stop watching**, one step at a time.

The **levels** aren't a faff feature. They're *how far you've wandered off from the loop*. One question sorts them: **who's running it, and what's keeping it from spontaneous robot combustion while your back's turned?** And a level is per-**workload**, not per-team: eligibility is set per ticket, so a team legitimately runs L1 and L3 on the same board the same night.

| Level | You're | Loop run by | What keeps it honest | Entry point |
|---|---|---|---|---|
| **L1 · as** the loop | the engineer | **you** | well… you | `/faff-wtf`, `/faff-map`, `/faff-tidy`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2 · in** the loop | a step inside it | the agent | your nod at every gate | `/faff-graft` |
| **L3 · on** the loop | watching from the sofa | the agent | park protocol + run-ledger | `/faff-beep-boop` |
| **L4 · out** of the loop (preview) | off down the pub | the agent | adversarial review + isolated holdout | `faff lights-out` |

- **L1 · as the loop.** *You* write the code, your usual IDE agents along for the ride. faff plays planning exoskeleton here: it tells you what's worth building, hands you a spec worth building from, then gets out of the way.
- **L2 · in the loop.** `/faff-graft` drives the build for one issue but stops at every gate (spec, build, review, PR) for your say-so. Nothing ships behind your back.
- **L3 · on the loop.** `/faff-beep-boop` chews through the ready queue unattended and **parks** anything it can't call. The safety net isn't you staying awake, it's mechanical: the park protocol never quietly bins a loose end, and the run-ledger refuses to call a run "done" if it left admitted work dangling.
- **L4 · out of the loop.** Lights-out, shipped as a preview: `faff lights-out` is the single entry point that promotes an L3 run to L4. You've left the building entirely, and correctness is held up by *adversarial* machinery — a second model trying to break the change, a code-blind holdout marking the work against a spec it never saw. It refuses to start unless a **fail-closed preflight** passes over all **8 guardrail contracts** (container isolation, admissibility, spec-review, terminating predicate, budget ceiling, observability, kill-switch, holdout) plus dial-coherence and the worktree-isolation floor, then **mints a strict-defaults L4 run-ledger** and a one-to-one trust banner. Still maturing: the trust-*maturity* labelling (the preview tag + honest per-level guarantee table) and the recipe-by-name vetting seam are being formalised. See `docs/guide/unattended.md` for the full launch surface.

#### What's mechanical, what's model-compliance

The "what keeps it honest" column names a *mix*: some guarantees a named artifact enforces deterministically (the model can't silently skip them), others hold only while the agent complies. This table splits the two per rung so you calibrate trust to the mechanism, not the name. **Mechanical** = a Stop-hook / `faff` CLI contract / CI-branch-protection gate / revert-via-PR flow enforces it; **model-compliance** = real but agent-upheld — each already flagged as an honest limit in the gateway prose, cited here rather than restated.

| Level | Mechanically enforced (named artifact) | Model-compliance (already-flagged limit) |
|---|---|---|
| **L1** | none — you run every step; no safety is delegated to a machine | n/a — you *are* the loop |
| **L2** | spec-attachment (the `prepcheck` Stop-hook blocks session-end on a produced-but-unattached spec); worktree isolation (`setup-worktree.sh` + the `faff worktree-root` resolver); every build ships as a reviewable PR (revert-via-PR flow) | that the spec→build gate is actually *presented* before the `Skill` tool fires — a "prose contract … not statically lintable" (the standalone-gate limit); the review-verdict + AC judgement |
| **L3** | the per-run ledger + `runcheck` Stop-hook ("enforced mechanically" — fails a run that leaves admitted work dangling); the `faff label` tracker-owned-label refusal (exits non-zero on the eligibility labels); scoped `faff worktree-prune --issue` (never repo-wide); the `faff dod classify` coercion directions (prose→needs-human, malformed→never-approve) | the park *judgement* itself (calling an issue un-buildable is the LLM's); claim-before-admit is "best-effort, not a hard mutex"; gate-freshness is a "runtime discipline, prose-enforced — not statically lintable" (Re-ground before gate) |
| **L4 (preview)** | the fail-closed lights-out preflight (refuses unless all **8 guardrail contracts** pass a genuine `--selftest` probe *and* the floor holds); the `faff container-check` assertion (refuses on `not_confirmed`); the `worktree-isolation` floor is a real runtime probe (`checked`); the banner + ledger persist the 8/8 enforcement state (fail-closed, `strict === true`); the `faff merge-gate` interlock re-reads the code-blind holdout `meets-spec` verdict fail-closed (missing→block), the `merge-fence` PreToolUse hook denying a raw `gh pr merge` | whether the adversarial review + holdout actually *catch* a bad change — the machinery is mechanically *invoked*, but the per-criterion holdout call is the LLM's; the `no_execute` + `autonomous_contract` floor entries are `static` invariants, not runtime-checked; **preview** — the holdout lane has not yet completed a real end-to-end run |

*The honest axis across all four rungs: **decreasing scheduled human attention, with mechanical safety rising only where a cell names an artifact.** L1's empty mechanical column isn't "less safe" — it's all-human.*

Two knobs cut across all four levels. They're not levels themselves:

- **Slots** decide *what* runs at each stage (a beefier spec, a harsher reviewer, a parallel build). Swap them to customise *any* level, or bring your own — they tune what a level does, not which level you're at (that's which command you reach for).
- **Appetite** (for Destruction) sets *how much rope* the pipeline gets before checking back. More isn't always better: it buys speed against the odd "oops, wrong call, revert that."

## Routing

This is the gateway. Invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-jot` | "New project", "kick off", "start something", "I've got an idea", "new feature", "add a feature", "file a bug", "capture this", "scope a new thing", "spitball"; or `/faff-jot ISSUE-XX` to shape/gate an **existing** ticket — freeze/thaw its automation hold (see `/faff-jot` → Existing-ticket interactor) |
| `/faff-plot` | "Plan this out", "decompose this app", "break this big thing into a roadmap", "map out the whole project", "plot the build", "turn this idea into initiatives and projects" |
| `/faff-wtf` | "Where to focus", "What should I work on?", "what's happening", "catch me up", "where are we", "where we at", "the 411", "lowdown" |
| `/faff-map` | "Roadmap", "where are we going", "explain the backlog", "do these join up", "workstream view", "strategy view", "what are the chains", "big picture", "walk me through the plan" |
| `/faff-tidy` | "Tidy the backlog", "clean up", "groom", "mess" |
| `/faff-prep ISSUE-XX` | "Prep this", "spec this out", "what does this ticket need?", "scope", "acceptance criteria" |
| `/faff-graft ISSUE-XX` | "Work on", "Start this", "take on", "pick up", "let's build", "fire up" |
| `/faff-beep-boop` | "Run overnight", "fire and forget", "chew through the backlog", "unattended" |
| `/faff-onboard` | "Set up faff", "onboard", "first run", "no faffrc", "configure faff for this repo", "get faff working here" — first-run bootstrap of `.faffrc.yaml` (see **First run** below) |

## First run

When **any** faff entry resolves config and finds **no `.faffrc.yaml`** (`faff config path` exit 3 — see **Configuration** below), it makes a one-time **soft-offer** before continuing on defaults:

> `No .faffrc found. Set up faff for this repo now? (y/n)`

- **Soft-offer, not a gate.** Declining is fine — the command proceeds on built-in defaults exactly as a config-less repo does today. The offer is a convenience, never a blocker.
- **On accept** → invoke the `faff-onboard` skill via the Skill tool (resolve per **Sibling-skill invocation**) for the conversational bootstrap, then resume the original command with the new config in hand.
- **On decline** → write a **minimal stub `.faffrc.yaml`** via `faff config init --set tracking.spec_docs_path=` (a single empty-value leaf key the writer always accepts) so `faff config path` returns **exit 0** thereafter and the offer **does not re-fire** on the next command. A *keyless* `tracking:` block is not writable (`config init` exits 2 with no `--set`), so the stub must carry exactly one empty-value key; use `spec_docs_path` (not `repo`/`git_host`/`tracker`) so the stub never makes `config get tracking.repo` return an empty string a later consumer might misread — those keys stay cleanly unset. Declining once is remembered; faff does not nag. (A later *deliberate* `/faff-onboard` distinguishes this **decline-stub** — the lone empty `spec_docs_path` key — from a real config and proceeds to detection rather than bailing "already set up"; see `faff-onboard` → **Bail first**.) **Then, with the same resolved `"$faff"`, run the two ensurers `faff-onboard` step 5 runs** — `"$faff" gitignore-ensure` then `"$faff" hooks-ensure` — so a declined onboarding still leaves accept/decline **parity**: `.faff/` gitignored and the `runcheck`/`prepcheck` Stop hooks registered, the run-ledger honesty backstop a decline-then-`/faff-beep-boop` (or `/faff-prep`) user otherwise runs without. Both are idempotent, non-destructive no-ops when already wired (`hooks-ensure` *skips* a hook the resolved bin can't serve rather than wiring a session-blocker); reuse the `"$faff"` already resolved for `config init` — do **not** re-resolve or hardcode a path.
- **Autonomous/beep-boop runs never emit the offer.** Onboarding and the first-run offer are **interactive-only** (gateway → Autonomous Mode Contract): an unattended run with no config proceeds silently on defaults — it never prompts and never conjures a config behind the human's back. The offer fires only in interactive entry.

The offer is a single gateway-level check (per the gateway-load preamble each sub-skill runs on entry), not a snippet copied into every sub-skill.

## Routing fallbacks

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly. New-work intent — "new project", "kick off", "I've got an idea", "add a feature", "file a bug" — maps to `/faff-jot`. Both `/faff-jot` and `/faff-plot` *create* tickets (the rest act on tickets that already exist — except that `/faff-jot ISSUE-XX` is also an **existing-ticket interactor**, shaping/gating a ticket that already exists by freeze/thaw of its automation hold, a *mode* of `/faff-jot` selected by the issue-id argument, not a separate command; `/faff-plot` remains create-only); they split by **scale**: `/faff-jot` captures and shapes a feature/bug/idea one level deep, while `/faff-plot` recurses an **application-scale** brief top-down into a full roadmap (initiatives → projects → first-slice epics). jot forks to plot at its confirm step when the work is application-scale; "plan this out / decompose this app / map out the whole project" routes straight to `/faff-plot`.
