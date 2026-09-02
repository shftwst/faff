# Spec — FAFF-923: route `acceptanceSection` through the fence-aware shared scanner

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-923.
> build-tier: complex

This is the buildable nlspec for **FAFF-923**. Audience: the build agent implementing the change, and the human reviewer signing off the shipped-gate behaviour change. It specifies replacing the hand-rolled heading scanner inside `acceptanceSection` with a delegation to the module's shared `sectionBody` scanner, accepting the resulting boundary correction on two (plus one obscure) edge inputs, and updating the selftests that exercise the affected gate.

## 1. WHY — Problem and Principles

**The load-bearing model.** `admissibility.js` deliberately keeps exactly **one** heading-section boundary scanner — `sectionBodyRange` (line 189) and its text-joining wrapper `sectionBody` (line 213) — so that every consumer computes "where does this `##` section end?" the same way. `acceptanceSection` (lines 351–364) is a leftover second scanner that hand-rolls its own boundary and gets it wrong in two ways the shared one gets right. This ticket deletes the duplicate and routes `acceptanceSection` through the shared scanner. The whole change is one returned expression plus its test and doc fallout.

**Problem statement.** `acceptanceSection` finds `## Acceptance criteria` and walks the body with a private loop that (a) only stops at the next level-2 `## ` heading — so a later level-1 `# Appendix` is swallowed into the acceptance body — and (b) is not fence-aware — so a `## ...` line inside a code block truncates the body early. Because `acceptanceSection` feeds `prdStrictCheck` → `classifyAcceptanceCriteria` → the born-verifiable PRD gate, both bugs are part of a shipped gate's contract. Routing through the fence-aware, equal-or-higher-stop shared scanner corrects both, at the cost of an accepted behaviour change on those inputs.

**Design principles.**

- **One scanner, no duplicate.** The end state has a single heading-boundary scanner in `admissibility.js`. The fix must *remove* the hand-rolled loop, not wrap or shadow it. Any implementation that leaves a second boundary-walking loop in the module fails the intent of the ticket (AC #4), even if behaviour is correct.
- **Preserve heading recognition exactly; change only the boundary.** The section-start recognition must stay identical: a level-2 `## ` heading whose text begins (case-insensitively) with `acceptance criteria`, so `## Acceptance Criteria` and `## Acceptance criteria (release)` still match. Only the *body-end boundary* (and the now-fence-aware *start* scan) changes.
- **The behaviour change is the deliverable, not a side effect.** This is a shipped-gate change. It carries a gate-change review note describing which external-PRD inputs now classify differently, and gate-exercising selftests — not merely a green `node --test`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` (`acceptanceSection`, L351–364) | JS (Node, CommonJS) | The function being changed |
| `admissibility.js` (`sectionBody` L213 / `sectionBodyRange` L189 / `headingLevel` L386) | JS | The shared scanner it delegates to |
| `plugin/skills/faff/bin/lib/prd.js` (`prdStrictCheck` L111, `prdValidate` L133, `prdSelftest` L221) | JS | The sole consumer + where its selftests live |
| `plugin/skills/faff/bin/lib/ratified-scope.js` (L15–17) | JS | Stale breadcrumb comment naming this ticket as "deferred" |

**Scope statement.** This is the FAFF-919-deferred "Option C": the dedup that 919 intentionally left undone because it changes a live gate and needed its own review — this ticket is that review.

## 2. OUT OF SCOPE

- **Changing the shared scanner's behaviour** — the shared `sectionBodyRange` default boundary (fence-aware, stop at equal-or-higher heading level) is already the *correct* target; this ticket adopts it, it does not modify it. Extension point: `sectionBodyRange`/`sectionBody` in `admissibility.js` if the shared boundary itself ever needs to change (a separate, wider-blast-radius ticket).
- **Changing `classifyAcceptanceCriteria` or `prdStrictCheck`** — how criteria are *classified* is unchanged; only which lines get *handed to* the classifier changes. Extension point: `classifyAcceptanceCriteria` (admissibility.js) / `prdStrictCheck` (prd.js).
- **Adding a `--strict` flag to `faff admissible`** — the ticket text names "`faff admissible --strict`", but the gate that actually consumes `acceptanceSection` is `faff prd validate --strict` (and the Frozen-PRD freeze precondition). No new CLI surface is created. Extension point: `cmdPrd` / `PRD_SPEC` in prd.js.
- **Deeper-subsection (`###`+) capture semantics** — a `### ` sub-heading after the acceptance heading is level-3 (> 2) and is swallowed into the body under **both** the old and the new scanner — unchanged and correct.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| section-start recognition | Locating the `## Acceptance criteria` heading line (level-2, case-insensitive text prefix). |
| body-end boundary | The line at which the acceptance body stops (first equal-or-higher heading, fence-aware). |
| equal-or-higher stop | Stop at the first heading whose level is `> 0 && <= 2` (so `#` h1 and `##` h2 both stop; `###`+ does not). |
| fence-aware | Lines inside a code fence are treated as literal text, never as headings. |

**Interface (unchanged signature).**

```
FUNCTION acceptanceSection(prdText: String | null) -> String | null
  # Returns the body text of the `## Acceptance criteria` section, or null when absent.
  # Signature, name, module export, and the returned-string join semantics are all UNCHANGED.
  # Only the body extent (boundary) and the now-fence-aware start scan change.
```

**Recognition contract that must be preserved (the heading regex).**

```
ACCEPTANCE_HEADING_RE = /^\s*##\s+acceptance criteria/i
  # level-2 only (`## `), case-insensitive, text-PREFIX match.
  # Passing this to sectionBody yields section level = 2 (via headingLevel),
  # hence the equal-or-higher stop fires on level-1 and level-2 headings.
```

**Design decision — how to delegate.** The shared `sectionBody(specText, headingRe, opts)` with **no `opts`** already: (1) scans fence-aware for the first line matching `headingRe`; (2) records its level via `headingLevel`; (3) walks the body fence-aware, breaking at the first line whose level is `> 0 && <= sectionLevel`. Passing `ACCEPTANCE_HEADING_RE` therefore produces exactly the corrected boundary with no options.

**Chosen:** Replace the entire body of `acceptanceSection` with a single delegation — `return sectionBody(prdText, /^\s*##\s+acceptance criteria/i);` — passing no `opts` so the default (fence-aware, equal-or-higher) boundary applies. This preserves level-2 case-insensitive-prefix start recognition and null-when-absent, while fixing both boundary bugs and removing the duplicate loop.

## 4. HOW — Behavior

**Approach.** One edit to the function body, one comment update on the same function, one stale-breadcrumb comment update in `ratified-scope.js`, plus test and gate-change-note additions. No new module, no signature change, no new export.

```
PROCEDURE acceptanceSection(prdText):
  1. RETURN sectionBody(prdText, /^\s*##\s+acceptance criteria/i)
     # sectionBody handles: null/empty input -> "" -> null when heading absent;
     # fence-aware start scan; level-2 heading; fence-aware equal-or-higher body-end.
```

**Behaviour deltas to document for the gate-change review.** Exactly three observable changes flow through `prdStrictCheck` into `faff prd validate --strict` (and the Frozen-PRD freeze precondition):

```
(a) An h1 (or bigger) heading AFTER the acceptance section:
    OLD: `# Appendix` did not stop the scan -> its body was swallowed into
         the acceptance criteria and form-checked.
    NEW: the body stops at the h1 -> criteria under a post-acceptance h1 are
         no longer classified as acceptance criteria.
    Effect on the gate: a prose criterion hidden under `# Appendix` that used to
    trip --strict no longer does (and, symmetrically, a born-verifiable one there
    no longer counts toward the section).

(b) A fenced `## ...` line INSIDE the acceptance body:
    OLD: the fenced `## ` line was mistaken for the next heading -> the body was
         truncated there and later criteria were dropped.
    NEW: the fenced line is ignored -> the whole body up to the real next
         equal/higher heading is classified.

(c) (Obscure) A `## Acceptance criteria` heading placed INSIDE a code fence:
    OLD: matched as the section start.
    NEW: the fence-aware start scan skips it; the section is treated as absent
         (or the next real, unfenced acceptance heading is used).
```

**Unchanged invariants (regression guards).**

- Null-when-absent: no acceptance heading → `null` (old: `start === -1`; new: `sectionBody` returns `null` when the range is null). Parity.
- Level-2 case-insensitive-prefix recognition: `## Acceptance Criteria (release)` still matches; a level-1 `# Acceptance criteria` still does **not** (never did — the regex is `##`).
- `###`+ subsections after the heading remain swallowed into the body under both old and new.
- Returned join semantics: body lines joined with `"\n"`, heading line excluded — identical to the old `body.join("\n")`.

**Consumer-side selftest placement (resolves the ticket's "`faff admissible`" wording).** `acceptanceSection` is reachable at the gate only through `prdStrictCheck` → `prdValidate` → the `faff prd validate --strict` path, whose selftest entrypoint is `faff prd --selftest` (`prdSelftest`, prd.js). `admissibleSelftest` and `dodSelftest` do **not** call `acceptanceSection` (they exercise `parseScenarios`/`dodClassify` over `## Scenarios` via the shared scanner already). So the corrected-boundary coverage is added where the function is actually exercised: the `t(...)` unit block and a gate-level `prdValidate(..., { strict: true })` assertion in `prdSelftest`, run via `faff prd --selftest`.

**Chosen:** Add the boundary-change coverage to `prdSelftest` (unit-level in the existing `t()` block at prd.js L284–290, plus a gate-level `--strict` assertion exercising the corrected boundary end-to-end). Leave `admissibleSelftest`/`dodSelftest` unchanged, and state in the gate-change note that they don't consume `acceptanceSection` — recording the actual exercised surface rather than a nominal one.

**Anti-pattern:** wrapping the old loop behind a flag or keeping it as a fallback. AC #4 requires *no* hand-rolled heading-scan copy to remain; a retained loop defeats the dedup this ticket exists to complete.

**Anti-pattern:** editing `sectionBodyRange`/`sectionBody` to accommodate `acceptanceSection`. The shared scanner's default is already the correct target; changing it would widen the blast radius to every DoD/scenarios consumer.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a PRD with `## Acceptance criteria` followed later by a level-1 `# Appendix` heading
      whose body contains a criterion
When acceptanceSection(prdText) is called
Then the returned body stops at the `# Appendix` heading and does NOT include the
     Appendix criterion or the Appendix heading text
```

```
Given a PRD `## Acceptance criteria` body containing a fenced code block whose content
      includes a `## ...` line, followed after the fence by a further criterion
When acceptanceSection(prdText) is called
Then the fenced `## ...` line does NOT truncate the body, and the criterion after the
     fence IS included in the returned body
```

```
Given the three existing acceptanceSection selftests (prefix-matches variant heading;
      stops at next section; null when absent)
When acceptanceSection is routed through sectionBody
Then all three still pass unchanged (recognition + null + stop-at-equal-level parity)
```

- The delegated implementation contains **no** boundary-scanning loop of its own (verifiable by inspection of the function body — a single `return sectionBody(...)`).

## 6. DESIGN DECISION RATIONALE

**How should `acceptanceSection` compute its body boundary?**
- *Option A — leave it hand-rolled (FAFF-919's shipped choice).* Pro: no gate change. Con: the duplicate scanner persists and the two boundary bugs stay; explicitly the deferred work this ticket exists to finish. Rejected.
- *Option B — patch the hand-rolled loop in place (add fence tracking + h1 stop).* Pro: minimal call-graph change. Con: leaves a *second* boundary scanner in the module (violates AC #4), and re-implements logic the shared scanner already has — invites future drift. Rejected.
- *Option C — delegate to the shared `sectionBody` with default opts.* Pro: removes the duplicate entirely, inherits the correct fence-aware equal-or-higher boundary, preserves start recognition and null semantics exactly. Con: accepts the (intended) behaviour change on the edge inputs. **Chosen:** delegate to `sectionBody(prdText, /^\s*##\s+acceptance criteria/i)` — the mechanical one-line replacement, accepting the documented behaviour change.

**Where do the corrected-boundary selftests live, given the ticket says "`faff admissible`/`faff dod` selftests"?**
- *Option A — literally edit `admissibleSelftest`/`dodSelftest`.* Con: neither calls `acceptanceSection`; added cases would test the wrong path and wouldn't exercise the change. Rejected.
- *Option B — add to `prdSelftest` (the gate that actually consumes `acceptanceSection`) and run via `faff prd --selftest`.* **Chosen:** unit cases in the existing `t()` block plus a gate-level `--strict` assertion; the gate-change note records that `admissible`/`dod` selftests are unaffected because they don't reach `acceptanceSection`. This honours the AC's intent (gate-exercising selftests for the corrected boundary) while pointing them at the real surface.

**Do we accept the obscure case (c) — a fenced `## Acceptance criteria` heading no longer matching as the section start?**
- **Chosen:** accept and name it to the reviewer. It falls directly out of the shared scanner's fence-aware start scan; treating a code-fenced heading as literal text is the correct behaviour, and the input is degenerate. Documenting it satisfies the gate-change-review mandate without extra code.

**Stale breadcrumb in `ratified-scope.js`.**
- **Chosen:** update the L15–17 comment to drop the "deferred to FAFF-923" clause (the dedup is now done; one shared scanner, no separate `acceptanceSection` scan remains). No functional change to `ratified-scope.js`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ticket carries its own acceptance criteria; the correct target behaviour is the shared scanner's existing, tested default; the only judgement (documenting the accepted behaviour change) is itself mandated by the ticket and discharged in §4.

**Assumptions.**

- **Assumes:** `sectionBody` / `sectionBodyRange` / `headingLevel` behave as read at admissibility.js L189–218 and L386 (fence-aware start scan; level via `headingLevel`; body break at `lvl > 0 && lvl <= sectionLevel`). *Validation:* re-read those functions before editing; confirm `headingLevel("## Acceptance criteria (release)") === 2` and that `sectionBodyRange` returns `null` when the heading regex never matches.
- **Assumes:** `acceptanceSection`'s only production consumer is `prdStrictCheck` (prd.js L112). *Validation:* `grep -rn "acceptanceSection" plugin/skills/faff/bin/` before editing — expect only the definition/export in `admissibility.js`, the import + call in `prd.js`, and the selftest references in `prd.js` (already confirmed at spec time).

## 8. DONE — Definition of Done

### From WHY / WHAT (the delegation)
- [ ] `acceptanceSection` in `admissibility.js` is a single `return sectionBody(prdText, /^\s*##\s+acceptance criteria/i);` (no local boundary-scanning loop, no `for` walk over lines).
- [ ] No hand-rolled heading-scan copy remains anywhere in `admissibility.js` (verifiable by inspection: the only boundary walk is `sectionBodyRange`).
- [ ] The function's leading comment is updated to state the corrected boundary (fence-aware, stops at equal-or-higher heading incl. h1), not "up to the next `## ` heading or EOF".

### From HOW (behaviour on edge inputs)
- [ ] Input (a): for a PRD with `## Acceptance criteria` then a later `# Appendix` with a body criterion, `acceptanceSection` returns a body that stops at the h1 and excludes the Appendix content. Covered by a test.
- [ ] Input (b): for a `## Acceptance criteria` body containing a fenced `## ...` line followed by a further criterion, `acceptanceSection` returns a body that includes the post-fence criterion (the fenced line does not truncate). Covered by a test.
- [ ] The three existing `acceptanceSection` selftests (prd.js L285–290) still pass unchanged.

### From HOW (gate + selftests)
- [ ] `prdSelftest` gains gate-level coverage: a `prdValidate(dir, { strict: true })` (or `prdStrictCheck`) assertion that reflects the corrected boundary on inputs (a) and (b), runnable via `faff prd --selftest`.
- [ ] `faff prd --selftest`, `faff admissible --selftest`, and `faff dod --selftest` all pass; the full `node --test` suite passes.

### From HOW (gate-change review artefact)
- [ ] A note (in the ticket/PR) states which external-PRD inputs now classify differently: (a) criteria under a post-acceptance h1 are no longer form-checked; (b) criteria after a fenced `## ` line inside the body are now form-checked; (c) a code-fenced `## Acceptance criteria` heading no longer matches as the section start.
- [ ] The note explicitly records that `admissibleSelftest`/`dodSelftest` are unchanged because they do not consume `acceptanceSection`; the exercised gate is `faff prd validate --strict`.

### From ratified-scope breadcrumb
- [ ] The `ratified-scope.js` comment (L15–17) no longer says the `acceptanceSection` dedup is "deferred to FAFF-923"; it reflects the completed single-scanner end state. No behavioural change to `ratified-scope.js`.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. prd = "## Acceptance criteria\n- a MUST b\n\n```\n## fenced not-a-heading\n```\n- c MUST d\n\n# Appendix\n- loose prose here\n"
  2. body = acceptanceSection(prd)
  3. ASSERT body includes "a MUST b" AND "c MUST d"          # fence no longer truncates
  4. ASSERT body does NOT include "loose prose here"          # h1 now stops the body
  5. ASSERT acceptanceSection("## Problem\nx\n") === null      # null-when-absent parity
```

## Already shipped against this surface

- **FAFF-919** (Done 2026-08-27) — shipped Option A: reused the shared `sectionBody`/`sectionBodyRange` scanner for its own `## Non-goals` scan but *deliberately left `acceptanceSection` untouched*, splitting this fix out to FAFF-923. Related, not superseding: the premise here (the `acceptanceSection` duplicate still exists) is confirmed against live code (admissibility.js L351–364).
- **FAFF-300** (Done) — made `faff admissible` heading-match recognise numbered heading forms via `SCENARIOS_HEADING_RE`; a different scanner concern that does not touch `acceptanceSection`'s body boundary. Not superseding.

Premise-superseded verdict: **premise holds** — no Done work delivers this dedup; FAFF-919 explicitly deferred it.

## Methodology critique

_Agile-delivery lens (`issue-critique`) — non-gating; surfaces in the next `/faff-wtf`._

- **Right-sized? (principle 4)** — No issues. One cohesive 1–3 day unit: a single `return sectionBody(...)` delegation plus its tightly-coupled fallout (function comment, the `ratified-scope.js` breadcrumb, gate-exercising selftests, gate-change note). These do not decompose into independent concerns and none ships without the others.
- **Workstream fit? (principles 1 + 5)** — No issues. Team FAFF, Backlog, project-less, related to FAFF-919 — the correct default landing for a deferred follow-up with a single outcome (finish the one-scanner dedup on a live gate).
- **Deps surfaced? (principle 6)** — No issues. The one load-bearing prerequisite (the shared `sectionBody`/`sectionBodyRange` scanner) already shipped in FAFF-919 (Done); "related to" (not `blockedBy`) is the honest edge for a satisfied predecessor.
- **Risk profile? (principle 7)** — No issues. The real risk (a shipped-gate contract change to `faff prd validate --strict` on three edge inputs) is named and de-risked in-structure: behaviour change treated as the deliverable, three deltas enumerated, a mandated gate-change note, gate-exercising `prdSelftest --strict` coverage on the actual consuming surface, and a mechanical one-line change to the shared scanner's already-tested default.

---

_Gates: confidence **high** · spec-review **approve** (architectural/infosec/QA lenses, single-pass L3) · build-tier **complex**. Prepped autonomously (run `run-20260902-183401-fly-l3`)._

confidence: high
spec-review: approve
