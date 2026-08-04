# Teach faffter-noon-review the four-value review verdict (drop the stale "three")

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high. Full spec on Linear FAFF-582.

This is a documentation-correctness fix to a shipped default slot occupant, `plugin/skills/faffter-noon-review/SKILL.md`. The audience is the build agent making the edit and the human reviewing the PR. One sentence in that skill still tells the reader the review-verdict contract has three verdicts; the fixed contract has had four since FAFF-405 added `unavailable`. The spec corrects the prose so the skill teaches the contract it actually points back to, and clears an adjacent internal contradiction in the same file's appetite table.

## 1. WHY — Problem and Principles

**The load-bearing idea.** `faffter-noon-review` is a *producer*: it runs five review passes and emits one verdict value. The review-verdict contract it emits into is four-valued (`pass` / `fail` / `needs-human` / `unavailable`). The producer legitimately only ever emits three of those — a reviewer can't declare its own review chain to be down, so `unavailable` is raised by the orchestrator's outage detection (FAFF-405), never self-reported. So "the reviewer works with three values" is true, but "the contract has three verdicts" is false. The current prose states the second when it means the first.

**Problem statement.** Line 110 reads "This maps *this reviewer's* five passes onto the contract's **three** verdicts." The contract it refers back to (gateway → Review verdict; `faff contract review-verdict --describe`) fixes four values, and `review-verdict.schema.json` enumerates four. The line is wrong against the very contract it cites, and — because the skill points to `--describe` rather than restating the enum — the `faff validate-adapters` conformance lint cannot catch it. This is the drift class the conformance apparatus exists to stop, slipping through because the stale claim is a count in prose, not a hand-copied enum.

**Design principles** (each would cause rejection of an otherwise-plausible edit):

- **Do not reintroduce a hand-restated enum.** FAFF-598 shipped `lintInlineEnumRestatement` in `faff validate-adapters` precisely to fail any skill that restates a fixed-contract enum's full closed set (every value + its meaning) in one line. The fix must keep pointing at `faff contract review-verdict --describe` and must NOT list all four values as a normative set. A single named mention of `unavailable` with its rationale is safe — the lint's own tests confirm a partial mention (3 of 4) and a lone-value mention never fire; only the full-set restatement does.
- **Correct the prose, change no behaviour.** This is a wording fix. No verdict routing, no `judgement_seam` declaration, no contract, and no test's expected behaviour changes. The reviewer still emits exactly the three values it emits today.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-review/SKILL.md` | Markdown (skill prose) | The file being corrected |
| `plugin/skills/faff/SKILL.md` → Review verdict (fixed) | Markdown | The canonical four-value contract the skill refers back to |
| `plugin/skills/faff/contracts/review-verdict.schema.json` | JSON Schema | Enumerates the four values (`pass`/`fail`/`needs-human`/`unavailable`) |
| `plugin/skills/faff/bin/lib/validate-adapters.js` → `lintInlineEnumRestatement` | JavaScript | CI lint the edit must not trip (do not restate the full enum) |

**Scope statement.** A one-line-plus prose correction inside one shipped skill file, with a small clarification to the same file's appetite table; it touches no CLI, contract, or test logic.

## 2. OUT OF SCOPE

- **A new "emitted-enum ⊆ schema-enum" lint.** — The ticket floats a cheap guard flagging a producer that under-enumerates a contract enum. **Already shipped:** FAFF-598's `lintInlineEnumRestatement` (`plugin/skills/faff/bin/lib/validate-adapters.js:102`) is the drift-guard for this class, and it is the same mechanism that already converted this file's frontmatter and emitted-block template to `--describe` pointers. No new lint is warranted here. *Extension point:* if a future stale-count is wanted as a hard gate rather than the current pointer-convention, it would extend `lintInlineEnumRestatement`, not add a parallel checker — its own follow-up ticket, not this one.
- **Reworking the five review passes or the verdict-mapping bullets.** — Lines 112–114 map passes to verdicts by descriptive name, not by count; they are correct and stay as-is.
- **Any runtime, contract, or schema change.** — The contract is already four-valued and correct; only the prose lags.

## Already shipped against this surface

The ticket was verified at HEAD `4c3bce0` (2026-07-21) and cited three drift points. Two of the three are **already corrected** at current HEAD `63b752f`:

- **FAFF-598** (Done 2026-07-24, PR #485, commit `a688449` — "faff contract <name> --describe: contract prose generated from contract-defs/schemas; gateway sections become pointers") rewrote the frontmatter description (line 3) and the `faff-contract:review-verdict` emitted-block template (line 126) to point at `faff contract review-verdict --describe` instead of enumerating `pass|fail|needs-human`. It also shipped the `lintInlineEnumRestatement` guard — the "cheap lint" this ticket proposed. Both cited points are no longer stale.
- **FAFF-405** (Done 2026-07-12) is what added `unavailable` as the fourth value and is the source of the drift; it confirms the four-value target.

**Remaining delta (what this spec covers):** the line-110 "three verdicts" sentence, last edited 2026-06-11 (predates FAFF-405, so FAFF-598's file pass left it untouched), plus the appetite-table internal tension the ticket flags. The premise holds for this narrowed scope; the lint half is done.

## 3. WHAT — the corrected statements

Two prose edits in `plugin/skills/faffter-noon-review/SKILL.md`.

**Edit 1 — line 110 (the core fix).** Restate the sentence so it says: the reviewer maps its five passes onto the three verdict values it can emit, out of the contract's four; the fourth, `unavailable`, is an availability signal the orchestrator raises on a review-chain outage (FAFF-405) — never something this producer reports about its own run. Keep the existing pointer to `faff contract review-verdict --describe` and the existing note about the revert test and envelope. The number "three" must no longer be attached to "the contract"; it may still describe how many values *this reviewer* emits, provided the four-value contract is named alongside it.

**Edit 2 — the appetite table's "does not loosen" line (currently line 145).** The table one row up (currently line 140) varies **Scope strictness** by appetite — high/full "allow trivial adjacent cleanups" where low/medium are strict. Two lines later the prose asserts "Review quality (what counts as a finding) does not loosen at any appetite level." Read literally these collide, because scope strictness is a review-quality dimension that visibly loosens. Reconcile by scoping the "does not loosen" claim to the **defect bar** — what counts as a *bug / spec-fidelity / correctness* finding — and acknowledging that the narrow trivial-adjacent-cleanup allowance at high/full is a deliberate, separate axis, not a softening of the defect bar. The existing "appetite governs persistence" point stays.

## 4. HOW — Behaviour

Behaviour is prose-only; there is no procedure to specify. The two edits above are localised string changes. The load-bearing constraints on *how* they are worded are the two design principles in WHY: keep the `--describe` pointer, and never restate the full four-value closed set in one line (or CI's `lintInlineEnumRestatement` fails the PR). Exact wording is the build agent's call within those constraints.

**Anti-pattern:** "fixing" line 110 by spelling out all four values and their meanings inline. Why: that is exactly the full-set restatement FAFF-598's lint fails, and it re-creates the hand-copied-enum staleness the pointer convention removed.

## 6. DESIGN DECISION RATIONALE

**How to correct line 110 — restate the count, or re-point it?**
- *Restate as "four verdicts":* accurate about the contract, but loses the (correct and useful) fact that this reviewer only emits three.
- *Name both — three emitted, four in the contract, with the `unavailable` rationale:* keeps both truths and matches the ticket's requested direction ("producer legitimately emits the three non-availability values — name the rationale").
- **Chosen:** Name both, keep the `--describe` pointer, mention `unavailable` once with its FAFF-405 orchestrator-owned rationale. It is accurate against the contract, preserves the producer truth, and stays clear of the enum-restatement lint.

**What to do about the appetite-table tension.**
- *Delete the "does not loosen" line:* removes the contradiction but also drops a real, useful statement (the defect bar genuinely doesn't move with appetite).
- *Scope it to the defect bar and name the trivial-cleanup allowance as a separate axis:* keeps the true statement and resolves the collision.
- **Chosen:** Scope "does not loosen" to the defect/finding bar and acknowledge the scope-strictness allowance as a deliberate separate axis. Same file, same drift class (prose not matching shipped reality), so it rides along rather than becoming a second ticket.

**Whether to add the proposed enum-subset lint.**
- **Chosen:** No — FAFF-598 already shipped it (`lintInlineEnumRestatement`) and is why two of the three cited points are already fixed. Adding a parallel checker would duplicate a shipped guard. Recorded in OUT OF SCOPE with its extension point.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Both edits have a chosen direction.

**Assumptions:**

- **Assumes:** `faff validate-adapters` runs in the CI gate and its `lintInlineEnumRestatement` check is active. *Validation:* confirmed in-repo — `plugin/skills/faff/bin/lib/validate-adapters.js:698–706` invokes the lint; `test/validate-adapters-enum-restatement.test.mjs` covers it. The build agent runs `faff validate-adapters` (or the repo's lint/test target) before opening the PR to confirm the edit doesn't trip it.
- **Assumes:** line 110 is the only remaining literal "three verdicts" / "three states" claim about the review-verdict contract in this file. *Validation:* `grep -n "three" plugin/skills/faffter-noon-review/SKILL.md` — expect the only contract-count hit at line 110; the appetite table and pass-mapping bullets carry no such count.

## 8. DONE — Definition of Done

### From WHY (the drift is gone)
- [ ] `plugin/skills/faffter-noon-review/SKILL.md` contains no sentence asserting the review-verdict **contract** has "three" verdicts/values.
- [ ] The corrected line names the four-value contract and states that this reviewer emits only the three non-availability values, with `unavailable` identified as the orchestrator-raised outage signal (FAFF-405).
- [ ] The line still points at `faff contract review-verdict --describe`.

### From WHAT / HOW (constraints honoured)
- [ ] The file does not restate the full four-value closed set (all values + meanings) in one line — `faff validate-adapters` passes with no `inline enum restatement` finding for this skill.
- [ ] No change to `judgement_seam`, the verdict-mapping bullets (lines 112–114), any contract, schema, or test's expected behaviour.

### From WHAT (appetite table)
- [ ] The "does not loosen at any appetite level" statement is scoped to the defect/finding bar, and the scope-strictness trivial-cleanup allowance at high/full is named as a deliberate separate axis — the table row and the sentence no longer read as contradictory.

### Integration smoke test
- [ ] Run the repo's lint/test target (`faff validate-adapters` plus the review-skill tests): green, with the enum-restatement lint reporting no finding for `faffter-noon-review`.

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes. A single sub-one-day prose fix to one file. The two edits are one cohesive concern — "make `faffter-noon-review`'s prose match the four-value contract and stop contradicting itself" — and always ship together in one PR, so they merge into one unit rather than splitting.
- **Workstream fit?** Fits the docs-vs-shipped-behaviour cleanup line (related FAFF-570, and the FAFF-598 pointer-convention rollout this completes for one straggler line).
- **Deps surfaced?** No blocking deps. The two source tickets (FAFF-598, FAFF-405) are Done; this is the trailing prose they didn't reach. The proposed lint is already delivered by FAFF-598 — noted, not re-created.
- **Risk profile?** Minimal. Prose-only, no runtime surface, reversible by definition. The one real trap (retripping FAFF-598's lint) is called out as an anti-pattern and covered by a DONE item.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
