# faffter-noon-methodology-structural

The default methodology. Pure structural analysis — ordering by unlock value, gating on decision closure, detecting graph-level problems, and surfacing the highest-leverage work first. No opinionated delivery philosophy, no principle-based diagnosis. Just: what does the graph say?

This is what runs when no other methodology is configured. It's extracted here so it can be referenced, tested, and eventually swapped.

```yaml
planning_skills:
  methodology: faffter-noon-methodology-structural   # the default — explicit for clarity
```

## Core ordering rule (shared across all consumers)

**Priority (issue-level OR inherited from any ancestor) → chainable unlock value (count of direct + transitive dependents).**

This rule applies everywhere work is sequenced: tidy promotion, wtf recommendations, beep-boop build queues, whereto horizon ordering. When two issues have equal priority, the one that unlocks more downstream work goes first. When both are equal, creation order breaks the tie (oldest first — fairness over recency).

## Sub-contracts by consumer

Each faff-* skill invokes this methodology for specific outputs. The structural methodology's answer is always graph-derived, never opinion-derived.

---

### For faff-tidy (grooming)

**Promotion criteria — an issue is ready when ALL hold:**
1. Blockers clear (all declared blockers are Done)
2. Concrete deliverable (not vague, not "investigate")
3. Real spec exists (tracker comment or `docs/specs/` — never description alone)
4. No unresolved architectural questions (no open `**Punt:**` markers that would block build)
5. No false `**Assumes:**` entries (the assumption actually holds in current state)

**Demotion criteria:**
- Repeat-parked: 3+ parks with same root-cause class in 21 days → demote to Backlog, tag `repeat-parked`
- Challenged spec: post-spec comment raises unresolved challenge → back to needs-prep
- Stale spec: codebase drift invalidates approach → back to needs-refresh

**Structural diagnostics to surface:**

| Category | Detection | Action (default mode) |
|---|---|---|
| Dependency cycles | Tarjan/DFS on the blocker graph | Surface — name the cycle, recommend which edge to break |
| Ghost-project pointers | Spec or initiative description names a tracker container that doesn't exist | Surface — "description names X, no project exists" |
| Repeat-park patterns | 3+ same root-cause in configurable window | Demote (auto-action) |
| Splittable specs | Spec covers 2+ structurally independent concerns | Surface — chain-offer `/faff-prep --split` |
| Chain gaps | Spec references work with no corresponding ticket (sub-ticket/upstream/downstream/peer) | Surface — offer "file gap issue" |
| Orphaned + repeat-parked | Cancelled ancestor AND repeat-parked | Surface — "is this still wanted?" |

**Ordering of promotable issues:**
Core ordering rule. Issues gating the longest chains rise to the top.

---

### For faff-wtf (daily focus / standup)

**What to surface, in order:**

1. **Recently shipped** — what completed in last 24-48h + what each just unblocked (freshly-realised potential). Float newly-unblocked issues to top of recommendations.
2. **Today's focus** — top N ready issues by the core ordering rule. Recommend the one that unlocks the most downstream value.
3. **Heads up** — structural problems that would bite today: repeat-parks, chain gaps (with sub-type), orphaned+repeat-parked, approaching deadlines.
4. **Beep-boop queues** — what autonomous mode would pick up (build queue + prep queue counts).

**Rendering contract:**
- Every issue: tracker ID + plain-English gloss + unlock-chain consequence when non-trivial
- Tables for queue summaries, prose for focus recommendations
- Keep concise — this is a morning brief, not a report

---

### For faff-whereto (roadmap)

**Horizon assignment:** Derive from tracker state:
- **Now** — In Progress or actively being built
- **Next** — Todo, blockers clear or nearly clear, spec exists
- **Later** — Backlog, or blocked by Now/Next work

**Sequencing within horizons:**
Core ordering rule applied per horizon. Priority + unlock value within each bucket.

**Structural diagnostics to surface:**
- Ghost-project pointers (initiative → missing project)
- Structural gaps (initiative has no Next project planned)
- Unfireable trigger gates (downstream project doesn't exist)
- Stalled Now projects (In Progress, no commits 14+ days)
- Parked issues with unmet unpark conditions

**Chain diagram:**
ASCII tree: initiative → project → issue flow. Mark structural gaps inline so chain breaks are visible to the human at a glance.

---

### For faff-prep (spec production support)

**Structural default spec format: lite nlspec arc.**

1. **WHY** — Problem statement (status quo → pain → solution), design principles, out-of-scope with extension points
2. **WHAT** — Types, APIs, interfaces. Each decision marked with canonical markers (`**Chosen:**` / `**Punt:**` / `**Assumes:**`)
3. **HOW** — Architecture, pseudocode at ambiguity points, risks and edge cases
4. **DONE** — Closed-loop testable checklist mirroring body sections 1:1

**Marker contract (non-negotiable):**
- Every decision section concludes with exactly one marker
- Spec with tradeoff table but no marker = invalid
- `Punt:` and `Assumes:` collected in dedicated sections

**Writing style enforcement:**
- No invented labelling schemes (no `X1`, `F2`, `W2a`)
- Restate subjects on every cross-reference
- Tracker IDs fine; invented codes banned
- Inherited codes from source ADRs must be translated

---

### For faff-beep-boop (build queue ordering & admission)

**Admission gate:**
- `fire-and-forget` + `likely-fire` verdicts → enter build queue
- `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked` → routed out, not built

**Build-queue ordering:**
Core ordering rule. Independents ordered directly; collision groups serialised within (lead issue determines group position).

**Conflict analysis (safe for parallel):**
1. Specs name same files → collision
2. Specs name same top-level directory → collision
3. One declares another as blocker → serialise dependent behind
4. Shared scope tag per CLAUDE.md conventions → collision

Independents run in parallel. Collision groups serialise within themselves.

**Wave structure:** After each wave drains, re-check for newly unlocked work. Narrow-prep any unblocked candidates. Re-assemble queue. Continue until queue drained or budget hit.

---

## Appetite integration

The structural methodology respects appetite but has limited agency by design:

| | low | medium | high (default) | full |
|---|---|---|---|---|
| Diagnostics | Surface only | Surface + auto-demote repeat-parks | Surface + auto-demote + chain-gap auto-create | Surface + act on all (auto-create, auto-demote, report splittables) |
| Ordering | Core rule, no overrides | Core rule, no overrides | Core rule, no overrides | Core rule, no overrides |
| Spec format | Enforce markers | Enforce markers | Enforce markers | Enforce markers |

Note: the structural methodology never reorders by value/risk/principles — that's what opinionated methodologies (like `faffter-dark-methodology-agile-delivery`) add. Structural ordering is always priority + unlock value.

## Rules

- This methodology is **graph-derived, not opinion-derived**. It never says "this is too big" or "this ordering is wrong" — it says "this cycle exists", "this gap exists", "this issue unlocks 5 others."
- It does not assess value, risk, or right-sizing. Those are judgement calls that belong to opinionated methodologies.
- It provides the structural foundation that opinionated methodologies layer on top of.
- When a faffter-dark methodology is configured, it runs **in addition to** structural analysis, not instead of it. Structural diagnostics always fire; methodology findings are additive.
