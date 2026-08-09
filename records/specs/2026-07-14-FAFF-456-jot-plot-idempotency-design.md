# jot/plot create-path idempotency + Linear-write link safety

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-456.

This spec addresses three related create/relink hazards in `/faff-jot`'s and `/faff-plot`'s Linear-write seam. Audience: the build agent editing `plugin/skills/faff-jot/SKILL.md`, `plugin/skills/faff-plot/SKILL.md`, and the gateway `plugin/skills/faff/SKILL.md`; and human reviewers checking the prose lands in the right place without duplicating it.

## 1. WHY — Problem and Principles

**Load-bearing model.** `/faff-jot` and `/faff-plot` write the tracker directly (the orchestrator lane) via the Linear MCP `save_issue` — but every create/relink call in both skills is written as if the call always lands cleanly exactly once. Three places that assumption breaks are exactly the three ways a **non-idempotent write** or an **opaque-id link** can silently corrupt the tracker graph. This spec closes all three with prose-only fixes to the create/relink steps — no CLI change, no new mechanical op.

**Problem statement:** `save_issue` can return `502`/`upstream_unavailable` after it already wrote (dup-on-502); `/faff-plot`'s node-scoped re-slice re-creates a node's children with no check for ones that already exist (re-slice collision); and both skills' authored description prose has linked siblings by a hand-typed `<issue id="UUID">` embed, which resolves by opaque id and mis-links silently on a wrong UUID (UUID mis-link). All three were observed in production (FAFF-370/371 dup, FAFF-287/288 dup of FAFF-49/278, FAFF-319's UUID reused for FAFF-256). None of the three remedies exists in either skill's prose today (confirmed absent from `faff-jot/SKILL.md`, `faff-plot/SKILL.md`, and the gateway).

**Design principles:**

**Re-query before retry, never retry blind.** A create call whose result is ambiguous (timeout, 5xx, `upstream_unavailable`) must never be retried without first checking whether the original call already landed. The check is a **read** (`list_issues` filtered by team + title), never a write, so it costs nothing to run defensively.

**Search before create, on every re-slice.** A node-scoped `/faff-plot` re-slice must treat "does this child already exist" as a precondition of creating it, not an afterthought — the same discipline `/faff-tidy`'s chain-gap-fill already applies (dedup before creating — beep-boop step 10.4), extended to plot's own re-slice path.

**Link by identifier, not by opaque id.** A sibling reference authored into a ticket's own description prose is a `[FAFF-N](url)` markdown link — human-legible, resolves by the identifier a reviewer can eyeball, and fails loudly (a broken link renders visibly) rather than silently (a wrong UUID resolves to a real-but-wrong ticket). This governs prose the skills themselves author; it does not touch the MCP's own structured `blockedBy`/`relatedTo`/`duplicateOf` relation fields, which already resolve by identifier natively and are unaffected by this spec.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-jot/SKILL.md` § step 4 ("Confirm and create") | prose (SKILL.md) | Where jot's single-item/greenfield create calls `save_issue`; the dup-on-502 and UUID-link fixes land here |
| `plugin/skills/faff-plot/SKILL.md` § step 5 ("Write the skeleton") | prose (SKILL.md) | Where plot's per-level create calls `save_issue`; all three fixes apply here (plot also re-slices) |
| `plugin/skills/faff/SKILL.md` § gateway (new shared subsection, sited beside **Control-label provisioning**) | prose (SKILL.md) | Single home for the three remedies so jot and plot reference one copy instead of duplicating it (the `faff validate-adapters` duplicated-block lint) |
| `/faff-tidy`'s chain-gap-fill dedup (beep-boop § step 10, item 4: "Dedup before creating") | prose (SKILL.md, read-only reference) | Precedent for search-before-create; not modified by this spec |

**Scope statement:** this is the `/faff-jot` + `/faff-plot` MCP-write seam only — three prose additions to two `SKILL.md` files plus one new shared gateway subsection. It complements, and does not duplicate, FAFF-202 (comment-identity idempotency) or FAFF-344 (stale prose blockers).

## 2. OUT OF SCOPE

- **CLI/code changes to the Linear MCP client or `save_issue` itself** — Why excluded: `save_issue` is a third-party MCP tool faff cannot modify; the fix is agent-side prose discipline (re-query, search, link-format), not a wrapper. Extension point: none needed — the MCP tool is out of faff's control surface.
- **`/faff-tidy`'s own chain-gap-fill create path** — Why excluded: already dedups before creating (beep-boop step 10.4); this spec's remedy 2 explicitly reuses that precedent rather than re-solving it. Extension point: n/a, already covered.
- **Comment idempotency (update-in-place review-findings comment)** — Why excluded: fully covered by FAFF-202's marker-pair mechanism (gateway → *Review-findings comment identity*); this spec is create/relink, not comment update. Extension point: `faff/SKILL.md` → *Review-findings comment identity*.
- **Structured relation fields (`blockedBy`/`blocks`/`relatedTo`/`duplicateOf`)** — Why excluded: these already resolve by human identifier (Linear's `save_issue` accepts `"FAFF-N"` strings, not raw UUIDs) and are unaffected by the mis-link hazard, which is specific to hand-typed `<issue id="UUID">` embeds inside **authored description prose**. Extension point: none — already safe by construction.
- **Retroactive cleanup of the three cited incidents** (FAFF-370/371 dup, FAFF-287/288 dup, FAFF-319↔FAFF-256 mis-link) — Why excluded: those are historical data, not a build task; fixing the prose prevents recurrence, it does not un-write the past. Extension point: a follow-up chore ticket if a human wants the duplicates archived/merged.

## 3. WHAT — Vocabulary and shared mechanism

**Vocabulary:**

| Term | Definition |
|---|---|
| Re-query-before-retry | Before retrying a `save_issue` create whose result was ambiguous, search for a ticket matching the intended title + team that may already have landed |
| Search-before-create (re-slice) | Before a node-scoped `/faff-plot` re-slice creates a node's children, list the node's existing children and create only the ones missing |
| Markdown sibling link | `[FAFF-N](url)` authored into description prose, in place of a hand-typed `<issue id="UUID">` embed |

**Design decisions:**

**Where do the three remedies live — duplicated per-skill prose, or one shared home?** Both `/faff-jot` and `/faff-plot` write via `save_issue` and both author sibling-reference prose, so a per-skill copy of the same guidance is exactly the duplicated-block shape `faff validate-adapters` lints against.

**Chosen:** add one new gateway subsection — **"Idempotent create + link authoring (the MCP-write seam)"** — sited in `faff/SKILL.md` directly after **Control-label provisioning** (a subsection of the same shape: a shared mechanical convention both create-skills reference rather than duplicate). `/faff-jot` step 4 and `/faff-plot` step 5 each add one short paragraph pointing at it and naming which of the three remedies apply at that call-site (jot: remedy 1 + 3; plot: remedies 1, 2, and 3 — plot is the only one that re-slices).

## 4. HOW — Behavior

**The three remedies, as gateway prose (new subsection):**

```
PROCEDURE create_or_retry(intended_title, team):
  1. IF this create attempt follows an ambiguous prior result (timeout / 5xx / upstream_unavailable):
     a. list_issues filtered by team, title-match against intended_title
     b. IF a matching issue is found:
        - treat it as the already-created ticket; do NOT create again
        - IF it is confirmed a genuine unwanted duplicate (two tickets, same intent):
          dedupe via save_issue(id: <the surplus one>, duplicateOf: <the kept one>)
          -- WITHOUT also setting state: "Duplicate" in the same call (a combined
          -- state+duplicateOf write is rejected: "Missing duplicate relation")
     c. IF no match found: proceed to create (the prior attempt genuinely did not land)
  2. IF this is a first attempt (no prior ambiguous result): create directly, no re-query overhead
```

```
PROCEDURE plot_reslice_create(node, proposed_children):
  1. list existing issues parented under `node` (live tracker read, never a cached list)
  2. MATCH each proposed child against existing children by title
  3. FOR each proposed child with a match: skip creation (it already exists)
  4. FOR each proposed child with no match: create it
  5. IF a proposed removeBlocks target: re-confirm the live edge was drawn by THIS pass
     before removing it — never strip an edge whose provenance you have not just re-checked
```

```
RULE author_sibling_reference(description_text, sibling_issue):
  ALWAYS write: [FAFF-N](url)          # markdown link, resolves by human identifier
  NEVER write:  <issue id="UUID">…</issue>   # hand-typed raw-UUID embed
  (Linear's own rendering of a relation field it already resolved — e.g. the auto-rendered
   `<issue id=… href=…>` a fetched issue's OWN description already contains — is untouched;
   this rule governs what the AGENT authors when writing NEW description prose, not how
   Linear renders an existing field back.)
```

**Anti-pattern:** treating every ambiguous create result as "definitely failed, retry immediately." Why: this is exactly the dup-on-502 hazard — the retry is what creates the duplicate. The re-query is cheap (one read); skipping it is what's expensive (a duplicate ticket, a confused human).

**Anti-pattern:** a `/faff-plot` re-slice that blind-recreates a node's full child set on every invocation. Why: re-slicing an already-sliced node is a real workflow (the human asks for a re-cut), so the fix is search-then-fill, not "never re-slice."

**Failure modes:**

- **The failure:** the title-match search in `create_or_retry` is a fuzzy/imperfect match (Linear title search is not exact-string) and could either miss a real duplicate (false negative → a duplicate still gets created) or over-match an unrelated ticket with a similar title (false positive → a real create gets skipped).
- **How you'd know:** a duplicate ticket appears despite the re-query (false negative), or a genuinely new ticket never gets created and the human notices a missing ticket (false positive).
- **What it means:** proceed — the remedy is a hazard-reduction, not a hazard-elimination; matching is inherently probabilistic given Linear's search is not exact-match. Prose instructs matching on title **and** team to keep the match tight, and the confirmed-duplicate branch (`duplicateOf`) instead of silent-skip so a false-negative or false-positive dedup leaves an auditable relation, never a silent drop.

## 5. SCENARIOS

```
Given a save_issue create returned upstream_unavailable
When /faff-jot or /faff-plot considers retrying the create
Then it first searches for a matching title+team before retrying, and only creates if no match is found
```

```
Given a /faff-plot re-slice of a node that was already sliced earlier
When the re-slice pass proposes children for that node
Then it lists the node's existing children first and creates only the ones missing, never duplicating an already-created child
```

```
Given /faff-jot or /faff-plot is authoring a sibling reference into a ticket's description prose
When it writes the reference
Then it writes a markdown link [FAFF-N](url), never a hand-typed <issue id="UUID"> embed
```

- Non-functional: the new gateway subsection is referenced by both skills, never duplicated in either (holds `faff validate-adapters`' duplicated-block lint).

## 6. DESIGN DECISION RATIONALE

**Where do the three remedies live?**
- Options: (a) duplicate full prose in both `faff-jot/SKILL.md` and `faff-plot/SKILL.md`; (b) one shared gateway subsection both reference.
- (a) is simpler to read in isolation but guarantees drift the first time one copy is edited and the other isn't — exactly the lint this repo's `faff validate-adapters` catches.
- **Chosen:** (b) — one gateway subsection, referenced from both skills' create steps.

**How does re-query-before-retry find a possible-duplicate?**
- Options: (a) match by title only; (b) match by title + team; (c) require an exact-string match.
- (a) risks over-matching across unrelated teams; (c) is brittle against Linear's non-exact search.
- **Chosen:** (b) — title-match scoped to the same team, with the confirmed-duplicate path routing through `duplicateOf` (never a silent skip) so an imperfect match still leaves an audit trail.

**How does a plot re-slice tell "already exists" from "genuinely new"?**
- Options: (a) match by issue id (impossible — a re-slice's proposed children have no id yet); (b) match by title against the node's existing children.
- **Chosen:** (b) — the same title-match discipline as remedy 1, applied to a live listing of the node's current children rather than a whole-team search (tighter scope, cheaper read).

**Assumes:** the Linear MCP's `list_issues` tool supports filtering by team and returns enough of each match (title, id) to compare against the intended create — validate this holds before relying on it as the re-query mechanism (both `create_or_retry` and `plot_reslice_create` depend on it).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the ticket's "Fix direction" section already settles all three remedies; no punt remains open.

**Assumptions:**
- **Assumes:** the Linear MCP's `list_issues` supports team + title filtering, sufficient for both remedies' search step. Validation: the build agent confirms `list_issues`' parameter schema (already visible in the loaded MCP tool set) accepts a team scope and returns issue titles/ids before relying on it in the new prose; if it doesn't, the remedy prose falls back to "search the team's issue list and match client-side," which the build agent notes explicitly in the edited prose.

## 8. DONE — Definition of Done

### From WHY
- [ ] The gateway (`faff/SKILL.md`) carries a new subsection ("Idempotent create + link authoring") stating all three remedies, sited beside **Control-label provisioning**

### From WHAT (shared mechanism)
- [ ] `faff-jot/SKILL.md` step 4 ("Confirm and create") references the new gateway subsection and names which remedies apply at jot's create call-site (re-query-before-retry + markdown-link authoring)
- [ ] `faff-plot/SKILL.md` step 5 ("Write the skeleton") references the new gateway subsection and names all three remedies (re-query-before-retry, search-before-create on re-slice, markdown-link authoring)

### From HOW (behaviour)
- [ ] The gateway subsection's re-query-before-retry procedure is present: an ambiguous create result triggers a title+team search before any retry create
- [ ] The gateway subsection's search-before-create procedure is present: a plot re-slice lists existing children under the node before creating, and skips already-existing ones
- [ ] The gateway subsection states `removeBlocks` is never issued in a re-slice pass without re-confirming the live edge was drawn by that same pass
- [ ] The gateway subsection's link-authoring rule is present: sibling references authored into description prose use `[FAFF-N](url)`, never a hand-typed `<issue id="UUID">` embed
- [ ] The duplicateOf-without-state:"Duplicate" call shape is documented (avoids the "Missing duplicate relation" rejection)

### From HOW (edge cases)
- [ ] The failure-mode note on imperfect title-matching (false positive / false negative) is present in the gateway subsection, with the confirmed-duplicate branch routing through `duplicateOf` rather than a silent skip

**Integration smoke test:** read `faff-jot/SKILL.md` step 4 and `faff-plot/SKILL.md` step 5 after the edit; each contains a one-paragraph pointer to the new gateway subsection naming its applicable remedies, and the gateway subsection itself contains all three procedures in full — no duplication of the procedures themselves in either skill file.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes — single 1–3 day unit. Three related prose fixes to two `SKILL.md` files plus one shared gateway subsection, all addressing one theme (non-idempotent tracker writes at the MCP-write seam). No split needed; the three hazards are cohesive, not two independent concerns wearing one ticket.
- **Workstream fit?** Good. Outcome-named ("jot/plot create-path idempotency + Linear-write link safety") and cohesive with the tracker-integration data-integrity theme; sits alongside FAFF-202 (comment idempotency) and FAFF-344 (stale blockers) as a matched sibling rather than overlapping either.
- **Deps surfaced?** None found. No implicit dependency on in-flight work; `relatedTo` links to the three prior incidents (FAFF-370/371, FAFF-287/288, FAFF-319/256) are already recorded on the ticket and are historical evidence, not build blockers.
- **Risk profile?** Low. This is a prose-only change to existing skill prompts with no runtime/CLI surface — no novel integration, no external dependency beyond the already-in-use Linear MCP. The one assumption (`list_issues` filtering) is flagged `**Assumes:**` with a validation instruction rather than treated as free of risk.

No issues.
