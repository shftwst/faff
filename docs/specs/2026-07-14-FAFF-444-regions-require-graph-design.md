# FAFF-444 — Retire the regions text-lint in favour of require-graph enforcement (post bin/faff modularisation)

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-444.

This spec turns Linear issue FAFF-444 into a buildable unit for a later autonomous build. Audience: the build agent and human reviewers. It replaces the `regions check` banner-tagged identifier lint with structural enforcement over the CLI's real `require()` graph, reshapes (not retires) the `regions` surface, and lands the deferred ADR 0042 status flip. FAFF-441 (the module split) is merged; this is prep-only tonight.

## 1. WHY

**Load-bearing model.** Since FAFF-441, region membership is file-granular: each of the 44 modules under `plugin/skills/faff/bin/lib/` carries exactly one region banner, and every cross-region reference is necessarily a CommonJS `require("./…")` edge — there are no cross-file globals. So the ADR 0042 direction invariant (governance ↛ factory; shared-infra ↛ either region) can be asserted directly on the file→region map plus the require edges, instead of re-deriving it from stripped-source identifier scanning inside banner spans.

**Problem statement.** `regions check` still runs the pre-split text lint (parse banners → collect top-level defs → scan spans for forbidden identifiers) across the union of entrypoint + `bin/lib/*.js` — ~300 lines of bespoke machinery whose job the module system now does for free. ADR 0042 itself predicted this: "if the file is ever modularised, the lint retires in favour of real module imports." This change makes the guard structural, deletes the dead machinery, and closes ADR 0042's deferred status flip.

**Design principles.**

- **Fail-closed where the invariant binds.** Anything that would make an edge unattributable in a governance or shared-infra file (missing banner, mixed-region banners, non-literal require, unresolvable relative require) is malformed (exit 2), never silently skipped. Factory and shell stay exempt consumers.
- **No suppression mechanism** — carried over from the text lint unchanged. An escape hatch on a boundary lint is the boundary leaking.
- **Net deletion.** The graph walk is small; the span/def/identifier scan goes. Reuse what survives (`regionsStripSource`, `REGION_TAG_RE`, `regionSources`, the drift checks) rather than writing parallel variants.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/regions.js` (734 lines) | The subcommand being reshaped; text-lint core `:193–428`, check `:700–722`, selftest `:443–600`, spawner `:641–682` |
| `plugin/skills/faff/bin/faff` | Wiring `:70` + `:202`; USAGE regions entry `:137` (describes the text lint — must be rewritten) |
| `.github/workflows/validate.yml` (~`:172–179`) | Three regions steps to update |
| `scripts/verify-split-parity.mjs` (`:103–104`) | Regions parity rows; `coverageCheck` requires every help subcommand in MATRIX or EXCLUSIONS |
| `docs/guide/cli.md:88` | The regions row; `lint-cli-doc` checks key presence bidirectionally, row text is unchecked but must not go stale |
| `docs/adr/0042-*.md`, `docs/adr/0052-*.md` | Both `Status: Proposed`; 0052's Consequences defer 0042's flip to this ticket |

**Scope statement.** One subcommand's enforcement core plus the CI/doc/ADR surfaces that name it; no other module changes.

## 2. OUT OF SCOPE

- **Command↔module region-coherence assert** (REGION_MAP's command region vs its handler file's banner region) — command→file mapping isn't mechanically derivable today. Extension point: an extra step in the new `regions check` after the file→region map is built.
- **Physical extraction of governance as a package** (ADR 0042 phase 2) — the file→region map this builds is the manifest seed; extension point: `regions list --json`.
- **Deleting `scripts/verify-split-parity.mjs`** — it is a spent one-time migration gate, but retiring the whole harness is separate housekeeping; this ticket only fixes its regions rows.
- **A `test/regions.test.mjs` node-test file** — the house pattern for lint-like subcommands is the embedded `--selftest` fixture table (as in `lint-refs.js`, `lint-cli-doc.js`); kept, not augmented.
- **Redesign of `regions list` output or banner prose conventions** — banners stay as-is (they now carry region attribution).

## 3. WHAT

**Vocabulary.**

| Term | Definition |
|---|---|
| Region banner | A line matching `REGION_TAG_RE` (`// === region:<name> — … ===`), regions.js`:173` |
| Bound region | `governance` or `shared-infra` — the regions the direction invariant constrains |
| Require edge | A resolved relative `require("./x")` from one scanned file to another |
| Source set | `regionSources()` — entrypoint + `bin/lib/*.js` sorted (regions.js`:33–36`, kept) |

**Types.**

```
RECORD FileRegion:
  file: path                          # member of the source set
  region: governance | factory | shared-infra | shell
                                      # from the file's own banner(s); exactly one
                                      # distinct region per file, else malformed

RECORD RequireEdge:
  from: FileRegion
  to:   FileRegion                    # "./name" resolved to a sibling in the source set
  line: int                           # 1-indexed require line, for the violation message

INVARIANT direction (ADR 0042):
  from.region == governance   ⇒ to.region ∈ { governance, shared-infra }
  from.region == shared-infra ⇒ from has NO require edges (node builtins only)
  from.region ∈ { factory, shell } ⇒ unchecked (legal consumers)
```

**Surface.** `regions <list|check|selftest>` signature is unchanged. `list` and `selftest` (the child-process spawner, `:641–682`, with stale-null detection `:611–629`) are kept verbatim — they are orthogonal to the direction lint. `check` swaps its core; `--selftest` swaps its fixture table (drift checks kept). `REGION_MAP` and `REGION_SELFTEST_ARGV` are unchanged in content; the `REGION_MAP ↔ COMMANDS` bijection assert stays in both `check` and `--selftest`. Exit codes stay 0 clean / 1 violation / 2 malformed.

**Deletions.** `regionsParseSpans` span machinery, `regionsCollectDefs`, the identifier-scan half of `regionsCheckFiles`, `regionsCheckFile`, `REQUIRE_PRELUDE`, and their fixtures. `regionsStripSource` (needed so a commented/quoted `require("./x")` is not a false edge), `REGION_TAG_RE`, `REGION_NAMES`, `regionsStaleNulls`, `regionsFnRange`, `regionsSelftestRun` are kept. Trim `module.exports` (regions.js tail) to what survives — verified: nothing outside `regions.js` imports any of these except `bin/faff`'s `cmdRegions`.

## 4. HOW

The new check builds the file→region map from banners, extracts require edges from stripped source, and asserts the invariant on the edges.

```
PROCEDURE regionsCheck(COMMANDS):
  1. files = regionSources()
  2. FOR each file:                                   # build FileRegion map
     a. tags = lines matching REGION_TAG_RE
     b. no tag                        → malformed (file has no region banner)
     c. tags name >1 DISTINCT region  → malformed (ambiguous file attribution)
        # economics.js's two factory banners and the entrypoint's two shell
        # banners are legal — same region repeated
     d. region name ∉ REGION_NAMES    → malformed
  3. FOR each file whose region is BOUND (governance | shared-infra):
     a. stripped = regionsStripSource(source)         # comments/strings/regexes blanked
     b. FOR each `require(` occurrence in stripped lines:
        - argument not a single string literal        → malformed (unattributable edge)
        - literal is node:* / bare-package             → skip (outside the region model)
        - literal starts with "."                      → resolve against the file's dir:
            · resolves to a source-set member          → record RequireEdge
            · does not                                 → malformed (edge escapes the set)
  4. violations = edges where
       from.region == governance AND to.region == factory,
       OR from.region == shared-infra AND to is any local module
     # each names: from-file (region), require target (region), line number
  5. REGION_MAP ↔ COMMANDS bijection (kept verbatim from :706–714)
  6. exit: any malformed → 2 (each on stderr, MALFORMED prefix)
           else any violations → 1 (each on stderr, VIOLATION prefix, + summary line)
           else → 0 with a PASS line naming the graph-based invariant
```

**Behaviour summary for `--selftest`:** same shape as today (synthetic files in a tmp dir, per-case ok/FAIL report, RESULT line) but each fixture is now a small *module set* (two or three files with banners and require lines) driven through the graph core. Required fixture behaviours: clean set → 0; governance→factory require → 1 naming both ends + line; shared-infra→local require → 1; bannerless file → 2; mixed-region banners in one file → 2; non-literal require in a bound file → 2; unresolvable relative require in a bound file → 2; `require("./x")` inside a comment or string → 0; factory→governance require → 0 (legal). The four drift checks (`:569–597`: bijection, allowlist-covers-map, every-governance-member-has-a-selftest, stale-null detector) are kept as-is.

**Edge cases.**

- The entrypoint's export tail (`module.exports = { correctiveIntegrityProbe, … }`, bin/faff tail) needs no special handling — the entrypoint is shell, exempt; the old defs-scan concern disappears with the defs scan.
- Factory→governance edges exist today and stay legal: `quality.js→budget`, `merge-gate.js→effects`, `contract-defs.js→contract-engine`, `run-done.js→contract-engine`, `config.js→runcheck`, and others — none may be flagged.
- `contract-engine.js` is governance but not a COMMANDS key — the file map is banner-derived, so internal modules are covered without touching REGION_MAP.
- `effects.js` trips GNU grep's binary detection (needs `grep -a`); irrelevant to `fs.readFileSync(utf8)` but worth knowing when verifying with shell tools.

**Surfaces updated with the code (same PR — docs never go stale):**

- `bin/faff:137` USAGE entry and the regions.js file-top banner comment: rewritten to describe graph enforcement (forward-stated, no lint archaeology).
- `docs/guide/cli.md:88`: row text rewritten — `check` walks the require graph of the entrypoint + `bin/lib` modules against each file's region banner; exit codes and no-suppression stance restated; `list`/`selftest` prose unchanged.
- `.github/workflows/validate.yml` (~`:172–179`): the three steps keep the same three commands (`regions --selftest`, `regions check`, `regions selftest --region governance`); step names updated to describe the graph enforcement (they currently cite FAFF-359).
- `scripts/verify-split-parity.mjs`: delete MATRIX rows `:103–104`; add a `regions` entry to `EXCLUSIONS` (`:128`) stating parity vs the pre-split baseline is definitionally broken for this surface — required because `coverageCheck` (help→matrix direction) would otherwise exit 2.
- ADR 0042 `Status:` line: `Proposed` → `Accepted` (value-only edit, body untouched). No edit to ADR 0052.

**Failure modes.**

- **The structural check is weaker than the text lint in a corner.** In-file cross-region references become unobservable — closed by the one-distinct-region-per-file malformed rule (a mixed file can't exist). How you'd know: the mixed-banner fixture fails if the rule regresses.
- **Non-require escapes.** Self-spawns (`<self> <cmd> …`) were always invisible to the lint by design (process boundaries); dynamic `require(expr)` in a bound file is malformed, not missed. A dynamic require in a *factory* file is unchecked — same posture as today's exempt factory spans.
- **Silent coverage loss on layout change.** A nested `bin/lib/sub/` governance file would fall outside `regionSources()` and go unchecked. A bound file requiring *into* such a path is malformed (edge escapes the set), which surfaces the layout drift; ADR 0052 pins the flat layout. Accepted residual — same property the text lint had.

**Anti-pattern:** re-deriving edges with a naive un-stripped regex. Why: regions.js's own comments and the selftest's fixture strings contain require-shaped text; the stripper exists and is fixture-tested.

**Anti-pattern:** keeping the identifier-scan machinery "just in case" alongside the graph walk. Why: two enforcement cores drift; the module system is now the single source of cross-file reference truth.

## 5. SCENARIOS

```
Given the shipped module set on main
When  `faff regions check` runs
Then  exit 0 with a PASS line naming the require-graph direction invariant

Given budget.js (governance) gains `const { qualityReport } = require("./quality")`
When  `faff regions check` runs
Then  exit 1, the violation naming budget.js (governance), quality.js (factory), and the require line

Given shared-infra.js gains `require("./budget")`
When  `faff regions check` runs
Then  exit 1 (shared-infra must have no local require edges)

Given a bin/lib module whose region banner is deleted (or a second, different-region banner added)
When  `faff regions check` runs
Then  exit 2 MALFORMED naming the file

Given quality.js (factory) requiring ./budget (governance) — the legal direction
When  `faff regions check` runs
Then  exit 0 (factory→governance edges never flagged)
```

Non-functional: net line count of `regions.js` decreases; `regions list` and `regions selftest --region governance` output is byte-identical to today; no new package dependency.

## 6. DESIGN DECISION RATIONALE

**Retire or reshape the `regions` surface?** Retiring wholesale loses `list` (the map printout / future manifest) and `selftest` (the spawner CI depends on), both orthogonal to the text lint. **Chosen:** reshape — keep `regions <list|check|selftest>` with `check`'s core and `--selftest`'s fixtures swapped; minimal CI/doc churn, REGION_MAP keeps driving list/selftest/bijection.

**Where does file→region attribution come from?** A new static FILE_REGION_MAP would be a second list to drift against the banners. **Chosen:** derive from each file's own region banner — banners already exist on all 44 modules + entrypoint (verified), are self-describing, and the >1-distinct-region malformed rule keeps attribution unambiguous.

**How are require edges extracted?** A real AST parser (acorn/esprima) adds the CLI's first dependency for a job a regex over stripped source does; the repo has no AST utility today. **Chosen:** `regionsStripSource` + a string-literal `require("…")` scan, fail-closed (non-literal or unresolvable relative require in a bound file is malformed). No new dependency.

**Where does test coverage live?** A separate `test/regions.test.mjs` would break the house lint-subcommand pattern (pure core + embedded fixture table, per `lint-refs.js`/`lint-cli-doc.js`), and `regions --selftest` already runs in CI. **Chosen:** the embedded fixture table, re-pointed at the graph core; the four drift checks kept.

**What happens to the parity-matrix rows?** Keeping rows that diff against the pre-split baseline is definitionally broken once `--selftest` output changes; deleting them alone fails `coverageCheck`. **Chosen:** remove MATRIX rows `:103–104` and add `regions` to `EXCLUSIONS` with the reason.

**What does ADR 0042 flip to?** `Superseded by ADR-0052` would drop 0042 from live-decisions, but 0052 explicitly leans on 0042 as the live region-model decision — only the single-file mechanism was superseded-in-part, which 0052's prose already records. **Chosen:** flip 0042 to `Accepted` (a valid `ADR_STATUSES` value; `faff adr validate` must stay green); no new ADR — 0042's own text predicted this retirement and 0052 records the modularisation.

**How much of the old machinery survives?** **Chosen:** delete the span/def/identifier scan and its fixtures; keep the stripper, tag regex, `regionSources`, spawner, stale-null detector, and drift checks; trim `module.exports` to the survivors (no external consumers exist — verified by grep across the repo).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — all decisions closed above.

**Assumptions:** none external. FAFF-441's merge, the per-file banners, the absence of governance→factory edges today, the absence of external consumers of regions.js internals, and the parity script being non-CI-wired were all verified directly against the working tree at spec time; the build agent should re-run `faff regions check` and `node --test` on its branch base before starting, as usual.

## 8. DONE

### From WHY
- [ ] `regions check` enforces the ADR-0042 direction invariant from the require graph; the span/def/identifier-scan machinery is deleted (net line reduction in regions.js)

### From WHAT
- [ ] `regions <list|check|selftest>` signature unchanged; `list` and `selftest` spawner output byte-identical to today
- [ ] Exit codes preserved: 0 clean / 1 violation / 2 malformed; no suppression mechanism exists
- [ ] `REGION_MAP ↔ COMMANDS` bijection still asserted in both `check` and `--selftest`
- [ ] `module.exports` trimmed to surviving functions; `node plugin/skills/faff/bin/faff regions check` passes on the branch

### From HOW (behaviour)
- [ ] Bannerless file, mixed-region banners, unknown region, non-literal require (bound file), and unresolvable relative require (bound file) each → exit 2 with a MALFORMED line naming the file
- [ ] A governance→factory require and any shared-infra local require each → exit 1 naming from-file, target, both regions, and the require line
- [ ] Factory→governance and shell edges are never flagged; node:*/bare-package requires ignored
- [ ] `require("./x")` inside comments/strings produces no edge (stripper-backed)

### From HOW (surfaces)
- [ ] `regions --selftest` fixture table covers all nine behaviours listed in §4 plus the four kept drift checks, and passes
- [ ] validate.yml's three regions steps updated (same commands, forward-stated names) and green on the PR head
- [ ] verify-split-parity.mjs: regions MATRIX rows removed, `regions` EXCLUSIONS entry added, its own selftest path still passes
- [ ] docs/guide/cli.md regions row rewritten to match the new `check` semantics; `faff lint-cli-doc` passes
- [ ] bin/faff USAGE `:137` entry and the regions.js top banner comment rewritten forward
- [ ] ADR 0042 `Status:` is `Accepted`; ADR 0052 untouched; `faff adr validate` passes

**Integration smoke test:**

```
1. node plugin/skills/faff/bin/faff regions check          → exit 0, PASS line
2. Append `require("./quality");` to bin/lib/budget.js
3. node plugin/skills/faff/bin/faff regions check          → exit 1, names budget.js→quality.js
4. Revert; node plugin/skills/faff/bin/faff regions --selftest → RESULT: PASS
```

confidence: high

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4):** yes — a 1–2 day unit: one subcommand's core swapped (net deletion), plus five small named surface touches (CI step names, parity rows, cli.md row, USAGE text, one ADR status value). Single concern; no split or merge candidate.
- **Workstream fit (principles 1, 5):** clean — a follow-up deliberately carved out of FAFF-441 to keep that PR pure-move; it completes the region-model outcome (a trustworthy, structurally enforced governance boundary) rather than opening a new theme.
- **Deps surfaced (principle 6):** honest — the one load-bearing dep (FAFF-441) is a drawn `blockedBy` edge and is Done/shipped; spec-time verification found no other consumers of the regions internals, so no hidden edges to draw.
- **Risk profile (principle 7):** low, no de-risking spike warranted — the direction invariant already holds structurally on main (zero governance→factory require edges verified), so the mechanism swap lands green; the real risk (a weaker guard) is addressed in-spec by fail-closed malformed rules and named residuals.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```

spec-review: approve
