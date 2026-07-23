# Drift-guard: scaffolder RUNBOOK/.faffrc commands stay valid against the live CLI surface

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-538.

> **Refreshed 2026-07-23** (autonomous stale-refresh, run run-20260723-144253-beepboop-full, prep lane). The two `§7` scope Punts are now **Chosen** — closed by a human **Decision** comment (via /faff-tidy, 2026-07-23) to exactly the values the spec recommended: v1 ships **verb + subcommand existence only** (flag-level validation deferred), and v1 derives subcommands via the **bare-invocation usage probe** (no introspection command yet). The follow-up both decisions point at — `faff cli-surface --json` + flag-level validation + probe retirement — is filed as **FAFF-628** (blocked by this ticket). No design decision, interface, or architecture changed; the core mechanism was already fully founded and green on the current tree. Confidence bumped medium → high; `spec-review: approve` retained.

This spec is for the build agent implementing FAFF-538 and the humans reviewing it. It defines a CI-gated `node --test` drift-guard that reads the six external-verification scaffolders, extracts their embedded `.faffrc.yaml` and `RUNBOOK.md` here-docs, and fails loud when an embedded `faff` verb/subcommand or `.faffrc` slot key no longer exists on the live CLI surface. It is a *surface/parse* guard, never an execution or integration run.

## 1. WHY — Problem and Principles

**The load-bearing model:** the CLI's own registries are the single source of truth for "what exists", and the guard checks embedded gestures against those registries by importing them, never by re-listing them. The whole design turns on that — a hand-maintained allowlist of valid verbs would just be the same drift moved one layer up (the ticket's own words), so every "is this valid?" answer is derived from a live CLI artifact: the `COMMANDS` registry for verbs, each verb's emitted subcommand vocabulary for subcommands, and `config.js`'s exported key/vocab sets for `.faffrc`.

**Problem statement:** the six SUT scaffolders (`docs/external-verification/scaffold-p{1..5}-*.sh` + `scaffold-faff-lab.sh`) embed here-docs of faff CLI gestures that rot silently as the CLI surface moves, and the rot is only ever caught by a human eyeballing the scripts against `main` — it has already cost three manual repair passes (FAFF-512/513/524/529) and burns the first hour of the *next* external-verification run on command-not-found. This guard makes a stale scaffolder fail CI instead.

**Design principles:**

- **Derive, never re-list.** Every valid-surface set the guard checks against is imported or probed from a live CLI artifact, so the guard cannot itself go stale independently of the surface it guards. This is the whole point — reject any implementation that hardcodes a verb list, a subcommand list, or a config-key list.
- **Fail loud, never skip.** A scaffolder that cannot be parsed, a here-doc that is missing, or a probe that cannot classify a token is a *failure*, not a skipped assertion — mirroring the FAFF-274 no-silent-skip posture. Green CI must mean the scaffolders are genuinely current.
- **Surface, not execution.** The guard validates that verbs/subcommands/keys *exist*; it never runs an embedded command with its real arguments. The only CLI invocations it makes are bare, side-effect-free usage probes (`faff <verb>` with no args), whose sole output is a usage string.
- **Complement, don't duplicate.** `test/scaffolder-lights-out-dials.test.mjs` already guards the L4 *dial coherence* of the same here-docs (review/spec_review occupants, gates.fallback default, the adversarial backend block). This guard checks an orthogonal property — verb/subcommand/key *existence* — and must not restate the dial checks.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `test/scaffolder-lights-out-dials.test.mjs` | Node ESM (`node:test`) | The decisive precedent: static here-doc lint over the same six scaffolders; source of the `extractHeredoc` extraction convention and the import-canonical-sets-from-lib-modules convention this guard reuses. |
| `plugin/skills/faff/bin/faff` (`COMMANDS` registry) | CommonJS | Single source of truth for top-level verbs; consumed by `lint-cli-doc`. Currently not exported — this spec exports it. |
| `plugin/skills/faff/bin/lib/config.js` | CommonJS | Exports `DEFAULTS` (all `slots.*` + config keys), `TRACKING_KEYS`, `MODEL_LANE_VOCAB`, `EFFORT_LANE_VOCAB`, `VALID_APPETITES`, `validateModelLane`, `validateEffortLane` — the canonical `.faffrc` key/vocab surface for the config half. |
| `test/helpers/run-cli.mjs` | Node ESM | Existing test helper for spawning the real entrypoint; the pattern the usage-probe follows. |
| `.github/workflows/validate.yml` (final `node --test` step) | YAML | Where the guard runs. No new CI wiring needed — it is picked up by the existing `node --test` invocation. |

**Scope statement:** this is a test-infra drift-guard under the existing `node --test` suite (ADR-0002) — it adds one test file (plus a one-line export and, optionally, one shared helper), no new runner, no `package.json`, no config file.

## 2. OUT OF SCOPE

- **Flag-level validation (e.g. `prdr coverage` requires `--prd-goals`).** — Excluded from v1 (follow-up: **FAFF-628**). **Why:** the CLI does not advertise per-flag grammar uniformly, and flag *requiredness* itself drifts (live check: `faff prdr coverage` now exits 0 with no `--prd-goals`, so the exact FAFF-512 string is no longer a regression at all — freezing it would freeze a moving target). Doing this right needs the `faff cli-surface --json` introspection command below. **Extension point:** the same per-command probe in `checkRunbookCommands`, extended to assert supplied flags against a declared required-flag set once that surface exists.
- **A `faff cli-surface --json` introspection command.** — Not built in v1 (follow-up: **FAFF-628**). **Why:** a complete machine-readable verb→subcommand→flag grammar would have to be sourced from ~70 scattered command modules; that is a disproportionate build for the immediate drift pain, and the bare-invocation usage probe covers verb+subcommand today. **Extension point:** a new `cli-surface` entry in the `COMMANDS` registry emitting `{verb: {subcommands:[…], required_flags:{…}}}`, after which the guard drops its usage-string parsing for a pure set-membership check.
- **Deep `.faffrc` grammar validation (backends/budget/faffter_dark sub-keys).** — v1 validates slot keys + slot occupants + enumerated scalars only. **Why:** there is no complete machine-readable config grammar today; `faff config dump` passes unknown keys straight through (live check: a `slots.bogus_slot` round-tripped, exit 0), and namespaced blocks (`backends.<name>.*`, `budget.*`, `faffter_dark.adversarial.*`) are validated by their own commands, not a central schema. **Extension point:** `checkFaffrcKeys`, extended to route each namespaced block to its existing validator (`faff backends`, `faff adversarial-backends`, `faff budget`).
- **The `authoring-and-admitting-a-prd.md` doc's fenced commands.** — v1 scopes to the six scaffolder here-docs (the proven rot source; open question 3). **Why:** the doc is prose, not a here-doc-embedding script, so its extraction differs; the command-validation half is reusable once a doc-extractor is added. **Extension point:** a second `describe` block feeding the doc's fenced `faff …` lines through the same `checkRunbookCommands` verb/subcommand probe.
- **Executing the scaffolders end-to-end (docker, real build).** — Explicitly out per acceptance. The guard is static text + bare usage probes only.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| here-doc | A `cat > <file> <<'EOF' … EOF` block inside a scaffolder that materialises `<file>` on disk when the scaffolder runs. The guard reads these bodies statically; it never runs the scaffolder. |
| embedded command | A `faff <verb> [<subcommand>] …` gesture cited in a `RUNBOOK.md` here-doc — in a 4-space-indented command block or an inline-backtick span. |
| verb | The top-level `faff` subcommand (first token after `faff`), e.g. `prd`, `config`, `prdr`. Valid iff a key of the `COMMANDS` registry. |
| subcommand | The second token for a *subcommand-dispatch* verb, e.g. `new` in `faff prd new`. Valid iff a member of that verb's advertised vocabulary. |
| subcommand-dispatch verb | A verb whose bare invocation emits an `expected one of: …` (or `usage:`) enumeration of second-token subcommands (e.g. `prd`, `prdr`, `config`, `env`, `adr`, `profile`, `holdout`). |
| positional-arg verb | A verb whose first argument is data, not a subcommand (e.g. `audit <run-id>`, `next --status …`, `state <issue>`). Its bare invocation emits a non-enumeration diagnostic. Validated at verb level only. |
| valid-subcommand set | The set parsed from a subcommand-dispatch verb's bare-invocation usage line, cached per verb per test run. |

**Type definitions:**

```
RECORD EmbeddedCommand:
  verb: String                 # first token after `faff`
  subcommand: String | null    # second token, iff not a flag/placeholder
  raw: String                  # the source line, for the failure message
  source: String               # scaffolder filename + "RUNBOOK.md"

RECORD VerbSurface:
  name: String                 # ∈ COMMANDS keys
  kind: ENUM{ subcommand_dispatch, positional }
  subcommands: Set<String>     # populated iff kind == subcommand_dispatch; else empty

RECORD FaffrcKeyFinding:
  key: String                  # dotted path, e.g. "slots.spec" or "slots.spec: faffter-dark-nlspec"
  reason: ENUM{ unknown_slot_key, unresolved_occupant, bad_enum_value }
  detail: String
```

**Interfaces (the guard's internal helpers — all pure except the bounded usage probe):**

```
# --- extraction (shared with scaffolder-lights-out-dials.test.mjs) ---
FUNCTION extractHeredoc(scriptText: String, target: String) -> String | null
  # body of the first `cat > <target> <<'EOF' … EOF`; null if absent.

# --- verb/subcommand surface (verbs from COMMANDS, subcommands via bounded probe) ---
FUNCTION validVerbs() -> Set<String>
  # Object.keys(COMMANDS) imported from the entrypoint.

FUNCTION verbSurface(verb: String) -> VerbSurface
  # spawn `faff <verb>` bare (side-effect-free); classify + parse per HOW; memoised.

# --- runbook command parsing ---
FUNCTION parseEmbeddedFaffCommands(runbookBody: String, source: String) -> List<EmbeddedCommand>

# --- config keys ---
FUNCTION extractFaffrcKeys(faffrcBody: String) -> List<{dottedKey, value}>
FUNCTION checkFaffrcKeys(keys, config-exports, skillsDir) -> List<FaffrcKeyFinding>
```

**Design decisions** (full rationale in §6):

- Verb set is imported from the `COMMANDS` registry, not re-listed. **Chosen:** export `COMMANDS` (add it to the entrypoint's existing `module.exports`) and `import { COMMANDS }` in the test.
- Subcommand validity is derived from each verb's own bare-invocation usage string, not a hardcoded per-verb table. **Chosen:** a memoised `verbSurface(verb)` usage probe.
- The config half validates the drift class *not already guarded by the lights-out-dials test*: slot-key existence + slot-occupant resolution + enumerated-scalar values. **Chosen:** import `DEFAULTS`/`TRACKING_KEYS`/vocab sets from `config.js`; check occupant skill dirs exist.
- Extraction reuses the existing `extractHeredoc` convention. **Chosen:** promote it to a shared helper both scaffolder-lint files import.

## 4. HOW — Behavior

**Architecture and approach.** One new test file, `test/scaffolder-cli-surface-drift.test.mjs`, run by the existing `node --test`. It iterates the six scaffolders. For each, it extracts the `.faffrc.yaml` and `RUNBOOK.md` here-docs and runs two independent groups of assertions — the config-key half and the runbook-command half. The verb set is imported from `COMMANDS`; subcommand sets are lazily derived by a memoised bare-invocation usage probe; config-key canonical sets are imported from `config.js`. Missing here-docs and unclassifiable tokens fail loud.

**Extraction (shared helper).** Promote `extractHeredoc(scriptText, target)` out of `scaffolder-lights-out-dials.test.mjs` into `test/helpers/scaffolder-heredocs.mjs`; both files import it. The regex is unchanged from the proven original (`cat > <escaped-target> <<'EOF'\n(body)\nEOF`).

**Runbook command half — `checkRunbookCommands`.**

Behaviour summary: extract every `faff …` gesture cited in the RUNBOOK, and assert each verb exists and each subcommand (where the verb dispatches on one) is in that verb's live vocabulary.

```
PROCEDURE checkRunbookCommands(scaffolder):
  1. body := extractHeredoc(script, "RUNBOOK.md")
  2. IF body == null: FAIL "<scaffolder>: no RUNBOOK.md here-doc"   # fail loud, never skip
  3. commands := parseEmbeddedFaffCommands(body, scaffolder)
  4. FOR each cmd in commands:
     a. IF cmd.verb NOT IN validVerbs():
          FAIL "<source>: `faff <cmd.verb>` is not a live verb (COMMANDS registry) — raw: <cmd.raw>"
          CONTINUE
     b. surface := verbSurface(cmd.verb)
     c. IF surface.kind == positional OR cmd.subcommand == null:
          CONTINUE                       # verb-existence only; positional arg is data, not a subcommand
     d. IF cmd.subcommand NOT IN surface.subcommands:
          FAIL "<source>: `faff <verb> <subcommand>` — <subcommand> ∉ {<sorted set>} — raw: <cmd.raw>"
```

`parseEmbeddedFaffCommands` collects `faff …` occurrences from both 4-space-indented command blocks and inline-backtick spans. For each: split on whitespace; token[0] must be `faff`; `verb := token[1]`; `subcommand := token[2]` **iff** token[2] exists and is not a flag (`--…`/`-…`) and not a placeholder (`<…>`, `'<…'`, a `$VAR`, or a quoted arg) — otherwise `subcommand := null`. Deduplicate identical `(verb, subcommand)` pairs so one probe covers repeated citations.

**Anti-pattern:** treating a placeholder or flag as the subcommand. Why: `faff audit <run-id>` and `faff config get tracking.x` would false-positive — `<run-id>`/`get` handling must distinguish positional-arg verbs (via `verbSurface.kind`) and placeholder tokens (via the token shape test).

**`verbSurface(verb)` — the bounded, side-effect-free usage probe.**

Behaviour summary: run the verb bare once, read its usage output, and either parse a subcommand vocabulary or classify the verb as positional.

```
PROCEDURE verbSurface(verb):            # memoised: one spawn per verb per run
  out := runCli([verb]).stdout + stderr          # bare invocation — usage only, no side effects
  m := out.match(/expected one of:?\s*(.+?)\s*(?:\(or\b|$)/)
  IF m:
     subs := m[1].split("|").map(trim).map(strip trailing " [--…]" annotation).filter(nonEmpty)
     RETURN { name: verb, kind: subcommand_dispatch, subcommands: Set(subs) }
  u := out.match(/^faff <verb>: usage:\n\s*faff <verb> (\w[\w-]*)/m)     # e.g. holdout → "verdicts"
  IF u:
     RETURN { name: verb, kind: subcommand_dispatch, subcommands: Set([u[1]]) }
  RETURN { name: verb, kind: positional, subcommands: Set() }   # audit/next/state → verb-level only
```

**Failure modes:**

- **The failure:** the usage-string format drifts (a verb stops emitting `expected one of:` / `usage:` in the parsed shape), so `verbSurface` silently classifies a subcommand-dispatch verb as positional and a phantom subcommand slips through. **How you'd know:** a self-test case (below) pins the parse against a captured sample of each format variant; a format change fails that case loudly. **What it means:** update the parser (or, better, land the `cli-surface --json` follow-up FAFF-628 that removes the parsing entirely).
- **The failure:** a placeholder token shape not covered by the token test (e.g. an unquoted `SOME_ARG`) is read as a subcommand and false-positives. **How you'd know:** the guard fails on a scaffolder whose command is actually valid. **What it means:** widen the placeholder test; bias it toward treating ambiguous tokens as non-subcommands (a missed check is cheaper here than a false failure that blocks CI on a correct scaffolder — but §Principles' fail-loud still governs genuinely unknown *verbs*).

**Config-key half — `checkFaffrcKeys`.**

Behaviour summary: assert every slot key in the embedded `.faffrc.yaml` is a recognised slot, every slot occupant resolves to a real skill, and enumerated scalars carry legal values.

```
PROCEDURE checkFaffrcKeys(scaffolder):
  body := extractHeredoc(script, ".faffrc.yaml")
  IF body == null: FAIL "<scaffolder>: no .faffrc.yaml here-doc"
  keys := extractFaffrcKeys(body)          # dotted paths + scalar values, top-level + one nesting level
  FOR each {dottedKey, value} in keys:
    IF dottedKey starts with "slots.":
       slotName := dottedKey
       IF slotName NOT IN slotKeysOf(DEFAULTS):        # DEFAULTS holds every slots.* default
            FAIL "<scaffolder>: unknown slot key <slotName> (not in the config schema)"
       ELSE IF value is a bare skill name AND NOT skillDirExists(value, skillsDir):
            FAIL "<scaffolder>: slot <slotName> points at <value>, which is not a skill under plugin/skills/"
    ELSE IF dottedKey == "appetite" AND value NOT IN VALID_APPETITES:
            FAIL "<scaffolder>: appetite=<value> ∉ <VALID_APPETITES>"
    ELSE IF dottedKey startswith "models.":  laneErr := validateModelLane(dottedKey, value); IF laneErr: FAIL …
    ELSE IF dottedKey startswith "effort.":  laneErr := validateEffortLane(dottedKey, value); IF laneErr: FAIL …
    # namespaced blocks (backends.*, budget.*, faffter_dark.*, tracking.*) are NOT asserted key-by-key in v1
    # (see OUT OF SCOPE — deep grammar); their presence is tolerated, their sub-keys unchecked.
```

`skillDirExists(name, skillsDir)` checks `plugin/skills/<name>/SKILL.md` exists; a namespaced `plugin:skill` value or an occupant not shipped in-repo is treated as out-of-repo and skipped (not failed) — the in-repo occupants are what drift (the FAFF-513 class was a renamed in-repo occupant). `slotKeysOf(DEFAULTS)` is the subset of `DEFAULTS` keys beginning `slots.`.

**Edge cases:**

- A scaffolder with no `RUNBOOK.md` or no `.faffrc.yaml` here-doc → fail loud (all six are expected to carry both; a genuine absence is a real finding). If `scaffold-faff-lab.sh` (FAFF-505) carries a differently-shaped here-doc, the guard adapts the target name, not the skip.
- P4/P5 are git-only/gated and may embed fewer faff commands — the command list may be short or empty; an empty list is valid (no assertions fire), not a failure.
- A RUNBOOK line citing `faff` inside prose (not a command) — the token test (`token[0] == "faff"` at a command position in an indented block or backtick span) plus the placeholder filter keep prose mentions out; a prose false-positive that names a *real* verb is harmless (it passes), and one naming a non-verb is a genuine stale reference worth failing on.

## 5. SCENARIOS

```
Given a scaffolder RUNBOOK.md here-doc that cites `faff prd admit`
When the drift-guard runs under `node --test`
Then the check FAILS, naming prd's live subcommand set ({path,new,link,list,validate}) and the offending raw line
```

```
Given a scaffolder RUNBOOK.md here-doc that cites a non-existent top-level verb `faff frobnicate x`
When the drift-guard runs
Then the check FAILS, reporting `frobnicate` is not a key of the COMMANDS registry
```

```
Given a scaffolder .faffrc.yaml here-doc with a `slots.spec_reviewer:` key (a slot name the schema does not define)
When the drift-guard runs
Then the check FAILS, reporting slots.spec_reviewer is not in the config schema
```

```
Given a scaffolder .faffrc.yaml here-doc whose `slots.review:` points at a skill directory that does not exist under plugin/skills/
When the drift-guard runs
Then the check FAILS, reporting the unresolved occupant (the FAFF-513 rename class)
```

```
Given every embedded verb/subcommand/slot-key in all six live scaffolders is current
When the drift-guard runs against the repo as-is on main
Then the check PASSES (the guard is green on a correct tree — it is a regression guard, not a permanent red)
```

- The `verbSurface` parser MUST correctly classify all observed usage-format variants: colon form (`prd`/`prdr`/`adr`), no-colon form (`env`/`profile`/`config`), the `holdout` `usage:` form, and the positional verbs (`audit`/`next`/`state`) as `positional`.

## 6. DESIGN DECISION RATIONALE

**Where does the valid-verb set come from — an allowlist, `--help` scraping, or the registry?**
- Options: (a) hand-maintained allowlist — rejected by the ticket (drift one layer up); (b) `faff <verb> --help` per verb — no per-verb `--help` exists; (c) the `COMMANDS` registry — the actual single source of truth, already consumed by `lint-cli-doc`.
- **Chosen:** import the `COMMANDS` registry keys (option c) by adding `COMMANDS` to the entrypoint's existing `module.exports` and `import`ing it in the test. Rationale: exact-match to the surface, zero re-listing, and it mirrors the established convention in `scaffolder-lights-out-dials.test.mjs` (which imports `ADVERSARIAL_*_OCCUPANTS` from `lights-out.js`). The entrypoint already exports pure cores and is already `require`d by the corrective-integrity tests behind a `require.main === module` guard, so importing it does not trigger CLI dispatch.

**How are subcommands validated without a central subcommand registry?**
- Options: (a) hardcode a per-verb subcommand table — re-listing, rejected; (b) execute the full embedded command and check the exit code — proven unreliable: `faff prd admit` (a phantom) exits **0** with an `expected one of:` line, while `faff prd new --from x` (valid verb) exits **2** on a missing-arg, so exit code both false-negatives and false-positives; (c) a new `faff cli-surface --json` — the clean long-term answer but a disproportionate v1 build; (d) derive each verb's vocabulary from its own bare-invocation usage string.
- **Chosen:** option (d), a memoised `verbSurface(verb)` usage probe, with (c) named as the durable follow-up **FAFF-628** (§OUT OF SCOPE). Rationale: it derives the set from a live CLI artifact (no re-listing), the bare invocation is side-effect-free (usage only), and it is bounded to one spawn per verb per run. Its fragility (usage-format coupling) is contained by a self-test pinning each format variant and is the explicit trigger to graduate to `cli-surface --json`.

**Does the config half reuse `faff config validate`, or is a new assertion needed?** (open question 2)
- Finding: there is no `faff config validate`; `faff config dump` passes unknown keys straight through (proven), so it cannot serve. `config.js` does export the canonical sets (`DEFAULTS`, `TRACKING_KEYS`, `MODEL_LANE_VOCAB`, `EFFORT_LANE_VOCAB`, `VALID_APPETITES`, `validateModelLane`, `validateEffortLane`).
- **Chosen:** a new in-test `checkFaffrcKeys` that imports those sets and asserts slot-key existence + slot-occupant resolution + enumerated-scalar legality. Deep namespaced-grammar validation (backends/budget/faffter_dark sub-keys) is punted (§OUT OF SCOPE) because no complete grammar exists and those blocks have their own validators. Rationale: this targets exactly the config drift class the lights-out-dials test does *not* already cover (a dropped slot key or a renamed occupant), without false-positiving on legitimate namespaced keys.

**Copy `extractHeredoc`, or promote it to a shared helper?**
- **Chosen:** promote to `test/helpers/scaffolder-heredocs.mjs`, imported by both scaffolder-lint files. Rationale: two independent copies of the extraction regex is itself a drift risk (the repo's stated value: shared prose/logic has one home); the refactor of the existing test is mechanical (swap a local function for an import) and its existing assertions prove the promotion is behaviour-preserving.

## 7. RESOLVED SCOPE DECISIONS AND ASSUMPTIONS

**Resolved scope decisions** (both closed by a human **Decision** comment via /faff-tidy, 2026-07-23, to the values this spec recommended; the shared follow-up is **FAFF-628**, blocked by this ticket):

- **Chosen:** v1 validates **verb + subcommand existence only**; flag-level validation (the `prdr coverage --prd-goals` acceptance sub-clause) is deferred to follow-up **FAFF-628**. The flag layer needs a declared required-flag grammar (the `faff cli-surface --json` follow-up), and flag requiredness itself has already drifted (`prdr coverage` now exits 0 without `--prd-goals`), so freezing the exact FAFF-512 string would freeze a moving target. The extension point is the `checkRunbookCommands` per-command probe, extended to assert supplied flags against a declared required-flag set once that surface exists.
- **Chosen:** v1 derives subcommands via the **bare-invocation usage probe** (`verbSurface`); the `faff cli-surface --json` introspection command is **FAFF-628**, not v1. The probe covers verb + subcommand today; the introspection command is the cleaner long-term design but a larger, separable build, and is the named extension point the probe's usage-format fragility should trigger.

**Assumptions:**

- **Assumes:** subcommand-dispatch verbs emit their subcommand vocabulary in one of the observed forms — `expected one of[:] a | b | c [(or --selftest)]` or `usage:\n  faff <verb> <sub> …`. *Validation:* the self-test pins a captured sample of each variant (`prd`, `env`, `config`, `holdout`) and of the positional verbs (`audit`, `next`, `state`); run it before trusting the guard. A future format change fails the self-test loudly, not silently.
- **Assumes:** `scaffold-faff-lab.sh` (FAFF-505, now landed) embeds `.faffrc.yaml` and `RUNBOOK.md` here-docs in the same `cat > <file> <<'EOF'` shape as p1–p5. *Validation (discharged during prep):* all six scaffolders were confirmed to carry both here-docs in the identical shape; the build agent re-greps before wiring the file list.
- **Assumes:** the entrypoint can be `import`ed from an ESM test for `COMMANDS` without executing a subcommand. *Validation:* the `require.main === module` guard already gates CLI dispatch and the corrective-integrity tests already import the entrypoint — confirm `COMMANDS` is in scope at the `module.exports` site (it is defined before it).

## 8. DONE — Definition of Done

### From WHY
- [ ] A scaffolder embedding a non-existent top-level `faff` verb fails `node --test` in CI, naming the verb.
- [ ] A scaffolder embedding a non-existent subcommand of a real verb (e.g. `prd admit`) fails, naming the verb's live subcommand set.
- [ ] A scaffolder embedding an unknown `.faffrc` slot key, or a slot pointing at a non-existent in-repo skill, fails, naming the key/occupant.
- [ ] The guard never silently skips: a missing here-doc or an unclassifiable verb is a failure, not a no-op.

### From WHAT (interfaces)
- [ ] `COMMANDS` is exported from `plugin/skills/faff/bin/faff` and imported by the test as the verb source (no hardcoded verb list).
- [ ] `verbSurface(verb)` returns `subcommand_dispatch` with a parsed set for `prd`/`prdr`/`env`/`config`/`adr`/`profile`/`holdout`, and `positional` for `audit`/`next`/`state`.
- [ ] `extractHeredoc` lives in `test/helpers/scaffolder-heredocs.mjs` and is imported by both scaffolder-lint test files (no duplicated regex).
- [ ] `checkFaffrcKeys` imports `DEFAULTS`/`TRACKING_KEYS`/`VALID_APPETITES` (+ model/effort lane validators) from `config.js` — no hardcoded key list.

### From HOW (behaviour)
- [ ] The guard iterates all six scaffolders (`scaffold-p{1..5}-*.sh` + `scaffold-faff-lab.sh`).
- [ ] Every RUNBOOK `faff …` gesture (indented block + inline backtick) is parsed; placeholder/flag second-tokens are not treated as subcommands; repeated `(verb,subcommand)` pairs are deduped to one probe.
- [ ] The usage probe spawns each verb at most once per run, bare (no real args), and makes no other CLI invocation.
- [ ] The guard is GREEN against the current repo tree (it is a regression guard, not a standing red).

### From HOW (edge cases)
- [ ] A `verbSurface` self-test pins all observed usage-format variants and the positional verbs; a format drift fails it loudly.
- [ ] An empty embedded-command list (e.g. a gated P4/P5 RUNBOOK) passes without firing assertions.

**Integration smoke test:**
```
1. Add a temporary RUNBOOK line `    faff prd admit` to a throwaway copy of a scaffolder body in a unit fixture.
2. Run the new test file via `node --test test/scaffolder-cli-surface-drift.test.mjs`.
3. Assert it FAILS naming `admit ∉ {path,new,link,list,validate}`.
4. Remove the line; assert the file PASSES against the real six scaffolders.
```

confidence: high

_Refreshed autonomously by /faff-beep-boop (run run-20260723-144253-beepboop-full), prep lane, from the medium-confidence spec produced 2026-07-22. Both scope Punts closed by a human Decision (/faff-tidy, 2026-07-23) to their spec-recommended values (verb + subcommand existence only; usage-probe over introspection); the shared follow-up FAFF-628 is filed and blocked by this ticket. No design decision, interface, or architecture changed — the core mechanism was already fully founded and green on the current tree. Rating: high. spec-review: approve (retained)._