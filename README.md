# faff

You don't like project management. Neither do we. But tickets pile up, context gets lost between sessions, and you end up spending half your morning figuring out what to work on instead of working on it.

Faff is the stuff you do before actual work — but automated. It reads your issue tracker, checks git, and tells you what matters. Then it scopes the work so you can just build.

Made for developers who want to ship, not manage. 

Lightweight with sensible defaults, but configurable enough to use your preferred heavy-weight skills when it matters.

## Install

```
/plugin marketplace add shftwst/faff
/plugin install faff@faff
```

## Your first five minutes

1. **Tell it where your stuff lives.** Drop a `.faffrc` at your repo root (see [Setup](#setup) — three lines is enough).
2. **Got a new idea or an empty repo?** Run `/faff-noodle`. It chats through what you're building and turns it into tickets. Already have a backlog? Skip to step 3.
3. **Not sure what to do?** Run `/faff-wtf` — it tells you what shipped, what's stuck, and what to pick up.
4. **Picked something?** Run `/faff-prep ISSUE-XX` to turn it into a spec, then `/faff-workit ISSUE-XX` to build it.
5. **Want it all done while you sleep?** Run `/faff-beep-boop` and check the results in the morning.

Each step offers to chain into the next, so you can just keep saying yes. That's the whole loop.

> The skills come in tiers — `faff-*` are the commands you type; the `faffter-*` and `faffidavit-*` ones are the swappable bits doing the work behind them. You can ignore all of that until you want to plug in your own tools — see [the appendix](#appendix-skill-families-qualifiers-and-swapping).

## A first run, start to finish

What the loop actually looks like the first time, on a repo that already has a few tickets. (Output is illustrative — yours will name your issues.)

**1. Point faff at your tracker.** A three-line `.faffrc` at the repo root:

```yaml
tracking:
  tracker: linear
  team_key: SHF
```

**2. `/faff-wtf` — "what should I work on?"**

```
Recently completed
  SHF-31  rate-limit middleware shipped → unblocked SHF-40

Today's focus
  1. SHF-40  cache the token lookup   — now unblocked by SHF-31, gates SHF-41 → SHF-42
  2. SHF-12  fix the timezone bug     — quick, isolated

Parked work: none
```

**3. `/faff-prep SHF-40` — turn it into a spec.** Prep explores the codebase, delegates the spec to the producer, and attaches it to the ticket:

```
Explored src/auth/ and src/cache.ts.
Spec attached to SHF-40 (confidence: high — every decision marked, ACs testable).
Moved SHF-40 to Todo.
Start building now via /faff-workit? (y/n)
```

**4. `y` → `/faff-workit SHF-40` — build it.** Workit sets up a worktree, commits the spec, and gets out of your way; you pair with it from there:

```
Worktree ready at ~/.faff/worktrees/faff/SHF-40. Spec committed as the first commit.
Building to the spec — 3 ACs, tests alongside.
```

When it's done it verifies the ACs, runs review, waits for CI, and (interactively) asks before merging.

**5. `/faff-beep-boop` — or let it run the lot unattended.** Same loop, no babysitting: it grooms, specs, and builds the ready queue, parking anything ambiguous for `/faff-wtf` to show you in the morning.

Each step offers to chain into the next — `wtf → prep → workit` — so on a good day you just keep saying yes.

## Commands

| Command | What it does |
|---------|-------------|
| `/faff` | "What should I work on?" (default) |
| `/faff-noodle` | Start something new — kick off an empty project, or capture a feature/bug/idea, and turn it into a sensible set of tickets |
| `/faff-wtf` | Where to focus — what shipped, what's stuck, what's next |
| `/faff-tidy` | Tidy the backlog — find the mess, clean, and surface what's ready to pick up |
| `/faff-prep ISSUE-XX` | Turn a vague ticket into a buildable spec |
| `/faff-workit ISSUE-XX` | Set up a worktree and start building |
| `/faff-beep-boop` | Unattended run — drain the ready queue overnight, park anything ambiguous for morning review |

## How it works

```
new idea / project → tickets → "what should I work on?" → prep it → build it
                                       ↑                                |
                                       └────────── reprep ←─────────────┘
```

0. **Noodle** — turn a new idea (or a whole new project) into a sensible set of tickets
1. **WTF** — what shipped, what's blocked, what to focus on
2. **Prep** — explore the codebase, write a spec, attach it to the ticket
3. **Workit** — spec is committed to a feature branch, worktree is ready, go

`/faff-noodle` is the front door: everything else acts on tickets that already exist — noodle is how they come to exist. It runs a discovery conversation, then shapes the result into tickets using your configured methodology.

Each step chains to the next with a yes/no gate. Say yes, keep moving. Say no, stop.

No ceremonies. No standups with 12 people. Just you and your code.

### Fire and forget

`/faff-beep-boop` runs the whole pipeline without a human in the loop. Good for overnight, meetings, or anything you want off your plate.

- Default: the whole shebang — tidy, then prep every backlog issue, then build whatever's ready
- `ISSUE-12 ISSUE-15`: just those

Auto-merges when every acceptance criterion is verified, CI is green, and review passed. Otherwise the PR is left open with a clear reason. Anything ambiguous is parked and surfaced by `/faff-wtf` in the morning. Full audit trail under `.faff/runs/`.

## Setup

Works with Linear, GitHub Issues, Jira, or any tracker exposed via MCP. No tracker? It falls back to git-only mode.

Drop a `.faffrc` at your repo root telling it where your stuff lives:

```yaml
tracking:
  tracker: linear        # or github, jira — autodetected if you skip it
  team_key: PROJ
  repo: org/repo
```

That's the whole minimum. Everything else has a sensible default. Want to swap in your own skills for any step? Point a slot at them:

```yaml
planning_skills:
  intake: superpowers:brainstorming   # how /faff-noodle runs discovery
  spec: gstack:autoplan               # how /faff-prep writes specs
  review: gstack:review               # pre-PR review
  ship: gstack:land-and-deploy        # merge/deploy
```

All slots are optional — unset just means "use ours". Copy `.faffrc.example.yml` for the full list of knobs.

## Agent lanes

Faff operates across three segregated executor lanes with controlled visibility:

| Lane | Role | Sees | Doesn't see |
|---|---|---|---|
| **Orchestrator** | Pipeline sequencing, external interface (tracker, human, reporting) | Tracker, docs, codebase (read) | — |
| **Implementor** | Architecture, spec interpretation, code, tests | Codebase (read/write), spec | Tracker, human dialogue |
| **Evaluator** | Quality control from business-value perspective | Spec, running environment | Codebase |

Isolation is by design — the implementor can't mark its own homework, the evaluator can't be biased by implementation approach. See the gateway docs for details.

## Skill tiers

Faff has four tiers of skills:

| Tier | Naming | Role |
|---|---|---|
| **faff-*** | Pipeline | Human-facing commands and orchestration. The "what." |
| **faffter-noon-*** | Default behaviours | The extracted default doing-skills (produce / analyse / review). The "how" that ships out of the box. |
| **faffter-dark-*** | Overrides / experimental | Alternative doing-skills that replace defaults or fill optional slots. |
| **faffidavit-*** | Adaptors | Default adaptors over faff-core's fixed internal contracts. Each translates a producer's native output into the contract the pipeline branches on, and validates conformance — invokable in their own right, not passive documents. |

The faff-* skills are pure orchestrators — they define the sequence, then delegate to whichever faffter-noon, faffter-dark, or faffidavit skill is configured. The doing-skills (faffter-*) take inputs and return outputs; the adaptor-skills (faffidavit-*) translate those outputs into faff-core's fixed contracts and check conformance — so swapping a slot swaps the translator, never the contract the pipeline depends on. A methodology is one coherent lens (not split by function) because its principles interact across grooming, standup, roadmapping, and build ordering.

### faffter-noon-* (defaults)

| Skill | Slot | What it does |
|---|---|---|
| `faffter-noon-methodology-structural` | `methodology` | The implicit default. Pure structural analysis — ordering by priority + unlock value, graph-level diagnostics (cycles, chain gaps, ghost pointers, repeat-parks), promotion/demotion by spec readiness. No opinions about value, risk, or right-sizing. |
| `faffter-noon-review` | `review` | The implicit default. Senior-engineer code review — AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging. Emits the `review_adaptor` verdict (pass/fail/needs-human). |
| `faffter-noon-intake` | `intake` | The implicit default intake producer. Runs new-work discovery for `/faff-noodle` (greenfield project or single feature/bug) and emits a discovery brief. The light counterpart to ideation skills like `superpowers:brainstorming`. |
| `faffter-noon-spec` | `spec` | The implicit default spec producer. Issue context in, a spec following the lite nlspec arc (WHY/WHAT/HOW/DONE) out. The light counterpart to `faffter-dark-nlspec`. |
| `faffter-noon-concurrency-sequential` | `concurrency` | The implicit default build-pass executor. Runs `/faff-beep-boop`'s queue one `/faff-workit` at a time over the conflict-analysis partition — no worktree contention, no merge races. The safe counterpart to `faffter-dark-concurrency-parallel`. |

### faffidavit-* (adaptors)

Adaptor skills. Faff-core fixes the **internal contracts** the pipeline branches on — verdict states, vocabularies, classifications — in the gateway, where they never move. Each faffidavit skill is the **default adaptor** that sits in front of one of those fixed contracts: it translates a producer's native output *into* the contract and validates conformance. Swapping the slot swaps the translator, never the contract — which is what lets a third-party producer or reviewer plug in. `faffidavit-rendering` is the exception: rendering has no internal contract (it's human-facing only), so it's a pure adaptor swappable end to end. All are usable standalone, not just inside the pipeline.

| Skill | Slot | What it does |
|---|---|---|
| `faffidavit-spec` | `spec_adaptor` | The default adaptor over the fixed spec-readiness contract (closed/open/external classification + confidence, in the gateway). Owns the canonical markers (Chosen/Punt/Assumes), marker rules, skimmable writing style, and the confidence line's format; validates any spec (pass/fail + violations). All spec producers conform; faff-prep delegates its pre-attach validation here. |
| `faffidavit-review` | `review_adaptor` | The default adaptor over the fixed review-verdict contract (pass/fail/needs-human, semantics, revert test — in the gateway). Owns the output envelope every reviewer returns and normalises raw output onto the three states; validates review output on demand. Swap it to adapt a third-party reviewer — faff-workit still branches on the same three states. |
| `faffidavit-routing` | `routing_adaptor` | The default adaptor over the fixed automation-routing contract (the closed six verdicts + admission rule + root-cause taxonomy — in the gateway). Owns verdict assignment, computation locus, and display format; assigns and validates verdicts. The contract survives a `methodology` swap because it lives in faff-core, not inside the methodology. |
| `faffidavit-rendering` | `rendering_adaptor` | The default — and a **pure adaptor** with no internal contract behind it, since rendering is human-facing only. Owns the rendering style (visual vs prose, the catalogue of canonical visual forms, the table-vs-list rule, density caps) plus the synthesis issue-gloss humanisation; validates/normalises draft output. All sub-skills render through this; swap it to change house style wholesale. |

### faffter-dark-* (experimental)

Pluggable skills that either add new behaviour or change the default behaviour of faff, moving towards a dark factory workflow.

| Skill | Slot | What it does |
|---|---|---|
| `faffter-dark-nlspec` | `spec` | Full nlspec-format spec generation — formal type definitions, pseudocode procedures, closed-loop DoD, appendices. Heavier than the built-in lite arc. |
| `faffter-dark-adversarial-review` | `review` | Two-phase review: runs `faffter-noon-review` first, then sends the diff to a different LLM for a structurally independent second opinion. Replaces the default review. |
| `faffter-dark-methodology-agile-delivery` | `methodology` | Agile delivery methodology lens — seven principles (outcome-named workstreams, value x risk sequencing, WIP caps, right-sized tickets, cohesive workstreams, surfaced deps, risk-aware ordering). Replaces the old `mode: delivery-lead` config. |
| `faffter-dark-concurrency-parallel` | `concurrency` | Concurrent build-pass executor — runs independents in parallel, each in its own worktree, capped at `concurrency_max`, with rebase-before-merge so a moving `main` can't merge stale-green. Replaces the sequential default for speed. |
| `faffter-dark-authoring-adaptors` | — (tooling) | Author/validate skill for slot occupants. Scaffolds a new adaptor/producer/methodology with the correct refer-back prose + contract mapping, and validates that an existing slot skill conforms. A development-time tool, not a pipeline slot. |

Some of these skills (`adversarial-review`) can be configured to use a different model, with provider settings per-slot in `.faffrc`:

```yaml
faffter_dark:
  adversarial:
    provider: gemini
    model: gemini-2.5-pro
    api_key_env: GEMINI_API_KEY
```

The core principle is **independence** — use a different model from whatever wrote the code. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.

These are pluggable skills that either add new behaviour (adversarial review) or change the default behaviour of faff (nlspec replaces the lite spec format, agile-delivery replaces structural-only diagnostics). Some slots skip when unset; others have a built-in default that the skill replaces. See the gateway docs for per-slot defaults.

## Appendix: skill families, qualifiers, and swapping

Skip this unless you want to point a slot at your own or a third-party skill.

### The naming

Every name is `family[-qualifier]-function`.

| Family | Reads as | What it is |
|---|---|---|
| `faff-*` | the faff before work | Pipeline. The slash commands — sequence, gates, tracker/human talk. Delegates the doing. (The "what".) |
| `faffter-*` | *after* faff | Doing-skills. Inputs in, outputs out — produce a spec, run a review, analyse a backlog. (The "how".) |
| `faffidavit-*` | an *affidavit*, an attestation | Adaptors. Translate a doing-skill's output into the contract the pipeline branches on, and attest conformance. (The stable boundary.) |

The `faffter-*` qualifier says how safe the variant is: **`-noon-*`** (broad daylight) ships on by default, conservative; **`-dark-*`** (the dark factory) is an override/experimental swap-in, heavier and lights-out-leaning. The trailing function (`-spec`, `-review`, …) names the slot — same function, same slot: `faffter-noon-spec` and `faffter-dark-nlspec` are both `spec` producers, pick one.

### Two kinds of slot

- **Doing-slots** (`intake`, `spec`, `review`, `methodology`, `concurrency`, `ship`) hold a skill that *does work*. Swap to change behaviour.
- **Adaptor-slots** (`spec_adaptor`, `review_adaptor`, `routing_adaptor`, `rendering_adaptor`) hold a skill that *translates and attests*. What it translates *into* — the verdict states, vocabularies, classifications the pipeline gates on — is a **fixed contract in faff-core** and never moves. Swap to change the surface dialect (envelope, markers, display), never the contract.

The pipeline hardcodes the contract so it always has something stable to branch on; the slot holds the translator so anyone's output can be made to fit.

### Swap in a third-party doing-skill

```yaml
planning_skills:
  spec: gstack:autoplan        # third-party spec producer
  review: gstack:review        # third-party reviewer
```

It must **honour the slot's contract** — a `spec` maps decisions onto closed/open/external + a confidence line; a `review` resolves to `pass`/`fail`/`needs-human`. The faffidavit adaptor enforces this; output already in the house dialect passes straight through. A missing slot is never a park reason — unset means "use ours".

### Write an adaptor (when foreign output doesn't fit)

If the third-party output speaks a different dialect — a reviewer emitting `APPROVED`/`REJECTED`/`BLOCKED` — don't touch faff-core or fork the pipeline. Point the adaptor-slot at a translator:

```yaml
planning_skills:
  review: somevendor:critic                # emits APPROVED/REJECTED/BLOCKED
  review_adaptor: yourorg:critic-adaptor   # maps onto pass/fail/needs-human
```

An adaptor does three things: **names** the fixed contract (gateway → _Core contracts and adaptor slots_; never redefines it), **translates** native output into it (`APPROVED → pass`, honouring the coercion rule — an unparseable verdict goes to `needs-human`, never silently to `pass`), and **validates** (returns `pass`/`fail` + violations so the pipeline never acts on a malformed result). It also carries **refer-back prose** so it can find the contract when invoked standalone (skills load independently — the gateway isn't always in context). Don't hand-roll this: run **`faffter-dark-authoring-adaptors`** — it scaffolds a conformant skill with the refer-back prose and contract mapping in place, and validates an existing one against the conformance checklist. Any `faffidavit-*` skill is also a copyable template: `## Internal contract (fixed — see gateway)` → `## Adaptor` → `## Validate`.

`rendering_adaptor` is the exception — no fixed contract behind it (rendering is human-facing; nothing branches on how output looks), so swap `faffidavit-rendering` to change house style end to end.

## Credits

The nlspec format used by `faffter-dark-nlspec` draws on [NLSpec-Spec](https://github.com/TG-Techie/NLSpec-Spec) by TG-Techie, licensed under Apache 2.0. See `NOTICE`.

## License

Apache 2.0
