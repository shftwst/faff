# Flag-level validation for the scaffolder drift-guard — `faff cli-surface --json` and retiring the usage-string probe

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-628.

> **Refreshed 2026-07-24** (autonomous, rebased onto main @ `0ccd321`): **no design change** — every decision, interface, and scenario below re-verified against the current tree. Since the prior draft, **FAFF-568** landed `faff events verify` / `faff events anchor` sub-verbs and `--run-dir` / `--legacy-policy` / `--dest` on `EVENTS_SPEC` in `plugin/skills/faff/bin/lib/events.js`. Folded as **context only**: `events.js` is one of the dispatch modules Layer 1 migrates, so its `EVENTS_SURFACE` must enumerate the *current* second-token set (now including `verify` / `anchor`) and its exported CommandSpec now carries the three added flags — both fall out of the "enumerate the tokens the dispatcher branches on today" / "derive accepted flags from the existing CommandSpec" procedure, not new work. The §5 / §8 `faff events read` examples remain valid: `--run` is still accepted and `--bogus` is still rejected under the grown `EVENTS_SPEC`. Substrate re-confirmed on `0ccd321`: the guard still carries the `runCli` / `verbSurface` / `_surfaceCache` usage-string probe (339 lines), no `cli-surface` command or `lib/cli-surface.js` exists yet, `COMMANDS` is still exported, `prd link: --url is required` still stands, and the `REGION_MAP` ↔ `COMMANDS` bijection + `REGION_SELFTEST_ARGV` self-tests are intact.

This spec is for the build agent implementing FAFF-628 and the humans reviewing it. It gives the faff CLI a **declared, machine-readable command grammar** — a `SURFACE` descriptor per subcommand-dispatch module, aggregated by a new `faff cli-surface --json` command — and rewrites the FAFF-538 scaffolder drift-guard to validate against that grammar with **pure set-membership checks**, extending coverage to the **flag layer** (unknown flags and missing required flags) and deleting the guard's fragile usage-string parsing entirely.

## 1. WHY — Problem and Principles

**The load-bearing model:** a declaration is only drift-proof if the CLI itself *runs on it*. Every surface fact the guard consumes must be the same artifact the live CLI dispatches, parses, or enforces with — verbs from the `COMMANDS` registry (already true), accepted flags from the `argv.js` CommandSpecs the parser already rejects against, subcommands from a declared set the dispatcher itself gates on, and required flags from a declaration a shared helper enforces at run time. A declaration the CLI ignores is the FAFF-538 anti-pattern in new clothes: the same drift moved one layer up.

**Problem statement:** the v1 guard (FAFF-538, merged as PR #464) validates verb + subcommand existence only, and derives subcommand vocabularies by regex-parsing each verb's bare-invocation usage string — a coupling its own spec names as the fragility that should graduate here. Meanwhile the flag layer is unguarded: a RUNBOOK invoking `prdr coverage` without a then-required `--prd-goals` (the FAFF-512 class), or supplying a flag a command no longer accepts, rots silently. And flag requiredness itself drifts — `prdr coverage` no longer requires `--prd-goals` at all — so only a declaration the CLI enforces from can keep the guard honest at the flag layer.

**Design principles:**

- **Declared and load-bearing, never decorative.** Each surface fact ships with the mechanism that makes the CLI depend on it: subcommand sets gate dispatch, required-flag sets are enforced by a shared post-parse helper, accepted-flag sets are the parser's own CommandSpecs. Reject any implementation that emits a surface entry nothing in the live CLI consumes.
- **Derive, never re-list** (inherited from FAFF-538). `cli-surface` aggregates existing exports; it hand-authors nothing per-verb except the one wiring map, whose completeness is mechanically self-tested (COMMANDS bijection, the `REGION_MAP` precedent).
- **Fail loud, never skip.** An unclassified verb, a missing surface entry, or an unparseable RUNBOOK gesture is a failure, not a skip — the FAFF-274 posture the v1 guard already holds.
- **The guard goes fully static.** After this change the drift-guard spawns **zero** CLI processes — every check is set-membership over imported registries. Delete the probe; do not quarantine it.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `test/scaffolder-cli-surface-drift.test.mjs` | Node ESM (`node:test`) | The v1 guard this rewrites: keeps its scaffolder iteration, here-doc extraction, config-key half, and finding format; loses `verbSurface()` + `runCli` entirely. |
| `plugin/skills/faff/bin/faff` (`COMMANDS`, exported) | CommonJS | Verb source of truth (FAFF-538 export). Gains the `cli-surface` entry. |
| `plugin/skills/faff/bin/lib/argv.js` (FAFF-576) | CommonJS | `parseArgs` + CommandSpec — the accepted-flag source of truth; gains nothing (requiredness lives beside it, not in it — see rationale). |
| `plugin/skills/faff/bin/lib/regions.js` (`REGION_MAP`) | CommonJS | The full-allowlist-with-bijection-selftest precedent the `SURFACES` map copies; also gains the new command's region + selftest entries. |
| The ~15 dispatch modules (`adr.js`, `prd.js`, `prdr.js`, `config.js`, `env.js`, `events.js`, `profile.js`, `gates.js`, `corrective.js`, `fixtures.js`, `governance-profile.js`, `sentry.js`, `sentry-poller.js`, `holdout`, …) | CommonJS | Each gains a `SURFACE` export + a dispatch membership gate; discovered by grepping for the `expected one of` / `usage:` enumeration emitters, not this list. (`events.js` grew `verify` / `anchor` sub-verbs in FAFF-568 — enumerate the live set at migration.) |
| `plugin/skills/faff/bin/lib/lint-cli-doc.js`, `docs/guide/cli.md` | CommonJS / Markdown | A new COMMANDS verb must be documented or CI fails (bidirectional lint). |

**Scope statement:** governance/test-infra hardening of the existing CI drift-guard plus one introspection subcommand on the established CLI entrypoint — no new runnable system, no deployment-shape change.

## Already shipped against this surface

Reader context, none superseding: **FAFF-538** (Done 2026-07-23, PR #464) shipped the v1 guard this extends and explicitly deferred the flag layer and the introspection command here (its §OUT-OF-SCOPE names FAFF-628 twice). **FAFF-576** shipped the CommandSpec parser this reads. **FAFF-512/513/524/529** are the manual repair passes that motivated the guard family. **FAFF-568** (Done, since the prior draft) added `events verify` / `events anchor` to `events.js` — a dispatch module Layer 1 migrates; it grows the set that module enumerates, it does not change the approach.

## 2. OUT OF SCOPE

- **Conditional / mode-dependent flag requiredness** (e.g. `merge-gate --local` requires `--issue --run-dir`; `--human-override` requires `--interactive`). — Only *unconditional* per-subcommand requiredness is declared and guarded. **Why:** conditional requiredness is a function of other supplied flags, not of the (verb, subcommand) pair; declaring it needs a constraint language nothing else consumes yet. Handlers keep those checks ad-hoc. **Extension point:** a `requires_with` field on the SURFACE subcommand record, enforced by the same `requireFlags` helper.
- **Per-subcommand accepted-flag partitioning.** — Accepted-flag membership is asserted against the verb's whole CommandSpec union, not per-subcommand. **Why:** the FAFF-576 specs are deliberately per-verb unions; splitting them per subcommand is a parser refactor with no motivating drift class (a flag accepted by a sibling subcommand still parses — it fails, if at all, in handler logic, which the guard cannot see statically). **Extension point:** per-subcommand `flags` sets on the SURFACE record, once the parser itself dispatches per-subcommand specs.
- **Flag-value validation** (enums, arity of values in RUNBOOK text). — The guard checks flag *names* only. **Why:** RUNBOOK lines carry placeholders (`--run <id>`), so value-level assertion false-positives; enum legality is the parser's runtime job. **Extension point:** the guard's per-line token walk, consulting `FlagSpec.enum` for literal (non-placeholder) values.
- **Deriving the `expected one of:` usage strings from the SURFACE declarations.** — Usage strings stay hand-written in v1. **Why:** several tests pin usage-string bytes; regenerating them from declarations churns every pin for zero guard value now that the guard no longer parses them. **Extension point:** a `usageLine(SURFACE)` helper in `cli-surface.js`, adopted module-by-module later.
- **Deep `.faffrc` grammar validation.** — Unchanged from FAFF-538's punt; the config-key half of the guard is untouched by this ticket.
- **The `authoring-and-admitting-a-prd.md` doc's fenced commands.** — Still out, per FAFF-538's punt; the rewritten command-validation half remains the reusable engine for it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| SURFACE descriptor | A per-verb declaration of its second-token grammar: dispatch kind, subcommand set, and per-subcommand unconditional required flags. Exported by the verb's own module. |
| dispatch kind | `subcommand_dispatch` (second token selects a handler branch), `positional` (second token is data, e.g. `audit <run-id>`), or `flat` (no meaningful second token, e.g. `heartbeat`, `doctor`). `positional` and `flat` are validated at verb level only — the distinction is documentation, both behave identically in the guard. |
| SURFACES map | The central verb → surface wiring in `lib/cli-surface.js`, in bijection with `COMMANDS` (self-tested). |
| accepted-flag set | The canonical flag names + aliases of the verb's CommandSpec(s) — the exact set `parseArgs` accepts for that verb. |
| command-block line | A 4-space-indented `faff …` line in a RUNBOOK here-doc — an executable gesture. Flag-layer assertions fire only here, never on inline-backtick spans. |

**Type definitions:**

```
RECORD SubcommandSurface:
  required_flags: List<String>     # canonical "--flag" names, unconditionally required; often empty

RECORD VerbSurface:
  kind: ENUM{ subcommand_dispatch, positional, flat }
  subcommands: Map<String, SubcommandSurface>   # non-empty iff kind == subcommand_dispatch
  spec: CommandSpec | List<CommandSpec> | null  # the module's existing argv spec(s) — accepted-flag source;
                                                # null iff the module has no FAFF-576 spec yet (flag checks skip)

CONSTRAINT keys(SURFACES) == keys(COMMANDS)     # bijection, self-tested (REGION_MAP precedent)
```

**Interfaces:**

```
# --- per dispatch module (new exports; spec objects already exist, now also exported) ---
<VERB>_SURFACE: VerbSurface                     # e.g. PRD_SURFACE in prd.js
requireFlags(values, surface, verb, sub) -> String | null   # shared helper in argv.js's sibling tier
  # null when every surface.required_flags member is present in parsed values;
  # else the error string the handler writes before returning 2.

# --- lib/cli-surface.js (new module) ---
SURFACES: Map<verb, VerbSurface>                # assembled from module exports + flat/positional entries
buildCliSurface(SURFACES) -> JSONObject         # PURE: {verb: {kind, subcommands: [...], flags: [...], required_flags: {sub: [...]}}}
cmdCliSurface(args, COMMANDS) -> exitCode       # --json emits buildCliSurface; --selftest runs bijection + pinned classifications; else usage exit 2
```

**Emitted JSON shape** (`faff cli-surface --json`) — a superset of the ticket's named shape:

```
{ "prd": { "kind": "subcommand_dispatch",
           "subcommands": ["path","new","link","list","validate"],
           "flags": ["--json","--root","--strict","--url", …],
           "required_flags": { "link": ["--url"] } },
  "audit": { "kind": "positional", "subcommands": [], "flags": […], "required_flags": {} },
  … }
```

**Design decisions** (full rationale in §6):

- Requiredness is declared per (verb, subcommand) in the module's SURFACE and enforced by the shared `requireFlags` helper — **Chosen:** declare-and-enforce-from-declaration; a declare-only field is rejected as decorative.
- Subcommand sets are made authoritative by a dispatch membership gate — **Chosen:** each migrated dispatcher rejects a second token not in its SURFACE before its existing branch chain.
- The guard imports the assembled surface — **Chosen:** ESM-import `lib/cli-surface.js` directly (the `config.js` precedent), not spawning `faff cli-surface --json`.
- Accepted flags come from the existing CommandSpecs, now exported — **Chosen:** union-level membership, aliases included.

## 4. HOW — Behavior

**Architecture and approach.** Three layers, built in this order: (1) per-module SURFACE exports + dispatch gates + `requireFlags` migration of existing unconditional checks; (2) `lib/cli-surface.js` assembling the SURFACES map, the pure `buildCliSurface`, the `cmdCliSurface` handler, and full CLI wiring (COMMANDS, usage text, `docs/guide/cli.md`, `REGION_MAP` + `REGION_SELFTEST_ARGV`, region `factory` like `lint-cli-doc`); (3) the guard rewrite — replace the probe with surface lookups, add the two flag-layer assertion classes, delete `verbSurface` and the `runCli` import.

**Layer 1 — per-module migration.** Discover the dispatch modules by grepping `bin/lib` for the `expected one of` emitters plus the `usage:`-form verbs (the FAFF-538 self-test's classification is the floor: `prd`/`prdr`/`adr`/`env`/`config`/`profile`/`holdout` dispatch; `audit`/`next`/`state` positional). For each dispatch module:

```
PROCEDURE migrate_module(mod):
  1. Declare <VERB>_SURFACE: subcommands := exactly the second tokens the dispatcher
     branches on today; required_flags := only flags the handler ALREADY enforces
     unconditionally post-parse (e.g. prd link → ["--url"]); else [].
  2. Gate dispatch: before the existing branch chain,
       IF sub NOT IN keys(SURFACE.subcommands): fall through to the existing
       "expected one of …" usage error (string unchanged, byte-for-byte).
  3. Replace each migrated unconditional ad-hoc check with
       err := requireFlags(values, SURFACE.subcommands[sub], verb, sub)
       IF err: stderr(err); return 2        # message text may change; exit code must not
  4. Export SURFACE (and the module's CommandSpec if not already exported).
```

**Behavior summary:** after migration, an implemented-but-undeclared subcommand is unreachable (its own tests go red immediately — the declaration is authoritative), and requiredness enforcement reads from the same list the guard reads.

**Anti-pattern:** declaring a `required_flags` entry for a check the handler does *not* enforce (or enforces conditionally). Why: the declaration would assert requiredness the CLI doesn't have — the guard would fail correct RUNBOOKs, and the declaration drifts from behaviour by construction. Declare only what `requireFlags` enforces.

**Layer 2 — `lib/cli-surface.js`.** The SURFACES map lists every `COMMANDS` key exactly once: dispatch verbs reference their module's exported SURFACE; every other verb gets a one-line `{kind: positional|flat, …}` entry with its exported spec. `cmdCliSurface`:

```
PROCEDURE cmdCliSurface(args, COMMANDS):
  parse via its own CommandSpec { "--json": arity 0, "--selftest": arity 0 }
  IF --selftest:
     a. assert sortedKeys(SURFACES) == sortedKeys(COMMANDS)      # bijection; drift → FAIL, exit 1
     b. assert pinned classifications: prd/prdr/adr/env/config/profile/holdout are
        subcommand_dispatch with a known member each (new∈prd, coverage∈prdr, up∈env,
        get∈config, show∈profile, verdicts∈holdout, new∈adr); audit/next/state positional
     c. assert every declared required_flags name ∈ that verb's accepted-flag set
     print PASS/FAIL table; exit 0/1
  IF --json: stdout(JSON.stringify(buildCliSurface(SURFACES))); exit 0
  ELSE: usage error, exit 2
```

**Layer 3 — the guard rewrite.** `parseEmbeddedFaffCommands` additionally captures, for command-block lines only, the ordered `--flag` tokens (split `--flag=value` on `=`; ignore tokens after a bare `--`). The assertion walk becomes:

```
PROCEDURE runbookFindings(body, source):           # fully static — no spawn
  FOR each cmd in parseEmbeddedFaffCommands(body, source):
    a. IF cmd.verb NOT IN keys(SURFACES): FAIL "not a live verb"; CONTINUE
    b. surface := SURFACES[cmd.verb]
    c. IF surface.kind == subcommand_dispatch AND cmd.subcommand != null
         AND cmd.subcommand NOT IN keys(surface.subcommands):
           FAIL "<sub> ∉ {declared set}"
    d. IF cmd is a command-block line:              # flag layer — executable gestures only
         FOR each f in cmd.flags:
           IF f NOT IN acceptedFlags(surface):      # canonical + aliases
              FAIL "<f> is not an accepted flag of faff <verb>"
         IF cmd.subcommand resolves to a declared subcommand:
           FOR each r in surface.subcommands[cmd.subcommand].required_flags:
              IF r NOT IN cmd.flags: FAIL "missing required flag <r>"
```

Delete `verbSurface`, `_surfaceCache`, the usage-format self-test, and the `runCli` import; replace with a surface self-test importing `SURFACES` and re-pinning the same classifications as `cli-surface --selftest` (cheap duplication of pins, not of parsing logic).

**Edge cases and error handling:**

- A RUNBOOK command-block line whose second token is a placeholder (`<run-id>`, `$VAR`, quoted) — unchanged v1 behaviour: `subcommand := null`, verb-level + flag-level checks still apply; required-flag checks don't fire (no resolved subcommand).
- Inline-backtick spans (`` `faff prdr coverage` ``) — verb + subcommand membership only; **no** flag-layer assertions (abbreviated mentions legitimately omit flags).
- A flag token on a line whose verb is unknown — the verb finding already fired; skip flag checks for that line (no cascading noise).
- A verb whose module has no FAFF-576 CommandSpec yet (not every handler is migrated) — its SURFACES entry declares `spec: null`, `buildCliSurface` emits `"flags": null`, and the guard **skips** flag-membership for that verb (an *unknown* accepted set is not an *empty* one — an empty-set assertion would false-red every flag the verb genuinely accepts). Verb/subcommand checks still apply. The `cli-surface --selftest` reports the null-spec count so the gap shrinks visibly as FAFF-576 migration completes.
- Dedup: extend the v1 `(verb, subcommand)` dedup key with the sorted flag list, so two invocations of the same command with different flags are each checked.
- `--flag=value` in a RUNBOOK — membership is checked on the name left of `=`.

**Failure modes:**

- **The failure:** the SURFACES wiring map silently omits a newly added verb. **How you'd know:** the bijection self-test (run in CI via `node --test` importing it, and via `regions selftest`'s spawn of `cli-surface --selftest`) fails the same PR that added the verb. **What it means:** add the one-line entry — the map is complete by mechanism, not memory.
- **The failure:** a declared subcommand was never actually implemented (declaration ⊃ dispatch), so the guard passes a RUNBOOK citing a dead subcommand. **How you'd know:** any live invocation hits the usage fallthrough; the pinned member assertions catch it for the load-bearing verbs. **What it means:** narrow residual risk, accepted — the dispatch gate makes the dangerous direction (dispatch ⊃ declaration) impossible, and this direction is self-announcing on first use.
- **The failure:** a scaffolder RUNBOOK legitimately shows a partial command (teaching prose in a command block) and the required-flag check false-positives. **How you'd know:** the guard reds on a correct scaffolder. **What it means:** the FAFF-538 precision bias governs — requiredness declarations are few and real (only migrated enforced checks), so fix by demoting the line to prose/backticks or dropping the declaration if it was wrong.

## 5. SCENARIOS

```
Given a scaffolder RUNBOOK command-block line `faff prdr coverage` and a PRDR_SURFACE
  declaring coverage.required_flags = ["--prd-goals"]
When the drift-guard runs under node --test
Then the check FAILS naming the missing required flag --prd-goals and the raw line
```

```
Given a RUNBOOK command-block line `faff events read --bogus-flag x`
When the drift-guard runs
Then the check FAILS reporting --bogus-flag is not an accepted flag of faff events
```

```
Given a RUNBOOK line citing `faff prd admit`
When the drift-guard runs
Then the check FAILS via pure set-membership against PRD_SURFACE (admit ∉ declared set),
  with zero CLI processes spawned by the whole test file
```

```
Given `faff prd link <container>` invoked live without --url
When the migrated handler runs
Then requireFlags produces the error and the command exits 2 —
  the same requiredness the guard asserts, from the same declaration
```

```
Given a new verb added to COMMANDS without a SURFACES entry
When cli-surface --selftest runs
Then it FAILS the bijection check naming the missing verb
```

- `faff cli-surface --json` MUST emit valid JSON whose keys equal the COMMANDS keys and whose `prd` entry declares kind `subcommand_dispatch` with `link` requiring `--url`.
- The rewritten guard MUST remain GREEN against the current six scaffolders on main.

## 6. DESIGN DECISION RATIONALE

**Where does flag requiredness live — a FlagSpec field, a separate declaration, or handler prose?**
- Options: (a) `required: true` on FlagSpec — rejected: CommandSpecs are per-verb *unions*, so a flag required by one subcommand would falsely bind siblings, and `parseArgs` (pure, subcommand-agnostic) is the wrong enforcement point; (b) keep ad-hoc handler checks and re-list them in the guard — the FAFF-538 anti-pattern (drift one layer up); (c) per-subcommand `required_flags` on the module's SURFACE, enforced by a shared `requireFlags` helper the handler calls.
- **Chosen:** (c) — the declaration and the enforcement are the same object, so requiredness drift (the reason FAFF-538 refused to freeze `--prd-goals`) is structurally impossible: retiring a requirement means editing the declaration, which updates the guard's expectation in the same commit.

**How do subcommand sets stay honest without deriving usage strings?**
- Options: (a) derive `expected one of:` strings from the SURFACE — cleanest single-source but churns byte-pinned usage strings across the test suite for no guard value; (b) refactor each dispatcher to a `{sub: handler}` table with keys as the declaration — bijection by construction but a large, riskier refactor of ~15 branch chains; (c) a two-line membership gate before the existing chain.
- **Chosen:** (c), with (a) and (b) named as later refinements. The gate makes the declaration authoritative in the direction that matters (an undeclared subcommand cannot dispatch), is byte-neutral on usage output, and is mechanically reviewable per module.

**How does the guard consume the surface — import or spawn?**
- **Chosen:** ESM-import `lib/cli-surface.js` (the established `config.js`/`COMMANDS` import convention; the entrypoint's `require.main` guard precedent shows imports don't dispatch). The `--json` CLI form exists for humans and out-of-repo tooling; the in-repo guard takes the cheaper, typed path. This is what makes the guard fully static — zero spawns.
- **Chosen:** the emitted JSON is a superset of the ticket's `{verb: {subcommands, required_flags}}` shape, adding `kind` and `flags` — the accepted-flag set is free (the specs exist), and unknown-flag drift is the commonest rot class in the FAFF-512/524 repairs.

**Which verbs get full SURFACE declarations in v1?**
- **Chosen:** every subcommand-dispatch verb (grep-discovered, ~15 modules); all remaining verbs classified `flat`/`positional` in the central map. Anything less re-imports the probe for the unmigrated remainder — the bijection self-test forces the classification to be complete, so the guard can drop the probe wholesale.

**Where do `required_flags` values come from in v1?**
- **Chosen:** solely from migrating checks the handlers already enforce unconditionally (discovered by grepping `is required` / equivalent early-returns in the dispatch modules, e.g. `prd link --url`). No new requiredness is invented; `prdr coverage` gets `required_flags: []` because the CLI genuinely no longer requires `--prd-goals` — and the moment someone reinstates it via `requireFlags`, the guard starts asserting it for free.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every decision above is closed with a `**Chosen:**` marker.

**Assumptions:**

- **Assumes:** the six scaffolders still carry `.faffrc.yaml` + `RUNBOOK.md` here-docs in the v1 shape and the guard is green on main. *Validation:* run `node --test test/scaffolder-cli-surface-drift.test.mjs` before starting; it must pass.
- **Assumes:** each dispatch module's CommandSpec is a module-level const that can be exported without side effects, and the entrypoint tolerates additional registry exports. *Validation:* `COMMANDS` is already exported (FAFF-538) and specs are plain object literals; confirm per module while migrating.
- **Assumes:** `regions.js` accepts the new command as region `factory` with a real `--selftest` (mirroring `lint-cli-doc`). *Validation:* run `faff regions selftest` after wiring; it exits 2 on any allowlist drift.

## 8. DONE — Definition of Done

### From WHY
- [ ] A RUNBOOK command-block line missing a declared required flag fails `node --test` in CI, naming the flag and the raw line.
- [ ] A RUNBOOK command-block line supplying a flag outside the verb's accepted set fails, naming the flag.
- [ ] The rewritten guard spawns zero CLI processes (no `runCli` import remains in `test/scaffolder-cli-surface-drift.test.mjs`).

### From WHAT (interfaces)
- [ ] `faff cli-surface --json` emits `{verb: {kind, subcommands, flags, required_flags}}` for every COMMANDS verb; keys are in bijection with COMMANDS.
- [ ] `faff cli-surface --selftest` asserts the bijection, the pinned dispatch/positional classifications, and required-flags ⊆ accepted-flags; exit 0 on the current tree.
- [ ] Every subcommand-dispatch module exports a SURFACE whose subcommand set the dispatcher gates on (an undeclared subcommand cannot dispatch).
- [ ] `requireFlags` exists as a shared helper; every migrated unconditional requiredness check routes through it (e.g. `prd link` without `--url` still exits 2).

### From HOW (behaviour)
- [ ] Verb, subcommand, unknown-flag, and missing-required-flag assertions in the guard are pure set-membership over imported surface data; `verbSurface` and the usage-format self-test are deleted.
- [ ] Flag-layer assertions fire only on 4-space-indented command-block lines, never on inline-backtick spans.
- [ ] The guard remains green against the six scaffolders on the current tree.
- [ ] New-verb wiring is complete: COMMANDS entry, usage text, `docs/guide/cli.md` row (lint-cli-doc green), `REGION_MAP` + `REGION_SELFTEST_ARGV` entries (`faff regions selftest` green).

### From HOW (edge cases)
- [ ] `--flag=value` tokens are membership-checked on the name; placeholder second tokens still yield verb-level-only checks; two same-command lines with different flags are each checked.
- [ ] A verb declared `spec: null` yields no flag-layer findings (unknown accepted set skips, never asserts empty), and `cli-surface --selftest` reports the null-spec count.

**Integration smoke test:**
```
1. In a unit fixture, feed the guard a body containing `    faff events read` with a
   temporarily-declared EVENTS read required_flags ["--run"]; assert FAIL naming --run.
2. Feed `    faff events read --run r1 --bogus x`; assert exactly one finding, for --bogus.
3. Run the full test file against the real six scaffolders; assert PASS.
4. Run `faff cli-surface --json | node -e 'JSON.parse(require("fs").readFileSync(0))'`; assert exit 0.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

_Refreshed autonomously by /faff-beep-boop (run run-20260724-004649-beepboop-full), prep lane — Path 1 stale-refresh, rebased onto main @ `0ccd321`. No design change from the 2026-07-23 draft; the FAFF-568 `events verify`/`anchor` addition is folded as context only (see the refresh note under the title). Post-spec comment scan: clean (no challenge/resolution). Already-shipped scan: premise holds — FAFF-538 (Done) deliberately deferred this flag layer + introspection command, no Done ticket supersedes it. Producer: faffter-dark-nlspec (slots.spec). Spec-review (faffter-noon-spec-review, single-pass, lenses architectural/infosec/methodology/QA per LensSelection): approve, zero objections — verdict validated via `faff contract spec-review-verdict` (exit 0) and retained above. spec-readiness contract exit 0 (markers valid, provenance present). Rating: high. Issue stays Todo._
