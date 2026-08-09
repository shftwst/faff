# Review-comment policy for iterated reviews — collapse-and-log

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-184.

_Revised 2026-06-19 — the open Punt (append-trail vs collapse-and-log) was resolved by the maintainer to **collapse-and-log**; respec to high._

Build spec for **FAFF-184** (build agent + reviewers). Specifies **one** review-comment policy — collapse-to-final + per-pass detail in logs — resolving the collision between graft's "append the review result" and the gateway granularity rule.

## 1. WHY — Problem and Principles

**Problem statement.** faff-graft Step 9 says "append the review result as a comment", and the fail→fix→re-review loop re-enters Step 9 — so an iterated build leaves an accumulating trail (pass 1, pass 2, …) plus the adversarial per-finding disposition. That collides head-on with the gateway granularity rule (*Tracker as the lights-out control plane §2*: per-micro-step markers forbidden; intra-step progress → `.faff/` logs + the once-per-run digest, never per-step tracker comments). Nothing mechanically resolves the two.

**Design principles.**

- **Honor the granularity rule — the tracker stays skimmable.** The control plane carries the *outcome*, not the blow-by-blow. The policy is **collapse-and-log**: one comment with the final verdict + a counts summary; the per-pass detail lives in `.faff/logs`.
- **Lose nothing.** Collapsing the tracker view is only acceptable if the full per-pass history is *guaranteed* written to `.faff/logs/…graft-ISSUE.md` — one click away, never dropped.
- **Compose with FAFF-185, don't contradict it.** FAFF-185 set the *surface* (pre-PR → the tracker issue) and *timing*; this sets the *count* on that surface. Together: findings land on the tracker, as **one** collapsed comment.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff-graft/SKILL.md` Step 9 | "append the review result" → restate as collapse-to-final |
| `plugin/skills/faffter-noon-review` + `faffter-dark-adversarial-review` "log to tracker" | findings recording — one collapsed comment, detail to logs |
| gateway *Tracker as the lights-out control plane §2* (granularity rule) | the rule this honors; cite it, no amendment needed |
| FAFF-185 | sets the findings surface (pre-PR tracker); composes |

**Scope statement.** Doc/prose clarification across faff-graft + the two review skills + a granularity-rule cross-reference — no code.

## 2. OUT OF SCOPE

- **Where/when findings are posted** → FAFF-185 (pre-PR, tracker). This is *how many* comments.
- **Adversarial-backend hardening** → FAFF-183. **Slot dispatch** → FAFF-182.
- **Amending the granularity rule** — not needed; collapse-and-log already honors it.

## 3. WHAT — the policy

**Vocabulary.**

| Term | Meaning |
|---|---|
| collapse-and-log | one tracker comment = final verdict + "resolved N findings across M passes" summary; full per-pass detail → `.faff/logs/…graft-ISSUE.md` |
| review pass | one run of the review step (Step 9), possibly re-entered via fail→fix→re-review |

**Decision — the policy.** **Chosen:** collapse-and-log. On a build that iterates review, faff-graft posts/updates **one** tracker comment carrying the **final** verdict plus a one-line "resolved N findings across M passes" summary. It does **not** post a comment per pass. (Rejected append-trail: best inline auditability but floods the control plane and pulls against the granularity rule — its audit value is preserved in the log instead.)

**Decision — consistency.** **Chosen:** cite the gateway granularity rule (*§2*) as the governing rule; collapse-and-log honors it, so **no rule amendment** is required. The adversarial skill's per-finding dispositions collapse into the same final comment's summary (or its own single collapsed comment), not one-per-finding.

## 4. HOW — Behavior

```
faff-graft Step 9 (review), iterating fail→fix→re-review:
  - accumulate per-pass findings + dispositions in .faff/logs/…graft-ISSUE.md  (every pass, hard floor)
  - on terminal verdict (pass / needs-human): post ONE tracker comment:
      "Review: <final verdict>. Resolved N findings across M passes. Full detail: .faff/logs/…graft-ISSUE.md"
  - do NOT post a comment per pass; if updating in place, keep a single comment
adversarial review:
  - its per-finding dispositions fold into the same collapsed comment's summary (or one single collapsed comment),
    detail to the same log — never one comment per finding
```

**Anti-pattern:** a tracker comment per review pass or per adversarial finding. Why: floods the control plane, violates the granularity rule — the exact failure this resolves.

**Anti-pattern:** collapsing the tracker view without writing the per-pass detail to `.faff/logs`. Why: that loses the audit trail the append-trail option existed to provide. The log write is mandatory, not best-effort.

**Edge cases.**
- Single-pass clean build → one comment, "resolved 0 findings across 1 pass" (or just the verdict); same shape.
- `needs-human` terminal → the one comment carries the needs-human verdict + the blocking finding summary; detail in logs.

## 5. SCENARIOS

```
Given a build whose review iterates across M passes
When review reaches a terminal verdict
Then exactly one tracker comment is posted (final verdict + "resolved N findings across M passes"), and the per-pass detail is in .faff/logs/…graft-ISSUE.md
```
```
Given the adversarial review raised per-finding dispositions
When findings are recorded
Then they collapse into the final comment's summary / one collapsed comment — not one comment per finding
```
```
Given the policy text
When I read faff-graft Step 9 + the review skills' log-to-tracker steps
Then they state collapse-and-log explicitly and cite the gateway granularity rule (no contradictory "append per pass")
```

## 6. DESIGN DECISION RATIONALE

**Append-trail vs collapse-and-log?** Append-trail gives inline per-pass auditability but floods the tracker and needs the granularity rule amended. Collapse-and-log honors the rule and keeps the audit trail in logs. **Chosen:** collapse-and-log (maintainer decision; the ticket's own recommendation), with the per-pass detail guaranteed in `.faff/logs`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the policy is chosen.

**Assumptions.**
- **Assumes:** FAFF-185 lands the findings surface as the pre-PR tracker issue; this policy governs comment count on that surface. *Validation:* land alongside FAFF-185 (related link already set); if 185 changes the surface, the same collapse-and-log count applies to whatever surface it defines.

## 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] faff-graft Step 9 + the two review skills' log-to-tracker steps state **collapse-and-log** explicitly (no "append per pass").
- [ ] The policy cites the gateway granularity rule (*§2*); the rule is not amended (collapse honors it).

### From HOW
- [ ] An iterated review posts exactly **one** tracker comment (final verdict + "resolved N across M passes"); adversarial dispositions collapse in, not one-per-finding.
- [ ] The full per-pass detail is **guaranteed** written to `.faff/logs/…graft-ISSUE.md` (mandatory, hard floor).

### From SCENARIOS (verification)
- [ ] grep: no "append the review result … per pass" phrasing remains; Step 9 reads collapse-to-final.
- [ ] `faff validate-adapters` + tests pass; judgement-eval baseline re-runs without regression (prose change, FAFF-130/145 gate).

**Integration smoke test:**
```
1. grep -n 'append the review result' plugin/skills/faff-graft/SKILL.md     → updated to collapse-to-final
2. grep -n 'granularity' plugin/skills/faff-graft/SKILL.md                   → Step 9 cites the gateway rule
3. simulate a 3-pass review → one tracker comment + 3 passes of detail in .faff/logs
```

confidence: high
