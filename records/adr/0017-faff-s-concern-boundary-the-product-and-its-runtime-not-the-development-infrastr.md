# ADR 0017 — faff's concern boundary: the product and its runtime, not the development infrastructure

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

As faff climbs toward L4 (lights-out, unattended) operation, a recurring scoping question keeps resurfacing: **how much of the security / sandbox / CI / repo-hygiene surface should faff itself own?**

Early work answered "a lot." The *Agent authority & blast-radius* and *Secrets & sensitive-data protection* initiatives spawned tickets that treated the **execution sandbox and supply-chain as faff deliverables**:

- FAFF-100 — sandbox / permission-boundary mechanism spike
- FAFF-102 — supply-chain / dependency-addition vetting for unattended runs
- FAFF-105 — autonomous-execution permission boundary (runtime allowlist enforcement)

All three were **cancelled**. ADR-0010 had already settled the narrower question — the autonomous-execution blast-radius boundary is a **containerised Claude Code, not a faff-owned sandbox** — but the *general principle* behind that call was never written down, so the question kept being re-litigated per ticket (and a recent lights-out roadmap assessment wrongly put a months-long "cage rebuild" back on faff's critical path).

The boundary is real and load-bearing, and it generalises beyond the sandbox: it determines what faff builds, what it merely *asserts as a precondition*, and what it leaves entirely to the environment it runs in.

## Decision

**faff's concern is (a) *what is being built* — the product — and (b) *the infrastructure the built product runs on* — its deployment/runtime target. faff is *not* concerned with the *development* infrastructure itself.**

Concretely:

- **In scope (faff's domain):**
  - The product: the PRD/PRDR ends, the per-slice specs, and the code that satisfies them.
  - The **product's runtime / deployment infrastructure** — *where the built product lives* (PaaS, environment, runtime profile). This is exactly why the infra-profile work (FAFF-26 / FAFF-231) is legitimate faff scope: it acquires the *product's* infra context, not faff's own.

- **Out of scope (development infrastructure — a precondition, set up *around* faff, never decided or built *by* it):**
  - the git repository, CI, branch protection;
  - dependency-vulnerability monitoring, secret scanning, supply-chain vetting;
  - the execution sandbox / permission boundary.

  These are **repo-hygiene + platform tooling**. Delivering a lights-out project already presupposes a repository, so it is reasonable to expect this hygiene to be set up as a *given*, on the platform that hosts the work — not re-implemented or re-decided inside faff.

- **The L4 "cage" (blast-radius boundary) is containerisation** (ADR-0010): the most mechanical boundary available, an **environmental precondition** that needs only *guidance* from faff, not engineering.

- **faff may *assert* a dev-infra precondition; it must not *implement* one.** `faff container-check` (FAFF-42) is the canonical shape: faff *checks* it is running inside a contained blast radius (a preflight assertion) and refuses if not — it does **not** build the container or the sandbox.

The scoping test for any future security/infra/CI/sandbox work is therefore one question:

> *Is this the **product's** runtime, or **faff's own** development environment?*

Only the former is faff's concern. Assert the latter as a precondition; never build or re-decide it.

## Consequences

- **The cancelled security tickets (FAFF-100 / 102 / 105) stay cancelled.** They are better covered by the git platform and standard repo-hygiene tooling than by faff. Do not reinstate them as faff builds.
- **The "cage" is off faff's critical path to lights-out.** It is a precondition plus (at most) a short guidance doc — not an engineering pillar. This removes a falsely-scoped multi-month item from the L4 timeline: the remaining faff delta to trustworthy lights-out is the **leash** (PRD/PRDR + gates), the **runner** (FAFF-225 wiring), and the **judge** (FAFF-34 evaluator — the genuine crux), not a sandbox rebuild.
- **A "lights-out preconditions" expectation is documentable, not buildable:** run faff inside a container (ADR-0010), with repo-hygiene tooling (dependency-vulnerability monitoring, secret scanning) already in place. faff's only mechanical touchpoint is the `faff container-check` preflight assertion (wired into the runner before it goes dark).
- **The product's *runtime* infrastructure remains firmly in scope** — the infra-profile line (FAFF-26 / FAFF-231) is correctly faff work, because it concerns where the *product* is deployed, not faff's dev rig. This ADR sharpens, not narrows, that distinction.
- **Reinforces the governing principle "adoptable, not all-encompassing":** faff slots into an existing repo + platform; it does not absorb the platform's responsibilities.
- **Relates:** ADR-0010 (the blast-radius containerisation call this generalises) and ADR-0013 (infra-profile storage — the in-scope product-runtime side of the same boundary).
