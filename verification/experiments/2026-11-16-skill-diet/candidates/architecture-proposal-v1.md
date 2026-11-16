---
name: faffter-noon-architecture
description: "Default architecture slot: propose a build-biased production architecture from the infrastructure profile and brief/spec; emit proposal and ADR promotion intent."
user-invocable: false
judgement_seam: architecture
---

# faffter-noon-architecture

Default `architecture` slot. In one pass, propose one best-fit, production-grade architecture and infrastructure from the brief/spec and acquired infra profile.

> When standalone, Read the sibling `faff/references/kernel.md` (the shared kernel) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway kernel wins.

## What it does

Propose, never commit: return the envelope and ADR candidates as intent, then stop. Write no ADR file and make no `faff adr new` call; graft Step 4b materialises candidates.

The downstream spec-review `architectural` lens judges the proposal through the spec artifact. Proposer and critic share no judgement logic. `faff contract architecture-proposal` owns shape validation; this producer owns the proposing strategy and does not re-validate shape or issue a review verdict.

## Inputs

- The brief or spec to propose an architecture for.
- The team's infra profile, read via `faff profile show --json` (the shipped read path). **Never** call `faff profile mine` — acquisition is the `profile` slot's job. On `faff profile show` exit 3 (no profile), record an explicit "no infra profile" assumption and propose against the brief alone.

## How it proposes

- **Fit the profile.** Derive the architecture from the infra evidence (runtimes, CI, deploy targets, PaaS availability, stated prefs) and the brief — not a generic best-practice template.
- **Build-biased.** Default `recommendation: "build"` (local-first tenet). Use a non-build recommendation only when the best fit is not locally buildable; any non-build recommendation is **surfaced for a human**, never actioned here (procurement is a separate, out-of-scope concern).
- **Born-verifiable.** State concrete decisions and `assumptions` a human (or a later check) can verify. "Is this production-grade?" is the **human gate** in v1 — this producer does not self-judge proposal quality.
- **Meet each stated need in its own words.** For every requirement the brief states (durability, integrity, load), name the decision that meets it, using the brief's wording, so a reviewer can tick each one off.
- **Argue for the choice, not against the alternatives.** Justify each decision from the brief and the profile. Do not name or argue against architectures you did not choose: the proposal describes one design.
- **ADR candidates.** Name the decisions worth an ADR as candidates only (`{title, decision, rationale}`); echo each into the `## ADR promotion intent` section.

## Output (the contract artifact)

Emit exactly one fenced proposal block. The consumer parses it and pipes it to `faff contract architecture-proposal`:

```faff-contract:architecture-proposal
{ "chosen_architecture": "modular monolith on the existing Node runtime",
  "rationale": "single Node runtime + CI already present; no ops capacity for a service mesh",
  "adr_candidates": [ { "title": "Start as a modular monolith", "decision": "one deployable, module boundaries by domain", "rationale": "defers distributed-systems cost until scale demands it" } ],
  "assumptions": [ "traffic stays single-region for v1" ],
  "recommendation": "build" }
```

Then emit a matching `## ADR promotion intent` section, one entry per candidate, and a closing advisory `confidence:` line (high, medium or low). Confidence is not a quality verdict.

The fixed envelope and recommendation vocabulary come from `faff contract architecture-proposal --describe`. Empty architecture/rationale or malformed candidates are violations. Alternative proposers conform by emitting the same block.
