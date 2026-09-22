# Spec: run the admissibility gate and the custody stamp on facts, not the L-level label (FAFF-1072)

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1072.

This is the buildable spec for FAFF-1072, extracted from FAFF-1040. It is written for the build agent that will implement the change and for the human reviewers who gate it. It decides, per mechanism, whether the pre-build admissibility gate and the interactive custody stamp fire below L4, and it re-keys both onto the underlying facts they actually depend on rather than onto the L4 label. Every decision below was ratified by the operator during spec preparation; the spec presents them as chosen, with rationale, and does not re-open the axis.

## 1. WHY — problem and principles

**The load-bearing model: gate on the guarantee, not the level label.** L1 through L4 are not primitives. Each level is a shorthand for a combination of three underlying facts: whether a human is attending the moment of action (attended vs unattended), whether the run is an automated build pass or a single interactive build (`autonomous`), and whether the merge sits above a dispatch cut (dispatched vs not-dispatched). The parent lesson from FAFF-1040 is that safety machinery should key on the fact that makes it necessary, not on the label that usually implies that fact. This spec applies that lesson to two mechanisms that are currently gated `L4-only`.

**Problem statement.** Two unattended-safety mechanisms fire only at L4 today: the pre-build admissibility gate (`faff admissible --lights-out`) and the interactive custody stamp (the self-consistency integrity digest on the top-level merge path). At L3 a run still merges to `main` overnight before any human sees it, so the risk each mechanism guards against is present at L3 too, yet neither fires there. This change re-keys both mechanisms onto the facts that make them necessary so they cover the previously-uncovered L3 cells.

**Design principle: key each mechanism on its own fact, never the level.** The admissibility gate guards against an agent grading its own Definition of Done with no human screening each ticket. That risk exists on any automated run, so the gate keys on the `autonomous` fact. The custody stamp and its merge-floor consumer guard the in-session merge of an unattended run that has no dispatch cut above it to provide detective custody, so they key on `unattended ∧ not-dispatched`. An implementation that reintroduces a `level === "L4"` test as the activation condition for either mechanism is rejected even if it passes the scenarios, because it recreates the exact coupling this spec removes.

**Design principle: L4's specialness governs other machinery, not these two gates.** L4 is a special case, an unattended automated run started from a PRD with heightened autonomy. That specialness still governs the holdout guarantee and topology authority. It does not govern these two mechanisms. The holdout leg's `level === "L4"` test stays exactly as it is; this spec does not touch it.

**Design principle: the custody floor fails closed on an unresolvable fact.** For the custody stamp and its merge-floor consumer, an unresolvable committed anchor or dispatch-state resolves toward requiring the guard, never toward skipping it. This matches the posture already in force: an unresolvable committed anchor level already refuses at every level today (FAFF-690), and an `indeterminate` dispatch-state already refuses in `evaluateCustody`. This is a guarantee about the custody floor, not a universal claim over every mechanism in this spec. The admissibility screen (next principle) reaches the same safe outcome by a different route, not by resolving a per-candidate fact and failing closed on it.

**Design principle: the admissibility gate is a two-layer screen, not a single fact test.** The beep-boop primary filter is unconditional in the automated-runner context. beep-boop is the automated runner; it does not read a per-candidate `autonomous` boolean; it screens every build-queue candidate. So it has no per-candidate mode signal to lose and cannot fail open on one. The graft pre-worktree backstop is the second layer: it reads graft's own `autonomous` boolean, which fail-safes to `false` (inert) when unresolvable. That fail-safe-inert does not open a hole for dispatched work, because any beep-boop-dispatched candidate was already screened by the primary filter. The only residual is a top-level autonomous graft whose own mode is genuinely unresolvable; it resolves to interactive-inert, exactly as graft's `autonomous` fail-safe behaves everywhere else, which is the same posture as an ordinary interactive graft where the human is the gate. This is deliberate defence-in-depth, not a fail-open gap.

Reference context:

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` | JavaScript | `actsOnSentryAbort` / `declaredUnattendedFromConfig` — the attended-vs-unattended resolver (Fact A, ADR-0103 / FAFF-717) |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveIntegrity` (branch-6 level test; gains a `cfg` param under this change), `laneBoundaryDispatchState` (Fact C), `evaluateCustody` (detective custody), `resolveAnchorLevel` / `anchorRefusal` (tamper-resistant committed level) |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | `computeIntegrityFloor` — the mirror branch-6 default on the `faff contract integrity-floor` extraction path; this change extends the extraction contract (new `unattended` / `dispatch_state` fields) and its `CONTRACTS["integrity-floor"].fixtures` |
| `plugin/skills/faff/bin/lib/config.js` | JavaScript | `faff verification resolve --json` — the CLI surface exposing the `unattended` fact |
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript | `admissibleVerdict(specText, lightsOut)` — the pure admissibility verdict; the `--lights-out` bare-boolean CLI |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | The admissibility backstop (~line 129), the custody stamp sub-step (~line 588), the `autonomous` run-mode signal (~line 408) |
| `plugin/skills/faff-beep-boop/SKILL.md` | Skill prose | The primary admissibility filter on the build queue (~line 229) |
| `plugin/skills/faff/references/l4.md` | Skill prose | The carve-out (obligation 7): interactive and autonomous-but-top-level graft have no dispatch cut and merge in-session |

Scope statement: this change sits at the boundary between the run-mode signals graft already holds and the mechanical merge floor, widening the activation of two existing gates without adding a new gate.

## 2. Out of scope

- **The holdout guarantee at L3.** Excluded because it is the remaining subject of FAFF-1040 and its feasibility is a separate spike (FAFF-1073). Extension point: the holdout leg in `merge-gate.js` (the `holdout: level === "L4" ? readHoldout(...) : "not-applicable"` line) and `computeIntegrityFloor`'s holdout handling; this spec deliberately leaves both untouched.
- **The adversarial spec/code reviews at L3.** Excluded because the lever there is the slot occupant, not a config flag; they already run at L2/L3. Extension point: the `review` and `spec_review` slot configuration.
- **Recording human ratification on markers.** Excluded and filed as FAFF-1079 (record the ratifier on decisions, agent-chosen vs human-ratified). Do not add a `(ratified: human)` suffix or a new marker field; the fixed spec-readiness contract stays `chosen | punt | assumes`.
- **The dispatched-lane detective custody path.** Excluded because it already covers dispatched runs at any level, keyed on lane-boundary presence, not level (`evaluateCustody`, `merge-gate.js`). This change must not regress it. Extension point: `evaluateCustody` and the lane-boundary emit in `l4.md` obligation 7.
- **The `verification.*` opt-in verification legs (FAFF-1061).** Excluded; that ticket runs L4 confidence machinery at L2/L3 without automation authority, a distinct axis. Extension point: `resolveInteractiveVerification` in `config.js`.

## 3. WHAT — the facts, the cells, and the firing rules

### Vocabulary

| Term | Definition |
|---|---|
| Fact A — attended vs unattended | `unattended = (ledger.level === "L4") || declaredUnattendedFromConfig(cfg)`, the ADR-0103 / FAFF-717 axis. Resolved by `actsOnSentryAbort` in `sentry.js` and exposed as the `unattended` field of `faff verification resolve --json`. |
| Fact B — autonomous vs interactive | Graft's own run-mode boolean (`faff-graft/SKILL.md` ~line 408): `true` for every beep-boop-dispatched build and every lights-out top-level graft, `false` for interactive `/faff-graft`. Fail-safe unresolvable resolves to `false` (inert). This fail-safe governs only the graft pre-worktree backstop, the defence-in-depth layer. The beep-boop primary filter does not read this boolean and screens every build-queue candidate unconditionally, so a lost Fact B signal cannot make the admissibility screen inert for dispatched work (see section 1, the two-layer screen). |
| Fact C — dispatched vs not-dispatched | `laneBoundaryDispatchState(runDir)` in `merge-gate.js`, returning `dispatched`, `absent`, or `indeterminate`. `absent` when no `lane-boundary.json` exists. |
| The cell | The combination `unattended ∧ not-dispatched`: an unattended run that merges in-session with no dispatch cut above it. This is the cell the custody stamp and the merge floor must both cover. |

### The firing table, keyed on facts

The two mechanisms fire on different facts. Admissibility keys on Fact B. The custody stamp and merge floor key on `unattended ∧ not-dispatched` (Facts A and C). Detective custody keys on Fact C alone. The table below is the authority; the L-level column is a convenience mapping, not the key.

| Run (L-level convenience) | autonomous (B) | unattended (A) | dispatched (C) | Admissibility gate (fires iff autonomous) | Custody stamp + merge floor (fires iff unattended ∧ not-dispatched) | Detective custody (fires iff dispatched) |
|---|---|---|---|---|---|---|
| Interactive L1/L2, top-level | no | no | no | inert | inert | inert |
| Automated L3, attended, top-level | yes | no | no | fires | inert (attended) | inert |
| Automated L3, attended, dispatched | yes | no | yes | fires | inert (dispatched) | fires |
| Automated L3, unattended, top-level | yes | yes | no | fires | **fires (new cell)** | inert |
| Automated L3, unattended, dispatched | yes | yes | yes | fires | inert (detective owns it) | fires |
| L4, top-level | yes | yes | no | fires | fires (unchanged) | inert |
| L4, dispatched | yes | yes | yes | fires | inert (detective owns it) | fires |

Note on the mapping: L4 is always unattended and autonomous. L3 spans both attended and unattended, and both dispatched and not-dispatched, which is why keying on the label alone leaves the unattended top-level L3 cell uncovered. The new coverage this change adds is exactly one cell: automated L3, unattended, top-level.

### The invariant the prior draft assumed is false

The prior framing assumed "every unattended merge is dispatched," which would make the stamp redundant with detective custody. That invariant is false. `l4.md` obligation 7 states the carve-out plainly: "Interactive and autonomous-but-top-level graft have no dispatch cut above them and are out of scope, they merge in-session exactly as today (the carve-out)." A top-level autonomous graft merges via the bounded landing loop with no `lane-boundary.json`, so `laneBoundaryDispatchState` returns `absent` and `evaluateCustody` returns `{ required: false, ok: true }`, meaning no detective custody. The design does not rely on the false invariant; it states the carve-out and covers the cell with the stamp.

### Design decision: gate on the facts, not the level label

The two mechanisms are re-keyed from `level === "L4"` onto the facts that make them necessary. This is a deliberate scope change that generalises the activation axis, not a bug fix. ADR-0118 built the `custody-trusted` grant for an L4-specific purpose; this design generalises it.

**Chosen:** re-key admissibility onto Fact B (`autonomous`) and re-key the custody stamp and merge floor onto `unattended ∧ not-dispatched` (Facts A and C), replacing the `level === "L4"` activation for both. Rationale in section 6.

### Type sketch: the shared predicate

```
FUNCTION requiresSelfConsistencyStamp(unattended, dispatchState) -> Bool:
  # the cell both the stamp and the merge floor must cover
  # fail-closed: an unresolvable input resolves toward TRUE (require the guard)
  RETURN unattended AND (dispatchState == "absent")
  # dispatchState "indeterminate" already refuses upstream (evaluateCustody),
  # so it never reaches this predicate as a merge-floor pass.
  # This "never reaches" is a CALL-ORDER property (evaluateCustody must run
  # and refuse before branch-6 is folded), not a property of this predicate.
  # It is guarded by an explicit test, not assumed (see Scenarios / DONE).
```

The predicate is one small helper the libraries import. Where a prose call-site needs it (the graft session deciding whether to run the stamp sub-step), expose it through a `faff` verb, matching the precedent of `faff eligible`, `faff next`, and `faff verification resolve`. Skill prose never imports a JS helper directly.

## 4. HOW — behaviour

### Decision 1: the admissibility gate fires on every automated run

The admissibility gate is a static classification of the spec's Definition of Done, no env and no model, asking whether the DoD is machine-checkable so the agent is not grading its own "done." An attending human on an automated run is not screening each ticket's DoD, so the self-grading risk is present on any automated run. The gate therefore keys on Fact B (`autonomous`), which is `true` at attended L3, unattended L3, and L4, and inert for interactive L1/L2.

The two call-sites are not the same kind of check. The beep-boop primary filter is unconditional in the automated-runner context: it does not read a per-candidate `autonomous` boolean, it screens every build-queue candidate, so it cannot fail open on a lost mode signal. The graft pre-worktree backstop reads graft's own `autonomous` boolean and fail-safes to inert when the boolean is unresolvable, which is defence-in-depth behind the primary, not the sole screen (section 1). Both call-sites already shell the check under a graft-resolved shell boolean; for the backstop, the change is which boolean.

```
PROCEDURE admissibility_at_graft_backstop(spec_body, autonomous):
  # was: if [ "$lights_out" = true ]
  1. IF autonomous is true:
     a. printf '%s' "$spec_body" | faff admissible --lights-out --json
     b. exit 0 (admissible) -> proceed to worktree creation; surface warnings, they never gate
     c. exit 1 (inadmissible) OR any shell/binary failure -> REFUSE fail-safe:
        no worktree, no spec commit, log reasons, return the `inadmissible` skip disposition
  2. IF autonomous is false (interactive):
     the gate is inert; skip wholesale (the human is the gate)
```

```
PROCEDURE admissibility_at_beep_boop_primary(candidate_spec_body):
  # was gated under the L4 lights-out signal only; the build-queue drain is
  # inherently automated, so the filter now applies to every build-queue candidate
  1. pipe candidate_spec_body to: faff admissible --lights-out --json
  2. exit 0 (admissible) -> admit unchanged; surface R3 warnings, they never gate
  3. exit 1 (inadmissible) OR any shell/binary failure -> fail-safe:
     do NOT append to `admitted`; give the `inadmissible:<reasons>` routed-out disposition
     for the morning brief; never parked-as-built
```

**Behaviour summary.** The pre-build gate now fires on the same automated runs that skip Step 6's prompts, catching a non-machine-checkable DoD before the worktree exists, on any automated run rather than L4 only.

**Anti-pattern:** resolving a fresh `lights_out` or level signal at the call-site to decide whether the gate fires. Why: graft already holds `autonomous` as its founding invocation context; re-resolving invites a drift between the gate's activation and the run's real mode.

**Anti-pattern:** renaming or re-typing the `--lights-out` CLI flag as part of this change. Why: `admissibleVerdict(specText, lightsOut)` treats `--lights-out` as a bare "gate active" boolean, decoupled from any L-level. The flag name is legacy; the activation axis is now `autonomous` at the call-site, and the flag stays a plain on-switch. See Decision 8.

### Decision 2: the custody stamp fires on `unattended ∧ not-dispatched`

The custody stamp is a self-consistency attestation: the trusted session snapshots an integrity digest of the built artifacts and threads a verdict to the ship step so the merge floor can confirm what lands is what was built and reviewed. It is a self-attestation, not detective custody, and is never fed through `FAFF_INTEGRITY_BOUNDARY`.

Today the stamp sub-step is gated "L4, top-level only" (`faff-graft/SKILL.md` ~line 588), and is mode-agnostic about `--local` vs `--pr`. The change generalises the L4 test to the fact.

```
PROCEDURE custody_stamp_gate(unattended, dispatchState):
  1. IF requiresSelfConsistencyStamp(unattended, dispatchState):
     a. integrity-digest snapshot --run-dir "$run_dir" --issue <ISSUE>
        | integrity-digest verify --run-dir "$run_dir" --manifest -
            --issue-context <ISSUE> --merge-state pre-merge
            --record-result "$run_dir/<ISSUE>/custody-verdict.json" --json
     b. thread --custody-verdict <path> and --custody-verdict-sha256 <result.verdict_sha256>
        (the persisted bytes' hash, never a re-hash) to the `ship` producer
     c. thread on any non-clean/absent outcome too (uncertainty fails toward refuse)
  2. ELSE: skip the sub-step
```

This keeps the L4 top-level path firing (still `unattended ∧ not-dispatched`) and adds the automated L3 top-level unattended path, the previously-uncovered cell. `unattended` reuses the ADR-0103 resolver, exposed for the graft session via `faff verification resolve --json`. `not-dispatched` is `laneBoundaryDispatchState == "absent"`.

Dispatched runs are unchanged. Detective custody (`evaluateCustody`, keyed on lane-boundary presence, no level parameter) short-circuits before `resolveIntegrity` and covers them. Because the two legs are orthogonal (detective custody runs on the dispatched branch; the stamp and its floor run on the `absent` branch), changing the integrity leg cannot regress detective custody.

**Anti-pattern:** running the stamp on a dispatched run "for belt and braces." Why: detective custody already owns the dispatched cell, and a second custody verdict on the same merge is redundant work that muddies which basis authorised the merge.

### Decision 3: the merge floor consumes the stamp in the same cell

The merge floor must block when custody is absent in exactly the cell where the stamp fires, otherwise an unattended non-dispatched merge either refuses with no stamp produced, or produces a stamp nothing consumes.

Today `resolveIntegrity`'s branch-6 (no custody flags passed) is level-gated:

```
# merge-gate.js:516, current:
else state = level === "L4" ? "unasserted-refuse" : "unasserted-ok";
```

so a non-dispatched L3 merge neither requires nor consumes a custody verdict. Branches 1 through 5 are already fact-blind: a mount violation or a forged/malformed digest refuses at every level (`violated`); a clean digest never blocks (`custody-trusted`). Only branch-6's polarity must widen from `level === "L4"` to the cell. The decision (widen branch-6 to the cell) is settled; what follows is the honest scope, because the two floor consumers reach the facts by different routes and the change is not two edited lines.

**Consumer 1 — `resolveIntegrity` (a signature change).** `resolveIntegrity(runDir, issue, level, digestVerify)` (`merge-gate.js:504`) has no `cfg` parameter, so it cannot compute `unattended = (level === "L4") || declaredUnattendedFromConfig(cfg)` today. Thread `cfg` in: add it to the signature. The two production callers (`merge-gate.js:1035`, `merge-gate.js:1270`) do not currently hold `cfg` in scope, so they must load it via the file's existing lazy `require("./config")` convention (the same convention already used in `merge-gate.js`, see the note at `merge-gate.js:467`) and pass it. `resolveIntegrity`'s existing `level` param is already the reconciled committed anchor level (`resolveGateLevel` fail-louds on any `--level` mismatch upstream at `merge-gate.js:1028`), so it stays the tamper-resistant input to `unattended`. `resolveIntegrity` already receives `runDir`, so it computes the dispatch-state itself via `laneBoundaryDispatchState(runDir)` rather than taking a new dispatch parameter. Update the self-test call-sites (`merge-gate.js:1554`, `:1561`, `:1569`, `:1577`) to pass a `cfg` argument too.

```
PROCEDURE resolve_integrity_branch6(runDir, anchorLevel, cfg):
  # branch-6 only; branches 1..5 unchanged
  1. unattended := (anchorLevel == "L4") OR declaredUnattendedFromConfig(cfg)
  2. dispatchState := laneBoundaryDispatchState(runDir)   # computed internally from runDir
  3. block := requiresSelfConsistencyStamp(unattended, dispatchState)  # unattended AND absent
  4. state := block ? "unasserted-refuse" : "unasserted-ok"
```

**Consumer 2 — `computeIntegrityFloor` (an extraction-contract extension).** `computeIntegrityFloor(extraction)` (`contract-defs.js:2296`) is the `faff contract integrity-floor` path, and it is a pure function over an extraction: it reads `e.level` / `e.holdout` / `e.no_ci_policy` / `e.integrity` / `e.decision_grant` and has no `runDir` and no `cfg`, so it cannot compute the facts itself. Its mirror default is `integrity === undefined ? (e.level === "L4" ? "unasserted-refuse" : "unasserted-ok")` (`contract-defs.js:2315`). Widening it therefore means extending the contract, not editing one line:

- the extraction gains two new fields, `unattended` (boolean) and `dispatch_state` (`dispatched | absent | indeterminate`), validated against their enums with the same fail-loud posture as the existing fields;
- any caller that assembles the `integrity-floor` extraction populates the two new fields (`unattended` computed as above from the committed anchor level plus config; `dispatch_state` from `laneBoundaryDispatchState`). No live in-tree assembler for this contract was found during preparation (the path exists as the contract function plus its `--selftest` fixtures), so the concrete, verifiable surface of this consumer is the extraction shape plus the fixtures; a future assembler inherits the obligation;
- the absent-integrity default widens to `integrity === undefined ? (requiresSelfConsistencyStamp(e.unattended, e.dispatch_state) ? "unasserted-refuse" : "unasserted-ok")`;
- the `CONTRACTS["integrity-floor"].fixtures` array (`contract-defs.js`) gains cases covering the widened cell and the below-cell no-op, and the existing L4 fixtures carry `unattended: true` so their intent is unchanged.

This is a contract change to `faff contract integrity-floor`, not a one-liner. Do not touch the holdout leg's `level === "L4"` test in either file.

**The coupling, stated prominently.** The merge-floor block on custody-absence and the stamp firing must cover the same cell, `unattended ∧ not-dispatched`. They ship together in one change. Shipping the floor widening without the stamp produces an `unasserted-refuse` on a cell where no stamp was produced (every unattended non-dispatched merge refuses). Shipping the stamp without the floor widening produces a verdict nothing consumes.

### Tamper-resistance nuance

The `level` passed to `resolveIntegrity` is the committed anchor level: the caller resolves it via `resolveAnchorLevel` and reconciles it through `resolveGateLevel` before the call, and that path is tamper-resistant (the level is read from the pushed head sha's committed `run-ledger.json`, never the live mutable ledger). The `unattended` fact adds `declaredUnattendedFromConfig(cfg)`, which reads live config, not a committed artifact. This is the same mix `actsOnSentryAbort` already accepts under ADR-0103.

For the merge floor specifically, compute `unattended` inline from the committed anchor level plus config. Do not call `faff verification resolve`, which reads the mutable run-ledger (`readLedger(runDir)` in `cmdVerification`) and would reintroduce a mutable-ledger dependency the anchor path deliberately avoids. Both floor consumers use this same inline rule: `resolveIntegrity` computes it directly (now that `cfg` is threaded in), and any assembler that constructs the `integrity-floor` extraction computes it to populate `e.unattended` (none exists in-tree today, see Decision 3 Consumer 2), so the pure `computeIntegrityFloor` never has to.

```
PROCEDURE unattended_for_merge_floor(anchorLevel, cfg):
  # anchorLevel is the tamper-resistant committed value from resolveAnchorLevel
  1. RETURN (anchorLevel == "L4") OR declaredUnattendedFromConfig(cfg)
```

**Fail direction.** If unattendedness or dispatch-state is unresolvable, fail closed: require custody. An unresolvable committed anchor already fails closed at every level today (FAFF-690, `anchorRefusal`), and an `indeterminate` dispatch-state already refuses upstream in `evaluateCustody`, so this posture is consistent with the existing floor, not new behaviour.

### Failure modes

- **The admissibility screen is read as fail-open because Fact B fail-safes to `false`.** How you'd know: a reviewer notices that admissibility fires iff `autonomous`, that an unresolvable `autonomous` resolves to `false` (inert), and concludes a lost mode signal makes the gate skip. What it means: this is only the graft backstop, the second layer. The beep-boop primary filter does not read a per-candidate `autonomous` boolean and screens every build-queue candidate unconditionally, so any dispatched candidate was already screened before the backstop's fail-safe could matter. The residual, a top-level autonomous graft whose own mode is genuinely unresolvable, resolves to interactive-inert exactly as graft's `autonomous` fail-safe does everywhere. Narrow (understand the two layers), not a defect. The tripwire that this holds is the beep-boop primary-filter scenario below.
- **The stamp fires but the floor still keys on L4 (or vice versa).** How you'd know: an automated L3 unattended top-level merge either refuses with `unasserted-refuse` and no `custody-verdict.json` on disk, or writes a `custody-verdict.json` that the merge log shows was never read (the floor reports `unasserted-ok` on a run that produced a stamp). What it means: the coupling was broken; do not ship the two halves separately. This is the single highest-value integration check.
- **`declaredUnattendedFromConfig` on live config diverges from the committed anchor's intent.** How you'd know: a run whose committed anchor is L3-attended but whose live config has flipped `autonomous.unattended` true (or false) resolves the floor's `unattended` differently from what the run started as. What it means: the fail-closed direction contains the risk (a divergence toward "unattended" only tightens the floor); a divergence toward "attended" that would loosen it is bounded by the anchor's L4 disjunct, which stays committed. Narrow, not abandon.
- **Detective custody and the stamp both claim a dispatched run.** How you'd know: a dispatched run reaches `resolveIntegrity`'s branch-6 at all (it should be short-circuited by `evaluateCustody` on the dispatched branch before the integrity fold). What it means: the orthogonality assumption is wrong; investigate the short-circuit order before trusting the firing table. Confirmed correct in the current code (`evaluateCustody` returns on the dispatched branch before `resolveIntegrity` is reached), so this is a regression tripwire, not an expected state.

## 5. Scenarios — born-verifiable main objectives

```
Given an automated run (autonomous = true) at L3 with a spec whose DoD is not machine-checkable
When graft reaches the pre-worktree admissibility backstop
Then the gate fires, refuses fail-safe, creates no worktree, commits no spec,
     and returns the `inadmissible` skip disposition
```

```
Given an interactive graft (autonomous = false) with any spec
When graft reaches the pre-worktree admissibility backstop
Then the gate is inert and graft proceeds to worktree creation without running `faff admissible`
```

```
Given an automated L3 run that is unattended and has no lane-boundary.json (not-dispatched, top-level)
When the graft custody-stamp sub-step is reached
Then the self-consistency stamp is produced and its verdict is threaded to the ship producer,
     and at merge the floor consumes the verdict rather than reporting unasserted-refuse
```

```
Given a dispatched run at L3 (lane-boundary.json present, laneBoundaryDispatchState = dispatched)
When the merge path runs
Then detective custody (evaluateCustody) owns the merge, the self-consistency stamp does NOT fire,
     and no second custody verdict is produced
```

```
Given an unattended, not-dispatched merge in the cell with no custody flags passed
When resolveIntegrity reaches branch-6
Then state resolves to unasserted-refuse and the merge is blocked
```

```
Given an unattended, not-dispatched merge whose forge surface was tampered after the stamp
When the merge floor evaluates the digest verify
Then the fold reaches the violated arm and the merge is refused regardless of level
```

```
Given an L4 top-level merge (unattended, not-dispatched) with a clean stamp
When the merge floor evaluates
Then it admits exactly as it does today (this cell's behaviour is unchanged)
```

```
Given an automated, non-lights-out graft (autonomous = true, lights_out = false, e.g. an
     autonomous L3 top-level graft) whose spec DoD is not machine-checkable
When graft reaches the pre-worktree admissibility backstop
Then the backstop fires and refuses fail-safe
```

This is the distinguishing cell: on L4, `autonomous` and `lights_out` coincide, so only an automated non-lights-out run proves the backstop keys on `autonomous` and not on the legacy `lights_out` signal.

```
Given an automated run at L3 with an inadmissible-DoD candidate on the build queue
When the beep-boop primary filter screens the build-queue candidates
Then the candidate is routed out with the `inadmissible:<reasons>` disposition and is NOT
     appended to `admitted` (and is never parked-as-built)
```

```
Given the merge floor widened to the cell but the graft custody-stamp sub-step NOT shipped
     (an automated L3 unattended top-level merge with no stamp produced)
When resolveIntegrity reaches branch-6
Then it resolves unasserted-refuse AND no custody-verdict.json exists on disk (assert both:
     the merge is blocked and the stamp artifact is absent, so the half-ship is observable)
```

```
Given the graft custody-stamp sub-step shipped but the floor NOT widened (still keys on L4),
     on an automated L3 unattended top-level merge with a clean stamp produced
When the merge floor evaluates
Then the failure is that the floor did NOT consume the verdict: assert the resolved integrity
     state reflects consumption (custody-trusted on the stamped cell), not merely that the
     merge admitted (an L4-keyed floor would admit the L3 cell vacuously, hiding the break)
```

```
Given a present-but-malformed lane-boundary.json (so laneBoundaryDispatchState returns
     "indeterminate") on an unattended run
When the merge path runs
Then evaluateCustody refuses (fail-closed) BEFORE resolveIntegrity's branch-6 is folded, so the
     indeterminate dispatch-state never reaches requiresSelfConsistencyStamp as a merge-floor pass
```

- The merge floor must fail closed (require custody) when unattendedness or dispatch-state is unresolvable.
- The change must not alter the holdout leg's `level === "L4"` test in either `merge-gate.js` or `contract-defs.js`.
- The `faff admissible` verdict function and the `--lights-out` bare-boolean CLI must be unchanged.

## 6. Design decision rationale

**Should the admissibility gate fire below L4, and on what fact?**
Options: keep it L4-only (relies on the L3 morning park-review as substitute); fire it on attendedness; fire it on `autonomous`. The morning review is a human reading merged work after the fact, not a pre-build DoD screen, so it does not substitute. Attendedness is wrong because an attended human on an automated run still is not screening each ticket's DoD one by one. The self-grading risk tracks whether the run is an automated pass.
**Chosen:** fire on Fact B (`autonomous`), reusing the shell boolean graft already holds. Rationale: the gate's risk is exactly "automated run, no per-ticket human DoD screen," which is Fact B by definition.

**Should the custody stamp fire below L4, and on what fact?**
Options: keep it L4-only; fire on unattendedness alone; fire on `unattended ∧ not-dispatched`. Firing on unattendedness alone would double up with detective custody on dispatched unattended runs. The stamp exists to cover the in-session merge that has no dispatch cut above it to provide detective custody.
**Chosen:** fire on `unattended ∧ not-dispatched`, generalising the L4-only gate to the fact. Rationale: this is precisely the cell detective custody does not cover, and the false "unattended ⇒ dispatched" invariant is refuted by the `l4.md` carve-out.

**How does the merge floor consume the stamp without regressing anything?**
Options: leave branch-6 level-gated (breaks the coupling); widen branch-6 to the cell. Branches 1 through 5 are already fact-blind, so only branch-6's polarity changes, in both consumers.
**Chosen:** widen the branch-6 predicate in `resolveIntegrity` and its mirror default in `computeIntegrityFloor` to `unattended ∧ not-dispatched`. Rationale: the coupling requires the floor to block exactly where the stamp fires. This is not two edited lines. `resolveIntegrity` needs a `cfg` parameter threaded in so it can compute `unattended`; the two callers do not currently hold `cfg` and must load it via the file's lazy `require("./config")` convention to pass it (plus the four self-test call-sites), and `resolveIntegrity` already holds `runDir` so it computes the dispatch-state internally via `laneBoundaryDispatchState`. `computeIntegrityFloor` is a pure function over its extraction with no `runDir` and no `cfg`, so widening it is a contract change to `faff contract integrity-floor`: the extraction gains `unattended` and `dispatch_state` fields, the extraction assembler populates them, and the contract fixtures are updated. The scope description in the prior draft (the change is "two lines") was wrong; the decision to widen branch-6 to the cell is unchanged.

**How is `unattended` resolved for the merge floor given tamper-resistance?**
Options: call `faff verification resolve` (reads the mutable ledger); compute inline from the committed anchor level plus config. The verification CLI reads `readLedger(runDir)`, which is mutable and would undo the anchor path's tamper-resistance.
**Chosen:** compute `unattended` inline as `(anchorLevel === "L4") || declaredUnattendedFromConfig(cfg)`, from the committed anchor level plus config. Rationale: the anchor level stays tamper-resistant, and the config disjunct is the same mix `actsOnSentryAbort` already accepts.

**Which way does an unresolvable fact fail?**
Options: fail open (skip the guard); fail closed (require custody).
**Chosen:** fail closed. Rationale: an unresolvable committed anchor already refuses at every level (FAFF-690) and an indeterminate dispatch-state already refuses in `evaluateCustody`, so failing closed is consistent, not new.

**How is the shared predicate expressed so prose does not import JS?**
Options: inline the predicate at every call-site; factor one helper the libraries import and expose a `faff` verb for prose call-sites. Skill prose cannot import a JS helper.
**Chosen:** factor a small shared JS helper (`requiresSelfConsistencyStamp` and `unattended_for_merge_floor`) that the libraries import, and expose the `unattended` fact to the graft session via the existing `faff verification resolve --json` for the stamp gate, with a `faff` verb added if a prose call-site needs the composite predicate directly. Rationale: precedent is `faff eligible` / `faff next` / `faff verification resolve`; the pre-build admissibility gate needs no new verb because the `autonomous` shell boolean already exists in graft's context.

**Should the `--lights-out` CLI flag be renamed now that the gate keys on `autonomous`?**
Options: rename it to match the activation axis; keep it. At the time of writing, `admissibleVerdict(specText, lightsOut)` treats `--lights-out` as a bare on-switch, decoupled from any level; the activation decision lives at the call-site.
**Chosen:** keep the `--lights-out` flag name and behaviour unchanged. Rationale: the flag is a plain "gate active" boolean; the call-site now passes it under `$autonomous` rather than `$lights_out`, and renaming the CLI is churn outside this ticket's scope. The legacy name is a known minor and is noted here so a future reader does not read it as an L4 coupling.

**ADR-promotion candidate.** This change generalises gate activation from the L-level label to the underlying facts, generalising ADR-0118's `custody-trusted` grant beyond its original L4-specific purpose. That is an architectural decision worth an ADR at build time (generalise gate activation from L-level to facts). Raise the ADR during graft, per the graft ADR sub-step; this spec flags it as a candidate rather than authoring it.

## 7. Open questions and assumptions

Open questions: none. Every decision is closed and operator-ratified.

Assumptions: none requiring external validation. Every fact source this spec keys on was confirmed present in the codebase during preparation: `actsOnSentryAbort` / `declaredUnattendedFromConfig` (`sentry.js`), `laneBoundaryDispatchState` and `evaluateCustody` and `resolveIntegrity` (`merge-gate.js`), `computeIntegrityFloor` (`contract-defs.js`), the `unattended` field of `faff verification resolve --json` (`config.js`), `admissibleVerdict` and the `--lights-out` CLI (`admissibility.js`), the `autonomous` run-mode signal (`faff-graft/SKILL.md`), and the carve-out (`l4.md` obligation 7).

## 8. DONE — definition of done

### From WHY
- [ ] Neither mechanism's activation condition is `level === "L4"` after the change; both key on their fact (grep confirms no reintroduced level test at the admissibility call-sites and at the branch-6 predicate in both floor consumers, `resolveIntegrity` and `computeIntegrityFloor`).
- [ ] The holdout leg's `level === "L4"` test is unchanged in both `merge-gate.js` and `contract-defs.js`.

### From WHAT (facts and firing table)
- [ ] The firing table's seven rows each match observed behaviour: admissibility fires iff `autonomous`; the stamp and floor fire iff `unattended ∧ not-dispatched`; detective custody fires iff `dispatched`.
- [ ] The shared predicate `requiresSelfConsistencyStamp(unattended, dispatchState)` returns true only for `unattended ∧ dispatchState == "absent"`.

### From HOW (Decision 1 — admissibility)
- [ ] The graft admissibility backstop runs `faff admissible --lights-out --json` under `$autonomous` (not `$lights_out`); interactive graft skips it wholesale.
- [ ] Distinguishing cell: an automated, non-lights-out graft (`autonomous = true`, `lights_out = false`, an autonomous L3 top-level graft) with a non-machine-checkable DoD fires the backstop. On L4 the two booleans coincide, so this cell is what proves the call-site keys on `autonomous`, not `lights_out`.
- [ ] The beep-boop primary filter runs on every build-queue candidate (no longer gated on the L4 lights-out signal); a scenario exercises it with an inadmissible-DoD candidate that is routed out `inadmissible:<reasons>` and NOT appended to `admitted`.
- [ ] Both call-sites refuse fail-safe on exit 1 or any shell/binary failure (graft: no worktree, no spec, `inadmissible` disposition; beep-boop: not appended to `admitted`, `inadmissible:<reasons>` disposition).

### From HOW (Decision 2 — custody stamp)
- [ ] The graft custody-stamp sub-step fires iff `requiresSelfConsistencyStamp` holds, producing `custody-verdict.json` and threading `--custody-verdict` / `--custody-verdict-sha256` to the ship producer, including on any non-clean/absent outcome.
- [ ] The L4 top-level path still fires (it is a sub-case of `unattended ∧ not-dispatched`).
- [ ] The automated L3 unattended top-level path now fires (the new cell).
- [ ] A dispatched run does not produce a self-consistency stamp; detective custody owns it.

### From HOW (Decision 3 — merge floor)
- [ ] `resolveIntegrity` takes `cfg` (signature change); its two production callers (`merge-gate.js:1035`, `merge-gate.js:1270`) load config via the file's lazy `require("./config")` convention and pass it, and the four self-test call-sites (`merge-gate.js:1554/1561/1569/1577`) are updated; branch-6 computes `unattended` from the reconciled committed anchor level (its existing `level` param) plus `cfg`, and the dispatch-state internally via `laneBoundaryDispatchState(runDir)`, resolving `unasserted-refuse` iff `unattended ∧ not-dispatched`, else `unasserted-ok`.
- [ ] The `faff contract integrity-floor` extraction gains `unattended` (boolean) and `dispatch_state` (`dispatched | absent | indeterminate`) fields, validated with the existing fail-loud posture; `computeIntegrityFloor`'s absent-integrity default mirrors `requiresSelfConsistencyStamp(e.unattended, e.dispatch_state)`; and `CONTRACTS["integrity-floor"].fixtures` gains cell + below-cell cases (existing L4 fixtures carry `unattended: true`). Any assembler that constructs the extraction populates both fields; no live in-tree assembler was found, so the verifiable surface here is the extraction shape plus the fixtures.
- [ ] The floor block and the stamp firing cover the same cell (verified by an end-to-end run that produces a stamp and a merge that consumes it, with no `unasserted-refuse` on a stamped cell).
- [ ] Coupling half-ship (i): floor widened but stamp not produced → an automated L3 unattended top-level merge resolves `unasserted-refuse` AND no `custody-verdict.json` exists on disk (assert both, not just the block).
- [ ] Coupling half-ship (ii): stamp produced but floor still keys on L4 → assert the floor actually consumed the verdict (resolved integrity state is `custody-trusted` on the stamped cell), not merely that the merge admitted.
- [ ] Branches 1 through 5 (tampered/unverifiable → `violated`; clean → `custody-trusted`) are unchanged.

### From HOW (tamper-resistance and fail direction)
- [ ] The merge floor computes `unattended` inline from the committed anchor level plus config, not from `faff verification resolve` (`resolveIntegrity` directly; for `computeIntegrityFloor`, any future extraction assembler populates `e.unattended` the same way).
- [ ] An unresolvable unattendedness or dispatch-state fails closed (requires custody); an unresolvable committed anchor still refuses per FAFF-690.
- [ ] `indeterminate` dispatch-state: a present-but-malformed `lane-boundary.json` makes `laneBoundaryDispatchState` return `indeterminate`; a scenario asserts `evaluateCustody` refuses (fail-closed) before branch-6 is folded. The type-sketch's "never reaches the predicate" is guarded as a call-order property (evaluateCustody runs and refuses before resolveIntegrity's branch-6), asserted by a test, not assumed.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (both mechanisms are mechanical: a static classify with no model, and a local hash), so no grader `KIND` / eval case / seam-registry row is required by this ticket. Confirm no seam was added incidentally.

### Test coverage the change requires
- [ ] Admissibility fires on an automated run and is inert on an interactive run.
- [ ] Distinguishing cell: admissibility fires on an automated non-lights-out run (`autonomous = true`, `lights_out = false`), proving the call-site keys on `autonomous`, not `lights_out`.
- [ ] beep-boop primary filter: an automated run with an inadmissible-DoD candidate routes it out `inadmissible:<reasons>` and does not append it to `admitted`.
- [ ] Stamp fires on `unattended ∧ not-dispatched` including the automated L3 top-level case, and does not fire on a dispatched run nor an interactive run.
- [ ] Merge floor blocks on absent custody in the cell, passes on a clean stamp, and blocks on a tampered surface.
- [ ] `computeIntegrityFloor` contract fixtures cover the widened cell (`unattended: true`, `dispatch_state: "absent"`, absent integrity → refuse) and the below-cell no-op (`unattended: false` → ok); existing L4 fixtures carry `unattended: true` and are unchanged in outcome.
- [ ] Coupling half-ship both directions: (i) floor widened without the stamp → `unasserted-refuse` and no `custody-verdict.json`; (ii) stamp without the floor widening → the floor did not consume the verdict (assert consumption on the stamped cell, not mere admission).
- [ ] Call-order guard: on `indeterminate` dispatch-state (malformed `lane-boundary.json`), `evaluateCustody` refuses before `resolveIntegrity` branch-6 is folded.
- [ ] L4 top-level still works (sub-case of the cell); dispatched L3 is unchanged with no double custody.
- [ ] Fail-closed on an unresolvable anchor or dispatch-state.
- [ ] Close the pre-existing coverage gap noted below: add a test that exercises `resolveIntegrity` with a non-L4 unattended run plus a custody verdict, which no current test covers.

### Integration smoke test

```
PROCEDURE smoke_unattended_l3_top_level:
  1. Start an automated (autonomous), unattended L3 graft on a machine-checkable-DoD ticket,
     top-level, with no lane-boundary.json (not-dispatched).
  2. EXPECT: admissibility gate passes pre-worktree (DoD is machine-checkable).
  3. EXPECT: the custody-stamp sub-step produces custody-verdict.json and threads the two flags to ship.
  4. EXPECT at merge: resolveIntegrity consumes the verdict; with a clean stamp the floor admits.
  5. Re-run step 4 with the stamp flags withheld:
     EXPECT branch-6 resolves unasserted-refuse and the merge is blocked.
  # If this path works end-to-end, the coupling between the stamp and the floor is connected.
```

confidence: high
build-tier: complex
spec-review: approve
