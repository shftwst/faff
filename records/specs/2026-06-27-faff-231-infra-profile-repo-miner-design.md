# Spec — FAFF-231: Infra/PaaS context profile — repo-mining acquirer (slice 2 of 2)

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: high.

> **Revised 2026-06-26 (iterate).** The slot-registration Punt is resolved → **Chosen: register the public `profile` slot now** (three small additions — see §6). The satisfied `blockedBy FAFF-26` edge is removed (FAFF-26 is Done / PR#167, so the contract this emits against is present — verified `faff profile validate|show` exists). Confidence medium → high; no open Punts.

This is the build spec for the **default `profile`-slot occupant**: a deterministic, read-only repo-miner that scans a repository for infrastructure artifacts and emits a `faff-contract:infra-profile` block conforming to the FAFF-26 schema. Slice 1 (FAFF-26, Done, PR#167) shipped the schema + `faff profile validate|show` CLI this miner emits against; this slice ships the first thing that actually *populates* a profile.

## 1. WHY — Problem and Principles

**The load-bearing model: the miner is an archaeologist, not a probe.** It learns a repo's infra by reading artifacts already committed to it — CI workflows, Dockerfiles, IaC, PaaS manifests, language manifests — and reports *evidence-bearing facts* (every claim cites the file it came from). It never runs, installs, or reaches the network. FAFF-26's CLI already enforces the citation discipline (every list entry must carry non-empty `evidence`).

**Problem statement.** FAFF-26 shipped the `InfraProfile` schema and `faff profile validate|show` CLI but deliberately shipped *no acquirer*, so `.faff/infra-profile.json` is never populated. This slice ships the first acquirer (the repo-miner).

**Design principles:**
- **Read-only archaeology (constraint ①).** No network, install, or build calls — pure file inspection. Shelling out to `terraform init`/`docker`/`npm install` is a hard violation.
- **Evidence or it didn't happen.** Every runtimes/ci/deploy_targets/datastores entry carries a non-empty `evidence` naming the artifact path; FAFF-26's `validateProfile` rejects empty evidence.
- **Recall over precision (v1).** Mining rules are small and tuned to catch real artifacts even at the cost of occasional noise.
- **Acquirer writes nothing but its emitted block (ADR 0013).** The miner emits a `faff-contract:infra-profile` block and stops. The *orchestrator* writes `.faff/infra-profile.json` after `faff profile validate` passes; the `.faffrc.yaml infra:` override block is human authority, never touched by the miner.

## 2. OUT OF SCOPE
- Intake-Q&A / learned-over-projects acquisition (a different acquisition *mode*).
- Multi-mode conflict merge (only one acquirer in v1).
- Re-acquire-on-drift (orchestration policy).
- PaaS-MCP probing (violates read-only archaeology).
- Wiring the orchestration that *invokes* the profile slot. Registering the slot (this slice) ≠ invoking it.

## 3. WHAT — Types and Interfaces

The miner emits **one** fenced `faff-contract:infra-profile` block whose body is the `InfraProfile` JSON (schema owned by FAFF-26):

- `schema: 1`, `acquired_at` (ISO now), `acquired_by` (the miner's name), optional `repo`.
- `runtimes: [{name, version?, evidence}]`, `ci: [{name, evidence}]`, `deploy_targets: [{kind, evidence}]`, `datastores: [{kind, evidence}]`, `paas_available: [String]`, `notes: [String]`.
- Every list entry's `evidence` is non-empty. The miner emits no `prefs{}` and writes no files.

**Chosen:** dedup by identity key (`name` for runtimes/ci, `kind` for deploy_targets/datastores), retaining a representative evidence path.
**Chosen:** omit `version` when not pinned — never invent infra facts.
**Chosen:** the orchestrator (not the miner) writes `.faff/infra-profile.json` after validate passes (ADR 0013).
**Chosen:** register the public `profile` slot now — the miner ships as a first-class swappable, conformance-linted slot. Three small additions (§6).
**Assumes:** the FAFF-26 schema + `faff profile validate` CLI are present and behave as explored. *(Satisfied: FAFF-26 Done / PR#167.)*

## 4. HOW — Behavior

```
PROCEDURE acquire_via_mining(repo_root):
  1. profile := { schema:1, acquired_at:now(), acquired_by:<name>, repo:resolve_repo_slug(repo_root),
                  runtimes:[], ci:[], deploy_targets:[], datastores:[], paas_available:[], notes:[] }
  2. FOR each (artifact_glob, extractor) in MINING_RULES:
       FOR each file matching artifact_glob under repo_root (read-only):
         extractor(file) APPENDS evidence-bearing entries
  3. dedupe_by_identity(profile)
  4. IF runtimes, ci, deploy_targets, datastores all empty:
       profile.notes.append("no infra artifacts discovered; minimal profile")
  5. EMIT one fenced faff-contract:infra-profile block (profile as JSON)
```

**MINING_RULES (v1):**
- `.github/workflows/*.{yml,yaml}` → `ci` github-actions + setup-node/python/go version pins as runtimes (evidenced by workflow path)
- `.gitlab-ci.yml` → `ci` gitlab-ci
- `Dockerfile*`, `**/Dockerfile` → runtime from `FROM` + `deploy_targets` container-image
- `docker-compose*.{yml,yaml}` → datastores from known images (postgres/redis/mongo/mysql)
- `*.tf`, `**/*.tf` → deploy_targets/datastores from recognised provider/resource hints
- `netlify.toml` → netlify + paas_available "netlify"; `vercel.json` → vercel; `Procfile`/`app.json` → heroku
- `package.json`/`requirements.txt`/`go.mod`/`pyproject.toml` → runtimes node/python/go + pinned version when present

**Edge cases:** same fact evidenced twice → dedupe by identity, evidence retained · unpinned version → omit `version` · unreadable/malformed artifact → skip + optional `notes`, never abort, never emit an un-cited guess · no artifacts → minimal profile note, exit success · `repo` unresolvable → omit.

**Anti-patterns:** miner shelling out to install/run anything (violates constraint ①); miner writing `.faff/infra-profile.json` itself or editing `.faffrc infra:` (violates ADR 0013).

## 5. Scenarios

```
Given a repo with .github/workflows/ci.yml (setup-node @ 20) and docker-compose.yml (a postgres service)
When the repo-miner runs
Then it emits one faff-contract:infra-profile block with runtimes incl {name:node,version:"20",evidence:".github/workflows/ci.yml"},
     ci incl {name:"github-actions",evidence:".github/workflows/ci.yml"}, datastores incl {kind:"postgres",evidence:"docker-compose.yml"}
And `faff profile validate <block>` exits 0
```
```
Given the faff repo itself (a CI workflow, no Dockerfile/IaC/datastores)
When the repo-miner runs
Then it emits a valid profile (ci incl github-actions; minimal-profile note iff nothing mined) — exit success, not error
```
```
Given a repo with two docker-compose files each declaring a postgres service
When the repo-miner runs
Then datastores contains a single {kind:"postgres"} entry (deduped by kind), evidence retained
```
**Assertion (constraint ①):** a full mine issues no network/install/subprocess calls — verifiable offline.

## 6. Design Decision Rationale
- **Dedup by identity vs full entry** → **Chosen: identity key**.
- **Unpinned versions: omit vs guess** → **Chosen: omit**.
- **File write: miner vs orchestrator** → **Chosen: orchestrator** post-validate (ADR 0013).
- **Register the public `profile` slot now vs defer** → **Chosen: register now**. The miner ships as a first-class swappable, conformance-linted slot. Three small additions: (1) the `slots.profile` config-schema key; (2) a `SLOT_TYPES` map entry in `plugin/skills/faff/bin/faff` so `validate-adapters` lints conformance; (3) a gateway Slots-table row. Rejected *defer-to-first-consumer* — it leaves the miner unregistered and pushes plumbing onto a Backlog consumer.

  Implementation note: per faff's deterministic-tools-over-prose tenet (and the `node --test` DONE items), the miner is a deterministic CLI command `faff profile mine` — the built-in default occupant of the `profile` slot, exactly as `faff gates run` is the built-in default of the `gates` slot. A custom occupant swapped into `slots.profile` is structurally linted via the new `SLOT_TYPES.profile` entry (it must emit the same `faff-contract:infra-profile` block).

## 7. Open Questions and Assumptions
- **Open Questions:** none — the slot-registration question resolved this iteration (register now).
- **Assumes:** FAFF-26 schema + `faff profile validate` present and behaving as explored. *(Satisfied.)*
- **Assumes:** `.faff/` is gitignored so the orchestrator's write doesn't pollute the repo.

## 8. DONE — Definition of Done
**From WHY:** miner against an infra repo → populated schema-valid profile · pure file inspection, no network/install/build (verified offline).
**From WHAT:** exactly one parseable `faff-contract:infra-profile` block · `schema:1` + ISO `acquired_at` + `acquired_by` · every list entry has non-empty evidence citing the artifact path · no `prefs{}`, writes no files.
**From WHAT (slot registration):** `slots.profile` is a recognised config key · a `SLOT_TYPES` entry for `profile` exists so `faff validate-adapters` lints the occupant · the gateway Slots table lists the `profile` slot with this miner as the default occupant.
**From HOW (rules):** each MINING_RULE populates the right list with the right evidence path (per-rule tests).
**From HOW (edges):** same fact twice → deduped by identity, evidence retained · unpinned version omitted · unreadable artifact skipped, no un-cited guess · faff's own repo → valid, exit success.
**From validation gate:** `faff profile validate <block>` exits 0 for every scenario incl. the minimal profile.

confidence: high
