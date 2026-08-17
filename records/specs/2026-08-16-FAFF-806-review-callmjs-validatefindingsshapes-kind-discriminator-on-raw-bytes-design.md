# FAFF-806 — Classify the review-chain `kind` discriminator on the backend's raw bytes, not post-normalisation content

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-806.

This is the buildable design spec for Linear issue FAFF-806. Its audience is the build agent that will change `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`, and the human reviewers who gate that change. It is a high-level design plus a testable Definition of Done — not a diff. The change is a small, contained re-ordering inside one function, but it sits on an invariant that another shipped spec (FAFF-465) depends on, so the care is in preserving two constraints at once, not in the size of the edit.

## 1. WHY — Problem and Principles

**The load-bearing idea.** `runReviewChain` decides, per backend, whether an `exit === OK` response is usable findings or a fault — and if a fault, *what kind* of fault (empty / provider-refusal / substantive-garble). That `kind` decision routes the chain's terminal disposition: empty and refusal are human-fixable structural inabilities (`NO_FINDINGS_CONTENT`, a needs-human class), whereas garble is a reachable-but-degraded availability symptom (`MALFORMED`). FAFF-465's committed spec makes a hard promise about that decision: it "is a pure function of the *returned content*, so it is stable across re-runs of the same fixed review input." This spec is about honouring that promise where it is currently, quietly, not honoured.

**Problem statement.** Today the chain runs `normaliseCleanRefutation` on the backend's returned content *first*, then hands the possibly-transformed result to `validateFindingsShape`, so the `kind` discriminator classifies content whose shape depends on whether normalisation succeeded — not the backend's raw returned bytes. This is benign right now (the clean-refutation grammar's near-misses do not trip a refusal pattern, so no raw input classifies differently before vs after normalisation), but it is a latent coupling: a future clean-refutation grammar change could make the discriminator's determinism depend on normalisation success, silently breaking FAFF-465's re-run stability. This change re-orders the two concerns so the `kind` classification reads only the raw returned bytes while a successful clean-refutation normalisation is still accepted as no-findings.

**Design principle — the `kind` discriminator is a pure function of the backend's raw returned bytes.** This is the FAFF-465 invariant restated as the acceptance bar for this change: for any fixed backend response, the `kind` a fault classifies to (`empty` / `refusal` / `garbled`) must be identical regardless of whether `normaliseCleanRefutation` transformed the content. Any implementation that lets the classified `kind` vary with normalisation outcome fails this spec even if all existing tests pass.

**Design principle — no FAFF-746 regression.** A successfully-normalised clean refutation must still be accepted as findings-shaped and win the chain with the canonical no-findings token as its content. A clean refutation's raw bytes (e.g. `"No infosec objection."`) are *not* findings-shaped and do *not* match the refusal grammar, so a naive "just classify the raw bytes and gate the `continue` on `!shape.ok`" would misroute an accepted refutation to `garbled`/`MALFORMED`. Preserving acceptance is a first-class constraint, co-equal with the purity principle above.

**Design principle — preserve the observable side effects.** The normalisation-success log line (`normalized: clean refutation … response_sha256=<hash of the raw originalContent>`) and the returned winner content (the canonical token, `normalisation.content`) must be byte-for-byte unchanged. This change re-orders a classification; it does not alter what a successful path emits or returns.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | JavaScript (ESM) | The only file changed — holds `runReviewChain` (the call site, ~:1110–1135) and the three pure functions below |
| `validateFindingsShape(content)` (~:227) | JavaScript | Returns `{ ok:true }` when findings-shaped, else `{ ok:false, reason, kind }`, `kind ∈ empty\|refusal\|garbled`. Pure. Unchanged by this spec |
| `normaliseCleanRefutation(content)` (~:252, FAFF-746) | JavaScript | Maps a closed clean-refutation grammar to the canonical token; otherwise returns the original unchanged. Pure. Unchanged by this spec |
| `isProviderRefusal(content)` (~:214) | JavaScript | Closed, anchored, length-guarded refusal grammar consulted by `validateFindingsShape`. Pure. Unchanged by this spec |
| `test/adversarial-call.test.mjs` | JavaScript (node:test) | Imports and exercises the pure functions directly; new acceptance tests land here |

**Scope statement.** This is a one-function re-ordering inside the adversarial review chain's per-backend result handling; it changes classification *ordering*, not any function's behaviour, exit-code map, or logging surface.

## 2. OUT OF SCOPE

- **Changing any of the three pure functions** (`validateFindingsShape`, `normaliseCleanRefutation`, `isProviderRefusal`). — Why excluded: the coupling is in the *call-site ordering*, not in any function; the functions are already pure and correct. Extension point: if a future grammar change is wanted, it lands in `normaliseCleanRefutation` / the refusal patterns under its own ticket, not here.
- **The exit-code taxonomy and `CHAIN_NEEDS_HUMAN` membership** (empty/refusal → `NO_FINDINGS_CONTENT`; garbled → `MALFORMED`). — Why excluded: this spec preserves the existing mapping exactly; it only fixes what content the `kind` is derived from. Extension point: the `EXIT` map and `CHAIN_NEEDS_HUMAN` set near the top of the same file.
- **The clean-refutation grammar itself** (which sentences/headings `normaliseCleanRefutation` accepts). — Why excluded: FAFF-746 owns that surface; widening it is a separate decision. Extension point: `CLEAN_REFUTATIONS` in the same file.
- **The chain's advance/terminate control flow** (slice deadlines, `chainTerminalExit`, mandatory-outage remap). — Why excluded: untouched; only the `exit === OK` shape branch is re-ordered. Extension point: the surrounding `runReviewChain` loop.
- **The single-shot/L4 terminal disposition machinery FAFF-465 shipped.** — Why excluded: this change *enforces* one of its stated invariants; it does not extend or alter the disposition logic. Extension point: FAFF-465's design record and its call sites.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Raw returned bytes | `originalContent` — the backend's response content exactly as received (`result.content || ""`), before any normalisation |
| `kind` discriminator | The `empty` / `refusal` / `garbled` classification `validateFindingsShape` returns on its `!ok` path; the thing that must be pure over raw returned bytes |
| Clean refutation | A closed-grammar "no objection" response (e.g. `"No infosec objection."`), bare or under its `## Refutation — <lens>` heading, that `normaliseCleanRefutation` maps to the canonical token |
| Canonical no-findings token | `CANONICAL_NO_FINDINGS` = `"### observation: no findings"` — always findings-shaped; the accepted content a normalised clean refutation returns as the winner |
| Accepted path | The branch where a backend's response wins the chain (returns `{ exit: OK, content, winner, … }`) |
| Non-findings `continue` | The branch that records a fault class, logs, and advances to the next backend |

**Existing shapes this change reasons over (all unchanged).**

```
FUNCTION validateFindingsShape(content) -> Result
  Result = { ok: true }
         | { ok: false, reason: String, kind: "empty" | "refusal" | "garbled" }
  # PURE. empty <- trimmed content is whitespace-only
  #       refusal <- no recognised severity section AND isProviderRefusal(trimmed)
  #       garbled <- no recognised severity section AND not a refusal

FUNCTION normaliseCleanRefutation(content) -> Norm
  Norm = { content: String, normalised: Bool, lens: String|null, form: String|null }
  # PURE. normalised:true  -> content == CANONICAL_NO_FINDINGS (always findings-shaped)
  #       normalised:false -> content == original (byte-identical)
```

**The key enabling fact (why the two constraints separate cleanly).** The `kind` field is only ever *read* on the `!shape.ok` fault path. A successful normalisation always yields the canonical token, which always passes `validateFindingsShape`. Therefore the set of inputs where "the raw bytes fail shape" and the set where "normalisation succeeded" are handled by different branches, and the two concerns do not fight: classify `kind` from the raw bytes, and separately let a successful normalisation take the accepted path.

**Design decision — where the shape check reads from, and how acceptance is preserved.** Options considered:

- *Naive swap* — change `validateFindingsShape(normalisation.content)` to `validateFindingsShape(originalContent)` and keep the existing `if (!shape.ok) continue`. Rejected: a clean refutation's raw bytes fail shape and are not a refusal, so this misroutes an accepted refutation to `garbled`/`MALFORMED` — a FAFF-746 regression.
- *Compute shape from raw bytes; gate the non-findings `continue` on `!shape.ok && !normalisation.normalised`; on the accepted path return `normalisation.content`.* Chosen. Shape (and thus `kind`) is derived purely from `originalContent`, satisfying the purity principle; a successful normalisation short-circuits the fault branch and takes the accepted path returning the canonical token, satisfying FAFF-746. The two pure functions still both run on every OK result; only which one feeds the `kind` decision changes.
- *Restructure into a helper that returns a tagged disposition.* Rejected for this ticket: a larger refactor than the coupling warrants; the gate-condition form above is the minimal change that closes the coupling. A future readability refactor is welcome but is not required here.

**Chosen:** Derive `shape` (hence `kind`) from the raw `originalContent`; take the non-findings `continue` only when `!shape.ok && !normalisation.normalised`; on the accepted path continue to return `normalisation.content` (the canonical token when normalised, the original bytes otherwise). Rationale: it is the smallest change that makes the `kind` discriminator a pure function of the returned bytes while keeping a successfully-normalised clean refutation accepted as no-findings, and it leaves every side effect (logging, returned content) untouched.

## 4. HOW — Behavior

**Behaviour summary.** On an `exit === OK` backend result, compute both the raw-bytes shape classification and the normalisation outcome, then: accept when the raw bytes are already findings-shaped *or* normalisation succeeded (returning the normalised content); otherwise record the raw-bytes `kind`'s fault class and advance. The `kind` used for the fault class is always the one derived from the raw bytes.

```
PROCEDURE handle_ok_result(result, backend, i):
  1. originalContent <- result.content OR ""
  2. shape         <- validateFindingsShape(originalContent)   # kind is PURE over raw bytes
  3. normalisation <- normaliseCleanRefutation(originalContent)
  4. IF NOT shape.ok AND NOT normalisation.normalised:
     a. cls   <- (shape.kind == "empty" OR shape.kind == "refusal") ? NO_FINDINGS_CONTENT : MALFORMED
     b. label <- (shape.kind == "garbled") ? "malformed" : shape.kind
     c. record cls in failureClasses; log the non-findings advance/verb line (unchanged wording)
     d. CONTINUE to next backend
  5. # accepted path (raw bytes already findings-shaped, OR a clean refutation normalised)
     IF normalisation.normalised:
        a. responseSha256 <- sha256(originalContent)            # hash of RAW bytes, unchanged
        b. log "normalized: clean refutation backend=… lens=… form=… response_sha256=…"
  6. IF i > 0: log "backend i+1/n … produced findings (after i skipped)"
  7. RETURN { exit: OK, content: normalisation.content, truncated, winner: backend, winnerIndex: i, failureClasses }
```

Note the ordering at step 2–3: `validateFindingsShape` now consumes `originalContent`, and its result's `kind` is what step 4a reads. `normalisation.content` is still what step 7 returns, so an accepted-and-normalised response wins with the canonical token exactly as today.

**Edge cases.**
- *Raw bytes already findings-shaped (the common substantive-findings case).* `shape.ok` is true, `normalisation.normalised` is false, `normalisation.content === originalContent`. Step 4 is skipped; step 7 returns the original content. Identical to today.
- *Clean refutation (bare or headed).* Raw bytes fail shape (`kind === "garbled"`), but `normalisation.normalised` is true, so step 4's guard is false — accepted at step 5–7 with the canonical token and the normalisation log line. This is the case the `&& !normalisation.normalised` guard exists to protect.
- *Genuine empty response.* `shape.kind === "empty"`, normalisation false → `NO_FINDINGS_CONTENT`, advance. Unchanged.
- *Genuine provider refusal.* `shape.kind === "refusal"`, normalisation false → `NO_FINDINGS_CONTENT`, advance. Unchanged.
- *Genuine substantive garble (headerless essay).* `shape.kind === "garbled"`, normalisation false → `MALFORMED`, advance. Unchanged.

**Anti-pattern:** classifying `kind` from `normalisation.content` (the current ordering) or from any content conditioned on normalisation success. Why: it makes the discriminator's determinism depend on normalisation outcome, which is exactly the FAFF-465 invariant this change restores.

**Anti-pattern:** dropping the `normaliseCleanRefutation` call, or gating the accepted `continue`/return on the raw-bytes shape alone. Why: a clean refutation's raw bytes are not findings-shaped, so this reintroduces the FAFF-746 regression.

**Failure modes.**
- *The failure:* the re-order accidentally changes the winner's returned content (e.g. returns `originalContent` instead of `normalisation.content` on the accepted path). *How you'd know:* the FAFF-746 acceptance test asserting a clean refutation wins with `CANONICAL_NO_FINDINGS` fails, or a downstream consumer sees raw "No X objection." prose instead of the canonical token. *What it means:* narrow — the accepted-path return must read `normalisation.content`, not the raw bytes; fix and re-run.
- *The failure:* the guard is written as `!shape.ok` alone (dropping `&& !normalisation.normalised`). *How you'd know:* the FAFF-746 "clean refutation is accepted" test fails — the refutation misroutes to `MALFORMED`. *What it means:* narrow — restore the normalisation-success half of the guard.
- *The failure:* the fix is treated as a behavioural change and "proven" by a test that expects a different terminal disposition than today — but the change is behaviour-neutral, so no such test can pass, and chasing one wastes effort or produces a false-green. *How you'd know:* an attempted integration test asserting a *changed* fault outcome for some input cannot be constructed (normalisation-failing inputs have identical pre/post content), or is quietly weakened until it passes. *What it means:* proceed via the correct proof — a pure-function assertion that raw clean-refutation bytes classify as `garbled` while the canonical token is `ok`, plus a call-site assertion (or structural review) that `validateFindingsShape` reads `originalContent`. The value is closing a latent coupling, not moving a live outcome; a null behavioural diff is the expected, correct result.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the raw bytes of a clean refutation ("No infosec objection.") — which classify as a garbled fault on
      the raw bytes but as accepted/ok on the canonical token normalisation produces
When runReviewChain handles the response
Then the kind is derived from the raw returned bytes (validateFindingsShape reads originalContent),
     yet the response is still accepted via the normalisation-success guard rather than routed to MALFORMED
```

> Note: this change is behaviour-neutral today. Because `normaliseCleanRefutation` only ever returns the
> canonical token (findings-shaped) or byte-identical original, a normalisation-*failing* input has identical
> pre- and post-normalisation content and therefore an identical `kind` either way — so no live input
> classifies differently through the fault path. The only raw-vs-normalised divergence is a clean refutation
> (raw → garbled, normalised → accepted). The fix is therefore a preventive/structural one: it re-sources the
> discriminator from raw bytes so a *future* clean-refutation grammar change cannot make the acted-on `kind`
> depend on normalisation success. Its proof is the pure-function fact above plus the call-site sourcing, not
> a behavioural diff against today's code.

```
Given a backend OK-response that is a clean refutation (bare or headed, e.g. "No infosec objection.")
When runReviewChain handles it
Then it normalises to the canonical no-findings token, is accepted as the winner with content "### observation: no findings",
     and emits the normalisation-success log line whose response_sha256 is the hash of the raw bytes
```

- The purity invariant holds as an assertion, not only a path: for any fixed response bytes, `validateFindingsShape` is called on those bytes directly and its `kind` does not depend on `normaliseCleanRefutation`'s outcome.

## 6. Design Decision Rationale

**How should the `kind` discriminator's input be decoupled from normalisation while keeping clean refutations accepted?**

- *Options.* (a) Naive swap of the argument to `originalContent`, keep `if (!shape.ok) continue` — pro: one-token change; con: regresses FAFF-746 by misrouting accepted refutations to `MALFORMED`. (b) Shape from raw bytes + gate the non-findings `continue` on `!shape.ok && !normalisation.normalised` + return `normalisation.content` on accept — pro: satisfies both the purity invariant and FAFF-746, minimal surface, no side-effect change; con: the accepted-path condition is slightly less obvious and needs a comment. (c) Extract a helper returning a tagged disposition — pro: most readable long-term; con: larger refactor than the coupling justifies for this ticket.

**Chosen:** Option (b) — shape (and `kind`) from the raw `originalContent`; non-findings `continue` gated on `!shape.ok && !normalisation.normalised`; accepted path returns `normalisation.content`. Rationale: it is the minimal change that makes the discriminator a pure function of returned bytes (FAFF-465's invariant) without regressing clean-refutation acceptance (FAFF-746), and it preserves every log line and return value. At the time of writing the clean-refutation grammar has no near-miss that trips a refusal pattern, so the change is behaviour-neutral today; its value is closing the latent coupling before a future grammar change can make the discriminator's determinism normalisation-dependent.

## 7. Open Questions and Assumptions

None. Every decision is closed; there are no `**Punt:**` or `**Assumes:**` items. The change is fully specified by the existing pure functions and the two invariants it must jointly preserve.

## 8. Already shipped against this surface

Related prior work on the same file — context, not superseding. None of these closed the ordering coupling, so this ticket's premise holds.

- **FAFF-465 (Done)** — shipped the `kind` discriminator (empty/refusal vs substantive-garble) and the deterministic single-shot terminal disposition. Its committed spec states the discriminator is a pure function of the returned content; this ticket enforces that statement at the call site.
- **FAFF-746 (Done)** — shipped `normaliseCleanRefutation`, the transform whose ordering relative to the discriminator this ticket decouples.
- **FAFF-194 (Done)** — shipped the deterministic findings-shape guards / no-silent-weakening invariant that `validateFindingsShape` extends.

## 9. DONE — Definition of Done

### From WHY (the invariant restored)
- [ ] In `runReviewChain`'s `exit === OK` branch, `validateFindingsShape` is called on the raw `originalContent` (not `normalisation.content`), so the returned `kind` is a pure function of the backend's raw returned bytes.
- [ ] For any fixed backend response, the classified `kind` (`empty`/`refusal`/`garbled`) is identical whether or not `normaliseCleanRefutation` transformed the content (purity of the discriminator over raw bytes).

### From WHAT (decision)
- [ ] The non-findings `continue` fault branch is taken only when the raw-bytes shape fails AND normalisation did not succeed (`!shape.ok && !normalisation.normalised`).
- [ ] The fault class recorded on that branch is derived from the raw-bytes `kind`: `empty`/`refusal` → `NO_FINDINGS_CONTENT`, `garbled` → `MALFORMED`; the `"malformed"` log label is retained for `garbled` only.

### From HOW (behaviour and side effects preserved)
- [ ] A clean refutation (bare and headed, all four lenses) still normalises to `CANONICAL_NO_FINDINGS`, is accepted as the winner, and returns `content === "### observation: no findings"` (no FAFF-746 regression).
- [ ] The normalisation-success log line still fires on a normalised win, with `response_sha256` computed over the raw `originalContent` (byte-identical to today).
- [ ] A response whose raw bytes are already findings-shaped still wins with its original content unchanged.
- [ ] Genuine empty → `NO_FINDINGS_CONTENT`; genuine refusal → `NO_FINDINGS_CONTENT`; genuine substantive garble → `MALFORMED` — all unchanged.

### From tests
- [ ] A unit test locks the raw-bytes classification the fix depends on: raw clean-refutation bytes (e.g. `"No infosec objection."`) classify as `kind: "garbled"` via `validateFindingsShape`, while `validateFindingsShape(CANONICAL_NO_FINDINGS).ok` is true — documenting that the discriminator's answer differs by input, so the call site's choice of raw `originalContent` is load-bearing.
- [ ] The call site's sourcing is pinned: `validateFindingsShape` in `runReviewChain`'s OK branch is asserted (by test or explicit structural review) to receive `originalContent`, not `normalisation.content`. (No behavioural-diff test is required or possible — the change is behaviour-neutral today; see the note under Scenarios.)
- [ ] A test asserts a clean refutation (at least one bare and one headed form) is accepted with the canonical token as winner content.
- [ ] Tests assert genuine empty/refusal → `NO_FINDINGS_CONTENT` and genuine garble → `MALFORMED` through the handled path.
- [ ] The full existing `test/adversarial-call.test.mjs` suite passes with no changes to its prior assertions.

### Integration smoke test
```
Feed runReviewChain a single-backend chain whose backend returns "No infosec objection.":
  - assert the chain result exit is OK
  - assert result.content == "### observation: no findings"
  - assert a "normalized: clean refutation … response_sha256=<sha256 of 'No infosec objection.'>" line was logged
If this one path works, the re-ordered accept path and its side effects are connected.
```

## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery*

**Right-sized? (Principle 4) — No issues (comfortably right-sized, on the small end).**
The scope is one re-ordering inside a single function (`runReviewChain`, `review-call.mjs:1118-1123`) plus its unit tests in `test/adversarial-call.test.mjs` — a sub-day unit, well within the 1-3 day band. It covers one concern (the `kind` discriminator's input source), so there is nothing to split. It is small, but it does not "always ship together" with another ticket, so there is no merge signal either: it is a self-contained invariant fix with its own DoD (discriminator is a pure function of returned content). No action needed.

**Workstream fit? (Principles 1 + 5) — No issues (correctly project-less).**
The issue sits in Backlog with no project, carrying `faff-chain-gap-fill` — i.e. it is a methodology-surfaced follow-up. Under the lens's default-landing rule, project-less Backlog is the *correct* home for a chain-gap-fill ticket; it is not mis-filed into a thematic or activity bucket, so no cohesion fault. One thing to watch, not fix: it converges on the same outcome as its parents — integrity of the adversarial-review terminal-disposition invariant (FAFF-465) / clean-refutation acceptance (FAFF-746). If a cluster of such FAFF-465/746 hardening tickets accumulates loose, that is the point to run the rehoming pass and propose an outcome-led home. Standalone today, leave it loose.

**Deps surfaced? (Principle 6) — Minor: named-ticket references are to already-landed work, so no blocker link is load-bearing — confirm that.**
The spec references FAFF-465 (the invariant it enforces) and FAFF-746 (the behaviour it must preserve) by ID, with no blocker links. Normally an ID reference with no `blockedBy` edge is unfinished thinking — but both are merged (FAFF-465 in #664, FAFF-746 in #566), so they are *rationale/context*, not open prerequisites, and a `blockedBy` link would only point at Done work (no sequencing value). The real dependency is a *code* coupling, not a ticket one: the change is only correct against the current shape of `normaliseCleanRefutation` and the `originalContent`/`normalisation.content` split at lines 1118-1120 — which lives in the same file it edits, so it is self-contained. Action: none required beyond confirming FAFF-465/746 are indeed Done (they are); if either were still open, the reference would become a load-bearing blocker to link.

**Risk profile? (Principle 7) — No spike needed; low risk, but the behaviour-neutrality claim is the thing to pin down in tests.**
No novel integration and no external-team/external-dep exposure — it is a one-line input swap (`validateFindingsShape(normalisation.content)` → derive `kind` from `originalContent`) in code the ticket already owns, explicitly "behaviour-neutral today". So no de-risking spike is warranted. The one latent unknown is exactly the neutrality claim: it holds only if, on the successful-normalisation path, computing `kind` from raw bytes yields the same empty/refusal/garbled verdict as computing it from normalised output — otherwise a clean refutation that FAFF-746 accepts could be re-classified as no-findings/malformed. That is a test obligation, not a spike: the unit tests in `test/adversarial-call.test.mjs` should lock a case where raw and normalised content would classify differently, proving the FAFF-746 accept-path is preserved while the discriminator now reads raw bytes.

confidence: high
build-tier: complex
spec-review: approve
