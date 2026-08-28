_Revised on 2026-08-28 — re-prepped interactively against the narrowed calibration scope. The one open Punt (whether the infosec lens may defer) is now **closed**: infosec defers symmetrically, `critical` is never deferred by any lens, and adjudication is handed to FAFF-922. The prior "a human reads the eval sweep" merge gate is replaced with a mechanical one (no human halt at L3/L4 except a PRD escape). Supersedes the 2026-08-27 spec._

# Spec — FAFF-907: Wire ratified-scope deferral into the spec-review design lenses

> Spec: faffter-dark-nlspec · 2026-08-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-907.

This is the buildable spec for FAFF-907, "Wire ratified-scope deferral into the spec-review design lenses (+ calibrate via eval sweep)". Audience: the build agent that will implement it, and the human reviewers who gate it. It makes the L4 adversarial spec-review lenses defer to an already-ratified scope exclusion, so a PRD-consistent spec that documents a settled non-goal stops being re-refuted every round. Its deterministic-CLI prerequisite (the `faff ratified-scope` command) shipped as FAFF-919 (PR #766); this ticket is the occupant-and-prose half that consumes that command's output.

## 1. WHY — problem and principles

**The load-bearing model.** A design lens in the L4 adversarial spec-review is an independent refuter told to break the spec. It has no memory of what the PRD already ruled out of scope, so when a spec faithfully documents a settled non-goal ("we deliberately do not do X"), the lens reads that as a hole and refutes it, round after round. FAFF-907 hands each lens a machine-assembled `## Ratified scope` block (the PRD's `## Non-goals` plus the `docs/decisions.md` settled precedents) and one rule: if your would-be objection is already settled by that block, do not raise it as an objection; record it as an observation with a citation instead. That is the whole change: a deterministic pre-filter that converts a settled-scope objection into a cited non-objection.

**Problem statement.** Today a spec that correctly documents a ratified non-goal is refuted by a design lens every review round, so it can never converge to `approve`. FAFF-907 gives the lenses the ratified-scope facts and a deferral rule, so a PRD-consistent non-goal stops being treated as a defect. Nothing else about the lens behaviour changes.

### Design principles

These are the constraints that would cause an otherwise-valid implementation to be rejected.

**Deferral has exactly two outcomes, and neither is a human halt.** For any objection a lens is weighing, FAFF-907 produces one of two results: *defer* (the ratified-scope block already settles it, so it becomes a recorded observation carrying a citation) or *pass-through* (the objection is not settled, so it flows through the normal objection path unchanged). This layer must never manufacture a third outcome that halts for a human. At L3 and L4 the production line halts for a human on exactly one condition: the build escaping the PRD's ratified bounds. A taste objection, a reviewer disagreement, and a calibration check are none of them a legitimate human halt. A miscalibrated deferral is caught later by the felt-pain feedback loop and corrected, not by a pre-merge human gate.

**A `critical` objection is never deferred by any lens, infosec included.** The deferral layer never self-suppresses a `critical`; a `critical` always passes through to the tally and onward. This is the guard that makes symmetric infosec deferral safe: the worst case, a real security hole rated `critical`, can never be silently dropped because the ratified-scope block happened to mention the area.

**Infosec defers on the same terms as architectural and QA.** There is no per-lens carve-out. All three design lenses (architectural, infosec, QA) receive the ratified-scope block and defer a would-be objection the block already settles. The methodology lens receives the block too (to keep the shared cache prefix byte-identical) but does not act on it. Symmetric deferral is safe only because the `critical`-never-deferred guard above holds for every lens.

### Reference context

| File | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown prompt | The L4 occupant. Its `## The lenses as independent refuters` section is the eval-visible prose; the deferral rule must live there. |
| `plugin/skills/faffter-dark-spec-review/refute-architectural.md` | Markdown prompt | The architectural refuter prompt; lines 9-10 make an ADR-log claim that needs correcting. |
| `plugin/skills/faffter-dark-spec-review/refute-infosec.md`, `refute-qa.md`, `refute-methodology.md` | Markdown prompts | The other per-lens refuter prompts; the design lenses gain a deferral clause. |
| `plugin/skills/faff/bin/lib/ratified-scope.js` | JavaScript | FAFF-919's `faff ratified-scope` CLI. Merged on origin/main (commit dd58893a); not in the local working tree yet. |
| `plugin/skills/faff-prep/SKILL.md` | Markdown prompt | The spec-review dispatch; gains the ratified-scope assembly step at loop entry. |
| `plugin/skills/faff/bin/lib/lights-out.js` | JavaScript | Writes `prd_root_container` into the L4 run ledger at line 1048; prep reads it. |
| `eval/cases/refutation-spec-003.json` | JSON fixture | Precedent: embeds a `## Methodology critique` block inside `fixture.spec`. The two new fixtures follow this pattern with a `## Ratified scope` block. |
| `eval/grader.mjs` | JavaScript | Grades `refutation-spec` cases against `closed_set` or `lens_bounds` oracles. |
| `eval/baselines/frontier.json` | JSON | Holds the recorded `refutation-spec` baseline the sweep compares against. |
| `eval/review-bench/` | Mixed | The review-bench; `build-requests.mjs` regenerates request payloads, `test/review-bench-lens-parity.test.mjs` asserts the lens copies are byte-identical. |

**Scope statement.** FAFF-907 sits at the spec→build-admission seam, inside the L4 adversarial spec-review occupant and the faff-prep dispatch that drives it. It is one deterministic pre-filter in front of the existing majority/severity aggregation; it adds no new review stage.

## 2. OUT OF SCOPE

- **Adjudication of standing or `critical` objections — belongs to FAFF-922.** FAFF-907 is a deterministic pre-filter. In FAFF-922's courtroom model, the ratified-scope block is binding precedent the jury may not reopen: FAFF-907 either defers an objection the precedent already settles, or passes it through untouched. Weighing, downgrading, or disproving a standing or `critical` objection by cross-lens argument is the FAFF-922 judge/arbiter's remit, one altitude above this ticket. FAFF-907 never argues with an objection; it only checks whether the ratified-scope block already settles it. FAFF-907 and FAFF-922 are already related in the tracker. Extension point: the FAFF-922 arbiter stage consumes the pass-through objection set this layer produces.

- **The deterministic `faff ratified-scope` CLI and the `## Ratified scope` block assembler — shipped as FAFF-919.** FAFF-907 consumes the block; it does not build or modify the assembler. Extension point: `plugin/skills/faff/bin/lib/ratified-scope.js` (already merged on origin/main).

- **Changing which lenses fire, or the majority/severity aggregation rule.** Lens selection and the roll-up in `aggregate.mjs` are unchanged. FAFF-907 only changes what a fired lens does with a settled-scope objection. Extension point: the lens-selection cost-gate in `faff-prep/SKILL.md`, and `plugin/skills/faffter-dark-spec-review/aggregate.mjs`.

- **The FAFF-878 refuter-prompt calibration.** FAFF-878 edits the same three refuter prompts; it is sequenced after FAFF-907 so its calibration is not applied to prose that then moves underneath it. Extension point: the same `refute-*.md` files.

## 3. WHAT — vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Ratified scope | The machine-assembled `## Ratified scope` markdown block: a PRD's `## Non-goals` body plus the `docs/decisions.md` settled precedents that carry a `Scope` field. Produced by `faff ratified-scope --assemble`. |
| Defer | A lens's decision to not raise a would-be objection because the ratified-scope block already settles it. The objection becomes a recorded observation with a citation to the settling ratified-scope line, not a gating objection. |
| Pass-through | The default: an objection the ratified-scope block does not settle flows through the normal objection path unchanged. |
| Per-lens transcript | A separate `$scratch/round-<n>-<lens>.md` file carrying each lens's raw stdout, written so a deferral (which `aggregate.mjs` drops) still leaves an audit trace. |

### The `## Ratified scope` block shape (verbatim, from `faff ratified-scope --assemble`)

```
## Ratified scope

Assembled by `faff ratified-scope` from files committed to this repository. The spec under
review is not a source and cannot write to any of these files.

### Non-goals: PRD `<container>` (<source_path>)

<the ## Non-goals section body, verbatim>

### Settled precedents (docs/decisions.md)

- **<topic>** (`<id>`)
  - Chosen: <chosen>
  - Scope: <scope>
```

The Non-goals sub-section appears only when the PRD's `## Non-goals` is non-empty and not the `_TODO._` placeholder. The precedents sub-section includes only `docs/decisions.md` entries whose `Scope` field is non-empty. When neither is present the CLI exits 3 (nothing ratified) and prints nothing.

### CLI contract consumed (`faff ratified-scope`)

```
faff ratified-scope --assemble [--container <c>] [--root <dir>]
```

| Exit | Meaning | FAFF-907 handling |
|---|---|---|
| 0 | Block printed on stdout | Write it to `$scratch/ratified-scope.md`; every lens receives it. |
| 3 | Nothing ratified (empty) | No file written; every lens behaves exactly as today (no deferral). |
| 2 | Source unreadable | No file written; the loop degrades to no-deferral (the CLI fails loud on its own channel; prep does not synthesise a block). |

### The per-lens transcript file

```
RECORD PerLensTranscript:            # one file per lens per round
  path: $scratch/round-<n>-<lens>.md # <lens> in {architectural, infosec, methodology, QA}
  body: string                       # the lens's raw review-call.mjs stdout, header line included
  # write-once per lens per round; never merged into round-<n>.json
```

**Design decision — where the deferral rule text lives.** The eval rubric loader `loadRefutationSpecProse` (`eval/cli-driver.mjs`, the `loadRefutationSpecProse` export) reads only the SKILL.md prose between `\n## The lenses as independent refuters\n` and `## Backend call`; the per-lens `refute-*.md` files never reach the eval. So the deferral rule that the sweep must measure has to be stated in that SKILL.md section. The per-lens `.md` clauses still get the rule too (they are what the live occupant delivers to each lens), but the SKILL.md section is the one the eval keys on. **Chosen:** state the deferral rule in the `## The lenses as independent refuters` section of `faffter-dark-spec-review/SKILL.md`, and mirror it into each design lens's `refute-*.md`.

### Fixture oracle shapes

The two new fixtures embed a `## Ratified scope` block inside `fixture.spec` (the case 003 precedent, which embeds a `## Methodology critique` block the same way). Each carries exactly one oracle field, `closed_set` or `lens_bounds`, per `eval/grader.mjs`.

| Fixture | What it proves | Oracle |
|---|---|---|
| `refutation-spec-011.json` | A design lens that would refute the documented non-goal now defers, so the spec grades clean. | `closed_set: []` (an empty set: no lens objects; `eval/grader.mjs` accepts an empty `closed_set` as the approve expectation). |
| `refutation-spec-012.json` | A `critical` is never deferred: a genuine security hole sits next to a ratified-scope block, and infosec must still raise it. | `lens_bounds: { must_object: ["infosec"], may_object: [...] }` (`must_object` must be non-empty per `eval/grader.mjs`; a failure to raise the critical fails the case). |

**Chosen:** use `closed_set: []` for the defer-and-approve fixture and `lens_bounds` with `must_object: ["infosec"]` for the critical-still-fires fixture, so both the deferral and its `critical` guard are born-verifiable by the grader.

## 4. HOW — behaviour

### Architecture and approach

The change threads one file through the existing dispatch and adds one rule to the lens prompts. No new dispatch parameter, no new review stage.

```
faff-prep spec-review loop entry:
  1. Read prd_root_container from the L4 run ledger (lights-out.js wrote it at line 1048).
  2. IF a container resolves:
       run `faff ratified-scope --assemble --container <c>` ONCE
       IF exit 0: write stdout to $scratch/ratified-scope.md
       IF exit 3 or 2, or no container: write nothing
  3. Dispatch the spec_review occupant each round with $scratch as the pin-dir (unchanged).

faffter-dark-spec-review occupant, per round:
  4. IF $scratch/ratified-scope.md exists:
       append it to the --context file list of ALL FOUR lenses
       (identical across lenses, to preserve the FAFF-903 shared-prefix cache).
  5. Each design lens applies the deferral rule (below).
  6. Write each lens's raw stdout to $scratch/round-<n>-<lens>.md.
  7. Aggregate as today (aggregate.mjs is unchanged).
```

The container is resolved from the ledger `prd_root_container` field; prep runs the CLI once at loop entry, not per round, because the ratified scope is stable across a spec's review rounds. The occupant looks for `$scratch/ratified-scope.md` in the pin-dir it already receives and appends it to the `--context` list. It goes to all four lenses, not only the three design lenses, to keep the FAFF-903 byte-identical shared-cache prefix; the methodology lens simply does not act on it.

### The deferral rule delivered to each design lens

```
PROCEDURE weigh_objection(objection, ratified_scope_block):
  1. IF objection.severity == critical:
       raise it (pass-through). A critical is never deferred. STOP.
  2. IF ratified_scope_block is present AND it already settles the point
        (the objection restates a listed non-goal or a settled precedent's scope):
       a. Do NOT raise it as a gating objection.
       b. Record it as an `observation` citing the ratified-scope line that settles it.
  3. ELSE:
       raise it normally (pass-through).
```

**Behaviour summary.** Before a design lens emits an objection, it checks the ratified-scope block; a non-`critical` objection the block already settles becomes a cited observation rather than a gating objection, and everything else, including every `critical`, passes through unchanged.

### The architectural-prompt correction

`refute-architectural.md` lines 9-10 currently tell the lens to check fit against "the ADR log in the context". But `--context` carries only the files the spec's own prose names, so an ADR reaches the lens only if the spec cites it by path; a standing ADR log is not injected. Rewrite that line to describe what actually arrives: the files the spec names, plus the `## Ratified scope` block when supplied. Do not claim standing ADR-log injection. **Chosen:** correct the architectural prompt to describe the real `--context` payload (spec-named files plus the ratified-scope block when present).

### The per-lens transcript write

`aggregate.mjs` drops observations before building the objections array (its `SEVERITY_MAP` maps `observation → null`), so a deferred objection recorded only as an observation leaves zero trace in `$scratch/round-<n>.json`. The occupant therefore writes each lens's raw stdout to a separate `$scratch/round-<n>-<lens>.md` file, header line included, so the deferral is auditable.

**Anti-pattern:** widening `$scratch/round-<n>.json` to carry the per-lens deferrals. Why: `faff spec-review-churn` and `faff spec-review-convergence` both read that file's existing `{verdict, objections}` shape; changing it breaks them. The transcript is a separate file.

### The sweep merge-gate (mechanical)

The prior spec/ticket said a human reads the eval sweep. That is replaced. Per the no-human-halt principle above, a human is never a gate at L3/L4. The gate is a counted, born-verifiable assertion: on the new fixtures, at least one previously-refuting design lens now defers. That green/red result gates the merge mechanically. A human may inspect the sweep in an interactive build, but nothing waits on a human.

The relative lens-flip signal is what the gate keys on, not the absolute accuracy number. The recorded `refutation-spec` baseline (`eval/baselines/frontier.json`, `per_kind.refutation-spec`: accuracy 0.806, stability 0.814, format_adherence 1, captured 2026-08-16 on `claude-opus-4-8`) is known-miscalibrated: FAFF-730 records that it over-objects on clean specs. So the absolute accuracy is unreliable, but the relative question "does a specific previously-refuting lens now defer on these fixtures" is robust to that miscalibration, because it compares the same lens's behaviour before and after the rule on the same fixtures.

### The de-risking spike

The one real unknown is whether a permission-granting clause actually moves a refuter that already had the single-container rationale and refuted anyway. Spike it first, on a throwaway branch, with only three things: the SKILL.md rule text, the two new fixtures, and a sweep. No CLI wiring, no prep wiring, no per-lens `.md` clauses, no review-bench refresh. Confirm a recorded `refutation-spec` baseline exists first. Build the rest only if the sweep moves a lens. This spike is dev-time discovery to decide whether to build; it is not a production halt and does not bother a human. Its result is the same mechanical signal the merge-gate keys on.

### Failure modes

- **The permission clause does not move the refuter.** *The failure:* a lens that had the single-container rationale and refuted anyway keeps refuting even with the ratified-scope block and the rule. *How you'd know:* the spike sweep shows zero previously-refuting lenses now deferring on the two fixtures. *What it means:* abandon or rethink the prose approach before building the wiring; the ticket does not ship. This is the whole point of running the spike first.

- **The baseline miscalibration masks the signal.** *The failure:* the baseline over-objects (FAFF-730), so a lens's refutation on a fixture might be noise rather than the settled-scope objection the fixture targets. *How you'd know:* the fixture's deferred objection is not the one the baseline recorded as refuting; the flip is on an unrelated axis. *What it means:* narrow the fixture so the only plausible objection is the settled-scope one, so the flip is unambiguously the deferral. The relative same-lens-same-fixture comparison is robust to the absolute miscalibration, but the fixture must isolate the settled-scope objection.

- **The `critical` guard silently regresses.** *The failure:* a future prompt edit lets the deferral rule swallow a `critical`. *How you'd know:* `refutation-spec-012.json` fails (infosec no longer in the objecting set). *What it means:* the guard is broken; the merge is blocked until infosec raises the critical again.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec that documents a settled non-goal, and a `## Ratified scope` block that lists that non-goal
When the enabled design lenses review the spec with the deferral rule in effect
Then at least one lens that refuted the non-goal without the block now defers, recording an observation
     that cites the settling ratified-scope line, and raises no gating objection on that point
```

```
Given a spec that documents a settled non-goal AND contains a genuine security hole rated critical
When the infosec lens reviews it with the `## Ratified scope` block present
Then infosec still raises the critical objection (it is never deferred), and the fixture's
     lens_bounds oracle (must_object: ["infosec"]) passes
```

```
Given an L4 run whose ledger carries no prd_root_container, or a `faff ratified-scope` exit 3 or 2
When faff-prep enters the spec-review loop
Then no $scratch/ratified-scope.md is written and every lens behaves exactly as today (no deferral)
```

```
Given a design lens that defers a would-be objection on a review round
When the occupant finishes that round
Then $scratch/round-<n>-<lens>.md exists carrying that lens's raw stdout including the deferral,
     while $scratch/round-<n>.json keeps its existing {verdict, objections} shape unchanged
```

- The sweep merge-gate asserts a counted threshold: at least one previously-refuting design lens now defers on the two new fixtures. The green/red result gates the merge mechanically; no step waits on a human.

## 6. Design decision rationale

**Should FAFF-907 add an arbiter stage, or just inform the refuters?** Options: a new cross-lens arbiter that weighs objections against ratified scope, versus a per-lens deterministic instruction. An arbiter is FAFF-922's remit and one altitude above this ticket. **Chosen:** inform the refuters with a per-lens deterministic deferral instruction; no in-ticket arbiter.

**May the infosec lens defer at all, or only architectural and QA?** This was the one open question that repeatedly parked the prior spec. Options: a per-lens carve-out keeping infosec always-refute, versus symmetric deferral across all three design lenses. A carve-out is safe but leaves infosec re-refuting settled non-goals forever; symmetric deferral is safe precisely because a `critical` is never deferred by any lens. **Chosen:** infosec defers on the same terms as architectural and QA; no per-lens carve-out.

**Can any lens ever defer a `critical`?** Options: allow a `critical` to defer when the ratified-scope block covers the area, versus never. Deferring a `critical` risks silently dropping a real security hole. **Chosen:** a `critical` is never deferred by any lens; it always passes through to the tally.

**May this layer create a human-park path?** Options: let a low-confidence deferral escalate to a human gate, versus never. A pre-merge human gate contradicts the L3/L4 halt rule (the line halts for a human only when the build escapes the PRD's ratified bounds). **Chosen:** FAFF-907 introduces no human-park path; its only two outcomes are defer and pass-through, and a miscalibrated deferral is corrected later by the felt-pain feedback loop.

**Is the sweep merge-gate a human read or a mechanical assertion?** Options: a human reads the eval sweep (the prior ticket's wording), versus a counted born-verifiable pass/fail. A human read contradicts the no-human-halt principle. **Chosen:** the sweep asserts a counted threshold (at least one previously-refuting design lens now defers on the fixtures) and that green/red result gates the merge mechanically; a human may inspect it but nothing waits on one.

**Where do the excluded-scope points come from?** Options: a hand-authored exclusion list, versus the machine-assembled block. **Chosen:** the excluded points come from the PRD `## Non-goals` plus `docs/decisions.md` entries carrying a `Scope` field, exactly what `faff ratified-scope --assemble` produces.

**How is the block delivered to the lenses?** Options: a new dispatch parameter per lens, versus one extra `--context` file identical across all four lenses. A per-lens variant would break the FAFF-903 shared-prefix cache. **Chosen:** deliver the block as one extra `--context` file identical across all four lenses (methodology receives it but does not act on it).

**Where does the deferral rule text live?** Options: only in the per-lens `refute-*.md` files, versus in the SKILL.md section the eval reads. The eval rubric loader reads only the SKILL.md `## The lenses as independent refuters` section, so a rule stated only in the `.md` files would be invisible to the sweep. **Chosen:** state the rule in that SKILL.md section and mirror it into each design lens's `refute-*.md`.

**How is the deferral recorded for audit, given `aggregate.mjs` drops observations?** Options: widen `$scratch/round-<n>.json`, versus a separate transcript file. Widening the JSON breaks `faff spec-review-churn` and `faff spec-review-convergence`, which read its existing shape. **Chosen:** write each lens's raw stdout to a separate `$scratch/round-<n>-<lens>.md` file.

**How are the eval fixtures shaped?** Options: reference an external ratified-scope file, versus embed the block inside `fixture.spec`. **Chosen:** embed the `## Ratified scope` block inside each new fixture's `spec` string (the case 003 precedent, which embeds a `## Methodology critique` block the same way).

**How is the architectural prompt's ADR claim handled?** Options: leave it (it names an ADR log that `--context` does not deliver), versus correct it. **Chosen:** rewrite the line to describe the real `--context` payload (spec-named files plus the ratified-scope block when present); do not claim standing ADR-log injection.

**Build order relative to FAFF-878.** Both FAFF-907 and FAFF-878 edit the same three refuter prompts. **Chosen:** FAFF-907 lands before FAFF-878, so FAFF-878's calibration is not applied to prose that then moves underneath it.

**Prove the prose bet before building the wiring?** Options: build everything, versus spike the prose bet first. **Chosen:** run the spike first on a throwaway branch (SKILL.md rule text, two fixtures, a sweep only); build the rest only if the sweep moves a lens. Its result is the mechanical merge-gate signal, not a human read.

## 7. Open questions and assumptions

There are no open questions; the one prior Punt (whether infosec may defer) is closed as a `**Chosen:**` above.

### Assumptions

**Assumes:** `faff ratified-scope --assemble --container <c>` exists and behaves per FAFF-919 (exit 0 prints the block, exit 3 is empty/nothing-ratified, exit 2 fails loud on an unreadable source). *Validation:* the CLI is merged on origin/main (commit dd58893a, PR #766) but is not in the local working tree at local HEAD (a364b520). The build must rebase onto origin/main before building, or the CLI file `plugin/skills/faff/bin/lib/ratified-scope.js` will not exist on disk. Confirm `faff ratified-scope --assemble --help` runs after rebasing.

**Assumes:** a recorded `refutation-spec` baseline exists for the sweep to compare against. *Validation:* check `eval/baselines/frontier.json` has `per_kind.refutation-spec` (present: accuracy 0.806, stability 0.814, format_adherence 1). It is known-miscalibrated (FAFF-730), but the relative same-lens-same-fixture flip signal is robust to that.

**Assumes:** the L4 run ledger carries `prd_root_container` for prep to read the container. *Validation:* `lights-out.js` writes it at line 1048; confirm the field is present in a live L4 run ledger before relying on it. When it is absent or unresolvable, the graceful-degradation path applies (no ratified-scope file, no deferral).

## 8. DONE — definition of done

### From WHY

- [ ] A spec documenting a ratified non-goal, reviewed with the `## Ratified scope` block and the deferral rule, is not re-refuted on that non-goal by at least one lens that refuted it without the block.

### From WHAT (interfaces and fixtures)

- [ ] The deferral rule text is present in the `## The lenses as independent refuters` section of `faffter-dark-spec-review/SKILL.md` (the eval-visible section between `\n## The lenses as independent refuters\n` and `## Backend call`).
- [ ] Each design lens's `refute-*.md` (`refute-architectural.md`, `refute-infosec.md`, `refute-qa.md`) carries the deferral clause; `refute-methodology.md` is unchanged in behaviour.
- [ ] `refutation-spec-011.json` embeds a `## Ratified scope` block in `fixture.spec` and carries `oracle.closed_set: []`.
- [ ] `refutation-spec-012.json` embeds a `## Ratified scope` block plus a `critical`-worthy security hole and carries `oracle.lens_bounds.must_object: ["infosec"]`.
- [ ] `eval/review-bench/lenses/refute-*.md` copies are refreshed to stay byte-identical to canonical (`test/review-bench-lens-parity.test.mjs` passes), and `node eval/review-bench/build-requests.mjs` regenerates the committed request payloads.

### From HOW (behaviour)

- [ ] faff-prep reads `prd_root_container` from the L4 run ledger and runs `faff ratified-scope --assemble --container <c>` once at spec-review loop entry.
- [ ] On CLI exit 0, prep writes the block to `$scratch/ratified-scope.md`; on exit 3, exit 2, or no resolvable container, no file is written.
- [ ] The occupant appends `$scratch/ratified-scope.md`, when present, to the `--context` list of all four lenses, byte-identical across lenses.
- [ ] A design lens defers a non-`critical` objection the block settles, recording it as an observation citing the settling line; it raises everything else, including every `critical`, unchanged.
- [ ] The architectural prompt no longer claims standing ADR-log injection; it describes the real `--context` payload (spec-named files plus the ratified-scope block when present).
- [ ] Each lens's raw stdout (header included) is written to `$scratch/round-<n>-<lens>.md`; `$scratch/round-<n>.json` keeps its existing `{verdict, objections}` shape.

### From HOW (edge cases and gate)

- [ ] No `prd_root_container`, or CLI exit 3/2, degrades to no-deferral with every lens behaving exactly as today.
- [ ] The sweep asserts, mechanically, that at least one previously-refuting design lens now defers on the two new fixtures, and that green/red result gates the merge; no DONE item requires a human to read or approve the sweep.
- [ ] `refutation-spec-012.json` fails if any lens defers the `critical` (the guard test).

### Integration smoke test

```
1. Rebase onto origin/main so `faff ratified-scope` exists on disk.
2. Author a small spec that documents one ratified non-goal, with a matching `## Ratified scope` block.
3. Run the spec-review sweep over refutation-spec-011 and -012.
4. Assert: -011 grades clean (closed_set: []), -012 keeps infosec objecting (lens_bounds must_object infosec),
   and the sweep reports ≥1 previously-refuting design lens now deferring.
If those hold, the deferral rule, the block delivery, and the fixtures are wired together.
```

confidence: high
build-tier: complex
