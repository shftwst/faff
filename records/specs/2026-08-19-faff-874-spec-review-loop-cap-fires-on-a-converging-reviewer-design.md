# FAFF-874 — Spec-review loop cap yields to a convergence signal, not a fixed iteration count

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-874.

> Spec produced by the `faffter-dark-nlspec` producer for `/faff-prep`, issue FAFF-874. Audience: the build agent implementing this against `plugin/skills/faff-prep/SKILL.md` and `plugin/skills/faff/bin/lib/`, and the human reviewer checking the approach before it builds.

## 1. WHY — Problem and Principles

**The load-bearing model.** The prep↔review loop cap counts *rounds*, not *convergence*. It force-parks on the third unresolved `revise`/`reject-approach` regardless of whether the reviewer is circling or closing. But a reviewer whose total objection count is strictly falling round-on-round, whose remaining objections are all in-place-fixable (no blocker), and who has raised no new objecting lens, is *measurably converging* — it should be granted the next round to land, not parked. The fix makes the count cap **yield to that convergence signal** and **re-assert the instant the signal breaks**. Because a strictly-decreasing sequence of non-negative integers is self-terminating, a yielding loop cannot run forever — the first round that fails to strictly decrease (or reintroduces a blocker, or churns) re-fires the count cap and parks. The title's "cap should yield to a convergence signal, not a fixed iteration count" is exactly this substitution.

**Problem statement.** Today the Spec-review gate's loop is capped at 2 iterations and force-parks `needs-human` on the third unresolved round even when the reviewer is plainly converging (observed L4 run: raw objections fell 14 → 13 → 8, both round-2 blockers fixed, churn detector confirmed no thrash, yet all four lenses each still raised ≥1 gating objection so the reviewer's majority rule emitted `reject-approach` every round). The cap exists to stop a *non-converging* (thrashing) reviewer, but it can't distinguish that from a converging one — both consume the count identically. This change adds a prep-side convergence gate that lets a strictly-converging, blocker-free, non-churning reviewer keep landing rounds while parking a thrashing, churning, or plateaued one exactly as today.

**Design principles.**

- **Yield in the converging direction only; thrashing still parks.** The cap loosens *only* for a measurably-converging reviewer. A flat/rising objection count, a re-introduced blocker, or a new objecting lens (churn) each still park. This spec deliberately revisits and supersedes FAFF-707's "a signal, not a replacement — never loosens or replaces the count cap" non-goal, in the converging direction only (see Design Decision Rationale).
- **The reviewer's verdict is never rewritten.** Prep decides whether to grant another round or park; it never forges an `approve` the reviewer did not emit. The founded-verdict invariant and the "meta-signal ≠ verdict" distinction FAFF-707 established both hold. The reviewer's majority/severity aggregation (`aggregate.mjs`) is untouched.
- **Deterministic tools over prose.** "Is this reviewer strictly converging" is a same-input-same-output comparison over persisted round records — a pure CLI resolver with a `--selftest`, not a judgement handed to the prep agent to eyeball.
- **No new durable store, no schema change.** The total objection count (`objections.length`) and the blocker count (per-objection `severity`) are both already derivable from the existing round record. Reuse it; invent no second on-disk store and widen no contract shape.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-prep/SKILL.md` — "Spec-review gate" → **Loop cap.** paragraph (~line 161) + **Park causes** list (~line 169) | prose/SKILL | The loop-cap prose this spec edits additively |
| `plugin/skills/faff/bin/lib/spec-review-churn.js` | JS | The pure comparator this new resolver mirrors (module shape, `lensSet`, fail-loud/degrade split); its `detectSpecReviewChurn` stays the round-1-vs-round-2 check, unchanged |
| `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` | JSON | The existing `{verdict, objections}` durable store (FAFF-811 single-store rule) the new resolver reads — no schema change |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` — `aggregate` / `strictMajority` | JS | The reviewer's per-round majority rule (`strictMajority(4)=3`) that this spec leaves **untouched** |
| `plugin/skills/faff/contracts/spec-review-verdict.schema.json` | JSON Schema | The `{lens, severity}` objection shape, unchanged |
| `plugin/skills/faff/bin/faff`, `bin/lib/regions.js`, `docs/guide/cli.md` | JS/prose | CLI wiring surface for the new subcommand |
| `test/spec-review-churn.test.mjs` (drift-guard at lines 206–210) + a new `test/spec-review-convergence.test.mjs` | JS test | The drift-guard test to update, and the new resolver's test file |

**Scope statement.** This sits entirely inside the spec stage: an additive prose change to `faff-prep/SKILL.md`'s Loop cap paragraph plus one small pure CLI resolver. It touches no build-stage code, no reviewer internals, and no run-drain convergence subsystem.

## 2. OUT OF SCOPE

- **Born-verifiable MVP spec (issue scope #2).** Making the foundation MVP spec "born-verifiable enough to clear a four-lens majority in one or two rounds." **Why excluded:** it targets the P1 link-shortener system-under-build — a *different codebase/product* built downstream by faff, not the harness. It is a spec-authoring quality concern for that product, orthogonal to the harness loop-cap mechanism this ticket fixes. **File as its own ticket. Extension point:** authored during that product's own `/faff-prep` run (its spec producer + spec-review gate), not in this repo.
- **Relaxing the reviewer's majority rule (`aggregate.mjs`).** Changing `strictMajority`/`aggregate` so ≥3-of-4 gating lenses no longer force `reject-approach`. **Why excluded:** the reviewer's per-round verdict is faithful — the fix belongs at the prep-side loop cap, not in a swappable reviewer occupant's internals (see WHAT decision D2). **Extension point:** `plugin/skills/faffter-dark-spec-review/aggregate.mjs`, if a future ticket ever wants per-round relaxation — not here.
- **The round-1-vs-round-2 churn check (`spec-review-churn.js`).** **Why excluded:** it correctly parks a thrashing reviewer *early*; this spec reuses its lens-set logic conceptually but does not modify it. **Extension point:** none needed; it stays as-is and remains the early-thrash floor.
- **A stable per-objection identifier in the contract shape.** **Why excluded:** FAFF-707 considered and rejected this; the convergence signal needs only count + severity, both already in the record, so the rejected alternative does not reappear. **Extension point:** `spec-review-verdict.schema.json`, only if the same-lens-swap gap (WHAT decision D1, Failure modes) is ever evidenced as real.
- **The `.faffrc.yaml` `convergence: { enabled, max_waves }` run-drain mechanism.** **Why excluded:** a same-named, unrelated subsystem (it governs whether an autonomous *run* has drained its discovered scope), not this issue's spec-review objection trend. **Extension point:** none; not touched or read.

## Already shipped against this surface

Related Done work on the spec-review loop surface — scanned and confirmed **not superseding** this issue's premise (the convergence-yield is unbuilt in all of them):

- **FAFF-707** (Done) — built `faff spec-review-churn`, the round-1-vs-round-2 lens-set thrash guard. Explicitly built as "a signal, not a replacement": it fires *earlier* than the count cap, never overriding it outward. This issue supersedes that non-goal in the converging direction only (see Design Decision Rationale).
- **FAFF-811** (Done) — split multi-lens `reject-approach` routing; explicitly left the loop cap, churn check, and `revise` path untouched. Establishes the single-durable-store rule (round records) this spec reuses.
- **FAFF-341** (Done) — single-ownered the *build-stage* review-iteration cap (`review-iteration-cap.js`). A different loop; not this spec-review loop. Cited only as the CLI-resolver pattern precedent.
- **FAFF-265 / FAFF-335 / FAFF-266 / FAFF-268** (Done) — the verdict contract, gateway section, single-pass reviewer, and cost-gated lens selection. All upstream scaffolding this spec builds on unchanged.

None of these implement the count-cap-yields-to-a-convergence-signal behaviour; the premise is intact.

## 3. WHAT — Vocabulary, Types, and Interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Round | One spec-review verdict computation (one `spec_review` producer dispatch + one `faff contract spec-review-verdict` pipe). Initial review = round 1; each loop-back is the next round. |
| Round record | The persisted `{verdict, objections}` JSON at `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` — written verbatim after each conformant pipe (existing behaviour). |
| Objecting lens | A lens (`architectural` \| `infosec` \| `methodology` \| `QA`) appearing at least once in a round's `objections`. |
| Lens-set | The deduplicated set of objecting lenses for a round; severity dropped. |
| Total objection count | `objections.length` for a round — no schema field, derived. |
| Blocker count | The number of `objections` in a round whose `severity == "blocker"` — derived. |
| Convergence window | The ordered list of all persisted round records for the issue at a cap-decision point (rounds 1..N, N ≥ 2). |
| Strictly converging | Over the window: the total objection count strictly decreases at **every** consecutive step, the latest round has **zero** blockers, and **no** new lens appears at any consecutive step (no churn). All three must hold. |
| Cap-yield | At a would-be park (the count cap firing), prep grants the next round instead of parking **iff** the reviewer is strictly converging; otherwise it parks as today. |

### Type definitions

```
RECORD SpecReviewRound:                 # the existing round record — UNCHANGED shape
  verdict:    Enum(approve, revise, reject-approach, needs-human)
  objections: List<{lens: Lens, severity: Severity}>   # verbatim contract extraction JSON

ENUM Lens:     architectural | infosec | methodology | QA
ENUM Severity: blocker | major | minor

RECORD SpecReviewConvergenceResult:     # NEW — the pure resolver's output
  converging:          Boolean          # strictly_decreasing AND blocker_free_latest AND no_churn
  totals:              List<Integer>    # objection count per round, in round order
  blocker_counts:      List<Integer>    # blocker-severity count per round, in round order
  strictly_decreasing: Boolean          # totals[i] > totals[i+1] for every consecutive i
  blocker_free_latest: Boolean          # blocker_counts[last] == 0
  no_churn:            Boolean           # no lens in round i+1 absent from round i, every step
  new_lenses_by_step:  List<List<Lens>> # per consecutive step, lenses newly objecting (drives no_churn)
  reason:              String            # human-readable one-liner for the prep log / park comment

  CONSTRAINT converging == (strictly_decreasing AND blocker_free_latest AND no_churn)
```

**CLI surface.** `faff spec-review-convergence --dir <spec-review-dir>` — reads every `round-<n>.json` in the directory, orders them by `<n>`, builds the ordered record list, computes a `SpecReviewConvergenceResult`, prints it as JSON to stdout, exit 0. `--selftest` runs the fixture cases and prints PASS/FAIL, mirroring `specReviewChurnSelftest`. The pure comparator `detectSpecReviewConvergence(rounds)` takes the already-ordered list of parsed records and carries **no I/O** (parity with `detectSpecReviewChurn`); the CLI wrapper owns the directory read and ordering.

### Design decisions

**D1 — What exactly counts as the convergence signal, and over how many rounds? (resolves issue open question #1)**

| Option | Signal | Weakness |
|---|---|---|
| Strictly-decreasing total objection count only | Simple; matches the observed 14→13→8 | Would wave through a spec whose remaining objection is a fresh blocker or a swapped-in new lens |
| Decreasing gating-severity count only | Focuses on blockers | A spec can shed blockers while total objections plateau or a new lens appears — not "converging" |
| **Both trends, plus no-churn, over the full window** | Total strictly falls every step, latest round blocker-free, no new lens any step | Stricter — rejects a mid-window plateau/bounce (accepted; see rationale) |

**Chosen:** the convergence signal requires **all three** to hold across the **full available window** (all rounds 1..N at the cap-decision point; a trend needs ≥2 rounds, and in practice N ≥ 3 at the first cap): (1) total objection count strictly decreases at **every** consecutive step, (2) the **latest** round has **zero blocker-severity** objections, and (3) **no** new objecting lens appears at any consecutive step. Rationale: (1) is the raw "measurably converging" signal the issue names (14→13→8 qualifies; 13→13 or 14→13→14 does not); (2) folds the issue's "all in-place-fixable (no blocker)" concern into the signal so a fresh blocker is never waved through; (3) extends the existing lens-set churn guard across the *whole* window (the existing `spec-review-churn` check only compares round-1-vs-round-2 — once round 3 can yield to round 4, the round-2-vs-round-3 pair must be guarded too). "Full window, every step" beats "first-vs-last" because first-vs-last can mask a mid-window plateau or bounce that isn't convergence. `(decides: architecture)`

**D2 — Relax the majority rule, or layer a separate cap-yield gate? (resolves issue open question #2)**

**Chosen:** a **separate prep-side gate layered on top** of the count cap; the reviewer's majority rule in `aggregate.mjs` is **untouched**. Rationale: (a) the majority rule lives inside a *swappable* `spec_review` occupant — relaxing it there changes verdict semantics for every consumer and only fixes that one occupant; (b) the bug is the loop cap force-parking a *converging* reviewer, not the reviewer's per-round verdict being wrong (≥3-of-4 gating lenses → `reject-approach` is a faithful per-round verdict); (c) a prep-side gate keeps the change in one place, reuses the existing round-record store, and preserves the founded-verdict invariant (prep grants a round or parks — it never rewrites the verdict). The "all in-place-fixable" benefit the question gestures at is captured via D1's blocker-free-latest condition at the prep gate, not by mutating reviewer internals. The issue itself frames this option as "a separate gate layered on top." `(decides: architecture)`

**D3 — How does the cap "yield," and is there a separate numeric ceiling?**

**Chosen:** at a would-be park, `converging: true` grants the **next** round (apply the in-place-fixable fixes, re-rate, re-review) instead of parking; the gate re-evaluates at each subsequent would-be park, so the loop continues **while and only while** the signal holds. There is **no** separate numeric ceiling: a strictly-decreasing sequence of non-negative integers has length ≤ (initial count + 1), so the yielding loop is self-terminating by construction. Adding a second arbitrary iteration ceiling would reintroduce exactly the "fixed iteration count" the title rejects. The first round that fails to strictly decrease (or reintroduces a blocker, or churns) makes `converging` false and re-asserts the count cap → park.

**D4 — Deterministic CLI resolver, or prose judgement in faff-prep?**

**Chosen:** a new pure CLI subcommand `faff spec-review-convergence`, following the `spec-review-churn` / `review-iteration-cap` pattern (pure resolver + thin `cmd*` wrapper + `--selftest`, wired into `bin/faff`'s dispatch table, `regions.js`, and `docs/guide/cli.md`). Comparing objection-count and blocker-count trends across ordered JSON records is a same-input-same-output computation — a tool, not an eyeball judgement.

**D5 — Reuse the round record, or extend the schema?**

**Chosen:** reuse the existing `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` record with **no schema change**. Total count = `objections.length`; blocker count = objections filtered to `severity == "blocker"`. Both are derivable from the stored shape. This honours the FAFF-811 single-durable-store rule and avoids re-plumbing every occupant, exactly as FAFF-707's rejected stable-identifier alternative would have required.

**D6 — Drift-guard test: preserve substrings, update the test, or both?**

**Chosen:** **both.** The additive prose keeps the literal fragments `capped at **2 iterations**` and `third unresolved` `revise`/`reject-approach` verbatim (so the existing substring assertions at `test/spec-review-churn.test.mjs:208-209` keep passing), AND the test is consciously updated: its "…untouched (additive, not replaced)" description is corrected to "…preserved, with the convergence-yield clause added," and a new positive assertion pins the convergence-yield clause. This keeps the drift guard honest — it now guards the new prose too.

## 4. HOW — Behavior

**Architecture and approach.** faff-prep already writes each round's `{verdict, objections}` record after the conformant `faff contract spec-review-verdict` pipe (FAFF-707). This spec adds, at the loop-cap decision point, one read-and-compare over all persisted round records, plus a prose branch: yield-or-park. No new step type, no reviewer change, no schema change.

**The pure comparator.** Behaviour summary: given the ordered round records, decide whether the reviewer is strictly converging across the whole window.

```
PROCEDURE detect_spec_review_convergence(rounds):        # rounds: ordered by round number
  1. IF rounds.length < 2:
     RETURN { converging: false, totals: [counts…], blocker_counts: [counts…],
              strictly_decreasing: false, blocker_free_latest: (blockers(last)==0),
              no_churn: true, new_lenses_by_step: [],
              reason: "need >=2 rounds to assess a trend" }
     # Defensive only — the cap decision point always has >=3 rounds.
  2. totals         = [ len(r.objections)                          for r in rounds ]
  3. blocker_counts = [ count(o where o.severity=="blocker")       for r in rounds ]
  4. lens_sets      = [ sorted_dedup(o.lens for o in r.objections) for r in rounds ]
  5. strictly_decreasing = for every i in 0..len-2: totals[i] > totals[i+1]
  6. new_lenses_by_step  = for every i in 0..len-2: lens_sets[i+1] MINUS lens_sets[i]
  7. no_churn            = every step's new-lens list is empty
  8. blocker_free_latest = (blocker_counts[last] == 0)
  9. converging = strictly_decreasing AND blocker_free_latest AND no_churn
 10. reason = converging
        ? "strictly converging: totals " + JOIN(totals,"→") + ", latest round blocker-free, no new lens"
        : <the first failing condition, named: not strictly decreasing at step k / blocker in latest / new lens(es) at step k>
 11. RETURN { converging, totals, blocker_counts, strictly_decreasing,
              blocker_free_latest, no_churn, new_lenses_by_step, reason }
```

**The CLI wrapper (owns I/O; parity with `spec-review-churn.js`).**

```
PROCEDURE cmd_spec_review_convergence(--dir D):
  1. IF D missing/unreadable as a directory:
       degrade → print { converging: false, reason: "spec-review dir unreadable" }, exit 0
       # Fail-SAFE direction = do not yield = park as today (see Anti-pattern below).
  2. files = entries of D matching /^round-(\d+)\.json$/, sorted ascending by <n>
  3. FOR each file: read + JSON.parse
       ON parse error: fail-loud, exit 2   # a record this mechanism wrote is corrupt = plumbing breakage
  4. result = detect_spec_review_convergence(parsed_records_in_order)
  5. print JSON(result), exit 0
```

**Where this plugs into `faff-prep/SKILL.md`'s Loop cap paragraph (additive).** The existing sentences stay verbatim; a clause is appended after the third-round-cap sentence, in substance:

> The count cap **yields to a convergence signal**. Before parking at the cap, run `faff spec-review-convergence --dir <the run's spec-review dir>`. A `converging: true` result (total objection count strictly falling every round, the latest round carrying no blocker, and no new objecting lens since the prior round) **yields the cap** — grant the next round (apply the in-place-fixable fixes, re-rate, re-review) instead of parking, and re-apply this same gate at the next would-be park. A `converging: false` result parks exactly as today. Because a strictly-decreasing objection count is self-terminating, a yielding loop always terminates; the round-1-vs-round-2 `faff spec-review-churn` check above is unchanged and still parks a thrashing reviewer early.

The prose keeps `capped at **2 iterations**` and `third unresolved` `revise`/`reject-approach` verbatim (drift-guard) and contains no tracker refs (`faff lint-refs`).

**Edge cases and error handling.**

- **Cap reached, `converging: true`** → grant the next round; do **not** park. Re-evaluate at the next cap.
- **Cap reached, `converging: false`** → park with the existing `spec-review loop cap reached — <verdict>` cause, unchanged. No new park cause string is introduced (a yield-then-eventual-park is still a loop-cap park).
- **Round-1-vs-round-2 churn** → still parks early via the unchanged `faff spec-review-churn` check, before the convergence gate is ever reached.
- **Fewer than 2 round records** at the decision point → `converging: false` (defensive; cannot happen at a genuine cap where ≥3 exist).
- **Malformed round-record JSON** → fail-loud exit 2 (plumbing breakage, parity with `spec-review-churn`'s `--curr`).
- **Unreadable spec-review directory** → degrade to `converging: false` (fail-safe = park as today), never fail the whole prep run.
- **Verdict-agnostic:** the comparator reads only `objections`, never `verdict` — a round's counts and lens-set are well-defined regardless of which loop-eligible verdict produced it (matches `detectSpecReviewChurn`).

**Failure modes — how the approach could be wrong, and how you'd notice.**

- **The failure — a same-lens objection swap masquerading as convergence.** Because objections carry no stable identity (the accepted FAFF-707 gap), a reviewer could shed two `architectural` objections and add one different `architectural` objection: total count still falls, lens-set unchanged, no blocker — the gate reads "converging" and yields, though the reviewer effectively moved the goalposts within one lens.
  - **How you'd know:** a spec that keeps yielding yet never reaches `approve`, with the persisted round records (kept verbatim) showing a *different* single-lens complaint each round while the count trickles down.
  - **What it means:** **narrow, not abandon.** The self-terminating strict-decrease bound caps the damage — the count cannot strictly decrease forever, so the loop still terminates and parks. If evidenced as frequent, the fix is the stable-identifier contract extension rejected in D5/FAFF-707, revisited with real data.
- **The failure — the cap never fires for a pathological but strictly-shrinking reviewer.** A very high initial objection count (e.g. 40) could grant many rounds before terminating.
  - **How you'd know:** an issue's spec-review dir accumulating a long run of `round-<n>.json` with monotonically falling counts and no `approve`.
  - **What it means:** proceed — this is bounded (≤ initial+1 rounds) and, by construction, is a reviewer that is genuinely closing. A generous absolute backstop can be added later if the bound is ever too loose; it is deliberately omitted now to avoid reintroducing a fixed iteration count (D3).

**Anti-pattern:** treating a `converging: true` result as an `approve` verdict. Why: it is a meta-signal about the *loop*, not a verdict about the spec — prep grants a round, it never forges the reviewer's `approve`. Conflating them would resurrect exactly the founded-verdict violation FAFF-707's "meta-signal ≠ verdict" anti-pattern warns against.

**Anti-pattern:** degrading an unreadable spec-review dir to `converging: true`. Why: the fail-safe direction for a *yield* gate is "don't yield" (= park as today), the opposite of the churn gate's degrade direction ("don't invent churn" = proceed).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec-review loop at its count cap with round records
      round-1 = 14 objections, round-2 = 13 objections (both round-2 blockers fixed),
      round-3 = 8 objections, none of them a blocker, and no new lens since round-2
When faff-prep runs `faff spec-review-convergence --dir <spec-review dir>` at the would-be park
Then the result is { converging: true, strictly_decreasing: true, blocker_free_latest: true, no_churn: true }
And faff-prep grants the next round instead of parking needs-human
```

```
Given round records round-1 = 13, round-2 = 13, round-3 = 8 objections (round-1→2 flat, none a blocker, no new lens)
When faff-prep runs the convergence gate at the cap
Then the result is { converging: false, strictly_decreasing: false }
And faff-prep parks needs-human with cause "spec-review loop cap reached — <verdict>", exactly as today
```

```
Given round records round-1 = 14, round-2 = 10 objections where round-2 adds a lens (e.g. infosec) that did not object in round-1
When faff-prep runs the round-1-vs-round-2 `faff spec-review-churn` check
Then churn: true parks needs-human early, before the convergence gate is ever reached
And even if the convergence gate ran, no_churn would be false → converging: false → park
```

## 6. Design Decision Rationale

**What counts as the convergence signal, and over how many rounds? (open question #1)** Options: strictly-decreasing total count only; decreasing gating-severity count only; or both trends plus no-churn over the full window. **Chosen:** all three, over the full window, every step — see WHAT D1. Strict-every-step over first-vs-last is chosen to reject a mid-window plateau/bounce, which isn't convergence.

**Relax the majority rule, or layer a separate cap-yield gate? (open question #2)** Options: relax `aggregate.mjs`'s majority so ≥3-of-4 gating lenses no longer force `reject-approach`; or layer a prep-side yield gate on top and leave the reviewer untouched. **Chosen:** the separate prep-side gate — see WHAT D2. The reviewer's per-round verdict is faithful; the bug is the loop cap, and the reviewer is a swappable occupant whose internals shouldn't carry this fix.

**How does the cap yield — one extra round, or while-converging?** Options: grant a single fixed extra round (still a fixed count, just 3 not 2); or yield while and only while the signal holds. **Chosen:** yield while the signal holds, with no separate numeric ceiling — the strict-decrease invariant is itself the terminating bound (WHAT D3). A fixed extra round would re-commit the exact error the title names.

**Deterministic resolver or prose judgement?** **Chosen:** a pure `faff spec-review-convergence` CLI mirroring `spec-review-churn` — WHAT D4.

**Reuse the round record or extend the schema?** **Chosen:** reuse, no schema change; count and blocker-count are derivable — WHAT D5.

**Preserve the drift-guard substrings, update the test, or both?** **Chosen:** both — WHAT D6.

**Consciously superseding FAFF-707's "signal, not a replacement" non-goal.** FAFF-707 built the churn detector as explicitly additive: "the existing 2-iteration count cap stays exactly as written… never loosens or replaces it." At the time of writing (2026-08-19), that non-goal is deliberately **revised in the converging direction only**: FAFF-874 *does* let the count cap yield, but exclusively for a strictly-converging, blocker-free, non-churning reviewer — a thrashing, churning, or plateaued reviewer still parks, and the round-1-vs-round-2 churn floor FAFF-707 built is untouched. FAFF-707 solved "park a thrashing reviewer *sooner*"; FAFF-874 solves the complementary "let a converging reviewer *land*." The two are the same underlying model (the cap counts rounds, not agreement) applied in opposite directions, and both can hold at once.

## 7. Open Questions and Assumptions

**Open Questions:** none outstanding — both issue open questions (#1 signal definition, #2 relax-vs-separate-gate) are closed with `**Chosen:**` markers (D1, D2). Issue open question #3 (the born-verifiable MVP split) is a prep-owned decision recorded in OUT OF SCOPE. The one known limitation (a same-lens objection swap reading as convergence) is documented as an accepted, self-terminating-bounded gap in HOW → Failure modes, not left open.

**Assumptions:**

- **Assumes:** `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` records already exist and are written verbatim after each conformant pipe (the FAFF-707 behaviour this gate reads back). **Validation:** confirm the Loop cap paragraph's existing "write the round's `{verdict, objections}` verbatim to …round-<n>.json" sentence is present before wiring the gate; the gate reads exactly that store.
- **Assumes:** `plugin/skills/faff/bin/lib/argv.js`'s `parseArgs`/`usageError` and the CLI-wiring pattern demonstrated by `spec-review-churn.js` (pure resolver + thin `cmd*` wrapper + `--selftest` + `bin/faff` COMMANDS entry + `regions.js` factory & selftest-argv rows + `docs/guide/cli.md` line) apply unchanged to the new module. **Validation:** confirmed by reading `spec-review-churn.js` and its registrations during authoring; mirror them.

## 8. DONE — Definition of Done

### From WHY
- [ ] The Loop cap prose states the count cap yields to a convergence signal and re-asserts when it breaks, in the converging direction only (thrashing/churn/plateau still park).
- [ ] The reviewer's verdict is never rewritten by prep — the yield grants a round or parks; `aggregate.mjs` is unedited.
- [ ] The convergence decision is a deterministic CLI resolver, not prep-agent prose judgement.
- [ ] No new durable store and no contract-schema change are introduced.

### From WHAT (types and interfaces)
- [ ] `detectSpecReviewConvergence(rounds)` returns a `SpecReviewConvergenceResult` with `converging == (strictly_decreasing AND blocker_free_latest AND no_churn)`.
- [ ] `totals[i]` = `objections.length` of round i; `blocker_counts[i]` = count of `severity=="blocker"` in round i — both derived, no schema field added.
- [ ] `strictly_decreasing` is true iff `totals[i] > totals[i+1]` for every consecutive `i`.
- [ ] `no_churn` is true iff no round adds a lens absent from its predecessor (checked over every consecutive step, including round-2-vs-round-3).
- [ ] `blocker_free_latest` is true iff the latest round has zero blocker objections.
- [ ] `faff spec-review-convergence --dir <path>` exists, is pure in its comparator (no tracker/network writes), and reads/orders `round-<n>.json` in the CLI wrapper.

### From WHAT (decisions — resolved open questions)
- [ ] D1: the signal is strictly-decreasing total count AND blocker-free latest round AND no-churn, over the full window — marked `**Chosen:**`.
- [ ] D2: the majority rule in `aggregate.mjs` is untouched; the yield is a separate prep-side gate — marked `**Chosen:**`.

### From HOW (behaviour)
- [ ] At the count cap, `converging: true` grants the next round instead of parking; `converging: false` parks with the existing `spec-review loop cap reached — <verdict>` cause.
- [ ] The gate re-applies at each subsequent would-be park (yield-while-converging), with no separate numeric ceiling.
- [ ] The round-1-vs-round-2 `faff spec-review-churn` check is unchanged and still parks a thrashing reviewer early.
- [ ] Malformed round-record JSON → exit 2 (fail-loud); an unreadable spec-review dir → `converging: false` (fail-safe to park).
- [ ] The comparator reads only `objections`, never `verdict` (verdict-agnostic).

### From HOW (CLI / fixtures / wiring)
- [ ] `spec-review-convergence` is registered in `plugin/skills/faff/bin/faff` (require + COMMANDS), `bin/lib/regions.js` (`"spec-review-convergence":"factory"` + a `["spec-review-convergence","--selftest"]` selftest-argv), and documented in `docs/guide/cli.md` (passes `faff lint-cli-doc`).
- [ ] `--selftest` fixtures cover: strictly-converging + blocker-free + no-churn (converging), round-1→2 flat count (not converging), a new lens at a step (not converging), a blocker in the latest round (not converging), and `<2` rounds (defensive `converging: false`).
- [ ] The new module carries exactly one region banner and passes `regions check`; `faff validate-adapters` and `faff lint-refs` pass on the edited `faff-prep/SKILL.md` (no tracker refs in the added prose).
- [ ] No new LLM-judgement seam is introduced — the resolver is a pure deterministic function; no grader `KIND` / eval-registry row is required.

### From HOW (drift-guard)
- [ ] `faff-prep/SKILL.md` still contains the verbatim fragments `capped at **2 iterations**` and `third unresolved` `revise`/`reject-approach` (existing assertions at `test/spec-review-churn.test.mjs:208-209` still pass).
- [ ] The drift-guard test's "…untouched (additive, not replaced)" description is corrected, and a new assertion pins the convergence-yield clause (`faff spec-review-convergence` + the yield behaviour) in the Loop cap paragraph.

### From Scenarios
- [ ] Converging (14→13→8, blocker-free, no new lens) → yields, grants next round. Verified.
- [ ] Flat/non-decreasing (13→13→8) → parks unchanged. Verified.
- [ ] Churn (new lens between rounds) → parks early via `spec-review-churn`; convergence gate also reports `no_churn: false`. Verified.
- [ ] (holdout) Strictly-decreasing but a blocker remains in the latest round → parks. Verified.

### Integration smoke test
```
PROCEDURE smoke_test():
  1. Seed round-1.json: { verdict:"reject-approach", objections: [14 entries, none/some blocker] }
  2. Seed round-2.json: { verdict:"reject-approach", objections: [13 entries, no blocker, same lens-set] }
  3. Seed round-3.json: { verdict:"reject-approach", objections: [8 entries, no blocker, no new lens] }
  4. Run `faff spec-review-convergence --dir <that dir>`
  5. ASSERT stdout parses as JSON with converging === true, strictly_decreasing === true,
            blocker_free_latest === true, no_churn === true
  6. ASSERT exit code 0
```

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery (issue-critique). Advisory — surfaced for `/faff-wtf`, does not gate promotion.*

**Right-sized? (principle 4) — Pass; the split was done correctly.** The issue arrived carrying two structurally independent concerns (the harness loop-cap fix, and a born-verifiable MVP spec for the downstream P1 link-shortener SUT). Prep split the second out to its own ticket and recorded it in OUT OF SCOPE with a why and an extension point. The remaining spec is one cohesive 1–3 day unit — an additive prose clause in `faff-prep/SKILL.md` plus one pure CLI resolver mirroring `spec-review-churn.js`, with tests and wiring — and the pieces always ship together (the prose references the CLI command).

**Workstream fit? (principles 1 + 5) — Cohesive; one caveat.** One outcome ("a converging spec-review reviewer lands its next round instead of being force-parked"), on the spec-review-loop surface alongside FAFF-707 / FAFF-811 / FAFF-341, no riders. Caveat: the issue carries a `Phase 0` label — a phase/time name, not an outcome name. Treat it as a scheduling tag only; if it is being used as a grouping unit, that is the principle-1 activity-named-workstream smell.

**Deps surfaced? (principle 6) — Pass, with one promissory note.** Every referenced ticket (FAFF-707/811/341/265/335/266/268) is Done, so there is no missing live blocker edge, and the spec correctly declares none. The FAFF-707 non-goal supersession is called out explicitly. Note: the OUT OF SCOPE "file as its own ticket" for concern #2 is a promissory note — verify that sibling ticket is actually filed and carry a lightweight `related`/`split-from` link (not `blockedBy` — no real dependency).

**Risk profile? (principle 7) — Well-handled by construction; no spike needed.** The risky move is behavioural (letting a safety cap yield, superseding a mechanism FAFF-707 built to never loosen), not the code. The yield is bounded by construction (a strictly-decreasing non-negative integer sequence self-terminates), and the sharpest failure mode (same-lens objection swap reading as convergence) is named and bounded. Residual: that failure mode's detection is passive archaeology across run dirs. What to do: ensure the logged yield `reason` is greppable/consistent so the "yields-forever, never approves" pathology surfaces from logs.

---

confidence: high
spec-review: approve
build-tier: complex
