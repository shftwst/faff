# FAFF-1204: Spec-review routing keys on the objecting lens's name, not on what the objection is about

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1204.

This spec is for the build agent implementing FAFF-1204 and for the humans reviewing it. When the spec-review gate returns `reject-approach`, `faff-prep` decides where the spec goes next: back to prep for an in-place re-spec, or to plot for a re-slice (a park at L1-L3). Today that choice reads only the objecting lens's name, so any methodology objection, however small, sends the spec to plot. This ticket makes the choice read lens and severity together, moves it from a prose table into a tested CLI verb, and points every restatement at that verb.

## 1. WHY

**The idea the rest turns on.** A methodology objection only means "wrong scope or increment" when it is serious. Severity is already on every objection, so the router can partition `objections` over `{lens, severity}` instead of `{lens}` alone: a `reject-approach` goes to plot only when at least one methodology objection is `blocker` or `major`. Everything else re-specs in place, exactly as a design-lens-only reject does today. No new field, no model call, no change to how the verdict is computed.

**Problem.**

- `faff-prep/SKILL.md` :186-194 routes `reject-approach` "by the objecting lens": any methodology objection sends the spec to plot, which parks at L1-L3. Severity is ignored.
- The L4 aggregator (`aggregate.mjs` :110) yields `reject-approach` from a strict majority of refuted lenses, and a single `minor` refutes a lens. So a verdict made only of minors can reach `reject-approach`.
- FAFF-1201 round 1 is that case: four minors (infosec x2, methodology, QA), no major or blocker. The methodology minor was about byte preservation in a round-trip proof, a design point. The table sent a revise-sized fix to a re-slice park; the prep agent deviated by hand and flagged it (`.faff/logs/2026-10-06/115727-prep-FAFF-1201.md` :5).
- The routing exists only as prose. No code implements it and no test covers it, so the agent applies the table by hand.

**Correction to the ticket's framing.** FAFF-1198 round 1 is not a minors-only case: it carried two methodology `major` objections (one asked to split `faff config unset` into its own ticket). Plot was the right destination there, and it stays the destination under the new rule.

**Corpus evidence (replayed during explore, 108 `reject-approach` rounds under `.faff/spec-review/`).**

| Rule | to prep | to plot |
|---|---|---|
| Today (any methodology objection → plot) | 79 | 29 |
| New (methodology `blocker`/`major` → plot) | 89 | 19 |

The 10 rounds that move from plot to prep: FAFF-588 r2, FAFF-1175 r1 and r2, FAFF-1172 r1 and r2, FAFF-1167 r3, FAFF-1048 r1, FAFF-1201 r1, FAFF-1176 r2, FAFF-1197 r1. Every one carries methodology only at `minor`. Where a claim is recorded it is a design or process point (byte preservation, doc-hash pinning, a stale dependency sentence, a drifting commit pin), never a request to split or re-slice. Every clearly scope-shaped methodology objection in the corpus was `major` or `blocker`; the one minor split suggestion (FAFF-1170 r6) rode alongside a methodology `major`, so it still routes to plot.

### Design principles

**Deterministic set partitioning, extended by one axis.** The router stays a pure function of the verdict's `objections` over closed enums (`lens`, `severity`). It never re-reads the spec, re-invokes a model or asks a lens what it meant. FAFF-811 allows exactly this shape; adding severity keeps it.

**Verdict computation is untouched.** Producers (`aggregate.mjs`, the single-pass reviewer) keep their rules. Only the consumer's routing of an already-validated `reject-approach` changes.

**One home for the rule.** The rule lives in code (`routeRejectApproach`) and in one prose place (`faff-prep/SKILL.md`'s routing table). Every other mention references the CLI verb or that table; none restates the partition.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-review.js` | JavaScript | Owns `faff spec-review` verbs (`extract-evidence`, `select-evidence`); gains the pure `routeRejectApproach` and the `route` verb |
| `plugin/skills/faff/bin/lib/contract-defs.js` :467-469, export list | JavaScript | `SPEC_REVIEW_VERDICTS` / `SPEC_REVIEW_LENSES` / `SPEC_REVIEW_SEVERITIES` (already exported; `admissibility.js` imports them) |
| `plugin/skills/faff/bin/faff` :117, :273 | JavaScript | `spec-review` is already dispatched; no new top-level command |
| `plugin/skills/faff/bin/lib/regions.js` :387-389 | JavaScript | `spec-review` classified `factory` (pure); `route` keeps it pure |
| `plugin/skills/faff-prep/SKILL.md` :182, :186-198, :202, :209, :301, :305, :431, :589, :611 | Markdown | The routing table and its restatements |
| `plugin/skills/faff-beep-boop/SKILL.md` :193 | Markdown | `re-slice-handoff` return wording |
| `plugin/skills/faffter-noon-spec-review/SKILL.md` :67; `plugin/skills/faffter-dark-spec-review/SKILL.md` :258 | Markdown | "routes ... read off the objecting lens" sentences |
| `plugin/skills/faff/bin/lib/validate-adapters.js` :65 | JavaScript | `SKILL_LINE_BASELINE`: `faff-prep` 623 and `faff-beep-boop` 777, zero headroom |
| `docs/guide/cli.md` :163 | Markdown | `spec-review extract-evidence` row; the `route` row joins it |
| `test/spec-review.test.mjs`, `test/helpers/run-cli.mjs` | JavaScript (`node:test`) | Style for the new CLI and unit tests |

**Scope.** One pure function and one CLI verb in `spec-review.js`, their tests and selftest cases, one `cli.md` row, and line-neutral (or leaner) prose edits in four `SKILL.md` files.

## 2. OUT OF SCOPE

- **Changing `aggregate.mjs`'s verdict rule** (a minors-only majority still yields `reject-approach`).
  - Why excluded: the verdict feeds eval baselines (`eval/cases/spec-verdict-00{1,2,3}.json`, refutation-spec scoring) and FAFF-267's aggregation design; with the new routing, a minors-only `reject-approach` already re-specs in place, which is the revise-sized handling the ticket asks for.
  - Extension point: `aggregate.mjs` step 3 (:110) and its selftest, behind its own eval run.
- **A scope tag on objections** (e.g. `about: scope|design`).
  - Why excluded: rejected below (see DESIGN DECISION RATIONALE).
  - Extension point: `spec-review-verdict.schema.json` objection items plus `computeSpecReviewVerdict`.
- **The "minor = edit in place" severity paragraph in `refute-methodology.md`.** The other three refuter prompts carry it; methodology does not.
  - Why excluded: prompt edits shift eval baselines, and FAFF-1236 is measuring a prompt sentence now. A conditional follow-up only: it is not filed unless the "real scope objection arrives at `minor`" failure mode below is actually seen.
  - Extension point: `plugin/skills/faffter-dark-spec-review/refute-methodology.md` :36-37.
- **The L1-L3 park vs L4 re-slice split.** It depends on level and on invoking a skill, so it stays prose in `faff-prep`.
  - Extension point: `faff-prep/SKILL.md` "L4 autonomous re-slice".
- **The `--describe` semantics for `reject-approach`** ("the whole approach is unsound") in `contract-defs.js` :3403. Contract wording, unchanged.
- **Typed objection intake on plot.** Plot still has no objection-intake seam; carried objections stay an audit block. Extension point: `faff-plot` ignition (FAFF-811's noted future).
- **The churn-to-human escalation FAFF-1201 also hit.** Separate mechanism (`spec-review-churn`), unchanged.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| Design lens | `architectural`, `infosec` or `QA` |
| Scope-weight methodology objection | an objection with `lens: "methodology"` and `severity` of `blocker` or `major` (contract enum; the refuters' `critical` maps to `blocker` before routing) |
| Destination | where a `reject-approach` goes next: `prep` (re-explore and re-spec in place, bounded loop) or `plot` (L1-L3 park for `/faff-plot`; L4 autonomous re-slice) |

### Types

```
ENUM Destination: "prep" | "plot"

ENUM RouteReason:
  "methodology-major-or-above"   # destination plot
  "no-methodology-major"         # destination prep

RECORD Route:                      # stdout of `faff spec-review route`, one JSON line
  destination: Destination
  reason: RouteReason
  carried_design_objections: List<{ lens, severity }>
      # destination plot: every design-lens objection, input order, {lens, severity} only
      # destination prep: always []

RECORD RouteInput:                 # accepted shape (either is fine)
  verdict: "reject-approach"       # anything else is an input error
  objections: List<{ lens, severity, ...ignored fields }>   # non-empty
  conformant?: Boolean             # present on `faff contract spec-review-verdict` output; false is an input error
  violations?: List<String>        # ignored
```

### Interfaces

**Pure function** in `spec-review.js`, exported:

```
FUNCTION routeRejectApproach(record) -> { route: Route } | { error: String }
```

**CLI verb** on the existing `spec-review` command:

```
faff spec-review route [--file <verdict.json> | --file -]
```

- Reads the verdict JSON from `--file`, or stdin when `--file` is `-` or omitted (same convention as `extract-evidence`).
- Accepts the raw block body `{verdict, objections}` or the `faff contract spec-review-verdict` stdout (which adds `conformant`, `violations`).
- Exit 0: prints one `Route` JSON line.
- Exit 2: unreadable input, unparseable JSON, or any input error from `routeRejectApproach`; message on stderr, nothing on stdout.
- No exit 1: there is no legitimately-absent state.
- `SPEC_REVIEW_USAGE` and the "expected:" message gain `route`.

**Chosen:** a third verb on `faff spec-review` (`route`), not a new top-level `spec-review-route` command. The module already owns the reader/selector verbs over the same verdict record; a verb avoids a new dispatch-table entry and region classification.

**Chosen:** a non-`reject-approach` verdict is an input error (exit 2), not a no-op. Prep only calls `route` on `reject-approach`; any other verdict reaching it is a plumbing fault, and failing loud surfaces it instead of inventing a destination.

**Chosen:** output is always JSON (no `--json` flag, no `--describe`), matching `select-evidence`.

## 4. HOW

### The routing function

Partition the objections over lens, then check methodology severity.

```
PROCEDURE routeRejectApproach(record):
  1. IF record is not a plain object                          → error "verdict record must be a JSON object"
  2. IF record.verdict != "reject-approach"                   → error "route applies to reject-approach only (got <verdict>)"
  3. IF record.conformant === false                           → error "verdict is not conformant"
  4. IF record.objections is not a non-empty array            → error "reject-approach carries no objections"
  5. FOR EACH objection o (index i):
       IF o.lens not in SPEC_REVIEW_LENSES                    → error "objection[i] lens <x> not in {...}"
       IF o.severity not in SPEC_REVIEW_SEVERITIES            → error "objection[i] severity <x> not in {...}"
  6. scope   := objections WHERE lens == "methodology" AND severity IN {"blocker","major"}
  7. design  := objections WHERE lens != "methodology", mapped to { lens, severity }
  8. IF scope is non-empty:
       RETURN { destination: "plot", reason: "methodology-major-or-above",
                carried_design_objections: design }
  9. RETURN { destination: "prep", reason: "no-methodology-major",
              carried_design_objections: [] }
```

- Import the enums from `contract-defs.js` rather than redeclaring them. `spec-review` and `contract` are both `factory` in `regions.js`, and `admissibility.js` (also `factory`) already requires `contract-defs`; confirm with `faff regions check`.
- Pure: no fs, no network. The CLI wrapper does the read.

### Destination table (what changes)

| Objections on the `reject-approach` | Today | New |
|---|---|---|
| Design lenses only, any severity | prep | prep |
| Methodology only, any at `blocker`/`major` | plot | plot |
| Methodology only, all `minor` | plot | **prep** |
| Methodology at `blocker`/`major` plus design lenses | plot, design carried | plot, design carried |
| Methodology all `minor` plus design lenses | plot, design carried | **prep**, nothing carried |

### Single-pass default path (`faffter-noon-spec-review`)

The single-pass reviewer emits `reject-approach` only on an `architectural` or `methodology` blocker (:57-59), with at most one objection per lens.

- Methodology blocker present → plot under both rules.
- Architectural blocker, no methodology objection → prep under both rules.
- Architectural blocker plus methodology `major` → plot under both rules.
- Architectural blocker plus methodology `minor` → was plot, now prep. This is the intended change (a design blocker with a minor shaping note is a re-spec), and the only default-path difference.

### `faff-prep/SKILL.md` edits (canonical `plugin/skills/` copy only)

Net line count of the file must not grow (baseline 623, zero headroom). If it shrinks, lower `SKILL_LINE_BASELINE["faff-prep"]` to the new committed count with a one-clause comment entry, per the ratchet convention.

- **:182** verdict row: `reject-approach` → "Route by `faff spec-review route` (table below)."
- **:186-194** replace the intro, three-row table and partition sentence with:
  - Intro: `reject-approach` routes by `faff spec-review route` (pipe it the validated verdict, the `faff contract spec-review-verdict` stdout), a deterministic partition of `objections` over `{lens, severity}`, no second inference layer. Exit 2 parks `needs-human`.
  - Two rows keyed on the CLI's `destination`:
    - `prep`: no methodology objection at `major` or above (design lenses only, or methodology only at `minor`) → re-explore and re-spec in place (bounded loop below).
    - `plot`: a methodology objection at `major` or above → scope or increment is wrong. Keep today's L1-L3 park / L4 `/faff-plot --autonomous` wording, plus: carry the CLI's `carried_design_objections` (when non-empty) into the park record or re-slice handoff log.
  - The partition sentence becomes: the partition is computed by the CLI from `objections`, never a relevance re-inference.
- **:196** "Carried design-lens objections (multi-lens `reject-approach` only)" → "(plot-destined `reject-approach` with design-lens objections)"; the list is the CLI's `carried_design_objections`.
- **:198** "(methodology-lens or multi-lens `reject-approach`, L4 only)" → "(plot-destined `reject-approach`, L4 only)".
- **:202** log `{parent, objecting lens(es), target}` stays.
- **:209**, **:301**, **:431**, **:589**: replace "design-lens `reject-approach`" with "prep-destined `reject-approach`" and "methodology-lens (or multi-lens) `reject-approach`" / "methodology-lens reject" with "plot-destined `reject-approach`". Edit in place, no new lines.
- **:305** park causes: rename `(methodology/scope)` to `(methodology at major or above)` in the three plot causes; add `spec-review route failed (exit 2)` to the list in the same line.
- **:611** `re-slice-handoff`: "a methodology-lens (or multi-lens) `reject-approach`" → "a plot-destined `reject-approach` (see **Spec-review gate**)".

### Other prose edits

- `faff-beep-boop/SKILL.md` :193: "a methodology-lens (or multi-lens) spec-review reject-approach" → "a plot-destined spec-review reject-approach (`faff-prep/SKILL.md` → Spec-review gate)". In place; line count unchanged (baseline 777).
- `faffter-noon-spec-review/SKILL.md` :67 and `faffter-dark-spec-review/SKILL.md` :258: "read off the objecting lens" → "computed by `faff spec-review route` from lens and severity". In place.
- `faffter-noon-spec-review/SKILL.md` :59 comment `# wrong increment → plot re-slices` stays true (a blocker is above `major`); no edit.
- `faff/references/kernel.md` :418-422 defers to `faff-prep` and names no lens rule; no edit.
- No `FAFF-NN` or ADR references in any `SKILL.md` text (`faff lint-refs` scope).
- `docs/guide/cli.md`: add a `spec-review route [--file <verdict> \| --file -]` row after `spec-review extract-evidence`, stating input shapes, the `Route` output, exit 0/2, and "pure (stdin/fs read only)".

### Edge cases

- Duplicate objections from one lens: each is checked; one methodology `major` among several minors is enough for plot.
- A `reject-approach` from the aggregator's severity veto (a design-lens `critical`, mapped to `blocker`) with a methodology `minor`: prep, design objections not carried.
- `n = 1` enabled lens, methodology only, one `minor` (the aggregator yields `reject-approach`): prep.
- Extra objection fields (`claim`, `evidence`, `spec_anchor`, `disposition`, ...) are ignored; carried entries are exactly `{lens, severity}`.
- An out-of-enum lens or severity (e.g. `observation`) cannot reach `route` after a conformant contract pass; if it does, exit 2.

### Failure modes

- **A real scope objection arrives at `minor`.** The router sends it to prep, and the re-spec handles it in place instead of re-slicing. How you'd know: a later round's methodology lens raises the same split at `major` (routes to plot then), or a human sees an oversized slice at review. What it means: accepted residual; the corpus shows none today. If it recurs, the follow-up is the `refute-methodology.md` severity paragraph (OUT OF SCOPE), not a scope tag.
- **Prep stops calling the CLI and re-derives the table by hand.** How you'd know: a run log routes a minors-only methodology reject to plot. What it means: the prose edit regressed; the one-home rule in `faff-prep` is the guard.

**Anti-pattern:** restating the partition rule in `faff-beep-boop`, the reviewer skills or `kernel.md`. Why: four copies of the old rule are what this ticket has to chase down; references only.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the FAFF-1201 round-1 objections: infosec minor, infosec minor, methodology minor, QA minor
When the verdict {verdict: "reject-approach", objections: [...]} is piped to `faff spec-review route`
Then it exits 0 and prints {destination: "prep", reason: "no-methodology-major", carried_design_objections: []}
```

```
Given the FAFF-1198 round-1 objections: architectural minor, methodology major, methodology major, methodology minor, methodology minor, QA minor, QA minor
When routed
Then destination is "plot", reason "methodology-major-or-above", and carried_design_objections is
     [{architectural, minor}, {QA, minor}, {QA, minor}] in input order
```

```
Given a verdict of "revise" with one architectural major objection
When piped to `faff spec-review route`
Then it exits 2, writes a message naming reject-approach on stderr, and prints nothing on stdout
```

## 6. DESIGN DECISION RATIONALE

**Route by severity, by an explicit scope tag, or both?**

- Severity: already on every objection, already in the contract, deterministic. Residual: a minor scope objection re-specs in place. Corpus shows every clear scope objection at `major`/`blocker`.
- Scope tag: needs a schema field (objection items are `additionalProperties: false`), `computeSpecReviewVerdict`, `parse-refutation.mjs`, `aggregate.mjs` `TRIPLE_FIELDS`, refuter and single-pass prompts, and `adversarial-judge-scrub.js` (a scope/design tag leaks the lens past the blinding scrub). FAFF-811 judged the `{lens, severity}` contract sufficient. Prompt changes also move eval baselines.
- Both: the cost of the tag plus a rule for when they disagree.

**Chosen:** severity only, no scope tag. A methodology objection at `blocker` or `major` makes the destination plot; otherwise prep.

**Should the multi-lens row still carry design-lens objections?**

- Always carry: on a prep destination the re-spec acts on them directly, so a carried block is noise.
- Carry only on plot: plot cannot act on design objections, so the audit block proves they were not dropped.

**Chosen:** carry only when the destination is plot; `carried_design_objections` is `[]` for prep.

**Answer to the ticket's "relatedly" paragraph: should a minors-only majority still yield `reject-approach`?**

- Change `aggregate.mjs` to yield `revise`: shifts eval baselines and FAFF-267's documented aggregation.
- Leave it: with the new routing a minors-only `reject-approach` has no methodology `major`, so it routes to prep and re-specs in place, which is revise-sized handling.

**Chosen:** leave `aggregate.mjs` unchanged; the routing change alone gives the minors-only case revise-sized handling.

**Where does the rule live?**

- Prose table (today): untested, applied by hand, restated in several skills.
- Code plus one prose table that calls it: testable, single source.

**Chosen:** pure `routeRejectApproach` plus `faff spec-review route`; the L1-L3 park vs L4 re-slice split stays prose because it depends on level and on invoking `/faff-plot`.

**Verb or command, and what does a non-reject verdict do?** Covered in WHAT. **Chosen:** `route` verb on `faff spec-review`; a non-`reject-approach` verdict exits 2.

**Edit `refute-methodology.md` now?**

- Yes: aligns its `minor` guidance with the other three lenses.
- No: prompt edits move eval baselines while FAFF-1236 is measuring a prompt sentence; routing alone fixes the ticket.

**Chosen:** no prompt edit in this ticket; listed under OUT OF SCOPE as a possible follow-up.

**Is an ADR needed?** The routing rule was never an ADR (ADR-0025 fixes the contract shape, not consumer routing), and the contract is unchanged. **Chosen:** no ADR; this spec record is the reasoning home.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None.

**Assumptions.**

- **Assumes:** `contract-defs.js` exports `SPEC_REVIEW_LENSES` and `SPEC_REVIEW_SEVERITIES` and `spec-review.js` may require it. Validate: `node -e 'console.log(require("./plugin/skills/faff/bin/lib/contract-defs.js").SPEC_REVIEW_SEVERITIES)'`, then `faff regions check` after the edit.
- **Assumes:** prep pipes the stdout of `faff contract spec-review-verdict` (exit 0) to `route`. Validate: given `{"verdict":"reject-approach","objections":[{"lens":"methodology","severity":"minor"}]}` on stdin, `faff contract spec-review-verdict` exits 0 and prints `{verdict, objections, conformant, violations}` (confirmed during explore).

## 8. DONE

### From WHY
- [ ] The FAFF-1201 round-1 objection shape routes to `prep`; the FAFF-1198 round-1 shape routes to `plot` (unit tests with the lens/severity lists copied into the test, not read from run files).

### From WHAT
- [ ] `routeRejectApproach` is exported from `spec-review.js` and returns `{route}` or `{error}` per the pseudocode.
- [ ] `faff spec-review route` reads `--file <path>`, `--file -`, or stdin; exit 0 prints exactly one `Route` JSON line; exit 2 on unreadable input, bad JSON, non-`reject-approach`, `conformant: false`, empty objections, or an out-of-enum lens/severity, with nothing on stdout.
- [ ] Both input shapes (raw block body; contract stdout with `conformant`/`violations`) route identically.
- [ ] `SPEC_REVIEW_USAGE` and the unknown-verb message list `route`.

### From HOW (routing, `test/spec-review-route.test.mjs`)
- [ ] Methodology only: `minor` → prep; `major` → plot; `blocker` → plot.
- [ ] Design lenses only (each of `architectural`, `infosec`, `QA`, including a `blocker`) → prep, `carried_design_objections: []`.
- [ ] Methodology `minor` plus design lenses → prep, nothing carried.
- [ ] Methodology `major` plus design lenses → plot, carried list equals the design objections as `{lens, severity}` in input order, extra fields stripped.
- [ ] Single-pass shapes: architectural blocker + methodology minor → prep; architectural blocker + methodology major → plot.
- [ ] CLI wiring via `runCli`: stdin, `--file -`, `--file <path>`, exit-2 cases, and a pipe from `faff contract spec-review-verdict` into `route`.
- [ ] `specReviewSelftest` gains route cases (one prep, one plot, one exit-2) and still returns 0.

### From HOW (prose)
- [ ] `faff-prep/SKILL.md` routing table has two rows keyed on the CLI's destination and names `faff spec-review route`; :182, :196, :198, :209, :301, :305, :431, :589, :611 use the plot-destined / prep-destined wording; `route failed (exit 2)` is a park cause.
- [ ] `faff-beep-boop/SKILL.md` :193, `faffter-noon-spec-review/SKILL.md` :67, `faffter-dark-spec-review/SKILL.md` :258 reference the CLI instead of "the objecting lens".
- [ ] `grep -rn "objecting lens" plugin/skills/*/SKILL.md` returns no routing rule: the only remaining hits are `faff-prep` :202's log field `objecting lens(es)` and `faffter-dark-spec-review` :262's run-log wording.
- [ ] `faff validate-adapters` passes with `faff-prep` at or below 623 lines and `faff-beep-boop` at or below 777; a shrink lowers the baseline to the committed count.
- [ ] `faff lint-refs` finds no new ticket/ADR refs; `faff regions check` passes.
- [ ] `docs/guide/cli.md` has the `spec-review route` row; `faff lint-cli-doc` passes.
- [ ] `aggregate.mjs`, `refute-*.md`, the contract schema and eval cases are unchanged (`git diff --stat` shows none of them).

### Integration smoke test

```
1. block := '{"verdict":"reject-approach","objections":[
      {"lens":"infosec","severity":"minor"},{"lens":"infosec","severity":"minor"},
      {"lens":"methodology","severity":"minor"},{"lens":"QA","severity":"minor"}]}'
2. validated := pipe block to `faff contract spec-review-verdict`      # exit 0
3. route := pipe validated to `faff spec-review route`                 # exit 0
4. ASSERT route.destination == "prep" AND route.carried_design_objections == []
5. Repeat with the methodology objection at "major"
6. ASSERT destination == "plot" AND carried == [{infosec,minor},{infosec,minor},{QA,minor}]
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** No issues. One concern (replace lens-only `reject-approach` routing with a `{lens, severity}` partition in a tested CLI verb, and point every restatement at it). The prose edits ship with the code, and no sibling always ships with it.
- **Workstream fit (P1 + P5):** No issues. Project-less default landing. FAFF-1204, FAFF-1240, FAFF-1239, FAFF-1243, FAFF-1236 and FAFF-1093 may later form an outcome cluster ("a spec-review result routes and records what the reviewers meant"); that is for a rehoming pass, not a blocker.
- **Surfaced dependencies (P6):** one edge added at prep, one follow-up reworded.
  - FAFF-1093 (the judge interceptor does not fire on a design-lens `reject-approach` loop at the cap) names the loop this spec rewords to "prep-destined `reject-approach`", and the new rule sends about 10 of 108 corpus rounds into that loop. Linked as related, with a note on FAFF-1093 that its trigger is now "prep-destined `reject-approach`, as `faff spec-review route` computes it". Neither waits on the other; whichever lands second rebases onto the other's wording.
  - The `refute-methodology.md` severity paragraph is now worded as a conditional follow-up, filed only if its failure mode is seen, so no unowned ticket is implied.
  - FAFF-1240 edits different hunks of `faffter-dark-spec-review`; FAFF-1239 and FAFF-1243 touch no file this ticket edits.
- **Risk profile (P7):** low. The router is deterministic over closed enums and the 108-round corpus replay de-risks the behaviour change. One process risk: `SKILL_LINE_BASELINE` in `validate-adapters.js` is a single line every `faff-prep` / `faff-beep-boop` line-count change edits, so rebase immediately before merge and set the baseline to the post-merge committed count.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
