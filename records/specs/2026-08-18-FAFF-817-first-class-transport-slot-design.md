# Spec — FAFF-817: a first-class `transport` slot for evaluator→SUT reachability across the lane boundary (local-dind first slice)

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-817.

> **Revised 2026-08-17 (iterate round 1)** — folded the spec-review QA lens: pinned the deterministic byte-identity trigger (`provision_context.evaluator_topology`), added a foreign-occupant validation-hardening principle, added the malformed-base and teardown DONE criteria, and scoped the integration smoke test (verifiable-now A1–A3 with concrete oracles; the full evaluator-in-dind proof B1 deferred to FAFF-834). The architectural and infosec "blockers" were dismissed on source evidence (the `producer-adr` no-contract-block precedent; the `envValidateBaseHost` positive allowlist). Round-2 spec-review: **approve** (all three lenses converged).

This is the build spec for FAFF-817 ("Select and wire a concrete cross-machine transport for the routable env base"), written for the coding agent that will implement it and for the human reviewers who will read it before the merge gate. It supersedes the earlier "Slice 2" spec attached to this ticket: that spec left the transport choice as an open, human-owned punt. Two decisions the earlier spec waited on have since been settled by the human in session (which transport, and the missing consumer), so this spec closes them and reframes the work. The reframing is the load-bearing idea: FAFF-817's literal title says "cross-machine transport", but same-host-container reachability and cross-machine reachability are two instances of one problem, so the ticket now introduces a general `transport` slot and ships the most common instance first.

The two tickets this consumes are both Done: FAFF-791 (the routable env producer that split the evaluator-facing endpoint into a per-service relative surface plus a single base host, and made `composeGen` resolve them at provision time) and FAFF-836 (the transport-neutral wiring that exposed that base to the CLI via `--base-host` and a `.faffrc` `env.base_host` fallback). This ticket fills the base with a real off-host mechanism and generalises the seam that supplies it.

## 1. WHY — problem and principles

**The load-bearing model.** An evaluator judges a running system by reaching its endpoints. Today those endpoints are `http://localhost:PORT`, reachable only from the same host, because `composeGen`'s base host defaults to `localhost`. The moment the evaluator and the system under build sit on different sides of a boundary (a docker-in-docker container inside a cage, or a different machine), `localhost` no longer resolves to the system. Something has to answer one question at provision time: what host does the evaluator use to reach the system under build across that boundary? This ticket makes that question a named slot, the `transport` slot, composed underneath the existing `env` slot. The env provisioner asks the transport for a base host and threads it through the `--base-host` seam FAFF-836 already built.

**Problem statement.** The env producer emits localhost-only endpoints, so a topologically-separated evaluator cannot reach the system under build. A routable base is wireable (FAFF-836) but nothing resolves one. This ticket adds the `transport` slot that resolves the reachable base host across the lane boundary, and ships the local docker-in-docker instance as the first buildable consumer.

**Design principles.**

**One slot, many instances, all substrate-specifics inside the occupant.** "Only the evaluator can reach it" is discharged one way here: the system under build sits on a private network, the evaluator is a member of that network, and network-layer segmentation satisfies the requirement with no application-layer auth. That is a single reachability class. Local docker-in-docker over the docker bridge, Fly private networking over the 6PN IPv6 mesh, Tailscale, a cloud VPC, and a Kubernetes ClusterIP behind a NetworkPolicy are all instances of that one class on different substrates. The occupant owns the substrate branching; the slot contract and the env provisioner never learn which substrate is in play.

**The default path stays byte-identical.** With no separated evaluator in the provision context, the transport resolves the base host to `localhost`, so `composeGen` produces the same output it produces today and the FAFF-791 and FAFF-836 compose-gen selftests stay green. Nothing this ticket adds may change the zero-config output.

**The env-handle contract is frozen.** `env-handle.schema.json` is `additionalProperties:false` and carries no base field, and this ticket adds none. The resolved base host is a producer-internal value the env occupant folds into the endpoints it already emits; a raw `base` field in a producer block is silently dropped by `computeEnvHandle`, so adding one would be dead weight. Auth, when a future occupant needs it, rides the existing opaque `credentials` object, not a new field.

**A swapped-in occupant is not trusted to self-validate.** The `transport` slot is swappable, so a foreign occupant could return anything as `base_host`. It never reaches a shell or a compose file unchecked: the env occupant passes it through the existing `--base-host` seam, and `composeGen` validates it via `envValidateBaseHost` (env.js:352 — the FAFF-818 positive allowlist: `^[A-Za-z0-9.-]+$` for a bare host, or a bracketed IPv6, nothing else) *before* any interpolation into an endpoint string. A crafted value such as `localhost; rm -rf /` or `$(curl evil)` fails that allowlist and `composeGen` fails loud, emitting no compose file — so the slot's swappability introduces no command-injection surface. Any `credentials`/`teardown` a foreign occupant returns are treated as opaque data: the `teardown_cmd` runs as a trusted-source command exactly like the existing env `teardown_cmd` (the occupant is operator-configured, hence inside faff's trust boundary), never shell-evaluated as free-text from an untrusted source.

**A slot is four hand-synced tables plus one prose row.** Registering an occupant means touching every one of them in lockstep, or the conformance lint and the `--is-bundled` predicate disagree about what the slot is. The HOW section lists all five edits; skipping any one is a build defect, not a follow-up.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/env.js` — `envResolveEndpoint` (:366), `composeGen(profile, projectName, outPath, appOverride, base)` (:382), base validated at :443 | The re-basing seam (FAFF-791). A non-default `base.host` re-bases every service endpoint; the default `localhost` reproduces today's strings exactly. |
| `env.js` — `envResolveBase(flagVal, cfgEnv)` (:373), `--base-host` flag (:28), threaded at the `compose-gen` handler (:686/:688) and the `up` handler (:709/:711) | The CLI/config seam (FAFF-836, Done). The transport-resolved host flows through `--base-host`; no env.js code change is needed for the first slice. |
| `env.js` — `envValidateBaseHost` (:352) | The sole base-host validator: a bare hostname or IP literal, or a bracketed IPv6 (`[::1]`). Every transport-resolved base passes through it unchanged. Hardened to a positive allowlist by FAFF-818. |
| `plugin/skills/faffter-noon-env-compose/SKILL.md` — "How it provisions" (:25 onward), the compose-gen step (:30) | The env provisioner. Line 30 already forward-references "a transport can later re-base the same surfaces off-host without changing the handle's shape". The `slots.transport` resolve-and-consume step is a net-new addition here, inserted before the compose-gen step. |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` — env-slot resolve-and-consume (:29, :36, :41) | The house precedent for slot-under-slot: the evaluator resolves `faff config get slots.env` mid-flow, consumes the handle, and owns teardown on every exit path. The env→transport wiring follows this exact inline, session-pinned pattern. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` — `REGISTRY` (:14), `checksFor` switch (:331), `SLOT_TYPES` (:310), `cmdIsBundled` (:611), `readJudgementSeam` (:169), C1 seam gate (:983) | The slot-registration machinery. A new occupant is a REGISTRY row, a `checksFor` arm, a SLOT_TYPES row, and (for classification) a matching `producer-transport` token on both the REGISTRY and SLOT_TYPES sides. |
| `plugin/skills/faff/bin/lib/config.js` — `DEFAULTS` (:60), `config defaults --selftest` expected array (:1906) | The runtime default resolver and its coverage selftest. `config get slots.<name>` is generic; no per-slot code. |
| `plugin/skills/faff/SKILL.md` — the Slots table (:232, env row :238) | The gateway prose home for the slot roster. A `transport` row goes here. |
| `scripts/link-skills.sh` — directory scan (:243) | Install is by directory scan, no manifest. A new `plugin/skills/faffter-noon-transport-private-network/` directory is auto-discovered. |
| `records/adr/0031-…env-handle-contract…`, `records/adr/0033-…evaluator-slot…`, `records/adr/0045-…slot-invocation-transport-rule…` | The env-handle interface, the evaluator trust boundary, and the rule for resolving a slot inline vs dispatching a producer subagent. This ticket promotes an ADR that cross-references all three. |

**Scope statement.** This sits in the provision box of faff's propose → provision → seed → evaluate pipeline: FAFF-791 built the re-basing seam, FAFF-836 exposed it to the CLI, and this ticket adds the slot that resolves what the base host should be for the evaluator to reach the system across the lane boundary.

## 2. OUT OF SCOPE

- **The Fly 6PN instance.** Cross-machine reachability where the base host is the system's private 6PN IPv6 address is the second named instance of the same occupant, a follow-on within `faffter-noon-transport-private-network`, not a separate occupant. It is documented here so the occupant's shape accommodates it, but it is not built in the first slice and the slice is not gated on it. **Extension point:** a substrate branch inside `faffter-noon-transport-private-network` selected by provision context, alongside the local-dind branch. *(Tracked as a follow-on ticket that `blocks` FAFF-790.)*
- **Per-request auth and any evaluator change for it.** The private-network class needs no application-layer credential on the request, so `faffter-noon-evaluate` is not modified in this ticket. Reading `credentials` off the handle and attaching it per request is a named follow-on tied to future token or preview transport occupants. **Extension point:** `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` `parseArgs` plus spawn payload plus the evaluator's exercise step, wired only when a token/preview occupant lands. *(Tracked as a follow-on ticket.)*
- **The base-known-after second resolution point.** A transport whose routable base is known only after `env up` (a dynamically-published host/port, an issued preview URL) needs the resolver re-invoked with the discovered base before the handle is emitted. Both first-slice instances (local-dind and Fly 6PN) are base-known-ahead, so this slice does not build it. **Extension point:** a second resolution call in the env occupant's "How it provisions" procedure, after `env up` and before handle emit, gated on the occupant declaring itself base-known-after.
- **A new env-handle contract block or schema change.** The handle shape is frozen; no `base`/`base.host` field, ever. **Extension point:** none; the resolved base is internal to the env occupant.
- **Build-lane isolation (FAFF-834).** Where the evaluator lane runs (an evaluator-as-dind-container rung inside the cage) is a separate axis. This slot is how that container reaches the system under build. The two axes meet at the dind case but are not the same decision. **Extension point:** FAFF-834 owns the container-in-cage rung; this slot owns reachability into it.
- **Proving cross-machine reachability end to end.** FAFF-790 (the proof of a topologically-separated evaluator on an ephemeral Fly machine) is the proof consumer of the Fly 6PN instance, not a selftest here. This ticket unblocks it (via the Fly-6PN follow-on).

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Lane boundary | The separation between the evaluator and the system under build: same host but different container (docker-in-docker), or different machines. Reachability across it is what the transport resolves. |
| `transport` slot | The new first-class slot, composed under `env`, whose occupant resolves the base host the evaluator uses to reach the system under build across the lane boundary. |
| Private-network reachability class | The class where the system sits on a private network, the evaluator is a member, and network-layer segmentation alone satisfies "only the evaluator can reach it". No application-layer auth. |
| local-dind instance | The first-slice instance: the system runs on the orchestrator host (via `faff env up`), the evaluator runs in a docker-in-docker container inside the cage, and the base host is the docker bridge host-gateway address the evaluator container uses to reach the host. |
| Base-known-ahead vs base-known-after | Whether the routable base is knowable before `env up` (a well-known host-gateway, a static 6PN address) or only after provisioning (a dynamically-published host/port). local-dind and Fly 6PN are both ahead. |

**The `transport` slot contract.** Given a provision context, the occupant resolves and returns the base host the evaluator uses to reach the system under build, plus an optional credentials object and a teardown handle for any transient networking or credential the transport created.

```
INTERFACE transport (resolve-and-consume, inline; no gated contract block):
  INPUT   provision_context   # what the env occupant knows at provision time:
                              #   - evaluator_topology: "co-resident" | "dind-in-cage" | "cross-machine"
                              #       the DETERMINISTIC trigger; "co-resident" (or absent) → localhost
                              #   - substrate: "docker" | "fly" | … , from config and/or detection
  OUTPUT  base_host: string          # a bare hostname or IP literal; MUST pass envValidateBaseHost
          credentials?: object       # optional; absent for the private-network class
          teardown?: { ref, cmd }    # optional; present only if the transport created transient
                                     #   networking/credential that must be removed
  DEFAULT when provision_context.evaluator_topology is "co-resident" (or absent):
          base_host = "localhost"    # the byte-identical path; a deterministic branch on one enum field,
                                     # never a judgement — this is what protects the zero-config guarantee
```

The env-handle contract itself is unchanged: no `base` or `base.host` field is added. The resolved `base_host` is threaded into `composeGen` via `--base-host`; any `credentials` the occupant returns ride the handle's existing opaque `credentials` object; any `teardown` the occupant returns is folded into the handle's existing `teardown_ref`/`teardown_cmd` so a single teardown removes the env and the transient transport artifacts together.

**The bundled reference occupant: `faffter-noon-transport-private-network`.** A new internal skill covering the private-network reachability class, with the concrete base-resolution mechanism selected by substrate.

```
SKILL faffter-noon-transport-private-network:
  frontmatter:
    name: faffter-noon-transport-private-network
    description: >
      Default `transport` slot occupant — the private-network reachability resolver. Given the
      provision context, resolves the base host the evaluator uses to reach the system under build
      over a private network where network-layer segmentation alone satisfies "only the evaluator
      can reach it". Runs as a configured slot, not the user `/` menu.
    user-invocable: false          # mechanically enforced for REGISTRY members (validate-adapters.js:159)
    judgement_seam: none           # mechanical resolver; owns zero seam-registry rows (env-compose precedent)
  body sections (occupant shape, per skill-authoring standard):
    H1 + one-line role paragraph
    non-normative gateway refer-back blockquote ("When standalone, Read the sibling faff/SKILL.md … the gateway wins.")
    ## What it does
    ## Inputs
    ## How it resolves        # the <verb> section
    ## Output
```

**local-dind base resolution (the first buildable instance).**

```
PROCEDURE resolve_base_local_dind(provision_context):
  # The system under build runs on the orchestrator host (faff env up). The evaluator runs in a
  # docker-in-docker container inside the cage and reaches the host over the docker bridge.
  base_host = the docker bridge host-gateway address reachable from inside the evaluator container
              # host.docker.internal (mapped via --add-host host-gateway on engines that need it),
              # or a shared user-defined docker network alias the transport attaches both sides to
  credentials = none            # network-layer segmentation only
  IF the transport created a user-defined network to share:
     teardown = { ref, cmd } that removes that network
  ELSE:
     teardown = none            # nothing transient was created (host-gateway is ambient)
  RETURN { base_host, credentials, teardown }
```

Base-known-ahead: the host-gateway is well-known before `env up`, so no second resolution point is needed. Zero external infrastructure beyond docker.

**Fly 6PN base resolution (the second named instance, follow-on within this occupant).** `base_host` = the system machine's private 6PN IPv6 address (a static, base-known-ahead value); `credentials` = none; `teardown` = removal of any transient WireGuard peer the transport created. Documented so the occupant's substrate branch accommodates it; not built in the first slice.

**Design decision — the transport result shape: inline return vs its own contract block.** The env occupant consumes the transport's output inline, exactly as the evaluator consumes the env slot's output mid-flow, and the first slice is local-dind with no credentials and a trivial teardown. A new `faff-contract:transport-*` block would need a `contracts/*.schema.json`, a `contract-defs.js` compute/contract pair, a CONTRACTS registry entry, and golden cases, all to gate a value that is immediately consumed by one caller and never crosses a trust boundary on its own. The lightest correct shape is an inline return with no gated block, mirroring the intake and ADR producers, which are the two existing occupants whose conformance is a documented output rather than a piped `faff contract` block. **Chosen:** the transport occupant returns its result inline (base host, optional credentials, optional teardown) for the env occupant to consume; no new contract block, no schema, no golden cases. The `producer-transport` conformance arm asserts the documented inline contract, not a block emission.

**Design decision — where the transport slot sits.** Composed under `env`, not a sibling of `env` and not folded into the env occupant. Under `env` keeps the env occupant free of substrate branching (it asks for a base host, it does not know about docker bridges or 6PN), and it lets the reachability mechanism be swapped independently of the provisioning mechanism. **Chosen:** a first-class `transport` slot, resolved and consumed by the `env` occupant.

**Design decision — one occupant for the whole private-network class, vs one per substrate.** One occupant, substrate selected internally. The alternative (a fly occupant, a dind occupant, a tailscale occupant) multiplies REGISTRY rows and conformance arms for what is one reachability contract with a branch inside. **Chosen:** a single `faffter-noon-transport-private-network` occupant covering local-dind, Fly 6PN, and the other substrates of the same class; all substrate-specifics live inside it.

**Design decision — how the env occupant invokes the transport.** Inline and session-model-pinned, following the evaluator→env precedent, not an Agent-tool producer-subagent dispatch. There is no `models.transport` lane, and the transport is not on the gateway's producer-dispatch list, so the slot-invocation transport rule (ADR 0045) places it in the inline resolve-and-consume category. **Chosen:** the env occupant resolves `faff config get slots.transport` and consumes its output mid-flow, in the same turn.

## 4. HOW — behaviour

**Overview.** Two layers. The plumbing layer registers the slot across the four hand-synced tables plus the gateway prose row, adds the default, and extends the config selftest; it is mechanical and fully specified. The occupant layer ships `faffter-noon-transport-private-network` with the local-dind branch and the env occupant's new resolve-and-consume step. No env.js code change is needed for the first slice: the resolved base host flows through the `--base-host` flag that already exists and is already threaded at both `composeGen` call sites.

**The five slot-registration edits (all in lockstep).**

```
1. REGISTRY (validate-adapters.js:14-34) — add the occupant row:
     "faffter-noon-transport-private-network": { type: "producer-transport" }

2. SLOT_TYPES (validate-adapters.js:310-329) — add the slot row:
     transport: { type: "producer-transport", slot: "transport" }
   (the matching "producer-transport" token on both sides is what makes --is-bundled classify it
    bundled: cmdIsBundled requires REGISTRY[name].type === SLOT_TYPES[slot].type)

3. checksFor switch (validate-adapters.js:331-449) — add a conformance arm:
     case "producer-transport":
       # inline-return occupant (no gated block), mirroring producer-adr's "carries NO faff-contract block"
       assert: names its `transport` slot
       assert: documents returning a resolved base host for evaluator→SUT reachability
               (+ optional credentials + a teardown handle for transient networking/credential)
       assert: carries NO faff-contract block (the result is consumed inline by env, not gated)

4. DEFAULTS (config.js:60-81) — add the default occupant:
     "slots.transport": "faffter-noon-transport-private-network"

5. config defaults --selftest expected array (config.js:1906-1909) — add:
     "slots.transport"
   (this array is the complete slots.* coverage check; a missing entry fails the selftest)
```

Plus the gateway prose row (`plugin/skills/faff/SKILL.md`, the Slots table at :232-248): a `transport` row describing the slot, its default occupant, and its role as the evaluator→SUT reachability resolver composed under `env`.

No config code change is needed: `config get slots.transport` is generic (it reads the `.faffrc` value, falls back to DEFAULTS, else exit 3), and the FAFF-191 prose-default lint derives its key set from DEFAULTS at lint time, so it auto-covers the new entry. `--is-bundled` is a pure lookup over REGISTRY and SLOT_TYPES; edits 1 and 2 make the occupant classify bundled.

**The env occupant's new resolve-and-consume step (`faffter-noon-env-compose/SKILL.md`).** A net-new step in "How it provisions", inserted before the compose-gen step so the resolved base host is passed via `--base-host`.

```
PROCEDURE env_provision_with_transport(profile, provision_context):
  1. Resolve the transport occupant: `faff config get slots.transport`
     (default faffter-noon-transport-private-network). Resolve via config get, never name the
     default literally — the FAFF-191 lint flags a literal dispatch name.
  2. Invoke it inline with the provision context; receive { base_host, credentials?, teardown? }.
  3. Generate the plan with the resolved base:
        faff env compose-gen --profile <profile> --base-host <base_host>
     composeGen validates base_host via envValidateBaseHost (env.js:443) and fails loud on a bad value.
  4. Bring up + health-wait + seed (unchanged).
  5. Emit the env-handle (unchanged shape):
        - endpoints already resolved against base_host by composeGen
        - if credentials returned: carry them in the handle's existing `credentials` object
        - if teardown returned: fold ref/cmd into the handle's teardown_ref/teardown_cmd so one
          teardown removes the env AND the transient transport artifacts
```

**Behaviour summary.** In the zero-config default flow there is no separated evaluator in the provision context, so the transport returns `base_host = "localhost"`. The env occupant then either omits `--base-host` or passes `--base-host localhost`; both resolve to `{ host: "localhost" }` in `envResolveBase`, `composeGen` produces byte-identical output, and the FAFF-791/836 selftests stay green. In the local-dind flow the transport returns the docker bridge host-gateway address, the app endpoint re-bases to that host, and the evaluator container reaches the system across the bridge. A malformed base host fails loud inside `composeGen` at env.js:443, never emitting a resolved URL.

**Reconciling the default occupant with the byte-identical guarantee.** `slots.transport` defaults to `faffter-noon-transport-private-network`, so the transport is always resolvable; the byte-identical guarantee does not come from the slot being unset, it comes from the occupant's deterministic trigger. The rule is exactly: **`base_host = "localhost"` iff `provision_context.evaluator_topology` is `"co-resident"` or absent** — a switch on one enum field, not an inference. The zero-config path always carries `co-resident` (there is no separated evaluator to provision for), so it always resolves `localhost` and `composeGen` reproduces today's strings byte-for-byte; only `"dind-in-cage"` (this slice) or `"cross-machine"` (the 6PN follow-on) re-bases. The occupant is base-known-ahead and mechanical, so a build that returns anything other than `localhost` under `co-resident` is a defect the FAFF-791/836 selftests catch.

**Anti-pattern:** adding a `base` field to the env-handle block. Why: `env-handle.schema.json` is `additionalProperties:false` and `computeEnvHandle` rebuilds the handle from named fields, so a raw `base` is silently dropped; the base is producer-internal and reaches endpoints through `composeGen`, never the handle.

**Anti-pattern:** naming `faffter-noon-transport-private-network` literally at the dispatch site in the env occupant. Why: the FAFF-191 prose-default lint flags a dispatch that names a bundled default instead of resolving `config get slots.transport`; resolve it, so a swapped occupant is honoured.

**Anti-pattern:** dispatching the transport as an Agent-tool producer subagent. Why: there is no `models.transport` lane and the transport is not on the producer-dispatch list; the slot-invocation transport rule (ADR 0045) puts it in the inline resolve-and-consume category, same as env→evaluator.

**Anti-pattern:** building a `faff-contract:transport-*` block, schema, and golden cases for the first slice. Why: the result is consumed inline by one caller with no independent trust boundary; the block adds surface (schema + contract-def pair + CONTRACTS entry + goldens) for no gate the inline consumption does not already provide.

**Failure modes.**

- **The env occupant resolves the transport but the zero-config output drifts.** The risk in composing a new slot under `env` is that the common path stops being byte-identical. *How you'd know:* the FAFF-791/836 compose-gen selftests fail, or a diff of `faff env compose-gen` output on a repo with no separated evaluator shows a non-localhost base. *What it means:* the occupant is returning something other than `localhost` in the co-resident context, or the env occupant is passing a non-localhost `--base-host` there; narrow the occupant's default branch. This is the guarantee to protect, not a nice-to-have.
- **The four registration tables drift out of sync.** If REGISTRY, SLOT_TYPES, the `checksFor` arm, and the DEFAULTS/selftest pair are not all touched, the occupant either fails conformance lint or `--is-bundled` reports it foreign or wrong-slot. *How you'd know:* `faff validate-adapters --configured` fails, or `faff validate-adapters --is-bundled faffter-noon-transport-private-network --slot transport` exits non-zero, or `faff config defaults --selftest` fails. *What it means:* an edit was missed; apply all five.
- **The occupant is base-known-after but treated as ahead.** Not a first-slice risk (local-dind and 6PN are both ahead), but if a future substrate branch resolves the base only after `env up` and reuses the ahead path, the handle emits with a stale or localhost base. *How you'd know:* the evaluator gets connection failures against a `ready` env whose endpoints point at localhost. *What it means:* that branch needs the deferred second resolution point before it can ship; do not add it silently to the ahead path.

## 5. Scenarios

Main objectives, born verifiable. The transport-layer reachability proof (an evaluator container actually reaching the system over the bridge) is the integration objective; it is asserted here and exercised by the smoke test in DONE rather than as a unit-level GWT, because it needs a live docker engine.

```
Given a repo with an app that publishes a port, and no separated evaluator in the provision context
When the env occupant resolves the transport and runs faff env compose-gen
Then the resolved base host is "localhost", the compose-gen output is byte-identical to the pre-change output, and the FAFF-791/836 compose-gen selftests pass unchanged
```

```
Given the same repo, provisioned with the evaluator in a docker-in-docker container inside the cage
When the local-dind transport resolves the base host and the env occupant passes it via --base-host
Then plan.endpoints["app"] re-bases to the docker bridge host-gateway address (scheme and port unchanged) and the emitted env-handle carries no field outside the fixed contract shape
```

```
Given the four slot-registration edits and the new occupant directory
When faff validate-adapters --is-bundled faffter-noon-transport-private-network --slot transport runs
Then it exits 0 ("bundled first-party for slot transport"), and faff validate-adapters --configured passes the producer-transport conformance arm for the occupant
```

- The `transport` slot appears in the gateway Slots table with its default occupant and its role, and `faff config defaults --selftest` passes with `slots.transport` in the expected array.

```
Given a checkout with no .faffrc override for slots.transport
When faff config get slots.transport runs
Then it prints faffter-noon-transport-private-network and exits 0 (the baked default resolves)
```

## 6. DESIGN DECISION RATIONALE

**Should FAFF-817 pick a single concrete transport, or introduce a slot?** Options: (a) pick one transport (Fly 6PN, or published-port-plus-token, or preview URL) and wire it, as the earlier spec framed it; (b) introduce a general `transport` slot and ship one instance first. The earlier framing treated same-host and cross-machine as different problems and left the pick as a human punt. The human settled it in session: same-host-container and cross-machine are two instances of one reachability question, so the right shape is a slot. **Chosen:** a first-class `transport` slot composed under `env`, generalising the ticket's literal "cross-machine transport" to "resolve evaluator→SUT reachability across the lane boundary". This closes the earlier "which transport" punt.

**Where does the transport result get validated: its own contract block, or inline consumption?** Options: (a) a `faff-contract:transport-*` block with schema, contract-def pair, CONTRACTS entry, and golden cases; (b) an inline return consumed by the env occupant. The result is consumed by exactly one caller in the same turn and does not cross a trust boundary on its own, and the first slice carries no credentials. **Chosen:** inline return, no block, mirroring the intake and ADR producers whose conformance is a documented output. If a future token/preview occupant needs an independently gated result, a block can be added then; it is not warranted now.

**One occupant for the class, or one per substrate?** **Chosen:** one occupant, `faffter-noon-transport-private-network`, with the substrate branch inside it. One reachability contract, one conformance arm, one REGISTRY row; the substrate detail is an implementation branch, not a slot boundary.

**Which instance leads the first slice?** Options: local-dind or Fly 6PN. local-dind needs zero external infrastructure beyond docker, is the most common topology, and has a well-known base-known-ahead host-gateway. Fly 6PN needs a Fly org and a live proof consumer (FAFF-790, not yet shipped). **Chosen:** local-dind leads; Fly 6PN is the second named instance within the same occupant, a follow-on that FAFF-790 will prove, not a blocker.

**Inline resolve, or Agent-tool dispatch?** **Chosen:** inline, session-model-pinned, per the evaluator→env precedent and ADR 0045; there is no `models.transport` lane.

**Where does auth live, if a future occupant needs it?** **Chosen:** the handle's existing opaque `credentials` object, under the runtime-only, never-persisted rule the dev/test credentials already follow; no schema change. Settled by FAFF-791; recorded, not re-opened. The private-network class needs none, so `faffter-noon-evaluate` is untouched here.

At the time of writing there is no other `transport`-slot occupant in the repo, and the word "transport" is already used in ADR 0054 and ADR 0090 for the engine/model dispatch transport, a different concept; the ADR promotion below names the collision so a reader does not conflate the network-reachability `transport` slot with engine transport.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None. The two decisions the earlier spec waited on (which reachability mechanism, and the driving consumer) were settled in session: the mechanism is the private-network class shipped as a slot with local-dind first, and the consumer is the local dind-in-cage topology now, with Fly cross-machine (FAFF-790) as the proof of the second instance.

**Assumptions.**

- **Assumes** the FAFF-791 re-basing seam and the FAFF-836 `--base-host` wiring are present and unchanged. *Validation:* confirmed this run: `envResolveEndpoint` (env.js:366), `composeGen` base param and validation (env.js:382, :443), `envResolveBase` (env.js:373), the `--base-host` flag (env.js:28), and both threaded call sites (env.js:686/:688, :709/:711) all present; the default path resolves to `localhost`.
- **Assumes** the env occupant's line-30 forward reference ("a transport can later re-base the same surfaces off-host without changing the handle's shape") still describes the intended seam. *Validation:* confirmed this run at `faffter-noon-env-compose/SKILL.md:30`; the new resolve-and-consume step realises exactly that forward reference.
- **Assumes** `faffter-noon-env-compose` declares `judgement_seam: none` and owns zero seam-registry rows, so the new occupant can copy that mechanical posture. *Validation:* confirmed at `faffter-noon-env-compose/SKILL.md:5`.

## 8. ADR promotion intent

This spec records the intent to promote one ADR; faff-graft commits the ADR body at Step 4b, not this spec.

**Intent.** Cross-machine transport is a first-class `transport` slot, generalised to evaluator→SUT reachability across the lane boundary; the bundled private-network reference occupant covers the local-dind and Fly-6PN instances; token and preview transports are future occupants; the env-handle contract is unchanged. The ADR should cross-reference ADR 0031 (the env-handle contract and the env-slot provision-box interface, which this composes under), ADR 0033 (the evaluator slot and its code-blind trust boundary, the downstream consumer that reaches the system through the resolved base), and ADR 0045 (the slot-invocation transport rule, which places this in the inline resolve-and-consume category). It should note that FAFF-834's build-lane isolation axis (evaluator-as-dind-container, where the lane runs) meets this slot at the dind case without conflating with it. It should name the terminology collision with the engine/model "transport" of ADR 0054 and ADR 0090, and state that this slot's "transport" means network reachability, not model dispatch.

## 9. DONE — Definition of Done

### From WHY / principles
- [ ] The zero-config `faff env compose-gen` output is byte-identical to the pre-change output, and the FAFF-791/836 compose-gen selftests pass unchanged.
- [ ] The emitted env-handle carries no `base`/`base.host` field and no field outside the fixed contract shape.

### From WHAT (the slot contract and occupant)
- [ ] A new skill `plugin/skills/faffter-noon-transport-private-network/SKILL.md` exists with frontmatter `name`, `description` (stating the `transport` slot, the role, and "Runs as a configured slot, not the user `/` menu"), `user-invocable: false`, and `judgement_seam: none`, and the body sections H1 + role, non-normative gateway refer-back blockquote, `## What it does`, `## Inputs`, `## How it resolves`, `## Output`.
- [ ] The occupant returns a resolved base host that passes `envValidateBaseHost`, plus an optional credentials object and an optional teardown handle; it documents the local-dind base resolution (docker bridge host-gateway) and names Fly 6PN as the second base-known-ahead instance.

### From WHAT (slot registration — the four hand-synced tables)
- [ ] `REGISTRY` (validate-adapters.js) has `"faffter-noon-transport-private-network": { type: "producer-transport" }`.
- [ ] `SLOT_TYPES` (validate-adapters.js) has `transport: { type: "producer-transport", slot: "transport" }`.
- [ ] `checksFor` has a `case "producer-transport":` arm asserting the occupant names its `transport` slot, documents returning a resolved base host for evaluator→SUT reachability, and carries no `faff-contract:` block.
- [ ] `DEFAULTS` (config.js) has `"slots.transport": "faffter-noon-transport-private-network"`.
- [ ] The `config defaults --selftest` expected array includes `"slots.transport"`, and `faff config defaults --selftest` passes.
- [ ] The gateway Slots table (`faff/SKILL.md`) has a `transport` row naming the default occupant and the role.

### From WHAT (classification)
- [ ] `faff validate-adapters --is-bundled faffter-noon-transport-private-network --slot transport` exits 0.
- [ ] `faff validate-adapters --configured` passes the `producer-transport` conformance arm for the occupant.

### From HOW (env occupant wiring)
- [ ] `faffter-noon-env-compose/SKILL.md` has a resolve-and-consume step that resolves `faff config get slots.transport` (never naming the default literally), invokes it inline with the provision context, and passes the resolved base host via `--base-host` before the compose-gen step; teardown returned by the transport is folded into the handle's `teardown_ref`/`teardown_cmd`.
- [ ] No `env.js` code change is required for the local-dind slice (the base flows through the existing `--base-host` seam); if any is made, its rationale is stated.

### From HOW (default reconciliation)
- [ ] The occupant returns `base_host = "localhost"` iff `provision_context.evaluator_topology` is `"co-resident"` or absent (the deterministic trigger, a switch on one enum field), so the zero-config path stays byte-identical; a selftest asserts `co-resident → "localhost"` and `dind-in-cage → the host-gateway`.

### From validation, teardown, and the smoke test
- [ ] A malformed `base_host` returned by the occupant (any value failing `envValidateBaseHost` — e.g. `localhost; rm -rf /`, a value with a scheme/port/space) makes `composeGen` fail loud with a non-zero exit and produce no compose file; a selftest asserts this, so a swapped-in foreign occupant cannot inject a crafted host.
- [ ] A transport-returned `teardown` is folded into the handle's `teardown_ref`/`teardown_cmd`, and a single teardown actually removes both the env and the transport-created network (`docker network ls` shows no leak); the network-creating branch is exercised so the fold path is not vacuously green; a build that drops the `teardown` object fails this criterion.
- [ ] The verifiable-now smoke assertions A1 (re-base to host-gateway, no base field on the handle), A2 (the bridge-reachability probe — run first, as the de-risk step), and A3 (teardown leaves no network) all pass. The full evaluator-in-dind proof (B1) is the downstream objective gated on FAFF-834 and is **not** a DONE item of this ticket.

### From the ADR promotion intent
- [ ] The spec's ADR promotion intent section is present and cross-references ADR 0031, ADR 0033, and ADR 0045, notes the FAFF-834 axis, and names the ADR-0054/0090 "transport" terminology collision. (The ADR file is committed by graft, not by this spec.)

**Integration smoke test.** The full evaluator-in-dind proof needs the dind evaluator container, which is FAFF-834's deliverable, not this ticket's — so the smoke test is split into what this slice can verify on its own and what is deferred to FAFF-834, with a concrete oracle for each verifiable step.

*Verifiable in this ticket (no FAFF-834 dependency):*

```
A1. On a repo with a buildable app, run env compose-gen with provision_context.evaluator_topology="dind-in-cage".
    ASSERT: plan.endpoints["app"] host component == the resolved docker bridge host-gateway (not "localhost"),
            scheme and port unchanged; the emitted env-handle carries no base/base.host field.
A2. Bridge-reachability probe (de-risk — RUN THIS FIRST, before building the occupant, per the risk note):
    env up the app on the orchestrator host, then from a THROWAWAY sibling container on the same engine
    (docker run --add-host host-gateway:host-gateway ... curl -sS -o /dev/null -w '%{http_code}'
     http://<host-gateway>:<port>/health) ASSERT: the probe exits 0 and prints an HTTP status in 200–499
    (i.e. the request reached the app and got an HTTP response) within a 10s timeout.
    A connection refused / timeout here means the cage cannot do host-gateway reachability — the one
    genuine surprise in this ticket — and it surfaces before the occupant is built, not at the merge gate.
A3. Teardown via the handle removes the env AND any user-defined network the transport created;
    re-running `docker network ls` shows no leaked transport network.
```

*Deferred to FAFF-834 (the dind evaluator container itself):*

```
B1. With FAFF-834's evaluator-as-dind-container in place, the env occupant resolves the transport, the
    evaluator container reaches plan.endpoints["app"]/health over the bridge, and the code-blind evaluator
    exercises the SUT end-to-end. This is the full reachability proof; it cannot run until the dind
    evaluator container exists, so it is asserted here as the downstream objective, not a DONE item of this ticket.
```

confidence: high
build-tier: complex
spec-review: approve