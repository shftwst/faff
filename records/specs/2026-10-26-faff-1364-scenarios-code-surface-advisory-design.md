# FAFF-1364 — Spec review flags a Scenarios unit that names a test file

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1364.

This spec addresses issue **FAFF-1364 — "Spec review flags a Scenarios unit that names a test file."** Its audience is the build agent that will implement the change and the human reviewers who gate it. It specifies a deterministic surfacing signal plus authoring- and review-time guidance that together stop a `## Scenarios` unit whose check is a repository test file passing from reaching the code-blind holdout, so the behaviour is restated in a holdout-observable form and the test-file check moves to the DONE list.

## 1. WHY — Problem and Principles

**Load-bearing model.** A `## Scenarios` unit is the code-blind holdout's own material: at classify time it is `source="scenarios"`, and no verifier other than the holdout receives a Scenarios unit by id (ADR-0140). The holdout cannot read or run repository test files. So a Scenarios unit whose check is "`` `test/a.test.mjs` MUST pass ``" is intrinsically unjudgeable by the only verifier that will ever see it — and there is nowhere else to route it. The fix is therefore **not** a verifier/tier change; it is to stop such a unit from being authored at all, by flagging it before the spec is rated and promoted so the author restates the behaviour in a Given/When/Then the holdout can observe and moves the test-file check into a DONE item (where FAFF-1360 already routes it to the review/merge test floor).

**Problem statement.** Today a test-file bullet in `## Scenarios` classifies as an `assertion` (it carries `MUST`), stays `source=scenarios`/`running-stack`, and lands on the holdout, which then reports `needs-human` on a check it could never run — 65 of 4221 committed Scenarios units did this as of 2026-10-21. FAFF-1360 deliberately scoped itself to DONE items and FAFF-1293's acceptance covers only `prose`-class units, so a `MUST`-carrying test-file bullet falls between both. This change makes prep and spec review flag such a unit for rewrite before rating/promotion.

**Design principles.**

**One detection primitive.** Test-file detection reuses FAFF-1360's exported `codeSurfaceSignal` / `TEST_FILE_TOKEN_RE`. A second regex would drift from the first and is forbidden.

**The classifier is not touched.** `resolveVerificationTier`'s `source==="done"` gate and the running-stack default for Scenarios units are correct and pinned by selftest. A Scenarios test-file unit must *stay* `running-stack` if one somehow reaches classify; the remedy is authoring-time prevention, not retiering (there is no verifier to retier it to). The deterministic part of this change is **advisory/surfacing only** and never flips an admissibility verdict; the actual flag/refuse authority lives in the spec-review QA lens and in author-time producer guidance.

**Recall-biased, trust-preserving advisory.** Mirroring the module's existing advisories, the new signal is narrow (test-file token only) and warning-only: a false positive on a legitimately-observable scenario costs a warning, never a blocked build.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript (authored directly; no `.ts` sibling) | Home of `codeSurfaceSignal` (:164), `codeSurfaceAdvisory`/`renderCodeSurfaceWarning` (:699–714) to mirror, `admissibleVerdict` (:725) to extend, and the selftest tables |
| `plugin/skills/faffter-dark-nlspec/SKILL.md` | Markdown (skill prompt) | SCENARIOS authoring guidance (§5, :126–151) — nlspec producer |
| `plugin/skills/faffter-noon-spec/SKILL.md` | Markdown (skill prompt) | Scenarios authoring guidance (:57–71) — default spec producer |
| `plugin/skills/faffter-noon-spec-review/SKILL.md` | Markdown (skill prompt) | QA lens row (:36) + severity→verdict map (:61) — single-pass reviewer |
| `plugin/skills/faffter-dark-spec-review/refute-qa.md` | Markdown (skill prompt) | Adversarial QA refuter — the L4 reviewer |
| `test/faff-1360-code-surface-done-tier.test.mjs` | JavaScript (node:test) | CLI-spawning test template to mirror for the new CLI test |

**Scope statement.** This sits at the spec-readiness boundary — the deterministic admissibility advisory, the two spec producers' authoring guidance, and the two spec-review QA lenses — strictly before a spec is rated and promoted to build.

## 2. OUT OF SCOPE

- **`codeSurfaceSignal === "export"` in a Scenarios unit** — a Scenarios unit asserting a symbol is exported is also holdout-unobservable, but the ticket's measured problem and both decisions are about the test-file signal; widening now would broaden beyond the 65-unit evidence and the narrow-signal posture. **Extension point:** change the new advisory's filter from `codeSurfaceSignal(c.text) === "test-file"` to `!== null` (and update the rendered wording) in `admissibility.js`.
- **PROSE-class Scenarios units** — a loose-prose Scenarios unit with no `MUST`/comparator is FAFF-1293's remit. **Extension point:** FAFF-1293, when built, adds the prose-refusal path; this ticket deliberately does not pre-empt it. See decision *Ship on its own vs widen FAFF-1293*.
- **Changing `resolveVerificationTier` / `faff dod classify` tiering** — explicitly forbidden; the `source==="done"` gate and the running-stack default for Scenarios stay. **Extension point:** none — this is a hard constraint, not a deferral.
- **Retro-fixing the 65 existing committed specs** — this change prevents new occurrences and surfaces existing ones on next prep/review; a bulk rewrite of already-shipped specs is separate backlog. **Extension point:** a `faff tidy` spec-health sweep could batch-flag them.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Scenarios unit | One criterion parsed from the spec's `## Scenarios` section; carries `source="scenarios"` |
| Test-file check | A criterion whose text matches `TEST_FILE_TOKEN_RE` — e.g. `` `test/a.test.mjs` MUST pass `` — for which `codeSurfaceSignal` returns `"test-file"` |
| Holdout-observable | A criterion the code-blind evaluator can decide against a running system (CLI exit/stdout, HTTP, a file on disk) — never a repository test file passing |
| Advisory | A warning-only line in the admissibility verdict's `warnings[]`; it never changes the `admissible` boolean |

**New pure functions (in `admissibility.js`, mirroring the FAFF-1360 DONE-only pair at :699–714).**

```
FUNCTION scenariosCodeSurfaceAdvisory(specText) -> { count: Int, items: Criterion[] } | null
  # Pure. Scenarios units whose check is a repository test file, or null when none.
  # Mirrors codeSurfaceAdvisory but filters source==="scenarios" and does NOT filter on
  # verification_tier (a Scenarios test-file unit stays running-stack, never integration).

FUNCTION renderScenariosCodeSurfaceWarning(adv) -> String
  # Single line, deterministic prefix "scenarios-code-surface advisory:".
  # Names each offending unit (whitespace-collapsed, truncated ~50 chars), mirroring
  # renderCodeSurfaceWarning's trunc style.
```

Both are added to `module.exports` (:1711) alongside the existing `codeSurfaceAdvisory` / `renderCodeSurfaceWarning`.

**`admissibleVerdict` extension.** After the existing `codeSurfaceAdvisory` push (:746–747), under the same lights-out path, push the new advisory into `warnings[]`. `admissible` is still `checks.every(c => c.pass)` — unchanged, the advisory never participates.

**Authoring-guidance sentence (both producers).** A single skimmable sentence added to the SCENARIOS section of `faffter-dark-nlspec/SKILL.md` (§5) and `faffter-noon-spec/SKILL.md` (Scenarios), parallel to FAFF-1360's DONE sentence, instructing the author never to make a Scenarios unit's check a repository test file passing and to restate the behaviour observably + move the test-file check to its own DONE item.

**QA-lens guidance (both reviewers).** `faffter-noon-spec-review/SKILL.md` QA lens and `faffter-dark-spec-review/refute-qa.md` gain one attack line: a `## Scenarios` unit whose check is a repository test file passing is unverifiable by the code-blind holdout → raise it so the verdict routes to `revise` (refuse-for-rewrite-in-place).

**Design decisions** — collected with `**Chosen:**` markers in §6.

## 4. HOW — Behavior

**Architecture.** Three complementary hook sites, none of which changes classify/tier:

1. **Deterministic prep-time advisory** (`faff admissible --lights-out`) — `scenariosCodeSurfaceAdvisory` surfaces offending Scenarios units as a warning the author/prep sees.
2. **Author-time producer guidance** — the two spec producers' SCENARIOS sections tell the author not to write the unit in the first place (the "prep" / pre-rating half of the ticket's "Prep AND spec review … before the spec is rated").
3. **Review-time QA lens** — the two spec-review occupants' QA lens flags a surviving unit and routes the verdict to `revise` (the "spec review" half; structurally post-rating but pre-promotion).

Why all three: spec review structurally runs *after* rating, so "before the spec is rated" is only literally satisfiable at the producer/prep sites (1 and 2); the QA lens (3) is the pre-promotion backstop. The deterministic signal (1) is recall-biased and non-gating; the QA lens (3) applies judgement and carries the gating authority — consistent with the reference constraint that the refuse/flag verdict is owned by the QA lens and author guidance, with the new signal as advisory input only.

**scenariosCodeSurfaceAdvisory — behaviour.**

```
PROCEDURE scenariosCodeSurfaceAdvisory(specText):
  1. classified := dodClassify(specText)          # reuse; any throw → return null (fail-open, as codeSurfaceAdvisory does)
  2. items := classified.criteria WHERE
        c.source == "scenarios" AND codeSurfaceSignal(c.text) == "test-file"
  3. IF items is empty: return null
  4. return { count: items.length, items }
```

**renderScenariosCodeSurfaceWarning — behaviour.**

```
PROCEDURE renderScenariosCodeSurfaceWarning(adv):
  trunc(s) := s.replace(/\s+/g," ").trim().slice(0,50)
  return "scenarios-code-surface advisory: " + adv.count +
         " Scenarios unit(s) name a repository test file the code-blind holdout cannot run; " +
         "restate the behaviour as an observable Given/When/Then and move the test-file check to a DONE item: " +
         adv.items.map(c => trunc(c.text)).join(" | ")
```

**admissibleVerdict wiring (at :746–747, inside the existing lights-out block).**

```
surfaceAdv := codeSurfaceAdvisory(specText)                 # unchanged (FAFF-1360, DONE-only)
IF surfaceAdv: warnings.push(renderCodeSurfaceWarning(surfaceAdv))
scenAdv := scenariosCodeSurfaceAdvisory(specText)           # NEW
IF scenAdv:  warnings.push(renderScenariosCodeSurfaceWarning(scenAdv))
admissible := checks.every(c => c.pass)                     # UNCHANGED — advisory never flips it
```

**Edge cases.**

- **CLI-only Scenarios unit** (`` `faff x` MUST exit 0 ``) — `codeSurfaceSignal` returns `null`, no advisory, unit stays `running-stack`/holdout. (Matches FAFF-1360 selftest at :1146 and the CLI test's scenario-2 case.)
- **Well-formed Given/When/Then Scenarios unit** — no `TEST_FILE_TOKEN_RE` match, no advisory, passes unchanged.
- **Mixed unit** naming both a test file and an observable (e.g. "Given `test/a.test.mjs` exists, Then the CLI exits 0") — the signal fires on the token (recall-biased); advisory warns, QA lens judges. Non-gating, by design.
- **Not lights-out** — `admissibleVerdict` returns early (:726) before any advisory; the new advisory only ever surfaces under `--lights-out`, exactly as `codeSurfaceAdvisory` does (confirmed by the FAFF-1360 ac-7 test's plain-mode assertion).
- **Unparseable spec** — `dodClassify` throws → return `null` → no advisory (fail-open, matching `codeSurfaceAdvisory`).

**Failure modes.**

- **The failure:** the LLM QA lens misses a test-file Scenarios unit despite the added guidance, so a bad unit still promotes. **How you'd know:** a committed spec still contains a `source=scenarios` test-file unit and the holdout reports `needs-human` on it. **What it means:** proceed — the deterministic `faff admissible --lights-out` advisory (hook 1) is the independent backstop that fires regardless of LLM judgement; the two surfaces are deliberately redundant.
- **The failure:** the regex over-flags a scenario that names a test file only as setup data while its real observable is a CLI/HTTP check. **How you'd know:** the advisory warns on a scenario a reviewer confirms is holdout-observable. **What it means:** proceed/narrow — warning-only and non-gating; if real misses accumulate, narrow the Scenarios filter (it shares `TEST_FILE_TOKEN_RE`, so narrowing happens once, in FAFF-1360's primitive).

**Anti-pattern:** flipping `resolveVerificationTier` so a Scenarios test-file unit becomes `integration`. Why: no verifier other than the holdout receives a Scenarios unit by id (ADR-0140), so there is nowhere to route it; this also breaks the pinned selftest at `admissibility.js:1142`. The remedy is authoring prevention, not retiering.

**Anti-pattern:** authoring a second test-file regex for the Scenarios case. Why: it would drift from `TEST_FILE_TOKEN_RE`; reuse `codeSurfaceSignal`.

**Anti-pattern:** making the advisory flip `admissible`. Why: the gating authority is the QA lens and author guidance; the signal is surfacing input only, mirroring every other advisory in `admissibleVerdict`.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a lights-out spec with a `## Scenarios` unit "`test/a.test.mjs` MUST pass"
When `faff admissible --lights-out --spec <it> --json` runs
Then warnings contains exactly one line beginning "scenarios-code-surface advisory:" that names that unit, and `admissible` is unchanged by it
```

```
Given a lights-out spec whose only `## Scenarios` unit is a well-formed Given/When/Then with an observable Then (no test-file token)
When `faff admissible --lights-out --spec <it> --json` runs
Then no warning beginning "scenarios-code-surface advisory:" is emitted
```

```
Given a spec with a `## Scenarios` unit "`faff events append` MUST exit 1 on an empty issue" and a `## 8. DONE` item naming a test file
When `faff dod classify --spec <it> --json` runs
Then the Scenarios unit is verification_tier "running-stack"/verifier "holdout" AND the DONE test-file item is "integration"/"review-merge-floor" — the FAFF-1360 behaviour is unchanged
```

## 6. DESIGN DECISION RATIONALE

**Does this widen FAFF-1293's acceptance, or ship on its own?**
- *Widen FAFF-1293* — single home for all "Scenarios unit the holdout can't observe" refusals. Con: FAFF-1293 is **Backlog, not built** (grep finds only design prose); there is no shipped acceptance path to widen, and FAFF-1293 targets `prose`-class units via different detection, whereas this targets `assertion`-class test-file units via `codeSurfaceSignal`. Coupling would block this on an unbuilt ticket.
- *Ship on its own, narrowly* — implement now for the assertion/test-file case; leave prose refusal to FAFF-1293 when built (recorded as an extension point in OUT OF SCOPE).
- **Chosen:** Ship on its own, narrowly — FAFF-1293 is unbuilt and uses a different class and primitive, so there is nothing to literally widen; this is the first implementation and scopes to the measured test-file problem.

**Reuse FAFF-1360's `codeSurfaceSignal` test-file rule, or a second pattern?**
- *Second pattern* — a Scenarios-specific regex. Con: drifts from `TEST_FILE_TOKEN_RE`; forbidden by reference context.
- *Reuse `codeSurfaceSignal`* — the exported pure primitive (:164) already returns `"test-file"` for these bullets and is pinned by the FAFF-1360 selftest.
- **Chosen:** Reuse `codeSurfaceSignal` / `TEST_FILE_TOKEN_RE` — one detection home, no drift, already tested.

**Fire on `test-file` only, or any `codeSurfaceSignal` (test-file or export)?**
- *Any* — also catches export-in-Scenarios units, which are equally unobservable. Con: beyond the ticket's measured 65 test-file units and decision 2's "test-file rule"; broadens an advisory against the narrow-signal posture.
- *Test-file only* — `codeSurfaceSignal(c.text) === "test-file"`.
- **Chosen:** Test-file only — matches the ticket's evidence and decision scope; export-in-Scenarios is an OUT OF SCOPE extension point (change the filter to `!== null`).

**How to honour "Prep AND spec review flag … before the spec is rated" when spec review runs after rating?**
- *Single site* — pick either prep or spec review. Con: prep-only misses the review gate; review-only cannot act "before the spec is rated".
- *Two hook sites* — deterministic prep-time advisory + author guidance (pre-rating), plus the QA lens (pre-promotion backstop with gating authority).
- **Chosen:** Two hook sites — the only coherent reading; the deterministic signal and author guidance satisfy "before rated", the QA lens is the pre-promotion gate, and the two surfaces are deliberately redundant against an LLM miss.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all four decisions are `**Chosen:**` with the autonomous-appetite rationale documented.

**Assumptions.**

- **Assumes:** `plugin/skills/faff/bin/lib/admissibility.js` is authored directly with no committed `.ts` sibling, so editing the `.js` needs no `npm run build` emit step — only `faff regions check` region lint applies. *Validation:* `ls plugin/skills/faff/bin/lib/admissibility.*` shows only `.js` (verified at authoring time).
- **Assumes:** `dodClassify` sets `source: "scenarios"` on `## Scenarios` criteria and `codeSurfaceSignal` is exported. *Validation:* `grep 'source: "scenarios"' admissibility.js` (:290) and the `module.exports` line (:1711) both present.

## 8. DONE — Definition of Done

### From WHY / HOW (deterministic advisory)
- [ ] `scenariosCodeSurfaceAdvisory(specText)` returns `{count, items}` listing every `source="scenarios"` criterion with `codeSurfaceSignal(c.text) === "test-file"`, and `null` when there are none; it does not filter on `verification_tier`.
- [ ] `renderScenariosCodeSurfaceWarning(adv)` returns one line beginning `scenarios-code-surface advisory:` that names each offending unit truncated to ~50 chars.
- [ ] `admissibleVerdict` under `--lights-out` pushes the rendered advisory into `warnings[]`; the `admissible` boolean is `checks.every(c => c.pass)` and is byte-for-byte unaffected by the presence of the advisory.
- [ ] Without `--lights-out`, no `scenarios-code-surface advisory:` warning is emitted.

### From WHAT (interfaces)
- [ ] `scenariosCodeSurfaceAdvisory` and `renderScenariosCodeSurfaceWarning` are added to `admissibility.js` `module.exports`. *(Symbol-export check — own DONE item; `faff dod classify` routes it to the review/merge test floor.)*

### From HOW (authoring guidance)
- [ ] `faffter-dark-nlspec/SKILL.md` SCENARIOS section and `faffter-noon-spec/SKILL.md` Scenarios section each gain one sentence: never make a Scenarios unit's check a repository test file passing; restate the behaviour as an observable Given/When/Then and move the test-file check to its own DONE item.

### From HOW (QA lens)
- [ ] `faffter-noon-spec-review/SKILL.md` QA lens and `faffter-dark-spec-review/refute-qa.md` each gain guidance that a `## Scenarios` unit whose check is a repository test file passing is unverifiable by the code-blind holdout and must be raised (routing to `revise`).

### From constraints (regression)
- [ ] `resolveVerificationTier` is unchanged; `faff dod --selftest` passes, including the pinned case at `admissibility.js:1142` ("a Scenarios unit naming a test file stays running-stack").
- [ ] `test/faff-1360-code-surface-done-tier.test.mjs` passes unchanged.

### From tests / hygiene
- [ ] Pure-function selftest cases added (in `admissibleSelftest` or `dodSelftest`): a Scenarios test-file unit yields a non-null advisory naming it; a CLI-only Scenarios unit and a well-formed GWT unit yield `null`.
- [ ] A new CLI test `test/faff-1364-scenarios-code-surface.test.mjs` (mirroring the FAFF-1360 template) asserts the four Scenarios above via `faff admissible --lights-out`/`faff dod classify`.
- [ ] `faff validate-adapters` and `faff regions check` pass after the SKILL.md and `admissibility.js` edits.

**Integration smoke test.**

```
1. Write a spec fixture: `## Scenarios` with "- `test/a.test.mjs` MUST pass"
   and a second well-formed Given/When/Then unit, plus a minimal `## 8. DONE`.
2. Run `faff admissible --lights-out --spec <fixture> --json`.
3. Assert: warnings has exactly one line starting "scenarios-code-surface advisory:"
   naming the test-file unit; `admissible` reflects only the R1/R2 checks.
4. Run `faff dod classify --spec <fixture> --json`.
5. Assert: both Scenarios units are verification_tier "running-stack"/verifier "holdout"
   (classify is unchanged — the fix is authoring-time, not a retier).
```

## Already shipped against this surface

- **FAFF-1360** (Done, PR #1098) — *"A DONE item checked by a test file or an internal function call is routed to the test floor, not the code-blind holdout."* Introduced `codeSurfaceSignal` / `TEST_FILE_TOKEN_RE` and routed **DONE** test-file/export items to the `integration` tier. **Related, not superseding:** FAFF-1360's own design doc explicitly deferred the Scenarios-unit case to this ticket ("Chosen: DONE items only. Scenarios units that name test files belong to spec review (FAFF-1364)"). FAFF-1364 reuses its detection primitive but adds a new, Scenarios-filtered consumption site — it does not touch FAFF-1360's DONE routing.
- **FAFF-1293** (Backlog, not built) — *"Spec review refuses holdout scenarios that are really prose."* Adjacent but a different criterion class (prose) and detection path; left to ship separately. FAFF-1364 does not pre-empt it.

confidence: high
build-tier: complex
spec-review: approve