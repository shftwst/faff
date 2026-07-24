# Doc-honesty sweep — governance-layer explainer enforcement claims

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-622.

This spec is for the build agent and human reviewers. It defines a documentation-only correction of `docs/reports/governance-layer-explainer-2026-07.md`: bring every enforcement claim in the explainer into line with what the code actually enforces, or say plainly where a guarantee is attested rather than enforced. It is the peer follow-up to FAFF-570 (the guide-pages truth pass, shipped in PR #460) and FAFF-583, and applies the same standard those did.

## 1. WHY — Problem and Principles

**The one idea:** a trust product's docs must not narrate an *attested* guarantee as an *enforced* one. faff earns trust one rung at a time by naming exactly what a machine enforces versus what holds only while the agent plays along. When a doc claims enforcement the code doesn't deliver, the doc itself becomes the trust bug — and this ticket is literally about that rule.

**Problem statement.** The July L4 capabilities audit found the docs "narrate attested guarantees as enforced ones in roughly five places." FAFF-570 and FAFF-583 corrected the guide pages and the gateway levels table; during FAFF-570's build, `docs/reports/governance-layer-explainer-2026-07.md` was flagged as carrying the same overclaim class, outside both their scopes. This change closes that gap in the explainer.

**Design principles:**

- **Ground every correction in shipped behaviour.** The `docs/audits/2026-07-20-l4-capabilities-audit.md` boundary and the named modules (`sentry.js`, `lights-out.js`, `corrective-integrity.js`) are the source of truth — not the doc's own prior wording.
- **Surgical, not a rewrite.** Match FAFF-570's touch: correct the genuine overclaims, and leave claims that already match shipped behaviour alone rather than re-litigating them. A verified-honest claim is documented as checked, then left.
- **Say the plain word.** Casual-but-credible, British understatement, no PM jargon. A hedge qualifies ("attested, not enforced"); evidence quantifies (a ticket ref, a module name). No apologetic filler.

**Reference context:**

| System | Type | Relevance |
|---|---|---|
| `docs/reports/governance-layer-explainer-2026-07.md` | Markdown report | The file under correction |
| `docs/audits/2026-07-20-l4-capabilities-audit.md` | Markdown audit | The enforced-vs-attested boundary (source of truth) |
| `plugin/skills/faff/bin/lib/sentry.js` | CLI module | Grounds the `correct`-rung dormancy |
| `plugin/skills/faff/bin/lib/lights-out.js` | CLI module | Grounds the "no reduced mode" refusal |
| PR #460 (FAFF-570) | Merged change | The standard this sweep matches |

**Scope statement.** One report file, prose and mermaid-diagram labels only — no code, no CI, no other doc.

## 2. OUT OF SCOPE

- **Any code or behaviour change.** — Why excluded: this is a doc-truth pass; the code is the source of truth, not the thing being changed. — Extension point: the actual enforcement gaps are already ticketed (FAFF-562 governance-check-required, FAFF-564/568 tamper-evidence, FAFF-517 process-isolation) and are where the *behaviour* changes land.
- **Other docs (guide pages, gateway, landscape report).** — Why excluded: FAFF-570 and FAFF-583 already covered the guide and gateway; the landscape report is a separate artifact. — Extension point: file a peer ticket if a future sweep finds the same class elsewhere.
- **Re-verifying the audit's boundary itself.** — Why excluded: the audit is the accepted source of truth per the ticket. — Extension point: a fresh capabilities audit (FAFF-435 is the frontier re-audit) revisits the boundary.

## Already shipped against this surface

Related Done work, checked and confirmed **not** superseding this ticket:

- **FAFF-570** (Done, PR #460) — corrected the same attested-as-enforced overclaim class in the L4 *guide* pages (`unattended.md`, `architecture.md`). Confirmed by diff: PR #460 did **not** touch `docs/reports/governance-layer-explainer-2026-07.md`. It is the standard this sweep matches, not a delivery of it.
- **FAFF-583** (Done) — fixed the gateway levels table's "(preview)"/"shipped" clash. Different file, different claim; does not touch the explainer.

The explainer's overclaims remain present and undelivered by either — the ticket's premise holds in full.

## 3. WHAT — the claims and their disposition

The sweep classifies every enforcement claim in the explainer into three buckets: **fix** (overclaims enforcement the code doesn't deliver), **caveat** (built but not yet binding, needs a claim-site note), and **leave** (already matches shipped behaviour — checked and honest). Below is the full disposition; the fixes and caveats are the deliverable, the leaves are the audit trail that the sweep was comprehensive.

### Fix — attested-as-enforced overclaims

**F1 — the sentry `correct` node shows a dormant rung as operational (§2 gate-3 diagram, ~line 49).** The gauntlet diagram labels the tripped-sentry ladder `pause → correct → abort`. Ground truth: `sentry.js` records that `correct` (Sentry-2 / FAFF-326) "is reachable ONLY" when the caller passes corrective authority derived from a `corrective-integrity` attestation — and no real launcher can truthfully declare that boundary today (`corrective-integrity.js` stays `asserted:false` by design, "distrust by default"), so "today's real-world routing is unchanged." The explainer's own §7 already says the live ladder "is effectively `continue → pause → abort`." The diagram contradicts §7 and overstates enforcement.

**Chosen:** change the gate-3 node label from `pause → correct → abort` to `pause → abort` (the tripped-branch ladder that actually runs; `continue` is the untripped path, already the quiet edge). Leave the surrounding italic ("abort commits in-flight work; always resumable") untouched — it is accurate. This aligns the diagram with §7, which needs no change.

**F2 — the holdout judge's code-blindness is stated as a physical fact (§2 gate-4 node and the "second look" bullet, ~lines 51 and 66).** The node calls it "a code-blind judge"; the bullet says "The holdout judge (gate 4) never reads the code." Ground truth (audit §2, and the exact correction FAFF-570 made to `architecture.md`): code-blindness is **attested, not physically enforced** today — the evaluator runs inline, shares the run's working directory, and *can* read the repo; `code_blind` holds only while it complies, the same footing as an ordinary review verdict. The cage that would make blindness physical is built but not yet wired into the live holdout dispatch.

**Chosen:** (a) soften the gate-4 node to mark the property attested — `an (attested) code-blind judge grades the work against withheld scenarios`; (b) add one sentence to the bullet after "charmed by a tidy diff": *"Today that blindness is attested, not enforced — the evaluator runs inline and can read the repo, so `code_blind` holds only while it complies; the cage that makes it physical is built but not yet wired into the live dispatch."* Keep the landscape sentence ("nobody else does this anywhere") — the differentiator is the code-blind holdout *approach*, which is real; only its *physical* enforcement is deferred.

### Caveat — built, not yet binding

**C1 — the §4 differentiator table states unqualified code-blindness (~line 94).** The row "Work graded by a judge that never reads the code … | faff today: Built" reports the property as fully built. The mechanism is built; the *blindness* is attested. To stay consistent with F2 without undercutting the (genuine) differentiator:

**Chosen:** change that row's "faff today" cell from `Built` to `Built (blindness attested today)`. The approach still counts as built and unique; the parenthetical keeps the table honest against F2.

**C2 — §1's headline claim states the merge lock as live (~line 15).** "Branch protection makes that check *required* — so git itself refuses the merge if the paperwork doesn't hold up." Read at the doc's most prominent point, this reads as enforced today; in fact `governance-check` is not yet marked required, even on faff's own main (audit §2; the doc's own §3 layer-C and all of §8 say exactly this — "one config short of binding", FAFF-562). This is the built-not-binding class, but the headline states it flatly as current fact.

**Chosen:** add a short claim-site caveat so §1 is self-honest rather than relying on the reader reaching §8 — after "if the paperwork doesn't hold up", append: *"— the mechanism is built and runs on every faff PR; marking the check *required* is the one config change still outstanding (§8)."* This adds no new fact; it surfaces §8's reality at the point of claim. Lightest-touch option that satisfies the acceptance ("every enforcement claim … either matches shipped behaviour or explicitly states it is attested-not-enforced") at the claim site.

### Leave — checked and already honest (audit trail)

- **"no reduced mode" (§2 gate-1, ~line 43)** — named in the ticket as a candidate. **Verified honest:** `lights-out.js` states "no keystone-absent reduced mode" and its preflight refuses on any guardrail not `live`; audit §1 confirms "any guardrail not in a `live` state is a refusal — 'no reduced mode'." Matches shipped behaviour. Left unedited — the same disposition FAFF-570 gave this claim in the guide.
- **§2 gate-2 budget** ("unknown models over-count, never under") — matches `budget.js` / audit §1. Leave.
- **§2 gate-5 merge-gate** ("re-checks against the PR's exact head commit; --admin refused as a bypass") — matches audit §1. Leave.
- **§2 gate-6 / §2 last bullet** (governance-check re-derives; gates 5 and 6 "re-derive rather than trust") — the re-derivation machinery is real and runs on every PR; its *forge-binding* is the C2 gap, caveated at §1 and fully owned by §8. The gauntlet is framed as the designed flow; §8 governs its binding state. Leave the diagram; C2 carries the honesty.
- **§6 "the honest edges"** ("validates conformance, not authenticity") — the exemplar honest section. Leave.
- **§7 sentry section** — already honest end to end: the "un-subvertable" retraction (line ~215), the dormant `correct` rung, and "what travels today is effectively `continue → pause → abort`" (line ~216). This section is the ground truth F1 aligns the diagram *to*. Leave.
- **§8 "built vs binding"** — the honest gap section in full. Leave.

## 4. HOW — behaviour

A single editing pass over the one file, applying F1, F2, C1, C2 exactly as their **Chosen** markers state. No section is reordered; no new section is added; the mermaid diagrams change only the two node labels named (F1, F2a). The prose additions are the three sentences/clauses named (F2b, C1, C2).

**Anti-pattern:** rewriting sections that the disposition marks "leave". Why: FAFF-570's standard is surgical — re-litigating an already-honest claim adds churn and risks introducing a new error, and the "leave" list is the record that each was checked.

**Anti-pattern:** deleting the code-blind-holdout differentiator or the sentry `correct` design. Why: both are real design work; the corrections mark their *enforcement status*, they do not deny the design exists (F2 keeps the landscape sentence; F1 leaves §7's `correct`-can-get-teeth narrative intact).

## 5. DONE — Definition of Done

### From the fixes
- [ ] §2 gate-3 node reads `pause → abort` (no `correct` in the tripped-ladder label); §7's `continue → pause → abort` prose is unchanged and now consistent with the diagram.
- [ ] §2 gate-4 node marks code-blindness attested (e.g. "(attested) code-blind judge"), not an unqualified physical fact.
- [ ] The §2 holdout bullet carries a sentence stating blindness is attested-not-enforced today (evaluator runs inline, can read the repo; cage built but not wired), and keeps the landscape differentiator sentence.

### From the caveats
- [ ] §4 differentiator table's code-blind row shows "faff today" as `Built (blindness attested today)` (or equivalent honest qualifier), not bare `Built`.
- [ ] §1's "branch protection makes that check required" sentence carries a claim-site caveat that the required-flip is the one outstanding config change (consistent with §3 layer-C and §8), so the headline is self-honest.

### Sweep completeness (the acceptance criterion)
- [ ] Every enforcement claim in the explainer either matches shipped behaviour or explicitly states it is attested-not-enforced — verified by walking §1–§8 against the "fix / caveat / leave" disposition in section 3; no enforcement claim is left both unqualified and unmatched to shipped behaviour.
- [ ] Each "leave" claim in section 3 is re-checked against the cited module/audit line and confirmed still honest at build time (the audit trail holds).

### Hygiene
- [ ] The change is confined to `docs/reports/governance-layer-explainer-2026-07.md`; no code, CI, or other doc is touched.
- [ ] Mermaid blocks still parse (node-label edits only; no structural graph change).
- [ ] Prose reads casual-but-credible, no banned vocab (no "receipts", "marquee", "spine"-as-metaphor, "footgun", "smoking gun", gun metaphors), no PM jargon.

**Integration smoke test:** re-read the corrected explainer top to bottom as a first-time reader who never touches faff; confirm no sentence promises enforcement the audit says is attested, and that §1, §2, §4, §7, §8 now tell one consistent story about what git enforces versus what holds by attestation.

confidence: high
spec-review: approve

## Methodology critique

Agile-delivery lens over the issue:

- **Right-sized?** Yes. One report file, four small edits (two mermaid node labels, one sentence, two clause/cell caveats) plus a documented leave-list. A single sub-day unit — nothing to split, nothing to merge with a sibling.
- **Workstream fit?** Fits the "documentation is up to date" line cleanly, as the named peer of FAFF-570/FAFF-583. Outcome-named and cohesive.
- **Deps surfaced?** None hidden. The enforcement gaps the doc describes are already ticketed (FAFF-562, FAFF-564/568, FAFF-517); this pass only re-describes current state, so it carries no blocker edge and needs none.
- **Risk profile?** Low. Docs-only, reversible by PR revert, no novel integration and no external dependency — no de-risking spike warranted.

No issues.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
