# Spec — FAFF-151: ADR 0004 addendum (per-surface lane scope)

> Spec: faffter-dark-nlspec · 2026-06-15 · interactive · confidence: high. Full spec on Linear FAFF-151.

This spec is for the build agent and human reviewers. It defines a **documentation-only** change: append a scoping addendum to `docs/adr/0004-judgement-evals-spike.md`, plus a one-line forward-note on `docs/adr/0003-live-driver-spike.md`. No code, no `eval/` behaviour changes.

## 1. WHY

**Problem statement.** ADR 0004 records **"evals-only"** as the judgement-coverage decision, but its measured evidence only ever exercised faff-tidy's *isolatable classification* rubric — the black-box harness never runs the skill itself. Read literally, the ADR implies "evals-only" generalises across the suite; it does not. This addendum records that scope so future per-skill coverage (FAFF-145's children) isn't built on the inlined-rubric proxy where it is unfaithful.

**Design principles.**

- **Amend, never rewrite an accepted ADR.** ADR 0004 (and 0003) are `Accepted`. Additions are append-only; they must not mutate measured results, the Decision text, or prior sections. Reject any implementation that edits existing prose.
- **Qualify scope, don't reverse the decision.** The evals-only-on-frontier decision *stands* for the isolatable classification surface. The addendum narrows its claimed reach; it does not overturn it.

**Reference context.**

| System | Type | Relevance |
|---|---|---|
| `docs/adr/0004-judgement-evals-spike.md` | Markdown ADR | The record being amended (the addendum) |
| `docs/adr/0003-live-driver-spike.md` | Markdown ADR | Left the three lanes open; gets a one-line forward-note |
| `eval/cli-driver.mjs` | JS | The black-box driver whose "doesn't run the skill" behaviour is the finding |

**Scope statement.** A documentation change to two ADR files under `docs/adr/`, both append-only.

## 2. OUT OF SCOPE

- **`eval/` code changes** — excluded; this is a record update. *Extension point:* FAFF-146–150 do the actual per-skill coverage.
- **Rewriting any existing ADR section** — excluded; append-only on both files.
- **A new ADR 0005** — excluded; this is a scope qualification of an existing decision, not a new one. *Extension point:* a genuinely new lane-policy decision would warrant its own ADR.

## 3. WHAT

No new types or interfaces — the deliverable is markdown. Decisions governing its shape:

**Decision — amend vs rewrite vs new ADR.** **Chosen:** append an addendum to ADR 0004. (Rationale in §6.)

**Decision — placement.** **Chosen:** a new top-level `## Addendum 2026-06-15 — wider-suite scope` inserted **after** the final `## Costed follow-ups` section of ADR 0004, leaving every prior section byte-unchanged.

**Decision — header "Amended" note.** **Chosen:** add one `**Amended:** 2026-06-15` line to ADR 0004's metadata block; preserve `Status: Accepted (measured)`.

**Decision — ADR-0003 forward-note.** **Chosen:** add a one-line forward-note to ADR 0003 pointing at ADR 0004's resolution + this per-surface scoping (resolved from the prior Punt; 0004 already links back to 0003, this completes the forward link).

**Required addendum content (the four points), written skimmably:**

1. The black-box lane (`eval/cli-driver.mjs`) **does not execute the skill**: `loadTidyJudgementProse` / `loadSynthesisGlossProse` read the rubric verbatim from the shipped `SKILL.md` into a one-shot prompt (`buildEvalPrompt` = rubric + fixture + `EVAL_MODE_INSTRUCTION`); the plugin is loaded via `--plugin-dir` but **`/faff-tidy` is never invoked** (`EVAL_MODE_INSTRUCTION` asks the model to "run the judgement pass over this fixture internally"). It measures *model + extracted-rubric + fixture*, not the skill as orchestrated.
2. Therefore **"evals-only" was validated only on the isolatable classification surface**; lane selection is a **per-surface call**, not global.
3. **Execution-entangled surfaces likely need the benched live-driver (FAFF-135)**: faff-prep live-thread reconciliation; faff-graft review verdict + revert test; beep-boop/routing six-verdict; faff-jot/faff-plot shaping & decomposition.
4. **FAFF-145's children (FAFF-146–150) are tagged per-surface**; building the live-driver-lane slices is what decides whether the live-driver comes off the bench. The original decision **stands for the isolatable classification surface**.

## 4. HOW

**Approach.** Two single-file appends.

```
PROCEDURE add_addendum:
  1. Re-read docs/adr/0004-judgement-evals-spike.md (confirm unchanged since prep).
  2. After the last line of "## Costed follow-ups", insert:
       a. a blank line, then
       b. "## Addendum 2026-06-15 — wider-suite scope", then
       c. the four points (§3), as a skimmable list with sub-points.
  3. In ADR 0004's header metadata block (the "- **Status:** …" lines), add:
       "- **Amended:** 2026-06-15 — wider-suite scope addendum (see below); original decision unchanged."
     Do NOT alter the existing Status / Date / Tickets lines.

PROCEDURE add_0003_forward_note:
  4. Re-read docs/adr/0003-live-driver-spike.md.
  5. Add one line (in its header metadata or a short "See also" note), e.g.:
       "Lanes 2 & 3 were resolved in ADR 0004 (see its 2026-06-15 addendum for the per-surface lane scope)."
     Append-only; alter no existing prose.

  6. Save both. Change nothing else in the repo.
```

**Anti-pattern:** editing the `## Measured results` tables or the `## Decision` text of either ADR. **Why:** they are accepted records — additions qualify scope / add pointers without mutating findings.

## 5. SCENARIOS

```
Given ADR 0004 and ADR 0003 as currently merged,
When the addendum + forward-note are added,
Then ADR 0004's Context / Measured results / Decision / Consequences / Costed follow-ups sections are byte-unchanged,
 And a new "## Addendum 2026-06-15 — wider-suite scope" section follows on 0004, stating the four points,
 And ADR 0004's header carries an "Amended: 2026-06-15" line with the original Status/Date intact,
 And ADR 0003 carries a one-line forward-note to ADR 0004 with no existing prose altered.
```

Non-functional assertion: **no files outside `docs/adr/0004-judgement-evals-spike.md` and `docs/adr/0003-live-driver-spike.md` are modified; both diffs are purely additive.**

## 6. DESIGN DECISION RATIONALE

**Amend vs new ADR 0005?** Options: (a) addendum on 0004; (b) new ADR 0005. Addendum keeps the qualification co-located with the decision it scopes — a reader of 0004 sees it immediately. The finding *qualifies* 0004 rather than *deciding* something new. **Chosen:** addendum on 0004.

**Placement after Costed follow-ups?** Keeps all measured content above untouched and the amendment clearly demarcated as later-added. **Chosen:** append after the final section.

**Header "Amended" note?** A reader scanning the metadata should see the record was amended without reading to the bottom. **Chosen:** add one `**Amended:**` line; preserve `Status`.

**ADR-0003 forward-note (resolved Punt)?** 0004 already links back to 0003; without a forward-note a reader starting at 0003 wouldn't know lanes 2/3 were resolved. A one-line append completes the 0003 → 0004 link at trivial cost. **Chosen:** add the forward-note. (Rejected: leaving 0003 untouched — saves one file but loses discoverability.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the ADR-0003 Punt is resolved (see §6).

**Assumptions.**

- **Assumes:** `docs/adr/0004-judgement-evals-spike.md` and `docs/adr/0003-live-driver-spike.md` are unchanged since prep read them. *Validation:* re-read both (and check `git status`) before editing; if `## Costed follow-ups` moved, re-locate the 0004 insertion point.

## 8. DONE

### From WHY
- [ ] ADR 0004's existing sections (Context → Costed follow-ups) are **byte-unchanged**.
- [ ] The evals-only decision is preserved (not reversed); the addendum only qualifies its scope.

### From WHAT (content)
- [ ] A `## Addendum 2026-06-15 — wider-suite scope` section exists, **after** `## Costed follow-ups` on ADR 0004.
- [ ] Point 1 stated: black-box lane doesn't run the skill (rubric inlined; `/faff-tidy` never invoked).
- [ ] Point 2 stated: evals-only validated only on isolatable classification; lane is per-surface.
- [ ] Point 3 stated: execution-entangled surfaces likely need the live-driver (FAFF-135), and names them.
- [ ] Point 4 stated: FAFF-145's children decide the live-driver's bench status; decision stands for classification.
- [ ] ADR 0003 carries a one-line forward-note pointing to ADR 0004 + its addendum.

### From HOW
- [ ] ADR 0004 header carries an `**Amended:** 2026-06-15` line; original `Status`/`Date`/`Tickets` lines intact.
- [ ] ADR 0003's existing prose is unaltered (append-only).
- [ ] No files outside the two ADRs are changed.

**Integration smoke test:** `git diff --stat` shows exactly two changed files (`docs/adr/0004-…`, `docs/adr/0003-…`); both diffs are purely additive (no deletions in prior sections).

confidence: high
