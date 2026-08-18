# ADR 0116 — A first-class transport slot for evaluator-SUT reachability

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-18
- **Issue:** FAFF-817

## Context

An evaluator judges a running system by reaching its endpoints. Those endpoints resolve to `http://localhost:PORT` today, because `composeGen`'s base host defaults to `localhost` (env.js). That default breaks the moment the evaluator and the system under build sit on different sides of a lane boundary — a docker-in-docker container inside a cage, or a different machine entirely. FAFF-791 built the re-basing seam (`composeGen(..., base)`) and FAFF-836 exposed it to the CLI via `--base-host`, but nothing yet resolves what that base host should be.

FAFF-817 originally framed this as "select and wire a concrete cross-machine transport" and left the choice as a human punt. In session, the human settled the punt: same-host-container reachability (docker-in-docker) and cross-machine reachability (Fly 6PN) are two instances of the same underlying question — what host does the evaluator use to reach the system under build across the lane boundary — not two separate problems. That reframing is what forces a slot rather than a single hard-wired mechanism: a future substrate (Tailscale, a cloud VPC, a Kubernetes ClusterIP) should not require touching the env occupant or the evaluator again.

The `transport` "network reachability" name collides with the pre-existing engine/model dispatch "transport" of ADR 0054 and ADR 0090. The two are unrelated concepts sharing a word; this ADR names the collision so a reader does not conflate them.

## Decision

Introduce a first-class `transport` slot, composed under the existing `env` slot. Given a provision context (`evaluator_topology: "co-resident" | "dind-in-cage" | "cross-machine"`, plus `substrate`), the occupant resolves and returns a base host the evaluator uses to reach the system under build, plus an optional `credentials` object and an optional `teardown` handle for any transient networking it created. The env occupant resolves `slots.transport` inline (session-model-pinned, per the evaluator→env precedent and ADR 0045 — there is no `models.transport` lane), invokes it mid-flow, and threads the returned base host through the existing `--base-host` seam before the compose-gen step. `composeGen` validates the value via `envValidateBaseHost` (the FAFF-818 positive allowlist) before any interpolation, so a foreign occupant's crafted value fails loud rather than reaching a shell.

The default trigger is deterministic: `base_host = "localhost"` iff `provision_context.evaluator_topology` is `"co-resident"` or absent — a switch on one enum field, never an inference — so the zero-config path reproduces today's compose-gen output byte-for-byte and the FAFF-791/FAFF-836 selftests stay green.

Ship one bundled reference occupant, `faffter-noon-transport-private-network`, covering the private-network reachability class (network-layer segmentation, no application-layer auth) with the substrate branch living inside the occupant rather than as separate REGISTRY rows. The first buildable instance is local docker-in-docker: the base host is the docker bridge host-gateway address the evaluator container uses to reach the orchestrator host. Fly 6PN is the second named instance of the same occupant (FAFF-851); it is documented so the occupant's shape accommodates it but is not built here.

The transport's result is consumed inline by the env occupant in the same turn and carries no independent trust boundary, so it returns a plain value with no new `faff-contract:transport-*` block, schema, or golden cases — the same documented-output posture as the `intake` and `adr` producers. The env-handle contract stays frozen: no `base`/`base.host` field is added; a resolved base is producer-internal and reaches endpoints only through `composeGen`. Any `credentials` a future occupant needs ride the handle's existing opaque `credentials` object; any `teardown` the transport returns folds into the handle's existing `teardown_ref`/`teardown_cmd` so one teardown removes the env and the transient transport artifacts together.

Registering the occupant touches four hand-synced tables in `validate-adapters.js` (`REGISTRY`, `SLOT_TYPES`, the `checksFor` conformance arm, and the `producer-transport` type token linking the two) plus `DEFAULTS`/the `config defaults --selftest` array in `config.js`, plus the gateway Slots-table row in `faff/SKILL.md` — all five in lockstep, or the conformance lint and `--is-bundled` disagree about what the slot is.

Per-request auth for future token/preview transport occupants, and where the evaluator's lane physically runs (FAFF-834's build-lane-isolation axis), are both out of scope: this slot is *how* a lane reaches the system under build, not *where* the lane runs or *how it authenticates once it gets there*.

## Consequences

- A future reachability mechanism (Tailscale, a cloud VPC, a Kubernetes ClusterIP behind a NetworkPolicy) is a new substrate branch inside `faffter-noon-transport-private-network`, or — if it needs application-layer credentials the private-network class doesn't — a new occupant satisfying the same slot contract. Neither requires touching `composeGen`, the env-handle schema, or the evaluator.
- The zero-config guarantee is now enforced by a single deterministic branch (`evaluator_topology` co-resident-or-absent → `localhost`) rather than by the slot being unset. A build that returns anything other than `localhost` under `co-resident` is a defect the FAFF-791/FAFF-836 selftests catch, not a silent drift.
- A base-known-after transport (a dynamically published host/port, an issued preview URL) is explicitly not supported by this slice's resolve-once-before-`env up` flow. Both first-slice instances (local-dind, Fly 6PN) are base-known-ahead; a base-known-after substrate needs a second resolution point inserted after `env up` and before handle emit — deferred until an occupant actually needs it.
- Cross-references: ADR 0031 (the env-handle contract and the env-slot provision-box interface, which this composes under), ADR 0033 (the evaluator slot and its code-blind trust boundary — the downstream consumer that reaches the system through the resolved base), and ADR 0045 (the slot-invocation transport rule, which places this resolver in the inline resolve-and-consume category rather than an Agent-tool dispatch).
- Terminology: this ADR's "transport" means network reachability across the lane boundary. It is unrelated to the engine/model dispatch "transport" named in ADR 0054 and ADR 0090; readers should not conflate the two.
