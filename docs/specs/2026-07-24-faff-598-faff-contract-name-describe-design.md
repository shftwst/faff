# FAFF-598 — `faff contract <name> --describe`: contract prose generated from contract-defs + schemas; gateway sections become pointers

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-598.

This spec addresses FAFF-598. It is written for the build agent implementing the change and for human reviewers checking the approach. It designs a read-only documentation surface on the existing `faff contract` dispatcher, the shrink of the gateway's per-contract prose to pointers at that surface, and the lint that keeps the duplication from growing back.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the CLI already owns the *validation* of every fixed contract — the enum arrays in `contract-defs.js` are what `faff contract <name>` actually branches on. If the human-readable description of each contract is *generated from those same arrays*, the described enum and the validated enum cannot drift apart, because they are one value. Everything else in this spec is plumbing around that identity.

**Problem statement.** The fixed-contract prose (verdict enums and their semantics, coercion directions, envelope shapes) lives in the gateway (`plugin/skills/faff/SKILL.md` → Core contracts) *and* as non-normative recaps in occupant skills — and the copies drift: FAFF-582 caught the shipped default reviewer teaching a three-verdict contract against a four-value enum. Every faff session also pays ~25KB of always-loaded gateway prose to carry semantics the CLI could print on demand. This change makes the CLI the single prose home (`faff contract <name> --describe`), shrinks the gateway sections to pointers, and adds a lint so restated enums become a CI failure instead of a latent drift.

**Design principles:**

**Description-by-reference, never by copy.** Wherever a described value participates in validation, the description entry must reference the validation constant (the same array object), never restate the values as literals. An implementation that hand-copies `["approve", "revise", ...]` into a description string is invalid even if the copy is currently correct — the whole point is structural impossibility of drift, not present-tense correctness.

**Shape stays in the schema, semantics move to the describe entry, pipeline wiring stays in prose.** Three layers, three homes: `contracts/*.schema.json` remains shape-normative (unchanged); per-value meaning, coercion direction, and producer-emits notes live in the new describe data; who-parses-what orchestration (consumer-folds, live-thread reconciliation, the spec dialect a producer must *write*) remains skill prose. The shrink removes only the middle layer from the gateway — it must not delete pipeline wiring.

**Read-only and dependency-free.** `--describe` performs no validation, reads no stdin, writes no files, and adds no dependencies — it renders from data already in the process (the CONTRACTS map + the on-disk schema the engine already loads).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node (CommonJS) | The dispatcher (`cmdContract`), the `CONTRACTS` map (22 entries, each `run` + `fixtures`), the validation enum consts, `contractSelftest`. The describe data and renderer land here. |
| `plugin/skills/faff/bin/lib/contract-engine.js` | Node | `schemaCheck` already resolves + loads `contracts/<name>.schema.json`; the envelope renderer reuses this loading path. |
| `plugin/skills/faff/contracts/*.schema.json` | JSON Schema subset | Shape-normative source for the envelope section of the rendered description. Unchanged by this ticket. |
| `plugin/skills/faff/bin/lib/argv.js` | Node | The FAFF-576 fail-closed argv parser; `CONTRACT_SPEC` gains two arity-0 flags. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node | Lint host (CI via `.github/workflows/validate.yml`); gains the no-inline-enum-restatement check. |
| `plugin/skills/faff/SKILL.md` → Core contracts | prose | The five per-contract sections that shrink to pointers, plus scattered full-enum restatements elsewhere in the gateway. |
| Occupant `SKILL.md`s (`faffter-noon-review`, `faffter-noon-spec-review`, `faffter-dark-spec-review`, `faffter-dark-adversarial-review`, `faffter-noon-ship`, …) | prose | Carry non-normative enum recaps; recaps are replaced by the pointer. |
| `docs/guide/cli.md` | prose | The CLI doc table (`lint-cli-doc`-guarded at the base-command grain); the `contract` row's flag documentation is updated. |

**Scope statement:** this is the enabling slice for FAFF-607's gateway kernel/reference split — it moves per-contract semantics out of the always-loaded prose surface into the on-demand CLI, and hardens the boundary with a lint; FAFF-607 then restructures what remains.

## 2. OUT OF SCOPE

- **FAFF-607's kernel/reference split** — why: it consumes this ticket's pointer form; doing both here doubles the review surface. Extension point: the shrunk Core-contracts sections in `plugin/skills/faff/SKILL.md`.
- **Lowering the gateway line-cap override** (`SKILL_LINE_CAP_OVERRIDE.faff = 1120` in `validate-adapters.js`) — why: FAFF-607 explicitly owns the "downward ratchets"; ratcheting here would couple the two PRs. Extension point: the override map entry.
- **Descriptor blocks with no dispatcher entry** (`infra-profile`, `intake-record`, `label-op`) — why: the gateway classes them as trusted CLI emissions validated (if at all) by their own commands, not `faff contract` entries; `--describe` covers dispatcher-known contracts only. Extension point: their own commands (`faff profile validate`, `faff intake-record`, `faff label`) could grow a `--describe` later on the same pattern.
- **Changing any validation behaviour, enum value, exit code, or schema** — why: this ticket is documentation-of-what-is; a behaviour change would invalidate the "generated from the validators" trust claim. Extension point: validation changes flow into descriptions automatically by reference.
- **A suppression/allowlist mechanism for the new lint** — why: precision is designed in via the per-value-group `lintable` flag (see HOW); a free-form suppression comment would let the drift class back in. Extension point: the `lintable` flag on the describe value-group.
- **Describing severity/appetite gate meanings** (e.g. high/medium/low promotion behaviour) — why: gate semantics live upstream in skills by design ("this script encodes NO gate meanings", contract-defs header); describing them from the CLI would move pipeline policy into the wrong layer. Extension point: gateway/skill prose, as today.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| dispatcher-known contract | A key of the `CONTRACTS` map in `contract-defs.js` (22 today: `integrity-floor`, `spec-readiness`, `review-verdict`, `delivery-outcome`, `automation-routing`, `quality-gates`, `post-merge-verification`, `ci-triage`, `prd-readiness`, `prdr-admission`, `adr-admission`, `l4-topology-envelope`, `prdr-yagni`, `prd-coverage`, `prd-distance`, `spec-review-verdict`, `architecture-proposal`, `env-handle`, `holdout-verdict`, `lane-boundary`, `run-termination`, `run-trigger`). |
| value group | One described enum-valued field of a contract (e.g. `verdict` on `spec-review-verdict`), binding the validation constant to per-value semantics. |
| inline enum restatement | All values of a lintable value group's enum appearing together in a skill's `SKILL.md` within a two-line window. |

**Type definitions** (pseudocode; lives beside the `CONTRACTS` map):

```
RECORD ContractDescription:
  purpose: String                    # one sentence; the index line and the H1 gloss
  values: List<ValueGroup>           # may be empty (a contract with no enum fields)
  coercions: List<String>            # authored fail-direction statements, e.g.
                                     #   "unknown signal coerces to needs-human, never pass"
                                     #   "non-object extraction → fail-loud (exit 2)"
  producer_notes: List<String>       # optional emits-subset rationale, e.g. review's
                                     #   "the producer never self-reports unavailable —
                                     #    it is the orchestrator's outage signal (FAFF-405)";
                                     #   empty list when none

RECORD ValueGroup:
  field: String                      # the contract-data field, e.g. "verdict", "objections[].lens"
  enum: List<String>                 # BY REFERENCE the validation const (SPEC_REVIEW_VERDICTS, …)
                                     #   — never a fresh literal array
  semantics: Map<String, String>     # value → one-line meaning; keys MUST equal enum exactly
  lintable: Boolean                  # participates in the no-inline-enum-restatement check
                                     #   (default true; see HOW for the false cases)

  CONSTRAINT keys(semantics) == set(enum)   # enforced by selftest, both directions
```

**CLI surface** (the only interface change):

```
faff contract <name> --describe            # markdown description to stdout, exit 0
faff contract <name> --describe --json     # the ContractDescription + envelope as JSON, exit 0
faff contract --describe                   # index: one "name — purpose" line per contract, exit 0
```

`CONTRACT_SPEC` (the FAFF-576 parser spec) gains `"--describe": { arity: 0 }` and `"--json": { arity: 0 }`. Fail-closed combinations: `--json` without `--describe` → usage error (exit 2); `--in` together with `--describe` → usage error (exit 2, describe takes no input); `--selftest` retains its existing first-checked precedence. Unknown `<name>` with `--describe` → exit 2 naming the known set (same message shape as the validation path).

**Rendered markdown sections**, in order (a section with nothing to say is omitted):

1. `# faff contract <name>` + the purpose line.
2. `## Values` — per value group: the field name, the enum (rendered from the referenced array), and a table of value → semantics.
3. `## Coercion & fail direction` — the `coercions` list, plus the fixed exit-code map (0 conformant / 1 violations / 2 fail-loud) stated once.
4. `## Envelope` — required fields, types, and any schema-level enums, rendered from the on-disk `contracts/<name>.schema.json` (loaded via the same resolution `schemaCheck` uses). A missing/unparseable schema renders an explicit `envelope unavailable: <reason>` line and still exits 0 — describe is documentation, not validation.
5. `## Producer notes` — the `producer_notes` list.

**Design decisions:**

Where the description data lives — contract-defs `describe` entries vs schema `description` fields vs a new module:

**Chosen:** a `describe: ContractDescription` entry on each `CONTRACTS` map entry in `contract-defs.js`, with envelopes rendered from the on-disk schema. Rationale: the enum consts are in this module's scope, so by-reference binding is natural; the selftest is co-located; schemas stay shape-only (and *cannot* be the single source anyway — e.g. spec-review lens/severity enums are deliberately enforced in the compute fn via violations, not the schema). Schema JSON `description` strings would put authored prose in a format with no by-reference mechanism.

Index behaviour for an unnamed `--describe`:

**Chosen:** print the index (name + purpose per contract). Rationale: mirrors the existing unnamed `--selftest` convention (runs all), and gives the gateway pointer a discoverable entry (`faff contract --describe` answers "what contracts exist?").

Where the selftest coverage check runs:

**Chosen:** inside `contractSelftest`, per contract — each named `faff contract <name> --selftest` run checks that contract's description (exists; every value group's `semantics` keys equal its `enum` exactly, both directions; `purpose` non-empty), and the unnamed run therefore checks all. Rationale: CI already runs per-name selftests in `validate.yml`, so gating is inherited with zero workflow edits; a description gap fails the same table that a fixture regression fails.

## 4. HOW — Behavior

**Architecture and approach.** Two independent halves meet at the describe data: (a) the CLI half — describe entries + renderer + selftest coverage; (b) the prose half — gateway/occupant shrink + the validate-adapters lint that keeps it shrunk. The lint half `require`s the describe data from `contract-defs.js` (both live in `bin/lib/`), so the lintable enum sets also flow from the validation consts by reference.

**Dispatch** (modifying `cmdContract` only at the top; the validation path is untouched):

```
PROCEDURE cmdContract(args):
  1. parseArgs(args, CONTRACT_SPEC); errors → usage exit 2        # unchanged
  2. IF --selftest: contractSelftest(name)                        # unchanged, keeps precedence
  3. IF --describe:
     a. IF --in given → usage error, exit 2
     b. IF no name → print index (each CONTRACTS key + describe.purpose), exit 0
     c. IF name unknown → stderr naming known set, exit 2
     d. render (markdown, or JSON when --json) from CONTRACTS[name].describe
        + schema envelope; write to stdout; exit 0
        # NOTE: reaches no fs.readFileSync(0) — describe must never touch stdin
  4. IF --json (without --describe) → usage error, exit 2
  5. …existing validation path, unchanged
```

**Selftest additions** (inside the per-contract fixture loop's contract iteration):

```
PROCEDURE describeChecks(name, entry):
  1. entry.describe present, purpose a non-empty string      → else FAIL row
  2. FOR each value group g:
     a. g.enum is a non-empty array of strings
     b. keys(g.semantics) ⊇ g.enum  → a value with no semantics line is FAIL
     c. keys(g.semantics) ⊆ g.enum  → a semantics key outside the enum is FAIL
  3. rendered markdown for name contains every value of every g.enum verbatim
     (the acceptance-sketch check: output enumerates the exact validation enum)
  4. --describe --json output round-trips through JSON.parse
```

Each check reports as a normal selftest row (`ok`/`FAIL name/describe-…`), so the existing CI steps and the `RESULT:` summary pick them up unchanged.

**The gateway shrink.** Each of the five Core-contracts sections — `Review verdict (fixed)`, `Spec-review verdict (fixed)`, `Delivery outcome (fixed)`, `Automation-routing verdict (fixed)`, `Spec readiness (fixed)` — reduces to:

1. the heading + one-line purpose (that the vocabulary is closed and fixed here, and the section is the contract's identity anchor);
2. the pointer line: `Canonical semantics: faff contract <name> --describe`;
3. **retained**: the prose that is pipeline wiring, not per-contract semantics — the consumer-fold paragraphs (who locates which block, pipes it where, the absent-block fallback), `Live-thread reconciliation` (automation-routing), the integrity-floor two-tier-gate / CI-green / precondition routing prose (delivery-outcome), and the spec *dialect* (spec-readiness: decision markers, punt-ownership extraction, confidence line, provenance stamp, writing style) — producers must *write* that dialect, so it stays in the prose layer FAFF-607 will relocate, not in `--describe`.

What moves out: enum value lists with per-value meanings, coercion-direction sentences ("malformed → needs-human, never pass"), envelope shape recaps (`{ "signal": …, "findings": … }`), and producer-emits-subset notes — each becomes describe data. A sentence that is *both* (names an enum value while stating wiring) keeps the wiring clause and drops the value enumeration.

**Beyond the five sections**, sweep the gateway and occupant `SKILL.md`s for full-enum restatements by running the new lint and rewording every hit (e.g. the gateway autonomous-summary row "review (pass/fail/needs-human/unavailable)" → "review (the closed review-verdict vocabulary)"; occupant recap paragraphs → the pointer line). Occupants keep their own reasoning (the spec-review roll-up procedure, lens tables) and their example emission blocks — single values are not restatements.

**The lint** (`validate-adapters.js`, new check alongside the FAFF-120 charter subset):

```
PROCEDURE lintInlineEnumRestatement(skillText):
  1. lintSets = for each CONTRACTS entry, for each value group with
     lintable == true AND len(enum) >= 3 → the enum value set
     (deduplicated across contracts sharing an identical set)
  2. FOR each pair of adjacent lines (window = 2) in skillText:
     IF every value of some lintSet appears in the window as a distinct
     token (backtick-stripped, word-boundary match):
       → finding "inline enum restatement of <contract>.<field> — point at
          `faff contract <contract> --describe` instead"
  3. findings surface per skill like every other validate-adapters failure
```

Precision safeguards, in the data not the matcher: the `spec-readiness` marker group (`chosen`/`punt`/`assumes`) is `lintable: false` — producers legitimately restate the dialect they must write (the nlspec producer's instructions, prep's marker rules). Any future group whose values are producer-authored vocabulary rather than validator-owned verdicts follows the same flag. The ≥3 floor keeps two-value sets (too generic) out. The window-of-2 + full-set rule means single-value mentions, examples, and partial references never fire.

**`docs/guide/cli.md`:** update the `contract` row's flag column with `--describe [--json]`. `lint-cli-doc` diffs at the base-command grain, so this is doc honesty, not a lint requirement.

**Edge cases and error handling:**

- `--describe` on a tty with no piped stdin: must not block — the describe branch returns before any `fs.readFileSync(0)`.
- Contract with an empty `values` list (possible for pure-derivation contracts): render purpose + coercion + envelope; the `## Values` section is omitted; selftest checks 1/3/4 still apply.
- Schema file missing or unparseable at describe time: `envelope unavailable: <reason>` in the output, exit 0 (deterministic; the selftest and the validation path's own `schemaCheck` are where a missing schema is a hard failure).
- Two contracts sharing one enum array (e.g. floor verdicts reusing review values): the lint dedupes identical sets and names any one owner in the finding — the remedy line is identical either way.
- `--describe` combined with `--require-spawner-attested`: ignored (that flag only arms the holdout validation path); no error — it parses, the describe branch simply never consults it.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The lint over-fires on legitimate prose** (a skill needs to name several verdict values in one breath for a real reason). How you'd know: `validate-adapters` failing on a PR whose diff never touched contract prose. What it means: narrow — flip that value group's `lintable` to false with a comment, or reword; if it recurs across unrelated groups, revisit the window/floor parameters. Never add a free-form suppression.
- **The residual authored prose (semantics one-liners, coercions) drifts from behaviour** — by-reference binding protects enum *membership*, not the truth of an authored sentence. How you'd know: selftest can't catch it; review of PRs that change a compute fn must touch the sibling describe entry. What it means: accepted residual (strictly smaller than today's whole-paragraph drift class); the FAFF-582 arity class specifically is closed by check 3.
- **The gateway shrink deletes load-bearing wiring** (a consumer-fold sentence read by a sub-skill at runtime). How you'd know: `lint-refs` failures on dangling references, or a downstream skill mis-routing in the next beep-boop run. What it means: the shrink rule above misclassified a sentence — restore it; the retained-list in HOW is the review checklist for exactly this.

## Scenarios

```
Given any dispatcher-known contract name N
When `faff contract N --describe` runs
Then stdout enumerates, verbatim, every value of every described enum of N
  (equal to the validation enum by reference), and the exit code is 0
```

```
Given `faff contract spec-review-verdict --describe --json`
When the output is JSON.parsed
Then it yields the ContractDescription (purpose, values with field/enum/semantics,
  coercions, producer_notes) plus the envelope, with semantics keys exactly
  matching the enum
```

```
Given a describe entry mutated in a test copy so one enum value lacks a
  semantics key
When `faff contract <name> --selftest` runs
Then the run reports a FAIL row and exits 1
```

```
Given the gateway and occupant SKILL.md files after the shrink
When `faff validate-adapters` runs
Then it reports zero inline-enum-restatement findings and still passes every
  pre-existing check
```

```
Given a SKILL.md line reintroducing all four spec-review verdicts in one sentence
When `faff validate-adapters` runs
Then it fails, naming the contract, the field, and the --describe pointer remedy
```

- `faff contract --describe` (unnamed) MUST list all 22 dispatcher-known contracts, one line each, exit 0.
- `faff contract N --describe` MUST complete without reading stdin (no hang with a tty stdin).
- `faff contract N --json` (without `--describe`) and `faff contract N --describe --in file` MUST exit 2 with a usage message.
- The validation path (`faff contract N` with stdin extraction) MUST be byte-identical to today for every golden case in `test/golden/contracts/cases.json`.

## 6. DESIGN DECISION RATIONALE

**Where does the canonical description live?** Options: (a) `describe` entries on the CONTRACTS map — pro: by-reference enum binding, co-located selftest; con: contract-defs.js grows (~mitigated: it is already the contract home, and regions keep it navigable). (b) schema `description` fields — pro: one file per contract; con: no by-reference mechanism in JSON, and some enforced enums aren't in the schema at all. (c) new `contract-describe.js` module — pro: file-size hygiene; con: splits each contract's identity across modules and still needs every enum imported. **Chosen:** (a), with the envelope rendered from the schema — the schema stays the shape authority, so nothing is copied into the describe entry that already has a machine home. (b)'s absent-enum problem is disqualifying, not just inconvenient.

**Selftest placement?** Options: a separate `--describe --selftest` mode vs folding into `contractSelftest`. **Chosen:** fold in — CI's existing per-name selftest steps then gate descriptions with zero workflow edits; a separate mode would be one more thing to wire and forget.

**Lint precision strategy?** Options: matcher-side heuristics (skip code fences, allowlists) vs data-side scoping (`lintable` flag + ≥3 floor + full-set window). **Chosen:** data-side — the false-positive classes we can name today (the producer-written marker dialect) are properties of *the value group*, not of the consuming text, so the flag lives with the data; the matcher stays dumb and predictable. At the time of writing the only `lintable: false` group is the spec-readiness marker set.

**Unnamed `--describe` = index.** Options: usage error vs index. **Chosen:** index, mirroring unnamed `--selftest`; the discoverability is what makes the gateway pointer ergonomic.

**Keep the spec dialect in prose.** Options: move the marker/stamp/style dialect into `faff contract spec-readiness --describe` vs retain in the gateway. **Chosen:** retain — the dialect instructs *writing* a spec (producer-facing), not *interpreting* contract data (consumer-facing); `--describe` documents the latter. Moving it would also gut the Spec-readiness section FAFF-607 plans to relocate wholesale.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every decision above carries a `**Chosen:**` marker.

**Assumptions:**

- **Assumes:** the FAFF-576 fail-closed argv parser (`bin/lib/argv.js` `parseArgs`) exists and `CONTRACT_SPEC` is its live spec for `faff contract`. Validation: confirmed at explore time (`contract-defs.js` line 17); build agent re-checks before extending.
- **Assumes:** `.github/workflows/validate.yml` runs `faff validate-adapters` and per-name `faff contract <name> --selftest` steps on PR/push. Validation: confirmed at explore time; three contracts (`adr-admission`, `prd-distance`, `lane-boundary`) may lack a per-name step — build agent verifies each of the 22 is covered by at least one step and adds missing per-name steps in the same PR.
- **Assumes:** `test/contract-golden.test.mjs` exercises only the stdin-validation path. Validation: confirmed at explore time (spawns `faff contract <name>` with `input:`); goldens therefore prove the validation path is untouched.

## 8. DONE — Definition of Done

### From WHY
- [ ] The described enum for every dispatcher-known contract is the validation enum by reference — no literal enum copy exists in any describe entry (code review assertion + selftest check 3).

### From WHAT (CLI surface)
- [ ] `faff contract <name> --describe` prints the markdown sections (purpose, values, coercion & fail direction, envelope, producer notes) for each of the 22 contracts, exit 0.
- [ ] `faff contract <name> --describe --json` prints JSON that parses and whose `values[*].semantics` keys equal the enum exactly.
- [ ] `faff contract --describe` prints the 22-line index, exit 0.
- [ ] `--json` without `--describe` → exit 2 usage; `--describe --in F` → exit 2 usage; `--selftest` precedence unchanged.
- [ ] The describe branch reads no stdin (manual check: runs to completion with a tty stdin).

### From WHAT (describe data)
- [ ] Every CONTRACTS entry carries `describe` with a non-empty `purpose`.
- [ ] `review-verdict`'s `producer_notes` records the emits-subset rationale (producer never self-reports `unavailable`) — the FAFF-582 class, now machine-homed.
- [ ] The `spec-readiness` marker value group is `lintable: false`; all other groups default true.

### From HOW (selftest)
- [ ] `faff contract <name> --selftest` fails (exit 1, FAIL row) when: describe absent, purpose empty, a semantics key missing for an enum value, a semantics key outside the enum, or the rendered output missing an enum value verbatim.
- [ ] Unnamed `faff contract --selftest` runs the describe checks for all 22 and stays green on the shipped data.

### From HOW (prose shrink + lint)
- [ ] The five gateway Core-contracts sections each contain the pointer line `faff contract <name> --describe` and no full enum-with-semantics restatement; consumer-fold, live-thread-reconciliation, integrity-floor-gate, and spec-dialect prose are retained.
- [ ] Occupant recaps (`faffter-noon-review`, `faffter-noon-spec-review`, `faffter-dark-spec-review`, `faffter-dark-adversarial-review`, and any other lint hit) are replaced by the pointer; their own reasoning sections and example blocks are unchanged.
- [ ] `faff validate-adapters` gains the inline-enum-restatement check (window 2, full set, ≥3 values, lintable-only) and reports zero findings on the post-change tree.
- [ ] A regression fixture proves the lint fires: a synthetic skill text restating the four spec-review verdicts produces a finding naming the contract and the remedy.
- [ ] `docs/guide/cli.md` `contract` row documents `--describe [--json]`; `faff lint-cli-doc` stays green.

### From HOW (no behaviour change)
- [ ] All existing contract golden tests pass unmodified (`test/contract-golden.test.mjs`).
- [ ] All pre-existing validate-adapters checks pass on the post-change tree.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (describe is deterministic rendering; the lint is deterministic matching) — no grader/eval registration required.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. out = run(`faff contract spec-review-verdict --describe`)
  2. ASSERT exit 0 AND out contains each of the four verdict values
     and each of the four lens values verbatim
  3. run(`faff contract --selftest`) → ASSERT RESULT: PASS
  4. run(`faff validate-adapters`)   → ASSERT exit 0
  5. echo '{"verdict":"approve","objections":[]}' | faff contract spec-review-verdict
     → ASSERT exit 0 (validation path untouched)
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
