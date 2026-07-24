# Thread the house prose voice into context-stripped dispatches (FAFF-634)

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-634.

This spec covers homing faff's prose-voice rules (`.agents/STYLE.md`) in the `rendering_adaptor` charter and threading them into every context-stripped dispatch that writes durable prose. Audience: the build agent and human reviewers. Repo: `/Users/shftwst/workspace/shftwst/faff`.

## Already shipped against this surface

Nothing shipped threads voice into dispatches — no overlap, but four Done tickets are the rails this change rides:

- **FAFF-52 / FAFF-53** — made the rendering adaptor the universal contract for all human-facing output *form* and wired every skill through it. This change folds *voice* into that same charter.
- **FAFF-372** — moved slot producers to Agent-tool subagent dispatch; gateway → **Sibling-skill invocation → Producer dispatch** became the single transport home. That is where the voice clause lands once for all producer dispatches.
- **FAFF-530** — precedent for exactly this mechanism: a one-line clause ("foreground-to-terminal") stamped into every `BuildDispatch` prompt.
- **FAFF-120 / FAFF-115** — the `faff validate-adapters` dedup lint that forbids copying shared prose across skills; it shapes the reference-not-copy design below.

## 1. WHY

**A dispatch prompt is the only context a bare executor gets, so anything the house requires of its prose must ride the dispatch envelope — the same way model, effort, and the foreground-to-terminal clause already do.** Voice becomes one more stamped element with one canonical source file, not a new subsystem.

**Problem.** `.agents/STYLE.md` holds the repo's voice (casual-but-credible, claims discipline, banned words) but is reachable only via the contributor read-chain (`.claude/CLAUDE.md` → `.agents/AGENTS.md` → `STYLE.md`), which subagent dispatches never follow. Specs, PR bodies, commit messages, and tracker comments written inside producer subagents and build subagents get no voice guidance unless a human hand-pastes rules per run.

**Design principles:**

- **One canonical home.** `.agents/STYLE.md` is the only place the voice rules are written. No SKILL.md copies any of its text — the dedup lint (6 identical significant lines across 2+ skills fails CI) enforces this mechanically.
- **Ride existing rails.** No new slot, no new config key, no new CLI verb. The change is prose edits to the two places dispatch prompts are already assembled, plus a charter edit to the adaptor that already owns house output style.
- **Degrade quietly.** A repo without a STYLE source skips injection — never park, never error. Voice is guidance, not a gate.

**Reference context:**

| File | Relevance |
|---|---|
| `.agents/STYLE.md` | The voice rules — canonical source, unchanged by this ticket |
| `plugin/skills/faffidavit-rendering/SKILL.md` | The `rendering_adaptor` charter — gains the Voice section |
| `plugin/skills/faff/SKILL.md` | Gateway; **Producer dispatch** (~line 911) — gains the canonical voice clause |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | `BuildDispatch` prompt assembly (~line 35–37) — stamps the clause |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | `BuildDispatch` prompt assembly (~line 30) — stamps the clause |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Lint caps: gateway line-cap override `faff: 1120` (file is at 1119 today), dedup window 6 |

**Scope statement.** This sits in the dispatch-envelope layer: it changes what rides a dispatch prompt, not what any producer or executor does with its result.

## 2. OUT OF SCOPE

- **A sibling `voice` adaptor slot** — decided against (see rationale). Extension point: a new `slots:` entry plus a gateway slot-table row, if a project ever needs voice swappable independently of output form.
- **A `.faffrc` key for the STYLE source path** — the path is a fixed convention. Extension point: a `style.source` key in the config surface plus a read at the dispatch sites.
- **Voice checking in the adaptor's Validate/normalise face** (banned-word / hedging scan of draft output). It would introduce a new LLM-judgement axis owing a seam-registry row and eval cases — a self-contained follow-up ticket. Extension point: `faffidavit-rendering/SKILL.md` → **Validation / normalise** checks list, plus `eval/seam-registry.json`.
- **A machine lint for voice in output** — `faff validate-adapters` lints skill *source* prose, not runtime output; no change to it beyond the line-cap override bump.
- **Re-voicing existing tracker/PR prose** — forward-only.
- **The FAFF-486 bare-executor contract** — still documented-not-built; when it lands, its task schema inherits the voice clause the same way `BuildDispatch` does (noted there as an extension, not built here).

## 3. WHAT

**Vocabulary:**

| Term | Definition |
|---|---|
| STYLE source | `.agents/STYLE.md` at the repo (or worktree) root — the voice rules |
| Voice clause | The one-line dispatch-prompt instruction pointing executors at the STYLE source |
| Durable prose | Prose that outlives the run: specs, PR bodies, commit messages, tracker comments, ADR bodies |
| Context-stripped dispatch | Any Agent-tool subagent or engine call that loads no gateway/CLAUDE.md context |

**The voice clause** — canonical text, defined exactly once (gateway → **Producer dispatch**, new short subsection **Voice clause**), quoted one-line at stamp sites:

```
"House voice: read `.agents/STYLE.md` at the repo root (worktree included) and apply
it to all durable prose you write — specs, PR bodies, commit messages, tracker
comments. File absent → skip this instruction."
```

Kept to a single quoted line at every stamp site so the 6-line dedup window can never fire on it (same posture as the FAFF-530 foreground-to-terminal clause, quoted in both concurrency executors today).

**Which dispatches carry it** (closed list — the rule is: every dispatch whose output includes durable prose):

- **Producer dispatches** (`spec`, `spec_review`, `methodology`, `intake`, `architecture`) — covered by the single gateway edit; prep, jot, and the four read skills all route through that section already, so no per-caller edit.
- **`BuildDispatch`** (both concurrency executors) — stamped alongside the foreground-to-terminal clause; covers PR bodies, commit messages, park comments written inside build subagents.
- **Engine-valued dispatches** (`methodology` / `intake` on `engine:<name>`) — the engine has no filesystem, so the caller appends the STYLE source *contents* to the user payload file instead of the pointer clause. Absent file → append nothing.
- **Exempt:** explore/grounding subagents and the spec producer's clean-context verify — their output is internal findings consumed by the orchestrator, not durable prose.
- **No edit needed:** `faff-beep-boop` (its prep-queue invokes `faff-prep` inline via the Skill tool — session context present; its producer and build dispatches are covered above) and `faff-graft` (builds inline today; as a build subagent it is covered by `BuildDispatch`; interactively the contributor read-chain applies).

**Design decisions** are collected in section 6; the headline call:

**Chosen:** fold voice into `faffidavit-rendering` (the `rendering_adaptor`), with a deliberate charter edit — no sibling adaptor.

## 4. HOW

**Charter edit — `faffidavit-rendering/SKILL.md`.** Three small changes:

1. Frontmatter description and opening paragraph widen the charter from house output *form* to house output *form and prose voice*. The "No internal contract — a pure adaptor" framing survives intact: voice, like form, is purely human-facing — no pipeline code branches on it — so the fold does not disturb the slot's no-contract status.
2. A new **Voice** section: names the STYLE source path (`.agents/STYLE.md`, a repo convention), states that the voice rules live *there* and are referenced never copied, and points at gateway → **Producer dispatch → Voice clause** for the injection mechanism.
3. The fold-vs-sibling rationale recorded in that section, two or three sentences (the acceptance criterion "decision recorded with rationale" lands here, in the artifact that owns the charter).

**Swappability semantics** (recorded in the Voice section): a project with a different voice edits `.agents/STYLE.md` — same path, different contents, effective on the next dispatch (read fresh, never cached). Swapping the *adaptor* changes form rules and validation; the source path itself is a fixed convention, not adaptor-resolved — dispatch sites must be able to stamp the clause without reading the adaptor first.

**Gateway edit — `faff/SKILL.md`.** A short **Voice clause** subsection under **Producer dispatch**: the canonical clause text, the durable-prose rule for which dispatches carry it, the engine-lane contents-append fork, and the absent-file skip. The concurrency slot contract's dispatch envelope references it so third-party executors are bound too.

**Lint headroom — load-bearing detail.** The gateway is at 1119 lines against a `SKILL_LINE_CAP_OVERRIDE` of `faff: 1120`. Any addition fails `faff validate-adapters` without bumping the override in `plugin/skills/faff/bin/lib/validate-adapters.js` — bump it modestly (e.g. 1140) in the same PR.

**Executor edits.** Both concurrency SKILL.mds add one sentence to their `BuildDispatch` paragraph: stamp the voice clause (quoted single line) per gateway → **Producer dispatch → Voice clause**.

**Edge cases:**

- **Missing STYLE source** → the clause self-contains its fallback ("file absent → skip"); the engine fork appends nothing. No park, no error, no per-dispatch logging burden.
- **Worktree builds** → the worktree is a checkout of the same repo, so `.agents/STYLE.md` is present at the worktree root; the clause says "repo root (worktree included)" so the executor doesn't hunt for the primary checkout.
- **STYLE source edited mid-adoption** → next dispatch picks it up; nothing caches it.

**Failure mode — prompt-mediated, not gated.** The approach assumes an instructed executor actually reads and applies the file; nothing verifies compliance. How you'd know: post-run durable prose still tripping banned words or PM register on spot-checks. What it means: escalate to the named follow-up (the Validate/normalise voice check, out of scope here) — not a reason to gate merges on voice now.

**Anti-pattern:** pasting STYLE.md's rules (or its banned-words table) into any SKILL.md or into the gateway clause. Why: creates a second home that drifts, and the dedup lint will fail CI on any 6-line copy.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a beep-boop build wave assembling a BuildDispatch for any unit
When the dispatch prompt is composed
Then it contains the voice clause naming `.agents/STYLE.md`, with no per-run hand-pasting
```

```
Given the edited skill set
When `faff validate-adapters` runs
Then it passes: no cross-skill duplicated block, and the gateway is within its bumped line cap
```

## 6. Design decision rationale

**Fold into the rendering adaptor, or a sibling voice adaptor?**

- *Fold* — voice joins form in the one skill that already defines house output style; one swap point; no new slot plumbing, slot-conformance validation, or config surface. Cost: a deliberate charter widening (the charter today frames rendering as output *form*).
- *Sibling* — cleaner axis separation (generation-time voice vs render-time form); cost: a new slot, new gateway slot-table row, new conformance rules, and two swap points for what is one concern ("how faff's output reads").

**Chosen:** fold. Voice and form are both purely human-facing with no pipeline contract behind them — exactly the property that defines this slot — and the adaptor's own charter argues against re-splitting human-facing style ("Don't re-split this into a `faffter-noon-rendering`"). The charter edit is deliberate and recorded in the new Voice section. The sibling remains a clean future extraction if a project ever needs voice swappable independently of form.

**Where do the voice rules live?**
**Chosen:** `.agents/STYLE.md` stays the single source; the adaptor and the gateway *reference* it. The adaptor charter is the wrong home for the rules themselves — SKILL.md prose is linted, distributed with the plugin, and shared across consuming repos, while voice is per-repo content.

**Pointer clause or pasted contents in the dispatch prompt?**
**Chosen:** pointer clause for Agent-tool dispatches (executors run in the repo/worktree and read the file fresh — no stale copies, no per-prompt token duplication); contents-append only for engine-valued lanes, which have no filesystem.

**Is the STYLE source path configurable?**
**Chosen:** no — fixed convention (`.agents/STYLE.md`), matching how `.agents/AGENTS.md` already references it. A different voice is a different file *contents*; a config key would add a second swap axis and a validation surface for no observed need.

**Missing-file behaviour?**
**Chosen:** skip silently (the clause carries its own fallback). Voice is guidance; a park or loud failure over a style file would invert the risk ordering the pipeline uses everywhere else.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** `.agents/STYLE.md` exists in this repo. Validation: `test -f .agents/STYLE.md` (verified during spec production).
- **Assumes:** Agent-tool build/producer subagents can read repo files from their cwd/worktree. Validation: existing build subagents already read specs and source there; no new capability needed.
- **Assumes:** the gateway line-cap override is editable in the same PR without ceremony (it is a plain constant, previously grown for the same reason per its own comment).

## 8. DONE

### From WHY / charter
- [ ] `faffidavit-rendering/SKILL.md` scope names prose voice alongside output form, and a **Voice** section names `.agents/STYLE.md` as the single source, referenced never copied
- [ ] The fold-vs-sibling decision and rationale appear in that Voice section

### From WHAT (the clause and its carriers)
- [ ] Gateway → **Producer dispatch** contains a **Voice clause** subsection with the canonical text, the durable-prose carrier rule, the engine contents-append fork, and the absent-file skip
- [ ] Both `faffter-dark-concurrency-parallel` and `faffter-noon-concurrency-sequential` stamp the quoted one-line clause into `BuildDispatch`, referencing the gateway subsection
- [ ] Explore/verify subagents remain unstamped (no edit adds the clause to them)

### From HOW (constraints)
- [ ] `faff validate-adapters` passes: `SKILL_LINE_CAP_OVERRIDE.faff` bumped alongside the gateway addition; no duplicated 6-line block introduced
- [ ] No SKILL.md contains copied STYLE.md rule text (grep for the banned-words table rows finds them only in `.agents/STYLE.md`)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. grep the gateway for the Voice clause subsection → exactly one canonical definition
  2. grep both concurrency SKILL.mds → each quotes the one-line clause and references the gateway
  3. run `node plugin/skills/faff/bin/lib/validate-adapters.js` (via its faff verb) → exit 0
  4. rm .agents/STYLE.md in a scratch clone → confirm no skill instructs a park/error on absence
```

confidence: high

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** No issues. Prose edits to four SKILL.md files plus one lint-constant bump is a coherent 1-day unit with one deliverable (the voice clause on every durable-prose dispatch); the spec resists the split temptations (sibling adaptor, output validation) explicitly, and neither concern is independently shippable value here.
- **Workstream fit (P1+5):** The issue sits project-less in Backlog with no outcome home, which is the correct default landing for captured work — but the spec itself shows this ticket belongs to a real outcome ("faff's human-facing output reads in the house voice"), riding the FAFF-52/53/372/530 rails. One ticket alone is too thin to manufacture a project for, so leave it loose; if the named voice-check follow-up gets filed (see next bullet), the pair becomes a groupable cluster worth an outcome-led home in a later rehoming pass.
- **Deps surfaced (P6):** The spec references un-ticketed and unlinked work with zero tracker relations on FAFF-634. Two gaps: the Validate/normalise voice check is named as "a self-contained follow-up ticket" but no such ticket exists — a downstream chain gap automation can't sequence; and FAFF-486 (bare-executor contract) is named as inheriting the clause when it lands, with no related-link. File the follow-up ticket (Backlog, related-to FAFF-634) and add the FAFF-486 relation, so the "how you'd know it's failing → escalate" path in section 4 points at a real ticket instead of prose.
- **Risk profile (P7):** No issues. The dominant risk — prompt-mediated compliance with no verification — is named in the spec with an observable symptom (banned words in post-run prose) and an escalation target, which is exactly a de-risking posture rather than risk piled at the end; the only sequencing-sensitive detail (the gateway sitting 1 line under its cap) is surfaced as load-bearing and handled in the same PR.

spec-review: approve
