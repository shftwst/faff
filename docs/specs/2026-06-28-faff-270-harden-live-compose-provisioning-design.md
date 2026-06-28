# SPEC — FAFF-270: Harden live compose provisioning

> Spec: faffter-dark-nlspec · 2026-06-28 · interactive · confidence: high · spec-review: approve. Full spec on Linear FAFF-270.

*The hardening that turns FAFF-30's prose env producer into one that actually stands an env up — a deterministic, unit-tested compose generator plus a real provision → health-wait → seed → teardown path exercised against docker. Audience: the build agent, and the human reviewers gating L4.*

> **Revised 2026-06-28** — both open Punts resolved interactively and closed to decisions: seed-loader breadth (postgres + mysql + sqlite via a shared `sql-load`; redis/mongo split to FAFF-271/FAFF-272), health-wait SLA (60s/2s). Added a `**Chosen:**` that makes an **unprovisionable datastore fail loud** rather than silently shipping an incomplete env.

## Preamble

FAFF-30 shipped the **interface**: the `env-handle` contract, the `env` slot, and a `faffter-noon-env-compose` producer whose §4.1 procedure is **prose only** — "locate or generate the compose file", "up", "health-wait", "seed", "emit handle" are narrated, none are executed or tested. FAFF-270 makes that procedure **real and tested**. It splits the producer's work along the one seam that matters: the **deterministic, docker-free part** (infra-profile → compose file + provision plan) becomes a pure CLI helper with unit tests; the **docker-dependent part** (up, poll, seed, teardown) becomes thin `faff env` orchestration verbs with **docker-gated** integration tests. FAFF-34 (the holdout evaluator) and FAFF-29 (local-first running) both block on a *really standing-up* env — so this is structural prerequisite, not polish.

## 1. WHY — Problem and Principles

**Load-bearing model.** An env-handle whose `status: ready` was produced by *prose* is a promise nothing checks; an env-handle produced by *code that brought a real docker-compose stack up, waited for health, and seeded it* is the trustworthy substrate FAFF-34 evaluates against. The whole value of FAFF-270 is converting one into the other, and proving it with tests.

**Problem statement.** Today `faffter-noon-env-compose` describes how to provision an env but executes nothing and is covered only by the contract-shape selftest — no compose file is ever generated, no container ever starts. That means "env provisioning works" currently means "the handle's JSON shape is valid", not "an env stood up." FAFF-270 builds the deterministic compose generator + the live provisioning verbs and tests both, so FAFF-30's §5 scenarios 1/3/5/6 become executed tests rather than prose.

**Design principles:**

- **Determinism boundary is the architecture.** The compose-generation step is a pure function of (infra-profile, project name) and must be **byte-identical across runs** and unit-testable with **no docker**; everything that touches docker is isolated behind separate verbs whose tests are **skipped when docker is absent**. The governing tenet is *deterministic tools over prose* (gateway → Governing principles) — the mechanical part is a tool, the live part is thin orchestration over that tool.
- **An incomplete env fails loud — never silently ready.** A stand-in missing a datastore the system needs is worse than no stand-in, because the evaluator (FAFF-34) would gate "review passed" on a wrong env. So a datastore compose-gen cannot faithfully provision is a **hard, loud failure** (escalate for a human to extend the table), never a silent skip behind a `ready` handle. The producer never guesses an image/loader — a guessed env is exactly what an L4 trust substrate can't allow.
- **The env is never left half-up.** Any failure after `up` (health timeout, seed failure) must tear the stack down before returning a non-ready handle. A leaked container set is a correctness defect, not untidiness.
- **Reuse, don't re-derive.** Compose generation reads the existing infra-profile (`faff profile show --json`, FAFF-26/231) and seeding reuses the existing `faff fixtures realise` (FAFF-31). FAFF-270 adds the generator + the verbs + tests; it does not reinvent profile mining or dataset realisation.

**Reference context:**

| System | Location | Relevance |
|---|---|---|
| `faffter-noon-env-compose/SKILL.md` | prose producer | The §4.1 procedure this hardens; rewired to call the new verbs |
| `env-handle` contract | `plugin/skills/faff/contracts/env-handle.schema.json` + `bin/faff` `computeEnvHandle` (~L5106) | The fixed output shape; unchanged — the producer must still emit a conformant block |
| `faff profile` | `bin/faff` `mineRepo`/`validateProfile` (~L6474–6607) | Source of `runtimes` / `datastores` / `deploy_targets` that compose-gen maps |
| `faff fixtures realise` | `bin/faff` (~L6906) | Deterministic per-entity dataset the seed step loads |
| `faff profile` / `faff fixtures` CLI dispatch | `bin/faff` `cmdProfile` (~L6609), `cmdFixtures` (~L6839), `COMMANDS` map (~L8505) | The subcommand + test pattern `faff env` mirrors file-for-file |
| test harness | `test/profile.test.mjs`, `test/fixtures.test.mjs`, `test/contract-golden.test.mjs`, `.github/workflows/validate.yml` (`node --test`) | Where compose-gen unit tests + docker-gated live tests land |

**Scope statement.** FAFF-270 is the *tested mechanism* behind FAFF-30's *contract* — it lives entirely inside the `env` slot's default producer and a new `faff env` CLI command, and is consumed downstream by FAFF-34 and FAFF-29.

## 2. OUT OF SCOPE

- **Cloud / PaaS / persistent-staging producers** — Why: v1 is local-first docker-compose (FAFF-30 §2). Extension point: a new `env` slot occupant emitting the same `env-handle` block.
- **Multi-service orchestration beyond compose (k8s, meshes)** — Why: single-host compose is the v1 fidelity target. Extension point: a swapped `env` producer.
- **redis + mongo seed-loaders** — Why: their engines provision fine but need engine-native importers (command-replay / `mongoimport`); split to keep this slice bounded. Tracked by **FAFF-271** (redis) and **FAFF-272** (mongo). Extension point: the `SEED_STRATEGIES` table in `bin/faff`.
- **S3-compatible object store (MinIO)** — Why: an object store is a different shape from a row store (provision + `object-upload` seed, not `sql-load`); own slice. Tracked by **FAFF-273**. Until then an `s3`/`minio` kind hits the fail-loud escalate (HOW §4.2). Extension point: `DATASTORE_TABLE` + `SEED_STRATEGIES`.
- **Seed-loaders for datastore kinds beyond the relational three + redis/mongo/s3** — Why: open-ended. A new kind extends `DATASTORE_TABLE` / `SEED_STRATEGIES`; until then it is caught by the fail-loud escalate (HOW §4.2), never silently dropped. Extension point: those two tables.
- **FAFF-29 local-dev ergonomics** (rich, long-lived multi-service dev running) — Why: built *on top of* this contract, not inside it (FAFF-30 §2). Extension point: FAFF-29 consumes `faff env up`/`down`.
- **FAFF-12 execution-target / promotion state machine** — Why: owns *where* commands run; FAFF-270 provisions *what* they reference. Extension point: FAFF-12.
- **Changing the `env-handle` contract shape** — Why: FAFF-30 fixed it and FAFF-34 consumes it; FAFF-270 must *emit* a conformant handle, not alter the schema. Extension point: a separate contract-evolution issue if a field proves missing.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| compose-gen | The pure function (and `faff env compose-gen` CLI) that turns an infra-profile into a docker-compose file + a provision plan |
| provision plan | The deterministic JSON sidecar compose-gen prints: the derived services, endpoint, endpoints, `health_checks[]`, `seed_targets[]`, and any `unprovisionable[]` kinds — so the producer never re-derives handle fields in prose |
| live verbs | `faff env up` / `faff env seed` / `faff env down` — the thin docker-touching orchestration the producer calls |
| `sql-load` | The shared relational seed strategy (postgres / mysql / sqlite): one row-shaping mechanic over the realised dataset, a per-engine delivery adapter |
| docker-gated test | A `node --test` case that runs only when docker is available and is skipped (not failed) otherwise |

**Type definitions.**

```
RECORD ProvisionPlan:                 # compose-gen stdout (deterministic JSON)
  schema:          1                  # required; exactly 1
  project_name:    string             # required; derived deterministically (see HOW §4.2)
  compose_file:    string             # required; path the compose YAML was written to
  services:        [ ServiceSpec ]    # required (may be empty if all stores are file-based)
  endpoint:        string             # required; primary URL (precedence in HOW §4.2)
  endpoints:       { name -> url }     # required (may be one entry)
  health_checks:   [ HealthCheck ]    # required; non-empty — mirrors env-handle.health_checks
  seed_targets:    [ SeedTarget ]     # required (may be empty); what the seed step will load
  unprovisionable: [ string ]         # required (may be empty); datastore kinds with no DATASTORE_TABLE entry
  notes:           [ string ]         # required (may be empty); e.g. "redis provisioned but unseeded (FAFF-271)"

RECORD ServiceSpec:
  name:          string               # compose service name
  image:         string               # resolved image, or "" when built_from is set
  built_from:    string?              # Dockerfile path when deploy_targets has container-image
  ports:         [ "host:container" ]
  health_check:  HealthCheck

RECORD HealthCheck:                    # shape matches env-handle.health_checks[]
  name:            string
  path:            string             # URL path for http services; engine probe token for datastores
  expected_status: number

RECORD SeedTarget:
  service:    string                  # which service to seed ("<kind>-file" for a file-based store)
  strategy:   "sql-load" | "mount"    # see HOW §4.4
  kind:       string                  # datastore kind (postgres, mysql, sqlite, redis, …)
  file_based: bool                    # true for sqlite (no container service; loader writes a DB file)
```

**CLI surface (new `faff env` command, mirroring `faff profile` / `faff fixtures`):**

```
faff env compose-gen [--profile FILE] [--out PATH] [--project NAME] [--json]
    # PURE. profile defaults to `faff profile show --json`; out defaults to .faff/env/docker-compose.yml.
    # Writes the compose file; prints the ProvisionPlan JSON to stdout. No docker. Deterministic.

faff env up   [--plan FILE | --profile FILE] [--project NAME] [--sla-secs N] [--poll-secs N]   # docker: up + health-wait
faff env seed [--plan FILE] [--manifest FILE]                   # docker: fixtures realise + load per seed_targets
faff env down [--project NAME]                                  # docker: compose down -v (teardown)
faff env --selftest                                            # drives compose-gen on fixture profiles (no docker)
```

**Design decisions** (full rationale in §6):

- **Compose generation is a CLI helper, not producer prose.** **Chosen:** `faff env compose-gen` — a pure function over the infra-profile, unit-tested without docker, mirroring `faff profile mine` / `faff fixtures realise`.
- **The live path is thin `faff env up`/`seed`/`down` verbs the producer orchestrates.** **Chosen:** put the docker calls behind testable verbs (reusable by FAFF-34/FAFF-29) rather than burying them in producer prose.
- **compose-gen emits a provision plan, not just YAML.** **Chosen:** a JSON sidecar carrying the derived `endpoint`/`endpoints`/`health_checks`/`seed_targets`/`unprovisionable`, so the producer fills the env-handle deterministically instead of re-deriving in prose.
- **An unprovisionable datastore fails loud.** **Chosen:** a datastore kind with no `DATASTORE_TABLE` entry is reported in `plan.unprovisionable[]` and the producer emits `status: failed` + a violation — never a silent skip behind a `ready` handle.

## 4. HOW — Behavior

### 4.1 Architecture and approach

The producer's §4.1 procedure is unchanged in shape; each prose step now resolves to a call, plus the new fail-loud gate:

```
PROCEDURE provision(proposal, profile):
  1. IF proposal.recommendation != "build": surface_for_human(proposal); emit no handle; return
  2. plan = `faff env compose-gen --profile <profile>`      # PURE — always runs, docker or not
  2b. IF plan.unprovisionable not empty:                    # fail loud — never ship an incomplete env
        emit env-handle{ status:"failed", health_checks: plan.health_checks,
          violations:["unprovisionable datastore kind(s): "+plan.unprovisionable+" — extend DATASTORE_TABLE"] }; return
  3. IF not docker_available():                              # `docker info` / `faff env up` preflight
        emit env-handle{ status:"failed", health_checks: plan.health_checks,
                         violations:["docker/compose unavailable"] }; return
  4. `faff env up --plan <plan>`                             # compose up -d, then health-wait to SLA
     IF health-wait timed out:
        `faff env down`; emit env-handle{ status:"failed", health_checks:plan.health_checks,
                         violations:["health checks did not pass within SLA"] }; return
  5. `faff env seed --plan <plan>`                           # fixtures realise + load per seed_targets
     IF seed failed:
        `faff env down`; emit env-handle{ status:"failed", violations:["seed failed"] }; return
  6. emit env-handle{ status:"ready", endpoint:plan.endpoint, endpoints:plan.endpoints,
                      health_checks:plan.health_checks,
                      readiness:{all_checks_passing:true, last_check_time:now()},
                      teardown_ref:plan.project_name,
                      teardown_cmd:"faff env down --project "+plan.project_name,
                      credentials:{dev/test}, provisioned_at:now(),
                      provisioner:"faffter-noon-env-compose", violations:[] }    # notes (e.g. unseeded redis) carried through
```

### 4.2 compose-gen — the deterministic core

**Summary:** map the infra-profile's datastores onto compose services using a built-in lookup table, write the compose YAML, and return the provision plan. Same inputs ⇒ byte-identical outputs. An unknown datastore kind is **reported, not skipped**.

```
PROCEDURE compose_gen(profile, project_name):
  1. services = []; seed_targets = []; unprovisionable = []; notes = []
  2. FOR each datastore in profile.datastores:
       spec = DATASTORE_TABLE[datastore.kind]
       IF spec is absent:
          unprovisionable += datastore.kind            # fail-loud signal — NOT a silent skip
          continue
       IF spec.file_based:                              # sqlite — no container service
          seed_targets += SeedTarget{ service:datastore.kind+"-file", strategy:"sql-load",
                                      kind:datastore.kind, file_based:true }
          continue
       services += ServiceSpec{ name:datastore.kind, image:spec.image,
                               ports:[spec.port], health_check:spec.health }
       seed_targets += SeedTarget{ service:datastore.kind, strategy:spec.seed_strategy,
                                   kind:datastore.kind, file_based:false }
       IF spec.seed_strategy == "mount": notes += datastore.kind+" provisioned but unseeded ("+spec.followup+")"
  3. IF profile.deploy_targets contains kind=="container-image":
       services += ServiceSpec{ name:"app", built_from:"<Dockerfile path from evidence>",
                                ports:[APP_PORT], health_check:{name:"app", path:"/health", expected_status:200} }
     ELSE: no app service (datastores-only stand-in)
  4. endpoint = app service URL IF app present,
                ELSE first NON-file-based datastore's URL (deterministic order),
                ELSE first datastore (file_based — a file path URL)
  5. compose_yaml = render(services)                   # stable key order, no timestamps, no random names
  6. write compose_yaml to out_path
  7. RETURN ProvisionPlan{ schema:1, project_name, compose_file:out_path, services,
                           endpoint, endpoints, health_checks:[s.health_check for s in services],
                           seed_targets, unprovisionable, notes }
```

**`DATASTORE_TABLE` (v1 entries):**

| kind | image | port | health probe | seed_strategy | file_based |
|---|---|---|---|---|---|
| postgres | `postgres:16-alpine` | 5432 | `pg_isready` | `sql-load` | no |
| mysql | `mysql:8` | 3306 | `mysqladmin ping` | `sql-load` | no |
| sqlite | — (no container) | — | — (file-exists) | `sql-load` | **yes** |
| redis | `redis:7-alpine` | 6379 | `redis-cli ping` | `mount` (→ FAFF-271) | no |
| mongo | `mongo:7` | 27017 | `mongosh ping` | `mount` (→ FAFF-272) | no |

A kind **not** in this table → `unprovisionable[]` (the producer fails loud). redis/mongo **are** in the table (they provision + health-check) but carry `seed_strategy: mount` until FAFF-271/FAFF-272 give them native loaders.

**Determinism requirements (testable):** service order follows `profile.datastores` order then the app service; YAML keys are emitted in a fixed order; `project_name` defaults to a deterministic derivation (e.g. `faff-env-<short-hash(repo+profile)>`) — **no** wall-clock, **no** random suffix in the generated file. (The env-handle's `provisioned_at` is a runtime field set by the producer, not by compose-gen — compose-gen stays pure.)

**Anti-pattern:** embedding timestamps or random project suffixes in the generated compose file. Why: it breaks byte-identical determinism and makes the unit test non-reproducible. Runtime-varying values belong in the handle the *producer* emits, never in compose-gen output.

**Anti-pattern:** silently skipping a datastore kind compose-gen doesn't recognise. Why: it produces a `ready` handle over an env missing a store the system needs, and FAFF-34 would then "pass" against a wrong env. Report it in `unprovisionable[]` and let the producer fail loud.

### 4.3 The live verbs — `up` / `down`

```
PROCEDURE env_up(plan, sla_secs=60, poll_secs=2):
  1. preflight: `docker info` succeeds? else exit non-zero with "docker unavailable"
  2. `docker compose -p <plan.project_name> -f <plan.compose_file> up -d`
  3. health-wait: poll each plan.health_checks[] (engine-native probe) until all pass OR sla_secs deadline
  4. on all-pass → exit 0 ; on timeout → exit non-zero (caller tears down)

PROCEDURE env_down(project_name):
  1. `docker compose -p <project_name> down -v`           # remove containers + volumes
  2. idempotent: a missing/already-down project is exit 0 (teardown must never fail the queue)
```

**SLA defaults:** `sla_secs=60`, `poll_secs=2`, engine-native probes (table above) — overridable via `--sla-secs` / `--poll-secs` (or env).

**Edge cases & error handling:**

- **unprovisionable datastore** — caught pre-docker in the producer (§4.1 step 2b): `status: failed` + violation naming the kind(s); env never starts.
- **docker absent** — `env up` preflight exits non-zero; producer maps to `status: failed` + violation (terminal for this run, not retryable in-run).
- **health timeout** — `env up` exits non-zero after the deadline; producer calls `env down` then emits `status: failed`. The stack is never left up.
- **partial up** (one service unhealthy) — same as health timeout: deadline expires with `all_checks_passing:false` → teardown.
- **teardown of an absent project** — `env down` is idempotent (exit 0). Teardown is post-failure/post-eval housekeeping; it must not throw.

### 4.4 Seeding — `faff env seed`

**Summary:** realise the deterministic dataset (`faff fixtures realise`) and load it into each `seed_target` per its strategy, **before** the producer declares `status: ready`.

```
PROCEDURE env_seed(plan, manifest):
  1. dataset = `faff fixtures realise --file <manifest>`   # per-entity JSON, deterministic (FAFF-31)
  2. FOR each target in plan.seed_targets:
       SWITCH target.strategy:
         "sql-load":                                       # postgres / mysql / sqlite — shared row-shaping
            rows = shape_entities(dataset)                 # entity JSON → relational rows (one mechanic)
            SWITCH target.kind:
              "postgres": deliver via COPY into the postgres service
              "mysql":    deliver via LOAD DATA into the mysql service
              "sqlite":   write a seeded <kind>.sqlite DB file (INSERTs) to a known mounted path
         "mount":                                          # provisioned, no native loader yet (redis/mongo)
            place the realised dataset at a known mounted path the service can read; record a note
  3. exit 0 if every sql-load target loaded (and mount targets placed); non-zero if any sql-load delivery errored
```

**v1 strategy coverage** (resolved scope): **`sql-load`** covers **postgres + mysql + sqlite** — one row-shaping mechanic, three delivery adapters (COPY / LOAD DATA / sqlite file). **`mount`** is the placed-but-not-imported fallback for **redis + mongo** (provisioned, seeded by their own loaders once **FAFF-271** / **FAFF-272** land) and any other relational-shaped store without an adapter yet. There is **no silent-skip**: an unknown kind never reaches seeding — it failed loud at compose-gen (§4.2).

**Anti-pattern:** declaring `status: ready` before seeding completes. Why: FAFF-30 §1 makes a seeded env the precondition of a trustworthy evaluation; a ready handle over an empty datastore silently degrades FAFF-34. (A `mount` store coming up un-imported is allowed for redis/mongo in v1, but is carried as a `note` on the handle — never claimed as seeded.)

### 4.5 Failure modes — how the approach falls over, and how you'd notice

- **The failure:** compose-gen's `DATASTORE_TABLE` doesn't cover the team's actual stack. **How you'd know:** `plan.unprovisionable[]` is non-empty → the producer emits `status: failed` + a violation naming the kind(s). **What it means:** narrow — a human extends the table (one row) and re-runs; the env is **never** silently shipped incomplete. This is the resolved behaviour, by design.
- **The failure:** a `mount` store (redis/mongo) is treated as seeded when it is only provisioned. **How you'd know:** the handle carries a `note` ("redis provisioned but unseeded (FAFF-271)") and no `sql-load` ran for it. **What it means:** proceed for v1 — the note is honest; FAFF-271/FAFF-272 close the gap. An evaluation that *needs* seeded redis/mongo data must wait on those tickets.
- **The failure:** health checks pass but the service isn't actually usable (a too-shallow probe — TCP-open ≠ query-ready). **How you'd know:** `env up` returns ready but the seed step's first real `sql-load` delivery errors. **What it means:** proceed — the seed step is itself the deeper probe; a seed failure tears down and returns `status: failed`, so a shallow health check can't produce a falsely-ready handle.
- **The failure:** docker exists in dev but not in CI, so the live path is never actually exercised by the gate. **How you'd know:** the docker-gated tests report **skipped** in CI logs. **What it means:** proceed but name it — the compose-gen unit tests (which always run) cover the deterministic core; the live tests run wherever docker exists (local, or a docker-enabled CI lane). This is the issue's own "actually-tested where docker exists" bar, not a gap to hide.

## 5. Scenarios — born-verifiable main objectives

```
Given an infra-profile with datastores [postgres] and a container-image deploy target
When `faff env compose-gen` runs
Then it writes a compose file and prints a ProvisionPlan with a postgres service, an app service
     built_from the Dockerfile, a non-empty health_checks[], an empty unprovisionable[], and a deterministic project_name
```

```
Given the same infra-profile run through `faff env compose-gen` twice
When the two outputs are compared
Then the compose file and the ProvisionPlan are byte-identical (no timestamps, no random suffix)
```

```
Given an infra-profile naming a datastore kind not in DATASTORE_TABLE (e.g. cassandra)
When `faff env compose-gen` runs and the producer evaluates the plan
Then plan.unprovisionable[] contains "cassandra" and the producer emits status: failed + a violation
     naming it → contract exit 1 (never a ready handle over an incomplete env)
```

```
Given an infra-profile with [postgres, mysql, sqlite, redis]
When the producer provisions (docker available)  [docker-gated]
Then postgres+mysql+sqlite are sql-load seeded, redis provisions + is health-checked but carries an
     "unseeded (FAFF-271)" note, and the ready handle is accepted by `faff contract env-handle` at exit 0
```

```
Given docker is available and a `build` proposal + infra-profile  [docker-gated]
When the producer runs provision()
Then `faff env up` brings the stack up, health checks pass within 60s, `faff env seed` loads the dataset,
     and the emitted env-handle is accepted by `faff contract env-handle` at exit 0 with status: ready
     (FAFF-30 §5 scenario 1 + 3, now executed)
```

```
Given docker is available and health checks that never pass within the SLA  [docker-gated]
When the producer runs provision()
Then the stack is torn down (`faff env down`) and the handle is status: failed → contract exit 1
     (FAFF-30 §5 scenario 5, now executed)
```

```
Given docker is NOT available
When the producer runs provision()
Then compose-gen still produces a plan, the up preflight fails cleanly, and the handle is
     status: failed + violations → contract exit 1; the live integration tests report skipped, not failed
     (FAFF-30 §5 scenario 6, now executed/skip-aware)
```

```
(assertion) compose-gen is pure: `faff env --selftest` runs its fixture-profile cases with no docker and exits 0,
            and is wired into validate.yml alongside the other selftests.
```

## 6. Design Decision Rationale

**Where does compose generation live — producer prose vs CLI helper?**
- *Producer prose:* zero new CLI surface, but untestable and non-deterministic — the exact failure FAFF-270 exists to fix.
- *CLI helper (`faff env compose-gen`):* unit-testable without docker, deterministic, reusable. **Chosen:** the helper — it is the "testable mechanical part" the issue names, and matches the `faff profile`/`faff fixtures` precedent.

**Live docker path — buried in the producer vs `faff env` verbs?**
- *Buried:* fewer moving parts, but not independently testable and not reusable by FAFF-34/FAFF-29.
- *`faff env up`/`seed`/`down` verbs:* docker-gated integration tests, reusable by the two downstream consumers. **Chosen:** the verbs.

**compose-gen output — YAML only vs YAML + provision plan?** **Chosen:** YAML + a JSON provision plan, so the env-handle's `endpoint`/`health_checks`/`seed_targets`/`unprovisionable` are derived once, deterministically, and the producer fills the handle by copying plan fields rather than re-deriving in prose.

**Unknown datastore kind — silent skip vs fail loud?**
- *Silent skip (+ note):* the env comes up "ready" missing a store the system needs; FAFF-34 then passes against a wrong env. Unacceptable for an L4 trust substrate.
- *Auto-synthesise an image/loader:* a guess; a guessed env is exactly what can't be trusted.
- *Fail loud + escalate:* report in `unprovisionable[]`, producer emits `status: failed` + violation, human extends `DATASTORE_TABLE`. **Chosen:** fail loud — the env table is the one extension point, and a gap there is loud, not silent. (Resolved interactively 2026-06-28.)

**Seed-loader breadth — how many engines auto-seed in v1?**
- Options weighed: postgres-only · postgres+mysql · the common four.
- **Chosen:** a shared **`sql-load`** strategy covering **postgres + mysql + sqlite** (one row-shaping mechanic, per-engine delivery — they follow the same relational mechanic), with **redis + mongo** split to **FAFF-271** / **FAFF-272** (engine-native loaders) and reaching `mount` (provisioned-but-unseeded + note) until then. Rationale: the relational three share an adapter so they're cheap together; redis/mongo need genuinely different importers, so they're their own slices; future stores extend the table or fail loud. (Resolved interactively 2026-06-28.)

**Health-wait SLA / poll cadence?** **Chosen:** `sla_secs=60`, `poll_secs=2`, engine-native probes, overridable via `--sla-secs`/`--poll-secs`. Rationale: fast-fail default suited to local compose (containers up in seconds); tunable for heavier images. (Resolved interactively 2026-06-28.)

**Docker-in-CI — require it vs skip-gate it?** **Chosen:** skip-gate — live tests run where docker exists, skip (not fail) where it doesn't; the deterministic compose-gen tests always run. Rationale: matches the issue's "actually-tested where docker exists" and keeps the default CI lane green without docker.

## 7. Open Questions and Assumptions

**Open Questions (Punts):** none — both former Punts (seed-loader breadth; health-wait SLA) were resolved interactively on 2026-06-28 and are closed to `**Chosen:**` decisions in §6; redis/mongo loaders are tracked by FAFF-271 / FAFF-272.

**Assumptions (validate at build start):**

- **Assumes:** `docker` + `docker compose` are available wherever the *live* path runs (dev or a docker-enabled CI lane). Validate: `docker info` in the `up` preflight; absence is a clean `status: failed`, never a crash — and the live tests skip. (Carried from FAFF-30 §6.)
- **Assumes:** `faff profile show --json` returns a schema-1 infra-profile with `runtimes`/`datastores`/`deploy_targets`. Validate: run it in the repo and confirm the shape before wiring compose-gen (`bin/faff` `mineRepo` ~L6474–6575 populates these).
- **Assumes:** `faff fixtures realise` emits per-entity JSON shape-able into relational rows by the `sql-load` strategy. Validate: inspect its output dir shape (`bin/faff` ~L6906) before writing the adapter.
- **Assumes:** the `env-handle` contract shape is unchanged and sufficient to carry everything the producer emits (incl. `notes` for the unseeded `mount` stores). Validate: re-read `env-handle.schema.json`; if a field is genuinely missing, that is a separate contract issue (out of scope here).

## 8. DONE — Definition of Done

### From WHY
- [ ] A real env stands up: the producer executes (not narrates) provision → health-wait → seed → teardown, proven by a docker-gated test reaching `status: ready`.
- [ ] An unprovisionable datastore kind makes the producer emit `status: failed` + a violation — never a silently-incomplete `ready` env.

### From WHAT (CLI + types)
- [ ] `faff env` command exists in the `COMMANDS` map with `compose-gen` / `up` / `seed` / `down` / `--selftest` subcommands, mirroring `faff profile`/`faff fixtures` dispatch.
- [ ] `faff env compose-gen` prints a `ProvisionPlan` (schema 1) with the §3 fields (incl. `unprovisionable[]`, `seed_targets[]`) and writes a compose file to `--out` (default `.faff/env/docker-compose.yml`).
- [ ] The `ProvisionPlan.health_checks[]` shape matches `env-handle.health_checks[]` (name/path/expected_status).

### From HOW (compose-gen, deterministic)
- [ ] compose-gen maps `profile.datastores` via the `DATASTORE_TABLE` (postgres/mysql/sqlite/redis/mongo rows) and emits an `app` service `built_from` the Dockerfile when `deploy_targets` has `container-image`.
- [ ] A datastore kind absent from `DATASTORE_TABLE` is added to `plan.unprovisionable[]` (not skipped).
- [ ] sqlite is handled file-based: a `<kind>-file` seed target, `file_based:true`, no compose service / no health check / excluded from endpoint precedence.
- [ ] compose-gen output is byte-identical across two runs on the same profile (no timestamps, no random suffix).
- [ ] `endpoint` precedence: app service URL when present, else the first non-file-based datastore's URL.

### From HOW (live verbs — docker-gated)
- [ ] `faff env up` preflights `docker info`, runs `compose up -d`, and health-waits to `--sla-secs` (default 60, poll 2s); exits non-zero on timeout.
- [ ] `faff env down` runs `compose down -v` and is idempotent (absent project → exit 0).
- [ ] `faff env seed` runs `faff fixtures realise` then loads per `seed_targets`: `sql-load` for postgres (COPY) / mysql (LOAD DATA) / sqlite (DB file); `mount` for redis/mongo; exits non-zero only on a real `sql-load` delivery error.
- [ ] On unprovisionable / health timeout / seed failure the producer emits `status: failed` (+ `env down` for the docker cases) — no stack is left up.

### From HOW (producer rewire)
- [ ] `faffter-noon-env-compose/SKILL.md` §4.1 steps call the `faff env` verbs (not prose), gate on `plan.unprovisionable[]`, and fill the handle from the provision plan; still passes `validate-adapters` as `producer-env`.

### From Scenarios (tests)
- [ ] compose-gen unit tests (`test/env.test.mjs` or equiv) cover: plan shape, determinism (byte-identical), app-service-from-Dockerfile, unknown-kind → `unprovisionable[]`, sqlite file-based handling, endpoint precedence — all run **without** docker.
- [ ] `faff env --selftest` exits 0 and is wired into `.github/workflows/validate.yml`.
- [ ] Docker-gated integration tests cover FAFF-30 §5 scenarios 1/3/5/6 (ready happy-path + seeded-before-ready across postgres/mysql/sqlite, redis-unseeded note, health-timeout teardown→failed, docker-absent→failed); they **skip** (not fail) when `docker info` fails.

### Integration smoke test
```
Given docker available and a repo whose `faff profile show --json` lists a postgres datastore
When `faff env compose-gen | faff env up && faff env seed` runs, then the producer emits the handle
Then `faff contract env-handle` accepts it at exit 0 (status: ready, endpoint set, health_checks non-empty),
     and `faff env down` tears the stack down cleanly
```

confidence: high

## Methodology critique

> Methodology: faffter-dark-methodology-agile-delivery (issue-critique)

- **Right-sized?** Now well-sized as one. Resolving the Punts split redis/mongo loaders out to FAFF-271/FAFF-272, leaving a cohesive core: compose-gen + the three relational `sql-load` adapters + the live verbs + the producer rewire + tests. The relational adapters share one mechanic so they land together cheaply; the genuinely-different importers became their own tickets. The earlier "borderline-large" concern is resolved by that split.
- **Workstream fit?** Good. Sits in *"Down the pub — trustworthy lights-out v1 (L4)"* on the PROVISION→EVALUATE chain, outcome-named — it's the hardening that unblocks the evaluator. FAFF-271/FAFF-272 sit beside it as extension slices. No action.
- **Deps surfaced?** Clean. `blocks FAFF-34` drawn; `blockedBy` correctly empty (FAFF-30 shipped); FAFF-271/FAFF-272 created as `relatedTo` extension slices; consumed-from FAFF-26/FAFF-31 captured as `**Assumes:**`. No missing edge.
- **Risk profile?** Novel-integration risk (first live docker provisioning + datastore seeding) is now narrowed to the relational `sql-load` path; the docker-gated tests are the de-risking instrument, and the fail-loud-on-unprovisionable rule removes the silent-wrong-env failure mode entirely. No separate spike needed; the live verbs + the three sql-load adapters are the review watch-area.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
