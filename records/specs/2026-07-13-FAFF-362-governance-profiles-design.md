# Spec — FAFF-362: Governance profiles (declared vocabulary tables; delivery profile = faff's dialect)

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high

*Buildable design spec for FAFF-362. Audience: the build agent doing the refactor, and human reviewers gating it. It splits the three governance engines from the faff-specific word-lists they validate against, shipping today's vocabulary as the default "delivery profile" with byte-identical behaviour.*

## 1. WHY — Problem and Principles

**The load-bearing idea:** the governance engines (`runcheck`, `events`, `sentry`) are already generic *machinery* — a completeness check, an envelope validator, a set of derailment predicates. What ties them to faff is not their structure but the **closed word-lists** they compare against: the terminal-state set, the event-type set, the sentry trigger/outcome strings. Move those word-lists out of engine code into **one declared profile table** the engines read, and the machinery becomes dialect-independent — with faff's current vocabulary as *a* profile (the "delivery profile"), not *the* hardcoded truth.

**Problem statement.** Today each engine hardcodes its vocabulary as module-level `Set`/object literals *and* embeds raw strings inside predicate bodies (`evalThrash` compares `e.type === "build-start"` inline). That means the governance region can't be reused for any non-faff pipeline without editing engine internals, and rung 3 of the extraction (`design/governance-extraction-layers.md`) can't be demonstrated. This change single-sources every governance vocabulary into one `DELIVERY_PROFILE` constant the three engines consume, threaded in as a defaulted parameter, byte-identical when it's active (which it is by default).

**Design principles.**

- **Byte-identical when delivery is active.** The delivery profile *is* today's exact vocabulary. Every existing selftest case table and the three external test files must pass **unchanged**. Any diff is a bug, not an intended behaviour change.
- **Profiles are pure closed-vocab data — refuse conditionals (the design-doc guard).** A profile value is a string, a finite number, an array of strings, or a flat object of those. No functions, no regexes, no nested policy. The moment a profile would need a conditional, the policy layer has leaked in — the shape validator mechanically rejects it.
- **Logic stays in the engine; vocabulary moves to the profile.** The refactor relocates *strings*, never *control flow*. `evalThrash` keeps its loop and its `>= thrash_n` test; it just reads the trigger type from the profile instead of a literal. An engine that grows a profile-driven `if` is doing it wrong.
- **No silent fallback on a bad profile.** An override profile that fails shape validation is a loud error (exit 2), never a quiet revert to delivery — a misconfigured dialect must not masquerade as faff's.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (monolith, ~13.8k lines) | All three engines + the new profile constant live here; no `lib/` |
| `runcheck` region (from line 1031) | — | `TERMINAL_STATES:1041`, `auditLedger:1052`, `RUN_HEARTBEAT_STALE_SECS_DEFAULT:1084` |
| `events` region (from ~8954) | — | `EVENT_PHASES/EVENT_TYPES/EVENT_ISSUE_SCOPED/EVENT_LEDGER_OUTCOMES:8954–8967`, `eventViolations:8973` |
| `sentry` region (from 9500) | — | `SENTRY_THRESHOLD_DEFAULTS:9544`, inline predicate literals `evalThrash:9637/9641`, `evalRepeatedFailure:9667`, `sentryFailureFingerprint:9660–9661` |
| `REGION_MAP:12849` + `regions selftest:13335` | — | The single-source-constant + bijection-lint template this mirrors |
| `test/{runcheck-gate,events,sentry}.test.mjs` | Node `node:test` | Must pass unchanged; the byte-identical guarantee |

**Scope.** Rung 3 of the governance extraction: the three named engines become profile-driven. It does not extract the engines into a package, does not touch `budget`/`economics`, and adds no `.faffrc` profile schema.

> **STALENESS NOTE (added at build time, FAFF-441):** the reference context above cites `bin/faff` as a monolith with specific line anchors. Since this spec was written, FAFF-441 split `bin/faff` into `plugin/skills/faff/bin/lib/*.js` modules — `runcheck.js`, `events.js`, `sentry.js` now live as separate files, and there is no single "line 1031" anchor. The DESIGN below (profile constant + threaded param + `activeProfile` + `validateProfileShape` + `profiles` subcommand + `SECOND_PROFILE` proof) is unchanged and was built faithfully; only the STRUCTURAL placement differs — the new `DELIVERY_PROFILE` constant lives in a new `plugin/skills/faff/bin/lib/governance-profile.js` module (region-tagged `governance`), required by `runcheck.js`/`events.js`/`sentry.js`. `RUN_HEARTBEAT_STALE_SECS_DEFAULT` was additionally relocated from `runcheck.js` to `shared-infra.js` (re-exported from `runcheck.js` unchanged) to avoid a `runcheck.js` ⇄ `governance-profile.js` require cycle that the modular split introduced and the monolith never had.

## 2. OUT OF SCOPE

- **`budget` and `economics` vocabulary.** `BUDGET_NON_ATTEMPT_OUTCOMES` (`faff:2603`) and `ECONOMICS_BUCKET_ORDER` (`faff:2828`) also reference outcome strings but are **not** among the three engines rung 3 names. **Why excluded:** scope discipline — dragging them in widens the blast radius and the lint surface. **Extension point:** a later rung points these at `profile.terminal_states` / a render-order profile key; until then they keep their own literals and the lint deliberately does not cover them.
- **On-disk profile files / `.faffrc` profile schema.** The profile stays an in-code constant plus a single env override. **Why excluded:** "no config-schema work until a second profile actually exists" (ticket). **Extension point:** `readGovernanceConfig` / `.faffrc.yaml` a `governance.profile:` key later.
- **Renaming the `issue` unit key.** The `issue`-field name is a compat dialect (`faff:8960` notes the rename is deferred to extraction schema-v2 / rung 4). **Why excluded:** rung 4, not rung 3. **Extension point:** the schema-v2 slice.
- **A second *real* profile.** Only a **synthetic** second-profile fixture (test-only) ships, to prove dialect-independence. **Why excluded:** no real non-faff consumer exists yet. **Extension point:** the foreign-emitter rung (rung 6).
- **`heartbeat` / `effects` / `review-progress` / `audit` engines.** Governance-region, but rung 3 names only runcheck/events/sentry. **Why excluded:** they don't consume the state/type/threshold vocabularies. **Extension point:** future rungs if they grow dialect coupling.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Profile | One declared, pure-data table of a pipeline's governance vocabulary (states, event types, per-type field rules, sentry bindings + thresholds) |
| Delivery profile | `DELIVERY_PROFILE` — faff's current vocabulary; the built-in default and profile #1 |
| Active profile | The profile the engines use this invocation: the override (if `$FAFF_GOVERNANCE_PROFILE` is set + valid) else `DELIVERY_PROFILE` |
| Shape-valid | A profile whose every leaf is a string / finite number / array-of-strings / flat object thereof — the closed-vocab guard |

**The profile shape.** One constant, placed in a new `// === region:governance — profiles` section (built at `plugin/skills/faff/bin/lib/governance-profile.js`, required by `runcheck.js`/`events.js`/`sentry.js`):

```
RECORD Profile:
  # --- runcheck ---
  terminal_states: List<String>          # runcheck's valid ledger outcomes (delivery: the 6-set)
  # --- events ---
  event_phases: List<String>             # valid `phase` values
  event_types: List<String>              # valid `type` values
  issue_scoped_types: List<String>       # types requiring a non-empty `issue` field
  outcome_required_types: List<String>   # types requiring data.outcome ∈ ledger_outcomes (delivery: ["issue-outcome"])
  ledger_outcomes: List<String>          # the 7-set an issue-outcome's data.outcome must use
  # --- sentry ---
  sentry: {
    thresholds: { thrash_n: Number, failure_k: Number,
                  stall_window_secs: Number, run_elapsed_ceiling_secs: Number },
    thrash:  { start_type: String, ship_type: String, ship_outcome: String },
    failure: { types: List<String>, park_type: String, outcome_type: String, errored_outcome: String }
  }

  CONSTRAINT shape-valid: every leaf ∈ {String, finite Number, List<String>}; sub-objects are flat
```

**The delivery profile (profile #1) — today's exact literals, byte-for-byte:**

```
DELIVERY_PROFILE:
  terminal_states:        ["shipped","pr-open","parked","errored","routed-out","unreached-budget"]   # 6, from runcheck.js
  event_phases:           ["run","tidy","prep","build"]                                                # events.js
  event_types:            ["run-start","run-end","tidy-done","issue-admitted","prep-start","prep-done",
                           "build-start","issue-outcome","discovered-scope-filed","budget-checkpoint","park",
                           "sentry-checkpoint","corrective-authored","corrective-consumed","containment-check"]  # events.js (extended since prep by FAFF-352/326/354)
  issue_scoped_types:     ["issue-admitted","prep-start","prep-done","build-start","issue-outcome","park",
                           "corrective-authored","corrective-consumed","containment-check"]              # events.js
  outcome_required_types: ["issue-outcome"]                                                            # generalises the inline conditional
  ledger_outcomes:        ["shipped","pr-open","parked","errored","routed-out","unreached-budget","claimed-by-peer"]  # 7, from events.js
  sentry:
    thresholds: { thrash_n: 3, failure_k: 3,
                  stall_window_secs: RUN_HEARTBEAT_STALE_SECS_DEFAULT, run_elapsed_ceiling_secs: 14400 }  # sentry.js
    thrash:  { start_type: "build-start", ship_type: "issue-outcome", ship_outcome: "shipped" }        # sentry.js
    failure: { park_type: "park", outcome_type: "issue-outcome", errored_outcome: "errored" }  # `types` key dropped at build time — unused by any engine predicate, so not carried as dead weight
```

**Design decision — preserve the runcheck/events outcome asymmetry as two keys.** runcheck's `TERMINAL_STATES` has 6 members; events' `EVENT_LEDGER_OUTCOMES` has 7 (adds `claimed-by-peer`). They are consumed by different engines for different checks.

**Chosen:** the profile carries **two distinct keys** — `terminal_states` (6, runcheck) and `ledger_outcomes` (7, events) — not one unified list. Rationale: byte-identical behaviour requires preserving exactly what each engine validates today; unifying them would either make runcheck newly accept `claimed-by-peer` or make events newly reject it — both behaviour changes. The asymmetry is real dialect data, so it lives in the profile as two keys.

**Design decision — per-type field rules as closed-vocab lists, not conditionals.** The events validator has two per-type rules: issue-scoped types require `issue`, and `issue-outcome` requires `data.outcome` (an inline `obj.type === "issue-outcome"` conditional).

**Chosen:** encode both as **membership lists** — `issue_scoped_types` and `outcome_required_types` — and rewrite the validator to test list membership (`outcome_required_types.includes(obj.type)`), turning the hardcoded conditional into profile-driven data. Rationale: satisfies the closed-vocab guard (data, not an `if` on a literal) and generalises cleanly (a future profile could require `data.outcome` on more than one type).

**Design decision — sentry predicate vocabulary as role-keyed profile strings.** `evalThrash`/`evalRepeatedFailure`/`sentryFailureFingerprint` embed `build-start`/`issue-outcome`/`shipped`/`park`/`errored` inline.

**Chosen:** a `sentry.thrash` / `sentry.failure` sub-table of **role→string** bindings (shape above); the predicates read those roles (`P.sentry.thrash.start_type` instead of `"build-start"`). The predicate *logic* (the loops, the fingerprint branch on park-vs-outcome) stays in the engine, reading the role strings. Rationale: relocates vocabulary without relocating control flow — the branch `if (e.type === P.sentry.failure.park_type)` is engine logic over profile data. Exact key names are implementer latitude provided (a) no vocabulary literal survives in a predicate body and (b) every profile leaf stays shape-valid.

**Design decision — `stall_window_secs` single source.** It aliases `RUN_HEARTBEAT_STALE_SECS_DEFAULT`.

**Chosen:** the profile's `sentry.thresholds.stall_window_secs` **references** `RUN_HEARTBEAT_STALE_SECS_DEFAULT` (one source of `900`); runcheck's own heartbeat-stale default is *not* itself profile data (it's a runcheck operational default, independently `$FAFF_RUN_HEARTBEAT_STALE_SECS`-overridable). Rationale: smallest change that keeps one source for the number and stays byte-identical.

> **Build-time addendum:** in the split-module structure this constant's home moved from `runcheck.js` to `shared-infra.js` (re-exported from `runcheck.js` unchanged) — see the staleness note in §1. The "one source of 900" property is preserved; only which file defines it changed, to avoid a `runcheck.js` ⇄ `governance-profile.js` require cycle.

**Design decision — the profile is threaded as a defaulted parameter.** The pure validators currently read module-level Sets.

**Chosen:** thread the active profile (or its relevant slice) into each pure function as a **trailing defaulted parameter** — `auditLedger(data, label, profile = activeProfile())`, `eventViolations(obj, requireEnvelope, profile = activeProfile())`, `evalThrash(events, th, profile = activeProfile())`, etc. Rationale: mirrors the existing injectable-seam pattern (`nowFn`/`getFn`), keeps the CLI byte-identical (the default resolves the same delivery vocabulary), and makes the second-profile behavioural test a pure-function call with no env manipulation. `evaluateDerailment` / `sentryThresholds(cfg)` take the profile too (thresholds default from `profile.sentry.thresholds`, config still overrides).

**Override + resolver interface.**

```
activeProfile(env = process.env) -> Profile:
  # resolves ONCE per process; validates on load; loud on failure
  path := env.FAFF_GOVERNANCE_PROFILE
  IF path is unset/empty → return DELIVERY_PROFILE
  raw := JSON.parse(readFile(path))            # parse error → exit 2, loud
  errs := validateProfileShape(raw)            # shape-valid guard
  IF errs non-empty → stderr(errs), exit 2      # NEVER silent-fallback to delivery
  return raw
```

> **Build-time addendum:** `activeProfile` does not call `process.exit` directly — it THROWS a `GovernanceProfileError` (a marker error), caught uniformly at `bin/faff`'s `main()` dispatch boundary and converted to a loud stderr line + exit 2 there. A bare `process.exit()` buried inside a pure function used as a default parameter would abort an in-memory `--selftest` run mid-table; throwing keeps every pure function pure and testable while still guaranteeing the loud, uniform, no-silent-fallback CLI behaviour for every governance subcommand (present or future).

**New `profiles` subcommand** (mirrors `regions`; wired into `COMMANDS`, `REGION_MAP` as `"governance"`, and `REGION_SELFTEST_ARGV`, preserving the bijection):

| Invocation | Behaviour |
|---|---|
| `faff profiles list [--json]` | print the active profile |
| `faff profiles validate [--file F]` | shape-validate a profile (F, or the active one); exit 0 valid / 1 invalid (names the offending leaf) / 2 unreadable |
| `faff profiles --selftest` | drive all three engines under **both** `DELIVERY_PROFILE` and the synthetic `SECOND_PROFILE`, asserting correct validation under each |

## 4. HOW — Behavior

**Approach.** Add the profile module (constant + `SECOND_PROFILE` fixture + `activeProfile` + `validateProfileShape`) as `governance-profile.js`, required by the three engine modules. Re-point the three engines' pure functions at a threaded profile parameter, replacing every module-level Set read and every inline literal with a profile field read. `TERMINAL_STATES` / `EVENT_*` module constants stay exported (existing consumers reuse them directly) but are now derived from `DELIVERY_PROFILE` rather than independent literals. Add the `profiles` subcommand + fixture-driven selftest. Change no control flow.

```
PROCEDURE eventViolations(obj, requireEnvelope, P = activeProfile()):
  ... envelope checks unchanged ...
  IF obj.phase ∉ P.event_phases            → push "phase not in Phase {…}"
  IF obj.type  ∉ P.event_types             → push "type not in EventType {…}"
  IF P.issue_scoped_types includes obj.type AND obj.issue empty → push "issue-scoped but missing 'issue'"
  IF P.outcome_required_types includes obj.type:
     outcome := obj.data?.outcome
     IF outcome ∉ P.ledger_outcomes        → push "data.outcome '…' not in ledger outcome vocabulary {…}"
  return violations
```

```
PROCEDURE auditLedger(data, label, P = activeProfile()):
  invalid_outcomes := entries whose state ∉ P.terminal_states
  ... rest unchanged ...

PROCEDURE evalThrash(events, th, P = activeProfile()):
  count e where e.type == P.sentry.thrash.start_type (per issue)
  mark shipped where e.type == P.sentry.thrash.ship_type AND e.data.outcome == P.sentry.thrash.ship_outcome
  ... >= th.thrash_n logic unchanged ...
```

**Behavior summary.** With no override set, `activeProfile()` returns `DELIVERY_PROFILE`, whose fields equal today's literals exactly — so every engine computes an identical result, and every existing test passes untouched. With `$FAFF_GOVERNANCE_PROFILE` pointing at a shape-valid file, the same engines validate against *that* dialect.

**Edge cases.**
- **Override file missing / unparseable** → exit 2, loud; never a silent delivery fallback.
- **Override file shape-invalid** (e.g. a leaf that's an object of objects, or a number where a string is required) → `validateProfileShape` names the offending path, exit 2.
- **Profile missing a key an engine needs** → shape validation requires all engine-consumed keys present; a missing required key is a shape violation, not an undefined read at runtime.
- **`SECOND_PROFILE` shares no vocabulary with delivery** (deliberately: states like `["done","open","dropped"]`, types like `["job-start","job-end",…]`) → a delivery fixture (`shipped`, `build-start`) fed to an engine under `SECOND_PROFILE` must be *rejected*; a `SECOND_PROFILE` fixture must be *accepted*. This asymmetry is the dialect-independence proof.

**Anti-pattern:** unifying `terminal_states` and `ledger_outcomes` into one list "to deduplicate". Why: it changes what runcheck or events accepts (`claimed-by-peer`) — a behaviour change masquerading as cleanup.

**Anti-pattern:** letting a profile carry an `if`, a regex, or a nested rule object. Why: that is policy leaking into data — the exact DSL-trap the design-doc guard forbids; `validateProfileShape` must reject it.

**Anti-pattern:** silent fallback to `DELIVERY_PROFILE` when an override fails to load. Why: a misconfigured foreign dialect would then run as faff, corrupting its own governance invisibly.

## 5. SCENARIOS

```
Given no $FAFF_GOVERNANCE_PROFILE and today's fixtures
When runcheck/events/sentry run under the default active profile
Then every existing inline selftest case and all three external test files (runcheck-gate, events, sentry) pass unchanged (byte-identical)
```

```
Given a synthetic SECOND_PROFILE with disjoint vocabulary (states ["done","open","dropped"], types ["job-start","job-end",…], thrash_n 5)
When each engine's pure validator is driven with SECOND_PROFILE as the profile parameter
Then a delivery-vocabulary fixture (outcome "shipped", type "build-start") is REJECTED
 And a SECOND_PROFILE-vocabulary fixture is ACCEPTED
 And sentry's thrash predicate trips at 5 build-starts, not 3
```

```
Given a profile file whose leaf is an object-of-objects (a conditional/policy shape)
When `faff profiles validate --file F` runs
Then it exits non-zero and names the offending leaf path (the closed-vocab guard refuses it)
```

```
Given $FAFF_GOVERNANCE_PROFILE pointing at a missing or shape-invalid file
When any governance engine resolves the active profile
Then it exits 2 loudly and does NOT fall back to the delivery profile
```

## 6. DESIGN DECISION RATIONALE

**Two outcome keys or one?** — *One list* dedups but changes runcheck-vs-events acceptance of `claimed-by-peer`. *Two keys* preserves exact per-engine behaviour. **Chosen:** two keys (`terminal_states` 6, `ledger_outcomes` 7) — byte-identical wins.

**Per-type rules: conditionals or lists?** — *Keep the `type === "issue-outcome"` conditional* is less churn but leaves a literal in engine code. *Membership lists* (`outcome_required_types`) move it to data. **Chosen:** lists — satisfies the closed-vocab guard and generalises.

**Sentry vocab: role-keyed strings or a flat list?** — *Flat list* loses which string plays which role in the predicate. *Role-keyed sub-table* (`thrash.start_type`, `failure.errored_outcome`) preserves intent. **Chosen:** role-keyed; predicate logic stays in the engine reading the roles.

**Thread the profile as a param, or read a module global?** — *Module global* is less signature churn but makes the second-profile test require env/global mutation. *Defaulted param* mirrors the existing injectable-seam pattern and keeps the CLI byte-identical. **Chosen:** defaulted param (`profile = activeProfile()`).

**Enforcement: behavioural fixture, literal-grep, or both?** — *Grep alone* can't prove the engine *reads* the profile (only that literals are absent). *Second-profile fixture alone* is the real proof but a stray literal could still pass delivery. **Chosen:** both — the `SECOND_PROFILE` behavioural selftest is primary (an engine misbehaves under a disjoint profile iff a literal survived); the scoped literal-grep is a cheap secondary smell.

**Override: env path, flag, or `.faffrc`?** — *`.faffrc` key* is config-schema work the ticket defers. *Flag* needs threading through every subcommand. *Env path* (`$FAFF_GOVERNANCE_PROFILE`) is one resolution point, enough to load the test fixture. **Chosen:** env path, resolved+validated once, loud on failure.

**Where does `RUN_HEARTBEAT_STALE_SECS_DEFAULT` live, given the modular split?** — *Leave it in `runcheck.js`* would force `governance-profile.js` to require `runcheck.js` for the number, while `runcheck.js` also requires `governance-profile.js` for its threaded default — a require cycle the pre-split monolith never had (no file boundaries). *Move it to `shared-infra.js`* (which both already depend on) breaks the cycle with zero behaviour change; `runcheck.js` re-exports it unchanged so `sentry.js`'s existing import site never moves. **Chosen:** `shared-infra.js`, single source, re-exported.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions.**

- **Assumes:** the five governance vocabulary constants (`TERMINAL_STATES`, `EVENT_PHASES`, `EVENT_TYPES`, `EVENT_ISSUE_SCOPED`, `EVENT_LEDGER_OUTCOMES`) and the vocabulary strings inside the sentry predicates have **no consumers outside the three engine functions** (other than direct re-export reuse by `governance-check.js`/`disposition.js`/`contain.js`/`corrective.js`, which keep working unchanged since the constants still export identical values). **Validation:** grepped each identifier and vocabulary literal across `plugin/skills/faff/bin/lib/*.js`; every hit is inside `auditLedger` / `eventViolations` / the sentry predicates / their selftest tables / the new profile constant / a re-export consumer.
- **Assumes:** `sentryFailureFingerprint`'s branch on `park` vs `issue-outcome` can read `P.sentry.failure.park_type` / `.outcome_type` without changing the fingerprint strings it builds. **Validation:** confirmed the fingerprint-string format is unchanged for delivery inputs (the full `node --test` suite, incl. sentry's fingerprint assertions, passes byte-identical).
- **Assumes:** the `regions selftest` bijection (`REGION_MAP ↔ COMMANDS`) is the mechanism to satisfy by adding `profiles` to all three of `COMMANDS`, `REGION_MAP` (governance), and `REGION_SELFTEST_ARGV`. **Validation:** `faff regions selftest` runs green after wiring.

## 8. DONE — Definition of Done

### From WHY / principles
- [x] With no override, `runcheck`/`events`/`sentry` behave byte-identically: the three external test files and all inline selftests pass **unchanged** (full `node --test` suite: 1727/1727 green).
- [x] No governance vocabulary change is introduced (runcheck still rejects `claimed-by-peer`; events still accepts it on `issue-outcome`).

### From WHAT (profile shape + delivery profile)
- [x] A single `DELIVERY_PROFILE` constant exists in a new `governance-profile.js` module (region-tagged `governance`), carrying `terminal_states` (6), `event_phases`, `event_types`, `issue_scoped_types`, `outcome_required_types` (`["issue-outcome"]`), `ledger_outcomes` (7), and the `sentry` sub-table (thresholds + thrash + failure roles) — each field equal to today's literal.
- [x] `sentry.thresholds.stall_window_secs` references `RUN_HEARTBEAT_STALE_SECS_DEFAULT` (one source for 900, relocated to `shared-infra.js` to avoid a require cycle — see §6).
- [x] `validateProfileShape(p)` accepts only shape-valid profiles (leaves ∈ string / finite number / array-of-strings / flat object) and rejects any conditional/nested-policy shape, naming the offending leaf.

### From HOW (engines read the profile)
- [x] `auditLedger`, `eventViolations`, and the sentry predicates (`evalThrash`, `evalRepeatedFailure`, `sentryFailureFingerprint`, `evaluateDerailment`, `sentryThresholds`, `sentryInflightMembers`, `evalMemberStall`) take the active profile as a trailing defaulted parameter and read all state/type/outcome vocabulary + thresholds from it.
- [x] `outcome_required_types` membership replaces the inline `obj.type === "issue-outcome"` conditional at the events validator.
- [x] Zero delivery-vocabulary state/type/outcome **string literals** survive inside the three engines' validator/predicate function bodies (the profile constant + selftest fixture tables allowlisted).
- [x] `activeProfile(env)` returns `DELIVERY_PROFILE` when `$FAFF_GOVERNANCE_PROFILE` is unset, else loads+shape-validates the file; an unreadable/invalid override throws a `GovernanceProfileError`, caught at `bin/faff`'s dispatch boundary and converted to a loud exit 2 with **no** delivery fallback.

### From WHAT (the `profiles` subcommand)
- [x] `faff profiles list [--json]` prints the active profile; `faff profiles validate [--file F]` exits 0/1/2 per shape validity; `faff profiles --selftest` drives all three engines under both `DELIVERY_PROFILE` and `SECOND_PROFILE`.
- [x] `profiles` is registered in `COMMANDS`, `REGION_MAP` (`"governance"`), and `REGION_SELFTEST_ARGV`; `faff regions selftest` stays exit 0 (bijection preserved).

### From HOW (dialect-independence proof)
- [x] A synthetic `SECOND_PROFILE` (disjoint states/types/thresholds) drives each engine: a delivery-vocabulary fixture is rejected, a `SECOND_PROFILE` fixture accepted, and sentry thrash trips at `SECOND_PROFILE`'s `thrash_n` — asserted in `faff profiles --selftest` (governance-profile.js) and `test/profiles.test.mjs`.

### From HOW (edge cases)
- [x] `faff profiles validate` on an object-of-objects profile exits non-zero naming the leaf.
- [x] A missing/shape-invalid `$FAFF_GOVERNANCE_PROFILE` file causes a loud exit 2 (covered by `test/profiles.test.mjs`).

**Integration smoke test:**

```
1. FAFF_GOVERNANCE_PROFILE unset → `faff events validate` on a fixture with type "issue-outcome", outcome "shipped" → 0 violations (delivery active).
2. FAFF_GOVERNANCE_PROFILE=<second-profile.json> → the same delivery fixture (phase "run", type "run-start") → violation "not in Phase" (second profile has no such phase) → proves the engine read the override.
3. `faff profiles --selftest` and `faff regions selftest` both exit 0.
4. `node --test` (all governance test files, incl. the new test/profiles.test.mjs) green, unchanged.
```

confidence: high

---

**Methodology:** faffter-dark-methodology-agile-delivery

## Methodology critique

**Right-sized? (principle 4)** — Right-sized, with a note. At ~2–3 days across three engines this sits at the upper edge of the band, but it's correctly kept whole: the profile constant and all three consumers must land together, because byte-identical behaviour and the SECOND_PROFILE behavioural proof only hold once every engine reads the shared table — a half-wired profile is worse than none. *What to do:* keep it one ticket, but stage the build internally (profile constant + validator → repoint one engine + run its tests → the other two → the `profiles` subcommand + fixture) so a threading mistake surfaces on the first engine, not all three.

**Workstream fit? (principles 1 + 5)** — One mild observation. It sits project-less in Backlog (correct default), but it's rung 3 of a multi-rung extraction (`design/governance-extraction-layers.md`) whose siblings are already ticketed (e.g. FAFF-363 = rung 5). Those rungs share one outcome — "the governance layer becomes reusable outside faff" — with no container, so the rung sequence isn't legible from the tracker. *What to do:* nothing blocking; when the extraction becomes active work, consider grouping the rungs into an outcome-led project via `/faff-plot` or `/faff-tidy`. Don't conjure the container at prep time.

**Deps surfaced? (principle 6)** — No issues. Rung 3 mirrors the already-shipped region-map single-sourcing pattern and is self-contained — not `blockedBy` rungs 1/2/5 — and the spec defers rung 4 and budget/economics to OUT OF SCOPE rather than smuggling them in. The empty `blockedBy` is honest.

**Risk profile? (principle 7)** — No issues; well-managed. A large behaviour-preserving refactor of the safety-critical interlock layer, where the real risk is a *silent* behaviour change from a missed literal. The spec de-risks exactly that: the byte-identical invariant, the disjoint SECOND_PROFILE that misbehaves iff a literal survived, and a Failure Modes section naming the precise observable. That is the early-de-risking this principle asks for.
