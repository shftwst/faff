---
name: faffter-noon-architecture
description: "Default `architecture` slot occupant — the generative architecture/infra PROPOSER. Reads the team's infra profile + the brief/spec and proposes one best-fit, build-biased, production-grade architecture, emitting a founded `faff-contract:architecture-proposal` block + ADR promotion intent. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: architecture
---

# faffter-noon-architecture

The default occupant of the **`architecture`** slot — the generative half of faff's architecture story. Given a brief or spec plus the team's acquired infra profile, it **proposes** one best-fit, production-grade architecture + infra, reasoned. It is the missing PROPOSE box: faff already records ADRs (the `adr` slot), critiques a spec's design (the spec-review `architectural` lens), and acquires the infra profile (the `profile` slot) — this generates the proposal those steps then judge.

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

## What it does

One LLM pass turns the brief/spec + infra profile into one proposal envelope. It **proposes, never commits**: it emits the envelope + ADR candidates as *intent* and stops. It writes nothing to the configured ADR directory and makes **no `faff adr new` call** — graft Step 4b materialises any candidate. It runs no review or verdict logic; the only contact with the downstream spec-review `architectural` lens (the critic) is the spec artifact the proposal lands in — the proposer/critic boundary, where the proposer generates and the critic judges, sharing no logic.

The contract (`faff contract architecture-proposal`) validates the envelope's **shape** only. This producer owns the **proposing strategy** — how the design is fitted. Do not re-validate shape here; emit a conformant block and let the consumer pipe it.

## Inputs

- The brief or spec to propose an architecture for.
- The team's infra profile, read via `faff profile show --json` (the shipped read path). **Never** call `faff profile mine` — acquisition is the `profile` slot's job. On `faff profile show` exit 3 (no profile), record an explicit "no infra profile" assumption and propose against the brief alone.

## How it proposes

- **Fit the profile.** Derive the architecture from the infra evidence (runtimes, CI, deploy targets, PaaS availability, stated prefs) and the brief — not a generic best-practice template.
- **Build-biased.** Default `recommendation: "build"` (local-first tenet). Use a non-build recommendation only when the best fit is not locally buildable; any non-build recommendation is **surfaced for a human**, never actioned here (procurement is a separate, out-of-scope concern).
- **Born-verifiable.** State concrete decisions and `assumptions` a human (or a later check) can verify. "Is this production-grade?" is the **human gate** in v1 — this producer does not self-judge proposal quality.
- **ADR candidates.** Name the decisions worth an ADR as candidates only (`{title, decision, rationale}`); echo each into the `## ADR promotion intent` section.

## Output (the contract artifact)

Emit exactly one fenced block as the producer's output — the consumer locates it, `JSON.parse`s it, and pipes it to `faff contract architecture-proposal` (the sole source of contract data):

```faff-contract:architecture-proposal
{ "chosen_architecture": "modular monolith on the existing Node runtime",
  "rationale": "single Node runtime + CI already present; no ops capacity for a service mesh",
  "adr_candidates": [ { "title": "Start as a modular monolith", "decision": "one deployable, module boundaries by domain", "rationale": "defers distributed-systems cost until scale demands it" } ],
  "assumptions": [ "traffic stays single-region for v1" ],
  "recommendation": "build" }
```

Then emit a matching `## ADR promotion intent` section (one entry per candidate) and a closing `confidence:` line (`high` / `medium` / `low`) — an advisory self-rating of the proposal, never a quality verdict.

`recommendation` is one of a closed three-value set (canonical semantics: `faff contract architecture-proposal --describe`; enforced via `violations`); empty `chosen_architecture`/`rationale` or a malformed candidate is a contract violation. A swapped-in proposer (e.g. a cost-first or cloud-native strategy) conforms by emitting the same block.
