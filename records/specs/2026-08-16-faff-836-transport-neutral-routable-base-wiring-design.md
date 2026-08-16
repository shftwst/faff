# Transport-neutral routable-base wiring — expose env `base.host` to the CLI

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-836.

This spec is for the build agent implementing FAFF-836, and for the human reviewers gating it. It is buildable from this document alone: it names the exact file, the seam it closes, the precedence rule to add, and a testable DONE that mirrors the body. The change is a small, transport-neutral wiring slice carved out of FAFF-817.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-791 already built the whole re-basing machine inside `composeGen`: a fifth `base` parameter (`{ host }`), a validator (`envValidateBaseHost`), and a resolver (`envResolveEndpoint`) that rewrites each service endpoint against `base.host`. The machine works and is selftested — but the CLI never feeds it anything. Both `cmdEnv` call sites into `composeGen` pass only four arguments, so `base` always falls to its `{ host: "localhost" }` default and no routable address can reach the resolver from the command line. This slice is the missing wire, nothing more: read a base from the CLI, thread it into the two call sites.

**Problem statement.** Today a routable env base is reachable only in-process — the CLI can emit `localhost:PORT` and nothing else. That blocks a topologically-separated evaluator from ever pointing at a re-based endpoint. This change lets the operator (and later, a transport) supply the base from outside JS via a flag or config, without choosing any transport.

**Design principles.**

- **No new trust-boundary code.** Base-host validation stays exactly the existing `envValidateBaseHost` (`env.js:349`, the FAFF-791 invariant). This slice adds a flag and a precedence read; it does not add, weaken, or duplicate validation. Positive-allowlist hardening is a separate ticket (FAFF-818).
- **Default output stays byte-identical.** With no flag and no configured base, resolution must yield `{ host: "localhost" }`, so `composeGen` produces exactly today's plan and today's compose file. This is the regression floor the existing selftests already assert.
- **The `env-handle` contract does not change.** The resolved base lives on the internal `plan` (as it has since FAFF-791); no `base`/`base.host` field is ever added to the emitted `env-handle`. This slice touches only how `plan.endpoints` are addressed, never the handle's shape.
- **Resolve once per handler.** Each verb handler computes the base a single time and threads the same value into its `composeGen` call — no repeated flag/config reads.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/env.js` | Node (dependency-free) | The only file changed — flag spec, both handlers, and the selftests all live here |
| `composeGen(profile, projectName, outPath, appOverride, base)` (`env.js:375`) | Node | The FAFF-791 seam; already accepts + validates + resolves against `base` |
| `envValidateBaseHost` (`env.js:349`) | Node | The sole base-host validator; throws loud inside `composeGen` on a malformed base |
| `loadConfig(root)` (`config.js:530`) | Node | Returns `[mergedData, basePath, overlayPath]`; `mergedData.env.base_host` is the `.faffrc` fallback |

**Scope statement.** This is slice 1 of the FAFF-817 split — the transport-neutral half that makes a routable base *reachable* from the CLI; the concrete transport that *supplies* a routable base is FAFF-817 (slice 2), blocked on this.

## 2. OUT OF SCOPE

- **Any transport choice, provisioning, teardown, or per-request auth** — Why excluded: those are the concrete-transport decision, tracked in FAFF-817. Extension point: a transport occupant later supplies a non-default base to `--base-host`/`env.base_host`; this slice only makes that value reach the resolver.
- **Any `env-handle` schema change** — Why excluded: the base is an addressing input to `plan.endpoints`, not a handle field; adding it would break the fixed `env-handle` contract. Extension point: none — the handle shape is deliberately frozen here.
- **Positive hostname/IP allowlist hardening** — Why excluded: `envValidateBaseHost` today is a deny-list of malformed shapes; tightening it to a positive allowlist is FAFF-818. Extension point: `envValidateBaseHost` (`env.js:349`), owned by FAFF-818.
- **Re-basing the `env up --plan` path** — Why excluded: that path consumes an already-emitted plan (which already carries its base from compose-gen time) and never calls `composeGen`, so there is nothing to thread. Extension point: none needed.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| base | The `{ host }` record `composeGen` resolves every service endpoint against. `host` is a bare hostname/IP or a bracketed IPv6 literal (e.g. `[::1]`). |
| routable base | A non-`localhost` base — an address reachable across a machine boundary. This slice makes one suppliable; it does not itself produce one. |

**The flag.** `ENV_SPEC.flags` (`env.js:24`) gains one entry:

```
"--base-host": { arity: 1 }
```

Arity 1 means the fail-closed flag gate (`parseArgs(args, ENV_SPEC)`, `env.js:637`, FAFF-576) rejects `--base-host` with no value at exit 2 before any handler runs — so a value is guaranteed present when a handler reads it.

**The base record.**

```
RECORD Base:
  host: string      # bare hostname/IP, or bracketed IPv6 literal; validated by envValidateBaseHost inside composeGen
```

**The resolver (new pure helper).**

```
FUNCTION envResolveBase(flagVal, cfgEnv) -> Base:
  # precedence: explicit flag → configured base → localhost default
  IF flagVal is a non-null string      -> RETURN { host: flagVal }
  IF cfgEnv?.base_host is a non-empty string -> RETURN { host: cfgEnv.base_host }
  RETURN { host: "localhost" }
```

`envResolveBase` performs **no validation** — it only chooses which candidate wins. Validation remains `composeGen`'s (`envValidateBaseHost`, called at `env.js:436`), so a malformed value from any source fails at the same single trust boundary. `cfgEnv` is `loadConfig(root)[0].env` (or `{}` when absent).

**Design decision — where the config value is read.**
- Options: (a) read `.faffrc env.base_host` via `loadConfig(root)` inside `cmdEnv` and pass `cfg.env` to `envResolveBase`; (b) add a new config accessor in `config.js`.
- **Chosen:** (a) — read `loadConfig(root)[0].env` in `cmdEnv` (which already resolves `root` at `env.js:645`) and pass it to `envResolveBase`. Rationale: `loadConfig` is the established merged-config reader; `env.base_host` is a plain scalar leaf on the merged document, so no new accessor or `CONFIG_SPEC` change is needed. `env.js` gains one `require("./config")` import for `loadConfig`.

**Design decision — precedence order.**
- **Chosen:** `--base-host` flag → `.faffrc env.base_host` → `{ host: "localhost" }`. Rationale: an explicit invocation flag is the most specific signal and must beat durable config; config beats the built-in default; the default preserves byte-identical output. This is the precedence the ticket DONE fixes.

## 4. HOW — Behavior

**Architecture and approach.** One new pure helper (`envResolveBase`) and three edits in `env.js`: declare the flag, and in each of the two verb handlers that call `composeGen`, resolve the base once and pass it as the fifth argument.

**compose-gen handler (`env.js:670`-`681`).**

```
PROCEDURE compose-gen:
  1. resolve profile, project, out          (unchanged)
  2. base := envResolveBase(flag("--base-host"), loadConfig(root)[0].env || {})
  3. { plan, compose } := composeGen(r.profile, project, out, envResolveAppOverride(root), base)   # 5th arg added
  4. write compose file, print plan JSON     (unchanged)
```

**up handler, non-plan path (`env.js:690`-`697`).**

```
PROCEDURE up (no --plan):
  1. resolve profile, project, out           (unchanged)
  2. base := envResolveBase(flag("--base-host"), loadConfig(root)[0].env || {})
  3. g := composeGen(r.profile, project, out, envResolveAppOverride(root), base)   # 5th arg added
  4. proceed with g.plan / g.compose          (unchanged)
```

The `up --plan` path (`env.js:686`-`688`) reads an already-emitted plan and never calls `composeGen`; it is left untouched — the plan it loads already carries the base chosen when compose-gen produced it.

**Edge cases and error handling.**

- **Malformed base (any source).** `composeGen` calls `envValidateBaseHost(base.host)` at `env.js:436` and `throw`s before building any surface or returning a plan — and, crucially, before the handler's compose-file write. So a malformed `--base-host` (e.g. `http://evil/`, `host:8080`, `user@host`) produces no resolved endpoint and no compose file. **Chosen:** wrap the resolve-and-`composeGen` step in each handler in a `try/catch` that maps the thrown validation error to a `stderr` line plus `return 2`, matching the file's existing fail-closed exit convention (`usageError` → 2, FAFF-576), rather than letting a raw stack trace escape. Rationale: keeps the CLI diagnostic clean while leaving `envValidateBaseHost` as the sole validator — no new trust-boundary code. The catch is scoped to the `composeGen` call so it never masks unrelated errors.
- **Empty/whitespace config value.** `envResolveBase` treats only a non-empty string `base_host` as a hit; an empty string falls through to the default (it is not a routable address). A genuinely malformed non-empty value is caught downstream by `envValidateBaseHost`.
- **No config file / no `env` block.** `loadConfig` returns `[{}]`; `cfg.env` is `undefined`, coalesced to `{}`; resolution falls to `localhost`. Byte-identical to today.

**Anti-pattern:** re-validating the base host in the handler or in `envResolveBase`. Why: it duplicates the FAFF-791 trust boundary, risks the two validators drifting, and is explicitly out of scope — validation stays `envValidateBaseHost` alone.

**Anti-pattern:** adding the resolved base to the emitted `env-handle`. Why: the handle contract is fixed; the base belongs on the internal `plan` only.

## 5. Scenarios — born-verifiable main objectives

```
Given an infra profile with an app service and a datastore
When `faff env compose-gen --base-host 10.0.0.5` runs
Then plan.endpoints.app == "http://10.0.0.5:3000" and plan.endpoints[<datastore>] keeps its tcp scheme and port with only the host re-based
```

```
Given no --base-host flag and `.faffrc` env.base_host: 10.0.0.9
When compose-gen resolves the base
Then envResolveBase returns { host: "10.0.0.9" } (config fallback beats the localhost default)
```

```
Given --base-host http://evil/ (a value carrying a scheme)
When compose-gen runs
Then envValidateBaseHost rejects it, composeGen throws before emitting a plan, no compose file is written, and the handler exits non-zero
```

```
Given neither a --base-host flag nor a configured env.base_host
When compose-gen runs
Then the emitted plan and compose file are byte-identical to today's localhost output and every existing compose-gen selftest passes unchanged
```

## 6. Design Decision Rationale

**Where does the CLI read the configured base from?** Options: a new `config.js` accessor vs reusing `loadConfig`. **Chosen:** reuse `loadConfig(root)[0].env` in `cmdEnv`. Rationale: `env.base_host` is a scalar leaf on the merged config; `loadConfig` already returns the merged document; no new accessor or schema entry is warranted for one read.

**Precedence of the three base sources.** **Chosen:** flag → config → `localhost`. Rationale: specificity order (invocation-explicit beats durable-config beats built-in), and the default preserves the byte-identical regression floor.

**How does the base become testable without docker or a live handler?** Options: drive `cmdEnv` end-to-end in selftest vs extract a pure resolver. **Chosen:** extract the pure `envResolveBase(flagVal, cfgEnv)` and export it, so `envSelftest` unit-tests the precedence directly — mirroring the file's established pure-function-plus-selftest convention (`envResolveEndpoint`, `envDownArgs` are both pure and selftested). The endpoint re-basing itself is already covered by the FAFF-791 `composeGen` selftests.

**How does a malformed base surface at the CLI?** Options: let the `composeGen` throw escape as an uncaught stack trace vs catch it in the handler. **Chosen:** catch and map to `stderr` + exit 2. Rationale: consistent with the file's fail-closed exit convention; `envValidateBaseHost` remains the only validator. Both approaches satisfy "fails loud, emits no endpoint"; the catch is the cleaner diagnostic.

## 7. Open Questions and Assumptions

**Open Questions.** None. The seam, precedence, and validation are all fully determined by the shipped FAFF-791 code and the ticket DONE.

**Assumptions.**

- **Assumes:** the FAFF-791 seam exists as shipped — `composeGen`'s fifth `base` param (`env.js:375`), `envValidateBaseHost` (`env.js:349`), `envResolveEndpoint` (`env.js:368`), and the `base`/`surfaces`/`endpoints` fields on the returned `plan` (`env.js:454`). Validation: confirmed present in the current tree (PR #675, merged 2026-08-16); the build agent re-reads `env.js` before editing.
- **Assumes:** `loadConfig(root)` returns `[mergedData, ...]` and reads a nested `env.base_host` scalar from `.faffrc` without a schema change. Validation: confirmed at `config.js:530`; `env.base_host` is a plain leaf on the merged YAML.

## 8. DONE — Definition of Done

### From WHY
- [ ] With no `--base-host` and no configured `env.base_host`, the emitted plan and compose file are byte-identical to today's localhost output.
- [ ] The emitted `env-handle` carries no field outside the fixed contract shape (no `base`/`base.host` added).

### From WHAT (flag + resolver)
- [ ] `ENV_SPEC.flags` includes `"--base-host": { arity: 1 }`.
- [ ] A pure `envResolveBase(flagVal, cfgEnv)` returns `{ host }` by precedence flag → `cfgEnv.base_host` → `"localhost"`, is exported from `env.js`, and performs no validation.

### From HOW (behaviour)
- [ ] The compose-gen handler (`env.js:676`) resolves the base once and passes it as the fifth arg to `composeGen`.
- [ ] The up handler non-plan path (`env.js:694`) resolves the base once and passes it as the fifth arg to `composeGen`.
- [ ] The `up --plan` path is unchanged (no `composeGen` call, no base threading).
- [ ] `.faffrc env.base_host` is read via `loadConfig(root)` (no new config accessor).

### From HOW (edge cases)
- [ ] `--base-host 10.0.0.5` yields `plan.endpoints["app"] == "http://10.0.0.5:3000"` (scheme + port unchanged).
- [ ] A malformed `--base-host` (e.g. `http://evil/`) fails loud via `envValidateBaseHost`, emits no resolved endpoint, writes no compose file, and the handler exits non-zero.
- [ ] An empty/absent configured base falls through to the `localhost` default.

### From selftests
- [ ] New selftests cover: `envResolveBase` precedence (flag wins over config, config wins over default, default is localhost); a `--base-host` re-base of the endpoint via `composeGen` (non-default host, unchanged scheme/port); and a malformed-base loud failure.
- [ ] Existing localhost-form, app-precedence, and FAFF-791 base selftests pass unchanged.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. write a minimal infra-profile.json (one container-image deploy target)
  2. run `faff env compose-gen --profile <that> --out <tmp> --base-host 10.0.0.5`
  3. ASSERT stdout plan.endpoints.app == "http://10.0.0.5:3000"
  4. run the same with no --base-host
  5. ASSERT stdout plan.endpoints.app == "http://localhost:3000" (byte-identical to today)
```

confidence: high
build-tier: complex
spec-review: approve

## Methodology critique

Agile-delivery lens (`issue-critique`). Advisory — written to the spec, does not gate promotion.

- **Right-sized?** No issues. One file (`env.js`), one flag + one pure helper + two threaded call sites + selftests — a single sub-day unit. It is already slice 1 of a deliberate human split from FAFF-817; splitting further would strand a flag with no call site.
- **Workstream fit?** No issues. Sits in the project "Outward L4 evidence is reproducible and honestly bounded", cohesive with the FAFF-791 → FAFF-836 → FAFF-817 re-basing chain.
- **Deps surfaced?** No issues. The blocker FAFF-791 (Done) is linked; the downstream FAFF-817 (blocks) and the related hardening FAFF-818 are both linked. No implicit dependency.
- **Risk profile?** No issues. No novel integration and no external dependency — it reuses a shipped, selftested seam. No de-risking spike warranted.
