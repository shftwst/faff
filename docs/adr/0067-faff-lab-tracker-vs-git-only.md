# ADR 0067 — faff-lab: tracker vs git-only for the first run

- **Status:** Accepted
- **Date:** 2026-07-15
- **Issue:** FAFF-504
- **Supersedes / unblocks:** unblocks FAFF-505 (scaffold-faff-lab.sh)

## Context

faff-lab is the sixth external-verification rung: the public gallery site — itself faff-built — that compares raw one-shot model runs against faff L4 runs per task category. Unlike the throwaway SUTs P1–P5 (all git-only, discarded after scoring), faff-lab is a long-lived, real deliverable, and the currently-active priority is closing the L4 loop end-to-end as fast as possible so faff-lab comparison runs can be generated.

Before FAFF-505 can scaffold the faff-lab SUT, one policy question must be settled: does the first faff-lab run bind to a dedicated tracker container (a Linear team or project, via `tracking.*` keys), or run git-only? Binding a Linear container up front requires provisioning `tracker` + `team_key` + `project_id` + `repo` and wiring tracker-owned eligibility labels — real setup that stands between here and a first run. The P1–P5 scaffolds already document the git-only→tracker upgrade path (add a `tracking:` block, drop `automation_default`, let the tracker own eligibility labels), and note that git-only is enough to exercise the PRD/PRDR admission gates.

## Decision

**Chosen: git-only-first.** The first faff-lab run is git-only, with the tracker upgrade documented as a proven follow-up.

Options considered:

- **git-only-first (chosen)** — run the first loop with no Linear provisioning. It exercises the full PRD/PRDR + `faff contract prd-readiness` admission gates against git alone, so the L4 loop is proven with zero tracker setup. When the loop is proven in anger, upgrade by adding a `tracking:` block (`project_id` / `team_key`) to the SUT's `.faffrc.yaml`, dropping `automation_default`, and letting the tracker own the eligibility labels — the same upgrade path the P1–P5 scaffolds already document.
- **Dedicated Linear container up front** — provision a Linear team/project and bind it via `tracking.*` before the first run. Rejected for the first run: it front-loads tracker provisioning ahead of the code that would consume it, delaying the active priority (closing the loop) for richness the first proving run does not need.

## Consequences

- The first faff-lab loop runs with zero Linear setup, exercising the full PRD/PRDR + prd-readiness admission gates against git alone — the fastest path to a proven L4 close.
- Trade-off: no tracker-driven eligibility labels (`faff-automate` / `faff-parked`) or steer-via-comment richness until the upgrade; git-only leans on `automation_default` for the autonomous on-switch.
- The upgrade to a dedicated Linear container is a reversible, documented follow-up (a `tracking:` block + dropping `automation_default`), taken once the loop is proven — not a rebuild.
- This ADR binds FAFF-505's scaffold (`.faffrc.yaml` shape) and FAFF-506's rubric work. Because it is sequenced first and is itself supersedable, a wrong call surfaces as a cheap doc/ADR edit rather than scaffold rework.
