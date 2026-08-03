# Spec — FAFF-615: correct the six oracles the re-baseline sweep proved wrong

> Spec: faffter-dark-nlspec · 2026-08-03 · interactive · confidence: high. Full spec on Linear FAFF-615.

**Artifact:** an implementation spec for FAFF-615, for the build agent that will make the change and for the human reviewer gating it. This resolves the last open triage entries from the FAFF-319 sweep by fixing the eval oracles the operator's re-baseline (`.faff/eval-runs/20260803-012238/judgements.jsonl`, 2,210 reps) showed were scoring correct model behaviour as failure. It is fixture-plus-grader work with one genuinely load-bearing design call; the operator re-baseline that follows is explicitly not in scope.

---

## 1. WHY — problem and principles

**The one idea:** two eval kinds score badly because their *graders* are wrong, not because the *skills* regressed — and the fix has to widen the graders without blunting the very thing they exist to catch (a lens crying wolf). `refutation-spec` scores lens objections by strict set-equality, so a spec that is genuinely broken on three axes — and correctly objected to on all three — is marked FAIL because the oracle names only one. `grouping` scores by plain substring containment, so a correct answer that writes `blockedBy` (camelCase) or "recover a locked-out account" misses buckets that demand the literal strings `blocked by` and `account recovery`.

**Problem statement.** The re-baseline put `refutation-spec` at 0.196 accuracy and `grouping` at 0.02. The adjudication (recorded on the ticket) traced both to oracle defects, not skill misses — with reasoning-on reruns confirming the "extra" objections are grounded in real flaws. This change corrects those oracles, adds the grader support one of them needs, and flips the triage entries to match, so the operator's next sweep measures the skills rather than the graders' blind spots.

**Design principles.**

- **A widened oracle must still catch over-firing.** The whole point of these cases is to detect a lens objecting when it shouldn't. "Tolerate any extra objection" would destroy that — a refuter that fired on all four lenses would pass every case. So tolerance is bounded per case to exactly the extra lenses the adjudication confirmed grounded; anything beyond that still FAILs.
- **Only correct what the sweep proved wrong.** Widen a case only where the captures plus the reasoning-on reruns show the model's extra objections are real. Where the evidence is a coin-flip, leave the oracle strict and let the residual read as a skill signal. This is why cases `005`/`006`/`010` (which guard against over-firing) and `004` (a genuine split) are left alone.
- **The re-baseline is the operator's to run, not this build's.** This change ends at "oracles corrected, grader green, triage flipped, guards pass." Refreshing `eval/baselines/frontier.json` is a nested paid sweep and stays out.

**Reference context.**

| File | Relevance |
|---|---|
| `eval/grader.mjs` | `grade()` (768-866), `validateCase()` (345-374), `predictedSet()` refutation-spec arm (637-642), `setEqual` (376-381), `gradeCoverage`/`entryMatches` (402-436). `refutation-spec` is in `CLOSED_SET_KINDS` (238). |
| `eval/cases/refutation-spec-00{1,2,3,7,8,9}.json` | The six over-narrow oracles to widen. |
| `eval/cases/grouping-001.json` | The substring-brittle rubric to widen (fixture-only). |
| `eval/cases/refutation-spec-00{4,5,6},-010.json` + `specqual-003.json` | Left unchanged — named here so the build knows not to touch them. |
| `eval/calibration/oracle-triage.json` | Triage entries to flip; `test/oracle-triage.test.mjs` enforces field hygiene mechanically. |
| `test/eval-grader.test.mjs` | Where the new grader branch's unit tests go. |
| `.faff/eval-runs/20260803-012238/judgements.jsonl` | The sweep captures the bounds were pinned from (at spec time, reproduced at review). Gitignored — does not travel into the build worktree; the build does not re-read it (§3.3, §7). |

**Scope locator.** This is one correction pass over the judgement-eval oracle set — the same layer FAFF-319/FAFF-670 triaged — closing the loop those tickets left open for the sweep to decide.

---

## 2. OUT OF SCOPE

- **The operator re-baseline.** Excluded — it is a nested `claude -p` bulk sweep, paid and operator-owned. Extension point: `node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json`, run by the operator per `eval/README.md` after this lands.
- **Widening `refutation-spec-004`.** Excluded by decision (see §6, Decision B) — it is a real split, not a proven miss. Extension point: if the operator's reasoning-on read of its extra-major reps later confirms the architectural/methodology objections grounded, widen it with the same `lens_bounds` shape this spec introduces.
- **Touching `005`/`006`/`010`.** Excluded — their low scores are the skill over-firing, which is exactly what these clean/near-miss cases are built to expose. Widening them would delete the guard.
- **Any skill-surface change (lens priming).** Excluded — the adjudication refuted the earlier fear that the generic infosec lens misses faff-specific threats; `007`/`008`/`009` show it objects at the right severity. There is nothing to prime. Extension point: the faffter-dark-spec-review lens prompts, if a future sweep ever shows a genuine miss.
- **Reconciling the binary-grade / free-text-tolerance mismatch** on chain-gap and resolved-elsewhere. Excluded — already carved to FAFF-692.

---

## 3. WHAT — the new oracle shape and the fixture edits

### 3.1 Vocabulary

| Term | Meaning |
|---|---|
| **lens** | One of the four independent refuters in `refutation-spec`: `architectural`, `infosec`, `methodology`, `QA`. |
| **above-minor** | An objection at `blocker` or `major` severity — the ones that count toward the predicted lens set (`ABOVE_MINOR`, grader line 574). A `minor`-only objection does not contribute its lens. |
| **grounded extra** | An objecting lens beyond the primary one that the adjudication (sweep + reasoning-on rerun) confirmed points at a real flaw — not the lens padding an objection onto a thin spec. |

### 3.2 The new oracle shape: `lens_bounds`

`refutation-spec` currently carries its oracle in `closed_set` (a bare lens list), graded by `setEqual`. There is no existing shape for "this lens must object; these specific others may." Add one oracle field:

```
oracle.lens_bounds:
  must_object: [lens, ...]   # non-empty; every one of these MUST be in the predicted above-minor set
  may_object:  [lens, ...]   # tolerated but not required; may be empty
```

A case populates **either** `closed_set` **or** `lens_bounds`, never both. `validateCase`'s existing exclusivity list covers `closed_set` / `ordering` / `gloss_rubric` only, so the both-populated guard for `lens_bounds` is **new machinery** added in §4 step 1a — not a pre-existing check. The clean cases (`005`/`006`/`010`, oracle `[]`) and the strict case (`004`, oracle `["QA"]`) keep `closed_set`. The six widened cases move to `lens_bounds`.

**Scoring (the new `grade()` branch).** Let `predicted` = the deduped above-minor lens set (exactly what `predictedSet(c, env)` already returns for `refutation-spec`). Then:

```
PASS  iff  every lens in must_object is in predicted
      AND  every lens in predicted is in (must_object ∪ may_object)
FAIL  otherwise
```

The first clause keeps the primary catch mandatory (miss the real threat → FAIL). The second is the bounded over-fire guard: a lens firing that is neither required nor tolerated → FAIL. Signature stays `JSON.stringify([...predicted].sort())` — the observed lens set, identical to the `closed_set` path, so the flakiness metric is unaffected.

**Chosen:** a bounded per-case `lens_bounds { must_object, may_object }` shape with its own `grade()` branch, over the alternative of loosening set-equality to "primary lens ⊆ predicted" (tolerate anything). Rationale in §6, Decision A.

### 3.3 The six `lens_bounds` values (pinned from the captures)

Each `may_object` set is exactly the grounded extras the adjudication confirmed — nothing the sweep merely happened to emit. These bounds were computed against the 2,210-rep captures and **independently reproduced at spec-review time** (the reviewer recomputed the above-minor lens set per rep and got this table exactly — 001 20/20, 002 41/50, 003 28/50, 007 42/50, 008 48/50, 009 20/20). The residual FAILs are the guard correctly biting on unconfirmed extras or a missed primary. The pinning is therefore already settled from the captures; the build does not re-read them (they are gitignored and do not travel into a fresh worktree — see §7).

| Case | `must_object` | `may_object` | Sweep behaviour under these bounds |
|---|---|---|---|
| `001` | `[architectural]` | `[infosec, QA]` | 20/20 emit `{architectural, infosec, QA}` → 20/20 PASS |
| `002` | `[infosec]` | `[architectural]` | 41/50 `{architectural, infosec}` PASS; 9/50 add an unconfirmed `QA` → correctly FAIL |
| `003` | `[methodology]` | `[architectural, QA]` | 28/50 PASS; 22/50 add an unconfirmed `infosec` → correctly FAIL |
| `007` | `[infosec]` | `[architectural, QA]` | 42/50 PASS; 8/50 drop the primary `infosec` → correctly FAIL (missed catch) |
| `008` | `[infosec]` | `[architectural, QA]` | 48/50 PASS; 2/50 miss `infosec` → FAIL |
| `009` | `[infosec]` | `[architectural, QA]` | 20/20 emit `{architectural, infosec, QA}` → 20/20 PASS |

Note the guard still bites: `002` does not tolerate `QA`, `003` does not tolerate `infosec`, and `007` still fails the eight reps that missed the real threat. That is the design working — post-fix `refutation-spec` accuracy lands around 0.65 by hand-count (from 0.196), and the remaining drag is skill over-firing on `004`/`006`/`010`, not oracle defect. The exact figure is the operator's to measure.

### 3.4 The `grouping-001` fixture widening (no grader change)

`gradeCoverage`/`entryMatches` (429-436, 402-405) already lowercase and substring-match, and the "leave-loose" bucket `[2]` is fine (44/50). Only two buckets are too literal. Widen the synonym sets in `eval/cases/grouping-001.json` to the phrasings the reps actually use (confirmed against the captures — models write `blockedBy`, `blocks`, "recover a locked-out account", "request a reset"):

- `must_include[0]` (password-reset) — append `"reset"`, `"recover"`. (Catches "request a reset", "reset their password", "recover a locked-out account", "recover a forgotten password". The existing `"password reset"` / `"account recovery"` synonyms match some reps but miss the paraphrases — bucket `[0]` sat at 15/50; the two appended stems lift it to catch the reset/recover phrasings.)
- `must_include[3]` (coherence edges) — append `"blockedby"`, `"blocks"`. (Catches the camelCase `blockedBy` and the `TCK-12 blocks TCK-11` phrasing; the existing `"blocked by"`/`"blocker"` matched neither.)

Leave `must_include[1]`, `must_include[2]`, and both `must_avoid` sets untouched. This is pure fixture work — `grouping` is not in `CLOSED_SET_KINDS` and its `gradeCoverage` branch (818-821) needs no change.

**Chosen:** widen `[0]` and `[3]` synonym sets only; no scorer change. The substring scorer is sound — the buckets were just spelled for one phrasing.

### 3.5 The triage flips

Edit entries in `eval/calibration/oracle-triage.json`. `test/oracle-triage.test.mjs` enforces present-iff field hygiene per class (oracle-defect ⇒ `proposed_fix` and no `discriminating_question`/`expected_signal`; needs-evidence ⇒ `discriminating_question`; suspected-genuine-miss ⇒ `expected_signal`), so each flip is a field swap, not just a class string:

| Entry | From → To | Field changes |
|---|---|---|
| `refutation-spec-001/002/003` | sound → oracle-defect | add `proposed_fix` (adopt `lens_bounds` per §3.3); rewrite rationale to the sweep evidence |
| `refutation-spec-007/008/009` | suspected-genuine-miss → oracle-defect | remove `expected_signal`; add `proposed_fix`; rewrite rationale (the suspicion is refuted — the lens objects, the oracle was over-narrow) |
| `grouping-001` | needs-evidence → oracle-defect | remove `discriminating_question`; add `proposed_fix` (widen `[0]`/`[3]`); rewrite rationale to the real buckets |
| `specqual-003` | needs-evidence → sound | remove `discriminating_question`; rewrite rationale (43/50 pass on the generalisation vocab; the 7 partials are variance) — no oracle change |

`refutation-spec-004` and all sound entries not listed stay exactly as they are.

**Provenance.** Every flipped entry rests on the paid sweep, but the artifact is framed as zero-rep static triage (`meta.method`, and `test/oracle-triage.test.mjs` asserts `meta.paid_model_reps === 0`, strict). To keep that honest without rewriting the FAFF-319/FAFF-670 history, add a new per-entry field `resolved_by: "FAFF-615"` on the eight touched entries and cite the sweep run id (`20260803-012238`) in each rewritten rationale. `meta.paid_model_reps` stays `0` — this artifact ran no reps, it read the operator's captures. Update `meta.method` with one clause noting that `resolved_by` entries were settled against those captures. See §6, Decision C.

The guard that keeps this honest must be **bidirectional and pinned to a concrete entry set**, not a soft "resolution outcome" predicate — the flipped entries land on two different classes (`grouping-001` and the six refutation-spec cases become `oracle-defect`; `specqual-003` becomes `sound`, joining 31 other `sound` entries that carry no `resolved_by`), so class alone cannot say which entries may carry the field. Pin it to the FAFF-615 `meta.extensions` record: that record lists exactly the eight resolved case ids, and the guard asserts **the set of entries carrying `resolved_by: "FAFF-615"` equals exactly that list** (every listed entry has it, no unlisted entry does), plus each such entry's value is the literal `"FAFF-615"` and its rationale cites the run id. That is enforceable in both directions and cannot be built toothless. See §6, Decision C.

### 3.6 Meta bookkeeping

- `meta.class_counts` is counted, not asserted (the test sums it against `entries.length`). New distribution: `sound: 32, oracle-defect: 9, needs-evidence: 0, suspected-genuine-miss: 0` (total 41, unchanged).
- Add a `meta.extensions` record for FAFF-615 carrying, at minimum, the ticket, the date, the run id (`20260803-012238`), and an **explicit list of the eight resolved case ids** (the three-way `001/002/003`, the `007/008/009`, `grouping-001`, `specqual-003`). The `resolved_by` guard keys on this list (§3.5), so it is load-bearing, not just a note. The extension test only deep-checks the FAFF-670 record, so adding this one is additive.
- `meta.follow_ups.resolve_undecided` still names FAFF-615 as pending; soften it to past-tense or fold it into the extension note. Not test-enforced beyond "names a FAFF ticket," so low-risk either way.

---

## 4. HOW — behaviour and the build order

**Approach.** Grader first, then fixtures, then triage, because the disk fixtures are validated on load (`loadCases()` → `validateCase`) — moving a fixture to `lens_bounds` before the grader understands it turns the whole suite red.

```
PROCEDURE build:
  1. grader (eval/grader.mjs):
     a. validateCase: for kind refutation-spec, accept EITHER closed_set XOR lens_bounds,
        exactly one populated; keep the fixture-shape (`spec`) check. Other kinds unchanged.
     b. grade(): BEFORE the CLOSED_SET_KINDS branch, add:
          if kind == "refutation-spec" AND oracle.lens_bounds present:
            predicted = predictedSet(c, env)        # reuse the existing above-minor arm
            ok = must_object ⊆ predicted  AND  predicted ⊆ (must_object ∪ may_object)
            return { graded: ok?PASS:FAIL, score: ok?1:0, tokens,
                     signature: JSON.stringify([...predicted].sort()) }
          # closed_set refutation-spec cases (005/006/010, 004) fall through to setEqual unchanged
  2. unit tests (test/eval-grader.test.mjs): the new branch (see §5).
  3. fixtures: rewrite the six refutation-spec oracles to lens_bounds (§3.3);
     widen grouping-001 (§3.4).
  4. triage (eval/calibration/oracle-triage.json): flip the eight entries + meta (§3.5, §3.6).
  5. run the full deterministic suite (node --test) green.
```

**Edge cases.**

- **`must_object` empty.** Disallowed — a clean case uses `closed_set: []`, not `lens_bounds`. `validateCase` should reject `lens_bounds` with an empty/absent `must_object` so the shape can't silently degrade into "tolerate everything."
- **Missing/garbage `env.objections`.** Already handled by `predictedSet` (returns `[]` on garbage). Under `lens_bounds`, `[]` fails the `must_object ⊆ predicted` clause → clean FAIL, no throw — same fail-safe stance as the `closed_set` path.
- **An out-of-enum lens** (e.g. `"vibes"`) rides through `predicted` verbatim, so it is not in `must_object ∪ may_object` → FAIL with a distinct signature. No coercion, matching the existing refutation-spec fail-safe (grader test line 303).

**Failure modes.**

- **The bounds are wrong because the reasoning-on grounding was wrong.** If an extra I tolerated (say `002`'s architectural) is actually the lens over-firing, `002` passes reps it should fail and the case stops guarding that axis. How you'd know: the operator's reasoning-on read of the tolerated reps disagrees with the adjudication. What it means: narrow the `may_object` set — the shape supports it, only the data would change. The risk is contained to the six cases and reversible.
- **`grouping` still scores low after widening.** If it does, the residual is bucket `[2]` (leave-loose) or a phrasing the two appended synonyms miss. How you'd know: the sweep's `grouping-001` reps that leave `TCK-31` unplaced still score 0 on `[2]`. What it means: that is a *different* oracle question (already `needs-evidence`-adjacent) — do not chase it here; the adjudication settled `[2]` as sound (44/50).

**Anti-pattern:** widening `may_object` to "whatever the sweep emitted." Why: that re-introduces the exact blind spot — `002`'s stray `QA` and `003`'s stray `infosec` would be tolerated and the over-fire guard would go dark. `may_object` is the *confirmed-grounded* set, full stop.

---

## 5. Scenarios — born-verifiable objectives

```
Given a refutation-spec case with oracle lens_bounds { must_object: [architectural], may_object: [infosec, QA] }
When the model objects on exactly {architectural, infosec, QA} above minor
Then grade() returns PASS
```

```
Given the same case
When the model also objects on methodology above minor (a lens outside must_object ∪ may_object)
Then grade() returns FAIL   # the bounded over-fire guard still bites
```

```
Given a refutation-spec case with oracle lens_bounds { must_object: [infosec], may_object: [architectural, QA] }
When the model objects only on {architectural, QA} above minor (the primary infosec lens is silent)
Then grade() returns FAIL   # missing a required lens is a missed catch, not tolerated
```

```
Given grouping-001 after the synonym widening
When a proposal writes "TCK-11 blockedBy TCK-12" and "users can recover a locked-out account"
Then must_include[0] and must_include[3] both match (no longer false-negatives)
```

- The triage flips leave `test/oracle-triage.test.mjs` green: zero needs-evidence and zero suspected-genuine-miss entries, every oracle-defect entry carrying a `proposed_fix`, `class_counts` summing to 41.
- Assertion: `005`/`006`/`010`/`004` oracles are byte-unchanged after the pass.
- Assertion: `refutation-spec` cases on `closed_set` still grade by strict `setEqual` (the existing grader tests at lines 264-308 stay green untouched).

---

## 6. Design decision rationale

**Decision A — the new oracle shape and its scoring.**
Options: (1) loosen `refutation-spec` set-equality globally to "primary lens is present, ignore extras"; (2) a bounded per-case `lens_bounds { must_object, may_object }` with a dedicated `grade()` branch.
Option 1 is less fixture work but fatal to the point of the cases — a refuter firing on all four lenses would pass every widened case, and there would be no way to express `002`'s "architectural is grounded but QA is not." Option 2 costs a new oracle field, a `validateCase` arm, a `grade()` branch, and unit tests, but it keeps over-fire detection alive and lets each case name exactly the grounded extras. The captures confirm the guard still bites under Option 2 (`002`/`003`/`007` still fail their unconfirmed-extra / missed-primary reps).
**Chosen:** Option 2 — `lens_bounds` with the bounded-subset grade. The extra fixture work buys back the guarantee these cases exist to provide.

**Decision B — `refutation-spec-004`.**
Options: (1) widen like the six, tolerating architectural/methodology; (2) keep it strict `closed_set: ["QA"]`.
The captures show `004` splitting 25/50 clean `[QA]` vs 25/50 adding architectural/methodology majors. Unlike `001/002/003/007/008/009` — which the adjudication affirmatively confirmed multiply-defective — there is no reasoning-on confirmation that `004`'s extras are grounded, and its fixture has one concrete defect axis (an unverifiable DONE = QA); "improve the map / adjust layout" reads as the lens padding an objection onto a thin spec, i.e. the over-firing `005/006/010` exist to catch. The risk is asymmetric: keeping it strict costs at most `004` sitting near 0.5 in the re-baseline (flagged, recoverable); widening it wrongly blinds the case to over-firing permanently.
**Chosen:** keep `004` strict `["QA"]`, class stays `sound`. If the operator's reasoning-on read of the extra-major reps later confirms the extras grounded, widen it then with the same `lens_bounds` shape (named in §2).

**Decision C — recording sweep-based resolution in a zero-rep artifact.**
Options: (1) re-point the flipped entries' `triage_ticket` to FAFF-615 and widen the test allow-set; (2) keep `triage_ticket` as original authorship and add a `resolved_by: "FAFF-615"` field plus a small guard.
Option 1 reads cleanly as "current owner," but `grouping-001` is the only FAFF-670 grouping entry, so re-pointing it forces editing FAFF-670's `extensions.kinds_added` (the corpus-derived equality `setEq(kinds_added, carried)` would otherwise break) — rewriting a historical record and losing the fact that FAFF-670 first triaged it. Option 2 leaves every existing invariant untouched (`provenance` still sees `triage_ticket ∈ {FAFF-319, FAFF-670}`; FAFF-670's `kinds_added` unchanged) and fits the artifact's mechanical-honesty ethos.
**Chosen:** Option 2 — `triage_ticket` stays as first-author provenance; `resolved_by: "FAFF-615"` carries the resolution, guarded by a new test (§7). `meta.paid_model_reps` stays `0` (the artifact consumed the operator's sweep, it did not run reps); `meta.method` gains one clause naming the captures.

---

## 7. Open questions and assumptions

**Open questions:** none. Every decision is closed above.

**Assumptions.**

- **Assumes:** the pinned `lens_bounds` values are correct against the sweep. *Validation:* settled at spec time — computed from the 2,210-rep captures (`.faff/eval-runs/20260803-012238/judgements.jsonl`) and independently reproduced at spec-review (the §3.3 table exactly). **The build does not re-read the captures:** `.faff/*` is gitignored, so the run dir does not travel into a fresh graft worktree. The bounds go in as settled values; if the operator later wants to re-confirm, they re-read the captures on the machine that holds them, not in the build. This is why §8's confirmation is a spec-time fact, not a build DONE item.
- **Assumes:** `predictedSet(c, env)` returns the deduped above-minor lens set for `refutation-spec` and is callable from the new `grade()` branch (same module). *Validation:* confirmed at `grader.mjs:637-642`; it is module-scoped, so the in-file branch calls it directly.
- **Assumes:** no CI guard pins the oracle JSON values or hashes the case-file contents. *Validation:* `eval-readme-freshness` keys off `cases.length`/kind count (unchanged — editing, not adding, files); `eval-baseline-gate` unit-tests the gate logic against an inline fixture; `oracle-triage.test` reads only kind/id sets and the class-hygiene fields. The build reruns the full suite to confirm.

---

## 8. DONE — definition of done

### From WHY / principles
- [ ] `refutation-spec` cases `005`/`006`/`010` and `004`, and `specqual-003`'s oracle, are byte-unchanged after the pass.
- [ ] No skill prompt is edited (grader + fixtures + triage only).

### From WHAT (oracle shape)
- [ ] `eval/grader.mjs` `validateCase` accepts a `refutation-spec` case populating exactly one of `closed_set` / `lens_bounds`, rejects a `lens_bounds` with empty/absent `must_object`, and keeps the `spec` fixture-shape check.
- [ ] `grade()` scores a `lens_bounds` case PASS iff `must_object ⊆ predicted ⊆ (must_object ∪ may_object)`, with signature `JSON.stringify([...predicted].sort())`; `closed_set` refutation-spec cases still grade by `setEqual`.

### From WHAT (fixtures)
- [ ] `refutation-spec-00{1,2,3,7,8,9}.json` carry the pinned `lens_bounds` values from §3.3 (and no longer carry `closed_set`).
- [ ] `grouping-001.json` `must_include[0]` includes `"reset"`, `"recover"`; `must_include[3]` includes `"blockedby"`, `"blocks"`; all other rubric sets unchanged.

### From WHAT (triage + meta)
- [ ] `001/002/003` → oracle-defect (with `proposed_fix`, no `discriminating_question`/`expected_signal`); `007/008/009` → oracle-defect (`expected_signal` removed); `grouping-001` → oracle-defect (`discriminating_question` removed); `specqual-003` → sound (`discriminating_question` removed).
- [ ] The eight flipped entries carry `resolved_by: "FAFF-615"` and cite run `20260803-012238` in their rationale; `meta.paid_model_reps` is still `0`; `meta.method` names the captures.
- [ ] `meta.class_counts` = `{ sound: 32, oracle-defect: 9, needs-evidence: 0, suspected-genuine-miss: 0 }`; a FAFF-615 `meta.extensions` record is present.

### From HOW (tests + guards)
- [ ] New `test/eval-grader.test.mjs` cases cover: primary-plus-tolerated → PASS; a lens outside the bounds → FAIL; a missing required lens → FAIL; missing/garbage `objections` → clean FAIL (no throw); `validateCase` accepts `lens_bounds` and rejects empty `must_object`.
- [ ] A new `test/oracle-triage.test.mjs` guard, **bidirectional and pinned to the FAFF-615 `meta.extensions` case list**: the set of entries carrying `resolved_by` equals exactly that list (every listed entry carries it, no unlisted entry does), each such value is the literal `"FAFF-615"`, and each such entry's rationale cites run `20260803-012238`.
- [ ] `test/oracle-triage.test.mjs`, `test/eval-grader.test.mjs`, `test/eval-readme-freshness.test.mjs`, `test/eval-baseline-gate.test.mjs` all green; full `node --test` suite green before and after.

### Follow-on (not this build)
- [ ] Operator re-baselines `eval/baselines/frontier.json` via the `eval/README.md` runbook — named as the successor step, not gated here.

**Integration smoke:**
```
node --test test/eval-grader.test.mjs test/oracle-triage.test.mjs
# then the full suite:
node --test
# expect: green; loadCases() still returns 79 cases, all validating.
```

---

## Methodology critique

*(agile-delivery lens, issue-level. Surfaced for the human — does not gate this high-confidence promotion.)*

**Right-sizing — one unit, correctly kept whole.** The change spans a grader branch, six refutation-spec fixtures, the grouping-001 fixture, eight triage flips, meta bookkeeping, and two test additions — on the larger side for one ticket, but these ship together or not at all: flipping a triage entry to `oracle-defect` while its oracle stays un-widened would be a false record, and widening the oracle without flipping the triage leaves the sweep's own accounting stale. The one severable slice (the grouping-001 synonym widening) is two lines and rides the same evidence toward the same outcome, so folding it in is right. No split.

**Workstream fit — no issues.** Everything converges on one outcome: the operator's next sweep measures the skills, not the graders' blind spots. The scope discipline is a good signal in itself — the paid re-baseline is pushed to the operator, and the binary-grade / free-text mismatch is carved to FAFF-692 rather than bundled.

**Surfaced dependencies — one downstream gap.** The DONE list names the operator re-baseline as the successor step but cites no ticket for it. This ticket exists to close the loop FAFF-319/FAFF-670 left open, and it hands the next hop back to prose in a checklist that nothing tracks — once this lands green, the sweep that actually makes the work pay off has no tracked home to be picked up from. *What to do:* file (or link) the re-baseline as a downstream ticket `blockedBy` FAFF-615. (Handled at chain-to-build — see the orchestrator note below.) The FAFF-319/FAFF-670 lineage and the FAFF-692 carve-out need no links.

**Risk profile — the captures-reachability point, now folded into the spec.** The load-bearing `lens_bounds` design is low-novelty and well de-risked (unit tests + the bounds reproduced at review). The one real risk the lens caught — that the "confirm bounds against the captures" step can't run in a fresh worktree because `.faff/` is gitignored — is now resolved in §3.3/§7: the bounds are settled at spec time and the build does not re-read the captures. No residual risk action.

---

confidence: high
spec-review: approve
