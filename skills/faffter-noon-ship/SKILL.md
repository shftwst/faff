---
name: faffter-noon-ship
description: "Default `ship` producer — merges a gate-cleared PR (gh pr merge --squash), no-op deploy-readiness, emits a native delivery result the ship_adaptor maps. Swap for a deploy-capable producer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-noon-ship

The default **producer** for the `ship` slot. Delivers a PR that `/faff-graft` has already cleared through the **integrity floor** (AC-verified + CI-green + review `pass`): runs a deploy-readiness check, merges, and cleans up what it created — then emits a native delivery result that `ship_adaptor` (default `faffidavit-ship`) maps onto the fixed `shipped` / `not-ready` / `failed` outcome graft routes on. The safe, zero-config default — a no-op readiness check and a vanilla `gh pr merge`, no deploy step. Swap to a deploy-capable producer (e.g. `gstack:land-and-deploy`) when delivery means more than a merge.

```yaml
slots:
  ship: faffter-noon-ship          # the default producer — explicit for clarity
  ship_adaptor: faffidavit-ship    # its paired adaptor — maps this producer's result onto the three outcomes
```

## When it runs

Invoked by `/faff-graft`'s **Step 10** (the merge-confidence gate) once the integrity floor has passed — in interactive mode after the user confirms "merge now", in autonomous mode automatically on green. It is **not** a user-invokable slash command. It is a **producer**: it *performs* delivery and emits a native result; its paired `ship_adaptor` translates that result onto the fixed outcome vocabulary.

## The contract

The delivery-outcome contract is **fixed in the gateway** — see the sibling `faff/SKILL.md` → **Core contracts and adaptor slots** → _Delivery outcome (fixed) → `ship_adaptor`_. It is the authoritative definition for **every** `ship` producer (this default and any deploy-capable third party): the three outcomes (`shipped` / `not-ready:<reason>` / `failed:<reason>`), the two-tier gate (non-delegable integrity floor + the producer's own deploy-readiness tier), and the coercion rule (a result the adaptor can't map normalises to `failed`, never `shipped`). This skill **refers back** to that contract; the recap here is non-normative and the gateway wins on any conflict.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-graft` reads the gateway on entry), so when you run as the `ship` slot it is already in context. If invoked standalone, **Read the sibling `faff/SKILL.md` → _Delivery outcome (fixed) → `ship_adaptor`_ now** before delivering.

## How the default runs it

The default delivers by merging, nothing more:

1. **Delivery-precondition check (ship-time backstop).** Immediately before merging, re-run a cheap, **read-only** probe of the mechanical preconditions the merge needs (graft runs the same probe pre-build; this is the backstop for a precondition that changed during the build, or that the pre-flight couldn't see without the real diff):
   - **push** — can we push to the remote for this branch? (`git push --dry-run`)
   - **token-scope** — if the diff touches `.github/workflows/*`, does the token carry the `workflow` scope? (`gh auth status`)
   - **merge-method** — is the intended merge method (squash) enabled on the repo? (`gh api repos/{owner}/{repo}` merge flags)
   - **actions-policy** — does the change rely on something org/repo Actions policy forbids (e.g. an Actions-created PR)?

   On a block, emit `not-ready:precondition:<kind> — <detail>; remedy: <remedy>` (the `<kind>` is the failing probe) and stop — **do not** attempt the merge. This is the **only** way the default emits `not-ready`: its *deploy-readiness* tier is still a no-op pass (it has no deploy environment), but a mechanical **precondition** block is a legitimate `not-ready` the default surfaces so the operator gets the specific blocker + one-time remedy instead of a silent failure. An *indeterminate* probe (network/`gh` outage) is **not** a confirmed block — proceed to the merge attempt; a genuine outage there maps to `failed`, never a phantom `shipped`.
2. **Readiness (no-op pass).** The default has no deploy environment to gate on, so its deploy-readiness tier always passes. (This is the tier that exists *for* producers with real deploy preconditions: deploy window, env health, migration ordering, flag state — distinct from the mechanical delivery preconditions in step 1.)
3. **Merge.** `gh pr merge --squash --delete-branch` on the cleared PR. Squash keeps one-PR-per-issue history linear; `--delete-branch` removes the *remote* branch only. If the project prefers merge-commit or rebase history, that's a swap/config decision — see _Rules_.
4. **Cleanup (deploy-side only).** The default created no release artefacts or temp deploy state, so there is nothing of its own to clean. It **never** touches the worktree — worktree teardown pairs with graft's setup and is graft's job (under the parallel executor it's coordinated there). See gateway → **Worktree policy**.
5. **Emit the native result.** The default's native result is the `gh pr merge` exit status: a clean exit is the merge-succeeded signal `faffidavit-ship` maps to `shipped`; a merge conflict / generic non-zero exit it maps to `failed:<reason>`. A `gh pr merge` rejection on a **mechanical precondition** (push denied, scope missing, merge method disabled, policy block) is parsed and emitted as `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`, matching the step-1 backstop, rather than a bare `failed`.

On a merge conflict or any `gh` failure, the native result carries the error so `faffidavit-ship` maps it to `failed:<reason>` (e.g. `failed:merge conflict on main`) — never swallow it. Graft treats that as a post-build failure (one fix attempt if obvious, else park). The default only signals success when the merge actually succeeded: if `gh` exits non-zero, times out, or its result can't be confirmed, that is a failure signal, not a success one — and the adaptor's coercion rule (malformed → `failed`, never `shipped`) is the backstop, though the default never relies on it.

## Rules

- **The integrity floor is not ours.** AC-verified + CI-green + review `pass` is asserted by graft *before* this skill is invoked and is non-delegable. This producer may never bypass, re-open, or weaken it. We add a readiness tier on top; we never subtract the floor's "no".
- **This is the minimum producer.** A richer producer runs a real readiness check (and may produce a `not-ready` signal), deploys after merge, and cleans up its own deploy artefacts — but must still honour the fixed contract and the non-delegable floor, and emit a result `ship_adaptor` can map.
- **Merge method is the one real choice.** The default is squash + delete-branch. A project that wants merge-commit or rebase history, or to keep branches, overrides the slot (or, if a `.faffrc` merge-method knob is later added, sets that). The default does not guess per-PR.
- **No deploy.** The default merges and stops. "Shipped" here means "merged to the default branch", not "released". Deployment is what a deploy-capable producer adds.
- **Detect preconditions, never remediate them.** The precondition check (step 1) is **read-only** — it probes `git`/`gh` and reports. It must **never** mutate GitHub/token settings (re-scope a token, flip an org/repo setting, enable a merge method): those are operator/admin actions outside this lane and often need human auth. The producer surfaces the `remedy:` string and emits `not-ready:precondition:<kind>`; the operator applies the one-time fix and re-invokes graft. A swapped-in deploy-capable producer maps the same four `<kind>` tokens onto its own delivery toolchain's probes.
- **Stay in the producer lane.** This skill performs delivery and emits a result; it does not own the outcome *vocabulary* (that's the fixed contract), the *translation* of its result onto that vocabulary (that's `ship_adaptor`), or the *routing* on the outcome (that's `/faff-graft`).
