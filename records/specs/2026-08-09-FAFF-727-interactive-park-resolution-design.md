# Interactive resolution of a needs-human park must surface the call, not settle it

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-727.

This spec is a **prose/guardrail change to the faff skills**. It adds one single-sourced gateway rule — the interactive (L1/L2) counterpart to the Autonomous-Mode contract's park behaviour — and two consumer back-references (faff-tidy, faff-prep). The audience is the build agent (who edits the three `SKILL.md` files) and the human reviewer (who checks the rule says the right thing). No code, CLI, `.faffrc` key, or `.faff/` artefact is added.

## 1. WHY — Problem and Principles

**The load-bearing model.** A `needs-human` park is a promise that *a human decides the call it names* — an architecture, scope, or taste choice the pipeline deliberately refused to make itself. faff's whole value proposition ("safe to stop watching") rests on that token meaning what it says. The autonomous contract honours it: an autonomous run parks such a decision and never self-resolves it. The **interactive** path (L1/L2, human at the keyboard, agent assisting) has no stated equivalent boundary — so when a human says "clear up the premise on these parked issues," nothing in the skills stops the agent from investigating, deciding the call itself, and writing a settled `**Chosen:**` / Resolution. That looks like progress but is exactly the AI-makes-the-call outcome the park guarded against. More agent or subagent steps do not convert AI analysis into human judgment.

Status quo → pain → change: the interactive boundary is unstated, so a helpful-looking pass can quietly settle `needs-human` calls (5 of 7 in the triggering session); this spec states the boundary once in the gateway and points the two consumer skills back to it.

**Design principles:**

- **Surface, don't settle.** The rule constrains *who makes the call*, never *whether the agent helps*. The agent still explores, analyses, and recommends — it just stops short of authoring a settled decision on the human's behalf and marking it decided. A rule that discouraged analysis would be wrong; the analysis is welcome, the *authorship of the verdict* is what transfers to the human.
- **Named principle, not a new mechanism.** Like *Human curation is authoritative*, this rule adds no `faff` subcommand, `.faffrc` key, or `.faff/` artefact. It names a boundary the model must uphold and that the consumer skills refer back to — single-sourced in the gateway, never restated in full downstream.
- **Symmetry with the autonomous contract, not a copy of it.** The autonomous rule *parks* a needs-human call; the interactive rule *surfaces* it to the present human. Both refuse to let the agent settle it. The interactive rule must not be read as licence to add mid-run interactive gates to an *autonomous* run — that inverse over-prompting is FAFF-572's territory and stays forbidden (Autonomous Mode Contract → the no-prompt invariant).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/SKILL.md` → `### Autonomous Mode Contract`, `### Resolve-attempt before park`, `### Human curation is authoritative`, `### Unpark protocol` | The park cluster this rule joins; the autonomous boundary it mirrors; the "obey" principle it applies |
| `plugin/skills/faff-tidy/SKILL.md` → §1 Spec health (Challenged/Stale rows), §4 "Stuck in prep — needs human decision" | Consumer: where tidy surfaces/hands off parked and challenged specs interactively |
| `plugin/skills/faff-prep/SKILL.md` → Scenario A Step 3 (interactive park), Scenario B Steps 2a/3 (refresh mode), Re-prepping | Consumer: where prep resolves parked/challenged specs interactively |

**Scope statement:** a governing-contract prose addition in the gateway plus two pointer references — it sits alongside the existing park/curation contracts, not inside any one skill's mechanics.

## 2. OUT OF SCOPE

- **Reworking the autonomous contract.** *Why excluded:* it already handles this correctly (parks needs-human, resolve-attempt is bounded and audit-trailed). *Extension point:* none needed — this spec only adds the interactive sibling.
- **A mechanical check that flags an agent-authored `**Chosen:**` on a `needs-human`-parked issue with no intervening human turn ("the smell").** *Why excluded:* see the Design Decision Rationale — the correctness-vs-taste discrimination and the "intervening human turn" signal are both judgement calls, not statically lintable, and off-tracker human steering makes the turn-count signal unreliable; v1 stays a stated prose contract, consistent with the gateway already classifying the park judgement itself as model-compliance. *Extension point:* a future **advisory** (never a hard gate) surfaced by `/faff-tidy`'s calibration pass — an over-eager-interactive-resolution signal paralleling the existing over-cautious-parks capture — filed as its own ticket if the pattern recurs.
- **Changing the `faff-parked` label lifecycle, the Unpark protocol mechanics, or the spec-readiness marker contract.** *Why excluded:* the rule governs *how a human's answer is obtained*, not label mechanics; unpark still proceeds by re-running `/faff-prep` once the human has answered. *Extension point:* none.
- **New provenance stamping to record "human decided this."** *Why excluded:* no new artefact is in scope; the human's answer already lives as a tracker comment / edit that prep folds in per Live-thread reconciliation. *Extension point:* the mechanical-smell advisory above, if ever built, would consume exactly that existing signal.

## 3. WHAT — The rule and its references

### The single-sourced gateway rule

A new subsection in `plugin/skills/faff/SKILL.md`, placed in the autonomous/park cluster (adjacent to `### Resolve-attempt before park` and `### Human curation is authoritative`, before `### Park protocol`), titled as the interactive counterpart — e.g. **`### Interactive park resolution (surface, don't settle)`**. It states three things:

1. **The boundary.** Resolving a `needs-human` park interactively requires the **human's actual judgment** on any architecture / scope / taste decision the park names. The agent **surfaces** the decision and may offer a **recommendation**; it does **not** author a settled `**Chosen:**` / Resolution on the human's behalf and mark it decided. Running more subagent analysis does not discharge the requirement — the judgment, not the investigation, is what the token reserves for the human.
2. **The correctness carve-out.** An agent *may* resolve a park whose fix is a **matter of fact, not taste** — a genuine bug, a falsified measurement, a rule already written down elsewhere — because there is a *right answer*, not a *choice*. Architecture / scope / taste choices are **not** in this carve-out. When in doubt whether a call is fact or taste, treat it as taste and surface it.
3. **Verify subagent findings against the source.** A subagent's "finding" is **verified against the authoritative source before it is acted on**. A subagent summary that contradicts the source it cites loses to the source. (Canonical illustration: an investigator claimed an ADR mandated refuse-at-L3 while the cited ticket's own text said L1–L3 warn is deliberate — the source is authoritative, not the investigator's paraphrase.)

The subsection must cross-reference the two siblings it sits between — it is the interactive mirror of *Resolve-attempt before park* (which bounds autonomous inference) and a direct application of *Human curation is authoritative* (the human's call is authoritative control input) — and note the symmetry-not-copy caveat so it is never misread as licence for mid-run prompts on an autonomous run.

### Consumer back-references (pointer only, never restated in full)

- **faff-tidy** — at §1 Spec health (the **Challenged** and **Stale** rows, whose interactive action is "surface for `/faff-prep` in refresh mode") and at §4 "Stuck in prep — needs human decision" (which surfaces a still-valid needs-human park reason), add a pointer that interactive resolution of the surfaced park follows the gateway rule: surface the call and hand off, never settle the taste decision on the human's behalf.
- **faff-prep** — at Scenario B (refresh) Step 2a/Step 3 and the Scenario A interactive park path (and the *Re-prepping* note), add a pointer that when a refresh/iterate would close a `needs-human`/architecture-or-scope-or-taste decision, the human makes the call (the agent surfaces + recommends); the correctness carve-out lets prep close a fact-not-taste item itself. This is the interactive analogue of prep's *autonomous* stale-refresh rule (which parks a challenge to a core decision).

Both references are one-or-two sentences that resolve to the gateway subsection by name — no duplication of the rule body (the single-source discipline the gateway already uses for Park/Unpark).

### Key technical decisions
See §6 Design Decision Rationale. Each concludes with a canonical marker; all are `**Chosen:**`.

## 4. HOW — Behaviour

This is a documentation change; "behaviour" is the editing procedure and the invariants the added prose must satisfy.

```
PROCEDURE add_interactive_park_rule:
  1. In faff/SKILL.md, insert the new subsection in the park cluster
     (after "### Resolve-attempt before park" / "### Human curation is authoritative",
      before "### Park protocol"). Write the three-part rule + the two cross-references
      + the symmetry-not-copy caveat.
  2. In faff-tidy/SKILL.md, add the pointer at §1 Spec-health (Challenged/Stale) and §4.
  3. In faff-prep/SKILL.md, add the pointer at Scenario A Step 3, Scenario B Step 2a/3,
      and the Re-prepping note.
  4. Do NOT edit the Autonomous Mode Contract body, Resolve-attempt table, label lifecycle,
      or the spec-readiness marker contract.
```

**Invariants the added prose must hold (the DONE checks test these):**
- **Single-source.** The rule body appears **once** (the gateway subsection). tidy and prep carry pointers only.
- **Surface-not-settle is explicit** and distinguished from "don't analyse" — the prose must make clear analysis/recommendation is welcome; only authoring-the-verdict transfers.
- **The carve-out is bounded** to fact-not-taste with the tie-break "in doubt → treat as taste."
- **The verify-findings clause names the source-beats-summary rule.**
- **No inverse licence.** The prose must not read as permission for mid-run prompts on an autonomous run (explicit caveat referencing the no-prompt invariant).

**Anti-pattern:** restating the full rule in tidy or prep. Why: it re-creates the drift the gateway's single-source discipline exists to prevent — the Park/Unpark protocols are single-sourced for exactly this reason.

**Anti-pattern:** writing the rule as "never resolve a park interactively." Why: that over-shoots — the correctness carve-out and the surface-plus-recommend allowance are the point; a blanket ban would block legitimate fact-fix unparks and discourage the analysis the human wants.

## Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a needs-human park naming an architecture/scope/taste decision, and an interactive session
When the agent (or its subagent) works out a plausible answer
Then per the gateway rule it surfaces the decision + a recommendation to the human and does not
     author a settled **Chosen:**/Resolution marking it decided
```

```
Given a park whose fix is a matter of fact — a genuine bug, a falsified measurement, or a rule
      already written down
When the agent resolves it interactively
Then the correctness carve-out permits the agent to close it directly, because there is a right
     answer rather than a choice
```

- Assertion: the rule body is single-sourced in the gateway; faff-tidy and faff-prep contain pointers that resolve to it by name, not copies.
- Assertion: no edit weakens or contradicts the Autonomous Mode Contract's no-prompt invariant or its park behaviour.

## 6. DESIGN DECISION RATIONALE

**Where does the single-sourced rule live?**
Options: (a) a new gateway subsection in the park cluster; (b) fold into *Human curation is authoritative*; (c) fold into *Resolve-attempt before park*. (b) buries an operational boundary inside a principle statement; (c) conflates the autonomous inference budget with the interactive boundary (opposite biases — autonomous may infer within budget, interactive never infers a taste call). A dedicated adjacent subsection keeps each concern findable and lets both siblings cross-reference it.
**Chosen:** a new gateway subsection in the autonomous/park cluster, cross-referencing both siblings — matching how Park/Unpark are single-sourced and pointed at.

**Prose contract or a mechanical check?**
The issue asks to consider whether "an agent-authored `Chosen` on a `needs-human`-parked issue with no intervening human turn is a smell" should be mechanically flagged. Both signals it would need — (i) is the decision taste vs fact, (ii) was there a genuine intervening human judgment — are themselves judgements: (i) is the exact discrimination the rule asks a human to make, and (ii) is defeated by off-tracker steering (a human can decide in person, in chat, or by a tracker edit prep folds in). The gateway already classifies the park judgement itself as model-compliance, not mechanically enforced (the mechanical-vs-model-compliance table). A brittle lint here would raise false positives on legitimate carve-out unparks and false negatives on real oversteps.
**Chosen:** a stated prose contract for v1; the mechanical smell-check is out of scope, with an extension point as a future `/faff-tidy` calibration **advisory** (never a hard gate). Rationale: consistent with the gateway's existing treatment of park judgement and its *Deterministic tools over prose* rule (which reserves the LLM for judgement — this boundary is judgement).

**How wide is the correctness carve-out?**
Options: (a) no carve-out (never resolve interactively); (b) fact-not-taste carve-out with a tie-break; (c) broad "resolve when confident." (a) blocks legitimate bug/measurement/written-rule unparks and discourages wanted analysis; (c) reopens the exact overstep this fixes (confidence in a taste call is still a taste call).
**Chosen:** the fact-not-taste carve-out (genuine bug / falsified measurement / rule already written down), with the explicit tie-break "in doubt → treat as taste and surface." Architecture/scope/taste are never in the carve-out.

**How strong is the verify-findings clause?**
**Chosen:** a subagent finding is verified against the authoritative source before it is acted on, and a summary that contradicts its cited source loses to the source — stated with the concrete illustration from the triggering session (ADR-vs-ticket-text contradiction), kept generic (no live ticket ID hard-coded into the contract, to avoid a stale reference).

**Which consumers point back, and how much do they say?**
**Chosen:** faff-tidy (§1 Challenged/Stale, §4 Stuck-in-prep) and faff-prep (Scenario A park, Scenario B refresh, Re-prepping) each carry a one-to-two-sentence pointer resolving to the gateway subsection by name — no rule-body duplication.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. (The mechanical-check question is closed as out-of-scope-for-v1 above, not punted.)

**Assumptions:**
- **Assumes:** the gateway `### Human curation is authoritative`, `### Resolve-attempt before park`, `### Park protocol` / `### Unpark protocol` subsections exist as the placement anchors. *Validation:* `grep -n "Resolve-attempt before park\|Human curation is authoritative\|Park protocol\|Unpark protocol" plugin/skills/faff/SKILL.md` before editing (verified present at prep time).
- **Assumes:** faff-tidy §1 Spec-health Challenged/Stale rows and §4 "Stuck in prep — needs human decision", and faff-prep Scenario A Step 3 / Scenario B Step 2a & 3 / Re-prepping, exist as the pointer anchors. *Validation:* `grep -n` the headings in each `SKILL.md` before editing (verified present at prep time).
- **Assumes:** `validate-adapters` (the CI lint that fails a `SKILL.md` shell-reading the rc file) imposes no constraint on this change, since no config-read prose is added. *Validation:* run the repo's skill-lint / test suite after editing; no new rc read is introduced.

## 8. DONE — Definition of Done

### From WHY / WHAT (the gateway rule)
- [ ] `plugin/skills/faff/SKILL.md` gains one new subsection (interactive counterpart to the autonomous park behaviour) in the park cluster, stating all three parts: (1) surface-don't-settle boundary, (2) fact-not-taste correctness carve-out with the in-doubt→taste tie-break, (3) verify-subagent-findings-against-source.
- [ ] The subsection cross-references `### Resolve-attempt before park` (its autonomous mirror) and `### Human curation is authoritative` (the principle it applies), and includes the symmetry-not-copy caveat pointing at the no-prompt invariant so it is not misread as licence for mid-run prompts on an autonomous run.
- [ ] The rule makes explicit that analysis/recommendation is welcome and only authorship-of-the-verdict transfers to the human (not a blanket "don't resolve").

### From WHAT (consumer back-references)
- [ ] `plugin/skills/faff-tidy/SKILL.md` carries a pointer at §1 Spec-health (Challenged/Stale) and §4 "Stuck in prep — needs human decision" resolving to the gateway subsection by name — pointer only, no rule-body copy.
- [ ] `plugin/skills/faff-prep/SKILL.md` carries a pointer at Scenario A Step 3, Scenario B Step 2a/3, and the Re-prepping note resolving to the gateway subsection by name — pointer only, no rule-body copy.

### From HOW (invariants)
- [ ] The rule body appears exactly once (gateway); a grep for the distinctive rule phrasing finds it only in `faff/SKILL.md` (tidy/prep contain only pointers).
- [ ] No edit changes the Autonomous Mode Contract body, the Resolve-attempt table, the `faff-parked` label lifecycle, or the spec-readiness marker contract.
- [ ] The out-of-scope mechanical smell-check is recorded as a future advisory (extension point), not implemented.

### From HOW (integration smoke)
- [ ] The repo's skill/prose lint + test suite passes unchanged after the three edits (no new rc read, no broken cross-reference). Smoke: `grep` each cross-referenced heading name resolves within its target file.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
