# ADR 0006 — Autonomous build-order dependency inference lives in conflict analysis, not the methodology slot

- **Status:** Accepted
- **Date:** 2026-06-22
- **Issue:** FAFF-215
- **Initiative:** Lights-out operations

## Context

For L3/L4 autonomy a beep-boop run must sequence a dependent build *after* the work it depends on without a human having pre-declared the blocker. beep-boop's conflict analysis already partitions the build queue into independents and serialised collision groups, but only on *contention* (shared file/dir/named-symbol) or a *human-declared blocker*. It misses the asymmetric producer→consumer case (B creates a module/endpoint/migration/symbol/config-key; A assumes it exists) because the two specs share no file and no symbol the matcher can see — both read as independent, so A may build before B.

Closing that hole requires producer→consumer inference. The question this ADR settles is **where that inference lives**, because the answer is cross-slice and durable: it decides whether dependency inference is a methodology concern or a conflict-analysis concern across the whole suite.

Two constraints bound the choice:

- **Default-safe.** The zero-config structural-default methodology (`faffter-noon-methodology-structural`) has no agile-Principle-6 "surface dependencies" equivalent, and beep-boop does not request P6-bearing outputs at the build-pass boundary. Any design that routes inference *through* a methodology leaves default-config users with no producer→consumer inference at all.
- **Correctness, not ordering opinion.** Partitioning "can these ship in parallel without breaking" is conflict analysis's existing remit. It is distinct from "which work matters more" — the methodology's `pick-ordering` value/risk/priority judgement (gateway → Ordering & judgement delegation). Inference adds only serialisation edges; it must never reorder independents.

## Decision

Autonomous build-order dependency inference lives in beep-boop **conflict analysis**, as a sixth heuristic — **not** in the `methodology` slot.

It is the only option that is default-safe for free (it works under the structural default with no methodology change), keeps the inference correctness-scoped rather than an ordering opinion, and reuses conflict analysis's existing serialise-into-groups output and "when in doubt, serialise" bias.

**Rejected alternatives** (captured so they are not re-proposed):

- **Route inference through the methodology** — fails default-safe (structural default has no Principle 6; beep-boop doesn't request P6-bearing outputs at the build-pass boundary), and gives inference two homes.
- **A new `faff infer-deps` CLI seam** — the natural-language produces/consumes matching is LLM-judgement a deterministic CLI can't own today.

## Consequences

- Producer→consumer dependency inference is, suite-wide, a **correctness** concern owned by conflict analysis — methodology-agnostic, and out of the methodology's ordering-opinion remit. Any future dependency-inference work is constrained to live here; this outlives FAFF-215's slice.
- Inference is **run-local serialisation only**: it serialises the build for the current run and surfaces each inferred edge in the run summary, but writes **no** tracker blocker link and adds **no** config knob. Authoring a link between two existing human-owned tickets is human-only across the suite (jot/plot at creation; tidy surfaces but refuses to auto-write) — a build skill must not cross that line.
- Agile Principle 6 stays the *grooming-time* dependency surfacing; this heuristic is the *build-time* backstop. They are complementary, not duplicative.
- Inferred edges (firm and ambiguous) are recorded with quoted evidence and surfaced in the run summary, so the serialisation is auditable without a tracker mutation.
