# Comment-identity contract for the collapse-and-log terminal review comment (FAFF-202)

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high — Full spec on the tracker issue.

This spec defines the **comment-identity contract** that makes "post (or update in place)" deterministic for the single terminal review-findings comment introduced by FAFF-184 (collapse-and-log) and located on the tracker issue by FAFF-185 (pre-PR findings surface). Audience: the build agent editing faff's skill prose, and the human reviewer gating the change. The deliverable is **prose edits to skill `SKILL.md` files** — a named identity convention plus a deterministic locate→create-or-update procedure — not runtime code.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-184's collapse-and-log policy tells graft to "post (or update in place) a **single** comment on the tracker issue" at the terminal review verdict, but never says *how* an agent finds the existing comment to update — there is no fixed marker string, comment ID, or idempotency key. The post-once-at-terminal-verdict guarantee means this is not a live defect today, but the moment update-in-place is exercised (re-running graft on the same issue, or a second orchestrator), the agent has no deterministic way to locate the prior comment, so it either silently duplicates or risks overwriting a human-edited body. This change names the identity and specifies the locate procedure so update-in-place is deterministic and human-safe.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Identity lives in the comment body, not in tracker metadata.** The Linear MCP (and the tracker-agnostic contract faff targets) exposes **no native idempotency-key parameter** on comment creation, and faff stores no comment-ID map (`.faffrc` holds stable config only, never mutable state — gateway → Configuration). So the idempotency key **must** be an in-body marker found by listing-and-matching. An implementation that relies on a stored comment ID or a tracker-native dedupe key is wrong.
- **The marker is structural and invisible.** It must survive markdown rendering without cluttering the human-facing comment (gateway → *understandable, not unapproachable*; the rendering-adaptor skimmability rule). A visible sentinel string is rejected: it leaks faff plumbing into the human's view.
- **Still exactly one comment — this only makes "the one" findable.** The granularity rule (gateway → *Tracker as the lights-out control plane* §2, FAFF-60) and the one-comment-per-build shape (FAFF-184) are unchanged. This contract adds no new comment, no per-pass marker, no new tracker write density.
- **Proportionate to a rare, bounded hazard.** Concurrent same-issue graft is already bounded to "a wasted duplicate build, never corruption" by the FAFF-82 issue-claim rule, which explicitly deems a heavier lock "unjustified for an event this rare." This contract therefore *references* that posture and adds a cheap reconcile, never a distributed lock.
- **Never silently destroy human text.** A human may edit the visible comment body to steer the build (gateway → *Human curation is authoritative*, FAFF-19, assertion 3). Update-in-place must not clobber human edits — the faff-owned region is delimited so human text outside it is preserved.

**Reference context:**

| System | Type | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` (Step 9 collapse-and-log + autonomous-mode Step 9 mirror) | skill prose | Primary edit site — the "(or update in place)" language being made deterministic |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (step 3, "Log each disposition") | skill prose | Folds its dispositions into the same terminal comment — refers back to the contract |
| `plugin/skills/faff/SKILL.md` (gateway) | skill prose | Single home for the locate/match/reconcile procedure shared by the two sites above |
| Gateway → *Issue claim & status monotonicity* (FAFF-82) | existing rule | The concurrency posture this contract leans on rather than rebuilds |
| Gateway → *Human curation is authoritative* (FAFF-19) | existing rule | Governs the human-edit-safety rule |
| `faff-contract:<name>` blocks, `> Spec:` provenance stamp (FAFF-44) | existing patterns | House precedent for fenced/structural in-body markers found mechanically |

**Scope statement.** This sits at the review-findings boundary of faff-graft Step 9 — between the review slot producing a terminal verdict and that verdict landing as the one tracker-issue comment.

## 2. OUT OF SCOPE

- **The one-comment-per-build shape** — settled by FAFF-184; this contract preserves it verbatim. Extension point: `faff-graft/SKILL.md` Step 9 collapse-and-log block.
- **The pre-PR-vs-PR findings surface** (findings go on the *tracker issue*, not a PR) — settled by FAFF-185; this contract assumes it. Extension point: `faff-graft/SKILL.md` Step 9 "Where findings go" block.
- **A hard mutex / distributed lock for concurrent same-issue builds** — FAFF-82 already covers the seam (the `In Progress` claim + status-monotonicity), and deems a heavier lock unjustified. Extension point: gateway → *Issue claim & status monotonicity* (FAFF-82) is where any future hardening lands.
- **A `faff` CLI helper for the locate/match** — the match operates over `list_comments` output, which is tracker-MCP-bound (the CLI is pure, no tracker access — gateway → Resolver). The marker *format* could later be CLI-emitted/validated, but no CLI piece is built here. Extension point: a future `faff review-comment-marker <issue>` emitter if validation is ever wanted.
- **Marker on any other faff-authored comment** (spec-attach, park, resolve-attempt) — those have their own single-write semantics and no update-in-place loop. Extension point: if any later grows an update loop, it adopts this same contract pattern with its own marker name.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Review-findings comment | The single tracker-issue comment carrying the terminal review verdict + "resolved N findings across M passes" summary + log pointer (FAFF-184). |
| Identity marker | A hidden, structural string embedded in the review-findings comment body that uniquely identifies it as *the* review-findings comment for a given issue. The idempotency key. |
| faff-owned region | The portion of the comment body delimited by the marker pair that faff authors and may rewrite. Text outside it is human-owned and preserved. |
| Locate | The deterministic procedure: list the issue's comments, find the one whose body contains the marker, and decide create-vs-update. |

**Identity marker — format.** A pair of HTML comments delimiting the faff-owned region, keyed by issue id:

```
<!-- faff-review-findings:<ISSUE-ID> -->
…faff-authored verdict + summary + log pointer…
<!-- /faff-review-findings:<ISSUE-ID> -->
```

```
RECORD ReviewFindingsComment:
  marker_open:  "<!-- faff-review-findings:<ISSUE-ID> -->"   # exact, ISSUE-ID is the issue identifier e.g. FAFF-202
  marker_close: "<!-- /faff-review-findings:<ISSUE-ID> -->"  # exact
  faff_region:  text between the markers          # faff rewrites ONLY this on update
  human_region: any text outside the marker pair  # preserved verbatim across updates

  CONSTRAINT exactly one ReviewFindingsComment per issue (the locate procedure enforces; reconcile collapses any duplicate)
  CONSTRAINT marker rendered invisibly (HTML comment) — never shown to a human reader
  CONSTRAINT ISSUE-ID is the tracker issue identifier, making the marker self-describing and greppable
```

- **Why a marker *pair*, not a single sentinel:** the closing marker delimits the faff-owned region so update-in-place can rewrite *only* faff's text and leave any human-added text (above the open marker or below the close marker) untouched — the human-edit-safety guarantee. A single-line marker can identify the comment but cannot bound what is safe to overwrite.
- **Why HTML comment, not a visible string or a label:** invisible in rendered markdown (skimmability), survives a human editing the visible body, greppable in `list_comments` output, and matches the house precedent (`> Spec:` provenance stamp is the same "structural anchor found by match" idea). A tracker label is rejected — labels are issue-level, not comment-level, so they cannot identify *which comment*.

**Design decision — what is the idempotency key?**

**Chosen:** A hidden HTML-comment marker pair `<!-- faff-review-findings:<ISSUE-ID> --> … <!-- /faff-review-findings:<ISSUE-ID> -->` embedded in the comment body, keyed by issue id. The marker *is* the idempotency key; identity lives in the body because the tracker exposes no native key (rationale in §6).

## 4. HOW — Behavior

**Build precondition (stale-checkout guard).** The collapse-and-log policy (FAFF-184) and the tracker-issue findings surface (FAFF-185) are **shipped on `origin/main`** but were not present in the checkout where this ticket was prepped (local `main` was 6 commits behind). Before editing, the implementer **rebases/pulls onto `origin/main`** so the edits land on the real shipped Step 9 prose, not a stale local copy. faff-graft builds in a worktree off the current branch — confirm the "(or update in place)" text from FAFF-184/185 is present (`grep "or update in place" plugin/skills/faff-graft/SKILL.md`) before editing; if absent, the branch is stale.

**Architecture and approach.** The locate→create-or-update procedure is the deterministic core. It is **single-sourced in the gateway** as a named shared rule (it is shared by graft Step 9 and the adversarial reviewer's step 3), with both sites referring back to it rather than duplicating it (gateway → authoring discipline; the lean/deduplicated charter). graft Step 9 invokes it at the terminal verdict; the adversarial reviewer's "log to tracker" step points at the same rule since its dispositions fold into the same comment.

**Behavior summary.** At the terminal review verdict, the agent lists the issue's comments, matches on the marker, and either creates a new review-findings comment (zero matches) or rewrites only the faff-owned region of the existing one (one match) — collapsing any rare duplicate to a single comment by an oldest-wins tie-break.

```
PROCEDURE post_or_update_review_findings(issue_id, faff_body):
  1. comments := list_comments(issue_id)                       # tracker MCP, live read
  2. matches  := [c for c in comments if c.body CONTAINS marker_open(issue_id)]
  3. CASE len(matches):
     0 →  # first write for this issue
          body := marker_open(issue_id) + "\n" + faff_body + "\n" + marker_close(issue_id)
          save_comment(issueId=issue_id, body=body)            # CREATE
     1 →  # update in place — rewrite ONLY the faff-owned region
          target := matches[0]
          new_body := splice_faff_region(target.body, issue_id, faff_body)   # see splice rule
          save_comment(id=target.id, body=new_body)            # UPDATE
     >1 → # rare duplicate (concurrent create race) — reconcile, do not error
          target  := oldest_by_created_at(matches)             # oldest-wins tie-break
          new_body := splice_faff_region(target.body, issue_id, faff_body)
          save_comment(id=target.id, body=new_body)            # update the survivor
          # the other duplicate(s) are left in place, untouched (human-legible audit trail);
          # NOT deleted (autonomous delete is forbidden — appetite hard floor).
```

**The splice rule (human-edit safety).**

```
PROCEDURE splice_faff_region(existing_body, issue_id, faff_body):
  1. IF existing_body contains BOTH marker_open and marker_close:
       replace the text BETWEEN them with faff_body;
       preserve everything before marker_open and after marker_close verbatim.
  2. ELSE IF existing_body contains marker_open but NOT marker_close (legacy / hand-truncated):
       treat from marker_open to end-of-body as the faff region; re-wrap it with a fresh marker pair;
       preserve everything before marker_open verbatim.
  3. Return the spliced body. NEVER discard text outside the faff-owned region.
```

**Edge cases and precedence:**

- **Zero matches but a human posted an unmarked findings-like comment** → still create (the contract keys on the marker, not on content heuristics). A human's unmarked comment is human-owned and never adopted as the faff comment.
- **`>1` match** → oldest-wins (deterministic, stable, audit-friendly: the first comment posted is the canonical one; later races are the anomalies). Update the survivor, leave the rest.
- **Human edited inside the faff region** → on the next update that edit is overwritten (it is in faff's region) — but the human-safe path is to edit *outside* the markers, which is preserved. The markers tell the human where faff's text is.
- **Marker present but malformed/partial** → splice rule step 2 re-establishes a clean marker pair without losing human text.

**Anti-patterns:**

- **Anti-pattern:** storing the comment ID in `.faffrc` or a `.faff/` file to find it later. Why: `.faffrc` is stable-config-only (gateway), and a per-issue ID map is mutable state faff deliberately does not keep; the body marker is the single source of identity.
- **Anti-pattern:** deleting duplicate comments on the `>1` path. Why: autonomous delete is forbidden at every appetite level (gateway → appetite hard floor); leaving duplicates is a visible, human-clearable anomaly, not corruption.
- **Anti-pattern:** building a lock/CAS for the concurrent-create race. Why: FAFF-82 already bounds the hazard to a wasted duplicate (reconciled here), and explicitly deems a heavier lock unjustified — *proportionate, minimal*.
- **Anti-pattern:** a visible sentinel like `[faff-review-findings]` in the rendered body. Why: leaks plumbing into the human view; the HTML comment is invisible yet greppable.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a review-findings comment already exists on the issue (carrying the marker pair)
When graft reaches a terminal verdict on a re-run of the same issue
Then exactly one review-findings comment exists afterward, and its faff-owned region holds the new verdict
  And no new comment was created
```

```
Given the existing review-findings comment has human-authored text below the closing marker
When graft updates the comment in place
Then the faff-owned region is rewritten with the new verdict
  And the human-authored text below the closing marker is preserved verbatim
```

```
Given two concurrent graft runs both saw zero matches and each created a review-findings comment (the rare FAFF-82 race)
When a later graft run reaches a terminal verdict on the same issue
Then it updates the oldest of the duplicate comments
  And leaves the other duplicate in place (not deleted)
  And the run does not error
```

```
Given the rendered review-findings comment as a human reads it
Then the identity marker is not visible in the rendered markdown
```

Non-functional assertion: the contract adds **no** new tracker comment, no per-pass marker, and no new `.faffrc`/`.faff/` artefact — comment-write density is unchanged from FAFF-184 (one comment per build).

## 6. DESIGN DECISION RATIONALE

**What carries the idempotency key — body marker vs tracker metadata vs stored ID map?**
- *Tracker-native key:* clean if it existed — but Linear's MCP exposes no idempotency-key param on comment create, and faff targets multiple trackers, so no portable native key exists.
- *Stored comment-ID map (`.faffrc`/`.faff/`):* mutable per-issue state faff deliberately does not keep; brittle across machines/clones (multi-orchestrator).
- *In-body marker:* portable, tracker-agnostic, found by the `list_comments` the agent already pulls, matches house precedent.
- **Chosen:** in-body HTML-comment marker pair — identity lives in the body, found by list-and-match. Tracker-agnostic and stateless, the only option that holds for any MCP tracker.

**Marker form — single sentinel vs delimiter pair vs visible label?**
- *Single hidden sentinel:* identifies the comment but cannot bound a safe-to-overwrite region → can't protect human edits.
- *Visible label string:* clutters the human view (skimmability violation).
- *Tracker label:* issue-level, can't point at a specific comment.
- **Chosen:** a hidden HTML-comment **pair** delimiting the faff-owned region — identifies the comment *and* bounds what update-in-place may rewrite, invisible to the reader, greppable.

**Concurrent-create race — lock vs re-read-before-write vs accept-and-reconcile?**
- *Distributed lock / CAS:* over-engineered; the tracker MCP has no CAS, and FAFF-82 deems a heavier lock unjustified for an event this rare.
- *Re-read immediately before write:* narrows but cannot close the window (no CAS), adds a fetch for negligible gain.
- *Accept-and-reconcile:* the duplicate is bounded (FAFF-82: "a wasted duplicate build, never corruption"); the next run's oldest-wins reconcile collapses it; duplicates are left visible for a human.
- **Chosen:** accept-and-reconcile with an oldest-wins tie-break, referencing the FAFF-82 claim rather than rebuilding it — proportionate to a rare, already-bounded hazard.

**Human-edit safety — wholesale overwrite vs region-scoped splice?**
- *Wholesale overwrite:* simplest, but clobbers human steering edits (violates Human-curation-authoritative).
- *Region-scoped splice:* faff rewrites only between its markers; human text outside is preserved.
- **Chosen:** region-scoped splice — never discards text outside the faff-owned region, honouring gateway → *Human curation is authoritative* assertion 3.

**Where the contract is documented — inline in graft vs single-sourced in the gateway?**
- *Inline in graft:* duplicated into the adversarial reviewer too → drift risk (the lean/deduplicated charter forbids copied prose).
- *Gateway shared rule:* one home, two refer-backs (graft Step 9, adversarial step 3).
- **Chosen:** single-source the locate/match/splice/reconcile procedure as a named gateway rule; graft and the adversarial reviewer refer back to it. (graft Step 9 keeps the marker *format* shown inline since it is the primary author of the comment, but the *procedure* is the gateway's.)

**Tie-break direction — oldest vs newest wins?**
- *Newest-wins:* the freshest comment survives, but "freshest" in a race is arbitrary and the survivor's identity flips run-to-run.
- *Oldest-wins:* the first-posted comment is canonical and stable across reconcile passes; the anomalies are the later duplicates.
- **Chosen:** oldest-wins — stable and audit-friendly.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Every decision above is closed with a `**Chosen:**` marker; the residual hazards are bounded by existing settled rules (FAFF-82, FAFF-19) that this contract cites rather than reopens.

**Assumptions:**

- **Assumes:** the collapse-and-log policy (FAFF-184) and the tracker-issue findings surface (FAFF-185) are present on the branch being edited. *Validate:* `grep -n "or update in place" plugin/skills/faff-graft/SKILL.md` returns the Step 9 collapse-and-log block; if absent, rebase onto `origin/main` first (the prep checkout was 6 commits behind).
- **Assumes:** the tracker MCP's comment-create accepts a free-form markdown body and its comment-update accepts `(id, body)` (Linear's `save_comment` does both). *Validate:* confirm the configured tracker's MCP exposes create-and-update-by-id for comments; if a tracker offers a native idempotency/dedupe key, it may *additionally* be used, but the body marker remains the portable contract.

## 8. DONE — Definition of Done

### From WHY
- [ ] The terminal review-findings comment carries a deterministic identity so update-in-place can locate it without a stored ID or tracker-native key.
- [ ] The contract states it preserves the one-comment-per-build shape (FAFF-184) and the FAFF-60 granularity rule, citing both.

### From WHAT (identity + interfaces)
- [ ] graft Step 9 states the marker format explicitly: the `<!-- faff-review-findings:<ISSUE-ID> --> … <!-- /faff-review-findings:<ISSUE-ID> -->` pair, keyed by issue id, rendered invisibly.
- [ ] The marker is documented as a hidden HTML comment (not a visible string, not a tracker label).

### From HOW (behaviour)
- [ ] The locate→create-or-update procedure is specified: list comments → match marker → 0 ⇒ create, 1 ⇒ update-in-place.
- [ ] The `>1`-match reconcile is specified with an explicit oldest-wins tie-break, and states duplicates are left (not deleted).
- [ ] The splice rule is specified: update rewrites only the faff-owned region; text outside the marker pair is preserved verbatim.
- [ ] The concurrency posture references gateway → *Issue claim & status monotonicity* (FAFF-82) rather than introducing a lock/CAS.
- [ ] The human-edit-safety rule references gateway → *Human curation is authoritative* (FAFF-19).

### From HOW (single-sourcing + refer-backs)
- [ ] The locate/match/splice/reconcile procedure is single-sourced as a named gateway rule in `plugin/skills/faff/SKILL.md`.
- [ ] `faff-graft/SKILL.md` Step 9 (collapse-and-log block **and** the autonomous-mode Step 9 mirror) refer back to the gateway rule.
- [ ] `faffter-dark-adversarial-review/SKILL.md` step 3 refers back to the same rule (its dispositions fold into the same marked comment).

### From HOW (build precondition)
- [ ] Edits land on the FAFF-184/185 shipped Step 9 prose (branch rebased onto `origin/main`; the "or update in place" text is present before editing).

### From edge cases
- [ ] Unmarked human findings-like comment ⇒ create (never adopted as the faff comment).
- [ ] Partial/malformed marker ⇒ splice rule re-establishes a clean pair without losing human text.

### Prose-quality gate
- [ ] `faff validate-adapters` passes (line caps, paragraph length, no stray markers, no duplicated blocks).
- [ ] The added prose is lean/deduplicated/skimmable per the skill-authoring charter (`docs/skill-authoring.md`): bullets/tables over prose walls, the procedure stated once in the gateway.

**Integration smoke test:**

```
1. On an issue with an existing marked review-findings comment, run the locate procedure with a new verdict body.
2. ASSERT: comment count unchanged; the single comment's faff region now holds the new verdict; any text outside the marker pair is byte-identical to before.
3. On an issue with no review-findings comment, run the procedure.
4. ASSERT: exactly one comment created, carrying the marker pair, invisible in the rendered view.
```

## 9. APPENDIX A — Marker reference

| Element | Exact form | Notes |
|---|---|---|
| Open marker | `<!-- faff-review-findings:<ISSUE-ID> -->` | `<ISSUE-ID>` = tracker identifier, e.g. `FAFF-202` |
| Close marker | `<!-- /faff-review-findings:<ISSUE-ID> -->` | delimits the faff-owned region |
| faff-owned region | text between the markers | the only text update-in-place rewrites |
| Match predicate | comment body contains the open marker for this issue | the idempotency-key test |
| Tie-break (`>1`) | oldest `created_at` wins | survivor updated; others left in place |

confidence: high
