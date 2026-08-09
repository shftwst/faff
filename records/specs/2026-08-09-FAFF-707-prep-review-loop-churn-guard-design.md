# FAFF-707 — Prep↔review loop: confirm prior objections resolved before re-refuting

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: high. Full spec on Linear FAFF-707.

> This document is the full spec for FAFF-707, produced by the `faffter-dark-nlspec` producer for `/faff-prep`. Audience: the build agent that implements this against `faff-prep/SKILL.md` and `skills/faff/bin/lib/`, and the human reviewer checking the approach before it's built.

## 1. WHY

**The load-bearing model:** the prep↔review loop cap counts rounds, not agreement. Each time the `spec_review` producer re-runs, it's a fresh model call with no visibility into what the last round objected to — so "the objections are unresolved" and "the objections are different" both look identical to the loop cap, which just ticks a counter to 2 and stops. A reviewer that keeps finding new things wrong, one per pass, never trips the existing safeguard; it just burns both allowed iterations and lands on `needs-human` anyway, having produced two extra spec rewrites en route.

This isn't hypothetical — it's what happened under the FAFF-694 codex run: the spec ballooned from v1 to v5 because each respec round drew a fresh set of objections rather than confirming the previous round's had actually been fixed. FAFF-707 is the third of three tickets split off that finding: seat-routing stayed on FAFF-696 (Done), concurrent lens dispatch is FAFF-706, and this one is the spec-review gate's own job — detecting churn, not just capping count.

**Problem statement.** Today, a `revise` round in `faff-prep/SKILL.md`'s Spec-review gate (lines 98–151) loops back with no memory of what the prior round objected to. The 2-iteration cap (line 133) bounds the damage but can't tell "converging toward approve" from "restating a different objection every time" — both consume the cap identically. This change adds a convergence check between consecutive rounds so a reviewer that's genuinely circling rather than closing gets routed to a human sooner, before the cap forces the same outcome two rounds late.

**Design principles.**

- **A signal, not a replacement.** The existing 2-iteration count cap and the confidence-cap downgrade rule (`≥1 blocker` / `≥3 major` → capped `medium`) are correct as written and stay exactly as written. This spec adds a convergence check that can trigger *earlier* than the count cap; it never loosens or replaces it.
- **Deterministic tools over prose.** Per the gateway's own governing principle, "did the objecting lens-set shrink or hold steady" is a same-input-same-output comparison — a small CLI comparator, not a judgement call handed to the prep agent to eyeball.
- **Work within the existing contract shape where possible.** `spec-review-verdict.schema.json` is `additionalProperties: false` on the objection object; widening it is a breaking-ish change every occupant (both bundled reviewers, plus any foreign one) has to start emitting correctly. This spec avoids that where a coarser signal already answers the ticket's ask.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `faff-prep/SKILL.md` — Spec-review gate section (lines 98–151) | prose/SKILL | The routing table, loop cap paragraph, and park causes this spec edits |
| `skills/faff/bin/lib/contract-defs.js` — `computeSpecReviewVerdict` (lines 400–433) | JS | The pure per-round verdict validator; unchanged by this spec, its output is what gets persisted per round |
| `skills/faff/contracts/spec-review-verdict.schema.json` | JSON Schema | The fixed `{lens, severity}` objection shape this spec works within rather than widens |
| `skills/faff/bin/lib/review-iteration-cap.js` | JS | Precedent for a small, pure, CLI-owned, testable resolver — the pattern the new comparator follows |
| `skills/faff/bin/lib/park-history.js` — `extractParksBlock` | JS | Precedent for reading structured state back from `.faff/runs/<run-id>/…` |
| `skills/faffter-dark-spec-review/aggregate.mjs` (lines 44–58) | JS | Where the richer per-objection `summary` text is dropped before the contract block is built — the reason a stable-identifier approach isn't free |
| `skills/faff/bin/faff` (command dispatch table, ~line 178) | JS | Where the new `spec-review-churn` subcommand gets wired in, mirroring `review-iteration-cap` |

**Scope statement.** This sits entirely inside the spec stage: a prose addition to `faff-prep/SKILL.md`'s existing Spec-review gate section, plus one small deterministic CLI helper. It touches no build-stage code (the `review` slot's own loop, `review-iteration-cap.js`, is a different loop entirely and is untouched), no seat/backend routing, and no concurrency.

**A false friend worth naming up front.** `.faffrc.yaml` carries a top-level `convergence: { enabled: true, max_waves: 8 }` block, and `contract-defs.js` has `RUN_TERMINATION_…` stop-reasons. Neither of those is this. That mechanism governs whether an autonomous **run** (`/faff-beep-boop`) has drained the scope it discovers mid-execution — a different subsystem, a different kind of convergence. This spec's convergence check is scoped entirely to spec-review objections within one issue's prep↔review loop and does not touch, read, or extend that config block. Anyone wiring this up should not reach for `convergence:` in `.faffrc.yaml` — it's unrelated.

## 2. OUT OF SCOPE

- **Seat-routing** — routing the `spec_review` lane to a subscription-seat backend. **Why excluded:** already delivered on FAFF-696 (Done); this ticket is a sibling split, not a continuation. **Extension point:** n/a — shipped.
- **Concurrent lens dispatch** — running the four spec-review lenses in parallel under a non-Claude harness. **Why excluded:** orthogonal performance concern, tracked separately. **Extension point:** FAFF-706.
- **The confidence self-rating downgrade rule** (`≥1 blocker` or `≥3 major` review finding → the spec producer can't self-rate `high`, caps at `medium`). **Why excluded:** this is the spec producer's own self-review of its own draft (`faffter-noon-spec/SKILL.md` line 99), a different mechanism from the spec-review-verdict gate's objections. This ticket doesn't touch it. **Extension point:** `faffter-noon-spec/SKILL.md` / `faffter-dark-nlspec/SKILL.md`, if it ever needs revisiting — not here.
- **The existing 2-iteration loop cap itself.** **Why excluded:** the ticket is explicit that this adds a convergence *signal*, it does not replace the count cap — both stay live, and the count cap remains the fallback when churn detection doesn't fire early. **Extension point:** none needed; it's staying as-is.
- **The `.faffrc.yaml` `convergence: { enabled, max_waves }` run-drain mechanism and `RUN_TERMINATION_…` stop-reasons.** **Why excluded:** a same-named, unrelated subsystem (see the false-friend callout in WHY) — not touched, not extended, not read by this change.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| Round | One spec-review verdict computation — i.e. one dispatch of the `spec_review` producer and one `faff contract spec-review-verdict` pipe. The initial review is round 1; each loop-back is the next round. |
| Objecting lens | A lens (`architectural` \| `infosec` \| `methodology` \| `QA`) that appears at least once in a round's `objections` array. |
| Lens-set | The deduplicated set of objecting lenses for a round, derived from its `objections` array — severity is dropped for this purpose. |
| Churn | A round's lens-set contains a lens that did **not** object in the immediately preceding round — i.e. a genuinely new complaint surfaced rather than a prior one persisting or clearing. |
| Round record | A small JSON file persisting one round's `{verdict, objections}` — exactly the extraction JSON faff-prep already parsed for the contract pipe, written back to disk so the next round can read it. |

### Design decisions

**(a) What does "resolved" mean when the objection shape carries only `{lens, severity}`?**

The contract's objection shape (`spec-review-verdict.schema.json`) is exactly `{lens, severity}`, `additionalProperties: false`. With 4 lenses × 3 severities, there are only 12 possible tuples — "the architectural/major objection from round 1 is gone" and "a different architectural/major objection just replaced it" are the same tuple. There's no id, hash, or text to tell them apart at the contract level.

Two ways to close this:

| Option | How it works | Cost |
|---|---|---|
| Extend the objection shape with a stable identifier (e.g. a short `id` or content hash the reviewer emits per objection) | Round-over-round diff could tell "same objection" from "different objection at the same lens" | Breaking-ish shape change to `spec-review-verdict.schema.json`'s `additionalProperties:false` object — every occupant (bundled `faffter-noon-spec-review`, bundled `faffter-dark-spec-review`, and any foreign occupant) has to start emitting it correctly. `faffter-dark-spec-review`'s `aggregate.mjs` (lines 44–58) currently *drops* the richer per-objection `summary` text before it reaches the contract block — recovering a stable id would mean re-plumbing that aggregation step, not just adding a field name |
| Coarser signal within the existing shape: track the **lens-set** (did the set of objecting lenses shrink, grow, or hold steady), even though "same objection" vs "different objection, same lens" is still unknowable | Directly answers the ticket's own framing — "objections changed rather than reduced" is a lens-set-level statement | Cannot detect a same-lens objection being swapped for an unrelated same-lens, same-severity objection (a real but narrow gap — see Design Decision Rationale) |

**Chosen:** the coarser lens-set signal, no schema change. This directly matches how the ticket itself phrases the target signal ("objections changed rather than reduced"), avoids a breaking change to a contract every occupant emits, and keeps this a small, bounded addition consistent with the explore step's own conclusion that no architecture-proposal work is warranted here. The narrow gap this leaves (a same-lens swap looking like "resolved") is accepted and documented rather than engineered around — see Design Decision Rationale and Open Questions.

**(b) Where does the "was this resolved" comparison state live across iterations?**

Two options: trust the in-conversation record (today's status quo — the loop-back is a bare "loop back to Step 2", no named state anywhere), or persist a small structured artifact.

**Chosen:** a persisted structured artifact — a round record written to `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` immediately after each conformant `faff contract spec-review-verdict` pipe (exit 0), containing exactly the `{verdict, objections}` extraction JSON already in hand — no new shape invented, just persisted. This mirrors two precedents already in the codebase: `review-iteration-cap.js`'s single-owned, CLI-resolved literal (rather than a value trusted to live correctly in prose or memory), and `park-history.js`'s pattern of reading structured state back from `.faff/runs/<run-id>/…`. It's also the only option that survives a `spec_review` producer dispatch being a fresh subagent call each round (no cross-round memory of its own prior verdict) and an interactive prep session resuming across turns or sessions (Scenario B) — an in-conversation tally doesn't survive either of those, which is exactly the gap the explore findings flagged as the status quo's weakness.

The write is a **hard floor**, not gated by `logging: essential` — it's state a later round must read back, not narrative logging, so it follows the same unconditional-write framing as the `prep.md` resume artifact (`faff-prep/SKILL.md`'s Attach-state marker section) rather than the skippable `HHMMSS-prep-ISSUE-XX.md` narrative log.

**(c) The exact churn rule, and where it plugs into the routing table / loop cap.**

**Chosen:** the churn check fires once, when round 2 returns — comparing round 1's lens-set against round 2's. It applies to both loop-eligible verdict types under the existing loop cap paragraph (a `revise` round and a design-lens `reject-approach` round share one counter today, per `faff-prep/SKILL.md` line 133, and share this check too).

- If round 2's lens-set is a subset of (or equal to) round 1's — no new lens appeared — that's convergence (steady or shrinking), and the loop proceeds exactly as today: apply fixes, re-rate, go to iteration 2 (round 3).
- If round 2's lens-set contains a lens that wasn't objecting in round 1, that's churn. Route straight to `needs-human` and park — **do not spend iteration 2 (round 3)**. The park comment cites the churn explicitly: which lens(es) are new.

This replaces "downgrade on the third unresolved round" with an earlier bail *specifically for the churn case* — the existing "on a third unresolved revise/reject-approach, downgrade to needs-human" prose is otherwise untouched and remains the fallback for the case where objections keep shrinking (never churning) but also never reach `approve` (see Scenario 3). The check only ever needs to run once: under the cap, there is no round 4 to compare round 3 against, so there's nothing left to check by the time round 3 returns — the existing cap prose already forces a decision there regardless of convergence.

**(d) Does this need a new deterministic CLI subcommand, or prose-only judgement in faff-prep?**

**Chosen:** a new CLI subcommand, `faff spec-review-churn`, following the `review-iteration-cap` / `contract` pattern — a pure function plus a thin CLI wrapper plus a `--selftest`, wired into `skills/faff/bin/faff`'s command dispatch table exactly as `review-iteration-cap` is (`"spec-review-churn": cmdSpecReviewChurn` alongside the existing `"review-iteration-cap": cmdReviewIterationCap` entry). Comparing two small JSON arrays is exactly the same-input-same-output shape the gateway's "deterministic tools over prose" principle names as a tool, not a judgement call — asking the prep agent to eyeball two `objections` arrays and decide "did this shrink" is unrepeatable and untestable in a way a five-line set comparison isn't.

### Type definitions

```
RECORD SpecReviewRound:
  round: Integer                          # 1-indexed; matches the review call number
  verdict: Enum(approve, revise, reject-approach, needs-human)
  objections: List<{lens: Lens, severity: Severity}>   # verbatim from the
                                           # faff-contract:spec-review-verdict
                                           # extraction JSON already parsed for
                                           # the contract pipe — no new fields

ENUM Lens: architectural | infosec | methodology | QA
ENUM Severity: blocker | major | minor

RECORD SpecReviewChurnResult:
  churn: Boolean
  prev_lenses: List<Lens>                 # sorted, deduped
  curr_lenses: List<Lens>                 # sorted, deduped
  new_lenses: List<Lens>                  # curr_lenses - prev_lenses; drives `churn`
  reason: String                          # human-readable one-liner for the park comment
```

**CLI surface:** `faff spec-review-churn --prev <path> --curr <path>` — reads the two round-record JSON files, prints a `SpecReviewChurnResult` as JSON to stdout, exit 0. `--selftest` runs the fixture cases below and prints PASS/FAIL, mirroring `review-iteration-cap.js`'s `reviewIterationCapSelftest`.

## 4. HOW

**Architecture and approach.** Faff-prep already parses each round's `{verdict, objections}` extraction JSON to pipe it to `faff contract spec-review-verdict` (`faff-prep/SKILL.md` lines 109–114). This spec adds one write and, from round 2 onward, one read-and-compare, both slotting into steps faff-prep already performs — no new step type, no new dispatch.

**Per-round plumbing (added to the existing consumer-fold):**

```
PROCEDURE run_spec_review_round(round_number, spec_body, run_id, issue_id):
  1. Dispatch the configured spec_review producer (existing step, unchanged).
  2. Locate + JSON.parse the faff-contract:spec-review-verdict block (existing, unchanged).
  3. Pipe to `faff contract spec-review-verdict` (existing, unchanged).
  4. IF exit 0 (conformant):
     a. Write the round record: `.faff/runs/<run_id>/<issue_id>/spec-review/round-<round_number>.json`
        containing exactly { verdict, objections } — the parsed extraction JSON, verbatim.
        This write is unconditional (hard floor), same framing as the prep.md resume artifact.
     b. Route on verdict per the existing table (approve / revise / reject-approach / needs-human).
  5. IF exit 1 or 2, or block missing/unparseable: existing needs-human/park path, unchanged.
     No round record is written for a non-conformant round (there is no verdict/objections
     worth persisting).
```

**Churn check — inserted specifically at the round-2 decision point, before looping into iteration 2:**

```
PROCEDURE detect_spec_review_churn(prev_round_path, curr_round_path):
  1. IF prev_round_path does not exist:
     RETURN { churn: false, prev_lenses: [], curr_lenses: <from curr>,
              new_lenses: [], reason: "no prior round on disk" }
     # Defensive default only — faff-prep never calls this for round 1, since
     # there is nothing yet to compare against.
  2. prev = read_json(prev_round_path)   # malformed JSON here is fail-loud, exit 2 —
  3. curr = read_json(curr_round_path)   # parity with review-iteration-cap's fail-loud-on-bad-input
  4. prev_lenses = SORTED(SET(o.lens for o in prev.objections))
  5. curr_lenses = SORTED(SET(o.lens for o in curr.objections))
  6. new_lenses  = curr_lenses - prev_lenses
  7. churn = (new_lenses is not empty)
  8. reason = churn
       ? "new objecting lens(es) since round " + prev.round + ": " + JOIN(new_lenses, ", ")
       : "objecting lens-set held steady or shrank since round " + prev.round
  9. RETURN { churn, prev_lenses, curr_lenses, new_lenses, reason }
```

**Where this plugs into `faff-prep/SKILL.md`'s Spec-review gate:**

- **Loop cap paragraph (line 133)** gets one clause added, immediately after the existing cap sentence: *"On the second round of a `revise`/design-lens `reject-approach` loop, run `faff spec-review-churn --prev <round-1 record> --curr <round-2 record>` before looping back for iteration 2. A `churn: true` result downgrades to `needs-human` and parks immediately — do not spend the remaining iteration on a reviewer that is not converging. A `churn: false` result (steady or shrinking lens-set) proceeds to iteration 2 exactly as today, at which point the existing third-round cap applies unchanged."* Both sentences stay under the same paragraph — this isn't a new gate, it's an earlier exit inside the existing one.
- **Routing table (lines 116–124)** is unchanged — churn is not a new verdict value and never substitutes for one; it's a check faff-prep runs on its own state between rounds, orthogonal to the four-value verdict enum.
- **Park causes (line 141)** gains one entry: `"spec-review churn detected — new objecting lens(es) since round N: <lenses>"`, alongside the existing four causes.

**Edge cases.**

- **First round.** No prior round record exists; the churn check is never invoked for round 1 — there's nothing yet to compare.
- **Missing or unreadable prior round file when the check *is* expected to fire.** Degrades to `churn: false` with `reason: "no prior round on disk"` rather than blocking or false-parking — a missing file here is a plumbing gap (something upstream failed to write the round-1 record), and the safer failure direction is "don't invent churn from absent data," not "silently park a spec that might be fine." Faff-prep logs the gap.
- **Malformed round-record JSON.** Fail-loud, exit 2 — this is producer/plumbing breakage (a file *this same mechanism* wrote is corrupt), not a legitimate degrade case, so it follows the same fail-loud convention `review-iteration-cap.js` uses for an unrecognised appetite.
- **Mixed verdict types across rounds** (round 1 `revise`, round 2 a design-lens `reject-approach`, or vice versa). The comparator only ever looks at `objections`, never at `verdict` — a round's lens-set is well-defined regardless of which loop-eligible verdict produced it, so the check applies uniformly.
- **Methodology-lens or multi-lens `reject-approach`.** These never loop (they park immediately for `/faff-plot` per the existing routing table); the churn check is never invoked for them, since there is no iteration 2 to gate.

**Failure modes — how this could be wrong, and how you'd notice.**

- **The failure:** lens-set granularity can misread a same-lens *swap* as convergence. If round 1's architectural objection is "the retry backoff isn't bounded" and round 2's architectural objection is an unrelated "the schema migration isn't reversible," both are just `architectural`/`major` — the lens-set looks identical (or even shrinking, if another lens cleared), so the check calls it converging when the reviewer actually just moved the goalposts within one lens.
- **How you'd know:** a spec that clears the churn check every round but still hits the existing third-round cap unresolved, with each round's park/log record showing a *different* architectural (or other single-lens) complaint each time — visible by reading the persisted round records back after the fact, since they're kept verbatim.
- **What it means:** narrow, not abandon. This is the accepted gap named in decision (a) — if it shows up in practice, the fix is the stable-identifier contract extension considered and rejected there, revisited with real evidence of how often a same-lens swap happens versus a genuine reduction. Nothing in this spec needs to change to observe whether that's a real problem; the round records already provide the evidence trail.

**Anti-pattern:** treating a `churn: true` result as equivalent to a `needs-human` verdict from the reviewer itself. It isn't — it's a meta-signal about the *loop*, not a verdict about the spec. Why: conflating the two would make the park cause read as if the reviewer said "needs-human" when in fact the reviewer said `revise` twice; the distinct park cause string (`spec-review churn detected — …`) exists precisely so a human reading `/faff-wtf` can tell "the reviewer never settled" from "the reviewer explicitly asked for a human."

## 5. Scenarios

**Scenario 1 — steady/shrinking lens-set, no churn, iterate continues.**

```
Given round 1's spec-review verdict is `revise` with objections [{architectural, major}, {QA, minor}]
And round 2's spec-review verdict (after applying the round-1 fixes) is `revise` with objections [{architectural, minor}]
When faff-prep runs `faff spec-review-churn --prev round-1.json --curr round-2.json` before looping into iteration 2
Then the result is { churn: false, new_lenses: [] }
And faff-prep proceeds to iteration 2 exactly as it does today — apply fixes, re-rate, re-review
```

**Scenario 2 — a new objecting lens appears between rounds, churn detected, routes to needs-human.**

```
Given round 1's spec-review verdict is `revise` with objections [{architectural, major}]
And round 2's spec-review verdict is `revise` with objections [{architectural, major}, {infosec, blocker}]
When faff-prep runs `faff spec-review-churn --prev round-1.json --curr round-2.json`
Then the result is { churn: true, new_lenses: [infosec] }
And faff-prep downgrades to `needs-human` and parks immediately, without spending iteration 2
And the park comment cites the churn explicitly — "spec-review churn detected — new objecting lens(es) since round 1: infosec"
```

**Scenario 3 — slow shrink across exactly 2 rounds, no churn triggered, existing 2-iteration cap fires unchanged as the fallback.**

```
Given round 1's verdict is `revise` with objections [{architectural, major}, {QA, minor}, {infosec, minor}]
And round 2's verdict is `revise` with objections [{architectural, minor}, {QA, minor}] (infosec cleared, nothing new)
And the churn check on round 1 vs round 2 returns { churn: false } — iteration 2 proceeds as normal
And round 3's verdict is `revise` again with objections [{architectural, minor}] (still not `approve`)
When faff-prep evaluates the loop cap after round 3
Then this is the third unresolved revise/reject-approach round
And faff-prep downgrades to `needs-human` and parks, per the existing unchanged loop-cap prose
And no churn check runs between round 2 and round 3 — there is no round 4 to protect against
```

## 6. Design Decision Rationale

**What does "resolved" mean given the objection shape has no stable identifier?**
Options: extend the contract schema with a stable id/hash (precise, but breaking every occupant including `faffter-dark-spec-review`'s `aggregate.mjs`, which already discards richer per-objection text before the contract boundary), or track the lens-set only (coarser, but works within the existing `additionalProperties:false` shape and matches the ticket's own "objections changed rather than reduced" framing).
**Chosen:** lens-set tracking, no schema change — see WHAT decision (a) for the full weighing.

**Where does cross-round comparison state live?**
Options: trust in-conversation memory (today's status quo — confirmed by the explore findings to be effectively stateless, since the `spec_review` producer dispatch and the loop-back both cross subagent/session boundaries with nothing named to carry state), or a small persisted artifact under `.faff/runs/<run-id>/ISSUE-XX/`.
**Chosen:** persisted round records, one file per round, hard-floor write — see WHAT decision (b).

**When does the churn check fire, and what does it replace?**
Options: check every round transition (redundant once the existing 3rd-round cap already forces a decision — there's no round 4 to protect), or check once, specifically between round 1 and round 2, as an earlier bail before spending the loop's second iteration.
**Chosen:** the single round-1-vs-round-2 check — see WHAT decision (c). The existing loop cap and its "third unresolved round → needs-human" prose are untouched; this is strictly an earlier exit on the churn path, never a replacement.

**Deterministic CLI comparator, or prose judgement in faff-prep?**
Options: a small pure CLI subcommand (testable, repeatable, fits the `review-iteration-cap.js` precedent), or leaving it to the prep agent's in-context judgement (matches nothing else in the gate, which already routes every other decision through `faff contract spec-review-verdict`).
**Chosen:** `faff spec-review-churn`, wired into `skills/faff/bin/faff`'s command table alongside `review-iteration-cap` — see WHAT decision (d).

## 7. Open Questions and Assumptions

**Open Questions:** none outstanding — every decision above is closed with a `**Chosen:**` marker. The one known limitation (a same-lens objection swap reading as convergence) is documented in HOW → Failure modes as an accepted gap, not left open for a human to resolve before this can build; it's a "narrow later if evidenced" note, not a blocker.

**Assumptions:**

- **Assumes:** the `.faff/runs/<run-id>/ISSUE-XX/` directory already exists and is writable at the point the spec-review gate runs, for both autonomous and interactive prep. **Validation:** this is the same directory the hard-floor `prep.md` resume artifact already writes to (`faff-prep/SKILL.md`'s Attach-state marker section) — before adding the `spec-review/round-<n>.json` write, confirm `prep.md` for the current run/issue is already present at that path; if it isn't, the directory-creation step that precedes it is the one to reuse, not a new one to invent.
- **Assumes:** `skills/faff/bin/lib/argv.js`'s `parseArgs`/`usageError` helpers and the general CLI wiring pattern demonstrated by `review-iteration-cap.js` (pure resolver function + thin `cmd*` wrapper + `--selftest` + an entry in `bin/faff`'s command table) apply unchanged to a new `spec-review-churn` module. **Validation:** confirmed directly by reading `skills/faff/bin/lib/review-iteration-cap.js` and its registration in `skills/faff/bin/faff` (`"review-iteration-cap": cmdReviewIterationCap`, ~line 178) during this spec's authoring — no further check needed before building.

## 8. DONE

### From WHY
- [ ] `faff-prep/SKILL.md`'s Spec-review gate section names the churn signal as distinct from, and additive to, the existing count cap and confidence-cap downgrade rule (neither of the latter two is edited).
- [ ] The false-friend `.faffrc.yaml` `convergence:` / `RUN_TERMINATION_…` mechanism is untouched — no code or prose change references it.

### From WHAT (types and decisions)
- [ ] `spec-review-verdict.schema.json` is unchanged — no new fields, no id/hash added to the objection shape.
- [ ] A `round-<n>.json` file is written to `.faff/runs/<run-id>/ISSUE-XX/spec-review/` after every conformant (exit 0) `faff contract spec-review-verdict` pipe, containing exactly `{verdict, objections}` verbatim.
- [ ] The write happens unconditionally (not gated by `logging: essential`).
- [ ] `faff spec-review-churn --prev <path> --curr <path>` exists, is pure (no tracker/network writes), and is registered in `skills/faff/bin/faff`'s command table.

### From HOW (behaviour)
- [ ] The churn check fires exactly once per prep↔review loop: comparing round 1 vs round 2, before iteration 2 begins.
- [ ] `churn: true` (a lens in `curr` not present in `prev`) routes to `needs-human` and parks immediately, citing the new lens(es) in the park comment, without spending iteration 2.
- [ ] `churn: false` (subset or identical lens-set) proceeds to iteration 2 exactly as today's unmodified flow.
- [ ] The existing "third unresolved revise/reject-approach round → needs-human" loop-cap prose is unmodified and still fires as the fallback (Scenario 3).
- [ ] The check is never invoked for round 1 (no prior record exists).
- [ ] A missing prior round file degrades to `churn: false` with an explanatory reason, never a false park.
- [ ] Malformed round-record JSON is fail-loud (exit 2), not silently treated as no-churn.
- [ ] The check applies uniformly whether the loop-eligible verdict was `revise` or a design-lens `reject-approach`.
- [ ] Methodology-lens and multi-lens `reject-approach` verdicts (which never loop) never invoke the churn check.

### From HOW (CLI / fixtures)
- [ ] `spec-review-churn` module fixture cases cover at minimum: identical lens-sets (no churn), strict-subset shrink (no churn), a genuinely new lens appearing (churn), a fully disjoint lens-set swap (churn), and a missing prior-round file (degrades, no churn, no crash).
- [ ] `--selftest` runs the fixture cases and reports PASS/FAIL, mirroring `reviewIterationCapSelftest`'s shape.
- [ ] No new LLM-judgement seam is introduced — the comparator is a pure deterministic function; no eval-registry / grader `KIND` entry is required by this change.

### From Scenarios
- [ ] Scenario 1 (steady/shrinking lens-set) — iterate continues unmodified. Verified.
- [ ] Scenario 2 (new lens appears) — routes to `needs-human`, parks with the churn cause cited. Verified.
- [ ] Scenario 3 (slow shrink across exactly 2 rounds, never churns, never approves) — existing 2-iteration cap fires unchanged. Verified.

### Integration smoke test
```
PROCEDURE smoke_test():
  1. Seed round-1.json: { verdict: "revise", objections: [{lens: "architectural", severity: "major"}] }
  2. Seed round-2.json: { verdict: "revise", objections: [{lens: "architectural", severity: "major"},
                                                            {lens: "infosec", severity: "blocker"}] }
  3. Run `faff spec-review-churn --prev round-1.json --curr round-2.json`
  4. ASSERT stdout parses as JSON with churn === true and new_lenses === ["infosec"]
  5. ASSERT exit code is 0
  # If this single path works, the file format, the comparator, and the CLI wiring are connected.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
