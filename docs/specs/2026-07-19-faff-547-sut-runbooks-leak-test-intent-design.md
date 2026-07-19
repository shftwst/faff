# Spec — FAFF-547: Stop SUT RUNBOOKs leaking test intent into the loop

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-547.

> **Revised 2026-07-19** (spec-review `revise`): hardened the paste-hygiene guard from a fixed phrase-denylist into a structural allowlist + relocation-verified check (QA-major — the old denylist missed leaks like P1's "zero needs-human punts" that match no listed phrase); documented the accepted `BRIEF.md`-naming overload and constrained the relocated Stack-preference so it cannot widen the PRD's measured creative-licence (architectural-minor).

This spec addresses **FAFF-547** (Bug — test-validity / dogfooding-infra). Audience: the build agent that will edit the external-verification scaffolders, plus human reviewers checking the measurement boundary is restored. It is a high-level design + acceptance-criteria doc, not a step-by-step.

## 1. WHY — Problem and principles

**The load-bearing model.** The external-verification suite measures a boundary: *does faff build exactly what was asked, respect its scope ceiling, and punt what it cannot judge?* That measurement is only valid if the loop under test never sees the operator's description of the failure modes the suite exists to catch. Today several SUT RUNBOOKs instruct the operator to paste the SUT's `BRIEF.md` — which contains operator-facing framing and a scoring rubric — straight into `/faff-jot` or `/faff-plot`. That is teaching-to-the-test: the observer changes the observed, and a clean pass proves nothing. The fix makes operator framing *structurally unable* to reach the loop, while preserving the one load-bearing non-meta datum a `BRIEF.md` carries — its `## Stack preference` section, which the architecture proposer reads.

**Problem statement.** Four scaffolders (P1–P4) tell the operator to paste `BRIEF.md` into the loop; that BRIEF pre-warns the loop of the exact scope-creep / setpoint-editing / self-certification failures the suite grades against. This spec removes operator framing and scoring rubrics from everything the loop is fed, keeping only the stack preference in the loop's diet.

**Design principles:**

- **Only the stack preference is load-bearing to the loop.** Everything else in a `BRIEF.md` (intent paragraphs, `## N. DONE` rubric, `[SUBJECTIVE — must punt]` tags) is meta and must not reach the loop. Any fix that drops the stack preference from the loop's input is wrong — the architecture proposer reads the brief/spec alone on a fresh SUT (`faff profile show` exit 3).
- **The measurement must stay real, not disappear.** The subjective/scope-ceiling requirements themselves must still reach the loop so it can independently decide to punt or stay in scope — we strip the *tags that pre-announce the answer*, not the requirements. Removing the subjective scenarios entirely would delete the thing P3 tests.
- **Setpoint integrity is sacred for PRD-backed SUTs.** P2 scores "PRD byte-identical after the run." Any change to a PRD file is a one-time authoring edit by the scaffolder, never something the loop does; it must not muddy the run-relative byte-identity check or the machine-checkability of stop conditions. The relocated stack line must additionally not widen the PRD's *creative-licence* — see the architectural-coherence note in §6.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `docs/external-verification/scaffold-p{1..4}-*.sh` | Bash (heredocs) | The four leaking scaffolders this spec edits |
| `docs/external-verification/scaffold-p5-brownfield.sh` | Bash | Already immune — pastes a literal vague ask, never `BRIEF.md`; untouched |
| `test/scaffolder-lights-out-dials.test.mjs` | Node test | Static heredoc lint; the new paste-hygiene guard extends it |
| `docs/external-verification/README.md` | Markdown | Documents the per-SUT file layout + paste flow (L34–48); needs updating |
| `plugin/skills/faffter-noon-architecture/SKILL.md` | Skill prose | The stack-preference consumer — proposes against the brief/spec when no infra profile is mined |

**Scope statement.** This is a test-validity fix confined to the external-verification scaffolders and their doc + lint; it changes no faff CLI behaviour.

## 2. OUT OF SCOPE

- **P5 (brownfield).** Excluded — it already pastes a literal `"make it faster and add multi-tenancy"` and never pastes `BRIEF.md`; it is immune by construction. Touching it would be churn.
- **FAFF-549 (bare `/faff-plot` discovers a committed `docs/prd/*.md`).** Excluded — a separately-tracked mitigation that, if shipped, would let the operator paste *nothing* for PRD-backed SUTs and remove the leak at source. Reference it; do not depend on it. Extension point: the P2/P4 RUNBOOK loop-entry line becomes a no-arg `/faff-plot` once FAFF-549 lands — which also retires the stack-in-PRD relocation this spec adds (see §6).
- **Redesigning the scoring rubrics or the behaviours.** Excluded — the rubrics are correct; the bug is only that they leak into the loop's input. The RUNBOOK scoring sections stay as-is (relocated, not rewritten).
- **A shared scaffolder helper / `common.sh`.** Excluded — the scripts are self-contained by design (README L25) and there is no sourced library.

## 3. WHAT — Vocabulary and artifact shapes

**Vocabulary:**

| Term | Definition |
|---|---|
| Loop-facing artifact | The file(s) the RUNBOOK's loop-entry line tells the operator to paste into `/faff-jot` or `/faff-plot`. Must be leak-free. |
| Operator-only artifact | A file/section the operator reads but never pastes (the RUNBOOK, and for PRD-backed SUTs the recast `BRIEF.md`). May contain framing and rubrics freely. |
| Loop-entry paste line | The RUNBOOK line invoking `/faff-jot` / `/faff-plot` with a `"<paste …>"` argument. |
| Intent-framing content | The teaching-to-the-test prose: the "the interesting behaviour is…" / "the whole point…" / "zero needs-human punts" paragraphs, the `## N. DONE` scoring rubric, and the `[verifiable]` / `[SUBJECTIVE — must punt]` scenario tags. Must not appear in a loop-facing artifact; may live freely in an operator-only one. |
| Neutral-section allowlist | The only `##` section headings permitted in a P1/P3 loop-facing `BRIEF.md`: `Stack preference`, `What to build`, `Scenarios`, `Out of scope`. Any other heading (notably `N. DONE`) in a loop-facing artifact is a leak. |
| PRD-backed SUT | A SUT whose build spec is a committed PRD file (P2 → `docs/prd/task-api.md`; P4 → root `PRD.md`). |
| PRD-less SUT | A SUT whose only spec document is `BRIEF.md` (P1, P3). |

**Post-fix artifact roles per SUT:**

```
P1, P3 (PRD-less):
  BRIEF.md    → LOOP-FACING, neutral: Stack preference + What-to-build + Scenarios (giveaway tags stripped)
  RUNBOOK.md  → OPERATOR-ONLY: pre-existing run/observe/score + relocated intent framing + relocated completion/DONE rubric
  loop-entry  → /faff-jot "<paste BRIEF.md>"    (paste LINE unchanged; BRIEF content neutralised)

P2, P4 (PRD-backed):
  <PRD file>  → LOOP-FACING: existing PRD + a new "## Stack preference" section relocated from BRIEF (stack line only)
  BRIEF.md    → OPERATOR-ONLY orientation, carrying a "do NOT paste — the loop is fed the PRD" banner
  RUNBOOK.md  → OPERATOR-ONLY (unchanged role)
  loop-entry  → /faff-plot "<paste <PRD file>>"    (stops pasting BRIEF)
    P2 PRD file = docs/prd/task-api.md
    P4 PRD file = PRD.md
```

**Design decisions** (each concluded with a marker; full rationale in §6):

- Fix locus is **per-SUT script edits, no shared helper.** **Chosen:** per-SUT edits to P1–P4.
- Fix strategy is **a hybrid keyed on PRD-backing**, not one uniform transform. **Chosen:** split-BRIEF for PRD-less (P1/P3); paste-the-PRD for PRD-backed (P2/P4).
- P1/P3 keep the filename `BRIEF.md` for the neutral loop-facing file rather than introducing a new neutral filename. **Chosen:** keep `BRIEF.md`.
- The stack preference for P2/P4 is **relocated into the PRD**, which the loop is fed, and kept to a stack line only. **Chosen:** relocate a stack-only `## Stack preference` into the PRD.
- The relocated operator framing for P1/P3 lands **in `RUNBOOK.md`** (already never pasted), not a new companion file. **Chosen:** fold into `RUNBOOK.md`.
- The new paste-hygiene lint is a **structural allowlist + relocation-verified check** extending `test/scaffolder-lights-out-dials.test.mjs`, not a fixed phrase-denylist. **Chosen:** structural guard, extend the existing test.

## 4. HOW — Behaviour

**Architecture and approach.** Four independent edits, one per scaffolder, each a heredoc-content change plus (for P1–P3) a RUNBOOK relocation; all edits keep the existing `cat > <file> <<'EOF' … EOF` heredoc form so the static lint keeps parsing them. Then one README update and one hardened test extension. No CLI code changes.

**P1 / P3 — split the BRIEF (PRD-less).**

```
PROCEDURE neutralise_prd_less_brief(script):        # P1 and P3
  1. In the BRIEF.md heredoc, REMOVE:
     a. the intent-framing paragraph(s)  (P1: "code-blind evaluator should produce clean verdicts with
        zero needs-human punts"; P3: "The whole point: … green-washing prose DoD as done is the single
        most dangerous failure")
     b. the "## N. DONE" block (the scoring-rubric restatement)
     c. from the "## Scenarios" section, strip the bracket tags [verifiable] / [SUBJECTIVE — must punt]
        — KEEP the scenario text itself (the loop must still meet, and independently judge, these)
  2. In the BRIEF.md heredoc, KEEP verbatim (and confine to the neutral-section allowlist):
     - "## Stack preference"  (load-bearing — architecture proposer reads it)
     - "## What to build"     (P1)  /  the neutral structural scenarios
     - "## Out of scope"      (a legitimate build constraint, not a scoring tell)
  3. In the RUNBOOK.md heredoc, ADD an operator-only section carrying the removed intent framing
     and the completion/scoring rubric  (RUNBOOK is never pasted, so this is a safe home).
     — the guard checks the removed prose LANDS here, so "relocated" is verified, not "deleted".
  4. Leave the loop-entry line unchanged:  /faff-jot "<paste BRIEF.md>"
  5. Leave the FAFF_INTEGRITY_BOUNDARY reminder, .faffrc dials, adversarial block, gitignore intact.
```

**P2 / P4 — feed the PRD, stop pasting the BRIEF.**

```
PROCEDURE prd_only_loop_entry(script):              # P2 and P4
  1. Move a STACK-ONLY "## Stack preference" section OUT of the BRIEF.md heredoc and INTO the PRD heredoc
     (P2: docs/prd/task-api.md; P4: PRD.md). It states language / runtime / framework-family preference
     ONLY — no broader HOW/architecture prescription (see §6 creative-licence note).
  2. Recast the BRIEF.md heredoc as operator-only orientation:
     - prepend a banner: "Operator orientation — do NOT paste this into the loop; the loop is fed the PRD."
     - it may retain intent framing (operator reads it); it is never pasted, so its content is unconstrained
       by the leak-marker guard.
  3. Change the loop-entry line to paste the PRD ALONE:
     P2:  /faff-plot "<paste docs/prd/task-api.md>"
     P4:  /faff-plot "<paste PRD.md>"
  4. Keep P2's BRIEF.md and RUNBOOK.md heredocs free of any bare "PRD.md" outside docs/prd/
     (the existing lint; P2's PRD is docs/prd/task-api.md).
  5. Leave dials / adversarial block / integrity reminder (P2) intact.
```

**The hardened paste-hygiene guard (per P1–P4).** The guard is a *structural + relocation* check, not a fixed phrase list — a fixed denylist verifies only that N listed strings are absent, which silently passes a leak phrased differently (e.g. P1's "zero needs-human punts"). It runs, for each of P1–P4:

```
PROCEDURE assert_paste_hygiene(script):
  1. Parse the RUNBOOK.md heredoc's loop-entry line → the set of file(s) named in "<paste …>".
     (P1/P3 → BRIEF.md; P2 → docs/prd/task-api.md; P4 → PRD.md.)
  2. For each loop-facing file, assert STRUCTURALLY:
     a. it contains NO "## N. DONE" heading and no scoring-rubric heading;
     b. for P1/P3 BRIEF.md: every "## " heading is drawn from the neutral-section allowlist
        {Stack preference, What to build, Scenarios, Out of scope} — an out-of-allowlist heading fails;
     c. it contains a "## Stack preference" section (positive — the stack still reaches the loop).
  3. RELOCATION assertion: a per-SUT set of intent-framing sentences captured verbatim from today's briefs
     (seeded, and maintained as the briefs evolve) is ABSENT from every loop-facing file AND PRESENT in the
     SUT's operator-only home (RUNBOOK.md for P1/P3; BRIEF.md for P2/P4). This proves relocation, and it
     catches leaks the allowlist can't (a stray sentence under an allowlisted heading).
  4. Keep the phrase set as a maintained denylist seeded from the ACTUAL current framing — the six known
     markers plus P1's "zero needs-human"/"clean verdicts" and P3's giveaway prose — but it is a backstop
     to the structural + relocation checks in (2)/(3), not the primary signal.
```

**Edge cases and precedence:**

- **Stack preference must survive relocation.** For every SUT, exactly one loop-facing artifact must still contain a `## Stack preference`. If a relocation drops it, the architecture proposer regresses to an unguided stack pick. The guard asserts its presence positively (step 2c).
- **P2 PRD title/metadata unchanged.** The relocated stack section is appended; the `# PRD — …` title and `Container: task-api` line the existing lint matches must remain.
- **P4 PRD stays at root** by design — the bare-`PRD.md` lint is scoped to P2 only, so P4's `<paste PRD.md>` is allowed.

**Failure modes:**

- **The failure:** neutralising the BRIEF removes framing the loop actually needed, so the loop under-builds and the SUT fails for the wrong reason. **How you'd know:** a P1/P3 run that previously converged now stalls or under-scopes with no other change. **What it means:** narrow — move that specific line back into the neutral BRIEF (it was not, in fact, a scoring tell). `## Out of scope` and stack sections are retained precisely to avoid this.
- **The failure:** operator framing leaks by a path the guard doesn't check (a future SUT introduces a third pasted file). **How you'd know:** the paste-hygiene guard passes but a run's intake shows the loop echoing rubric language. **What it means:** proceed, but the guard's step-1 paste-line parse already generalises to *whatever* files a loop-entry names — extend the per-SUT intent-sentence set for the new SUT.
- **The failure:** relocating stack preference into P2's PRD is read as mutating the setpoint or as widening its creative-licence. **How you'd know:** a reviewer flags the PRD byte-identity criterion or the `prd-readiness` licence-width judgement. **What it means:** proceed — the edit is authoring-time (inert to the run-relative byte-identity check) and is kept to a stack-only line (no HOW prescription), so licence width is unchanged; document this in the commit.

**Anti-pattern:** deleting the subjective P3 scenarios along with their `[SUBJECTIVE — must punt]` tags — the subjective requirements are exactly what tests the loop's honesty; only the *answer-announcing tag* leaks.

**Anti-pattern:** a fixed phrase denylist as the *primary* leak check — it passes green on any re-worded leak. The primary signal is the structural allowlist + relocation assertion; the phrase list is only a backstop.

**Anti-pattern:** adding a shared `common.sh` to centralise the neutralisation — the scripts are self-contained by design; a helper is scope-creep for a 4-file fix.

## 5. Scenarios — born-verifiable objectives

```
Given any of the P1–P4 scaffolder RUNBOOK heredocs
When the loop-entry paste line is parsed to the file(s) it names
Then each named loop-facing file contains no "## N. DONE"/rubric heading,
     and (for P1/P3 BRIEF.md) only headings from the neutral-section allowlist
     {Stack preference, What to build, Scenarios, Out of scope}
```

```
Given each SUT's captured intent-framing sentences
When the loop-facing file(s) and the operator-only home are scanned
Then the intent sentences are ABSENT from every loop-facing file
     and PRESENT in the operator-only home (relocated, not deleted)
```

```
Given the loop-facing artifact for each of P1–P4
When it is scanned
Then it contains a "## Stack preference" section (the stack still reaches whatever the loop is fed)
```

```
Given the P3 neutral BRIEF.md
When the "## Scenarios" section is read
Then it still contains the subjective copy/brand requirements, with the [verifiable]/[SUBJECTIVE — must punt] tags removed
```

```
Given the P2/P4 loop-entry line
When read
Then it references the PRD (docs/prd/task-api.md for P2, PRD.md for P4) and does NOT reference BRIEF.md
```

- The existing `test/scaffolder-lights-out-dials.test.mjs` assertions (P1/P3 `cat > BRIEF.md` heredoc present; P2 no bare `PRD.md` outside `docs/prd/`; P1/P2/P3 `FAFF_INTEGRITY_BOUNDARY` reminder; dials/adversarial/gitignore) all remain green with no modification — the fix is designed to preserve the asserted shape.

## 6. Design decision rationale

**Where does the fix live — per-SUT edits or a shared helper?** `docs/external-verification/` has only the five self-contained scripts + README + authoring doc + `faff-lab/`; README L25 states "Each script is self-contained," and no lib is sourced. A helper would be new infrastructure for a four-file change. **Chosen:** per-SUT edits to P1–P4.

**One uniform transform, or a hybrid keyed on PRD-backing?** PRD-less SUTs (P1, P3) have nothing but `BRIEF.md`; "feed the PRD instead" has no PRD to feed, so the BRIEF must be split. PRD-backed SUTs (P2, P4) have a PRD that already carries outcome/scope/stop-conditions, making the BRIEF's non-stack content fully redundant. **Chosen:** hybrid — split-BRIEF for P1/P3, paste-the-PRD for P2/P4.

**P1/P3 neutral file: keep `BRIEF.md`, or a new neutral filename?** The lint asserts a `cat > BRIEF.md` heredoc for P1/P3; keeping `BRIEF.md` satisfies it with the least churn and keeps the loop-entry paste line byte-identical. **Chosen:** keep `BRIEF.md` as the P1/P3 loop-facing neutral file.

**Guard design — fixed phrase-denylist vs structural allowlist + relocation check?** A fixed phrase list only proves N strings are absent; a re-worded leak (P1's "zero needs-human punts" matches none of the six obvious markers) ships green. A structural allowlist (loop-facing headings ⊆ neutral set, no `## N. DONE`) plus a relocation assertion (captured intent sentences absent from loop-facing, present in the operator-only home) catches both the heading-level and the stray-sentence leak, and verifies relocation rather than deletion. **Chosen:** structural allowlist + relocation check as primary; the phrase list is a maintained backstop.

**P2/P4 stack preference: relocate into the PRD, or keep a stripped-but-still-pasted brief?** Relocating yields a single loop-facing artifact and honours "stop pasting BRIEF"; the only cost is an authoring-time PRD edit, inert to the run-relative byte-identity check. **Chosen:** relocate a stack-only `## Stack preference` into the PRD and paste the PRD alone.

**Architectural coherence — two accepted warts (architectural-minor, spec-review).**
1. **`BRIEF.md` is overloaded** — a loop-facing paste target for P1/P3, a "do NOT paste" operator-only doc for P2/P4. This is forced by the P1/P3 lint (`cat > BRIEF.md`); the mitigation is the README naming note (a DoD item) so the mental model is explicit. Accepted as the lower-churn option vs a fifth filename.
2. **Injecting `## Stack preference` into the P2/P4 setpoint PRD narrows its creative-licence** — the very width `prd-readiness` and the P2 scope-creep rubric measure. Mitigation: the relocated section is constrained to a **stack-only** line (language / runtime / framework-family), never a broader HOW/architecture prescription, so licence width is materially unchanged. Longer-term, FAFF-549 (bare `/faff-plot` discovers the committed PRD) removes the relocation entirely — at which point the stack line can return to an operator-only brief and the PRD stays pristine. Tracked, not blocking.

**P1/P3 operator content: fold into the RUNBOOK, or a new companion file?** The RUNBOOK is by definition operator-only and already holds the per-SUT scoring rubric. **Chosen:** fold the relocated operator framing into `RUNBOOK.md`.

## 7. Open questions and assumptions

**Open Questions:** none — every decision is closed against the codebase and the authoritative explore findings.

**Assumptions:** none requiring external validation. (The stack-preference consumer, the lint assertions, the per-SUT heredoc structure, and P5's immunity were all verified directly against the repo.)

## 8. DONE — Definition of Done

**From WHY**
- [ ] No loop-facing file named by any P1–P4 loop-entry paste line contains intent-framing content (a `## N. DONE`/rubric heading, an out-of-allowlist heading, or a captured intent sentence).
- [ ] Each SUT's loop-facing artifact still contains a `## Stack preference` section.

**From WHAT (artifact roles)**
- [ ] P1 and P3 `BRIEF.md` heredocs are neutral: only neutral-allowlist headings (Stack preference / What to build / Scenarios / Out of scope), scenarios' tags stripped, no intent framing, no `## N. DONE`.
- [ ] P2 loop-entry pastes `docs/prd/task-api.md` alone; P4 loop-entry pastes `PRD.md` alone; neither pastes `BRIEF.md`.
- [ ] P2 `docs/prd/task-api.md` and P4 `PRD.md` each gain a stack-only `## Stack preference` section; P2's `# PRD — …` title and `Container: task-api` line are unchanged; the section adds no HOW/architecture prescription beyond stack choice.
- [ ] P2/P4 `BRIEF.md` carry a "do NOT paste — the loop is fed the PRD" operator banner.

**From HOW (behaviour)**
- [ ] P3 `BRIEF.md` retains the subjective copy/brand scenarios with `[verifiable]`/`[SUBJECTIVE — must punt]` tags removed.
- [ ] Relocated intent framing + completion/scoring rubric for P1/P3 live in `RUNBOOK.md` (present there, absent from BRIEF.md — relocation verified, not deletion).
- [ ] All edited files use the `cat > <file> <<'EOF' … EOF` heredoc form (stay lint-parseable).

**From HOW (the hardened guard + lint compatibility)**
- [ ] `test/scaffolder-lights-out-dials.test.mjs` gains a paste-hygiene block that, per P1–P4: parses the loop-entry paste line to its named file(s); asserts each loop-facing file has no `## N. DONE`/rubric heading and (P1/P3) only neutral-allowlist headings; asserts each captured intent sentence is absent from loop-facing files and present in the operator-only home; and asserts `## Stack preference` is present. It passes.
- [ ] The existing assertions stay green: P1/P3 `cat > BRIEF.md` heredoc present; P2 no bare `PRD.md` outside `docs/prd/`; P1/P2/P3 `FAFF_INTEGRITY_BOUNDARY` reminder present; dials/adversarial/gitignore.
- [ ] P5 (`scaffold-p5-brownfield.sh`) is unmodified.

**From docs**
- [ ] `docs/external-verification/README.md` (L34–48) is updated to describe the new paste flow and the `BRIEF.md`-role overload: PRD-less SUTs paste the neutral `BRIEF.md`; PRD-backed SUTs paste the PRD and treat `BRIEF.md` as operator-only; operator framing lives in the RUNBOOK.

**Integration smoke test:**
```
1. Run each of scaffold-p1..p4 into a scratch SUT_ROOT (FORCE=1).
2. For each, parse the RUNBOOK loop-entry line → resolve the pasted file(s).
3. Assert each pasted file has only neutral-allowlist headings + a "## Stack preference", no captured intent sentence.
4. Run `node --test test/scaffolder-lights-out-dials.test.mjs` → all green (existing + new block).
```

confidence: high
