# Spec — FAFF-677: freshness-guard residue (durable proof-of-failure, the out-of-scope rep-range copies, and the drifting model string)

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: medium. Full spec on Linear FAFF-677.

**Orchestrator note (resolves the spec's stated `medium` driver):** the producer read a stale worktree (`ad43992`, before PR #518) and flagged the runbook's model line as stale with "#518 absent from history." On current `origin/main` (`db3d308`) **#518 is merged** and `eval/README.md:174` already reads `claude-opus-4-8`, matching `models.eval`. So the model check this spec adds lands **green with no README edit** — the spec's conditional handling ("left untouched if a prior PR already fixed it") is exactly the right-hand branch. There is no #518 sequencing dependency and no README edit in scope. The `medium` rating is retained as the producer set it, but its cause is resolved.

---

This spec is for the build agent hardening the eval-README freshness guard, and for the human reviewer who gates it. It resolves the four open questions the ticket carries, corrects three points where the ticket and its recon misread the codebase, and folds in one live drift the guard should have caught but doesn't. The common-case change is one file — `test/eval-readme-freshness.test.mjs`.

## 1. WHY — problem and principles

**The load-bearing idea: this guard is a containment check scoped to a named section of `eval/README.md`, and its whole value is that the scoping lets a deliberately-stale README actually fail it.** Everything below is either (a) widening which sections it scopes to, (b) adding one more fact it checks (the resolved model name), or (c) making its proof-of-failure durable instead of a one-shot dev-time demonstration. No mechanism is being invented; the existing derive-then-assert-containment shape is being extended.

**Problem.** FAFF-671 shipped `test/eval-readme-freshness.test.mjs` — it derives corpus/rep/gate numbers from `loadCases()`, `BASE_REPS`, `MAX_REPS`, and `eval/baselines/frontier.json`, and asserts each appears in the README's `## Re-baseline runbook` section. Three gaps remain: the proof that it *fails* on stale input was demonstrated once by hand and isn't repeatable; the same rep-range numbers appear in two other README sections the guard doesn't scope to; and the runbook names the resolved eval model in prose that the number-only guard never checks — the exact drift that slipped past CI this week (README said `claude-opus-5` while config returned `claude-opus-4-8`, hand-fixed in PR #518).

**Design principle — the guard stays a plain `node --test` file, zero-spawn.** The current file's header claims zero-spawn and derives everything in-process. Every addition here must hold that line: read config in-process via `loadConfig`, never shell out.

**Design principle — assert the resolved value, never forbid naming a value.** The runbook legitimately names three different model tokens in the same few lines (the current resolved model, the baked-in fallback, and the model an old production sweep ran on). Any model-string check must extract *the one named as current* and compare it to what config resolves — a bare "does the README contain string X" check would false-pass or target the wrong token.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/eval-readme-freshness.test.mjs` | Node ESM test | The guard being extended; 77 lines, zero-spawn, three inline helpers (`deriveFacts`, `runbookSection`, `formatReadmeNumber`), none exported |
| `eval/README.md` | Markdown | The artifact under guard; rep-range at lines 18, 103, 191–192; resolved-model prose at lines 173–174 |
| `eval/run-evals.mjs` | Node ESM | Exports `loadCases`, `BASE_REPS`, `MAX_REPS`, and `EVAL_MODEL_FALLBACK` (`"claude-sonnet-4-6"`) the guard imports |
| `plugin/skills/faff/bin/lib/config.js` | CommonJS | Exports `loadConfig`; returns a tuple `[cfg, path, overlayPath]` |
| `test/lights-out.test.mjs` | Node ESM test | Precedent for the exact in-process `loadConfig` import and `const [cfg] = loadConfig(root)` destructure this spec reuses |
| `plugin/skills/faff/bin/lib/lint-cli-doc.js` | CommonJS | The `--selftest` sibling whose synthetic-input proof shape (`check(label, got, want)` over pure helpers fed hand-built strings) this spec replicates *in-file*, not as a CLI subcommand |

**Scope.** This is a test-hardening chore on one existing guard file. It changes no production behaviour, no corpus, no baseline, and no README numbers.

## 2. OUT OF SCOPE

- **Converting the guard to a `bin/lib/` CLI subcommand with `--selftest`.** Why excluded: disproportionate — see the decision below. Extension point: if a future ticket wants a fixture-mode CLI, it lands as a new `plugin/skills/faff/bin/lib/lint-readme-freshness.js` registered in `plugin/skills/faff/bin/faff`'s `COMMANDS` map, with a `docs/guide/cli.md` row and a synthetic three-artifact `--root` fixture tree.
- **Changing the README's rep-range numbers, corpus, or baseline.** Why excluded: the numbers (`~1,580–3,950`, 79 cases) are already correct. Extension point: none needed; the guard exists precisely so a real corpus change is what moves them.
- **Touching `eval/run-evals.mjs`, `loadCases`, or the case corpus.** Why excluded: the guard reads these; it does not modify them.
- **Using `resolveEvalModel` (run-evals.mjs:510) to resolve the model.** Why excluded: it spawns `faff config get` (run-evals.mjs:520), which breaks the zero-spawn principle. Extension point: none — `loadConfig` is the in-process path.

## 3. WHAT — the shape of the change

**Vocabulary.**

| Term | Definition |
|---|---|
| runbook section | The `## Re-baseline runbook` slice of `eval/README.md`, the only section the shipped guard scopes to |
| rep-range | The pair `~1,580` / `3,950` describing the frontier-sweep cost; appears in three README sections |
| resolved eval model | The model a plain frontier sweep uses: `--model` flag, else `models.eval` from config, else the baked-in `claude-sonnet-4-6` fallback |
| named-current model | The single model token the runbook prose calls the current one — anchored by the phrase "currently returns \`…\`" |
| durable proof-of-failure | An in-file test that feeds a deliberately-stale synthetic README to the assert logic and asserts it reports failure, naming the stale fact |

**Helper shape after the refactor.** The three inline helpers become pure, synthetic-input-callable functions in the same file (exporting is optional — the proof test lives in-file and calls them directly; no new module):

```
FUNCTION sectionByHeading(readmeText, headingPrefix) -> string
  # Generalises the shipped runbookSection: find headingPrefix via indexOf,
  # assert it exists, slice to the next "\n## " (or end of file).
  # headingPrefix is matched as a PREFIX of the heading line, because the real
  # headings carry FAFF-id suffixes:
  #   "## Proportionate gate — `--gate` (FAFF-180)"   (rep-range at README:18)
  #   "## Running it (FAFF-131, human-supervised)"     (rep-range at README:103)
  #   "## Re-baseline runbook (FAFF-319) …"            (rep-range at README:191-192, already guarded)

FUNCTION checkFactsInSection(sectionText, facts) -> { ok, missing: [name] }
  # Pure containment check, formatting each fact the README's way
  # (formatReadmeNumber). Returns which derived facts are absent, does not throw.

FUNCTION extractNamedModel(readmeText) -> string | null
  # Anchored regex on the runbook prose: /currently returns\s*`([^`]+)`/
  # The \s* must span the line break between "returns" (README:173) and the
  # backtick (README:174). Returns the captured token or null if unanchored.

FUNCTION checkModel(readmeText, resolvedModel) -> { ok, named, resolved }
  # named = extractNamedModel(readmeText); ok = (named === resolvedModel).
```

**Config resolution (zero-spawn, mirrors `test/lights-out.test.mjs:37`):**

```
const [cfg] = loadConfig(EVAL_DIR-or-repo-root)
const resolvedModel = cfg.models?.eval ?? EVAL_MODEL_FALLBACK   # EVAL_MODEL_FALLBACK imported from run-evals.mjs
```

**Anti-pattern:** resolving the model with a bare `readme.includes(resolvedModel)`. Why: the runbook names `claude-sonnet-4-6` (the fallback) and `claude-opus-4-8` (an old sweep) in the same paragraph as the current value, so a contains-check passes even when the *current* token is wrong.

**Anti-pattern:** anchoring the model regex on `` `models.eval` `` … `currently returns` with a `[^`]*` gap. Why: the intervening text `` is set (`.faffrc.yaml`) and `` contains a backtick, so a no-backtick gap never matches. Anchor on the unique phrase `currently returns` alone.

## 4. HOW — behaviour

The file keeps its two existing tests and adds three assertion concerns. All read real inputs except the last, which is fed synthetic input.

```
PROCEDURE freshness_guard_tests:
  1. (unchanged) derived numbers appear in the runbook section
  2. (unchanged) base/worst rep totals equal case_count * BASE_REPS / MAX_REPS
  3. (new) rep-range copies present in all three sections:
     a. For each heading in ["## Re-baseline runbook", "## Proportionate gate", "## Running it"]:
        - section = sectionByHeading(readme, heading)
        - assert section contains formatReadmeNumber(base_total)  # "1,580"
        - assert section contains formatReadmeNumber(worst_total) # "3,950"
  4. (new) resolved model matches the named-current model in the runbook:
     a. resolvedModel = cfg.models?.eval ?? EVAL_MODEL_FALLBACK
     b. { ok, named, resolved } = checkModel(readme, resolvedModel)
     c. assert ok, with a message naming both `named` and `resolved`
  5. (new) durable proof-of-failure, synthetic input, no real files:
     a. Feed checkFactsInSection a section string missing a derived number ->
        assert ok === false AND the returned `missing` names that fact.
     b. Feed checkModel a README string whose "currently returns `X`" token
        differs from a supplied resolved value -> assert ok === false AND the
        report names the stale token.
     c. (guards the regex) Feed extractNamedModel a synthetic runbook with the
        real line-break-and-indent between "returns" and the backtick ->
        assert it returns the token, not null.
```

**The model-line correction, conditional (and on current main, a no-op).** The guard's model test passes only when README:174's named token equals `models.eval`. On current `origin/main` that already holds (`claude-opus-4-8` both sides, post-#518), so no README edit is made. The build agent reads README:174 before touching it — if it already names the config value, step 4 passes untouched; only if it somehow reads `claude-opus-5` is a one-line correction made. This is the only circumstance in which the change touches `eval/README.md` at all.

### Failure modes

- **The failure:** `extractNamedModel`'s regex silently returns `null` if the runbook prose is reworded away from "currently returns", making step 4 vacuously pass. **How you'd know:** step 5c fails, or step 4's message shows `named: null`. **What it means:** the check must treat `named === null` as a failure, not a pass — assert `named` is non-null before comparing.
- **The failure:** a fourth rep-range copy is added to the README later, in a section the guard still doesn't scope to. **How you'd know:** it drifts and nothing catches it — the same gap this ticket is closing, one section over. **What it means:** the three-section coverage is the known set today; a genuinely general "every `1,580`/`3,950` in the file lives in a covered section" assertion is a heavier, separate hardening not taken here.

## 5. Scenarios

```
Given eval/README.md's "## Proportionate gate" section with its rep-range edited to a stale "1,600"
When the freshness guard runs
Then the guard fails, naming the Proportionate-gate section and the expected "1,580"
```

```
Given .faffrc.yaml resolves models.eval to a value and README:174's "currently returns `X`" token differs from it
When the freshness guard runs
Then step 4 fails, naming both the README token and the resolved value
```

```
Given a synthetic README string whose "currently returns `X`" token matches the supplied resolved model, but whose "## Running it" section is missing the "3,950" worst-case number
When the assert helpers are called on that synthetic input
Then checkModel reports ok while checkFactsInSection reports not-ok, naming the absent worst_total in the Running-it section
```

- The guard performs zero process spawns (config read via in-process `loadConfig`, all inputs read via `readFileSync` or supplied as synthetic strings).

## 6. Design decision rationale

**Decision 1 — convert the guard to a `--selftest` CLI subcommand, or decline and prove durability in-file?** Option A (the ticket's framing) extracts a new `plugin/skills/faff/bin/lib/lint-readme-freshness.js`, registers it in `bin/faff`'s `COMMANDS`, adds a `docs/guide/cli.md` row (which then makes it subject to `lint-cli-doc` itself), and builds a `--root` fixture mode — and the fixture is the killer: `lint-cli-doc`'s fixture is one synthetic doc string, but this guard's inputs span three real artifacts (`eval/cases/*.json`, `eval/baselines/frontier.json`, `eval/README.md`), so a `--root` mode needs a whole synthetic tree. Option B refactors the assert logic into pure helpers and adds an in-file test that feeds a deliberately-stale synthetic README and asserts failure — the same `runOnDoc`-style proof `lint-cli-doc`'s `--selftest` uses, done in-file. **Chosen:** Option B — decline the CLI conversion, deliver durable repeatability via an in-file synthetic-input proof-of-failure. The CLI path's cost is disproportionate for a doc-freshness guard, and the in-file proof matches the sibling's proof shape without any of it. *Corrects the ticket:* the true `--selftest` sibling of `lint-cli-doc` is `lint-refs` (lint-cli-doc.js:71), not `eval-coverage-gate`/`validate-adapters`, which has no `--selftest` — grep-confirmed.

**Decision 2 — extend the guard to the two out-of-scope rep-range copies (README:18 `## Proportionate gate`, README:103 `## Running it`)?** Both are correct-but-unguarded today; nothing catches them drifting, the same class of gap FAFF-671 closed for the runbook. **Chosen:** cover all three sections. `grep` confirms exactly three copies (README:18, :103, :191–192); generalise `runbookSection(readme)` to `sectionByHeading(readme, headingPrefix)` and add assertion blocks over the two extra sections. The heading prefixes must be matched as prefixes (the real headings carry FAFF-id suffixes), exactly as the shipped `runbookSection` already matches `## Re-baseline runbook`.

**Decision 3 — add the resolved-model check?** This is the strongest single addition — it catches the exact drift that slipped past CI this week (#518), a drift the number-only guard never sees. **Chosen:** add it. Resolve in-process: `const [cfg] = loadConfig(root); const resolved = cfg.models?.eval ?? EVAL_MODEL_FALLBACK`. Extract the named-current token with `/currently returns\s*\`([^\`]+)\`/` (the phrase "currently returns" is unique in the README; the `\s*` spans the :173→:174 line break) and assert `named === resolved`. Not a containment check (three model tokens live in the region), not `resolveEvalModel` (it spawns). Well-precedented — `test/lights-out.test.mjs` reads config the same way.

**Decision 4 — keep it a plain `node --test` file?** **Chosen:** yes. The file stays `test/eval-readme-freshness.test.mjs`, zero-spawn (`loadConfig` is in-process, not a spawn), and the refactor restructures the derive/assert logic into pure helpers just enough to unit-test them on synthetic input. Follows directly from Decision 1 — no CLI subcommand, no new module.

## 7. Open questions and assumptions

**Open questions:** none. All four decisions are closed.

**Assumptions:** none requiring external validation. The config source (`.faffrc.yaml` `models.eval`) and every imported symbol (`loadConfig`, `EVAL_MODEL_FALLBACK`, `loadCases`, `BASE_REPS`, `MAX_REPS`) were verified present. The one uncertainty the producer flagged — README:174's value — is now confirmed by the orchestrator to be `claude-opus-4-8` on current `origin/main` (post-#518), so the model check lands green with no README edit; the spec's conditional handling covers the edit only if a future rebase somehow un-does #518.

## 8. DONE — definition of done

### From WHY
- [ ] The guard remains a plain `node --test` file and performs zero process spawns (config read via in-process `loadConfig`).

### From WHAT / HOW (rep-range coverage)
- [ ] `runbookSection` is generalised to `sectionByHeading(readme, headingPrefix)`, matching the heading as a prefix.
- [ ] The guard asserts `1,580` and `3,950` (formatted the README's way) appear in all three sections: `## Re-baseline runbook`, `## Proportionate gate`, `## Running it`.
- [ ] A stale rep-range in the `## Proportionate gate` or `## Running it` section fails the guard, naming that section.

### From WHAT / HOW (model check)
- [ ] The guard resolves the eval model in-process as `cfg.models?.eval ?? EVAL_MODEL_FALLBACK`, with no spawn.
- [ ] `extractNamedModel` captures the "currently returns \`…\`" token, spanning the line break, and returns `null` when the anchor phrase is absent.
- [ ] The guard asserts the named-current token equals the resolved model, treats `null` as failure, and its failure message names both the README token and the resolved value.
- [ ] `eval/README.md` is left untouched unless README:174 reads `claude-opus-5` (it does not, on current main) — no README edit in the common case.

### From HOW (durable proof-of-failure)
- [ ] A test feeds a deliberately-stale synthetic section to `checkFactsInSection` and asserts it reports the missing fact by name.
- [ ] A test feeds a mismatched synthetic README to `checkModel` and asserts it reports failure naming the stale token.
- [ ] A test feeds a synthetic runbook with the real line-break/indent to `extractNamedModel` and asserts it captures the token.

### Integration smoke test
```
1. Run `node --test test/eval-readme-freshness.test.mjs` against the real repo.
2. Expect: green — all three sections carry the rep-range, and README:174's model
   token matches models.eval (claude-opus-4-8 on both sides today).
3. Sanity: temporarily edit README:174's token to a wrong value; expect the model
   test to fail naming both tokens; revert.
```

confidence: medium