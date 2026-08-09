# Spec: FAFF-620 — a defensive catch around run-dir resolution in the `sentrycheck` Stop-hook

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high. Full spec on Linear FAFF-620.

This spec is for the build agent implementing FAFF-620, and for the human reviewers gating it. It hardens the `sentrycheck --hook` path so a filesystem fault during run-dir resolution can never crash the every-turn-end Stop-hook, mirroring what FAFF-578 did for the sibling `runcheck` hook. It is deliberately small: one extracted helper, one discriminated catch, and the tests that pin both. v3 folds in the spec-review steer verbatim — discriminate the catch to `ENOENT`, prove the entrypoint wiring, and pin the injection seam as a documented test-only contract.

## 1. WHY — Problem and Principles

**The load-bearing model.** `sentrycheck --hook` runs at the end of every session turn. Its very first job is to find the latest run directory, and the only step in that job that can throw is `process.cwd()` — called inside `findRoot()` when no `--root` is given. If the working directory has been deleted out from under the process, `process.cwd()` throws `ENOENT` and, today, that throw propagates uncaught straight through the Stop-hook and crashes the turn. Everything in this spec follows from one fact: **the sole live fault seam in this resolution is `process.cwd()` → `ENOENT`, and a Stop-hook must never crash on it.**

**Problem statement.** FAFF-578 fixed the same class of bug on the `runcheck` hook: `latestRunDir`'s `statSync` could throw on filesystem churn, so it wrapped `cmdRuncheck`'s resolution in a catch that fails to a silent no-op in hook mode. The `sentrycheck` hook is the untreated sibling — its `latestRunDir(findRoot())` call at `sentrycheck.js:125-126` has no such guard, so a deleted cwd throws through it. This change gives that call site its own defensive catch, discriminated to the one code that resolution actually produces.

**Design principles.**

- **A Stop-hook fails silent, never loud, and never crashes.** The hook already treats "no run", "unreadable ledger", and "foreign-consult faulted" as silent or non-blocking exit-0 paths (`sentrycheck.js:127,131,147`). Resolution faults join that family: the session must complete regardless.
- **Fail-open only for the fault you actually understand.** A silent no-op on an every-turn hook is a masking risk: whatever the catch swallows becomes an invisible exit-0 that the DONE criteria then lock in as a *tested* invariant. So the catch swallows exactly the deleted-cwd fault (`ENOENT`) and re-throws everything else — a genuinely unexpected `EACCES`, `EMFILE`, or a programming error like a `TypeError` inside resolution stays loud rather than vanishing into green-suite silence. This is the crux of v3 and is argued in full under HOW and in the Design Decision Rationale.
- **Mirror FAFF-578's intent, not its blast radius.** FAFF-578's `cmdRuncheck` used a *broad* catch because its resolver (`resolveRunDir → latestRunDir`) sat over the old `statSync` race that could surface a range of fs codes. That breadth was faithful to *its* seam. Here `latestRunDir` is already fully hardened and never throws (`shared-infra.js:212-226` — every internal `statSync`/`readdirSync` is already caught and folded to `null`). The only remaining live seam at this call site is `process.cwd()` → `ENOENT`. So the *faithful* mirror of FAFF-578 here is a catch scoped to that one code — matching FAFF-578's intent (turn real fs-churn faults into a silent no-op) applied to this site's actual single seam, not a copy of its now-unneeded breadth.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentrycheck.js` (`cmdSentrycheck` ll.117-152; exports ll.228-232) | JavaScript (CJS) | The hook being hardened. Resolution is ll.125-126; exports are the unit-test import surface. |
| `plugin/skills/faff/bin/lib/shared-infra.js` (`findRoot` l.30; `latestRunDir` ll.212-226) | JavaScript (CJS) | `findRoot`'s default arg is `process.cwd()` — the one throw. `latestRunDir` is already hardened and never throws. |
| `plugin/skills/faff/bin/lib/runcheck.js` (`cmdRuncheck` ll.182-201) | JavaScript (CJS) | The FAFF-578 sibling treatment this mirrors — and whose *breadth* v3 deliberately narrows to fit this site's single seam. |
| `test/sentrycheck.test.mjs` | JavaScript (ESM test) | Existing entrypoint suite (spawnSync). Two of its cases become the named wiring oracles; new unit tests land here via `createRequire`. |

**Scope.** One call site inside one Stop-hook. This does not touch the pure gate, the consult classifier, `latestRunDir`'s internals, or any other hook.

## 2. OUT OF SCOPE

- **Re-hardening `latestRunDir`.** — Excluded: FAFF-578 already made it churn-tolerant and it never throws (`shared-infra.js:212-226`). Extension point: `shared-infra.js` `latestRunDir` if a new internal fault seam is ever found.
- **The `runcheck` / `prepcheck` hooks.** — Excluded: `runcheck` was handled by FAFF-578; `prepcheck` is a separate seam with its own ticket if needed. Extension point: `runcheck.js:182-201`, and the prepcheck entrypoint respectively.
- **The foreign-consult child-spawn fault path.** — Excluded: `classifySentryConsult` + `consultFailureNotice` already handle a faulted `faff sentry check` child as a distinct non-blocking notice (`sentrycheck.js:145-148`). Extension point: `classifySentryConsult` in `sentrycheck.js`.
- **Broadening the catch to non-`ENOENT` fs faults (`EACCES`, `EMFILE`, `ENOTDIR`, …).** — Excluded on purpose: no live seam at this call site produces them, so swallowing them would only mask bugs. Extension point: the `if (e.code === "ENOENT")` predicate in the new helper — widen it, with a test, only when a real fault of another code is observed reaching this catch.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Resolution | The two-step "find where the latest run lives": `findRoot()` (or `--root`) then `latestRunDir(root)`. |
| Silent no-op | The hook returns exit 0 having written nothing — indistinguishable from "no run exists". |
| Injection seam | A defaulted parameter that binds the real module functions in production and lets a test substitute a throwing stand-in. Test-only; not an API surface. |

**The extracted helper.** A single exported function replaces the two inline resolution lines. Its signature carries a defaulted `deps` object so a test can force a throw without a live deleted cwd.

```
FUNCTION resolveSentryRunDir(values, deps = { findRoot, latestRunDir }):
  # values  — the parsed argv values object (reads only values["--root"])
  # deps    — TEST-ONLY injection seam; production callers pass ONE argument
  #           and the defaults bind the real findRoot / latestRunDir imports
  RETURNS: an absolute run-dir path string, OR null (no run, or a swallowed ENOENT fault)
  THROWS:  re-throws any non-ENOENT error unchanged
```

**The `deps` contract (documented, not an API).** `deps` exists **solely** so tests can inject a throwing `findRoot` or `latestRunDir`. Production has exactly one caller — `cmdSentrycheck` — and it calls `resolveSentryRunDir(values)` with **one argument**; the default binds the real module imports. No production code path ever passes `deps`. This is a documented test contract, stated here so a future reader does not mistake it for a supported extension point or start threading dependencies through it. **Chosen:** keep the injection seam from v2 — it is what makes the fault path unit-testable without a real deleted cwd (a condition that can't be staged portably). Rationale in Design Decision Rationale.

**The discriminated catch.** The guard is not a bare `catch { return null }`. It is:

```
catch (e):
  IF e AND e.code === "ENOENT": return null
  throw e
```

**Chosen:** discriminate to `ENOENT`. Argued in full in HOW and Design Decision Rationale.

**Export.** `resolveSentryRunDir` is added to `sentrycheck.js`'s `module.exports` (ll.228-232) so `test/sentrycheck.test.mjs` can import it directly via `createRequire`. **Assumes:** the lib module's CJS `module.exports` is directly requirable from the ESM test — validated by the established `createRequire(import.meta.url)` + `require(path.resolve(...))` pattern already used in `test/argv.test.mjs`, `test/ci-triage.test.mjs`, and four other `*.test.mjs` files. Validation instruction in Assumptions.

## 4. HOW — Behavior

**Approach.** Extract the two inline resolution lines into `resolveSentryRunDir`, wrap them in the discriminated try/catch, and call it from `cmdSentrycheck`. The call site's downstream logic is unchanged: a `null` return (no run, or a swallowed `ENOENT`) routes through the existing `if (!runDir) return 0`.

Before (`sentrycheck.js:125-127`):

```
const root = values["--root"] || findRoot();
const runDir = latestRunDir(root);
if (!runDir) return 0; // skip-no-run
```

After:

```
const runDir = resolveSentryRunDir(values);
if (!runDir) return 0; // skip-no-run, OR resolution no-opped on a deleted cwd (ENOENT)
```

The helper body:

```
FUNCTION resolveSentryRunDir(values, deps = { findRoot, latestRunDir }):
  try:
    root = values["--root"] OR deps.findRoot()   # --root wins; else resolve from cwd (the ENOENT seam)
    return deps.latestRunDir(root)               # already hardened: returns a path or null, never throws
  catch (e):
    IF e AND e.code === "ENOENT": return null     # deleted cwd / mid-scan-deleted run dir → silent no-op
    throw e                                        # every other fault stays loud (no fail-open masking)
```

**Why discriminate — the argument in full.** Three reasons, each load-bearing:

1. **It fully satisfies the ticket's acceptance.** The WHY names exactly one resolution throw: `findRoot()`'s `process.cwd()` → `ENOENT` on a deleted cwd. The ticket's Acceptance names precisely the deleted-cwd and mid-scan-deleted-run-dir conditions — both `ENOENT`-flavoured. Discriminating to `ENOENT` catches every condition the ticket actually asks for, while staying honest about what it handles.

2. **A bare catch would mask real bugs.** `catch { return null }` would also swallow `EACCES`, `EMFILE`, or an outright programming error (`TypeError`) inside resolution, collapsing each to a silent exit-0 that the DONE criteria would then enshrine as a *tested* invariant. On an every-turn-end hook that means a genuine bug disappears into operational silence behind a green test suite — the worst kind of fail-open. `ENOENT`-discrimination keeps every non-cwd fault loud.

3. **It is the faithful mirror of FAFF-578, not a broadening of it.** FAFF-578's broad catch fit *its* resolver, which sat over an unhardened `statSync` race that could throw a spread of fs codes. Here that race is already absorbed inside `latestRunDir` (`shared-infra.js:212-226`), so the only surviving live seam is `process.cwd()`. Scoping the catch to `ENOENT` mirrors FAFF-578's *intent* — make the real fs-churn fault a silent no-op — applied to this site's single actual seam.

**Anti-pattern:** a bare `catch { return null }`. Why: it fails open on faults nobody has reasoned about, and the DONE suite would then certify that masking as correct behaviour.

**Anti-pattern:** threading `deps` from `cmdSentrycheck` or any production path. Why: `deps` is a test-only seam; a production caller passing it turns an internal test affordance into an unsupported API and invites divergence between the tested and shipped resolution.

**Edge cases.**

- `--root` present → `findRoot()` is never called, so the `process.cwd()` seam is bypassed entirely; resolution can still only return a path or `null`.
- `latestRunDir` returning `null` (no `.faff/runs`, or no candidate) → routed through `if (!runDir) return 0`, exactly as today. Not a fault.
- A non-`ENOENT` throw → re-thrown, surfacing loudly. This is intended: it means something outside the understood seam broke.

**Failure modes.**

- **The failure:** on some platform or Node version, a deleted-cwd `process.cwd()` surfaces a code other than `ENOENT` (e.g. a bare `uv_cwd` error without `.code === "ENOENT"`). The discriminated catch would then re-throw and crash the hook — the very outcome we set out to prevent. **How you'd know:** the sentrycheck Stop-hook crashes in the field on a deleted-cwd, with a non-`ENOENT` error in the trace. **What it means:** narrow, not abandon — widen the predicate to include the observed code (the OUT OF SCOPE item names this exact extension point), backed by a test. Node documents `process.cwd()`'s deleted-dir failure as `ENOENT` on the supported platforms, so this is a named residual risk, not an expected path.
- **The failure:** a future refactor reintroduces a throwing seam *inside* the try (say, a new pre-resolution call), and it throws a non-`ENOENT` code that ought to be silent. **How you'd know:** a new crash path in the hook that the unit tests don't cover. **What it means:** re-evaluate the predicate at that point — the whole-try unit test (Unit 2 below) exists precisely so the catch's coverage of the entire try body is already pinned, making such a regression visible.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The behavioural crux is the fault path and the discrimination boundary. Both are above the complexity bar; the trivial "no run → exit 0" routing is not restated here (it is a retained entrypoint oracle in DONE).

```
Given the sentrycheck hook resolves its run dir via resolveSentryRunDir
When findRoot throws an ENOENT-coded error (a deleted cwd)
Then resolveSentryRunDir returns null (and the hook routes it to a silent exit 0)
```

- The entrypoint success path MUST stay intact: `faff sentrycheck --hook --root <fixture with a stale foreign run>` exits 0 and still fires exactly one `[warn] … looks abandoned` line, with the run ledger's bytes unchanged.

The holdout is withheld for the code-blind evaluator: it instantiates the same discrimination rule the visible scenario states, on the opposite branch (re-throw rather than swallow), so it verifies behaviour the body already requires without being the sole statement of any requirement.

## 6. DESIGN DECISION RATIONALE

**How does the hook survive a deleted-cwd fault during resolution?**
- *Inline try/catch at the call site* — pros: local; cons: the fault path is then only reachable by an actual deleted cwd, which can't be staged portably, so it cannot be unit-tested.
- *Extracted helper with a defaulted `deps` injection seam* — pros: the fault path becomes a pure unit test (inject a throwing `findRoot`); production still calls it with one argument; cons: one extra exported symbol.
- **Chosen:** the extracted injectable helper `resolveSentryRunDir(values, deps = { findRoot, latestRunDir })` — the review conceded v2's core design is sound and testable, and testability of the fault path is the whole point.

**Bare catch, or discriminate to `ENOENT`?**
- *Bare `catch { return null }`* — pros: shortest; superficially "matches FAFF-578". Cons: fails open on `EACCES`/`EMFILE`/`TypeError`, masking real bugs behind a green suite on an every-turn hook.
- *Discriminate `if (e.code === "ENOENT") return null; throw e`* — pros: catches exactly the deleted-cwd fault the ticket names; keeps every other fault loud; is the faithful mirror of FAFF-578's *intent* applied to this site's single live seam. Cons: a residual platform risk if a deleted cwd ever surfaces a non-`ENOENT` code (named in Failure Modes, with a narrow-not-abandon response).
- **Chosen:** discriminate to `ENOENT`. This is the v2→v3 correction and the reason the review's reject-approach steer is now satisfied. `latestRunDir` never throws (`shared-infra.js:212-226`), so `process.cwd()` → `ENOENT` is the only seam; scoping the catch to it is honest about what the change handles.

**Is `deps` an API or a test seam?**
- **Chosen:** a documented test-only injection seam — production's one caller passes a single argument, the defaults bind the real imports, and the spec states plainly that no production path threads `deps`. Marked so no future reader mistakes it for an extension point.

**How is the entrypoint wiring proven, given unit tests only cover the helper?**
- *Author a new spawnSync fault test* — rejected: a real deleted cwd can't be staged portably, so an entrypoint fault test would be non-deterministic.
- *Rely on retained entrypoint tests that now transit the refactored helper* — the existing `test/sentrycheck.test.mjs` already brackets the `if (!runDir) return 0` branch both ways at the real entrypoint: "no run dir resolvable → silent exit 0" (l.140) proves `null → exit 0` routing, and Scenario 1 (l.41) proves `path → gate fires`. After the refactor both run *through* `resolveSentryRunDir`, so they are the wiring oracle for the extraction.
- **Chosen:** the entrypoint fault path stays a helper-level unit test (injected throwing `findRoot`); the two retained spawnSync tests are promoted to the named wiring oracles for null-routing and success-routing. Helper unit test (fault → null) + entrypoint null-routing test (null → exit 0) together prove the full chain the review worried a build could silently regress.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. Every decision above is closed.

**Assumptions.**

- **Assumes:** `sentrycheck.js`'s CJS `module.exports` is directly requirable from the ESM test `test/sentrycheck.test.mjs`. *Validation:* before writing the unit tests, confirm the `createRequire(import.meta.url)` + `require(path.resolve(...))` pattern used in `test/argv.test.mjs` (ll.8-14) resolves `../plugin/skills/faff/bin/lib/sentrycheck.js` and exposes `resolveSentryRunDir` on the exported object.
- **Assumes:** on the supported platforms, `process.cwd()` on a deleted directory throws an error with `.code === "ENOENT"`. *Validation:* the discrimination and its Failure-Mode note already treat a non-`ENOENT` code as a named narrow-later risk; no pre-build action required, but the build agent should not assume any other code is silently handled.

## 8. DONE — Definition of Done

### From WHY
- [ ] A deleted-cwd condition at sentrycheck-hook time produces a silent no-op (exit 0, no output), never an uncaught throw — proven by the Unit-1 injected-`ENOENT`-`findRoot` test returning `null` plus the retained "no run dir resolvable → silent exit 0" entrypoint test.

### From WHAT (types and interfaces)
- [ ] `resolveSentryRunDir(values, deps = { findRoot, latestRunDir })` is exported from `sentrycheck.js` `module.exports` and importable from the test via `createRequire`.
- [ ] `cmdSentrycheck` calls `resolveSentryRunDir(values)` with a single argument (no `deps` threaded from any production path) — verified by reading the call site.

### From HOW (behaviour)
- [ ] The two inline resolution lines (`sentrycheck.js:125-126`) are replaced by a single `resolveSentryRunDir(values)` call whose `null` return routes through the existing `if (!runDir) return 0`.
- [ ] Unit test 1 (deleted-cwd path): injecting `deps.findRoot = () => { const e = new Error("ENOENT: cwd deleted"); e.code = "ENOENT"; throw e; }` makes `resolveSentryRunDir({}, deps)` return `null`.
- [ ] Unit test 2 (whole-try coverage under the handled code): with `values["--root"]` present and an injected `deps.latestRunDir` that throws an `ENOENT`-coded error, `resolveSentryRunDir(values, deps)` returns `null` — proving the catch wraps the entire resolution, not only the `findRoot` step. (This does not claim the real `latestRunDir` throws; it exercises the catch across the whole try.)

### From HOW (discrimination boundary)
- [ ] Unit test 3 (non-`ENOENT` stays loud): injecting `deps.findRoot` that throws an error with `e.code = "EACCES"` makes `resolveSentryRunDir({}, deps)` **throw** that error (assert via `assert.throws` matching `code === "EACCES"`), NOT return `null` — pinning the discrimination.

### From HOW (entrypoint wiring — retained oracles)
- [ ] Entrypoint success path: `faff sentrycheck --hook --root <fixture with a stale foreign run>` exits 0, emits exactly one `[warn] … looks abandoned` line, and leaves the ledger bytes unchanged — the retained Scenario-1 spawnSync assertions (`test/sentrycheck.test.mjs:41`) still pass, now transiting `resolveSentryRunDir`.
- [ ] Entrypoint null-routing: `faff sentrycheck --hook --root <empty tmpdir>` exits 0 and is silent — the retained "no run dir resolvable → silent exit 0" test (`test/sentrycheck.test.mjs:140`) still passes, proving `null → exit 0` at the real entrypoint.

### From regression
- [ ] `faff sentrycheck --selftest` still reports `RESULT: PASS`, and the full existing `test/sentrycheck.test.mjs` entrypoint suite passes unchanged.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Build a fixture root with a foreign, stale-heartbeat run (Scenario-1 shape).
  2. Run: faff sentrycheck --hook --root <fixture>   (FAFF_RUN_DIR="", FAFF_SESSION_ID="")
  3. ASSERT exit 0, exactly one "[warn] ... looks abandoned" stderr line, ledger bytes unchanged.
  4. In a unit test, inject an ENOENT-throwing findRoot and ASSERT resolveSentryRunDir returns null.
  → If both hold, the helper resolves, the catch swallows ENOENT, and the entrypoint routes both branches correctly.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
