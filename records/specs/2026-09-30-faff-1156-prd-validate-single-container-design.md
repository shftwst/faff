# Spec — `faff prd validate <container>`: validate a single PRD (FAFF-1156)

> Spec: faffter-dark-nlspec · 2026-09-30 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1156.

This spec is for the build agent implementing FAFF-1156, and for the human reviewer gating it. It describes a small, mechanical addition to the `faff prd validate` handler in `plugin/skills/faff/bin/lib/prd.js`: an optional positional that scopes validation to one PRD, leaving the whole-directory behaviour untouched.

## 1. WHY — Problem and Principles

**The core model.** `faff prd validate` is a whole-directory sweep: it calls `prdValidate(dir, opts)`, which iterates *every* PRD under `docs/prd/` and returns one flat list of problems. This change adds a **filter** in front of that iteration keyed on an already-parsed positional — nothing about *how* a PRD is validated changes, only *which* PRDs the sweep covers.

**Problem statement.** Today `faff prd validate [--strict]` always validates the whole `docs/prd/` tree, so an author iterating on one PRD must read past unrelated failures from other PRDs. This change adds `faff prd validate <container> [--strict]` to validate just that one PRD; omitting the positional keeps today's whole-directory behaviour byte-for-byte.

**Design principles.**

**Reuse the container→file grammar, do not invent a second one.** The `path`, `new`, and `link` verbs already turn a container name into a file with `prdSlug(container)` + `path.join(dir, slug + ".md")`. The new positional MUST speak that same noun so `validate <container>` resolves identically to `path <container>`. A divergent resolution axis (file paths, PRDs outside `docs/prd/`) is out of scope.

**One validation path, not two.** Single-PRD and whole-directory validation MUST share the same per-PRD checks (Container/Status/Date presence, body/collision, `--strict` and Frozen form-checks). The difference is the set iterated, nothing else — so a form-check can never drift between the two forms.

**Fail loud on a typo, never silently pass.** A named container that resolves to no PRD file MUST fail-loud (exit 2), not report "0 problems" (exit 0). An empty result set is indistinguishable from success at the problem-list layer, so the existence gate lives in the handler where the exit code is owned.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/prd.js` | JavaScript | The `cmdPrd` handler + `prdValidate`/`listPrds`/`prdSlug` this change edits and reuses |
| `plugin/skills/faff/bin/lib/cli-surface.js` | JavaScript | Reads `PRD_SURFACE`; the drift-guard's source of truth for the CLI grammar |
| `test/prd.test.mjs` | JavaScript | Real-binary CLI integration tests (exit codes) — home for the handler-level cases |
| `test/scaffolder-cli-surface-drift.test.mjs` | JavaScript | Static drift-guard over the declared surface — confirm it stays green |

**Scope statement.** This sits entirely inside the `faff prd validate` subcommand handler and the `prdValidate` helper in `prd.js`; no other verb, contract, or gate is touched.

## 2. OUT OF SCOPE

- **File-path / arbitrary-location target** — validating a PRD by file path, or a root `PRD.md` outside `docs/prd/`. **Why excluded:** it is a different resolution axis no sibling verb speaks, and the ticket itself flags it as possible scope creep. **Extension point:** the target-resolution block in `cmdPrd`'s `validate` branch — a future issue could branch on `container` looking like a path (contains `/` or ends `.md`) before falling back to slug resolution.
- **Changing any validation rule** — the presence checks, the strict born-verifiable form-check, the Frozen freeze precondition. **Why excluded:** this issue is a target selector, not a rule change. **Extension point:** `prdValidate` / `prdStrictCheck`.
- **Multiple positional targets** (`validate a b c`). **Why excluded:** unasked; the acceptance criteria are single-target. **Extension point:** the same target-resolution block, generalised to a loop.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| container | The name of a container (project/epic) a PRD belongs to; the positional the user types. |
| slug | `prdSlug(container)` — the kebab-cased key; also the PRD file's basename (`<slug>.md`) and `listPrds` entry's `.slug`. |

**The one interface change** — `prdValidate` gains an optional `only` slug filter:

```
FUNCTION prdValidate(dir, opts):
  opts: { strict?: boolean, only?: string | null }   # only = a slug; null/absent = whole-dir (unchanged)
  RETURNS string[]                                    # problem lines, exactly as today

  CONSTRAINT  only == null  =>  byte-for-byte identical behaviour to today
```

Handler-side, the `validate` branch resolves the target the same way `path` does:

```
target_file = path.join(dir, prdSlug(container) + ".md")   # identical to the `path` verb
```

**Design decision — target grammar.**

- Container-slug (reuse `prdSlug` + `path`'s resolution) — one noun across all verbs; the file is already keyed by slug.
- File path / both — a second resolution axis, unused elsewhere, flagged as scope creep by the ticket.

**Chosen:** container-slug only, resolved via `prdSlug(container)` + `path.join(dir, slug + ".md")` — reuses the canonical grammar `path`/`new`/`link` already speak; the path form is deferred to the OUT OF SCOPE extension point.

**Design decision — reuse mechanism.**

- Filter `listPrds(dir)` to `p.slug === only` inside `prdValidate` — one code path; every per-PRD check (presence, strict, Frozen) is reused verbatim.
- Validate the one resolved file on a separate path — duplicates the per-PRD problem-building loop, inviting drift.

**Chosen:** the `only` slug filter inside `prdValidate` — a single iteration path, no divergence between the two forms.

**Design decision — unknown container.**

- Fail-loud exit 2 with `no PRD found for <container>` — matches `path`/`new`/`link`'s container-precondition exit 2; distinguishes "no such PRD" (exit 2) from "PRD exists but invalid" (exit 1).
- Empty-OK (exit 0) — silently passes a typo'd container.

**Chosen:** fail-loud exit 2, checked in the handler (where the exit code is owned) before calling `prdValidate`. The existence check reuses `path`'s resolution: `fs.existsSync(target_file)`.

**Decision — CLI surface.** `PRD_SURFACE.subcommands.validate.required_flags` stays `[]` and `PRD_SPEC.positionals` stays `{ min: 0, max: null }`. The positional is already generic and already parsed at `prd.js:164`; the drift-guard asserts only subcommand existence and required-flag sets, neither of which changes. **Chosen:** no surface change — confirmed against `cli-surface.js` (`assembleSurfaces`/`acceptedFlags`) and `test/scaffolder-cli-surface-drift.test.mjs`.

## 4. HOW — Behavior

**Architecture.** Two edits, both in `prd.js`:

1. `prdValidate(dir, opts)` reads an optional `opts.only` slug and filters the PRD list before the problem loop.
2. The `validate` branch of `cmdPrd` branches on the already-parsed `container` (`prd.js:164`): null → today's whole-dir call and message; non-null → existence-gate (exit 2 on miss) then a filtered call with a single-PRD success message.

**`prdValidate` filter** — the only change to the helper:

```
PROCEDURE prdValidate(dir, opts):
  1. strict = !!(opts && opts.strict)
  2. only   = (opts && opts.only) || null
  3. prds   = listPrds(dir)
  4. IF only != null: prds = prds.filter(p => p.slug === only)
  5. build `problems` by iterating `prds`   # UNCHANGED from today
  6. RETURN problems
```

**`validate` handler branch** — replaces `prd.js:185-191`:

```
PROCEDURE handle_validate(args, dir, root, container):
  strict = args.includes("--strict")
  IF container == null:                     # whole-dir — BYTE-FOR-BYTE today's code
    problems = prdValidate(dir, { strict })
    IF problems empty: print `OK — ${listPrds(dir).length} PRD(s) in ${rel(dir)} valid${strict ? " (strict: born-verifiable)" : ""}.`; RETURN 0
    FOR p IN problems: print `FAIL  ${p}`
    RETURN 1
  # single-PRD
  slug = prdSlug(container)
  full = path.join(dir, slug + ".md")
  IF NOT fs.existsSync(full):
    stderr `faff prd validate: no PRD found for ${container}`
    RETURN 2
  problems = prdValidate(dir, { strict, only: slug })
  IF problems empty: print `OK — PRD ${slug} valid${strict ? " (strict: born-verifiable)" : ""}.`; RETURN 0
  FOR p IN problems: print `FAIL  ${p}`
  RETURN 1
```

**Behaviour summary.** No positional → the existing whole-dir sweep and its `N PRD(s)` message, verbatim. A known container → the same per-PRD checks over one PRD, with a message naming just that PRD. An unknown container → exit 2 before any validation.

**Edge cases.**

- **Frozen precondition still fires for a single target.** `prdValidate` always strict-checks a `Frozen` PRD even without `--strict`. Because the filter runs *before* the unchanged loop, `validate <a-frozen-prose-prd>` fails (exit 1) with no `--strict`, exactly as the whole-dir sweep would for that PRD. This is reused behaviour, not new.
- **`--strict` composes unchanged.** `validate <container> --strict` applies the born-verifiable form-check to the one filtered PRD.
- **Container must precede flags.** The container binds from `args[1]` (`prd.js:164`), so `validate --strict <container>` leaves `container` null and validates the whole dir. This is the *existing* constraint shared by `path`/`new`/`link` — reused verbatim, not introduced here.

**Anti-pattern:** resolving the target by scanning `listPrds` for a fuzzy name match. Why: the file is slug-keyed; `prdSlug(container)` + `fs.existsSync` is the exact, deterministic resolution `path` already uses, and any looser match would diverge from it.

**Anti-pattern:** putting the "no PRD found" check inside `prdValidate`. Why: `prdValidate` returns a problem list where empty means valid; an empty *filter result* would read as exit 0, silently passing a typo. The existence gate belongs in the handler that owns the exit code.

**Failure modes.** None above the complexity bar — this is a mechanical filter over an existing iteration with no measurement, integration, or unvalidated-benefit risk. The one non-obvious confound (empty filter reading as success) is closed structurally by the handler-side existence gate, above.

## 5. Scenarios — born-verifiable main objectives

```
Given docs/prd/ holding several valid PRDs
When `faff prd validate` runs with no positional
Then it exits 0 and prints `OK — N PRD(s) in <dir> valid`, unchanged from today
```

```
Given docs/prd/ holding a valid PRD for container "Alpha" and an invalid PRD for another container
When `faff prd validate alpha` runs
Then it exits 0 and the message names PRD alpha, and none of the other PRD's problems are printed
```

```
Given docs/prd/ holding an invalid PRD (e.g. missing Status) for container "Beta" and other valid PRDs
When `faff prd validate beta` runs
Then it exits 1 and prints FAIL lines for beta only
```

```
Given a container "Gamma" with no PRD file under docs/prd/
When `faff prd validate gamma` runs
Then it exits 2 and stderr reads `faff prd validate: no PRD found for gamma`
```

```
Given a Draft PRD for "Delta" whose acceptance criteria are loose prose
When `faff prd validate delta --strict` runs
Then it exits 1 with a not-born-verifiable FAIL for delta, and `faff prd validate delta` (no --strict) exits 0
```

## 6. Design Decision Rationale

**Which target grammar?** Container-slug vs file path vs both. **Chosen:** container-slug only — the file is slug-keyed and every sibling verb (`path`/`new`/`link`) already resolves a container this way; a path form is a distinct axis deferred to the OUT OF SCOPE extension point.

**How does single-PRD reuse the sweep?** A slug filter in `prdValidate` vs a separate one-file validation path. **Chosen:** the `only` filter — one iteration path keeps the per-PRD checks (presence, strict, Frozen) identical across both forms; a second path would invite drift.

**What happens on an unknown container?** Exit 2 fail-loud vs empty-OK. **Chosen:** exit 2 in the handler — consistent with `path`/`new`/`link`'s container-precondition exit 2, and it keeps "no such PRD" (exit 2) distinct from "PRD invalid" (exit 1). Empty-OK was rejected because it silently passes typos.

**Does the CLI surface change?** **Chosen:** no. The positional is already declared (`{min:0, max:null}`) and parsed; `validate.required_flags` stays `[]`. Verified against `cli-surface.js` and the drift-guard test, both of which key on subcommands and required flags only.

## 7. Open Questions and Assumptions

**Open Questions.** None — every decision above is closed.

**Assumptions.**

**Assumes:** `prdSlug(container) + ".md"` is the PRD file's basename, so `listPrds` entry `.slug === prdSlug(container)` for an existing PRD. *Validation:* confirmed in-code — `prd new` writes `${prdSlug(container)}.md` (`prd.js:197`) and `listPrds` sets `slug` from the basename via `PRD_FILE_RE` (`prd.js:39,56,60`); `path` resolves with the identical expression (`prd.js:168`). No action needed before building.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] `faff prd validate` with no positional exits 0 with `OK — N PRD(s) in <dir> valid` (and `(strict: born-verifiable)` suffix under `--strict`), byte-for-byte identical to the pre-change output.
- [ ] `faff prd validate` with no positional exits 1 and prints the same `FAIL  <file>: <problem>` lines as before when the tree has problems.

### From WHAT (interface)
- [ ] `prdValidate(dir, { only })` filters `listPrds(dir)` to `p.slug === only`; `only` null/absent leaves behaviour unchanged.
- [ ] `PRD_SURFACE`/`PRD_SPEC` are unchanged; `test/scaffolder-cli-surface-drift.test.mjs` stays green.

### From HOW (behaviour)
- [ ] `faff prd validate <container>` on a valid PRD exits 0 with a message naming that PRD (`OK — PRD <slug> valid`), printing no other PRD's status.
- [ ] `faff prd validate <container>` on an invalid PRD exits 1 with FAIL lines for that PRD only.
- [ ] `faff prd validate <unknown-container>` exits 2 with stderr `faff prd validate: no PRD found for <container>`.
- [ ] `faff prd validate <container> --strict` applies the born-verifiable form-check to that one PRD (exit 1 on loose prose, exit 0 when born-verifiable).

### From HOW (edge cases)
- [ ] A `Frozen` single target with loose prose fails (exit 1) without `--strict` (reused freeze precondition).

### Tests
- [ ] `prdSelftest` (`prd.js --selftest`) gains `t(...)` cases proving the `only` filter isolates one PRD's problems from a multi-PRD `dir` (a valid target → no problems; an invalid sibling → not reported when filtered to the valid target).
- [ ] `test/prd.test.mjs` gains real-binary cases for: single valid (exit 0, names the PRD), single invalid (exit 1, only that PRD), unknown container (exit 2, stderr message), single `--strict`, and a regression assertion that no-positional output is unchanged.

**Integration smoke test:**

```
1. tmpRepo with docs/prd/{alpha.md (valid), beta.md (missing Status)}
2. run(["validate", "alpha", "--root", root])  => status 0, stdout names alpha, no "beta" in output
3. run(["validate", "beta",  "--root", root])  => status 1, stdout FAIL mentions beta
4. run(["validate", "ghost", "--root", root])  => status 2, stderr "no PRD found for ghost"
5. run(["validate", "--root", root])           => status 1 (whole-dir still catches beta) — unchanged
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
