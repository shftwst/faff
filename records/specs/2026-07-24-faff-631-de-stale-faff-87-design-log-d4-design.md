# Spec — FAFF-631: De-stale the faff-87 design-log D4 after the FAFF-534 convergence default flip

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-631.

An nlspec for a docs-only coherence fix: the committed faff-87 design log still records within-run convergence as "default off / opt-in", but FAFF-534 (PR #466, merged 2026-07-23) flipped the shipped default. Audience: the build agent applying the annotation, and reviewers weighing how faff treats committed design logs.

## 1. WHY

**The load-bearing model.** A committed design log is a historical record of a decision *as made*, not a living statement of current behaviour. When a later ticket reverses a recorded decision, the log stays coherent by carrying a **dated supersession annotation** pointing at the reversing ticket — the original text is preserved, and a reader landing on the old decision is redirected to the current posture. This is the same shape as the records/adr supersession model (FAFF-197): annotate, never rewrite.

**Problem statement.** `records/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` D4 (line 35) records "**D4 — Chosen — default off / opt-in** … (convergence is L4 discipline)", and its DONE checklist repeats "Within-run convergence is an opt-in mode" (line 49). FAFF-534 (PR #466, commit 4d280ff) flipped the shipped posture: **L4 non-optional, L3 default-on, knob/`--no-converge` for a single-run or persistent L3 opt-out only** (`.faffrc.example.yaml` now ships `enabled: true`). A reader of the faff-87 rationale is now actively misled about shipped behaviour.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `records/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` | Committed design log | The doc being annotated — D4 (line 35) + DONE final item (line 49) are the stale sites |
| `records/specs/2026-07-23-faff-534-within-run-convergence-default-posture-design.md` | Committed design log | The superseding decision record the annotation points at |
| `records/adr/` supersession pattern (FAFF-197) | Convention | Precedent: dated superseded-by annotation, original text intact |
| `.faffrc.example.yaml` L202–204 | Config schema prose | Shipped ground truth: `enabled: true`, L4 non-optional, L3 opt-out only |

**Scope statement.** This sits entirely in `records/specs/` — one file, no code, no config, no skill prose.

## 2. OUT OF SCOPE

- **Rewriting D4's original text.** *Why excluded:* design logs are historical records; the ticket asks for coherence "without rewriting history". *Extension point:* none — deliberate.
- **The FAFF-534 / FAFF-540 / FAFF-624 convergence behaviour itself.** *Why excluded:* all shipped or tracked elsewhere; this ticket touches only the stale record. *Extension point:* those tickets' own docs.
- **A general stale-design-log sweep or a doc-supersession lint.** *Why excluded:* the ticket names one doc; a generic mechanism is a separate idea nobody has filed. *Extension point:* a future tidy/audit ticket.

## 3. WHAT — the edit set

Two stale sites get a dated annotation; four decisions were checked and need none.

**Site 1 — D4 (line 35).** Directly beneath the existing D4 bullet, add an indented annotation line:

```
  - **Superseded 2026-07-23 by FAFF-534 (PR #466):** the shipped default flipped ON —
    L4 non-optional (knob/flag inert), L3 default-on with an explicit opt-out only
    (`--no-converge` / `enabled: false`). See records/specs/2026-07-23-faff-534-within-run-convergence-default-posture-design.md.
    Original text below preserved as the decision as made.
```

(Rendered as one wrapped sub-bullet; exact line-wrapping is the builder's call. The original D4 text is not modified.)

**Site 2 — DONE final item (line 49).** The checklist item "Within-run convergence is an opt-in mode that composes with `--until` / `--max`" gets a trailing annotation on the same item: `*(default posture superseded 2026-07-23 by FAFF-534 — now default-on / L4 non-optional; the budget-gate composition still holds)*`.

**Checked, no edit needed:** D2 (termination = `run-done`), D3 (hard cap is a backstop), D5 (single thin feature), D6 (dryness definition) — none assert the default posture; FAFF-534 left the terminator/backstop design unchanged. Line 48's "when the mode is off or budget-capped" remains accurate for the surviving L3 opt-out.

**Header pointer.** One line appended to the existing header revision block (after line 8): `**Superseded in part 2026-07-23:** D4's default-off posture was flipped by FAFF-534 (PR #466) — see the dated annotation on D4.` — so a skimming reader is warned before reaching §5.

## 4. HOW

Plain text edits to one file on a feature branch via `/faff-graft`, shipped as a normal PR. No behaviour, config, or skill prose changes. The annotations state the supersession forward (what the posture is now, who decided it, where the full record lives) and never delete or reword the original decision text.

**Anti-pattern:** editing D4's original sentence to say "default on". Why: that rewrites history — the log would claim a decision that was never made on 2026-06-28, and the FAFF-534 rationale (which cites the old posture as spent) would dangle.

## 5. Scenarios

```
Given the annotated faff-87 design log on main
When a reader reaches D4
Then the original "default off / opt-in" text is intact AND a dated
     "Superseded … by FAFF-534" annotation directly follows it, naming the
     current posture and pointing at the FAFF-534 design doc
```

- The strings "Superseded" and "FAFF-534" MUST appear in `records/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` after the change (grep-verifiable); they appear today zero times.

## 6. DESIGN DECISION RATIONALE

**Decision 1 — supersession annotation vs in-place amendment?** (the ticket's deferred open question)

| Option | Pro | Con |
|---|---|---|
| Dated superseded-by annotation, original intact | Matches the ADR supersession precedent (FAFF-197) and the ticket's own "without rewriting history"; FAFF-534's rationale keeps a valid referent | Doc carries two postures (clearly dated) |
| In-place amendment (rewrite D4 to the new posture) | Single current statement | Falsifies the 2026-06-28 record; breaks FAFF-534's "the OFF rationale is spent" cross-reference; no repo precedent for silently rewriting a committed decision |

**Chosen:** dated superseded-by annotation in place. The "no changelog / state-the-rule-forward" convention governs *skill prompts* (runtime readers); `records/specs/` design logs are the opposite artifact class — the durable record — and the repo's existing supersession precedents (ADR model, dated Revised banners in faff-113 / FAFF-385) all annotate rather than rewrite. `(decides: architecture)`

**Decision 2 — annotation sites.**

**Chosen:** exactly three touches — D4 sub-bullet, DONE-item trailing note, one header pointer line — with D2/D3/D5/D6 verified unaffected and left untouched. Rationale: D4 and the DONE item are the only lines asserting the default posture (verified by reading the doc against the FAFF-534 change surface); annotating unaffected decisions would add noise and imply changes FAFF-534 didn't make. The header pointer is the cheap skim-guard.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the ticket's one open question is closed by Decision 1.

**Assumptions.**
- **Assumes:** the faff-87 doc on `main` at build time still carries the un-annotated D4/DONE wording at lines 35/49. **Validate:** re-grep `"default off / opt-in"` and `"is an opt-in mode"` in the doc before editing; if line numbers drifted, anchor on the strings, and if the annotation already exists, stop (someone got there first).

## 8. DONE

### From WHY / WHAT
- [ ] D4 in `records/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` is followed by a dated `Superseded 2026-07-23 by FAFF-534` annotation naming the new posture (L4 non-optional, L3 default-on, explicit L3 opt-out) and pointing at the FAFF-534 design doc; D4's original text is byte-unchanged.
- [ ] The DONE checklist's "opt-in mode" item carries the trailing supersession note; the `--until`/`--max` composition claim is left standing.
- [ ] The header revision block carries the one-line "Superseded in part 2026-07-23" pointer.
- [ ] D2, D3, D5, D6 and all other doc content are byte-unchanged.

### From HOW
- [ ] `grep -c "FAFF-534" records/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` ≥ 3 (was 0); `grep "Superseded"` hits the D4 annotation and header pointer.
- [ ] Change ships as a single-file docs PR via `/faff-graft`; no other file is touched.

**Integration smoke test.**
```
1. grep the annotated doc for "Superseded 2026-07-23 by FAFF-534" -> present at D4.
2. grep for "default off / opt-in" -> the original D4 text still present (history intact).
3. git diff --stat on the PR -> exactly one file changed (plus the committed spec).
```

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (agile-delivery). Non-blocking — surfaces for human review; does not gate promotion._

**Right-sized? (Principle 4)** — yes: a sub-day, single-file, always-ships-together docs unit. No split or merge indicated.

**Workstream fit? (Principles 1+5)** — cohesive: one outcome (the convergence design log stops contradicting shipped behaviour), directly downstream of FAFF-534 and correctly `relatedTo` it.

**Deps surfaced? (Principle 6)** — clean: the only dependency (FAFF-534 shipped) is Done and linked; no blocker edge needed for a doc annotation on already-merged work.

**Risk profile? (Principle 7)** — negligible: docs-only, mechanically verifiable, no behaviour change. No spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
