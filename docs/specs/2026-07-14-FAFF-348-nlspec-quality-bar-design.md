# Spec — FAFF-348: Give `faffter-dark-nlspec` a documented quality bar

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-348.

This spec defines an hour-scale prose slice: add a quality-bar section to `plugin/skills/faffter-dark-nlspec/SKILL.md` so the repo's configured `spec` producer documents how it discharges the quality bar faff-prep's producer requirements name. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model:** faff-prep's slot contract makes every `spec` producer responsible for its own quality bar — prep trusts the producer's self-rating and never re-runs the review — so a producer that documents no bar leaves the active configuration with an undischarged named requirement. The fix is a refer-forward: the heavy producer explicitly inherits the lite default's self-review, restating only what must bind locally (the in-context dispatch rule and the rating-downgrade cap) in fresh wording.

**Problem statement:** `plugin/skills/faff-prep/SKILL.md` requires every `spec` producer to "(c) discharge its own quality bar", citing `faffter-noon-spec`'s _Self-review before returning_ as the default's discharge, and prep's "Spec quality bar (owned by the producer)" section (lines 143–153) says prep trusts that bar rather than re-running it. This repo's configured occupant, `faffter-dark-nlspec` (241 lines), has no self-review or quality-bar section anywhere — so the self-rating downgrade rule (≥1 blocker or ≥3 major → cap at `medium`) does not bind the heavy producer, and its `confidence: high` is un-audited. The whole-system coherence audit (docs/audits/2026-07-04-faff-323-whole-system-coherence.md, observation "the shipped `spec` occupant documents no quality bar") recommends inheriting noon's self-review explicitly or defining one.

**Design principles:**

- **One home for shared prose.** The self-review's canonical definition stays in `faffter-noon-spec/SKILL.md`; the new section points at it and must not copy it — the CI linter fails on ≥6 identical significant lines shared across two skills (`test/validate-adapters.test.mjs` duplicated-block rule).
- **Deliverable prose is self-contained.** The new SKILL.md section carries no ticket numbers or ADR references. (The authoring standard bans external-artifact refs in executed prose; note the implemented `faff lint-refs` slice currently scans `docs/guide/**` only — the new section stays ref-free per the standard regardless of enforcement scope.)

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faffter-noon-spec/SKILL.md` lines 79–102 | The canonical self-review section being inherited |
| `plugin/skills/faffter-dark-nlspec/SKILL.md` | The file gaining the new section |
| `plugin/skills/faff-prep/SKILL.md` (producer requirements; "Spec quality bar (owned by the producer)") | The consumer prose the new section satisfies — unchanged by this slice |
| `test/validate-adapters.test.mjs` (duplicated-block test) | The CI constraint shaping the section's wording |

**Scope:** one new section in one SKILL.md; no CLI, contract, schema, or CI changes.

## 2. OUT OF SCOPE

- **Lifting the quality-bar prose to the gateway as a canonical shared home** — rejected for this slice (see Design decision rationale); a future issue would do it in `plugin/skills/faff/SKILL.md` with both producers refer-back edited in the same PR.
- **Editing faff-prep's producer-requirements prose** — it stays accurate for the default and the audit does not cite prep as needing a fix; extension point: the producer-requirements paragraph in `plugin/skills/faff-prep/SKILL.md`.
- **A validate-adapters rule requiring spec producers to document a quality bar** — prose requirement, not structural; extension point: the type-specific `checksFor` checks in the adapter linter.
- **An authoring-guidance note that non-default spec producers must document their bar** — optional follow-on; extension point: `faffter-dark-authoring-adaptors/SKILL.md`.

## 3. WHAT — The new section

Insert a new `## Quality bar — self-review before returning` section into `plugin/skills/faffter-dark-nlspec/SKILL.md` between `## Confidence self-rating` (ends line 219) and `## Contract artifact` (starts line 221). Content, in three parts:

1. **The inheritance sentence** — this producer discharges the delegated-`spec` quality bar by running the sibling `faffter-noon-spec/SKILL.md` → _Self-review before returning_ step in full before emitting the spec and self-rating: same review checklist, severities (`blocker`/`major`/`minor`), acting-on-findings rules, return-the-review requirement, and narrowing-only-refresh exemption. That section is canonical; this skill adds nothing and drops nothing.
2. **In-context clause** — this producer runs as a dispatched producer subagent, so the review runs as the in-context fresh-reasoning pass (single-level nesting), per the inherited section's own rule; the clean-context subagent dispatch applies only when run at top level. (Dispatch mechanics are identical for both producers, so this is confirmation, not divergence.)
3. **Downgrade rule restated** — ≥1 `blocker` or ≥3 `major` findings cap the self-rating at `medium`; the `## Confidence self-rating` section is read subject to this cap. Restated because it directly modifies an adjacent section of this file; worded freshly, not copied.

All wording must be fresh (no run of 6+ lines identical to the noon section) and contain no ticket/ADR references. Target 6–10 substantive lines; the file sits at 241 lines against a 600-line cap.

## 4. HOW — Procedure

1. Edit `plugin/skills/faffter-dark-nlspec/SKILL.md`: insert the section per WHAT. No other file changes.
2. Run `faff validate-adapters` (duplicated-block, line-cap, stray-marker rules) and `faff lint-refs` — both must pass.
3. Run `node --test test/validate-adapters.test.mjs` (or the full suite per repo convention) — green.
4. Conventional commit, e.g. `docs(FAFF-348): document faffter-dark-nlspec quality bar by inheriting the noon self-review`.

**Edge cases:** none mechanical — the only hazard is accidental verbatim copying from the noon section, which step 2 catches deterministically.

**Anti-pattern:** copying the noon checklist bullets (codebase fit, assumes-validity, punt-resolvability, …) into the new section. Why: it forks the canonical definition and trips the duplicated-block linter; the pointer is the mechanism.

## 5. SCENARIOS

Omitted — a mechanical prose insertion is below the complexity bar; the DONE checklist is directly testable.

## 6. DESIGN DECISION RATIONALE

**Should the quality bar be inherited by reference from the sibling default, defined independently, or lifted to the gateway as the canonical shared home?**

- *Refer-forward to `faffter-noon-spec/SKILL.md` → _Self-review before returning_* — smallest diff (one section, one file); sanctioned mechanism (within-prose anchors are the dedup rule; `faff-prep/SKILL.md` already refer-forwards to that exact sibling section, so the sibling pointer precedent exists); one-directional sibling dependency is the only cost.
- *Define its own bar* — duplicates review logic that is producer-independent (dispatch mechanics are identical), invites drift between the two bars.
- *Lift to the gateway, both producers refer back* — architecturally purest per the "shared prose has one home = the gateway" charter, but triples the scope (gateway + noon + dark edits), moves settled, evaluated prose out of the default producer, and buys nothing while only two producers exist.

**Chosen:** refer-forward from `faffter-dark-nlspec` to the sibling `faffter-noon-spec` section — smallest conforming change; the gateway lift stays a future refactor if a third `spec` producer appears (recorded in OUT OF SCOPE, not blocking).

**How much does the new section restate locally versus purely point?**

- *Pure pointer (one sentence)* — leanest, but leaves the downgrade rule invisible next to this file's own `## Confidence self-rating` section, which it modifies, and leaves the subagent-nesting question (this producer is always dispatched) unanswered where a reader needs it.
- *Restate the two locally-binding clauses in fresh wording* — the in-context rule and the downgrade cap are the only parts whose application a reader of *this* file must resolve without following the pointer; fresh wording stays under the 6-identical-line duplication threshold.

**Chosen:** pointer plus fresh-worded restatement of exactly two clauses (in-context dispatch, downgrade cap) — everything else lives only at the canonical home.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

None. Both decisions are closed; no external dependencies — the inherited section, the linter rules, and the insertion point were all verified in-repo at spec time.

## 8. DONE — Definition of Done

### From WHY
- [ ] `plugin/skills/faffter-dark-nlspec/SKILL.md` contains a quality-bar section; grep for `Self-review before returning` in that file matches.

### From WHAT
- [ ] The section sits between `## Confidence self-rating` and `## Contract artifact`.
- [ ] It names the sibling section `faffter-noon-spec/SKILL.md` → _Self-review before returning_ as canonical and inherited in full.
- [ ] It states the in-context (single-level nesting) rule applies because this producer runs as a dispatched subagent.
- [ ] It states the downgrade rule: ≥1 `blocker` or ≥3 `major` findings → self-rating capped at `medium`.
- [ ] The section contains no `FAFF-`/ADR references and no run of 6+ lines identical to the noon section.

### From HOW
- [ ] `faff validate-adapters` passes (no `duplicated block`, no line-cap breach).
- [ ] `faff lint-refs` passes.
- [ ] `node --test test/validate-adapters.test.mjs` green; no other files modified.

**Integration smoke test:** run `faff validate-adapters` from the repo root after the edit — if it exits 0 and the new heading greps in the file, the slice is delivered.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Lens verdict: **buildable as scoped** — one advisory finding on sizing, the rest of the axes pass. No blocking findings.

### Right-sized? (principle 4) — advisory, no change required

- **What's there.** The spec declares itself an "hour-scale prose slice": one section inserted into one SKILL.md, no CLI/contract/schema/CI changes. That sits below the 1–3 day band the lens treats as a healthy ticket.
- **Why it matters.** The band exists to keep sequencing honest in both directions — undersized tickets fragment the picture only when they *always ship together* with a sibling. The natural merge candidate exists: FAFF-349 ("Docs-tidy bundle: five small stale-prose fixes from the coherence audit") is the same audit's catch-all for small prose corrections. But FAFF-348 is not a stale-prose fix — it closes a live conformance gap (an undischarged producer requirement) and carries its own settled design decision (inherit-by-reference vs. define-own vs. lift-to-gateway, resolved in the Design decision rationale). It ships independently and is independently verifiable (grep + `faff validate-adapters`).
- **What to do.** Nothing. The merge test is "always ship together", not "both small", and these don't. Keep it standalone; the fully mechanical DoD makes it a clean `faff-automate` unit despite the small size.

### Workstream fit? (principles 1 + 5) — No issues

Project-less Backlog is the **conformant** landing for this ticket, not a gap: audit-discovered and methodology-fill work defaults to plain Backlog under this lens's default-landing rule, and sequencing it into an outcome project is a deliberate later pass, never a capture-time obligation. The wider FAFF-323 audit cluster (FAFF-335…349) sits the same way, grouped by the `faff-chain-gap-fill` label rather than a container — a label is a provenance marker, not a grouping unit, so no thematic-project finding applies. No action needed for this issue to build.

### Deps surfaced? (principle 6) — No issues

- The FAFF-323 edge is correctly shaped: *related*, not `blockedBy`. The audit is provenance — its output (the shipped audit doc) already exists, so a blocker link would be a false gate.
- The spec's Open Questions section claims no external dependencies and shows its work: the inherited sibling section, the linter rules, and the insertion point were all verified in-repo at spec time. No other ticket's unshipped output is referenced anywhere in the spec, so there is no missing blocker edge to draw.
- One structural dependency worth naming (not a tracker edge): the slice creates a one-directional prose dependency on `faffter-noon-spec/SKILL.md` → *Self-review before returning*. That is the chosen design (pointer, not copy) and is the correct dedup mechanism; the residual drift risk if the noon section is later rewritten is already dispositioned in the spec's OUT OF SCOPE (gateway lift as the future refactor when a third producer appears). Nothing to link now.

### Risk profile? (principle 7) — No issues

No novel integration, no unproven approach, no external-team dependency — a documentation-conformance edit whose single named hazard (accidental verbatim copy tripping the duplicated-block linter) is caught deterministically by tooling already in CI. Nothing here warrants a de-risking spike; sequencing position is unconstrained by risk.

### Findings summary

| Principle | Finding | Action |
|---|---|---|
| 4 (right-sized) | Hour-scale, below the 1–3 day band; nearest merge candidate FAFF-349 fails the always-ship-together test | None — build standalone |
| 1 + 5 (workstream fit) | Project-less Backlog conforms to the lens's default-landing rule for audit-fill work | None |
| 6 (surfaced deps) | Related-not-blocking edge to FAFF-323 is correct; no unshipped work referenced | None |
| 7 (risk) | Prose-only, deterministically linted; no spike warranted | None |

confidence: high

spec-review: approve
