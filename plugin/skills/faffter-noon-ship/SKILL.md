---
name: faffter-noon-ship
description: "Default ship producer: merge a gate-cleared PR through the merge-gate interlock, with no-op deployment; return native delivery result and delivery-outcome."
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

1. **Delivery-precondition check (ship-time backstop).** From the feature checkout run `faff pr preflight --branch "$branch"` for the PR head branch. It rechecks push / merge-method immediately before merge. Correct usage errors (exit 2) and retry. On `git-only` skip to step 2. On `clear` or `indeterminate`, check the real diff:
   - **token-scope** — if it touches `.github/workflows/*`, does the token carry the required workflow permission? (`gh auth status`)
   - **actions-policy** — does the change rely on something org/repo Actions policy forbids (e.g. an Actions-created PR)?

   On exit 1 (`blocked`) use its `cause`; for a confirmed diff-triggered block form `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`. Report the reason and emit one `faff-contract:delivery-outcome` fence with `{"outcome":"not-ready","reason":"<reported reason>","corroborated":false}`. Stop before merge. If a probe is indeterminate (e.g. a network outage), proceed to the merge attempt; an outage there yields failure.
2. **Land the cleared target.** After the caller's approval and integrity checks and the ship-time preflight above, run `faff merge land-default --execute --pr <n> --issue <ID> --run-dir <dir> --level <level>`. Git-only: replace `--pr <n>` with `--local` and forward the caller's `--base` and `--branch` when supplied. In both modes forward the caller's `--custody-verdict <path>` and `--custody-verdict-sha256 <sha>` together, unchanged. The command authorizes, executes through `faff merge-gate`, observes a confirmed merge and formats the receipt. The PR path uses squash and remote branch deletion. The local interlock runs fresh engineering gates.
3. **Return the native result and delivery-outcome block verbatim.** Keep stderr for diagnosis. For a confirmed open-PR rejection with a corroborating precondition diagnosis from step 1, pass the saved gate JSON and exit to `faff merge-gate delivery-receipt --merge-exit <status> --precondition <reason>`. Reformat the receipt without repeating the merge. On an authorization or observation error return the stage and diagnostic to the caller. Worktree cleanup belongs to graft.

## Rules

- **The integrity floor is not ours.** AC-verified + CI-green + review `pass` is asserted by graft *before* this skill is invoked and is non-delegable. This producer may never bypass, re-open, or weaken it. We add a readiness tier on top; we never subtract the floor's "no".
- **This is the minimum producer.** A richer producer runs a real readiness check (and may produce a `not-ready` signal), deploys after merge, and cleans up its own deploy artefacts — but must still honour the fixed contract and the non-delegable floor, and emit its `faff-contract:delivery-outcome` block (or be wrapped by an adaptor that emits it) so the consumer can parse it.
- **Merge method is the one real choice.** The default is squash + delete-branch. A project that wants merge-commit or rebase history, or to keep branches, overrides the slot (or, if a `.faff/config.yaml` merge-method knob is later added, sets that). The default does not guess per-PR.
- **No deploy.** The default merges and stops. "Shipped" here means "merged to the default branch", not "released". Deployment is what a deploy-capable producer adds.
- **Detect preconditions, never remediate them.** The precondition check (step 1) is **read-only** — it probes `git`/`gh` and reports. It must **never** mutate GitHub/token settings (re-scope a token, flip an org/repo setting, enable a merge method): those are operator/admin actions outside this lane and often need human auth. The producer surfaces the `remedy:` string and emits `not-ready:precondition:<kind>`; the operator applies the one-time fix and re-invokes graft. A swapped-in deploy-capable producer maps the same four `<kind>` tokens onto its own delivery toolchain's probes.
- **Stay in the producer lane.** This skill performs delivery and emits a result + its contract block; it does not own the outcome *vocabulary* (that's the fixed contract), the *parsing* of its block onto that vocabulary (that's the consumer via `faff contract delivery-outcome`), or the *routing* on the outcome (that's `/faff-graft`).
