# faff

*Faff* (n.): the tedious palaver around the actual engineering. Writing the tickets, the specs, the test plans, the review write-ups, working out what's even worth doing. The stuff you know you *should* do properly and never get around to. faff does it for you, and then keeps going: stage by stage it takes the faff out of the delivery loop until, if you fancy, the whole thing runs without you. You keep the fun part (thinking about the problem and the architecture) and hand off the part where you'd actually, you know, *write the code*. Because, well, who codes any more anyway?!

Under the hood it's a **harness**: a set of Claude Code skills wrapping the delivery loop (issue → spec → build → review → ship) in fixed contracts and gates. It won't make the model a better engineer. It makes it **safe to stop watching**, one step at a time.

The **levels** aren't a faff feature. They're *how far you've wandered off from the loop*. One question sorts them: **who's running it, and what's keeping it from spontaneous robot combustion while your back's turned?**

| Level | You're | Loop run by | What keeps it honest | Entry point |
|---|---|---|---|---|
| **L1 · as** the loop | the engineer | **you** | well… you | `/faff-wtf`, `/faff-map`, `/faff-tidy`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2 · in** the loop | a step inside it | the agent | your nod at every gate | `/faff-graft` |
| **L3 · on** the loop | watching from the sofa | the agent | park protocol + run-ledger | `/faff-beep-boop` |
| **L4 · out** of the loop | off down the pub | the agent | adversarial review + isolated holdout | lights-out (frontier) |

- **L1 · as the loop.** *You* write the code, your usual IDE agents along for the ride. faff plays planning exoskeleton here: it tells you what's worth building, hands you a spec worth building from, then gets out of the way.
- **L2 · in the loop.** `/faff-graft` drives the build for one issue but stops at every gate (spec, build, review, PR) for your say-so. Nothing ships behind your back.
- **L3 · on the loop.** `/faff-beep-boop` chews through the ready queue unattended and **parks** anything it can't call. The safety net isn't you staying awake, it's mechanical: the park protocol never quietly bins a loose end, and the run-ledger refuses to call a run "done" if it left admitted work dangling.
- **L4 · out of the loop.** Lights-out. You've left the building entirely, and correctness is held up by *adversarial* machinery: a second model trying to break the change, isolated holdout worktrees marking the work against a spec it never got to peek at. The frontier. Not built yet, mind.

Two knobs cut across all four levels. They're not levels themselves:

- **Slots** decide *what* runs at each stage (a beefier spec, a harsher reviewer, a parallel build). Swap them to customise *any* level, or bring your own — they tune what a level does, not which level you're at (that's which command you reach for).
- **Appetite** (for Destruction) sets *how much rope* the pipeline gets before checking back. More isn't always better: it buys speed against the odd "oops, wrong call, revert that."

## Install

```
/plugin marketplace add shftwst/faff
/plugin install faff@faff
```

## Your first five minutes

1. **Tell it where your stuff lives.** Drop a `.faffrc` at your repo root (see [Setup](#setup) — three lines is enough).
2. **Got a new idea or an empty repo?** Run `/faff-jot`. It chats through what you're building and turns it into tickets. Already have a backlog? Skip to step 3.
3. **Not sure what to do?** Run `/faff-wtf` — it tells you what shipped, what's stuck, and what to pick up.
4. **Picked something?** Run `/faff-prep ISSUE-XX` to turn it into a spec, then `/faff-graft ISSUE-XX` to build it.
5. **Want it all done while you sleep?** Run `/faff-beep-boop` and check the results in the morning.

Each step offers to chain into the next, so you can just keep saying yes. That's the whole loop.

> The skills come in tiers — `faff-*` are the commands you type; the `faffter-*` and `faffidavit-*` ones are the swappable bits doing the work behind them. You can ignore all of that until you want to plug in your own tools — see [the appendix](#appendix-skill-families-qualifiers-and-swapping).

## Starting from nothing: idea → tickets

No backlog yet — an empty repo or a fresh idea. `/faff-jot` is the front door; it turns a loose starting point into well-formed tickets the rest of the loop can pick up. (Output illustrative.)

**1. Point faff at your tracker** — the three-line `.faffrc` from [Setup](#setup).

**2. `/faff-jot` — describe what you want.** It runs a short discovery conversation, then shapes tickets (it asks before creating anything):

```
You: a CLI that lints our YAML configs and prints fixable diffs

jot: A few questions… (which formats? fix-in-place or report-only? CI mode?)
     → Shaped 3 tickets under a new "yaml-lint" workstream:
       SHF-1  parse + validate a config file        (first slice)
       SHF-2  render a fixable diff                  (blocked-by SHF-1)
       SHF-3  --fix to apply diffs in place          (blocked-by SHF-2)
     Create these 3 tickets? (yes / edit / no)
```

`y` → they're created in your tracker, tagged so prep picks them up. Then it chains: *"Prep the first one for build now? (y/n)"* — say yes and you're into the build loop below.

**Bigger than a feature?** If you describe a whole application, jot spots the scale and offers the top-down route instead:

```
jot: This looks application-scale — decompose into a full roadmap
     (initiatives → projects → first-slice epics) via /faff-plot first? (y/n)

y → /faff-plot  recurses it level by level, confirming each:
     Initiative: Billing  →  Projects: Invoicing, Dunning, Reporting
       Invoicing  →  first-slice epics: SHF-10 issue model, SHF-11 PDF render …
     (stops at first-slice epics — the leaves grow later from specs)
     Audit the roadmap via /faff-map? · Prep the first slice via /faff-prep? (y/n)
```

Either way you end up with tickets in Todo and a chain into prep. From here it's the same loop:

## A first run, start to finish

What the loop looks like once you have tickets — whether jot just made them or you already had a backlog. (Output is illustrative — yours will name your issues.)

**1. Point faff at your tracker** — the three-line `.faffrc` from [Setup](#setup).

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
Start building now via /faff-graft? (y/n)
```

**4. `y` → `/faff-graft SHF-40` — build it.** Graft sets up a worktree, commits the spec, and gets out of your way; you pair with it from there:

```
Worktree ready at ~/.faff/worktrees/faff/SHF-40. Spec committed as the first commit.
Building to the spec — 3 ACs, tests alongside.
```

When it's done it verifies the ACs, runs review, waits for CI, and (interactively) asks before merging.

**5. `/faff-beep-boop` — or let it run the lot unattended.** Same loop, no babysitting: it grooms, specs, and builds the ready queue, parking anything ambiguous for `/faff-wtf` to show you in the morning.

Each step offers to chain into the next — `wtf → prep → graft` — so on a good day you just keep saying yes.

## Commands

| Command | What it does |
|---------|-------------|
| `/faff` | "What should I work on?" (default) |
| `/faff-jot` | Start something new — kick off an empty project, or capture a feature/bug/idea, and turn it into a sensible set of tickets |
| `/faff-plot` | Decompose an application-scale idea top-down into a roadmap — initiatives → projects → first-slice epics |
| `/faff-wtf` | Where to focus — what shipped, what's stuck, what's next |
| `/faff-map` | The strategic roadmap view above wtf — outcomes, workstreams, dependency chains, and whether the plan joins up |
| `/faff-tidy` | Tidy the backlog — find the mess, clean, and surface what's ready to pick up |
| `/faff-prep ISSUE-XX` | Turn a vague ticket into a buildable spec |
| `/faff-graft ISSUE-XX` | Set up a worktree and start building |
| `/faff-beep-boop` | Unattended run — drain the ready queue overnight, park anything ambiguous for morning review |

## How it works

```
new idea / project → tickets → "what should I work on?" → prep it → build it
                                       ↑                                |
                                       └────────── reprep ←─────────────┘
```

`/faff-jot` is the front door — everything else acts on tickets that already exist, and jot (or `/faff-plot`, for a whole application) is how they come to exist. From there each step chains to the next behind a yes/no gate: say yes, keep moving; say no, stop. No ceremonies, no standups with 12 people — just you and your code.

### Fire and forget

`/faff-beep-boop` runs the whole pipeline without a human in the loop. Good for overnight, meetings, or anything you want off your plate.

- Default: the whole shebang — tidy, then prep every backlog issue, then build whatever's ready
- `ISSUE-12 ISSUE-15`: just those
- Cap the run with `--until 06:00` (stop at a wall-clock time) or `--max 5` (stop after N builds) — the queue drains in priority order and whatever's unreached is left for the next run

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
slots:
  intake: superpowers:brainstorming   # how /faff-jot runs discovery
  spec: gstack:autoplan               # how /faff-prep writes specs
  review: gstack:review               # pre-PR review
  ship: gstack:land-and-deploy        # merge/deploy
```

All slots are optional — unset just means "use ours". Copy `.faffrc.example.yaml` for the full list of knobs.

## Levelling up

The levels (top of this README) are *positions relative to the loop*, not config you switch on. Moving up is mostly about **which command you reach for** and how far you trust it. The minimum `.faffrc` ([Setup](#setup)) is all any level strictly needs.

- **L1 · as the loop.** You run it. `/faff-wtf` to see what's worth doing, `/faff-prep` then `/faff-graft` to spec and build by hand; `/faff-jot` (or `/faff-plot` for a whole application) to bring new work in. Nothing runs unwatched. New to it? Set `appetite: medium` while you build trust.
- **L1 → L2 · in the loop.** Hand a *step* to the agent: `/faff-graft ISSUE-XX` drives one build but stops at every gate (spec, build, review, PR) for your nod. No config to change — it's a command you run, not a mode.
- **L2 → L3 · on the loop.** Hand the *whole loop* over: `/faff-beep-boop` grooms, specs, and builds the ready queue unattended. Still no required config — what keeps it honest is mechanical and always on (park protocol + run-ledger). Cap a run with `--until 06:00` or `--max 5`; review the parked pile via `/faff-wtf` after.
- **L3 → L4 · out of the loop.** Lights-out, correctness held up by isolated/adversarial verification. The frontier — not built yet.

**The two cross-cutting knobs** (they tune *any* level — they aren't levels themselves):

- **Appetite** — `appetite: low|medium|high|full` (default `high`): how much rope before it checks back. Lower while learning; the default suits unattended runs.
- **Slots** — swap faff's defaults for opinionated or third-party doing-skills (parallel builds, an agile lens, an adversarial reviewer, your own spec/review tools). Most payoff once you're *on* the loop, but legal anywhere. See [Setup](#setup) and the [Appendix](#appendix-skill-families-qualifiers-and-swapping). A non-default occupant is automatically checked for conformance before first use — no flag to set.

## The `faff` CLI

A small command-line tool ships **inside the faff plugin** — `faff`, a single dependency-free Node script (no `npm install`, no `node_modules`, no build — just `node`). The skills and hooks invoke it for themselves — each resolves it as `command -v faff` if it's on `PATH`, otherwise from its own install location (`${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff` when running as a plugin, or the sibling `faff/bin/faff` when dev-linked) — so **normal use needs no setup**. A few subcommands are handy to run by hand, though:

```
faff config get <dotted.key> [-d DEFAULT]   # read a value from your .faffrc
faff config spec-docs-path [--create]       # resolve where specs are committed
faff runcheck [--hook]                      # audit the latest beep-boop run ledger for undispatched work
faff validate-adapters                      # lint the shipped slot skills for conformance drift (CI / pre-commit)
faff validate-adapters --configured         # pre-flight YOUR configured slot occupants before an unattended run
```

**Running it by hand.** The binary lives at `plugin/skills/faff/bin/faff` inside the installed plugin. Locate it and (optionally) symlink it onto your `PATH` once:

```
faffbin=$(find ~/.claude -path '*/skills/faff/bin/faff' -type f 2>/dev/null | head -1)
ln -s "$faffbin" ~/.local/bin/faff          # then add ~/.local/bin to PATH if it isn't already
export PATH="$HOME/.local/bin:$PATH"
```

Or just call it by that full path. (Inside skills and hooks it's resolved automatically — `command -v faff` first, then the install-relative path — so you never have to set this up for normal use.)

## Agent lanes

Faff operates across three segregated executor lanes with controlled visibility:

| Lane | Role | Sees | Doesn't see |
|---|---|---|---|
| **Orchestrator** | Pipeline sequencing, external interface (tracker, human, reporting) | Tracker, docs, codebase (read) | — |
| **Implementor** | Architecture, spec interpretation, code, tests | Codebase (read/write), spec | Tracker, human dialogue |
| **Evaluator** *(future, L4)* | Quality control from business-value perspective | Spec, running environment | Codebase |

Isolation is by design — the implementor can't mark its own homework, and (once built) the evaluator can't be biased by implementation approach. **Today only the orchestrator and implementor lanes are active**; the evaluator lane is a documented-but-future L4 capability. See the gateway docs for details.

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
| `faffter-noon-review` | `review` | The implicit default. Senior-engineer code review — AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging. Emits its `faff-contract:review-verdict` block (pass/fail/needs-human) that faff-graft parses. |
| `faffter-noon-intake` | `intake` | The implicit default intake producer. Runs new-work discovery for `/faff-jot` (greenfield project or single feature/bug) and emits a discovery brief. The light counterpart to ideation skills like `superpowers:brainstorming`. |
| `faffter-noon-spec` | `spec` | The implicit default spec producer. Issue context in, a spec following the lite nlspec arc (WHY/WHAT/HOW/DONE) out. The light counterpart to `faffter-dark-nlspec`. |
| `faffter-noon-concurrency-sequential` | `concurrency` | The implicit default build-pass executor. Runs `/faff-beep-boop`'s queue one `/faff-graft` at a time over the conflict-analysis partition — no worktree contention, no merge races. The safe counterpart to `faffter-dark-concurrency-parallel`. |
| `faffter-noon-ship` | `ship` | The implicit default delivery producer. Merges a gate-cleared PR (`gh pr merge --squash`), with a no-op deploy-readiness check — emits its `faff-contract:delivery-outcome` block, which faff-graft parses onto shipped/not-ready/failed. Swap for a deploy-capable producer (e.g. `gstack:land-and-deploy`) when delivery means more than a merge. |

### faffidavit-* (adaptors)

Adaptor skills. Faff-core fixes the **internal contracts** the pipeline branches on — verdict states, vocabularies, classifications — in the gateway, where they never move. The `spec` / `review` / `ship` contracts are **producer-emitted** (FAFF-109): the producer self-declares its contract data as a `faff-contract:<name>` block, and the consumer (faff-prep, faff-graft) parses it and calls `faff contract <name>` directly — no adaptor in between (their `spec_adaptor` / `review_adaptor` / `ship_adaptor` slots were retired). Two adaptor skills remain: `faffidavit-routing` sits in front of the fixed automation-routing verdict (a computed verdict, no producer authors it), and `faffidavit-rendering` is a pure adaptor with no internal contract (rendering is human-facing only), swappable end to end. Both are usable standalone, not just inside the pipeline.

| Skill | Slot | What it does |
|---|---|---|
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
| `faffidavit-*` | an *affidavit*, an attestation | Adaptors (`faffidavit-routing`, `faffidavit-rendering`). Translate/normalise output the pipeline branches on, and attest conformance. The spec/review/ship contracts are producer-emitted (FAFF-109) — the producer self-declares a `faff-contract:<name>` block the consumer parses, no adaptor between. |

The `faffter-*` qualifier says how safe the variant is: **`-noon-*`** (broad daylight) ships on by default, conservative; **`-dark-*`** (the dark factory) is an override/experimental swap-in, heavier and lights-out-leaning. The trailing function (`-spec`, `-review`, …) names the slot — same function, same slot: `faffter-noon-spec` and `faffter-dark-nlspec` are both `spec` producers, pick one.

### Two kinds of slot

- **Doing-slots** (`intake`, `spec`, `review`, `methodology`, `concurrency`, `ship`) hold a skill that *does work*. Swap to change behaviour. The `spec` / `review` / `ship` producers self-declare their contract data as a `faff-contract:<name>` block the consumer (faff-prep, faff-graft) parses and pipes to `faff contract <name>` directly — no adaptor between (FAFF-109 retired the `spec_adaptor` / `review_adaptor` / `ship_adaptor` slots). A foreign producer conforms by emitting the same block, or is wrapped via `faffter-dark-authoring-adaptors`.
- **Adaptor-slots** (`routing_adaptor`, `rendering_adaptor`) hold a skill that *translates and attests*. `routing_adaptor` sits in front of the fixed automation-routing verdict (computed — no producer authors it); `rendering_adaptor` has no fixed contract (human-facing only). Swap to change the surface dialect/display, never the contract.

The pipeline hardcodes the contract so it always has something stable to branch on; the slot holds the translator so anyone's output can be made to fit.

### Swap in a third-party doing-skill

```yaml
slots:
  spec: gstack:autoplan        # third-party spec producer
  review: gstack:review        # third-party reviewer
```

It must **honour the slot's contract** — a `spec` maps decisions onto closed/open/external + a confidence line; a `review` resolves to `pass`/`fail`/`needs-human` — and **emit its `faff-contract:<name>` block** so the consumer parses it deterministically. A producer whose native tool can't emit the block is wrapped (see below). A missing slot is never a park reason — unset means "use ours".

### Adapt a producer whose output doesn't fit (FAFF-22)

If a third-party `spec` / `review` / `ship` producer speaks a different dialect — a reviewer emitting `APPROVED`/`REJECTED`/`BLOCKED` — don't touch faff-core or fork the pipeline. Conformance is **producer-emitted** (FAFF-109): the producer must emit a `faff-contract:<name>` block (`spec-readiness` / `review-verdict` / `delivery-outcome`) the consumer pipes to `faff contract <name>`. If the producer can't emit it itself, wrap it:

```yaml
slots:
  review: somevendor:critic                # emits APPROVED/REJECTED/BLOCKED
```

Run **`faffter-dark-authoring-adaptors`** — the fused-wrapper authoring tool. It scaffolds a conformant producer (or a wrapper around a foreign one) that **translates** native output (`APPROVED → pass`, honouring the coercion rule — an unparseable verdict goes to `needs-human`, never silently to `pass`) and **emits the `faff-contract:review-verdict` block** the consumer parses. It carries **refer-back prose** so it finds the contract when invoked standalone (skills load independently — the gateway isn't always in context). There is no separate `review_adaptor` slot to point at any more — the wrapper *is* the producer, and the deterministic `faff contract <name>` script does the conformance attestation the old adaptor used to.

`rendering_adaptor` is the exception — no fixed contract behind it (rendering is human-facing; nothing branches on how output looks), so swap `faffidavit-rendering` to change house style end to end.

## Credits

The nlspec format used by `faffter-dark-nlspec` draws on [NLSpec-Spec](https://github.com/TG-Techie/NLSpec-Spec) by TG-Techie, licensed under Apache 2.0. See `NOTICE`.

## License

Apache 2.0
