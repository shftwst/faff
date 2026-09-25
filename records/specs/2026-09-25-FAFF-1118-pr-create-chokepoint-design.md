# nlspec — FAFF-1118: PR-create chokepoint + close the merge-coupled branch-delete coattail

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1118.

This is the buildable spec for **FAFF-1118** ("Slice A: PR-create chokepoint + close the merge-coupled branch-delete coattail"), child of the FAFF-1108 umbrella epic. Audience: the build agent that will implement Slice A, and the human reviewers who gate it. It is a design spec — WHAT and acceptance criteria, not an implementation walkthrough. Every code anchor is against **origin/main HEAD `302d2cc8`** (see _Assumptions_ — the build branches off origin/main, not the current local HEAD).

## 1. WHY — Problem and Principles

**The load-bearing model.** Commissaire prevents a protected effect by making one component the *sole sanctioned path* for that effect, and having that path refuse the effect unless it can verify a covering, Ed25519-signed *grant* (an `effect-decision-verdict`) against the pinned public key. FAFF-1034 built this for exactly one effect — `merge` — through `faff merge-gate`. Every other protected effect faff performs still rides an unmediated path. This slice extends the *sole-sanctioned-chokepoint* pattern to the effect closest in shape to merge — **`pr-create`** — and closes a hole where a second effect (`branch-delete`) rides the merge's coattail: it is declared and in-scope but never independently authorized or verified.

**Problem statement.** Today a governed run's PR is opened by a raw `gh pr create` (faff-graft Step 9b) with no grant check, and a `--delete-branch` merge deletes a branch under a grant that only ever covered `{merge}` — the merge chokepoint builds and verifies the merge effect alone (`merge-gate.js:919`), so the branch-delete is prevented by nothing. This slice adds `faff pr-create` as the sole sanctioned PR-open path with a fail-closed grant check, and makes a `--delete-branch` merge require and verify a grant covering **both** `{merge}` and `{branch-delete}`.

**Design principles.**

- **Additive, byte-for-byte on the ungoverned and the today-covered paths.** An ungoverned run (no schema:3 records) must be byte-for-byte unaffected: `pr-create` and the branch-delete leg both resolve `not-applicable` → pass. A historical merge+delete run's `audit verify` that passed before this slice must still pass — the change adds a *live-chokepoint* requirement and an *additive* producer authorize call; it mutates no existing ledger record and no existing record's signature image.
- **Do not touch the pure cores.** `evaluateDecisionRequest` (`commissaire.js:135`), `evaluateLevelPolicy` (`commissaire.js:186`), `chokepointPermit` (`commissaire.js:205`) and `decideFloor` (`contract-defs.js`) are the born-verifiable, replayable cores. The two-effect coverage is expressed by *reusing* them unchanged (a second grant through the same machinery), never by widening `chokepointPermit` to cover a set. Any AND-of-grants happens in the merge-gate *shell*, where the single `decision_grant` field is already computed today.
- **Fail closed, never fail open.** Every new resolver leg is three-valued and defaults to refusal on any governed-but-uncovered / unreadable-key case, mirroring `resolveCommissaireDecisionGrant` exactly (`merge-gate.js:899-921`).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js:64` (`EFFECT_KINDS`) | JS | The flat effect-kind Set `pr-create` is added to |
| `plugin/skills/faff/bin/lib/merge-gate.js:899` (`resolveCommissaireDecisionGrant`) | JS | The three-valued resolver `resolvePrCreateGrant` / `resolveBranchDeleteGrant` mirror |
| `plugin/skills/faff/bin/lib/merge-gate.js:930` (`mergeCoveredBySchema3Grant`) | JS | The schema:2 suppression predicate `prCreateCoveredBySchema3Grant` mirrors |
| `plugin/skills/faff/bin/lib/commissaire.js:205` (`chokepointPermit`) | JS | Single-effect verification core — reused unchanged, per-effect |
| `plugin/skills/faff/bin/lib/commissaire.js:150-152` (leg 3 scope) | JS | Enforces `admitted_scope.includes(effect.kind)` — why the admit `--scope` must grow |
| `plugin/skills/faff/bin/faff:75,198` (dispatch) | JS | Where `cmdMergeGate` registers; `faff pr-create` registers the same way |
| `plugin/skills/faff-graft/SKILL.md` Step 9b (~L541) + Governed merge producer half (L626-632) | prose | The raw `gh pr create` call site and the declare→authorize→observe producer half |
| `plugin/skills/faff-beep-boop/SKILL.md` (~L435 admit; run-close reconcile/conclude) | prose | Run-start admit `--scope merge,branch-delete` and per-issue close |

**Scope statement.** This is the first of three slices under FAFF-1108 extending Commissaire self-governance from merge-only to its other protected effects; it is the only slice that adds a real prevention chokepoint.

## 2. OUT OF SCOPE

- **Governed records (Slice B).** — Extending the chokepoint pattern to `tracker-write` / `label-write` effects. — *Why excluded:* separate ticket; no PR-open or merge coupling. — *Extension point:* the same resolver/producer-half pattern this slice establishes, keyed on those effect kinds already present in `EFFECT_KINDS` (`effects.js:64-68`).
- **Tracker-status governance (Slice C).** — Governing tracker status transitions. — *Why excluded:* separate ticket. — *Extension point:* as Slice B.
- **Deploy / db-migration / secret-rotation / webhook / registry-publish / force-push / prod-script chokepoints.** — *Why excluded:* those kinds exist in `EFFECT_KINDS` but have no narrated call site faff itself drives yet. — *Extension point:* add a `faff <effect>-gate` mirroring `faff pr-create`.
- **Widening `chokepointPermit` to verify a set of effects.** — *Why excluded:* the two-effect coverage is achieved with a second grant through the unchanged single-effect core (see §3 _Two-effect coverage_ decision). — *Extension point:* if a future effect genuinely needs one grant to cover N effects atomically, `chokepointPermit` (`commissaire.js:205`) is where a covered-effects list would land.
- **Changing the `--local` merge path's branch-delete handling** beyond what it already produces. — *Why excluded:* the coattail is the PR-merge `--delete-branch` path where `mergeEffectsFor` emits the branch-delete effect (`merge-gate.js:808-812`); the local ff-only path does not delete a remote branch. — *Extension point:* if `cmdMergeGateLocal` ever emits a branch-delete effect, the same `resolveBranchDeleteGrant` leg applies there.
- **The off-ledger `reconcile-merges` detection backstop** (beep-boop step 1a). — *Why excluded:* detection, not prevention; unchanged. — *Extension point:* n/a.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| pr-create effect | A protected effect of kind `pr-create` representing opening a pull request; target = the base branch the PR opens against |
| pr-create grant | A signed `effect-decision-verdict` (schema:3) whose `payload.effect` is `{kind:"pr-create", target}` and `payload.verdict === "grant"` |
| branch-delete grant | A signed `effect-decision-verdict` whose `payload.effect` is `{kind:"branch-delete", target:<head-ref>}` and grants |
| coattail | The current state where a `--delete-branch` merge's branch-delete effect is declared + in `admitted_scope` but never authorized or verified — it rides the merge grant |
| three-valued grant | `not-applicable` (ungoverned) / `valid-grant` (verified covering grant) / `absent-or-invalid` (governed but no verified covering grant) |

**Type additions.**

```
# effects.js:64 — EFFECT_KINDS gains "pr-create" as a first-class kind (NOT "other").
EFFECT_KINDS = { merge, branch-delete, deploy, db-migration, secret-rotation,
                 email, webhook, registry-publish, force-push, prod-script,
                 label-write, tracker-write, file-write, pr-create, other }
# effectDescriptorViolations (effects.js:72) then accepts {kind:"pr-create",...} without change.

RECORD PrCreateEffect:
  kind:   "pr-create"          # literal
  target: String               # the base branch the PR opens against (e.g. "main"); "*" wildcard allowed
  reversible: true             # a PR-create is reversible (close the PR)
```

**CLI surface — `faff pr-create`** (new; registered in `bin/faff` beside `"merge-gate": cmdMergeGate` at faff:198, `cmdPrCreate` from `merge-gate.js` or a sibling module):

```
faff pr-create --run-dir DIR --issue ISSUE --base BRANCH --body-file FILE [--title T] [--level L] [--json]
  # Opens the PR via `gh pr create` — the SOLE place that shell-invokes `gh pr create`.
  # Refuses (non-zero, opens nothing) when resolvePrCreateGrant === "absent-or-invalid".
  # Git-only mode (no remote): no-op, exit 0 — mirrors Step 9b's git-only no-op.
```

**Resolver signatures** (mirror `resolveCommissaireDecisionGrant`, `merge-gate.js:899`):

```
resolvePrCreateGrant(runDir, issue, prTarget)      -> "not-applicable" | "valid-grant" | "absent-or-invalid"
resolveBranchDeleteGrant(runDir, issue, branchTarget) -> same three-valued
prCreateCoveredBySchema3Grant(runDir, issue, prTarget) -> Boolean   # mirrors mergeCoveredBySchema3Grant (:930)
```

**Design decisions.**

**Two-effect coverage for the branch-delete coattail — the one genuine build subtlety.** `chokepointPermit` (`commissaire.js:205`) verifies coverage against a *single* `verdict.payload.effect`; the verdict payload (`cmdRequestDecision`, `commissaire.js:585`) carries a single `effect: req.effect`. Covering both `{merge}` and `{branch-delete}` needs the grant/verdict to express two effects. Two mechanisms:

- **(A) Covered-effects list on the verdict payload** — add an additive `effects: [...]` field and a new list-coverage check. Touches the verification core and the payload signature image.
- **(B) A second, independently-authorized branch-delete grant** — authorize the branch-delete effect as its own request→verdict through the *unchanged* pure core (`evaluateDecisionRequest` + `chokepointPermit`), and have the merge chokepoint resolve *two* grants and require both.

**Chosen:** (B) a second branch-delete grant — rationale: the branch-delete effect is already *declared* at `step="merge"` (`faff-graft/SKILL.md` L629) and already in `admitted_scope` (`--scope merge,branch-delete`), so the only missing pieces are the authorize call and the chokepoint verification; it reuses the unchanged pure cores, directly honouring the "do not touch the pure cores" principle; and it is additive to the payload (a new record, no existing record mutated). (A) is left as the documented extension point if atomic N-effect coverage is ever needed.

**Verdict selection under a shared step — the concrete build detail.** Both the merge grant and the branch-delete grant live at `step="merge"` (that is where the branch-delete is declared). Today `resolveCommissaireDecisionGrant` filters `step==="merge"` and takes the **last** verdict (`merge-gate.js:903-916`). With two step-`merge` verdicts, last-wins would let a branch-delete verdict shadow the merge verdict. **Chosen:** both resolvers select by `payload.effect.kind` (merge resolver → latest `kind:"merge"` verdict; branch-delete resolver → latest `kind:"branch-delete"` verdict). This is additive and back-compat: on a merge-only run there is exactly one merge verdict, so filtering-by-kind selects the identical verdict last-wins did.

**Where the AND lands — keep `decideFloor` verbatim.** The merge chokepoint must reflect branch-delete coverage without changing the pure floor. **Chosen:** the merge-gate *shell* computes `decision_grant` as the AND of the merge grant and (only when `resolved.flags.includes("--delete-branch")`) the branch-delete grant — the single `decision_grant` field stays `valid-grant` only if both resolve `valid-grant`, `absent-or-invalid` if either is missing/invalid, `not-applicable` when ungoverned. `decideFloor`, `FLOOR_DECISION_GRANTS` (`contract-defs.js:2314`), and the blocker text are untouched. Rejected: a new `branch_delete_grant` floor field — a more precise blocker message, but it touches the pure floor, its enum, and the contract semantics for no prevention benefit.

**pr-create target.** The PR has no number at create time, so the merge grant's `pr:N` observe-target convention cannot be reused. **Chosen:** `prTarget` = the base branch the PR opens against (mirrors the merge grant's own `mergeTarget` = base-branch convention, `merge-gate.js:914`); `effectTargetMatches` (`effects.js:89`) still allows a `"*"` wildcard grant.

**Where the pr-create chokepoint sits.** `faff merge-gate` folds its grant leg into a multi-leg `decideFloor` (CI, AC, review, holdout…). `faff pr-create` runs *after* Step 9's review-`pass` and *before* CI (CI fires on PR open), so it has no CI/AC/review floor of its own. **Chosen:** the pr-create chokepoint is a standalone three-valued guard inline in `cmdPrCreate` (branch directly on `resolvePrCreateGrant`), not routed through `decideFloor`. Rationale: pr-create carries no other floor legs, so a full floor would be dead machinery.

## 4. HOW — Behavior

**Architecture.** Two independent additions sharing one pattern:

```
                       ungoverned run (no schema:3)        governed run (admitted)
faff pr-create ──────► not-applicable → open PR      │  valid-grant   → open PR
  (sole gh-pr-create)                                 │  absent/invalid → REFUSE, open nothing
merge-gate (--delete-branch) ► not-applicable → merge │  both grants valid → merge
                                                       │  either missing    → REFUSE before merge
```

**`faff pr-create` behaviour.**

```
PROCEDURE cmd_pr_create(runDir, issue, base, bodyFile, title):
  1. IF git-only (no pushable remote): return 0   # no PR to open; mirrors Step 9b git-only no-op
  2. grant := resolvePrCreateGrant(runDir, issue, base)
  3. IF grant == "absent-or-invalid":
        emit refusal { verdict:"refuse", blocker:"Commissaire pr-create decision absent or invalid ..." }
        return non-zero            # open NOTHING
  4. run: gh pr create --body-file <bodyFile> [--title <title>]   # the sole gh-pr-create invocation
  5. IF NOT prCreateCoveredBySchema3Grant(runDir, issue, base):    # ungoverned OR ungranted
        declare + observe the {kind:"pr-create", target:base} effect at step="pr-create"  (schema:2 trail)
     # covered → suppress the schema:2 trail (single schema:3 lineage), mirroring merge-gate.js:1596/1612
  6. emit result; return 0
```

**`resolvePrCreateGrant` — mirror of the merge resolver** (`merge-gate.js:899-921`), differences noted:

```
PROCEDURE resolvePrCreateGrant(runDir, issue, prTarget):
  entries := commissaireReadLedger(runDir)            # throws → "not-applicable"
  verdicts := entries WHERE schema==3 AND author=="commissaire"
                        AND kind_of_entry=="effect-decision-verdict"
                        AND issue==issue AND step=="pr-create"        # <- "pr-create", not "merge"
  IF verdicts empty:
     return hasGovernanceContext(runDir) ? "absent-or-invalid" : "not-applicable"   # fail-closed leg
  verdict := latest verdict WHERE payload.effect.kind=="pr-create"    # <- select by kind
  pkRec := read pinned PK   # unreadable → "absent-or-invalid"
  effect := { kind:"pr-create", target: prTarget OR verdict.payload.effect.target }
  return commissaireChokepointPermit(effect, verdict, pkRec.pk, pkRec.pk_fingerprint).permit
           ? "valid-grant" : "absent-or-invalid"
```

**Merge chokepoint — the coattail close.** In `cmdMergeGate`'s PR path, where the floor is built (`merge-gate.js:1516`) with `headRefName` and `resolved.flags` both already in scope (headRefName resolved at ~L1441; `resolved.flags` used at :1612):

```
mergeGrant := resolveCommissaireDecisionGrant(runDir, issue, base_or_null)   # now selects by kind:"merge"
IF resolved.flags includes "--delete-branch":
   bdGrant := resolveBranchDeleteGrant(runDir, issue, headRefName)
   decision_grant := andGrants(mergeGrant, bdGrant)     # both valid → valid-grant;
                                                         # either absent/invalid → absent-or-invalid;
                                                         # both not-applicable → not-applicable
ELSE:
   decision_grant := mergeGrant                          # byte-for-byte today for a non-delete merge
floor.decision_grant := decision_grant                   # decideFloor UNCHANGED
```

**Behaviour summary — `andGrants`.** `valid-grant` only if every input is `valid-grant`; `absent-or-invalid` if any input is `absent-or-invalid`; `not-applicable` only if all inputs are `not-applicable` (an ungoverned run, byte-for-byte). This is the fail-closed monoid: absent-or-invalid dominates, valid-grant is neutral only among valid grants.

**Producer-half wiring (SKILL prose, not code).**

- **Admit scope.** `faff-beep-boop/SKILL.md` (~L435) and `faff-graft/SKILL.md` (L164) admit with `--scope merge,branch-delete` → `--scope merge,branch-delete,pr-create`. Required: leg 3 (`commissaire.js:150-152`) denies `effect-out-of-scope` for any kind absent from `admitted_scope`, so without `pr-create` in scope the pr-create authorize would `deny` and the governed PR-open would fail closed even when the producer tried.
- **Governed pr-create producer half** (new sub-step in faff-graft Step 9b, on a governed run, mirroring the Governed merge producer half at L626-632): `effect declare --step pr-create` with `[{kind:"pr-create", target:<base>}]`; `effect authorize --step pr-create` with `{effect:{kind:"pr-create", target:<base>}, level, attended, holdout}`; then `faff pr-create` verifies + opens; then `effect observe --step pr-create`. `faff pr-create` suppresses its own schema:2 trail on this covered create.
- **Branch-delete authorize** (edit the Governed merge producer half, L629): when the merge-args carry `--delete-branch`, add a second `effect authorize --step merge` with `{effect:{kind:"branch-delete", target:<head-branch>}, level, attended, holdout}` alongside the existing merge authorize. The branch-delete declare already exists on that line — only the authorize is added.
- **Wire Step 9b through `faff pr-create`.** Replace the raw `gh pr create --body-file safe.md` (Step 9b item 6, ~L541) with `faff pr-create --run-dir "$run_dir" --issue <ISSUE> --base <base> --body-file safe.md [--title …]`. On an *ungoverned* run this is a pure indirection that opens the PR identically (grant `not-applicable`); on a *governed* run it fails closed without a covering grant.

**Anti-pattern:** widening `chokepointPermit` to loop over an effects array. Why: it changes the born-verifiable verification core's signature image and breaks the `audit verify` replay guarantee; the second-grant mechanism keeps the core untouched.

**Anti-pattern:** authorizing the branch-delete effect at a *new* step (e.g. `step="branch-delete"`). Why: leg 5b coverage (`commissaire.js:167-170`) requires a declare at the *same* (issue, step); the branch-delete is declared at `step="merge"`, so a new step would need a second declare and would fork `computeEscapes`/reconcile keying for no benefit.

### Failure modes

- **The failure:** the shared-step verdict-selection change silently reorders which merge verdict a *merge-only* run selects (a regression to the shipped FAFF-1034 path). **How you'd know:** the existing merge-gate self-tests (`merge-gate.js` `mergeGateSelftest`, and the `resolveCommissaireDecisionGrant` covered/uncovered cases) would flip verdict on a single-merge-verdict ledger. **What it means:** proceed only if filtering-by-`kind:"merge"` is proven identical to last-wins on a one-merge-verdict ledger (it is, by construction); a failing self-test means abandon the by-kind change and use a distinct step instead.
- **The failure:** `andGrants` accidentally lets `not-applicable` dominate, opening a hole where a governed `--delete-branch` merge with a valid merge grant but *no* branch-delete grant reads `valid-grant`. **How you'd know:** a governed-run scenario (below) with a merge grant and no branch-delete grant does not refuse. **What it means:** abandon that `andGrants` truth table — `absent-or-invalid` must dominate.
- **The failure:** `faff pr-create` is added but a second, un-migrated `gh pr create` call site survives, so the "sole sanctioned path" property is false. **How you'd know:** `grep -rn "gh pr create" plugin/skills/` returns any hit outside `cmdPrCreate`. **What it means:** narrow — migrate the stray site before claiming DONE.

## 5. SCENARIOS — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an UNGOVERNED run (no schema:3 records in the run dir)
When faff pr-create runs to open the PR
Then the PR opens exactly as a raw `gh pr create` would (grant resolves not-applicable),
     and the run's ledger and PR are byte-for-byte identical to the pre-slice behaviour
```

```
Given a GOVERNED run whose producer declared + authorized a pr-create grant covering the base branch
When faff pr-create runs
Then resolvePrCreateGrant returns valid-grant, the PR opens, and the schema:2 pr-create trail is SUPPRESSED
     (single schema:3 lineage — prCreateCoveredBySchema3Grant is true)
```

```
Given a GOVERNED run merging with --delete-branch, holding a valid {merge} grant but NO {branch-delete} grant
When faff merge-gate runs its floor
Then decision_grant resolves absent-or-invalid and the merge is REFUSED before it lands
```

```
Given a GOVERNED run merging WITHOUT --delete-branch, holding a valid {merge} grant
When faff merge-gate runs its floor
Then decision_grant resolves from the merge grant alone (no branch-delete leg), byte-for-byte the FAFF-1034 path
```

- The `effects.js` selftest MUST accept a `{kind:"pr-create", target, reversible}` descriptor as valid (no `other` coercion) and reject an unknown kind unchanged.

## 6. DESIGN DECISION RATIONALE

**How does the branch-delete grant express two-effect coverage additively?**
- *Options:* (A) covered-effects list on the verdict payload + list-coverage check; (B) a second independently-authorized branch-delete grant through the unchanged pure core.
- **Chosen:** (B) — reuses `evaluateDecisionRequest` / `chokepointPermit` unchanged, the branch-delete effect is already declared + in-scope, and it mutates no existing record so historical `audit verify` still passes. (A) rejected: it changes the verification core's signature image. `(decides: architecture)`

**How does the merge chokepoint verify both grants without changing `decideFloor`?**
- *Options:* shell-ANDs both grants into the existing single `decision_grant` field; a new `branch_delete_grant` floor field.
- **Chosen:** shell-AND into `decision_grant` — keeps the pure floor, its enum (`FLOOR_DECISION_GRANTS`), and the blocker text verbatim. New field rejected: touches the pure core and contract semantics for a marginally more precise blocker.

**How do two step-`merge` verdicts get disambiguated?**
- *Options:* last-wins (today); select by `payload.effect.kind`.
- **Chosen:** select by kind — additive and identical to last-wins on a one-merge-verdict (pre-slice) ledger.

**Where does the pr-create chokepoint live?**
- *Options:* fold into a `decideFloor`-style floor; a standalone inline guard in `cmdPrCreate`.
- **Chosen:** standalone inline guard — pr-create runs post-review, pre-CI, so it has no other floor legs.

**What is the pr-create effect target?**
- *Options:* `pr:N` (no number exists yet); the base branch.
- **Chosen:** the base branch (mirrors the merge grant's base-branch target; `"*"` wildcard still available). At the time of writing the PR number does not exist until `gh pr create` returns.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. (No `**Punt:**` markers — every decision above is closed against origin/main.)

**Assumptions.**

- **Assumes:** the build branches off **origin/main** (HEAD `302d2cc8` at spec time), which carries FAFF-1034 (`resolveCommissaireDecisionGrant`, the schema:3 governed-merge chokepoint) and FAFF-1040/1072/1077 floor fields. *Validate:* `git merge-base --is-ancestor 9d1fadef origin/main` (FAFF-1034's merge) and confirm `resolveCommissaireDecisionGrant` exists at `merge-gate.js:~899` before starting. The current local HEAD (`faff-1075-thread-build-judge-backends`) predates FAFF-1034 and MUST NOT be the base.
- **Assumes:** `admitted_scope` (leg 3, `commissaire.js:150-152`) gates authorize by effect kind. *Validate:* the reason string `effect-out-of-scope` is returned when `!scope.includes(effect.kind)`. This is why the admit `--scope` must gain `pr-create`.
- **Assumes:** `headRefName` and the parsed `resolved.flags` (including `--delete-branch`) are in scope at the PR-path floor build (`merge-gate.js:1516`). *Validate:* `headRefName` is set from `pr view … headRefName` (~L1441) and `resolved.flags` is used at :1612.

## 8. DONE — Definition of Done

### From WHY
- [ ] An ungoverned run's PR-open and any merge are byte-for-byte unchanged (the ungoverned holdout scenario passes).

### From WHAT (types and interfaces)
- [ ] `EFFECT_KINDS` (`effects.js:64`) contains `pr-create` as a first-class kind; `effectDescriptorViolations` accepts `{kind:"pr-create",…}` and the `effects` selftest asserts it (no `other` coercion).
- [ ] `faff pr-create` is registered in `bin/faff` dispatch (beside `"merge-gate"` at faff:198) and accepts `--run-dir --issue --base --body-file [--title] [--level] [--json]`.
- [ ] `resolvePrCreateGrant(runDir, issue, prTarget)` returns the three values with the same fail-closed logic as `resolveCommissaireDecisionGrant`, filtering `step==="pr-create"` and selecting by `payload.effect.kind==="pr-create"`.
- [ ] `resolveBranchDeleteGrant(runDir, issue, branchTarget)` mirrors it with `{kind:"branch-delete"}` at `step==="merge"`, selecting by `payload.effect.kind==="branch-delete"`.
- [ ] `prCreateCoveredBySchema3Grant` mirrors `mergeCoveredBySchema3Grant` (boolean wrapper).

### From HOW (behaviour — pr-create)
- [ ] `faff pr-create` is the sole `gh pr create` invocation: `grep -rn "gh pr create" plugin/skills/` returns only `cmdPrCreate` (Step 9b prose now calls `faff pr-create`).
- [ ] On `absent-or-invalid`, `faff pr-create` exits non-zero, opens no PR, and emits the pr-create blocker.
- [ ] On `valid-grant`/`not-applicable`, the PR opens; the schema:2 pr-create trail is suppressed iff `prCreateCoveredBySchema3Grant` is true, written otherwise.
- [ ] Git-only mode: `faff pr-create` is a no-op exit 0.

### From HOW (behaviour — coattail close)
- [ ] `resolveCommissaireDecisionGrant` selects the merge verdict by `payload.effect.kind==="merge"` and remains byte-for-byte on a one-merge-verdict ledger (existing `mergeGateSelftest` cases still pass).
- [ ] On a `--delete-branch` merge, the shell ANDs the merge grant and the branch-delete grant into the single `decision_grant` field; `decideFloor` / `FLOOR_DECISION_GRANTS` are unchanged.
- [ ] A `--delete-branch` merge with a valid merge grant but no branch-delete grant refuses (`decision_grant === "absent-or-invalid"`).
- [ ] A non-`--delete-branch` merge resolves `decision_grant` from the merge grant alone.

### From HOW (producer-half prose)
- [ ] Both run-start admit sites (`faff-beep-boop` ~L435, `faff-graft` L164) admit `--scope merge,branch-delete,pr-create`.
- [ ] faff-graft Step 9b gains a Governed pr-create producer half (declare→authorize→`faff pr-create`→observe on a governed run).
- [ ] The Governed merge producer half (L629) adds the branch-delete `effect authorize` when the merge-args carry `--delete-branch`.

### From WHY (additivity invariant)
- [ ] A historical merge+delete run's `audit verify` that passed before the slice still passes (no existing record's signature image changed).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. admit a run with --scope merge,branch-delete,pr-create
  2. declare+authorize a pr-create grant for base="main"; faff pr-create --base main → PR opens, exit 0
  3. declare+authorize {merge}@main AND {branch-delete}@<head>; merge-gate --delete-branch --execute → merge-ok
  4. repeat step 3 omitting the branch-delete authorize → merge REFUSED (decision_grant absent-or-invalid)
  # if this connects, the pr-create chokepoint and the two-grant coattail close are wired
```

## Methodology critique

*Lens: `faffter-dark-methodology-agile-delivery` · `issue-critique`. Advisory — does not block promotion; surfaces for `/faff-wtf` and the human build gate.*

**Right-sized? — Split candidate.**
- *What's there.* Two structurally independent concerns: (A) the pr-create chokepoint (new `EFFECT_KIND`, `faff pr-create`, `resolvePrCreateGrant`, graft Step 9b rewire, schema:2 suppression) and (B) the branch-delete coattail close (a second branch-delete grant through the pure core, merge-gate shell ANDing two grants into the one field). Each is a valid 1-3 day unit on its own path (PR-open vs merge/branch-delete), and neither consumes the other's output.
- *Why it matters.* Even "novel-but-templated," two effect paths in one unit likely overruns the 3-day bar, and bundled progress on one half hides the other, so neither can ship without waiting on the whole.
- *What to do.* Split into 1118a (pr-create chokepoint) and 1118b (branch-delete coattail); pr-create half first (clean templated mirror), the subtler two-grant coattail second.

**Workstream fit? — Cohesion smell (cross-refs right-sized).**
- *What's there.* Fits parent epic FAFF-1108 cleanly as the first A slice. But the title joins two outcomes with "+": a PR-create chokepoint and a branch-delete coattail close.
- *Why it matters.* Two outcomes in one unit means "done" spans two independent completion criteria, with no single outcome to sequence toward inside it.
- *What to do.* Same split; each half becomes one outcome-named unit. If kept whole, name the two-outcome bundle as a deliberate coupling so the reader knows it is a choice, not an oversight.

**Deps surfaced? — No issues.**
FAFF-1034 is an explicit `blockedBy` link (surfaced, not implicit) and is merged to main, so the dependency is both honest and satisfied. No unlinked references to sibling slices B/C or to the shipped `resolveCommissaireDecisionGrant` it mirrors.

**Risk profile? — One concentrated novel spot.**
- *What's there.* Most of the change is templated on the shipped merge-gate / `resolveCommissaireDecisionGrant`, so low surprise. The single subtle bit is the two-grant coattail: a second independently-authorized branch-delete grant ANDed into the existing single `decision_grant` field, through the unchanged pure core with `decideFloor` untouched.
- *Why it matters.* Concentrated novelty folded into an existing field is exactly where a regression would hide, and here it rides in behind the low-risk templated work.
- *What to do.* Isolate the two-grant bit (the split above does this) so it lands with its own focused test proving both the AND-of-two-grants and the byte-for-byte no-op. The existing guardrails (no-op on ungoverned runs, additive-only so historical `audit verify` still passes) are the right ones; keep them anchored to that isolated unit.

confidence: high
spec-review: approve
build-tier: complex
