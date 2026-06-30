# Spec (rev 2): `faff env` DB-tier reconcile + service ordering (FAFF-303)

> Spec: faffter-dark-nlspec · 2026-06-30 · interactive · confidence: high. Full spec on Linear FAFF-303.

> **Revised 2026-06-30 (reopen).** The original two app-tier defects this ticket filed — the build-context bug and the app-tier template ignoring the repo compose — **shipped in PR #229** (merged into `main`, `e03bd8c2`, CI-green). A fresh retest against #229 confirmed both are fixed but found `env up` still does not reach **healthy**: two *remaining* defects, on the **DB tier and ordering** rather than the app tier. This revision narrows the spec's WHAT/HOW/SCENARIOS/DONE to that remaining delta. The shipped app-tier work is recorded under **§Already shipped**, not re-litigated.

## 1. WHY — Problem and Principles

**Load-bearing model (unchanged).** `composeGen(profile, projectName, outPath, appOverride?)` is a *pure, byte-deterministic* function; `cmdEnv` is the thin docker/IO wrapper. #229 established the reconcile seam: file I/O reads the repo compose in `cmdEnv` (`envResolveAppOverride` → `extractAppOverride`) and passes an `AppOverride` *into* the pure `composeGen`, which lets the repo's real app contract win over profile defaults. The app tier is now reconciled. **The datastore tier is not** — and nothing orders the app behind it.

**Problem statement.** On the P1 fixture (Node 20 app on :3000 requiring a `DATABASE_URL`, + Postgres, its own compose + Dockerfile, green under plain `docker compose up`), after #229 `env up` builds the app and wires its env correctly, but **still ends in "health checks did not pass within SLA"**:

- **Defect 1 — DB-tier role/db never created.** The generated Postgres service is synthesized from `DATASTORE_TABLE.postgres`, whose only env is `{POSTGRES_HOST_AUTH_METHOD: "trust"}` (`bin/faff` L7478). So it has just the default `postgres` role + `postgres` database. The app env (lifted + host-realigned from the repo compose by #229) carries a connection string expecting a role **and** database both named `linkshortener` — which are never created, so the app fail-fasts on connect. The app-tier reconcile landed; the **matching db-tier reconcile did not**: `extractAppOverride` captures the *app* service's contract but never the repo *datastore* service's `POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD`.
- **Defect 2 — no service ordering.** The synthesized app service (`composeGen` L7783-7801) has no `depends_on`, and `renderCompose` (L7716-7755) emits no `depends_on` at all. A connect-at-boot app (no retry) therefore starts immediately, races Postgres, and exits connection-refused.

**Proof these are the only remaining blockers (from the human retest, 2026-06-30):** taking the exact faff-generated compose and patching *only* those two things — give Postgres a `linkshortener` user+database, add `depends_on: {postgres: {condition: service_healthy}}` on the app — brings the identical stack up healthy in ~6s, `/healthz` → 200.

**Design principles (carried from rev 1, still binding).**

- **`composeGen` stays pure + byte-deterministic.** All filesystem reads happen in `cmdEnv` and are passed *into* `composeGen` as plain data. The new db-tier values ride the same `AppOverride` already threaded through; no new I/O in `composeGen`.
- **The repo's real compose is the source of truth** for the app **and** datastore contract when present; profile defaults are the fallback, never the reverse.
- **Fail toward the existing behaviour (the load-bearing byte-identical invariant).** When no repo compose is present, `appOverride` is `null` and output stays **byte-identical** to today (the `envSelftest` pin). Both new behaviours are part of the repo-compose reconcile path — gated on `appOverride` presence — so the no-repo-compose path is untouched.
- **No dependency on absent tools.** Unchanged; the db-tier change adds only compose `environment:` keys and a `depends_on:` block.

**Reference context.**

| Symbol (`plugin/skills/faff/bin/faff`) | Role | Change |
|---|---|---|
| `DATASTORE_TABLE` (L7477) | datastore kind → image/port/probe/env | source of the default db env to merge over |
| `extractAppOverride` (L7659) | repo-compose → `AppOverride` (pure) | also capture per-kind repo datastore env |
| `envResolveAppOverride` (L7704) | file I/O wrapper (impure) | unchanged (still the only reader) |
| `composeGen` (L7761) | pure synthesis | merge db env; set app `depends_on` |
| `renderCompose` (L7716) | deterministic renderer | emit `depends_on:` (long-form) |
| `envSelftest` (L8026) | pure determinism + reconcile cases | add db-env + depends_on cases |

## 2. OUT OF SCOPE

- **Wholesale repo-compose adoption / full service-graph fidelity** (multi-app, arbitrary `depends_on` graphs, networks, volumes). Unchanged from rev 1 — the env lane stays built around the generated ProvisionPlan.
- **`depends_on` for the profile-default (no-repo-compose) app.** Emitting ordering unconditionally would break the byte-identical-when-no-repo-compose pin (load-bearing). The profile-default app is a synthetic stand-in, not a real contract; ordering rides the reconcile path only. *Extension point:* a future unconditional ordering pass that also re-baselines the selftest.
- **Datastore image/port/probe synthesis** — still profile-driven via `DATASTORE_TABLE`. Only the **auth env** (role/db/password) is reconciled from the repo, because that is what the app's connection string binds to.
- **In-container endpoint addressing** (compose-network service-name vs `localhost:published-port`) — still the ticket's flagged "environment, not a faff bug" → FAFF-305.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| Repo datastore service | a repo-compose service whose image maps to a `DATASTORE_TABLE` kind (already detected for host-realignment as `db_service_renames`). |
| DB-env reconcile | lifting that service's declared `environment` (the auth vars that create the role/db/password) onto the **generated** datastore service of the same kind. |
| Healthy-ordering | a `depends_on` from the app onto each generated datastore service that has a healthcheck, with `condition: service_healthy`. |

`AppOverride` gains one field (everything else unchanged from #229):

```
RECORD AppOverride:
  … (build_context, dockerfile, ports, environment, healthcheck_test, health_path, app_service_name, db_service_renames) …
  db_env: Map<kind, Map<String,String>>   # generated-kind-name → that repo datastore service's environment (auth vars).
                                          # {} when the repo declares none. Keyed by the SAME kind name composeGen synthesizes.
```

**`composeGen` signature is unchanged** — `db_env` rides the existing optional `appOverride` arg (no new parameter; the pure/impure boundary is untouched).

**Design decisions.**

- **`**Chosen:**`** DB-env reconcile lives in the **same seam** as the app-tier reconcile: `extractAppOverride` (pure) reads each repo datastore service's `environment` into `db_env` keyed by its mapped kind; `composeGen` (pure) merges it onto the generated datastore service. No new file I/O. (Mirrors #229's app-tier split exactly — rationale §6.)
- **`**Chosen:**`** Merge order is **default-then-repo**: generated datastore `env = { ...DATASTORE_TABLE[kind].env, ...db_env[kind] }` (repo values win). The default `POSTGRES_HOST_AUTH_METHOD: trust` is **kept** unless the repo overrides it, so the app connects even if a `POSTGRES_PASSWORD` is present but mismatched, while `POSTGRES_USER/DB` still create the wired role/database. (Rationale §6.)
- **`**Chosen:**`** Ordering is emitted **gated on `appOverride` presence** (the reconcile path), not unconditionally — preserving the byte-identical-when-no-repo-compose invariant. `composeGen` sets `app.depends_on = { <name>: {condition: "service_healthy"} }` for **every generated datastore service that carries a `health_check`**. (Rationale §6.)
- **`**Chosen:**`** `renderCompose` emits the **long-form** `depends_on:` map (`<svc>:` → `condition: service_healthy`), after the app's other keys, in stable order — never the short-list form (which lacks the health condition).

## 4. HOW — Behaviour

**Extraction (`extractAppOverride`, pure).** After computing `db_service_renames`, also build `db_env`: for each repo service whose image maps to a kind, `db_env[kind] = normaliseEnv(service.environment)` (reuse the existing `normaliseEnv`; list- or map-form). Key by the **generated kind name** (the value side of `db_service_renames`, i.e. the same name `composeGen` will synthesize), so application is a direct lookup. A repo datastore service with no `environment` contributes `db_env[kind] = {}`. Fail-closed semantics are inherited: any parse failure already returns `null` from the whole extractor.

**Synthesis (`composeGen`, pure).**

```
PROCEDURE composeGen(profile, projectName, outPath, appOverride):
  dbEnv := (appOverride && appOverride.db_env) || {}
  FOR each datastore kind synthesized (non-file-based):
     base := DATASTORE_TABLE[kind].env || {}
     service.env := { ...base, ...(dbEnv[kind] || {}) }     # repo auth vars win; trust kept unless overridden
  ... app synthesis (unchanged from #229) ...
  IF appOverride != null:                                    # reconcile path only — preserves byte-identical when null
     healthyStores := generated datastore services that have a health_check
     IF healthyStores non-empty:
        app.depends_on := { <each store name>: { condition: "service_healthy" } }
  ... endpoints/plan unchanged ...
```

**Render (`renderCompose`).** When `s.depends_on` is a non-empty map, after the service's other keys emit:

```
    depends_on:
      <storeName>:
        condition: service_healthy
```

stable-ordered by store name. Absent/empty `depends_on` → no block (so every existing rendered service is byte-identical).

**Edge cases & precedence.**

- No repo compose (`appOverride == null`) → `db_env` empty, no `depends_on` → **byte-identical to today** (selftest pin holds).
- Repo declares the datastore service but **no** `environment` → `db_env[kind] = {}` → generated datastore keeps `DATASTORE_TABLE` defaults (today's behaviour); app still gets ordering. Degrade, don't crash.
- Repo names a datastore env (e.g. `POSTGRES_PASSWORD`) but the app's connection string omits it → harmless; the role/db are still created, `trust` still admits the app.
- A generated datastore with **no** healthcheck (none today, but defensively) → excluded from `depends_on` (can't gate on `service_healthy`).

**Failure modes.**

- DB-env reconcile lifts an env var that conflicts with `trust` → the app may need a password; keeping `trust` + the lifted `POSTGRES_PASSWORD` means the role is created *and* trust admits the app → robust. Signal if wrong: app still connection-refused at boot (would show in the integration test).
- `depends_on` references a datastore whose healthcheck never goes healthy → the app stays `created`, `env up` reports the SLA failure exactly as today (no regression, just honest).

**Anti-patterns (unchanged):** reading the repo compose inside `composeGen`; parsing it with `parseYamlSubset`. Both rejected — the reconcile data is extracted in `cmdEnv` via the dedicated `parseComposeSubset`/`extractAppOverride` and passed in.

## 5. SCENARIOS

```
Given a repo compose with a postgres service declaring POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD=linkshortener,
  plus a build app whose env wires a DATABASE_URL to role+db linkshortener
When `faff env compose-gen` runs
Then the generated postgres service's environment includes POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD=linkshortener
  (merged over the trust default), so the wired role + database are created
```
```
Given that generated compose
When the app service is rendered
Then it carries depends_on: { postgres: { condition: service_healthy } }
```
```
Given the P1 fixture (Node app :3000 + its own postgres compose) and docker available
When `faff env up` runs
Then both services reach healthy within SLA and `/healthz` returns 200 (the SUT-run failure no longer reproduces)
```
```
Given a profile with NO repo compose
When `faff env compose-gen` runs
Then the output is byte-identical to the pre-change behaviour: no db-env reconcile, no depends_on (additive guarantee)
```

## 6. DESIGN DECISION RATIONALE

**Where does the DB-env reconcile live?** Read inside `composeGen` (breaks the pure/deterministic invariant the selftest pins) vs read in `cmdEnv` + pass via `AppOverride`. **Chosen:** the latter — identical to #229's app-tier split; `db_env` is just more reconcile data on the same record.

**How to merge the datastore env?** Replace the default wholesale (loses `trust`, risks locking the app out) vs default-then-repo (repo wins, `trust` kept). **Chosen:** default-then-repo — creates the wired role/db while `trust` guarantees the app can still authenticate; the safest superset.

**Emit `depends_on` always, or only on the reconcile path?** Always (more correct for the profile-default app, but breaks the load-bearing byte-identical-when-no-repo-compose pin and forces a selftest re-baseline) vs gated on `appOverride`. **Chosen:** gated — the byte-identical invariant is architecturally load-bearing (rev 1, §6); the no-repo-compose app is a synthetic stand-in. Unconditional ordering is a named extension point.

**`depends_on` shape?** Short list (`- postgres`) lacks the health condition → still races. **Chosen:** long-form `condition: service_healthy`, the only shape that actually waits.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking.

**Assumes.**
- **Assumes:** the repo datastore service declares the auth env that creates the role/db the app's connection string binds to. *Validate:* when it declares none, `db_env[kind]={}` → generated datastore keeps defaults (today's behaviour); no crash, app may still fail-fast (surfaced by the integration test), which is the honest signal.
- **Assumes:** every generated (non-file-based) datastore service carries a healthcheck, so `condition: service_healthy` is satisfiable. *Validate:* `DATASTORE_TABLE` gives each a `probe` today; the `depends_on` builder filters to services that actually have a `health_check`, so a probe-less kind is simply not gated on.
- **Assumes:** keeping `POSTGRES_HOST_AUTH_METHOD: trust` alongside a lifted `POSTGRES_PASSWORD` is acceptable for a throwaway eval stand-in. *Validate:* it only widens who can connect to a localhost-only ephemeral container; never used for a real deployment.

## 8. DONE — Definition of Done

**From WHY**
- [ ] `faff env up` on the P1 Node 20 + Postgres fixture (its own compose) brings **both** app and postgres to healthy via the env lane; `/healthz` → 200 (the reopened failure no longer reproduces).

**From WHAT / HOW**
- [ ] `extractAppOverride` populates `db_env` keyed by generated kind-name from each repo datastore service's `environment` (`{}` when none).
- [ ] `composeGen` merges generated datastore env as `{ ...DATASTORE_TABLE[kind].env, ...db_env[kind] }` (repo wins, `trust` kept unless overridden).
- [ ] `composeGen` sets `app.depends_on = { <store>: {condition: service_healthy} }` for each generated datastore with a healthcheck, **only when `appOverride` is present**.
- [ ] `renderCompose` emits the long-form `depends_on:` block (stable-ordered); absent/empty → no block.

**From edge cases**
- [ ] No repo compose → no db-env reconcile, no `depends_on` → byte-identical to pre-change (selftest pin holds).
- [ ] Repo datastore service with no `environment` → defaults kept, no crash.

**From regression coverage**
- [ ] `envSelftest` gains pure cases: (a) `appOverride` null ⇒ byte-identical to the existing pg+app case (no db-env, no depends_on); (b) an override whose `db_env.postgres` sets USER/DB/PASSWORD ⇒ the rendered postgres service carries them merged over `trust`; (c) the same override ⇒ the rendered app carries `depends_on: {postgres: {condition: service_healthy}}`.
- [ ] The docker-gated integration test (skipped when docker absent, FAFF-270 pattern) is upgraded to stand up the **app + postgres** fixture and assert the **app** reaches healthy end-to-end (not postgres alone).

**From docs**
- [ ] `docs/guide/cli.md` env row notes the datastore auth-env reconcile + app ordering.
- [ ] `faffter-noon-env-compose/SKILL.md` notes the datastore contract + ordering are reconciled from the repo compose when present (one line; no contract change).

## Already shipped against this surface

- **PR #229** (merged `e03bd8c2`, this ticket's first slice) reconciled the **app tier** (port, healthcheck, env, build context) and resolved the build-context bug via `--project-directory <root>`. Those two defects are **fixed and verified** by the human retest — this revision does not touch them; it adds the **db-tier auth-env reconcile** + **service ordering** that #229 left, in the same reconcile model.
- **FAFF-270** (Done) hardened the datastore *lifecycle* (postgres health-wait, seed); it did not reconcile the datastore *auth contract* against the repo compose. Related-not-superseding.

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (agile-delivery) · interactive, non-blocking._

- **Right-sized? (P4):** Two defects, but an always-ship-together pair on the same `composeGen`/`renderCompose` surface — the role/db must exist *and* the app must wait for it before the fixture goes healthy; neither alone clears the DONE. One CLI file + selftest + one integration test + doc sync — a single 1–2 day unit. *No issue.*
- **Workstream fit? (P1+P5):** Sits in "Trustworthy lights-out — harden & broaden (post-v1)", continuing the env-lane hardening #229 began. *No issue.*
- **Deps surfaced? (P6):** Self-contained in the CLI; no `blockedBy`. FAFF-34/FAFF-305 remain downstream consumers (unblocked by this). *No issue.*
- **Risk profile? (P7):** Low novelty — a scoped extension of the #229 pure-function reconcile already covered by `envSelftest`, fully grounded by a human retest with a proven two-line patch. The one risk (datastore env shapes) is de-risked by fail-closed extraction + the docker-gated end-to-end test. No de-risking spike warranted. *No issue.*

---

confidence: high
spec-review: approve
