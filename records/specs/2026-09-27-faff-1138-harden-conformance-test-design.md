# FAFF-1138 — Harden the FAFF-1107 code-interface conformance test

> Spec: faffter-dark-nlspec · 2026-09-27 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1138.

This spec targets `test/holdout-rpc-evaluate-integration.test.mjs` (with its helper `eval/bridge-fixture.mjs`), the docker-gated conformance test FAFF-1107 shipped. It is written for the build agent implementing the four robustness fixes, and for human reviewers confirming the test stays honest. FAFF-1107's proof still holds today (happy path passes 7/7, CI green); this ticket tidies four non-blocking robustness observations that FAFF-1107's pre-PR review raised. No production behaviour changes.

## 1. WHY — Problem and Principles

**The one idea:** this is a test-robustness pass over a working, green test — every fix must preserve its current *honest-degradation* contract (skip cleanly when a capability is missing, never a RED flake) and its *zero-production-change* stance. The test proves three things against a single containerised bring-up (live wire conformance, real-spawner e2e verdict, cage topology); nothing about *what* it proves changes, only *how robustly* it sets up, tears down, and probes.

**Problem statement:** the shipped test leaks docker artifacts if setup asserts throw before its `try`, pins a fixed host port (18930) that can collide, fires a real `docker build` + sibling run/exec at test-*discovery* time on any live-daemon host, and carries one assertion that compares a constant to a copy of its own definition (inert). Each is a tidy-up that a reviewer flagged as non-blocking. This ticket makes setup/teardown leak-free on the failure path, picks a free port dynamically, defers the expensive capability probe into the gated test body, and converts the inert assertion into a live cross-check.

**Design principles:**

**Preserve honest degradation.** The test today skips cleanly (never RED) when the daemon is down, a build is not permitted, or a sibling container is not permitted. Every fix keeps that: a missing capability narrows or skips; it never becomes a hard assertion failure.

**Zero production-code change.** `evaluate-call.mjs`, the bridge (`faff-bridge-node.mjs`), and every contract stay byte-unchanged. Edits are confined to the one test file and, only if needed, the test-support helper `eval/bridge-fixture.mjs`. The test's whole value is that it exercises merged pieces as shipped.

**Cheapest correct mechanism, no new dependency.** Fixes use `node:` built-ins already imported or trivially addable (`node:net`). No new package, no new fixture abstraction.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `test/holdout-rpc-evaluate-integration.test.mjs` | Node ESM (node:test) | The 304-line file under hardening; 3 top-level `test()`, the 3rd docker-gated with 4 `t.test()` subtests |
| `eval/bridge-fixture.mjs` | Node ESM | Test-support helper: `buildImage` / `upBridge` / `execExists`, re-exports `down`/`dangling`/`waitReady` |
| `eval/docker-fixture.mjs` | Node ESM | Source of `down`/`dangling`/`waitReady`; `down` is idempotent + best-effort (finally-safe) |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | Node ESM | REAL spawner under test; `buildWithheldSet` (l.50) feeds `deriveAttestation` (l.60) → `attestation.withheld` in the written verdict (main l.258-263) |
| `test/holdout-evaluate-integration.test.mjs` | Node ESM | Sibling test; its top-level gate is `docker info` only (l.20) — the pattern item 3 aligns to |

**Scope statement:** this sits in the docker-gated holdout integration test layer; it hardens one test's lifecycle without touching the holdout evaluator loop it verifies.

## 2. OUT OF SCOPE

- **A shared free-port utility** — Why excluded: no free-port helper exists anywhere in the repo, and the sibling test also uses fixed ports (18745/18746); building a repo-wide util is a larger refactor than this ticket. Extension point: a future `eval/` helper (e.g. `eval/net-fixture.mjs`) could host a shared `freePort()` that both docker fixtures adopt.
- **The general gate-ladder concurrency guard (FAFF-1137)** — Why excluded: FAFF-1137 owns the general ladder-guard fix for concurrent gate runs; item 3 here is only the *file-specific* half (this one test's import-time probe). Extension point: FAFF-1137's ladder guard; do not re-spec or duplicate its work in this ticket. **Sequencing (asymmetric, not a `blockedBy`):** FAFF-1138-first is always safe and is the recommended order (it shrinks FAFF-1137's remaining surface). FAFF-1137-first is safe *only because* FAFF-1137's own spec scopes this file's `probeDocker()` out (naming it FAFF-1138's) — so it will not touch these lines. If FAFF-1137's implementation ever reaches for a repo-wide lazy-probe generalisation, it must first check whether this file already carries the daemon-only gate, so the two never independently rewrite `probeDocker`/`CAP`/`SKIP_E2E` (~l.87-102) into a rebase conflict.
- **Migrating the sibling `test/holdout-evaluate-integration.test.mjs` to dynamic ports** — Why excluded: that test is green and out of this ticket's single-file remit. Extension point: a follow-up applying item 2's `node:net` pattern to the sibling if fixed-port collisions ever bite there.
- **Changing what the test proves (conformance scenarios, verdict shape, topology)** — Why excluded: FAFF-1107's proof is intact; this is robustness only. Extension point: none — any change to the proof is a separate feature ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Honest degradation | The test skips (or narrows to a weaker form) when a docker capability is missing, and never emits a RED failure for a missing capability. |
| Discovery time | When `node --test` imports the module to enumerate tests, before any `test()` body runs. Module top-level code runs here. |
| SUT cage | The bridge container (System Under Test): the component source is co-resident with the running bridge. |
| Neutral judge cage | A bare `node:20-alpine` sibling container that must NOT see the source — the topology proof's contrast. |
| Inert assertion | An assertion that passes unconditionally because it compares a value against a copy of its own definition, carrying no behavioural signal. |
| Withheld-set | `{ repo: true, worktree_cwd: true, diff: true }` — what the spawner provably keeps from the child; `buildWithheldSet()` is its single source (evaluate-call.mjs l.50). |

**Current top-level state (to change):**

```
probeDocker(): { daemon: bool, build: bool, sibling: bool }   # l.87-101; RUNS a real build + sibling run/exec
CONST CAP = probeDocker()                                     # l.101; fires at DISCOVERY time
CONST SKIP_E2E = !daemon ? "..." : !build ? "..." : false      # l.102; couples skip to the expensive probe
CONST hostPort = 18930                                        # l.164; fixed, inside the gated test body
```

**Target top-level state:**

```
CONST SKIP_E2E = docker-info-ok ? false : "docker daemon unavailable"   # daemon precheck ONLY, cheap
# no module-level build; no module-level sibling run/exec; no CAP constant
```

**Helper interface (`eval/bridge-fixture.mjs`) — unchanged.** `upBridge({ name, tag, hostPort, containerPort })` already accepts `hostPort` as a parameter, so item 2 needs no helper change. Confirm no other helper signature changes are required (they are not).

**Design decision — item 1 teardown strategy:** move the two setup asserts (`buildImage`, `upBridge`) AND the two mkdtemp allocations (`staging`, `workdir`) so every artifact they create is covered by a teardown path, rather than leaking when a setup assert throws before the `try`.
**Chosen:** Move `staging`/`workdir` creation and the `buildImage`/`upBridge` calls inside the `try`, and broaden the `finally` to tear down whatever exists — see HOW. (decides: qa)

**Design decision — item 2 port allocation:** replace the fixed `18930` with a dynamically-chosen free port.
**Chosen:** Open a throwaway `node:net` server on port 0 bound to `127.0.0.1`, read `.address().port`, close it, then pass that port to `upBridge` — mirrors the in-process path's `realListen("127.0.0.1", 0, …)` + `.address().port` (l.119-120). Inherent close→run TOCTOU race is accepted and noted.

**Design decision — item 3 probe placement:** keep only the cheap `docker info` daemon check at module top level; defer the build + sibling capability legs into the gated test body.
**Chosen:** `SKIP_E2E` derives from `docker info` alone. The build capability collapses into the real `buildImage(staging, tag)` the test already does (skip on false, preserving degradation). The sibling capability folds into the neutral-cage standup that subtest 3 already performs (narrow on failure). No throwaway probe build, no probe sibling run at discovery. Cross-references FAFF-1137 (general ladder guard) but does not implement it.

**Design decision — item 4 inert assertion:** the `assert.deepEqual(buildWithheldSet(), { repo: true, worktree_cwd: true, diff: true })` at l.250 compares a hardcoded literal to a copy of itself.
**Chosen:** Replace it with a live cross-check against the persisted verdict's `attestation.withheld` (the value the real spawner path produced and the contract consumed), tying `buildWithheldSet()` to the real code path's output. See HOW and the rationale for the rejected remove-only option.

## 4. HOW — Behavior

**Architecture and approach:** four localised edits to one test file. The module top-level shrinks to a daemon-only gate; the gated test body absorbs setup, teardown, and the two deferred capability probes; one assertion in subtest 3 changes from inert to live. The other two top-level `test()` calls (manifest validity, in-process plane-split) are untouched.

### Item 1 — leak-free setup/teardown

Behaviour summary: no docker image, container, or temp dir survives a setup-failure path.

```
PROCEDURE gated_test_body(t):
  1. staging  = undefined
     workdir  = undefined
     imageBuilt = false
     containerName = `faff-ci-stack-${pid}`
  2. TRY:
     a. staging  = stageContext()
        workdir  = mkdtempSync(...)
        write specPath, intentPath into workdir
     b. IF NOT buildImage(staging, tag): t.skip("docker build not permitted"); RETURN   # item 3 degradation
        imageBuilt = true
     c. hostPort = freePort(); endpoint = `http://127.0.0.1:${hostPort}/`               # item 2
        assert.ok(upBridge({ name: containerName, tag, hostPort, containerPort: 8080 }), "...")
     d. assert.ok(await waitReady(`${endpoint}faff-rpc/health`), "...")
     e. run the four t.test(...) subtests as today
  3. FINALLY:
     a. down(containerName)                                    # idempotent no-op if never started
     b. IF imageBuilt: docker rmi -f tag                        # only remove what was built
     c. IF workdir: rmSync(workdir, { recursive, force })
     d. IF staging: rmSync(staging, { recursive, force })
  4. assert.equal(dangling(containerName), "", "no container leak")   # after finally, as today (l.303)
```

Precedence: `down`/`rmSync`/`rmi` are all best-effort and guarded so a partial setup tears down cleanly. The `dangling` no-leak assertion stays outside/after the teardown, exactly as l.303 today.

**Anti-pattern:** guarding teardown on the *happy-path* completion flag. Why: teardown must run for whatever was created regardless of where setup stopped; guard each cleanup on *that artifact's own* existence, not on overall success.

### Item 2 — dynamic free port

Behaviour summary: pick a currently-free loopback port instead of pinning 18930.

```
PROCEDURE freePort():
  1. srv = net.createServer()
  2. await srv.listen(0, "127.0.0.1")
  3. port = srv.address().port
  4. await srv.close()
  5. RETURN port
```

The chosen port threads only into the `endpoint` const and `upBridge`'s `hostPort`; everything downstream reads the closed-over `endpoint`, so no other coupling. `import { createServer } from "node:net"` (or `import net from "node:net"`) is added to the import block.

**Implementation note:** `net.Server.listen`/`close` are callback/event-based, not thenable — the `await srv.listen(0, …)` / `await srv.close()` shorthand above will not synchronise as written. Promisify each with a small local wrapper (resolve the `listen` promise on the `"listening"` event, read `.address().port`, then resolve the `close` promise in `close`'s callback) before returning the port. The file's in-process `realListen("127.0.0.1", 0, …)` is the existing promisified analogue, but it is RPC-specific, so a local wrapper is the right size here.

**Anti-pattern:** holding the throwaway server open "to reserve" the port. Why: docker cannot bind a port the test still holds; the server must close before `docker run`. The close→run gap is an accepted TOCTOU race (see Failure modes).

### Item 3 — daemon-only top-level gate; deferred capability legs

Behaviour summary: nothing but `docker info` runs at import; the build and sibling probes move to where the test actually uses them.

```
# module top level (replaces l.87-102):
CONST SKIP_E2E = spawnSync("docker", ["info"], {stdio:"ignore"}).status === 0
                   ? false : "docker daemon unavailable"
# probeDocker() and CONST CAP are deleted.
```

- **Build leg:** the real `buildImage(staging, tag)` in the body IS the build capability check — `false` → `t.skip("docker build not permitted")` + early return (step 2b above). This preserves the old `"docker build not permitted"` skip without a separate throwaway build.
- **Sibling leg:** subtest 3 already stands a neutral cage up (l.259-264). Fold capability detection into that standup: attempt `docker run -d … neutral …`; if its status !== 0, fall to the narrowed single-container form (source present in the SUT cage only), instead of asserting the standup succeeded. This removes the discovery-time probe run/exec while keeping both the full-topology and narrowed forms.

```
PROCEDURE subtest3_topology(name, endpoint):
  1. assert co-residency: execExists(name, SOURCE_FILE_IN_IMAGE) == true
  2. live withheld cross-check (item 4) — see below
  3. neutral = `faff-ci-neutral-${pid}`; docker rm -f neutral (best-effort)
     ran = docker run -d --name neutral node:20-alpine sleep 120  (status == 0?)
     IF ran:
       TRY: assert execExists(neutral, SOURCE) == false           # judge cannot see source
            assert execExists(name, SOURCE)   == true             # SUT legitimately holds it
       FINALLY: down(neutral)
     ELSE:
       assert execExists(name, SOURCE) == true                    # narrowed form
  4. assert wire round-trip reaches value over the bridge (unchanged, l.279-285)
```

Cross-reference: FAFF-1137 owns the general gate-ladder concurrency guard; this item is only the file-local discovery-time-probe half. Do not implement FAFF-1137 here.

### Item 4 — live withheld-set cross-check

Behaviour summary: assert the *persisted* verdict's attestation carries the withheld-set the real spawner produced, not a literal against itself.

The happy-path subtest (l.228-240) already runs the real spawner and writes `verdict.json` to `join(workdir, "verdict.json")`. The written envelope carries `attestation.withheld` derived by the real path `buildWithheldSet()` → `deriveAttestation(pf.holds, res.verdict, withheld)` → `assembleEnvelope` → written file (evaluate-call.mjs l.258-263, l.77, l.95).

```
# in subtest 3, replacing the inert l.250:
persisted = JSON.parse(readFileSync(join(workdir, "verdict.json"), "utf8"))
assert.deepEqual(persisted.attestation.withheld, buildWithheldSet(),
  "the persisted verdict's attestation carries the spawner-derived withheld-set")
```

The `spawnPayloadSeen`-keys assertion at l.249 (the real behavioural signal — the spawn payload carries no repo/cwd/diff) stays. This edit only upgrades the *second*, previously-inert line. It reads the verdict the happy-path subtest wrote; if that write is not guaranteed to precede subtest 3, read from `runSpawner`'s returned `verdict` captured earlier or re-run — the persisted file at the known `outPath` is the simplest tie to the real path.

**Anti-pattern:** asserting `buildWithheldSet()` against an inline literal. Why: it compares a constant to a copy of its own definition — it only "fails" on textual drift, carrying no runtime signal about whether the withheld-set actually reached the attestation.

### Failure modes

- **The failure:** the free-port TOCTOU race — another process binds the port between `srv.close()` and `docker run`, so `upBridge` fails. **How you'd know:** `upBridge` returns false and its `assert.ok` throws with the bridge-standup message; `dangling` stays clean because the container never started. **What it means:** proceed — this is the standard, accepted cheap mitigation; a rare collision surfaces as a clear standup failure, not a silent wrong result, and re-run clears it. Do not add retry/lock machinery for it.
- **The failure:** collapsing the probe build into the real `buildImage` could turn a "build not permitted" host into a RED failure instead of a skip. **How you'd know:** on a daemon-up-but-build-denied host, the test errors red rather than skipping. **What it means:** narrow — this is exactly why step 2b routes a `false` `buildImage` to `t.skip` + early return rather than `assert.ok`; verify that branch preserves the skip so honest degradation is not lost.

## 5. Scenarios

```
Given a docker-capable host where buildImage succeeds but upBridge's assert then throws
When the gated test body runs and hits the finally
Then the built image (tag) is removed, staging and workdir are removed, and dangling(name) is empty
```

```
Given the fixed host port would otherwise be taken
When the test allocates its host port via the node:net throwaway-server path
Then it binds a currently-free 127.0.0.1 port and the bridge stands up on it
```

```
Given a docker daemon is up
When node --test imports the module to enumerate tests
Then no docker build and no sibling container run/exec fire at discovery time (only docker info runs at module top level)
```

- The persisted meets-spec verdict's `attestation.withheld` MUST equal `buildWithheldSet()` (live cross-check, not a self-comparison).

## 6. DESIGN DECISION RATIONALE

**Item 1 — how to make teardown cover the setup-failure path?**
- *Move setup inside the `try` and guard each cleanup on its artifact's existence* — pros: every created artifact is torn down regardless of where setup stopped; minimal diff; matches the finally-safe/idempotent contract of `down`. Cons: a few more lines and existence guards.
- *Wrap setup in its own try/catch that best-effort tears down then rethrows* — pros: keeps the main `try` narrow. Cons: duplicates teardown logic in two places, more drift risk.
- **Chosen:** Move setup inside the `try` with existence-guarded cleanups — one teardown home, leak-free on every path.

**Item 2 — fixed vs dynamic host port?**
- *Keep fixed 18930* — pros: zero change, matches sibling test. Cons: collides under parallel/repeat runs, the observation being fixed.
- *`node:net` throwaway server on port 0* — pros: no new dependency, mirrors the in-process path already in this file, cheapest correct option. Cons: inherent close→run TOCTOU race.
- **Chosen:** `node:net` dynamic port. At the time of writing, no repo-wide free-port util exists; a shared util is deliberately out of scope. The TOCTOU race is the standard accepted trade-off for this pattern.

**Item 3 — where does the docker capability probe run?**
- *Keep the full probe at module top level (status quo)* — pros: `SKIP_E2E` knows build+sibling capability up front. Cons: a real build + sibling run/exec fire at test *discovery* on every live-daemon host — the observation being fixed; also the concurrency concern FAFF-1137 addresses generally.
- *Daemon-only top-level gate; defer build/sibling into the body* — pros: discovery is cheap (`docker info` only), matches the sibling test's l.20 pattern, removes a throwaway build entirely by reusing the real one. Cons: build/sibling capability is discovered later, requiring `t.skip`/narrow branches in the body.
- **Chosen:** Daemon-only top-level gate, deferred legs. FAFF-1137 owns the general ladder guard; this is only the file-local half.

**Item 4 — remove the inert assertion or make it live?**
- *(a) Remove it* — pros: simplest; the `spawnPayloadSeen`-keys line above already carries the real signal. Cons: drops the chance to verify the withheld-set actually flowed through the real spawner path.
- *(b) Live cross-check against the persisted verdict's `attestation.withheld`* — pros: ties `buildWithheldSet()` to the code path the spawner actually ran and the contract consumed (build → derive → assemble → write → read), converting an inert line into a genuine end-to-end check. Cons: reads the persisted verdict file, a small extra coupling in subtest 3.
- **Chosen:** (b) the live cross-check — it is strictly more informative than removal for a marginal cost, and the persisted verdict is already written by the happy-path subtest. Removal (a) is an acceptable weaker fallback if the persisted-verdict read proves awkward to sequence; the reviewer may accept either, but (b) is recommended.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. (Item 4's remove-vs-cross-check is closed to option (b); (a) is documented as an acceptable weaker fallback, not an open punt.)

**Assumptions:**

- **Assumes:** `upBridge` in `eval/bridge-fixture.mjs` already accepts `hostPort` as a parameter, so item 2 needs no helper change. Validation: confirm the `upBridge({ name, tag, hostPort, containerPort = 8080 })` signature at `eval/bridge-fixture.mjs` l.25 before editing; if a helper change is somehow needed, it is confined to that test-support file (still zero production change).
- **Assumes:** the happy-path subtest's `verdict.json` write at `join(workdir, "verdict.json")` completes before subtest 3 reads it (node:test runs `t.test` subtests sequentially in source order). Validation: confirm subtest ordering; if not guaranteed, capture the returned `verdict` from `runSpawner` in the enclosing scope and cross-check that instead of re-reading the file.

## 8. DONE — Definition of Done

### From WHY
- [ ] The test still skips cleanly (never RED) when the daemon is down, a build is not permitted, or a sibling container is not permitted.
- [ ] Zero production-code change: `evaluate-call.mjs`, `faff-bridge-node.mjs`, and all contracts are byte-unchanged; edits are confined to `test/holdout-rpc-evaluate-integration.test.mjs` (and only the helper `eval/bridge-fixture.mjs` if strictly required).

### From HOW (item 1 — teardown)
- [ ] `staging`, `workdir`, `buildImage`, and `upBridge` are inside the `try`; the `finally` tears down each of container, built image, `workdir`, `staging` guarded on that artifact's existence.
- [ ] On a simulated/real setup-failure after the build but before/at `upBridge`, no image, container, or temp dir leaks (verified via `dangling(name) === ""` and no residual `tag` image).

### From HOW (item 2 — dynamic port)
- [ ] The host port is obtained from a `node:net` throwaway server bound to `127.0.0.1:0`, read via `.address().port`, and closed before `docker run`.
- [ ] The literal `18930` no longer appears; `endpoint` and `upBridge`'s `hostPort` use the dynamic port.

### From HOW (item 3 — probe placement)
- [ ] Module top level runs only `docker info` for `SKIP_E2E`; `probeDocker()` and `CAP` are removed — no `docker build` or sibling run/exec fires at discovery time.
- [ ] The build capability is the real `buildImage(staging, tag)` in the body; `false` routes to `t.skip("docker build not permitted")` + early return.
- [ ] The sibling capability is detected by the neutral-cage `docker run` status inside subtest 3; failure falls to the narrowed single-container form.

### From HOW (item 4 — live cross-check)
- [ ] The inert `assert.deepEqual(buildWithheldSet(), {…literal…})` is replaced by `assert.deepEqual(persisted.attestation.withheld, buildWithheldSet())` reading the real written verdict.
- [ ] The `spawnPayloadSeen`-keys assertion (no repo/cwd/diff) is retained unchanged.

### Integration smoke test
```
PROCEDURE smoke():
  1. On a docker-capable host: run `node --test test/holdout-rpc-evaluate-integration.test.mjs`
  2. Expect: 3 top-level tests pass; the gated test's 4 subtests pass (7/7 total as today)
  3. Expect: after the run, `docker ps -aq --filter name=faff-ci-stack` is empty and no `faff-ci-stack` image remains
  4. On import alone (test discovery), observe no `docker build` / `docker run` beyond a single `docker info`
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. All four edits land in one 304-line file (`test/holdout-rpc-evaluate-integration.test.mjs`), share one origin (FAFF-1107's pre-PR review), and touch one cohesive concern — this test's own setup/teardown/probe/assertion lifecycle. None of the four independently clears the 1-3 day floor on its own, and bundling them avoids four micro-tickets for one file's lifecycle — right-sized as one ticket, nothing to split or merge out.

**Workstream fit?** No issues. FAFF-1138 carries no project (Backlog, no `project` field) — correct under the lens's Default landing default: a small, single-file test-hygiene follow-up with no standalone outcome doesn't earn a project container.

**Deps surfaced?** Issue — an asymmetric ordering relationship with FAFF-1137, not a `blockedBy`. FAFF-1137's own description lists "make docker-gated tests probe cheaply at discovery (`docker info` only) and defer any `docker build` to inside the gated test body" as a candidate direction, and names this file's module-top-level `probeDocker()` as a likely contributor to its starvation bug. FAFF-1138 doesn't need FAFF-1137 first (no `blockedBy`), and FAFF-1138-first is safe under any FAFF-1137 resolution. But FAFF-1137-first is safe only because FAFF-1137's prepped spec scopes this file's probe out (naming it FAFF-1138's) — so it will not touch these lines. What to do: keep item 3 in FAFF-1138 as scoped (the two are genuinely different-altitude fixes), and record the sequencing preference explicitly — FAFF-1138 before FAFF-1137, or if FAFF-1137 is picked up first its prep must check this file already reflects the daemon-only gate before choosing a general mechanism. (Recorded in OUT OF SCOPE above.)

**Risk profile?** No issues. All four edits are test-only with no production-code surface (no other file references `18930`, `probeDocker`, or the module-level `CAP`/`SKIP_E2E`). The two risk points are already de-risked in the spec: item 2's port-reuse TOCTOU race is named and accepted as a documented trade-off, and item 3's build-capability collapse is explicitly routed through `t.skip` + early return (not `assert.ok`) to preserve honest degradation. Item 4's sequencing assumption (subtest 2's `verdict.json` write precedes subtest 3's read) holds by construction (each `t.test()` is awaited in source order) with a documented fallback. No further de-risking warranted.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
