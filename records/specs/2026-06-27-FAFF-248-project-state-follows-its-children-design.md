# Project state follows its children — children-derived state-coherence transitions (tidy-homed)

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · re-scoped by two authoritative human comments 2026-06-27. Built to the **Refinement (human steer)** scope below, which supersedes the original framing.

This spec addresses **FAFF-248**. The original nlspec (project → In Progress only, Done fully deferred) is retained verbatim under §A for provenance; the **authoritative built scope** is §B (the two 2026-06-27 human comments). Where they differ, §B wins.

---

## B. AUTHORITATIVE BUILT SCOPE (2026-06-27 human steer — supersedes §A)

### B.1 Resolution — both Punts decided (→ spec re-rated **high**)

- **P1 — autonomous project-state-write posture → allow forward-only In-Progress auto-transition.** The standing "don't change project status autonomously" disclaimer is **narrowed, not deleted**: a project auto-flips → **In Progress** when its first child starts, via the pure `faff project-next` predicate run from a faff-tidy orchestrator-lane sweep. Forward-only + monotonic — the machine never moves a container *backwards* (status-monotonicity floor).
- **P2 — Done / at-release-gate half → split.** The *release-gate* Done (project HAS a DoD) is carved into sibling **FAFF-259** (blocked-by FAFF-245).

### B.2 Refinement (human steer) — frame as initiation-locus + reversibility; home in tidy

faff has **no blanket "never autonomously write the tracker" rule.** The read-only stance lives in `/faff-map` *because map is a read-only lane*. Its **write counterpart is `/faff-tidy`** — the grooming lane that clears up state that makes no sense. Two axes:

1. **Where is the change initiated from?** — map: never (read-only). **tidy: yes** (owns state-coherence grooming). build/graft: only its own issue's claim + ship transitions.
2. **How safe and reversible is the change?** — a transition *derived from children state*, forward/monotonic, and trivially human-reversible is **safe**. A judgement call ("is the deliverable actually shippable?") is **not**.

**FAFF-248 broadens — still all safe + reversible + tidy-homed.** tidy reconciles container state that's incoherent against its children:

- project → **In Progress** when a first child starts;
- **parent issue → In Progress** when any child is In Progress;
- project → **Done** when **all** children are Done **and the project has no release-gate/DoD** — pure state-coherence (a project sitting not-Done with every child Done is just stale).

Each is derived from children, monotonic-friendly, and reversible. Lives in tidy's grooming sweep — **never in map (read-only), never in a build**.

**Deferred to FAFF-259 (behind FAFF-245):** the *release-gate* Done — where a project **has** a DoD, that predicate is authoritative and may hold it open past children-done. That's a deliverable-shippable *judgement*, not state-coherence. Where a project has **no** DoD, tidy's children-done→Done coherence is the default.

### B.3 What ships here

1. A pure CLI predicate **`faff project-next`** (parity with `faff next`/`contain`/`eligible` — zero tracker/network I/O): given a container's current status category, a child rollup `{total, active, done}`, the container `--kind` (`project`|`issue`), and whether it carries a DoD (`--has-dod`), it returns a `ContainerTransition {kind, current, desired, action, reason}` — `advance` only when the desired category ranks strictly above current (forward-only/monotonic), else `noop`.
2. A **faff-tidy orchestrator-lane reconciliation sweep** (new auto-action) that, per active container, builds the rollup from live child statuses (ADR 0012 `containerParent` membership; cancelled/archived excluded), calls the predicate, and applies any `advance` via the tracker MCP.
3. The **faff-map disclaimer narrowed** (not deleted) to scope it to map's read-only role + judgement writes, pointing at tidy as the owning write lane.
4. An **ADR** recording the durable decision (project/parent-issue status is derived bookkeeping, applied forward-only from the Orchestrator lane via a pure predicate).

### B.4 The predicate decision table (v1)

```
project_next(current, kind, total, active, done, hasDod):
  # rank: planned(0) < started(1) < completed(2); cancelled terminal (-1)
  validate: enums known; total/active/done non-negative ints; active+done <= total
  1. current in {cancelled, completed}  -> noop  "terminal — never auto-revert"
  2. total == 0                         -> noop  "no children — nothing to derive"
  3. all_done := (done == total)        # total>0 here
     started_signal := (active > 0) OR (done > 0 AND done < total)
  4. IF all_done:
       kind == project AND NOT hasDod   -> advance->completed  "all children done — state-coherence (no DoD)"  (forward-only guard: only if rank(completed) > rank(current))
       kind == project AND hasDod       -> noop  "all-children-done: defer to release gate (FAFF-259/FAFF-245)"
       kind == issue                    -> noop  "all-children-done: parent-issue Done is out of scope"
  5. IF current == planned AND started_signal -> advance->started  "first child started"
  6. -> noop  "no transition"
```

### B.5 Born-verifiable scenarios

```
Given a planned project with three Backlog children
When one child moves to In Progress and the sweep runs
Then the project advances to started exactly once, reason "first child started"
```
```
Given a parent issue (kind=issue) in Todo with a child in In Progress
When the sweep runs
Then the parent advances to started ("In Progress"), reason "first child started"
```
```
Given a started project whose children are ALL Done and which has NO DoD
When the sweep runs
Then the project advances to completed (Done), reason "all children done — state-coherence (no DoD)"
```
```
Given a started project whose children are ALL Done and which HAS a DoD (--has-dod)
When the sweep runs
Then NO Done transition occurs — noop, reason cites defer to release gate (FAFF-259)
```
```
Given a parent issue (kind=issue) whose children are ALL Done
When the sweep runs
Then NO Done transition occurs (parent-issue Done is out of scope), noop
```
```
Given a completed or cancelled container that gains a new Backlog child
When the sweep runs
Then no backward transition occurs (forward-only monotonicity holds)
```

Non-functional: `faff project-next` performs no tracker/network I/O (pure, parity with `faff next`).

### B.6 DONE — Definition of Done

- [ ] `faff project-next --current C --kind K --total N --active N --done N [--has-dod]` returns `{kind, current, desired, action, reason}` JSON; no tracker/network I/O; exit 0 (pure) / 2 usage.
- [ ] `--selftest` covers: planned+active->advance(started); parent-issue planned+active->advance(started); all-done+project+no-dod->advance(completed); all-done+project+has-dod->noop(defer); all-done+issue->noop(out-of-scope); already-started->noop; cancelled/completed->noop; empty->noop; forward-only guard (never backward).
- [ ] Forward-only/monotonic: no input yields an `advance` whose desired category does not rank strictly above current.
- [ ] faff-tidy SKILL.md documents the reconciliation sweep (rollup build, predicate call, MCP apply, live re-read before write, idempotency) as an orchestrator-lane auto-action.
- [ ] faff-map disclaimer narrowed (not deleted), scoped to map's read-only role, pointing at tidy.
- [ ] No code path auto-advances a project to Done when `--has-dod` (deferred to FAFF-259).
- [ ] ADR materialised recording the derived-bookkeeping / forward-only / orchestrator-lane decision.
- [ ] `node --test` covers the predicate transitions, the no-DoD-Done guard, and the monotonicity/no-backward guarantee.

---

## A. ORIGINAL NLSPEC (provenance — superseded by §B where they differ)

The original spec scoped only the **project → In Progress** transition and deferred **all** Done transitions to a FAFF-245-blocked follow-up. The §B refinement broadens it: parent-issue → In Progress is added, and the **no-DoD** children-done → Done coherence is pulled *into* this ticket (only the DoD-gated Done stays deferred, now to FAFF-259). The original design principles — forward-only/monotonic, derived-not-judged, reversible-bookkeeping-is-not-work-creation, orchestrator-lane ownership, pure predicate mirroring `faff next` — all carry forward unchanged. See the FAFF-248 Linear issue for the full original nlspec text.
