# nlspec — FAFF-1045: `runcheck.js` completeness predicate must use an own-key check, not `in`

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1045.

**Artifact.** This is a buildable spec for a single-line correctness fix plus its regression coverage in `plugin/skills/faff/bin/lib/runcheck.js`. **Audience:** the build agent implementing the fix, and the human reviewer confirming it mirrors the already-shipped sibling FAFF-1024. This is a mechanical bug fix with a Done reference implementation in the sibling reader — the approach is settled, not open.

---

## 1. WHY — Problem and Principles

**Load-bearing model.** A run ledger's `outcomes` is a plain JavaScript object literal, so it inherits from `Object.prototype`. The `in` operator walks the prototype chain: `"constructor" in outcomes`, `"toString" in outcomes`, `"hasOwnProperty" in outcomes` are all `true` even when `outcomes` is `{}`. The completeness predicate in `runcheck.js` uses `in` to decide which admitted issue ids still need dispatching — so an admitted issue id equal to any inherited `Object.prototype` key is silently treated as already-dispatched-with-a-recorded-outcome, and drops out of the undispatched set. The correct test asks whether the object has that key *as its own*, which is exactly what `Object.hasOwn(outcomes, i)` answers.

**Problem statement.** `runcheck` is the mechanical backstop for faff's "never silently defer the queue" guarantee, yet its own completeness core `auditLedger` computes `undispatched = admitted.filter((i) => !(i in outcomes))` (line 36) using the prototype-chain-walking `in`. An owned run whose queue still holds an issue id like `constructor` therefore audits as drained (`clean: true`), and the Stop-hook backstop `runcheckHookDecision` does NOT block — the precise silently-deferred-queue failure runcheck exists to catch. This change replaces that one predicate with an own-key test and adds a regression proving a prototype-colliding undispatched id is caught.

**Design principles.**

**Keep the fix to the single defective predicate.** Only line 36 carries the defect. The sibling `invalid` computation (lines 45–52) already enumerates own enumerable keys via `Object.entries(outcomes)` and is safe; do not touch it. Widening the change beyond line 36 risks regressing already-correct behaviour for no gain.

**Fix the shared core, not each caller.** `auditLedger` is the single completeness core, re-exported and consumed directly by `governance-check.js`, `disposition.js`, and `audit.js`. Correcting line 36 inside `auditLedger` fixes every consumer at once; do not add per-consumer guards.

**Mirror the shipped sibling, don't re-derive it.** FAFF-1024 fixed the identical defect class in `run-ledger.js`'s `applyTerminalOutcome` with `Object.hasOwn` and left an in-code comment explicitly naming this `runcheck.js` predicate as the remaining sibling. Use the same operator and the same regression shape (`constructor`-id fixture) so the two readers visibly agree.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/runcheck.js` (`auditLedger`, line 36) | JavaScript (CommonJS) | The defect site; the completeness core being fixed |
| `plugin/skills/faff/bin/lib/run-ledger.js` (`applyTerminalOutcome`, line 169) | JavaScript (CommonJS) | The already-shipped sibling fix (FAFF-1024, PR #883) — the pattern to mirror, incl. its `protoCollision` regression |
| `plugin/skills/faff/bin/lib/runcheck.js` (`RUNCHECK_SELFTEST_CASES`, lines ~298–358) | JavaScript | In-file selftest table driving `runcheckHookDecision`; regression home |
| `test/runcheck-gate.test.mjs` | JavaScript (node:test, `.mjs`) | Real-entrypoint gate tests; optional second regression home |

**Scope statement.** This sits at the completeness-audit core of the beep-boop run backstop; it hardens `auditLedger`'s undispatched computation against prototype-key collisions without altering any other audit, gate, or hook behaviour.

---

## 2. OUT OF SCOPE

- **The `invalid_outcomes` computation (lines 45–52).** Why excluded: it already uses `Object.entries(outcomes)`, which enumerates own enumerable keys only, so it carries no prototype-chain defect. Extension point: none needed — if a future issue ever changes that computation, it lives at the same `auditLedger` site.
- **`run-ledger.js`'s `applyTerminalOutcome`.** Why excluded: it was already fixed under FAFF-1024 (PR #883) via `Object.hasOwn`. Extension point: `plugin/skills/faff/bin/lib/run-ledger.js` line 169 — no change required, cited here only as the reference.
- **The ownership/liveness gate logic (`runIsOwned`, `runIsHeld`, `runcheckHookDecision` branches).** Why excluded: the defect is purely in the undispatched-set computation; the gate's block/warn/silent decision tree is unaffected by the fix beyond receiving a correctly-populated `undispatched`. Extension point: `runcheckHookDecision` in the same file.
- **Any change to the persisted ledger schema or the `outcomes` value contract.** Why excluded: this is a read-side predicate correction; the fixture shapes are unchanged. Extension point: `governance-profile.js` (`DELIVERY_PROFILE.terminal_states`) governs the outcome vocabulary if that ever needs to change.
- **Migrating other `in`-operator uses elsewhere in the codebase.** Why excluded: FAFF-1045 is scoped to this one predicate discovered as FAFF-1024's sibling; a broad `in`-audit is a separate concern. Extension point: a future backlog sweep, not this ticket.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| unit / issue id | The key a run admits and resolves; an entry in `admitted[]` and a key in `outcomes{}` (the governance core's "unit"; faff-the-factory's "issue id") |
| own-key check | A test for whether a key exists *directly on* an object, excluding inherited prototype keys — `Object.hasOwn(obj, k)` |
| prototype-colliding id | An admitted issue id whose string value equals an inherited `Object.prototype` key (`constructor`, `toString`, `hasOwnProperty`, `valueOf`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__proto__`, …) |
| undispatched | Admitted ids with no recorded terminal outcome; the set whose non-emptiness means the queue is not drained |

**Behavioural surface of `auditLedger` (unchanged signature, corrected internals).**

```
FUNCTION auditLedger(data, label, profile) -> Result
  admitted         : deduped list of data.admitted (unchanged)
  outcomes         : data.outcomes ?? {}  (a plain object; inherits Object.prototype)
  undispatched     : admitted ids for which outcomes has NO OWN key   # ← the corrected line
  invalid_outcomes : own-key entries whose value is not a terminal-state string (unchanged)
  clean            : undispatched.length == 0 AND invalid_outcomes.length == 0 (unchanged)

  INVARIANT: an admitted id equal to an inherited Object.prototype key
             (e.g. "constructor") with NO own outcome entry MUST appear in undispatched.
```

**Design decision — which key-presence test.**
- `Object.hasOwn(outcomes, i)` — reads exactly as "does `outcomes` have its own key `i`"; the operator FAFF-1024 already shipped in the sibling; requires Node ≥ 16.4 (satisfied — the sibling already uses it in this same package).
- `Object.prototype.hasOwnProperty.call(outcomes, i)` — equivalent semantics, older-runtime-safe, but more verbose and NOT what the sibling uses.
- `in` (status quo) — defective: walks the prototype chain.

**Chosen:** `Object.hasOwn(outcomes, i)` — byte-for-byte the operator the sibling `applyTerminalOutcome` (FAFF-1024, line 169) already uses in the same package, so the two readers visibly agree and no new runtime-version assumption is introduced.

---

## 4. HOW — Behavior

**Architecture and approach.** One predicate changes. In `auditLedger`, line 36:

```
BEFORE:  const undispatched = admitted.filter((i) => !(i in outcomes));
AFTER:   const undispatched = admitted.filter((i) => !Object.hasOwn(outcomes, i));
```

Everything downstream (`clean`, `runcheckReason`, `runcheckHookDecision`'s block/warn/silent tree, the human report in `cmdRuncheck`, and the three consumer modules) is unchanged and simply receives a correctly-populated `undispatched`.

**Behaviour summary.** With the own-key test, an admitted id is undispatched unless `outcomes` records a terminal outcome *for that exact id as its own property* — inherited prototype keys no longer masquerade as recorded outcomes.

```
PROCEDURE compute_undispatched(admitted, outcomes):
  FOR each id IN admitted:
    IF Object.hasOwn(outcomes, id) is FALSE:
      id is UNDISPATCHED        # includes "constructor" when outcomes = {}
    ELSE:
      id is dispatched          # only a real own-key recording counts
```

**Recommended in-code anchor.** Add a one-line comment at the fix site pointing to the sibling, mirroring the sibling's own back-reference, e.g. `// Object.hasOwn, NOT 'in' — 'in' walks the prototype chain, so an admitted id equal to an inherited Object.prototype key ("constructor", …) would read as dispatched with zero recorded outcome (FAFF-1045; sibling fix run-ledger.js applyTerminalOutcome, FAFF-1024).` This keeps the two readers cross-referenced. (Style: keep it to the repo's existing terse single-line comment idiom; do not add a changelog block.)

**Edge cases.**
- **Empty `outcomes` (`{}`) with an ordinary id (e.g. `"X"`):** `Object.hasOwn({}, "X")` is `false` → undispatched. Unchanged from before (the `in` bug only manifested for prototype-key ids), so all existing selftest/gate cases keep passing.
- **`outcomes` records the prototype-colliding id itself** (e.g. `{ constructor: "shipped" }`): `Object.hasOwn` is `true` → dispatched, and it is a valid terminal-state string → not invalid. The queue drains correctly. (Mirrors FAFF-1024's `protoCollisionDrained`.)
- **`outcomes` non-object / array:** already rejected by the existing guard on line 35 (`throw new Error("outcomes must be an object")`); untouched.
- **`__proto__` as an admitted id:** `Object.hasOwn(outcomes, "__proto__")` correctly returns `false` for a normal object literal without an own `__proto__` data property, so it is reported undispatched — the desired behaviour. No special-casing required.

**Anti-pattern:** replacing `in` with a manual `Object.keys(outcomes).includes(i)` or an `Object.entries` scan. Why: it is O(n·m), diverges from the sibling's `Object.hasOwn`, and obscures the one-to-one parallel the reviewer checks for.

**Anti-pattern:** "fixing" the inherited-key problem by constructing `outcomes` with `Object.create(null)`. Why: it changes construction/serialisation semantics far outside the predicate, is not what the sibling did, and violates the single-line-scope principle.

---

## 5. SCENARIOS — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The main objective is a single, non-obvious behavioural correction — above the complexity bar because the observable (a run wrongly auditing as complete) is exactly the guarantee runcheck exists to defend.

```
Given an OWNED run ledger whose admitted queue is ["constructor"], outcomes is {},
      and owner is { status: "running", last_heartbeat: fresh }
When runcheckHookDecision evaluates it (env FAFF_RUN_DIR == the resolved run dir)
Then the decision blocks (block == true), because "constructor" is undispatched
     — pre-fix it computed undispatched == [] and did NOT block (the bug)
```

- The scenario's non-functional assertion: **every pre-existing `runcheck --selftest` case and every `test/runcheck-gate.test.mjs` case MUST still pass unchanged** — the fix alters behaviour only for prototype-colliding ids, so ordinary-id coverage is a regression guard on scope.

(The fenced `holdout` block reserves the direct-`auditLedger` instantiations for the code-blind evaluator; the visible scenario — the owned-`constructor` hook-decision block — is the builder's primary regression and is a different concrete instantiation of the same own-key rule.)

---

## 6. DESIGN DECISION RATIONALE

**Which key-presence operator replaces `in`?**
- Options: `Object.hasOwn(outcomes, i)`; `Object.prototype.hasOwnProperty.call(outcomes, i)`; keep `in` (rejected — the defect).
- Pros/cons: `Object.hasOwn` is the clearest and is already shipped in the sibling in this same package (so the Node-version floor it implies is already assumed and met); `hasOwnProperty.call` is equivalent but verbose and diverges from the sibling.
- **Chosen:** `Object.hasOwn(outcomes, i)` — mirrors FAFF-1024's `applyTerminalOutcome` line 169 exactly, keeping the two completeness readers in visible lockstep.

**Where does the regression live?**
- Options: (a) a new `RUNCHECK_SELFTEST_CASES` entry only; (b) a `test/runcheck-gate.test.mjs` case only; (c) both, plus a direct `auditLedger` assertion mirroring `protoCollision`.
- Pros/cons: the in-file selftest is the fast `--selftest` path and the natural home matching the sibling's in-file selftest; the `.mjs` suite exercises the real entrypoint end-to-end (as FAFF-690 did for its owned/foreign split). Direct `auditLedger` assertions pin the core independently of the gate's ownership tree.
- **Chosen:** add (a) the owned-`constructor` → block selftest case as the primary regression (mirrors FAFF-1024's `protoCollision`/`protoCollisionDrained` pairing in the in-file selftest), AND (b) at least one `test/runcheck-gate.test.mjs` case driving the real entrypoint on a `constructor`-id owned ledger. The direct-`auditLedger` instantiations are covered as the holdout scenario. This matches how sibling backstop fixes (FAFF-690) landed coverage in both the selftest and the `.mjs` suite.

**Temporal anchor.** At the time of writing (2026-09-20), FAFF-1024 is Done (PR #883) and its in-code comment in `run-ledger.js` explicitly names this `runcheck.js` predicate as the still-unfixed sibling; this ticket closes that named delta.

---

## Already shipped against this surface

FAFF-1024 ("record-outcome terminates a live multi-issue L4 drain owner", **Done**, PR #883) fixed the **identical** prototype-chain defect class in `run-ledger.js`'s `applyTerminalOutcome` by switching `admitted.filter((i) => !(i in ledger.outcomes))` to `admitted.filter((i) => !Object.hasOwn(ledger.outcomes, i))` (line 169), with regression cases `protoCollision` (admitted `["A","constructor"]`, outcomes `{}` → recording `A` leaves the queue NOT drained) and `protoCollisionDrained` (recording the `constructor` id itself correctly drains).

That ticket **deliberately scoped itself to `applyTerminalOutcome` only**, and its in-code comment (lines 162–168) explicitly names `runcheck.js`'s `!(i in outcomes)` as a "pre-existing, separately-tracked defect there, out of scope for this fix." **FAFF-1045 is therefore not superseded — it is the explicit remaining delta**, applying the same operator and the same `constructor`-id regression shape to the sibling reader. This section cites FAFF-1024 as the pattern to mirror, not as a supersession.

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The operator and the regression shape are fully settled by the Done sibling.

**Assumptions.**

- **Assumes:** the runtime is Node ≥ 16.4 (where `Object.hasOwn` exists). Validation: `Object.hasOwn` is already in production use at `plugin/skills/faff/bin/lib/run-ledger.js` line 169 in this same package — the build agent confirms by grepping `Object.hasOwn` there; if present (it is), the assumption holds with no new floor introduced.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] An owned run ledger with admitted `["constructor"]` and empty `outcomes` no longer audits as complete: `runcheckHookDecision` returns `block: true` (the "never silently defer the queue" guarantee holds for prototype-colliding ids).

### From WHAT (types and interfaces)
- [ ] `auditLedger`'s `undispatched` is computed with an own-key test; the function signature, `admitted`/`invalid_outcomes`/`clean` fields, and the `outcomes-must-be-an-object` guard are unchanged.

### From HOW (behaviour)
- [ ] `runcheck.js` line 36 reads `const undispatched = admitted.filter((i) => !Object.hasOwn(outcomes, i));` (the sole line changed in the function body; the `invalid` computation on lines 45–52 is untouched).
- [ ] A concise in-code comment at the fix site cross-references the sibling (FAFF-1045 ↔ FAFF-1024 / `run-ledger.js` `applyTerminalOutcome`), in the repo's terse single-line comment idiom.
- [ ] `auditLedger` with admitted `["A","constructor"]` and outcomes `{}` returns `undispatched` containing both `"A"` and `"constructor"` and `clean: false`.
- [ ] `auditLedger` with admitted `["constructor"]` and outcomes `{ constructor: "shipped" }` returns empty `undispatched`, empty `invalid_outcomes`, and `clean: true`.

### From HOW (regression coverage)
- [ ] A new `RUNCHECK_SELFTEST_CASES` entry: owned ledger `{ admitted: ["constructor"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(10) } }` with env `{ FAFF_RUN_DIR: RUNCHECK_RUN_DIR }` expects `wantBlock = true` (pre-fix this case fails; post-fix it passes).
- [ ] At least one `test/runcheck-gate.test.mjs` case drives the real entrypoint against an owned `constructor`-id ledger and asserts a `{ decision: "block" }` stdout payload naming `constructor`.
- [ ] `node plugin/skills/faff/bin/faff runcheck --selftest` prints `RESULT: PASS` and exits 0.
- [ ] The full `test/runcheck-gate.test.mjs` suite passes, including all pre-existing FAFF-205/233/235/355/554/578/690 cases (scope-regression guard).

### From scope guard
- [ ] No consumer of `auditLedger` (`governance-check.js`, `disposition.js`, `audit.js`) is edited; the fix lands only in `runcheck.js` plus its test coverage.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Add the fix at runcheck.js line 36 and the regression selftest case.
  2. Run: node plugin/skills/faff/bin/faff runcheck --selftest
     EXPECT: stdout contains "RESULT: PASS", exit code 0,
             and the new "owned + constructor id → block" case prints "ok".
  3. Run the gate suite (e.g. node --test test/runcheck-gate.test.mjs).
     EXPECT: all tests pass, including the new constructor-id entrypoint case.
  4. Sanity: temporarily revert line 36 to `!(i in outcomes)` and re-run step 2.
     EXPECT: the new case FAILS (block=false, want block=true) — proving the case
             actually exercises the defect. Restore the fix.
```

confidence: high
build-tier: complex
spec-review: approve
