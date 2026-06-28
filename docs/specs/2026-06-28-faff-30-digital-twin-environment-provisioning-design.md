# SPEC — FAFF-30: Digital-twin & environment provisioning

> Spec: faffter-dark-nlspec · 2026-06-28 · interactive · confidence: medium · spec-review: approve

*A representative, health-checked runtime stand-in — the substrate the holdout evaluator (FAFF-34) trusts.*

## Preamble

FAFF-30 stands up a **provisioned, health-checked environment handle**: a fixed-shape contract describing a running stand-in for the system under build, plus a default producer that brings one up locally. The evaluator (FAFF-34) and lights-out CI exercise the build *inside* this env. Slot-framed exactly like the just-shipped `architecture` slot: **fixed contract = the env handle; swappable producer = the provisioning mechanism.** v1 is build-biased and local-first: a docker-compose stand-in derived from the team's own infra profile.

## 1. WHY — the load-bearing model

faff's L4 build-and-judge pipeline is a four-box flow; FAFF-30 is the **provision** box:

```
  PROPOSE          PROVISION            SEED              EVALUATE
  (FAFF-27 ✅)      (FAFF-30, this)      (FAFF-31 ✅)       (FAFF-34)
  architecture  →  env-handle        →  load fixtures  →  holdout judge
  -proposal        (running env)        into the env      pokes the env
```

- **FAFF-27** emits an `architecture-proposal` — *what shape to mirror*. `recommendation: build` ⟹ provision a local representative; `buy`/`hybrid` ⟹ human concern, not provisioned here.
- **FAFF-26** supplies the infra profile (`faff profile show --json`) — *what runtimes/datastores the env must contain*.
- **FAFF-30 (this)** turns those into a running, health-checked env and emits a fixed `env-handle`.
- **FAFF-31** realises a deterministic synthetic dataset (`faff fixtures realise`); FAFF-30 loads it **before** declaring `status: ready`.
- **FAFF-34** gates on `status: ready`, hits `endpoint`, confirms via `health_checks`, cleans up via `teardown_ref`.

Without FAFF-30 the evaluator has a dataset and a build but nowhere to run them — "review passed" would mean "the code compiles," not "the system behaves." The handle is a **contract**, not an implementation: any producer (compose now; cloud later) conforms by emitting the same block; the evaluator never learns how the env was stood up.

## 2. OUT OF SCOPE

- **FAFF-29 (local-dev ergonomics)** — rich multi-service local-DEV running is built *on top of* this contract, not inside it. FAFF-30 is the twin/stand-in; FAFF-29 is the full local run.
- **FAFF-12 (lights-out CI / execution-target)** — owns *where* commands run + promotion state machine; FAFF-30 provisions *what* that target references and stops.
- **Buy/hybrid provisioning** — on `recommendation ≠ build`, surface for a human, provision nothing.
- **Cloud / PaaS producers** (Netlify-preview, persistent staging) — future swappable occupants, not v1.
- **Multi-service orchestration beyond compose** (k8s, meshes) — v1 is single-host docker-compose.
- **Production-grade secrets handling** — v1 emits dev/test creds in-block (synthetic, ephemeral, local env); real brokering deferred (§7).

## 3. WHAT

### 3.2 The `env-handle` RECORD (the contract shape)

```
env-handle := {
  status:        "ready" | "provisioning" | "failed" | "terminated",   // required
  endpoint:      string,                  // required when ready — primary URL the evaluator hits
  endpoints:     { name -> url }?,          // optional — multi-service map
  health_checks: [ { name, path, expected_status } ],   // required — what "healthy" means
  readiness:     { all_checks_passing: bool, last_check_time: string }?,
  teardown_ref:  string,                  // required — opaque teardown token
  teardown_cmd:  string?,                 // optional — human-runnable teardown
  credentials:   { }?,                    // optional — dev/test creds in-block (v1)
  provisioned_at: string,                 // required
  provisioner:   string,                  // required — which producer emitted this
  violations:    [ string ]               // required (may be empty)
}
```

Contract exits (mirroring `architecture-proposal`): `0` conformant **and** `status: ready` · `1` violations (status≠ready / missing required field / bad enum) · `2` fail-loud (non-object).

### 3.3 Registration surface (mirror FAFF-27/265 — file-for-file)

1. `plugin/skills/faff/contracts/env-handle.schema.json` (new)
2. `bin/faff` `CONTRACTS.env-handle` (compute fn + fixtures selftest table)
3. `bin/faff` `DEFAULTS["slots.env"] = "faffter-noon-env-compose"`
4. `bin/faff` `config defaults --selftest` expected[] + `config resolved` SLOTS (add `env`)
5. `bin/faff` `REGISTRY["faffter-noon-env-compose"] = producer-env` + `SLOT_TYPES.env`
6. `bin/faff` `checksFor` `producer-env` case → asserts `faff-contract:env-handle` emission
7. `plugin/skills/faffter-noon-env-compose/SKILL.md` (new, user-invocable:false)
8. `plugin/skills/faff/SKILL.md` slot row + contract family · `.faffrc.example.yaml` · `docs/guide/cli.md`
9. `test/golden/contracts/cases.json` cases · `.github/workflows/validate.yml` selftest step

## 4. HOW

### 4.1 Default producer `faffter-noon-env-compose` — procedure

```
provision(proposal, profile):
  if proposal.recommendation != "build": surface_for_human(proposal); return   # buy/hybrid — provision nothing
  if not docker_and_compose_available(): emit env-handle{status:"failed", violations:["docker/compose unavailable"]}; return
  services = derive_services(profile.runtimes, profile.datastores)   # reuse Dockerfile if deploy_targets has container-image
  compose  = locate_or_generate_compose(services)
  run("docker-compose -p <project> up -d"); teardown_ref = "<project>"
  checks = health_checks_for(services)
  if not wait_until_passing(checks, deadline=SLA):
      run("docker-compose -p <project> down"); emit env-handle{status:"failed", health_checks:checks, violations:["health checks did not pass within SLA"]}; return
  dataset = faff fixtures realise        # FAFF-31 — deterministic, seed-rooted, no PII
  load_into_datastores(dataset, services)
  emit env-handle{ status:"ready", endpoint, endpoints, health_checks:checks,
                   readiness:{all_checks_passing:true,last_check_time:now()},
                   teardown_ref, teardown_cmd:"docker-compose -p <project> down",
                   credentials:{dev/test}, provisioned_at:now(), provisioner:"faffter-noon-env-compose", violations:[] }
```

### 4.2 The FAFF-34 handshake

1. FAFF-34 invokes the configured `env` producer (`faff config get slots.env`, never hardcode).
2. Locates the `faff-contract:env-handle` block, parses it, pipes to `faff contract env-handle`.
3. **Gate:** exit `0` (`status: ready`) → proceed; `1`/`2` → don't evaluate (env not trustworthy).
4. Sends requests to `endpoint`/`endpoints[*]`, confirms via `health_checks`.
5. On completion, tears down via `teardown_ref`/`teardown_cmd`. **Ephemeral by default** — one env per eval run.

### 4.3 Failure modes

| Condition | Handle | Consumer exit |
|---|---|---|
| docker/compose absent | `status: failed`, `violations` | 1 |
| health checks never pass within SLA | `status: failed` (env torn down) | 1 |
| `recommendation: buy`/`hybrid` | *no handle* — surfaced for human | n/a |
| seeding fails | `status: failed`, `violations` | 1 |
| producer emits a non-object | — | 2 |
| all good | `status: ready` | 0 |

## 5. SCENARIOS (born-verifiable)

1. *Given* a `build` proposal + infra profile (runtimes+datastores), *When* the producer runs, *Then* it emits a `faff-contract:env-handle` that `faff contract env-handle` accepts at **exit 0** with `status: ready`.
2. (assertion) The ready handle exposes `endpoint`, non-empty `health_checks[]`, and `teardown_ref` (what FAFF-34 consumes).
3. *Given* the happy path, *Then* `faff fixtures realise` ran and its dataset loaded **before** `status: ready` (no ready handle without a seeded env).
4. *Given* `recommendation: buy`, *Then* the producer provisions nothing and surfaces for a human (no handle emitted).
5. *Given* health checks never pass within SLA, *Then* the env is torn down and handle is `status: failed` → **exit 1**.
6. *Given* docker absent at start, *Then* `status: failed` + `violations` → **exit 1**.
7. Contract exits: conformant ready → 0; `provisioning`/missing-`endpoint`/bad-enum → 1; non-object → 2.
8. *Given* no `slots.env` in `.faffrc`, *Then* `faff config get slots.env` → `faffter-noon-env-compose`; `config defaults --selftest` passes with `slots.env`.
9. (assertion) `faff validate-adapters` passes the new producer as `producer-env`.
10. (assertion) `faff contract env-handle --selftest` exits 0 in `validate.yml`.

## 6. DESIGN DECISION RATIONALE

- **Chosen** — new `env` slot + `env-handle` contract + default `faffter-noon-env-compose` producer (mirror the FAFF-27/265 triad; swappability for free).
- **Chosen** — the §3.2 env-handle record shape.
- **Chosen** — consume architecture-proposal (FAFF-27) + infra-profile (FAFF-26); on `recommendation≠build` surface for human, provision nothing.
- **Chosen** — seed via `faff fixtures realise` (FAFF-31) before `status: ready`.
- **Chosen** — default producer = docker-compose local (build-biased, free, offline).
- **Chosen** — ephemeral by default (per-eval teardown via teardown_ref).
- **Chosen** — expose exactly what FAFF-34 consumes (status:ready gate + endpoint + health_checks + teardown).
- **Chosen (scope)** — v1 = contract + compose producer + seeding; NOT FAFF-29 ergonomics, NOT FAFF-12 execution-target, NOT buy/hybrid, NOT cloud producers.
- **Punt** — fidelity-vs-cost / persistent-vs-ephemeral beyond local-compose → deferred to named future swappable producers. Non-blocking.
- **Punt** — health-check SLA / "ready" semantics + secrets handling (v1 dev/test creds in-block; readiness producer-declared) → revisit if prod-like data enters. Minor.
- **Assumes** — docker / docker-compose available in the execution environment (validate at build start; absence is a clean `status: failed`).
- **Assumes** — FAFF-12 owns execution_target; FAFF-30 provisions what it references.
- **Assumes** — FAFF-29 builds local-dev ergonomics on top of this contract (co-located, not duplicated).

## 7. OPEN QUESTIONS + ASSUMPTIONS

**Punts (non-blocking for v1):**
- Fidelity-vs-cost / persistent-vs-ephemeral beyond local-compose → named future swappable producers (the slot makes this a later config choice, not a rebuild).
- Health-check SLA / "ready" semantics + secrets handling — v1 dev/test creds in-block; readiness producer-declared. Revisit if prod-like data enters (then secrets need real brokering, and the handle's creds must not be persisted to tracker/PR logs — runtime-consumed only).

**Assumptions to validate at build start:**
- docker / docker-compose available — absence is a clean `status: failed`, not a crash.
- FAFF-12 owns execution_target; reconcile if it lands first with an env model.
- FAFF-29 builds ergonomics on top of this contract — FAFF-30 must not pre-empt it.

## 8. DONE (testable, mirrors body 1:1)

- [ ] `contracts/env-handle.schema.json` exists with the §3.2 shape.
- [ ] `CONTRACTS.env-handle`: exit 0 (conformant+ready) / 1 (violations / status≠ready / missing field / bad enum) / 2 (non-object); with a fixtures selftest table.
- [ ] `faff contract env-handle --selftest` exits 0; wired into `validate.yml`. *(Sc 7,10)*
- [ ] `DEFAULTS["slots.env"]="faffter-noon-env-compose"`; in `config defaults --selftest` + `config resolved` SLOTS. *(Sc 8)*
- [ ] `REGISTRY`+`SLOT_TYPES` carry `producer-env`; `checksFor` `producer-env` case asserts `faff-contract:env-handle`. *(Sc 9)*
- [ ] `faffter-noon-env-compose/SKILL.md` (user-invocable:false) documents the §4.1 procedure + emitting the handle; passes `validate-adapters`. *(Sc 9)*
- [ ] Producer: `recommendation:build` → compose from profile → up → health-wait → `faff fixtures realise` + load → `status: ready` handle. *(Sc 1,3)*
- [ ] Producer: `recommendation≠build` → surface, no handle. *(Sc 4)*
- [ ] Producer: docker-absent / health-timeout / seed-failure → `status: failed` + `violations`, env never left half-up. *(Sc 5,6)*
- [ ] Ready handle exposes `endpoint`, non-empty `health_checks[]`, `teardown_ref`. *(Sc 2)*
- [ ] `.faffrc.example.yaml` documents the `env` slot; gateway slot table + contract family + `docs/guide/cli.md` updated.
- [ ] `cases.json` has env-handle conformant/violation/fail-loud cases.
- [ ] Scope holds: no FAFF-29 ergonomics, no FAFF-12 execution-target, no buy/hybrid, no cloud producer.

confidence: medium
