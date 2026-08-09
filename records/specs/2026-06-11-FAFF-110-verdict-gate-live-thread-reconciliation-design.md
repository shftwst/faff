# Spec — FAFF-110: Live-thread reconciliation at the autonomous verdict gate

> Spec: faffter-noon-spec · 2026-06-11 · interactive · adaptor: faffidavit-spec · confidence: high. Full spec on Linear FAFF-110.

## 1. WHY

`/faff-beep-boop`'s verdict gate computes an issue's automation-routing verdict from the spec's **retained confidence rating** (or the tidy-time `automation-verdicts.md` cache) **without re-reading the live comment thread**. A human comment resolving an open `**Punt:**` is never consulted, so the issue routes out as `needs-decision-first` on a stale snapshot. This silently ignores the tracker as the human control surface (observed: FAFF-109's "Option A" resolution was missed → routed out).

**Root cause:** the gateway scopes "reconcile the retained rating against post-spec comments" to **faff-tidy's spec-health pass only**. Explicit-list runs invoke no tidy, and full-pipeline runs miss a comment landing after tidy — in both cases the verdict consumes an unreconciled snapshot.

**Design principles.**
- **Deterministic-over-prose / understandable.** The reconciliation rule already exists for tidy; this lifts it to a contract invariant so every consumer inherits it — no new mechanism.
- **Proportionate.** Prose-only: 2 SKILL.md files, no CLI/CI/config.

**Out of scope.**
- Any CLI/CI/config change — extension point: a future `faff` helper could *detect* post-spec comments, but the contract fix stands alone.
- The resolve-attempt path (it's a backstop; the fix prevents reaching it on a resolved Punt).
- faff-tidy's own spec-health pass mechanics (unchanged; it remains *a* locus, no longer *the* locus).

## 2. WHAT

A fixed **Live-thread reconciliation** clause in the gateway automation-routing contract, a generalization of the spec-readiness line, and mandatory re-scan steps at beep-boop's two verdict points.

**Chosen:** make live-thread reconciliation a property of *verdict computation itself*, inherited by every consumer — not tidy's job alone.

## 3. HOW — the exact edits

### 3.1 `skills/faff/SKILL.md` — Automation-routing contract (after the `routing_adaptor` adaptor-slot paragraph)
Add a **Live-thread reconciliation (fixed — the tracker is the control surface)** paragraph: before a verdict is assigned for any spec-gated issue, scan comments posted *after* the spec (faff-prep → Scenario B Step 2a: Challenge / Resolution / Context / Noise). A **Resolution** (human picks an option / answers a `**Punt:**` / closes a decision) or **Challenge** supersedes the retained rating → compute the verdict against a prep-refreshed spec, at **every** locus (tidy pass *and* inline recompute when no tidy ran or a comment post-dates tidy). A cached verdict is valid only against the thread as of its computation.

### 3.2 `skills/faff/SKILL.md` — Spec readiness contract (the tidy-reconciles sentence)
Generalize: the reconciliation is **not tidy's alone**; per Live-thread reconciliation, any verdict computation must reconcile against the live thread before use.

### 3.3 `skills/faff-beep-boop/SKILL.md` — build-queue assembly (step 4)
Insert a **mandatory** re-scan before "Compute the automation-routing verdict": a post-tidy Resolution/Challenge invalidates the cache entry and forces a narrow-prep refresh before the verdict.

### 3.4 `skills/faff-beep-boop/SKILL.md` — explicit-list mode
"If spec present" → re-scan the thread before queueing; a Resolution/Challenge routes through narrow prep first. Note the re-scan is the *only* thing between a stale rating and the inline verdict here, so it is mandatory.

**Chosen:** edits are exactly these 2 files; no CLI/CI/config touched.

## 4. DESIGN DECISION RATIONALE

- **Chosen — contract invariant, not a per-skill patch.** Lifting reconciliation into the fixed contract means prep's gate, beep-boop, and any future consumer inherit it; patching only beep-boop would leave the same latent hole elsewhere.
- **Chosen — refresh via narrow prep, not a bespoke re-rate.** Prep already owns Scenario B Step 2a (Resolution → spec out of date → refresh + re-rate); route through it rather than duplicating the logic.
- **Assumes:** faff-prep's Scenario B Step 2a comment taxonomy (Challenge / Resolution / Context / Noise) is the canonical scan; the contract references it rather than redefining. *Validate:* present in `skills/faff-prep/SKILL.md`.

## 5. DONE — testable checklist

- [ ] Gateway Automation-routing contract has a fixed Live-thread reconciliation clause applying at every verdict-computation locus.
- [ ] Gateway spec-readiness line no longer implies reconciliation is tidy-only.
- [ ] beep-boop build-queue assembly re-scans the thread before trusting a cached verdict; a post-tidy Resolution/Challenge forces a narrow-prep refresh.
- [ ] beep-boop explicit-list mode re-scans the thread before the inline verdict (mandatory).
- [ ] Prose-only: diff is exactly the 2 SKILL.md files (+ this spec doc); `faff validate-adapters` stays green.
- [ ] The contract wording carries the worked example (resolved-Punt `medium` → re-rates to `fire-and-forget`, not routed out).

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"} ] }
```

*Attached by faff-prep (interactive, 2026-06-11). Self-rated `confidence: high` — known, already-validated prose fix.*
