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

## Commands

| Command | What it does |
|---------|-------------|
| `/faff` | "What should I work on?" (default) |
| `/faff-wtf` | Where to focus — what shipped, what's stuck, what's next |
| `/faff-tidy` | Tidy the backlog — find the mess, clean, and surface what's ready to pick up |
| `/faff-prep ISSUE-XX` | Turn a vague ticket into a buildable spec |
| `/faff-workit ISSUE-XX` | Set up a worktree and start building |
| `/faff-beep-boop` | Unattended run — drain the ready queue overnight, park anything ambiguous for morning review |

## How it works

```
"what should I work on?" → prep it → build it
                             ↑            |
                             └── reprep ←─┘
```

1. **WTF** — what shipped, what's blocked, what to focus on
2. **Prep** — explore the codebase, write a spec, attach it to the ticket
3. **Workit** — spec is committed to a feature branch, worktree is ready, go

Each step chains to the next with a yes/no gate. Say yes, keep moving. Say no, stop.

No ceremonies. No standups with 12 people. Just you and your code.

### Fire and forget

`/faff-beep-boop` runs the whole pipeline without a human in the loop. Good for overnight, meetings, or anything you want off your plate.

- Default: the whole shebang — tidy, then prep every backlog issue, then build whatever's ready
- `--ready`: build-only pass over Todo issues that already have a spec
- `ISSUE-12 ISSUE-15`: just those

Auto-merges when every acceptance criterion is verified, CI is green, and review passed. Otherwise the PR is left open with a clear reason. Anything ambiguous is parked and surfaced by `/faff-wtf` in the morning. Full audit trail under `.faff/runs/`.

## Setup

Works with Linear, GitHub Issues, Jira, or any issue tracker exposed via MCP. Falls back to git-only mode when no tracker is available.

Add a **Project Tracking** section to your project's `CLAUDE.md`:

```markdown
## Project Tracking

- **Issue tracker:** Linear, team key `PROJ`
- **Git host:** github.com/org/repo
```

Optional:

```markdown
- **Milestones:** v1.0 target 2026-05-01
- **Labels:** `urgent` = drop everything, `blocked` = needs external input

## Planning Skills
- spec: gstack:autoplan
- parallel: superpowers:subagent-driven-development
- review: gstack:review
- ship: gstack:ship
```

All planning slots are optional. Faff has sensible defaults for each — slots let you swap in your own.

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
| `faffter-noon-spec` | `spec` | The implicit default spec producer. Issue context in, a spec following the lite nlspec arc (WHY/WHAT/HOW/DONE) out. The light counterpart to `faffter-dark-nlspec`. |

### faffidavit-* (adaptors)

Adaptor skills. Faff-core fixes the **internal contracts** the pipeline branches on — verdict states, vocabularies, classifications — in the gateway, where they never move. Each faffidavit skill is the **default adaptor** that sits in front of one of those fixed contracts: it translates a producer's native output *into* the contract and validates conformance. Swapping the slot swaps the translator, never the contract — which is what lets a third-party producer or reviewer plug in. `faffidavit-language` is the exception: rendering has no internal contract (it's human-facing only), so it's a pure adaptor swappable end to end. All are usable standalone, not just inside the pipeline.

| Skill | Slot | What it does |
|---|---|---|
| `faffidavit-spec` | `spec_adaptor` | The default adaptor over the fixed spec-readiness contract (closed/open/external classification + confidence, in the gateway). Owns the canonical markers (Chosen/Punt/Assumes), marker rules, skimmable writing style, and the confidence line's format; validates any spec (pass/fail + violations). All spec producers conform; faff-prep delegates its pre-attach validation here. |
| `faffidavit-review` | `review_adaptor` | The default adaptor over the fixed review-verdict contract (pass/fail/needs-human, semantics, revert test — in the gateway). Owns the output envelope every reviewer returns and normalises raw output onto the three states; validates review output on demand. Swap it to adapt a third-party reviewer — faff-workit still branches on the same three states. |
| `faffidavit-routing` | `routing_adaptor` | The default adaptor over the fixed automation-routing contract (the closed six verdicts + admission rule + root-cause taxonomy — in the gateway). Owns verdict assignment, computation locus, and display format; assigns and validates verdicts. The contract survives a `methodology` swap because it lives in faff-core, not inside the methodology. |
| `faffidavit-language` | `language_adaptor` | The default — and a **pure adaptor** with no internal contract behind it, since rendering is human-facing only. Owns the rendering style (visual vs prose, the catalogue of canonical visual forms, the table-vs-list rule, density caps) plus the synthesis issue-gloss humanisation; validates/normalises draft output. All sub-skills render through this; swap it to change house style wholesale. |

### faffter-dark-* (experimental)

Pluggable skills that either add new behaviour or change the default behaviour of faff, moving towards a dark factory workflow.

| Skill | Slot | What it does |
|---|---|---|
| `faffter-dark-nlspec` | `spec` | Full nlspec-format spec generation — formal type definitions, pseudocode procedures, closed-loop DoD, appendices. Heavier than the built-in lite arc. |
| `faffter-dark-adversarial-review` | `review` | Two-phase review: runs `faffter-noon-review` first, then sends the diff to a different LLM for a structurally independent second opinion. Replaces the default review. |
| `faffter-dark-methodology-agile-delivery` | `methodology` | Agile delivery methodology lens — seven principles (outcome-named workstreams, value x risk sequencing, WIP caps, right-sized tickets, cohesive workstreams, surfaced deps, risk-aware ordering). Replaces the old `mode: delivery-lead` config. |

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

- **Doing-slots** (`spec`, `review`, `methodology`, `parallel`, `ship`) hold a skill that *does work*. Swap to change behaviour.
- **Adaptor-slots** (`spec_adaptor`, `review_adaptor`, `routing_adaptor`, `language_adaptor`) hold a skill that *translates and attests*. What it translates *into* — the verdict states, vocabularies, classifications the pipeline gates on — is a **fixed contract in faff-core** and never moves. Swap to change the surface dialect (envelope, markers, display), never the contract.

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

An adaptor does three things: **names** the fixed contract (gateway → _Core contracts and adaptor slots_; never redefines it), **translates** native output into it (`APPROVED → pass`, honouring the coercion rule — an unparseable verdict goes to `needs-human`, never silently to `pass`), and **validates** (returns `pass`/`fail` + violations so the pipeline never acts on a malformed result). Any `faffidavit-*` skill is a copyable template: `## Internal contract (fixed — see gateway)` → `## Adaptor` → `## Validate`.

`language_adaptor` is the exception — no fixed contract behind it (rendering is human-facing; nothing branches on how output looks), so swap `faffidavit-language` to change house style end to end.

## License

MIT
