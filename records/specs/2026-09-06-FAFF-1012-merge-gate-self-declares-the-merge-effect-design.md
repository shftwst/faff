# Spec — FAFF-1012: merge-gate self-declares the merge effect it performs

> Spec: faffter-noon-spec · 2026-09-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1012.

## WHY — problem and principles

`faff merge-gate --execute` performs the gated merge (`gh pr merge` at merge-gate.js:1303) and then **only observes** the resulting effect into the effects ledger (`observeMergeEffects` at :1320 and :1335). The *declaration* that covers that observe (`faff effects declare --step merge`) is a **separate** step. The autonomous beep-boop/graft flow wires it in (graft Step 10; the landing-comment merge-ok template prints a paired `faff effects declare` heredoc at landing-comment.js:103-105 immediately above its `faff merge-gate --run-dir … --execute` line at :106-107). A hand-driven land can still skip the declare: a human who runs `faff merge-gate --run-dir <anchor> --execute` (the merge-ok shape) without first running the declare heredoc above it lands the merge with an **uncovered observe**. `faff audit` (audit.js `accountHumanMerge` :80-92) and `faff effects check` (`computeEscapes`, effects.js:87-104) then see an observe with no covering declare: an escaped side-effect. This is what happened on the FAFF-1005 graft (PR #869): a hand-driven `--execute` without the prior declare.

The non-graft/human-override template (landing-comment.js:95-97) is **not** the vector. It omits `--run-dir`, so `faff merge-gate` returns 2 at merge-gate.js:1145 (`--pr, --issue and --run-dir are required`) before any merge. The working vector is the hand-driven `--run-dir … --execute` land above.

**Fix:** when merge-gate itself performs the merge, it ensures a covering merge-effect declaration in the same ledger it observes into, closing the escape **structurally** at the actor that both performs the merge and holds the `(issue, step="merge", target=pr:N)` tuple, rather than depending on a prior manual step.

**Principles**
- **Fix the automation gap, never add a manual workaround.** The escape is closed inside merge-gate's execute path; no new operator verb/flag/reminder.
- **The ledger append is a best-effort audit nicety, never a merge gate.** An unwritable run dir must merge exactly as today, mirroring `observeMergeEffects`'s swallow-to-stderr (exercised by the :1736 selftest).
- **Declare and observe cover the identical descriptor set.** Asymmetry would let a leg (e.g. branch-delete) escape on its own.
- **Idempotent top-up, reusing the existing coverage rule.** The autonomous/templated path already declares; the fix must not double-write there.
- **The self-declare must stay auditable.** Because merge-gate now writes both halves for the merge step, a mechanically-minted declare is marked so an audit consumer can still tell a genuine pre-merge operator/orchestrator declare from a mechanical top-up (see decision 3).

### Out of scope
| Excluded | Why | Extension point |
|---|---|---|
| Auto-declare on the `--local` git-only path | `cmdMergeGateLocal` emits **no** merge observe (audit.js:93-96 treats `merge-record.json` as the landing); nothing to cover, no escape exists there | If a local observe is ever added, apply the same fold in that path's post-merge tail |
| Removing the manual declare from landing-comment templates | Behaviour-preserving; the templates staying is what keeps the top-up idempotent (they declare, merge-gate no-ops) and they still document intent for a fully-manual land | A later ticket may trim landing-comment.js:92-97/103-105 once merge-gate auto-declare is trusted |
| Changing `computeEscapes` / `audit` coverage semantics | The escape is a *missing declare*, not a matching-rule bug; the matcher (`effectTargetMatches`) is correct. The new `origin` marker is additive and read by no coverage check | n/a: reuse the existing rule unchanged |
| Making the declare/merge atomic or transactional | Best-effort posture (principle above); a declare TOCTOU or failure never affects the already-final merge outcome | n/a: deliberate |
| Inverting ADR-0064 for any chokepoint other than merge | The self-declare carve-out is scoped to the merge chokepoint alone; the declare-outside-the-actor rule still binds every other (label-write, tracker-write, worktree-prune) | The amending ADR (decision 2) records the scope of the carve-out |
| The FAFF-1013 `--execute`-required change | Separate ticket over the same execute seam; independent | Tracked as FAFF-1013 |

## WHAT — vocabulary, interfaces, decisions

**Existing seams reused (no new runtime imports; one selftest-only add):**
- `mergeEffectsFor(pr, deleteBranch, headRefName)` (merge-gate.js:712-716) → `[{kind:"merge",target:"pr:N",reversible:true}]` plus an optional `{kind:"branch-delete",target:headRefName}`. Already the exact descriptor set passed to `observeMergeEffects` at both call sites.
- `appendEffectEntries(runDir, kindOfEntry, issue, step, effects, ts)` (effects.js:509-529): the shared ledger-append core; already imported into merge-gate and already used with `kindOfEntry="declare"` in the observe selftest (:1730). Validates all-or-nothing, appends under lock. `effects.length===0` → touches nothing (:516). Record shape at :523-526 is `{schema:2, run_id, seq, ts, kind_of_entry, issue, step, effect:normEffect(...), prev}`.
- `effectTargetMatches(declared, observed)` (effects.js:81-83): exact-string-or-`"*"` match; already imported into merge-gate (`warnUncoveredMergeObserves` uses it at :736). The same rule `computeEscapes` and `audit` use.
- The ledger read inside `warnUncoveredMergeObserves` (:724-741): reads `declared-effects.jsonl`, filters `kind_of_entry==="declare" && issue===issue && step==="merge"`, maps to `.effect`. Swallows read/parse errors to `[]`.

**Decisions**

1. **Where the auto-declare fires: inside `observeMergeEffects`, before the observe append.**
   **Chosen:** Fold the auto-declare into `observeMergeEffects(runDir, issue, effects)` as its first action, ahead of `warnUncoveredMergeObserves` and the observe `appendEffectEntries`. Both post-merge observe call sites route through this one function: the post-merge-step-failed path (:1320, merge-only descriptors) and the clean-success tail (:1335, merge plus optional branch-delete). The human-override execute path writes `merge-gate-override.json` (:1278) then **falls through** to the same `gh pr merge` spawn (:1303) and the same tails, so it is covered with no extra code. `--check-only` returns at :1288 **before** the spawn, so it never declares (correct, nothing merged). One chokepoint means one place to reason about, adjacent to the existing observe selftests (:1727-1755).

2. **The authority-split inversion: merge-gate becomes declarer-and-observer for the merge it performs; record it in an ADR, not just a code comment.**
   **Chosen (both parts):**
   (a) **Author an ADR** (via the `adr` producer at graft) in `records/adr/` at the next sequential number (0124 at time of writing) that **amends** ADR-0064 (`records/adr/0064-effects-instrumentation-authority-split-declares-from-outside-the-actor-observes.md`, currently status Proposed). ADR-0064's Consequences (:27) name the sanctioned fix for a missed declare as "making the graft-side declare more mechanical … never … having the chokepoint self-declare". FAFF-1012 overturns exactly that clause **for the merge chokepoint only**. The amending ADR must state: the merge chokepoint alone is granted an idempotent mechanical self-declare; the declare-outside-the-actor rule still binds every other effects-producer chokepoint (label-write, tracker-write, `worktree-prune`); the escape signal for the merge step is deliberately traded for a structural guarantee (no escaped merge observe can occur) plus the `origin` marker (decision 3), which preserves the audit distinction ADR-0064 was protecting (a genuine pre-merge declare of intent versus a mechanical top-up). It references ADR-0064 by path.
   (b) **Rewrite the FAFF-383 authority-split header** (merge-gate.js:700-706). Today it states "graft Step 10 owns the DECLARE, before invoking this CLI … never here." Rewrite it to describe merge-gate's declarer-and-observer role for the merge it itself performs: it mints a covering `declare` (idempotent top-up, `origin:"merge-gate-auto"`) for the effect set it is about to observe, because merge-gate is the single component that both performs the merge and holds the `(issue, step="merge", target=pr:N)` tuple. Preserved invariants: still strictly after the verdict is decided; still swallow-to-stderr on any failure; still never touches verdict/exit/emitted JSON. Point the header at the amending ADR.

3. **Mechanical-declare provenance marker: `origin:"merge-gate-auto"` on the declare record.**
   **Chosen:** The auto-declare's `declare` record carries a **record-level** field `origin:"merge-gate-auto"`. It lands on the ledger record, **not** on the effect descriptor: `normEffect` (effects.js:75-77) reconstructs the effect as exactly `{kind,target,reversible}`, so an effect-level field would be stripped. It cannot ride the target either, or `effectTargetMatches` (exact string) would stop covering the observe. Coverage is preserved because every coverage check reads only effect fields and the entry envelope, never `origin`: `computeEscapes` (effects.js:99-100), `warnUncoveredMergeObserves` (:736), and `audit.accountHumanMerge` (:80-82). A mechanically-minted declare and an operator declare both count as covering; an audit consumer filters mechanical top-ups by `record.origin === "merge-gate-auto"` (operator/orchestrator declares carry no `origin`). This is what keeps the escape signal meaningful under the inversion: `computeEscapes` can no longer raise a merge escape, but audit can still see whether a genuine pre-merge declare existed or only a mechanical one.

4. **Double-write reconciliation: idempotent top-up (declare only the uncovered subset).**
   **Chosen:** Before observing, re-read the ledger (the same read `warnUncoveredMergeObserves` already performs) and declare **only** the effects for which no covering declaration exists (`effectTargetMatches`, same rule). If graft Step 10 or a landing-comment template already declared, the uncovered set is empty → `appendEffectEntries` is called with `[]` → touches nothing (effects.js:516) → **no duplicate line**. In the hand-driven skip case, the missing declare is minted (carrying the `origin` marker). Coverage is idempotent either way (audit.js:80-82 and `computeEscapes` use existence checks), so a duplicate would not escape; the top-up keeps the hash-chained ledger free of redundant declares in the common already-declared path and reuses the covered-check the codebase already trusts. The read-then-write is a benign TOCTOU: this is best-effort advisory, never a gate, so a racing declare at worst yields one harmless extra line.

5. **Scope of effects: declare covers the SAME descriptor set as the observe.**
   **Chosen:** Pass the *identical* `mergeEffectsFor(...)` return to both the auto-declare and the observe (they already share the value at each call site). Post-merge-step-failed: `mergeEffectsFor(pr, false, headRefName)` (merge only), matching :1320. Clean success: `mergeEffectsFor(pr, resolved.flags.includes("--delete-branch"), headRefName)` (merge plus branch-delete iff requested), matching :1335. This guarantees the branch-delete leg is declared exactly when it is observed, so no descriptor observes uncovered.

6. **Failure posture: best-effort; never blocks the merge.**
   **Chosen:** The auto-declare is a ledger append under a lock; any failure (unwritable run dir, lock error, append throw) is swallowed to a single stderr line, exactly like the existing observe swallow (:756-758, asserted by the :1736 unwritable-dir selftest). It runs in its **own** try/catch so a declare failure never skips the observe that follows. The declaration is an audit-trail nicety; it is **never** a merge gate. The merge outcome is already final by the time this region runs.

### Assumptions
**Assumes:** No shipped caller relies on merge-gate's execute path emitting *only* an observe (no declare). Verified: `warnUncoveredMergeObserves`/`observeMergeEffects` are advisory-only (:700-706 header, stderr-only), and the only ledger consumers (`computeEscapes`, `audit.accountHumanMerge`) treat an additional declare as strictly coverage-positive. The `origin` marker is additive; no consumer reads it today, so adding it cannot regress an existing consumer.

## HOW — behaviour and exact placement

**Extract the ledger read** (small refactor, no behaviour change): pull the "read declared merge-effect descriptors" block out of `warnUncoveredMergeObserves` (:725-733) into a helper `readDeclaredMergeEffects(runDir, issue) → EffectDescriptor[]` (swallows read/parse errors to `[]`, same as today). `warnUncoveredMergeObserves` then calls it; so does the new auto-declare. One read, one covered-rule.

**Thread an optional record-field into the shared writer** (effects.js): add an optional trailing param to `appendEffectEntries` (e.g. `recordFields`, default `{}`) that is spread into each minted record. To keep the reserved envelope inviolable, spread `recordFields` **first**, then the reserved keys, so a caller can only add non-reserved fields:

```
(index, seq, _prevRecord, prevHash) => ({
    ...(recordFields || {}),
    schema: 2, run_id: runId, seq, ts: ts || new Date().toISOString(),
    kind_of_entry: kindOfEntry, issue, step, effect: normEffect(effects[index]), prev: prevHash,
})
```

For every existing caller (`cmdEffects` declare/observe, merge-gate's observe) `recordFields` is absent → spread of `{}` → the JSON is byte-identical → the hash chain is unchanged → the effects.js batch/chain/all-or-nothing selftests (:749-776) still pass. Only merge-gate's auto-declare passes a value.

**New function** (adjacent to `warnUncoveredMergeObserves`):

```
function autoDeclareMergeEffects(runDir, issue, effects):
    declared = readDeclaredMergeEffects(runDir, issue)      # swallows read errors -> []
    uncovered = [ eff for eff in effects
                  if not any( d.kind == eff.kind
                              and effectTargetMatches(d.target, eff.target)
                              for d in declared ) ]
    if uncovered is empty: return                           # already covered -> no duplicate
    result = appendEffectEntries(runDir, "declare", issue, "merge", uncovered,
                                 undefined, { origin: "merge-gate-auto" })
    if result.violations:                                   # never for faff-built descriptors
        stderr("faff merge-gate: effects ledger declare rejected internally-built descriptors: ...")
```

**Fold into `observeMergeEffects`** (:747-759): auto-declare first, in its own swallow, then the unchanged observe:

```
function observeMergeEffects(runDir, issue, effects):
    try: autoDeclareMergeEffects(runDir, issue, effects)
    catch e: stderr("faff merge-gate: effects ledger auto-declare failed (merge outcome unaffected): " + e.message)
    try:
        warnUncoveredMergeObserves(runDir, issue, effects)   # now finds everything covered on success -> silent
        result = appendEffectEntries(runDir, "observe", issue, "merge", effects)
        ... (unchanged violation surfacing)
    catch e: stderr("faff merge-gate: effects ledger observe failed (merge outcome unaffected): " + e.message)
```

Both :1320 and :1335 already call `observeMergeEffects` with the correct `mergeEffectsFor(...)` set, so **no edit to the execute-path body is required**: only the header comment (decision 2b), the folded function, and the shared-writer param. The human-override fall-through (:1272-1280 → :1303 → :1335) inherits the fix.

**Header comment (decision 2b):** rewrite merge-gate.js:700-706 to describe the declarer-and-observer role, the idempotent top-up, the `origin` marker, and the preserved after-verdict / swallow-only / verdict-untouched invariants. Point it at the amending ADR.

**Interaction / edge cases**
- **Warn goes quiet on success.** After auto-declare covers everything, `warnUncoveredMergeObserves` finds all effects covered and emits nothing (the nag existed precisely because the declare could be missing). It still fires if the auto-declare *failed*: on an unwritable dir the read returns `[]`, the warn fires, and the observe then fails too, a truthful "this escaped" signal on a broken ledger.
- **Templated path unchanged.** The landing-comment merge-ok/non-graft templates keep their manual declare (which carries no `origin`); merge-gate's top-up sees it covered and writes nothing extra.
- **Ordering within the lock.** declare then observe are two separate `appendEffectEntries` calls (two lock acquisitions), matching the declare-before-observe ordering the :1730-1733 selftest already exercises.

## Scenarios

```
Given a run dir whose ledger has NO declare for (issue, step="merge")
When merge-gate --execute performs the merge and reaches observeMergeEffects
Then the ledger ends with a "declare" record (origin="merge-gate-auto") AND an "observe" record
     for kind="merge" target="pr:N", and computeEscapes(ledger, issue) reports no escape at step "merge"
```

```
Given a run dir whose ledger ALREADY has a covering operator declare for (issue, step="merge", merge pr:N)
When merge-gate --execute performs the merge and reaches observeMergeEffects
Then no second "declare" record is appended (idempotent top-up),
     the observe still reads as covered, and the sole declare carries no origin marker
```

```
Given a clean-success merge whose merge-args carried --delete-branch (headRefName known)
When observeMergeEffects runs with mergeEffectsFor(pr, true, headRefName)
Then both the merge and the branch-delete descriptors are declared (origin="merge-gate-auto") AND observed,
     so neither leg escapes
```

```
Given an unwritable / nonexistent run dir
When observeMergeEffects runs (auto-declare then observe both fail)
Then neither throws; the auto-declare-failed line, the "no covering declaration" warn line, and the
     observe-failed line all appear on stderr, and the merge outcome is unaffected
```

- **Assertion (non-functional):** the auto-declare never alters merge-gate's verdict, exit code, or emitted JSON. It runs strictly after the verdict is decided and only appends to the ledger.

## Acceptance criteria

- [ ] A `readDeclaredMergeEffects(runDir, issue)` helper exists (extracted from `warnUncoveredMergeObserves`), returns the declared merge-step effect descriptors, swallows read/parse errors to `[]`, and `warnUncoveredMergeObserves` uses it.
- [ ] `appendEffectEntries` accepts an optional record-field argument spread into each record such that reserved envelope keys (`schema`, `run_id`, `seq`, `ts`, `kind_of_entry`, `issue`, `step`, `effect`, `prev`) cannot be overridden; when absent, records are byte-identical to today and the effects.js chain/batch selftests (:749-776) still pass.
- [ ] `observeMergeEffects` auto-declares the uncovered subset of its `effects` into `(issue, step="merge")` **before** appending the observe, in its own try/catch; each auto-minted declare record carries `origin:"merge-gate-auto"`.
- [ ] **Covered-after-execute selftest** (near :1727): starting from a ledger with no declare, after `observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9,false,null))` the ledger contains exactly one `declare` (with `origin:"merge-gate-auto"`) and one `observe` for `merge`/`pr:9`, and `computeEscapes(entries, "FAFF-9")` (imported from `./effects` for the test) reports **no** escape at step `merge`.
- [ ] **Idempotent-top-up selftest**: with a pre-existing operator `declare` for `merge`/`pr:9` already in the ledger (no `origin` field), `observeMergeEffects` appends **no** additional `declare` line (declare count stays 1, still no `origin`) and one `observe` line is added.
- [ ] **Branch-delete symmetry selftest**: `observeMergeEffects(tmp, issue, mergeEffectsFor(9,true,"faff-9-x"))` yields a `declare` (origin marked) **and** an `observe` for both `merge pr:9` and `branch-delete faff-9-x`; `computeEscapes` reports no escape.
- [ ] **Warn-goes-quiet selftest** (repurpose the current uncovered-warning check at :1746/:1753): on a writable empty-ledger dir, `observeMergeEffects` auto-declares and `warnUncoveredMergeObserves` stays silent (assert the substring `no covering declaration` is **absent** from stderr), and the ledger ends covered.
- [ ] **Unwritable-dir selftest** (extend :1736): `observeMergeEffects("/nonexistent/…", …)` does not throw and the merge path is unaffected; stderr carries the auto-declare-failed line, the exact `observed merge pr:9 with no covering declaration — declare it at graft Step 10` warning text (the message regression guard relocated here), and the observe-failed line, proving the declare failure does not skip the observe.
- [ ] **CLI covered test unchanged** (test/merge-gate-controlflow.test.mjs:719-745): a covering operator declare plus `merge-gate --execute` still lands exactly one declare plus one observe (ledger length stays 2), no `no covering declaration` warning, and `effects check` reports `any_escape:false`.
- [ ] **CLI no-declare test repurposed** (test/merge-gate-controlflow.test.mjs:747-769): a `merge-gate --execute` with **no** prior declare now auto-covers: the ledger ends with a `declare` (`kind_of_entry:"declare"`, `origin:"merge-gate-auto"`) plus an `observe` (length 2), no `no covering declaration` warning fires, and `effects check` reports `any_escape:false` (replacing the old length-1 / warning / `any_escape:true` assertions).
- [ ] **Audit-distinguishability AC**: an audit consumer can filter mechanical top-ups by `record.origin === "merge-gate-auto"` while both operator and mechanical declares count as covering; `audit.accountHumanMerge` and `computeEscapes` behaviour is unchanged by the marker (their existing selftests still pass).
- [ ] The FAFF-383 authority-split header (merge-gate.js:700-706) is rewritten to describe merge-gate's declarer-and-observer role, the idempotent top-up, the `origin` marker, and the preserved after-verdict / swallow-only / verdict-untouched invariants, and points at the amending ADR.
- [ ] An ADR is authored in `records/adr/` (next sequential number, 0124 at time of writing) that amends ADR-0064, records the merge-chokepoint self-declare carve-out (and that the rule still binds every other chokepoint), overturns ADR-0064's "never … having the chokepoint self-declare" clause for merge only, records the `origin` marker as the audit-distinction mitigation, and references `records/adr/0064-effects-instrumentation-authority-split-declares-from-outside-the-actor-observes.md`.
- [ ] No change to merge-gate's verdict, exit code, or emitted JSON for any path (existing floor/verdict selftests still pass); `--check-only` writes no declare (returns before the merge spawn at :1288).
- [ ] `faff merge-gate --selftest` passes with the new checks; no new runtime import beyond the selftest-only `computeEscapes` (`appendEffectEntries` and `effectTargetMatches` are already imported).

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"kind":"Chosen","topic":"Auto-declare placement: fold into observeMergeEffects before the observe append"},{"kind":"Chosen","topic":"Authority-split inversion: merge-gate becomes declarer-and-observer for merge; author an ADR amending ADR-0064 and rewrite the :700-706 header"},{"kind":"Chosen","topic":"Mechanical-declare provenance marker: record-level origin merge-gate-auto on the auto-declare, additive and ignored by every coverage check"},{"kind":"Chosen","topic":"Double-write: idempotent top-up, declare only the uncovered subset via a fresh ledger read"},{"kind":"Chosen","topic":"Scope of effects: auto-declare covers the same descriptor set as the observe"},{"kind":"Chosen","topic":"Failure posture: best-effort append, swallow-to-stderr, never blocks the merge; own try/catch"},{"kind":"Assumes","topic":"No shipped caller relies on execute emitting only an observe; the origin marker is read by no current consumer"}]}
```

## Methodology critique

Right-sized: yes, one cohesive change (close the escaped-side-effect gap at the merge chokepoint). Sibling of [FAFF-1013](https://linear.app/shftwst/issue/FAFF-1013) on the same `merge-gate` execute seam. **Keep separate** (distinct concern: audit-coverage vs FAFF-1013's irreversibility-default), with the existing relates-to link. **Land FAFF-1012 first** — it rewrites the FAFF-383 `effArgs` test block (`merge-gate-controlflow.test.mjs:716-769`); FAFF-1013 then rebases onto it and adds `--execute` to the already-rewritten helper. Deps: none blocking (FAFF-1013 has the soft rebase dependency, captured in its own Assumes marker). Risk: touches the most safety-critical path (merge), mitigated by best-effort/never-gates posture + the ADR-0064 amendment + the `origin` audit marker.
