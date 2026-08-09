# Wire the holdout builder/evaluator views into faff-graft + beep-boop

> Spec: faffter-dark-nlspec · 2026-07-13 · autonomous · confidence: medium. Full spec on Linear FAFF-473.

This spec addresses **FAFF-473**. Audience: the build agent that will wire the two visibility views into the pipeline prose, and the human reviewer weighing the one open architectural decision. It is a **core-pipeline wiring** change to the L4 holdout enforcement path — no new engine, one already-shipped CLI (`faff dod split --view builder|full`, FAFF-275 / PR #336) wired into two consumers.

## 1. WHY — Problem and Principles

**Load-bearing model.** FAFF-275 shipped the split *substrate* but left it **ship-not-wire**: `faff dod split --view builder|full` can render either visibility view of a spec's `## Scenarios` section, but nothing in the pipeline calls it, so the `holdout:` marker is *descriptive-only*. The whole point of a holdout — a scenario the code-blind evaluator judges but the builder never sees, so the builder cannot teach-to-the-test — only becomes real when **the builder is handed the builder view and the evaluator is handed the full view**. This ticket is that consumption pass. The mechanism it turns on: *which spec text each lane sees is a function of where that lane reads the spec from*, and today both lanes read the same text.

**Problem statement.** The builder reads the spec that faff-graft commits into the worktree (Step 6 presents it, Step 7 builds from it); today that is the full spec, so a builder can read every holdout scenario. The evaluator (Step 10 holdout gate / beep-boop §10b) is handed "the spec" with no view discipline. Until the split is wired, the holdout guarantee is unenforced.

**Design principles.**

- **The builder must never receive holdout scenario text.** The builder works *inside the worktree* and can open any committed file, so hiding holdouts from the builder means the **committed** spec must be the builder view — a stripped copy is not enough if the full copy is also committed. This is the constraint that forces the Step-4 design below.
- **The evaluator must judge against the full spec, code-blind.** The evaluator's `--view full` source must be a spec store the builder-view commit did **not** overwrite — i.e. the tracker spec (or `.faff/specs/` in git-only mode), never the committed builder-view doc.
- **`--view full` is the identity; the change is inert for marker-free specs.** A spec with no `holdout:` marker produces a byte-identical builder view (guaranteed by the CLI), so this wiring is a no-op for every spec that withholds nothing — the risk is concentrated entirely on holdout-bearing specs.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` (`cmdDodSplit`, `dodSplit`) | JS | The shipped split engine this wires; pure beyond the file/stdin read |
| `faff-graft/SKILL.md` Step 4 | prompt | Commits the spec into the worktree — the builder-view injection point |
| `faff-graft/SKILL.md` Step 10 *Holdout gate* | prompt | Per-issue code-blind evaluator call-site — the full-view consumer |
| `faff-beep-boop/SKILL.md` §10b `holdout_step` | prompt | Per-run code-blind evaluator call-site — the same `holdout_step`, reused |

**Scope statement.** This slots between FAFF-275 (produced the interface) and the L4 merge-floor / per-run holdout guardrail (consumes the verdict) — it is the produce-then-wire second half, mirroring how FAFF-34's evaluator lane was consumed by FAFF-277/309/311.

## Already shipped against this surface

- **FAFF-275** (Done, PR #336) — produced the interface this ticket consumes: the `holdout:` marker + `faff dod split --view builder|full`. It was explicitly **ship-not-wire**, so its premise (a wired split) is exactly what remains — this ticket's motivation is **not** superseded, it is FAFF-275's named follow-up.
- **FAFF-309 / FAFF-311** (holdout *verdict* wiring precedent) — wired the evaluator verdict into the L4 delivery path; this ticket is the orthogonal *spec-view* wiring on the same holdout surface, not a re-do of the verdict path.

Premise verdict: **holds** — the surface is real and unconsumed; proceed.

## 2. OUT OF SCOPE

- **Any change to `faff dod split` itself** — the CLI shipped complete in FAFF-275. Why excluded: this is a consumption pass. Extension point: `plugin/skills/faff/bin/lib/admissibility.js` if the split behaviour ever needs to change.
- **The holdout *verdict* wiring** (env → evaluator → `faff contract holdout-verdict` → coverage roll-up). Why excluded: shipped by FAFF-309/311; this ticket only changes *which spec text* the evaluator receives, not how its verdict is consumed. Extension point: the existing `holdout_step`.
- **Restoring the committed spec to the full view after merge.** Why excluded: it is a genuine open decision requiring a *new* post-merge write-to-`main` mechanism (see §7 Open Questions). Extension point: a new faff-graft post-ship step or a `faff` subcommand — deliberately not designed here.
- **Marker authoring / holdout selection.** Why excluded: that is the nlspec producer's job (already shipped). Extension point: `faffter-dark-nlspec/SKILL.md` §5.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Builder view | `faff dod split --view builder` output — the spec with every holdout-marked scenario unit removed and a withheld-count note inserted under `## Scenarios`. What the builder is allowed to see. |
| Full view | `faff dod split --view full` output — byte-for-byte identity of the source spec, including holdout scenarios. What the code-blind evaluator judges against. |
| Tracker spec | The full spec faff-prep attached to the issue as a comment (git-only: `.faff/specs/<issue>.md`). The authoritative **full** source that survives the builder-view commit. |

**The shipped interface (unchanged, consumed here).**

```
faff dod split --spec <path|-> --view builder|full
  # --view full   : identity (byte-for-byte)
  # --view builder: removes holdout-marked scenario units, inserts withheld-count note; marker-free spec -> byte-identical no-op
  # PURE beyond file/stdin read. exit 0 ok / 2 on missing|unknown --view or unreadable spec.
```

**Design decision — where the builder view is committed.** Options: (a) commit the builder view at Step 4; (b) commit the full view and hand the builder a stripped copy out-of-band. Option (b) fails: the builder runs inside the worktree and can read any committed file, so a committed full spec is visible regardless of what is "handed" to it. **Chosen:** (a) — Step 4 commits the builder view; the full spec remains only on the tracker (git-only: `.faff/specs/`). Rationale: it is the only option that actually hides holdouts from a worktree-resident builder.

**Design decision — the evaluator's full-view source.** After Step 4 commits the builder view, the committed doc is no longer the full spec, so the evaluator must not read it. **Chosen:** the holdout gate reads the **tracker** spec (git-only: `.faff/specs/<issue>.md`) and runs it through `faff dod split --view full` before handing it to the evaluator. Rationale: the tracker spec is the full source the builder-view commit did not touch; `--view full` makes the "full" intent explicit and self-documenting even though it is the identity.

## 4. HOW — Behavior

**Architecture and approach.** Three prose wiring edits across two SKILLs, each a call to the already-shipped `faff dod split`. No CLI change.

**Behaviour summary.** The builder-facing commit is stripped to the builder view; the evaluator-facing spec (and the classify short-circuit that guards it) are pinned to the full view read from the tracker.

**Edit 1 — faff-graft Step 4 (commit the builder view).** Where Step 4 commits the captured spec content to `<spec-docs-path>/YYYY-MM-DD-<issue>-<slug>-design.md`, first pass the captured full spec through the split:

```
PROCEDURE commit_spec_step4(captured_full_spec):
  1. builder_view := `faff dod split --spec - --view builder` <<< captured_full_spec   # exit 2 -> fail loud, do not commit a wrong view
  2. Write builder_view to $dir/YYYY-MM-DD-<issue>-<slug>-design.md
  3. Commit "docs(<issue-id>): add spec for <issue title>"
```

- The over-withholding advisory the CLI emits on stderr is logged, never gating (the CLI already keeps exit 0).
- A `--view builder` **exit 2** (unreadable/garbled captured spec) is a fail-loud refuse to commit — never fall back to committing the full spec, which would silently leak holdouts to the builder.

**Edit 2 — faff-graft Step 10 *Holdout gate* (full view to the evaluator + to the classify short-circuit).** The gate today (a) runs `faff dod classify --spec <spec>` as the zero-born-verifiable short-circuit, then (b) hands the evaluator `{spec, env-handle}` code-blind. Both `<spec>` references must be the **full** view read from the tracker, not the committed builder-view doc:

```
PROCEDURE holdout_gate_spec_source(issue):
  1. full_spec := `faff dod split --spec <tracker-spec-path> --view full`   # tracker comment (git-only: .faff/specs/<issue>.md)
  2. classify full_spec  -> if zero born-verifiable, short-circuit as today (holdout-block, reason "no born-verifiable criteria")
  3. hand the evaluator full_spec (never the committed builder-view doc)
```

- **Anti-pattern:** classifying the *builder* view in the short-circuit. Why: the builder view has the holdout criteria stripped, so it could report zero born-verifiable criteria and wrongly skip provisioning — silently voiding the holdout gate.

**Edit 3 — beep-boop §10b `holdout_step(spec, …)` (full view at the call boundary).** `holdout_step` is call-site-agnostic; the fix is at its **callers**, so both the per-run caller (§10b) and the per-issue graft caller (Edit 2) pass the full view. Document on `holdout_step` that its `spec` argument is contractually the **full** view (`faff dod split --view full` of the tracker spec), so the invariant is stated once at the shared step and honoured by both callers.

**git-only mode.** No tracker comment exists; the full spec is `.faff/specs/<issue>.md` (faff-prep's git-only store, which lives in the main checkout). Edit 2/3 read the full view from there; Edit 1 still commits the builder view into the worktree. The "builder never sees holdouts" property holds because `.faff/specs/` is gitignored and never enters the worktree.

**Failure modes.**

- **The failure:** tracker/committed spec drift — a mid-build reprep updates the tracker full spec while the builder built from the older committed builder view, so the evaluator judges against scenarios the builder's spec never implied. **How you'd know:** a holdout-block whose violations cite scenarios absent from the committed builder-view doc. **What it means:** narrow — the evaluator judging the live full spec is *by design* (that is the holdout intent), but a reprep-during-build should re-derive both views from the same refreshed source; flag for the human decision in §7 rather than silently reconciling.
- **The failure:** Edit 2/3 accidentally source the evaluator spec from the committed builder-view doc. **How you'd know:** the evaluator can never see any holdout criterion, so every holdout aggregate collapses toward `meets-spec` (nothing to fail) even on a spec-violating feature. **What it means:** abandon that source — the evaluator's spec source must be the tracker/`.faff/specs/` full view, asserted in the wiring.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a spec with one holdout-marked scenario and one visible scenario
When faff-graft Step 4 commits the spec into the worktree
Then the committed records/specs/*-design.md contains the visible scenario and the withheld-count note, and does NOT contain the holdout scenario text
```

```
Given a marker-free spec (no holdout: markers)
When faff-graft Step 4 commits it
Then the committed spec is byte-identical to the tracker spec (builder view == full view for a marker-free spec)
```

```holdout
Given a spec with a holdout scenario and a committed builder-view doc in the worktree
When the Step 10 holdout gate assembles the evaluator's spec
Then the evaluator receives the full view (including the holdout scenario) read from the tracker, not the builder-view doc committed in the worktree
```

- The Step 10 `dod classify` short-circuit MUST classify the full view: a spec whose only born-verifiable criteria are holdout-marked MUST provision an env (not short-circuit as zero-born-verifiable).

## 6. DESIGN DECISION RATIONALE

**Where is the builder view committed?**
- Options: commit builder view at Step 4 / commit full view + hand builder a stripped copy.
- The second cannot hide holdouts from a worktree-resident builder that can read any committed file.
- **Chosen:** commit the builder view at Step 4 — the only option that actually withholds.

**What is the evaluator's full-view source, once the committed doc is the builder view?**
- Options: the committed doc / the tracker spec (git-only `.faff/specs/`).
- The committed doc is now the builder view (holdouts stripped) — sourcing the evaluator from it silently voids the gate.
- **Chosen:** the tracker spec (git-only `.faff/specs/`) run through `--view full`.

**Fix the view at the caller or inside `holdout_step`?**
- **Chosen:** at the callers (both graft Step 10 and beep-boop §10b), with the `full`-view contract documented once on `holdout_step`'s `spec` parameter — keeps `holdout_step` call-site-agnostic (its existing property) while both call-sites honour the same invariant.

At the time of writing, `faff dod split` is the sole shipped view-rendering path (FAFF-275); revisit if a third view is ever introduced.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

**Punt:** Restore the committed spec to the full view post-merge, or leave the builder view as the living documentation? — needs human. (decides: architecture) Context: once Edit 1 commits the builder view, the merged `records/specs/*-design.md` on `main` is **lossy** — it lacks the holdout scenarios, which live only on the tracker. Restoring the full view requires a *new* post-merge write-to-`main` mechanism (a new faff-graft post-ship step or a `faff` subcommand) — there is no existing seam that edits `main` after `faff merge-gate` merges. Defensible answers: **(a) do not restore** — accept the builder view as the living doc and treat the tracker as the durable full-spec home (zero new mechanism, but the in-repo record is permanently partial); **(b) restore** — build the post-merge mechanism (complete in-repo record, but a new write path onto `main` outside the PR flow, with its own review/revert questions). This is the one decision that makes the change **medium**, not high: it is architectural, has multiple defensible answers, and the ticket itself filed it undecided.

**Punt:** Reprep-during-build drift — when a mid-build reprep refreshes the tracker full spec, should the committed builder view be re-derived from the refreshed source before the holdout gate runs? — needs human. Low-frequency but it decides whether the evaluator can judge against scenarios the builder's committed spec never reflected.

**Assumptions.**

**Assumes:** `faff dod split --spec <path|-> --view builder|full` exists and is pure (FAFF-275 / PR #336). Validate: `faff dod split --spec - --view full <<< "x"` exits 0; `--view bogus` exits 2. *(Validated during prep: exit 0 / exit 2 respectively.)*

**Assumes:** faff-prep attaches the **full** spec (holdout markers intact) to the tracker (git-only: `.faff/specs/<issue>.md`). Validate: confirm the nlspec producer never strips `holdout:` markers before attach (it does not — the split is a read-time view, not a stored mutation).

## 8. DONE — Definition of Done

### From WHY
- [ ] With the wiring in place, a builder dispatched by faff-graft on a holdout-bearing spec has no committed file containing holdout scenario text.

### From WHAT / HOW (Edit 1 — Step 4)
- [ ] faff-graft Step 4 commits `faff dod split --view builder` output (not the raw full spec) to `<spec-docs-path>/…-design.md`.
- [ ] A `--view builder` exit 2 is a fail-loud refuse-to-commit; the full spec is never committed as a fallback.
- [ ] The over-withholding stderr advisory is logged, not gating.

### From WHAT / HOW (Edit 2 — graft Step 10)
- [ ] The Step 10 holdout gate reads the full view from the tracker (git-only: `.faff/specs/<issue>.md`) via `faff dod split --view full`, never the committed builder-view doc.
- [ ] The `dod classify` zero-born-verifiable short-circuit classifies the **full** view.

### From HOW (Edit 3 — beep-boop §10b)
- [ ] `holdout_step`'s `spec` argument is documented as the full view, and both callers (graft Step 10, beep-boop §10b) pass the full view.

### From HOW (git-only)
- [ ] In git-only mode, Edit 1 commits the builder view into the worktree and Edit 2/3 read the full view from `.faff/specs/<issue>.md`.

### From HOW (edge cases)
- [ ] A marker-free spec's committed doc is byte-identical to the tracker spec (no behavioural change for non-holdout specs).

**Integration smoke test:**
```
Given a spec with one holdout scenario attached to a Todo issue
When faff-graft runs Step 4 then (under L4) the Step 10 holdout gate
Then the committed docs spec omits the holdout scenario AND the evaluator's handed spec includes it
```

**Eval coverage:** no new LLM-judgement seam is introduced — the evaluator seam already exists (FAFF-309/311); this changes only which spec text feeds it, so no new grader `KIND`/eval case is registered.

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "punt" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

---

## Resolution (human decision, 2026-07-13) — both spec punts closed

- **Punt 1 (architecture — restore committed spec post-merge?): RESOLVED → do NOT restore.** The builder view (holdout scenarios stripped) stays as the committed, merged `records/specs/*-design.md` — the living in-repo doc. The **tracker comment is the durable home of the full spec** (holdouts intact). No post-merge write-to-main mechanism is built. Rationale: zero new mechanism, no write path outside the PR flow, ships now; the in-repo record being intentionally partial is acceptable because the full spec is always recoverable from the tracker.

- **Punt 2 (reprep-during-build drift — re-derive the builder view before the holdout gate?): RESOLVED → accept finish-forward.** The evaluator judges the live full-view spec (the holdout intent); a mid-build reprep is low-frequency and does not block this wiring. If it ever bites in practice, file a follow-up — it is not in scope here.

With both punts closed the spec is **build-ready at high confidence** (the two Punts were the only thing holding it at medium). Re-prep will re-rate to `high` → `fire-and-forget`; ready to graft.
