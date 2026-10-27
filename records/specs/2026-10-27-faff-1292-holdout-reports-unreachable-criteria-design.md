# Spec — FAFF-1292: The holdout reports criteria it could not reach as distinct from human-only checks

This is the buildable spec for Linear issue **FAFF-1292**. Audience: the build agent that will implement the change, and the human reviewers who gate it. It is design-level — it names the exact contract/schema/record fields, the cross-field rule, and the operator-output changes, but not step-by-step code.

## 1. WHY — Problem and principles

**The load-bearing model.** A code-blind holdout verdict rolls up per-criterion verdicts into one aggregate. A `needs-human` criterion is the fail-closed catch-all: the holdout marks a criterion `needs-human` both when *a human genuinely must judge it* (a prose Scenarios unit — taste, feel, copy) **and** when *a machine could have judged it but the provisioned environment exposed no surface to reach it*. Today those two causes are indistinguishable downstream: the contract criteria carry only `{class, verdict, evidence_present}` and drop the reason entirely; the persisted record keeps a **free-text** `reason` with no closed vocabulary. This spec makes the environment-reachability cause a **machine-distinguishable** value so an operator can tell an environment gap from a spec/authoring gap.

**Problem statement.** In the FAFF-1279 holdout, a born-verifiable criterion (`done:3`) a machine *could* check came back `needs-human` only because the env did not expose the `faff review-fixture-paths` CLI — an environment-provisioning failure, reported identically to "a human must look." Now that FAFF-1291 removed prose DONE items from the judged set, `needs-human` should mean "a human must look"; folding an environment gap into that verdict hides an environment problem behind an authoring one. This change gives the environment-reachability case its own reason, keeps it fail-closed, and reports it separately in both the holdout verdict and the graft operator output.

**Design principles:**

**Fail-closed is preserved by construction, never by the new field.** The new reason is reporting detail only. Any `needs-human` criterion already forces the aggregate to `needs-human` (via `deriveHoldoutAggregate`), which already blocks the merge gate (`holdoutGateResult` passes only on `meets-spec`). The reason code must not touch aggregation or the pass/block decision — it only explains *why* a criterion is `needs-human`.

**A born-verifiable criterion is never "human-only."** The crux of the ticket: a machine-checkable criterion (`class` `scenario`/`assertion`) that comes back `needs-human` is *by definition* an environment/infrastructure reachability gap, never a human-judgement call. Only an unjudgeable `prose` criterion is genuinely "a human must look." The contract must enforce this split as a cross-field rule, so the distinction is structural, not advisory.

**Promote the existing free-text causes, don't invent a parallel scheme.** The evaluator SKILL already enumerates the reason causes in prose ("prose scenario, no surface, wire error code, credentials not derivable, env not ready"). The closed enum is a faithful promotion of that set, so docs and the evaluator stay in step; the free-text detail survives as a separate human-readable field.

## Already shipped against this surface

- **FAFF-1291** (Done) "The code-blind holdout judges only criteria a machine can check" — removed prose DONE items from the judged set, delegating them to the AC checklist via `delegated[]`. This is the enabling predecessor FAFF-1292 assumes; it made `needs-human` mean "genuine human judgement" for the judged set. Not a supersession.
- **FAFF-1259** (Done) "Anchor evidence slice 4: record what each holdout criterion tested and observed" — added the per-criterion v0.3 record detail including the free-text `reason` field this spec gives a machine-readable enum alongside.
- **FAFF-961** (Done) + **FAFF-1360** (Done) — introduced `verification_tier` and routed integration-tier / code-surface DONE items away from the holdout. Orthogonal classification; not reachability.
- **FAFF-962** (Backlog, not built) — the `not-yet-reachable` tier / defer-with-obligation. A *different* case (future-slice deferral), kept orthogonal to this spec's env-gap fail-closed case (see §6).
- **FAFF-1237** (Backlog, not built) — env-side binding-manifest fix for one no-surface cause. Complementary, no dependency.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs-evidence.js` | JavaScript | `computeHoldoutVerdict`, `holdoutGateResult`, the `HOLDOUT_*` enums — where the contract gains `reason_code` + the cross-field rule and the gate gains the per-reason rollup |
| `plugin/skills/faff/contracts/holdout-verdict.schema.json` | JSON Schema | contract criteria shape — gains the optional `reason_code` property |
| `plugin/skills/faff/bin/lib/holdout-record.js` | JavaScript | `buildHoldoutRecord` / `holdoutRecordViolations` — persisted record gains `reason_code` alongside the free-text `reason` |
| `plugin/skills/faff/contracts/evidence-v0.3/schema/holdout-anchored.schema.json` | JSON Schema | persisted per-criterion shape — gains `reason_code` |
| `plugin/skills/faff/bin/lib/contract-defs-describe.js` | JavaScript | `holdout-verdict` describe `values` — gains `reason_code` semantics (the describe-coverage test requires one per enum value) |
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript | `cmdHoldoutVerdict` — emits the per-reason rollup for graft |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | prose | the evaluator writes `reason_code` per `needs-human` criterion |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | JavaScript | the spawner that shuttles the inner (caged) block to the writer — ships in the same PR so emission + enforcement deploy in lockstep |
| `plugin/skills/faff-graft/SKILL.md`, `plugin/skills/faff-beep-boop/SKILL.md` | prose | operator output names no-surface apart from human-only |

**Scope statement.** This is the **verdict-side reporting** change in the code-blind holdout pipeline (evaluate → record → merge-gate → graft/beep-boop operator surface); it does not touch classification, provisioning, or the env itself.

## 2. OUT OF SCOPE

- **Fixing the environment so the surface becomes reachable.** This spec reports the gap; it does not provision the missing surface. *Why excluded:* FAFF-1292 is verdict-side reporting; the env-side fix is a separate concern. *Extension point:* FAFF-1237 (the committed Tier-1 binding-manifest fix for library-only subjects) adds one missing surface; `faffter-noon-env-code-interface` / `faffter-noon-env-compose` own provisioning.
- **A `not-yet-reachable` / defer-with-obligation verification tier.** *Why excluded:* FAFF-962's deferral is for a surface that legitimately does not exist *yet* at this slice; `no-surface` here is for a surface that *should* be reachable now and the env failed to expose. They are orthogonal (see §6). *Extension point:* FAFF-962 would add a new `verification_tier` and a defer path in `resolveVerificationTier` (`admissibility.js`); this spec changes neither.
- **A mechanical reachability pre-check in the evaluator.** *Why excluded:* reachability is the LLM's judgement during exercise today; adding a mechanical probe is a larger change. *Extension point:* a future "surface inventory" on the `env-handle` contract (`contract-defs-delivery.js`) could let the evaluator pre-declare unreachable criteria.
- **Auto-remediation or re-run on `no-surface`.** *Why excluded:* the operator fixes the env and re-runs; auto-remediation is unbuilt. *Extension point:* a beep-boop re-provision-and-retry loop.
- **Changing what the aggregate means or the merge-gate decision.** *Why excluded:* fail-closed behaviour is unchanged; only the explanatory detail is added.

## 3. WHAT — Vocabulary, types, and interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| `reason_code` | A machine-readable, closed-vocabulary per-criterion code on a `needs-human` criterion, explaining *why* it could not be machine-judged. New in this spec. |
| `reason` (free text) | The existing human-readable per-criterion detail string on the persisted record (unchanged). Carries the specifics (e.g. "no `faff review-fixture-paths` surface in the provisioned env"). |
| no-surface | The env-reachability gap: a born-verifiable criterion whose surface the provisioned env never exposed. The case FAFF-1292 makes distinct. |
| human-only | The genuine human-judgement case: an unjudgeable `prose` Scenarios unit. |

**The closed `reason_code` vocabulary.**

```
ENUM HoldoutReasonCode:          # HOLDOUT_REASON_CODES in contract-defs-evidence.js
  human-only              # a prose Scenarios unit: no machine check, no delegate verifier — a human must look
  no-surface              # a born-verifiable criterion the provisioned env exposed no reachable surface for (env-provisioning gap)
  wire-error              # a top-level WireError on the session-RPC transport mid-exercise (infrastructure fault)
  credentials-unavailable # credentials supplied but no auth header derivable (unrecognised scheme / missing secret)
  env-not-ready           # the env/endpoint was not available when the criterion was exercised
```

**Chosen (open question 1): the exact closed vocabulary is the five values above, with a new `reason_code` field holding them and the existing free-text `reason` retained as the separate human-readable detail.** Rationale: (1) it is a faithful promotion of the free-text causes the evaluator SKILL already enumerates ("prose scenario, no surface, wire error code, credentials not derivable, env not ready"), so no parallel scheme is invented and the evaluator/docs stay in step; (2) a **new** field `reason_code` (rather than repurposing `reason`) keeps the existing free-text detail intact — the ticket asks to "keep the free-text detail as a separate human-readable field" — and keeps the change additive; (3) exactly one value, `human-only`, means "a human must look"; the other four are all environment/infrastructure reachability gaps that fail closed and direct the operator to fix the env and re-run — this is the legibility the ticket wants. `no-surface` (the surface was never exposed in this env) and `env-not-ready` (an endpoint became unavailable) are kept distinct because they point the operator at different remedies (provision the missing surface vs. fix env health). The field name `reason_code` is chosen over reusing `reason` so neither field is overloaded.

**Where `reason_code` lives.**

```
RECORD HoldoutVerdictCriterion (contract — holdout-verdict.schema.json):
  class: scenario | assertion | prose
  verdict: met | unmet | needs-human
  evidence_present: boolean
  reason_code: HoldoutReasonCode   # NEW; present iff verdict == needs-human, absent/omitted otherwise

RECORD HoldoutAnchoredCriterion (persisted — holdout-anchored.schema.json):
  id, text, holdout, class, verdict, evidence_present,
  exercised, expected, observed, evidence_ref,
  reason: string | null            # UNCHANGED free-text human-readable detail
  reason_code: HoldoutReasonCode | null   # NEW machine-readable code; non-null iff verdict == needs-human
```

**The cross-field rules (enforced via `violations`, the env-handle precedent — never a schema `required`, never fail-loud). Enforcement splits by layer so a *legacy cross-run record* is never retroactively rejected (see §4 — `.faff/holdout/<key>.json` is a cross-run store re-validated on every read).**

```
# CONTRACT layer — computeHoldoutVerdict, run on EVERY block (fresh or re-validated from the cross-run store).
# Tolerant of a legacy ABSENT code so a pre-change stored record keeps its original verdict:
CONSTRAINT  reason_code PRESENT                      =>  reason_code in HOLDOUT_REASON_CODES   # a present code must be a valid enum
CONSTRAINT  verdict in {met, unmet}                  =>  reason_code absent/null               # a judged criterion carries no reason_code
CONSTRAINT  class == prose AND reason_code PRESENT   =>  reason_code == human-only             # prose is the only human-only case
CONSTRAINT  class in {scenario, assertion} AND verdict == needs-human AND reason_code PRESENT
                                                     =>  reason_code != human-only             # a born-verifiable criterion is never "human must look"
CONSTRAINT  verdict == needs-human AND reason_code ABSENT
                                                     =>  TOLERATED (legacy/unspecified) — NEVER a violation  # back-compat for pre-change cross-run records
# WRITER layer — faff holdout record / buildHoldoutRecord, on a NEWLY-emitted block only. Strict, fail-closed:
CONSTRAINT  (writer) verdict == needs-human          =>  reason_code PRESENT and valid         # a fresh emission must carry the code; refusal writes a fail-closed needs-human record
```

The split is the crux of the backward-compat fix: the **presence** requirement lives at the *writer* (where new emissions are minted — the evaluator always emits a code in this change's own PR), while the *contract's* re-validation of an already-stored block tolerates an absent code as legacy. A pre-change `needs-human` record (e.g. a prose unit judged needs-human before `reason_code` existed) therefore re-validates as the `needs-human` it always carried, never flipping to `contract-rejected`.

**API surfaces.**

- `faff contract holdout-verdict` — validates the CONTRACT-layer rules above. An out-of-enum `reason_code`, a judged (`met`/`unmet`) criterion carrying one, a `prose` criterion with a non-`human-only` code, or a born-verifiable `needs-human` criterion claiming `human-only` → `conformant:false` / exit 1 (never fail-loud, which stays reserved for a non-object extraction). A `needs-human` criterion with an **absent** `reason_code` is **tolerated** (legacy/unspecified) — exit 0 — so re-validating a pre-change cross-run record never rejects it. Fail-safe coercion unchanged (bad aggregate → `needs-human`).
- `faff holdout verdict --issue <id> [--json]` — the existing `{issue, gate, reason, aggregate?, code_blind?, violations?}` output **gains** a `needs_human_reasons` object: a count keyed by the `reason_code`s present among the block's `needs-human` criteria (e.g. `{ "no-surface": 2, "human-only": 1 }`). The emission rule is decidable on every input, legacy records included: **every block with at least one needs-human criterion emits needs_human_reasons, with legacy absent reason_code criteria counted under "unspecified"** (so a blocking legacy record is never indistinguishable from a passing one). Computed by `holdoutGateResult` from the (now reason-code-carrying) contract criteria. Absent **iff** the block has zero `needs-human` criteria, regardless of `reason_code` presence.
- `faff holdout record` — the writer is the strict (WRITER-layer) half: it stamps `reason_code` onto each persisted criterion and refuses (fail-closed `needs-human` record) a **newly-emitted** block whose `needs-human` criterion has no `reason_code`, or that violates a cross-field rule — exactly as it already refuses a `needs-human` criterion missing the free-text `reason`. (Absent-code tolerance is a *read-side re-validation* property of the contract, not a writer property: fresh writes must carry the code.)

**Design decision — surface the rollup on the gate vs. have graft read the record.** The contract criteria drop `id`/`text`, so the gate's `needs_human_reasons` carries counts, not per-criterion text. Graft could instead parse the full persisted record (which has `id`/`text`/`reason`/`reason_code`) for richer detail. **Chosen:** the gate (`faff holdout verdict`) surfaces the per-`reason_code` **counts**, and graft renders those counts — naming no-surface apart from human-only — without parsing the record. Rationale: graft already consumes `faff holdout verdict`'s JSON; adding counts there keeps one consumer path and satisfies the acceptance criterion ("names 'no surface' criteria apart from human-only ones") with the distinction the operator needs. Per-criterion `id`/`text` detail stays available in the persisted record for a human who opens it.

## 4. HOW — Behaviour

**Architecture and approach.** The change threads one new per-criterion field through the existing holdout pipeline, touching each layer that already carries `class`/`verdict`:

1. **Evaluator (`faffter-noon-evaluate`)** writes `reason_code` on every `needs-human` criterion it emits, chosen from the vocabulary per the cause it hit during exercise (prose scenario → `human-only`; no reachable surface → `no-surface`; top-level WireError → `wire-error`; credentials present but no header → `credentials-unavailable`; endpoint unavailable → `env-not-ready`). The free-text `reason` stays as today.
2. **Contract (`computeHoldoutVerdict`)** carries `reason_code` into `contractData.criteria` (additively, like the `delegated`/`spawner_attested` precedent) and enforces the four cross-field constraints via `violations`.
3. **Gate (`holdoutGateResult` → `cmdHoldoutVerdict`)** rolls the criteria's `reason_code`s into `needs_human_reasons` counts in the emitted JSON. The pass/block decision is unchanged.
4. **Writer (`buildHoldoutRecord` / `holdoutRecordViolations`)** stamps `reason_code` onto each persisted criterion and refuses a block that breaks the cross-field rules.
5. **Operator surfaces (graft Step 10 _Holdout gate_, beep-boop run-report)** name no-surface criteria apart from human-only ones in the park message / run summary.

**Deriving `needs_human_reasons` (gate rollup):**

```
PROCEDURE rollup_needs_human_reasons(contractData):
  1. counts := {}                                  # reason_code -> integer
  2. FOR each criterion c in contractData.criteria:
     a. IF c.verdict == "needs-human":
        IF c.reason_code is a known code: counts[c.reason_code] += 1
        ELSE:                            counts["unspecified"] += 1   # legacy / absent reason_code
  3. RETURN counts                                 # non-empty whenever >=1 needs-human criterion exists;
                                                    # omitted from output ONLY when zero needs-human criteria
```

**Operator output (graft _Holdout gate_ block → park on block):**

```
PROCEDURE render_holdout_block(verdict_json):     # verdict_json = `faff holdout verdict --issue X --json`
  1. Compose the existing park message: aggregate + violations.
  2. IF verdict_json.needs_human_reasons present:
     a. IF "no-surface" (or wire-error / credentials-unavailable / env-not-ready) count > 0:
        name them as an ENVIRONMENT gap — "N criterion/criteria had no reachable surface
        (environment provisioning gap — fix the env and re-run), distinct from M needing human judgement".
     b. IF "human-only" count > 0: name those as the human-judgement subset.
  3. Flip PR to draft, park with the composed message, return pr-open-for-human.
```

The `pr-open-for-human` outcome text (graft ~line 873) and the beep-boop run-report roll-up line (~line 673) are updated to name the no-surface (environment-gap) subset apart from the human-only subset, so an operator reading either surface sees the distinction.

**Edge cases and error handling:**

- **Legacy record without `reason_code` on a `needs-human` criterion (the cross-run store).** `.faff/holdout/<key>.json` is a **cross-run store**: `faff holdout verdicts`/`verdict --issue` and `computeHoldoutVerdictsMap` re-read and re-validate those exact files through `computeHoldoutVerdict` on later runs. A record written **before** this change carries a `needs-human` criterion (e.g. a prose unit judged needs-human) with no `reason_code`. The CONTRACT-layer tolerance rule above handles this: an absent `reason_code` on a `needs-human` criterion is **tolerated**, so the record re-validates as the `needs-human` it always carried — it does **not** become `contract-rejected`, the bridge `skipped[]` reason stays `needs-human` (not silently degraded), and PRDR coverage is unchanged. This is why the biconditional is split across the writer (strict, new emissions) and the contract (tolerant, re-validation) rather than enforced uniformly: a uniform `needs-human <=> reason_code present` rule would reclassify every legacy stored record and silently degrade its carried reason. Fail-closed is preserved either way (a `needs-human` criterion still blocks).

- **Rollout / deploy sequencing (the caged inner-evaluator path).** The evaluator's emission of `reason_code` (`faffter-noon-evaluate/SKILL.md`), the spawner that shuttles the inner block out of the cage (`evaluate-call.mjs`), and the writer/contract enforcement all live in **this one repo and ship in one PR**, so they deploy together — there is no cross-version window in which the writer has shipped but the inner evaluator has not. Even if a caged run straddled a skew, the outcome is still fail-closed, but via the writer, not the contract: the caged path (`evaluate-call.mjs`) hands the inner block to the strict WRITER (`buildHoldoutRecord`) first, so **a version-skewed code-less fresh emission is refused at the writer (fail-closed needs-human record), never tolerated at the contract; the contract's absent-code tolerance applies only to read-side re-validation of already-stored cross-run records**. The writer refusal writes a blocking `needs-human` record (the `reason_code` distinction is temporarily erased for that one skewed emission, not silently passed), so the fail-closed invariant holds — the earlier framing that the block is "accepted" via contract tolerance misidentified which layer absorbs the skew. Named explicitly so the build treats the evaluator + spawner + writer edits as one atomic change, not independently-landable halves.
- **Whole-env not-ready path (`criteria: []`).** Unchanged: the evaluator still emits `aggregate: needs-human` with `criteria: []` and a top-level `violations` note. With no criteria there is no per-criterion `reason_code`; `needs_human_reasons` is absent. The `env-not-ready` code is for the per-criterion case (an endpoint that became unavailable while exercising one criterion), not this aggregate path.
- **`met`/`unmet` criterion carrying a stray `reason_code`.** Violation → exit 1 (a judged criterion has no "why unjudged").
- **Coercion.** `reason_code` is never a fail-loud trigger; a non-object extraction remains the only fail-loud case. An out-of-enum `reason_code` is a violation (exit 1), consistent with every other enum in this contract.

**Failure modes:**

- **The failure:** the evaluator (an LLM) mislabels an env gap as `human-only` (or vice versa), so the distinction is reported but wrong. *How you'd know:* the cross-field rule catches the structural half — a `scenario`/`assertion` criterion labelled `human-only` is a contract violation (exit 1), surfaced in `violations`; the inverse (a prose unit mislabelled `no-surface`) is also caught. The residual risk is an LLM labelling a genuine env gap as `no-surface` vs `wire-error` within the env-gap family. *What it means:* proceed — the load-bearing distinction (human-only vs any env gap) is enforced mechanically by the cross-field rule; intra-family precision is advisory detail and acceptable to get occasionally imperfect.
- **The failure:** graft's rollup counts diverge from the persisted record (e.g. the contract drops a criterion the record keeps). *How you'd know:* the gate rollup is computed from the same `computeHoldoutVerdict` output the block is validated through, so counts and verdict come from one source; a divergence would show as a `needs_human_reasons` total not matching the `needs-human` criterion count in the record. *What it means:* narrow — keep the rollup derived from `contractData.criteria`, never a second parse.

**Anti-pattern:** letting `reason_code` influence the aggregate or the pass/block decision. Why: it is reporting detail; aggregation stays `deriveHoldoutAggregate` over `verdict`s only, and the gate stays `meets-spec`-only. Coupling them would re-introduce the confound the ticket is removing.

**Anti-pattern:** adding `reason_code` to the schema `required` list. Why: this contract enforces enums and cross-field rules via `violations` (the env-handle/holdout-verdict precedent), reserving schema `required`/fail-loud for structural malformation; a `required` `reason_code` would make a present-but-wrong value throw (exit 2) instead of reporting a violation (exit 1).

## 5. Scenarios — born-verifiable main objectives

```
Given a holdout-verdict block whose needs-human criterion of class "assertion" carries reason_code "no-surface"
When it is piped to `faff contract holdout-verdict`
Then it is accepted (exit 0) and the aggregate is needs-human (the born-verifiable env gap is a valid, distinct, blocking reason)
```

```
Given a holdout-verdict block with a needs-human criterion of class "assertion" carrying reason_code "human-only"
When it is piped to `faff contract holdout-verdict`
Then it is rejected (exit 1) with a violation (a born-verifiable criterion is never human-only)
```

```
Given a holdout-verdict block whose needs-human criterion of class "prose" carries reason_code "no-surface"
When it is piped to `faff contract holdout-verdict`
Then it is rejected (exit 1) with a violation (a prose criterion must be human-only)
```

```
Given a persisted holdout.json with one needs-human "no-surface" criterion and one needs-human "human-only" criterion
When `faff holdout verdict --issue <id> --json` is run
Then the gate is "block" and the output's needs_human_reasons contains { "no-surface": 1, "human-only": 1 }
```

- The aggregate derivation and the merge-gate pass/block decision MUST be byte-for-byte unchanged by the presence of `reason_code` (fail-closed invariant).

## 6. Design decision rationale

**What exact reason values, and in which field? (open question 1)**
- *Options:* (a) repurpose the existing free-text `reason` as the enum, dropping the human detail; (b) add a new enum field `reason_code` and keep `reason` free-text; (c) only distinguish no-surface vs human-only (two values).
- (a) loses the human-readable specifics the ticket says to keep; (c) under-serves the SKILL's existing causes and would re-collapse wire-error/credentials/env-not-ready into an ambiguous bucket.
- **Chosen:** (b) — a new `reason_code` enum of five values (`human-only`, `no-surface`, `wire-error`, `credentials-unavailable`, `env-not-ready`) on both the contract and the persisted record, with `reason` retained as the free-text detail. Faithful promotion of the evaluator's existing vocabulary; additive; exactly one "human must look" value against four environment/infra gaps.

**Does `no-surface` block or defer? (open question 2)**
- *Options:* block fail-closed (the aggregate does not pass) vs defer-with-obligation like FAFF-962's `not-yet-reachable`.
- **Chosen:** `no-surface` is **fail-closed / blocking**, orthogonal to FAFF-962's defer tier. The ticket's own WHAT says "it stays fail-closed: the aggregate still does not pass." `no-surface` is an environment-provisioning failure for a criterion that *should* be reachable now — the operator fixes the env and re-runs; it never defers. FAFF-962 (Backlog, not built) is a *different* case: a surface that legitimately does not exist yet at this slice, deferred to a later gate. Keep them orthogonal; this spec adds no deferral path.

**How does this relate to FAFF-1237's binding-manifest path? (open question 3)**
- **Chosen:** no dependency; complementary. FAFF-1237 (Backlog, not built) is the env-side fix for one *cause* of `no-surface` (library-only subjects need a committed Tier-1 binding manifest). FAFF-1292 is the verdict-side reporting that makes *any* `no-surface` gap — including the missing-manifest one — legible to the operator as an environment problem distinct from human-only. FAFF-1292 ships independently and would correctly report the FAFF-1237 situation as `no-surface`.

**Should `env-not-ready` be a per-criterion code given the not-ready path emits `criteria: []`?**
- *Options:* include it (five values, matches the SKILL enumeration) vs omit it (four values, since the whole-env not-ready path carries no per-criterion reason).
- **Chosen:** include it. It names the per-criterion case where a single endpoint becomes unavailable mid-exercise (distinct from `no-surface`, where the surface was never exposed), and keeping the enum aligned with the SKILL's enumerated causes minimises doc drift. The whole-env not-ready path (`criteria: []`, top-level violation) is unchanged and simply produces no per-criterion code.

## 7. Open questions and assumptions

**Open Questions:** none. All three ticket open questions are resolved as **Chosen** above.

**Assumptions:**

- **Assumes:** the holdout-verdict contract continues to enforce enums and cross-field rules via `violations` (not schema `required`), reserving fail-loud for a non-object extraction. *Validation:* confirmed in `computeHoldoutVerdict` (`contract-defs-evidence.js`) — e.g. `code_blind`, `class`, `verdict`, and the aggregate-derivation checks all push to `violations`; honour the same pattern for `reason_code`.
- **Assumes:** persisted `holdout.json` records in `.faff/holdout/<key>.json` form a **cross-run store** — written by `faff holdout record` and re-read / re-validated through `computeHoldoutVerdict` by `faff holdout verdicts`/`verdict --issue` and `computeHoldoutVerdictsMap` on later runs — not committed evidence, but also not single-run-ephemeral. *Validation:* confirmed in `contract-defs-evidence.js` / `holdout-record.js`. **Backward-compat consequence (handled, not assumed away):** because the store is re-validated across runs, the cross-field biconditional is **split** — strict presence at the writer (new emissions), tolerant of an absent code at the contract (re-validation) — so a pre-change `needs-human` record keeps its verdict rather than being reclassified `contract-rejected` (see §4 _Legacy record_). No data migration of stored records is required; the tolerance rule subsumes it.
- **Assumes:** the describe-coverage test (`test/contract-describe.test.mjs`) requires every enum value in a describe `values[]` group to have a matching `semantics` key. *Validation:* confirmed — the test asserts `values[].semantics` keys equal the enum exactly; add a `reason_code` `values` entry with one semantics line per code.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] A `needs-human` criterion's cause is machine-distinguishable: a born-verifiable (`scenario`/`assertion`) criterion that could not be reached carries `reason_code: no-surface`, distinct from a `prose` criterion's `reason_code: human-only`.
- [ ] The aggregate and the merge-gate pass/block decision are unchanged by `reason_code`: a block carrying a `no-surface` `needs-human` criterion still does not pass (`faff holdout verdict` returns `block`).

### From WHAT (contract + enum)
- [ ] `HOLDOUT_REASON_CODES` = `["human-only","no-surface","wire-error","credentials-unavailable","env-not-ready"]` is defined and exported in `contract-defs-evidence.js`.
- [ ] `faff contract holdout-verdict` accepts (exit 0) a block whose `needs-human` criterion of class `assertion` carries `reason_code: no-surface` and whose aggregate is `needs-human`.
- [ ] `faff contract holdout-verdict` **accepts** (exit 0) a block whose `needs-human` criterion has **no** `reason_code` (legacy cross-run record back-compat) and leaves its `needs-human` verdict intact — it is never reclassified `contract-rejected`.
- [ ] `faff contract holdout-verdict` rejects (exit 1) a block where a `needs-human` criterion carries an out-of-enum `reason_code`.
- [ ] `faff contract holdout-verdict` rejects (exit 1) a block where a `met` or `unmet` criterion carries a `reason_code`.
- [ ] `faff contract holdout-verdict` rejects (exit 1) a block where a `class: prose` criterion's `reason_code` is not `human-only`.
- [ ] `faff contract holdout-verdict` rejects (exit 1) a block where a `class: scenario`/`assertion` `needs-human` criterion carries `reason_code: human-only`.
- [ ] A non-object extraction remains the only fail-loud (exit 2) case; an out-of-enum `reason_code` is exit 1, never exit 2.

### From WHAT (schemas)
- [ ] `holdout-verdict.schema.json` criteria items permit an optional `reason_code` string property (not in `required`; `additionalProperties:false` still holds).
- [ ] `holdout-anchored.schema.json` criteria items carry a `reason_code` of type `["string","null"]` alongside the unchanged free-text `reason`.

### From WHAT (gate output)
- [ ] `faff holdout verdict --issue <id> --json` over a block with one `no-surface` and one `human-only` `needs-human` criterion emits `needs_human_reasons: { "no-surface": 1, "human-only": 1 }` and `gate: "block"`.
- [ ] `faff holdout verdict --issue <id> --json` over a legacy block whose only `needs-human` criterion carries **no** `reason_code` emits `needs_human_reasons: { "unspecified": 1 }` and `gate: "block"` — a blocking legacy record is never indistinguishable from a passing one.
- [ ] `needs_human_reasons` is absent from the output **iff** the block has zero `needs-human` criteria (regardless of `reason_code` presence).

### From HOW (writer)
- [ ] `faff holdout record` stamps `reason_code` onto each persisted `needs-human` criterion and leaves it `null` on `met`/`unmet` criteria.
- [ ] `faff holdout record` refuses (writes a fail-closed `needs-human` record) a **newly-emitted** block whose `needs-human` criterion has no `reason_code`, or that violates a `reason_code` cross-field rule, naming the offending criterion by key path, never by value. (The writer is strict on fresh emissions; the contract's absent-code tolerance is a read-side re-validation property only.)
- [ ] A pre-change record re-read from `.faff/holdout/<key>.json` whose `needs-human` criterion lacks `reason_code` re-validates (via `computeHoldoutVerdict` on `faff holdout verdicts`/`verdict --issue`) as `needs-human` — not `contract-rejected` — and its bridge `skipped[]` reason and PRDR coverage value are unchanged from pre-change behaviour.

### From HOW (operator surfaces — prose)
- [ ] The graft Step 10 _Holdout gate_ block (`plugin/skills/faff-graft/SKILL.md`) names the environment-gap (`no-surface`/`wire-error`/`credentials-unavailable`/`env-not-ready`) `needs-human` criteria apart from the `human-only` ones in the park message.
- [ ] The graft `pr-open-for-human` outcome text (~line 873) distinguishes an environment-gap holdout block from a human-only one.
- [ ] The beep-boop run-report roll-up (`plugin/skills/faff-beep-boop/SKILL.md` ~line 673) surfaces the no-surface (environment-gap) subset apart from human-only.
- [ ] `faffter-noon-evaluate/SKILL.md` instructs the evaluator to write a `reason_code` from the closed vocabulary on every `needs-human` criterion (prose → `human-only`; no reachable surface → `no-surface`; WireError → `wire-error`; underivable credentials → `credentials-unavailable`; endpoint unavailable → `env-not-ready`), keeping the free-text `reason`.

### From WHAT (describe + docs) — review/merge test floor items
- [ ] The `holdout-verdict` describe entry in `contract-defs-describe.js` gains a `reason_code` `values` group whose `semantics` keys exactly equal `HOLDOUT_REASON_CODES`, and `faff contract holdout-verdict --describe` prints each code.
- [ ] `docs/guide/cli.md`, `docs/reference/GLOSSARY.md`, `faff/references/kernel.md` (evaluator slot row) and `faff/references/l4.md` are updated where they restate the holdout reason causes, with no CLI-doc-drift lint failure (`lint-cli-doc`, `lint-cli-coverage`, `test/scaffolder-cli-surface-drift.test.mjs`).

### From HOW (tests + selftests) — review/merge test floor items
- [ ] `holdoutVerdictsSelftest`/`dodSelftest` (admissibility.js) and `holdoutRecordSelftest` (holdout-record.js) cover `reason_code`: acceptance of a valid code, and refusal of each cross-field violation.
- [ ] The golden fixtures for `holdout-verdict` in `contract-defs-registry.js` (and `test/golden/contracts/cases.json`) gain conformant and non-conformant `reason_code` cases.
- [ ] `test/contract-describe.test.mjs`, `test/contract-golden.test.mjs`, `test/holdout-record.test.mjs`, `test/holdout-delegation.test.mjs` (its ad-hoc `reason:"no surface"` criterion gains `reason_code:"no-surface"`), `test/holdout-verdicts.test.mjs`, `test/evaluate-call.test.mjs`, `test/dod.test.mjs` and the evidence-v0.3 schema tests pass with the new field.
- [ ] `eval/grader.mjs` (reuses `holdoutRecordViolations`) and the holdout eval corpora (`eval/cases/holdout-*.json`, `eval/cases-live/*`, `eval/cases-seeded/*`) still pass; a `no-surface` vs `human-only` oracle token is added where a corpus case scores the distinction.

### Eval coverage
- [ ] The evaluator's `reason_code` assignment is an LLM-judgement seam (part of the existing `holdout`/`holdout-exercise` seams). A DONE-registered eval case asserts the no-surface vs human-only distinction on a seeded holdout corpus case, with its grader `KIND` + seam-registry row recorded in this ticket (baseline acceptance is a separate human step).

**Integration smoke test:**

```
PROCEDURE smoke():
  # Steps 1-2 and 5 exercise the CONTRACT only (no id / classify coupling — faff contract holdout-verdict
  # validates shape + cross-field rules and does NOT require ids to match a classified set):
  1. Build a holdout block: aggregate needs-human, code_blind true, one criterion
     { class:"assertion", verdict:"needs-human", evidence_present:false, reason_code:"no-surface" }.
  2. echo "$block" | faff contract holdout-verdict        -> exit 0 (accepted, blocking aggregate)
  5. Flip the criterion's reason_code to "human-only" and re-pipe to step 2 -> exit 1 (violation: born-verifiable never human-only)

  # Steps 3-4 exercise the WRITER + gate rollup, which DO key criterion ids to the classified running-stack set.
  # buildHoldoutRecord refuses any criterion id not in `faff dod classify`'s running-stack ids (judgedIdsOf) and
  # would otherwise write a fail-closed criteria:[] record from which needs_human_reasons never emits — so the
  # block MUST be built from a classified spec, NOT hand-minted with an arbitrary id:
  3. Take a tiny fixture spec with one born-verifiable running-stack DONE item; run
     `faff dod classify --spec <fixture> --json` and read the running-stack criterion id (e.g. "done:1").
     Build the needs-human / reason_code:"no-surface" block using THAT id (plus the required exercised/evidence fields).
  4. Write it via `faff holdout record --issue FAFF-X` (accepted — id matches the judged set); run
     `faff holdout verdict --issue FAFF-X --json`          -> gate "block", needs_human_reasons {"no-surface":1}
```

confidence: high
spec-review: accept (judge, L3-provisional)