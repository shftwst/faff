# FAFF-280 — Judgement-seam declaration + shared seam→KIND registry

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high. Full spec on Linear FAFF-280.

This spec is the design for the foundation layer of a *lintable eval-coverage gate*: a machine-readable contract that connects each LLM-judgement-bearing faff skill to the grader `KIND`(s) that test it. Audience: the build agent implementing the registry + declaration marker, and human reviewers checking that the seeded mapping starts truthful. It is the prerequisite for FAFF-281 (the gate that *enforces* coverage); FAFF-280 builds the mechanism and seeds it, FAFF-281 turns it into a CI failure on an uncovered seam.

## 1. WHY — Problem and Principles

**The load-bearing model:** a *judgement seam* is any point where a faff skill defers to the LLM for a classification, rating, ordering, or verdict — and every such seam is supposed to have a grader `KIND` in `eval/grader.mjs` that measures its flakiness. Today the link from seam → KIND lives only in prose, README cross-references, and human memory. There is no artifact a tool can read to ask *"this judgement-bearing skill — does it have eval coverage?"*. This spec adds that artifact.

**Problem statement.** `eval/grader.mjs` holds an 18-entry `KINDS` enum, and `eval/cases/*.json` holds graded fixtures, but nothing declares *which skill's judgement each KIND backs*, and nothing lets a skill declare *"I have a judgement seam"*. The pain: a skill can ship a brand-new LLM-judgement surface with zero eval coverage and nothing notices — which is exactly how the whole post-FAFF-265 family (spec-review, evaluator, architecture, env, adr) slipped the net. This change makes "judgement seam without coverage" a *detectable* condition by giving the seam→KIND mapping a single machine-readable home.

**Design principles.**

- **One home, read by two consumers.** The seam→KIND mapping must be a single source of truth that *both* `eval/grader.mjs` and `faff validate-adapters` read — never two hand-synced copies that can drift (the same "single source of truth" discipline ADR-0014 applies to the CLI subcommand set).
- **Declaration is local; the index is central.** A skill declares *its own* seam where the skill lives (its `SKILL.md` frontmatter, beside `name`/`description`/`user-invocable`); the registry is the central index the consumers query. These are distinct roles, not duplicated content (see §3 / §6).
- **Truthful by construction at seed time.** The registry ships seeded with the already-covered surfaces, so it is correct on day one and the backfill tickets only *add* rows — they never have to correct a wrong baseline.
- **Foundation only — no enforcement here.** FAFF-280 establishes the marker, the registry, the seed, and a *consistency* reconciliation. The *coverage gate* (declared-but-uncovered → CI fail) and the skill-authoring DoD rule are FAFF-281. Drawing this line keeps FAFF-280 a single right-sized unit.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | Node ESM | Holds `export const KINDS = [...]` (18) + `CLOSED_SET_KINDS`; one consumer of the registry |
| `eval/cases/*.json` | JSON | Per-kind graded fixtures; `cases_present` per KIND is derivable from these |
| `eval/README.md` | Markdown | Documents the seam→KIND mapping today **in prose only** — this spec mechanizes it |
| `plugin/skills/faff/bin/faff` (`validate-adapters`, ~L2838–3290) | Node | Reads each `SKILL.md` frontmatter (regex), holds a `REGISTRY`/`SLOT_TYPES` map, runs `checksFor()`; second consumer of the registry |
| `plugin/skills/*/SKILL.md` frontmatter | YAML | Today carries `name`, `description`, optional `user-invocable: false`; gains the new `judgement_seam:` key |

**Scope statement.** This sits at the eval-harness ↔ skill-metadata boundary: it is the contract layer that lets the lint (FAFF-281) and the grader agree on what a "covered judgement seam" is.

## 2. OUT OF SCOPE

- **The coverage-enforcement gate** — *Why excluded:* declared-but-uncovered → CI failure, plus the DoD / skill-authoring-standard rule, is the sibling FAFF-281 (which this blocks). *Extension point:* FAFF-281 adds the gate to `validate-adapters` reading this registry.
- **Backfilling missing eval cases** — *Why excluded:* writing new cases for the uncovered seams (spec-review, evaluator, architecture, env, adr, adversarial) is FAFF-282–286. *Extension point:* those tickets add rows + cases; the registry's `status` field already accommodates an as-yet-uncovered seam.
- **Deriving `KINDS` *from* the registry** — *Why excluded:* making the registry the generative source of the grader enum is a larger refactor with test-surface risk; v1 keeps the enum executable in `grader.mjs` and *asserts equality* instead. *Extension point:* §4 names where a later ticket could flip the direction.
- **Auto-detecting an undeclared seam from prose** — *Why excluded:* heuristically inferring "this skill has a judgement seam" from its SKILL.md text is unreliable; declaration is explicit. *Extension point:* FAFF-281's gate requires the declaration key be *present* on every registered slot skill, which is the structural (non-heuristic) backstop.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Judgement seam | A point where a skill defers a classification / rating / ordering / verdict to the LLM (vs a deterministic CLI computation) |
| KIND | A grader category in `eval/grader.mjs`'s `KINDS` enum — the unit of eval coverage |
| Surface | The skill (or slot) that owns a given judgement seam |
| Covered / designed | A KIND with ≥1 case in `eval/cases/` is `covered`; a registered KIND with 0 cases is `designed` (e.g. `reconciliation`, `verdict-build`) |

**The frontmatter marker.** A new optional `SKILL.md` frontmatter key, sibling to `name` / `description` / `user-invocable`:

```
RECORD JudgementSeamMarker (frontmatter key `judgement_seam:`):
  value: one of
    - a comma-separated list of kind-ids   # e.g.  judgement_seam: dupe, vague, stale, superseded, splittable, chain-gap, ordering
    - the literal token  none              # judgement_seam: none   (asserted-deterministic, no seam)
  CONSTRAINT every kind-id ∈ grader KINDS
  CONSTRAINT a list and `none` are mutually exclusive
```

**Decision — declaration locus.** `SKILL.md` frontmatter marker vs an `eval/seam-registry.json` file vs both.

- *Frontmatter only* — the grader would have to scan all `plugin/skills/*/SKILL.md`, coupling the eval harness to the skill-tree layout, and it cannot host the `designed`-but-unshipped KINDs (`reconciliation`, `verdict-build`) that have no skill yet.
- *Registry only* — nothing on the skill itself flags that it bears a seam, so the lint cannot tell an *undeclared* seam (FAFF-265's failure) from a genuinely deterministic skill.
- *Both, distinct roles* — the frontmatter is the per-skill **declaration** (local, reviewed in the same diff as the skill, and the thing FAFF-281's gate can require to be *present*); the registry is the central **index** the grader and lint query, and the only place that can carry coverage `status` + the `designed` KINDs.

**Chosen:** **both, with non-overlapping roles** — `judgement_seam:` frontmatter on each slot/skill is the local declaration; `eval/seam-registry.json` is the consolidated SSOT both consumers read; `validate-adapters` reconciles the two (§4). Rationale: only the combination raises the floor — the frontmatter makes a seam *visible and reviewable at the skill*, the registry makes it *queryable and coverage-stamped centrally*, and the reconciliation makes drift between them impossible.

**Decision — multiple seams per skill.** How a skill with several seams (e.g. tidy's seven, spec's confidence+marker) declares several KINDs.

- A YAML sequence would force array parsing into `validate-adapters`' regex frontmatter reader, and faff's own YAML-subset parser deliberately has **no array support** (list config is a JSON-string scalar) — a sequence is against the grain of every existing faff parser.
- A repeated key is non-idiomatic and regex-hostile.

**Chosen:** **a single `judgement_seam:` line carrying a comma-separated scalar** of kind-ids; the consumer splits on comma and trims. Rationale: regex-parseable on one line (matching how `validate-adapters` already reads `user-invocable:`), honours faff's no-sequences-in-frontmatter-parsers convention, and reads cleanly for the 7-kind tidy case.

**Decision — explicit no-seam.** Whether a deterministic skill declares "no seam" so the lint can distinguish *no seam* from *unguarded seam*.

**Chosen:** **yes — `judgement_seam: none` is an explicit, first-class value.** A deterministic slot skill (e.g. `faffter-noon-concurrency-sequential`, `faffter-noon-ship`) declares `none`. Rationale: this is the crux that closes the FAFF-265 gap. With an explicit `none`, the three states are distinguishable — *declared-seam* (`judgement_seam: <kinds>`), *asserted-deterministic* (`judgement_seam: none`), and *undeclared* (key absent). FAFF-281's gate can then treat *absent* on a registered slot skill as a failure ("undeclared — declare a kind or `none`"), which is what would have caught the FAFF-265 family. FAFF-280 defines and seeds the value; the *absent → fail* enforcement is FAFF-281.

**The registry file.** `eval/seam-registry.json`, keyed by KIND (the canonical axis, matching the grader's `KINDS`):

```
RECORD SeamRegistry:
  version: 1
  kinds: Map<kind-id, SeamEntry>      # one entry per grader KIND; keys == grader KINDS, exactly

RECORD SeamEntry:
  surface: string          # the skill or slot that owns this seam, e.g. "faff-tidy", "faffidavit-routing"
  status:  "covered" | "designed"   # covered = ≥1 case in eval/cases/; designed = registered, 0 cases yet
```

**Chosen:** **registry keyed by KIND, listing all 18 KINDs.** Rationale: keying by KIND makes the grader's lookup (`kind → surface`) direct and lets a startup assertion compare `Object.keys(registry.kinds)` against `KINDS` as sets; the skill→kinds view `validate-adapters` needs is the trivial inverse (group by `surface`). Listing all 18 — including the two `designed` ones — keeps the registry a complete mirror of the grader's enum, so the equality assertion is total.

**Design decision — does `grader.mjs` change behaviour?** The grader does not need the seam→surface map to *grade*; it needs the registry to stay *consistent* with its enum.

**Chosen:** **`grader.mjs` keeps `KINDS` as its executable enum and adds a fail-loud startup assertion that `set(KINDS) === set(Object.keys(registry.kinds))`.** Rationale: the registry becomes the authoritative seam→surface SSOT (which the grader did not previously hold at all), while the equality assertion guarantees the KIND axis can never drift between the two files — without the risk of re-sourcing the grader's enum from JSON in this foundation ticket (that flip is named in OUT OF SCOPE). `cases_present` is *not* stored in the registry — it is derived live from `eval/cases/` so it cannot go stale; `status` records only the coarse covered/designed intent.

## 4. HOW — Behavior

**Architecture.** Three artifacts touched: (1) `eval/seam-registry.json` — new SSOT; (2) each covered/deterministic `SKILL.md` — gains the `judgement_seam:` frontmatter line; (3) `grader.mjs` + `validate-adapters` — gain reads of the registry.

**grader.mjs — consistency assertion.** On load (or first grade), read the registry and assert the KIND axes match:

```
PROCEDURE assert_registry_consistent():
  1. registry := JSON.parse(read("eval/seam-registry.json"))
  2. registryKinds := Object.keys(registry.kinds)
  3. IF setOf(registryKinds) != setOf(KINDS):
     a. throw Error("seam-registry KINDS drift: " + symmetricDifference) # fail loud — never silently grade
  4. (no behavioural change to grading itself)
```

**validate-adapters — parse + reconcile.** Extend the existing frontmatter read (which already regex-tests `user-invocable:`) to also extract `judgement_seam:`, and add a reconciliation check to the per-skill `checksFor()` battery:

```
PROCEDURE reconcile_seam(skill, frontmatter, registry):
  1. declared := parse(frontmatter.judgement_seam)   # -> "none" | Set<kind-id>  | UNDECLARED (key absent)
  2. IF declared == UNDECLARED:
     a. return [ok: true, "judgement_seam: <absent>"]   # FAFF-280: advisory only — FAFF-281 flips absent->fail
  3. IF declared == "none":
     a. registered := { k | registry.kinds[k].surface == skill }
     b. return [ registered.isEmpty(), "declares none and owns no registered KIND" ]
  4. # declared is a Set of kind-ids
  5. unknown := { k in declared | k not in KINDS }
  6. IF unknown non-empty: return [false, "declares unknown KIND(s): " + unknown]
  7. registered := { k | registry.kinds[k].surface == skill }
  8. return [ setEqual(declared, registered), "frontmatter judgement_seam == registry surface rows" ]
```

**Behavior summary.** After this change: every covered surface's `SKILL.md` names its KIND(s); the registry is the one place that maps each of the 18 KINDs to its surface + coverage status; the grader refuses to run if its enum and the registry disagree; and `validate-adapters` flags any frontmatter declaration that disagrees with the registry. The *absent → fail* enforcement and the *uncovered → fail* gate are deliberately left at advisory/pass here for FAFF-281.

**Edge cases.**

- **Unknown kind-id in frontmatter** → `validate-adapters` fails the skill (step 6) — catches typos against the canonical `KINDS`.
- **`none` on a skill that owns a registered KIND** → fail (step 3b) — a contradiction between the declaration and the seed.
- **Designed KIND (`reconciliation`, `verdict-build`)** → present in the registry with `status: designed`; its surface skill *may* declare it in frontmatter (the reconciliation still holds set-equal) — declaring a designed seam is legitimate and intended (the surface exists, the cases don't yet).
- **Registry missing / malformed JSON** → both consumers fail loud (grader throws; `validate-adapters` reports a hard error) — never silently pass, mirroring the contract-extraction "malformed → fail-loud" convention.

**Failure modes.**

- **The failure:** the seeded surface attribution is wrong (e.g. `marker` attributed to the spec producer when the judgement really lives in prep's consumer-fold). *How you'd know:* the frontmatter↔registry reconciliation fails for that skill on first `validate-adapters` run, or a reviewer rejects the seed table. *What it means:* correct the one row — it is seed data, reviewable and cheap to move, not architecture.
- **The failure:** a skill bears a judgement seam but neither declares it nor appears in the registry — FAFF-280 cannot catch a *fully* silent seam (no declaration, no row). *How you'd know:* it surfaces only when FAFF-281 requires the key present on every registered slot skill. *What it means:* this is the named boundary between the two tickets — FAFF-280 makes declared seams consistent; FAFF-281 makes declaration mandatory. Proceed.

**Anti-pattern:** storing `cases_present`/counts in the registry. Why: counts go stale the moment a case is added; derive coverage from `eval/cases/` live and keep only coarse `status` in the registry.

## 5. SCENARIOS — born-verifiable main objectives

```
Given the seam-registry lists all 18 KINDs and grader.mjs KINDS has 18 entries
When grader.mjs loads
Then it asserts set(KINDS) == set(registry kind keys) and runs; if a KIND is added to one but not the other it throws a drift error
```

```
Given faff-tidy/SKILL.md declares `judgement_seam: dupe, vague, stale, superseded, splittable, chain-gap, ordering`
  and the registry maps those seven KINDs' surface to faff-tidy
When `faff validate-adapters` runs over faff-tidy
Then the seam reconciliation passes (declared set == registry surface rows)
```

```
Given a deterministic slot skill declares `judgement_seam: none`
  and it owns no registered KIND in the registry
When `faff validate-adapters` runs over it
Then the reconciliation passes (none + no owned KIND)
```

```
Given a SKILL.md declares `judgement_seam: dupr` (typo)
When `faff validate-adapters` runs over it
Then it fails with "declares unknown KIND(s): dupr"
```

The seed must start truthful — assertion: every KIND that has ≥1 case in `eval/cases/` is `status: covered` in the registry, and the two zero-case KINDs are `status: designed`.

## 6. DESIGN DECISION RATIONALE

**Where does a skill declare its judgement seam?** Options: frontmatter only / registry only / both. **Chosen:** both, distinct roles (local declaration + central index + reconciliation) — see §3. Rejected *frontmatter-only* (couples grader to skill layout, can't host designed KINDs) and *registry-only* (no per-skill flag, so an undeclared seam is invisible at the skill).

**How are multiple seams declared?** Options: YAML sequence / repeated key / comma scalar. **Chosen:** comma-separated scalar — see §3. Rejected the sequence (against faff's no-array-parsing convention and the regex frontmatter reader).

**Is "no seam" explicit?** **Chosen:** yes, `judgement_seam: none` — see §3. Rejected leaving it implicit (then *absent* and *deterministic* are indistinguishable, which is the exact FAFF-265 gap).

**Registry shape + does the grader change?** **Chosen:** KIND-keyed registry of all 18 entries with `surface` + `status`; grader keeps its enum and adds a fail-loud equality assertion; `cases_present` derived live, not stored. Rejected re-sourcing `KINDS` from the registry in this ticket (larger, riskier — named in OUT OF SCOPE). At the time of writing, `grader.mjs` holds `KINDS` as a literal array (`grader.mjs:94`) and a downstream ticket could flip the direction later.

**Seed mapping (the truthful baseline).** All 18 KINDs → surface + status:

| KIND | Surface (skill / slot) | Status |
|---|---|---|
| dupe | faff-tidy | covered |
| vague | faff-tidy | covered |
| stale | faff-tidy | covered |
| superseded | faff-tidy | covered |
| splittable | faff-tidy | covered |
| chain-gap | faff-tidy | covered |
| ordering | faffter-noon-methodology-structural (`methodology` pick-ordering) | covered |
| gloss | faffidavit-rendering | covered |
| explanatory-order | faffidavit-rendering | covered |
| routing | faffidavit-routing | covered |
| confidence | faffter-noon-spec (`spec` producer self-rating) | covered |
| marker | faffter-noon-spec (`spec` producer decision markers) | covered |
| reconciliation | faff-prep (Scenario-B comment reconciliation) | designed |
| modedetect | faffter-noon-intake (jot/intake) | covered |
| shaping | faff-jot (ticket-shaping) | covered |
| decomposition | faff-plot (tree decomposition) | covered |
| verdict-revert | faffter-noon-review | covered |
| verdict-build | faffter-noon-review (whole-change verdict) | designed |

**Punt:** the precise surface attribution of `confidence`/`marker` (spec producer `faffter-noon-spec`) vs `reconciliation` (consumer `faff-prep`) — needs human confirmation. The build should seed exactly as tabled above; a reviewer reassigning a row is a one-line registry + frontmatter edit, not a redesign. This is the only genuinely judgement-laden cell in the seed and is surfaced for the human rather than asserted as closed.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** Confirm the `confidence`/`marker` → `faffter-noon-spec` vs `faff-prep` attribution, and `reconciliation` → `faff-prep`. Context: the spec producer *writes* the markers + confidence rating (judgement), while prep's gate consumes them deterministically via `faff contract spec-readiness` — so the seam is the producer's. `reconciliation` (KIND for spec-vs-post-comment) maps to prep's Scenario-B challenge/resolution/context classification, which *is* an LLM judgement. The table reflects this reading; a human may move a row.

**Assumptions.**

- **Assumes:** `eval/grader.mjs` exports `KINDS` as a literal array of exactly the 18 ids (verified at `grader.mjs:94`). *Validate:* `grep -n "export const KINDS" eval/grader.mjs` before wiring the assertion.
- **Assumes:** `validate-adapters` already extracts `SKILL.md` frontmatter via regex and can be extended to read one more key (the `user-invocable:` precedent at ~`bin/faff:2898`). *Validate:* locate the frontmatter regex block in `bin/faff` and add the `judgement_seam:` extraction beside it.
- **Assumes:** each `KIND` with ≥1 file in `eval/cases/` is `covered`; the zero-case KINDs are exactly `reconciliation` and `verdict-build`. *Validate:* `for k in $(...KINDS); do ls eval/cases/${k}-*.json; done` to confirm the covered/designed split before seeding `status`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A single machine-readable artifact maps each judgement-bearing surface → its grader KIND(s), read by both `grader.mjs` and `validate-adapters`.

### From WHAT (registry)
- [ ] `eval/seam-registry.json` exists with `version: 1` and a `kinds` map whose keys are exactly the 18 grader `KINDS`.
- [ ] Each entry has `surface` (skill/slot) and `status` (`covered` | `designed`), seeded per the §6 table.
- [ ] `reconciliation` and `verdict-build` are the only `status: designed` entries; all others are `covered`.

### From WHAT (frontmatter marker)
- [ ] The `judgement_seam:` frontmatter key is defined: a comma-separated kind-id list **or** the literal `none`.
- [ ] The already-covered surfaces (faff-tidy, faffidavit-rendering, faffidavit-routing, faffter-noon-spec, faffter-noon-intake, faff-jot, faff-plot, faffter-noon-review, faffter-noon-methodology-structural) carry a `judgement_seam:` line matching their registry rows.
- [ ] faff-prep carries `judgement_seam: reconciliation`.

### From HOW (grader)
- [ ] `grader.mjs` reads the registry and throws a fail-loud drift error when `set(KINDS) != set(registry kind keys)`; grading behaviour is otherwise unchanged.

### From HOW (validate-adapters)
- [ ] `validate-adapters` extracts `judgement_seam:` from frontmatter and adds a reconciliation check: declared set == registry rows for that surface (`none` ⇒ owns no registered KIND; unknown kind-id ⇒ fail).
- [ ] An absent `judgement_seam:` key is advisory-pass in FAFF-280 (the absent→fail enforcement is explicitly FAFF-281).

### From HOW (edge cases)
- [ ] Unknown kind-id in frontmatter fails the skill with a naming message.
- [ ] Missing/malformed `eval/seam-registry.json` fails loud in both consumers.

**Integration smoke test:**

```
1. node -e 'import("./eval/grader.mjs")'          # loads, registry-consistency assertion passes (no throw)
2. faff validate-adapters                          # passes; faff-tidy seam reconciliation == registry rows
3. introduce a 19th id into KINDS only -> grader load throws drift error   # negative path
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" }
  ] }
```
