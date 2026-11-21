---
name: faffter-noon-ship
description: "Default `ship` producer — merges a gate-cleared PR through the faff merge-gate interlock (never a raw gh merge), no-op deploy-readiness, emits a native delivery result + a faff-contract:delivery-outcome block faff-graft consumes. Swap for a deploy-capable producer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: none
---

# faffter-noon-ship

The default **`ship` producer** merges an integrity-floor-cleared PR (AC-verified + CI-green + review `pass`) through `faff merge-gate`, never raw `gh pr merge`. Deploy readiness is a no-op; it cleans only its own artifacts and does not deploy. Emit the native result **plus a `faff-contract:delivery-outcome` block** for graft Step 10 to parse via `faff contract delivery-outcome` and route (canonical semantics: `faff contract delivery-outcome --describe`). Use a deploy-capable producer (e.g. `gstack:land-and-deploy`) for delivery beyond merge.

```yaml
slots:
  ship: faffter-noon-ship          # the default producer — explicit for clarity
```

## When it runs

Invoked by `/faff-graft`'s **Step 10** after the integrity floor passes: interactive after "merge now" confirmation, autonomous automatically on green. It is not a user slash command. It performs delivery and self-declares the native result in `faff-contract:delivery-outcome`; faff-graft parses and routes it. The `ship_adaptor` slot was retired.

## The contract

The gateway's fixed delivery-outcome contract governs **every** `ship` producer: sibling `faff/references/kernel.md` → **Core contracts and adaptor slots** → _Delivery outcome (fixed)_. It owns the closed vocabulary (`faff contract delivery-outcome --describe`), non-delegable integrity floor + producer deploy-readiness tier, and coercion: an unmappable `faff contract delivery-outcome` result normalises to `failed`, never `shipped`. This recap is non-normative; the gateway wins any conflict.

**How this contract reaches you.** Invoking `/faff-graft` reads the gateway on entry, so the fixed definition is already in context. Standalone, **Read sibling `faff/references/kernel.md` (the shared kernel) → _Delivery outcome (fixed)_**, then `faff/references/build.md` (Worktree policy), `faff/references/l4.md` (Mechanism slot) and `faff/references/review.md` (Producer slots vs adaptor slots), before delivering.

## How the default runs it

The default delivers by merging, nothing more:

1. **Delivery-precondition check (ship-time backstop).** Immediately before merge, re-run a cheap **read-only** probe of its mechanical preconditions. Graft probes them pre-build; recheck conditions that changed during the build or needed the real diff:
   - **push** — can we push to the remote for this branch? (`git push --dry-run`)
   - **token-scope** — if the diff touches `.github/workflows/*`, does the token carry the `workflow` scope? (`gh auth status`)
   - **merge-method** — is the intended merge method (squash) enabled on the repo? (`gh api repos/{owner}/{repo}` merge flags)
   - **actions-policy** — does the change rely on something org/repo Actions policy forbids (e.g. an Actions-created PR)?

   On a block, report `not-ready:precondition:<kind> — <detail>; remedy: <remedy>` and append one `faff-contract:delivery-outcome` fence with `{"outcome":"not-ready","reason":"<reported reason>","corroborated":false}`. Stop: **do not attempt the merge**. This is the default's **only** deferral path; its deploy-readiness tier remains a no-op pass with no deploy environment. Surface the specific mechanical blocker and one-time remedy.

   An *indeterminate* probe (network/`gh` outage) is **not** a confirmed block — proceed to the merge attempt instead; a genuine outage there maps to the failure outcome, never a phantom success.

   **Git-only mode (no pushable remote, the same detection graft's Step 10 already made):** every probe in this step is remote/token/forge-shaped, so all four are **no-ops** — there is no remote to be not-ready against. The default never emits `not-ready:precondition:*` in this mode; proceed straight to step 2.
2. **Readiness (no-op pass).** The default has no deploy environment to gate on, so its deploy-readiness tier always passes. (This is the tier that exists *for* producers with real deploy preconditions: deploy window, env health, migration ordering, flag state — distinct from the mechanical delivery preconditions in step 1.)
3. **Merge — through `faff merge-gate`, never a raw `gh pr merge`.** The **sole sanctioned merge path** is the mechanical interlock: `faff merge-gate --pr <n> --issue <ID> --run-dir <dir> --level <level> --execute --merge-args "--squash --delete-branch" --json` (graft passes `pr`/`issue`/`run-dir`/`level`, one of the four autonomy levels). merge-gate re-verifies the integrity floor from the persisted artifacts + observes CI itself on the PR head sha, and runs `gh pr merge` **only** on `merge-ok` — so the default producer no longer calls `gh pr merge` directly. Squash keeps one-PR-per-issue history linear; `--delete-branch` removes the *remote* branch only. A different merge method is a `--merge-args` swap within the closed allowlist (`--merge`/`--rebase`/…). exit 0 = `merge-ok` (merged), 1 = `refuse` (floor not met at merge time — e.g. CI went red, stale head sha), 2 = fail-loud.

   **Git-only mode:** invoke `faff merge-gate --local --issue <ID> --run-dir <dir> --level <level> --execute --json` **instead of `--pr <n>`** — there is no PR to reference. `merge-gate --local` re-verifies the identical AC/review floor legs, runs its own fresh `faff gates run` as the CI-equivalent, and lands the merge as a local base-ref move (never a raw `git merge`/`push`/`update-ref` — those are mechanically fenced on a no-remote repo by `merge-fence`'s `matchesRawLocalBaseMerge`). Exit codes are identical (0 `merge-ok` / 1 `refuse` / 2 fail-loud); `--merge-args` has no effect in this mode (there is no `gh pr merge` to flag) and may be omitted.

   **Custody-flag pass-through.** When graft's _Interactive custody stamp sub-step_ produced a per-issue custody verdict (the L4 top-level path, `--local` **or** `--pr` — production is mode-agnostic), it passes `--custody-verdict <path>` and `--custody-verdict-sha256 <sha>` down to this producer. **Forward BOTH unchanged** whenever the caller passed them, and omit them when it did not — the producer never mints, re-hashes, or inspects the verdict, it only relays the two flags to the interlock (which admits the verdict through `computeCustodyVerdictAdmission`) **on whichever of `--pr`/`--local` this step invokes**. **Two callers supply these flags:** graft's L4 top-level _Interactive custody stamp sub-step_ (the self-consistency stamp, on whichever of the `merge-gate --pr`/`--local` invocations this step makes), and the **dispatched-lane merge locus** (the `concurrency` dispatcher at gateway obligation 7), which produces a *detective*-custody verdict over the untrusted build lane and threads the same two flags onto the **`--pr`** invocation. The relay is byte-identical regardless of caller or merge mechanism and never distinguishes the two bases (that distinction is the caller's, honoured by never routing either verdict through `FAFF_INTEGRITY_BOUNDARY`). Only a **dispatched** `--pr` merge whose lane produced no detective-custody verdict, or an L1–L3 merge, passes no custody flags.
4. **Cleanup (deploy-side only).** No release artefacts or temp deploy state were created, so nothing needs cleanup. **Never touch the worktree**: teardown belongs to graft, coordinated by the parallel executor when applicable (gateway → **Worktree policy**).
5. **Emit the delivery result.** Save this merge invocation's JSON stdout and observed exit separately. Feed them to `faff merge-gate delivery-receipt --merge-exit <status>` (receipt on stdin). If the receipt shows an open PR after a confirmed mechanical precondition rejection, pass the step-1 reason via `--precondition <reason>`. Keep stderr as the gate's diagnostic. Return the formatter's native result and final contract block verbatim. Graft validates the block via `faff contract delivery-outcome`. The formatter reads only the observed result.

## Rules

- **The integrity floor is not ours.** AC-verified + CI-green + review `pass` is asserted by graft *before* this skill is invoked and is non-delegable. This producer may never bypass, re-open, or weaken it. We add a readiness tier on top; we never subtract the floor's "no".
- **This is the minimum producer.** A richer producer runs a real readiness check (and may produce a `not-ready` signal), deploys after merge, and cleans up its own deploy artefacts — but must still honour the fixed contract and the non-delegable floor, and emit its `faff-contract:delivery-outcome` block (or be wrapped by an adaptor that emits it) so the consumer can parse it.
- **Merge method is the one real choice.** The default is squash + delete-branch. A project that wants merge-commit or rebase history, or to keep branches, overrides the slot (or, if a `.faff/config.yaml` merge-method knob is later added, sets that). The default does not guess per-PR.
- **No deploy.** The default merges and stops. "Shipped" here means "merged to the default branch", not "released". Deployment is what a deploy-capable producer adds.
- **Detect preconditions, never remediate them.** The precondition check (step 1) is **read-only** — it probes `git`/`gh` and reports. It must **never** mutate GitHub/token settings (re-scope a token, flip an org/repo setting, enable a merge method): those are operator/admin actions outside this lane and often need human auth. The producer surfaces the `remedy:` string and emits `not-ready:precondition:<kind>`; the operator applies the one-time fix and re-invokes graft. A swapped-in deploy-capable producer maps the same four `<kind>` tokens onto its own delivery toolchain's probes.
- **Stay in the producer lane.** This skill performs delivery and emits a result + its contract block; it does not own the outcome *vocabulary* (that's the fixed contract), the *parsing* of its block onto that vocabulary (that's the consumer via `faff contract delivery-outcome`), or the *routing* on the outcome (that's `/faff-graft`).
