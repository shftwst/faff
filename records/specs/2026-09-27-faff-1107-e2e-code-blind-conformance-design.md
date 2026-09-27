# FAFF-1107 — End-to-end integration + code-blind conformance test (code-interface holdout path)

> Spec: faffter-dark-nlspec · 2026-09-27 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1107.

This is a buildable nlspec for **FAFF-1107**, the closing ticket of the code-blind-holdout-for-code-interfaces workstream. Audience: the build agent that will add the fixture, exerciser, and tests, plus the human reviewer who confirms the one open placement decision. Every runnable part this ticket depends on — the wire (FAFF-1102), manifest schema (FAFF-1103), Node bridge (FAFF-1104), env-code-interface slot (FAFF-1105), evaluator RPC prose (FAFF-1106), bridge per-request timeout (FAFF-1128) — is already merged to `main`. This ticket writes **no new production code**: it wires the merged pieces together for a code interface and *proves* the cage guarantee.

## 1. WHY — Problem and Principles

**The core model.** faff's code-blind holdout works because the code and the judge live in different containers, and the judge reaches the code only over a wire, so the judge's process never contains the source. For a *service* that wire is HTTP and the whole loop already ships and is tested end to end. For a *code interface* the wire is the session-RPC bridge (a small server that reflects the component beside it in the SUT cage). Every genuinely-new piece of that path is merged; **nothing yet drives the code-interface branch end to end, and nothing proves the bridge sits in the SUT cage and not the judge's.** That proof is this ticket.

**Problem statement.** The code-interface holdout path is assembled but unexercised: the shipped tests drive the bridge in-process (`realListen()` on an OS port), never in a real container through the env slot, and the topology precondition the wire doc names normative (`docs/reference/session-rpc-wire.md` §"Code-blindness precondition") is stated but unproven. This ticket stands the path up against a real containerised bridge and asserts the cage holds, so a regression that leaks source into the judge fails a test rather than shipping silently.

**Design principles** (each would reject an otherwise-valid implementation):

- **Prove, don't re-implement.** `holdout_step` is subject-agnostic by construction; the code-interface behaviour lives entirely in the `env` and `evaluator` producers. This ticket must change **zero** production code (no edit to `holdout_step` prose, `evaluate-call.mjs`, the bridge, the contracts, or the manifest lib). A DONE item that *modifies* one of those is a design failure — the deliverable is a proof, not a patch.
- **Topology is the normative observable.** The guarantee is "the bridge is co-resident with the SUT cage and never the judge's cage." The evaluator's own repo-absent signal (`faff evaluator-preflight`) is necessary but *not sufficient*: a bridge mis-placed into the judge's cage loads a built artifact that *is* the source, regaining code access while `accesses.repo` still reads absent. The proof must therefore observe container co-residency directly, not infer it from the repo-mount signal alone.
- **The judge is exercised over the wire only.** The stand-in exerciser this ticket adds must reach the component solely through the bridge's TCP endpoint (fetch to `/faff-rpc`), never through any filesystem path to the source — mirroring the code-blindness the shipped `holdout-exercise.mjs` already embodies for HTTP.
- **A thrown exception is evidence, not a fault.** The exerciser must read the two disjoint failure planes distinctly: a top-level `WireError` is infrastructure (`needs-human`); a `result.outcome=="threw"` `ThrownError` is evidence to assert on. Collapsing them is wrong.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/holdout-evaluate-integration.test.mjs` | Node/`node:test` | The docker-gated service-path integration test this mirrors for a code interface. |
| `test/helpers/holdout-exercise.mjs` | Node | HTTP-GET-only deterministic exerciser; the code-interface analogue is a new sibling. |
| `eval/docker-fixture.mjs` | Node | Shared `up/waitReady/down/dangling` container lifecycle; the bridge fixture extends this pattern. |
| `plugin/skills/faff/bin/faff-bridge-node.mjs` | Node | The SUT-cage bridge stood up in a real container here (currently only `realListen()` in-process). |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` | Node | The transport-opaque caged spawner; the end-to-end vehicle, driven unchanged with an injected exerciser. |
| `plugin/skills/faff/bin/lib/evaluator-preflight.js` | Node | The shipped `--repo-path` isolation probe reused for the evaluator-blindness leg of the topology proof. |
| `docs/reference/session-rpc-wire.md` | Markdown | Frozen wire spec; §"Conformance criteria" lists the six scenarios this ticket asserts live. |

**Scope statement.** This ticket sits at the terminal end of the code-interface workstream: it closes the loop the wire/manifest/bridge/env/evaluator tickets opened, and delivers no new runtime surface.

## 2. OUT OF SCOPE

- **Any change to `holdout_step`, `evaluate-call.mjs`, the bridge, `contract-defs.js`, or `manifest.js`.** — These are merged and subject-agnostic; the ticket proves them, and a change to them means the design was wrong. **Extension point:** none — these files stay byte-unchanged.
- **A reusable shipped `bridge-topology` CLI verb / primitive.** — The topology proof lives as test-level assertions over shipped primitives (`faff evaluator-preflight`, `docker exec`). A first-class reusable topology check is worth revisiting only when a *second* runtime adapter (beyond Node) lands and a common shape emerges. **Extension point:** a future `faff bridge-topology` verb or an `eval/bridge-topology.mjs` helper, factored out of this ticket's test assertions.
- **A Python (or any non-Node) fixture / runtime adapter.** — The only merged reflection adapter is `faff-bridge-node.mjs`. **Extension point:** FAFF-1104's per-runtime resolver + a sibling fixture under `test/fixtures/code-interface/<runtime>/`.
- **Running the real LLM `evaluator` / `env` producers headless.** — They cannot run in CI (same constraint that made `holdout-exercise.mjs` a deterministic stand-in). The exerciser + docker fixture stand in for their exercise/provision steps. **Extension point:** the greenfield cross-repo acceptance follow-up named in beep-boop §10b's de-risk note.
- **Rich-type marshalling beyond JSON.** — The wire's open question (`docs/reference/session-rpc-wire.md` §"Open question"); the fixture uses only JSON-representable values. **Extension point:** FAFF-1104's marshalling once a second runtime forces the choice.
- **Wiring topology enforcement into the live merge floor.** — This ticket *detects and proves*; it does not add a new blocking gate to graft/beep-boop. **Extension point:** a future ticket could promote a proven topology check into `holdout_step` step 3.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| SUT cage | The container that legitimately holds the component's source/built artifact; the bridge runs here. |
| Judge cage | The evaluator's container: code-blind, repo physically absent, reaches the SUT only over the wire. |
| Bridge fixture | A committed minimal Node component + its binding manifest + a Dockerfile, built into an image whose entrypoint is the bridge reflecting the component. |
| RPC exerciser | A deterministic, non-LLM test driver that speaks `open`/`call`/`call_static`/`close` over the wire and rolls criteria into a `holdout-verdict` shape — the code-interface sibling of `holdout-exercise.mjs`. |
| Topology proof | The assertion set establishing the bridge is co-resident with the SUT cage and the source is unreachable from the judge cage. |

**The committed fixture component** (a minimal, buildable Node package — new, not the bridge selftest's inline `Stack`):

```
RECORD FixtureComponent (test/fixtures/code-interface/):
  stack.mjs         # exports class Stack { push(x); pop()->x (throws TypeError on empty); size()->n }
                    #   plus a static util.drain(n)->2n  (call_static target)
  binding-manifest.json   # schema:1, runtime:"node", one Binding "Stack"
                          #   construction ctor arity{required:0}; instance_ops push/pop/size; static_ops util.drain
  Dockerfile        # bakes stack.mjs + faff-bridge-node.mjs + its lib/ + the manifest into ONE image;
                    #   CMD runs the bridge reflecting stack.mjs (source lives IN the image = SUT cage)
  package.json      # { "type": "module" }  (so .mjs + dynamic import resolve)

  CONSTRAINT the manifest names ONLY real symbols on stack.mjs and passes `faff manifest validate`
  CONSTRAINT the Stack maps 1:1 onto all six wire conformance scenarios (open/call/threw/unknown_session/close/call_static/unsupported_version)
```

**The evaluation-request artifact** the spawner consumes (already the shape `holdout_step` step 3 writes; the test assembles it for the code interface):

```
RECORD EvalRequest:
  spec:      Path        # the fixture's tiny DoD spec (Given/When/Then over the Stack + a DONE item)
  endpoint:  URL         # the bridge's published http://127.0.0.1:<port>/  (the wire's TCP host:port)
  intent:    Path        # a lane-boundary.json { lane:evaluator, container:own, accesses.repo:absent } — the cage promise
```

**The RPC exerciser surface** (deterministic stand-in; a test helper, never shipped behaviour):

```
INTERFACE holdout-rpc-exercise (test/helpers/holdout-rpc-exercise.mjs):
  rpc(endpoint, wireRequest) -> WireResponse
      # POST endpoint/faff-rpc with the JSON envelope; forwards optional Authorization header; returns parsed JSON
  runSequence(endpoint, steps[]) -> { results[], sessionsClosed:Boolean }
      # execute an ordered open/call/call_static/close script; ALWAYS close any opened session, even on assertion failure
  buildVerdict({ classified, endpoint, script }) -> holdout-verdict-shaped object
      # per criterion: prose -> needs-human; born-verifiable -> drive `script` over the wire, then:
      #   top-level error (WireError)      -> verdict:needs-human   (infra fault plane)
      #   result.outcome=="threw"          -> assert ThrownError{type,message} against the criterion -> met|unmet
      #   result.outcome=="returned"       -> assert result.value against the criterion            -> met|unmet
      # returns { aggregate (derived), code_blind:true, criteria[], violations:[] } — same shape holdout-exercise.mjs emits
```

**The bridge fixture lifecycle** (new `eval/bridge-fixture.mjs`, mirroring `eval/docker-fixture.mjs`; `docker-fixture.mjs` stays unchanged so the service path never regresses):

```
INTERFACE bridge-fixture (eval/bridge-fixture.mjs):
  buildImage(contextDir, tag) -> Boolean            # `docker build` the fixture image (bridge + component baked in)
  upBridge({ name, tag, hostPort, containerPort })  # `docker run -d` bound to 127.0.0.1:<hostPort>:<containerPort> (co-resident branch)
      -> Boolean
  execExists(name, path) -> Boolean                 # `docker exec <name> test -e <path>`  — source-present probe
  down(name); dangling(name); waitReady(endpoint)   # re-exported from docker-fixture.mjs (health GET /faff-rpc/health)
```

**Design decisions** are collected in §6; each carries its canonical marker there and its consequences below.

## 4. HOW — Behavior

**Architecture and approach.** Three test artifacts plus one committed fixture, all mirroring the shipped service-path shapes:

```
 committed fixture (SUT cage)          judge side (host process in CI)
 ┌───────────────────────────┐        ┌──────────────────────────────────────┐
 │ Dockerfile image:         │  wire  │ evaluate-call.mjs main()               │
 │   faff-bridge-node.mjs    │◄──TCP──┤   preflightFn := holds (caged, stubbed)│
 │   + lib/manifest.js       │ /faff- │   spawnFn := RPC exerciser (stand-in)  │
 │   + stack.mjs (SOURCE)    │  rpc   │   -> derives code_blind, stamps         │
 │   + binding-manifest.json │        │      attestation, WRITES the verdict    │
 └───────────────────────────┘        └──────────────────────────────────────┘
        source lives HERE                    source NEVER here (withheld-set)
```

**Behaviour summary.** The docker-gated test builds the fixture image (source baked into the SUT cage), stands the bridge up on a `127.0.0.1`-bound port, then runs the *real* `evaluate-call.mjs` spawner with an injected exerciser as its agentic-engine `spawnFn` — reproducing `holdout_step` step 3's PRESENT-cage-promise branch — and validates the written verdict through the *real* `faff contract holdout-verdict --require-spawner-attested`.

```
PROCEDURE code_interface_e2e(fixtureDir):     # the docker-gated integration test's happy path
  1. buildImage(fixtureDir, "faff-ci-stack"); assert ok
  2. `faff manifest validate --file <fixtureDir>/binding-manifest.json` exits 0
  3. upBridge({ name, tag:"faff-ci-stack", hostPort, containerPort:8080 }) bound to 127.0.0.1; assert ok
  4. assert waitReady("http://127.0.0.1:<hostPort>/faff-rpc/health")           # single bring-up + health poll
  5. classified := `faff dod classify --spec <fixture-spec> --json`.criteria    # real CLI boundary
     assert classified has >=1 born-verifiable criterion
  6. verdict := run evaluate-call.mjs main(argv, { preflightFn: ()=>({holds:true,refusals:[]}),
                                                   spawnFn: async (payload) => exerciseAndBuild(payload) })
       # argv: --spec <spec> --endpoint http://127.0.0.1:<hostPort>/ --intent <lane-boundary.json> --key TEST --out <tmp>
       # exerciseAndBuild drives the wire via the RPC exerciser and returns { status:"ok", verdict:<criteria+aggregate> }
  7. assert the written --out file: code_blind===true, spawner_attested===true, aggregate==="meets-spec"
  8. assert `faff contract holdout-verdict --require-spawner-attested` exits 0 on that file
  9. FINALLY: down(name); assert dangling(name)==="" (env torn down, no leak)
```

**Pseudocode — the topology proof** (the ticket's headline; asserts the normative observable directly):

```
PROCEDURE prove_cage_holds(bridgeName, sourcePathInImage, spawnPayloadSeen):
  1. Co-residency (SUT cage holds the source):
     assert execExists(bridgeName, sourcePathInImage) == true        # the component IS inside the bridge container
  2. Withheld-set (the judge is launched blind):
     assert spawnPayloadSeen has keys ⊆ { specText, endpoints, intentText, deadlineMs }   # NO repo path / cwd / diff
     assert buildWithheldSet() == { repo:true, worktree_cwd:true, diff:true }              # true by construction
  3. Judge cage cannot reach the source over the filesystem (the co-residency SPLIT):
     spin a NEUTRAL container (bare node image, source NOT mounted); then
       assert execExists(neutralName, sourcePathInImage) == false          # judge cage cannot see the source
       assert execExists(bridgeName,  sourcePathInImage) == true           # SUT cage legitimately holds it
       # `docker exec test -e` needs nothing installed in either container — the primary, always-feasible form.
       # Optional reuse leg (only where faff is on PATH in the cage, e.g. baked into the image): the same split
       # via `faff evaluator-preflight --repo-path <sourceDirInImage> --json` -> holds:true in neutral / refuses in bridge.
       #   NB the preflight leg needs a DIRECTORY path (its repo-absent check is isDirectory-gated), distinct from the
       #   file path execExists probes with `test -e`; the two legs must NOT share one path variable.
       # Do NOT run the host process as the judge vantage: the source is readable in the repo checkout, so the
       # host is not code-blind; the neutral container is the honest judge cage.
  4. Reachability despite invisibility:
     from the judge side, a wire round trip (open->call->close) SUCCEEDS against the endpoint
       # the code is reachable over the wire while unreadable on the judge's filesystem — the whole guarantee
```

**Edge cases and error handling.**

- **Docker capability insufficient** — the containerised test's skip predicate probes the capabilities this ticket actually needs, not merely a live daemon: `docker info` (daemon up), a trivial throwaway `docker build` (custom-image build allowed), and a bare-node sibling `docker run` + `docker exec` (sibling container + exec allowed). Any leg failing **skips** the containerised test cleanly — a skip is a valid outcome, never a RED flake — which is the honest degradation the topology proof depends on. Pure/fast assertions (manifest validity, exerciser plane-splitting against `realListen()` in-process) run ungated. When `docker build` is allowed but a sibling container is not, the narrowed single-container `execExists` form runs (source present in the bridge image, no neutral sibling); when even `docker build` is refused, the whole containerised test skips.
- **Bridge never healthy** — `waitReady` returns false; the test fails loudly (not a false green), and `finally` still tears the container down.
- **Neutral evaluator-cage container unavailable** (step 3 of the topology proof) — treat as part of the docker gate; if a nested/sibling container cannot be spawned in the CI runner, fall back to asserting the split via `execExists` on both containers (source present in bridge image, absent in a bare node image), which observes the same fact without invoking preflight remotely. See the failure mode below.
- **`evaluate-call.mjs` with no injected `spawnFn`** — the CLI path has no default engine (it returns `EXIT.OTHER` when `spawn` is not a function), so the test MUST inject one; this is a fact about the vehicle, not a defect to work around.
- **Two failure planes** — a `call` on a closed/unknown session returns top-level `error{code:"unknown_session"}` (the exerciser maps to `needs-human`); an empty `pop()` returns `result.outcome:"threw"` with `ThrownError{type:"TypeError"}` (the exerciser asserts on it). The exerciser must never conflate the two.

**Failure modes — how the approach could be wrong, and how you'd notice.**

- **The topology proof is vacuous.** — *The failure:* injecting `preflightFn:()=>holds` to stand in for the caged preflight (necessary because CI runs on an uncaged host) could make the test pass even if the bridge were mis-placed into the judge cage, because the injected preflight never observes real placement. *How you'd know:* the test would pass with the source reachable from the judge side — i.e. if step 1/3 of `prove_cage_holds` were dropped, a mis-placed-bridge mutant would not fail. *What it means:* the `execExists` co-residency split (present in bridge, absent in the neutral judge container) is the non-deferrable core of this ticket; the injected preflight alone proves nothing. Mutation check: temporarily bake the source into the *neutral* container and confirm step 3's `execExists(neutral, source)==false` assertion flips and fails.
- **CI cannot `docker build` or run a second sibling container.** — *The failure:* the runner may allow `docker run` of a public image (the service path only pulls `hashicorp/http-echo`) but forbid `docker build` or additional sibling containers. *How you'd know:* `buildImage` returns non-zero, or the neutral-container `docker run` fails, on the CI runner specifically. *What it means:* narrow — a `docker exec` presence probe on the bridge container alone (source present = SUT cage) plus the in-process withheld-set assertion still observes co-residency without a second container; defer the full neutral-container split behind the same docker gate. A skipped-but-honest test is a valid outcome; a fabricated pass is not.
- **The exerciser drifts from the real LLM evaluator's derivation.** — *The failure:* the deterministic exerciser encodes a fixed call script rather than deriving it from criterion text, so it could assert something the real evaluator would not. *How you'd know:* the emitted verdict passes `faff contract holdout-verdict` but the criteria don't match the wire doc's `derive_call_sequence` shape. *What it means:* proceed — this is the same accepted limitation as `holdout-exercise.mjs` (it proves *plumbing*, not judgement fidelity); the contract check is the backstop, and the fixture spec is kept explicit enough that the fixed script is the honest derivation.

**Anti-patterns.**

- **Anti-pattern:** editing `holdout_step`, `evaluate-call.mjs`, the bridge, or the contracts to make the code-interface path work. Why: the path is subject-agnostic by construction; a needed edit means a merged ticket was wrong, which is a new bug, not this ticket's work.
- **Anti-pattern:** planting the fixture manifest at the live default `.faff/binding-manifest.json`. Why: that path is faff's own project manifest; a Stack fixture there would misrepresent faff as exposing a code interface. (See the open question in §6/§7.)
- **Anti-pattern:** asserting code-blindness only via `accesses.repo:absent` / the injected preflight. Why: the wire doc names that necessary-but-insufficient; a mis-placed bridge defeats it. Observe container co-residency directly.
- **Anti-pattern:** driving the bridge with `realListen()` in-process and calling it "end to end". Why: that is FAFF-1104's coverage; this ticket's novelty is a *real container* stood up through the env-slot mechanism.

## 5. Scenarios

Born-verifiable main objectives for this ticket (the SUT is faff's own test suite + fixture; no holdouts are marked — faff has no provisionable code-interface env for its own holdout, and zero holdouts is valid here).

```
Given the committed fixture image (bridge + Stack source + manifest baked in) built and running on a 127.0.0.1 port
When the RPC exerciser sends open{target:"Stack"} then call{op:"push",args:[7]} then call{op:"pop"}
Then open returns result.outcome=="returned" with a fresh session_id
And the final call returns result.outcome=="returned" with value 7
```

```
Given a live session on the fixture Stack
When call{op:"pop"} is sent against an empty stack
Then the response carries top-level result (never top-level error)
And result.outcome=="threw" with ThrownError.type=="TypeError"
And a subsequent call on a closed/unknown session returns top-level error{code:"unknown_session"} (no result)
```

```
Given the fixture bridge serving wire "faff.session-rpc/1"
When a request tagged "faff.session-rpc/2" is sent, and separately call_static{op:"util.drain",args:[21]} is sent
Then the version-2 request returns top-level error{code:"unsupported_version"}
And call_static returns result.outcome=="returned" with value 42
```

```
Given a live session opened on the fixture Stack
When close{session_id} is sent twice in succession
Then the first close returns result.outcome=="returned"
And the second close still returns result.outcome=="returned" (idempotent no-op, never a top-level error)
```

```
Given the full code-interface path driven through the real evaluate-call.mjs spawner with an injected RPC exerciser
When the spawner runs against the running bridge with a lane-boundary intent present (PRESENT cage promise)
Then it writes a verdict with code_blind==true and spawner_attested==true
And `faff contract holdout-verdict --require-spawner-attested` exits 0 on that verdict with aggregate=="meets-spec"
```

```
Given the running fixture bridge container and a neutral node container with the source NOT mounted
When `docker exec test -e <component path>` checks the path in each container
Then the source path exists inside the bridge container (SUT cage co-residency)
And the source path is absent inside the neutral container (judge cage is code-blind)
And a wire round trip from the judge side against the endpoint still succeeds
```

```
Given a violating fixture (a Stack whose pop returns the wrong value, or a spec criterion the fixture cannot meet)
When the same end-to-end path runs
Then at least one criterion comes back unmet
And the aggregate is never "meets-spec"
And the verdict is still contract-valid (fails/gaps validates, guarding live-exercise fidelity)
```

```
Given the FAFF-1107 change set
When the merged production files are diffed
Then holdout_step (faff-beep-boop §10b, faff-graft Step 8c/10), evaluate-call.mjs, faff-bridge-node.mjs, contract-defs.js, and manifest.js are byte-unchanged
And every new file is a test, a test helper, or a committed fixture
```

## 6. DESIGN DECISION RATIONALE

**Which fixture component — a new minimal package, or promote the bridge's inline `Stack` selftest?**
- *New package:* clean SUT-cage artifact, buildable, doesn't couple the bridge's self-contained selftest to a committed package. Slightly more to write.
- *Promote the selftest `Stack`:* less code, but the selftest is deliberately self-contained (zero real listeners) and coupling it to a committed image/manifest would erode that.
- **Chosen:** a new minimal committed `Stack` package under `test/fixtures/code-interface/` — a Stack maps 1:1 onto all six wire scenarios and keeps the bridge selftest untouched.

**Where does the fixture's binding manifest live — the fixture dir, or the live `.faff/binding-manifest.json`?**
- *Fixture dir* (`test/fixtures/code-interface/binding-manifest.json`, passed explicitly): the manifest verb and bridge do no default-path resolution, so an explicit path works everywhere and nothing at the live default misleads real runs.
- *Live default `.faff/binding-manifest.json`* (as the ticket's synthesis literally names): matches the documented project location, but faff is a Node CLI that exposes no code interface for its own holdout, so a Stack manifest there is inert-but-misleading and could be picked up if a future run ever resolves that path.
- **Punt:** fixture-dir vs the live `.faff/binding-manifest.json` the ticket literally names — needs human (decides: architecture). *Recommended default for the builder:* the fixture dir; a reviewer who wants the literal live-path placement can override. Non-blocking either way — the path is passed explicitly, so the tests pass under both.

**How to exercise the wire in CI — a new RPC exerciser, or extend `holdout-exercise.mjs`?**
- *Extend the existing helper:* one file, but it is HTTP-GET-only (fetch + substring) with no session concept; bolting RPC onto it muddies the service-path driver.
- *New sibling helper:* clean separation, mirrors the precedent (`docker-fixture.mjs` was extracted rather than overloaded).
- **Chosen:** a new `test/helpers/holdout-rpc-exercise.mjs` that speaks the four methods and reads both failure planes; `holdout-exercise.mjs` stays HTTP-only.

**What vehicle proves "end to end through `holdout_step`" without an LLM?**
- *Script the SKILL prose steps by hand:* fragile, re-implements prose in a test.
- *Drive the real `evaluate-call.mjs` spawner with an injected exerciser as its `spawnFn`:* reproduces `holdout_step` step 3's PRESENT-cage-promise branch through the actual shipped spawner + the real `faff contract holdout-verdict`, so the subject-agnostic spine is proven, not narrated.
- **Chosen:** drive the real spawner (PRESENT branch) with an injected RPC-exerciser `spawnFn` and a stubbed passing `preflightFn`; validate the written verdict through the real contract with `--require-spawner-attested`.

**How is the topology guarantee proven?**
- *Repo-absent signal only:* insufficient per the wire doc — a mis-placed bridge defeats it.
- *Direct container co-residency observation:* the `execExists` split — source present inside the bridge container (SUT cage), absent inside a neutral container (judge cage) — plus a successful wire round trip from the judge side. `docker exec test -e` needs nothing installed in either container, so it is always feasible under the docker gate; `faff evaluator-preflight` is an optional reuse leg only where faff is on PATH in the cage (and only with a *directory* `--repo-path`, since its absent-check is directory-gated — never the file path the `test -e` probe uses).
- **Chosen:** the direct `execExists` co-residency split as the primary proof; no new CLI verb, no reliance on faff being installed inside a bare container. This is the non-deferrable core; the injected preflight alone proves nothing.

**Where does the bridge fixture lifecycle live?**
- *Overload `docker-fixture.mjs`* with build + bind-host + exec: risks regressing the service path that depends on its current shape.
- *New `eval/bridge-fixture.mjs`* re-exporting the shared `down/dangling/waitReady` and adding `buildImage`/`upBridge`/`execExists`: isolates the new behaviour.
- **Chosen:** a new `eval/bridge-fixture.mjs`; `docker-fixture.mjs` unchanged.

**How is "zero change to `holdout_step`" proven?**
- *Brittle prose-grep guard test* asserting no code-interface tokens in the SKILL: false-fails on legitimate doc edits.
- *A review-checkable DONE item + the integration test passing through the unchanged spawner:* the passing end-to-end run through the byte-unchanged `evaluate-call.mjs` and `faff contract holdout-verdict` is itself the proof; a scenario asserts the change set touches no production file.
- **Chosen:** the DONE item + passing-through-unchanged-spawner proof; no prose-grep guard.

**Why inject a passing `preflightFn` in the spawner path?**
- The CI host is uncaged (repo readable, not in a container), so the real in-cage preflight would refuse (exit 10) on every run and break the test. The preflight itself is unit-proven in `evaluator-preflight.js` `--selftest`, and its live wiring is FAFF-384's; placement is what this ticket proves, via the topology assertions, not via the injected preflight.
- **Chosen:** inject `preflightFn:()=>({holds:true})` for the spawner vehicle; carry the placement proof entirely in the topology assertion set (with the vacuous-proof failure mode named in §4).

## 7. Open Questions and Assumptions

**Open Questions.**

- **Fixture manifest location** (`**Punt:**` above, decides: architecture) — commit the fixture manifest at `test/fixtures/code-interface/binding-manifest.json` (recommended) or at the live default `.faff/binding-manifest.json` the ticket's synthesis literally names? The builder's default is the fixture dir; a reviewer can require the live path. The tests are unaffected (explicit path), so this does not block the build — it is a naming/hygiene call about faff's own repo.

**Assumptions.**

- **`**Assumes:**` CI provides a working Docker daemon** — the integration test is docker-gated exactly like `holdout-evaluate-integration.test.mjs`. *Validate:* `spawnSync("docker",["info"]).status === 0` gates the test; the pure exerciser/manifest assertions run without it. Confirm CI's docker allows `docker build` and (for the full topology proof) a sibling container; if not, take the narrowed `execExists`-both-images form (§4 failure mode).
- **`**Assumes:**` the bridge's relative import of `./lib/manifest.js` is preserved when baked into the fixture image** — `faff-bridge-node.mjs` resolves `./lib/manifest.js` via `createRequire`. *Validate:* the Dockerfile copies `faff-bridge-node.mjs` and its `lib/` into the same relative layout; the container's `/faff-rpc/health` returning 200 confirms the bridge loaded.
- **`**Assumes:**` `evaluate-call.mjs main()` accepts injected `preflightFn`/`spawnFn`/`writeFn`** — verified against the merged signature `main(argv, { preflightFn, spawnFn, writeFn })`. *Validate:* import and call it in the test; a missing `spawnFn` returns `EXIT.OTHER`, so the injection is required, not optional.
- **`**Assumes:**` `faff dod classify --spec - --json` yields `{criteria:[{class}]}`** — the shipped `holdout-exercise.mjs` already depends on this. *Validate:* the classify call in the test asserts `>=1` non-prose criterion before exercising.

## 8. DONE — Definition of Done

### From WHY
- [ ] The code-interface holdout path runs end to end against a *real containerised* bridge (not `realListen()` in-process), through the merged env/spawner/contract pieces.
- [ ] The cage guarantee (bridge co-resident with SUT cage, never the judge cage) is proven by a test, not merely asserted in prose.

### From OUT OF SCOPE (proven, not modified)
- [ ] `holdout_step` prose (faff-beep-boop §10b, faff-graft Step 8c and Step 10), `evaluate-call.mjs`, `faff-bridge-node.mjs`, `contract-defs.js` (`holdout-verdict`), and `manifest.js` are byte-unchanged in the FAFF-1107 change set.
- [ ] No new shipped CLI verb / production runtime surface is added; every new file is a test, a test helper, or a committed fixture.

### From WHAT (fixture + interfaces)
- [ ] `test/fixtures/code-interface/` holds a minimal buildable Node `Stack` package (`stack.mjs` with push/pop/size + static `util.drain`), a `binding-manifest.json`, a `Dockerfile` that bakes the bridge + its `lib/` + the source + the manifest into one image, and a `package.json`.
- [ ] `faff manifest validate --file <fixture manifest>` exits 0.
- [ ] `test/helpers/holdout-rpc-exercise.mjs` speaks `open`/`call`/`call_static`/`close`, forwards an optional `Authorization` header, always closes opened sessions, and reads the two failure planes distinctly (WireError → needs-human; `threw` ThrownError → asserted evidence).
- [ ] `eval/bridge-fixture.mjs` provides `buildImage`, `upBridge` (bound to `127.0.0.1`), and `execExists`, and re-exports `down`/`dangling`/`waitReady`; `eval/docker-fixture.mjs` is unchanged.

### From HOW (behaviour — the six wire conformance scenarios, live)
- [ ] `open` mints a session and a subsequent `call` returns the method's value (push 7 → pop returns 7), live over the containerised bridge.
- [ ] An empty `pop` returns `result.outcome=="threw"` with `ThrownError.type=="TypeError"` and no top-level `error`.
- [ ] `call` on a closed/unknown session returns top-level `error{code:"unknown_session"}` with no `result`.
- [ ] `close` is an idempotent returned no-op; a second `close` still returns `outcome:"returned"`.
- [ ] `call_static{op:"util.drain",args:[21]}` returns `result.value==42` with no session.
- [ ] A request tagged `faff.session-rpc/2` returns top-level `error{code:"unsupported_version"}`.

### From HOW (end-to-end + worked example)
- [ ] The real `evaluate-call.mjs` spawner, run with an injected RPC-exerciser `spawnFn` and a stubbed passing `preflightFn` against the running bridge with a lane-boundary intent present, writes a verdict with `code_blind===true` and `spawner_attested===true`.
- [ ] `faff contract holdout-verdict --require-spawner-attested` exits 0 on that verdict with `aggregate=="meets-spec"` (the worked example).
- [ ] A violating fixture yields `>=1` unmet criterion, an aggregate that is never `meets-spec`, and a still-contract-valid verdict.

### From HOW (topology proof)
- [ ] `execExists(bridge, <source path>)` is true (source co-resident with the SUT cage).
- [ ] The spawner's payload to the injected engine carries only `{specText, endpoints, intentText, deadlineMs}` — no repo path/cwd/diff — and `buildWithheldSet()` is `{repo:true, worktree_cwd:true, diff:true}`.
- [ ] `execExists(neutral container, <source path>)` is false while `execExists(bridge, <source path>)` is true — the co-residency split (optionally corroborated by `faff evaluator-preflight --repo-path` where faff is on PATH in the cage).
- [ ] A wire round trip (open→call→close) from the judge side succeeds against the endpoint despite the source being unreadable there.

### From HOW (edge cases)
- [ ] The containerised test's skip predicate probes daemon + `docker build` + sibling-container/`docker exec` capability (not `docker info` alone) and skips cleanly — never hard-fails RED — on any runner lacking one; the pure exerciser/manifest assertions run ungated, and the narrowed single-container `execExists` form runs when build is allowed but a sibling container is not.
- [ ] The container is torn down on every exit path and `dangling(name)===""` post-teardown (no leaked container).

**Integration smoke test** (the one path that says the plumbing is connected):

```
build fixture image -> upBridge on 127.0.0.1 -> waitReady(/faff-rpc/health)==true
  -> classify fixture spec -> run evaluate-call.mjs main() with injected exerciser spawnFn + holds preflightFn
  -> written verdict has code_blind:true, spawner_attested:true
  -> `faff contract holdout-verdict --require-spawner-attested` exits 0
  -> down(); dangling()==""
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (Principle 4)**

- **What's there.** One terminal ticket delivering four new artifacts (a committed `Stack` fixture: `stack.mjs` + `binding-manifest.json` + `Dockerfile` + `package.json`; the `holdout-rpc-exercise.mjs` helper; the `eval/bridge-fixture.mjs` lifecycle; and a docker-gated integration test carrying the six live wire scenarios, the real-spawner e2e proof, and the topology proof). Self-rated `build-tier: complex`, `confidence: medium`.
- **Why it sits at the ceiling.** This is at the top of the 1-3 day band: two of the artifacts (exerciser, bridge-fixture) mirror existing shapes cheaply, but the integration test bundles three distinct proofs and the topology proof is genuinely novel work. A reader could reasonably ask to split the headline topology proof from the conformance/e2e test.
- **What to do.** Do not split the deliverable. The three proofs all fire against a single fixture bring-up (one image, one running bridge container), so splitting would either duplicate the fixture and container lifecycle across two tickets or chain them on a serial blocker inside one workstream, for no sequencing gain. Keep it as one unit and instead carve off the novelty as a de-risking spike (see risk profile below), which is the honest place the size pressure comes from.

**Workstream fit? (Principles 1 + 5)**

No issues. The ticket is the terminal proof ticket of the code-blind-holdout-for-code-interfaces workstream, and it encodes exactly one outcome: the assembled code-interface holdout path is proven end to end and the cage guarantee holds. Naming it a "conformance test" is outcome-honest here rather than activity-named, because the deliverable genuinely is a proof (zero production code, per the design principles). The three internal proofs (wire conformance, e2e spawner, topology) converge on that single outcome, so cohesion holds.

**Deps surfaced? (Principle 6)**

- **What's there.** Every runnable prerequisite (FAFF-1102 wire, 1103 manifest schema, 1104 Node bridge, 1105 env-code-interface slot, 1106 evaluator RPC prose, 1128 bridge timeout) is named explicitly in WHY §1 and is already merged to `main`. Because they are Done, no open blocker link is needed for sequencing, so their absence as tracker edges is correct, not a gap.
- **One reference to confirm.** §6 states the live preflight wiring "is FAFF-384's" while this ticket injects a stubbed passing `preflightFn`. That reads as a contextual citation (explaining why the stub is used), not a genuine prerequisite: the ticket deliberately sidesteps live preflight and carries placement proof through the topology assertions instead.
- **What to do.** Confirm FAFF-384 is merged or otherwise not a runtime prerequisite, then leave it as prose context with no blocker link. If it turns out the stub masks a real dependency on FAFF-384's wiring, link it so routing stays honest; the spec's current framing says it does not, so no link is the expected outcome.

**Risk profile? (Principle 7)**

- **What's there.** The headline topology proof depends on two CI capabilities that the codebase has never exercised. The shipped service-path test (`test/holdout-evaluate-integration.test.mjs` + `eval/docker-fixture.mjs`) only `docker run`s a pre-built public image (`hashicorp/http-echo`) behind a `docker info` gate. It never `docker build`s a custom image and never spins a second sibling container. FAFF-1107 needs both: `buildImage` of the fixture, and a neutral sibling container for the `execExists` co-residency split. The spec surfaces this well (the "CI cannot docker build or run a second sibling container" failure mode, the narrowed `execExists`-both-images fallback, the vacuous-proof mutation check).
- **Why it matters.** This unknown lands at the very end of a six-ticket chain, which is exactly the risk placement Principle 7 warns against: the whole workstream's closing proof is the first thing to test whether the runner permits `docker build` and sibling containers. If it does not, the headline cage guarantee silently degrades to the narrowed single-container form, and the outcome the workstream promised (a directly-observed co-residency split) is weakened at the moment there is no runway left to react.
- **What to do.** Split a small de-risking spike ahead of the full build: a throwaway CI probe that does nothing but `docker build` a trivial image, `docker run` a sibling bare-node container, and `docker exec test -e` in each, to confirm the runner allows both before the fixture, exerciser, and test are written against that assumption. This is minutes of work versus discovering the constraint a day into the complex ticket, it directly answers the size pressure noted under right-sizing, and it converts the spec's contingency fallback from a mid-build surprise into a known input. Keep the mutation check (baking source into the neutral container to confirm the `execExists(neutral, source)==false` assertion flips) as the guard against a vacuous proof.

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "punt" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
