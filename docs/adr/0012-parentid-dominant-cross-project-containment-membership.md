# ADR 0012 — parentId-dominant cross-project containment membership

- **Status:** Proposed
- **Date:** 2026-06-23
- **Issue:** FAFF-222

## Context

`faff contain` (FAFF-219, generalized by FAFF-222) answers one question for an autonomous
run: is an intended parent inside the subtree of the run's mandate? At L4 the mandate may be
an issue, project, or initiative, so the containment walk climbs typed edges across the mixed
Initiative ⊃ Project ⊃ Issue ⊃ sub-issue graph.

Linear permits a sub-issue whose own `projectId` differs from its parent issue's project. A
node can therefore carry **two** competing upward edges at once — its `parentId` (the parent
issue) and its own `projectId` (its containing project) — and the walk must pick exactly one
deterministic container-parent per node, or the contained/outward verdict becomes ambiguous.
Because this verdict gates whether autonomous work is allowed to be created, the choice is
security-relevant: a wrong "contained" silently widens autonomous scope.

## Decision

When an issue node carries both a `parentId` and a (possibly differing) `projectId`, the
containment walk climbs the **`parentId` edge first** and consults `projectId` **only at a
top-level issue** (one with no `parentId`). The explicit issue-parent link is the tightest,
most-intentional containment edge — a sub-issue genuinely lives under its parent's subtree —
so it dominates the node's own project membership.

Concretely, the per-node container edge (`containerParent`) is:

- **issue** → `parentId` if present, else `projectId` if present, else null (a top-level issue
  with no project is a root);
- **project** → `initiativeId` if present, else null;
- **initiative** → null (top of the hierarchy).

Consequences of `parentId`-dominance: a sub-issue S with `projectId = Q` whose parent issue I
is in mandate-project P is judged **contained** under P (the walk climbs S→I→P), regardless of
S's own project; a sub-issue whose parent issue is in a *different* project is **outward**.
Containment ids are compared by id only — Linear's issue/project/initiative id namespaces are
disjoint, so the walk needs no mandate-type argument.

## Consequences

- The rule lives entirely in the pure CLI core (`containerParent` / `subtreeContains` in
  `plugin/skills/faff/bin/faff`, FAFF-222) and is exercised by the `contain --selftest` table
  and `test/contain.test.mjs` — it is deterministic and offline-testable, never prose-resolved
  agent-side.
- It is **fail-closed** on every edge: an unknown/absent edge, an unknown node, a cycle, or an
  unknown `type` value resolves to `outward` (the unknown type is rejected at parse with usage
  exit 2). A false `outward` costs a human-cleared new-root request; a false `contained` would
  silently widen scope, so the walk never trades fail-closedness for convenience.
- It is the durable, cross-slice membership rule every future container-mandate consumer
  inherits — the autonomous-filing chokepoint wiring (FAFF-221 family) and the future L4
  orchestrator — so they all read containment the same way.
- **Operator-surprise surface:** an operator auditing a surfaced autonomous create may see a
  child whose Linear project differs from the mandate project yet was correctly judged
  `contained` under the mandate (because its parent issue is in-mandate). This is documented
  behaviour, not a bug. Revisit the membership rule only if real L4 runs show it surprising
  operators in practice.
- Sits under ADR 0010 (autonomous-execution blast-radius model) as the containment-membership
  detail of that blast-radius umbrella; it contradicts no live ADR (net-new semantics, no
  supersession).
