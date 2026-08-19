# FAFF-869 — transport `dind-in-cage`: prefer the shared user-defined network under rootless docker

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-869.

This is the design spec for FAFF-869, addressed to the build agent editing the `transport` occupant and to human reviewers. It is a **prose-only** change to one skill file: `plugin/skills/faffter-noon-transport-private-network/SKILL.md`. No CLI code, test, or config moves.

## 1. WHY — Problem and Principles

**The load-bearing model.** A docker engine running **rootless** publishes host ports inside its own rootlesskit network namespace. The bridge gateway address (`172.17.0.1`, a.k.a. `host.docker.internal`) therefore does **not** route from a *sibling* container to a host-published port — the two mechanisms the `dind-in-cage` branch documents are not interchangeable under rootless: only shared network-membership routes.

**Problem statement.** The `transport` occupant's `dind-in-cage` branch currently presents host-gateway and a shared user-defined docker network as two equivalent ways to resolve the evaluator→SUT base host. Human verification of FAFF-817 on a rootless engine (Docker 29.7.2, rootless) proved they are not equivalent: the host-gateway path returned HTTP `000` (no connection) while the shared-network path returned HTTP `200`. Left as-is, the prose invites an implementer (or a future test) to pick the host-gateway mechanism on a rootless engine and silently fail to reach the SUT. This change makes the branch **select the shared user-defined network when a rootless engine is detected**, rather than host-gateway.

**Design principles.**

- **Preserve the occupant's contract surface.** `faff validate-adapters` (`producer-transport` case) asserts this occupant names its `transport` slot, documents *returning a resolved base host for evaluator→SUT reachability*, and carries **no** `faff-contract:` block. The edit must keep all three intact — the `base_host`-return framing and the inline-consume posture are load-bearing, not incidental.
- **No behaviour change for rootful engines.** Host-gateway stays a documented, valid path where it actually routes (a rootful engine). The change conditions the *choice*, it does not delete the host-gateway mechanism.
- **Detection is prose, not code.** This occupant is LLM-followed prose. "A rootless engine is detected" is a prose instruction to the resolving agent (read the engine's rootless posture from `docker info`), not a new CLI branch — consistent with the base-host resolution already being prose, not a code path.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-transport-private-network/SKILL.md` | Markdown (skill prose) | The occupant being edited — the `resolve()` `dind-in-cage` arm and the `## What it does` framing. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (`producer-transport`, ll. 427–435) | JS | The lint asserting the three properties above; the edit must keep it green. |
| `plugin/skills/faff/bin/lib/env.js` (`envValidateBaseHost`, `envResolveBase`, `composeGen`) | JS | Validates/resolves-precedence the base host; does **not** select the reachability mechanism — confirms the fix is prose-only. |
| `records/specs/2026-08-18-FAFF-817-...-design.md` | Markdown | The predecessor spec; its A1–A3 smoke assertions are the reachability evidence this fix acts on. |

**Scope statement.** A follow-on hardening of the FAFF-817 `transport` slot's first (local-dind) instance, sharpening one branch of its resolution prose; it does not touch the co-resident or cross-machine arms.

## 2. OUT OF SCOPE

- **A CLI rootless-detection helper / code branch** — Why excluded: the occupant resolves base host in prose, not code; adding a code path is a different design. Extension point: if a deterministic helper is later wanted, it would live in `plugin/skills/faff/bin/lib/env.js` alongside `envResolveBase` and be surfaced to the occupant as an input field.
- **Building the automated reachability test matrix (the FAFF-817 B1 proof)** — Why excluded: B1 is explicitly downstream of FAFF-817 / FAFF-834 and not a DONE item of this ticket. Extension point: this spec only requires the occupant *document* that the matrix must pin the shared-network branch under rootless; the matrix itself is authored under the B1/FAFF-834 lane.
- **The `cross-machine` (Fly 6PN) arm and the `co-resident` localhost arm** — Why excluded: rootless routing is specific to the docker-bridge substrate of `dind-in-cage`. Extension point: those arms are untouched in the same `resolve()` procedure.
- **Reverting or re-proving PR #705** — Why excluded: PR #705 already landed with reachability proven via the shared-network branch; this is the documented follow-on, not a fix to shipped code.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Rootless engine | A docker engine running without root (rootlesskit), publishing host ports inside its own network namespace. Detected from `docker info` (e.g. the `rootless` security option / `Context: rootless`). |
| Host-gateway mechanism | Resolving `base_host` to the docker bridge host-gateway address (`host.docker.internal` / `172.17.0.1`), reachable from a sibling container **only under a rootful engine**. |
| Shared-network mechanism | The occupant attaches SUT and evaluator to one user-defined docker network; the evaluator reaches the SUT by network alias (e.g. `http://sut:80`). Routes under **both** rootful and rootless engines. |

**The edited interface is prose, not a type.** No `provision_context` field, no return-shape field, and no `faff-contract` block changes. The `resolve()` return stays exactly `{ base_host, credentials, teardown }`; the `dind-in-cage` arm still returns a resolved `base_host` string. What changes is *which mechanism the branch selects* and the framing around it.

**Design decision — how the branch selects.**

The `dind-in-cage` branch stops presenting the two mechanisms as interchangeable and instead selects on the engine's rootless posture:

- **Rootless engine detected → shared user-defined network.** SUT + evaluator join a network this occupant creates; `base_host` is the SUT's network alias; the created network folds into `teardown`.
- **Rootful engine → host-gateway remains valid** (`host.docker.internal` / the bridge host-gateway), unchanged; no network created, so `teardown = none`.

**Chosen:** condition the mechanism on rootless detection (shared-network under rootless, host-gateway under rootful) — rather than switching the branch to shared-network *unconditionally*. Rationale in §6.

## 4. HOW — Behavior

**Architecture and approach.** The change is localised to the `dind-in-cage` arm of the `resolve()` pseudocode plus the one-line `## What it does` framing that currently calls the substrate "the docker bridge" path. The co-resident and cross-machine arms, the Inputs, Output, and the closing `base_host` / `composeGen` validation paragraph are untouched.

**Revised `dind-in-cage` arm (shape — the build agent writes the final prose).**

```
IF provision_context.evaluator_topology == "dind-in-cage":                 # local-dind — this slice
   # The system under build runs on the orchestrator host (`faff env up`); the evaluator runs in a
   # docker-in-docker container inside the cage. TWO substrate mechanisms, NOT interchangeable:
   #   - host-gateway (host.docker.internal / bridge 172.17.0.1) — routes only under a ROOTFUL engine
   #   - a shared user-defined docker network (both sides join; evaluator reaches the SUT by alias) —
   #     routes under BOTH rootful and rootless
   IF the docker engine is rootless (detected from `docker info`: rootless security option / context):
      base_host = the SUT's alias on a shared user-defined network this occupant attaches both sides to
      teardown  = { ref, cmd } removing that user-defined network
      # host-gateway does NOT route under rootless: rootlesskit publishes host ports inside its own
      # netns, so the bridge gateway is unreachable from a sibling container.
   ELSE (rootful engine):
      base_host = the docker bridge host-gateway address (host.docker.internal, --add-host host-gateway)
      teardown  = none                                     # host-gateway is ambient; nothing created
   credentials = none                                       # network-layer segmentation only
   RETURN { base_host, credentials, teardown }
```

**Behaviour summary.** On a rootless engine the branch resolves `base_host` to a shared-network alias and records the created network for teardown; on a rootful engine it keeps today's host-gateway resolution with no teardown. Either way it returns a resolved `base_host` that must still pass `envValidateBaseHost` before use — the closing validation paragraph is unchanged.

**Downstream note the occupant must carry.** Add a short note (prose, not a new `resolve()` branch) that the future automated reachability test matrix — the FAFF-817 B1 proof, downstream of FAFF-834 — must **pin the shared-network branch under rootless**, because a naive host-gateway assertion would fail in the `env-rootless` CI job. This preserves the ticket's "downstream point" without pulling B1 into scope.

**Failure modes.**

- **The failure:** rootless detection is wrong (false-negative) and the branch picks host-gateway on a rootless engine. **How you'd know:** the evaluator's reachability probe returns HTTP `000` / connection-refused against the host-gateway address while `localhost` on the host is healthy — exactly the FAFF-817 A2 signature. **What it means:** the detection prose is too narrow; widen the `docker info` signal it keys off. Because the shared-network mechanism routes under *both* postures, a false-*positive* (picking shared-network on a rootful engine) is harmless — it still reaches the SUT — which is why the safe-direction bias favours shared-network when detection is ambiguous.

**Anti-pattern:** deleting the host-gateway mechanism from the branch. Why: rootful engines route it fine and the occupant is meant to document both mechanisms of the private-network class; delete it and rootful reachability loses its documented, teardown-free path.

**Anti-pattern:** adding a `faff-contract:` block or a new `provision_context` field to carry the rootless signal. Why: the occupant is inline-consumed with no gated contract (a `validate-adapters` invariant); the rootless posture is read at resolve time from the engine, not threaded as a contract field.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a rootless docker engine and evaluator_topology == "dind-in-cage"
When the transport occupant's resolve() runs (its prose is followed)
Then it selects the shared user-defined network mechanism (base_host = the SUT's network alias),
     and records the created network in teardown — never the host-gateway address
```

```
Given a rootful docker engine and evaluator_topology == "dind-in-cage"
When resolve() runs
Then the host-gateway mechanism is still selected and documented (base_host = host.docker.internal /
     the bridge host-gateway), with teardown = none — no behaviour change for rootful engines
```

- The edited `SKILL.md` still passes `faff validate-adapters` with the `producer-transport` case green: it names its `transport` slot, documents returning a resolved base host for evaluator→SUT reachability, and carries no `faff-contract:` block.
- The file stays within the shared `line cap` (600) and `paragraph` (200-word) lint ceilings, with no stray markers.

## 6. DESIGN DECISION RATIONALE

**Condition the mechanism on rootless detection, or switch to shared-network unconditionally?**

- *Options.* (a) **Conditional select** — shared-network under rootless, host-gateway under rootful. (b) **Unconditional shared-network** — always create a shared network, drop host-gateway from the branch.
- *Trade-offs.* (b) is simpler prose and always routes, but it deletes a documented mechanism, changes rootful behaviour (now always creating + tearing down a network where none was needed), and loses the teardown-free host-gateway path the FAFF-817 design deliberately kept as base-known-ahead-with-nothing-transient.
- **Chosen:** (a) conditional select — it matches the ticket's directive ("prefer/select the shared-user-defined-network mechanism when a rootless engine is detected, rather than host-gateway"), keeps host-gateway valid and documented for rootful engines (zero regression there), and confines the change to the failing case. The safe-direction bias (§4 failure modes) means an ambiguous detection resolves *toward* shared-network, so correctness does not hinge on perfect rootless detection.

**Where does rootless detection live?**

- *Options.* A CLI helper in `env.js`; or prose instructing the resolving agent to read `docker info`.
- **Chosen:** prose reading `docker info` (rootless security option / context) — the occupant already resolves base host in prose, not code, and adding a CLI branch is out of scope (§2). Temporal anchor: at the time of writing, `container-check.js` has no rootless→mechanism helper to reuse; if one is later added, the occupant can key off it instead of `docker info`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the RCA, the failing/passing evidence, and the directive are all settled in the ticket.

**Assumptions.**

- **Assumes:** the `validate-adapters.js` `producer-transport` assertions (names `transport` slot; documents returning a resolved base host; carries no `faff-contract:` block) are still the three checks in force. Validation: before editing, re-read `plugin/skills/faff/bin/lib/validate-adapters.js` ll. 427–435, then run `faff validate-adapters` and confirm the `faffter-noon-transport-private-network` line is `pass`.
- **Assumes:** the SUT is reachable by a stable network alias on a user-defined network the occupant creates (the FAFF-817 A2 shared-network path that returned HTTP 200). Validation: the FAFF-817 human-verification run already demonstrated `http://sut:80/health` → 200 under rootless; no re-proof needed for this doc change.

## 8. DONE — Definition of Done

### From WHY
- [ ] The `dind-in-cage` branch no longer presents host-gateway and shared-network as interchangeable; it selects the shared user-defined network when a rootless engine is detected, and states *why* host-gateway does not route under rootless (rootlesskit netns).

### From WHAT / HOW (behaviour)
- [ ] Under a detected rootless engine the branch resolves `base_host` to the SUT's shared-network alias and folds the created network into `teardown`.
- [ ] Under a rootful engine the branch keeps today's host-gateway resolution unchanged (`base_host` = host-gateway, `teardown = none`).
- [ ] Rootless detection is expressed as prose (read from `docker info`), not a new CLI code branch or a new `provision_context` / contract field.
- [ ] The occupant carries a downstream note that the future automated reachability test matrix (FAFF-817 B1, downstream of FAFF-834) must pin the shared-network branch under rootless, else a naive host-gateway test fails the `env-rootless` CI job.

### From constraints (contract + lint preservation)
- [ ] `faff validate-adapters` passes with `faffter-noon-transport-private-network` green — the `transport`-slot name, the resolved-`base_host` documentation, and the no-`faff-contract:`-block property are all preserved.
- [ ] The file stays within the `line cap` (600) and `paragraph` (200-word) ceilings with no stray markers; the co-resident and cross-machine arms, Inputs, Output, and the closing `envValidateBaseHost` paragraph are unchanged.

**Integration smoke test:**

```
1. Edit plugin/skills/faffter-noon-transport-private-network/SKILL.md (dind-in-cage arm + framing + downstream note).
2. Run `faff validate-adapters`; ASSERT the faffter-noon-transport-private-network line is `pass`.
3. Read the edited dind-in-cage arm back; ASSERT it names rootless detection → shared-network selection and
   retains host-gateway for the rootful path.
```

confidence: high
build-tier: standard
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```
