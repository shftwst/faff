# FAFF-276 — Evaluator code-blindness: the lane-boundary intent schema + a refusing evaluator preflight (rung-2 first slice)

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: medium. Full spec on Linear FAFF-276.

*Prep judged the split the shaping note ordered: this ticket becomes the schema-and-preflight slice (buildable now, pure faff); a follow-up sibling takes the spawner + cross-cage transport + the holdout-verdict `spawner_attested` contract change (blocked by FAFF-325 + FAFF-380). The `faff-automation-hold` is not lifted — the two `Punt:` decisions below are the reason it exists.*

This spec is for the build agent that implements the **first buildable-now slice** of FAFF-276, and for the human reviewers gating an L4 trust change. It scopes itself deliberately to the pure-faff half of the ticket and files the rest as a named, blocked sibling — see the split decision in WHY.

## 1. WHY — Problem and Principles

**The load-bearing model.** The holdout evaluator's `code_blind: true` is today a **self-attestation by the judged party** — the evaluator declares its own blindness, and the `holdout-verdict` contract checks only that the flag is *present and true*. It cannot detect an evaluator that read the codebase and lied. Since FAFF-309/311 made that verdict the 4th L4 merge-floor leg, the attestation is now **load-bearing for autonomous merges to `main`**. The fix direction (ADR-0041, rung 2) is to make blindness a **physical fact** rather than a promise: the evaluator lane runs where the codebase is *unreadable*, and a preflight **refuses** at lane entry if that boundary is absent.

**Problem statement:** the evaluator self-declares blindness and the contract trusts the flag; a codebase-reading, lying evaluator would gate-pass a bad merge. This slice ships the two pure-faff enforcement primitives — a **versioned lane-boundary intent schema** and a **refusing evaluator preflight** (in-container + repo-absent) — so blindness can be asserted at lane entry independent of the self-declared flag.

**Design principles:**

- **Assert, don't implement (ADR-0010).** faff builds no sandbox and launches no cage. It emits a declarative boundary intent (intent-out) and asserts the promised boundary at lane entry, refusing if absent (assert-in).
- **A declaration is never a trust source.** The intent artifact is orchestrator-authored *intent*; the preflight's refuse decision rests on a **physical probe of the environment** (repo reachable ⇒ refuse), never on what the artifact *claims*.
- **Refuse, not degrade.** The evaluator preflight **refuses** (exit 1) when its boundary is absent — ADR-0041 decision 2's assert-in posture applied at lane granularity.
- **Ship the seam, don't wire it live yet.** This slice ships the primitives **tested but unwired**; wiring rides with the cage+spawner sibling.

**Scope statement:** this is rung 2 of the ADR-0041 isolation ladder, first slice — the pure-faff assertion tooling that a later (blocked) slice wires into a real evaluator cage.

## 2. OUT OF SCOPE

- The evaluator cage itself (FAFF-380).
- The `evaluate-call.mjs` spawner + cross-cage transport + the `spawner_attested` contract change (the new sibling ticket FAFF-384, blocked by FAFF-325 + FAFF-380).
- The host-socket-absent preflight leg + the architecture-SVG correction (FAFF-333 — do NOT edit the SVG here).
- The integrity-signal preflight leg + the evaluator-lane attestation channel (FAFF-325).
- Wiring the preflight into the live holdout dispatch / flipping `faff-automation-hold`.
- Generalising the preflight to non-evaluator lanes (`--lane`) — rung 3.

## 3. WHAT — Types and Interfaces

**Type — the lane-boundary intent record (net-new `faff-contract:lane-boundary`):**

```
RECORD LaneBoundaryIntent:
  version: int                 # schema version; starts at 1; bumped on any breaking field change
  lane: "evaluator"            # closed set today = {"evaluator"}
  container: "shared" | "own"  # ADR-0041 rung axis. Evaluator declares "own"
  accesses:
    repo: "absent" | "present"          # evaluator declares "absent" — code-blindness made physical
    host_socket: "absent" | "present"   # asserted by FAFF-333 (declaration-only here)
  integrity_signal: bool       # asserted by FAFF-325 (declaration-only here)

  CONSTRAINT version >= 1
  CONSTRAINT lane in {"evaluator"}
  CONSTRAINT container in {"shared","own"}
  CONSTRAINT accesses.repo in {"absent","present"} AND accesses.host_socket in {"absent","present"}
```

The validator (`faff contract lane-boundary`) is a deterministic shape check mirroring `env-handle`/`holdout-verdict`: `computeLaneBoundary(extraction)` + `schemaCheck`. **Per the spec-review note, an out-of-enum `lane`/`container`/`accesses.*` routes to the `violations` array (exit 1), not fail-loud** — fail-loud/exit-2 is reserved for structural malformation (a non-object input). `host_socket`/`integrity_signal` are carried in the schema now but **not asserted** by this slice.

**Interface — the evaluator preflight subcommand:**

```
faff evaluator-preflight [--repo-path <path>] [--json] [--selftest]

  Pure core: evaluatorPreflight(env, fsq, repoPath) -> { holds: bool, refusals: [ {leg, detail}, ... ] }
  Exit 0  → holds (every refuse-leg passed)
  Exit 1  → REFUSE (>=1 leg failed)
```

Pure over `(env, fsq, repoPath)` like `containerCheck`; the `fsq` seam is injectable so `--selftest` runs synthetic fixtures. Never throws. `--repo-path` defaults, when omitted, to the resolved repo working tree.

## 4. HOW — Behavior

**Preflight procedure (this slice — two refuse-legs):**

```
PROCEDURE evaluatorPreflight(env, fsq, repoPath):
  refusals := []
  # Leg 1 — in-container: the evaluator cage must exist.
  IF containerCheck(env, fsq).result != "contained":
       refusals.push({ leg: "in-container", detail: "no container boundary — <basis>" })
  # Leg 2 — repo-absent: the codebase must be physically unreadable.
  IF fsq.isDirectory(repoPath) == true:
       refusals.push({ leg: "repo-absent", detail: "repo path '<repoPath>' is a readable directory" })
  RETURN { holds: refusals.length == 0, refusals }
```

**Edge cases:** absent/unreadable/non-directory `repoPath` → `fsq.isDirectory` returns `false` (never throws) → repo-absent leg passes (the desired blind state). Both legs fail → both refusals reported.

**Anti-patterns:** wiring the preflight into the current inline holdout dispatch; trusting the intent artifact's `accesses.repo` claim to skip the physical probe; editing the architecture SVG.

## 8. DONE — Definition of Done

- `faff-contract:lane-boundary` block validated by `faff contract lane-boundary`, out-of-enum → violations/exit 1, non-object → fail-loud/exit 2.
- Schema carries `{version>=1, lane, container, accesses:{repo, host_socket}, integrity_signal}`; `host_socket`/`integrity_signal` present but not asserted.
- `faff evaluator-preflight [--repo-path] [--json] [--selftest]`; pure core; exit 0 holds / 1 refuse; never throws.
- In-container leg reuses `containerCheck` verbatim; repo-absent leg uses `fsq.isDirectory(repoPath) === false`.
- Both-legs-fail reports every refusal.
- No call to `evaluator-preflight` in the live holdout dispatch (ship-not-wire); no edit to the architecture SVG.
- `--selftest` for both + `node --test` coverage; `faff --help` + `docs/guide/cli.md` updated.

confidence: medium
