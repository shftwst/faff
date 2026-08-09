# FAFF-118 — Response-side token discipline in skill output contracts

> Spec by /faff-prep (autonomous, run 2026-06-12-beep-boop-133455, faffter-noon-spec). Lite nlspec. Full spec on Linear FAFF-118.

## WHY

faff already keeps its **prompts** lean and its **rendered output** skimmable (lists-not-run-on, tables-vs-definition-lists, density caps, synthesis gloss) — all owned by the `rendering_adaptor` (`faffidavit-rendering`). What it does **not** yet say anywhere is "be a good citizen on **response tokens** too": a skill can satisfy every form rule and still emit a bloated response — preamble, postamble, ceremonial restatement of the ticket, narrated re-explanation of what it just did. That burns tokens and erodes the *understandable-not-unapproachable* tenet (skimmable, low-cognitive-load output) the rendering slot is meant to embody.

The brief's other half — prompt-slimming — lives in sibling tickets in this project. FAFF-118 is the response-side half: largely independent, touches the rendering adaptor plus (lightly) the way skills' output sections refer to it.

The right home is the **existing** `rendering_adaptor`. It already owns the prose-skimmability / list-not-run-on rule and a normalise pass that every sub-skill runs as a final step. Token economy is the same kind of rule (a property of human-facing output, enforced by the same pass), so it belongs **in that one slot**, not duplicated per skill. This is the *configurable-not-opinionated* shape: swap the rendering adaptor → the house token-economy posture changes wholesale.

## WHAT

**Scope (in):**
- Add an **output-token-economy** rule to `faffidavit-rendering` SKILL.md as a sibling to **Prose skimmability**, folded into the **Validation / normalise** face (a violation is rewritten, not merely flagged), and listed in the normalise **Checks**.
- Extend the gateway's **Rendering → `rendering_adaptor`** section so its one-line catalogue of what the slot owns names token economy alongside the visual/table/density/synthesis rules (keeps the gateway's slot description authoritative).
- Confirm consumer skills need **no per-skill rule** — they already route output "through the configured `rendering_adaptor` normalise pass", which now covers token economy for free. Verify each consumer's refer-back sentence still reads correctly (it should, unchanged).

**Scope (out / Punt):**
- **Punt:** whether the prompt-slimming half (lean SKILL.md bodies) gets its own ticket vs. is already covered by sibling tickets in this project — out of scope here; FAFF-118 is response-side only.
- No new CLI, no new `faff-contract`, no code/test changes — rendering has **no internal contract** and no pipeline code branches on it (gateway: "no pipeline code branches on, counts, or gates on how output looks"), so this is a prose-only change to two SKILL.md files.

**Acceptance criteria:**
1. `faffidavit-rendering` SKILL.md gains a token-economy rule that bans, in human-facing output: preamble/postamble ceremony ("Here is the…", "Let me know if…"), restating the ticket/request back, narrating what was just done when the output itself shows it, and needless qualifier/hedge padding — while explicitly **not** sacrificing the synthesis gloss, diagnosis, or "do this next" carve-outs (those still win, same as Prose skimmability).
2. The rule is wired into the Validate/normalise face: it appears in the **Checks** list and is a **rewrite** (not flag-only), consistent with how Prose skimmability is handled.
3. The rule's **Scope** matches the slot's existing scope (all human-facing output: terminal + tracker descriptions + tracker comments; carve-outs = skill source files and `.faff/` logs) — stated by reference, not re-litigated.
4. The gateway **Rendering** section names token economy in the slot's owned-rules list.
5. No consumer SKILL.md needs a new token rule (the Open Question is answered **adaptor-only** unless verification finds a consumer that emits output *not* already routed through the normalise pass — none found in exploration).

## HOW

Grounded in the real files explored:

1. **`plugin/skills/faffidavit-rendering/SKILL.md`** — add a new `## Output token economy` section immediately after `## Prose skimmability` (currently L36–43), mirroring its structure: a short rationale, 3–4 bold-lead bullets of banned forms with the *use-instead*, a line that it folds into Validate/normalise as a **rewrite**, and a one-line **Scope** reference to the existing *Scope — all human-facing faff output* (L31–33) and the *When prose still wins* carve-outs (L134–140). Then extend the **Validation / normalise → Checks** sentence (L289) to add "responses that carry preamble/postamble ceremony, ticket restatement, or redundant narration of what the output already shows (token-economy rule)".

2. **`plugin/skills/faff/SKILL.md`** — in the **Rendering — no internal contract → `rendering_adaptor`** section (L811–815) and the slot-table row (L177), add "output token economy" to the enumerated list of what the slot owns (e.g. "...density caps, **output token economy**, and the synthesis issue-gloss..."). This keeps the gateway as the authoritative slot summary.

3. **Consumers** — re-read the refer-back sentences in `faff-prep` (L35), `faff-tidy` (L171), `faff-wtf` (L26, L158); confirm each says output "passes through the configured `rendering_adaptor` normalise pass" (or equivalent). Because token economy is now part of that pass, **no edit** is needed — this is the DRY payoff and the answer to the ticket's Open Question. Only touch a consumer if exploration of its emit sites reveals output that bypasses the normalise pass (none found).

4. **No code.** Confirmed: `test/` covers CLI/contracts/golden only; no rendering-prose test exists, and rendering has no contract script. `faff validate-adapters` lints the shipped default by construction (gateway L755) — adding a prose rule to the default needs no test wiring.

**Chosen:** put the rule in `faffidavit-rendering` (the adaptor), not per skill — directly per the ticket and the *configurable-not-opinionated* tenet.

## DONE

Verifiable criteria:
- `grep -i "token econom" plugin/skills/faffidavit-rendering/SKILL.md` matches a new section heading and a Checks-list mention.
- The new section lists the banned response-bloat forms (preamble/postamble, ticket restatement, redundant narration, hedge padding) each with a *use-instead*, and states it is a **rewrite** under Validate/normalise.
- The new section states its Scope **by reference** to the existing *Scope — all human-facing faff output* and the *When prose still wins* carve-outs (no re-litigation, no contradiction).
- `grep -i "token econom" plugin/skills/faff/SKILL.md` matches in the Rendering section and the slot-row.
- No consumer SKILL.md gains a bespoke token rule (`git diff --stat` touches only the two files above); each consumer's "normalise pass" refer-back sentence is unchanged and still correct.
- No file under `test/`, no contract script, no CLI surface changed.
- The ticket's Open Question is resolved in-spec: **adaptor-only**, no per-skill output-contract edits.

## Confidence self-rating: high

The change is small, prose-only, lands in exactly the slot the ticket names, follows an established in-file pattern (Prose skimmability) and an established cross-skill pattern (the shared normalise-pass refer-back), needs no code or tests, and the one Open Question resolves cleanly to the DRY adaptor-only answer that the codebase's own DRY conventions already support.
