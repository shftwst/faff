# Catch finding-tickets left open after their fixes merge elsewhere

> Spec: faffter-dark-nlspec · 2026-07-22 · interactive · confidence: high. Full spec on Linear FAFF-569.

> Revised 2026-07-22 — folded in the settled FAFF-565 disposition convention (Done-with-comment-trail, never Duplicate; recorded in this ticket's comment thread), then corrected the write-side scoping rationale per spec-review: the boundary is a deliberate authority choice, not an appetite-hard-floor mandate (the floor bars cancel/delete; the convention's Done-close is a forward move it does not cover). No design outcome changed.

This spec defines a **read-side tidy diagnostic** that flags a finding-ticket still sitting open when its fix appears to have already shipped under a different ticket number. Audience: the build agent implementing the diagnostic (a deterministic correlation helper plus a new `faff-tidy` structural-diagnostics category) and human reviewers of the surfaced candidates.

## 1. WHY — Problem and Principles

**The load-bearing model.** A *finding-ticket* is a bug captured from an autonomous run's findings log — it carries a durable **findings-log anchor** (the log path plus a `finding F<n>` id) in its description. When someone later fixes that bug, the fix frequently ships under a *different* ticket number (a split child, a re-scoped slice, or an independently-filed fix). Nothing today walks back from the merged fix to the original finding-ticket and notices it is now stale, so the finding-ticket keeps showing as open — often Urgent — long after the code is on `main`.

**Problem statement.** Stale finding-tickets poisoned the 2026-07-20 L4-capabilities audit: FAFF-552/551/550 read as open urgent gate-integrity bugs while their fixes were already merged (FAFF-558/560, FAFF-556/557/559, FAFF-545 respectively). A stale Urgent ticket corrupts every `/faff-wtf`, `/faff-map`, and `faff next` read that trusts the tracker. This change makes a tidy pass surface such tickets automatically, so an audit never has to catch them by hand again.

**Design principles.**

- **Deterministic evidence over inference.** The primary match is a mechanical string/graph correlation (a shared findings-log anchor, a tracker relation to a Done fix), honouring faff's *deterministic tools over prose* tenet. Symptom-text similarity is a genuine-judgement recall booster layered *on top*, never the sole basis for a flag — so a surfaced candidate always cites at least one concrete piece of evidence a human can check in seconds.
- **Surface, never close.** The diagnostic only *reports* candidates; a human dispositions them. Write authority is deliberately out of this slice — a scoping choice, not a floor mandate: the settled convention (FAFF-565, 2026-07-22 — close Done with a comment trail, never Duplicate) closes findings as **Done**, a forward status move the appetite hard floor does not forbid (the floor bars cancel/delete). What keeps disposition human is that it needs judgement-bearing evidence (case 2 requires verifying the symptom is actually gone, not just correlating references) and a deliberate grant of authority to close tickets the pipeline didn't build — a grant no human has made; the issue itself names the read-side diagnostic as the smaller first step.
- **The anchor is an opaque identity key, not a file to read.** A findings-log path may live in a *different* repo (the P2 findings log is under `shftwst/faff-suts-p2-task-api`) and `.faff/logs/` is gitignored, so the log file is often absent locally. Match on the anchor *string* as an identity; never require reading the log's contents.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-tidy/SKILL.md` → §5 Structural diagnostics | prose skill | The host for the new category; established detect→surface pattern (splittable specs, chain gaps, orphaned+repeat-parked) |
| `plugin/skills/faff/bin/lib/next.js`, `contain.js` (pattern) | Node CLI | The pure-function CLI idiom — no tracker access; the agent supplies fetched data, the CLI computes a verdict |
| `plugin/skills/faff/bin/faff` (dispatch) | Node CLI | Where a new `faff <verb>` subcommand registers |
| Finding-ticket FAFF-552 description | tracker | Proves the anchor convention: cites `.faff/logs/2026-07-18/225751-beep-boop-findings.md (finding F3)` |
| Fix spec `docs/specs/2026-07-19-faff-556-...design.md` | committed spec | Proves fix-side citation: "parent FAFF-551, finding F2" |
| FAFF-569 comment "Disposition convention…" (2026-07-22) | tracker | The settled FAFF-565 convention the diagnostic's render points candidates at |

**Scope statement.** This is a new detection category inside the existing `/faff-tidy` structural-diagnostics pass, backed by one new deterministic correlation helper — it adds no new runnable system or deployment surface.

## 2. OUT OF SCOPE

- **Write-side reconcile / auto-disposition.**
  - *Why excluded:* a deliberate slice choice, not a floor mandate. The settled convention (FAFF-565: Done-with-comment-trail, never Duplicate, two-case rule) closes findings as Done — a forward move the appetite hard floor does not forbid (it bars cancel/delete) — but granting the pipeline authority to close tickets it didn't build, on correlation evidence plus case-2 symptom-gone verification judgement, is a human authority decision that has not been made. The issue itself names the read-side diagnostic as the smaller first step.
  - *Extension point:* a future `faff reconcile`-style verb can consume this diagnostic's candidate output and apply the settled FAFF-565 convention (Done + the case-appropriate comment trail) under human confirmation — and, if that authority is ever granted, autonomously for case-1 shapes whose evidence is fully deterministic.
- **A fix-time "resolves finding" authoring convention** (e.g. a `Resolves-Finding:` trailer authored into fix PRs/commits).
  - *Why excluded:* it requires changing the graft/commit authoring flow and only helps fixes authored *after* adoption — the mechanism must work on the corpus of already-merged fixes that never used it.
  - *Extension point:* `faff-graft`'s commit/PR-body assembly could emit the trailer; the correlation helper would then treat it as a first-class deterministic anchor.
- **Reading findings-log file contents** to re-derive symptoms.
  - *Why excluded:* logs are cross-repo and often absent locally; the anchor string is sufficient identity.
  - *Extension point:* a symptom-index built at findings-filing time, if richer matching is ever needed.
- **Backfilling anchors onto legacy finding-tickets that lack one.**
  - *Why excluded:* a ticket with no anchor and no relation is only reachable by symptom similarity, which stays advisory; rewriting historical descriptions is a separate cleanup.
  - *Extension point:* a one-off tidy sweep, not this durable mechanism.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Finding-ticket | An open (non-terminal) tracker issue whose description carries a findings-log anchor — the durable record of a bug found by an autonomous run |
| Findings-log anchor | The pair `{ log_path, finding_id }` extracted from a ticket, e.g. `.faff/logs/2026-07-18/225751-beep-boop-findings.md` + `F3` |
| Fix-side artifact | A merged commit message, a linked/merged PR body, or a committed spec under the spec-docs path — any place a shipped fix names what it resolved |
| Resolved-elsewhere candidate | A finding-ticket for which evidence indicates its fix has merged under a *different* ticket, while the finding-ticket is still open |

**The anchor grammar (extraction).** A finding-ticket is identified — and its anchor extracted — by matching its description against:

```
log_path   := a path ending in "-findings.md" (typically ".faff/logs/<date>/<time>-beep-boop-findings.md")
finding_id := /\bfinding\s+F(\d+)\b/i   → "F<n>"   (optional; a ticket may cite a log with no F-id)
```

A ticket with a `log_path` match is a finding-ticket. The `(log_path, finding_id)` pair is its anchor. Absent a `log_path`, the ticket is not anchor-identifiable (symptom-similarity only — advisory).

**Type definitions.**

```
RECORD FindingTicket:
  id: IssueId                 # e.g. "FAFF-551"
  status: string              # live tracker status; must be non-terminal to be a candidate
  anchor: Anchor | null       # extracted from description; null ⇒ symptom-only
  title: string
  symptom_text: string        # title + description, for similarity fallback

RECORD Anchor:
  log_path: string            # opaque identity key; NOT read as a file
  finding_id: string | null   # "F<n>" or null

RECORD FixEvidence:
  kind: ENUM{ anchor-coref, tracker-relation, symptom-similarity }
  fix_ref: string             # the merged fix's ticket id / PR # / commit sha / spec path
  detail: string              # the matched anchor string, relation type, or similarity note
  merged: bool                # the fix is actually shipped (merged/Done), not just open

RECORD ResolvedElsewhereCandidate:
  finding: IssueId
  evidence: List<FixEvidence> # non-empty; ranked deterministic-first
  strength: ENUM{ strong, weak }  # strong ⇒ ≥1 deterministic evidence with merged==true
```

**The correlation helper (new deterministic CLI).** A pure subcommand in the bundled `faff` CLI, matching the `faff next` / `faff eligible` / `faff contain` idiom — **no tracker access; the agent supplies fetched data on stdin, the CLI computes and emits the correlation on stdout.**

```
faff findings-reconcile --stdin
  # stdin: JSON { finding_tickets: [FindingTicket], fix_corpus: [FixRecord] }
  #   FixRecord := { ref, merged: bool, source_ticket: IssueId|null,
  #                  anchors: [string], cited_ticket_ids: [IssueId], text: string }
  # stdout: JSON { candidates: [ResolvedElsewhereCandidate] }
  # exit 0 on success; exit 2 on malformed input (fail-loud, never a silent empty result)
```

The CLI performs the two **deterministic** correlations (anchor co-reference and tracker/citation relation). It does **not** compute symptom similarity — that is the LLM layer tidy adds (see HOW). The `--selftest` flag runs a fixture table, per the CLI convention.

## 4. HOW — Behavior

**Architecture and approach.** Tidy already fetches the full active backlog fresh each pass (Always-pull-fresh). The new category runs inside §5 Structural diagnostics:

1. Tidy identifies finding-tickets from the fetched issues (anchor grammar over descriptions).
2. Tidy assembles a **fix corpus**: Done/merged tickets and their linked PRs, plus the committed specs under the spec-docs path — annotating each with its anchors, cited ticket-ids, and text. (Sources tidy already has access to: tracker relations from the fresh fetch; committed specs via a repo glob; PR/commit text via the git host it already reads.)
3. Tidy pipes `{ finding_tickets, fix_corpus }` to `faff findings-reconcile` for the deterministic correlations.
4. For finding-tickets the helper did **not** already mark `strong`, tidy applies **symptom-similarity** (genuine LLM inspection) between the finding's `symptom_text` and merged fixes, adding `symptom-similarity` evidence where a clear semantic match exists.
5. Tidy renders the candidates in its `### Structural diagnostics` output as **surface-only**, each with its evidence and a pointer to the settled FAFF-565 disposition convention — close Done with a comment trail, never Duplicate: case 1 (fix shipped under the finding's own decomposition — deliverable → resolver → PR/SHA table) or case 2 (unrelated resolver — resolver + PR + SHA, relationship stated, verification evidence cited).

**Deterministic correlation (in the helper).**

```
PROCEDURE correlate(finding_tickets, fix_corpus):
  candidates := []
  FOR each ft in finding_tickets WHERE ft.status is non-terminal:
    evidence := []
    FOR each fx in fix_corpus:
      # (a) anchor co-reference — strongest signal
      IF ft.anchor != null AND ft.anchor.log_path in fx.anchors:
         # tighten with finding_id when both present; log-path-only still counts
         match := ft.anchor.finding_id == null
                  OR fx.text mentions ft.anchor.finding_id
                  OR fx.anchors names the same finding_id
         IF match: evidence += FixEvidence{ anchor-coref, fx.ref, ft.anchor, fx.merged }
      # (b) tracker/citation relation — the fix names the finding-ticket itself
      IF ft.id in fx.cited_ticket_ids OR fx.source_ticket == ft.id:
         evidence += FixEvidence{ tracker-relation, fx.ref, "<relation/citation>", fx.merged }
    IF evidence non-empty:
      strength := (any e in evidence has e.merged == true AND e.kind != symptom-similarity)
                  ? strong : weak
      candidates += ResolvedElsewhereCandidate{ ft.id, evidence, strength }
  RETURN candidates
```

**Behavior summary.** The helper walks each open finding-ticket against the fix corpus, collecting deterministic evidence that a *merged* fix corresponds to it — either by sharing the finding's log anchor or by naming the finding-ticket's id. A candidate is `strong` only when at least one deterministic evidence item is backed by an actually-merged fix.

**The self-reference guard (anti-false-positive).** A fix that ships under the finding-ticket's *own* number is the ticket being worked normally, not "resolved elsewhere." Exclude any `FixRecord` whose `source_ticket` or `ref` **is** the finding-ticket itself, and only flag when the corresponding evidence points at a *different* ticket number.

- **Anti-pattern:** flagging a finding-ticket because its own direct PR merged. Why: that is the normal build→merge path; the tracker status will follow. This diagnostic is for fixes that shipped under an *unlinked, different* id.

**Edge cases and error handling.**

- **Anchor cited by an unmerged/open fix** → still surfaced, but `merged==false` keeps it out of `strong`; rendered as a weak candidate ("a fix referencing this finding is in flight").
- **Multiple fixes for one finding** (FAFF-551 → FAFF-556/557/559) → all matching evidence items attach to the single candidate; the finding is surfaced once with the full fix set.
- **Finding-ticket already terminal** (Done/Cancelled) → never a candidate (guarded by the non-terminal status filter, computed from the *live* fetch).
- **Malformed stdin** → helper exits 2 (fail-loud); tidy logs the fault and skips the category for the pass rather than emitting a silent empty result.
- **No anchor, no relation** → reachable only by symptom-similarity; always `weak`, always advisory.

**Failure modes.**

- **The failure:** anchor co-reference under-fires because real fixes rarely re-cite the findings-log path (they cite the finding-*ticket* id instead). **How you'd know:** on the known incident corpus, the `anchor-coref` evidence kind is empty while `tracker-relation` carries every true match. **What it means:** proceed — the design already ranks tracker/citation relation as a co-equal deterministic signal, precisely because fix-side artifacts cite the ticket id more reliably than the raw log path; anchor-coref is the belt to that braces.
- **The failure:** symptom-similarity floods weak false positives (two unrelated budget bugs read as "the same"). **How you'd know:** the `weak`/`strong` ratio skews heavily weak and human dispositions reject most weak candidates. **What it means:** narrow — similarity only ever produces `weak`, is rendered separately, and can be gated tighter or dropped without touching the deterministic core.

## 5. SCENARIOS — born-verifiable main objectives

```
Given an open finding-ticket FAFF-551 whose description cites a findings-log anchor,
  and merged fix-tickets FAFF-556/557/559 (different numbers) that cite FAFF-551 / the same finding id,
When a tidy structural-diagnostics pass runs,
Then FAFF-551 is surfaced as a strong resolved-elsewhere candidate citing all three merged fixes,
  and it is not auto-closed.
```

```
Given a finding-ticket FAFF-552 whose only merged PR is its own direct fix (#440, source FAFF-552),
When the diagnostic runs,
Then FAFF-552 is NOT surfaced as resolved-elsewhere (self-reference guard),
  because the evidence points only at its own ticket number.
```

```
Given a finding-ticket whose fix has merged but is linked only by near-identical symptom text (no anchor, no id citation),
When the diagnostic runs,
Then it is surfaced as a weak (advisory) candidate in a separate sub-list, citing the symptom-similarity evidence.
```

- The `faff findings-reconcile --selftest` fixture table passes, covering: anchor-coref (log-path + finding-id), tracker-relation, self-reference exclusion, unmerged-fix downgrade, and malformed-input exit 2.

## 6. DESIGN DECISION RATIONALE

**Read-side tidy diagnostic vs write-side `faff reconcile` extension?**
- *Read-side diagnostic:* smaller, fits tidy's existing detect→surface §5 pattern, and defers the disposition-authority question rather than forcing it.
- *Write-side reconcile:* would auto-link and disposition. The convention's Done-close is a forward status move the appetite hard floor does not forbid (the floor bars cancel/delete) — but auto-closing tickets the pipeline didn't build, on correlation evidence plus case-2 symptom-gone verification judgement, is an authority grant that needs a deliberate human decision, not an inference from floor silence.
- **Chosen:** read-side tidy diagnostic — rationale: the issue itself names it as the smaller first step, the codebase offers a ready home with the exact surfacing pattern, no `faff reconcile` surface exists to extend, and write-side disposition is an authority grant no human has made — a deliberate scope boundary. (At spec time the unsettled disposition convention was an additional blocker; FAFF-565 has since settled it — Done-with-comment-trail, never Duplicate — which makes a future write-side slice concrete without changing this choice.) Resolved at appetite `high` from clear codebase fit rather than punted. Write-side left as a documented extension point (§2).

**What does the match key on?**
- Options: (a) findings-log path references, (b) symptom-text similarity, (c) a fix-time "resolves finding" authoring convention.
- Evidence: finding-tickets demonstrably carry a findings-log anchor (FAFF-552); fix-side artifacts demonstrably cite the source finding-ticket id + finding-id (FAFF-556 spec, `fix(FAFF-NNN):` commits). Option (c) needs authoring-flow change and helps only future fixes.
- **Chosen:** a two-signal deterministic core — findings-log **anchor co-reference** and **tracker/citation relation to a merged fix** — with **symptom-similarity as an advisory (weak-only) recall layer**, and the "resolves finding" authoring convention explicitly deferred (§2). Rationale: honours *deterministic tools over prose*, works on the already-merged corpus, and every surfaced candidate carries checkable evidence.

**A new `faff findings-reconcile` CLI vs inline prose correlation in tidy?**
- **Chosen:** a pure `faff` subcommand for the deterministic half — rationale: matches the `faff next`/`eligible`/`contain` pure-function idiom (no tracker access; agent supplies data, CLI computes), makes the correlation testable via `--selftest`, and keeps the LLM strictly to the genuine-judgement symptom-similarity layer.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. (The disposition convention is settled — FAFF-565, 2026-07-22: close Done with a comment trail, never Duplicate, two-case rule, recorded in this ticket's comment thread. This diagnostic surfaces candidates and points the human at that convention; adopting it in a write-side verb — and whether that verb ever gets close authority — is the §2 extension point, not this slice.)

**Assumptions.**

- **Assumes:** `/faff-tidy`'s structural-diagnostics pass already fetches the full active backlog with tracker relations, and can read committed specs under the spec-docs path and merged-PR/commit text via the git host it uses. *Validate:* confirm tidy §5 has the fetched issue set + relations in hand and that the spec-docs glob + git-host reads are available at that point before wiring the fix-corpus assembly.
- **Assumes:** the bundled `faff` Node CLI is the right home for a new pure subcommand and registers verbs in `plugin/skills/faff/bin/faff` with lib modules under `bin/lib/`. *Validate:* confirm the dispatch table and `--selftest` convention in `bin/faff` before adding `findings-reconcile`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A tidy structural-diagnostics pass surfaces an open finding-ticket whose fix merged under a different ticket number, with checkable evidence, without closing it.

### From WHAT (types and interfaces)
- [ ] Anchor grammar extracts `{ log_path, finding_id }` from a finding-ticket description (log path ending `-findings.md`; `finding F<n>` case-insensitive; finding-id optional).
- [ ] `faff findings-reconcile` reads `{ finding_tickets, fix_corpus }` on stdin and emits `{ candidates: [ResolvedElsewhereCandidate] }` on stdout; exit 0 success, exit 2 on malformed input.
- [ ] Each candidate carries non-empty `evidence` ranked deterministic-first and a `strong`/`weak` strength per the merged-deterministic rule.

### From HOW (behaviour)
- [ ] Anchor co-reference matches a finding's `log_path` against a fix record's anchors, tightening on `finding_id` when both are present.
- [ ] Tracker/citation relation matches when a merged fix names the finding-ticket's id (`cited_ticket_ids` or `source_ticket`).
- [ ] Symptom-similarity evidence is applied by tidy (not the CLI) only to findings not already `strong`, and only ever yields `weak` candidates.
- [ ] Candidates render surface-only in `### Structural diagnostics`, each pointing at the settled FAFF-565 disposition convention (Done with comment trail, never Duplicate — naming which of the two cases applies when determinable); nothing is auto-closed/cancelled.

### From HOW (edge cases)
- [ ] Self-reference guard: a finding-ticket whose only evidence points at its own number is not surfaced.
- [ ] An unmerged fix referencing a finding is surfaced but never `strong`.
- [ ] Multiple fixes for one finding collapse into a single candidate carrying all evidence.
- [ ] A terminal (Done/Cancelled) finding-ticket, judged from the live fetch, is never a candidate.
- [ ] Malformed helper input exits 2 and tidy skips the category for the pass (no silent empty result).

### Eval coverage
- [ ] The symptom-similarity step is an LLM-judgement seam: register its grader KIND + ≥1 eval case + the seam-registry row in this ticket. (Baseline acceptance is a separate human step.)

**Integration smoke test.**
```
Feed the known incident as a fixture: finding_tickets=[FAFF-551 with anchor],
  fix_corpus=[FAFF-556/557/559 merged, citing FAFF-551].
Run faff findings-reconcile → expect one strong candidate for FAFF-551 citing three merged fixes.
Then run the tidy category over the same data → FAFF-551 appears once under Structural diagnostics, surface-only.
```

confidence: high
spec-review: approve
