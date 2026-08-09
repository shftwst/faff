# merge-gate: pure control-flow tests for `--check-only` and `--human-override`

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-367.

This spec covers FAFF-367 for the build agent and human reviewers. It adds `node:test` coverage for two untested control-flow branches of `faff merge-gate` — the `--check-only` short-circuit and the `--interactive --human-override` record-then-fall-through — exercising the real CLI shell **without network** by injecting a stub `gh` on `PATH`. It is a test-only change: no production behaviour moves.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff merge-gate` is a pure decision core (`decideFloor`) wrapped in a thin impure shell that observes CI, reads the run-dir floor artifacts, decides, and then *routes* on that decision. The routing has three branches the pure core cannot see: `--check-only` returns `merge-ok` **without** ever spawning `gh pr merge`; a plain `refuse` returns exit 1; and `--interactive --human-override` on a `refuse` **records an override file and falls through to execute**. Those branches are pure control flow — they only *appear* impure because they sit past the `gh` calls. A stub `gh` on `PATH` makes them testable deterministically.

**Problem statement.** Today `mergeGateSelftest` covers the pure cores and `test/merge-gate.test.mjs` covers arg validation, but the `--check-only` and `--human-override` shell branches have **no** test. The absence let an adversarial reviewer plausibly (but wrongly) claim `--check-only` returns a false green (FAFF-350 OBSERVATION #9). This change adds tests that make the control flow self-documenting and regression-proof.

**Design principles.**

- **Assert at the CLI seam, per ADR 0002.** Bind assertions to the observable seam only: process exit code, `--json` stdout verdict, and the on-disk `merge-gate-override.json` artifact. Never assert on free-text narrative.
- **No network, zero new dependencies.** The stub `gh` is a local executable script placed in a temp dir and prepended to `PATH`; the test drives the *real* `faff merge-gate` entrypoint through `runCli` with a doctored `env`. No third-party libraries — `node:test` + `node:child_process` + `node:fs` only.
- **Do not refactor the merge interlock.** The merge-gate is a security-critical interlock; this ticket adds tests around the shipped shell, it does not restructure it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `cmdMergeGate` | Node | The command under test — the `--check-only` short-circuit and the `--human-override` record+fall-through. |
| `test/merge-gate.test.mjs` | Node (`node:test`) | Existing coverage this file extends. |
| `test/helpers/run-cli.mjs` | Node | The runner; `runCli(args, { env })` spawns the real `faff` child with an overridable environment. |
| `test/sync.test.mjs` | Node | Precedent for writing an executable stub script (`chmodSync(script, 0o755)`) in a temp dir. |

## 2. OUT OF SCOPE

- Real `gh pr merge` execution / live CI observation — genuinely impure; stays covered by the integration smoke test.
- `classifyMergeFailure` / `observeCi` / `classifyCiObservation` matrices — already in `mergeGateSelftest`.
- `decideFloor` verdict truth-table — covered by the `integrity-floor` contract cases.
- A reusable stub-`gh` helper for other tests — YAGNI until a second consumer.

## 3. WHAT — the stub `gh`

A local executable script answers the exact `gh` subcommands the merge-gate shell issues, from canned data (env-parameterised), and records whether `gh pr merge` was invoked (a **merge sentinel** file). Placed in a temp dir prepended to `PATH`. Unhandled subcommand → exit non-zero (loud drift detection).

The `gh` invocations the stub answers:

```
gh pr view <pr> --json headRefOid,state,url  -> {"headRefOid":"<sha>","state":"OPEN","url":"<url>"}
gh api .../check-runs --jq ...  -> [{"status":"completed","conclusion":"success"}]   (--jq pre-applied by fixture)
gh api .../status --jq ...      -> {"state":"success","count":1}
gh pr checks <pr> --json state  -> [] (only reached when head sha carries zero checks)
gh pr merge <pr> ... --match-head-commit <sha>  -> touch merge sentinel; exit 0
```

`--repo owner/repo` is passed to skip `gh repo view`.

## 4. HOW — behaviour under test (against CURRENT `bin/faff`)

Verdicts are forced via floor-artifact seeding:

```
merge-ok := ac-checklist.json {"all_verified":true} + review-verdict.json {"signal":"pass","findings":[]} + stub CI green
refuse   := omit the floor artifacts (readAcComplete->false, readReviewVerdict->"missing")
```

The shipped control-flow order in `cmdMergeGate` is: fence human-only flags (FAFF-375, pre-network) → resolve repo/PR identity → already-MERGED no-op → observe CI → `decideFloor` → **refuse-return (exit 1) BEFORE the check-only short-circuit** → `--check-only` merge-ok short-circuit → spawn `gh pr merge`.

## 5. SCENARIOS — born-verifiable

```
Given a merge-ok floor and a stub gh on PATH
When faff merge-gate runs with --check-only --json
Then it exits 0 with verdict "merge-ok" AND the merge sentinel was never written (no gh pr merge occurred)
```

```
Given a merge-ok floor and a stub gh on PATH
When faff merge-gate runs in execute mode
Then the merge sentinel IS present AND it exits 0 verdict "merge-ok" merged:true
```

```
Given a refuse-inducing floor and a stub gh on PATH
When faff merge-gate runs (execute or --check-only)
Then it exits 1 with verdict "refuse" AND the merge sentinel is absent
```

```
Given any floor, a non-TTY child (runCli), and a stub gh on PATH
When faff merge-gate runs with --interactive --human-override
Then it exits 2 (FAFF-375 TTY fence) BEFORE any gh call AND no override file is written
```

## 6. DRIFT NOTE (FAFF-375, merged ~1h before this build)

FAFF-375 (PR #285) fences `--human-override`/`--allow-no-ci` on `process.stdin.isTTY===true AND --interactive`, returning exit 2 **before any gh call** on a non-TTY invocation. `runCli` spawns a non-TTY child by construction, so the spec's original "override file written + merge sentinel present + exit 0" scenario is **unreachable from the test harness** — the fence fires first. Tests assert the CURRENT behaviour (exit 2 + no override file) and additionally that the fence returns before the override side-effect. Separately, the code's refuse-return precedes the `--check-only` short-circuit, so `--check-only` on a *refuse* floor returns **exit 1 refuse** (not a false-green merge-ok) — the code is safer than the spec's test-case prose implied. Tests follow the code.

## 8. DONE

- [ ] Tests for `--check-only` (merge-ok floor + refuse floor) and the `--human-override` fence, all bound to exit code / `--json` stdout / on-disk artifacts.
- [ ] Runs under `node --test test/` with no new dependency and no network.
- [ ] Stub `gh` records `pr merge` via a sentinel; unhandled subcommand exits non-zero.

confidence: high
spec-review: approve
