# nlspec — FAFF-1140: Fail closed on a Commissaire admit failure when governance is *required*

> Spec: faffter-dark-nlspec · 2026-09-27 · interactive · claude-code/unknown · confidence: medium · build-tier: complex. Full spec on Linear FAFF-1140.

**Artifact:** a buildable spec for the coding agent that will implement FAFF-1140, plus the human reviewers gating it. It closes the fail-open hole in faff-beep-boop's run-start Commissaire admit for unattended, floor-required runs, without touching the additive-governance posture on optional/interactive runs.

**Audience:** the build agent (translates the pseudocode to the project's JS), and the reviewers who own the governance surface (`plugin/skills/faff/bin/lib/commissaire.js`, `merge-gate.js`, `contract-defs.js`, and the `faff-beep-boop` orchestrator prose).

---

## 1. WHY — Problem and Principles

**The core model.** A merge floor that reads *no* schema:3 governance context returns `not-applicable → pass`, and that answer is **byte-for-byte identical** for two different runs: one that was never meant to be governed (an ordinary L3), and one that was *required* to be governed but whose run-start admit failed. The floor has no signal telling these apart. So the fix cannot live at the floor — the run must decide, *at run start*, whether it is one of the runs that may never proceed ungoverned, and refuse before any build begins.

**Problem statement.** The run-start Commissaire admit (FAFF-1034, `plugin/skills/faff-beep-boop/SKILL.md:438`) is fail-open: a non-zero exit is logged and "the run proceeds ungoverned (the merge floor stays `not-applicable` → pass)". On an unattended, floor-required run (the fly-ci-l3-runner, or L4 lights-out) that silently downgrades the strictest run to *no* governance — it can then merge, push, and write the tracker with no covering grant and no evidence trail. This change makes that failure **fail closed at run-start** on exactly the runs where governance is required, leaving the fail-open path untouched everywhere else.

**Design principles.**

- **Fail-open vs fail-closed is gated on the run fact "governance is required", never a blanket flip.** Optional (interactive, or a repo mid-rollout) keeps warn-and-continue unchanged — "governance is additive, never a new wedge" still holds there. Only a *required* run fails closed. This is the operator's decision (option 1); the spec builds to it and does not re-litigate it.
- **One definition of "unattended" across the run.** The gate must key on the *same* unattendedness fact the sentry-poller's abort-acting rule already uses (`SKILL.md:435`: an L4-minted ledger, or an L3 run that declared `autonomous.unattended: true` / the `autonomous.sentry_acting: true` alias). A gate that computed its own "unattended" could disagree with the sentry and fail-open a run the sentry treats as autonomous. Reject any implementation that introduces a second unattendedness resolver.
- **Refuse at run-start, not hold-at-merge.** A run that cannot be governed can never legally merge, so building it and holding every issue at the merge gate wastes the whole build. The refuse fires before step 4.
- **The refuse must be diagnosable, not a free-form stop.** It records a structured escalate-class `stop_reason` token (not free prose) and emits an andon needs-human event, so a headless `faff disposition` and the operator both see a real reason.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md:438` (Owner stamp & heartbeat) | prose (orchestrator) | The run-start admit step; the fail-open sentence is the target text. Fires on every genuine mint (L3 + L4), so it is the home the gate must live in. |
| `plugin/skills/faff-beep-boop/SKILL.md:139` (§0a) | prose | Existing run-start refuse precedent — but **L4-lights-out only**, so it cannot be the gate's home (it skips the L3 fly runner). |
| `plugin/skills/faff/bin/lib/commissaire.js:458-498` `cmdAdmit` | JS | Writes governor/producer/pk material + a signed schema:3 admission record. Exit 0 admitted, 2 usage/already-admitted, 3 run-dir unresolvable. `mintGovernorKeypair`/`randomBytes` (479-480) can throw **unguarded**. |
| `plugin/skills/faff/bin/lib/commissaire.js:271-273` `hasGovernanceContext` | JS | `some(e => e.schema === 3)`. No admit → no schema:3 → the floor sees nothing. |
| `plugin/skills/faff/bin/lib/merge-gate.js:934-957,983-989` `resolveGrantByEffectKind`/`andGrants` | JS | The hole: line 945 returns `not-applicable` for an ungoverned run — indistinguishable from a failed-admit required run. |
| `plugin/skills/faff/bin/lib/contract-defs.js:2270-2272` `requiresSelfConsistencyStamp(unattended, dispatchState)` | JS | The existing "governance-required" run-fact predicate (FAFF-1072): `!!unattended && dispatchState === "absent"`. Reuse this. |
| `plugin/skills/faff/bin/lib/contract-defs.js:2366-2398` `resolveGateLevel` / `unattended` default | JS | `level` is authoritative from the run-ledger; `unattended` defaults to `level === "L4"`. |
| `plugin/skills/faff/bin/lib/run-start.js:56-70` `deriveRunTrigger` | JS | Refuse-biased ladder precedent; §0a's `refuse` surfaces a reason and exits before any tracker write. |
| `plugin/skills/faff/bin/lib/disposition.js:43-48` `ESCALATE_STOP_EXACT` | JS | `{non-convergence, product-incomplete, sentry-abort}` (+ `budget-escalated(<dims>)` prefix). A new token here makes the refuse a structured run-escalation. |
| `plugin/skills/faff/bin/lib/andon.js:48-49` `ANDON_CLASSES` | JS | `park`/`sentry-trip`/`budget-breach` are default-delivered; no dedicated "refuse" class — mirror as a `park` (reason: needs-human). |

**Scope statement.** This sits at the run-start boundary of a faff-beep-boop self-drain (and L4 lights-out), between the owner/ledger mint and step 4 (the first build), on the Commissaire admit step FAFF-1034 introduced.

---

## 2. OUT OF SCOPE

- **Merge-floor distinguishability of ungoverned vs failed-admit runs.** — Excluded. **Why excluded:** the chosen decision refuses at run-start, so a required run with a failed admit never reaches the floor; the floor needs no change to satisfy this ticket. **Extension point:** `merge-gate.js:934-957` `resolveGrantByEffectKind` (a defence-in-depth "governance-required" run-start stamp is captured as an open question below, not built here).
- **Full run-abort diagnosability (transcript + event richness).** — Excluded. **Why excluded:** aborted runs currently persist only ~3 events and no transcript; that gap is tracked on FAFF-1139. This ticket adds the *structured stop_reason token + andon event*, which is the in-scope diagnosable reason. **Extension point:** FAFF-1139 (assumed, see section 7).
- **A new andon delivery class for "refuse".** — Excluded. **Why excluded:** `park` (reason: needs-human) is already default-delivered and carries a reason; a new class is unneeded surface. **Extension point:** `andon.js:48` `ANDON_CLASSES`.
- **Changing the optional/interactive fail-open behaviour.** — Excluded by principle: it stays byte-for-byte as today. **Extension point:** n/a — explicitly preserved.
- **Key rotation / `--force` re-admit semantics (FAFF-978).** — Excluded. **Why excluded:** the exit-2 already-admitted guard is unchanged; a governed run (governor.json present) skips admit entirely and never reaches the gate. **Extension point:** `commissaire.js:474-477`.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Governance-required run | An unattended run with no dispatch cut above it — `requiresSelfConsistencyStamp(unattended, dispatch_state)` true; the runs that may never proceed ungoverned. |
| Unattended | The single run fact shared with the sentry-poller: L4-minted ledger, **or** L3 with `autonomous.unattended: true` (or the `autonomous.sentry_acting: true` alias). |
| Fail closed (here) | Refuse to admit any issue, emit a needs-human andon, record a diagnosable escalate-class `stop_reason`, and stop before step 4. |
| Fail open (here) | Warn, log the admit failure, proceed ungoverned (merge floor `not-applicable` → pass). Unchanged for optional runs. |
| Admit-internal-failure | The admit crashing in `mintGovernorKeypair`/`randomBytes` — today an unguarded throw; to be surfaced as a clean non-zero exit code. |

**Type / interface shapes.**

Guarded admit exit contract (extends the existing `cmdAdmit` 0/2/3):

```
ENUM AdmitExit:
  0   # admitted (unchanged)
  2   # usage / already-admitted-without-force (unchanged)
  3   # run-dir unresolvable (unchanged)
  4   # NEW: admit internal failure — keypair/master mint threw; nothing written
```

Governance-required read (a new pure CLI projection over the run ledger):

```
RECORD AdmitRequiredResult:               # `faff commissaire admit-required --run-dir <d> --json`
  governance_required: Boolean            # requiresSelfConsistencyStamp(unattended, dispatch_state)
  unattended: Boolean                     # the SAME resolver the sentry-poller uses (level==="L4" | autonomous.unattended | sentry_acting)
  dispatch_state: Enum{dispatched,absent,indeterminate}  # "absent" at a self-drain run-start (fail-closed default)

  # Read-only, pure, never throws. A malformed/unreadable ledger MUST resolve fail-closed:
  # governance_required := true when it cannot be proven optional.
```

New escalate-class stop_reason token (added to `ESCALATE_STOP_EXACT`, `disposition.js:43`):

```
CONST STOP_GOVERNANCE_ADMIT_FAILED = "governance-admit-failed"
# isEscalateStopReason("governance-admit-failed") === true  => a run-escalation disposition item
```

**Design decisions** (each with a canonical marker; rationale collected in section 6):

- **Where the gate lives:** at the admit step (`SKILL.md:438`), not §0a. **Chosen:** the admit step — it is the one run-start locus that fires on *every* genuine mint (L3 and L4), so it covers the L3-unattended fly runner that §0a (L4-only) skips.
- **Governance-required predicate:** **Chosen:** reuse `requiresSelfConsistencyStamp(unattended, dispatch_state)` (contract-defs.js:2270) exposed via a pure `faff commissaire admit-required` read verb; no new predicate, no second unattendedness resolver.
- **Surfacing admit failure:** **Chosen:** guard `mintGovernorKeypair`/`randomBytes` in `cmdAdmit` and return exit `4` on an internal failure, so "admit failed" is an observable exit code (0/2/3/4), never a crash the prose can't branch on.
- **Refuse mechanics:** **Chosen:** the fault-class precedent (§0a's harder branch) — exit non-zero, start nothing, `admitted: []`, `owner.status: "done"` + escalate `stop_reason`, andon pump — not the softer "surface and continue".
- **Escalate token:** **Chosen:** `governance-admit-failed`, added to `ESCALATE_STOP_EXACT`.
- **Andon class:** **Chosen:** a `park` event with `reason: needs-human` (default-delivered, carries a reason), not a new class.
- **Defence-in-depth run-start governance-required stamp for the merge floor:** **Punt:** write a run-start marker so the floor can distinguish required-but-ungoverned from ordinary-ungoverned even if the run-start refuse is ever bypassed, or rely on the run-start refuse alone — needs human. `(decides: architecture)`

---

## 4. HOW — Behavior

**Architecture and approach.** Three deterministic changes plus one prose edit:

```
run-ledger (mint) --> owner-enrich --> [ADMIT STEP] --> step 4 (build)
                                          |
                     attempt: faff commissaire contract admit
                                          | exit
                          +---------------+---------------+
                     exit 0 (admitted)              exit 2/3/4 or crash (FAILED)
                          |                                |
                     proceed governed          faff commissaire admit-required --json
                                                           |
                                    +----------------------+----------------------+
                          governance_required=false               governance_required=true
                          (optional / interactive)                (unattended + floor-required)
                                    |                                        |
                          WARN + proceed ungoverned              FAIL CLOSED at run-start:
                          (merge floor not-applicable -> pass;     - admit no issue (admitted:[])
                           UNCHANGED)                              - andon: park(reason:needs-human) + pump
                                                                   - owner.status:"done",
                                                                     stop_reason:"governance-admit-failed"
                                                                   - exit non-zero, START NOTHING (no step 4)
```

**Behaviour summary.** On a failed run-start admit, the run consults one pure predicate to decide whether governance was required; if it was, the run refuses before building anything, with a structured, diagnosable, escalating stop; if it was not, nothing changes.

**Pseudocode — the admit step (replaces the fail-open sentence at `SKILL.md:438`).**

```
PROCEDURE run_start_admit(run_dir):
  1. IF governor.json exists at <run_dir>/commissaire/governor/governor.json:
        RETURN  # already governed (resume / inherited-l4 / endgame) — never re-admit, never --force
  2. exit := run `faff commissaire contract admit --run-dir <run_dir> --producer <run-id>
              --contract-revision faff-runner-v1
              --scope merge,branch-delete,pr-create,push,label-write,file-write,tracker-write`
  3. IF exit == 0: RETURN  # born governed; proceed to step 4
  4. # admit FAILED (exit 2/3/4)
     req := run `faff commissaire admit-required --run-dir <run_dir> --json`
  5. IF NOT req.governance_required:
        LOG "commissaire admit failed (exit <exit>); run is optional — proceeding ungoverned"
        RETURN  # merge floor stays not-applicable -> pass; UNCHANGED, no wedge
  6. # governance REQUIRED — fail closed at run-start
     a. append a run-critical event + `faff andon <park, reason:needs-human> ... && faff andon pump --run-dir <run_dir>`
     b. set owner.status:"done", stop_reason:"governance-admit-failed"  (the escalate-class token)
     c. DO NOT admit any issue (admitted stays [])
     d. exit non-zero, START NOTHING (do not enter step 4)
```

**Pseudocode — guarding the admit internals (`cmdAdmit`, commissaire.js:479-480).**

```
PROCEDURE mint_governor_material():
  TRY:
    kp := mintGovernorKeypair()
    master := randomBytes(32).toString("hex")
  CATCH e:
    stderr("faff commissaire admit: keypair/master mint failed: " + e.message)
    RETURN exit 4          # NEW clean exit — nothing written, no partial governor.json
  ...proceed to write governor/producer/pk + admission record...
```

**Pseudocode — the governance-required read (`admit-required`).**

```
PROCEDURE cmd_admit_required(run_dir):
  ledger := read_ledger(run_dir)                 # never throws
  unattended := resolve_unattended(ledger)       # SAME resolver the sentry-poller uses:
                                                  #   level==="L4" OR autonomous.unattended OR autonomous.sentry_acting
  dispatch_state := "absent"                      # a self-drain run-start has no dispatch cut (fail-closed default)
  IF ledger unreadable/malformed:
     unattended := true; dispatch_state := "absent"   # cannot prove optional => required
  governance_required := requiresSelfConsistencyStamp(unattended, dispatch_state)
  print JSON { governance_required, unattended, dispatch_state }
  RETURN 0
```

**Edge cases and error handling.**

- **Already governed (governor.json present):** admit skipped entirely — the gate never evaluates (resume / inherited-l4 / endgame). Precedence: skip wins over everything.
- **Dispatched build worker (`--phases build`):** inherits governor.json, so it skips admit; `dispatch_state` moot. If ever reached without governor material, `dispatch_state: absent` + unattended => fail closed (safe).
- **Malformed/unreadable ledger at `admit-required`:** resolve `governance_required: true` (cannot prove optional). Terminal (refuse), never a silent proceed.
- **Admit exit 2 (already-admitted-without-force) with no governor.json:** cannot occur — the skip in step 1 covers the governed case; a bare exit 2 here is a genuine failure and is treated as one.
- Error categories: exit 2/3/4 and crash are all **terminal admit failures** feeding step 4's classification; the *run* outcome (refuse vs proceed) is decided solely by `governance_required`.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the gate's `unattended` drifts from the sentry-poller's abort-acting resolution, so a run one treats as autonomous the other treats as optional — the gate fails open on a run the sentry would abort. **How you'd know:** a test asserting both call sites resolve `unattended` from one shared function returns false; or a fly-runner (autonomous.unattended:true) with a failed admit proceeds ungoverned. **What it means:** narrow to a single shared resolver; this is a principle, so a drift is a build defect, not an acceptable outcome.
- **The failure:** `dispatch_state` is assumed `"absent"` at run-start; a dispatched run that somehow reaches the admit step would fail-closed spuriously. **How you'd know:** dispatched runs are shown to inherit governor.json and skip admit (step 1). **What it means:** proceed — the skip makes the assumption hold; add a DONE item pinning it.
- **The failure:** the "diagnosable reason" is only as good as what the run persists; aborted runs persist ~3 events today (FAFF-1139). **How you'd know:** the refuse writes the escalate token + andon but a post-mortem finds no transcript. **What it means:** narrow — this ticket delivers the *structured token + andon*; full richness is FAFF-1139 (assumed), named, not hidden.

**Anti-patterns.**

- **Anti-pattern:** putting the gate in §0a. Why: §0a is L4-lights-out only and skips the L3-unattended fly runner — the exact run the hole hurts most.
- **Anti-pattern:** a second "unattended" computation inside the gate. Why: it can disagree with the sentry-poller and fail-open an autonomous run.
- **Anti-pattern:** a free-form `stop_reason` prose string for the refuse. Why: `faff disposition` only escalates on a token in `ESCALATE_STOP_EXACT`; free prose is silently non-escalating.
- **Anti-pattern:** holding every issue at the merge gate instead of refusing at run-start. Why: the run can never legally merge, so building it wastes the whole build.

---

## 5. Scenarios — born-verifiable main objectives

```
Given an unattended, floor-required run (L4 lights-out; requiresSelfConsistencyStamp true)
When the run-start commissaire admit exits non-zero
Then the run refuses at run-start: admitted is [], owner.stop_reason == "governance-admit-failed"
     (an escalate-class token), a park(reason:needs-human) andon event is emitted and pumped,
     and step 4 (the first build) never runs
```

```
Given an optional/interactive run (attended, or L3 with autonomous.unattended:false)
When the run-start commissaire admit exits non-zero
Then the run proceeds ungoverned unchanged — the merge floor is not-applicable -> pass,
     no refuse, no andon escalation, no escalate stop_reason
```

```
Given an unattended L3 run driven by the fly-ci-l3-runner (autonomous.unattended:true, no dispatch cut)
When the run-start commissaire admit exits non-zero (including an internal keypair-mint failure, exit 4)
Then the run refuses at run-start exactly as the L4 case does: admitted is [], stop_reason
     "governance-admit-failed", a needs-human andon event, and no build runs
```

- **Assertion:** the gate and the sentry-poller resolve `unattended` from a single shared function (no second resolver).
- **Assertion:** a governance-required run whose admit failed never reaches `resolveGrantByEffectKind` — so the merge floor is never silently `not-applicable` on a run classed governance-required.
- **Assertion:** a malformed/unreadable run ledger at `admit-required` MUST resolve `governance_required: true` (fail closed when optional cannot be proven).

---

## 6. Design Decision Rationale

**Where does the new run-start check live, given §0a is L4-only?**
Options: (a) extend §0a; (b) the admit step at `SKILL.md:438`.
- (a) §0a runs only on `inherited-l4` lights-out; the L3-unattended fly runner skips it entirely — it would leave the highest-risk run uncovered.
- (b) the admit step fires on *every* genuine mint (ordinary L3 self-drain and L4), and is exactly where the fail-open sentence lives today.
**Chosen:** the admit step — it is the single locus covering both governance-required run shapes.

**What predicate decides "governance is required"?**
Options: a new bespoke predicate; reuse `requiresSelfConsistencyStamp`.
- A new predicate risks a second, divergent definition of "unattended".
- `requiresSelfConsistencyStamp(unattended, dispatch_state)` (FAFF-1072) is already the run-fact predicate for "this run must be self-consistent because it merges unattended with no detective custody above it" — identical shape to "this run must be governed".
**Chosen:** reuse `requiresSelfConsistencyStamp`, exposed via a pure `admit-required` read that resolves `unattended` from the *same* function the sentry-poller uses.

**How is a failed admit made observable to the prose?**
`mintGovernorKeypair`/`randomBytes` throw unguarded today, so a crypto failure crashes rather than returning a code the prose can branch on.
**Chosen:** guard them and return a clean exit `4`; the prose branches on exit `2/3/4` uniformly as "admit failed".

**Soft surface vs hard fault for the refuse?**
§0a offers a soft `refuse` (surface + exit before tracker write) and a harder `fault` (exit non-zero, start nothing).
**Chosen:** the fault-class — a run that cannot be governed can never legally merge; starting nothing is correct and cheapest.

**Which stop_reason?** **Chosen:** a new exact token `governance-admit-failed` in `ESCALATE_STOP_EXACT` — makes `faff disposition` raise a run-escalation item. A free-form string would be silently non-escalating.

**Which andon signal?** Options: a new `refuse` class; reuse `park` (reason: needs-human) or `sentry-trip`. **Chosen:** `park` with `reason: needs-human` — default-delivered, already carries a reason, no new class surface. `sentry-trip` rejected: it reads as a mid-run poller abort, not a run-start governance refusal.

**Rejected alternative — hold every issue at the merge gate.** Building the run then blocking each merge wastes the whole build for a run that can never legally merge. Recorded rejected per the operator's option-1 decision; not the primary.

**Rejected/deferred alternative — a merge-floor "governance-required" marker.** Stamping a run-start marker so `resolveGrantByEffectKind` could distinguish required-but-ungoverned from ordinary-ungoverned is defence-in-depth beyond the run-start refuse. Deferred as an open question (see section 7), not built here.

---

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt (decides: architecture):** should the run *also* write a run-start "governance-required" stamp the merge floor can read, as defence-in-depth in case the run-start refuse is ever bypassed (e.g. a resumed run, a future code path that skips the admit step)? The chosen decision refuses at run-start and needs no floor change; this is belt-and-braces only. A human/architect should weigh the added surface against the residual risk.

**Assumptions.**

- **Assumes:** FAFF-1139 (aborted-run diagnosability — transcript + richer event persistence) exists as the follow-up that makes the refuse fully post-mortem-diagnosable. **Validation:** confirm FAFF-1139 is open and this ticket depends on it for anything beyond the structured `stop_reason` token + andon event; if FAFF-1139 is closed or absent, re-check whether the in-scope diagnosability (token + andon) is sufficient before starting.
- **Assumes:** the sentry-poller's abort-acting unattendedness resolution is (or can be) exposed as a single shared function callable from the `admit-required` read. **Validation:** grep `plugin/skills/faff/bin/lib/` for the resolver behind the `SKILL.md:435` rule (`autonomous.unattended` / `sentry_acting` + `level === "L4"`); if it is inline prose-only, factor it into a shared JS function as part of this ticket.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] An unattended, floor-required run whose run-start admit fails refuses before step 4 — no issue is admitted, no build runs.
- [ ] An optional/interactive run whose run-start admit fails proceeds ungoverned exactly as before (merge floor `not-applicable` → pass), with no refuse and no escalation.

### From WHAT (types and interfaces)
- [ ] `faff commissaire admit-required --run-dir <d> --json` prints `{ governance_required, unattended, dispatch_state }`, is pure, and never throws.
- [ ] `admit-required` resolves `unattended` from the same shared function the sentry-poller uses (no second resolver).
- [ ] A malformed/unreadable run ledger at `admit-required` resolves `governance_required: true`.
- [ ] `cmdAdmit` returns exit `4` (nothing written) when `mintGovernorKeypair`/`randomBytes` throw, instead of crashing; exits 0/2/3 are unchanged.
- [ ] `"governance-admit-failed"` is a member of `ESCALATE_STOP_EXACT`; `isEscalateStopReason("governance-admit-failed") === true`.

### From HOW (behaviour)
- [ ] The admit step consults `admit-required` only when the admit failed (exit 2/3/4) and no governor.json exists.
- [ ] On `governance_required: true`, the run writes `owner.status:"done"` + `stop_reason:"governance-admit-failed"`, emits a `park` (reason: needs-human) andon event and pumps it, keeps `admitted: []`, and exits non-zero before step 4.
- [ ] On `governance_required: false`, the run logs and proceeds ungoverned — byte-for-byte the pre-change behaviour.
- [ ] A governed run (governor.json present) skips admit and never evaluates the gate.

### From HOW (edge cases)
- [ ] A governance-required refuse produces `faff disposition` output containing a run-escalation item keyed on `governance-admit-failed`.
- [ ] A governance-required run whose admit failed never reaches `resolveGrantByEffectKind` (asserted: no merge attempt on that run).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Mint an L4 (or autonomous.unattended:true) run ledger; ensure NO governor.json.
  2. Force the run-start admit to exit non-zero (e.g. stub randomBytes to throw => exit 4).
  3. Run the admit step.
  4. ASSERT: no step-4 build dispatched; admitted == []; owner.stop_reason == "governance-admit-failed";
     an andon park(reason:needs-human) event is present; process exit is non-zero.
  5. Repeat with an attended run => ASSERT the run proceeds ungoverned, no refuse, no escalate stop_reason.
```

---

## Already shipped against this surface

None of these supersede the premise; FAFF-1034 *is* the premise being fixed.

- **FAFF-1034 (Done)** — introduced the run-start admit and the fail-open behaviour. The behaviour this ticket makes conditional, not superseded.
- **FAFF-1108 / 1118 / 1119 (Done)** — extended governed effect records to push / PR-create / label / ADR / branch-delete. Unchanged; they only ever run on a governed run.
- **FAFF-978 (Done)** — admit idempotency + revocation (the exit-2 already-admitted guard). The gate's step-1 skip keeps this untouched.
- **FAFF-976 / FAFF-1008 (Done)** — merge-chokepoint verification + `verdict conclude` hardening. Downstream of admit; not reached on a refused run.

confidence: medium