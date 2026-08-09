# Spec — FAFF-655: the admission check returns one verdict a workflow can gate on

> Spec: faffter-dark-nlspec · 2026-08-03 · interactive · confidence: high. Full spec on Linear FAFF-655.

## 1. WHY — problem and principle

ADR-0095 (merged) states the admission criteria for a faff run on a CI runner as **two** things: the run is *contained*, and *no host engine socket is reachable* from the job. The ADR names the check faff provides against them — `faff container-check --gate`, a pass/fail on those two axes — and makes it load-bearing: when faff is indifferent to which cage arrived, this check is the only thing standing between "the operator says it's a cage" and "it demonstrably is one."

The detection halves already exist in `plugin/skills/faff/bin/lib/container-check.js` and are correct: `containerCheck(env, fsq)` returns `contained | not_confirmed`, and `hostSocketProbe(fsq)` returns `{present, path}` over the two canonical host-socket paths. What is missing is a **binding verdict a workflow can gate on**, and the two things that make such a verdict trustworthy:

1. Today a present host socket produces a *warning line* and leaves the exit code untouched (`cmdContainerCheck` returns `contained ? 0 : 1` on containment alone). A contained job with a writable host socket bind-mounted in — exactly the vanilla Actions `container:` shape ADR-0095's finding 2 records — exits 0. That is the one case the gate exists to catch, and it currently passes.
2. `cmdContainerCheck` builds its own inputs (`process.env`, `realFsq()`) inside the command body, and `containerCheckSelftest` exercises the pure functions over fixtures but **never runs the command and never observes an exit code**. A gate whose exit code is untested is decoration.

So: a composite verdict covering the two criteria, an injection seam at the command entry point, and selftest cases that assert exit codes — including the markers-present-**and**-socket-present case that must not read as admitted.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the composite verdict is a `--gate` flag on `container-check`, not a new verb — ADR-0095 settles this.** The ticket's open question ("flag or separate verb?") is resolved by the merged ADR, which names `faff container-check --gate` in its Decision and Consequences. So `--gate` joins `--json` and `--selftest` on the existing command. This keeps one command owning both the *surface reading* (default output) and the *binding admission verdict* (`--gate`), rather than splitting the containment story across two verbs. `--gate` composes with `--json` (`--gate --json` emits the composite object); bare `--gate` prints a one-line verdict.

**Chosen: `--gate` admits (exit 0) iff `contained` AND no canonical host socket present; anything else refuses (exit 1).** The two criteria are ANDed. The load-bearing truth-table row is *contained AND host-socket-present → refuse* — a contained job that still reaches the host socket is not admissible, which is precisely what the plain command misses today. `not_confirmed` (containment absent) also refuses, regardless of socket. The verdict is a **pure function of `(env, fsq)`** — the same purity the two detectors already have — so it is deterministic and fixture-drivable, with no tracker or network read.

**Chosen: the bare `container-check` command keeps its exact current exit-code contract — `--gate` is strictly additive.** Without `--gate`, `container-check` still exits `contained ? 0 : 1` on containment alone and still only *warns* on a present host socket (the FAFF-333 behaviour). Existing callers — the CLI dispatch entry and the autonomous-entry preflight that reads containment — are untouched. The new binding semantics live only behind the opt-in flag. This satisfies the AC "existing callers keep their current exit-code contract" without a migration.

**Chosen: `--gate` does not consult the `autonomous.engine_bounded` attestation — it is the strict floor.** `lights-out.js` (the L4 path) downgrades its host-socket *refusal* to a *warn* when the operator sets `autonomous.engine_bounded: true`, attesting that a socket at the canonical path is actually a bounded nested engine. `--gate` deliberately does **not** read that knob: it stays a pure `(env, fsq)` verdict and reports the strict two-criteria answer a CI workflow wants. This is safe-direction (stricter than lights-out, never looser) and matches ADR-0095's default-refuse posture. It is also rarely divergent in practice: `hostSocketProbe` already excludes rootless paths (`/run/user/<uid>/docker.sock`), so a genuinely bounded rootless engine never trips it — the attestation only matters for a socket physically at `/var/run/docker.sock` or `/run/docker.sock`, the unusual case. The gate stays pure; the operator's bounded-engine attestation stays a lights-out-only, recorded downgrade. (If parity is ever wanted, an explicit `--engine-bounded` flag can be added later without changing the default; v1 does not add it.)

**Chosen: the injection seam is a second `deps` parameter on `cmdContainerCheck`, defaulted to the real adapters.** Change `cmdContainerCheck(args)` → `cmdContainerCheck(args, { env = process.env, fsq = realFsq() } = {})`. The CLI dispatch (`bin/faff`) calls handlers as `handler(rest)` — a single argument — so the defaults fire in production unchanged; the selftest passes synthetic `{env, fsq}` to drive the command over fabricated state and read the returned exit code. This mirrors the seam `containerCheck`/`hostSocketProbe` already expose one level down, lifted to the command entry point. No global state, no monkey-patching `process.env`. `--gate` must also be registered in `CONTAINER_CHECK_SPEC` (arity 0, alongside `--selftest`/`--json`), or `parseArgs` rejects it as an unknown flag.

**Chosen: the composite `--gate --json` shape names both criteria, so a reader sees *why* it refused.** Emit `{ verdict: "pass" | "fail", contained: <bool>, basis: <string>, host_socket: { present, path }, criteria: { contained: <bool>, no_host_socket: <bool> } }` — carrying `basis` through from the plain `--json` output so a `containment not confirmed` fail still names which signal was missing. Bare `--gate` prints `pass` or `fail — <reason(s)>` where the reasons name the failing criterion (`containment not confirmed`, `host docker socket present at <path>`). A workflow gates on the exit code; a human reading the log sees which of the two criteria failed without reassembling it from two independent lines (the AC's "one composite" requirement).

**Chosen: the selftest drives the command and asserts exit codes, with the markers-AND-socket row explicit.** Extend `containerCheckSelftest` with a case table that calls `cmdContainerCheck(["--gate", "--json"], { env, fsq })` (JSON so the case can assert the composite fields, not just the code) over synthetic fixtures and asserts the returned integer. Required rows, at minimum:
- contained (dockerenv) + no socket → exit 0, verdict pass.
- **contained (dockerenv) + host socket present → exit 1, verdict fail** (the case that matters — must not read as admitted).
- `not_confirmed` (no signal) + no socket → exit 1.
- `not_confirmed` + host socket present → exit 1 (both criteria fail).
- k8s contained + no socket → exit 0.
- A parallel check that bare `cmdContainerCheck([], {env, fsq})` (no `--gate`) still returns 0 for contained-with-socket-present (the unchanged legacy contract) — proving `--gate` is additive, not a mutation of the default.

**Assumes:** ADR-0095 is the authority for the criteria set and their default-refuse posture (merged, PR #527). The downstream adopters that actually *call* `--gate` in a workflow are FAFF-643 / FAFF-606 (this ticket builds the check and its tests; it does not wire the gate into any workflow). "Work scoped to this checkout" is **not** a criterion here — ADR-0095 excluded it as not faff-checkable, so the verdict covers two criteria, not three.

## 3. HOW — acceptance

- `cmdContainerCheck` takes an injected `(env, fsq)` via a defaulted `deps` parameter; the real adapters are the defaults, supplied by the caller exactly as the pure functions already are. The CLI dispatch is unchanged (`handler(rest)` still works).
- `container-check --gate` returns **one composite verdict**: exit 0 iff `contained` AND no canonical host socket present; exit 1 otherwise. `--gate --json` emits the composite object naming both criteria; bare `--gate` prints `pass`/`fail — <reason>`.
- The selftest asserts **exit codes** over synthetic fixtures via the command entry point, including container markers present **and** a host socket present, which asserts exit 1 (not admitted).
- The bare `container-check` command (no `--gate`) keeps its current exit-code contract exactly: `contained ? 0 : 1`, host socket only warns. A selftest row proves the legacy contract is unchanged.
- The verdict covers **two** criteria (contained; no host engine socket reachable); "work scoped to this checkout" is not included, per ADR-0095.
- No new dependency; `container-check.js` stays pure `(env, fsq)`; `node --test` and `faff container-check --selftest` both green.

### Scenarios

```
Given a contained job (dockerenv marker) with the host docker socket bind-mounted in
When faff container-check --gate runs
Then it exits 1 (fail) naming the host-socket criterion — the contained-but-unbounded case is refused
And bare faff container-check still exits 0 with a warning, its contract unchanged.
```

```
Given a bare host with no container markers and no host socket
When faff container-check --gate runs
Then it exits 1 (fail) naming the containment criterion.
```

```
Given the selftest running over synthetic (env, fsq) fixtures
When it drives cmdContainerCheck(["--gate","--json"], {env, fsq})
Then it asserts the returned exit code per row, including markers-present-and-socket-present → exit 1.
```

## 4. DONE — definition of done

- [ ] `cmdContainerCheck(args, { env, fsq } = {})` injection seam added; defaults are the real adapters; CLI dispatch unchanged.
- [ ] `--gate` registered in `CONTAINER_CHECK_SPEC` (arity 0); it produces one composite verdict: exit 0 iff contained AND no canonical host socket; exit 1 otherwise. Composes with `--json`.
- [ ] `--gate --json` emits `{ verdict, contained, basis, host_socket, criteria: { contained, no_host_socket } }`; bare `--gate` prints `pass`/`fail — <reason>`.
- [ ] `containerCheckSelftest` drives the command and asserts exit codes, including contained-AND-socket-present → exit 1, and a row proving bare `container-check` keeps `contained ? 0 : 1`.
- [ ] Bare `container-check` exit-code contract and warning behaviour unchanged (no migration for existing callers).
- [ ] Verdict covers two criteria (contained; no host engine socket reachable); work-scoped excluded per ADR-0095.
- [ ] `--gate` does not read `autonomous.engine_bounded` (strict floor); the pure `(env, fsq)` property is preserved.
- [ ] `node --test` green; `faff container-check --selftest` green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
