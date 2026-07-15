# faff-lab — the sixth external-verification rung

faff-lab is the public gallery site — itself faff-built — that puts a raw one-shot model run and a faff L4 run side by side against the same shared brief, per task category. Unlike the throwaway SUTs P1–P5 (which live only as a scaffolded repo and are discarded after the rung is scored), faff-lab is a **long-lived, real deliverable**, so its setpoint lives here as a real committed document rather than as a heredoc inside a scaffold script.

- **[`PRD.md`](./PRD.md)** — the canonical, immutable human setpoint. It is committed verbatim; a lights-out run reads it and never edits it. The FAFF-505 scaffold (`scaffold-faff-lab.sh`) copies this file into the SUT rather than heredocing its own copy, so the PRD stays singly-sourced.
- **Tracker decision:** git-only-first — see [ADR 0067](../../adr/0067-faff-lab-tracker-vs-git-only.md).

## Running faff-lab (the real admission flow)

A lights-out run admits the PRD through two distinct layers. **These are the real `faff` commands** — do not use the non-existent `faff prd` file-ingest (`--from`) or `admit` forms that some earlier scaffold runbooks cite (see the note below).

### Layer 1 — PRD-readiness (the L4 run-start gate)

At L4 run-start (faff-beep-boop's PRD-admissibility pre-check), the `prd` slot (default `faffter-noon-prd`) reads **only** the PRD document and emits one `faff-contract:prd-readiness` block. That block is piped to the deterministic validator:

```
faff contract prd-readiness      # admit the run | refuse (fail-safe)
```

An `admissible` verdict admits the run; anything else refuses it before the run mints.

### Layer 2 — PRDR-level admission (separate from prd-readiness)

The per-container Definition-of-Done record (PRDR) is authored and admitted with:

```
faff prdr new <title> --container <slug> --prd-goal <goal> --provenance human|loop
faff prdr admit <prdr> --actor loop|human …
```

### The real `faff prd` surface

`faff prd` exposes exactly: `path | new <container> | link | list | validate`. `faff prd new` writes a **fresh template** to `docs/prd/<slug>.md` — it does **not** ingest an existing PRD file, and there is **no** `--from` flag and **no** `admit` subcommand on `faff prd`. (Some earlier scaffold runbooks cite a `faff prd` `--from` ingest and a `faff prd` `admit` gate; neither exists — tracked for correction in FAFF-507.)

## Git-only-first, with a documented upgrade path

The first faff-lab run is **git-only** — it exercises the full PRD/PRDR + prd-readiness gates with zero Linear provisioning. Once the loop is proven in anger, upgrade to a dedicated tracker container by adding a `tracking:` block (`project_id` / `team_key`) to the SUT's `.faffrc.yaml`, dropping `automation_default`, and letting the tracker own the eligibility labels. Rationale and trade-offs: [ADR 0067](../../adr/0067-faff-lab-tracker-vs-git-only.md).
