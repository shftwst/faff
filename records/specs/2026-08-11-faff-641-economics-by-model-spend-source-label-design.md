# FAFF-641 — the `--by model` spend-source label reaches the rendered table

> Spec: faffter-dark-nlspec · 2026-07-25 · interactive · confidence: high

FAFF-604 put a per-row `source` label on `--by model` rows so a mixed-fleet run says where each model's tokens were read; `renderEconomicsBreakdown` never reads it, so the label only exists behind `--json`. Audience: the build agent, plus reviewers checking this doesn't disturb single-source output.

## 1. WHY — problem and principles

**The load-bearing idea: the renderer must decide from the data, not from the axis name.** Whether a breakdown can name its spend sources is a property of the rows it was handed, not of which `--by` axis produced them. If the renderer branches on `axis === "model"` it will need a third ticket the moment another axis starts carrying source labels. If it branches on "do these rows carry a `source` key", it is already correct for every axis, present and future.

**Problem.** `economics --by model` on a mixed fleet emits a per-row `source` of `transcript-jsonl` or `exec-json-events` (`economics.js:405-420`), but the generic table branch prints key plus six numeric columns and nothing else (`:687-695`). A human reading the default output sees model names and numbers with no indication which lane each came from — the same ambiguity FAFF-604 was filed to remove, surviving in the surface most people actually look at.

**Principles.**

**Single-source output is frozen.** A run with one spend source must render byte-identical to today — same header line, same column header, same row widths, no extra summary line. FAFF-604 made the same promise about the JSON (`test/economics.test.mjs:812`); this extends it to the table. This is the constraint that would make me reject an otherwise-clean implementation.

**Provenance is a display concern with a safe fallback, not a closed enum.** The renderer shortens known source strings for width, but an unrecognised string must still reach the reader verbatim rather than render blank or be dropped. A future source token must degrade to "shown but not abbreviated", never to "invisible" — exactly the failure this ticket is fixing.

**Reference context.**

| Location | What's there |
|---|---|
| `plugin/skills/faff/bin/lib/economics.js:687-695` | The generic class/day/model table branch this ticket changes |
| `plugin/skills/faff/bin/lib/economics.js:405-420` | Where `row.source` is set: model axis only, and only when engine rows exist |
| `plugin/skills/faff/bin/lib/economics.js:449-453` | The axis-level `bd.source` — `"transcript"` or `"transcript+engine-spend"` |
| `plugin/skills/faff/bin/lib/economics.js:658-662` | The `source === "estimate"` early return — no table at all |
| `plugin/skills/faff/bin/lib/economics.js:663-685` | The effort and mcp branches — the existing precedent for provenance as a summary line |
| `plugin/skills/faff/bin/lib/economics.js:1098` | `renderEconomicsBreakdown` is exported, so it is unit-testable directly |
| `test/economics.test.mjs:397-416` | The only existing table test — header regex and day ordering, never columns |
| `test/economics.test.mjs:736-825` | The FAFF-604 mixed-fleet fixtures this ticket's tests reuse |

**Scope.** One function, `renderEconomicsBreakdown`, generic branch only. No producer, no JSON, no pricing, no census.

## 2. Out of scope

- **The `--by mcp` and `--by effort` axes.** Both single-source by construction, both already printing their own summary lines. Extension point: `economics.js:663-685`.
- **Any change to the JSON.** Byte-identical after this change; the label already ships there. Extension point: `economicsBreakdown`'s return at `:451`.
- **Folding engine spend into class and day.** That is FAFF-640. This ticket only ensures the renderer is ready for it.
- **Rendering FAFF-642's `attribution` field.** A separate ticket. The no-data-change boundary is what makes this one safe to ship first.
- **A `--wide` / `--narrow` flag or column-width configuration.** Extension point: `ECONOMICS_SPEC` at `:699-703`.

## 3. WHAT — vocabulary and shapes

| Term | Meaning |
|---|---|
| Census basis | The axis-level `bd.source` — which lanes the whole breakdown drew on |
| Row source | The per-row `source` — which lane that one row's tokens were read from |
| Source-bearing breakdown | A breakdown where at least one row carries a string `source` |

```
RECORD BreakdownRow:            # unchanged by this ticket, read-only here
  key: String
  input, output, cache_write, cache_read, total: Integer
  cost: Number | null
  source: String | ABSENT      # present only when the axis labelled its rows
```

**Display abbreviation** — a lookup with a passthrough default, not a validated enum:

| Row source | Rendered |
|---|---|
| `transcript-jsonl` | `transcript` |
| `exec-json-events` | `engine` |
| both censuses (a mixed row) | `mixed` |
| anything else | the string itself, truncated to the column width |
| absent | `—` |

## 4. HOW — behaviour

Two additions to the generic branch, each gated on data rather than on axis name.

**The census-basis line.** When `bd.source` is anything other than `"transcript"`, print one indented line directly under the `# economics --by <axis>` header naming the basis and the abbreviation mapping. When it is `"transcript"`, print nothing — the frozen single-source path. (`"estimate"` never reaches here; it returns at `:658`.) This line goes *under* the header rather than appended to it, matching how the effort and mcp branches carry their extra context, and leaving the header line free for FAFF-640's separate class-axis change.

**The source column.** When at least one row carries a string `source`, append a trailing column — header `source`, width 10, left-aligned like the key column — to the column header and to every row line. When no row carries one, emit today's exact strings.

```
PROCEDURE render_generic_branch(bd):
  1. header line, unchanged
  2. IF bd.source != "transcript": emit the census-basis line
  3. has_source := any row in bd.rows has a string `source`
  4. column header := today's string, plus " " + "source" padded-end to 10 IF has_source
  5. FOR each row:
       line := today's string
       IF has_source: line += " " + abbreviate(row.source) truncated to 10, padded-end
  6. reconciliation footer, unchanged
```

```
PROCEDURE abbreviate(s):
  1. IF s is not a string: return "—"
  2. IF s == "transcript-jsonl": return "transcript"
  3. IF s == "exec-json-events": return "engine"
  4. IF s == "transcript+engine-spend": return "mixed"
  5. return s
```

**Chosen: a mixed row renders `mixed`.** Raised by the methodology critique: once FAFF-640 folds engine spend into class and day, a class row aggregates both censuses and there is no single lane to name. Answering it here — in the ticket that owns rendering — is what makes FAFF-640 a genuine no-further-change landing. A row aggregating both sources carries `source: "transcript+engine-spend"`, the same vocabulary the axis-level `bd.source` already uses, and renders `mixed`.

**Width.** Today's row is 85 characters. The added column takes it to 96 — the generic table becomes the widest of the breakdowns, three characters past `--by mcp`'s 93. No existing column narrows, so no model name or figure loses characters it has today.

**Anti-pattern:** branching on `bd.axis === "model"`. Why: FAFF-640 may put row-level sources on class and day, and an axis check would silently drop them exactly as today's renderer drops the model ones — the same bug, refiled.

**Anti-pattern:** folding the source into the key column as `gpt-5-codex (engine)`. Why: the key column truncates at 22 characters (`:692`), so real model names would lose their tails to make room for provenance, and the column would stop being a clean sort or grep target.

**Anti-pattern:** treating the abbreviation table as validation and skipping or blanking an unknown source. Why: an unrecognised lane is precisely the case where the reader most needs to be told something is there.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a mixed-fleet run with both transcript and engine spend
When `faff economics --by model` runs without --json
Then the table carries a `source` column and every model row names its lane
  as `transcript` or `engine`
```

```
Given a transcript-only run
When `faff economics --by model` runs without --json
Then the output is byte-identical to the pre-change renderer — no source column,
  no census-basis line, unchanged row widths
```

- The `--json` output for every axis is unchanged by this ticket, byte-for-byte.
- Rendered rows stay at or under 96 characters — the single width bound; the `--by mcp` comparison is not a constraint (amended per spec-review).

## 6. Design decision rationale

**Dedicated column, or folded into the key column?** A trailing column costs 11 characters of width; folding costs model-name characters, because the key column already truncates at 22, and makes the key stop being a stable identifier. **Chosen:** a dedicated trailing `source` column.

**What renders for a row with no `source` key?** On a mixed model-axis breakdown this can't arise — every transcript row gets a label whenever engine rows exist (`:417-419`). But the renderer shouldn't depend on that staying true, and blank cells read as "no data" rather than "not applicable". **Chosen:** `—`, the character `usd()` already uses for an unknown figure (`:656`).

**Abbreviate, or keep the JSON vocabulary verbatim?** Verbatim costs 16 characters and repeats `-jsonl` / `-json-events` on every row without adding meaning. **Chosen:** abbreviate, and name the full mapping once on the census-basis line so the JSON vocabulary stays discoverable from the table.

**Model-only, or axis-generic?** Model-only is smaller today and guarantees a follow-up ticket if FAFF-640 lands row-level sources elsewhere. **Chosen:** axis-generic, keyed on row data and `bd.source`, never on the axis name.

**Is a per-row column right at all, given every precedent uses a summary line?** A summary line alone cannot answer the reader's actual question: on a mixed run with several models, which of *these rows* came from which lane. That is inherently per-row. But the precedent is right that the census basis belongs in a summary line. **Chosen:** both, each doing the job it suits — and the summary line gives the abbreviations a home, which is what makes the short column labels safe.

## 7. Open questions and assumptions

**Open questions.** None blocking.

**Punt:** the mcp and effort axes stay unchanged — both are single-source by construction and would render a constant column.

**Assumes:** FAFF-640, if it adds per-row source labels to class or day, reuses the existing vocabulary (`transcript-jsonl` / `exec-json-events` / `transcript+engine-spend`). *Validate:* grep for `exec-json-events` in `economics.js` before starting; a new token needs no code change — the passthrough renders it verbatim — but add a test case naming it.

**Assumes:** no downstream consumer parses the `--by` table as structured data. *Validate:* grep for callers of `renderEconomicsBreakdown` — at the time of writing there is exactly one, `economics.js:956`, printing to stdout.

## 8. DONE

### From WHY
- [ ] `faff economics --by model` without `--json` on a mixed-fleet run shows each row's lane in the rendered table
- [ ] A transcript-only `--by model`, `--by class` and `--by day` table each render byte-identical to the pre-change output

### From WHAT
- [ ] `transcript-jsonl` renders as `transcript`; `exec-json-events` as `engine`; `transcript+engine-spend` as `mixed`
- [ ] A source string outside that set renders verbatim, truncated to the column width
- [ ] A row with no `source` key, inside a table that shows the column, renders `—`

### From HOW
- [ ] The census-basis line prints when `bd.source != "transcript"` and is absent when it equals `"transcript"`
- [ ] The census-basis line names the abbreviation mapping
- [ ] The source column appears when any row carries a string `source`, and is absent otherwise
- [ ] Neither addition branches on `bd.axis` — a class or day breakdown carrying row sources renders the column too
- [ ] The `source === "estimate"` early return is untouched
- [ ] Rendered rows stay at or under 96 characters

### From tests
- [ ] A test drives `--by model` without `--json` over the existing `ECON_MIXED_RC` / `econCodexRecord` fixtures and asserts the column and both lane labels
- [ ] A regression test asserts the transcript-only `--by model` column-header line equals today's exact string
- [ ] A test calls the exported `renderEconomicsBreakdown` directly with a synthetic breakdown carrying an unknown source string, a mixed source, and a source-less row
- [ ] The existing `--by day` table test (`test/economics.test.mjs:397`) still passes unchanged

confidence: high

---

## Spec revision — folded from spec review (2026-07-25)

Amends the spec comment above. The spec-review gate returned `revise` with one major and one minor objection; both are resolved here, and the spec is `approve` as amended.

**Objection 1 (QA, major): two width criteria that cannot both be satisfied.**

§4 claims the added column "takes it to 96 — inside the precedent set by `--by mcp`, whose rows are already 93". 96 is not inside 93. The reviewer measured both rows and confirmed the arithmetic: the generic row is 85 characters (`2+22+1+9+1+9+1+9+1+9+1+9+1+10`) and the mcp row is 93 (`2+34+1+6+1+9+1+9+1+11+1+6+1+10`). Adding a space plus a 10-wide column gives 96 — wider than mcp, not inside it. That propagated into two contradictory acceptance criteria: §5's "stays inside the width already set by `--by mcp` (93 characters)" and §8's "rows stay at or under 96 characters". A build agent honouring the 93 bound would have to narrow an existing column, which §6 separately forbids.

**Resolution.** Keep 96. The generic table becomes the widest of the breakdowns, and that is the honest trade — the alternative costs model-name or figure characters that readers use.

- §4's "inside the precedent set by `--by mcp`" claim is **withdrawn**. It should read: the row grows from 85 to 96 characters, making the generic table the widest breakdown, three characters past `--by mcp`'s 93. No existing column narrows.
- §5's bullet "the rendered table stays inside the width already set by `--by mcp` (93 characters)" is **struck**.
- §8's "rendered rows stay at or under 96 characters" **stands** as the single width criterion.

**Objection 2 (architectural, minor): the legend can print without its column.**

The census-basis line is gated on `bd.source != "transcript"`; the source column is gated on rows carrying a `source`. Those are equivalent today, but come apart the moment FAFF-640 lands. FAFF-640 has been amended to stamp a per-row `source` on folded class/day rows, which closes the gap from that side — but the renderer should not depend on a sibling ticket keeping its word.

**Resolution — split the line's two jobs by their own gates.** The basis sentence stays gated on `bd.source != "transcript"` (it describes the census, which is true regardless of columns). The abbreviation legend is gated on `has_source`, the same predicate the column uses. A breakdown that names a mixed census but labels no rows then prints an honest basis sentence and no orphaned key.

**§8, DONE** — one criterion added, one amended:

- [ ] The abbreviation legend prints only when the source column is present; the basis sentence prints on `bd.source != "transcript"` independently.
- [ ] *(amended)* Rendered rows stay at or under 96 characters — the single width bound; the `--by mcp` comparison is not a constraint.

**Retained after amendment:**

confidence: high
spec-review: approve

---

**Sequencing.** FAFF-640 is now `blockedBy` this ticket — land this first so 640 arrives to a renderer that already has somewhere to put the mixed-source answer. The edge has been applied to the tracker.
