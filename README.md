# faff

*Faff* (n.): the tedious palaver around the actual engineering. Writing the tickets, the specs, the test plans, the review write-ups, working out what's even worth doing. The stuff you know you *should* do properly and never get around to. faff does it for you, and then keeps going: stage by stage it takes the faff out of the delivery loop until, if you fancy, the whole thing runs without you.

## What faff is

Under the hood it's a **harness**: a set of Claude Code skills wrapping the delivery loop (issue → spec → build → review → ship) in fixed contracts and gates. It won't make the model a better engineer. It makes it **safe to stop watching**, one step at a time.

The spine of the whole thing is **the tracker as the control plane**. Your tracker drives two halves of automation:

- **Deliver the *right* things** — tracker-driven *methodology* automation: value/risk sequencing, what to focus on next, grooming the backlog (`/faff-wtf`, `/faff-map`, `/faff-tidy`, via the swappable `methodology` slot).
- **Deliver them *right*** — automated *spec-driven development*: issue → spec → build → review → ship, each stage behind a fixed contract.

In both, the tracker stays the human-legible record, control plane, and observability surface — which is exactly what makes it safe to step back and let the loop run.

## The levels

The **levels** aren't a faff feature. They're *how far you've wandered off from the loop* — who's running it, and what's keeping it from spontaneous robot combustion while your back's turned. That's the "where do I fit, what do I gain" question, and it's the whole pitch. And a level is per-**workload**, not per-team: eligibility is set per ticket, so a team legitimately runs L1 and L3 on the same board the same night — see [Adopting by change-class](docs/guide/adopting-by-change-class.md).

| Level | You're | Loop run by | What keeps it honest | Entry point |
|---|---|---|---|---|
| **L1 · as** the loop | the engineer | **you** | well… you | `/faff-wtf`, `/faff-map`, `/faff-tidy`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2 · in** the loop | a step inside it | the agent | your nod at every gate | `/faff-graft` |
| **L3 · on** the loop | watching from the sofa | the agent | park protocol + run-ledger | `/faff-beep-boop` |
| **L4 · out** of the loop | off down the pub | the agent | adversarial review + isolated holdout | `faff lights-out` |

**L1/L2 are the on-ramp.** They're the same tracker + methodology tooling — *without* handing off the build. At **L1** you write the code and faff plays planning exoskeleton (what's worth building, a spec worth building from). At **L2**, `/faff-graft` drives one build but stops at every gate for your say-so. Same tracker, same methodology — you just haven't handed the keys over yet.

**L3 · on the loop is the centrepiece.** `/faff-beep-boop` chews through the ready queue unattended and **parks** anything it can't call. The safety net isn't you staying awake — it's mechanical: the **park protocol** never quietly bins a loose end, and the **run-ledger** refuses to call a run "done" if it left admitted work dangling. The tracker reflects every status, spec, park, and outcome, so the morning view is the tracker — not a wall of logs. This is the level you can actually leave the building from. → [Unattended runs](docs/guide/unattended.md), and [what makes work eligible before an unattended run](docs/guide/unattended.md#before-your-first-unattended-run).

**L4 · out of the loop** is lights-out. `faff lights-out` is the single self-checking entry point that turns an L3 run into L4 — a fail-closed preflight, an L4 run-ledger, and correctness held up by adversarial review and a code-blind holdout verdict on isolated worktrees. It ships as a v1 basic preflight, with richer dial-coherence and the adversarial-promotion machinery as named follow-ons. → [Going lights-out](docs/guide/unattended.md#going-lights-out-l4--faff-lights-out).

> Two knobs cut across all four levels (they aren't levels themselves): **slots** decide *what* runs at each stage, and **appetite** sets *how much rope* the pipeline gets before checking back. See [Configuration](docs/guide/configuration.md).

## Install

```
/plugin marketplace add shftwst/faff
/plugin install faff@faff
```

## Your first five minutes

1. **Tell it where your stuff lives.** Run `/faff-onboard` to write a `.faffrc.yaml` at your repo root (or drop in three lines by hand — see [Configuration](docs/guide/configuration.md)).
2. **Got a new idea or an empty repo?** Run `/faff-jot`. It chats through what you're building and turns it into tickets. Already have a backlog? Skip to step 3.
3. **Not sure what to do?** Run `/faff-wtf` — it tells you what shipped, what's stuck, and what to pick up.
4. **Picked something?** Run `/faff-prep ISSUE-XX` to turn it into a spec, then `/faff-graft ISSUE-XX` to build it.
5. **Want it all done while you sleep?** Run `/faff-beep-boop` and check the results in the morning.

Each step offers to chain into the next, so you can just keep saying yes. That's the whole loop. For worked examples, see the [Walkthroughs](docs/guide/walkthroughs.md).

## Commands

| Command | What it does |
|---------|-------------|
| `/faff` | "What should I work on?" (default) |
| `/faff-onboard` | First-run setup — autodetect your tracker and write a working `.faffrc.yaml` |
| `/faff-jot` | Start something new — capture a feature/bug/idea (or kick off a project) and turn it into tickets |
| `/faff-plot` | Decompose an application-scale idea top-down into a roadmap — initiatives → projects → first-slice epics |
| `/faff-wtf` | Where to focus — what shipped, what's stuck, what's next |
| `/faff-map` | The strategic roadmap view above wtf — outcomes, workstreams, dependency chains |
| `/faff-tidy` | Tidy the backlog — find the mess, clean, and surface what's ready to pick up |
| `/faff-prep ISSUE-XX` | Turn a vague ticket into a buildable spec |
| `/faff-graft ISSUE-XX` | Set up a worktree and start building |
| `/faff-beep-boop` | Unattended run — drain the ready queue overnight, park anything ambiguous for morning review |

## Going further

Everything past the pitch lives in `docs/`:

- [Glossary](docs/GLOSSARY.md) — every load-bearing faff noun, one sentence and the artifact it names.
- [Walkthroughs](docs/guide/walkthroughs.md) — two guided runs: idea → tickets, and a first build start to finish.
- [Unattended runs](docs/guide/unattended.md) — the L3 deep-dive: the loop, fire-and-forget, park protocol, run-ledger, tracker-as-control-plane, and running over SSH.
- [Adopting by change-class](docs/guide/adopting-by-change-class.md) — the adoption pattern: risk-tiered delegation per change-class, not a per-team level, built on per-ticket eligibility, appetite, and the verdict gate.
- [Configuration](docs/guide/configuration.md) — the `.faffrc.yaml` reference, plus the two knobs (appetite, slots).
- [Skills & slots](docs/guide/skills.md) — the skill catalogue, the slot model, and swapping in third-party or your own doing-skills.
- [The `faff` CLI](docs/guide/cli.md) — the bundled command-line tool and its subcommands, grouped by purpose.
- [governance-check](docs/guide/governance-check.md) — the harness-independent enforcement binding: wiring the GitHub Action as a required status check, the artifact-passing convention per emitter class, and sha-pinning the binary fetch.
- [Architecture](docs/guide/architecture.md) — the segregated orchestrator / implementor / evaluator agent lanes.
- [What faff costs to run](docs/reports/adopter-cost-2026-07.md) — measured $/PR, what an unattended night costs, and the two levers that cut it.

## Credits

The nlspec format used by `faffter-dark-nlspec` draws on [NLSpec-Spec](https://github.com/TG-Techie/NLSpec-Spec) by TG-Techie, licensed under Apache 2.0. See `NOTICE`.

## License

Apache 2.0
