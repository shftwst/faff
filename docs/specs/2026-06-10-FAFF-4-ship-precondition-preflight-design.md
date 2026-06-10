# FAFF-4: Delivery preconditions as a first-class pre-flight + graceful park

This nlspec is for the build agent that will edit faff's prose contracts so the `ship` flow stops assuming push/PR/merge mechanics "just work". It is also for the human reviewer weighing the one contested call — whether delivery preconditions earn a fourth fixed outcome (they do not; see DESIGN DECISION RATIONALE). The artifact touches four skill files plus the gateway delivery section; it deliberately stays clear of the integrity-floor CI-green wording that FAFF-3 owns.

## 1. WHY — Problem and Principles

**Problem statement.** Today the `ship` slot (default `faffter-noon-ship` → `gh pr merge`) and faff-graft Step 10/11 assume delivery mechanics succeed — the branch pushes, the PR opens, the chosen merge method is enabled, org/token policy permits what the diff relies on. When one of these mechanical preconditions fails, the failure lands entirely on the operator, outside any gate or park: graft has no notion that delivery is mechanically blocked, so the L2/L3 "agent drives, you nod at gates" promise degrades into hand-cranking git/gh/GitHub-settings mid-flow (FAFF-1 hit three in one run: missing `workflow` token scope, org-disallowed Actions PRs, disabled rebase-merge). This change makes delivery preconditions first-class — a cheap pre-flight that catches them before a build is wasted, and a graceful park (not a silent operator handoff) when one bites at ship time.

**Design principles.**

**The three-outcome delivery vocabulary is fixed and must not grow.** The gateway (_Delivery outcome (fixed) → `ship_adaptor`_) declares exactly `shipped` / `not-ready:<reason>` / `failed:<reason>`, and `faffidavit-ship`'s Rules state outright that "a producer needing a fourth outcome is misusing the contract; fold it into one of the three." A precondition block must therefore route onto an existing outcome, not a new one — anything else is an edit to a fixed contract that the contract itself forbids. (The ticket leans toward a fourth outcome; this spec closes the other way and justifies it in DESIGN DECISION RATIONALE.)

**A precondition block is a deferral, not a defect.** Nothing merged, the diff is fine, and the remedy is almost always a one-time environment/permissions change a human makes out-of-band. That is the exact shape of `not-ready:<reason>` (gateway: "deploy-readiness deferred the merge without merging. Not an error: the PR stays open and mergeable; graft parks it retry-later"). It is **not** `failed` (no error, no conflict) and **not** `needs-human` review judgement (the diff was never the problem).

**Don't waste a build, but don't trust a stale check either.** A precondition can be checked cheaply before any build runs, *and* can change during a long build (a token rotated, a policy toggled). The design therefore checks at both ends rather than picking one.

**Do not touch the integrity floor.** FAFF-3 owns condition #2 of the floor (CI-green / no-ci-coverage) and the gateway floor wording at ~745. This spec adds a *pre-delivery precondition tier* that is distinct from the floor and from deploy-readiness; it must not re-word, re-open, or weaken the floor.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `skills/faff/SKILL.md` (~737–749) | Markdown prose contract | Fixed delivery-outcome contract; gains the precondition-tier description (FAFF-4's surface, distinct from the floor at ~745 that FAFF-3 owns). |
| `skills/faffter-noon-ship/SKILL.md` | Markdown prose contract | Default `ship` producer; gains the pre-flight precondition check as a producer step + the three concrete cases. |
| `skills/faffidavit-ship/SKILL.md` | Markdown prose contract | Default `ship_adaptor`; gains the precondition→`not-ready` mapping rule and the `not-ready:precondition:<kind>` reason convention. |
| `skills/faff-graft/SKILL.md` (Step 10/11, Autonomous ~291–304) | Markdown prose contract | Routing site; gains the pre-build pre-flight call and the retry-later park wording for a precondition `not-ready`. |
| `skills/faff/SKILL.md` Park/Unpark protocol (~597–617) | Markdown prose contract | Already supports the retry-later park + unpark-on-re-invoke this maps onto; no new park category. |

**Scope statement.** This sits between graft's merge-confidence gate (Step 10) and the `ship` producer/adaptor — a new *precondition tier* below deploy-readiness and above raw `gh`, threaded through one new pre-build check and the existing outcome mapping.

## 2. OUT OF SCOPE

- **The integrity-floor CI-green / no-ci-coverage wording (FAFF-3).** What's excluded: any edit to gateway ~745's floor description or graft Step 10 condition #2. Why excluded: FAFF-3 owns that surface; both tickets touch Step 10, so the build must serialise after FAFF-3 or rebase onto it. Extension point: FAFF-3 edits the floor bullet; FAFF-4 edits the *outcome vocabulary* block (~737–749) and adds the precondition tier paragraph — keep the two edits in non-overlapping paragraphs.

- **A fourth `blocked-on-precondition` delivery outcome.** What's excluded: adding a token to the fixed three-outcome enum or the `faff contract delivery-outcome` script's accepted set. Why excluded: the contract is fixed and `faffidavit-ship` forbids a fourth; preconditions map onto `not-ready` (see RATIONALE). Extension point: if a future need proves `not-ready` genuinely cannot carry it, the change is a gateway edit to the enum + the contract script + `faffidavit-ship`'s envelope — a deliberate fixed-contract amendment, not this ticket.

- **Auto-remediating the precondition** (e.g. faff re-scoping its own OAuth token, flipping org settings, enabling rebase-merge on the repo). What's excluded: any write to GitHub settings or token scopes. Why excluded: these are operator/admin actions outside the agent's lane and often require human auth; faff surfaces the remedy, it does not perform it. Extension point: a future deploy-capable `ship` producer could attempt safe, reversible remediations behind a `.faffrc` opt-in.

- **A `.faffrc` merge-method knob.** What's excluded: making the merge method configurable. Why excluded: `faffter-noon-ship` already notes this as a possible future knob; FAFF-4 only needs to *detect* that the chosen method is disabled, not to make it configurable. Extension point: `faffter-noon-ship` _Rules_ ("if a `.faffrc` merge-method knob is later added").

- **The contract script (`faff contract delivery-outcome`) changes.** What's excluded: node CLI edits. Why excluded: a precondition block is a well-formed `not-ready` the script already accepts; no new token means no script change. Extension point: the script's enum, only if a fourth outcome is ever adopted.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Delivery precondition | A mechanical requirement of the delivery environment (not the code/spec) that must hold for push/PR/merge to succeed: remote-push permission, token scopes the diff needs, the chosen merge method being enabled, repo/org Actions policy permitting what the change relies on. |
| Pre-flight | The cheap, read-only check of delivery preconditions, run *before* the build so a guaranteed-to-fail delivery doesn't waste a build. |
| Precondition block | A delivery precondition that does not hold. Routes to `not-ready:precondition:<kind>` and a retry-later park. |
| Ship-time backstop | The same precondition surfaced at delivery time (re-check + the producer's native push/PR/merge failure), mapped to the same `not-ready:precondition:<kind>` — catches preconditions that changed during a long build or that the pre-flight could not see. |

**Precondition kinds (closed set for the reason string).** The reason carries one of these `<kind>` tokens so `/faff-wtf` and the unpark path can act on it:

```
ENUM PreconditionKind:
  push            # cannot push to the remote (branch protection, no write access)
  token-scope     # OAuth/PAT lacks a scope the diff needs (e.g. `workflow` for .github/workflows/*)
  merge-method    # the intended merge method (squash/rebase/merge) is disabled on the repo
  actions-policy  # repo/org policy disallows what the change relies on (e.g. Actions-created PRs)
```

**The precondition-check result (producer-internal shape).** The pre-flight and the ship-time backstop both yield this; the producer folds a non-`ok` result into its native delivery result so `ship_adaptor` maps it.

```
RECORD PreconditionResult:
  ok: Bool                         # all checked preconditions hold
  kind: PreconditionKind?          # set iff ok = false; the first blocking kind
  detail: String?                  # specific, human-actionable cause
  remedy: String?                  # the one-time setup that unblocks (the operator's next action)
  diff_triggered: Bool             # true if `kind` was selected because the diff requires it
                                   #   (e.g. token-scope only matters because .github/workflows/* changed)

  CONSTRAINT ok = false  IMPLIES  kind != null AND detail != null AND remedy != null
```

**The reason convention (this maps onto the fixed `not-ready:<reason>`).** A precondition block is a `not-ready` whose reason is namespaced so it is distinguishable from a deploy-readiness deferral without adding an outcome:

```
not-ready:precondition:<kind> — <detail>; remedy: <remedy>
```

Examples:
- `not-ready:precondition:token-scope — pushing .github/workflows/ci.yml rejected: token lacks `workflow` scope; remedy: re-authorise gh with `gh auth refresh -s workflow``
- `not-ready:precondition:actions-policy — release workflow cannot open its PR: org disallows Actions-created PRs; remedy: enable "Allow GitHub Actions to create and approve pull requests" in org settings`
- `not-ready:precondition:merge-method — `gh pr merge --rebase` rejected: rebase merges disabled on the repo; remedy: enable rebase merging in repo settings, or set the ship producer to --squash`

**Design decision — outcome mapping.** A precondition block has no merged result, no error/conflict, and a one-time human remedy — the `not-ready:<reason>` semantics exactly (deferred without merging; PR stays open and mergeable; park retry-later). Routing it to `failed` would mis-signal a defect and (autonomously) burn a fix attempt; minting a fourth outcome edits a contract the contract itself declares closed.
**Chosen:** map every precondition block onto `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`. Do **not** add a fourth delivery outcome.

**Design decision — where the pre-flight runs.** Weighing "don't waste a build" (argues before-build) against "preconditions can change during a long build" (argues at-ship-time): a single check at either end is insufficient — pre-build alone misses mid-build drift; ship-time alone wastes the whole build on a guaranteed-fail delivery.
**Chosen:** run the precondition check at **both** ends — a cheap read-only pre-flight before the build (graft, before Step 7), and the same check re-run at ship time as a backstop (the producer, immediately before push/PR/merge), with the producer's native push/PR/merge failure also mapping to the same `not-ready:precondition:<kind>`.

## 4. HOW — Behavior

**Architecture and approach.** Three insertion points, all prose-contract edits:

1. **graft, before the build (new pre-flight).** In Autonomous Mode flow (and as a documented interactive courtesy), before Step 7, run the delivery pre-flight. On a block, do **not** build: route straight to the retry-later park with the precondition reason. This is the "don't waste a build" guard.
2. **`faffter-noon-ship`, at delivery (new producer step + backstop).** Before `gh pr merge`, re-run the precondition check for the merge method and push/PR scopes the diff needs; and treat a native push/PR/merge rejection as a precondition signal. Emit a native result that carries the `precondition:<kind>` reason.
3. **`faffidavit-ship`, mapping.** Add the rule: a producer result signalling a precondition block maps to `not-ready:precondition:<kind> — …`. It stays a `not-ready` envelope; the existing coercion (unmappable → `failed`) is untouched.

graft then routes the `not-ready` exactly as it already does for deploy-readiness deferrals — park retry-later — with the reason naming the specific blocker + remedy.

**Behavior summary — pre-flight.** Cheaply answer "would delivery be mechanically blocked?" using read-only `gh`/git probes scoped to what *this diff* needs, so a guaranteed-fail delivery never consumes a build.

```
PROCEDURE delivery_preflight(diff, intended_merge_method) -> PreconditionResult:
  1. push: can we push to the remote for this branch?
     - probe: `git push --dry-run` (or `gh` equivalent) against the feature branch's remote.
     - on rejection → return { ok:false, kind:push, detail, remedy }
  2. token-scope (diff_triggered): does the diff touch paths needing extra scopes?
     - IF diff changes `.github/workflows/*` AND the token lacks `workflow` scope
       (probe: `gh auth status` scope list) → return { ok:false, kind:token-scope, diff_triggered:true, detail, remedy }
     - generalise: any path→scope rule the producer knows; default rule set covers `workflow`.
  3. merge-method: is `intended_merge_method` enabled on the repo?
     - probe repo settings (`gh api repos/{owner}/{repo}` merge-method flags).
     - IF disabled → return { ok:false, kind:merge-method, detail, remedy }
  4. actions-policy (diff_triggered): does the change rely on Actions doing something policy forbids?
     - IF the change introduces/relies on an Actions-created PR AND org/repo policy disallows it
       → return { ok:false, kind:actions-policy, diff_triggered:true, detail, remedy }
  5. return { ok:true }
```

**Behavior summary — graft pre-flight wiring (autonomous).** Insert before Step 7 so a blocked delivery never starts a build.

```
PROCEDURE autonomous_flow(issue):
  ... eligibility backstop ...
  pre = delivery_preflight(planned_diff_hint, configured_merge_method)
  IF NOT pre.ok:
    # planned_diff_hint: the spec's declared touched-surface where known;
    # checks that don't need the diff (push, merge-method) always run; diff-triggered
    # checks (token-scope, actions-policy) run when the spec declares the surface, else defer to ship-time.
    1. Park retry-later with cause "not-ready:precondition:<pre.kind> — <pre.detail>; remedy: <pre.remedy>"
       (Park protocol: commit nothing built, ensure `faff-parked` label, post the cause+remedy comment).
    2. Return `pr-open-for-human` (no PR yet → return the precondition park; ledger bucket `parked`).
  ... proceed to Step 7 build ...
```

**Behavior summary — ship-time backstop.** The producer re-checks just before acting and maps a native rejection.

```
PROCEDURE deliver(pr, intended_merge_method):
  1. recheck = delivery_preflight_at_ship(diff_of(pr), intended_merge_method)   # the now-knowable real diff
     IF NOT recheck.ok:
        emit native result -> not-ready:precondition:<recheck.kind> — <detail>; remedy: <remedy>
        RETURN
  2. attempt push / PR / `gh pr merge --<method>`
  3. IF the attempt is rejected on a mechanical precondition (parse the gh/git error):
        map error -> kind; emit -> not-ready:precondition:<kind> — <detail>; remedy: <remedy>
  4. IF merge conflict / deploy error / unconfirmable -> failed:<reason>   # unchanged
  5. IF merged -> shipped                                                  # unchanged
```

**graft Step 10 routing (the existing `not-ready` branch, reason-aware).** No new branch is added; the existing `not-ready:<reason>` branch already parks retry-later. The only change is that the reason is now `precondition:<kind>` and the park comment surfaces the remedy.

```
PROCEDURE step10_route(outcome):
  CASE outcome OF
    shipped            -> unblock chained issues; worktree eligible for cleanup
    not-ready:<reason> -> leave PR open + mergeable; park retry-later; record <reason>
                          # <reason> may be precondition:<kind> — surface remedy in the park comment
    failed:<reason>    -> post-build failure: one fix attempt if obvious, else park   # unchanged
```

**Edge cases and error handling.**

- **Pre-flight can't determine the diff before build.** push and merge-method checks are diff-independent and always run pre-build; token-scope and actions-policy are `diff_triggered` and only run pre-build when the spec declares the touched surface — otherwise they defer to the ship-time backstop (which sees the real diff). Precedence: a diff-independent block found pre-build parks before any build; diff-triggered blocks are caught at latest by ship-time.
- **Precondition changed during the build (token rotated, policy toggled).** The ship-time recheck + native-rejection mapping is the backstop; a block found only at ship time still maps to `not-ready:precondition:<kind>` and parks retry-later — the build is not wasted-retried, the PR stays open for the operator's one-time fix.
- **Distinguishing environment/permission block from judgement block.** A precondition block is `not-ready:precondition:<kind>` (retry-later: re-invoke graft once the operator applies the remedy — Unpark protocol "Build-level park → re-run /faff-graft"). A judgement block is the review verdict's `needs-human` (effect persists past revert; a human must look at the *change*). They are routed by *origin*: a delivery-mechanism failure is never `needs-human`, and a review judgement is never a precondition. The reason namespace (`precondition:<kind>`) is what keeps them separable in `/faff-wtf` and the run ledger.
- **Probe itself fails (network, gh outage).** An *inability to determine* a precondition is not a confirmed block: do not park as `precondition`. Treat an indeterminate pre-flight as pass-through (proceed to build) — the ship-time attempt is the real gate, and a genuine outage at ship time maps to `failed:<reason>` (errored), matching graft's existing "persistent infra failure → errored" rule. Never coerce an indeterminate probe into a phantom `shipped`.
- **Coercion direction preserved.** A precondition block is an *explicit* `not-ready`, never a `shipped`. The adaptor's existing fail-safe (unmappable → `failed`, never `shipped`) is unchanged; the precondition mapping only adds a *recognised* `not-ready` shape, it does not touch the coercion backstop.

**Anti-pattern:** minting a fourth `blocked-on-precondition` outcome. Why: the gateway fixes three outcomes and `faffidavit-ship` declares a fourth a misuse; `not-ready:<reason>` already means "deferred without merging, retry-later", which is precisely a precondition block — the namespaced reason carries the specificity without growing the enum.

**Anti-pattern:** mapping a precondition block to `failed`. Why: `failed` means conflict/error and (autonomously) earns a fix attempt against a diff that was never wrong; it also mis-signals a defect to `/faff-wtf`. The block is a deferral, not a defect.

**Anti-pattern:** the pre-flight or producer *fixing* the precondition (re-scoping the token, flipping org settings). Why: out of the agent's lane and often needs human auth; faff surfaces the remedy and parks, it does not mutate GitHub/token settings (OUT OF SCOPE).

**Anti-pattern:** editing the integrity-floor CI-green wording. Why: FAFF-3 owns it; the precondition tier is distinct from and below the floor. Confine FAFF-4's gateway edit to the outcome-vocabulary block (~737–749) and a new precondition-tier paragraph, not the floor bullet at ~745.

## 5. DESIGN DECISION RATIONALE

**Should preconditions get a fourth delivery outcome (`blocked-on-precondition`), or map onto an existing one?**
- *Fourth outcome (ticket's lean):* most explicit; a dedicated token reads cleanly. Cons: the three-outcome vocabulary is **fixed in the gateway**, and `faffidavit-ship` _Rules_ states "a producer needing a fourth outcome is misusing the contract; fold it into one of the three." Adding one means editing the gateway enum + the `faff contract delivery-outcome` script + the adaptor envelope — an amendment to a self-declared-closed contract — for a case the existing `not-ready` semantics already cover.
- *Map to `not-ready`:* the gateway defines `not-ready:<reason>` as "deploy-readiness deferred the merge **without merging**. Not an error: the PR stays open and mergeable; graft parks it retry-later" — a one-to-one fit for a precondition block (nothing merged, no defect, one-time human remedy, retry-later). The `<reason>` field carries `precondition:<kind>` so the specificity the ticket wants is preserved and `/faff-wtf` can route on it, without growing the closed enum.
- *Map to `failed`:* rejected — `failed` is conflict/error, burns an autonomous fix attempt, and mis-signals a defect.
**Chosen:** map onto `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`; no fourth outcome. Rationale: the fixed contract forbids a fourth and `not-ready`'s semantics already match exactly; the namespaced reason gives routability without a contract amendment. Temporal anchor: at time of writing the vocabulary is declared fixed at three and `faffidavit-ship` calls a fourth a misuse — revisit only if a precondition block ever needs routing that `not-ready` (retry-later, PR-open) genuinely cannot express.

**Where does the pre-flight run — before build, at ship time, or both?**
- *Before build only:* saves the whole build when a precondition is already broken; blind to mid-build drift and to diff-triggered checks when the diff isn't yet known.
- *Ship time only:* sees the real diff and current state; wastes the entire build on a delivery guaranteed to fail.
- *Both:* pre-build catches diff-independent blocks (push, merge-method) and spec-declared diff-triggered ones before any build cost; ship-time re-check + native-rejection mapping catches drift and diff-triggered blocks the pre-flight couldn't see.
**Chosen:** both — cheap read-only pre-flight before Step 7, plus a ship-time recheck and native-failure mapping in the producer. Rationale: each end covers the other's blind spot at low cost (the pre-flight is read-only probes; the ship-time check is one extra probe before an action that was happening anyway).

**How is environment/permission distinguished from judgement?**
**Chosen:** by *origin and outcome channel*. A delivery-mechanism precondition → `not-ready:precondition:<kind>` (retry-later, unpark by re-invoking graft after the operator's one-time remedy). A change-judgement block → the review verdict's `needs-human` (a human must look at the diff; effect persists past revert). The two never cross: a mechanical block is never `needs-human`; a review judgement is never a precondition. Rationale: reuses two existing, fixed channels (delivery-outcome `not-ready` and review-verdict `needs-human`) rather than inventing a third classification.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The contested call (fourth outcome vs map-to-`not-ready`) is closed above with a defensible **Chosen:** grounded in the fixed-contract constraint; it is not punted.

**Assumptions.**

- **Assumes:** `gh` and `git` are the delivery toolchain and expose read-only probes for scopes (`gh auth status`), repo merge-method flags (`gh api repos/{owner}/{repo}`), and push dry-run (`git push --dry-run`). Validation: the build agent confirms these commands exist in the environment (the default producer already shells `gh pr merge`); if a project's `ship` producer uses a different delivery tool, its own pre-flight maps the same `PreconditionKind` set onto that tool's probes. Park if the default producer cannot probe at all.
- **Assumes:** FAFF-3's Step 10 / gateway-floor edits land first (or this build rebases onto them). Validation: before editing `skills/faff-graft/SKILL.md` Step 10 and gateway ~737–749, check whether FAFF-3 has already modified the floor bullet; confine FAFF-4's edits to the outcome-vocabulary block + a new precondition-tier paragraph and the existing `not-ready` routing branch, leaving the floor wording to FAFF-3. If FAFF-3 is unmerged, serialise after it.
- **Assumes:** the Park/Unpark protocol's retry-later semantics (gateway ~597–617) accept a `precondition:<kind>` reason without a new park *category* (it is a normal build-level park, unparked by re-invoking graft). Validation: confirm the protocol enumerates park *reasons* freely while keeping the three valid park *categories* — a precondition park is a legitimate `not-ready`-driven retry-later, not a forbidden capacity/"deferred" excuse.

## 7. DONE — Definition of Done

### From WHY
- [ ] A delivery precondition that fails no longer falls silently on the operator: it produces a `not-ready:precondition:<kind>` outcome that graft parks with the specific blocker + remedy in the park comment.
- [ ] No edit is made to the integrity-floor CI-green wording (gateway ~745) or graft Step 10 condition #2 — those remain FAFF-3's surface (verify via diff).

### From WHAT (vocabulary & mapping)
- [ ] The four precondition kinds (`push`, `token-scope`, `merge-method`, `actions-policy`) are defined in `faffter-noon-ship` and referenced by `faffidavit-ship`.
- [ ] The reason convention `not-ready:precondition:<kind> — <detail>; remedy: <remedy>` is documented in `faffidavit-ship` as the mapping target for a precondition block.
- [ ] No fourth delivery outcome is added: the gateway enum (~739) still lists exactly `shipped` / `not-ready:<reason>` / `failed:<reason>`, and `faff contract delivery-outcome`'s accepted set is unchanged (verify the script is untouched).

### From HOW (pre-flight)
- [ ] `faffter-noon-ship` documents a pre-flight that probes push permission, diff-triggered token scopes (`workflow` when `.github/workflows/*` changes), the intended merge method's enablement, and Actions policy — read-only, no settings mutation.
- [ ] graft's autonomous flow runs the pre-flight before Step 7 and, on a diff-independent block (push / merge-method), parks retry-later **without** starting a build.

### From HOW (ship-time backstop)
- [ ] `faffter-noon-ship` re-runs the precondition check at ship time and maps a native push/PR/merge rejection onto `not-ready:precondition:<kind>` (the three concrete FAFF-1 cases each map: token-scope, actions-policy, merge-method).
- [ ] `faffidavit-ship` maps a producer's precondition signal to a `not-ready:precondition:<kind>` envelope, leaving the unmappable→`failed` coercion unchanged.

### From HOW (routing & park)
- [ ] graft Step 10's existing `not-ready:<reason>` branch surfaces a `precondition:<kind>` reason's remedy in the retry-later park comment; no new routing branch is added.
- [ ] A precondition park is unparked by re-invoking `/faff-graft` after the operator applies the remedy (Unpark protocol, build-level), with the `faff-parked` label cleared on re-entry.

### From HOW (edge cases)
- [ ] An indeterminate probe (network/gh outage) does **not** park as `precondition`: graft proceeds to build/ship, and a genuine ship-time outage maps to `failed`/errored, never a phantom `shipped`.
- [ ] An environment/permission block routes to `not-ready:precondition:<kind>` and a change-judgement block routes to review `needs-human`; the two channels never cross (documented in `faffidavit-ship` + graft).

**Integration smoke test.**

```
GIVEN an autonomous graft run on an issue whose diff touches .github/workflows/ci.yml
  AND the active token lacks the `workflow` scope
WHEN delivery_preflight runs before Step 7
THEN it returns { ok:false, kind:token-scope, detail:"…workflow scope…", remedy:"gh auth refresh -s workflow" }
  AND graft parks the issue retry-later WITHOUT building
  AND the park comment reads "not-ready:precondition:token-scope — … ; remedy: gh auth refresh -s workflow"
  AND the run ledger records the issue as `parked` (not `failed`, not `shipped`)
  AND re-invoking /faff-graft after the scope is granted clears `faff-parked` and proceeds to build.
```

confidence: high

