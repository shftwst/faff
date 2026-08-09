# Spec: Fix `faff env` provisioning of a real app tier (FAFF-303)

> Spec: faffter-dark-nlspec · 2026-06-30 · autonomous · confidence: high. Full spec on Linear FAFF-303.

For the build agent and human reviewers. This addresses the two grounded defects FAFF-303 reports in the env lane's app-tier provisioning.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff env compose-gen` is a *pure, byte-deterministic* function from a coarse mined infra-profile to a docker-compose file + ProvisionPlan; `faff env up` is the thin docker orchestration that runs it. The env lane works for datastores (postgres/mysql/…) because their contract is fully captured by an image + port + probe in `DATASTORE_TABLE`. It fails for the **app tier** because an app's real contract — its port, health probe, required env, build context — lives in the repo's own committed compose file, and the profile is too coarse to reconstruct it.

**Problem statement.** On a production-shaped Node 20 + Postgres service that comes up green under plain `docker compose up`, `faff env up` cannot stand up the app tier: it aborts reading the Dockerfile, and even past that the synthesized app service has the wrong port, an uninstalled-tool healthcheck against the wrong path, and no `DATABASE_URL`. This blocks the holdout evaluator (FAFF-34) from reaching any app endpoint via the env lane.

**Design principles.**

- **`composeGen` stays pure and byte-deterministic.** Its determinism is asserted by `envSelftest` and is architecturally load-bearing. All filesystem reads (the repo compose) happen in the `cmdEnv` I/O wrapper and are passed *into* `composeGen` as plain data. Reject any implementation that does I/O, reads wall-clock, or randomises inside `composeGen`.
- **The repo's real compose is the source of truth for the app contract.** When a committed compose declares the app, its values win over profile-shaped defaults — never the reverse. The profile remains the source for the datastore services + seed plan (the env lane's seeding value-add).
- **No dependency on tools that may be absent.** The CLI is dependency-free Node; the generated compose must not assume `curl` (absent in `node:alpine`) — or any host tool that isn't guaranteed.
- **Fail toward the existing behaviour.** When no repo compose is present, behaviour is exactly as today (profile-shaped synthesis) — this change is additive, gated on a repo compose existing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `composeGen` (L7534), `renderCompose` (L7498), `cmdEnv` (L7653), `ENV_APP_PORT` (L7484), `envSelftest` (L7783) | Node (CLI) | The whole change surface. |
| `parseYamlSubset` (L134) | Node (CLI) | Existing YAML reader — does **not** parse sequences/nested arrays into JS arrays (stores raw scalars), so it is insufficient for a real compose file. Drives the parser decision. |
| `plugin/skills/faffter-noon-env-compose/SKILL.md` | Prose | The producer that calls these verbs; example handle is illustrative only. |
| `docs/guide/cli.md` (env row) | Docs | Must stay in sync (house rule: docs never go stale). |

**Scope statement.** This fixes the env lane's app-tier fidelity for a single-app + datastore(s) repo that ships its own compose; it does not redesign the env lane around wholesale repo-compose adoption.

## 2. OUT OF SCOPE

- **Wholesale adoption of the repo compose / full service-graph fidelity** — multi-app topologies, arbitrary `depends_on` graphs, custom networks, volumes beyond app+datastore. *Why:* the env lane's seed/teardown/health contract is built around the generated ProvisionPlan; replacing it is a redesign, not a bug-fix. *Extension point:* a future `env` mode deriving the plan from the repo compose (`composeGen` gains a `from-compose` path).
- **In-container endpoint addressing** (compose-network service-name endpoints vs `localhost:published-port`) — the ticket's reachability note, explicitly flagged "environment, not a faff bug." *Extension point:* FAFF-305 (holdout-evaluator wiring) / the `env-handle` `endpoints` shape.
- **Datastore service synthesis** — images/ports/probes for datastores stay profile-driven via `DATASTORE_TABLE`. *Extension point:* `DATASTORE_TABLE`.
- **Compose shapes beyond the common subset** (`extends`, `env_file`, anchors/merge-keys, multiple app candidates) — fall back to profile defaults. *Extension point:* the `extractAppFromCompose` reader.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Repo compose | A committed `docker-compose.yml` / `compose.yaml` / `compose.yml` / `docker-compose.yaml` at the repo root. |
| App service | The repo compose's service that has a `build:` key (the system-under-build's container), vs image-only datastore services. |
| App override | The contract fields lifted from the repo compose's app service and passed into `composeGen`. |

```
RECORD AppOverride:                 # null when no repo compose / no single buildable app service
  build_context: String            # repo-relative, from build.context (default ".")
  dockerfile: String               # from build.dockerfile (default "Dockerfile")
  ports: List<String>              # normalised "host:container"; [] => keep profile default
  environment: Map<String,String>  # app env, list- or map-form normalised; DB host realigned (see HOW)
  healthcheck_test: List<String> | String | null   # repo healthcheck.test verbatim; null => none declared
  health_path: String | null       # parsed from the test for plan/handle display, else null
  app_service_name: String         # the repo compose's name for this service (for logs)
  db_service_renames: Map<String,String>  # repo-compose datastore service name → generated (kind) name
```

```
FUNCTION composeGen(profile, projectName, outPath, appOverride?)   # appOverride optional, defaults null
  # PURE. appOverride null => today's behaviour byte-for-byte.
  # present => the synthesized `app` service's fields are overridden from it.
```

**`renderCompose` changes.** The app healthcheck branch (L7517–7519) must stop hardcoding `curl … :8080`. The `build:` branch (L7503–7505) keeps emitting a relative `context:`; correctness comes from `--project-directory` at run time, plus the override's `build_context`/`dockerfile`.

**Design decisions** (rationale in §6): build-context → `--project-directory <root>`; reconciliation locus → read in `cmdEnv`, pass into pure `composeGen`; parsing → minimal targeted extractor; healthcheck → repo's verbatim else non-curl probe; DB host → realign to generated kind-name.

## 4. HOW — Behavior

Two seams change: **`cmdEnv`** (I/O, impure) reads + extracts an `AppOverride` from the repo compose at `root` and passes it into `composeGen`, and adds `--project-directory <root>` to the `up` docker calls; **`composeGen`** (pure) accepts the optional `AppOverride` and overrides the synthesized `app` service when present.

**Behavior summary — reconcile the app service.** When the repo ships a compose that already stands the app up correctly, the generated env reproduces *that* app contract, not a profile guess; generated datastores + seed plan are unchanged.

```
PROCEDURE cmdEnv_resolve_override(root):
  1. Find the first existing repo compose among
     [docker-compose.yml, docker-compose.yaml, compose.yaml, compose.yml] at root.
     IF none -> return null.
  2. extractAppFromCompose(file):
     a. Parse the common compose subset (services map; per service: build, image,
        ports, environment, healthcheck). Tolerant: any parse failure -> return null.
     b. app_service := the service WITH a `build:` key. IF zero or >1 -> return null (multi-app: OUT OF SCOPE).
     c. Normalise: build_context (build.context | "."), dockerfile (build.dockerfile | "Dockerfile"),
        ports (list of "h:c"; long-form {published,target} -> "published:target"),
        environment (list "K=V" OR map -> Map), healthcheck.test (verbatim).
     d. db_service_renames := for each OTHER service whose image matches a known datastore kind
        (reuse DATASTORE_TABLE image prefixes), map its repo name -> that kind (the generated service name).
     e. Realign environment: in each value, if a URL/host equals a key of db_service_renames,
        rewrite the host to the mapped kind name (so DATABASE_URL resolves on the generated network).
     f. health_path := best-effort parse of a path out of healthcheck.test (display only), else null.
  3. return AppOverride{…}
```

```
PROCEDURE composeGen(profile, projectName, outPath, appOverride):
  ... existing datastore-service synthesis (unchanged) ...
  IF a container-image deploy target exists:
     app := default { built_from, ports:["8080:8080"], health_check:{path:"/health"}, env:null }
     IF appOverride != null:
        app.built_from   := appOverride.dockerfile
        app.build_context:= appOverride.build_context        # rendered as `context:`
        IF appOverride.ports non-empty       -> app.ports := appOverride.ports
        IF appOverride.environment non-empty -> app.env   := appOverride.environment
        IF appOverride.healthcheck_test != null ->
             app.health_check := { raw_test: appOverride.healthcheck_test, path: appOverride.health_path }
        ELSE app.health_check := image_aware_default_probe(profile, app)   # NO curl
     append app
  ... endpoints/plan unchanged; app host-port now derived from app.ports[0] ...
```

**`renderCompose` — app service.**
- `build:` → emit `context: <build_context || ".">` and `dockerfile: <built_from>`. (Relative `context` is correct because `up` now passes `--project-directory <root>`.)
- `environment:` → emit from `app.env` map (reuse the existing datastore-service emitter).
- `healthcheck:` → if `raw_test` present, emit it verbatim (`list` preserved as a YAML list, `string` as `CMD-SHELL`); else `image_aware_default_probe`. **Never** emit an unconditional `curl` probe.

```
FUNCTION image_aware_default_probe(profile, app):   # only when repo declares NO app healthcheck
  port := container port from app.ports[0] (the ":container" half), else ENV_APP_PORT
  path := app.health_check.path || "/health"
  IF profile.runtimes mentions node ->
     test: ["CMD-SHELL", node -e "http.get(:port:path) exit(status<400?0:1); on error exit 1"]
  ELSE -> test: ["CMD-SHELL", "wget -qO- http://localhost:<port><path> || exit 1"]   # busybox/alpine wget
```

**`env up` — docker invocations.** Add `--project-directory <root>` to the `up` call (L7720) and the `ps`/`exec`/`down` calls that take `-f`: `docker compose --project-directory <root> -p <project> -f <plan.compose_file> up -d`.

**Edge cases & precedence.**
- Repo compose absent → `appOverride = null` → byte-identical to today (selftest pins).
- Repo compose present but unparseable, or 0/≥2 buildable app services → `null` → profile defaults (recall-biased: degrade, don't crash).
- App declares healthcheck but no port → keep profile port default; still override env/build.
- `environment` references a DB host not matching any datastore service → left as-is (best-effort).

**Failure modes.**
- **Extractor misreads an uncovered shape** → app comes up unhealthy → *fail closed to `null`* (profile default), never a half-parsed override. Signal: health-wait fails / eval can't reach the app.
- **`--project-directory <root>` shifts all relative-path resolution** → a datastore referencing a host-relative path breaks. `DATASTORE_TABLE` is image-only today (verify); any future mount must be root-relative.
- **DB-host realign rewrites a coincidental collision** → app can't connect. Realign only hosts that exactly equal a repo-compose service name mapped to a known datastore kind.

**Anti-pattern:** parsing the repo compose with `parseYamlSubset`. Why: it does not decode YAML sequences/nested maps into JS arrays, so `ports`, list-form `environment`, and `healthcheck.test` come back unusable.
**Anti-pattern:** reading the repo compose inside `composeGen`. Why: breaks the pure/byte-deterministic invariant the selftest enforces.

## 5. SCENARIOS

```
Given a repo with a committed compose (Node app on 3000 with its own healthcheck +
  DATABASE_URL, plus a postgres service) and a mined infra-profile
When `faff env compose-gen` runs
Then the generated app service has ports 3000(:3000), the repo's healthcheck test (no curl),
  DATABASE_URL in its environment, and build context resolving to the repo root
```
```
Given that generated compose
When `faff env up` runs with docker available
Then docker compose is invoked with `--project-directory <repoRoot>`, the Dockerfile is found,
  and the app service reaches healthy within SLA
```
```
Given a repo with NO committed compose
When `faff env compose-gen` runs on the same profile
Then the output is byte-identical to the pre-change behaviour (additive guarantee)
```
```
Given a committed compose whose app declares no healthcheck, on a node runtime profile
When the app service is rendered
Then the healthcheck probe uses node's own http client (no curl assumption)
```

## 6. DESIGN DECISION RATIONALE

**How should the build context resolve to the repo root?** (a) rewrite `context:` to an absolute/`../../` path in the pure renderer; (b) generate the compose at repo root; (c) `--project-directory <root>`. (a) leaks a host path into the byte-deterministic renderer (kills determinism/portability). (b) pollutes the repo root and risks clobbering the real compose. (c) is one line at the single orchestration seam, leaves the compose file relative + portable, and is docker's intended mechanism.
**Chosen:** (c) pass `--project-directory <root>` to all `env up` docker compose invocations.

**Where does reconciliation live?** Read inside `composeGen` (impure) vs read in `cmdEnv` and pass data in. The former breaks the determinism invariant the selftest pins.
**Chosen:** read the repo compose in `cmdEnv`, extract an `AppOverride`, pass it as an optional 4th arg into the still-pure `composeGen`.

**How to parse the repo compose?** Reuse `parseYamlSubset` (can't decode the sequences/nested maps a compose needs — confirmed L134); vendor a YAML lib (CLI is dependency-free); a minimal targeted extractor.
**Chosen:** a small purpose-built extractor reading only `services.<name>.{build,image,ports,environment,healthcheck}` for the common subset, **failing closed to `null`** on anything unrecognised (recall-biased: a missed shape degrades to today's behaviour, never a crash or a wrong override).

**How to make the healthcheck image-aware?** Always curl (status quo — broken on alpine); always wget; runtime-native probe; honour the repo compose's own healthcheck (correct by construction for the real image).
**Chosen:** repo compose's `healthcheck.test` verbatim when present; when absent, a non-curl probe — node's http client for a node runtime (guaranteed present), else `wget` (busybox/alpine default).

**How to keep the app's DB URL resolvable?** The repo app's `DATABASE_URL` names the repo compose's datastore service; the generated datastore service is named by kind. If they differ, the URL won't resolve.
**Chosen:** map each repo-compose datastore service (matched by image to a known kind) to its generated kind-name, and rewrite app-env URL hosts that exactly equal such a service name. Conservative — only exact service-name matches mapped to a known kind.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. (Exotic compose shapes and full service-graph fidelity are definitively excluded in §2, not punted.)

**Assumptions.**
- **Assumes:** the target repo's app service is identified by carrying a `build:` key, and there is exactly one. *Validate:* the extractor counts `build:`-bearing services; 0 or >1 → `null` (profile fallback), so a violation degrades safely.
- **Assumes:** `node:alpine`/busybox provides `wget`, and a node-runtime container has `node` on PATH for the synthesized fallback probe. *Validate:* only relevant when the repo declares no healthcheck; the primary path (repo healthcheck verbatim) avoids it.
- **Assumes:** the generated datastore services use no host-relative paths (so `--project-directory <root>` doesn't break them). *Validate:* inspect `DATASTORE_TABLE` — all entries are image-only today.

## 8. DONE — Definition of Done

**From WHY**
- [ ] `faff env up` on a real Node 20 + Postgres repo (its own compose) stands up the app tier to healthy via the env lane (the SUT-run failure no longer reproduces).

**From WHAT**
- [ ] `composeGen` accepts an optional 4th `appOverride` arg; with it `null`/absent, output is byte-identical to pre-change (selftest pins this).
- [ ] An `AppOverride` is extracted in `cmdEnv` (not in `composeGen`) for both `compose-gen` and `up`.

**From HOW (behaviour)**
- [ ] `env up` invokes `docker compose` with `--project-directory <root>`; a `context: .` build resolves and builds.
- [ ] When a repo compose declares the app, the generated app service's port, environment (incl. `DATABASE_URL`), build context/dockerfile, and healthcheck are taken from it (app values win).
- [ ] The repo compose's `healthcheck.test` renders verbatim; no `curl` probe unless the repo itself specifies curl.
- [ ] No declared app healthcheck → synthesized probe uses node's http client (node runtime) / `wget`, never `curl`.
- [ ] App-env URL hosts matching a repo-compose datastore service name are realigned to the generated kind-name.

**From HOW (edge cases)**
- [ ] No repo compose → profile-shaped synthesis unchanged (byte-identical selftest case).
- [ ] Unparseable compose, or 0/≥2 buildable app services → `appOverride` is `null` (profile fallback), no crash.

**From regression coverage**
- [ ] `envSelftest` gains pure cases: (a) `appOverride` null ⇒ byte-identical to the existing pg+app case; (b) an override with port 3000 / env / verbatim healthcheck ⇒ rendered app reflects all three and emits no curl; (c) DB-host realign rewrites a mismatched host.
- [ ] A docker-gated integration test (skipped when docker absent, per the FAFF-270 pattern) stands up an app+postgres fixture and asserts the app reaches healthy.

**From docs**
- [ ] `docs/guide/cli.md` env row updated to note repo-compose reconciliation + `--project-directory` resolution.
- [ ] `faffter-noon-env-compose/SKILL.md` notes the app contract is reconciled from the repo compose when present (one line; no contract change).

**Integration smoke test.**
```
Given the P1 link-shortener fixture (Node app :3000 + postgres, its own compose + Dockerfile)
  faff profile mine --json > .faff/infra-profile.json
  faff env compose-gen        # app: ports 3000, repo healthcheck, DATABASE_URL, context->root
  faff env up                 # docker compose --project-directory <root> …; app + postgres healthy
Then `env up` exits 0 with both services healthy
```

## Already shipped against this surface

- **FAFF-270** (Done — *Harden live compose provisioning*) hardened the `env` lane's **datastore** path (postgres lifecycle, health-wait, seed loaders) and is this ticket's named predecessor. It did **not** cover app-tier fidelity (the generated app service still hardcodes `8080`/`curl`/`/health` with no env, and the build context is unresolved) — so its premise does not supersede this fix. Related-but-not-superseding; the delta here (app-tier reconciliation + build-context resolution) is wholly un-delivered.

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (agile-delivery) · autonomous, non-blocking._

- **Right-sized? (P4):** Two defects, but an always-ship-together pair. Merging is correct; no split. One CLI file + doc sync, a single 1–3 day unit. *No issue.*
- **Workstream fit? (P1+P5):** Sits in "Trustworthy lights-out — harden & broaden (post-v1)" and hardens the env lane — coherent. *No issue.*
- **Deps surfaced? (P6):** No `blockedBy`, correctly. *No issue.*
- **Risk profile? (P7):** Low novelty. *No issue.*

---

confidence: high
spec-review: approve
