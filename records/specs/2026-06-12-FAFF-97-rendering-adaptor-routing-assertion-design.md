# Spec — FAFF-97: Rendering-adaptor routing assertion — skills route human-facing output through the rendering pass

> Spec: faffter-dark-nlspec · 2026-06-12 · interactive · confidence: high. Full spec on Linear FAFF-97.

This is a buildable design document for the FAFF-97 work item in the faff repo. The audience is the coding agent that will implement it and the human reviewers who gate it. It specifies a new decision-assertion matcher (and the small harness affordance it needs) that asserts a skill routed **every** human-facing output surface through the configured `rendering_adaptor` normalise pass — the universal-routing rule, enforced behaviourally rather than by `validate-adapters` lint alone. It builds directly on the FAFF-93 skill-run harness (`test/helpers/skill-harness.mjs`), the FAFF-95 matcher module (`test/helpers/decision-assert.mjs`), and the FAFF-94 end-to-end test pattern (`test/faff-tidy.test.mjs`).

## 1. WHY — Problem and Principles

**Problem statement:** the universal-routing rule says all human-facing output (terminal output, tracker descriptions, tracker comments) must pass through the `rendering_adaptor` normalise pass, but the only enforcement today is `validate-adapters` — a static SKILL.md lint that never runs a skill. There is no test that a skill, when actually driven, emits every human-facing surface *through* the rendering pass. FAFF-97 closes that behavioural gap with a routing/completeness assertion over a captured run.

**Design principles:**

**Routing is a seam-completeness claim, not a content claim.** FAFF-97 asserts *that* every human-facing output surface routed through a rendering seam (presence + ordering); it must NOT inspect rendered prose for skimmability or correctness. The harness deliberately records `{ seq, surface }` for a rendering and never captures the rendered body. Content correctness is FAFF-96's job (body goldens). Crossing that line would couple this test to wording and duplicate FAFF-96.

**The matcher holds no ordering or importance opinion.** Per the gateway's "ordering opinion belongs to methodology" tenet and FAFF-95's design, the matcher computes no ranking. It checks a *structural* invariant the universal-routing rule already fixes: a human-facing output seam must be preceded by a rendering seam. The set of "which surfaces are human-facing" is supplied by the test author per run, not inferred by the matcher.

**Build on FAFF-95's primitives; do not re-plumb seamLog.** The matcher reads the same frozen `DecisionRecord`, never mutates it, never imports the harness, and reuses the `seq`/`seamLog` ordering authority. Zero new dependencies beyond `node:assert/strict`.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `test/helpers/skill-harness.mjs` | Node ESM | FAFF-93 harness: `runSkill`, `scriptedDriver`, `makeRecorder`; `Rendering` = `{ seq, surface }`; `seamLog` = `[{ seq, kind, payload }]` |
| `test/helpers/decision-assert.mjs` | Node ESM | FAFF-95 matchers: `expectRendering` (bare membership), `expectSeamOrder`, `expectMutation`, etc. — this file gains the new matcher |
| `test/faff-tidy.test.mjs` | Node ESM | FAFF-94 end-to-end pattern: a real test exercising faff-tidy that already emits `{ render: { surface: "tidy-report" } }` but never asserts routing |
| `plugin/skills/faff/SKILL.md` (~833) | Markdown | Universal-routing rule definition |

**Scope statement:** this is the first behavioural slice of the "Output conformance suite" that proves the routing half of the rendering contract; the body-content half is FAFF-96.

## 2. OUT OF SCOPE

- **Rendering-body content assertions** — what's excluded: any check of the rendered prose's skimmability, token-economy, or correctness. **Why excluded:** the harness captures no rendered body; content is FAFF-96's golden corpus. **Extension point:** `test/contract-golden.test.mjs` / FAFF-96 goldens.
- **Replacing or strengthening `validate-adapters` lint** — what's excluded: the static SKILL.md lint in `test/cli-coverage.test.mjs` stays as-is. **Why excluded:** FAFF-97 is the behavioural complement, not a replacement; the lint catches source-level violations (e.g. shelling out to read the rc file) a single run can't. **Extension point:** the `faff validate-adapters` CLI subcommand.
- **A real `rendering_adaptor` invocation (live render)** — what's excluded: actually running `faffidavit-rendering`'s normalise pass over output. **Why excluded:** the scripted driver records *that* a render seam occurred; a live render needs the live driver. **Extension point:** the live `SkillDriver`.
- **Asserting routing across all skills** — what's excluded: a sweep over wtf/map/jot/plot/beep-boop. **Why excluded:** FAFF-97 proves the mechanism on one real driven skill (faff-tidy); generalising is a follow-on once the matcher exists. **Extension point:** new `test/<skill>.test.mjs` files using the same matcher.
- **A runtime emit chokepoint in the skills themselves** — what's excluded: refactoring skills to route through a central emit function. **Why excluded:** the gateway is explicit that there is no central emit function — routing is a per-skill final pass. FAFF-97 tests the per-skill discipline, it does not introduce a chokepoint. **Extension point:** n/a (architectural non-goal).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Human-facing output surface | A seam in the record that produces output a human reads: a `rendering` seam, OR a prose-bearing tracker write (`addComment` body, `createIssue` description/title, a `setStatus` carrying a description). Mechanical writes (`addLabel`/`removeLabel`) and tracker *reads* are NOT human-facing surfaces. |
| Routing-through | The property that a human-facing output surface is immediately preceded (in `seq` order) by a `rendering` seam whose `surface` the author has bound to it — i.e. it went through the normalise pass before being emitted/written. |
| Routes-tag | An optional field on a `rendering` seam naming what emit/write that render is the final pass *for*, so completeness can be checked mechanically rather than positionally. |

**The harness affordance (extension to FAFF-93's `recordRendering` / scripted `render` action):**

The current `Rendering` record is `{ seq, surface }` and the scripted `render` action is `{ render: { surface } }`. The matcher needs to know *which* emit a render covers to assert completeness. Add an **optional** `routes` field — backward-compatible, defaulting to `undefined`.

```
RECORD Rendering:                  # produced by recordRendering
  seq: int                         # ordering authority, assigned by makeRecorder
  surface: string                  # e.g. "tidy-report" (unchanged)
  routes: string | undefined       # NEW, optional: the emit/write surface this render is the final pass for
                                   #   e.g. "terminal", or a mutation op like "addComment"
```

```
SCRIPT ACTION render:              # scriptedDriver
  { render: { surface, routes? } } # routes optional; recordRendering(surface, routes)
```

**Design decision — does the matcher need the harness affordance, or can it work positionally on the existing record?**

- Option A (positional-only, no harness change): match each human-facing output seam to the nearest preceding `rendering` seam by `seq`. Pro: zero harness change. Con: a render and an emit that are *unrelated* but adjacent would false-pass; "nearest preceding" is a heuristic, not a declared binding — brittle and implicit.
- Option B (explicit `routes` tag): the test author declares, on each render, what it routes. The matcher checks every human-facing surface has a render whose `routes` binds to it and precedes it. Pro: explicit, no positional guessing, completeness is a set check. Con: a one-line, backward-compatible harness field.

**Chosen:** Option B — add the optional `routes` field to `recordRendering` and the scripted `render` action. The explicit binding is what makes "every human-facing surface routed" a *mechanical* completeness claim rather than a positional heuristic, and the field is backward-compatible (existing `{ render: { surface } }` actions and tests keep working; `routes` is `undefined`). The matcher supports both a strict mode (requires `routes`) and a lenient terminal-only mode (see HOW).

**The new matcher API:**

```
INTERFACE expectRoutedThroughRendering(rec, spec):
  rec: frozen DecisionRecord
  spec: {
    surface: string                 # the rendering surface that must carry the routing, e.g. "tidy-report"
    emits?: List<EmitSelector>      # human-facing output seams that must each route through `surface`
                                    #   default: [{ kind: "rendering", surface }] (terminal render itself present + sole)
  }
  EmitSelector:
    | { kind: "rendering" }                              # the terminal/stdout render
    | { kind: "mutation", op: "addComment" | "createIssue" | "setStatus", issue?: string }
  RETURNS: undefined on match
  THROWS:  AssertionError on (a) missing render, (b) an emit with no preceding bound render, (c) ordering violation
```

## 4. HOW — Behavior

**Architecture and approach.** The matcher is a pure read over the frozen record, layered on FAFF-95's existing `seamLog`/`expectSeamOrder` machinery. It does three things, in order: (1) assert the named `rendering` surface is present at all (reuse the membership logic of `expectRendering`); (2) for each declared human-facing emit, assert a `rendering` seam bound to it exists; (3) assert that binding render precedes the emit in `seq`. Absence of a render before a human-facing emit is the core failure the universal-routing rule forbids.

**Behavior summary:** "every human-facing thing this skill emitted went through the normalise pass first, and I can name which render covered which emit."

```
PROCEDURE expectRoutedThroughRendering(rec, { surface, emits }):
  1. renders := rec.renderings filtered to surface
  2. ASSERT renders is non-empty
        FAIL "expectRoutedThroughRendering(surface): no rendering with that surface"
  3. emits := emits ?? [ { kind: "rendering" } ]      # default: just assert the terminal render present
  4. FOR each emit in emits:
     a. emitSeq := seq of the first seamLog event matching emit
                   (kind:"rendering" -> match surface; kind:"mutation" -> match op [+ issue if given])
        ASSERT emitSeq found
              FAIL "expectRoutedThroughRendering: no human-facing emit matched <emit>"
     b. IF emit.kind == "rendering":
           # the render IS the terminal emit — presence (step 2) suffices; routing is intrinsic.
           CONTINUE
     c. # a tracker write: find a binding render that precedes it
        binding := first rendering seam r WHERE
                     r.surface == surface
                     AND (r.routes is undefined OR r.routes == emit.op)   # routes, when set, must bind to this op
                     AND r.seq < emitSeq
        ASSERT binding found
              FAIL "expectRoutedThroughRendering: emit <op> at seq N has no preceding rendering(surface) routing it
                    — un-normalised write violates the universal-routing rule"
  5. RETURN undefined
```

**Edge cases and error handling:**

- **No render at all, but a human-facing write happened** — terminal failure: the universal-routing rule is violated. Throw at step 2 or 4c. This is the headline regression the matcher exists to catch.
- **A render exists but emits AFTER the write** (write un-normalised, render later) — terminal failure at step 4c (`r.seq < emitSeq` fails). Routing means the render is the *final pass before* the write.
- **Mechanical-only mutations** (`addLabel` / `removeLabel`) — not human-facing; never selectable as an `emit`. If an author passes one, it simply won't match a prose-bearing op; document that these are out of scope rather than special-casing.
- **`routes` undefined on the render** — lenient: a render of the right `surface` preceding the emit satisfies the binding (back-compat with existing tests). When `routes` IS set, it must equal the emit's `op` — stricter authors get exact binding.
- **Multiple renders / multiple emits** — each emit is checked independently against the first qualifying preceding render; the matcher does not require a 1:1 count.

**Anti-pattern:** asserting the rendered body text. Why: the harness captures no body; that is FAFF-96. The matcher must only ever read `surface`, `routes`, `op`, `issue`, and `seq`.

**Anti-pattern:** inferring the human-facing emit set inside the matcher (e.g. "every mutation is human-facing"). Why: `addLabel` is a mechanical write, not human-facing; the author declares the set per run, the matcher does not classify.

**Refactor of FAFF-94's faff-tidy test.** The three existing scenarios already emit `{ render: { surface: "tidy-report" } }` and never assert on it. Strengthen them:

- Scenario A (ready-promotion): the run does a `setStatus` to Todo (mechanical, not prose) and emits a `tidy-report` render. Assert `expectRoutedThroughRendering(rec, { surface: "tidy-report" })` — the terminal report routed. (The `setStatus` here carries no description, so it is not a declared human-facing emit.)
- Scenario B (stale-park): add a human-facing tracker write — an `addComment` explaining the park-clear — tagged with a render that `routes: "addComment"`, and assert it routed through `tidy-report`. This is the scenario that proves the *tracker-comment* arm of the universal-routing rule, not just terminal.
- Scenario C (skip-ineligible): assert the terminal `tidy-report` routed (default `emits`).

## 5. SCENARIOS — born-verifiable main objectives

```
Given a driven skill run that emits a "tidy-report" rendering and no un-normalised human-facing write
When expectRoutedThroughRendering(rec, { surface: "tidy-report" }) runs
Then it returns undefined (the terminal output routed through the rendering pass)
```

```
Given a run that writes a tracker comment (addComment) PRECEDED by a rendering whose surface is "tidy-report" routing it
When expectRoutedThroughRendering(rec, { surface: "tidy-report", emits: [{ kind: "mutation", op: "addComment" }] }) runs
Then it returns undefined (the comment was normalised before being written)
```

```
Given a run that writes a tracker comment with NO preceding rendering seam (an un-normalised write)
When expectRoutedThroughRendering is asked to route that addComment through a rendering surface
Then it throws AssertionError naming the un-normalised write as a universal-routing-rule violation
```

```
Given a run where a rendering seam exists but emits AFTER the human-facing write (write came first, render later)
When the matcher checks routing for that write
Then it throws AssertionError (routing requires the render to precede the emit in seq)
```

Assertion (non-functional): the matcher reads only `surface`, `routes`, `op`, `issue`, `seq` off the record — never a rendered body — and never mutates the frozen record.

## 6. DESIGN DECISION RATIONALE

**Should FAFF-97 strengthen the existing `expectRendering`, or add a new matcher?**
- Strengthen in place: less API surface. Con: FAFF-95 explicitly reserves bare `expectRendering(rec, surface)` membership as "the one allowance"; other callers (FAFF-94) depend on its cheap membership semantics. Overloading it risks breaking those and conflates two intents.
- Add a new matcher: clean separation — membership stays cheap, routing is its own named claim.
- **Chosen:** add `expectRoutedThroughRendering` alongside the unchanged `expectRendering`. The bare membership check stays as FAFF-95 reserved it; routing-completeness is a distinct, named assertion. The new matcher internally reuses the membership logic for its presence check.

**What counts as a "human-facing output surface" the matcher tracks?**
- Only the terminal render: simplest, but misses the universal-routing rule's explicit claim that *tracker descriptions and comments* also route through the pass.
- Render + all mutations: over-broad — `addLabel`/`removeLabel` are mechanical, not human-facing.
- **Chosen:** render + prose-bearing mutations (`addComment`, `createIssue`, `setStatus`-with-description), with the set declared per-run by the author. This matches the universal-routing rule's three named surfaces (terminal, tracker descriptions, tracker comments) and excludes mechanical writes. The matcher classifies nothing itself.

**Does the harness need extending?**
- **Chosen:** yes, minimally — an optional `routes` field on `recordRendering` and the scripted `render` action (`recordRendering(surface, routes?)`, `{ render: { surface, routes? } }`). It is backward-compatible (defaults `undefined`; all existing tests and the `skill-harness.test.mjs` `{ render: { surface } }` action keep passing) and turns completeness from a positional heuristic into a declared binding. Rejected: a positional nearest-preceding-render heuristic — implicit and false-pass-prone.

**Lenient vs strict `routes` binding.**
- **Chosen:** lenient when `routes` is undefined (any render of the right surface preceding the emit binds), strict when `routes` is set (must equal the emit op). This keeps existing tests working while letting authors opt into exact binding. Temporal anchor: at the time of writing, no skill emits a `routes` tag, so the lenient path is the de-facto default until callers adopt it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:**

**Punt:** Should FAFF-97 also add a *negative* matcher — `expectNoUnroutedOutput(rec)` that sweeps the whole record and fails if ANY prose-bearing mutation lacks a preceding render, without the author enumerating surfaces — needs human. This would be a stronger, author-independent completeness guarantee, but it requires the matcher to classify "human-facing" itself (the very thing the chosen design pushes onto the author to keep the matcher opinion-free). It is a genuine product/architecture call about how much the matcher should infer; the per-run declared-set design ships first, and the sweep can layer on later if the suite wants belt-and-braces. Not blocking — the declared-emits matcher fully satisfies the ticket.

**Assumptions:**

**Assumes:** the FAFF-93 harness still exposes `recordRendering` via `makeRecorder().publicApi()` and the scripted `render` action, and `Rendering` is `{ seq, surface }`. **Validation:** confirmed against `test/helpers/skill-harness.mjs` (lines 112, 143, 209–211) — `recordRendering(surface) => push("rendering", { surface })`, `publicApi()` includes `recordRendering`, scripted `render` handler at ~209. Before building, re-read those lines; if the record shape moved, adjust the `routes` addition to match.

**Assumes:** tests run under Node built-in `node:test` via `node --test` (CI `.github/workflows/validate.yml` line 53), helpers in `test/helpers/*.mjs`, `node:assert/strict` only. **Validation:** confirmed — there is no `package.json`; the bare `node --test` command is the runner.

## 8. DONE — Definition of Done

### From WHY
- [ ] A behavioural test asserts a driven skill routed its human-facing output through the `rendering_adaptor` pass (not via `validate-adapters` lint).

### From WHAT (harness affordance)
- [ ] `recordRendering` accepts an optional `routes` arg; `Rendering` payload is `{ seq, surface, routes? }`, `routes` defaulting to `undefined`.
- [ ] The scripted `render` action accepts `{ render: { surface, routes? } }`; existing `{ render: { surface } }` actions still pass unchanged.

### From WHAT (matcher API)
- [ ] `decision-assert.mjs` exports `expectRoutedThroughRendering(rec, { surface, emits? })`.
- [ ] `emits` defaults to asserting the named terminal render's presence.
- [ ] `emits` accepts `{ kind: "rendering" }` and `{ kind: "mutation", op, issue? }` selectors.

### From HOW (behaviour)
- [ ] Returns `undefined` when the named surface render is present and every declared emit has a preceding bound render.
- [ ] Throws AssertionError when a declared human-facing emit has no preceding rendering of the named surface (the un-normalised-write violation).
- [ ] Throws AssertionError when a rendering exists but emits AFTER the human-facing write (`render.seq < emit.seq` violated).
- [ ] When `routes` is set on a render, it must equal the emit's `op` to bind; when undefined, any same-surface preceding render binds.
- [ ] The matcher reads only `surface`/`routes`/`op`/`issue`/`seq`, never a rendered body, and never mutates the frozen record.

### From HOW (refactor)
- [ ] `test/faff-tidy.test.mjs` Scenario A and C assert `expectRoutedThroughRendering(rec, { surface: "tidy-report" })`.
- [ ] Scenario B emits an `addComment` routed through a `tidy-report` render and asserts it via `expectRoutedThroughRendering` with a `{ kind: "mutation", op: "addComment" }` emit.

### Integration smoke test
```
PROCEDURE smoke:
  1. Build a tracker fixture + seedRepo; drive faff-tidy via scriptedDriver with
     actions: [ ...reads, ...cli, { mutate: addComment }, { render: { surface: "tidy-report", routes: "addComment" } } ]
  2. rec := runSkill(...)
  3. expectRoutedThroughRendering(rec, { surface: "tidy-report",
         emits: [ { kind: "rendering" }, { kind: "mutation", op: "addComment" } ] })
        -> returns undefined (plumbing connected)
  4. Re-order so addComment precedes the render -> the same call throws (regression guard proven)
  5. node --test runs green
```

confidence: high

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4):** No issues. One cohesive 1–3 day unit — add a matcher, a one-field backward-compatible harness affordance, and refactor three existing test scenarios. No independent concerns to split; the negative-sweep matcher is correctly deferred as a Punt, not bundled in.
- **Workstream fit (principles 1 + 5):** No issues. "Output conformance suite" is outcome-named, and FAFF-97 is its routing half cleanly paired against FAFF-96's body-goldens half — one outcome, no catch-all.
- **Surfaced deps (principle 6):** No issues. The build-on dependency (FAFF-93 harness, including the small `recordRendering` extension this spec makes) is a declared blocker and merged; FAFF-95's matcher module and FAFF-96's boundary are declared related-to. No implicit cross-ticket reference lacks a link.
- **Risk profile (principle 7):** No issues. Low-risk test infrastructure on a merged, proven harness + matcher pattern (FAFF-94 already established the end-to-end shape). No novel integration or external dependency — no de-risking spike warranted.
