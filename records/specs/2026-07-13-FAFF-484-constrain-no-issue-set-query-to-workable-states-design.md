# Constrain beep-boop's no-issue-set tracker query to workable (non-terminal) states — FAFF-484

> Spec: faffter-dark-nlspec · 2026-07-13 · interactive · confidence: high. Full spec on Linear FAFF-484.

This is the buildable design spec for FAFF-484. Audience: the build agent implementing the fix, and the human reviewers gating it. The change is prose (three beep-boop query sites + one gateway shared-rule subsection) plus a small behaviour-preserving CLI refactor (`bin/lib/next.js`). It introduces no new runnable surface, so there is no architecture proposal.

## 1. WHY — Problem and Principles

**The load-bearing model.** A tracker fetch has two places it can drop an issue: *at the query* (the tracker never returns it — no tokens spent) or *after the fetch* (returned, paginated, read into context, then discarded). Today beep-boop's no-issue-set fetch drops terminal work only in the second, expensive place — and only partially. The fix moves the drop to the first place, for the states beep-boop provably never wants.

**Problem statement.** When `/faff-beep-boop` runs without an explicit issue set, its three tracker fetches inherit only the abstract gateway rule *"Always pull fresh"* (`faff/SKILL.md:412`) with **no state filter**, so they pull the whole tracker; the sole narrowing — *"Ignore cancelled and archived"* (`faff/SKILL.md:310`) — is a **post-fetch drop of cancelled/archived only, not Done**. On a mature tracker (hundreds of issues, mostly Done) that burns most of a context window per pass fetching completed work the pass then throws away — directly against this project's *"tracker access is token-cheap"* outcome. This change makes each of the three sites constrain its **query** to the workable (non-terminal) states it already wants, so Done never enters context in the first place.

**Design principles** — constraints that would cause rejection of an otherwise-valid implementation:

- **Query-side, not post-fetch.** The terminal exclusion must be a constraint the tracker applies before returning rows. An implementation that fetches everything and filters Done in the agent is the current bug re-dressed — it saves nothing. If a tracker cannot express the constraint server-side, that is a documented per-tracker limitation (see GitHub), not licence to fall back to a whole-tracker fetch elsewhere.
- **One definition of "terminal."** The vocabulary of which states are terminal vs workable lives in exactly one place per layer and is referenced, never re-listed. The current defect is partly *because* "terminal" is encoded in three different half-overlapping spots (the post-fetch cancelled/archived rule, and two inlined arrays in `next.js`). Adding a fourth ad-hoc list at each call-site would repeat the mistake.
- **Beep-boop-local machinery.** The workable-only *query constraint* is specific to beep-boop's no-issue-set fetches. It must not be imposed on the sibling read skills (`faff-wtf`, `faff-map`, `faff-tidy`), each of which legitimately needs terminal issues. Only the *partition vocabulary* is shared; the *constraint* is not.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `faff-beep-boop/SKILL.md:126-134` | prose | Prep-queue build — wants Backlog/pre-Todo; membership via `faff next` |
| `faff-beep-boop/SKILL.md:150-159` | prose | Build-queue assembly — wants Todo; membership via `faff next` |
| `faff-beep-boop/SKILL.md:193` | prose | Wave re-entry re-query — wants Backlog AND Todo |
| `faff/SKILL.md:310-328` | prose | "Ignore cancelled and archived" — the existing category-driven, name-fallback partition this extends |
| `faff/SKILL.md:412-418` | prose | "Always pull fresh" — the abstract rule these sites inherit today with no state filter |
| `bin/lib/next.js:9,15-16,91` | JS | `NEXT_STATUSES` + the twice-inlined terminal short-circuit to centralise |

**Scope statement.** This narrows *how* beep-boop's autonomous no-issue-set pass reads the tracker; it changes neither what `faff next` decides nor which issues are ultimately build-eligible.

## 2. OUT OF SCOPE

- **The sibling read skills' fetches** — `faff-wtf` ("Recently Completed", `faff-wtf/SKILL.md:44`), `faff-map` (full status spectrum for chain progress, `faff-map/SKILL.md:40`), `faff-tidy` (two-directional incl. done, `faff-tidy/SKILL.md:14`) each need terminal issues. **Why excluded:** a workable-only fetch would blind them to exactly the completed work they report on. **Extension point:** none intended — they draw the shared *partition vocabulary* if they ever need to name terminal states, but never the *query constraint*.

- **beep-boop's explicit-issue-set path.** When the operator names issues, beep-boop fetches those by id — there is no whole-tracker scan to constrain. **Why excluded:** the token bug only exists on the no-issue-set (whole-tracker) path. **Extension point:** the explicit path already reads named ids directly.

- **The finer Backlog-vs-Todo distinction on trackers without native workflow states (GitHub).** This spec constrains GitHub to open-only (the terminal-exclusion win); resolving Backlog vs Todo on GitHub stays with the existing label/Projects + `faff next` mechanism. **Why excluded:** GitHub has no native pre-Todo/Todo issue states; forcing them into this query constraint is a separate concern. **Extension point:** `faff/SKILL.md` GitHub mapping + `faff next` inputs.

- **A new `faff states` subcommand / MCP-querying CLI.** The CLI change here is a pure constant-extraction refactor. **Why excluded:** `faff next` is deliberately MCP-blind and pure (`next.js:3`); the query is issued by the orchestrator agent, not the CLI. **Extension point:** `bin/lib/next.js` exports the constant, so a future reader command (`faff states workable|terminal`) could surface it without re-deriving.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| **Workable state** | An issue state category from which work can still be picked up: pre-terminal. In faff's normalised status vocabulary: `backlog`, `todo`, `in-progress`, `in-review`. |
| **Terminal state** | A state category from which no further work flows: `done`, `cancelled`, `duplicate` (the last two already handled by the existing "Ignore cancelled and archived" rule; this change adds `done` to the query-excluded set). |
| **Workable/terminal partition** | The complete split of issue states into the two buckets above. The vocabulary is shared; the *decision to constrain a query to the workable side* is beep-boop-local. |
| **Query-side constraint** | A `state`/category filter passed to the tracker's `list_issues` call so terminal rows are never returned — as opposed to a post-fetch drop. |

**The normalised-status layer (CLI constant).** The existing `next.js` already enumerates the normalised statuses and already knows which are terminal — but the terminal set is inlined twice, not named. Centralise it:

```
CONSTANT NEXT_STATUSES  = ["backlog","todo","in-progress","in-review","done","cancelled","duplicate"]   # unchanged
CONSTANT TERMINAL_STATUSES = ["done","cancelled","duplicate"]     # NEW — the single terminal set
CONSTANT WORKABLE_STATUSES = NEXT_STATUSES \ TERMINAL_STATUSES    # = ["backlog","todo","in-progress","in-review"]
```

- `TERMINAL_STATUSES` replaces the literal array at `next.js:91` and backs the two short-circuits at `next.js:15-16`.
- Both are `module.exports`ed alongside `NEXT_STATUSES`, so the normalised-status floor has one home.
- This is the deterministic layer (a testable constant); the gateway prose below is the agent-facing per-tracker mapping that *resolves to* these normalised statuses.

**The per-tracker partition mapping (gateway prose).** A new shared-rule subsection in `faff/SKILL.md`, sibling to "Ignore cancelled and archived", named **"Workable vs terminal states"**. Category-driven first, name-based fallback — mirroring the existing cancelled-detection scheme's shape (`faff/SKILL.md:319-324`):

| Tracker | Workable | Terminal | How to constrain the query |
|---|---|---|---|
| **Linear** | `stateCategory` ∈ {`backlog`, `unstarted`, `started`} | {`completed`, `canceled`} | Pass the wanted state/category to `list_issues`'s `state` param; set `includeArchived: false` |
| **GitHub Issues** | `state = open` | `state = closed` (Done = closed-completed; cancelled = closed + `state_reason = not_planned`, already handled) | Fetch `state=open` only |
| **Jira / other via MCP** | non-terminal status category | `done`/`completed` + cancellation category | Category filter if exposed; else name-based fallback |

**Design decision — where the canonical partition lives.**

- Options: (a) gateway prose only; (b) CLI constant only; (c) both, one definition per layer.
- (a) alone re-encodes in prose the terminal knowledge `next.js` already half-holds → the exact drift the WHY diagnoses. (b) alone is not agent-facing: the orchestrator constructs the MCP query by *tracker category names*, which the normalised CLI tokens don't express.
- **Chosen:** Two layers, one definition each — gateway prose owns the agent-facing per-tracker category mapping; `next.js` owns the normalised-status floor as a single named constant. The prose mapping resolves *to* the normalised statuses the constant enumerates, so they agree by construction. beep-boop's three sites + `faff next` + any future caller draw from these, never a fourth ad-hoc list.

**Design decision — scope of the constraint.**

- **Chosen:** The workable-only *query constraint* is applied at beep-boop's three no-issue-set sites **only**. `faff-wtf` / `faff-map` / `faff-tidy` are untouched — they keep fetching the full spectrum incl. terminal. The shared *partition vocabulary* is available to all, but imposing the constraint on the read skills is explicitly rejected (it would blind their completed-work reporting).

**Design decision — GitHub's missing pre-Todo/Todo states.**

- GitHub Issues has no native Backlog/Todo/In-Progress states — only `open`/`closed` (+ `state_reason`). The three beep-boop sites' finer distinctions (prep wants Backlog, build wants Todo) are not natively queryable there.
- **Chosen:** On GitHub, all three sites constrain to `state=open`. This delivers the actual FAFF-484 win — Done (closed-completed) never returns — even though the Backlog-vs-Todo split then falls to the existing label/Projects + `faff next` layer, exactly as today.

**Assumption — Linear `state` param arity.**

- **Assumes:** Linear's `list_issues` `state` param is a **single scalar** ("State type, name, or ID"); multi-state OR in one call is unconfirmed. The design therefore uses **one call per wanted category** (see HOW). If the build agent confirms the param accepts a category-typed value and/or OR-ed states against the live MCP schema, wave re-entry's two calls MAY collapse to one — a build-time optimisation, never a correctness dependency. Validate by inspecting the `list_issues` schema before implementing; the per-category form is the safe default.

**Assumption — non-Linear/GitHub category exposure.**

- **Assumes:** Jira and other MCP trackers expose a state-category usable to constrain the query; where they do not, the name-based fallback (against the workable/terminal names) applies — mirroring the existing cancelled-detection fallback (`faff/SKILL.md:324`). Validate against the specific tracker's MCP surface at build; never silently widen to a whole-tracker fetch.

## 4. HOW — Behaviour

**Approach.** Two independent, composable changes:

1. **CLI refactor (behaviour-preserving).** Extract `TERMINAL_STATUSES` / `WORKABLE_STATUSES` in `next.js`, wire the two existing short-circuits and the `next.js:91` guard through them. `nextStep`'s output is unchanged for every input — this is a dedup, not a logic change. `faff next --selftest` must stay green with no case edits.

2. **Prose (three beep-boop sites + one gateway subsection).** Add the gateway "Workable vs terminal states" subsection; then at each of the three beep-boop sites, state that the fetch is **query-constrained to the wanted workable states per that subsection**, not merely post-filtered.

**Per-site query construction** (Linear shown; other trackers via the mapping table):

```
PROCEDURE constrain_no_issue_set_fetch(site):
  1. Resolve wanted categories for this site:
       prep-queue build (SKILL.md:126-134)   -> { backlog }
       build-queue assembly (SKILL.md:150-159) -> { todo/unstarted }
       wave re-entry re-query (SKILL.md:193)  -> { backlog, todo/unstarted }
  2. FOR each wanted category:
       issue list_issues WITH state = <category>, includeArchived = false, limit per existing paging
       # scalar `state` param (Assumes) => one call per category
  3. Union the returned rows. Terminal rows (Done/Cancelled/Duplicate) are NEVER in the union —
     they were excluded at the query, not dropped after.
  4. Membership/eligibility unchanged: feed each returned issue's resolved state to `faff next`
     exactly as today (prep-queue iff `next: prep`; build-eligible iff `next: graft`).
```

**Behaviour summary.** Each site fetches only the workable states it already wanted; the existing `faff next` membership logic runs unchanged over a strictly smaller, terminal-free result set. Nothing downstream of the fetch changes.

**Interaction with `includeArchived`.** Linear's `list_issues` defaults `includeArchived: true` — an unconstrained call pulls archived too. Every constrained call in this design sets `includeArchived: false` explicitly, so archived exclusion becomes query-side as well (today it is post-fetch per the cancelled/archived rule). This is a bonus alignment, not a separate feature.

**Edge cases:**

- **In-progress / in-review issues.** These are workable but none of the three no-issue-set sites request them (prep wants Backlog, build/re-entry want Backlog/Todo). The partition classes them workable; each site simply doesn't include those categories in its wanted set. No special-casing — the site's wanted-category list is the filter.
- **Tracker without server-side state filtering.** If a tracker's MCP genuinely cannot constrain by state, that site documents the limitation and fetches the narrowest category it can; it must not silently revert to a whole-tracker fetch (principle: query-side, not post-fetch).
- **Empty result.** A constrained fetch returning zero rows is a valid outcome (no workable issues), handled identically to today's post-filter-empty.

**Failure modes:**

- **The failure:** the constraint is written into prose but the agent still issues an unconstrained `list_issues` and post-filters — the token cost is unchanged, the bug survives behind green prose. **How you'd know:** a no-issue-set pass against a tracker seeded with many Done issues still shows Done issues in the fetched set / high fetch token count. **What it means:** the born-verifiable scenario (below) failed — the constraint didn't reach the actual MCP call; proceed only once the fetch demonstrably excludes Done at the query.
- **The failure:** `TERMINAL_STATUSES` extraction accidentally changes a `nextStep` transition (e.g. drops `duplicate` from a short-circuit). **How you'd know:** `faff next --selftest` goes red. **What it means:** the refactor was not behaviour-preserving — revert to the exact prior set.

**Anti-pattern:** re-listing the terminal/workable states inline at each of the three beep-boop sites. Why: it recreates the multi-home drift the WHY identifies; sites reference the gateway subsection by name instead.

## Scenarios

Main objectives, born verifiable. Prose-site coverage is structural/greppable; the headline behavioural objective is a seeded-tracker exercise.

```
Given a tracker seeded with a mix of Done, Backlog, and Todo issues
And /faff-beep-boop is run with no explicit issue set
When the prep-queue, build-queue, and wave-re-entry fetches execute
Then no Done issue is ever returned into the pass's context
And the exclusion is a state constraint on the list_issues query, not a post-fetch drop
```

```
Given the refactored bin/lib/next.js exporting a single TERMINAL_STATUSES constant
When `faff next --selftest` runs
Then every transition case passes unchanged
And no literal ["cancelled","duplicate","done"]-style array remains except the one named constant
```

- The three beep-boop sites (`faff-beep-boop/SKILL.md:126-134`, `:150-159`, `:193`) each reference the gateway "Workable vs terminal states" subsection and describe a query-side state constraint. *(Structural — greppable: each site names the shared partition and the word "query"/state-constrained; a human confirms the prose says constrain-not-filter.)*

- The sibling read skills `faff-wtf` / `faff-map` / `faff-tidy` remain unchanged — no workable-only query constraint is added to their fetches. *(Structural — greppable: their SKILL.md fetch prose is untouched and still admits terminal issues.)*

```
Given a Linear tracker
When the workable/terminal partition is applied
Then stateCategory ∈ {backlog, unstarted, started} is workable
And {completed, canceled} is terminal
And a Done (completed) issue is classed terminal and query-excluded
```

## 5. Design Decision Rationale

**Where does the canonical workable/terminal partition live?**
- Gateway prose only — agent-facing but re-encodes terminal knowledge `next.js` already holds → drift (the WHY's own bug shape). Rejected as sole home.
- CLI constant only — deterministic but not agent-facing; the MCP query is built from tracker category names the normalised tokens don't express. Rejected as sole home.
- **Chosen:** Both, one definition per layer — gateway prose owns the per-tracker category mapping; `next.js` owns the normalised-status floor as one named constant. They resolve to each other by construction, so there is still one definition of "terminal," just expressed at the two layers that each need it.

**Is the query constraint applied to the sibling read skills?**
- Apply everywhere for consistency — blinds wtf/map/tidy to the completed work they exist to report. Rejected.
- **Chosen:** beep-boop-local. Only beep-boop's three no-issue-set sites constrain to workable; the read skills keep the full-spectrum fetch. The partition *vocabulary* is shared; the *constraint* is not.

**How does each site constrain its query given a scalar `state` param?**
- One OR-ed multi-state call per site — depends on unconfirmed Linear semantics. Rejected as the *default*.
- **Chosen:** One `list_issues` call per wanted category (prep → 1 call: backlog; build → 1 call: todo; re-entry → 2 calls: backlog + todo), `includeArchived: false`, results unioned, `faff next` membership unchanged. Correct regardless of OR support; collapses to fewer calls only if the build agent confirms OR/category-typed values work (optimisation, not correctness).

**How is the partition expressed on GitHub Issues?**
- Map Backlog/Todo/In-Progress to GitHub states — GitHub has no such native states. Rejected.
- **Chosen:** Constrain to `state=open` (drops Done — the FAFF-484 win); finer Backlog/Todo split stays with the existing label/Projects + `faff next` layer (out of scope). At the time of writing, GitHub Issues models only open/closed + `state_reason` natively.

## 6. Open Questions and Assumptions

**Open Questions:** none. No decision requires a human call; every choice above is closed, and the remaining unknowns are external-API shapes the build agent validates directly (below).

**Assumptions:**

- **Assumes:** Linear `list_issues`'s `state` is a single scalar; multi-state OR unconfirmed. *Validation:* inspect the live `list_issues` MCP schema before implementing the fetch; if scalar, use one call per category (the design default); if OR/category-typed values are accepted, wave re-entry may collapse to one call. Never block on this — the per-category form always works.
- **Assumes:** Jira/other MCP trackers expose a state-category usable to constrain the query; else name-based fallback applies. *Validation:* check the specific tracker's MCP `list_issues` params at build; if no category filter exists, constrain by the narrowest available handle and document it — never revert to a whole-tracker fetch.
- **Assumes:** Linear `list_issues` honours `includeArchived: false` to exclude archived at the query. *Validation:* confirm in the MCP schema; if unsupported, archived stays post-filtered per the existing cancelled/archived rule (no regression).

## 7. DONE — Definition of Done

### From WHY
- [ ] A no-issue-set beep-boop pass against a tracker seeded with Done + Backlog + Todo issues returns **no** Done issue into context, and the exclusion is verifiable as a query-side state constraint (not a post-fetch drop).

### From WHAT (partition definition)
- [ ] `faff/SKILL.md` has a new shared-rule subsection "Workable vs terminal states" defining the partition + per-tracker mapping (Linear stateCategory; GitHub open/closed; Jira/other category-then-name), sibling to "Ignore cancelled and archived".
- [ ] `bin/lib/next.js` exports a single `TERMINAL_STATUSES` constant (`["done","cancelled","duplicate"]`) and `WORKABLE_STATUSES` derived from it; both former inline sites (`:15-16` short-circuits, `:91` guard) reference it.
- [ ] No literal terminal-state array remains in `next.js` except the one named constant.

### From HOW (behaviour — the three sites)
- [ ] Prep-queue build (`faff-beep-boop/SKILL.md:126-134`) states its fetch is query-constrained to the Backlog category per the shared partition; membership still via `faff next`.
- [ ] Build-queue assembly (`:150-159`) states its fetch is query-constrained to the Todo/unstarted category; membership still via `faff next`.
- [ ] Wave re-entry re-query (`:193`) states its fetch is query-constrained to Backlog + Todo (per-category calls) per the shared partition.
- [ ] Every constrained Linear call sets `includeArchived: false`.
- [ ] GitHub path constrains to `state=open`.

### From HOW (scope / non-regression)
- [ ] `faff-wtf`, `faff-map`, `faff-tidy` fetch prose is unchanged — no workable-only constraint added.
- [ ] `faff next --selftest` passes with no case edits (the CLI change is behaviour-preserving).

### Integration smoke test
```
1. Run `node bin/lib/next.js --selftest` (or `faff next --selftest`) → RESULT: PASS.
2. grep the three beep-boop sites → each names "Workable vs terminal states" and a query-side constraint.
3. grep next.js → exactly one terminal-state array literal (the constant).
```
If these three hold, the partition has one home, the CLI is behaviour-preserving, and the sites are wired to it.

confidence: high
