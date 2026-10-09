# Spec: Hoist one shared `buildEnvelope` (FAFF-1241)

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-1241.

This is the build spec for FAFF-1241. It is written for the coding agent that will implement the change and the human reviewers who gate it. It assumes familiarity with the schema:3 governance ledger but not with this ticket's exploration; every claim it relies on is grounded in the files named below.

## 1. WHY — Problem and Principles

**The load-bearing model.** There is one schema:3 envelope shape in this system: a flat record with a fixed field order (`schema, run_id, seq, ts, author, producer_id, contract_revision, kind_of_entry, unit_id, step, prev`, then optional `effect`, optional `payload`). Two modules mint it today from two hand-kept copies of the builder. A single builder that both import removes the risk that those copies drift and silently fork the envelope that downstream hashing, signing and chain-verification all depend on being byte-identical.

**Problem statement.** `governor.ts` re-implements `buildEnvelope` because it cannot import `commissaire.ts` without re-introducing the dispatch cycle the governor was split out to avoid (governor.ts banner, lines 10-13). The two copies are already not byte-identical (different parameter lists, one asserts and one does not). This change moves one builder into a module both legally import, so a single implementation mints every schema:3 envelope, with no intended change to the records either module produces.

**Design principles.**

**Behaviour parity is the gate, not an aspiration.** The records minted after this change must be byte-for-byte what each module mints today, because those bytes are the signing and chain-hash image (`signRecord`/`signDecision` in producer-auth.ts hash the record). Any reconciliation choice that cannot be shown to preserve the emitted bytes is rejected in favour of one that can.

**The governor never imports `commissaire.ts`.** The split exists to break the dispatch cycle; the shared home must sit on the governor's already-legal import side (governance or shared-infra), never in `commissaire.ts`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript | Holds `buildEnvelope` (line 190, 8 params, asserts) and its callers (lines 207, 218) |
| `plugin/skills/faff/bin/lib/governor.ts` | TypeScript | Holds the duplicate `buildEnvelope` (line 164, 7 params, no assert) and its callers (lines 176, 523) |
| `plugin/skills/faff/bin/lib/producer-auth.ts` | TypeScript | `region:governance`, typed; home of `signRecord`/`signDecision` that sign this envelope; the chosen home |
| `plugin/skills/faff/bin/lib/decision-policy.ts` | TypeScript | Already exports the shared `GovernedRecord` type (line 17), imported by both modules |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript | Region direction lint (`regionsCheck`, line 794): governance must not require factory; shared-infra must not require any local module |

**Scope statement.** This is a single-builder de-duplication inside the schema:3 governance envelope layer; it touches envelope construction only, not hashing, signing, chaining, verdict logic or the dispatch boundary.

## 2. OUT OF SCOPE

- **Unifying `isRecord`** — the three duplicate copies (commissaire.ts:99, governor.ts:74, decision-policy.ts:20) stay as they are. Why excluded: the ticket is about the envelope builder, and a global `isRecord` hoist is a separate clean-up with its own blast radius. Extension point: the hoisted builder's module defines or reuses whatever `isRecord` its assert needs; a future ticket can collapse the three.
- **Hoisting `signRecord`/`signDecision` or the chaining logic** — only record construction moves. Why excluded: those are already shared from producer-auth; callers still attach `producer_hmac`/`commissaire_sig` after calling the builder, unchanged. Extension point: n/a, already shared.
- **Collapsing the two `EnvelopeBody` type declarations into a single exported domain type used everywhere** — this spec exports one shared body type for the builder's parameter only; it does not rework governor's strict local type or audit every other `EnvelopeBody` reference. Why excluded: scope containment. Extension point: the shared type exported alongside the builder is the anchor a future consolidation would build on.
- **Moving `appendProducerRecords` / `appendCommissaireRecord` / `signedByGovernor`** — the append and sign wrappers stay in their current modules. Why excluded: they are module-specific orchestration around the builder, not the builder. Extension point: they call the shared builder in place.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| schema:3 envelope | The flat governance ledger record with the fixed field order below, before any auth field is attached |
| envelope body | The verb-specific fields a caller supplies: `kind_of_entry`, `unit_id`, `step`, and optional `effect` / `payload` |
| the assert | `assertEnvelopeBody` (commissaire.ts:182): throws `TypeError` when the body is not a record, carries an own `issue` key, or has a `unit_id` that is not a non-empty string |
| the home | The module the single builder moves into, imported by both `commissaire.ts` and `governor.ts` |

**Types.** The shared builder adopts the loose body type (a structural superset of both current declarations) and exports it from the home module:

```
RECORD EnvelopeBody:          # the shared, loose body type
  kind_of_entry?: unknown
  unit_id?:       unknown
  step?:          unknown
  effect?:        unknown
  payload?:       unknown
```

Governor's current strict literal bodies (`{ kind_of_entry: string, unit_id: string, step: string, ... }`) are assignable to this loose type, so governor call sites compile unchanged whether they keep a local strict alias or import the shared one.

**Builder interface.** The single builder keeps commissaire's parameter list, with `ts` made optional so governor's shorter call is legal:

```
FUNCTION buildEnvelope(
    runId:            unknown,
    seq:              unknown,
    prevHash:         unknown,
    author:           string,
    producerId:       unknown,
    contractRevision: unknown,
    body:             EnvelopeBody,
    ts?:              unknown           # optional: omitted => stamp now
) -> GovernedRecord
```

`unknown`-typed scalar params are a superset of governor's `string`/`number` arguments, so both call shapes satisfy the one signature. `GovernedRecord` is the existing shared type from `decision-policy.ts` (type-only import, erased at runtime).

**Home-module surface.** The builder and the `EnvelopeBody` type are added to the home module's exports:
- added to the `ProducerAuthApi` interface (producer-auth.ts:40) and to `module.exports` (producer-auth.ts:270);
- both `commissaire.ts` and `governor.ts` reach it through their existing `const producerAuth: ProducerAuthApi = require("./producer-auth")` binding (commissaire.ts:68, governor.ts:26), destructuring `buildEnvelope` as they already destructure `signRecord`.

**Design decisions** (full rationale in section 6):

- **Chosen:** home = `producer-auth.ts`.
- **Chosen:** the shared builder keeps an optional trailing `ts` parameter.
- **Chosen:** the shared builder includes `assertEnvelopeBody` (the full builder moves, assert and all).
- **Chosen:** one loose `EnvelopeBody` type is exported from the home module and used as the builder's body parameter type.

## 4. HOW — Behavior

**Architecture.** One function body (commissaire's current `buildEnvelope`, including its leading `assertEnvelopeBody(body)` call) moves into `producer-auth.ts`. The loose `EnvelopeBody` type and the `assertEnvelopeBody` helper move or are co-located with it so the assert has the `isRecord` it needs. Both modules delete their local copy and call the shared one. `commissaire.ts` re-exports the shared builder under the name `buildEnvelope` so its existing public export is preserved. Nothing else changes: callers still attach `producer_hmac` / `commissaire_sig` to the returned record exactly as before.

```
PROCEDURE buildEnvelope(runId, seq, prevHash, author, producerId, contractRevision, body, ts?):
  1. assertEnvelopeBody(body)        # throws TypeError on bad body (see edge cases)
  2. rec := {
       schema: 3, run_id: runId, seq: seq, ts: ts || now_iso(),
       author, producer_id: producerId, contract_revision: contractRevision,
       kind_of_entry: body.kind_of_entry, unit_id: body.unit_id, step: body.step, prev: prevHash
     }
  3. IF body.effect  is defined: rec.effect  := body.effect
  4. IF body.payload is defined: rec.payload := body.payload
  5. RETURN rec
```

This is identical to commissaire.ts:190-200 today. The only difference from governor.ts:164-173 is the two added capabilities (the `ts` parameter and the assert), both shown below to be behaviour-preserving for governor's call sites.

**Caller rewiring.**

| Call site | Today | After |
|---|---|---|
| commissaire.ts:207 (`appendProducerRecords`) | local builder, passes `ts` | shared builder, passes `ts` — unchanged |
| commissaire.ts:218 (`appendCommissaireRecord`) | local builder, passes `ts` | shared builder, passes `ts` — unchanged |
| governor.ts:176 (`signedByGovernor`) | local builder, 7 args, no `ts` | shared builder, 7 args, `ts` omitted => now |
| governor.ts:523 (selftest `producer`) | local builder, 7 args, no `ts` | shared builder, 7 args, `ts` omitted => now |

**Why `ts` optional is behaviour-preserving for governor.** Governor never passes `ts`; omitting the optional arg makes the shared builder evaluate `ts || now_iso()` to `now_iso()`, which is exactly governor's current unconditional `ts: new Date().toISOString()`. Commissaire's callers pass `ts` as before.

**Why the assert is behaviour-preserving for governor.** The assert can only change behaviour if some governor path reaches the builder with a body it rejects (non-record, own `issue` key, or non-string/empty `unit_id`). It does not:

```
Governor builder call sites and their body's unit_id / issue:
  admit    (governor.ts:250)  unit_id: "-"            literal non-empty string; no issue key
  verdict  (governor.ts:302)  unit_id: unitId.value   from parseUnitId => guaranteed non-empty string
  conclude (governor.ts:358)  unit_id: unit           = unitId.value; same guarantee
  selftest (governor.ts:523)  unit_id: unit           test unit ids (FAFF-1, U-A, ...), all non-empty
```

`parseUnitId` routes through `parseOpaqueId` (ids.ts:59-62), which returns `err` for a non-string or empty string, and each handler bails with `refuse("malformed-request")` before the builder when the parse fails. The governor bodies are explicit object literals carrying `kind_of_entry` / `unit_id` / `step` / `payload`; none carries a top-level `issue` key (the `issue`-keyed escapes at governor.ts:314 are nested inside `payload`, which the assert does not inspect). So the assert never fires on a reachable governor body; it is defensive-only there.

**Anti-pattern:** splitting the builder into a "record construction" helper plus a separately-retained assert so governor can skip the check. Why: that keeps two call paths and re-creates the drift the ticket removes; the reachability analysis above shows the whole builder (assert included) is safe to share.

**Anti-pattern:** placing the shared builder in `commissaire.ts` and having governor import it. Why: it re-introduces the dispatch cycle (governor.ts:10-13) the split was created to avoid.

**Edge cases.**
- Bad body on a commissaire path (own `issue` key, empty/non-string `unit_id`, non-record): shared builder throws `TypeError` before any ledger write, exactly as today (the pin at commissaire-unit-id.test.mjs:121-138 asserts this through `buildEnvelope`, `appendProducerRecords` and `appendCommissaireRecord`).
- `ts` passed as empty string or falsy by a commissaire caller: falls back to `now_iso()` via `ts || now_iso()`, unchanged from commissaire today.

**Failure modes.**

- **The failure:** the behaviour-parity claim is wrong because some governor path can, after all, reach the builder with a body the assert rejects (for example a future caller, or a path the static read missed), so the governor newly throws where it used to build.
  - **How you'd know:** the governor selftest (`governorSelftest`) or the governor test suite fails with a `TypeError` from `assertEnvelopeBody`; `faff selftest` / the commissaire+governor suites go red rather than staying green.
  - **What it means:** narrow, do not abandon. If a real governor path legitimately needs a non-asserting build, retreat to the construction-only split for that path (documented anti-pattern) rather than weakening the assert; the parity claim for all other paths still holds.
- **The failure:** the two emitted records are not actually byte-identical after the move (a field-order or conditional-field slip when transcribing the builder), changing the on-disk physical ledger line for all new runs.
  - **What the existing suite does NOT catch (spec-review QA correction).** The *signature* image is `canonicalBytes` → `canonicalStringify`, which key-sorts (producer-auth.ts:108-118), so it is **field-order-independent** — a reorder does not fail `audit verify` or any signature check. A fresh run re-hashes whatever physical lines it emits, so its `prev` chain stays internally self-consistent under a reorder and the chain walk also stays green. And `treeDigest` (commissaire-unit-id.test.mjs:59-70, used at 143-163) is a **read-immutability** check over a committed fixture, not a write-path mint-and-compare; the writer test (99-118) asserts `schema` / `unit_id` / `step` but not field order or absolute bytes. So a field-order or conditional-inclusion slip could pass the whole current suite green while silently changing the on-disk ledger layout.
  - **How you'd know (the guard this spec adds).** A dedicated **write-path golden-bytes assertion** (new DoD item below): mint one governor-authored record and one commissaire-authored record through the shared builder and compare their exact serialized bytes (field order + conditional `effect`/`payload` inclusion) against a frozen pre-change golden image. That assertion — not the canonical-signature or read-immutability checks — is what goes red on a transcription slip.
  - **What it means:** parity still holds by construction (one shared function, field order verified identical pre-change), so a mismatch is a transcription bug to fix, not a design problem; proceed only once the golden-bytes assertion is green.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given commissaire.ts and governor.ts after the hoist
When each mints a schema:3 envelope for the same inputs it mints today
Then the emitted record is byte-identical to the pre-change record (same field order, same conditional effect/payload inclusion)
```

```
Given a single shared buildEnvelope in producer-auth.ts
When the require graph is inspected
Then governor.ts imports the shared builder and never imports commissaire.ts, and no dispatch cycle exists
```

- The governor selftest and the governor/commissaire test suites pass unchanged after the move.
- `faff regions check` exits 0 after the change.

## 6. DESIGN DECISION RATIONALE

**Where should the single builder live?**
- `producer-auth.ts` (governance, typed) — both modules already import it; it is the schema:3 auth module and already owns `signRecord`/`signDecision`, which sign exactly this envelope; factory to governance is a legal edge. Adds `buildEnvelope` to `ProducerAuthApi` + `module.exports` and a type-only `GovernedRecord` import (erased, governance to governance, legal). No new module, no new region banner, no new runtime require edge, and it is already inside the standalone import-independence closure (commissaire-standalone.test.mjs:140-152).
- `decision-policy.ts` (governance, typed) — both already import it, but building an envelope is not a "decision"; semantic stretch, so rejected.
- `shared-infra.js` (shared) — legal for both, but it is `.js`, so the typed 8-param signature degrades to JSDoc and loses compile-time checking; rejected to keep the typed signature.
- A brand-new module (e.g. `envelope.ts`) — cleanest separation, but adds a file, a region banner, a new require edge for both importers, and a new node in the standalone closure for a single function; rejected as disproportionate to the ticket.
- **Chosen:** `producer-auth.ts` — lowest-friction existing home with the strongest cohesion (it already signs this record) and no new graph surface.

**How to reconcile the `ts` parameter (commissaire has it, governor does not)?**
- Shared builder with no `ts` (always stamp now): would change commissaire's behaviour, which passes `ts` deliberately. Rejected.
- Two overloads / two builders: defeats the single-builder goal. Rejected.
- **Chosen:** optional trailing `ts` — a safe superset. Commissaire passes it unchanged; governor omits it and gets `now` exactly as today. No behaviour change.

**Should the shared builder include `assertEnvelopeBody`?**
- Hoist construction only, keep the assert in commissaire's call path: pure de-dup with zero reachability argument needed, but leaves two code paths and is the split-builder anti-pattern.
- Hoist the whole builder including the assert: one true single builder. Risk is only real if a governor path can pass a rejectable body; the reachability analysis (HOW, governor call sites) shows none can, because `parseUnitId` guarantees a non-empty string `unit_id` and no governor body carries a top-level `issue` key. Verified against ids.ts:59-62 and governor.ts:250/302/358/523.
- **Chosen:** include the assert — the governor's observable behaviour is unchanged (the assert is unreachable-with-a-bad-body on every governor path, i.e. defensive-only there), and this yields a genuinely single builder rather than a split one.

**What body type does the shared builder take?**
- Governor's strict type (`unit_id: string`, etc.): commissaire's looser callers would fail to type-check. Rejected.
- A generic parameter: unnecessary ceremony for a flat body. Rejected.
- **Chosen:** the loose `EnvelopeBody` (commissaire's shape), exported from the home module. It is a structural superset: governor's strict literals satisfy it, and the runtime `assert` narrows `unit_id` to a non-empty string regardless.

At the time of writing, `producer-auth.ts` and `commissaire.ts` are TypeScript with a committed `.js` emit (ADR-0132, layout d); the governed artifact is the `.js`, so the emit must be rebuilt and committed with the `.ts`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. Every decision is closed; the one question the exploration left open (whether a governor path can pass a body the assert rejects) is resolved to "no" by the reachability analysis in HOW, grounded in ids.ts and the governor call sites.

**Assumptions.**

- **Assumes:** `producer-auth.ts` exposes its API through the `ProducerAuthApi` interface (line 40) and `module.exports` (line 270), and both callers bind it via `require("./producer-auth")`. Validation: confirmed at producer-auth.ts:40/270, commissaire.ts:68, governor.ts:26; re-check these lines before editing in case of drift.
- **Assumes:** the committed `.js` emit is the governed artifact and must be regenerated. Validation: after editing the `.ts`, run `cd plugin/skills/faff && npm install && npm run build` and commit the regenerated `.js` + `build-manifest.json`; `faff regions check` fails (exit 2) if a `.ts` under `bin/lib/` lacks its `.js` sibling.

## 8. DONE — Definition of Done

### From WHY
- [ ] Exactly one `buildEnvelope` implementation exists in `plugin/skills/faff/bin/lib/`; `commissaire.ts` and `governor.ts` no longer each define their own.
- [ ] Records minted by both modules are byte-identical to their pre-change output.
- [ ] **(spec-review QA minor) A dedicated write-path golden-bytes assertion is added** — a new/extended test mints one governor-authored record and one commissaire-authored record through the shared builder and asserts their exact serialized bytes (field order + conditional `effect`/`payload` inclusion) against a frozen pre-change golden image. This is a real write-path mint-and-compare, distinct from the `treeDigest` read-immutability check and the key-sorted canonical signature (both order-independent), which cannot catch a field-order transcription slip.

### From WHAT (types and interfaces)
- [ ] The shared builder lives in `producer-auth.ts` and is added to both the `ProducerAuthApi` interface and `module.exports`.
- [ ] A single loose `EnvelopeBody` type is exported from the home module and used as the builder's body parameter type.
- [ ] The shared builder's signature is `(runId, seq, prevHash, author, producerId, contractRevision, body, ts?)` with `ts` optional, returning `GovernedRecord`.

### From HOW (behaviour)
- [ ] `commissaire.ts` call sites (ex-207, ex-218) call the shared builder and still pass `ts`.
- [ ] `governor.ts` call sites (ex-176, ex-523) call the shared builder omitting `ts`, and the emitted `ts` is `now` as before.
- [ ] `commissaire.js` still re-exports `buildEnvelope`, so `import { buildEnvelope } from commissaire.js` resolves (test pin at commissaire-unit-id.test.mjs:135).
- [ ] `governor.ts` does not import `commissaire.ts`; no dispatch cycle is introduced.

### From HOW (edge cases)
- [ ] Calling `buildEnvelope` / `appendProducerRecords` / `appendCommissaireRecord` from `commissaire.js` with an `issue`-bearing, empty-`unit_id`, or non-record body throws `TypeError` before any ledger write.

### From Assumptions / build discipline
- [ ] The `.js` emit and `build-manifest.json` are rebuilt from the edited `.ts` and committed alongside it.
- [ ] `faff regions check` exits 0.
- [ ] The commissaire and governor selftests and existing suites (including commissaire-standalone.test.mjs and commissaire-unit-id.test.mjs) pass unchanged.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Build the emit: cd plugin/skills/faff && npm install && npm run build
  2. Run faff regions check            => exit 0
  3. Run the commissaire + governor selftests and the two pinned test files => all green
  4. Mint one governor verdict record and one commissaire producer record,
     verify each chains and verifies under its auth field (bytes unchanged)
```

confidence: high