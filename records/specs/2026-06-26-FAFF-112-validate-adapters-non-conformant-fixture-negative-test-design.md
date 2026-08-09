# FAFF-112 — `validate-adapters` non-conformant-fixture negative test

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · confidence: high. Full spec on Linear FAFF-112.

This spec is the build artifact for FAFF-112. Audience: the build agent implementing the test, and human reviewers. It defines a single negative test that asserts the `validate-adapters` slot-conformance linter **fails** (non-zero exit) on a deliberately non-conformant slot-named skill, closing the gap FAFF-92 explicitly deferred.

## 1. WHY — Problem and Principles

**Load-bearing model.** `validate-adapters` is the CI gate that lints every faff slot skill against its kind-specific conformance contract (`checksFor` in `plugin/skills/faff/bin/faff`). A linter is only trustworthy if it is proven to **fail** on real non-conformance, not just to pass on the conformant shipped set. Today only the pass direction is tested.

**Problem statement.** FAFF-92 added a PASS test (`validate-adapters` returns exit 0 on the shipped slot set) but deferred the negative case. The existing `test/validate-adapters.test.mjs` negatives only exercise **charter/global** rules (line cap, delegation names) on **non-slot** fixture names — nothing asserts a REGISTRY-matched, slot-named skill fails its **type-specific** `checksFor` check. So a regression that silently disabled the type-specific producer/adaptor/methodology checks would not be caught by any test.

**Design principle — pin the right failure.** The test must assert the **specific** type-specific conformance failure (the producer-spec contract-block check), not merely a non-zero exit. A bare `status !== 0` assertion would pass even if the fixture failed for an incidental reason (a stray charter violation, a missing `user-invocable: false`). Asserting the exact `(producer-spec)` FAIL line + the contract-block check label is what makes the test prove the type-specific path works.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` — `cmdValidateAdapters` / `checksFor` / `REGISTRY` | Node (bundled) | The linter under test. Not modified by this issue. |
| `test/validate-adapters.test.mjs` — `runOnFixtures` / `has` helpers | Node ESM (node:test) | Existing negative-test harness this extends. |
| `test/cli-coverage.test.mjs` (~line 60) | Node ESM | FAFF-92's PASS test — the complement this completes. |

**Scope.** A single test addition under the existing CLI test suite (`node --test`, wired in `.github/workflows/validate.yml`). No production code changes.

## 2. OUT OF SCOPE

- **Exit-2 "uncovered slot skill" path** — an unregistered `faffter-*`/`faffidavit-*`-prefixed dir triggers the setup-error (exit 2) branch, a *different* failure mode from a type-specific conformance FAIL (exit 1). Not this issue. *Extension point:* a separate `test(...)` case in the same file if exit-2 coverage is later wanted.
- **Charter/global-rule negatives** (line cap, paragraph cap, stray markers, config-hand-read, delegation names) — already covered in `test/validate-adapters.test.mjs` and `test/validate-adapters-delegation.test.mjs`. Do not duplicate.
- **Every other slot kind's type-specific failure** (adaptor, methodology, mechanism, producer-review/ship/adr/intake) — one representative kind (producer-spec) proves the type-specific path is wired and tested. *Extension point:* parametrise the same harness over more kinds in a follow-up if broader coverage is wanted.
- **Modifying `REGISTRY` or `checksFor`** — the test keys on the existing directory-name → registry mapping; no production change is needed or wanted.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Slot-named skill | A directory whose name starts `faffter-`/`faffidavit-`; the linter treats it as a slot skill and applies type-specific checks. |
| Type-specific check | A check returned by `checksFor(meta, text)` keyed on the skill's REGISTRY `type` (e.g. producer-spec ⇒ must emit `faff-contract:spec-readiness`). |
| Conformance FAIL (exit 1) | A slot skill present + registered but failing ≥1 check ⇒ `FAIL <name> (<type>)` + exit 1. Distinct from exit 2 (setup error / uncovered). |

**Harness interface (existing, reused).** In `test/validate-adapters.test.mjs`:

```
runOnFixtures(fixtures: { [dirName: string]: skillMdBody: string }) -> { stdout, stderr, status }
  # mkdtemp a temp skills dir, write each <dirName>/SKILL.md = body,
  # spawnSync(node, [BIN, "validate-adapters", "--skills-dir", tmp]), rmSync, return result
has(r, category: string) -> boolean   # tests new RegExp("\\(" + category + "\\)").test(r.stdout)
```

**The non-conformant fixture (the crafted input).** A fixture keyed by a producer-spec REGISTRY name with a body that omits exactly the contract block:

```
FIXTURE faffter-noon-spec/SKILL.md:
  ---
  user-invocable: false        # present => the universal user-invocable check PASSES
  ---
  # minimal body
  ... mentions the word "confidence" ...   # => the confidence-rating check PASSES
  ... and DELIBERATELY OMITS any `faff-contract:spec-readiness` fenced block  # => the ONE failing check

  CONSTRAINT body stays < 600 lines, no >200-word line, no stray-marker / war-story phrases,
             no `.faffrc` hand-read, no `via the Skill tool` delegation  # => no incidental charter FAIL
```

**Design decision — which name to give the fixture.**

- Reuse a real producer-spec REGISTRY name (`faffter-noon-spec`): the linter keys on the *directory name* in the isolated temp dir, where no real `faffter-noon-spec` exists, so this cleanly selects the producer-spec `checksFor` path. No production edit.
- Invent a new name + add a REGISTRY entry: requires editing production `bin/faff` for a test fixture — rejected.

**Chosen:** reuse `faffter-noon-spec` as the fixture directory name. It maps to `{ type: "producer-spec" }`, which carries **no** `meta.contract`, so the isolated temp dir needs no `faff/contracts/` schema tree.

**Design decision — which type-specific violation.**

**Chosen:** omit the `faff-contract:spec-readiness` block (the producer-spec type check `out.push([has("faff-contract:spec-readiness"), …])`). Keep the word "confidence" and `user-invocable: false` present so exactly one check fails and the FAIL is unambiguously the type-specific contract-block check.

## 4. HOW — Behavior

**Approach.** Add one (optionally two) `test(...)` case(s) to `test/validate-adapters.test.mjs`, reusing its `runOnFixtures` + `has` helpers. The negative test writes the non-conformant `faffter-noon-spec` fixture, runs the linter against the isolated temp dir, and asserts a type-specific producer-spec FAIL.

```
PROCEDURE negative_test:
  1. r = runOnFixtures({ "faffter-noon-spec": NON_CONFORMANT_BODY })
  2. ASSERT r.status !== 0                                  # non-zero exit (conformance FAIL)
  3. ASSERT has(r, "producer-spec")                        # the FAIL line is tagged (producer-spec)
  4. ASSERT r.stdout matches /faff-contract:spec-readiness/ # the specific failing check is surfaced
  5. ASSERT r.stdout matches /RESULT:\s*FAIL/              # overall result line is FAIL
```

**Positive control (recommended, same harness).** To prove the temp-dir mechanism itself isn't the cause of the failure, a sibling case asserting a *conformant* producer-spec fixture passes:

```
PROCEDURE positive_control:
  1. r = runOnFixtures({ "faffter-noon-spec": CONFORMANT_BODY })   # body DOES contain a
                                                                   # `faff-contract:spec-readiness` block,
                                                                   # the word "confidence", user-invocable:false
  2. ASSERT r.status === 0
  3. ASSERT r.stdout matches /pass\s+faffter-noon-spec \(producer-spec\)/
```

**Anti-pattern:** asserting only `status !== 0`. Why: it passes even when the fixture fails for an unintended reason (a stray charter trip, a missing `user-invocable: false`), so it does not prove the *type-specific* path runs. Always assert the `(producer-spec)` tag + the contract-block label.

**Anti-pattern:** using an unregistered `faffter-zztest-*` name to force a failure. Why: that hits the exit-2 uncovered-skill setup-error branch, not the exit-1 type-specific conformance branch — it tests a different code path than the one this issue targets.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a temp skills dir containing only faffter-noon-spec/SKILL.md whose body
      omits the faff-contract:spec-readiness block (but has user-invocable:false + "confidence")
When  `validate-adapters --skills-dir <tmp>` runs
Then  it exits non-zero, prints `FAIL  faffter-noon-spec (producer-spec)` with the
      `faff-contract:spec-readiness` check marked ✗, and ends with `RESULT: FAIL`
```

```
Given a temp skills dir containing a fully-conformant faffter-noon-spec/SKILL.md
When  `validate-adapters --skills-dir <tmp>` runs
Then  it exits 0 and reports `pass  faffter-noon-spec (producer-spec)`   # positive control: the failure above is real, not a harness artifact
```

## 6. DESIGN DECISION RATIONALE

**Which file — new `validate-adapters-negative.test.mjs` vs extend `validate-adapters.test.mjs`?** The existing file already defines `runOnFixtures` and `has`, the exact tools needed. A new file would duplicate that helper or require exporting it. **Chosen:** extend `test/validate-adapters.test.mjs` — reuse the helpers, co-locate with the other validate-adapters negatives. (A new file is acceptable if the builder prefers isolation, but then the small helper must be duplicated, not imported across test files.)

**Which slot kind to use as the representative negative?** producer-spec: only two type checks, no `meta.contract` (so no schema tree needed in the temp dir), and it is thematically the configured `spec` slot. Alternatives (adaptor needs refer-back + slot-name strings; mechanism needs three strings; routing carries a `meta.contract` requiring a schema file on disk) are heavier to construct in an isolated temp dir. **Chosen:** producer-spec via `faffter-noon-spec`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**
- **Assumes:** `test/validate-adapters.test.mjs` exposes reusable `runOnFixtures(fixtures)` and `has(r, category)` helpers with the signatures in §3. *Validation:* open the file before building and confirm both helpers exist and `runOnFixtures` returns `{ stdout, stderr, status }` from `spawnSync`; if absent or differently shaped, replicate the documented mkdtemp+spawnSync pattern inline.

## 8. DONE — Definition of Done

### From WHY
- [ ] A test exists asserting `validate-adapters` returns **non-zero** on a non-conformant slot-named skill (the FAFF-92-deferred negative case).

### From WHAT (fixture)
- [ ] The fixture directory is named `faffter-noon-spec` (a producer-spec REGISTRY name) and its `SKILL.md` omits any `faff-contract:spec-readiness` block while including `user-invocable: false` and the word "confidence".
- [ ] The fixture body trips no incidental charter/global lint (under 600 lines, no >200-word line, no stray-marker/war-story phrase, no `.faffrc` hand-read, no `via the Skill tool` line).

### From HOW (behaviour)
- [ ] The negative test asserts all of: `status !== 0`; stdout contains `(producer-spec)`; stdout matches `faff-contract:spec-readiness`; stdout matches `RESULT: FAIL`.
- [ ] (Recommended) A positive-control case asserts a conformant `faffter-noon-spec` fixture yields exit 0 and a `pass  faffter-noon-spec (producer-spec)` line.

### From HOW (integration)
- [ ] The new test runs under `node --test` and is discovered by `.github/workflows/validate.yml` with no workflow change; the full suite stays green.

**Integration smoke test:**
```
run `node --test test/validate-adapters.test.mjs`
EXPECT the new negative case present and passing, and the overall suite exit 0
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
