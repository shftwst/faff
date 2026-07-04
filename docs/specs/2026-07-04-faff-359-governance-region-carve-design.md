# FAFF-359 — Carve the logical governance/ boundary (layer-1 extraction, phase 1)

> Spec: faffter-dark-nlspec · 2026-07-04 · interactive · confidence: high. Full spec on Linear FAFF-359.

This spec defines phase 1 of the extraction topology: a **logical** governance boundary inside the faff CLI — region-tagged, direction-linted, standalone-selftestable — with **no repo split, no package, no naming**. Audience: the build agent and reviewers. Grounded in a full CLI-internals exploration (function-level dependency map of `plugin/skills/faff/bin/faff`, 12,117 lines).

## 1. WHY — Problem and principles

**The load-bearing model: the governance layer's extractability must become a *provable property*, not an architecture diagram.** The audit/governance subcommands (the flight recorder + interlocks) are faff's differentiator, but today they live in one flat 12k-line namespace where helpers are defined in whichever section first needed them — `latestRunDir`/`readLedger` live inside the *runcheck* section yet are consumed by factory code (`resolveAppetite` at line 337, `state` at 4394), and `schemaCheck` lives inside the *contract* section yet is called by `run-done` (2818) and `prdr` (10345+). Nothing states, let alone enforces, which code could leave the repo tomorrow. Phase 1 makes the boundary real-but-logical: ~80% of the architectural proof at ~5% of the repo-split cost, gated correctly on a future second consumer.

**Design principles:**

- **Tag in place, don't mass-reorder.** The boundary is semantic (region tags + a lint), not positional — a 12k-line file reshuffle would be an unreviewable diff for zero semantic gain. Only genuinely mis-homed helpers move (a few dozen lines), not sections.
- **One membership list, many consumers.** The region map is declared once and drives both the lint and the selftest runner — never two lists that can drift (the run-dir-format lesson).
- **No behaviour change, no persisted-format change.** Phase 1 is reorganisation + enforcement + proof. Golden tests and on-disk schemas stay byte-compatible.

**Reference context:**

| Surface | Relevance |
|---|---|
| `plugin/skills/faff/bin/faff` (12,117 lines, flat CommonJS, `// ===` section banners, `COMMANDS` registry at 12058–12103) | The file being carved |
| `.github/workflows/validate.yml` | Gains the direction-lint + region-selftest steps |
| `docs/guide/cli.md` | `lint-cli-doc` asserts bijection with `COMMANDS` — any new subcommand must be documented same-PR |
| `test/*.test.mjs` + `test/golden/contracts` | The byte-compat backstop |

**Scope statement:** sequence step 2 of `design/extraction-topology.md` — after the merge-gate ticket (which will land *into* this region later), before the second-consumer demo and any repo split.

## 2. OUT OF SCOPE

- **Repo split / package publishing / naming the extracted project** — gated on the second-consumer demo. Extension point: the region map *is* the future package manifest.
- **Persisted-format renames** (ledger `admitted`/`outcomes`, events `issue` field + `issue-admitted`/`issue-outcome` type strings, effects `issue` field, sentry-abort records) — breaking changes deferred to physical extraction behind a schema version bump. Extension point: the vocabulary glossary (§3) documents the mapping now.
- **CLI flag renames** (`events read --issue`, `effects --issue`, `audit --issue`, `sentry abort --issue`) — compat-managed at extraction, not phase 1.
- **prepcheck gate consolidation** — prepcheck (factory) *copies* runcheck's ownership/liveness gate (1325–1533) rather than sharing it; deduplication is a worthwhile follow-up but expands this diff for no boundary value. Extension point: a later chore ticket.
- **merge-gate** — a separate ticket; it lands into the governance region once built (membership row reserved).
- **`.mjs` module split / build step** — the single dependency-free file is a shipping constraint that survives phase 1.

## 3. WHAT — Vocabulary, the region model, membership

**Vocabulary:** *region* — a named subset of the CLI's sections, machine-tagged; *shared-infra* — code both regions may use and which may use neither; *direction invariant* — governance never references factory identifiers; *unit* — the governance core's name for the thing a run admits and resolves (an issue id, in faff's factory dialect).

**The three-tier region model.** Exploration killed the naive two-way split: shared helpers are consumed by both sides, so a clean cut requires a third tier.

```
shared-infra  →  imports nothing from either region
governance    →  may import shared-infra ONLY
factory       →  may import shared-infra AND governance (the consumer relationship)
dispatch shell →  COMMANDS registry + USAGE + main(): exempt (references everything by design)
```

**Chosen:** the direction invariant is `governance → factory = forbidden` and `shared-infra → {governance, factory} = forbidden`; factory→governance stays legal (that is exactly the future package-consumer relationship). Rationale: this is the minimal invariant that makes physical extraction a mechanical move later, and it matches how the code already mostly flows.

**Membership (the region map, declared once in-code):**

| Region | Commands | Key internals |
|---|---|---|
| governance | `runcheck`, `heartbeat`, `events`, `effects`, `budget`, `sentry`, `audit` (+ merge-gate when it lands) | ownership/liveness gate, `resolveRunDir`, `TERMINAL_STATES`, `EVENT_TYPES`, `computeEscapes`, sentry predicates, `buildReconstruction`, contract *engine* (`validateAgainstSchema`, `schemaCheck`, `exitFor`) |
| factory | everything else (`config`, `next`, `state`, `eligible`, `contain`, intake, labels, adr/prd/prdr, dod/admissible/holdout, gates, profile, fixtures, env, lights-out, prepcheck, run-done, lints, doctor/sync, worktree-prune, `contract` command + the 14 contract *definitions* + `CONTRACTS` map) | `loadConfig`/`DEFAULTS`/`resolveAppetite` stay factory (appetite/L4 semantics are factory-flavoured) |
| shared-infra | — | `findRoot`, `parseYamlSubset`, `dig`, `readLedger`, `latestRunDir`, `auditLedger` |

**Chosen:** `sentry` joins the governance region (the jot listed it as open). Rationale: exploration shows it is generic over the run-dir surface — its inputs are the governance-persisted schemas (events/ledger/heartbeat) plus a `budget check` self-spawn; its event-type vocabulary is pinned to schemas governance already owns. Supervision over the recorder is layer-1 by nature.

**Chosen:** the contract **engine** is governance; the 14 `contractX` **definitions**, the `CONTRACTS` fixtures map, and the `cmdContract` dispatch stay factory. Rationale: the engine + fail-direction coercion pattern is the extractable idea; the definitions encode faff-the-factory's domain. The factory's `contract` command calling the governance engine is a legal factory→governance edge. Schemas continue to load from `contracts/*.schema.json` relative to the binary — unchanged.

**Chosen:** governance resolves its own config keys (`budget:*`, `sentry.*`) via shared-infra `parseYamlSubset` + `dig` directly — a thin `readGovernanceConfig` — instead of the factory's `loadConfig`/`DEFAULTS`/`resolveAppetite`. Rationale: `resolveAppetite` embeds appetite/L4 ledger logic (factory semantics); routing governance config reads through it is the one existing governance→factory edge, and this severs it. Behaviour is unchanged (same keys, same defaults, applied locally).

**Chosen:** vocabulary is pinned by **glossary + internal naming, not disk formats**: new/renamed *internal* identifiers and all governance-region doc-strings say **unit**; every persisted schema keeps its `issue` field names, each documented in-code as "`issue` — the unit key (compat dialect; rename deferred to extraction schema-v2)". Rationale: exploration proved the jot's "pin once, now" collides with reality — `issue` appears in **persisted** formats (events/effects/ledger records, event-type strings) whose consumers include hooks, wtf, and external readers; renaming now is a migration, not a carve. Pinning the glossary now still prevents a third dialect from emerging. *(This deliberately narrows the jot ticket's "governance core speaks unit" — evidence-driven, called out for the reviewer.)*

## 4. HOW — Behaviour

**Region tagging.** Each existing `// ===` section banner gains a machine-readable region tag (e.g. `// === region:governance — runcheck ===`). Sections keep their positions; only mis-homed helpers physically move:

- `latestRunDir`, `readLedger`, `auditLedger` (887–927) and `findRoot` (34–46) → the new shared-infra section (top of file, after requires).
- `validateAgainstSchema`, `schemaCheck`, `exitFor` (5131–5225, 6303) → governance-tagged engine block, out of the contract-definitions section.
- `TERMINAL_STATES` (885) → governance (events already reuses it at 8438; factory references to it become legal factory→governance edges).

**The `regions` subcommand (one registry entry).**

```
faff regions check              # the direction lint: exit 0 clean / 1 violation(s) / 2 malformed tags
faff regions selftest [--region governance|factory|all]   # spawn the per-command selftests for a region
faff regions list [--json]      # print the region map (the single declared source)
```

- **The region map is one in-code constant** (command name → region + the tagged-section index derived from banners); `regions check`, `regions selftest`, and any future consumer read it — never a second list. Membership of a *command* implies membership of its section's internals.
- **Lint algorithm (`regions check`):** parse the file's banners into (region, line-range) spans; collect top-level `function` declarations + top-level `const` identifiers per span; scan governance spans for references to factory-span identifiers (word-boundary match against the collected factory identifier set), and shared-infra spans for references to either region's identifiers. Violations name `identifier, from-line (governance section), defined-at (factory section)`. The dispatch shell (USAGE, `COMMANDS`, `main`) is an exempt span. Self-spawns via `__filename` + argv (sentry→budget, hooks-ensure→prepcheck/runcheck, lights-out probes) are invisible to the lint by design — they are process boundaries, the exact shape extraction preserves.
- **Known accepted looseness:** identifier-occurrence matching can false-positive on collisions in strings/comments; the lint strips string literals and comments before matching, and any residual false positive is fixed by renaming toward clarity — never by a suppression mechanism (no `// lint-ignore` escape hatch; an escape hatch on a boundary lint is the boundary leaking).
- **`regions selftest`** reuses the lights-out probe pattern (spawn `<self> <cmd> --selftest` per member) and reports a per-command pass/fail table. `--region governance` green is the standalone-boundary proof.

**CI wiring:** two new `validate.yml` steps — `faff regions check` and `faff regions selftest --region governance` — plus the `regions` row in `docs/guide/cli.md` (the `lint-cli-doc` bijection makes this same-PR mandatory, per its own selftest).

**Edge cases / error handling:**

- A section with no region tag → `regions check` exit 2 naming the untagged banner (fail-loud; every section must declare, including `region:factory` for the bulk).
- `regions selftest` on a member whose selftest is absent → reported as `no-selftest`, non-fatal for factory, **fatal for governance** (a governance member without a selftest breaks the provable-boundary claim).
- The `COMMANDS`-registry bijection (`lint-cli-doc`) is untouched — `regions` is one new key, documented same-PR.

**Failure modes:**

- **The failure:** the lint passes while a real dependency hides in a self-spawn or a disk/env coupling. **How you'd know:** physical extraction later fails despite green lint. **What it means:** acceptable for phase 1 — process/disk/env seams are exactly what extraction preserves; the lint's claim is scoped to *in-file identifier references* and documented as such.
- **The failure:** tag drift — a new section lands untagged or mis-tagged. **How you'd know:** exit-2 fail-loud on untagged; mis-tagging is caught at review via the `regions list` diff. **What it means:** the map is small and visible; no further mechanism warranted in phase 1.

## Scenarios

```
Given the region-tagged CLI
When `faff regions check` runs in CI
Then it exits 0, and injecting a call from a governance-span function to a
     factory-span identifier (selftest fixture) makes it exit 1 naming both ends
```

```
Given the region map
When `faff regions selftest --region governance` runs with no factory context
Then all seven governance members' selftests execute and pass, reported per-command
```

Assertions: golden contract tests and all existing selftests pass unchanged (byte-compatible persisted formats); `lint-cli-doc` exits 0 with the `regions` row added; `budget`/`sentry` config reads produce identical results to pre-carve for identical `.faffrc` inputs.

## 6. DESIGN DECISION RATIONALE

- **Why three tiers, not two?** The explored dependency map shows both regions consuming common helpers; without shared-infra, either the lint is unenforceable or helpers get duplicated. **Chosen:** three tiers + dispatch-shell exemption.
- **Why tag-in-place?** A mass reorder is an unreviewable diff and git-move-opaque; tags give the lint everything it needs. **Chosen:** tags + minimal hoists (~150 lines moved total).
- **Why is factory→governance legal?** That *is* the extraction shape: the factory will import the package. Forbidding it would demand duplicating governance helpers into factory — the anti-goal. **Chosen:** one-way ban only.
- **Why defer the unit rename for persisted formats?** Disk formats are consumed by hooks, wtf, sentry, audit, and potentially external readers; a rename is a versioned migration, which is extraction-scale work, not carve-scale. **Chosen:** glossary now, schema-v2 later.
- **Why a `regions` subcommand rather than a bare CI script?** The membership list must be single-sourced and runtime-readable (the future package manifest); a script would be a second list. **Chosen:** one subcommand, three verbs, one map.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — all decisions closed above.

**Assumptions:**
- **Assumes:** the single-file, dependency-free, no-build-step constraint stands for phase 1 — validated: no `package.json` build pipeline exists at repo root; the binary is symlinked directly by `scripts/link-skills.sh`.
- **Assumes:** the merge-gate ticket lands independently and joins the governance region afterwards (a reserved membership row, not a blocker — this carve does not wait for it).

## 8. DONE — Definition of Done

### From WHAT (the region model)
- [ ] Every `// ===` section banner carries a region tag; `faff regions list --json` prints the single in-code map (7 governance commands + shared-infra + factory).
- [ ] The four mis-homed helper groups are moved (shared-infra section created; contract engine split from definitions; `TERMINAL_STATES` governance-tagged); no other sections relocated.
- [ ] Governance config reads route through the thin shared-infra path (`parseYamlSubset` + `dig`), not `loadConfig`/`resolveAppetite`; identical resolution results for identical inputs (covered by existing budget/sentry selftests).

### From HOW (enforcement + proof)
- [ ] `faff regions check` exits 0 on the carved file; its selftest table includes an injected governance→factory violation fixture (exit 1, both ends named) and an untagged-section fixture (exit 2).
- [ ] `faff regions selftest --region governance` passes standalone; a governance member without a selftest is a fatal finding (none exist at ship).
- [ ] `validate.yml` gains both steps; `docs/guide/cli.md` gains the `regions` row; `faff lint-cli-doc` exits 0.
- [ ] All existing selftests + `node --test` (incl. golden contract fixtures) pass unchanged — zero persisted-format or behaviour drift.
- [ ] Governance-region doc-strings use the unit glossary; each persisted `issue` field carries the compat-dialect note.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
