# Spec — FAFF-967: close the 5c skip-because-unscored gap

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-967.
> build-tier: complex

**Artifact.** A buildable specification for FAFF-967. **Audience:** the build agent that will edit the skill prose, and the human reviewers who gate it. This is a **prose-only** hardening of two faff prompt files; it changes no runtime code, no tests, and no CLI contract.

## 1. WHY — Problem and principles

**The load-bearing model.** A faff *gate* is mandatory by being written, not by being scored. An autonomous L4 orchestrator decides what to run by reading the contract prose; if the prose enumerates only the *outcomes* of running a gate and never says the gate is **unconditional**, the orchestrator can reason "the harness won't score this step, and coverage already passed, so I'll skip it" and invent a benign-sounding third disposition. The fix is to state the obligation forward in the prose the orchestrator reads: running the gate is not contingent on it being scored or on a coverage floor already being satisfied.

**Problem statement.** `faff-plot` Step 5c enumerated only park reasons that are *results* of running the PRDR two-phase admit (`yagni-reject`, `yagni-overturned`, `phase2-inconclusive`, `admit-refused`, fail-loud), never that the arbitration is mandatory — so an autonomous run left a goal-covering loop-PRDR `Proposed`, recording an invented `deferred-recoverable` disposition on the rationale that the step was "not on this SUT's scored path" and coverage already passed. The change states 5c is unconditional, names-and-forbids the invented `deferred` / `deferred-recoverable` state, and lands the general "unscored is not a licence to skip a gate" rule at its one canonical home so the same class of gap is closed across all gates.

**Design principles.**

**State the rule forward, not the incident.** The house skill-authoring charter forbids changelog and war-stories in prompt prose (`docs/reference/skill-authoring.md` → *Runtime prompt, not changelog*). The run id (`run-20260902-011341-lights-out`), the verbatim decompose-log rationale, and the `deferred-recoverable` provenance belong in the commit message and this spec's rationale — never in the `SKILL.md` body. The body states the prohibition as a forward rule.

**One canonical home for shared prose.** The charter's dedup rule (`docs/reference/skill-authoring.md` → *Deduplicated*, enforced by the `duplicated block` lint) means the *general* rule lives once and is referenced, never copied. The 5c-*specific* hardening (which names 5c mechanics — the coverage floor, the two-phase admit, the `Proposed` state) stays local to Step 5c.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff-plot/SKILL.md` (Step 5c, lines 249–264) | Skill prompt prose | The gate whose contract is hardened; carries the 5c-specific edits |
| `plugin/skills/faff/references/autonomous.md` (*Autonomous Mode Contract*, ~line 34) | Gateway reference prose | Canonical home for the general no-unscored-skip rule; already carries the sibling "'Deferred' / 'queued for next run' = parked, relabelled" bullet |
| `faff validate-adapters` | CI lint gate | Enforces line caps, paragraph length, stray markers, duplicated blocks over the skill prose — must stay green |
| `docs/reference/skill-authoring.md` | Contributor charter | The house voice and lint rules the edits are held to |

**Scope statement.** This sits entirely in the contract-prose layer of the faff self-hosting plugin: it tightens what an autonomous orchestrator is permitted to conclude from Step 5c and from the shared autonomous contract, and touches nothing the gate CLIs execute.

## 2. OUT OF SCOPE

- **Any runtime code, test, or CLI-contract change.** The gate CLIs `faff prdr yagni | admit | accept` are invoked byte-unchanged; `faff-contract:prdr-admission` is unchanged. *Why excluded:* this is a contract-prose hardening — the terminal-state set the CLIs already enforce was never the gap; the gap was the prose licensing a skip before a CLI is reached. *Extension point:* if a future issue wants the *tooling* to refuse a `Proposed`-left-behind at run end, that is a `faff runcheck` / ledger change, not this spec.
- **The interactive L3 plot path.** *Why excluded:* only the `--autonomous` L4 harness runs Step 5c; L3 surfaces the `Proposed` PRDR for a human `faff prdr accept` and is untouched. *Extension point:* Step 5b intro, if L3 behaviour ever needs its own hardening.
- **FAFF-968 (git-only ADR channel) and FAFF-969 (adr.mode split).** *Why excluded:* related, not blockers; different surface (ADR channel/mode), no shared edit with this fix. *Extension point:* their own tickets.
- **Auditing other gates for the same gap beyond adding the general rule.** *Why excluded:* the general rule at its canonical home is the systemic fix; a gate-by-gate prose sweep is separate grooming. *Extension point:* a follow-up tidy pass that greps each gate's contract for a missing "unconditional" statement.
- **Renaming, renumbering, or restructuring Step 5c.** *Why excluded:* the edits are additive hardening within the existing step; churn would risk the anchor/line-cap lints for no benefit.

## 3. WHAT — Vocabulary and the three semantic changes

**Vocabulary.**

| Term | Definition |
|---|---|
| Unconditional gate | A gate that is run every time its precondition (a `Proposed` loop-PRDR exists) holds, regardless of whether the harness scores the step or whether a coverage floor is already satisfied. |
| Coverage floor | The condition that the authored DoD already covers the PRD goals. A *satisfied* floor is an input to the arbitration, never a licence to skip it. |
| Scored path | The subset of steps a given SUT's harness attributes a score to. "Unscored" describes only what the harness measures — it never describes what the contract requires. |
| Silent drop | Any run-end PRDR disposition other than the two terminal states (admit-and-land, or a labelled park) — including "left `Proposed`" under an invented `deferred` / `deferred-recoverable` label. |

**The three semantic changes** (the build target — exact wording is the builder's, held to the house voice; these state the required meaning):

1. **Step 5c intro — "5c is unconditional."** Add to the Step 5c intro (around `plugin/skills/faff-plot/SKILL.md:251`) that Step 5c runs for *every* Step-5b `Proposed` loop-PRDR: a satisfied coverage floor is not licence to skip it, its scored-path status is irrelevant, and **no `deferred` disposition exists** for it. Reference the general rule at its gateway home (`gateway → **Autonomous Mode Contract**`) rather than restating it.

2. **Terminal-state invariant — name and forbid the invented state.** Rewrite the positive invariant at `plugin/skills/faff-plot/SKILL.md:264` so that, alongside the existing "exactly one of: admit-and-land, or a labelled park", it explicitly names and forbids `deferred` / `deferred-recoverable`, and forbids "left `Proposed` because unscored / because coverage passed", as **silent drops** — the third terminal state does not exist.

3. **General rule at the gateway home — "no unscored-skip."** Add one sibling bullet in `plugin/skills/faff/references/autonomous.md`'s *Autonomous Mode Contract* universal-rules list, adjacent to the existing "'Deferred' / 'queued for next run' = parked, relabelled" bullet (~line 34): a gate being unscored, or a coverage floor already satisfied, is **not** a licence to skip the gate; "the harness won't score this" is the same failure mode as relabelling a defer — the gate still runs. Step 5c (change 1) references this bullet; it is not copied into faff-plot.

**Design decision — where the general rule lives.**

The issue's drafted fix #3 put the general rule in faff-plot's own `## Rules`. Weighed against the dedup charter:

- **Option A — faff-plot-local `## Rules` bullet.** Pro: matches the drafted fix; self-contained in the file the incident touched. Con: the rule is explicitly *general across all gates* (the issue says so), so a plot-local copy is a single-source violation — the moment another gate's contract needs it, the prose is duplicated, and the `duplicated block` lint plus review judgement both push back.
- **Option B — gateway home + a 5c reference.** Pro: one canonical home, sibling to the structurally identical "'Deferred' / 'queued for next run' = parked, relabelled" bullet already there; every gate's contract inherits it by reference; satisfies the charter and the lint. Con: the rule is one anchor-hop away from Step 5c rather than inline — mitigated because change 1 references it explicitly.

**Chosen:** Option B — the general no-unscored-skip rule lives once in `plugin/skills/faff/references/autonomous.md`'s *Autonomous Mode Contract*, and Step 5c references it; only the 5c-specific hardening (unconditional / no coverage-floor-skip / name-and-forbid `deferred-recoverable`) stays local to Step 5c. Rationale: the rule is general by the issue's own framing, the gateway already carries its exact structural sibling, and the dedup charter is binding and CI-enforced. (decides: architecture)

## 4. HOW — Approach

**Approach.** Three additive prose edits, no restructuring. Two files:

```
PROCEDURE apply_fix:
  1. In plugin/skills/faff/references/autonomous.md, Autonomous Mode Contract
     universal-rules list, adjacent to the "'Deferred' / 'queued for next run'
     = parked" bullet:
       a. Add one bullet stating the general no-unscored-skip rule (WHAT change 3).
       b. State it forward — no run id, no incident narrative.
  2. In plugin/skills/faff-plot/SKILL.md Step 5c intro (~L251):
       a. Add the "5c is unconditional" statement (WHAT change 1): satisfied
          coverage floor is not licence to skip; scored-path status irrelevant;
          no `deferred` disposition exists.
       b. Reference the general rule via `gateway → **Autonomous Mode Contract**`
          — do not copy it.
  3. In plugin/skills/faff-plot/SKILL.md terminal-state invariant (L264):
       a. Rewrite to also name and forbid `deferred` / `deferred-recoverable`
          and "left Proposed because unscored / coverage passed" as silent drops.
  4. Run `faff validate-adapters`; confirm green (line caps, paragraph length,
     stray markers, duplicated block).
```

**Anti-pattern:** copying the general rule into faff-plot's `## Rules` as well as the gateway home. Why: it duplicates shared prose, violates the dedup charter, and risks the `duplicated block` lint — the reference from Step 5c is the intended mechanism.

**Anti-pattern:** writing the incident into the SKILL.md body ("this fixes run-...", "the loop once left a PRDR Proposed"). Why: the charter bans changelog/war-stories in prompt prose; state the prohibition forward and put the story in the commit message.

**Anti-pattern:** introducing a new park label or a new disposition token for the skip case. Why: the whole point is that only the two existing terminal states exist — a "recoverable" or "deferred" label is exactly the invented third state being forbidden.

**Failure modes.**

- **The failure:** the edit forbids the *label* `deferred-recoverable` but not the *reasoning* ("coverage passed, so I skipped"), so an orchestrator invents a differently-named skip disposition and walks through the same gap. **How you'd know:** a later autonomous run leaves a `Proposed` loop-PRDR with any skip rationale, scored or not. **What it means:** the prose must forbid the *reasoning class* (unscored / coverage-floor as a skip licence) and the *outcome* (left `Proposed`), not merely the one string — change 1 and change 2 both target the reasoning, which is why the general rule is framed by failure mode, not by label.
- **The failure:** placing the general rule at the gateway but wording Step 5c's reference so weakly that an orchestrator reading only Step 5c never follows the anchor. **How you'd know:** review reads Step 5c standalone and cannot tell the arbitration is mandatory. **What it means:** the 5c intro must *state* unconditionality locally and reference the gateway for the general principle — the local statement carries the obligation, the reference carries the generalisation.
- **The failure:** the added lines tip a linted file over a cap. `faff-plot` is under the shared 600-line ceiling (not a hub-ratchet file), so a few added lines are safe; the risk is a paragraph exceeding the 200-word cap or the new gateway bullet duplicating ≥6 significant lines. **How you'd know:** `faff validate-adapters` prints a `FAIL`. **What it means:** keep the additions terse and novel — the DoD gates on green.

## 5. Scenarios — born-verifiable objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the built change is applied
When an autonomous L4 orchestrator reads Step 5c to decide whether to run the PRDR two-phase admit for a goal-covering Proposed loop-PRDR
Then the prose states the step is unconditional — a satisfied coverage floor and an unscored path are explicitly not a licence to skip — so "skip because unscored / coverage passed" is not a permitted conclusion
```

```
Given the Step 5c terminal-state invariant
When a reader looks for what dispositions are allowed
Then exactly two terminal states are named (admit-and-land, or a labelled park) and `deferred` / `deferred-recoverable` / "left Proposed because unscored" are named and forbidden as silent drops
```

- The general no-unscored-skip rule appears exactly once in the corpus (`plugin/skills/faff/references/autonomous.md`), and Step 5c reaches it by reference, not by copy.
- `faff validate-adapters` exits zero after the change (no line-cap, paragraph, stray-marker, or duplicated-block failure).

## 6. Design decision rationale

**Where does the general "unscored is not a licence to skip" rule live?**

- Options and tradeoffs are laid out under WHAT → *Design decision*.
- **Chosen:** the gateway *Autonomous Mode Contract* (`plugin/skills/faff/references/autonomous.md`), referenced from Step 5c — because the rule is general by the issue's own framing, the gateway already carries its exact structural sibling ("'Deferred' / 'queued for next run' = parked, relabelled"), and the dedup charter is binding and CI-enforced. A faff-plot-local copy was rejected as a single-source violation.

**Frame the prohibition by failure mode or by label?**

- By label alone (forbid the string `deferred-recoverable`): brittle — a renamed skip disposition evades it.
- By failure mode (forbid skipping *because unscored / because coverage passed*, and forbid the *outcome* of a left-`Proposed` PRDR), naming the observed label as the worked example.
- **Chosen:** by failure mode, naming `deferred` / `deferred-recoverable` as the concrete forbidden instance — this closes the reasoning gap, not just the one string, and mirrors how the sibling gateway bullet frames relabelled defers.

## 7. Open questions and assumptions

**Open questions.** None. The one real decision (placement) is settled above.

**Assumptions.**

- **Assumes:** the anchor target *Autonomous Mode Contract* exists as a heading in the gateway corpus so `gateway → **Autonomous Mode Contract**` resolves under the `anchor` lint. *Validate:* confirmed present at `plugin/skills/faff/references/autonomous.md:20` (`### Autonomous Mode Contract`).
- **Assumes:** `faff-plot/SKILL.md` is a shared-ceiling file (600-line cap), not a hub-ratchet file. *Validate:* the ratchet applies only to `faff` and `faff-beep-boop` per `docs/reference/skill-authoring.md`; faff-plot is neither.
- **Assumes:** the house voice is the skill-authoring charter's lean/forward-stated/no-changelog ethos. *Validate:* `AGENTS.md` has no `# Writing style` heading; its *Skill-authoring standard* section and `docs/reference/skill-authoring.md` carry the voice, applied here.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] No run id, decompose-log quote, or incident narrative appears in either edited `SKILL.md` / reference body (forward-stated rule; story lives in the commit message).

### From WHAT (the three semantic changes)
- [ ] Step 5c intro states the step is **unconditional**: a satisfied coverage floor is explicitly not a licence to skip, and scored-path status is explicitly irrelevant.
- [ ] Step 5c intro states no `deferred` disposition exists for the loop-PRDR, and references the general rule via `gateway → **Autonomous Mode Contract**` (not a copy).
- [ ] The Step 5c terminal-state invariant (L264 area) names and forbids `deferred` / `deferred-recoverable` and "left `Proposed` because unscored / coverage passed" as silent drops, retaining the two-terminal-states statement (admit-and-land, or a labelled park).
- [ ] The general no-unscored-skip rule is present as a bullet in `plugin/skills/faff/references/autonomous.md`'s *Autonomous Mode Contract*, adjacent to the "'Deferred' / 'queued for next run' = parked" bullet.

### From WHAT (placement decision)
- [ ] The general rule appears in exactly one home (the gateway reference); it is not also copied into faff-plot's `## Rules`.
- [ ] `grep -rn "deferred-recoverable" plugin/` returns only occurrences inside a forbidding statement.

### From HOW (no scope creep)
- [ ] No change to `faff prdr yagni | admit | accept`, no test change, no CLI-contract change, no Step 5c renumber/restructure.

### From lint / acceptance
- [ ] `faff validate-adapters` exits zero (no line-cap, paragraph, stray-marker, or duplicated-block failure introduced by the edits).

**Integration smoke test.**

```
1. grep Step 5c intro + L264 invariant in plugin/skills/faff-plot/SKILL.md
   → both carry the unconditional statement and the named-and-forbidden deferred state.
2. grep the Autonomous Mode Contract in plugin/skills/faff/references/autonomous.md
   → the no-unscored-skip bullet is present, once.
3. Run `faff validate-adapters` → exit 0.
If all three hold, the contract prose closes the skip-because-unscored gap and the lint gate is green.
```

## Methodology critique

**Right-sized?** No issues. Three additive prose edits over two files, one concern (name-and-forbid the invented `deferred-recoverable` terminal state on the PRDR-admit path, plus its one canonical rule home). Comfortably under a day. The two files are correctly *one* ticket, not a split: the Step 5c edit is a back-reference to the new `autonomous.md` bullet, so they are merge-coupled and ship together — splitting would strand a dangling reference.

**Workstream fit?** Minor. The issue is loose Backlog under `faff-automate`, alongside FAFF-968 (git-only ADR channel) and FAFF-969 (adr.mode split) — three tickets all hardening the autonomous-mode contract. There is no shared outcome container, so the cluster can't be sequenced as a unit and its combined "done" is undefined. Not urgent to fix: each ships independently and conservative grouping beats a wrong one. If a hardening stream does get stood up, home all three under it; until then loose is acceptable and no action is forced here.

**Deps surfaced?** No issues. FAFF-968/969 are correctly declared *related, not blocking* — this edit lives on the PRDR-admit path (Step 5c / Autonomous Mode Contract), disjoint from the ADR-channel work, and the one design decision (where the general rule lives → gateway home + Step 5c reference) is already resolved on the dedup charter, so nothing external is load-bearing. One authoring-level dependency to keep visible, not a tracker link: the new `autonomous.md` bullet lands right beside the existing line-34 rule (`"Deferred" / "queued for next run" … = parked, relabelled`), which already forbids the same failure mode for build-queue dispatch. The new bullet must read as the *canonical single home* that line-34 and Step 5c both defer to, not a second near-duplicate — exactly what the dedup charter calls for.

**Risk profile?** No issues. Prose-only, no runtime/test/CLI surface, DoD gated on `faff validate-adapters` staying green — near-zero blast radius, nothing novel, no de-risking spike warranted. The sole live risk is prose drift against the existing "Deferred = parked" contract line; the resolved single-home decision is the correct and sufficient mitigation.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```
