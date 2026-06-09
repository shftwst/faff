# ADR 0001 — Contract-as-code foundations

- **Status:** Accepted
- **Date:** 2026-06-09
- **Ticket:** FAFF-76 (de-risking spike under FAFF-21 — contract-as-code)
- **Supersedes / unblocks:** FAFF-77 (spec-contract vertical slice) and the FAFF-21 roll-out remainder

## Context

faff fixes a small set of internal **contracts** — the verdict states and vocabularies the pipeline branches on: spec-readiness, review-verdict, delivery-outcome, automation-routing (rendering has no internal contract). Today every one of these is **prose only**, and the `faffidavit-*` adaptors validate conformance **in prose / LLM judgement** — lenient and run-to-run variable on exactly the mechanically-checkable parts (markers present, one-per-decision-section, confidence-line format, verdict envelope). `faffidavit-spec` is the worst case: unlike review/ship/routing (which coerce an unmappable result to `needs-human` / `failed`), it has **no coercion** — a soft prose pass/fail.

FAFF-21 ("contract-as-code") replaces this with **conformance by construction**: a deterministic per-slot **contract script** consumes a producer's outcome and emits structured contract data *to a schema, or errors*; the adaptor shrinks to a thin shell that wires to the script; validation flips from "search the prose for markers" to "check the adaptor wires to the script".

That epic was blocked — and parked twice — on three foundational decisions with no codebase precedent. This ADR settles them so FAFF-77 can build with no open architectural questions. The deliverable of this spike is **the decisions below + one reference schema** (`skills/faff/contracts/spec-readiness.schema.json`) proving the chosen language works with zero dependencies.

## Decision 1 — Schema language + location

**Chosen: JSON Schema (a small Draft 2020-12 subset), as `*.schema.json` files under `skills/faff/contracts/`, validated by a hand-rolled dependency-free subset validator owned by the faff CLI.**

Options considered:

- **JSON Schema subset (chosen).** `JSON.parse` is a Node builtin, so reads need **zero** dependencies; the validator is a small hand-rolled subset checker, mirroring the existing `parseYamlSubset()` in `skills/faff/bin/faff`. JSON Schema is a recognised standard (the *understandable* tenet).
- **zod / ajv (rejected).** Both are npm dependencies. The faff CLI is verified dependency-free (imports only `node:fs` / `node:path`, no `package.json`); adding a runtime dep to read a contract schema breaks the invariant that lets the CLI run anywhere `node` exists.
- **Custom DSL (rejected).** Reinvents a standard, adds learning cost, and still needs a bespoke parser — worse on both *understandable* and *deterministic-tools* grounds.

**Subset to support** (sufficient for the flat contract shapes): `type`, `required`, `properties`, `enum`, `additionalProperties`, `items`. Richer keywords are added only when a contract actually needs one (the *anti-pattern* below).

**Location:** `skills/faff/contracts/<contract>.schema.json` — colocated with the CLI that is the schemas' only validator; one file per fixed contract (`spec-readiness`, `review-verdict`, `delivery-outcome`, `automation-routing`).

## Decision 2 — Producer artifact / extraction convention

**Chosen: a dual-path model, artifact-preferred — with Path B (opportunistic) migration as the durable posture.**

The contract script uses a **structured artifact when the producer emits one** (fully deterministic), and otherwise **falls back to LLM extraction from the producer's prose, failing loud** if the extraction is malformed (strictly better than today's lenient pass).

Options considered:

- **(A) Migrate every producer to emit a structured sidecar artifact now.** Maximally deterministic, but a suite-wide change touching `faffter-noon-spec`, `faffter-dark-nlspec`, `faffter-noon-review`, `faffter-noon-ship` before any payoff lands.
- **(B) Keep producers prose; the contract script extracts (LLM at the seam), fail-loud.** No producer changes; judgement remains at the seam.

**Migration posture (the human call, resolved 2026-06-09): Path B — opportunistic.** The extraction-seam-with-fail-loud is the *durable* design; artifact-emission is a per-producer optimisation adopted opportunistically when each producer is next touched anyway. It is **not** a committed epic-wide migration and **not** a gate on FAFF-77. This keeps the epic thin-slice-first (matches the value × risk decomposition): the spec-readiness hotspot fix ships with no producer change.

## Decision 3 — Coercion / fail-loud as deterministic rules

**Chosen: express each contract's coercion rule in the schema + script, not prose.**

The schema encodes the closed value-sets (the enums); the contract script encodes the coercion *direction* — mapping an unmappable input to the contract's safe terminal value deterministically:

| Contract | Safe target on unmappable input |
|---|---|
| review-verdict | `needs-human` (never `pass`) |
| delivery-outcome | `failed` (never `shipped`) |
| spec-readiness | **fail-loud error** — there is no safe coerce target today, which is precisely why it is the leniency hotspot |
| automation-routing | (assigned by the routing adaptor; out of this spike's reference scope) |

This only moves behaviour that the gateway already fixes from "prose the LLM re-interprets each run" to "a table the script executes identically every run" — the *deterministic-tools-over-prose* tenet.

## Decision 4 — Governance rule

**Chosen: the schema is normative for *shape*; the gateway prose is normative for *semantics*.**

Shape questions ("is `confidence` one of high/medium/low?", "is `decisions` an array of `{classification}`?") resolve to the schema. Meaning questions ("what does `medium` *mean* for promotion / routing?") resolve to the gateway. Recording this division prevents the schema from quietly becoming a second, drifting source of contract semantics.

## Decision 2a — Artifact transport convention (settled by FAFF-81)

Decision 2 chose a dual-path, artifact-preferred model but left *how* a producer emits its structured artifact open. FAFF-81 (the first per-producer Path-A adoption) settles it.

**Chosen: an embedded fenced code block, tagged `faff-contract:<contract-name>`.** A producer that participates appends **one** fenced block — as the **last** thing in its output — whose info-string is `faff-contract:<contract-name>` (e.g. `faff-contract:spec-readiness`) and whose body is the producer-authored part of that contract's extraction JSON. The adaptor locates the block by its info-string and `JSON.parse`s the body; absent → prose-extraction fallback; present-but-malformed → fail-loud (a corrupt artifact is producer breakage, not an absence).

Rationale: the block travels with the spec text automatically across producer → tracker comment → committed doc (a single source of truth that cannot drift from the prose it mirrors), and the adaptor locates it deterministically by a known delimiter — no LLM. **Rejected:** a sidecar file (`<spec>.contract.json`) — it needs its own attach/commit lifecycle (faff-prep deletes local producer files after attach) and can drift from the prose.

**What the producer emits vs what the adaptor adds:** the producer emits only what it authoritatively knows — for spec-readiness, `{ confidence, decisions:[{marker}] }`. Fields the producer cannot know at emit time (e.g. `provenance_present`, which reflects the provenance stamp faff-prep adds *after* the producer returns) are computed by the adaptor via deterministic structural detection, not declared in the block.

**Worked example (spec-readiness):**

````
```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "punt" } ] }
```
````

Later producers (review-verdict, delivery-outcome, automation-routing) adopt this convention opportunistically by copying it under their own `faff-contract:<contract-name>` tag, emitting the producer-authored part of their contract's extraction JSON.

## What FAFF-77 will implement (the wiring-check contract)

This spike *specifies* the check that `faff validate-adapters` will gain in FAFF-77 (it does not implement it here). For each adaptor that has a contract script, `validate-adapters` must assert:

```
- the adaptor's SKILL.md names its contract-script path
- the named script exists under skills/faff/contracts/ (or its sibling script dir)
- the adaptor declares the script the SOLE source of contract data
  (no prose-built contract-data path)
```

The "check the wiring" approach is sound **only if** the script is the sole path to contract data — that is the invariant `validate-adapters` enforces.

## Consequences

- FAFF-77 can build the spec contract script + thin `faffidavit-spec` + the wiring-check with **no open architectural questions**.
- New directory `skills/faff/contracts/` holds the schemas, examples, and the proof harness. It is not a slot-skill directory, so it does not affect `validate-adapters`' slot lint.
- The proof harness (`validate-schema.mjs`) is the spike's evidence, not the production validator — FAFF-77 ports `validateAgainstSchema` into the faff CLI.
- Because migration is **opportunistic** (Decision 2, Path B), the epic stays value-first: each later contract's roll-out is its own small slice rather than a big-bang producer migration.

**Anti-patterns recorded:**

- **Hand-rolling a *full* JSON Schema validator.** The contracts are flat enum/required shapes; a full validator is a dependency's worth of code for no benefit and re-introduces the maintenance the no-deps tenet exists to avoid.
- **Letting the schema encode semantics** (e.g. baking "medium ⇒ needs-decision-first" into the schema). That meaning lives in the gateway (Decision 4); duplicating it in the schema creates a drift source.
