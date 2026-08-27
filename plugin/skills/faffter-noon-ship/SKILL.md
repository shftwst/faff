---
name: faffter-noon-ship
description: "Default `ship` producer — merges a gate-cleared PR through the faff merge-gate interlock (never a raw gh merge), no-op deploy-readiness, emits a native delivery result + a faff-contract:delivery-outcome block faff-graft consumes. Swap for a deploy-capable producer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: none
---

# faffter-noon-ship

The default **producer** for the `ship` slot. Delivers a PR that `/faff-graft` has already cleared through the **integrity floor** (AC-verified + CI-green + review `pass`): runs a deploy-readiness check, merges, and cleans up what it created — then emits a native delivery result **plus a `faff-contract:delivery-outcome` block** that faff-graft Step 10 parses (via `faff contract delivery-outcome`) onto the fixed outcome vocabulary graft routes on (canonical semantics: `faff contract delivery-outcome --describe`). The safe, zero-config default — a no-op readiness check and a merge through the `faff merge-gate` interlock (never a raw `gh pr merge`), no deploy step. Swap to a deploy-capable producer (e.g. `gstack:land-and-deploy`) when delivery means more than a merge.

```yaml
slots:
  ship: faffter-noon-ship          # the default producer — explicit for clarity
```

## When it runs

Invoked by `/faff-graft`'s **Step 10** (the merge-confidence gate) once the integrity floor has passed — in interactive mode after the user confirms "merge now", in autonomous mode automatically on green. It is **not** a user-invokable slash command. It is a **producer**: it *performs* delivery, emits a native result, and self-declares it in a `faff-contract:delivery-outcome` block; faff-graft (the consumer) parses that block onto the fixed outcome vocabulary (the `ship_adaptor` slot was retired).

## The contract

The delivery-outcome contract is **fixed in the gateway** — see the sibling `faff/SKILL.md` → **Core contracts and adaptor slots** → _Delivery outcome (fixed)_. It is the authoritative definition for **every** `ship` producer (this default and any deploy-capable third party): the closed outcome vocabulary (canonical semantics: `faff contract delivery-outcome --describe`), the two-tier gate (non-delegable integrity floor + the producer's own deploy-readiness tier), and the coercion rule (a result the `faff contract delivery-outcome` script can't map normalises to `failed`, never `shipped`). This skill **refers back** to that contract; the recap here is non-normative and the gateway wins on any conflict.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-graft` reads the gateway on entry), so when you run as the `ship` slot it is already in context. If invoked standalone, **Read the sibling `faff/SKILL.md` → _Delivery outcome (fixed)_ now** before delivering.

## How the default runs it

The default delivers by merging, nothing more:

1. **Delivery-precondition check (ship-time backstop).** Immediately before merging, re-run a cheap, **read-only** probe of the mechanical preconditions the merge needs (graft runs the same probe pre-build; this is the backstop for a precondition that changed during the build, or that the pre-flight couldn't see without the real diff):
   - **push** — can we push to the remote for this branch? (`git push --dry-run`)
   - **token-scope** — if the diff touches `.github/workflows/*`, does the token carry the `workflow` scope? (`gh auth status`)
   - **merge-method** — is the intended merge method (squash) enabled on the repo? (`gh api repos/{owner}/{repo}` merge flags)
   - **actions-policy** — does the change rely on something org/repo Actions policy forbids (e.g. an Actions-created PR)?

   On a block, emit `not-ready:precondition:<kind> — <detail>; remedy: <remedy>` (the `<kind>` is the failing probe) and stop — **do not** attempt the merge. This is the **only** way the default emits the deferral outcome: its *deploy-readiness* tier is still a no-op pass (it has no deploy environment), but a mechanical **precondition** block is a legitimate deferral the default surfaces so the operator gets the specific blocker + one-time remedy instead of a silent failure.

   An *indeterminate* probe (network/`gh` outage) is **not** a confirmed block — proceed to the merge attempt instead; a genuine outage there maps to the failure outcome, never a phantom success.

   **Git-only mode (no pushable remote, the same detection graft's Step 10 already made):** every probe in this step is remote/token/forge-shaped, so all four are **no-ops** — there is no remote to be not-ready against. The default never emits `not-ready:precondition:*` in this mode; proceed straight to step 2.
2. **Readiness (no-op pass).** The default has no deploy environment to gate on, so its deploy-readiness tier always passes. (This is the tier that exists *for* producers with real deploy preconditions: deploy window, env health, migration ordering, flag state — distinct from the mechanical delivery preconditions in step 1.)
3. **Merge — through `faff merge-gate`, never a raw `gh pr merge`.** The **sole sanctioned merge path** is the mechanical interlock: `faff merge-gate --pr <n> --issue <ID> --run-dir <dir> --level <level> --execute --merge-args "--squash --delete-branch"` (graft passes `pr`/`issue`/`run-dir`/`level`, one of the four autonomy levels). merge-gate re-verifies the integrity floor from the persisted artifacts + observes CI itself on the PR head sha, and runs `gh pr merge` **only** on `merge-ok` — so the default producer no longer calls `gh pr merge` directly. Squash keeps one-PR-per-issue history linear; `--delete-branch` removes the *remote* branch only. A different merge method is a `--merge-args` swap within the closed allowlist (`--merge`/`--rebase`/…). exit 0 = `merge-ok` (merged), 1 = `refuse` (floor not met at merge time — e.g. CI went red, stale head sha), 2 = fail-loud.

   **Git-only mode:** invoke `faff merge-gate --local --issue <ID> --run-dir <dir> --level <level> --execute` **instead of `--pr <n>`** — there is no PR to reference. `merge-gate --local` re-verifies the identical AC/review floor legs, runs its own fresh `faff gates run` as the CI-equivalent, and lands the merge as a local base-ref move (never a raw `git merge`/`push`/`update-ref` — those are mechanically fenced on a no-remote repo by `merge-fence`'s `matchesRawLocalBaseMerge`). Exit codes are identical (0 `merge-ok` / 1 `refuse` / 2 fail-loud); `--merge-args` has no effect in this mode (there is no `gh pr merge` to flag) and may be omitted.

   **Custody-flag pass-through.** When graft's _Interactive custody stamp sub-step_ produced a per-issue custody verdict (the L4 `--local` top-level path), it passes `--custody-verdict <path>` and `--custody-verdict-sha256 <sha>` down to this producer. **Forward BOTH unchanged** whenever the caller passed them, and omit them when it did not — the producer never mints, re-hashes, or inspects the verdict, it only relays the two flags to the interlock (which admits the verdict through `computeCustodyVerdictAdmission`). **Two callers supply these flags:** graft's L4 `--local` _Interactive custody stamp sub-step_ (the self-consistency stamp, on the `merge-gate --local` invocation), and the **dispatched-lane merge locus** (the `concurrency` dispatcher at gateway obligation 7), which produces a *detective*-custody verdict over the untrusted build lane and threads the same two flags onto the **`--pr`** invocation. Forward them on whichever of `--pr`/`--local` was invoked; the relay is byte-identical either way and never distinguishes the two bases (that distinction is the caller's, honoured by never routing either verdict through `FAFF_INTEGRITY_BOUNDARY`). A top-level `--pr` merge with no dispatch cut passes no custody flags, exactly as before.
4. **Cleanup (deploy-side only).** The default created no release artefacts or temp deploy state, so there is nothing of its own to clean. It **never** touches the worktree — worktree teardown pairs with graft's setup and is graft's job (under the parallel executor it's coordinated there). See gateway → **Worktree policy**.
5. **Emit the native result + the contract block.** The default's native result is the **`faff merge-gate` exit + its printed verdict**, which it self-declares in its `faff-contract:delivery-outcome` block (canonical semantics: `faff contract delivery-outcome --describe`).
   - `merge-ok` (exit 0, `merged`) → the success outcome, `corroborated: true`.
   - a `refuse` (exit 1) or fail-loud (exit 2) → the failure outcome carrying merge-gate's blocker line as the reason.
   - When that refuse is a `gh pr merge` rejection on a **mechanical precondition** (push denied, scope missing, merge method disabled, policy block — surfaced in merge-gate's blocker), declare the deferral outcome instead — `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`, matching the step-1 backstop, never the bare failure outcome.

   faff-graft parses the block via `faff contract delivery-outcome`.

On a merge conflict or any `gh` failure, the producer declares `failed:<reason>` (e.g. `failed:merge conflict on main`) — never swallow it. Graft treats that as a post-build failure (one fix attempt if obvious, else park). The default only signals success when the merge actually succeeded: if `gh` exits non-zero, times out, or its result can't be confirmed, that is a failure signal, not a success one (declare `corroborated: false`) — and the `faff contract delivery-outcome` coercion rule (malformed or uncorroborated `shipped` → `failed`, never `shipped`) is the backstop, though the default never relies on it.

## Contract artifact

After emitting the native result (step 5), append **one** fenced code block — tagged `faff-contract:delivery-outcome`, as the **last** thing in the output — declaring the delivery outcome you just produced, so faff-graft (the consumer) parses it **deterministically** (no LLM re-read of the `gh`/deploy result) via `faff contract delivery-outcome`. You ran the merge and read its exit, so you declare the outcome directly; the block mirrors the native result, it is not a second source of truth. (Same pattern the `spec` producer adopted for `faff-contract:spec-readiness`.)

````
```faff-contract:delivery-outcome
{ "outcome": "<your result — faff contract delivery-outcome --describe>",
  "reason": "<short cause; empty for shipped>",
  "corroborated": <bool> }
```
````

- `outcome` — your real delivery result; `reason` — a short, specific cause (empty for `shipped`; the `not-ready:precondition:<kind>` reason convention still applies).
- **Honesty rule — `corroborated: true` ONLY when the native result actually confirms the merge/deploy succeeded.** A clean `gh pr merge` exit you observed is corroboration; an unconfirmable / timed-out / unread result is **not** — set `corroborated: false`, never a phantom `true`.
- **The script's fail-safe stands:** an `outcome: shipped` with `corroborated: false` still coerces → `failed` (CLI fixture `uncorroborated-shipped-coerced`). So honest self-declaration **cannot weaken** the corroboration guard — declaring `false` when unsure is always safe.
- Do **not** include `provenance_present` — that field is spec-specific; the delivery-outcome extraction is just `{ outcome, reason, corroborated }`.
- **One** block, at the very end, machine-only. **Always emit it** — a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-graft reading your native result — the absent-block fallback.)

## Rules

- **The integrity floor is not ours.** AC-verified + CI-green + review `pass` is asserted by graft *before* this skill is invoked and is non-delegable. This producer may never bypass, re-open, or weaken it. We add a readiness tier on top; we never subtract the floor's "no".
- **This is the minimum producer.** A richer producer runs a real readiness check (and may produce a `not-ready` signal), deploys after merge, and cleans up its own deploy artefacts — but must still honour the fixed contract and the non-delegable floor, and emit its `faff-contract:delivery-outcome` block (or be wrapped by an adaptor that emits it) so the consumer can parse it.
- **Merge method is the one real choice.** The default is squash + delete-branch. A project that wants merge-commit or rebase history, or to keep branches, overrides the slot (or, if a `.faffrc` merge-method knob is later added, sets that). The default does not guess per-PR.
- **No deploy.** The default merges and stops. "Shipped" here means "merged to the default branch", not "released". Deployment is what a deploy-capable producer adds.
- **Detect preconditions, never remediate them.** The precondition check (step 1) is **read-only** — it probes `git`/`gh` and reports. It must **never** mutate GitHub/token settings (re-scope a token, flip an org/repo setting, enable a merge method): those are operator/admin actions outside this lane and often need human auth. The producer surfaces the `remedy:` string and emits `not-ready:precondition:<kind>`; the operator applies the one-time fix and re-invokes graft. A swapped-in deploy-capable producer maps the same four `<kind>` tokens onto its own delivery toolchain's probes.
- **Stay in the producer lane.** This skill performs delivery and emits a result + its contract block; it does not own the outcome *vocabulary* (that's the fixed contract), the *parsing* of its block onto that vocabulary (that's the consumer via `faff contract delivery-outcome`), or the *routing* on the outcome (that's `/faff-graft`).
