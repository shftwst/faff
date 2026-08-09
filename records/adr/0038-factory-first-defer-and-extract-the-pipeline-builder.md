# ADR 0038 — Factory-first: defer the reconfigurable-pipeline generalization; extract, don't fork

- **Status:** Accepted
- **Date:** 2026-07-02
- **Issue:** FAFF-69

## Context

faff today is *a specific factory*: an opinionated L4 lights-out delivery pipeline with **fixed** lanes (orchestrator / implementor / evaluator), fixed slots, and a fixed gate stack. It is converging on a provable v1 and is now in post-v1 hardening (the code-blind holdout is wired and enforced; FAFF-310 is the end-to-end proof still to run; FAFF-316 audits the trust gates).

The **FAFF-69 family** (capability / role / step / invocation model) — with **FAFF-315** (per-lane / per-capability config) alongside it — is not a feature *inside* that factory. Taken to its full extent it changes faff's **identity**: it turns the fixed structure into a **reconfigurable pipeline-builder**, with the current L4 factory demoted to *one configuration built on top*. That is a different product at a different altitude, with a different success metric ("a toolkit for building factories" vs. "a trustworthy factory that gets a thing built unattended").

Two forces are in tension:

- **Generalisation pressure** — make lanes/roles/steps/invocation pluggable.
- **Convergence pressure** — ship one coherent, *provable*, opinionated factory.

Three facts settle how to hold that tension:

1. **The near-term value needs a stable architecture.** Proving a *trustworthy* L4 factory (FAFF-310 e2e, the trust-gate audit, the governance ADRs) requires the lanes/slots/gates to hold still. A reconfigurable-pipeline refactor churns exactly those abstractions, with a blast radius across the gateway contract, every skill's dispatch, and the isolation model — i.e. it moves the ground under the thing being proven.
2. **You generalise *from* a proven instance, not *toward* one.** The right seams to make reconfigurable are the ones a working factory reveals. Generalise before that and you are guessing the abstraction — against faff's own YAGNI / proportionality instincts (FAFF-256).
3. **It is a spectrum, not a switch.** The slot model is already the first *working* rung of this generalisation — methodology / spec / review swap cleanly as configured slots. FAFF-69 is the next rung, not a from-scratch reframe.

The failure mode to avoid is running the identity-changing refactor **inline on main, mid-hardening** — it does more harm than good in the short term. The opposite failure — deferring the *decision* so long that faff ossifies into a single hard-coded factory and the platform never emerges — is equally real.

## Decision

1. **faff remains the specific L4 lights-out factory through v1-proven.** The broad reconfigurable-pipeline-builder generalisation (the FAFF-69 lane/role/step/invocation reframe) is **deferred off the critical path** — it is *not* done inline on main during post-v1 hardening, and *not* carried as a long-running divergent branch that perpetually conflicts with the hardening work.

2. **Decide the direction now; defer the execution.** This ADR is the direction call. The destabilising refactor waits until the specific factory is **proven end-to-end** (concretely: FAFF-310's holdout e2e green and the FAFF-316 trust-gate audit clean).

3. **When built, the builder is *extracted*, not *forked*.** The pipeline-builder is pulled out as a **lower layer** from the proven factory, and faff-the-L4-factory becomes a **configuration riding on it** ("a factory built on top of it"). One lineage; the builder is *validated by the factory that runs on it*. This avoids both the bit-rot of a long-running branch and the duplicated-maintenance drift of a fork.

4. **Prefer incremental generalisation over a big-bang.** Extend the proven slot model **one seam at a time on main**, each rung proven before the next, and let the builder **emerge** as the factory's real needs pull it — rather than a deliberate identity-changing refactor landed all at once.

5. **A genuine fork is reserved** for the day the two audiences (platform-builders vs. factory-adopters) demonstrably diverge enough that shared maintenance costs more than it saves — a call made *later, from the proven state*, not now.

**Scope note — FAFF-315 is not the deferred part.** Per-lane / per-capability *model selection* (FAFF-315) is a **narrow, additive** slice — a config surface + dispatch wiring that assigns a model per lane. It does not restructure the lanes and is safe to land on main independently (indeed it is the durable capability that lets a frontier model be pointed at just the trust-anchor lanes). It is the *broad* FAFF-69 lane/role/invocation reframe — the identity change — that this ADR defers.

## Consequences

- **Positive.** The "prove a trustworthy L4 factory" milestone keeps a stable architecture. The generalisation gains an evidence base before it is attempted. No perpetual-merge-conflict branch; no duplicated-maintenance fork.
- **FAFF-69 re-framed as deferred + incremental**, with an explicit trigger (factory proven) rather than an open-ended "someday". FAFF-315 explicitly carved out as safe-on-main.
- **The Fable-week plan is re-pointed** (FAFF-314): spend the scarce frontier window on *deepening and proving the specific factory* (governance ADRs, the trust-gate audit, the FAFF-310 proof) and on *authoring decisions like this one* — **not** on executing the big refactor.
- **Risk accepted + mitigated.** Deferring execution risks ossification; mitigated by (a) deciding the direction now (this ADR) and (b) advancing by proven incremental rungs rather than an indefinite freeze.
- **This extends, does not contradict, the slots / contract-as-code model** (ADR-0001) — it is the product-identity framing above that model, consistent with faff's concern boundary (faff owns the product it builds, generalising only from proven need).

**Open questions** (settled later, from the proven state — not now):

- Which of {lanes, roles, steps, invocation} become the builder's primitives, and in what order they are extracted.
- The precise "factory proven" trigger beyond FAFF-310-green + FAFF-316-clean.
- Whether the extracted builder is a library, a separate package, or a config layer within the same repo.
