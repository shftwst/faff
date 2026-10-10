# FAFF-1213 — Give the runner a GitHub identity separate from the human's (faff-side slice)

> Spec: faffter-dark-nlspec · 2026-10-10 · interactive · claude-code/unknown · build-tier: complex · confidence: medium. Full spec on Linear FAFF-1213. Scope: faff-side slice only (operator-created identity is an external assumption). · revised 2026-10-10 (spec-review r1)

This spec is the buildable artifact for FAFF-1213, written for the build agent that will implement it and the humans who review the increment. It covers only the faff code changes: letting the runner's GitHub calls use a configured runner credential, recording which GitHub identity acted into tamper-evident run evidence, and exposing a comparison hook for Gate 1 counting (FAFF-1182). The operator half (creating the bot account or GitHub App) and the claude-box cage half (FAFF-1209) are out of scope and appear here only as assumptions and extension points.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every `gh` call faff makes today inherits the ambient process environment and no call passes an `env` option, so `gh` authenticates with whatever `GH_TOKEN` or keyring the process already has — which, in the cage, is the human's forwarded `gh auth token`. "Give the runner its own identity" therefore reduces to one move: resolve a configured runner credential, inject it as `GH_TOKEN` for faff's `gh` invocations through a single chokepoint, and record which identity that was in evidence that a compromised build lane cannot silently rewrite. The token itself is an opaque bearer string faff never interprets.

**Problem statement.** A run counts as independent only when the runner acts under a GitHub identity separate from the human's, but faff's `gh` calls currently run as the human (claude-box forwards `gh auth token`), so no "needs a human" rule — pin-change approval included — can tell runner from human. This change lets faff prefer a configured runner credential for its GitHub calls and records the acting identity in the run's tamper-evident evidence. Zero-config runs, where no runner credential is set, stay byte-identical to today.

**Design principles.**

- **Zero-config is byte-identical.** With no runner credential configured, faff must not set, clear, or reorder any environment variable `gh` reads. The ambient human token path is the untouched default, not a fallback branch with new behaviour.
- **The token is opaque and never persisted.** faff treats the credential as a bearer string, reads its value fresh per `gh` invocation, redacts it from every durable write and log, and records only the resulting login — never the secret.
- **faff prefers, it does not enforce.** faff can route its own `gh` calls through the runner credential and record the identity. It cannot stop the human's keyring or `GH_TOKEN` being present in the cage; that enforcement is FAFF-1209. Independence counting itself is FAFF-1182. This slice makes the identity available and recorded, and exposes the comparison, nothing more.
- **One chokepoint.** All of faff's `gh` invocations route through one env resolver and one spawn wrapper. A new `gh` call site added later inherits the runner identity for free; a call that bypasses the wrapper is a bug.
- **Security-relevant identity is anchored, not lane-writable.** The recorded identity is a security-relevant input to Gate 1 (FAFF-1182), so it lives in the hash-chained `events.jsonl` record that `mintIssueAnchor` freezes into the committed, head-sha-pinned anchor the level check already relies on (FAFF-690 / 623 / 1155). Gate 1 consumes the anchored copy. Copies on build-lane-writable surfaces (`run-ledger.json`, `merge-record.json`) are convenience only and are never the source Gate 1 trusts. This closes the FAFF-690 hole for identity.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JS (committed emit) | Holds 6 of the 9 `gh` sites, `ghJson`, the merge, `cmdPrCreate`, `classifyGithubAuth`/`cmdGithubAuthCheck`, and `writeMergeRecord` (merge-gate.js:475) |
| `plugin/skills/faff/bin/lib/forge-merge.js`, `review-target.js`, `prdr.js` | JS | The other 3 `gh` sites |
| `plugin/skills/faff/bin/lib/claude-config-isolation.js` | JS | `buildIsolatedChildEnv` — the inject-by-name + `{ env, redactedEnv }` masking model to mirror |
| `plugin/skills/faff/bin/lib/redact.js` | JS | `SECRET_ENV_HANDLE_KEYS` (redact.js:46), `resolveKnownSecretValues`/`redactKnownSecrets` — the known-secret redaction core; the token-env leaf registers here |
| `plugin/skills/faff/bin/lib/config.js` | JS | `loadConfig` (config.js:1153, fail-loud on a malformed `.faffrc`); `DEFAULTS`, example-drift selftest. `WRITABLE_NAMESPACES` already contains `autonomous` |
| `plugin/skills/faff/bin/lib/events.js` | JS | `appendEventRecord` (events.js:598) — the append-only `events.jsonl` path; `mintIssueAnchor`/`computeChainHead` (events.js:1474 / 1549) — the committed, head-sha-pinned anchor (FAFF-690 / 623 / 1155) |
| `plugin/skills/faff/bin/lib/governance-profile.js` | JS | `DELIVERY_PROFILE.event_types` (lines 69-129) — the closed event-type vocabulary `eventViolations` enforces; a `region:governance` file |

**Scope statement.** This sits at faff's GitHub-call boundary and its tamper-evident run-evidence anchor, between the operator-provisioned identity (upstream) and Gate 1 independence counting (downstream, FAFF-1182).

## 2. OUT OF SCOPE

- **Creating the bot account or GitHub App** — the operator provisions the identity and its token out of band. Extension point: none in faff; the token arrives as a value in `process.env` under the operator's chosen name (see Assumptions).
- **Injecting the runner credential into the cage / preventing the human token being present** — claude-box forwarding behaviour is FAFF-1209. Extension point: `libcage.sh` (external repo). faff can only prefer the runner credential, not guarantee the human's is absent.
- **The live merge-actor independence check and `independence: not-counted` reason codes** — FAFF-1182 (design-only in ADR 0135; no implementation exists). This slice records the identity in the anchored log and exposes a pure comparator; it does not add a `mergedBy` fetch or decide independence. Extension point: `githubActorMatches` (new, this slice), the anchored-evidence read, and `forge-merge.js`.
- **A separate read-only token for the governor's read probes** — ADR 0135 gives the governor its own read-only token; that is the governor path, not this runner path. Extension point: governor custody config (separate ticket).
- **Non-env credential sources (token file, token command)** — v1 is env-var-only. Extension point: `readRunnerGhConfig` / `resolveRunnerGhEnv`, which would grow additional source branches behind the same return shape. Tagged `(non-blocking)`, see Open Questions.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Runner credential | A GitHub bearer token (PAT, bot-account token, or App installation token) the runner uses instead of the human's, supplied as the value of a configured environment variable |
| Ambient token | Whatever `gh` would use with no faff intervention — the human's forwarded `gh auth token` or keyring |
| Identity source | Which credential class acted: `runner-credential` (configured token resolved and injected) or `ambient` (human token: zero-config, unresolved, or config-fault) |
| Acting login | The GitHub login recorded as the runner's identity for a run, e.g. `octocat` or `my-app[bot]` |
| Anchored evidence | The committed, head-sha-pinned byte-copy of `events.jsonl` that `mintIssueAnchor` writes into the per-PR anchor dir, witnessed by `chain-head.json`; the only identity source Gate 1 trusts |

**Config surface.** Two optional keys under the existing `autonomous` namespace (already a member of `WRITABLE_NAMESPACES`, so no new namespace and no new namespace-drift surface):

```
autonomous.runner_github_token_env : String?   # names the env var holding the runner token; absent => ambient
autonomous.runner_github_login     : String?   # optional expected login of the runner identity
```

- Both default absent. Absent `runner_github_token_env` => zero-config: faff touches no `gh` environment.
- Both must be registered in `DEFAULTS` and documented in `.faffrc.example.yaml` (the example-drift selftest, `config.js:2161`, fails otherwise). `WRITABLE_NAMESPACES` needs no change (`autonomous` is already there).
- `runner_github_token_env` names an env var; its **value** is read from `process.env`, never stored in config. This mirrors the `api_key_env` / `seat_token_env` handle convention.

**Config read result.** A narrow, fault-tolerant read of only the two keys above, decoupled from the full `loadConfig()` so a malformed `.faffrc` cannot break GitHub diagnostics:

```
RECORD RunnerGhConfig:
  tokenEnvName: String?     # autonomous.runner_github_token_env, or null
  configuredLogin: String?  # autonomous.runner_github_login, or null
  configFault: Boolean      # true iff reading .faffrc threw (malformed base/overlay, legacy name, …)
```

**Env-resolution result.** A pure classifier, fixture-testable like `classifyGithubAuth`:

```
RECORD RunnerGhEnv:
  env: Map<String,String>          # ambient env, with GH_TOKEN set iff a runner credential resolved
  redactedEnv: Map<String,String>  # same map, GH_TOKEN value masked for any logging
  identitySource: "runner-credential" | "ambient"
  tokenEnvName: String?            # the configured env var name, or null when unset
  credentialUnresolved: Boolean    # true iff tokenEnvName is set but process.env[name] is empty/absent
  configFault: Boolean             # true iff the .faffrc read threw; forces ambient with tokenEnvName null

  CONSTRAINT identitySource == "runner-credential"  IFF  env.GH_TOKEN was set by this resolver
  CONSTRAINT credentialUnresolved implies identitySource == "ambient" AND NOT configFault
  CONSTRAINT configFault implies identitySource == "ambient" AND tokenEnvName == null
  CONSTRAINT when identitySource == "ambient": env is the ambient env with GH_TOKEN untouched
```

**Recorded identity (evidence).** Never contains the token:

```
RECORD RunnerIdentityEvidence:
  github_login: String?                                   # the acting login, or null if unresolved
  github_login_source: "configured" | "gh-api-user" | "unresolved"
  credential_source: "runner-credential" | "ambient"
  credential_unresolved: Boolean                          # true iff a named token env var was empty/absent
  verified: Boolean                                       # true iff gh api user confirmed the login
```

`credential_unresolved` lets Gate 1 (FAFF-1182) distinguish a zero-config run (ambient, `credential_unresolved: false` — no separation attempted) from a configured-but-unresolved run (ambient, `credential_unresolved: true` — separation attempted and failed, which counting should treat as non-separate). A config fault records as ambient with `credential_unresolved: false` and is surfaced only through the operator warning, because a broken `.faffrc` is an environment problem rather than a separation signal.

**Interfaces (new, all in faff JS emit).**

```
readRunnerGhConfig() -> RunnerGhConfig                    # IMPURE boundary: reads .faffrc fault-tolerantly, memoised once per process
resolveRunnerGhEnv(runnerGhConfig, env) -> RunnerGhEnv    # PURE over its inputs; token VALUE read from env, never re-parses config
runGh(args, opts?) -> SpawnResult                         # impure wrapper: resolveRunnerGhEnv(readRunnerGhConfig(), process.env).env
resolveRunnerIdentity(runnerGhConfig, resolvedEnv) -> RunnerIdentityEvidence  # best-effort probe + configured-login fallback
githubActorMatches(recordedLogin, observedActorLogin) -> Boolean   # PURE; normalises trailing "[bot]"
```

**Home.** `readRunnerGhConfig`, `resolveRunnerGhEnv`, `runGh`, `resolveRunnerIdentity`, and `githubActorMatches`, plus the per-process memo and warn-once flags (see HOW), live in `merge-gate.js` alongside `ghJson`, `classifyGithubAuth`, and `writeMergeRecord`, and are exported so `forge-merge.js`, `review-target.js`, and `prdr.js` import `runGh` for their three sites.

**Design decision — namespace.** New top-level `runner:` namespace vs reuse `autonomous.*`. **Chosen:** `autonomous.*` — it already holds the GitHub-auth preflight knobs (`require_github_auth`, config.js:3294) and is already writable, so no new namespace, no `WRITABLE_NAMESPACES` edit, and the drift selftests stay green with only `DEFAULTS` + example additions.

**Design decision — credential source model.** **Chosen:** env-var-only, opaque bearer via `GH_TOKEN`, value read fresh per `gh` invocation. Token file / token command sources are deferred (Open Questions, non-blocking).

## 4. HOW — Behavior

**Architecture.** `readRunnerGhConfig()` is the single, fault-tolerant, memoised reader of the two config keys. `resolveRunnerGhEnv(runnerGhConfig, env)` is the single place that decides the identity from that config plus the current environment. `runGh(args, opts)` is the single place that spawns `gh` with the decision applied; `ghJson` becomes a thin wrapper over `runGh`. All 9 `gh` sites route through `runGh` so they share one credential and one identity source.

**Behavior summary — the config read.** Read only the two `autonomous` keys, tolerate any unrelated config fault, and resolve once per process.

```
PROCEDURE readRunnerGhConfig():          # memoised once per process in a module-level cache
  1. IF the module-level memo is set: RETURN it
  2. TRY:
       [data] := loadConfig()
       memo := { tokenEnvName: dig(data, "autonomous.runner_github_token_env") or null,
                 configuredLogin: dig(data, "autonomous.runner_github_login") or null,
                 configFault: false }
     CATCH any (base-parse-error, overlay-parse-error, legacy-*-name, …):
       memo := { tokenEnvName: null, configuredLogin: null, configFault: true }
  3. RETURN memo
```

**Behavior summary — env resolution.** Pure over its inputs. The token VALUE is read from the passed `env`, so an externally-refreshed App installation token is still picked up (the resolver is re-run per `gh` call against fresh `process.env`); only the config read is memoised.

```
PROCEDURE resolveRunnerGhEnv(runnerGhConfig, env):
  1. IF runnerGhConfig.configFault:
       RETURN { env, redactedEnv: env, identitySource: "ambient",
                tokenEnvName: null, credentialUnresolved: false, configFault: true }   # broken .faffrc: ambient
  2. name := runnerGhConfig.tokenEnvName
  3. IF name is absent/empty:
       RETURN { env, redactedEnv: env, identitySource: "ambient",
                tokenEnvName: null, credentialUnresolved: false, configFault: false }  # zero-config: untouched
  4. token := env[name]
  5. IF token is absent OR empty:
       RETURN { env, redactedEnv: env, identitySource: "ambient",
                tokenEnvName: name, credentialUnresolved: true, configFault: false }   # misconfig: warn + record, do NOT inject
  6. built := { ...env, GH_TOKEN: token }
  7. redacted := { ...built, GH_TOKEN: "***REDACTED***" }
  8. RETURN { env: built, redactedEnv: redacted, identitySource: "runner-credential",
              tokenEnvName: name, credentialUnresolved: false, configFault: false }
```

**Behavior summary — the spawn wrapper.** Every `gh` call reuses the memoised config, reads the token value fresh, and never logs the raw env.

```
PROCEDURE runGh(args, opts):
  1. cfg := readRunnerGhConfig()                       # memoised; NOT re-parsed per call; never throws
  2. resolved := resolveRunnerGhEnv(cfg, process.env)  # token VALUE read fresh from process.env
  3. IF resolved.configFault AND NOT warnedConfigFault:
        warnedConfigFault := true
        warn ".faffrc could not be read; proceeding as the ambient GitHub identity"
  4. ELSE IF resolved.credentialUnresolved AND NOT warnedUnresolved:
        warnedUnresolved := true
        warn "runner_github_token_env names <name> but it is empty; proceeding as the ambient identity"
  5. RETURN spawnSync("gh", args, { encoding: "utf8", env: resolved.env, ...opts })
     # opts carries the existing per-site timeout / cwd; env is the only addition
```

The warn-once flags `warnedConfigFault` and `warnedUnresolved` are module-level booleans in `merge-gate.js`, so each distinct warning fires at most once per process. The config memo is the module-level cache `readRunnerGhConfig` fills on first call.

**Routing the 9 sites.** All route through `runGh`; none keeps a bare `spawnSync("gh", ...)`:

| Site | File:line | Change |
|---|---|---|
| `ghJson` | merge-gate.js:300 | Delegate to `runGh(args)` |
| anchor `gh api -I` | merge-gate.js:321 | `runGh(..., { timeout: 60000 })` |
| merge `gh pr merge` | merge-gate.js:1691 | `runGh(..., { timeout: 120000 })` |
| `gh pr create` | merge-gate.js:1785 | `runGh(ghArgs, { timeout: 120000 })` |
| branch rules `gh api` | merge-gate.js:1821 | `runGh(..., { timeout: 60000 })` |
| `gh api user` | merge-gate.js:1895 | `runGh(["api","user"], { timeout: 60000 })` |
| `gh pr view` | forge-merge.js:19 | `runGh(...)` |
| `gh pr list` | review-target.js:74 | `runGh(..., { cwd, timeout: 60000 })` |
| `gh repo view` | prdr.js:269 | `runGh(..., { cwd })` |

**Anti-pattern:** caching the resolved env (including the token value) once at run start. Why: an App installation token is short-lived and may be refreshed externally during a long run; a cached token would spawn `gh` with a stale value and fail mid-merge. The config read is memoised; the token value is not.

**Anti-pattern:** calling the throwing `loadConfig()` fresh inside `runGh` per spawn (the original design). Why: a malformed `.faffrc` would throw on every one of the merge's ~6 `gh` spawns and break `github-auth-check`, `branch-protection-check`, and the merge itself, when those diagnostics should still run. `readRunnerGhConfig` reads only the narrow keys, tolerates the fault, and resolves once.

**Anti-pattern:** adding a new `spawnSync("gh", ...)` that skips `runGh`. Why: it silently runs as the ambient human identity, defeating the one-chokepoint principle.

**Behavior summary — resolving the acting login.** The recorded login's source of truth is the configured `runner_github_login` when set; `gh api user` is a best-effort verifier that also auto-fills the login for PAT and bot-account tokens. An App installation token makes `gh api user` return 403 ("Resource not accessible by integration"), so for Apps the configured login stands unverified rather than failing.

```
PROCEDURE resolveRunnerIdentity(runnerGhConfig, resolvedEnv):
  1. configuredLogin := runnerGhConfig.configuredLogin
  2. IF resolvedEnv.identitySource == "ambient":
     a. RETURN { github_login: configuredLogin ?? null,
                 github_login_source: configuredLogin ? "configured" : "unresolved",
                 credential_source: "ambient",
                 credential_unresolved: resolvedEnv.credentialUnresolved,
                 verified: false }
  3. probe := classifyGithubAuth(runGh(["api","user"]))     # runs UNDER the runner credential
  4. IF probe.status == "authed" AND probe.login:
     a. IF configuredLogin AND not githubActorMatches(configuredLogin, probe.login):
        warn "configured runner_github_login (<configuredLogin>) != gh api user login (<probe.login>)"
     b. RETURN { github_login: probe.login, github_login_source: "gh-api-user",
                 credential_source: "runner-credential", credential_unresolved: false, verified: true }
  5. # App-token 403 or indeterminate: fall back to the configured login, unverified
     IF configuredLogin:
        RETURN { github_login: configuredLogin, github_login_source: "configured",
                 credential_source: "runner-credential", credential_unresolved: false, verified: false }
  6. RETURN { github_login: null, github_login_source: "unresolved",
              credential_source: "runner-credential", credential_unresolved: false, verified: false }
```

**Recording the identity in evidence — events.jsonl, anchored, never the token.** The resolution of the review's "run ledger vs events.jsonl" ambiguity is explicit: the append-only path is **events.jsonl** via `appendEventRecord`, not the mutable `run-ledger.json` (which is the `mutateLedgerUnderLock` path in heartbeat.js).

- **Run start / preflight.** Append one run-level `type: "runner-identity"` record to `events.jsonl` via `appendEventRecord` (events.js:598), with payload shape:

  ```
  { phase: <the run-start/preflight event_phase, a member of DELIVERY_PROFILE.event_phases>,
    type:  "runner-identity",
    data:  RunnerIdentityEvidence }
  ```

  The record is run-level (no `issue` field), so it is carried into every per-issue anchor. The genesis `run-start` record and its `prev = SHA-256(run_id)` invariant are untouched.

- **Register the event type (governance-region edit).** `appendEventRecord` lands the record, but the verb layer validates `type` against the closed set `DELIVERY_PROFILE.event_types` in `eventViolations` (events.js:197-199), and `runner-identity` is not in it, so the append is rejected as written. Add the string `"runner-identity"` to `DELIVERY_PROFILE.event_types` (governance-profile.js, lines 69-129). That file is tagged `region:governance` (governance-profile.js:2), so this is a governance-region edit; it is ADR-0042-safe because it adds a string literal and introduces no governance to factory `require`. It is run-level, so it is not added to `issue_scoped_types` and is not `outcome_required`.

- **Validate the payload (governance-region edit, optional but recommended).** Add a per-type `data.*` closed-vocabulary check to `eventViolations` (events.js), mirroring the existing `agent-dispatch` block: `data.credential_source` in `{runner-credential, ambient}`, `data.github_login_source` in `{configured, gh-api-user, unresolved}`, `data.verified` and `data.credential_unresolved` boolean. `eventViolations` is in events.js, also `region:governance`, so the check introduces no cross-region `require`.

- **The record rides into the committed, head-sha-pinned anchor for free.** `mintIssueAnchor` (events.js:1474) byte-copies `events.jsonl` verbatim into the per-PR anchor dir and writes `chain-head.json` via `computeChainHead` (events.js:1549), whose `head_sha256` is the SHA-256 of the log's last line, pinning the whole log at the PR head SHA. No `optionalFloorFiles` (events.js:1513) edit and no FAFF-1155 required-presence edit (events.js:1249) are needed, because the identity lives in `events.jsonl`, which the mint copies verbatim; the hash chain plus `chain-head.json` make any post-anchor rewrite detectable and force a fresh branch-protection-gated `governance-check`.

- **Gate 1 consumes the anchored copy.** FAFF-1182 MUST read the identity from the anchored `events.jsonl` — via the `evaluateAnchorDir` reader pattern, or `git show <headSha>:.faff/anchors/<run>/<issue>/events.jsonl`, cross-checked against `chain-head.json` — never from the live run-dir `events.jsonl`, `run-ledger.json`, or `merge-record.json`, each of which the build lane can rewrite (the FAFF-690 hole). This slice does not implement the read; it places the evidence where the read must come from and names the contract.

- **Merge record and PR-create entry (convenience, non-authoritative).** `writeMergeRecord` (merge-gate.js:475) already accepts an `identity` param and writes `harness`/`model`; add `github_actor: { login, source }` to its record (login + `credential_source`, no token). The production callers (merge-gate.js:419/1256/1353/1705/1722) pass the resolved value. The pr-create effect entry (merge-gate.js:1795, `appendEffectEntries`) carries the same `{ login, source }`. These sit on build-lane-writable surfaces and are human-facing / debug copies only; they are NOT the source Gate 1 trusts.

- **github-auth-check** additionally reports the resolved identity (see Token leakage controls and the augmented output below).

**Token leakage controls.**

- Register the literal leaf name `runner_github_token_env` in `redact.js` `SECRET_ENV_HANDLE_KEYS` (redact.js:46) so `collectKnownSecretValues` / `resolveKnownSecretValues` treat `process.env[runner_github_token_env]` as a known secret.
- `appendEventRecord` already runs `payload.data` through `redactKnownSecrets` before the write (events.js:599-601), so the `runner-identity` event is scrubbed by construction.
- **Route `writeMergeRecord` through the redaction core.** Today it is a bare `fs.writeFileSync` (merge-gate.js:485) that calls no redaction, so the original spec's claim that `SECRET_ENV_HANDLE_KEYS` scrubs the token from the merge record was false. Fix: before the write, compute `safe := redactKnownSecrets(record, resolveKnownSecretValues())` (both imported from `./redact`) and serialize `safe`. **Chosen** over a by-construction-only guarantee so the holdout (token absent from the merge record) holds even if a future field carries token-derived text; the construction guarantee that `github_actor` carries only `{login, source}` still stands as the first line of defence.
- `resolveRunnerGhEnv` returns `redactedEnv` with `GH_TOKEN` masked; any code logging the `gh` environment uses `redactedEnv`, mirroring `buildIsolatedChildEnv`.

**github-auth-check output — preserve ambient verification AND report the runner identity.** `cmdGithubAuthCheck` (merge-gate.js:1890) runs `gh api user` through `runGh` and prints `status (basis: ...)` plus the login when authed (merge-gate.js:1897-1898). Routed through `runGh`, that probe now runs under the runner credential when one is configured. Augment the output rather than replace it, so the preflight's original "is gh auth working" purpose is not silently lost:

- Text form: `authed (basis: gh api user ok) — octocat [runner-credential]` (the trailing tag is `[runner-credential]` or `[ambient]`); on unresolved or config-fault, append the reason.
- `--json` form: extend `{ status, basis, login }` with `identity_source` (`"runner-credential"` | `"ambient"`), `credential_source`, `credential_unresolved`, and `config_fault`.

The `status`/`basis`/`login` triple is unchanged, so ambient verification is preserved; the added fields report which identity the probe reflected.

**Edge cases and fallback precedence.**

- `runner_github_token_env` absent => ambient, environment untouched (zero-config).
- Named but empty/absent value => `credentialUnresolved`, warn once, proceed ambient, record `credential_source: "ambient"` with `credential_unresolved: true` so downstream counting sees attempted-but-failed separation. Not a silent fallback.
- `.faffrc` unreadable (base/overlay parse fault, legacy name) => `configFault`, warn once with the config-read message, proceed ambient, record `credential_source: "ambient"` with `credential_unresolved: false`. Distinct from named-but-empty: a config fault is an operator-environment problem, not a separation signal, and GitHub diagnostics keep running.
- Runner credential present, `gh api user` authed => verified login from the probe.
- Runner credential present, `gh api user` 403 (App) => configured login, `verified: false`.
- Runner credential present, no configured login and probe not authed => `github_login: null`, `github_login_source: "unresolved"`.

**Failure modes.**

- **The failure:** Gate 1 trusts an identity read from a build-lane-writable surface (live `events.jsonl`, `run-ledger.json`, or `merge-record.json`) that a compromised lane rewrote, so evidence says "runner" while the human acted. **How you'd know:** the identity in the live file differs from the `runner-identity` record in the anchored `events.jsonl` at the PR head SHA, and the anchor's `chain-head.json` `head_sha256` no longer matches the anchored log's last line. **What it means:** fail closed — Gate 1 reads only the anchored copy; a mismatch is a tamper signal, not a defect in this slice. This slice's job is to place the evidence in the anchored log and name the read contract.
- **The failure:** the one-chokepoint claim is false because a `gh` call bypasses `runGh` (an existing site missed, or a new one added later), so part of the run acts as the human while evidence says runner. **How you'd know:** a conformance selftest that greps the emit for `spawnSync("gh"` and asserts every match is inside `runGh`, plus a fixture asserting `runGh` sets `GH_TOKEN` from the named var. **What it means:** narrow — fix the missed site; the design holds.
- **The failure:** recorded login diverges from the identity that actually merged, because `gh api user` cannot see an App's slug and the configured login is wrong or stale. **How you'd know:** `verified: false` on the evidence record, and (once FAFF-1182 lands) `githubActorMatches(recorded, mergedBy)` returns false. **What it means:** proceed — this slice records honestly (`verified: false` is the signal); the live reconciliation is FAFF-1182's to make, not a defect here.
- **The failure:** the token leaks into a durable write because it reaches a field the known-secret walk does not cover. **How you'd know:** the redaction selftest asserts the token value is absent from the merge record, ledger, and events after a run with a configured credential. **What it means:** narrow — `writeMergeRecord` now routes through `redactKnownSecrets` and `appendEventRecord` already does; extend coverage to the new field; the inject-by-name model is sound.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given no autonomous.runner_github_token_env is configured
When faff makes any gh call (merge-gate, pr-create, a read probe)
Then the spawned gh environment is byte-identical to the ambient process environment (no GH_TOKEN set, cleared, or reordered by faff)
```

```
Given autonomous.runner_github_token_env = "RUNNER_GH_TOKEN" and process.env.RUNNER_GH_TOKEN holds a non-empty token
When runGh spawns any gh call
Then GH_TOKEN in the child env equals that token value, read fresh at the moment of the call, and identitySource is "runner-credential"
```

```
Given a runner credential resolved and gh api user returns an authed login
When the run records its identity evidence
Then a runner-identity record is appended to events.jsonl carrying { github_login: <that login>, github_login_source: "gh-api-user", credential_source: "runner-credential", credential_unresolved: false, verified: true } and no token value
```

```
Given a run recorded its runner identity and the per-PR anchor is minted at head SHA H
When the committed anchor's events.jsonl is read at H and its chain-head.json is verified
Then the runner-identity record is present in the anchored log, chain-head.json head_sha256 matches the log's last line, and the identity Gate 1 consumes comes from this anchored copy, never the live run-dir file
```

```
Given autonomous.runner_github_token_env names a variable that is empty/unset
When runGh resolves the environment
Then it warns once, leaves GH_TOKEN untouched, and records credential_source "ambient" with credential_unresolved true (no silent fallback)
```

```
Given autonomous.runner_github_token_env is configured but .faffrc is malformed so loadConfig throws
When runGh resolves the environment
Then it warns once with the config-read message, leaves GH_TOKEN untouched, spawns gh as the ambient identity, and records credential_source "ambient" with configFault distinct from credentialUnresolved (diagnostics keep running)
```

```
Given a runner credential is an App installation token (gh api user returns 403) and autonomous.runner_github_login is set
When the run resolves its identity
Then the recorded github_login is the configured login with github_login_source "configured" and verified false
```

## 6. DESIGN DECISION RATIONALE

**Which config namespace holds the keys?**
- New `runner:` namespace: clean grouping, but needs a `WRITABLE_NAMESPACES` entry, example-drift registration, and a new namespace surface.
- Reuse `autonomous.*`: already writable, already home to `require_github_auth` and the other GitHub-auth preflight knobs.
- **Chosen:** `autonomous.*` — least drift, co-located with the related knobs, no `WRITABLE_NAMESPACES` change.

**How is the credential supplied?**
- Inline token in config: would persist the secret in `.faffrc.yaml` — rejected.
- Env-var handle (name in config, value in env): matches `api_key_env` / `seat_token_env`, keeps the secret out of config, auto-redactable.
- **Chosen:** env-var handle, opaque bearer injected as `GH_TOKEN`, value read fresh per call — rationale: supports externally-refreshed App tokens and keeps the secret out of durable state. Token file / command sources deferred (Open Questions).

**One wrapper, or inject at each site?**
- Per-site env option: repetitive, easy to miss a site, no single conformance point.
- Single `runGh` + `resolveRunnerGhEnv`, `ghJson` delegating: one chokepoint, selftest-able, free for future call sites.
- **Chosen:** single wrapper — rationale: the one-chokepoint principle, and a grep-based conformance selftest becomes possible.

**What is the acting-login source of truth?**
- `gh api user` only: fails (403) for App installation tokens, so an App run would record no login.
- Configured `runner_github_login` only: never verified.
- Configured login as source of truth, `gh api user` as best-effort verifier/auto-fill.
- **Chosen:** the hybrid — `gh api user` verifies and auto-fills for PAT/bot (`verified: true`); the configured login stands for Apps (`verified: false`). Rationale: records honestly across both identity shapes without failing the App case. At the time of writing, obtaining an App's `<slug>[bot]` actor requires a JWT call to `GET /app` that faff does not make; reconciling against the live merge author is FAFF-1182's job.

**Configured-but-empty: refuse or warn?**
- Fail-closed refuse: would abort a run on a transient env glitch, and enforcement is not this slice's job.
- Warn + record `ambient` + surface `credential_unresolved`: visible, non-silent, lets Gate 1 (FAFF-1182) treat the run as non-separate.
- **Chosen:** warn-and-record — rationale: this slice makes identity available and recorded; refusal/enforcement belongs to FAFF-1182 and FAFF-1209.

**Add the merge-actor check now?**
- Add `mergedBy` fetch to forge-merge.js now: pulls FAFF-1182's independence logic into this slice.
- Record identity + expose `githubActorMatches` only.
- **Chosen:** record + expose the comparator, leave the live actor check to FAFF-1182 — rationale: keeps this slice to identity plumbing + evidence, matching the ticket's Done-when.

**Where does the security-relevant identity live, and who reads it?**
- On the merge record / live `run-ledger.json` only (original spec): build-lane-writable, so a compromised lane rewrites it and Gate 1 cannot tell — the FAFF-690 hole. Rejected.
- On the hash-chained `events.jsonl` append record, carried into the committed head-sha-pinned anchor by `mintIssueAnchor`'s verbatim `events.jsonl` byte-copy plus `chain-head.json`; Gate 1 reads the anchored copy.
- **Chosen:** the anchored `events.jsonl` record is authoritative; `merge-record.json` `github_actor` and the pr-create entry are non-authoritative convenience copies. Rationale: identity is a security-relevant input to Gate 1, so it must sit behind the same FAFF-690 / 623 / 1155 tamper-evident anchor the level already uses. No `optionalFloorFiles` edit is needed, because `events.jsonl` is byte-copied verbatim.

**Which append path, and how does the event type validate?**
- `run-ledger.json` via `mutateLedgerUnderLock`: the mutable ledger, not the append-only chain — the wrong home, and the source of the original "run ledger" ambiguity.
- `events.jsonl` via `appendEventRecord`: append-only, hash-chained, byte-copied into the anchor; requires registering the type in the closed `event_types` vocabulary.
- **Chosen:** `events.jsonl` via `appendEventRecord`, with `"runner-identity"` registered in `DELIVERY_PROFILE.event_types` (a `region:governance` edit, ADR-0042-safe). Rationale: resolves the run-ledger-vs-events.jsonl ambiguity, and without the registration `eventViolations` rejects the record.

**Config read: throw per call, or fault-tolerant and memoised?**
- Call the throwing `loadConfig()` fresh on every one of the merge's ~6 `gh` spawns (original `runGh`): breaks every GitHub diagnostic on a malformed `.faffrc` and re-parses the whole config repeatedly.
- A narrow, fault-tolerant `readRunnerGhConfig` that reads only the two `autonomous` keys, memoised once per process; a config fault degrades to ambient (warn), distinct from a named-but-empty token.
- **Chosen:** the fault-tolerant memoised read. Rationale: `github-auth-check`, `branch-protection-check`, and the merge keep working on a broken config; the token value is still read fresh per call (App-token refresh preserved); and a config fault is treated as "no runner credential configured" rather than aborting the run or silently swallowing a named-but-empty credential.

**Merge-record token safety: by-construction only, or route through the redaction core?**
- By-construction only (write just `{login, source}`): true today, but the original spec's claim that `SECRET_ENV_HANDLE_KEYS` scrubbed the record was false, because `writeMergeRecord` never called redaction, so a future token-bearing field would leak.
- Route `writeMergeRecord` through `redactKnownSecrets(record, resolveKnownSecretValues())` before the write, and keep the `{login, source}`-only construction.
- **Chosen:** route through the redaction core AND keep the construction guarantee. Rationale: makes the holdout (token absent from the merge record) true even against a future field, and makes the spec's redaction claim honest.

**github-auth-check: replace or augment the output?**
- Replace the ambient status with the runner identity: silently loses the preflight's "is gh auth working" purpose.
- Augment: keep `status`/`basis`/`login` and add `identity_source` / `credential_source` / `credential_unresolved` / `config_fault`.
- **Chosen:** augment. Rationale: preserves ambient verification while surfacing which identity the probe reflected.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** non-env credential sources (a token file or a token-minting command) or env-var-only — needs human (non-blocking). (decides: architecture) v1 ships env-var-only; this does not block the increment and is cross-referenced under OUT OF SCOPE. A future source would slot behind the same `readRunnerGhConfig` / `resolveRunnerGhEnv` return shape.

**Assumptions.**

- **Assumes:** the operator-created runner GitHub identity (bot account or GitHub App) and its token exist, with the token present in `process.env` under the name given in `autonomous.runner_github_token_env`. Validation before build: confirm with the operator which env var carries the token; with none provisioned, the zero-config path is exercised and the runner-credential path is tested via a fixture token, not a live call.
- **Assumes:** claude-box's forwarding of the human `gh auth token` into the cage is unchanged and outside faff's control (FAFF-1209). Validation: none required in this repo; faff only prefers the runner credential and records the source, so a human token also being present does not break this slice.

## 8. DONE — Definition of Done

### From WHY
- [ ] With no `autonomous.runner_github_token_env` set, every `gh` call's spawned environment is byte-identical to ambient (asserted by a fixture: resolver returns the input env unchanged, no GH_TOKEN added).
- [ ] The recorded identity reaches the committed, head-sha-pinned anchor: a test appends the `runner-identity` record, mints the anchor via `mintIssueAnchor`, reads the record back from the anchored `events.jsonl` at the head SHA, and asserts `chain-head.json` `head_sha256` matches the anchored log's last line. The spec documents the anchored copy (not the live file) as Gate 1's consumption point.

### From WHAT (config + types)
- [ ] `autonomous.runner_github_token_env` and `autonomous.runner_github_login` are registered in `DEFAULTS` and documented in `.faffrc.example.yaml`; `faff config check --selftest` passes.
- [ ] `readRunnerGhConfig()` reads only the two `autonomous` keys via a fault-tolerant read that returns `configFault: true` instead of throwing on a malformed `.faffrc`, and is memoised once per process at a named module-level cache.
- [ ] `resolveRunnerGhEnv(runnerGhConfig, env)` is pure over its inputs and returns the `RunnerGhEnv` shape (including `configFault`) with the stated constraints (fixture-tested like `classifyGithubAuth`).
- [ ] `RunnerIdentityEvidence` carries `credential_unresolved`.

### From HOW (behaviour)
- [ ] All 9 `gh` sites (6 in merge-gate.js, 1 each in forge-merge.js, review-target.js, prdr.js) spawn via `runGh`; a conformance selftest asserts no bare `spawnSync("gh"` remains outside `runGh`, and `ghJson` delegates to `runGh`.
- [ ] `runGh` reuses the memoised config (does not call the throwing `loadConfig()` per spawn) and sets `GH_TOKEN` to the named env var's current value, read fresh from `process.env` per call, when a runner credential is configured.
- [ ] `resolveRunnerIdentity` records `{ github_login, github_login_source, credential_source, credential_unresolved, verified }`: `gh-api-user`/`verified: true` on an authed probe, configured login/`verified: false` on an App 403, `unresolved` when neither resolves.
- [ ] A `type: "runner-identity"` record is appended to `events.jsonl` via `appendEventRecord` (not `run-ledger.json`), with `"runner-identity"` registered in `DELIVERY_PROFILE.event_types` so `eventViolations` accepts it; the genesis `run-start` record and its `prev = SHA-256(run_id)` invariant are untouched.
- [ ] `writeMergeRecord` records `github_actor: { login, source }` and routes the whole record through `redactKnownSecrets(record, resolveKnownSecretValues())` before writing; the pr-create effect entry carries the same `{ login, source }`.
- [ ] `faff github-auth-check` augments its output with `identity_source` / `credential_source` / `credential_unresolved` / `config_fault` while preserving the existing `status` / `basis` / `login` verification signal.

### From HOW (edge cases + leakage)
- [ ] A named-but-empty `runner_github_token_env` warns once, leaves GH_TOKEN untouched, records `credential_source: "ambient"` and `credential_unresolved: true`.
- [ ] A malformed `.faffrc` warns once with the config-read message, leaves GH_TOKEN untouched, records `credential_source: "ambient"` with `configFault`/`credential_unresolved: false`, and does not throw out of `runGh`; GitHub diagnostics still run.
- [ ] Each warn-once message fires at most once per process via a named module-level flag (`warnedConfigFault`, `warnedUnresolved`).
- [ ] `runner_github_token_env` is registered in `redact.js` `SECRET_ENV_HANDLE_KEYS`; a redaction selftest asserts the token value is absent from the ledger, events.jsonl, and merge-record.json after a configured-credential run.
- [ ] `resolveRunnerGhEnv` returns `redactedEnv` with `GH_TOKEN` masked, and any env logging uses it.

### From WHAT (comparison hook for FAFF-1182)
- [ ] `githubActorMatches(recorded, actor)` is pure and normalises a trailing `[bot]` on either argument before comparing.

### Eval coverage
- [ ] No LLM-judgement seam is introduced (all new logic is deterministic/pure), so no grader registration is required.

### Integration smoke test
```
PROCEDURE smoke():
  1. Set autonomous.runner_github_token_env = "FAFF_TEST_GH_TOKEN"; process.env.FAFF_TEST_GH_TOKEN = "<fixture>"
  2. cfg := readRunnerGhConfig(); resolved := resolveRunnerGhEnv(cfg, process.env)
  3. ASSERT resolved.env.GH_TOKEN == "<fixture>" AND resolved.identitySource == "runner-credential"
  4. ASSERT resolved.redactedEnv.GH_TOKEN == "***REDACTED***"
  5. Unset the var; resolved2 := resolveRunnerGhEnv(cfg, process.env)
  6. ASSERT resolved2.identitySource == "ambient" AND resolved2.credentialUnresolved == true
  7. Clear the config key (new process / reset memo); resolved3 := resolveRunnerGhEnv(readRunnerGhConfig(), process.env)
  8. ASSERT resolved3.env has no GH_TOKEN added by faff (byte-identical to ambient)
  9. Point readRunnerGhConfig at a malformed .faffrc; resolved4 := resolveRunnerGhEnv(readRunnerGhConfig(), process.env)
 10. ASSERT resolved4.configFault == true AND resolved4.identitySource == "ambient" AND no throw escaped
```

confidence: medium