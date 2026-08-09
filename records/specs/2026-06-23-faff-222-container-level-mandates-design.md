# FAFF-222 — Container-level mandates for scope-containment (L4 generalization)

> Spec: faffter-dark-nlspec · 2026-06-23 · interactive · confidence: high. Full spec on Linear FAFF-222.

> **Revised 2026-06-23** — resolved both open punts: autonomous creation ceiling → **project-mandate cap**; wiring scope → **primitive-only / follow-on**. Confidence raised medium → high. (Original draft was medium with these two as open `Punt:`s.)

This spec is for the build agent and human reviewers. It defines how to generalize the pure `faff contain` CLI primitive (shipped in FAFF-219) so the *mandate* an autonomous run is bound to may be a **project** or **initiative**, not only an issue — extending "may only create work inside the subtree of the mandate" from a single `parentId` chain to a walk across the mixed Initiative → Project → Issue → sub-issue containment graph.

## 1. WHY — Problem and Principles

**The load-bearing model:** containment is one question — *is the intended parent inside the subtree of the mandate?* — answered by walking **containment edges** upward from the parent until we either reach the mandate (contained) or run out (outward, fail-closed). FAFF-219 walks one kind of edge: a sub-issue's `parentId`. This change lets each node climb a **typed** containment edge — sub-issue→parent-issue, top-level-issue→project, project→initiative — so the same upward walk answers the same question when the mandate is a container. The walk stays a single chain; only the edge a node climbs becomes type-dependent.

**Problem statement.** Today an autonomous run's mandate is always an issue, so `faff contain` only walks `parentId` (FAFF-219, `plugin/skills/faff/bin/faff:1437–1606`). At L4 (project "Down the pub — trustworthy lights-out v1") a run may be dispatched to deliver a whole **project** and must be allowed to create issues *within* it — which today's homogeneous walk cannot express. This change generalizes the primitive to climb typed containment edges while preserving the issue-level contract FAFF-219 ships.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **The walk stays in the pure CLI; the graph is still agent-fetched.** `faff contain` performs no tracker/MCP call (parity with `eligible`/`next`/`intakecheck`). The agent fetches the mixed-graph ancestry and passes it via `--ancestry`; the CLI walks it. The *type-edge selection* must live in the tested CLI core, **not** in skill prose — that is the deterministic-tools-over-prose tenet, and the reason the membership rule is testable.
- **Fail-closed is preserved on every typed edge.** A walk that exhausts to a root ≠ mandate, hits an unknown/absent edge, hits an unknown node type, or hits a cycle returns `outward`. A false `outward` costs a human-cleared new-root request; a false `contained` silently widens scope. Never trade fail-closedness for convenience on any edge.
- **Backward compatibility is a hard constraint, not a nicety.** Every existing `{id, parentId}` ancestry, the 11-case `--selftest` table, and `test/contain.test.mjs` must pass **unchanged**. The typed form is a superset; the untyped form keeps its exact meaning.
- **Containment never means "has a container."** It means `parent ∈ subtree(mandate)`. The mandate is orchestrator-supplied; the run cannot widen it. `--root` (an intended new top-level container) is `outward` by definition.
- **The primitive is type-agnostic; the autonomous *ceiling* is a policy, not a primitive concern.** The CLI computes containment for issue, project, *and* initiative mandates identically. How far up an autonomous run may be dispatched (the ceiling) is enforced at the wiring layer, never in the walk — see the autonomous-ceiling decision in WHAT.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff:1437–1606` (`cmdContain`, `subtreeContains`, `parseAncestry`, `containSelftest`) | Node (deps-free) | The exact primitive this generalizes. |
| `plugin/skills/faff/bin/faff:1033–1090` (provenance schema 2, `initiated`) | Node | Audit field stamped at the chokepoints; unchanged here. |
| `test/contain.test.mjs` (21 cases) | Node test | The contract that must keep passing; gets the new typed cases. |
| `plugin/skills/faff-beep-boop/SKILL.md:175–207`, `plugin/skills/faff-tidy/SKILL.md:140–146` | Skill prose | The chokepoints that call `faff contain` (issue mandates today; the future home of the project-mandate cap). |

**Scope statement.** This is the pure-CLI primitive layer of the L4 blast-radius model (ADR 0010); it is what a future L4 orchestrator's container-mandate dispatch will call — it does not itself dispatch container mandates.

## 2. OUT OF SCOPE

- **Rewiring the chokepoints to *source* container mandates** — beep-boop §10 and tidy chain-gap still pass issue mandates; nothing dispatches a project/initiative mandate until the L4 orchestrator exists. **Why excluded:** there is no producer of container mandates today, so wiring one in would be dead code. This is a settled sequencing decision — see *Design decision — wiring scope*. **Extension point:** the `mandate :=` line in `faff-beep-boop/SKILL.md:175–207` and `faff-tidy/SKILL.md:140–146`, plus enforcement of the project-mandate cap, once an L4 run carries a container mandate.
- **Autonomous *creation* of projects/initiatives** — explicitly **out of bounds** for autonomous runs (see *Design decision — autonomous creation ceiling*); and in any case this primitive only answers contained/outward, it does not perform or authorize the create. **Why excluded:** container creation is human-gated; the create op + appetite gate live at the chokepoints. **Extension point:** the chokepoint create step, if the ceiling is ever raised.
- **FAFF-216's structural self-curation axis** (re-link/re-prioritise machine-authored work) — adjacent but feasibility-blocked and descoped. **Why excluded:** a different concern (curation, not containment). **Extension point:** `design/planning-loop.md` "within-run convergence (L4)".
- **Agent-side mixed-graph *fetching* logic** beyond the entry shape this spec defines — how the orchestrator pulls `projectId`/`get_project`/`get_initiative` is the caller's concern. **Why excluded:** CLI stays pure; fetching is tracker-coupled. **Extension point:** the chokepoint's `ancestry :=` fetch step.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Mandate | The container the orchestrator dispatched the run to deliver — now an issue, project, or initiative id. |
| Containment edge | The single upward "is contained by" link for a node, chosen by the node's type. |
| Container parent | The id a node's containment edge points to (or null = a root). |
| Subtree(mandate) | All nodes whose container-parent chain reaches the mandate. |
| Mixed graph | The heterogeneous Initiative ⊃ Project ⊃ Issue ⊃ sub-issue hierarchy. |
| Autonomous ceiling | The highest mandate type a lights-out run may be dispatched on (this spec: project). A policy enforced at the wiring layer, not the primitive. |

**The generalized ancestry entry.** Today's entry is `{ id, parentId }`. The typed form adds an optional `type` and the container edges:

```
RECORD AncestryEntry:
  id: string                       # node id (issue key, project UUID, initiative UUID)
  type: "issue" | "project" | "initiative"   # OPTIONAL; absent ⇒ "issue" (backward compat)
  parentId: string | null          # parent ISSUE (sub-issue → parent issue)
  projectId: string | null         # containing PROJECT (top-level issue → project)
  initiativeId: string | null      # containing INITIATIVE (project → initiative)

  # All edge fields optional; absent/null ⇒ no edge of that kind.
```

**Container-parent function — the one new piece of logic, by type:**

```
FUNCTION container_parent(entry):
  type := entry.type OR "issue"        # absent ⇒ issue (backward compat)
  IF type == "issue":
     RETURN entry.parentId   if present        # climb issue hierarchy FIRST
     ELSE entry.projectId    if present         # then jump to containing project
     ELSE null                                  # a top-level issue with no project = root
  IF type == "project":
     RETURN entry.initiativeId if present ELSE null
  IF type == "initiative":
     RETURN null                                # initiatives are top of the hierarchy
  # unknown type value reaching here is impossible: rejected at parse → usage exit 2
```

**Design decision — entry representation.** Options: (a) a flat single `container` field the agent pre-resolves; (b) typed entries with per-type edge fields, CLI resolves `container_parent`. (a) pushes membership semantics into agent prose (untestable, off-tenet); (b) keeps it in the tested core and is a clean superset of `{id, parentId}`.
**Chosen:** (b) typed entries with edge fields; the CLI computes `container_parent`. Backward compat falls out: an untyped `{id, parentId}` entry is an `issue` whose container edge is `parentId` — identical to today.

**Design decision — where typed-edge selection lives.** **Chosen:** in `subtreeContains`/`container_parent` inside `bin/faff`, exercised by the selftest table and `test/contain.test.mjs`. Rationale: the membership rule is the deterministic core; prose-side resolution would make containment correctness untestable and violate deterministic-tools-over-prose.

**Design decision — sub-issue in a different project from its parent.** Linear permits a sub-issue whose own `projectId` differs from its parent issue's project. **Chosen:** climb `parentId` first and consult `projectId` **only** at a top-level issue (no `parentId`). Rationale: the explicit issue-parent link is the tightest, most-intentional containment edge; a sub-issue genuinely lives under its parent's subtree, and a parent in mandate-project P makes the child contained regardless of the child's own `projectId` quirk. This is the conservative reading of "subtree" and keeps a single deterministic parent per node. *(This is the durable, cross-slice membership rule promoted to an ADR — see the ADR-promotion-intent comment.)*

**Design decision — `--root` and base case for containers.** **Chosen:** unchanged. `--root` ⇒ `outward` (an intended new top-level container needs human sanction). `parent == mandate` ⇒ `contained` base case — which now also covers "create an issue directly under the mandate-project" (parent id equals the container mandate id). No new flag needed.

**Design decision — autonomous creation ceiling (resolves former Punt 1).** The primitive computes containment for an issue, project, *or* initiative mandate; this decision is *how far up a lights-out run may be dispatched*, independent of the walk. Options: cap at project mandate (autonomous may create issues/sub-issues within a sanctioned project, never the project/initiative itself); allow initiative mandate (autonomous may create whole projects under a sanctioned initiative); or stay at today's issue-mandate ceiling.
**Chosen:** cap at **project mandate**. An autonomous run may hold an issue or project mandate and create issues + sub-issues within it; **creating projects or initiatives stays human-gated.** Rationale: container *creation* is a top-down planning/strategy act with high blast-radius, weak structural provenance (per-issue `initiated` only; no tracker activity-history to attribute a machine-created container), and expensive cleanup — whereas container *population* (issues within a human-sanctioned project) is bounded, reversible, execution-flavoured work. The cap lets initiative-scale lights-out populate a human-created project shell without letting the agent self-manufacture structure (a created project would otherwise become a valid ancestor for unbounded further "contained" creation). **Enforced at the (future) wiring layer, not the CLI** — the primitive stays type-agnostic; the chokepoint refuses to dispatch an initiative mandate to an autonomous run. Raising the ceiling later is a wiring change, not a primitive change. (Matches faff's fail-safe opt-in posture + ADR 0010.)

**Design decision — wiring scope for this ticket (resolves former Punt 2).** Options: rewire the beep-boop/tidy chokepoints to accept a container mandate now; or ship the primitive only and defer wiring.
**Chosen:** **primitive only** — this ticket ships the generalized pure CLI + tests; chokepoint rewiring (and enforcing the project-mandate cap above) is a follow-on, gated on an L4 orchestrator that can actually dispatch a container mandate. Rationale: no producer of container mandates exists today, so wiring now would be inert/dead code. The cap is recorded here as the policy that wiring must implement when it lands.

**CLI surface (unchanged signature, widened `--ancestry`):**

```
faff contain <mandate> (--parent <id> | --root) --ancestry <json> [--json]
  # --ancestry: JSON array of AncestryEntry (typed superset of {id, parentId})
  # exit 0 contained · 3 outward (fail-closed) · 2 usage (malformed/unknown type)
  # --json: { "mandate", "parent", "root", "verdict" }  (shape unchanged)
```

The `<mandate>` and `--parent` ids are compared by id only; Linear's issue/project/initiative id namespaces are disjoint, so the walk needs no mandate-type argument. Mandate **type** matters only for the autonomous-ceiling policy (enforced at the wiring layer, above), not for the walk.

## 4. HOW — Behavior

**Architecture.** The change is localized to `cmdContain`/`subtreeContains`/`parseAncestry` in `bin/faff`. `parseAncestry` is widened to accept and validate the typed fields; `subtreeContains` calls `container_parent(entry)` instead of reading `parentId` directly. The single-chain visited-guarded walk is otherwise identical.

```
PROCEDURE subtree_contains(mandate, parent, entries_by_id):
  1. IF parent is the --root sentinel: RETURN outward
  2. cursor := parent ; VISITED := {}
  3. WHILE cursor is not null AND cursor not in VISITED:
     a. IF cursor == mandate: RETURN contained         # base case + transitive
     b. VISITED.add(cursor)
     c. entry := entries_by_id.get(cursor)              # null if cursor not in ancestry
     d. cursor := entry ? container_parent(entry) : null   # unknown node ⇒ null ⇒ exhaust
  4. RETURN outward   # root ≠ mandate, unknown link, or cycle (fail-closed)
```

```
PROCEDURE parse_ancestry(json):                          # widened from FAFF-219
  1. arr := JSON.parse(json)        # throw → caller maps to usage exit 2
  2. IF arr not an array: throw
  3. FOR each e in arr:
     a. IF e not object OR e.id not string: throw
     b. IF e.type present AND e.type ∉ {issue,project,initiative}: throw   # unknown type ⇒ usage 2
     c. store entry {id, type?, parentId?, projectId?, initiativeId?}, coercing absent edges to null
  4. RETURN map id → entry
```

**Behaviour notes:**
- `parseAncestry` now stores the **whole entry** per id (not just `parentId`), so `container_parent` can read the type-appropriate edge. The untyped `{id, parentId}` case stores `{type: issue (default), parentId, projectId: null, initiativeId: null}` → `container_parent` returns `parentId` → identical walk to FAFF-219.
- The base case at step 3a fires before any lookup, so `faff contain <M> --parent <M>` still needs no ancestry — for issue, project, and initiative mandates alike.

**Edge cases and error handling:**
- **Unknown node in the walk** (cursor not in the ancestry map) → `container_parent` not consulted, cursor becomes null → exhaust → `outward` (fail-closed). Same as today's unknown-`parentId`.
- **Node with no edge of any kind** (e.g. a project with null `initiativeId`) → `container_parent` returns null → exhaust → `outward` unless it *is* the mandate.
- **Unknown `type` value** → `parseAncestry` throws → **usage exit 2** (parity with `--via` validation), so a typo in the agent's fetch is a loud failure, not a silent verdict.
- **Malformed JSON / non-array / missing string id** → usage exit 2 (unchanged).
- **Cycle across typed edges** (project→initiative→…→project) → visited guard terminates → `outward`.
- **Mixed typed + untyped entries in one ancestry** → fine; untyped entries default to issue.

**Failure modes (above-the-bar — this is a security-relevant primitive):**
- **The failure:** the parentId-dominant rule calls a child `contained` under mandate-project P when the operator's mental model said the child's own `projectId=Q` should make it outward. **How you'd know:** a created issue lands under an issue in P but shows project Q in Linear; a reviewer flags it during the surfaced-create audit. **What it means:** proceed — this is the documented Chosen rule (subtree dominance), not a bug; revisit only if real L4 runs show it surprising operators (then escalate the membership rule).
- **The failure:** the type-edge logic lives partly agent-side after all (if the agent pre-flattens), making containment depend on un-tested prose. **How you'd know:** a containment bug that the CLI selftest cannot reproduce. **What it means:** abandon any agent-side flattening; the Chosen design forbids it — all edge selection is in `container_parent`.
- **The failure:** a false `contained` silently widens scope (the cardinal risk). **How you'd know:** an `outward`-by-correct-reading create slips through as `contained`. **What it means:** the fail-closed default on every unknown/absent/cycle path is the backstop; any path that could return `contained` without reaching the mandate id is a blocker bug.

**Anti-pattern:** resolving `projectId`/`initiativeId` by calling the tracker inside `faff contain`. Why: it breaks the pure-function invariant every other `faff` predicate holds and makes the walk non-deterministic and untestable offline.

**Anti-pattern:** adding a `--mandate-type` flag to gate the walk. Why: ids are namespace-disjoint, so the walk needs no type; type only matters for the autonomous-ceiling policy, which is a separate wiring-layer concern.

## 5. SCENARIOS — born-verifiable objectives

```
Given a project mandate P and an intended parent issue I whose projectId is P
When  faff contain P --parent I --ancestry [{id:I,type:issue,projectId:P}]
Then  exit 0 (contained) — an issue created under its mandate-project is allowed
```

```
Given an initiative mandate N and an intended parent project Q whose initiativeId is N
When  faff contain N --parent Q --ancestry [{id:Q,type:project,initiativeId:N}]
Then  exit 0 (contained) — the walk computes containment regardless of ceiling policy
```

```
Given a project mandate P and a sub-issue S whose parent issue I is in a DIFFERENT project Q
When  faff contain P --parent S --ancestry [{id:S,type:issue,parentId:I},{id:I,type:issue,projectId:Q}]
Then  exit 3 (outward) — the chain climbs S→I→Q≠P and never reaches P
```

```
Given a project mandate P and a sub-issue S whose parent issue I IS in project P (S's own projectId differs)
When  faff contain P --parent S --ancestry [{id:S,type:issue,parentId:I,projectId:"OTHER"},{id:I,type:issue,projectId:P}]
Then  exit 0 (contained) — parentId-dominant: climbs S→I→P
```

```
Given any node type with no container edge and id ≠ mandate (e.g. a project with null initiativeId)
When  faff contain <mandate> --parent <that node> --ancestry [{id:<node>,type:project,initiativeId:null}]
Then  exit 3 (outward, fail-closed)
```

```
Given an unknown type value in an ancestry entry
When  faff contain <m> --parent X --ancestry [{id:X,type:"epic"}]
Then  exit 2 (usage) — loud, no verdict
```

**Non-functional assertions:**
- `faff contain` makes **no** tracker/MCP/network call (succeeds offline) — unchanged invariant.
- **Every FAFF-219 case** (`--selftest` 11-case table + all 21 `test/contain.test.mjs` cases) passes **unchanged**.
- `--json` output shape is byte-for-byte the FAFF-219 shape (`mandate`/`parent`/`root`/`verdict`).
- The CLI applies **no mandate-type gate** — it computes containment for an initiative mandate too; the project-mandate cap is a wiring-layer policy, out of scope here.

## 6. DESIGN DECISION RATIONALE

**How should the ancestry entry represent a heterogeneous graph?**
- *Pre-flattened single `container` field (agent-resolved):* simplest CLI, but membership semantics move into untestable prose — off-tenet.
- *Typed entries, CLI resolves the edge:* slightly more parse logic; keeps the rule in the tested core; clean superset of `{id, parentId}`.
- **Chosen:** typed entries; CLI computes `container_parent`. Rationale: deterministic-tools-over-prose + backward compat for free.

**Which edge does an issue climb when it has both `parentId` and `projectId`?**
- *projectId-dominant:* would call a child in P's project-tree contained even when its parent issue is elsewhere — wrong for sub-issues.
- *parentId-dominant (consult projectId only at a top-level issue):* matches the subtree definition; one deterministic parent per node.
- **Chosen:** parentId-dominant. Rationale: the explicit issue-parent link is the strongest containment signal; a sub-issue lives under its parent's subtree. *(Promoted to an ADR — durable cross-slice membership semantics.)*

**Do we need a new flag for container mandates?**
- **Chosen:** no. `--root` and the `parent == mandate` base case already express "new top-level container" and "create directly under the mandate." Rationale: minimal surface, no breakage. At the time of writing, Linear issue/project/initiative ids occupy disjoint namespaces, so id-equality suffices; revisit if a tracker reuses ids across types.

**How far up may an autonomous run be dispatched (the ceiling)?**
- *Allow initiative mandate (agent creates whole projects):* maximises lights-out reach but lets the agent make top-down structural/strategic decisions with leaf-level provenance and expensive cleanup; a created project becomes a self-made ancestor for unbounded further creation.
- *Stay at issue-mandate (today):* safest, but initiative/project-scale lights-out can't run unattended at all — a human must pre-build every issue.
- *Cap at project mandate:* agent populates a human-created project with issues (bounded, reversible) but never creates the container itself.
- **Chosen:** cap at **project mandate**. Rationale: separates bounded/reversible container *population* (allowed) from high-blast-radius container *creation* (human-gated); container creation is a planning act, not delivery. Enforced at the wiring layer; the primitive stays type-agnostic so raising the ceiling later needs no primitive change.

**Wire the chokepoints in this ticket, or ship the primitive only?**
- *Wire now:* stages ahead of the L4 orchestrator but is dead code until one exists; grows the ticket past a 1–3 day unit.
- *Primitive only:* clean, independently-shippable; the cap is recorded as the policy wiring must later implement.
- **Chosen:** primitive only. Rationale: no producer of container mandates exists today; wiring now would be inert.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Both prior `Punt:`s (autonomous creation ceiling; wiring scope) were resolved by the human on 2026-06-23 and are now `Chosen:` decisions in WHAT — see the revision note.

**Assumptions:**

- **Assumes:** the Linear MCP exposes, per node, the edges the typed entry needs — an issue's `parentId` and `projectId` (via `get_issue`), a project's containing initiative (via `get_project`/`get_initiative`/`list_initiatives`), and that issue/project/initiative ids are disjoint namespaces. *Validation:* before building the typed cases, confirm `get_project` returns an initiative linkage and `get_issue` returns both `parentId` and `projectId`; the CLI itself never calls these (pure), so a gap only affects the *caller's* future fetch, not this ticket's tests (which use synthetic ancestry).

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] `faff contain` answers contained/outward for an **issue, project, or initiative** mandate via a single typed-edge upward walk.
- [ ] The CLI remains pure — no tracker/MCP/network call (offline smoke passes).
- [ ] The CLI applies **no mandate-type gate**; the project-mandate cap is documented as a wiring-layer policy, not implemented in the primitive.

### From WHAT (types and interfaces)
- [ ] `--ancestry` accepts the typed `AncestryEntry` superset (`type`, `parentId`, `projectId`, `initiativeId`), all edge fields optional.
- [ ] An untyped `{id, parentId}` entry is treated as `type: issue` with container edge `parentId` — identical verdict to FAFF-219.
- [ ] `container_parent` implements: issue → parentId else projectId else null; project → initiativeId else null; initiative → null.
- [ ] Signature, exit codes (0/3/2), and `--json` shape are unchanged from FAFF-219.

### From HOW (behaviour)
- [ ] `subtreeContains` climbs `container_parent(entry)` per node, base case `cursor == mandate` fires before lookup.
- [ ] `parseAncestry` stores the whole entry per id and rejects an unknown `type` value with usage exit 2.

### From HOW (edge cases)
- [ ] Unknown node in walk → outward (fail-closed).
- [ ] Node with no container edge (≠ mandate) → outward.
- [ ] Cycle across typed edges → outward (visited guard).
- [ ] Malformed JSON / non-array / missing string id → usage exit 2.
- [ ] Unknown `type` value → usage exit 2 (not a verdict).

### From SCENARIOS / backward compat
- [ ] New selftest cases added to `CONTAIN_SELFTEST_CASES` covering: issue-under-project contained, project-under-initiative contained, sub-issue cross-project outward, parentId-dominant contained, no-edge outward, unknown-type usage.
- [ ] All pre-existing `--selftest` cases and all 21 `test/contain.test.mjs` cases pass **unchanged**; new typed cases added to `test/contain.test.mjs`.
- [ ] CI selftest gate stays green.

**Integration smoke test:**
```
# issue created under its mandate-project → contained
faff contain PROJ --parent ISSUE-1 \
  --ancestry '[{"id":"ISSUE-1","type":"issue","projectId":"PROJ"}]'        ⇒ exit 0
# project created under its mandate-initiative → contained (walk only; ceiling is a wiring policy)
faff contain INIT --parent PROJ \
  --ancestry '[{"id":"PROJ","type":"project","initiativeId":"INIT"}]'      ⇒ exit 0
# sub-issue whose parent is in a different project → outward
faff contain PROJ --parent SUB \
  --ancestry '[{"id":"SUB","type":"issue","parentId":"I"},{"id":"I","type":"issue","projectId":"OTHER"}]' ⇒ exit 3
# legacy untyped form still works
faff contain M --parent C --ancestry '[{"id":"C","parentId":"M"}]'         ⇒ exit 0
```

confidence: high
