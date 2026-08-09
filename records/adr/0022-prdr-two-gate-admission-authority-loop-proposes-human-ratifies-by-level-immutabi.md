# ADR 0022 — PRDR two-gate admission authority: loop proposes, human ratifies, by-level immutability

- **Status:** Accepted
- **Date:** 2026-06-27
- **Issue:** FAFF-255
- **Initiative:** L4 — Lights-out AI factory

## Context

The L4 lights-out factory delegates *product ends* to the machine: the loop authors and supersedes **PRDRs** (project-scale product-requirement decision records) to re-derive project goalposts as it learns (FAFF-245 shipped the record + the pure mechanical `prdr supersede` linker; FAFF-251 authors their content). That power is only safe if the loop **cannot leave the human PRD box** — it must not silently move a goalpost a human set, gold-plate beyond the PRD, abandon a goal it was meant to cover, or churn its own setpoint indefinitely.

The forces in tension:

- **Autonomy vs. the leash.** The loop must move freely *within* the human's outermost ends, but never *past* them. A blanket "no autonomous goalpost moves" kills the capability; an unbounded one is unsafe.
- **Self-grading.** A loop that both authors a PRDR and judges its own admission is marking its own homework — the YAGNI/value judgement and the "did a human sanction this?" question cannot be the loop's alone.
- **Determinism over prose.** The admission decision is a control-flow gate the autonomous lane acts on with real authority; it must be a reproducible function, not run-to-run model judgement.
- **The human surface stays native-tracker, zero-CLI.** A human steers via tracker gestures (the control plane), never a CLI ceremony — consistent with the eligibility-throttle model where authority is conveyed by a *write-abstained* label (ADR 0009, ADR 0011).

## Decision

Loop-authored PRDR moves pass through a **deterministic two-gate admission gate** — `faff prdr admit` — that wraps (never replaces) the pure mechanical `prdr supersede` linker. The gate is a **pure function** (no tracker/network call, parity with `faff next`): the agent maps the move's state onto closed-vocabulary flags and the CLI returns a `PrdrAdmissionVerdict` (`admit` / `propose-only` / `reject`). It computes three enforcements itself and folds in two delegated value-gate verdicts:

1. **Authority by provenance.** A loop may supersede a **loop-provenance** PRDR (subject to the other gates). Superseding a **human-provenance** PRDR yields **`propose-only`**: the loop writes the new PRDR `Status: Proposed`, which takes effect **only** when a human flips it `Status: Accepted` on the tracker. The loop **never self-ratifies** — it write-abstains from the `Accepted` transition, so an `Accepted` human-provenance supersession is, by construction, human-sanctioned. This reuses the **write-abstention provenance** pattern (ADR 0009 / ADR 0011) for ratification: authority is conveyed by the gesture faff refuses to make for itself.

2. **The recursive invariant — authority-by-level + per-increment immutability.** A PRDR is immutable to the work it governs: the inner loop running *under* a PRDR cannot supersede that PRDR (its own setpoint) — a `by_level: violation`. Only an **enclosing** authority re-derives it, and only **between** increments. "A loop can't move its own setpoint; its encloser can" is what makes moving project goalposts safe rather than a runaway.

3. **The thrash-ratchet.** A single lineage accruing ≥ `prdr.thrash_max` supersessions within `prdr.thrash_window` **escalates** (`ratchet.breached` → reject-to-human), catching slow accumulation of individually-plausible moves. Independently, **every** loop-supersession is adversarially drift-reviewed by the `review` slot (per-move direction-of-drift) — the ratchet is the volume backstop the CLI owns; the drift review is the consumer's per-move wiring.

The two **value gates** are delegated computations folded into the verdict, not judged here: the **upper/YAGNI** gate (FAFF-256 — "is this warranted, no gold-plating?") and the **lower/coverage** gate (FAFF-257 — "is every PRD goal still covered?"). When a gate verdict is absent the gate is **fail-safe**: a *new-capability* PRDR is **not** admitted without the YAGNI judge; a supersession that drops a goal's last live cover **escalates** (never silent abandonment); a like-for-like supersession is admitted. The constraint is: `admit` ⟺ `upper.admit ∧ by_level==ok ∧ ¬ratchet.breached ∧ lower.covered ∧ ¬(loop supersedes human)`; the lone-blocker `loop supersedes human` routes to `propose-only`, any hard violation to `reject`. A consumer-side `faff contract prdr-admission` shape validator guards that an `admit` it is handed actually satisfied the constraint.

## Consequences

- **Goalposts become machine-movable but human-bounded.** The loop re-derives project ends within the PRD box autonomously; the human only adjudicates the boundary cases (ratifying a move on a human-set goalpost, resolving an escalation) — and does so by a native-tracker status flip, no CLI.
- **The authority/value split is load-bearing.** FAFF-255 owns the framework + the deterministic authority/by-level/ratchet core and a fail-safe default; FAFF-256/257 own the value *judgements*. The gate is buildable and safe before those land (it conservatively refuses new capability and never abandons a goal), and tightens as they ship.
- **Write-abstention is now a cross-cutting authority primitive.** The same "faff refuses to make this write, so its presence proves a human made it" mechanism now underpins eligibility (ADR 0009 / ADR 0011) *and* PRDR ratification. A future audit of "what conveys human authority in faff" should treat write-abstention as the canonical answer.
- **Purity keeps it testable and composable.** Because `faff prdr admit` is a pure predicate over closed-vocabulary flags (like `faff next`, and like the forward-only container predicate of ADR 0021), it is `--selftest`-able, reusable across call-sites (L3 propose-for-approval, L4 self-admit), and free of tracker coupling.
- **Residual.** A raw tracker-MCP write bypassing the faff CLI could still forge an `Accepted` — a loud, off-script boundary (guardrail, not cryptographic control), the same residual the write-abstention model carries elsewhere. The thrash-ratchet's `thrash_window` filtering is the *agent's* responsibility (it supplies the in-window count); the CLI only compares to `thrash_max`.
