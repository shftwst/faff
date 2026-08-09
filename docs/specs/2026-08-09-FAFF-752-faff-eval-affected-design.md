# FAFF-752 — `faff eval affected`: derive the eval `--kind` subset a change needs

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-752.

## Already shipped against this surface

These Done tickets are adjacent but do **not** supersede this work — they are the inputs and consumers this subcommand composes:

- **FAFF-280** (Done) — built the `judgement_seam:` declaration + `eval/seam-registry.json` (KIND→surface SSOT). This is the *input* `eval affected` reads, not an overlap.
- **FAFF-712** (Done) — added `--kind` to `--update-baseline` for scoped re-baselining. This is the *consumer* the subset feeds; it scopes but does not *derive* the subset.
- **FAFF-180** (Done) — established the "scale the sweep to change size" motivation and delivered the `--kind` scaling mechanism (via FAFF-712), but not the automatic touched-surface→KIND derivation. That derivation is exactly this ticket, and no `eval` subcommand exists in the CLI today.

This spec is for the build agent implementing FAFF-752 and the humans reviewing it. It specifies a new, plain (non-contract) `faff eval affected` CLI subcommand that, given the skill surfaces a change touches, computes the minimal set of eval grader `KIND`s whose baselines that change could move — so the operator-owned eval-sweep-gate can re-baseline a scoped subset instead of the full frontier sweep, or skip the sweep entirely when nothing graded was touched.

## 1. WHY — Problem and Principles

**The load-bearing model.** Every eval grader `KIND` is *backed by exactly one skill surface* — the mapping already lives, machine-readable, in `eval/seam-registry.json` (`KIND → {surface}`) cross-referenced with each skill's `judgement_seam:` frontmatter (`none`, or the named KINDs it owns). A change therefore only endangers the graded baselines of the surfaces it touches. `eval affected` is nothing more than the deterministic composition of those two existing sources: touched surfaces → their declared seams → the affected `KIND` subset.

**Problem statement.** The eval-sweep-gate holds prose-driven autonomous-posture changes behind a re-baseline before merge, but today applies it bluntly as a full frontier sweep — long and expensive — even when the change touches no graded seam. FAFF-749 is the live case: it changed both concurrency executors, both declare `judgement_seam: none`, so the correct affected subset was empty yet a full sweep was run. This subcommand computes the real subset (or `none`) from information that already exists.

**Design principles.**

- **Fail-safe to the full sweep — never under-recommend.** A missed `KIND` that silently regressed is far worse than one redundant run. Any doubt — an unresolvable surface, a touched surface the tool can't confidently classify, a declared seam that doesn't reconcile against the registry — resolves to the **full** sweep, not to `none` and not to a narrowed subset. `none` is emitted *only* when every touched surface is confidently non-grading.
- **Suggestion/scoping only, never a gate.** It scopes a sweep the operator already decided to run; it never changes what the evals grade or the pass/fail bar, and the full authoritative sweep stays available. It is not a `faff contract` verdict.
- **Reuse the existing readers, don't re-parse.** Frontmatter and registry parsing already exist and are tested; this subcommand composes them rather than re-implementing YAML/JSON parsing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (CJS) | CLI entrypoint; flat `COMMANDS` dispatch table to extend |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node | Exports `readJudgementSeam(text)` and `loadSeamRegistryForLint()` — reused verbatim |
| `plugin/skills/faff/bin/lib/argv.js` | Node | Shared `parseArgs` / `usageError` fail-closed arg parser |
| `plugin/skills/faff/bin/lib/adr.js` | Node | Precedent for a one-key subcommand that dispatches on a positional sub-verb |
| `eval/seam-registry.json` | JSON | SSOT: `{version, kinds: {KIND: {surface, status}}}`, 32 KINDs |
| `eval/grader.mjs` | Node (ESM) | Exports `KINDS` (32) — the canonical KIND vocabulary, asserted equal to registry keys |
| `eval/run-evals.mjs` | Node (ESM) | Consumer of the `--kind` subset; `changedFilesFromGit()` is the diff-classifier precedent |
| `docs/guide/cli.md` | Markdown | CLI reference table; a new subcommand row is CI-enforced by `faff lint-cli-doc` |

**Scope statement.** This adds one advisory read-only subcommand to the existing faff CLI; it sits beside `eligible` / `adr` as a plain deterministic command, upstream of the operator-run eval-sweep-gate.

## 2. OUT OF SCOPE

- **Wiring the subset into the eval-sweep-gate.** — The eval-sweep-gate is operator-owned prose, not shipped code; there is nothing in the repo to modify. *Extension point:* operators paste `faff eval affected` output into `node eval/run-evals.mjs --driver frontier --update-baseline --kind <subset> eval/baselines/frontier.json`.
- **prep / graft stamping the suggested subset onto the ticket or PR.** — This is a separate, prose-touching change to `faff-prep` / `faff-graft` SKILL.md (itself an autonomous-posture change), independent of shipping the primitive. Keeping it out keeps this slice a single 1–3 day unit. *Extension point:* `plugin/skills/faff-prep/SKILL.md` and `plugin/skills/faff-graft/SKILL.md` can call `faff eval affected --diff <base> --json` and render the `kinds`/`reason` into a spec/PR note.
- **Smarter file-class heuristics** (treating pure-doc or test-only changes as non-affecting). — Adds classification surface with an under-recommend risk; the fail-safe default (any non-skill-dir touch → full) is correct and cheap. *Extension point:* a future path-class allowlist inside the diff→surfaces resolver.
- **Changing the seam registry, the `KIND` vocabulary, or grading.** — This command only reads them. Registry/vocabulary changes are FAFF-280's domain.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Surface | A skill, identified by its directory name under `plugin/skills/<surface>/`, whose `SKILL.md` may declare a `judgement_seam:`. |
| Judgement seam | The `judgement_seam:` frontmatter value of a surface: `none` (asserted non-grading), or a comma list of KIND ids it owns. |
| KIND | One of the 32 grader kinds (SSOT: keys of `eval/seam-registry.json` `kinds`, mirrored by `eval/grader.mjs` `KINDS`). |
| Affected subset | The union of KINDs backed by the touched surfaces — the value passed to `run-evals.mjs --kind`. |
| Verdict | The command's answer: `none`, `subset`, or `full` (fail-safe). |

**CLI surface.**

```
faff eval affected [--surfaces a,b,…] [--diff <ref>] [--json] [--root DIR] [--selftest]

  --surfaces   comma list of surface (skill) names touched by the change
  --diff       a git ref; touched files = `git diff --name-only <ref>...HEAD`
  --json       emit the structured verdict instead of the human line
  --root       repo root (default: findRoot() walking up from cwd)
  --selftest   run the in-module case table, print RESULT, exit 0/1

  At least one of --surfaces / --diff is required (both ⇒ union of surfaces).
```

**Verdict record (the `--json` shape).**

```
RECORD AffectedVerdict:
  verdict: ENUM { none, subset, full }
  kinds: List<KIND>            # sorted, unique; [] for none and full
  surfaces: List<String>       # the touched surfaces the command resolved
  reason: String               # always present; why this verdict (esp. for full)
```

**Plain (non-`--json`) stdout, one line, exit 0 for all three verdicts:**

- `subset` → the comma-joined kinds, e.g. `dupe,vague,stale` (directly usable as `--kind` value)
- `none` → `none — no eval-graded judgement seam touched`
- `full` → `full — <reason>`

**Exit codes.** `0` for any successful classification (`none` / `subset` / `full` are all valid answers); `2` for a usage error (unknown flag, missing value, neither `--surfaces` nor `--diff` given) via `usageError`.

**Design decision — command placement.** `eval` becomes one top-level `COMMANDS` key whose handler branches on the positional sub-verb `affected`, mirroring `adr` (`adr new|list|validate|…`) rather than registering `eval-affected` as a flat key. This leaves room for future `eval` sub-verbs and matches the house convention.
**Chosen:** `COMMANDS["eval"] = cmdEval`; `cmdEval` dispatches `args[0] === "affected"`; unknown sub-verb → `usageError`.

**Design decision — KIND vocabulary source.** The full-sweep KIND set and the validity check for declared seams both need the canonical 32 KINDs.
**Chosen:** the keys of `eval/seam-registry.json` `kinds` are the SSOT (already asserted equal to `grader.mjs` `KINDS` by `validate-adapters`); read them from the registry the command already loads, avoiding an ESM import of `grader.mjs` from CJS.

## 4. HOW — Behavior

**Architecture.** `cmdEval(args)` → (selftest short-circuit) → `parseArgs` → resolve touched surfaces from `--surfaces` and/or `--diff` → load the registry via `loadSeamRegistryForLint()` → for each surface read its `judgement_seam` via `readJudgementSeam(SKILL.md)` and reconcile against the registry → fold into a single `AffectedVerdict` via the pure `classifyAffected(...)` core → render (plain line or `--json`). The pure core takes injected data so `--selftest` exercises every branch without git or the real skill tree.

**Resolving touched surfaces.**

```
PROCEDURE resolve_surfaces(args, root):
  surfaces := {}
  IF --surfaces given: add each comma-split, trimmed, non-empty name
  IF --diff <ref> given:
     files, ok := git_changed_files(ref, root)      # `git diff --name-only <ref>...HEAD`, cwd=root
     IF NOT ok:                                       # git failed / not a repo
        RETURN { surfaces, diff_ok: false }           # caller fails safe → full
     FOR each file:
        IF file matches `plugin/skills/<name>/…`:  add <name> to surfaces
        ELSE: add sentinel UNCLASSIFIED(file)          # a non-skill-dir touch
  RETURN { surfaces, diff_ok: true }
```

**The classifier core (pure — the unit under selftest).**

```
PROCEDURE classify_affected(surfaces, diff_ok, seam_of, registry):
  # seam_of(name) → null (undeclared) | "none" | List<KIND declared>
  # registry.kinds → { KIND: { surface, status } }

  1. IF diff_ok is false:
        RETURN full("could not resolve touched files from the diff ref")
  2. IF surfaces contains any UNCLASSIFIED sentinel:
        RETURN full("touched files outside any skill surface: <paths>")
  3. IF surfaces is empty:
        RETURN none                                    # nothing touched, nothing to sweep
  4. affected := empty set
     FOR each surface s in surfaces:
        declared := seam_of(s)
        IF declared is null:                            # no judgement_seam frontmatter
           RETURN full("surface '<s>' declares no judgement_seam — cannot confirm non-grading")
        IF declared == "none":
           continue                                     # confidently non-grading
        FOR each KIND k in declared:
           row := registry.kinds[k]
           IF row is missing OR row.surface != s:       # seam doesn't reconcile
              RETURN full("surface '<s>' seam '<k>' does not reconcile against the registry")
           affected.add(k)
  5. IF affected is empty:
        RETURN none                                     # every touched surface was `none`
  6. RETURN subset(sorted(affected))
```

**Reason strings are always populated** — including for `none` (`"every touched surface declares judgement_seam: none or owns no graded kind"`) and `subset` (`"<n> surface(s) back <m> graded kind(s)"`) — so the `--json` consumer never sees an empty reason.

**Registry load failure is fail-safe.** `loadSeamRegistryForLint()` returns `{registry, error}`. `error` non-null, or `registry` null while surfaces resolved to a potentially-grading set, → `full("<error or 'seam registry unavailable'>")`. (The `{registry:null, error:null}` no-`eval/`-dir case can only arise in a plugin-only install with no repo eval tree; treat it identically — `full`, since the command cannot prove `none`.) Note: `loadSeamRegistryForLint()` resolves the registry from the CLI's own location and does not honour `--root`; `--root` drives only the surface `SKILL.md` reads and the git cwd. A build wanting a fixture registry must accept this or thread `--root` into an alternate loader — the integration smoke test uses the real registry to sidestep it.

**Missing SKILL.md for a named surface.** A `--surfaces` name (or a `--diff`-derived name) with no readable `plugin/skills/<name>/SKILL.md` → `seam_of` returns null → step 4 yields `full("surface '<s>' declares no judgement_seam …")`. A typo'd surface name is thus surfaced in the reason rather than silently dropped — the fail-safe direction.

**Edge cases.**

- `--surfaces` and `--diff` both given → union of both surface sets before classification.
- Duplicate surfaces (same name from both inputs, or repeated) → de-duplicated.
- `--diff <ref>` where `ref` is unknown to git → `git_changed_files` fails → `diff_ok:false` → `full`.
- Empty diff (ref resolves, zero changed files) → `diff_ok:true`, empty surfaces → `none`.
- Declared seam listing a KIND whose registry row points at a *different* surface → `full` (the reconcile guard) — this is exactly the drift `validate-adapters` also guards, mirrored here as fail-safe rather than a hard error.

**Failure modes.**

- **The failure:** the diff→surface path over-recommends `full` so persistently (every code change touches a non-skill file) that operators ignore the tool. **How you'd know:** in practice `--diff` almost always returns `full` while `--surfaces` returns useful subsets. **What it means:** acceptable for v1 — `--surfaces` is the precise entry, `--diff` is the fail-safe convenience; smarter file-class heuristics are a named OUT-OF-SCOPE extension, not a v1 gap.
- **The failure:** a surface's frontmatter is stale (declares a seam the registry no longer backs), so the tool returns `full` where a subset was correct. **How you'd know:** the `full` reason names the non-reconciling `<surface> seam <kind>`. **What it means:** proceed — `full` is the safe direction and the reason points the human straight at the drift to fix (in the skill or the registry).

**Anti-pattern:** emitting `none` for an undeclared (null-frontmatter) surface. Why: undeclared ≠ asserted-none; only an explicit `judgement_seam: none` (or a fully-reconciled empty contribution) is confident enough for `none`. Undeclared must fail safe to `full`.

**Anti-pattern:** importing `eval/grader.mjs` (ESM) into the CJS CLI for the `KINDS` list. Why: needless cross-module-system coupling; the registry keys are the same SSOT and are already loaded.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a change touching only surfaces whose SKILL.md declares `judgement_seam: none`
When `faff eval affected --surfaces faffter-dark-concurrency-parallel,faffter-noon-concurrency-sequential` runs
Then stdout is `none — no eval-graded judgement seam touched` and exit code is 0
```

```
Given a change touching `faff-tidy` (which declares seams incl. `dupe`, `vague`)
When `faff eval affected --surfaces faff-tidy` runs
Then stdout is the comma-joined sorted KIND subset that reconciles against the registry (includes `dupe,vague`) and exit code is 0
```

```
Given a `--diff <ref>` that git cannot resolve, or a change touching a file outside any skill surface
When `faff eval affected --diff <ref>` runs
Then stdout is `full — <reason>` naming the cause and exit code is 0
```

```
Given `--surfaces` and `--diff` both supplied naming overlapping surfaces
When `faff eval affected --surfaces faff-tidy --diff <ref-touching-faff-tidy>` runs
Then the surface set is the de-duplicated union and each backing KIND appears at most once in the subset
```

- The subset output MUST be directly usable as a `run-evals.mjs --kind` value (comma-joined, no spaces required, sorted, unique).

## 6. Design Decision Rationale

**Where does `affected` live in the command tree?**
- Flat `eval-affected` key — simple, but no room for sibling `eval` verbs and off-house-convention.
- `eval` key with `affected` sub-verb — mirrors `adr`, extensible.
**Chosen:** `eval` key + `affected` sub-verb — matches the established two-word-subcommand convention (`adr`, `config`, `contract`).

**Where do the KINDs come from?**
- Import `KINDS` from `grader.mjs` — direct, but ESM-into-CJS.
- Read registry keys — same SSOT, already loaded, no cross-module-system import.
**Chosen:** registry keys, with `validate-adapters`' existing keys==KINDS assertion as the guarantee they agree.

**How wide is the fail-safe net for `--diff`?**
- Classify only skill-dir touches; treat every non-skill-dir touch as unclassifiable → `full`.
- Try to reason about non-skill files (grader, tests, docs) → risks under-recommending.
**Chosen:** any touched path outside `plugin/skills/<surface>/` forces `full`. Over-recommending is the safe direction; `--surfaces` gives operators the precise path when they know the surfaces.

**Is this a `faff contract` verdict?**
- No — it is advisory scoping, not a gated pass/fail against a fixed schema. It ships as a plain `COMMANDS` entry like `eligible`, with no `contract-defs.js` row and no schema file.
**Chosen:** plain subcommand.

**Git call hygiene.**
**Chosen:** invoke the diff via an argv-array (`execFile`/`spawnSync` with args), not a shell string, so the operator-supplied ref is never shell-interpolated — generic hygiene even though the ref is operator- not attacker-controlled.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking.

**Assumptions.**

- **Assumes:** `readJudgementSeam(text)` and `loadSeamRegistryForLint()` are exported from `plugin/skills/faff/bin/lib/validate-adapters.js` with the signatures the explore found (`readJudgementSeam` → `null | "none" | string[]`; `loadSeamRegistryForLint` → `{registry, error}`). *Validate:* `grep -n "module.exports" plugin/skills/faff/bin/lib/validate-adapters.js` and confirm both are exported before reusing; if not exported, add them to the export list (same file).
- **Assumes:** `eval/seam-registry.json` shape is `{version, kinds: {KIND: {surface, status}}}` and its keys equal `grader.mjs` `KINDS`. *Validate:* the existing `validate-adapters` selftest already asserts this; run `node plugin/skills/faff/bin/faff validate-adapters --selftest` (or the seam test) to confirm before relying on registry keys as the KIND SSOT.
- **Assumes:** the `parseArgs`/`usageError` (`argv.js`) and `findRoot` (`shared-infra.js`) helpers are available to a new `bin/lib` module as the other subcommands use them. *Validate:* confirm the `require("./argv")` / `require("./shared-infra")` paths resolve from `bin/lib/eval-affected.js`.

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `faff eval affected` for a change touching only `judgement_seam: none` surfaces emits `none` (the FAFF-749 case no longer implies a full sweep).

### From WHAT (CLI surface & types)
- [ ] `faff eval affected` accepts `--surfaces <a,b,…>`, `--diff <ref>`, `--json`, `--root`, `--selftest`; at least one of `--surfaces`/`--diff` required else exit 2 via `usageError`.
- [ ] `eval` is registered as one `COMMANDS` key dispatching the `affected` sub-verb; an unknown sub-verb is a usage error.
- [ ] A row for `eval` is added to `docs/guide/cli.md` (so `faff lint-cli-doc` passes).
- [ ] `--json` emits `{verdict, kinds, surfaces, reason}` with `verdict ∈ {none,subset,full}`, `kinds` sorted+unique, `reason` always non-empty.

### From HOW (behaviour)
- [ ] A surface declaring a covered KIND → that KIND appears in a `subset` verdict.
- [ ] Every touched surface `judgement_seam: none` (or reconciling to no kind) → `none`.
- [ ] `--surfaces` + `--diff` together → union of surfaces before classification; duplicates de-duplicated (a dedicated end-to-end scenario covers this).
- [ ] Subset stdout is the comma-joined sorted unique KIND list, directly usable as `run-evals.mjs --kind`.

### From HOW (fail-safe direction — load-bearing)
- [ ] A `--diff` ref git cannot resolve → `full` (exit 0), reason names the diff failure.
- [ ] A touched file outside any `plugin/skills/<surface>/` dir → `full`, reason names the path(s).
- [ ] An undeclared (null-frontmatter) touched surface → `full`, never `none`.
- [ ] A declared seam whose registry row names a different surface (or is missing) → `full`, reason names surface+kind.
- [ ] Registry load error / unavailable registry → `full`.

### From HOW (reuse)
- [ ] `readJudgementSeam` and `loadSeamRegistryForLint` are reused from `validate-adapters.js`, not re-implemented (exported there if not already).
- [ ] The git diff is invoked via an argv-array (not a shell string).

### Tests
- [ ] `faff eval affected --selftest` exercises each branch: `none`, `subset`, undeclared→`full`, non-reconciling-seam→`full`, unclassified-file→`full`, empty→`none`; prints a `RESULT: PASS/FAIL (N cases, M failed)` line and exits 0/1.
- [ ] A `test/*.test.mjs` spawn test (via `test/helpers/run-cli.mjs`) covers at least the `none`, `subset`, and a `full` fail-safe path end-to-end against real surfaces + the real registry.

**Eval coverage.** This change introduces no new LLM-judgement seam — it is a deterministic composition of two existing machine-readable sources — so no new grader `KIND` / eval case / seam-registry row is required. (`faff eval affected --surfaces faff` over its own change should itself return `none`, since the touched surface is the CLI, not a graded skill.)

**Integration smoke test.**

```
1. Add a KIND-bearing surface (e.g. faff-tidy) and a `none` surface to --surfaces.
2. Run: faff eval affected --surfaces faff-tidy,faffter-noon-env-compose --json
3. Assert verdict == "subset", kinds includes faff-tidy's reconciled kinds, env-compose contributes nothing.
4. Run with a bogus surface: faff eval affected --surfaces does-not-exist
5. Assert verdict == "full" (undeclared/unreadable → fail-safe), reason names the surface.
```

confidence: high
spec-review: approve
