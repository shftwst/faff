# FAFF-599 — `docs/reference/GLOSSARY.md`: ~30 load-bearing nouns, one artifact each; rung→tier/channel and adapter-spelling decisions recorded

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-599.

This spec addresses FAFF-599. It is written for the build agent producing the glossary and for human reviewers checking the approach. It designs one committed documentation file — `docs/reference/GLOSSARY.md` — plus the two link edits that make it findable, and it records three naming decisions whose *execution* (the actual renames) folds into FAFF-74 whenever that migration runs.

## 1. WHY — Problem and Principles

**The load-bearing idea:** faff's vocabulary is coined, and every coined noun is load-bearing precisely because it names an artifact — a file, a CLI command, a hook, a contract. A glossary entry is therefore not a definition exercise but a *binding*: term → one sentence → the artifact that embodies or enforces it. A term that binds to no artifact is either a naming decision awaiting execution (record it) or vapour (leave it out).

**Problem statement.** Around thirty coined nouns (gate, contract, lane, slot, verdict, park, ledger, holdout, …) are defined in passing across an 1100-line gateway, 78 ADRs, and the guide — there is no single lookup, so new readers reverse-engineer the vocabulary and the same word drifts across surfaces. Worst case is `rung`, which currently names three unrelated ladders (the L1–L4 trust ladder, external-verification P-levels, and the sentry corrective ladder), and the `adaptor`/`adapter` spelling split (567 vs 686 occurrences in tracked files). This change commits one `docs/reference/GLOSSARY.md` answering every lookup in one line, and records the disambiguation decisions so FAFF-74 executes them against a settled target.

**Design principles:**

**One sentence, one artifact — never a second normative home.** Each entry is a lookup, not documentation. The normative prose stays where it lives (the gateway, an ADR, `faff contract <name> --describe`); an entry that grows a paragraph or restates a rule is wrong even if accurate, because it creates a drift surface the glossary exists to shrink.

**Decisions recorded here, renames executed in FAFF-74.** The three naming decisions below become normative *for new prose* the moment the glossary lands, but this ticket performs no sweep of existing files — a mass rename is FAFF-74's migration, not a docs ticket's side effect. The glossary states the target; the repo converges later.

**Reference-not-duplicate for contract semantics (the FAFF-598 boundary).** FAFF-598 (spec attached, approach approved) moves per-contract semantics — enum values, per-value meanings, coercion directions, envelope shapes — into `faff contract <name> --describe`. Glossary entries for contract-flavoured terms (contract, verdict, envelope, coercion targets) therefore point at that CLI surface and must never enumerate a contract's values. This also keeps the glossary clear of FAFF-598's new inline-enum-restatement lint by construction, whatever surface that lint eventually covers.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` (gateway) | prose | The densest noun surface and the acceptance yardstick: every load-bearing coined noun *used in the gateway* must have an entry. |
| `README.md` lines 69–78 ("Everything past the pitch lives in `docs/`") | prose | The docs index list the glossary link joins. |
| `CLAUDE.md` (repo root) | prose | The contributor-guidance doc standing in for a CONTRIBUTING file (none exists); gets the second link. |
| `records/adr/0062`, `verification/external-verification/` | prose | The corrective "Channel A/B" language and the P1–P5 tier surface the rung decision disambiguates. |
| FAFF-598 spec (`faff contract <name> --describe`) | design | The contract-semantics surface glossary entries point at, never duplicate. |
| FAFF-74 (related issue) | tracker | The vocabulary-migration ticket that executes the recorded renames. |

**Scope statement:** this is the front-door vocabulary reference for the "Front door & packaging" project — a single committed docs file plus two link lines, no code, no renames.

## 2. OUT OF SCOPE

- **Executing the renames** (rung→tier/channel sweeps, adaptor→adapter prose migration, any `validate-adapters` CLI rename) — why: mass renames are FAFF-74's migration with its own review surface. Extension point: FAFF-74, reading the `## Naming decisions` section as its target state.
- **The CI advisory nudge** (flag an ADR that bold-defines a term absent from the glossary) — why: the issue marks it optional; it needs lint machinery (a new `validate-adapters`/`lint-refs` sibling) that would turn a Size-S docs ticket into a code ticket, and an advisory-only check has no enforcement urgency. Extension point: a future `bin/lib/lint-glossary.js` alongside `lint-refs.js`, advisory exit-0 reporting, never a gate.
- **A new `CONTRIBUTING.md`** — why: none exists today; conjuring one to satisfy a link line inverts the ticket (the file would exist only to point elsewhere). Extension point: if CONTRIBUTING.md is ever created, it links the glossary then.
- **Per-contract semantics in glossary entries** — why: FAFF-598 makes `faff contract <name> --describe` the single prose home; duplicating any enum here recreates the drift class that ticket closes. Extension point: the pointer line in the `contract` and `verdict` entries.
- **Defining project-management or tracker-generic terms** (issue, backlog, epic, PR) — why: not coined by faff; padding the glossary dilutes lookup value. Extension point: none needed.

## 3. WHAT — Vocabulary, Types, and Interfaces

**The file:** `docs/reference/GLOSSARY.md`, at the docs root (not `docs/guide/`).

Location tradeoff — `docs/reference/GLOSSARY.md` vs `docs/guide/glossary.md`: the guide directory is the narrative user-guide surface enforced by `lint-refs` (no ticket/ADR cites allowed), while the glossary legitimately cites artifacts including ADR-recorded decisions; the issue title also names the path verbatim, and the uppercase root-level convention (README, CHANGELOG, GLOSSARY) matches its cross-cutting reference role.
**Chosen:** `docs/reference/GLOSSARY.md` at the docs root — outside the `lint-refs` enforced surface, matching the issue title and the FAFF-124 spec's deferred extension point.

**Document structure**, in order:

1. **H1 + a two-sentence preamble** — what the file is (term → one sentence → artifact) and the maintenance rule (add an entry when a new coined noun lands; keep entries to one sentence; normative prose lives elsewhere).
2. **`## Terms`** — one three-column table, alphabetical:

```
| Term | Meaning (one sentence) | Artifact it names |
```

   - *Meaning* is a single sentence in plain contributor-facing English (the descriptive-writing house rule — a stranger without the methodology spec can follow it).
   - *Artifact* is the concrete embodying/enforcing thing: a file path (`plugin/skills/faff/bin/lib/heartbeat.js`), a CLI command (`faff runcheck`), a hook (`prepcheck` Stop hook), a contract surface (`faff contract holdout-verdict --describe`), or a config key (`appetite` in `.faffrc.yaml`). Where a term is prose-governed with no single artifact (e.g. `seam`), name the canonical prose home (the gateway section) — one artifact per entry, the most load-bearing one.
3. **`## Naming decisions`** — the three recorded decisions (below), each a short bold-led paragraph naming the decision, the reason, and "execution folds into FAFF-74".

Format tradeoff — table vs definition list: the house rendering rule prefers tables with descriptive lead columns for enumerable sets, and a three-column row *is* the entry contract (term/sentence/artifact) made structural — a definition list invites the paragraph-growth the first design principle bans.
**Chosen:** one alphabetical three-column table for all terms; no per-letter headings, no thematic grouping (grouping is an opinion that goes stale; alphabetical is a lookup).

**The entry set.** The starting set is the issue's list plus the terms the two normalisation decisions introduce — approximately: adapter, appetite, born-verifiable, cage, channel, contract, dial, DoD, envelope, fence, floor (compound rule), gate, graft, heartbeat, holdout, lane, leash, ledger, mint, park, PRDR, prep, producer, region, rung, seam, sentry, slot, tier, tidy, verdict, wave. The authoritative inclusion rule outranks the list:

**Inclusion rule.** An entry exists for every noun that is (a) coined or repurposed by faff (not tracker-generic English) and (b) load-bearing — used in the gateway, a contract name, or a CLI surface with a meaning a new reader cannot infer. The build agent sweeps the gateway (`plugin/skills/faff/SKILL.md`) as the acceptance yardstick: any coined noun found there and absent from the table is a gap.
**Chosen:** rule over list — the ~30 list above seeds the table; the gateway sweep completes it. A sweep discovery that is genuinely ambiguous (unclear whether coined) gets an entry — over-include, since a spare entry costs one row and a missing one fails the acceptance sketch.

**The three recorded decisions** (human-set direction from the issue title and body — recorded, honoured, not re-litigated):

1. **`rung` is reserved for the isolation/trust ladder.** The L1–L4 ladder and the isolation ladder (ADR 0041) keep `rung`. External-verification P-levels (P1–P5) are **tiers**. Sentry corrective ladder steps are **channels** (ADR 0062's "Channel A/B" language already exists). `rung`, `tier`, and `channel` each get their own glossary entry stating its reserved domain. **Chosen:** as stated — the issue records this as decided; the glossary is where the decision becomes citable.
2. **`floor` never appears bare.** Always compounded — merge floor, no-execute floor, structural/topology floor, appetite floor — because a bare "floor" cannot be bound to an artifact. The `floor` entry states the compound rule and points at the compound entries' shared shape rather than defining a freestanding concept. **Chosen:** as stated.
3. **Prose standardises on `adapter`.** The CLI already spells `validate-adapters`; renaming the CLI is the expensive direction, so prose converges on `adapter` (the 686-to-567 majority spelling already). The glossary entry is spelled `adapter`, notes the legacy `adaptor` spelling as deprecated-in-prose, and existing occurrences are left for FAFF-74. **Chosen:** as stated — recommend-and-record per the issue; no sweep here.

**Link edits** (the two making the glossary findable):

- `README.md`: one list line in the "Everything past the pitch lives in `docs/`" block: `- [Glossary](docs/reference/GLOSSARY.md) — every load-bearing faff noun, one sentence and the artifact it names.`
- `CLAUDE.md` (repo root, and its mirrored copy in the user-global file is out of this repo's reach — edit only the committed one): one line under the contributor-guidance intro pointing at `docs/reference/GLOSSARY.md` for vocabulary.

CONTRIBUTING tradeoff — the acceptance sketch says "README and CONTRIBUTING link it", but no CONTRIBUTING.md exists in the repo; the contributor-facing doc here is the committed `CLAUDE.md`.
**Chosen:** link from README + committed `CLAUDE.md`; create no CONTRIBUTING.md (see OUT OF SCOPE). This honours the sketch's intent — discoverable from both the user front door and the contributor front door — against the repo as it actually is.

## 4. HOW — Behavior

This is a docs-only change: three files touched (`docs/reference/GLOSSARY.md` new, `README.md` + `CLAUDE.md` one line each), no code, no config, no renames.

**Authoring procedure:**

```
PROCEDURE author_glossary:
  1. Seed the table from the WHAT entry set (~30 rows).
  2. Sweep plugin/skills/faff/SKILL.md for coined nouns; add any row the
     inclusion rule admits and the seed missed.
  3. For each row, resolve the artifact column against the tree:
     a. a file/CLI/hook/config artifact exists → name the most load-bearing one
     b. contract-flavoured term → point at `faff contract [<name>] --describe`
     c. prose-governed only → name the canonical gateway section
  4. Write the Naming decisions section (the three decisions, each ending
     "execution folds into FAFF-74").
  5. Alphabetise; verify every row is one sentence + one artifact.
  6. Add the README and CLAUDE.md link lines.
```

**Edge cases:**

- **A term whose artifact FAFF-598 is about to move** (contract semantics): point at the *destination* surface (`faff contract <name> --describe`) even if FAFF-598 has not merged when this builds — the pointer is forward-correct and the fallback reader lands on the gateway section either way. If FAFF-598 has merged, the pointer is simply live.
- **A term with two artifact candidates** (e.g. `ledger`: the run-ledger file and `faff runcheck`): name the artifact the term *is* (the ledger file), not its checker; the sentence may mention the checker.
- **`rung`/`tier`/`channel` rows before FAFF-74 executes:** each row states the reserved-domain target; existing off-target prose is expected and not this ticket's to fix — the row is the target, not a claim about the current tree.
- **Terms that are verbs-as-nouns** (`park`, `graft`, `prep`, `tidy`, `mint`): the entry defines the noun/verb as faff uses it and binds to the owning skill or CLI surface (`/faff-prep`, `faff label add … faff-parked`, the lights-out mint step).

**Failure modes — how the approach falls over, and how you'd notice:**

- **The glossary rots** — new coined nouns land without entries. How you'd know: a reader hits an undefined gateway noun; the deferred CI nudge (OUT OF SCOPE extension point) is the eventual mechanical answer. What it means: accepted residual for a docs ticket; the preamble's maintenance rule plus review culture carry it until the nudge exists.
- **Entries drift into second-home documentation** — a row grows semantics that later contradict the artifact. How you'd know: review of any PR touching the glossary against the one-sentence rule; rows that cite `--describe` cannot drift on enum content by construction. What it means: reword to a pointer — never grow the row.

## Scenarios

```
Given the committed docs/reference/GLOSSARY.md
When a reader looks up any coined noun used in the gateway
Then the Terms table has a row for it naming one embodying/enforcing artifact
```

```
Given the three naming decisions
When FAFF-74 (vocabulary migration) is picked up
Then the Naming decisions section states the rung→tier/channel reservation,
  the no-bare-floor rule, and the adapter spelling as its executable target,
  each marked "execution folds into FAFF-74"
```

- README's docs index and the committed CLAUDE.md MUST each contain exactly one link to `docs/reference/GLOSSARY.md`.
- No glossary row may enumerate a contract's enum values — contract-flavoured rows point at `faff contract <name> --describe`.
- `faff lint-refs` and `faff validate-adapters` MUST remain green on the post-change tree (the glossary sits outside both enforced surfaces; this asserts no accidental regression via the README/CLAUDE.md edits).

## 6. DESIGN DECISION RATIONALE

**Where does the glossary live?** (a) `docs/reference/GLOSSARY.md` — issue-verbatim, outside lint-refs, root-level reference convention; (b) `docs/guide/glossary.md` — user-guide adjacency but lint-refs would ban the ADR/ticket cites the decisions section needs. **Chosen:** (a).

**Table or definition list?** Table structurally enforces the entry contract and matches the house table-vs-list rule; definition lists invite paragraph growth. **Chosen:** table, alphabetical, no grouping.

**List or rule for inclusion?** A frozen list goes stale on day one; a rule plus a gateway sweep is checkable against the acceptance sketch. **Chosen:** rule seeds-plus-sweep, over-include on ambiguity.

**Honour or reopen the three naming decisions?** The issue title and body record them as decided (human-set direction). Reopening them in a spec would re-litigate settled direction. **Chosen:** record verbatim, scope execution to FAFF-74.

**CONTRIBUTING link with no CONTRIBUTING file?** Creating the file inverts the ticket; skipping the contributor-side link fails the sketch's intent. **Chosen:** the committed `CLAUDE.md` is the contributor front door — link there.

**CI nudge now or later?** At the time of writing the nudge needs new lint code and the issue marks it optional. **Chosen:** out of scope, extension point named (`bin/lib/lint-glossary.js`, advisory-only).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every decision above carries a `**Chosen:**` marker.

**Assumptions:**

- **Assumes:** FAFF-598's `faff contract <name> --describe` surface exists as designed (spec attached and approach-approved on FAFF-598). Validation: the build agent checks whether it has merged; if not, the pointer text is still forward-correct (see the edge case) — no build dependency either way.
- **Assumes:** `lint-refs` enforcement stays scoped to `docs/guide/**` so a root-level glossary may cite FAFF-74/ADRs. Validation: read `LINT_REFS_SURFACES` in `plugin/skills/faff/bin/lib/lint-refs.js` before authoring; if the surface has widened to docs/, strip ticket/ADR cites from the decisions section (state the decisions self-contained, which they already are).

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/reference/GLOSSARY.md` exists, committed, with the preamble stating the entry contract (one sentence, one artifact) and the maintenance rule.

### From WHAT (entry set)
- [ ] The Terms table is alphabetical, three columns, and covers the issue's listed nouns plus every coined noun a gateway sweep admits under the inclusion rule — spot-checkable: gate, contract, lane, slot, verdict, producer, appetite, park, ledger, heartbeat, fence, holdout, sentry, dial, mint, region, PRDR, DoD, born-verifiable, seam, cage, envelope, leash, rung, tier, channel, floor, adapter all present.
- [ ] Every row's artifact column names a real file, CLI command, hook, config key, contract surface, or gateway section (no empty or hand-waved artifact cells).
- [ ] No row enumerates contract enum values; contract-flavoured rows point at `faff contract <name> --describe`.

### From WHAT (naming decisions)
- [ ] The `## Naming decisions` section records all three decisions (rung reserved / tiers / channels; no bare floor; adapter spelling), each ending with "execution folds into FAFF-74".
- [ ] The `rung`, `tier`, `channel`, `floor`, and `adapter` table rows are consistent with the recorded decisions.

### From WHAT (links)
- [ ] README's docs index contains the glossary link line.
- [ ] The committed `CLAUDE.md` contains the glossary link line.
- [ ] No CONTRIBUTING.md is created.

### From HOW
- [ ] No code, config, or rename changes anywhere in the diff (three files only: the glossary, README.md, CLAUDE.md).
- [ ] `faff lint-refs` and `faff validate-adapters` pass on the post-change tree.

### Eval coverage
- [ ] No LLM-judgement seam is introduced (a committed docs file) — no grader/eval registration required.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. ASSERT docs/reference/GLOSSARY.md exists AND contains "## Terms" AND "## Naming decisions"
  2. grep -c table rows ≥ 28
  3. grep README.md CLAUDE.md for "docs/reference/GLOSSARY.md" → one hit each
  4. run `faff lint-refs` → exit 0
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — Size S, one committed docs file plus two link lines; a single 1–3 day unit with no independent concerns to split and no always-ships-together sibling to merge.
- **Workstream fit?** No issues — "Front door & packaging" is exactly the outcome this serves (a legible vocabulary front door); the artifact is cohesive with the project's README/packaging work.
- **Deps surfaced?** No issues — the FAFF-74 related-to link already records the execution home for the naming decisions (correctly *related*, not blocking, in either direction), and the FAFF-598 boundary is designed as a forward-correct pointer so no blocker edge is needed.
- **Risk profile?** No issues — docs-only, no novel integration or external dependency; no de-risking spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
