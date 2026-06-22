# Harden the review-findings comment-identity match against quoted or pasted marker text

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high. Full spec on Linear FAFF-207.

This spec is for the build agent and human reviewers. It hardens the **match predicate** of the FAFF-202 comment-identity contract so a quoted or pasted marker can no longer be mistaken for *the* faff-owned review-findings comment. The deliverable is a tightening of one gateway prose rule — `Review-findings comment identity` in `plugin/skills/faff/SKILL.md` — not a new CLI, lock, or data structure. The two consumer skills (`faff-graft` Step 9 and `faffter-dark-adversarial-review` step 3) refer back to that rule and need editing only if the contract's externally-visible shape changes (it does not).

## 1. WHY — Problem and Principles

**The load-bearing model.** The contract uses a hidden HTML-comment marker pair as the *idempotency key* for the one terminal review-findings comment per issue. Today the locate step decides "is this the faff comment?" by asking whether the comment body **contains** the open marker *anywhere*. That predicate cannot tell faff's own comment apart from someone else's comment that merely *mentions* the marker text. Tightening the predicate to "the comment **is structured as** a faff review-findings comment" — open marker on its own line, at the top of the body — removes the ambiguity without changing anything a real faff comment looks like.

**Problem statement.** Status quo: the locate procedure matches any comment whose body contains the open marker substring. Pain: a human quoting the marker in a reply, or a third party pasting `<!-- faff-review-findings:<ISSUE-ID> -->` into their own comment, also matches — faff could then splice its region into the wrong comment. This change narrows the predicate so only a genuinely faff-structured comment is treated as the update target, while leaving every real faff comment matching exactly as before.

**Design principles:**

- **Proportionate to a low-severity, not-yet-realised hazard.** The ticket rates this **low**, already bounded by the splice rule (text outside the marker pair is preserved) and the FAFF-82 posture ("wasted duplicate, never corruption"). The fix must stay a prose-predicate tightening — no CLI helper, no lock/CAS, no stored comment-ID map, no author-identity dependency. A heavier mechanism is out of proportion to the risk.
- **A real faff comment must still match unchanged.** faff authors the open marker as the first line of the body (`marker_open + "\n" + faff_body + "\n" + marker_close`). Any hardened predicate must continue to match that exact shape with zero behaviour change for genuine comments — the only comments that stop matching are the quoted/pasted impostors.
- **Preserve the legacy-truncated splice path.** The existing splice rule already handles a faff comment whose `marker_close` was hand-truncated (open present, close missing) by re-wrapping `marker_open`→end. That path is a *real but damaged faff comment*, not an impostor, and must survive the hardening — so "require both markers" cannot be a blanket match gate.
- **No new portable signal is invented.** faff targets multiple trackers via MCP; there is no guaranteed cross-tracker comment-author identity. Author identity may only ever be an *optional* additional discriminator where the tracker happens to expose it, never a required predicate.

**Reference context:**

| System | Form | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` → `Review-findings comment identity` | Skill prose (single source) | The locate/match/splice/reconcile rule being hardened. |
| `plugin/skills/faff-graft/SKILL.md` Step 9 (collapse-and-log) | Skill prose (refer-back) | Primary consumer; runs the locate procedure at the terminal verdict. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` step 3 | Skill prose (refer-back) | Secondary consumer; its dispositions fold into the same marked comment. |
| `docs/specs/2026-06-22-FAFF-202-comment-identity-contract-design.md` | Committed spec | The contract this extends; its §3 match predicate and §2 OUT-OF-SCOPE note. |

**Scope statement.** This sits inside the FAFF-202 comment-identity contract, refining only its match predicate (the "which comment is the faff one" test) — every other clause of that contract (marker format, splice, oldest-wins reconcile, anti-patterns) is unchanged.

## 2. OUT OF SCOPE

- **A `faff` CLI helper for the locate/match.** Why excluded: the match operates over `list_comments` output, which is tracker-MCP-bound, and the faff CLI is pure with no tracker access (gateway → Resolver); FAFF-202 §2 already deferred it. Extension point: a future `faff review-comment-marker <issue>` emitter/validator if mechanical validation is ever wanted.
- **Author-identity as a required predicate.** Why excluded: no portable cross-tracker comment-author signal exists, so a hard author check would break on trackers that don't expose it. Extension point: an *optional* tie-breaker noted in the gateway rule for trackers that do expose author identity (described in HOW, not built as a gate).
- **A lock / CAS / stored comment-ID map for the concurrent-create race.** Why excluded: FAFF-82 already bounds that hazard to a wasted duplicate and deems a heavier lock unjustified; this ticket is about *injection*, not concurrency. Extension point: gateway → *Issue claim & status monotonicity* (FAFF-82), where any concurrency hardening lands.
- **Changing the marker format itself.** Why excluded: the `<!-- faff-review-findings:<ISSUE-ID> -->` / close pair is settled by FAFF-202 and greppable/invisible as-is; only the *match predicate over* that format is tightened. Extension point: FAFF-202 spec §3 if the format ever needs to change.
- **Editing the consumer skills' prose.** Why excluded: the procedure is single-sourced in the gateway and the consumers refer back; a predicate tightening that keeps the same externally-visible shape needs no consumer edit. Extension point: the refer-back lines in `faff-graft` Step 9 and `faffter-dark-adversarial-review` step 3 if the contract's shape ever changes.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Open marker | The exact string `<!-- faff-review-findings:<ISSUE-ID> -->`, keyed by the tracker issue id. |
| Close marker | The exact string `<!-- /faff-review-findings:<ISSUE-ID> -->`. |
| Marker line | An open or close marker that occupies an entire line of the comment body on its own (optionally surrounded by whitespace), as opposed to appearing mid-line or quoted inside other text. |
| Structured match | The hardened predicate: the open marker appears as the **first marker line** of the body, not merely as a substring somewhere in it. |
| Impostor comment | A non-faff comment that merely *contains* the marker text — a human quote, a paste, or a discussion of the marker. |
| Update target | The single comment the locate procedure decides to splice the new verdict into. |

**The match predicate — current vs hardened.**

```
RECORD ReviewFindingsComment (identity test):
  marker_open:  "<!-- faff-review-findings:<ISSUE-ID> -->"    # exact, keyed by issue id
  marker_close: "<!-- /faff-review-findings:<ISSUE-ID> -->"   # exact

  # CURRENT (vulnerable) predicate:
  #   is_match(c)  :=  c.body CONTAINS marker_open          # substring anywhere → matches impostors

  # HARDENED predicate:
  #   is_match(c)  :=  first_marker_line(c.body) == marker_open
  #     where first_marker_line(body) = the first line that, after trimming surrounding
  #     whitespace, equals marker_open OR marker_close; structured match requires that
  #     first such line be marker_open.

  CONSTRAINT a genuine faff comment (marker_open authored as the body's first line) still matches
  CONSTRAINT a comment that mentions the marker only inside other text (quote/paste) does NOT match
  CONSTRAINT the legacy-truncated faff comment (open marker-line present, close missing) still matches and splices
```

**Design decision — what is the hardened match predicate?**

The three candidate hardenings from the ticket, weighed:

| Candidate | Effect | Verdict |
|---|---|---|
| Marker at body start (own line), not substring-anywhere | Rejects quotes/pastes that sit mid-body or inside quoted text; a genuine faff comment (marker is the first line) still matches | Primary fix |
| Require BOTH open + close markers present | Rejects an impostor that pastes only the open marker, but would also reject the legitimate legacy-truncated faff comment the splice rule already supports | Cannot be a blanket gate; folded in as a refinement (see HOW) |
| Prefer faff-authored comment by author identity | Strongest discriminator, but no portable cross-tracker author signal exists | Optional tie-breaker only, never required |

**Chosen:** harden the predicate to a **structured match** — the open marker must be the **first marker line** of the comment body (its own line at the top, modulo whitespace), not a bare substring anywhere. This is the minimal change that rejects every quote/paste impostor while a genuine faff comment (which authors the open marker as line one) matches unchanged, and it does **not** disturb the legacy-truncated splice path (that comment still has the open marker as its first marker line). The "both markers present" idea is folded in as a tie-breaker for the rare ambiguous case, not as a blanket gate; author identity is an optional, tracker-dependent tie-breaker only.

## 4. HOW — Behavior

**Architecture and approach.** One clause of the gateway `Review-findings comment identity` rule changes: the locate step's match definition. Everything downstream (create / update-in-place / oldest-wins reconcile / splice) is unchanged because it already operates on "the matched comment(s)" — only *which* comments qualify as matches is narrowed. The change is expressed in the gateway prose and its `marker_open(id)`-based pseudocode; the consumer skills inherit it by refer-back.

**Behavior summary.** At the terminal verdict, list the issue's comments and select as matches only those whose body **opens with** the marker line (first marker line == open marker), rather than those whose body merely contains the marker substring. Then create / update / reconcile exactly as the existing contract specifies.

```
PROCEDURE locate_review_findings_comment(issue_id, comments):
  1. matches := []
  2. FOR each comment c in comments:
       a. first := the first line of c.body that, trimmed of surrounding whitespace,
                   equals marker_open(issue_id) OR marker_close(issue_id)
                   (scanning top-down; lines that merely contain a marker inside other
                    text — e.g. a quoted "> <!-- faff-review-findings:... -->" or marker
                    text embedded in a sentence — are NOT marker lines)
       b. IF first exists AND first == marker_open(issue_id):
            append c to matches            # structured match: body opens with the marker
  3. RETURN matches      # feed to the unchanged create(0) / update(1) / reconcile(>1) cases
```

**Tie-break refinement when more than one comment structurally matches.** The existing `>1`-match reconcile is oldest-wins. The "both markers present" idea is added there as a *pre-oldest-wins* preference, not as a match gate: among structural matches, prefer a comment that contains BOTH a `marker_open` line and a `marker_close` line (a complete, well-formed faff comment) over one that has only the open marker line; if that still leaves more than one, fall back to oldest-`created_at` wins. Where the tracker exposes comment authorship, a comment authored by the faff agent may additionally be preferred — optional, never required, never the sole discriminator. This keeps the legacy-truncated comment (open line present, no close) eligible while making a complete faff comment win when both exist.

```
PROCEDURE choose_update_target(matches):     # only on len(matches) > 1
  1. complete := [c for c in matches if c.body has a marker_open line AND a marker_close line]
  2. pool := complete if complete is non-empty else matches
  3. (optional, tracker-permitting) prefer pool members authored by the faff agent
  4. RETURN oldest_by_created_at(pool)        # stable oldest-wins fallback, as today
```

**Edge cases and precedence:**

- **A human quotes the marker in a reply** (e.g. a markdown blockquote `> <!-- faff-review-findings:FAFF-207 -->`): the marker text is not a standalone marker line (it is prefixed by `> `), so the comment is **not** a structural match — correctly excluded.
- **A third party pastes the open marker mid-sentence or below their own text:** the first marker line is not at the top / the marker is embedded in other text, so the comment is **not** a structural match — correctly excluded.
- **A third party pastes the open marker as the literal first line of their own comment:** this is the residual ambiguous case — it is a structural match. It is bounded exactly as before: the splice preserves all text outside the marker pair, and the FAFF-82 posture caps the worst case at a wasted/duplicated write, never corruption. The tie-break refinement (prefer a complete, faff-authored comment) reduces but does not claim to eliminate this rare case — noted as a residual risk, not a gap.
- **Legacy-truncated faff comment** (open marker line present, close missing): still a structural match (first marker line is the open marker); the existing splice rule re-wraps `marker_open`→end with a fresh pair. Unchanged.
- **Zero structural matches but an unmarked human findings-like comment exists:** still create a new faff comment — the key is the structured marker, never content. Unchanged.

**Anti-patterns:**

- **Anti-pattern:** requiring both markers present as a hard match gate. Why: it would reject the legitimate legacy-truncated faff comment (open present, close hand-truncated) that the splice rule is designed to recover.
- **Anti-pattern:** making comment-author identity a required predicate. Why: no portable cross-tracker author signal exists; a hard author check breaks on trackers that don't expose it. It is an optional tie-breaker only.
- **Anti-pattern:** adding a CLI helper, lock, or stored comment-ID map to "fix" this. Why: out of proportion to a low-severity, already-bounded hazard, and FAFF-202 §2 explicitly deferred the CLI helper.
- **Anti-pattern:** treating a marker that appears inside a quote or mid-line as a match. Why: that is exactly the injection vector this ticket closes — only a top-of-body standalone marker line counts.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a comment whose body is a human reply quoting the open marker in a markdown blockquote
  (e.g. a line "> <!-- faff-review-findings:FAFF-207 -->")
When the locate procedure runs for FAFF-207
Then that comment is NOT selected as a match
  And, with no genuine faff comment present, a new faff review-findings comment is created
```

```
Given a third-party comment that pastes the open marker text in the middle of its own prose
When the locate procedure runs
Then that comment is NOT selected as a match (the marker is not the first marker line)
```

```
Given a genuine faff review-findings comment whose body opens with the marker line, plus a separate human comment that merely mentions the marker text
When the locate procedure runs
Then exactly the genuine faff comment is selected, and its faff region is updated in place
  And the human comment is left untouched
```

```
Given a legacy faff comment with the open marker line present but the close marker hand-truncated away
When the locate procedure runs
Then that comment is still selected as a match and spliced (re-wrapped with a fresh marker pair) per the existing splice rule
```

```
Given two comments both opening with the marker line — one complete (open+close), one open-only
When the >1-match tie-break runs
Then the complete comment is preferred as the update target, falling back to oldest-created when the preference does not disambiguate
```

## 6. DESIGN DECISION RATIONALE

**How should the match predicate be hardened against quoted/pasted marker text?**

- *Keep substring-anywhere (status quo):* simplest, but matches every quote/paste of the marker — the vulnerability itself.
- *Structured match (open marker is the first marker line of the body):* rejects quotes (prefixed/indented) and mid-body pastes, while a genuine faff comment — which authors the open marker as line one — matches unchanged; preserves the legacy-truncated path.
- *Require both markers present (hard gate):* rejects open-only pastes but also rejects the legitimate legacy-truncated faff comment the splice rule recovers — a regression.
- *Author-identity gate:* strongest, but no portable cross-tracker signal.
- **Chosen:** structured match (first marker line == open marker), with "both markers present" demoted to a `>1` tie-break and author identity demoted to an optional tracker-permitting tie-break. Minimal, proportionate to the low severity, and behaviour-preserving for every genuine faff comment.

**Where does the change live, and do the consumers need editing?**

- *Edit each consumer inline:* drift risk; violates the lean/deduplicated charter.
- *Single-source in the gateway, consumers refer back:* the predicate is already single-sourced in the gateway rule; tightening it there propagates to both consumers automatically because the externally-visible shape (locate → create/update/reconcile) is unchanged.
- **Chosen:** edit only the gateway `Review-findings comment identity` rule; leave the consumer refer-backs untouched.

**How to handle the residual "paste-at-body-start" case?**

- *Try to eliminate it (deep content heuristics, hashing, etc.):* disproportionate to a low-severity hazard already bounded by the splice rule and FAFF-82.
- *Bound it and name it:* the `>1` tie-break prefers a complete and (where available) faff-authored comment; the splice rule and FAFF-82 cap the worst case at a wasted write, never corruption.
- **Chosen:** bound-and-name — accept the rare residual, document it as a known-bounded risk, do not over-engineer it away.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Every decision above is closed with a `**Chosen:**` marker; the single residual hazard (a marker pasted as the literal first line of a foreign comment) is explicitly bounded by the existing splice rule and the FAFF-82 posture, not left open.

**Assumptions:**

- **Assumes:** the FAFF-202 comment-identity contract is present in the gateway on the branch being edited (the `Review-findings comment identity` section exists in `plugin/skills/faff/SKILL.md`). *Validate:* `grep -n "Review-findings comment identity" plugin/skills/faff/SKILL.md` returns the section; if absent, rebase onto `origin/main` before editing.
- **Assumes:** the consumer skills refer back to the gateway rule rather than restating the predicate. *Validate:* `grep -n "Review-findings comment identity" plugin/skills/faff-graft/SKILL.md plugin/skills/faffter-dark-adversarial-review/SKILL.md` shows refer-back lines, confirming no consumer carries a copy of the predicate that would also need editing.

## 8. DONE — Definition of Done

### From WHY
- [ ] The gateway match predicate no longer treats a comment that merely *contains* the marker substring as the faff comment; it requires the open marker to be the first marker line of the body.
- [ ] A genuine faff comment (open marker authored as the body's first line) still matches with no behaviour change.
- [ ] The fix is a prose-predicate tightening only — no CLI helper, lock/CAS, or stored comment-ID map is introduced.

### From WHAT (predicate)
- [ ] The gateway rule defines "structured match" as: first marker line of the body equals the open marker (whitespace-trimmed, on its own line), not substring-anywhere.
- [ ] Lines where the marker appears inside other text (quoted, indented, or mid-sentence) are documented as NOT marker lines.

### From HOW (behaviour)
- [ ] The locate step in the gateway pseudocode selects matches by the structured predicate; create(0)/update(1)/reconcile(>1) downstream is unchanged.
- [ ] The `>1` tie-break prefers a comment with both open and close marker lines, then falls back to oldest-`created_at` wins.
- [ ] The legacy-truncated splice path (open marker line present, close missing) still matches and is re-wrapped per the existing splice rule.
- [ ] Author identity is documented as an optional, tracker-permitting tie-breaker only — never a required predicate.

### From HOW (edge cases)
- [ ] A quoted marker (blockquote/indented) is documented and handled as a non-match.
- [ ] A mid-body pasted marker is documented and handled as a non-match.
- [ ] The residual "marker pasted as the literal first line of a foreign comment" case is documented as a known-bounded risk (splice rule + FAFF-82), not silently dropped.

### From single-sourcing
- [ ] Only the gateway `Review-findings comment identity` rule is edited; `faff-graft` Step 9 and `faffter-dark-adversarial-review` step 3 refer-backs are unchanged.

### Prose-quality gate
- [ ] `faff validate-adapters` passes (line caps, paragraph length, no stray markers, no duplicated blocks).
- [ ] The added prose is lean/deduplicated/skimmable per `docs/skill-authoring.md` — the predicate is stated once, in the gateway.

**Integration smoke test:**

```
1. Construct three comments for one issue: (a) a genuine faff comment whose body opens with the
   marker line and closes with the close marker; (b) a human reply quoting the open marker in a
   blockquote; (c) a third-party comment pasting the open marker mid-prose.
2. Run the hardened locate predicate.
3. ASSERT: only comment (a) is a structural match; (b) and (c) are excluded.
4. Run update-in-place with a new verdict body.
5. ASSERT: comment (a)'s faff region holds the new verdict; comments (b) and (c) are byte-identical
   to before; no new comment is created.
```

## 9. APPENDIX A — Match predicate reference

| Element | Current (vulnerable) | Hardened |
|---|---|---|
| Match test | body CONTAINS open marker (substring anywhere) | first marker line of body == open marker (own line, top of body) |
| Quoted marker (`> <!-- … -->`) | matches (bug) | not a marker line → excluded |
| Mid-body pasted marker | matches (bug) | not the first marker line → excluded |
| Genuine faff comment | matches | matches (unchanged) |
| Legacy-truncated faff comment (open line, no close) | matches | matches (unchanged) |
| `>1` tie-break | oldest-`created_at` wins | prefer complete (open+close) [+ faff-authored where available], then oldest-`created_at` |
