# Discovered scope carries a priority, and each filed ticket explains its priority in a comment

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1399.

This spec covers FAFF-1399. Audience: the build agent implementing it, and any human reviewing the PR.

## 1. WHY

**The load-bearing model:** priority is computed once, from fields the filer already has in hand (a relationship to the active ticket, and which lane found the work), by one pure function shared by every autonomous filing path — so the same discovered item gets the same priority and the same reasoning no matter which of faff's three filing chokepoints created the ticket.

**Problem.** Discovered scope files as Backlog tickets with no priority — 146 of 1,399 open FAFF issues carried none as of 2026-10-22 — so the backlog can't be triaged by value without a human first reading every ticket. The maintainer rejected demoting low-value discovered scope to a parent-ticket comment (it hides real scope); every concrete item still becomes a ticket, but each one should arrive pre-triaged: a priority on the ticket, and a plain-language reason attached to it.

**Design principles.**

**The priority call is mechanical, not a fresh LLM judgement per ticket.** faff already classifies discovered scope along fields an agent judges once at capture time — `relationship` (blocker/blocked-by/peer/none) and `confidence` (concrete/vague). Priority is a deterministic function *of* those existing judgements, not a second independent judgement call liable to drift build-to-build. This keeps the "deterministic tools over prose" tenet (gateway kernel) intact: the judgement (is this concrete? what's its relationship?) stays agent-made at capture time, exactly as today; turning that judgement into a priority is table lookup.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` §"Discovered scope (record, never file)", Steps 7/9/10 | prose/SKILL | Where `DiscoveredScopeEntry` is captured — this spec adds a field to that record |
| `plugin/skills/faff-beep-boop/SKILL.md` §10 "File discovered-scope tickets", step 7 (eager filing), step 8.0 | prose/SKILL | Where discovered-scope tickets are actually created on the tracker |
| `plugin/skills/faff-graft/SKILL.md` Step 12 | prose/SKILL | Interactive filing path (the human confirming the file) |
| `plugin/skills/faff-tidy/SKILL.md` §"Chain gaps" | prose/SKILL | The second autonomous filing chokepoint — spec-reference-derived, not build-derived |
| `plugin/skills/faff/bin/lib/eligible.js`, `contain.js` | Node (committed `.js`, no deps) | Precedent shape for a small pure function wired as a `faff` subcommand |
| `plugin/skills/faff/bin/lib/labels.js` (`faff labels`) | Node | Precedent for a single source-of-truth manifest/mapping consumed by every filing site, rather than each site re-deriving it |

**Scope statement.** This is a small addition to faff's two existing autonomous ticket-filing chokepoints (beep-boop's discovered-scope filing, tidy's chain-gap auto-fill) and to graft's discovered-scope capture step — it adds one field and one comment, touches no tracker schema, and introduces no new filing path.

## 2. OUT OF SCOPE

- **Cross-tracker priority mapping** (GitHub Issues, Jira, …). This repo's own `.faff/config.yaml` pins `tracking.tracker: linear`, and Linear's numeric `priority` field (0–4) is the only one in evidence. See the non-blocking Punt under Open Questions. Extension point: a `faff priorities` manifest analogous to `faff labels`, consumed the same way by every filing site.
- **Re-computing or correcting priority on an already-filed ticket.** A human changing or clearing the priority field in the tracker UI is final — nothing in this spec reconciles it back. (Explicitly named in the ticket's own Acceptance: "Removing the priority afterwards leaves the comment in place.")
- **Changing what counts as `concrete` vs `vague`, or the existing containment/appetite gates.** Priority is computed only for items that already clear those gates and are about to be filed; it does not change which items get filed.
- **Priority on the active/mandate ticket itself.** This spec is about the priority of the *newly filed* ticket, never a write to the ticket the work was discovered from.
- **Urgent (Linear priority 1).** The ticket's own rubric is a three-tier High/Medium/Low scale; nothing here ever sets Urgent. A human may still set it by hand afterward — see OUT OF SCOPE "re-computing priority" above.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| `DiscoveredScopeEntry` | The existing per-item record graft appends to `discovered-scope.json` during Steps 7/9/10 (gateway: "Discovered scope"). |
| Filing chokepoint | One of the two autonomous-by-construction tracker-create paths: beep-boop's discovered-scope filing (`/faff-beep-boop` §10, plus its eager step-7 and step-8.0 call-sites of the same mechanism), and tidy's chain-gap auto-fill (`/faff-tidy` §"Chain gaps"). Both already share the `autonomous_file_check` containment primitive this spec's priority step sits beside. |
| Gate-defect | A discovered-scope finding that reveals faff's own gate/evidence logic produced a wrong result (example cited in the ticket: FAFF-1397, where the evidence check parked clean builds). Orthogonal to `relationship` — a gate-defect can turn up during a build, a review, or an orchestrator-lane capture. |

### Type definitions

```
RECORD DiscoveredScopeEntry:                  # EXTENDS the existing record (plugin/skills/faff-graft/SKILL.md)
  title: String
  description: String
  relationship: Enum(blocker, blocked-by, peer, none)
  source: Enum(build, review, post-merge, ci-triage, orchestrator)
  source_ref: String
  confidence: Enum(concrete, vague)
  containment: Enum(contained, outward-new-root, outward-self-intake, null)

  gate_defect: Boolean                        # NEW. Default false. Set true only when the capturing
                                               # step's own judgement (the SAME seam that already judges
                                               # concrete-vs-vague and relationship) recognises this
                                               # finding as evidence that a faff gate/evidence check
                                               # produced a wrong result -- not merely a regression.

  priority: Enum(high, medium, low) | absent  # NEW. Computed by `faff discovered-scope-priority`
                                               # (below) at capture time, from relationship/source/
                                               # gate_defect. Absent only when a pre-this-spec build
                                               # of faff wrote the entry (no migration; see DONE).
```

```
ENUM ChainGapSubType: sub-ticket, upstream, downstream, peer   # already exists (faff-tidy)
```

### The priority function (new deterministic CLI)

`faff discovered-scope-priority --relationship <blocker|blocked-by|peer|parent|none> --source <build|review|post-merge|ci-triage|orchestrator|chain-gap> [--gate-defect]`

Prints exactly one of `high` / `medium` / `low` to stdout and exits 0. Every input combination is covered — there is no "unknown" or non-zero exit, because every combination the two closed enums + one boolean can produce has a defined answer (this is a total function over a small finite domain, not a judgement call).

**`--relationship parent`** is a new enum value, used **only** by chain-gap filing (below) for a sub-ticket gap — a discovered deliverable that is a child of the active ticket's own already-committed scope, which has no blocker/blocked-by shape of its own.

**`--source chain-gap`** is a new enum value, used **only** by tidy's chain-gap filing — chain gaps are never `DiscoveredScopeEntry` records (they're derived from spec prose, not build-time capture), so they never carry graft's `build|review|post-merge|ci-triage|orchestrator` values.

### Design decisions

**Where is the Medium/Low split drawn, and is it mechanical?**

**Chosen:** mechanical, via the lookup table below — reusing the two fields a `DiscoveredScopeEntry` already carries (`relationship`, `source`) plus the one new `gate_defect` boolean, rather than inventing a fresh judgement axis:

| Condition (checked top to bottom, first match wins) | Priority |
|---|---|
| `gate_defect == true` | **High** — a faff gate/evidence check produced a wrong result; this is the ticket's own "makes a gate wrong" example (FAFF-1397) |
| `relationship == blocker` | **High** — blocks other work, per the ticket's own rule |
| `source ∈ {post-merge, ci-triage}` | **High** — a regression on `main`, per the ticket's own rule |
| `relationship ∈ {blocked-by, parent}` | **Medium** — the discovered item is either known to follow immediately (`blocked-by`), or is a deliverable the active ticket's own spec already committed to (`parent`, chain-gap sub-ticket gaps) |
| `source == review` | **Medium** — a human-judgement-shaped review pass flagged it, not an opportunistic build-time note |
| *(none of the above)* | **Low** — `relationship ∈ {peer, none}` and the source is `build`, `orchestrator`, or `chain-gap` (a peer item): opportunistic, non-blocking, not review-escalated |

**Does the reason comment need a fixed shape?**

**Chosen:** yes — exactly the three-line shape the ticket itself proposed (found / rule / what would change it), so a human scanning a dozen filed tickets reads the same shape every time:

```
*Agent-written via /faff-beep-boop.*

**Priority: <High|Medium|Low>**

- **Found:** <one line — what the build/review/post-merge/CI-triage/chain-gap pass found>
- **Rule:** <the exact matched condition from the table above, in plain words>
- **Changes it:** <the concrete condition that would move this to a different tier>
```

The attributing clause names whichever skill actually performed the file (`/faff-beep-boop`, `/faff-tidy`, or `/faff-graft` on the interactive path) — mirroring the issue description's own `*Agent-written via /faff-jot, from the maintainer's decisions of …*` convention already in use on this ticket. This is a **new** comment on the **newly filed ticket**, posted once at file time — never edited or re-posted (OUT OF SCOPE: re-computing priority), so it needs no idempotency-key marker (contrast the existing `<!-- faff-review-findings:<ISSUE-ID> -->` update-in-place convention, which exists because that comment is revised many times across a build; this one is write-once).

**Does tidy's chain-gap auto-fill need the same treatment?**

**Chosen:** yes, reusing the identical priority function and comment shape — not a parallel mechanism. Chain-gap sub-types already map onto relationship-shaped roles (`/faff-tidy` §"Chain gaps": "the appropriate relationship — parent for sub-ticket gaps, blocker for upstream, blocked-by for downstream, sibling-in-workstream for peer"), so the mapping is direct:

| Chain-gap sub-type | `--relationship` | `--source` |
|---|---|---|
| upstream | `blocker` | `chain-gap` |
| downstream | `blocked-by` | `chain-gap` |
| sub-ticket | `parent` | `chain-gap` |
| peer | `peer` | `chain-gap` |

`--gate-defect` is never set for a chain-gap item (a gate-defect is a build/review/orchestrator-time signal about faff's own tooling; chain gaps are derived from spec prose, not from running a gate). Net result: upstream → High, downstream and sub-ticket → Medium, peer → Low.

**Linear priority-value mapping.**

**Chosen:** `high → 2 (High)`, `medium → 3 (Medium)`, `low → 4 (Low)` — Linear's own enum (`0=None, 1=Urgent, 2=High, 3=Medium, 4=Low`, confirmed against the `save_issue` tool's own parameter description). Never `1` (Urgent) or `0` (None) — see OUT OF SCOPE.

**Orchestrator-lane entries' `relationship`.**

**Chosen:** `none`, always. An orchestrator-lane capture (`orchestrator_capture`, `/faff-beep-boop` §"Orchestrator-lane capture") records a faff-tooling defect the orchestrator itself hit, not a relationship to any built issue, so `relationship` is `none` by construction — it was already unset in practice; this spec makes the default explicit rather than introducing new behaviour. Such an entry still goes through the priority table above (most commonly landing `low`, unless the capturing step also sets `gate_defect: true`).

## 4. HOW

### Where `priority` and `gate_defect` are set (capture time, unchanged call sites)

**Behaviour summary:** at each of the three existing `DiscoveredScopeEntry`-writing points, immediately after the existing `relationship`/`confidence` judgement, call the priority function and store its answer on the same entry — no new call site, no new timing.

```
PROCEDURE capture_discovered_scope(title, description, relationship, source, source_ref, confidence, gate_defect):
  1. entry := { title, description, relationship, source, source_ref, confidence, containment: null, gate_defect }
  2. IF confidence == "vague":
       entry.priority := absent          # never filed, so never prioritised -- unchanged from today
  3. ELSE:
       entry.priority := run `faff discovered-scope-priority --relationship <relationship> --source <source>
                              [--gate-defect if gate_defect]` and capture stdout
  4. append entry to the target discovered-scope.json (graft Steps 7/9/10's own existing append logic, unchanged)
```

This runs at graft Step 7 (build), Step 9 (review), Step 10's post-merge-verification `verified-fail` entry, Step 10's CI-triage `main-was-red` entry, and beep-boop's `orchestrator_capture`. All five call sites already construct a `DiscoveredScopeEntry` literal today (per the existing SKILL.md prose) — this adds two keys to that literal and one CLI call before it.

**`gate_defect` is judged, not computed** — exactly like `confidence` (concrete/vague) is judged today at the same five call sites. Set it `true` only when the finding is specifically that a faff gate/evidence/review check produced an incorrect pass/park/merge decision (the FAFF-1397 shape), never for an ordinary code regression (that's covered by `source ∈ {post-merge, ci-triage}` already landing High on its own).

### Where priority is applied (filing time, unchanged call sites)

**Behaviour summary:** at ticket-creation time, read the already-computed `priority` off the entry (or compute it fresh from the chain-gap sub-type), set the tracker priority in the same `save_issue` call that already sets status/relationship/provenance, and post the reason comment immediately after.

```
PROCEDURE file_with_priority(entry_or_subtype_derivation, new_issue_id, filer_name):
  1. IF entry.priority is absent (confidence was vague, or a legacy pre-this-spec entry):
       file exactly as today -- no tracker priority set, no reason comment. (Vague items are never
       filed at all, so this branch only covers the legacy-entry case.)
  2. ELSE:
       a. linear_priority := { high: 2, medium: 3, low: 4 }[entry.priority]
       b. create/update the ticket with `priority: linear_priority` in the SAME save_issue call that
          already sets status: Backlog + the relationship link + the provenance line -- one write,
          not two.
       c. post ONE comment on the new ticket, in the fixed shape (§3 "Does the reason comment need a
          fixed shape?"), attributed to `filer_name` (/faff-beep-boop | /faff-tidy | /faff-graft).
          "Found" = entry.title/description (or the chain-gap source spec line); "Rule" = the matched
          condition's plain-English name from the table in §3; "Changes it" = the SAME table's adjacent
          row's condition (e.g. a High from `relationship == blocker` names "if the blocking relationship
          is removed, this drops to the review/source-based tier below").
```

**Call-site wiring (no new filing path — three existing creates each gain step 2 above):**

- **`/faff-beep-boop` §10 "File discovered-scope tickets", sub-step 5 ("File")** — and its two other callers of the identical mechanism (the eager per-build-return step 7, and the per-wave step 8.0) — run `file_with_priority` as part of the existing create. `entry.priority` is already on the `DiscoveredScopeEntry` from capture time; no recomputation here.
- **`/faff-graft` Step 12 (interactive filing)** — on confirm, run `file_with_priority` per confirmed item, identically.
- **`/faff-tidy` §"Chain gaps" auto-create** — for each item about to be filed, first derive `{relationship, source}` from the sub-type per the §3 table (`source` is always `chain-gap`, `gate_defect` is always false), call `faff discovered-scope-priority`, then run `file_with_priority` step 2 with that freshly-computed priority (chain-gap items have no prior `discovered-scope.json` entry to read a stored value off).

### Edge cases and error handling

- **The priority CLI is unreachable or errors.** Treat exactly like any other `faff` CLI call failing mid-filing step: log it, file the ticket **without** a tracker priority and **without** the reason comment (fail toward today's no-priority behaviour, never toward a guessed priority) — never block the file on a priority-computation failure. This matches the existing "entry without a priority files with none, as today" fallback the ticket itself names.
- **`entry.priority` is absent because a pre-this-spec faff build wrote the entry** (no migration, additive field) — same fallback as above: file with no priority, no comment. No backfill pass is introduced.
- **A `vague` item.** Never reaches the filing step at all (unchanged); `priority` stays `absent` and is never read.
- **Dedup drops the item before it's filed** (`/faff-beep-boop` §10 sub-step 4, already existing) — no ticket is created, so no priority is set and no comment is posted. Unchanged.
- **`outward-new-root` / surface-only items** — never filed (unchanged hard floor); priority is computed and stored on the entry at capture time regardless (it's cheap and the entry may still be inspected via `/faff-wtf` §4), but is never applied to a tracker ticket because none is created.

**Anti-pattern:** re-deriving priority with a fresh LLM judgement call at filing time for an item that already has a stored `priority` from capture time. Why: the whole point of computing it once, mechanically, at capture is that every filer (beep-boop's three call sites, interactive graft) agrees — a second independent judgement at filing time could disagree with the stored value and silently produce an inconsistent audit trail.

**Anti-pattern:** setting Linear priority `1` (Urgent) for any discovered-scope or chain-gap item. Why: the ticket's own rubric is a three-tier scale: nothing in scope here is ever more urgent than "blocks other work" (High); reserving Urgent keeps it meaningful for a human's own hand-set escalations.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a build at /faff-graft Step 7 records a DiscoveredScopeEntry with relationship: "blocker"
When beep-boop's step-10 filing mechanism files it as a Backlog ticket
Then the new ticket's tracker priority is "High" and it carries exactly one comment in the fixed
  found/rule/changes-it shape, attributed to /faff-beep-boop
```

```
Given a build records a DiscoveredScopeEntry with relationship: "peer" and source: "build"
  (no gate_defect)
When it is filed
Then the new ticket's tracker priority is "Low" and carries the fixed-shape reason comment
```

```
Given faff-graft Step 10's post-merge verification records a verified-fail entry
  (source: "post-merge", relationship: "none")
When it is filed
Then the new ticket's tracker priority is "High" (matched on source, not relationship) and the
  reason comment's "Rule" line names the regression-on-main condition, not the blocker condition
```

```
Given a human clears the tracker priority on a previously-filed discovered-scope ticket
When any later faff pass reads that ticket
Then the priority-reason comment is still present and unmodified -- nothing in this feature
  re-asserts, re-derives, or deletes it
```

```
Given faff-tidy classifies a chain gap as "upstream" (a prerequisite the active ticket's spec names)
When tidy auto-creates the missing ticket
Then its tracker priority is "High" (upstream maps to relationship: blocker) and the reason
  comment attributes to /faff-tidy
```

## 6. Design decision rationale

**Bold question:** should priority be computed by a fresh agent judgement at each of the (at least) five capture/filing call sites, or by one shared deterministic function?

- **Option A — per-site prose judgement.** Simpler to write (no new CLI), but every call site re-derives the same mapping from the same two fields, with no guarantee the beep-boop wording and the tidy wording agree — exactly the kind of drift the gateway's "deterministic tools over prose" tenet exists to prevent, and this repo already has small single-purpose pure-function CLI subcommands (`eligible`, `contain`) for precisely this shape of decision.
- **Option B — one shared `faff discovered-scope-priority` function.** **Chosen:** every filing site calls the same table, so a `blocker`-relationship item is `High` whether beep-boop, interactive graft, or tidy's chain-gap filed it. Trivially unit-testable (a small enum × enum × boolean truth table) the same way `eligible.js`/`contain.js` already are.

**Bold question:** does the new `gate_defect` field duplicate the existing `relationship`/`source` fields, or does it carry real information?

- **Chosen:** it's a genuinely new axis. The ticket's own "makes a gate wrong" example (FAFF-1397) is a build- or review-time finding, not a `post-merge`/`ci-triage` regression and not necessarily a `blocker` relationship — a gate producing a false park on a *clean* build doesn't block other work in the dependency-graph sense `relationship: blocker` captures. Collapsing it into `relationship` would force every gate-defect finding to be mislabelled as a blocker it may not structurally be.

## 7. Open Questions and Assumptions

**Open Questions:**

**Punt:** cross-tracker priority mapping — this spec's Linear-numeric mapping (`high→2, medium→3, low→4`) is the only tracker priority scheme in evidence (`.faff/config.yaml` pins `tracking.tracker: linear`); GitHub Issues has no native priority field and Jira's priority scheme is a separate per-instance enum. A future ticket should define a `faff priorities`-style manifest (mirroring `faff labels`'s existing cross-tracker role/name separation) if/when a non-Linear-tracked adopter needs this (decides: architecture) (non-blocking). Not blocking: the repo this ships into is Linear-only, so DONE below is fully satisfiable without it. Cross-referenced under OUT OF SCOPE → "Cross-tracker priority mapping."

**Assumptions:**

- **Assumes:** the `save_issue` tool's `priority` parameter (`0=None, 1=Urgent, 2=High, 3=Medium, 4=Low`) is stable — validate by re-reading the tool's own schema description at build time (it is the MCP tool definition, not a faff-owned contract, so it is not pinned by a `faff contract` validator).
- **Assumes:** every existing `DiscoveredScopeEntry`-writing call site (graft Steps 7/9/10, beep-boop's `orchestrator_capture`) already constructs the entry as a literal object in the agent's own working context at capture time (per the current SKILL.md prose) rather than through a shared constructor function — validate by re-reading those SKILL.md sections immediately before editing them, since this spec's Step-3 diff assumes it is adding two keys to an existing literal, not refactoring a constructor.

## 8. DONE — Definition of Done

### From WHY
- [ ] A discovered-scope ticket filed through any of the three autonomous/interactive filing call sites arrives with a tracker priority already set (no follow-up human triage pass needed to assign one).

### From WHAT (types and interfaces)
- [ ] `DiscoveredScopeEntry` gains `gate_defect: Boolean` (default `false`) and `priority: Enum(high, medium, low) | absent`, documented in `plugin/skills/faff-graft/SKILL.md`'s existing schema block.
- [ ] `faff discovered-scope-priority --relationship <blocker|blocked-by|peer|parent|none> --source <build|review|post-merge|ci-triage|orchestrator|chain-gap> [--gate-defect]` is a new `faff` subcommand, wired via the existing `COMMANDS` map / `lazy(require(...))` pattern (`plugin/skills/faff/bin/faff`, same shape as `eligible`/`contain`), printing exactly one of `high`/`medium`/`low` to stdout and exiting 0 for every valid input combination.
- [ ] Every row of the §3 priority table is covered by a unit test in `test/faff-1399-discovered-scope-priority.test.mjs` (naming convention matches `test/faff-1360-*.test.mjs`, `test/faff-1363-*.test.mjs`), including the `gate_defect == true` short-circuit over a `relationship: none` input, and the chain-gap `--source chain-gap` / `--relationship parent` combination.

### From HOW (behaviour)
- [ ] Graft Steps 7, 9, and 10 (both the post-merge-verification and CI-triage `DiscoveredScopeEntry` writes) call the new CLI and store its result as `priority` on the entry, for every non-`vague` item.
- [ ] `/faff-beep-boop` §10 sub-step 5 (and its step-7 eager and step-8.0 per-wave callers of the same mechanism) sets the Linear `priority` field (`2`/`3`/`4` per the mapping) on ticket creation whenever the filed entry carries a `priority`, in the same `save_issue` call that sets status/relationship/provenance.
- [ ] `/faff-graft` Step 12's interactive filing path applies the same mapping on confirm.
- [ ] `/faff-tidy`'s chain-gap auto-create derives `{relationship, source: "chain-gap"}` from the sub-type per the §3 mapping table and applies the same priority function + tracker-priority write.
- [ ] Every ticket that receives a tracker priority also receives exactly one comment in the fixed found/rule/changes-it shape, attributed to the filing skill, posted once at file time.
- [ ] An item whose `priority` is `absent` (vague, or a legacy pre-feature entry) files exactly as today: no tracker priority, no reason comment — confirmed by a test case, not just by omission.

### From HOW (edge cases)
- [ ] A `faff discovered-scope-priority` failure at filing time degrades to "file with no priority, no comment" and is logged — never blocks the file and never guesses a priority.
- [ ] No code path introduced by this spec reads back, edits, or re-posts a priority-reason comment after it is written — confirmed by grepping the new/changed filing code for any `list_comments`/`save_comment`-with-`id` call keyed on this comment, which there must be none of (the comment is write-once, per §2 OUT OF SCOPE "re-computing priority").

## Integration smoke test

```
PROCEDURE smoke_test:
  1. Simulate a graft build (Step 7) discovering one concrete item with relationship: "blocker".
  2. Confirm the written discovered-scope.json entry carries priority: "high".
  3. Run beep-boop's step-10 filing mechanism over that file.
  4. Confirm the newly created Backlog ticket's tracker priority reads High, and its comments
     list contains exactly one comment matching the fixed found/rule/changes-it shape.
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" }
  ] }
```
