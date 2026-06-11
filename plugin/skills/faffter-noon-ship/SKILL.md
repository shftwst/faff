---
name: faffter-noon-ship
description: "Default `ship` producer — merges a gate-cleared PR (gh pr merge --squash), no-op deploy-readiness, emits a native delivery result + a faff-contract:delivery-outcome block faff-graft consumes. Swap for a deploy-capable producer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-noon-ship

The default **producer** for the `ship` slot. Delivers a PR that `/faff-graft` has already cleared through the **integrity floor** (AC-verified + CI-green + review `pass`): runs a deploy-readiness check, merges, and cleans up what it created — then emits a native delivery result **plus a `faff-contract:delivery-outcome` block** that faff-graft Step 10 parses (via `faff contract delivery-outcome`) onto the fixed `shipped` / `not-ready` / `failed` outcome graft routes on. The safe, zero-config default — a no-op readiness check and a vanilla `gh pr merge`, no deploy step. Swap to a deploy-capable producer (e.g. `gstack:land-and-deploy`) when delivery means more than a merge.

```yaml
slots:
  ship: faffter-noon-ship          # the default producer — explicit for clarity
```

## When it runs

Invoked by `/faff-graft`'s **Step 10** (the merge-confidence gate) once the integrity floor has passed — in interactive mode after the user confirms "merge now", in autonomous mode automatically on green. It is **not** a user-invokable slash command. It is a **producer**: it *performs* delivery, emits a native result, and self-declares it in a `faff-contract:delivery-outcome` block; faff-graft (the consumer) parses that block onto the fixed outcome vocabulary (FAFF-109 retired the `ship_adaptor` slot).

## The contract

The delivery-outcome contract is **fixed in the gateway** — see the sibling `faff/SKILL.md` → **Core contracts and adaptor slots** → _Delivery outcome (fixed)_. It is the authoritative definition for **every** `ship` producer (this default and any deploy-capable third party): the three outcomes (`shipped` / `not-ready:<reason>` / `failed:<reason>`), the two-tier gate (non-delegable integrity floor + the producer's own deploy-readiness tier), and the coercion rule (a result the `faff contract delivery-outcome` script can't map normalises to `failed`, never `shipped`). This skill **refers back** to that contract; the recap here is non-normative and the gateway wins on any conflict.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-graft` reads the gateway on entry), so when you run as the `ship` slot it is already in context. If invoked standalone, **Read the sibling `faff/SKILL.md` → _Delivery outcome (fixed)_ now** before delivering.

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
5. **Emit the native result + the contract block.** The default's native result is the `gh pr merge` exit status, which it self-declares in its `faff-contract:delivery-outcome` block: a clean exit → `outcome: shipped, corroborated: true`; a merge conflict / generic non-zero exit → `failed:<reason>`. A `gh pr merge` rejection on a **mechanical precondition** (push denied, scope missing, merge method disabled, policy block) is declared as `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`, matching the step-1 backstop, rather than a bare `failed`. faff-graft parses the block via `faff contract delivery-outcome`.

On a merge conflict or any `gh` failure, the producer declares `failed:<reason>` (e.g. `failed:merge conflict on main`) — never swallow it. Graft treats that as a post-build failure (one fix attempt if obvious, else park). The default only signals success when the merge actually succeeded: if `gh` exits non-zero, times out, or its result can't be confirmed, that is a failure signal, not a success one (declare `corroborated: false`) — and the `faff contract delivery-outcome` coercion rule (malformed or uncorroborated `shipped` → `failed`, never `shipped`) is the backstop, though the default never relies on it.

## Contract artifact (FAFF-108)

After emitting the native result (step 5), append **one** fenced code block — tagged `faff-contract:delivery-outcome`, as the **last** thing in the output — declaring the delivery outcome you just produced, so faff-graft (the consumer) parses it **deterministically** (no LLM re-read of the `gh`/deploy result) via `faff contract delivery-outcome`. You ran the merge and read its exit, so you declare the outcome directly; the block mirrors the native result, it is not a second source of truth. (Same pattern the `spec` producer adopted in FAFF-81 for `faff-contract:spec-readiness`.)

````
```faff-contract:delivery-outcome
{ "outcome": "<your result: shipped|not-ready|failed>",
  "reason": "<short cause; empty for shipped>",
  "corroborated": <bool> }
```
````

- `outcome` — your real delivery result; `reason` — a short, specific cause (empty for `shipped`; the `not-ready:precondition:<kind>` reason convention still applies).
- **Honesty rule — `corroborated: true` ONLY when the native result actually confirms the merge/deploy succeeded.** A clean `gh pr merge` exit you observed is corroboration; an unconfirmable / timed-out / unread result is **not** — set `corroborated: false`, never a phantom `true`.
- **The script's fail-safe stands:** an `outcome: shipped` with `corroborated: false` still coerces → `failed` (CLI fixture `uncorroborated-shipped-coerced`). So honest self-declaration **cannot weaken** the corroboration guard — declaring `false` when unsure is always safe.
- Do **not** include `provenance_present` — that field is spec-specific (FAFF-81); the delivery-outcome extraction is just `{ outcome, reason, corroborated }`.
- **One** block, at the very end, machine-only. **Always emit it** — a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-graft reading your native result — the absent-block fallback.)

## Rules

- **The integrity floor is not ours.** AC-verified + CI-green + review `pass` is asserted by graft *before* this skill is invoked and is non-delegable. This producer may never bypass, re-open, or weaken it. We add a readiness tier on top; we never subtract the floor's "no".
- **This is the minimum producer.** A richer producer runs a real readiness check (and may produce a `not-ready` signal), deploys after merge, and cleans up its own deploy artefacts — but must still honour the fixed contract and the non-delegable floor, and emit its `faff-contract:delivery-outcome` block (or be wrapped via FAFF-22) so the consumer can parse it.
- **Merge method is the one real choice.** The default is squash + delete-branch. A project that wants merge-commit or rebase history, or to keep branches, overrides the slot (or, if a `.faffrc` merge-method knob is later added, sets that). The default does not guess per-PR.
- **No deploy.** The default merges and stops. "Shipped" here means "merged to the default branch", not "released". Deployment is what a deploy-capable producer adds.
- **Detect preconditions, never remediate them.** The precondition check (step 1) is **read-only** — it probes `git`/`gh` and reports. It must **never** mutate GitHub/token settings (re-scope a token, flip an org/repo setting, enable a merge method): those are operator/admin actions outside this lane and often need human auth. The producer surfaces the `remedy:` string and emits `not-ready:precondition:<kind>`; the operator applies the one-time fix and re-invokes graft. A swapped-in deploy-capable producer maps the same four `<kind>` tokens onto its own delivery toolchain's probes.
- **Stay in the producer lane.** This skill performs delivery and emits a result + its contract block; it does not own the outcome *vocabulary* (that's the fixed contract), the *parsing* of its block onto that vocabulary (that's the consumer via `faff contract delivery-outcome`), or the *routing* on the outcome (that's `/faff-graft`).
