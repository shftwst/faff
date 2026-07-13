# FAFF-436 — `rehome-set`: methodology named output proposing outcome-led project groupings for loose Backlog work

> Spec: faffter-dark-nlspec · 2026-07-11 · interactive · confidence: high. (Committed at graft 2026-07-13; FAFF-421 confirmed shipped — Transport grain table present at gateway `### Transport`.)

This spec covers FAFF-436: adding a `rehome-set` named output to the methodology slot contract, implementing it in the agile-delivery lens, documenting the thematic default's empty answer, and registering the new judgement seam in the eval harness. Audience: the build agent and human reviewers.

## 1. WHY — Problem and principles

**Load-bearing model.** The methodology slot answers *named outputs* — judgement requests a caller makes by name, each defined once in the gateway contract table (gateway → The `methodology` slot). `rehome-set` is a new optional named output: given the accumulated project-less Backlog set, the lens *proposes* outcome-led project groupings; it never writes. The write half (the `/faff-plot` rehome pass that applies proposals) is FAFF-437, deliberately built second — contract and judgement first, apply surface after.

**Problem.** The agile lens's default-landing rule sends all new work project-less to Backlog by design; the FAFF-291→296 cluster gave the lens ownership of outcome-led project shape ("converge by rehoming"), but nothing performs the convergence: tidy grooms per-issue, plot only decomposes new ideas, jot defers re-home, map/wtf are read-only. Loose tickets accumulate indefinitely. This ticket builds the judgement half that turns a loose-ticket set into a grouping proposal.

**Design principles:**

- **Read-only, absolutely.** No tracker write, no network write, anywhere in the output path — the pattern set by `crank-up-set`, `prdr-author`, `yagni-judge`. Applying a proposal is the caller's human-gated job (FAFF-437).
- **Conservative bias.** A wrong grouping is worse than a loose ticket: applying a proposal is cheap, unwinding it is manual (the tracker MCP cannot null a project assignment — reassign-only). Some loose is *correct*; the lens proposes only high-confidence groupings and names the rest as deliberately loose.
- **Completeness — nothing silently omitted.** Every input ticket appears exactly once in the output: in the membership map of a proposed container, or in the explicit leave-loose set. Silent omission is indistinguishable from "forgot", which the consumer cannot act on.
- **Shipped-shape-wins is a match obligation here.** FAFF-437's approved spec (and its consumer-expectation comment on FAFF-436) assume exactly the output shape in this ticket's What. This spec matches that shape deliberately — no divergence.
- **Self-contained skill prose.** The SKILL.md prose this build writes carries no load-bearing FAFF-NN references; rationale (like the undo asymmetry) is stated in-prose. This spec cites tickets freely; the prose it specifies must not.

**Reference context:**

| Surface | Relevance |
|---|---|
| `plugin/skills/faff/SKILL.md` (gateway) | Named-output contract table gets the `rehome-set` row; the Transport grain table (created by FAFF-421) gets its grain row |
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | The implementing lens: Outputs preamble + table, seven principles, existing rehome/convert sections, `## Rules` don't-nag |
| `plugin/skills/faffter-noon-methodology-thematic/SKILL.md` | The declining default: per-output `###` subsections with "Unanswered ⇒ <fallback>" closers |
| `eval/grader.mjs`, `eval/seam-registry.json`, `test/seam-registry.test.mjs` | New grader KIND `grouping`; registry row; the `28` count assertions |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | `judgement_seam:` reconciliation — own-rows-strict once a skill owns a registry row |

**Scope statement.** This is the judgement half of the project-formation convergence step; FAFF-437 (blocked by this) hosts the apply surface.

## 2. OUT OF SCOPE

- **Any tracker write and the plot-hosted apply surface** — FAFF-437's job.
- **Mis-homed detection** (tickets in the *wrong* project) — this output reads only the project-less set.
- **Cadence/threshold config key** — YAGNI; the diagnostic surfaces whenever `backlog-diagnostics` runs.
- **DoD authoring for proposed containers** — `prdr-author`'s existing job, invoked by the caller after container creation.
- **Orchestration-skill changes** — the diagnostic renders through tidy/wtf's existing methodology sections; no tidy/wtf/plot edit in this ticket.

## 3. WHAT — Vocabulary and shapes

**Vocabulary:**

| Term | Definition |
|---|---|
| Loose ticket | A non-terminal Backlog issue with no project/container assignment |
| Rehome proposal | One proposed outcome-led project container plus the loose tickets that would move into it |
| Leave-loose set | Input tickets the lens judges correctly loose, named explicitly |
| Coherence blocker edge | A proposed `blockedBy` edge that makes a proposed grouping sequencable, emitted as a proposal, never written |

**Output shape** (matches FAFF-437's consumer expectation exactly):

```
RECORD RehomeSet:
  proposals: List<Proposal>          # ordered by which grouping unlocks sequencable value first
  leave_loose: List<IssueRef>        # correctly-loose tickets, each with a one-line reason
  findings: List<Finding>            # standard envelope: (principle, diagnosis, recommended action)

RECORD Proposal:
  container_name: String             # outcome-named (principle 1) — never a theme/capability/layer
  outcome: String                    # one outcome statement per container (principle 5)
  members: List<IssueRef>            # membership map: which loose tickets move in
  coherence_edges: List<{blocker, blocked}>   # proposed, explicit, never written

CONSTRAINT every input loose ticket appears exactly once across
           (union of proposals[].members) ∪ leave_loose
```

Plus the standard envelope's `Methodology: <name>` banner. Unanswered (or an empty answer) ⇒ the caller reports "no grouping opinion" and writes nothing.

**Gateway contract row** (named-output table, one table line): `rehome-set` | Requested by `faff-plot` | Optional | In: the project-less Backlog issue set + dependency graph + existing projects (row-local inputs — the caller assembles them; the standard envelope is not extended). Out: the shape above — proposed outcome-led containers (name + outcome), membership map, proposed coherence blocker edges, an explicit leave-loose set, principle-keyed findings. States read-only ("proposes, never writes — applying is the caller's human-gated act") and the unanswered fallback.

**Transport grain row** (the table FAFF-421 creates): `rehome-set` — one dispatch per rehome pass; the caller assembles the whole loose set and makes a single batched request/response (align wording with the shipped FAFF-421 table's vocabulary).

**Agile lens implementation** — answers through its principles:

- Outcome-named containers only (principle 1); a thematic bucket in a proposal is the lens's own structural-category error — never propose one.
- One outcome per container (principle 5).
- A cluster too thin to be a deliverable stays loose (principle 4 — right-sizing applied to containers).
- Coherence blocker edges proposed explicitly (principle 6).
- Proposals ordered by which grouping unlocks sequencable value first (principles 2 + 7).
- Conservative bias stated in-prose: wrong grouping worse than loose; some loose is correct; high-confidence proposals only; undo is a manual reassign, so err loose. No ticket refs in the prose.
- Appetite tunes proposal breadth and the confidence threshold only — never write authority (the read-only-output appetite pattern `crank-up-set` and `yagni-judge` use); at every level, zero tracker writes.

**Loose-accumulation diagnostic** (agile lens `backlog-diagnostics` extension): a new finding — N project-less Backlog tickets among which the lens detects ≥1 groupable cluster (a subset it could name an outcome for; a judgement call, threshold-free, no config key) → the finding names the cluster members (tracker ID + gloss) and the candidate outcome, and recommends running the rehoming pass. Renders through tidy/wtf's existing methodology sections; the existing don't-nag rule (repeat findings surfaced at most once) applies unchanged; additive over the structural/topology floor.

**Thematic default:** a short `### rehome-set` subsection documenting its legitimate answer — an empty rehome-set: the thematic lens holds no outcome opinion, so no containers, no membership, no edges. Closing sentence follows the house convention: "Empty/unanswered ⇒ the caller reports no grouping opinion and writes nothing (zero-config unchanged)."

**Judgement seam:** `rehome-set` is a new LLM-judgement seam (grouping + outcome-naming judgement). New grader KIND **`grouping`**, surface `faffter-dark-methodology-agile-delivery`, status `covered`, ≥1 eval case. The agile lens's frontmatter changes `judgement_seam: ordering` → `judgement_seam: grouping`: once a skill owns a registry row, `reconcileSeam` expects exactly its own rows (the slot-sibling relaxation applies only to row-less skills) — the precedent is `faffter-dark-spec-review`, which owns `refutation-spec` and declares only that. The thematic default keeps `judgement_seam: ordering` (its own row), unchanged.

## 4. HOW — Where each edit lands

**Gateway** (`plugin/skills/faff/SKILL.md`): one row in the named-output contract table + one row in the FAFF-421 Transport grain table. No Standard-envelope edit (inputs are row-local). No Display-convention edit. Total ≤4 lines; verify with a line count at build (headroom is ~7 lines under the 1100 cap — keep additions to the two rows).

**Agile lens** (`plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md`):
1. Outputs preamble: add `rehome-set` to the optional-output list.
2. Outputs table: one `rehome-set` row mapping principles (1, 5 container shape; 4 thin-cluster stays loose; 6 coherence edges; 2 + 7 proposal ordering).
3. New `##` section (following the house shape of the existing rehome/convert sections): the proposal procedure, the conservative-bias prose, the completeness constraint, the appetite sentence, and the loose-accumulation diagnostic finding (with a diagnosis template in the lens's three-part educational shape).
4. `backlog-diagnostics` table row: extend its principle-findings list with the loose-accumulation finding, pointing at the new section.
5. Frontmatter: `judgement_seam: grouping`.

**Thematic default** (`plugin/skills/faffter-noon-methodology-thematic/SKILL.md`): the short `### rehome-set` subsection.

**Eval harness** (all in this same change, per the authoring charter's seam obligation):
- `eval/grader.mjs`: add `grouping` to `KINDS`; join the `gloss_rubric` arm of `validateCase` and add a grade branch that reuses `gradeCoverage` verbatim over an `env.grouping` collection (container name + outcome glosses plus leave-loose lines) — the `shaping`/`architecture` precedent, no new grade math, not in `CLOSED_SET_KINDS`; add the header-comment entry in the existing style.
- `eval/seam-registry.json`: `"grouping": { "surface": "faffter-dark-methodology-agile-delivery", "status": "covered" }`; update the `_comment`'s "28" to the new count.
- `test/seam-registry.test.mjs` asserts `28` in **three** places — the registry-keys length, the `KINDS.length` assertion, and the test title — bump all three to 29 in the same change or the suite fails.
- ≥1 case `eval/cases/grouping-001.json`: fixture = a loose issue set + dependency graph + existing projects, containing two nameable outcome clusters and at least one genuinely-loose ticket; oracle = `gloss_rubric` with `must_include` synonym-sets for each expected grouping's outcome and for the leave-loose expectation, `must_avoid` thematic-bucket phrasings (e.g. "tech debt", "refactors", layer names). Recording the baseline value is the one human step, never required by the lint.

**Behavior summary — how the lens answers a request:** given the loose set + graph + existing projects, cluster by shared outcome; name each high-confidence cluster's container by its outcome; propose the coherence edges that make it sequencable; everything else goes to leave-loose with a reason; order proposals by sequencable-value unlock; attach principle-keyed findings; return — write nothing.

**Edge cases:**
- Empty loose set ⇒ empty proposals + empty leave-loose + a findings note; the diagnostic does not fire.
- Every cluster below the confidence bar ⇒ all tickets in leave-loose (a valid, complete answer — not a failure).
- A loose ticket matching an *existing* project's outcome ⇒ the lens may propose membership in that existing project; still a proposal, never a write.
- Proposed coherence edges must not create a cycle against the live graph — defer to the composed structural floor's cycle detection; on doubt, omit the edge and note it in findings.

**Failure mode — over-proposing.** The risk is the lens manufacturing groupings to look useful (conservatism failure). How you'd know: the eval case's `must_avoid` catches thematic phrasing, and the leave-loose expectation catches a fixture's deliberately-loose ticket being swept in. What it means: tighten the in-prose confidence bar, not the contract.

## Scenarios

```
Given a loose Backlog fixture with two outcome-nameable clusters and one deliberately-loose ticket
When the agile lens answers rehome-set
Then the output has two outcome-named containers with membership maps and any coherence edges,
     the loose ticket appears in leave_loose with a reason,
     proposals are ordered by sequencable-value unlock,
     findings are principle-keyed, and no tracker write occurs
```

```
Given the thematic default receives a rehome-set request
When it answers
Then the rehome-set is empty and the caller reports no grouping opinion and writes nothing
```

```
Given backlog-diagnostics runs under the agile lens on a backlog with a groupable loose cluster
When findings render through tidy/wtf's existing methodology sections
Then a loose-accumulation finding names the cluster members and candidate outcome and
     recommends the rehoming pass, with no orchestration-skill change and no write
```

Assertions: every input ticket appears exactly once across membership ∪ leave-loose; `faff validate-adapters` green (line caps, seam reconcile, eval-coverage gate); `node --test` green (including the bumped `28` assertions).

## Design decision rationale

- **Output name.** `rehome-set` — human-confirmed during prep 2026-07-11; continues the lens's existing rehome verb, and FAFF-437's approved spec + the consumer-expectation comment are written against it.
- **Output shape.** Match FAFF-437's assumed shape exactly — divergence would force a FAFF-437 reconcile for no gain.
- **Input envelope.** Row-local inputs — the In→out column already carries per-output inputs (`crank-up-set`, `prdr-author` precedent); widening the shared envelope taxes every output for one consumer.
- **Requested-by value.** `faff-plot`, documented forward — the caller ships in FAFF-437; contract-first is the cluster's deliberate order.
- **Display convention.** No gateway Display-convention edit — the proposal renders in the caller FAFF-437 builds; the diagnostic rides tidy bucket 7 / wtf's methodology findings unchanged.
- **Agile lens section shape.** New `##` section + Outputs-table row + preamble mention + `backlog-diagnostics` row extension — the thematic-project finding pattern.
- **Thematic answer.** A short `### rehome-set` subsection — the ticket asks the default to *document its legitimate answer* (an empty set is an answer).
- **Judgement seam.** New KIND `grouping`, surface = the agile lens, status `covered`; agile frontmatter `ordering` → `grouping` (own-rows-strict reconcile — `faffter-dark-spec-review` precedent); thematic keeps `ordering`.
- **Oracle/grade math.** Join the `gloss_rubric` arm and reuse `gradeCoverage` verbatim (`env.grouping` collection) — the `shaping`/`architecture` precedent; the completeness invariant asserted as a skill AC and noted in the fixture, not new grade math.
- **Appetite shape.** Appetite tunes proposal breadth / confidence threshold only, never write authority — the read-only-output pattern; zero writes at every level.
- **Transport grain.** One dispatch per rehome pass carrying the whole loose set as a single batched request.
- **Diagnostic shape.** Threshold-free judgement (groupable-cluster detection), firing whenever `backlog-diagnostics` runs; no config key; existing don't-nag rule governs repetition.
- **Proposal ordering.** By which grouping unlocks sequencable value first, keyed to principles 2 + 7.
- **Conservative-bias placement.** In-prose in the new agile-lens section with no ticket references.

## Open questions & assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** FAFF-421 has shipped — the gateway carries a `### Transport` subsection under The `methodology` slot with a per-output grain table this ticket adds a row to. **Confirmed at graft 2026-07-13** (present at gateway `### Transport (per-output dispatch grain)`).
- **Assumes:** post-FAFF-421 gateway line count leaves headroom for ≤4 added lines under the 1100 cap (observed 1093 at graft — keep additions to the two table rows). Validation: line-count the gateway before and after; `faff validate-adapters` gates it regardless.

## DONE — Definition of done

### From WHY / contract
- [ ] Gateway named-output table has the `rehome-set` row: Requested-by `faff-plot`, Optional, row-local inputs (project-less Backlog set + dependency graph + existing projects), the full output shape, read-only statement, unanswered → "no grouping opinion, writes nothing"
- [ ] Gateway Transport grain table has the `rehome-set` row (one dispatch per pass, whole set batched)
- [ ] Gateway ≤1100 lines; no Standard-envelope or Display-convention edits

### From WHAT (agile lens)
- [ ] Agile lens answers `rehome-set` against a sample loose set with outcome-named containers (name + outcome), membership map, proposed coherence edges, explicit leave-loose set with reasons, principle-keyed findings, ordered by sequencable-value unlock
- [ ] Every input ticket appears exactly once across membership ∪ leave-loose
- [ ] Conservative-bias + appetite (breadth/confidence only, never write) stated in-prose with no load-bearing ticket refs
- [ ] `backlog-diagnostics` gains the loose-accumulation finding (threshold-free, names cluster members + candidate outcome, recommends the rehoming pass); Outputs preamble + table row updated; don't-nag applies
- [ ] Agile frontmatter `judgement_seam: grouping`

### From WHAT (thematic default)
- [ ] `### rehome-set` subsection documents the empty answer with the "Empty/unanswered ⇒ caller reports no grouping opinion, writes nothing" closer; `judgement_seam: ordering` unchanged

### From HOW (eval coverage)
- [ ] Grader KIND `grouping` in `KINDS`, `gloss_rubric` arm, `gradeCoverage`-reusing grade branch over `env.grouping`; not in `CLOSED_SET_KINDS`
- [ ] Seam-registry row (`surface: faffter-dark-methodology-agile-delivery`, `status: covered`); registry `_comment` count updated; `test/seam-registry.test.mjs` `28` assertions (registry-keys length + `KINDS.length` + the test title) all bumped to 29
- [ ] ≥1 eval case (`grouping-001`) with loose-set fixture and `gloss_rubric` oracle covering expected groupings + leave-loose, `must_avoid` thematic phrasings (baseline recording stays the separate human step)

### Verification
- [ ] No tracker write anywhere in the output path (lens prose asserts it; the output is a proposal document)
- [ ] `faff validate-adapters` green; `node --test` green

**Integration smoke test:** feed the agile lens the `grouping-001` fixture as a `rehome-set` request → the answer parses onto the RehomeSet shape, satisfies the exactly-once constraint, and `node eval` grades the case ≥ PARTIAL against the rubric.

confidence: high
spec-review: approve
