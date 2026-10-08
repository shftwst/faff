# Design spec: FAFF-1225 — conclude refuses unless every observed protected effect was granted

> Spec: faffter-dark-nlspec · 2026-10-08 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1225.

This spec addresses Linear ticket **FAFF-1225** (domain: Commissaire). It is written for the build agent that will implement the change and for the human reviewers who gate it. It is a standard-complexity build spec: it fixes a named governance hole in one command, touches one `.ts` source plus its emit, one hand-authored `.js`, one doc, one test file and the in-process selftest.

## 1. WHY — Problem and Principles

**The load-bearing model.** Commissaire tracks a protected effect through three ledger facts, in order: the producer **declares** it before acting, the Commissaire **grants** it (a signed `effect-decision-verdict` with `verdict: "grant"` covering the effect descriptor), and a chokepoint **observes** it as faff performs it. The `conclude` verdict is the run's terminal attestation that this chain of custody held. Today `conclude` checks only two of the three links: declared ⊇ observed (the escape check). It never checks granted ⊇ observed. That is the hole.

**Problem statement.** A run whose runner performed a protected effect (merge, branch-delete, pr-create) without ever asking Commissaire for a grant can still conclude as `conformed_to_contract`, provided it declared and observed the effect; grants are enforced only at the `merge-gate` chokepoint, which a non-merge path can sidestep. This change makes `conclude` refuse unless every observed protected effect has a matching signed grant earlier in the chain. It closes the gap between what `conformed_to_contract` claims and what it verifies.

**Design principles.**

- **Fail closed at conclude, like the chokepoint does.** The merge-gate already fails closed for a governed run with no covering grant (`absent-or-invalid`, `merge-gate.js:965-974`). `conclude` is the backstop for every protected effect, including those that reached the ledger by a path with no chokepoint. A missing grant must refuse, never pass by omission.
- **One home for the protected-kinds rule.** Which effect kinds are protected must be decided in exactly one place that both the chokepoints and `conclude` can consult, so the two enforcement points can never drift. (See §3 and the Open Questions.)
- **Never re-verify by re-deriving.** Reuse the existing signed-grant verifier `chokepointPermit` (`commissaire.ts:338`) rather than hand-rolling a second signature/fingerprint/coverage check. Two implementations of "does this grant cover this effect" would be a correctness hazard.
- **Backward compatibility is a hard constraint, not a nicety.** Already-concluded runs, legacy-kind conclusions, and the frozen v0.1/v0.2 fixtures must behave exactly as today. The new check must sit *after* the idempotent re-conclude early-return so a re-conclude never reaches it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (emit `.js`) | Houses `cmdTerminalVerdict` (conclude), `chokepointPermit`, the selftest, and the `verdict conclude` help text |
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript (committed emit) | The governed artifact; rebuilt from the `.ts` and committed alongside |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript (hand-authored, no emit) | Governance-region module: `EFFECT_KINDS`, `computeEscapes`, `effectTargetMatches`, `matchesUnit`, `conclusionKindOf`; imported by both `commissaire.ts` and `merge-gate.js` |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveGrantByEffectKind` / `chokepointPermit` usage — the existing grant-enforcement pattern conclude mirrors |
| `docs/reference/GLOSSARY.md` | Markdown | The "conformed to contract" row (line 17) carrying the plain-English meaning |
| `test/commissaire-conclusion-kind.test.mjs` | Node test | The canonical conclude fixture + the `MEANING`/`EXPLANATION` pinned strings (lines 27-28) |

**Scope statement.** This is one new precondition inside `cmdTerminalVerdict`, plus a single-source protected-kinds predicate it shares with the chokepoints, plus the three-site string restoration FAFF-1221 deferred.

## 2. OUT OF SCOPE

- **Aligning the merge-gate chokepoints to consult the new protected-kinds predicate.** *Why excluded:* the chokepoints already enforce per-kind grants correctly (`resolveGrantByEffectKind`, the pr-create leg); re-pointing them at the shared predicate is a refactor with its own blast radius, not part of closing the conclude hole. *Extension point:* `merge-gate.js:959-994`, where `resolveGrantByEffectKind` and its per-kind wrappers live.
- **Expanding the protected set to the high-consequence kinds the runner does not yet govern** (deploy, db-migration, secret-rotation, force-push, prod-script, registry-publish, email, webhook). *Why excluded:* no current runner path requests grants for these, so protecting them now would newly refuse runs that legitimately observe them ungoverned. *Extension point:* the `PROTECTED_EFFECT_KINDS` set in `effects.js` — adding a member is a one-line change once the runner governs that kind.
- **Writing a negative `outcome_rejected` / refusal record to the ledger.** *Why excluded:* a refusal is a completed evaluation that writes nothing, per the existing convention (`commissaire.ts:839-841`). *Extension point:* `refuseVerdict` (`commissaire.ts:848`).
- **Adding a whole-chain `verifyEffectsChain` gate to conclude.** *Why excluded:* conclude does not verify the whole chain today; each grant's own signature is verified per-record via `chokepointPermit`, and adding a chain gate could newly refuse legacy/mixed ledgers. *Extension point:* `verifyEffectsChain` is already imported at `commissaire.ts:73` if a future ticket wants it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| protected effect | An observed effect whose `kind` is in `PROTECTED_EFFECT_KINDS` — a grant is required for it to conclude cleanly. |
| covering grant | A signed `effect-decision-verdict` record, author `commissaire`, `payload.verdict === "grant"`, whose `payload.effect` descriptor matches the observed effect under `chokepointPermit`, appended earlier in the chain than the observation. |
| grant coverage | The property that every observed protected effect for the unit has a covering grant. The new conclude precondition. |

**The protected-kinds predicate (new, in `effects.js`).**

```
CONSTANT PROTECTED_EFFECT_KINDS: Set<EffectKind> = { "merge", "branch-delete", "pr-create" }
FUNCTION isProtectedKind(kind: string) -> boolean = PROTECTED_EFFECT_KINDS.has(kind)
```

- Defined once in `effects.js` (the governance-region module both `commissaire.ts` and `merge-gate.js` already import) and added to its `module.exports`.
- Members are exactly the kinds FAFF-1225 names and the runner governs today. Every other `EFFECT_KIND` (including the explicitly-unprotected tracker-write, label-write, push) is unaffected.

**The covering-grant result (shape returned by the new helper).**

```
RECORD UncoveredEffect:
  effect: EffectDescriptor     # the observed protected effect with no covering grant
  seq: integer                 # the observe record's seq
  sub_reason: enum { "no-grant", "denied", "descriptor-mismatch", "grant-after-effect" }

RECORD GrantCoverage:
  covered: boolean             # true iff uncovered is empty
  uncovered: UncoveredEffect[] # one entry per observed protected effect lacking a covering grant
```

**Design decision — single source for the protected-kinds rule.**

The ticket's open question is whether protected kinds come from the level policy or a fixed list, with the stated default being "the level policy, so the rule stays in one place". Verified against the code: `evaluateLevelPolicy` (`commissaire.ts:318-331`) keys only on `level`/`attended`/`holdout` and never on effect kind, so "the level policy" cannot literally hold the kind set without overloading a cohesive pure core. The underlying intent — one home — is honoured by a named set in the governance region instead.

**Chosen:** a single `PROTECTED_EFFECT_KINDS` set + `isProtectedKind()` predicate exported from `effects.js`, consulted by `conclude` (and available to the chokepoints as a follow-up). *Rationale:* `effects.js` is the one module both enforcement points already import; the set lives in one place and cannot drift. *Rejected:* extending `evaluateLevelPolicy` to carry the kind set — it keys on level/attendance/holdout, kinds would be smeared across its branches, and it still would not be "one place".

The **membership** of the set and the departure from the ticket's literal "level policy" default are carried as a non-blocking Punt in Open Questions, since the ticket itself flagged this as open and a reviewer should ratify the chosen members.

## 4. HOW — Behavior

**Architecture.** The change adds one precondition to `cmdTerminalVerdict` and one pure-ish helper that composes the existing `chokepointPermit` with a ledger filter mirroring `resolveGrantByEffectKind` (`merge-gate.js:959-986`).

**Placement in `cmdTerminalVerdict` (`commissaire.ts:858-926`).** The current precondition order is: run dir → `--unit-id` → evidence present → idempotent re-conclude early-return → producer resolution → admission → **escapes** → governor present → pk-fingerprint agreement → single contract revision → append. The new grant-coverage check is inserted **after the pk-fingerprint-mismatch check (step 9, `:899-905`)** and before the conclusion record is built (`:916`).

**Chosen:** insert the grant-coverage precondition immediately after the pk-fingerprint agreement check. *Rationale:* the check needs the governor's trusted public key and its pinned fingerprint to verify grant signatures; `concludedKey` (the governor PK, resolved at `:869`) and `gov.pk_fingerprint` (read at `:891`) are both in hand only after steps 8-9. Placing it last among the preconditions also keeps every cheaper existing refusal (`no-evidence`, `producer-not-admitted`, `unreconciled-escape`, `no-governor`, `pk-fingerprint-mismatch`) firing first and unchanged. *Rejected:* placing it right after the escape check (step 7) — the governor PK is not yet resolved there, forcing a second governor read.

**Behavior summary.** Enumerate the unit's observed protected effects; for each, require a signed covering grant earlier in the chain; if any lacks one, refuse with a single named reason carrying per-effect detail; otherwise fall through to the existing append unchanged.

```
PROCEDURE grant_coverage(ledger, unit, govPk, pinnedFingerprint):
  # govPk is concludedKey (the governor public key); pinnedFingerprint is gov.pk_fingerprint
  grants  = [ e in ledger WHERE e.schema == 3
                            AND e.author == "commissaire"
                            AND e.kind_of_entry == "effect-decision-verdict"
                            AND matchesUnit(e, unit) ]           # sorted ascending by seq
  observed = [ e in ledger WHERE e.kind_of_entry == "observe"
                            AND matchesUnit(e, unit)
                            AND isProtectedKind(e.effect.kind) ]

  uncovered = []
  FOR each o in observed:
    candidates = grants WHERE grant.seq < o.seq                  # earlier in the chain
    IF any c in candidates WHERE chokepointPermit(o.effect, c, govPk, pinnedFingerprint).permit:
       CONTINUE                                                  # covered
    uncovered.append({ effect: o.effect, seq: o.seq,
                       sub_reason: classify(o, grants) })
  RETURN { covered: uncovered.isEmpty(), uncovered }

PROCEDURE classify(o, grants):
  # best-effort detail; the top-level refusal reason is the same regardless
  sameKind = grants WHERE grant.payload.effect.kind == o.effect.kind
  IF sameKind.isEmpty():                                   RETURN "no-grant"
  IF any g in sameKind WHERE g.seq < o.seq
        AND g.payload.verdict == "deny":                   RETURN "denied"
  IF any g in sameKind WHERE g.seq < o.seq
        AND g.payload.verdict == "grant"
        AND NOT effectTargetMatches(g.payload.effect.target, o.effect.target):
                                                            RETURN "descriptor-mismatch"
  IF any g in sameKind WHERE g.seq >= o.seq
        AND g.payload.verdict == "grant":                  RETURN "grant-after-effect"
  RETURN "no-grant"
```

Coverage is by descriptor (kind + target via `effectTargetMatches`), not by step — matching `chokepointPermit`'s own semantics, so a grant requested at one step still covers the same descriptor observed at another. "Earlier in the chain" is `grant.seq < observe.seq`: a grant minted after the effect was performed (ask-forgiveness) does not count, and surfaces as `grant-after-effect`.

**The precondition, inside `cmdTerminalVerdict`:**

```
# after the pk-fingerprint-mismatch check, before building `body`
coverage = grant_coverage(ledger, issue, concludedKey, str(gov.pk_fingerprint))
IF concludedKey == null OR NOT coverage.covered:
    RETURN refuseVerdict("ungranted-protected-effect", issue,
                         { uncovered: coverage.uncovered })   # exits 0, writes nothing
```

**Design decision — the refusal reason.**

**Chosen:** a single top-level reason, `ungranted-protected-effect`, carrying an `uncovered` detail array (each entry `{ effect, seq, sub_reason }`). *Rationale:* mirrors the existing `refuseVerdict` detail-bag convention (`unreconciled-escape` carries `{ escapes: [...] }`), keeps the refusal vocabulary small, and the four test scenarios all share one semantics — "a protected effect has no valid covering grant" — distinguished by machine-readable detail, not by reason name. The DoD's "a named reason" (singular) is satisfied. *Rejected:* separate top-level reasons per case (`ungranted` / `denied-grant` / `descriptor-mismatch`) — proliferates the vocabulary for what is one failure with four explanations.

**Edge cases.**

- `concludedKey == null` (no resolvable governor PK): refuse (fail closed). The `no-governor` setup error (exit 2) already fires earlier when there is no governor record at all; this guards the residual null-PK case.
- Observed protected effect that is also an escape (observed, not declared): already refused by the earlier escape check (step 7), so by the time the grant check runs, every observed protected effect was declared. The two checks compose into the full custody chain: declared ⊇ observed, and granted ⊇ observed-protected.
- Unprotected observed effects (tracker-write, label-write, push): never enter `observed`, so they are unaffected.
- Idempotent re-conclude: the authenticated-conclusion early-return (`:870-871`) precedes this check, so a re-conclude never reaches it — behaviour is byte-identical to today.

**Failure modes.**

- **The grant-coverage check silently passes a run it should refuse because the ledger filter misses a grant shape.** *How you'd know:* the "never requested" scenario test concludes successfully instead of refusing. *What it means:* the `effect-decision-verdict` / `author === "commissaire"` / `schema === 3` filter is wrong; narrow against the fixture the chokepoint uses (`resolveGrantByEffectKind`).
- **The new check refuses a legacy or already-concluded run.** *How you'd know:* tests 1-3 and 7b in `commissaire-conclusion-kind.test.mjs` fail. *What it means:* the check ran before the idempotent early-return, or the frozen fixtures observe protected effects without grants and reached a first-time conclude; verify the early-return ordering holds.
- **The protected set is wrong (too wide).** *How you'd know:* a previously-passing governed run that observes, say, a deploy now refuses. *What it means:* `PROTECTED_EFFECT_KINDS` picked up a kind the runner does not grant for; narrow to the three named kinds.

**Anti-pattern:** re-implementing signature/fingerprint/coverage verification inside the new helper. Why: `chokepointPermit` already does exactly this and is the shared trust primitive; a second copy will drift from it.

**Anti-pattern:** making the GLOSSARY row byte-identical to the `EXPLANATION` constant. Why: the GLOSSARY sentence has its own shape (a colon after "contract" and the longer tail "accepted, reviewed or judged for quality"); only the shorter `MEANING` fragment is shared across sites. See §6 string decision and the HOW string edits.

## 5. Scenarios

```
Given a governed run that declared, was granted, and observed a merge to the same target
When conclude runs for the unit
Then it appends one signed conformed_to_contract record and the effects chain verifies
```

```
Given a governed run that declared and observed a protected merge but never requested a grant
When conclude runs for the unit
Then it refuses with reason "ungranted-protected-effect" and sub_reason "no-grant", and writes nothing
```

```
Given a governed run whose grant request for the merge was denied, yet the merge was observed anyway
When conclude runs for the unit
Then it refuses with reason "ungranted-protected-effect" and sub_reason "denied", and writes nothing
```

```
Given a governed run granted a merge to target "other" but observing a merge to target "main"
When conclude runs for the unit
Then it refuses with reason "ungranted-protected-effect" and sub_reason "descriptor-mismatch", and writes nothing
```

- An unprotected observed effect (a tracker-write) never triggers the grant check: a run that observes only unprotected effects concludes unchanged.

## 6. Design Decision Rationale

**Where does the protected-kinds rule live?** Options: (a) a named set in `effects.js`; (b) extend `evaluateLevelPolicy`. (a) puts it in the one module both enforcement points import; (b) overloads a level-keyed pure core with kind classification and still spreads kinds across branches. **Chosen:** (a) `PROTECTED_EFFECT_KINDS` + `isProtectedKind()` in `effects.js`.

**How is "covered" decided?** Options: (a) reuse `chokepointPermit` per candidate grant; (b) a fresh coverage check. (a) shares the exact signature/fingerprint/grant/descriptor logic the chokepoint uses; (b) risks drift. **Chosen:** (a), composed with a `resolveGrantByEffectKind`-style ledger filter and a `grant.seq < observe.seq` ordering gate.

**One refusal reason or several?** **Chosen:** one reason `ungranted-protected-effect` with a per-effect `sub_reason` detail bag — matches the existing detail-bag convention and keeps the vocabulary small while staying test-distinguishable.

**Exact restored wording of the plain-English meaning.** FAFF-1221 decision 2 and the FAFF-1225 DoD require the meaning to read "declared, granted and observed" once this lands. The current `MEANING` ends "declared, with no escapes"; naively inserting "granted" and keeping "it observed" would double "observed". **Chosen:**
  - New `MEANING` (the fragment shared across all three sites): `every protected effect was declared, granted and observed, with no escapes`
  - New `EXPLANATION` (the full help/test string, at `commissaire.ts:575` and `test` line 28): `conformed_to_contract: the run kept to its contract; every protected effect was declared, granted and observed, with no escapes. It does not mean the work was accepted.`
  *Rationale:* dropping "it observed" in favour of the plain subject "every protected effect was declared, granted and observed" restores "granted" cleanly and avoids the "observed ... observed" doubling. *Rejected:* `...it observed was declared, granted and observed...` (reads as a stutter).

  **The three sites, edited together, with the `MEANING` fragment byte-identical across all three:**
  1. `commissaire.ts:575` — the indented `conformed_to_contract:` line in the `verdict conclude` help; replace with the new `EXPLANATION` (keep the leading-space indent and trailing `\n`). Then rebuild the `.js` emit.
  2. `docs/reference/GLOSSARY.md:17` — the "conformed to contract" row; swap only its embedded `MEANING` fragment from "every protected effect it observed was declared, with no escapes" to the new `MEANING`. Keep the row's own sentence shape (the colon after "contract", the "accepted, reviewed or judged for quality" tail, the FAFF-1221 legacy-name sentence). This row is NOT the `EXPLANATION` constant; do not make it identical to it.
  3. `test/commissaire-conclusion-kind.test.mjs:27-28` — update the `MEANING` and `EXPLANATION` constants to the new strings. Assertion 6 counts each exactly once in `commissaire --help`; since `MEANING` is a substring of `EXPLANATION` and the help prints `EXPLANATION` once, both counts stay 1.

**Backward compatibility.** **Chosen:** the new check sits after the authenticated-conclusion idempotent early-return, so re-concluding an already-concluded run (current or legacy kind) is unchanged; per-grant intactness is established by `chokepointPermit`'s own signature + fingerprint verification plus `seq` ordering, with no new whole-chain gate, so legacy/mixed ledgers are not newly refused. *Rejected:* a whole-chain `verifyEffectsChain` gate at conclude — out of scope, risks refusing legacy chains.

**The canonical fixture must now mint a grant.** Verified: `governedCleanRun` (`test` lines 45-53) does admit `--scope merge` → declare merge → observe merge, with no grant, and tests 7a and 7c expect conclude to succeed. Under the new rule that run would refuse. **Chosen:** insert an `effect authorize` step (grant for `{kind:"merge",target:"main"}`) into `governedCleanRun` between declare and observe, so the shared happy-path fixture keeps concluding cleanly; the "never requested" scenario uses a variant fixture that omits the authorize.

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt:** membership of `PROTECTED_EFFECT_KINDS`, and the departure from the ticket's literal "level policy" default — needs human (decides: architecture). *Context:* the ticket flagged this as open. The recommended, build-ready default is the explicit set `{ merge, branch-delete, pr-create }` (exactly the kinds the ticket names and the runner governs today), with the single-source mechanism fixed as Chosen in §3. This Punt is **non-blocking**: the builder proceeds with the recommended set, and a reviewer can add or remove members (a one-line change) without reshaping the design. It is recorded because the ticket raised it and because choosing a fixed set over the stated "level policy" default is a judgement a human should ratify.

**Assumptions.**

- **Assumes:** `concludedKey` (from `commissairePublicKey`, `commissaire.ts:869`) is the governor's public key for a governed run, and `gov.pk_fingerprint` is the pinned fingerprint. *Validation:* confirm `chokepointPermit(effect, grant, concludedKey, gov.pk_fingerprint)` permits in the happy-path scenario test before relying on it in `cmdTerminalVerdict`.
- **Assumes:** `effects.js` is hand-authored with no `.ts` and no emit step, while `commissaire.ts` requires `effects` already. *Validation:* `grep` the `require("./effects")` import in `commissaire.ts`; add `PROTECTED_EFFECT_KINDS`/`isProtectedKind` to the `effects.js` `module.exports` and import them in `commissaire.ts`.

## 8. DONE — Definition of Done

### From WHAT (types and interfaces)
- [ ] `PROTECTED_EFFECT_KINDS` (= `{ merge, branch-delete, pr-create }`) and `isProtectedKind()` are defined in `effects.js`, exported, and imported by `commissaire.ts`.

### From HOW (behaviour)
- [ ] `cmdTerminalVerdict` enumerates the unit's observed effects whose `kind` satisfies `isProtectedKind`, and for each requires a signed covering grant with `seq` earlier than the observation.
- [ ] Coverage is verified via `chokepointPermit` against `concludedKey` + `gov.pk_fingerprint` (no second signature/coverage implementation).
- [ ] A run where every observed protected effect has a covering grant concludes exactly as today (one signed `conformed_to_contract` record appended; `verifyEffectsChain(runDir,{}).status === "verified"`).
- [ ] A missing, denied, descriptor-mismatched, or after-the-effect grant refuses with reason `ungranted-protected-effect`, carries an `uncovered` detail array with the per-effect `sub_reason`, exits 0, and writes nothing.
- [ ] The check sits after the pk-fingerprint-mismatch check and after the authenticated-conclusion idempotent early-return.

### From HOW (edge cases / backward compat)
- [ ] Unprotected observed effects (tracker-write, label-write, push) never trigger a refusal.
- [ ] Re-concluding an already-concluded run (current or legacy kind) is byte-identical to today (tests 1, 2, 3, 7b, 7c pass unchanged in behaviour).
- [ ] `governedCleanRun` is updated to mint a merge grant so tests 7a/7c still conclude cleanly.

### From string restoration (FAFF-1221 decision 2)
- [ ] `commissaire.ts:575` carries the new `EXPLANATION`; the `.js` emit is rebuilt and committed.
- [ ] `docs/reference/GLOSSARY.md:17` carries the new `MEANING` fragment, keeping its own sentence shape.
- [ ] `test` constants `MEANING` (line 27) and `EXPLANATION` (line 28) are updated to the new strings, byte-identical where shared.
- [ ] `commissaire --help` prints `EXPLANATION` exactly once and `MEANING` exactly once (assertion 6 passes).

### From tests
- [ ] Node test covers the four scenarios: granted (concludes); never requested (`no-grant`); denied then performed (`denied`); grant for a different descriptor (`descriptor-mismatch`).
- [ ] The in-process selftest (`commissaireSelftest`, `commissaire.ts:1169`) gains pure-leg coverage for the grant-coverage helper (covers; no-grant; denied; descriptor-mismatch; grant-after-effect) and a conclude leg on the existing CLI round trip (granted → concludes; a no-grant variant → refuses).

### From build / process
- [ ] `cd plugin/skills/faff && npm install && npm run build` run; regenerated `commissaire.js` and `build-manifest.json` committed alongside the `.ts`; `faff regions check` passes.
- [ ] Every commit carries a `Signed-off-by` trailer (DCO).

**Integration smoke test.**

```
PROCEDURE smoke():
  runDir = fresh governed run
  commissaire admit    --run-dir runDir --producer P1 --contract-revision r1 --scope merge
  commissaire effect declare   ... --step merge   (stdin: [{kind:"merge",target:"main"}])
  commissaire effect authorize ... --step merge   (stdin: {effect:{kind:"merge",target:"main"}})  -> verdict grant
  commissaire effect observe   ... --step merge   (stdin: [{kind:"merge",target:"main"}])
  r = commissaire verdict conclude --run-dir runDir --unit-id FAFF-1
  ASSERT r.verdict == "conformed_to_contract"
  ASSERT verifyEffectsChain(runDir,{}).status == "verified"
```

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" }
  ] }
```
