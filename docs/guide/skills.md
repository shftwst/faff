# Skills & slots

The full skill catalogue, the slot model, and how to swap in your own or a third-party doing-skill. Skip this unless you want to customise what runs at a stage or plug in another tool.

## The four tiers

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
| `faffter-noon-methodology-thematic` | `methodology` | The implicit default. Pure structural analysis — ordering by priority + unlock value, graph-level diagnostics (cycles, chain gaps, ghost pointers, repeat-parks), promotion/demotion by spec readiness. No opinions about value, risk, or right-sizing. |
| `faffter-noon-review` | `review` | The implicit default. Senior-engineer code review — AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging. Emits its `faff-contract:review-verdict` block (pass/fail/needs-human) that faff-graft parses. |
| `faffter-noon-intake` | `intake` | The implicit default intake producer. Runs new-work discovery for `/faff-jot` (greenfield project or single feature/bug) and emits a discovery brief. The light counterpart to ideation skills like `superpowers:brainstorming`. |
| `faffter-noon-spec` | `spec` | The implicit default spec producer. Issue context in, a spec following the lite nlspec arc (WHY/WHAT/HOW/DONE) out. The light counterpart to `faffter-dark-nlspec`. |
| `faffter-noon-concurrency-sequential` | `concurrency` | The implicit default build-pass executor. Runs `/faff-beep-boop`'s queue one `/faff-graft` at a time over the conflict-analysis partition — no worktree contention, no merge races. The safe counterpart to `faffter-dark-concurrency-parallel`. |
| `faffter-noon-ship` | `ship` | The implicit default delivery producer. Merges a gate-cleared PR (`gh pr merge --squash`), with a no-op deploy-readiness check — emits its `faff-contract:delivery-outcome` block, which faff-graft parses onto shipped/not-ready/failed. Swap for a deploy-capable producer (e.g. `gstack:land-and-deploy`) when delivery means more than a merge. |
| `faffter-noon-architecture` | `architecture` | The implicit default architecture proposer. Reads the brief/spec + the acquired infra profile and proposes one best-fit, production-grade architecture, emitting a `faff-contract:architecture-proposal` block. Invoked by faff-prep's conditional architecture step on new-runnable-surface work only; the proposal lands verbatim in the attached spec, where the spec-review architectural lens and the holdout env step read it. |

### faffidavit-* (adaptors)

The `faff` core fixes the **internal contracts** the pipeline branches on, including verdict states, vocabularies, and classifications. They live in the gateway, where they never move. The `spec` / `review` / `ship` contracts are **producer-emitted**: the producer self-declares its contract data as a `faff-contract:<name>` block, and the consumer (faff-prep, faff-graft) parses it and calls `faff contract <name>` directly. Two adaptor skills remain: `faffidavit-routing` sits in front of the fixed automation-routing verdict (a computed verdict, no producer authors it), and `faffidavit-rendering` is a pure adaptor with no internal contract (rendering is human-facing only), swappable end to end. Both are usable standalone, not just inside the pipeline.

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
| `faffter-dark-methodology-agile-delivery` | `methodology` | Agile delivery methodology lens — seven principles (outcome-named workstreams, value × risk sequencing, WIP caps, right-sized tickets, cohesive workstreams, surfaced deps, risk-aware ordering). An opinionated alternative to the thematic default. |
| `faffter-dark-concurrency-parallel` | `concurrency` | Concurrent build-pass executor — runs independents in parallel, each in its own worktree, capped at `concurrency_max`, with rebase-before-merge so a moving `main` can't merge stale-green. Replaces the sequential default for speed. |
| `faffter-dark-authoring-adaptors` | — (tooling) | Author/validate skill for slot occupants. Scaffolds a new adaptor/producer/methodology with the correct refer-back prose + contract mapping, and validates that an existing slot skill conforms. A development-time tool, not a pipeline slot. |

Some of these skills (`adversarial-review`) can be configured to use a different model, with provider settings per-slot in `.faffrc.yaml`. Transport families supported: `ollama`, any OpenAI-compatible `/v1` endpoint (`openai`, `vllm`, `openrouter`, `nvidia`, `deepseek`, and `gemini` via Google's OpenAI-compat base URL), and `anthropic` (native `/v1/messages`):

```yaml
faffter_dark:
  adversarial:
    provider: nvidia
    model: deepseek-ai/deepseek-v4-pro
    host: https://integrate.api.nvidia.com/v1   # base URL incl. /v1
    api_key_env: NVIDIA_API_KEY                 # env var NAME, not the key
    reasoning_off: true                         # reasoning models: disable the hidden think-block
```

`gemini` rides the OpenAI-compat family (set `host` to Google's compat base URL — no adaptor needed); `anthropic` has a native `/v1/messages` transport. The core principle is **independence** — use a different model family from whatever wrote the code, so **don't set `provider: anthropic` when Claude authored/reviewed the diff**. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.

## The naming convention

Every name is `family[-qualifier]-function`.

| Family | Reads as | What it is |
|---|---|---|
| `faff-*` | the faff before work | Pipeline. The slash commands — sequence, gates, tracker/human talk. Delegates the doing. (The "what".) |
| `faffter-*` | *after* faff | Doing-skills. Inputs in, outputs out — produce a spec, run a review, analyse a backlog. (The "how".) |
| `faffidavit-*` | an *affidavit*, an attestation | Adaptors (`faffidavit-routing`, `faffidavit-rendering`). Translate/normalise output the pipeline branches on, and attest conformance. The spec/review/ship contracts are producer-emitted — the producer self-declares a `faff-contract:<name>` block the consumer parses, no adaptor between. |

The `faffter-*` qualifier says how safe the variant is: **`-noon-*`** (broad daylight) ships on by default, conservative; **`-dark-*`** (the dark factory) is an override/experimental swap-in, heavier and lights-out-leaning. The trailing function (`-spec`, `-review`, …) names the slot — same function, same slot: `faffter-noon-spec` and `faffter-dark-nlspec` are both `spec` producers, pick one.

## Two kinds of slot

- **Doing-slots** (`intake`, `spec`, `review`, `methodology`, `concurrency`, `ship`) hold a skill that *does work*. Swap to change behaviour. The `spec` / `review` / `ship` producers self-declare their contract data as a `faff-contract:<name>` block the consumer (faff-prep, faff-graft) parses and pipes to `faff contract <name>` directly. A foreign producer conforms by emitting the same block, or is wrapped via `faffter-dark-authoring-adaptors`.
- **Adaptor-slots** (`routing_adaptor`, `rendering_adaptor`) hold a skill that *translates and attests*. `routing_adaptor` sits in front of the fixed automation-routing verdict (computed — no producer authors it); `rendering_adaptor` has no fixed contract (human-facing only). Swap to change the surface dialect/display, never the contract.

The pipeline hardcodes the contract so it always has something stable to branch on; the slot holds the translator so anyone's output can be made to fit.

## Swap in a third-party doing-skill

```yaml
slots:
  spec: gstack:autoplan        # third-party spec producer
  review: gstack:review        # third-party reviewer
```

It must **honour the slot's contract** — a `spec` maps decisions onto closed/open/external + a confidence line; a `review` resolves to `pass`/`fail`/`needs-human` — and **emit its `faff-contract:<name>` block** so the consumer parses it deterministically. A producer whose native tool can't emit the block is wrapped (see below). A missing slot is never a park reason — unset means "use ours".

## Adapt a producer whose output doesn't fit

If a third-party `spec` / `review` / `ship` producer speaks a different dialect — a reviewer emitting `APPROVED`/`REJECTED`/`BLOCKED` — don't touch faff-core or fork the pipeline. Conformance is **producer-emitted**: the producer must emit a `faff-contract:<name>` block (`spec-readiness` / `review-verdict` / `delivery-outcome`) the consumer pipes to `faff contract <name>`. If the producer can't emit it itself, wrap it:

```yaml
slots:
  review: somevendor:critic                # emits APPROVED/REJECTED/BLOCKED
```

Run **`faffter-dark-authoring-adaptors`** — the fused-wrapper authoring tool. It scaffolds a conformant producer (or a wrapper around a foreign one) that **translates** native output (`APPROVED → pass`, honouring the coercion rule — an unparseable verdict goes to `needs-human`, never silently to `pass`) and **emits the `faff-contract:review-verdict` block** the consumer parses. It carries **refer-back prose** so it finds the contract when invoked standalone (skills load independently — the gateway isn't always in context). The wrapper *is* the producer, and the deterministic `faff contract <name>` script does the conformance attestation.

`rendering_adaptor` is the exception — no fixed contract behind it (rendering is human-facing; nothing branches on how output looks), so swap `faffidavit-rendering` to change house style end to end.
