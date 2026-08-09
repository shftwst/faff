---
name: faffter-dark-authoring-adaptors
description: "Author or validate a faff slot skill. Scaffolds a new adaptor/producer/methodology so it carries the correct refer-back prose and maps onto the fixed gateway contract, and validates that an existing slot skill conforms. Use for 'write a new adaptor', 'author a spec/review/routing/rendering skill', 'check my adaptor conforms', 'validate this slot skill'."
judgement_seam: none
---

# faffter-dark-authoring-adaptors

The author/validate skill for **slot occupants** — anything you plug into a `slots` slot: an adaptor (`routing_adaptor`, `rendering_adaptor`), a producer (`intake`, `spec`, `review`, `ship`), a `methodology`, or a **mechanism** (`concurrency`). The `spec` / `review` / `ship` contracts are **producer-emitted** (their adaptor slots were retired): a bespoke producer conforms by emitting the standard `faff-contract:<name>` block its consumer parses — and **this skill is how you wrap a producer whose native tool can't emit that block** (the fused-wrapper path: the wrapper emits the block on the producer's behalf). It exists to close the binding gap: slots are swappable, so a replacement skill must carry — *on its own* — the prose that lets it find and conform to the fixed contract it sits in front of. A shipped default does this by convention; a hand-written replacement easily forgets, and then nothing in the running system reminds it. This skill is that reminder, in two faces.

This is a `faffter-dark-*` skill — advanced tooling, not part of the day-to-day pipeline. You invoke it when writing or auditing a slot skill, not during normal faff use.

## Why this skill exists (the binding problem)

Skills load independently. When a slot skill runs — as a delegated slot, or standalone — the sibling `faff/SKILL.md` is **not** guaranteed to be in context. The faff suite handles this with three mechanisms (see gateway → _Core contracts and adaptor slots → Contract loading & conformance_):

1. fixed consumers load the gateway on entry, so a slot they delegate to inherits the contract ambiently;
2. a standalone-invoked slot skill **reads the gateway itself** before applying a contract;
3. **this skill** ensures a *new* slot occupant is written so (2) actually happens — that it refers back rather than silently relying on a copy that can drift or be swapped away.

A slot skill that omits the refer-back prose is a latent bug: it works as a delegated slot (inherits context) but is wrong standalone, and it invites someone to treat its local recap as the source of truth.

## Two faces

- **Author** (scaffold): given a target slot and a description, produce the skeleton of a conformant slot skill — with the refer-back prose, the two-face structure, and the map-onto-fixed-contract section already in place. The author fills in the dialect. Write the prose **to the skill-authoring charter** (`docs/reference/skill-authoring.md`) — lean, deduplicated, skimmable — whose lintable subset `faff validate-adapters` enforces.
- **Validate** (audit): given an existing slot skill (by name or path), check it against the conformance checklist below and return `pass` / `fail` + specific violations. Run it before adopting a third-party slot skill, in CI over the shipped ones, or **at runtime** — the pipeline **always** invokes this face on a configured **foreign** occupant (one not in `REGISTRY`; a bundled `faffter-*` occupant is exempt by the `--is-bundled` predicate) before first use and parks/surfaces on `fail` (gateway → _Slot conformance validation_).

## The fixed contract each slot maps onto

A slot occupant never owns the contract — it owns its *dialect* and maps onto the gateway's fixed contract. Which contract depends on the slot:

| Slot | Fixed contract it maps onto (gateway §) | What the occupant owns (its dialect) |
|---|---|---|
| `routing_adaptor` | Automation-routing verdict — the six verdicts + admission rule + root-cause enum | verdict assignment, computation locus, display format |
| `rendering_adaptor` | **none** (pure adaptor) — rendering has no fixed contract | the entire rendering style; self-contained, no refer-back needed |
| `methodology` | The `methodology` slot — the named-output contract (which outputs, required/optional, the envelope) | the lens (graph-structural, opinionated, …) that answers each output |
| `spec` / `review` / `ship` (producers) | Spec readiness / Review verdict / Delivery outcome — the producer **emits** a `faff-contract:<name>` block (`spec-readiness` / `review-verdict` / `delivery-outcome`) the consumer parses; no paired adaptor | how the work is done + the self-declared contract block; a producer that can't emit it is wrapped here |
| `intake` (producer) | none — emits a documented discovery brief directly | how discovery is done; the brief shape |
| `concurrency` (mechanism) | Mechanism slots → _The `concurrency` slot contract_ — build every partition issue, serialise + require a dependency blocker to have merged, record terminal outcomes to the ledger (with the `pr-open-for-human`→`pr-open` mapping), never weaken the merge gate | the execution strategy (sequential, capped-parallel, …) + worktree isolation and any merge re-validation |

`rendering_adaptor` is the one exception — it carries no refer-back because there is no fixed contract behind it; it is the source of truth for rendering. Every other slot refers back.

## Conformance checklist (what Validate checks, what Author bakes in)

1. **Names its slot and contract.** The skill states which slot it occupies and which gateway contract section it maps onto (from the table above). A `rendering_adaptor` states it has none.
2. **Carries refer-back prose.** A "How this contract reaches you" note that: (a) says the invoking consumer loads the gateway so the contract is ambient when run as a slot, and (b) instructs **Read the sibling `faff/SKILL.md` → _<the named §>_ now** when invoked standalone. (`rendering_adaptor` exempt.)
3. **Recaps are non-normative.** Any restatement of the fixed vocabulary/classes/verdicts is explicitly marked non-normative with "gateway wins on any conflict." No copy is presented as authoritative.
4. **Maps onto, never redefines.** The skill does not add, remove, narrow, or rename the fixed vocabulary/classes/verdicts/named-outputs. It only translates its native dialect onto them. (A reviewer needing a fourth verdict state, a spec format with a fourth decision class, a methodology dropping a required output → non-conformant.)
5. **Has both faces / honours its obligations where the slot expects them.** Adaptors define + validate. Producers produce + **emit their `faff-contract:<name>` block** (or, if their native tool can't, are wrapped here so the wrapper emits it). A methodology answers the required named outputs (`pick-ordering`, `promotion-readiness`, `build-queue`, plus `backlog-diagnostics` which always fires) and degrades gracefully on the optional ones. A **mechanism** honours its action obligations (gateway → Mechanism slot): a `concurrency` occupant builds every partition issue, serialises + requires a dependency blocker to have merged, records every terminal outcome to the ledger, and never weakens the merge gate. A mechanism that skips/defers partition issues, weakens the gate, or shares a worktree across concurrent builds is non-conformant. (The `ship` producer is covered by the producer obligations above: it merges/deploys only gate-passed PRs and emits its `faff-contract:delivery-outcome` block, which the consumer parses onto the three fixed outcomes — never inventing a fourth.)
6. **Respects appetite.** If the slot acts (methodology, producers that mutate), it reads the suite-wide `appetite` dial rather than inventing its own agency level.
7. **Stays in its lane.** Adaptors translate/validate — they don't sequence, park, or write to the tracker. Producers do the work — they don't manage the backlog. The contract's *gate* and *sequencing* belong to the fixed consumer, not the slot.
8. **Declares its judgement seam.** The skill carries a `judgement_seam:` frontmatter key — the grader `KIND`(s) its LLM-judgement seam owns (an alternate occupant mirrors its slot sibling's), or `none` if it is asserted-deterministic. A skill that introduces or changes a seam registers a grader `KIND` + ≥1 eval case + the seam-registry row in the same change (recording the baseline value is the one human step, never required by the lint). `faff validate-adapters` fails a registry surface that declares no seam, and a `covered` KIND with no case.

## Author face

Given the target slot + a one-line description, emit a skeleton:

```
# <skill-name>

<one-line: what this <adaptor|producer|methodology> does and which slot it fills>

## Internal contract (fixed — see gateway)   ← omit for rendering_adaptor / producers; a mechanism points at Mechanism slots
Maps onto gateway → <named §>. Fixed there, unaffected by this swap: <one-line recap, non-normative>.

**How this contract reaches you.** Loaded by the invoking consumer when run as a slot; if invoked
standalone, Read the sibling `faff/SKILL.md` → <named §> now before applying. Gateway wins on any conflict.

## <Dialect>           ← the markers / envelope / assignment rules / lens / execution strategy this skill owns
## Validate            ← for adaptors: checks + the pass/fail envelope
## Rules
```

Fill the dialect; leave the contract pointers exactly as scaffolded.

## Validate face

Given a slot skill (name or path), read it and run the checklist. Output:

```
signal: pass | fail

## Violations
### [checklist item]: [where]
[what's wrong] → [the fix]
```

`pass` when no item fires. A missing refer-back note (item 2) or an authoritative-looking recap (item 3) is a `fail`, not a warning — those are exactly the drift/orphan bugs this skill exists to catch. A skill that redefines the fixed vocabulary (item 4) is `fail` regardless of how well-written it is.

**Mechanical pre-check.** The bundled `faff validate-adapters` command (resolve the `faff` executable per gateway → **Resolver** if it isn't on `PATH`) is a fast, deterministic lint of the **shipped defaults** — it checks the *structural* half of this checklist (refer-back present, non-normative marker, methodology required-outputs named, mechanism points at its gateway contract) and exits non-zero on drift, so it's suitable for CI / pre-commit. Its `--configured` variant (`faff validate-adapters --configured`) runs the same structural checks against the occupants a user has actually configured in `.faffrc` — deriving each one's expected profile from the slot it fills — so it's the **pre-flight** for a swapped-in slot occupant: run it before trusting an unattended build, rather than discovering a structural fault as an overnight park. Neither variant replaces this Validate face: they can't judge the semantic items (4 "maps onto, never redefines", 7 "stays in its lane"). Run the script to catch structural drift cheaply; run this face for the judgement calls and for third-party occupants installed outside the skills dir.

## Rules

- This skill authors and audits; it never edits the gateway contract. If a slot genuinely needs a new fixed state/class/verdict, that is a change to faff-core in the gateway — proposed there first, never bolted onto an adaptor.
- Both a development-time tool and a runtime gate. At authoring time it scaffolds/audits; at runtime the pipeline **always** invokes this skill's Validate face on a configured **foreign** occupant before first use (gateway → _Slot conformance validation_) — a **bundled first-party** occupant (the shipped default *or* a non-default `faffter-*` alternative) is never validated, so both the zero-config path and the bundled-alternative path are untouched. The contract binding itself is the consumer-load + standalone-read mechanism in the gateway; this Validate gate is what catches a non-conformant *swap*.
- The output envelope mirrors the faffidavit validate face on purpose — a slot author already fluent in one knows this one.
