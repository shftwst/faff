# Spec: Promote faff's own runner onto the Commissaire facade at every level that causes a protected effect (FAFF-1034)

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1034.

This is a buildable spec for the coding agent that will implement FAFF-1034, and for the human reviewers who must sign off the key-custody posture. It targets the runner skills (`faff-graft`, `faff-beep-boop`) and small, honest extensions to the Commissaire facade (`commissaire.js`) and the merge chokepoint (`merge-gate.js`, `contract-defs.js`), building on the fully-shipped FAFF-828 facade rather than rebuilding it.

## 1. WHY - Problem and Principles

**The load-bearing model.** Commissaire is a two-party protocol. A *producer* makes authenticated claims (HMAC under `K_producer`); a *governor* (Commissaire) signs grant/deny decisions (Ed25519 under `SK_commissaire`); a *chokepoint* on the effect path permits the effect only against a verified covering grant. faff already ships all three parts and drives none of them on its own runs. The producer half is inert on every faff run. This ticket wires faff's runner in as the producer, at every level, for the merge effect first, and closes the fail-open hole so that once a run is governed, a merge without a covering grant is blocked, not silently passed.

**Problem statement.** faff ships a working unforgeable-decision protocol and its own orchestrator never drives the producer half, so `resolveCommissaireDecisionGrant` returns `not-applicable` (a pass) on every faff merge and the verifying chokepoint is inert. This change makes faff's runner `admit` at run start, `declare` / `authorize` / `observe` / `reconcile` its merge effect at every level, flips a covered merge to `valid-grant`, and makes an uncovered merge on a governed run fail closed. It decides key custody explicitly and claims in docs exactly the posture that custody earns.

**Design principles (these will cause an otherwise-valid implementation to be rejected):**

- **The posture claimed in docs must equal what custody earns.** The shipped slice uses an in-process governor (custody option 3). Docs must claim the option-3 gain (authenticated, author-bound, hash-chained, externally verifiable, mechanically mediated at the chokepoint) and must NOT claim independence or unforgeability against the orchestrator. Shipping option 3 while describing it as option 1 is the one failure the ticket forbids, and it is a named pre-merge review step (section 8).
- **A governed merge has no silent-pass state.** Every merge in a governed run either carries a covering schema:3 grant (passes as `valid-grant`) or is blocked (fail closed). There is no third state where an ungranted governed merge reads clean and merges anyway. An ungoverned run is byte-for-byte unchanged (`not-applicable` -> pass).
- **Record production happens at every level; policy scales with level.** `admit` / `declare` / `authorize` / `observe` / `reconcile` run L1 to L4. The level is a policy input to `authorize` (an L1 attended merge is granted on human presence; an L4 lights-out merge requires the holdout floor). The level never decides *whether* a governed record is produced.
- **Do not fork the pure decision core.** `evaluateDecisionRequest` is the born-verifiable heart and stays pure and effect-integrity-only. The fail-closed change and the level policy live in the chokepoint resolver, the floor, and a composable sibling function, never in the pure legs.
- **Build on the shipped facade; do not rebuild it.** admit, the schema:3 envelope, the split-key cores, the chokepoint, `audit verify`, and the merge floor leg all exist. This work is runner wiring, one composable policy leg, and one fail-closed leg on the resolver/floor, not new cryptography.
- **One declaration lineage per covered merge; a trail for everything else.** A covered governed merge is declared once (schema:3), so `computeEscapes` does not double-count. An uncovered merge still leaves a schema:2 trail as defence-in-depth (it is also blocked).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript (Node) | The facade producer half. `cmdAdmit` (:427), `cmdRequestDecision`/`effect authorize` (:502), `evaluateDecisionRequest` (:130, stays pure), `chokepointPermit` (:174), `cmdReconcile` (:541), `cmdTerminalVerdict` (:565), `hasGovernanceContext` (:240). |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (Node) | `resolveCommissaireDecisionGrant` (:831): today returns `not-applicable` when no verdict exists (:837). This ticket adds a governed-run fail-closed leg. Schema:2 merge auto-declare/observe (`autoDeclareMergeEffects`/`observeMergeEffects`, :783-818) sits in the shared `cmdMergeGate` execute path. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (Node) | `decideFloor` (:2303): `decision_grant === "absent-or-invalid"` blocks (:2314); the L4-keyed holdout leg (:2311) is the precedent for level-scaled policy. `resolveGateLevel` (:2327). |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript (Node) | `EFFECT_KINDS` (merge, branch-delete already present), `computeEscapes` (:95), `effectTargetMatches`. |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | Step 10 merge locus: already declares the schema:2 merge effect and hands to `ship` -> `merge-gate --execute`. admit attaches at the graft run-substrate mint. |
| `plugin/skills/faff-beep-boop/SKILL.md` | Skill prose | Run-start mint (`run-ledger init-self-drain`, stamps `level`), run-close close (`anchor-run`, `bundle publish --boundary-kind run-close`, `judge-trail mint`). |

**Scope statement.** This sits at the seam between faff's orchestration skills and the Commissaire governance facade, turning the runner from an ungoverned first producer into a governed one for the merge effect, with the chokepoint failing closed on an ungranted governed merge.

## 2. OUT OF SCOPE

- **Governed record production for non-merge protected effects** (push build-complete, push anchor-head, PR-create, tracker status/label writes, ADR/PRDR commits). Why excluded: none has a chokepoint today, so wiring their producer half yields governed records but no born-verifiable prevention signal; adding chokepoints for each is a substantial separate slice. Extension point: reuse this ticket's effect-agnostic `admit` / `reconcile` / `conclude` scaffolding and the fail-closed resolver pattern; add the effect kind (or map to `other`) in `EFFECT_KINDS` (`effects.js`) and a per-effect chokepoint modelled on `resolveCommissaireDecisionGrant`. Filed as a follow-on stub (section 7).
- **The out-of-process / separate-host governor (custody option 1) and the repo-pinned-PK variant (option 2).** Why excluded: both require standing up a signing authority outside the runner process, an infrastructure and operational decision the human owns. Extension point: the existing `--governor-dir` flag on every facade verb already relocates `SK_commissaire` out of the run dir. Marked `**Punt:**` in section 7 and filed as a follow-on stub.
- **New effect kinds for push and PR-create.** Why excluded: only the merge effect (and the merge-coupled branch-delete, both already in `EFFECT_KINDS`) is governed here. Extension point: `EFFECT_KINDS` in `effects.js`.
- **Changing `evaluateDecisionRequest`'s pure legs.** Why excluded: the pure grant/deny core is correct and is the conformance oracle for `audit verify`. This remains explicitly out of scope even though the fail-closed change touches the chokepoint resolver and the floor: the resolver and `decideFloor` are NOT the pure core. Extension point: the fail-closed leg lands in `resolveCommissaireDecisionGrant`/`decideFloor`; the level policy composes in `cmdRequestDecision` above the untouched pure legs (section 3, section 4).

## 3. WHAT - Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Governed run | A run whose run dir carries a schema:3 governance context (`hasGovernanceContext(runDir)` is true), i.e. `admit` has run. |
| Covered merge | A merge for `(issue, "merge")` that carries a covering schema:3 `effect-decision-verdict` grant whose effect matches `{kind:"merge", target}`. |
| Fail closed | On a governed run, a merge with no covering grant returns a blocking resolver state (`absent-or-invalid`), which `decideFloor` refuses. |
| Producer half | The runner-driven sequence admit -> declare -> authorize -> observe -> reconcile -> conclude. |
| In-process governor (option 3) | `SK_commissaire` and the HMAC master live in `<runDir>/commissaire/governor`, minted and read by the same process that orchestrates the run. The shipped custody. |
| Level policy | A per-level predicate (attended presence at L1/L2, floor at L3, holdout at L4) that gates the `authorize` verdict, composed with the pure decision core. |
| Born-verifiable signal | On a governed covered merge, `resolveCommissaireDecisionGrant(runDir, issue, "merge") === "valid-grant"`; on a governed uncovered merge, it returns `absent-or-invalid` (blocks). |

**Runner producer identity (one per run):**

```
RECORD RunnerProducer:
  producer_id: String        # one stable id per run (recommend the run-id, or "faff-runner"); single-valued per run
  contract_revision: String  # one value per run, resolved once at admit; single-valued per run
  admitted_scope: Set<EffectKind>   # {"merge", "branch-delete"} for this ticket
  governor_dir: Path         # default <runDir>/commissaire/governor (option 3); the seam for option 1/2
  producer_dir: Path         # default <runDir>/commissaire/producer

  CONSTRAINT producer_id is single-valued across the run   # avoids conclude "ambiguous-producer"
  CONSTRAINT contract_revision is single-valued across the run  # avoids conclude "ambiguous-contract-revision"
  CONSTRAINT governor_dir != producer_dir   # cmdAdmit already refuses equality
```

**Level policy input, recorded in full in the payload (composable, does not alter the pure core):**

```
RECORD LevelPolicyInput:
  level: L1 | L2 | L3 | L4    # from run-ledger `level`, resolved via resolveGateLevel
  attended: Boolean           # the attendedness run-fact (faff verification resolve --json .unattended, negated)
  holdout: "meets-spec" | other | absent   # the L4 holdout verdict artifact, when present

PURE FUNCTION evaluateLevelPolicy(input) -> { pass: Boolean, reason: String }
  # L1/L2: pass iff attended
  # L3:    pass (base floor governs; no extra authority required)
  # L4:    pass iff holdout == "meets-spec"
```

The composed verdict is: `grant` iff `evaluateDecisionRequest(...) == grant` AND `evaluateLevelPolicy(...).pass`; otherwise `deny` with the first failing reason. The `level` AND its inputs (`attended`, `holdout`) AND the policy result are recorded in the `effect-decision-request` / `effect-decision-verdict` payload, so a `deny` whose pure legs all pass is replayable by a secret-free `audit verify` reviewer (which checks signature authenticity only, never re-evaluates the decision).

**Fail-closed chokepoint resolver (updated behaviour):**

```
FUNCTION resolveCommissaireDecisionGrant(runDir, issue, mergeTarget) -> State
  latestVerdict = latest schema:3 effect-decision-verdict for (issue, "merge")
  IF latestVerdict exists:
     # unchanged FAFF-828 path
     RETURN chokepointPermit(...) covers effect ? "valid-grant" : "absent-or-invalid"
  # NEW fail-closed leg — keyed on the run-scoped governance signal:
  IF hasGovernanceContext(runDir):
     RETURN "absent-or-invalid"   # governed run, no covering grant => BLOCK
  RETURN "not-applicable"         # ungoverned run => PASS, byte-for-byte unchanged
```

`decideFloor` is unchanged in structure: it already blocks on `decision_grant === "absent-or-invalid"` (contract-defs.js:2314), so the new resolver state routes through the existing floor leg. The pure `evaluateDecisionRequest` legs are untouched.

**Facade invocation surface used by the runner (existing verbs; a wider payload):**

```
faff commissaire contract admit  --run-dir DIR --producer ID --contract-revision R --scope merge,branch-delete
faff commissaire effect declare  --run-dir DIR --producer ID --issue I --step merge   (stdin: EffectDescriptor[])
faff commissaire effect authorize --run-dir DIR --producer ID --issue I --step merge --level L4  (stdin: {effect, evidence_seq?, level, attended, holdout})
faff commissaire effect observe  --run-dir DIR --producer ID --issue I --step merge   (stdin: EffectDescriptor[])
faff commissaire effect reconcile --run-dir DIR --issue I
faff commissaire verdict conclude --run-dir DIR --issue I
```

**Design decisions (each concluded with a canonical marker; collected in section 6).**

- **Custody for the shipped slice.** **Chosen:** option 3 (in-process governor) with docs claiming exactly the option-3 gain and NOT independence.
- **The independence upgrade (option 1 / option 2).** **Punt:** stand up an out-of-process signer behind `--governor-dir` in a follow-on; recommend option 1. `(decides: security)`
- **Fail closed at the chokepoint for governed runs.** **Chosen:** add the governed-run fail-closed leg to `resolveCommissaireDecisionGrant`/`decideFloor`; ungoverned runs unchanged.
- **Level as a decision input.** **Chosen:** the composable `evaluateLevelPolicy` above the pure core.
- **Per-level policy content.** **Chosen:** presence at L1/L2, base floor at L3, holdout `meets-spec` at L4 (tunable).
- **Shared ledger collision / suppression granularity.** **Chosen:** suppress schema:2 per covered merge (only when a schema:3 grant exists), so an uncovered merge still leaves a schema:2 trail.
- **reconcile authority.** **Chosen:** schema:3 `effect reconcile` authoritative for governed effects; `faff effects reconcile-merges` retained as the ungoverned backstop.
- **Run-close sealing.** **Chosen:** reuse `bundle publish --boundary-kind run-close`; do NOT wire `audit seal`.
- **admit idempotency on resume.** **Chosen:** admit only on a genuine mint; skip when governor material exists; never `--force`.
- **conclude cleanliness.** **Chosen:** single producer_id and contract_revision per run; `conclude` per issue.
- **Scope split.** **Chosen:** merge governed at L1 to L4 in this ticket; other effects a follow-on. The four edit surfaces ship together as one increment.

## 4. HOW - Behavior

**Architecture.** Four edit surfaces, shipped as one increment (the born-verifiable signal exists only when all land):

1. `commissaire.js`: add the pure `evaluateLevelPolicy`, accept `--level` and the `attended`/`holdout` inputs in `cmdRequestDecision`'s authorize stdin, compose the level policy with `evaluateDecisionRequest`, and record `level` + inputs + result in the request/verdict payload. No change to `evaluateDecisionRequest`'s legs or signature.
2. `merge-gate.js`: add the governed-run fail-closed leg to `resolveCommissaireDecisionGrant`; gate the schema:2 merge auto-declare/observe (`autoDeclareMergeEffects`/`observeMergeEffects`) per covered merge (suppress only when a covering schema:3 grant exists for that `(issue, "merge", target)`).
3. `contract-defs.js`: no structural change to `decideFloor`; confirm the new `absent-or-invalid` state routes through the existing blocking leg (2314).
4. `faff-graft/SKILL.md` and `faff-beep-boop/SKILL.md`: drive the producer half at the run boundaries and the merge locus, and ship the option-3 docs posture.

**Governed-merge invariant (state it in code comments and docs).** On a governed run, every merge is either covered (carries a schema:3 grant -> `valid-grant` -> passes) or blocked (fail closed). There is no silent-pass third state. Run-wide suppression of schema:2 would be safe under this invariant, but the chosen suppression is per-covered-merge as defence-in-depth: an uncovered merge that somehow reaches the execute path still leaves a schema:2 trail and is still blocked by the fail-closed leg.

**Run-start admit (both substrates), idempotent by skip.**

```
PROCEDURE admit_at_run_start(run_dir, level):
  1. IF hasGovernanceContext(run_dir) OR governor file exists:
       RETURN            # resume / inherited-L4 reuse / endgame re-entry: never re-admit, never --force
  2. resolve producer_id (one per run; recommend run-id or "faff-runner")
  3. resolve contract_revision (one per run)
  4. run: commissaire contract admit --run-dir <run_dir> --producer <id>
          --contract-revision <rev> --scope merge,branch-delete
  5. a non-zero admit exit is logged and the run proceeds ungoverned (evidence, not a gate)
```

- beep-boop: attach after the `run-ledger init-self-drain` mint (which stamps `level`), on a genuine mint only.
- graft: attach at its own `run-ledger init-interactive` mint; a dispatched lane inherits the beep-boop run dir and admission (no second admit).
- Consequence of fail-closed: once admit runs, every merge in the run MUST be driven through the producer half or it blocks. The merge locus therefore drives declare/authorize/observe unconditionally on a governed run.

**Governed merge locus (graft Step 10, top-level path).**

Behaviour summary: before the mechanical `merge-gate --execute`, the orchestrating step declares the merge effect, obtains a level-scaled signed grant, and (after the merge) observes it, so the chokepoint verifies a covering grant and an ungranted merge fails closed.

```
PROCEDURE governed_merge(run_dir, issue, pr, base, level, attended, holdout):
  1. build effect = { kind: "merge", target: base }   # merge-gate covers {kind:"merge", target: base}
     (plus { kind: "branch-delete", target: <head-branch> } iff --delete-branch is passed)
  2. commissaire effect declare  --run-dir R --producer ID --issue issue --step merge   <- [effect(s)]
  3. commissaire effect authorize --run-dir R --producer ID --issue issue --step merge --level <level>
        <- { effect, level, attended, holdout }
     # verdict = evaluateDecisionRequest(...) AND evaluateLevelPolicy({level, attended, holdout})
  4. IF verdict != grant:
       treat as a merge block (record the deny reason, park/loop per graft's existing merge-block routing)
  5. hand off to `ship` -> faff merge-gate ... --execute
     # covered: resolveCommissaireDecisionGrant returns "valid-grant"; decideFloor passes that leg
     # uncovered (bug/omission): resolver returns "absent-or-invalid" (governed) -> decideFloor blocks
     # merge-gate suppresses schema:2 auto-declare/observe for THIS covered merge (single lineage)
  6. after a shipped merge: commissaire effect observe --run-dir R --producer ID --issue issue --step merge <- [effect(s)]
```

- The schema:2 `faff effects declare --step merge` and merge-gate's schema:2 auto-declare/observe are suppressed only for a merge that carries a covering schema:3 grant. Ungoverned runs keep today's schema:2 behaviour unchanged.
- The `base` target in step 1 must match what merge-gate builds (`{kind:"merge", target: base}`; `--local` passes null and the grant's own target is used), so `effectTargetMatches` holds.

**Run-close (both substrates).**

```
PROCEDURE run_close(run_dir):
  1. per governed issue: commissaire verdict conclude --run-dir R --issue <issue>
  2. commissaire effect reconcile --run-dir R --issue <issue>   # schema:3 observed-minus-declared
  3. keep existing: faff effects reconcile-merges (off-ledger backstop for ungoverned merges)
  4. keep existing: bundle publish --boundary-kind run-close   # do NOT add `audit seal` (double-seal)
```

**Level resolution.** Read `level` via `resolveGateLevel(ledgerLevel, flagLevel)` (ledger level governs). Resolve `attended` from `faff verification resolve --json` (`.unattended`, negated). Resolve `holdout` from the per-issue holdout verdict artifact graft writes under the L4 signal. Pass `--level` and the inputs to `authorize`.

**Edge cases and error handling.**

- **Resume / inherited-L4 / endgame re-entry:** admit is skipped when governor material exists; records are never orphaned; `--force` is never passed.
- **admit fails:** logged; the run proceeds ungoverned; the resolver returns `not-applicable` (pass), exactly as today. Governance is additive.
- **Uncovered governed merge:** blocked by the fail-closed leg, never silently merged; routed through graft's merge-block handling.
- **authorize denies:** a completed governed decision, routed through merge-block handling, never a silent merge.
- **Multi-issue run:** one producer_id and one contract_revision across the run; `conclude` per issue; no `ambiguous-producer` / `ambiguous-contract-revision`.
- **`--local` (git-only) merge:** the grant's declared target is used when `base` is null; the level policy and fail-closed leg still apply.

**Failure modes - how the approach could be wrong, and how you would notice.**

- **The failure:** in-process custody is mistaken for independence. A reader believes a governed faff merge is unforgeable against the runner, when the runner holds `SK_commissaire` and could self-grant. **How you would know:** the README/docs claim prevention against the orchestrator, or omit the in-process caveat, at the named review step. **What it means:** narrow the claim to option-3 language before ship; this is the ticket's forbidden outcome and a blocking review-step AC.
- **The failure:** the fail-closed leg keys off the wrong signal and blocks ungoverned runs. **How you would know:** an ordinary ungoverned run's merge returns `absent-or-invalid` and refuses. **What it means:** the leg must key on `hasGovernanceContext(runDir)` and return `not-applicable` for ungoverned runs, byte-for-byte; fix the predicate.
- **The failure:** double-counted escapes on a covered merge. **How you would know:** a governed run's `effect reconcile` reports an escape for a merge that was declared and observed, or `conclude` refuses `unreconciled-escape`. **What it means:** the per-covered-merge schema:2 suppression is not wired; fix the gate.
- **The failure:** the chokepoint stays inert because the grant target does not match. **How you would know:** `resolveCommissaireDecisionGrant` returns `absent-or-invalid` on a covered merge you believe is granted. **What it means:** the declared/authorized target does not equal merge-gate's `{kind:"merge", target: base}`; align the target.

**Anti-pattern:** threading `level`, the fail-closed leg, or the level inputs into `evaluateDecisionRequest`'s pure legs. Why: it forks the born-verifiable core that `audit verify` is the conformance oracle for; the fail-closed leg belongs in the resolver/floor and the level policy in a composable sibling.

**Anti-pattern:** run-wide schema:2 suppression keyed on `hasGovernanceContext` alone. Why: `observeMergeEffects` is in the shared `cmdMergeGate` path reachable by other callers; per-covered-merge suppression keeps a trail for any uncovered merge.

**Anti-pattern:** passing `--force` to admit on resume. Why: it mints a fresh keypair and master and orphans every record signed under the old material.

## 5. Scenarios - born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governed faff run (admit ran with scope merge) building an issue to a mergeable PR,
      whose merge effect was declared and authorized (grant)
When merge-gate --execute evaluates the floor for that issue's merge
Then resolveCommissaireDecisionGrant(run_dir, issue, "merge") returns "valid-grant"
 And decideFloor sees decision_grant: "valid-grant" and does not block on that leg
```

```
Given an ungoverned faff run (admit never ran)
When merge-gate --execute evaluates the floor for a merge
Then resolveCommissaireDecisionGrant returns "not-applicable" and the merge passes that leg,
     byte-for-byte identical to pre-FAFF-1034 behaviour
```

```
Given an L1 attended governed run (attended = true)
When the runner calls effect authorize --level L1 for a merge whose base integrity legs pass
Then the composed verdict is grant, recording level, attended, and holdout in the payload
```

```
Given a run whose governor material already exists (a resume, inherited-L4, or endgame re-entry)
When admit_at_run_start runs
Then admit is skipped, no fresh keypair is minted, and no prior records are orphaned
```

```
Given a governed run whose merge was declared, authorized, and observed via the schema:3 facade
When effect reconcile runs at run close for that issue
Then no escape is reported for that merge (single lineage; schema:2 suppressed for the covered merge)
```

- The schema:3 governed trail MUST pass `faff commissaire audit verify` (secret-free replay), classifying commissaire decisions as verified and producer claims honestly, with `result: pass`; a `deny` whose pure legs pass is replayable because its level inputs are in the payload.
- Docs MUST state the option-3 posture (authenticated, author-bound, hash-chained, verifiable, mechanically mediated) and MUST NOT claim independence or unforgeability against the orchestrator.

## 6. Design Decision Rationale

**Which key custody does the shipped slice implement, and what posture may the docs claim?**

- Option 1 (out-of-process / separate-host governor): genuine E-B mediated prevention against the runner; most work (a signer daemon or host, an IPC protocol, key provisioning).
- Option 2 (governor key outside the run dir, PK pinned in repo): a forged grant is detectable, but only meaningful if `SK_commissaire` is minted and held by a non-runner identity and the pin is a repo-committed source the runner cannot rewrite per run; otherwise it collapses into option 3.
- Option 3 (in-process governor): the runner mints and holds `SK` and the master and signs verdicts itself.

**Chosen:** option 3 for this slice, with docs claiming exactly the option-3 gain. Rationale: faff's runner is the orchestrator, the untrusted party in the FAFF-1027 threat model. In-process custody cannot deliver independence: a runner that wanted to lie could self-grant. What it delivers is real and shippable now, at every level, with no new infrastructure: every record is authenticated and author-bound, the trail is hash-chained and externally verifiable via `audit verify`, and the merge chokepoint moves from inert to mechanically mediated with a fail-closed governed leg, which prevents an accidental, buggy, or (within a narrow boundary) externally-tampered merge, and makes the merge born-verifiable. Externally-tampered caveat: under option 3, `SK_commissaire` lives in the same `<runDir>/commissaire/governor` as the effect ledger, so the tamper resistance holds only against a tamperer who reaches the effect records but is walled from the co-located governor key; a tamperer with the run dir has both. Claiming more (independence against the orchestrator) would be the ticket's forbidden outcome. Temporal anchor: at the time of writing, faff has no out-of-process governor and the `--governor-dir` seam is unused by the runner.

**Should the independence upgrade ship in this ticket?**

**Punt:** no; the out-of-process signer (option 1, recommended over option 2) is a human-authored architecture and security decision. Recommendation: option 1, behind the existing `--governor-dir` seam, in a follow-on; option 2's meaningful form requires the same out-of-run signer, so it saves little. Collected in section 7. `(decides: security)`

**Should an ungranted governed merge pass or block?**

Options: leave `resolveCommissaireDecisionGrant` returning `not-applicable` for the no-verdict case (fail open, caught only post-hoc by the git backstop) vs a governed-run fail-closed leg. **Chosen:** fail closed. Rationale: the operator chose this direction; a governed run with a scoped merge that reaches `--execute` without a covering grant is the exact hole the protocol exists to prevent, and detection-only by the git backstop is not prevention. The leg keys on `hasGovernanceContext(runDir)` so ungoverned runs stay `not-applicable` -> pass, byte-for-byte. This reopens the earlier "resolver/floor unchanged" freeze deliberately, and touches only the chokepoint resolver and the floor routing, not the pure `evaluateDecisionRequest` legs.

**How does level attach as a decision input without forking the pure core?**

Options: thread `level` into `evaluateDecisionRequest` (forks the pure core and its `audit verify` oracle) vs a composable per-level policy leg above it. **Chosen:** the composable leg (`evaluateLevelPolicy`), composed in `cmdRequestDecision`. Rationale: `decideFloor` already keys its holdout leg on level without touching the pure core; this follows that precedent and keeps the born-verifiable heart pure. The level inputs are recorded in the payload for replay.

**What is the per-level policy content?**

**Chosen:** presence at L1/L2, base floor at L3, holdout `meets-spec` at L4 (tunable). Rationale: matches the ticket's worked examples; the mechanism (a composable, level-keyed, auditable policy leg with inputs recorded) is the load-bearing part.

**How is the schema:2 / schema:3 ledger collision resolved, and at what granularity?**

Options: run-wide suppression (`!hasGovernanceContext`) vs per-covered-merge suppression. **Chosen:** per-covered-merge: suppress schema:2 auto-declare/observe only for a merge that carries a covering schema:3 grant. Rationale: run-wide suppression is safe under the fail-closed invariant (an uncovered governed merge blocks), but `observeMergeEffects` is in the shared `cmdMergeGate` path reachable by other callers, so per-covered-merge suppression is defence-in-depth: an uncovered merge still leaves a schema:2 trail and is still blocked. The invariant is explicit: covered -> single schema:3 lineage; uncovered -> blocked (and, if ever reached, schema:2 trail retained).

**Which reconcile is authoritative at run close?**

**Chosen:** schema:3 `effect reconcile` for governed effects; `faff effects reconcile-merges` retained as the off-ledger backstop for a merge that escaped governance entirely. Rationale: removing the git detector would lose defence-in-depth against the very escape governance prevents.

**Does the runner need `audit seal` at run close?**

**Chosen:** no; reuse `bundle publish --boundary-kind run-close`. Rationale: the two produce the same run-close bundle bytes; wiring `audit seal` would double-seal. `audit seal` exists for external producers that lack `bundle publish`.

**How does admit handle resume?**

**Chosen:** admit only on a genuine mint; skip when governor material exists; never `--force`. Rationale: admit is non-idempotent, and `--force` rotates the keypair and master and orphans the trail.

**How is a clean single-producer, single-revision trail kept for `conclude`?**

**Chosen:** one producer_id and one contract_revision per run; `conclude` per issue. Rationale: `cmdTerminalVerdict` refuses ambiguity; a single identity and revision across the run's records avoids both while `conclude` filters per issue.

**Should this ship as one increment across the edit surfaces?**

**Chosen:** yes, one increment; do not split the four edit surfaces or the docs-posture leg. Rationale: the born-verifiable signal exists only when facade, chokepoint, floor routing, and runner wiring all land together; a partial merge would ship governed records with no fail-closed prevention, or prevention with no producer half. Scope is held to the merge effect at L1 to L4; other protected effects are a sequenced follow-on.

## 7. Open Questions and Assumptions

**Open Questions:**

- **Independence upgrade (custody option 1 vs option 2, and when).** **Punt:** the shipped slice is in-process (option 3) with honest option-3 docs. The upgrade to genuine E-B independence against the runner requires an out-of-process signer. Recommendation: option 1, behind the existing `--governor-dir` seam, in a follow-on ticket. This is a security and operational-cost call the human authors. File as a follow-on stub linked from FAFF-1034. `(decides: security)`

**Assumptions:**

- **Assumes:** the attendedness run-fact is resolvable via `faff verification resolve --json` (`.unattended`). Validate: run it in a run dir and confirm the `unattended` field is present before wiring the L1/L2 presence policy.
- **Assumes:** the per-issue holdout verdict artifact graft writes under the L4 signal is readable at authorize time. Validate: confirm the holdout artifact path graft's Step-10 holdout gate persists, and that it is written before the merge authorize call.
- **Assumes:** `autoDeclareMergeEffects` / `observeMergeEffects` in `merge-gate.js` can be gated per covered merge (a covering schema:3 grant lookup for the `(issue,"merge",target)`) without affecting ungoverned runs. Validate: read `merge-gate.js:783-818` and confirm both are called where the per-merge grant lookup can wrap them.
- **Assumes:** `hasGovernanceContext(runDir)` is the correct run-scoped signal for the fail-closed leg. Validate: read `commissaire.js:240` and confirm it returns true iff any schema:3 record exists (i.e. admit ran).

## 8. DONE - Definition of Done

### From WHY
- [ ] On a governed covered merge, `resolveCommissaireDecisionGrant(runDir, issue, "merge")` returns `valid-grant` and `decideFloor` sees `decision_grant: "valid-grant"`.
- [ ] On a governed run with no covering grant, `resolveCommissaireDecisionGrant` returns `absent-or-invalid` and `decideFloor` blocks the merge (fail closed).
- [ ] On an ungoverned run, `resolveCommissaireDecisionGrant` returns `not-applicable` and the merge passes that leg, byte-for-byte identical to pre-FAFF-1034 behaviour.
- [ ] The runner drives admit at run start and holds only `K_producer` for producer records; custody is documented as option 3.

### From WHAT (types and interfaces)
- [ ] `evaluateLevelPolicy(level, attended, holdout)` exists as a pure function; `evaluateDecisionRequest`'s legs and signature are unchanged.
- [ ] `cmdRequestDecision` accepts `--level` and the `attended`/`holdout` inputs, composes the level policy with the pure verdict, and records `level`, `attended`, `holdout`, and the policy result in the request/verdict payload.
- [ ] A `deny` whose pure legs all pass is replayable by `audit verify` from the payload inputs.
- [ ] The runner admits with `--scope merge,branch-delete`; producer_id and contract_revision are single-valued across the run.

### From HOW (behaviour)
- [ ] The fail-closed leg keys on `hasGovernanceContext(runDir)` and lives in the resolver/floor, not the pure `evaluateDecisionRequest` legs.
- [ ] admit is skipped when governor material already exists; `--force` is never passed by the runner.
- [ ] The graft merge locus, on a governed run, declares -> authorizes (with `--level` and inputs) -> (merge) -> observes; on a deny or an uncovered merge it routes through the existing merge-block handling, never a silent merge.
- [ ] Schema:2 merge auto-declare/observe is suppressed per covered merge (only when a covering schema:3 grant exists); an uncovered merge retains its schema:2 trail.
- [ ] Run close runs `verdict conclude` per governed issue and `effect reconcile`; `faff effects reconcile-merges` and `bundle publish --boundary-kind run-close` are retained; `audit seal` is NOT added.

### From HOW (edge cases)
- [ ] An admit failure leaves the run ungoverned and the merge proceeds under the `not-applicable` path.
- [ ] A multi-issue run concludes each issue without `ambiguous-producer` / `ambiguous-contract-revision`.
- [ ] `--local` merge uses the grant's declared target and still applies the level policy and fail-closed leg.

### From Scenarios (born-verifiable)
- [ ] The two holdout scenarios (governed no-verdict blocks; L4 without `meets-spec` denies) are exercised as tests.
- [ ] The ungoverned-run byte-for-byte pass is exercised as a regression test.
- [ ] A governed run passes `faff commissaire audit verify` with `result: pass` and honest classification.

### Docs and scope tracking (load-bearing, ships with the code)
- [ ] The README/docs custody-posture copy ships in this increment, claiming exactly the option-3 gain (with the co-located-governor caveat) and NOT independence.
- [ ] A NAMED pre-merge review step verifies the docs make no independence overclaim (the one forbidden-outcome guardrail); this review-step AC blocks the merge if the copy overclaims.
- [ ] Two follow-on stub tickets are filed and linked from FAFF-1034: (a) governed record production plus chokepoints for the other protected effects (push, PR-create, tracker writes); (b) the out-of-process-governor independence upgrade (option 1). Deferred scope is tracked in the graph, not just prose.

**Integration smoke test (single end-to-end happy path):**

```
PROCEDURE smoke_governed_merge:
  1. mint a run dir; admit --scope merge,branch-delete
  2. declare {kind:"merge", target: base} for (issue, step="merge")
  3. authorize --level L3 with {effect, level, attended, holdout} -> expect verdict grant
  4. assert resolveCommissaireDecisionGrant(run_dir, issue, "merge") == "valid-grant"
  5. drop the grant (a second issue, no authorize) -> assert resolver returns "absent-or-invalid" (fail closed)
  6. observe the covered merge; effect reconcile -> no escape; conclude -> accepted_under_contract
  7. audit verify -> result: pass
```

## 9. Methodology critique (agile-delivery lens)

- **Right-sized:** keep FAFF-1034 as ONE increment. The four edit surfaces (facade level policy, chokepoint fail-closed leg, floor routing, runner wiring) plus the docs-posture leg are always-ship-together: the born-verifiable signal and the fail-closed guarantee exist only when all land. Splitting them would ship a partial governance posture that is either unprevented or unproduced.
- **Workstream fit:** confirm with the human that the container is outcome-named, for example "faff's own runs are born-verifiable". The slice's value is the outcome (a governed faff merge is mechanically mediated and honestly described), not the mechanism.
- **Deps surfaced:** this slice blocks FAFF-1037 (correct). File the two follow-on stubs now and link them from FAFF-1034 so the deferred scope (other-effects governance; the out-of-process-governor upgrade) lives in the dependency graph, not only in this spec's prose.
- **Risk profile:** no spike; the facade and chokepoint exist and the change is additive and regression-guarded (ungoverned runs are byte-for-byte unchanged). The residual human-judgement risk is the docs custody posture (the forbidden overclaim), which is contained by the named pre-merge review step rather than left to build-time discretion.

confidence: medium
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
