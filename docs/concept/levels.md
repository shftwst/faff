---
sidebar_position: 3
---

# The levels

The levels aren't a faff feature. They're *how far you've wandered off from
the loop*. One question sorts them: who's running it, and what's keeping it
from spontaneous robot combustion while your back's turned? A level is set
per **workload**, not per team — eligibility is per ticket, so a team
legitimately runs L1 and L3 on the same board the same night.

| Level | You're | Loop run by | What keeps it honest | Entry point |
|---|---|---|---|---|
| **L1 · as** the loop | the engineer | **you** | well… you | `/faff-wtf`, `/faff-map`, `/faff-tidy`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2 · in** the loop | a step inside it | the agent | your nod at every gate | `/faff-graft` |
| **L3 · on** the loop | watching from the sofa | the agent | park protocol + run-ledger | `/faff-beep-boop` |
| **L4 · out** of the loop *(preview)* | off down the pub | the agent | adversarial review + isolated holdout *(preview)* | `faff lights-out` |

- **L1 · as the loop.** You write the code, your usual IDE agents along for
  the ride. faff plays planning exoskeleton: it tells you what's worth
  building, hands you a spec worth building from, then gets out of the way.
- **L2 · in the loop.** `/faff-graft` drives the build for one issue but
  stops at every gate — spec, build, review, PR — for your say-so. Nothing
  ships behind your back.
- **L3 · on the loop.** `/faff-beep-boop` chews through the ready queue
  unattended and **parks** anything it can't call. The safety net isn't you
  staying awake — it's mechanical: the park protocol never quietly bins a
  loose end, and the run-ledger refuses to call a run "done" if it left
  admitted work dangling.
- **L4 · out of the loop.** Lights-out, and shipped: `faff lights-out` is the
  single entry point that promotes an L3 run to L4. You've left the building
  entirely, and correctness is held up by *adversarial* machinery — a second
  model trying to break the change, a code-blind holdout marking the work
  against a spec it never saw. It won't start unless a fail-closed preflight
  passes over every guardrail contract, then mints a strict-defaults L4
  run-ledger and a one-to-one trust banner.

Two knobs cut across all four levels — they aren't levels themselves:

- **Slots** decide *what* runs at each stage (a beefier spec, a harsher
  reviewer, a parallel build). Swap them to customise any level, or bring
  your own.
- **Appetite** sets *how much rope* the pipeline gets before checking back.
  More isn't always better: it buys speed against the odd "oops, wrong call,
  revert that."

## Mechanical vs model-compliance

"What keeps it honest" names a mix. Some guarantees a named artifact
enforces deterministically — the model can't silently skip them. Others hold
only while the agent complies: real, but agent-upheld. Calibrating trust to
the mechanism, not the level's name, matters more than the label:

| Level | Mechanically enforced | Model-compliance |
|---|---|---|
| **L1** | none — you run every step; no safety is delegated to a machine | n/a — you *are* the loop |
| **L2** | spec-attachment gate; worktree isolation; every build ships as a reviewable PR | that the spec→build gate is actually presented before the build fires; the review-verdict and acceptance-criteria judgement |
| **L3** | the per-run ledger and its audit hook (fails a run that leaves admitted work dangling); the tracker-owned-label refusal on eligibility labels; scoped worktree cleanup | the park judgement itself (calling an issue un-buildable is the model's call); claim-before-admit is best-effort, not a hard mutex |
| **L4** *(preview)* | the fail-closed lights-out preflight; the container-isolation assertion; the merge interlock that re-reads the code-blind holdout verdict fail-closed | whether the adversarial review and holdout actually *catch* a bad change — the machinery is mechanically invoked, but the met/unmet call is the model's; the holdout lane has not yet completed a real end-to-end run |

The honest axis across all four rungs: decreasing scheduled human attention,
with mechanical safety rising only where a level actually names an artifact.
L1's empty mechanical column isn't "less safe" — it's all-human.
