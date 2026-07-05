# Spec: FAFF-371 — Adapt the env slot (faffter-noon-env-compose) to a bounded nested engine

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-371.

This document is the build spec for FAFF-371. It addresses the gap that `faff env` (the CLI engine behind the `faffter-noon-env-compose` slot occupant) has only ever been validated against a host docker daemon, while the accepted isolation posture (ADR-0041, decision 3) mandates a bounded nested engine inside the L4 cage. Audience: the build agent implementing the change, and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every live `faff env` verb (`up`, `seed`, `down`) is a thin wrapper over the `docker` CLI, and the `docker` CLI already resolves which engine it talks to from the ambient `DOCKER_HOST` environment variable. This issue is therefore *not* a port of faff to a new engine — it is validating and hardening the existing ambient path against a rootless nested engine, and closing the three seams that only become visible when the engine is not the host daemon: teardown losing its compose context, published-port reachability under rootless networking, and an unreachable-engine error that names nothing.

**Problem statement.** ADR-0041 decision 3 rejects the mounted host docker socket; the only tested `faff env` path is `docker compose up` against exactly that host socket. On a properly-bounded cage, an L4 lights-out run reaches `faff env` at faff-graft's holdout step and the verification chain breaks on unvalidated engine behaviour. This issue validates the compose-up → seed → health-check → teardown lifecycle against a rootless nested engine and hardens the seams it exposes.

**Design principles.**

**Engine-agnostic by inheritance, not by detection.** faff must not grow engine-specific branches. The `docker` CLI already honours `DOCKER_HOST`; every faff docker invocation must keep inheriting the ambient process environment untouched. An implementation that sniffs socket paths or special-cases podman would be rejected.

**Assert-don't-implement for cage concerns.** The cage image, the nested engine's installation, its storage driver, and the isolation proof are claude-box's side (ADR-0041). faff's side is that its own verbs work correctly when handed a bounded engine, plus a durable regression guard in its own CI.

**Fail loud, never skip silently.** The rootless CI lane must be required (`FAFF_REQUIRE_DOCKER=1` pattern, already established) so a broken rootless setup reads red, never "tested".

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`cmdEnv`, ~line 8660; `envDockerAvailable`, line 8501; `envAllHealthy`, line 8513; `renderCompose`, line 8371) | JavaScript | The env verbs this issue validates and hardens |
| `plugin/skills/faffter-noon-env-compose/SKILL.md` | Markdown | The slot occupant emitting the `faff-contract:env-handle` block |
| `plugin/skills/faff-graft/SKILL.md` (holdout gate, ~line 400) | Markdown | The consumer: holdout step provisions the env, evaluator hits the handle endpoint |
| `test/env.test.mjs` | JavaScript | Existing deterministic + docker-gated integration suite this extends |
| `.github/workflows/validate.yml` (docker assert, ~line 181) | YAML | CI home of the existing host-daemon lane; the new rootless lane lands beside it |
| `docs/adr/0041-…` decision 3 | Markdown | The boundedness criterion this work satisfies |

**Scope statement.** This is the faff-side half of the bounded-engine posture; the claude-box side (providing the engine inside the cage) is external, and the host-socket detect-and-refuse probe is the separate downstream issue FAFF-333.

## 2. OUT OF SCOPE

- **Host-socket detection / refusal probe** — FAFF-333 owns detect-and-refuse of `/var/run/docker.sock` plus the doc/SVG correction (the current architecture SVG still blesses the mounted socket). Extension point: a preflight probe alongside `container-check` in `plugin/skills/faff/bin/faff`.
- **Providing the nested engine inside the cage** — claude-box's side, handed to a claude-box session; engine choice (sysbox vs rootless dind vs rootless podman) hinges on host control, which is not faff's to decide. Extension point: none in faff; the joint acceptance runbook (this issue) is where the two sides meet.
- **Isolation proof** (host socket absent, host fs invisible — point 4 of the shared acceptance shape) — property of the cage image, provable only from inside claude-box. Covered by the joint runbook, not by faff CI.
- **Evaluator cage work** (FAFF-276) and further multi-cage ladder rungs (ADR-0041) — separate issues.
- **A podman docker-compat CI lane** — podman compatibility is documented as best-effort (the ambient model covers it by construction), not CI-gated. Extension point: a second matrix entry beside the rootless lane in `validate.yml` if podman support is later promoted.
- **Auto-detection of rootless sockets by faff** — rejected (see Design Decision Rationale); revisit only if real operator pain appears.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Bounded nested engine | A container engine running inside the cage whose authority is bounded by the cage (rootless dind, podman-in-podman, sysbox-class) — ADR-0041 decision 3's criterion |
| Host socket | The host daemon's `/var/run/docker.sock`; mounted into a cage it is root-equivalent host control and fails boundedness by definition |
| Engine context | The engine a `docker` CLI call resolves to — ambient `DOCKER_HOST` if set, else the default socket |
| Rootless lane | The new CI job running the env integration suite against a rootless dockerd instead of the runner's host daemon |

**Interfaces — nothing new, three hardenings.** The `faff-contract:env-handle` shape, the ProvisionPlan schema, and every `faff env` subcommand signature are unchanged. Three behavioural hardenings:

1. `faff env down --project NAME` additionally resolves the compose context the way `up` does: when the default generated compose file (`<root>/.faff/env/docker-compose.yml`) exists, teardown runs `docker compose --project-directory <root> -p NAME -f <file> down -v --remove-orphans`; when it does not, today's `-p`-only form is the fallback. The `--remove-orphans` flag closes the corner where the file at the default path does not match the project being torn down (a stale or other-project file would otherwise scope teardown to that file's service set and leave orphans the label-based `-p`-only form would have removed). Signature unchanged, so every already-emitted `teardown_cmd: "faff env down --project <name>"` keeps working.
2. Engine-unreachable errors name the effective engine context: where `envDockerAvailable()` fails, the message includes `DOCKER_HOST` when set, or "default socket" when not (`faff env up: docker unavailable (DOCKER_HOST=unix:///run/user/1000/docker.sock)`), so a mis-set socket path is diagnosable from the error alone.
3. The docker-gated app-tier integration test additionally asserts the plan's `endpoint` is reachable from the test process (HTTP GET returns the health route's expected status) — the exact property the evaluator depends on, currently asserted only via in-container healthchecks.

**New artifacts.**

- A rootless CI job in `validate.yml` (see HOW).
- A joint acceptance runbook, `docs/cage-engine-acceptance.md`, encoding the shared four-point acceptance shape (compose up with no host socket · published port reachable at `localhost:<port>` · clean compose down · isolation proof) with faff's three points mapped to concrete `faff env` commands and the fourth marked as claude-box's proof.

**Assumes:** claude-box (external) will provide a bounded nested engine inside the cage exposing a docker-compatible socket with the compose plugin available; faff's contract with it is only `DOCKER_HOST` + a working `docker compose`. Validation instruction: the joint runbook's first step is `docker info` + `docker compose version` inside the cage.

**Assumes:** GitHub-hosted `ubuntu-latest` runners can run a rootless dockerd (uidmap / slirp4netns or pasta prerequisites installable, `dockerd-rootless-setuptool.sh` completes as the runner user). Validation instruction: the lane's setup step asserts `docker info` against the rootless socket before any test runs, and fails the job loudly if setup itself fails.

## 4. HOW — Behavior

**Architecture.** No new components. The change surface is: one hardened subcommand (`down`), one enriched error message, one new test assertion, one new CI job, one runbook document, and a short precondition note in the env slot's docs. The ambient-inheritance property (every `spawnSync("docker", …)` inherits the process environment) already holds — the build must preserve it, not create it.

**Teardown context resolution.** Plain-English: `down` should tear down what `up` stood up even when the engine context differs between invocations or the labels-only lookup misses.

```
PROCEDURE env_down(project, root):
  1. compose_file = <root>/.faff/env/docker-compose.yml
  2. IF compose_file exists:
       run: docker compose --project-directory <root> -p <project> -f <compose_file> down -v --remove-orphans
  3. ELSE:
       run: docker compose -p <project> down -v        # today's behaviour, unchanged
  4. Report OK (idempotent: down of an absent project is success — unchanged)
```

**Anti-pattern:** making `down` require a `--plan` or `-f` argument. Why: every handle already in the wild carries `teardown_cmd: "faff env down --project <name>"`; a signature change breaks the env-handle consumers for a robustness gain the default-path resolution already delivers.

**Rootless CI lane.** Plain-English: prove, on every merge, that the whole env lifecycle works when the engine is a rootless daemon reached via `DOCKER_HOST` — the closest host-portable stand-in for the in-cage nested engine.

```
JOB env-rootless (ubuntu-latest, runs beside the existing host-daemon lane):
  1. Install rootless prerequisites (uidmap, slirp4netns/pasta as required)
  2. Disable/ignore the system dockerd for this job's environment
  3. Run dockerd-rootless-setuptool.sh install as the runner user
  4. export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
  5. Assert: docker info succeeds AND reports a rootless daemon — else fail the JOB (setup fault, loud)
  6. Run the env + holdout integration tests with FAFF_REQUIRE_DOCKER=1
     (node --test test/env.test.mjs test/holdout-evaluate-integration.test.mjs)
```

The existing test suite runs unmodified — that is the point: if the suite passes against the rootless socket, the ambient model is proven with zero engine-specific code in faff.

**Endpoint reachability assertion.** In the app-tier integration test (real Node + Postgres), after `up` reports healthy, issue an HTTP GET to the plan's `endpoint` health path from the test process and assert the expected status. This is the evaluator's exact dependency (the env-handle `endpoint` it is handed), and it is precisely what rootless port-publishing (slirp4netns/pasta loopback binding) could silently break while in-container healthchecks stay green.

**Health-check degradation.** `envAllHealthy` already falls back to running/up state when the engine reports no Health field — relevant for rootless engines with reduced health reporting. Keep it; the new endpoint assertion is the guard against that fallback masking a not-actually-ready service.

**Edge cases and errors.**

- Engine unreachable at `up`/`seed`/`down`: terminal, exit 1 (down: still idempotent-success by design), message names the effective `DOCKER_HOST` (or "default socket"). Not retryable by faff; the caller (holdout step) surfaces it as an env fault, never a feature failure — unchanged consumer behaviour.
- `DOCKER_HOST` set but pointing at a dead socket while the default socket works: faff must NOT fall back to the default socket — silent fallback would re-open the exact host-socket path this posture closes. The enriched error is the whole remedy.
- All published ports in `DATASTORE_TABLE` (5432/3306/6379/27017/9000) and the app port (8080) are above 1024, so rootless unprivileged-port limits are not in play; no port remapping needed.

**Failure modes.**

- **Rootless setup proves flaky on hosted runners.** How you'd know: the lane fails in its setup/assert step (before tests), repeatedly, on infra not code. What it means: pin the rootless install method/version first; if still unworkable, narrow to the documented fallback — keep the endpoint-reachability assertion on the host-daemon lane, demote rootless validation to a documented local procedure plus the joint in-cage runbook. The regression guard degrades but the acceptance evidence still exists; record the narrowing on the ticket.
- **Rootless port publishing binds where the evaluator isn't.** How you'd know: the new endpoint GET fails on the rootless lane while `compose ps` reports healthy. What it means: this is exactly the defect class the issue exists to catch — fix is engine-config level (pasta/slirp flags are cage-image concerns) or, if it reproduces on plain rootless dockerd defaults, a genuine faff bug in how the endpoint is derived. Diagnose before assigning sides.
- **The in-cage engine diverges from plain rootless dockerd** (storage driver, cgroup mode). How you'd know: faff CI green, joint runbook step fails inside claude-box. What it means: cage-image precondition work on the claude-box side; faff's docs list the observed requirement, faff code stays engine-agnostic.

## 5. Scenarios

```
Given a rootless docker daemon and DOCKER_HOST pointing at its socket, with no host socket present
When faff env up and faff env seed run for a postgres + app profile
Then all services reach healthy within the SLA and both commands exit 0
```

```
Given the env is up under the rootless engine
When the provisioning process issues an HTTP GET to the plan's endpoint health path
Then it receives the expected status — the same endpoint the env-handle hands the evaluator
```

```
Given the env is up and the generated compose file exists at the default path
When faff env down --project <name> runs (in a fresh process with the same DOCKER_HOST)
Then the project's containers and volumes are gone (docker compose ps for the project is empty)
```

```
Given DOCKER_HOST points at a nonexistent socket
When faff env up runs
Then it exits 1 and the error message names the effective DOCKER_HOST value
```

Assertion (non-functional): the rootless CI lane sets `FAFF_REQUIRE_DOCKER=1` and asserts a rootless daemon in setup — a silently-skipped or accidentally-host-daemon run is impossible to mistake for a pass.

## 6. Design Decision Rationale

**How should faff resolve the engine socket?** Options: (a) faff auto-detects rootless sockets and sets `DOCKER_HOST` itself — convenient but engine-sniffing, wrong-guess risk, and a second resolution authority competing with the operator's; (b) inherit ambient `DOCKER_HOST`, document the precondition — zero code, matches how the docker CLI already works, cage/operator stays the single authority; (c) a new engine-probe subcommand — overlaps FAFF-333's mandate. **Chosen:** ambient inheritance plus the enriched unreachable-engine error. Deterministic-tools-over-prose is satisfied by the docker CLI itself doing the resolution; boundedness *probing* stays with FAFF-333.

**Which engine does faff validate against?** Options: rootless dockerd (host-portable, docker-compose native, runnable in CI); rootless podman with docker-compat socket (viable, but a second matrix cell to maintain); sysbox (requires host runtime control — not available on hosted CI). **Chosen:** rootless dockerd as the reference validation target; podman-compat documented as expected-to-work via the same ambient model but not CI-gated. The cage's actual engine remains claude-box's choice — faff's ambient model is the compatibility surface, not the engine name.

**Should `down` carry the compose context?** Options: keep `-p`-only (status quo — relies on engine-side project tracking, fragile across context shifts, can leak containers behind an idempotent OK); require an explicit `-f`/`--plan` (breaks emitted teardown_cmd strings); resolve the default compose path like `up` does, fall back to `-p`-only. **Chosen:** default-path resolution with `-p`-only fallback, with `--remove-orphans` on the `-f` form. File-based resolution alone is *not* strictly more robust than the label-based status quo — a stale or other-project file at the default path would scope teardown to the wrong service set — so the flag covers that mismatch by construction; the combination is more robust than either form alone, and fully backward compatible.

**What is the durable regression guard?** Options: a rootless-dockerd job on the hosted runner (validates socket resolution, rootless networking, the whole lifecycle, every merge); a privileged-dind rig (ADR-0041 names it a weaker posture — validating against it proves the wrong thing); local-only manual validation (one-time evidence, rots immediately). **Chosen:** the rootless CI lane, with a named fallback (see Failure modes) if hosted-runner rootless proves unworkable.

**Where does endpoint reachability get proven?** Options: trust in-container healthchecks (blind to exactly the rootless port-forwarding failure class); a separate probe tool (machinery for one assertion); one HTTP GET added to the existing app-tier integration test, running on both CI lanes. **Chosen:** the added test assertion.

**Whose concern are storage-driver / cgroup quirks?** Options: faff detects and adapts (engine-sniffing, violates the boundary); cage-image precondition, documented by faff. **Chosen:** cage-image precondition — a short preconditions note in the env slot docs plus the runbook; faff code stays agnostic (assert-don't-implement, per ADR-0041).

**Where does the shared four-point acceptance test live?** Options: fully automated in faff CI (impossible — claude-box isn't present, and the isolation proof is a cage property); fully manual (no durable guard). **Chosen:** split by ownership — points 1–3 are continuously enforced in faff CI by the rootless lane + scenarios above; the full four-point run inside claude-box is the joint runbook (`docs/cage-engine-acceptance.md`), executed when claude-box hands over the cage, with point 4 explicitly claude-box's proof.

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

- Claude-box provides a bounded nested engine with a docker-compatible socket + compose plugin inside the cage. Validation: runbook step one — `docker info` and `docker compose version` inside the cage before anything else.
- GitHub-hosted `ubuntu-latest` supports a rootless dockerd for the CI lane. Validation: the lane's own setup assertion (`docker info` against the rootless socket, checked before tests); the named fallback in Failure modes applies if this assumption fails persistently.

## 8. DONE — Definition of Done

### From WHY
- [ ] The full env lifecycle (`compose-gen` → `up` → `seed` → endpoint reachable → `down`) passes against a rootless engine reached via `DOCKER_HOST`, with the existing test suite unmodified in its assertions (new assertions added, none weakened).

### From WHAT (interfaces)
- [ ] `faff env down --project NAME` uses `--project-directory <root> -f <default compose file> --remove-orphans` when that file exists, and today's `-p`-only form when it does not; signature and idempotent-success semantics unchanged (unit-coverable by inspecting the spawned argv, plus the docker-gated teardown scenario).
- [ ] Engine-unreachable errors from `up`/`seed` include the effective `DOCKER_HOST` value, or "default socket" when unset.
- [ ] No new engine detection, socket sniffing, or `DOCKER_HOST` mutation anywhere in `faff env` (review assertion: docker invocations still inherit ambient env untouched).

### From HOW (behaviour)
- [ ] App-tier integration test asserts an HTTP GET to the plan `endpoint` health path returns the expected status after `up` reports healthy.
- [ ] `validate.yml` gains a rootless lane: rootless dockerd setup, `DOCKER_HOST` exported, setup-step assertion that the daemon is rootless, then the env + holdout integration tests with `FAFF_REQUIRE_DOCKER=1`.
- [ ] The rootless lane is required, not best-effort: a rootless-setup failure fails the job loudly (no skip path).

### From HOW (edge cases)
- [ ] A dead `DOCKER_HOST` never falls back to the default socket — `up` exits 1 with the named context (scenario four).
- [ ] Teardown scenario passes on the rootless lane: after `down`, `docker compose ps` for the project is empty.

### Docs (same PR)
- [ ] `docs/cage-engine-acceptance.md` exists, encoding the four-point joint acceptance shape with faff's three points as concrete commands and point four marked external.
- [ ] The env slot docs / `docs/cli.md` env section state the ambient `DOCKER_HOST` precondition and the storage-driver/cgroup cage-image precondition.

**Integration smoke test** (the plumbing-connected path, already largely encoded in the app-tier test — extended, not new):

```
1. On a machine with ONLY a rootless dockerd (DOCKER_HOST=unix:///run/user/<uid>/docker.sock):
2. faff env compose-gen --profile <postgres+app profile>   → plan JSON, exit 0
3. faff env up --plan plan.json --project smoke            → "2 service(s) healthy", exit 0
4. HTTP GET <plan.endpoint><health path>                   → expected status
5. faff env seed --plan plan.json --project smoke          → exit 0
6. faff env down --project smoke                           → exit 0; compose ps for project empty
```

confidence: high
spec-review: approve

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)** — No issues. Six numbered deliverables sounds wide, but the estimated surface (one subcommand hardening, one error message, one test assertion, one CI job, two docs) is a coherent 1–3 day unit, and the parts are not independently shippable in a useful way: the CI lane is the regression guard for the hardening it lands with, and the docs must ship in the same PR per house rule. No split; no always-ships-together sibling to merge (FAFF-333 is deliberately downstream, not a co-ship).

**Workstream fit? (principles 1 + 5)** — The issue itself coheres: it directly serves the "Trustworthy lights-out" outcome (an L4 run that survives a bounded cage instead of breaking at graft's holdout step), and the `faff-chain-gap-fill` label matches that intent. One container-level observation, not a blocker on this issue: the project name's "harden & broaden (post-v1)" qualifier is activity/theme-flavoured — a post-v1 catch-all shape rather than a single shippable outcome — so "done" for the project is fuzzy. That's a project-boundary finding for a backlog-diagnostics pass, not a reason to re-home this ticket; FAFF-371 sits with its nearest outcome either way.

**Deps surfaced? (principle 6)** — Mostly clean, one gap worth naming.

- What's there: the `blocks FAFF-333` edge is explicit and points the right way (333's doc correction deliberately waits on this). The faff-side deliverables are correctly decoupled from claude-box — the CI lane uses rootless dockerd as its own reference target, so nothing here silently waits on the external engine.
- The gap: Assume 1 (claude-box provides a docker-compat socket + compose plugin) is a load-bearing cross-repo dependency that exists only in spec prose and a human comment. The joint runbook's full 4-point acceptance cannot complete without claude-box shipping point 4, and no tracker artefact encodes that.
- Why it matters: when this ticket goes Done, "env slot cage-ready" will read as true in the tracker while the joint acceptance is still half-open — the unfinished half is invisible to `faff next`/map.
- What to do: if a faff-side tracking ticket for the claude-box counterpart (or for "run the 4-point joint acceptance") exists, link it as related/blocked here; if none exists, file a thin follow-up ticket for the joint-acceptance run and give it the blocker edge on both this issue and the claude-box delivery. The spec's ownership split stays intact — the ticket just makes the open external half visible.

**Risk profile? (principle 7)** — One de-risking recommendation.

- What's there: the spec makes the rootless-dockerd CI lane **required** in validate.yml on the strength of Assume 2 (ubuntu-latest supports rootless dockerd), validated only by the lane's own setup assertion at merge time, with a named fallback documented.
- Why it matters: a required lane whose viability is unproven puts the surprise at the worst moment — if the assumption fails, the first discovery is every PR going red (or this PR stalling at its own merge gate), and the "named fallback" gets exercised under gate pressure instead of calmly.
- What to do: spend the cheap spike first — a throwaway workflow run (or landing the lane non-required and flipping it to required after one green run on main) converts Assume 2 into evidence for roughly an hour of work, without changing the spec's chosen end-state. The external-dep risk (claude-box) is already well de-risked by construction: quarantined out of scope with the runbook as the contract boundary.
